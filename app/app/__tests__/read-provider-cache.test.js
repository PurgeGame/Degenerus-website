// /app/app/__tests__/read-provider-cache.test.js — C15 follow-on.
//
// Run: cd website && node --test app/app/__tests__/read-provider-cache.test.js
//
// The shared read provider answers repeat chain questions from memory. A cold
// load was measured issuing 245 eth_calls that asked only 80 distinct
// questions; batching packed them into fewer POSTs but still paid for each.
//
// What must hold:
//   - identical concurrent reads share ONE wire call
//   - a repeat inside the one-second window is served from the completed cache
//   - a PINNED block read is immutable, so repeats never hit the wire
//   - 'pending', unknown request fields, and errors are NEVER cached
//   - different arguments are different questions
//   - invalidateReadCache() (the receipt boundary) drops every class

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

const rp = await import('../read-provider.js');

const GAME = '0xe57d3910ddd15831942c77be8757ad8a4bda01f7';

/** A stub provider that counts wire calls and resolves with a stamped value. */
function stubProvider(impl) {
  const state = { calls: [] };
  const provider = {
    call(tx) {
      state.calls.push(tx);
      return impl ? impl(tx, state.calls.length) : Promise.resolve(`0x${state.calls.length}`);
    },
  };
  rp.attachReadCache(provider);
  return { provider, state };
}

afterEach(() => {
  rp.invalidateReadCache();
});

test('identical concurrent reads share one wire call', async () => {
  let release;
  const { provider, state } = stubProvider(() => new Promise((resolve) => { release = () => resolve('0xabc'); }));

  const first = provider.call({ to: GAME, data: '0x7f84d03d' });
  const second = provider.call({ to: GAME, data: '0x7f84d03d' });
  const third = provider.call({ to: GAME, data: '0x7f84d03d' });
  assert.equal(state.calls.length, 1);

  release();
  assert.deepEqual(await Promise.all([first, second, third]), ['0xabc', '0xabc', '0xabc']);
});

test('a repeat after the response lands is served from the one-second window', async () => {
  const { provider, state } = stubProvider();

  assert.equal(await provider.call({ to: GAME, data: '0x7f84d03d' }), '0x1');
  // Sequential, not concurrent: in-flight sharing cannot catch this one.
  assert.equal(await provider.call({ to: GAME, data: '0x7f84d03d' }), '0x1');
  assert.equal(state.calls.length, 1);
});

test('different calldata is a different question', async () => {
  const { provider, state } = stubProvider();

  await provider.call({ to: GAME, data: '0x7f84d03d' });
  await provider.call({ to: GAME, data: '0xfd5ddb6e' });
  assert.equal(state.calls.length, 2);
});

test('a pinned block read is immutable and never repeats on the wire', async () => {
  const { provider, state } = stubProvider();

  await provider.call({ to: GAME, data: '0x13cc169c', blockTag: '0x2b5ce31' });
  await provider.call({ to: GAME, data: '0x13cc169c', blockTag: '0x2b5ce31' });
  await provider.call({ to: GAME, data: '0x13cc169c', blockTag: 45469233 });
  assert.equal(state.calls.length, 1, 'hex and numeric forms of one block are one question');

  // A different block is a different question.
  await provider.call({ to: GAME, data: '0x13cc169c', blockTag: '0x2b5ce38' });
  assert.equal(state.calls.length, 2);
  assert.equal(rp._readCacheStatsForTests().pinned, 2);
});

test("'pending' is never cached", async () => {
  const { provider, state } = stubProvider();

  await provider.call({ to: GAME, data: '0x7f84d03d', blockTag: 'pending' });
  await provider.call({ to: GAME, data: '0x7f84d03d', blockTag: 'pending' });
  assert.equal(state.calls.length, 2);
});

test('an unrecognized request field bypasses the cache entirely', async () => {
  const { provider, state } = stubProvider();

  // `value` means this is not the pure read shape the cache reasons about.
  await provider.call({ to: GAME, data: '0x7f84d03d', value: 1n });
  await provider.call({ to: GAME, data: '0x7f84d03d', value: 1n });
  assert.equal(state.calls.length, 2);
  assert.equal(rp._readCacheKey({ to: GAME, data: '0x7f84d03d', value: 1n }), null);
});

test('a failed read is not cached — the next caller retries', async () => {
  const { provider, state } = stubProvider((_tx, n) => (
    n === 1 ? Promise.reject(new Error('rpc 429')) : Promise.resolve('0xok')
  ));

  await assert.rejects(provider.call({ to: GAME, data: '0x7f84d03d' }), /rpc 429/);
  assert.equal(await provider.call({ to: GAME, data: '0x7f84d03d' }), '0xok');
  assert.equal(state.calls.length, 2);
});

test('invalidateReadCache drops both the windowed and the pinned class', async () => {
  const { provider, state } = stubProvider();

  await provider.call({ to: GAME, data: '0x7f84d03d' });
  await provider.call({ to: GAME, data: '0x13cc169c', blockTag: '0x2b5ce31' });
  assert.equal(state.calls.length, 2);

  rp.invalidateReadCache();
  assert.deepEqual(rp._readCacheStatsForTests(), { recent: 0, pinned: 0, inflight: 0 });

  await provider.call({ to: GAME, data: '0x7f84d03d' });
  await provider.call({ to: GAME, data: '0x13cc169c', blockTag: '0x2b5ce31' });
  assert.equal(state.calls.length, 4, 'the receipt boundary forces both classes back to the chain');
});

test('the same question from two callers is one key regardless of address case', async () => {
  const { provider, state } = stubProvider();

  await provider.call({ to: GAME, data: '0x7f84d03d' });
  await provider.call({ to: GAME.toUpperCase().replace('0X', '0x'), data: '0x7f84d03d' });
  assert.equal(state.calls.length, 1);
});

test('attachReadCache is idempotent — double attach does not double-wrap', async () => {
  const { provider, state } = stubProvider();
  rp.attachReadCache(provider);
  rp.attachReadCache(provider);

  await provider.call({ to: GAME, data: '0x7f84d03d' });
  await provider.call({ to: GAME, data: '0x7f84d03d' });
  assert.equal(state.calls.length, 1);
});
