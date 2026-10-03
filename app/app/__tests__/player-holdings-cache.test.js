// playerHoldings: far-future holdings (active+6..active+100) are read once per page and wallet, then
// served from cache until the salvage view opens (its full scan refreshes them), the page reloads, or
// this page confirms a buy/open. Near counts read no generation-window stamps above active+2 (audit
// 26ad5863 mints at most two levels ahead). Both cut reads the combined-account poll made every cycle.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { playerHoldings, __resetFarHoldingsCacheForTest } from '../../chain/player.js';
import { farFutureQueue, clearFarHoldings } from '../../chain/positions.js';
import { useSchema, CURRENT_SCHEMA_HASH, BEFORE_STABLE_OWNERS_SCHEMA_HASH } from '../../chain/schema.js';

const PLAYER = `0x${'b'.repeat(40)}`;

/** A snapshot whose far-future registry holds `farOwed` ({level: entries}) for PLAYER. Lanes sit where
 *  DegenerusGameStorage writes them (audit 65267b9d1): slot (level - 1) % 100 of farFutureOwed[id], its
 *  queue tag naming the level once past the first cycle. `reads.pending` counts reads of the owner's
 *  uint256[13] array words — a full read is 13, whatever the window. */
function fakeSnapshot(active, farOwed = {}) {
  const reads = { pending: 0, ids: 0, stamps: [] };
  const lanes = new Map(Object.entries(farOwed).map(([level, amount]) => [(Number(level) - 1) % 100, { level: Number(level), amount: BigInt(amount) }]));
  const s = {
    block: { number: 100, hash: `0x${'0'.repeat(64)}` },
    client: { chain: { id: 84532 }, address: (name) => `0x${name === 'GAME' ? 'a'.repeat(40) : 'c'.repeat(40)}` },
    async call(contract, method) {
      if (method === 'activeTicketLevelOf') return BigInt(active);
      if (method === 'entriesOwedView') return 0n;
      throw new Error(`unexpected call ${contract}.${method}`);
    },
    async field(contract, name, ...keys) {
      if (name === 'ticketGenerationStartBlock') { reads.stamps.push(Number(keys[0])); return 0n; }
      if (name === 'ticketOwnerId') { reads.ids += 1; return 1n; }
      if (name === 'ticketOwners') return PLAYER;
      if (name === 'ticketQueueLevels') {
        const lane = lanes.get((Number(keys[0]) & 0x3fffff) - 1);
        return lane && lane.level > 100 ? BigInt(lane.level) : 0n;
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

beforeEach(() => { useSchema(CURRENT_SCHEMA_HASH); __resetFarHoldingsCacheForTest(); });

test('far-future holdings are read once, then served from cache on every later poll', async () => {
  const first = fakeSnapshot(10, { 40: 3 });
  const rows = await playerHoldings(first.s, PLAYER);
  assert.equal(first.reads.pending, 13, 'first load reads the whole uint256[13] once, not one read per level');
  assert.equal(first.reads.ids, 1, 'resolve the global owner ID once for the whole scan');
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

test('opening the salvage view (a full far-future scan) refreshes the cache', async () => {
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
  assert.deepEqual([...new Set(reads.stamps)].sort((a, b) => a - b), [10, 11, 12, 13, 14]);
});

test('an unregistered wallet needs no pending balance reads', async () => {
  const { s, reads } = fakeSnapshot(10);
  const field = s.field.bind(s);
  s.field = async (contract, name, ...keys) => name === 'ticketOwnerId' ? 0n : field(contract, name, ...keys);
  const result = await farFutureQueue(s, PLAYER);
  assert.deepEqual(result.rows, []);
  assert.equal(reads.pending, 0);
});

test('an unheld lane, or a lane under another cycle\'s tag, never masquerades as a future holding', async () => {
  const unheld = fakeSnapshot(10);
  const field = unheld.s.field.bind(unheld.s);
  // Every lane carries entries but none has the held bit (bit 31).
  unheld.s.field = async (contract, name, ...keys) => name === 'farFutureOwed'
    ? Array.from({ length: 8 }, (_, k) => 7n << BigInt(32 * k)).reduce((a, b) => a | b)
    : field(contract, name, ...keys);
  assert.deepEqual((await farFutureQueue(unheld.s, PLAYER)).rows, []);
  const reused = fakeSnapshot(10, { 40: 3 });
  const reusedField = reused.s.field.bind(reused.s);
  // The slot's queue has moved to a later cycle: its held lane belongs to that level, not this one.
  reused.s.field = async (contract, name, ...keys) => name === 'ticketQueueLevels'
    ? BigInt((Number(keys[0]) & 0x3fffff) + 100)
    : reusedField(contract, name, ...keys);
  assert.deepEqual((await farFutureQueue(reused.s, PLAYER)).rows, []);
});


test('a pinned older deployment still reads its per-level owner records', async () => {
  useSchema(BEFORE_STABLE_OWNERS_SCHEMA_HASH);
  try {
    const { s } = fakeSnapshot(10);
    s.field = async (_contract, name, ...keys) => {
      if (name === 'entryOwnerPosition') return Number(keys[0]) === (40 | (1 << 22)) ? 2n : 0n;
      if (name === 'lvlEntryOwner') return { owner: PLAYER, owed: (2n << 48n) | (3n << 8n) };
      throw new Error(`unexpected historical field ${name}`);
    };
    const result = await farFutureQueue(s, PLAYER, { levels: [40] });
    assert.deepEqual(result.rows.map(row => [row.level, row.entryCount, row.ownerPosition]), [[40, 3, 2]]);
  } finally { useSchema(CURRENT_SCHEMA_HASH); }
});


test('far-future lanes wrap at 100 slots and reject an older occupant', async () => {
  const current = fakeSnapshot(99, { 101: 8 });
  assert.deepEqual((await farFutureQueue(current.s, PLAYER, { levels: [101] })).rows.map(row => [row.level, row.entryCount]), [[101, 8]]);
  clearFarHoldings(current.s, PLAYER);
  const stale = fakeSnapshot(99, { 1: 16 });
  assert.deepEqual((await farFutureQueue(stale.s, PLAYER, { levels: [101] })).rows, []);
});
