"""YAML discrepancy ledger -> consolidated markdown report.

``render_report(yaml_path, output_path)`` reads discrepancies via
``yaml_io.load_discrepancies`` (SafeLoader + path guard) and writes a
markdown file grouped by domain with a severity + domain summary table
at the top.

Empty ledger produces a skeleton report stating "No discrepancies
recorded". This makes the renderer exercisable before phases 19-22
append anything.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Iterable

from harness.schema import Citation, Discrepancy
from harness import yaml_io


DOMAINS = ("JACKPOT", "POOLS", "PLAYER", "TERMINAL")
SEVERITIES = ("Critical", "Major", "Minor", "Info")


def _fmt_citation(c: Citation) -> str:
    if c.line is not None:
        return f"`{c.path}:{c.line}`"
    if c.anchor:
        return f"`{c.path}#{c.anchor}`"
    return f"`{c.path}`"


def _render_entry(d: Discrepancy) -> str:
    cites = ", ".join(_fmt_citation(c) for c in d.derivation.sources)
    hypos = "\n".join(
        f"  - {h.text} _(falsifiable by: {h.falsifiable_by})_"
        for h in d.hypothesis
    )
    notes_line = f"\n- **Notes:** {d.notes}" if d.notes else ""
    archetype = d.sample_context.archetype or "—"
    return (
        f"### {d.id} — {d.severity}\n"
        f"\n"
        f"- **Endpoint:** `{d.endpoint}`\n"
        f"- **Expected:** {d.expected_value}\n"
        f"- **Observed:** {d.observed_value}\n"
        f"- **Magnitude:** {d.magnitude}\n"
        f"- **Suspected source:** `{d.suspected_source}`\n"
        f"- **Derivation:** {d.derivation.formula}\n"
        f"- **Sources:** {cites}\n"
        f"- **Sample context:** day={d.sample_context.day}, level={d.sample_context.level}, "
        f"archetype={archetype}, lag_blocks={d.sample_context.lag_blocks}, "
        f"lag_unreliable={d.sample_context.lag_unreliable}, "
        f"sampled_at={d.sample_context.sampled_at}\n"
        f"- **Hypotheses:**\n{hypos}"
        f"{notes_line}\n"
    )


def _render_summary(items: list[Discrepancy]) -> str:
    sev_counts = Counter(d.severity for d in items)
    dom_counts = Counter(d.domain for d in items)
    lines = ["## Summary", "", f"**Total discrepancies:** {len(items)}", ""]
    lines.append("| Severity | Count |")
    lines.append("|---|---|")
    for s in SEVERITIES:
        lines.append(f"| {s} | {sev_counts.get(s, 0)} |")
    lines.append("")
    lines.append("| Domain | Count |")
    lines.append("|---|---|")
    for d in DOMAINS:
        lines.append(f"| {d} | {dom_counts.get(d, 0)} |")
    lines.append("")
    return "\n".join(lines)


def render_report(yaml_path: str | Path, output_path: str | Path) -> str:
    """Render the discrepancy ledger at ``yaml_path`` to markdown at ``output_path``.

    Returns the markdown string written.
    """
    items = yaml_io.load_discrepancies(yaml_path)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    parts: list[str] = ["# v2.3 Validation Report", ""]

    if not items:
        parts.append("## Summary")
        parts.append("")
        parts.append("No discrepancies recorded.")
        parts.append("")
        parts.append(
            "_The renderer produced this skeleton from an empty ledger. "
            "Phases 19-22 append entries to `discrepancies.yaml`._"
        )
        parts.append("")
        md = "\n".join(parts)
        out.write_text(md)
        return md

    parts.append(_render_summary(items))
    parts.append("## Discrepancies by Domain")
    parts.append("")

    # Group by domain, then sort by severity rank within domain
    sev_rank = {s: i for i, s in enumerate(SEVERITIES)}
    for domain in DOMAINS:
        in_domain = sorted(
            [d for d in items if d.domain == domain],
            key=lambda d: (sev_rank.get(d.severity, 99), d.id),
        )
        if not in_domain:
            continue
        parts.append(f"### Domain: {domain}")
        parts.append("")
        for entry in in_domain:
            parts.append(_render_entry(entry))
            parts.append("")

    md = "\n".join(parts)
    out.write_text(md)
    return md
