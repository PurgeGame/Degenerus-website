---
phase: 07-purchasing-core-ui
plan: 01
subsystem: ui
tags: [custom-elements, ethers, purchase, lootbox, activity-score, pool-progress]

# Dependency graph
requires:
  - phase: 06-foundation
    provides: store, contracts.js, sendTx, wallet, events, API polling, CSS system, Custom Element pattern
provides:
  - purchases.js business logic module (ETH/BURNIE ticket/lootbox purchase functions)
  - getReadProvider() for pre-wallet contract reads
  - purchase-panel Custom Element with ETH/BURNIE toggle, qty inputs, pool fill bar, EV indicator
  - tx-status-list Custom Element rendering transaction lifecycle from store
  - purchase.css with pool fill bar, EV badge, error display styles
affects: [07-02-pass-cards, 08-jackpot-display, 09-coinflip-degenerette]

# Tech tracking
tech-stack:
  added: []
  patterns: [purchase business logic separated from components, read-only provider fallback for pre-wallet reads, affiliate code resolution from URL params and localStorage]

key-files:
  created:
    - beta/app/purchases.js
    - beta/components/purchase-panel.js
    - beta/components/tx-status-list.js
    - beta/styles/purchase.css
  modified:
    - beta/app/contracts.js
    - beta/app/main.js
    - beta/index.html

key-decisions:
  - "Business logic (contract calls, price calc, EV indicators) stays in purchases.js; components never import ethers"
  - "getReadProvider() returns wallet provider if connected, else lazily creates JsonRpcProvider from CHAIN.rpcUrl"
  - "Lootbox total calculation uses BigInt string math to avoid floating point precision errors"
  - "User rejections (ACTION_REJECTED / code 4001) are silently ignored in error display"

patterns-established:
  - "Purchase module pattern: thin wrappers around getContract + sendTx + refreshAfterAction"
  - "Read-only provider fallback: getReadProvider() for contract reads before wallet connection"
  - "Affiliate code resolution: URL params -> localStorage -> bytes32 encoding"

requirements-completed: [PURCH-01, PURCH-02, PURCH-03, PURCH-04, PURCH-05]

# Metrics
duration: 4min
completed: 2026-03-18
---

# Phase 7 Plan 01: Purchase Panel Summary

**Purchase panel with ETH/BURNIE toggle, pool fill progress bar, lootbox EV indicator, and tx-status-list component using purchases.js business logic module**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-18T14:36:22Z
- **Completed:** 2026-03-18T14:40:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- purchases.js module with 9 exported functions covering all purchase paths, pool target, EV indicators, and affiliate codes
- getReadProvider() in contracts.js enables contract reads before wallet connection
- purchase-panel Custom Element with ETH/BURNIE toggle, ticket quantity +/- buttons, lootbox input, pool fill bar, EV badge, and error display
- tx-status-list Custom Element renders pending/confirmed/failed transactions with etherscan hash links
- Both components wired into index.html and main.js bootstrap

## Task Commits

Each task was committed atomically:

1. **Task 1: Create purchases.js business logic and getReadProvider** - `5fb3b11` (feat)
2. **Task 2: Create purchase-panel, tx-status-list components, CSS, and wire to page** - `17da444` (feat)

## Files Created/Modified
- `beta/app/purchases.js` - Purchase business logic: ETH/BURNIE buy functions, pool target, EV calc, affiliate code
- `beta/app/contracts.js` - Added getReadProvider() for pre-wallet read-only contract access
- `beta/components/purchase-panel.js` - Purchase panel Custom Element with ETH/BURNIE toggle, pool fill, EV indicator
- `beta/components/tx-status-list.js` - Transaction status list Custom Element subscribing to ui.pendingTxs
- `beta/styles/purchase.css` - Pool fill bar, EV badges, purchase row layout, error display styles
- `beta/app/main.js` - Added purchase-panel and tx-status-list component imports
- `beta/index.html` - Added purchase.css link, purchase-panel and tx-status-list elements in purchase panel div

## Decisions Made
- Business logic (contract calls, price calculations, EV indicators) centralized in purchases.js. Components never import ethers directly.
- getReadProvider() prioritizes wallet BrowserProvider when connected, falls back to public Sepolia RPC for pre-wallet reads.
- Lootbox ETH input parsed via BigInt string splitting rather than parseFloat to avoid floating point precision errors in total calculation.
- User wallet rejections (ACTION_REJECTED / code 4001) silently dismissed from error display since they are intentional user actions, not errors.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Purchase panel foundation complete, ready for Plan 02 (pass cards)
- getReadProvider() available for any component needing pre-wallet contract reads (deity symbol availability, pass pricing)
- purchases.js pattern established for extending with whale/lazy/deity pass purchase functions

## Self-Check: PASSED

All 7 created/modified files verified on disk. Both task commits (5fb3b11, 17da444) found in git history.

---
*Phase: 07-purchasing-core-ui*
*Completed: 2026-03-18*
