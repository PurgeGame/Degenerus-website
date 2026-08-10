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
    [`jackpot-resolution-seen:${CHAIN.id}:decimator:0xabc:15`]: '1',
    'affiliate-ref': '0xref',
  });
  assert.equal(resetPresentationStateForDeployment(storage), true);
  assert.equal(storage.has(`flip_day_${CHAIN.id}_7`), false);
  assert.equal(storage.has(`spun_day_${CHAIN.id}_7`), false);
  assert.equal(storage.has(`jackpot_complete_day_${CHAIN.id}_7`), false);
  assert.equal(storage.has(`jackpot-resolution-seen:${CHAIN.id}:decimator:0xabc:15`), false);
  assert.equal(storage.getItem('affiliate-ref'), '0xref');
  assert.equal(storage.getItem(`presentation_deploy_${CHAIN.id}`), String(CHAIN.deployBlock));
  assert.equal(resetPresentationStateForDeployment(storage), false,
    'the same deployment never clears current-session reveal state');
});

// Regression: the sweep list is a hand-maintained mirror of key formats that live
// in other modules, so it ROTS silently. coinflip.js renamed its resolved-stake
// prefix v2 -> v3 and this list kept purging v2, so every run since inherited the
// previous run's per-day stake numbers with nothing failing. These assertions use
// the EXACT key strings the writers build, so a future rename fails here.
test('sweeps the key formats their writers actually build (v2->v3 drift guard)', () => {
  const addr = '0x00000000000000000000000000000000000000ab';
  // coinflip.js:  `${RESOLVED_STAKE_STORAGE_PREFIX}:${CHAIN.id}:${addr}:${day}`
  const resolvedV3 = `coinflip_resolved_stake_v3:${CHAIN.id}:${addr}:7`;
  const resolvedV2 = `coinflip_resolved_stake_v2:${CHAIN.id}:${addr}:7`;
  // last-day-jackpot.js:  `day_summary_${CHAIN.id}_${pinnedDay}_${player}`
  const daySummary = `day_summary_${CHAIN.id}_7_${addr}`;
  // Scoped by a per-run CONTRACT address -> self-namespacing, must SURVIVE.
  const bingo = `degenerus:bingo:${CHAIN.id}:0xdeadbeef`;
  const biggest = `coinflip_biggest_record_v1:${CHAIN.id}:0xdeadbeef`;

  const storage = storageOf({
    [resolvedV3]: '123',
    [resolvedV2]: '123',
    [daySummary]: '{}',
    [bingo]: '{}',
    [biggest]: '{}',
  });

  assert.equal(resetPresentationStateForDeployment(storage), true);
  assert.equal(storage.has(resolvedV3), false,
    'v3 resolved-stake must be swept — v2-only was the original drift bug');
  assert.equal(storage.has(resolvedV2), false, 'legacy v2 still shed for idle browsers');
  assert.equal(storage.has(daySummary), false, 'day_summary collides on day number across runs');
  assert.equal(storage.has(bingo), true, 'GAME-scoped keys self-namespace; sweeping them is waste');
  assert.equal(storage.has(biggest), true, 'COINFLIP-scoped keys self-namespace');
});
