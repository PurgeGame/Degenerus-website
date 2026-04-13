"""Harness CLI.

Subcommands (flags):
  --render                         YAML -> markdown. No network required.
  --smoke                          Live end-to-end smoke. Requires RUN_LIVE_SMOKE=1.
  --dump-constants                 Print the constant registry as JSON.
  --dump-archetypes                Print archetype profiles as JSON.
  --derive --level --day --archetype --regime
                                   Print expected_values(...) fields as JSON.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from harness import (
    Discrepancy,
    append_discrepancy,
    check_api_health,
    expected_values,
    render_report,
)
from harness.archetypes import ARCHETYPES
from harness.constants import CONSTANTS
from harness.yaml_io import _resolve_repo_root


def _default_yaml_path() -> Path:
    return _resolve_repo_root() / ".planning" / "v2.3" / "discrepancies.yaml"


def _default_report_path() -> Path:
    return _resolve_repo_root() / ".planning" / "v2.3" / "reports" / "v2.3-consolidated.md"


def _cmd_render(args) -> int:
    yaml_path = Path(args.yaml) if args.yaml else _default_yaml_path()
    report_path = Path(args.out) if args.out else _default_report_path()
    md = render_report(yaml_path, report_path)
    print(f"Wrote {len(md)} bytes to {report_path}")
    return 0


def _cmd_smoke(args) -> int:
    if os.environ.get("RUN_LIVE_SMOKE") != "1":
        print(
            "Live smoke gated by RUN_LIVE_SMOKE=1; refusing to hit network.",
            file=sys.stderr,
        )
        return 2
    snap = check_api_health()
    print(f"Health: lagBlocks={snap.lag_blocks} lag_unreliable={snap.lag_unreliable}")
    yaml_path = _default_yaml_path()
    report_path = _default_report_path()
    render_report(yaml_path, report_path)
    print(f"Rendered report -> {report_path}")
    return 0


def _cmd_dump_constants(_args) -> int:
    out = {
        name: {
            "value": c.value,
            "unit": c.unit,
            "citation": {
                "path": c.citation.path,
                "line": c.citation.line,
                "label": c.citation.label,
                "anchor": c.citation.anchor,
            },
            "notes": c.notes,
        }
        for name, c in CONSTANTS.items()
    }
    print(json.dumps(out, indent=2, default=str))
    return 0


def _cmd_dump_archetypes(_args) -> int:
    out = {
        name: {
            "activity_floor": p.activity_floor,
            "primary_products": list(p.primary_products),
            "deity_eligible": p.deity_eligible,
            "notes": p.notes,
        }
        for name, p in ARCHETYPES.items()
    }
    print(json.dumps(out, indent=2))
    return 0


def _cmd_derive(args) -> int:
    ev = expected_values(
        level=args.level,
        day=args.day,
        archetype=args.archetype,
        velocity_regime=args.regime,
    )
    out = {
        "level": ev.level,
        "day": ev.day,
        "archetype": ev.archetype,
        "velocity_regime": ev.velocity_regime,
        "fields": {
            name: {
                "value": f.value,
                "unit": f.unit,
                "formula": f.formula,
                "citations": [
                    {"path": c.path, "line": c.line, "label": c.label, "anchor": c.anchor}
                    for c in f.citations
                ],
                "regime": f.regime,
                "notes": f.notes,
            }
            for name, f in ev.fields.items()
        },
    }
    print(json.dumps(out, indent=2, default=str))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m harness")
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--dump-constants", action="store_true")
    parser.add_argument("--dump-archetypes", action="store_true")
    parser.add_argument("--derive", action="store_true")
    parser.add_argument("--yaml", default=None)
    parser.add_argument("--out", default=None)
    parser.add_argument("--level", type=int, default=1)
    parser.add_argument("--day", type=int, default=1)
    parser.add_argument("--archetype", default="Grinder")
    parser.add_argument("--regime", default="fast")
    args = parser.parse_args(argv)

    if args.render:
        return _cmd_render(args)
    if args.smoke:
        return _cmd_smoke(args)
    if args.dump_constants:
        return _cmd_dump_constants(args)
    if args.dump_archetypes:
        return _cmd_dump_archetypes(args)
    if args.derive:
        return _cmd_derive(args)
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
