import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN_HEX } from './helpers/active-chain.js';
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
import * as readProviderMod from '../read-provider.js';
import { decodeRevertReason } from '../reason-map.js';
import { CONTRACTS, ETH_DIVISOR } from '../chain-config.js';
import { miningGasBounds } from '../mining-gas-profile.js';
import { loadSchema } from '../../chain/schema.js';
import { _setWalletIdForTests, _resetWalletIdsForTests } from '../wallet-id.js';

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
    purchaseEstimate: [],
    buyDegenesisBox: [],
    buyDegenesisBoxStatic: [],
    mineFlip: [],
    mineFlipStatic: [],
    boxIndexComplete: [],
    claimableWinningsOf: [], afkingFundingOf: [],
    purchaseInfo: [],
  };
  const staticCallStub = (methodName) => async (...args) => {
    if (methodName === 'purchase') calls.purchaseStatic.push(args);
    if (methodName === 'buyDegenesisBox') calls.buyDegenesisBoxStatic.push(args);
    if (methodName === 'mineFlip') calls.mineFlipStatic.push(args);
    if (opts.staticCallError?.[methodName]) throw opts.staticCallError[methodName];
    if (opts.staticCallShouldRevert?.[methodName]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[methodName] || 'RngNotReady' };
      throw err;
    }
    return undefined;
  };
  const purchase = Object.assign(
    async (...args) => {
      calls.purchase.push(args);
      if (opts.purchaseShouldReject) throw opts.purchaseShouldReject;
      return makeFakeTx(makeFakeReceipt(opts.purchaseLogs));
    },
    { staticCall: staticCallStub('purchase') },
  );
  if (opts.purchaseGasEstimate != null) {
    purchase.estimateGas = async (...args) => {
      calls.purchaseEstimate.push(args);
      if (opts.purchaseEstimateShouldRevert) throw opts.purchaseEstimateShouldRevert;
      return BigInt(opts.purchaseGasEstimate);
    };
  }
  const c = {
    purchase,
    buyDegenesisBox: Object.assign(
      async (...args) => {
        calls.buyDegenesisBox.push(args);
        if (opts.degenesisShouldReject) throw opts.degenesisShouldReject;
        return makeFakeTx(makeFakeReceipt(opts.degenesisLogs));
      },
      { staticCall: staticCallStub('buyDegenesisBox') }
    ),
    degenesisCreditOf: async () => opts.degenesisCredit ?? (2n * lootboxMod.DEGENESIS_MIN_WEI),
    // Audit 2525eb7fd removed the per-box openBox door and audit 18490c6fe the openBoxes(maxCount)
    // valve: mineFlip() is the only door, and its stages open boxes in order.
    mineFlip: Object.assign(
      async (...args) => {
        calls.mineFlip.push(args);
        return makeFakeTx(makeFakeReceipt(opts.openLogs));
      },
      { staticCall: staticCallStub('mineFlip') }
    ),
    boxIndexComplete: async (...args) => {
      calls.boxIndexComplete.push(args);
      if (opts.boxIndexCompleteShouldRevert) throw new Error('completion read failed');
      return opts.boxIndexComplete ?? false;
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

function makeFakeProvider(connectedAddr, opts = {}) {
  let signerReads = 0;
  const provider = {
    // Sepolia chainId per chain-config.sepolia.js (CHAIN.id === 84532).
    getNetwork: async () => ({ chainId: BigInt(ACTIVE_CHAIN_ID) }),
    getSigner: async () => {
      signerReads += 1;
      return { getAddress: async () => connectedAddr };
    },
    getSignerReadCount: () => signerReads,
  };
  if (opts.balanceWei != null) {
    provider.getBalance = async () => BigInt(opts.balanceWei);
  }
  if (opts.maxFeePerGas != null) {
    provider.getFeeData = async () => ({ maxFeePerGas: BigInt(opts.maxFeePerGas) });
  }
  return provider;
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

  test('concurrent foil purchases share a wallet guard through confirmation and release after failure', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    lastFakeContract.purchase.staticCall = async () => { await gate; };
    const args = { foil: true, foilCostWei: 400_000_000_000n, preferClaimable: false };
    const first = lootboxMod.purchaseEth(args);
    await assert.rejects(lootboxMod.purchaseEth(args), /foil pack purchase is already pending/);
    release();
    await first;
    assert.equal(lastFakeContract._calls.purchase.length, 1);
    lastFakeContract.purchase.staticCall = async () => { throw Object.assign(new Error('rejected'), { revert: { name: 'FoilAlreadyBought' } }); };
    await assert.rejects(lootboxMod.purchaseEth(args), /already bought/);
    lastFakeContract.purchase.staticCall = async () => {};
    await lootboxMod.purchaseEth(args);
    assert.equal(lastFakeContract._calls.purchase.length, 2, 'a rejected preflight releases the guard');
  });

  test('__setContractFactoryForTest seam works (sanity)', () => {
    const res = lootboxMod.parseLootboxIdxFromReceipt({ logs: [] }, lastFakeContract);
    assert.deepEqual(res, []);
  });

  test('concurrent RNG-readiness polls share one public static call without a signer', async () => {
    const walletProvider = contractsMod.getProvider();
    let staticCalls = 0;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const froms = [];
    lootboxMod.__setContractFactoryForTest(() => ({
      // Audit 18490c6fe: only mineFlip requests the mid-day RNG; the probe simulates it as the
      // connected account, whose donated LINK credit can pay a below-threshold request.
      mineFlip: {
        staticCall: async (...args) => {
          staticCalls += 1;
          froms.push(args.at(-1)?.from);
          await held;
        },
      },
    }));

    const panelProbe = lootboxMod.canRequestLootboxRng();
    const trayProbe = lootboxMod.canRequestLootboxRng();
    await Promise.resolve();
    await Promise.resolve();
    const signerReads = walletProvider.getSignerReadCount();
    const callsBeforeRelease = staticCalls;
    release();
    assert.deepEqual(await Promise.all([panelProbe, trayProbe]), [true, true]);
    assert.deepEqual(
      { signerReads, callsBeforeRelease },
      { signerReads: 0, callsBeforeRelease: 1 },
      'background consumers avoid MetaMask and share one in-flight eth_call',
    );
    assert.deepEqual(froms, [CONNECTED], 'mineFlip is simulated as the connected account');
  });

  test('decodes the authoritative mid-day RNG queue fill and request latch', async () => {
    // lootboxRngPacked: pending ETH [48:87] and threshold [88:119] in 0.001 ETH, pending FLIP
    // [184:223]; slot 0: rngRequestTime [48:95], the read buffer at bit 252, the mid-day
    // request latch at bit 254.
    const queuePacked = (425n << 48n)
      | (1_000n << 88n)
      | (30_000n << 184n);
    const requestTime = 1_720_000_000n;
    const timingPacked = (requestTime << 48n) | (1n << 252n) | (1n << 254n);
    assert.deepEqual(
      lootboxMod.decodeLootboxRngQueueState(queuePacked, timingPacked, 900),
      {
        index: 1n,
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
    const { fields } = await loadSchema('GAME');
    const queueSlot = '0x' + BigInt(fields.lootboxRngPacked.slot).toString(16);
    const provider = {
      getBlockNumber: async () => 901,
      getStorage: async (_address, slot, blockTag) => {
        reads.push([slot, blockTag]);
        return slot === queueSlot ? queuePacked : timingPacked | (1n << 152n);
      },
    };
    const locked = await lootboxMod.readLootboxRngQueueState({ provider });
    assert.equal(locked.rngLocked, true);
    assert.equal(locked.middayRequestInFlight, false,
      'a daily RNG lock is not mislabeled as the mid-day request');
    assert.deepEqual(reads, [[queueSlot, 901], ['0x0', 901]], 'both slots share one block tag, at the generated layout');
  });

  test('reads the active player century-bonus usage from its wallet-ID mapping', async () => {
    _setWalletIdForTests(CONNECTED, 37);
    const reads = [];
    const provider = {
      getBlockNumber: async () => 902,
      getStorage: async (address, slot, blockTag) => {
        reads.push([address, slot, blockTag]);
        return (100n << 224n) | 1_234n;
      },
    };
    assert.equal(
      await lootboxMod.readCenturyBonusUsed({
        player: CONNECTED,
        targetLevel: 100,
        provider,
      }),
      1_234n,
    );
    assert.equal(
      await lootboxMod.readCenturyBonusUsed({
        player: CONNECTED,
        targetLevel: 200,
        provider,
      }),
      0n,
      'a usage word stamped for an older century is fresh allowance at the new one',
    );
    assert.equal(reads.length, 1, 'the immutable block-pinned storage word is reused');
    assert.equal(reads[0][0], CONTRACTS.GAME);
    assert.match(String(reads[0][1]), /^0x[0-9a-f]{64}$/i);
    assert.equal(reads[0][2], 902);
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
    const walletProvider = contractsMod.getProvider();
    assert.equal(await lootboxMod.probeFoilPackAvailability({ buyer: CONNECTED }), true,
      'a successful forward-compatible zero-price simulation is available');
    assert.equal(walletProvider.getSignerReadCount(), 0,
      'the background availability read never reaches MetaMask for a signer');
    assert.equal(lastFakeContract._calls.purchase.length, 0, 'the probe never sends');
    assert.equal(lastFakeContract._calls.purchaseStatic.length, 1);
    assert.deepEqual(lastFakeContract._calls.purchaseStatic[0], [
      0,
      0n,
      0n,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      0,
      true,
      { value: 0n, from: CONNECTED },
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

  test('foil availability preserves the connected operator as the public eth_call sender', async () => {
    const owner = '0xcd34000000000000000000000000000000000000';
    storeMod.update('viewing.address', owner);
    storeMod.update('ui.mode', 'operator');
    _setWalletIdForTests(owner, 73);

    assert.equal(await lootboxMod.probeFoilPackAvailability({ buyer: owner }), true);
    const args = lastFakeContract._calls.purchaseStatic[0];
    _resetWalletIdsForTests();
    assert.equal(args[0], 73, 'the viewed owner\'s account remains the purchase beneficiary');
    assert.deepEqual(args.at(-1), { value: 0n, from: CONNECTED },
      'the public simulation retains the connected operator as msg.sender');
    assert.equal(contractsMod.getProvider().getSignerReadCount(), 0,
      'operator availability also avoids the wallet provider');
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
    assert.equal(args[0], 0, 'buyer is the connected wallet (account 0)');
    // DegenerusGame.sol:703 — "Purchase units (400 = 4*QTY_SCALE = one whole
    // ticket = 4 entries)". x100 bought a QUARTER of what the field said.
    assert.equal(args[1], 2000n, '5 tickets = 20 entries = 2000 purchase units');
    assert.equal(args[2], lootboxMod.packBoxOrder({ kind: 'small', quantity: 1 }), 'one Small box is packed');
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

  // LOOTBOX-COMPACT-ORDER-CLIENT-HANDOFF §9: boxOrder = quantity | kind << 7 | customUnits << 9.
  test('compact box orders: all four kinds at quantities 1 and 100 encode and price exactly', () => {
    const unit = lootboxMod.BOX_VALUE_UNIT_WEI;
    // The value unit follows the active chain profile: 1e15 wei mainnet, 1e9 wei on the ÷1e6 testnet.
    assert.equal(unit, (10n ** 15n) / ETH_DIVISOR);
    const priceWei = 4n * lootboxMod.LOOTBOX_MIN_WEI;
    const customWei = 37n * unit;
    for (const quantity of [1, 100]) {
      for (const [kindIndex, kind] of ['small', 'medium', 'large', 'custom'].entries()) {
        const order = lootboxMod.packBoxOrder({ kind, quantity, customWei: kind === 'custom' ? customWei : 0n });
        const units = kind === 'custom' ? 37n : 0n;
        assert.equal(order, BigInt(quantity) | (BigInt(kindIndex) << 7n) | (units << 9n), `${kind} x${quantity}`);
        const decoded = lootboxMod.unpackBoxOrder(order);
        assert.equal(decoded.kind, kind);
        assert.equal(decoded.quantity, quantity);
        assert.equal(decoded.customUnits, units);
        assert.equal(lootboxMod.packBoxOrder({ kind: decoded.kind, quantity: decoded.quantity, customWei: decoded.customWei }), order);
        const perBox = kind === 'custom' ? customWei : priceWei * [1n, 5n, 25n][kindIndex];
        assert.equal(lootboxMod.boxOrderCostFromPriceWei(priceWei, order), BigInt(quantity) * perBox);
      }
    }
    assert.equal(lootboxMod.packBoxOrder({ kind: 'small', quantity: 0 }), 0n, 'quantity 0 is no box leg');
  });

  test('compact box orders: custom units 10 and 2,000,000 accepted; 0-9, 2,000,001, 2,097,151 rejected', () => {
    const unit = lootboxMod.BOX_VALUE_UNIT_WEI;
    assert.equal(lootboxMod.packBoxOrder({ kind: 'custom', quantity: 1, customWei: 10n * unit }) >> 9n, 10n);
    assert.equal(lootboxMod.packBoxOrder({ kind: 'custom', quantity: 1, customWei: 2_000_000n * unit }) >> 9n, 2_000_000n);
    assert.equal(lootboxMod.BOX_CUSTOM_MIN_WEI, 10n * unit);
    assert.equal(lootboxMod.BOX_CUSTOM_MAX_WEI, 2_000_000n * unit);
    for (const units of [0n, 1n, 9n, 2_000_001n, 2_097_151n]) {
      assert.throws(() => lootboxMod.packBoxOrder({ kind: 'custom', quantity: 1, customWei: units * unit }),
        /0\.01-2,000 ETH/, `${units} units`);
      // A raw word carrying the same units is rejected on decode too (the contract reverts E()).
      assert.throws(() => lootboxMod.unpackBoxOrder(1n | (3n << 7n) | (units << 9n)), /valid packed box order/);
    }
    // Never floors: a value off the 0.001 ETH grid is refused, not trimmed.
    assert.throws(() => lootboxMod.packBoxOrder({ kind: 'custom', quantity: 1, customWei: 10n * unit + 1n }), /whole 0\.001 ETH/);
  });

  test('compact box orders reject bad quantities, preset units and high bits', () => {
    for (const quantity of [0.5, -1, 101, 127, 1000]) {
      assert.throws(() => lootboxMod.packBoxOrder({ kind: 'small', quantity }), /1 to 100/, `quantity ${quantity}`);
    }
    assert.throws(() => lootboxMod.packBoxOrder({ kind: 'medium', quantity: 1, customWei: lootboxMod.BOX_CUSTOM_MIN_WEI }),
      /preset Luckbox carries no custom size/);
    assert.throws(() => lootboxMod.packBoxOrder({ kind: 'jumbo', quantity: 1 }), /Choose a Luckbox size/);
    assert.throws(() => lootboxMod.unpackBoxOrder(101n), /valid packed box order/, 'quantity 101 fits the field');
    assert.throws(() => lootboxMod.unpackBoxOrder(1n | (1n << 9n)), /valid packed box order/, 'preset with units');
    assert.throws(() => lootboxMod.unpackBoxOrder(1n | (1n << 30n)), /valid packed box order/, 'bit 30');
  });

  test('purchaseEth rejects non-canonical packed words before an RPC call', async () => {
    await assert.rejects(
      lootboxMod.purchaseEth({ ticketQuantity: 0, boxOrder: 1n << 120n }),
      /valid packed box order/,
    );
    assert.equal(lastFakeContract._calls.purchaseStatic.length, 0);
    assert.equal(lastFakeContract._calls.purchase.length, 0);
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

  test('purchaseEth reuses the same fresh quote prepared by the click handler', async () => {
    const routedPrice = lootboxMod.scaledTicketPriceWei(30);
    lastFakeContract = makeFakeContract({
      purchaseInfo: [29, true, false, true, routedPrice],
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    const purchaseQuote = await lootboxMod.readPurchaseQuote({ fresh: true });
    await lootboxMod.purchaseEth({
      ticketQuantity: 1,
      purchaseQuote,
    });
    assert.equal(lastFakeContract._calls.purchaseInfo.length, 1,
      'the writer does not immediately repeat the click-time purchaseInfo read');
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

  test('AFKing-funded purchase with some wallet ETH but too little for gas stops before the popup', async () => {
    const total = lootboxMod.LOOTBOX_MIN_WEI;
    lastFakeContract = makeFakeContract({
      afkingRaw: total,
      purchaseGasEstimate: 50_000n,
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);
    contractsMod.setProvider(makeFakeProvider(CONNECTED, {
      balanceWei: 5_000n,
      maxFeePerGas: 1n,
    }));

    await assert.rejects(
      lootboxMod.purchaseEth({
        ticketQuantity: 0,
        lootboxQuantity: 1,
        preferClaimable: false,
        useAfking: true,
      }),
      (error) => {
        assert.equal(error.code, 'InsufficientWalletFunds');
        assert.match(error.userMessage, /AFKing funding.*network gas/i);
        assert.equal(error.balanceWei, 5_000n, 'the wallet was low, not literally empty');
        assert.ok(error.requiredWei > error.balanceWei);
        return true;
      },
    );
    assert.equal(lastFakeContract._calls.purchaseStatic.length, 1,
      'the contract purchase itself remains valid with AFKing funding');
    assert.equal(lastFakeContract._calls.purchaseEstimate.length, 1,
      'the exact purchase supplies the gas budget');
    assert.equal(lastFakeContract._calls.purchase.length, 0,
      'a doomed wallet confirmation is never opened');
  });

  test('AFKing-funded purchase pins the public gas estimate when the wallet has ample gas ETH', async () => {
    const total = lootboxMod.LOOTBOX_MIN_WEI;
    const estimate = 330_322n;
    lastFakeContract = makeFakeContract({
      afkingRaw: total,
      purchaseGasEstimate: estimate,
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);
    contractsMod.setProvider(makeFakeProvider(CONNECTED, {
      // Mirrors the reported wallet after applying the protocol's display scale.
      balanceWei: 619_093_901_293_475n,
      maxFeePerGas: 11_000_000n,
    }));

    const out = await lootboxMod.purchaseEth({
      ticketQuantity: 0,
      lootboxQuantity: 1,
      preferClaimable: false,
      useAfking: true,
    });

    const [sent] = lastFakeContract._calls.purchase;
    assert.equal(out.payment.afkingUsedWei, total);
    assert.equal(sent[6].value, 0n, 'AFKing covers the protocol value');
    assert.equal(sent[6].gasLimit, contractsMod.gasEstimateWithHeadroom(estimate),
      'the public estimate is pinned so the injected wallet does not repeat it');
    assert.equal(lastFakeContract._calls.purchaseEstimate.length, 1);
    assert.deepEqual(lastFakeContract._calls.purchaseEstimate[0].at(-1), {
      value: 0n,
      from: CONNECTED,
    }, 'the public estimate simulates the connected gas payer');
  });

  test('BrowserProvider purchase never asks the injected wallet to re-estimate an AFKing-funded buy', async () => {
    const walletRpcMethods = [];
    const injected = {
      async request({ method }) {
        walletRpcMethods.push(method);
        if (method === 'eth_chainId') return ACTIVE_CHAIN_HEX;
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [CONNECTED];
        if (method === 'eth_estimateGas') {
          throw Object.assign(new Error('gas required exceeds allowance (18422)'), {
            code: 'INSUFFICIENT_FUNDS',
          });
        }
        throw new Error(`Unexpected wallet RPC method: ${method}`);
      },
      on() {},
      removeListener() {},
    };
    const walletProvider = new contractsMod.ethers.BrowserProvider(injected, ACTIVE_CHAIN_ID);
    contractsMod.setProvider(walletProvider);

    const total = lootboxMod.LOOTBOX_MIN_WEI;
    const walletContract = makeFakeContract({
      afkingRaw: total,
      purchaseInfo: [11, true, false, false, total],
    });
    const publicContract = makeFakeContract({
      afkingRaw: total,
      purchaseGasEstimate: 330_322n,
    });
    const publicReader = {
      getBalance: async () => 619_093_901_293_475n,
      getFeeData: async () => ({ maxFeePerGas: 11_000_000n }),
    };
    readProviderMod._setSharedReadProviderForTests(publicReader);
    lootboxMod.__setContractFactoryForTest((runner) => (
      runner === publicReader ? publicContract : walletContract
    ));

    try {
      await lootboxMod.purchaseEth({
        ticketQuantity: 0,
        lootboxQuantity: 1,
        preferClaimable: false,
        useAfking: true,
      });
    } finally {
      readProviderMod._resetSharedReadProviderForTests();
    }

    assert.equal(publicContract._calls.purchaseEstimate.length, 1,
      'the public reader supplies the estimate');
    assert.equal(walletContract._calls.purchaseEstimate.length, 0,
      'the injected wallet contract is never used for estimation');
    assert.ok(walletContract._calls.purchase[0][6].gasLimit > 0n,
      'the wallet request already includes the public gas limit');
    assert.equal(walletRpcMethods.includes('eth_estimateGas'), false,
      'the injected wallet never receives eth_estimateGas');
  });

  test('an ample public gas budget does not get mislabeled when the wallet still rejects it', async () => {
    const walletError = Object.assign(new Error('insufficient funds for gas'), {
      code: 'INSUFFICIENT_FUNDS',
    });
    lastFakeContract = makeFakeContract({
      afkingRaw: lootboxMod.LOOTBOX_MIN_WEI,
      purchaseGasEstimate: 330_322n,
      purchaseShouldReject: walletError,
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);
    contractsMod.setProvider(makeFakeProvider(CONNECTED, {
      balanceWei: 619_093_901_293_475n,
      maxFeePerGas: 11_000_000n,
    }));

    await assert.rejects(
      lootboxMod.purchaseEth({
        ticketQuantity: 0,
        lootboxQuantity: 1,
        preferClaimable: false,
        useAfking: true,
      }),
      (error) => {
        assert.equal(error.code, 'WalletGasQuoteRejected');
        assert.match(error.userMessage, /valid gas quote/i);
        assert.equal(error.cause?.cause, walletError,
          'sendTx diagnostics remain reachable under the honest UI error');
        return true;
      },
    );
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

  test('purchaseEth packs legacy quantity as Small boxes and quotes each at the routed price', async () => {
    const result = await lootboxMod.purchaseEth({ ticketQuantity: 0, lootboxQuantity: 3 });
    const [args] = lastFakeContract._calls.purchase;
    assert.equal(args[2], lootboxMod.packBoxOrder({ kind: 'small', quantity: 3 }));
    const decoded = lootboxMod.unpackBoxOrder(args[2]);
    assert.equal(decoded.kind, 'small');
    assert.equal(decoded.quantity, 3);
    assert.equal(decoded.small, 3, 'presentation counts keep one nonzero lane');
    assert.equal(decoded.customCount, 0);
    assert.equal(result.boxCostWei, lootboxMod.LOOTBOX_MIN_WEI * 3n);
    assert.equal(args[6].value, lootboxMod.LOOTBOX_MIN_WEI * 3n);
  });

  test('purchaseEth adds ticketCostWei to msg.value (tickets + lootbox combined)', async () => {
    const ticketCostWei = lootboxMod.scaledTicketPriceWei(13) * 2n;
    await lootboxMod.purchaseEth({ ticketQuantity: 2, lootboxQuantity: 1, ticketCostWei });
    const [args] = lastFakeContract._calls.purchase;
    assert.equal(args[6].value, lootboxMod.LOOTBOX_MIN_WEI + ticketCostWei,
      'msg.value = lootbox leg + ticket leg');
  });

  test('purchaseEth refuses a Degenesis amount: there is no combined selector', async () => {
    await assert.rejects(
      lootboxMod.purchaseEth({ ticketQuantity: 1, degenesisAmountWei: lootboxMod.DEGENESIS_MIN_WEI }),
      /Degenesis box on its own/,
    );
    assert.equal(lastFakeContract._calls.purchase.length, 0);
  });

  test('Degenesis amount validation mirrors buyDegenesisBox (min, 0.0001 ETH units, credit, 2^38 bound)', () => {
    const min = lootboxMod.DEGENESIS_MIN_WEI;
    const unit = lootboxMod.DEGENESIS_UNIT_WEI;
    assert.equal(min, 10n ** 16n / ETH_DIVISOR);
    assert.equal(unit, 10n ** 14n / ETH_DIVISOR);
    assert.equal(lootboxMod.degenesisAmountError(min), null);
    assert.equal(lootboxMod.degenesisAmountError(min + unit, min + unit), null, 'exactly the credit');
    assert.match(lootboxMod.degenesisAmountError(min - unit), /Minimum/);
    assert.match(lootboxMod.degenesisAmountError(min + 1n), /0\.0001 ETH steps/);
    assert.match(lootboxMod.degenesisAmountError(min + unit, min), /credit is lower/);
    assert.equal(lootboxMod.degenesisAmountError(lootboxMod.DEGENESIS_MAX_WEI), null);
    assert.match(lootboxMod.degenesisAmountError(lootboxMod.DEGENESIS_MAX_WEI + unit), /larger than one order/);
  });

  test('a Degenesis box reads live credit, simulates, sends buyDegenesisBox(0, amount) and parses its order', async () => {
    const amount = lootboxMod.DEGENESIS_MIN_WEI + lootboxMod.DEGENESIS_UNIT_WEI;
    lastFakeContract = makeFakeContract({
      degenesisCredit: 2n * amount,
      degenesisLogs: [{ parsed: { name: 'DegenesisBuy',
        args: { buyer: 5n, degenesisDay: 3n, orderIndex: 11n, amount, secondsIntoDay: 42n } } }],
    });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);
    assert.equal(await lootboxMod.readDegenesisCredit({ player: CONNECTED }), 2n * amount);
    const out = await lootboxMod.purchaseDegenesisBox({ amountWei: amount, player: CONNECTED });
    assert.deepEqual(lastFakeContract._calls.buyDegenesisBox[0], [0, amount, { value: amount }],
      'the caller buys for itself (id 0) and pays the exact amount');
    assert.deepEqual(lastFakeContract._calls.buyDegenesisBoxStatic[0], lastFakeContract._calls.buyDegenesisBox[0]);
    assert.deepEqual(out.orders, [{ buyer: '5', degenesisDay: 3, orderIndex: 11, amountWei: amount, secondsIntoDay: 42 }]);
  });

  test('a Degenesis box can be paid entirely from AFKing funds', async () => {
    const amount = lootboxMod.DEGENESIS_MIN_WEI;
    const contract = makeFakeContract({ afkingRaw: amount * 2n });
    lootboxMod.__setContractFactoryForTest(() => contract);
    const { payment } = await lootboxMod.purchaseDegenesisBox({ amountWei: amount, player: CONNECTED, useAfking: true });
    assert.equal(payment.afkingUsedWei, amount);
    assert.deepEqual(contract._calls.buyDegenesisBoxStatic[0], [0, amount, { value: 0n }]);
  });

  test('a Degenesis box over credit or off the unit grid never reaches the wallet', async () => {
    const contract = makeFakeContract({ degenesisCredit: lootboxMod.DEGENESIS_MIN_WEI });
    lootboxMod.__setContractFactoryForTest(() => contract);
    await assert.rejects(lootboxMod.purchaseDegenesisBox({
      amountWei: lootboxMod.DEGENESIS_MIN_WEI + lootboxMod.DEGENESIS_UNIT_WEI, player: CONNECTED }), /credit is lower/);
    await assert.rejects(lootboxMod.purchaseDegenesisBox({
      amountWei: lootboxMod.DEGENESIS_MIN_WEI + 1n, player: CONNECTED }), /0\.0001 ETH steps/);
    assert.equal(contract._calls.buyDegenesisBoxStatic.length, 0);
    assert.equal(contract._calls.buyDegenesisBox.length, 0);
  });

  test('a closed Degenesis sale replaces compact E() with an actionable message', async () => {
    const contract = makeFakeContract({
      staticCallShouldRevert: { buyDegenesisBox: true },
      staticCallRevertName: { buyDegenesisBox: 'E' },
    });
    lootboxMod.__setContractFactoryForTest(() => contract);
    await assert.rejects(lootboxMod.purchaseDegenesisBox({ amountWei: lootboxMod.DEGENESIS_MIN_WEI, player: CONNECTED }),
      (error) => { assert.equal(error.code, 'DegenesisUnavailable'); return true; });
    assert.equal(contract._calls.buyDegenesisBox.length, 0);
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

  test('openLootBox sends mineFlip, the only door, and reports whether it reached the box', async () => {
    // Audit 2525eb7fd removed openBox(player, index); audit 18490c6fe removed openBoxes(maxCount).
    const reads = [];
    lootboxMod.__setBoxStateReaderForTest((args) => {
      reads.push([args.player, BigInt(args.lootboxIndex)]);
      return { pending: false, worded: true, swept: false, rngLocked: false };
    });
    const opened = await lootboxMod.openLootBox({ lootboxIndex: 7n });
    assert.deepEqual(lastFakeContract._calls.mineFlip, [[0, { gasLimit: miningGasBounds().min }]],
      'mineFlip(0); no estimate on the fake, so the miner gas floor');
    assert.deepEqual(lastFakeContract._calls.mineFlipStatic, [[0]], 'the crank is simulated before the wallet opens');
    assert.ok(!('openBoxes' in lastFakeContract) && !('OPEN_BOXES_BATCH' in lootboxMod), 'the removed valve is gone');
    assert.equal(opened.opened, true);
    assert.deepEqual(reads, [[CONNECTED, 7n]], 'the entry is re-read after the sweep');

    lootboxMod.__setBoxStateReaderForTest(() => ({ pending: true, worded: true, swept: false, rngLocked: false }));
    const short = await lootboxMod.openLootBox({ lootboxIndex: 7n });
    assert.equal(short.opened, false, 'a sweep that stopped before the box leaves it queued');
    assert.ok(!('openBox' in lastFakeContract), 'no per-box door exists to call');
  });

  test('index completion uses the sweep frontier while opens remain owner-pinned', async () => {
    const other = '0xcd34000000000000000000000000000000000000';
    lastFakeContract = makeFakeContract({ boxIndexComplete: true });
    lootboxMod.__setContractFactoryForTest(() => lastFakeContract);

    assert.equal(await lootboxMod.readLootboxIndexCompletion(7), true);
    assert.deepEqual(lastFakeContract._calls.boxIndexComplete, [[7n]],
      'completion is index-wide and never pretends to inspect one player');

    const reads = [];
    lootboxMod.__setBoxStateReaderForTest((args) => {
      reads.push([args.player, BigInt(args.lootboxIndex)]);
      return { pending: false, worded: true, swept: true, rngLocked: false };
    });
    await lootboxMod.openLootBox({ player: other, lootboxIndex: 7 });
    assert.deepEqual(lastFakeContract._calls.mineFlip, [[0, { gasLimit: miningGasBounds().min }]]);
    assert.deepEqual(reads, [[other, 7n]],
      'the sweep result is read for the tracked owner\'s entry');
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

  test('purchase receipt sums the regular legs sharing one index', async () => {
    const other = '0xcd34000000000000000000000000000000000000';
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getTransactionReceipt: async () => ({
        logs: [
          { parsed: { name: 'LootBoxBuy', args: { buyer: CONNECTED, index: 12n, amount: 3n } } },
          { parsed: { name: 'LootBoxBuy', args: { buyer: CONNECTED, index: 12n, amount: 4n } } },
          { parsed: { name: 'LootBoxBuy', args: { buyer: other, index: 12n, amount: 99n } } },
          { parsed: { name: 'LootBoxBuy', args: { buyer: CONNECTED, index: 13n, amount: 88n } } },
        ],
      }),
    });

    assert.deepEqual(await lootboxMod.readLootboxPurchaseReceipt({
      transactionHash: '0xpurchased',
      player: CONNECTED,
      lootboxIndex: 12n,
    }), {
      hasLootboxLeg: true,
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
        { parsed: { name: 'LootBoxBuy', args: { index: 1n, amount: 2n, buyer: CONNECTED } } },
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

  test('canOpenLootbox reads the exact owner and index without sending', async () => {
    const owner = '0xcd34000000000000000000000000000000000000';
    const c = makeFakeContract();
    lootboxMod.__setContractFactoryForTest(() => c);
    const reads = [];
    lootboxMod.__setBoxStateReaderForTest((args) => {
      reads.push([args.player, BigInt(args.lootboxIndex)]);
      return { pending: true, worded: true, swept: false, rngLocked: false };
    });
    assert.equal(await lootboxMod.canOpenLootbox({ player: owner, lootboxIndex: 7n }), true);
    assert.deepEqual(reads, [[owner, 7n]]);
    assert.deepEqual(c._calls.mineFlip, [], 'readiness probe never opens anything');
    assert.deepEqual(c._calls.mineFlipStatic, []);
  });

  test('the box probe keeps its reasons: settled, waiting for the word, locked', async () => {
    for (const [state, reason, settled] of [
      [{ pending: false, worded: true, swept: false, rngLocked: false }, 'NothingToClaim', true],
      [{ pending: false, worded: true, swept: true, rngLocked: false }, 'NothingToClaim', true],
      [{ pending: true, worded: false, swept: false, rngLocked: false }, 'RngNotReady', false],
      [{ pending: true, worded: true, swept: false, rngLocked: true }, 'RngLocked', false],
    ]) {
      lootboxMod.__setBoxStateReaderForTest(() => state);
      const probe = await lootboxMod.probeOpenLootbox({ player: CONNECTED, lootboxIndex: 7n });
      assert.equal(probe.ok, false);
      assert.equal(probe.reason, reason);
      assert.equal(probe.settled, settled);
      assert.equal(await lootboxMod.canOpenLootbox({ player: CONNECTED, lootboxIndex: 7n }), false);
    }
  });

  test('canOpenLootbox remains available through the public reader without a wallet', async () => {
    contractsMod.clearProvider();
    lootboxMod.__setBoxStateReaderForTest(() => ({ pending: true, worded: true, swept: false, rngLocked: false }));
    assert.equal(
      await lootboxMod.canOpenLootbox({ player: CONNECTED, lootboxIndex: 7n }),
      true,
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
    const code = lootboxMod.readAffiliateCode(ACTIVE_CHAIN_ID, CONNECTED);
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
    assert.doesNotThrow(() => { code = lootboxMod.readAffiliateCode(ACTIVE_CHAIN_ID, CONNECTED); });
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000', 'falls back to ZeroHash');
    globalThis.localStorage.getItem = orig;
  });

  // --- site-wide first-touch referral (/js/ref.js capture) is the source ----

  test('readAffiliateCode reads the site-wide affiliate-ref localStorage key', () => {
    globalThis.localStorage.setItem('affiliate-ref', VALID_BYTES32);
    const code = lootboxMod.readAffiliateCode(ACTIVE_CHAIN_ID, CONNECTED);
    assert.equal(code, VALID_BYTES32);
  });

  test('own-code key (affiliate-code:{chain}:{addr}) never rides a purchase', () => {
    // That key holds the player's OWN registered code (affiliate.js) — using
    // it as the purchase code would be a self-referral.
    const ownCode = '0x' + 'cd'.repeat(32);
    globalThis.localStorage.setItem(`affiliate-code:${ACTIVE_CHAIN_ID}:${CONNECTED.toLowerCase()}`, ownCode);
    const code = lootboxMod.readAffiliateCode(ACTIVE_CHAIN_ID, CONNECTED);
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('site ref that matches the own registered code is skipped (clicked own share link)', () => {
    const ownCode = '0x' + 'cd'.repeat(32);
    globalThis.localStorage.setItem(`affiliate-code:${ACTIVE_CHAIN_ID}:${CONNECTED.toLowerCase()}`, ownCode);
    globalThis.localStorage.setItem('affiliate-ref', ownCode);
    const code = lootboxMod.readAffiliateCode(ACTIVE_CHAIN_ID, CONNECTED);
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('site-wide ref that is the connected address\'s own default code is skipped (self-referral)', () => {
    const selfCode = '0x' + '0'.repeat(24) + CONNECTED.toLowerCase().slice(2);
    globalThis.localStorage.setItem('affiliate-ref', selfCode);
    const code = lootboxMod.readAffiliateCode(ACTIVE_CHAIN_ID, CONNECTED);
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('readAffiliateCode falls back to dgn_ref cookie when localStorage has no ref', () => {
    const hadDocument = 'document' in globalThis;
    const origDocument = globalThis.document;
    globalThis.document = { cookie: `dgn_ref=${VALID_BYTES32}` };
    try {
      const code = lootboxMod.readAffiliateCode(ACTIVE_CHAIN_ID, CONNECTED);
      assert.equal(code, VALID_BYTES32);
    } finally {
      if (hadDocument) globalThis.document = origDocument;
      else delete globalThis.document;
    }
  });

  test('malformed site-wide affiliate-ref is ignored', () => {
    globalThis.localStorage.setItem('affiliate-ref', '0xdeadbeef');
    const code = lootboxMod.readAffiliateCode(ACTIVE_CHAIN_ID, CONNECTED);
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
// gracefully or fails open; lootboxQuantity=0 produces value=0n. Luckbox are
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
    getNetwork: async () => ({ chainId: BigInt(ACTIVE_CHAIN_ID) }),
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
    assert.equal(args[0], 0, 'buyer is the connected wallet (account 0)');
    assert.equal(args[1], 2000n, '5 tickets = 2000 purchase units (400 per ticket)');
    assert.equal(args[2], lootboxMod.packBoxOrder({ kind: 'small', quantity: 1 }), 'one Small box is packed');
    assert.equal(args[4], 0, 'payKind = MintPaymentKind.DirectEth (0)');
    assert.ok(txOverrides && txOverrides.value > 0n, '{value: quoted box cost} override');
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
    assert.equal(sentTx.gasLimit, 180_400n,
      'gasLimit carries the shared 20% pad plus the absolute branch cushion');
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

  test('lootboxQuantity=0 + ticketQuantity=1: boxOrder=0n is acceptable {value:0n}', async () => {
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 1, lootboxQuantity: 0,
    });
    const { args, txOverrides } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[2], 0n, 'no boxes produce an empty packed order');
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
    _setWalletIdForTests(OWNER, 73);

    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 1, lootboxQuantity: 1,
    });
    _resetWalletIdsForTests();

    assert.equal(fakeContract._calls.purchasePopulate.length, 1, 'purchase.populateTransaction called once');
    const { args, txOverrides } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[0], 73, 'buyer arg is the acted-for OWNER\'s account, not the connected operator (0)');
    assert.ok(txOverrides && txOverrides.value > 0n, 'msg.value still computed correctly');
  });
});
