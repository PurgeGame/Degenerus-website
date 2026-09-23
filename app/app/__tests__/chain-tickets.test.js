import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFoil, foilCuts, deriveTraits, decodeEntryReveal, isFoil } from '../../chain/traits.js';
import { ticketInventory } from '../../chain/tickets.js';
import { contractInterface, wordHex, ChainClient } from '../../chain/client.js';
import { cachedLogs, clearEventMemoryForTests, previousEvents } from '../../chain/event-store.js';

const PLAYER = '0x1111111111111111111111111111111111111111';
const GAME = '0x2222222222222222222222222222222222222222';
const HASH = wordHex(777), FORK = wordHex(778);
const topic = wordHex((7n << 160n) | BigInt(PLAYER));
function reveal(topics, traits, present) {
  return { topics, data: wordHex(traits.reduce((word, trait, i) => word | (BigInt(trait) << BigInt(i * 8)), BigInt(present) << 128n)) };
}
test('anonymous reveal preserves trait zero, partial seats and repeated player topics', () => {
  const log = reveal([topic, wordHex(0), topic, wordHex(0)], [0, 64, 128, 192, 0, 0, 0, 0, 2, 65, 130, 193], 0x090f);
  assert.deepEqual(decodeEntryReveal(log, 7, PLAYER), [0, 64, 128, 192, 2, 193]);
  assert.deepEqual(decodeEntryReveal(log, 8, PLAYER), []);
});
test('foil lines match packed vectors generated from the Solidity producer', () => {
  assert.deepEqual(foilCuts(31500), [3067, 6133, 9199, 11119, 12904, 14003, 14982]);
  const lines = deriveFoil({ buyer: '0xd0aa4359cf85ba7f1b02ab1b6ffa1a50fc87f383', level: 15, multBps: 31500,
    entropy: 4937321913631112737491007760424355058294886396106662863884932664165426299724n });
  assert.deepEqual(lines.map(line => (line[0] | (line[1] << 8) | (line[2] << 16) | (line[3] << 24)) >>> 0),
    [3383509284, 3364837937, 3968752903, 3365749564]);
  assert.equal(isFoil(0n, 1), false, 'a rolled fractional remainder is not a foil pack');
  assert.equal(isFoil(0n, 16), true);
});

test('one inventory combines seated, ordinary and foil paths without duplicate logs', async () => {
  clearEventMemoryForTests();
  const iface = await contractInterface('GAME'); const logs = [];
  const push = (name, args, tx, index) => {
    const row = { ...iface.encodeEventLog(name, args), address: GAME, blockNumber: 20, transactionIndex: tx,
      transactionHash: wordHex(tx), blockHash: HASH, logIndex: index };
    logs.push(row); return row;
  };
  push('LootboxRngApplied', [5, 123456789, 17], 10, 0);
  const baseKey = (7n << 224n) | (2n << 192n) | (BigInt(PLAYER) << 32n) | 32n;
  push('TraitsGenerated', [PLAYER, baseKey, 32], 10, 1);
  push('Advance', [5, 7], 10, 2);
  push('TraitsGenerated', [PLAYER, (7n << 224n) | (BigInt(PLAYER) << 32n), 16], 11, 3);
  push('Advance', [5, 7], 11, 4);
  logs.push({ ...reveal([topic, topic, wordHex(0), wordHex(0)], [0, 64, 128, 192, 1, 65, 129, 193], 0xff),
    address: GAME, blockNumber: 20, transactionIndex: 12, transactionHash: wordHex(12), blockHash: HASH, logIndex: 5 });
  const queries = [];
  const client = new ChainClient({ validateDeployment: false, chain: { id: 999, deployBlock: 1 }, contracts: { GAME }, provider: { send: async (method, params) => {
    if (method === 'eth_getLogs') {
      const f = params[0]; queries.push(f);
      return logs.filter(log => log.blockNumber >= Number(f.fromBlock) && log.blockNumber <= Number(f.toBlock)
        && f.topics.every((value, i) => value == null || value.toLowerCase() === log.topics[i]?.toLowerCase()));
    }
    if (method === 'eth_getTransactionReceipt') return { blockNumber: 20, logs: logs.filter(log => log.transactionHash === params[0]) };
    throw new Error(`Unexpected RPC ${method}`);
  } } });
  const snapshot = { client, block: { number: 25, hash: HASH },
    field: async (_contract, name, key) => { assert.equal(name, 'ticketGenerationStartBlock'); return key === 7 ? 10n : 0n; },
    call: async (_contract, method) => {
      if (method === 'foilRecordOf') return { present: true, resolveDay: 3n, multBps: 31500n };
      if (method === 'rngWordForDay') return 456n;
      if (method === 'entriesOwedView') return 8n;
      throw new Error(method);
    } };
  const inventory = await ticketInventory(snapshot, PLAYER, 7);
  assert.equal(inventory.totalEntries, 56); assert.equal(inventory.pendingEntries, 8);
  const actual = inventory.cards.flatMap(card => card.entries.map(entry => entry.traitId)).sort((a, b) => a - b);
  const expected = [...deriveTraits(baseKey, 0, 32, 123456789n), ...deriveFoil({ buyer: PLAYER, level: 7, entropy: 456n, multBps: 31500 }).flat(), 0, 64, 128, 192, 1, 65, 129, 193].sort((a, b) => a - b);
  assert.deepEqual(actual, expected);
  assert.equal(queries.length, 5); assert.ok(queries.every(query => Number(query.fromBlock) === 10));
});

test('cached event tails replay the bounded window after a checkpoint reorg', async () => {
  clearEventMemoryForTests(); let currentHash = HASH; const ranges = [];
  const client = { chain: { id: 4242, deployBlock: 1 }, address: () => GAME,
    header: async number => ({ number, hash: currentHash }),
    logs: async (_filter, range) => { ranges.push([range.fromBlock, range.toBlock]); return []; } };
  await cachedLogs({ client, block: { number: 20, hash: HASH } }, { topics: [topic] }, { fromBlock: 7 });
  await cachedLogs({ client, block: { number: 25, hash: HASH } }, { topics: [topic] }, { fromBlock: 7 });
  currentHash = FORK;
  await cachedLogs({ client, block: { number: 30, hash: FORK } }, { topics: [topic] }, { fromBlock: 7 });
  assert.deepEqual(ranges, [[7, 20], [21, 25], [7, 30]]);
});

test('a cancelled cold history scan resumes after its last verified page',async()=>{
  clearEventMemoryForTests();let fail=true;const starts=[];
  const client={chain:{id:5151,deployBlock:1},address:()=>GAME,header:async number=>({number,hash:HASH}),
    logs:async(_filter,options)=>{starts.push(options.fromBlock);if(fail){await options.onPage([],{fromBlock:1,toBlock:10});throw new Error('RPC timeout');}return [];}};
  const snapshot={client,block:{number:20,hash:HASH},verify:async()=>{}};
  await assert.rejects(cachedLogs(snapshot,{topics:[topic]}),/RPC timeout/);fail=false;
  await cachedLogs(snapshot,{topics:[topic]});assert.deepEqual(starts,[1,11]);
});

test('previousEvents remembers a settled answer and later scans only the blocks above it', async () => {
  const logs = [{ blockNumber: 300, transactionIndex: 0, logIndex: 0, transactionHash: '0x01' },
    { blockNumber: 500, transactionIndex: 0, logIndex: 9, transactionHash: '0x02' }];
  const ranges = [];
  const stub = { chain: { deployBlock: 1 }, head: { block: { number: 2_000 } },
    events: async (_n, _e, _f, { fromBlock, toBlock }) => { ranges.push([fromBlock, toBlock]); return logs.filter(l => l.blockNumber >= fromBlock && l.blockNumber <= toBlock); } };
  // Mid-block `before`: the match later in block 500 is excluded now and must still be found later.
  const first = await previousEvents(stub, 'GAME', 'X', { blockNumber: 500, transactionIndex: 0, logIndex: 5 });
  assert.deepEqual(first.map(l => l.transactionHash), ['0x01']);
  ranges.length = 0;
  const second = await previousEvents(stub, 'GAME', 'X', { blockNumber: 1_900, transactionIndex: 0, logIndex: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(second.map(l => l.transactionHash), ['0x02']);
  assert.deepEqual(ranges, [[500, 1_900]], 'only blocks above the settled height are scanned');
  // The answer below a remembered height is served without any scan.
  ranges.length = 0;
  const third = await previousEvents(stub, 'GAME', 'X', { blockNumber: 1_000, transactionIndex: 0, logIndex: 0 });
  assert.deepEqual(third.map(l => l.transactionHash), ['0x02']);
  assert.deepEqual(ranges, []);
  // A custom predicate may close over state, so it always scans.
  await previousEvents(stub, 'GAME', 'X', { blockNumber: 1_000, logIndex: 0 }, { accept: () => true });
  assert.ok(ranges.length > 0);
});

test('concurrent previousEvents calls for one anchor share a single scan', async () => {
  let scans = 0;
  const stub = { chain: { deployBlock: 1 }, head: { block: { number: 2_000 } },
    events: async () => { scans++; await new Promise(r => setTimeout(r, 5)); return [{ blockNumber: 10, transactionIndex: 0, logIndex: 0, transactionHash: '0x01' }]; } };
  const before = { blockNumber: 1_990, transactionIndex: 0, logIndex: 0 };
  const rows = await Promise.all([1, 2, 3].map(() => previousEvents(stub, 'GAME', 'Y', before)));
  assert.equal(scans, 1); assert.deepEqual(rows.map(r => r[0].transactionHash), ['0x01', '0x01', '0x01']);
  // A settled anchor is answered from memory on later polls; one near the head is asked again.
  const settled = { blockNumber: 1_000, transactionIndex: 0, logIndex: 0 };
  await previousEvents(stub, 'GAME', 'Y', settled); const after = scans;
  await previousEvents(stub, 'GAME', 'Y', settled);
  assert.equal(scans, after);
  await previousEvents(stub, 'GAME', 'Y', before);
  assert.equal(scans, after + 1);
});

test('a rolling log window fetches only the blocks it lacks, and historical pages reuse the entry', async () => {
  clearEventMemoryForTests(); const ranges = [];
  const client = { chain: { id: 6161, deployBlock: 1 }, address: () => GAME,
    header: async number => ({ number, hash: HASH }), linksTo: () => true,
    logs: async (_filter, range) => { ranges.push([range.fromBlock, range.toBlock]); return []; } };
  const snap = number => ({ client, block: { number, hash: HASH }, verify: async () => {} });
  await cachedLogs(snap(3_000), { topics: [topic] }, { fromBlock: 1_001 });
  await cachedLogs(snap(3_010), { topics: [topic] }, { fromBlock: 1_011 });
  await cachedLogs(snap(3_010), { topics: [topic] }, { fromBlock: 1_500, toBlock: 2_000 });
  await cachedLogs(snap(3_010), { topics: [topic] }, { fromBlock: 901, toBlock: 1_010 });
  assert.deepEqual(ranges, [[1_001, 3_000], [3_001, 3_010], [901, 1_000]]);
});

test('short tails of many filters on one contract share one address-wide fetch per snapshot', async () => {
  clearEventMemoryForTests(); const calls = [];
  const A = '0x' + '11'.repeat(32), B = '0x' + '22'.repeat(32);
  const tailLog = (block, t0) => ({ address: GAME, blockNumber: block, transactionIndex: 0, logIndex: block, topics: [t0], data: '0x' });
  const client = { chain: { id: 7171, deployBlock: 1 }, address: () => GAME,
    header: async number => ({ number, hash: HASH }), linksTo: () => true,
    logs: async (filter, range) => { calls.push([filter.topics ? 'filtered' : 'address', range.fromBlock, range.toBlock]);
      return filter.topics ? [] : [tailLog(105, A), tailLog(108, B)]; } };
  const cold = { client, block: { number: 100, hash: HASH }, verify: async () => {} };
  await Promise.all([cachedLogs(cold, { address: GAME, topics: [A] }), cachedLogs(cold, { address: GAME, topics: [[B, A]] })]);
  calls.length = 0;
  const warm = { client, block: { number: 110, hash: HASH }, verify: async () => {} };
  const [a, both] = await Promise.all([cachedLogs(warm, { address: GAME, topics: [A] }), cachedLogs(warm, { address: GAME, topics: [[B, A]] })]);
  assert.deepEqual(calls, [['address', 101, 110]]);
  assert.deepEqual(a.map(log => log.blockNumber), [105]);
  assert.deepEqual(both.map(log => log.blockNumber), [105, 108]);
});

test('a batch whose RNG anchor is in an earlier transaction resolves it from one window query', async () => {
  clearEventMemoryForTests();
  const iface = await contractInterface('GAME'); const logs = [];
  const push = (name, args, block, tx, index) => {
    logs.push({ ...iface.encodeEventLog(name, args), address: GAME, blockNumber: block, transactionIndex: tx,
      transactionHash: wordHex(tx), blockHash: HASH, logIndex: index });
  };
  push('LootboxRngApplied', [5, 123456789, 17], 20, 10, 0);
  const baseKey = (7n << 224n) | (2n << 192n) | (BigInt(PLAYER) << 32n) | 32n;
  push('TraitsGenerated', [PLAYER, baseKey, 16], 21, 13, 1);
  push('Advance', [5, 7], 21, 13, 2);
  const queries = [];
  const client = new ChainClient({ validateDeployment: false, chain: { id: 998, deployBlock: 1 }, contracts: { GAME }, provider: { send: async (method, params) => {
    if (method === 'eth_getLogs') {
      const f = params[0]; queries.push(f);
      return logs.filter(log => log.blockNumber >= Number(f.fromBlock) && log.blockNumber <= Number(f.toBlock)
        && f.topics.every((value, i) => value == null || (Array.isArray(value) ? value : [value]).some(v => v.toLowerCase() === log.topics[i]?.toLowerCase())));
    }
    if (method === 'eth_getTransactionReceipt') return { blockNumber: 21, logs: logs.filter(log => log.transactionHash === params[0]) };
    throw new Error(`Unexpected RPC ${method}`);
  } } });
  const snapshot = { client, block: { number: 25, hash: HASH },
    field: async (_contract, name, key) => (key === 7 ? 10n : 0n),
    call: async (_contract, method) => { if (method === 'entriesOwedView') return 0n; throw new Error(method); } };
  const inventory = await ticketInventory(snapshot, PLAYER, 7);
  const actual = inventory.cards.flatMap(card => card.entries.map(entry => entry.traitId)).sort((a, b) => a - b);
  assert.deepEqual(actual, [...deriveTraits(baseKey, 0, 16, 123456789n)].sort((a, b) => a - b));
  assert.ok(queries.every(query => Number(query.fromBlock) === 10), 'no backward scan below the generation window');
});

test('a saturated shared tail falls back to filtered queries and stops sharing past the dense block', async () => {
  clearEventMemoryForTests(); const calls = [];
  const client = { chain: { id: 8181, deployBlock: 1 }, address: () => GAME,
    header: async number => ({ number, hash: HASH }), linksTo: () => true,
    logs: async (filter, range) => {
      calls.push([filter.topics ? 'filtered' : 'address', range.fromBlock, range.toBlock]);
      if (!filter.topics && range.fromBlock <= 105) throw Object.assign(new Error('dense block'), { code: 'LOG_LIMIT' });
      return [];
    } };
  const cold = { client, block: { number: 100, hash: HASH }, verify: async () => {} };
  const filters = [1, 2, 3].map(i => ({ address: GAME, topics: [wordHex(i)] }));
  await Promise.all(filters.map(f => cachedLogs(cold, f)));
  calls.length = 0;
  const warm = { client, block: { number: 105, hash: HASH }, verify: async () => {} };
  await Promise.all(filters.map(f => cachedLogs(warm, f)));
  assert.equal(calls.filter(c => c[0] === 'address').length, 1, 'one failed cover, never rebuilt per filter');
  assert.equal(calls.filter(c => c[0] === 'filtered').length, 3);
  calls.length = 0;
  const later = { client, block: { number: 106, hash: HASH }, verify: async () => {} };
  await Promise.all(filters.map(f => cachedLogs(later, f)));
  assert.deepEqual(calls, [['address', 106, 106]], 'sharing resumes once tails start above the dense range');
});
