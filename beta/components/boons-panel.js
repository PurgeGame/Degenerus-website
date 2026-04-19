// components/boons-panel.js -- Active Boons panel for the player-facing /beta/ page.
// Phase 44 BOON-03: subscribes to player.boons (populated by main.js on day-change
// via GET /player/:address/boons/:day); renders BN-{NAME} badges per D-06.
// Empty-state: conditional render (hidden root) per D-07.

import { subscribe } from '../app/store.js';
import { BOON_TYPE_NAMES, BOON_FULL_NAMES, BOON_BOOST_PCT } from '../app/boon-types.js';

class BoonsPanel extends HTMLElement {
  #unsubs = [];
  #currentDay = null;
  #currentBoons = null;

  connectedCallback() {
    this.innerHTML = `
      <div class="boons-panel" data-bind="content" hidden>
        <div class="boons-panel-header">
          <span class="boons-panel-label">Active Boons</span>
          <span class="boons-panel-day" data-bind="day">Day --</span>
        </div>
        <ul class="boons-panel-list" data-bind="list"></ul>
      </div>
    `;
    this.#unsubs.push(
      subscribe('player.boons', (boons) => {
        this.#currentBoons = boons;
        this.#render(boons);
      }),
      subscribe('replay.day', (day) => {
        this.#currentDay = day;
        this.#renderDay();
        // Re-render badge list so tooltips pick up the new day value.
        if (this.#currentBoons && this.#currentBoons.length > 0) {
          this.#render(this.#currentBoons);
        }
      }),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  #renderDay() {
    const el = this.querySelector('[data-bind="day"]');
    if (el) el.textContent = this.#currentDay != null ? `Day ${this.#currentDay}` : 'Day --';
  }

  #render(boons) {
    const root = this.querySelector('[data-bind="content"]');
    const list = this.querySelector('[data-bind="list"]');
    if (!root || !list) return;

    // D-07 empty-state: hidden (zero-height), not "No boons" text.
    if (!boons || boons.length === 0) {
      root.hidden = true;
      list.innerHTML = '';
      return;
    }
    root.hidden = false;

    // D-06 tooltip derivation (CD-02 decision):
    //   consumed && consumedBoostBps != null -> pct = consumedBoostBps / 100 (authoritative)
    //   else                                 -> pct = BOON_BOOST_PCT[boonType] (parsed from type-name suffix)
    //   pct null (only WHPASS) -> omit the boost fragment entirely; render only the
    //   full name + day-rollover clause. The placeholder fallback the planner
    //   forbade is NEVER emitted — every tooltip has a concrete phrase.
    list.innerHTML = boons.map((b) => {
      const name = BOON_TYPE_NAMES[b.boonType] ?? `T${b.boonType}`;
      const full = BOON_FULL_NAMES[b.boonType] ?? `Type ${b.boonType}`;
      const pct = (b.consumed && b.consumedBoostBps != null)
        ? (b.consumedBoostBps / 100)
        : BOON_BOOST_PCT[b.boonType];
      const boostFragment = pct != null ? ` · +${pct}% boost` : '';
      const suffix = b.consumed ? ' used' : '';
      const variant = b.consumed ? 'boon-badge--used' : 'boon-badge--active';
      const day = this.#currentDay != null ? this.#currentDay : '?';
      return `<li class="boon-badge ${variant}" tabindex="0">`
        + `BN-${name}${suffix}`
        + `<span class="boon-tooltip">${full}${boostFragment} · Active until end of Day ${day}</span>`
        + `</li>`;
    }).join('');
  }
}

customElements.define('boons-panel', BoonsPanel);
