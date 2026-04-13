"""Integration tests for validate_jackpot_05 (bonus-roll)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from harness import HealthSnapshot
from validations.jackpot.jackpot_05 import validate_jackpot_05
from validations.jackpot.trait_derivation import expected_bonus_traits


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


def _patched_client(client, *, winners=None, final_word=None):
    class _P:
        mode = client.mode

        def get_jackpot_winners(self, day):
            return winners if winners is not None else client.get_jackpot_winners(day)

        def get_final_word(self, day):
            return final_word if final_word is not None else client.get_final_word(day)

    return _P()


# Known finalWord / bonus traits for synthetic tests (picked so bonus set is stable).
# Any nonzero integer works; we just need bonus_traits derivable.
_SEED_FW = 89465190471039979446259802868242012114733487342851120813281122574671311732704
_BONUS_TRAITS = expected_bonus_traits(_SEED_FW)  # (61, 88, 144, 252) for day 350 seed


def _winner(*, address="0xaaaa", winning_level=110, has_bonus=True, breakdown=None):
    return {
        "address": address,
        "totalEth": "0",
        "ticketCount": 0,
        "coinTotal": "0",
        "hasBonus": has_bonus,
        "winningLevel": winning_level,
        "breakdown": breakdown or [],
    }


def _payload(level, winners):
    return {"day": 999, "level": level, "winners": winners}


def test_bonus_happy_path_no_violation(fixture_client):
    """Bonus winner with BURNIE rows matching bonus traits + null → no violations."""
    bt = _BONUS_TRAITS
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 10, "traitId": bt[0]},
        {"awardType": "burnie", "amount": "1000", "count": 5, "traitId": bt[1]},
        {"awardType": "burnie", "amount": "1000", "count": 8, "traitId": None},
    ]
    payload = _payload(110, [_winner(winning_level=111, breakdown=breakdown)])
    cli = _patched_client(fixture_client, winners=payload, final_word=_SEED_FW)
    discs = validate_jackpot_05(999, cli, lag_snapshot=_snap())
    # No Major; single-level bonus_target_levels; may have Info summary.
    majors = [d for d in discs if d.severity == "Major"]
    assert majors == []
    minors = [d for d in discs if d.severity == "Minor"]
    assert minors == []


def test_bonus_wrong_trait_is_major(fixture_client):
    """BURNIE row with traitId NOT in bonus set → Major."""
    bt = _BONUS_TRAITS
    wrong_tid = next(i for i in range(256) if i not in bt)
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 1, "traitId": wrong_tid},
    ]
    payload = _payload(110, [_winner(breakdown=breakdown)])
    cli = _patched_client(fixture_client, winners=payload, final_word=_SEED_FW)
    discs = validate_jackpot_05(999, cli, lag_snapshot=_snap())
    wt = [d for d in discs if "wrong-bonus-trait" in d.id]
    assert len(wt) == 1
    assert wt[0].severity == "Major"


def test_bonus_single_target_level_enforced(fixture_client):
    """2 distinct winningLevels across bonus winners → Minor."""
    bt = _BONUS_TRAITS
    bd = [{"awardType": "burnie", "amount": "1", "count": 1, "traitId": bt[0]}]
    w1 = _winner(address="0xaa", winning_level=107, breakdown=bd)
    w2 = _winner(address="0xbb", winning_level=110, breakdown=bd)
    payload = _payload(110, [w1, w2])
    cli = _patched_client(fixture_client, winners=payload, final_word=_SEED_FW)
    discs = validate_jackpot_05(999, cli, lag_snapshot=_snap())
    mult = [d for d in discs if "bonus-multiple-levels" in d.id]
    assert len(mult) == 1
    assert mult[0].severity == "Minor"


def test_bonus_hasbonus_without_breakdown(fixture_client):
    """hasBonus=true winner with NO bonus rows → Major."""
    breakdown = [
        # main ETH row with a main trait (not in bonus set) — not a bonus row.
        {"awardType": "eth", "amount": "100", "count": 1, "traitId": 5},
    ]
    payload = _payload(110, [_winner(breakdown=breakdown)])
    cli = _patched_client(fixture_client, winners=payload, final_word=_SEED_FW)
    discs = validate_jackpot_05(999, cli, lag_snapshot=_snap())
    m = [d for d in discs if "hasbonus-without-breakdown" in d.id]
    assert len(m) == 1
    assert m[0].severity == "Major"


def test_bonus_empty_day_info(fixture_client):
    """No hasBonus winners → single Info coverage gap."""
    payload = _payload(110, [_winner(has_bonus=False)])
    cli = _patched_client(fixture_client, winners=payload, final_word=_SEED_FW)
    discs = validate_jackpot_05(999, cli, lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Info"
    assert "no-bonus-winners" in discs[0].id


def test_bonus_per_quadrant_non_negative_and_reconcile(fixture_client):
    """Per-quadrant sums reconcile to bonus breakdown grand total."""
    bt = _BONUS_TRAITS
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 5, "traitId": bt[0]},
        {"awardType": "burnie", "amount": "1000", "count": 5, "traitId": bt[1]},
        {"awardType": "burnie", "amount": "1000", "count": 5, "traitId": bt[2]},
    ]
    payload = _payload(110, [_winner(breakdown=breakdown)])
    cli = _patched_client(fixture_client, winners=payload, final_word=_SEED_FW)
    discs = validate_jackpot_05(999, cli, lag_snapshot=_snap())
    imb = [d for d in discs if "per-quadrant-imbalance" in d.id]
    assert imb == []
    summary = [d for d in discs if "per-quadrant-summary" in d.id]
    assert len(summary) == 1


def test_bonus_finalword_missing_is_info(fixture_client):
    """Missing finalWord → single Info coverage gap."""
    cli = _patched_client(fixture_client, final_word=None, winners=_payload(110, []))

    # Override get_final_word to return None
    class _P2:
        mode = "replay"

        def get_jackpot_winners(self, day):
            return _payload(110, [])

        def get_final_word(self, day):
            return None

    discs = validate_jackpot_05(999, _P2(), lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Info"
    assert "missing-finalword" in discs[0].id


def test_bonus_lag_downgrade(fixture_client):
    """lag_unreliable demotes wrong-trait Major → Minor."""
    bt = _BONUS_TRAITS
    wrong_tid = next(i for i in range(256) if i not in bt)
    breakdown = [
        {"awardType": "burnie", "amount": "1000", "count": 1, "traitId": wrong_tid},
    ]
    payload = _payload(110, [_winner(breakdown=breakdown)])
    cli = _patched_client(fixture_client, winners=payload, final_word=_SEED_FW)
    discs = validate_jackpot_05(
        999, cli, lag_snapshot=_snap(unreliable=True, lag=30)
    )
    wt = [d for d in discs if "wrong-bonus-trait" in d.id]
    assert len(wt) == 1
    assert wt[0].severity == "Minor"


def test_bonus_live_fixture_day_350_trait_derivation_contradiction(fixture_client):
    """Day 350 observed bonus BURNIE traits = {61, 88, 144} all in bonus set.

    Python expected_bonus_traits(day-350 finalWord) = (61, 88, 144, 252).
    Observed BURNIE rows only touch 3 of 4 (no row for quadrant 3 bonus trait).
    That is NOT a contradiction — contract only distributes to quadrants that
    actually have tickets. No Major wrong-trait entry should fire.
    """
    discs = validate_jackpot_05(350, fixture_client, lag_snapshot=_snap())
    wt = [d for d in discs if "wrong-bonus-trait" in d.id]
    # All observed BURNIE bonus traits should match.
    assert wt == [], f"unexpected wrong-bonus-trait: {[d.observed_value for d in wt]}"
