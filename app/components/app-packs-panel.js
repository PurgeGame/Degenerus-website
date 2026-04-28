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
// ^^ unused in Plan 60-01; reserved for Plan 60-02 connected.address subscription.
// Acceptable per Phase 59 Plan 59-01 precedent (pre-imported store API for forward
// compat; silences "unexpected new import" diff in next-wave plan).

const TICKET_MAX = 100;
const LOOTBOX_MAX = 10;  // per CONTEXT D-01 step 2 — prevents runaway sequential-tx loops

class AppPacksPanel extends HTMLElement {
  #unsubs = [];
  #payKind = 'ETH';        // default per CONTEXT D-01 step 1 (Recommended starting position)
  #ticketQuantity = 0;     // default per D-01
  #lootboxQuantity = 1;    // default per D-01 step 2 ("default 1 since this is the lootbox panel")
  #busy = false;           // Plan 60-02 toggles during sendTx in-flight
  #lootboxRows = [];       // Plan 60-03 populates per-purchase

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

    // Initial render so default state reflects in DOM
    this.#renderState();
  }

  disconnectedCallback() {
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
  // Test/Plan-60-02+ accessors (intentionally minimal surface)
  // ---------------------------------------------------------------------

  get _state() {
    // Test-only accessor — exposes private state for assertions in Plan 60-01 tests.
    // Plan 60-02 will likely remove this accessor and rely on DOM assertions instead.
    return {
      payKind: this.#payKind,
      ticketQuantity: this.#ticketQuantity,
      lootboxQuantity: this.#lootboxQuantity,
      busy: this.#busy,
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
