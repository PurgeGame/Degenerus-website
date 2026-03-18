---
phase: 09-supporting-features
plan: 02
subsystem: ui
tags: [quests, claims, ethers, custom-elements, progress-bars]

# Dependency graph
requires:
  - phase: 09-supporting-features/01
    provides: "Store slices (quest, claims), ABIs (QUEST_ABI, CLAIMS_ABI), contract addresses"
  - phase: 08-game-features
    provides: "Custom Element patterns, business logic module pattern, coinflip.js as template"
provides:
  - "Quest tracking module with contract reads and progress formatting"
  - "Quest panel Custom Element with progress bars and streak display"
  - "Unified claims module with ETH sentinel handling and BURNIE coinflip reads"
  - "Claims panel Custom Element with separate claim buttons"
affects: [09-supporting-features]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Quest progress percentage calculation (mint count vs token amount quest types)"
    - "1-wei sentinel subtraction for ETH claimable reads"
    - "Promise.allSettled for multi-contract resilient reads"

key-files:
  created:
    - beta/app/quests.js
    - beta/components/quest-panel.js
    - beta/styles/quests.css
    - beta/app/claims.js
    - beta/components/claims-panel.js
    - beta/styles/claims.css
  modified: []

key-decisions:
  - "Quest progress uses different calculation paths for mint quests (count) vs token quests (amount)"
  - "Checkmark indicator on quest-type text via CSS ::after pseudo-element (not separate DOM node)"
  - "Claims panel subscribes to ui.connectionState for button disable states (not just player.address)"

patterns-established:
  - "Contextual panel visibility: quest panel hides via hidden attribute when no quest slots active"
  - "Separate claim buttons per contract (ETH from GAME, BURNIE from COINFLIP) with independent disable states"

requirements-completed: [QUEST-01, QUEST-02, QUEST-03, CLAIM-01, CLAIM-02]

# Metrics
duration: 2min
completed: 2026-03-18
---

# Phase 9 Plan 02: Quests and Claims Summary

**Quest tracking with contract-read progress bars and unified claims panel with 1-wei sentinel ETH + BURNIE coinflip aggregation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-18T16:21:59Z
- **Completed:** 2026-03-18T16:24:33Z
- **Tasks:** 2
- **Files created:** 6

## Accomplishments
- Quest panel reads getPlayerQuestView from contract, displays two daily slots with progress bars, streak counter, and shield count
- Slot 0 visually distinguished as primary prerequisite with accent border and "Primary:" prefix
- Claims module aggregates ETH (game contract, sentinel-adjusted) and BURNIE (coinflip contract) into unified panel
- Separate claim buttons with proper disable states (wallet disconnected, zero balance, during tx)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create quests business logic, component, and CSS** - `2c0f3bf` (feat)
2. **Task 2: Create claims business logic, component, and CSS** - `8e24768` (feat)

## Files Created/Modified
- `beta/app/quests.js` - Quest state reads from contract, progress formatting, quest type labels
- `beta/components/quest-panel.js` - Custom Element showing quest slots, progress bars, streak display
- `beta/styles/quests.css` - Styling for quest slots, progress bars, streak counter
- `beta/app/claims.js` - Unified claim aggregation (ETH + BURNIE) and claim transactions
- `beta/components/claims-panel.js` - Custom Element with claim buttons and aggregated totals
- `beta/styles/claims.css` - Styling for claims panel, claim buttons, amount displays

## Decisions Made
- Quest progress uses different calculation paths for mint quests (count-based) vs token quests (amount-based), matching contract struct semantics
- Checkmark indicator placed via CSS ::after on quest-type span rather than a separate DOM element
- Claims panel subscribes to ui.connectionState in addition to player.address for reliable button disable states
- Shield count read from player.shields (API-polled) rather than adding another contract read

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Quest and claims panels ready for integration into page layout
- Affiliate and BAF panels (Plan 03-04) can proceed independently
- Claims module reusable by any future component needing claimable amount display

## Self-Check: PASSED

All 6 created files verified on disk. Both task commits (2c0f3bf, 8e24768) verified in git log.

---
*Phase: 09-supporting-features*
*Completed: 2026-03-18*
