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
import { writePurchaseFundingPriority } from '../lootbox.js';
import * as walletIdMod from '../wallet-id.js';
import * as chainClientMod from '../../chain/client.js';
import { CHAIN, CONTRACTS } from '../chain-config.js';
import { abi as gameAbi } from '../../chain/generated/game.js';
import { boxReference } from '../../chain/box-queue.js';

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
    claimableWinningsOf: [],
    staticCalls: [],
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
    calls.staticCalls.push({ methodName, args: _args });
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
    claimableWinningsOf: async (buyer) => {
      calls.claimableWinningsOf.push(buyer);
      if (opts.claimableError) throw opts.claimableError;
      return opts.claimableWei ?? 0n;
    },
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
    getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
    getSigner: async () => ({
      getAddress: async () => connectedAddr,
    }),
  };
}

const CONNECTED = '0xab12000000000000000000000000000000000000';

describe('pass bonus lootbox receipt parsing', () => {
  test('decodes raw LootBoxBuy logs without relying on the pass writer ABI', () => {
    const iface = new contractsMod.ethers.Interface(gameAbi);
    const encoded = iface.encodeEventLog(iface.getEvent('LootBoxBuy'), [37n, 1n, 3n, 24n]);
    const boxes = passesMod.parsePassLootboxesFromReceipt({
      logs: [{ topics: encoded.topics, data: encoded.data }],
    });

    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].buyer, '37', 'an unprepared receipt carries the buyer wallet ID');
    assert.equal(boxes[0].lootboxIndex, boxReference(1n, 3n));
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

describe('deity NFT appearance', () => {
  afterEach(() => passesMod.__resetDeityReadContractFactoryForTest());

  test('preserves the NFT renderer’s custom colors and shares a cached metadata read', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-51 -51 102 102"><circle r="46" fill="#fa12ab"/></svg>';
    const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    let reads = 0;
    passesMod.__setDeityReadContractFactoryForTest(() => ({ tokenURI: async (id) => {
      assert.equal(id, 22);
      reads += 1;
      return `data:application/json;base64,${Buffer.from(JSON.stringify({ image })).toString('base64')}`;
    } }));
    const [first, second] = await Promise.all([passesMod.readDeityPassAppearance(22), passesMod.readDeityPassAppearance(22)]);
    assert.deepEqual(first, { src: image, canonicalBadge: true });
    assert.deepEqual(second, first);
    assert.equal(reads, 1);
  });

  test('failed or malformed metadata falls back and can be retried', async () => {
    const responses = [null, 'data:application/json;base64,bad',
      `data:application/json,${encodeURIComponent(JSON.stringify({ image: 'https://example.com/image.svg' }))}`,
      `data:application/json,${encodeURIComponent(JSON.stringify({ image: 'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%20100%20100%22%2F%3E' }))}`];
    let reads = 0;
    passesMod.__setDeityReadContractFactoryForTest(() => ({ tokenURI: async () => responses[reads++] }));
    for (let i = 0; i < 3; i++) assert.equal(await passesMod.readDeityPassAppearance(10), null);
    assert.equal((await passesMod.readDeityPassAppearance(10)).canonicalBadge, false, 'external renderer keeps its own layout');
    assert.equal(await passesMod.readDeityPassAppearance(32), null);
    assert.equal(reads, 4);
  });
});

describe('deity daily boons', () => {
  afterEach(() => {
    passesMod.__resetDeityBoonReadContractFactoryForTest();
    passesMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('the gift-slot walk ignores the live product flags', () => {
    const base = { dailySeed: 123456789n, deity: CONNECTED, deityId: 37, day: 7 };
    const open = passesMod.deriveDeityBoonSlots({ ...base, decimatorOpen: true, deityPassAvailable: true });
    assert.equal(open.length, 3);
    assert.deepEqual(passesMod.deriveDeityBoonSlots({ ...base, decimatorOpen: false, deityPassAvailable: false }), open);
  });

  test('returns the three slots with the authoritative used mask', async () => {
    walletIdMod._setWalletIdForTests(CONNECTED, 37);
    passesMod.__setDeityBoonReadContractFactoryForTest(() => ({
      deityBoonData: async () => [123456789n, 7n, 0b101n, true, true],
    }));
    const state = await passesMod.readDeityBoonSlots(CONNECTED);
    walletIdMod._resetWalletIdsForTests();
    assert.equal(state.day, 7);
    assert.equal(state.usedMask, 0b101);
    assert.equal(state.ready, true);
    // The slots hash the deity's wallet ID (DeityBoonViewer: abi.encode(seed, id, day, slot)).
    assert.deepEqual(state.slots, passesMod.deriveDeityBoonSlots({ dailySeed: 123456789n, deity: CONNECTED, deityId: 37, day: 7 }));
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
    walletIdMod._setWalletIdForTests(recipient, 73);

    await passesMod.issueDeityBoon({ recipient, slot: 2 });
    walletIdMod._resetWalletIdsForTests();

    // issueDeityBoon(deity id, recipient id, slot): 0 names the caller.
    assert.deepEqual(fake._calls.issueDeityBoon, [[0, 73, 2]]);
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
    walletIdMod._setWalletIdForTests(target, 73);

    await passesMod.smiteWithDeity({ deityId: 11, target });
    walletIdMod._resetWalletIdsForTests();

    assert.deepEqual(fake._calls.smite, [[11, 73]]);
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
// AFKing reads: seat balance, the Lens SubFull and the funding snapshot.
// ===========================================================================

const lensSub = (fields = {}) => ({
  member: false, active: false, removalPending: false, paused: false, useTickets: false,
  dailyQuantity: 0, runStartDay: 0, endpoint: 0, owedFlip: 0n, ...fields,
});

describe('AFKing subscription reads', () => {
  afterEach(() => {
    passesMod.__resetAfkingReadContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  const reads = ({ seats = 0n, sub = lensSub(), snapshot = async () => [10n, false, [0n], [0n]] } = {}) =>
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => seats },
      game: { afkingSnapshot: snapshot },
      lens: { subInfoFull: async () => sub },
    }));

  test('the seat balance alone says whether a seat is held', async () => {
    reads();
    let state = await passesMod.readAfkingSubscription(CONNECTED);
    assert.equal(state.hasToken, false);
    assert.equal(state.tokenBalance, 0n);
    reads({ seats: 1n });
    state = await passesMod.readAfkingSubscription(CONNECTED);
    assert.equal(state.hasToken, true);
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

  test('starts every independent AFKing leg together for one Multicall window', async () => {
    const started = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const wait = async (name, value) => {
      started.push(name);
      await gate;
      return value;
    };
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: () => wait('balance', 1n) },
      game: { afkingSnapshot: () => wait('snapshot', [10n, false, [0n], [25n]]) },
      lens: { subInfoFull: () => wait('lens', lensSub({ member: true, active: true, dailyQuantity: 2 })) },
    }));

    const pending = passesMod.readAfkingSubscription(CONNECTED);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(new Set(started), new Set(['balance', 'snapshot', 'lens']));
    release();
    assert.equal((await pending).fundingWei, 25n);
  });

  test('a failed core snapshot is unknown instead of synthetic zero funding', async () => {
    reads({ seats: 1n, snapshot: async () => { throw new Error('temporary RPC failure'); } });
    const state = await passesMod.readAfkingSubscription(CONNECTED);
    assert.equal(state, null,
      'a missing funding snapshot cannot masquerade as an active account with zero funding');
  });

  test('the order and the owed bonus FLIP come from the Lens SubFull', async () => {
    reads({ seats: 1n, sub: lensSub({ member: true, active: true, useTickets: true, dailyQuantity: 3, owedFlip: 275n }) });
    const state = await passesMod.readAfkingSubscription(CONNECTED);
    assert.equal(state.active, true);
    assert.equal(state.dailyQuantity, 3);
    assert.equal(state.useTickets, true);
    assert.equal(state.pendingFlipWhole, 275n);
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
    walletIdMod._setWalletIdForTests(CONNECTED, 41);
    // A change to a live run burns no seat: the lookup finds the member and returns 0.
    chainClientMod.setChainClientForTests({
      address: () => CONTRACTS.GAME,
      snapshot: async () => ({ call: async () => ({ member: true }), verify: async () => {} }),
    });
    fake = makeFakeContract();
    passesMod.__setContractFactoryForTest(() => fake);
  });

  afterEach(() => {
    passesMod.__resetContractFactoryForTest();
    chainClientMod.setChainClientForTests(null);
    walletIdMod._resetWalletIdsForTests();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('sends subscribe(id, useTickets, dailyQuantity, seatId) with any ETH value', async () => {
    const funding = 250_000_000_000n;
    await passesMod.updateAfkingSubscription({ dailyQuantity: 3, useTickets: true, msgValueWei: funding });
    assert.deepEqual(fake._calls.subscribe, [[0, true, 3, 0n, { value: funding }]]);
  });

  test('rejects an invalid quantity or negative funding before sending', async () => {
    await assert.rejects(
      passesMod.updateAfkingSubscription({ dailyQuantity: 9 }),
      /0-8/,
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
    assert.deepEqual(fake._calls.depositAfkingFunding, [[41, { value: funding }]]);
  });

  test('claims accrued AFKing bonus FLIP for the acting subscriber', async () => {
    await passesMod.claimAfkingSubscriptionFlip();
    // claimAfkingFlip(uint32[]): 0 names the caller.
    assert.deepEqual(fake._calls.claimAfkingFlip, [[[0]]]);
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
    assert.deepEqual(fake._calls.withdrawAfkingFunding, [[0, funding]]);
  });

  test('a wallet on another chain is stopped before the AFKing balance re-read', async () => {
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) + 1n }),
    });
    fake = makeFakeContract({ afkingFundingWei: 80_000_000_000n });
    passesMod.__setContractFactoryForTest(() => fake);

    await assert.rejects(passesMod.withdrawAfkingSubscriptionFunding(), /Wrong network/);
    assert.equal(fake._calls.afkingFundingOf.length, 0);
    assert.equal(fake._calls.withdrawAfkingFunding.length, 0);
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
    writePurchaseFundingPriority('claimable');
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    passesMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    writePurchaseFundingPriority('claimable');
    passesMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes purchaseWhaleBundle(account, qty, affiliateCode) with closure-form sendTx + msg.value', async () => {
    const value = 12n * 10n ** 18n;
    await passesMod.purchaseWhaleBundle({ quantity: 5, msgValueWei: value });
    assert.equal(lastFakeContract._calls.purchaseWhalePass.length, 1);
    const [args] = lastFakeContract._calls.purchaseWhalePass;
    assert.equal(args[0], 0, 'buyer = the connected wallet (account 0)');
    assert.equal(args[1], 5n, 'quantity arg = BigInt 5n');
    // affiliateCode is part of the SELECTOR, not an optional trailing extra:
    // the two-arg form does not exist on the deployed GAME (0xe81ebd5f absent,
    // 0x78f70988 present) and reverts with empty returndata.
    assert.match(args[2], /^0x[0-9a-f]{64}$/i, 'bytes32 affiliate code passed');
    // 4th arg = overrides object containing value
    assert.ok(args[3] && typeof args[3] === 'object', 'overrides object passed');
    assert.equal(args[3].value, value, 'msg.value matches msgValueWei');
  });

  for (const [label, balance, expected] of [
    ['fully funded', 1001n, 0n],
    ['partially funded', 401n, 600n],
    ['sentinel only', 1n, 1000n],
    ['empty balance', 0n, 1000n],
  ]) {
    test(`claimable-first whale buy: ${label}`, async () => {
      lastFakeContract = makeFakeContract({ claimableWei: balance });
      await passesMod.purchaseWhaleBundle({ quantity: 1, msgValueWei: 1000n });
      assert.deepEqual(lastFakeContract._calls.claimableWinningsOf, [CONNECTED]);
      assert.equal(lastFakeContract._calls.purchaseWhalePass[0][3].value, expected);
      assert.equal(lastFakeContract._calls.staticCalls[0].args[3].value, expected);
    });
  }

  test('wallet-first whale buy sends full price without reading claimable', async () => {
    writePurchaseFundingPriority('wallet');
    lastFakeContract = makeFakeContract({ claimableWei: 1001n });
    await passesMod.purchaseWhaleBundle({ quantity: 1, msgValueWei: 1000n });
    assert.equal(lastFakeContract._calls.purchaseWhalePass[0][3].value, 1000n);
    assert.deepEqual(lastFakeContract._calls.claimableWinningsOf, []);
  });

  test('claimable read failure stops whale buy before simulation or send', async () => {
    lastFakeContract = makeFakeContract({ claimableError: new Error('RPC unavailable') });
    await assert.rejects(
      passesMod.purchaseWhaleBundle({ quantity: 1, msgValueWei: 1000n }),
      /RPC unavailable/,
    );
    assert.deepEqual(lastFakeContract._calls.staticCalls, []);
    assert.deepEqual(lastFakeContract._calls.purchaseWhalePass, []);
  });

  test('a wallet on another chain is stopped before the claimable read reaches its RPC', async () => {
    // On the wrong chain GAME has no code, so the wallet-RPC claimable read used to fail
    // first as "could not decode result data" instead of asking for the network switch.
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) + 1n }),
    });
    lastFakeContract = makeFakeContract({ claimableWei: 1001n });
    await assert.rejects(
      passesMod.purchaseWhaleBundle({ quantity: 1, msgValueWei: 1000n }),
      /Wrong network/,
    );
    assert.deepEqual(lastFakeContract._calls.claimableWinningsOf, []);
    assert.deepEqual(lastFakeContract._calls.purchaseWhalePass, []);
  });

  test('rejects quantity < 1', async () => {
    await assert.rejects(
      passesMod.purchaseWhaleBundle({ quantity: 0, msgValueWei: 0n }),
      /Quantity must be 1-1,000/i,
    );
  });

  // WHALE_MAX_QUANTITY = 1,000 (audit 4f4aa8377): 1,000 is a valid quantity, 1,001 reverts.
  test('rejects quantity > 1,000', async () => {
    await assert.rejects(
      passesMod.purchaseWhaleBundle({ quantity: 1001, msgValueWei: 0n }),
      /Quantity must be 1-1,000/i,
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
// purchaseDeityPass — calls purchaseDeityPass(buyer, symbolId, affiliateCode)
// with msg.value.
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

  test('invokes purchaseDeityPass(account, symbolId, affiliateCode) with closure-form sendTx + msg.value', async () => {
    const value = 24n * 10n ** 18n;
    const affiliateCode = `0x${'12'.repeat(32)}`;
    const priorLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (key) => key === 'affiliate-ref' ? affiliateCode : null,
    };
    try {
      await passesMod.purchaseDeityPass({ symbolId: 7, msgValueWei: value });
    } finally {
      if (priorLocalStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = priorLocalStorage;
    }
    assert.equal(lastFakeContract._calls.purchaseDeityPass.length, 1);
    const [args] = lastFakeContract._calls.purchaseDeityPass;
    assert.equal(args[0], 0, 'buyer = the connected wallet (account 0)');
    assert.equal(args[1], 7, 'symbolId arg = number 7');
    assert.equal(args[2], affiliateCode, 'first-touch affiliate code passed');
    assert.ok(args[3] && typeof args[3] === 'object', 'overrides object passed');
    assert.equal(args[3].value, value, 'msg.value matches msgValueWei');
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
      SRC.includes("c, 'purchaseDeityPass', [await accountArg(buyer), sid, affiliateCode, { value }], signer"),
      'deity pre-flight passes the overrides object',
    );
  });

  test('canonical ABI: purchaseDeityPass(address,uint8,bytes32) carries referrals', () => {
    assert.ok(
      SRC.includes('function purchaseDeityPass(address buyer, uint8 symbolId, bytes32 affiliateCode) external payable'),
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
