// play/components/coinflip-panel.js -- <coinflip-panel> Custom Element stub (Phase 50)
// Phase 50 delivers only the skeleton + subscription plumbing.
// Hydration logic lands in Phase 54.

import { subscribe } from '../../beta/app/store.js';

class CoinflipPanel extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    // SECURITY (T-50-01): template is a static string with no interpolation.
    this.innerHTML = `
      <section data-slot="coinflip" class="panel">
        <div data-bind="skeleton">
          <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
          <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:60%"></div></div>
          <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:80px"></div></div>
        </div>
        <div data-bind="content" hidden>
          <h2>Coinflip</h2>
          <p class="text-dim">Panel delivered in Phase 54.</p>
        </div>
      </section>
    `;

    // Phase 50: subscriptions prove day-awareness wiring reaches this panel.
    // Phase 54 replaces the console logs with real fetchers + #showContent().
    this.#unsubs.push(
      subscribe('replay.day',    (day)  => console.log('[coinflip-panel] replay.day =',    day)),
      subscribe('replay.player', (addr) => console.log('[coinflip-panel] replay.player =', addr)),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }
}

customElements.define('coinflip-panel', CoinflipPanel);
