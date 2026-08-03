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

let _contractFactory = null;
let _publicProvider = null;

export function __setQuestContractFactoryForTest(factory) {
  _contractFactory = factory;
}

export function __resetQuestContractFactoryForTest() {
  _contractFactory = null;
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
 *   levelQuest:Object, afkingActive:boolean, shields:number, blockNumber:number}>}
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
  const [daily, level, currentState, effective, shieldResult] = await Promise.all([
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

  return {
    day,
    quests,
    questStreak: {
      // getPlayerQuestView.baseStreak is intentionally frozen at the start of
      // the day for reward math. The chip is the player's current earned
      // streak, so use playerQuestStates.streak (which includes completions
      // made today) instead of leaving the display one or more credits behind.
      baseStreak: Number(_value(currentState, 'streak', 0,
        _value(effective, 'streak', 0, _value(daily, 'baseStreak', 4, 0)))),
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
    afkingActive: Boolean(_value(effective, 'afking', 1, false)),
    shields: Number(_value(shieldState, 'shields', 0, 0)),
    blockNumber,
  };
}
