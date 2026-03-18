// components/purchase-panel.js -- Purchase panel Custom Element
// ETH/BURNIE toggle, ticket quantity, lootbox amount, pool fill bar, EV indicator.
// All contract interaction delegated to purchases.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import {
  buyEthTicketsAndLootbox,
  buyBurnieTickets,
  fetchPoolTarget,
  fetchPresaleFlag,
  calcPoolFillPercent,
  lootboxEvClass,
  lootboxEvLabel,
  lootboxBadgeText,
  getAffiliateCode,
} from '../app/purchases.js';
import { formatEth, formatBurnie } from '../app/utils.js';

class PurchasePanel extends HTMLElement {
  #unsubs = [];
  #poolTarget = '0';
  #isPresale = false;
  #payMode = 'eth';
  #currentPrice = null;
  #errorTimeout = null;

  connectedCallback() {
    this.innerHTML = `
      <div class="panel purchase-panel">
        <div class="panel-header">
          <h2>Purchase</h2>
          <div class="pay-toggle">
            <button class="pay-toggle-btn active" data-mode="eth">ETH</button>
            <button class="pay-toggle-btn" data-mode="burnie">BURNIE</button>
          </div>
        </div>

        <!-- Pool fill progress -->
        <div class="pool-fill">
          <div class="pool-fill-labels">
            <span class="info-label">Pool Progress</span>
            <span class="info-value" data-bind="pool-pct">--</span>
          </div>
          <div class="pool-fill-track">
            <div class="pool-fill-bar" data-bind="pool-bar" style="width: 0%"></div>
          </div>
          <div class="pool-fill-amounts">
            <span data-bind="pool-current">0</span> / <span data-bind="pool-target">--</span> ETH
          </div>
        </div>

        <!-- ETH mode -->
        <div class="pay-section" data-pay="eth">
          <div class="purchase-row">
            <label>Tickets</label>
            <div class="input-group">
              <button class="incr-btn" data-incr="eth-qty" data-delta="-1">-1</button>
              <input type="number" class="qty-input" data-input="eth-qty" value="0" min="0" step="1">
              <button class="incr-btn" data-incr="eth-qty" data-delta="1">+1</button>
              <button class="incr-btn" data-incr="eth-qty" data-delta="10">+10</button>
            </div>
            <span class="purchase-cost" data-bind="eth-ticket-cost">0 ETH</span>
          </div>
          <div class="purchase-row">
            <label>Lootbox (ETH)</label>
            <div class="input-group">
              <input type="number" data-input="eth-lootbox" value="" min="0" step="0.001" placeholder="0.00">
            </div>
            <span class="lootbox-badge" data-bind="lootbox-badge"></span>
          </div>
          <div class="ev-indicator" data-bind="ev-indicator"></div>
          <div class="purchase-total">
            <span class="info-label">Total</span>
            <span class="info-value" data-bind="eth-total">0 ETH</span>
          </div>
          <button class="btn-primary buy-eth-btn" data-action="buy-eth">Buy with ETH</button>
        </div>

        <!-- BURNIE mode -->
        <div class="pay-section" data-pay="burnie" hidden>
          <div class="purchase-info-row info-row">
            <span class="info-label">Rate</span>
            <span class="info-value">1,000 BURNIE / ticket</span>
          </div>
          <div class="purchase-info-row info-row">
            <span class="info-label">Your BURNIE</span>
            <span class="info-value" data-bind="burnie-balance">--</span>
          </div>
          <div class="purchase-row">
            <label>Tickets</label>
            <div class="input-group">
              <button class="incr-btn" data-incr="burnie-qty" data-delta="-1">-1</button>
              <input type="number" class="qty-input" data-input="burnie-qty" value="0" min="0" step="1">
              <button class="incr-btn" data-incr="burnie-qty" data-delta="1">+1</button>
              <button class="incr-btn" data-incr="burnie-qty" data-delta="10">+10</button>
            </div>
            <span class="purchase-cost" data-bind="burnie-ticket-cost">0 BURNIE</span>
          </div>
          <div class="purchase-row">
            <label>Lootbox (BURNIE)</label>
            <div class="input-group">
              <input type="number" data-input="burnie-lootbox" value="" min="0" step="100" placeholder="0">
            </div>
          </div>
          <button class="btn-primary buy-burnie-btn" data-action="buy-burnie">Buy with BURNIE</button>
        </div>

        <!-- Error display -->
        <div class="purchase-error" data-bind="error" hidden></div>
      </div>
    `;

    // Wire pay-toggle buttons
    this.querySelectorAll('.pay-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => this.#switchPayMode(btn.dataset.mode));
    });

    // Wire increment buttons
    this.querySelectorAll('[data-incr]').forEach(btn => {
      btn.addEventListener('click', () => {
        const inputName = btn.dataset.incr;
        const delta = parseInt(btn.dataset.delta, 10);
        const input = this.querySelector(`[data-input="${inputName}"]`);
        if (input) {
          const current = parseInt(input.value, 10) || 0;
          input.value = Math.max(0, current + delta);
          input.dispatchEvent(new Event('input'));
        }
      });
    });

    // Wire buy buttons
    this.querySelector('.buy-eth-btn').addEventListener('click', () => this.#handleBuyEth());
    this.querySelector('.buy-burnie-btn').addEventListener('click', () => this.#handleBuyBurnie());

    // Wire ETH input changes to recalculate total
    this.querySelector('[data-input="eth-qty"]').addEventListener('input', () => this.#recalcTotal());
    this.querySelector('[data-input="eth-lootbox"]').addEventListener('input', () => this.#recalcTotal());

    // Wire BURNIE qty input to update cost display
    this.querySelector('[data-input="burnie-qty"]').addEventListener('input', () => {
      const qty = parseInt(this.querySelector('[data-input="burnie-qty"]').value, 10) || 0;
      this.#bind('burnie-ticket-cost', `${(qty * 1000).toLocaleString()} BURNIE`);
    });

    // Subscribe to store paths
    this.#unsubs.push(
      subscribe('game.price', (v) => this.#updatePrice(v)),
      subscribe('game.level', () => this.#refreshPoolTarget()),
      subscribe('game.pools.next', (v) => this.#updatePoolProgress(v)),
      subscribe('player.balances.burnie', (v) => {
        this.#bind('burnie-balance', v && v !== '0' ? formatBurnie(v) + ' BURNIE' : '--');
      }),
      subscribe('player.activityScore.total', (v) => this.#updateEvIndicator(v)),
      subscribe('ui.connectionState', (state) => {
        const disabled = state !== 'connected';
        const ethBtn = this.querySelector('.buy-eth-btn');
        const burnieBtn = this.querySelector('.buy-burnie-btn');
        if (ethBtn) ethBtn.disabled = disabled;
        if (burnieBtn) burnieBtn.disabled = disabled;
      }),
    );

    // Fetch presale flag (once at mount)
    fetchPresaleFlag().then(flag => {
      this.#isPresale = flag;
      if (this.#currentPrice) this.#updateBadge();
    });
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    if (this.#errorTimeout) clearTimeout(this.#errorTimeout);
  }

  // -- Private methods --

  #bind(key, value) {
    const el = this.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = value;
  }

  #switchPayMode(mode) {
    this.#payMode = mode;
    const ethSection = this.querySelector('[data-pay="eth"]');
    const burnieSection = this.querySelector('[data-pay="burnie"]');
    if (ethSection) ethSection.hidden = mode !== 'eth';
    if (burnieSection) burnieSection.hidden = mode !== 'burnie';

    this.querySelectorAll('.pay-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  #updatePrice(priceWei) {
    this.#currentPrice = priceWei;
    this.#recalcTotal();
    this.#updateBadge();
  }

  #recalcTotal() {
    if (!this.#currentPrice) return;
    const qty = parseInt(this.querySelector('[data-input="eth-qty"]')?.value, 10) || 0;
    const lootboxStr = this.querySelector('[data-input="eth-lootbox"]')?.value || '';

    try {
      const priceWei = BigInt(this.#currentPrice);
      const ticketCostWei = priceWei * BigInt(Math.max(qty, 0));
      this.#bind('eth-ticket-cost', formatEth(ticketCostWei.toString()) + ' ETH');

      let lootboxWei = 0n;
      if (lootboxStr && parseFloat(lootboxStr) > 0) {
        // Use string math to avoid floating point: split on decimal
        const parts = lootboxStr.split('.');
        const whole = parts[0] || '0';
        const frac = (parts[1] || '').padEnd(18, '0').slice(0, 18);
        lootboxWei = BigInt(whole) * 10n ** 18n + BigInt(frac);
      }
      const totalWei = ticketCostWei + lootboxWei;
      this.#bind('eth-total', formatEth(totalWei.toString()) + ' ETH');
    } catch {
      // Invalid input, keep current display
    }
  }

  #updateBadge() {
    if (!this.#currentPrice) return;
    try {
      const text = lootboxBadgeText(this.#currentPrice, this.#isPresale);
      this.#bind('lootbox-badge', text);
    } catch {
      this.#bind('lootbox-badge', '');
    }
  }

  async #refreshPoolTarget() {
    try {
      this.#poolTarget = await fetchPoolTarget();
      if (this.#poolTarget && this.#poolTarget !== '0') {
        this.#bind('pool-target', formatEth(this.#poolTarget));
      }
      // Re-update progress with current pool value
      const nextPool = get('game.pools.next');
      if (nextPool) this.#updatePoolProgress(nextPool);
    } catch {
      // Degrade gracefully
    }
  }

  #updatePoolProgress(nextPoolWei) {
    const pct = calcPoolFillPercent(nextPoolWei || '0', this.#poolTarget);
    this.#bind('pool-pct', pct.toFixed(1) + '%');

    const bar = this.querySelector('[data-bind="pool-bar"]');
    if (bar) bar.style.width = pct + '%';

    this.#bind('pool-current', formatEth(nextPoolWei || '0'));
  }

  #updateEvIndicator(scoreBps) {
    const el = this.querySelector('[data-bind="ev-indicator"]');
    if (!el) return;
    if (!scoreBps || scoreBps === 0) {
      el.innerHTML = '';
      return;
    }
    const cls = lootboxEvClass(scoreBps);
    const label = lootboxEvLabel(scoreBps);
    el.className = `ev-indicator ${cls}`;
    el.textContent = `Lootbox: ${label}`;
  }

  async #handleBuyEth() {
    const qtyInput = this.querySelector('[data-input="eth-qty"]');
    const lootboxInput = this.querySelector('[data-input="eth-lootbox"]');
    const qty = parseInt(qtyInput?.value, 10) || 0;
    const lootbox = lootboxInput?.value || '';
    const btn = this.querySelector('.buy-eth-btn');

    if (btn) btn.disabled = true;
    try {
      await buyEthTicketsAndLootbox(qty, lootbox, getAffiliateCode());
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Transaction failed');
      }
    } finally {
      // Re-enable only if connected
      if (btn && get('ui.connectionState') === 'connected') btn.disabled = false;
    }
  }

  async #handleBuyBurnie() {
    const qtyInput = this.querySelector('[data-input="burnie-qty"]');
    const lootboxInput = this.querySelector('[data-input="burnie-lootbox"]');
    const qty = parseInt(qtyInput?.value, 10) || 0;
    const lootbox = lootboxInput?.value || '';
    const btn = this.querySelector('.buy-burnie-btn');

    if (btn) btn.disabled = true;
    try {
      await buyBurnieTickets(qty, lootbox);
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Transaction failed');
      }
    } finally {
      if (btn && get('ui.connectionState') === 'connected') btn.disabled = false;
    }
  }

  #showError(msg) {
    const el = this.querySelector('[data-bind="error"]');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    if (this.#errorTimeout) clearTimeout(this.#errorTimeout);
    this.#errorTimeout = setTimeout(() => {
      el.hidden = true;
      el.textContent = '';
    }, 5000);
  }
}

customElements.define('purchase-panel', PurchasePanel);
