"""BURNIE jackpot budget derivation + 75/25 ratio checker.

Contract canonical (``degenerus-audit/contracts/``):

- ``modules/DegenerusGameJackpotModule.sol:1897-1901`` — daily BURNIE budget::

    budget = (levelPrizePool[lvl-1] * PRICE_COIN_UNIT) / (priceWei * 200)

  where ``PRICE_COIN_UNIT = 1000 * 10**18`` (1000 BURNIE in wei-equivalent).

- ``modules/DegenerusGameJackpotModule.sol:594-612, 1684-1711`` — 75/25 split.
  ``FAR_FUTURE_COIN_BPS = 2500`` (25% far-future → ``traitId=null`` center
  diamond; remaining 75% near-future trait-matched).

The absolute budget check requires ``levelPrizePool[lvl-1]`` which is not
exposed by any probed endpoint (see 19-RESEARCH Open Q #1). Validators
fall back to a ratio-only check when the prize-pool figure is missing
and emit a single Info-severity coverage gap entry per day.
"""

from __future__ import annotations

from decimal import Decimal

FAR_FUTURE_COIN_BPS: int = 2500
NEAR_FUTURE_COIN_BPS: int = 10_000 - FAR_FUTURE_COIN_BPS  # 7500
PRICE_COIN_UNIT_WEI: int = 1_000 * 10**18  # 1000 BURNIE in 18-decimal wei


def derive_burnie_budget(level_prize_pool_wei: int, price_wei: int) -> int:
    """Return expected BURNIE budget (in BURNIE wei) for the given level.

    Mirrors the Solidity integer-division at JackpotModule.sol:1897-1901.
    """
    if price_wei <= 0:
        raise ValueError("price_wei must be positive")
    return (int(level_prize_pool_wei) * PRICE_COIN_UNIT_WEI) // (int(price_wei) * 200)


def check_near_far_ratio(
    near_sum_burnie: int,
    far_sum_burnie: int,
    *,
    tol_bps: int = 200,
) -> tuple[bool, Decimal]:
    """Check that ``far / (near + far)`` matches ``FAR_FUTURE_COIN_BPS``.

    ``tol_bps`` is the absolute tolerance in basis points (default 2%).

    Returns ``(within_tolerance, abs_delta)`` where ``abs_delta`` is a
    ``Decimal`` in [0, 1] representing the absolute deviation of the
    observed ``far_ratio`` from the expected 0.25.

    Edge case: both sums zero → ``(True, Decimal(0))``. A caller that
    wants to treat all-zero as a coverage gap should surface that
    separately.
    """
    near = int(near_sum_burnie)
    far = int(far_sum_burnie)
    total = near + far
    if total == 0:
        return (True, Decimal(0))
    far_ratio = Decimal(far) / Decimal(total)
    expected = Decimal(FAR_FUTURE_COIN_BPS) / Decimal(10_000)
    delta = abs(far_ratio - expected)
    tol = Decimal(tol_bps) / Decimal(10_000)
    return (delta <= tol, delta)
