"""Phase 19 jackpot validation entry point.

Usage (live mode required)::

    RUN_LIVE_VALIDATION=1 python -m validations.jackpot --jackpot-01
    RUN_LIVE_VALIDATION=1 python -m validations.jackpot --jackpot-02
    RUN_LIVE_VALIDATION=1 python -m validations.jackpot --jackpot-03
    RUN_LIVE_VALIDATION=1 python -m validations.jackpot --all

Without the env var, prints instructions and exits 0 (safe no-op).
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from typing import Callable

from harness import append_discrepancy, check_api_health

from validations.jackpot.endpoints import EndpointClient
from validations.jackpot.jackpot_01 import validate_jackpot_01
from validations.jackpot.jackpot_02 import validate_jackpot_02
from validations.jackpot.jackpot_03 import (
    ensure_source_level_bound_discrepancy_logged,
    validate_jackpot_03,
)
from validations.jackpot.sample_days import SAMPLE_DAYS_CORE


_DISCREPANCIES_PATH = ".planning/v2.3/discrepancies.yaml"


def _run_validator(
    label: str,
    validator: Callable,
) -> int:
    snapshot = check_api_health()
    client = EndpointClient(mode="live")
    counts: Counter[str] = Counter()

    for day, _level_expected, _stratum, _why in SAMPLE_DAYS_CORE:
        entries = validator(day, client, lag_snapshot=snapshot)
        if not entries:
            counts["pass"] += 1
            continue
        for entry in entries:
            counts[entry.severity.lower()] += 1
            append_discrepancy(_DISCREPANCIES_PATH, entry)

    print(
        f"{label} summary: "
        f"pass={counts['pass']} "
        f"info={counts['info']} "
        f"minor={counts['minor']} "
        f"major={counts['major']} "
        f"critical={counts['critical']}"
    )
    print(f"lag_blocks={snapshot.lag_blocks} unreliable={snapshot.lag_unreliable}")
    return 0


def _run_jackpot_01() -> int:
    return _run_validator("JACKPOT-01", validate_jackpot_01)


def _run_jackpot_02() -> int:
    return _run_validator("JACKPOT-02", validate_jackpot_02)


def _run_jackpot_03() -> int:
    # Ensure the one-shot source-level doc-vs-contract entry is logged
    # before per-day validation runs. Idempotent.
    added = ensure_source_level_bound_discrepancy_logged(_DISCREPANCIES_PATH)
    if added:
        print("JACKPOT-03: appended source-level +4 vs +3 discrepancy (first run)")
    else:
        print("JACKPOT-03: source-level +4 vs +3 discrepancy already present (skipped)")
    return _run_validator("JACKPOT-03", validate_jackpot_03)


def _instructions() -> int:
    print("RUN_LIVE_VALIDATION=1 not set; no network calls made.", file=sys.stderr)
    print(
        "To execute against localhost:3000:\n"
        "  RUN_LIVE_VALIDATION=1 python -m validations.jackpot "
        "[--jackpot-01|--jackpot-02|--jackpot-03|--all]",
        file=sys.stderr,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="validations.jackpot")
    parser.add_argument(
        "--jackpot-01",
        action="store_true",
        help="Run JACKPOT-01 validator over SAMPLE_DAYS_CORE.",
    )
    parser.add_argument(
        "--jackpot-02",
        action="store_true",
        help="Run JACKPOT-02 validator (Roll 1 + aggregation) over SAMPLE_DAYS_CORE.",
    )
    parser.add_argument(
        "--jackpot-03",
        action="store_true",
        help="Run JACKPOT-03 validator (Roll 2 near/far) over SAMPLE_DAYS_CORE.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all JACKPOT validators currently wired (01+02+03).",
    )
    parser.add_argument(
        "--record",
        metavar="DAY",
        type=int,
        help="Record live winners fixture for a given day (scaffold).",
    )
    args = parser.parse_args(argv)

    if os.environ.get("RUN_LIVE_VALIDATION") != "1":
        return _instructions()

    if args.record is not None:
        from validations.jackpot.endpoints import EndpointClient
        from validations.jackpot.fixtures_io import record_fixture

        day = args.record
        client = EndpointClient(mode="live")
        payload = client.get_jackpot_winners(day)
        path = record_fixture(f"day-{day}-winners.json", payload, overwrite=True)
        print(f"recorded: {path}")
        return 0

    rc = 0
    if args.jackpot_01 or args.all:
        rc = _run_jackpot_01() or rc
    if args.jackpot_02 or args.all:
        rc = _run_jackpot_02() or rc
    if args.jackpot_03 or args.all:
        rc = _run_jackpot_03() or rc

    if not any([args.jackpot_01, args.jackpot_02, args.jackpot_03, args.all]):
        parser.print_help()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
