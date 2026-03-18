// components/baf-panel.js -- BAF leaderboard panel Custom Element
// Player score, top-4 leaderboard, prominence-based styling.
// All data fetching delegated to baf.js (no direct API calls here).

import { subscribe, get } from '../app/store.js';
import { fetchBafLeaderboard, bafContext, formatBafScore } from '../app/baf.js';
import { truncateAddress } from '../app/utils.js';

class BafPanel extends HTMLElement {
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
      <div data-bind="skeleton" class="panel baf-panel">
        <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
        <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:50%"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="width:48px;height:28px"></div><div class="skeleton-block skeleton-shimmer" style="width:48px;height:28px"></div><div class="skeleton-block skeleton-shimmer" style="width:48px;height:28px"></div><div class="skeleton-block skeleton-shimmer" style="width:48px;height:28px"></div></div>
      </div>
      <div data-bind="content" style="display:none">
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
        this.#showContent();
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
          errorDiv.innerHTML = `<div class="panel-error-state"><span class="panel-error-icon">!</span><span class="panel-error-msg">Unable to load BAF data</span><button class="panel-error-retry">Retry</button></div>`;
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
