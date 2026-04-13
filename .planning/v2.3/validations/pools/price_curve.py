"""PriceLookupLib.priceForLevel reimplementation.

Canonical source:
    degenerus-audit/contracts/libraries/PriceLookupLib.sol:7-47

Price tier table (per contract):

    Intro overrides (first cycle only):
      levels 0-4   -> 0.01 ETH
      levels 5-9   -> 0.02 ETH

    First full cycle (levels 10-99):
      10-29  -> 0.04 ETH
      30-59  -> 0.08 ETH
      60-89  -> 0.12 ETH
      90-99  -> 0.16 ETH

    Repeating 100-level cycle (levels 100+), cycleOffset = level % 100:
      offset == 0      -> 0.24 ETH  (milestone: 100, 200, ...)
      offset 1..29     -> 0.04 ETH
      offset 30..59    -> 0.08 ETH
      offset 60..89    -> 0.12 ETH
      offset 90..99    -> 0.16 ETH

Returns wei as int (e.g. 0.01 ETH = 10**16).
"""

from __future__ import annotations

ONE_ETH_WEI: int = 10**18


def _eth(numerator: int, denominator: int = 100) -> int:
    # e.g. _eth(1, 100) = 0.01 ETH in wei; exact integer arithmetic
    return ONE_ETH_WEI * numerator // denominator


_PRICE_001 = _eth(1)    # 0.01 ETH
_PRICE_002 = _eth(2)    # 0.02 ETH
_PRICE_004 = _eth(4)    # 0.04 ETH
_PRICE_008 = _eth(8)    # 0.08 ETH
_PRICE_012 = _eth(12)   # 0.12 ETH
_PRICE_016 = _eth(16)   # 0.16 ETH
_PRICE_024 = _eth(24)   # 0.24 ETH


def price_for_level(level: int) -> int:
    """Return the ticket price in wei for ``level``.

    Mirrors ``PriceLookupLib.priceForLevel`` (``uint24 targetLevel``).
    Negative levels raise ``ValueError``.
    """
    if level < 0:
        raise ValueError(f"level must be non-negative uint24, got {level}")

    # Intro tiers (levels 0-9, first cycle only)
    if level < 5:
        return _PRICE_001
    if level < 10:
        return _PRICE_002

    # Levels 10-99 (first full cycle, no intro override)
    if level < 30:
        return _PRICE_004
    if level < 60:
        return _PRICE_008
    if level < 90:
        return _PRICE_012
    if level < 100:
        return _PRICE_016

    # Repeating 100-level cycle, levels 100+
    cycle_offset = level % 100
    if cycle_offset == 0:
        return _PRICE_024
    if cycle_offset < 30:
        return _PRICE_004
    if cycle_offset < 60:
        return _PRICE_008
    if cycle_offset < 90:
        return _PRICE_012
    return _PRICE_016
