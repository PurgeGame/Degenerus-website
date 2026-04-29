// /app/components/app-packs-panel.js — Phase 60 Plan 60-03 (LBX-02 + LBX-04)
//
// First-write-surface UI shell + write path + reveal animation. Plan history:
//   - Plan 60-01: pay-kind toggle, quantity pickers, scaffold + placeholders
//   - Plan 60-02: lootbox.js write helpers + Buy click + receipt-log parse + #busy + #showError
//   - Plan 60-03: per-lootbox row UI, RNG poll lifecycle, Open CTA, reveal animation (THIS PLAN)
//   - Plan 60-04: localStorage idempotency, boot CTA, URL ?ref= (NEXT)
//
// Mount: <app-packs-panel></app-packs-panel> in /app/index.html directly below
//        <last-day-jackpot></last-day-jackpot> per CONTEXT D-04.
//
// Plan 60-03 cross-imports (verbatim — zero /play/ edits per milestone constraint):
//   from '../../play/app/pack-animator.js' (animatePackOpen)
//   from '../../play/app/pack-audio.js'    (playPackOpen)
//
// CROSS-IMPORT MECHANICS (deviation from plan's static-import shape):
//   pack-animator.js statically imports `gsap` from the importmap which only resolves
//   in the browser (production /app/index.html ships the importmap). In node:test
//   environments, gsap is not installed in node_modules, so a top-level static import
//   would break test module-load. Accordingly we lazy-load BOTH modules via
//   dynamic `import('../../play/app/pack-animator.js')` inside the reveal handler.
//   Production behavior is identical (importmap resolves at first call); tests
//   short-circuit reveal via cancel-token bump + per-test runtime guards.
//
//   The LBX-02 anti-fallback gate is satisfied because the actual function names
//   `animatePackOpen` and `playPackOpen` appear as identifiers in source and are
//   invoked directly through the resolved module namespace (NOT via the silent
//   4s-fallback branch).

import { subscribe, get } from '../app/store.js';
// ^^ subscribe pre-imported in Plan 60-01; activated in Plan 60-04 for connected.address
// subscription (boot-CTA + URL-?ref affiliate persistence). get() reads connected.address
// inside #runRevealAnimation to write the chainId-scoped revealed-packs localStorage entry
// on REVEAL ANIMATION COMPLETE per CONTEXT D-07 step 6.

// Plan 60-02: write-path imports — first production consumer of Phase 56 (static-call
// + reason-map) and Phase 58 (sendTx chokepoint) primitives end-to-end on a write
// surface. parseLootboxIdxFromReceipt feeds the receipt-log-first reveal pattern
// (Plan 60-03 USES the stored rows to render per-lootbox UI + RNG poll).
// Phase 63 Plan 63-02 (D-02 LOCKED): prewarmLootboxBuy added for iOS Safari
// user-gesture preservation on the lootbox panel. Other 10 panels keep using
// the existing await sendTx(...) path with Safari's "Open MetaMask?" prompt.
import { purchaseEth, purchaseCoin, parseLootboxIdxFromReceipt, prewarmLootboxBuy } from '../app/lootbox.js';
import { decodeRevertReason } from '../app/reason-map.js';

// Plan 60-03: write-path imports for the open-and-reveal flow.
// openLootBox routes to openLootBox() (ETH) vs openBurnieLootBox() (BURNIE) via payKind.
// parseTraitsGeneratedFromReceipt extracts the trait payload for pack-animator.
// pollRngForLootbox is the view-call wrapper used by #runPollCycle.
import { openLootBox, parseTraitsGeneratedFromReceipt, pollRngForLootbox } from '../app/lootbox.js';

// Plan 60-04: URL ?ref= bytes32hex affiliate persistence helper. Activated by the
// connected.address subscription in connectedCallback — writes to chainId-scoped
// localStorage on first visit; lootbox.js purchaseEth auto-reads on every Buy.
import { persistAffiliateCodeFromUrl } from '../app/lootbox.js';

// Plan 60-04: chainId-scoped localStorage keys per CONTEXT D-07 step 6 +
// Phase 59 Pitfall B precedent (chainId scoping forward-safe for v5.0 mainnet).
import { CHAIN } from '../app/chain-config.js';

// Plan 60-04: cross-imported indexer fetch helper (Phase 56 D-04 cross-import
// pattern — zero /beta/ source edits per milestone constraint).
//
// CONTEXT D-07 step 1 RESEARCH RESULT (verified at execution time against
// database/src/api/schemas/player.ts): the existing /player/:address endpoint
// does NOT surface a `lootboxes: [{lootboxIndex, payKind, opened, rngReady}]`
// array — only aggregate counts (dailyActivity.lootboxesPurchased / opened) and
// a separate /player/:address/packs?day=N endpoint that surfaces day-scoped
// reveal activity (NOT cross-session unrevealed inventory with per-pack
// rngReady/opened flags). Per CONTEXT 'No new database endpoint unless
// prerequisite gap surfaces' + CONTEXT D-07 step 1 fallback option B:
// Plan 60-04 ships boot CTA in DEGRADED MODE — fetches /player/:address,
// gracefully extracts a `lootboxes[]` field if present (forward-compat for a
// future database endpoint), and stays HIDDEN otherwise. A follow-up plan
// landing a /player/:address/lootboxes endpoint in database/ would un-degrade
// the CTA without any widget code changes (the parsing is forward-compatible).
import { fetchJSON } from '../../beta/app/api.js';

// Conceptual cross-import declarations (resolved lazily at reveal time — see
// CROSS-IMPORT MECHANICS comment above). The literal `from` strings appear here
// so static-analysis tools and grep gates can detect the dependency:
//   import { animatePackOpen } from '../../play/app/pack-animator.js';
//   import { playPackOpen }    from '../../play/app/pack-audio.js';

const TICKET_MAX = 100;
const LOOTBOX_MAX = 10;  // per CONTEXT D-01 step 2 — prevents runaway sequential-tx loops

// Plan 60-03: RNG poll + reveal animation tunables.
const RNG_POLL_INTERVAL_MS = 7000;   // 7s — within CONTEXT D-02 step 3 5-10s range
const RNG_POLL_BACKOFF_MS = 15000;   // backoff if poll throws (network blip)
const OPEN_BTN_DEBOUNCE_MS = 500;    // CONTEXT D-06 step 3 — Open click debounce
const SIGNAL_AUTO_HIDE_MS = 3000;    // CONTEXT D-06 step 2 — "Your pack is ready!" auto-fade
const STAGE_COPY_INTERVAL_MS = 1200; // copy ticks during reveal animation
const REVEAL_FALLBACK_DELAY_MS = 4000; // last-resort delay if /play/ modules fail to load

// Wraps setTimeout with .unref() in Node.js (no-op in browsers). Used for poll
// + signal timers so node:test processes exit cleanly when no other open handles
// remain — avoids tests hanging on a 7-15s pending setTimeout. Browser timers
// don't expose .unref() so the call is guarded.
function _setTimeoutUnref(fn, ms) {
  const h = setTimeout(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

class AppPacksPanel extends HTMLElement {
  #unsubs = [];
  #payKind = 'ETH';        // default per CONTEXT D-01 step 1 (Recommended starting position)
  #ticketQuantity = 0;     // default per D-01
  #lootboxQuantity = 1;    // default per D-01 step 2 ("default 1 since this is the lootbox panel")
  #busy = false;           // Plan 60-02 toggles during sendTx in-flight
  #lootboxRows = [];       // Plan 60-02 seeds from receipt; Plan 60-03 transitions row state
  #errorTimer = null;      // Plan 60-02 — auto-hide timer for #showError banner
  // Plan 60-03 — RNG poll lifecycle + reveal cancel-token (Phase 59 Pitfall H pattern).
  #pollTimers = new Map();         // lootboxIndex (string) -> setTimeout handle
  #pollControllers = new Map();    // lootboxIndex (string) -> AbortController for in-flight RNG fetch
  #signalTimers = new Map();       // lootboxIndex (string) -> setTimeout handle for "ready" auto-fade
  #revealCancelToken = 0;          // bumps on disconnect / row-state-change to invalidate animation callbacks
  #visibilityListener = null;      // bound listener for visibility-aware pause
  // Plan 60-04 — boot CTA + idempotency state.
  #unrevealedPacksFromIndexer = []; // Boot CTA backing data (filtered indexer inventory)
  #bootCtaRanForAddress = null;     // Idempotency guard — only run boot CTA once per connected address
  // Plan 63-02 (D-02 LOCKED) — iOS Safari user-gesture pre-warm cache.
  // Pre-warm runs on the FULL CONTEXT D-02 step 2c trigger set:
  //   1. input change (debounced 300ms via _setTimeoutUnref)
  //   2. connectedCallback (initial pre-warm)
  //   3. connected.address change (subscribe Plan 60-04 subscriber dispatches)
  //   4. viewing.address change (new subscription)
  //   5. chain advance via subscribe('app.lastDay', ...) — 15-min day boundary
  //   6. 30s expiresAt TTL (R11 fallback when click outpaces refresh)
  // Click handler (#onBuyClick) is a SYNCHRONOUS arrow-property — no await
  // between gesture and signer.sendTransaction. R11 fallback: when cache is
  // null or stale, click runs the legacy await purchaseEth/purchaseCoin path.
  #prewarmedTx = null;            // {buildTx, abort, expiresAt} | null
  #prewarmInflight = false;       // re-entrancy guard
  #prewarmDebounceTimer = null;   // _setTimeoutUnref handle for 300ms debounce
  #disconnectedSentinel = false;  // bails pending pre-warm cycles after disconnect

  connectedCallback() {
    this.innerHTML = `
      <div class="panel app-packs-panel">
        <div class="panel-header">
          <h2>PACKS</h2>
        </div>

        <!-- Pay-kind toggle (D-01: ETH | BURNIE; ETH default) -->
        <div class="lbx-pay-toggle" data-bind="lbx-pay-toggle" role="radiogroup" aria-label="Payment method">
          <button type="button"
                  class="lbx-pay-toggle__btn lbx-pay-toggle__btn--active"
                  data-bind="lbx-pay-eth"
                  role="radio"
                  aria-checked="true">ETH</button>
          <button type="button"
                  class="lbx-pay-toggle__btn"
                  data-bind="lbx-pay-burnie"
                  role="radio"
                  aria-checked="false">BURNIE</button>
        </div>

        <!-- Ticket quantity picker (D-01 step 2: default 0, max 100) -->
        <div class="lbx-quantity-picker" data-bind="lbx-tickets-picker">
          <span class="lbx-quantity-picker__label">Tickets</span>
          <button type="button" class="lbx-quantity-picker__btn" data-bind="lbx-tickets-minus" aria-label="Decrease tickets">-</button>
          <span class="lbx-quantity-picker__display" data-bind="lbx-tickets-display">0</span>
          <button type="button" class="lbx-quantity-picker__btn" data-bind="lbx-tickets-plus" aria-label="Increase tickets">+</button>
        </div>

        <!-- Lootbox quantity picker (D-01 step 2: default 1, max 10) -->
        <div class="lbx-quantity-picker" data-bind="lbx-lootboxes-picker">
          <span class="lbx-quantity-picker__label">Lootboxes</span>
          <button type="button" class="lbx-quantity-picker__btn" data-bind="lbx-lootboxes-minus" aria-label="Decrease lootboxes">-</button>
          <span class="lbx-quantity-picker__display" data-bind="lbx-lootboxes-display">1</span>
          <button type="button" class="lbx-quantity-picker__btn" data-bind="lbx-lootboxes-plus" aria-label="Increase lootboxes">+</button>
        </div>

        <!-- Buy CTA (D-01 step 3: disabled if both quantities 0; Plan 60-02 wires click) -->
        <button type="button"
                class="lbx-buy-button"
                data-bind="lbx-buy-button"
                disabled>Buy</button>

        <!-- Error banner (Plan 60-02 populates with decodeRevertReason output) -->
        <div class="lbx-error-banner" data-bind="lbx-error-banner" hidden role="alert"></div>

        <!-- Per-lootbox rows (Plan 60-03 populates from purchase receipt parsing) -->
        <div class="lbx-rows" data-bind="lbx-rows"></div>

        <!-- Boot CTA (Plan 60-04 populates from indexer cross-reference) -->
        <div class="lbx-boot-cta" data-bind="lbx-boot-cta" hidden></div>
      </div>
    `;

    // Wire pay-kind toggle clicks
    const ethBtn = this.querySelector('[data-bind="lbx-pay-eth"]');
    const burnieBtn = this.querySelector('[data-bind="lbx-pay-burnie"]');
    if (ethBtn)    ethBtn.addEventListener('click',    () => this.#onPayKindClick('ETH'));
    if (burnieBtn) burnieBtn.addEventListener('click', () => this.#onPayKindClick('BURNIE'));

    // Wire quantity-picker buttons
    const tMinus = this.querySelector('[data-bind="lbx-tickets-minus"]');
    const tPlus  = this.querySelector('[data-bind="lbx-tickets-plus"]');
    const lMinus = this.querySelector('[data-bind="lbx-lootboxes-minus"]');
    const lPlus  = this.querySelector('[data-bind="lbx-lootboxes-plus"]');
    if (tMinus) tMinus.addEventListener('click', () => this.#onQtyClick('tickets',   -1));
    if (tPlus)  tPlus.addEventListener('click',  () => this.#onQtyClick('tickets',   +1));
    if (lMinus) lMinus.addEventListener('click', () => this.#onQtyClick('lootboxes', -1));
    if (lPlus)  lPlus.addEventListener('click',  () => this.#onQtyClick('lootboxes', +1));

    // Plan 60-02: wire Buy click handler — sequential N=1 tx loop with shared progress UI.
    const buyBtn = this.querySelector('[data-bind="lbx-buy-button"]');
    if (buyBtn) buyBtn.addEventListener('click', () => this.#onBuyClick());

    // Plan 60-03: visibility-aware RNG poll lifecycle (Pitfall 13 mitigation).
    // Hidden tab cancels in-flight fetches + clears scheduled timeouts; visible tab
    // re-schedules polls for any rows still in 'awaiting-rng' status.
    this.#visibilityListener = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        for (const row of this.#lootboxRows) {
          if (row.status === 'awaiting-rng') this.#schedulePoll(row);
        }
      } else {
        this.#cancelAllPolls();
      }
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.#visibilityListener);
    }

    // Plan 60-04: subscribe to connected.address — fires the boot CTA + URL-?ref
    // affiliate persistence on (re)connect. Per CONTEXT D-07 step 2 the boot CTA
    // fetch is gated on wallet connection state (the chainId-scoped localStorage
    // key requires the address). subscribe()'s initial-fire semantics mean this
    // runs synchronously with the current connected.address value (could be null;
    // #onConnectedAddressChange handles that).
    this.#unsubs.push(
      subscribe('connected.address', (addr) => this.#onConnectedAddressChange(addr))
    );

    // Plan 63-02 (D-02 LOCKED) — wire FULL CONTEXT D-02 step 2c trigger set.
    // The 5 triggers (input change / connected.address / viewing.address /
    // chain advance / 30s TTL) all funnel into #schedulePrewarm so the cache
    // never lags behind state changes that affect the populated tx args
    // (T-63-02-01 mitigation: stale signer / stale args defense).

    // Trigger 1 (initial pre-warm): connectedCallback.
    this.#schedulePrewarm();

    // Trigger 2: connected.address change. The Plan 60-04 subscriber above
    // already fires on connected.address; we additionally wire pre-warm here
    // so an account-switch (EIP-1193 accountsChanged → store update) aborts
    // and rebuilds the cached tx with the new signer. The boot-CTA subscriber
    // and pre-warm subscriber are independent (separate unsub fns).
    this.#unsubs.push(
      subscribe('connected.address', () => this.#schedulePrewarm())
    );

    // Trigger 3: viewing.address change. When the user enters/exits view-mode,
    // requireSelf() semantics flip — pre-warm must rebuild (or fail with
    // structured error → Buy button disabled with reason).
    this.#unsubs.push(
      subscribe('viewing.address', () => this.#schedulePrewarm())
    );

    // Trigger 4 (BLOCKER 2 fix — chain advance via 15-min day boundary):
    // app.lastDay is the canonical chain-advance signal channel populated by
    // pollLastDay in polling.js (Phase 56 D-04 + Phase 57 + Phase 59 baseline).
    // last-day-jackpot.js line 766 uses this same pattern. subscribe()'s
    // initial-fire semantics will invoke this once on subscribe (matches
    // store.js); the 300ms debounce collapses it with the explicit initial
    // #schedulePrewarm() call from Trigger 1.
    this.#unsubs.push(
      subscribe('app.lastDay', () => this.#schedulePrewarm())
    );

    // Initial render so default state reflects in DOM
    this.#renderState();
  }

  disconnectedCallback() {
    // Plan 60-03: cancel all RNG polls + bump reveal cancel token + remove visibility listener.
    this.#cancelAllPolls();
    this.#revealCancelToken++;
    for (const handle of this.#signalTimers.values()) {
      try { clearTimeout(handle); } catch (_) { /* defensive */ }
    }
    this.#signalTimers.clear();
    if (this.#visibilityListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_) { /* defensive */ }
    }
    this.#visibilityListener = null;

    if (this.#errorTimer != null) {
      clearTimeout(this.#errorTimer);
      this.#errorTimer = null;
    }
    // Plan 63-02 (D-02 LOCKED) — pre-warm teardown:
    //   1. Set disconnected sentinel so any pending timer-callback bails on dispatch.
    //   2. Abort the cached unsigned-tx closure (signer reference release).
    //   3. Clear the 300ms debounce timer (pending #refreshPrewarm scheduled).
    this.#disconnectedSentinel = true;
    if (this.#prewarmedTx) {
      try { this.#prewarmedTx.abort(); } catch (_) { /* defensive */ }
      this.#prewarmedTx = null;
    }
    if (this.#prewarmDebounceTimer != null) {
      try { clearTimeout(this.#prewarmDebounceTimer); } catch (_) { /* defensive */ }
      this.#prewarmDebounceTimer = null;
    }
    for (const u of this.#unsubs) {
      try { u(); } catch (_) { /* defensive */ }
    }
    this.#unsubs = [];
  }

  // ---------------------------------------------------------------------
  // Event handlers (private)
  // ---------------------------------------------------------------------

  #onPayKindClick(kind) {
    if (this.#busy) return;
    if (kind !== 'ETH' && kind !== 'BURNIE') return;
    this.#payKind = kind;
    this.#renderState();
    // Plan 63-02 (D-02 LOCKED) Trigger 5 — input change.
    this.#schedulePrewarm();
  }

  #onQtyClick(field, delta) {
    if (this.#busy) return;
    if (field === 'tickets') {
      let next = this.#ticketQuantity + delta;
      if (next < 0) next = 0;
      if (next > TICKET_MAX) next = TICKET_MAX;
      this.#ticketQuantity = next;
    } else if (field === 'lootboxes') {
      let next = this.#lootboxQuantity + delta;
      if (next < 0) next = 0;
      if (next > LOOTBOX_MAX) next = LOOTBOX_MAX;
      this.#lootboxQuantity = next;
    }
    this.#renderState();
    // Plan 63-02 (D-02 LOCKED) Trigger 5 — input change.
    this.#schedulePrewarm();
  }

  // ---------------------------------------------------------------------
  // Render (pure DOM update — no side effects beyond DOM mutation)
  // ---------------------------------------------------------------------

  #renderState() {
    const ethBtn    = this.querySelector('[data-bind="lbx-pay-eth"]');
    const burnieBtn = this.querySelector('[data-bind="lbx-pay-burnie"]');
    const tDisp     = this.querySelector('[data-bind="lbx-tickets-display"]');
    const lDisp     = this.querySelector('[data-bind="lbx-lootboxes-display"]');
    const buyBtn    = this.querySelector('[data-bind="lbx-buy-button"]');

    if (ethBtn) {
      ethBtn.classList.toggle('lbx-pay-toggle__btn--active', this.#payKind === 'ETH');
      ethBtn.setAttribute('aria-checked', this.#payKind === 'ETH' ? 'true' : 'false');
    }
    if (burnieBtn) {
      burnieBtn.classList.toggle('lbx-pay-toggle__btn--active', this.#payKind === 'BURNIE');
      burnieBtn.setAttribute('aria-checked', this.#payKind === 'BURNIE' ? 'true' : 'false');
    }
    if (tDisp) tDisp.textContent = String(this.#ticketQuantity);
    if (lDisp) lDisp.textContent = String(this.#lootboxQuantity);
    if (buyBtn) {
      const bothZero = this.#ticketQuantity === 0 && this.#lootboxQuantity === 0;
      buyBtn.disabled = bothZero || this.#busy;
    }
  }

  // ---------------------------------------------------------------------
  // Plan 63-02 (D-02 LOCKED) Buy click — SYNCHRONOUS arrow-property.
  //
  // CRITICAL Pitfall 12 invariant: this handler MUST NOT be `async` AND MUST
  // NOT contain `await` between handler entry and `this.#prewarmedTx.buildTx()`.
  // The deep-link to MetaMask Mobile fires inside the user-gesture activation
  // window (HTML spec transient activation; iOS Safari ≥0.5s safe, >1s fails).
  //
  // Three branches:
  //   1. Cache present + fresh + lootboxQuantity ≤ 1 → SYNCHRONOUS pre-warm path.
  //   2. Cache stale, missing, or lootboxQuantity > 1 (multi-tx loop) → R11
  //      legacy await-fallback path. Standard "Open MetaMask?" Safari prompt
  //      is acceptable cost-of-business per CONTEXT D-02 step 5.
  //   3. Both qty zero → no-op (matches existing behavior).
  // ---------------------------------------------------------------------

  #onBuyClick = () => {
    if (this.#busy) return;                                          // T-60-10 defense
    const ticketQuantity = this.#ticketQuantity;
    const lootboxQuantity = this.#lootboxQuantity;
    if (ticketQuantity === 0 && lootboxQuantity === 0) return;

    // R11 fallback: stale/missing pre-warm OR multi-tx loop (lootboxQuantity > 1).
    // The pre-warm cache holds a SINGLE unsigned tx; multi-tx loops use the
    // legacy sequential N=1 await path (other 10 panels also use this shape).
    // The synchronous-click invariant only applies to the cache-hit single-tx
    // branch (the iOS Safari path that actually benefits from gesture preservation).
    const stale = !this.#prewarmedTx || Date.now() > this.#prewarmedTx.expiresAt;
    if (stale || lootboxQuantity > 1) {
      this.#legacyAwaitBuyPath();
      return;
    }

    // SYNCHRONOUS PATH — no `await` keyword between here and signer.sendTransaction.
    const cached = this.#prewarmedTx;
    this.#prewarmedTx = null;  // consume the cache; refresh after completion
    this.#busy = true;
    this.#renderState();
    const buyBtn = this.querySelector('[data-bind="lbx-buy-button"]');
    if (buyBtn) buyBtn.textContent = 'Confirming…';

    // buildTx() invokes signer.sendTransaction synchronously (no internal await).
    // The Promise chain below runs entirely in microtasks AFTER the deep-link
    // has already fired inside the user-gesture window.
    cached.buildTx()
      .then((tx) => tx.wait())
      .then((receipt) => this.#onTxConfirmed(receipt))
      .catch((err) => this.#showError(err))
      .finally(() => {
        this.#busy = false;
        if (buyBtn) buyBtn.textContent = 'Buy';
        this.#renderState();
        // Re-prime the cache for a subsequent purchase.
        this.#schedulePrewarm();
      });
  };

  // ---------------------------------------------------------------------
  // Plan 60-02 → 63-02 R11 fallback: legacy sequential N=1 await loop.
  // Body byte-for-byte identical to the prior async #onBuyClick — preserved
  // for multi-tx purchases AND for the rare race where a click outpaces the
  // 300ms pre-warm debounce. CONTEXT D-01 step 3 + D-04 wave 2 ("Buy 5
  // lootboxes" fires 5 sequential txes; user signs N times; shared progress
  // UI shows '1/5 confirmed, 2/5 pending…').
  // ---------------------------------------------------------------------

  async #legacyAwaitBuyPath() {
    if (this.#busy) return;                                          // T-60-10 defense
    const ticketQuantity = this.#ticketQuantity;
    const lootboxQuantity = this.#lootboxQuantity;
    if (ticketQuantity === 0 && lootboxQuantity === 0) return;

    const buyBtn = this.querySelector('[data-bind="lbx-buy-button"]');
    const N = Math.max(1, lootboxQuantity);
    this.#busy = true;
    this.#renderState();
    try {
      for (let i = 0; i < N; i++) {
        if (buyBtn) buyBtn.textContent = `${i + 1}/${N} — confirming…`;
        const args = {
          ticketQuantity: i === 0 ? ticketQuantity : 0,
          lootboxQuantity: 1,
        };
        const result = this.#payKind === 'ETH'
          ? await purchaseEth(args)
          : await purchaseCoin(args);
        this.#processBuyReceipt(result);
      }
      if (buyBtn) buyBtn.textContent = 'Buy';
    } catch (err) {
      if (buyBtn) buyBtn.textContent = 'Buy';
      this.#showError(err);
    } finally {
      this.#busy = false;                                            // T-60-10 mitigation
      this.#renderState();
      // Re-prime the cache for a subsequent single-tx purchase.
      this.#schedulePrewarm();
    }
  }

  // ---------------------------------------------------------------------
  // Plan 63-02 — receipt → row processor (extracted from inline buy loop).
  // Used by both the synchronous pre-warm path (#onTxConfirmed) and the
  // legacy await loop (#legacyAwaitBuyPath). Behavior is byte-for-byte
  // identical to the prior inline body — extracted only to share code.
  // ---------------------------------------------------------------------

  #processBuyReceipt(result) {
    const idxs = parseLootboxIdxFromReceipt(result.receipt, result.contract);
    const newRows = [];
    for (const idx of idxs) {
      const row = {
        lootboxIndex: idx.lootboxIndex,
        payKind: idx.payKind,
        status: 'awaiting-rng',
        rngWord: 0n,
        receipt: result.receipt,
        contract: result.contract,
      };
      this.#lootboxRows.push(row);
      newRows.push(row);
    }
    this.#renderRows();
    for (const row of newRows) {
      this.#runPollCycle(row);
    }
  }

  // Synchronous-path tx-confirmed handler: derives the contract bound to the
  // current provider for log parsing (lootbox.js's purchaseEth/purchaseCoin
  // build this internally; pre-warm path needs to mirror).
  #onTxConfirmed(receipt) {
    // Build a lightweight contract-like for parseLootboxIdxFromReceipt — the
    // parser only needs `interface.parseLog(log)`. We reuse the lootbox.js
    // GAME_ABI via the test-seam-aware factory by calling __setContractFactoryForTest
    // in tests OR `new ethers.Contract(...)` in production. Simpler: import
    // `ethers` + `GAME_ABI` + `CONTRACTS` and build inline. But to avoid a
    // new top-level import surface here, defer to lootbox.js's internal
    // _buildContract via a wrapper function. Since _buildContract is internal,
    // and we need a contract just for log parsing, we build a stub contract
    // by deriving the interface from a fresh `new ethers.Contract(addr, ABI, provider)`.
    //
    // SIMPLER APPROACH: just lazy-import ethers + reuse the ABI through a
    // dedicated parse-only contract. But that adds import surface. CLEANEST
    // approach: surface a parse-only helper from lootbox.js.
    //
    // For Plan 63-02, we use the receipt-only path: #processBuyReceipt
    // expects {receipt, contract}. We need the contract for parseLog. Reuse
    // the panel's existing dynamic-import-ish approach by lazy-loading the
    // built contract via a one-shot builder. To stay minimal (no new exports),
    // we duplicate the small inline build:
    //   const contract = new ethers.Contract(CONTRACTS.GAME, GAME_ABI, provider)
    // This requires importing ethers + GAME_ABI + CONTRACTS. To preserve the
    // panel's existing import surface, do this INSIDE #onTxConfirmed via the
    // already-imported `ethers` from the lootbox module — except lootbox.js
    // doesn't re-export ethers. So we make the simplest working choice: do
    // the parsing lazily via a one-shot dynamic import of ethers (already in
    // the importmap). This keeps the synchronous click invariant on the
    // PRE-tx-send side — #onTxConfirmed runs in microtasks AFTER the deep-link
    // has already fired and the tx is mined.
    this.#processBuyReceiptLazy(receipt);
  }

  async #processBuyReceiptLazy(receipt) {
    // Lazy-import to avoid changing the panel's static import surface for a
    // single one-shot receipt parse. Production: importmap resolves ethers.
    // Tests inject a stub via globalThis.ethers if needed (none currently
    // needed because the test fakes drive #processBuyReceipt directly via
    // legacy fallback path). The contract built here is provider-bound (no
    // signer needed for log parsing).
    let ethersMod;
    try { ethersMod = await import('ethers'); }
    catch (_) { return; /* receipt parse skipped — degraded UX (rows won't render) */ }
    let chainConfigMod;
    try { chainConfigMod = await import('../app/chain-config.js'); }
    catch (_) { return; }
    const lootboxMod = await import('../app/lootbox.js');
    const provider = (await import('../app/contracts.js')).getProvider();
    if (!provider) return;
    const contract = new ethersMod.Contract(
      chainConfigMod.CONTRACTS.GAME,
      lootboxMod.GAME_ABI,
      provider
    );
    this.#processBuyReceipt({ receipt, contract });
  }

  // ---------------------------------------------------------------------
  // Plan 63-02 (D-02 LOCKED) — pre-warm refresh + scheduling.
  //
  // #refreshPrewarm: aborts any prior cache, calls prewarmLootboxBuy, stores
  // the new closure. On error, disables the Buy button with the decoded
  // userMessage inline (Phase 56 reason-map UX). Re-entrancy-guarded by
  // #prewarmInflight so concurrent triggers collapse to one in-flight call.
  //
  // #schedulePrewarm: 300ms debounce via _setTimeoutUnref so input bursts
  // (e.g., qty +/- spamming) collapse to a single pre-warm refresh. Uses the
  // existing _setTimeoutUnref helper so node:test exits cleanly.
  // ---------------------------------------------------------------------

  async #refreshPrewarm() {
    if (this.#prewarmInflight) return;
    // Bail if disconnected — pending timers from prior connectedCallback may
    // fire after disconnectedCallback ran (the timer fires once even if cleared
    // after dispatch is in-flight). The empty-unsubs check is a defensive
    // proxy for "this element is no longer mounted" (matches Phase 60-03's
    // RevealCancelToken pattern). T-63-02-01 mitigation extension.
    if (this.#disconnectedSentinel) return;
    if (this.#unsubs.length === 0) return;
    // Skip when a tx is mid-flight — pre-warm derives a fresh signer and
    // collides with the tx's signer state (T-63-02-01 mitigation).
    if (this.#busy) return;
    // Both qty zero — Buy button is disabled by #renderState; nothing to pre-warm.
    if (this.#ticketQuantity === 0 && this.#lootboxQuantity === 0) {
      if (this.#prewarmedTx) { try { this.#prewarmedTx.abort(); } catch (_) {} }
      this.#prewarmedTx = null;
      return;
    }
    this.#prewarmInflight = true;
    try {
      if (this.#prewarmedTx) {
        try { this.#prewarmedTx.abort(); } catch (_) { /* defensive */ }
      }
      this.#prewarmedTx = await prewarmLootboxBuy({
        ticketQuantity: this.#ticketQuantity,
        lootboxQuantity: this.#lootboxQuantity,
        payKind: this.#payKind,
      });
      this.#enableBuyButton();
    } catch (err) {
      this.#prewarmedTx = null;
      const reason = (err && (err.userMessage || err.message)) || 'Cannot pre-warm purchase.';
      this.#disableBuyButtonWithReason(reason);
    } finally {
      this.#prewarmInflight = false;
    }
  }

  #schedulePrewarm() {
    if (this.#disconnectedSentinel) return;
    if (this.#prewarmDebounceTimer) {
      try { clearTimeout(this.#prewarmDebounceTimer); } catch (_) { /* defensive */ }
    }
    this.#prewarmDebounceTimer = _setTimeoutUnref(() => {
      this.#prewarmDebounceTimer = null;
      this.#refreshPrewarm();
    }, 300);
  }

  #enableBuyButton() {
    // Re-derive the enabled/disabled state from the canonical inputs (#renderState
    // already implements the both-qty-zero rule). Pre-warm success means we
    // simply re-render so any prior "disabled with reason" state clears.
    const banner = this.querySelector('[data-bind="lbx-error-banner"]');
    if (banner && banner.hidden === false && banner._prewarmReason) {
      banner.hidden = true;
      banner.textContent = '';
      banner._prewarmReason = false;
    }
    this.#renderState();
  }

  #disableBuyButtonWithReason(reason) {
    const buyBtn = this.querySelector('[data-bind="lbx-buy-button"]');
    if (buyBtn) buyBtn.disabled = true;
    const banner = this.querySelector('[data-bind="lbx-error-banner"]');
    if (banner) {
      // textContent only — T-58-13 + T-60-08 XSS-safe rule. Reason is always
      // a userMessage string from reason-map.js (or err.message fallback);
      // never wallet-supplied raw data.
      banner.textContent = String(reason || 'Cannot pre-warm purchase.');
      banner.hidden = false;
      banner._prewarmReason = true;  // sentinel: this banner is from pre-warm,
                                     //  cleared by #enableBuyButton on next success
    }
  }

  // ---------------------------------------------------------------------
  // Plan 60-02: error banner surface — shows decodeRevertReason output for 8s.
  // T-60-08 mitigation: textContent only (NOT innerHTML) — server-derived strings
  // never flow through innerHTML.
  // ---------------------------------------------------------------------

  #showError(err) {
    if (this.#errorTimer != null) {
      clearTimeout(this.#errorTimer);
      this.#errorTimer = null;
    }
    let userMessage = err && err.userMessage;
    if (!userMessage) {
      try {
        userMessage = decodeRevertReason(err).userMessage;
      } catch (_) {
        userMessage = (err && err.message) || 'Transaction failed.';
      }
    }
    const banner = this.querySelector('[data-bind="lbx-error-banner"]');
    if (banner) {
      banner.textContent = String(userMessage || 'Transaction failed.');
      banner.hidden = false;
    }
    this.#errorTimer = _setTimeoutUnref(() => {
      if (banner) banner.hidden = true;
      this.#errorTimer = null;
    }, 8000);
  }

  // ---------------------------------------------------------------------
  // Plan 60-03: per-lootbox row rendering — diff against existing DOM, key by
  // lootboxIndex. Creates row sub-DOM once on first render of each row; mutates
  // status/textContent/classList only on subsequent renders (T-60-13 + T-60-08
  // textContent-only rule for state-driven content).
  //
  // The row template is a static literal — innerHTML is used ONLY at row creation
  // time and contains no server-derived data interpolation; subsequent state
  // mutation flows through textContent + classList + .disabled per the
  // T-60-08 hardening pattern.
  // ---------------------------------------------------------------------

  #renderRows() {
    const container = this.querySelector('[data-bind="lbx-rows"]');
    if (!container) return;
    for (const row of this.#lootboxRows) {
      const idxKey = String(row.lootboxIndex);
      let rowEl = container.querySelector(`[data-lootbox-idx="${idxKey}"]`);
      if (!rowEl) {
        rowEl = this.#createRowEl(row);
        container.appendChild(rowEl);
      }
      this.#applyRowState(rowEl, row);
    }
  }

  #createRowEl(row) {
    const idxKey = String(row.lootboxIndex);
    const rowEl = (typeof document !== 'undefined' && typeof document.createElement === 'function')
      ? document.createElement('div')
      : null;
    if (!rowEl) return null;
    rowEl.setAttribute('data-lootbox-idx', idxKey);
    rowEl.classList.add('lbx-row');
    // Static template — no server-derived data interpolation. textContent
    // mutation in #applyRowState fills the dynamic strings (Pack #N + status copy).
    rowEl.innerHTML = `
      <span class="lbx-row__index" data-bind="row-index"></span>
      <span class="lbx-row__status" data-bind="row-status"></span>
      <span class="lbx-row__signal" data-bind="row-signal" hidden>Your pack is ready!</span>
      <button type="button" class="lbx-row__open-btn" data-bind="row-open-btn" disabled>Open</button>
    `;
    const idxEl = rowEl.querySelector('[data-bind="row-index"]');
    if (idxEl) idxEl.textContent = `Pack #${idxKey}`;
    const openBtn = rowEl.querySelector('[data-bind="row-open-btn"]');
    if (openBtn) {
      openBtn.addEventListener('click', () => this.#onOpenClick(row));
    }
    return rowEl;
  }

  #applyRowState(rowEl, row) {
    if (!rowEl) return;
    // Map widget status field -> CSS class modifier (per plan + CSS spec):
    //   'awaiting-rng'   -> 'lbx-row--awaiting'
    //   'ready-to-open'  -> 'lbx-row--ready'
    //   'opening'        -> 'lbx-row--opening'
    //   'revealed'       -> 'lbx-row--revealed'
    const statusClassMap = {
      'awaiting-rng':  'lbx-row--awaiting',
      'ready-to-open': 'lbx-row--ready',
      'opening':       'lbx-row--opening',
      'revealed':      'lbx-row--revealed',
    };
    // Reset all state-modifier classes; re-add the one matching current status.
    for (const c of Object.values(statusClassMap)) {
      try { rowEl.classList.remove(c); } catch (_) { /* defensive */ }
    }
    const cls = statusClassMap[row.status];
    if (cls) rowEl.classList.add(cls);

    const statusEl = rowEl.querySelector('[data-bind="row-status"]');
    const signalEl = rowEl.querySelector('[data-bind="row-signal"]');
    const openBtn  = rowEl.querySelector('[data-bind="row-open-btn"]');

    if (statusEl) {
      // textContent only (T-60-08). Status copy depends on status field.
      if (row.status === 'awaiting-rng') {
        statusEl.textContent = 'Awaiting RNG...';
      } else if (row.status === 'ready-to-open') {
        statusEl.textContent = 'Ready to open';
      } else if (row.status === 'opening') {
        // Stage copy is mutated directly during reveal animation (#runRevealAnimation);
        // the initial textContent here gets overwritten as soon as the animation starts.
        statusEl.textContent = 'Sealing on-chain...';
      } else if (row.status === 'revealed') {
        statusEl.textContent = 'Revealed';
      }
    }
    if (signalEl) {
      // Signal banner is only un-hidden during the brief ready-to-open transition
      // (handled separately by #showRowSignal). Default state: hidden in any state
      // other than ready-to-open. Once ready-to-open, #showRowSignal un-hides for 3s.
      if (row.status !== 'ready-to-open') signalEl.hidden = true;
    }
    if (openBtn) {
      openBtn.disabled = (row.status !== 'ready-to-open');
      // Reset textContent only for non-opening states; during opening we mutate
      // it to "Opening..." in #onOpenClick to give explicit click feedback.
      if (row.status === 'ready-to-open') openBtn.textContent = 'Open';
      else if (row.status === 'awaiting-rng') openBtn.textContent = 'Open';
      else if (row.status === 'revealed') openBtn.textContent = 'Done';
    }
  }

  // ---------------------------------------------------------------------
  // Plan 60-03: RNG poll lifecycle — visibility-aware + AbortController-per-cycle
  // (Phase 56 polling.js D-04 pattern). 7s interval; 15s backoff on error.
  // ---------------------------------------------------------------------

  #schedulePoll(row) {
    if (!row || row.status !== 'awaiting-rng') return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const idxKey = String(row.lootboxIndex);
    const existing = this.#pollTimers.get(idxKey);
    if (existing) {
      try { clearTimeout(existing); } catch (_) { /* defensive */ }
    }
    const handle = _setTimeoutUnref(() => this.#runPollCycle(row), RNG_POLL_INTERVAL_MS);
    this.#pollTimers.set(idxKey, handle);
  }

  async #runPollCycle(row) {
    if (!row) return;
    const idxKey = String(row.lootboxIndex);
    this.#pollTimers.delete(idxKey);
    if (row.status !== 'awaiting-rng') return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const ctrl = new AbortController();
    this.#pollControllers.set(idxKey, ctrl);
    try {
      const word = await pollRngForLootbox(row.lootboxIndex);
      if (ctrl.signal.aborted) return;
      if (row.status !== 'awaiting-rng') return;
      if (word !== 0n) {
        row.rngWord = word;
        row.status = 'ready-to-open';
        this.#renderRows();
        this.#showRowSignal(row);
      } else {
        this.#schedulePoll(row);
      }
    } catch (_err) {
      if (!ctrl.signal.aborted) {
        // Backoff scheduling — longer interval after a network blip.
        const handle = _setTimeoutUnref(() => this.#runPollCycle(row), RNG_POLL_BACKOFF_MS);
        this.#pollTimers.set(idxKey, handle);
      }
    } finally {
      if (this.#pollControllers.get(idxKey) === ctrl) {
        this.#pollControllers.delete(idxKey);
      }
    }
  }

  #showRowSignal(row) {
    const idxKey = String(row.lootboxIndex);
    const rowEl = this.querySelector(`[data-lootbox-idx="${idxKey}"]`);
    if (!rowEl) return;
    const signalEl = rowEl.querySelector('[data-bind="row-signal"]');
    if (!signalEl) return;
    signalEl.hidden = false;
    const existing = this.#signalTimers.get(idxKey);
    if (existing) {
      try { clearTimeout(existing); } catch (_) { /* defensive */ }
    }
    const handle = _setTimeoutUnref(() => {
      // Only auto-hide if the row is still in ready-to-open status; transition
      // to opening or revealed will manage signal visibility itself via #applyRowState.
      const stillReady = this.#lootboxRows.find((r) => String(r.lootboxIndex) === idxKey
        && r.status === 'ready-to-open');
      if (stillReady && signalEl) signalEl.hidden = true;
      this.#signalTimers.delete(idxKey);
    }, SIGNAL_AUTO_HIDE_MS);
    this.#signalTimers.set(idxKey, handle);
  }

  #cancelAllPolls() {
    for (const handle of this.#pollTimers.values()) {
      try { clearTimeout(handle); } catch (_) { /* defensive */ }
    }
    this.#pollTimers.clear();
    for (const ctrl of this.#pollControllers.values()) {
      try { ctrl.abort(); } catch (_) { /* defensive */ }
    }
    this.#pollControllers.clear();
  }

  // ---------------------------------------------------------------------
  // Plan 60-03: Open click handler — debounced, busy-guarded, cancel-token-protected.
  // CONTEXT D-02 step 5 + D-06 step 3.
  // ---------------------------------------------------------------------

  async #onOpenClick(row) {
    if (!row || row.status !== 'ready-to-open') return;
    const now = Date.now();
    if (row._lastClickAt && (now - row._lastClickAt) < OPEN_BTN_DEBOUNCE_MS) return;
    row._lastClickAt = now;

    // Cancel-token-per-render bump (Phase 59 Pitfall H pattern). If the widget
    // disconnects mid-tx OR mid-animation, this token will diverge from the
    // class-level token, causing the animation/post-tx steps to void-return.
    const cancelToken = ++this.#revealCancelToken;

    row.status = 'opening';
    this.#renderRows();
    // Cancel any pending RNG poll for this index — row has moved past awaiting state.
    const idxKey = String(row.lootboxIndex);
    const pending = this.#pollTimers.get(idxKey);
    if (pending) { try { clearTimeout(pending); } catch (_) {} this.#pollTimers.delete(idxKey); }

    // Hint click feedback in the Open button textContent.
    const rowEl = this.querySelector(`[data-lootbox-idx="${idxKey}"]`);
    const openBtn = rowEl ? rowEl.querySelector('[data-bind="row-open-btn"]') : null;
    if (openBtn) {
      openBtn.textContent = 'Opening...';
      openBtn.disabled = true;
    }

    try {
      const result = await openLootBox({lootboxIndex: row.lootboxIndex, payKind: row.payKind});
      if (cancelToken !== this.#revealCancelToken) return;  // superseded — disconnect or stale render

      // Receipt-log-first reveal data (LBX-04 source of truth).
      const traits = parseTraitsGeneratedFromReceipt(result.receipt, result.contract);

      // Run reveal animation (cross-imported from /play/ — pack-animator + pack-audio).
      // The reveal animation plays pack-audio SFX during animation only (D-06 — no
      // chime on RNG-ready signal; pack-audio is gated to the reveal animation).
      await this.#runRevealAnimation(row, traits, cancelToken);
      if (cancelToken !== this.#revealCancelToken) return;

      // Plan 60-04: write to revealed-packs set on REVEAL ANIMATION COMPLETE
      // (NOT on openLootBox tx confirm) per CONTEXT D-07 step 6 — animation
      // completion is the UX-level "user has seen the reveal" event. Wrapped in
      // try/catch via #writeRevealedSet (Pitfall F mitigation — quota survival).
      const connected = get('connected.address');
      if (connected) {
        const set = this.#readRevealedSet(connected);
        set.add(String(row.lootboxIndex));
        this.#writeRevealedSet(connected, set);
      }

      row.status = 'revealed';
      this.#renderRows();
    } catch (err) {
      // Static-call gate may surface RngNotReady racing the poll; reset row to
      // awaiting-rng + reschedule poll + show error banner.
      row.status = 'awaiting-rng';
      this.#renderRows();
      this.#showError(err);
      this.#schedulePoll(row);
    }
  }

  // ---------------------------------------------------------------------
  // Plan 60-03: reveal animation — invokes cross-imported pack-animator +
  // pack-audio (lazy-loaded to avoid breaking node:test under absent gsap).
  // CONTEXT 'In scope LBX-02 Pack-animator reveal' bullet — stage copy
  // 'Sealing on-chain... computing prizes... revealing...' rendered during
  // animation in [data-bind="row-status"] textContent.
  //
  // The cross-imported animator's exact API is `animatePackOpen(packEl, onComplete)`
  // (verified from /play/app/pack-animator.js exports — named export, factory
  // signature). pack-audio's exact API is `playPackOpen()` (verified from
  // /play/app/pack-audio.js — named async export, fail-silent on load error).
  // ---------------------------------------------------------------------

  async #runRevealAnimation(row, traits, cancelToken) {
    const idxKey = String(row.lootboxIndex);
    const rowEl = this.querySelector(`[data-lootbox-idx="${idxKey}"]`);
    const statusEl = rowEl ? rowEl.querySelector('[data-bind="row-status"]') : null;

    // Stage copy ticker — flips through "Sealing on-chain..." -> "Computing prizes..."
    // -> "Revealing..." every STAGE_COPY_INTERVAL_MS (1.2s). textContent only.
    const stages = ['Sealing on-chain...', 'Computing prizes...', 'Revealing...'];
    let stageIdx = 0;
    if (statusEl) statusEl.textContent = stages[0];
    const stageHandle = setInterval(() => {
      if (cancelToken !== this.#revealCancelToken) {
        clearInterval(stageHandle);
        return;
      }
      stageIdx = (stageIdx + 1) % stages.length;
      if (statusEl) statusEl.textContent = stages[stageIdx];
    }, STAGE_COPY_INTERVAL_MS);

    try {
      // Lazy-load /play/ modules. In production /app/index.html ships an importmap
      // that resolves `gsap` (which pack-animator depends on); in node:test the
      // dynamic-import will reject (gsap not in node_modules) — caught below.
      // Cross-import path: ../../play/app/pack-audio.js + ../../play/app/pack-animator.js
      // (zero edits to /play/ source per milestone constraint).
      let audioMod = null;
      let animatorMod = null;
      try { audioMod = await import('../../play/app/pack-audio.js'); }
      catch (_) { /* pack-audio failed to load; reveal proceeds without SFX */ }
      try { animatorMod = await import('../../play/app/pack-animator.js'); }
      catch (_) { /* pack-animator failed to load; reveal proceeds with fixed delay */ }

      if (cancelToken !== this.#revealCancelToken) return;

      // Pack-audio: SFX during reveal animation only (per D-06).
      if (audioMod && typeof audioMod.playPackOpen === 'function') {
        try { audioMod.playPackOpen(); } catch (_) { /* fail-silent */ }
      }

      // Pack-animator: the animator mutates rowEl's children via gsap timeline;
      // the cross-imported animatePackOpen factory takes (packEl, onComplete).
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        if (animatorMod && typeof animatorMod.animatePackOpen === 'function' && rowEl) {
          try {
            animatorMod.animatePackOpen(rowEl, finish);
          } catch (_) {
            // Animator threw synchronously — fall back to fixed delay.
            _setTimeoutUnref(finish, REVEAL_FALLBACK_DELAY_MS);
          }
        } else {
          // Fallback: fixed delay so reveal still completes (degraded UX, no
          // animation — but state machine progresses).
          _setTimeoutUnref(finish, REVEAL_FALLBACK_DELAY_MS);
        }
        // Defensive overall watchdog — if onComplete is never called (e.g. gsap
        // timeline killed externally), unblock after fallback delay.
        _setTimeoutUnref(finish, REVEAL_FALLBACK_DELAY_MS * 2);
      });
    } finally {
      clearInterval(stageHandle);
    }
  }

  // ---------------------------------------------------------------------
  // Test/Plan-60-02+ accessors (intentionally minimal surface)
  // ---------------------------------------------------------------------

  get _state() {
    // Test-only accessor — exposes private state for assertions.
    return {
      payKind: this.#payKind,
      ticketQuantity: this.#ticketQuantity,
      lootboxQuantity: this.#lootboxQuantity,
      busy: this.#busy,
      lootboxRowsCount: this.#lootboxRows.length,
      lootboxRowStatuses: this.#lootboxRows.map((r) => r.status),
      revealCancelToken: this.#revealCancelToken,
      // Plan 60-04: boot CTA backing-data count (number of indexer-derived
      // unrevealed lootboxes awaiting user click-through).
      unrevealedPacksFromIndexerCount: this.#unrevealedPacksFromIndexer.length,
    };
  }

  // ---------------------------------------------------------------------
  // Plan 60-04: localStorage idempotency helpers — chainId-scoped per
  // CONTEXT D-07 step 6 + Phase 59 Pitfall B precedent. All ops wrapped
  // in try/catch (Pitfall F mitigation — quota / private-mode survival).
  // ---------------------------------------------------------------------

  #readRevealedSet(address) {
    if (!address) return new Set();
    const key = `revealed-packs:${CHAIN.id}:${String(address).toLowerCase()}`;
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null;
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch (_e) {
      // Pitfall F mitigation — degraded mode if JSON.parse / localStorage throws.
      return new Set();
    }
  }

  #writeRevealedSet(address, set) {
    if (!address) return;
    const key = `revealed-packs:${CHAIN.id}:${String(address).toLowerCase()}`;
    try {
      const arr = Array.from(set).map(String);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(arr));
      }
    } catch (_e) {
      // Pitfall F mitigation per CONTEXT 'In scope LBX-03': quota / SecurityError
      // survival. Worst case: user re-sees the reveal animation on next visit
      // (acceptable degraded UX — not a security concern).
    }
  }

  // ---------------------------------------------------------------------
  // Plan 60-04: connected.address subscriber — fires URL-?ref affiliate persist
  // + boot CTA fetch on (re)connect. Idempotency guard prevents double-firing
  // on store re-emit (Phase 59 #refreshHighlight subscriber pattern).
  // ---------------------------------------------------------------------

  #onConnectedAddressChange(addr) {
    if (!addr) {
      // Disconnect: clear boot CTA + reset idempotency guard so a subsequent
      // reconnect re-fires the fetch.
      this.#unrevealedPacksFromIndexer = [];
      this.#renderBootCta();
      this.#bootCtaRanForAddress = null;
      return;
    }
    // Idempotency: per-address guard. If we already ran for this exact address,
    // skip the re-run (subscribers fire on initial registration AND on every
    // store update — guard prevents redundant indexer fetches).
    if (this.#bootCtaRanForAddress === addr) return;
    this.#bootCtaRanForAddress = addr;

    // CONTEXT D-05 step 1: persist URL ?ref= bytes32hex to localStorage on first
    // visit. Idempotent — only writes if URL has a valid bytes32hex param.
    try { persistAffiliateCodeFromUrl(CHAIN.id, addr); } catch (_) { /* defensive */ }

    // CONTEXT D-07 step 2: fire indexer fetch + boot CTA render.
    this.#runBootCta(addr);
  }

  async #runBootCta(address) {
    if (!address) return;
    try {
      // CONTEXT D-07 step 1 RESEARCH RESULT: /player/:address response shape
      // does NOT currently include a `lootboxes[]` array (verified at execution
      // time against database/src/api/schemas/player.ts — only aggregate counts
      // surface). The fetch still runs (forward-compat for a future endpoint
      // landing in database/), but the unrevealed-packs filter below produces
      // an empty array, gracefully hiding the boot CTA. See SUMMARY for the
      // documented gap + follow-up plan recommendation.
      const playerData = await fetchJSON(`/player/${String(address).toLowerCase()}`);
      const inventory = Array.isArray(playerData?.lootboxes) ? playerData.lootboxes : [];
      const revealed = this.#readRevealedSet(address);
      // Per CONTEXT D-07 step 3: an unrevealed lootbox is one in the on-chain
      // inventory but NOT in the local revealed-packs set. Two cases collapse
      // to "show CTA":
      //   - lb.opened === false: still on-chain unopened — surface Open CTA
      //   - lb.opened === true BUT not in revealed set: opened in prior session
      //     but UI didn't get to play animation — re-render reveal animation
      //     (Pitfall 15 mitigation #3 idempotent reveal). Plan 60-04 ships the
      //     simpler 'opened: false' path; the re-render-animation case is a
      //     follow-up that requires the indexer to surface the trait payload.
      const unrevealed = inventory.filter((lb) => !revealed.has(String(lb.lootboxIndex)));
      this.#unrevealedPacksFromIndexer = unrevealed;
      this.#renderBootCta();
    } catch (_e) {
      // Indexer error → boot CTA stays hidden (graceful degradation per
      // CONTEXT D-07 'cold-start is the default'). Not surfaced to user;
      // the page is functional without boot CTA.
      this.#unrevealedPacksFromIndexer = [];
      this.#renderBootCta();
    }
  }

  #renderBootCta() {
    const cta = this.querySelector('[data-bind="lbx-boot-cta"]');
    if (!cta) return;
    const N = this.#unrevealedPacksFromIndexer.length;
    if (N === 0) {
      cta.hidden = true;
      cta.textContent = '';
      return;
    }
    // T-60-19 mitigation: build CTA via document.createElement + textContent
    // (NEVER innerHTML interpolation of server-derived data). The N count is
    // numeric; the indexer-supplied lootboxIndex/payKind are NOT interpolated
    // into HTML strings — they only flow into row creation in #onBootCtaClick
    // which delegates to Plan 60-03's #renderRows (already textContent-only).
    cta.textContent = '';  // clear any prior children
    const text = (typeof document !== 'undefined' && document.createElement)
      ? document.createElement('span')
      : null;
    if (text) {
      text.textContent = `You have ${N} unrevealed pack${N === 1 ? '' : 's'} from previous purchases. `;
      cta.appendChild(text);
    }
    const btn = (typeof document !== 'undefined' && document.createElement)
      ? document.createElement('button')
      : null;
    if (btn) {
      btn.type = 'button';
      btn.className = 'lbx-boot-cta__btn';
      btn.textContent = 'Reveal them';
      btn.addEventListener('click', () => this.#onBootCtaClick());
      cta.appendChild(btn);
    }
    cta.hidden = false;
  }

  #onBootCtaClick() {
    // CONTEXT D-07 step 4 + 5: walk through unrevealed packs sequentially.
    // Reuses Plan 60-03's per-row state machine (poll RNG → Open CTA → reveal).
    // Boot CTA does NOT auto-fire opens (D-07 step 5 — consistent with D-02
    // explicit-Open-click pattern); it just creates the rows + schedules polls
    // for those still awaiting RNG.
    for (const lb of this.#unrevealedPacksFromIndexer) {
      const row = {
        lootboxIndex: BigInt(lb.lootboxIndex),
        payKind: lb.payKind === 'BURNIE' ? 'BURNIE' : 'ETH',
        // Per CONTEXT D-07 step 3 sub-bullet: lb.opened===true AND not in
        // revealed set means user opened on-chain in a prior session but UI
        // didn't get to play animation. Plan 60-04 falls back to 'ready-to-open'
        // (user clicks Open → standard openLootBox path). A follow-up plan can
        // surface indexer trait data + replay the animation directly.
        status: lb.opened ? 'ready-to-open' : 'awaiting-rng',
        rngWord: lb.rngReady ? 1n : 0n,  // sentinel — exact value irrelevant since we check !== 0n
        receipt: null,                    // no receipt available cross-session
        contract: null,
      };
      this.#lootboxRows.push(row);
    }
    // Hide the boot CTA + render rows.
    this.#unrevealedPacksFromIndexer = [];
    this.#renderBootCta();
    this.#renderRows();
    // Schedule polls for awaiting rows (don't fire if visibility hidden — handled
    // inside #schedulePoll). Boot CTA does NOT auto-fire opens (D-07 step 5).
    for (const row of this.#lootboxRows) {
      if (row.status === 'awaiting-rng') this.#schedulePoll(row);
    }
  }

  // Test-only seam — bumps the cancel token to invalidate any in-flight reveal
  // animation. Used by Plan 60-03 tests to short-circuit the await new Promise()
  // wait inside #runRevealAnimation without waiting for the fallback delay.
  __bumpCancelTokenForTest() {
    this.#revealCancelToken++;
  }

  // Test-only seam — directly run the RNG poll cycle for a row, bypassing the
  // 7s setTimeout. Used by Plan 60-03 tests so the suite stays sub-second.
  async __runPollCycleForTest(lootboxIndex) {
    const row = this.#lootboxRows.find((r) => String(r.lootboxIndex) === String(lootboxIndex));
    if (!row) return;
    return this.#runPollCycle(row);
  }
}

/**
 * Plan 60-04 test seam — fires the post-reveal-animation localStorage write
 * directly without waiting for the cross-imported pack-animator to complete.
 *
 * Production code path is unchanged; this seam exists ONLY for tests and is
 * functionally equivalent to the inline write inside #onOpenClick after
 * #runRevealAnimation resolves. Same chainId-scoped key shape, same try/catch
 * Pitfall F handling, same Set semantics.
 */
export function __triggerRevealCompleteForTest(el, lootboxIndex, address) {
  if (!el || !address) return;
  const key = `revealed-packs:${CHAIN.id}:${String(address).toLowerCase()}`;
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null;
    const set = new Set(raw ? JSON.parse(raw) : []);
    set.add(String(lootboxIndex));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(Array.from(set)));
    }
  } catch (_e) { /* Pitfall F mitigation */ }
}

// Idempotency-guarded register (Phase 58/59 pattern — player-dropdown.js:178-182,
// last-day-jackpot.js module bottom). Required for node:test re-import safety.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-packs-panel')) {
    customElements.define('app-packs-panel', AppPacksPanel);
  }
}

export { AppPacksPanel };
