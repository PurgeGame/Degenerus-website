// Shared REST-client load behavior.
//
// The app mounts many panels together; all of them import beta/app/api.js.
// Identical GETs share one request across both REST call sites. A one-second
// completed-response window collapses a render wave that outlives localhost's
// very short response time; transaction invalidation remains a hard boundary.

import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const priorDocument = globalThis.document;
const priorFetch = globalThis.fetch;
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
};

const api = await import('../api.js');

afterEach(() => {
  api.invalidateJSONCache();
});

after(() => {
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
  if (priorFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = priorFetch;
});

test('identical concurrent JSON reads share one network request', async () => {
  let calls = 0;
  let finish;
  globalThis.fetch = () => {
    calls += 1;
    return new Promise((resolve) => {
      finish = () => resolve({
        ok: true,
        status: 200,
        json: async () => ({ player: 'shared' }),
      });
    });
  };

  const first = api.fetchJSON('/player/0xabc');
  const second = api.fetchJSON('/player/0xabc');
  const third = api.fetchJSON('/player/0xabc');
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await Promise.all([first, second, third]), [
    { player: 'shared' },
    { player: 'shared' },
    { player: 'shared' },
  ]);
});

test('failed requests leave the in-flight cache and retry immediately', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    // 500, not 503. A 503 is backpressure and now arms the shared cooldown, so
    // the follow-up read would correctly refuse to hit the network at all — see
    // the shed-load test below. A 500 is a plain error: retry immediately.
    return calls === 1
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ fresh: true }) };
  };

  const failedA = api.fetchJSON('/game/state');
  const failedB = api.fetchJSON('/game/state');
  const failures = await Promise.allSettled([failedA, failedB]);
  assert.equal(calls, 1, 'the failing attempt is shared too');
  assert.ok(failures.every((result) => result.status === 'rejected'));

  assert.deepEqual(await api.fetchJSON('/game/state'), { fresh: true });
  assert.equal(calls, 2, 'a later call gets a fresh network attempt');
});

test('successful reads collapse for one second, then expire', async () => {
  const realNow = Date.now;
  let now = 10_000;
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ version: calls }) };
  };
  try {
    assert.deepEqual(await api.fetchJSON('/player/0xabc'), { version: 1 });
    assert.deepEqual(await api.fetchJSON('/player/0xabc'), { version: 1 });
    assert.equal(calls, 1, 'completed reads in one render wave reuse the response');

    now += 1_001;
    assert.deepEqual(await api.fetchJSON('/player/0xabc'), { version: 2 });
    assert.equal(calls, 2, 'the tiny collapse window does not become a polling cache');
  } finally {
    Date.now = realNow;
  }
});

test('polling.js and panel reads share the same in-flight request', async () => {
  const polling = await import('../polling.js');
  let calls = 0;
  let finish;
  globalThis.fetch = () => {
    calls += 1;
    return new Promise((resolve) => {
      finish = () => resolve({
        ok: true,
        status: 200,
        json: async () => ({ shared: true }),
      });
    });
  };

  const panel = api.fetchJSON('/game/state');
  const timer = polling._testing.fetchJSONWithSignal('/game/state', {
    signal: new AbortController().signal,
  });
  assert.equal(calls, 1, 'one transport flight spans both clients');
  finish();
  assert.deepEqual(await Promise.all([panel, timer]), [{ shared: true }, { shared: true }]);
});

test('one consumer abort does not cancel another consumer of the same read', async () => {
  let finish;
  let networkSignal;
  globalThis.fetch = (_url, opts) => {
    networkSignal = opts.signal;
    return new Promise((resolve, reject) => {
      finish = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      opts.signal.addEventListener('abort', () => {
        const error = new Error('network aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };

  const controller = new AbortController();
  const timer = api.fetchJSON('/health', { signal: controller.signal });
  const panel = api.fetchJSON('/health');
  controller.abort();

  await assert.rejects(timer, { name: 'AbortError' });
  assert.equal(networkSignal.aborted, false, 'shared network work remains alive');
  finish();
  assert.deepEqual(await panel, { ok: true });
});

test('transaction invalidation bypasses the recent-response window', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ version: calls }) };
  };

  assert.deepEqual(await api.fetchJSON('/player/0xabc'), { version: 1 });
  api.invalidateJSONCache();
  assert.deepEqual(await api.fetchJSON('/player/0xabc'), { version: 2 });
  assert.equal(calls, 2);
});

// The point of hoisting the cooldown into api-cooldown.js: the two REST clients
// are separate, but backpressure is not. Before this, a 503 stopped the timers
// in polling.js while every panel kept knocking through api.js on its own
// schedule — half the app ignoring what the API told the other half.
test('a shed response through api.js also gates polling.js reads', async () => {
  const cooldown = await import('../api-cooldown.js');
  const polling = await import('../polling.js');
  cooldown.clearApiCooldown();

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 503, json: async () => ({}) };
  };

  await assert.rejects(() => api.fetchJSON('/game/state'));
  assert.equal(calls, 1, 'the shedding response was a real request');
  assert.ok(cooldown.isCoolingDown(), 'api.js armed the shared gate');

  // Both call sites now share one broker, so the timer must refuse without
  // touching the network.
  await assert.rejects(
    () => polling._testing.fetchJSONWithSignal('/health', {}),
    /cooling down/,
  );
  assert.equal(calls, 1, 'polling.js made no request while shedding');

  cooldown.clearApiCooldown();
  assert.equal(cooldown.cooldownUntil(), 0);
});

test('a 500 is not backpressure and does not gate anything', async () => {
  const cooldown = await import('../api-cooldown.js');
  cooldown.clearApiCooldown();
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => api.fetchJSON('/game/state'), /API 500/);
  assert.equal(cooldown.isCoolingDown(), false, '500 is a bug, not a request to stop');
});
