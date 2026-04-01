# Phase 17: Consolidated Parity Report - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 17-consolidated-parity-report
**Areas discussed:** Report structure, Recommendation depth, New mechanics coverage, Cross-references
**Mode:** Auto (all defaults selected)

---

## Report Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Severity-first, single file | Critical items at top, GM/TS prefixes retained | [auto] |
| By paper section order | Follows the paper's narrative flow | |
| Multiple files + summary | Keep per-group files, add executive summary | |

**User's choice:** [auto] Severity-first, single file (recommended default)
**Notes:** Most actionable for scanning and prioritizing fixes.

---

## Recommendation Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal (just list) | Discrepancies + new mechanics list only | |
| Full fix text | Suggested replacement prose for each discrepancy | |
| Brief guidance for Critical/Major | Priority ordering + what paper should say, not exact prose | [auto] |

**User's choice:** [auto] Brief guidance for Critical/Major (recommended default)
**Notes:** User edits papers themselves per CLAUDE.md. Enough direction to act without prescribing exact wording.

---

## New Mechanics Coverage (OUT-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Simple yes/no list | Each function with Document/Skip verdict | |
| Grouped with rationale | By contract, with brief reasoning for each recommendation | [auto] |

**User's choice:** [auto] Grouped with rationale (recommended default)
**Notes:** More useful context for user's decision on what to add to the paper.

---

## Cross-References

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone findings | Each finding independent, no linking | |
| Cross-referenced clusters | Notes linking related findings across phases | [auto] |

**User's choice:** [auto] Cross-referenced clusters (recommended default)
**Notes:** Known clusters: GNRUS omissions, recycling bonus conflation, stETH description gaps.

---

## Claude's Discretion

- Internal ordering within severity groups
- Exact wording of fix guidance
- Whether to merge closely related findings
- Handling of "Known Non-Issues" and clean sections from source notes

## Deferred Ideas

None -- analysis stayed within phase scope.
