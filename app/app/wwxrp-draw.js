// Minimal WWXRP daily-draw support: discover days this player entered, reduce
// each resolved day to WIN/LOSS, and permissionlessly claim a winning entry.
// Detailed bucket/weight statistics intentionally stay out of the UI.

import { CHAIN, CONTRACTS } from './chain-config.js';
import { ethers, getProvider, sendTx } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { sharedReadProvider } from './read-provider.js';

const DRAW_ABI = [
  'event DrawEntered(uint24 indexed day, address indexed player, uint8 bucket, uint32 entryIndex, uint256 burnAmount, uint256 effectiveScore, uint256 cumulativeScore)',
  'function previewOutcome(uint24 day) view returns (bool wordAvailable, bool prize, bool big, uint8 winningBucket, uint256 roll, uint256 totalScore, bool claimed)',
  'function findWinningEntry(uint24 day) view returns (bool found, uint32 entryIndex, address player)',
  'function claim(uint24 day, uint32 entryIndex) external',
  'function BIG_PRIZE() view returns (uint256)',
  'function SMALL_PRIZE() view returns (uint256)',
];

const LOG_CHUNK_BLOCKS = 20_000;
const MAX_SCAN_CHUNKS = 12;
const CACHE_VERSION = 1;
const _memoryCache = new Map();
let _contractFactory = null;
let _readProvider = null;

function _readerProvider() {
  if (!_readProvider) _readProvider = sharedReadProvider();
  return _readProvider || getProvider();
}

function _contract(runner) {
  if (_contractFactory) return _contractFactory(runner);
  return new ethers.Contract(CONTRACTS.WWXRP, DRAW_ABI, runner);
}

function _cacheKey(player) {
  return [
    'degenerus:wwxrp-draw-days:v1',
    CHAIN.id,
    Number(CHAIN.deployBlock || 0),
    String(player).toLowerCase(),
  ].join(':');
}

function _readCache(player) {
  const key = _cacheKey(player);
  if (_memoryCache.has(key)) return _memoryCache.get(key);
  let parsed = null;
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    parsed = raw ? JSON.parse(raw) : null;
  } catch (_e) { /* private mode */ }
  const cache = parsed?.version === CACHE_VERSION
    ? {
        version: CACHE_VERSION,
        throughBlock: Math.max(Number(CHAIN.deployBlock || 0) - 1, Number(parsed.throughBlock || 0)),
        days: [...new Set((Array.isArray(parsed.days) ? parsed.days : [])
          .map(Number).filter((day) => Number.isInteger(day) && day >= 0))],
      }
    : { version: CACHE_VERSION, throughBlock: Number(CHAIN.deployBlock || 0) - 1, days: [] };
  _memoryCache.set(key, cache);
  return cache;
}

function _writeCache(player, cache) {
  const key = _cacheKey(player);
  _memoryCache.set(key, cache);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(cache));
  } catch (_e) { /* memory cache still works */ }
}

function _structured(error, fallback) {
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || fallback);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

/**
 * Discover every draw day owned by `player`. Scans are deployment-scoped and
 * cursor-cached; an RPC range limit falls back to bounded chunks and resumes
 * on the next refresh instead of silently skipping a range.
 */
export async function readPlayerWwxrpDrawDays({ player } = {}) {
  const provider = _readerProvider();
  if (!player || !provider || !CONTRACTS.WWXRP) return { days: [], complete: false };
  const cache = _readCache(player);
  let head;
  try { head = Number(await provider.getBlockNumber()); }
  catch (_e) { return { days: [...cache.days], complete: false }; }
  if (!Number.isInteger(head) || head < 0) return { days: [...cache.days], complete: false };
  let fromBlock = Math.max(Number(CHAIN.deployBlock || 0), Number(cache.throughBlock) + 1);
  if (fromBlock > head) return { days: [...cache.days].sort((a, b) => a - b), complete: true };

  let topics;
  try {
    const iface = new ethers.Interface(DRAW_ABI);
    topics = iface.encodeFilterTopics(iface.getEvent('DrawEntered'), [null, player]);
  } catch (_e) {
    return { days: [...cache.days], complete: false };
  }
  const filter = { address: CONTRACTS.WWXRP, topics };
  let logs = [];
  let through = cache.throughBlock;
  try {
    logs = await provider.getLogs({ ...filter, fromBlock, toBlock: head });
    through = head;
  } catch (_wideError) {
    for (let chunk = 0; chunk < MAX_SCAN_CHUNKS && fromBlock <= head; chunk += 1) {
      const toBlock = Math.min(head, fromBlock + LOG_CHUNK_BLOCKS - 1);
      try {
        const rows = await provider.getLogs({ ...filter, fromBlock, toBlock });
        if (Array.isArray(rows)) logs.push(...rows);
        through = toBlock;
        fromBlock = toBlock + 1;
      } catch (_chunkError) {
        break;
      }
    }
  }

  const iface = new ethers.Interface(DRAW_ABI);
  const days = new Set(cache.days);
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      const day = Number(parsed?.args?.day ?? parsed?.args?.[0]);
      if (Number.isInteger(day) && day >= 0) days.add(day);
    } catch (_e) { /* unrelated/malformed log */ }
  }
  const next = {
    version: CACHE_VERSION,
    throughBlock: Number(through),
    days: [...days].sort((a, b) => a - b),
  };
  _writeCache(player, next);
  return { days: next.days, complete: next.throughBlock >= head };
}

/** Reduce one immutable day to the only UI facts we need. */
export async function readWwxrpDrawOutcome({ day } = {}) {
  const provider = _readerProvider();
  const drawDay = Number(day);
  if (!provider || !Number.isInteger(drawDay) || drawDay < 0) return null;
  try {
    const contract = _contract(provider);
    const preview = await contract.previewOutcome(drawDay);
    const wordAvailable = Boolean(preview?.wordAvailable ?? preview?.[0]);
    if (!wordAvailable) return { day: drawDay, resolved: false };
    const prize = Boolean(preview?.prize ?? preview?.[1]);
    const big = Boolean(preview?.big ?? preview?.[2]);
    const claimed = Boolean(preview?.claimed ?? preview?.[6]);
    if (!prize) {
      return { day: drawDay, resolved: true, won: false, claimed, big: false };
    }
    const foundRow = await contract.findWinningEntry(drawDay);
    const found = Boolean(foundRow?.found ?? foundRow?.[0]);
    if (!found) return { day: drawDay, resolved: true, won: false, claimed, big };
    const entryIndex = Number(foundRow?.entryIndex ?? foundRow?.[1]);
    const winner = String(foundRow?.player ?? foundRow?.[2] ?? '').toLowerCase();
    let prizeWei = 0n;
    try { prizeWei = BigInt(big ? await contract.BIG_PRIZE() : await contract.SMALL_PRIZE()); }
    catch (_e) { prizeWei = (big ? 100_000n : 10_000n) * (10n ** 18n); }
    return {
      day: drawDay,
      resolved: true,
      won: true,
      claimed,
      big,
      winner,
      entryIndex,
      prizeWei,
    };
  } catch (_e) {
    return null;
  }
}

export async function claimWwxrpDraw({ day, entryIndex } = {}) {
  const drawDay = Number(day);
  const index = Number(entryIndex);
  if (!Number.isInteger(drawDay) || drawDay < 0 || !Number.isInteger(index) || index < 0) {
    throw new Error('Invalid WWXRP draw claim.');
  }
  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _contract(signer);
    const sim = await requireStaticCall(contract, 'claim', [drawDay, index], signer);
    if (!sim.ok) throw _structured(sim.error, 'WWXRP draw is not claimable.');
  }
  const receipt = await sendTx(
    (s) => _contract(s).claim(drawDay, index),
    `Claim WWXRP draw day ${drawDay}`,
  );
  return { receipt, day: drawDay, entryIndex: index };
}

export function __setWwxrpDrawContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
}

export function __resetWwxrpDrawForTest() {
  _contractFactory = null;
  _readProvider = null;
  _memoryCache.clear();
}
