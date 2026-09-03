// Historical-day reveal publisher.
//
// The jackpot's hidden replay-panel day dropdown remains the entry point. Once
// a past day is selected, last-day-jackpot dispatches replay:day-selected and
// this headless controller reconstructs that player's settled Lootbox and
// Degenerette presentations for the fixed bottom tray. Every action is read-
// only: it queues an already-settled reveal and never opens a wallet.

import { fetchJSON } from '../app/api.js';
import { getViewedAddress, subscribe } from '../app/store.js';
import {
  fetchHistoricalLootboxRows,
  historicalLootboxReplayRows,
  lootboxIndexesForSnapshot,
} from '../app/day-lootbox-results.js';
import { clearPendingActions, publishPendingActions } from '../app/pending-actions.js';
import {
  degeneretteReplaySequences,
  degeneretteRevealSequenceFromFeedItem,
  dgnDecodePacked,
  mergeDegeneretteFeedItems,
} from './app-degenerette-panel.js';
import { queueReveal } from './reveal-queue.js';

const SOURCE = 'day-history-replays';
const PAGE_LIMIT = 200;
const MAX_PAGES = 40;
const ORD_SCALE = 1_000_000n;

function _number(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function _block(row) {
  return _number(row?.blockNumber);
}

function _chronology(row, fallback = 0) {
  const ord = _number(row?.ord);
  if (ord != null) return ord;
  const block = _block(row);
  const log = _number(row?.logIndex) ?? 0;
  return block == null ? fallback : block * Number(ORD_SCALE) + log;
}

function _tx(row) {
  return String(row?.transactionHash || '').toLowerCase();
}

function _betIds(snapshot) {
  return new Set((Array.isArray(snapshot?.activity?.bets) ? snapshot.activity.bets : [])
    .map((bet) => bet?.betId)
    .filter((id) => id != null)
    .map(String));
}

// Keep the original public seam for callers/tests that imported it here before
// the day-summary reuse moved the implementation into app/.
export { historicalLootboxReplayRows };

/** Ordered, read-only day replay: base reels, record bounty reels, then box. */
export function historicalDegeneretteReplaySequences(sequence, { day } = {}) {
  return degeneretteReplaySequences(sequence, {
    lootboxTitle: `DAY ${day} DEGENERETTE LUCKBOX`,
    lootboxNoVessel: true,
  });
}

/** Pure reconstruction seam used by tests and the controller. */
export function historicalDegeneretteReplayRows(items, { player, day, betIds } = {}) {
  const owner = String(player || '').toLowerCase();
  const wanted = betIds instanceof Set ? betIds : new Set(betIds || []);
  return mergeDegeneretteFeedItems(items)
    .filter((item) => String(item?.player || '').toLowerCase() === owner
      && wanted.has(String(item?.betId)))
    .map((item) => {
      const sequence = degeneretteRevealSequenceFromFeedItem(item);
      if (!sequence) return null;
      const packed = dgnDecodePacked(item.packedData);
      const resolved = (Array.isArray(item.results) ? item.results : [])
        .find((row) => row?.resultType === 'resolved');
      return {
        id: `history:${day}:degenerette:${String(item.betId)}`,
        chronology: _chronology(item, _chronology(resolved)),
        resolvedTransactionHash: _tx(resolved),
        ticketPacked: packed?.customTicket ?? null,
        heroQuadrant: packed?.heroQuadrant ?? sequence.heroIdx ?? 0,
        spinCount: sequence.spinCount ?? sequence.spins?.length ?? 1,
        sequence,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.chronology - b.chronology);
}

async function _fetchDegeneretteRows(player, betIds) {
  if (betIds.size === 0) return [];
  const collected = [];
  const seenCursors = new Set();
  let before = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const cursor = before == null ? '' : `&before=${encodeURIComponent(String(before))}`;
    const response = await fetchJSON(
      `/degenerette/feed?limit=${PAGE_LIMIT}&player=${encodeURIComponent(player)}${cursor}`,
    );
    collected.push(...(Array.isArray(response?.items) ? response.items : []));
    const merged = mergeDegeneretteFeedItems(collected);
    const complete = new Set(merged.filter((item) => (
      betIds.has(String(item?.betId)) && degeneretteRevealSequenceFromFeedItem(item)
    )).map((item) => String(item.betId)));
    if (Array.from(betIds).every((id) => complete.has(id))) break;
    const next = response?.nextCursor;
    if (next == null || seenCursors.has(String(next))) break;
    seenCursors.add(String(next));
    before = next;
  }
  return collected;
}

class AppDayHistoryReplays extends HTMLElement {
  #unsubs = [];
  #dayListener = null;
  #day = null;
  #latestDay = null;
  #rows = [];
  #seq = 0;
  #initialized = false;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.hidden = true;
    this.setAttribute('aria-hidden', 'true');
    this.#dayListener = (event) => {
      const detail = event?.detail || {};
      if (!detail.historical) {
        this.#day = null;
        this.#latestDay = detail.latestDay ?? null;
        this.#clearRows();
        return;
      }
      const day = Number(detail.day);
      if (!Number.isInteger(day) || day <= 0) return;
      this.#day = day;
      this.#latestDay = detail.latestDay ?? null;
      this.#rows = [];
      publishPendingActions(SOURCE, []);
      void this.#refresh();
    };
    document.addEventListener('replay:day-selected', this.#dayListener);
    this.#unsubs.push(subscribe('viewing.address', () => { if (this.#day != null) void this.#refresh(); }));
    this.#unsubs.push(subscribe('connected.address', () => { if (this.#day != null) void this.#refresh(); }));
  }

  disconnectedCallback() {
    this.#seq += 1;
    this.#unsubs.forEach((unsubscribe) => { try { unsubscribe(); } catch (_e) { /* defensive */ } });
    this.#unsubs = [];
    if (this.#dayListener) document.removeEventListener('replay:day-selected', this.#dayListener);
    this.#dayListener = null;
    clearPendingActions(SOURCE);
    this.#initialized = false;
  }

  #clearRows() {
    this.#seq += 1;
    this.#rows = [];
    publishPendingActions(SOURCE, []);
  }

  #consume(id) {
    const index = this.#rows.findIndex((row) => row.id === id);
    if (index < 0) return false;
    this.#rows.splice(index, 1);
    this.#publish();
    return true;
  }

  #publish() {
    const day = this.#day;
    const dismissScope = getViewedAddress();
    publishPendingActions(SOURCE, this.#rows.map((row) => ({
      id: row.id,
      dismissScope,
      kind: row.kind,
      mayAddEth: false,
      phase: row.kind === 'degenerette' ? 'result-ready' : 'history-replay',
      label: row.kind === 'degenerette'
        ? `Day ${day} Degenerette #${row.betId}`
        : `Day ${day} Luckbox`,
      shortLabel: 'Replay',
      detail: `Day ${day} · replay only`,
      state: 'ready',
      write: false,
      order: 16,
      chronology: row.chronology,
      ticketPacked: row.ticketPacked,
      heroQuadrant: row.heroQuadrant,
      spinCount: row.spinCount,
      historyDay: day,
      clearAll: () => this.#clearRows(),
      run: async () => {
        if (!this.#consume(row.id)) return;
        const sequences = row.kind === 'degenerette'
          ? historicalDegeneretteReplaySequences(row.sequence, { day })
          : [row.sequence];
        for (const sequence of sequences) {
          queueReveal(sequence);
        }
      },
    })));
  }

  async #refresh() {
    const day = this.#day;
    const address = getViewedAddress();
    const player = address ? String(address).toLowerCase() : null;
    const seq = ++this.#seq;
    if (day == null || !player) {
      this.#rows = [];
      publishPendingActions(SOURCE, []);
      return;
    }
    try {
      const snapshot = await fetchJSON(
        `/viewer/player/${encodeURIComponent(player)}/day/${encodeURIComponent(String(day))}`,
      );
      if (seq !== this.#seq || day !== this.#day || player !== String(getViewedAddress() || '').toLowerCase()) return;
      const betIds = _betIds(snapshot);
      const [lootboxRows, degeneretteItems] = await Promise.all([
        fetchHistoricalLootboxRows(player, snapshot),
        _fetchDegeneretteRows(player, betIds),
      ]);
      if (seq !== this.#seq || day !== this.#day || player !== String(getViewedAddress() || '').toLowerCase()) return;
      const degenerette = historicalDegeneretteReplayRows(degeneretteItems, {
        player,
        day,
        betIds,
      });
      const dgnTransactions = new Set(degenerette
        .map((row) => row.resolvedTransactionHash)
        .filter(Boolean));
      const lootboxes = historicalLootboxReplayRows(lootboxRows, {
        player,
        day,
        startBlock: snapshot?.startBlock,
        endBlock: snapshot?.endBlock,
        wantedIndexes: lootboxIndexesForSnapshot(snapshot),
        excludedTransactions: dgnTransactions,
      });
      this.#rows = [
        ...degenerette.map((row) => ({ ...row, kind: 'degenerette', betId: row.sequence.betId })),
        ...lootboxes.map((row) => ({ ...row, kind: 'lootbox' })),
      ].sort((a, b) => a.chronology - b.chronology);
      this.#publish();
    } catch (_e) {
      if (seq !== this.#seq) return;
      this.#rows = [];
      publishPendingActions(SOURCE, []);
    }
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function'
  && !customElements.get('app-day-history-replays')) {
  customElements.define('app-day-history-replays', AppDayHistoryReplays);
}
