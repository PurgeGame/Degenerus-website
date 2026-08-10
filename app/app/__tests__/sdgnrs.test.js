// /app/app/__tests__/sdgnrs.test.js — sDGNRS redemption burn write path.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as sdgnrsMod from '../sdgnrs.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import { CONTRACTS } from '../chain-config.js';

const CONNECTED = '0xab12000000000000000000000000000000000000';
const TOKEN = 10n ** 18n;

function makeFakeProvider() {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => CONNECTED }),
  };
}

function makeFakeContract({
  staticError = null,
  preview = [0n, 0n],
  pending = [0n, 0, 0n],
  roll = 0,
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
  return {
    burn,
    claimRedemption,
    previewBurnValue: async (amount) => {
      calls.push(['preview', amount]);
      return preview;
    },
    pendingRedemptions: async () => pending,
    redemptionPeriods: async () => roll,
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
    assert.deepEqual(fake._calls[0], ['static', amount]);
    assert.deepEqual(fake._calls[1], [amount]);
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

    assert.deepEqual(result, { ethOut: 42n, flipOut: 9000n });
    assert.deepEqual(fake._calls.at(-1), ['preview', 25n * TOKEN]);
  });

  test('rejects a sub-token burn before constructing a contract', async () => {
    let builds = 0;
    sdgnrsMod.__setContractFactoryForTest(() => { builds += 1; return makeFakeContract(); });

    await assert.rejects(
      sdgnrsMod.burnSdgnrs({ amount: TOKEN - 1n }),
      /minimum burn is 1 sdgnrs/i,
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

  test('maps the live-game RNG gate to compact copy', async () => {
    const error = new Error('reverted');
    error.revert = { name: 'BurnsBlockedDuringRng' };
    sdgnrsMod.__setContractFactoryForTest(() => makeFakeContract({ staticError: error }));

    await assert.rejects(
      sdgnrsMod.burnSdgnrs({ amount: TOKEN }),
      (caught) => caught.code === 'BurnsBlockedDuringRng'
        && /after rng settles/i.test(caught.userMessage),
    );
  });

  test('decodes the submitted period and final redemption payout from receipts', () => {
    const iface = new contractsMod.ethers.Interface([
      'event RedemptionSubmitted(address indexed player, uint256 sdgnrsAmount, uint256 ethValueOwed, uint256 flipEscrowed, uint24 periodIndex)',
      'event RedemptionClaimed(address indexed player, uint16 roll, uint256 ethPayout, uint256 lootboxEth, uint256 flipPaid)',
    ]);
    const submitted = iface.encodeEventLog(iface.getEvent('RedemptionSubmitted'), [
      CONNECTED, 25n * TOKEN, 4n, 5n, 67,
    ]);
    const claimed = iface.encodeEventLog(iface.getEvent('RedemptionClaimed'), [
      CONNECTED, 142, 2n, 2n, 900n,
    ]);
    const receipt = {
      hash: '0xabc123',
      logs: [submitted, claimed].map((event) => ({
        address: CONTRACTS.SDGNRS,
        topics: event.topics,
        data: event.data,
      })),
    };

    const parsed = sdgnrsMod.parseSdgnrsRedemptionReceipt(receipt, CONNECTED);
    assert.equal(parsed.submissions[0].periodIndex, 67);
    assert.equal(parsed.submissions[0].sdgnrsAmount, 25n * TOKEN);
    assert.deepEqual(
      { roll: parsed.claims[0].roll, eth: parsed.claims[0].ethPayout, box: parsed.claims[0].lootboxEth, flip: parsed.claims[0].flipPaid },
      { roll: 142, eth: 2n, box: 2n, flip: 900n },
    );
  });

  test('reads exact pending/ready state and claims the resolved redemption', async () => {
    const iface = new contractsMod.ethers.Interface([
      'event RedemptionClaimed(address indexed player, uint16 roll, uint256 ethPayout, uint256 lootboxEth, uint256 flipPaid)',
    ]);
    const event = iface.encodeEventLog(iface.getEvent('RedemptionClaimed'), [
      CONNECTED, 125, 4n, 4n, 500n,
    ]);
    const receipt = {
      status: 1,
      hash: '0xc1a1',
      logs: [{ address: CONTRACTS.SDGNRS, topics: event.topics, data: event.data }],
    };
    const fake = makeFakeContract({
      pending: [8n, 156, 500n],
      roll: 125,
      claimReceipt: receipt,
    });
    sdgnrsMod.__setContractFactoryForTest(() => fake);

    const state = await sdgnrsMod.readSdgnrsRedemptionState({
      player: CONNECTED,
      periodIndex: 67,
    });
    assert.equal(state.exists, true);
    assert.equal(state.ready, true);
    assert.equal(state.roll, 125);

    const result = await sdgnrsMod.claimSdgnrsRedemption({
      player: CONNECTED,
      periodIndex: 67,
    });
    assert.deepEqual(fake._order, ['claim-static', 'claim-send']);
    assert.equal(result.claim.lootboxEth, 4n);
    assert.equal(result.claim.flipPaid, 500n);
  });

  test('discovery retains and aggregates the burned amount for each pending period', async () => {
    const iface = new contractsMod.ethers.Interface([
      'event RedemptionSubmitted(address indexed player, uint256 sdgnrsAmount, uint256 ethValueOwed, uint256 flipEscrowed, uint24 periodIndex)',
    ]);
    const logs = [12n, 13n].map((amount, index) => {
      const event = iface.encodeEventLog(iface.getEvent('RedemptionSubmitted'), [
        CONNECTED, amount * TOKEN, 4n, 5n, 67,
      ]);
      return {
        address: CONTRACTS.SDGNRS,
        topics: event.topics,
        data: event.data,
        blockNumber: 1_000 + index,
        transactionHash: `0x${index + 1}`,
        index,
      };
    });
    contractsMod.setProvider({
      ...makeFakeProvider(),
      getBlockNumber: async () => 1_100,
      getLogs: async () => logs,
    });
    sdgnrsMod.__setContractFactoryForTest(() => makeFakeContract({
      pending: [8n, 156, 500n],
      roll: 0,
    }));

    const discovered = await sdgnrsMod.discoverSdgnrsRedemptions({ player: CONNECTED });
    assert.equal(discovered.periods.length, 1);
    assert.equal(discovered.periods[0].periodIndex, 67);
    assert.equal(discovered.periods[0].sdgnrsAmount, 25n * TOKEN);
  });
});
