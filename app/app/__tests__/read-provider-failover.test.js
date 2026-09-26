// /app/app/__tests__/read-provider-failover.test.js
//
// Run: cd website && node --test app/app/__tests__/read-provider-failover.test.js
//
// The failover `_send` walks the endpoint list on TRANSPORT failures only.
// What must hold:
//   - a healthy primary is the only endpoint contacted
//   - a network error, a non-2xx status, and an unparseable body each fail
//     over to the next endpoint FOR THAT REQUEST
//   - a JSON-RPC error object inside a 200 (a revert) is returned unchanged
//     and never triggers failover, EXCEPT a per-item rate limit (-32016,
//     -32007), which is the endpoint refusing the request and fails over like a 429
//   - a walk every endpoint refused for rate retries after a short pause
//     before the outage breaker arms
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

const { _makeFailoverSend, RpcUnavailableError } = await import('../read-provider.js');

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
  const send = _makeFailoverSend([A, B], async (url) => {
    hits.push(url);
    return url === A ? ok([{ id: 1, result: '0x1' }, { id: 2, error: { code: -32016, message: 'over rate limit' } }]) : ok([{ id: 1, result: '0x1' }, { id: 2, result: '0x2' }]);
  });
  assert.deepEqual(await send([PAYLOAD, { ...PAYLOAD, id: 2 }]), [{ id: 1, result: '0x1' }, { id: 2, result: '0x2' }]);
  assert.deepEqual(hits, [A, B]);
  const refused = { id: 1, error: { code: -32005, message: 'query returned more than 10000 results' } };
  const once = [];
  const sendRange = _makeFailoverSend([A, B], async (url) => { once.push(url); return ok(refused); });
  assert.deepEqual(await sendRange(PAYLOAD), [refused]);
  assert.deepEqual(once, [A]);
});

test('a walk refused for rate everywhere retries after a pause instead of failing', async () => {
  // sepolia.base.org's refusal: HTTP 200 carrying -32007 "25/second request limit reached".
  const limited = { id: 1, error: { code: -32007, message: '25/second request limit reached - reduce calls per second' } };
  let refusals = 2;
  const hits = [];
  const waits = [];
  const send = _makeFailoverSend([A, B], async (url) => {
    hits.push(url);
    if (refusals > 0) { refusals -= 1; return ok(limited); }
    return ok({ id: 1, result: '0x1' });
  }, 1_000, async (ms) => { waits.push(ms); });
  assert.deepEqual(await send(PAYLOAD), [{ id: 1, result: '0x1' }]);
  assert.deepEqual(hits, [A, B, A], 'the whole walk was refused, then the retry walk succeeded');
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 400 && waits[0] <= 600, 'the first pause is ~500ms');
  assert.equal(send._state.outageUntil, 0, 'a burst never arms the outage breaker');
});

test('a rate limit that outlasts the retries arms the outage breaker', async () => {
  const waits = [];
  let hits = 0;
  const send = _makeFailoverSend([A, B], async () => {
    hits += 1;
    return { ok: false, status: 429, json: async () => ({}) };
  }, 1_000, async (ms) => { waits.push(ms); });
  await assert.rejects(send(PAYLOAD), /HTTP 429/);
  assert.equal(hits, 6, 'the first walk plus two retry walks');
  assert.equal(waits.length, 2);
  assert.ok(waits[1] > waits[0], 'the second pause is longer');
  assert.ok(send._state.outageUntil > 0);
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
