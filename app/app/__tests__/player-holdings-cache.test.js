// playerHoldings: far-future holdings (active+6..active+100) are read once per page and wallet, then
// served from cache until a full far-future scan refreshes them, the page reloads, or
// this page confirms a buy/open. Near counts read no generation-window stamps above active+2 (audit
// 26ad5863 mints at most two levels ahead). Both cut reads the combined-account poll made every cycle.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { playerHoldings, __resetFarHoldingsCacheForTest } from '../../chain/player.js';
import { farFutureQueue, clearFarHoldings } from '../../chain/positions.js';
import { ACTIVE_CHAIN_ID } from './helpers/active-chain.js';

const PLAYER = `0x${'b'.repeat(40)}`;
const WALLET_ID = 37;

/** A snapshot whose far-future registry holds `farOwed` ({level: entries}) for PLAYER (wallet ID 37).
 *  Lanes sit where DegenerusGameStorage writes them: slot (level - 1) % 100 of farFutureOwed[id], the
 *  queue header's tag naming the level once past the first cycle. `reads.pending` counts reads of the
 *  owner's uint256[13] array words — a full read is 13, whatever the window. */
function fakeSnapshot(active, farOwed = {}) {
  const reads = { pending: 0, ids: 0, stamps: [] };
  const lanes = new Map(Object.entries(farOwed).map(([level, amount]) => [(Number(level) - 1) % 100, { level: Number(level), amount: BigInt(amount) }]));
  const s = {
    block: { number: 100, hash: `0x${'0'.repeat(64)}` },
    client: { chain: { id: ACTIVE_CHAIN_ID }, address: (name) => `0x${name === 'GAME' ? 'a'.repeat(40) : 'c'.repeat(40)}` },
    async call(contract, method) {
      if (method === 'activeTicketLevelOf') return BigInt(active);
      if (method === 'walletIdOf_g3120') { reads.ids += 1; return BigInt(WALLET_ID); }
      if (method === 'entriesOwedView') return 0n;
      throw new Error(`unexpected call ${contract}.${method}`);
    },
    async field(contract, name, ...keys) {
      if (name === 'ticketGenerationStartBlock') { reads.stamps.push(keys.length); return 0n; }
      if (name === 'ticketPending') return 0n;
      if (name === 'ticketQueue') { // the queue header's length word: the cycle's level tag sits at bits 32..55
        const lane = lanes.get((Number(keys[0]) & 0x3fffff) - 1);
        return lane && lane.level > 100 ? BigInt(lane.level) << 32n : 0n;
      }
      if (name === 'farFutureOwed') {
        reads.pending += 1;
        let word = 0n;
        for (const [position, { amount }] of lanes) {
          if (amount && Math.floor(position / 8) === Number(keys[1])) word |= (0x80000000n | amount) << BigInt((position % 8) * 32);
        }
        return word;
      }
      throw new Error(`unexpected field ${contract}.${name}`);
    },
  };
  return { s, reads };
}

beforeEach(() => { __resetFarHoldingsCacheForTest(); });

test('far-future holdings are read once, then served from cache on every later poll', async () => {
  const first = fakeSnapshot(10, { 40: 3 });
  const rows = await playerHoldings(first.s, PLAYER);
  assert.equal(first.reads.pending, 13, 'first load reads the whole uint256[13] once, not one read per level');
  assert.equal(first.reads.ids, 1, 'resolve the wallet ID once for the whole scan');
  assert.deepEqual(rows.map((row) => [row.level, row.entryCount]), [[40, 3]]);
  const later = fakeSnapshot(10, { 40: 3 });
  assert.deepEqual((await playerHoldings(later.s, PLAYER)).map((row) => row.level), [40]);
  assert.equal(later.reads.pending, 0, 'a repeat poll must not re-walk the registry');
});

test('a level change re-windows the cached rows without re-walking the registry', async () => {
  await playerHoldings(fakeSnapshot(10, { 16: 2, 40: 3 }).s, PLAYER);
  const moved = fakeSnapshot(11, { 16: 2, 40: 3 });
  const rows = await playerHoldings(moved.s, PLAYER);
  assert.equal(moved.reads.pending, 0);
  // Level 16 is now active+5 — the near range owns it — so it leaves the far window.
  assert.deepEqual(rows.map((row) => row.level), [40]);
});

test('a full far-future scan refreshes the cache', async () => {
  await playerHoldings(fakeSnapshot(10, { 40: 3 }).s, PLAYER);
  await farFutureQueue(fakeSnapshot(10, { 40: 3, 50: 7 }).s, PLAYER);
  const after = fakeSnapshot(10, { 40: 3, 50: 7 });
  assert.deepEqual((await playerHoldings(after.s, PLAYER)).map((row) => row.level), [40, 50]);
  assert.equal(after.reads.pending, 0);
});

test('a confirmed buy/open clears the cache so the next poll reads fresh', async () => {
  await playerHoldings(fakeSnapshot(10, { 40: 3 }).s, PLAYER);
  clearFarHoldings(); // what the degenerus:tx-confirmed listener does
  const fresh = fakeSnapshot(10, { 40: 3, 60: 1 });
  assert.deepEqual((await playerHoldings(fresh.s, PLAYER)).map((row) => row.level), [40, 60]);
  assert.equal(fresh.reads.pending, 13);
});

test('near counts read generation-window stamps only up to active+2', async () => {
  const { s, reads } = fakeSnapshot(10);
  await playerHoldings(s, PLAYER);
  // generationWindow(L) reads stamps L and L+2; only L = 10, 11, 12 may be asked.
  assert.deepEqual([...new Set(reads.stamps)].sort((a, b) => a - b), [0]);
});

test('an unregistered wallet needs no pending balance reads', async () => {
  const { s, reads } = fakeSnapshot(10);
  const call = s.call.bind(s);
  s.call = async (contract, method, ...rest) => method === 'walletIdOf_g3120' ? 0n : call(contract, method, ...rest);
  const result = await farFutureQueue(s, PLAYER);
  assert.deepEqual(result.rows, []);
  assert.equal(reads.pending, 0);
});

test('a lane under another cycle\'s tag never masquerades as a future holding', async () => {
  const reused = fakeSnapshot(10, { 40: 3 });
  const reusedField = reused.s.field.bind(reused.s);
  // The slot's queue has moved to a later cycle: its held lane belongs to that level, not this one.
  reused.s.field = async (contract, name, ...keys) => name === 'ticketQueue'
    ? BigInt((Number(keys[0]) & 0x3fffff) + 100) << 32n
    : reusedField(contract, name, ...keys);
  assert.deepEqual((await farFutureQueue(reused.s, PLAYER)).rows, []);
});


test('far-future lanes wrap at 100 slots and reject an older occupant', async () => {
  const current = fakeSnapshot(99, { 101: 8 });
  assert.deepEqual((await farFutureQueue(current.s, PLAYER, { levels: [101] })).rows.map(row => [row.level, row.entryCount]), [[101, 8]]);
  clearFarHoldings(current.s, PLAYER);
  const stale = fakeSnapshot(99, { 1: 16 });
  assert.deepEqual((await farFutureQueue(stale.s, PLAYER, { levels: [101] })).rows, []);
});
