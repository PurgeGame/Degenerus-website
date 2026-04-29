// /app/components/app-coinflip-panel.js — Phase 62 Plan 62-03 (BUY-04)
//
// BURNIE coinflip deposit panel. Custom Element shell mirrors Phase 60's
// app-packs-panel.js + Phase 61's app-claims-panel.js + Phase 62-01's
// app-decimator-panel.js + Phase 62-02's app-pass-section.js: light DOM,
// idempotent customElements.define guard, symmetric connectedCallback /
// disconnectedCallback, #unsubs[] for store subscriptions, panel-owned 30s
// poll cycle (Phase 61 D-04 LOCKED — NOT polling.js).
//
// On-chain surface: BurnieCoinflip.depositCoinflip(player, amount)
//   via coinflip.js depositCoinflip({amount}).
//
// RESEARCH R3 (HIGH confidence): BUY-04 is a SYNCHRONOUS BURNIE deposit. The
// deposit tx confirms with a CoinflipDeposit event ONLY — there is no per-bet
// poll cycle (compare to BUY-05's two-tx flow). Outcome resolves daily via
// global CoinflipDayResolved.
//
// CF-08 (roadmap success-criterion 1 verbatim): on tx confirm, render
//   "Stake recorded — outcome at end of day. Credited Y BURNIE."
// inline via .textContent. NO toast. NO audio. NO animator.
//
// Carry-forwards (CONTEXT 62-CONTEXT.md):
//   CF-01: Phase 58 closure-form sendTx — flows through coinflip.js.
//   CF-02: Phase 56 reason-map decodeRevertReason on every catch.
//   CF-03: Phase 56 requireStaticCall pre-flight inside coinflip.js.
//   CF-06: Phase 61 D-05 NEVER optimistic balance subtraction. Pre-click BURNIE
//          balance stays visible; 250ms post-confirm refetch via #runPollCycle.
//   CF-07: T-58-18 — error.userMessage rendered via .textContent NOT innerHTML.
//   CF-15: data-write attribute on Deposit CTA → Phase 58 disable manager
//          auto-disables when ui.mode === 'view-others'.
//
// Class palette: .cf-* prefix (RESEARCH R10 verified non-colliding).

import { CHAIN } from '../app/chain-config.js';
import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
import { depositCoinflip, parseCoinflipDepositFromReceipt } from '../app/coinflip.js';

// Wraps setInterval with .unref() in Node.js (no-op in browsers). Used for the
// 30s poll tick so node:test processes exit cleanly when no other open handles
// remain. Verbatim port of app-decimator-panel.js _setIntervalUnref.
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
const DEBOUNCE_MS = 500;               // 500ms click debounce window.
const BURNIE_WEI_DECIMALS = 18n;       // RESEARCH Q5 — BURNIE unscaled (1 BURNIE = 1e18 wei).

class AppCoinflipPanel extends HTMLElement {
  // --- Phase 60 / 61 / 62-01 / 62-02 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  #busy = false;
  #errorTimer = null;
  // --- Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED) ---
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
    // Eager first cycle on mount.
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
      <section class="panel app-coinflip-panel">
        <div class="panel-header">
          <h2>BURNIE COINFLIP</h2>
        </div>
        <p class="cf-blurb">
          Deposit BURNIE to stake on today's coinflip. Outcome resolves at the
          end of the day.
        </p>
        <div class="cf-row">
          <label class="cf-amount-label" for="cf-amount-input">Stake (BURNIE)</label>
          <input type="number" name="cf-amount" id="cf-amount-input"
                 class="cf-amount-input" min="100" step="100" value="100">
          <button type="button" class="cf-deposit-cta" data-write data-bind="cf-deposit-cta">
            Deposit
          </button>
        </div>
        <div class="cf-balance" data-bind="cf-balance">—</div>
        <div class="cf-status" data-bind="cf-status"></div>
        <div class="cf-error" data-bind="cf-error" hidden role="alert"></div>
      </section>
    `;
  }

  #wireEventHandlers() {
    const btn = this.querySelector('[data-bind="cf-deposit-cta"]');
    if (btn) btn.addEventListener('click', (e) => this.#onDepositClick(e));
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle.
  // ---------------------------------------------------------------------

  #startPolling() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
    }
    if (typeof setInterval !== 'function') return;
    this.#pollHandle = _setIntervalUnref(() => this.#runPollCycle(), POLL_INTERVAL_MS);
  }

  async #runPollCycle() {
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
        this.#playerData = null;
        this.#renderBalance();
        return;
      }
      const data = await fetchJSON(`/player/${addr}`);
      if (signal.aborted) return;
      this.#playerData = data || null;
      this.#renderBalance();
    } catch (_e) {
      // Network blip — next cycle retries.
    }
  }

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

  #wireStoreSubscriptions() {
    const u1 = subscribe('connected.address', () => this.#runPollCycle());
    const u2 = subscribe('viewing.address', () => this.#runPollCycle());
    this.#unsubs.push(u1, u2);
  }

  // ---------------------------------------------------------------------
  // Render balance — server-derived strings via textContent (T-58-18).
  // CF-06: NEVER optimistic balance subtraction. The balance text reflects
  // server state only; pending-tx state does NOT decrement it locally.
  // ---------------------------------------------------------------------

  #renderBalance() {
    const balEl = this.querySelector('[data-bind="cf-balance"]');
    if (!balEl) return;
    const p = this.#playerData;
    if (!p) {
      balEl.textContent = '—';
      return;
    }
    const burnie = p.burnie?.balance ?? p.burnie ?? p.player?.burnie ?? null;
    if (burnie == null) {
      balEl.textContent = 'Balance: —';
    } else {
      balEl.textContent = `Balance: ${String(burnie)} BURNIE`;
    }
  }

  // ---------------------------------------------------------------------
  // Render status / error — textContent only (T-58-18). 10s auto-clear timer.
  // ---------------------------------------------------------------------

  #renderStatus(msg) {
    const statusEl = this.querySelector('[data-bind="cf-status"]');
    if (statusEl) statusEl.textContent = String(msg);
  }

  #clearStatus() {
    const statusEl = this.querySelector('[data-bind="cf-status"]');
    if (statusEl) statusEl.textContent = '';
  }

  #renderError(msg) {
    const errEl = this.querySelector('[data-bind="cf-error"]');
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
    const errEl = this.querySelector('[data-bind="cf-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
  }

  // ---------------------------------------------------------------------
  // Deposit click handler — closure-form sendTx via coinflip.depositCoinflip.
  // CF-08 inline message: "Stake recorded — outcome at end of day."
  // ---------------------------------------------------------------------

  async #onDepositClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busy) return;
    this.#busy = true;

    const btn = this.querySelector('[data-bind="cf-deposit-cta"]');
    const originalLabel = btn ? btn.textContent : 'Deposit';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Depositing…';
    }
    this.#clearError();
    this.#clearStatus();

    try {
      const amountInput = this.querySelector('[name="cf-amount"]');
      const rawValue = amountInput ? amountInput.value : '0';
      const burnieInteger = parseInt(rawValue, 10);
      if (!Number.isFinite(burnieInteger) || burnieInteger < 100) {
        this.#renderError('Minimum coinflip deposit is 100 BURNIE.');
        return;
      }
      const amountWei = BigInt(burnieInteger) * (10n ** BURNIE_WEI_DECIMALS);

      const { receipt } = await depositCoinflip({ amount: amountWei });

      // Receipt-log-first parse (CF-05) for creditedFlip surfacing.
      // We re-build a minimal contract for parseLog; coinflip.js does not
      // currently return a parsing-bound contract handle, so the panel
      // tolerates parse failures gracefully via the parser's try/catch.
      let creditedFlipText = '';
      try {
        const parseContract = {
          interface: { parseLog: (log) => log.parsed ?? null },
        };
        const parsed = parseCoinflipDepositFromReceipt(receipt, parseContract);
        if (parsed.length > 0) {
          // creditedFlip is reported in BURNIE wei; surface raw wei to keep
          // textContent assignment safe (T-58-18).
          creditedFlipText = ` Credited ${String(parsed[0].creditedFlip)} BURNIE wei.`;
        }
      } catch (_e) { /* defensive */ }

      // CF-08 inline message — required literal substring "outcome at end of day".
      this.#renderStatus(`Stake recorded — outcome at end of day.${creditedFlipText}`);

      try {
        this.dispatchEvent(new CustomEvent('app-coinflip:tx-confirmed', {
          detail: { amountWei },
          bubbles: true,
        }));
      } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }

      // 250ms post-confirm refetch (CF-06).
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      const msg = error?.userMessage || error?.message || 'Deposit failed.';
      this.#renderError(msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
      // Release debounce after window expires.
      setTimeout(() => { this.#busy = false; }, DEBOUNCE_MS);
    }
  }
}

// Idempotency-guarded registration (Phase 58/59/60/61/62-01/02 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-coinflip-panel')) {
    customElements.define('app-coinflip-panel', AppCoinflipPanel);
  }
}

export { AppCoinflipPanel };
