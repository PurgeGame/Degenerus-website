// /app/app/coinflip.js — Phase 62 Plan 62-03 (BUY-04 write path).
//
// Synchronous FLIP deposit helper for Coinflip.depositCoinflip. Mirrors
// Phase 60 lootbox.js + Phase 61 claims.js + Phase 62-02 passes.js shape.
//
// On-chain surface (verified against degenerus-audit/contracts/Coinflip.sol):
//   - BUY-04: Coinflip.sol:229 — depositCoinflip(address player, uint256 amount)
//   - Event:  Coinflip.sol:46  — CoinflipDeposit(address indexed player, uint256 creditedFlip)
//
// RESEARCH R3 (HIGH confidence) invalidated CONTEXT D-01 step 1's conflation of
// BUY-04 with the degenerette BetPlaced/BetResolved pattern:
//   - depositCoinflip is a SYNCHRONOUS FLIP deposit (no per-bet RNG cycle).
//   - Emits ONLY CoinflipDeposit. Outcome resolves daily via global
//     CoinflipDayResolved (NOT per-bet).
//   - The panel's UX is "deposit confirmed; outcome reveals at end of day."
//
// RESEARCH Q5 — FLIP/DGNRS/tickets are UNSCALED on Sepolia (only ETH is /1M).
// Min coinflip deposit = 100 FLIP = 100n * 10n**18n wei
// (Coinflip.sol:124 enforces this on-chain via AmountLTMin revert).
//
// Plan 62-03 registers TWO NEW reason-map codes:
//   - AmountLTMin    (Coinflip.sol:101) — amount below 100 FLIP.
//   - CoinflipLocked (Coinflip.sol:102) — locked during BAF jackpot resolution.
// NotApproved is already registered by Phase 60 (RESEARCH R11) — DO NOT re-register.
//
// Inline ABI fragments — DO NOT cross-import /beta/app/constants.js (Pitfall 4).
//
// MANDATORY closure form for every sendTx call (Phase 58 verified by grep gate):
//   CORRECT:   sendTx( (s) => new Contract(addr, ABI, s).method(args), 'Action' )
//   FORBIDDEN: passing a pre-resolved tx promise — captures stale signer.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { getActingAddress } from './store.js';

// ---------------------------------------------------------------------------
// Inline ABI fragments — canonical signatures verified against
// degenerus-audit/contracts/Coinflip.sol:46 + :229.
// ---------------------------------------------------------------------------

const COINFLIP_ABI = [
  // Coinflip.sol:229 — depositCoinflip(player, amount)
  'function depositCoinflip(address player, uint256 amount) external',
  // Coinflip.sol:1195 — claimable coinflip FLIP (settled + this day's mintable).
  'function previewClaimCoinflips(address player) external view returns (uint256 mintable)',
  // Coinflip.sol:1238 — the live stake for the upcoming/current flip day.
  'function coinflipAmount(address player) external view returns (uint256)',
  // Auto-rebuy carry is an implicit part of the next effective stake. It is
  // deliberately not copied into the day-keyed coinflipAmount storage slot.
  'function coinflipAutoRebuyInfo(address player) external view returns (bool enabled, uint256 stop, uint256 carry, uint24 startDay)',
  // Packed three-state result: 0 unresolved, 1 resolved loss, 50..156 win.
  'function getCoinflipDayResult(uint24 day) external view returns (uint16 rewardPercent, bool win)',
  // Coinflip.sol:46 — CoinflipDeposit emitted on every deposit (CF-05).
  'event CoinflipDeposit(address indexed player, uint256 creditedFlip)',
  // Exact-day cumulative STORED credit. Auto-rebuy carry is added lazily while
  // resolving and therefore never appears in newTotal.
  'event CoinflipStakeUpdated(address indexed player, uint24 indexed day, uint256 amount, uint256 newTotal)',
  'event CoinflipDayResolved(uint24 indexed day, bool win, uint16 rewardPercent, uint128 bountyAfter, uint128 bountyPaid, address bountyRecipient)',
  'event CoinflipClaimState(address indexed player, uint128 claimableStored, uint128 autoRebuyCarry, uint24 lastClaim)',
];

// reverseFlip is a GAME action, despite living beside the coinflip UX. It
// burns the caller's FLIP to add one to the next unresolved daily RNG word.
//
// TWO deploy generations are supported (feature-detected at quote time, see
// readReverseFlipQuote):
//   legacy (run22)  — reverseFlip() takes no argument; there is no public
//                     price getter, so the UI reads the queued count from the
//                     stable storage slot and mirrors _currentNudgeCost.
//   current (run23+) — reverseFlip(uint256 expectedCost) guards against a
//                     price race (NudgeCostChanged), and rngNudgeQuote()
//                     returns the exact queued count + whole-FLIP price.
// One ABI per generation (never both overloads in one interface — ethers v6
// rejects the ambiguous bare name, and the bare name is what keeps the
// contract-factory test seams working).
const REVERSE_FLIP_ABI = [
  'function reverseFlip() external',
  'function rngLocked() external view returns (bool)',
  'event ReverseFlip(address indexed caller, uint256 totalQueued, uint256 cost)',
  'error RngLocked()',
  'error E()',
];
const REVERSE_FLIP_ABI_V2 = [
  'function reverseFlip(uint256 expectedCost) external',
  'function rngNudgeQuote() external view returns (uint256 queued, uint256 cost)',
  'function rngLocked() external view returns (bool)',
  'event ReverseFlip(address indexed caller, uint256 totalQueued, uint256 cost)',
  'error RngLocked()',
  'error E()',
  'error NudgeCostChanged()',
];

// DegenerusGameStorage.totalFlipReversals is an internal uint64 at slot 5,
// offset 0. There is no public price/count getter on the deployed GAME, so the
// UI reads that stable storage-layout slot and mirrors _currentNudgeCost.
// The co-resident lastVrfProcessedTimestamp begins at byte 8; masking the low
// 64 bits prevents it from contaminating the queued count.
const REVERSE_FLIP_STORAGE_SLOT = 5n;
const UINT64_MASK = (1n << 64n) - 1n;
export const REVERSE_FLIP_BASE_COST_WEI = 100n * 10n ** 18n;

const GAME_DAY_READ_ABI = ['function currentDayView() external view returns (uint24)'];
const ERC20_BALANCE_ABI = ['function balanceOf(address owner) external view returns (uint256)'];

let _currentStakeReader = null;
let _resolvedStakeReader = null;
let _claimableReader = null;
let _latestResultReader = null;
let _widgetBalancesReader = null;
let _reverseFlipQuoteReader = null;
let _stakeReadContractFactory = null;
// null = unprobed; true = deploy has rngNudgeQuote() (run23+ signature);
// false = legacy deploy (storage-slot quote + no-arg reverseFlip). Probed once
// per session by readReverseFlipQuote and consumed by reverseFlip()'s selector
// choice.
let _nudgeQuoteViaView = null;
let _publicReadProvider = null;
const _resolvedStakeCache = new Map();
const _currentStakeInflight = new Map();
const _resolvedStakeInflight = new Map();
const _claimableInflight = new Map();
const _widgetBalancesInflight = new Map();
let _latestResultInflight = null;
let _reverseFlipQuoteInflight = null;
const LOG_CHUNK_BLOCKS = 1_800;
// v1 persisted only CoinflipStakeUpdated.newTotal and therefore permanently
// under-reported any day resolved with auto-rebuy carry (most visibly sDGNRS).
const RESOLVED_STAKE_STORAGE_PREFIX = 'coinflip_resolved_stake_v2';

/** Test-only: replace the live current-day stake read. */
export function __setCurrentStakeReaderForTest(fn) {
  _currentStakeReader = typeof fn === 'function' ? fn : null;
  _currentStakeInflight.clear();
}

/** Test-only: replace the read contract used by live/historical stake reads. */
export function __setStakeReadContractFactoryForTest(fn) {
  _stakeReadContractFactory = typeof fn === 'function' ? fn : null;
  _currentStakeInflight.clear();
  _resolvedStakeCache.clear();
  _resolvedStakeInflight.clear();
}

/** Test-only: replace the exact resolved-day cumulative stake read. */
export function __setResolvedStakeReaderForTest(fn) {
  _resolvedStakeReader = typeof fn === 'function' ? fn : null;
  _resolvedStakeCache.clear();
  _resolvedStakeInflight.clear();
}

/** Test-only: replace the live previewClaimCoinflips read. */
export function __setClaimableReaderForTest(fn) {
  _claimableReader = typeof fn === 'function' ? fn : null;
  _claimableInflight.clear();
}

/** Test-only: replace the live current-day/result pair read. */
export function __setLatestResultReaderForTest(fn) {
  _latestResultReader = typeof fn === 'function' ? fn : null;
  _latestResultInflight = null;
}

/** Test-only: replace the live token balances used by the FLIP widget. */
export function __setWidgetBalancesReaderForTest(fn) {
  _widgetBalancesReader = typeof fn === 'function' ? fn : null;
  _widgetBalancesInflight.clear();
}

/** Test-only: replace the live reverseFlip storage/lock read. */
export function __setReverseFlipQuoteReaderForTest(fn) {
  _reverseFlipQuoteReader = typeof fn === 'function' ? fn : null;
  _reverseFlipQuoteInflight = null;
  _nudgeQuoteViaView = null;
}

/** Test-only: restore the production current-day stake reader. */
export function __resetCurrentStakeReaderForTest() {
  _currentStakeReader = null;
  _currentStakeInflight.clear();
  _publicReadProvider = null;
}

/** Test-only: restore the production stake-read contract. */
export function __resetStakeReadContractFactoryForTest() {
  _stakeReadContractFactory = null;
  _currentStakeInflight.clear();
  _resolvedStakeCache.clear();
  _resolvedStakeInflight.clear();
}

/** Test-only: restore the production resolved-day reader and immutable cache. */
export function __resetResolvedStakeReaderForTest() {
  _resolvedStakeReader = null;
  _resolvedStakeCache.clear();
  _resolvedStakeInflight.clear();
  _publicReadProvider = null;
}

/** Test-only: restore the production claimable reader. */
export function __resetClaimableReaderForTest() {
  _claimableReader = null;
  _claimableInflight.clear();
  _publicReadProvider = null;
}

/** Test-only: restore the production current-day/result reader. */
export function __resetLatestResultReaderForTest() {
  _latestResultReader = null;
  _latestResultInflight = null;
  _publicReadProvider = null;
}

/** Test-only: restore the production FLIP-widget balance reader. */
export function __resetWidgetBalancesReaderForTest() {
  _widgetBalancesReader = null;
  _widgetBalancesInflight.clear();
  _publicReadProvider = null;
}

/** Test-only: restore the production reverseFlip quote reader. */
export function __resetReverseFlipQuoteReaderForTest() {
  _reverseFlipQuoteReader = null;
  _reverseFlipQuoteInflight = null;
  _publicReadProvider = null;
  _nudgeQuoteViaView = null;
}

function _readerProvider() {
  const wallet = getProvider();
  if (wallet) return wallet;
  if (!_publicReadProvider && CHAIN.rpcUrl) {
    // Pin the already-known network and disable batching. Public RPCs commonly
    // rate-limit the extra detection/batch burst that otherwise happens while
    // the rest of the app is mounting.
    _publicReadProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 1 },
    );
  }
  return _publicReadProvider;
}

function _stakeReadContract(provider) {
  return _stakeReadContractFactory
    ? _stakeReadContractFactory(provider)
    : new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, provider);
}

function _normalizeLatestResult(value) {
  if (!value) return null;
  const day = Number(value.day);
  const rewardPercent = Number(value.rewardPercent ?? value.encodedRewardPercent ?? 0);
  if (!Number.isInteger(day) || day <= 0 || !Number.isFinite(rewardPercent)) return null;
  const resolved = value.resolved == null ? rewardPercent > 0 : Boolean(value.resolved);
  if (!resolved) return null;
  return {
    day,
    win: Boolean(value.win),
    // A loss is stored as the non-zero sentinel `1`; it has no payout modifier.
    rewardPercent: Boolean(value.win) ? Math.max(0, Math.trunc(rewardPercent)) : 0,
    resolved: true,
    source: 'chain',
  };
}

/**
 * Read the newest resolved daily FLIP result from this exact deployment.
 *
 * The hosted indexer can retain day-number rows from an older redeploy. GAME's
 * currentDayView plus Coinflip's packed result are deployment-local, so this is
 * the authoritative clock/result pair for the widget. If today's lane is still
 * unresolved, the immediately preceding day is checked.
 */
export async function readLatestCoinflipResult() {
  if (_latestResultInflight) return _latestResultInflight;
  const request = (async () => {
    try {
      if (_latestResultReader) return _normalizeLatestResult(await _latestResultReader());
      const provider = _readerProvider();
      if (!provider || !CONTRACTS.GAME || !CONTRACTS.COINFLIP) return null;
      const game = new ethers.Contract(CONTRACTS.GAME, GAME_DAY_READ_ABI, provider);
      const coinflip = new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, provider);
      let overrides = [];
      if (typeof provider.getBlockNumber === 'function') {
        try { overrides = [{ blockTag: await provider.getBlockNumber() }]; }
        catch (_e) { /* unpinned best effort */ }
      }
      const currentDay = Number(await game.currentDayView(...overrides));
      if (!Number.isInteger(currentDay) || currentDay <= 0) return null;
      for (const day of [currentDay, currentDay - 1]) {
        if (day <= 0) continue;
        const result = await coinflip.getCoinflipDayResult(day, ...overrides);
        const encoded = Number(result?.rewardPercent ?? result?.[0] ?? 0);
        if (encoded <= 0) continue;
        return _normalizeLatestResult({
          day,
          encodedRewardPercent: encoded,
          win: Boolean(result?.win ?? result?.[1]),
          resolved: true,
        });
      }
      return null;
    } catch (_e) {
      return null;
    }
  })();
  _latestResultInflight = request;
  try {
    return await request;
  } finally {
    if (_latestResultInflight === request) _latestResultInflight = null;
  }
}

function _fulfilledBigInt(result) {
  if (result?.status !== 'fulfilled') return null;
  try { return BigInt(result.value); }
  catch (_e) { return null; }
}

/** Direct, same-deployment balances rendered inside the FLIP widget. */
export async function readFlipWidgetBalances({ player } = {}) {
  const target = player || getActingAddress();
  if (!target) return null;
  const key = `${CHAIN.id}:${String(target).toLowerCase()}`;
  if (_widgetBalancesInflight.has(key)) return _widgetBalancesInflight.get(key);
  const request = (async () => {
    try {
      if (_widgetBalancesReader) {
        const value = await _widgetBalancesReader({ player: target });
        if (!value) return null;
        return {
          flipBalance: value.flipBalance == null ? null : BigInt(value.flipBalance),
          wwxrpBalance: value.wwxrpBalance == null ? null : BigInt(value.wwxrpBalance),
          sdgnrsBalance: value.sdgnrsBalance == null ? null : BigInt(value.sdgnrsBalance),
        };
      }
      const provider = _readerProvider();
      if (!provider) return null;
      let overrides = [];
      if (typeof provider.getBlockNumber === 'function') {
        try { overrides = [{ blockTag: await provider.getBlockNumber() }]; }
        catch (_e) { /* unpinned best effort */ }
      }
      const flip = new ethers.Contract(CONTRACTS.COIN, ERC20_BALANCE_ABI, provider);
      const wwxrp = new ethers.Contract(CONTRACTS.WWXRP, ERC20_BALANCE_ABI, provider);
      const sdgnrs = new ethers.Contract(CONTRACTS.SDGNRS, ERC20_BALANCE_ABI, provider);
      const [flipResult, wwxrpResult, sdgnrsResult] = await Promise.allSettled([
        flip.balanceOf(target, ...overrides),
        wwxrp.balanceOf(target, ...overrides),
        sdgnrs.balanceOf(target, ...overrides),
      ]);
      const balances = {
        flipBalance: _fulfilledBigInt(flipResult),
        wwxrpBalance: _fulfilledBigInt(wwxrpResult),
        sdgnrsBalance: _fulfilledBigInt(sdgnrsResult),
      };
      return Object.values(balances).some((value) => value != null) ? balances : null;
    } catch (_e) {
      return null;
    }
  })();
  _widgetBalancesInflight.set(key, request);
  try {
    return await request;
  } finally {
    if (_widgetBalancesInflight.get(key) === request) _widgetBalancesInflight.delete(key);
  }
}

/**
 * The amount a daily flip actually resolves against. Auto-rebuy carry remains
 * in PlayerCoinflipState and is folded into the day-keyed stored stake only in
 * _claimCoinflipsInternal, so coinflipAmount/newTotal alone are not the bet.
 */
export function effectiveCoinflipStake(storedStake, autoRebuyInfo = null) {
  let stored;
  try { stored = BigInt(storedStake ?? 0); }
  catch (_e) { return 0n; }
  const enabled = Boolean(autoRebuyInfo?.enabled ?? autoRebuyInfo?.[0]);
  if (!enabled) return stored;
  try {
    const carry = BigInt(autoRebuyInfo?.carry ?? autoRebuyInfo?.[2] ?? 0);
    return stored + carry;
  } catch (_e) {
    return stored;
  }
}

/**
 * Mirror DegenerusGame._currentNudgeCost exactly: 100 FLIP, then +50% for
 * every nudge already queued. Integer division happens on every iteration.
 *
 * @param {bigint|string|number} queued
 * @returns {bigint}
 */
export function reverseFlipCostWei(queued = 0n) {
  let count;
  try {
    count = BigInt(queued);
  } catch (_e) {
    throw new Error('Queued reverse-flip count must be numeric.');
  }
  if (count < 0n) throw new Error('Queued reverse-flip count cannot be negative.');
  // A legitimate queue cannot approach this bound economically. The guard
  // prevents a corrupt/mismatched storage layout from pinning the UI in a loop.
  if (count > 1_024n) throw new Error('Queued reverse-flip count is out of range.');
  let cost = REVERSE_FLIP_BASE_COST_WEI;
  while (count > 0n) {
    cost = (cost * 15n) / 10n;
    count -= 1n;
  }
  return cost;
}

/**
 * Read the live reverseFlip quote.
 *
 * Feature-detects the deploy generation on first use: run23+ contracts expose
 * `rngNudgeQuote()` (authoritative queued count + whole-FLIP price, used with
 * the price-guarded `reverseFlip(uint256)`); legacy deploys fall back to the
 * storage-slot read + the local `_currentNudgeCost` mirror.
 *
 * @returns {Promise<{queued: bigint, costWei: bigint, locked: boolean, viaView: boolean}|null>}
 * null means the RPC/storage read is unavailable.
 */
export async function readReverseFlipQuote() {
  if (_reverseFlipQuoteInflight) return _reverseFlipQuoteInflight;
  const request = (async () => {
    try {
      if (_reverseFlipQuoteReader) {
        const value = await _reverseFlipQuoteReader();
        if (value == null) return null;
        const queued = BigInt(value.queued ?? 0);
        // Test/injection hook: a reader may declare which deploy generation it
        // is simulating so reverseFlip() picks the matching selector.
        if (value.viaView !== undefined) _nudgeQuoteViaView = Boolean(value.viaView);
        return {
          queued,
          costWei: value.costWei == null
            ? reverseFlipCostWei(queued)
            : BigInt(value.costWei),
          locked: Boolean(value.locked),
        };
      }
      const provider = _readerProvider();
      if (!provider || !CONTRACTS.GAME) return null;
      const game = new ethers.Contract(CONTRACTS.GAME, REVERSE_FLIP_ABI_V2, provider);
      if (_nudgeQuoteViaView !== false) {
        try {
          const [[queued, cost], locked] = await Promise.all([
            game.rngNudgeQuote(),
            game.rngLocked(),
          ]);
          _nudgeQuoteViaView = true;
          return {
            queued: BigInt(queued),
            costWei: BigInt(cost),
            locked: Boolean(locked),
          };
        } catch (probeErr) {
          // Latch 'legacy' ONLY on a decode-level failure (selector absent →
          // empty return data). A transient network error leaves the probe
          // unlatched so a new deploy can't get pinned onto the legacy path —
          // this attempt still serves the legacy read below as a best effort.
          if (probeErr?.code === 'BAD_DATA' || probeErr?.code === 'CALL_EXCEPTION') {
            _nudgeQuoteViaView = false;
          }
        }
      }
      const [packedSlot, locked] = await Promise.all([
        provider.getStorage(CONTRACTS.GAME, REVERSE_FLIP_STORAGE_SLOT),
        game.rngLocked(),
      ]);
      const queued = BigInt(packedSlot) & UINT64_MASK;
      return {
        queued,
        costWei: reverseFlipCostWei(queued),
        locked: Boolean(locked),
      };
    } catch (_e) {
      return null;
    }
  })();
  _reverseFlipQuoteInflight = request;
  try {
    return await request;
  } finally {
    if (_reverseFlipQuoteInflight === request) _reverseFlipQuoteInflight = null;
  }
}

function _loadPersistedResolvedStake(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${RESOLVED_STAKE_STORAGE_PREFIX}:${key}`);
    if (raw == null) return null;
    const value = BigInt(raw);
    return value >= 0n ? value : null;
  } catch (_e) {
    return null;
  }
}

function _persistResolvedStake(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${RESOLVED_STAKE_STORAGE_PREFIX}:${key}`, String(value));
    }
  } catch (_e) { /* private browsing / quota */ }
}

async function _latestLog(contract, filter, lowerBlock, upperBlock) {
  for (let to = upperBlock; to >= lowerBlock;) {
    const from = Math.max(lowerBlock, to - LOG_CHUNK_BLOCKS + 1);
    const logs = await contract.queryFilter(filter, from, to);
    if (logs.length > 0) return logs[logs.length - 1];
    to = from - 1;
  }
  return null;
}

function _logIndex(log) {
  return Number(log?.index ?? log?.logIndex ?? -1);
}

/** Latest matching event strictly before another event in chain log order. */
async function _latestLogBefore(contract, filter, lowerBlock, boundary) {
  const boundaryBlock = Number(boundary?.blockNumber);
  if (!Number.isInteger(boundaryBlock) || boundaryBlock < lowerBlock) return null;

  const sameBlock = await contract.queryFilter(filter, boundaryBlock, boundaryBlock);
  const boundaryIndex = _logIndex(boundary);
  const earlier = sameBlock.filter((log) => _logIndex(log) < boundaryIndex);
  if (earlier.length > 0) return earlier[earlier.length - 1];
  if (boundaryBlock === lowerBlock) return null;
  return _latestLog(contract, filter, lowerBlock, boundaryBlock - 1);
}

/**
 * Read the player's effective live stake for the upcoming flip day.
 *
 * The dashboard's `depositedAmount` is the latest indexed daily stake. The
 * resolved day's stake is intentionally retained in that history, so after a
 * resolution it cannot reliably answer "what is my bet now?" The contract's
 * `coinflipAmount(player)` view is explicitly scoped to the current target day,
 * but contains only stored credits. When auto-rebuy is enabled, its carry is
 * folded into that stake lazily at resolution and must be added here.
 *
 * @param {{player?: string}} [args]
 * @returns {Promise<bigint|null>} null when the read is unavailable
 */
export async function readCurrentCoinflipStake({ player } = {}) {
  const target = player || getActingAddress();
  if (!target) return null;
  const key = `${CHAIN.id}:${String(target).toLowerCase()}`;
  if (_currentStakeInflight.has(key)) return _currentStakeInflight.get(key);

  const request = (async () => {
    try {
      if (_currentStakeReader) {
        const value = await _currentStakeReader({ player: target });
        return value == null ? null : BigInt(value);
      }
      const provider = _readerProvider();
      if (!provider) return null;
      const coinflip = _stakeReadContract(provider);
      // Both storage legs change during resolution. Pin them to one block so a
      // rollover cannot combine a pre-resolution value with a post-resolution
      // value and briefly double-count (or omit) the carry.
      let readOverrides = [];
      if (typeof provider.getBlockNumber === 'function') {
        try { readOverrides = [{ blockTag: await provider.getBlockNumber() }]; }
        catch (_e) { /* an unpinned best-effort read is still useful */ }
      }
      const [storedResult, rebuyResult] = await Promise.allSettled([
        coinflip.coinflipAmount(target, ...readOverrides),
        coinflip.coinflipAutoRebuyInfo(target, ...readOverrides),
      ]);
      if (storedResult.status !== 'fulfilled') return null;
      return effectiveCoinflipStake(
        storedResult.value,
        rebuyResult.status === 'fulfilled' ? rebuyResult.value : null,
      );
    } catch (_e) {
      return null;
    }
  })();
  _currentStakeInflight.set(key, request);
  try {
    return await request;
  } finally {
    if (_currentStakeInflight.get(key) === request) _currentStakeInflight.delete(key);
  }
}

/**
 * Read the exact currently claimable FLIP directly from Coinflip.
 *
 * The player dashboard is indexed and may still contain the pre-resolution
 * value when the reveal animation lands. `previewClaimCoinflips` includes all
 * settled/mintable coinflip winnings at the chain head, so the reveal can
 * unmask the real total without waiting for the indexer's next cycle.
 *
 * @param {{player?: string}} [args]
 * @returns {Promise<bigint|null>} null when the read is unavailable
 */
export async function readClaimableCoinflip({ player } = {}) {
  const target = player || getActingAddress();
  if (!target) return null;
  const key = `${CHAIN.id}:${String(target).toLowerCase()}`;
  if (_claimableInflight.has(key)) return _claimableInflight.get(key);

  const request = (async () => {
    try {
      if (_claimableReader) {
        const value = await _claimableReader({ player: target });
        return value == null ? null : BigInt(value);
      }
      const provider = _readerProvider();
      if (!provider || !CONTRACTS.COINFLIP) return null;
      const coinflip = new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, provider);
      return BigInt(await coinflip.previewClaimCoinflips(target));
    } catch (_e) {
      return null;
    }
  })();
  _claimableInflight.set(key, request);
  try {
    return await request;
  } finally {
    if (_claimableInflight.get(key) === request) _claimableInflight.delete(key);
  }
}

/**
 * Read the cumulative stake for one completed flip day.
 *
 * `CoinflipStakeUpdated.newTotal` is authoritative for the stored-credit leg.
 * If auto-rebuy was active, the latest CoinflipClaimState before the resolution
 * supplies the carry leg that the contract added lazily. Together they avoid
 * both misleading alternatives exposed by the general dashboard:
 * `depositedAmount` is merely the newest day, while `coinflipAmount()` is the
 * still-unresolved next day. The final exact-day event is immutable, so reads
 * are cached by player/day.
 *
 * @param {{player?: string, day: number|string|bigint}} args
 * @returns {Promise<bigint|null>} 0 for a resolved day with no stake; null when unreadable
 */
export async function readResolvedCoinflipStake({ player, day } = {}) {
  const target = player || getActingAddress();
  const dayNumber = Number(day);
  if (!target || !Number.isInteger(dayNumber) || dayNumber < 0) return null;
  const key = `${CHAIN.id}:${String(target).toLowerCase()}:${dayNumber}`;
  if (_resolvedStakeCache.has(key)) return _resolvedStakeCache.get(key);
  if (!_resolvedStakeReader) {
    const persisted = _loadPersistedResolvedStake(key);
    if (persisted != null) {
      _resolvedStakeCache.set(key, persisted);
      return persisted;
    }
  }
  if (_resolvedStakeInflight.has(key)) return _resolvedStakeInflight.get(key);

  const request = (async () => {
    try {
      if (_resolvedStakeReader) {
        const value = await _resolvedStakeReader({ player: target, day: dayNumber });
        return value == null ? null : BigInt(value);
      }

      const provider = _readerProvider();
      if (!provider || !CONTRACTS.COINFLIP) return null;
      const contract = _stakeReadContract(provider);
      const head = Number(await provider.getBlockNumber());
      const deployBlock = Math.max(0, Number(CHAIN.deployBlock || 0));
      const resolved = await _latestLog(
        contract,
        contract.filters.CoinflipDayResolved(dayNumber),
        deployBlock,
        head,
      );
      if (!resolved) return null;

      // Credits for day N accumulate around the preceding day. Use the previous
      // resolution to bound that window, plus one full observed day-span of
      // headroom for credits that land shortly before its resolution.
      const previous = dayNumber > 0
        ? await _latestLog(
            contract,
            contract.filters.CoinflipDayResolved(dayNumber - 1),
            deployBlock,
            Number(resolved.blockNumber),
          )
        : null;
      const resolvedBlock = Number(resolved.blockNumber);
      const previousBlock = previous ? Number(previous.blockNumber) : resolvedBlock;
      const observedSpan = previous
        ? Math.max(LOG_CHUNK_BLOCKS, resolvedBlock - previousBlock)
        : LOG_CHUNK_BLOCKS * 2;
      const stakeLowerBlock = Math.max(deployBlock, previousBlock - observedSpan);
      const stakeLog = await _latestLog(
        contract,
        contract.filters.CoinflipStakeUpdated(target, dayNumber),
        stakeLowerBlock,
        resolvedBlock,
      );
      const storedStake = stakeLog == null
        ? 0n
        : BigInt(stakeLog.args?.newTotal ?? stakeLog.args?.[3] ?? 0);

      // Avoid a historical log scan for ordinary accounts that have never
      // enabled auto-rebuy. sDGNRS is permanently armed after its seed window,
      // so always reconstruct it even if the optional live info call fails.
      let rebuyInfo = null;
      try { rebuyInfo = await contract.coinflipAutoRebuyInfo(target); }
      catch (_e) { /* older deployments degrade to stored stake */ }
      const isSdgnrs = CONTRACTS.SDGNRS
        && String(target).toLowerCase() === String(CONTRACTS.SDGNRS).toLowerCase();
      const mayHaveCarry = isSdgnrs
        || Boolean(rebuyInfo?.enabled ?? rebuyInfo?.[0])
        || BigInt(rebuyInfo?.carry ?? rebuyInfo?.[2] ?? 0) > 0n;
      if (!mayHaveCarry) return storedStake;

      const priorState = await _latestLogBefore(
        contract,
        contract.filters.CoinflipClaimState(target),
        deployBlock,
        resolved,
      );
      const carry = priorState == null
        ? 0n
        : BigInt(priorState.args?.autoRebuyCarry ?? priorState.args?.[2] ?? 0);
      return storedStake + carry;
    } catch (_e) {
      return null;
    }
  })();
  _resolvedStakeInflight.set(key, request);
  try {
    const total = await request;
    if (total != null) {
      _resolvedStakeCache.set(key, total);
      if (!_resolvedStakeReader) _persistResolvedStake(key, total);
    }
    return total;
  } finally {
    if (_resolvedStakeInflight.get(key) === request) _resolvedStakeInflight.delete(key);
  }
}

// Minimum FLIP deposit (Coinflip.sol:124 enforces via AmountLTMin).
// RESEARCH Q5: FLIP is unscaled on Sepolia — 1 FLIP = 1e18 wei.
const COINFLIP_MIN_FLIP_WEI = 100n * 10n ** 18n;

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Tests inject a fake via __setContractFactoryForTest; reset via
// __resetContractFactoryForTest. Mirrors Phase 60 / Phase 61 / Phase 62-02 pattern.
// ---------------------------------------------------------------------------

let _contractFactory = null;
let _reverseFlipContractFactory = null;

/** Test-only: replace the `new Contract(...)` construction with a fake. */
export function __setContractFactoryForTest(fn) {
  _contractFactory = fn;
}

/** Test-only: clear the injected factory; subsequent calls use the real path. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
}

/** Test-only: replace GAME contract construction for reverseFlip. */
export function __setReverseFlipContractFactoryForTest(fn) {
  _reverseFlipContractFactory = typeof fn === 'function' ? fn : null;
}

/** Test-only: restore production GAME contract construction. */
export function __resetReverseFlipContractFactoryForTest() {
  _reverseFlipContractFactory = null;
}

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, signerOrProvider);
}

function _buildReverseFlipContract(signerOrProvider) {
  if (_reverseFlipContractFactory) return _reverseFlipContractFactory(signerOrProvider);
  // Generation-specific ABI so `contract.reverseFlip` stays an unambiguous
  // bare name in both worlds (the arg list differs, the property doesn't).
  const abi = _nudgeQuoteViaView === true ? REVERSE_FLIP_ABI_V2 : REVERSE_FLIP_ABI;
  return new ethers.Contract(CONTRACTS.GAME, abi, signerOrProvider);
}

// ---------------------------------------------------------------------------
// Structured-revert-error helper — verbatim port from Phase 61 claims.js / 62-02 passes.js.
// ---------------------------------------------------------------------------

function _structuredRevertError(error, context) {
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || `Failed: ${context}`);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

function _reverseFlipRevertError(error, context) {
  const revertName = error?.revert?.name || error?.errorName || null;
  if (revertName === 'RngLocked') {
    const wrapped = new Error('RNG is locked while the next result is settling.');
    wrapped.code = 'RngLocked';
    wrapped.userMessage = wrapped.message;
    wrapped.recoveryAction = 'Wait for settlement to finish, then try again.';
    wrapped.cause = error;
    return wrapped;
  }
  if (revertName === 'E') {
    const wrapped = new Error('Reverse Flip is closed because the terminal RNG result is already public.');
    wrapped.code = 'E';
    wrapped.userMessage = wrapped.message;
    wrapped.recoveryAction = 'Wait for the next unresolved RNG cycle.';
    wrapped.cause = error;
    return wrapped;
  }
  if (revertName === 'NudgeCostChanged') {
    const wrapped = new Error('The Reverse Flip price changed — someone queued a nudge first.');
    wrapped.code = 'NudgeCostChanged';
    wrapped.userMessage = wrapped.message;
    wrapped.recoveryAction = 'Check the new price and try again.';
    wrapped.cause = error;
    return wrapped;
  }
  return _structuredRevertError(error, context);
}

// ---------------------------------------------------------------------------
// depositCoinflip — BUY-04 — synchronous FLIP deposit.
//
// Validates amount >= COINFLIP_MIN_FLIP_WEI client-side BEFORE static-call
// (defense-in-depth + faster UX). Static-call gate catches any contract-side
// state (CoinflipLocked during BAF jackpot resolution, etc.). Closure-form
// sendTx is mandatory.
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   amount: bigint | string | number,
 *   player?: string,
 * }} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function depositCoinflip({
  amount, player,
} = {}) {
  const buyer = player || getActingAddress();
  if (!buyer) throw new Error('Wallet not connected.');

  let amountWei;
  try {
    amountWei = BigInt(amount);
  } catch (_e) {
    throw new Error('Amount must be a numeric value.');
  }
  if (amountWei < COINFLIP_MIN_FLIP_WEI) {
    throw new Error('Minimum coinflip deposit is 100 FLIP.');
  }

  // Current deploy: Coinflip._depositCoinflip settles and consumes the
  // player's claimableStored first, then burns only the wallet remainder.
  // Calling claimCoinflips here would mint those winnings just to burn them in
  // a second signature, forfeiting the contract-native recycling path.

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  if (signer) {
    const c = _buildContract(signer);
    const sim = await requireStaticCall(c, 'depositCoinflip', [buyer, amountWei], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call depositCoinflip');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => _buildContract(s).depositCoinflip(buyer, amountWei),
    'Coinflip deposit',
  );
  return { receipt };
}

/**
 * Burn the contract's live FLIP price to add +1 to the next unresolved daily
 * RNG word.
 *
 * On run23+ deploys the call carries the quoted price (`reverseFlip(uint256
 * expectedCost)`), so a competing nudge landing first reverts NudgeCostChanged
 * instead of silently charging more. Legacy deploys take no argument; there
 * the UI quote is informational and the contract's price at inclusion is
 * authoritative.
 *
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function reverseFlip() {
  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Quote first: it also feature-detects which deploy generation this is
  // (latching _nudgeQuoteViaView, which _buildReverseFlipContract keys the
  // ABI off). On run23+ the quoted cost rides along as expectedCost.
  const quote = await readReverseFlipQuote();
  const args = _nudgeQuoteViaView === true && quote ? [quote.costWei] : [];

  if (signer) {
    const c = _buildReverseFlipContract(signer);
    const sim = await requireStaticCall(c, 'reverseFlip', args, signer);
    if (!sim.ok) {
      throw _reverseFlipRevertError(sim.error, 'static-call reverseFlip');
    }
  }

  try {
    const receipt = await sendTx(
      (s) => _buildReverseFlipContract(s).reverseFlip(...args),
      'Reverse flip',
    );
    return { receipt };
  } catch (error) {
    // Preserve wallet/network errors verbatim. Contract custom errors carry a
    // parsed revert name because REVERSE_FLIP_ABI includes both error fragments.
    if (error?.revert?.name || error?.errorName) {
      throw _reverseFlipRevertError(error, 'reverseFlip');
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// parseCoinflipDepositFromReceipt — extracts {player, creditedFlip} per emitted
// CoinflipDeposit event. CF-05 receipt-log-first pattern (Phase 60 D-03).
//
// Used by <app-coinflip-panel> to surface "you staked X FLIP, credited Y FLIP
// after recycling bonus" on tx confirmation.
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{player: string, creditedFlip: bigint}>}
 */
export function parseCoinflipDepositFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'CoinflipDeposit') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          creditedFlip: BigInt(parsed.args.creditedFlip ?? parsed.args[1]),
        });
      }
    } catch (_e) {
      // skip non-matching logs (foreign contracts, unknown events)
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reason-map registrations — Plan 62-03's 2 NEW codes.
//
// AmountLTMin    (Coinflip.sol:101) — depositCoinflip rejects amount <
//                COINFLIP_MIN_FLIP_WEI on-chain. Client-side validation
//                catches this first; this registration is the static-call
//                fallback decode.
// CoinflipLocked (Coinflip.sol:102) — coinflip module locks during BAF
//                jackpot resolution. User retries after resolution completes.
//
// NotApproved is already registered by Phase 60 (RESEARCH R11) — DO NOT
// re-register (the registration is idempotent but Plan 62-03 explicitly avoids
// it to keep its 2-NEW-codes acceptance criterion clean).
// ---------------------------------------------------------------------------

register('AmountLTMin', {
  code: 'AmountLTMin',
  userMessage: 'Minimum coinflip deposit is 100 FLIP.',
  recoveryAction: 'Increase your deposit and try again.',
});

register('CoinflipLocked', {
  code: 'CoinflipLocked',
  userMessage: 'Coinflip is locked during jackpot resolution.',
  recoveryAction: 'Try again in a few minutes.',
});

// FLIP.sol — the stake is BURNED from the player's FLIP (no allowance involved),
// so an under-funded deposit fails inside the token: `Insufficient()` when the
// coinflip-shortfall path cannot cover it, or a bare arithmetic underflow on
// `balanceOf[from] -= amount`. Both were unmapped, which rendered "you don't
// have the FLIP" as "an unexpected error occurred".
register('Insufficient', {
  code: 'Insufficient',
  userMessage: 'Not enough FLIP for that stake.',
  recoveryAction: 'Lower the amount or claim your FLIP winnings first.',
});
