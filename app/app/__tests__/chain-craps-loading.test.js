import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { buildCrapsReplayInWorker, chainReplayFetch, CRAPS_REPLAY_WORKER_TIMEOUT_MS } from '../../chain/craps.js';

test('an unrelated slow replay does not block a requested battle from fetching its inputs', async () => {
  const reads = [];
  const client = {
    chain: { id: 123456789 },
    address: () => '0x' + 'ab'.repeat(20),
    snapshot: () => new Promise((resolve, reject) => reads.push({ reject })),
  };
  const path = n => `/craps/replays/v1/battles/0x${n.toString(16).padStart(64, '0')}/latest.json`;
  const background = chainReplayFetch(path(1), { client });
  const requested = chainReplayFetch(path(2), { client });
  const duplicate = chainReplayFetch(path(2), { client });
  try {
    await setImmediate();
    assert.equal(reads.length, 2, 'both battles start independently; duplicate requests share the same build');
  } finally {
    for (const read of reads) read.reject(new Error('Test input unavailable'));
    await setImmediate();
    for (const read of reads) read.reject(new Error('Test input unavailable'));
    await Promise.all([background, requested, duplicate]);
  }
});

function mockWorkers(t) {
  const workers = [];
  const previous = globalThis.Worker;
  globalThis.Worker = class {
    constructor() { this.terminated = false; workers.push(this); }
    postMessage(input) { this.input = input; }
    terminate() { this.terminated = true; }
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.Worker;
    else globalThis.Worker = previous;
  });
  return workers;
}

test('replay workers run one at a time and settlement mismatches release the next battle', async t => {
  const workers = mockWorkers(t);
  const bad = buildCrapsReplayInWorker({ battle: 'bad' });
  const rejected = assert.rejects(bad, { code: 'REPLAY_MISMATCH' });
  const good = buildCrapsReplayInWorker({ battle: 'good' });
  await setImmediate();
  assert.equal(workers.length, 1);
  workers[0].onmessage({ data: { error: 'Settlement does not match' } });
  await rejected;
  await setImmediate();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  assert.equal(workers[1].input.battle, 'good');
  workers[1].onmessage({ data: { digest: 'verified' } });
  assert.deepEqual(await good, { digest: 'verified' });
  assert.equal(workers[1].terminated, true);
});

test('a stalled worker times out and releases the next battle instead of blocking later opens', async t => {
  const workers = mockWorkers(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stalled = buildCrapsReplayInWorker({ battle: 'stalled' });
  const rejected = assert.rejects(stalled, { code: 'REPLAY_TIMEOUT' });
  const next = buildCrapsReplayInWorker({ battle: 'next' });
  await setImmediate();
  assert.equal(workers.length, 1);
  t.mock.timers.tick(CRAPS_REPLAY_WORKER_TIMEOUT_MS);
  await rejected;
  await setImmediate();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  workers[1].onmessage({ data: { digest: 'next' } });
  assert.deepEqual(await next, { digest: 'next' });
  assert.equal(workers[1].terminated, true);
});
