import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from '../contracts.js';
import * as reads from '../read-provider.js';

afterEach(() => {
  reads._resetSharedReadProviderForTests();
});

test('permissionless reads prefer public transport over a BrowserProvider', () => {
  const publicReader = { kind: 'public' };
  reads._setSharedReadProviderForTests(publicReader);
  const browser = new ethers.BrowserProvider({ request: async () => '0x1' });
  assert.equal(reads.permissionlessReadProvider(browser), publicReader);

  const injectedTestReader = { kind: 'injected-test' };
  assert.equal(reads.permissionlessReadProvider(injectedTestReader), injectedTestReader);
});

test('coalesces heads, native balances, and immutable storage primitives', async () => {
  let headCalls = 0;
  let balanceCalls = 0;
  let storageCalls = 0;
  const provider = {
    getBlockNumber: async () => { headCalls += 1; return 77; },
    getBalance: async () => { balanceCalls += 1; return 123n; },
    getStorage: async () => { storageCalls += 1; return '0xabc'; },
  };
  const address = '0x1111111111111111111111111111111111111111';

  assert.deepEqual(await Promise.all([
    reads.readProviderBlockNumber(provider),
    reads.readProviderBlockNumber(provider),
  ]), [77, 77]);
  assert.equal(headCalls, 1);

  assert.deepEqual(await Promise.all([
    reads.readNativeBalance(address, { provider }),
    reads.readNativeBalance(address, { provider }),
  ]), [123n, 123n]);
  assert.equal(balanceCalls, 1);
  assert.equal(await reads.readNativeBalance(address, {
    provider: { getBalance: async () => 456n },
  }), 456n, 'primitive caches are isolated by provider');

  assert.deepEqual(await Promise.all([
    reads.readContractStorage(address, 5n, { provider, blockTag: 77 }),
    reads.readContractStorage(address, '0x5', { provider, blockTag: 77 }),
  ]), ['0xabc', '0xabc']);
  assert.equal(storageCalls, 1);

  reads.invalidateReadCache();
  await reads.readContractStorage(address, 5n, { provider, blockTag: 77 });
  assert.equal(storageCalls, 2, 'receipt invalidation clears primitive snapshots');
});

test('shared log wrapper coalesces identical ranges without crossing providers', async () => {
  let callsA = 0;
  let callsB = 0;
  const filter = {
    address: '0x1111111111111111111111111111111111111111',
    topics: [['0xabc', '0xdef'], null],
    fromBlock: 10,
    toBlock: 20,
  };
  const providerA = reads.attachLogCache({
    getLogs: async () => { callsA += 1; return [{ blockNumber: 20 }]; },
  });
  const providerB = reads.attachLogCache({
    getLogs: async () => { callsB += 1; return [{ blockNumber: 19 }]; },
  });

  const [first, second] = await Promise.all([
    providerA.getLogs(filter),
    providerA.getLogs({ ...filter }),
  ]);
  assert.deepEqual(first, second);
  assert.equal(callsA, 1, 'same-window requests share one RPC');
  await providerA.getLogs(filter);
  assert.equal(callsA, 1, 'the one-second completed window absorbs mount stragglers');
  assert.deepEqual(await providerB.getLogs(filter), [{ blockNumber: 19 }]);
  assert.equal(callsB, 1, 'a second provider cannot inherit the first response');

  reads.invalidateReadCache();
  await providerA.getLogs(filter);
  assert.equal(callsA, 2, 'receipt invalidation clears recent log responses');
});

test('receipt reads retain mined results but only briefly retain pending nulls', async () => {
  const hash = `0x${'a'.repeat(64)}`;
  let calls = 0;
  let mined = false;
  const provider = {
    getTransactionReceipt: async () => {
      calls += 1;
      return mined ? { hash, blockNumber: 88 } : null;
    },
  };

  assert.deepEqual(await Promise.all([
    reads.readTransactionReceipt(hash, { provider }),
    reads.readTransactionReceipt(hash.toUpperCase(), { provider }),
  ]), [null, null]);
  assert.equal(calls, 1, 'pending lookups share one in-flight request');
  await reads.readTransactionReceipt(hash, { provider });
  assert.equal(calls, 1, 'pending null has a short completed window');

  mined = true;
  const receipt = await reads.readTransactionReceipt(hash, { provider, fresh: true });
  assert.equal(receipt.blockNumber, 88);
  assert.equal(calls, 2);
  await reads.readTransactionReceipt(hash, { provider, fresh: true });
  assert.equal(calls, 2, 'a mined receipt is immutable within the cache generation');

  reads.invalidateReadCache();
  await reads.readTransactionReceipt(hash, { provider });
  assert.equal(calls, 3, 'receipt invalidation permits reorg reconciliation');
});
