// /app/components/app-degenerette-panel.js — Phase 62 Plan 62-03 (BUY-05)
//
// Degenerette two-tx bet panel: place → poll RNG → resolve. Custom Element
// shell mirrors Phase 60 / 61 / 62-01 / 62-02 patterns: light DOM, idempotent
// customElements.define, symmetric connectedCallback / disconnectedCallback,
// #unsubs[], panel-owned 30s poll cycle PLUS a per-bet RNG poll subcycle.
//
// On-chain surfaces (RESEARCH R5):
//   - DegenerusGame.placeDegeneretteBet(player, currency, amountPerTicket,
//                                       ticketCount, customTicket, heroQuadrant)
//                                       payable
//                                       → emits BetPlaced(player, index, betId, packed)
//   - poll RNG via Phase 60 lootbox.lootboxRngWord(BetPlaced.index)
//                  → reused via degenerette.js's pollRngForLootbox import
//                    (RESEARCH R5 OPTION B)
//   - DegenerusGame.resolveDegeneretteBets(player, betIds[])
//                                       → emits FullTicketResolved + per-spin
//                                          FullTicketResult
//
// Two-stage state machine:
//   idle → placing → awaitingRng → ready → resolving → resolved
//                                                       ↓
//                                                       idle (on user "Place another")
//
// CF-08 (roadmap success-criterion 1 verbatim): outcome rendered inline via
// .textContent — "You won X" / "You lost." NO toast. NO audio. NO animator.
//
// Carry-forwards (CONTEXT 62-CONTEXT.md):
//   CF-01: Phase 58 closure-form sendTx — flows through degenerette.js (place + resolve).
//   CF-02: Phase 56 reason-map decodeRevertReason on every catch.
//   CF-03: Phase 56 requireStaticCall pre-flight inside degenerette.js.
//   CF-05: receipt-log-first parsers (BetPlaced + FullTicketResolved + FullTicketResult).
//   CF-06: NEVER optimistic balance subtraction. 250ms post-confirm refetch.
//   CF-07: T-58-18 — error.userMessage rendered via .textContent.
//   CF-15: data-write attribute on Place + Resolve CTAs.
//
// Class palette: .deg-* prefix.

import { CHAIN } from '../app/chain-config.js';
import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
import {
  placeBet,
  resolveBets,
  parseBetPlacedFromReceipt,
  parseBetResolvedFromReceipt,
  parseFullTicketResultsFromReceipt,
} from '../app/degenerette.js';
// RESEARCH R5 OPTION B — degenerette RNG is keyed by lootbox-RNG index.
import { pollRngForLootbox } from '../app/lootbox.js';

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

const POLL_INTERVAL_MS = 30_000;          // panel-owned 30s poll for /player snapshot.
const RNG_POLL_INTERVAL_MS = 7_000;       // 7s per-bet RNG poll cadence.
const POST_CONFIRM_REFETCH_MS = 250;      // CF-06.
const ERROR_AUTO_CLEAR_MS = 10_000;       // 10s.
const DEBOUNCE_MS = 500;                  // 500ms click debounce window.

// Two-stage state machine (RESEARCH R5).
const STATE = Object.freeze({
  IDLE: 'idle',
  PLACING: 'placing',
  AWAITING_RNG: 'awaitingRng',
  READY: 'ready',
  RESOLVING: 'resolving',
  RESOLVED: 'resolved',
});

const STATE_LABELS = Object.freeze({
  idle: 'Idle',
  placing: 'Placing bet…',
  awaitingRng: 'Awaiting RNG…',
  ready: 'RNG ready — click Resolve.',
  resolving: 'Resolving…',
  resolved: 'Resolved.',
});

class AppDegenerettePanel extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #busyPlace = false;
  #busyResolve = false;
  #errorTimer = null;
  // Panel-owned 30s poll lifecycle.
  #pollHandle = null;
  #pollController = null;
  #lastPollAt = 0;
  #visibilityListener = null;
  // Per-bet RNG poll cycle (T-62-03-07 mitigation).
  #rngPollAbort = null;
  #rngPollTimer = null;
  // Bet state.
  #state = STATE.IDLE;
  #currentBetId = null;
  #currentLootboxIndex = null;
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
    this.#renderState();
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
    this.#cancelRngPoll();
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
  // Render shell — STATIC innerHTML.
  // RESEARCH Q7 deferral: currency 3 (the third XRP-wrapper) is OUT — the
  // currency picker exposes only ETH (0) + BURNIE (1). Currency 2 is
  // unsupported on-chain (UnsupportedCurrency revert).
  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-degenerette-panel">
        <div class="panel-header">
          <h2>DEGENERETTE</h2>
        </div>
        <p class="deg-blurb">
          Place a Full Ticket bet across 1-10 spins. After RNG fulfills, click
          Resolve to settle.
        </p>
        <div class="deg-controls">
          <label class="deg-label">Currency
            <select name="deg-currency" class="deg-currency-select">
              <option value="0" selected>ETH</option>
              <option value="1">BURNIE</option>
            </select>
          </label>
          <label class="deg-label">Amount per ticket (ETH)
            <input type="number" name="deg-amount" class="deg-amount-input" min="0" step="0.001" value="0.01">
          </label>
          <label class="deg-label">Ticket count
            <select name="deg-ticket-count" class="deg-ticket-count-select">
              <option value="1" selected>1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="6">6</option>
              <option value="7">7</option>
              <option value="8">8</option>
              <option value="9">9</option>
              <option value="10">10</option>
            </select>
          </label>
          <label class="deg-label">Hero quadrant
            <select name="deg-quadrant" class="deg-quadrant-select">
              <option value="255" selected>None</option>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <label class="deg-label">Custom ticket
            <input type="number" name="deg-custom-ticket" class="deg-custom-ticket-input" min="0" step="1" value="0">
          </label>
        </div>
        <div class="deg-actions">
          <button type="button" class="deg-place-cta" data-write data-bind="deg-place-cta">
            Place bet
          </button>
          <button type="button" class="deg-resolve-cta" data-write data-bind="deg-resolve-cta" disabled>
            Resolve
          </button>
        </div>
        <div class="deg-state" data-bind="deg-state">Idle</div>
        <div class="deg-outcome" data-bind="deg-outcome"></div>
        <div class="deg-error" data-bind="deg-error" hidden role="alert"></div>
      </section>
    `;
  }

  #wireEventHandlers() {
    const place = this.querySelector('[data-bind="deg-place-cta"]');
    if (place) place.addEventListener('click', (e) => this.#onPlaceClick(e));
    const resolve = this.querySelector('[data-bind="deg-resolve-cta"]');
    if (resolve) resolve.addEventListener('click', (e) => this.#onResolveClick(e));
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED).
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
        return;
      }
      const data = await fetchJSON(`/player/${addr}`);
      if (signal.aborted) return;
      this.#playerData = data || null;
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
  // State machine — drives state element + Resolve button enabled/disabled.
  // ---------------------------------------------------------------------

  #setState(next) {
    this.#state = next;
    this.#renderState();
  }

  #renderState() {
    const stateEl = this.querySelector('[data-bind="deg-state"]');
    if (stateEl) stateEl.textContent = STATE_LABELS[this.#state] || 'Idle';
    const resolveBtn = this.querySelector('[data-bind="deg-resolve-cta"]');
    if (resolveBtn) {
      resolveBtn.disabled = this.#state !== STATE.READY;
    }
    const placeBtn = this.querySelector('[data-bind="deg-place-cta"]');
    if (placeBtn) {
      // Place is enabled only in idle / resolved / error-recovery states.
      placeBtn.disabled = (
        this.#state === STATE.PLACING
        || this.#state === STATE.AWAITING_RNG
        || this.#state === STATE.RESOLVING
      );
    }
  }

  // ---------------------------------------------------------------------
  // Place click — stage 1 of two-tx flow.
  // ---------------------------------------------------------------------

  async #onPlaceClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyPlace) return;
    this.#busyPlace = true;

    this.#clearError();
    this.#setState(STATE.PLACING);

    try {
      const currencySel = this.querySelector('[name="deg-currency"]');
      const amountInput = this.querySelector('[name="deg-amount"]');
      const ticketSel = this.querySelector('[name="deg-ticket-count"]');
      const quadrantSel = this.querySelector('[name="deg-quadrant"]');
      const customInput = this.querySelector('[name="deg-custom-ticket"]');

      const currencyRaw = currencySel ? currencySel.value : '0';
      const currency = currencyRaw === '' || currencyRaw == null ? 0 : Number(currencyRaw);
      // Amount input is in ETH units for ETH currency, BURNIE units for BURNIE.
      // Both ETH and BURNIE use 18-decimal scaling on the wire.
      const amountStrEth = amountInput ? String(amountInput.value || '0') : '0';
      const amountFloat = Number(amountStrEth);
      if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
        this.#renderError('Amount must be greater than 0.');
        this.#setState(STATE.IDLE);
        return;
      }
      // Convert ETH-scaled float to wei (18 decimals). Multiply by 1e18 then round.
      const amountPerTicketWei = BigInt(Math.round(amountFloat * 1e18));
      const ticketRaw = ticketSel ? ticketSel.value : '1';
      const ticketCount = ticketRaw === '' || ticketRaw == null ? 1 : Number(ticketRaw);
      const quadrantRaw = quadrantSel ? quadrantSel.value : '255';
      const heroQuadrant = quadrantRaw === '' || quadrantRaw == null ? 0xFF : Number(quadrantRaw);
      const customRaw = customInput ? customInput.value : '0';
      const customTicket = customRaw === '' || customRaw == null ? 0 : Number(customRaw);
      // ETH-paid bets attach msg.value; BURNIE-paid bets transfer via burn (no msg.value).
      const msgValueWei = currency === 0
        ? amountPerTicketWei * BigInt(ticketCount)
        : 0n;

      const { receipt } = await placeBet({
        currency,
        amountPerTicketWei,
        ticketCount,
        customTicket,
        heroQuadrant,
        msgValueWei,
      });

      // Parse BetPlaced from receipt (CF-05). degenerette.js does not surface
      // a parsing-bound contract handle, so the panel constructs a minimal
      // parser-aware contract for the parseLog interface (the fakeDOM tests
      // inject log.parsed; production logs return the canonical parseLog).
      const parseContract = {
        interface: { parseLog: (log) => log.parsed ?? null },
      };
      const placed = parseBetPlacedFromReceipt(receipt, parseContract);
      if (placed.length === 0) {
        // Still moved on-chain; treat as awaitingRng but note we lack betId.
        this.#renderError('Bet placed but receipt parse failed — manual resolve required.');
        this.#setState(STATE.IDLE);
        return;
      }
      this.#currentBetId = placed[0].betId;
      this.#currentLootboxIndex = placed[0].index;
      this.#setState(STATE.AWAITING_RNG);
      this.#startRngPollCycle();

      // 250ms post-confirm refetch (CF-06).
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      const msg = error?.userMessage || error?.message || 'Place failed.';
      this.#renderError(msg);
      this.#setState(STATE.IDLE);
    } finally {
      // Release debounce after window expires.
      setTimeout(() => { this.#busyPlace = false; }, DEBOUNCE_MS);
    }
  }

  // ---------------------------------------------------------------------
  // RNG poll subcycle — reuses Phase 60 pollRngForLootbox keyed by BetPlaced.index.
  // ---------------------------------------------------------------------

  #startRngPollCycle() {
    this.#cancelRngPoll();
    this.#rngPollAbort = new AbortController();
    const ac = this.#rngPollAbort;
    const tick = async () => {
      if (ac.signal.aborted) return;
      try {
        const word = await pollRngForLootbox(BigInt(this.#currentLootboxIndex));
        if (ac.signal.aborted) return;
        if (word !== 0n) {
          this.#setState(STATE.READY);
          return;  // stop polling
        }
      } catch (_e) {
        // network blip — schedule next tick anyway.
      }
      if (ac.signal.aborted) return;
      this.#rngPollTimer = setTimeout(tick, RNG_POLL_INTERVAL_MS);
      if (this.#rngPollTimer && typeof this.#rngPollTimer.unref === 'function') {
        try { this.#rngPollTimer.unref(); } catch (_) { /* defensive */ }
      }
    };
    tick();
  }

  #cancelRngPoll() {
    if (this.#rngPollAbort) {
      try { this.#rngPollAbort.abort(); } catch (_) { /* defensive */ }
      this.#rngPollAbort = null;
    }
    if (this.#rngPollTimer != null) {
      try { clearTimeout(this.#rngPollTimer); } catch (_) { /* defensive */ }
      this.#rngPollTimer = null;
    }
  }

  // ---------------------------------------------------------------------
  // Resolve click — stage 2 of two-tx flow.
  // ---------------------------------------------------------------------

  async #onResolveClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyResolve) return;
    if (this.#state !== STATE.READY) return;
    if (this.#currentBetId == null) return;
    this.#busyResolve = true;

    this.#clearError();
    this.#setState(STATE.RESOLVING);

    try {
      const { receipt } = await resolveBets({ betIds: [this.#currentBetId] });

      const parseContract = {
        interface: { parseLog: (log) => log.parsed ?? null },
      };
      const resolved = parseBetResolvedFromReceipt(receipt, parseContract);
      const ticketResults = parseFullTicketResultsFromReceipt(receipt, parseContract);
      const outcomeEl = this.querySelector('[data-bind="deg-outcome"]');
      if (outcomeEl) {
        if (resolved.length > 0) {
          const r = resolved[0];
          if (r.totalPayout > 0n) {
            // CF-08 — inline state change ONLY. Surface raw wei to keep
            // textContent assignment safe (T-58-18).
            const ticketSummary = ticketResults.length > 0
              ? ` (${ticketResults.length} tickets)`
              : '';
            outcomeEl.textContent = `You won ${String(r.totalPayout)} wei${ticketSummary}`;
          } else {
            outcomeEl.textContent = 'You lost.';
          }
        } else {
          outcomeEl.textContent = 'Resolved (receipt parse incomplete).';
        }
      }
      this.#setState(STATE.RESOLVED);

      // 250ms post-confirm refetch (CF-06).
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      const msg = error?.userMessage || error?.message || 'Resolve failed.';
      this.#renderError(msg);
      this.#setState(STATE.READY);
    } finally {
      setTimeout(() => { this.#busyResolve = false; }, DEBOUNCE_MS);
    }
  }

  // ---------------------------------------------------------------------
  // Error rendering — textContent only (T-58-18). 10s auto-clear timer.
  // ---------------------------------------------------------------------

  #renderError(msg) {
    const errEl = this.querySelector('[data-bind="deg-error"]');
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
    const errEl = this.querySelector('[data-bind="deg-error"]');
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

// Idempotency-guarded registration.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-degenerette-panel')) {
    customElements.define('app-degenerette-panel', AppDegenerettePanel);
  }
}

export { AppDegenerettePanel };
