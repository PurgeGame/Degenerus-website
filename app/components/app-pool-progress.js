// Two-mode level pool instrument.
//
// Purchase phase: nextPrizePool fills toward the contract progression target,
// with the growth market's strict O/U line sharing the same scale.
// Jackpot phase: the graph disappears. The strip names the level's fixed,
// banked prize pool and the largest single-winner share the next physical draw
// can allocate under the contract's 6%-14% / final-day rules.
//
// Live pools prefer the same fast app.goldRush sample that drives the headline;
// /game/state remains the rolling-deploy fallback. Contract benchmarks are
// published by app-parimutuel-panel, while app.goldRush carries a phase clock
// decoded from GAME.currentDayView + packed purchaseStartDay in the same direct-
// chain multicall. The strip's day has no indexer dependency.

import { displayEth } from '../app/scaling.js';
import { activeTicketLevel } from '../app/active-level.js';
import { ETH_DIVISOR } from '../app/chain-config.js';
import { formatJackpotCountdown, secondsUntilDayCrossover } from '../app/jackpot-countdown.js';
import { get, subscribe } from '../app/store.js';

const SCALE_HEADROOM_BPS = 11_250n;
const POST_TARGET_BREAK_PERCENT = 68;
const POST_TARGET_START_PERCENT = 2;
const HISTORY_CYCLE_LEVELS = 100;
const POSITION_RATIO_SCALE = 1_000_000n;
const JACKPOT_DAY_CAP = 5;
const DAILY_CURRENT_BPS_MAX = 1_400n;
const DAILY_ETH_BPS = 8_000n; // 20% of each physical draw buys tickets.
const DAILY_SOLO_SHARE_BPS = 4_000n;
const FINAL_SOLO_SHARE_BPS = 6_000n;
export const LEVEL_ONE_TARGET_WEI = (50n * 10n ** 18n) / ETH_DIVISOR;

function _wei(value) {
  if (value == null || value === '') return null;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function _clampPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function _position(value, scale) {
  if (value == null || scale <= 0n) return null;
  return _clampPercent(Number((value * 10_000n) / scale) / 100);
}

function _ratio(value, total) {
  if (value == null || total == null || total <= 0n) return 0;
  const clamped = value < 0n ? 0n : value > total ? total : value;
  return Number((clamped * POSITION_RATIO_SCALE) / total) / Number(POSITION_RATIO_SCALE);
}

/** Historical ticks restart at x01; the completed x00 level is never shown. */
function _historyCycleStart(currentLevel) {
  const level = Number(currentLevel);
  if (!Number.isInteger(level) || level <= 1) return 1;
  const completedCenturies = Math.floor((level - 1) / HISTORY_CYCLE_LEVELS);
  return Math.max(1, (completedCenturies * HISTORY_CYCLE_LEVELS) + 1);
}

/**
 * Completed-pool history ruler.
 *
 * The guarantee is a stable visual hinge at 68%. Prior level finals use a
 * true bounded logarithmic scale from the smallest completed pool to the
 * guarantee. That keeps the early levels from collapsing into a barcode while
 * values above the guarantee retain an honest linear comparison.
 */
function _postTargetPosition(value, target, scale, floor) {
  if (value == null || target == null || target <= 0n || scale <= 0n) return null;
  if (value <= target) {
    const lower = floor != null && floor > 0n && floor < target ? floor : null;
    if (lower == null) {
      return _clampPercent(_ratio(value, target) * POST_TARGET_BREAK_PERCENT);
    }
    if (value <= lower) return POST_TARGET_START_PERCENT;
    const lowerNumber = Number(lower);
    const targetNumber = Number(target);
    const valueNumber = Number(value);
    const normalized = Math.log(valueNumber / lowerNumber)
      / Math.log(targetNumber / lowerNumber);
    return _clampPercent(
      POST_TARGET_START_PERCENT
      + (normalized * (POST_TARGET_BREAK_PERCENT - POST_TARGET_START_PERCENT)),
    );
  }
  if (scale <= target) return 100;
  const over = _ratio(value - target, scale - target);
  return _clampPercent(
    POST_TARGET_BREAK_PERCENT + (over * (100 - POST_TARGET_BREAK_PERCENT)),
  );
}

function _historicalPools(history, currentLevel) {
  const limit = Number(currentLevel);
  const hasLimit = Number.isInteger(limit) && limit > 0;
  const cycleStart = hasLimit ? _historyCycleStart(limit) : 1;
  const byLevel = new Map();
  for (const row of Array.isArray(history) ? history : []) {
    const level = Number(row?.level);
    const poolWei = _wei(row?.poolWei ?? row?.value ?? row?.pool);
    if (!Number.isInteger(level) || level < cycleStart || (hasLimit && level >= limit)) continue;
    if (poolWei == null || poolWei <= 0n) continue;
    byLevel.set(level, poolWei);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, poolWei]) => ({ level, poolWei }));
}

/**
 * Keep the completed ruler legible instead of turning every past level into a
 * barcode. The immediately preceding final is the previous-level reference;
 * older finals are sampled in five-level steps measured back from the live level.
 * Each century begins at x01. After an x00 settlement, its tick stays hidden
 * and the next level starts a fresh ruler, so the reset pool is not scaled
 * against the previous century's much larger pools.
 */
export function sampledPoolHistory(history, currentLevel) {
  const rows = _historicalPools(history, currentLevel);
  if (rows.length === 0) return [];
  const latest = rows[rows.length - 1];
  const liveLevel = Number(currentLevel);
  const anchor = Number.isInteger(liveLevel) && liveLevel > latest.level
    ? liveLevel
    : latest.level + 1;
  const cycleStart = _historyCycleStart(anchor);
  return rows.flatMap((row) => {
    const kind = row.level === anchor - 1
      ? 'previous'
      : row.level === cycleStart
        ? 'start'
        : row.level > 3 && (anchor - row.level) % 5 === 0
          ? 'interval'
          : null;
    return kind == null ? [] : [{ ...row, kind }];
  });
}

/** Level 1 has no prior pool to ratchet from; the contract bootstraps it at 50 ETH. */
export function prizePoolTargetForLevel(level, targetWei) {
  if (Number(level) === 1) return LEVEL_ONE_TARGET_WEI;
  const target = _wei(targetWei);
  return target != null && target > 0n ? target : null;
}

/** Exact strict OVER threshold: live * prev > current². */
export function growthOverTargetWei(ratchets) {
  const prev = _wei(ratchets?.prev);
  const current = _wei(ratchets?.current);
  if (prev == null || current == null || prev <= 0n || current <= 0n) return null;
  return (current * current) / prev + 1n;
}

/** The growth percentage the open O/U market asks the next pool to beat. */
export function growthLinePercent(ratchets) {
  const prev = _wei(ratchets?.prev);
  const current = _wei(ratchets?.current);
  if (prev == null || current == null || prev <= 0n) return null;
  return Number(((current - prev) * 10_000n) / prev) / 100;
}

/** Pure purchase-phase layout model shared with the component tests. */
export function poolProgressModel({
  nextWei,
  targetWei,
  ratchets,
  history,
  currentLevel,
} = {}) {
  const next = _wei(nextWei);
  const target = _wei(targetWei);
  const growthTarget = growthOverTargetWei(ratchets);
  const historicalPools = _historicalPools(history, currentLevel);
  const displayedHistoricalPools = sampledPoolHistory(history, currentLevel);
  const levelReady = next != null && target != null && target > 0n && next > target;
  const values = [
    next,
    target,
    growthTarget,
    ...(levelReady ? historicalPools.map((row) => row.poolWei) : []),
  ].filter((value) => value != null && value > 0n);
  const high = values.reduce((max, value) => value > max ? value : max, 1n);
  const scale = (high * SCALE_HEADROOM_BPS + 9_999n) / 10_000n;
  const growthOver = next != null && growthTarget != null && next >= growthTarget;
  const levelBps = next != null && target != null && target > 0n
    ? Number((next * 1_000n) / target)
    : null;
  // Before progression, the readout identifies the goal. Once the goal has
  // actually been cleared, keep that marker as historical context but let the
  // visible amount ride the live edge of the pool instead.
  const referenceWei = levelReady ? next : target;
  const historyFloor = levelReady
    ? historicalPools.reduce(
        (floor, row) => floor == null || row.poolWei < floor ? row.poolWei : floor,
        null,
      )
    : null;
  const position = levelReady && target != null
    ? (value) => _postTargetPosition(value, target, scale, historyFloor)
    : (value) => _position(value, scale);
  const referencePercent = position(levelReady ? next : target);

  return {
    next,
    target: target != null && target > 0n ? target : null,
    growthTarget,
    growthLinePercent: growthLinePercent(ratchets),
    // A live amount without its contract benchmark is not measurable progress.
    // Leaving the tube empty while that async read warms avoids a convincing
    // but entirely synthetic ~89% fill (next / 1.125 * next).
    fillPercent: target != null && target > 0n ? position(next ?? 0n) : 0,
    targetPercent: position(target),
    growthPercent: position(growthTarget),
    levelReady,
    growthOver,
    // Prior final pools become the thermometer's graduations only after the
    // current guarantee is cleared. Below 100% the tube stays visually clean.
    historyMarkers: levelReady
      ? displayedHistoricalPools.map((row) => ({
          ...row,
          position: position(row.poolWei),
        }))
      : [],
    levelPercent: levelBps == null ? null : levelBps / 10,
    referenceKind: levelReady ? 'CURRENT' : 'GUARANTEE',
    referenceWei,
    referencePercent,
    neededWei: next != null && target != null && target >= next
      ? target - next + 1n
      : 0n,
  };
}

/**
 * Resolve the pool represented by nextPrizePool independently of the level
 * currently accepting ticket purchases.
 *
 * On the locked final purchase day, GAME promotes `level` before the transition
 * writes that level's closing ratchet. Purchases consequently route to level+1,
 * while nextPrizePool still represents the level being closed. During that
 * short window prizePoolTargetView() falls back to the 50 ETH bootstrap value;
 * the previous write-once ratchet is the actual guarantee for the closing pool.
 */
export function prizePoolThermometerContext({
  phaseLevel = null,
  benchmarkLevel = null,
  targetWei = null,
  ratchets = null,
  contractPhase = null,
} = {}) {
  const purchaseLevel = Number(phaseLevel);
  const chainLevel = Number(benchmarkLevel);
  const previousRatchet = _wei(ratchets?.prev);
  const currentRatchet = _wei(ratchets?.current);
  const promotedFinalWindow = contractPhase?.jackpot === false
    && contractPhase?.lastPurchaseDay === true
    && contractPhase?.rngLocked === true
    && Number.isInteger(purchaseLevel)
    && Number.isInteger(chainLevel)
    && purchaseLevel === chainLevel + 1
    && previousRatchet != null
    && previousRatchet > 0n
    && (currentRatchet == null || currentRatchet === 0n);

  return {
    level: promotedFinalWindow
      ? chainLevel
      : Number.isInteger(purchaseLevel) ? purchaseLevel : null,
    targetWei: promotedFinalWindow ? previousRatchet : _wei(targetWei),
    closing: promotedFinalWindow,
  };
}

/**
 * The contract's compression tier is FOUR-valued, not three
 * (storage/DegenerusGameStorage.sol:65 — `0=norm 1=comp 2=turbo 3=turbo+owed`).
 *
 * Tier 3 is a turbo that was armed while the PREVIOUS turbo's coinflip bonus
 * latch was still owed (AdvanceModule.sol:329 —
 * `compressedJackpotFlag = compressedJackpotFlag == 2 ? 3 : 2`), i.e. two
 * back-to-back levels that each met their target inside one purchase day. It
 * collapses all five logical days into one physical day exactly as a plain
 * turbo does, and drops back to 2 at that day's settlement
 * (AdvanceModule.sol:1647).
 *
 * So the contract's cadence predicate is `>= 2`, not `== 2`:
 *   - AdvanceModule.sol:2360 `if (compressedJackpotFlag >= 2 && jackpotCounter == 0)`
 *     with the comment "covers the chained-arm request, whose flag is 3",
 *   - JackpotModule.sol:2404 `compressedJackpotFlag >= 2 ? lvl + 1 : lvl`,
 *   - DegenerusGame.sol:2602 `bettingOpen = ... compressedJackpotFlag < 2`,
 *     documented at :2563 as "a turbo phase (2, or 3 before its predecessor's
 *     bonus is paid down to 2) takes all five logical days in one physical day".
 *
 * Treating 3 as normal made a chained turbo render as a five-day phase.
 */
export function isTurboTier(compressedFlag) {
  return (Number(compressedFlag) || 0) >= 2;
}

function _jackpotStep(counter, compressedFlag) {
  if (isTurboTier(compressedFlag) && counter === 0) return JACKPOT_DAY_CAP;
  if (compressedFlag === 1 && counter > 0 && counter < JACKPOT_DAY_CAP - 1) return 2;
  return 1;
}

/**
 * Map the contract's five LOGICAL jackpot-day counter onto physical draws.
 *
 * Normal:     counters 0,1,2,3,4 -> draws 1..5
 * Compressed: counters 0,1,3     -> draws 1..3
 * Turbo:      counter 0          -> draw 1/1   (tier 2 AND tier 3)
 *
 * The logical range remains available for payout copy, but it must never be
 * presented as the number of real-world days a player has waited.
 */
export function jackpotCadenceModel({ counter = 0, compressedFlag = 0 } = {}) {
  const completed = Math.max(0, Math.min(JACKPOT_DAY_CAP, Number(counter) || 0));
  const compressed = Number(compressedFlag) || 0;
  const starts = isTurboTier(compressed)
    ? [0]
    : compressed === 1
      ? [0, 1, 3]
      : [0, 1, 2, 3, 4];
  let drawNumber = 1;
  for (let index = 0; index < starts.length; index += 1) {
    if (completed >= starts[index]) drawNumber = index + 1;
  }
  const step = _jackpotStep(completed, compressed);
  return {
    drawNumber: Math.min(starts.length, drawNumber),
    drawCount: starts.length,
    logicalStart: Math.min(JACKPOT_DAY_CAP, completed + 1),
    logicalEnd: Math.min(JACKPOT_DAY_CAP, completed + step),
    step,
  };
}

/**
 * Pure jackpot-phase model.
 *
 * Non-final draws can take at most 14% of the remaining current pool (28% on
 * a two-day compressed draw). The ETH leg is 80% of that draw and its solo
 * bucket receives 40%. The final physical draw takes the remaining pool, with
 * 80% in the ETH leg and 60% assigned to the solo bucket. This is a maximum
 * face-value share; its large-pool 75/25 ETH/whale-pass settlement is handled
 * by the contract after a winner exists.
 */
export function jackpotPoolModel({ currentWei, baselineWei, counter = 0, compressedFlag = 0 } = {}) {
  const current = _wei(currentWei);
  const suppliedBaseline = _wei(baselineWei);
  const completed = Math.max(0, Math.min(JACKPOT_DAY_CAP, Number(counter) || 0));
  const compressed = Number(compressedFlag) || 0;
  const cadence = jackpotCadenceModel({ counter: completed, compressedFlag: compressed });
  const step = cadence.step;
  const finalDraw = completed + step >= JACKPOT_DAY_CAP;
  const drawStart = cadence.logicalStart;
  const drawEnd = cadence.logicalEnd;
  const baseline = [current, suppliedBaseline]
    .filter((value) => value != null && value > 0n)
    .reduce((max, value) => value > max ? value : max, 0n);

  let maxWinWei = null;
  if (current != null) {
    const drawBps = finalDraw
      ? 10_000n
      : DAILY_CURRENT_BPS_MAX * BigInt(step);
    const drawBudget = (current * drawBps) / 10_000n;
    const ethBudget = (drawBudget * DAILY_ETH_BPS) / 10_000n;
    const soloShareBps = finalDraw ? FINAL_SOLO_SHARE_BPS : DAILY_SOLO_SHARE_BPS;
    maxWinWei = (ethBudget * soloShareBps) / 10_000n;
  }

  const remainingPercent = current != null && baseline > 0n
    ? Number((current * 10_000n) / baseline) / 100
    : null;

  return {
    current,
    baseline: baseline > 0n ? baseline : null,
    maxWinWei,
    finalDraw,
    step,
    drawStart,
    drawEnd,
    physicalDraw: cadence.drawNumber,
    physicalDrawCount: cadence.drawCount,
    remainingPercent,
    fillPercent: _clampPercent(remainingPercent),
  };
}

/**
 * Promote a purchase header only when this pool has armed the contract's
 * one-day jackpot path. The progression check is deliberately supplied by
 * poolProgressModel: it is strict `next > target`, so a rounded 100% display
 * cannot announce turbo early. BAF levels keep their dedicated x10 treatment.
 */
export function purchaseTurboJackpotModel({
  level = null,
  purchaseDay = null,
  levelReady = false,
  nextWei = null,
} = {}) {
  const targetLevel = Number(level);
  const pool = _wei(nextWei);
  if (!levelReady
      || Number(purchaseDay) !== 1
      || !Number.isInteger(targetLevel)
      || targetLevel <= 0
      || targetLevel % 10 === 0
      || pool == null
      || pool <= 0n) {
    return null;
  }

  const grandPrizeWei = jackpotPoolModel({
    currentWei: pool,
    baselineWei: pool,
    counter: 0,
    compressedFlag: 2,
  }).maxWinWei;
  return grandPrizeWei == null ? null : { level: targetLevel, grandPrizeWei };
}

/**
 * Use the same authoritative phase counter for the day label and payout model.
 * The indexed game-state snapshot can briefly retain zero after the contract has
 * advanced, which otherwise makes a final draw look like an ordinary day-one draw.
 */
export function jackpotDrawCounter({ contractPhase = null, gameState = null, goldRush = null } = {}) {
  // Two producers spell the same contract field differently: the parimutuel
  // benchmark snapshot calls it `day` (growthState.phaseDay), the gold-rush
  // slot0 decode calls it `jackpotCounter` (polling.js:333). Reading only `day`
  // silently dropped the live chain counter whenever the gold-rush reader was
  // the phase source, handing the label the LAGGING indexed value this function
  // exists to outrank — and pinning a compressed phase to "draw 1 of 3".
  const raw = contractPhase?.day
    ?? contractPhase?.jackpotCounter
    ?? goldRush?.phaseDay
    ?? gameState?.jackpotCounter
    ?? 0;
  return Math.max(0, Math.min(JACKPOT_DAY_CAP, Number(raw) || 0));
}

/**
 * Resolve the compression tier from whichever source actually has one.
 *
 * Every reader used to coerce a missing/failed read to 0 ("normal"), and the
 * consumers used `??`, which does not fall through a 0. A single transient
 * failure of `jackpotCompressionTier()` therefore MASKED a live turbo or
 * compressed phase behind a five-day label until the next successful poll.
 * Unknown must stay null so the next source gets a turn.
 */
export function jackpotCompressionTier({
  contractPhase = null,
  gameState = null,
  goldRush = null,
} = {}) {
  const candidates = [
    contractPhase?.compressedFlag,
    goldRush?.phaseClock?.compressedFlag,
    gameState?.compressedJackpotFlag,
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const tier = Number(candidate);
    if (Number.isInteger(tier) && tier >= 0) return tier;
  }
  return 0;
}

/** Fixed achieved pool banked when this level crossed into jackpot phase. */
export function jackpotPrizePoolWei({ gameState = null, ratchets = null } = {}) {
  const pools = gameState?.prizePools || {};
  const candidates = [
    pools.lastPrizePool,
    pools.lastLevelPool,
    gameState?.lastPrizePool,
    gameState?.lastLevelPool,
    // growthState(level).ratchetRound is the write-once achieved pool, unlike
    // currentPrizePool, which shrinks after every jackpot draw.
    ratchets?.current,
  ];
  for (const candidate of candidates) {
    const value = _wei(candidate);
    if (value != null && value > 0n) return value;
  }
  return null;
}

/**
 * Name a reward jackpot only after its target level's purchase pool has closed.
 * BAF/Decimator settle while that level enters jackpot phase, not when the
 * previous level's final jackpot ends. The RNG request promotes `level` before
 * settlement, so a locked final-purchase window already names the target level.
 */
export function transitionJackpotCountdownModel({
  level = null,
  jackpot = false,
  lastPurchaseDay = false,
  rngLocked = false,
} = {}) {
  const current = Number(level);
  if (jackpot || !lastPurchaseDay || !Number.isInteger(current) || current < 0) return null;

  const target = current + (rngLocked ? 0 : 1);
  const mod100 = target % 100;
  const decimator = mod100 === 0 || (target % 10 === 5 && mod100 !== 95);
  const baf = target > 0 && target % 10 === 0;
  if (!decimator && !baf) return null;
  if (decimator && baf) {
    return { kind: 'both', label: 'DECIMATOR + BIG ASS FLIP LOCK IN:', level: target };
  }
  return decimator
    ? { kind: 'decimator', label: 'DECIMATOR DRAWING IN:', level: target }
    : { kind: 'baf', label: 'BIG ASS FLIP LOCKS IN:', level: target };
}

/** Copy used after the countdown's own tracked boundary, before state catches up. */
export function transitionJackpotLockedLabel(kind) {
  if (kind === 'both') return 'DECIMATOR + BIG ASS FLIP LOCKED IN';
  if (kind === 'baf') return 'BIG ASS FLIP LOCKED IN';
  return 'DECIMATOR LOCKED IN';
}

/** Level and phase-day copy formerly rendered as a top-navigation pill. */
export function phaseStripModel({
  gameState = null,
  goldRush = null,
  contractPhase = null,
} = {}) {
  const state = gameState && typeof gameState === 'object'
    ? { ...(goldRush || {}), ...gameState }
    : goldRush || {};
  const phase = String(state?.phase || '').toUpperCase();
  const transition = Boolean(state?.phaseTransitionActive);
  const hasContractPhase = typeof contractPhase?.jackpot === 'boolean';
  const jackpot = hasContractPhase
    ? contractPhase.jackpot
    : phase === 'JACKPOT' && !transition;

  if (jackpot) {
    const level = Number(state?.level);
    const counter = jackpotDrawCounter({
      contractPhase: hasContractPhase ? contractPhase : null,
      gameState: state,
      goldRush,
    });
    const compressedFlag = jackpotCompressionTier({
      contractPhase: hasContractPhase ? contractPhase : null,
      gameState: state,
      goldRush,
    });
    const cadence = jackpotCadenceModel({ counter, compressedFlag });
    return {
      jackpot: true,
      level: Number.isInteger(level) && level >= 0 ? level : null,
      day: cadence.drawNumber,
      dayCap: cadence.drawCount,
      logicalStart: cadence.logicalStart,
      logicalEnd: cadence.logicalEnd,
      dayLabel: `JACKPOT DRAW ${cadence.drawNumber} OF ${cadence.drawCount}`,
    };
  }

  const effectiveState = hasContractPhase
    ? {
      ...state,
      phase: contractPhase.jackpot ? 'JACKPOT' : 'PURCHASE',
      jackpotPhaseFlag: contractPhase.jackpot,
      phaseTransitionActive: false,
    }
    : state;
  const level = activeTicketLevel(
    effectiveState,
    hasContractPhase ? contractPhase : null,
  );
  const chainPurchaseDay = Number(contractPhase?.purchaseDay);
  const hasChainPurchaseDay = hasContractPhase
    && contractPhase.jackpot === false
    && Number.isInteger(chainPurchaseDay)
    && chainPurchaseDay > 0;
  const day = hasChainPurchaseDay ? chainPurchaseDay : null;
  const finalPurchaseDay = contractPhase?.lastPurchaseDay === true;

  return {
    jackpot: false,
    level,
    day,
    dayLabel: `PURCHASE DAY ${day ?? '—'}${finalPurchaseDay ? ' (FINAL)' : ''}`,
  };
}

function _groupWhole(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** displayEth truncates by design; this strip explicitly asks for whole-ETH rounding. */
function _formatWholeEth(raw) {
  const value = _wei(raw);
  if (value == null) return '—';
  const tenths = displayEth(value, 1);
  const [wholeText, fraction = '0'] = tenths.split('.');
  let whole;
  try { whole = BigInt(wholeText || '0'); }
  catch (_e) { return '—'; }
  if (Number(fraction[0] || 0) >= 5) whole += 1n;
  return _groupWhole(whole);
}

function _formatMarkerEth(raw) {
  const value = _wei(raw);
  if (value == null) return '—';
  const [whole, fraction = ''] = displayEth(value, 2).split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${_groupWhole(whole)}${trimmed ? `.${trimmed}` : ''}`;
}

/**
 * The current target keeps its stronger ruler styling after completion, but
 * its tooltip joins the completed-level vocabulary used by every other notch.
 */
export function poolTargetMarkerLabel({ level, targetWei, complete = false } = {}) {
  const levelLabel = level == null ? 'Current level' : `Level ${level}`;
  const target = _wei(targetWei);
  if (complete) {
    return target == null
      ? `${levelLabel} final prize pool`
      : `${levelLabel} final prize pool · ${_formatMarkerEth(target)} ETH`;
  }
  return target == null
    ? `${levelLabel} guarantee`
    : `${levelLabel} guarantee · ${_formatMarkerEth(target)} ETH prize pool`;
}

function _formatGrowth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function _formatBarPercent(value) {
  if (value == null || value === '') return '—%';
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.max(0, Math.round(n))}%` : '—%';
}

class AppPoolProgress extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #countdownTimer = null;
  #specialJackpotClock = null;
  #turboJackpotClock = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    // A stale hot-reload chip must not survive after phase status moved here.
    try { document.getElementById?.('unav-state')?.remove?.(); } catch (_e) { /* defensive */ }
    this.#unsubs.push(
      subscribe('app.gameState', () => this.#render()),
      subscribe('app.goldRush', () => this.#render()),
      subscribe('app.poolBenchmarks', () => this.#render()),
    );
    this.#paintCountdown();
    this.#countdownTimer = setInterval(() => this.#paintCountdown(), 250);
    try { this.#countdownTimer?.unref?.(); } catch (_e) { /* browser timer */ }
  }

  disconnectedCallback() {
    for (const off of this.#unsubs) {
      try { off(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#countdownTimer != null) clearInterval(this.#countdownTimer);
    this.#countdownTimer = null;
    this.#initialized = false;
  }

  #renderShell() {
    this.innerHTML = `
      <section class="pool-progress" data-mode="purchase" aria-label="Level prize pool">
        <header class="pool-progress__head">
          <strong class="pool-progress__day" data-el="pool-day">PURCHASE DAY —</strong>
          <div class="pool-progress__turbo-jackpot" data-el="pool-turbo-jackpot" hidden>
            <span>TURBO JACKPOT IN</span>
            <strong data-el="pool-turbo-jackpot-countdown">--:--</strong>
            <i aria-hidden="true">·</i>
            <span class="pool-progress__turbo-jackpot-prize">
              GRAND PRIZE: UP TO <strong data-el="pool-turbo-jackpot-prize">—</strong> <em>ETH</em>
            </span>
          </div>
          <div class="pool-progress__special-jackpot" data-el="pool-special-jackpot" hidden>
            <span data-el="pool-special-jackpot-label">NEXT JACKPOT IN:</span>
            <strong data-el="pool-special-jackpot-countdown">--:--</strong>
          </div>
        </header>
        <div class="pool-progress__body">
          <strong class="pool-progress__name" data-el="pool-name">LEVEL — PRIZE POOL</strong>
          <div class="pool-progress__track" data-el="pool-track"
               role="progressbar" aria-label="Level prize pool progress"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <span class="pool-progress__fill" data-el="pool-fill"></span>
            <span class="pool-progress__history" data-el="pool-history-markers"
                  aria-label="Prior level final prize pools"></span>
            <span class="pool-progress__marker pool-progress__marker--target"
                  data-el="pool-target-marker" title="Level guarantee" tabindex="0"></span>
            <span class="pool-progress__marker pool-progress__marker--growth"
                  data-el="pool-growth-marker" title="Over/under growth target" tabindex="0"></span>
            <span class="pool-progress__marker-label" data-el="pool-reference-label">
              <small data-el="pool-reference-kind">GUARANTEE</small>
              <strong data-el="pool-target-inline">—</strong>
              <em>ETH</em>
            </span>
            <strong class="pool-progress__percent" data-el="pool-percent">—%</strong>
          </div>
        </div>
        <div class="pool-progress__jackpot" data-el="pool-jackpot-summary" hidden>
          <span class="pool-progress__jackpot-context">
            <strong class="pool-progress__jackpot-phase pool-progress__jackpot-phase--full">JACKPOT PHASE</strong>
            <strong class="pool-progress__jackpot-phase pool-progress__jackpot-phase--compact">JP</strong>
            <span>DRAW <strong data-el="pool-jackpot-day">—/—</strong></span>
          </span>
          <span class="pool-progress__jackpot-pool">
            <span class="pool-progress__jackpot-pool-label">LEVEL <strong data-el="pool-jackpot-level">—</strong> PRIZE POOL :</span>
            <span class="pool-progress__jackpot-amount"><strong data-el="pool-jackpot-pool">—</strong> <em>ETH</em></span>
          </span>
          <span class="pool-progress__jackpot-tail">
            <span class="pool-progress__jackpot-next">
              <span class="pool-progress__jackpot-copy--full">NEXT JACKPOT IN:</span>
              <span class="pool-progress__jackpot-copy--compact">NEXT JP</span>
              <strong data-el="pool-jackpot-countdown">--:--</strong>
            </span>
            <i aria-hidden="true">·</i>
            <span class="pool-progress__jackpot-win">
              <span class="pool-progress__jackpot-copy--full" data-el="pool-jackpot-win-label-full">WIN UP TO</span>
              <span class="pool-progress__jackpot-copy--compact" data-el="pool-jackpot-win-label-compact">UP TO</span>
              <strong data-el="pool-jackpot-win">—</strong> <em>ETH</em>
            </span>
          </span>
        </div>
        <span class="pool-progress__status" data-el="pool-status" aria-live="polite"></span>
      </section>
    `;
  }

  #set(name, value) {
    const element = this.querySelector(`[data-el="${name}"]`);
    if (element) element.textContent = String(value);
    return element;
  }

  #paintCountdown() {
    const countdown = formatJackpotCountdown(secondsUntilDayCrossover());
    this.#set('pool-jackpot-countdown', countdown);
    const turboJackpot = this.querySelector('[data-el="pool-turbo-jackpot"]');
    const poolDay = this.querySelector('[data-el="pool-day"]');
    if (turboJackpot && !turboJackpot.hidden && this.#turboJackpotClock != null) {
      const turboRemaining = Math.max(
        0,
        Math.ceil((this.#turboJackpotClock.deadlineMs - Date.now()) / 1000),
      );
      if (turboRemaining <= 0) {
        turboJackpot.hidden = true;
        if (poolDay) {
          poolDay.textContent = 'PURCHASE DAY 1';
          poolDay.hidden = false;
        }
        turboJackpot.removeAttribute('aria-label');
      } else {
        const rendered = formatJackpotCountdown(turboRemaining);
        this.#set('pool-turbo-jackpot-countdown', rendered);
        turboJackpot.setAttribute(
          'aria-label',
          `Turbo jackpot in ${rendered}; grand prize up to ${this.querySelector('[data-el="pool-turbo-jackpot-prize"]')?.textContent || '—'} ETH`,
        );
      }
    }
    const special = this.querySelector('[data-el="pool-special-jackpot"]');
    const specialLabel = this.querySelector('[data-el="pool-special-jackpot-label"]');
    const specialCountdown = this.querySelector('[data-el="pool-special-jackpot-countdown"]');
    if (special && !special.hidden) {
      const clock = this.#specialJackpotClock;
      const remaining = clock == null
        ? secondsUntilDayCrossover()
        : Math.max(0, Math.ceil((clock.deadlineMs - Date.now()) / 1000));
      const locked = clock != null && remaining <= 0;
      if (locked) {
        const label = transitionJackpotLockedLabel(clock.kind);
        if (specialLabel) specialLabel.textContent = label;
        if (specialCountdown) {
          specialCountdown.textContent = '';
          specialCountdown.hidden = true;
        }
        special.setAttribute('data-locked', 'true');
        special.setAttribute('aria-label', label);
      } else {
        const rendered = formatJackpotCountdown(remaining);
        const label = clock?.label || specialLabel?.textContent || 'Special jackpot in:';
        if (specialLabel) specialLabel.textContent = label;
        if (specialCountdown) {
          specialCountdown.textContent = rendered;
          specialCountdown.hidden = false;
        }
        special.removeAttribute('data-locked');
        special.setAttribute('aria-label', `${label.replace(/:$/, '')} ${rendered}`);
      }
    }
  }

  #setMarker(name, position, title) {
    const marker = this.querySelector(`[data-el="${name}"]`);
    if (!marker) return;
    marker.hidden = position == null;
    if (marker.style && position != null) marker.style.left = `${position}%`;
    marker.title = title;
    marker.tabIndex = position == null ? -1 : 0;
    marker.setAttribute('aria-label', title);
  }

  #renderHistoryMarkers(markers) {
    const host = this.querySelector('[data-el="pool-history-markers"]');
    if (!host) return;
    host.textContent = '';
    const rows = Array.isArray(markers)
      ? markers.filter((row) => row?.position != null)
      : [];
    host.hidden = rows.length === 0;
    host.setAttribute('aria-hidden', rows.length === 0 ? 'true' : 'false');
    for (const row of rows) {
      const marker = document.createElement('span');
      marker.className = [
        'pool-progress__marker',
        'pool-progress__marker--history',
        row.kind === 'previous' ? 'pool-progress__marker--history-previous' : '',
        row.kind === 'start' ? 'pool-progress__marker--history-start' : '',
      ].filter(Boolean).join(' ');
      marker.dataset.level = String(row.level);
      marker.dataset.kind = String(row.kind || 'interval');
      marker.style.left = `${row.position}%`;
      const prefix = row.kind === 'previous' ? 'Previous level' : `Level ${row.level}`;
      const label = `${prefix} final prize pool · ${_formatMarkerEth(row.poolWei)} ETH`;
      marker.title = label;
      marker.tabIndex = 0;
      marker.setAttribute('aria-label', label);
      host.appendChild(marker);
    }
  }

  #render() {
    const gameState = get('app.gameState');
    const goldRush = get('app.goldRush');
    const benchmarks = get('app.poolBenchmarks');
    const chainPhase = goldRush?.phaseClock || null;
    const chainLevel = Number(chainPhase?.level);
    // During a transition the direct chain ticker can lead /game/state. Match
    // benchmarks against that newer level so an old target cannot repaint the
    // newly promoted pool during the indexer's brief catch-up window.
    const stateLevel = Number(Number.isInteger(chainLevel)
      ? chainLevel
      : gameState?.level ?? goldRush?.level);
    const benchmarkLevel = Number(benchmarks?.level);
    const sameLevel = !Number.isInteger(stateLevel)
      || (Number.isInteger(benchmarkLevel) && benchmarkLevel === stateLevel);
    const benchmarkTargetWei = sameLevel ? benchmarks?.targetWei : null;
    const ratchets = sameLevel ? benchmarks?.ratchets : null;
    const history = sameLevel ? benchmarks?.history : null;
    const benchmarkPhase = sameLevel ? benchmarks?.contractPhase : null;
    const contractPhase = chainPhase || benchmarkPhase;
    const phaseGameState = Number.isInteger(chainLevel)
      ? {
        ...(gameState || {}),
        level: chainLevel,
        jackpotPhaseFlag: chainPhase.jackpot === true,
        phase: chainPhase.gameOver
          ? 'GAMEOVER'
          : chainPhase.jackpot ? 'JACKPOT' : 'PURCHASE',
        phaseTransitionActive: chainPhase.transition === true,
      }
      : gameState;
    const phase = phaseStripModel({
      gameState: phaseGameState,
      goldRush,
      contractPhase,
    });
    const thermometer = prizePoolThermometerContext({
      phaseLevel: phase.level,
      benchmarkLevel: sameLevel ? benchmarkLevel : null,
      targetWei: benchmarkTargetWei,
      ratchets,
      contractPhase,
    });
    const poolLevel = phase.jackpot ? phase.level : thermometer.level;
    const targetWei = prizePoolTargetForLevel(poolLevel, thermometer.targetWei);
    const shell = this.querySelector('.pool-progress');
    const head = this.querySelector('.pool-progress__head');
    const body = this.querySelector('.pool-progress__body');
    const jackpotSummary = this.querySelector('[data-el="pool-jackpot-summary"]');
    const track = this.querySelector('[data-el="pool-track"]');
    const fill = this.querySelector('[data-el="pool-fill"]');
    const poolDay = this.querySelector('[data-el="pool-day"]');
    const turboJackpot = this.querySelector('[data-el="pool-turbo-jackpot"]');
    const specialJackpot = this.querySelector('[data-el="pool-special-jackpot"]');
    const nextWei = goldRush?.components?.nextWei
      ?? gameState?.prizePools?.nextPrizePool
      ?? null;
    const purchaseModel = poolProgressModel({
      nextWei,
      targetWei,
      ratchets,
      history,
      currentLevel: poolLevel,
    });
    const turboCandidate = purchaseTurboJackpotModel({
      level: poolLevel,
      purchaseDay: phase.day,
      levelReady: !phase.jackpot && purchaseModel.levelReady,
      nextWei,
    });
    if (turboCandidate) {
      const clockKey = `turbo:${turboCandidate.level}`;
      if (this.#turboJackpotClock?.key !== clockKey) {
        this.#turboJackpotClock = {
          key: clockKey,
          deadlineMs: Date.now() + (secondsUntilDayCrossover() * 1000),
        };
      }
    } else {
      this.#turboJackpotClock = null;
    }
    const turboActive = turboCandidate != null
      && this.#turboJackpotClock != null
      && this.#turboJackpotClock.deadlineMs > Date.now();
    const exactLevel = contractPhase?.level == null ? null : Number(contractPhase.level);
    const rewardJackpot = transitionJackpotCountdownModel({
      level: Number.isInteger(exactLevel) ? exactLevel : stateLevel,
      jackpot: phase.jackpot,
      lastPurchaseDay: contractPhase?.lastPurchaseDay === true,
      rngLocked: typeof contractPhase?.rngLocked === 'boolean'
        ? contractPhase.rngLocked
        : gameState?.rngLockedFlag === true,
    });
    if (rewardJackpot) {
      const clockKey = `${rewardJackpot.kind}:${rewardJackpot.level}`;
      if (this.#specialJackpotClock?.key !== clockKey) {
        this.#specialJackpotClock = {
          key: clockKey,
          kind: rewardJackpot.kind,
          label: rewardJackpot.label,
          deadlineMs: Date.now() + (secondsUntilDayCrossover() * 1000),
        };
      }
    } else {
      this.#specialJackpotClock = null;
    }

    this.#set(
      'pool-day',
      turboCandidate != null && !turboActive ? 'PURCHASE DAY 1' : phase.dayLabel,
    );
    if (poolDay) poolDay.hidden = turboActive;
    this.#set('pool-name', poolLevel == null
      ? phase.jackpot ? 'DAILY JACKPOT' : 'PRIZE POOL'
      : `LEVEL ${poolLevel} ${phase.jackpot ? 'DAILY JACKPOT' : 'PRIZE POOL'}`);
    shell?.setAttribute('data-mode', phase.jackpot ? 'jackpot' : 'purchase');

    if (phase.jackpot) {
      this.#renderHistoryMarkers([]);
      if (head) head.hidden = true;
      if (body) body.hidden = true;
      if (jackpotSummary) jackpotSummary.hidden = false;
      if (poolDay) poolDay.hidden = false;
      if (turboJackpot) {
        turboJackpot.hidden = true;
        turboJackpot.removeAttribute('aria-label');
      }
      const currentWei = goldRush?.components?.currentWei
        ?? gameState?.prizePools?.currentPrizePool
        ?? null;
      const fixedPoolWei = jackpotPrizePoolWei({ gameState, ratchets });
      const model = jackpotPoolModel({
        currentWei,
        baselineWei: fixedPoolWei,
        counter: jackpotDrawCounter({ contractPhase, gameState, goldRush }),
        compressedFlag: jackpotCompressionTier({ contractPhase, gameState, goldRush }),
      });
      if (specialJackpot) {
        specialJackpot.hidden = true;
        specialJackpot.removeAttribute('data-kind');
        specialJackpot.removeAttribute('data-locked');
        specialJackpot.removeAttribute('aria-label');
      }
      this.#set('pool-jackpot-level', phase.level ?? '—');
      this.#set('pool-jackpot-pool', _formatWholeEth(fixedPoolWei));
      this.#set('pool-jackpot-day', `${phase.day ?? '—'}/${phase.dayCap ?? '—'}`);
      this.#set('pool-jackpot-win-label-full', model.finalDraw ? 'GRAND PRIZE:' : 'WIN UP TO');
      this.#set('pool-jackpot-win-label-compact', model.finalDraw ? 'GRAND PRIZE:' : 'UP TO');
      this.#set('pool-jackpot-win', _formatWholeEth(model.maxWinWei));
      this.#set('pool-status', model.maxWinWei == null
        ? 'Loading jackpot pool'
        : model.finalDraw
          ? `Level ${phase.level ?? '—'} final jackpot draw ${phase.day ?? '—'} of ${phase.dayCap ?? '—'}${model.drawStart === model.drawEnd ? '' : ` (logical days ${model.drawStart}–${model.drawEnd})`}; grand prize ${_formatWholeEth(model.maxWinWei)} ETH`
          : `Level ${phase.level ?? '—'} jackpot draw ${phase.day ?? '—'} of ${phase.dayCap ?? '—'}${model.drawStart === model.drawEnd ? '' : ` (logical days ${model.drawStart}–${model.drawEnd})`}; maximum next win ${_formatWholeEth(model.maxWinWei)} ETH`);
      return;
    }

    if (head) head.hidden = false;
    if (body) body.hidden = false;
    if (jackpotSummary) jackpotSummary.hidden = true;
    if (turboJackpot) {
      turboJackpot.hidden = !turboActive;
      if (turboCandidate) {
        this.#set('pool-turbo-jackpot-prize', _formatWholeEth(turboCandidate.grandPrizeWei));
      }
      if (!turboActive) turboJackpot.removeAttribute('aria-label');
    }
    if (specialJackpot) {
      specialJackpot.hidden = rewardJackpot == null || turboCandidate != null;
      if (rewardJackpot && turboCandidate == null) {
        specialJackpot.dataset.kind = rewardJackpot.kind;
        specialJackpot.setAttribute(
          'aria-label',
          `${rewardJackpot.label.replace(/:$/, '')} ${this.querySelector('[data-el="pool-special-jackpot-countdown"]')?.textContent || ''}`.trim(),
        );
      } else {
        specialJackpot.removeAttribute('data-kind');
        specialJackpot.removeAttribute('data-locked');
        specialJackpot.removeAttribute('aria-label');
      }
    }
    if (rewardJackpot && turboCandidate == null) {
      this.#set('pool-special-jackpot-label', rewardJackpot.label);
    }
    this.#paintCountdown();
    const model = purchaseModel;
    const referenceKind = this.#set(
      'pool-reference-kind',
      model.levelReady ? 'CURRENT' : 'GUARANTEE',
    );
    if (referenceKind) referenceKind.hidden = model.levelReady;
    this.#set('pool-target-inline', _formatWholeEth(model.referenceWei));
    const percent = this.#set('pool-percent', _formatBarPercent(model.levelPercent));
    if (percent) percent.hidden = model.levelReady;
    if (fill?.style) {
      fill.style.width = `${model.fillPercent}%`;
      const span = model.targetPercent != null && model.fillPercent > 0 && !model.levelReady
        ? Math.max(100, (model.targetPercent / model.fillPercent) * 100)
        : 100;
      fill.style.backgroundSize = `${span}% 100%`;
    }
    const levelLabel = poolLevel == null ? 'Current level' : `Level ${poolLevel}`;
    this.#setMarker('pool-target-marker', model.targetPercent, poolTargetMarkerLabel({
      level: poolLevel,
      targetWei: model.target,
      complete: model.levelReady,
    }));
    this.#setMarker('pool-growth-marker', model.growthPercent,
      model.growthTarget == null
        ? `${levelLabel} growth O/U`
        : `${levelLabel} growth O/U · ${_formatMarkerEth(model.growthTarget)} ETH prize pool (${_formatGrowth(model.growthLinePercent)} line)`);
    this.#renderHistoryMarkers(model.historyMarkers);
    const referenceLabel = this.querySelector('[data-el="pool-reference-label"]');
    if (referenceLabel) {
      referenceLabel.hidden = model.referencePercent == null;
      if (referenceLabel.style && model.referencePercent != null) {
        referenceLabel.style.left = `${model.referencePercent}%`;
      }
      if (referenceLabel.dataset) {
        referenceLabel.dataset.edge = model.referencePercent == null
          ? 'middle'
          : model.referencePercent >= 90
            ? 'right'
            : model.referencePercent <= 10
              ? 'left'
              : 'middle';
      }
      referenceLabel.title = model.referenceWei == null
        ? 'Prize pool amount'
        : `${model.referenceKind === 'CURRENT' ? 'Current prize pool' : 'Level guarantee'}: ${_formatWholeEth(model.referenceWei)} ETH`;
    }
    if (track) {
      const aria = model.levelPercent == null ? 0 : Math.round(_clampPercent(model.levelPercent));
      track.setAttribute('aria-valuenow', String(aria));
      track.setAttribute('aria-valuetext', model.levelPercent == null
        ? 'Prize pool guarantee loading'
        : `${_formatBarPercent(model.levelPercent)} of the level guarantee`);
      track.classList?.remove('is-depleting');
      track.classList?.toggle('is-ready', model.levelReady);
      track.classList?.toggle('is-over-growth', model.growthOver);
    }
    this.#set('pool-status', model.levelReady
      ? `Level guarantee met; current prize pool ${_formatWholeEth(model.next)} ETH`
      : model.target == null || model.next == null
        ? 'Loading prize pool guarantee'
        : `${_formatBarPercent(model.levelPercent)} of guarantee`);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-pool-progress')) {
  customElements.define('app-pool-progress', AppPoolProgress);
}

export const _testing = {
  formatWholeEth: _formatWholeEth,
  formatGrowth: _formatGrowth,
};

export default AppPoolProgress;
