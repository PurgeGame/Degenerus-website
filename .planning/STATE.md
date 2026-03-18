---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Game Frontend
status: in-progress
stopped_at: Completed 10-01-PLAN.md
last_updated: "2026-03-18T17:06:56.474Z"
last_activity: 2026-03-18 -- Plan 10-01 complete (Decimator infrastructure)
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 14
  completed_plans: 13
  percent: 93
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-18)

**Core value:** Make the on-chain game playable, entertaining, and visually compelling from a browser
**Current focus:** Phase 10 in progress. Plan 01 (Decimator infrastructure) complete. Next: Plan 02 (Terminal)

## Current Position

Phase: 10 of 11 (Phase 10: Decimator & Terminal)
Plan: 1 of 2
Status: Plan 10-01 complete
Last activity: 2026-03-18 -- Plan 10-01 complete (Decimator infrastructure)

Progress: [█████████░] 93%

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 3min
- Total execution time: 16min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 06-foundation | 3 | 8min | 3min |
| 07-purchasing-core-ui | 2 | 8min | 4min |

*Updated after each plan completion*
| Phase 08 P01 | 3min | 2 tasks | 7 files |
| Phase 08 P02 | 3min | 2 tasks | 5 files |
| Phase 08 P03 | 3min | 2 tasks | 5 files |
| Phase 09 P01 | 5min | 2 tasks | 5 files |
| Phase 09 P02 | 2min | 2 tasks | 6 files |
| Phase 09 P03 | 2min | 2 tasks | 6 files |
| Phase 09 P04 | 1min | 2 tasks | 2 files |
| Phase 10 P01 | 3min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Rebuild from scratch (production-quality target), extracting good patterns from beta/index.html
- ES modules with import map — no bundler, no build step
- Proxy-based reactive store replaces ~45 shared mutable globals in the monolith
- Database API for reads, contract writes direct via ethers.js
- EIP-6963 multi-wallet discovery (not legacy window.ethereum only)
- GSAP 3.14 for timeline animation (coinflip, jackpot, degenerette) — replaces setTimeout chains
- Phase 10 (Decimator) held until late: requires new contract ABI not in beta
- Shallow Proxy on top-level state; nested updates via explicit update(path, value) on raw _state
- CSS organized by concern (base, panels, buttons, forms, tx-status, status-bar) not by component
- esm.sh CDN for all import map entries
- API field normalization at polling layer (rngLockedFlag -> game.rngLocked)
- Auto-reconnect uses silent eth_accounts (no popup), not eth_requestAccounts
- nav.js bridge is additive-only: CustomEvents alongside existing Mint.init()
- sendTx() emits lifecycle events on internal bus, not document CustomEvents
- Custom Element pattern: #unsubs array, subscribe in connectedCallback, cleanup in disconnectedCallback
- Connect prompt is a self-managing Custom Element (not router-managed); keeps wallet state separate from phase routing
- Activity score shows total only in Phase 6; breakdown deferred until per-component contract reads available
- main.js bootstrap sequence: discoverWallets -> initRouter -> checkHealth -> startPolling -> autoReconnect
- Transaction lifecycle events wired to ui.pendingTxs store path for future tx status components
- Purchase business logic (contract calls, price calc, EV indicators) centralized in purchases.js; components never import ethers
- getReadProvider() returns wallet BrowserProvider if connected, else lazily creates JsonRpcProvider from CHAIN.rpcUrl
- User wallet rejections (ACTION_REJECTED / code 4001) silently dismissed from purchase error display
- Deity pricing uses getReadProvider() so it displays before wallet connection
- Symbol grid lazy-loaded on first details open (not page load) to avoid 32 unnecessary ownerOf RPC calls
- Deity buy button requires both wallet connection AND symbol selection before enabling
- [Phase 08]: Death clock computation is client-side from levelStartTime (no timer polling)
- [Phase 08]: Store coinflip slice added in Plan 01 for Plan 03 reuse
- [Phase 08]: API field mappings use safe fallbacks for graceful degradation when DB API not yet extended
- [Phase 08]: GSAP preloaded on panel mount to avoid first-reveal CDN jank
- [Phase 08]: dailyRng.finalWord not yet in API; jackpot panel gracefully degrades to stats-only display
- [Phase 08]: All traits marked as winners for visual demo until player trait ownership check implemented
- [Phase 08]: Contract reads used for all player coinflip data (stake, claimable, auto-rebuy) instead of API endpoints
- [Phase 08]: Bounty state from contract public getters; record holder address left as null until DB endpoint available
- [Phase 08]: Coinflip business logic centralized in coinflip.js mirroring purchases.js pattern
- [Phase 09]: Parse BetPlaced events by topic hash from all receipt logs (delegatecall emits from GAME address)
- [Phase 09]: VRF-pending bets persisted in localStorage keyed by player address with betId+rngIndex pairs
- [Phase 09]: Store extended with 5 Phase 9 slices (degenerette, quest, claims, affiliate, baf) in Plan 01
- [Phase 09]: GSAP preloaded on degenerette panel mount (same pattern as jackpot panel)
- [Phase 09]: Quest progress uses different calc paths for mint quests (count) vs token quests (amount)
- [Phase 09]: Claims panel subscribes to ui.connectionState for button disable states
- [Phase 09]: Shield count read from player.shields (API-polled) not separate contract read
- [Phase 09]: Affiliate module owns URL referral capture (replaces purchases.js getAffiliateCode pattern)
- [Phase 09]: BAF leaderboard from DB API only (bafTotals mapping is private, no contract reads needed)
- [Phase 10]: Burn pool computed client-side as futurepool share (10% x5, 30% x00) via futurePrizePoolTotalView
- [Phase 10]: DecBurnRecorded event parsed from receipt logs for immediate burn total/bucket UI update
- [Phase 10]: Terminal store slice pre-populated in Plan 01 for Plan 02 reuse

### Pending Todos

None.

### Blockers/Concerns

- Database API not yet tested (separate repo at /home/zak/Dev/PurgeGame/database/)
- Decimator contract ABI now integrated in beta (DECIMATOR_ABI, DECIMATOR_VIEW_ABI, DECIMATOR_CLAIM_ABI in constants.js)
- VRF callback timing on Sepolia needs observed measurements before finalizing UX thresholds
- ES modules require a dev server (file:// will not work); document python3 -m http.server 8080 on day one

## Session Continuity

Last session: 2026-03-18T17:06:01Z
Stopped at: Completed 10-01-PLAN.md
Resume file: None
