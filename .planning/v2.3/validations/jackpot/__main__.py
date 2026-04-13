"""Phase 19 jackpot validation entry point.

Usage (live mode required)::

    RUN_LIVE_VALIDATION=1 python -m validations.jackpot --jackpot-01

Without the env var, prints instructions and exits 0 (safe no-op).
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

from harness import append_discrepancy, check_api_health

from validations.jackpot.endpoints import EndpointClient
from validations.jackpot.jackpot_01 import validate_jackpot_01
from validations.jackpot.sample_days import SAMPLE_DAYS_CORE


_DISCREPANCIES_PATH = ".planning/v2.3/discrepancies.yaml"


def _run_jackpot_01() -> int:
    snapshot = check_api_health()
    client = EndpointClient(mode="live")
    counts: Counter[str] = Counter()

    for day, _level_expected, _stratum, _why in SAMPLE_DAYS_CORE:
        entries = validate_jackpot_01(day, client, lag_snapshot=snapshot)
        if not entries:
            counts["pass"] += 1
            continue
        for entry in entries:
            counts[entry.severity.lower()] += 1
            append_discrepancy(_DISCREPANCIES_PATH, entry)

    print(
        "JACKPOT-01 summary: "
        f"pass={counts['pass']} "
        f"info={counts['info']} "
        f"minor={counts['minor']} "
        f"major={counts['major']} "
        f"critical={counts['critical']}"
    )
    print(f"lag_blocks={snapshot.lag_blocks} unreliable={snapshot.lag_unreliable}")
    return 0


def _instructions() -> int:
    print("RUN_LIVE_VALIDATION=1 not set; no network calls made.", file=sys.stderr)
    print(
        "To execute against localhost:3000:\n"
        "  RUN_LIVE_VALIDATION=1 python -m validations.jackpot --jackpot-01",
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
        "--all",
        action="store_true",
        help="Run all JACKPOT validators (19-01 only has -01 wired).",
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

    if args.jackpot_01 or args.all:
        return _run_jackpot_01()

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
