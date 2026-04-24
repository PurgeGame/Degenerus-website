# SIM-01 Spec: Sim HTTP Endpoints for Wallet-Less Purchase Flow

**Phase:** 53 -- Purchase Flow (Option B: spec + UI scaffold)
**Requirement:** SIM-01 (new, gates full Phase 53 PURCHASE-01/02/04 validation)
**Owner:** website repo (proposal); degenerus-sim repo (implementation)
**Status:** DRAFT -- solo dev self-coordination; implement when switching to /home/zak/Dev/PurgeGame/degenerus-sim/
**Posted:** 2026-04-24 -- solo dev (no external team); this file is the canonical spec to reference when adding the HTTP surface to the sim repo. Phase 53 Option B ships the UI scaffold + PURCHASE-03 live against this contract; SIM-01 ship unblocks PURCHASE-01/02/04 live.

## Why This Endpoint Class Is Needed

Phase 53 (Purchase Flow) has four requirements:

- PURCHASE-01 -- user can trigger a ticket purchase for the selected player
- PURCHASE-02 -- user can trigger a lootbox purchase for the selected player
- PURCHASE-03 -- user can see current ticket price, active level/cycle, total cost
- PURCHASE-04 -- after purchase, the new pack appears in inventory and the selected player's state reflects the deposit

PURCHASE-03 is a display task hydrating from existing game-state indexing (`game.price`, `game.level` in the Proxy store). It ships in Phase 53 without any new backend.

The other three require an HTTP path from the browser to a signing authority that can submit the on-chain transaction against the local anvil chain on behalf of the selected player. The degenerus-sim repo (`/home/zak/Dev/PurgeGame/degenerus-sim/`) already has the purchase internals -- `src/game/decisionPhase.ts`, `src/game/executeDecision.ts`, `src/game/lootboxOpen.ts` -- but no HTTP server, no external-request entrypoint, and no `POST /.../buy-*` surface.

This spec documents the endpoints that SIM-01 must ship to unblock PURCHASE-01/02/04 live.

## Endpoints

### `POST /player/:address/buy-tickets`

Purchase ETH tickets on behalf of `:address`. Mirrors the internal ticket purchase path in the sim (equivalent to `beta/app/purchases.js:46-71` but wallet-free -- the sim signs, not the browser).

#### Path Parameters

- `:address` -- 42-char `0x...` Ethereum address, lowercased. Must be a known player address (one the sim has seen before, typically a sim-archetype account seeded in an anvil genesis block).

#### Request Body

```json
{
  "ticketQuantity": 4,
  "affiliateCode": "DEGEN01"
}
```

- `ticketQuantity` (required, integer >= 1) -- user-facing count of ticket purchases. Contract scales internally via `<<2` (4 entries per ticket purchase). The sim MUST pass the user-facing count straight through as the `ticketQuantity` parameter to `purchase()`; the contract does the unit conversion. Reference: `beta/app/purchases.js:11` (`TICKET_UNIT = 400n`) and `v1.1-ECONOMICS-PRIMER.md` note on ticket-vs-entry units.
- `affiliateCode` (optional, string, max 31 chars) -- upper-cased referral code to bytes32-encode. Sim encodes via `ethers.encodeBytes32String(code.slice(0, 31))`. When omitted or empty, sim uses `ethers.ZeroHash`.

#### Response JSON Schema (200)

```json
{
  "success": true,
  "txHash": "0xabc123...",
  "newEntries": [
    { "entryId": 128, "level": 5, "startIndex": 0 },
    { "entryId": 129, "level": 5, "startIndex": 1 },
    { "entryId": 130, "level": 5, "startIndex": 2 },
    { "entryId": 131, "level": 5, "startIndex": 3 }
  ]
}
```

- `success` -- `true` on committed tx; `false` on revert (with `error` populated).
- `txHash` -- full 0x tx hash from anvil. Browser does not need to poll this; it is logged for debugging.
- `newEntries[]` -- one entry per ticket purchased, scaled by `<<2` (4 entries per user-facing ticket). Each entry has an `entryId` (global autoincrement, assigned at mint) and a `level` (purchase level at time of call). `startIndex` is `entryId` modulo the per-card-4 grouping that INTEG-01 uses -- supplied so the browser can stale-check against its existing `packs-panel` card grid.

Tickets DO NOT have traits at this point -- traits are assigned at jackpot draw time per level. `newEntries` surfaces only the (entryId, level, startIndex) triple. Packs render as pending per PACKS-03 until VRF resolves for that level.

### `POST /player/:address/buy-lootbox`

Purchase a lootbox on behalf of `:address`. Lootbox-sourced tickets open immediately on purchase per PACKS-04 -- traits are known at lootbox-open time.

#### Path Parameters

- `:address` -- same as above.

#### Request Body

```json
{
  "lootboxEthAmount": "50000000000000000",
  "affiliateCode": "DEGEN01"
}
```

- `lootboxEthAmount` (required, string, wei as decimal) -- wei amount to spend on the lootbox. Minimum enforced by contract. Sim passes this as the `lootBoxAmount` parameter to `purchase()` (reference: `beta/app/purchases.js:54-71`; `purchaseBurnieLootbox` is a different BURNIE-only path not covered by this spec).
- `affiliateCode` (optional, same semantics as ticket endpoint).

Note: wallet-less means no `msg.value`. The sim constructs and signs the tx with the combined ticket + lootbox ETH as `msg.value` using its signer (open question 1 below). Because this endpoint is lootbox-only, ticket quantity is 0 and `msg.value = lootboxEthAmount`.

#### Response JSON Schema (200)

```json
{
  "success": true,
  "txHash": "0xdef456...",
  "newEntries": [
    { "entryId": 200, "level": 5, "traitId": 14, "traitLabel": "zodiac_cancer_blue" },
    { "entryId": 201, "level": 5, "traitId": 72, "traitLabel": "cards_horseshoe_green" },
    { "entryId": 202, "level": 5, "traitId": 138, "traitLabel": "dice_3_purple" },
    { "entryId": 203, "level": 5, "traitId": 205, "traitLabel": "crypto_bitcoin_gold" }
  ]
}
```

- `newEntries[]` -- one entry per ticket granted by the lootbox open. Traits are populated IMMEDIATELY per PACKS-04 (lootbox-sourced tickets reveal at open time, no VRF wait).
- `traitLabel` -- the trait string key the website's `beta/viewer/trait-map.js` uses for badge lookup (same values INTEG-01 returns in its `cards[].entries[].traitLabel` field).

### Request Param Details (both endpoints)

| Field | Type | Source of truth |
|-------|------|-----------------|
| `ticketQuantity` | int | `beta/app/purchases.js:53` -- user-facing count, contract scales via `<<2` |
| `lootboxEthAmount` | wei string | `beta/app/purchases.js:54` -- directly passed as `lootBoxAmount` |
| `affiliateCode` | bytes32 or string | `beta/app/purchases.js:189-206` -- URL/localStorage-resolved, bytes32-encoded via `ethers.encodeBytes32String(code.slice(0, 31))` |

The sim MUST NOT import the browser code above -- it is wallet-tainted. Use it as a reference for the math only; the sim's own signer path goes through its existing `executeDecision.ts` or equivalent.

## Error Modes

| Status | Condition | Response |
|--------|-----------|----------|
| 200 | Tx committed, receipt OK | Full payload above with `success: true` |
| 400 | Invalid body (missing/wrong-type params, negative ticket qty, non-decimal wei) | `{ "success": false, "error": "invalid_params: ticketQuantity must be >= 1" }` |
| 400 | Affiliate code longer than 31 chars | `{ "success": false, "error": "invalid_affiliate_code: exceeds 31 chars" }` |
| 402 | Player has insufficient ETH for `msg.value` (ticket cost + lootbox eth) | `{ "success": false, "error": "insufficient_balance: required X, available Y" }` |
| 404 | Player address not known to sim (no genesis-seeded anvil account or impersonation mapping) | `{ "success": false, "error": "player_not_found" }` |
| 409 | Level-transition locked (`rngLocked` true) | `{ "success": false, "error": "level_transition_locked: try again after next block" }` |
| 409 | Jackpot phase -- purchase disabled | `{ "success": false, "error": "jackpot_phase_no_buy: wait until next purchase phase" }` |
| 500 | Anvil-side revert (game contract reverted after signing + submission) | `{ "success": false, "error": "contract_revert: <revert-reason>", "txHash": "0x..." }` |
| 500 | Anvil unreachable or RPC down | `{ "success": false, "error": "anvil_unreachable" }` |

Error responses use the same top-level `success` / `error` / `txHash` shape as success responses. Browser's gated-UI layer (Phase 53's `<purchase-panel>` sim-api gate lift) treats `success: false` uniformly -- displays `error` as a toast and does NOT swallow the failure as a silent no-op.

## Known Open Questions (for sim team)

These are the blockers the sim-repo implementer must resolve before SIM-01 ships. Phase 53 Option B does not pre-decide them; the spec documents them as unresolved.

### 1. Which anvil key signs?

Two viable patterns:

- **(A) Deterministic mapping from player address to test-account private key.** The sim genesis seeds N anvil accounts (10-20 typical) with known private keys. Each player address is mapped to one of those keys. Sim looks up the key at request time and signs with it. Pros: cryptographically honest -- the player account actually signs. Cons: limits the number of addressable players to the seeded accounts; new players require re-seeding genesis.
- **(B) Single "sim signer" that pretends to be the player via impersonation.** Anvil supports `hardhat_impersonateAccount` / `anvil_impersonateAccount` RPC -- any account can be impersonated without a private key. Sim holds ONE signing key; it impersonates the requested player address when constructing the tx. Pros: unlimited address space; simpler key management. Cons: less realistic (real mainnet wouldn't allow this); requires anvil impersonation RPC to be enabled.

Pattern (B) is likely the right answer for v2.4 (simplicity + unbounded addresses), but open for sim team to decide.

### 2. Database state consistency: indexer must see the tx

After the sim writes to anvil, the database repo's indexer polls the same chain and must ingest the tx before the browser's next fetch lands. Current behavior:

- Database indexer polls anvil's new-block notification (or block-number polling at some cadence).
- Sim `POST /player/:address/buy-tickets` returns after the tx lands in a block.
- Browser's next `/player/:address/tickets/by-trait?level=N&day=M` fetch arrives at the database API.
- Database API reads from its indexed tables.

The race condition: the sim POST can return BEFORE the database indexer has ingested the tx. The browser fetches too early and sees stale data.

Sim team must document the expected latency or implement one of:
- Sim API waits for database indexer to confirm ingestion (polling the database repo). Cleanest; highest latency.
- Sim API returns immediately; browser implements retry-with-backoff when tickets-by-trait doesn't show the new entries. Requires no sim/database coordination; pushes complexity to the browser.
- Indexer implements a "force-poll now" RPC and sim triggers it after each write. Middle-ground.

### 3. Should sim API validate preconditions or proxy anvil errors?

Two schools of thought:

- **(A) Sim API validates first.** Read anvil state (player ETH balance, `rngLocked` flag, current phase) before constructing tx. Return 402/409 early with helpful error. Lowers spurious tx-revert rate. Cons: validates against a possibly-stale read block; more code.
- **(B) Sim API just submits; surface the revert.** Simpler; lets the contract be source of truth. Cons: error messages come from revert strings which may be opaque (`GameErrors.LockedRngBlock` instead of "try again after next block").

Recommend (A) for UX but acceptable either way. Spec above documents 402/409 as the desired error codes; sim can map revert reasons to those codes if it takes path (B).

### 4. Gas funding: does the player address hold gas ETH?

Two sub-questions:

- Under pattern (B) above (impersonation): impersonated accounts typically need ETH balance on anvil (gas is paid from the impersonated account, not the signer). Sim must either pre-fund player addresses at genesis OR use `anvil_setBalance` to top up before each tx. Pattern (A) seeded accounts have funds by genesis.
- Gas price: anvil's base fee is 0 by default, so practically gas is free. But the tx still needs the account to have SOME balance to cover `gasLimit * gasPrice` (even if 0). Empirically 1 ETH per seeded account is sufficient.

### 5. Idempotency: browser retries

What if the browser retries a POST after a network blip? Two failure modes:

- First POST succeeded, second POST creates a duplicate tx. Undesirable.
- First POST failed, second POST succeeds. Desired.

Sim API MUST support an optional request-id header: `X-Request-Id: <uuid>`. If two requests arrive with the same request-id within N seconds, the second returns the first's response verbatim (cached). Browser debounces by using a single uuid per button-click. This is cheap to implement server-side (in-memory LRU cache, N=30s sufficient).

Phase 53 UI (once sim-api gate lifts) SHOULD generate a request-id per click-handler invocation.

## Acceptance Criteria

- Both endpoints reachable: `POST /player/:address/buy-tickets` and `POST /player/:address/buy-lootbox`.
- Request/response shapes match the JSON schemas above.
- Error responses use the `{ success: false, error: "<tag>: <detail>" }` shape with the documented error tags.
- Within one block after a successful POST returns, a subsequent `GET /player/:address/tickets/by-trait?level=N` MUST return the new entries (modulo the database-indexer latency, see open question 2).
- Request-id idempotency enforced per open question 5.
- Preconditions validated (open question 3 path A) OR revert reasons mapped cleanly (path B).

## Timeline

- **Phase 53 Wave 0 (this spec):** authored and committed. 2026-04-24.
- **Phase 53 Option B Wave 1:** UI scaffold ships with gated buttons (`data-gate="sim-api"`, `aria-disabled="true"`, tooltip linking to this spec). PURCHASE-03 ships live.
- **SIM-01 future ship:** sim-repo side-quest implements both endpoints per this spec. When done, Phase 53 follow-up lifts the sim-api gate on the buttons and wires the POST calls. That follow-up is a small diff (unattr button, add handler, ingest response -> trigger packs-panel refresh via existing stale-guard refetch).
- **PURCHASE-01/02/04 live validation:** gated on SIM-01 ship.

Any shape changes the sim team proposes during implementation update THIS document; Phase 53 follow-up rebases off the final version.

## Confidence

- HIGH on the endpoint path class (`POST /player/:address/buy-*`) -- mirrors INTEG-01's `GET /player/:address/tickets/by-trait` shape.
- HIGH on the request body fields -- `ticketQuantity`, `lootboxEthAmount`, `affiliateCode` are the minimum set beta's wallet path uses.
- MEDIUM on the response `newEntries[]` shape -- database-repo indexer's INTEG-01 returns a richer card-grouped shape; this spec returns a flat per-entry list because the sim is synchronous with the tx (it knows what was minted), whereas INTEG-01 reads from indexed state. Follow-up may unify the shapes if sim/database share a derivation path.
- MEDIUM on the open questions -- sim team resolves at implementation time. None of them block the website-side scaffold; Phase 53 UI just gates the buttons until this spec is satisfied.
- LOW on the idempotency design (request-id header) -- could be done as query param, cookie, or in body. Listed as a suggestion; sim team picks final mechanism.
