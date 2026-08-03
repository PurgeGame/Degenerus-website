// play/components/pass-panel.js -- <pass-panel> Custom Element
//
// UI scaffold for purchasing the three pass types:
//   - Whale Bundle (100 levels): 2.4 ETH at L0-3, 4 ETH at L4+. Quantity 1-100.
//     At x99 levels, minimum quantity is 2.
//   - Lazy Pass (10 levels): 0.24 ETH at L0-2; sum of per-level ticket prices
//     at L3+. Eligibility: levels 0-2, or x9 (excluding x99), or boon-holder.
//   - Deity Pass: 24 + T(n) ETH where T(n) = n*(n+1)/2, n = passes sold so far.
//     Capped at 32 passes globally. Requires symbolId 0-15.
//
// Buy buttons ship as UI SCAFFOLD only -- disabled with `data-gate="sim-api"`
// + a title tooltip pointing at PURCHASE-API-SPEC.md. Live wiring lifts when
// the degenerus-sim repo ships the SIM-01 HTTP API.
//
// SHELL-01: imports only from the wallet-free surface.

import { subscribe, get } from '../../beta/app/store.js';
import { BADGE_QUADRANTS, BADGE_ITEMS, badgeCircularPath } from '../app/constants.js';

// Deity symbolId range: 0-31 (Q0 crypto 0-7, Q1 zodiac 8-15, Q2 cards 16-23, Q3 dice 24-31).
const DEITY_SYMBOL_COUNT = 32;
// 'silver' color variant draws the icon in its natural colors (the gold variant
// renders the icon in gold-over-gold). We crop the outer rings via CSS so only
// the inner symbol is visible -- color choice mostly affects the inner-circle
// fill, which we override with white via .pass-deity-symbol-btn background.
const DEITY_BADGE_COLOR = 'silver';

function symbolMeta(symbolId) {
  const quadIdx = Math.floor(symbolId / 8);
  const inQuad = symbolId % 8;
  const category = BADGE_QUADRANTS[quadIdx];
  const name = BADGE_ITEMS[category]?.[inQuad] ?? String(inQuad);
  return { category, inQuad, name };
}

// Per-ticket price in ETH for a given level. Mirrors PriceLookupLib.priceForLevel
// in the contracts (also lives in play/components/position-panel.js).
function ticketPriceEthForLevel(level) {
  if (level < 5) return 0.01;
  if (level < 10) return 0.02;
  if (level < 30) return 0.04;
  if (level < 60) return 0.08;
  if (level < 90) return 0.12;
  if (level < 100) return 0.16;
  const offset = level % 100;
  if (offset === 0) return 0.24;
  if (offset < 30) return 0.04;
  if (offset < 60) return 0.08;
  if (offset < 90) return 0.12;
  return 0.16;
}

// Whale bundle price for the next-level start. 2.4 ETH at L0-3, 4 ETH at L4+.
function whalePriceEth(level) {
  return level <= 3 ? 2.4 : 4.0;
}

// Lazy pass price for activation at the current level.
// L0-2 is a flat 0.24 ETH; otherwise sum of priceForLevel across the next 10 levels.
function lazyPriceEth(level) {
  if (level <= 2) return 0.24;
  let total = 0;
  for (let i = 1; i <= 10; i++) total += ticketPriceEthForLevel(level + i);
  return total;
}

// Deity pass price: 24 + T(n) where T(n) = n*(n+1)/2 ETH (n = passes already sold).
function deityPriceEth(soldCount) {
  const n = Math.max(0, Number(soldCount) || 0);
  return 24 + (n * (n + 1)) / 2;
}

// Lazy pass eligibility: level 0-2, or level ends in x9 (excluding x99).
// (Boon-holder pathway is not surfaced here -- that requires per-player state.)
function lazyEligibilityNote(level) {
  const lvl = Number(level);
  if (!Number.isFinite(lvl)) return 'Eligibility unknown';
  if (lvl <= 2) return 'Available now';
  const inCycle = lvl % 100;
  if (inCycle === 9 || inCycle === 19 || inCycle === 29 || inCycle === 39
      || inCycle === 49 || inCycle === 59 || inCycle === 69 || inCycle === 79
      || inCycle === 89) {
    return 'Available now (x9 window)';
  }
  if (inCycle === 99) return 'Locked at x99';
  // Find next x9 in the same cycle.
  const cycleBase = lvl - inCycle;
  const nextX9 = inCycle < 9 ? cycleBase + 9
    : cycleBase + (Math.floor(inCycle / 10) + 1) * 10 - 1;
  return `Locked. Next window: level ${nextX9}`;
}

function whaleEligibilityNote(level) {
  const lvl = Number(level);
  if (!Number.isFinite(lvl)) return 'Eligibility unknown';
  if ((lvl + 1) % 100 === 0) return 'Available (x99: min 2 bundles)';
  return 'Available now';
}

function deityEligibilityNote(soldCount) {
  const n = Math.max(0, Number(soldCount) || 0);
  if (n >= 32) return 'Sold out (32/32)';
  return `Available (${n}/32 sold)`;
}

const TEMPLATE = `
<section data-slot="pass" class="panel panel-pass">
  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:90px"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:90px"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:90px"></div></div>
  </div>

  <div data-bind="content" hidden>
    <h2 class="panel-title">Passes</h2>

    <article class="pass-card" data-bind="card-whale">
      <header class="pass-card-head">
        <h3 class="pass-card-title">Whale Bundle</h3>
        <span class="pass-card-eligibility" data-bind="whale-eligibility">--</span>
      </header>
      <p class="pass-card-blurb">100 levels. 4 tickets/lvl (40/lvl through L10). Includes lootbox.</p>
      <div class="pass-card-row">
        <span class="pass-card-label">Price</span>
        <span class="pass-card-value" data-bind="whale-price">--</span>
      </div>
      <div class="pass-card-row">
        <label class="pass-card-label" for="pass-whale-qty">Quantity</label>
        <input
          id="pass-whale-qty"
          type="number"
          min="1"
          max="100"
          step="1"
          value="1"
          data-bind="whale-quantity"
          aria-label="Whale bundle quantity"
        />
      </div>
      <div class="pass-card-row total-cost">
        <span class="pass-card-label">Total</span>
        <span class="pass-card-value" data-bind="whale-total">--</span>
      </div>
      <button
        type="button"
        data-gate="sim-api"
        data-buy-type="whale"
        aria-disabled="true"
        title="Awaiting sim API -- see .planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md (SIM-01)"
      >Buy whale bundle</button>
    </article>

    <article class="pass-card" data-bind="card-lazy">
      <header class="pass-card-head">
        <h3 class="pass-card-title">Lazy Pass</h3>
        <span class="pass-card-eligibility" data-bind="lazy-eligibility">--</span>
      </header>
      <p class="pass-card-blurb">10 levels. 4 tickets/lvl. Cheap entry; renews at x9 windows.</p>
      <div class="pass-card-row">
        <span class="pass-card-label">Price</span>
        <span class="pass-card-value" data-bind="lazy-price">--</span>
      </div>
      <button
        type="button"
        data-gate="sim-api"
        data-buy-type="lazy"
        aria-disabled="true"
        title="Awaiting sim API -- see .planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md (SIM-01)"
      >Buy lazy pass</button>
    </article>

    <article class="pass-card" data-bind="card-deity">
      <header class="pass-card-head">
        <h3 class="pass-card-title">Deity Pass</h3>
        <span class="pass-card-eligibility" data-bind="deity-eligibility">--</span>
      </header>
      <p class="pass-card-blurb">Permanent NFT. Daily boon issuance. 32 passes total, triangular pricing.</p>
      <div class="pass-card-row">
        <span class="pass-card-label">Price</span>
        <span class="pass-card-value" data-bind="deity-price">--</span>
      </div>
      <div class="pass-deity-symbol-row">
        <span class="pass-card-label">Symbol</span>
        <button
          type="button"
          class="pass-deity-toggle"
          data-bind="deity-toggle"
          aria-expanded="false"
          aria-haspopup="true"
          aria-label="Choose deity symbol"
          data-bind-title="deity-symbol-name"
        >
          <span class="pass-deity-toggle-disc" aria-hidden="true">
            <img class="pass-deity-toggle-icon" data-bind="deity-toggle-icon" alt="" />
          </span>
          <span class="pass-deity-toggle-caret" aria-hidden="true">▾</span>
          <span class="visually-hidden" data-bind="deity-symbol-name">--</span>
        </button>
      </div>
      <div
        class="pass-deity-symbol-grid"
        role="radiogroup"
        aria-label="Deity symbol"
        data-bind="deity-symbol-grid"
        hidden
      ></div>
      <button
        type="button"
        data-gate="sim-api"
        data-buy-type="deity"
        aria-disabled="true"
        title="Awaiting sim API -- see .planning/phases/53-purchase-flow/PURCHASE-API-SPEC.md (SIM-01)"
      >Buy deity pass</button>
    </article>
  </div>
</section>
`;

function fmtEth(eth) {
  if (!Number.isFinite(eth)) return '--';
  return `${eth.toFixed(eth < 0.1 ? 4 : 2)} ETH`;
}

class PassPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #deityCount = 0;
  #selectedSymbolId = 0;
  #ownedSymbols = new Set();
  #outsideClickHandler = null;

  connectedCallback() {
    this.innerHTML = TEMPLATE;
    this.#populateDeitySymbols();
    this.#wireWhaleQuantity();
    this.#wireDeityToggle();

    this.#unsubs.push(
      subscribe('replay.day', () => this.#rerender()),
      subscribe('replay.player', () => this.#rerender()),
      subscribe('game.level', () => this.#rerender()),
    );

    this.#rerender();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
    if (this.#outsideClickHandler) {
      document.removeEventListener('click', this.#outsideClickHandler);
      this.#outsideClickHandler = null;
    }
  }

  /** Public hook (UI-only stub): mark which symbol IDs already have an owner.
   *  When SIM-01 ships, an upstream subscriber will call setOwnedSymbols([...]).
   *  Each entry is a 0-31 symbolId. Selected symbol auto-shifts off owned. */
  setOwnedSymbols(ids) {
    this.#ownedSymbols = new Set((ids || []).map(Number).filter((n) => n >= 0 && n < DEITY_SYMBOL_COUNT));
    if (this.#ownedSymbols.has(this.#selectedSymbolId)) {
      const next = [...Array(DEITY_SYMBOL_COUNT).keys()].find((i) => !this.#ownedSymbols.has(i));
      if (next != null) this.#selectedSymbolId = next;
    }
    this.#refreshSymbolStates();
    this.#updateToggleButton();
  }

  #rerender() {
    const level = get('game.level') ?? get('replay.level');
    if (level == null) return;
    const lvl = Number(level);

    this.#bind('whale-eligibility', whaleEligibilityNote(lvl));
    this.#bind('whale-price', fmtEth(whalePriceEth(lvl)));
    this.#updateWhaleTotal();

    this.#bind('lazy-eligibility', lazyEligibilityNote(lvl));
    this.#bind('lazy-price', fmtEth(lazyPriceEth(lvl)));

    this.#bind('deity-eligibility', deityEligibilityNote(this.#deityCount));
    this.#bind('deity-price', fmtEth(deityPriceEth(this.#deityCount)));

    if (!this.#loaded) this.#showContent();
  }

  #bind(slot, value) {
    const el = this.querySelector(`[data-bind="${slot}"]`);
    if (el) el.textContent = String(value);
  }

  #populateDeitySymbols() {
    const grid = this.querySelector('[data-bind="deity-symbol-grid"]');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < DEITY_SYMBOL_COUNT; i++) {
      const meta = symbolMeta(i);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pass-deity-symbol-btn';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('data-symbol-id', String(i));
      btn.setAttribute('title', `${meta.category} -- ${meta.name}`);
      btn.setAttribute('aria-label', `${meta.category} ${meta.name}`);

      const img = document.createElement('img');
      img.src = badgeCircularPath(meta.category, meta.inQuad, DEITY_BADGE_COLOR);
      img.alt = '';
      img.loading = 'lazy';
      btn.appendChild(img);

      btn.addEventListener('click', () => {
        if (this.#ownedSymbols.has(i)) return;
        this.#selectSymbol(i);
        this.#setDeityOpen(false);
      });
      grid.appendChild(btn);
    }
    this.#refreshSymbolStates();
    this.#updateToggleButton();
  }

  #selectSymbol(symbolId) {
    this.#selectedSymbolId = symbolId;
    this.#refreshSymbolStates();
    this.#updateToggleButton();
  }

  #refreshSymbolStates() {
    const buttons = this.querySelectorAll('.pass-deity-symbol-btn');
    buttons.forEach((btn) => {
      const id = Number(btn.getAttribute('data-symbol-id'));
      const owned = this.#ownedSymbols.has(id);
      btn.setAttribute('aria-checked', String(id === this.#selectedSymbolId && !owned));
      btn.setAttribute('aria-disabled', String(owned));
      btn.classList.toggle('is-owned', owned);
      btn.disabled = owned;
    });
  }

  #updateToggleButton() {
    const meta = symbolMeta(this.#selectedSymbolId);
    const nameEl = this.querySelector('[data-bind="deity-symbol-name"]');
    if (nameEl) nameEl.textContent = `${meta.category} · ${meta.name}`;
    const iconEl = this.querySelector('[data-bind="deity-toggle-icon"]');
    if (iconEl) iconEl.src = badgeCircularPath(meta.category, meta.inQuad, DEITY_BADGE_COLOR);
  }

  #wireDeityToggle() {
    const toggle = this.querySelector('[data-bind="deity-toggle"]');
    if (!toggle) return;
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = toggle.getAttribute('aria-expanded') === 'true';
      this.#setDeityOpen(!open);
    });
    this.#outsideClickHandler = (e) => {
      if (!this.contains(e.target)) this.#setDeityOpen(false);
    };
    document.addEventListener('click', this.#outsideClickHandler);
  }

  #setDeityOpen(open) {
    const toggle = this.querySelector('[data-bind="deity-toggle"]');
    const grid = this.querySelector('[data-bind="deity-symbol-grid"]');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (grid) grid.hidden = !open;
  }

  #wireWhaleQuantity() {
    const qty = this.querySelector('[data-bind="whale-quantity"]');
    if (!qty) return;
    qty.addEventListener('input', () => this.#updateWhaleTotal());
  }

  #updateWhaleTotal() {
    const level = get('game.level') ?? get('replay.level');
    if (level == null) return;
    const qtyEl = this.querySelector('[data-bind="whale-quantity"]');
    const raw = qtyEl ? qtyEl.value : '1';
    const qty = Math.max(1, Math.min(100, parseInt(raw, 10) || 1));
    const unit = whalePriceEth(Number(level));
    this.#bind('whale-total', fmtEth(unit * qty));
  }

  #showContent() {
    this.#loaded = true;
    const skel = this.querySelector('[data-bind="skeleton"]');
    if (skel) skel.hidden = true;
    const content = this.querySelector('[data-bind="content"]');
    if (content) content.hidden = false;
  }
}

customElements.define('pass-panel', PassPanel);
