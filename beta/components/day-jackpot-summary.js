// components/day-jackpot-summary.js -- Day Jackpot Summary widget (Plan 39-10)
//
// Compact widget mounted inside <replay-panel> between the card grid / reveal
// button area and the winners distributions list on /beta/index.html.
//
// Summarises the currently-replayed day: winning traits from Roll 1 (main)
// and Roll 2 (bonus + far-future), wins-per-trait counts, and the payment
// per win (ETH / BURNIE). Reuses the row-render logic from jackpot-rolls.js
// via the `createJackpotRolls` factory — no duplication.
//
// Data flow:
//   replay-panel publishes replay.level when the user selects a day →
//   this widget subscribes and calls renderOverview(level), which fetches
//   `${API_BASE}/game/jackpot/{level}/overview` and populates .jo-grid.

import { subscribe } from '../app/store.js';
import { API_BASE } from '../app/constants.js';
import { createJackpotRolls } from '../app/jackpot-rolls.js';

class DayJackpotSummary extends HTMLElement {
  #unsubs = [];
  #rolls = null;

  connectedCallback() {
    // Build a jackpot-rolls-compatible grid. The factory clears non-header
    // children on each render, so the initial .jo-header cells are preserved.
    this.innerHTML = `
      <section class="day-jackpot-summary">
        <header>Day Jackpot Summary</header>
        <div class="day-jackpot-summary-body" data-bind="content">
          <div class="jo-grid" id="djs-grid">
            <div class="jo-header">Type</div>
            <div class="jo-header">Win</div>
            <div class="jo-header">Uniq</div>
            <div class="jo-header">Coin</div>
            <div class="jo-header">Tkts</div>
            <div class="jo-header">ETH</div>
            <div class="jo-header">Spread</div>
          </div>
          <div id="djs-status" class="jo-empty">Select a day to see jackpot details.</div>
          <div id="djs-far-future" style="display:none;">Far-future outcomes resolved.</div>
        </div>
      </section>
    `;

    // Create a jackpot-rolls controller scoped to this widget, with selectors
    // pointing at our own DOM. The factory also references `rollBtn` etc. but
    // renderOverview() only touches joGrid / joStatus / joFarFuture — and the
    // factory doesn't access the missing selectors at construction time.
    this.#rolls = createJackpotRolls({
      root: this,
      apiBase: API_BASE,
      selectors: {
        joGrid:      '#djs-grid',
        joStatus:    '#djs-status',
        joFarFuture: '#djs-far-future',
      },
    });

    this.#unsubs.push(
      subscribe('replay.level', (level) => this.#refresh(level)),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
    if (this.#rolls && typeof this.#rolls.dispose === 'function') {
      try { this.#rolls.dispose(); } catch (_) { /* noop */ }
    }
    this.#rolls = null;
  }

  #refresh(level) {
    const status = this.querySelector('#djs-status');
    const grid = this.querySelector('#djs-grid');

    // Clear any existing non-header rows so the empty state is clean.
    if (grid) {
      const children = Array.prototype.slice.call(grid.children);
      for (let i = 0; i < children.length; i++) {
        if (!children[i].classList.contains('jo-header')) grid.removeChild(children[i]);
      }
    }

    if (level == null) {
      if (status) {
        status.className = 'jo-empty';
        status.textContent = 'Select a day to see jackpot details.';
        status.style.display = 'block';
      }
      return;
    }

    try {
      // Delegate to the shared renderer — it fetches
      // `${API_BASE}/game/jackpot/{level}/overview`, handles 404 / empty /
      // error states, and populates the grid with .jo-row children.
      this.#rolls.renderOverview(level);
    } catch (err) {
      console.error('[day-jackpot-summary] renderOverview failed', err);
      if (status) {
        status.className = 'jo-empty';
        status.textContent = 'Unable to load jackpot details.';
        status.style.display = 'block';
      }
    }
  }
}

customElements.define('day-jackpot-summary', DayJackpotSummary);
