"""POOLS-03 validator: drip + graduated-extraction coverage gap + source drift.

POOLS-03 is UNOBSERVABLE from the live API this milestone:
- prize_pools is a singleton row; no day-over-day snapshots.
- No events exposed (FutureTakeApplied, DripApplied) via /replay routes.

The deliverable is two idempotent YAML entries:
- POOLS-03-coverage-gap-no-day-over-day-pool-state (Info): unblock hypothesis.
- POOLS-03-source-doc-turbo-drift (Minor): REQUIREMENTS.md says "graduated
  extraction 30-50%" but audit canonical is `_applyTimeBasedFutureTake`
  U-curve at AdvanceModule.sol:1014-1123.

No in-memory Discrepancy list is returned.
"""

from __future__ import annotations

from typing import Any

from harness import Discrepancy, HealthSnapshot

from validations.pools.source_level_entries import (
    DEFAULT_DISCREPANCIES_PATH,
    ensure_pools_03_coverage_gap_logged,
    ensure_pools_03_source_drift_logged,
)


def validate_pools_03(
    client: Any,
    *,
    lag_snapshot: HealthSnapshot,
    yaml_path: str = DEFAULT_DISCREPANCIES_PATH,
) -> list[Discrepancy]:
    # No in-memory Discrepancy returns — both one-shot writers are idempotent
    # and handle the YAML side directly. validate_pools_03 returning [] is
    # semantically correct for this milestone.
    ensure_pools_03_coverage_gap_logged(yaml_path)
    ensure_pools_03_source_drift_logged(yaml_path)
    return []
