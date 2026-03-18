// components/terminal-panel.js -- Terminal/GAMEOVER panel Custom Element
// Payout preview (90/10 split, player's level+1 tickets), insurance bar
// (stETH yield accumulator), terminal decimator burn section, claim section.
// All contract interaction delegated to terminal.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import {
  burnForTerminalDecimator,
  claimTerminalDecimator,
  fetchTerminalState,
  fetchInsuranceData,
} from '../app/terminal.js';
import { formatEth, formatBurnie } from '../app/utils.js';
import { DECIMATOR } from '../app/constants.js';

class TerminalPanel extends HTMLElement {
  #unsubs = [];
  #errorTimeout = null;
  #dataLoaded = false;
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
      <div data-bind="skeleton" class="panel terminal-panel">
        <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:50%"></div></div>
        <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:45%"></div><div class="skeleton-line skeleton-shimmer" style="width:35%"></div></div>
        <div class="skeleton-block skeleton-shimmer" style="height:24px;margin-top:0.5rem"></div>
      </div>
      <div data-bind="content" style="display:none">
      <div class="panel terminal-panel">
        <div class="panel-header">
          <h2>TERMINAL</h2>
        </div>

        <!-- Payout Preview Section (TERM-01) -->
        <div class="terminal-payout-section">
          <h3>Payout Preview</h3>
          <p class="terminal-payout-desc">If GAMEOVER triggers, 90% of remaining funds go to level+1 ticketholders. 10% goes to terminal decimator winners.</p>
          <div class="terminal-tickets-row">
            <span class="terminal-tickets-label">Your Tickets (Level+1)</span>
            <span class="terminal-tickets-value" data-bind="tickets">--</span>
          </div>
        </div>

        <!-- Insurance Bar (TERM-02) -->
        <div class="terminal-insurance-section">
          <h3>Terminal Insurance</h3>
          <p class="terminal-insurance-desc">Segregated stETH yield reserve backing terminal payouts.</p>
          <div class="terminal-insurance-bar-wrap">
            <div class="terminal-insurance-bar" data-bind="insurance-bar" style="width: 0%"></div>
          </div>
          <div class="terminal-insurance-stats">
            <span data-bind="insurance-value">0 ETH</span>
          </div>
        </div>

        <!-- Terminal Decimator Burns -->
        <div class="terminal-dec-section">
          <h3>Terminal Decimator</h3>
          <div class="terminal-dec-info-row">
            <div class="stat">
              <div class="stat-label">Time Multiplier</div>
              <div class="stat-value" data-bind="time-mult">--</div>
            </div>
            <div class="stat">
              <div class="stat-label">Days Remaining</div>
              <div class="stat-value" data-bind="days-remaining">--</div>
            </div>
            <div class="stat">
              <div class="stat-label">Your Burns</div>
              <div class="stat-value" data-bind="terminal-burn-total">0 BURNIE</div>
            </div>
          </div>
          <div class="terminal-burn-input-row">
            <input type="number" class="terminal-burn-input" min="1000" step="1000" placeholder="Min 1,000 BURNIE" data-bind="terminal-burn-input">
            <button class="btn-primary terminal-burn-btn" data-action="terminal-burn" disabled>BURN</button>
          </div>
          <span class="terminal-hint">Higher time multiplier = earlier burns count more.</span>
          <span class="terminal-error" data-bind="terminal-error" hidden></span>
          <span class="terminal-blocked-msg" data-bind="blocked-msg" hidden>Burns blocked (death clock expired or last day).</span>
        </div>

        <!-- Terminal Decimator Claim -->
        <div class="terminal-claim-section" data-bind="terminal-claim-section" hidden>
          <span class="terminal-claim-label">Terminal Decimator Jackpot</span>
          <span class="terminal-claimable-value" data-bind="terminal-claimable">0 ETH</span>
          <button class="btn-primary terminal-claim-btn" data-action="claim-terminal-dec">Claim</button>
        </div>
      </div>
      </div>
    `;

    // -- Event Listeners --

    // Terminal burn button
    this.querySelector('[data-action="terminal-burn"]').addEventListener('click', () => this.#handleBurn());

    // Terminal claim button
    this.querySelector('[data-action="claim-terminal-dec"]').addEventListener('click', () => this.#handleClaim());

    // Burn input validation
    const burnInput = this.querySelector('[data-bind="terminal-burn-input"]');
    burnInput.addEventListener('input', () => this.#validateBurnInput());

    // -- Store Subscriptions --

    // On wallet connect/disconnect, fetch terminal data
    this.#unsubs.push(
      subscribe('player.address', (address) => {
        fetchTerminalState(address || null);
        fetchInsuranceData();
        if (address) this.#dataLoaded = true;
        this.#validateBurnInput();
      })
    );

    // Terminal dec window availability
    this.#unsubs.push(
      subscribe('terminal.decWindowOpen', (open) => {
        if (open !== undefined) this.#showContent();
        // Terminal dec is almost always open (except lastPurchaseDay/gameOver).
        // When closed, hide burn section inputs but still show payout preview.
        const burnSection = this.querySelector('.terminal-dec-section');
        if (burnSection) burnSection.hidden = !open;
      })
    );

    // Time multiplier display
    this.#unsubs.push(
      subscribe('terminal.timeMultiplier', (mult) => {
        const multEl = this.querySelector('[data-bind="time-mult"]');
        const blockedMsg = this.querySelector('[data-bind="blocked-msg"]');
        const burnBtn = this.querySelector('[data-action="terminal-burn"]');

        if (mult === null) {
          if (multEl) multEl.textContent = 'BLOCKED';
          if (blockedMsg) blockedMsg.hidden = false;
          if (burnBtn) burnBtn.disabled = true;
        } else {
          if (multEl) multEl.textContent = mult.toFixed(2) + 'x';
          if (blockedMsg) blockedMsg.hidden = true;
          this.#validateBurnInput();
        }
      })
    );

    // Days remaining display
    this.#unsubs.push(
      subscribe('terminal.daysRemaining', (days) => {
        this.#setTextContent('days-remaining', days != null ? days : '--');
      })
    );

    // Insurance bar: yield accumulator value
    this.#unsubs.push(
      subscribe('terminal.yieldAccumulator', (acc) => {
        this.#setTextContent('insurance-value', acc && acc !== '0' ? formatEth(acc) + ' ETH' : '0 ETH');
        this.#updateInsuranceBar();
      })
    );

    // Insurance bar: future pool (for bar width calculation)
    this.#unsubs.push(
      subscribe('terminal.futurePool', () => {
        this.#updateInsuranceBar();
      })
    );

    // Tickets at level+1
    this.#unsubs.push(
      subscribe('terminal.playerTicketsNextLevel', (tickets) => {
        this.#setTextContent('tickets', tickets != null ? tickets : '--');
      })
    );

    // Claimable section visibility
    this.#unsubs.push(
      subscribe('terminal.claimable', (claimable) => {
        const section = this.querySelector('[data-bind="terminal-claim-section"]');
        const hasClaimable = claimable && claimable !== '0';
        if (section) section.hidden = !hasClaimable;
        if (hasClaimable) {
          this.#setTextContent('terminal-claimable', formatEth(claimable) + ' ETH');
        }
      })
    );

    // Winner styling
    this.#unsubs.push(
      subscribe('terminal.isWinner', (winner) => {
        const panel = this.querySelector('.terminal-panel');
        if (panel) {
          panel.classList.toggle('terminal-winner', !!winner);
        }
      })
    );

    // Player burn total display
    this.#unsubs.push(
      subscribe('terminal.playerBurnTotal', (total) => {
        this.#setTextContent('terminal-burn-total', total && total !== '0' ? formatBurnie(total) + ' BURNIE' : '0 BURNIE');
      })
    );

    // Connection state for button enable/disable
    this.#unsubs.push(
      subscribe('ui.connectionState', () => {
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

  #updateInsuranceBar() {
    const acc = get('terminal.yieldAccumulator');
    const fp = get('terminal.futurePool');
    const bar = this.querySelector('[data-bind="insurance-bar"]');
    if (!bar) return;

    if (!fp || fp === '0' || !acc || acc === '0') {
      bar.style.width = '0%';
      return;
    }

    // Percentage of accumulator relative to futurepool (capped at 100%)
    const accBig = BigInt(acc);
    const fpBig = BigInt(fp);
    const pct = fpBig > 0n ? Number((accBig * 100n) / fpBig) : 0;
    bar.style.width = Math.min(pct, 100) + '%';
  }

  #validateBurnInput() {
    const input = this.querySelector('[data-bind="terminal-burn-input"]');
    const btn = this.querySelector('[data-action="terminal-burn"]');
    if (!input || !btn) return;

    const val = parseFloat(input.value);
    const connected = get('ui.connectionState') === 'connected';
    const mult = get('terminal.timeMultiplier');
    const valid = !isNaN(val) && val >= parseFloat(DECIMATOR.MIN_BURN);

    // Disable if not valid, not connected, or multiplier is null (blocked)
    btn.disabled = !valid || !connected || mult === null;
  }

  async #handleBurn() {
    const input = this.querySelector('[data-bind="terminal-burn-input"]');
    const btn = this.querySelector('[data-action="terminal-burn"]');
    if (!input || !input.value) return;

    if (btn) btn.disabled = true;
    this.#hideError();

    try {
      await burnForTerminalDecimator(input.value);
      input.value = '';
      this.#validateBurnInput();
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Terminal burn failed');
      }
    } finally {
      this.#validateBurnInput();
    }
  }

  async #handleClaim() {
    const btn = this.querySelector('[data-action="claim-terminal-dec"]');
    if (btn) btn.disabled = true;

    try {
      await claimTerminalDecimator();
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Claim failed');
      }
    } finally {
      const btn2 = this.querySelector('[data-action="claim-terminal-dec"]');
      if (btn2) btn2.disabled = false;
    }
  }

  #showError(msg) {
    const el = this.querySelector('[data-bind="terminal-error"]');
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
    const el = this.querySelector('[data-bind="terminal-error"]');
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

customElements.define('terminal-panel', TerminalPanel);
