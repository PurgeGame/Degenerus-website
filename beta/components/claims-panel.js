// components/claims-panel.js -- Unified claims panel Custom Element
// Aggregates ETH and FLIP claimable amounts with separate claim buttons.
// All contract interaction delegated to claims.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import { fetchAllClaimable, claimEth, claimFlip } from '../app/claims.js';
import { formatEth, formatFlip } from '../app/utils.js';

class ClaimsPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #errorShown = false;

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.style.display = '';
  }

  connectedCallback() {
    this.innerHTML = `
      <div data-bind="skeleton" class="panel claims-panel">
        <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
        <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:50%"></div><div class="skeleton-line skeleton-shimmer" style="width:30%"></div></div>
        <div class="skeleton-block skeleton-shimmer" style="height:36px;margin-top:0.5rem"></div>
      </div>
      <div data-bind="content" style="display:none">
      <div class="panel claims-panel">
        <h3>Claim Winnings</h3>
        <div class="claims-summary">
          <div class="claim-row">
            <span class="claim-label">ETH Winnings</span>
            <span class="claim-amount eth-claimable">0</span>
            <button class="btn-action claim-eth-btn" disabled>Claim ETH</button>
          </div>
          <div class="claim-row">
            <span class="claim-label">FLIP Winnings</span>
            <span class="claim-amount flip-claimable">0</span>
            <button class="btn-action claim-flip-btn" disabled>Claim FLIP</button>
          </div>
        </div>
        <p class="claims-note text-dim">ETH and FLIP claims are separate transactions</p>
      </div>
      </div>
    `;

    // -- Event Listeners --

    this.querySelector('.claim-eth-btn').addEventListener('click', () => this.#handleClaimEth());
    this.querySelector('.claim-flip-btn').addEventListener('click', () => this.#handleClaimFlip());

    // -- Store Subscriptions --

    // On wallet connect, fetch all claimable amounts
    this.#unsubs.push(
      subscribe('player.address', (address) => {
        if (address) {
          fetchAllClaimable(address);
        }
        this.#updateButtonStates();
      })
    );

    // Update amounts and button states on claims changes
    this.#unsubs.push(
      subscribe('claims', (c) => {
        if (!c) return;
        this.#showContent();
        this.#renderClaims(c);
      })
    );

    // Disable buttons when wallet disconnected
    this.#unsubs.push(
      subscribe('ui.connectionState', () => {
        this.#showContent();
        this.#updateButtonStates();
      })
    );

    // Error fallback on API failure
    this.#unsubs.push(
      subscribe('ui', (ui) => {
        if (!ui) return;
        if (ui.apiHealthy === false && ui.staleData === true && this.#loaded && !this.#errorShown) {
          this.#errorShown = true;
          const content = this.querySelector('[data-bind="content"]');
          if (content) content.style.display = 'none';
          const errorDiv = document.createElement('div');
          errorDiv.setAttribute('data-bind', 'error-state');
          errorDiv.innerHTML = `<div class="panel-error-state"><span class="panel-error-icon">!</span><span class="panel-error-msg">Unable to load claims data</span><button class="panel-error-retry">Retry</button></div>`;
          errorDiv.querySelector('.panel-error-retry').addEventListener('click', () => {
            import('../app/api.js').then(m => m.startPolling());
          });
          this.appendChild(errorDiv);
        } else if (ui.apiHealthy === true && this.#errorShown) {
          this.#errorShown = false;
          this.querySelector('[data-bind="error-state"]')?.remove();
          const content = this.querySelector('[data-bind="content"]');
          if (content) content.style.display = '';
        }
      })
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }

  // -- Private methods --

  #renderClaims(c) {
    const ethEl = this.querySelector('.eth-claimable');
    const flipEl = this.querySelector('.flip-claimable');

    if (ethEl) ethEl.textContent = c.eth && c.eth !== '0' ? formatEth(c.eth) + ' ETH' : '0';
    if (flipEl) flipEl.textContent = c.flip && c.flip !== '0' ? formatFlip(c.flip) + ' FLIP' : '0';

    this.#updateButtonStates();
  }

  #updateButtonStates() {
    const connected = get('ui.connectionState') === 'connected';
    const claims = get('claims') || { eth: '0', flip: '0' };

    const ethBtn = this.querySelector('.claim-eth-btn');
    const flipBtn = this.querySelector('.claim-flip-btn');

    if (ethBtn) ethBtn.disabled = !connected || !claims.eth || claims.eth === '0';
    if (flipBtn) flipBtn.disabled = !connected || !claims.flip || claims.flip === '0';
  }

  async #handleClaimEth() {
    const btn = this.querySelector('.claim-eth-btn');
    if (btn) btn.disabled = true;

    try {
      await claimEth();
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        console.error('[claims] ETH claim failed:', err);
      }
    } finally {
      this.#updateButtonStates();
    }
  }

  async #handleClaimFlip() {
    const btn = this.querySelector('.claim-flip-btn');
    if (btn) btn.disabled = true;

    try {
      await claimFlip();
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        console.error('[claims] FLIP claim failed:', err);
      }
    } finally {
      this.#updateButtonStates();
    }
  }
}

customElements.define('claims-panel', ClaimsPanel);
