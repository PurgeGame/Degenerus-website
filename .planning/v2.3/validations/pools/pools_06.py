"""POOLS-06 validator: segregated accumulator coverage gap.

POOLS-06 is UNOBSERVABLE this milestone:

- No /game/accumulator endpoint (404).
- No accumulator field on /tokens/analytics.
- No accumulator schema table.

Deliverable: one idempotent coverage-gap Info entry.

No proxy check is available (unlike POOLS-05, which has stEthReserve as a
weak signal). validate_pools_06 always returns [].
"""

from __future__ import annotations

from typing import Any

from harness import Discrepancy, HealthSnapshot

from validations.pools.source_level_entries import (
    DEFAULT_DISCREPANCIES_PATH,
    ensure_pools_06_coverage_gap_logged,
)


def validate_pools_06(
    client: Any,
    *,
    lag_snapshot: HealthSnapshot,
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> list[Discrepancy]:
    ensure_pools_06_coverage_gap_logged(yaml_path)
    return []
