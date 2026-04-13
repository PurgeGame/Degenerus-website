"""Integration tests for validate_jackpot_01 (recorded-fixture replay).

Uses EndpointClient(mode="replay") to load live-probed JSON from
tests/fixtures/api/. No network.

Schema constraint (per Phase 18): Citation.path MUST NOT reference
``testing/contracts`` or ``degenerus-contracts`` -- pydantic rejects.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from harness import HealthSnapshot
from validations.jackpot.jackpot_01 import validate_jackpot_01


def _snap(*, lag_blocks: int = 0, unreliable: bool = False) -> HealthSnapshot:
    return HealthSnapshot(
        lag_blocks=lag_blocks,
        lag_seconds=0,
        indexed_block=1,
        chain_tip=1,
        backfill_complete=True,
        lag_unreliable=unreliable,
        sampled_at=datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
    )


def test_pass_case_day5(fixture_client):
    # Day 5 derived (41, 123, 186, 228) matches observed ETH traits exactly.
    discs = validate_jackpot_01(5, fixture_client, lag_snapshot=_snap())
    assert discs == []


def test_pass_case_day2(fixture_client):
    # Day 2 derived (37, 70, 134, 251) matches observed ETH traits exactly.
    discs = validate_jackpot_01(2, fixture_client, lag_snapshot=_snap())
    assert discs == []


def test_pass_case_day50_subset(fixture_client):
    # Day 50 observed ETH traits are a subset of derived (some quadrants had
    # no ETH winners). Subset -> no extras -> PASS.
    discs = validate_jackpot_01(50, fixture_client, lag_snapshot=_snap())
    assert discs == []


def test_missing_finalword_gap(fixture_client):
    # Day 999 is not in replay_rng fixture -> Info coverage-gap entry.
    discs = validate_jackpot_01(999, fixture_client, lag_snapshot=_snap())
    assert len(discs) == 1
    d = discs[0]
    assert d.severity == "Info"
    assert d.suspected_source == "api"
    assert "missing-finalword" in d.id
    assert d.endpoint == "/replay/rng"


def test_citation_uses_audit_path(fixture_client):
    # Force a discrepancy (missing finalWord) and inspect citation path.
    discs = validate_jackpot_01(999, fixture_client, lag_snapshot=_snap())
    src = discs[0].derivation.sources[0]
    assert src.path.startswith("degenerus-audit/contracts/")
    assert "testing/contracts" not in src.path
    assert "degenerus-contracts/" not in src.path
    assert src.label == "contract"


def test_lag_downgrade_on_missing_finalword(fixture_client):
    # When lag_unreliable, Info stays Info (already lowest); but the flag
    # propagates into sample_context.
    discs = validate_jackpot_01(
        999, fixture_client, lag_snapshot=_snap(lag_blocks=25, unreliable=True)
    )
    assert len(discs) == 1
    assert discs[0].sample_context.lag_unreliable is True
    assert discs[0].sample_context.lag_blocks == 25


def test_hero_candidate_inference(fixture_client, monkeypatch):
    # Inject a synthetic single-quadrant mismatch via monkeypatched
    # get_jackpot_winners. derived Q3 = 228 on day 5; replace observed 228
    # with 230 (same quadrant, symbol 6 < 8) -> hero_candidate Info entry.
    real = fixture_client.get_jackpot_winners(5)
    # mutate a copy
    import copy
    mutated = copy.deepcopy(real)
    # Flip ALL ETH rows' traitId=228 to 230 in quadrant 3 (so 228 fully
    # disappears from observed, simulating hero-override replacement).
    swapped = 0
    for w in mutated["winners"]:
        for row in w["breakdown"]:
            if row.get("awardType") == "eth" and row.get("traitId") == 228:
                row["traitId"] = 230
                swapped += 1
    assert swapped > 0, "setup: expected at least one traitId=228 row to mutate"

    def fake_get_winners(day):
        return mutated if day == 5 else real

    monkeypatch.setattr(fixture_client, "get_jackpot_winners", fake_get_winners)
    discs = validate_jackpot_01(5, fixture_client, lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Info"
    assert "hero-candidate" in discs[0].id
    assert discs[0].suspected_source == "contract"


def test_multi_trait_mismatch_is_major(fixture_client, monkeypatch):
    # Two extras in different quadrants -> Major severity.
    import copy
    real = fixture_client.get_jackpot_winners(5)
    mutated = copy.deepcopy(real)
    # Mutate two ETH rows in different quadrants to bogus out-of-derived traits.
    count = 0
    for w in mutated["winners"]:
        for row in w["breakdown"]:
            if row.get("awardType") != "eth":
                continue
            tid = row.get("traitId")
            if tid == 41:  # Q0 -> flip to 7 (still Q0 but not in derived set)
                row["traitId"] = 7
                count += 1
            elif tid == 123:  # Q1 -> flip to 100 (still Q1, not derived)
                row["traitId"] = 100
                count += 1
            if count >= 2:
                break
        if count >= 2:
            break
    assert count == 2, "setup: expected to mutate two rows"

    def fake_get_winners(day):
        return mutated if day == 5 else real

    monkeypatch.setattr(fixture_client, "get_jackpot_winners", fake_get_winners)
    discs = validate_jackpot_01(5, fixture_client, lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Major"
    assert discs[0].suspected_source == "api"
    # Dual hypothesis required by plan (api primary + contract secondary).
    assert len(discs[0].hypothesis) >= 2


def test_lag_downgrade_on_multi_trait_mismatch(fixture_client, monkeypatch):
    import copy
    real = fixture_client.get_jackpot_winners(5)
    mutated = copy.deepcopy(real)
    count = 0
    for w in mutated["winners"]:
        for row in w["breakdown"]:
            if row.get("awardType") != "eth":
                continue
            tid = row.get("traitId")
            if tid == 41:
                row["traitId"] = 7
                count += 1
            elif tid == 123:
                row["traitId"] = 100
                count += 1
            if count >= 2:
                break
        if count >= 2:
            break

    def fake_get_winners(day):
        return mutated if day == 5 else real

    monkeypatch.setattr(fixture_client, "get_jackpot_winners", fake_get_winners)
    # lag_unreliable -> Major downgraded to Minor
    discs = validate_jackpot_01(
        5, fixture_client, lag_snapshot=_snap(lag_blocks=30, unreliable=True)
    )
    assert len(discs) == 1
    assert discs[0].severity == "Minor"
