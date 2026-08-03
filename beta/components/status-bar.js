// components/status-bar.js -- Game status bar Custom Element
// In replay mode (replay.day is non-null): shows historical day/level from replay-panel.
// In live mode: subscribes to live game.* store paths.

import { subscribe } from '../app/store.js';
import { API_BASE } from '../app/constants.js';

class StatusBar extends HTMLElement {
  #unsubs = [];
  #activityFetchId = 0;
  #currentPlayer = null;
  #currentDay = null;

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
        <div class="status-item status-item-activity" title="Composite activity score snapshot as of end-of-day. Drives lootbox RNG multiplier + decimator multiplier. Components: mint streak + mint count + quest streak + affiliate bonus + deity/whale pass kicker.">
          <span class="status-label">Activity</span>
          <span class="status-value" data-bind="activity">--</span>
        </div>
      </div>
    `;

    // Replay mode: subscribe to replay.day + level + player.  Activity score
    // refetches whenever EITHER day or player changes.
    this.#unsubs.push(
      subscribe('replay.day', (v) => {
        this.#bind('day', v != null ? v : '--');
        this.#currentDay = v;
        this.#refreshActivity();
      }),
      subscribe('replay.level', (v) => this.#bind('level', v != null ? v : '--')),
      subscribe('replay.player', (addr) => {
        this.#currentPlayer = addr;
        this.#refreshActivity();
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

  async #refreshActivity() {
    const addr = this.#currentPlayer;
    const day = this.#currentDay;
    const token = ++this.#activityFetchId;
    if (!addr) {
      this.#bind('activity', '--');
      return;
    }
    this.#bind('activity', '…');
    const url = day != null
      ? `${API_BASE}/player/${addr}/activity-score?day=${encodeURIComponent(day)}`
      : `${API_BASE}/player/${addr}/activity-score`;
    try {
      const res = await fetch(url);
      if (token !== this.#activityFetchId) return; // stale
      if (!res.ok) {
        this.#bind('activity', 'err');
        return;
      }
      const data = await res.json();
      if (data.scoreBps == null) {
        this.#bind('activity', '--');
        return;
      }
      const bps = Number(data.scoreBps);
      const pct = (bps / 100).toFixed(bps >= 10000 ? 0 : 2);
      // When anvil's historical state was pruned, the API falls back to the
      // live value — mark with a leading "~" so the number doesn't look like
      // an exact end-of-day snapshot.
      const prefix = data.historicalUnavailable ? '~' : '';
      this.#bind('activity', `${prefix}${pct}%`);
      const cell = this.querySelector('.status-item-activity');
      if (cell) {
        cell.title = data.historicalUnavailable
          ? 'Historical state pruned on this anvil run (--prune-history). Showing CURRENT live value. Re-run sim without --prune-history for true end-of-day snapshots.'
          : `Snapshot at end of day ${data.day}. Drives lootbox RNG + decimator multiplier. Components: mint streak + mint count + quest streak + affiliate bonus + deity/whale pass.`;
      }
    } catch {
      if (token === this.#activityFetchId) this.#bind('activity', 'err');
    }
  }
}

customElements.define('game-status-bar', StatusBar);
