// /app/app/__tests__/read-provider-failover.test.js
//
// Run: cd website && node --test app/app/__tests__/read-provider-failover.test.js
//
// Free RPC pacing and per-item failover, plus an explicitly configured emergency relay.
// What must hold:
//   - a healthy primary is the only endpoint contacted
//   - a network error, a non-2xx status, and an unparseable body each fail
//     over to the next endpoint FOR THAT REQUEST
//   - a JSON-RPC error object inside a 200 (a revert) is returned unchanged
//     and never triggers failover, EXCEPT a per-item rate limit (-32016,
//     -32007), which is the endpoint refusing the request and fails over like a 429
//   - a rate refusal RESTS that endpoint for every request (doubling, or the
//     server's Retry-After) and halves its pace; reads wait for a rested
//     endpoint instead of failing, and only a refusal that outlasts several
//     rests arms the outage breaker
//   - every request spends tokens from its endpoint's bucket, so a burst is
//     spread out instead of refused
//   - after 3 consecutive primary failures the fallback becomes preferred,
//     and a recovered response resets the failure count
//   - every endpoint dead → the last transport error surfaces

import { test } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.window === 'undefined') {
  globalThis.window = { addEventListener: () => {} };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
}
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

const { _makeFailoverSend, RpcUnavailableError, _clearOutagesForTests } = await import('../read-provider.js');

const A = 'https://primary.invalid';
const B = 'https://fallback.invalid';
const PAYLOAD = { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] };
const ok = (body) => ({ ok: true, json: async () => body });

test('a healthy primary is the only endpoint contacted', async () => {
  const hits = [];
  const send = _makeFailoverSend([A, B], async (url) => { hits.push(url); return ok({ id: 1, result: '0x1' }); });
  const out = await send(PAYLOAD);
  assert.deepEqual(out, [{ id: 1, result: '0x1' }]);
  assert.deepEqual(hits, [A]);
});

test('network error, bad status, and bad body each fail over for that request', async () => {
  for (const breakage of [
    async () => { throw new Error('network down'); },
    async () => ({ ok: false, status: 429, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw new Error('not json'); } }),
  ]) {
    const hits = [];
    const send = _makeFailoverSend([A, B], async (url) => {
      hits.push(url);
      if (url === A) return breakage();
      return ok([{ id: 1, result: '0x2' }]);
    });
    assert.deepEqual(await send(PAYLOAD), [{ id: 1, result: '0x2' }]);
    assert.deepEqual(hits, [A, B]);
  }
});

test('a revert (JSON-RPC error in a 200) passes through and never fails over', async () => {
  const hits = [];
  const revert = { id: 1, error: { code: 3, message: 'execution reverted', data: '0x08c379a0' } };
  const send = _makeFailoverSend([A, B], async (url) => { hits.push(url); return ok(revert); });
  assert.deepEqual(await send(PAYLOAD), [revert]);
  assert.deepEqual(hits, [A], 'the contract-level error must reach ethers untouched');
  assert.equal(send._state.consecutiveFailures, 0, 'a revert is a transport SUCCESS');
});

test('a rate limit inside a 200 fails over; a range refusal does not', async () => {
  const hits = [];
  const send = _makeFailoverSend([A, B], async (url, init) => {
    hits.push(url);
    if (url === A) return ok([{ id: 1, result: '0x1' }, { id: 2, error: { code: -32016, message: 'over rate limit' } }]);
    assert.deepEqual(JSON.parse(init.body).map(r => r.id), [2], 'successful reads are not replayed');
    return ok([{ id: 2, result: '0x2' }]);
  });
  assert.deepEqual(await send([PAYLOAD, { ...PAYLOAD, id: 2 }]), [{ id: 1, result: '0x1' }, { id: 2, result: '0x2' }]);
  assert.deepEqual(hits, [A, B]);
  const refused = { id: 1, error: { code: -32005, message: 'query returned more than 10000 results' } };
  const once = [];
  const sendRange = _makeFailoverSend([A, B], async (url) => { once.push(url); return ok(refused); });
  assert.deepEqual(await sendRange(PAYLOAD), [refused]);
  assert.deepEqual(once, [A]);
});

// A clock the injected wait advances, so rests and pacing play out without real time.
function fakeClock(start = 2_000_000) {
  const realNow = Date.now;
  const clock = { now: start, waits: [] };
  Date.now = () => clock.now;
  clock.wait = async (ms) => { clock.waits.push(ms); clock.now += ms; };
  clock.restore = () => { Date.now = realNow; };
  return clock;
}

test('a walk refused for rate everywhere waits for a rested endpoint instead of failing', async () => {
  // sepolia.base.org's refusal: HTTP 200 carrying -32007 "25/second request limit reached".
  const limited = { id: 1, error: { code: -32007, message: '25/second request limit reached - reduce calls per second' } };
  const clock = fakeClock();
  try {
    let refusals = 2;
    const hits = [];
    const send = _makeFailoverSend([A, B], async (url) => {
      hits.push(url);
      if (refusals > 0) { refusals -= 1; return ok(limited); }
      return ok({ id: 1, result: '0x1' });
    }, 1_000, clock.wait);
    assert.deepEqual(await send(PAYLOAD), [{ id: 1, result: '0x1' }]);
    assert.deepEqual(hits.slice(0, 2), [A, B]);
    assert.equal(hits.length, 3, 'both refused, then the first endpoint back from its rest answered');
    assert.ok(clock.waits[0] >= 800 && clock.waits[0] <= 1_200, 'the first rest is ~1s');
    assert.equal(send._state.outageUntil, 0, 'a burst never arms the outage breaker');
    assert.equal(send._state.endpoints[hits[2] === A ? 0 : 1].strikes, 0, 'an answer clears the strike count');
  } finally {
    clock.restore();
  }
});

test('a refusal rests that endpoint for every later request and halves its pace', async () => {
  const clock = fakeClock();
  try {
    const hits = [];
    let refuse = true;
    const send = _makeFailoverSend([A, B], async (url) => {
      hits.push(url);
      if (url === A && refuse) { refuse = false; return { ok: false, status: 429, json: async () => ({}) }; }
      return ok({ id: 1, result: '0x1' });
    }, 1_000, clock.wait);
    await send(PAYLOAD);
    assert.deepEqual(hits, [A, B]);
    assert.ok(send._state.endpoints[0].rate < 15, 'the refused endpoint slowed down');
    hits.length = 0;
    await send(PAYLOAD); await send(PAYLOAD);
    assert.deepEqual(hits, [B, B], 'a resting endpoint is skipped, not hammered');
    clock.now += 2_000;
    hits.length = 0;
    await send(PAYLOAD);
    assert.deepEqual(hits, [A], 'after its rest the preferred endpoint serves again');
  } finally {
    clock.restore();
  }
});

test("a server's Retry-After stretches the rest", async () => {
  const clock = fakeClock();
  try {
    const send = _makeFailoverSend([A], async () => ({
      ok: false, status: 429, headers: { get: (name) => (name === 'retry-after' ? '9' : null) }, json: async () => ({}),
    }), 1_000, clock.wait);
    await assert.rejects(send(PAYLOAD), /HTTP 429/);
    assert.ok(clock.waits[0] >= 9_000, 'jitter never shortens Retry-After');
  } finally {
    clock.restore();
  }
});

test('a burst past the bucket is paced instead of sent at once', async () => {
  const clock = fakeClock();
  try {
    let sent = 0;
    const send = _makeFailoverSend([A, B], async (_url, init) => {
      sent += 1; const body = JSON.parse(init.body);
      return ok((Array.isArray(body) ? body : [body]).map(r => ({ id: r.id, result: '0x1' })));
    }, 1_000, clock.wait);
    for (let i = 0; i < 10; i += 1) await send(PAYLOAD);
    assert.equal(clock.waits.length, 0, 'only ten items fit the free-RPC burst');
    await send([PAYLOAD, { ...PAYLOAD, id: 2 }, { ...PAYLOAD, id: 3 }]);
    assert.equal(clock.waits.length, 1, 'past the burst a request waits for tokens');
    assert.ok(clock.waits[0] > 0 && clock.waits[0] < 1_000);
    clock.waits.length = 0;
    await send({ ...PAYLOAD, method: 'eth_getLogs' });
    assert.ok(clock.waits[0] >= 150, 'a log query costs more than a call');
    assert.equal(sent, 12);
  } finally {
    clock.restore();
  }
});

test('a rate limit that outlasts several rests arms the outage breaker', async () => {
  const clock = fakeClock();
  try {
    let hits = 0;
    const send = _makeFailoverSend([A, B], async () => {
      hits += 1;
      return { ok: false, status: 429, json: async () => ({}) };
    }, 1_000, clock.wait);
    await assert.rejects(send(PAYLOAD), /HTTP 429/);
    assert.ok(hits >= 4 && hits <= 10, `bounded retries (${hits})`);
    assert.ok(send._state.endpoints[0].strikes >= 2, 'rests doubled along the way');
    assert.ok(send._state.outageUntil > clock.now);
    const before = hits;
    await assert.rejects(send(PAYLOAD), (error) => error instanceof RpcUnavailableError);
    assert.equal(hits, before, 'inside the breaker nothing touches the network');
  } finally {
    clock.restore();
  }
});

test('three consecutive primary failures promote the fallback', async () => {
  let primaryUp = false;
  const hits = [];
  const send = _makeFailoverSend([A, B], async (url) => {
    hits.push(url);
    if (url === A && !primaryUp) throw new Error('down');
    return ok({ id: 1, result: '0xok' });
  });
  await send(PAYLOAD); await send(PAYLOAD); await send(PAYLOAD);
  assert.equal(send._state.preferred, 1, 'fallback promoted after 3 straight primary failures');
  hits.length = 0;
  await send(PAYLOAD);
  assert.deepEqual(hits, [B], 'promoted traffic skips the dead primary entirely');
});

test('every endpoint dead surfaces the last transport error', async () => {
  const send = _makeFailoverSend([A, B], async () => { throw new Error('all down'); });
  await assert.rejects(send(PAYLOAD), /all down/);
});

test('a hung endpoint is aborted with a concrete signal before failover', async () => {
  const hits = [];
  let primarySignal = null;
  const send = _makeFailoverSend([A, B], async (url, init) => {
    hits.push(url);
    if (url === B) return ok({ id: 1, result: '0x2' });
    primarySignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }, 5);

  assert.deepEqual(await send(PAYLOAD), [{ id: 1, result: '0x2' }]);
  assert.equal(primarySignal instanceof AbortSignal, true);
  assert.equal(primarySignal.aborted, true);
  assert.deepEqual(hits, [A, B]);
});

test('a fully dead chain arms a breaker: later reads fail fast, the next probe walk waits for the ladder', async () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    let hits = 0;
    let alive = false;
    const send = _makeFailoverSend([A, B], async () => {
      hits += 1;
      if (alive) return ok({ id: 1, result: '0x1' });
      throw new Error('all down');
    });
    await assert.rejects(send(PAYLOAD), /all down/);
    assert.equal(hits, 2, 'the first dead walk contacted every endpoint');
    const firstGate = send._state.outageUntil;
    assert.ok(firstGate > now && firstGate - now <= 2_400, 'the first ladder step is ~2s');

    await assert.rejects(send(PAYLOAD), (error) => error instanceof RpcUnavailableError && error.code === 'RPC_UNAVAILABLE');
    assert.equal(hits, 2, 'inside the gate nothing touches the network');

    now = firstGate + 1;
    await assert.rejects(send(PAYLOAD), /all down/);
    assert.equal(hits, 4, 'past the gate one full walk goes out again');
    assert.ok(send._state.outageUntil - now > firstGate - 1_000_000, 'a second dead walk doubles the ladder');
    assert.equal(send._state.consecutiveOutages, 2);

    alive = true;
    now = send._state.outageUntil + 1;
    assert.deepEqual(await send(PAYLOAD), [{ id: 1, result: '0x1' }]);
    assert.equal(send._state.outageUntil, 0, 'a successful walk clears the gate');
    assert.equal(send._state.consecutiveOutages, 0);
  } finally {
    Date.now = realNow;
  }
});

test('a demoted primary is re-probed from the side and restored when it answers', async () => {
  const realNow = Date.now;
  let now = 5_000_000;
  Date.now = () => now;
  try {
    const hits = [];
    let primaryAlive = false;
    const send = _makeFailoverSend([A, B], async (url, init) => {
      const method = JSON.parse(init.body).method;
      hits.push(`${url === A ? 'A' : 'B'}:${method}`);
      if (url === B) return ok({ id: 1, result: '0x2' });
      if (!primaryAlive) throw new Error('primary down');
      return ok({ id: method === 'eth_blockNumber' ? 0 : 1, result: '0x1' });
    });
    for (let i = 0; i < 3; i += 1) await send(PAYLOAD);
    assert.equal(send._state.preferred, 1, 'three primary failures promote the fallback');
    hits.length = 0;

    await send(PAYLOAD);
    assert.deepEqual(hits, ['B:eth_call'], 'inside the probe interval the fallback serves alone');
    hits.length = 0;

    now += 60_000;
    await send(PAYLOAD);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(hits, ['A:eth_blockNumber', 'B:eth_call'], 'the probe rides beside the live read, which the fallback still serves');
    assert.equal(send._state.preferred, 1, 'a probe that fails leaves the fallback preferred');
    hits.length = 0;

    primaryAlive = true;
    now += 60_000;
    await send(PAYLOAD);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(send._state.preferred, 0, 'a probe that answers restores the primary');
    hits.length = 0;
    await send(PAYLOAD);
    assert.deepEqual(hits, ['A:eth_call'], 'live traffic is back on the primary');
  } finally {
    Date.now = realNow;
  }
});

test('coming back to the page clears a breaker armed while the network was suspended', async () => {
  const send = _makeFailoverSend([A, B], async () => { throw new Error('Failed to fetch'); });
  await assert.rejects(send(PAYLOAD), /Failed to fetch/);
  await assert.rejects(send(PAYLOAD), (error) => error instanceof RpcUnavailableError);
  assert.ok(send._state.outageUntil > Date.now());
  _clearOutagesForTests();
  assert.equal(send._state.outageUntil, 0);
  assert.equal(send._state.consecutiveOutages, 0, 'the ladder starts over too');
});

const C = '/rpc/emergency';
const logs = { ...PAYLOAD, method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: '0x10000' }] };
const pruned = id => ({ id, error: { code: 4444, message: 'pruned history unavailable' } });

test('pruned history uses another free RPC without moving live state or replaying successful items', async () => {
  const hits = [];
  const send = _makeFailoverSend([A, B], async (url, init) => {
    const body = JSON.parse(init.body), requests = Array.isArray(body) ? body : [body];
    hits.push([url, requests.map(r => r.method)]);
    return ok(requests.map(r => url === A && r.method === 'eth_getLogs'
      ? pruned(r.id) : { id: r.id, result: r.method === 'eth_getLogs' ? [] : '0x1' }));
  });
  const batch = [PAYLOAD, { ...logs, id: 2 }];
  assert.deepEqual(await send(batch), [{ id: 1, result: '0x1' }, { id: 2, result: [] }]);
  await send(batch);
  assert.deepEqual(hits, [
    [A, ['eth_call', 'eth_getLogs']], [B, ['eth_getLogs']],
    [A, ['eth_call']], [B, ['eth_getLogs']],
  ]);
  assert.equal(send._state.preferred, 0);
  assert.equal(send._state.outageUntil, 0);
});

test('missing history everywhere never activates paid fallback or poisons other reads', async () => {
  const clock = fakeClock();
  try {
    const hits = [];
    const send = _makeFailoverSend([A, B], async (url, init) => {
      hits.push(url); const r = JSON.parse(init.body);
      return ok(r.method === 'eth_getLogs' ? pruned(r.id) : { id: r.id, result: '0x1' });
    }, 1000, clock.wait, { emergencyRpcUrl: C });
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(await send(logs), [pruned(1)]);
      clock.now += 40_000;
    }
    assert.deepEqual(hits, [A, B], 'remember unsupported history instead of retrying each poll');
    assert.equal(send._state.consecutiveOutages, 0);
    assert.deepEqual(await send(PAYLOAD), [{ id: 1, result: '0x1' }]);
    assert.equal(hits.at(-1), A);
  } finally { clock.restore(); }
});

test('a JSON-RPC log range refusal survives HTTP 400 for the scanner to split', async () => {
  const refused = { id: 1, error: { code: 35, message: 'ranges over 10000 blocks are not supported on free plan' } };
  const hits = [];
  const send = _makeFailoverSend([A, B], async url => {
    hits.push(url); return { ok: false, status: 400, json: async () => refused };
  });
  assert.deepEqual(await send(logs), [refused]);
  assert.deepEqual(hits, [A]);
  assert.equal(send._state.outageUntil, 0);
});

test('HTTP 400 preserves unsupported block-hash parameters for verified numeric fallback', async () => {
  const refused = { id: 1, error: { code: -32602, message: 'invalid params: expected string, blockHash unsupported' } };
  const hits = [];
  const send = _makeFailoverSend([A, B], async url => {
    hits.push(url); return { ok: false, status: 400, json: async () => refused };
  });
  assert.deepEqual(await send(PAYLOAD), [refused]);
  assert.deepEqual(hits, [A]);
  assert.equal(send._state.outageUntil, 0);
});

test('partial failover preserves a contract revert and out-of-order success exactly', async () => {
  const revert = { id: 2, error: { code: 3, message: 'execution reverted', data: '0xdeadbeef' } };
  const send = _makeFailoverSend([A, B], async (url, init) => {
    if (url === A) return ok([{ id: 3, error: { code: -32016, message: 'over rate limit' } }, revert, { id: 1, result: '0x1' }]);
    assert.deepEqual(JSON.parse(init.body).map(r => r.id), [3]);
    return ok([{ id: 3, result: '0x3' }]);
  });
  assert.deepEqual(await send([PAYLOAD, { ...PAYLOAD, id: 2 }, { ...PAYLOAD, id: 3 }]),
    [{ id: 1, result: '0x1' }, revert, { id: 3, result: '0x3' }]);
});

test('a provider batch limit learns smaller batches on the same free endpoint', async () => {
  const clock = fakeClock();
  try {
    const sizes = [];
    const send = _makeFailoverSend([A, B], async (url, init) => {
      assert.equal(url, A);
      const requests = JSON.parse(init.body); sizes.push(requests.length);
      if (requests.length > 3) return { ok: false, status: 500, json: async () => requests.map(r => ({ id: r.id,
        error: { code: 31, message: 'Batch of more than 3 requests are not allowed on free plan' } })) };
      return ok(requests.map(r => ({ id: r.id, result: '0x1' })).reverse());
    }, 1000, clock.wait);
    const batch = Array.from({ length: 8 }, (_, id) => ({ ...PAYLOAD, id }));
    assert.deepEqual(await send(batch), batch.map(r => ({ id: r.id, result: '0x1' })));
    assert.deepEqual(sizes, [8, 4, 2, 2, 2, 2]);
    assert.equal(send._state.outageUntil, 0);
  } finally { clock.restore(); }
});

test('queued requests recheck a cooldown set after they started waiting', async () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  const waits = [], hits = [];
  try {
    const send = _makeFailoverSend([A], async (_url, init) => {
      const request = JSON.parse(init.body); hits.push(now); return ok({ id: request.id, result: '0x1' });
    }, 1000, ms => new Promise(resolve => waits.push({ ms, resolve })));
    send._state.endpoints[0].tokens = 0;
    const request = send(PAYLOAD);
    await new Promise(resolve => setImmediate(resolve));
    const endpoint = send._state.endpoints[0];
    endpoint.coolUntil = now + 9000; endpoint.rate = 1;
    now += waits[0].ms; waits[0].resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(hits.length, 0, 'an old token reservation does not ignore the new rest');
    now += waits[1].ms; waits[1].resolve();
    await request;
    assert.ok(hits[0] >= 1_009_000);
  } finally { Date.now = realNow; }
});

test('a rate-limit response to the recovery probe cannot promote the primary', async () => {
  const clock = fakeClock();
  try {
    const send = _makeFailoverSend([A, B], async (url, init) => {
      const request = JSON.parse(init.body);
      return ok(url === A ? { id: request.id, error: { code: -32016, message: 'over rate limit' } }
        : { id: request.id, result: '0x1' });
    }, 1000, clock.wait);
    send._state.preferred = 1;
    await send(PAYLOAD);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(send._state.preferred, 1);
  } finally { clock.restore(); }
});

test('paid fallback requires three complete free failures and thirty seconds, then returns to free', async () => {
  const clock = fakeClock();
  try {
    let freeUp = false;
    const hits = [];
    const send = _makeFailoverSend([A, B], async (url, init) => {
      hits.push(url);
      if (url !== C && !freeUp) throw new Error('free RPC down');
      const body = JSON.parse(init.body);
      return ok((Array.isArray(body) ? body : [body]).map(r => ({ id: r.id, result: '0x1' })));
    }, 1000, clock.wait, { emergencyRpcUrl: C });
    await assert.rejects(send(PAYLOAD), /free RPC down/);
    clock.now = send._state.outageUntil + 1;
    await assert.rejects(send(PAYLOAD), /free RPC down/);
    assert.ok(!hits.includes(C));
    clock.now += 30_000;
    assert.deepEqual(await send(PAYLOAD), [{ id: 1, result: '0x1' }]);
    assert.equal(hits.at(-1), C);
    assert.ok(send._state.preferred < 2, 'paid can never become the preferred endpoint');
    freeUp = true;
    clock.now = send._state.outageUntil + 1;
    hits.length = 0;
    await send(PAYLOAD);
    assert.ok(hits.length && !hits.includes(C));
    assert.equal(send._state.consecutiveOutages, 0);
  } finally { clock.restore(); }
});

test('an emergency outage serves live reads but never sends logs, backfill headers, or writes to paid', async () => {
  const clock = fakeClock();
  try {
    const hits = [];
    const send = _makeFailoverSend([A, B], async (url, init) => {
      assert.equal(url, C); const requests = JSON.parse(init.body); hits.push(...requests);
      return ok(requests.map(r => ({ id: r.id, result: '0x1' })));
    }, 1000, clock.wait, { emergencyRpcUrl: C });
    Object.assign(send._state, { outageStartedAt: clock.now - 31_000, consecutiveOutages: 3, outageUntil: clock.now + 10_000 });
    const output = await send([PAYLOAD, { ...logs, id: 2 }, { ...PAYLOAD, id: 3, method: 'eth_sendRawTransaction' },
      { ...PAYLOAD, id: 4, method: 'eth_getBlockByNumber', params: ['0x1', false] }]);
    assert.deepEqual(hits, [PAYLOAD]);
    assert.equal(output[0].result, '0x1');
    assert.ok(output.slice(1).every(r => r.error));
  } finally { clock.restore(); }
});

test('emergency calls are bounded per minute and per page, including concurrent callers', async () => {
  const clock = fakeClock();
  try {
    let paid = 0;
    const send = _makeFailoverSend([A, B], async (url, init) => {
      assert.equal(url, C); const requests = JSON.parse(init.body); paid += requests.length;
      return ok(requests.map(r => ({ id: r.id, result: '0x1' })));
    }, 1000, clock.wait, { emergencyRpcUrl: C });
    const outage = () => Object.assign(send._state, { outageStartedAt: clock.now - 31_000,
      consecutiveOutages: 3, outageUntil: clock.now + 10_000 });
    for (let minute = 0; minute < 11; minute++) {
      outage();
      const outcomes = await Promise.allSettled(Array.from({ length: 40 }, (_, id) => send({ ...PAYLOAD, id })));
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, minute < 10 ? 30 : 0);
      clock.now += 60_000;
    }
    assert.equal(paid, 300);
  } finally { clock.restore(); }
});

test('emergency is disabled without configuration, while hidden, or while offline', async () => {
  const clock = fakeClock();
  const visibility = document.visibilityState;
  const online = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine');
  try {
    for (const mode of ['unconfigured', 'hidden', 'offline']) {
      const hits = [];
      const send = _makeFailoverSend([A, B], async url => { hits.push(url); throw new Error('unexpected request'); },
        1000, clock.wait, mode === 'unconfigured' ? {} : { emergencyRpcUrl: C });
      Object.assign(send._state, { outageStartedAt: clock.now - 31_000, consecutiveOutages: 3, outageUntil: clock.now + 10_000 });
      document.visibilityState = mode === 'hidden' ? 'hidden' : 'visible';
      Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: mode !== 'offline' });
      await assert.rejects(send(PAYLOAD), RpcUnavailableError);
      assert.deepEqual(hits, []);
    }
    assert.throws(() => _makeFailoverSend([A], undefined, undefined, undefined,
      { emergencyRpcUrl: 'https://paid.invalid/key' }), /same-origin/);
  } finally {
    clock.restore(); document.visibilityState = visibility;
    if (online) Object.defineProperty(globalThis.navigator, 'onLine', online);
    else delete globalThis.navigator.onLine;
  }
});
