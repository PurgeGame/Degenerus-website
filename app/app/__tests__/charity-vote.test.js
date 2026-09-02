// GNRUS approval-ballot reads and writes.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as charityVoteMod from '../charity-vote.js';
import * as contractsMod from '../contracts.js';
import * as storeMod from '../store.js';
import { CHAIN } from '../chain-config.js';

const CONNECTED = '0xab12000000000000000000000000000000000000';
const PRIOR = '0x1111111111111111111111111111111111111111';
const ACTIVE = '0x2222222222222222222222222222222222222222';
const TOKEN = 10n ** 18n;

function encodedUint(value) {
  return `0x${BigInt(value).toString(16).padStart(64, '0')}`;
}

function makeProvider() {
  const signer = { getAddress: async () => CONNECTED };
  return {
    getBlockNumber: async () => 888,
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => signer,
  };
}

describe('GNRUS charity approval voting', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeProvider());
  });

  afterEach(() => {
    charityVoteMod.__resetCharityVoteForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('pins the level, slate, weights, vote flags, and sDGNRS balance to one block', async () => {
    const calls = [];
    const gnrus = {
      currentLevel: async (...args) => { calls.push(['level', ...args]); return 43n; },
      getActiveSlots: async (...args) => {
        calls.push(['slots', ...args]);
        return { slots: [0n, 3n], recipients: [PRIOR, ACTIVE] };
      },
      lastWinningRecipient: async (...args) => { calls.push(['winner', ...args]); return PRIOR; },
      slotApproveWeight: async (...args) => {
        calls.push(['weight', ...args]);
        return Number(args[1]) === 0 ? 9_000n : 4_250n;
      },
      hasVoted: async (...args) => {
        calls.push(['voted', ...args]);
        return Number(args[2]) === 3;
      },
    };
    const sdgnrs = {
      balanceOf: async (...args) => {
        calls.push(['balance', ...args]);
        return 12_345n * TOKEN;
      },
    };
    charityVoteMod.__setContractFactoriesForTest({
      gnrus: () => gnrus,
      sdgnrs: () => sdgnrs,
    });

    const state = await charityVoteMod.readCharityVoteState({ voter: CONNECTED });

    assert.equal(state.blockTag, 888);
    assert.equal(state.level, 43);
    assert.equal(state.votingPower, 12_345n * TOKEN);
    assert.deepEqual(state.candidates, [
      { slot: 0, recipient: PRIOR, weight: 9_000n, voted: false, previousWinner: true },
      { slot: 3, recipient: ACTIVE, weight: 4_250n, voted: true, previousWinner: false },
    ]);
    assert.ok(calls.length >= 8);
    for (const call of calls) {
      assert.deepEqual(call.at(-1), { blockTag: 888 }, `${call[0]} uses the pinned block`);
    }
  });

  test('sums every GNRUS yield share once and replaces the recent reorg tail', async () => {
    const deploy = Number(CHAIN.deployBlock);
    let head = deploy + 50_100;
    let events = [
      { blockNumber: deploy + 10, index: 1, transactionHash: '0xaaa', data: encodedUint(5n) },
      { blockNumber: deploy + 50_000, index: 2, transactionHash: '0xbbb', data: encodedUint(7n) },
    ];
    const calls = [];
    const provider = {
      getBlockNumber: async () => head,
      getLogs: async (filter) => {
        calls.push(filter);
        return events.filter((event) => (
          event.blockNumber >= Number(filter.fromBlock)
          && event.blockNumber <= Number(filter.toBlock)
        ));
      },
    };
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    // The chain scan is a fallback now — force the API leg to throw so every
    // call in this test exercises the log-scan path deterministically.
    charityVoteMod.__setGnrusFundingFetcherForTest(async () => { throw new Error('offline'); });

    assert.equal(await charityVoteMod.readGnrusLifetimeFunding({ provider, storage }), 12n);
    assert.equal(calls.length, 2, 'the initial history uses bounded 50,000-block reads');
    assert.ok(calls.every((call) => call.address && call.topics?.length === 1));

    assert.equal(
      await charityVoteMod.readGnrusLifetimeFunding({ provider, storage }),
      12n,
      'a poll inside the 5-minute failure memo returns the cached total',
    );
    assert.equal(calls.length, 2, 'the memoized fallback window skips the chain scan entirely');

    // Only the next poll after the memo expires may retry either leg.
    charityVoteMod.__expireGnrusFundingFallbackMemoForTest();
    head += 10;
    events = [
      events[0],
      { blockNumber: deploy + 50_000, index: 2, transactionHash: '0xbbb2', data: encodedUint(9n) },
      { blockNumber: head, index: 0, transactionHash: '0xccc', data: encodedUint(3n) },
    ];
    assert.equal(await charityVoteMod.readGnrusLifetimeFunding({ provider, storage }), 17n,
      'the cached old event is retained while the overlapping tail is replaced, not duplicated');
    assert.equal(calls.length, 3, 'a refresh reads only the short reorg tail');
    assert.ok(charityVoteMod.gnrusLifetimeFundingCacheKey().includes(`:${deploy}:`));
  });

  test('reads GNRUS lifetime funding from the API sum route with no extra scaling', async () => {
    let requested = null;
    charityVoteMod.__setGnrusFundingFetcherForTest(async (path) => {
      requested = path;
      return { toBlock: 900, count: 4, sum: '48000000000000000000' };
    });

    const total = await charityVoteMod.readGnrusLifetimeFunding();
    assert.equal(requested, '/game/facts/sum?name=YieldSurplusDistributed&arg=perRecipientShare');
    assert.equal(total, 48n * TOKEN, 'the API sum is used directly — GNRUS already gets one exact share per event');
  });

  test('memoizes an API failure for 5 minutes so the 30s poller does not hammer either leg', async () => {
    let apiCalls = 0;
    let chainCalls = 0;
    charityVoteMod.__setGnrusFundingFetcherForTest(async () => {
      apiCalls += 1;
      throw new Error('API down');
    });
    const provider = {
      getBlockNumber: async () => Number(CHAIN.deployBlock) + 10,
      getLogs: async () => { chainCalls += 1; return []; },
    };
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };

    assert.equal(await charityVoteMod.readGnrusLifetimeFunding({ provider, storage }), 0n);
    assert.equal(apiCalls, 1);
    assert.equal(chainCalls, 1);

    assert.equal(await charityVoteMod.readGnrusLifetimeFunding({ provider, storage }), 0n);
    assert.equal(apiCalls, 1, 'the API is not retried while the failure memo is armed');
    assert.equal(chainCalls, 1, 'the chain fallback does not re-run while memoized');

    charityVoteMod.__expireGnrusFundingFallbackMemoForTest();
    await charityVoteMod.readGnrusLifetimeFunding({ provider, storage });
    assert.equal(apiCalls, 2, 'the next poll after the memo expires retries the API');
  });

  test('preflights and sends the selected approval through the connected signer', async () => {
    const order = [];
    const vote = Object.assign(
      async (slot) => {
        order.push(['send', slot]);
        return { hash: '0x4444', wait: async () => ({ status: 1, logs: [] }) };
      },
      {
        staticCall: async (slot) => { order.push(['static', slot]); },
      },
    );
    const gnrus = { vote, connect() { return this; } };
    charityVoteMod.__setContractFactoriesForTest({ gnrus: () => gnrus });

    const result = await charityVoteMod.voteForCharity({ slot: 3 });

    assert.equal(result.slot, 3);
    assert.equal(result.receipt.status, 1);
    assert.deepEqual(order, [['static', 3], ['send', 3]]);
  });

  test('maps already-supported reverts and blocks invalid or somebody-else writes', async () => {
    const already = new Error('reverted');
    already.revert = { name: 'VoteRejected', args: [1] };
    const vote = Object.assign(
      async () => { throw new Error('send should not run'); },
      { staticCall: async () => { throw already; } },
    );
    charityVoteMod.__setContractFactoriesForTest({
      gnrus: () => ({ vote, connect() { return this; } }),
    });

    await assert.rejects(
      charityVoteMod.voteForCharity({ slot: 1 }),
      (error) => error.code === 'AlreadyVoted' && /already voted/i.test(error.userMessage),
    );
    await assert.rejects(charityVoteMod.voteForCharity({ slot: 20 }), /valid charity/i);

    storeMod.update('viewing.address', '0xcd34000000000000000000000000000000000000');
    await assert.rejects(charityVoteMod.voteForCharity({ slot: 1 }), /own wallet/i);

    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'combined');
    await assert.rejects(charityVoteMod.voteForCharity({ slot: 1 }), /own wallet/i);
  });
});
