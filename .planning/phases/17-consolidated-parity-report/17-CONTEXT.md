# Phase 17: Consolidated Parity Report - Context

**Gathered:** 2026-03-31 (auto mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Merge all parity findings from Phases 15-16 into a single consolidated report. The report must cover all 24 contracts verified, all 24 discrepancies found, and all new/changed mechanics since v2.1. Output is one actionable deliverable with recommendations for paper corrections and new mechanics documentation. No paper edits.

**Inputs:**
- `15-PARITY-NOTES.md`: 13 discrepancies (0 Critical, 4 Major, 4 Minor, 5 Info) across 14 game contracts
- `16-TOKEN-PARITY-NOTES.md`: 9 discrepancies (1 Critical, 1 Major, 3 Minor, 4 Info) across 6 token contracts
- `16-SUPPORT-PARITY-NOTES.md`: 2 discrepancies (1 Critical, 1 Major, 0 Minor, 0 Info) across 4 support contracts

**Totals:** 24 discrepancies (2 Critical, 6 Major, 7 Minor, 9 Info) across 24 contracts.

</domain>

<decisions>
## Implementation Decisions

### Report structure
- **D-01:** Single consolidated file, organized severity-first (Critical, Major, Minor, Info). Retains GM-XX and TS-XX prefixes from source phases.
- **D-02:** Executive summary section at top with: total counts by severity, contracts verified count, coverage statement for VER-01/VER-02.

### Recommendation depth
- **D-03:** Each Critical and Major discrepancy includes brief fix guidance (what the paper should say, not exact prose). Minor and Info discrepancies listed without fix guidance.
- **D-04:** Priority ordering within severity groups: game-theoretically impactful items first.

### New mechanics coverage (OUT-03)
- **D-05:** "New Mechanics Since v2.1" section grouped by contract. Each new function or capability gets a brief description and a recommendation: "Document" (game-theoretically relevant to paper arguments) or "Skip" (implementation detail, not relevant to paper).
- **D-06:** Rationale included for each recommendation so the user can override the judgment.

### Cross-references
- **D-07:** Related findings are cross-referenced with notes. Known clusters: GNRUS omissions (GM-03 + TS-05), recycling bonus conflation (TS-08 + TS-09), stETH description gaps (TS-03 + TS-05).

### Carried forward from Phases 15-16
- **D-08:** Discrepancy format: paper location (section + quote), contract location (file + line), nature of mismatch, severity rating.
- **D-09:** Severity scale: Critical (wrong number/formula), Major (wrong mechanism), Minor (misleading simplification), Info (omission of relevant detail).

### Claude's Discretion
- Internal ordering of discrepancies within severity groups
- Exact wording of fix guidance
- Whether to merge closely related findings or keep them separate
- How to handle the "Known Non-Issues" and "Sections With No Discrepancies" sections from source notes

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source parity notes (primary inputs)
- `.planning/phases/15-game-modules-parity/15-PARITY-NOTES.md` -- Game & Modules: 13 discrepancies (GM-01 to GM-13), verified sections, known non-issues, deferred verifications
- `.planning/phases/16-token-support-systems-parity/16-TOKEN-PARITY-NOTES.md` -- Token contracts: 9 discrepancies (TS-01 to TS-09), changes since v2.1, deferred verifications resolved
- `.planning/phases/16-token-support-systems-parity/16-SUPPORT-PARITY-NOTES.md` -- Support systems: 2 discrepancies (TS-10 to TS-11), changes since v2.1, deferred verification #3 resolved

### Game theory paper (document being verified)
- `theory/index.html` -- The paper all discrepancies reference. Needed for section cross-referencing.

### Project requirements
- `.planning/REQUIREMENTS.md` -- VER-01, VER-02, OUT-01, OUT-03 define what the consolidated report must satisfy

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No code to write in this phase (consolidation/report output only)

### Established Patterns
- Phases 15-16 established the discrepancy format, numbering scheme, severity scale, and section organization. The consolidated report reuses these conventions.
- "Known Non-Issues" sections document items intentionally not flagged (per CLAUDE.md), providing an audit trail.
- "Changes Since v2.1" sections in Phase 16 notes provide the delta tracking data needed for OUT-03.

### Integration Points
- This is the terminal phase of milestone v2.2. The consolidated report is the final deliverable.
- The report will inform future paper editing work (separate milestone).

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- standard consolidation approach matching established patterns.

</specifics>

<deferred>
## Deferred Ideas

None -- analysis stayed within phase scope.

</deferred>

---

*Phase: 17-consolidated-parity-report*
*Context gathered: 2026-03-31*
