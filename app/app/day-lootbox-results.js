// Day-scoped lootbox result reconstruction shared by the historical pending
// tray and the fullscreen daily summary. The indexer's leg feed carries the
// complete same-transaction result (including boons and BoxSpin reels), while
// the viewer snapshot supplies the exact day-specific box indexes.

import { fetchJSON } from '../../beta/app/api.js';
import { openLegsFromFeed } from './lootbox-legs.js';

const PAGE_LIMIT = 200;
const MAX_PAGES = 40;
// A day summary is an epilogue, not a second inventory browser. Manual boxes
// keep their itemized receipts, but a bad/stale indexer join must never turn
// the fullscreen summary into an unbounded reveal queue.
export const MAX_DAY_SUMMARY_LOOTBOX_RESULTS = 8;
const ORD_SCALE = 1_000_000n;
const OPEN_ANCHORS = new Set(['opened', 'flipOpened', 'presale']);
const SNAPSHOT_OPEN_TYPES = new Set(['opened', 'flipOpened', 'presale_opened']);

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

function _transactionSet(values) {
  return new Set(Array.from(values || [], (hash) => String(hash || '').toLowerCase())
    .filter(Boolean));
}

function _packTransaction(pack) {
  const direct = _tx(pack);
  if (direct) return direct;
  // PACKS-V2 IDs are `lootbox-{transactionHash}-{logIndex}`. Keep the
  // transaction as the immutable day anchor: lootboxIndex is an RNG index and
  // can recur across levels, so it is not sufficient to identify today's box.
  const match = /^lootbox-(0x[0-9a-f]{64})-\d+$/i.exec(String(pack?.packId || ''));
  return match ? match[1].toLowerCase() : '';
}

function _packLogIndex(pack) {
  const direct = _number(pack?.logIndex);
  if (Number.isInteger(direct) && direct >= 0) return direct;
  const match = /^lootbox-0x[0-9a-f]{64}-(\d+)$/i.exec(String(pack?.packId || ''));
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function _anchorMap(value) {
  const out = new Map();
  if (!(value instanceof Map)) return out;
  for (const [rawHash, rawLogs] of value) {
    const hash = String(rawHash || '').toLowerCase();
    if (!hash) continue;
    const logs = new Set();
    for (const raw of rawLogs || []) {
      const log = _number(raw);
      if (Number.isInteger(log) && log >= 0) logs.add(log);
    }
    if (logs.size > 0) out.set(hash, logs);
  }
  return out;
}

/**
 * Exact `(transactionHash, logIndex)` opening anchors proven by PACKS-V2.
 * Returns null when the response itself is not scoped to `day`.
 */
export function lootboxAnchorsForDayPacks(packs, day) {
  const expected = _number(day);
  const actual = _number(packs?.day);
  if (!Number.isInteger(expected) || actual !== expected) return null;
  const rows = Array.isArray(packs?.lootboxPacks) ? packs.lootboxPacks : [];
  const out = new Map();
  for (const pack of rows) {
    const hash = _packTransaction(pack);
    const logIndex = _packLogIndex(pack);
    if (!hash || logIndex == null) continue;
    if (!out.has(hash)) out.set(hash, new Set());
    out.get(hash).add(logIndex);
  }
  return out;
}

/**
 * Exact opening transactions proven by a PACKS-V2 response for `day`.
 * Returns null when the response itself is not scoped to that day.
 */
export function lootboxTransactionsForDayPacks(packs, day) {
  const expected = _number(day);
  const actual = _number(packs?.day);
  if (!Number.isInteger(expected) || actual !== expected) return null;
  const rows = Array.isArray(packs?.lootboxPacks) ? packs.lootboxPacks : [];
  return _transactionSet(rows.map(_packTransaction));
}

export function lootboxIndexesForSnapshot(snapshot) {
  const activity = snapshot?.activity || {};
  const purchases = Array.isArray(activity.lootboxPurchases)
    ? activity.lootboxPurchases : [];
  const openingResults = (Array.isArray(activity.lootboxResults)
    ? activity.lootboxResults : []).filter((row) => (
    SNAPSHOT_OPEN_TYPES.has(String(row?.rewardType || ''))
    || OPEN_ANCHORS.has(String(row?.legType || ''))
  ));
  return new Set([...purchases, ...openingResults]
    .map((row) => row?.lootboxIndex)
    .filter((id) => id != null)
    .map(String));
}

/** Pure reconstruction seam used by both summary and replay tests. */
export function historicalLootboxReplayRows(rows, {
  player,
  day,
  startBlock = null,
  endBlock = null,
  wantedIndexes = new Set(),
  wantedTransactions = new Set(),
  wantedAnchors = new Map(),
  excludedTransactions = new Set(),
} = {}) {
  const owner = String(player || '').toLowerCase();
  if (!owner) return [];
  const start = _number(startBlock);
  const end = _number(endBlock);
  const wanted = wantedIndexes instanceof Set ? wantedIndexes : new Set(wantedIndexes || []);
  const wantedTx = _transactionSet(wantedTransactions);
  const exactAnchors = _anchorMap(wantedAnchors);
  // With neither immutable block bounds nor day-scoped indexes, accepting the
  // player's newest feed page would silently put another day's boxes here.
  if (start == null && end == null && wanted.size === 0 && wantedTx.size === 0) return [];
  const excluded = new Set(Array.from(excludedTransactions || [], (hash) => String(hash).toLowerCase()));
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (String(row?.player || '').toLowerCase() !== owner) return false;
    const block = _block(row);
    if (start != null && (block == null || block < start)) return false;
    if (end != null && (block == null || block > end)) return false;
    return true;
  });
  const anchors = scoped.filter((row) => {
    if (!OPEN_ANCHORS.has(String(row?.legType || ''))) return false;
    if (_tx(row) && excluded.has(_tx(row))) return false;
    // An exact transaction set is stronger than lootboxIndex. Indexes are RNG
    // slots and may repeat across days/levels; matching them alone caused a
    // single day summary to replay years of historical boxes.
    if (wantedTx.size > 0 && !wantedTx.has(_tx(row))) return false;
    if (exactAnchors.size > 0) {
      const logs = exactAnchors.get(_tx(row));
      const logIndex = _number(row?.logIndex);
      if (!logs || !Number.isInteger(logIndex) || !logs.has(logIndex)) return false;
    }
    if (wantedTx.size === 0 && start == null && end == null && wanted.size > 0
      && !wanted.has(String(row?.lootboxIndex ?? ''))) return false;
    return true;
  });
  const unique = new Map();
  for (const anchor of anchors) {
    const txHash = _tx(anchor);
    const logIndex = _number(anchor?.logIndex);
    const key = txHash && Number.isInteger(logIndex)
      ? `${txHash}:${logIndex}`
      : `index:${String(anchor?.lootboxIndex ?? '')}:${_chronology(anchor)}`;
    if (!unique.has(key)) unique.set(key, anchor);
  }
  const allAnchorsByTransaction = new Map();
  for (const row of scoped) {
    if (!OPEN_ANCHORS.has(String(row?.legType || ''))) continue;
    const txHash = _tx(row);
    if (!txHash || excluded.has(txHash)) continue;
    if (!allAnchorsByTransaction.has(txHash)) allAnchorsByTransaction.set(txHash, []);
    allAnchorsByTransaction.get(txHash).push(row);
  }
  for (const rowsInTx of allAnchorsByTransaction.values()) {
    rowsInTx.sort((a, b) => (_number(a?.logIndex) ?? 0) - (_number(b?.logIndex) ?? 0));
  }
  return Array.from(unique.entries())
    .map(([key, anchor]) => {
      const transactionHash = _tx(anchor) || null;
      let feedRows = scoped;
      const txAnchors = transactionHash ? (allAnchorsByTransaction.get(transactionHash) || []) : [];
      // LootBoxOpened is the terminal event for a normal roll. When one
      // catch-up transaction settles many boxes, use the preceding anchor as
      // the lower boundary so each replay receives only its own reward legs.
      // Preserve the one-anchor behavior because BoxSpin companion events can
      // appear on either side of that sole anchor in historical/synthetic data.
      if (transactionHash && txAnchors.length > 1) {
        const anchorLog = _number(anchor?.logIndex);
        const position = txAnchors.findIndex((row) => (
          _number(row?.logIndex) === anchorLog
          && String(row?.legType || '') === String(anchor?.legType || '')
        ));
        const previousLog = position > 0 ? _number(txAnchors[position - 1]?.logIndex) : null;
        if (Number.isInteger(anchorLog)) {
          feedRows = scoped.filter((row) => {
            if (_tx(row) !== transactionHash) return false;
            const log = _number(row?.logIndex);
            if (!Number.isInteger(log) || log > anchorLog) return false;
            return previousLog == null || log > previousLog;
          });
        }
      }
      const legs = openLegsFromFeed(feedRows, {
        player: owner,
        lootboxIndex: anchor?.lootboxIndex,
        transactionHash,
      });
      if (legs.length === 0) return null;
      return {
        id: `history:${day}:lootbox:${key}`,
        chronology: _chronology(anchor),
        lootboxIndex: anchor?.lootboxIndex ?? null,
        transactionHash,
        sequence: {
          kind: 'lootbox',
          title: `DAY ${day} LOOTBOX`,
          lootboxIndex: anchor?.lootboxIndex ?? null,
          legs,
          settledExpected: true,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.chronology - b.chronology);
}

export async function fetchHistoricalLootboxRows(player, snapshot, {
  wantedTransactions = new Set(),
} = {}) {
  const start = _number(snapshot?.startBlock);
  const end = _number(snapshot?.endBlock);
  const wanted = lootboxIndexesForSnapshot(snapshot);
  const wantedTx = _transactionSet(wantedTransactions);
  if (start == null && end == null && wanted.size === 0 && wantedTx.size === 0) return [];
  const collected = [];
  const seenCursors = new Set();
  let before = end == null ? null : ((BigInt(Math.trunc(end)) + 1n) * ORD_SCALE).toString();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const cursor = before == null ? '' : `&before=${encodeURIComponent(String(before))}`;
    const response = await fetchJSON(
      `/lootbox/legs?limit=${PAGE_LIMIT}&player=${encodeURIComponent(player)}${cursor}`,
    );
    const rows = Array.isArray(response?.items) ? response.items : [];
    collected.push(...rows);
    if (rows.length === 0) break;
    if (start != null && rows.some((row) => (_block(row) ?? Infinity) < start)) break;
    if (wantedTx.size > 0) {
      const found = new Set(collected
        .filter((row) => OPEN_ANCHORS.has(String(row?.legType || '')))
        .map(_tx)
        .filter(Boolean));
      if (Array.from(wantedTx).every((hash) => found.has(hash))) break;
    } else if (start == null && wanted.size > 0) {
      const found = new Set(collected.filter((row) => OPEN_ANCHORS.has(String(row?.legType || '')))
        .map((row) => String(row?.lootboxIndex ?? '')));
      if (Array.from(wanted).every((id) => found.has(id))) break;
    }
    const next = response?.nextCursor;
    if (next == null || seenCursors.has(String(next))) break;
    seenCursors.add(String(next));
    before = next;
  }
  return collected;
}

export async function loadDayLootboxResults({ player, day, snapshot, dayPacks } = {}) {
  // The daily summary supplies its exact PACKS-V2 payload. If that response is
  // missing, all-time, or has no transaction anchors, fail closed instead of
  // using a recurring lootboxIndex to admit results from other levels.
  let wantedTransactions = new Set();
  let wantedAnchors = new Map();
  if (dayPacks !== undefined) {
    const scoped = lootboxTransactionsForDayPacks(dayPacks, day);
    if (!(scoped instanceof Set) || scoped.size === 0) return [];
    wantedTransactions = scoped;
    wantedAnchors = lootboxAnchorsForDayPacks(dayPacks, day) || new Map();
  }
  const rows = await fetchHistoricalLootboxRows(player, snapshot, { wantedTransactions });
  return historicalLootboxReplayRows(rows, {
    player,
    day,
    startBlock: snapshot?.startBlock,
    endBlock: snapshot?.endBlock,
    wantedIndexes: lootboxIndexesForSnapshot(snapshot),
    wantedTransactions,
    wantedAnchors,
  })
    // Index zero is a deferred/catch-up settlement, not a box the player
    // opened during this round. Its aggregate count is already represented by
    // the activity card; replaying every historical reward made this screen
    // look endless after a long catch-up.
    .filter((row) => row.lootboxIndex != null && String(row.lootboxIndex) !== '0')
    .slice(0, MAX_DAY_SUMMARY_LOOTBOX_RESULTS)
    .map((row) => ({
    lootboxIndex: row.lootboxIndex,
    transactionHash: row.transactionHash,
    chronology: row.chronology,
    legs: row.sequence.legs,
    }));
}
