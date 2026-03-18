// components/pass-section.js -- Pass section Custom Element
// Collapsible section with lazy, whale, and deity pass cards.
// All contract interaction delegated to purchases.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import {
  calcLazyPassPrice, calcWhaleBundlePrice, calcDeityPassPrice,
  buyLazyPass, buyWhaleBundle, buyDeityPass,
  fetchHasLazyPass, fetchDeityPassCount, fetchTakenSymbols,
  getAffiliateCode, DEITY_SYMBOLS,
} from '../app/purchases.js';
import { formatEth } from '../app/utils.js';

class PassSection extends HTMLElement {
  #unsubs = [];
  #takenSymbols = new Set();
  #selectedSymbolId = null;
  #deityPrice = null;
  #errorTimeout = null;
  #loaded = false;

  connectedCallback() {
    this.innerHTML = `
<details class="pass-details">
  <summary class="pass-summary">
    <h2 class="section-title pass-title">Passes</h2>
    <span class="pass-expand-hint">View pass options</span>
  </summary>

  <div class="pass-grid">
    <!-- Lazy Pass Card -->
    <div class="pass-card" data-pass="lazy">
      <h3 class="pass-card-title">Lazy Pass</h3>
      <p class="pass-card-desc">10-level bundle. +0.85 activity score floor (50% streak + 25% mint count + 10% bonus).</p>
      <div class="info-row">
        <span class="info-label">Price</span>
        <span class="info-value" data-bind="lazy-price">--</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-value" data-bind="lazy-status">--</span>
      </div>
      <button class="btn-primary btn-small buy-lazy-btn" data-action="buy-lazy">Buy Lazy Pass</button>
    </div>

    <!-- Whale Bundle Card -->
    <div class="pass-card" data-pass="whale">
      <h3 class="pass-card-title">Whale Bundle</h3>
      <p class="pass-card-desc">100-level bundle. +1.15 activity score floor (50% streak + 25% mint count + 40% bonus).</p>
      <div class="info-row">
        <span class="info-label">Unit Price</span>
        <span class="info-value" data-bind="whale-unit-price">--</span>
      </div>
      <div class="purchase-row">
        <label>Quantity</label>
        <div class="input-group">
          <button class="incr-btn" data-incr="whale-qty" data-delta="-1">-1</button>
          <input type="number" class="qty-input" data-input="whale-qty" value="1" min="1" step="1">
          <button class="incr-btn" data-incr="whale-qty" data-delta="1">+1</button>
        </div>
      </div>
      <div class="info-row">
        <span class="info-label">Total</span>
        <span class="info-value" data-bind="whale-total">--</span>
      </div>
      <button class="btn-primary btn-small buy-whale-btn" data-action="buy-whale">Buy Whale Bundle</button>
    </div>

    <!-- Deity Pass Card -->
    <div class="pass-card pass-card--deity" data-pass="deity">
      <h3 class="pass-card-title">Deity Pass</h3>
      <p class="pass-card-desc">+1.55 activity score floor (50% + 25% + 80%). Grants boon on chosen symbol. Price increases with each issued pass (triangular curve).</p>
      <div class="info-row">
        <span class="info-label">Current Price</span>
        <span class="info-value" data-bind="deity-price">--</span>
      </div>
      <div class="info-row">
        <span class="info-label">Your Deity Passes</span>
        <span class="info-value" data-bind="deity-count">--</span>
      </div>
      <div class="deity-symbol-section">
        <label>Choose Symbol</label>
        <div class="symbol-grid" data-bind="symbol-grid"></div>
        <div class="selected-symbol" data-bind="selected-symbol">No symbol selected</div>
      </div>
      <button class="btn-primary btn-small buy-deity-btn" data-action="buy-deity" disabled>Select a Symbol First</button>
    </div>
  </div>

  <!-- Error display -->
  <div class="pass-error" data-bind="pass-error" hidden></div>
</details>
    `;

    // Wire details toggle: lazy-load data on first open
    const details = this.querySelector('.pass-details');
    if (details) {
      details.addEventListener('toggle', () => {
        if (details.open && !this.#loaded) {
          this.#loaded = true;
          this.#loadPassData();
        }
      });
    }

    // Wire buy buttons
    this.querySelector('.buy-lazy-btn').addEventListener('click', () => this.#handleBuyLazy());
    this.querySelector('.buy-whale-btn').addEventListener('click', () => this.#handleBuyWhale());
    this.querySelector('.buy-deity-btn').addEventListener('click', () => this.#handleBuyDeity());

    // Wire whale qty increment buttons
    this.querySelectorAll('[data-incr="whale-qty"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = this.querySelector('[data-input="whale-qty"]');
        if (input) {
          const current = parseInt(input.value, 10) || 1;
          const delta = parseInt(btn.dataset.delta, 10);
          input.value = Math.max(1, current + delta);
          input.dispatchEvent(new Event('input'));
        }
      });
    });

    // Wire whale qty input change to recalculate total
    const whaleQtyInput = this.querySelector('[data-input="whale-qty"]');
    if (whaleQtyInput) {
      whaleQtyInput.addEventListener('input', () => this.#updateWhaleTotal());
    }

    // Wire symbol grid clicks (event delegation)
    const symbolGrid = this.querySelector('[data-bind="symbol-grid"]');
    if (symbolGrid) {
      symbolGrid.addEventListener('click', (e) => this.#handleSymbolSelect(e));
    }

    // Store subscriptions
    this.#unsubs.push(
      subscribe('game.level', () => this.#updatePrices()),
      subscribe('game.price', () => this.#updatePrices()),
      subscribe('ui.connectionState', (state) => {
        const disabled = state !== 'connected';
        const lazyBtn = this.querySelector('.buy-lazy-btn');
        const whaleBtn = this.querySelector('.buy-whale-btn');
        const deityBtn = this.querySelector('.buy-deity-btn');
        if (lazyBtn) lazyBtn.disabled = disabled;
        if (whaleBtn) whaleBtn.disabled = disabled;
        // Deity button has special logic: disabled unless symbol selected AND connected
        if (deityBtn) {
          deityBtn.disabled = disabled || this.#selectedSymbolId === null;
          if (!disabled && this.#selectedSymbolId !== null) {
            deityBtn.textContent = 'Buy Deity Pass';
          }
        }
      }),
      subscribe('player.address', (addr) => {
        if (addr) this.#refreshPlayerPassStatus(addr);
      }),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    if (this.#errorTimeout) clearTimeout(this.#errorTimeout);
  }

  // -- Private methods --

  async #loadPassData() {
    // Fetch taken symbols and deity price in parallel
    const [takenSymbols, deityPrice] = await Promise.all([
      fetchTakenSymbols(),
      calcDeityPassPrice(),
    ]);

    this.#takenSymbols = takenSymbols;
    this.#deityPrice = deityPrice;

    this.#renderSymbolGrid();
    this.#bind('deity-price', formatEth(deityPrice.toString()) + ' ETH');

    // Refresh player-specific data if connected
    const addr = get('player.address');
    if (addr) {
      this.#refreshPlayerPassStatus(addr);
    }

    // Update lazy/whale prices immediately
    this.#updatePrices();
  }

  async #refreshPlayerPassStatus(address) {
    const [hasLazy, deityCount] = await Promise.all([
      fetchHasLazyPass(address),
      fetchDeityPassCount(address),
    ]);

    this.#bind('lazy-status', hasLazy ? 'Active' : 'None');
    this.#bind('deity-count', String(deityCount));
  }

  #updatePrices() {
    const level = get('game.level') || 0;
    const price = get('game.price');

    // Lazy pass price
    try {
      const lazyPrice = calcLazyPassPrice(level, price);
      this.#bind('lazy-price', formatEth(lazyPrice.toString()) + ' ETH');
    } catch {
      this.#bind('lazy-price', '--');
    }

    // Whale unit price and total
    try {
      const whaleUnit = calcWhaleBundlePrice(level, 1);
      this.#bind('whale-unit-price', formatEth(whaleUnit.toString()) + ' ETH');
      this.#updateWhaleTotal();
    } catch {
      this.#bind('whale-unit-price', '--');
    }
  }

  #updateWhaleTotal() {
    const level = get('game.level') || 0;
    const qty = parseInt(this.querySelector('[data-input="whale-qty"]')?.value, 10) || 1;
    try {
      const total = calcWhaleBundlePrice(level, qty);
      this.#bind('whale-total', formatEth(total.toString()) + ' ETH');
    } catch {
      this.#bind('whale-total', '--');
    }
  }

  #renderSymbolGrid() {
    const grid = this.querySelector('[data-bind="symbol-grid"]');
    if (!grid) return;

    let flatIndex = 0;
    let html = '';
    for (const group of DEITY_SYMBOLS) {
      for (const symbol of group.symbols) {
        const isTaken = this.#takenSymbols.has(flatIndex);
        const isSelected = flatIndex === this.#selectedSymbolId;
        const classes = ['symbol-btn'];
        if (isTaken) classes.push('symbol-taken');
        if (isSelected) classes.push('symbol-selected');

        html += `<button class="${classes.join(' ')}" data-symbol-id="${flatIndex}"${isTaken ? ' disabled' : ''} title="${group.group}: ${symbol}">${symbol}</button>`;
        flatIndex++;
      }
    }
    grid.innerHTML = html;
  }

  #handleSymbolSelect(e) {
    const btn = e.target.closest('.symbol-btn');
    if (!btn || btn.disabled) return;

    const symbolId = parseInt(btn.dataset.symbolId, 10);
    if (isNaN(symbolId)) return;

    this.#selectedSymbolId = symbolId;
    this.#renderSymbolGrid();

    // Find the symbol name for the selected ID
    let flatIndex = 0;
    let selectedName = '';
    for (const group of DEITY_SYMBOLS) {
      for (const symbol of group.symbols) {
        if (flatIndex === symbolId) {
          selectedName = `${group.group}: ${symbol}`;
        }
        flatIndex++;
      }
    }

    this.#bind('selected-symbol', selectedName || `Symbol #${symbolId}`);

    // Enable deity buy button if connected
    const deityBtn = this.querySelector('.buy-deity-btn');
    if (deityBtn) {
      const connected = get('ui.connectionState') === 'connected';
      deityBtn.disabled = !connected;
      deityBtn.textContent = 'Buy Deity Pass';
    }
  }

  async #handleBuyLazy() {
    const btn = this.querySelector('.buy-lazy-btn');
    if (btn) btn.disabled = true;
    try {
      await buyLazyPass(getAffiliateCode());
      // Refresh status
      const addr = get('player.address');
      if (addr) this.#refreshPlayerPassStatus(addr);
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Lazy pass purchase failed');
      }
    } finally {
      if (btn && get('ui.connectionState') === 'connected') btn.disabled = false;
    }
  }

  async #handleBuyWhale() {
    const btn = this.querySelector('.buy-whale-btn');
    const qty = parseInt(this.querySelector('[data-input="whale-qty"]')?.value, 10) || 1;
    if (btn) btn.disabled = true;
    try {
      await buyWhaleBundle(qty, getAffiliateCode());
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Whale bundle purchase failed');
      }
    } finally {
      if (btn && get('ui.connectionState') === 'connected') btn.disabled = false;
    }
  }

  async #handleBuyDeity() {
    if (this.#selectedSymbolId === null) return;
    const btn = this.querySelector('.buy-deity-btn');
    if (btn) btn.disabled = true;
    try {
      await buyDeityPass(this.#selectedSymbolId);
      // Refresh taken symbols and deity count on success
      const [takenSymbols] = await Promise.all([
        fetchTakenSymbols(),
      ]);
      this.#takenSymbols = takenSymbols;
      this.#selectedSymbolId = null;
      this.#renderSymbolGrid();
      this.#bind('selected-symbol', 'No symbol selected');

      // Refresh deity price and count
      const deityPrice = await calcDeityPassPrice();
      this.#deityPrice = deityPrice;
      this.#bind('deity-price', formatEth(deityPrice.toString()) + ' ETH');

      const addr = get('player.address');
      if (addr) this.#refreshPlayerPassStatus(addr);
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        const msg = (err.message || '').toLowerCase().includes('already')
          ? 'Symbol already taken. Refreshing available symbols...'
          : (err.message || 'Deity pass purchase failed');
        this.#showError(msg);
        // Refresh grid on any error (symbol may have been taken)
        fetchTakenSymbols().then(taken => {
          this.#takenSymbols = taken;
          this.#renderSymbolGrid();
        });
      }
    } finally {
      if (btn) {
        const connected = get('ui.connectionState') === 'connected';
        btn.disabled = !connected || this.#selectedSymbolId === null;
        btn.textContent = this.#selectedSymbolId === null ? 'Select a Symbol First' : 'Buy Deity Pass';
      }
    }
  }

  #showError(msg) {
    const el = this.querySelector('[data-bind="pass-error"]');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    if (this.#errorTimeout) clearTimeout(this.#errorTimeout);
    this.#errorTimeout = setTimeout(() => {
      el.hidden = true;
      el.textContent = '';
    }, 5000);
  }

  #bind(key, value) {
    const el = this.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = value;
  }
}

customElements.define('pass-section', PassSection);
