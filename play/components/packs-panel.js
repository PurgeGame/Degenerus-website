// play/components/packs-panel.js -- <packs-panel> Custom Element (PACKS-V2)
//
// Renders the SELECTED DAY's reveal activity for the chosen player:
// - Lootbox section: lootboxes opened on day N (auto-revealed; traits visible)
// - Ticket-reveal section: VRF reveals on day N grouped into 10-ticket packs
//   (sealed; click to reveal via GSAP timeline)
//
// Day-keyed (subscribes to replay.day + replay.player; NOT replay.level).
// Mental model per .planning/phases/52-tickets-packs-jackpot/PACKS-V2-SPEC.md.
// Cumulative inventory remains in tickets-panel (level-keyed via INTEG-01).
//
// SECURITY: innerHTML TEMPLATE is static; dynamic writes use DOM API.
// SHELL-01: imports only from wallet-free surface.

import { subscribe, get } from '../../beta/app/store.js';
import { fetchDayPacks } from '../app/day-packs-fetch.js';
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
    <div class="packs-section packs-lootbox">
      <h3 class="packs-section-title">Lootboxes Opened (<span data-bind="lootbox-count">0</span>)</h3>
      <div class="lootbox-grid" data-bind="lootbox-grid"></div>
    </div>
    <div class="packs-section packs-tickets">
      <h3 class="packs-section-title">Ticket Reveals (<span data-bind="ticket-count">0</span>)</h3>
      <div class="ticket-pack-grid" data-bind="ticket-pack-grid"></div>
    </div>
    <div class="packs-empty" data-bind="empty-state" hidden></div>
  </div>
</section>`;

class PacksPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #dayPacksFetchId = 0;
  #activeTimelines = new Set();   // Pitfall 3: GSAP cleanup on disconnect

  connectedCallback() {
    this.innerHTML = TEMPLATE;
    this.#bindMuteToggle();

    // PACKS-V2: day-keyed subscriptions (NOT replay.level per
    // PACKS-V2-SPEC.md line 176; packs-panel surfaces the SELECTED
    // DAY's reveal activity, not level-scoped cumulative inventory).
    this.#unsubs.push(
      subscribe('replay.day', () => this.#refetch()),
      subscribe('replay.player', () => this.#refetch()),
    );

    // Kick an initial fetch in case the store already has values.
    this.#refetch();
  }

  disconnectedCallback() {
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

  #setText(bind, text) {
    const el = this.querySelector(`[data-bind="${bind}"]`);
    if (el) el.textContent = String(text);
  }

  // --- Render: lootbox section --------------------------------------------

  #renderLootboxes(packs) {
    const grid = this.querySelector('[data-bind="lootbox-grid"]');
    if (!grid) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    const list = Array.isArray(packs) ? packs : [];
    this.#setText('lootbox-count', list.length);
    for (const pack of list) {
      grid.appendChild(this.#buildLootboxTile(pack));
    }
  }

  #buildLootboxTile(pack) {
    const tile = document.createElement('div');
    tile.className = 'lootbox-tile pack-source-lootbox';
    tile.setAttribute('data-pack-id', String(pack.packId ?? ''));

    const header = document.createElement('div');
    header.className = 'tile-header';
    const eth = String(pack.ethSpent ?? '0');
    const burnie = String(pack.burnieSpent ?? '0');
    if (eth !== '0') {
      header.textContent = `Lootbox · ${this.#formatEth(eth)} ETH`;
    } else if (burnie !== '0') {
      header.textContent = `Lootbox · ${this.#formatBurnieAmount(burnie)} BURNIE`;
    } else {
      header.textContent = `Lootbox · #${pack.lootboxIndex ?? '?'}`;
    }
    tile.appendChild(header);

    const ticketsGrid = document.createElement('div');
    ticketsGrid.className = 'tile-tickets';
    const tickets = Array.isArray(pack.tickets) ? pack.tickets : [];
    for (const t of tickets) {
      ticketsGrid.appendChild(this.#buildTicketCard(t));
    }
    tile.appendChild(ticketsGrid);

    return tile;
  }

  // --- Render: ticket-reveal section --------------------------------------

  #renderTicketRevealPacks(packs, day) {
    const grid = this.querySelector('[data-bind="ticket-pack-grid"]');
    if (!grid) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    const list = Array.isArray(packs) ? packs : [];
    this.#setText('ticket-count', list.length);
    for (const pack of list) {
      grid.appendChild(this.#buildTicketRevealPack(pack));
    }
  }

  #buildTicketRevealPack(pack) {
    const packEl = document.createElement('div');
    packEl.className = 'ticket-pack sealed pack-source-ticket-reveal';
    packEl.setAttribute('data-pack-id', String(pack.packId ?? ''));
    packEl.setAttribute('role', 'button');
    packEl.setAttribute('tabindex', '0');

    const wrapper = document.createElement('div');
    wrapper.className = 'pack-wrapper';
    const label = document.createElement('span');
    label.className = 'pack-label';
    label.textContent = `${pack.ticketCount ?? 0} tickets`;
    wrapper.appendChild(label);
    packEl.appendChild(wrapper);

    // PACKS-V2 (D-05 user-click reveal): click runs GSAP timeline + reveals
    // all tickets staggered. Lootbox tiles auto-reveal; ticket-reveal packs
    // require user click per PACKS-V2-SPEC.md line 199.
    const open = () => this.#openTicketRevealPack(packEl, pack);
    packEl.addEventListener('click', open);
    packEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });

    return packEl;
  }

  #openTicketRevealPack(packEl, pack) {
    if (packEl.classList.contains('opened')) return;
    try { playPackOpen(); } catch {}

    // Replace sealed wrapper content with a 10-ticket-card grid (or fewer
    // for trailing partial packs).
    const tickets = Array.isArray(pack.tickets) ? pack.tickets : [];
    const wrapper = packEl.querySelector('.pack-wrapper');
    if (wrapper) {
      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
      tickets.forEach((t, i) => {
        const card = this.#buildTicketCard(t);
        // 30ms stagger per ticket per PACKS-V2-SPEC.md line 207.
        card.style.setProperty('--ticket-reveal-stagger-delay', `${i * 30}ms`);
        wrapper.appendChild(card);
      });
    }
    packEl.classList.remove('sealed');
    packEl.classList.add('opened');

    const tl = animatePackOpen(packEl, () => this.#activeTimelines.delete(tl));
    if (tl) this.#activeTimelines.add(tl);
  }

  // --- Render: shared ticket-card builder ---------------------------------

  #buildTicketCard(ticket) {
    const card = document.createElement('div');
    card.className = 'ticket-card';
    const traits = Array.isArray(ticket?.traits) ? ticket.traits : [];
    for (let i = 0; i < 4; i++) {
      const quad = document.createElement('div');
      quad.className = 'trait-quadrant';
      const traitId = traits[i];
      const badge = traitId != null ? traitToBadge(traitId) : null;
      if (badge) {
        const img = document.createElement('img');
        img.className = 'trait-badge';
        img.loading = 'lazy';
        img.src = badge.path;
        const label = badge.label || '';
        img.alt = label;
        if (label) img.title = label;
        quad.appendChild(img);
      }
      card.appendChild(quad);
    }
    return card;
  }

  // --- Render: empty-day state --------------------------------------------

  #renderEmptyState(day, lootboxCount, ticketRevealCount) {
    const empty = this.querySelector('[data-bind="empty-state"]');
    if (!empty) return;
    if (lootboxCount === 0 && ticketRevealCount === 0) {
      empty.textContent = `No packs revealed on day ${day ?? '?'}`;
      empty.hidden = false;
    } else {
      empty.textContent = '';
      empty.hidden = true;
    }
  }

  #renderError(status) {
    const empty = this.querySelector('[data-bind="empty-state"]');
    if (!empty) return;
    empty.textContent = status === 404 ? 'No packs revealed on day not found.' : 'Error loading packs.';
    empty.hidden = false;
    // Clear sections so they don't show stale data
    const lootboxGrid = this.querySelector('[data-bind="lootbox-grid"]');
    const ticketGrid = this.querySelector('[data-bind="ticket-pack-grid"]');
    if (lootboxGrid) while (lootboxGrid.firstChild) lootboxGrid.removeChild(lootboxGrid.firstChild);
    if (ticketGrid) while (ticketGrid.firstChild) ticketGrid.removeChild(ticketGrid.firstChild);
    this.#setText('lootbox-count', 0);
    this.#setText('ticket-count', 0);
  }

  // --- Number formatting helpers (wallet-free; mirrors beta/viewer/utils) -

  #formatEth(weiStr) {
    try {
      const wei = BigInt(weiStr);
      const eth = Number(wei) / 1e18;
      return eth.toFixed(eth < 0.01 ? 4 : 2);
    } catch {
      return '0';
    }
  }

  #formatBurnieAmount(weiStr) {
    try {
      const wei = BigInt(weiStr);
      const burnie = Number(wei) / 1e18;
      return burnie.toFixed(burnie < 0.01 ? 4 : 2);
    } catch {
      return '0';
    }
  }

  // --- Fetch wiring -------------------------------------------------------

  async #refetch() {
    const addr = get('replay.player');
    const day = get('replay.day');
    const token = ++this.#dayPacksFetchId;

    if (!addr || day == null) return;

    if (this.#loaded) {
      this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
    }

    try {
      const data = await fetchDayPacks(addr, day);
      if (token !== this.#dayPacksFetchId) return;
      if (!data) {
        this.#renderError(404);
        this.#showContent();
        this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
        return;
      }
      if (token !== this.#dayPacksFetchId) return;

      const lootboxPacks = Array.isArray(data.lootboxPacks) ? data.lootboxPacks : [];
      const ticketRevealPacks = Array.isArray(data.ticketRevealPacks) ? data.ticketRevealPacks : [];

      this.#renderLootboxes(lootboxPacks);
      this.#renderTicketRevealPacks(ticketRevealPacks, day);
      this.#renderEmptyState(day, lootboxPacks.length, ticketRevealPacks.length);
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    } catch (err) {
      if (token === this.#dayPacksFetchId) {
        this.#renderError(0);
        this.#showContent();
        this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
      }
    }
  }
}

customElements.define('packs-panel', PacksPanel);
</content>
</invoke>