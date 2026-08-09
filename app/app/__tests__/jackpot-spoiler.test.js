import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../chain-config.js';
import {
  jackpotDayRevealComplete,
  jackpotProcessingCoversLevel,
  unresolvedJackpotContext,
} from '../jackpot-spoiler.js';

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (key) => values.get(key) ?? null };
}

test('daily reward scope begins at the real RNG request and spans the six processed levels', () => {
  const covered = unresolvedJackpotContext({
    daySync: { day: 55, rngRequested: true },
    gameState: { level: 31 },
    storage: storage(),
  });
  assert.deepEqual(covered, { day: 55, level: 31 });
  assert.equal(jackpotProcessingCoversLevel(31, covered), true);
  assert.equal(jackpotProcessingCoversLevel(36, covered), true);
  assert.equal(jackpotProcessingCoversLevel(37, covered), false);

  assert.equal(unresolvedJackpotContext({
    daySync: { day: 55, rngRequested: false },
    gameState: { level: 31 },
    storage: storage(),
  }), null, 'a bare day rollover is not jackpot processing');
});

test('finishing every jackpot roll opens the reward gate', () => {
  const completeKey = `jackpot_complete_day_${CHAIN.id}_55`;
  assert.equal(jackpotDayRevealComplete(55, {
    storage: storage({ [completeKey]: '1' }),
  }), true);
  assert.equal(unresolvedJackpotContext({
    daySync: { day: 55, rngRequested: true, jackpotReady: true },
    gameState: { level: 31 },
    storage: storage({ [completeKey]: '1' }),
  }), null);
});

test('a scratched main roll stays covered while its bonus roll is pending', () => {
  const values = {
    [`spun_day_${CHAIN.id}_55`]: '1',
    [`jackpot_bonus_pending_day_${CHAIN.id}_55`]: '1',
  };
  assert.equal(jackpotDayRevealComplete(55, { storage: storage(values) }), false);
});
