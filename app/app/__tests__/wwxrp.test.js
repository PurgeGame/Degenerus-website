// WWXRP daily-draw burn write path.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as wwxrpMod from '../wwxrp.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';

const CONNECTED = '0xab12000000000000000000000000000000000000';
const TOKEN = 10n ** 18n;

function makeFakeProvider() {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => CONNECTED }),
  };
}

function makeFakeContract({ staticError = null } = {}) {
  const calls = [];
  const order = [];
  const enter = Object.assign(
    async (...args) => {
      calls.push(args);
      order.push('send');
      return { hash: '0x7778', wait: async () => ({ status: 1, logs: [] }) };
    },
    {
      staticCall: async (...args) => {
        calls.push(['static', ...args]);
        order.push('static');
        if (staticError) throw staticError;
      },
    },
  );
  return { enter, connect() { return this; }, _calls: calls, _order: order };
}

describe('burnWwxrp', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider());
  });

  afterEach(() => {
    wwxrpMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('preflights and enters the daily draw with the connected signer amount', async () => {
    const fake = makeFakeContract();
    wwxrpMod.__setContractFactoryForTest(() => fake);
    const amount = 250n * TOKEN;

    const result = await wwxrpMod.burnWwxrp({ amount });

    assert.equal(result.amount, amount);
    assert.deepEqual(fake._order, ['static', 'send']);
    assert.deepEqual(fake._calls, [['static', amount], [amount]]);
    assert.equal(result.receipt.status, 1);
  });

  test('rejects anything below the contract minimum before constructing a contract', async () => {
    let builds = 0;
    wwxrpMod.__setContractFactoryForTest(() => { builds += 1; return makeFakeContract(); });
    await assert.rejects(
      wwxrpMod.burnWwxrp({ amount: (25n * TOKEN) - 1n }),
      /minimum burn is 25 wwxrp/i,
    );
    assert.equal(builds, 0);
  });

  test('does not burn the operator wallet while viewing somebody else', async () => {
    storeMod.update('ui.mode', 'operator');
    storeMod.update('viewing.address', '0xcd34000000000000000000000000000000000000');
    await assert.rejects(
      wwxrpMod.burnWwxrp({ amount: 25n * TOKEN }),
      /token owner's view/i,
    );
  });

  test('maps an insufficient on-chain balance to compact copy', async () => {
    const error = new Error('reverted');
    error.revert = { name: 'InsufficientBalance' };
    wwxrpMod.__setContractFactoryForTest(() => makeFakeContract({ staticError: error }));
    await assert.rejects(
      wwxrpMod.burnWwxrp({ amount: 25n * TOKEN }),
      (caught) => caught.code === 'InsufficientBalance'
        && /not enough wwxrp/i.test(caught.userMessage),
    );
  });
});
