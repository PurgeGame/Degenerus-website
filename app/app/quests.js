// Live quest reads. Quest progress is deployment-local contract state, so the
// active board must not be reconstructed from database rows that may survive a
// redeploy at the same deterministic player addresses.

import { ethers, getProvider } from './contracts.js';
import { CHAIN, CONTRACTS } from './chain-config.js';

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

// Current DegenerusGame storage layout: `_subOf` is the address mapping at
// slot 53 and each Sub occupies one packed word. `subInfo` deliberately omits
// the streak latch, so an active afKing subscriber needs this one read to show
// the same effective streak that playerActivityScore() uses. This is pinned to
// the active deployment profile, just like the raw decimator reads.
const GAME_SUB_ROOT_SLOT = 53n;
const SUB_COVERED_SHIFT = 104n;
const SUB_START_SHIFT = 128n;
const SUB_STREAK_SHIFT = 208n;
const MASK_16 = (1n << 16n) - 1n;
const MASK_24 = (1n << 24n) - 1n;

let _contractFactory = null;
let _gameContractFactory = null;
let _storageReader = null;
let _publicProvider = null;

export function __setQuestContractFactoryForTest(factory) {
  _contractFactory = factory;
}

export function __setQuestGameContractFactoryForTest(factory) {
  _gameContractFactory = factory;
}

export function __setQuestStorageReaderForTest(reader) {
  _storageReader = reader;
}

export function __resetQuestContractFactoryForTest() {
  _contractFactory = null;
  _gameContractFactory = null;
  _storageReader = null;
}

function _readProvider() {
  const walletProvider = getProvider();
  if (walletProvider) return walletProvider;
  // Real browsers without an injected wallet still need an honest public
  // quest board. Fake-DOM tests intentionally do not expose window.fetch.
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return null;
  if (!_publicProvider) {
    _publicProvider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.id, { staticNetwork: true });
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

function _safeWholeNumber(value) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(parsed);
  } catch (_e) {
    return null;
  }
}

function _subStorageSlot(player) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(coder.encode(
    ['address', 'uint256'],
    [player, GAME_SUB_ROOT_SLOT],
  ));
}

async function _readSubStorage(provider, player, blockNumber) {
  if (_storageReader) return _storageReader(provider, player, blockNumber);
  const slot = _subStorageSlot(player);
  if (typeof provider?.getStorage === 'function') {
    return provider.getStorage(CONTRACTS.GAME, slot, blockNumber);
  }
  if (typeof provider?.send === 'function') {
    return provider.send('eth_getStorageAt', [
      CONTRACTS.GAME,
      slot,
      `0x${BigInt(blockNumber).toString(16)}`,
    ]);
  }
  throw new Error('Quest subscriber storage reads unavailable.');
}

function _decodeSubStorage(word) {
  try {
    const packed = BigInt(word);
    return {
      coveredThroughDay: Number((packed >> SUB_COVERED_SHIFT) & MASK_24),
      startDay: Number((packed >> SUB_START_SHIFT) & MASK_24),
      streakBase: Number((packed >> SUB_STREAK_SHIFT) & MASK_16),
    };
  } catch (_e) {
    return null;
  }
}

async function _readGameQuestContext(provider, player, overrides) {
  const game = _gameContract(provider);
  const [scoreRead, deityRead, subRead] = await Promise.allSettled([
    game.playerActivityScore(player, overrides),
    game.hasDeityPass(player, overrides),
    game.subInfo(player, overrides),
  ]);
  const sub = subRead.status === 'fulfilled' ? subRead.value : null;
  return {
    activityScore: scoreRead.status === 'fulfilled'
      ? _safeWholeNumber(scoreRead.value)
      : null,
    hasDeityPass: deityRead.status === 'fulfilled' ? Boolean(deityRead.value) : null,
    sub: sub == null ? null : {
      active: Boolean(_value(sub, 'active', 0, false)),
      startDay: Number(_value(sub, 'afkingStartDay', 2, 0)),
      coveredThroughDay: Number(_value(sub, 'afkCoveredThroughDay', 3, 0)),
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
  const manualStreak = Number(_value(currentState, 'streak', 0,
    _value(effective, 'streak', 0, _value(daily, 'baseStreak', 4, 0))));
  const afkingActive = Boolean(_value(effective, 'afking', 1, false));

  // During an afKing run the Quest contract intentionally freezes its manual
  // counter. Read the Game-side latch only for a current, funded subscriber.
  // If it is stale, retain the decay-aware manual value; that matches Game's
  // own fallback instead of displaying an old afKing high-water mark.
  let effectiveQuestStreak = manualStreak;
  let effectiveQuestStreakExact = !afkingActive;
  const sub = gameContext?.sub;
  if (afkingActive && sub?.active && sub.startDay > 0
    && sub.coveredThroughDay >= sub.startDay
    && (day <= 0 || sub.coveredThroughDay + 1 >= day)) {
    try {
      const subWord = await _readSubStorage(provider, player, blockNumber);
      const decoded = _decodeSubStorage(subWord);
      if (decoded
        && decoded.startDay === sub.startDay
        && decoded.coveredThroughDay === sub.coveredThroughDay) {
        effectiveQuestStreak = decoded.streakBase
          + (decoded.coveredThroughDay - decoded.startDay);
        effectiveQuestStreakExact = true;
      }
    } catch (_e) {
      // A provider may disable eth_getStorageAt. The exact activity score still
      // renders and the manual streak remains an honest fallback.
    }
  }

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
    activityScore: gameContext?.activityScore ?? null,
    hasDeityPass: gameContext?.hasDeityPass ?? null,
    shields: Number(_value(shieldState, 'shields', 0, 0)),
    blockNumber,
  };
}
