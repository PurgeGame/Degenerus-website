---
phase: 13-contract-mechanic-extraction
plan: 01
subsystem: documentation
tags: [solidity, contracts, delegatecall, catalog, mechanic-extraction]

# Dependency graph
requires:
  - phase: none
    provides: none
provides:
  - "Catalog of DegenerusGame.sol delegatecall dispatch map (30 mappings)"
  - "Catalog of 6 smaller modules: BoonModule, EndgameModule, GameOverModule, MintStreakUtils, PayoutUtils, WhaleModule"
  - "154 function table entries across 7 contracts"
affects: [13-02, 14-gap-analysis]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Contract:function notation for grep-friendly cross-referencing"]

key-files:
  created:
    - ".planning/phases/13-contract-mechanic-extraction/catalog/EXTR-01-game-and-modules.md"
  modified: []

key-decisions:
  - "Documented all 54 view functions as a separate table (not mixed with player-facing/system tables) for clarity"
  - "Grouped internal helpers under their parent public function descriptions rather than giving standalone entries"
  - "Included auto-rebuy/afKing mechanics as key DegenerusGame.sol mechanics since they are direct implementations, not delegated"

patterns-established:
  - "Consistent table format: Function | Visibility | Parameters | What It Does | Key Effects (player-facing) or Function | Visibility | Called By | What It Does (system/internal)"
  - "Key Mechanics (non-function) bullet list for state-machine behaviors and constants per module"
  - "Module header format: Lines | Delegatecall from | Purpose"

requirements-completed: []

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 13 Plan 01: DegenerusGame.sol and 6 Smaller Modules Catalog Summary

**Complete delegatecall dispatch map (30 external-to-module mappings) plus function catalogs for DegenerusGame.sol direct implementations and 6 smaller game modules with 154 total table entries**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-19T02:00:35Z
- **Completed:** 2026-03-19T02:05:37Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Documented the complete delegatecall dispatch map showing which of 30 external functions route to which of 9 module types
- Cataloged all direct implementations on DegenerusGame.sol: 9 player-facing functions, 22 system/internal functions, 54 view functions
- Cataloged 6 smaller modules with consistent format: BoonModule (5 functions, 10 boon types), EndgameModule (7 functions, BAF/Decimator jackpots), GameOverModule (3 functions, terminal distribution), MintStreakUtils (2 streak helpers), PayoutUtils (3 payout utilities), WhaleModule (13 functions, 3 pass types)
- Documented key non-function mechanics: FSM states, activity score components, auto-rebuy/afKing system, prize pool split ratios, boon expiry system

## Task Commits

Each task was committed atomically:

1. **Task 1: Catalog DegenerusGame.sol dispatcher and 6 smaller modules** - `f56cd93` (feat)

## Files Created/Modified

- `.planning/phases/13-contract-mechanic-extraction/catalog/EXTR-01-game-and-modules.md` - Catalog of DegenerusGame.sol (main dispatcher) + BoonModule, EndgameModule, GameOverModule, MintStreakUtils, PayoutUtils, WhaleModule

## Decisions Made

- Documented all 54 view functions as a flat table rather than categorizing by subsystem, since the view functions serve as the primary UI interface and grouping them aids frontend development
- Grouped internal helpers under their parent public function descriptions per plan guidance, avoiding catalog bloat
- Included auto-rebuy, afKing, and operator approval mechanics under DegenerusGame.sol direct implementations since these are not delegated to any module

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Catalog Part 1 complete. Plan 02 will add the 6 larger modules (AdvanceModule, DecimatorModule, DegeneretteModule, JackpotModule, LootboxModule, MintModule) to complete EXTR-01.
- Format and conventions established in this plan should be maintained in Plan 02.

---
*Phase: 13-contract-mechanic-extraction*
*Completed: 2026-03-19*
