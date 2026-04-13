"""Integration tests for validate_jackpot_02 (Roll 1 + aggregation).

All tests use EndpointClient(mode="replay") plus synthetic fixtures
constructed in-process via monkeypatch (so we don't litter fixtures/api/
with 'clean' variants).
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone

import pytest

from harness import HealthSnapshot
from validations.jackpot.aggregation import (
    reconcile_player_totals,
    day_level_eth_sum,
)
from validations.jackpot.jackpot_02 import validate_jackpot_02


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


def _fill_source_level(roll_payload, source_level):
    """Return a deep-copied roll payload with all ETH wins' sourceLevel set."""
    p = copy.deepcopy(roll_payload)
    for w in p["wins"]:
        if w.get("awardType") == "eth":
            w["sourceLevel"] = source_level
    return p


def _patched_client(client, winners=None, roll1=None, roll2=None, roll2_404=False):
    """Return a client-like object with overridden get_* methods."""

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


def test_roll1_pass_with_sourcelevel_filled(fixture_client):
    """Clean pass: fill sourceLevel to match purchaseLevel on day 5."""
    r1 = fixture_client.get_roll1(5)
    r2 = fixture_client.get_roll2(5)
    w = fixture_client.get_jackpot_winners(5)
    r1_clean = _fill_source_level(r1, r1["purchaseLevel"])
    cli = _patched_client(fixture_client, winners=w, roll1=r1_clean, roll2=r2)

    discs = validate_jackpot_02(5, cli, lag_snapshot=_snap())
    # Should be empty: classification clean, aggregation exact, no nulls.
    assert discs == [], f"expected PASS, got: {[(d.id, d.severity) for d in discs]}"


def test_roll1_misclassification_major(fixture_client):
    """Flip one sourceLevel to purchaseLevel+2 → Major misclassification."""
    r1 = _fill_source_level(fixture_client.get_roll1(5), 4)
    # Find first ETH win and set sourceLevel=6 (not equal to purchaseLevel=4).
    for w in r1["wins"]:
        if w.get("awardType") == "eth":
            w["sourceLevel"] = 6
            break
    w_payload = fixture_client.get_jackpot_winners(5)
    r2 = fixture_client.get_roll2(5)
    cli = _patched_client(fixture_client, winners=w_payload, roll1=r1, roll2=r2)

    discs = validate_jackpot_02(5, cli, lag_snapshot=_snap())
    mis = [d for d in discs if "misclassified" in d.id]
    assert len(mis) == 1
    assert mis[0].severity == "Major"
    assert mis[0].suspected_source == "api"


def test_roll1_aggregation_mismatch_critical(fixture_client):
    """Bump one winner's totalEth by 1 wei → Critical aggregation mismatch."""
    r1_clean = _fill_source_level(fixture_client.get_roll1(5), 4)
    r2 = fixture_client.get_roll2(5)
    w_payload = copy.deepcopy(fixture_client.get_jackpot_winners(5))
    # Find a winner with non-zero totalEth and add 1 wei
    for winner in w_payload["winners"]:
        if int(winner["totalEth"]) > 0:
            winner["totalEth"] = str(int(winner["totalEth"]) + 1)
            break
    cli = _patched_client(fixture_client, winners=w_payload, roll1=r1_clean, roll2=r2)

    discs = validate_jackpot_02(5, cli, lag_snapshot=_snap())
    agg = [d for d in discs if "aggregation-mismatch" in d.id]
    assert len(agg) == 1
    assert agg[0].severity == "Critical"


def test_roll1_virtual_deity_tolerated(fixture_client):
    """Sentinel ticketIndex excluded from sum; emits Info note, no mismatch."""
    r1 = _fill_source_level(fixture_client.get_roll1(5), 4)
    # Insert a synthetic virtual-deity ETH win (sentinel ticketIndex).
    sentinel = (1 << 256) - 1
    r1["wins"].insert(
        0,
        {
            "winner": "0xdeadbeef00000000000000000000000000000001",
            "awardType": "eth",
            "traitId": 41,
            "quadrant": 0,
            "amount": "999000000000000000",  # would break sums if counted
            "level": r1["purchaseLevel"],
            "sourceLevel": r1["purchaseLevel"],
            "ticketIndex": sentinel,
        },
    )
    r2 = fixture_client.get_roll2(5)
    w = fixture_client.get_jackpot_winners(5)
    cli = _patched_client(fixture_client, winners=w, roll1=r1, roll2=r2)

    discs = validate_jackpot_02(5, cli, lag_snapshot=_snap())
    # No aggregation mismatch: sentinel excluded.
    assert not any("aggregation-mismatch" in d.id for d in discs)
    assert any("sentinel-ticketindex" in d.id for d in discs)


def test_roll1_null_purchaselevel_post_gameover(fixture_client):
    """Day 762 has purchaseLevel=null → Info coverage gap, no violation."""
    discs = validate_jackpot_02(762, fixture_client, lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Info"
    assert "null-purchaselevel" in discs[0].id


def test_lag_downgrade_on_aggregation_mismatch(fixture_client):
    """lag_unreliable demotes Critical → Major."""
    r1_clean = _fill_source_level(fixture_client.get_roll1(5), 4)
    r2 = fixture_client.get_roll2(5)
    w_payload = copy.deepcopy(fixture_client.get_jackpot_winners(5))
    for winner in w_payload["winners"]:
        if int(winner["totalEth"]) > 0:
            winner["totalEth"] = str(int(winner["totalEth"]) + 1)
            break
    cli = _patched_client(fixture_client, winners=w_payload, roll1=r1_clean, roll2=r2)

    discs = validate_jackpot_02(
        5, cli, lag_snapshot=_snap(unreliable=True, lag=30)
    )
    agg = [d for d in discs if "aggregation-mismatch" in d.id]
    assert len(agg) == 1
    assert agg[0].severity == "Major"  # downgraded


# -- aggregation helper unit tests -------------------------------------------


def test_reconcile_player_totals_clean(fixture_client):
    """Real day-5 fixtures reconcile exactly against winners.totalEth."""
    w = fixture_client.get_jackpot_winners(5)
    r1 = fixture_client.get_roll1(5)
    r2 = fixture_client.get_roll2(5)  # all burnie -> no ETH rows added
    recon = reconcile_player_totals(w, r1, r2)
    assert recon.issues == []


def test_whale_pass_and_dgnrs_excluded_from_sums(fixture_client):
    """Rows with awardType in {whale_pass, dgnrs} are not counted as ETH."""
    # Inject a whale_pass with amount=huge; should not affect sums.
    r1 = copy.deepcopy(fixture_client.get_roll1(5))
    # Pick the first real winner address to ensure it WAS already in winners.
    target = r1["wins"][0]["winner"]
    r1["wins"].append(
        {
            "winner": target,
            "awardType": "whale_pass",
            "traitId": None,
            "quadrant": -1,
            "amount": str(10**24),  # nonsense wei equivalent
            "level": r1["purchaseLevel"],
            "sourceLevel": r1["purchaseLevel"],
            "ticketIndex": 999,
        }
    )
    w = fixture_client.get_jackpot_winners(5)
    r2 = fixture_client.get_roll2(5)
    recon = reconcile_player_totals(w, r1, r2)
    assert recon.issues == []  # whale_pass ignored; sum unchanged


def test_day_level_eth_sum_integer(fixture_client):
    """Smoke: day_level_eth_sum returns an int and matches sum of breakdowns."""
    w = fixture_client.get_jackpot_winners(5)
    total = day_level_eth_sum(w)
    assert isinstance(total, int)
    expected = sum(int(x["totalEth"]) for x in w["winners"])
    assert total == expected
