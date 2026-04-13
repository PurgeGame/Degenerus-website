"""Phase 20 POOLS validation package.

Public surface:

- ``validations.pools.endpoints.PoolsEndpointClient`` — live|replay HTTP client
- ``validations.pools.price_curve.price_for_level`` — PriceLookupLib.sol reimplementation
- ``validations.pools.sample.SAMPLE_LEVELS`` — derived from jackpot SAMPLE_DAYS_CORE
- ``validations.pools.pools_01.validate_pools_01`` — solvency proxy check
- ``validations.pools.pools_02.validate_pools_02`` — per-level ticket-ETH derivation
- ``validations.pools.source_level_entries.ensure_pools_0{1,2}_coverage_gap_logged`` — idempotent writers
"""

from __future__ import annotations

__all__ = [
    "endpoints",
    "price_curve",
    "sample",
    "pools_01",
    "pools_02",
    "source_level_entries",
]
