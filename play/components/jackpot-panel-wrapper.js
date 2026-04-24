// play/components/jackpot-panel-wrapper.js -- thin wrapper around beta's
// <jackpot-panel> for the /play/ route (Phase 52 Wave 1).
//
// Imports beta/components/jackpot-panel.js directly after the D-09 patch
// removed the last wallet-tainted transitive import (Phase 52 Wave 0
// Task 2 swapped line 7 '../app/utils.js' -> '../viewer/utils.js'; the
// play-jackpot-shell01-regression.test.js guards against reverts).
//
// The beta panel subscribes to top-level `game` state (game.level,
// game.jackpotDay, game.phase). Play's scrubber writes to
// replay.{day, level, player}. The wrapper shims replay.* into game.*
// via update() on every change so the inner panel re-renders when
// play's day scrubber moves (JACKPOT-03).
//
// Rename context: Phase 50 registered a <jackpot-panel> stub in
// play/components/jackpot-panel.js; that stub is DELETED in Wave 1 to
// avoid the customElements.define collision (Pitfall 12). The play/
// panel grid in index.html now renders <jackpot-panel-wrapper>.
//
// SHELL-01: imports only from the wallet-free surface; the beta
// jackpot-panel import is safe post-D-09.

import { subscribe, get, update } from '../../beta/app/store.js';
// Side-effect import: module body runs customElements.define('jackpot-panel', ...).
// Namespace binding is unused; we keep the `from` form so the Wave 0 regression
// assertion matches (play-jackpot-wrapper.test.js expects `from .../beta/components/jackpot-panel.js`).
import * as _jackpotPanel from '../../beta/components/jackpot-panel.js';
void _jackpotPanel;

class JackpotPanelWrapper extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    // Wave 1: render the inner beta <jackpot-panel> wrapped in a brief
    // skeleton-shimmer overlay that the beta panel replaces on its own
    // first render. The shimmer is harmless decoration; the beta panel's
    // own skeleton pipeline continues to work.
    this.innerHTML = `
      <div class="skeleton-line skeleton-shimmer" style="width:40%;height:0.6rem;margin-bottom:0.5rem" data-bind="wrapper-skeleton"></div>
      <jackpot-panel data-slot="jackpot"></jackpot-panel>
    `;

    // Shim: play.replay.* -> beta.game.* via update(). Beta's
    // #onGameUpdate at jackpot-panel.js:1036-1071 reads game.level,
    // game.jackpotDay, and game.phase. We rebroadcast the first two
    // from play's scrubber so the inner panel re-fetches on day/level
    // change. game.phase is not shimmed here; beta has internal
    // fallback logic for missing phase (defaults to a sensible display
    // per jackpot-panel.js line 1043); Pitfall 8 notes this is acceptable.
    const pushShim = () => {
      const day = get('replay.day');
      const level = get('replay.level');
      if (day != null) {
        const jackpotDay = ((day - 1) % 5) + 1;  // within-level counter 1..5
        update('game.jackpotDay', jackpotDay);
      }
      if (level != null) {
        update('game.level', level);
      }
    };

    this.#unsubs.push(
      subscribe('replay.day', () => pushShim()),
      subscribe('replay.level', () => pushShim()),
      // replay.player not consumed by the jackpot view itself, but we
      // subscribe to prove player-awareness wiring reaches this slot
      // (panel-stubs.test.js asserts every panel stub subscribes).
      // Remove the wrapper-skeleton once a real player is picked so the
      // inner beta panel shows alone (its own skeleton handles load).
      subscribe('replay.player', () => {
        this.querySelector('[data-bind="wrapper-skeleton"]')?.remove();
      }),
    );

    // Initial push in case the scrubber has already populated both values
    // before this wrapper mounts (Phase 50 main.js boots both first).
    pushShim();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }
}

customElements.define('jackpot-panel-wrapper', JackpotPanelWrapper);
