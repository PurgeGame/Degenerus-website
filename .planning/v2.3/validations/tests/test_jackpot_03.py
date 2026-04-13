"""Integration tests for validate_jackpot_03 (Roll 2 near/far)."""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from pathlib import Path

import pytest

from harness import HealthSnapshot, load_discrepancies
from validations.jackpot.jackpot_03 import (
    CARRYOVER_MAX_OFFSET,
    SOURCE_LEVEL_BOUND_ID,
    ensure_source_level_bound_discrepancy_logged,
    validate_jackpot_03,
)


def _snap(*, unreliable: bool = False, lag: int = 0) -> HealthSnapshot:
    return HealthSnapshot(
        lag_blocks=lag,
        lag_seconds=0,
        indexed_block=1,
        chain_tip=1,
        backfill_complete=True,
        lag_unreliable=unreliable,
        sampled_at=datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
    )


def _patched_client(client, *, roll1=None, roll2=None, winners=None, roll2_404=False):
    class _Patched:
        mode = client.mode

        def get_jackpot_winners(self, day):
            return winners if winners is not None else client.get_jackpot_winners(day)

        def get_roll1(self, day):
            return roll1 if roll1 is not None else client.get_roll1(day)

        def get_roll2(self, day):
            if roll2_404:
                return None
            return roll2 if roll2 is not None else client.get_roll2(day)

        def get_final_word(self, day):
            return client.get_final_word(day)

    return _Patched()


def _synthetic_roll2(purchase_level, sourcelevels, amounts):
    """Build a synthetic roll2 payload with explicit sourceLevel values."""
    return {
        "day": 999,
        "level": purchase_level + 1,
        "purchaseLevel": purchase_level,
        "wins": [
            {
                "winner": f"0x{i:040x}",
                "awardType": "eth",
                "traitId": 41,
                "quadrant": 0,
                "amount": str(amounts[i]),
                "level": purchase_level,
                "sourceLevel": sl,
                "ticketIndex": i,
            }
            for i, sl in enumerate(sourcelevels)
        ],
    }


def _synthetic_winners(purchase_level, per_addr_total):
    return {
        "day": 999,
        "level": purchase_level + 1,
        "winners": [
            {
                "address": addr,
                "totalEth": str(total),
                "ticketCount": 1,
                "coinTotal": "0",
                "hasBonus": False,
                "winningLevel": purchase_level,
                "breakdown": [],
            }
            for addr, total in per_addr_total.items()
        ],
    }


def test_roll2_near_future_pass(fixture_client):
    """All sourceLevels in (pl, pl+4] → PASS (no classification violation)."""
    pl = 10
    sls = [11, 12, 13, 14]  # all near-future
    amts = [1000, 2000, 3000, 4000]
    r2 = _synthetic_roll2(pl, sls, amts)
    # Matching winners payload
    w = _synthetic_winners(
        pl, {f"0x{i:040x}": amts[i] for i in range(4)}
    )
    r1 = {"day": 999, "level": pl + 1, "purchaseLevel": pl, "wins": []}
    cli = _patched_client(fixture_client, roll1=r1, roll2=r2, winners=w)

    discs = validate_jackpot_03(999, cli, lag_snapshot=_snap())
    assert discs == [], f"expected PASS, got: {[(d.id, d.severity) for d in discs]}"


def test_roll2_far_future_pass(fixture_client):
    """Mix of near and far-future still passes classification."""
    pl = 10
    sls = [11, 12, 15, 20]  # 11,12 near; 15,20 far (since pl+4=14)
    amts = [100, 200, 300, 400]
    r2 = _synthetic_roll2(pl, sls, amts)
    w = _synthetic_winners(pl, {f"0x{i:040x}": amts[i] for i in range(4)})
    r1 = {"day": 999, "level": pl + 1, "purchaseLevel": pl, "wins": []}
    cli = _patched_client(fixture_client, roll1=r1, roll2=r2, winners=w)

    discs = validate_jackpot_03(999, cli, lag_snapshot=_snap())
    # No misclassification; no null-sourcelevel; no aggregation mismatch.
    assert discs == [], f"expected PASS, got: {[(d.id, d.severity) for d in discs]}"


def test_roll2_misclassified_sourcelevel_leq_purchaselevel(fixture_client):
    """sourceLevel <= purchaseLevel on a Roll 2 row → Major violation."""
    pl = 10
    sls = [11, 10, 12]  # 10 is invalid (equals pl)
    amts = [100, 200, 300]
    r2 = _synthetic_roll2(pl, sls, amts)
    w = _synthetic_winners(pl, {f"0x{i:040x}": amts[i] for i in range(3)})
    r1 = {"day": 999, "level": pl + 1, "purchaseLevel": pl, "wins": []}
    cli = _patched_client(fixture_client, roll1=r1, roll2=r2, winners=w)

    discs = validate_jackpot_03(999, cli, lag_snapshot=_snap())
    mis = [d for d in discs if "misclassified" in d.id]
    assert len(mis) == 1
    assert mis[0].severity == "Major"


def test_roll2_404_day_762_is_info_gap(fixture_client):
    """Day 762 has no roll2 fixture → client returns None → Info."""
    discs = validate_jackpot_03(762, fixture_client, lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Info"
    assert "roll2-404" in discs[0].id


def test_source_level_bound_discrepancy_written_once(tmp_path, monkeypatch):
    """Calling ensure_*_logged twice leaves exactly one entry."""
    # Redirect to an isolated temp path under .planning/v2.3/ via env override.
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(tmp_path))
    target_dir = tmp_path / ".planning" / "v2.3"
    target_dir.mkdir(parents=True)
    yaml_path = str(target_dir / "discrepancies.yaml")

    added1 = ensure_source_level_bound_discrepancy_logged(yaml_path)
    added2 = ensure_source_level_bound_discrepancy_logged(yaml_path)
    assert added1 is True
    assert added2 is False

    entries = load_discrepancies(yaml_path)
    matching = [e for e in entries if e.id == SOURCE_LEVEL_BOUND_ID]
    assert len(matching) == 1
    assert matching[0].severity == "Minor"
    assert matching[0].suspected_source == "gt_paper"


def test_source_level_bound_uses_contract_citation_not_stale_path(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("HARNESS_REPO_ROOT", str(tmp_path))
    target_dir = tmp_path / ".planning" / "v2.3"
    target_dir.mkdir(parents=True)
    yaml_path = str(target_dir / "discrepancies.yaml")
    ensure_source_level_bound_discrepancy_logged(yaml_path)
    [entry] = load_discrepancies(yaml_path)
    src = entry.derivation.sources[0]
    assert src.path.startswith("degenerus-audit/contracts/")
    assert "testing/contracts" not in src.path
    assert "degenerus-contracts/" not in src.path
    assert src.label == "contract"
    assert src.line == 167


def test_lag_downgrade_on_roll2_misclassification(fixture_client):
    """lag_unreliable demotes Major → Minor on misclassification."""
    pl = 10
    sls = [11, 10]  # one invalid
    amts = [100, 200]
    r2 = _synthetic_roll2(pl, sls, amts)
    w = _synthetic_winners(pl, {f"0x{i:040x}": amts[i] for i in range(2)})
    r1 = {"day": 999, "level": pl + 1, "purchaseLevel": pl, "wins": []}
    cli = _patched_client(fixture_client, roll1=r1, roll2=r2, winners=w)

    discs = validate_jackpot_03(
        999, cli, lag_snapshot=_snap(unreliable=True, lag=30)
    )
    mis = [d for d in discs if "misclassified" in d.id]
    assert len(mis) == 1
    assert mis[0].severity == "Minor"


def test_carryover_max_offset_is_4_not_3():
    """Contract constant check — guards against doc-drift re-introduction."""
    assert CARRYOVER_MAX_OFFSET == 4
