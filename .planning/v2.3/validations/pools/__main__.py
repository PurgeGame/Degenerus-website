"""Phase 20 POOLS validation entry point.

Usage (live mode required)::

    RUN_LIVE_VALIDATION=1 python -m validations.pools --pools-01
    RUN_LIVE_VALIDATION=1 python -m validations.pools --pools-07
    RUN_LIVE_VALIDATION=1 python -m validations.pools --all

Without the env var, prints instructions and exits 0.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

from harness import HealthSnapshot, append_discrepancy, load_discrepancies
from harness.yaml_io import _resolve_repo_root

from validations.pools.endpoints import PoolsEndpointClient, run_with_health_check
from validations.pools.pools_01 import validate_pools_01
from validations.pools.pools_02 import validate_pools_02
from validations.pools.pools_03 import validate_pools_03
from validations.pools.pools_04 import validate_pools_04
from validations.pools.pools_05 import validate_pools_05
from validations.pools.pools_06 import validate_pools_06
from validations.pools.pools_07 import validate_pools_07
from validations.pools.sample import SAMPLE_LEVELS
from validations.pools.source_level_entries import (
    POOLS_01_COVERAGE_GAP_ID,
    POOLS_02_COVERAGE_GAP_ID,
    POOLS_03_COVERAGE_GAP_ID,
    POOLS_03_SOURCE_DRIFT_ID,
    POOLS_04_COVERAGE_GAP_ID,
    POOLS_05_COVERAGE_GAP_ID,
    POOLS_06_COVERAGE_GAP_ID,
    POOLS_07_SOURCE_DRIFT_ID,
)


_DISCREPANCIES_PATH = str(
    _resolve_repo_root() / ".planning" / "v2.3" / "discrepancies.yaml"
)


_FIXED_IDS = (
    POOLS_01_COVERAGE_GAP_ID,
    POOLS_02_COVERAGE_GAP_ID,
    POOLS_03_COVERAGE_GAP_ID,
    POOLS_03_SOURCE_DRIFT_ID,
    POOLS_04_COVERAGE_GAP_ID,
    POOLS_05_COVERAGE_GAP_ID,
    POOLS_06_COVERAGE_GAP_ID,
    POOLS_07_SOURCE_DRIFT_ID,
)


def _coverage_gap_counts(before: list, after: list) -> dict[str, str]:
    before_ids = {d.id for d in before}
    after_ids = {d.id for d in after}
    out: dict[str, str] = {}
    for gid in _FIXED_IDS:
        if gid in before_ids:
            out[gid] = "already present"
        elif gid in after_ids:
            out[gid] = "newly logged"
        else:
            out[gid] = "not logged"
    return out


def _instructions() -> int:
    print("RUN_LIVE_VALIDATION=1 not set; no network calls made.", file=sys.stderr)
    print(
        "To execute against localhost:3000:\n"
        "  RUN_LIVE_VALIDATION=1 python -m validations.pools "
        "[--pools-01|--pools-02|--pools-03|--pools-04|"
        "--pools-05|--pools-06|--pools-07|--all]",
        file=sys.stderr,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="validations.pools")
    parser.add_argument("--pools-01", action="store_true")
    parser.add_argument("--pools-02", action="store_true")
    parser.add_argument("--pools-03", action="store_true")
    parser.add_argument("--pools-04", action="store_true")
    parser.add_argument("--pools-05", action="store_true")
    parser.add_argument("--pools-06", action="store_true")
    parser.add_argument("--pools-07", action="store_true")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args(argv)

    if os.environ.get("RUN_LIVE_VALIDATION") != "1":
        return _instructions()

    any_flag = (
        args.pools_01 or args.pools_02 or args.pools_03 or args.pools_04
        or args.pools_05 or args.pools_06 or args.pools_07 or args.all
    )
    if not any_flag:
        parser.print_help()
        return 0

    before = load_discrepancies(_DISCREPANCIES_PATH)

    def batch(snapshot: HealthSnapshot):
        client = PoolsEndpointClient(mode="live")
        counts: Counter[str] = Counter()
        if args.pools_01 or args.all:
            for entry in validate_pools_01(
                client, lag_snapshot=snapshot, yaml_path=_DISCREPANCIES_PATH
            ):
                counts[entry.severity.lower()] += 1
                append_discrepancy(_DISCREPANCIES_PATH, entry)
        if args.pools_02 or args.all:
            for entry in validate_pools_02(
                client,
                sample_levels=SAMPLE_LEVELS,
                lag_snapshot=snapshot,
                yaml_path=_DISCREPANCIES_PATH,
            ):
                counts[entry.severity.lower()] += 1
                append_discrepancy(_DISCREPANCIES_PATH, entry)
        if args.pools_03 or args.all:
            for entry in validate_pools_03(
                client, lag_snapshot=snapshot, yaml_path=_DISCREPANCIES_PATH
            ):
                counts[entry.severity.lower()] += 1
                append_discrepancy(_DISCREPANCIES_PATH, entry)
        if args.pools_04 or args.all:
            for entry in validate_pools_04(
                client, lag_snapshot=snapshot, yaml_path=_DISCREPANCIES_PATH
            ):
                counts[entry.severity.lower()] += 1
                append_discrepancy(_DISCREPANCIES_PATH, entry)
        if args.pools_05 or args.all:
            for entry in validate_pools_05(
                client, lag_snapshot=snapshot, yaml_path=_DISCREPANCIES_PATH
            ):
                counts[entry.severity.lower()] += 1
                append_discrepancy(_DISCREPANCIES_PATH, entry)
        if args.pools_06 or args.all:
            for entry in validate_pools_06(
                client, lag_snapshot=snapshot, yaml_path=_DISCREPANCIES_PATH
            ):
                counts[entry.severity.lower()] += 1
                append_discrepancy(_DISCREPANCIES_PATH, entry)
        if args.pools_07 or args.all:
            for entry in validate_pools_07(
                client, lag_snapshot=snapshot, yaml_path=_DISCREPANCIES_PATH
            ):
                counts[entry.severity.lower()] += 1
                append_discrepancy(_DISCREPANCIES_PATH, entry)
        return counts

    snapshot, counts = run_with_health_check(batch)
    after = load_discrepancies(_DISCREPANCIES_PATH)

    print(
        f"POOLS summary: "
        f"info={counts['info']} minor={counts['minor']} "
        f"major={counts['major']} critical={counts['critical']}"
    )
    print(f"lag_blocks={snapshot.lag_blocks} unreliable={snapshot.lag_unreliable}")
    for gid, state in _coverage_gap_counts(before, after).items():
        print(f"  {gid}: {state}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
