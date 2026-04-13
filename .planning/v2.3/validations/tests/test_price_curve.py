"""Tests for price_curve.price_for_level — mirrors PriceLookupLib.sol:21-46 exactly.

Source: degenerus-audit/contracts/libraries/PriceLookupLib.sol
"""

from __future__ import annotations

import pytest

from validations.pools.price_curve import ONE_ETH_WEI, price_for_level


def _eth(frac: float) -> int:
    # exact wei for simple fractional ETH values used in the price table
    # frac values are always 0.01, 0.02, 0.04, 0.08, 0.12, 0.16, 0.24
    return int(round(frac * ONE_ETH_WEI))


def test_price_level_0():
    assert price_for_level(0) == _eth(0.01)


def test_price_level_1():
    assert price_for_level(1) == _eth(0.01)


def test_price_level_10():
    assert price_for_level(10) == _eth(0.04)


@pytest.mark.parametrize(
    "level,expected",
    [
        (0, 0.01),
        (4, 0.01),
        (5, 0.02),
        (9, 0.02),
        (10, 0.04),
        (19, 0.04),
        (20, 0.04),
        (29, 0.04),
        (30, 0.08),
        (39, 0.08),
        (40, 0.08),
        (49, 0.08),
        (50, 0.08),
        (59, 0.08),
        (60, 0.12),
        (69, 0.12),
        (70, 0.12),
        (79, 0.12),
        (80, 0.12),
        (89, 0.12),
        (90, 0.16),
        (98, 0.16),
    ],
)
def test_price_decade_boundaries(level, expected):
    assert price_for_level(level) == _eth(expected)


def test_price_x99():
    assert price_for_level(99) == _eth(0.16)


def test_price_x00_reset():
    # Level 100 is a milestone at 0.24 ETH per PriceLookupLib.sol:35
    assert price_for_level(100) == _eth(0.24)


def test_price_level_105():
    # cycleOffset = 5; x01-x29 -> 0.04 (intro-tier override only applies to first cycle)
    assert price_for_level(105) == _eth(0.04)


def test_price_high_level():
    # level 199: cycleOffset 99 -> 0.16 ETH
    assert price_for_level(199) == _eth(0.16)
    assert price_for_level(200) == _eth(0.24)


def test_price_negative_raises():
    with pytest.raises(ValueError):
        price_for_level(-1)
