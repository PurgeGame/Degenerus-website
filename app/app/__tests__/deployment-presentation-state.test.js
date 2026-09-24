import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHAIN, CONTRACTS } from '../chain-config.js';
import { resetPresentationStateForDeployment, pruneOtherDeployments } from '../deployment-presentation-state.js';

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
  assert.equal(storage.getItem(`presentation_deploy_v2_${CHAIN.id}`), String(CHAIN.deployBlock));
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

// A browser that already swept THIS deployment under the old, narrower prefix list
// would otherwise carry the missed keys until the next redeploy — the marker is what
// makes the sweep once-per-deployment. Renaming it re-sweeps exactly once.
test('the marker bump re-sweeps a deployment already swept under the old list', () => {
  const addr = '0x00000000000000000000000000000000000000ab';
  const missed = `coinflip_resolved_stake_v3:${CHAIN.id}:${addr}:7`;
  const storage = storageOf({
    // what the PREVIOUS build left behind: swept, marker stamped, v3 key untouched
    [`presentation_deploy_${CHAIN.id}`]: String(CHAIN.deployBlock),
    [missed]: '123',
  });

  assert.equal(resetPresentationStateForDeployment(storage), true,
    'the old marker must NOT satisfy the new one, or the corrected list never runs');
  assert.equal(storage.has(missed), false, 'the previously-missed key is swept on the bump');
  assert.equal(resetPresentationStateForDeployment(storage), false, 'and only once');
});

test('finished runs are pruned; the current run and unscoped data survive', () => {
  const c = CHAIN.id; const b = Number(CHAIN.deployBlock); const craps = String(CONTRACTS.CRAPS).toLowerCase();
  const old = '0x0b490729db1979c712a34c1d4aa929dbb84ee7a9'; const player = '0xfe5b92e655d8b1732e47cb0a2f00ec6a50ea4200';
  const keep = [
    `craps-window-api:v1:${c}:${craps}:${b}`, `craps-window-logs:v1:${c}:${craps}:${b}`,
    `pack_pending_${c}_${b}`, `pack_revealed_${c}_${b}_${player}_3`, `pack_jackpot_awards_${c}_${b}_${player}`,
    `craps-resolution-seen:v2:${c}:${craps}:${player}:0x01:5`, `degenerus:wwxrp-draw-days:v1:${c}:${b}:${player}`,
    `pack_pending_${c}`, `presentation_deploy_v2_${c}`, `craps-window-api:v1:999:${old}:1`, 'affiliate-ref',
    `degenerus:pending-dismissals:v1:${c}:${player}`,
  ];
  const drop = [
    `craps-window-api:v1:${c}:${old}:46230333`, `craps-window-logs:v1:${c}:${old}:46230333`,
    `craps-window-api:v1:${c}:${craps}:1`, `pack_pending_${c}_46230333`, `pack_revealed_${c}_46230333_${player}_3`,
    `pack_jackpot_awards_${c}_46230333_${player}`, `craps-resolution-seen:v2:${c}:${old}:${player}:0x01:5`,
    `craps-resolution-seen:${c}:46230333:${player}:0x01:5`, `degenerus:wwxrp-draw-days:v1:${c}:46230333:${player}`,
    `coinflip_resolved_stake_v1:${c}:${player}:10`, `presentation_deploy_${c}`,
  ];
  const storage = storageOf(Object.fromEntries([...keep, ...drop].map((k) => [k, '1'])));
  assert.equal(pruneOtherDeployments(storage), drop.length);
  for (const k of drop) assert.equal(storage.has(k), false, `stale: ${k}`);
  for (const k of keep) assert.equal(storage.has(k), true, `kept: ${k}`);
  assert.equal(pruneOtherDeployments(storage), 0, 'idempotent');
});
