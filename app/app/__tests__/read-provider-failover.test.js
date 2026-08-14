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
//     and never triggers failover
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

const { _makeFailoverSend } = await import('../read-provider.js');

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
