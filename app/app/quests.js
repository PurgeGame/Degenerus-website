// Live quest reads. Quest progress is deployment-local contract state, so the
// active board must not be reconstructed from database rows that may survive a
// redeploy at the same deterministic player addresses.

import { ethers, getProvider } from './contracts.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { sharedReadProvider } from './read-provider.js';

const QUESTS_ABI = [
  'function getPlayerQuestView(address player) view returns (((uint24 day,uint8 questType,bool highDifficulty,(uint32 mints,uint256 tokenAmount) requirements)[2] quests,uint128[2] progress,bool[2] completed,uint24 lastCompletedDay,uint32 baseStreak) viewData)',
  'function getPlayerLevelQuestView(address player) view returns (uint8 questType,uint128 progress,uint256 target,bool completed,bool eligible)',
  'function playerQuestStates(address player) view returns (uint32 streak,uint24 lastCompletedDay,uint128[2] progress,bool[2] completed)',
  'function effectiveBaseStreakAndAfking(address player) view returns (uint32 streak,bool afking)',
  'function shieldsOf(address player) view returns (uint8 shields,uint8 centuryHighWater)',
];

const GAME_QUEST_CONTEXT_ABI = [
  // This is the score actually consumed by the current deployment. In
  // particular, it already folds in the Game-side afKing streak and deity
  // pass, neither of which can be reconstructed reliably from a missing
  // /player row.
  'function playerActivityScore(address player) view returns (uint256 scorePoints)',
  'function hasDeityPass(address player) view returns (bool)',
  'function subInfo(address player) view returns (bool active,uint8 dailyQuantity,uint24 afkingStartDay,uint24 afkCoveredThroughDay)',
];

// DegenerusGameLens is read-only periphery that decodes the packed Sub record
// GAME.subInfo only partially exposes. `effectiveStreak` is the unified value —
// it mirrors DegenerusGameStorage._effectiveQuestStreak exactly, so it is the
// same number playerActivityScore() consumes: the afKing compute-on-read
// (streak latch + funded delivered days) for a live subscriber, and the manual
// quest streak for everyone else. It also applies the contract's own decay
// gate, returning 0 once a playable full day passed with no funded delivery
// while correctly NOT decaying across a pending unadvanced gap — a distinction
// no client-side freshness heuristic can make.
// Declared as the single struct the contract actually returns, not as flattened
// return values. Both decode the same today (every member is static), but the
// struct form stays correct if SubFull ever gains a dynamic member.
const GAME_LENS_ABI = [
  'function subInfoFull(address game,address player) view returns (('
    + 'bool active,uint8 dailyQuantity,uint8 flags,uint16 score,uint24 amountMilliEth,'
    + 'uint24 lastAutoBoughtDay,uint24 lastOpenedDay,uint24 afkCoveredThroughDay,'
    + 'uint24 afkingStartDay,uint32 affiliateBase,uint24 pendingFlip,'
    + 'uint16 subStreakLatch,uint32 effectiveStreak) s)',
  'function activityScoreBreakdown(address game,address player) view returns (('
    + 'uint256 total,uint32 questStreak,uint256 questStreakPoints,bool deityPass,'
    + 'uint256 mintStreakPoints,uint256 mintCountPoints,uint256 affiliatePoints,'
    + 'uint256 passBonusPoints,uint256 cursePoints) b)',
];

let _contractFactory = null;
let _gameContractFactory = null;
let _lensContractFactory = null;
let _publicProvider = null;

export function __setQuestContractFactoryForTest(factory) {
  _contractFactory = factory;
}

export function __setQuestGameContractFactoryForTest(factory) {
  _gameContractFactory = factory;
}

export function __setQuestLensContractFactoryForTest(factory) {
  _lensContractFactory = factory;
}

export function __resetQuestContractFactoryForTest() {
  _contractFactory = null;
  _gameContractFactory = null;
  _lensContractFactory = null;
}

function _readProvider() {
  const walletProvider = getProvider();
  if (walletProvider) return walletProvider;
  // Real browsers without an injected wallet still need an honest public
  // quest board. Fake-DOM tests intentionally do not expose window.fetch.
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return null;
  if (!_publicProvider) {
    _publicProvider = sharedReadProvider();  // C15: shared batched read stream
  }
  return _publicProvider;
}

function _contract(provider) {
  return _contractFactory
    ? _contractFactory(provider)
    : new ethers.Contract(CONTRACTS.QUESTS, QUESTS_ABI, provider);
}

function _gameContract(provider) {
  return _gameContractFactory
    ? _gameContractFactory(provider)
    : new ethers.Contract(CONTRACTS.GAME, GAME_QUEST_CONTEXT_ABI, provider);
}

// The lens is deployment-decoupled periphery (it takes the game address per
// call), but it bakes QUESTS and DEPLOY_DAY_BOUNDARY as compile-time
// constants, so a redeploy ships a new one. db/sync-deployment.mjs keeps
// CONTRACTS.GAME_LENS in step with the manifest; a profile that has not
// deployed one yet leaves it null and the afKing streak falls back.
function _lensContract(provider) {
  if (_lensContractFactory) return _lensContractFactory(provider);
  if (!CONTRACTS.GAME_LENS) return null;
  return new ethers.Contract(CONTRACTS.GAME_LENS, GAME_LENS_ABI, provider);
}

function _safeWholeNumber(value) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(parsed);
  } catch (_e) {
    return null;
  }
}

function _decodeActivityBreakdown(value) {
  if (value == null) return null;
  const totalBps = _safeWholeNumber(_value(value, 'total', 0, null));
  const questStreakPoints = _safeWholeNumber(_value(value, 'questStreak', 1, null));
  const questStreakCreditedPoints = _safeWholeNumber(
    _value(value, 'questStreakPoints', 2, null),
  );
  const mintLevelStreakPoints = _safeWholeNumber(_value(value, 'mintStreakPoints', 4, null));
  const mintCountPoints = _safeWholeNumber(_value(value, 'mintCountPoints', 5, null));
  const affiliatePoints = _safeWholeNumber(_value(value, 'affiliatePoints', 6, null));
  const passBonusPoints = _safeWholeNumber(_value(value, 'passBonusPoints', 7, null));
  const cursePoints = _safeWholeNumber(_value(value, 'cursePoints', 8, null));
  const numbers = [
    totalBps,
    questStreakPoints,
    questStreakCreditedPoints,
    mintLevelStreakPoints,
    mintCountPoints,
    affiliatePoints,
    passBonusPoints,
    cursePoints,
  ];
  if (numbers.some((number) => number == null)) return null;
  if (questStreakCreditedPoints !== Math.floor(questStreakPoints / 2)) return null;

  // The lens mirrors GAME storage directly. Refuse a stale-layout lens unless
  // every mirrored component reconciles with GAME's authoritative total.
  const uncapped = mintLevelStreakPoints
    + mintCountPoints
    + questStreakCreditedPoints
    + affiliatePoints
    + passBonusPoints
    - cursePoints;
  const expectedTotal = Math.min(65_534, Math.max(0, uncapped));
  if (expectedTotal !== totalBps) return null;

  const deityPass = Boolean(_value(value, 'deityPass', 3, false));
  const passKind = deityPass
    ? 'deity'
    : passBonusPoints === 40 ? 'whale_100'
      : passBonusPoints === 10 ? 'whale_10'
        : null;
  return {
    totalBps,
    questStreakPoints,
    questStreakCreditedPoints,
    mintLevelStreakPoints,
    mintCountPoints,
    affiliatePoints,
    passBonus: passKind ? { kind: passKind, points: passBonusPoints } : null,
    cursePoints,
    deityPass,
    liveExact: true,
  };
}

async function _readGameQuestContext(provider, player, overrides) {
  const game = _gameContract(provider);
  const lens = _lensContract(provider);
  const [scoreRead, deityRead, subRead, lensRead, breakdownRead] = await Promise.allSettled([
    game.playerActivityScore(player, overrides),
    game.hasDeityPass(player, overrides),
    game.subInfo(player, overrides),
    lens
      ? lens.subInfoFull(CONTRACTS.GAME, player, overrides)
      : Promise.reject(new Error('no lens')),
    lens && typeof lens.activityScoreBreakdown === 'function'
      ? lens.activityScoreBreakdown(CONTRACTS.GAME, player, overrides)
      : Promise.reject(new Error('no activity breakdown lens')),
  ]);
  const sub = subRead.status === 'fulfilled' ? subRead.value : null;
  const lensSub = lensRead.status === 'fulfilled' ? lensRead.value : null;
  const activityBreakdown = breakdownRead.status === 'fulfilled'
    ? _decodeActivityBreakdown(breakdownRead.value)
    : null;
  return {
    activityScore: activityBreakdown?.totalBps
      ?? (scoreRead.status === 'fulfilled' ? _safeWholeNumber(scoreRead.value) : null),
    hasDeityPass: activityBreakdown?.deityPass
      ?? (deityRead.status === 'fulfilled' ? Boolean(deityRead.value) : null),
    activityBreakdown,
    sub: sub == null ? null : {
      active: Boolean(_value(sub, 'active', 0, false)),
      startDay: Number(_value(sub, 'afkingStartDay', 2, 0)),
      coveredThroughDay: Number(_value(sub, 'afkCoveredThroughDay', 3, 0)),
    },
    lensSub: lensSub == null ? null : {
      startDay: Number(_value(lensSub, 'afkingStartDay', 8, 0)),
      coveredThroughDay: Number(_value(lensSub, 'afkCoveredThroughDay', 7, 0)),
      effectiveStreak: Number(_value(lensSub, 'effectiveStreak', 12, 0)),
    },
  };
}

function _value(record, name, index, fallback = null) {
  return record?.[name] ?? record?.[index] ?? fallback;
}

function _targetFor(quest) {
  const requirements = _value(quest, 'requirements', 3, null);
  const mints = BigInt(_value(requirements, 'mints', 0, 0));
  const tokenAmount = BigInt(_value(requirements, 'tokenAmount', 1, 0));
  return mints > 0n ? mints : tokenAmount;
}

/**
 * Read the complete active quest board at one block.
 * @returns {Promise<{day:number, quests:Array, questStreak:Object,
 *   levelQuest:Object, afkingActive:boolean, effectiveQuestStreak:number,
 *   effectiveQuestStreakExact:boolean,
 *   activityScore:number|null, hasDeityPass:boolean|null, shields:number,
 *   blockNumber:number}>}
 */
export async function readLiveQuestBoard(player) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(player || ''))) {
    throw new Error('A valid player address is required to read quests.');
  }
  const provider = _readProvider();
  if (!provider) throw new Error('Quest contract provider unavailable.');
  const blockNumber = await provider.getBlockNumber();
  const overrides = { blockTag: blockNumber };
  const contract = _contract(provider);
  const [daily, level, currentState, effective, shieldResult, gameContext] = await Promise.all([
    contract.getPlayerQuestView(player, overrides),
    contract.getPlayerLevelQuestView(player, overrides),
    contract.playerQuestStates(player, overrides),
    contract.effectiveBaseStreakAndAfking(player, overrides),
    // `shieldsOf` is present in the newest source tree but was not included in
    // the deployed QUESTS ABI for this run. It is supplementary display data,
    // so a missing selector must never reject the daily + level quest board.
    Promise.resolve()
      .then(() => contract.shieldsOf(player, overrides))
      .then((value) => ({ ok: true, value }))
      .catch(() => ({ ok: false, value: null })),
    // Score/pass/subscriber context is supplemental. The daily quest board must
    // remain usable during a rolling deploy where one of these GAME selectors
    // is temporarily unavailable.
    _readGameQuestContext(provider, player, overrides).catch(() => ({
      activityScore: null,
      hasDeityPass: null,
      sub: null,
      lensSub: null,
    })),
  ]);
  const shieldState = shieldResult?.ok ? shieldResult.value : null;

  const definitions = _value(daily, 'quests', 0, []);
  const progress = _value(daily, 'progress', 1, []);
  const completed = _value(daily, 'completed', 2, []);
  const quests = Array.from({ length: 2 }, (_, slot) => {
    const definition = definitions?.[slot] || null;
    return {
      day: Number(_value(definition, 'day', 0, 0)),
      slot,
      questType: Number(_value(definition, 'questType', 1, 0)),
      progress: BigInt(progress?.[slot] ?? 0).toString(),
      target: _targetFor(definition).toString(),
      completed: Boolean(completed?.[slot]),
    };
  });
  const day = quests.find((quest) => quest.day > 0)?.day || 0;
  const rawManualStreak = Number(_value(currentState, 'streak', 0,
    _value(daily, 'baseStreak', 4, 0)));
  const decayAwareStreak = Number(_value(effective, 'streak', 0,
    _value(daily, 'baseStreak', 4, rawManualStreak)));
  const afkingActive = Boolean(_value(effective, 'afking', 1, false));

  // Before the first write of a new quest day, playerQuestStates.streak can be
  // a stale pre-lapse high-water mark. Once today's progress/completion exists,
  // the write path has synchronized the reset and rawManualStreak also includes
  // the streak earned today. This keeps a dormant 1 from surviving a real reset
  // without hiding today's newly earned 1/2.
  const hasCurrentDayQuestState = quests.some((quest) => {
    if (quest.completed) return true;
    try { return BigInt(quest.progress) > 0n; } catch (_e) { return false; }
  });
  const manualStreak = hasCurrentDayQuestState ? rawManualStreak : decayAwareStreak;

  // During an afKing run the Quest contract intentionally freezes its manual
  // counter, so the live streak has to come from the Game-side Sub record.
  //
  // Take the lens's `effectiveStreak` only when its Sub fields agree with GAME's
  // own subInfo at the same block. Both ultimately read this GAME's storage, so
  // this does not detect a lens left over from a previous run (that would only
  // corrupt `effectiveStreak`, via the QUESTS/DEPLOY_DAY_BOUNDARY it bakes in) —
  // what it does catch is a lens compiled against a DIFFERENT storage layout,
  // which is the failure the old hardcoded slot-53 decode was exposed to.
  // Address freshness is db/sync-deployment.mjs's job, not this check's.
  //
  // A zero is the contract's own decay gate firing, not a read failure. Accept
  // it as exact instead of reviving a stale manual/indexed high-water mark. If
  // the lens is unavailable entirely, leaving this inexact lets the panel use
  // the indexed /player streak as a fallback.
  let effectiveQuestStreak = manualStreak;
  let effectiveQuestStreakExact = !afkingActive;
  const sub = gameContext?.sub;
  const lensSub = gameContext?.lensSub;
  const scoreStreak = gameContext?.activityBreakdown?.questStreakPoints;
  if (afkingActive && Number.isFinite(scoreStreak) && scoreStreak >= 0) {
    // The parity-checked score breakdown exposes the exact unified streak GAME
    // consumed, even if the older Sub-only lens call is unavailable.
    effectiveQuestStreak = scoreStreak;
    effectiveQuestStreakExact = true;
  } else if (afkingActive && sub?.active && sub.startDay > 0
    && sub.coveredThroughDay >= sub.startDay
    && lensSub
    && lensSub.startDay === sub.startDay
    && lensSub.coveredThroughDay === sub.coveredThroughDay
    && Number.isFinite(lensSub.effectiveStreak)
    && lensSub.effectiveStreak >= 0) {
    effectiveQuestStreak = lensSub.effectiveStreak;
    effectiveQuestStreakExact = true;
  }
  const scoreQuestStreak = Number.isFinite(scoreStreak)
    ? scoreStreak
    : !afkingActive ? decayAwareStreak
      : effectiveQuestStreakExact ? effectiveQuestStreak
        : null;

  return {
    day,
    quests,
    questStreak: {
      // getPlayerQuestView.baseStreak is intentionally frozen at the start of
      // the day for reward math. The chip is the player's current earned
      // streak, so use playerQuestStates.streak (which includes completions
      // made today) instead of leaving the display one or more credits behind.
      baseStreak: manualStreak,
      lastCompletedDay: Number(_value(currentState, 'lastCompletedDay', 1,
        _value(daily, 'lastCompletedDay', 3, 0))),
    },
    levelQuest: {
      questType: Number(_value(level, 'questType', 0, 0)),
      progress: BigInt(_value(level, 'progress', 1, 0)).toString(),
      target: BigInt(_value(level, 'target', 2, 0)).toString(),
      completed: Boolean(_value(level, 'completed', 3, false)),
      eligible: Boolean(_value(level, 'eligible', 4, false)),
      progressAvailable: true,
    },
    afkingActive,
    effectiveQuestStreak,
    effectiveQuestStreakExact,
    scoreQuestStreak,
    activityScore: gameContext?.activityScore ?? null,
    activityBreakdown: gameContext?.activityBreakdown ?? null,
    hasDeityPass: gameContext?.hasDeityPass ?? null,
    shields: Number(_value(shieldState, 'shields', 0, 0)),
    blockNumber,
  };
}
