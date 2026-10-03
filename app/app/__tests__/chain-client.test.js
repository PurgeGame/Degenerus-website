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

function busyBlock({ unsupported = false, incomplete = false, reorg = false } = {}) {
  const topic = wordHex(7);
  const txs = ['0xaaa', '0xbbb'];
  const rows = Array.from({ length: 1678 }, (_, i) => ({
    address: GAME, topics: [topic, wordHex(9)], data: '0x',
    blockNumber: '0x2', blockHash: HASH, transactionHash: txs[i < 1000 ? 0 : 1],
    transactionIndex: i < 1000 ? '0x0' : '0x1', logIndex: '0x' + i.toString(16),
  }));
  const receipts = txs.map(transactionHash => ({
    transactionHash, blockHash: HASH, blockNumber: '0x2',
    logs: rows.filter(row => row.transactionHash === transactionHash),
  }));
  receipts[1].logs.push({ ...rows[0], address: OTHER.slice(0, 42), logIndex: '0x700' });
  receipts[1].logs.push({ ...rows[0], topics: [wordHex(8)], logIndex: '0x701' });
  const calls = []; let headers = 0;
  const read = client(async (method, args) => {
    calls.push({ method, args });
    if (method === 'eth_getLogs') {
      const { fromBlock, toBlock } = args[0];
      return Number(fromBlock) <= 2 && Number(toBlock) >= 2 ? rows.slice(0, 1000) : [];
    }
    if (method === 'eth_getBlockByNumber') return {
      number: '0x2', timestamp: '0x4', hash: reorg && ++headers > 1 ? OTHER : HASH, transactions: txs,
    };
    if (method === 'eth_getBlockReceipts') {
      if (unsupported) throw new Error('method not found (-32601)');
      return incomplete ? receipts.slice(0, 1) : receipts;
    }
    if (method === 'eth_getTransactionReceipt') return receipts.find(receipt => receipt.transactionHash === args[0]);
    throw new Error('unexpected ' + method);
  });
  return { read, calls, filter: { address: GAME, topics: [[topic, wordHex(10)], null] } };
}

test('busy ticket blocks recover every matching log from verified receipts, including truncated transactions', async () => {
  for (const unsupported of [false, true]) {
    const { read, calls, filter } = busyBlock({ unsupported });
    const rows = await read.logs(filter, { fromBlock: 2, toBlock: 2 });
    assert.equal(rows.length, 1678, 'includes the second transaction absent from the truncated log response');
    assert.equal(new Set(rows.map(row => row.transactionHash)).size, 2);
    assert.equal(rows.at(-1).logIndex, 1677);
    assert.equal(calls.filter(call => call.method === 'eth_getTransactionReceipt').length, unsupported ? 2 : 0);
  }
});

test('receipt recovery rejects missing transactions and block changes', async () => {
  for (const [options, code] of [[{ incomplete: true }, 'LOG_LIMIT'], [{ reorg: true }, 'CHAIN_REORG']]) {
    const { read, filter } = busyBlock(options);
    await assert.rejects(read.logs(filter, { fromBlock: 2, toBlock: 2 }), { code });
  }
});

test('a dense block does not force duplicate full-range retries or thousands of one-block reads', async () => {
  const { read, calls, filter } = busyBlock();
  const rows = await read.logs(filter, { fromBlock: 1, toBlock: 2000 });
  assert.equal(rows.length, 1678);
  const ranges = calls.filter(call => call.method === 'eth_getLogs').map(call => call.args[0]);
  assert.ok(ranges.length < 40, `used ${ranges.length} log queries`);
  assert.equal(Number(ranges[1].toBlock), 1000, 'halves the actual requested range immediately');
});

// A fixed 2s chain: block n is stamped 2n and its hash encodes n, so parent links are checkable.
function fixedChain(head, { onHeader, onReceipt, receiptBlock } = {}) {
  const hashOf = n => '0x' + n.toString(16).padStart(64, '0');
  const block = n => ({ number: '0x' + n.toString(16), timestamp: '0x' + (2 * n).toString(16), hash: hashOf(n), parentHash: hashOf(n - 1) });
  const read = client(async (method, args) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getBlockByNumber') { const n = args[0] === 'latest' ? head.number : Number(args[0]); onHeader?.(args[0]); return block(n); }
    if (method === 'eth_getTransactionReceipt') { onReceipt?.(args[0]); return { transactionHash: args[0], blockNumber: '0x' + receiptBlock().toString(16), blockHash: hashOf(receiptBlock()), logs: [] }; }
    throw new Error('unexpected ' + method);
  }, { chain: { id: 1, deployBlock: 1, blockSeconds: 2 } });
  return { read, hashOf };
}

test('a settled day boundary is searched once per page, and in two probes on a fixed-interval chain', async () => {
  const head = { number: 10_000 }; const probes = [];
  const { read } = fixedChain(head, { onHeader: tag => { if (tag !== 'latest') probes.push(Number(tag)); } });
  const s = await read.snapshot();
  assert.equal(await read.blockAtTime(5_001, s.block), 2_501);
  assert.equal(probes.length, 2);
  head.number = 10_050; read.head = null;
  const later = await read.snapshot();
  assert.equal(await read.blockAtTime(5_001, later.block), 2_501);
  assert.equal(probes.length, 2, 'a settled boundary is not searched again from a newer head');
  // Inside the finality window the answer is recomputed on every call.
  const near = 2 * later.block.number - 20;
  await read.blockAtTime(near, later.block); const first = probes.length;
  await read.blockAtTime(near, later.block);
  assert.ok(probes.length > first, 'a boundary near the head is never remembered');
});

test('checkpoint ancestry is proven from parent hashes already seen, and refuted on a fork', async () => {
  const head = { number: 200 };
  const { read, hashOf } = fixedChain(head);
  await read.header(199); const upper = await read.header(200);
  assert.equal(read.linksTo(upper, 199, hashOf(199)), true);
  assert.equal(read.linksTo(upper, 198, hashOf(198)), true, 'the parent of a known header is proven by its hash');
  assert.equal(read.linksTo(upper, 199, OTHER), false);
  assert.equal(read.linksTo(upper, 150, hashOf(150)), null, 'a missing link must fall back to the RPC');
});

test('receipts are kept once settled, shared briefly when recent, and fetched once when concurrent', async () => {
  const head = { number: 1_000 }; let at = 900; const fetched = [];
  const { read } = fixedChain(head, { onReceipt: hash => fetched.push(hash), receiptBlock: () => at });
  await read.snapshot();
  await read.receipt('0xaa'); await read.receipt('0xaa');
  assert.equal(fetched.length, 1);
  at = 990;
  await Promise.all([read.receipt('0xbb'), read.receipt('0xbb')]);
  assert.equal(fetched.length, 2, 'concurrent readers of one transaction share a request');
  await read.receipt('0xbb');
  assert.equal(fetched.length, 2, 'a recent receipt is shared within one block interval');
  read.receipts.get('0xbb').at -= 2 * read.headTtlMs;
  await read.receipt('0xbb');
  assert.equal(fetched.length, 3, 'past one block interval a receipt near the head is re-read in case its block is replaced');
  read.receipts.get('0xbb').at -= 2 * read.headTtlMs;
  const { blockHash } = await read.receipt('0xbb'); const before = fetched.length;
  read.receipts.get('0xbb').at -= 2 * read.headTtlMs;
  await read.receipt('0xbb', undefined, blockHash);
  assert.equal(fetched.length, before, 'a caller holding the canonical log row reuses a recent receipt from that block');
  read.receipts.get('0xbb').at -= 2 * read.headTtlMs;
  await read.receipt('0xbb', undefined, OTHER);
  assert.equal(fetched.length, before + 1, 'a different block hash means the transaction moved: re-read');
});

test('one snapshot fetches a header by number once for all its readers', async () => {
  const probes = [];
  const { read } = fixedChain({ number: 500 }, { onHeader: tag => { if (tag !== 'latest') probes.push(tag); } });
  const s = await read.snapshot();
  const [a, b] = await Promise.all([s.header(490), s.header(490)]);
  assert.equal(a.hash, b.hash); assert.equal(probes.length, 1);
});

test('a settled receipt is kept in the browser cache for the next page, holding only deployment logs', async () => {
  const fetched = [];
  const make = () => {
    const { read } = fixedChain({ number: 1_000 }, { onReceipt: hash => fetched.push(hash), receiptBlock: () => 900 });
    read.persistReceipts = true; return read;
  };
  const first = make(); await first.snapshot();
  await first.receipt('0xcc');
  await new Promise(resolve => setTimeout(resolve, 0));
  const next = make(); await next.snapshot();
  const again = await next.receipt('0xcc');
  assert.equal(fetched.length, 1, 'the second page reuses the stored receipt');
  assert.equal(again.blockNumber, 900);
});
