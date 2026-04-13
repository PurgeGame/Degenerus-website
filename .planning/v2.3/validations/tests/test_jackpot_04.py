"""Integration tests for validate_jackpot_04 (BURNIE 75/25 + center-diamond)."""

from __future__ import annotations

import copy
from datetime import datetime, timezone

import pytest

from harness import HealthSnapshot
from validations.jackpot.burnie_budget import (
    FAR_FUTURE_COIN_BPS,
    PRICE_COIN_UNIT_WEI,
    check_near_far_ratio,
    derive_burnie_budget,
)
from validations.jackpot.jackpot_04 import validate_jackpot_04


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


def _patched_client(client, *, winners=None):
    class _P:
        mode = client.mode

        def get_jackpot_winners(self, day):
            return winners if winners is not None else client.get_jackpot_winners(day)

    return _P()


def _synth_winner(winning_level, breakdown):
    return {
        "address": "0x1111111111111111111111111111111111111111",
        "totalEth": "0",
        "ticketCount": 0,
        "coinTotal": "0",
        "hasBonus": False,
        "winningLevel": winning_level,
        "breakdown": breakdown,
    }


def _synth_winners_payload(level, winners):
    return {"day": 999, "level": level, "winners": winners}


# ---------------------------------------------------------------------------
# burnie_budget.py unit coverage
# ---------------------------------------------------------------------------


def test_derive_burnie_budget_matches_formula():
    # budget = (pool * 1000e18) / (priceWei * 200)
    pool = 10 * 10**18  # 10 ETH
    price = 4 * 10**16  # 0.04 ETH per ticket
    got = derive_burnie_budget(pool, price)
    expected = (pool * PRICE_COIN_UNIT_WEI) // (price * 200)
    assert got == expected > 0


def test_check_near_far_ratio_exact_25():
    ok, delta = check_near_far_ratio(750, 250)
    assert ok and delta == 0


def test_check_near_far_ratio_zero_zero_ok():
    ok, delta = check_near_far_ratio(0, 0)
    assert ok and delta == 0


# ---------------------------------------------------------------------------
# validate_jackpot_04
# ---------------------------------------------------------------------------


def test_burnie_7525_split_silent_pass(fixture_client):
    """Exact 75/25 (delta<=1%) → only the coverage-gap entry logged."""
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 75, "traitId": 41},
        {"awardType": "burnie", "amount": "1000", "count": 25, "traitId": None},
    ]
    w = [_synth_winner(5, breakdown)]
    payload = _synth_winners_payload(5, w)
    cli = _patched_client(fixture_client, winners=payload)
    discs = validate_jackpot_04(5, cli, lag_snapshot=_snap())
    # No ratio-drift, no ratio-info, no center-diamond entry. Only the
    # per-day levelPrizePool coverage gap (Info).
    ids = [d.id for d in discs]
    assert any("level-prize-pool-unavailable" in i for i in ids)
    assert not any("ratio-drift" in i for i in ids)
    assert not any("ratio-info" in i for i in ids)
    assert not any("center-diamond-shape" in i for i in ids)


def test_burnie_center_diamond_shape_pass_with_winninglevel(fixture_client):
    """traitId=null rows with winnerLevel set → no shape violation."""
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 75, "traitId": 88},
        {"awardType": "burnie", "amount": "1000", "count": 25, "traitId": None},
    ]
    w = [_synth_winner(110, breakdown)]
    payload = _synth_winners_payload(110, w)
    cli = _patched_client(fixture_client, winners=payload)
    discs = validate_jackpot_04(350, cli, lag_snapshot=_snap())
    ids = [d.id for d in discs]
    assert not any("center-diamond-shape" in i for i in ids)


def test_burnie_ratio_drift_minor(fixture_client):
    """far_ratio = 30% (delta=5%) → Minor."""
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 70, "traitId": 41},
        {"awardType": "burnie", "amount": "1000", "count": 30, "traitId": None},
    ]
    w = [_synth_winner(5, breakdown)]
    payload = _synth_winners_payload(5, w)
    cli = _patched_client(fixture_client, winners=payload)
    discs = validate_jackpot_04(5, cli, lag_snapshot=_snap())
    drift = [d for d in discs if "ratio-drift" in d.id]
    assert len(drift) == 1
    assert drift[0].severity == "Minor"


def test_burnie_ratio_drift_major(fixture_client):
    """far_ratio = 31% (delta=6%) → Major."""
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 69, "traitId": 41},
        {"awardType": "burnie", "amount": "1000", "count": 31, "traitId": None},
    ]
    w = [_synth_winner(5, breakdown)]
    payload = _synth_winners_payload(5, w)
    cli = _patched_client(fixture_client, winners=payload)
    discs = validate_jackpot_04(5, cli, lag_snapshot=_snap())
    drift = [d for d in discs if "ratio-drift" in d.id]
    assert len(drift) == 1
    assert drift[0].severity == "Major"


def test_burnie_level_prize_pool_coverage_gap(fixture_client):
    """Every day logs a single levelPrizePool coverage-gap Info entry."""
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 75, "traitId": 41},
        {"awardType": "burnie", "amount": "1000", "count": 25, "traitId": None},
    ]
    w = [_synth_winner(5, breakdown)]
    payload = _synth_winners_payload(5, w)
    cli = _patched_client(fixture_client, winners=payload)
    discs = validate_jackpot_04(5, cli, lag_snapshot=_snap())
    gap = [d for d in discs if "level-prize-pool-unavailable" in d.id]
    assert len(gap) == 1
    assert gap[0].severity == "Info"


def test_burnie_empty_day_info(fixture_client):
    """No BURNIE rows → single Info, no coverage-gap entry appended."""
    payload = _synth_winners_payload(5, [_synth_winner(5, [])])
    cli = _patched_client(fixture_client, winners=payload)
    discs = validate_jackpot_04(5, cli, lag_snapshot=_snap())
    # Only the no-burnie entry; no level-prize-pool entry (short-circuits).
    assert len(discs) == 1
    assert "no-burnie" in discs[0].id
    assert discs[0].severity == "Info"


def test_burnie_invalid_center_diamond_winnerlevel_null(fixture_client):
    """traitId=null with winningLevel=null → Major center-diamond shape."""
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 75, "traitId": 41},
        {"awardType": "burnie", "amount": "1000", "count": 25, "traitId": None},
    ]
    w = [_synth_winner(None, breakdown)]
    payload = _synth_winners_payload(5, w)
    cli = _patched_client(fixture_client, winners=payload)
    discs = validate_jackpot_04(5, cli, lag_snapshot=_snap())
    cd = [d for d in discs if "center-diamond-shape" in d.id]
    assert len(cd) == 1
    assert cd[0].severity == "Major"


def test_burnie_lag_downgrade(fixture_client):
    """lag_unreliable demotes ratio-drift Major → Minor."""
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 69, "traitId": 41},
        {"awardType": "burnie", "amount": "1000", "count": 31, "traitId": None},
    ]
    w = [_synth_winner(5, breakdown)]
    payload = _synth_winners_payload(5, w)
    cli = _patched_client(fixture_client, winners=payload)
    discs = validate_jackpot_04(
        5, cli, lag_snapshot=_snap(unreliable=True, lag=30)
    )
    drift = [d for d in discs if "ratio-drift" in d.id]
    assert len(drift) == 1
    assert drift[0].severity == "Minor"


def test_burnie_live_fixture_day_350_passes(fixture_client):
    """Recorded day-350 fixture: far_ratio is exactly 0.25 (count-weighted)."""
    discs = validate_jackpot_04(350, fixture_client, lag_snapshot=_snap())
    # No ratio-drift, no center-diamond violation.
    drift = [d for d in discs if "ratio-drift" in d.id]
    cd = [d for d in discs if "center-diamond-shape" in d.id]
    assert drift == []
    assert cd == []


def test_burnie_live_fixture_day_500_passes(fixture_client):
    """Recorded day-500 fixture: far_ratio is exactly 0.25 (count-weighted)."""
    discs = validate_jackpot_04(500, fixture_client, lag_snapshot=_snap())
    drift = [d for d in discs if "ratio-drift" in d.id]
    cd = [d for d in discs if "center-diamond-shape" in d.id]
    assert drift == []
    assert cd == []
