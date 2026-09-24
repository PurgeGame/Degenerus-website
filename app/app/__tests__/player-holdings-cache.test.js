// playerHoldings: far-future holdings (active+6..active+100) are read once per page and wallet, then
// served from cache until the salvage view opens (its full scan refreshes them), the page reloads, or
// this page confirms a buy/open. Near counts read no generation-window stamps above active+2 (audit
// 26ad5863 mints at most two levels ahead). Both cut reads the combined-account poll made every cycle.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { playerHoldings, __resetFarHoldingsCacheForTest } from '../../chain/player.js';
import { farFutureQueue, clearFarHoldings } from '../../chain/positions.js';

const PLAYER = `0x${'b'.repeat(40)}`;

/** A snapshot whose far-future registry holds `farOwed` ({level: entries}) for PLAYER. */
function fakeSnapshot(active, farOwed = {}) {
  const reads = { entryOwnerPosition: 0, stamps: [] };
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
      if (name === 'entryOwnerPosition') {
        reads.entryOwnerPosition += 1;
        return farOwed[Number(keys[0]) & 0x3fffff] ? 1n : 0n;
      }
      if (name === 'lvlEntryOwner') return { owner: PLAYER, owed: BigInt(farOwed[Number(keys[0])] ?? 0) << 8n };
      throw new Error(`unexpected field ${contract}.${name}`);
    },
  };
  return { s, reads };
}

beforeEach(() => __resetFarHoldingsCacheForTest());

test('far-future holdings are read once, then served from cache on every later poll', async () => {
  const first = fakeSnapshot(10, { 40: 3 });
  const rows = await playerHoldings(first.s, PLAYER);
  assert.equal(first.reads.entryOwnerPosition, 95, 'first load walks the 95 far-future levels');
  assert.deepEqual(rows.map((row) => [row.level, row.entryCount]), [[40, 3]]);
  const later = fakeSnapshot(10, { 40: 3 });
  assert.deepEqual((await playerHoldings(later.s, PLAYER)).map((row) => row.level), [40]);
  assert.equal(later.reads.entryOwnerPosition, 0, 'a repeat poll must not re-walk the registry');
});

test('a level change re-windows the cached rows without re-walking the registry', async () => {
  await playerHoldings(fakeSnapshot(10, { 16: 2, 40: 3 }).s, PLAYER);
  const moved = fakeSnapshot(11, { 16: 2, 40: 3 });
  const rows = await playerHoldings(moved.s, PLAYER);
  assert.equal(moved.reads.entryOwnerPosition, 0);
  // Level 16 is now active+5 — the near range owns it — so it leaves the far window.
  assert.deepEqual(rows.map((row) => row.level), [40]);
});

test('opening the salvage view (a full far-future scan) refreshes the cache', async () => {
  await playerHoldings(fakeSnapshot(10, { 40: 3 }).s, PLAYER);
  await farFutureQueue(fakeSnapshot(10, { 40: 3, 50: 7 }).s, PLAYER);
  const after = fakeSnapshot(10, { 40: 3, 50: 7 });
  assert.deepEqual((await playerHoldings(after.s, PLAYER)).map((row) => row.level), [40, 50]);
  assert.equal(after.reads.entryOwnerPosition, 0);
});

test('a confirmed buy/open clears the cache so the next poll reads fresh', async () => {
  await playerHoldings(fakeSnapshot(10, { 40: 3 }).s, PLAYER);
  clearFarHoldings(); // what the degenerus:tx-confirmed listener does
  const fresh = fakeSnapshot(10, { 40: 3, 60: 1 });
  assert.deepEqual((await playerHoldings(fresh.s, PLAYER)).map((row) => row.level), [40, 60]);
  assert.equal(fresh.reads.entryOwnerPosition, 95);
});

test('near counts read generation-window stamps only up to active+2', async () => {
  const { s, reads } = fakeSnapshot(10);
  await playerHoldings(s, PLAYER);
  // generationWindow(L) reads stamps L and L+2; only L = 10, 11, 12 may be asked.
  assert.deepEqual([...new Set(reads.stamps)].sort((a, b) => a - b), [10, 11, 12, 13, 14]);
});
