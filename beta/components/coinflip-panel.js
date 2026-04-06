// components/coinflip-panel.js -- Coinflip panel Custom Element
// BURNIE staking, multiplier-tier result display, bounty tracker, auto-rebuy toggle.
// All contract interaction delegated to coinflip.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import {
  depositCoinflip,
  claimCoinflips,
  setAutoRebuy,
  getMultiplierTier,
  isCoinflipLocked,
} from '../app/coinflip.js';
import { fetchPlayerData } from '../app/api.js';
import { formatBurnie, truncateAddress } from '../app/utils.js';
import { COINFLIP } from '../app/constants.js';

class CoinflipPanel extends HTMLElement {
  #unsubs = [];
  #errorTimeout = null;
  #loaded = false;

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.style.display = '';
  }

  connectedCallback() {
    this.innerHTML = `
      <div data-bind="skeleton" class="panel coinflip-panel">
        <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
        <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div><div class="skeleton-block skeleton-shimmer" style="width:80px;height:36px"></div></div>
        <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:50%"></div></div>
        <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:30%"></div><div class="skeleton-line skeleton-shimmer" style="width:70%"></div></div>
      </div>
      <div data-bind="content" style="display:none">
      <div class="panel coinflip-panel">
        <div class="panel-header">
          <h2>BURNIE COINFLIP</h2>
          <span class="coinflip-recycle-badge">+${COINFLIP.RECYCLING_BONUS_PCT}% recycling</span>
        </div>

        <div class="coinflip-stake-section">
          <label class="coinflip-label">Stake BURNIE</label>
          <div class="coinflip-input-row">
            <input type="number" class="coinflip-input" min="100" step="100" placeholder="Min 100" data-bind="stake-input">
            <button class="btn-primary coinflip-deposit-btn" data-action="deposit" disabled>Deposit</button>
          </div>
          <span class="coinflip-hint" data-bind="stake-hint">Min: ${COINFLIP.MIN_DEPOSIT} BURNIE</span>
          <span class="coinflip-error" data-bind="error" hidden></span>
          <span class="coinflip-locked-msg" data-bind="locked-msg" hidden>Coinflip locked during resolution</span>
        </div>

        <div class="coinflip-result-section" data-bind="result-section" hidden>
          <div class="coinflip-result-header">Last Result</div>
          <div class="coinflip-multiplier" data-bind="multiplier">--</div>
          <div class="coinflip-result-desc" data-bind="result-desc"></div>
        </div>

        <div class="coinflip-claim-section" data-bind="claim-section" hidden>
          <span class="coinflip-claimable-label">Claimable</span>
          <span class="coinflip-claimable-value" data-bind="claimable">0 BURNIE</span>
          <button class="btn-primary coinflip-claim-btn" data-action="claim">Claim</button>
        </div>

        <div class="coinflip-bounty-section">
          <div class="coinflip-section-header">Bounty Tracker</div>
          <div class="coinflip-bounty-armed" data-bind="bounty-armed" data-armed="false">NOT ARMED</div>
          <div class="coinflip-bounty-stats">
            <div class="stat">
              <div class="stat-label">Bounty Pool</div>
              <div class="stat-value" data-bind="bounty-pool">--</div>
            </div>
            <div class="stat">
              <div class="stat-label">Record Flip</div>
              <div class="stat-value" data-bind="bounty-record">--</div>
            </div>
            <div class="stat">
              <div class="stat-label">Record Holder</div>
              <div class="stat-value" data-bind="bounty-holder">--</div>
            </div>
          </div>
        </div>

        <div class="coinflip-autorebuy-section">
          <div class="coinflip-section-header">Auto-Rebuy</div>
          <label class="coinflip-toggle-row">
            <input type="checkbox" data-bind="autorebuy-toggle">
            <span>Enable auto-rebuy</span>
          </label>
          <div class="coinflip-autorebuy-detail" data-bind="autorebuy-detail" hidden>
            <label class="coinflip-label">Take-Profit (BURNIE)</label>
            <div class="coinflip-input-row">
              <input type="number" class="coinflip-input" min="0" step="100" placeholder="0 = no limit" data-bind="takeprofit-input">
              <button class="btn-ghost coinflip-save-rebuy-btn" data-action="save-autorebuy">Save</button>
            </div>
          </div>
        </div>
      </div>
      </div>
    `;

    // -- Event Listeners --

    // Deposit button
    this.querySelector('[data-action="deposit"]').addEventListener('click', () => this.#handleDeposit());

    // Claim button
    this.querySelector('[data-action="claim"]').addEventListener('click', () => this.#handleClaim());

    // Auto-rebuy toggle: show/hide take-profit detail
    const toggle = this.querySelector('[data-bind="autorebuy-toggle"]');
    toggle.addEventListener('change', () => {
      const detail = this.querySelector('[data-bind="autorebuy-detail"]');
      if (detail) detail.hidden = !toggle.checked;
    });

    // Save auto-rebuy button
    this.querySelector('[data-action="save-autorebuy"]').addEventListener('click', () => this.#handleSaveAutoRebuy());

    // Stake input validation
    const stakeInput = this.querySelector('[data-bind="stake-input"]');
    stakeInput.addEventListener('input', () => this.#validateStakeInput());

    // -- Store Subscriptions --

    // On wallet connect/disconnect, fetch coinflip data
    this.#unsubs.push(
      subscribe('player.address', (address) => {
        if (address) {
          fetchPlayerData(address);
        }
        this.#validateStakeInput();
      })
    );

    // Update all coinflip display values
    this.#unsubs.push(
      subscribe('coinflip', (cf) => {
        if (!cf) return;
        this.#showContent();

        // Claimable section
        const claimSection = this.querySelector('[data-bind="claim-section"]');
        const hasClaimable = cf.claimable && cf.claimable !== '0';
        if (claimSection) claimSection.hidden = !hasClaimable;
        if (hasClaimable) {
          this.#setTextContent('claimable', formatBurnie(cf.claimable) + ' BURNIE');
        }

        // Auto-rebuy state
        if (cf.autoRebuy) {
          const rebuyToggle = this.querySelector('[data-bind="autorebuy-toggle"]');
          if (rebuyToggle && rebuyToggle.checked !== cf.autoRebuy.enabled) {
            rebuyToggle.checked = cf.autoRebuy.enabled;
          }
          const detail = this.querySelector('[data-bind="autorebuy-detail"]');
          if (detail) detail.hidden = !cf.autoRebuy.enabled;
        }

        // Bounty display
        if (cf.bounty) {
          const armed = cf.bounty.pool && cf.bounty.pool !== '0';
          const armedEl = this.querySelector('[data-bind="bounty-armed"]');
          if (armedEl) {
            armedEl.dataset.armed = armed ? 'true' : 'false';
            armedEl.textContent = armed ? 'ARMED' : 'NOT ARMED';
          }
          if (armed) {
            this.#setTextContent('bounty-pool', formatBurnie(cf.bounty.pool) + ' BURNIE');
          }
          if (cf.bounty.recordAmount && cf.bounty.recordAmount !== '0') {
            this.#setTextContent('bounty-record', formatBurnie(cf.bounty.recordAmount) + ' BURNIE');
          }
          if (cf.bounty.recordHolder) {
            this.#setTextContent('bounty-holder', truncateAddress(cf.bounty.recordHolder));
          }
        }
      })
    );

    // Last result display
    this.#unsubs.push(
      subscribe('coinflip.lastResult', (result) => {
        const section = this.querySelector('[data-bind="result-section"]');
        if (!section) return;

        if (!result) {
          section.hidden = true;
          return;
        }

        section.hidden = false;
        const tier = getMultiplierTier(result.rewardPercent);
        const multiplierEl = this.querySelector('[data-bind="multiplier"]');
        if (multiplierEl) {
          multiplierEl.textContent = tier.label;
          multiplierEl.className = 'coinflip-multiplier ' + tier.class;
        }
        this.#setTextContent('result-desc', tier.desc);
      })
    );

    // Lock state: disable buttons and show message
    this.#unsubs.push(
      subscribe('game', () => {
        this.#updateLockState();
      })
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    if (this.#errorTimeout) clearTimeout(this.#errorTimeout);
  }

  // -- Private methods --

  #setTextContent(key, value) {
    const el = this.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = value;
  }

  #validateStakeInput() {
    const input = this.querySelector('[data-bind="stake-input"]');
    const btn = this.querySelector('[data-action="deposit"]');
    const hint = this.querySelector('[data-bind="stake-hint"]');
    if (!input || !btn) return;

    const val = parseFloat(input.value);
    const locked = isCoinflipLocked();
    const connected = !!get('player.address');
    const valid = !isNaN(val) && val >= parseFloat(COINFLIP.MIN_DEPOSIT);

    btn.disabled = !valid || locked || !connected;

    if (hint) {
      if (locked) {
        hint.textContent = 'Coinflip locked during resolution';
        hint.style.color = 'var(--warning)';
      } else if (input.value && !valid) {
        hint.textContent = `Min: ${COINFLIP.MIN_DEPOSIT} BURNIE`;
        hint.style.color = 'var(--warning)';
      } else {
        hint.textContent = `Min: ${COINFLIP.MIN_DEPOSIT} BURNIE`;
        hint.style.color = '';
      }
    }
  }

  #updateLockState() {
    const locked = isCoinflipLocked();
    const lockedMsg = this.querySelector('[data-bind="locked-msg"]');
    if (lockedMsg) lockedMsg.hidden = !locked;

    const depositBtn = this.querySelector('[data-action="deposit"]');
    const claimBtn = this.querySelector('[data-action="claim"]');
    if (depositBtn && locked) depositBtn.disabled = true;
    if (claimBtn) claimBtn.disabled = locked;

    // Re-validate input in case lock state changed
    this.#validateStakeInput();
  }

  async #handleDeposit() {
    const input = this.querySelector('[data-bind="stake-input"]');
    const btn = this.querySelector('[data-action="deposit"]');
    if (!input || !input.value) return;

    if (btn) btn.disabled = true;
    this.#hideError();

    try {
      await depositCoinflip(input.value);
      input.value = '';
      this.#validateStakeInput();
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Deposit failed');
      }
    } finally {
      if (btn && !isCoinflipLocked() && get('player.address')) {
        this.#validateStakeInput();
      }
    }
  }

  async #handleClaim() {
    const btn = this.querySelector('[data-action="claim"]');
    if (btn) btn.disabled = true;

    try {
      await claimCoinflips();
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Claim failed');
      }
    } finally {
      if (btn && !isCoinflipLocked()) btn.disabled = false;
    }
  }

  async #handleSaveAutoRebuy() {
    const toggle = this.querySelector('[data-bind="autorebuy-toggle"]');
    const takeProfitInput = this.querySelector('[data-bind="takeprofit-input"]');
    const btn = this.querySelector('[data-action="save-autorebuy"]');

    const enabled = toggle ? toggle.checked : false;
    const takeProfit = takeProfitInput ? takeProfitInput.value || '0' : '0';

    if (btn) btn.disabled = true;

    try {
      await setAutoRebuy(enabled, takeProfit);
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Auto-rebuy update failed');
      }
    } finally {
      if (btn) btn.disabled = false;
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

  #hideError() {
    const el = this.querySelector('[data-bind="error"]');
    if (el) {
      el.hidden = true;
      el.textContent = '';
    }
    if (this.#errorTimeout) {
      clearTimeout(this.#errorTimeout);
      this.#errorTimeout = null;
    }
  }
}

customElements.define('coinflip-panel', CoinflipPanel);
