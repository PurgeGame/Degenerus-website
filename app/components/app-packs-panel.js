// /app/components/app-packs-panel.js — Phase 60 Plan 60-01 (LBX-01 scaffold)
//
// First-write-surface UI shell. Plan 60-01 ships:
//   - Pay-kind toggle (ETH | BURNIE) per CONTEXT D-01
//   - +/- quantity pickers for tickets + lootboxes per D-01 step 2
//   - Buy button (disabled until quantity > 0; Plan 60-02 wires sendTx)
//   - Per-lootbox rows container (empty; Plan 60-03 populates from receipt)
//   - Boot-CTA placeholder (empty/hidden; Plan 60-04 populates from indexer)
//
// Plan 60-02 wires website/app/app/lootbox.js write helpers + reason-map errors.
// Plan 60-03 cross-imports /play/app/pack-animator.js + pack-audio.js + RNG poll.
// Plan 60-04 adds chainId-scoped localStorage idempotency + boot CTA + URL ?ref=.
//
// Mount: <app-packs-panel></app-packs-panel> in /app/index.html directly below
//        <last-day-jackpot></last-day-jackpot> per CONTEXT D-04.

import { subscribe } from '../app/store.js';
// ^^ pre-imported in Plan 60-01 for forward-compat; Plan 60-02 leaves it pre-imported
// (Plan 60-04 wires connected.address subscription for boot-CTA / affiliate-code).

// Plan 60-02: write-path imports — first production consumer of Phase 56 (static-call
// + reason-map) and Phase 58 (sendTx chokepoint) primitives end-to-end on a write
// surface. parseLootboxIdxFromReceipt feeds the receipt-log-first reveal pattern
// (Plan 60-03 will USE the stored rows to render per-lootbox UI + RNG poll).
import { purchaseEth, purchaseCoin, parseLootboxIdxFromReceipt } from '../app/lootbox.js';
import { decodeRevertReason } from '../app/reason-map.js';

const TICKET_MAX = 100;
const LOOTBOX_MAX = 10;  // per CONTEXT D-01 step 2 — prevents runaway sequential-tx loops

class AppPacksPanel extends HTMLElement {
  #unsubs = [];
  #payKind = 'ETH';        // default per CONTEXT D-01 step 1 (Recommended starting position)
  #ticketQuantity = 0;     // default per D-01
  #lootboxQuantity = 1;    // default per D-01 step 2 ("default 1 since this is the lootbox panel")
  #busy = false;           // Plan 60-02 toggles during sendTx in-flight
  #lootboxRows = [];       // Plan 60-02 seeds from receipt; Plan 60-03 transitions row state
  #errorTimer = null;      // Plan 60-02 — auto-hide timer for #showError banner

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

    // Initial render so default state reflects in DOM
    this.#renderState();
  }

  disconnectedCallback() {
    if (this.#errorTimer != null) {
      clearTimeout(this.#errorTimer);
      this.#errorTimer = null;
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
  // Plan 60-02: Buy click handler — sequential N=1 tx loop with shared progress UI.
  // CONTEXT D-01 step 3 + D-04 wave 2 ("Buy 5 lootboxes" fires 5 sequential txes;
  // user signs N times; shared progress UI shows '1/5 confirmed, 2/5 pending…').
  // ---------------------------------------------------------------------

  async #onBuyClick() {
    if (this.#busy) return;                                          // T-60-10 defense
    const ticketQuantity = this.#ticketQuantity;
    const lootboxQuantity = this.#lootboxQuantity;
    if (ticketQuantity === 0 && lootboxQuantity === 0) return;

    const buyBtn = this.querySelector('[data-bind="lbx-buy-button"]');
    const N = Math.max(1, lootboxQuantity);
    // Per CONTEXT 'Claude's Discretion' +/- mechanics: first tx carries ALL tickets;
    // subsequent txes carry 0 tickets. Avoids splitting small ticket counts across
    // many txes (simpler UX + matches contract semantics where ticketQuantity > 0
    // is allowed alongside lootboxQuantity = 1).
    this.#busy = true;
    this.#renderState();
    try {
      for (let i = 0; i < N; i++) {
        if (buyBtn) buyBtn.textContent = `${i + 1}/${N} — confirming…`;
        const args = {
          ticketQuantity: i === 0 ? ticketQuantity : 0,
          lootboxQuantity: 1,
          // affiliateCode: Plan 60-04 wires URL ?ref= param + chainId-scoped
          // localStorage read. Plan 60-02 always defaults to ZeroHash.
        };
        const result = this.#payKind === 'ETH'
          ? await purchaseEth(args)
          : await purchaseCoin(args);
        // Receipt-log-first parse (LBX-04). Plan 60-03 USES #lootboxRows to render
        // per-lootbox row UI + RNG poll lifecycle. Plan 60-02 just stores them.
        const idxs = parseLootboxIdxFromReceipt(result.receipt, result.contract);
        for (const idx of idxs) {
          this.#lootboxRows.push({
            lootboxIndex: idx.lootboxIndex,
            payKind: idx.payKind,
            status: 'awaiting-rng',  // Plan 60-03 transitions: ready-to-open → opening → revealed
            rngWord: 0n,
            receipt: result.receipt,
            contract: result.contract,
          });
        }
      }
      if (buyBtn) buyBtn.textContent = 'Buy';
    } catch (err) {
      if (buyBtn) buyBtn.textContent = 'Buy';
      this.#showError(err);
    } finally {
      this.#busy = false;                                            // T-60-10 mitigation
      this.#renderState();
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
    this.#errorTimer = setTimeout(() => {
      if (banner) banner.hidden = true;
      this.#errorTimer = null;
    }, 8000);
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
    };
  }
}

// Idempotency-guarded register (Phase 58/59 pattern — player-dropdown.js:178-182,
// last-day-jackpot.js module bottom). Required for node:test re-import safety.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-packs-panel')) {
    customElements.define('app-packs-panel', AppPacksPanel);
  }
}

export { AppPacksPanel };
