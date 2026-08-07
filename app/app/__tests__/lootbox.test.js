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
import { decodeRevertReason } from '../reason-map.js';

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
    purchaseStatic: [],
    buyLootboxAndPresaleBox: [],
    buyLootboxAndPresaleBoxStatic: [],
    buyPresaleBox: [],
    buyPresaleBoxStatic: [],
    openBox: [],
    openBoxStatic: [],
    lootboxStatus: [],
    claimableWinningsOf: [], afkingFundingOf: [],
    purchaseInfo: [],
  };
  const staticCallStub = (methodName) => async (...args) => {
    if (methodName === 'purchase') calls.purchaseStatic.push(args);
    if (methodName === 'buyLootboxAndPresaleBox') calls.buyLootboxAndPresaleBoxStatic.push(args);
    if (methodName === 'buyPresaleBox') calls.buyPresaleBoxStatic.push(args);
    if (methodName === 'openBox') calls.openBoxStatic.push(args);
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
    buyLootboxAndPresaleBox: Object.assign(
      async (...args) => {
        calls.buyLootboxAndPresaleBox.push(args);
        return makeFakeTx(makeFakeReceipt(opts.combinedPresaleLogs));
      },
      { staticCall: staticCallStub('buyLootboxAndPresaleBox') }
    ),
    buyPresaleBox: Object.assign(
      async (...args) => {
        calls.buyPresaleBox.push(args);
        return makeFakeTx(makeFakeReceipt(opts.presaleLogs));
      },
      { staticCall: staticCallStub('buyPresaleBox') }
    ),
    lootboxPresaleActiveFlag: async () => opts.presaleActive ?? true,
    presaleBoxCreditOf: async () => opts.presaleCredit ?? (2n * lootboxMod.PRESALE_BOX_MIN_WEI),
    presaleBoxEthRemaining: async () => opts.presaleRemaining ?? (50n * 10n ** 18n),
    openBox: Object.assign(
      async (...args) => {
        calls.openBox.push(args);
        return makeFakeTx(makeFakeReceipt(opts.openLogs));
      },
      { staticCall: staticCallStub('openBox') }
    ),
    lootboxStatus: async (...args) => {
      calls.lootboxStatus.push(args);
      return opts.lootboxStatus ?? [1n, false];
    },
    claimableWinningsOf: async (player) => {
      calls.claimableWinningsOf.push(player);
      if (opts.claimableReadShouldRevert) throw new Error('claimable read failed');
      return opts.claimableRaw ?? 0n;
    },
    afkingFundingOf: async (player) => {
      calls.afkingFundingOf.push(player);
      if (opts.afkingReadShouldRevert) throw new Error('AFKing funding read failed');
      return opts.afkingRaw ?? 0n;
    },
    interface: {
      parseLog: (log) => log.parsed ?? null,
    },
    // requireStaticCall calls .connect(signer) when given a signer; return self.
    connect(_signer) { return this; },
    _calls: calls,
  };
  if (opts.purchaseInfo != null) {
    c.purchaseInfo = async () => {
      calls.purchaseInfo.push([]);
      return opts.purchaseInfo;
    };
  }
  return c;
}

function makeFakeProvider(connectedAddr) {
  return {
    // Sepolia chainId per chain-config.sepolia.js (CHAIN.id === 84532).
    getNetwork: async () => ({ chainId: 84532n }),
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

  test('decodes the authoritative mid-day RNG queue fill and request latch', async () => {
    const queuePacked = 321n
      | (425n << 48n)
      | (1_000n << 112n)
      | (5n << 176n)
      | (30_000n << 184n);
    const requestTime = 1_720_000_000n;
    const timingPacked = requestTime << 48n;
    assert.deepEqual(
      lootboxMod.decodeLootboxRngQueueState(queuePacked, timingPacked, 900),
      {
        index: 321n,
        pendingMilliEth: 425n,
        thresholdMilliEth: 1_000n,
        pendingEthWei: 425n * 10n ** 15n,
        thresholdWei: 10n ** 18n,
        pendingFlipWhole: 30_000n,
        hasPending: true,
        queueReady: false,
        fillBps: 4_250,
        requestTime,
        rngLocked: false,
        middayRequestInFlight: true,
        blockNumber: 900,
      },
    );

    const reads = [];
    const provider = {
      getBlockNumber: async () => 901,
      getStorage: async (_address, slot, blockTag) => {
        reads.push([slot, blockTag]);
        return slot === 33n ? queuePacked : timingPacked | (1n << 152n);
      },
    };
    const locked = await lootboxMod.readLootboxRngQueueState({ provider });
    assert.equal(locked.rngLocked, true);
    assert.equal(locked.middayRequestInFlight, false,
      'a daily RNG lock is not mislabeled as the mid-day request');
    assert.deepEqual(reads, [[33n, 901], [0n, 901]], 'both slots share one block tag');
  });

  test('foil delegatecall errors decode by ABI name and raw selector', () => {
    const cases = [
      ['FoilAlreadyBought', '0x11e18a55'],
      // Audit c19a1088 deleted DirectEthInsufficient; the foil leg's shortfall now
      // surfaces as the canonical spend waterfall's shared Insolvent().
      ['Insolvent', '0xfc220038'],
      ['StaleAdvance', '0x933e332f'],
    ];
    for (const [name, selector] of cases) {
      assert.ok(lootboxMod.GAME_ABI.includes(`error ${name}()`), `${name} is in GAME_ABI`);
      assert.equal(decodeRevertReason({ data: selector }).code, name, `${name} selector registered`);
    }
  });

  test('foil availability uses the exact zero-value purchase probe and only accepts the funding sentinel', async () => {
    assert.equal(await lootboxMod.probeFoilPackAvailability({ buyer: CONNECTED }), true,
      'a successful forward-compatible zero-price simulation is available');
    assert.equal(lastFakeContract._calls.purchase.length, 0, 'the probe never sends');
    assert.equal(lastFakeContract._calls.purchaseStatic.length, 1);
    assert.deepEqual(lastFakeContract._calls.purchaseStatic[0], [
      CONNECTED,
      0n,
      0n,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      0,
      true,
      { value: 0n },
    ]);

    lastFakeContract = makeFakeContract({
      staticCallShouldRevert: { purchase: true },
      staticCallRevertName: { purchase: 'Insolvent' },
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);
    assert.equal(await lootboxMod.probeFoilPackAvailability({ buyer: CONNECTED }), true,
      'Insolvent proves the route passed every earlier foil gate');

    for (const name of ['FoilAlreadyBought', 'StaleAdvance', 'GameOverPossible', 'NotApproved']) {
      lastFakeContract = makeFakeContract({
        staticCallShouldRevert: { purchase: true },
        staticCallRevertName: { purchase: name },
      });
      lootboxMod.__setContractFactoryForTest(() => lastFakeContract);
      assert.equal(await lootboxMod.probeFoilPackAvailability({ buyer: CONNECTED }), false, name);
    }
  });

  test('foil availability detail separates ownership from temporary liveness failures', async () => {
    lastFakeContract = makeFakeContract({
      staticCallShouldRevert: { purchase: true },
      staticCallRevertName: { purchase: 'FoilAlreadyBought' },
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);
    assert.deepEqual(
      await lootboxMod.probeFoilPackAvailabilityState({ buyer: CONNECTED }),
      { available: false, definitive: true, code: 'FoilAlreadyBought' },
    );

    lastFakeContract = makeFakeContract({
      staticCallShouldRevert: { purchase: true },
      staticCallRevertName: { purchase: 'StaleAdvance' },
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);
    assert.deepEqual(
      await lootboxMod.probeFoilPackAvailabilityState({ buyer: CONNECTED }),
      { available: false, definitive: false, code: 'StaleAdvance' },
    );
  });

  test('purchaseEth sends ENTRY units (400 per ticket), payKind=0, ZeroHash affiliate', async () => {
    await lootboxMod.purchaseEth({ ticketQuantity: 5, lootboxQuantity: 1 });
    assert.equal(lastFakeContract._calls.purchase.length, 1, 'purchase called once');
    const [args] = lastFakeContract._calls.purchase;
    assert.equal(args[0], CONNECTED, 'buyer is connected.address');
    // DegenerusGame.sol:703 — "Purchase units (400 = 4*QTY_SCALE = one whole
    // ticket = 4 entries)". x100 bought a QUARTER of what the field said.
    assert.equal(args[1], 2000n, '5 tickets = 20 entries = 2000 purchase units');
    assert.ok(args[2] > 0n, 'lootBoxAmount > 0 (default LOOTBOX_MIN_WEI × N)');
    assert.equal(typeof args[3], 'string');
    assert.equal(args[3], '0x0000000000000000000000000000000000000000000000000000000000000000', 'ZeroHash affiliate default');
    assert.equal(args[4], 0, 'payKind = MintPaymentKind.DirectEth (0)');
    // Redeploy #7: trailing bool foil (always false until foil UI ships).
    assert.equal(args[5], false, 'foil = false');
    // Last arg is the overrides object with msg.value.
    assert.ok(typeof args[6] === 'object' && args[6] !== null, 'overrides object passed');
    assert.ok(args[6].value > 0n, 'value > 0 sent as msg.value');
  });

  test('fractional tickets resolve to whole entries (0.25 ticket = 1 entry = 100 units)', async () => {
    for (const [tickets, units] of [[0.25, 100n], [0.5, 200n], [1, 400n], [1.5, 600n], [2.75, 1100n]]) {
      assert.equal(lootboxMod.entriesScaledFromTickets(tickets), units, `${tickets} tickets`);
    }
    // Finer than an entry snaps to the nearest one — the chain has no unit below it.
    assert.equal(lootboxMod.entriesScaledFromTickets(0.3), 100n);
    assert.equal(lootboxMod.entriesScaledFromTickets(0), 0n);
    assert.equal(lootboxMod.entriesScaledFromTickets(-2), 0n);
  });

  test('ticket cost matches the contract formula, not price-per-field-value', async () => {
    // _purchaseCostInputs: ticketCost = priceWei * entryQuantityScaled / (4 * QTY_SCALE).
    const price = 1_000_000_000_000_000n;
    assert.equal(lootboxMod.ticketCostFromTickets(price, 1), price, 'one ticket = one ticket price');
    assert.equal(lootboxMod.ticketCostFromTickets(price, 0.25), price / 4n, 'one entry = a quarter');
    assert.equal(lootboxMod.ticketCostFromTickets(price, 5), price * 5n);
  });

  test('purchaseInfo supplies the exact routed price across a level-tier boundary', async () => {
    const routedPrice = lootboxMod.scaledTicketPriceWei(30);
    lastFakeContract = makeFakeContract({
      purchaseInfo: [29, true, false, true, routedPrice],
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    assert.deepEqual(await lootboxMod.readPurchaseQuote(), {
      currentLevel: 29,
      inJackpotPhase: true,
      lastPurchaseDay: false,
      rngLocked: true,
      priceWei: routedPrice,
    });

    const staleFoilCost = lootboxMod.scaledFoilPackCostWei(29);
    await lootboxMod.purchaseEth({
      ticketQuantity: 0,
      lootboxQuantity: 0,
      foil: true,
      foilCostWei: staleFoilCost,
    });
    const [args] = lastFakeContract._calls.purchase;
    assert.equal(args[6].value, lootboxMod.foilPackCostFromPriceWei(routedPrice),
      'the write ignores the half-price Level 29 quote and funds routed Level 30');
    assert.equal(args[6].value, staleFoilCost * 2n,
      'this exact boundary reproduces the reported 2x tier jump');
  });

  test('claimable-first split preserves the 1-wei sentinel', () => {
    assert.deepEqual(
      lootboxMod.claimableFirstPayment(1_000n, 1_001n),
      { payKind: 1, msgValueWei: 0n, claimableUsedWei: 1_000n, totalCostWei: 1_000n },
    );
    assert.deepEqual(
      lootboxMod.claimableFirstPayment(1_000n, 401n),
      { payKind: 2, msgValueWei: 600n, claimableUsedWei: 400n, totalCostWei: 1_000n },
    );
    assert.equal(lootboxMod.claimableFirstPayment(1_000n, 1n).payKind, 0,
      'sentinel alone is not spendable');
  });

  test('selected claimable and AFKing funding reduce only the fresh-wallet remainder', () => {
    assert.deepEqual(
      lootboxMod.purchaseFundingPayment(1_000n, 301n, 450n, {
        useClaimable: true,
        useAfking: true,
      }),
      {
        payKind: lootboxMod.MINT_PAYMENT_KIND_COMBINED,
        msgValueWei: 250n,
        claimableUsedWei: 300n,
        afkingUsedWei: 450n,
        totalCostWei: 1_000n,
      },
    );
    assert.equal(
      lootboxMod.purchaseFundingPayment(1_000n, 1_001n, 900n, {
        useClaimable: true,
        useAfking: true,
      }).afkingUsedWei,
      0n,
      'AFKing funding stays untouched when claimable already covers the purchase',
    );
  });

  test('purchaseEth reads and uses AFKing funding only when the player selected it', async () => {
    const total = lootboxMod.LOOTBOX_MIN_WEI + 9_000n;
    const funding = 4_000n;
    lastFakeContract = makeFakeContract({ afkingRaw: funding });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    const result = await lootboxMod.purchaseEth({
      ticketQuantity: 1,
      lootboxQuantity: 1,
      ticketCostWei: 9_000n,
      preferClaimable: false,
      useAfking: true,
    });
    const [args] = lastFakeContract._calls.purchase;
    assert.deepEqual(lastFakeContract._calls.afkingFundingOf, [CONNECTED]);
    assert.equal(args[4], lootboxMod.MINT_PAYMENT_KIND_DIRECT_ETH,
      'DirectEth keeps claimable disabled while the contract consumes AFKing credit');
    assert.equal(args[6].value, total - funding);
    assert.equal(result.payment.afkingUsedWei, funding);
  });

  // Audit c19a1088 funds the foil leg through the canonical spend waterfall, so AFKing
  // principal IS drawable for foil now. Before it, the module reverted rather than tap
  // AFKing, and these two tests asserted the carve-out that kept it out of the quote.
  test('foil purchases draw AFKing principal, so the wallet covers only the remainder', async () => {
    const foilCostWei = 1_000n;
    lastFakeContract = makeFakeContract({ afkingRaw: 900n });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    const result = await lootboxMod.purchaseEth({
      ticketQuantity: 0,
      lootboxQuantity: 0,
      foil: true,
      foilCostWei,
      preferClaimable: true,
      useAfking: true,
    });

    const [args] = lastFakeContract._calls.purchase;
    // DirectEth still blocks the CLAIMABLE tier, but the AFKing tier runs on every kind,
    // so 900 AFKing + 100 wallet covers the pack.
    assert.equal(args[4], lootboxMod.MINT_PAYMENT_KIND_DIRECT_ETH);
    assert.equal(args[6].value, 100n,
      'the wallet funds only what AFKing principal leaves uncovered');
    assert.equal(result.payment.afkingUsedWei, 900n);
  });

  test('foil purchases use claimable, then AFKing, before touching the wallet', async () => {
    const foilCostWei = 1_000n;
    lastFakeContract = makeFakeContract({ claimableRaw: 301n, afkingRaw: 900n });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    const result = await lootboxMod.purchaseEth({
      ticketQuantity: 0,
      lootboxQuantity: 0,
      foil: true,
      foilCostWei,
      preferClaimable: true,
      useAfking: true,
    });

    const [args] = lastFakeContract._calls.purchase;
    // 300 claimable (301 less the 1-wei sentinel) + 700 AFKing == the full cost.
    assert.equal(args[4], lootboxMod.MINT_PAYMENT_KIND_COMBINED);
    assert.equal(args[6].value, 0n, 'the two internal tiers cover the pack outright');
    assert.equal(result.payment.claimableUsedWei, 300n);
    assert.equal(result.payment.afkingUsedWei, 700n);
  });

  test('purchaseEth uses claimable only when it covers the full purchase', async () => {
    const total = lootboxMod.LOOTBOX_MIN_WEI + 7_000n;
    lastFakeContract = makeFakeContract({ claimableRaw: total + 1n });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    const result = await lootboxMod.purchaseEth({
      ticketQuantity: 1,
      lootboxQuantity: 1,
      ticketCostWei: 7_000n,
    });
    const [args] = lastFakeContract._calls.purchase;
    assert.equal(args[4], lootboxMod.MINT_PAYMENT_KIND_CLAIMABLE);
    assert.equal(args[6].value, 0n, 'wallet sends no ETH');
    assert.equal(result.payment.claimableUsedWei, total);
  });

  test('purchaseEth uses claimable first and sends only the wallet shortfall', async () => {
    const claimableSpend = 4_000n;
    const total = lootboxMod.LOOTBOX_MIN_WEI + 9_000n;
    lastFakeContract = makeFakeContract({ claimableRaw: claimableSpend + 1n });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    const result = await lootboxMod.purchaseEth({
      ticketQuantity: 1,
      lootboxQuantity: 1,
      ticketCostWei: 9_000n,
    });
    const [args] = lastFakeContract._calls.purchase;
    assert.equal(args[4], lootboxMod.MINT_PAYMENT_KIND_COMBINED);
    assert.equal(args[6].value, total - claimableSpend);
    assert.equal(result.payment.claimableUsedWei, claimableSpend);
  });

  test('purchaseEth honors wallet-first by leaving claimable untouched', async () => {
    const total = lootboxMod.LOOTBOX_MIN_WEI + 9_000n;
    lastFakeContract = makeFakeContract({ claimableRaw: total + 1n });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    const result = await lootboxMod.purchaseEth({
      ticketQuantity: 1,
      lootboxQuantity: 1,
      ticketCostWei: 9_000n,
      preferClaimable: false,
    });
    const [args] = lastFakeContract._calls.purchase;
    assert.equal(args[4], lootboxMod.MINT_PAYMENT_KIND_DIRECT_ETH);
    assert.equal(args[6].value, total, 'wallet sends the full purchase price');
    assert.equal(result.payment.claimableUsedWei, 0n, 'claimable is untouched');
  });

  test('purchaseEth lootBoxAmount = LOOTBOX_MIN_WEI × N when not provided', async () => {
    await lootboxMod.purchaseEth({ ticketQuantity: 0, lootboxQuantity: 3 });
    const [args] = lastFakeContract._calls.purchase;
    // LOOTBOX_MIN_WEI = 0.01 ether / ETH_DIVISOR (testnet-scaled); × 3.
    assert.equal(args[2], lootboxMod.LOOTBOX_MIN_WEI * 3n);
    assert.equal(args[6].value, lootboxMod.LOOTBOX_MIN_WEI * 3n);
  });

  test('purchaseEth adds ticketCostWei to msg.value (tickets + lootbox combined)', async () => {
    const ticketCostWei = lootboxMod.scaledTicketPriceWei(13) * 2n;
    await lootboxMod.purchaseEth({ ticketQuantity: 2, lootboxQuantity: 1, ticketCostWei });
    const [args] = lastFakeContract._calls.purchase;
    assert.equal(args[6].value, lootboxMod.LOOTBOX_MIN_WEI + ticketCostWei,
      'msg.value = lootbox leg + ticket leg');
  });

  test('purchaseEth attaches a presale box through the deployed combined selector', async () => {
    const ticketCostWei = 4n * lootboxMod.PRESALE_BOX_MIN_WEI;
    const presaleBoxAmountWei = lootboxMod.PRESALE_BOX_MIN_WEI;
    const out = await lootboxMod.purchaseEth({
      ticketQuantity: 1,
      lootboxQuantity: 0,
      lootBoxAmountWei: 0n,
      ticketCostWei,
      presaleBoxAmountWei,
    });

    assert.equal(lastFakeContract._calls.purchase.length, 0,
      'the ordinary purchase selector is not used');
    assert.deepEqual(lastFakeContract._calls.buyLootboxAndPresaleBox[0], [
      CONNECTED,
      400n,
      0n,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      0,
      presaleBoxAmountWei,
      { value: ticketCostWei + presaleBoxAmountWei },
    ]);
    assert.deepEqual(
      lastFakeContract._calls.buyLootboxAndPresaleBoxStatic[0],
      lastFakeContract._calls.buyLootboxAndPresaleBox[0],
      'the exact value-bearing combined call is simulated before send',
    );
    assert.equal(out.payment.totalCostWei, ticketCostWei + presaleBoxAmountWei);
  });

  test('standalone presale boxes read the live cap, simulate, send, and parse their index', async () => {
    const amount = lootboxMod.PRESALE_BOX_MIN_WEI;
    lastFakeContract = makeFakeContract({
      presaleCredit: 2n * amount,
      presaleRemaining: 3n * amount,
      presaleLogs: [{
        parsed: {
          name: 'PresaleBoxBuy',
          args: { buyer: CONNECTED, index: 7n, amount, closing: false },
        },
      }],
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    assert.deepEqual(await lootboxMod.readPresaleBoxState({ player: CONNECTED }), {
      active: true,
      creditWei: 2n * amount,
      remainingWei: 3n * amount,
      maxBoxWei: 2n * amount,
    });
    const out = await lootboxMod.purchasePresaleBox({ boxAmountWei: amount });
    assert.deepEqual(lastFakeContract._calls.buyPresaleBox[0], [
      CONNECTED, amount, { value: amount },
    ]);
    assert.deepEqual(
      lootboxMod.parsePresaleBoxBuyFromReceipt(out.receipt, out.contract),
      [{ buyer: CONNECTED, lootboxIndex: 7n, amountWei: amount, closing: false }],
    );
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

  test('purchaseCoin is NOT exported (removed on-chain in redeploy #7)', () => {
    assert.equal(lootboxMod.purchaseCoin, undefined,
      'FLIP-paid ticket purchases no longer exist — no purchaseCoin export');
  });

  test('scaledTicketPriceWei ports PriceLookupLib (scaled by ETH_DIVISOR)', () => {
    const ETHER = 10n ** 18n;
    const DIV = 1_000_000n; // active testnet chain-config ETH_DIVISOR
    assert.equal(lootboxMod.scaledTicketPriceWei(0), ETHER / 100n / DIV, 'level 0 = 0.01 ether');
    assert.equal(lootboxMod.scaledTicketPriceWei(7), 2n * ETHER / 100n / DIV, 'level 7 = 0.02 ether');
    assert.equal(lootboxMod.scaledTicketPriceWei(13), 4n * ETHER / 100n / DIV, 'level 13 = 0.04 ether (decade 1)');
    assert.equal(lootboxMod.scaledTicketPriceWei(45), 8n * ETHER / 100n / DIV, 'level 45 = 0.08 ether (decade tier 2x)');
    assert.equal(lootboxMod.scaledTicketPriceWei(65), 12n * ETHER / 100n / DIV, 'level 65 = 0.12 ether (3x)');
    assert.equal(lootboxMod.scaledTicketPriceWei(95), 16n * ETHER / 100n / DIV, 'level 95 = 0.16 ether (4x)');
    assert.equal(lootboxMod.scaledTicketPriceWei(100), 24n * ETHER / 100n / DIV, 'milestone 100 = 0.24 ether');
    assert.equal(lootboxMod.scaledTicketPriceWei(113), 4n * ETHER / 100n / DIV, 'cycle repeats (113 ≡ 13)');
  });

  test('openLootBox calls the on-chain openBox method (redeploy #7 rename)', async () => {
    await lootboxMod.openLootBox({ lootboxIndex: 7n });
    assert.equal(lastFakeContract._calls.openBox.length, 1);
    const [args] = lastFakeContract._calls.openBox;
    assert.equal(args[0], CONNECTED);
    assert.equal(args[1], 7n);
  });

  test('fresh lootbox status is checked for the exact owner and index', async () => {
    const other = '0xcd34000000000000000000000000000000000000';
    lastFakeContract = makeFakeContract({ lootboxStatus: [0n, true] });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    assert.deepEqual(
      await lootboxMod.readLootboxStatus({ player: other, lootboxIndex: 7 }),
      { amount: 0n, presale: true },
    );
    assert.deepEqual(lastFakeContract._calls.lootboxStatus, [[other, 7n]]);

    await lootboxMod.openLootBox({ player: other, lootboxIndex: 7 });
    assert.deepEqual(lastFakeContract._calls.openBox, [[other, 7n]],
      'permissionless open stays pinned to the tracked owner');
  });

  test('parseLootboxIdxFromReceipt extracts purchase indexes from LootBoxIdx logs', () => {
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
    assert.equal(idxs[1].lootboxIndex, 6n);
  });

  test('parseLootboxIdxFromReceipt keeps the ETH amount from current LootBoxBuy logs', () => {
    const amount = 125_000_000_000_000_000n;
    const fakeReceipt = {
      logs: [
        { parsed: { name: 'LootBoxBuy', args: { buyer: CONNECTED, index: 17n, amount } } },
      ],
    };
    assert.deepEqual(
      lootboxMod.parseLootboxIdxFromReceipt(fakeReceipt, lastFakeContract),
      [{ lootboxIndex: 17n, day: null, amountWei: amount }],
      'the pending chip can show its purchased ETH amount before the indexer catches up',
    );
  });

  test('purchase receipt distinguishes regular and presale legs sharing one index', async () => {
    const other = '0xcd34000000000000000000000000000000000000';
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getTransactionReceipt: async () => ({
        logs: [
          { parsed: { name: 'LootBoxBuy', args: { buyer: CONNECTED, index: 12n, amount: 3n } } },
          { parsed: { name: 'PresaleBoxBuy', args: { buyer: CONNECTED, index: 12n, amount: 4n } } },
          { parsed: { name: 'PresaleBoxBuy', args: { buyer: other, index: 12n, amount: 99n } } },
          { parsed: { name: 'PresaleBoxBuy', args: { buyer: CONNECTED, index: 13n, amount: 88n } } },
        ],
      }),
    });

    assert.deepEqual(await lootboxMod.readLootboxPurchaseReceipt({
      transactionHash: '0xpurchased',
      player: CONNECTED,
      lootboxIndex: 12n,
    }), {
      hasLootboxLeg: true,
      hasPresaleLeg: true,
      amountWei: 7n,
    });
  });

  test('parseLootboxIdxFromReceipt ignores FlipLootBuy logs (FLIP lootbox path removed)', () => {
    const fakeReceipt = {
      logs: [
        { parsed: { name: 'FlipLootBuy', args: { index: 9n, flipAmount: 1000n * 10n ** 18n, buyer: CONNECTED } } },
      ],
    };
    const idxs = lootboxMod.parseLootboxIdxFromReceipt(fakeReceipt, lastFakeContract);
    assert.equal(idxs.length, 0, 'FlipLootBuy is no longer parsed — lootboxes are ETH-only');
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

  test('canOpenLootbox probes the exact owner and index without sending', async () => {
    const owner = '0xcd34000000000000000000000000000000000000';
    const c = makeFakeContract();
    lootboxMod.__setContractFactoryForTest(() => c);
    assert.equal(await lootboxMod.canOpenLootbox({ player: owner, lootboxIndex: 7n }), true);
    assert.deepEqual(c._calls.openBoxStatic, [[owner, 7n]]);
    assert.deepEqual(c._calls.openBox, [], 'readiness probe never opens the box');
  });

  test('canOpenLootbox fails closed when the exact open simulation rejects', async () => {
    const c = makeFakeContract({ staticCallShouldRevert: { openBox: true } });
    lootboxMod.__setContractFactoryForTest(() => c);
    assert.equal(
      await lootboxMod.canOpenLootbox({ player: CONNECTED, lootboxIndex: 7n }),
      false,
    );
    assert.deepEqual(c._calls.openBoxStatic, [[CONNECTED, 7n]]);
  });

  test('canOpenLootbox returns false when no provider is configured', async () => {
    contractsMod.clearProvider();
    assert.equal(
      await lootboxMod.canOpenLootbox({ player: CONNECTED, lootboxIndex: 7n }),
      false,
    );
  });
});

// ===========================================================================
// Plan 60-04 — affiliate-code helpers + purchaseEth auto-read
// ===========================================================================

describe('Plan 60-04: affiliate-code helpers + purchaseEth auto-read', () => {
  let fakeContract;
  const VALID_BYTES32 = '0x' + 'ab'.repeat(32);  // 64 hex chars

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    fakeContract = makeFakeContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    // Reset / install localStorage shim
    if (globalThis.localStorage && typeof globalThis.localStorage.clear === 'function') {
      globalThis.localStorage.clear();
    } else {
      globalThis.localStorage = {
        _m: new Map(),
        getItem(k) { return this._m.get(k) ?? null; },
        setItem(k, v) { this._m.set(k, String(v)); },
        removeItem(k) { this._m.delete(k); },
        clear() { this._m.clear(); },
      };
    }
    // Reset location stub
    globalThis.location = { href: 'http://localhost/' };
  });

  afterEach(() => {
    lootboxMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('readAffiliateCode returns ZeroHash when localStorage empty', () => {
    const code = lootboxMod.readAffiliateCode(84532, CONNECTED);
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('purchaseEth auto-reads the site-wide affiliate-ref into args[3]', async () => {
    // /js/ref.js first-touch capture (any page) is the purchase default.
    globalThis.localStorage.setItem('affiliate-ref', VALID_BYTES32);
    await lootboxMod.purchaseEth({ ticketQuantity: 1, lootboxQuantity: 1 });
    const [args] = fakeContract._calls.purchase;
    assert.equal(args[3], VALID_BYTES32, 'purchase received site-captured referral');
  });

  test('purchaseEth uses ZeroHash when localStorage empty', async () => {
    await lootboxMod.purchaseEth({ ticketQuantity: 1, lootboxQuantity: 1 });
    const [args] = fakeContract._calls.purchase;
    assert.equal(args[3], '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('readAffiliateCode: localStorage.getItem throw does NOT crash (Pitfall F)', () => {
    const orig = globalThis.localStorage.getItem.bind(globalThis.localStorage);
    globalThis.localStorage.getItem = () => { throw new Error('SecurityError'); };
    let code;
    assert.doesNotThrow(() => { code = lootboxMod.readAffiliateCode(84532, CONNECTED); });
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000', 'falls back to ZeroHash');
    globalThis.localStorage.getItem = orig;
  });

  // --- site-wide first-touch referral (/js/ref.js capture) is the source ----

  test('readAffiliateCode reads the site-wide affiliate-ref localStorage key', () => {
    globalThis.localStorage.setItem('affiliate-ref', VALID_BYTES32);
    const code = lootboxMod.readAffiliateCode(84532, CONNECTED);
    assert.equal(code, VALID_BYTES32);
  });

  test('own-code key (affiliate-code:{chain}:{addr}) never rides a purchase', () => {
    // That key holds the player's OWN registered code (affiliate.js) — using
    // it as the purchase code would be a self-referral.
    const ownCode = '0x' + 'cd'.repeat(32);
    globalThis.localStorage.setItem(`affiliate-code:84532:${CONNECTED.toLowerCase()}`, ownCode);
    const code = lootboxMod.readAffiliateCode(84532, CONNECTED);
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('site ref that matches the own registered code is skipped (clicked own share link)', () => {
    const ownCode = '0x' + 'cd'.repeat(32);
    globalThis.localStorage.setItem(`affiliate-code:84532:${CONNECTED.toLowerCase()}`, ownCode);
    globalThis.localStorage.setItem('affiliate-ref', ownCode);
    const code = lootboxMod.readAffiliateCode(84532, CONNECTED);
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('site-wide ref that is the connected address\'s own default code is skipped (self-referral)', () => {
    const selfCode = '0x' + '0'.repeat(24) + CONNECTED.toLowerCase().slice(2);
    globalThis.localStorage.setItem('affiliate-ref', selfCode);
    const code = lootboxMod.readAffiliateCode(84532, CONNECTED);
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('readAffiliateCode falls back to dgn_ref cookie when localStorage has no ref', () => {
    const hadDocument = 'document' in globalThis;
    const origDocument = globalThis.document;
    globalThis.document = { cookie: `dgn_ref=${VALID_BYTES32}` };
    try {
      const code = lootboxMod.readAffiliateCode(84532, CONNECTED);
      assert.equal(code, VALID_BYTES32);
    } finally {
      if (hadDocument) globalThis.document = origDocument;
      else delete globalThis.document;
    }
  });

  test('malformed site-wide affiliate-ref is ignored', () => {
    globalThis.localStorage.setItem('affiliate-ref', '0xdeadbeef');
    const code = lootboxMod.readAffiliateCode(84532, CONNECTED);
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000');
  });
});

// ===========================================================================
// Plan 63-02 (D-02 LOCKED) — prewarmLootboxBuy() iOS Safari user-gesture refactor.
//
// Tests verify: the helper returns {buildTx, abort, expiresAt}; buildTx is a
// SYNCHRONOUS arrow function that calls signer.sendTransaction without await;
// requireSelf() runs BEFORE provider.getSigner() (devtools-bypass defense
// preserved); requireStaticCall is lifted to pre-warm time (NOT inside buildTx);
// the v6 method-attached `purchase.populateTransaction(args)` form is used
// (NOT v5's `populateTransaction.purchase(args)`); abort() invalidates the
// closure synchronously; expiresAt is 30s in the future; estimateGas attaches
// gracefully or fails open; lootboxQuantity=0 produces value=0n. Lootboxes are
// ETH-only, so pre-warm always routes to purchase.populateTransaction.
// ===========================================================================

/**
 * Builds a fake contract that implements the v6 method-attached populateTransaction
 * form: contract.purchase.populateTransaction(args) returns a Promise<unsignedTx>.
 * Records calls for assertions.
 */
function makeFakePrewarmContract(opts = {}) {
  const calls = {
    purchasePopulate: [],
    purchaseCoinPopulate: [],
    purchaseStaticCall: [],
    purchaseCoinStaticCall: [],
  };
  const stk = (name) => async (..._args) => {
    if (opts.staticCallShouldRevert?.[name]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[name] || 'GameOverPossible' };
      throw err;
    }
    return undefined;
  };
  const buildPopulated = (kind, args, txOverrides) => ({
    to: '0xc0ffee0000000000000000000000000000000000',
    data: '0xdeadbeef',
    from: args[0],
    value: txOverrides?.value ?? 0n,
    _testKind: kind,
    _testArgs: args,
  });
  const c = {
    purchase: Object.assign(
      async (..._args) => { throw new Error('purchase() should not be sent in prewarm tests'); },
      {
        populateTransaction: async (...args) => {
          // Last arg may be the {value} overrides object.
          const last = args[args.length - 1];
          const isOverrides = last && typeof last === 'object' && !Array.isArray(last);
          const txOverrides = isOverrides ? last : undefined;
          const methodArgs = isOverrides ? args.slice(0, -1) : args;
          calls.purchasePopulate.push({ args: methodArgs, txOverrides });
          if (opts.populateThrows?.purchase) throw new Error('populateTransaction-rejected');
          return buildPopulated('purchase', methodArgs, txOverrides);
        },
        staticCall: async (...args) => { calls.purchaseStaticCall.push(args); return stk('purchase')(...args); },
      }
    ),
    purchaseCoin: Object.assign(
      async (..._args) => { throw new Error('purchaseCoin() should not be sent in prewarm tests'); },
      {
        populateTransaction: async (...args) => {
          calls.purchaseCoinPopulate.push({ args });
          if (opts.populateThrows?.purchaseCoin) throw new Error('populateTransaction-rejected');
          return buildPopulated('purchaseCoin', args, undefined);
        },
        staticCall: async (...args) => { calls.purchaseCoinStaticCall.push(args); return stk('purchaseCoin')(...args); },
      }
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
  };
  return c;
}

/** Fake signer that records sendTransaction + estimateGas calls. */
function makeFakePrewarmSigner(opts = {}) {
  const calls = { sendTransaction: [], estimateGas: [] };
  const signer = {
    getAddress: async () => CONNECTED,
    estimateGas: async (tx) => {
      calls.estimateGas.push(tx);
      if (opts.estimateGasShouldReject) throw new Error('estimateGas-rejected');
      return opts.estimatedGas ?? 21000n;
    },
    // sendTransaction must be a function spy; track INVOCATION TIME so tests
    // can assert it was called synchronously inside the buildTx() frame.
    sendTransaction: function (tx) {
      calls.sendTransaction.push({ tx, invokedAt: Date.now(), microtaskMarker: null });
      return Promise.resolve({
        hash: '0xtx-hash-from-prewarm',
        wait: async () => ({ status: 1, hash: '0xtx-hash-from-prewarm', logs: [] }),
      });
    },
    _calls: calls,
  };
  return signer;
}

function makeFakePrewarmProvider(signer) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => signer,
    _signer: signer,
  };
}

describe('Plan 63-02 (D-02 LOCKED): prewarmLootboxBuy() iOS Safari user-gesture refactor', () => {
  let fakeContract;
  let fakeSigner;
  let fakeProvider;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    fakeSigner = makeFakePrewarmSigner();
    fakeProvider = makeFakePrewarmProvider(fakeSigner);
    contractsMod.setProvider(fakeProvider);
    fakeContract = makeFakePrewarmContract();
    lootboxMod.__setContractFactoryForTest((_signerOrProvider) => fakeContract);
  });

  afterEach(() => {
    lootboxMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('returns {buildTx, abort, expiresAt} shape with default ETH purchase', async () => {
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 1, lootboxQuantity: 1,
    });
    assert.equal(typeof result.buildTx, 'function', 'buildTx is a function');
    assert.equal(typeof result.abort, 'function', 'abort is a function');
    assert.equal(typeof result.expiresAt, 'number', 'expiresAt is a number');
  });

  test('expiresAt is in the future and within 30s TTL', async () => {
    const before = Date.now();
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1,
    });
    const after = Date.now();
    assert.ok(result.expiresAt > before, 'expiresAt > before');
    // Allow a small wall-clock slack (after - before may be a few ms).
    assert.ok(result.expiresAt - before <= 30_000 + 50, 'expiresAt within 30s + slack of pre-warm start');
    assert.ok(result.expiresAt - after <= 30_000, 'expiresAt within 30s of pre-warm end');
  });

  test('uses ethers v6 method-attached populateTransaction form for ETH', async () => {
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 5, lootboxQuantity: 1,
    });
    assert.equal(fakeContract._calls.purchasePopulate.length, 1, 'purchase.populateTransaction called once');
    const { args, txOverrides } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[0], CONNECTED, 'buyer is connected.address (lowercase)');
    assert.equal(args[1], 2000n, '5 tickets = 2000 purchase units (400 per ticket)');
    assert.ok(args[2] > 0n, 'lootBoxAmount > 0 (default LOOTBOX_MIN_WEI × 1)');
    assert.equal(args[4], 0, 'payKind = MintPaymentKind.DirectEth (0)');
    assert.ok(txOverrides && txOverrides.value > 0n, '{value: lootBoxAmountWei} override');
  });

  test('buildTx calls signer.sendTransaction synchronously (no await) inside the click frame', async () => {
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1,
    });
    // SYNCHRONOUS-CLICK INVARIANT: simulate the click handler. We capture
    // a marker BEFORE calling buildTx, then check that sendTransaction was
    // invoked WITHOUT any microtask boundary in between.
    let microtaskRanFirst = false;
    Promise.resolve().then(() => { microtaskRanFirst = true; });
    const promise = result.buildTx();
    // At this exact point, sendTransaction MUST have been called. Microtasks
    // (including the .then() above) have NOT yet run since we have not
    // awaited anything. If buildTx had an internal `await`, microtasks would
    // have a chance to run inside the buildTx body.
    assert.equal(fakeSigner._calls.sendTransaction.length, 1,
      'sendTransaction called synchronously in same frame as buildTx invocation');
    assert.equal(microtaskRanFirst, false,
      'NO microtask boundary between buildTx invocation and sendTransaction call (Pitfall 12 invariant)');
    // The returned promise resolves to the tx response.
    const tx = await promise;
    assert.equal(tx.hash, '0xtx-hash-from-prewarm');
  });

  test('requireSelf() called BEFORE provider.getSigner() — rejects with thrown error', async () => {
    // Force requireSelf() to throw by setting ui.mode='view' (read-only).
    storeMod.update('ui.mode', 'view');
    let getSignerCalled = false;
    fakeProvider.getSigner = async () => { getSignerCalled = true; return fakeSigner; };
    let caught = null;
    try {
      await lootboxMod.prewarmLootboxBuy({
        ticketQuantity: 1, lootboxQuantity: 1,
      });
    } catch (e) { caught = e; }
    assert.ok(caught, 'prewarm rejected');
    assert.match(caught.message, /Read-only|cannot sign/i,
      'rejection comes from requireSelf (devtools-bypass defense)');
    assert.equal(getSignerCalled, false,
      'getSigner NEVER called when requireSelf throws — order invariant');
  });

  test('requireStaticCall is lifted to pre-warm time; revert prevents buildTx invocation', async () => {
    const reverting = makeFakePrewarmContract({
      staticCallShouldRevert: { purchase: true },
      staticCallRevertName: { purchase: 'GameOverPossible' },
    });
    lootboxMod.__setContractFactoryForTest(() => reverting);
    let caught = null;
    try {
      await lootboxMod.prewarmLootboxBuy({
        ticketQuantity: 1, lootboxQuantity: 1,
      });
    } catch (e) { caught = e; }
    assert.ok(caught, 'prewarm rejected on static-call revert');
    assert.equal(caught.code, 'GameOverPossible', 'structured error carries decoded code');
    assert.ok(caught.userMessage && caught.userMessage.length > 0, 'userMessage present');
    // sendTransaction never invoked because buildTx was never returned.
    assert.equal(fakeSigner._calls.sendTransaction.length, 0,
      'sendTransaction NEVER called when static-call gate trips at pre-warm time');
    // populateTransaction WAS called (lifted before static-call); static-call
    // also was attempted exactly once.
    assert.equal(reverting._calls.purchasePopulate.length, 1, 'populateTransaction called');
    assert.equal(reverting._calls.purchaseStaticCall.length, 1, 'static-call attempted once');
  });

  test('abort() makes subsequent buildTx() throw synchronously without sending', async () => {
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1,
    });
    result.abort();
    assert.throws(() => result.buildTx(), /Pre-warm stale/, 'aborted buildTx throws synchronously');
    assert.equal(fakeSigner._calls.sendTransaction.length, 0,
      'sendTransaction NOT called after abort');
  });

  test('estimateGas success: gasLimit attached to populated tx', async () => {
    fakeSigner.estimateGas = async (_tx) => 42_000n;
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1,
    });
    result.buildTx();
    const sentTx = fakeSigner._calls.sendTransaction[0].tx;
    assert.equal(sentTx.gasLimit, 50_400n, 'gasLimit carries the shared 20% estimate cushion');
  });

  test('estimateGas rejection: pre-warm still resolves; gasLimit undefined (graceful fallback)', async () => {
    fakeSigner = makeFakePrewarmSigner({ estimateGasShouldReject: true });
    fakeProvider = makeFakePrewarmProvider(fakeSigner);
    contractsMod.setProvider(fakeProvider);
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1,
    });
    assert.equal(typeof result.buildTx, 'function', 'pre-warm resolves despite estimateGas rejection');
    result.buildTx();
    const sentTx = fakeSigner._calls.sendTransaction[0].tx;
    assert.equal(sentTx.gasLimit, undefined,
      'gasLimit undefined → signer.sendTransaction will re-estimate internally');
  });

  test('lootboxQuantity=0 + ticketQuantity=1: lootBoxAmountWei=0n is acceptable {value:0n}', async () => {
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 1, lootboxQuantity: 0,
    });
    const { args, txOverrides } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[2], 0n, 'lootBoxAmount = LOOTBOX_MIN_WEI * 0 = 0n');
    assert.equal(txOverrides.value, 0n, 'value override = 0n (tickets-only purchase)');
  });

  test('pre-warm always routes to purchase.populateTransaction (lootboxes are ETH-only)', async () => {
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 2, lootboxQuantity: 3,
    });
    assert.equal(fakeContract._calls.purchasePopulate.length, 1,
      'purchase.populateTransaction called once (ETH path)');
    assert.equal(fakeContract._calls.purchaseCoinPopulate.length, 0,
      'purchaseCoin.populateTransaction NEVER called — no FLIP lootbox path');
    assert.equal(fakeContract._calls.purchaseCoinStaticCall.length, 0,
      'purchaseCoin static-call NEVER runs at pre-warm time');
  });

  test('uses readAffiliateCode default (ZeroHash when localStorage empty) when args.affiliateCode omitted', async () => {
    // Reset/install localStorage shim (some prior tests may have polluted it).
    if (globalThis.localStorage && typeof globalThis.localStorage.clear === 'function') {
      globalThis.localStorage.clear();
    } else {
      globalThis.localStorage = {
        _m: new Map(),
        getItem(k) { return this._m.get(k) ?? null; },
        setItem(k, v) { this._m.set(k, String(v)); },
        removeItem(k) { this._m.delete(k); },
        clear() { this._m.clear(); },
      };
    }
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1,
    });
    const { args } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[3], '0x0000000000000000000000000000000000000000000000000000000000000000',
      'ZeroHash affiliate default');
  });

  test('explicit args.affiliateCode overrides readAffiliateCode default', async () => {
    const explicit = '0x' + 'aa'.repeat(32);
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1, affiliateCode: explicit,
    });
    const { args } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[3], explicit, 'explicit affiliateCode used verbatim');
  });

  // Account-switcher fix (2026-07-16): buyer must be getActingAddress(), not
  // unconditionally signer.getAddress(). In 'self' mode the two coincide
  // (covered above — "buyer is connected.address"); this test exercises
  // 'operator' mode, where the signer (fakeSigner.getAddress() → CONNECTED)
  // is the approved operator, but the on-chain buyer/player arg must be the
  // OWNER being acted for (viewing.address). Prior to the fix, prewarm bought
  // lootboxes for the operator's own address instead.
  test('operator mode: buyer arg is the viewed OWNER (getActingAddress), NOT the signer/connected operator', async () => {
    const OWNER = '0xcccc000000000000000000000000000000000003';
    storeMod.update('connected.address', CONNECTED);
    // approvals.list must list OWNER — store.js's deriveMode microtask (queued
    // by the viewing.address write below) recomputes ui.mode against this list
    // when it fires during prewarmLootboxBuy's internal `await`s; without it,
    // the pending derive would flip mode back to 'view' mid-flight.
    storeMod.update('approvals.list', [OWNER]);
    storeMod.update('viewing.address', OWNER);
    storeMod.update('ui.mode', 'operator');

    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 1, lootboxQuantity: 1,
    });

    assert.equal(fakeContract._calls.purchasePopulate.length, 1, 'purchase.populateTransaction called once');
    const { args, txOverrides } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[0], OWNER, 'buyer arg is the acted-for OWNER, not the connected operator');
    assert.notEqual(args[0], CONNECTED, 'buyer is NOT the signer/connected address in operator mode');
    assert.ok(txOverrides && txOverrides.value > 0n, 'msg.value still computed correctly');
  });
});
