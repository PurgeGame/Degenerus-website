---
phase: 10-decimator-terminal
plan: 01
subsystem: ui
tags: [decimator, burnie, ethers, custom-elements, contract-writes]

# Dependency graph
requires:
  - phase: 06-foundation
    provides: "store.js reactive proxy, contracts.js sendTx/getReadProvider, constants.js pattern"
  - phase: 08-advanced-game-interactions
    provides: "coinflip.js business logic pattern, coinflip-panel.js component pattern"
provides:
  - "decimator.js business logic module (burn writes, state reads, bucket/multiplier helpers)"
  - "decimator-panel.js conditional Custom Element"
  - "decimator.css panel styles"
  - "DECIMATOR_ABI, DECIMATOR_VIEW_ABI, DECIMATOR_CLAIM_ABI constants"
  - "decimator and terminal store slices in store.js"
affects: [10-02-terminal, 11-polish]

# Tech tracking
tech-stack:
  added: []
  patterns: [decimator-burn-event-parsing, futurepool-share-computation]

key-files:
  created:
    - beta/app/decimator.js
    - beta/components/decimator-panel.js
    - beta/styles/decimator.css
  modified:
    - beta/app/constants.js
    - beta/app/store.js

key-decisions:
  - "Burn pool computed client-side as futurepool share (10% x5, 30% x00) via futurePrizePoolTotalView"
  - "DecBurnRecorded event parsed from receipt logs for immediate UI update of burn total and bucket"
  - "Terminal store slice pre-populated for Plan 02 reuse"

patterns-established:
  - "Decimator event parsing: match by topic hash across all receipt.logs (delegatecall pattern)"
  - "Burn pool display: derived from futurepool contract read, not separate endpoint"

requirements-completed: [DECI-01, DECI-02, DECI-03]

# Metrics
duration: 3min
completed: 2026-03-18
---

# Phase 10 Plan 01: Decimator Infrastructure Summary

**Decimator burn subsystem with COIN contract writes, futurepool-derived jackpot pool display, activity-score bucket/multiplier computation, and conditional panel visibility**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-18T17:02:27Z
- **Completed:** 2026-03-18T17:06:01Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Decimator business logic module with burn writes targeting COIN contract, state reads via getReadProvider, and pure bucket/multiplier helpers
- Conditional decimator panel component that shows only when dec window is open, with 4-stat info row (jackpot pool, bucket, multiplier, burns)
- All ABI constants (write, view, claim) and DECIMATOR config with pool share percentages
- Store extended with decimator slice (including burnPool) and terminal slice for Plan 02

## Task Commits

Each task was committed atomically:

1. **Task 1: Add store slices, ABI constants, and decimator business logic** - `26138cb` (feat)
2. **Task 2: Create decimator panel component and CSS** - `04118d6` (feat)

## Files Created/Modified
- `beta/app/decimator.js` - Decimator burn write, state read, claim, bucket/multiplier pure helpers
- `beta/components/decimator-panel.js` - Conditional Custom Element with burn input, 4-stat display, claim section
- `beta/styles/decimator.css` - Grid layout, window badge, responsive breakpoints
- `beta/app/constants.js` - DECIMATOR_ABI, DECIMATOR_VIEW_ABI, DECIMATOR_CLAIM_ABI, DECIMATOR config object
- `beta/app/store.js` - decimator and terminal store slices

## Decisions Made
- Burn pool computed client-side as a percentage of futurepool (10% for x5 levels, 30% for x00) using futurePrizePoolTotalView contract read, since total burns across buckets is not publicly readable from contract
- DecBurnRecorded event parsed from transaction receipt logs for immediate client-side update of player burn total and bucket assignment, following the same delegatecall topic-hash matching pattern established in degenerette.js
- Terminal store slice added alongside decimator slice to avoid a second store.js modification in Plan 02

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Decimator infrastructure complete; Plan 02 (terminal decimator, insurance bar, GAMEOVER panel) can proceed
- Terminal store slice already in place
- DECIMATOR_VIEW_ABI and DECIMATOR_CLAIM_ABI include terminal-specific functions (terminalDecWindow, terminalDecClaimable, claimTerminalDecimatorJackpot)

## Self-Check: PASSED

- All 3 created files exist on disk
- Both task commits (26138cb, 04118d6) found in git log

---
*Phase: 10-decimator-terminal*
*Completed: 2026-03-18*
