// Surface automatically-settled Bingo rewards as one-time player reveals.
//
// claimBingo is permissionless and the keeper may call it before the player is
// looking at the app. The GAME event is therefore the receipt and the UI's job
// is read-only: scan player-indexed logs, persist unseen receipts, then offer a
// reveal containing the winning 8-color chart line and the credited rewards.

import { CHAIN, CONTRACTS } from './chain-config.js';
import { ethers, getProvider } from './contracts.js';
import { fetchJSON } from '../../beta/app/api.js';
import { DGN_QUADRANTS, DGN_SYMBOLS, dgnBadgePath } from './dgn-traits.js';
import { publishPendingActions, clearPendingActions } from './pending-actions.js';
import { queueReveal } from '../components/reveal-overlay.js';

const SOURCE = 'bingo-claims';
const STORAGE_PREFIX = `degenerus:bingo:${CHAIN.id}:${String(CONTRACTS.GAME || '').toLowerCase()}`;
const WATCH_INTERVAL_MS = 30_000;
const LOG_CHUNK_BLOCKS = 1_000;
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
const _memoryState = new Map();

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
  const wallet = getProvider();
  if (wallet) return wallet;
  if (!_readProvider && CHAIN.rpcUrl) {
    _readProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      { name: CHAIN.name, chainId: Number(CHAIN.id) },
      { staticNetwork: true, batchMaxCount: 2 },
    );
  }
  return _readProvider;
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
  publishPendingActions(SOURCE, state.rows.map((receipt) => {
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
  }));
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
    try { await scanBingoClaims({ address }); }
    catch (error) { console.warn?.('[bingo-watch] scan failed', error); }
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

/** Test seams; production always uses the configured RPC and ticket API. */
export function __setBingoReadersForTest({ logs, tickets } = {}) {
  _logReader = typeof logs === 'function' ? logs : null;
  _ticketFetcher = typeof tickets === 'function' ? tickets : null;
}

export function __resetBingoWatchForTest() {
  stopBingoWatch();
  _logReader = null;
  _ticketFetcher = null;
  _readProvider = null;
  _refreshInFlight = null;
  _refreshAgain = false;
  _memoryState.clear();
}
