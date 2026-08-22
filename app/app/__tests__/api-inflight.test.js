// Shared REST-client load behavior.
//
// The app mounts many panels together; all of them import beta/app/api.js.
// Identical GETs share one request across both REST call sites. A one-second
// completed-response window collapses a render wave that outlives localhost's
// very short response time; transaction invalidation remains a hard boundary.

import { test, after, afterEach, mock } from 'node:test';
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

test('background wallet reads leave one personalized slot reserved for interactions', async () => {
  const cooldown = await import('../api-cooldown.js');
  cooldown.clearApiCooldown();
  let calls = 0;
  const finishes = [];
  globalThis.fetch = () => {
    calls += 1;
    return new Promise((resolve) => {
      finishes.push(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }));
    });
  };

  const requests = Array.from({ length: 6 }, (_, index) => (
    api.fetchJSON(`/player/0x${String(index + 1).padStart(40, '0')}/boons/1`)
  ));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2, 'background hydration cannot consume the interaction reserve');

  for (let expected = 3; expected <= 6; expected += 1) {
    finishes.shift()();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, expected, 'each completion admits exactly one queued read');
  }
  for (const finish of finishes.splice(0)) finish();
  await Promise.all(requests);
});

test('an interaction starts in the reserved slot while background work is saturated', async () => {
  const pending = [];
  const urls = [];
  globalThis.fetch = (url) => {
    urls.push(String(url));
    return new Promise((resolve) => {
      pending.push(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }));
    });
  };

  const background = Array.from({ length: 3 }, (_, index) => (
    api.fetchJSON(`/player/0x${String(index + 30).padStart(40, '0')}`)
  ));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.length, 2);

  const interactionPath = `/player/0x${'7'.repeat(40)}/tickets/by-trait?level=258`;
  const interaction = api.fetchJSON(interactionPath, { priority: 'interaction' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.length, 3);
  assert.ok(urls[2].endsWith(interactionPath), 'the user action takes the reserved slot');

  while (pending.length > 0) {
    pending.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all([...background, interaction]);
});

test('queued interactions drain before queued background reads', async () => {
  const pending = [];
  const urls = [];
  globalThis.fetch = (url) => {
    urls.push(String(url));
    return new Promise((resolve) => {
      pending.push(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }));
    });
  };

  const bg1 = api.fetchJSON(`/player/0x${'1'.repeat(40)}/boons/1`);
  const bg2 = api.fetchJSON(`/player/0x${'2'.repeat(40)}/boons/1`);
  const activeInteraction = api.fetchJSON(`/player/0x${'3'.repeat(40)}/packs?day=5`, {
    priority: 'interaction',
  });
  const queuedBackgroundPath = `/player/0x${'4'.repeat(40)}/boons/1`;
  const queuedBackground = api.fetchJSON(queuedBackgroundPath);
  const queuedInteractionPath = `/viewer/player/0x${'5'.repeat(40)}/day/5`;
  const queuedInteraction = api.fetchJSON(queuedInteractionPath, { priority: 'interaction' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.length, 3, 'the lane begins full');

  pending.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.length, 4);
  assert.ok(urls[3].endsWith(queuedInteractionPath), 'the queued user action goes first');
  assert.ok(!urls.some((url) => url.endsWith(queuedBackgroundPath)));

  while (pending.length > 0) {
    pending.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all([bg1, bg2, activeInteraction, queuedBackground, queuedInteraction]);
});

test('an interaction consumer promotes its already-queued shared flight', async () => {
  const pending = [];
  const urls = [];
  globalThis.fetch = (url) => {
    urls.push(String(url));
    return new Promise((resolve) => {
      pending.push(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({ shared: true }),
      }));
    });
  };

  const blockers = [
    api.fetchJSON(`/player/0x${'6'.repeat(40)}`),
    api.fetchJSON(`/player/0x${'7'.repeat(40)}`),
  ];
  const sharedPath = `/player/0x${'8'.repeat(40)}/tickets/by-trait?level=258`;
  const backgroundConsumer = api.fetchJSON(sharedPath);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.length, 2, 'the shared flight begins queued as background');

  const interactionConsumer = api.fetchJSON(sharedPath, { priority: 'interaction' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.length, 3, 'attaching the interaction promotes the queued flight');
  assert.equal(urls.filter((url) => url.endsWith(sharedPath)).length, 1,
    'promotion preserves URL coalescing');

  while (pending.length > 0) {
    pending.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  const values = await Promise.all([...blockers, backgroundConsumer, interactionConsumer]);
  assert.deepEqual(values.slice(-2), [{ shared: true }, { shared: true }]);
});

test('shared reads bypass a full personalized lane', async () => {
  const cooldown = await import('../api-cooldown.js');
  cooldown.clearApiCooldown();
  const finishes = [];
  const urls = [];
  globalThis.fetch = (url) => {
    urls.push(String(url));
    return new Promise((resolve) => {
      finishes.push(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }));
    });
  };

  const personal = Array.from({ length: 4 }, (_, index) => (
    api.fetchJSON(`/player/0x${String(index + 10).padStart(40, '0')}`)
  ));
  const shared = api.fetchJSON('/game/state');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.length, 3);
  assert.ok(urls.some((url) => url.endsWith('/game/state')), 'shared state starts immediately');
  assert.equal(
    urls.filter((url) => url.includes('/player/')).length,
    2,
    'background reads preserve the reserved interaction slot',
  );

  for (const finish of finishes.splice(0)) finish();
  await new Promise((resolve) => setImmediate(resolve));
  for (const finish of finishes.splice(0)) finish();
  await Promise.all([...personal, shared]);
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

// The point of hoisting the cooldown into api-cooldown.js: all broker consumers
// share backpressure. Before this, a 503 stopped the timers in polling.js while
// every panel kept knocking through api.js on its own schedule.
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

test('a personalized capacity shed pauses wallet reads without pausing shared state', async () => {
  const cooldown = await import('../api-cooldown.js');
  cooldown.clearApiCooldown();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 503,
        headers: {
          get(name) {
            const key = String(name).toLowerCase();
            if (key === 'x-load-shed') return 'capacity';
            if (key === 'x-capacity-lane') return 'personalized';
            if (key === 'retry-after') return '1';
            return null;
          },
        },
        json: async () => ({}),
      };
    }
    return { ok: true, status: 200, json: async () => ({ shared: true }) };
  };

  const first = '0x1111111111111111111111111111111111111111';
  const second = '0x2222222222222222222222222222222222222222';
  await assert.rejects(() => api.fetchJSON(`/player/${first}`), /API 503/);
  assert.equal(cooldown.isCoolingDown('global'), false);
  assert.equal(cooldown.isCoolingDown('personalized'), true);

  assert.deepEqual(await api.fetchJSON('/game/state'), { shared: true });
  await assert.rejects(() => api.fetchJSON(`/player/${second}`), /cooling down/);
  assert.equal(calls, 2, 'the second wallet read was rejected before the network');
  cooldown.clearApiCooldown();
});

test('a 500 is not backpressure and does not gate anything', async () => {
  const cooldown = await import('../api-cooldown.js');
  cooldown.clearApiCooldown();
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => api.fetchJSON('/game/state'), /API 500/);
  assert.equal(cooldown.isCoolingDown(), false, '500 is a bug, not a request to stop');
});

test('a recovered personalized read resets an expired global backoff ladder', async () => {
  const cooldown = await import('../api-cooldown.js');
  cooldown.clearApiCooldown();
  const realNow = Date.now;
  const realRandom = Math.random;
  let now = 50_000;
  let calls = 0;
  Date.now = () => now;
  Math.random = () => 0.5;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 2) {
      return { ok: true, status: 200, json: async () => ({ recovered: true }) };
    }
    return {
      ok: false,
      status: 503,
      headers: { get: () => null },
      json: async () => ({}),
    };
  };

  try {
    await assert.rejects(() => api.fetchJSON('/game/state'), /API 503/);
    assert.equal(cooldown.cooldownUntil() - now, 2_000);
    now += 2_001;
    assert.deepEqual(
      await api.fetchJSON('/player/0x1111111111111111111111111111111111111111'),
      { recovered: true },
    );
    await assert.rejects(() => api.fetchJSON('/game/jackpot/gold-rush'), /API 503/);
    assert.equal(cooldown.cooldownUntil() - now, 2_000, 'the global ladder restarted at step one');
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
    cooldown.clearApiCooldown();
  }
});

// A fetch with no deadline is not a slow read, it is a permanent one. The lane
// slot above is handed back only in createFlight's finally, so stalled
// personalized reads used to wedge every wallet-scoped request for the life of
// the tab — the failure that stranded replay-panel's bonus spin at
// "BONUS SPINNING…" with the previous roll still on the board.
test('a stalled read is abandoned instead of holding its lane slot forever', async () => {
  const cooldown = await import('../api-cooldown.js');
  cooldown.clearApiCooldown();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const urls = [];
    globalThis.fetch = (url, opts) => {
      urls.push(String(url));
      // A real fetch rejects when its signal aborts. A stub that ignores the
      // signal cannot show what the deadline actually buys.
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(opts.signal.reason ?? new Error('network aborted'));
        });
      });
    };

    const stalled = Array.from({ length: 4 }, (_unused, index) => (
      api.fetchJSON(`/player/0x${String(index + 20).padStart(40, '0')}`)
    ));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(urls.length, 2, 'two reads are active and two wait client-side');

    mock.timers.tick(20_000);
    for (const request of stalled) {
      await assert.rejects(request, { name: 'TimeoutError' },
        'active and queued work share one wall-clock deadline');
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(urls.length, 2, 'expired queued work never reaches the network');
  } finally {
    mock.timers.reset();
  }
});
