// play/components/purchase-panel.js -- <purchase-panel> Custom Element
//
// Phase 53 Option B: PURCHASE-03 ships LIVE (price / level / cycle / total-cost
// display hydrated from the Proxy store). PURCHASE-01 / PURCHASE-02 ship as a
// UI SCAFFOLD only -- the Buy buttons render disabled with
// `data-gate="sim-api"` + a title tooltip pointing at PURCHASE-API-SPEC.md.
// Live wiring lifts when the degenerus-sim repo ships the SIM-01 HTTP API.
//
// PURCHASE-04 piggybacks on Phase 52's <packs-panel> stale-guard: when a real
// purchase lands later, the packs-panel auto-renders new entries without any
// additional Phase 53 code.
//
// Design mirrors <profile-panel> (Phase 51 Wave 2): four data-bind slots +
// skeleton-to-content swap + subscribe cleanup. Unlike profile-panel this
// component makes NO network calls; the data it needs (game.level, game.price)
// is already populated by upstream store plumbing (beta/viewer/main.js or
// equivalent; Phase 50 boot path).
//
// SECURITY (T-53-01): the innerHTML template is a static string with no user
// interpolation. All dynamic writes go through textContent or element
// properties (never .innerHTML with response data). Numeric input is coerced
// to BigInt via BigInt(priceWei) and multiplied with BigInt(quantity);
// formatEth handles the display formatting for an all-string wei path.
//
// SHELL-01: imports only from the wallet-free surface --
//   beta/app/store.js (verified wallet-free)
//   beta/viewer/utils.js (wallet-free formatEth; verified in Phase 52)
// No imports from: ethers, beta/app/wallet.js, beta/app/contracts.js,
// beta/app/utils.js, beta/app/purchases.js, beta/components/purchase-panel.js.

import { subscribe, get } from '../../beta/app/store.js';
import { formatEth } from '../../beta/viewer/utils.js';

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
      <label for="purchase-lootbox-eth">Lootbox ETH</label>
      <input
        id="purchase-lootbox-eth"
        data-bind="lootbox-eth-input"
        type="number"
        min="0.01"
        step="0.01"
        value="0.05"
        aria-label="Lootbox ETH amount"
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

  connectedCallback() {
    this.innerHTML = TEMPLATE;
    this.#wireTabs();
    this.#wireQuantityInput();

    this.#unsubs.push(
      subscribe('replay.day', () => this.#rerender()),
      subscribe('replay.player', () => this.#rerender()),
      subscribe('game.level', () => this.#rerender()),
      subscribe('game.price', () => this.#rerender()),
    );

    // subscribe() fires immediately with current values, so #rerender() has
    // already been invoked at least once by the loop above. Nothing else to
    // kick here -- #rerender() is idempotent and no-ops until both level
    // and price are populated.
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  // -- Render helpers -------------------------------------------------

  #rerender() {
    const level = get('game.level');
    const price = get('game.price');
    // Gate on both values being populated. Keep the skeleton visible until
    // we have enough to render the PURCHASE-03 surface meaningfully.
    if (level == null || price == null || price === '0') return;
    this.#renderInfo(level, price);
    this.#updateTotalCost(price);
    if (!this.#loaded) this.#showContent();
  }

  #renderInfo(level, priceWei) {
    // Cycle is floor(level / 100) per D-02 (PURCHASE-03 scope).
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
    let totalWei;
    try {
      totalWei = BigInt(priceWei) * BigInt(qty);
    } catch {
      totalWei = 0n;
    }
    const totalEl = this.querySelector('[data-bind="total-cost"]');
    if (totalEl) totalEl.textContent = formatEth(totalWei.toString()) + ' ETH';
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
