// play/components/packs-panel.js -- <packs-panel> Custom Element (Phase 52 Wave 1)
//
// Renders the selected player's pending + partial + lootbox-source packs
// (D-03, D-04). Click triggers the GSAP timeline (D-05, D-07). Lootbox
// source auto-opens on first render (D-06). Sound plays on pack open
// (D-10) unless muted via the speaker-icon toggle; mute state persists
// in localStorage.
//
// Wave 1: markup + helper imports + stale-guard field + mute toggle +
// subscribe stubs (like tickets-panel). Wave 2 flips subscribes to
// this.#refetch(). Pitfall 11 + Pitfall 3 guards are wired here
// (#animatedCards, #activeTimelines).
//
// SECURITY: innerHTML TEMPLATE is static; dynamic writes use DOM API.
// SHELL-01: imports only from wallet-free surface.

import { subscribe, get } from '../../beta/app/store.js';
import { fetchTicketsByTrait } from '../app/tickets-fetch.js';
import { traitToBadge } from '../app/tickets-inventory.js';
import { animatePackOpen } from '../app/pack-animator.js';
import { playPackOpen, isMuted, setMuted } from '../app/pack-audio.js';

const TEMPLATE = `
<section data-slot="packs" class="panel packs-panel">
  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:160px"></div></div>
  </div>
  <div data-bind="content" hidden>
    <div class="packs-header">
      <h2 class="panel-title">Packs</h2>
      <button
        type="button"
        class="mute-toggle"
        data-bind="mute-toggle"
        aria-pressed="false"
        title="Toggle pack-open sound"
      >sound</button>
    </div>
    <div class="packs-grid" data-bind="pack-grid">
      <!-- Sealed/partial/auto-open packs render here. -->
    </div>
  </div>
</section>`;

class PacksPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #packsFetchId = 0;
  #animatedCards = new Set();     // Pitfall 11: lootbox auto-open dedup
  #activeTimelines = new Set();   // Pitfall 3: GSAP cleanup on disconnect

  connectedCallback() {
    this.innerHTML = TEMPLATE;
    this.#bindMuteToggle();

    // PACKS-01..05 (Wave 2): flip subscribes to live #refetch(). Both
    // panels share tickets-fetch.js which dedups wire requests at the
    // promise level (Pitfall 5); panel-level stale-guards (#packsFetchId)
    // cover render-level staleness.
    this.#unsubs.push(
      subscribe('replay.day', () => this.#refetch()),
      subscribe('replay.player', () => this.#refetch()),
      subscribe('replay.level', () => this.#refetch()),
    );

    // Kick an initial fetch in case the store already has values.
    this.#refetch();
  }

  disconnectedCallback() {
    // Pitfall 3: kill any in-flight timelines to free GSAP tween storage.
    this.#activeTimelines.forEach((tl) => {
      try { tl.kill(); } catch {}
    });
    this.#activeTimelines.clear();
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  // --- UI helpers ----------------------------------------------------------

  #bindMuteToggle() {
    const btn = this.querySelector('[data-bind="mute-toggle"]');
    if (!btn) return;
    const refresh = () => {
      const muted = isMuted();
      btn.textContent = muted ? 'muted' : 'sound';
      btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    };
    refresh();
    btn.addEventListener('click', () => {
      setMuted(!isMuted());
      refresh();
    });
  }

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.hidden = false;
  }

  #renderPacks(cards) {
    const grid = this.querySelector('[data-bind="pack-grid"]');
    if (!grid) return;

    const packs = Array.isArray(cards) ? cards.filter((c) => c && c.status !== 'opened') : [];

    while (grid.firstChild) grid.removeChild(grid.firstChild);

    if (packs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'packs-empty';
      empty.textContent = 'No packs waiting to open.';
      grid.appendChild(empty);
      return;
    }

    // Render-cap: a player with thousands of unrevealed-pending entries
    // (level rolled forward without VRF firing) can produce 1000+ pack nodes,
    // each just an empty placeholder. Cap visible packs and summarize the rest.
    const RENDER_CAP = 50;
    const visible = packs.slice(0, RENDER_CAP);
    const overflow = packs.length - visible.length;

    for (const card of visible) {
      grid.appendChild(this.#buildPackNode(card));
    }

    if (overflow > 0) {
      const more = document.createElement('div');
      more.className = 'packs-truncated';
      more.textContent = `+ ${overflow} more unrevealed packs (level rolled forward without reveal)`;
      grid.appendChild(more);
    }

    // PACKS-04: auto-open lootbox-sourced packs on first-appearance render.
    grid.querySelectorAll('.pack-source-lootbox').forEach((packEl) => {
      const key = packEl.getAttribute('data-card-index');
      if (!key) return;
      if (this.#animatedCards.has(key)) return;
      this.#animatedCards.add(key);
      this.#openPack(packEl);
    });
  }

  #buildPackNode(card) {
    const packEl = document.createElement('div');
    // PACKS-01/02/04 source class: 'purchase' -> .pack-source-purchase (neutral tint),
    // 'jackpot-win' -> .pack-source-jackpot-win (gold tint, winning card from daily draw),
    // 'lootbox' -> .pack-source-lootbox (purple tint, auto-open on render per D-06).
    // Defaults to source === 'purchase' when the response omits the field.
    const source = card.source || 'purchase';
    packEl.className = `pack-sealed pack-source-${source}`;
    packEl.setAttribute('data-card-index', String(card.cardIndex));
    packEl.setAttribute('role', 'button');
    packEl.setAttribute('tabindex', '0');

    // Wrapper the GSAP Phase 3 targets (scaled + faded on open).
    const wrapper = document.createElement('div');
    wrapper.className = 'pack-wrapper';
    packEl.appendChild(wrapper);

    // Peeked trait placeholders for partial/pending cards (D-03 partial).
    const entries = Array.isArray(card.entries) ? card.entries : [];
    for (let i = 0; i < 4; i++) {
      const quadrant = document.createElement('div');
      quadrant.className = 'pack-trait';
      const entry = entries[i];
      const badge = entry ? traitToBadge(entry.traitId) : null;
      if (badge) {
        const img = document.createElement('img');
        img.className = 'trait-badge';
        img.loading = 'lazy';
        img.src = badge.path;
        const label = (entry && entry.traitLabel) ? String(entry.traitLabel) : '';
        img.alt = label;
        if (label) img.title = label;
        quadrant.appendChild(img);
      }
      wrapper.appendChild(quadrant);
    }

    const pill = document.createElement('span');
    pill.className = `card-source-pill card-source-${source}`;
    pill.textContent = source;
    packEl.appendChild(pill);

    // PACKS-03: click handler (and keyboard Enter/Space for a11y).
    packEl.addEventListener('click', () => this.#openPack(packEl));
    packEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.#openPack(packEl);
      }
    });

    return packEl;
  }

  #openPack(packEl) {
    // Fire-and-forget audio per D-10 (fail-silent in the helper).
    try { playPackOpen(); } catch {}
    const tl = animatePackOpen(packEl, () => this.#activeTimelines.delete(tl));
    if (tl) this.#activeTimelines.add(tl);
  }

  #renderError(status) {
    const grid = this.querySelector('[data-bind="pack-grid"]');
    if (!grid) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    const msg = document.createElement('div');
    msg.className = 'packs-empty';
    msg.textContent = status === 404 ? 'No pack data for this day.' : 'Error loading packs.';
    grid.appendChild(msg);
  }

  // --- Fetch wiring (Wave 1 defines; Wave 2 flips subscribes) --------------

  async #refetch() {
    const addr = get('replay.player');
    const level = get('replay.level');
    const day = get('replay.day');
    const token = ++this.#packsFetchId;

    if (!addr || level == null || day == null) return;

    if (this.#loaded) {
      this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
    }

    try {
      const data = await fetchTicketsByTrait(addr, level, day);
      if (token !== this.#packsFetchId) return;
      if (!data) {
        this.#renderError(404);
        this.#showContent();
        this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
        return;
      }
      if (token !== this.#packsFetchId) return;
      this.#renderPacks(data.cards);
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    } catch (err) {
      if (token === this.#packsFetchId) {
        this.#renderError(0);
        this.#showContent();
        this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
      }
    }
  }
}

customElements.define('packs-panel', PacksPanel);
