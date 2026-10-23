// /app/app/__tests__/sdgnrs.test.js — sDGNRS redemption burn write path.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as sdgnrsMod from '../sdgnrs.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import { CHAIN, CONTRACTS } from '../chain-config.js';
import { invalidateReadCache } from '../read-provider.js';
import { _setWalletIdForTests } from '../wallet-id.js';
import { prepareWalletReceipt } from '../wallet-receipt.js';
import { ACTIVE_CHAIN_ID } from './helpers/active-chain.js';
import { rpcFixture } from './helpers/chain-rpc.js';
import { abi as sdgnrsAbi } from '../../chain/generated/sdgnrs.js';

const CONNECTED = '0xab12000000000000000000000000000000000000';
const CONNECTED_ID = 5;
_setWalletIdForTests(CONNECTED, CONNECTED_ID);
// Site token wei per whole token, and sDGNRS's raw (12-decimal) units per whole token.
const TOKEN = 10n ** 18n;
const RAW = 10n ** 12n;

function makeFakeProvider() {
  return {
    getNetwork: async () => ({ chainId: BigInt(ACTIVE_CHAIN_ID) }),
    getSigner: async () => ({ getAddress: async () => CONNECTED }),
  };
}

// A redemption batch as the contract returns it: (tokens, ethPayout, ethBase, flipEscrow, roll,
// flipReward). `pending` is the claim: (tokens, activityScore + 1).
function makeFakeContract({
  staticError = null,
  preview = [0n, 0n],
  pending = [0n, 0],
  batch = [0n, 0n, 0n, 0n, 0, 0],
  openBatch = 1,
  parked = false,
  claimReceipt = { status: 1, logs: [] },
} = {}) {
  const calls = [];
  const order = [];
  const burn = Object.assign(
    async (...args) => {
      calls.push(args);
      order.push('send');
      return { hash: '0x5d6e', wait: async () => ({ status: 1, logs: [] }) };
    },
    {
      staticCall: async (...args) => {
        calls.push(['static', ...args]);
        order.push('static');
        if (staticError) throw staticError;
      },
    },
  );
  const burnWrapped = Object.assign(
    async (...args) => {
      calls.push(['wrapped', ...args]);
      order.push('wrapped-send');
      return { hash: '0xd6e7', wait: async () => ({ status: 1, logs: [] }) };
    },
    {
      staticCall: async (...args) => {
        calls.push(['wrapped-static', ...args]);
        order.push('wrapped-static');
        if (staticError) throw staticError;
      },
    },
  );
  const claimRedemption = Object.assign(
    async (...args) => {
      calls.push(['claim', ...args]);
      order.push('claim-send');
      return { hash: '0xc1a1', wait: async () => claimReceipt };
    },
    {
      staticCall: async (...args) => {
        calls.push(['claim-static', ...args]);
        order.push('claim-static');
        if (staticError) throw staticError;
      },
    },
  );
  const claimParkedRedemption = Object.assign(
    async (...args) => {
      calls.push(['parked', ...args]);
      order.push('parked-send');
      return { hash: '0xc1a2', wait: async () => claimReceipt };
    },
    {
      staticCall: async (...args) => {
        calls.push(['parked-static', ...args]);
        order.push('parked-static');
        if (!parked) throw new Error('NoClaim');
      },
    },
  );
  return {
    burn,
    burnWrapped,
    claimRedemption,
    claimParkedRedemption,
    previewBurnValue: async (amount) => {
      calls.push(['preview', amount]);
      return preview;
    },
    pendingRedemptions: async (...args) => {
      calls.push(['pending', ...args]);
      return pending;
    },
    redemptionBatches: async () => batch,
    redemptionBatchState: async () => [openBatch, 0, 0, 0n],
    connect() { return this; },
    _calls: calls,
    _order: order,
  };
}

describe('burnSdgnrs', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider());
    // Every discovery test below exercises the chain-scan path unless it
    // explicitly installs its own fetcher stub; default to an always-failing
    // fetch so no test accidentally reaches the real indexer API.
    sdgnrsMod.__setSdgnrsFetcherForTest(async () => {
      throw new Error('sdgnrs API not stubbed in this test');
    });
  });

  afterEach(() => {
    sdgnrsMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('preflights and burns the connected signer amount', async () => {
    const fake = makeFakeContract();
    sdgnrsMod.__setContractFactoryForTest(() => fake);
    const amount = 25n * TOKEN;

    const result = await sdgnrsMod.burnSdgnrs({ amount });

    assert.equal(result.amount, amount);
    assert.deepEqual(fake._order, ['static', 'send']);
    assert.deepEqual(fake._calls[0], ['static', 25n * RAW], 'the chain takes 12-decimal raw units');
    assert.deepEqual(fake._calls[1], [25n * RAW]);
    assert.equal(result.receipt.status, 1);
  });

  test('burns transferable DGNRS through the wrapped redemption path', async () => {
    const fake = makeFakeContract();
    sdgnrsMod.__setContractFactoryForTest(() => fake);
    const amount = 12n * TOKEN;

    const result = await sdgnrsMod.burnDgnrs({ amount });

    assert.equal(result.amount, amount);
    assert.deepEqual(fake._order, ['wrapped-static', 'wrapped-send']);
    assert.deepEqual(fake._calls[0], ['wrapped-static', 12n * RAW]);
    assert.deepEqual(fake._calls[1], ['wrapped', 12n * RAW]);
    assert.equal(result.receipt.status, 1);
  });

  test('formats redemption receipts with no more than two significant figures', () => {
    assert.equal(sdgnrsMod.formatSdgnrsRedemptionAmount(15n * TOKEN / 10n), '1.5');
    assert.equal(sdgnrsMod.formatSdgnrsRedemptionAmount(25n * TOKEN), '25');
    assert.equal(sdgnrsMod.formatSdgnrsRedemptionAmount(123_450_000n * TOKEN), '120M');
    assert.equal(sdgnrsMod.formatSdgnrsRedemptionAmount(999_999n * TOKEN), '1M');
  });

  test('reads the current ETH expectation and contingent FLIP backing', async () => {
    const fake = makeFakeContract({ preview: [42n, 9000n] });
    sdgnrsMod.__setContractFactoryForTest(() => fake);

    const result = await sdgnrsMod.previewSdgnrsBurn({ amount: 25n * TOKEN });

    assert.deepEqual(result, { ethOut: 42n, flipOut: 9000n * TOKEN }, 'whole FLIP on chain, token wei here');
    assert.deepEqual(fake._calls.at(-1), ['preview', 25n * RAW]);
  });

  test('can preview through the public read path without a connected wallet', async () => {
    contractsMod.clearProvider();
    const fake = makeFakeContract({ preview: [17n, 33n] });
    sdgnrsMod.__setContractFactoryForTest(() => fake);

    const result = await sdgnrsMod.previewSdgnrsBurn({
      amount: TOKEN,
      publicRead: true,
    });

    assert.deepEqual(result, { ethOut: 17n, flipOut: 33n * TOKEN });
  });

  test('rejects a sub-token burn before constructing a contract', async () => {
    let builds = 0;
    sdgnrsMod.__setContractFactoryForTest(() => { builds += 1; return makeFakeContract(); });

    await assert.rejects(
      sdgnrsMod.burnSdgnrs({ amount: TOKEN / 2n }),
      /minimum burn is 1 sdgnrs/i,
    );
    await assert.rejects(
      sdgnrsMod.burnSdgnrs({ amount: TOKEN + 1n }),
      /up to 12 decimal places/i,
    );
    assert.equal(builds, 0);
  });

  test('does not burn an operator wallet while viewing somebody else', async () => {
    storeMod.update('ui.mode', 'operator');
    storeMod.update('viewing.address', '0xcd34000000000000000000000000000000000000');

    await assert.rejects(
      sdgnrsMod.burnSdgnrs({ amount: TOKEN }),
      /token owner's view/i,
    );
  });

  test('maps the game-over liveness gate to compact copy', async () => {
    const error = new Error('reverted');
    error.revert = { name: 'BurnsBlockedDuringLiveness' };
    sdgnrsMod.__setContractFactoryForTest(() => makeFakeContract({ staticError: error }));

    await assert.rejects(
      sdgnrsMod.burnSdgnrs({ amount: TOKEN }),
      (caught) => caught.code === 'BurnsBlockedDuringLiveness'
        && /paused during the game-over check/i.test(caught.userMessage),
    );
  });

  test('uses DGNRS copy for wrapped burn failures', async () => {
    const error = new Error('reverted');
    error.revert = { name: 'Insufficient' };
    sdgnrsMod.__setContractFactoryForTest(() => makeFakeContract({ staticError: error }));

    await assert.rejects(
      sdgnrsMod.burnDgnrs({ amount: TOKEN }),
      (caught) => /not enough DGNRS/i.test(caught.userMessage)
        && !/sDGNRS/i.test(caught.userMessage),
    );
  });

  test('decodes the submitted batch and final redemption payout from receipts', async () => {
    const f = await rpcFixture();
    await f.wallet(CONNECTED_ID, CONNECTED);
    const submitted = await f.event('SDGNRS', 'RedemptionSubmitted', {
      player: CONNECTED_ID, sdgnrsAmount: 25n * RAW, batchId: 67,
    });
    const claimed = await f.event('SDGNRS', 'RedemptionClaimed', {
      player: CONNECTED_ID, batchId: 67, roll: 142, ethPayout: 2n, lootboxEth: 2n, flipPaid: 900n,
    });
    const receipt = { hash: '0xabc123', blockNumber: 9999, logs: [submitted, claimed] };
    await prepareWalletReceipt(receipt, f.client);

    const saved = CONTRACTS.SDGNRS;
    CONTRACTS.SDGNRS = f.contracts.SDGNRS;
    try {
      const parsed = sdgnrsMod.parseSdgnrsRedemptionReceipt(receipt, CONNECTED);
      assert.equal(parsed.submissions[0].periodIndex, 67);
      assert.equal(parsed.submissions[0].batchId, 67);
      assert.equal(parsed.submissions[0].sdgnrsAmount, 25n * TOKEN, 'raw 12-decimal units read as token wei');
      assert.deepEqual(
        { roll: parsed.claims[0].roll, eth: parsed.claims[0].ethPayout, box: parsed.claims[0].lootboxEth, flip: parsed.claims[0].flipPaid },
        { roll: 142, eth: 2n, box: 2n, flip: 900n * TOKEN },
        'FLIP is whole tokens on chain',
      );
    } finally { CONTRACTS.SDGNRS = saved; }
  });

  test('reads an open batch: unpriced, waiting for the next RNG request', async () => {
    sdgnrsMod.__setContractFactoryForTest(() => makeFakeContract({ pending: [8n * RAW, 156], openBatch: 67 }));
    sdgnrsMod.__setGameFactoryForTest(() => ({ gameOver: async () => false }));

    const state = await sdgnrsMod.readSdgnrsRedemptionState({ player: CONNECTED, periodIndex: 67 });
    assert.equal(state.exists, true);
    assert.equal(state.open, true);
    assert.equal(state.ethValueOwed, null);
    assert.equal(state.flipEscrow, null);
    assert.equal(state.activityScore, 155, 'stored as score + 1');
    assert.equal(state.sdgnrsTokens, 8n * TOKEN);
    assert.equal(state.ready, false);
  });

  test('a resolved batch is claimable after game over and settles on its own while live', async () => {
    const batch = [16n * RAW, 40n, 800n, 1_000n, 125, 150];
    const fake = makeFakeContract({ pending: [8n * RAW, 156], batch, openBatch: 70 });
    sdgnrsMod.__setContractFactoryForTest(() => fake);

    sdgnrsMod.__setGameFactoryForTest(() => ({ gameOver: async () => false }));
    const live = await sdgnrsMod.readSdgnrsRedemptionState({ player: CONNECTED, periodIndex: 67, fresh: true });
    assert.equal(live.roll, 125);
    assert.equal(live.settling, true, 'the Mine FLIP walk pays it unless the miner parked it');
    assert.equal(live.ready, false);
    assert.equal(live.claimMethod, null);
    assert.equal(live.ethValueOwed, 400n, 'its pro-rata share (8 of 16 tokens) of the close price');
    assert.equal(live.flipEscrow, 500n * TOKEN);
    await assert.rejects(
      sdgnrsMod.claimSdgnrsRedemption({ player: CONNECTED, periodIndex: 67 }),
      (caught) => caught.code === 'RedemptionSettling',
    );

    const parkedFake = makeFakeContract({ pending: [8n * RAW, 156], batch, openBatch: 70, parked: true });
    sdgnrsMod.__setContractFactoryForTest(() => parkedFake);
    const parked = await sdgnrsMod.readSdgnrsRedemptionState({ player: CONNECTED, periodIndex: 67, fresh: true });
    assert.equal(parked.claimMethod, 'claimParkedRedemption');

    sdgnrsMod.__setGameFactoryForTest(() => ({ gameOver: async () => true }));
    const over = await sdgnrsMod.readSdgnrsRedemptionState({ player: CONNECTED, periodIndex: 67, fresh: true });
    assert.equal(over.claimMethod, 'claimRedemption');
    assert.equal(over.ready, true);
  });

  test('claims the resolved redemption with account 0 after game over', async () => {
    const f = await rpcFixture();
    await f.wallet(CONNECTED_ID, CONNECTED);
    const event = await f.event('SDGNRS', 'RedemptionClaimed', {
      player: CONNECTED_ID, batchId: 67, roll: 125, ethPayout: 4n, lootboxEth: 4n, flipPaid: 500n,
    });
    const receipt = { status: 1, hash: '0xc1a1', blockNumber: 9999, logs: [event] };
    await prepareWalletReceipt(receipt, f.client);
    const fake = makeFakeContract({
      pending: [8n * RAW, 156],
      batch: [16n * RAW, 40n, 800n, 1_000n, 125, 150],
      claimReceipt: receipt,
    });
    sdgnrsMod.__setContractFactoryForTest(() => fake);
    sdgnrsMod.__setGameFactoryForTest(() => ({ gameOver: async () => true }));

    const saved = CONTRACTS.SDGNRS;
    CONTRACTS.SDGNRS = f.contracts.SDGNRS;
    try {
      const result = await sdgnrsMod.claimSdgnrsRedemption({ player: CONNECTED, periodIndex: 67 });
      assert.deepEqual(fake._order.slice(-2), ['claim-static', 'claim-send']);
      assert.deepEqual(fake._calls.find((call) => call[0] === 'claim'), ['claim', 0, 67]);
      assert.equal(result.claim.lootboxEth, 4n);
      assert.equal(result.claim.flipPaid, 500n * TOKEN);
    } finally { CONTRACTS.SDGNRS = saved; }
  });

  test('discovery retains and aggregates the burned amount for each pending batch', async () => {
    const base = Number(CHAIN.deployBlock);
    const iface = new contractsMod.ethers.Interface(sdgnrsAbi);
    const logs = [12n, 13n].map((amount, index) => {
      const event = iface.encodeEventLog(iface.getEvent('RedemptionSubmitted'), [
        CONNECTED_ID, amount * RAW, 67,
      ]);
      return {
        address: CONTRACTS.SDGNRS,
        topics: event.topics,
        data: event.data,
        blockNumber: base + 10 + index,
        transactionHash: `0x${index + 1}`,
        index,
      };
    });
    let head = base + 100;
    const ranges = [];
    contractsMod.setProvider({
      ...makeFakeProvider(),
      getBlockNumber: async () => head,
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([Number(fromBlock), Number(toBlock)]);
        return logs.filter((log) => (
          log.blockNumber >= Number(fromBlock) && log.blockNumber <= Number(toBlock)
        ));
      },
    });
    sdgnrsMod.__setContractFactoryForTest(() => makeFakeContract({ pending: [8n * RAW, 156], openBatch: 67 }));

    const discovered = await sdgnrsMod.discoverSdgnrsRedemptions({ player: CONNECTED });
    assert.equal(discovered.periods.length, 1);
    assert.equal(discovered.periods[0].periodIndex, 67);
    assert.equal(discovered.periods[0].sdgnrsAmount, 25n * TOKEN);

    head = base + 105;
    invalidateReadCache();
    const refreshed = await sdgnrsMod.discoverSdgnrsRedemptions({
      player: CONNECTED,
      periodIndexes: [68],
    });
    assert.deepEqual(ranges.at(-1), [base + 89, base + 105],
      'the next poll scans only the reorg tail plus new blocks');
    assert.equal(refreshed.periods.length, 2,
      'durable batch ids join discovery without a second state-read wave');
    assert.equal(
      refreshed.periods.find((row) => row.periodIndex === 67).sdgnrsAmount,
      25n * TOKEN,
      'overlap logs replace by identity instead of double-counting',
    );
  });

  test('discovery reads redemptions from the API before touching the chain log scan', async () => {
    const fetchCalls = [];
    sdgnrsMod.__setSdgnrsFetcherForTest(async (path) => {
      fetchCalls.push(path);
      return {
        toBlock: 999,
        events: [
          {
            name: 'RedemptionSubmitted',
            args: { player: CONNECTED, sdgnrsAmount: String(25n * TOKEN), batchId: '67' },
            blockNumber: 12345, logIndex: 0, transactionHash: '0xaa',
          },
          {
            name: 'RedemptionClaimed',
            args: {
              player: CONNECTED, batchId: '67', roll: '142', ethPayout: '2', lootboxEth: '2', flipPaid: '900',
            },
            blockNumber: 12346, logIndex: 1, transactionHash: '0xbb',
          },
        ],
      };
    });
    sdgnrsMod.__setContractFactoryForTest(() => makeFakeContract({ pending: [8n * RAW, 156], openBatch: 67 }));
    contractsMod.setProvider({
      ...makeFakeProvider(),
      getBlockNumber: async () => Number(CHAIN.deployBlock) + 100,
      getLogs: async () => { throw new Error('must not scan chain when the API answers'); },
    });

    const discovered = await sdgnrsMod.discoverSdgnrsRedemptions({ player: CONNECTED });
    assert.deepEqual(fetchCalls, [`/player/${CONNECTED.toLowerCase()}/sdgnrs-redemptions`]);
    assert.equal(discovered.periods.length, 1);
    assert.equal(discovered.periods[0].periodIndex, 67);
    assert.equal(discovered.periods[0].sdgnrsAmount, 25n * TOKEN);
    assert.equal(discovered.claims.length, 1);
    assert.equal(discovered.claims[0].roll, 142);
    assert.equal(discovered.claims[0].flipPaid, 900n);
  });

  test('falls back to the chain scan on an API failure and memoizes it for later polls', async () => {
    const base = Number(CHAIN.deployBlock);
    let head = base + 20;
    const ranges = [];
    let fetchCalls = 0;
    sdgnrsMod.__setSdgnrsFetcherForTest(async () => {
      fetchCalls += 1;
      const error = new Error('API 404');
      error.status = 404;
      throw error;
    });
    contractsMod.setProvider({
      ...makeFakeProvider(),
      getBlockNumber: async () => head,
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([Number(fromBlock), Number(toBlock)]);
        return [];
      },
    });
    sdgnrsMod.__setContractFactoryForTest(() => makeFakeContract());

    await sdgnrsMod.discoverSdgnrsRedemptions({ player: CONNECTED });
    assert.equal(fetchCalls, 1, 'the first read attempts the API once');
    assert.equal(ranges.length, 1, 'an API failure falls back to a chain scan');

    head += 5;
    invalidateReadCache();
    await sdgnrsMod.discoverSdgnrsRedemptions({ player: CONNECTED });
    assert.equal(fetchCalls, 1, 'a memoized failure is not retried within the 5-minute window');
    assert.equal(ranges.length, 2, 'the chain fallback keeps serving reads while the API is memoized');
  });
});
