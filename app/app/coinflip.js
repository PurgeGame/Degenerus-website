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
import {
  permissionlessReadProvider,
  readContractStorage,
  readProviderBlockNumber,
} from './read-provider.js';
import { readPurchaseInfo } from './purchase-info.js';
import { getActingAddress } from './store.js';

// ---------------------------------------------------------------------------
// Inline ABI fragments — canonical signatures verified against
// degenerus-audit/contracts/Coinflip.sol:46 + :229.
// ---------------------------------------------------------------------------

const COINFLIP_ABI = [
  // Coinflip.sol:229 — depositCoinflip(player, amount)
  'function depositCoinflip(address player, uint256 amount) external',
  // Carry-aware deposit: claimable -> unlocked auto-rebuy carry -> wallet.
  'function depositCoinflipWithCarry(address player, uint256 amount) external',
  // Coinflip.sol:1195 — claimable coinflip FLIP (settled + this day's mintable).
  'function previewClaimCoinflips(address player) external view returns (uint256 mintable)',
  // Carry-inclusive backing: everything the player could withdraw from the
  // coinflip position after settling resolved days.
  'function previewSalvageFlipBacking(address player) external view returns (uint256 backing)',
  // Coinflip.sol:1238 — the live stake for the upcoming/current flip day.
  'function coinflipAmount(address player) external view returns (uint256)',
  // Auto-rebuy carry is an implicit part of the next effective stake. It is
  // deliberately not copied into the day-keyed coinflipAmount storage slot.
  'function coinflipAutoRebuyInfo(address player) external view returns (bool enabled, uint256 stop, uint256 carry, uint24 startDay)',
  'function setCoinflipAutoRebuy(address player, bool enabled, uint256 takeProfit) external',
  'function setCoinflipAutoRebuyTakeProfit(address player, uint256 takeProfit) external',
  // Audit 0a1dc11f6 retired the bounty ladder and unified the four all-time records
  // onto ONE shared FLIP pool. Both surfaces are declared: the app must keep working
  // against a deployment on either side of that change, and every call site guards
  // individually rather than inside one Promise.all (see readBiggestFlipRecord).
  'function recordPool() external view returns (uint128)',
  'function biggestFlipEver() external view returns (uint128)',
  'function biggestSpinEver() external view returns (uint128)',
  'function biggestLuckboxEver() external view returns (uint128)',
  'function biggestBuyEver() external view returns (uint128)',
  // RETIRED in 0a1dc11f6 — kept so an older live deployment still reads.
  'function currentBounty() external view returns (uint128)',
  'function bountyOwedTo() external view returns (address)',
  'function bountyLocked() external view returns (bool)',
  // Packed three-state result: 0 unresolved, 1 resolved loss, 50..156 win.
  'function getCoinflipDayResult(uint24 day) external view returns (uint16 rewardPercent, bool win)',
  // Coinflip.sol:46 — CoinflipDeposit emitted on every deposit (CF-05).
  'event CoinflipDeposit(address indexed player, uint256 creditedFlip)',
  // Exact-day cumulative STORED credit. Auto-rebuy carry is added lazily while
  // resolving and therefore never appears in newTotal.
  'event CoinflipStakeUpdated(address indexed player, uint24 indexed day, uint256 amount, uint256 newTotal)',
  // kind: 0 FLIP, 1 SPIN, 2 LUCKBOX, 3 BUY. `paid == 0` is a bare ratchet, not a claim.
  'event BigRecordUpdated(uint8 indexed kind, address indexed player, uint256 value, uint128 paid, uint256 sdgnrsPaid)',
  'event CoinflipDayResolved(uint24 indexed day, bool win, uint16 rewardPercent, uint128 recordPoolAfter)',
  // RETIRED — kept so a queryFilter walk over pre-#34 blocks still decodes.
  'event BiggestFlipUpdated(address indexed player, uint256 recordAmount)',
  'event CoinflipClaimState(address indexed player, uint128 claimableStored, uint128 autoRebuyCarry, uint24 lastClaim)',
  'event CoinflipAutoRebuyToggled(address indexed player, bool enabled)',
  'event CoinflipAutoRebuyStopSet(address indexed player, uint256 stopAmount)',
  'error RngLocked()',
  'error AutoRebuyAlreadyEnabled()',
  'error AutoRebuyNotEnabled()',
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
const GAME_BAF_EVE_READ_ABI = [
  'function purchaseInfo() external view returns (uint24 lvl, bool inJackpotPhase, bool lastPurchaseDay_, bool rngLocked_, uint256 priceWei)',
];
const GAME_FLIP_BONUS_READ_ABI = [
  ...GAME_BAF_EVE_READ_ABI,
  'function jackpotCompressionTier() external view returns (uint8)',
  'function growthState(uint24 round) external view returns (uint256 ratchetPrev, uint256 ratchetRound, uint256 ratchetNext, uint24 currentLevel, bool bettingOpen, uint8 phaseDay)',
];
const GAME_RESOLVED_FLIP_BONUS_READ_ABI = [
  'function rngWordForDay(uint24 day) external view returns (uint256)',
];
const COINFLIP_EXTRA_MIN_PERCENT = 78n;
const COINFLIP_EXTRA_RANGE = 38n;
const ERC20_BALANCE_ABI = ['function balanceOf(address owner) external view returns (uint256)'];

let _currentStakeReader = null;
let _autoRebuyInfoReader = null;
let _resolvedStakeReader = null;
let _claimableReader = null;
let _backingReader = null;
let _latestResultReader = null;
let _widgetBalancesReader = null;
let _reverseFlipQuoteReader = null;
let _bafFlipEveReader = null;
let _upcomingFlipBonusReader = null;
let _resolvedFlipBonusWordReader = null;
let _biggestFlipReader = null;
let _stakeReadContractFactory = null;
// null = unprobed; true = deploy has rngNudgeQuote() (run23+ signature);
// false = legacy deploy (storage-slot quote + no-arg reverseFlip). Probed once
// per session by readReverseFlipQuote and consumed by reverseFlip()'s selector
// choice.
let _nudgeQuoteViaView = null;
let _publicReadProvider = null;
const _resolvedStakeCache = new Map();
const _currentStakeInflight = new Map();
const _autoRebuyInfoInflight = new Map();
const _resolvedStakeInflight = new Map();
const _claimableInflight = new Map();
const _backingInflight = new Map();
const _widgetBalancesInflight = new Map();
const _displaySnapshotInflight = new Map();
let _latestResultInflight = null;
let _reverseFlipQuoteInflight = null;
let _bafFlipEveInflight = null;
let _upcomingFlipBonusInflight = null;
const _resolvedFlipBonusCache = new Map();
const _resolvedFlipBonusInflight = new Map();
let _biggestFlipInflight = null;
let _biggestFlipLocator = null;
const LOG_CHUNK_BLOCKS = 1_800;
// v1 persisted only CoinflipStakeUpdated.newTotal and therefore permanently
// under-reported any day resolved with auto-rebuy carry (most visibly sDGNRS).
// v2 used the most recent emitted carry, which is stale when an ordinary
// player lets auto-rebuy roll through more than one unclaimed day.
const RESOLVED_STAKE_STORAGE_PREFIX = 'coinflip_resolved_stake_v3';
const BIGGEST_FLIP_LOCATOR_STORAGE_PREFIX = 'coinflip_biggest_record_v1';

/** Test-only: replace the live current-day stake read. */
export function __setCurrentStakeReaderForTest(fn) {
  _currentStakeReader = typeof fn === 'function' ? fn : null;
  _currentStakeInflight.clear();
  _displaySnapshotInflight.clear();
}

/** Test-only: replace the player's live auto-rebuy settings read. */
export function __setAutoRebuyInfoReaderForTest(fn) {
  _autoRebuyInfoReader = typeof fn === 'function' ? fn : null;
  _autoRebuyInfoInflight.clear();
  _displaySnapshotInflight.clear();
}

/** Test-only: replace the read contract used by live/historical stake reads. */
export function __setStakeReadContractFactoryForTest(fn) {
  _stakeReadContractFactory = typeof fn === 'function' ? fn : null;
  _currentStakeInflight.clear();
  _displaySnapshotInflight.clear();
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
  _displaySnapshotInflight.clear();
}

/** Test-only: replace the carry-inclusive coinflip backing read. */
export function __setBackingReaderForTest(fn) {
  _backingReader = typeof fn === 'function' ? fn : null;
  _backingInflight.clear();
  _displaySnapshotInflight.clear();
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
  _displaySnapshotInflight.clear();
}

/** Test-only: replace the live reverseFlip storage/lock read. */
export function __setReverseFlipQuoteReaderForTest(fn) {
  _reverseFlipQuoteReader = typeof fn === 'function' ? fn : null;
  _reverseFlipQuoteInflight = null;
  _nudgeQuoteViaView = null;
}

/** Test-only: replace the GAME purchaseInfo read used by the BAF-eve treatment. */
export function __setBafFlipEveReaderForTest(fn) {
  _bafFlipEveReader = typeof fn === 'function' ? fn : null;
  _bafFlipEveInflight = null;
}

/** Test-only: replace the GAME reads used by the upcoming bonus-flip badge. */
export function __setUpcomingFlipBonusReaderForTest(fn) {
  _upcomingFlipBonusReader = typeof fn === 'function' ? fn : null;
  _upcomingFlipBonusInflight = null;
}

/** Test-only: replace the GAME daily-word read used to verify a resolved bonus. */
export function __setResolvedFlipBonusWordReaderForTest(fn) {
  _resolvedFlipBonusWordReader = typeof fn === 'function' ? fn : null;
  _resolvedFlipBonusCache.clear();
  _resolvedFlipBonusInflight.clear();
}

/** Test-only: replace the chain-global Biggest Flip / bounty read. */
export function __setBiggestFlipReaderForTest(fn) {
  _biggestFlipReader = typeof fn === 'function' ? fn : null;
  _biggestFlipInflight = null;
  _biggestFlipLocator = null;
}

/** Test-only: restore the production current-day stake reader. */
export function __resetCurrentStakeReaderForTest() {
  _currentStakeReader = null;
  _currentStakeInflight.clear();
  _displaySnapshotInflight.clear();
  _publicReadProvider = null;
}

/** Test-only: restore the production auto-rebuy settings reader. */
export function __resetAutoRebuyInfoReaderForTest() {
  _autoRebuyInfoReader = null;
  _autoRebuyInfoInflight.clear();
  _displaySnapshotInflight.clear();
  _publicReadProvider = null;
}

/** Test-only: restore the production stake-read contract. */
export function __resetStakeReadContractFactoryForTest() {
  _stakeReadContractFactory = null;
  _currentStakeInflight.clear();
  _autoRebuyInfoInflight.clear();
  _displaySnapshotInflight.clear();
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
  _displaySnapshotInflight.clear();
  _publicReadProvider = null;
}

/** Test-only: restore the production carry-inclusive backing reader. */
export function __resetBackingReaderForTest() {
  _backingReader = null;
  _backingInflight.clear();
  _displaySnapshotInflight.clear();
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
  _displaySnapshotInflight.clear();
  _publicReadProvider = null;
}

/** Test-only: restore the production reverseFlip quote reader. */
export function __resetReverseFlipQuoteReaderForTest() {
  _reverseFlipQuoteReader = null;
  _reverseFlipQuoteInflight = null;
  _publicReadProvider = null;
  _nudgeQuoteViaView = null;
}

/** Test-only: restore the production BAF-eve state reader. */
export function __resetBafFlipEveReaderForTest() {
  _bafFlipEveReader = null;
  _bafFlipEveInflight = null;
  _publicReadProvider = null;
}

/** Test-only: restore the production upcoming bonus-flip state reader. */
export function __resetUpcomingFlipBonusReaderForTest() {
  _upcomingFlipBonusReader = null;
  _upcomingFlipBonusInflight = null;
  _publicReadProvider = null;
}

/** Test-only: restore the production resolved-day bonus reader and immutable cache. */
export function __resetResolvedFlipBonusWordReaderForTest() {
  _resolvedFlipBonusWordReader = null;
  _resolvedFlipBonusCache.clear();
  _resolvedFlipBonusInflight.clear();
  _publicReadProvider = null;
}

/** Test-only: restore the production Biggest Flip / bounty read. */
export function __resetBiggestFlipReaderForTest() {
  _biggestFlipReader = null;
  _biggestFlipInflight = null;
  _biggestFlipLocator = null;
  _publicReadProvider = null;
}

function _readerProvider() {
  return permissionlessReadProvider(getProvider());
}

function _stakeReadContract(provider) {
  return _stakeReadContractFactory
    ? _stakeReadContractFactory(provider)
    : new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, provider);
}

/** Exact final-purchase BAF window, retained while the deciding RNG is locked. */
export function bafFinalPurchaseDayFromPurchaseInfo(raw) {
  if (!raw) return null;
  const currentLevel = Number(raw?.lvl ?? raw?.currentLevel ?? raw?.[0]);
  const inJackpotPhase = Boolean(raw?.inJackpotPhase ?? raw?.[1]);
  const lastPurchaseDay = Boolean(raw?.lastPurchaseDay_ ?? raw?.lastPurchaseDay ?? raw?.[2]);
  const rngLocked = Boolean(raw?.rngLocked_ ?? raw?.rngLocked ?? raw?.[3]);
  if (!Number.isInteger(currentLevel) || currentLevel < 0) return null;
  if (inJackpotPhase || !lastPurchaseDay) return null;
  // The transition request pre-promotes `level` before exposing the lock.
  const targetLevel = currentLevel + (rngLocked ? 0 : 1);
  if (targetLevel <= 0 || targetLevel % 10 !== 0) return null;
  return { currentLevel, targetLevel, rngLocked };
}

/**
 * Convert GAME.purchaseInfo() into the one pre-draw state worth celebrating.
 * Once RNG locks, the deciding flip is underway rather than upcoming, so the
 * tomorrow treatment deliberately retires even though the BAF rail stays live.
 */
export function bafFlipEveFromPurchaseInfo(raw) {
  const finalDay = bafFinalPurchaseDayFromPurchaseInfo(raw);
  return finalDay && !finalDay.rngLocked
    ? { currentLevel: finalDay.currentLevel, targetLevel: finalDay.targetLevel }
    : null;
}

async function _readBafPurchaseInfo() {
  if (_bafFlipEveInflight) return _bafFlipEveInflight;
  const request = (async () => {
    try {
      return _bafFlipEveReader
        ? await _bafFlipEveReader()
        : await readPurchaseInfo();
    } catch (_e) {
      return null;
    }
  })();
  _bafFlipEveInflight = request;
  try {
    return await request;
  } finally {
    if (_bafFlipEveInflight === request) _bafFlipEveInflight = null;
  }
}

/** Read whether tomorrow's daily FLIP is the x10 BAF-triggering flip. */
export async function readBafFlipEve() {
  return bafFlipEveFromPurchaseInfo(await _readBafPurchaseInfo());
}

/** Read the full x9 final-purchase state, including the locked decision beat. */
export async function readBafFinalPurchaseDay() {
  return bafFinalPurchaseDayFromPurchaseInfo(await _readBafPurchaseInfo());
}

/** Mirror AdvanceModule's exact bonus-day predicate for the next unlocked FLIP. */
export function upcomingFlipBonusFromGameReads(raw) {
  const purchase = raw?.purchaseInfo ?? raw?.purchase ?? raw?.[0];
  const growth = raw?.growthState ?? raw?.growth ?? raw?.[2];
  const level = Number(purchase?.lvl ?? purchase?.currentLevel ?? purchase?.[0]
    ?? growth?.currentLevel ?? growth?.[3]);
  const inJackpot = Boolean(purchase?.inJackpotPhase ?? purchase?.[1]);
  const lastPurchase = Boolean(purchase?.lastPurchaseDay_ ?? purchase?.lastPurchaseDay ?? purchase?.[2]);
  const locked = Boolean(purchase?.rngLocked_ ?? purchase?.rngLocked ?? purchase?.[3]);
  const compression = Number(raw?.compressionTier ?? raw?.jackpotCompressionTier ?? raw?.[1]);
  const phaseDay = Number(growth?.phaseDay ?? growth?.[5]);
  if (!Number.isInteger(level) || level < 0 || !Number.isInteger(compression)
    || !Number.isInteger(phaseDay) || locked) return null;
  const jackpotBonus = inJackpot && phaseDay === 1;
  const levelZeroBonus = level === 0;
  const postTurboBonus = !inJackpot
    && (compression === 3 || (!lastPurchase && compression === 2));
  if (!jackpotBonus && !levelZeroBonus && !postTurboBonus) return null;
  const points = level !== 0 && level % 10 === 0 ? 6 : 2;
  return {
    level,
    points,
    kind: points === 6 ? 'x0' : 'standard',
    reason: jackpotBonus ? 'jackpot' : levelZeroBonus ? 'level-zero' : 'post-turbo',
  };
}

/** Chain-global preview for the bonus attached to the next daily FLIP. */
export async function readUpcomingFlipBonus() {
  if (_upcomingFlipBonusInflight) return _upcomingFlipBonusInflight;
  const request = (async () => {
    try {
      let raw;
      if (_upcomingFlipBonusReader) {
        raw = await _upcomingFlipBonusReader();
      } else {
        const provider = _readerProvider();
        if (!provider || !CONTRACTS.GAME) return null;
        const game = new ethers.Contract(CONTRACTS.GAME, GAME_FLIP_BONUS_READ_ABI, provider);
        let blockTag = null;
        try { blockTag = await readProviderBlockNumber(provider); } catch (_e) { /* latest is acceptable */ }
        const overrides = blockTag == null ? [] : [{ blockTag }];
        const [purchaseInfo, compressionTier, growthState] = await Promise.all([
          readPurchaseInfo({ provider, blockTag }),
          game.jackpotCompressionTier(...overrides),
          game.growthState(0, ...overrides),
        ]);
        raw = { purchaseInfo, compressionTier, growthState };
      }
      return upcomingFlipBonusFromGameReads(raw);
    } catch (_e) {
      return null;
    }
  })();
  _upcomingFlipBonusInflight = request;
  try {
    return await request;
  } finally {
    if (_upcomingFlipBonusInflight === request) _upcomingFlipBonusInflight = null;
  }
}

/**
 * Recompute the contract's base reward from one day's frozen RNG word.
 * A stored reward is considered a protocol bonus only when the difference is
 * exactly 0, 2, or 6; mismatched/legacy formulas return null instead of
 * presenting a guessed badge.
 */
export function resolvedFlipBonusFromRng(raw) {
  const day = Number(raw?.day);
  const rewardPercent = Number(raw?.rewardPercent);
  if (!Number.isInteger(day) || day <= 0 || day > 0xff_ffff
    || !Number.isInteger(rewardPercent) || rewardPercent < 0 || rewardPercent > 0xffff) {
    return null;
  }
  let rngWord;
  try {
    rngWord = BigInt(raw?.rngWord ?? raw?.word);
  } catch (_e) {
    return null;
  }
  if (rngWord <= 0n || rngWord >= (1n << 256n)) return null;

  let seedWord;
  try {
    seedWord = BigInt(ethers.solidityPackedKeccak256(
      ['uint256', 'uint24'],
      [rngWord, day],
    ));
  } catch (_e) {
    return null;
  }
  const roll = seedWord % 20n;
  const basePercent = roll === 0n
    ? 50n
    : roll === 1n
      ? 150n
      : (seedWord % COINFLIP_EXTRA_RANGE) + COINFLIP_EXTRA_MIN_PERCENT;
  const points = BigInt(rewardPercent) - basePercent;
  if (points !== 0n && points !== 2n && points !== 6n) return null;
  return {
    day,
    rewardPercent,
    basePercent: Number(basePercent),
    points: Number(points),
  };
}

/** Verify the immutable +2/+6 modifier attached to one resolved daily FLIP. */
export async function readResolvedFlipBonus({ day, rewardPercent } = {}) {
  const normalizedDay = Number(day);
  const normalizedReward = Number(rewardPercent);
  if (!Number.isInteger(normalizedDay) || normalizedDay <= 0 || normalizedDay > 0xff_ffff
    || !Number.isInteger(normalizedReward) || normalizedReward < 0 || normalizedReward > 0xffff) {
    return null;
  }
  const key = `${CHAIN.id}:${String(CONTRACTS.GAME || '').toLowerCase()}:${normalizedDay}:${normalizedReward}`;
  if (_resolvedFlipBonusCache.has(key)) return _resolvedFlipBonusCache.get(key);
  if (_resolvedFlipBonusInflight.has(key)) return _resolvedFlipBonusInflight.get(key);

  const request = (async () => {
    try {
      const rngWord = _resolvedFlipBonusWordReader
        ? await _resolvedFlipBonusWordReader({
          day: normalizedDay,
          rewardPercent: normalizedReward,
        })
        : await new ethers.Contract(
          CONTRACTS.GAME,
          GAME_RESOLVED_FLIP_BONUS_READ_ABI,
          _readerProvider(),
        ).rngWordForDay(normalizedDay);
      const verified = resolvedFlipBonusFromRng({
        day: normalizedDay,
        rewardPercent: normalizedReward,
        rngWord,
      });
      if (verified) _resolvedFlipBonusCache.set(key, verified);
      return verified;
    } catch (_e) {
      return null;
    }
  })();
  _resolvedFlipBonusInflight.set(key, request);
  try {
    return await request;
  } finally {
    if (_resolvedFlipBonusInflight.get(key) === request) {
      _resolvedFlipBonusInflight.delete(key);
    }
  }
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
        try { overrides = [{ blockTag: await readProviderBlockNumber(provider) }]; }
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

/** Effective Protocol Coins balance shared by every FLIP ledger.
 * Coinflip winnings are spendable before they are minted, so balanceOf alone
 * is not the amount the player can actually use across protocol surfaces. */
export function protocolFlipTotalWei(walletWei, backingWei = 0n) {
  if (walletWei == null) return null;
  try {
    return BigInt(walletWei) + BigInt(backingWei ?? 0n);
  } catch (_e) {
    return null;
  }
}

/**
 * Carry left after replaying every resolved auto-rebuy day.
 *
 * `coinflipAutoRebuyInfo().carry` is storage, not a live projection. Until a
 * write settles the account it can still describe the carry that ENTERED the
 * latest result. The two preview views replay that result and deliberately
 * differ by exactly the carry that remains, so prefer `backing - claimable`
 * whenever both values came from the same snapshot.
 */
export function effectiveAutoRebuyCarryWei({
  claimableWei = null,
  backingWei = null,
  autoRebuyInfo = null,
} = {}) {
  try {
    if (claimableWei != null && backingWei != null) {
      const claimable = BigInt(claimableWei);
      const backing = BigInt(backingWei);
      return backing > claimable ? backing - claimable : 0n;
    }
  } catch (_e) { /* fall through to the stored compatibility value */ }

  const enabled = Boolean(autoRebuyInfo?.enabled ?? autoRebuyInfo?.[0]);
  if (!enabled) return 0n;
  try {
    return BigInt(
      autoRebuyInfo?.effectiveCarryWei
      ?? autoRebuyInfo?.carryWei
      ?? autoRebuyInfo?.carry
      ?? autoRebuyInfo?.[2]
      ?? 0,
    );
  } catch (_e) {
    return 0n;
  }
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
        try { overrides = [{ blockTag: await readProviderBlockNumber(provider) }]; }
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
  return stored + effectiveAutoRebuyCarryWei({ autoRebuyInfo });
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
        readContractStorage(CONTRACTS.GAME, REVERSE_FLIP_STORAGE_SLOT, { provider }),
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

/** Normalize the tuple returned by Coinflip.coinflipAutoRebuyInfo. */
export function normalizeCoinflipAutoRebuyInfo(value) {
  if (value == null) return null;
  try {
    const startDay = Number(value?.startDay ?? value?.[3] ?? 0);
    return {
      enabled: Boolean(value?.enabled ?? value?.[0]),
      takeProfitWei: BigInt(
        value?.takeProfitWei ?? value?.stopWei ?? value?.stop ?? value?.[1] ?? 0,
      ),
      carryWei: BigInt(value?.carryWei ?? value?.carry ?? value?.[2] ?? 0),
      startDay: Number.isInteger(startDay) && startDay >= 0 ? startDay : 0,
    };
  } catch (_e) {
    return null;
  }
}

/**
 * Read the player's current auto-rebuy mode, take-profit chunk, and rolling
 * carry directly from the Coinflip deployment.
 *
 * @param {{player?: string}} [args]
 * @returns {Promise<{enabled: boolean, takeProfitWei: bigint, carryWei: bigint, startDay: number}|null>}
 */
export async function readCoinflipAutoRebuyInfo({ player } = {}) {
  const target = player || getActingAddress();
  if (!target) return null;
  const key = `${CHAIN.id}:${String(target).toLowerCase()}`;
  if (_autoRebuyInfoInflight.has(key)) return _autoRebuyInfoInflight.get(key);

  const request = (async () => {
    try {
      if (_autoRebuyInfoReader) {
        return normalizeCoinflipAutoRebuyInfo(
          await _autoRebuyInfoReader({ player: target }),
        );
      }
      const provider = _readerProvider();
      if (!provider || !CONTRACTS.COINFLIP) return null;
      let overrides = [];
      if (typeof provider.getBlockNumber === 'function') {
        try { overrides = [{ blockTag: await readProviderBlockNumber(provider) }]; }
        catch (_e) { /* an unpinned best-effort read is still useful */ }
      }
      return normalizeCoinflipAutoRebuyInfo(
        await _stakeReadContract(provider).coinflipAutoRebuyInfo(target, ...overrides),
      );
    } catch (_e) {
      return null;
    }
  })();
  _autoRebuyInfoInflight.set(key, request);
  try {
    return await request;
  } finally {
    if (_autoRebuyInfoInflight.get(key) === request) {
      _autoRebuyInfoInflight.delete(key);
    }
  }
}

/**
 * Read the player's effective live stake for the upcoming flip day.
 *
 * The dashboard's `depositedAmount` is the latest indexed daily stake. The
 * resolved day's stake is intentionally retained in that history, so after a
 * resolution it cannot reliably answer "what is my bet now?" The contract's
 * `coinflipAmount(player)` view is explicitly scoped to the current target day,
 * but contains only stored credits. Auto-rebuy carry is settled lazily, so the
 * raw settings tuple can still contain yesterday's carry after today's result
 * exists. Replay the two preview views at the same block and derive the live
 * carry from `backing - claimable`; use the raw tuple only as a compatibility
 * fallback when those views are unavailable.
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
        try { readOverrides = [{ blockTag: await readProviderBlockNumber(provider) }]; }
        catch (_e) { /* an unpinned best-effort read is still useful */ }
      }
      const canReplayCarry = typeof coinflip.previewClaimCoinflips === 'function'
        && typeof coinflip.previewSalvageFlipBacking === 'function';
      const [storedResult, rebuyResult, claimableResult, backingResult] = await Promise.allSettled([
        coinflip.coinflipAmount(target, ...readOverrides),
        coinflip.coinflipAutoRebuyInfo(target, ...readOverrides),
        canReplayCarry
          ? coinflip.previewClaimCoinflips(target, ...readOverrides)
          : Promise.reject(new Error('Carry preview unavailable')),
        canReplayCarry
          ? coinflip.previewSalvageFlipBacking(target, ...readOverrides)
          : Promise.reject(new Error('Backing preview unavailable')),
      ]);
      if (storedResult.status !== 'fulfilled') return null;
      const stored = BigInt(storedResult.value);
      const claimable = _fulfilledBigInt(claimableResult);
      const backing = _fulfilledBigInt(backingResult);
      if (claimable != null && backing != null) {
        const replayedCarry = effectiveAutoRebuyCarryWei({
          claimableWei: claimable,
          backingWei: backing,
          autoRebuyInfo: rebuyResult.status === 'fulfilled' ? rebuyResult.value : null,
        });
        return stored + replayedCarry;
      }
      return effectiveCoinflipStake(
        stored,
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

function _biggestFlipLocatorStorageKey() {
  return `${BIGGEST_FLIP_LOCATOR_STORAGE_PREFIX}:${CHAIN.id}:${String(CONTRACTS.COINFLIP || '').toLowerCase()}`;
}

function _loadBiggestFlipLocator() {
  if (_biggestFlipLocator) return _biggestFlipLocator;
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = JSON.parse(localStorage.getItem(_biggestFlipLocatorStorageKey()) || 'null');
    const recordWei = BigInt(raw?.recordWei ?? -1);
    const day = Number(raw?.day);
    const blockNumber = Number(raw?.blockNumber);
    const result = raw?.result === 'win' || raw?.result === 'loss' ? raw.result : null;
    if (recordWei < 0n || !Number.isInteger(day) || day < 0
      || !Number.isInteger(blockNumber) || blockNumber < 0) return null;
    _biggestFlipLocator = {
      recordWei,
      day,
      blockNumber,
      player: String(raw?.player || '').toLowerCase() || null,
      result,
    };
    return _biggestFlipLocator;
  } catch (_e) {
    return null;
  }
}

function _storeBiggestFlipLocator(locator) {
  _biggestFlipLocator = locator;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(_biggestFlipLocatorStorageKey(), JSON.stringify({
        ...locator,
        recordWei: String(locator.recordWei),
      }));
    }
  } catch (_e) { /* private browsing / quota */ }
}

function _eventArg(log, name, index) {
  return log?.args?.[name] ?? log?.args?.[index];
}

/** Locate the record-setting stake once, then retain its immutable target day. */
async function _resolveBiggestFlipLocator(contract, provider, recordWei) {
  const cached = _loadBiggestFlipLocator();
  if (cached?.recordWei === recordWei) return cached;
  if (recordWei <= 0n || typeof contract?.queryFilter !== 'function') return null;
  const recordFilter = contract.filters?.BiggestFlipUpdated?.();
  if (!recordFilter) return null;

  const head = Number(await readProviderBlockNumber(provider));
  const deployBlock = Math.max(0, Number(CHAIN.deployBlock || 0));
  const lowerBlock = cached?.blockNumber >= deployBlock ? cached.blockNumber : deployBlock;
  let recordLog = await _latestLog(contract, recordFilter, lowerBlock, head);
  if (recordLog && BigInt(_eventArg(recordLog, 'recordAmount', 1) ?? 0) !== recordWei
    && lowerBlock > deployBlock) {
    recordLog = await _latestLog(contract, recordFilter, deployBlock, head);
  }
  if (!recordLog || BigInt(_eventArg(recordLog, 'recordAmount', 1) ?? 0) !== recordWei) return null;

  const player = String(_eventArg(recordLog, 'player', 0) || '').toLowerCase();
  const blockNumber = Number(recordLog.blockNumber);
  const stakeFilter = contract.filters?.CoinflipStakeUpdated?.(player || null, null);
  if (!stakeFilter || !Number.isInteger(blockNumber)) return null;
  const recordTx = String(recordLog.transactionHash || '').toLowerCase();
  const recordIndex = _logIndex(recordLog);
  const stakes = await contract.queryFilter(stakeFilter, blockNumber, blockNumber);
  const matching = stakes.filter((log) => {
    const tx = String(log?.transactionHash || '').toLowerCase();
    if (recordTx && tx && tx !== recordTx) return false;
    const index = _logIndex(log);
    return recordIndex < 0 || index < 0 || index < recordIndex;
  });
  const stakeLog = matching.at(-1) || null;
  const day = Number(_eventArg(stakeLog, 'day', 1));
  if (!Number.isInteger(day) || day < 0) return null;

  const locator = { recordWei, day, blockNumber, player: player || null, result: null };
  _storeBiggestFlipLocator(locator);
  return locator;
}

async function _resolveBiggestFlipResult(contract, locator) {
  if (!locator) return null;
  if (locator.result === 'win' || locator.result === 'loss') return locator.result;
  const raw = await contract.getCoinflipDayResult(locator.day);
  const rewardPercent = Number(raw?.rewardPercent ?? raw?.[0] ?? 0);
  if (!Number.isFinite(rewardPercent) || rewardPercent <= 0) return null;
  const result = Boolean(raw?.win ?? raw?.[1]) ? 'win' : 'loss';
  _storeBiggestFlipLocator({ ...locator, result });
  return result;
}

/**
 * Price the deposit needed to take the bounty right now, and the one that also
 * locks it. Both thresholds use the standing record, including when a larger
 * losing flip was what most recently ratcheted that record.
 */
function _bountyBars(recordWei, armed, locked) {
  if (recordWei === 0n) return { claimWei: 1n, lockWei: null };
  if (locked) {
    const override = recordWei * 2n;
    return { claimWei: override, lockWei: override };
  }
  const onePercent = recordWei / 100n;
  const claimWei = armed
    ? recordWei + (onePercent === 0n ? 1n : onePercent)
    : recordWei + 1n;
  return { claimWei, lockWei: recordWei + recordWei / 10n };
}

/**
 * Read the global Biggest Flip record, its resolved win/loss, and the live
 * bounty. The record setter's target day is reconstructed from its immutable
 * event pair once and cached; unresolved records remain neutral until that
 * exact day's on-chain three-state result becomes nonzero.
 *
 * @returns {Promise<null|{recordWei: bigint, bountyWei: bigint, armedBy: string|null,
 *                        locked: boolean, claimWei: bigint, lockWei: bigint|null,
 *                        result: ('win'|'loss'|null), recordDay: number|null}>}
 */
export async function readBiggestFlipRecord({ resolveResult = true } = {}) {
  if (_biggestFlipReader) return _biggestFlipReader({ resolveResult });
  if (_biggestFlipInflight) return _biggestFlipInflight;
  const request = (async () => {
    try {
      const provider = _readerProvider();
      if (!provider || !CONTRACTS.COINFLIP) return null;
      const coinflip = _stakeReadContract(provider);
      // ⛔ EVERY GETTER IS READ INDEPENDENTLY, DELIBERATELY.
      // These used to sit in one bare Promise.all, so a single missing getter rejected
      // the whole thing and the outer catch returned null — blanking the entire panel
      // rather than the one field that was gone. Audit 0a1dc11f6 then removed THREE of
      // them at once (currentBounty / bountyOwedTo / bountyLocked, replaced by the
      // shared recordPool), which would have silently emptied the record UI on run #34.
      // Guarding per-call also keeps the app working against an older deployment.
      const opt = (fn) => Promise.resolve().then(fn).catch(() => null);
      const [record, pool, legacyBounty, owner, locked] = await Promise.all([
        opt(() => coinflip.biggestFlipEver()),
        opt(() => coinflip.recordPool()),      // 0a1dc11f6+ — the shared record pool
        opt(() => coinflip.currentBounty()),   // pre-0a1dc11f6 — the retired per-day bounty
        opt(() => coinflip.bountyOwedTo()),
        opt(() => coinflip.bountyLocked()),
      ]);
      // The pool succeeds the bounty as "the FLIP a record claim pays from", so the
      // panel's existing amount slot keeps meaning the same thing on both deployments.
      const bounty = pool ?? legacyBounty;
      const recordWei = BigInt(record ?? 0);
      let locator = null;
      let result = null;
      if (resolveResult) {
        try {
          locator = await _resolveBiggestFlipLocator(coinflip, provider, recordWei);
          result = await _resolveBiggestFlipResult(coinflip, locator);
        } catch (_e) { /* amount + bounty remain useful if historical RPC reads fail */ }
      }
      const ownerText = String(owner || '').toLowerCase();
      const armed = !/^0x0{40}$/.test(ownerText) && Boolean(ownerText);
      const isLocked = Boolean(locked);
      return {
        recordWei,
        bountyWei: BigInt(bounty ?? 0),
        armedBy: armed ? ownerText : null,
        locked: isLocked,
        ..._bountyBars(recordWei, armed, isLocked),
        result,
        recordDay: locator?.day ?? null,
      };
    } catch (_e) {
      return null;
    }
  })();
  _biggestFlipInflight = request;
  try {
    return await request;
  } finally {
    if (_biggestFlipInflight === request) _biggestFlipInflight = null;
  }
}

/**
 * Read all FLIP the player could withdraw from the coinflip position.
 *
 * Unlike `previewClaimCoinflips`, this includes the active auto-rebuy carry
 * after replaying every resolved day in the claim window. This is a value
 * read, not an action-availability check: an RNG lock may temporarily block a
 * carry withdrawal, but it does not make that backing stop belonging to the
 * player.
 *
 * @param {{player?: string}} [args]
 * @returns {Promise<bigint|null>} null when the read is unavailable
 */
export async function readCoinflipBacking({ player } = {}) {
  const target = player || getActingAddress();
  if (!target) return null;
  const key = `${CHAIN.id}:${String(target).toLowerCase()}`;
  if (_backingInflight.has(key)) return _backingInflight.get(key);

  const request = (async () => {
    try {
      if (_backingReader) {
        const value = await _backingReader({ player: target });
        return value == null ? null : BigInt(value);
      }
      const provider = _readerProvider();
      if (!provider || !CONTRACTS.COINFLIP) return null;
      const coinflip = new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, provider);
      return BigInt(await coinflip.previewSalvageFlipBacking(target));
    } catch (_e) {
      return null;
    }
  })();
  _backingInflight.set(key, request);
  try {
    return await request;
  } finally {
    if (_backingInflight.get(key) === request) _backingInflight.delete(key);
  }
}

function _displaySnapshotUsesTestSeams() {
  return Boolean(
    _currentStakeReader
    || _autoRebuyInfoReader
    || _claimableReader
    || _backingReader
    || _widgetBalancesReader
  );
}

function _snapshotValue(result) {
  return result?.status === 'fulfilled' ? result.value : null;
}

function _decorateSnapshotAutoRebuyInfo(info, carryWei) {
  if (!info) return null;
  return {
    ...info,
    // Keep the raw storage value available for diagnostics. Every player-facing
    // display consumes carryWei, which is the replayed/live value.
    storedCarryWei: BigInt(info.carryWei ?? 0n),
    carryWei: BigInt(carryWei ?? 0n),
  };
}

/**
 * One block-pinned source of truth for every live FLIP ledger display.
 *
 * Tomorrow's Bet, the auto-rebuy dialog, Protocol Coins, and the purchase-side
 * FLIP balance must not mix a pre-resolution carry with a post-resolution
 * claimable value (or one side of a just-confirmed claim with the other). This
 * snapshot reads every leg at one block and exposes the replayed carry once.
 *
 * @param {{player?: string, blockTag?: number|string|bigint|null}} [args]
 * @returns {Promise<null|{
 *   blockTag:number|string|bigint|null,
 *   balances:null|{flipBalance:bigint|null,wwxrpBalance:bigint|null,sdgnrsBalance:bigint|null},
 *   currentStakeWei:bigint|null,
 *   autoRebuyInfo:object|null,
 *   claimableWei:bigint|null,
 *   backingWei:bigint|null,
 *   ledgerComplete:boolean
 * }>}
 */
export async function readCoinflipDisplaySnapshot({ player, blockTag = null } = {}) {
  const target = player || getActingAddress();
  if (!target) return null;
  const addressKey = `${CHAIN.id}:${String(target).toLowerCase()}`;
  const requestKey = `${addressKey}:${blockTag == null ? 'head' : String(blockTag)}`;
  if (_displaySnapshotInflight.has(requestKey)) {
    return _displaySnapshotInflight.get(requestKey);
  }

  const request = (async () => {
    try {
      // Component tests replace the narrow readers individually. Compose those
      // same seams here so tests exercise the production aggregation rules
      // without falling through to a real RPC for any unmocked leg.
      if (_displaySnapshotUsesTestSeams()) {
        const [balancesResult, stakeResult, infoResult, claimableResult, backingResult]
          = await Promise.allSettled([
            _widgetBalancesReader
              ? readFlipWidgetBalances({ player: target })
              : Promise.resolve(null),
            _currentStakeReader
              ? readCurrentCoinflipStake({ player: target })
              : Promise.resolve(null),
            _autoRebuyInfoReader
              ? readCoinflipAutoRebuyInfo({ player: target })
              : Promise.resolve(null),
            _claimableReader
              ? readClaimableCoinflip({ player: target })
              : Promise.resolve(null),
            _backingReader
              ? readCoinflipBacking({ player: target })
              : Promise.resolve(null),
          ]);
        const balances = _snapshotValue(balancesResult);
        const currentStake = _snapshotValue(stakeResult);
        const rawInfo = _snapshotValue(infoResult);
        const claimable = _snapshotValue(claimableResult);
        const backing = _snapshotValue(backingResult);
        const carry = effectiveAutoRebuyCarryWei({
          claimableWei: claimable,
          backingWei: backing,
          autoRebuyInfo: rawInfo,
        });
        return {
          blockTag,
          balances,
          currentStakeWei: currentStake == null ? null : BigInt(currentStake),
          autoRebuyInfo: _decorateSnapshotAutoRebuyInfo(rawInfo, carry),
          claimableWei: claimable == null ? null : BigInt(claimable),
          backingWei: backing == null ? null : BigInt(backing),
          ledgerComplete: balances?.flipBalance != null
            && claimable != null
            && backing != null,
        };
      }

      const provider = _readerProvider();
      if (!provider || !CONTRACTS.COINFLIP) return null;
      let snapshotBlock = blockTag;
      if (snapshotBlock == null && typeof provider.getBlockNumber === 'function') {
        try { snapshotBlock = await readProviderBlockNumber(provider); }
        catch (_e) { /* retain an unpinned best-effort snapshot */ }
      }
      const overrides = snapshotBlock == null ? [] : [{ blockTag: snapshotBlock }];
      const coinflip = _stakeReadContract(provider);
      const flip = new ethers.Contract(CONTRACTS.COIN, ERC20_BALANCE_ABI, provider);
      const wwxrp = new ethers.Contract(CONTRACTS.WWXRP, ERC20_BALANCE_ABI, provider);
      const sdgnrs = new ethers.Contract(CONTRACTS.SDGNRS, ERC20_BALANCE_ABI, provider);
      const [
        flipResult,
        wwxrpResult,
        sdgnrsResult,
        storedResult,
        infoResult,
        claimableResult,
        backingResult,
      ] = await Promise.allSettled([
        flip.balanceOf(target, ...overrides),
        wwxrp.balanceOf(target, ...overrides),
        sdgnrs.balanceOf(target, ...overrides),
        coinflip.coinflipAmount(target, ...overrides),
        coinflip.coinflipAutoRebuyInfo(target, ...overrides),
        coinflip.previewClaimCoinflips(target, ...overrides),
        coinflip.previewSalvageFlipBacking(target, ...overrides),
      ]);
      const balances = {
        flipBalance: _fulfilledBigInt(flipResult),
        wwxrpBalance: _fulfilledBigInt(wwxrpResult),
        sdgnrsBalance: _fulfilledBigInt(sdgnrsResult),
      };
      const stored = _fulfilledBigInt(storedResult);
      const rawInfo = infoResult.status === 'fulfilled'
        ? normalizeCoinflipAutoRebuyInfo(infoResult.value)
        : null;
      const claimable = _fulfilledBigInt(claimableResult);
      const backing = _fulfilledBigInt(backingResult);
      const carry = effectiveAutoRebuyCarryWei({
        claimableWei: claimable,
        backingWei: backing,
        autoRebuyInfo: rawInfo,
      });
      const hasBalances = Object.values(balances).some((value) => value != null);
      const hasLedger = stored != null || rawInfo != null || claimable != null || backing != null;
      if (!hasBalances && !hasLedger) return null;
      return {
        blockTag: snapshotBlock,
        balances: hasBalances ? balances : null,
        currentStakeWei: stored == null ? null : stored + carry,
        autoRebuyInfo: _decorateSnapshotAutoRebuyInfo(rawInfo, carry),
        claimableWei: claimable,
        backingWei: backing,
        ledgerComplete: balances.flipBalance != null
          && claimable != null
          && backing != null,
      };
    } catch (_e) {
      return null;
    }
  })();

  _displaySnapshotInflight.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (_displaySnapshotInflight.get(requestKey) === request) {
      _displaySnapshotInflight.delete(requestKey);
    }
  }
}

/**
 * Read the cumulative stake for one completed flip day.
 *
 * `CoinflipStakeUpdated.newTotal` is authoritative for the stored-credit leg.
 * If auto-rebuy was active, the two historical preview views replay all prior
 * resolved days and expose the exact carry entering this resolution. Together
 * they avoid both misleading alternatives exposed by the general dashboard:
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
      const head = Number(await readProviderBlockNumber(provider));
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

      // Read both previews immediately before the day's resolution. Their
      // common claimable/banked legs cancel, leaving only the rolling carry
      // after every earlier resolved day has been replayed. This is what the
      // contract adds to day N's stored stake when that day is eventually
      // settled. It fixes multi-day auto-rebuy accounts whose last emitted
      // CoinflipClaimState predates one or more intervening wins/losses.
      if (
        resolvedBlock > deployBlock
        && typeof contract.previewClaimCoinflips === 'function'
        && typeof contract.previewSalvageFlipBacking === 'function'
      ) {
        const historicalBlock = resolvedBlock - 1;
        const [claimableResult, backingResult] = await Promise.allSettled([
          contract.previewClaimCoinflips(target, { blockTag: historicalBlock }),
          contract.previewSalvageFlipBacking(target, { blockTag: historicalBlock }),
        ]);
        const claimable = _fulfilledBigInt(claimableResult);
        const backing = _fulfilledBigInt(backingResult);
        if (claimable != null && backing != null) {
          const carry = backing > claimable ? backing - claimable : 0n;
          return storedStake + carry;
        }
      }

      // Older deployments and non-archive RPCs may not support the historical
      // views. Retain the event reconstruction as a best-effort fallback.
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
// depositCoinflipWithCarry(address,uint256). Coinflip is a direct deployment,
// so its dispatcher bytecode is authoritative for rolling-deploy detection.
const CARRY_DEPOSIT_SELECTOR_HEX = '1475fb86';

// PlayerCoinflipState stores the take-profit chunk as uint128. Solidity's
// explicit narrowing conversion would otherwise truncate a larger UI value.
export const MAX_AUTO_REBUY_TAKE_PROFIT_WEI = (1n << 128n) - 1n;

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Tests inject a fake via __setContractFactoryForTest; reset via
// __resetContractFactoryForTest. Mirrors Phase 60 / Phase 61 / Phase 62-02 pattern.
// ---------------------------------------------------------------------------

let _contractFactory = null;
let _reverseFlipContractFactory = null;
// null = unprobed; true = carry-aware selector deployed; false = legacy deploy.
let _carryDepositSupported = null;

/** Test-only: replace the `new Contract(...)` construction with a fake. */
export function __setContractFactoryForTest(fn) {
  _contractFactory = fn;
  _carryDepositSupported = null;
}

/** Test-only: clear the injected factory; subsequent calls use the real path. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
  _carryDepositSupported = null;
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

function _autoRebuyRevertError(error, context) {
  const revertName = error?.revert?.name || error?.errorName || null;
  let message = null;
  let recoveryAction = null;
  if (revertName === 'RngLocked') {
    message = 'Auto rebuy cannot change while the next result is settling.';
    recoveryAction = 'Wait for settlement to finish, then try again.';
  } else if (revertName === 'AutoRebuyAlreadyEnabled') {
    message = 'Auto rebuy is already enabled.';
    recoveryAction = 'Refresh the settings before trying again.';
  } else if (revertName === 'AutoRebuyNotEnabled') {
    message = 'Auto rebuy is no longer enabled.';
    recoveryAction = 'Refresh the settings and turn it on first.';
  }
  if (!message) return _structuredRevertError(error, context);
  const wrapped = new Error(message);
  wrapped.code = revertName;
  wrapped.userMessage = message;
  wrapped.recoveryAction = recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

function _autoRebuyTakeProfit(value) {
  let amount;
  try { amount = BigInt(value ?? 0); }
  catch (_e) { throw new Error('Take profit must be a numeric FLIP amount.'); }
  if (amount < 0n) throw new Error('Take profit cannot be negative.');
  if (amount > MAX_AUTO_REBUY_TAKE_PROFIT_WEI) {
    throw new Error('Take profit is too large for coinflip auto rebuy.');
  }
  return amount;
}

function _missingCarryDepositSelector(error) {
  if (error?.revert?.name || error?.errorName) return false;
  const data = error?.data
    ?? error?.error?.data
    ?? error?.info?.error?.data
    ?? error?.cause?.data
    ?? null;
  const code = error?.code ?? error?.cause?.code ?? null;
  return (code === 'CALL_EXCEPTION' || code === 'BAD_DATA')
    && (data == null || data === '0x');
}

async function _probeCarryDepositSupport(provider) {
  if (_carryDepositSupported != null || _contractFactory
    || typeof provider?.getCode !== 'function') return;
  try {
    const code = String(await provider.getCode(CONTRACTS.COINFLIP) || '').toLowerCase();
    if (/^0x[0-9a-f]+$/.test(code) && code.length > 2) {
      _carryDepositSupported = code.includes(CARRY_DEPOSIT_SELECTOR_HEX);
    }
  } catch (_e) {
    // Leave support unknown. The safe next step is to try the carry selector
    // and surface failure, never to guess legacy and spend wallet FLIP.
  }
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
 *   useCarry?: boolean,
 * }} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function depositCoinflip({
  amount, player, useCarry = true,
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

  // Current deploy: the carry-aware selector settles once and consumes
  // claimableStored first, unlocked auto-rebuy carry second, then burns only
  // the wallet remainder. Carry already received its roll bonus, so the
  // contract deliberately does not bonus it again. A rolling deployment can
  // fall back to the legacy claimable -> wallet selector when the new selector
  // is genuinely absent; a real RngLocked revert is never converted into a
  // wallet-funded deposit.

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (useCarry) await _probeCarryDepositSupport(provider);
  let method = useCarry && _carryDepositSupported !== false
    ? 'depositCoinflipWithCarry'
    : 'depositCoinflip';

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  if (signer) {
    const c = _buildContract(signer);
    if (method === 'depositCoinflipWithCarry'
      && typeof c?.depositCoinflipWithCarry?.staticCall !== 'function') {
      _carryDepositSupported = false;
      method = 'depositCoinflip';
    }

    if (method === 'depositCoinflipWithCarry') {
      const carrySim = await requireStaticCall(c, method, [buyer, amountWei], signer);
      if (carrySim.ok) {
        _carryDepositSupported = true;
      } else if (_carryDepositSupported !== true
        && _contractFactory
        && _missingCarryDepositSelector(carrySim.error)) {
        // Test/legacy adapter seam. Production detects this from authoritative
        // deployed bytecode above; ambiguous empty RPC reverts never fall back.
        _carryDepositSupported = false;
        method = 'depositCoinflip';
      } else {
        // A decoded revert proves the selector exists. In particular, preserve
        // RngLocked so carry can never be silently replaced with wallet FLIP.
        if (carrySim.error?.revert?.name || carrySim.error?.errorName) {
          _carryDepositSupported = true;
        }
        throw _autoRebuyRevertError(carrySim.error, `static-call ${method}`);
      }
    }

    if (method === 'depositCoinflip') {
      const sim = await requireStaticCall(c, method, [buyer, amountWei], signer);
      if (!sim.ok) throw _structuredRevertError(sim.error, `static-call ${method}`);
    }
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => _buildContract(s)[method](buyer, amountWei),
    'Coinflip deposit',
  );
  return { receipt };
}

/**
 * Turn coinflip auto-rebuy on or off. Disabling settles every resolved day and
 * cashes out the remaining carry; the contract blocks this while RNG is
 * locked so a known pending loss cannot be dodged.
 *
 * @param {{player?: string, enabled: boolean, takeProfit?: bigint|string|number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function setCoinflipAutoRebuy({
  player, enabled, takeProfit = 0n,
} = {}) {
  const target = player || getActingAddress();
  if (!target) throw new Error('Wallet not connected.');
  const nextEnabled = Boolean(enabled);
  const takeProfitWei = nextEnabled ? _autoRebuyTakeProfit(takeProfit) : 0n;
  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const contract = _buildContract(signer);
    const simulation = await requireStaticCall(
      contract,
      'setCoinflipAutoRebuy',
      [target, nextEnabled, takeProfitWei],
      signer,
    );
    if (!simulation.ok) {
      throw _autoRebuyRevertError(simulation.error, 'static-call setCoinflipAutoRebuy');
    }
  }

  try {
    const receipt = await sendTx(
      (s) => _buildContract(s).setCoinflipAutoRebuy(
        target,
        nextEnabled,
        takeProfitWei,
      ),
      nextEnabled ? 'Enable coinflip auto rebuy' : 'Disable coinflip auto rebuy',
    );
    return { receipt };
  } catch (error) {
    if (error?.revert?.name || error?.errorName) {
      throw _autoRebuyRevertError(error, 'setCoinflipAutoRebuy');
    }
    throw error;
  }
}

/** Update only the take-profit chunk while auto-rebuy remains enabled. */
export async function setCoinflipAutoRebuyTakeProfit({
  player, takeProfit = 0n,
} = {}) {
  const target = player || getActingAddress();
  if (!target) throw new Error('Wallet not connected.');
  const takeProfitWei = _autoRebuyTakeProfit(takeProfit);
  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const contract = _buildContract(signer);
    const simulation = await requireStaticCall(
      contract,
      'setCoinflipAutoRebuyTakeProfit',
      [target, takeProfitWei],
      signer,
    );
    if (!simulation.ok) {
      throw _autoRebuyRevertError(
        simulation.error,
        'static-call setCoinflipAutoRebuyTakeProfit',
      );
    }
  }

  try {
    const receipt = await sendTx(
      (s) => _buildContract(s).setCoinflipAutoRebuyTakeProfit(
        target,
        takeProfitWei,
      ),
      'Update coinflip take profit',
    );
    return { receipt };
  } catch (error) {
    if (error?.revert?.name || error?.errorName) {
      throw _autoRebuyRevertError(error, 'setCoinflipAutoRebuyTakeProfit');
    }
    throw error;
  }
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
