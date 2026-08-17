// Surface DB-discovered Bingo proofs as player claim actions, then show every
// settled reward as a one-time reveal.
//
// The indexed API is the ONLY reader. Bingo state is derived entirely from
// entries the indexer already holds, so there is nothing here the chain can
// answer that /player/:addr/bingos cannot — see the note where the old log
// scan used to be. This file makes no RPC reads at all; the claim WRITE still
// goes to the wallet, as it must.

import { CHAIN, CONTRACTS } from './chain-config.js';
import { ethers } from './contracts.js';
import { fetchJSON } from './api.js';
import { TX_CONFIRMED_EVENT } from './contracts.js';
import {
  DGN_QUADRANTS,
  dgnBadgePath,
  dgnDisplaySymbol,
} from './dgn-traits.js';
import { publishPendingActions, clearPendingActions } from './pending-actions.js';
import { queueReveal } from '../components/reveal-overlay.js';
import { claimBingo } from './bingo.js';
import {
  currentUnresolvedJackpotContext,
  jackpotProcessingCoversLevel,
} from './jackpot-spoiler.js';

const SOURCE = 'bingo-claims';
const STORAGE_PREFIX = `degenerus:bingo:${CHAIN.id}:${String(CONTRACTS.GAME || '').toLowerCase()}`;
const MAX_CONSUMED_IDS = 512;

// Kept for decoding the CLAIM TRANSACTION'S OWN RECEIPT — the wallet hands those
// logs back on a successful write, so this costs no RPC read. It is what lets a
// claim reveal immediately instead of waiting for the indexer to catch up.
// There is deliberately no topic list here any more: nothing in this file
// queries the chain for logs.
const BINGO_ABI = [
  'event FirstQuadrantBingo(address indexed player, uint256 level, uint8 symbol)',
  'event FirstSymbolBingo(address indexed player, uint256 level, uint8 symbol)',
  'event BingoClaimed(address indexed player, uint256 level, uint8 symbol, uint256 flipReward, uint256 dgnrsPaid)',
];
const BINGO_INTERFACE = new ethers.Interface(BINGO_ABI);


let _onTxConfirmed = null;
let _onJackpotRevealed = null;
let _running = false;
let _getAddress = null;
let _refreshInFlight = null;
let _refreshAgain = false;
let _publishSeq = 0;
let _ticketFetcher = null;
let _indexFetcher = null;
let _claimWriter = null;
const _memoryState = new Map();
const _claimableRows = new Map();

function _lower(value) { return value ? String(value).toLowerCase() : null; }
function _storageKey(address) { return `${STORAGE_PREFIX}:${_lower(address)}`; }

function _readState(address) {
  const fallback = { rows: [], consumed: [] };
  try {
    const raw = localStorage.getItem(_storageKey(address));
    if (!raw) return _memoryState.get(_storageKey(address)) || fallback;
    const parsed = JSON.parse(raw);
    return {
      // No scan cursor any more — a stale one in stored state is simply ignored.
      rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
      consumed: Array.isArray(parsed?.consumed) ? parsed.consumed.map(String) : [],
    };
  } catch (_e) {
    return _memoryState.get(_storageKey(address)) || fallback;
  }
}

function _writeState(address, state) {
  _memoryState.set(_storageKey(address), state);
  try { localStorage.setItem(_storageKey(address), JSON.stringify(state)); }
  catch (_e) { /* private mode / quota: the current session still paints */ }
}

function _eventIndex(log) {
  return Number(log?.index ?? log?.logIndex ?? 0);
}

function _eventKey(log) {
  return `${String(log?.transactionHash || '').toLowerCase()}:${_eventIndex(log)}`;
}

function _tierKey(log, level, symbol) {
  return `${String(log?.transactionHash || '').toLowerCase()}:${level}:${symbol}`;
}

/**
 * Decode a claim transaction's receipt logs into one universal BingoClaimed
 * receipt per claim, pairing the companion first-tier event so a first Bingo is
 * labelled as one rather than counted twice.
 */
export function decodeBingoLogs(logs, address = null) {
  const target = _lower(address);
  const decoded = [];
  for (const log of Array.isArray(logs) ? logs : []) {
    try {
      const event = BINGO_INTERFACE.parseLog(log);
      const player = _lower(event?.args?.player ?? event?.args?.[0]);
      if (target && player !== target) continue;
      const level = Number(event?.args?.level ?? event?.args?.[1]);
      const symbol = Number(event?.args?.symbol ?? event?.args?.[2]);
      if (!Number.isInteger(level) || level < 0 || !Number.isInteger(symbol)
        || symbol < 0 || symbol >= 32) continue;
      decoded.push({ log, event, player, level, symbol });
    } catch (_e) { /* unrelated/malformed log */ }
  }
  decoded.sort((a, b) => (
    Number(a.log?.blockNumber || 0) - Number(b.log?.blockNumber || 0)
    || _eventIndex(a.log) - _eventIndex(b.log)
  ));

  const tiers = new Map();
  for (const row of decoded) {
    if (row.event.name === 'FirstQuadrantBingo') {
      tiers.set(_tierKey(row.log, row.level, row.symbol), 'first-quadrant');
    } else if (row.event.name === 'FirstSymbolBingo') {
      tiers.set(_tierKey(row.log, row.level, row.symbol), 'first-symbol');
    }
  }

  return decoded.flatMap((row) => {
    if (row.event.name !== 'BingoClaimed') return [];
    return [{
      id: _eventKey(row.log),
      transactionHash: String(row.log?.transactionHash || '').toLowerCase(),
      logIndex: _eventIndex(row.log),
      blockNumber: Number(row.log?.blockNumber || 0),
      player: row.player,
      level: row.level,
      symbol: row.symbol,
      tier: tiers.get(_tierKey(row.log, row.level, row.symbol)) || 'regular',
      flipReward: String(row.event.args?.flipReward ?? row.event.args?.[3] ?? 0),
      dgnrsPaid: String(row.event.args?.dgnrsPaid ?? row.event.args?.[4] ?? 0),
    }];
  });
}

function _claimKey(level, quadrant) {
  return `claim:${Number(level)}:${Number(quadrant)}`;
}

function _claimProofKey(level, quadrant, symbol, slots) {
  return [
    'proof',
    Number(level),
    Number(quadrant),
    Number(symbol),
    ...(Array.isArray(slots) ? slots.map(Number) : []),
  ].join(':');
}

function _mergeReceipts(state, receipts) {
  const consumed = new Set(state.consumed.map(String));
  const rows = new Map(state.rows.map((row) => [String(row?.id), row]));
  for (const receipt of receipts) {
    if (!receipt?.id || consumed.has(String(receipt.id))) continue;
    const prior = rows.get(String(receipt.id));
    rows.set(String(receipt.id), {
      ...prior,
      ...receipt,
      // A reorg-overlap scan that contains the companion first event can
      // upgrade a receipt initially observed without it.
      tier: receipt.tier === 'regular' && prior?.tier ? prior.tier : receipt.tier,
    });
  }
  state.rows = [...rows.values()].sort((a, b) => (
    Number(a.blockNumber) - Number(b.blockNumber)
    || Number(a.logIndex) - Number(b.logIndex)
  ));
  return state;
}

// The direct GAME log scan that used to live here is GONE. It walked every
// block since deploy in 2,000-block getLogs chunks, per player, aimed at the
// shared CHAIN.rpcUrl — and it only ever ran when the indexed read threw, which
// meant a struggling API turned into a bulk-RPC storm from every connected
// client at once. It also could not produce the thing players actually wait
// for: `claimable` proofs come from entry_registry, which the chain does not
// emit. The events it decoded (FirstQuadrantBingo / FirstSymbolBingo /
// BingoClaimed) are already indexed and returned as `claimed` rows with the
// same tier / flipReward / dgnrsPaid fields, so it was a strict subset of the
// API it was "backing up". It was migration scaffolding; the migration is done.

function _normalizeIndexedReceipt(row, address) {
  const player = _lower(row?.player || address);
  const level = Number(row?.level);
  const symbol = Number(row?.symbol);
  const blockNumber = Number(row?.blockNumber || 0);
  const logIndex = Number(row?.logIndex || 0);
  const transactionHash = String(row?.transactionHash || '').toLowerCase();
  if (player !== _lower(address)
    || !Number.isInteger(level) || level < 0
    || !Number.isInteger(symbol) || symbol < 0 || symbol >= 32
    || !Number.isInteger(blockNumber) || blockNumber < 0
    || !Number.isInteger(logIndex) || logIndex < 0) return null;
  const tier = ['first-quadrant', 'first-symbol', 'regular'].includes(row?.tier)
    ? row.tier
    : 'regular';
  return {
    id: String(row?.id || `${transactionHash}:${logIndex}`),
    transactionHash,
    logIndex,
    blockNumber,
    player,
    level,
    symbol,
    tier,
    flipReward: String(row?.flipReward ?? '0'),
    dgnrsPaid: String(row?.dgnrsPaid ?? '0'),
  };
}

function _normalizeClaimable(row, address) {
  const player = _lower(row?.player || address);
  const level = Number(row?.level);
  const symbol = Number(row?.symbol);
  const quadrant = Number(row?.quadrant ?? (symbol >> 3));
  const slots = Array.isArray(row?.slots) ? row.slots.map(Number) : [];
  if (player !== _lower(address)
    || !Number.isInteger(level) || level < 0
    || !Number.isInteger(symbol) || symbol < 0 || symbol >= 32
    || !Number.isInteger(quadrant) || quadrant < 0 || quadrant > 3
    || (symbol >> 3) !== quadrant
    || slots.length !== 8
    || slots.some((slot) => !Number.isInteger(slot) || slot < 0 || slot > 0xffff_ffff)) {
    return null;
  }
  return {
    id: _claimKey(level, quadrant),
    // A bad indexed slot should suppress only this exact proof. If the
    // indexer later corrects one of its eight slots, the corrected proof gets
    // a new key and can become actionable without resurrecting a Bingo that
    // really was claimed already.
    proofId: _claimProofKey(level, quadrant, symbol, slots),
    player,
    level,
    symbol,
    quadrant,
    slots,
  };
}

async function _fetchIndexedBingos(address) {
  if (_indexFetcher) return _indexFetcher({ address });
  return fetchJSON(`/player/${address}/bingos`);
}

async function _loadIndexedBingos(address) {
  const payload = await _fetchIndexedBingos(address);
  const state = _readState(address);
  const receipts = (Array.isArray(payload?.claimed) ? payload.claimed : [])
    .map((row) => _normalizeIndexedReceipt(row, address))
    .filter(Boolean);
  _mergeReceipts(state, receipts);
  _writeState(address, state);
  const consumed = new Set(state.consumed.map(String));
  const claimables = (Array.isArray(payload?.claimable) ? payload.claimable : [])
    .map((row) => _normalizeClaimable(row, address))
    .filter((row) => row && !consumed.has(row.id) && !consumed.has(row.proofId));
  _claimableRows.set(_lower(address), claimables);
  return { receipts: state.rows, claimables };
}

/** Counts indexed by color*8+symbol, matching the inventory chart orientation. */
export function bingoQuadrantEntryCounts(payload, quadrant) {
  const q = Number(quadrant);
  const counts = new Array(64).fill(0);
  if (!Number.isInteger(q) || q < 0 || q > 3) return counts;
  for (const card of Array.isArray(payload?.cards) ? payload.cards : []) {
    for (const entry of Array.isArray(card?.entries) ? card.entries : []) {
      // Number(null) is 0, a real trait (crypto/pink/XRP). Unrevealed entries
      // carry traitId null and must not be counted into quadrant 0's slot 0.
      const rawTid = entry?.traitId;
      const traitId = rawTid == null ? NaN : Number(rawTid);
      if (!Number.isInteger(traitId) || traitId < 0 || traitId > 255) continue;
      if (((traitId >> 6) & 3) !== q) continue;
      counts[traitId & 63] += 1;
    }
  }
  return counts;
}

function _symbolLabel(receipt) {
  const quadrant = Number(receipt.symbol) >> 3;
  const sym = Number(receipt.symbol) & 7;
  const raw = dgnDisplaySymbol(quadrant, sym) || `symbol ${sym + 1}`;
  return String(raw).replace(/[_-]+/g, ' ').toUpperCase();
}

function _tierLabel(tier) {
  if (tier === 'first-quadrant') return 'QUADRANT-FIRST BINGO';
  if (tier === 'first-symbol') return 'FIRST-SYMBOL BINGO';
  return 'BINGO';
}

function _consume(address, ids) {
  const state = _readState(address);
  const remove = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
  state.rows = state.rows.filter((row) => !remove.has(String(row?.id)));
  const consumed = [...new Set([...state.consumed.map(String), ...remove])];
  state.consumed = consumed.slice(-MAX_CONSUMED_IDS);
  _writeState(address, state);
}

function _bingoClaimErrorName(error) {
  const seen = new Set();
  const pending = [error];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || (typeof current !== 'object' && typeof current !== 'function')
      || seen.has(current)) continue;
    seen.add(current);
    for (const value of [
      current.code,
      current.errorName,
      current.revert?.name,
      current.reason,
      current.shortMessage,
      current.message,
    ]) {
      const match = /(AlreadyClaimed|NotSlotOwner|InvalidSymbol|GameOver)/.exec(String(value || ''));
      if (match) return match[1];
    }
    for (const nested of [current.cause, current.error, current.info?.error]) {
      if (nested) pending.push(nested);
    }
  }
  return null;
}

async function _fetchTicketChart(address, level) {
  if (_ticketFetcher) return _ticketFetcher({ address, level });
  return fetchJSON(`/player/${address}/tickets/by-trait?level=${level}`);
}

async function _publish(address, seq = null) {
  const addr = _lower(address);
  if (!addr) {
    clearPendingActions(SOURCE);
    return;
  }
  const state = _readState(addr);
  if (seq != null && seq !== _publishSeq) return;
  const jackpotContext = currentUnresolvedJackpotContext();
  const visibleReceipts = state.rows.filter((row) => (
    !jackpotProcessingCoversLevel(row?.level, jackpotContext)
  ));
  const visibleClaimables = (_claimableRows.get(addr) || []).filter((row) => (
    !jackpotProcessingCoversLevel(row?.level, jackpotContext)
  ));
  const clearAll = async () => {
    // CLEAR consumes every currently visible Bingo proof/receipt. Covered
    // jackpot rows are deliberately outside the surface and cannot be cleared
    // accidentally before the player sees them.
    _consume(addr, [
      ...visibleReceipts.map((row) => row.id),
      ...visibleClaimables.map((row) => row.id),
    ]);
    const visibleIds = new Set(visibleClaimables.map((row) => row.id));
    _claimableRows.set(addr, (_claimableRows.get(addr) || [])
      .filter((row) => !visibleIds.has(row.id)));
    if (_lower(_getAddress?.()) === addr) await _publish(addr, ++_publishSeq);
  };
  const revealRows = visibleReceipts.map((receipt) => {
    const quadrant = Number(receipt.symbol) >> 3;
    const quadrantName = String(DGN_QUADRANTS[quadrant] || 'trait').toUpperCase();
    const symbolName = _symbolLabel(receipt);
    return {
      id: `bingo:${receipt.id}`,
      dismissScope: addr,
      kind: 'bingo',
      kindLabel: _tierLabel(receipt.tier),
      label: `Level ${receipt.level} ${symbolName} Bingo`,
      shortLabel: 'Reveal Bingo',
      detail: `${quadrantName} quadrant · all 8 colors collected`,
      badgePath: dgnBadgePath(quadrant, Number(receipt.symbol) & 7, 7),
      state: 'ready',
      write: false,
      autoOpen: true,
      order: 14,
      chronology: (Number(receipt.blockNumber) * 100_000) + Number(receipt.logIndex),
      clearAll,
      run: async () => {
        let current = null;
        try { current = _lower(_getAddress?.()); } catch (_e) { current = null; }
        if (current !== addr) return;
        let counts = new Array(64).fill(0);
        try {
          const payload = await _fetchTicketChart(addr, receipt.level);
          counts = bingoQuadrantEntryCounts(payload, quadrant);
        } catch (_e) { /* claim itself proves the highlighted eight cells */ }
        queueReveal({
          kind: 'bingo',
          ...receipt,
          quadrant,
          sym: Number(receipt.symbol) & 7,
          counts,
          presentationId: `bingo-reveal:${addr}:${Number(receipt.level)}:${quadrant}`,
        });
        // A local claim receipt and the indexed event may race into this same
        // action. A rejected duplicate is already staged, so consume this row
        // instead of leaving it around to produce a second reveal attempt.
        _consume(addr, receipt.id);
        await _publish(addr, ++_publishSeq);
      },
    };
  });

  const consumed = new Set(state.consumed.map(String));
  const claimRows = visibleClaimables
    .filter((candidate) => !consumed.has(candidate.id))
    .map((candidate) => {
      const quadrant = candidate.quadrant;
      const quadrantName = String(DGN_QUADRANTS[quadrant] || 'trait').toUpperCase();
      const symbolName = _symbolLabel(candidate);
      return {
        id: `bingo-claim:${candidate.level}:${quadrant}`,
        dismissScope: addr,
        kind: 'bingo',
        kindLabel: 'BINGO READY',
        label: `Level ${candidate.level} ${symbolName} Bingo`,
        shortLabel: 'Claim Bingo',
        detail: `${quadrantName} quadrant · all 8 colors collected`,
        badgePath: dgnBadgePath(quadrant, Number(candidate.symbol) & 7, 7),
        state: 'ready',
        write: true,
        autoOpen: false,
        order: 13,
        chronology: (Number(candidate.level) * 4) + quadrant,
        clearAll,
        run: async () => {
          let current = null;
          try { current = _lower(_getAddress?.()); } catch (_e) { current = null; }
          if (current !== addr) return;

          let result;
          try {
            result = await (_claimWriter || claimBingo)({
              player: addr,
              level: candidate.level,
              symbol: candidate.symbol,
              slots: candidate.slots,
            });
          } catch (error) {
            // Another permissionless caller can win the race after the DB read.
            // Retire the stale write; the indexed receipt will still arrive as
            // a reveal row on the next refresh.
            const errorName = _bingoClaimErrorName(error);
            if (errorName) {
              // AlreadyClaimed/GameOver are terminal for this logical claim.
              // A bad ownership/symbol row may be repaired by the indexer, so
              // suppress only its exact eight-slot proof fingerprint.
              _consume(
                addr,
                ['NotSlotOwner', 'InvalidSymbol'].includes(errorName)
                  ? candidate.proofId
                  : candidate.id,
              );
              _claimableRows.set(addr, (_claimableRows.get(addr) || [])
                .filter((row) => row.id !== candidate.id));
              await refreshBingoWatch();
              return;
            }
            throw error;
          }

          const receipts = decodeBingoLogs(result?.receipt?.logs, addr);
          if (receipts.length > 0) {
            const latest = _readState(addr);
            _mergeReceipts(latest, receipts);
            _writeState(addr, latest);
          }
          // The proof can never become reusable: on-chain dedupe is one claim
          // per (player, level, quadrant). Persist that fact across API lag and
          // reloads so a confirmed transaction cannot be offered twice.
          _consume(addr, [candidate.id]);
          _claimableRows.set(addr, (_claimableRows.get(addr) || [])
            .filter((row) => row.id !== candidate.id));
          await _publish(addr, ++_publishSeq);
          void refreshBingoWatch();
        },
      };
    });

  publishPendingActions(SOURCE, [...claimRows, ...revealRows]);
}

/** Re-check immediately (startup, wallet switch, or poll tick). */
export function refreshBingoWatch() {
  if (!_running) return _refreshInFlight || Promise.resolve();
  let address = null;
  try { address = _lower(_getAddress?.()); } catch (_e) { address = null; }
  if (!address) {
    clearPendingActions(SOURCE);
    return Promise.resolve();
  }
  if (_refreshInFlight) {
    _refreshAgain = true;
    return _refreshInFlight;
  }
  const seq = ++_publishSeq;
  _refreshInFlight = (async () => {
    // One reader, and a failure is just a failure. The old branch fell through
    // to a full chain rescan, which meant an API wobble became a getLogs storm
    // from every client at once. Keeping the last good published state and
    // waiting for the next trigger is strictly better: Bingo proofs are not
    // time-critical, and the triggers below fire on everything that can change
    // them.
    try {
      await _loadIndexedBingos(address);
    } catch (error) {
      console.warn?.('[bingo-watch] indexed Bingo read failed; keeping last known state', error);
    }
    if (_lower(_getAddress?.()) === address) await _publish(address, seq);
  })().finally(() => {
    _refreshInFlight = null;
    if (_refreshAgain && _running) {
      _refreshAgain = false;
      const schedule = typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (callback) => Promise.resolve().then(callback);
      schedule(refreshBingoWatch);
    }
  });
  return _refreshInFlight;
}

/**
 * No interval. Bingo proofs change on exactly three things, and main.js already
 * calls refreshBingoWatch() on all of them: ticket processing completing for a
 * settled day, the pack-drain scope moving, and the connected address changing
 * (plus the day/level rollover watcher). A 30s clock on top of four real
 * triggers just re-asked a question whose answer had not moved — the same
 * redundancy the last-day poll had.
 *
 * The player's own confirmed transaction is the fourth: claiming a Bingo, or a
 * purchase that completes a line, both land as writes this client sent.
 */
export function startBingoWatch({ getAddress } = {}) {
  if (_running) return;
  _running = true;
  _getAddress = typeof getAddress === 'function' ? getAddress : null;
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    _onTxConfirmed = () => { void refreshBingoWatch(); };
    _onJackpotRevealed = () => { void refreshBingoWatch(); };
    document.addEventListener(TX_CONFIRMED_EVENT, _onTxConfirmed);
    document.addEventListener('jackpot:revealed', _onJackpotRevealed);
  }
  refreshBingoWatch();
}

export function stopBingoWatch() {
  if (_onTxConfirmed && typeof document !== 'undefined') {
    try { document.removeEventListener(TX_CONFIRMED_EVENT, _onTxConfirmed); }
    catch (_e) { /* defensive */ }
  }
  _onTxConfirmed = null;
  if (_onJackpotRevealed && typeof document !== 'undefined') {
    try { document.removeEventListener('jackpot:revealed', _onJackpotRevealed); }
    catch (_e) { /* defensive */ }
  }
  _onJackpotRevealed = null;
  _running = false;
  _getAddress = null;
  _refreshAgain = false;
  _publishSeq += 1;
  clearPendingActions(SOURCE);
}

/** Test seams; production uses the indexed API and the wallet writer. No RPC reads. */
export function __setBingoReadersForTest({ tickets, index, claim } = {}) {
  _ticketFetcher = typeof tickets === 'function' ? tickets : null;
  _indexFetcher = typeof index === 'function' ? index : null;
  _claimWriter = typeof claim === 'function' ? claim : null;
}

export function __resetBingoWatchForTest() {
  stopBingoWatch();
  _ticketFetcher = null;
  _indexFetcher = null;
  _claimWriter = null;
  _refreshInFlight = null;
  _refreshAgain = false;
  _memoryState.clear();
  _claimableRows.clear();
}
