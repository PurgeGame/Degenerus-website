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

import { CHAIN, CONTRACTS } from './chain-config.js';
import { sharedReadProvider } from './read-provider.js';
import { getProvider, ethers } from './contracts.js';
import { fetchJSON } from './api.js';
import { get } from './store.js';
import { readGameState } from './game-state.js';
import { publishPendingActions, clearPendingActions } from './pending-actions.js';
import { dgnPartitionTicketEntries } from './dgn-traits.js';
import {
  JACKPOT_TICKET_PROCESSING_LEVELS,
  jackpotProcessingCoversLevel,
  unresolvedJackpotContext,
} from './jackpot-spoiler.js';
import {
  queueReveal,
  PACK_REVEAL_COMPLETE_EVENT,
  PACK_REVEAL_ABORT_EVENT,
} from '../components/reveal-overlay.js';

// Local reveal state is contract-deployment state, not merely chain state.
// Testnet reuses level numbers and player addresses on every run; carrying a
// chain-only Level 1 record across a redeploy creates a pack that can never be
// satisfied by the new GAME.
const DEPLOY_SCOPE = Number.isInteger(Number(CHAIN.deployBlock))
  ? Number(CHAIN.deployBlock)
  : 'unscoped';
const PENDING_KEY = `pack_pending_${CHAIN.id}_${DEPLOY_SCOPE}`;
const REVEALED_KEY = `pack_revealed_${CHAIN.id}_${DEPLOY_SCOPE}`;
const JACKPOT_AWARD_KEY = `pack_jackpot_awards_${CHAIN.id}_${DEPLOY_SCOPE}`;
const LEGACY_PENDING_KEY = `pack_pending_${CHAIN.id}`;
const PENDING_SOURCE = 'ticket-packs';
const ENTRIES_PER_TICKET = 4;
const LIVE_TICKET_WINDOW = JACKPOT_TICKET_PROCESSING_LEVELS;
const ENTRIES_OWED_ABI = [
  'function entriesOwedView(uint24 lvl, address player) view returns (uint32)',
];

// A physical-feeling pack stays readable at ten tickets. Larger drops are
// split into a batch of packs; reveal-overlay lets the player open each one or
// switch the remaining batch to OPEN ALL.
// A reveal hand is an exact 3×3. Large buys keep opening as sequential hands
// (with OPEN ALL available), so the grid never creates a short fourth column.
export const MAX_TICKETS_PER_PACK = 9;
export const FOIL_TICKETS_PER_PACK = 4;
// Foil lines are materialized in their own on-chain/indexed stream and do not
// have card indexes in /tickets/by-trait. Give the four presentation receipts
// stable per-level sentinels in the revealed set so opening a foil pack remains
// durable without pretending those lines came from the generic card feed.
const FOIL_CARD_INDEX_BASE = 0x7FFF_FF00;

// Traits roll at the level draw, so there is nothing to gain from a tight poll.
const WATCH_INTERVAL_MS = 45_000;
const SEED_RECOVERY_GRACE_MS = 120_000;
const INDEXED_AWARD_SEED_GRACE_MS = 2_000;
// A completed ticket batch normally reaches the REST projection a block or two
// after entriesOwedView reaches zero. Poll that short hand-off promptly instead
// of leaving a processed pack painted as Pending until the ordinary 45s watch.
const INDEX_CATCHUP_RETRY_MS = 2_500;
const INDEX_CATCHUP_WINDOW_MS = 120_000;
// A wallet can retain several durable pack receipts, but opening one network
// request per receipt at once turns a reconnect/day boundary into an API burst.
// Two workers match the REST broker's background lane and leave its interaction
// lane free for the jackpot button and other explicit player actions.
const PACK_INSPECTION_CONCURRENCY = 2;

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
let _entriesOwedReaderForTest = null;
let _entriesOwedFallbackProvider = null;
const _historyBackfilled = new Set();
let _awardSeedTimer = null;
let _indexCatchupTimer = null;
let _refreshFlight = null;
let _refreshQueued = false;
// In-memory only: a reload deliberately forgets the active presentation while
// the durable pending record remains, so the tray offers the unopened pack
// again instead of hiding its tickets forever.
const _activePackCards = new Map();
let _completeListener = null;
let _abortListener = null;
let _jackpotRevealListener = null;
const _revealedJackpotDays = new Set();

/** Test-only: pin the clock used for TTL expiry. */
export function __setClockForTest(fn) { _now = fn || (() => Date.now()); }

/** Test-only: inject the exact entriesOwedView(level, player) projection. */
export function __setEntriesOwedReaderForTest(fn) {
  _entriesOwedReaderForTest = typeof fn === 'function' ? fn : null;
}

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
  return new Set(Array.isArray(list) ? list.map(String) : []);
}

function _saveRevealed(address, level, set) {
  _write(_revealedKey(address, level), Array.from(set));
}

function _expectedTickets(value) {
  const n = Math.floor(Number(value) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function _expectedEntries(value) {
  const n = Math.round((Number(value) || 0) * ENTRIES_PER_TICKET);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function _ticketCountFromEntries(value) {
  const entries = Math.max(0, Math.floor(Number(value) || 0));
  return entries > 0 ? entries / ENTRIES_PER_TICKET : 0;
}

function _pendingPackPreviews(rows) {
  const previews = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const level = Number(row?.level);
    if (!Number.isInteger(level) || level < 0) continue;
    let remaining = _ticketCountFromEntries(row?.pendingEntries);
    const foilCount = row?.foilBlocked
      ? Math.min(FOIL_TICKETS_PER_PACK, remaining)
      : 0;
    remaining = Math.max(0, remaining - foilCount);

    // Pending is an inventory summary, not a preview of every future 3x3
    // opening hand. Keep the full unresolved standard balance together.
    if (remaining > 0) previews.push({ level, count: remaining, foilPack: false });
    if (foilCount > 0) previews.push({ level, count: foilCount, foilPack: true });

    // A legacy/failed-read record can prove that a pack exists without yet
    // knowing its exact entry count. Still show which level it will become.
    if (Number(row?.pendingEntries) === 0 && row?.ready !== true) {
      const expectedEntries = Math.max(
        _expectedEntries(row?.rec?.expectedTickets),
        Math.floor(Number(row?.rec?.expectedEntries) || 0),
      );
      if (expectedEntries === 0) previews.push({ level, count: null, foilPack: false });
    }
  }
  // Coalesce any duplicate records defensively. Standard and foil packs stay
  // distinct because they have different wrappers and reveal paths.
  const consolidated = new Map();
  for (const preview of previews) {
    const key = `${preview.level}:${preview.foilPack ? 'foil' : 'standard'}`;
    const current = consolidated.get(key);
    if (!current) {
      consolidated.set(key, { ...preview });
      continue;
    }
    current.count = current.count == null || preview.count == null
      ? null
      : current.count + preview.count;
  }

  // Preserve chronology within each kind, with special foil packs after the
  // ordinary level balances. Actual OPEN ALL hands still split at nine below.
  const grouped = [...consolidated.values()];
  return [
    ...grouped.filter((preview) => !preview.foilPack),
    ...grouped.filter((preview) => preview.foilPack),
  ];
}

// Pending rows are level-scoped, so a later ordinary purchase can merge into
// a row that already expects a foil add-on. Keep those two facts separate:
// `foilExpected` means the foil endpoint must catch up; `standardExpected`
// controls whether the shared tray describes this as an ordinary/mixed pack.
// Legacy rows did not preserve that distinction, so migrate them to neutral
// ticket-pack wording instead of risking the exact false "foil" label that
// prompted this fix. New foil-only rows explicitly persist false.
function _standardPackExpected(rec) {
  if (typeof rec?.standardExpected === 'boolean') return rec.standardExpected;
  return true;
}

// CLEAR tombstones the particular level receipt, not the reusable visual id.
// Include the durable expected-entry total so a genuinely new purchase at the
// same level can still create a new reminder after an older stuck receipt was
// explicitly cleared.
function _packDismissKey(row) {
  const level = Number(row?.level);
  const expectedEntries = Math.max(
    _expectedEntries(row?.rec?.expectedTickets),
    Math.max(0, Math.floor(Number(row?.rec?.expectedEntries) || 0)),
  );
  const packKind = row?.rec?.foilExpected === true ? 'with-foil' : 'standard';
  return `ticket-pack:${level}:entries-${expectedEntries || 'unknown'}:${packKind}`;
}

function _seedOpenedCards(address, level, payload, keepNewestEntries = 0) {
  const opened = _openedPieces(payload);
  let keep = Math.max(0, Math.floor(Number(keepNewestEntries) || 0));
  let firstKept = opened.length;
  while (firstKept > 0 && keep > 0) {
    firstKept -= 1;
    keep = Math.max(0, keep - opened[firstKept].entryCount);
  }
  const seed = _revealedSet(address, level);
  for (const piece of opened.slice(0, firstKept)) {
    seed.add(String(piece.key));
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

/** Finalized reveal pieces, including legitimate one-entry ticket quarters. */
function _openedPieces(payload) {
  const cards = (Array.isArray(payload?.cards) ? payload.cards : [])
    .filter((card) => card?.status === 'opened');
  const partitioned = dgnPartitionTicketEntries(cards);
  return [
    ...partitioned.tickets.map((ticket) => ({
      ...ticket,
      kind: 'ticket',
      entryCount: ENTRIES_PER_TICKET,
      order: Math.min(...ticket.entryIds.map((id) => Number(id)).filter(Number.isFinite)),
    })),
    ...partitioned.entries.map((entry) => ({
      ...entry,
      kind: 'entry',
      entryCount: 1,
      order: Number(entry.entryId),
    })),
  ].sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : Number(a.cardIndexes?.[0] ?? a.cardIndex ?? 0) * 4;
    const bo = Number.isFinite(b.order) ? b.order : Number(b.cardIndexes?.[0] ?? b.cardIndex ?? 0) * 4;
    return ao - bo || String(a.key).localeCompare(String(b.key));
  });
}

// A level under the unresolved floor has finished its draw and drained its
// ticket queue, so no further entry can be filed against it. Pack inspection
// now discards those completed-level receipts before touching the endpoint;
// retain this small session cache for callers that inspect without a usable
// game-state boundary.
const _settledCards = new Map();   // `${addr}:${level}` -> by-trait payload

/** Drop the settled-level payloads (test seam + teardown). */
export function clearSettledCardCache() {
  _settledCards.clear();
}

async function _fetchCards(address, level, { settled = false } = {}) {
  const key = `${_lower(address)}:${Number(level)}`;
  if (settled && _settledCards.has(key)) return _settledCards.get(key);
  // This watcher is a transition detector, not a render-wave consumer: a
  // receipt can be indexed between two adjacent checks. Bypass only the
  // completed-response window while retaining shared in-flight coalescing.
  const payload = await fetchJSON(
    `/player/${_lower(address)}/tickets/by-trait?level=${level}`,
    { force: true },
  );
  if (settled) _settledCards.set(key, payload);
  return payload;
}

/**
 * First level whose tickets can still participate in a future draw.
 * A final RNG lock alone does not retire the level: its entries remain live
 * until the phase transition actually begins.
 */
function _unresolvedTicketFloor(gameState) {
  const level = Number(gameState?.level);
  if (!Number.isInteger(level) || level < 0 || gameState?.gameOver === true) return null;
  if (gameState?.phaseTransitionActive === true) return level + 1;
  const jackpotPhase = Boolean(
    gameState?.jackpotPhaseFlag ?? (gameState?.phase === 'JACKPOT'),
  );
  if (jackpotPhase || gameState?.rngLockedFlag === true) return level;
  return level + 1;
}

/**
 * Levels in the contract's six-key live processing window that have not
 * already completed their final draw.
 */
export function pendingTicketDrainLevels(gameState) {
  const level = Number(gameState?.level);
  const floor = _unresolvedTicketFloor(gameState);
  if (!Number.isInteger(level) || level < 0 || floor == null) return [];
  return Array.from({ length: LIVE_TICKET_WINDOW }, (_unused, offset) => level + offset)
    .filter((candidate) => candidate >= floor);
}

/**
 * The band a pending record can actually learn anything from.
 *
 * `cap` is the top of the contract's six-key sweep. Entries for a level past it
 * have not been generated, so /tickets/by-trait can only answer "nothing yet" —
 * and a far-future ticket buy leaves a record that would poll that guaranteed
 * answer every 45 seconds until its level goes live, which is weeks out at
 * mainnet pace. `settledBelow` is the unresolved floor: under it a level's draw
 * is done and its payload will not change again.
 *
 * Both are null when the snapshot is missing, which reads as "no gate" — an
 * unknown game state must never suppress a reveal.
 */
export function packInspectionWindow(gameState) {
  const level = Number(gameState?.level);
  if (!Number.isInteger(level) || level < 0) return { cap: null, settledBelow: null };
  return { cap: level + LIVE_TICKET_WINDOW - 1, settledBelow: _unresolvedTicketFloor(gameState) };
}

async function _readEntriesOwed(address, levels) {
  const wanted = Array.isArray(levels) ? levels : [];
  if (wanted.length === 0) return [];

  let reader = _entriesOwedReaderForTest;
  let walletProvider = null;
  if (!reader) {
    walletProvider = getProvider();
    if (!walletProvider || !CONTRACTS.GAME) return [];
    try {
      const contract = new ethers.Contract(CONTRACTS.GAME, ENTRIES_OWED_ABI, walletProvider);
      if (typeof contract.entriesOwedView !== 'function') return [];
      reader = (player, level) => contract.entriesOwedView(level, player);
    } catch (_e) {
      return [];
    }
  }

  const readLevel = async (read, level) => {
    const raw = await read(address, level);
    const entries = Number(BigInt(raw ?? 0));
    if (!Number.isSafeInteger(entries) || entries < 0) throw new Error('Invalid entries owed');
    return { level, entries };
  };
  const reads = await Promise.allSettled(wanted.map((level) => readLevel(reader, level)));
  const rows = reads
    .filter((read) => read.status === 'fulfilled')
    .map((read) => read.value);

  // Injected wallet RPCs occasionally reject a parallel eth_call while the
  // wallet itself remains connected. A rejected zero-refresh used to preserve
  // the previous non-zero chainOwedEntries forever, manufacturing packs that
  // still looked queued after the boundary. Retry only the failed levels on the
  // configured public read RPC; successful wallet answers stay untouched.
  if (!_entriesOwedReaderForTest && reads.some((read) => read.status === 'rejected')) {
    try {
      if (!_entriesOwedFallbackProvider && CHAIN.rpcUrl) {
        _entriesOwedFallbackProvider = sharedReadProvider();  // C15: shared batched read stream
      }
      if (_entriesOwedFallbackProvider) {
        const fallbackContract = new ethers.Contract(
          CONTRACTS.GAME,
          ENTRIES_OWED_ABI,
          _entriesOwedFallbackProvider,
        );
        const fallbackReader = (player, level) => fallbackContract.entriesOwedView(level, player);
        const failedLevels = wanted.filter((_level, index) => reads[index].status === 'rejected');
        const retries = await Promise.allSettled(
          failedLevels.map((level) => readLevel(fallbackReader, level)),
        );
        rows.push(...retries
          .filter((read) => read.status === 'fulfilled')
          .map((read) => read.value));
      }
    } catch (_e) {
      // Keep the fulfilled wallet reads. A failed fallback is unknown, never an
      // invented zero, and the next watch tick retries naturally.
    }
  }
  return rows;
}

/**
 * Discover queue-backed packs even when this browser did not witness the tx.
 * Existing purchase/lootbox records are upgraded in place rather than added
 * again, since entriesOwedView describes those same tickets.
 */
async function _syncChainOwedRecords(address, levels, { jackpotContext = null } = {}) {
  const owedRows = await _readEntriesOwed(address, levels);
  if (owedRows.length === 0) return;

  const addr = _lower(address);
  const list = pendingPacks();
  let changed = false;
  for (const { level, entries } of owedRows) {
    let rec = list.find((row) => (
      row && _lower(row.address) === addr && Number(row.level) === Number(level)
    ));
    if (!rec && entries <= 0) continue;

    const coveredByJackpot = jackpotProcessingCoversLevel(level, jackpotContext);
    // A queue entry first discovered after the daily request has no purchase
    // receipt tying it to player-started work. During this narrow window it is
    // overwhelmingly the just-materialized jackpot award, so defer discovery
    // until the board opens instead of publishing its exact amount as a spoiler.
    if (!rec && coveredByJackpot) continue;

    if (!rec) {
      let seedPending = false;
      try {
        const payload = await _fetchCards(addr, level);
        _seedOpenedCards(addr, level, payload, 0);
      } catch (_e) {
        seedPending = true;
      }
      rec = {
        address: addr,
        level,
        at: _now(),
        standardExpected: true,
        foilExpected: false,
        expectedTickets: _ticketCountFromEntries(entries),
        expectedEntries: entries,
        releasedEntries: 0,
        sourceKeys: [`chain-owed:L${level}`],
        settledExpected: false,
        seedPending,
        chainTracked: true,
        chainOwedEntries: entries,
      };
      list.push(rec);
      changed = true;
      continue;
    }

    const released = Math.max(0, Math.floor(Number(rec.releasedEntries) || 0));
    const previousExpected = Math.max(
      _expectedEntries(rec.expectedTickets),
      Math.floor(Number(rec.expectedEntries) || 0),
    );
    const previousOwed = Math.max(0, Math.floor(Number(rec.chainOwedEntries) || 0));
    // Existing receipt-backed purchases stay visible. Only an unexplained
    // increase above their known outstanding amount is held behind the board.
    const knownOutstanding = Math.max(previousOwed, previousExpected - released);
    const visibleEntries = coveredByJackpot
      ? Math.min(entries, knownOutstanding)
      : entries;
    const expectedEntries = Math.max(previousExpected, released + visibleEntries);
    const previousDrainedAt = Math.max(0, Number(rec.chainDrainedAt) || 0);
    const chainDrainedAt = visibleEntries > 0
      ? 0
      : previousOwed > 0 || !rec.chainTracked || previousDrainedAt === 0
        ? _now()
        : previousDrainedAt;
    const next = {
      chainTracked: true,
      chainOwedEntries: visibleEntries,
      chainDrainedAt,
      expectedEntries,
      expectedTickets: _ticketCountFromEntries(expectedEntries),
      standardExpected: Boolean(_standardPackExpected(rec) || visibleEntries > 0),
    };
    for (const [key, value] of Object.entries(next)) {
      if (rec[key] === value) continue;
      rec[key] = value;
      changed = true;
    }
  }
  if (changed) _write(PENDING_KEY, list);
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
 *   standardExpected?: boolean,
 *   expectedTickets?: number, sourceKey?: string, settledExpected?: boolean,
 *   preserveNewestEntries?: number, deferSeedMs?: number,
 *   chainExpectedOverlap?: boolean,
 *   publish?: boolean}} args
 */
export async function recordPendingPack({
  address,
  level,
  foilExpected = false,
  standardExpected = true,
  expectedTickets = 0,
  sourceKey = null,
  settledExpected = false,
  preserveNewestEntries = 0,
  deferSeedMs = 0,
  chainExpectedOverlap = false,
  publish = true,
} = {}) {
  const addr = _lower(address);
  const lvl = Number(level);
  if (!addr || !Number.isInteger(lvl) || lvl < 0) return false;
  const expectedEntryCount = _expectedEntries(expectedTickets);
  const expected = _ticketCountFromEntries(expectedEntryCount);
  const source = sourceKey == null ? null : String(sourceKey);

  const pending = _read(PENDING_KEY, []);
  const list = Array.isArray(pending) ? pending : [];
  const already = list.find((p) => p && _lower(p.address) === addr && Number(p.level) === lvl);
  if (already) {
    const sources = new Set(Array.isArray(already.sourceKeys) ? already.sourceKeys.map(String) : []);
    const duplicate = source != null && sources.has(source);
    if (source != null) sources.add(source);
    already.at = _now();
    already.standardExpected = Boolean(
      _standardPackExpected(already) || standardExpected,
    );
    already.foilExpected = Boolean(already.foilExpected || foilExpected);
    already.settledExpected = Boolean(already.settledExpected || settledExpected);
    if (!duplicate) {
      const previousEntries = Math.max(
        _expectedEntries(already.expectedTickets),
        Math.floor(Number(already.expectedEntries) || 0),
      );
      already.expectedEntries = chainExpectedOverlap && already.chainTracked
        ? Math.max(previousEntries, Math.max(0, Number(already.releasedEntries) || 0) + expectedEntryCount)
        : previousEntries + expectedEntryCount;
      already.expectedTickets = _ticketCountFromEntries(already.expectedEntries);
    }
    if (already.seedPending && preserveNewestEntries > 0) {
      // A pre-existing record whose baseline fetch failed must preserve every
      // receipt-backed entry now merged into it, not seed the jackpot hand away
      // when the API recovers.
      already.seedPreserveEntries = Math.max(
        Math.max(0, Math.floor(Number(already.seedPreserveEntries) || 0)),
        Math.max(0, Math.floor(Number(already.expectedEntries) || 0)),
      );
      if (deferSeedMs > 0) {
        already.seedNotBefore = Math.max(
          Math.max(0, Number(already.seedNotBefore) || 0),
          _now() + Number(deferSeedMs),
        );
      }
    }
    already.sourceKeys = [...sources];
    _write(PENDING_KEY, list);
    if (publish) await _publishPackActions(addr, ++_publishSeq);
    return true;
  }

  // Seed BEFORE recording: everything already rolled at this level is old news.
  let seedPending = Math.max(0, Number(deferSeedMs) || 0) > 0;
  if (!seedPending) {
    try {
      const payload = await _fetchCards(addr, lvl);
      const hasIncomplete = (Array.isArray(payload?.cards) ? payload.cards : [])
        .some((card) => _wholeCardTraitIds(card) == null);
      _seedOpenedCards(
        addr,
        lvl,
        payload,
        // The indexer can beat the receipt callback. When every card is already
        // complete, the newest expected tickets are the just-confirmed award,
        // not old inventory to seed away. This applies to ordinary purchases as
        // well as historical/settled recovery.
        preserveNewestEntries > 0
          ? Math.max(0, Math.floor(Number(preserveNewestEntries) || 0))
          : !hasIncomplete ? expectedEntryCount : 0,
      );
    } catch (_e) {
      // Keep a durable record through an API/indexer outage. _inspectOne performs
      // the baseline seed on the first trustworthy response; expectedTickets lets
      // it preserve an already-rolled newest award instead of swallowing it.
      seedPending = true;
    }
  }

  list.push({
    address: addr,
    level: lvl,
    at: _now(),
    standardExpected: Boolean(standardExpected),
    foilExpected: Boolean(foilExpected),
    expectedTickets: expected,
    expectedEntries: expectedEntryCount,
    releasedEntries: 0,
    sourceKeys: source == null ? [] : [source],
    settledExpected: Boolean(settledExpected),
    seedPending,
    seedPreserveEntries: Math.max(0, Math.floor(Number(preserveNewestEntries) || 0)),
    seedNotBefore: seedPending && deferSeedMs > 0 ? _now() + Number(deferSeedMs) : 0,
  });
  _write(PENDING_KEY, list);
  if (publish) await _publishPackActions(addr, ++_publishSeq);
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

function _jackpotAwardLedgerKey(address) {
  return `${JACKPOT_AWARD_KEY}_${_lower(address)}`;
}

function _jackpotAwardLedger(address) {
  const rows = _read(_jackpotAwardLedgerKey(address), []);
  return Array.isArray(rows) ? rows : [];
}

function _saveJackpotAwardLedger(address, rows) {
  _write(_jackpotAwardLedgerKey(address), Array.isArray(rows) ? rows : []);
}

// Jackpot ticket awards are indexed as soon as the contract draw resolves,
// which is earlier than the player-facing spin/scratch. Do not let either the
// history ledger or entriesOwedView turn that result into a Pending spoiler.
// `jackpot_complete_day` is written after every main/bonus scratch is finished;
// the spun-without-bonus-pending fallback preserves compatibility with days
// revealed before the explicit completion key existed.
function _jackpotAwardDayRevealed(dayValue) {
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0) return true;
  if (_revealedJackpotDays.has(day)) return true;
  try {
    if (localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_${day}`) === '1') return true;
    return localStorage.getItem(`spun_day_${CHAIN.id}_${day}`) === '1'
      && localStorage.getItem(`jackpot_bonus_pending_day_${CHAIN.id}_${day}`) !== '1';
  } catch (_e) {
    return false;
  }
}

function _unrevealedJackpotAwardEntries(address, level) {
  const addr = _lower(address);
  const lvl = Number(level);
  if (!addr || !Number.isInteger(lvl)) return 0;
  return _jackpotAwardLedger(addr).reduce((sum, award) => {
    if (Number(award?.level) !== lvl || _jackpotAwardDayRevealed(award?.day)) return sum;
    return sum + Math.max(0, Math.floor(Number(award?.totalEntries) || 0));
  }, 0);
}

function _safeEntryCount(value, multiplier = 1) {
  try {
    const count = BigInt(value ?? 0) * BigInt(multiplier ?? 1);
    if (count <= 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) return 0;
    return Number(count);
  } catch (_e) {
    return 0;
  }
}

function _ticketAwardRows({ address, payload = null, wins = null } = {}) {
  const addr = _lower(address);
  if (!addr) return [];
  const grouped = new Map();
  const add = (dayValue, levelValue, entriesValue) => {
    const day = Number(dayValue);
    const level = Number(levelValue);
    const entries = Math.max(0, Math.floor(Number(entriesValue) || 0));
    if (!Number.isInteger(day) || day <= 0
      || !Number.isInteger(level) || level < 0 || entries <= 0) return;
    const key = `${day}:L${level}`;
    grouped.set(key, {
      key, day, level,
      totalEntries: (grouped.get(key)?.totalEntries || 0) + entries,
    });
  };

  if (payload && Number(payload?.day) > 0) {
    const winner = (Array.isArray(payload?.winners) ? payload.winners : [])
      .find((row) => _lower(row?.address) === addr);
    for (const row of Array.isArray(winner?.breakdown) ? winner.breakdown : []) {
      const awardType = String(row?.awardType || '').toLowerCase();
      if (!['ticket', 'tickets', 'tickets_baf'].includes(awardType)) continue;
      add(payload.day, row.level, _safeEntryCount(row.amount, row.count));
    }
  }

  for (const row of Array.isArray(wins) ? wins : []) {
    const awardType = String(row?.awardType || '').toLowerCase();
    if (!['ticket', 'tickets', 'tickets_baf'].includes(awardType)) continue;
    add(row.day, row.level, _safeEntryCount(row.amount));
  }
  return [...grouped.values()];
}

/**
 * Durably remember indexed jackpot ticket awards. Repeated 15-second jackpot
 * payloads are idempotent; a later, fuller history response only contributes
 * the positive delta that was absent from the earlier summary.
 */
export function ingestJackpotTicketAwards({ address, payload = null, wins = null } = {}) {
  const addr = _lower(address);
  if (!addr) return 0;
  const incoming = _ticketAwardRows({ address: addr, payload, wins });
  if (incoming.length === 0) return 0;
  const ledger = _jackpotAwardLedger(addr);
  let changed = 0;
  for (const award of incoming) {
    const existing = ledger.find((row) => row?.key === award.key);
    if (!existing) {
      ledger.push({
        ...award,
        recordedEntries: 0,
        at: _now(),
      });
      changed += 1;
      continue;
    }
    const nextTotal = Math.max(
      Math.max(0, Math.floor(Number(existing.totalEntries) || 0)),
      award.totalEntries,
    );
    if (nextTotal === Number(existing.totalEntries)) continue;
    existing.totalEntries = nextTotal;
    existing.at = _now();
    changed += 1;
  }
  if (changed > 0) _saveJackpotAwardLedger(addr, ledger);
  return changed;
}

/** One lightweight catch-up read per connected wallet/resolved day. */
export async function backfillRecentJackpotTicketAwards({ address, day = null } = {}) {
  const addr = _lower(address);
  const requestedDay = Number(day);
  const dayKey = Number.isInteger(requestedDay) && requestedDay > 0
    ? String(requestedDay)
    : 'latest';
  const backfillKey = `${addr}:${dayKey}`;
  if (!addr || _historyBackfilled.has(backfillKey)) return 0;
  _historyBackfilled.add(backfillKey);
  let payload;
  try { payload = await fetchJSON(`/player/${addr}/jackpot-history`, { force: true }); }
  catch (_e) {
    // Allow a later reconnect to retry an outage; successful sessions stay at
    // one read regardless of the 15-second polling cadence.
    _historyBackfilled.delete(backfillKey);
    return 0;
  }
  const wins = Array.isArray(payload?.wins) ? payload.wins : [];
  const latestDay = wins.reduce((latest, row) => {
    const day = Number(row?.day);
    return Number.isInteger(day) && day > latest ? day : latest;
  }, 0);
  const targetDay = Number.isInteger(requestedDay) && requestedDay > 0
    ? requestedDay
    : latestDay;
  const recent = targetDay > 0
    ? wins.filter((row) => {
      const rowDay = Number(row?.day);
      return rowDay >= targetDay - 1 && rowDay <= targetDay;
    })
    : [];
  const changed = ingestJackpotTicketAwards({ address: addr, wins: recent });
  if (changed > 0) refreshPackWatch();
  return changed;
}

async function _releaseJackpotTicketAwards(address, levels) {
  const addr = _lower(address);
  const live = new Set((Array.isArray(levels) ? levels : []).map(Number));
  if (!addr || live.size === 0) return 0;
  const ledger = _jackpotAwardLedger(addr);
  let released = 0;
  let changed = false;
  for (const award of ledger) {
    if (!live.has(Number(award?.level))) continue;
    if (!_jackpotAwardDayRevealed(award?.day)) continue;
    const totalEntries = Math.max(0, Math.floor(Number(award?.totalEntries) || 0));
    const recordedEntries = Math.max(0, Math.floor(Number(award?.recordedEntries) || 0));
    const deltaEntries = totalEntries - recordedEntries;
    if (deltaEntries <= 0) continue;
    const ok = await recordPendingPack({
      address: addr,
      level: Number(award.level),
      expectedTickets: _ticketCountFromEntries(deltaEntries),
      sourceKey: `jackpot-award:${award.key}:${totalEntries}`,
      settledExpected: true,
      preserveNewestEntries: deltaEntries,
      deferSeedMs: INDEXED_AWARD_SEED_GRACE_MS,
      chainExpectedOverlap: true,
      publish: false,
    });
    if (!ok) continue;
    award.recordedEntries = totalEntries;
    changed = true;
    released += deltaEntries;
  }
  if (changed) {
    _saveJackpotAwardLedger(addr, ledger);
    if (_awardSeedTimer == null && typeof setTimeout === 'function') {
      _awardSeedTimer = setTimeout(() => {
        _awardSeedTimer = null;
        refreshPackWatch();
      }, INDEXED_AWARD_SEED_GRACE_MS + 50);
      if (_awardSeedTimer && typeof _awardSeedTimer.unref === 'function') {
        try { _awardSeedTimer.unref(); } catch (_e) { /* browser timer */ }
      }
    }
  }
  return released;
}

/** The outstanding records (test/introspection helper). */
export function pendingPacks() {
  // The old chain-only key cannot be safely migrated: its level/card indexes
  // may refer to a different GAME at the same deterministic addresses.
  try { localStorage.removeItem(LEGACY_PENDING_KEY); } catch (_e) { /* private mode */ }
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
    if (!Number.isInteger(index) || revealed.has(String(index))) continue;
    if (_wholeCardTraitIds(card) != null) hidden.add(index);
  }
  return hidden;
}

/** Stable whole-ticket and loose-entry keys still hidden behind a pack opener. */
export function unopenedPackItemKeys({ address, level, cards = [] } = {}) {
  const addr = _lower(address);
  const lvl = Number(level);
  if (!addr || !Number.isInteger(lvl)) return new Set();
  const pending = pendingPacks().some((rec) => (
    rec && _lower(rec.address) === addr && Number(rec.level) === lvl
  ));
  if (!pending) return new Set();
  const revealed = _revealedSet(addr, lvl);
  return new Set(_openedPieces({ cards })
    .map((piece) => String(piece.key))
    .filter((key) => !revealed.has(key)));
}

/** Whether the direct /foil projection still belongs behind its pack opener. */
export function unopenedFoilPackPending({ address, level } = {}) {
  const addr = _lower(address);
  const lvl = Number(level);
  if (!addr || !Number.isInteger(lvl)) return false;
  const rec = pendingPacks().find((row) => (
    row && _lower(row.address) === addr && Number(row.level) === lvl
  ));
  if (!rec?.foilExpected) return false;
  const revealed = _revealedSet(addr, lvl);
  return Array.from({ length: FOIL_TICKETS_PER_PACK }, (_unused, index) => (
    FOIL_CARD_INDEX_BASE + index
  )).some((index) => !revealed.has(String(index)));
}

function _removePendingLevel(address, level) {
  const addr = _lower(address);
  const lvl = Number(level);
  const list = pendingPacks();
  _write(PENDING_KEY, list.filter((rec) => !(
    rec && _lower(rec.address) === addr && Number(rec.level) === lvl
  )));
}

/** Mark one physically opened pack's tickets/entries visible to inventory. */
export async function completePackReveal({
  address,
  level,
  cardIndexes = [],
  itemKeys = [],
  entryCount = null,
} = {}) {
  const addr = _lower(address);
  const lvl = Number(level);
  const indexes = [...new Set((Array.isArray(cardIndexes) ? cardIndexes : [])
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0))];
  const keys = [...new Set((Array.isArray(itemKeys) && itemKeys.length > 0
    ? itemKeys.map(String)
    : indexes.map(String)).filter(Boolean))];
  if (!addr || !Number.isInteger(lvl) || keys.length === 0) return false;

  const revealed = _revealedSet(addr, lvl);
  for (const itemKey of keys) revealed.add(itemKey);
  _saveRevealed(addr, lvl, revealed);

  const key = _packKey(addr, lvl);
  const active = _activePackCards.get(key);
  if (active) {
    for (const itemKey of keys) active.delete(itemKey);
    if (active.size === 0) _activePackCards.delete(key);
  }

  let trackedRec = pendingPacks().find((row) => (
    row && _lower(row.address) === addr && Number(row.level) === lvl
  ));
  if (trackedRec) {
    const released = Math.max(0, Math.floor(Number(trackedRec.releasedEntries) || 0));
    const exactEntryCount = Math.max(0, Math.floor(Number(entryCount) || 0));
    trackedRec.releasedEntries = released
      + (exactEntryCount > 0 ? exactEntryCount : indexes.length * ENTRIES_PER_TICKET);
    _replacePendingRecord(trackedRec);
  }

  // Retire only after the final queued card was opened. A transient partial
  // fourth symbol keeps the purchase record alive for its later pack.
  if (!_activePackCards.has(key)) {
    const rec = trackedRec || pendingPacks().find((row) => (
      row && _lower(row.address) === addr && Number(row.level) === lvl
    ));
    if (rec) {
      const inspected = await _inspectOne(addr, rec);
      const expectedEntries = Math.max(
        _expectedEntries(rec.expectedTickets),
        Math.floor(Number(rec.expectedEntries) || 0),
      );
      const releasedEntries = Math.max(0, Math.floor(Number(rec.releasedEntries) || 0));
      const chainFinished = !rec.chainTracked || (
        Math.floor(Number(rec.chainOwedEntries) || 0) === 0
        && releasedEntries >= expectedEntries
      );
      if (inspected && !inspected.error && inspected.unseen.length === 0 && chainFinished) {
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
 * Remove the generic-feed copies owned by the authoritative foil projection.
 * `/tickets/by-trait` has no foil discriminator, and some index versions fold
 * the four foil lines into that ordinary card stream. Use a multiset so equal
 * foil lines consume only their real number of copies instead of swallowing an
 * unrelated ordinary ticket with the same traits.
 */
function _withoutProjectedFoilTickets(pieces, keyCounts) {
  if (!keyCounts?.size) return pieces;
  const remaining = new Map(keyCounts);
  return pieces.filter((piece) => {
    if (piece?.kind !== 'ticket' || !Array.isArray(piece.traitIds)) return true;
    const key = _comboKey(piece.traitIds);
    const count = remaining.get(key) || 0;
    if (count <= 0) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

/**
 * The level's foil-pack line keys. `complete` distinguishes a real no-pack
 * answer from the indexer lagging behind a just-mined foil purchase; without
 * that distinction the four special lines could be permanently revealed as an
 * ordinary pack before /foil catches up.
 */
async function _foilState(address, level) {
  try {
    const payload = await fetchJSON(
      `/player/${_lower(address)}/foil?level=${level}`,
      { force: true },
    );
    const lines = payload?.present ? payload.lines : null;
    if (!Array.isArray(lines)) {
      return { complete: false, lines: [], keys: new Set(), keyCounts: new Map() };
    }
    const valid = lines
      .filter((l) => Array.isArray(l) && l.length === 4 && l.every((t) => t != null));
    const expected = valid.slice(0, FOIL_TICKETS_PER_PACK);
    const keyCounts = new Map();
    for (const line of expected) {
      const key = _comboKey(line);
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }
    return {
      complete: payload?.present === true && valid.length >= FOIL_TICKETS_PER_PACK,
      lines: expected.map((line) => [...line].map(Number).sort((a, b) => a - b)),
      keys: new Set(expected.map(_comboKey)),
      keyCounts,
    };
  } catch (_e) {
    return { complete: false, lines: [], keys: new Set(), keyCounts: new Map() };
  }
}

async function _inspectOne(address, rec, sweep = null, { jackpotCovered = false } = {}) {
  const level = Number(rec?.level);
  if (!Number.isInteger(level)) return null;
  const chainOwedEntries = Math.max(0, Math.floor(Number(rec?.chainOwedEntries) || 0));
  const unrevealedJackpotEntries = _unrevealedJackpotAwardEntries(address, level);
  const trackedExpectedEntries = Math.max(
    _expectedEntries(rec?.expectedTickets),
    Math.floor(Number(rec?.expectedEntries) || 0),
  );
  const trackedReleasedEntries = Math.max(0, Math.floor(Number(rec?.releasedEntries) || 0));
  const uninspectedFallbackEntries = Math.max(
    0,
    trackedExpectedEntries - trackedReleasedEntries - unrevealedJackpotEntries,
  );
  const uninspectedPendingEntries = rec?.chainTracked
    ? Math.max(0, chainOwedEntries - unrevealedJackpotEntries)
      + (rec?.foilExpected ? FOIL_TICKETS_PER_PACK * ENTRIES_PER_TICKET : 0)
    : uninspectedFallbackEntries;
  if (_now() - Number(rec?.at || 0) > PENDING_TTL_MS
    && !(rec?.chainTracked
      && (chainOwedEntries > 0 || trackedReleasedEntries < trackedExpectedEntries))) {
    return { level, expired: true, ready: false, fresh: [], unseen: [], rec };
  }
  // `?? NaN` and not Number(): Number(null) is 0, which would read as "cap
  // every level" and silently gate every pending pack in the app.
  const cap = Number(sweep?.cap ?? NaN);
  if (Number.isInteger(cap) && level > cap) {
    // Past the contract's live sweep: the traits have not rolled, so there is
    // nothing to read. Same shape as an unreachable endpoint — the pending
    // receipt keeps counting from the record rather than from a payload, and
    // the level inspects normally as soon as the sweep reaches it.
    return {
      level,
      unrolled: true,
      ready: false,
      fresh: [],
      unseen: [],
      rec,
      pendingEntries: uninspectedPendingEntries,
    };
  }
  const settledBelow = Number(sweep?.settledBelow ?? NaN);
  // A completed level is not ticket inventory anymore. Do this before the
  // by-trait read so old durable receipts cannot turn one browser into a scan
  // of its entire level history. The still-covered jackpot window wins over
  // the phase boundary: its foil/ticket pack must survive through the final
  // eligible spin and reveal.
  if (Number.isInteger(settledBelow) && level < settledBelow && !jackpotCovered) {
    return {
      level,
      over: true,
      ready: false,
      fresh: [],
      unseen: [],
      rec,
      pendingEntries: 0,
    };
  }
  const settled = Number.isInteger(settledBelow) && level < settledBelow && !jackpotCovered;
  let payload;
  try {
    payload = await _fetchCards(address, level, { settled });
  } catch (_e) {
    return {
      level,
      error: true,
      ready: false,
      fresh: [],
      unseen: [],
      rec,
      pendingEntries: uninspectedPendingEntries,
    };
  }
  if (rec.seedPending) {
    const seedNotBefore = Math.max(0, Number(rec.seedNotBefore) || 0);
    if (seedNotBefore > _now()) {
      return {
        level,
        rec,
        seedPending: true,
        ready: false,
        fresh: [],
        unseen: [],
        pendingEntries: uninspectedPendingEntries,
      };
    }
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    const hasIncomplete = cards.some((card) => _wholeCardTraitIds(card) == null);
    const oldEnough = _now() - Number(rec?.at || 0) >= SEED_RECOVERY_GRACE_MS;
    if (!hasIncomplete && !rec.settledExpected && !oldEnough) {
      return {
        level,
        rec,
        seedPending: true,
        ready: false,
        fresh: [],
        unseen: [],
        pendingEntries: uninspectedPendingEntries,
      };
    }
    _seedOpenedCards(
      address,
      level,
      payload,
      Number(rec.seedPreserveEntries) > 0
        ? Math.max(0, Math.floor(Number(rec.seedPreserveEntries) || 0))
        : !hasIncomplete
          ? Math.max(
              _expectedEntries(rec.expectedTickets),
              Math.floor(Number(rec.expectedEntries) || 0),
            )
          : 0,
    );
    rec.seedPending = false;
    rec.seedPreserveEntries = 0;
    rec.seedNotBefore = 0;
    _replacePendingRecord(rec);
  }
  const revealed = _revealedSet(address, level);
  const genericFresh = _openedPieces(payload)
    .filter((piece) => !revealed.has(String(piece.key)));
  // The foil projection is authoritative for both identity and presentation.
  // Once all four lines exist, remove their unmarked copies from the generic
  // stream and add them back below with stable foil receipt keys. If the
  // generic endpoint is behind and omits them, the projection still supplies
  // the complete foil pack.
  let foilState = { complete: true, lines: [], keys: new Set(), keyCounts: new Map() };
  if (rec.foilExpected) foilState = await _foilState(address, level);
  const foilBlocked = Boolean(rec.foilExpected && !foilState.complete);
  const allFresh = rec.foilExpected && foilState.complete
    ? _withoutProjectedFoilTickets(genericFresh, foilState.keyCounts)
    : genericFresh;
  // Owed entries are FIFO and jackpot awards are appended after the player's
  // existing hands. While the draw is still covered, withhold the newest pieces
  // attributable to the already-indexed award. Existing purchased packs
  // remain visible; the award cards join them immediately after the draw event.
  const jackpotEntriesStillOwed = Math.min(unrevealedJackpotEntries, chainOwedEntries);
  const jackpotEntriesMaterialized = Math.max(
    0,
    unrevealedJackpotEntries - jackpotEntriesStillOwed,
  );
  let withholdEntries = jackpotEntriesMaterialized;
  const withheldKeys = new Set();
  for (let i = allFresh.length - 1; i >= 0 && withholdEntries > 0; i -= 1) {
    const piece = allFresh[i];
    if (piece.entryCount > withholdEntries) continue;
    withheldKeys.add(String(piece.key));
    withholdEntries -= piece.entryCount;
  }
  const ledgerVisibleFresh = allFresh.filter((piece) => !withheldKeys.has(String(piece.key)));
  // The by-trait index can beat JackpotTicketWin history. While the result is
  // covered, cap newly materialized cards to the exact amount already backed
  // by pre-request receipts. Lootbox/Degenerette/purchase packs keep working;
  // an unexplained tail waits for the jackpot reveal event.
  let visibleEntryBudget = Math.max(0, trackedExpectedEntries - trackedReleasedEntries);
  const fresh = jackpotCovered
    ? ledgerVisibleFresh.filter((piece) => {
        if (piece.entryCount > visibleEntryBudget) return false;
        visibleEntryBudget -= piece.entryCount;
        return true;
      })
    : ledgerVisibleFresh;
  const foilTickets = rec.foilExpected && foilState.complete
    ? foilState.lines.map((traitIds, index) => ({
        traitIds,
        key: String(FOIL_CARD_INDEX_BASE + index),
        kind: 'ticket',
        entryCount: ENTRIES_PER_TICKET,
        foil: true,
        cardIndex: FOIL_CARD_INDEX_BASE + index,
      })).filter((ticket) => !revealed.has(String(ticket.cardIndex)))
    : [];
  const allReadyEntries = allFresh.reduce((sum, piece) => sum + piece.entryCount, 0)
    + (foilTickets.length * ENTRIES_PER_TICKET);
  const readyEntryCount = fresh.reduce((sum, piece) => sum + piece.entryCount, 0)
    + (foilTickets.length * ENTRIES_PER_TICKET);
  const readyTicketCount = _ticketCountFromEntries(readyEntryCount);
  const releasedEntries = Math.max(0, Math.floor(Number(rec.releasedEntries) || 0));
  const existingExpectedEntries = Math.max(
    _expectedEntries(rec.expectedTickets),
    Math.floor(Number(rec.expectedEntries) || 0),
  );
  const accountedEntries = releasedEntries
    + allReadyEntries
    + chainOwedEntries;
  const expectedEntries = jackpotCovered
    ? existingExpectedEntries
    : Math.max(existingExpectedEntries, accountedEntries);
  if (expectedEntries !== Number(rec.expectedEntries)
    || rec.expectedTickets !== _ticketCountFromEntries(expectedEntries)) {
    rec.expectedEntries = expectedEntries;
    rec.expectedTickets = _ticketCountFromEntries(expectedEntries);
    _replacePendingRecord(rec);
  }
  // Once this row has an exact contract projection, Pending follows the exact
  // entriesOwedView count minus any still-covered jackpot award. The jackpot
  // transition processes the old queue completely, so a zero resets the
  // receipt immediately even when the indexer needs another beat to expose the
  // resulting real cards. Foil entries use a separate on-chain bucket, so
  // retain their four-ticket indexing receipt independently.
  const readyEntries = readyEntryCount > 0 && !foilBlocked
    ? readyEntryCount
    : 0;
  const rawFallbackPendingEntries = Math.max(
    0,
    expectedEntries - releasedEntries - readyEntries,
  );
  const fallbackPendingEntries = Math.max(
    0,
    rawFallbackPendingEntries - unrevealedJackpotEntries,
  );
  const foilPendingEntries = rec.foilExpected && foilBlocked
    ? FOIL_TICKETS_PER_PACK * ENTRIES_PER_TICKET
    : 0;
  // An authoritative zero must clear the count even when an older receipt
  // expected more cards than the reveal bookkeeping can currently match. The
  // only other subtraction is the indexed award spoiler above. Keep the hidden
  // counters as recovery state so a late index response can still promote into
  // an opener after the draw; never repaint it as chain-queued work beforehand.
  const trackedPendingEntries = Math.max(
    0,
    chainOwedEntries - unrevealedJackpotEntries,
  );
  const pendingEntries = rec.chainTracked
    ? trackedPendingEntries + foilPendingEntries
    : fallbackPendingEntries;
  return {
    level, rec, revealed, unseen: allFresh, fresh, foilState, foilTickets,
    readyEntryCount, readyTicketCount,
    ready: readyEntryCount > 0 && !foilBlocked,
    foilBlocked,
    pendingEntries,
    indexPendingEntries: fallbackPendingEntries,
  };
}

/**
 * Readiness snapshot for the unified pending widget. No reveal is queued; a
 * receipt whose level is definitively over is retired without an API read.
 */
export async function inspectPendingPacks({ address, sweep = null, jackpotContext = null } = {}) {
  const addr = _lower(address);
  if (!addr) return [];
  const mine = pendingPacks().filter((rec) => rec && _lower(rec.address) === addr);
  const inspected = new Array(mine.length);
  let cursor = 0;
  const inspectNext = async () => {
    while (cursor < mine.length) {
      const index = cursor;
      cursor += 1;
      const rec = mine[index];
      inspected[index] = await _inspectOne(addr, rec, sweep, {
        jackpotCovered: jackpotProcessingCoversLevel(rec?.level, jackpotContext),
      });
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(PACK_INSPECTION_CONCURRENCY, mine.length) },
    () => inspectNext(),
  ));

  const over = new Set(inspected
    .filter((row) => row?.over)
    .map((row) => Number(row.level)));
  if (over.size > 0) {
    _write(PENDING_KEY, pendingPacks().filter((rec) => !(
      rec
      && _lower(rec.address) === addr
      && over.has(Number(rec.level))
    )));
  }
  return inspected.filter((row) => row && !row.over);
}

async function _publishPackActions(address, publishSeq = null) {
  const addr = _lower(address);
  if (!addr) {
    clearPendingActions(PENDING_SOURCE);
    return;
  }
  const gameState = await readGameState();
  const drainLevels = pendingTicketDrainLevels(gameState);
  const sweep = packInspectionWindow(gameState);
  const jackpotContext = unresolvedJackpotContext({
    daySync: get('app.daySync'),
    gameState,
    lastDay: get('app.lastDay'),
  });
  await _syncChainOwedRecords(addr, drainLevels, { jackpotContext });
  // The queue can be awarded and fully drained between two 45-second RPC
  // samples. Indexed JackpotTicketWin history is the durable bridge for that
  // blind spot; release only levels the contract can process in this sweep.
  await _releaseJackpotTicketAwards(addr, drainLevels);
  const rows = await inspectPendingPacks({ address: addr, sweep, jackpotContext });
  // A wallet switch can land while the ticket/foil endpoints are in flight.
  // Never let that old response repopulate the shared widget for the prior
  // account.
  if (publishSeq != null && publishSeq !== _publishSeq) return;
  const drainSet = new Set(drainLevels);
  const liveRows = rows.filter((row) => !row.expired);
  const catchingUp = liveRows.some((row) => {
    const drainedAt = Math.max(0, Number(row.rec?.chainDrainedAt) || 0);
    return row.rec?.chainTracked === true
      && Math.max(0, Math.floor(Number(row.rec?.chainOwedEntries) || 0)) === 0
      && row.ready !== true
      && Math.max(0, Math.floor(Number(row.indexPendingEntries) || 0)) > 0
      && drainedAt > 0
      && _now() - drainedAt < INDEX_CATCHUP_WINDOW_MS;
  });
  if (catchingUp && _indexCatchupTimer == null && typeof setTimeout === 'function') {
    _indexCatchupTimer = setTimeout(() => {
      _indexCatchupTimer = null;
      refreshPackWatch();
    }, INDEX_CATCHUP_RETRY_MS);
    if (_indexCatchupTimer && typeof _indexCatchupTimer.unref === 'function') {
      try { _indexCatchupTimer.unref(); } catch (_e) { /* browser timer */ }
    }
  } else if (!catchingUp && _indexCatchupTimer != null) {
    try { clearTimeout(_indexCatchupTimer); } catch (_e) { /* defensive */ }
    _indexCatchupTimer = null;
  }
  const actions = liveRows
    // Once a whole ticket has materialized it is an opener, not part of the
    // aggregate pending receipt. Keep already-ready packs available even if
    // their level completed while the player was away.
    .filter((row) => row.ready || _activePackCards.has(_packKey(addr, row.level)))
    .map((row) => {
      const opening = _activePackCards.has(_packKey(addr, row.level));
      const standardExpected = _standardPackExpected(row.rec);
      const recordedCount = _ticketCountFromEntries(Math.max(
        _expectedEntries(row.rec?.expectedTickets),
        Math.floor(Number(row.rec?.expectedEntries) || 0),
      ));
      const ticketCount = row.readyTicketCount || recordedCount;
      return {
      id: `ticket-pack:${row.level}`,
      dismissKey: _packDismissKey(row),
      dismissScope: addr,
      kind: 'tickets',
      ticketLevel: row.level,
      ticketCount,
      foilPack: Boolean(row.rec?.foilExpected && !standardExpected),
      label: standardExpected
        ? `Level ${row.level} ticket pack`
        : `Level ${row.level} foil pack`,
      shortLabel: standardExpected ? 'Open tickets' : 'Open foil pack',
      detail: opening
        ? 'Pack opening in progress'
        : row.ready
        ? `${row.readyTicketCount} ticket${row.readyTicketCount === 1 ? '' : 's'} ready to reveal`
        : 'Pack is still indexing',
      state: opening ? 'busy' : row.ready ? 'ready' : 'waiting',
      autoOpen: row.ready,
      order: 10,
      chronology: Number(row.rec?.at ?? row.level),
      run: opening ? null : async () => {
        let current = null;
        try { current = _getAddress ? _getAddress() : null; } catch (_e) { current = null; }
        if (_lower(current) !== addr) return false;
        publishPendingActions(PENDING_SOURCE, [{
          id: `ticket-pack:${row.level}`,
          dismissKey: _packDismissKey(row),
          dismissScope: addr,
          kind: 'tickets',
          ticketLevel: row.level,
          ticketCount: row.readyTicketCount || recordedCount,
          foilPack: Boolean(row.rec?.foilExpected && !standardExpected),
          label: `Level ${row.level} ticket pack`,
          detail: 'Building your pack reveal',
          state: 'busy',
          order: 10,
        }]);
        // Readiness can race the ticket/foil projections between this action's
        // poll and the click/auto-open microtask. Tell the reveal tray when no
        // sequence was actually staged so AUTO keeps retrying instead of
        // permanently considering this level opened after a no-op.
        const queued = await checkPendingPacks({ address: addr, levels: [row.level] });
        try { current = _getAddress ? _getAddress() : null; } catch (_e) { current = null; }
        if (_lower(current) !== addr) return false;
        const nextSeq = ++_publishSeq;
        await _publishPackActions(addr, nextSeq);
        return queued > 0;
      },
    };
    });

  // One quiet receipt represents every still-unmaterialized entry in the
  // contract's live six-level sweep. Resolved levels are deliberately absent
  // from drainSet, even if an old local record or stale index row survives.
  const pendingRows = liveRows.filter((row) => drainSet.has(Number(row.level)));
  const pendingEntries = pendingRows.reduce(
    (sum, row) => sum + Math.max(0, Math.floor(Number(row.pendingEntries) || 0)),
    0,
  );
  const hasUnknownPending = pendingRows.some((row) => (
    !row.ready
    && Math.floor(Number(row.pendingEntries) || 0) === 0
    && Math.max(
      _expectedEntries(row.rec?.expectedTickets),
      Math.floor(Number(row.rec?.expectedEntries) || 0),
    ) === 0
  ));
  if (pendingEntries > 0 || hasUnknownPending) {
    const ticketCount = _ticketCountFromEntries(pendingEntries);
    const label = ticketCount > 0
      ? `${ticketCount} TICKET${ticketCount === 1 ? '' : 'S'} PENDING`
      : 'TICKETS PENDING';
    const foilBlockedRows = pendingRows.filter((row) => row.foilBlocked);
    const foilOnlyBlocked = foilBlockedRows.length > 0
      && foilBlockedRows.every((row) => !_standardPackExpected(row.rec));
    const pendingPackPreviews = _pendingPackPreviews(pendingRows);
    const processedAwaitingIndex = pendingRows.some((row) => (
      row.rec?.chainTracked === true
      && Math.max(0, Math.floor(Number(row.rec?.chainOwedEntries) || 0)) === 0
      && Math.max(0, Math.floor(Number(row.pendingEntries) || 0)) > 0
    ));
    actions.push({
      id: 'ticket-packs:pending',
      dismissKey: `ticket-packs:pending:${pendingRows.map(_packDismissKey).join('|')}`,
      dismissScope: addr,
      kind: 'tickets',
      ticketCount: ticketCount || null,
      foilPack: false,
      label,
      shortLabel: 'Pack pending',
      detail: foilBlockedRows.length > 0
        ? (foilOnlyBlocked ? 'Foil pack is still indexing' : 'Ticket pack is still indexing')
        : processedAwaitingIndex
          ? 'Tickets processed — loading your packs'
          : 'Queued for processing before the next jackpot',
      state: 'waiting',
      autoOpen: false,
      pinned: true,
      passive: true,
      compact: true,
      pendingPacks: pendingPackPreviews,
      phase: processedAwaitingIndex ? 'indexing' : 'waiting-draw',
      // CLEAR means the currently owed hands stay dismissed after they become
      // real per-level opener rows; HIDE does not consume these aliases.
      dismissIds: [...new Set(pendingRows.map(_packDismissKey))],
      order: 10,
      chronology: Math.min(...pendingRows.map((row) => Number(row.rec?.at ?? row.level))),
      run: null,
    });
  }
  publishPendingActions(PENDING_SOURCE, actions);
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
  // Store-only: this is a click path and must not add a /game/state fetch of
  // its own. An empty store yields a null sweep, which gates nothing.
  const gameState = get('app.gameState');
  const sweep = packInspectionWindow(gameState);
  const jackpotContext = unresolvedJackpotContext({
    daySync: get('app.daySync'),
    gameState,
    lastDay: get('app.lastDay'),
  });

  for (const rec of mine) {
    const lvl = Number(rec.level);
    const activeKey = _packKey(addr, lvl);
    if (_activePackCards.has(activeKey)) continue;
    const inspected = await _inspectOne(addr, rec, sweep, {
      jackpotCovered: jackpotProcessingCoversLevel(lvl, jackpotContext),
    });
    if (!inspected) continue;
    if (inspected.expired || inspected.over) {
      done.add(`${lvl}`);
      continue;
    }
    if (inspected.error || inspected.unrolled) continue;
    const {
      revealed, unseen, fresh, foilTickets, foilBlocked,
    } = inspected;
    if (fresh.length === 0 && foilTickets.length === 0) continue;

    // A successful foil buy explicitly marks the pending record. Wait for the
    // complete four-line /foil projection, then present it independently of the
    // ordinary ticket stream.
    if (foilBlocked) continue;
    const standardPieces = fresh.map((piece) => ({
      ...piece,
      foil: false,
      cardIndex: piece.cardIndexes?.length === 1
        ? Number(piece.cardIndexes[0])
        : Number.isInteger(Number(piece.cardIndex)) ? Number(piece.cardIndex) : null,
    }));
    const pieces = [...standardPieces, ...foilTickets];

    // Ordinary tickets open first; foil lines retain their unmistakable
    // wrapper and presentation as the special final pack. They share one
    // batch so OPEN ALL includes the foil pack with the final pack index.
    const groups = [
      { foilPack: false, pieces: standardPieces },
      { foilPack: true, pieces: foilTickets },
    ];
    const packSpecs = [];
    for (const group of groups) {
      for (let offset = 0; offset < group.pieces.length; offset += MAX_TICKETS_PER_PACK) {
        packSpecs.push({
          foilPack: group.foilPack,
          pieces: group.pieces.slice(offset, offset + MAX_TICKETS_PER_PACK),
        });
      }
    }
    const batchId = `${addr}:${lvl}:${Number(rec.at || 0)}:packs`;
    const packCount = packSpecs.length;
    const totalEntryCount = pieces.reduce((sum, piece) => sum + piece.entryCount, 0);
    let queuedForRecord = 0;
    for (let i = 0; i < packSpecs.length; i += 1) {
        const { foilPack, pieces: packPieces } = packSpecs[i];
        const packTickets = packPieces
          .filter((piece) => piece.kind === 'ticket')
          .map((piece) => ({
            traitIds: piece.traitIds,
            foil: Boolean(piece.foil),
            cardIndex: piece.cardIndex,
          }));
        const packEntries = packPieces
          .filter((piece) => piece.kind === 'entry')
          .map((piece) => ({ traitId: piece.traitId }));
        const packEntryCount = packPieces.reduce((sum, piece) => sum + piece.entryCount, 0);
        queueReveal({
          kind: 'pack',
          title: foilPack ? `FOIL PACK · LEVEL ${lvl}` : `LEVEL ${lvl} TICKETS`,
          level: lvl,
          foilPack,
          tickets: packTickets,
          entries: packEntries,
          count: _ticketCountFromEntries(packEntryCount),
          totalCount: _ticketCountFromEntries(totalEntryCount),
          batchId,
          packIndex: i + 1,
          packCount,
          packRelease: {
            address: addr,
            level: lvl,
            cardIndexes: [...new Set(packPieces
              .flatMap((piece) => piece.cardIndexes || [piece.cardIndex])
              .map(Number)
              .filter((index) => Number.isInteger(index) && index >= 0))],
            itemKeys: packPieces.map((piece) => String(piece.key)),
            entryCount: packEntryCount,
          },
        });
        queued += 1;
        queuedForRecord += 1;
    }
    if (queuedForRecord > 0) {
      _activePackCards.set(activeKey, new Set(pieces.map((piece) => String(piece.key))));
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
        if (addr) refreshPackWatch();
      });
    };
    _abortListener = (event) => {
      for (const release of Array.isArray(event?.detail?.releases)
        ? event.detail.releases : []) {
        _activePackCards.delete(_packKey(release?.address, release?.level));
      }
      let addr = null;
      try { addr = _getAddress ? _getAddress() : null; } catch (_e) { addr = null; }
      if (addr) refreshPackWatch();
    };
    _jackpotRevealListener = (event) => {
      if (event?.detail?.complete === false) return;
      const day = Number(event?.detail?.day);
      if (Number.isInteger(day) && day > 0) _revealedJackpotDays.add(day);
      refreshPackWatch();
    };
    document.addEventListener(PACK_REVEAL_COMPLETE_EVENT, _completeListener);
    document.addEventListener(PACK_REVEAL_ABORT_EVENT, _abortListener);
    document.addEventListener('jackpot:revealed', _jackpotRevealListener);
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
  // Invalidate any older result immediately, then collapse every refresh that
  // arrives while it unwinds into one latest-state rerun. Day/game/last-day
  // subscriptions often fire together at a jackpot boundary; they should not
  // each start their own six-level inspection wave.
  _publishSeq += 1;
  _refreshQueued = true;
  if (_refreshFlight) return;

  const flight = Promise.resolve().then(async () => {
    while (_running && _refreshQueued) {
      _refreshQueued = false;
      let addr = null;
      try { addr = _getAddress ? _getAddress() : null; } catch (_e) { addr = null; }
      const seq = _publishSeq;
      if (!addr) {
        clearPendingActions(PENDING_SOURCE);
        continue;
      }
      try { await _publishPackActions(addr, seq); } catch (_e) { /* next refresh retries */ }
    }
  });
  _refreshFlight = flight;
  void flight.finally(() => {
    if (_refreshFlight !== flight) return;
    _refreshFlight = null;
    if (_running && _refreshQueued) refreshPackWatch();
  });
}

/** Stop the loop (tests + teardown). */
export function stopPackWatch() {
  if (_timer != null) {
    try { clearInterval(_timer); } catch (_e) { /* defensive */ }
  }
  _timer = null;
  if (_awardSeedTimer != null) {
    try { clearTimeout(_awardSeedTimer); } catch (_e) { /* defensive */ }
  }
  _awardSeedTimer = null;
  if (_indexCatchupTimer != null) {
    try { clearTimeout(_indexCatchupTimer); } catch (_e) { /* defensive */ }
  }
  _indexCatchupTimer = null;
  _running = false;
  _refreshQueued = false;
  _getAddress = null;
  if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
    if (_completeListener) document.removeEventListener(PACK_REVEAL_COMPLETE_EVENT, _completeListener);
    if (_abortListener) document.removeEventListener(PACK_REVEAL_ABORT_EVENT, _abortListener);
    if (_jackpotRevealListener) document.removeEventListener('jackpot:revealed', _jackpotRevealListener);
  }
  _completeListener = null;
  _abortListener = null;
  _jackpotRevealListener = null;
  clearSettledCardCache();
  _revealedJackpotDays.clear();
  _activePackCards.clear();
  _historyBackfilled.clear();
  _publishSeq += 1;
  clearPendingActions(PENDING_SOURCE);
}
