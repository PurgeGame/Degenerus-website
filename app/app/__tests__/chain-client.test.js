import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from '../../vendor/ethers-app.mjs';
import { ChainClient, mappingSlot, wordHex } from '../../chain/client.js';

const GAME = '0x1111111111111111111111111111111111111111';
const HASH = '0x' + 'ab'.repeat(32);
const OTHER = '0x' + 'cd'.repeat(32);
const header = { number: '0x64', timestamp: '0x3e8', hash: HASH };
function client(send, options = {}) {
  return new ChainClient({ provider: { send }, chain: { id: 1, deployBlock: 1 }, contracts: { GAME },
    clock: { anchor: 0, period: 100, deployDayBoundary: 1 }, validateDeployment: false, ...options });
}

test('chain snapshots reject an RPC on the wrong chain', async () => {
  const read = client(async () => '0x2');
  await assert.rejects(read.snapshot(), { code: 'WRONG_CHAIN' });
});

test('unconfigured next deployment cannot read old addresses with the new schema', async () => {
  const read = client(() => { throw new Error('must not reach RPC'); }, { validateDeployment: true });
  await assert.rejects(read.snapshot(), { code: 'DEPLOYMENT_NOT_READY' });
});

test('slot reads coalesce, use the exact block hash, and decode a mapping value', async () => {
  const calls = [];
  const read = client(async (method, args) => {
    calls.push({ method, args });
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getBlockByNumber') return header;
    assert.equal(method, 'eth_call');
    assert.deepEqual(args[1], { blockHash: HASH, requireCanonical: true });
    assert.equal(args[0].data, '0x1e2eaeaf' + wordHex(mappingSlot(70n, 7n)).slice(2));
    return wordHex(42);
  });
  const state = await read.snapshot();
  assert.deepEqual(await Promise.all([
    state.field('GAME', 'ticketGenerationStartBlock', 7),
    state.field('GAME', 'ticketGenerationStartBlock', 7),
  ]), [42n, 42n]);
  assert.equal(calls.filter(call => call.method === 'eth_call').length, 1);
});

test('numeric fallback detects a reorg rather than returning mixed state', async () => {
  let changed = false;
  const read = client(async (method, args) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getBlockByNumber') return { ...header, hash: changed ? OTHER : HASH };
    if (typeof args[1] === 'object') throw new Error('invalid argument: cannot unmarshal object');
    assert.equal(args[1], '0x64'); changed = true; return wordHex(5);
  });
  const state = await read.snapshot(); await state.word('GAME', 0);
  await assert.rejects(state.verify(), { code: 'CHAIN_REORG' });
});

test('concurrent reads use Multicall at the snapshot hash and retain individual failures', async () => {
  const multi = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
  let sent = 0;
  const read = client(async (method, args) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getBlockByNumber') return header;
    sent += 1;
    const [requests] = multi.decodeFunctionData('aggregate3', args[0].data);
    assert.equal(requests.length, 2); assert.equal(args[1].blockHash, HASH);
    return multi.encodeFunctionResult('aggregate3', [[[true, wordHex(123)], [false, '0x']]]);
  });
  const state = await read.snapshot();
  const [a, b] = await Promise.allSettled([state.word('GAME', 0), state.word('GAME', 1)]);
  assert.equal(a.value, 123n); assert.equal(b.reason.code, 'CALL_REVERTED'); assert.equal(sent, 1);
});

test('log scans shrink refused ranges without skipping or duplicating blocks', async () => {
  const successful = [];
  const read = client(async (method, [filter]) => {
    assert.equal(method, 'eth_getLogs');
    const start = Number(filter.fromBlock), end = Number(filter.toBlock);
    if (end - start >= 2) throw new Error('block range too large');
    successful.push([start, end]);
    return Array.from({ length: end - start + 1 }, (_, i) => ({
      address: GAME, transactionHash: wordHex(start + i), blockHash: HASH,
      blockNumber: wordHex(start + i), logIndex: '0x0', topics: [], data: '0x',
    }));
  });
  const logs = await read.logs({ address: GAME, topics: [] }, { fromBlock: 3, toBlock: 10, initialSpan: 8 });
  assert.deepEqual(successful, [[3, 4], [5, 6], [7, 8], [9, 10]]);
  assert.deepEqual(logs.map(log => log.blockNumber), [3, 4, 5, 6, 7, 8, 9, 10]);
});

test('log RPC failures never become empty inventory and cancelled scans stop', async () => {
  const read = client(async () => { throw new Error('RPC unavailable'); });
  await assert.rejects(read.logs({ address: GAME }, { fromBlock: 3, toBlock: 4 }), /RPC unavailable/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(read.logs({ address: GAME }, { fromBlock: 3, toBlock: 4, signal: controller.signal }), { name: 'AbortError' });
});

test('a chain without Multicall falls back to bounded individual eth_calls',async()=>{
  let individual=0;
  const read=client(async(method,args)=>{
    if(method==='eth_chainId')return '0x1';
    if(method==='eth_getBlockByNumber')return header;
    if(args[0].to.toLowerCase()==='0xca11bde05977b3631167028862be2a173976ca11')return '0x';
    individual++;return wordHex(99);
  });
  const s=await read.snapshot();assert.deepEqual(await Promise.all([s.word('GAME',0),s.word('GAME',1)]),[99n,99n]);assert.equal(individual,2);
});

test('a saturated single-block log response refuses to invent a complete inventory',async()=>{
  const read=client(async()=>Array.from({length:1000},()=>({})));
  await assert.rejects(read.logs({address:GAME},{fromBlock:1,toBlock:1}),{code:'LOG_LIMIT'});
});
