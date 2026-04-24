// play/components/day-scrubber.js -- <day-scrubber> Custom Element
// Thin wrapper: the heavy lifting is done by createScrubber() from beta/viewer/scrubber.js,
// which main.js calls with `root: this` during boot. This element owns the subscription
// plumbing so the dev-tool wrapper's child keeps a clean disconnectedCallback.

import { subscribe } from '../../beta/app/store.js';
import { createScrubber } from '../../beta/viewer/scrubber.js';

// Re-export for convenience (Phase 51+ may wrap the factory differently).
export { createScrubber };

class DayScrubber extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    // main.js calls createScrubber({ root: this, ... }) on boot and injects
    // the scrubber DOM scaffold. Before that call lands, render a lightweight
    // skeleton placeholder so the dev-tool wrapper is not empty.
    if (!this.children.length) {
      this.innerHTML = `
        <div data-bind="skeleton" class="skeleton-row">
          <div class="skeleton-line skeleton-shimmer" style="width:60%;height:14px"></div>
        </div>
      `;
    }

    this.#unsubs.push(
      subscribe('replay.day', (day) => console.log('[day-scrubber] replay.day =', day)),
      subscribe('replay.player', (addr) => console.log('[day-scrubber] replay.player =', addr)),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }
}

customElements.define('day-scrubber', DayScrubber);
