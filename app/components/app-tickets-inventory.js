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
// Level nav: five live level tabs + one aggregate FUTURE tab. "Active" = the ACTUAL last day's
// `roll1.purchaseLevel` (the level tickets are currently sold/drawn at —
// verified live day 130: purchaseLevel 25 while eth wins sat at 25, ticket
// awards at 26, chain level() read 24). NOT `lastDay.level` — that field is
// the count-weighted winner level, and ticket/bonus AWARD rows (next +
// future levels) outnumber the eth rows, so it reads one level high. The
// /game/state mint formula (jackpotPhase ? level : level+1) is the fallback
// when the last-day payload hasn't arrived.
// T-58-18: server-derived strings via textContent.

import { get, subscribe, getViewedAddress, deriveCanSign } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { readGameState } from '../app/game-state.js';
import { activeTicketLevel } from '../app/active-level.js';
import { ethers, getProvider } from '../app/contracts.js';
import { sharedReadProvider } from '../app/read-provider.js';
import { CONTRACTS } from '../app/chain-config.js';
import { scaledTicketPriceWei } from '../app/lootbox.js';
import { displayEth, displayToken } from '../app/scaling.js';
import {
  previewFarFutureSalvage,
  sellFarFutureSalvage,
  SALVAGE_MAX_LINES,
} from '../app/salvage.js';
import { compactUiError } from '../app/ui-error.js';
import { applyTicketLevelTone } from '../app/ticket-level-tone.js';
import { registerComponentPoll } from '../app/component-poll.js';
import {
  applyDgnTicketAccent,
  DGN_TICKET_COPY_EVENT,
  dgnPartitionTicketEntries,
  dgnReconstructTicketTraits,
} from '../app/dgn-traits.js';
import { readDeityPassCatalog } from '../app/passes.js';

const ENTRIES_PER_CARD = 4;
const HOLDINGS_FALLBACK_NEAR_LEVELS = 6;
const POLL_INTERVAL_MS = 60_000;
// Levels beyond active + FAR_FUTURE_OFFSET can't have rolled traits yet
// (play/components/tickets-panel.js:25 convention) — the widget switches to
// the long-term view: per-level tickets owed across the whole far-future
// window (user ask 2026-07-03).
const FAR_FUTURE_OFFSET = 4;
const FAR_FUTURE_SPAN = 100;
const SALVAGE_MIN_DISTANCE = 6;
const SALVAGE_MAX_DISTANCE = 100;
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

/** Test seam for the read-only GAME projection below. */
export function __setDeityEntryContractFactoryForTest(factory) {
  _deityEntryContractFactory = typeof factory === 'function' ? factory : null;
}

export function __resetDeityEntryContractFactoryForTest() {
  _deityEntryContractFactory = null;
}

function _deityEntryContract() {
  if (_deityEntryContractFactory) return _deityEntryContractFactory();
  const provider = getProvider() || sharedReadProvider();
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

/** /foil payload → its four canonical lines (empty until the pack has rolled). */
function _foilLines(payload) {
  const out = [];
  const lines = payload?.present ? payload.lines : null;
  if (!Array.isArray(lines)) return out;
  for (const line of lines) {
    if (Array.isArray(line) && line.length === 4 && line.every((t) => t != null)) {
      out.push([...line].map(Number).sort((a, b) => a - b));
    }
  }
  // A foil pack is exactly four tickets. Treat a partial indexer answer as
  // pending rather than painting a misleading one-ticket foil pack.
  return out.length >= 4 ? out.slice(0, 4) : [];
}

// The API returns fresh object identities on every poll even when the ticket
// stream is unchanged. A compact visual fingerprint lets the component retain
// its existing (potentially very large) DOM instead of rebuilding thousands of
// ticket nodes and image elements once a minute.
function _inventoryPayloadFingerprint(payload) {
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  const parts = [String(payload?.totalEntries ?? 0), String(cards.length)];
  for (const card of cards) {
    parts.push(String(card?.cardIndex ?? ''), String(card?.status ?? ''));
    for (const entry of Array.isArray(card?.entries) ? card.entries : []) {
      parts.push(String(entry?.traitId ?? ''));
    }
    parts.push(';');
  }
  return parts.join('|');
}

/**
 * Face value of unresolved ticket entries. The dashboard stores four entries
 * per whole ticket, and fractional tickets are real inventory, so value the
 * entries directly instead of rounding them down to display cards.
 */
export function unresolvedTicketFaceValueWei(rows, activeLevel) {
  const floor = Number(activeLevel);
  if (!Number.isInteger(floor) || floor < 0) return 0n;

  let total = 0n;
  for (const row of Array.isArray(rows) ? rows : []) {
    const level = Number(row?.level);
    if (!Number.isInteger(level) || level < floor) continue;
    let entries;
    try {
      entries = typeof row?.entryCount === 'number'
        ? BigInt(Math.floor(row.entryCount))
        : BigInt(row?.entryCount ?? 0);
    } catch (_e) {
      continue;
    }
    if (entries <= 0n) continue;
    total += (scaledTicketPriceWei(level) * entries) / BigInt(ENTRIES_PER_CARD);
  }
  return total;
}

/**
 * Recover the per-level aggregate when /player/:address has no summary row.
 * The six levels at the live boundary may already be materialized into trait
 * entries; everything farther out remains in the indexed far-future queue.
 * Those two projections are disjoint in normal operation, and max-by-level
 * keeps the merge safe during the promotion boundary.
 */
export async function readTicketHoldingsFallback({
  address,
  unresolvedLevel,
  knownLevel = null,
  knownPayload = null,
  fetcher = fetchJSON,
}) {
  const floor = Number(unresolvedLevel);
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))
    || !Number.isInteger(floor) || floor < 0
    || typeof fetcher !== 'function') return null;

  const levels = Array.from(
    { length: HOLDINGS_FALLBACK_NEAR_LEVELS },
    (_unused, offset) => floor + offset,
  );
  const [near, far] = await Promise.all([
    Promise.all(levels.map((level) => (
      Number(knownLevel) === level && knownPayload && typeof knownPayload === 'object'
        ? Promise.resolve(knownPayload)
        : fetcher(`/player/${String(address).toLowerCase()}/tickets/by-trait?level=${level}`)
    ))),
    fetcher(`/player/${String(address).toLowerCase()}/far-future-queue`),
  ]);

  const byLevel = new Map();
  for (let i = 0; i < levels.length; i += 1) {
    const entries = Math.max(0, Math.floor(Number(near[i]?.totalEntries ?? 0)));
    if (entries > 0) byLevel.set(levels[i], entries);
  }
  for (const row of Array.isArray(far?.rows) ? far.rows : []) {
    const level = Number(row?.level);
    const entries = Math.max(0, Math.floor(Number(row?.entryCount ?? 0)));
    if (!Number.isInteger(level) || level < floor || entries <= 0) continue;
    byLevel.set(level, Math.max(entries, byLevel.get(level) || 0));
  }
  return [...byLevel.entries()]
    .map(([level, entryCount]) => ({
      level,
      entryCount,
      wholeTickets: Math.floor(entryCount / ENTRIES_PER_CARD),
    }))
    .sort((a, b) => a.level - b.level);
}

/** Keep useful sub-cent precision without printing accounting-style zeroes. */
export function formatTicketTotalValueEth(rawWei) {
  const fixed = displayEth(BigInt(rawWei ?? 0), 4);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/** Exact player-facing inventory quantity without erasing quarter tickets. */
export function formatTicketEntryHoldings(entryCount) {
  const entries = Math.max(0, Math.floor(Number(entryCount) || 0));
  const whole = Math.floor(entries / ENTRIES_PER_CARD);
  const loose = entries % ENTRIES_PER_CARD;
  const fraction = ['', '.25', '.5', '.75'][loose];
  const quantity = `${whole.toLocaleString('en-US')}${fraction}`;
  return `${quantity} ticket${entries === ENTRIES_PER_CARD ? '' : 's'}`;
}

/** Compact quantity used inside the fixed-width level tabs. */
export function formatTicketEntryQuantity(entryCount) {
  return formatTicketEntryHoldings(entryCount).replace(/ tickets?$/, '');
}

const SALVAGE_PURCHASE_UNITS_PER_TICKET = 400n;

/** Exact purchase units the contract mints from the quote's ticketWei leg. */
export function salvageTicketPurchaseUnits(ticketWei, activeLevel) {
  let raw;
  try { raw = BigInt(ticketWei ?? 0); } catch (_e) { return 0n; }
  const price = scaledTicketPriceWei(activeLevel);
  if (raw <= 0n || price <= 0n) return 0n;
  return (raw * SALVAGE_PURCHASE_UNITS_PER_TICKET) / price;
}

/** Player-facing ticket count, retaining the contract's 0.0025 precision. */
export function formatSalvageTicketCount(ticketWei, activeLevel) {
  const units = salvageTicketPurchaseUnits(ticketWei, activeLevel);
  const whole = units / SALVAGE_PURCHASE_UNITS_PER_TICKET;
  const remainder = units % SALVAGE_PURCHASE_UNITS_PER_TICKET;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (remainder === 0n) return grouped;
  const fraction = (remainder * 25n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${grouped}.${fraction}`;
}

/**
 * Old ticket rows stop carrying face value only after their level's final
 * draw has settled. This intentionally differs from activeTicketLevel during
 * a final RNG lock: new buys already route forward, but the locked draw's
 * tickets are still unresolved until the phase transition begins.
 */
export function unresolvedTicketLevel(gameState) {
  const level = Number(gameState?.level);
  if (!Number.isInteger(level) || level < 0) return null;
  if (gameState?.phaseTransitionActive === true) return level + 1;
  const jackpotPhase = Boolean(
    gameState?.jackpotPhaseFlag ?? (gameState?.phase === 'JACKPOT'),
  );
  if (jackpotPhase || gameState?.rngLockedFlag === true) return level;
  return level + 1;
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

function invEntryLabel(traitId) {
  const { q, sym, col } = invTraitToQSC(Number(traitId));
  const category = INV_QUADRANTS[q];
  const symbol = INV_SYMBOLS[category]?.[sym] || 'trait';
  const color = INV_COLORS[col] || 'unknown';
  return `${symbol.replace(/[_-]+/g, ' ')} ${color}`;
}

class AppTicketsInventory extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #mode = 'cards';        // 'cards' | 'chart'
  #viewLevel = null;      // level being browsed (nav state)
  #activeLevel = null;    // first live/unresolved ticket level shown in the rail
  #address = null;
  #data = null;           // by-trait payload for (#address, #viewLevel)
  #dataLevel = null;      // level that #data actually belongs to during async nav
  #dataRenderKey = 'empty';
  #cardsRenderKey = null;
  #chartRenderKey = null;
  #deityPassSymbols = []; // persistent NFT-backed symbol ids owned by the viewed player
  #deityExpectedEntries = new Map(); // live virtual entries keyed by trait id
  #deityExpectedScope = '';
  #deityExpectedLoading = '';
  // The viewed level's foil lines, as canonical trait keys. A foil pack's four
  // lines are ordinary entries in the by-trait inventory with no marker of their
  // own, so /foil?level=N is what tells them apart (null until the drain rolls
  // them, which is also before there is anything to highlight).
  #foilLines = [];
  #holdings = [];         // per-level {level, entryCount, wholeTickets} from /player/:addr
  #holdingsAddress = null;
  #holdingsLoaded = false;
  #salvageQueue = [];     // exact {level, queueIndex, entryCount, remainder} mirror
  #salvageQueueLoaded = false;
  #salvageSelection = new Map(); // level -> whole-ticket quantity
  #salvageQuote = null;
  #salvageQuoteLoading = false;
  #salvageQuoteSeq = 0;
  #salvageArmed = false;
  #salvageBusy = false;
  #salvageMessage = '';
  #salvageError = '';
  #salvageDrag = null;     // mouse/pen paint gesture across far-future levels
  #salvageDragStop = null;
  #fetchSeq = 0;
  #pollHandle = null;
  // Account-switcher (2026-07-16) — mode 'combined' renders from this
  // instead of fetching the single-address by-trait/dashboard endpoints.
  #combined = null;
  #zoom = 100;
  #viewportHeight = INV_HEIGHT_DEFAULT;
  #heightCustomized = false;
  #expanded = false;
  #expandRenderTimer = null;
  #focusSalvageOnRender = false;
  #resizeObserver = null;
  #visibilityListener = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#restoreViewPreferences();
    this.#renderShell();
    this.#wireControls();
    this.#applyViewPreferences();
    this.#watchViewportSize();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#visibilityListener = () => {
        if (document.visibilityState === 'visible') this.#refresh();
      };
      document.addEventListener('visibilitychange', this.#visibilityListener);
    }

    // The actual last day carries the authoritative current ticket level
    // (roll1.purchaseLevel); new days re-derive it.
    this.#unsubs.push(subscribe('app.lastDay', (payload) => {
      const pl = Number(payload?.roll1?.purchaseLevel);
      if (Number.isFinite(pl) && pl > 0) {
        // Levels are monotonic. A late last-day poll must not put a resolved
        // level back after gameState has already advanced the rail boundary.
        this.#reconcileLevelFloor(pl);
      }
      this.#refresh();
    }));
    const onAddr = () => {
      this.#viewLevel = this.#activeLevel ?? this.#viewLevel;
      this.#refresh();
    };
    this.#unsubs.push(subscribe('connected.address', onAddr));
    this.#unsubs.push(subscribe('viewing.address', onAddr));
    // The unresolved-level boundary can advance before the next last-day or
    // dashboard poll. Once the final jackpot settles, move both the visible
    // rail and an old selected level forward immediately.
    this.#unsubs.push(subscribe('app.gameState', (gameState) => {
      const floorChanged = this.#reconcileLevelFloor(unresolvedTicketLevel(gameState));
      // Keep the value drop synchronous with the settlement signal; the
      // refetch below then replaces the old level's detail payload.
      this.#renderTotalValue();
      if (floorChanged) this.#refresh();
    }));
    this.#unsubs.push(subscribe('app.poolBenchmarks', (benchmarks) => {
      if (benchmarks?.contractPhase?.rngLocked !== true) return;
      const live = activeTicketLevel(
        get('app.gameState'),
        benchmarks.contractPhase,
      );
      if (this.#reconcileLevelFloor(live)) this.#refresh();
    }));
    // Account-switcher (2026-07-16): mode flips the data source; the merged
    // payload updates live as polling.js's combined-mode cycle refreshes.
    this.#unsubs.push(subscribe('ui.mode', () => this.#refresh()));
    this.#unsubs.push(subscribe('app.playerCombined', (payload) => {
      this.#combined = payload;
      if (get('ui.mode') === 'combined') this.#render();
    }));
    this.#pollHandle = registerComponentPoll(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        this.#refresh();
      }
    }, POLL_INTERVAL_MS);
    this.#refresh();
  }

  #reconcileLevelFloor(value) {
    const next = Number(value);
    if (!Number.isInteger(next) || next <= 0) return false;
    let changed = false;
    if (!Number.isInteger(Number(this.#activeLevel)) || next > Number(this.#activeLevel)) {
      this.#activeLevel = next;
      changed = true;
    }
    const floor = Number(this.#activeLevel);
    if (this.#viewLevel == null || Number(this.#viewLevel) < floor) {
      this.#viewLevel = floor;
      changed = true;
    }
    return changed;
  }

  disconnectedCallback() {
    this.#finishSalvageDrag({ commit: false });
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (typeof this.#pollHandle === 'function') {
      try { this.#pollHandle(); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#expandRenderTimer != null) {
      try { clearTimeout(this.#expandRenderTimer); } catch (_) { /* defensive */ }
      this.#expandRenderTimer = null;
    }
    if (this.#resizeObserver) {
      try { this.#resizeObserver.disconnect(); } catch (_) { /* defensive */ }
      this.#resizeObserver = null;
    }
    if (this.#visibilityListener && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_e) { /* defensive */ }
    }
    this.#visibilityListener = null;
  }

  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-tickets-inventory section-disclosure">
        <div class="panel-header inv-head section-disclosure__bar">
          <h2 class="section-disclosure__title">YOUR TICKETS</h2>
          <span class="inv-level-cluster">
            <span class="inv-meta" data-bind="inv-meta" hidden aria-hidden="true">—</span>
            <span class="inv-level-nav" data-bind="inv-level-tabs" role="group" aria-label="Ticket levels">
              ${[0, 1, 2, 3, 4].map((offset) => `
                <button type="button" class="inv-level-btn inv-level-tab"
                        data-bind="inv-level-tab" data-level-offset="${offset}"
                        aria-expanded="false" aria-controls="ticket-inventory-details">
                  <small data-bind="inv-level-tab-label">LEVEL —</small>
                  <strong data-bind="inv-level-tab-count">—</strong>
                </button>`).join('')}
              <button type="button" class="inv-level-btn inv-level-tab inv-level-tab--future"
                      data-bind="inv-level-future" aria-expanded="false"
                      aria-controls="ticket-inventory-details">
                <small>FUTURE</small>
                <strong data-bind="inv-level-future-count">—</strong>
              </button>
              <button type="button" class="inv-level-btn inv-total-value"
                      data-bind="inv-total-value-action"
                      aria-expanded="false" aria-controls="ticket-inventory-details"
                      title="Open Far Future holdings and Salvage Swap" disabled>
                <small class="inv-total-value__label"><span>TOTAL </span>VALUE</small>
                <strong data-bind="inv-total-value">—</strong>
              </button>
            </span>
            <span class="inv-level-state" hidden>Lv <b data-bind="inv-level">—</b> <span data-bind="inv-tag"></span></span>
          </span>
          <span class="inv-mode-toggle inv-expanded-control" hidden>
            <button type="button" class="inv-mode-btn is-active" data-bind="inv-mode-cards">Cards</button>
            <button type="button" class="inv-mode-btn" data-bind="inv-mode-chart">Chart</button>
          </span>
          <span class="inv-zoom-controls inv-expanded-control" aria-label="Ticket zoom" hidden>
            <button type="button" class="inv-view-btn" data-bind="inv-zoom-out" title="Zoom tickets out" aria-label="Zoom tickets out">−</button>
            <output class="inv-zoom-value" data-bind="inv-zoom-value" aria-live="polite">100%</output>
            <button type="button" class="inv-view-btn" data-bind="inv-zoom-in" title="Zoom tickets in" aria-label="Zoom tickets in">+</button>
          </span>
          <button type="button" class="inv-disclosure" data-bind="inv-toggle"
                  aria-expanded="false" aria-controls="ticket-inventory-details"
                  aria-label="Show ticket details" hidden>
            <span class="inv-disclosure__chevron section-disclosure__chevron" aria-hidden="true"></span>
          </button>
        </div>
        <div id="ticket-inventory-details" class="inv-window" data-bind="inv-window" hidden>
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
    const toggle = this.querySelector('[data-bind="inv-toggle"]');
    if (toggle) toggle.addEventListener('click', () => this.#toggleLegacyDisclosure(toggle));
    const totalValue = this.querySelector('[data-bind="inv-total-value-action"]');
    if (totalValue) totalValue.addEventListener('click', () => this.#openSalvage());
    for (const levelTab of this.querySelectorAll('[data-bind="inv-level-tab"]')) {
      levelTab.addEventListener('click', () => {
        // Bind the action to the level painted on this exact tile. The active
        // level can update while an async refresh is in flight; recomputing
        // from that mutable value made a still-visible L47 open another level.
        const target = Number(levelTab.getAttribute('data-ticket-level'));
        if (Number.isInteger(target) && target > 0) this.#toggleLevel(target, levelTab);
      });
    }
    const future = this.querySelector('[data-bind="inv-level-future"]');
    if (future) future.addEventListener('click', () => {
      const target = Number(future.getAttribute('data-ticket-level'));
      if (Number.isInteger(target) && target > 0) this.#toggleLevel(target, future);
    });
    const cardsBtn = this.querySelector('[data-bind="inv-mode-cards"]');
    if (cardsBtn) cardsBtn.addEventListener('click', () => this.#setMode('cards'));
    const chartBtn = this.querySelector('[data-bind="inv-mode-chart"]');
    if (chartBtn) chartBtn.addEventListener('click', () => this.#setMode('chart'));
    const cardsHost = this.querySelector('[data-bind="inv-cards"]');
    if (cardsHost) cardsHost.addEventListener('click', (event) => this.#copyTicket(event, cardsHost));
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

  #syncDisclosure() {
    const toggle = this.querySelector('[data-bind="inv-toggle"]');
    const combined = get('ui.mode') === 'combined';
    const panel = this.querySelector('.app-tickets-inventory');
    panel?.classList?.toggle('is-expanded', this.#expanded);
    panel?.classList?.toggle('is-combined', combined);
    if (toggle) {
      // Individual level tiles own disclosure in the normal inventory. Combined
      // mode has no level tile, so retain the shared chevron only there.
      toggle.hidden = !combined;
      toggle.setAttribute('aria-expanded', String(this.#expanded));
      toggle.setAttribute(
        'aria-label',
        this.#expanded ? 'Hide tickets owned' : 'Show tickets owned',
      );
      toggle.title = this.#expanded ? 'Hide tickets owned' : 'Show tickets owned';
    }
    for (const control of this.querySelectorAll?.('.inv-expanded-control') || []) {
      control.hidden = !this.#expanded;
    }
    const window = this.querySelector('[data-bind="inv-window"]');
    if (window) window.hidden = !this.#expanded;
  }

  #syncLevelControls() {
    if (get('ui.mode') === 'combined') this.#renderCombinedHeader();
    else this.#renderLevelTabs();
  }

  #cancelExpandedRender() {
    if (this.#expandRenderTimer != null) clearTimeout(this.#expandRenderTimer);
    this.#expandRenderTimer = null;
    for (const control of this.querySelectorAll?.('.inv-level-btn') || []) {
      control.removeAttribute?.('aria-busy');
    }
    this.querySelector('[data-bind="inv-toggle"]')?.removeAttribute?.('aria-busy');
  }

  #closeTicketDetails() {
    this.#expanded = false;
    this.#focusSalvageOnRender = false;
    this.#cancelExpandedRender();
    this.#syncDisclosure();
    this.#syncLevelControls();
  }

  #queueExpandedRender(trigger) {
    this.#cancelExpandedRender();
    // Building a large ticket grid is deferred one browser task. This lets the
    // selected level paint before the many ticket SVG nodes are constructed.
    trigger?.setAttribute?.('aria-busy', 'true');
    this.#expandRenderTimer = setTimeout(() => {
      this.#expandRenderTimer = null;
      if (this.#expanded) this.#render();
      trigger?.removeAttribute?.('aria-busy');
    }, 0);
  }

  #toggleLegacyDisclosure(trigger) {
    if (this.#expanded) {
      this.#closeTicketDetails();
      return;
    }
    this.#expanded = true;
    this.#syncDisclosure();
    this.#syncLevelControls();
    this.#queueExpandedRender(trigger);
  }

  #toggleLevel(level, trigger) {
    const target = Number(level);
    if (!Number.isInteger(target) || target <= 0) return;
    if (this.#expanded && target === Number(this.#viewLevel)) {
      this.#closeTicketDetails();
      return;
    }

    const changed = target !== Number(this.#viewLevel);
    const pending = changed ? this.#navLevel(target) : null;
    this.#expanded = true;
    this.#syncDisclosure();
    this.#syncLevelControls();

    if (!changed) {
      this.#queueExpandedRender(trigger);
      return;
    }
    trigger?.setAttribute?.('aria-busy', 'true');
    void Promise.resolve(pending)
      .finally(() => trigger?.removeAttribute?.('aria-busy'))
      .catch(() => {});
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
    if (lvl === this.#viewLevel) return Promise.resolve();
    this.#viewLevel = lvl;
    // Never let the prior level's payload render under the newly selected
    // label while its request is in flight.
    this.#data = null;
    this.#dataLevel = null;
    this.#dataRenderKey = 'empty';
    this.#cardsRenderKey = null;
    this.#chartRenderKey = null;
    this.#foilLines = [];
    return this.#refresh();
  }

  #openSalvage() {
    if (get('ui.mode') === 'combined' || this.#activeLevel == null || !this.#address) return;
    const longTermLevel = this.#activeLevel + FAR_FUTURE_OFFSET + 1;
    if (this.#expanded && this.#isFarFuture()) {
      this.#focusSalvageOnRender = true;
      this.#renderFarFuture();
      return;
    }
    this.#focusSalvageOnRender = true;
    this.#toggleLevel(
      longTermLevel,
      this.querySelector('[data-bind="inv-total-value-action"]'),
    );
  }

  #setMode(mode, { render = true } = {}) {
    this.#mode = mode;
    const ff = this.#isFarFuture();
    if (render && !ff) {
      if (mode === 'chart') {
        this.#renderChart();
        if (this.#deityPassSymbols.length > 0) {
          void this.#refreshDeityExpectedEntries(
            this.#fetchSeq,
            this.#viewLevel,
            this.#deityPassSymbols,
          );
        }
      } else {
        this.#renderCards();
      }
    }
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

  #copyTicket(event, host) {
    let wrap = event?.target || null;
    while (wrap && wrap !== host && !wrap.__invTicket) wrap = wrap.parentElement;
    const ticket = wrap?.__invTicket;
    if (!ticket || typeof document === 'undefined'
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
        traitIds: [...ticket.traitIds],
        level: this.#viewLevel,
        foil: ticket.foil,
      },
    }));
  }

  // ---------------------------------------------------------------------

  async #refresh() {
    // Account-switcher (2026-07-16): mode 'combined' has no single address to
    // fetch the by-trait/dashboard endpoints for — render the owner-tagged
    // list from app.playerCombined instead.
    if (get('ui.mode') === 'combined') {
      this.#address = null;
      this.#data = null;
      this.#dataLevel = null;
      this.#deityPassSymbols = [];
      this.#deityExpectedEntries = new Map();
      this.#deityExpectedScope = '';
      this.#deityExpectedLoading = '';
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
          const gs = await readGameState();
          if (seq !== this.#fetchSeq) return;
          // Contract port (app/active-level.js) — NOT the raw game_state level,
          // and not the `jackpotPhase ? level : level + 1` shorthand this used
          // to inline, which lags by one level in the sealed window at the end
          // of a jackpot phase.
          const active = activeTicketLevel(
            gs,
            get('app.poolBenchmarks')?.contractPhase,
          );
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
      this.#dataLevel = null;
      this.#dataRenderKey = 'empty';
      this.#foilLines = [];
      this.#holdings = [];
      this.#holdingsAddress = null;
      this.#holdingsLoaded = false;
      this.#resetSalvageState();
      this.#deityPassSymbols = [];
      this.#deityExpectedEntries = new Map();
      this.#deityExpectedScope = '';
      this.#deityExpectedLoading = '';
      this.#render();
      return;
    }
    const lower = String(addr).toLowerCase();
    if (this.#holdingsAddress !== lower) {
      this.#holdings = [];
      this.#holdingsAddress = lower;
      this.#holdingsLoaded = false;
      this.#resetSalvageState();
      this.#renderTotalValue();
    }
    const day = Number(get('app.lastDay')?.day);
    const [byTrait, dashboard, foil, playerDay, deityCatalog, salvageQueue] = await Promise.allSettled([
      // NO day param (tickets-fetch.js gotcha — see file header). Skipped in
      // far-future view — those levels can't have rolled traits yet.
      this.#isFarFuture()
        ? Promise.resolve(null)
        : fetchJSON(`/player/${lower}/tickets/by-trait?level=${lvl}`),
      // Per-level entry counts for the far-future long-term view.
      fetchJSON(`/player/${lower}`),
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
      // Persistent ownership comes from the soulbound NFT. The viewer endpoint
      // above contains only purchases made on the selected day and therefore
      // cannot tell us whether a pass bought earlier is still in inventory.
      readDeityPassCatalog(),
      // Exact ticketQueue positions are necessary only for a full salvage
      // liquidation, so keep this indexed read scoped to the long-term view.
      this.#isFarFuture()
        ? fetchJSON(`/player/${lower}/far-future-queue`)
        : Promise.resolve(null),
    ]);
    if (seq !== this.#fetchSeq) return;
    this.#data = byTrait.status === 'fulfilled' ? byTrait.value : null;
    this.#dataLevel = Number(lvl);
    this.#dataRenderKey = _inventoryPayloadFingerprint(this.#data);
    this.#foilLines = _foilLines(foil.status === 'fulfilled' ? foil.value : null);
    const deityRows = playerDay.status === 'fulfilled'
      && Array.isArray(playerDay.value?.store?.deityPassPurchases)
      ? playerDay.value.store.deityPassPurchases
      : [];
    const ownedFromNft = deityCatalog.status === 'fulfilled'
      && deityCatalog.value?.ownersBySymbol instanceof Map
      ? [...deityCatalog.value.ownersBySymbol.entries()]
        .filter(([, owner]) => String(owner || '').toLowerCase() === lower)
        .map(([symbolId]) => Number(symbolId))
      : [];
    // A same-day purchase remains a useful soft fallback during a transient
    // RPC failure, but it never replaces the persistent NFT ownership read.
    const ownedFromToday = deityRows.map((row) => Number(row?.symbolId));
    this.#deityPassSymbols = [...new Set([...ownedFromNft, ...ownedFromToday]
      .filter((symbolId) => Number.isInteger(symbolId) && symbolId >= 0 && symbolId < 32))]
      .sort((a, b) => a - b);
    const deityScope = `${lower}:${lvl}:${this.#deityPassSymbols.join(',')}`;
    if (deityScope !== this.#deityExpectedScope) {
      this.#deityExpectedScope = deityScope;
      this.#deityExpectedEntries = new Map();
      this.#deityExpectedLoading = '';
    }
    if (dashboard.status === 'fulfilled' && Array.isArray(dashboard.value?.tickets)) {
      this.#holdings = dashboard.value.tickets
        .map((t) => {
          const entryCount = Math.max(0, Math.floor(Number(t?.entryCount ?? 0)));
          return {
            level: Number(t?.level),
            entryCount,
            wholeTickets: Math.floor(entryCount / ENTRIES_PER_CARD),
          };
        })
        .filter((t) => Number.isInteger(t.level) && t.entryCount > 0);
      this.#holdingsLoaded = true;
    } else {
      // A newly deployed player can already own plenty of tickets while the
      // dashboard route still returns 404 because its materialized player row
      // has not appeared. Reconstruct the same aggregate from the two ticket
      // projections that do not require that summary row.
      const floor = this.#unresolvedLevelFloor();
      if (floor != null) {
        try {
          const fallback = await readTicketHoldingsFallback({
            address: lower,
            unresolvedLevel: floor,
            knownLevel: lvl,
            knownPayload: this.#data,
          });
          if (seq !== this.#fetchSeq) return;
          if (Array.isArray(fallback)) {
            this.#holdings = fallback;
            this.#holdingsLoaded = true;
          }
        } catch (_e) {
          // Preserve a prior good aggregate on a transient endpoint failure;
          // a first-load miss remains the honest em dash and retries next poll.
        }
      }
    }
    if (this.#isFarFuture() && salvageQueue.status === 'fulfilled'
      && Array.isArray(salvageQueue.value?.rows)) {
      this.#salvageQueue = salvageQueue.value.rows
        .map((row) => ({
          level: Number(row?.level),
          queueIndex: Number(row?.queueIndex),
          entryCount: Math.max(0, Math.floor(Number(row?.entryCount ?? 0))),
          remainder: Math.max(0, Math.floor(Number(row?.remainder ?? 0))),
        }))
        .filter((row) => Number.isInteger(row.level)
          && Number.isInteger(row.queueIndex)
          && row.queueIndex >= 0
          && row.entryCount > 0);
      this.#salvageQueueLoaded = true;
      this.#reconcileSalvageSelection();
    } else if (this.#isFarFuture()) {
      this.#salvageQueueLoaded = false;
      // Holdings still support selection + preview. Preserve any live offer;
      // only a full liquidation has to wait for the exact queue position.
      if (!this.#salvageQuote && this.#salvageSelection.size === 0) {
        this.#salvageMessage = 'Queue positions are indexing; offers are available now.';
      }
    }
    if (this.#isFarFuture()) this.#reconcileSalvageSelection();
    this.#render();
    // Virtual Deity counts are chart-only. Avoid eight eth_calls on every
    // cards-view poll; selecting Chart fetches them immediately and a visible
    // Chart refreshes them on its normal minute cadence.
    if (!this.#isFarFuture() && this.#mode === 'chart' && this.#deityPassSymbols.length > 0) {
      void this.#refreshDeityExpectedEntries(seq, lvl, this.#deityPassSymbols);
    }
  }

  async #refreshDeityExpectedEntries(seq, level, symbolIds) {
    const scope = `${String(this.#address || '').toLowerCase()}:${Number(level)}:${symbolIds.join(',')}`;
    const requestKey = `${seq}:${scope}`;
    if (this.#deityExpectedLoading === requestKey) return;
    this.#deityExpectedLoading = requestKey;
    let expected;
    try {
      expected = await readDeityExpectedEntries(level, symbolIds);
    } catch (_e) {
      expected = new Map();
    }
    if (this.#deityExpectedLoading === requestKey) this.#deityExpectedLoading = '';
    if (seq !== this.#fetchSeq || Number(level) !== Number(this.#viewLevel)
      || scope !== this.#deityExpectedScope || this.#mode !== 'chart') return;
    this.#deityExpectedEntries = expected;
    this.#renderChart();
  }

  // Far-future = beyond the last level that can have rolled traits.
  #isFarFuture() {
    return this.#viewLevel != null
      && this.#activeLevel != null
      && this.#viewLevel > this.#activeLevel + FAR_FUTURE_OFFSET;
  }

  #resetSalvageState() {
    this.#finishSalvageDrag({ commit: false });
    this.#salvageQueue = [];
    this.#salvageQueueLoaded = false;
    this.#salvageSelection.clear();
    this.#salvageQuote = null;
    this.#salvageQuoteLoading = false;
    this.#salvageQuoteSeq += 1;
    this.#salvageArmed = false;
    this.#salvageBusy = false;
    this.#salvageMessage = '';
    this.#salvageError = '';
  }

  #salvageEligibleRows() {
    if (this.#activeLevel == null) return [];
    const min = this.#activeLevel + SALVAGE_MIN_DISTANCE;
    const max = this.#activeLevel + SALVAGE_MAX_DISTANCE;
    // Holdings are enough to select and quote a bundle. The queue projection
    // adds the O(1) index required only when execution empties a level. Keeping
    // those concerns separate means an API/indexer lag can never turn owned
    // tickets into an inert, unselectable list.
    const byLevel = new Map();
    for (const row of this.#holdings) {
      const level = Number(row?.level);
      const entryCount = Math.max(0, Math.floor(Number(row?.entryCount ?? 0)));
      const wholeTickets = Math.floor(entryCount / ENTRIES_PER_CARD);
      if (level < min || level > max || wholeTickets <= 0) continue;
      byLevel.set(level, {
        level,
        entryCount,
        wholeTickets,
        queueIndex: null,
        remainder: null,
        queueExact: false,
      });
    }
    for (const row of this.#salvageQueue) {
      const level = Number(row?.level);
      const entryCount = Math.max(0, Math.floor(Number(row?.entryCount ?? 0)));
      const wholeTickets = Math.floor(entryCount / ENTRIES_PER_CARD);
      if (level < min || level > max || wholeTickets <= 0) continue;
      byLevel.set(level, {
        level,
        entryCount,
        wholeTickets,
        queueIndex: Number(row.queueIndex),
        remainder: Math.max(0, Math.floor(Number(row.remainder ?? 0))),
        queueExact: true,
      });
    }
    return [...byLevel.values()].sort((a, b) => a.level - b.level);
  }

  #reconcileSalvageSelection() {
    const eligible = new Map(this.#salvageEligibleRows().map((row) => [row.level, row]));
    let changed = false;
    for (const [level, quantity] of [...this.#salvageSelection.entries()]) {
      const max = eligible.get(level)?.wholeTickets ?? 0;
      const next = Math.max(0, Math.min(max, Math.floor(Number(quantity) || 0)));
      if (next === 0) {
        this.#salvageSelection.delete(level);
        changed = true;
      } else if (next !== quantity) {
        this.#salvageSelection.set(level, next);
        changed = true;
      }
    }
    if (changed) this.#invalidateSalvageQuote();
  }

  #selectedSalvageLines() {
    const byLevel = new Map(this.#salvageEligibleRows().map((row) => [row.level, row]));
    return [...this.#salvageSelection.entries()]
      .map(([level, ticketQuantity]) => {
        const row = byLevel.get(Number(level));
        const tickets = Math.max(0, Math.min(
          row?.wholeTickets ?? 0,
          Math.floor(Number(ticketQuantity) || 0),
        ));
        return row && tickets > 0 ? {
          level: row.level,
          ticketQuantity: tickets,
          entryQuantity: tickets * ENTRIES_PER_CARD,
          queueIndex: row.queueIndex,
          wholeTickets: row.wholeTickets,
          remainder: row.remainder,
          queueExact: row.queueExact,
        } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.level - b.level)
      .slice(0, SALVAGE_MAX_LINES);
  }

  #salvageMissingQueueLevels(lines = this.#selectedSalvageLines()) {
    return lines
      .filter((line) => line.ticketQuantity === line.wholeTickets
        && !line.queueExact)
      .map((line) => line.level);
  }

  #invalidateSalvageQuote() {
    this.#salvageQuoteSeq += 1;
    this.#salvageQuote = null;
    this.#salvageQuoteLoading = false;
    this.#salvageArmed = false;
  }

  #setSalvageQuantity(level, quantity) {
    const row = this.#salvageEligibleRows().find((candidate) => candidate.level === Number(level));
    if (!row) return;
    const next = Math.max(0, Math.min(row.wholeTickets, Math.floor(Number(quantity) || 0)));
    const adding = next > 0 && !this.#salvageSelection.has(row.level);
    if (adding && this.#salvageSelection.size >= SALVAGE_MAX_LINES) {
      this.#salvageError = `Choose up to ${SALVAGE_MAX_LINES} levels per swap.`;
      this.#renderFarFuture();
      return;
    }
    if (next > 0) this.#salvageSelection.set(row.level, next);
    else this.#salvageSelection.delete(row.level);
    this.#salvageMessage = '';
    this.#salvageError = '';
    this.#invalidateSalvageQuote();
    this.#renderFarFuture();
    void this.#loadSalvageQuote();
  }

  #salvageDragStartedOnControl(event) {
    const tag = String(event?.target?.tagName || '').toUpperCase();
    if (['INPUT', 'BUTTON', 'A', 'LABEL'].includes(tag)) return true;
    return Boolean(event?.target?.closest?.('.inv-ff__qty'));
  }

  #beginSalvageDrag(event, row, salvage) {
    if (!salvage || this.#salvageBusy || this.#salvageDragStartedOnControl(event)) return;
    if (event?.button != null && event.button !== 0) return;
    // Touch keeps native vertical scrolling; the checkbox remains its clear
    // tap target. Mouse and pen get the faster paint-across interaction.
    if (event?.pointerType === 'touch') return;
    this.#finishSalvageDrag({ commit: false });
    this.#salvageDrag = {
      select: !this.#salvageSelection.has(salvage.level),
      visited: new Set(),
      changed: false,
    };
    try { event?.preventDefault?.(); } catch (_e) { /* fake DOM */ }
    this.#paintSalvageDragRow(row, salvage);
    this.#salvageDragStop = () => this.#finishSalvageDrag();
    document.addEventListener?.('pointerup', this.#salvageDragStop);
    document.addEventListener?.('pointercancel', this.#salvageDragStop);
  }

  #paintSalvageDragRow(row, salvage) {
    const drag = this.#salvageDrag;
    if (!drag || !salvage || drag.visited.has(salvage.level)) return;
    drag.visited.add(salvage.level);
    const selected = this.#salvageSelection.has(salvage.level);
    if (drag.select === selected) return;
    if (drag.select && this.#salvageSelection.size >= SALVAGE_MAX_LINES) {
      this.#salvageError = `Choose up to ${SALVAGE_MAX_LINES} levels per swap.`;
      return;
    }
    if (!drag.changed) this.#invalidateSalvageQuote();
    drag.changed = true;
    if (drag.select) this.#salvageSelection.set(salvage.level, salvage.wholeTickets);
    else this.#salvageSelection.delete(salvage.level);
    row?.classList?.toggle('is-selected', drag.select);
    row?.setAttribute?.('aria-checked', String(drag.select));
    const pick = row?.querySelector?.('.inv-ff__pick');
    const quantity = row?.querySelector?.('.inv-ff__qty input');
    if (pick) pick.checked = drag.select;
    if (quantity) quantity.value = drag.select ? String(salvage.wholeTickets) : '0';
  }

  #continueSalvageDrag(event, row, salvage) {
    if (!this.#salvageDrag) return;
    if (event?.buttons === 0) {
      this.#finishSalvageDrag();
      return;
    }
    this.#paintSalvageDragRow(row, salvage);
  }

  #finishSalvageDrag({ commit = true } = {}) {
    const drag = this.#salvageDrag;
    if (this.#salvageDragStop) {
      document.removeEventListener?.('pointerup', this.#salvageDragStop);
      document.removeEventListener?.('pointercancel', this.#salvageDragStop);
    }
    this.#salvageDragStop = null;
    this.#salvageDrag = null;
    if (!commit || !drag?.changed) return;
    this.#salvageMessage = '';
    if (!this.#salvageError.startsWith('Choose up to ')) this.#salvageError = '';
    this.#renderFarFuture();
    void this.#loadSalvageQuote();
  }

  #toggleAllSalvage() {
    const rows = this.#salvageEligibleRows().slice(0, SALVAGE_MAX_LINES);
    if (this.#salvageSelection.size > 0) {
      this.#salvageSelection.clear();
    } else {
      for (const row of rows) this.#salvageSelection.set(row.level, row.wholeTickets);
    }
    this.#salvageMessage = '';
    this.#salvageError = '';
    this.#invalidateSalvageQuote();
    this.#renderFarFuture();
    void this.#loadSalvageQuote();
  }

  async #loadSalvageQuote() {
    const lines = this.#selectedSalvageLines();
    if (!this.#address || lines.length === 0) return;
    const seq = ++this.#salvageQuoteSeq;
    this.#salvageQuoteLoading = true;
    this.#salvageError = '';
    this.#renderFarFuture();
    try {
      const quote = await previewFarFutureSalvage({
        player: this.#address,
        levels: lines.map((line) => line.level),
        quantities: lines.map((line) => line.entryQuantity),
      });
      if (seq !== this.#salvageQuoteSeq) return;
      this.#salvageQuote = quote;
    } catch (error) {
      if (seq !== this.#salvageQuoteSeq) return;
      this.#salvageQuote = null;
      this.#salvageError = compactUiError(error, 'Could not load the salvage offer.');
    } finally {
      if (seq === this.#salvageQuoteSeq) {
        this.#salvageQuoteLoading = false;
        this.#renderFarFuture();
      }
    }
  }

  #salvageMinimumMet() {
    if (!this.#salvageQuote || this.#activeLevel == null) return false;
    return this.#salvageQuote.totalBudget >= scaledTicketPriceWei(this.#activeLevel) / 4n;
  }

  async #activateSalvage() {
    const lines = this.#selectedSalvageLines();
    if (this.#salvageBusy || !this.#salvageQuote || !this.#salvageMinimumMet()
      || lines.length === 0) return;
    if (!deriveCanSign()) {
      this.#salvageError = 'Connect your wallet to salvage tickets.';
      this.#renderFarFuture();
      return;
    }
    const missingQueue = this.#salvageMissingQueueLevels(lines);
    if (missingQueue.length > 0) {
      this.#salvageError = `Queue position still indexing for level${missingQueue.length === 1 ? '' : 's'} ${missingQueue.join(', ')}. You can quote now; wait to sell the full balance or enter a smaller quantity.`;
      this.#renderFarFuture();
      return;
    }
    if (!this.#salvageArmed) {
      this.#salvageArmed = true;
      this.#salvageMessage = 'Review the payout, then confirm the swap.';
      this.#renderFarFuture();
      return;
    }

    this.#salvageBusy = true;
    this.#salvageMessage = 'Confirm in your wallet…';
    this.#salvageError = '';
    this.#renderFarFuture();
    try {
      const { receipt } = await sellFarFutureSalvage({
        player: this.#address,
        levels: lines.map((line) => line.level),
        quantities: lines.map((line) => line.entryQuantity),
        // Partial lines never consume the index; zero is a safe placeholder.
        queueIndices: lines.map((line) => line.queueIndex ?? 0),
      });
      this.#salvageSelection.clear();
      this.#salvageQuote = null;
      this.#salvageArmed = false;
      this.#salvageMessage = 'Salvage complete — tickets and payouts added.';
      try {
        this.dispatchEvent(new CustomEvent('app-salvage:tx-confirmed', {
          detail: { receipt, levels: lines.map((line) => line.level) },
          bubbles: true,
        }));
      } catch (_e) { /* fakeDOM */ }
      setTimeout(() => this.#refresh(), 250);
    } catch (error) {
      this.#salvageArmed = false;
      this.#salvageMessage = '';
      this.#salvageError = compactUiError(error, 'Salvage did not go through. Refresh and try again.');
    } finally {
      this.#salvageBusy = false;
      this.#renderFarFuture();
    }
  }

  // ---------------------------------------------------------------------

  #renderLevelTabs() {
    const tabs = this.querySelector('[data-bind="inv-level-tabs"]');
    if (!tabs) return;
    tabs.hidden = false;
    tabs.classList?.remove('is-total-only');

    const active = Number(this.#activeLevel);
    const hasActive = Number.isInteger(active) && active > 0;
    const entriesByLevel = new Map();
    for (const row of this.#holdings) {
      const level = Number(row?.level);
      const entries = Math.max(0, Math.floor(Number(row?.entryCount ?? 0)));
      if (!Number.isInteger(level) || entries <= 0) continue;
      entriesByLevel.set(level, Math.max(entries, entriesByLevel.get(level) || 0));
    }
    if (!this.#isFarFuture()
      && this.#viewLevel != null
      && Number(this.#dataLevel) === Number(this.#viewLevel)
      && this.#data) {
      const entries = Math.max(0, Math.floor(Number(this.#data.totalEntries ?? 0)));
      const level = Number(this.#viewLevel);
      // max() tolerates endpoint skew and retains real quarter-ticket entries
      // while their traits finish indexing.
      entriesByLevel.set(level, Math.max(entries, entriesByLevel.get(level) || 0));
    }

    const levelButtons = [...this.querySelectorAll('[data-bind="inv-level-tab"]')];
    const levelLabels = [...this.querySelectorAll('[data-bind="inv-level-tab-label"]')];
    const levelCounts = [...this.querySelectorAll('[data-bind="inv-level-tab-count"]')];
    for (const [index, button] of levelButtons.entries()) {
      const offset = Number(button.getAttribute('data-level-offset'));
      const level = hasActive && Number.isInteger(offset) ? active + offset : null;
      const label = levelLabels[index];
      const count = levelCounts[index];
      const selected = this.#expanded
        && level != null
        && !this.#isFarFuture()
        && level === Number(this.#viewLevel);
      const entries = level == null ? 0 : entriesByLevel.get(level) || 0;
      const quantity = this.#holdingsLoaded || (level != null && level === Number(this.#viewLevel) && this.#data)
        ? formatTicketEntryQuantity(entries)
        : '—';

      if (label) {
        label.textContent = level == null ? 'LEVEL —' : `LEVEL ${level}`;
        applyTicketLevelTone(label, level, hasActive ? active : null);
      }
      if (count) count.textContent = quantity;
      applyTicketLevelTone(button, level, hasActive ? active : null);
      button.disabled = level == null;
      if (level == null) button.removeAttribute('data-ticket-level');
      else button.setAttribute('data-ticket-level', String(level));
      button.classList?.toggle('is-active', selected);
      button.classList?.toggle('is-empty', quantity !== '—' && entries === 0);
      button.setAttribute('aria-expanded', String(selected));
      button.setAttribute(
        'aria-label',
        level == null
          ? 'Ticket level loading'
          : `Level ${level}, ${quantity === '—' ? 'ticket count loading' : formatTicketEntryHoldings(entries) + ' owned'}`,
      );
      button.title = button.getAttribute('aria-label');
    }

    const future = this.querySelector('[data-bind="inv-level-future"]');
    const futureCount = this.querySelector('[data-bind="inv-level-future-count"]');
    if (future) {
      const start = hasActive ? active + FAR_FUTURE_OFFSET + 1 : null;
      const end = hasActive ? active + FAR_FUTURE_SPAN : null;
      const entries = start == null ? 0 : [...entriesByLevel.entries()]
        .filter(([level]) => level >= start && level <= end)
        .reduce((sum, [, count]) => sum + count, 0);
      const quantity = this.#holdingsLoaded ? formatTicketEntryQuantity(entries) : '—';
      const selected = hasActive && this.#expanded && this.#isFarFuture();
      if (futureCount) futureCount.textContent = quantity;
      applyTicketLevelTone(future, start, hasActive ? active : null);
      future.disabled = !hasActive;
      if (start == null) future.removeAttribute('data-ticket-level');
      else future.setAttribute('data-ticket-level', String(start));
      future.classList?.toggle('is-active', selected);
      future.classList?.toggle('is-empty', quantity !== '—' && entries === 0);
      future.setAttribute('aria-expanded', String(selected));
      future.setAttribute(
        'aria-label',
        start == null
          ? 'Future ticket levels loading'
          : `Future levels ${start} through ${end}, ${quantity === '—' ? 'ticket count loading' : formatTicketEntryHoldings(entries) + ' owned'}`,
      );
      future.title = future.getAttribute('aria-label');
    }
    const totalValue = this.querySelector('[data-bind="inv-total-value-action"]');
    if (totalValue) {
      totalValue.disabled = !this.#address || !hasActive;
      const open = hasActive && this.#expanded && this.#isFarFuture();
      totalValue.classList?.toggle('is-open', open);
      totalValue.setAttribute('aria-expanded', String(open));
      totalValue.setAttribute(
        'aria-label',
        totalValue.disabled
          ? 'Ticket total value loading'
          : 'Open Far Future holdings and Salvage Swap',
      );
    }
  }

  #renderHeader() {
    this.#renderTotalValue();
    const levelEl = this.querySelector('[data-bind="inv-level"]');
    if (levelEl) {
      levelEl.textContent = this.#viewLevel == null ? '—' : String(this.#viewLevel);
      applyTicketLevelTone(levelEl, this.#viewLevel, this.#activeLevel);
    }
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
    this.#renderLevelTabs();
    const meta = this.querySelector('[data-bind="inv-meta"]');
    if (meta) {
      if (this.#isFarFuture()) {
        const lo = this.#activeLevel + 1;
        const hi = this.#activeLevel + FAR_FUTURE_SPAN;
        const totalEntries = this.#holdings
          .filter((row) => row.level >= lo && row.level <= hi)
          .reduce((sum, row) => sum + row.entryCount, 0);
        meta.textContent = this.#holdingsLoaded
          ? `${formatTicketEntryHoldings(totalEntries)} · long term`
          : 'Loading tickets…';
      } else {
        const dataIsCurrent = Number(this.#dataLevel) === Number(this.#viewLevel);
        const d = dataIsCurrent ? this.#data : null;
        if (!dataIsCurrent) {
          meta.textContent = this.#address ? 'Loading tickets…' : 'Pick a player to see tickets.';
        } else if (!d) {
          meta.textContent = this.#address ? '0 tickets' : 'Pick a player to see tickets.';
        } else {
          const totalEntries = Math.max(0, Math.floor(Number(d.totalEntries || 0)));
          const pending = (Array.isArray(d.cards) ? d.cards : [])
            .filter((c) => c && c.status === 'pending').length;
          meta.textContent = formatTicketEntryHoldings(totalEntries)
            + (pending ? ` · ${pending} pending` : '');
        }
      }
    }
  }

  #unresolvedLevelFloor() {
    const gameState = get('app.gameState');
    const stateLevel = unresolvedTicketLevel(gameState);
    const candidates = [this.#activeLevel, stateLevel]
      .map(Number)
      .filter((level) => Number.isInteger(level) && level >= 0);
    return candidates.length > 0 ? Math.max(...candidates) : null;
  }

  #renderTotalValue(rowsOverride = null) {
    const output = this.querySelector('[data-bind="inv-total-value"]');
    if (!output) return;

    const combined = get('ui.mode') === 'combined';
    const rows = rowsOverride ?? (combined ? this.#combined?.tickets : this.#holdings);
    const loaded = combined
      ? Boolean(this.#combined && Array.isArray(rows))
      : Boolean(this.#address && this.#holdingsLoaded);
    if (!loaded) {
      output.textContent = '—';
      return;
    }

    const gameState = get('app.gameState');
    if (gameState?.gameOver === true) {
      output.textContent = `${formatTicketTotalValueEth(0n)} ETH`;
      return;
    }
    const floor = this.#unresolvedLevelFloor();
    if (floor == null) {
      output.textContent = '—';
      return;
    }
    output.textContent = `${formatTicketTotalValueEth(unresolvedTicketFaceValueWei(rows, floor))} ETH`;
  }

  #render() {
    if (get('ui.mode') === 'combined') {
      this.#renderTotalValue(
        Array.isArray(this.#combined?.tickets) ? this.#combined.tickets : [],
      );
      this.#renderCombinedHeader();
      this.#syncDisclosure();
      if (!this.#expanded || this.#expandRenderTimer != null) return;
      this.#renderCombinedView();
      return;
    }
    // Leaving combined mode — re-hide the combined-view host (it only shows
    // itself; nothing else re-hides it when mode flips back).
    const combinedHost = this.querySelector('[data-bind="inv-combined"]');
    if (combinedHost) combinedHost.hidden = true;
    this.#renderHeader();
    this.#syncDisclosure();
    // Do not construct any badge <img> nodes until the player asks for the
    // detail. This is materially lighter than merely hiding a prebuilt SVG
    // grid, especially for large inventories on phones.
    if (!this.#expanded || this.#expandRenderTimer != null) return;
    if (this.#isFarFuture()) this.#renderFarFuture();
    else if (this.#mode === 'chart') this.#renderChart();
    else this.#renderCards();
    this.#setMode(this.#mode, { render: false });  // re-assert visibility after rebuild
  }

  // ---------------------------------------------------------------------
  // Account-switcher (2026-07-16) — combined-mode view. app.playerCombined's
  // tickets[] is the simple {level, entryCount, owner} shape from combine.js
  // (CONCAT + owner tag) — no by-trait detail exists for a combined set of
  // addresses (the /tickets/by-trait endpoint is single-address only), so
  // this renders a level + owner-tagged list instead of the cards/chart UI.
  // ---------------------------------------------------------------------

  #renderCombinedHeader() {
    const levelEl = this.querySelector('[data-bind="inv-level"]');
    const tagEl = this.querySelector('[data-bind="inv-tag"]');
    if (levelEl) {
      levelEl.textContent = 'ALL';
      applyTicketLevelTone(levelEl, null, this.#activeLevel);
    }
    if (tagEl) tagEl.textContent = 'combined';
    const tabs = this.querySelector('[data-bind="inv-level-tabs"]');
    if (tabs) {
      tabs.hidden = false;
      tabs.classList?.add('is-total-only');
    }
    const totalValue = this.querySelector('[data-bind="inv-total-value-action"]');
    if (totalValue) {
      totalValue.disabled = true;
      totalValue.classList?.remove('is-open');
      totalValue.setAttribute('aria-expanded', 'false');
      totalValue.setAttribute('aria-label', 'Combined ticket total value');
    }

    const rows = (Array.isArray(this.#combined?.tickets) ? this.#combined.tickets : [])
      .map((r) => ({
        level: Number(r?.level),
        entryCount: Math.max(0, Math.floor(Number(r?.entryCount || 0))),
        owner: r?.owner,
      }))
      .filter((r) => Number.isFinite(r.level) && r.entryCount > 0)
      .sort((a, b) => a.level - b.level || String(a.owner).localeCompare(String(b.owner)));
    const addrCount = Array.isArray(this.#combined?.addresses) ? this.#combined.addresses.length : 0;
    const meta = this.querySelector('[data-bind="inv-meta"]');
    if (meta) {
      if (rows.length === 0) {
        meta.textContent = addrCount > 0
          ? `No tickets across ${addrCount} combined accounts.`
          : 'No tickets across the combined accounts.';
      } else {
        const totalEntries = rows.reduce((sum, row) => sum + row.entryCount, 0);
        meta.textContent = `${formatTicketEntryHoldings(totalEntries)} across ${addrCount} account${addrCount === 1 ? '' : 's'}`;
      }
    }
    return { rows, addrCount };
  }

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

    const rawRows = Array.isArray(this.#combined?.tickets) ? this.#combined.tickets : [];
    this.#renderTotalValue(rawRows);
    const { rows: withEntries, addrCount } = this.#renderCombinedHeader();

    if (withEntries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'inv-empty';
      empty.textContent = 'No tickets across the combined accounts.';
      combinedHost.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'inv-combined-rows';
    for (const r of withEntries) {
      const row = document.createElement('div');
      row.className = 'inv-combined-row';
      const lvl = document.createElement('span');
      lvl.className = 'inv-combined-level';
      lvl.textContent = `L${r.level}`;
      // Combined mode returns from #refresh before the single-account
      // #activeLevel bootstrap. Let the shared helper read the authoritative
      // roll1.purchaseLevel (or app.gameState fallback) directly from store.
      applyTicketLevelTone(lvl, r.level);
      row.appendChild(lvl);
      const count = document.createElement('span');
      count.className = 'inv-combined-count';
      count.textContent = formatTicketEntryHoldings(r.entryCount);
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
  // (active+1 .. active+FAR_FUTURE_SPAN). The indexed queue mirror replaces
  // dashboard counts where available and supplies the exact salvage position.
  #renderFarFuture() {
    const host = this.querySelector('[data-bind="inv-ff"]');
    if (!host) return;
    host.textContent = '';
    if (!this.#isFarFuture()) return;

    const lo = this.#activeLevel + 1;
    const hi = this.#activeLevel + FAR_FUTURE_SPAN;
    const byLevel = new Map(this.#holdings
      .filter((t) => t.level >= lo && t.level <= hi && t.entryCount > 0)
      .map((row) => [row.level, { ...row }]));
    if (this.#salvageQueueLoaded) {
      for (const queueRow of this.#salvageQueue) {
        if (queueRow.level < lo || queueRow.level > hi) continue;
        const wholeTickets = Math.floor(queueRow.entryCount / ENTRIES_PER_CARD);
        if (queueRow.entryCount <= 0) continue;
        byLevel.set(queueRow.level, {
          level: queueRow.level,
          entryCount: queueRow.entryCount,
          wholeTickets,
        });
      }
    }
    const rows = [...byLevel.values()].sort((a, b) => a.level - b.level);
    const salvageByLevel = new Map(this.#salvageEligibleRows().map((row) => [row.level, row]));

    const totalEntries = rows.reduce((sum, row) => sum + row.entryCount, 0);
    const head = document.createElement('div');
    head.className = 'inv-ff__total';
    const headCopy = document.createElement('strong');
    headCopy.textContent = totalEntries > 0
      ? `${formatTicketEntryHoldings(totalEntries)} owed across ${rows.length} future level${rows.length === 1 ? '' : 's'} (through level ${hi})`
      : `No far-future tickets held (levels ${lo}–${hi}).`;
    head.appendChild(headCopy);
    if (salvageByLevel.size > 0) {
      const dragHint = document.createElement('span');
      dragHint.textContent = 'DRAG ACROSS LEVELS TO SELECT';
      head.appendChild(dragHint);
    }
    host.appendChild(head);

    if (rows.length > 0) {
      const list = document.createElement('div');
      list.className = 'inv-ff__rows';
      for (const t of rows) {
        const row = document.createElement('div');
        row.className = 'inv-ff__row';
        if (t.level === this.#viewLevel) row.classList.add('is-viewed');
        const salvage = salvageByLevel.get(t.level);
        const selected = this.#salvageSelection.get(t.level) || 0;
        if (salvage) {
          row.classList.add('is-salvageable');
          row.setAttribute('role', 'checkbox');
          row.setAttribute('tabindex', '0');
          row.setAttribute('aria-checked', String(selected > 0));
          row.setAttribute(
            'aria-label',
            `Level ${t.level}, ${formatTicketEntryHoldings(t.entryCount)}. Drag or press Space to select for salvage.`,
          );
          row.addEventListener('pointerdown', (event) => this.#beginSalvageDrag(event, row, salvage));
          row.addEventListener('pointerenter', (event) => this.#continueSalvageDrag(event, row, salvage));
          row.addEventListener('pointerup', () => this.#finishSalvageDrag());
          row.addEventListener('keydown', (event) => {
            if (event?.key !== ' ' && event?.key !== 'Enter') return;
            try { event.preventDefault(); } catch (_e) { /* fake DOM */ }
            this.#setSalvageQuantity(t.level, selected > 0 ? 0 : salvage.wholeTickets);
          });
        }
        if (selected > 0) row.classList.add('is-selected');

        if (salvage) {
          const pick = document.createElement('input');
          pick.className = 'inv-ff__pick';
          pick.type = 'checkbox';
          pick.checked = selected > 0;
          pick.disabled = this.#salvageBusy;
          pick.setAttribute('aria-label', `Select level ${t.level} for salvage`);
          pick.addEventListener('change', () => {
            this.#setSalvageQuantity(t.level, pick.checked ? salvage.wholeTickets : 0);
          });
          row.appendChild(pick);
        }
        const lvl = document.createElement('span');
        lvl.className = 'inv-ff__level';
        lvl.textContent = `L${t.level}`;
        applyTicketLevelTone(lvl, t.level, this.#activeLevel);
        row.appendChild(lvl);
        const count = document.createElement('span');
        count.className = 'inv-ff__count';
        count.textContent = formatTicketEntryHoldings(t.entryCount);
        row.appendChild(count);

        if (salvage) {
          const qty = document.createElement('label');
          qty.className = 'inv-ff__qty';
          const qtyLabel = document.createElement('span');
          qtyLabel.textContent = 'SELL';
          qty.appendChild(qtyLabel);
          const input = document.createElement('input');
          input.type = 'number';
          input.min = '0';
          input.max = String(salvage.wholeTickets);
          input.step = '1';
          input.inputMode = 'numeric';
          input.value = String(selected);
          input.disabled = this.#salvageBusy;
          input.setAttribute('aria-label', `Level ${t.level} tickets to salvage`);
          input.addEventListener('change', () => this.#setSalvageQuantity(t.level, input.value));
          qty.appendChild(input);
          row.appendChild(qty);
        }
        list.appendChild(row);
      }
      host.appendChild(list);
    }

    const eligible = this.#salvageEligibleRows();
    const lines = this.#selectedSalvageLines();
    const selectedTickets = lines.reduce((sum, line) => sum + line.ticketQuantity, 0);
    const panel = document.createElement('section');
    panel.className = 'inv-salvage';
    panel.setAttribute('data-bind', 'inv-salvage-panel');
    panel.setAttribute('tabindex', '-1');

    const panelHead = document.createElement('div');
    panelHead.className = 'inv-salvage__head';
    const title = document.createElement('a');
    title.className = 'inv-salvage__title';
    title.href = '/learn/salvage-swap/';
    title.textContent = 'SALVAGE SWAP';
    title.title = 'Learn about the Salvage Swap';
    panelHead.appendChild(title);
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'inv-salvage__all';
    all.setAttribute('data-bind', 'salvage-select-all');
    all.textContent = this.#salvageSelection.size > 0
      ? 'CLEAR'
      : eligible.length > SALVAGE_MAX_LINES ? `SELECT ${SALVAGE_MAX_LINES}` : 'SELECT ALL';
    all.disabled = eligible.length === 0 || this.#salvageBusy;
    all.addEventListener('click', () => this.#toggleAllSalvage());
    panelHead.appendChild(all);
    panel.appendChild(panelHead);

    const warning = document.createElement('p');
    warning.className = 'inv-salvage__warning';
    warning.textContent = eligible.length > 0
      ? 'Drag across levels or use the checkboxes to build one payout.'
      : this.#holdingsLoaded
        ? 'No tickets are currently eligible.'
        : 'Loading eligible tickets…';
    panel.appendChild(warning);

    if (lines.length > 0) {
      const selectedLine = document.createElement('p');
      selectedLine.className = 'inv-salvage__selected';
      selectedLine.textContent = `${selectedTickets.toLocaleString('en-US')} ticket${selectedTickets === 1 ? '' : 's'} selected`;
      panel.appendChild(selectedLine);
    }

    if (this.#salvageQuoteLoading) {
      const loading = document.createElement('p');
      loading.className = 'inv-salvage__quote-loading';
      loading.textContent = 'Quoting on chain…';
      panel.appendChild(loading);
    } else if (this.#salvageQuote) {
      const quote = this.#salvageQuote;
      const payout = document.createElement('div');
      payout.className = 'inv-salvage__payout';
      const ticketUnits = salvageTicketPurchaseUnits(quote.ticketWei, this.#activeLevel);
      const payoutParts = ticketUnits > 0n
        ? [`${formatSalvageTicketCount(quote.ticketWei, this.#activeLevel)} ${
          ticketUnits === SALVAGE_PURCHASE_UNITS_PER_TICKET ? 'ticket' : 'tickets'
        }`]
        : [];
      if (quote.ethCashWei > 0n) payoutParts.push(`${formatTicketTotalValueEth(quote.ethCashWei)} ETH`);
      if (quote.flipTokens > 0n) {
        const flip = displayToken(quote.flipTokens, 2).replace(/\.0+$|(?<=\.[0-9])0+$/, '');
        payoutParts.push(`${flip} FLIP`);
      }
      const getLabel = document.createElement('small');
      getLabel.textContent = 'PAYOUT';
      const getValue = document.createElement('strong');
      getValue.textContent = payoutParts.length > 0 ? payoutParts.join(' + ') : '0';
      payout.appendChild(getLabel);
      payout.appendChild(getValue);
      panel.appendChild(payout);

      if (!this.#salvageMinimumMet()) {
        const minimum = document.createElement('p');
        minimum.className = 'inv-salvage__minimum';
        minimum.textContent = 'Offer too small — select more tickets.';
        panel.appendChild(minimum);
      }
    }

    const feedback = document.createElement('p');
    feedback.className = `inv-salvage__feedback${this.#salvageError ? ' is-error' : ''}`;
    feedback.setAttribute('aria-live', 'polite');
    feedback.textContent = this.#salvageError || this.#salvageMessage;
    if (!feedback.textContent) feedback.hidden = true;
    panel.appendChild(feedback);

    const missingQueue = this.#salvageMissingQueueLevels(lines);
    if (this.#salvageQuote && missingQueue.length > 0 && !this.#salvageError) {
      feedback.hidden = false;
      feedback.textContent = 'Offer ready. Queue positions are still indexing for a full sell-out; partial quantities can execute now.';
    }

    const execute = document.createElement('button');
    execute.type = 'button';
    execute.className = `inv-salvage__execute${this.#salvageArmed ? ' is-armed' : ''}`;
    execute.setAttribute('data-bind', 'salvage-execute');
    execute.textContent = this.#salvageBusy
      ? 'SALVAGING…'
      : missingQueue.length > 0 && this.#salvageQuote
        ? 'QUEUE DATA INDEXING'
        : this.#salvageArmed ? 'CONFIRM SALVAGE' : 'SALVAGE SELECTED';
    execute.disabled = !deriveCanSign()
      || lines.length === 0
      || !this.#salvageQuote
      || !this.#salvageMinimumMet()
      || missingQueue.length > 0
      || this.#salvageQuoteLoading
      || this.#salvageBusy;
    execute.addEventListener('click', () => { void this.#activateSalvage(); });
    panel.appendChild(execute);
    host.appendChild(panel);
    if (this.#focusSalvageOnRender) {
      this.#focusSalvageOnRender = false;
      const reveal = () => {
        try { panel.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); } catch (_e) { /* fake DOM */ }
        try { panel.focus?.({ preventScroll: true }); } catch (_e) { /* fake DOM */ }
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal);
      else reveal();
    }
  }

  // Cards mode — dedup identical 4-trait combos into ×N cards (sketch
  // renderInventoryCards port).
  #renderCards() {
    const host = this.querySelector('[data-bind="inv-cards"]');
    if (!host) return;
    const renderKey = [
      String(this.#address || '').toLowerCase(),
      String(this.#viewLevel ?? ''),
      this.#dataRenderKey,
      this.#foilLines.map((line) => line.join(',')).join(';'),
      this.#deityPassSymbols.join(','),
    ].join('::');
    if (renderKey === this.#cardsRenderKey && host.children?.length > 0) return;
    this.#cardsRenderKey = renderKey;
    host.textContent = '';
    const d = this.#data;
    const cardsArr = Array.isArray(d?.cards) ? d.cards : [];

    const combos = new Map();
    let pendingCount = 0;
    for (const card of cardsArr) {
      if (card?.status === 'pending') pendingCount++;
    }
    const foilRemaining = new Map();
    for (const line of this.#foilLines) {
      const key = invComboKey(line);
      foilRemaining.set(key, (foilRemaining.get(key) || 0) + 1);
    }
    let foilOrdinal = 0;
    const partitioned = dgnPartitionTicketEntries(cardsArr);
    for (const record of partitioned.tickets) {
      const ids = record.traitIds;
      const comboKey = invComboKey(ids);
      const foilLeft = foilRemaining.get(comboKey) || 0;
      const isFoil = foilLeft > 0;
      if (isFoil) foilRemaining.set(comboKey, foilLeft - 1);
      // Foil lines are four physical tickets and must stay four visible cards,
      // even in the vanishingly rare case two lines have the same traits.
      const key = isFoil ? `foil:${foilOrdinal++}` : ids.join(',');
      if (!combos.has(key)) {
        combos.set(key, {
          traitIds: ids,
          count: 0,
          foil: isFoil,
          hasGold: invTicketHasGold(ids),
        });
      }
      combos.get(key).count++;
    }

    // /foil is contract-derived and already proves all four lines. If the
    // generic by-trait stream is lagging or its flattened card buckets contain
    // a fractional boundary, fill only the unmatched foil tickets from that
    // exact projection so a real pack can never collapse to one visible card.
    for (const line of this.#foilLines) {
      const comboKey = invComboKey(line);
      const left = foilRemaining.get(comboKey) || 0;
      if (left <= 0) continue;
      combos.set(`foil:${foilOrdinal++}`, {
        traitIds: line,
        count: 1,
        foil: true,
        hasGold: invTicketHasGold(line),
      });
      foilRemaining.set(comboKey, left - 1);
    }

    // Gold is the top colour tier and the useful scan target. Foils are the
    // next inventory tier, so they stay together immediately after every gold
    // ticket instead of being lost among ordinary cards with larger counts.
    const displayTier = (combo) => (combo.hasGold ? 0 : combo.foil ? 1 : 2);
    const sorted = [...combos.values()].sort(
      (a, b) => displayTier(a) - displayTier(b) || b.count - a.count,
    );
    const looseByTrait = new Map();
    for (const entry of partitioned.entries) {
      const traitId = Number(entry?.traitId);
      if (!Number.isInteger(traitId) || traitId < 0 || traitId > 255) continue;
      looseByTrait.set(traitId, (looseByTrait.get(traitId) || 0) + 1);
    }
    const looseEntries = [...looseByTrait.entries()].sort((a, b) => {
      const aGold = invTraitToQSC(a[0]).col === INV_GOLD_COLOR_IDX;
      const bGold = invTraitToQSC(b[0]).col === INV_GOLD_COLOR_IDX;
      return Number(bGold) - Number(aGold) || b[1] - a[1] || a[0] - b[0];
    });

    // Permanent account collectibles come before level-scoped tickets.
    const deityRendered = this.#renderDeityPasses(host);

    if (sorted.length === 0 && looseEntries.length === 0 && pendingCount === 0 && !deityRendered) {
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
      // One delegated listener on the cards host handles every ticket. Keeping
      // the immutable payload on the node avoids thousands of per-card
      // closures in large inventories.
      wrap.__invTicket = { traitIds: [...combo.traitIds], foil: combo.foil };
      if (combo.hasGold && wrap.classList) wrap.classList.add('inv-card--gold');
      if (combo.foil) {
        // The four boosted lines are worth picking out of a wall of tiles: they
        // grade against every draw at this level, the plain ones do not. Their
        // metal face carries the distinction without covering a trait in text.
        const shine = document.createElement('span');
        shine.className = 'inv-foil-shine';
        wrap.appendChild(shine);
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
      card.className = `ticket-card tc-small${combo.foil ? ' ticket-card--foil' : ''}`;
      applyDgnTicketAccent(card, combo.traitIds);
      for (const tid of combo.traitIds) {
        const cell = document.createElement('div');
        cell.className = 'trait-quadrant';
        const { q, sym, col } = invTraitToQSC(Number(tid));
        if (combo.foil) cell.setAttribute('data-trait-color', INV_COLORS[col]);
        // Gold is the top colour tier; give the cell behind it a metal.
        if (col === INV_GOLD_COLOR_IDX) cell.classList.add('trait-quadrant--gold');
        const img = document.createElement('img');
        img.src = invBadgePath(q, sym, col);
        img.alt = `${INV_SYMBOLS[INV_QUADRANTS[q]][sym]} ${INV_COLORS[col]}`;
        img.loading = 'lazy';
        img.decoding = 'async';
        cell.appendChild(img);
        card.appendChild(cell);
      }
      const center = document.createElement('div');
      center.className = 'ticket-card-center';
      const flame = document.createElement('img');
      // Use the canonical shipped flame for both materials. The foil face
      // turns it silver in CSS; a separate silver URL previously fell through
      // to the production HTML shell and rendered as a broken image.
      flame.src = '/whitepaper/flame-center.svg';
      flame.alt = '';
      flame.loading = 'lazy';
      flame.decoding = 'async';
      center.appendChild(flame);
      card.appendChild(center);
      wrap.appendChild(card);
      host.appendChild(wrap);
    }

    // A contract entry is one physical quarter of a ticket. Fractional
    // generation tails are real inventory, so show each rolled trait as that
    // centerless quarter instead of silently dropping it from Cards mode.
    for (const [traitId, count] of looseEntries) {
      const { q, sym, col } = invTraitToQSC(traitId);
      const wrap = document.createElement('div');
      wrap.className = 'inv-card inv-card--entry';
      if (col === INV_GOLD_COLOR_IDX) wrap.classList?.add('inv-card--gold');
      const traitName = invEntryLabel(traitId);
      wrap.title = `Ticket entry · ${traitName}`;
      wrap.setAttribute('aria-label', `${count > 1 ? `${count} matching` : 'One'} ticket ${count === 1 ? 'entry' : 'entries'} · ${traitName}`);

      if (count > 1) {
        const countBadge = document.createElement('div');
        countBadge.className = 'inv-count';
        countBadge.textContent = `×${count}`;
        wrap.appendChild(countBadge);
      }

      const entryCard = document.createElement('div');
      entryCard.className = 'ticket-entry-card tc-small';
      entryCard.setAttribute('data-quadrant', String(q));
      applyDgnTicketAccent(entryCard, [traitId]);
      const cell = document.createElement('div');
      cell.className = 'trait-quadrant';
      if (col === INV_GOLD_COLOR_IDX) cell.classList.add('trait-quadrant--gold');
      const img = document.createElement('img');
      img.src = invBadgePath(q, sym, col);
      img.alt = traitName;
      img.loading = 'lazy';
      img.decoding = 'async';
      cell.appendChild(img);
      entryCard.appendChild(cell);
      wrap.appendChild(entryCard);

      const label = document.createElement('span');
      label.className = 'inv-entry-label';
      label.textContent = count === 1 ? '1 ENTRY' : `${count} ENTRIES`;
      wrap.appendChild(label);
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
      badge.decoding = 'async';
      hero.appendChild(badge);
      pass.appendChild(hero);
      const label = document.createElement('strong');
      label.className = 'inv-deity-pass__name';
      label.textContent = `God of ${symbolName.charAt(0).toUpperCase()}${symbolName.slice(1)}`;
      pass.appendChild(label);
      host.appendChild(pass);
      rendered += 1;
    }
    return rendered;
  }

  // Chart mode — the wide view: per quadrant, an 8×8 grid (row = symbol,
  // col = color); cell trait_id = q*64 + c*8 + s (sketch renderInventoryChart
  // port — this reconstruction is the exact inverse of invTraitToQSC and is
  // the load-bearing bit for matrix orientation).
  #renderChart() {
    const host = this.querySelector('[data-bind="inv-chart"]');
    if (!host) return;
    const deityKey = [...this.#deityExpectedEntries.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([traitId, count]) => `${traitId}:${count}`)
      .join(',');
    const renderKey = [
      String(this.#address || '').toLowerCase(),
      String(this.#viewLevel ?? ''),
      this.#dataRenderKey,
      deityKey,
    ].join('::');
    if (renderKey === this.#chartRenderKey && host.children?.length > 0) return;
    this.#chartRenderKey = renderKey;
    host.textContent = '';
    const d = this.#data;
    const cardsArr = Array.isArray(d?.cards) ? d.cards : [];

    const counts = new Array(256).fill(0);
    const opened = cardsArr.filter((card) => card?.status === 'opened');
    const partitioned = dgnPartitionTicketEntries(opened);
    for (const ticket of partitioned.tickets) {
      for (const tid of ticket.traitIds) counts[tid]++;
    }
    for (const entry of partitioned.entries) {
      const tid = Number(entry?.traitId);
      if (Number.isInteger(tid) && tid >= 0 && tid < 256) counts[tid]++;
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
          img.loading = 'lazy';
          img.decoding = 'async';
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
