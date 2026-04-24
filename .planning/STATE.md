---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: Player UI
status: roadmap-created
stopped_at: Roadmap created; awaiting /gsd-plan-phase 50
last_updated: "2026-04-23T00:00:00.000Z"
last_activity: 2026-04-23
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23)

**Core value:** Make the on-chain game playable, entertaining, and visually compelling from a browser
**Current focus:** v2.4 Player UI — Phase 50: Route Foundation & Day-Aware Store

## Current Position

Phase: 50 — Route Foundation & Day-Aware Store
Plan: —
Status: Roadmap created; awaiting /gsd-plan-phase 50
Last activity: 2026-04-23 — v2.4 roadmap created (6 phases, 40 requirements mapped)

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 6 (50-55) |
| Phases complete | 0 |
| Plans complete | 0 |
| Requirements covered | 40 / 40 |
| Coverage % | 100% |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Milestone v2.4 framing decisions:

- Brand-new player route, separate from `beta/` (dev panels) and `viewer/` (replay tool)
- Same stack as `beta/` (vanilla ES modules + Custom Elements + Proxy store + GSAP)
- Read-only via player-selector dropdown; no wallet, no contract writes; purchases call sim API
- Frontend-first; backend gaps surface as blocker phases requiring database-repo coordination
- Phase numbering jumps from 23 → 50 to avoid collision with out-of-band commits in git history (`feat(26-XX)`, `feat(32-XX)`, `feat(37-XX)`, `feat(38-XX)`, `feat(39-XX)`, `feat(44-XX)`) from work done in another repo

Roadmap-creation decisions (2026-04-23):

- 6 phases (50-55) chosen; matches the orchestrator's suggested shape with one consolidation
- JACKPOT-01..03 placed in Phase 52 (with TICKETS/PACKS) rather than its own phase, because PACKS-02 (jackpot-win pack reveal) directly reuses the jackpot Roll widget — co-locating avoids a retrofit and is low-cost since JACKPOT-02 explicitly says reuse beta components without rewrite
- INTEG-01 split across Phase 50 (kickoff coordination) and Phase 52 (delivery gate) so the database-repo dependency is surfaced as early as possible rather than discovered when TICKETS/PACKS work begins
- DAY scrubber landed in Phase 50 alongside ROUTE rather than retrofitted later, so every subsequent panel is built day-aware natively (DAY-02 says all panels re-render on day change)
- INTEG-02 and INTEG-03 are gates inside their dependent phases (54, 55) rather than standalone phases — coordination is lightweight ping-and-spec work, not implementation; gating inside the dependent phase ensures the gate check happens at the moment of need

### Pending Todos

None.

### Blockers/Concerns

- P0 backend gap: `/player/{addr}/tickets/by-trait` endpoint required for openable-pack feature; coordination kickoff is Phase 50's INTEG-01 work item; delivery gates Phase 52
- P1 backend gaps: per-player BAF score (gates Phase 54 BAF-01), per-player decimator bucket/payout (gates Phase 55 DECIMATOR-02/03/04), coinflip history (optional, Phase 54)
- Out-of-band post-v2.3 work in git history (phase 26-44 commits, viewer/replay-panel/boons/API migration) was done in another repo and is not formally tracked; may need retrospective documentation before/during this milestone — does NOT block Phase 50 start
- Several uncommitted modifications to beta/, theory/, agents/, and untracked files (ECONOMICS-REFERENCE.md, beta/viewer/api.js, player-archetypes.json, etc.) remain in working tree; not folded into milestone-start commit

## Session Continuity

Last session: 2026-04-23
Stopped at: Roadmap created; awaiting /gsd-plan-phase 50
Next action: `/gsd-plan-phase 50` to decompose Phase 50 (Route Foundation & Day-Aware Store) into executable plans
