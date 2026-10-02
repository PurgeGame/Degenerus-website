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

/** A snapshot whose far-future registry holds `farOwed` ({level: entries}) for PLAYER. */
function fakeSnapshot(active, farOwed = {}) {
  const reads = { pending: 0, ids: 0, stamps: [] };
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
      if (name === 'ticketPending') {
        reads.pending += 1;
        const entry = Object.entries(farOwed).find(([level]) => ((Number(level) - 1) % 128) + 1 === Number(keys[0]));
        const amount = BigInt(entry?.[1] ?? 0);
        return (1n << 255n) | (amount ? (((amount << 8n) | (1n << 41n)) << 84n) | (BigInt(entry[0]) << 174n) : 0n);
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
  assert.equal(first.reads.pending, 95, 'first load walks the 95 far-future levels');
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
  assert.equal(fresh.reads.pending, 95);
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

test('the sentinel and normal lanes never masquerade as future holdings', async () => {
  const { s } = fakeSnapshot(10);
  const field = s.field.bind(s);
  s.field = async (contract, name, ...keys) => name === 'ticketPending'
    ? (1n << 255n) | (7n << 8n) | (1n << 41n) | (11n << 50n) | (1n << 83n)
    : field(contract, name, ...keys);
  assert.deepEqual((await farFutureQueue(s, PLAYER)).rows, []);
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


test('far-future pending words wrap physical keys and reject an older occupant', async () => {
  const current = fakeSnapshot(127, { 129: 8 });
  assert.deepEqual((await farFutureQueue(current.s, PLAYER, { levels: [129] })).rows.map(row => [row.level, row.entryCount]), [[129, 8]]);
  clearFarHoldings(current.s, PLAYER);
  const stale = fakeSnapshot(127, { 1: 16 });
  assert.deepEqual((await farFutureQueue(stale.s, PLAYER, { levels: [129] })).rows, []);
});
