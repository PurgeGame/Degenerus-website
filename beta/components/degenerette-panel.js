// components/degenerette-panel.js -- Degenerette betting Custom Element
// Currency selector, bet form, pending bet tracker, slot-style GSAP reveal animation.
// All contract interaction delegated to degenerette.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import {
  placeBet,
  resolveBets,
  fetchDegeneretteState,
  currencyLabel,
} from '../app/degenerette.js';
import { formatEth, formatBurnie } from '../app/utils.js';
import { DEGENERETTE } from '../app/constants.js';

const CURRENCY_KEYS = ['ETH', 'BURNIE', 'WWXRP'];
const CURRENCY_VALUES = [DEGENERETTE.CURRENCY.ETH, DEGENERETTE.CURRENCY.BURNIE, DEGENERETTE.CURRENCY.WWXRP];

class DegenerettePanel extends HTMLElement {
  #unsubs = [];
  #errorTimeout = null;
  #selectedCurrency = DEGENERETTE.CURRENCY.ETH;
  #gsapLoaded = false;

  connectedCallback() {
    this.innerHTML = `
      <div class="panel degenerette-panel">
        <div class="panel-header">
          <h2>DEGENERETTE</h2>
        </div>

        <div class="degen-bet-form">
          <div class="currency-selector">
            <button data-currency="0" class="active">ETH</button>
            <button data-currency="1">BURNIE</button>
            <button data-currency="3">WWXRP</button>
          </div>
          <div class="bet-input-row">
            <label>Amount</label>
            <input type="number" class="degen-amount" step="0.001" min="0.005" placeholder="0.005" data-bind="amount-input">
            <span class="degen-min-label" data-bind="min-label">Min: ${DEGENERETTE.MIN_BET.ETH} ETH</span>
          </div>
          <div class="bet-input-row">
            <label>Spins</label>
            <input type="number" class="degen-spins" min="1" max="${DEGENERETTE.MAX_SPINS}" value="1" data-bind="spins-input">
          </div>
          <button class="btn-primary degen-bet-btn" data-action="place-bet" disabled>Place Bet</button>
          <span class="degen-error" data-bind="error" hidden></span>
        </div>

        <div class="degen-pending" data-bind="pending-section" hidden>
          <div class="degen-section-header">Pending Bets</div>
          <div class="pending-list" data-bind="pending-list"></div>
          <button class="btn-primary degen-resolve-btn" data-action="resolve" disabled>Resolve Bets</button>
        </div>

        <div class="degen-results" data-bind="results-section" hidden>
          <div class="degen-section-header">Last Results</div>
          <div class="slot-reels" data-bind="slot-reels"></div>
          <div class="result-summary" data-bind="result-summary"></div>
        </div>
      </div>
    `;

    // Preload GSAP on mount to avoid CDN jank on first reveal
    this.#preloadGsap();

    // -- Event Listeners --

    // Currency selector
    this.querySelectorAll('.currency-selector button').forEach(btn => {
      btn.addEventListener('click', () => this.#selectCurrency(Number(btn.dataset.currency)));
    });

    // Place bet button
    this.querySelector('[data-action="place-bet"]').addEventListener('click', () => this.#handlePlaceBet());

    // Resolve button
    this.querySelector('[data-action="resolve"]').addEventListener('click', () => this.#handleResolve());

    // Input validation
    const amountInput = this.querySelector('[data-bind="amount-input"]');
    const spinsInput = this.querySelector('[data-bind="spins-input"]');
    amountInput.addEventListener('input', () => this.#validateInputs());
    spinsInput.addEventListener('input', () => this.#validateInputs());

    // -- Store Subscriptions --

    // On wallet connect, fetch degenerette state
    this.#unsubs.push(
      subscribe('player.address', (address) => {
        if (address) {
          fetchDegeneretteState(address);
        }
        this.#validateInputs();
      })
    );

    // Update pending bets display and resolve button state
    this.#unsubs.push(
      subscribe('degenerette', (degen) => {
        if (!degen) return;
        this.#renderPending(degen.pendingBets);
        this.#updateResolveButton(degen.pendingBets);
      })
    );

    // Update last results with slot animation
    this.#unsubs.push(
      subscribe('degenerette.lastResults', (results) => {
        if (results && results.length > 0) {
          this.#animateResults(results);
        }
      })
    );

    // RNG lock state affects resolve button
    this.#unsubs.push(
      subscribe('game.rngLocked', () => {
        const pending = get('degenerette.pendingBets') || [];
        this.#updateResolveButton(pending);
      })
    );

    // Connection state affects bet button
    this.#unsubs.push(
      subscribe('ui.connectionState', () => this.#validateInputs())
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    if (this.#errorTimeout) clearTimeout(this.#errorTimeout);
  }

  // -- Private Methods --

  async #preloadGsap() {
    try {
      await import('gsap');
      this.#gsapLoaded = true;
    } catch {
      console.warn('[DegenerettePanel] GSAP preload failed');
    }
  }

  #selectCurrency(currency) {
    this.#selectedCurrency = currency;

    // Update active button
    this.querySelectorAll('.currency-selector button').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.currency) === currency);
    });

    // Update min bet label and input constraints
    const key = CURRENCY_KEYS[CURRENCY_VALUES.indexOf(currency)];
    const minBet = DEGENERETTE.MIN_BET[key];
    const minLabel = this.querySelector('[data-bind="min-label"]');
    const amountInput = this.querySelector('[data-bind="amount-input"]');

    if (minLabel) minLabel.textContent = `Min: ${minBet} ${key}`;
    if (amountInput) {
      amountInput.min = minBet;
      amountInput.placeholder = minBet;
      if (key === 'ETH') {
        amountInput.step = '0.001';
      } else if (key === 'BURNIE') {
        amountInput.step = '1';
      } else {
        amountInput.step = '0.1';
      }
    }

    this.#validateInputs();
  }

  #validateInputs() {
    const amountInput = this.querySelector('[data-bind="amount-input"]');
    const spinsInput = this.querySelector('[data-bind="spins-input"]');
    const betBtn = this.querySelector('[data-action="place-bet"]');
    if (!amountInput || !spinsInput || !betBtn) return;

    const connected = get('ui.connectionState') === 'connected';
    const key = CURRENCY_KEYS[CURRENCY_VALUES.indexOf(this.#selectedCurrency)];
    const minBet = parseFloat(DEGENERETTE.MIN_BET[key]);
    const amount = parseFloat(amountInput.value);
    const spins = parseInt(spinsInput.value, 10);

    const validAmount = !isNaN(amount) && amount >= minBet;
    const validSpins = !isNaN(spins) && spins >= 1 && spins <= DEGENERETTE.MAX_SPINS;

    betBtn.disabled = !connected || !validAmount || !validSpins;
  }

  #renderPending(pendingBets) {
    const section = this.querySelector('[data-bind="pending-section"]');
    const list = this.querySelector('[data-bind="pending-list"]');
    if (!section || !list) return;

    if (!pendingBets || pendingBets.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    list.innerHTML = pendingBets.map(bet => `
      <div class="pending-bet">
        <span class="pending-bet-id">Bet #${bet.betId}</span>
        <span class="pending-bet-detail">${bet.amount} ${currencyLabel(bet.currency)} x${bet.ticketCount}</span>
        <span class="pending-bet-status">Waiting for RNG...</span>
      </div>
    `).join('');
  }

  #updateResolveButton(pendingBets) {
    const resolveBtn = this.querySelector('[data-action="resolve"]');
    if (!resolveBtn) return;

    const hasPending = pendingBets && pendingBets.length > 0;
    const rngAvailable = !get('game.rngLocked');

    resolveBtn.disabled = !hasPending || !rngAvailable;
  }

  async #handlePlaceBet() {
    const amountInput = this.querySelector('[data-bind="amount-input"]');
    const spinsInput = this.querySelector('[data-bind="spins-input"]');
    const betBtn = this.querySelector('[data-action="place-bet"]');
    if (!amountInput || !amountInput.value) return;

    if (betBtn) betBtn.disabled = true;
    this.#hideError();

    try {
      const spins = parseInt(spinsInput.value, 10) || 1;
      await placeBet(this.#selectedCurrency, amountInput.value, spins);
      amountInput.value = '';
      spinsInput.value = '1';
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Bet failed');
      }
    } finally {
      this.#validateInputs();
    }
  }

  async #handleResolve() {
    const resolveBtn = this.querySelector('[data-action="resolve"]');
    if (resolveBtn) resolveBtn.disabled = true;

    try {
      const pending = get('degenerette.pendingBets') || [];
      const betIds = pending.map(b => b.betId);
      if (betIds.length === 0) return;
      await resolveBets(betIds);
    } catch (err) {
      if (err.code !== 'ACTION_REJECTED' && err.code !== 4001) {
        this.#showError(err.message || 'Resolve failed');
      }
    } finally {
      const pending = get('degenerette.pendingBets') || [];
      this.#updateResolveButton(pending);
    }
  }

  async #animateResults(results) {
    const reelsContainer = this.querySelector('[data-bind="slot-reels"]');
    const summaryEl = this.querySelector('[data-bind="result-summary"]');
    const section = this.querySelector('[data-bind="results-section"]');
    if (!reelsContainer || !summaryEl || !section) return;

    section.hidden = false;

    // Build 4 reel divs for the quadrant reveal
    reelsContainer.innerHTML = '';
    const quadrantLabels = ['A', 'B', 'C', 'D'];
    const reelEls = [];
    for (let i = 0; i < 4; i++) {
      const reel = document.createElement('div');
      reel.className = 'slot-reel';
      reel.innerHTML = `<span class="reel-label">${quadrantLabels[i]}</span><span class="reel-value">?</span>`;
      reelsContainer.appendChild(reel);
      reelEls.push(reel);
    }

    // Determine best result for display
    const bestResult = results.reduce((best, r) => r.matches > best.matches ? r : best, results[0]);
    const isWin = bestResult.matches > 0 && bestResult.payout !== '0';

    // Animate with GSAP if available
    try {
      const { gsap } = await import('gsap');
      const tl = gsap.timeline();

      // Spinning phase for all reels
      reelEls.forEach((reel, i) => {
        const valueEl = reel.querySelector('.reel-value');
        tl.to(valueEl, {
          duration: 0.5,
          delay: i * 0.3,
          onStart() {
            // Rapid cycling effect
            let cycles = 0;
            const symbols = ['*', '#', '@', '!', '%', '&'];
            const interval = setInterval(() => {
              valueEl.textContent = symbols[cycles % symbols.length];
              cycles++;
            }, 60);
            setTimeout(() => {
              clearInterval(interval);
              // Reveal: show match count for this quadrant
              const matched = i < bestResult.matches;
              valueEl.textContent = matched ? 'MATCH' : 'MISS';
              if (matched) {
                reel.classList.add('winner');
              }
            }, 450);
          },
          opacity: 1,
        });
      });

      // After all reels revealed, show summary
      tl.call(() => this.#showResultSummary(summaryEl, bestResult, isWin), [], '+=0.3');

      // Celebrate wins
      if (isWin) {
        tl.call(() => this.#celebrate(), [], '+=0.2');
      }
    } catch {
      // Fallback: instant reveal without animation
      reelEls.forEach((reel, i) => {
        const valueEl = reel.querySelector('.reel-value');
        const matched = i < bestResult.matches;
        valueEl.textContent = matched ? 'MATCH' : 'MISS';
        if (matched) reel.classList.add('winner');
      });
      this.#showResultSummary(summaryEl, bestResult, isWin);
      if (isWin) this.#celebrate();
    }
  }

  #showResultSummary(el, result, isWin) {
    if (isWin) {
      el.className = 'result-summary win';
      el.innerHTML = `
        <div class="result-matches">${result.matches} match${result.matches !== 1 ? 'es' : ''}!</div>
        <div class="result-payout">Won ${formatEth(result.payout)} ETH</div>
      `;
    } else {
      el.className = 'result-summary loss';
      el.innerHTML = `
        <div class="result-matches">No matches</div>
        <div class="result-payout">Better luck next time</div>
      `;
    }
  }

  async #celebrate() {
    try {
      const { default: confetti } = await import('canvas-confetti');

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#22c55e', '#8b5cf6', '#eab308', '#06b6d4'],
      });

      setTimeout(() => {
        confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 } });
      }, 200);
    } catch {
      console.warn('[DegenerettePanel] Confetti load failed');
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

customElements.define('degenerette-panel', DegenerettePanel);
