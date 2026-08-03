import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHAIN } from '../chain-config.js';
import { resetPresentationStateForDeployment } from '../deployment-presentation-state.js';

function storageOf(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    has(key) { return values.has(key); },
  };
}

test('a deploy change clears colliding jackpot/flip receipts and preserves unrelated data', () => {
  const storage = storageOf({
    [`flip_day_${CHAIN.id}_7`]: '1',
    [`spun_day_${CHAIN.id}_7`]: '1',
    [`jackpot_complete_day_${CHAIN.id}_7`]: '1',
    'affiliate-ref': '0xref',
  });
  assert.equal(resetPresentationStateForDeployment(storage), true);
  assert.equal(storage.has(`flip_day_${CHAIN.id}_7`), false);
  assert.equal(storage.has(`spun_day_${CHAIN.id}_7`), false);
  assert.equal(storage.has(`jackpot_complete_day_${CHAIN.id}_7`), false);
  assert.equal(storage.getItem('affiliate-ref'), '0xref');
  assert.equal(storage.getItem(`presentation_deploy_${CHAIN.id}`), String(CHAIN.deployBlock));
  assert.equal(resetPresentationStateForDeployment(storage), false,
    'the same deployment never clears current-session reveal state');
});

