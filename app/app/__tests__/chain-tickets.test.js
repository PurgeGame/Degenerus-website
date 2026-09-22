import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFoil, foilCuts, deriveTraits, decodeEntryReveal, isFoil } from '../../chain/traits.js';
import { ticketInventory } from '../../chain/tickets.js';
import { contractInterface, wordHex, ChainClient } from '../../chain/client.js';
import { cachedLogs, clearEventMemoryForTests } from '../../chain/event-store.js';

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
