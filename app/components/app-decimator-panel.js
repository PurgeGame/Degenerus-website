// /app/components/app-decimator-panel.js — Phase 62 Plan 62-01 (BUY-01)
//
// Decimator level-mint panel. Custom Element shell mirrors Phase 60's
// app-packs-panel.js + Phase 61's app-claims-panel.js: light DOM, idempotent
// customElements.define guard, symmetric connectedCallback / disconnectedCallback,
// #unsubs[] for store subscriptions, panel-owned 30s poll cycle (Phase 61 D-04
// LOCKED — NOT polling.js's fictional generic API per RESEARCH Pitfall 9).
//
// On-chain surface: DegenerusGame.purchase() (RESEARCH Example 1) — SAME call as
// Phase 60 LBX-01, just with ticketQuantity > 0 and lootboxQuantity = 0 for
// tickets-only level-mint. Re-exports purchaseEth + purchaseCoin from decimator.js
// (which re-exports from lootbox.js — eager import triggers Phase 60's reason-map
// registrations: GameOverPossible / AfKingLockActive / NotApproved).
//
// Carry-forwards (CONTEXT 62-CONTEXT.md):
//   CF-01: Phase 58 closure-form sendTx — flows through decimator.purchaseEth/Coin
//          → lootbox.js → sendTx((s) => new Contract(...).method(args), 'Action').
//   CF-02: Phase 56 reason-map decodeRevertReason on every catch.
//   CF-03: Phase 56 requireStaticCall pre-flight inside lootbox.js.
//   CF-05: Phase 60 receipt-log-first parsers (re-imported when needed).
//   CF-06: Phase 61 D-05 NEVER optimistic balance subtraction. Pre-click balance
//          stays visible; 250ms post-confirm refetch via #runPollCycle.
//   CF-07: T-58-18 — error.userMessage rendered via .textContent NOT innerHTML.
//   CF-15: data-write attribute on Buy CTA → Phase 58 disable manager auto-disables
//          when ui.mode === 'view-others'.
//
// Class palette: .dec-* prefix (RESEARCH R10 verified non-colliding against
// existing 9 prefixes: .app-/.chain-/.clm-/.last-/.lbx-/.ldj-/.player-/.view-/.wallet-).

import { CHAIN } from '../app/chain-config.js';
import { displayEth } from '../app/scaling.js';
import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
// Eager import — triggers Phase 60's reason-map registrations as a side-effect
// (GameOverPossible / AfKingLockActive / NotApproved). decimator.js is a thin
// re-export of lootbox.js's purchaseEth + purchaseCoin per Plan 62-01 D-01.
import { purchaseEth, purchaseCoin } from '../app/decimator.js';
// readAffiliateCode comes directly from lootbox.js — Plan 62-01's decimator.js
// only re-exports the two purchase helpers per its minimal-surface design.
import { readAffiliateCode } from '../app/lootbox.js';

// Wraps setInterval with .unref() in Node.js (no-op in browsers). Used for the
// 30s poll tick so node:test processes exit cleanly when no other open handles
// remain. Verbatim port of app-claims-panel.js _setIntervalUnref (Phase 61).
function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

const POLL_INTERVAL_MS = 30_000;       // Phase 56 D-04 / Phase 61 D-04 LOCKED.
const POST_CONFIRM_REFETCH_MS = 250;   // CF-06 — 250ms debounced refetch on tx confirm.
const ERROR_AUTO_CLEAR_MS = 10_000;    // 10s — mirrors Phase 61 D-05 pattern.

class AppDecimatorPanel extends HTMLElement {
  // --- Phase 60 / 61 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  #busy = false;
  #errorTimer = null;
  // --- Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED — NOT polling.js) ---
  #pollHandle = null;
  #pollController = null;
  #lastPollAt = 0;
  #visibilityListener = null;
  // --- Pinned data from /player/:address (server-derived; rendered via textContent) ---
  #playerData = null;
  #pinnedAddress = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireEventHandlers();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    this.#startPolling();
    // Eager first cycle on mount — no need to wait 30s.
    this.#runPollCycle();
  }

  disconnectedCallback() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
      this.#pollController = null;
    }
    if (this.#visibilityListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_) { /* defensive */ }
    }
    this.#visibilityListener = null;
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
  }

  // ---------------------------------------------------------------------
  // Render shell — STATIC innerHTML; T-58-18 hardening (no server data).
  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <div class="panel app-decimator-panel">
        <div class="panel-header">
          <h2>DECIMATOR</h2>
        </div>

        <p class="dec-blurb">
          Mint decimator levels by purchasing tickets. Each ticket counts toward
          the next level threshold.
        </p>

        <!-- Player snapshot (server-derived → populated via textContent in #render) -->
        <div class="dec-snapshot">
          <span class="dec-snapshot__label">Current level:</span>
          <span class="dec-level" data-bind="dec-level">—</span>
          <span class="dec-snapshot__label">Tickets owned:</span>
          <span class="dec-balance" data-bind="dec-balance">—</span>
        </div>

        <!-- Quantity input (planner discretion: numeric input over +/- picker) -->
        <div class="dec-input-row">
          <label class="dec-input-label" for="dec-tickets-input">Tickets to buy</label>
          <input type="number" name="dec-tickets" id="dec-tickets-input"
                 class="dec-input" min="1" step="1" value="1">
        </div>

        <!-- Pay-kind toggle (CONTEXT D-01: ETH | BURNIE) -->
        <div class="dec-input-row">
          <label class="dec-input-label" for="dec-paykind-select">Pay with</label>
          <select name="dec-paykind" id="dec-paykind-select" class="dec-select">
            <option value="eth" selected>ETH</option>
            <option value="coin">BURNIE</option>
          </select>
        </div>

        <!-- Buy CTA (CF-15: data-write triggers Phase 58 view-mode disable manager) -->
        <button type="button" class="dec-buy-cta" data-write data-bind="dec-buy-cta">
          Buy
        </button>

        <!-- Error display (T-58-18: textContent-only target) -->
        <div class="dec-error" data-bind="dec-error" hidden role="alert"></div>
      </div>
    `;
  }

  #wireEventHandlers() {
    const buyBtn = this.querySelector('[data-bind="dec-buy-cta"]');
    if (buyBtn) buyBtn.addEventListener('click', (e) => this.#onBuyClick(e));
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED — NOT polling.js).
  // ---------------------------------------------------------------------

  #startPolling() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
    }
    if (typeof setInterval !== 'function') return;
    this.#pollHandle = _setIntervalUnref(() => this.#runPollCycle(), POLL_INTERVAL_MS);
  }

  async #runPollCycle() {
    // Visibility guard — pause polling while tab hidden.
    if (typeof document !== 'undefined'
      && document.visibilityState
      && document.visibilityState !== 'visible') {
      return;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
    }
    this.#pollController = new AbortController();
    const signal = this.#pollController.signal;
    this.#lastPollAt = Date.now();

    try {
      const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
        || get('viewing.address')
        || get('connected.address')
        || null;
      this.#pinnedAddress = addr;
      if (!addr) {
        // No address — clear snapshot.
        this.#playerData = null;
        this.#renderSnapshot();
        return;
      }
      const data = await fetchJSON(`/player/${addr}`);
      if (signal.aborted) return;
      this.#playerData = data || null;
      this.#renderSnapshot();
    } catch (_e) {
      // Network blip — next cycle retries. Don't crash the panel.
    }
  }

  // Visibility-aware refresh — on foreground return AFTER ≥5min hidden, fire
  // an immediate cycle within 1s. Mirrors Phase 56 D-04 + Phase 61 D-04.
  #wireVisibilityRePoll() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#visibilityListener = () => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - this.#lastPollAt;
      if (elapsed >= 5 * 60 * 1000) {
        this.#runPollCycle();
      }
    };
    document.addEventListener('visibilitychange', this.#visibilityListener);
  }

  // Store subscriptions — Phase 58 namespace. On wallet switch (connected.address)
  // OR view-target switch (viewing.address), fire an immediate cycle restart.
  #wireStoreSubscriptions() {
    const u1 = subscribe('connected.address', () => this.#runPollCycle());
    const u2 = subscribe('viewing.address', () => this.#runPollCycle());
    this.#unsubs.push(u1, u2);
  }

  // ---------------------------------------------------------------------
  // Render snapshot — server-derived strings via textContent (T-58-18).
  // CF-06: NEVER optimistic balance subtraction. The balance text reflects
  // server state only; pending-tx state does NOT decrement it locally.
  // ---------------------------------------------------------------------

  #renderSnapshot() {
    const levelEl = this.querySelector('[data-bind="dec-level"]');
    const balEl = this.querySelector('[data-bind="dec-balance"]');
    if (!levelEl || !balEl) return;
    const p = this.#playerData;
    if (!p) {
      levelEl.textContent = '—';
      balEl.textContent = '—';
      return;
    }
    // Player level — multiple shapes possible (consolidated dashboard varies).
    // Defensive lookup — use textContent so any string flows safely.
    const level = p.level ?? p.currentLevel ?? p.player?.level ?? '—';
    levelEl.textContent = String(level);
    // Tickets owned — wei-scaled per Phase 56 D-03; displayEth divides by 1e18.
    // Tickets are 2-decimal scaled (Phase 60 ticketQuantity * 100), so the
    // raw indexer value may be either a raw count or a wei-scaled bigint.
    // We prefer dailyActivity.ticketsOwned / tickets aggregate; fall back to '—'.
    const tickets = p.tickets?.amount
      ?? p.tickets
      ?? p.player?.tickets
      ?? null;
    if (tickets == null) {
      balEl.textContent = '—';
    } else if (typeof tickets === 'string' || typeof tickets === 'bigint') {
      // Try displayEth first (handles wei-scaled); fall back to raw string.
      try {
        balEl.textContent = displayEth(tickets);
      } catch (_e) {
        balEl.textContent = String(tickets);
      }
    } else {
      balEl.textContent = String(tickets);
    }
  }

  // ---------------------------------------------------------------------
  // Buy click handler — closure-form sendTx via decimator.purchaseEth/Coin.
  // CF-01: closure form is enforced inside lootbox.js (re-exported).
  // CF-06: NO optimistic balance subtraction. Pre-click balance stays visible.
  //        On confirm → 250ms post-confirm refetch via #runPollCycle.
  // CF-07: error.userMessage rendered via textContent (T-58-18).
  // T-62-01-04: #busy guard makes double-clicks invoke purchaseEth exactly once.
  // ---------------------------------------------------------------------

  async #onBuyClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busy) return;
    this.#busy = true;

    const btn = this.querySelector('[data-bind="dec-buy-cta"]');
    const originalLabel = btn ? btn.textContent : 'Buy';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Buying…';
    }
    // Defensive: clear any prior error before a fresh attempt.
    this.#clearError();

    try {
      const ticketsInput = this.querySelector('[name="dec-tickets"]');
      const rawValue = ticketsInput ? ticketsInput.value : '0';
      const ticketQuantity = parseInt(rawValue, 10);
      if (!Number.isFinite(ticketQuantity) || ticketQuantity <= 0) {
        this.#renderError('Enter ticket quantity 1 or more.');
        return;
      }

      const payKindSelect = this.querySelector('[name="dec-paykind"]');
      const payKind = payKindSelect ? payKindSelect.value : 'eth';

      const buyer = get('connected.address');
      const affiliateCode = readAffiliateCode(CHAIN.id, buyer);

      // Tickets-only level-mint — lootboxQuantity defaults to 0 (lootbox.js
      // signature: { ticketQuantity, lootboxQuantity, affiliateCode? }).
      const args = { ticketQuantity, lootboxQuantity: 0, affiliateCode };

      if (payKind === 'coin') {
        await purchaseCoin(args);
      } else {
        await purchaseEth(args);
      }

      // Success — dispatch panel event for any external listener (mirrors
      // Phase 61's app-claims:tx-confirmed pattern).
      try {
        this.dispatchEvent(new CustomEvent('app-decimator:tx-confirmed', {
          detail: { ticketQuantity, payKind },
          bubbles: true,
        }));
      } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }

      // 250ms post-confirm refetch (CF-06) — additive to the 30s poll tick.
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      // Decoded structured-revert error from lootbox.js (.userMessage / .code
      // / .recoveryAction / .cause). Render via textContent (T-58-18).
      const msg = error?.userMessage || error?.message || 'Buy failed.';
      this.#renderError(msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
      this.#busy = false;
    }
  }

  // ---------------------------------------------------------------------
  // Error rendering — textContent only (T-58-18). 10s auto-clear timer.
  // ---------------------------------------------------------------------

  #renderError(msg) {
    const errEl = this.querySelector('[data-bind="dec-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
    }
    this.#errorTimer = setTimeout(() => this.#clearError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimer && typeof this.#errorTimer.unref === 'function') {
      try { this.#errorTimer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearError() {
    const errEl = this.querySelector('[data-bind="dec-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
  }
}

// Idempotency-guarded registration (Phase 58/59/60/61 pattern). Required for
// node:test re-import safety AND production hot-module-replacement scenarios.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-decimator-panel')) {
    customElements.define('app-decimator-panel', AppDecimatorPanel);
  }
}

export { AppDecimatorPanel };
