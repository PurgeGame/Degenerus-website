"""Wave-0 unit tests for trait derivation.

Validates the pure-Python 6-bit unpack against canonical contract source:
    degenerus-audit/contracts/libraries/JackpotBucketLib.sol:281-286

Anchor case verified live 2026-04-13 against /replay/rng + /winners day 5.
"""

from __future__ import annotations

import pytest

from validations.jackpot.trait_derivation import (
    expected_main_traits,
    expected_bonus_traits,
    quadrant_of,
    BONUS_TRAITS_TAG,
)


def test_expected_main_traits_zero():
    assert expected_main_traits(0) == (0, 64, 128, 192)


def test_expected_main_traits_max_low_byte():
    # Only low 6 bits set
    assert expected_main_traits(0x3F) == (0x3F, 64, 128, 192)


def test_expected_main_traits_all_bits():
    fw = (0x3F) | (0x3F << 6) | (0x3F << 12) | (0x3F << 18)
    assert expected_main_traits(fw) == (63, 127, 191, 255)


def test_expected_main_traits_anchor_day5():
    # Anchor: live-probed 2026-04-13 from localhost:3000.
    # /replay/rng day=5 finalWord; /winners day=5 ETH-awardType distinct traitIds.
    final_word = 78876953128644738606731190515926498480697010828548805564574921227867119660777
    assert expected_main_traits(final_word) == (41, 123, 186, 228)


def test_expected_main_traits_anchor_day2():
    # Anchor: live-probed 2026-04-13 (day 2).
    final_word = 58615017776385672140688052813858375738404390856096961285912761980916800971173
    assert expected_main_traits(final_word) == (37, 70, 134, 251)


def test_quadrant_of():
    assert quadrant_of(0) == 0
    assert quadrant_of(63) == 0
    assert quadrant_of(64) == 1
    assert quadrant_of(127) == 1
    assert quadrant_of(128) == 2
    assert quadrant_of(192) == 3
    assert quadrant_of(255) == 3


def test_expected_bonus_traits_differs_from_main():
    # With non-trivial entropy, bonus traits are keccak-salted and
    # should not accidentally coincide with main traits.
    fw = (0x3F) | (0x3F << 6) | (0x3F << 12) | (0x3F << 18)
    main = expected_main_traits(fw)
    bonus = expected_bonus_traits(fw)
    assert main != bonus


def test_bonus_traits_tag_is_keccak_of_literal():
    # BONUS_TRAITS_TAG = keccak256("BONUS_TRAITS")
    # Per JackpotModule.sol:164.
    expected_hex = "d86e8c3e7b3a4d64935adc5692dc4348c12ce9cda6f2b5550894d9d166883683"
    assert BONUS_TRAITS_TAG.hex() == expected_hex


def test_expected_bonus_traits_quadrant_ranges():
    # Regardless of finalWord, bonus traits must still land in quadrant ranges.
    for fw in (0, 1, 0xFFFFFFFF, 12345678901234567890):
        b = expected_bonus_traits(fw)
        assert 0 <= b[0] <= 63
        assert 64 <= b[1] <= 127
        assert 128 <= b[2] <= 191
        assert 192 <= b[3] <= 255
