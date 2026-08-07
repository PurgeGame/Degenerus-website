// /app/app/__tests__/passes.test.js — Phase 62 Plan 62-02 (BUY-02 + BUY-03).
//
// Run: cd website && node --test app/app/__tests__/passes.test.js
//
// Tests for passes.js write-path module: purchaseWhaleBundle + purchaseDeityPass +
// deityPassErrorOverride + RngLocked reason-map registration. Mirrors the Phase 61
// claims.test.js mock-stub pattern (port at lines 30-130).
//
// CONTEXT D-05 LOCKED — deity-pass `'E'` revert → 'That symbol's taken' inline.
// Plan 62-02 implements this as a panel-level decode override exposed from
// passes.js as `deityPassErrorOverride(decoded)`. Acceptance criterion test #6.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as passesMod from '../passes.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import * as reasonMapMod from '../reason-map.js';

// ---------------------------------------------------------------------------
// Fake provider/signer/contract harness — verbatim port of claims.test.js shape.
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) {
  return { status: 1, hash: '0xreceipt-hash', logs: logs || [] };
}

function makeFakeTx(receipt) {
  return { hash: '0xtx-hash', wait: async () => receipt };
}

function makeFakeContract(opts = {}) {
  const calls = {
    purchaseWhalePass: [],
    purchaseDeityPass: [],
    issueDeityBoon: [],
    smite: [],
    subscribe: [],
    depositAfkingFunding: [],
    afkingFundingOf: [],
    withdrawAfkingFunding: [],
    claimAfkingFlip: [],
  };
  const staticCallStub = (methodName) => async (..._args) => {
    if (opts.staticCallShouldRevert?.[methodName]) {
      const err = new Error('static-call revert');
      err.revert = {
        name: opts.staticCallRevertName?.[methodName] || 'E',
      };
      throw err;
    }
    return undefined;
  };
  const sendTxStub = (methodName) => async (..._args) => {
    if (opts.sendTxShouldRevert?.[methodName]) {
      const err = new Error('sendTx revert');
      err.revert = { name: opts.sendTxRevertName?.[methodName] || 'E' };
      throw err;
    }
    return makeFakeTx(makeFakeReceipt(opts[methodName + 'Logs']));
  };

  const c = {
    purchaseWhalePass: Object.assign(
      async (...args) => {
        calls.purchaseWhalePass.push(args);
        return sendTxStub('purchaseWhalePass')(...args);
      },
      { staticCall: staticCallStub('purchaseWhalePass') }
    ),
    purchaseDeityPass: Object.assign(
      async (...args) => {
        calls.purchaseDeityPass.push(args);
        return sendTxStub('purchaseDeityPass')(...args);
      },
      { staticCall: staticCallStub('purchaseDeityPass') }
    ),
    issueDeityBoon: Object.assign(
      async (...args) => {
        calls.issueDeityBoon.push(args);
        return sendTxStub('issueDeityBoon')(...args);
      },
      { staticCall: staticCallStub('issueDeityBoon') }
    ),
    smite: Object.assign(
      async (...args) => {
        calls.smite.push(args);
        return sendTxStub('smite')(...args);
      },
      { staticCall: staticCallStub('smite') }
    ),
    subscribe: Object.assign(
      async (...args) => {
        calls.subscribe.push(args);
        return sendTxStub('subscribe')(...args);
      },
      { staticCall: staticCallStub('subscribe') }
    ),
    depositAfkingFunding: Object.assign(
      async (...args) => {
        calls.depositAfkingFunding.push(args);
        return sendTxStub('depositAfkingFunding')(...args);
      },
      { staticCall: staticCallStub('depositAfkingFunding') }
    ),
    afkingFundingOf: async (...args) => {
      calls.afkingFundingOf.push(args);
      return opts.afkingFundingWei ?? 0n;
    },
    withdrawAfkingFunding: Object.assign(
      async (...args) => {
        calls.withdrawAfkingFunding.push(args);
        return sendTxStub('withdrawAfkingFunding')(...args);
      },
      { staticCall: staticCallStub('withdrawAfkingFunding') }
    ),
    claimAfkingFlip: Object.assign(
      async (...args) => {
        calls.claimAfkingFlip.push(args);
        return sendTxStub('claimAfkingFlip')(...args);
      },
      { staticCall: staticCallStub('claimAfkingFlip') }
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
  };
  return c;
}

function makeFakeProvider(connectedAddr) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({
      getAddress: async () => connectedAddr,
    }),
  };
}

const CONNECTED = '0xab12000000000000000000000000000000000000';

describe('pass bonus lootbox receipt parsing', () => {
  test('decodes raw LootBoxBuy logs without relying on the pass writer ABI', () => {
    const iface = new contractsMod.ethers.Interface([
      'event LootBoxBuy(address indexed buyer, uint48 indexed index, uint256 amount)',
    ]);
    const encoded = iface.encodeEventLog(iface.getEvent('LootBoxBuy'), [CONNECTED, 19n, 24n]);
    const boxes = passesMod.parsePassLootboxesFromReceipt({
      logs: [{ topics: encoded.topics, data: encoded.data }],
    });

    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].buyer.toLowerCase(), CONNECTED.toLowerCase());
    assert.equal(boxes[0].lootboxIndex, 19n);
    assert.equal(boxes[0].amountWei, 24n);
  });

  test('accepts already-parsed logs and ignores foreign receipt events', () => {
    const boxes = passesMod.parsePassLootboxesFromReceipt({ logs: [
      { parsed: { name: 'WhalePassPurchased', args: {} } },
      { parsed: { name: 'LootBoxBuy', args: { buyer: CONNECTED, index: 7n, amount: 40n } } },
    ] });
    assert.deepEqual(boxes, [{ buyer: CONNECTED, lootboxIndex: 7n, amountWei: 40n }]);
  });
});

function makeUnmintedDeityError() {
  const error = new Error('execution reverted: InvalidToken()');
  error.data = '0xc1ab6dc1';
  return error;
}

function makeFakeDeityReadContract(owners = new Map(), opts = {}) {
  return {
    name: async () => {
      if (opts.nameError) throw opts.nameError;
      return opts.name || 'Degenerus Deity Pass';
    },
    ownerOf: async (symbolId) => {
      const id = Number(symbolId);
      if (opts.ownerErrors?.has(id)) throw opts.ownerErrors.get(id);
      if (owners.has(id)) return owners.get(id);
      throw makeUnmintedDeityError();
    },
  };
}

// ===========================================================================
// Deity NFT catalog — canonical sold count + unavailable symbols.
// ===========================================================================

describe('deity pass NFT catalog', () => {
  afterEach(() => {
    passesMod.__resetDeityReadContractFactoryForTest();
  });

  test('returns all minted symbols, owners, and the issued count', async () => {
    const owners = new Map([
      [3, '0x3333000000000000000000000000000000000000'],
      [19, '0x1919000000000000000000000000000000000000'],
    ]);
    passesMod.__setDeityReadContractFactoryForTest(() => makeFakeDeityReadContract(owners));

    const catalog = await passesMod.readDeityPassCatalog();
    assert.equal(catalog.issuedCount, 2);
    assert.deepEqual([...catalog.takenSymbols], [3, 19]);
    assert.equal(catalog.ownersBySymbol.get(19), owners.get(19));
  });

  test('returns null on a partial RPC failure instead of exposing a claimed symbol', async () => {
    const ownerErrors = new Map([[7, new Error('RPC timeout')]]);
    passesMod.__setDeityReadContractFactoryForTest(() => makeFakeDeityReadContract(
      new Map(),
      { ownerErrors },
    ));

    assert.equal(await passesMod.readDeityPassCatalog(), null);
  });

  test('returns null when the configured address is not the deity pass contract', async () => {
    passesMod.__setDeityReadContractFactoryForTest(() => makeFakeDeityReadContract(
      new Map(),
      { name: 'Wrong NFT' },
    ));

    assert.equal(await passesMod.readDeityPassCatalog(), null);
  });
});

// ===========================================================================
// Deity daily boon slots + issuance.
// ===========================================================================

describe('deity daily boons', () => {
  afterEach(() => {
    passesMod.__resetDeityBoonReadContractFactoryForTest();
    passesMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('mirrors the viewer static gift-slot weighting regardless of live product flags', () => {
    const base = {
      dailySeed: 123456789n,
      deity: CONNECTED,
      day: 7,
    };
    assert.deepEqual(
      passesMod.deriveDeityBoonSlots({ ...base, decimatorOpen: true, deityPassAvailable: true }),
      [5, 4, 8],
    );
    assert.deepEqual(
      passesMod.deriveDeityBoonSlots({ ...base, decimatorOpen: false, deityPassAvailable: false }),
      [5, 4, 8],
    );
  });

  test('matches the emitted day-20 slot that the old conditional UI mislabeled', () => {
    const slots = passesMod.deriveDeityBoonSlots({
      dailySeed: 11621158837047785902248431115065076657481296476413078720687728983663490809916n,
      deity: '0x411087a5F752D3b5545E8301aD7e6cEf1351E480',
      day: 20,
      decimatorOpen: false,
      deityPassAvailable: true,
    });
    assert.deepEqual(slots, [7, 17, 5]);
    assert.equal(slots[0], 7, 'slot 0 is the emitted +5% ticket boon, not type 9 (+25%)');
  });

  test('returns the three slots with the authoritative used mask', async () => {
    passesMod.__setDeityBoonReadContractFactoryForTest(() => ({
      deityBoonData: async () => [123456789n, 7n, 0b101n, true, true],
    }));
    const state = await passesMod.readDeityBoonSlots(CONNECTED);
    assert.equal(state.day, 7);
    assert.equal(state.usedMask, 0b101);
    assert.equal(state.ready, true);
    assert.deepEqual(state.slots, [5, 4, 8]);
  });

  test('issues a slot for the acting deity only after a static call', async () => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const fake = makeFakeContract();
    passesMod.__setContractFactoryForTest(() => fake);
    const recipient = '0xcd34000000000000000000000000000000000000';

    await passesMod.issueDeityBoon({ recipient, slot: 2 });

    assert.equal(fake._calls.issueDeityBoon.length, 1);
    assert.deepEqual(fake._calls.issueDeityBoon[0], [
      '0xAB12000000000000000000000000000000000000',
      '0xCd34000000000000000000000000000000000000',
      2,
    ]);
  });

  test('rejects self-booning before opening a wallet request', async () => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    await assert.rejects(
      passesMod.issueDeityBoon({ recipient: CONNECTED, slot: 0 }),
      /other than yourself/i,
    );
  });

  test('a deity curse preflights and sends the holder symbol plus target', async () => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const fake = makeFakeContract();
    passesMod.__setContractFactoryForTest(() => fake);
    const target = '0xcd34000000000000000000000000000000000000';

    await passesMod.smiteWithDeity({ deityId: 11, target });

    assert.equal(fake._calls.smite.length, 1);
    assert.deepEqual(fake._calls.smite[0], [
      11,
      '0xCd34000000000000000000000000000000000000',
    ]);
  });

  test('a deity curse rejects an invalid pass id or target before sending', async () => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const fake = makeFakeContract();
    passesMod.__setContractFactoryForTest(() => fake);

    await assert.rejects(
      passesMod.smiteWithDeity({ deityId: 32, target: CONNECTED }),
      /0-31/,
    );
    await assert.rejects(
      passesMod.smiteWithDeity({ deityId: 11, target: 'not-an-address' }),
      /valid target/i,
    );
    assert.equal(fake._calls.smite.length, 0);
  });
});

// ===========================================================================
// AFKing seat entitlement + claim. Buying a deity/whale/lazy pass latches the
// free claim in GAME; the ERC-721 is deliberately claimed in a second tx.
// ===========================================================================

describe('AFKing seat entitlement and claim', () => {
  afterEach(() => {
    passesMod.__resetAfkingReadContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('a holder with no seat is not surfaced as having one', async () => {
    // Seats auto-mint with the pass; `claimSeat`/`canClaimSeat` no longer exist, so balanceOf
    // is the whole signal.
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 0n },
      game: {
        subInfo: async () => [false, 0n, 0n, 0n],
        afkingSnapshot: async () => [10n, false, [0n], [0n]],
      },
    }));

    const state = await passesMod.readAfkingSubscription(CONNECTED);
    assert.equal(state.hasToken, false);
    assert.equal(state.tokenBalance, 0n);
    assert.equal('canClaimSeat' in state, false);
  });

  test('funding-only reads do not depend on seat or subscription snapshots', async () => {
    const calls = [];
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      game: {
        afkingFundingOf: async (player) => {
          calls.push(player);
          return 875n;
        },
      },
    }));
    assert.equal(await passesMod.readAfkingFunding(CONNECTED), 875n);
    assert.deepEqual(calls, [CONNECTED]);
  });

  test('a seat holder is surfaced as having one', async () => {
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 1n },
      game: {
        subInfo: async () => [false, 0n, 0n, 0n],
        afkingSnapshot: async () => [10n, false, [0n], [0n]],
      },
    }));

    const state = await passesMod.readAfkingSubscription(CONNECTED);
    assert.equal(state.hasToken, true);
    assert.equal(state.tokenBalance, 1n);
  });

  test('reads the exact accrued AFKing bonus FLIP from the deployment lens', async () => {
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 1n },
      game: {
        subInfo: async () => [true, 2n, 8n, 12n],
        afkingSnapshot: async () => [10n, false, [0n], [0n]],
      },
      lens: {
        subInfoFull: async () => ({ pendingFlip: 275n }),
      },
    }));

    const state = await passesMod.readAfkingSubscription(CONNECTED);
    assert.equal(state.pendingFlipKnown, true);
    assert.equal(state.pendingFlipWhole, 275n);
  });

  test('decodes the current AFKing product and funding priority from packed lens flags', async () => {
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 1n },
      game: {
        subInfo: async () => [true, 3n, 8n, 12n],
        afkingSnapshot: async () => [10n, false, [0n], [0n]],
      },
      lens: {
        // bit 1 = claimable/game credit first; bit 2 = Tickets.
        subInfoFull: async () => ({ flags: 6n, pendingFlip: 0n }),
      },
    }));

    const state = await passesMod.readAfkingSubscription(CONNECTED);
    assert.equal(state.settingsKnown, true);
    assert.equal(state.drainGameCreditFirst, true);
    assert.equal(state.useTickets, true);
  });
});

describe('AFKing subscription configuration and funding', () => {
  let fake;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    fake = makeFakeContract();
    passesMod.__setContractFactoryForTest(() => fake);
  });

  afterEach(() => {
    passesMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('sends delivery mode, quantity, claimable priority, and ETH funding to subscribe', async () => {
    const funding = 250_000_000_000n;
    await passesMod.updateAfkingSubscription({
      dailyQuantity: 3,
      useTickets: false,
      drainGameCreditFirst: false,
      msgValueWei: funding,
    });

    assert.equal(fake._calls.subscribe.length, 1);
    assert.deepEqual(fake._calls.subscribe[0], [
      CONNECTED,
      false,
      false,
      3,
      '0x0000000000000000000000000000000000000000',
      { value: funding },
    ]);
  });

  test('rejects an invalid quantity or negative funding before sending', async () => {
    await assert.rejects(
      passesMod.updateAfkingSubscription({ dailyQuantity: 256 }),
      /0-255/,
    );
    await assert.rejects(
      passesMod.updateAfkingSubscription({ dailyQuantity: 1, msgValueWei: -1n }),
      /cannot be negative/,
    );
    assert.equal(fake._calls.subscribe.length, 0);
  });

  test('tops up AFKing funding without rewriting subscription settings', async () => {
    const funding = 400_000_000_000n;
    await passesMod.fundAfkingSubscription({ msgValueWei: funding });

    assert.equal(fake._calls.subscribe.length, 0);
    assert.deepEqual(fake._calls.depositAfkingFunding, [[
      '0xAB12000000000000000000000000000000000000',
      { value: funding },
    ]]);
  });

  test('claims accrued AFKing bonus FLIP for the acting subscriber', async () => {
    await passesMod.claimAfkingSubscriptionFlip();

    assert.deepEqual(fake._calls.claimAfkingFlip, [[
      ['0xAB12000000000000000000000000000000000000'],
    ]]);
  });

  test('rejects an empty AFKing top-up before sending', async () => {
    await assert.rejects(
      passesMod.fundAfkingSubscription({ msgValueWei: 0n }),
      /funding amount/i,
    );
    assert.equal(fake._calls.depositAfkingFunding.length, 0);
  });

  test('re-reads and withdraws the connected wallet\'s complete AFKing funding balance', async () => {
    const funding = 80_000_000_000n;
    fake = makeFakeContract({ afkingFundingWei: funding });
    passesMod.__setContractFactoryForTest(() => fake);

    const result = await passesMod.withdrawAfkingSubscriptionFunding();

    assert.equal(result.amountWei, funding);
    assert.deepEqual(fake._calls.afkingFundingOf, [[
      '0xAB12000000000000000000000000000000000000',
    ]]);
    assert.deepEqual(fake._calls.withdrawAfkingFunding, [[funding]]);
  });

  test('refuses AFKing withdrawal in operator mode before reading or sending', async () => {
    storeMod.update('viewing.address', '0xcd34000000000000000000000000000000000000');
    storeMod.update('ui.mode', 'operator');

    await assert.rejects(
      passesMod.withdrawAfkingSubscriptionFunding(),
      /own wallet view/i,
    );
    assert.equal(fake._calls.afkingFundingOf.length, 0);
    assert.equal(fake._calls.withdrawAfkingFunding.length, 0);
  });

  test('does not open a withdrawal transaction for an empty AFKing balance', async () => {
    await assert.rejects(
      passesMod.withdrawAfkingSubscriptionFunding(),
      /no AFKing funding/i,
    );
    assert.equal(fake._calls.withdrawAfkingFunding.length, 0);
  });

  test('surfaces a stale AFKing withdrawal balance without sending', async () => {
    fake = makeFakeContract({
      afkingFundingWei: 80_000_000_000n,
      staticCallShouldRevert: { withdrawAfkingFunding: true },
      staticCallRevertName: { withdrawAfkingFunding: 'Insolvent' },
    });
    passesMod.__setContractFactoryForTest(() => fake);

    await assert.rejects(
      passesMod.withdrawAfkingSubscriptionFunding(),
      // Wording is context-neutral: audit c19a1088 made Insolvent the foil leg's
      // shortfall revert too, so this one registration serves both paths.
      (error) => error?.code === 'Insolvent' && /doesn't cover that amount/i.test(error.userMessage),
    );
    assert.equal(fake._calls.withdrawAfkingFunding.length, 0);
  });
});

// ===========================================================================
// Reason-map registrations used by the pass and AFKing write paths.
// ===========================================================================

describe('Plan 62-02: passes.js reason-map registrations', () => {
  test('registers RngLocked with friendly userMessage', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'RngLocked' },
    });
    assert.equal(decoded.code, 'RngLocked');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /RNG|locked/i);
  });

  test('does NOT register `Taken` from Plan 62-02 (Pitfall 3 — dead alias for Phase 62 BUY paths)', () => {
    // Plan 62-02 does not register a `Taken` code — the deity-pass `'E'` decode
    // override happens at the panel level via `deityPassErrorOverride`, not in
    // the shared reason-map.
    const SRC = readFileSync(new URL('../passes.js', import.meta.url), 'utf8');
    assert.equal(
      /register\(\s*['"]Taken['"]/.test(SRC),
      false,
      "passes.js must NOT register 'Taken' code",
    );
  });

  test('does NOT register `InvalidToken` from Plan 62-02 (Pitfall 3 — dead alias)', () => {
    const SRC = readFileSync(new URL('../passes.js', import.meta.url), 'utf8');
    assert.equal(
      /register\(\s*['"]InvalidToken['"]/.test(SRC),
      false,
      "passes.js must NOT register 'InvalidToken' code",
    );
  });
});

// ===========================================================================
// purchaseWhaleBundle — calls contract.purchaseWhaleBundle(buyer, qty) with msg.value.
// ===========================================================================

describe('Plan 62-02: purchaseWhaleBundle', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    passesMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    passesMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes purchaseWhaleBundle(buyer, qty, affiliateCode) with closure-form sendTx + msg.value', async () => {
    const value = 12n * 10n ** 18n;
    await passesMod.purchaseWhaleBundle({ quantity: 5, msgValueWei: value });
    assert.equal(lastFakeContract._calls.purchaseWhalePass.length, 1);
    const [args] = lastFakeContract._calls.purchaseWhalePass;
    assert.equal(args[0], CONNECTED, 'buyer = connected.address');
    assert.equal(args[1], 5n, 'quantity arg = BigInt 5n');
    // affiliateCode is part of the SELECTOR, not an optional trailing extra:
    // the two-arg form does not exist on the deployed GAME (0xe81ebd5f absent,
    // 0x78f70988 present) and reverts with empty returndata.
    assert.match(args[2], /^0x[0-9a-f]{64}$/i, 'bytes32 affiliate code passed');
    // 4th arg = overrides object containing value
    assert.ok(args[3] && typeof args[3] === 'object', 'overrides object passed');
    assert.equal(args[3].value, value, 'msg.value matches msgValueWei');
  });

  test('rejects quantity < 1', async () => {
    await assert.rejects(
      passesMod.purchaseWhaleBundle({ quantity: 0, msgValueWei: 0n }),
      /Quantity must be 1-100/i,
    );
  });

  test('rejects quantity > 100', async () => {
    await assert.rejects(
      passesMod.purchaseWhaleBundle({ quantity: 101, msgValueWei: 0n }),
      /Quantity must be 1-100/i,
    );
  });

  test('rejects when wallet not connected', async () => {
    storeMod.update('connected.address', null);
    contractsMod.clearProvider();
    await assert.rejects(
      passesMod.purchaseWhaleBundle({ quantity: 1, msgValueWei: 0n }),
      /Wallet not connected/i,
    );
  });

  test('static-call gate runs BEFORE sendTx — order verification', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { purchaseWhalePass: true },
      staticCallRevertName: { purchaseWhalePass: 'E' },
    });
    passesMod.__setContractFactoryForTest(() => reverting);
    await assert.rejects(
      passesMod.purchaseWhaleBundle({ quantity: 1, msgValueWei: 0n }),
    );
    assert.equal(
      reverting._calls.purchaseWhalePass.length, 0,
      'sendTx NOT invoked when static-call gate trips',
    );
  });
});

// ===========================================================================
// purchaseDeityPass — calls contract.purchaseDeityPass(buyer, symbolId) with msg.value.
// ===========================================================================

describe('Plan 62-02: purchaseDeityPass', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    passesMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    passesMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes purchaseDeityPass(buyer, symbolId) with closure-form sendTx + msg.value', async () => {
    const value = 24n * 10n ** 18n;
    await passesMod.purchaseDeityPass({ symbolId: 7, msgValueWei: value });
    assert.equal(lastFakeContract._calls.purchaseDeityPass.length, 1);
    const [args] = lastFakeContract._calls.purchaseDeityPass;
    assert.equal(args[0], CONNECTED, 'buyer = connected.address');
    assert.equal(args[1], 7, 'symbolId arg = number 7');
    assert.ok(args[2] && typeof args[2] === 'object', 'overrides object passed');
    assert.equal(args[2].value, value, 'msg.value matches msgValueWei');
  });

  test('rejects symbolId < 0', async () => {
    await assert.rejects(
      passesMod.purchaseDeityPass({ symbolId: -1, msgValueWei: 0n }),
      /Symbol must be 0-31/i,
    );
  });

  test('rejects symbolId > 31', async () => {
    await assert.rejects(
      passesMod.purchaseDeityPass({ symbolId: 32, msgValueWei: 0n }),
      /Symbol must be 0-31/i,
    );
  });

  test('rejects non-integer symbolId', async () => {
    await assert.rejects(
      passesMod.purchaseDeityPass({ symbolId: 'abc', msgValueWei: 0n }),
      /Symbol must be 0-31/i,
    );
  });

  test('rejects when wallet not connected', async () => {
    storeMod.update('connected.address', null);
    contractsMod.clearProvider();
    await assert.rejects(
      passesMod.purchaseDeityPass({ symbolId: 7, msgValueWei: 0n }),
      /Wallet not connected/i,
    );
  });

  test('static-call gate runs BEFORE sendTx — order verification', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { purchaseDeityPass: true },
      staticCallRevertName: { purchaseDeityPass: 'E' },
    });
    passesMod.__setContractFactoryForTest(() => reverting);
    await assert.rejects(
      passesMod.purchaseDeityPass({ symbolId: 7, msgValueWei: 0n }),
    );
    assert.equal(
      reverting._calls.purchaseDeityPass.length, 0,
      'sendTx NOT invoked when static-call gate trips',
    );
  });
});

// ===========================================================================
// deityPassErrorOverride — CONTEXT D-05 LOCKED panel-level 'E' override.
// ===========================================================================

describe('Plan 62-02: deityPassErrorOverride', () => {
  test("transforms 'E' code to 'DeityPass-Taken' with locked copy", () => {
    const out = passesMod.deityPassErrorOverride({
      code: 'E',
      userMessage: 'An unexpected error occurred. Please try again.',
      recoveryAction: 'Retry; if it persists, refresh the page.',
    });
    assert.equal(out.code, 'DeityPass-Taken');
    assert.equal(out.userMessage, "That symbol's taken — try another.");
    assert.equal(out.recoveryAction, 'Pick a different symbol.');
  });

  test('returns input unchanged for non-E codes (NotApproved)', () => {
    const input = {
      code: 'NotApproved',
      userMessage: 'Operator not approved.',
      recoveryAction: 'Connect to your own wallet to act.',
    };
    const out = passesMod.deityPassErrorOverride(input);
    assert.equal(out.code, 'NotApproved');
    assert.equal(out.userMessage, 'Operator not approved.');
  });

  test('returns input unchanged for RngLocked', () => {
    const input = {
      code: 'RngLocked',
      userMessage: 'RNG is locked during settlement. Try again in a few minutes.',
      recoveryAction: 'Wait and retry.',
    };
    const out = passesMod.deityPassErrorOverride(input);
    assert.equal(out.code, 'RngLocked');
  });

  test('returns input unchanged for null/undefined input', () => {
    const out = passesMod.deityPassErrorOverride(undefined);
    assert.equal(out, undefined);
    const out2 = passesMod.deityPassErrorOverride(null);
    assert.equal(out2, null);
  });
});

// ===========================================================================
// passes.js source-level invariants — closure form, action labels, ABI canonical.
// ===========================================================================

describe('Plan 62-02: passes.js source-level invariants', () => {
  const SRC = readFileSync(new URL('../passes.js', import.meta.url), 'utf8');

  test('uses closure-form sendTx — minimum 2 occurrences (one per writer)', () => {
    const matches = SRC.match(/sendTx\(\s*\(s\)\s*=>/g) || [];
    assert.ok(matches.length >= 2, `expected >= 2 closure-form sendTx, got ${matches.length}`);
  });

  test('action label `Buy whale pass` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Buy whale pass'"), 'literal action label present');
  });

  test('action label `Buy deity pass` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Buy deity pass'"), 'literal action label present');
  });

  test('canonical ABI: purchaseWhalePass(address,uint256,bytes32) — the deployed selector', () => {
    assert.ok(
      SRC.includes('function purchaseWhalePass(address buyer, uint256 quantity, bytes32 affiliateCode) external payable'),
      'canonical PASSES_ABI fragment present (DegenerusGame.sol:997)',
    );
  });

  test('canonical ABI: purchaseLazyPass(address,bytes32) — the deployed selector', () => {
    assert.ok(
      SRC.includes('function purchaseLazyPass(address buyer, bytes32 affiliateCode) external payable'),
      'canonical LAZY_PASS_ABI fragment present (DegenerusGame.sol:1029)',
    );
  });

  test('the deity static-call carries msg.value, like the send does', () => {
    // Simulating at value 0 priced the buy from claimable instead of the
    // payment, so the gate could reject a buy the real tx would have settled.
    assert.ok(
      SRC.includes("requireStaticCall(c, 'purchaseDeityPass', [buyer, sid, { value }], signer)"),
      'deity pre-flight passes the overrides object',
    );
  });

  test('canonical ABI: purchaseDeityPass(address buyer, uint8 symbolId) external payable', () => {
    assert.ok(
      SRC.includes('function purchaseDeityPass(address buyer, uint8 symbolId) external payable'),
      'canonical PASSES_ABI fragment present',
    );
  });

  test('registers the whale/deity/lazy custom errors the module actually throws', () => {
    // These are NAMED custom errors in DegenerusGameWhaleModule.sol, not the
    // `revert E()` this module's header once assumed. Unregistered, every one of
    // them rendered as the UNKNOWN catch-all's "unexpected error".
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const code of [
      'RngLocked', 'SymbolTaken', 'InvalidSymbol', 'AlreadyOwnsDeityPass',
      'DeityPassConflict', 'InvalidLevelForPass', 'PassNotExpired',
      'MinQuantityRequired', 'InvalidQuantity', 'GameOver',
    ]) {
      assert.ok(
        new RegExp(`register\\(\\s*['"]${code}['"]`).test(stripped),
        `${code} must be registered`,
      );
    }
  });

  test('NO pre-resolved-promise sendTx (Phase 58 closure-form gate)', () => {
    // Comment-stripped to avoid false positives from doc-comments mentioning the
    // forbidden form. The grep gate pattern: sendTx(<ident>.<ident>(...)
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      /sendTx\([a-zA-Z_]+\.[a-zA-Z_]+\(/.test(stripped),
      false,
      'NO pre-resolved promise sendTx pattern allowed',
    );
  });

  test('contains literal `That symbol\'s taken — try another.` (CONTEXT D-05 LOCKED)', () => {
    assert.ok(
      SRC.includes("That symbol's taken — try another."),
      'CONTEXT D-05 LOCKED override copy present',
    );
  });

  test('contains literal `DeityPass-Taken` override code', () => {
    assert.ok(SRC.includes('DeityPass-Taken'), 'override code literal present');
  });

  test('requireStaticCall invoked at least 2 times (one per writer)', () => {
    const matches = SRC.match(/requireStaticCall\(/g) || [];
    assert.ok(matches.length >= 2, `expected >= 2 requireStaticCall, got ${matches.length}`);
  });
});
