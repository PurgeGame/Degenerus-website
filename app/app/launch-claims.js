// Launch claim manifest. This controller keeps the persistent UI deliberately
// small: it detects deferred protocol work and publishes compact rows into
// Pending. Ordinary ETH/FLIP balances have dedicated controls in Protocol
// Coins and deliberately never become Pending items.

import { ethers, getProvider, TX_CONFIRMED_EVENT } from './contracts.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { displayToken } from './scaling.js';
import {
  claimAffiliateDgnrs,
  claimGoldenTicket,
} from './claims.js';
import {
  claimWwxrpDraw,
  readPlayerWwxrpDrawDays,
  readWwxrpDrawOutcome,
} from './wwxrp-draw.js';
import { clearPendingActions, publishPendingActions } from './pending-actions.js';
import { currentUnresolvedJackpotContext } from './jackpot-spoiler.js';
import { sharedReadProvider } from './read-provider.js';
import { queueReveal } from '../components/reveal-overlay.js';

const SOURCE = 'launch-claims';
const POLL_MS = 30_000;
const FAST_RETRY_MS = 1_500;
const FOIL_LOG_CHUNK_BLOCKS = 20_000;
const FOIL_LOG_MAX_CHUNKS = 12;
const FOIL_SCAN_VERSION = 1;

const GAME_CLAIM_READ_ABI = [
  'function claimAffiliateDgnrs(address player) external',
  'function claimGoldenTicket(address player, uint24 level) external',
  'error AlreadyClaimed()',
  'event AffiliateDgnrsClaimed(address indexed affiliate, uint24 indexed level, address indexed caller, uint256 score, uint256 amount)',
];
const AFFILIATE_READ_ABI = [
  'function affiliateScore(uint24 level, address player) view returns (uint256)',
  'function totalAffiliateScore(uint24 level) view returns (uint256)',
];
const LENS_READ_ABI = [
  'function levelDgnrsInfo(address game, uint24 level) view returns (uint128 allocation, uint128 claimed)',
];
const FOIL_EVENT_ABI = [
  'event FoilPackBought(address indexed buyer, uint24 indexed level, uint16 multBps, uint256 weiIn)',
];

let _running = false;
let _timer = null;
let _fastRetry = null;
let _getAddress = null;
let _getLevel = null;
let _refreshSeq = 0;
let _jackpotRevealListener = null;
let _txConfirmedListener = null;
let _contractFactory = null;
let _readProvider = null;
const _foilCache = new Map();
const _outcomeCache = new Map();
const _revealedReferralBonuses = new Set();
const _affiliateClaimInterface = new ethers.Interface(GAME_CLAIM_READ_ABI);

function _contract(address, abi, runner) {
  if (_contractFactory) return _contractFactory(address, abi, runner);
  return new ethers.Contract(address, abi, runner);
}

function _readerProvider() {
  if (!_readProvider) _readProvider = sharedReadProvider();
  return _readProvider || getProvider();
}

function _lower(value) {
  return value ? String(value).toLowerCase() : null;
}

function _fmtToken(raw) {
  try {
    const whole = displayToken(BigInt(raw || 0), 0);
    const numeric = Number(whole);
    return Number.isSafeInteger(numeric) ? numeric.toLocaleString('en-US') : whole;
  } catch (_e) { return '0'; }
}

function _referralRevealKey(player, level) {
  return [
    'degenerus:referral-bonus-revealed:v1',
    CHAIN.id,
    String(CONTRACTS.GAME || 'game').toLowerCase(),
    _lower(player),
    Number(level),
  ].join(':');
}

function _referralBonusWasRevealed(player, level) {
  const key = _referralRevealKey(player, level);
  if (_revealedReferralBonuses.has(key)) return true;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1') {
      _revealedReferralBonuses.add(key);
      return true;
    }
  } catch (_e) { /* memory tombstone remains available */ }
  return false;
}

function _markReferralBonusRevealed(player, level) {
  const key = _referralRevealKey(player, level);
  _revealedReferralBonuses.add(key);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, '1');
  } catch (_e) { /* memory tombstone remains available */ }
}

/** Whether an ethers/provider error says this one-per-level reward is settled. */
export function isAffiliateDgnrsAlreadyClaimed(error) {
  const selector = ethers.id('AlreadyClaimed()').slice(0, 10).toLowerCase();
  const queue = [error];
  const seen = new Set();
  for (let inspected = 0; queue.length > 0 && inspected < 48; inspected += 1) {
    const current = queue.shift();
    if (typeof current === 'string') {
      const value = current.toLowerCase();
      if (value.includes(selector) || /already[\s_-]*claimed/i.test(current)) return true;
      continue;
    }
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const value of [
      current.code,
      current.errorName,
      current.revert?.name,
      current.revert?.selector,
      current.data,
      current.reason,
      current.shortMessage,
      current.message,
    ]) {
      if (value != null) queue.push(value);
    }
    for (const nested of [current.cause, current.error, current.info?.error]) {
      if (nested != null) queue.push(nested);
    }
  }
  return false;
}

/** Decode this player's authoritative payout from a confirmed claim receipt. */
export function decodeAffiliateDgnrsClaim(logs, { player, level } = {}) {
  const address = _lower(player);
  const lvl = Number(level);
  if (!address || !Number.isInteger(lvl) || !Array.isArray(logs)) return null;
  let match = null;
  for (const log of logs) {
    try {
      const parsed = _affiliateClaimInterface.parseLog(log);
      if (parsed?.name !== 'AffiliateDgnrsClaimed') continue;
      const affiliate = _lower(parsed.args?.affiliate ?? parsed.args?.[0]);
      const eventLevel = Number(parsed.args?.level ?? parsed.args?.[1]);
      if (affiliate !== address || eventLevel !== lvl) continue;
      match = {
        player: affiliate,
        level: eventLevel,
        caller: _lower(parsed.args?.caller ?? parsed.args?.[2]),
        scoreWei: BigInt(parsed.args?.score ?? parsed.args?.[3] ?? 0),
        amountWei: BigInt(parsed.args?.amount ?? parsed.args?.[4] ?? 0),
        blockNumber: log?.blockNumber == null ? null : Number(log.blockNumber),
        transactionHash: log?.transactionHash == null
          ? null
          : String(log.transactionHash).toLowerCase(),
        logIndex: Number(log?.index ?? log?.logIndex ?? 0),
      };
    } catch (_e) { /* unrelated receipt log */ }
  }
  return match;
}

/** Fullscreen receipt for a settled current-level referral reward. */
export function referralBonusRevealSequence({ player, level, amountWei } = {}) {
  const address = _lower(player);
  const lvl = Number(level);
  let amount = 0n;
  try { amount = BigInt(amountWei ?? 0); } catch (_e) { amount = 0n; }
  if (!address || !Number.isInteger(lvl) || lvl <= 0 || amount <= 0n) return null;
  return {
    kind: 'referral-bonus',
    presentationId: `referral-bonus:${address}:${lvl}`,
    player: address,
    level: lvl,
    amountWei: amount,
  };
}

async function _mapLimit(values, limit, worker) {
  const rows = Array.isArray(values) ? values : [];
  const out = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      out[index] = await worker(rows[index], index);
    }
  }));
  return out;
}

function _foilCacheKey(player) {
  return [
    'degenerus:foil-claim-levels:v1',
    CHAIN.id,
    Number(CHAIN.deployBlock || 0),
    _lower(player),
  ].join(':');
}

function _readFoilCache(player) {
  const key = _foilCacheKey(player);
  if (_foilCache.has(key)) return _foilCache.get(key);
  let parsed = null;
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    parsed = raw ? JSON.parse(raw) : null;
  } catch (_e) { /* private mode */ }
  const value = parsed?.version === FOIL_SCAN_VERSION
    ? {
        version: FOIL_SCAN_VERSION,
        throughBlock: Number(parsed.throughBlock || 0),
        levels: [...new Set((Array.isArray(parsed.levels) ? parsed.levels : [])
          .map(Number).filter((level) => Number.isInteger(level) && level >= 0))],
      }
    : {
        version: FOIL_SCAN_VERSION,
        throughBlock: Number(CHAIN.deployBlock || 0) - 1,
        levels: [],
      };
  _foilCache.set(key, value);
  return value;
}

function _writeFoilCache(player, value) {
  const key = _foilCacheKey(player);
  _foilCache.set(key, value);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  }
  catch (_e) { /* memory cache remains */ }
}

async function _readPlayerFoilLevels(player) {
  const provider = _readerProvider();
  if (!provider || !player || !CONTRACTS.GAME) return { levels: [], complete: false };
  const cache = _readFoilCache(player);
  let head;
  try { head = Number(await provider.getBlockNumber()); }
  catch (_e) { return { levels: [...cache.levels], complete: false }; }
  let fromBlock = Math.max(Number(CHAIN.deployBlock || 0), Number(cache.throughBlock) + 1);
  if (fromBlock > head) return { levels: [...cache.levels], complete: true };
  let topics;
  const iface = new ethers.Interface(FOIL_EVENT_ABI);
  try { topics = iface.encodeFilterTopics(iface.getEvent('FoilPackBought'), [player, null]); }
  catch (_e) { return { levels: [...cache.levels], complete: false }; }
  const filter = { address: CONTRACTS.GAME, topics };
  let logs = [];
  let through = cache.throughBlock;
  try {
    logs = await provider.getLogs({ ...filter, fromBlock, toBlock: head });
    through = head;
  } catch (_wideError) {
    for (let chunk = 0; chunk < FOIL_LOG_MAX_CHUNKS && fromBlock <= head; chunk += 1) {
      const toBlock = Math.min(head, fromBlock + FOIL_LOG_CHUNK_BLOCKS - 1);
      try {
        const rows = await provider.getLogs({ ...filter, fromBlock, toBlock });
        if (Array.isArray(rows)) logs.push(...rows);
        through = toBlock;
        fromBlock = toBlock + 1;
      } catch (_chunkError) { break; }
    }
  }
  const levels = new Set(cache.levels);
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      const level = Number(parsed?.args?.level ?? parsed?.args?.[1]);
      if (Number.isInteger(level) && level >= 0) levels.add(level);
    } catch (_e) { /* malformed log */ }
  }
  const next = {
    version: FOIL_SCAN_VERSION,
    throughBlock: Number(through),
    levels: [...levels].sort((a, b) => a - b),
  };
  _writeFoilCache(player, next);
  return { levels: next.levels, complete: next.throughBlock >= head };
}

/** Current-level referral entitlement, optionally retaining its settled state. */
export async function readAffiliateLevelBonus({ player, level, includeClaimed = false } = {}) {
  const provider = _readerProvider();
  const lvl = Number(level);
  if (!provider || !player || !Number.isInteger(lvl) || lvl <= 0
    || !CONTRACTS.GAME || !CONTRACTS.AFFILIATE || !CONTRACTS.GAME_LENS) return null;
  try {
    const game = _contract(CONTRACTS.GAME, GAME_CLAIM_READ_ABI, provider);
    const affiliate = _contract(CONTRACTS.AFFILIATE, AFFILIATE_READ_ABI, provider);
    const lens = _contract(CONTRACTS.GAME_LENS, LENS_READ_ABI, provider);
    const [scoreValue, totalValue, info] = await Promise.all([
      affiliate.affiliateScore(lvl, player),
      affiliate.totalAffiliateScore(lvl),
      lens.levelDgnrsInfo(CONTRACTS.GAME, lvl),
    ]);
    const score = BigInt(scoreValue ?? 0);
    const total = BigInt(totalValue ?? 0);
    const allocation = BigInt(info?.allocation ?? info?.[0] ?? 0);
    if (score <= 0n || total <= 0n || allocation <= 0n) return null;
    const amountWei = (allocation * score) / total;
    if (amountWei <= 0n) return null;
    // The simulation is the authoritative eligibility/claimed check, including
    // the deity exemption and live pool availability. A settled bonus is still
    // useful to Pending until its reward presentation has been shown once.
    try {
      await game.claimAffiliateDgnrs.staticCall(player);
      return { level: lvl, scoreWei: score, amountWei, claimed: false };
    } catch (error) {
      return includeClaimed && isAffiliateDgnrsAlreadyClaimed(error)
        ? { level: lvl, scoreWei: score, amountWei, claimed: true }
        : null;
    }
  } catch (_e) {
    return null;
  }
}

/** Build the one Pending row shared by claimable and already-settled states. */
export function buildReferralBonusPendingAction({
  address,
  bonus,
  readBonus = readAffiliateLevelBonus,
  claimBonus = claimAffiliateDgnrs,
  reveal = queueReveal,
  refresh = refreshLaunchClaims,
  getAddress = null,
} = {}) {
  const player = _lower(address);
  const level = Number(bonus?.level);
  let fallbackAmount = 0n;
  try { fallbackAmount = BigInt(bonus?.amountWei ?? 0); } catch (_e) { fallbackAmount = 0n; }
  if (!player || !Number.isInteger(level) || level <= 0 || fallbackAmount <= 0n) return null;
  const alreadyClaimed = bonus?.claimed === true;

  const showReward = (amountWei) => {
    const sequence = referralBonusRevealSequence({ player, level, amountWei });
    if (!sequence) return false;
    reveal(sequence);
    _markReferralBonusRevealed(player, level);
    return true;
  };

  return {
    id: `referral-bonus:${player}:${level}`,
    dismissScope: player,
    dismissKey: `referral-bonus:${level}:${alreadyClaimed ? 'reward' : 'claim'}`,
    kind: 'affiliate-bonus',
    kindLabel: 'REFERRAL BONUS',
    label: `L${level} REFERRAL BONUS`,
    detail: '',
    shortLabel: alreadyClaimed ? 'View Referral Bonus' : 'Claim Referral Bonus',
    state: 'ready',
    order: 9,
    compact: true,
    write: !alreadyClaimed,
    autoOpen: false,
    run: async () => {
      if (typeof getAddress === 'function') {
        let current = null;
        try { current = _lower(getAddress()); } catch (_e) { current = null; }
        if (current !== player) {
          await refresh();
          return false;
        }
      }

      let latest = alreadyClaimed ? bonus : null;
      if (!alreadyClaimed) {
        try {
          latest = await readBonus({ player, level, includeClaimed: true });
        } catch (_e) { latest = null; }
      }

      if (latest?.claimed === true) {
        showReward(latest.amountWei ?? fallbackAmount);
        await refresh();
        return true;
      }

      let result;
      try {
        result = await claimBonus({ player });
      } catch (error) {
        // Settlement is permissionless. If a keeper won the click race, the
        // reward is already in this player's balance and should open normally.
        if (!isAffiliateDgnrsAlreadyClaimed(error)) throw error;
        showReward(latest?.amountWei ?? fallbackAmount);
        await refresh();
        return true;
      }

      const receiptClaim = decodeAffiliateDgnrsClaim(result?.receipt?.logs, { player, level });
      showReward(receiptClaim?.amountWei ?? latest?.amountWei ?? fallbackAmount);
      await refresh();
      return true;
    },
  };
}

async function _wwxrpItems(address, days) {
  const outcomes = await _mapLimit(days, 6, async (day) => {
    const key = Number(day);
    const cached = _outcomeCache.get(key);
    if (cached?.resolved && (!cached.won || cached.claimed)) return cached;
    const next = await readWwxrpDrawOutcome({ day: key });
    if (next?.resolved) _outcomeCache.set(key, next);
    return next;
  });
  const resolved = outcomes.filter((row) => row?.resolved).sort((a, b) => b.day - a.day);
  // Pending is an action surface, not draw history. A lost WWXRP draw had no
  // action and only produced a dead notification, so retain the player's wins
  // (especially every unclaimed one) and omit losses entirely.
  const playerWins = resolved.filter((row) => row.won && row.winner === address);
  const unclaimedWins = playerWins.filter((row) => !row.claimed);
  const recentWins = playerWins.slice(0, 3);
  const visible = [...new Map([...unclaimedWins, ...recentWins].map((row) => [row.day, row])).values()];
  return visible.map((row) => {
    const amount = _fmtToken(row.prizeWei);
    const claimable = !row.claimed;
    return {
      id: `wwxrp-draw:${address}:${row.day}`,
      dismissScope: address,
      dismissKey: `wwxrp-draw:${row.day}:${claimable ? 'claim' : 'won'}`,
      kind: 'wwxrp-draw',
      kindLabel: `DAY ${row.day}`,
      label: `D${row.day} WWXRP · WON ${amount} FLIP`,
      detail: '',
      shortLabel: claimable ? 'Claim' : 'Won',
      state: 'ready',
      order: 9,
      compact: true,
      passive: !claimable,
      write: claimable,
      autoOpen: false,
      run: claimable ? async () => {
        await claimWwxrpDraw({ day: row.day, entryIndex: row.entryIndex });
        _outcomeCache.delete(row.day);
        await refreshLaunchClaims();
        return true;
      } : null,
    };
  });
}

async function _goldenTicketItems(address, levels, currentLevel) {
  if (currentUnresolvedJackpotContext()) return [];
  const provider = _readerProvider();
  if (!provider || levels.length === 0) return [];
  const game = _contract(CONTRACTS.GAME, GAME_CLAIM_READ_ABI, provider);
  const candidates = levels.filter((level) => currentLevel == null || Number(level) <= Number(currentLevel));
  const checks = await _mapLimit(candidates, 4, async (level) => {
    try {
      await game.claimGoldenTicket.staticCall(address, Number(level));
      return Number(level);
    } catch (_e) { return null; }
  });
  return checks.filter((level) => level != null).map((level) => ({
    id: `golden-ticket:${address}:${level}`,
    dismissScope: address,
    // claimGoldenTicket covers the whole 3+ foil-gold ladder. A successful
    // simulation does not prove the pack contains an actual all-gold ticket.
    kind: 'foil-gold',
    kindLabel: 'FOIL GOLD',
    label: `L${level} FOIL GOLD`,
    detail: '',
    shortLabel: 'Claim',
    state: 'ready',
    order: 9,
    compact: true,
    write: true,
    autoOpen: false,
    run: async () => {
      await claimGoldenTicket({ player: address, level });
      await refreshLaunchClaims();
      return true;
    },
  }));
}

function _scheduleFastRetry() {
  if (!_running || _fastRetry != null || typeof setTimeout !== 'function') return;
  _fastRetry = setTimeout(() => {
    _fastRetry = null;
    void refreshLaunchClaims();
  }, FAST_RETRY_MS);
  try { _fastRetry?.unref?.(); } catch (_e) { /* browser timer */ }
}

export async function refreshLaunchClaims() {
  if (!_running) return;
  let address = null;
  let level = null;
  try { address = _lower(_getAddress?.()); } catch (_e) { address = null; }
  try { level = Number(_getLevel?.()); } catch (_e) { level = null; }
  if (!address) {
    _refreshSeq += 1;
    clearPendingActions(SOURCE);
    return;
  }
  const seq = ++_refreshSeq;
  const [affiliateResult, drawDaysResult, foilLevelsResult] = await Promise.allSettled([
    readAffiliateLevelBonus({ player: address, level, includeClaimed: true }),
    readPlayerWwxrpDrawDays({ player: address }),
    _readPlayerFoilLevels(address),
  ]);
  if (!_running || seq !== _refreshSeq) return;
  const items = [];

  const affiliateBonus = affiliateResult.status === 'fulfilled' ? affiliateResult.value : null;
  if (affiliateBonus
    && !currentUnresolvedJackpotContext()
    && !(affiliateBonus.claimed && _referralBonusWasRevealed(address, affiliateBonus.level))) {
    const action = buildReferralBonusPendingAction({
      address,
      bonus: affiliateBonus,
      getAddress: () => _getAddress?.(),
    });
    if (action) items.push(action);
  }

  const drawScan = drawDaysResult.status === 'fulfilled'
    ? drawDaysResult.value : { days: [], complete: false };
  items.push(...await _wwxrpItems(address, drawScan.days || []));
  if (!_running || seq !== _refreshSeq) return;
  const foilScan = foilLevelsResult.status === 'fulfilled'
    ? foilLevelsResult.value : { levels: [], complete: false };
  items.push(...await _goldenTicketItems(address, foilScan.levels || [], level));
  if (!_running || seq !== _refreshSeq) return;
  publishPendingActions(SOURCE, items);
  if (!drawScan.complete || !foilScan.complete) _scheduleFastRetry();
}

export function startLaunchClaims({ getAddress, getLevel } = {}) {
  if (_running) return;
  _running = true;
  _getAddress = typeof getAddress === 'function' ? getAddress : null;
  _getLevel = typeof getLevel === 'function' ? getLevel : null;
  if (typeof setInterval === 'function') {
    _timer = setInterval(refreshLaunchClaims, POLL_MS);
    try { _timer?.unref?.(); } catch (_e) { /* browser timer */ }
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    _jackpotRevealListener = () => { void refreshLaunchClaims(); };
    _txConfirmedListener = () => { void refreshLaunchClaims(); };
    document.addEventListener('jackpot:revealed', _jackpotRevealListener);
    document.addEventListener(TX_CONFIRMED_EVENT, _txConfirmedListener);
  }
  void refreshLaunchClaims();
}

export function stopLaunchClaims() {
  if (_timer != null) clearInterval(_timer);
  if (_fastRetry != null) clearTimeout(_fastRetry);
  if (_jackpotRevealListener && typeof document !== 'undefined') {
    document.removeEventListener?.('jackpot:revealed', _jackpotRevealListener);
  }
  if (_txConfirmedListener && typeof document !== 'undefined') {
    document.removeEventListener?.(TX_CONFIRMED_EVENT, _txConfirmedListener);
  }
  _timer = null;
  _fastRetry = null;
  _jackpotRevealListener = null;
  _txConfirmedListener = null;
  _running = false;
  _getAddress = null;
  _getLevel = null;
  _refreshSeq += 1;
  clearPendingActions(SOURCE);
}

export function __setLaunchClaimsContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
}

export function __resetLaunchClaimsForTest() {
  stopLaunchClaims();
  _contractFactory = null;
  _readProvider = null;
  _foilCache.clear();
  _outcomeCache.clear();
  _revealedReferralBonuses.clear();
}
