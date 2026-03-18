---
phase: 06-foundation
plan: 02
subsystem: api, wallet, contracts
tags: [fetch, polling, ethers, eip-6963, metamask, wallet, backoff, customevent]

requires:
  - phase: 06-01
    provides: "Reactive store (store.js), event bus (events.js), constants (constants.js)"
provides:
  - "REST client with polling and exponential backoff (api.js)"
  - "Contract interaction with receipt.status verification (contracts.js)"
  - "EIP-6963 multi-wallet discovery with MetaMask fallback (wallet.js)"
  - "CustomEvent bridge between nav.js IIFE and ES module architecture"
affects: [06-03, 07-game-state, 08-actions, 09-coinflip, 10-decimator]

tech-stack:
  added: [ethers.js (via import map)]
  patterns: [polling-with-backoff, sendTx-receipt-verification, eip6963-discovery, customevent-bridge]

key-files:
  created:
    - beta/app/api.js
    - beta/app/contracts.js
    - beta/app/wallet.js
  modified:
    - shared/nav.js

key-decisions:
  - "API field normalization: rngLockedFlag -> game.rngLocked, prizePools.futurePrizePool -> game.pools.future"
  - "Auto-reconnect uses eth_accounts (silent) not eth_requestAccounts (popup)"
  - "nav.js bridge is additive-only: CustomEvents dispatched alongside existing Mint.init() call"

patterns-established:
  - "sendTx() pattern: emit tx:pending -> tx:submitted -> tx:confirmed/tx:reverted/tx:rejected/tx:error"
  - "Polling with backoff: consecutive failure counter, exponential delay 1s-30s cap, stale indicator at 3 failures"
  - "Wallet connection flow: discoverWallets() -> connectWallet() -> store update -> player data fetch"
  - "visibilitychange re-fetch: immediate poll when tab becomes visible (Chrome background tab workaround)"

requirements-completed: [ARCH-04, ARCH-05, ARCH-07]

duration: 2min
completed: 2026-03-18
---

# Phase 6 Plan 2: API Client, Contracts, Wallet Summary

**REST client with polling/backoff, ethers.js contract wrapper with receipt.status verification, and EIP-6963 multi-wallet discovery with nav.js CustomEvent bridge**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-18T13:58:47Z
- **Completed:** 2026-03-18T14:01:13Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 1

## Accomplishments
- API client polls /game/state (15s) and /player/:address (30s) with exponential backoff capped at 30s and stale data indicator after 3 consecutive failures
- Contract module wraps ethers.js with receipt.status === 0 check (fixing the existing mint.js bug where reverted txs were treated as confirmed)
- EIP-6963 multi-wallet discovery with MetaMask window.ethereum fallback and silent auto-reconnect via localStorage
- nav.js dispatches wallet-connected/wallet-disconnected CustomEvents to bridge the IIFE scope with ES modules

## Task Commits

Each task was committed atomically:

1. **Task 1: Create API client and contract interaction module** - `587d897` (feat)
2. **Task 2: Create wallet module and add CustomEvent bridge to nav.js** - `332f159` (feat)

## Files Created/Modified
- `beta/app/api.js` - REST client with fetchJSON, pollGameState, pollPlayerData, startPolling, stopPolling, refreshAfterAction, visibilitychange handler
- `beta/app/contracts.js` - ethers.js provider/signer management, sendTx with receipt verification, readActivityScore, readEthBalance, checkChain, switchToSepolia
- `beta/app/wallet.js` - EIP-6963 discoverWallets, connectWallet with chain check, disconnectWallet, autoReconnect via silent eth_accounts, accountsChanged/chainChanged listeners
- `shared/nav.js` - Added CustomEvent dispatches for wallet-connected (with address detail) and wallet-disconnected in connectWallet and disconnectWallet functions

## Decisions Made
- API response field normalization happens at the polling layer (api.js maps `rngLockedFlag` to `game.rngLocked`, `prizePools.futurePrizePool` to `game.pools.future`) so the rest of the app uses clean store paths
- Auto-reconnect uses `eth_accounts` (silent, no popup) rather than `eth_requestAccounts`, with a 500ms delay to allow EIP-6963 providers to announce first
- nav.js modifications are strictly additive. The `window.Mint.init()` call is preserved. CustomEvent dispatches are inserted alongside existing code, not replacing it
- Transaction lifecycle uses the internal event bus (events.js `emit`), not document CustomEvents. Keeps contract-level events separate from nav bridge events.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three I/O boundary modules (api.js, contracts.js, wallet.js) ready for Plan 03 app shell integration
- Store, events, constants, API, contracts, and wallet form the complete foundation layer
- nav.js bridge ensures existing pages (whitepaper, degenerette, theory) are unaffected by the new ES module architecture

## Self-Check: PASSED

- All 3 created files exist on disk
- Both task commits (587d897, 332f159) found in git log
- SUMMARY.md created

---
*Phase: 06-foundation*
*Completed: 2026-03-18*
