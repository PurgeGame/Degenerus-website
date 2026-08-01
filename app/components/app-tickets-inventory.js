// /app/components/app-tickets-inventory.js — task #12 (user ask).
//
// The viewed player's ticket inventory, ported from _sketch/app-compact.html's
// dual-mode inventory section:
//   - Cards mode: deduped 4-trait ticket cards (paper card, ×N count badge);
//   - Chart mode: the wide view — four 8×8 symbol × color grids (one per
//     quadrant) showing how many of EVERY trait the player holds at the
//     viewed level (cell trait_id = q*64 + color*8 + symbol).
//
// Data: GET /player/:addr/tickets/by-trait?level=N. `day` is deliberately
// NOT sent — the by-trait endpoint's strict blockNumber<=endOfDay filter
// drops every row when it's present (play/app/tickets-fetch.js:22-28 gotcha).
// totalEntries is an ENTRY count; 4 entries = 1 card.
//
// Level nav: ← / → / ⟳. "Active" = the ACTUAL last day's
// `roll1.purchaseLevel` (the level tickets are currently sold/drawn at —
// verified live day 130: purchaseLevel 25 while eth wins sat at 25, ticket
// awards at 26, chain level() read 24). NOT `lastDay.level` — that field is
// the count-weighted winner level, and ticket/bonus AWARD rows (next +
// future levels) outnumber the eth rows, so it reads one level high. The
// /game/state mint formula (jackpotPhase ? level : level+1) is the fallback
// when the last-day payload hasn't arrived.
// T-58-18: server-derived strings via textContent.

import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
import { activeTicketLevel } from '../app/active-level.js';
import { ethers, getProvider } from '../app/contracts.js';
import { CHAIN, CONTRACTS } from '../app/chain-config.js';
import { DGN_TICKET_COPY_EVENT, dgnReconstructTicketTraits } from '../app/dgn-traits.js';
import { unopenedPackCardIndexes } from '../app/pack-watch.js';
import { PACK_REVEAL_COMPLETE_EVENT } from './reveal-overlay.js';

const ENTRIES_PER_CARD = 4;
const POLL_INTERVAL_MS = 60_000;
// Levels beyond active + FAR_FUTURE_OFFSET can't have rolled traits yet
// (play/components/tickets-panel.js:25 convention) — the widget switches to
// the long-term view: per-level tickets owed across the whole far-future
// window (user ask 2026-07-03).
const FAR_FUTURE_OFFSET = 4;
const FAR_FUTURE_SPAN = 95;
const INV_ZOOM_KEY = 'degenerus.ticket-inventory.zoom.v1';
const INV_HEIGHT_KEY = 'degenerus.ticket-inventory.height.v1';
const INV_ZOOM_MIN = 80;
const INV_ZOOM_MAX = 140;
const INV_ZOOM_STEP = 10;
const INV_HEIGHT_MIN = 180;
const INV_HEIGHT_MAX = 900;
const INV_HEIGHT_DEFAULT = 320;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const GAME_TRAIT_ENTRY_ABI = [
  'function getEntries(uint8 trait, uint24 lvl, uint32 offset, uint32 limit, address player) external view returns (uint24 count, uint32 nextOffset, uint32 total)',
];

let _deityEntryContractFactory = null;
let _deityEntryReadProvider = null;

/** Test seam for the read-only GAME projection below. */
export function __setDeityEntryContractFactoryForTest(factory) {
  _deityEntryContractFactory = typeof factory === 'function' ? factory : null;
}

export function __resetDeityEntryContractFactoryForTest() {
  _deityEntryContractFactory = null;
  _deityEntryReadProvider = null;
}

function _deityEntryContract() {
  if (_deityEntryContractFactory) return _deityEntryContractFactory();
  const walletProvider = getProvider();
  if (!_deityEntryReadProvider && !walletProvider && CHAIN.rpcUrl) {
    _deityEntryReadProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      { name: CHAIN.name, chainId: CHAIN.id },
      { staticNetwork: true },
    );
  }
  const provider = walletProvider || _deityEntryReadProvider;
  if (!provider || !CONTRACTS.GAME) return null;
  return new ethers.Contract(CONTRACTS.GAME, GAME_TRAIT_ENTRY_ABI, provider);
}

/** JackpotModule._deityVirtualCount, kept literal for the player-facing chart. */
export function deityVirtualEntryCount(traitId, realBucketLength) {
  const trait = Number(traitId);
  const length = Math.max(0, Math.floor(Number(realBucketLength) || 0));
  const color = Math.floor((trait % 64) / 8);
  return color === INV_GOLD_COLOR_IDX ? 1 : Math.max(2, Math.floor(length / 50));
}

/**
 * Current virtual entries granted to the viewed player's deity symbol.
 * getEntries(..., limit=0) scans no owners but still returns the live bucket
 * total, so eight parallel eth_calls cover all colors without downloading any
 * holder addresses.
 */
export async function readDeityExpectedEntries(level, symbolIds) {
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < 0) return new Map();
  const symbols = [...new Set((Array.isArray(symbolIds) ? symbolIds : [])
    .map(Number)
    .filter((symbolId) => Number.isInteger(symbolId) && symbolId >= 0 && symbolId < 32))];
  if (symbols.length === 0) return new Map();
  const contract = _deityEntryContract();
  if (!contract || typeof contract.getEntries !== 'function') return new Map();

  const traitIds = symbols.flatMap((symbolId) => {
    const q = (symbolId >> 3) & 3;
    const sym = symbolId & 7;
    return Array.from({ length: 8 }, (_unused, color) => q * 64 + color * 8 + sym);
  });
  const reads = await Promise.allSettled(traitIds.map(async (traitId) => {
    const row = await contract.getEntries(traitId, lvl, 0, 0, ZERO_ADDRESS);
    const total = Number(row?.total ?? row?.[2] ?? 0);
    return [traitId, deityVirtualEntryCount(traitId, total)];
  }));
  const expected = new Map();
  for (const read of reads) {
    if (read.status !== 'fulfilled') continue;
    expected.set(read.value[0], read.value[1]);
  }
  return expected;
}

// Trait constants — canonical [QQ][CCC][SSS] decode (color bits 5:3, symbol
// bits 2:0); mirrors the app-degenerette-panel port of the app-compact sketch.
const INV_QUADRANTS = ['crypto', 'zodiac', 'cards', 'dice'];
const INV_SYMBOLS = Object.freeze({
  crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
  cards:  ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
  dice:   ['1', '2', '3', '4', '5', '6', '7', '8'],
});
// 'cards' symbol → SVG file index remap (legacy filename order). Load-bearing.
const INV_CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7];
const INV_COLORS = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];
const INV_GOLD_COLOR_IDX = INV_COLORS.indexOf('gold');

function invBadgePath(q, sym, col) {
  const cat = INV_QUADRANTS[q];
  const fileIdx = cat === 'cards' ? INV_CARD_IDX[sym] : sym;
  return `/badges-circular/${cat}_${String(fileIdx).padStart(2, '0')}_${INV_SYMBOLS[cat][sym]}_${INV_COLORS[col]}.svg`;
}

// Order-independent key for a 4-trait combo. Trait IDs carry the quadrant in
// their high bits, so a numeric sort IS quadrant order — which makes this stable
// whether the ids arrive from /tickets/by-trait or from /foil's lines.
function invComboKey(ids) {
  return [...ids].map(Number).sort((a, b) => a - b).join(',');
}

/** /foil payload → the set of its lines' combo keys (empty when no pack). */
function _foilKeySet(payload) {
  const out = new Set();
  const lines = payload?.present ? payload.lines : null;
  if (!Array.isArray(lines)) return out;
  for (const line of lines) {
    if (Array.isArray(line) && line.length === 4 && line.every((t) => t != null)) {
      out.add(invComboKey(line));
    }
  }
  return out;
}

/** Remove only cards still owed a pack presentation, including their headline count. */
export function hideUnopenedPackTickets(payload, hiddenIndexes) {
  if (!payload || typeof payload !== 'object') return payload;
  const hidden = hiddenIndexes instanceof Set
    ? hiddenIndexes
    : new Set(Array.isArray(hiddenIndexes) ? hiddenIndexes.map(Number) : []);
  if (hidden.size === 0) return payload;
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  let hiddenEntries = 0;
  const visible = cards.filter((card) => {
    if (!hidden.has(Number(card?.cardIndex))) return true;
    hiddenEntries += Array.isArray(card?.entries) ? card.entries.length : ENTRIES_PER_CARD;
    return false;
  });
  return {
    ...payload,
    totalEntries: Math.max(0, Number(payload.totalEntries || 0) - hiddenEntries),
    cards: visible,
  };
}

// trait_id (0-255) → {q, sym, col}: q = tid/64, sym = tid%8, col = (tid%64)/8.
function invTraitToQSC(tid) {
  return { q: Math.floor(tid / 64), sym: tid % 8, col: Math.floor((tid % 64) / 8) };
}

/**
 * Rebuild whole tickets from the API's chronological entry stream.
 *
 * A trait's high two bits are its authoritative quadrant.  The database API
 * currently flattens several independent TraitsGenerated calls and chunks the
 * result every four entries.  A fractional call can end after Q0/Q1, while the
 * next call restarts at Q0; blindly chunking that stream makes the following
 * card out of the prior ticket's bottom row plus the next ticket's top row.
 * That is the visible "vertical swap" bug.
 *
 * Contract generation is always Q0,Q1,Q2,Q3 within a ticket.  Walking that
 * sequence lets us discard only an unfinished tail at a generation restart and
 * preserves every complete ticket in canonical quadrant order.
 */
export function reconstructInventoryTicketTraits(cards) {
  return dgnReconstructTicketTraits(cards);
}

function invTicketHasGold(ids) {
  return Array.isArray(ids)
    && ids.some((tid) => invTraitToQSC(Number(tid)).col === INV_GOLD_COLOR_IDX);
}

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

class AppTicketsInventory extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #mode = 'cards';        // 'cards' | 'chart'
  #viewLevel = null;      // level being browsed (nav state)
  #activeLevel = null;    // the running jackpot level (app.lastDay.level)
  #address = null;
  #data = null;           // by-trait payload for (#address, #viewLevel)
  #owedEntries = 0;       // ticketsOwedView entries (won, not yet materialised)
  #deityPassSymbols = []; // DB-backed symbol ids owned by the viewed player
  #deityExpectedEntries = new Map(); // live virtual entries keyed by trait id
  // The viewed level's foil lines, as canonical trait keys. A foil pack's four
  // lines are ordinary entries in the by-trait inventory with no marker of their
  // own, so /foil?level=N is what tells them apart (null until the drain rolls
  // them, which is also before there is anything to highlight).
  #foilKeys = new Set();
  #holdings = [];         // per-level {level, wholeTickets} from /player/:addr
  #fetchSeq = 0;
  #pollHandle = null;
  // Account-switcher (2026-07-16) — mode 'combined' renders from this
  // instead of fetching the single-address by-trait/dashboard endpoints.
  #combined = null;
  #zoom = 100;
  #viewportHeight = INV_HEIGHT_DEFAULT;
  #heightCustomized = false;
  #resizeObserver = null;
  #packRevealListener = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#restoreViewPreferences();
    this.#renderShell();
    this.#wireControls();
    this.#applyViewPreferences();
    this.#watchViewportSize();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#packRevealListener = () => {
        // pack-watch updates its durable revealed set in the same event turn;
        // defer the refetch one microtask so listener registration order cannot
        // make the newly opened cards remain hidden for another poll cycle.
        Promise.resolve().then(() => this.#refresh());
      };
      document.addEventListener(PACK_REVEAL_COMPLETE_EVENT, this.#packRevealListener);
    }

    // The actual last day carries the authoritative current ticket level
    // (roll1.purchaseLevel); new days re-derive it.
    this.#unsubs.push(subscribe('app.lastDay', (payload) => {
      const pl = Number(payload?.roll1?.purchaseLevel);
      if (Number.isFinite(pl) && pl > 0) {
        this.#activeLevel = pl;
        if (this.#viewLevel == null) this.#viewLevel = pl;
      }
      this.#refresh();
    }));
    const onAddr = () => {
      this.#viewLevel = this.#activeLevel ?? this.#viewLevel;
      this.#refresh();
    };
    this.#unsubs.push(subscribe('connected.address', onAddr));
    this.#unsubs.push(subscribe('viewing.address', onAddr));
    // Account-switcher (2026-07-16): mode flips the data source; the merged
    // payload updates live as polling.js's combined-mode cycle refreshes.
    this.#unsubs.push(subscribe('ui.mode', () => this.#refresh()));
    this.#unsubs.push(subscribe('app.playerCombined', (payload) => {
      this.#combined = payload;
      if (get('ui.mode') === 'combined') this.#render();
    }));
    if (typeof setInterval === 'function') {
      this.#pollHandle = _setIntervalUnref(() => this.#refresh(), POLL_INTERVAL_MS);
    }
    this.#refresh();
  }

  disconnectedCallback() {
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#resizeObserver) {
      try { this.#resizeObserver.disconnect(); } catch (_) { /* defensive */ }
      this.#resizeObserver = null;
    }
    if (this.#packRevealListener && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener(PACK_REVEAL_COMPLETE_EVENT, this.#packRevealListener); }
      catch (_e) { /* defensive */ }
    }
    this.#packRevealListener = null;
  }

  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-tickets-inventory">
        <div class="panel-header inv-head">
          <h2>YOUR TICKETS</h2>
          <span class="inv-meta" data-bind="inv-meta">—</span>
          <span class="inv-level-nav">
            <button type="button" class="inv-level-btn" data-bind="inv-prev" title="Previous level">←</button>
            <span class="inv-level-display">Lv <b data-bind="inv-level">—</b> <span class="inv-level-tag" data-bind="inv-tag"></span></span>
            <button type="button" class="inv-level-btn" data-bind="inv-next" title="Next level">→</button>
            <button type="button" class="inv-level-btn" data-bind="inv-jump" title="Jump to active level">⟳</button>
          </span>
          <span class="inv-mode-toggle">
            <button type="button" class="inv-mode-btn is-active" data-bind="inv-mode-cards">Cards</button>
            <button type="button" class="inv-mode-btn" data-bind="inv-mode-chart">Chart</button>
          </span>
          <span class="inv-zoom-controls" aria-label="Ticket zoom">
            <button type="button" class="inv-view-btn" data-bind="inv-zoom-out" title="Zoom tickets out" aria-label="Zoom tickets out">−</button>
            <output class="inv-zoom-value" data-bind="inv-zoom-value" aria-live="polite">100%</output>
            <button type="button" class="inv-view-btn" data-bind="inv-zoom-in" title="Zoom tickets in" aria-label="Zoom tickets in">+</button>
          </span>
        </div>
        <div class="inv-window" data-bind="inv-window">
          <div class="inv-viewport" data-bind="inv-viewport">
            <div class="inv-cards" data-bind="inv-cards"></div>
            <div class="inv-chart" data-bind="inv-chart" hidden></div>
            <!-- Far-future long-term view: tickets owed per level across the
                 whole window (levels beyond active+4 can't have traits yet) -->
            <div class="inv-ff" data-bind="inv-ff" hidden></div>
            <!-- Account-switcher (2026-07-16): mode 'combined' shows a simple
                 owner-tagged list from app.playerCombined.tickets[] in place of
                 the by-trait cards/chart (which have no combined-view analog). -->
            <div class="inv-combined" data-bind="inv-combined" hidden></div>
          </div>
          <button type="button" class="inv-resize-grip" data-bind="inv-resize-grip"
                  aria-label="Resize ticket display" title="Drag to resize ticket display">⋯</button>
        </div>
      </section>
    `;
  }

  #wireControls() {
    const prev = this.querySelector('[data-bind="inv-prev"]');
    if (prev) prev.addEventListener('click', () => this.#navLevel(Math.max(1, (this.#viewLevel ?? 1) - 1)));
    const next = this.querySelector('[data-bind="inv-next"]');
    if (next) next.addEventListener('click', () => this.#navLevel((this.#viewLevel ?? 0) + 1));
    const jump = this.querySelector('[data-bind="inv-jump"]');
    if (jump) jump.addEventListener('click', () => {
      if (this.#activeLevel != null) this.#navLevel(this.#activeLevel);
    });
    const cardsBtn = this.querySelector('[data-bind="inv-mode-cards"]');
    if (cardsBtn) cardsBtn.addEventListener('click', () => this.#setMode('cards'));
    const chartBtn = this.querySelector('[data-bind="inv-mode-chart"]');
    if (chartBtn) chartBtn.addEventListener('click', () => this.#setMode('chart'));
    const zoomOut = this.querySelector('[data-bind="inv-zoom-out"]');
    if (zoomOut) zoomOut.addEventListener('click', () => this.#setZoom(this.#zoom - INV_ZOOM_STEP));
    const zoomIn = this.querySelector('[data-bind="inv-zoom-in"]');
    if (zoomIn) zoomIn.addEventListener('click', () => this.#setZoom(this.#zoom + INV_ZOOM_STEP));
    const grip = this.querySelector('[data-bind="inv-resize-grip"]');
    if (grip) {
      grip.addEventListener('keydown', (event) => {
        if (event?.key !== 'ArrowUp' && event?.key !== 'ArrowDown') return;
        try { event.preventDefault(); } catch (_) { /* fakeDOM */ }
        this.#setViewportHeight(this.#viewportHeight + (event.key === 'ArrowDown' ? 40 : -40));
      });
      grip.addEventListener('pointerdown', (event) => this.#beginViewportResize(event));
    }
  }

  #restoreViewPreferences() {
    try {
      const zoom = Number(localStorage.getItem(INV_ZOOM_KEY));
      if (Number.isFinite(zoom) && zoom >= INV_ZOOM_MIN && zoom <= INV_ZOOM_MAX) {
        this.#zoom = zoom;
      }
      const height = Number(localStorage.getItem(INV_HEIGHT_KEY));
      if (Number.isFinite(height) && height >= INV_HEIGHT_MIN && height <= INV_HEIGHT_MAX) {
        this.#viewportHeight = height;
        this.#heightCustomized = height !== INV_HEIGHT_DEFAULT;
      }
    } catch (_) { /* storage can be unavailable in private contexts */ }
  }

  #persistViewPreference(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) { /* best effort */ }
  }

  #setZoom(value) {
    this.#zoom = Math.max(INV_ZOOM_MIN, Math.min(INV_ZOOM_MAX, Math.round(Number(value) || 100)));
    this.#persistViewPreference(INV_ZOOM_KEY, this.#zoom);
    this.#applyViewPreferences();
  }

  #setViewportHeight(value, persist = true, markCustomized = true) {
    this.#viewportHeight = Math.max(
      INV_HEIGHT_MIN,
      Math.min(INV_HEIGHT_MAX, Math.round(Number(value) || INV_HEIGHT_DEFAULT)),
    );
    const frame = this.querySelector('[data-bind="inv-window"]');
    if (markCustomized) {
      this.#heightCustomized = this.#viewportHeight !== INV_HEIGHT_DEFAULT;
      frame?.classList?.remove('inv-window--fit-chart');
    }
    if (frame?.style) frame.style.height = `${this.#viewportHeight}px`;
    if (persist) this.#persistViewPreference(INV_HEIGHT_KEY, this.#viewportHeight);
  }

  #applyViewPreferences() {
    const frame = this.querySelector('[data-bind="inv-window"]');
    const cards = this.querySelector('[data-bind="inv-cards"]');
    if (frame?.style) frame.style.height = `${this.#viewportHeight}px`;
    if (cards?.style) {
      const cardMin = `${Math.round(96 * this.#zoom / 100)}px`;
      if (typeof cards.style.setProperty === 'function') cards.style.setProperty('--inv-card-min', cardMin);
      else cards.style['--inv-card-min'] = cardMin;
    }
    const output = this.querySelector('[data-bind="inv-zoom-value"]');
    if (output) output.textContent = `${this.#zoom}%`;
    const out = this.querySelector('[data-bind="inv-zoom-out"]');
    const inside = this.querySelector('[data-bind="inv-zoom-in"]');
    if (out) out.disabled = this.#zoom <= INV_ZOOM_MIN;
    if (inside) inside.disabled = this.#zoom >= INV_ZOOM_MAX;
  }

  #watchViewportSize() {
    if (typeof ResizeObserver !== 'function') return;
    const frame = this.querySelector('[data-bind="inv-window"]');
    if (!frame) return;
    this.#resizeObserver = new ResizeObserver((entries) => {
      if (frame.classList?.contains('inv-window--fit-chart')) return;
      const height = Number(entries?.[0]?.contentRect?.height);
      if (!Number.isFinite(height) || height < INV_HEIGHT_MIN) return;
      this.#viewportHeight = Math.max(INV_HEIGHT_MIN, Math.min(INV_HEIGHT_MAX, Math.round(height)));
      this.#heightCustomized = this.#viewportHeight !== INV_HEIGHT_DEFAULT;
      this.#persistViewPreference(INV_HEIGHT_KEY, this.#viewportHeight);
    });
    this.#resizeObserver.observe(frame);
  }

  #beginViewportResize(event) {
    const frame = this.querySelector('[data-bind="inv-window"]');
    if (!frame || typeof document?.addEventListener !== 'function') return;
    try { event.preventDefault(); } catch (_) { /* fakeDOM */ }
    const startY = Number(event?.clientY || 0);
    const startHeight = Number(frame.getBoundingClientRect?.().height) || this.#viewportHeight;
    const move = (next) => {
      this.#setViewportHeight(startHeight + Number(next?.clientY || 0) - startY, false);
    };
    const stop = () => {
      try { document.removeEventListener('pointermove', move); } catch (_) { /* defensive */ }
      try { document.removeEventListener('pointerup', stop); } catch (_) { /* defensive */ }
      this.#persistViewPreference(INV_HEIGHT_KEY, this.#viewportHeight);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
  }

  #navLevel(lvl) {
    if (lvl === this.#viewLevel) return;
    this.#viewLevel = lvl;
    this.#refresh();
  }

  #setMode(mode) {
    this.#mode = mode;
    const ff = this.#isFarFuture();
    const cardsBtn = this.querySelector('[data-bind="inv-mode-cards"]');
    const chartBtn = this.querySelector('[data-bind="inv-mode-chart"]');
    if (cardsBtn && cardsBtn.classList) cardsBtn.classList.toggle('is-active', mode === 'cards');
    if (chartBtn && chartBtn.classList) chartBtn.classList.toggle('is-active', mode === 'chart');
    // Far-future levels have no trait detail — the long-term view replaces
    // both modes and the toggle hides.
    if (cardsBtn) cardsBtn.hidden = ff;
    if (chartBtn) chartBtn.hidden = ff;
    const cards = this.querySelector('[data-bind="inv-cards"]');
    const chart = this.querySelector('[data-bind="inv-chart"]');
    const ffEl = this.querySelector('[data-bind="inv-ff"]');
    if (cards) cards.hidden = ff || mode !== 'cards';
    if (chart) chart.hidden = ff || mode !== 'chart';
    if (ffEl) ffEl.hidden = !ff;
    const frame = this.querySelector('[data-bind="inv-window"]');
    frame?.classList?.toggle(
      'inv-window--fit-chart',
      !ff && mode === 'chart' && !this.#heightCustomized,
    );
  }

  // ---------------------------------------------------------------------

  async #refresh() {
    // Account-switcher (2026-07-16): mode 'combined' has no single address to
    // fetch the by-trait/dashboard endpoints for — render the owner-tagged
    // list from app.playerCombined instead.
    if (get('ui.mode') === 'combined') {
      this.#address = null;
      this.#deityPassSymbols = [];
      this.#deityExpectedEntries = new Map();
      this.#combined = get('app.playerCombined');
      this.#render();
      return;
    }

    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;
    this.#address = addr;
    const seq = ++this.#fetchSeq;

    // Primary active-level source is the last-day payload's
    // roll1.purchaseLevel (store subscription above). Fall back to the
    // /game/state mint formula only while that hasn't arrived.
    if (this.#activeLevel == null) {
      const stored = get('app.lastDay');
      const pl = Number(stored?.roll1?.purchaseLevel);
      if (Number.isFinite(pl) && pl > 0) {
        this.#activeLevel = pl;
      } else {
        try {
          const gs = await fetchJSON('/game/state');
          if (seq !== this.#fetchSeq) return;
          // Contract port (app/active-level.js) — NOT the raw game_state level,
          // and not the `jackpotPhase ? level : level + 1` shorthand this used
          // to inline, which lags by one level in the sealed window at the end
          // of a jackpot phase.
          const active = activeTicketLevel(gs);
          if (active != null) this.#activeLevel = active;
        } catch (_e) { /* state blip — keep prior activeLevel */ }
      }
      if (this.#activeLevel != null && this.#viewLevel == null) {
        this.#viewLevel = this.#activeLevel;
      }
    }

    const lvl = this.#viewLevel;
    if (!addr || lvl == null) {
      this.#data = null;
      this.#holdings = [];
      this.#deityPassSymbols = [];
      this.#deityExpectedEntries = new Map();
      this.#render();
      return;
    }
    const lower = String(addr).toLowerCase();
    const day = Number(get('app.lastDay')?.day);
    const [byTrait, dashboard, pending, foil, playerDay] = await Promise.allSettled([
      // NO day param (tickets-fetch.js gotcha — see file header). Skipped in
      // far-future view — those levels can't have rolled traits yet.
      this.#isFarFuture()
        ? Promise.resolve(null)
        : fetchJSON(`/player/${lower}/tickets/by-trait?level=${lvl}`),
      // Per-level entry counts for the far-future long-term view.
      fetchJSON(`/player/${lower}`),
      // Tickets WON but not yet materialised — see #renderOwedPack. Neither of
      // the other two endpoints carries them: by-trait returns materialised
      // entries only, and the dashboard's `tickets` rows are per-level holdings.
      fetchJSON(`/player/${lower}/pending`),
      // Foil lines for this level — soft-fails to "no foil" (see #foilKeys).
      this.#isFarFuture()
        ? Promise.resolve(null)
        : fetchJSON(`/player/${lower}/foil?level=${lvl}`),
      // The viewer snapshot is the indexed ownership source for deity passes.
      // A pass is account inventory rather than level-scoped ticket data, so
      // it remains visible while browsing any ordinary ticket level.
      Number.isInteger(day) && day >= 0
        ? fetchJSON(`/viewer/player/${lower}/day/${day}`)
        : Promise.resolve(null),
    ]);
    if (seq !== this.#fetchSeq) return;
    const rawTicketData = byTrait.status === 'fulfilled' ? byTrait.value : null;
    const hiddenPackCards = unopenedPackCardIndexes({
      address: lower,
      level: lvl,
      cards: rawTicketData?.cards,
    });
    this.#data = hideUnopenedPackTickets(rawTicketData, hiddenPackCards);
    this.#foilKeys = _foilKeySet(foil.status === 'fulfilled' ? foil.value : null);
    const deityRows = playerDay.status === 'fulfilled'
      && Array.isArray(playerDay.value?.store?.deityPassPurchases)
      ? playerDay.value.store.deityPassPurchases
      : [];
    this.#deityPassSymbols = [...new Set(deityRows
      .map((row) => Number(row?.symbolId))
      .filter((symbolId) => Number.isInteger(symbolId) && symbolId >= 0 && symbolId < 32))]
      .sort((a, b) => a - b);
    this.#deityExpectedEntries = new Map();
    this.#owedEntries = pending.status === 'fulfilled'
      && pending.value?.pending?.tickets?.available !== false
      ? Number(pending.value?.pending?.tickets?.amount ?? 0)
      : 0;
    const rows = dashboard.status === 'fulfilled' && Array.isArray(dashboard.value?.tickets)
      ? dashboard.value.tickets
      : [];
    this.#holdings = rows
      .map((t) => ({
        level: Number(t?.level),
        wholeTickets: Math.floor(Number(t?.entryCount ?? 0) / ENTRIES_PER_CARD),
      }))
      .filter((t) => Number.isFinite(t.level) && t.wholeTickets > 0);
    this.#render();
    if (!this.#isFarFuture() && this.#deityPassSymbols.length > 0) {
      void this.#refreshDeityExpectedEntries(seq, lvl, this.#deityPassSymbols);
    }
  }

  async #refreshDeityExpectedEntries(seq, level, symbolIds) {
    let expected;
    try {
      expected = await readDeityExpectedEntries(level, symbolIds);
    } catch (_e) {
      expected = new Map();
    }
    if (seq !== this.#fetchSeq || Number(level) !== Number(this.#viewLevel)) return;
    this.#deityExpectedEntries = expected;
    this.#renderChart();
  }

  // Far-future = beyond the last level that can have rolled traits.
  #isFarFuture() {
    return this.#viewLevel != null
      && this.#activeLevel != null
      && this.#viewLevel > this.#activeLevel + FAR_FUTURE_OFFSET;
  }

  // ---------------------------------------------------------------------

  #renderHeader() {
    const levelEl = this.querySelector('[data-bind="inv-level"]');
    if (levelEl) levelEl.textContent = this.#viewLevel == null ? '—' : String(this.#viewLevel);
    const tagEl = this.querySelector('[data-bind="inv-tag"]');
    if (tagEl) {
      let tag = '';
      if (this.#viewLevel != null && this.#activeLevel != null) {
        tag = this.#viewLevel === this.#activeLevel ? 'active'
          : this.#isFarFuture() ? 'far future'
          : this.#viewLevel > this.#activeLevel ? 'future' : 'past';
      }
      tagEl.textContent = tag;
    }
    const meta = this.querySelector('[data-bind="inv-meta"]');
    if (meta) {
      if (this.#isFarFuture()) {
        meta.textContent = 'Long-term holdings — traits roll when each level goes live.';
      } else {
        const d = this.#data;
        if (!d) {
          meta.textContent = this.#address ? 'No tickets at this level.' : 'Pick a player to see tickets.';
        } else {
          const cards = Math.floor(Number(d.totalEntries || 0) / ENTRIES_PER_CARD);
          const pending = (Array.isArray(d.cards) ? d.cards : [])
            .filter((c) => c && c.status === 'pending').length;
          meta.textContent = `${cards} card${cards === 1 ? '' : 's'}`
            + (pending ? ` · ${pending} pending` : '');
        }
      }
    }
  }

  #render() {
    if (get('ui.mode') === 'combined') {
      this.#renderCombinedView();
      return;
    }
    // Leaving combined mode — re-hide the combined-view host (it only shows
    // itself; nothing else re-hides it when mode flips back).
    const combinedHost = this.querySelector('[data-bind="inv-combined"]');
    if (combinedHost) combinedHost.hidden = true;
    this.#renderHeader();
    this.#renderCards();
    this.#renderChart();
    this.#renderFarFuture();
    this.#setMode(this.#mode);  // re-assert visibility after rebuild
  }

  // ---------------------------------------------------------------------
  // Account-switcher (2026-07-16) — combined-mode view. app.playerCombined's
  // tickets[] is the simple {level, entryCount, owner} shape from combine.js
  // (CONCAT + owner tag) — no by-trait detail exists for a combined set of
  // addresses (the /tickets/by-trait endpoint is single-address only), so
  // this renders a level + owner-tagged list instead of the cards/chart UI.
  // ---------------------------------------------------------------------

  #renderCombinedView() {
    const cards = this.querySelector('[data-bind="inv-cards"]');
    const chart = this.querySelector('[data-bind="inv-chart"]');
    const ff = this.querySelector('[data-bind="inv-ff"]');
    const combinedHost = this.querySelector('[data-bind="inv-combined"]');
    if (cards) cards.hidden = true;
    if (chart) chart.hidden = true;
    if (ff) ff.hidden = true;
    if (!combinedHost) return;
    combinedHost.hidden = false;
    combinedHost.textContent = '';

    const levelEl = this.querySelector('[data-bind="inv-level"]');
    const tagEl = this.querySelector('[data-bind="inv-tag"]');
    if (levelEl) levelEl.textContent = '—';
    if (tagEl) tagEl.textContent = '';

    const rows = Array.isArray(this.#combined?.tickets) ? this.#combined.tickets : [];
    const addrCount = Array.isArray(this.#combined?.addresses) ? this.#combined.addresses.length : 0;
    const meta = this.querySelector('[data-bind="inv-meta"]');

    const withWhole = rows
      .map((r) => ({ level: Number(r?.level), whole: Math.floor(Number(r?.entryCount || 0) / ENTRIES_PER_CARD), owner: r?.owner }))
      .filter((r) => Number.isFinite(r.level) && r.whole > 0)
      .sort((a, b) => a.level - b.level || String(a.owner).localeCompare(String(b.owner)));

    if (withWhole.length === 0) {
      if (meta) meta.textContent = addrCount > 0 ? `No tickets across ${addrCount} combined accounts.` : 'No tickets across the combined accounts.';
      const empty = document.createElement('p');
      empty.className = 'inv-empty';
      empty.textContent = 'No tickets across the combined accounts.';
      combinedHost.appendChild(empty);
      return;
    }

    const totalWhole = withWhole.reduce((s, r) => s + r.whole, 0);
    if (meta) {
      meta.textContent = `${totalWhole} ticket${totalWhole === 1 ? '' : 's'} across ${addrCount} account${addrCount === 1 ? '' : 's'}`;
    }

    const list = document.createElement('div');
    list.className = 'inv-combined-rows';
    for (const r of withWhole) {
      const row = document.createElement('div');
      row.className = 'inv-combined-row';
      const lvl = document.createElement('span');
      lvl.className = 'inv-combined-level';
      lvl.textContent = `L${r.level}`;
      row.appendChild(lvl);
      const count = document.createElement('span');
      count.className = 'inv-combined-count';
      count.textContent = `${r.whole} ticket${r.whole === 1 ? '' : 's'}`;
      row.appendChild(count);
      const owner = document.createElement('span');
      owner.className = 'inv-combined-owner';
      owner.textContent = this.#abbrevAddr(r.owner);
      row.appendChild(owner);
      list.appendChild(row);
    }
    combinedHost.appendChild(list);
  }

  // Abbreviated owner tag — "0xab…cd" style (matches the account-switcher
  // spec's abbreviation convention for approver/self options).
  #abbrevAddr(addr) {
    const s = String(addr || '');
    if (!/^0x[0-9a-fA-F]{4,}$/.test(s)) return s;
    return `${s.slice(0, 4)}…${s.slice(-2)}`;
  }

  // Long-term view: tickets owed per level across the far-future window
  // (active+1 .. active+FAR_FUTURE_SPAN), from the dashboard per-level rows.
  #renderFarFuture() {
    const host = this.querySelector('[data-bind="inv-ff"]');
    if (!host) return;
    host.textContent = '';
    if (!this.#isFarFuture()) return;

    const lo = this.#activeLevel + 1;
    const hi = this.#activeLevel + FAR_FUTURE_SPAN;
    const rows = this.#holdings
      .filter((t) => t.level >= lo && t.level <= hi)
      .sort((a, b) => a.level - b.level);

    const total = rows.reduce((s, t) => s + t.wholeTickets, 0);
    const head = document.createElement('p');
    head.className = 'inv-ff__total';
    head.textContent = total > 0
      ? `${total.toLocaleString('en-US')} tickets owed across ${rows.length} future level${rows.length === 1 ? '' : 's'} (through level ${hi})`
      : `No far-future tickets held (levels ${lo}–${hi}).`;
    host.appendChild(head);

    if (rows.length === 0) return;
    const list = document.createElement('div');
    list.className = 'inv-ff__rows';
    for (const t of rows) {
      const row = document.createElement('div');
      row.className = 'inv-ff__row';
      if (t.level === this.#viewLevel) row.classList.add('is-viewed');
      const lvl = document.createElement('span');
      lvl.className = 'inv-ff__level';
      lvl.textContent = `L${t.level}`;
      row.appendChild(lvl);
      const count = document.createElement('span');
      count.className = 'inv-ff__count';
      count.textContent = `${t.wholeTickets.toLocaleString('en-US')} ticket${t.wholeTickets === 1 ? '' : 's'}`;
      row.appendChild(count);
      list.appendChild(row);
    }
    host.appendChild(list);
  }

  // Cards mode — dedup identical 4-trait combos into ×N cards (sketch
  // renderInventoryCards port).
  #renderCards() {
    const host = this.querySelector('[data-bind="inv-cards"]');
    if (!host) return;
    host.textContent = '';
    const d = this.#data;
    const cardsArr = Array.isArray(d?.cards) ? d.cards : [];

    const combos = new Map();
    let pendingCount = 0;
    for (const card of cardsArr) {
      if (card?.status === 'pending') pendingCount++;
    }
    for (const ids of reconstructInventoryTicketTraits(cardsArr)) {
      const key = ids.join(',');
      if (!combos.has(key)) {
        combos.set(key, {
          traitIds: ids,
          count: 0,
          foil: this.#foilKeys.has(invComboKey(ids)),
          hasGold: invTicketHasGold(ids),
        });
      }
      combos.get(key).count++;
    }

    // Gold is the top colour tier and the useful scan target. Put every ticket
    // carrying at least one gold trait before the rest, then preserve the
    // existing duplicate-count ordering within each tier.
    const sorted = [...combos.values()].sort(
      (a, b) => Number(b.hasGold) - Number(a.hasGold) || b.count - a.count,
    );

    // Permanent account collectibles come before level-scoped tickets.
    const deityRendered = this.#renderDeityPasses(host);

    // Owed pack FIRST among ticket rewards. It is a prize the player has not seen yet, and the card
    // list runs to dozens of tiles — appended last it sat below the fold, which
    // is the same "won tickets went nowhere" complaint it exists to answer.
    const owedRendered = this.#renderOwedPack(host);

    if (sorted.length === 0 && pendingCount === 0 && !owedRendered && !deityRendered) {
      const empty = document.createElement('p');
      empty.className = 'inv-empty';
      empty.textContent = this.#address
        ? `No tickets at level ${this.#viewLevel ?? '—'}.`
        : 'Pick a player to see tickets.';
      host.appendChild(empty);
      return;
    }

    for (const combo of sorted) {
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.className = combo.foil ? 'inv-card inv-card--foil' : 'inv-card';
      wrap.classList?.add('inv-card--degenerette-copy');
      wrap.title = 'Use this ticket in Degenerette';
      wrap.setAttribute('aria-label', 'Use this ticket in Degenerette');
      wrap.addEventListener('click', () => {
        if (typeof document === 'undefined'
          || typeof document.dispatchEvent !== 'function'
          || typeof CustomEvent !== 'function') return;
        for (const prior of host.querySelectorAll?.('.inv-card--copied') || []) {
          prior.classList?.remove('inv-card--copied');
        }
        wrap.classList?.add('inv-card--copied');
        wrap.title = 'Copied to Degenerette';
        wrap.setAttribute('aria-label', 'Copied to Degenerette');
        document.dispatchEvent(new CustomEvent(DGN_TICKET_COPY_EVENT, {
          detail: {
            traitIds: [...combo.traitIds],
            level: this.#viewLevel,
            foil: combo.foil,
          },
        }));
      });
      if (combo.hasGold && wrap.classList) wrap.classList.add('inv-card--gold');
      if (combo.foil) {
        // The four boosted lines are worth picking out of a wall of tiles: they
        // grade against every draw at this level, the plain ones do not.
        const shine = document.createElement('span');
        shine.className = 'inv-foil-shine';
        wrap.appendChild(shine);
        const tag = document.createElement('span');
        tag.className = 'inv-foil-tag';
        tag.textContent = 'FOIL';
        wrap.appendChild(tag);
      }
      // ×N badge only when N > 1. The dedup key is the ORDERED 4-trait combo, one of
      // 64^4 ≈ 16.8M, so two tickets colliding is a birthday-problem non-event at any
      // realistic ticket count — the badge read "×1" on every card and was pure noise.
      // Kept for the >1 case rather than deleted: without it a genuine duplicate would
      // render as one unlabelled card silently standing for two tickets.
      if (combo.count > 1) {
        const count = document.createElement('div');
        count.className = 'inv-count';
        count.textContent = `×${combo.count}`;
        wrap.appendChild(count);
      }

      const card = document.createElement('div');
      card.className = 'ticket-card tc-small';
      for (const tid of combo.traitIds) {
        const cell = document.createElement('div');
        cell.className = 'trait-quadrant';
        const { q, sym, col } = invTraitToQSC(Number(tid));
        // Gold is the top colour tier; give the cell behind it a metal.
        if (col === INV_GOLD_COLOR_IDX) cell.classList.add('trait-quadrant--gold');
        const img = document.createElement('img');
        img.src = invBadgePath(q, sym, col);
        img.alt = `${INV_SYMBOLS[INV_QUADRANTS[q]][sym]} ${INV_COLORS[col]}`;
        cell.appendChild(img);
        card.appendChild(cell);
      }
      const center = document.createElement('div');
      center.className = 'ticket-card-center';
      const flame = document.createElement('img');
      flame.src = '/whitepaper/flame-center.svg';
      flame.alt = '';
      center.appendChild(flame);
      card.appendChild(center);
      wrap.appendChild(card);
      host.appendChild(wrap);
    }

    if (pendingCount > 0) {
      const pend = document.createElement('div');
      pend.className = 'inv-card inv-card--pending';
      pend.textContent = `↻ ${pendingCount} pack${pendingCount === 1 ? '' : 's'} pending`;
      host.appendChild(pend);
    }
  }

  /**
   * Render each indexed deity-pass NFT as its inventory art: a blank rounded
   * pass face with the bound symbol enlarged inside the same spiked gold hero
   * treatment used by Degenerette. It intentionally is not a button — clicking
   * ordinary tickets copies them into Degenerette, while a deity pass is not a
   * four-trait ticket and must never enter that path.
   */
  #renderDeityPasses(host) {
    let rendered = 0;
    for (const symbolId of this.#deityPassSymbols) {
      const q = (symbolId >> 3) & 3;
      const sym = symbolId & 7;
      const cat = INV_QUADRANTS[q];
      const symbolName = INV_SYMBOLS[cat][sym];

      const pass = document.createElement('div');
      pass.className = 'inv-card inv-card--deity-pass';
      pass.title = `Deity pass · ${cat} · ${symbolName}`;
      pass.setAttribute('aria-label', pass.title);

      const hero = document.createElement('div');
      hero.className = 'inv-deity-pass__hero';
      const badge = document.createElement('img');
      badge.className = 'inv-deity-pass__badge';
      badge.src = invBadgePath(q, sym, INV_GOLD_COLOR_IDX);
      badge.alt = `${symbolName} deity pass`;
      hero.appendChild(badge);
      pass.appendChild(hero);
      host.appendChild(pass);
      rendered += 1;
    }
    return rendered;
  }

  /**
   * Tickets WON but not yet materialised, shown as a sealed pack (user ask:
   * "show the pending tickets as a pack").
   *
   * This is a different thing from the `status === 'pending'` cards above.
   * Those are packs the player BOUGHT whose traits have not been revealed yet.
   * This is the on-chain `ticketsOwedView` balance — tickets awarded by a
   * jackpot draw that have not been turned into entries. They were invisible
   * everywhere in the UI: the by-trait endpoint only returns materialised
   * entries, so a draw could pay you 17 tickets and nothing on the page moved.
   *
   * UNITS: the API returns ENTRIES (database ticket-bucket-reader.ts:79), and
   * 4 entries = 1 ticket (ENTRIES_PER_CARD). The pack shows tickets with the
   * entry count under it.
   *
   * It is level-agnostic (the owed balance sums across levels), so it renders
   * regardless of which level the inventory is currently viewing — hence the
   * explicit "across all levels" caption; without it the number would look
   * wrong next to a level-scoped card list.
   */
  #renderOwedPack(host) {
    const entries = Number(this.#owedEntries ?? 0);
    if (!Number.isFinite(entries) || entries <= 0) return false;
    const tickets = Math.floor(entries / ENTRIES_PER_CARD);
    if (tickets <= 0) return false;

    const wrap = document.createElement('div');
    wrap.className = 'inv-card-wrap';

    const pack = document.createElement('div');
    pack.className = 'inv-card inv-card--owed';

    const title = document.createElement('span');
    title.className = 'inv-owed__count';
    title.textContent = `${tickets}`;

    const label = document.createElement('span');
    label.className = 'inv-owed__label';
    label.textContent = tickets === 1 ? 'ticket won' : 'tickets won';

    const sub = document.createElement('span');
    sub.className = 'inv-owed__sub';
    sub.textContent = `${entries} entries · across all levels`;

    pack.appendChild(title);
    pack.appendChild(label);
    pack.appendChild(sub);
    wrap.appendChild(pack);
    host.appendChild(wrap);
    return true;
  }

  // Chart mode — the wide view: per quadrant, an 8×8 grid (row = symbol,
  // col = color); cell trait_id = q*64 + c*8 + s (sketch renderInventoryChart
  // port — this reconstruction is the exact inverse of invTraitToQSC and is
  // the load-bearing bit for matrix orientation).
  #renderChart() {
    const host = this.querySelector('[data-bind="inv-chart"]');
    if (!host) return;
    host.textContent = '';
    const d = this.#data;
    const cardsArr = Array.isArray(d?.cards) ? d.cards : [];

    const counts = new Array(256).fill(0);
    for (const card of cardsArr) {
      if (!card || card.status !== 'opened') continue;
      for (const e of (card.entries || [])) {
        const tid = e?.traitId;
        if (tid != null && tid >= 0 && tid < 256) counts[tid]++;
      }
    }

    if (this.#deityExpectedEntries.size > 0) {
      const note = document.createElement('p');
      note.className = 'inv-chart__deity-note';
      note.textContent = 'D+ = current Deity entries';
      host.appendChild(note);
    }

    INV_QUADRANTS.forEach((cat, q) => {
      const block = document.createElement('div');
      block.className = 'chart-quadrant';
      const h = document.createElement('h4');
      h.textContent = `${cat} · 64 traits`;
      block.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'chart-grid';
      for (let s = 0; s < 8; s++) {
        for (let c = 0; c < 8; c++) {
          const tid = q * 64 + c * 8 + s;
          const count = counts[tid];
          const deityCount = Number(this.#deityExpectedEntries.get(tid) || 0);
          const cell = document.createElement('div');
          cell.className = 'chart-cell';
          if (count > 0) cell.classList.add('has');
          if (deityCount > 0) {
            cell.classList.add('has-deity');
            cell.title = `Current Deity entries: ${deityCount}`;
          }
          const img = document.createElement('img');
          img.src = invBadgePath(q, s, c);
          img.alt = `${INV_SYMBOLS[cat][s]} ${INV_COLORS[c]}`;
          cell.appendChild(img);
          if (count > 0) {
            const label = document.createElement('span');
            label.className = 'cell-count';
            label.textContent = String(count);
            cell.appendChild(label);
          }
          if (deityCount > 0) {
            const deity = document.createElement('span');
            deity.className = 'cell-deity-count';
            deity.textContent = `D+${deityCount}`;
            cell.appendChild(deity);
          }
          grid.appendChild(cell);
        }
      }
      block.appendChild(grid);
      host.appendChild(block);
    });
  }
}

// Idempotency-guarded register (Phase 58 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-tickets-inventory')) {
    customElements.define('app-tickets-inventory', AppTicketsInventory);
  }
}

export { AppTicketsInventory };
