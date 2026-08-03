import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as salvageMod from '../salvage.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';

const CONNECTED = '0xab12000000000000000000000000000000000000';

function makeProvider() {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => CONNECTED }),
  };
}

function makeContract({ preview = [100n, 10n, 6n, 3n, 1n], staticError = null } = {}) {
  const calls = [];
  const previewMethod = Object.assign(async (...args) => {
    calls.push(['preview-send', ...args]);
    return preview;
  }, {
    staticCall: async (...args) => {
      calls.push(['preview', ...args]);
      return preview;
    },
  });
  const sellMethod = Object.assign(async (...args) => {
    calls.push(['sell', ...args]);
    return { hash: '0xsalvage', wait: async () => ({ status: 1, logs: [] }) };
  }, {
    staticCall: async (...args) => {
      calls.push(['static', ...args]);
      if (staticError) throw staticError;
    },
  });
  return {
    previewSellFarFutureEntries: previewMethod,
    sellFarFutureEntries: sellMethod,
    connect() { return this; },
    calls,
  };
}

describe('far-future salvage contract bridge', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeProvider());
  });

  afterEach(() => {
    salvageMod.__resetSalvageContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('normalizes the exact preview tuple and sends entry counts', async () => {
    const contract = makeContract();
    salvageMod.__setSalvageContractFactoryForTest(() => contract);
    const quote = await salvageMod.previewFarFutureSalvage({
      player: CONNECTED,
      levels: [44, 61],
      quantities: [8, 4],
    });
    assert.deepEqual(quote, {
      totalFaceWei: 100n,
      totalBudget: 10n,
      ticketWei: 6n,
      ethCashWei: 3n,
      flipTokens: 1n,
    });
    assert.deepEqual(contract.calls[0], [
      'preview', CONNECTED, [44n, 61n], [8n, 4n],
    ]);
  });

  test('preflights then atomically sells with exact queue indices', async () => {
    const contract = makeContract();
    salvageMod.__setSalvageContractFactoryForTest(() => contract);
    const result = await salvageMod.sellFarFutureSalvage({
      player: CONNECTED,
      levels: [44, 61],
      quantities: [8, 4],
      queueIndices: [7, 2],
    });
    assert.equal(result.receipt.status, 1);
    assert.deepEqual(contract.calls, [
      ['static', CONNECTED, [44n, 61n], [8n, 4n], [7n, 2n]],
      ['sell', CONNECTED, [44n, 61n], [8n, 4n], [7n, 2n]],
    ]);
  });

  test('rejects fractional-ticket quantities before any contract call', async () => {
    let builds = 0;
    salvageMod.__setSalvageContractFactoryForTest(() => { builds += 1; return makeContract(); });
    await assert.rejects(
      salvageMod.previewFarFutureSalvage({ player: CONNECTED, levels: [44], quantities: [6] }),
      /whole tickets/i,
    );
    assert.equal(builds, 0);
  });

  test('maps a stale/full-liquidation failure to compact salvage copy', async () => {
    const error = new Error('reverted');
    error.revert = { name: 'E' };
    salvageMod.__setSalvageContractFactoryForTest(() => makeContract({ staticError: error }));
    await assert.rejects(
      salvageMod.sellFarFutureSalvage({
        player: CONNECTED,
        levels: [44],
        quantities: [8],
        queueIndices: [7],
      }),
      (caught) => caught.code === 'E' && /offer changed|buyer/i.test(caught.userMessage),
    );
  });
});
