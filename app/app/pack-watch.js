// /app/app/pack-watch.js — hold the ticket reveal until the tickets are real.
//
// A ticket bought today has no traits yet: the four symbols roll at the level's
// draw. The buy flow used to pop a reveal on the purchase receipt showing a
// sealed "×N tickets" card, which is a popup about nothing — the interesting
// part had not happened. So the buy now RECORDS the purchase here, and this
// watcher pops the reveal later, when the entries are real, showing the actual
// four-symbol tickets the player got (user call).
//
// Ownership of "what counts as new":
//   - At record time we seed a per-(player, level) REVEALED set with every card
//     whose traits have ALREADY rolled. The tickets just bought are still
//     trait-less, so they are not in that seed and stay revealable.
//   - The watcher polls /player/:addr/tickets/by-trait?level=N and reveals any
//     card that is now fully rolled and not in the revealed set. Seeding is what
//     keeps a player's whole back catalogue from bursting out of the overlay the
//     first time this runs.
//   - A level is only watched while it holds a pending record, so an idle app
//     polls nothing.
//
// State lives in localStorage, keyed by chain and player, because the roll can
// land while the tab is closed. Every access is try/caught: private mode and
// quota errors must never break a buy or a poll (Pitfall F).

import { CHAIN } from './chain-config.js';
import { fetchJSON } from '../../beta/app/api.js';
import { publishPendingActions, clearPendingActions } from './pending-actions.js';
import {
  queueReveal,
  PACK_REVEAL_COMPLETE_EVENT,
  PACK_REVEAL_ABORT_EVENT,
} from '../components/reveal-overlay.js';

const PENDING_KEY = `pack_pending_${CHAIN.id}`;
const REVEALED_KEY = `pack_revealed_${CHAIN.id}`;
const PENDING_SOURCE = 'ticket-packs';

// A physical-feeling pack stays readable at ten tickets. Larger drops are
// split into a batch of packs; reveal-overlay lets the player open each one or
// switch the remaining batch to OPEN ALL.
// A reveal hand is an exact 3×3. Large buys keep opening as sequential hands
// (with OPEN ALL available), so the grid never creates a short fourth column.
export const MAX_TICKETS_PER_PACK = 9;

// Traits roll at the level draw, so there is nothing to gain from a tight poll.
const WATCH_INTERVAL_MS = 45_000;
const SEED_RECOVERY_GRACE_MS = 120_000;

// A record older than this is dropped unopened. Generous on purpose: tickets can
// be bought for a FUTURE level whose traits do not roll until that level goes
// live, which is weeks out at mainnet pace — a tighter window would silently
// swallow exactly the reveals worth waiting for.
const PENDING_TTL_MS = 60 * 24 * 60 * 60 * 1000;

let _timer = null;
let _running = false;
let _now = () => Date.now();
let _getAddress = null;
let _publishSeq = 0;
// In-memory only: a reload deliberately forgets the active presentation while
// the durable pending record remains, so the tray offers the unopened pack
// again instead of hiding its tickets forever.
const _activePackCards = new Map();
let _completeListener = null;
let _abortListener = null;

/** Test-only: pin the clock used for TTL expiry. */
export function __setClockForTest(fn) { _now = fn || (() => Date.now()); }

function _read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (_e) {
    return fallback;
  }
}

function _write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_e) { /* private mode */ }
}

function _lower(addr) { return addr ? String(addr).toLowerCase() : null; }

function _revealedKey(address, level) { return `${REVEALED_KEY}_${_lower(address)}_${level}`; }

function _revealedSet(address, level) {
  const list = _read(_revealedKey(address, level), []);
  return new Set(Array.isArray(list) ? list.map(Number) : []);
}

function _saveRevealed(address, level, set) {
  _write(_revealedKey(address, level), Array.from(set));
}

function _expectedTickets(value) {
  const n = Math.floor(Number(value) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function _seedOpenedCards(address, level, payload, keepNewest = 0) {
  const opened = _openedCards(payload)
    .slice()
    .sort((a, b) => Number(a.cardIndex) - Number(b.cardIndex));
  const keep = Math.min(opened.length, _expectedTickets(keepNewest));
  const seed = _revealedSet(address, level);
  for (const card of opened.slice(0, opened.length - keep)) {
    seed.add(Number(card.cardIndex));
  }
  _saveRevealed(address, level, seed);
}

function _replacePendingRecord(record) {
  const addr = _lower(record?.address);
  const lvl = Number(record?.level);
  if (!addr || !Number.isInteger(lvl)) return;
  const list = pendingPacks();
  const at = list.findIndex((row) => (
    row && _lower(row.address) === addr && Number(row.level) === lvl
  ));
  if (at >= 0) list[at] = { ...record };
  else list.push({ ...record });
  _write(PENDING_KEY, list);
}

function _publishWaitingRecords(address) {
  const addr = _lower(address);
  if (!addr) return;
  const mine = pendingPacks().filter((rec) => rec && _lower(rec.address) === addr);
  publishPendingActions(PENDING_SOURCE, mine.map((rec) => ({
    id: `ticket-pack:${Number(rec.level)}`,
    kind: 'tickets',
    label: `Level ${Number(rec.level)} ticket pack`,
    detail: `Waiting for the Level ${Number(rec.level)} draw`,
    state: 'waiting',
    order: 10,
  })));
}

/**
 * A whole, fully rolled card's four trait IDs in quadrant order.
 *
 * The by-trait endpoint deliberately exposes trailing `partial` cards while
 * entries are still being indexed. The old `entries.length > 0` check treated
 * those as opened, queued a three-symbol ticket, then marked it permanently
 * revealed. Four entries alone are not enough either: duplicate quadrant bits
 * would collapse to three visible cells in dgnTraitIdsToQuadrants().
 */
function _wholeCardTraitIds(card) {
  if (!card || card.status !== 'opened') return null;
  const entries = Array.isArray(card.entries) ? card.entries : [];
  if (entries.length !== 4) return null;
  const byQuadrant = new Array(4).fill(null);
  for (const entry of entries) {
    if (!entry || entry.traitId == null) return null;
    const tid = Number(entry.traitId);
    if (!Number.isInteger(tid) || tid < 0 || tid > 255) return null;
    const quadrant = (tid >> 6) & 3;
    if (byQuadrant[quadrant] != null) return null;
    byQuadrant[quadrant] = tid;
  }
  return byQuadrant.every((tid) => tid != null) ? byQuadrant : null;
}

/** Cards whose complete four-quadrant ticket has rolled. */
function _openedCards(payload) {
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  return cards.filter((c) => _wholeCardTraitIds(c) != null);
}

async function _fetchCards(address, level) {
  return fetchJSON(`/player/${_lower(address)}/tickets/by-trait?level=${level}`);
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Note that `address` just bought tickets at `level`, and seed the revealed set
 * with what has already rolled so only the new ones can pop later.
 *
 * Safe to call more than once for the same level (a ticket leg and a foil leg in
 * one buy): the record merges and the seed is only taken the first time, so a
 * second call cannot mark the first call's tickets as already seen.
 *
 * @param {{address: string, level: number, foilExpected?: boolean,
 *   expectedTickets?: number, sourceKey?: string, settledExpected?: boolean}} args
 */
export async function recordPendingPack({
  address,
  level,
  foilExpected = false,
  expectedTickets = 0,
  sourceKey = null,
  settledExpected = false,
} = {}) {
  const addr = _lower(address);
  const lvl = Number(level);
  if (!addr || !Number.isInteger(lvl) || lvl < 0) return false;
  const expected = _expectedTickets(expectedTickets);
  const source = sourceKey == null ? null : String(sourceKey);

  const pending = _read(PENDING_KEY, []);
  const list = Array.isArray(pending) ? pending : [];
  const already = list.find((p) => p && _lower(p.address) === addr && Number(p.level) === lvl);
  if (already) {
    const sources = new Set(Array.isArray(already.sourceKeys) ? already.sourceKeys.map(String) : []);
    const duplicate = source != null && sources.has(source);
    if (source != null) sources.add(source);
    already.at = _now();
    already.foilExpected = Boolean(already.foilExpected || foilExpected);
    already.settledExpected = Boolean(already.settledExpected || settledExpected);
    if (!duplicate) {
      already.expectedTickets = _expectedTickets(already.expectedTickets) + expected;
    }
    already.sourceKeys = [...sources];
    _write(PENDING_KEY, list);
    _publishWaitingRecords(addr);
    return true;
  }

  // Seed BEFORE recording: everything already rolled at this level is old news.
  let seedPending = false;
  try {
    const payload = await _fetchCards(addr, lvl);
    const hasIncomplete = (Array.isArray(payload?.cards) ? payload.cards : [])
      .some((card) => _wholeCardTraitIds(card) == null);
    _seedOpenedCards(
      addr,
      lvl,
      payload,
      settledExpected && !hasIncomplete ? expected : 0,
    );
  } catch (_e) {
    // Keep a durable record through an API/indexer outage. _inspectOne performs
    // the baseline seed on the first trustworthy response; expectedTickets lets
    // it preserve an already-rolled newest award instead of swallowing it.
    seedPending = true;
  }

  list.push({
    address: addr,
    level: lvl,
    at: _now(),
    foilExpected: Boolean(foilExpected),
    expectedTickets: expected,
    sourceKeys: source == null ? [] : [source],
    settledExpected: Boolean(settledExpected),
    seedPending,
  });
  _write(PENDING_KEY, list);
  _publishWaitingRecords(addr);
  return true;
}

/** Register whole-ticket awards carried by a lootbox result. */
export async function recordLootboxTicketPacks({
  address,
  legs = [],
  sourceKey = null,
  settledExpected = false,
} = {}) {
  const grouped = new Map();
  for (const leg of Array.isArray(legs) ? legs : []) {
    if (leg?.legType !== 'opened') continue;
    const level = Number(leg.futureLevel);
    const count = _expectedTickets(leg.wholeTickets);
    if (!Number.isInteger(level) || level < 0 || count <= 0) continue;
    grouped.set(level, (grouped.get(level) || 0) + count);
  }
  const results = await Promise.all([...grouped.entries()].map(([level, count]) => (
    recordPendingPack({
      address,
      level,
      expectedTickets: count,
      sourceKey: sourceKey == null ? null : `${sourceKey}:L${level}`,
      settledExpected,
    })
  )));
  return results.filter(Boolean).length;
}

/** The outstanding records (test/introspection helper). */
export function pendingPacks() {
  const list = _read(PENDING_KEY, []);
  return Array.isArray(list) ? list : [];
}

function _packKey(address, level) {
  return `${_lower(address)}:${Number(level)}`;
}

/**
 * Complete rolled cards that still belong behind an unopened pack wrapper.
 * Inventory uses this synchronously against the by-trait payload, so even if
 * its fetch beats the 45s watcher poll the new symbols cannot leak early.
 */
export function unopenedPackCardIndexes({ address, level, cards = [] } = {}) {
  const addr = _lower(address);
  const lvl = Number(level);
  if (!addr || !Number.isInteger(lvl)) return new Set();
  const pending = pendingPacks().some((rec) => (
    rec && _lower(rec.address) === addr && Number(rec.level) === lvl
  ));
  if (!pending) return new Set();
  const revealed = _revealedSet(addr, lvl);
  const hidden = new Set();
  for (const card of Array.isArray(cards) ? cards : []) {
    const index = Number(card?.cardIndex);
    if (!Number.isInteger(index) || revealed.has(index)) continue;
    if (_wholeCardTraitIds(card) != null) hidden.add(index);
  }
  return hidden;
}

function _removePendingLevel(address, level) {
  const addr = _lower(address);
  const lvl = Number(level);
  const list = pendingPacks();
  _write(PENDING_KEY, list.filter((rec) => !(
    rec && _lower(rec.address) === addr && Number(rec.level) === lvl
  )));
}

/** Mark one physically opened pack's cards visible to inventory. */
export async function completePackReveal({ address, level, cardIndexes = [] } = {}) {
  const addr = _lower(address);
  const lvl = Number(level);
  const indexes = [...new Set((Array.isArray(cardIndexes) ? cardIndexes : [])
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0))];
  if (!addr || !Number.isInteger(lvl) || indexes.length === 0) return false;

  const revealed = _revealedSet(addr, lvl);
  for (const index of indexes) revealed.add(index);
  _saveRevealed(addr, lvl, revealed);

  const key = _packKey(addr, lvl);
  const active = _activePackCards.get(key);
  if (active) {
    for (const index of indexes) active.delete(index);
    if (active.size === 0) _activePackCards.delete(key);
  }

  // Retire only after the final queued card was opened. A transient partial
  // fourth symbol keeps the purchase record alive for its later pack.
  if (!_activePackCards.has(key)) {
    const rec = pendingPacks().find((row) => (
      row && _lower(row.address) === addr && Number(row.level) === lvl
    ));
    if (rec) {
      const inspected = await _inspectOne(addr, rec);
      if (inspected && !inspected.error && inspected.unseen.length === 0) {
        _removePendingLevel(addr, lvl);
      }
    }
  }
  return true;
}


/** Order-independent key for a 4-trait combo (trait IDs sort by quadrant). */
function _comboKey(ids) {
  return [...ids].map(Number).sort((a, b) => a - b).join(',');
}

/**
 * The level's foil-pack line keys. `complete` distinguishes a real no-pack
 * answer from the indexer lagging behind a just-mined foil purchase; without
 * that distinction the four special lines could be permanently revealed as an
 * ordinary pack before /foil catches up.
 */
async function _foilState(address, level) {
  try {
    const payload = await fetchJSON(`/player/${_lower(address)}/foil?level=${level}`);
    const lines = payload?.present ? payload.lines : null;
    if (!Array.isArray(lines)) return { complete: false, keys: new Set() };
    const valid = lines
      .filter((l) => Array.isArray(l) && l.length === 4 && l.every((t) => t != null));
    return {
      complete: payload?.present === true && valid.length >= 4,
      keys: new Set(valid.map(_comboKey)),
    };
  } catch (_e) {
    return { complete: false, keys: new Set() };
  }
}

async function _inspectOne(address, rec) {
  const level = Number(rec?.level);
  if (!Number.isInteger(level)) return null;
  if (_now() - Number(rec?.at || 0) > PENDING_TTL_MS) {
    return { level, expired: true, ready: false, fresh: [], unseen: [], rec };
  }
  let payload;
  try {
    payload = await _fetchCards(address, level);
  } catch (_e) {
    return { level, error: true, ready: false, fresh: [], unseen: [], rec };
  }
  if (rec.seedPending) {
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    const hasIncomplete = cards.some((card) => _wholeCardTraitIds(card) == null);
    const oldEnough = _now() - Number(rec?.at || 0) >= SEED_RECOVERY_GRACE_MS;
    if (!hasIncomplete && !rec.settledExpected && !oldEnough) {
      return {
        level, rec, seedPending: true, ready: false, fresh: [], unseen: [],
      };
    }
    _seedOpenedCards(
      address,
      level,
      payload,
      !hasIncomplete ? _expectedTickets(rec.expectedTickets) : 0,
    );
    rec.seedPending = false;
    _replacePendingRecord(rec);
  }
  const revealed = _revealedSet(address, level);
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  const unseen = cards.filter((card) => card && !revealed.has(Number(card.cardIndex)));
  const fresh = unseen
    .map((card) => ({ card, traitIds: _wholeCardTraitIds(card) }))
    .filter((item) => item.traitIds != null);
  let foilState = { complete: true, keys: new Set() };
  if (fresh.length > 0) foilState = await _foilState(address, level);
  const foilBlocked = Boolean(rec.foilExpected && !foilState.complete);
  return {
    level, rec, revealed, unseen, fresh, foilState,
    ready: fresh.length > 0 && !foilBlocked,
    foilBlocked,
  };
}

/**
 * Read-only readiness snapshot for the unified pending widget.
 * No reveal is queued and no record is retired here.
 */
export async function inspectPendingPacks({ address } = {}) {
  const addr = _lower(address);
  if (!addr) return [];
  const mine = pendingPacks().filter((rec) => rec && _lower(rec.address) === addr);
  const inspected = await Promise.all(mine.map((rec) => _inspectOne(addr, rec)));
  return inspected.filter(Boolean);
}

async function _publishPackActions(address, publishSeq = null) {
  const addr = _lower(address);
  if (!addr) {
    clearPendingActions(PENDING_SOURCE);
    return;
  }
  const rows = await inspectPendingPacks({ address: addr });
  // A wallet switch can land while the ticket/foil endpoints are in flight.
  // Never let that old response repopulate the shared widget for the prior
  // account.
  if (publishSeq != null && publishSeq !== _publishSeq) return;
  publishPendingActions(PENDING_SOURCE, rows
    .filter((row) => !row.expired)
    .map((row) => {
      const opening = _activePackCards.has(_packKey(addr, row.level));
      return {
      id: `ticket-pack:${row.level}`,
      kind: 'tickets',
      label: `Level ${row.level} ticket pack`,
      shortLabel: 'Open tickets',
      detail: opening
        ? 'Pack opening in progress'
        : row.ready
        ? `${row.fresh.length} ticket${row.fresh.length === 1 ? '' : 's'} ready to reveal`
        : row.foilBlocked
          ? 'Foil tickets are still indexing'
          : `Waiting for the Level ${row.level} draw`,
      state: opening ? 'busy' : row.ready ? 'ready' : 'waiting',
      order: 10,
      run: opening ? null : async () => {
        let current = null;
        try { current = _getAddress ? _getAddress() : null; } catch (_e) { current = null; }
        if (_lower(current) !== addr) return;
        publishPendingActions(PENDING_SOURCE, [{
          id: `ticket-pack:${row.level}`,
          kind: 'tickets',
          label: `Level ${row.level} ticket pack`,
          detail: 'Building your pack reveal',
          state: 'busy',
          order: 10,
        }]);
        await checkPendingPacks({ address: addr, levels: [row.level] });
        try { current = _getAddress ? _getAddress() : null; } catch (_e) { current = null; }
        if (_lower(current) !== addr) return;
        const nextSeq = ++_publishSeq;
        await _publishPackActions(addr, nextSeq);
      },
    };
    }));
}

// ---------------------------------------------------------------------------
// Watching
// ---------------------------------------------------------------------------

/**
 * Check every pending record for `address` and pop a reveal for any card that
 * has rolled since. Returns the number of sequences queued.
 *
 * @param {{address: string}} args
 */
export async function checkPendingPacks({ address, levels = null } = {}) {
  const addr = _lower(address);
  if (!addr) return 0;

  const list = pendingPacks();
  const wanted = Array.isArray(levels)
    ? new Set(levels.map(Number).filter(Number.isFinite))
    : null;
  const mine = list.filter((p) => (
    p
    && _lower(p.address) === addr
    && (!wanted || wanted.has(Number(p.level)))
  ));
  if (mine.length === 0) return 0;

  let queued = 0;
  const done = new Set();

  for (const rec of mine) {
    const lvl = Number(rec.level);
    const activeKey = _packKey(addr, lvl);
    if (_activePackCards.has(activeKey)) continue;
    const inspected = await _inspectOne(addr, rec);
    if (!inspected) continue;
    if (inspected.expired) {
      done.add(`${lvl}`);
      continue;
    }
    if (inspected.error) continue;
    const {
      revealed, unseen, fresh, foilState, foilBlocked,
    } = inspected;
    if (fresh.length === 0) continue;

    // Foil lines are ordinary entries in by-trait, so /foil is what identifies
    // them; keyed order-independently since the two endpoints need not agree on
    // entry order.
    // A successful foil buy explicitly marks the pending record. Wait for all
    // four /foil lines before classifying anything; the tickets endpoint often
    // wins this indexing race by a few blocks.
    if (foilBlocked) continue;
    const foilKeys = foilState.keys;
    const tickets = fresh.map(({ card, traitIds }) => {
      return {
        traitIds,
        foil: foilKeys.has(_comboKey(traitIds)),
        cardIndex: Number(card.cardIndex),
      };
    });

    // Ordinary tickets open first; foil lines get a separate, unmistakable
    // wrapper and presentation as the special final pack. Each series keeps
    // its own OPEN ALL batch so choosing the fast path for ordinary packs does
    // not skip the foil opening beat.
    const groups = [
      { foilPack: false, tickets: tickets.filter((ticket) => !ticket.foil) },
      { foilPack: true, tickets: tickets.filter((ticket) => ticket.foil) },
    ];
    let queuedForRecord = 0;
    for (const group of groups) {
      if (group.tickets.length === 0) continue;
      const packCount = Math.ceil(group.tickets.length / MAX_TICKETS_PER_PACK);
      const batchId = `${addr}:${lvl}:${Number(rec.at || 0)}:${group.foilPack ? 'foil' : 'standard'}`;
      for (let i = 0; i < packCount; i++) {
        const packTickets = group.tickets.slice(
          i * MAX_TICKETS_PER_PACK,
          (i + 1) * MAX_TICKETS_PER_PACK,
        );
        queueReveal({
          kind: 'pack',
          title: group.foilPack ? `FOIL PACK · LEVEL ${lvl}` : `LEVEL ${lvl} TICKETS`,
          level: lvl,
          foilPack: group.foilPack,
          tickets: packTickets,
          count: packTickets.length,
          totalCount: group.tickets.length,
          batchId,
          packIndex: i + 1,
          packCount,
          packRelease: {
            address: addr,
            level: lvl,
            cardIndexes: packTickets.map((ticket) => ticket.cardIndex),
          },
        });
        queued += 1;
        queuedForRecord += 1;
      }
    }
    if (queuedForRecord > 0) {
      _activePackCards.set(activeKey, new Set(tickets.map((ticket) => ticket.cardIndex)));
    }
  }

  if (done.size > 0) {
    _write(PENDING_KEY, list.filter(
      (p) => !(p && _lower(p.address) === addr && done.has(`${Number(p.level)}`)),
    ));
  }
  return queued;
}

/**
 * Start the poll loop. `getAddress` is read each tick so a wallet switch is
 * picked up without a restart.
 *
 * @param {{getAddress: function(): (string|null)}} args
 */
export function startPackWatch({ getAddress } = {}) {
  if (_running || typeof setInterval !== 'function') return;
  _running = true;
  _getAddress = typeof getAddress === 'function' ? getAddress : null;
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    _completeListener = (event) => {
      const detail = event?.detail;
      completePackReveal(detail).finally(() => {
        const addr = _lower(detail?.address);
        if (addr) _publishPackActions(addr, ++_publishSeq).catch(() => {});
      });
    };
    _abortListener = (event) => {
      for (const release of Array.isArray(event?.detail?.releases)
        ? event.detail.releases : []) {
        _activePackCards.delete(_packKey(release?.address, release?.level));
      }
      let addr = null;
      try { addr = _getAddress ? _getAddress() : null; } catch (_e) { addr = null; }
      if (addr) _publishPackActions(addr, ++_publishSeq).catch(() => {});
    };
    document.addEventListener(PACK_REVEAL_COMPLETE_EVENT, _completeListener);
    document.addEventListener(PACK_REVEAL_ABORT_EVENT, _abortListener);
  }
  _timer = setInterval(refreshPackWatch, WATCH_INTERVAL_MS);
  if (_timer && typeof _timer.unref === 'function') {
    try { _timer.unref(); } catch (_e) { /* defensive */ }
  }
  refreshPackWatch();
}

/** Re-check immediately (wallet switch + successful purchase). */
export function refreshPackWatch() {
  if (!_running) return;
  let addr = null;
  try { addr = _getAddress ? _getAddress() : null; } catch (_e) { addr = null; }
  const seq = ++_publishSeq;
  if (!addr) {
    clearPendingActions(PENDING_SOURCE);
    return;
  }
  _publishPackActions(addr, seq).catch(() => {});
}

/** Stop the loop (tests + teardown). */
export function stopPackWatch() {
  if (_timer != null) {
    try { clearInterval(_timer); } catch (_e) { /* defensive */ }
  }
  _timer = null;
  _running = false;
  _getAddress = null;
  if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
    if (_completeListener) document.removeEventListener(PACK_REVEAL_COMPLETE_EVENT, _completeListener);
    if (_abortListener) document.removeEventListener(PACK_REVEAL_ABORT_EVENT, _abortListener);
  }
  _completeListener = null;
  _abortListener = null;
  _activePackCards.clear();
  _publishSeq += 1;
  clearPendingActions(PENDING_SOURCE);
}
