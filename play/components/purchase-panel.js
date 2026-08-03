// play/components/purchase-panel.js -- <purchase-panel> Custom Element
//
// Phase 53 Option B: PURCHASE-03 ships LIVE (price / level / cycle / total-cost
// display hydrated from the Proxy store). PURCHASE-01 / PURCHASE-02 ship as a
// UI SCAFFOLD only -- the Buy buttons render disabled with
// `data-gate="sim-api"` + a title tooltip pointing at PURCHASE-API-SPEC.md.
// Live wiring lifts when the degenerus-sim repo ships the SIM-01 HTTP API.
//
// Currency toggle (ETH / FLIP) ships as UI SCAFFOLD. FLIP pricing rule:
// 1,000 FLIP always buys one ticket regardless of level (per CLAUDE.md
// FLIP economics). Lootbox-via-FLIP accepts a freeform FLIP amount.
//
// SHELL-01: imports only from the wallet-free surface.

import { subscribe, get } from '../../beta/app/store.js';
import { formatEth } from '../../beta/viewer/utils.js';

const FLIP_PER_TICKET = 1000;

const TEMPLATE = `
<section data-slot="purchase" class="panel panel-purchase">

  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:80px"></div></div>
    <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:50%"></div></div>
  </div>

  <div data-bind="content" hidden>
    <h2 class="panel-title">Purchase</h2>

    <!-- Tab switcher: Tickets / Lootbox -->
    <div class="purchase-tabs" role="tablist">
      <button type="button" data-bind="tab-tickets" role="tab" aria-selected="true">Tickets</button>
      <button type="button" data-bind="tab-lootbox" role="tab" aria-selected="false">Lootbox</button>
    </div>

    <!-- Info rows (PURCHASE-03 live display) -->
    <div class="purchase-info">
      <div class="info-row">
        <span class="info-label">Level</span>
        <span data-bind="level-display" class="info-value">--</span>
      </div>
      <div class="info-row">
        <span class="info-label">Cycle</span>
        <span data-bind="cycle-display" class="info-value">--</span>
      </div>
      <div class="info-row">
        <span class="info-label">Ticket price</span>
        <span data-bind="price-display" class="info-value">--</span>
      </div>
    </div>

    <!-- Tickets form -->
    <div class="purchase-form" data-bind="form-tickets">
      <div class="purchase-currency" role="radiogroup" aria-label="Pay with">
        <button type="button" data-bind="ticket-pay-eth" data-currency="eth" role="radio" aria-checked="true">ETH</button>
        <button type="button" data-bind="ticket-pay-flip" data-currency="flip" role="radio" aria-checked="false">FLIP</button>
      </div>

      <label for="purchase-quantity">Quantity</label>
      <input
        id="purchase-quantity"
        data-bind="quantity-input"
        type="number"
        min="1"
        step="1"
        value="1"
        aria-label="Ticket quantity"
      />
      <div class="info-row total-cost">
        <span class="info-label">Total</span>
        <span data-bind="total-cost" class="info-value">--</span>
      </div>
      <button
        type="button"
        data-gate="sim-api"
        data-buy-type="tickets"
        aria-disabled="true"
        title="Awaiting sim API -- see .planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md (SIM-01)"
      >Buy tickets</button>
    </div>

    <!-- Lootbox form (hidden until tab toggles) -->
    <div class="purchase-form" data-bind="form-lootbox" hidden>
      <div class="purchase-currency" role="radiogroup" aria-label="Pay with">
        <button type="button" data-bind="lootbox-pay-eth" data-currency="eth" role="radio" aria-checked="true">ETH</button>
        <button type="button" data-bind="lootbox-pay-flip" data-currency="flip" role="radio" aria-checked="false">FLIP</button>
      </div>

      <label data-bind="lootbox-input-label" for="purchase-lootbox-amount">Lootbox ETH</label>
      <input
        id="purchase-lootbox-amount"
        data-bind="lootbox-amount-input"
        type="number"
        min="0.01"
        step="0.01"
        value="0.05"
        aria-label="Lootbox amount"
      />
      <button
        type="button"
        data-gate="sim-api"
        data-buy-type="lootbox"
        aria-disabled="true"
        title="Awaiting sim API -- see .planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md (SIM-01)"
      >Buy lootbox</button>
    </div>

  </div>

</section>
`;

class PurchasePanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #ticketCurrency = 'eth';
  #lootboxCurrency = 'eth';

  connectedCallback() {
    this.innerHTML = TEMPLATE;
    this.#wireTabs();
    this.#wireQuantityInput();
    this.#wireCurrencyToggles();

    this.#unsubs.push(
      subscribe('replay.day', () => this.#rerender()),
      subscribe('replay.player', () => this.#rerender()),
      subscribe('game.level', () => this.#rerender()),
      subscribe('game.price', () => this.#rerender()),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  // -- Render helpers -------------------------------------------------

  #rerender() {
    const level = get('game.level');
    const price = get('game.price');
    if (level == null || price == null || price === '0') return;
    this.#renderInfo(level, price);
    this.#updateTotalCost(price);
    if (!this.#loaded) this.#showContent();
  }

  #renderInfo(level, priceWei) {
    const lvlNum = Number(level);
    const cycle = Math.floor(lvlNum / 100);
    const byBind = (name) => this.querySelector(`[data-bind="${name}"]`);

    const levelEl = byBind('level-display');
    if (levelEl) levelEl.textContent = String(lvlNum);

    const cycleEl = byBind('cycle-display');
    if (cycleEl) cycleEl.textContent = String(cycle);

    const priceEl = byBind('price-display');
    if (priceEl) priceEl.textContent = formatEth(String(priceWei)) + ' ETH';
  }

  #updateTotalCost(priceWei) {
    const qtyEl = this.querySelector('[data-bind="quantity-input"]');
    const raw = qtyEl ? qtyEl.value : '1';
    const qty = Math.max(1, parseInt(raw, 10) || 1);
    const totalEl = this.querySelector('[data-bind="total-cost"]');
    if (!totalEl) return;

    if (this.#ticketCurrency === 'flip') {
      const totalFlip = qty * FLIP_PER_TICKET;
      totalEl.textContent = totalFlip.toLocaleString() + ' FLIP';
      return;
    }
    let totalWei;
    try {
      totalWei = BigInt(priceWei) * BigInt(qty);
    } catch {
      totalWei = 0n;
    }
    totalEl.textContent = formatEth(totalWei.toString()) + ' ETH';
  }

  // -- Event wiring ---------------------------------------------------

  #wireQuantityInput() {
    const qtyEl = this.querySelector('[data-bind="quantity-input"]');
    if (!qtyEl) return;
    qtyEl.addEventListener('input', () => {
      const price = get('game.price');
      if (price != null && price !== '0') this.#updateTotalCost(price);
    });
  }

  #wireTabs() {
    const tabTickets = this.querySelector('[data-bind="tab-tickets"]');
    const tabLootbox = this.querySelector('[data-bind="tab-lootbox"]');
    const formTickets = this.querySelector('[data-bind="form-tickets"]');
    const formLootbox = this.querySelector('[data-bind="form-lootbox"]');
    if (!tabTickets || !tabLootbox || !formTickets || !formLootbox) return;

    const show = (which) => {
      const isTickets = which === 'tickets';
      tabTickets.setAttribute('aria-selected', String(isTickets));
      tabLootbox.setAttribute('aria-selected', String(!isTickets));
      formTickets.hidden = !isTickets;
      formLootbox.hidden = isTickets;
    };
    tabTickets.addEventListener('click', () => show('tickets'));
    tabLootbox.addEventListener('click', () => show('lootbox'));
  }

  #wireCurrencyToggles() {
    const tEth = this.querySelector('[data-bind="ticket-pay-eth"]');
    const tBur = this.querySelector('[data-bind="ticket-pay-flip"]');
    if (tEth && tBur) {
      tEth.addEventListener('click', () => this.#setTicketCurrency('eth'));
      tBur.addEventListener('click', () => this.#setTicketCurrency('flip'));
    }
    const lEth = this.querySelector('[data-bind="lootbox-pay-eth"]');
    const lBur = this.querySelector('[data-bind="lootbox-pay-flip"]');
    if (lEth && lBur) {
      lEth.addEventListener('click', () => this.#setLootboxCurrency('eth'));
      lBur.addEventListener('click', () => this.#setLootboxCurrency('flip'));
    }
  }

  #setTicketCurrency(currency) {
    this.#ticketCurrency = currency;
    const tEth = this.querySelector('[data-bind="ticket-pay-eth"]');
    const tBur = this.querySelector('[data-bind="ticket-pay-flip"]');
    if (tEth) tEth.setAttribute('aria-checked', String(currency === 'eth'));
    if (tBur) tBur.setAttribute('aria-checked', String(currency === 'flip'));
    const price = get('game.price');
    if (price != null && price !== '0') this.#updateTotalCost(price);
  }

  #setLootboxCurrency(currency) {
    this.#lootboxCurrency = currency;
    const lEth = this.querySelector('[data-bind="lootbox-pay-eth"]');
    const lBur = this.querySelector('[data-bind="lootbox-pay-flip"]');
    if (lEth) lEth.setAttribute('aria-checked', String(currency === 'eth'));
    if (lBur) lBur.setAttribute('aria-checked', String(currency === 'flip'));

    const label = this.querySelector('[data-bind="lootbox-input-label"]');
    const input = this.querySelector('[data-bind="lootbox-amount-input"]');
    if (currency === 'flip') {
      if (label) label.textContent = 'Lootbox FLIP';
      if (input) {
        input.min = '1';
        input.step = '1';
        input.value = '1000';
        input.setAttribute('aria-label', 'Lootbox FLIP amount');
      }
    } else {
      if (label) label.textContent = 'Lootbox ETH';
      if (input) {
        input.min = '0.01';
        input.step = '0.01';
        input.value = '0.05';
        input.setAttribute('aria-label', 'Lootbox ETH amount');
      }
    }
  }

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    const skel = this.querySelector('[data-bind="skeleton"]');
    if (skel) skel.hidden = true;
    const content = this.querySelector('[data-bind="content"]');
    if (content) content.hidden = false;
  }
}

customElements.define('purchase-panel', PurchasePanel);
