// WWXRP daily-draw day discovery: API-first, chain-scan fallback only.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as wwxrpDrawMod from '../wwxrp-draw.js';
import { CHAIN } from '../chain-config.js';
import {
  invalidateReadCache,
  _setSharedReadProviderForTests,
  _resetSharedReadProviderForTests,
} from '../read-provider.js';

const PLAYER = '0xab12000000000000000000000000000000000000';

function makeFakeProvider(overrides = {}) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    ...overrides,
  };
}

describe('readPlayerWwxrpDrawDays', () => {
  beforeEach(() => {
    // Default every test to an always-failing fetch so nothing accidentally
    // reaches the real indexer API; individual tests override as needed.
    wwxrpDrawMod.__setWwxrpDrawFetcherForTest(async () => {
      throw new Error('wwxrp-draw API not stubbed in this test');
    });
  });

  afterEach(() => {
    wwxrpDrawMod.__resetWwxrpDrawForTest();
    _resetSharedReadProviderForTests();
  });

  test('reads draw days from the API before touching the chain log scan', async () => {
    const fetchCalls = [];
    wwxrpDrawMod.__setWwxrpDrawFetcherForTest(async (path) => {
      fetchCalls.push(path);
      return {
        toBlock: 555,
        events: [
          { name: 'DrawEntered', args: { day: '12' }, blockNumber: 100, logIndex: 0, transactionHash: '0xa1' },
          { name: 'DrawEntered', args: { day: '9' }, blockNumber: 101, logIndex: 0, transactionHash: '0xa2' },
        ],
      };
    });
    _setSharedReadProviderForTests(makeFakeProvider({
      getBlockNumber: async () => { throw new Error('must not scan chain when the API answers'); },
      getLogs: async () => { throw new Error('must not scan chain when the API answers'); },
    }));

    const result = await wwxrpDrawMod.readPlayerWwxrpDrawDays({ player: PLAYER });
    assert.deepEqual(fetchCalls, [`/player/${PLAYER.toLowerCase()}/wwxrp-draws`]);
    assert.deepEqual(result.days, [9, 12]);
    assert.equal(result.complete, true);
  });

  test('falls back to the chain scan on an API failure and memoizes it', async () => {
    const base = Number(CHAIN.deployBlock);
    let head = base + 5;
    const ranges = [];
    let fetchCalls = 0;
    wwxrpDrawMod.__setWwxrpDrawFetcherForTest(async () => {
      fetchCalls += 1;
      const error = new Error('API 404');
      error.status = 404;
      throw error;
    });
    _setSharedReadProviderForTests(makeFakeProvider({
      getBlockNumber: async () => head,
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([Number(fromBlock), Number(toBlock)]);
        return [];
      },
    }));

    const first = await wwxrpDrawMod.readPlayerWwxrpDrawDays({ player: PLAYER });
    assert.equal(fetchCalls, 1, 'the first read attempts the API once');
    assert.equal(ranges.length, 1, 'an API failure falls back to the chain scan');
    assert.deepEqual(first.days, []);

    head += 5;
    invalidateReadCache();
    await wwxrpDrawMod.readPlayerWwxrpDrawDays({ player: PLAYER });
    assert.equal(fetchCalls, 1, 'a memoized API failure is not retried within the 5-minute window');
    assert.equal(ranges.length, 2, 'the chain fallback keeps serving reads while the API is memoized');
  });

  test('a non-fallback caller (gameState publish) settles for cached days on API failure', async () => {
    wwxrpDrawMod.__setWwxrpDrawFetcherForTest(async () => {
      throw new Error('API down');
    });
    _setSharedReadProviderForTests(makeFakeProvider({
      getBlockNumber: async () => { throw new Error('must not scan chain when fallback is disallowed'); },
      getLogs: async () => { throw new Error('must not scan chain when fallback is disallowed'); },
    }));

    const result = await wwxrpDrawMod.readPlayerWwxrpDrawDays({
      player: PLAYER,
      allowChainFallback: false,
    });
    assert.deepEqual(result.days, []);
    assert.equal(result.complete, false);
  });
});
