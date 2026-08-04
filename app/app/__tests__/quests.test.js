import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { clearProvider, setProvider } from '../contracts.js';
import {
  __resetQuestContractFactoryForTest,
  __setQuestContractFactoryForTest,
  __setQuestGameContractFactoryForTest,
  __setQuestLensContractFactoryForTest,
  readLiveQuestBoard,
} from '../quests.js';

const PLAYER = '0x411087a5f752d3b5545e8301ad7e6cef1351e480';

// DegenerusGameLens.subInfoFull, named fields only (ethers returns a Result
// that is both indexed and named; the reader accepts either).
function lensContract({ startDay = 1, coveredThroughDay = 4, effectiveStreak = 5 } = {}) {
  return {
    subInfoFull: async () => ({
      active: true,
      afkingStartDay: startDay,
      afkCoveredThroughDay: coveredThroughDay,
      subStreakLatch: 2,
      effectiveStreak,
    }),
  };
}

function questContract({ day = 4, manualStreak = 0, afking = true } = {}) {
  const definition = (slot) => [day, slot + 1, false, [1, 0n]];
  return {
    getPlayerQuestView: async () => [
      [definition(0), definition(1)],
      [0n, 0n],
      [false, false],
      0,
      manualStreak,
    ],
    getPlayerLevelQuestView: async () => [1, 0n, 1n, false, true],
    playerQuestStates: async () => [manualStreak, 0, [0n, 0n], [false, false]],
    effectiveBaseStreakAndAfking: async () => [manualStreak, afking],
    shieldsOf: async () => [0, 0],
  };
}

afterEach(() => {
  clearProvider();
  __resetQuestContractFactoryForTest();
});

test('live quest board reads exact deity score and lens-computed afKing streak', async () => {
  // Current deploy example shape: streak base 2 + funded span (day 4 - day 1).
  setProvider({ getBlockNumber: async () => 45_006_900 });
  __setQuestContractFactoryForTest(() => questContract());
  __setQuestGameContractFactoryForTest(() => ({
    playerActivityScore: async () => 157n,
    hasDeityPass: async () => true,
    subInfo: async () => [true, 10, 1, 4],
  }));
  __setQuestLensContractFactoryForTest(() => lensContract());

  const board = await readLiveQuestBoard(PLAYER);
  assert.equal(board.afkingActive, true);
  assert.equal(board.questStreak.baseStreak, 0, 'Quest-side manual streak is dormant');
  assert.equal(board.effectiveQuestStreak, 5, 'Game-side afKing streak comes from the lens');
  assert.equal(board.effectiveQuestStreakExact, true);
  assert.equal(board.activityScore, 157);
  assert.equal(board.hasDeityPass, true);
});

test('supplemental GAME read failures do not blank the quest board', async () => {
  setProvider({ getBlockNumber: async () => 45_006_900 });
  __setQuestContractFactoryForTest(() => questContract({ manualStreak: 7, afking: false }));
  __setQuestGameContractFactoryForTest(() => ({
    playerActivityScore: async () => { throw new Error('selector unavailable'); },
    hasDeityPass: async () => { throw new Error('selector unavailable'); },
    subInfo: async () => { throw new Error('selector unavailable'); },
  }));
  __setQuestLensContractFactoryForTest(() => ({
    subInfoFull: async () => { throw new Error('selector unavailable'); },
  }));

  const board = await readLiveQuestBoard(PLAYER);
  assert.equal(board.quests.length, 2);
  assert.equal(board.effectiveQuestStreak, 7);
  assert.equal(board.effectiveQuestStreakExact, true);
  assert.equal(board.activityScore, null);
  assert.equal(board.hasDeityPass, null);
});

test('an unavailable lens leaves the afKing streak inexact rather than wrong', async () => {
  // No GAME_LENS deployed / call reverts: the panel must fall back to the
  // indexed /player streak, not to the frozen manual counter.
  setProvider({ getBlockNumber: async () => 45_006_900 });
  __setQuestContractFactoryForTest(() => questContract({ manualStreak: 3 }));
  __setQuestGameContractFactoryForTest(() => ({
    playerActivityScore: async () => 157n,
    hasDeityPass: async () => false,
    subInfo: async () => [true, 10, 1, 4],
  }));
  __setQuestLensContractFactoryForTest(() => ({
    subInfoFull: async () => { throw new Error('no lens'); },
  }));

  const board = await readLiveQuestBoard(PLAYER);
  assert.equal(board.afkingActive, true);
  assert.equal(board.effectiveQuestStreakExact, false);
  assert.equal(board.effectiveQuestStreak, 3, 'manual streak is the honest fallback');
});

test('a lens reading a different deployment is rejected', async () => {
  // Sub record mismatch at the same block = the configured lens is not this
  // deployment's. Trusting its streak would show a number from another run.
  setProvider({ getBlockNumber: async () => 45_006_900 });
  __setQuestContractFactoryForTest(() => questContract({ manualStreak: 3 }));
  __setQuestGameContractFactoryForTest(() => ({
    playerActivityScore: async () => 157n,
    hasDeityPass: async () => false,
    subInfo: async () => [true, 10, 1, 4],
  }));
  __setQuestLensContractFactoryForTest(() => lensContract({
    startDay: 1, coveredThroughDay: 9, effectiveStreak: 40,
  }));

  const board = await readLiveQuestBoard(PLAYER);
  assert.equal(board.effectiveQuestStreakExact, false);
  assert.equal(board.effectiveQuestStreak, 3);
});

test('the decay gate firing falls back instead of showing a stale high-water mark', async () => {
  // _afkingStreak returns 0 once a playable full day passed with no funded
  // delivery. That is a real signal, not a read failure.
  setProvider({ getBlockNumber: async () => 45_006_900 });
  __setQuestContractFactoryForTest(() => questContract({ manualStreak: 3 }));
  __setQuestGameContractFactoryForTest(() => ({
    playerActivityScore: async () => 157n,
    hasDeityPass: async () => false,
    subInfo: async () => [true, 10, 1, 4],
  }));
  __setQuestLensContractFactoryForTest(() => lensContract({ effectiveStreak: 0 }));

  const board = await readLiveQuestBoard(PLAYER);
  assert.equal(board.effectiveQuestStreakExact, false);
  assert.equal(board.effectiveQuestStreak, 3);
});
