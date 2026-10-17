import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ZeroAddress } from '../../vendor/ethers-app.mjs';
import { useSchema, CURRENT_SCHEMA_HASH } from '../../chain/schema.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';
import { farFutureQueue } from '../../chain/positions.js';
import { readDeityCatalog } from '../../chain/deity-catalog.js';
import { ChainSnapshot } from '../../chain/client.js';
import { fetchRecords, __setRecordsReadersForTest, __resetRecordsReadersForTest } from '../records.js';
import { readAfkingSubscription, __setAfkingReadContractFactoryForTest, __resetAfkingReadContractFactoryForTest } from '../passes.js';

let previous;
beforeEach(() => { previous = useSchema(CURRENT_SCHEMA_HASH); });
afterEach(() => { useSchema(previous); __resetRecordsReadersForTest(); __resetAfkingReadContractFactoryForTest(); });

async function ticketFixture(active = 20) {
  const f = await rpcFixture(); await f.wallet(37, PLAYER);
  f.answer('GAME_LENS', 'activeTicketLevelOf', [active]);
  f.answer('GAME', 'entriesOwedView', () => assert.fail('must not scan every future level'));
  const reads = [];
  const field = f.s.field.bind(f.s);
  f.s.field = async (...args) => { reads.push(args); return field(...args); };
  return { ...f, reads };
}

test('an empty 95-level inventory needs 13 packed balance reads and no queue headers', async () => {
  const f = await ticketFixture();
  const result = await farFutureQueue(f.s, PLAYER, { levels: Array.from({ length: 95 }, (_, i) => 26 + i) });
  assert.deepEqual(result.rows, []);
  assert.equal(f.reads.filter(row => row[1] === 'farFutureOwed').length, 13);
  assert.equal(f.reads.filter(row => row[1] === 'ticketPending').length, 1);
  assert.equal(f.reads.filter(row => row[1] === 'ticketQueue').length, 0);
});

test('packed balances preserve both normal cohorts, future counts, and recycled header tags', async () => {
  const f = await ticketFixture(120);
  // 125 shares circular slot 24 with 25. A zero header belongs to cycle one.
  await f.field('GAME', 'farFutureOwed', 0x80000008n | (0xc000000cn << 32n), 37, 3);
  await f.field('GAME', 'ticketQueue', (125n << 32n) | 7n, (1 << 22) | 25, 'length');
  // Even normal cohorts for level 126 contain 3 + 4 entries. The stale
  // future lane for level 26 must not be added to that level's new cycle.
  await f.field('GAME', 'ticketPending', (126n << 168n) | (3n << 8n) | (4n << 50n), 37);
  const result = await farFutureQueue(f.s, PLAYER, { levels: [125, 126, 127] });
  assert.deepEqual(result.rows.map(row => [row.level, row.entryCount]), [[125, 8], [126, 7]]);
  assert.equal(f.reads.filter(row => row[1] === 'farFutureOwed').length, 1);
  assert.equal(f.reads.filter(row => row[1] === 'ticketQueue').length, 2);
});

test('normal and far-future counts add exactly, including the last circular slot and uint32 wrap', async () => {
  const f = await ticketFixture(198);
  await f.field('GAME', 'farFutureOwed', 0x80000009n << 96n, 37, 12); // slot 99 -> level 200
  await f.field('GAME', 'ticketQueue', 200n << 32n, (1 << 22) | 100, 'length');
  await f.field('GAME', 'ticketPending', (200n << 168n) | (0xffffffffn << 8n) | (2n << 50n), 37);
  assert.equal((await farFutureQueue(f.s, PLAYER, { levels: [200] })).rows[0].entryCount, 10);
});

test('odd normal cohorts add to the same level’s future balance', async () => {
  const f = await ticketFixture();
  await f.field('GAME', 'farFutureOwed', 0x80000008n, 37, 3);
  await f.field('GAME', 'ticketPending', (25n << 192n) | (3n << 92n) | (4n << 134n), 37);
  assert.equal((await farFutureQueue(f.s, PLAYER, { levels: [25] })).rows[0].entryCount, 15);
});

test('unregistered wallets do not read packed ticket balances', async () => {
  const f = await ticketFixture();
  assert.deepEqual((await farFutureQueue(f.s, OTHER_PLAYER)).rows, []);
  assert.equal(f.reads.filter(row => row[1] === 'farFutureOwed' || row[1] === 'ticketPending').length, 0);
});

test('deity catalog includes genesis mints and lender seizures without 32 owner reads', async () => {
  const f = await rpcFixture();
  await f.event('DEITY_PASS', 'Transfer', { from: ZeroAddress, to: PLAYER, tokenId: 0 });
  await f.event('DEITY_PASS', 'Transfer', { from: ZeroAddress, to: PLAYER, tokenId: 31 });
  await f.event('DEITY_PASS', 'Transfer', { from: PLAYER, to: OTHER_PLAYER, tokenId: 31 });
  f.answer('DEITY_PASS', 'ownerOf', () => assert.fail('catalog must not rescan owners'));
  const first = await readDeityCatalog({ client: f.client });
  assert.equal(first.issuedCount, 2);
  assert.equal(first.ownersBySymbol.get(0), PLAYER);
  assert.equal(first.ownersBySymbol.get(31), OTHER_PLAYER);
  const count = f.requests.filter(row => row.method === 'eth_getLogs').length;
  assert.equal(count, 1);
  assert.deepEqual(await readDeityCatalog({ client: f.client }), first);
  assert.equal(f.requests.filter(row => row.method === 'eth_getLogs').length, count, 'same-block catalog reuses verified history');
});

test('failed or reorganized deity history never becomes a purchasable empty catalog', async () => {
  const f = await rpcFixture();
  f.client.logs = async () => { throw new Error('History unavailable'); };
  await assert.rejects(readDeityCatalog({ client: f.client }), /History unavailable/);
  const g = await rpcFixture();
  g.s.verify = async () => { throw new Error('Chain reorganized'); };
  await assert.rejects(readDeityCatalog({ client: g.client }), /Chain reorganized/);
});

test('new deity mints refresh the catalog by reading only the new block tail', async () => {
  const f = await rpcFixture();
  await f.event('DEITY_PASS', 'Transfer', { from: ZeroAddress, to: PLAYER, tokenId: 0 });
  assert.equal((await readDeityCatalog({ client: f.client })).issuedCount, 1);
  await f.event('DEITY_PASS', 'Transfer', { from: ZeroAddress, to: OTHER_PLAYER, tokenId: 6 }, { block: 10001 });
  const header = await f.client.header(10002);
  f.client.snapshot = async () => new ChainSnapshot(f.client, header);
  const next = await readDeityCatalog({ client: f.client });
  assert.equal(next.issuedCount, 2); assert.equal(next.ownersBySymbol.get(6), OTHER_PLAYER);
  const tail = f.requests.filter(row => row.method === 'eth_getLogs').at(-1).params[0];
  assert.equal(Number(tail.fromBlock), 10001); assert.equal(Number(tail.toBlock), 10002);
});

test('complete chain records use one snapshot without rereading the pool, clocks or marks', async () => {
  const rows = Array.from({ length: 5 }, (_, kind) => ({ kind, value: String(100 + kind), player: PLAYER, clockDay: 20 + kind }));
  const payload = { poolBlockNumber: 123, recordPool: '1000', records: rows.slice(0, 4), diceRun: rows[4] };
  let duplicateReads = 0, jsonReads = 0;
  const duplicate = async () => { duplicateReads++; return null; };
  __setRecordsReadersForTest({ json: async () => { jsonReads++; return payload; }, pool: duplicate, clocks: duplicate, marks: duplicate,
    diceRun: async ({ payload: passed }) => { assert.equal(passed, payload); return null; } });
  const result = await fetchRecords();
  assert.equal(jsonReads, 1); assert.equal(duplicateReads, 0);
  assert.equal(result.recordPoolWei, 1000n);
  assert.deepEqual(result.records.map(row => row.value), [100n, 101n, 102n, 103n, 104n]);
  assert.deepEqual(result.records.map(row => row.clockDay), [20, 21, 22, 23, 24]);
});

test('incomplete records retain authoritative fallback reads', async () => {
  __setRecordsReadersForTest({ json: async () => ({ records: [] }), pool: async () => 500n,
    clocks: async () => [1, 2, 3, 4, 5], marks: async () => [10n, 20n, 30n, 40n, 50n] });
  const result = await fetchRecords();
  assert.equal(result.recordPoolWei, 500n);
  assert.equal(result.records[4].value, 50n);
});

test('AFKing settings and pending rewards share one lens read', async () => {
  let lensReads = 0;
  __setAfkingReadContractFactoryForTest(() => ({
    token: { balanceOf: async () => 0n },
    game: { afkingSnapshot: async () => [1n, false, [2n], [3n]] },
    lens: { subInfoFull: async () => { lensReads++; return { active: true, dailyQuantity: 10, flags: 6, pendingFlip: 100n }; } },
  }));
  const result = await readAfkingSubscription(PLAYER);
  assert.equal(result.active, true); assert.equal(result.pendingFlipWhole, 100n);
  assert.equal(lensReads, 1);
});
