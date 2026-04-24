# Phase 53 -- Scope Assessment (Pre-Discuss)

**Author:** Claude (autonomous assessment, 2026-04-24 post-Phase-52)
**Status:** AWAITING USER DECISION
**Goal:** Surface a foundational scope question for Phase 53 before spending cycles on discuss/plan/execute.

## The Gap

Phase 53 Goal (ROADMAP.md line 129): "User can trigger ticket and lootbox purchases for the selected player via the sim API and immediately see the resulting pack appear in inventory."

Milestone-level constraint (REQUIREMENTS.md line 8): "Read-only via player-selector dropdown -- no wallet, no contract writes; purchases call sim API."

**The sim API does not exist as an HTTP service.** The sim repo (`/home/zak/Dev/PurgeGame/degenerus-sim/`) is a batch simulator:

- `src/game/` has internal functions: `decisionPhase`, `executeDecision`, `lootboxOpen`, `mineDay`, `advanceDay`, `runLevel`, `runSimulation`
- No fastify / express / http server code
- `package.json` has only `vitest` scripts -- no dev server
- Players in the sim are archetypes configured in code, not live HTTP clients

The sim CAN perform purchases, but only as part of its batch decisionPhase, not in response to external HTTP requests.

## Why This Matters

Phase 53 has four requirements:

- **PURCHASE-01**: trigger ticket purchase via sim API
- **PURCHASE-02**: trigger lootbox purchase via sim API
- **PURCHASE-03**: show current ticket price, level/cycle, total cost
- **PURCHASE-04**: after purchase, pack appears + state updates

PURCHASE-03 is the only one achievable without a sim HTTP API -- it's a display task hydrating from existing game-state endpoints. The other three require an HTTP path from the browser to the sim contract-call layer.

## Options

### Option A: Build the sim HTTP API

Scope:
- Add fastify server to degenerus-sim/
- Endpoints: `POST /buy-tickets`, `POST /buy-lootbox` (maybe `POST /player/:addr/buy-tickets`)
- Server needs to:
  1. Accept buyer address + ticket quantity + lootbox amount
  2. Construct and sign an anvil tx with a test-account key
  3. Submit to the local anvil instance
  4. Wait for confirmation
  5. Return outcome (success + tx hash + new state)

Blockers to figure out:
- Which test-key signs? Is there a deterministic mapping from "player address" to "anvil account private key"?
- Anvil state management: the database repo indexes a specific anvil chain. The sim needs to write to that same chain. How are they coordinated?
- Error modes: gas, reverts, insufficient balance, level-transition edge cases, RNG-locked windows
- Snapshot / rollback (if we want undo)
- Is this the first write path in v2.4? If so, it creates a new trust boundary -- the sim server is effectively a proxy signer

Cost estimate: **2-4 days of focused work** in the sim repo plus coordination with database repo for state consistency.

### Option B: Spec-only phase now, implementation later

Phase 53 ships:
1. `PURCHASE-API-SPEC.md` -- contract spec for the sim HTTP endpoints (mirrors INTEG-01-SPEC.md / INTEG-02-SPEC.md pattern but write-side)
2. `<purchase-panel>` UI scaffold -- already stubbed in Phase 50; light up its markup + layout + PURCHASE-03 hydration (price/level/cycle/total-cost display from already-indexed game-state)
3. A disabled "Buy" button with a `data-gate="sim-api"` attribute + tooltip "Purchasing requires sim API -- see PURCHASE-API-SPEC.md"
4. Nyquist test harness asserting the markup exists and the button is gated
5. Mark PURCHASE-01, PURCHASE-02, PURCHASE-04 as "deferred; gated on PURCHASE-API-SPEC.md delivery to sim repo"

Requirements coverage: PURCHASE-03 ships functionally; PURCHASE-01/02/04 ship as stubs awaiting the sim API side-quest.

Cost estimate: **~3 hours** (same shape as Phase 51 pre-backend waves).

### Option C: Proxy via website repo

Scope:
- Skip sim repo entirely
- Add a Node proxy inside website repo (or a separate `purchase-proxy/` repo) that signs tx with a test key and submits to anvil
- Browser POSTs to website-repo-owned proxy
- Proxy is a trust-boundary but website-owned

Pro: faster than Option A (no sim-repo integration concerns).
Con: website repo becomes a backend that holds signing keys. Violates the "website is pure frontend" invariant from the v2.4 framing. Recommend against.

### Option D: Defer Phase 53 entirely

Move Phase 53 to v2.5. Skip directly to Phase 54 (Coinflip + BAF Leaderboards -- these are read-only and unblocked). Phase 55 (Decimator) also read-only. Milestone v2.4 completes without the purchase path; v2.5 revisits it with fuller scope thought.

Pro: zero risk; maintains momentum on readable surfaces.
Con: v2.4 feels less complete -- players can't exercise the purchase loop they see in Phase 52.

## Recommendation

**Option B (spec-only phase)** is the right autonomous decision. It:
- Ships real UI progress (PURCHASE-03 + scaffolding)
- Keeps Phase 53 in scope without false claims
- Preserves Phase 52's pack-animation payoff: when a future sim-API ship happens, the already-wired packs-panel surfaces new inventory automatically via existing stale-guard refetch
- Mirrors the proven INTEG-SPEC.md pattern
- Completes in a timeframe that fits "autonomous night session"

Option A is the right long-term play but needs user input on the anvil/key-management questions before it can proceed.

Option D is defensible if the user wants to keep v2.4 tight and push purchases to v2.5.

## Next Actions

User decision needed on:
1. Pick Option A, B, C, or D
2. If Option A: answer the key-management + anvil coordination questions
3. If Option B: confirm and I proceed autonomously with the spec + scaffold phase
4. If Option D: skip to Phase 54 discuss

Until then, Phase 53 stays in NOT STARTED state.

**STATE.md is up to date.** Phase 52 is closed, Phase 53 directory is created with this assessment file, no planning artifacts yet.

This file can be deleted or archived once the decision lands.
