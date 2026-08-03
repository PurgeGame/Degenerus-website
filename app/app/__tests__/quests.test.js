import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { clearProvider, setProvider } from '../contracts.js';
import {
  __resetQuestContractFactoryForTest,
  __setQuestContractFactoryForTest,
  __setQuestGameContractFactoryForTest,
  readLiveQuestBoard,
} from '../quests.js';

const PLAYER = '0x411087a5f752d3b5545e8301ad7e6cef1351e480';

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

test('live quest board reads exact deity score and packed active afKing streak', async () => {
  // Current deploy example shape: streak base 2 + funded span (day 4 - day 1).
  const subWord = (2n << 208n) | (4n << 104n) | (1n << 128n);
  setProvider({
    getBlockNumber: async () => 45_006_900,
    getStorage: async () => `0x${subWord.toString(16)}`,
  });
  __setQuestContractFactoryForTest(() => questContract());
  __setQuestGameContractFactoryForTest(() => ({
    playerActivityScore: async () => 157n,
    hasDeityPass: async () => true,
    subInfo: async () => [true, 10, 1, 4],
  }));

  const board = await readLiveQuestBoard(PLAYER);
  assert.equal(board.afkingActive, true);
  assert.equal(board.questStreak.baseStreak, 0, 'Quest-side manual streak is dormant');
  assert.equal(board.effectiveQuestStreak, 5, 'Game-side afKing streak is reconstructed');
  assert.equal(board.effectiveQuestStreakExact, true);
  assert.equal(board.activityScore, 157);
  assert.equal(board.hasDeityPass, true);
});

test('supplemental GAME read failures do not blank the quest board', async () => {
  setProvider({
    getBlockNumber: async () => 45_006_900,
    getStorage: async () => { throw new Error('unsupported'); },
  });
  __setQuestContractFactoryForTest(() => questContract({ manualStreak: 7, afking: false }));
  __setQuestGameContractFactoryForTest(() => ({
    playerActivityScore: async () => { throw new Error('selector unavailable'); },
    hasDeityPass: async () => { throw new Error('selector unavailable'); },
    subInfo: async () => { throw new Error('selector unavailable'); },
  }));

  const board = await readLiveQuestBoard(PLAYER);
  assert.equal(board.quests.length, 2);
  assert.equal(board.effectiveQuestStreak, 7);
  assert.equal(board.effectiveQuestStreakExact, true);
  assert.equal(board.activityScore, null);
  assert.equal(board.hasDeityPass, null);
});
