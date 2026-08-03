// play/components/tickets-panel.js -- <tickets-panel> Custom Element
//
// Renders the selected player's ticket inventory for the chosen day with a
// per-level picker:
//
//   [L32: 25]  [L33: 4]  [L34: 1]  [L35: 0]  [L36: 0]  [Far Future: 230]
//
// Picker segments:
//   - dayLevel .. dayLevel+4    -- per-level cards; click loads card-by-trait detail
//   - "Far Future"               -- aggregate of every level beyond dayLevel+4 (no
//                                  trait detail, just a per-level breakdown list)
//
// Counts come from /player/{addr}?day=N (player.tickets[]) which gives
// (level, entryCount) rows. Card detail comes from
// /player/{addr}/tickets/by-trait?level=X&day=N when a near-future level is
// selected.
//
// SHELL-01: imports only from the wallet-free surface.

import { subscribe, get } from '../../beta/app/store.js';
import { fetchTicketsByTrait } from '../app/tickets-fetch.js';
import { traitToBadge } from '../app/tickets-inventory.js';
import { API_BASE } from '../app/constants.js';

const FAR_FUTURE_OFFSET = 4;
// After the database/src/handlers/tickets.ts unit fix + backfill,
// player_entries.entryCount is the entry count (1 trait roll per entry).
// 4 entries make a "card" (one card has 4 trait quadrants).
const ENTRIES_PER_CARD = 4;

const TEMPLATE = `
<section data-slot="tickets" class="panel tickets-panel">
  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:140px"></div></div>
  </div>
  <div data-bind="content" hidden>
    <h2 class="panel-title">Tickets</h2>
    <div class="tickets-level-picker" data-bind="level-picker" role="tablist"></div>
    <div class="tickets-trait-row" data-bind="trait-row" hidden></div>
    <div class="tickets-grid" data-bind="card-grid">
      <!-- Opened cards render here when a near-future level is selected. -->
    </div>
    <div class="tickets-ff-list" data-bind="ff-list" hidden></div>
  </div>
</section>`;

class TicketsPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #ticketsFetchId = 0;
  #holdings = [];     // [{level, wholeTickets}, ...] from /player/{addr}?day=N
  #selectedLevel = null;  // number | 'ff' | null
  #ownedTraitIds = [];    // unique traitIds present on the currently-rendered cards
  #selectedTraitId = null;  // number | null -- highlight quadrants matching this trait

  connectedCallback() {
    this.innerHTML = TEMPLATE;

    this.#unsubs.push(
      subscribe('replay.day', () => this.#onContextChange()),
      subscribe('replay.player', () => this.#onContextChange()),
      subscribe('replay.level', () => this.#onContextChange()),
    );

    this.#onContextChange();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  // -------------------------------------------------------------------------
  // Lifecycle on (player, day, level) change
  // -------------------------------------------------------------------------

  async #onContextChange() {
    // Reset selection so it tracks the day's level on every context change.
    this.#selectedLevel = null;
    await this.#refetch();
  }

  async #refetch() {
    const addr = get('replay.player');
    const dayLevel = Number(get('replay.level'));
    const day = get('replay.day');
    const token = ++this.#ticketsFetchId;

    if (!addr || !Number.isFinite(dayLevel) || dayLevel <= 0 || day == null) return;

    const content = this.querySelector('[data-bind="content"]');
    if (this.#loaded && content) content.classList.add('is-stale');

    try {
      // 1. Fetch per-level holdings (one round trip; covers all levels).
      const summary = await this.#fetchHoldings(addr, day);
      if (token !== this.#ticketsFetchId) return;
      this.#holdings = summary;
      this.#selectedTraitId = null;

      // 2. Default selection = day's level if it's not chosen yet.
      if (this.#selectedLevel == null) this.#selectedLevel = dayLevel;

      // 3. Render the picker + active view. Trait row is rebuilt from the
      //    rendered cards' actual entries inside #renderActiveView.
      this.#renderPicker(dayLevel);
      await this.#renderActiveView(addr, day, dayLevel, token);

      this.#showContent();
      if (content) content.classList.remove('is-stale');
    } catch (err) {
      if (token === this.#ticketsFetchId) {
        this.#renderError(0);
        this.#showContent();
        if (content) content.classList.remove('is-stale');
      }
    }
  }

  async #fetchHoldings(addr, day) {
    const url = `${API_BASE}/player/${encodeURIComponent(addr)}?day=${encodeURIComponent(day)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
    return tickets
      .map((t) => ({
        level: Number(t.level),
        wholeTickets: Math.round(Number(t.entryCount ?? 0) / ENTRIES_PER_CARD),
      }))
      .filter((t) => Number.isFinite(t.level) && t.wholeTickets > 0);
  }

  // -------------------------------------------------------------------------
  // Picker rendering
  // -------------------------------------------------------------------------

  #renderPicker(dayLevel) {
    const root = this.querySelector('[data-bind="level-picker"]');
    if (!root) return;
    root.innerHTML = '';

    const ffStart = dayLevel + FAR_FUTURE_OFFSET + 1;
    const nearLevels = [];
    for (let i = 0; i <= FAR_FUTURE_OFFSET; i++) nearLevels.push(dayLevel + i);

    for (const lvl of nearLevels) {
      root.appendChild(this.#buildSegment(lvl, this.#countAtLevel(lvl), `L${lvl}`));
    }
    const ffCount = this.#holdings
      .filter((t) => t.level >= ffStart)
      .reduce((sum, t) => sum + t.wholeTickets, 0);
    root.appendChild(this.#buildSegment('ff', ffCount, 'Far Future'));
  }

  #buildSegment(level, count, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tickets-level-btn';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-level', String(level));
    const isSelected = level === this.#selectedLevel
      || (level === 'ff' && this.#selectedLevel === 'ff');
    btn.setAttribute('aria-selected', String(isSelected));
    if (count === 0) btn.classList.add('is-empty');
    const noun = count === 1 ? 'ticket' : 'tickets';
    btn.setAttribute('title', `${label}: ${count.toLocaleString()} ${noun}`);

    // Visual hierarchy: the count IS the primary number; the level label is
    // demoted to a small caption beneath. Renamed to make the data shown
    // unambiguous regardless of the segment position in the row.
    const countEl = document.createElement('span');
    countEl.className = 'tickets-level-btn-count';
    countEl.textContent = count.toLocaleString();
    btn.appendChild(countEl);

    const labelEl = document.createElement('span');
    labelEl.className = 'tickets-level-btn-label';
    labelEl.textContent = label;
    btn.appendChild(labelEl);

    btn.addEventListener('click', () => this.#onSegmentClick(level));
    return btn;
  }

  #countAtLevel(level) {
    const lvl = Number(level);
    const row = this.#holdings.find((t) => Number(t.level) === lvl);
    return row ? row.wholeTickets : 0;
  }

  #renderTraitRow() {
    const root = this.querySelector('[data-bind="trait-row"]');
    if (!root) return;
    root.innerHTML = '';

    if (!this.#ownedTraitIds || this.#ownedTraitIds.length === 0) {
      root.hidden = true;
      return;
    }
    root.hidden = false;

    const labelEl = document.createElement('span');
    labelEl.className = 'tickets-trait-group-label';
    labelEl.textContent = 'Filter by trait';
    root.appendChild(labelEl);

    for (const traitId of this.#ownedTraitIds) {
      root.appendChild(this.#buildTraitPill(traitId));
    }
  }

  // Pull every distinct traitId off the rendered cards so the trait row only
  // shows traits the player actually owns at the selected level.
  #harvestOwnedTraitIds(cards) {
    const set = new Set();
    if (!Array.isArray(cards)) return [];
    for (const card of cards) {
      const entries = Array.isArray(card?.entries) ? card.entries : [];
      for (const entry of entries) {
        const id = Number(entry?.traitId);
        if (Number.isFinite(id) && id >= 0 && id <= 255) set.add(id);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  #buildTraitPill(traitId) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tickets-trait-pill';
    btn.setAttribute('data-trait-id', String(traitId));
    btn.setAttribute('aria-pressed', String(this.#selectedTraitId === traitId));

    const badge = traitToBadge(Number(traitId));
    if (badge) {
      const img = document.createElement('img');
      img.className = 'tickets-trait-pill-icon';
      img.src = badge.path;
      img.alt = `${badge.category} ${badge.item} ${badge.color}`;
      img.loading = 'lazy';
      btn.appendChild(img);
      btn.title = `${badge.category} ${badge.item} ${badge.color}`;
    } else {
      btn.textContent = `#${traitId}`;
    }

    btn.addEventListener('click', () => this.#onTraitClick(traitId));
    return btn;
  }

  #onTraitClick(traitId) {
    this.#selectedTraitId = (this.#selectedTraitId === traitId) ? null : traitId;
    // Update pill aria-pressed states without rebuilding the row.
    const pills = this.querySelectorAll('.tickets-trait-pill');
    pills.forEach((p) => {
      const id = Number(p.getAttribute('data-trait-id'));
      p.setAttribute('aria-pressed', String(id === this.#selectedTraitId));
    });
    // Re-render the active card grid so quadrant highlights update.
    this.#updateQuadrantHighlights();
  }

  #updateQuadrantHighlights() {
    const grid = this.querySelector('[data-bind="card-grid"]');
    if (!grid) return;
    const quadrants = grid.querySelectorAll('.trait-quadrant');
    quadrants.forEach((q) => {
      const tid = Number(q.getAttribute('data-trait-id'));
      const isMatch = this.#selectedTraitId != null && tid === this.#selectedTraitId;
      q.classList.toggle('is-trait-match', isMatch);
    });
  }

  async #onSegmentClick(level) {
    if (level === this.#selectedLevel) return;
    this.#selectedLevel = level;
    const dayLevel = Number(get('replay.level'));
    this.#renderPicker(dayLevel);
    const token = ++this.#ticketsFetchId;
    const addr = get('replay.player');
    const day = get('replay.day');
    await this.#renderActiveView(addr, day, dayLevel, token);
  }

  // -------------------------------------------------------------------------
  // View rendering: cards (specific level) | far-future list
  // -------------------------------------------------------------------------

  async #renderActiveView(addr, day, dayLevel, token) {
    const grid = this.querySelector('[data-bind="card-grid"]');
    const ffList = this.querySelector('[data-bind="ff-list"]');
    if (!grid || !ffList) return;

    if (this.#selectedLevel === 'ff') {
      grid.hidden = true;
      ffList.hidden = false;
      this.#renderFarFutureList(dayLevel);
      this.#ownedTraitIds = [];
      this.#selectedTraitId = null;
      this.#renderTraitRow();
      return;
    }

    grid.hidden = false;
    ffList.hidden = true;

    const level = Number(this.#selectedLevel);
    const data = await fetchTicketsByTrait(addr, level, day);
    if (token !== this.#ticketsFetchId) return;
    if (!data) {
      this.#renderError(404);
      this.#ownedTraitIds = [];
      this.#selectedTraitId = null;
      this.#renderTraitRow();
      return;
    }
    this.#ownedTraitIds = this.#harvestOwnedTraitIds(data.cards);
    if (this.#selectedTraitId != null && !this.#ownedTraitIds.includes(this.#selectedTraitId)) {
      this.#selectedTraitId = null;
    }
    this.#renderTraitRow();
    this.#renderCards(data.cards);
  }

  #renderCards(cards) {
    const grid = this.querySelector('[data-bind="card-grid"]');
    if (!grid) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);

    const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tickets-empty';
      empty.textContent = 'No tickets at this level.';
      grid.appendChild(empty);
      return;
    }
    for (const card of list) {
      grid.appendChild(this.#buildCardNode(card));
    }
  }

  #buildCardNode(card) {
    const cardEl = document.createElement('div');
    cardEl.className = 'ticket-card';
    cardEl.setAttribute('data-card-index', String(card.cardIndex));
    const status = card.status || 'pending';
    cardEl.setAttribute('data-status', status);
    if (status !== 'opened') cardEl.classList.add(`ticket-card--${status}`);

    const entries = Array.isArray(card.entries) ? card.entries : [];
    for (let i = 0; i < 4; i++) {
      const quadrant = document.createElement('div');
      quadrant.className = 'trait-quadrant';
      const entry = entries[i];
      const traitId = entry && Number.isFinite(Number(entry.traitId)) ? Number(entry.traitId) : null;
      if (traitId != null) {
        quadrant.setAttribute('data-trait-id', String(traitId));
        if (this.#selectedTraitId != null && traitId === this.#selectedTraitId) {
          quadrant.classList.add('is-trait-match');
        }
      }
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
      } else {
        quadrant.classList.add('trait-quadrant-empty');
      }
      cardEl.appendChild(quadrant);
    }

    const center = document.createElement('div');
    center.className = 'ticket-card-center';
    const flame = document.createElement('img');
    flame.className = 'ticket-card-flame';
    flame.src = '/specials/special_none.svg';
    flame.alt = '';
    flame.loading = 'lazy';
    center.appendChild(flame);
    cardEl.appendChild(center);

    return cardEl;
  }

  #renderFarFutureList(dayLevel) {
    const root = this.querySelector('[data-bind="ff-list"]');
    if (!root) return;
    root.innerHTML = '';

    const ffStart = dayLevel + FAR_FUTURE_OFFSET + 1;
    const ffRows = this.#holdings
      .filter((t) => t.level >= ffStart)
      .sort((a, b) => a.level - b.level);

    if (ffRows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tickets-empty';
      empty.textContent = 'No far-future tickets.';
      root.appendChild(empty);
      return;
    }

    const total = ffRows.reduce((sum, t) => sum + t.wholeTickets, 0);
    const summary = document.createElement('div');
    summary.className = 'tickets-ff-summary';
    summary.textContent = `${total.toLocaleString()} tickets across ${ffRows.length} level${ffRows.length === 1 ? '' : 's'}`;
    root.appendChild(summary);

    const ul = document.createElement('ul');
    ul.className = 'tickets-ff-rows';
    for (const row of ffRows) {
      const li = document.createElement('li');
      const lvl = document.createElement('span');
      lvl.className = 'tickets-ff-level';
      lvl.textContent = `L${row.level}`;
      const count = document.createElement('span');
      count.className = 'tickets-ff-count';
      count.textContent = row.wholeTickets.toLocaleString();
      li.appendChild(lvl);
      li.appendChild(count);
      ul.appendChild(li);
    }
    root.appendChild(ul);
  }

  #renderError(status) {
    const grid = this.querySelector('[data-bind="card-grid"]');
    if (!grid) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    const msg = document.createElement('div');
    msg.className = 'tickets-empty';
    msg.textContent = status === 404 ? 'No ticket data for this day.' : 'Error loading tickets.';
    grid.appendChild(msg);
  }

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.hidden = false;
  }
}

customElements.define('tickets-panel', TicketsPanel);
