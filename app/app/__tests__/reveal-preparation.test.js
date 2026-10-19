import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRevealPreparation } from '../reveal-preparation.js';
import { publishPendingActions, getPendingActions, clearPendingActions,
  __resetPendingActionsForTest } from '../pending-actions.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('preparation and opening share one read and retain its complete result', async () => {
  const cache = createRevealPreparation();
  let calls = 0, release;
  const load = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const warming = cache.get('chain:contract:wallet:round', load);
  const opening = cache.get('chain:contract:wallet:round', load);
  assert.equal(cache.peek('chain:contract:wallet:round'), null, 'in-flight work is not a prepared result');
  assert.equal(warming, opening);
  await flush();
  const result = { winners: [1, 2, 3] };
  release(result);
  assert.equal(await opening, result);
  assert.equal(cache.peek('chain:contract:wallet:round'), result);
  assert.equal(await cache.get('chain:contract:wallet:round', load), result);
  assert.equal(calls, 1);
});

test('failed and incomplete reads retry; clearing cannot be undone by a late completion', async () => {
  const cache = createRevealPreparation({ complete: result => result?.ready });
  await assert.rejects(cache.get('a', () => { throw Error('offline'); }));
  assert.deepEqual(await cache.get('a', () => ({ ready: false })), { ready: false });
  assert.equal(cache.peek('a'), null, 'incomplete data must not bypass the loading/retry path');
  assert.deepEqual(await cache.get('a', () => ({ ready: true, value: 2 })), { ready: true, value: 2 });
  let release;
  const old = cache.get('b', () => new Promise(resolve => { release = resolve; }));
  await flush();
  cache.clear();
  release({ ready: true, value: 'old' });
  await old;
  assert.equal((await cache.get('b', () => ({ ready: true, value: 'new' }))).value, 'new');
});

test('the retained result cache is bounded and keeps recently opened results', async () => {
  const cache = createRevealPreparation({ limit: 2 });
  await cache.get('a', () => 'A');
  await cache.get('b', () => 'B');
  await cache.get('a', () => 'wrong');
  await cache.get('c', () => 'C');
  assert.equal(await cache.get('a', () => 'wrong'), 'A');
  assert.equal(await cache.get('b', () => 'B again'), 'B again');
});

test('Pending warms a ready row once without running it, scoped by wallet and result version', async () => {
  __resetPendingActionsForTest();
  let warmed = 0, opened = 0;
  const row = { id: 'round:10', dismissScope: 'alice', kind: 'test', state: 'waiting',
    prepare: () => { warmed++; }, run: () => { opened++; } };
  publishPendingActions('test', [row]);
  await flush();
  assert.equal(warmed, 0);
  row.state = 'ready';
  publishPendingActions('test', [row]);
  await flush();
  publishPendingActions('test', [{ ...row }]);
  await flush();
  assert.equal(warmed, 1);
  assert.equal(opened, 0);
  assert.equal(getPendingActions().length, 1, 'preparation never consumes the receipt');
  publishPendingActions('test', [{ ...row, dismissScope: 'bob' }]);
  await flush();
  publishPendingActions('test', [{ ...row, dismissScope: 'bob', prepareKey: 'corrected-result' }]);
  await flush();
  assert.equal(warmed, 3);
  clearPendingActions('test');
});

test('Pending limits simultaneous preparation and discards queued work after removal', async () => {
  __resetPendingActionsForTest();
  let active = 0, peak = 0, calls = 0;
  const releases = [];
  const prepare = () => new Promise(resolve => {
    active++; calls++; peak = Math.max(peak, active);
    releases.push(() => { active--; resolve(); });
  });
  publishPendingActions('many', Array.from({ length: 5 }, (_, id) => ({ id, state: 'ready', prepare })));
  await flush();
  assert.equal(calls, 2);
  clearPendingActions('many');
  releases.forEach(release => release());
  await flush();
  assert.equal(peak, 2);
  assert.equal(calls, 2);
  assert.deepEqual(getPendingActions(), []);
});

test('BAF begins preparing while both regular replay slots are occupied', async () => {
  __resetPendingActionsForTest();
  const releases = [];
  let bafReads = 0;
  publishPendingActions('battles', [1, 2].map(id => ({ id, state: 'ready',
    prepare: () => new Promise(resolve => releases.push(resolve)) })));
  await flush();
  assert.equal(releases.length, 2);
  publishPendingActions('baf', [{ id: 'baf:40', state: 'ready', kind: 'baf',
    preparePriority: 'high', prepare: () => { bafReads++; } }]);
  await flush();
  assert.equal(bafReads, 1, 'BAF must not wait for either battle replay');
  clearPendingActions('battles');
  clearPendingActions('baf');
  releases.forEach(release => release());
  await flush();
});

test('incomplete Pending data retries without another publication, and removal stops retries', async t => {
  __resetPendingActionsForTest();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let attempts = 0;
  const row = { id: 'baf:40', kind: 'baf', state: 'ready',
    prepare: () => { attempts++; return attempts >= 3; } };
  publishPendingActions('retry', [row]);
  await flush();
  assert.equal(attempts, 1);
  t.mock.timers.tick(5_000);
  await flush();
  assert.equal(attempts, 2);
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(attempts, 3);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(attempts, 3, 'complete data stays cached');
  publishPendingActions('retry', [{ ...row, id: 'baf:50', prepare: () => { attempts++; return false; } }]);
  await flush();
  clearPendingActions('retry');
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(attempts, 4, 'removal cancels the retry');
  t.mock.timers.reset();
});
