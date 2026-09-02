// /app/app/records.js — the five all-time records and the pool they claim from.
//
// One shared FLIP pool backs five permanent
// high-water marks: biggest flip, biggest Degenerette spin, biggest lootbox
// deposit, biggest ticket buy, and biggest scheduled Dice Run. Settlement and
// level-transition paths fund the pool, while successful record claims reduce
// it immediately.
//
// ⛔ THE MARKS ARE ON CHAIN; THE HOLDERS ARE IN EVENTS. Every `biggest*Ever`
// slot holds a bare uint128 — no address. The holder exists only in
// `BigRecordUpdated(kind, player, value, paid, sdgnrsPaid)`, which the indexer
// normally rolls into `coinflip_records`. Dice Run shipped before that indexer
// learned kind 4, so its latest event is also recovered directly from chain;
// the same transaction supplies the winning Craps replay perspective.

import { fetchJSON } from './api.js';
import { CHAIN, CONTRACTS, ETH_DIVISOR } from './chain-config.js';
import {
  readContractStorage,
  readProviderBlockNumber,
  readTransactionReceipt,
  sharedReadProvider,
} from './read-provider.js';
import { ethers, getProvider } from './contracts.js';
import { displayEthCompact, displayToken } from './scaling.js';

/** RECORD_KIND_* — ICoinflip.sol. Slot order is the on-chain kind order. */
export const RECORD_KIND_FLIP = 0;
export const RECORD_KIND_SPIN = 1;
export const RECORD_KIND_LUCKBOX = 2;
export const RECORD_KIND_BUY = 3;
export const RECORD_KIND_DICE_RUN = 4;

/** Session API — the only place an address maps to a Discord display identity. */
const SESSION_API = 'https://api.degener.us';
const RECORD_POOL_ABI = [
  'function recordPool() external view returns (uint128)',
  'function biggestFlipEver() external view returns (uint128)',
  'function biggestSpinEver() external view returns (uint128)',
  'function biggestLuckboxEver() external view returns (uint128)',
  'function biggestBuyEver() external view returns (uint128)',
  'function biggestDiceRunEver() external view returns (uint128)',
];
const BIG_RECORD_EVENT_ABI = [
  'event BigRecordUpdated(uint8 indexed kind,address indexed player,uint256 value,uint128 paid,uint256 sdgnrsPaid)',
];
const CRAPS_RECORD_REPLAY_ABI = [
  'event CrapsBattleFinalized(bytes32 indexed battleKey,uint8 winningStop,uint64 winnerId,uint256 winningPeak,uint256 winningEnd,uint256 winningScoreBps,uint256 pot)',
  'event CrapsBattlePaid(uint256 indexed betId,bytes32 indexed battleKey,address indexed player,uint256 amount)',
];
const TOKEN_UNIT = 10n ** 18n;
const DICE_RUN_LOG_REORG_TAIL_BLOCKS = 12;
const DICE_RUN_LOG_CHUNK_BLOCKS = 10_000;
// Coinflip storage layout for this immutable deployment. Slot 4 packs the
// claimable-day latch, one bool, the original four uint24 record clocks at byte
// offsets 4/7/10/13, two unrelated uint24 fields, then Dice Run's clock at byte
// 22. There is no public Solidity getter for these clocks, so a single
// eth_getStorageAt keeps accrued bounty shares exact while an indexer migration
// or replay is catching up.
const RECORD_CLOCK_STORAGE_SLOT = 4n;
const RECORD_CLOCK_BYTE_OFFSETS = Object.freeze([4n, 7n, 10n, 13n, 22n]);
const UINT24_MASK = (1n << 24n) - 1n;

const RECORD_GETTER_BY_KIND = new Map([
  [RECORD_KIND_FLIP, 'biggestFlipEver'],
  [RECORD_KIND_SPIN, 'biggestSpinEver'],
  [RECORD_KIND_LUCKBOX, 'biggestLuckboxEver'],
  [RECORD_KIND_BUY, 'biggestBuyEver'],
  [RECORD_KIND_DICE_RUN, 'biggestDiceRunEver'],
]);

let _publicPoolProvider = null;
let _poolReadInflight = null;
let _lastLiveRecordPool = null;
let _clockReadInflight = null;
let _lastLiveRecordClocks = null;
let _markReadInflight = null;
let _lastLiveRecordMarks = null;
let _diceRunReadInflight = null;
let _lastLiveDiceRunRecord = null;
let _diceRunLogWindow = null;
let _lastRecordsPayload = null;
let _fetchRecordsJSON = fetchJSON;
let _readRecordPool = readLiveRecordPool;
let _readRecordClocks = readLiveRecordClocks;
let _readRecordMarks = readLiveRecordMarks;
let _readDiceRunRecord = readLiveDiceRunRecord;
// readLiveDiceRunRecord is API-first off the SAME /records payload fetchRecords
// already fetches (no second call): a `diceRun` key present means the API
// carries kind-4 support, so it is used directly. Its absence (older API) or
// the shared fetch throwing falls back to the existing persisted BigRecordUpdated
// chain scan below, which is then memoized 5 minutes so the 15s poller does not
// re-run it every tick while the API stays behind.
const DICE_RUN_CHAIN_FALLBACK_MEMO_MS = 5 * 60 * 1000;
let _diceRunChainFallbackMemoUntil = 0;
// Test-only observability: how many times the chain-scan branch actually ran
// (as opposed to short-circuiting on the memo above). There is no other way to
// see the memo take effect without a live network read.
let _diceRunChainFallbackRuns = 0;

/**
 * Per-kind presentation facts.
 *
 * `unit` drives formatting and is NOT interchangeable: FLIP wei for the flip
 * record, ETH wei for spin and lootbox, a plain whole-ticket COUNT for the buy
 * record (`entryQuantityScaled / (4 * QTY_SCALE)` —
 * DegenerusGameFoilPackModule.sol:199-202, so no ticket divisor applies).
 * Dice Run is a high-point ratio in score basis points, where 10,000 = 1x.
 *
 * `floorText` is the player-facing entry floor below which a candidate never
 * even reads the record slot. ETH values use the same mainnet-equivalent
 * display scale as every other amount in the app, including on testnet.
 */
export const RECORD_KINDS = [
  {
    kind: RECORD_KIND_FLIP,
    unit: 'flip',
    label: 'BIGGEST FLIP',
    short: 'FLIP',
    // Coinflip.sol:174 BIGGEST_FLIP_MIN = 200_000 ether (FLIP, unscaled).
    floorText: '200,000 FLIP',
    floorValue: 200_000n * TOKEN_UNIT,
    verb: 'flip',
  },
  {
    kind: RECORD_KIND_SPIN,
    unit: 'eth',
    label: 'BIGGEST DEGENERETTE',
    short: 'DEGENERETTE',
    // DegenerusGameDegeneretteModule.sol:256 BIGGEST_SPIN_MIN_ETH = 1 ether.
    floorText: '1 ETH',
    floorValue: TOKEN_UNIT / ETH_DIVISOR,
    verb: 'spin',
  },
  {
    kind: RECORD_KIND_LUCKBOX,
    unit: 'eth',
    label: 'BIGGEST LUCKBOX',
    short: 'LUCKBOX',
    // DegenerusGameMintModule.sol:131 BIGGEST_BOX_MIN_ETH = 5 ether.
    floorText: '5 ETH',
    floorValue: (5n * TOKEN_UNIT) / ETH_DIVISOR,
    verb: 'lootbox',
  },
  {
    kind: RECORD_KIND_BUY,
    unit: 'tickets',
    label: 'BIGGEST PACK RIPPED',
    short: 'PACK RIPPED',
    // DegenerusGame.sol:162 BIGGEST_BUY_MIN_TICKETS = 100 (whole tickets).
    floorText: '100 TICKETS',
    floorValue: 100n,
    verb: 'buy',
  },
  {
    kind: RECORD_KIND_DICE_RUN,
    unit: 'multiple-bps',
    label: 'BIGGEST DICE RUN',
    short: 'DICE RUN',
    // Coinflip.sol BIGGEST_DICE_RUN_MIN = 1_000_000 score bps = 100x.
    floorText: '100×',
    floorValue: 1_000_000n,
    verb: 'run',
  },
];

const KIND_BY_ID = new Map(RECORD_KINDS.map((entry) => [entry.kind, entry]));

/** Presentation facts for a RECORD_KIND_*, or null when the kind is unknown. */
export function recordKindMeta(kind) {
  return KIND_BY_ID.get(Number(kind)) ?? null;
}

export function toBigInt(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
}

function recordPoolProvider() {
  if (!_publicPoolProvider && CHAIN.rpcUrl) {
    // The pool is global, so pin reads to the configured chain instead of the
    // wallet's current network. This also keeps the board live for visitors
    // who have not connected a wallet.
    _publicPoolProvider = sharedReadProvider();  // C15: shared batched read stream
  }
  return _publicPoolProvider || getProvider();
}

/**
 * Authoritative shared bounty balance.
 *
 * `_armBigRecord` writes `recordPool = pool - paid` before it emits
 * BigRecordUpdated. The indexed singleton is a settlement snapshot and can
 * therefore remain higher after an intra-day record claim; this direct getter
 * is what makes the displayed pool fall in the same mined block as the hit.
 */
export async function readLiveRecordPool() {
  if (_poolReadInflight) return _poolReadInflight;
  const request = (async () => {
    try {
      const provider = recordPoolProvider();
      if (!provider || !CONTRACTS.COINFLIP) return null;
      const value = await new ethers.Contract(
        CONTRACTS.COINFLIP,
        RECORD_POOL_ABI,
        provider,
      ).recordPool();
      if (value == null) return _lastLiveRecordPool;
      _lastLiveRecordPool = toBigInt(value);
      return _lastLiveRecordPool;
    } catch (_e) {
      // The API snapshot is still a useful degraded read if the public RPC is
      // unavailable on first paint. Once a chain value has landed, retain it
      // so one failed poll cannot make a paid-out pool jump back upward.
      return _lastLiveRecordPool;
    }
  })();
  _poolReadInflight = request;
  try {
    return await request;
  } finally {
    if (_poolReadInflight === request) _poolReadInflight = null;
  }
}

/** Decode Coinflip's five packed uint24 record claim clocks. */
export function decodeRecordClockSlot(raw) {
  let packed;
  try { packed = BigInt(raw ?? 0); } catch (_e) { return null; }
  return RECORD_CLOCK_BYTE_OFFSETS.map((byteOffset) => {
    const day = Number((packed >> (byteOffset * 8n)) & UINT24_MASK);
    return Number.isInteger(day) && day > 0 ? day : null;
  });
}

/**
 * Exact per-kind record clocks from the deployed Coinflip storage.
 *
 * The API remains the normal indexed source, but rows created before its
 * clockDay migration legitimately return null. Reading one packed slot avoids
 * flattening every category to the 5% safety floor in that state.
 */
export async function readLiveRecordClocks() {
  if (_clockReadInflight) return _clockReadInflight;
  const request = (async () => {
    try {
      const provider = recordPoolProvider();
      if (!provider || !CONTRACTS.COINFLIP) {
        return _lastLiveRecordClocks;
      }
      const raw = await readContractStorage(
        CONTRACTS.COINFLIP,
        RECORD_CLOCK_STORAGE_SLOT,
        { provider },
      );
      const decoded = decodeRecordClockSlot(raw);
      if (!decoded || !decoded.some((day) => day != null)) return _lastLiveRecordClocks;
      _lastLiveRecordClocks = decoded;
      return decoded;
    } catch (_e) {
      return _lastLiveRecordClocks;
    }
  })();
  _clockReadInflight = request;
  try {
    return await request;
  } finally {
    if (_clockReadInflight === request) _clockReadInflight = null;
  }
}

/**
 * Authoritative permanent high-water marks, in RECORD_KIND_* order.
 *
 * A bounty claim updates its mark and pays down `recordPool` in the same
 * transaction. Reading only the pool from chain made the bounty visibly move
 * while its winning amount remained stuck on the indexer's previous row.
 */
export async function readLiveRecordMarks() {
  if (_markReadInflight) return _markReadInflight;
  const request = (async () => {
    try {
      const provider = recordPoolProvider();
      if (!provider || !CONTRACTS.COINFLIP) return _lastLiveRecordMarks;
      const contract = new ethers.Contract(CONTRACTS.COINFLIP, RECORD_POOL_ABI, provider);
      const values = await Promise.all(RECORD_KINDS.map(async (meta) => {
        const getter = RECORD_GETTER_BY_KIND.get(meta.kind);
        if (typeof contract[getter] !== 'function') return null;
        try { return await contract[getter](); }
        catch (_e) { return null; }
      }));
      const prior = Array.isArray(_lastLiveRecordMarks) ? _lastLiveRecordMarks : [];
      const merged = values.map((value, index) => (
        value == null ? prior[index] ?? null : toBigInt(value)
      ));
      if (!merged.some((value) => value != null)) return _lastLiveRecordMarks;
      _lastLiveRecordMarks = merged;
      return _lastLiveRecordMarks;
    } catch (_e) {
      return _lastLiveRecordMarks;
    }
  })();
  _markReadInflight = request;
  try {
    return await request;
  } finally {
    if (_markReadInflight === request) _markReadInflight = null;
  }
}

let _bigRecordEventInterface = null;
let _crapsRecordReplayInterface = null;

function bigRecordEventInterface() {
  _bigRecordEventInterface ??= new ethers.Interface(BIG_RECORD_EVENT_ABI);
  return _bigRecordEventInterface;
}

function crapsRecordReplayInterface() {
  _crapsRecordReplayInterface ??= new ethers.Interface(CRAPS_RECORD_REPLAY_ABI);
  return _crapsRecordReplayInterface;
}

function normalizedRecordAddress(value) {
  const address = String(value ?? '').toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(address) ? address : null;
}

function parsedRecordLog(iface, log) {
  if (log?.parsed) return log.parsed;
  try { return iface.parseLog(log); } catch (_e) { return null; }
}

/**
 * Join a Dice Run record event to the finalized battle and winning payment in
 * the same receipt. The record event supplies identity; the Craps pair supplies
 * the immutable replay key and the winner's bet id (the initial perspective).
 *
 * Identity remains useful when a legacy/malformed receipt lacks replay logs,
 * so a valid candidate returns with `replay: null` instead of disappearing.
 */
export function diceRunRecordFromReceipt(candidate, receipt) {
  const player = normalizedRecordAddress(candidate?.player);
  const value = toBigInt(candidate?.value);
  if (!player || value <= 0n) return null;

  const blockNumber = Number(candidate?.blockNumber);
  const transactionHash = String(candidate?.transactionHash ?? '').toLowerCase() || null;
  const base = {
    player,
    value,
    blockNumber: Number.isSafeInteger(blockNumber) && blockNumber >= 0 ? blockNumber : null,
    transactionHash,
    replay: null,
  };
  const iface = crapsRecordReplayInterface();
  const crapsAddress = normalizedRecordAddress(CONTRACTS.CRAPS);
  const finalized = [];
  const paid = [];

  for (const log of receipt?.logs ?? []) {
    const logAddress = normalizedRecordAddress(log?.address);
    if (crapsAddress && logAddress !== crapsAddress) continue;
    const parsed = parsedRecordLog(iface, log);
    if (!parsed) continue;
    const args = parsed.args ?? {};
    try {
      if (parsed.name === 'CrapsBattleFinalized') {
        const scoreBps = toBigInt(args.winningScoreBps ?? args[5]);
        if (scoreBps !== value) continue;
        finalized.push({
          battleKey: String(args.battleKey ?? args[0]).toLowerCase(),
          winningStop: Number(args.winningStop ?? args[1]),
          potWei: toBigInt(args.pot ?? args[6]).toString(),
        });
      } else if (parsed.name === 'CrapsBattlePaid') {
        const winner = normalizedRecordAddress(args.player ?? args[2]);
        if (winner !== player) continue;
        paid.push({
          betId: toBigInt(args.betId ?? args[0]).toString(),
          battleKey: String(args.battleKey ?? args[1]).toLowerCase(),
          amountWei: toBigInt(args.amount ?? args[3]).toString(),
        });
      }
    } catch (_e) { /* ignore one malformed log without losing holder identity */ }
  }

  for (const final of finalized) {
    if (!/^0x[0-9a-f]{64}$/.test(final.battleKey)) continue;
    const payment = paid.find((entry) => (
      entry.battleKey === final.battleKey && toBigInt(entry.betId) > 0n
    ));
    if (!payment) continue;
    return Object.freeze({
      ...base,
      replay: Object.freeze({
        battleKey: final.battleKey,
        viewerBetId: payment.betId,
        settledMainPotWei: final.potWei,
        battleWinner: player,
        battleWinnerBetId: payment.betId,
        battlePayoutWei: payment.amountWei,
        battleWinningStop: final.winningStop === 0 || final.winningStop === 1
          ? final.winningStop
          : null,
      }),
    });
  }
  return Object.freeze(base);
}

function diceRunLogIndex(log) {
  const value = Number(log?.index ?? log?.logIndex ?? -1);
  return Number.isSafeInteger(value) ? value : -1;
}

function diceRunCandidateFromLog(log) {
  const parsed = parsedRecordLog(bigRecordEventInterface(), log);
  if (parsed?.name !== 'BigRecordUpdated') return null;
  const args = parsed.args ?? {};
  if (Number(args.kind ?? args[0]) !== RECORD_KIND_DICE_RUN) return null;
  const player = normalizedRecordAddress(args.player ?? args[1]);
  const value = toBigInt(args.value ?? args[2]);
  const transactionHash = String(log?.transactionHash ?? '').toLowerCase();
  const blockNumber = Number(log?.blockNumber);
  if (!player || value <= 0n || !/^0x[0-9a-f]{64}$/.test(transactionHash)
      || !Number.isSafeInteger(blockNumber) || blockNumber < 0) return null;
  return {
    player,
    value,
    transactionHash,
    blockNumber,
    logIndex: diceRunLogIndex(log),
  };
}

async function fetchDiceRunLogRange(provider, filter, fromBlock, toBlock) {
  if (fromBlock > toBlock) return [];
  try {
    const logs = await provider.getLogs({ ...filter, fromBlock, toBlock });
    return Array.isArray(logs) ? logs : [];
  } catch (wideError) {
    const logs = [];
    for (let start = fromBlock; start <= toBlock; start += DICE_RUN_LOG_CHUNK_BLOCKS) {
      const end = Math.min(toBlock, start + DICE_RUN_LOG_CHUNK_BLOCKS - 1);
      try {
        const chunk = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
        if (Array.isArray(chunk)) logs.push(...chunk);
      } catch (_chunkError) {
        // A partial history could misidentify an old holder as the permanent
        // high-water mark. Keep the previous complete snapshot instead.
        throw wideError;
      }
    }
    return logs;
  }
}

// Persisted mirror of the in-memory window, keyed on chain + contract +
// deploy block so a redeploy busts it. Without it every page RELOAD paid a
// fresh deploy→head getLogs rescan (the in-memory cache only helps within one
// session); with it a reload pays only the 12-block reorg tail, the same
// incremental pattern launch-claims/wwxrp-draw/charity-vote already persist.
// Record events are rare, so the serialized array stays tiny.
function _diceRunLogCacheKey(address, deployBlock) {
  return `dice-run-logs:v1:${CHAIN.id}:${address}:${deployBlock}`;
}

function _readPersistedDiceRunWindow(address, deployBlock) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const parsed = JSON.parse(localStorage.getItem(_diceRunLogCacheKey(address, deployBlock)));
    if (!parsed
      || Number(parsed.fromBlock) !== deployBlock
      || !Number.isSafeInteger(Number(parsed.toBlock))
      || !Array.isArray(parsed.logs)) return null;
    return { toBlock: Number(parsed.toBlock), logs: parsed.logs };
  } catch (_e) { return null; }
}

function _writePersistedDiceRunWindow(address, deployBlock, toBlock, logs) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(_diceRunLogCacheKey(address, deployBlock), JSON.stringify({
      fromBlock: deployBlock,
      toBlock,
      // Keep only what candidate decoding needs: parseLog reads topics+data,
      // provenance reads transactionHash/blockNumber/index.
      logs: logs.map((log) => ({
        blockNumber: Number(log?.blockNumber),
        index: Number(log?.index ?? log?.logIndex ?? -1),
        transactionHash: log?.transactionHash ?? null,
        topics: Array.isArray(log?.topics) ? [...log.topics] : [],
        data: log?.data ?? '0x',
      })),
    }));
  } catch (_e) { /* quota/serialization — the in-memory window still works */ }
}

async function readDiceRunRecordLogs(provider, latestBlock) {
  const address = normalizedRecordAddress(CONTRACTS.COINFLIP);
  if (!address) return [];
  const deployBlock = Math.max(0, Number(CHAIN.deployBlock ?? 0));
  let cached = _diceRunLogWindow;
  const reusable = Boolean(cached
    && cached.provider === provider
    && cached.address === address
    && cached.fromBlock === deployBlock
    && cached.toBlock <= latestBlock);
  if (!reusable) {
    const persisted = _readPersistedDiceRunWindow(address, deployBlock);
    cached = persisted && persisted.toBlock <= latestBlock
      ? { logs: persisted.logs, toBlock: persisted.toBlock }
      : null;
  }
  const fetchFrom = cached
    ? Math.max(deployBlock, cached.toBlock - DICE_RUN_LOG_REORG_TAIL_BLOCKS + 1)
    : deployBlock;
  const iface = bigRecordEventInterface();
  const topics = iface.encodeFilterTopics(iface.getEvent('BigRecordUpdated'), [
    RECORD_KIND_DICE_RUN,
  ]);
  const fresh = await fetchDiceRunLogRange(
    provider,
    { address, topics },
    fetchFrom,
    latestBlock,
  );
  const retained = cached
    ? cached.logs.filter((log) => Number(log?.blockNumber) < fetchFrom)
    : [];
  const logs = retained.length ? retained.concat(fresh) : fresh;
  _diceRunLogWindow = {
    provider,
    address,
    fromBlock: deployBlock,
    toBlock: latestBlock,
    logs,
  };
  _writePersistedDiceRunWindow(address, deployBlock, latestBlock, logs);
  return logs;
}

/**
 * Normalize the `/records` payload's `diceRun` fragment into the candidate
 * shape `diceRunRecordFromReceipt` expects.
 *
 * Returns `null` when the fragment is present and confirms no record is held
 * yet — a complete, legitimate API answer, not a reason to fall back. Returns
 * `undefined` when the fragment is missing or too malformed to trust (no
 * player/value, or an unusable transactionHash/blockNumber), which tells the
 * caller to use the chain fallback instead.
 */
export function diceRunCandidateFromApiPayload(diceRun) {
  if (diceRun == null || typeof diceRun !== 'object') return undefined;
  const player = normalizedRecordAddress(diceRun.player);
  const value = toBigInt(diceRun.value);
  if (!player || value <= 0n) return null;
  const transactionHash = String(diceRun.transactionHash ?? '').toLowerCase();
  const blockNumber = Number(diceRun.blockNumber);
  if (!/^0x[0-9a-f]{64}$/.test(transactionHash)
    || !Number.isSafeInteger(blockNumber) || blockNumber < 0) return undefined;
  const rawLogIndex = Number(diceRun.logIndex);
  return {
    player,
    value,
    transactionHash,
    blockNumber,
    logIndex: Number.isSafeInteger(rawLogIndex) ? rawLogIndex : -1,
  };
}

/** Test-only observability: how many times the chain-scan fallback actually ran. */
export function __diceRunChainFallbackRunsForTest() {
  return _diceRunChainFallbackRuns;
}

/**
 * Recover the current Dice Run record holder and replay provenance from chain.
 * This closes the gap left by `/records` deployments that still emit only the
 * original kinds 0–3, and survives as a fallback for the API-first path below.
 */
async function _readLiveDiceRunRecordFromChain() {
  if (Date.now() < _diceRunChainFallbackMemoUntil) return _lastLiveDiceRunRecord;
  if (_diceRunReadInflight) return _diceRunReadInflight;
  _diceRunChainFallbackRuns += 1;
  const request = (async () => {
    try {
      const provider = recordPoolProvider();
      if (!provider?.getLogs || !CONTRACTS.COINFLIP || !CONTRACTS.CRAPS) {
        return _lastLiveDiceRunRecord;
      }
      const latestBlock = Number(await readProviderBlockNumber(provider));
      if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
        return _lastLiveDiceRunRecord;
      }
      const logs = await readDiceRunRecordLogs(provider, latestBlock);
      const candidates = logs
        .map(diceRunCandidateFromLog)
        .filter(Boolean)
        .sort((left, right) => (
          left.blockNumber - right.blockNumber || left.logIndex - right.logIndex
        ));
      const candidate = candidates.at(-1) ?? null;
      if (!candidate) return _lastLiveDiceRunRecord;
      if (_lastLiveDiceRunRecord?.transactionHash === candidate.transactionHash
          && _lastLiveDiceRunRecord?.value === candidate.value
          && _lastLiveDiceRunRecord?.replay) {
        return _lastLiveDiceRunRecord;
      }
      let receipt = null;
      try {
        receipt = await readTransactionReceipt(candidate.transactionHash, { provider });
      } catch (_e) { /* holder identity still renders while receipt RPC retries */ }
      _lastLiveDiceRunRecord = diceRunRecordFromReceipt(candidate, receipt)
        ?? _lastLiveDiceRunRecord;
      return _lastLiveDiceRunRecord;
    } catch (_e) {
      return _lastLiveDiceRunRecord;
    }
  })();
  _diceRunReadInflight = request;
  try {
    return await request;
  } finally {
    if (_diceRunReadInflight === request) _diceRunReadInflight = null;
    _diceRunChainFallbackMemoUntil = Date.now() + DICE_RUN_CHAIN_FALLBACK_MEMO_MS;
  }
}

/**
 * API-first: build the Dice Run record straight from the `diceRun` fragment of
 * the SAME `/records` payload `fetchRecords` already fetched (never a second
 * call). The receipt fetch below (to recover the Craps battle replay) is the
 * only chain read this path needs; the BigRecordUpdated log scan is skipped
 * entirely.
 */
async function _readDiceRunRecordFromApi(diceRun) {
  const candidate = diceRunCandidateFromApiPayload(diceRun);
  if (candidate === null) return null;
  if (candidate === undefined) return _readLiveDiceRunRecordFromChain();
  try {
    const provider = recordPoolProvider();
    let receipt = null;
    if (provider) {
      try { receipt = await readTransactionReceipt(candidate.transactionHash, { provider }); }
      catch (_e) { /* holder identity still renders while receipt RPC retries */ }
    }
    const record = diceRunRecordFromReceipt(candidate, receipt);
    if (record) _lastLiveDiceRunRecord = record;
    return record ?? _lastLiveDiceRunRecord;
  } catch (_e) {
    return _readLiveDiceRunRecordFromChain();
  }
}

/**
 * Recover the current Dice Run record holder and replay provenance.
 *
 * API-first: `payload` is the SAME `/records` response `fetchRecords` already
 * fetched. A `diceRun` key present is used directly (with one receipt read to
 * recover the Craps battle replay); its absence (older API) or `payload` being
 * unavailable (the shared fetch threw) falls back to the persisted
 * BigRecordUpdated chain scan, memoized 5 minutes so the 15s poller does not
 * re-run it every tick.
 */
export async function readLiveDiceRunRecord({ payload } = {}) {
  if (payload && typeof payload === 'object' && 'diceRun' in payload) {
    return _readDiceRunRecordFromApi(payload.diceRun);
  }
  return _readLiveDiceRunRecordFromChain();
}

/**
 * The smallest candidate that CLAIMS a share of the pool rather than merely
 * ratcheting the mark.
 *
 * Mirrors `(candidate - mark) * RECORD_BEAT_DIV >= mark` (Coinflip.sol:872).
 * The contract multiplies the increase instead of dividing the mark, so the
 * exact threshold is `mark + ceil(mark/5)`, not `mark + mark/5` — those differ
 * for any mark not divisible by five, and the floored form would understate the
 * bar.
 */
export function barToBeat(mark) {
  const value = toBigInt(mark);
  if (value <= 0n) return 0n;
  return value + (value + 4n) / 5n;
}

/** Exact bounty-paying target when the current on-chain mark is already known. */
export function recordClaimTargetForMark(kind, mark) {
  const meta = recordKindMeta(kind);
  if (!meta) return null;
  const value = toBigInt(mark);
  if (value <= 0n) return toBigInt(meta.floorValue);
  // Scheduled Dice Run is intentionally different from the four direct-action
  // records: every strict improvement claims, so its next target is mark + 1
  // score bps rather than mark + 20%.
  if (Number(kind) === RECORD_KIND_DICE_RUN) return value + 1n;
  return barToBeat(value);
}

/**
 * Exact candidate that would claim this kind's live bounty right now.
 *
 * The first holder clears the contract entry floor. Once a mark exists, the
 * original four kinds use the +20% claim predicate; Dice Run claims on every
 * strict improvement.
 */
export function recordClaimTarget(state, kind) {
  const meta = recordKindMeta(kind);
  const record = Array.isArray(state?.records)
    ? state.records.find((entry) => Number(entry?.kind) === Number(kind))
    : null;
  if (!meta || !record) return null;
  if (!record.held) return toBigInt(meta.floorValue);
  if (Number(kind) === RECORD_KIND_DICE_RUN) {
    return recordClaimTargetForMark(kind, record.value);
  }
  // Normalized records carry both fields. Retaining an explicit bar also keeps
  // quote helpers compatible with small caller-owned snapshots that omit the
  // standing value but already carry the contract-derived target.
  const explicitTarget = toBigInt(record.barToBeat);
  return explicitTarget > 0n
    ? explicitTarget
    : recordClaimTargetForMark(kind, record.value);
}

/**
 * Read one permanent record directly from Coinflip.
 *
 * The API remains necessary for holder identity and claim history, but it can
 * trail a mined BigRecordUpdated event. Transaction presets use this getter so
 * the amount placed in the wallet is based on the head-chain mark, not a stale
 * indexer row.
 */
export async function readLiveRecordMark(kind) {
  const recordKind = Number(kind);
  if (!RECORD_GETTER_BY_KIND.has(recordKind)) return null;
  const marks = await readLiveRecordMarks();
  return Array.isArray(marks) ? marks[recordKind] ?? null : null;
}

/** True only when `candidate` reaches the exact live bounty-paying target. */
export function candidateClaimsRecord(state, kind, candidate) {
  const target = recordClaimTarget(state, kind);
  if (target == null || target <= 0n) return false;
  let value;
  try { value = BigInt(candidate); } catch (_e) { return false; }
  return value >= target;
}

/**
 * The share curve a record claim takes from the pool — Coinflip.sol:166-168.
 * A 5% floor, +0.5% per day since THAT kind last stamped its clock, capped at
 * 75% (reached 140 days out). Mirrored here rather than read on chain: the
 * clock lives in `internal` storage with no getter.
 */
const SHARE_FLOOR_BPS = 500;
const SHARE_PER_DAY_BPS = 50;
const SHARE_CEIL_BPS = 7_500;

/**
 * What a claim on this record would take from the pool right now, in bps.
 *
 * An unset mark still has a live bounty. Coinflip's constructor stamps every
 * category at deploy day 1, and the `mark == 0` branch pays the share accrued
 * from that clock when somebody clears the category's entry floor. The API has
 * no event from which to reconstruct that untouched clock, so a null clock is
 * exactly inferable as day 1 only while `held` is false. For a held record whose
 * indexer clock is missing, the exact accrual is unknown but the contract's 5%
 * floor is not: show that guaranteed minimum rather than a misleading dash.
 *
 * @returns {number|null} bps, or null when it cannot be known
 */
export function accruedShareBps({ held, clockDay, today }) {
  // A held row without its clock can always be quoted at the contract floor,
  // even during the brief boot window before the app's current day arrives.
  if (clockDay == null && held) return SHARE_FLOOR_BPS;
  if (today == null) return null;
  // GameTimeLib is 1-indexed. Untouched categories have no BigRecordUpdated
  // event, but their constructor clock is known exactly. Some early indexed
  // deploy-day claims were stored as zero; normalize that impossible contract
  // day to day 1 as well.
  let stamped;
  if (clockDay == null) {
    stamped = 1;
  } else {
    stamped = Number(clockDay);
    if (stamped === 0) stamped = 1;
  }
  const now = Number(today);
  if (!Number.isInteger(stamped) || stamped <= 0
    || !Number.isInteger(now) || now <= 0) return null;
  const elapsed = now > stamped ? now - stamped : 0;
  return Math.min(SHARE_FLOOR_BPS + elapsed * SHARE_PER_DAY_BPS, SHARE_CEIL_BPS);
}

/** The pool FLIP that share is worth. null when the share is unknown. */
export function accruedPayoutWei(poolWei, shareBps) {
  if (shareBps == null) return null;
  return (toBigInt(poolWei) * BigInt(shareBps)) / 10_000n;
}

/**
 * Exact FLIP credit a live candidate would take from the shared pool.
 *
 * `0n` means the candidate does not clear this record's bounty bar. `null`
 * means it clears the bar but the current day is unavailable for a record
 * whose exact clock is known; a missing held clock still returns its guaranteed
 * 5% floor.
 */
export function candidateRecordPayoutWei({
  state,
  kind,
  candidate,
  today,
  poolWei = state?.recordPoolWei,
} = {}) {
  if (!candidateClaimsRecord(state, kind, candidate)) return 0n;
  const record = Array.isArray(state?.records)
    ? state.records.find((entry) => Number(entry?.kind) === Number(kind))
    : null;
  if (!record) return 0n;
  const shareBps = accruedShareBps({
    held: Boolean(record.held),
    clockDay: record.clockDay,
    today,
  });
  return accruedPayoutWei(poolWei, shareBps);
}

function group(value) {
  const [whole, fraction] = String(value ?? '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

/** Exact score-bps ratio, where 10,000 bps is one bankroll multiple. */
export function formatRecordMultiple(value) {
  const bps = toBigInt(value);
  const whole = bps / 10_000n;
  const fraction = (bps % 10_000n)
    .toString()
    .padStart(4, '0')
    .replace(/0+$/, '');
  return fraction ? `${group(whole.toString())}.${fraction}` : group(whole.toString());
}

/**
 * Render a record value in its own unit.
 *
 * @returns {{amount: string, suffix: string}}
 */
export function formatRecordValue(kind, raw) {
  const meta = recordKindMeta(kind);
  const value = toBigInt(raw);
  if (meta?.unit === 'eth') {
    return { amount: group(displayEthCompact(value, 4)), suffix: 'ETH' };
  }
  if (meta?.unit === 'tickets') {
    return { amount: group(value.toString()), suffix: 'TICKETS' };
  }
  if (meta?.unit === 'multiple-bps') {
    return { amount: formatRecordMultiple(value), suffix: '×' };
  }
  return { amount: group(displayToken(value, 0)), suffix: 'FLIP' };
}

/** Short address for a holder with no linked Discord account. */
export function shortAddress(value) {
  const address = String(value || '');
  if (!address) return '—';
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Normalize the `/records` payload into five ordered, defensive slots.
 *
 * Older API deployments zero-fill only the original four kinds. The live
 * Coinflip getter still lets the fifth Dice Run slot render without collapsing
 * the row while indexed holder/history support catches up.
 */
export function normalizeRecords(
  payload,
  liveRecordPool = null,
  liveRecordClocks = null,
  liveRecordMarks = null,
  liveDiceRunRecord = null,
) {
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  const byKind = new Map(rows.map((row) => [Number(row?.kind), row]));

  return {
    recordPoolWei: liveRecordPool == null
      ? toBigInt(payload?.recordPool)
      : toBigInt(liveRecordPool),
    records: RECORD_KINDS.map((meta) => {
      const row = byKind.get(meta.kind) ?? null;
      const indexedValue = toBigInt(row?.value);
      const rawLiveMark = Array.isArray(liveRecordMarks)
        ? liveRecordMarks[meta.kind]
        : null;
      const liveMark = rawLiveMark == null ? null : toBigInt(rawLiveMark);
      const diceRunProvenance = meta.kind === RECORD_KIND_DICE_RUN
        ? liveDiceRunRecord
        : null;
      const provenanceValue = diceRunProvenance == null
        ? null
        : toBigInt(diceRunProvenance.value);
      // Permanent marks only ratchet upward. Taking the maximum prevents a
      // briefly lagging RPC from rolling back an already-indexed newer mark.
      let value = indexedValue;
      if (liveMark != null && liveMark > value) value = liveMark;
      if (provenanceValue != null && provenanceValue > value) value = provenanceValue;
      const indexedMatches = indexedValue > 0n && indexedValue === value;
      const provenanceMatches = provenanceValue != null
        && provenanceValue > 0n
        && provenanceValue === value;
      const indexedPlayer = String(row?.player || '').toLowerCase() || null;
      const provenancePlayer = normalizedRecordAddress(diceRunProvenance?.player);
      const player = value <= 0n
        ? null
        : provenanceMatches && provenancePlayer
          ? provenancePlayer
          : indexedMatches
            ? indexedPlayer
            : null;
      const indexedClock = row?.clockDay == null || !Number.isInteger(Number(row.clockDay))
        ? null
        : Number(row.clockDay);
      const rawLiveClock = Array.isArray(liveRecordClocks)
        ? liveRecordClocks[meta.kind]
        : null;
      const liveClock = Number.isInteger(Number(rawLiveClock)) && Number(rawLiveClock) > 0
        ? Number(rawLiveClock)
        : null;
      return {
        kind: meta.kind,
        meta,
        // Never attach an old indexed holder to a newer mark. Dice Run's event
        // fallback is safe only when its value exactly matches that mark.
        player,
        value,
        barToBeat: value > 0n
          ? recordClaimTargetForMark(meta.kind, value)
          : 0n,
        claimCount: Number(row?.claimCount ?? 0) || 0,
        totalPaidFlip: toBigInt(row?.totalPaidFlip),
        // The packed chain clock is authoritative and also fills pre-migration
        // API rows. Explicit guards matter: Number(null) is 0, which would
        // otherwise max the accrued share instead of suppressing it.
        clockDay: liveClock ?? indexedClock,
        held: value > 0n,
        replay: provenanceMatches ? diceRunProvenance?.replay ?? null : null,
      };
    }),
  };
}

/** GET indexed history plus the chain-authoritative pool, clocks, and marks. */
export async function fetchRecords() {
  // The Dice Run reader is chained off this SAME promise (not a fresh call)
  // so `/records` is fetched exactly once even though its payload feeds both
  // the four-record normalize below and the diceRun key check.
  const payloadPromise = _fetchRecordsJSON('/records');
  const diceRunPromise = payloadPromise.then(
    (payload) => _readDiceRunRecord({ payload }),
    () => _readDiceRunRecord({ payload: null }),
  );
  const [payloadResult, poolResult, clocksResult, marksResult, diceRunResult] = await Promise.allSettled([
    payloadPromise,
    Promise.resolve().then(() => _readRecordPool()),
    Promise.resolve().then(() => _readRecordClocks()),
    Promise.resolve().then(() => _readRecordMarks()),
    diceRunPromise,
  ]);
  if (payloadResult.status === 'fulfilled') _lastRecordsPayload = payloadResult.value;
  return normalizeRecords(
    payloadResult.status === 'fulfilled' ? payloadResult.value : _lastRecordsPayload,
    poolResult.status === 'fulfilled' ? poolResult.value : null,
    clocksResult.status === 'fulfilled' ? clocksResult.value : null,
    marksResult.status === 'fulfilled' ? marksResult.value : null,
    diceRunResult.status === 'fulfilled' ? diceRunResult.value : null,
  );
}

/** Test-only readers for indexed history and authoritative chain state. */
export function __setRecordsReadersForTest({ json, pool, clocks, marks, diceRun } = {}) {
  if (typeof json === 'function') _fetchRecordsJSON = json;
  if (typeof pool === 'function') _readRecordPool = pool;
  if (typeof clocks === 'function') _readRecordClocks = clocks;
  else if (typeof json === 'function' || typeof pool === 'function'
      || typeof marks === 'function' || typeof diceRun === 'function') {
    // Existing reader-seam tests must never leak a public-RPC request.
    _readRecordClocks = async () => null;
  }
  if (typeof marks === 'function') _readRecordMarks = marks;
  else if (typeof json === 'function' || typeof pool === 'function'
      || typeof clocks === 'function' || typeof diceRun === 'function') {
    _readRecordMarks = async () => null;
  }
  if (typeof diceRun === 'function') _readDiceRunRecord = diceRun;
  else if (typeof json === 'function' || typeof pool === 'function'
      || typeof clocks === 'function' || typeof marks === 'function') {
    _readDiceRunRecord = async () => null;
  }
}

export function __resetRecordsReadersForTest() {
  _fetchRecordsJSON = fetchJSON;
  _readRecordPool = readLiveRecordPool;
  _readRecordClocks = readLiveRecordClocks;
  _readRecordMarks = readLiveRecordMarks;
  _readDiceRunRecord = readLiveDiceRunRecord;
  _poolReadInflight = null;
  _lastLiveRecordPool = null;
  _clockReadInflight = null;
  _lastLiveRecordClocks = null;
  _markReadInflight = null;
  _lastLiveRecordMarks = null;
  _diceRunReadInflight = null;
  _lastLiveDiceRunRecord = null;
  _diceRunLogWindow = null;
  _diceRunChainFallbackMemoUntil = 0;
  _diceRunChainFallbackRuns = 0;
  _lastRecordsPayload = null;
  try {
    if (typeof localStorage !== 'undefined') {
      const address = normalizedRecordAddress(CONTRACTS.COINFLIP);
      const deployBlock = Math.max(0, Number(CHAIN.deployBlock ?? 0));
      if (address) localStorage.removeItem(_diceRunLogCacheKey(address, deployBlock));
    }
  } catch (_e) { /* test shims without removeItem */ }
}

// Discord display identity now lives in ./profiles.js so components that do
// not touch the chain can use it too. Re-exported here for existing callers.
export { fetchProfiles } from './profiles.js';
