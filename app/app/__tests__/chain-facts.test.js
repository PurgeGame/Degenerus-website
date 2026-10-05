import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventFacts } from '../../chain/facts.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';

async function history() {
  const fixture = await rpcFixture();
  for (let i = 0; i < 40; i++) {
    await fixture.event('GAME', 'DegeneretteBetPlaced', { player: PLAYER, index: 7, betId: i, packed: i + 1 });
  }
  return fixture;
}

test('large event histories yield to the browser without losing order or values', async t => {
  const fixture = await history();
  let ticks = 0, turns = 0;
  t.mock.method(performance, 'now', () => ++ticks * 10);
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => schedule(() => {
    if (delay === 0) turns++;
    callback(...args);
  }, delay));
  const rows = await eventFacts(fixture.s, ['DegeneretteBetPlaced'], { contract: 'GAME', player: PLAYER });
  assert.ok(turns >= 2, 'input gets a turn between decode slices');
  assert.deepEqual(rows.map(row => row.args.betId), Array.from({ length: 40 }, (_, i) => String(i)));
  assert.deepEqual(rows.map(row => row.args.packed), Array.from({ length: 40 }, (_, i) => String(i + 1)));
});

test('an account change can cancel a large history between decode slices', async t => {
  const fixture = await history();
  const controller = new AbortController();
  let ticks = 0;
  t.mock.method(performance, 'now', () => ++ticks * 10);
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => schedule(() => {
    if (delay === 0) controller.abort();
    callback(...args);
  }, delay));
  await assert.rejects(eventFacts(fixture.s, ['DegeneretteBetPlaced'], {
    contract: 'GAME', player: PLAYER, signal: controller.signal,
  }), { name: 'AbortError' });
});
