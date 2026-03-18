---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Game Frontend
status: in-progress
stopped_at: Completed 07-01-PLAN.md
last_updated: "2026-03-18T14:41:00.000Z"
last_activity: 2026-03-18 -- Plan 07-01 complete (purchase panel, tx-status-list, purchases.js)
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 5
  completed_plans: 4
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-18)

**Core value:** Make the on-chain game playable, entertaining, and visually compelling from a browser
**Current focus:** Phase 7 — Purchasing Core UI (purchase panel, tx status, pass cards)

## Current Position

Phase: 7 of 11 (Phase 7: Purchasing Core UI)
Plan: 1 of 2
Status: Plan 07-01 complete
Last activity: 2026-03-18 -- Plan 07-01 complete (purchase panel, tx-status-list, purchases.js)

Progress: [████████░░] 80%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 3min
- Total execution time: 12min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 06-foundation | 3 | 8min | 3min |
| 07-purchasing-core-ui | 1 | 4min | 4min |

*Updated after each plan completion*

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

### Pending Todos

None.

### Blockers/Concerns

- Database API not yet tested (separate repo at /home/zak/Dev/PurgeGame/database/)
- Decimator contract ABI not integrated in beta — needs mapping before Phase 10 planning
- VRF callback timing on Sepolia needs observed measurements before finalizing UX thresholds
- ES modules require a dev server (file:// will not work); document python3 -m http.server 8080 on day one

## Session Continuity

Last session: 2026-03-18T14:41:00Z
Stopped at: Completed 07-01-PLAN.md
Resume file: .planning/phases/07-purchasing-core-ui/07-02-PLAN.md
