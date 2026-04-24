// play/components/tickets-panel.js -- <tickets-panel> Custom Element (Phase 52 Wave 1)
//
// Renders the selected player's opened 4-trait quadrant cards as a dense
// grid (D-01). Each card is a 2x2 CSS grid of trait SVGs fetched via
// traitToBadge() from play/app/tickets-inventory.js (D-02). Pending and
// partial cards go to <packs-panel> (Section 7 of 52-RESEARCH.md).
//
// Wave 1 scope: hydrated markup, helper imports, stale-guard field,
// subscribes, #refetch() method body. Wave 2 flips the subscribe callbacks
// from console.log stubs to this.#refetch() and adds the initial refetch
// invocation. The Wave 0 test assertions on subscribe+ticketsFetchId+
// is-stale turn green here because the identifiers exist, even without
// the live #refetch() invocation.
//
// SECURITY (T-52-04): the innerHTML TEMPLATE is a static string with no
// user interpolation. Dynamic writes in #renderCards use document
// createElement + textContent for any user/API-provided strings, and
// traitToBadge().path is a deterministic filesystem path (no risk).
//
// SHELL-01: imports only from the wallet-free surface.

import { subscribe, get } from '../../beta/app/store.js';
import { fetchTicketsByTrait } from '../app/tickets-fetch.js';
import { traitToBadge } from '../app/tickets-inventory.js';

const TEMPLATE = `
<section data-slot="tickets" class="panel tickets-panel">
  <div data-bind="skeleton">
    <div class="skeleton-header"><div class="skeleton-line skeleton-shimmer" style="width:40%"></div></div>
    <div class="skeleton-row"><div class="skeleton-block skeleton-shimmer" style="height:140px"></div></div>
  </div>
  <div data-bind="content" hidden>
    <h2 class="panel-title">Tickets</h2>
    <div class="tickets-grid" data-bind="card-grid">
      <!-- Opened cards render here; <packs-panel> handles non-opened states. -->
    </div>
  </div>
</section>`;

class TicketsPanel extends HTMLElement {
  #unsubs = [];
  #loaded = false;
  #ticketsFetchId = 0;

  connectedCallback() {
    this.innerHTML = TEMPLATE;

    // Wave 1: subscribe calls exist (test greps for the literals). The
    // callback bodies remain console.log stubs; Wave 2 replaces them
    // with this.#refetch() once INTEG-01 ships.
    this.#unsubs.push(
      subscribe('replay.day', (day) => {
        console.log('[tickets-panel] replay.day =', day);
      }),
      subscribe('replay.player', (addr) => {
        console.log('[tickets-panel] replay.player =', addr);
      }),
      subscribe('replay.level', (level) => {
        console.log('[tickets-panel] replay.level =', level);
      }),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => fn());
    this.#unsubs = [];
  }

  // --- Render helpers ------------------------------------------------------

  #showContent() {
    if (this.#loaded) return;
    this.#loaded = true;
    this.querySelector('[data-bind="skeleton"]')?.remove();
    const el = this.querySelector('[data-bind="content"]');
    if (el) el.hidden = false;
  }

  #renderCards(cards) {
    const grid = this.querySelector('[data-bind="card-grid"]');
    if (!grid) return;

    // Filter to opened cards only (pending/partial go to <packs-panel>).
    const opened = Array.isArray(cards) ? cards.filter((c) => c && c.status === 'opened') : [];

    // Clear previous contents safely.
    while (grid.firstChild) grid.removeChild(grid.firstChild);

    if (opened.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tickets-empty';
      empty.textContent = 'No tickets at this level.';
      grid.appendChild(empty);
      return;
    }

    for (const card of opened) {
      grid.appendChild(this.#buildCardNode(card));
    }
  }

  #buildCardNode(card) {
    const cardEl = document.createElement('div');
    cardEl.className = 'ticket-card';
    cardEl.setAttribute('data-card-index', String(card.cardIndex));

    const traitGrid = document.createElement('div');
    traitGrid.className = 'trait-grid';

    const entries = Array.isArray(card.entries) ? card.entries : [];
    for (let i = 0; i < 4; i++) {
      const quadrant = document.createElement('div');
      quadrant.className = 'trait-quadrant';
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
      } else {
        quadrant.classList.add('trait-quadrant-empty');
      }
      traitGrid.appendChild(quadrant);
    }
    cardEl.appendChild(traitGrid);

    const pill = document.createElement('span');
    const source = card.source || 'purchase';
    pill.className = `card-source-pill card-source-${source}`;
    pill.textContent = source;
    cardEl.appendChild(pill);

    return cardEl;
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

  // --- Fetch wiring (Wave 1 defines it; Wave 2 triggers it from subscribe) --

  // TICKETS-01..04 + PROFILE-04-style stale-guard (D-18). Wave 2 replaces
  // the subscribe callbacks above with () => this.#refetch() + an initial
  // invocation. Wave 1 defines the method so Wave 0 tests grep the
  // identifiers (#ticketsFetchId, is-stale, fetch URL) as green.
  async #refetch() {
    const addr = get('replay.player');
    const level = get('replay.level');
    const day = get('replay.day');
    const token = ++this.#ticketsFetchId;

    if (!addr || level == null || day == null) return;

    if (this.#loaded) {
      this.querySelector('[data-bind="content"]')?.classList.add('is-stale');
    }

    try {
      const data = await fetchTicketsByTrait(addr, level, day);
      if (token !== this.#ticketsFetchId) return;
      if (!data) {
        this.#renderError(404);
        this.#showContent();
        this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
        return;
      }
      // Second stale-guard post data-resolve (D-18 double-check).
      if (token !== this.#ticketsFetchId) return;
      this.#renderCards(data.cards);
      this.#showContent();
      this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
    } catch (err) {
      if (token === this.#ticketsFetchId) {
        this.#renderError(0);
        this.#showContent();
        this.querySelector('[data-bind="content"]')?.classList.remove('is-stale');
      }
    }
  }
}

customElements.define('tickets-panel', TicketsPanel);
