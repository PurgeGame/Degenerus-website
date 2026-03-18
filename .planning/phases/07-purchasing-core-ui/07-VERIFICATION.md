---
phase: 07-purchasing-core-ui
verified: 2026-03-18T15:10:00Z
status: passed
score: 8/8 must-haves verified
re_verification: false
---

# Phase 7: Purchasing Core UI Verification Report

**Phase Goal:** Players can buy tickets, lootboxes, and BURNIE tickets with full transaction lifecycle feedback, and view pass options -- proving the Custom Element component pattern on the most-used game actions.
**Verified:** 2026-03-18T15:10:00Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Player can buy ETH tickets with quantity input and live price display | VERIFIED | purchase-panel.js: `data-input="eth-qty"` with +/-1/+10 buttons; `subscribe('game.price')` drives `#updatePrice` which calls `#recalcTotal()` to update `eth-ticket-cost` and `eth-total` display |
| 2 | Player can buy ETH lootboxes with activity-score EV indicator | VERIFIED | purchase-panel.js: `data-input="eth-lootbox"` wired to `#recalcTotal()`; `subscribe('player.activityScore.total')` drives `#updateEvIndicator` setting `ev-indicator` innerHTML with class from `lootboxEvClass()` and label from `lootboxEvLabel()` |
| 3 | Player can buy BURNIE tickets (1000 BURNIE per ticket) and BURNIE lootboxes | VERIFIED | purchases.js exports `buyBurnieTickets()` routing to `purchaseCoin()` (tickets) or `purchaseBurnieLootbox()` (lootbox only); purchase-panel.js BURNIE section shows 1,000 BURNIE/ticket rate, quantity input, and `buy-burnie-btn` |
| 4 | Purchase panel shows current level price and pool fill progress bar | VERIFIED | purchase-panel.js: `subscribe('game.pools.next')` drives `#updatePoolProgress()` which sets `pool-fill-bar` width style and `pool-pct` text; `#refreshPoolTarget()` called on `game.level` change fetches target from contract via `fetchPoolTarget()` |
| 5 | Every transaction shows pending/confirmed/failed status with etherscan hash link | VERIFIED | tx-status-list.js subscribes to `ui.pendingTxs`, renders per-tx divs with `tx-pending/tx-confirmed/tx-failed` classes, `tx-spinner` for in-flight, `tx-icon` for terminal states, and `<a class="tx-hash" href="${txUrl(tx.hash)}">` for etherscan links; main.js wires all `tx:*` events from contracts.js into store |
| 6 | Pass cards display pricing and purchase button for lazy, whale, and deity passes | VERIFIED | pass-section.js: three pass cards (`data-pass="lazy"`, `data-pass="whale"`, `data-pass="deity"`); `subscribe('game.level', () => this.#updatePrices())` drives lazy/whale pricing via `calcLazyPassPrice()` and `calcWhaleBundlePrice()`; buy buttons present for all three |
| 7 | Deity pass card shows a symbol selector grid with taken symbols greyed out and boon status | VERIFIED | pass-section.js: `#renderSymbolGrid()` generates 32 buttons from DEITY_SYMBOLS; taken IDs (fetched via `fetchTakenSymbols()` using `ownerOf()` pattern) get `symbol-taken` class and `disabled`; selected symbol gets `symbol-selected` class; `#handleSymbolSelect()` enables buy button only after selection |
| 8 | Pass section is collapsed by default and does not push the purchase panel below the fold | VERIFIED | pass-section.js innerHTML uses `<details class="pass-details">` without `open` attribute; symbol/deity data is lazy-loaded on first `toggle` event; `<pass-section>` appears after `<purchase-panel>` in index.html's main column |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `beta/app/purchases.js` | Purchase business logic module | VERIFIED | 369 lines; 19 exports; all required functions present: `buyEthTicketsAndLootbox`, `buyBurnieTickets`, `buyBurnieLootbox` (via `buyBurnieTickets` with zero qty), `fetchPoolTarget`, `calcPoolFillPercent`, `lootboxEvClass`, `lootboxEvLabel`, `lootboxBadgeText`, `getAffiliateCode`, `DEITY_SYMBOLS`, `calcLazyPassPrice`, `calcWhaleBundlePrice`, `calcDeityPassPrice`, `fetchTakenSymbols`, `fetchHasLazyPass`, `fetchDeityPassCount`, `buyLazyPass`, `buyWhaleBundle`, `buyDeityPass` |
| `beta/app/contracts.js` | `getReadProvider()` for pre-wallet reads | VERIFIED | Lines 11-19: `let readOnlyProvider = null;` and `export function getReadProvider()` returning wallet provider if connected, else lazily creating `new ethers.JsonRpcProvider(CHAIN.rpcUrl)` |
| `beta/components/purchase-panel.js` | purchase-panel Custom Element | VERIFIED | `customElements.define('purchase-panel', PurchasePanel)` at line 326; `#unsubs = []` private field; ETH/BURNIE toggle, pool fill bar, EV indicator, quantity inputs, buy buttons; all 6 store subscriptions present |
| `beta/components/tx-status-list.js` | tx-status-list Custom Element | VERIFIED | `customElements.define('tx-status-list', TxStatusList)` at line 48; `subscribe('ui.pendingTxs')`, spinner, icon, hash link rendering all present |
| `beta/styles/purchase.css` | Purchase panel styles | VERIFIED | `.pool-fill-bar`, `.ev-positive`, `.ev-negative`, `.ev-capped`, `.purchase-error` all present |
| `beta/components/pass-section.js` | pass-section Custom Element | VERIFIED | `customElements.define('pass-section', PassSection)` at line 382; `<details>` without `open`; all three pass cards; 32-symbol grid; lazy-load on toggle; `#unsubs = []` |
| `beta/styles/passes.css` | Pass card styles | VERIFIED | All 7 required classes: `.pass-details`, `.pass-grid`, `.pass-card`, `.symbol-grid`, `.symbol-btn`, `.symbol-taken`, `.symbol-selected` |
| `beta/app/main.js` | Bootstrap imports for all three components | VERIFIED | Lines 8-10: `import '../components/purchase-panel.js'`, `import '../components/tx-status-list.js'`, `import '../components/pass-section.js'` |
| `beta/index.html` | Elements in purchase panel div, CSS linked | VERIFIED | Lines 13-14: `purchase.css` and `passes.css` linked; lines 48-49: `<purchase-panel>` and `<pass-section>` in main column; line 52: `<tx-status-list>` in sidebar column |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `purchase-panel.js` | `purchases.js` | `import { buyEthTicketsAndLootbox, buyBurnieTickets, fetchPoolTarget, ... }` | WIRED | Line 6-16 of purchase-panel.js imports all required functions from purchases.js |
| `purchase-panel.js` | `store.js` | `subscribe('game.price', ...)` and 5 other paths | WIRED | Lines 147-162: subscribes to `game.price`, `game.level`, `game.pools.next`, `player.balances.burnie`, `player.activityScore.total`, `ui.connectionState` |
| `tx-status-list.js` | `store.js` | `subscribe('ui.pendingTxs', ...)` | WIRED | Line 13: `subscribe('ui.pendingTxs', (txs) => this.#render(txs))` |
| `purchases.js` | `contracts.js` | `import { getContract, sendTx, getReadProvider }` | WIRED | Line 5: `import { getContract, sendTx, getReadProvider } from './contracts.js'` |
| `main.js` | `purchase-panel.js` | side-effect import | WIRED | Line 8: `import '../components/purchase-panel.js'` |
| `pass-section.js` | `purchases.js` | `import { calcLazyPassPrice, ... }` | WIRED | Lines 6-11: imports all pass pricing, buy, and status functions from purchases.js |
| `pass-section.js` | `store.js` | `subscribe('game.level', ...)` and 2 other paths | WIRED | Lines 137-158: subscribes to `game.level`, `ui.connectionState`, `player.address` |
| `index.html` | `pass-section.js` | `<pass-section>` element | WIRED | Line 49: `<pass-section></pass-section>` inside `data-panel="purchase"` after `<purchase-panel>` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PURCH-01 | 07-01 | Player can buy tickets (ETH) with quantity input and price display | SATISFIED | purchase-panel ETH section: qty input with +/-1/+10, live cost via `subscribe('game.price')`, `buyEthTicketsAndLootbox()` call |
| PURCH-02 | 07-01 | Player can buy lootboxes with activity-score-dependent EV indicator | SATISFIED | lootbox ETH input in purchase-panel; `subscribe('player.activityScore.total')` drives EV indicator badge; `lootboxEvClass()` / `lootboxEvLabel()` in purchases.js |
| PURCH-03 | 07-01 | Player can buy BURNIE tickets (1,000 BURNIE per ticket) | SATISFIED | BURNIE mode in purchase-panel; `buyBurnieTickets()` calls `purchaseCoin()` with scaled ticket units; 1,000 BURNIE/ticket rate displayed |
| PURCH-04 | 07-01 | Purchase panel shows current level price and pool fill progress toward target | SATISFIED | `subscribe('game.pools.next')` + `fetchPoolTarget()` drive `pool-fill-bar` width, `pool-pct` text, and current/target amounts |
| PURCH-05 | 07-01 | Transaction lifecycle displays pending/confirmed/failed states with tx hash link | SATISFIED | tx-status-list subscribes to `ui.pendingTxs`; main.js wires all 6 `tx:*` events from contracts.js sendTx to store updates; hash links via `txUrl()` |
| PASS-01 | 07-02 | Pass cards display status, pricing, and purchase button for lazy/whale/deity passes | SATISFIED | All three cards in pass-section.js with pricing via `calcLazyPassPrice()` / `calcWhaleBundlePrice()` / `calcDeityPassPrice()`; status via `fetchHasLazyPass()` / `fetchDeityPassCount()`; buy buttons present |
| PASS-02 | 07-02 | Deity pass shows symbol selector and boon status | SATISFIED | 32-symbol grid rendered by `#renderSymbolGrid()`; taken symbols from `fetchTakenSymbols()` get `symbol-taken` class + disabled; boon described in card copy; selected symbol shown in `selected-symbol` display |
| PASS-03 | 07-02 | Pass section is accessible but not prominent (secondary navigation or collapsed panel) | SATISFIED | `<details>` element without `open` attribute; section collapsed by default; symbol data lazy-loaded on first open |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `purchase-panel.js` | 67, 102 | `placeholder="0.00"` / `placeholder="0"` | Info | HTML input placeholder attributes, not stub code. Correct usage. |

No blocker or warning anti-patterns found. No TODO/FIXME comments in phase 07 files. No empty return stubs. No ethers imports in component files (architectural constraint upheld in all three components).

### Human Verification Required

#### 1. ETH purchase flow end-to-end

**Test:** Connect a Sepolia wallet, navigate to the purchase panel, enter a ticket quantity, observe the cost update live, click "Buy with ETH", and follow through the wallet confirmation.
**Expected:** Pending status appears in tx-status-list immediately after sending; transitions to confirmed/failed with etherscan hash link; purchase panel re-enables buy button after completion.
**Why human:** Transaction lifecycle requires a live wallet and testnet ETH. Can't verify sendTx event chain executes correctly against a real wallet without running the app.

#### 2. BURNIE purchase mode toggle

**Test:** Click the BURNIE toggle button; enter a ticket quantity; observe the BURNIE cost display updating at 1,000 BURNIE per ticket.
**Expected:** ETH section hidden, BURNIE section visible; cost shows `qty * 1000 BURNIE`; buy button disabled if wallet not connected.
**Why human:** Toggle visibility and dynamic cost display requires browser rendering.

#### 3. Pass section collapse/expand behavior

**Test:** Page load -- verify pass section is collapsed. Click the summary row to expand. Observe that deity symbol grid populates (32 symbols) and taken ones are greyed out.
**Expected:** Grid appears on first open (not on load); taken symbols have strikethrough opacity; available symbols are clickable; deity price displays via RPC call.
**Why human:** Lazy loading on details toggle and 32x ownerOf RPC calls require network and browser interaction to verify.

#### 4. Deity symbol selection and buy flow

**Test:** Expand pass section, click an available symbol, observe it highlights, verify buy button enables. Click "Buy Deity Pass" and confirm in wallet.
**Expected:** Symbol selected state shows; buy button text changes to "Buy Deity Pass"; after successful purchase, grid refreshes and purchased symbol becomes greyed out.
**Why human:** Requires live Sepolia wallet and testnet funds.

#### 5. Buy button disabled state when disconnected

**Test:** Load page without connecting wallet. Observe buy buttons on both purchase-panel and pass-section.
**Expected:** All buy buttons (`buy-eth-btn`, `buy-burnie-btn`, `buy-lazy-btn`, `buy-whale-btn`) are disabled. Deity buy button is disabled (requires both connection and symbol selection).
**Why human:** UI state gating requires browser rendering.

### Gaps Summary

No gaps found. All 8 observable truths verified. All 7 key links wired. All 8 requirements satisfied. All 9 artifacts exist and are substantive. Commits 5fb3b11, 17da444, cd2c800, ccfbf3a confirmed in git log.

The architectural constraint "no ethers import in component files" is upheld across all three components (purchase-panel.js, tx-status-list.js, pass-section.js). Business logic is correctly centralized in purchases.js.

---

_Verified: 2026-03-18T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
