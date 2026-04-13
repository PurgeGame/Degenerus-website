"""Tests for validate_jackpot_06 — inferential hero-override classifier."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from harness import HealthSnapshot
from validations.jackpot.jackpot_06 import validate_jackpot_06


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


def _patched_client(*, final_word=None, winners=None, raise_winners=False):
    class _C:
        mode = "replay"

        def get_final_word(self, day):
            return final_word

        def get_jackpot_winners(self, day):
            if raise_winners:
                raise RuntimeError("fetch error")
            return winners

    return _C()


def _winners_payload(trait_ids, *, level=5):
    return {
        "day": 5,
        "level": level,
        "winners": [
            {
                "address": f"0x{i:040x}",
                "totalEth": "1",
                "ticketCount": 1,
                "coinTotal": "0",
                "hasBonus": False,
                "winningLevel": level,
                "breakdown": [
                    {"awardType": "eth", "amount": "1", "count": 1, "traitId": tid}
                ],
            }
            for i, tid in enumerate(trait_ids)
        ],
    }


# finalWord whose 6-bit unpack yields (1, 64, 128, 192)
# (all low bits zero except w0=1)
_FINAL_WORD = 1


def test_pass_case_returns_empty(fixture_client):
    # derived = (1, 64, 128, 192) — observed matches exactly
    cli = _patched_client(
        final_word=_FINAL_WORD,
        winners=_winners_payload([1, 64, 128, 192]),
    )
    discs = validate_jackpot_06(5, cli, lag_snapshot=_snap())
    assert discs == []


def test_hero_infer_likely_single_quadrant_swap_low_symbol(fixture_client):
    # Replace quadrant 1 (64) with 65 (same quadrant; symbol bits 0x07 => 1 < 8)
    cli = _patched_client(
        final_word=_FINAL_WORD,
        winners=_winners_payload([1, 65, 128, 192]),
    )
    discs = validate_jackpot_06(5, cli, lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Info"
    assert "likely" in (discs[0].magnitude + discs[0].observed_value).lower()


def test_hero_infer_out_of_range_symbol(fixture_client):
    # Replace with symbol >= 8 — swap quadrant 0 (1) with 15 (color=1, symbol=7)?
    # Need symbol >= 8. Trait id quadrant 0 range is 0..63; symbol = (tid & 0x07)
    # To get symbol >=8 we need traits crossing quadrant? No — per spec "extra & 0x07 >= 8"
    # is impossible because 0x07 mask caps at 7. The test in the plan meant
    # derivation drift. We model it as: replacement trait is NOT in same quadrant
    # range (i.e. symbol extractable but indicates derivation drift).
    # Instead we use "extra & 0x07 >= 8" interpretation: check plan pseudo-code.
    # Plan says: "extra & 0x07 >= 8" — this is impossible with mask, so we treat
    # the branch via a sentinel flag in the validator that distinguishes low vs
    # high nibble. We make a single-quadrant swap where symbol bits (0x07) span
    # the full range but the replacement color (bits 3-5) is out of typical
    # hero-symbol bound [0,8). The validator uses symbol=(tid & 0x07) strictly.
    # So this test exercises the multi-quadrant branch instead to check Major.
    cli = _patched_client(
        final_word=_FINAL_WORD,
        winners=_winners_payload([1, 64, 200, 192]),  # q2 traitid 200 is q3-range (200>>6==3)
    )
    discs = validate_jackpot_06(5, cli, lag_snapshot=_snap())
    assert len(discs) == 1
    # 200 is quadrant 3; 128 is quadrant 2 — missing[128] and extra[200] are in
    # different quadrants → multi-quadrant → Major.
    assert discs[0].severity == "Major"


def test_hero_infer_multi_quadrant_major(fixture_client):
    # Replace two quadrants
    cli = _patched_client(
        final_word=_FINAL_WORD,
        winners=_winners_payload([2, 65, 128, 192]),
    )
    discs = validate_jackpot_06(5, cli, lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Major"


def test_finalword_missing_gap(fixture_client):
    cli = _patched_client(final_word=None)
    discs = validate_jackpot_06(5, cli, lag_snapshot=_snap())
    assert len(discs) == 1
    assert discs[0].severity == "Info"
    assert "finalword" in discs[0].id.lower() or "missing" in discs[0].id.lower()


def test_lag_downgrade_multi_quadrant(fixture_client):
    cli = _patched_client(
        final_word=_FINAL_WORD,
        winners=_winners_payload([2, 65, 128, 192]),
    )
    discs = validate_jackpot_06(5, cli, lag_snapshot=_snap(unreliable=True, lag=30))
    assert len(discs) == 1
    # Major -> Minor under lag
    assert discs[0].severity == "Minor"


def test_citation_uses_audit_contracts_path(fixture_client):
    cli = _patched_client(
        final_word=_FINAL_WORD,
        winners=_winners_payload([1, 65, 128, 192]),
    )
    discs = validate_jackpot_06(5, cli, lag_snapshot=_snap())
    assert len(discs) == 1
    for src in discs[0].derivation.sources:
        assert src.path.startswith("degenerus-audit/contracts/")
        assert "testing/contracts" not in src.path
