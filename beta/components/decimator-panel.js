// components/decimator-panel.js -- Decimator burn panel Custom Element
// Conditional visibility: only shown when decimator window is open (DECI-03).
// Displays jackpot pool, player bucket, burn multiplier, session burns (DECI-02).
// All contract interaction delegated to decimator.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import {
  burnForDecimator,
  claimDecimatorJackpot,
} from '../app/decimator.js';
import { fetchPlayerData } from '../app/api.js';
import { formatBurnie, formatEth } from '../app/utils.js';
import { DECIMATOR } from '../app/constants.js';

class DecimatorPanel extends HTMLElement {
  #unsubs = [];
  #errorTimeout = null;

  connectedCallback() {
    this.innerHTML = `
      <div class="panel decimator-panel">
        <div class="panel-header">
          <h2>DECIMATOR</h2>
          <span class="decimator-window-badge" data-bind="window-level">Level --</span>
        </div>

        <div class="decimator-info-row">
          <div class="stat">
            <div class="stat-label">Jackpot Pool</div>
            <div class="stat-value" data-bind="jackpot-pool">-- ETH</div>
          </div>
          <div class="stat">
            <div class="stat-label">Your Bucket</div>
            <div class="stat-value" data-bind="bucket">--</div>
          </div>
          <div class="stat">
            <div class="stat-label">Burn Multiplier</div>
            <div class="stat-value" data-bind="multiplier">1.00x</div>
          </div>
          <div class="stat">
            <div class="stat-label">Your Burns</div>
            <div class="stat-value" data-bind="burn-total">0 BURNIE</div>
          </div>
        </div>

        <div class="decimator-burn-section">
          <label class="decimator-label">Burn BURNIE</label>
          <div class="decimator-input-row">
            <input type="number" class="decimator-input" min="1000" step="1000" placeholder="Min 1,000" data-bind="burn-input">
            <button class="btn-primary decimator-burn-btn" data-action="burn" disabled>BURN</button>
          </div>
          <span class="decimator-hint">Min: 1,000 BURNIE. Lower bucket = better odds.</span>
          <span class="decimator-error" data-bind="error" hidden></span>
        </div>

        <div class="decimator-claim-section" data-bind="claim-section" hidden>
          <span class="decimator-claim-label">Decimator Jackpot</span>
          <span class="decimator-claimable-value" data-bind="claimable">0 ETH</span>
          <button class="btn-primary decimator-claim-btn" data-action="claim-dec">Claim</button>
        </div>
      </div>
    `;

    // -- Event Listeners --

    // Burn button
    this.querySelector('[data-action="burn"]').addEventListener('click', () => this.#handleBurn());

    // Claim button
    this.querySelector('[data-action="claim-dec"]').addEventListener('click', () => this.#handleClaim());

    // Burn input validation
    const burnInput = this.querySelector('[data-bind="burn-input"]');
    burnInput.addEventListener('input', () => this.#validateBurnInput());

    // -- Store Subscriptions --

    // Conditional visibility: panel hidden when decimator window closed (DECI-03)
    this.#unsubs.push(
      subscribe('game.decWindowOpen', (open) => {
        this.hidden = !open;
      })
    );

    // Connection state: disable burn button when not connected
    this.#unsubs.push(
      subscribe('ui.connectionState', () => {
        this.#validateBurnInput();
      })
    );

    // Window level display
    this.#unsubs.push(
      subscribe('decimator.windowLevel', (lvl) => {
        this.#setTextContent('window-level', lvl ? `Level ${lvl}` : 'Level --');
      })
    );

    // Bucket display
    this.#unsubs.push(
      subscribe('decimator.playerBucket', (bucket) => {
        this.#setTextContent('bucket', bucket || '--');
      })
    );

    // Multiplier display
    this.#unsubs.push(
      subscribe('decimator.activityMultiplier', (mult) => {
        this.#setTextContent('multiplier', mult ? mult.toFixed(2) + 'x' : '1.00x');
      })
    );

    // Burn total display
    this.#unsubs.push(
      subscribe('decimator.playerBurnTotal', (total) => {
        this.#setTextContent('burn-total', total && total !== '0' ? formatBurnie(total) + ' BURNIE' : '0 BURNIE');
      })
    );

    // Jackpot pool display (DECI-02: current burn pool from futurepool share)
    this.#unsubs.push(
      subscribe('decimator.burnPool', (pool) => {
        this.#setTextContent('jackpot-pool', pool && pool !== '0' ? formatEth(pool) + ' ETH' : '-- ETH');
      })
    );

    // Claimable section
    this.#unsubs.push(
      subscribe('decimator.claimable', (claimable) => {
        const section = this.querySelector('[data-bind="claim-section"]');
        const hasClaimable = claimable && claimable !== '0';
        if (section) section.hidden = !hasClaimable;
        if (hasClaimable) {
          this.#setTextContent('claimable', formatEth(claimable) + ' ETH');
        }
      })
    );

    // Winner styling
    this.#unsubs.push(
      subscribe('decimator.isWinner', (winner) => {
        const panel = this.querySelector('.decimator-panel');
        if (panel) {
          panel.classList.toggle('decimator-winner', !!winner);
        }
      })
    );

    // On wallet connect, fetch decimator state for the player
    this.#unsubs.push(
      subscribe('player.address', (address) => {
        if (address) fetchPlayerData(address);
        this.#validateBurnInput();
      })
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    if (this.#errorTimeout) clearTimeout(this.#errorTimeout);
  }

  // -- Private Methods --

  #setTextContent(key, value) {
    const el = this.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = value;
  }

  #validateBurnInput() {
    const input = this.querySelector('[data-bind="burn-input"]');
    const btn = this.querySelector('[data-action="burn"]');
    if (!input || !btn) return;

    const val = parseFloat(input.value);
    const connected = get('ui.connectionState') === 'connected';
    const valid = !isNaN(val) && val >= parseFloat(DECIMATOR.MIN_BURN);

    btn.disabled = !valid || !connected;
  }

  async #handleBurn() {
    const input = this.querySelector('[data-bind="burn-input"]');
    const btn = this.querySelector('[data-action="burn"]');
    if (!input || !input.value) return;

    if (btn) btn.disabled = true;
    this.#hideError();

    try {
      await burnForDecimator(input.value);
      input.value = '';
      this.#validateBurnInput();
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Burn failed');
      }
    } finally {
      this.#validateBurnInput();
    }
  }

  async #handleClaim() {
    const btn = this.querySelector('[data-action="claim-dec"]');
    if (btn) btn.disabled = true;

    try {
      const level = get('decimator.windowLevel');
      await claimDecimatorJackpot(level);
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Claim failed');
      }
    } finally {
      const btn2 = this.querySelector('[data-action="claim-dec"]');
      if (btn2) btn2.disabled = false;
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

customElements.define('decimator-panel', DecimatorPanel);
