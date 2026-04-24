---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: Player UI
status: defining-requirements
stopped_at: Milestone summary approved; defining requirements
last_updated: "2026-04-23T00:00:00.000Z"
last_activity: 2026-04-23
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23)

**Core value:** Make the on-chain game playable, entertaining, and visually compelling from a browser
**Current focus:** Defining requirements for v2.4 Player UI

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-23 — v2.4 milestone started

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Milestone v2.4 framing decisions:

- Brand-new player route, separate from `beta/` (dev panels) and `viewer/` (replay tool)
- Same stack as `beta/` (vanilla ES modules + Custom Elements + Proxy store + GSAP)
- Read-only via player-selector dropdown; no wallet, no contract writes; purchases call sim API
- Frontend-first; backend gaps surface as blocker phases requiring database-repo coordination
- Phase numbering continues from v2.3 (ended at 23) — v2.4 starts at Phase 24

### Pending Todos

None.

### Blockers/Concerns

- P0 backend gap: `/player/{addr}/tickets/by-trait` endpoint required for openable-pack feature; coordinate with database repo
- P1 backend gaps: per-player BAF score, per-player decimator bucket/payout, coinflip history
- Out-of-band post-v2.3 work in git history (phases 26-44 commits, viewer/replay-panel/boons/API migration) was done in another repo and is not formally tracked; may need retrospective documentation before/during this milestone
- Several uncommitted modifications to beta/, theory/, agents/, and untracked files (ECONOMICS-REFERENCE.md, beta/viewer/api.js, player-archetypes.json, etc.) remain in working tree; not folded into milestone-start commit

## Session Continuity

Last session: 2026-04-23
Stopped at: Milestone summary approved; defining requirements
