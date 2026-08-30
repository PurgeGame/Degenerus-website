import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import * as contractsMod from '../contracts.js';
import * as purchaseInfoMod from '../purchase-info.js';
import { invalidateReadCache } from '../read-provider.js';

let head;
let calls;

beforeEach(() => {
  head = 100;
  calls = [];
  contractsMod.setProvider({
    getBlockNumber: async () => head,
  });
  purchaseInfoMod.__setPurchaseInfoContractFactoryForTest(() => ({
    purchaseInfo: async (overrides) => {
      calls.push(overrides?.blockTag ?? null);
      return [12, false, true, false, 25n];
    },
  }));
});

afterEach(() => {
  purchaseInfoMod.__resetPurchaseInfoForTest();
  contractsMod.clearProvider();
  invalidateReadCache();
});

test('shares purchaseInfo across surfaces and pins it to one block', async () => {
  const [a, b] = await Promise.all([
    purchaseInfoMod.readPurchaseInfo(),
    purchaseInfoMod.readPurchaseInfo(),
  ]);
  assert.equal(a, b);
  assert.deepEqual(calls, [100]);
  assert.deepEqual(a, {
    currentLevel: 12,
    inJackpotPhase: false,
    lastPurchaseDay: true,
    rngLocked: false,
    priceWei: 25n,
    blockNumber: 100,
  });

  head = 101;
  assert.equal(await purchaseInfoMod.readPurchaseInfo(), a,
    'display callers share the short completed-response window');
  assert.deepEqual(calls, [100]);

  const fresh = await purchaseInfoMod.readPurchaseInfo({ fresh: true });
  assert.equal(fresh.blockNumber, 101);
  assert.deepEqual(calls, [100, 101]);
});

test('receipt-boundary invalidation clears the domain snapshot too', async () => {
  await purchaseInfoMod.readPurchaseInfo();
  head = 102;
  invalidateReadCache();
  assert.equal((await purchaseInfoMod.readPurchaseInfo()).blockNumber, 102);
  assert.deepEqual(calls, [100, 102]);
});

