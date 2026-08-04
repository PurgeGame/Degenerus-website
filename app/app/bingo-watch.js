// Surface DB-discovered Bingo proofs as player claim actions, then show every
// settled reward as a one-time reveal. The indexed API is authoritative for
// both unclaimed proofs and historical receipts; the direct GAME log scan stays
// as a backwards-compatible fallback while the API/indexer is being deployed.

import { CHAIN, CONTRACTS } from './chain-config.js';
import { ethers, getProvider } from './contracts.js';
import { fetchJSON } from '../../beta/app/api.js';
import { DGN_QUADRANTS, DGN_SYMBOLS, dgnBadgePath } from './dgn-traits.js';
import { publishPendingActions, clearPendingActions } from './pending-actions.js';
import { queueReveal } from '../components/reveal-overlay.js';
import { claimBingo } from './bingo.js';

const SOURCE = 'bingo-claims';
const STORAGE_PREFIX = `degenerus:bingo:${CHAIN.id}:${String(CONTRACTS.GAME || '').toLowerCase()}`;
const WATCH_INTERVAL_MS = 30_000;
const LOG_CHUNK_BLOCKS = 2_000;
const REORG_OVERLAP_BLOCKS = 12;
const MAX_CONSUMED_IDS = 512;

const BINGO_ABI = [
  'event FirstQuadrantBingo(address indexed player, uint256 level, uint8 symbol)',
  'event FirstSymbolBingo(address indexed player, uint256 level, uint8 symbol)',
  'event BingoClaimed(address indexed player, uint256 level, uint8 symbol, uint256 flipReward, uint256 dgnrsPaid)',
];
const BINGO_INTERFACE = new ethers.Interface(BINGO_ABI);
const BINGO_TOPICS = [
  BINGO_INTERFACE.getEvent('FirstQuadrantBingo').topicHash,
  BINGO_INTERFACE.getEvent('FirstSymbolBingo').topicHash,
  BINGO_INTERFACE.getEvent('BingoClaimed').topicHash,
];

let _readProvider = null;
let _timer = null;
let _running = false;
let _getAddress = null;
let _refreshInFlight = null;
let _refreshAgain = false;
let _publishSeq = 0;
let _logReader = null;
let _ticketFetcher = null;
let _indexFetcher = null;
let _claimWriter = null;
const _memoryState = new Map();
const _claimableRows = new Map();

function _lower(value) { return value ? String(value).toLowerCase() : null; }
function _storageKey(address) { return `${STORAGE_PREFIX}:${_lower(address)}`; }
function _initialCursor() { return Math.max(0, Number(CHAIN.deployBlock || 0) - 1); }

function _readState(address) {
  const fallback = { cursor: _initialCursor(), rows: [], consumed: [] };
  try {
    const raw = localStorage.getItem(_storageKey(address));
    if (!raw) return _memoryState.get(_storageKey(address)) || fallback;
    const parsed = JSON.parse(raw);
    return {
      cursor: Number.isInteger(Number(parsed?.cursor)) ? Number(parsed.cursor) : fallback.cursor,
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

function _provider() {
  // Event backfills are read traffic and may cover thousands of blocks. Keep
  // them off injected-wallet RPCs, which commonly cap getLogs more harshly.
  if (!_readProvider && CHAIN.rpcUrl) {
    _readProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      { name: CHAIN.name, chainId: Number(CHAIN.id) },
      { staticNetwork: true, batchMaxCount: 2 },
    );
  }
  return _readProvider || getProvider();
}

function _eventIndex(log) {
  return Number(log?.index ?? log?.logIndex ?? 0);
}

function _eventKey(log) {
  return `${String(log?.transactionHash || '').toLowerCase()}:${_eventIndex(log)}`;
}

function _claimKey(level, quadrant) {
  return `claim:${Number(level)}:${Number(quadrant)}`;
}

function _tierKey(log, level, symbol) {
  return `${String(log?.transactionHash || '').toLowerCase()}:${level}:${symbol}`;
}

/** Decode GAME logs into one universal BingoClaimed receipt per claim. */
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

async function _readLogs(args) {
  if (_logReader) return _logReader(args);
  const provider = _provider();
  if (!provider) throw new Error('Bingo event reader unavailable');
  if (args.headOnly) return { head: Number(await provider.getBlockNumber()), logs: [] };
  const logs = await provider.getLogs({
    address: CONTRACTS.GAME,
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
    topics: [BINGO_TOPICS, ethers.zeroPadValue(args.address, 32)],
  });
  return { logs };
}

/** Scan forward and durably retain every unseen receipt for one player. */
export async function scanBingoClaims({ address, head = null } = {}) {
  const addr = _lower(address);
  if (!addr || !CONTRACTS.GAME) return [];
  const state = _readState(addr);
  let chainHead = head == null ? Number.NaN : Number(head);
  if (!Number.isInteger(chainHead) || chainHead < 0) {
    const result = await _readLogs({ address: addr, headOnly: true });
    chainHead = Number(result?.head);
  }
  if (!Number.isInteger(chainHead) || chainHead < 0) return state.rows;

  let from = Math.max(
    Number(CHAIN.deployBlock || 0),
    Number(state.cursor || _initialCursor()) - REORG_OVERLAP_BLOCKS + 1,
  );
  while (from <= chainHead) {
    const to = Math.min(chainHead, from + LOG_CHUNK_BLOCKS - 1);
    const result = await _readLogs({ address: addr, fromBlock: from, toBlock: to });
    _mergeReceipts(state, decodeBingoLogs(result?.logs, addr));
    state.cursor = Math.max(Number(state.cursor || 0), to);
    _writeState(addr, state);
    from = to + 1;
  }
  return state.rows;
}

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
    .filter((row) => row && !consumed.has(row.id));
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
      const traitId = Number(entry?.traitId);
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
  const raw = DGN_SYMBOLS[DGN_QUADRANTS[quadrant]]?.[sym] || `symbol ${sym + 1}`;
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
  const clearAll = async () => {
    const current = _readState(addr);
    _consume(addr, current.rows.map((row) => row.id));
    if (_lower(_getAddress?.()) === addr) await _publish(addr, ++_publishSeq);
  };
  const revealRows = state.rows.map((receipt) => {
    const quadrant = Number(receipt.symbol) >> 3;
    const quadrantName = String(DGN_QUADRANTS[quadrant] || 'trait').toUpperCase();
    const symbolName = _symbolLabel(receipt);
    return {
      id: `bingo:${receipt.id}`,
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
        const accepted = queueReveal({
          kind: 'bingo',
          ...receipt,
          quadrant,
          sym: Number(receipt.symbol) & 7,
          counts,
        });
        if (!accepted) throw new Error('Could not stage Bingo reveal');
        _consume(addr, receipt.id);
        await _publish(addr, ++_publishSeq);
      },
    };
  });

  const consumed = new Set(state.consumed.map(String));
  const claimRows = (_claimableRows.get(addr) || [])
    .filter((candidate) => !consumed.has(candidate.id))
    .map((candidate) => {
      const quadrant = candidate.quadrant;
      const quadrantName = String(DGN_QUADRANTS[quadrant] || 'trait').toUpperCase();
      const symbolName = _symbolLabel(candidate);
      return {
        id: `bingo-claim:${candidate.level}:${quadrant}`,
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
            if (error?.code === 'AlreadyClaimed' || /AlreadyClaimed/.test(String(error?.message || ''))) {
              _consume(addr, candidate.id);
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
    let indexed = false;
    // Tests that inject a log reader intentionally exercise the legacy path.
    if (!_logReader || _indexFetcher) {
      try {
        await _loadIndexedBingos(address);
        indexed = true;
      } catch (error) {
        console.warn?.('[bingo-watch] indexed Bingo read failed; using event fallback', error);
      }
    }
    if (!indexed) {
      try { await scanBingoClaims({ address }); }
      catch (error) { console.warn?.('[bingo-watch] scan failed', error); }
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

export function startBingoWatch({ getAddress } = {}) {
  if (_running) return;
  _running = true;
  _getAddress = typeof getAddress === 'function' ? getAddress : null;
  if (typeof setInterval === 'function') {
    _timer = setInterval(refreshBingoWatch, WATCH_INTERVAL_MS);
    try { _timer?.unref?.(); } catch (_e) { /* browser timer */ }
  }
  refreshBingoWatch();
}

export function stopBingoWatch() {
  if (_timer != null) {
    try { clearInterval(_timer); } catch (_e) { /* defensive */ }
  }
  _timer = null;
  _running = false;
  _getAddress = null;
  _refreshAgain = false;
  _publishSeq += 1;
  clearPendingActions(SOURCE);
}

/** Test seams; production uses the indexed API, configured RPC fallback, and wallet writer. */
export function __setBingoReadersForTest({ logs, tickets, index, claim } = {}) {
  _logReader = typeof logs === 'function' ? logs : null;
  _ticketFetcher = typeof tickets === 'function' ? tickets : null;
  _indexFetcher = typeof index === 'function' ? index : null;
  _claimWriter = typeof claim === 'function' ? claim : null;
}

export function __resetBingoWatchForTest() {
  stopBingoWatch();
  _logReader = null;
  _ticketFetcher = null;
  _indexFetcher = null;
  _claimWriter = null;
  _readProvider = null;
  _refreshInFlight = null;
  _refreshAgain = false;
  _memoryState.clear();
  _claimableRows.clear();
}
