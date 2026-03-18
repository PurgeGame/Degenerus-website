// components/baf-panel.js -- BAF leaderboard panel Custom Element
// Player score, top-4 leaderboard, prominence-based styling.
// All data fetching delegated to baf.js (no direct API calls here).

import { subscribe, get } from '../app/store.js';
import { fetchBafLeaderboard, bafContext, formatBafScore } from '../app/baf.js';
import { truncateAddress } from '../app/utils.js';

class BafPanel extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = `
      <div class="panel baf-panel" data-prominence="low">
        <h3>BAF Leaderboard</h3>
        <div class="baf-context">
          <span class="baf-next-level">Next BAF: Level --</span>
          <span class="baf-levels-until">-- levels away</span>
        </div>
        <div class="baf-player-score">
          <span class="label">Your Score</span>
          <span class="baf-score-value">Not ranked</span>
        </div>
        <div class="baf-leaderboard">
          <div class="baf-header">
            <span>Rank</span><span>Player</span><span>Score</span>
          </div>
          <div class="baf-entries">
            <div class="baf-empty">No BAF data for this level</div>
          </div>
        </div>
      </div>
    `;

    // -- Store Subscriptions --

    // Fetch leaderboard when level changes
    this.#unsubs.push(
      subscribe('game.level', (level) => {
        if (level > 0) {
          fetchBafLeaderboard(level);
        }
        this.#renderContext(level);
      })
    );

    // Re-render leaderboard and prominence when baf store updates
    this.#unsubs.push(
      subscribe('baf', (baf) => {
        if (!baf) return;
        this.#renderLeaderboard(baf);
        this.#renderProminence(baf);
      })
    );

    // Check if player is in top 4 when address changes
    this.#unsubs.push(
      subscribe('player.address', () => {
        const level = get('game.level');
        if (level > 0) {
          fetchBafLeaderboard(level);
        }
      })
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }

  // -- Render Methods --

  #renderContext(level) {
    if (!level || level <= 0) return;

    const ctx = bafContext(level);

    const nextLevelEl = this.querySelector('.baf-next-level');
    if (nextLevelEl) {
      nextLevelEl.textContent = ctx.isBafLevel
        ? 'BAF Active!'
        : `Next BAF: Level ${ctx.nextBafLevel}`;
    }

    const untilEl = this.querySelector('.baf-levels-until');
    if (untilEl) {
      untilEl.textContent = ctx.isBafLevel
        ? 'This level!'
        : `${ctx.levelsUntilBaf} level${ctx.levelsUntilBaf !== 1 ? 's' : ''} away`;
    }
  }

  #renderLeaderboard(baf) {
    const entriesContainer = this.querySelector('.baf-entries');
    if (!entriesContainer) return;

    // Player score
    const scoreEl = this.querySelector('.baf-score-value');
    if (scoreEl) {
      scoreEl.textContent = (baf.playerScore && baf.playerScore !== '0')
        ? formatBafScore(baf.playerScore) + ' ETH'
        : 'Not ranked';
    }

    // Top-4 entries
    if (!baf.top4 || baf.top4.length === 0) {
      entriesContainer.innerHTML = '<div class="baf-empty">No BAF data for this level</div>';
      return;
    }

    entriesContainer.innerHTML = baf.top4.map(entry => `
      <div class="baf-entry">
        <span class="baf-rank">#${entry.rank}</span>
        <span class="baf-player">${truncateAddress(entry.player)}</span>
        <span class="baf-score">${formatBafScore(entry.score)} ETH</span>
      </div>
    `).join('');
  }

  #renderProminence(baf) {
    const panel = this.querySelector('.baf-panel');
    if (panel) {
      panel.dataset.prominence = baf.prominence || 'low';
    }
  }
}

customElements.define('baf-panel', BafPanel);
