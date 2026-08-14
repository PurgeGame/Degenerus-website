// /app/app/__tests__/read-provider-multicall.test.js — C15 step 3.
//
// Run: cd website && node --test app/app/__tests__/read-provider-multicall.test.js
//
// Distinct same-window questions must travel as ONE Multicall3 aggregate.
// What must hold:
//   - concurrent pure reads collapse into a single eth_call to Multicall3,
//     each caller receiving its own decoded answer
//   - a chain WITHOUT Multicall3 (the local anvil sim) drains every queued
//     call direct — behavior identical to before this layer existed
//   - a sub-call that reverted inside the aggregate is retried direct so the
//     caller gets the genuine error, and an aggregate-level failure sends
//     every entry direct — correctness never depends on the wrapper contract
//   - sender-flavored (`from`) reads bypass aggregation entirely
//   - pinned-block groups aggregate separately from `latest` and carry the tag
//   - a lone question goes direct — no pointless wrapper hop
//   - composed under the read cache, repeats hit memory, misses aggregate

import { test, afterEach } from 'node:test';
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

const { ethers } = await import('ethers');
const rp = await import('../read-provider.js');

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const GAME = '0xe57d3910ddd15831942c77be8757ad8a4bda01f7';
const COIN = '0x280a5067694f9deffa767f81d257fbd4f3ac557b';
const IFACE = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]);

/**
 * Stub provider. `answers` maps callData -> hex result (or {revert: true}).
 * Aggregates are decoded and answered per entry, so tests exercise the REAL
 * encode/decode path.
 */
function stubProvider({ code = '0x6080', answers = {} } = {}) {
  const state = { calls: [], getCodeCount: 0 };
  const provider = {
    getCode(address) {
      state.getCodeCount += 1;
      assert.equal(address, MULTICALL3);
      return Promise.resolve(code);
    },
    call(tx) {
      state.calls.push(tx);
      if (String(tx.to).toLowerCase() === MULTICALL3.toLowerCase()) {
        const [calls] = IFACE.decodeFunctionData('aggregate3', tx.data);
        const results = calls.map((c) => {
          const a = answers[c.callData];
          if (a && a.revert) return { success: false, returnData: '0x' };
          return { success: true, returnData: a ?? '0xaa' };
        });
        return Promise.resolve(IFACE.encodeFunctionResult('aggregate3', [results]));
      }
      const a = answers[tx.data];
      if (a && a.revert) return Promise.reject(new Error(a.message ?? 'execution reverted'));
      return Promise.resolve(a ?? '0xdd');
    },
  };
  rp.attachMulticall(provider);
  return { provider, state };
}

const aggCalls = (state) => state.calls.filter((c) => String(c.to).toLowerCase() === MULTICALL3.toLowerCase());
const directCalls = (state) => state.calls.filter((c) => String(c.to).toLowerCase() !== MULTICALL3.toLowerCase());

afterEach(() => {
  rp.invalidateReadCache();
});

test('concurrent distinct reads collapse into one Multicall3 aggregate', async () => {
  const { provider, state } = stubProvider({
    answers: { '0x01': '0x1111', '0x02': '0x2222', '0x03': '0x3333' },
  });
  const [a, b, c] = await Promise.all([
    provider.call({ to: GAME, data: '0x01' }),
    provider.call({ to: COIN, data: '0x02' }),
    provider.call({ to: GAME, data: '0x03' }),
  ]);
  assert.deepEqual([a, b, c], ['0x1111', '0x2222', '0x3333']);
  assert.equal(aggCalls(state).length, 1, 'one aggregate on the wire');
  assert.equal(directCalls(state).length, 0);
});

test('a chain without Multicall3 drains everything direct — old behavior exactly', async () => {
  const { provider, state } = stubProvider({ code: '0x', answers: { '0x01': '0x11', '0x02': '0x22' } });
  const [a, b] = await Promise.all([
    provider.call({ to: GAME, data: '0x01' }),
    provider.call({ to: GAME, data: '0x02' }),
  ]);
  assert.deepEqual([a, b], ['0x11', '0x22']);
  assert.equal(aggCalls(state).length, 0);
  assert.equal(directCalls(state).length, 2);
});

test('a reverted sub-call is retried direct and surfaces the genuine error', async () => {
  const { provider, state } = stubProvider({
    answers: { '0x01': '0x11', '0x02': { revert: true, message: 'Purchase: sold out' } },
  });
  const ok = provider.call({ to: GAME, data: '0x01' });
  const bad = provider.call({ to: GAME, data: '0x02' });
  assert.equal(await ok, '0x11');
  await assert.rejects(bad, /sold out/);
  assert.equal(aggCalls(state).length, 1);
  assert.equal(directCalls(state).length, 1, 'only the failed entry went direct');
});

test('an aggregate-level failure sends every entry direct', async () => {
  // A provider whose aggregate path always fails (an RPC gas cap would look
  // like this) — every entry must still get its answer via direct calls.
  let directs = 0;
  const poisoned = {
    getCode: () => Promise.resolve('0x6080'),
    call(tx) {
      if (String(tx.to).toLowerCase() === MULTICALL3.toLowerCase()) {
        return Promise.reject(new Error('gas cap'));
      }
      directs += 1;
      return Promise.resolve(tx.data === '0x01' ? '0x11' : '0x22');
    },
  };
  rp.attachMulticall(poisoned);
  const [a, b] = await Promise.all([
    poisoned.call({ to: GAME, data: '0x01' }),
    poisoned.call({ to: GAME, data: '0x02' }),
  ]);
  assert.deepEqual([a, b], ['0x11', '0x22']);
  assert.equal(directs, 2, 'both entries fell back to direct calls');
});

test('a sender-flavored read bypasses aggregation', async () => {
  const { provider, state } = stubProvider({ answers: { '0x01': '0x11', '0x02': '0x22', '0x03': '0x33' } });
  const [a, b, c] = await Promise.all([
    provider.call({ to: GAME, data: '0x01' }),
    provider.call({ to: GAME, data: '0x03' }),
    provider.call({ to: GAME, data: '0x02', from: GAME }),
  ]);
  assert.deepEqual([a, b, c], ['0x11', '0x33', '0x22']);
  assert.equal(aggCalls(state).length, 1, 'the two pure reads aggregated');
  assert.equal(directCalls(state).length, 1, 'the from-bearing call went straight through');
  assert.equal(directCalls(state)[0].from, GAME);
});

test('pinned-block reads aggregate separately and carry the tag', async () => {
  const { provider, state } = stubProvider({
    answers: { '0x01': '0x11', '0x02': '0x22', '0x03': '0x33', '0x04': '0x44' },
  });
  await Promise.all([
    provider.call({ to: GAME, data: '0x01' }),
    provider.call({ to: GAME, data: '0x02' }),
    provider.call({ to: GAME, data: '0x03', blockTag: '0x2b5ce31' }),
    provider.call({ to: GAME, data: '0x04', blockTag: '0x2b5ce31' }),
  ]);
  const aggs = aggCalls(state);
  assert.equal(aggs.length, 2, 'latest and the pinned block are separate aggregates');
  const pinned = aggs.find((c) => c.blockTag != null);
  assert.ok(pinned, 'the pinned aggregate carries its blockTag');
  assert.equal(pinned.blockTag, '0x2b5ce31');
});

test('a lone question goes direct — no wrapper hop', async () => {
  const { provider, state } = stubProvider({ answers: { '0x01': '0x11' } });
  assert.equal(await provider.call({ to: GAME, data: '0x01' }), '0x11');
  assert.equal(aggCalls(state).length, 0);
  assert.equal(directCalls(state).length, 1);
});

test('composed under the read cache: repeats hit memory, misses aggregate', async () => {
  const { provider, state } = stubProvider({ answers: { '0x01': '0x11', '0x02': '0x22' } });
  rp.attachReadCache(provider);
  await Promise.all([
    provider.call({ to: GAME, data: '0x01' }),
    provider.call({ to: GAME, data: '0x02' }),
  ]);
  assert.equal(await provider.call({ to: GAME, data: '0x01' }), '0x11', 'served from the cache window');
  assert.equal(aggCalls(state).length, 1, 'no second wire call for the repeat');
  assert.equal(directCalls(state).length, 0);
});
