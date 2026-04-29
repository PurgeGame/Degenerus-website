// /app/app/__tests__/lootbox.test.js — Phase 60 Plan 60-02 (LBX-01 + LBX-04).
//
// Run: cd website && node --test app/app/__tests__/lootbox.test.js
//
// Coverage strategy: drive the full chain end-to-end with a fake contract injected
// at the lootbox.js layer via __setContractFactoryForTest. Tests assert observable
// outcomes (contract method called with correct args; static-call gate triggers
// structured-throw on revert; receipt-log parsers extract event payloads).
//
// Phase 56 (static-call) and Phase 58 (sendTx + requireSelf + chain-assert) primitives
// run for real — only the contract construction is mocked.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as lootboxMod from '../lootbox.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';

// ---------------------------------------------------------------------------
// Fake provider/signer/contract harness
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) {
  return { status: 1, hash: '0xreceipt-hash', logs: logs || [] };
}

function makeFakeTx(receipt) {
  return { hash: '0xtx-hash', wait: async () => receipt };
}

/**
 * Builds a fake ethers Contract whose method handlers record their call args
 * and return fake transactions. `interface.parseLog` reads `log.parsed` (tests
 * inject pre-parsed logs to avoid needing a real ABI Interface).
 */
function makeFakeContract(opts = {}) {
  const calls = {
    purchase: [],
    purchaseCoin: [],
    openLootBox: [],
    openBurnieLootBox: [],
    lootboxRngWord: [],
  };
  const staticCallStub = (methodName) => async (..._args) => {
    if (opts.staticCallShouldRevert?.[methodName]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[methodName] || 'RngNotReady' };
      throw err;
    }
    return undefined;
  };
  const c = {
    purchase: Object.assign(
      async (...args) => {
        calls.purchase.push(args);
        return makeFakeTx(makeFakeReceipt(opts.purchaseLogs));
      },
      { staticCall: staticCallStub('purchase') }
    ),
    purchaseCoin: Object.assign(
      async (...args) => {
        calls.purchaseCoin.push(args);
        return makeFakeTx(makeFakeReceipt(opts.purchaseCoinLogs));
      },
      { staticCall: staticCallStub('purchaseCoin') }
    ),
    openLootBox: Object.assign(
      async (...args) => {
        calls.openLootBox.push(args);
        return makeFakeTx(makeFakeReceipt(opts.openLogs));
      },
      { staticCall: staticCallStub('openLootBox') }
    ),
    openBurnieLootBox: Object.assign(
      async (...args) => {
        calls.openBurnieLootBox.push(args);
        return makeFakeTx(makeFakeReceipt(opts.openLogs));
      },
      { staticCall: staticCallStub('openBurnieLootBox') }
    ),
    lootboxRngWord: async (idx) => {
      calls.lootboxRngWord.push(idx);
      return opts.rngWord ?? 0n;
    },
    interface: {
      parseLog: (log) => log.parsed ?? null,
    },
    // requireStaticCall calls .connect(signer) when given a signer; return self.
    connect(_signer) { return this; },
    _calls: calls,
  };
  return c;
}

function makeFakeProvider(connectedAddr) {
  return {
    // Sepolia chainId per chain-config.sepolia.js (CHAIN.id === 11155111).
    getNetwork: async () => ({ chainId: 11155111n }),
    getSigner: async () => ({
      getAddress: async () => connectedAddr,
    }),
  };
}

const CONNECTED = '0xab12000000000000000000000000000000000000';

describe('Plan 60-02: lootbox.js write helpers + parsers', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    lootboxMod.__setContractFactoryForTest((_signerOrProvider) => lastFakeContract);
  });

  afterEach(() => {
    lootboxMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('__setContractFactoryForTest seam works (sanity)', () => {
    const res = lootboxMod.parseLootboxIdxFromReceipt({ logs: [] }, lastFakeContract);
    assert.deepEqual(res, []);
  });

  test('purchaseEth calls contract.purchase with payKind=0, ticketQuantity*100, ZeroHash affiliate', async () => {
    await lootboxMod.purchaseEth({ ticketQuantity: 5, lootboxQuantity: 1 });
    assert.equal(lastFakeContract._calls.purchase.length, 1, 'purchase called once');
    const [args] = lastFakeContract._calls.purchase;
    assert.equal(args[0], CONNECTED, 'buyer is connected.address');
    assert.equal(args[1], 500n, 'ticketQuantity multiplied by 100 (NatSpec: 2 decimals scaled by 100)');
    assert.ok(args[2] > 0n, 'lootBoxAmount > 0 (default LOOTBOX_MIN_WEI × N)');
    assert.equal(typeof args[3], 'string');
    assert.equal(args[3], '0x0000000000000000000000000000000000000000000000000000000000000000', 'ZeroHash affiliate default');
    assert.equal(args[4], 0, 'payKind = MintPaymentKind.DirectEth (0)');
    // Last arg is the overrides object with msg.value.
    assert.ok(typeof args[5] === 'object' && args[5] !== null, 'overrides object passed');
    assert.ok(args[5].value > 0n, 'value > 0 sent as msg.value');
  });

  test('purchaseEth lootBoxAmount = LOOTBOX_MIN_WEI × N when not provided', async () => {
    await lootboxMod.purchaseEth({ ticketQuantity: 0, lootboxQuantity: 3 });
    const [args] = lastFakeContract._calls.purchase;
    // LOOTBOX_MIN_WEI = 0.01 ether = 10n^16; × 3 = 3 × 10^16
    assert.equal(args[2], lootboxMod.LOOTBOX_MIN_WEI * 3n);
    assert.equal(args[5].value, lootboxMod.LOOTBOX_MIN_WEI * 3n);
  });

  test('purchaseEth static-call revert throws structured error with userMessage and code', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { purchase: true },
      staticCallRevertName: { purchase: 'RngNotReady' },
    });
    lootboxMod.__setContractFactoryForTest(() => reverting);
    let caught = null;
    try {
      await lootboxMod.purchaseEth({ ticketQuantity: 1, lootboxQuantity: 1 });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'purchaseEth threw');
    assert.equal(caught.code, 'RngNotReady');
    assert.ok(caught.userMessage && caught.userMessage.length > 0, 'userMessage present');
    // sendTx must NOT have been called when the static-call gate trips.
    assert.equal(reverting._calls.purchase.length, 0, 'gate blocked sendTx');
  });

  test('purchaseCoin does NOT pass affiliateCode (3 args: buyer, ticketQuantity*100, burnieAmount)', async () => {
    await lootboxMod.purchaseCoin({ ticketQuantity: 3, lootboxQuantity: 2 });
    assert.equal(lastFakeContract._calls.purchaseCoin.length, 1);
    const [args] = lastFakeContract._calls.purchaseCoin;
    assert.equal(args.length, 3, 'exactly 3 args (no affiliateCode, no overrides since non-payable)');
    assert.equal(args[0], CONNECTED);
    assert.equal(args[1], 300n, 'ticketQuantity * 100');
    assert.ok(args[2] > 0n, 'lootBoxBurnieAmount > 0 (default BURNIE_LOOTBOX_MIN_WEI × N)');
    // BURNIE_LOOTBOX_MIN_WEI = 1000 ether; × 2 = 2000 ether.
    assert.equal(args[2], lootboxMod.BURNIE_LOOTBOX_MIN_WEI * 2n);
  });

  test('purchaseCoin static-call revert (e.g. GameOverPossible) throws structured error', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { purchaseCoin: true },
      staticCallRevertName: { purchaseCoin: 'GameOverPossible' },
    });
    lootboxMod.__setContractFactoryForTest(() => reverting);
    let caught = null;
    try {
      await lootboxMod.purchaseCoin({ ticketQuantity: 1, lootboxQuantity: 1 });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught);
    assert.equal(caught.code, 'GameOverPossible');
    assert.match(caught.userMessage, /BURNIE.*blocked|game-over/i);
  });

  test('openLootBox payKind=ETH calls openLootBox method', async () => {
    await lootboxMod.openLootBox({ lootboxIndex: 7n, payKind: 'ETH' });
    assert.equal(lastFakeContract._calls.openLootBox.length, 1);
    assert.equal(lastFakeContract._calls.openBurnieLootBox.length, 0);
    const [args] = lastFakeContract._calls.openLootBox;
    assert.equal(args[0], CONNECTED);
    assert.equal(args[1], 7n);
  });

  test('openLootBox payKind=BURNIE calls openBurnieLootBox method', async () => {
    await lootboxMod.openLootBox({ lootboxIndex: 12n, payKind: 'BURNIE' });
    assert.equal(lastFakeContract._calls.openBurnieLootBox.length, 1);
    assert.equal(lastFakeContract._calls.openLootBox.length, 0);
    const [args] = lastFakeContract._calls.openBurnieLootBox;
    assert.equal(args[0], CONNECTED);
    assert.equal(args[1], 12n);
  });

  test('parseLootboxIdxFromReceipt extracts ETH purchase indexes from LootBoxIdx logs', () => {
    const fakeReceipt = {
      logs: [
        { parsed: { name: 'LootBoxIdx', args: { index: 5n, day: 42n, buyer: CONNECTED } } },
        { parsed: { name: 'OtherEvent', args: {} } },
        { parsed: { name: 'LootBoxIdx', args: { index: 6n, day: 42n, buyer: CONNECTED } } },
      ],
    };
    const idxs = lootboxMod.parseLootboxIdxFromReceipt(fakeReceipt, lastFakeContract);
    assert.equal(idxs.length, 2);
    assert.equal(idxs[0].lootboxIndex, 5n);
    assert.equal(idxs[0].day, 42n);
    assert.equal(idxs[0].payKind, 'ETH');
    assert.equal(idxs[1].lootboxIndex, 6n);
  });

  test('parseLootboxIdxFromReceipt extracts BURNIE purchase indexes from BurnieLootBuy logs', () => {
    const fakeReceipt = {
      logs: [
        { parsed: { name: 'BurnieLootBuy', args: { index: 9n, burnieAmount: 1000n * 10n ** 18n, buyer: CONNECTED } } },
      ],
    };
    const idxs = lootboxMod.parseLootboxIdxFromReceipt(fakeReceipt, lastFakeContract);
    assert.equal(idxs.length, 1);
    assert.equal(idxs[0].lootboxIndex, 9n);
    assert.equal(idxs[0].day, null);
    assert.equal(idxs[0].payKind, 'BURNIE');
  });

  test('parseLootboxIdxFromReceipt skips non-matching / null-parsed logs without throwing', () => {
    const fakeReceipt = {
      logs: [
        { parsed: null },
        { parsed: { name: 'TraitsGenerated', args: {} } },
        { parsed: { name: 'LootBoxIdx', args: { index: 1n, day: 1n, buyer: CONNECTED } } },
      ],
    };
    const idxs = lootboxMod.parseLootboxIdxFromReceipt(fakeReceipt, lastFakeContract);
    assert.equal(idxs.length, 1);
    assert.equal(idxs[0].lootboxIndex, 1n);
  });

  test('parseLootboxIdxFromReceipt returns [] on null/empty receipt', () => {
    assert.deepEqual(lootboxMod.parseLootboxIdxFromReceipt({ logs: [] }, lastFakeContract), []);
    assert.deepEqual(lootboxMod.parseLootboxIdxFromReceipt(null, lastFakeContract), []);
    assert.deepEqual(lootboxMod.parseLootboxIdxFromReceipt(undefined, lastFakeContract), []);
  });

  test('parseTraitsGeneratedFromReceipt extracts trait events with all 6 fields', () => {
    const fakeReceipt = {
      logs: [
        {
          parsed: {
            name: 'TraitsGenerated',
            args: {
              player: CONNECTED,
              level: 3n,
              queueIdx: 0n,
              startIndex: 0n,
              count: 4n,
              entropy: 0xdeadbeefn,
            },
          },
        },
        { parsed: { name: 'NoMatch', args: {} } },
      ],
    };
    const traits = lootboxMod.parseTraitsGeneratedFromReceipt(fakeReceipt, lastFakeContract);
    assert.equal(traits.length, 1);
    assert.equal(traits[0].player, CONNECTED);
    assert.equal(traits[0].level, 3n);
    assert.equal(traits[0].queueIdx, 0n);
    assert.equal(traits[0].startIndex, 0n);
    assert.equal(traits[0].count, 4n);
    assert.equal(traits[0].entropy, 0xdeadbeefn);
  });

  test('parseTraitsGeneratedFromReceipt returns [] on empty/null receipt', () => {
    assert.deepEqual(lootboxMod.parseTraitsGeneratedFromReceipt({ logs: [] }, lastFakeContract), []);
    assert.deepEqual(lootboxMod.parseTraitsGeneratedFromReceipt(null, lastFakeContract), []);
    assert.deepEqual(lootboxMod.parseTraitsGeneratedFromReceipt(undefined, lastFakeContract), []);
  });

  test('pollRngForLootbox returns 0n when contract view returns 0', async () => {
    const c = makeFakeContract({ rngWord: 0n });
    lootboxMod.__setContractFactoryForTest(() => c);
    const word = await lootboxMod.pollRngForLootbox(7n);
    assert.equal(word, 0n);
  });

  test('pollRngForLootbox returns the word value when non-zero', async () => {
    const c = makeFakeContract({ rngWord: 12345678n });
    lootboxMod.__setContractFactoryForTest(() => c);
    const word = await lootboxMod.pollRngForLootbox(7n);
    assert.equal(word, 12345678n);
  });

  test('pollRngForLootbox returns 0n when no provider configured', async () => {
    contractsMod.clearProvider();
    const word = await lootboxMod.pollRngForLootbox(7n);
    assert.equal(word, 0n);
  });
});
