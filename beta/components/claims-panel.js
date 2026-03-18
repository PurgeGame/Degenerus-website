// components/claims-panel.js -- Unified claims panel Custom Element
// Aggregates ETH and BURNIE claimable amounts with separate claim buttons.
// All contract interaction delegated to claims.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import { fetchAllClaimable, claimEth, claimBurnie } from '../app/claims.js';
import { formatEth, formatBurnie } from '../app/utils.js';

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
            <span class="claim-label">BURNIE Winnings</span>
            <span class="claim-amount burnie-claimable">0</span>
            <button class="btn-action claim-burnie-btn" disabled>Claim BURNIE</button>
          </div>
        </div>
        <p class="claims-note text-dim">ETH and BURNIE claims are separate transactions</p>
      </div>
      </div>
    `;

    // -- Event Listeners --

    this.querySelector('.claim-eth-btn').addEventListener('click', () => this.#handleClaimEth());
    this.querySelector('.claim-burnie-btn').addEventListener('click', () => this.#handleClaimBurnie());

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
    const burnieEl = this.querySelector('.burnie-claimable');

    if (ethEl) ethEl.textContent = c.eth && c.eth !== '0' ? formatEth(c.eth) + ' ETH' : '0';
    if (burnieEl) burnieEl.textContent = c.burnie && c.burnie !== '0' ? formatBurnie(c.burnie) + ' BURNIE' : '0';

    this.#updateButtonStates();
  }

  #updateButtonStates() {
    const connected = get('ui.connectionState') === 'connected';
    const claims = get('claims') || { eth: '0', burnie: '0' };

    const ethBtn = this.querySelector('.claim-eth-btn');
    const burnieBtn = this.querySelector('.claim-burnie-btn');

    if (ethBtn) ethBtn.disabled = !connected || !claims.eth || claims.eth === '0';
    if (burnieBtn) burnieBtn.disabled = !connected || !claims.burnie || claims.burnie === '0';
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

  async #handleClaimBurnie() {
    const btn = this.querySelector('.claim-burnie-btn');
    if (btn) btn.disabled = true;

    try {
      await claimBurnie();
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        console.error('[claims] BURNIE claim failed:', err);
      }
    } finally {
      this.#updateButtonStates();
    }
  }
}

customElements.define('claims-panel', ClaimsPanel);
