// components/status-bar.js -- Game status bar Custom Element
// In replay mode (replay.day is non-null): shows historical day/level from replay-panel.
// In live mode: subscribes to live game.* store paths.

import { subscribe } from '../app/store.js';

class StatusBar extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = `
      <div class="status-bar replay-mode">
        <div class="status-item">
          <span class="status-label">Day</span>
          <span class="status-value" data-bind="day">--</span>
        </div>
        <div class="status-item">
          <span class="status-label">Level</span>
          <span class="status-value" data-bind="level">--</span>
        </div>
        <div class="status-item">
          <span class="status-label">Phase</span>
          <span class="status-value" data-bind="phase">JACKPOT</span>
        </div>
      </div>
    `;

    // Replay mode: subscribe to replay.day and replay.level published by replay-panel.
    this.#unsubs.push(
      subscribe('replay.day', (v) => this.#bind('day', v != null ? v : '--')),
      subscribe('replay.level', (v) => this.#bind('level', v != null ? v : '--')),
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
