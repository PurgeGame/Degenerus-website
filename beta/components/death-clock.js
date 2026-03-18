// components/death-clock.js -- Always-visible death clock countdown
// Shows remaining time before GAMEOVER with green/yellow/red urgency stages.
// Placed outside data-panel divs so it's visible regardless of game phase.

import { subscribe } from '../app/store.js';
import { DEATH_CLOCK } from '../app/constants.js';
import { playSound } from '../app/audio.js';

class DeathClock extends HTMLElement {
  #unsubs = [];
  #rafId = null;
  #stage = 'normal';
  #lastRenderedSecond = -1;
  #gameData = null;
  #onVisibilityChange = null;
  #initialLoad = true;

  connectedCallback() {
    this.innerHTML = `
      <div class="death-clock" data-stage="normal">
        <span class="death-clock-icon">&#9760;</span>
        <span class="death-clock-label">DEATH CLOCK</span>
        <span class="death-clock-time" data-bind="time">--</span>
        <span class="death-clock-stage" data-bind="stage-badge"></span>
      </div>
    `;

    this.#unsubs.push(
      subscribe('game', (game) => {
        this.#gameData = game;
        this.#recalculate();
      })
    );

    // Recalculate on tab focus (RAF doesn't fire in background tabs)
    this.#onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        this.#lastRenderedSecond = -1;
        this.#recalculate();
      }
    };
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
  }

  disconnectedCallback() {
    if (this.#rafId != null) cancelAnimationFrame(this.#rafId);
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
    if (this.#onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.#onVisibilityChange);
      this.#onVisibilityChange = null;
    }
  }

  // -- Computation --

  #getDeadline(level, levelStartTime) {
    const timeout = level === 0 ? DEATH_CLOCK.TIMEOUT_LEVEL_0 : DEATH_CLOCK.TIMEOUT_DEFAULT;
    return Number(levelStartTime) + timeout;
  }

  #getRemaining(deadline) {
    return Math.max(0, deadline - Math.floor(Date.now() / 1000));
  }

  #getStage(remaining) {
    if (remaining <= DEATH_CLOCK.DISTRESS_THRESHOLD) return 'distress';
    if (remaining <= DEATH_CLOCK.IMMINENT_THRESHOLD) return 'imminent';
    return 'normal';
  }

  #formatCountdown(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  }

  // -- Rendering --

  #recalculate() {
    const game = this.#gameData;
    if (!game) return;

    // Handle GAMEOVER
    if (game.gameOver) {
      this.#stopTick();
      this.#renderGameOver();
      return;
    }

    // Handle missing data
    if (!game.levelStartTime) {
      this.#stopTick();
      this.#renderMissing();
      return;
    }

    // Start ticking if not already
    this.#startTick();
  }

  #renderGameOver() {
    const el = this.querySelector('.death-clock');
    if (!el) return;
    el.setAttribute('data-stage', 'distress');
    this.querySelector('[data-bind="time"]').textContent = 'GAME OVER';
    const badge = this.querySelector('[data-bind="stage-badge"]');
    badge.textContent = '';
  }

  #renderMissing() {
    const el = this.querySelector('.death-clock');
    if (!el) return;
    el.setAttribute('data-stage', 'normal');
    this.querySelector('[data-bind="time"]').textContent = '--';
    const badge = this.querySelector('[data-bind="stage-badge"]');
    badge.textContent = '';
  }

  #tick() {
    const game = this.#gameData;
    if (!game || !game.levelStartTime || game.gameOver) {
      this.#stopTick();
      return;
    }

    const deadline = this.#getDeadline(game.level, game.levelStartTime);
    const remaining = this.#getRemaining(deadline);
    const currentSecond = remaining;

    // Only update DOM when the seconds value changes
    if (currentSecond !== this.#lastRenderedSecond) {
      this.#lastRenderedSecond = currentSecond;

      const stage = this.#getStage(remaining);
      const timeStr = this.#formatCountdown(remaining);

      this.querySelector('[data-bind="time"]').textContent = timeStr;

      const el = this.querySelector('.death-clock');
      if (el && el.getAttribute('data-stage') !== stage) {
        const prevStage = this.#stage;
        el.setAttribute('data-stage', stage);
        this.#stage = stage;
        // Play urgency sound on stage transitions (not on initial page load)
        if (!this.#initialLoad &&
            ((stage === 'imminent' && prevStage === 'normal') ||
             (stage === 'distress' && prevStage !== 'distress'))) {
          playSound('urgency');
        }
        this.#initialLoad = false;
      }

      // Stage badge
      const badge = this.querySelector('[data-bind="stage-badge"]');
      if (stage === 'distress') {
        badge.textContent = 'DISTRESS BONUS';
      } else if (stage === 'imminent') {
        badge.textContent = 'IMMINENT';
      } else {
        badge.textContent = '';
      }
    }

    this.#rafId = requestAnimationFrame(() => this.#tick());
    if (this.#initialLoad) this.#initialLoad = false;
  }

  #startTick() {
    if (this.#rafId != null) return;
    this.#lastRenderedSecond = -1;
    this.#tick();
  }

  #stopTick() {
    if (this.#rafId != null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }
}

customElements.define('death-clock', DeathClock);
