# Phase 53 -- CONTEXT: Purchase Flow

**Phase goal (from ROADMAP.md):** User can trigger ticket and lootbox purchases for the selected player via the sim API and immediately see the resulting pack appear in inventory.

**Requirements:** PURCHASE-01, PURCHASE-02, PURCHASE-03, PURCHASE-04.

**Depends on:** Phase 50 (route + store), Phase 52 (pack rendering + inventory; packs appear automatically via existing stale-guard refetch when new tickets/entries are indexed).

**Status:** Option B -- spec-only phase with UI scaffold. Full implementation of PURCHASE-01/02/04 deferred to a post-v2.4 side-quest that adds an HTTP API to the sim repo.

## Scope Decision

**Option B** selected per `53-SCOPE-ASSESSMENT.md` (this phase directory). Rationale:

1. The sim repo at `/home/zak/Dev/PurgeGame/degenerus-sim/` is a batch simulator -- no HTTP server, no wallet-less purchase endpoint exists.
2. Adding HTTP + tx signing + anvil coordination is a multi-day integration that requires design decisions (key management, state consistency with database repo) beyond autonomous scope.
3. PURCHASE-03 (price/level/cost display) is unblocked -- the required fields are already in the Proxy store via existing game-state indexing.
4. A `PURCHASE-API-SPEC.md` locks the endpoint contract so the sim-repo side-quest can ship cleanly when prioritized.
5. Phase 52's `<packs-panel>` already auto-refreshes via `replay.day` / `replay.player` stale-guard -- when real purchases land later, new packs appear without Phase 53 re-work.

## Decisions (D-01..D-07)

### D-01 Purchase panel lives in the existing `<purchase-panel>` Phase 50 stub.
The stub at `play/components/purchase-panel.js` (40 lines) gains a skeleton-to-content pattern matching `<profile-panel>` (Phase 51) and `<tickets-panel>` (Phase 52). No new Custom Element.

### D-02 PURCHASE-03 ships live from existing store; no new backend integration.
Reads `game.price` (wei string), `game.level`, and derives cycle = `Math.floor(level / 100)`. Computes `totalCost = BigInt(price) * BigInt(quantity)` where quantity is a user-controlled numeric input. Renders price as ETH (formatEth from `beta/viewer/utils.js` -- wallet-free, already used by Phase 52's jackpot-panel-wrapper after D-09 patch).

### D-03 PURCHASE-01 and PURCHASE-02 ship as gated UI.
Two buttons ("Buy tickets", "Buy lootbox") render but are disabled with `aria-disabled="true"` + a tooltip "Awaiting sim API -- see PURCHASE-API-SPEC.md". Buttons carry `data-gate="sim-api"` so Nyquist tests can assert the gate exists.

### D-04 PURCHASE-04 ships as a plumbing-only assertion.
The packs-panel already refetches on `replay.player` / `replay.day` change (Phase 52 Wave 2). When a real purchase lands (post sim-API ship), the packs-panel auto-renders the new pack with zero further code. Phase 53 asserts this plumbing via a test that walks the import graph from purchase-panel -> (future sim endpoint) -> packs-panel refetch path. No live trigger yet.

### D-05 PURCHASE-API-SPEC.md authored, follows INTEG-01-SPEC.md shape.
Endpoint paths: `POST /player/:address/buy-tickets` and `POST /player/:address/buy-lootbox`. Request shape: `{ quantity, lootboxAmount?, affiliateCode? }`. Response shape: `{ success: bool, txHash, newEntries: [ { entryId, level } ], error? }`. Includes a "Known issues and open questions" section listing the anvil / key-management questions the sim team must resolve.

### D-06 REQUIREMENTS.md status updates.
- PURCHASE-03: marked [x] validated (2026-04-24)
- PURCHASE-01, PURCHASE-02, PURCHASE-04: marked `~` deferred with spec, owner noted as sim repo
- New line added to INTEG block: SIM-01 (sim HTTP API) tracked as a new coordination requirement, gates full PURCHASE-01/02/04 validation.

### D-07 UAT is not applicable to Phase 53 Option B.
With no live purchase action, there's no user flow to test manually. If PURCHASE-01/02/04 gates lift in a follow-up phase, that phase gets its own UAT.

## Gray Areas (skipped autonomously)

User is asleep. Autonomous decisions made for:

- Purchase panel layout: single panel with tabs "Tickets" / "Lootbox", not separate components. Cleaner for v2.4 visual polish without over-engineering.
- Quantity input: numeric `<input type="number" min="1">` with keyboard-increment support. Debounce: 0ms (instant cost display).
- Price formatting: `formatEth(price).slice(0, 8)` -- shows up to 8 significant digits, dropping trailing zeros.
- Affiliate code: skipped for v2.4 (beta has it, but it's a separate surface out of Phase 53 scope).

These are not locked -- future phases or user feedback can overwrite.

## Canonical Refs

- `.planning/phases/53-purchase-flow/53-SCOPE-ASSESSMENT.md` -- the Option A/B/C/D decision surface; preserve as project memory of the gap.
- `.planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md` -- to-be-authored in Wave 0 Task 1.
- `beta/app/purchases.js` -- reference for the purchase-math (price units, ticket scaling, affiliate code encoding). Wallet-tainted via ethers; Phase 53's sim-API spec should mirror the function signatures but strip the ethers dependency.
- `beta/components/purchase-panel.js` -- the beta analog for visual reference (not wallet-free; do NOT import).
- `play/components/tickets-panel.js` + `play/components/packs-panel.js` -- Phase 52 panels that will react to new purchases once the sim API ships. No changes needed here.
- `play/components/profile-panel.js` -- gold-standard play/ Custom Element shape (skeleton -> content, stale-guard, etc.).
- `beta/viewer/utils.js` -- wallet-free `formatEth` (already used by Phase 52 after D-09 patch).

## Scope Additions

None. Phase 53 scope matches ROADMAP.md as authored, with the explicit narrowing per Option B.

## Deferred Ideas

- Full sim HTTP API (PURCHASE-01/02/04 live) -- tracked via PURCHASE-API-SPEC.md + SIM-01 in REQUIREMENTS.md
- Affiliate code input UI -- out of v2.4 scope
- Purchase history view -- covered separately by the tickets panel's inventory over time
- Gas estimate / transaction status spinner -- belongs to the sim API phase
- Optimistic update vs wait-for-confirm -- belongs to the sim API phase

## Implementation Path Sketch

**Wave 0 (single plan):** PURCHASE-API-SPEC.md authored + Nyquist test harness for purchase-panel shell + REQUIREMENTS.md updates.

**Wave 1 (single plan):** `<purchase-panel>` UI build -- skeleton-to-content swap, quantity input, price/level/cycle/total-cost display, gated Buy buttons (PURCHASE-03 live, PURCHASE-01/02/04 scaffold), CSS, Nyquist tests flip green.

No Wave 2 (no hard backend gate) and no Wave 3 (no UAT applicable under Option B).

## Decisions Checksum

D-01 `<purchase-panel>` stub from Phase 50 evolved in place (no new Custom Element).
D-02 PURCHASE-03 live from game.{price, level} + cycle math.
D-03 PURCHASE-01/02 as gated buttons with data-gate="sim-api" + aria-disabled.
D-04 PURCHASE-04 plumbing-only; packs-panel auto-surfaces when real purchases land later.
D-05 PURCHASE-API-SPEC.md authored in Wave 0, follows INTEG-SPEC.md pattern, documents sim-side open questions.
D-06 REQUIREMENTS.md status updates: PURCHASE-03 validated; 01/02/04 deferred with spec; SIM-01 added.
D-07 No UAT (no live purchase action under Option B).

**Ready for:** `/gsd-plan-phase 53` (will produce 1 or 2 plans). Given the narrow Option B scope, the planner may merge Wave 0 + Wave 1 into one plan.
