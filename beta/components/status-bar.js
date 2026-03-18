// components/status-bar.js -- Game status bar Custom Element
// Displays level, phase, ticket price, next pool, activity score, death clock.
// Subscribes to store paths; auto-updates when values change.

import { subscribe } from '../app/store.js';
import { formatEth, formatScore } from '../app/utils.js';

class StatusBar extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = `
      <div class="status-bar">
        <div class="status-item">
          <span class="status-label">Level</span>
          <span class="status-value" data-bind="level">--</span>
        </div>
        <div class="status-item">
          <span class="status-label">Phase</span>
          <span class="status-value" data-bind="phase">--</span>
        </div>
        <div class="status-item">
          <span class="status-label">Ticket Price</span>
          <span class="status-value" data-bind="price">--</span>
        </div>
        <div class="status-item">
          <span class="status-label">Next Pool</span>
          <span class="status-value" data-bind="pool">--</span>
        </div>
        <div class="status-item">
          <span class="status-label">Activity Score</span>
          <span class="status-value" data-bind="score">--</span>
        </div>
        <div class="status-item">
          <span class="status-label">Death Clock</span>
          <span class="status-value" data-bind="death">--</span>
        </div>
      </div>
    `;

    // Subscribe to store paths -- each fires immediately with current value
    this.#unsubs.push(
      subscribe('game.level', (v) => this.#bind('level', v)),
      subscribe('game.phase', (v) => this.#bind('phase', v)),
      subscribe('game.price', (v) => this.#bind('price', v ? formatEth(v) + ' ETH' : '--')),
      subscribe('game.pools.next', (v) => this.#bind('pool', v !== '0' ? formatEth(v) + ' ETH' : '--')),
      subscribe('player.activityScore.total', (v) => {
        // Phase 6 shows total score only. Breakdown (quest/mint/affiliate/pass)
        // deferred to a later phase when individual component contract reads are available.
        // The API returns total via playerActivityScore() contract call; breakdown
        // sub-paths will remain 0 until that phase.
        this.#bind('score', v > 0 ? formatScore(v) : '--');
      }),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }

  #bind(key, value) {
    const el = this.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = value;
  }
}

customElements.define('game-status-bar', StatusBar);
