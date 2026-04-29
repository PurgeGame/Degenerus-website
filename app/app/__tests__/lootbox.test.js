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
    const code = lootboxMod.readAffiliateCode(11155111, CONNECTED);
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('persistAffiliateCodeFromUrl with valid ?ref= writes localStorage and returns true', () => {
    globalThis.location = { href: `http://localhost/?ref=${VALID_BYTES32}` };
    const ok = lootboxMod.persistAffiliateCodeFromUrl(11155111, CONNECTED);
    assert.equal(ok, true);
    const stored = globalThis.localStorage.getItem(`affiliate-code:11155111:${CONNECTED.toLowerCase()}`);
    assert.equal(stored, VALID_BYTES32);
  });

  test('persistAffiliateCodeFromUrl with invalid ?ref= (too short) returns false and does NOT write', () => {
    globalThis.location = { href: 'http://localhost/?ref=0xabc' };
    const ok = lootboxMod.persistAffiliateCodeFromUrl(11155111, CONNECTED);
    assert.equal(ok, false);
    const stored = globalThis.localStorage.getItem(`affiliate-code:11155111:${CONNECTED.toLowerCase()}`);
    assert.equal(stored, null);
  });

  test('persistAffiliateCodeFromUrl with no ?ref= param returns false', () => {
    globalThis.location = { href: 'http://localhost/' };
    const ok = lootboxMod.persistAffiliateCodeFromUrl(11155111, CONNECTED);
    assert.equal(ok, false);
  });

  test('readAffiliateCode roundtrips persisted bytes32 hex', () => {
    globalThis.location = { href: `http://localhost/?ref=${VALID_BYTES32}` };
    lootboxMod.persistAffiliateCodeFromUrl(11155111, CONNECTED);
    const code = lootboxMod.readAffiliateCode(11155111, CONNECTED);
    assert.equal(code, VALID_BYTES32);
  });

  test('purchaseEth auto-reads localStorage affiliate code into args[3]', async () => {
    // Pre-populate localStorage with a valid affiliate code (simulates URL ?ref=
    // having been persisted on a prior visit).
    globalThis.localStorage.setItem(
      `affiliate-code:11155111:${CONNECTED.toLowerCase()}`,
      VALID_BYTES32
    );
    await lootboxMod.purchaseEth({ ticketQuantity: 1, lootboxQuantity: 1 });
    const [args] = fakeContract._calls.purchase;
    assert.equal(args[3], VALID_BYTES32, 'purchase received persisted affiliate code');
  });

  test('purchaseEth uses ZeroHash when localStorage empty', async () => {
    await lootboxMod.purchaseEth({ ticketQuantity: 1, lootboxQuantity: 1 });
    const [args] = fakeContract._calls.purchase;
    assert.equal(args[3], '0x0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('persistAffiliateCodeFromUrl: localStorage.setItem throw does NOT crash (Pitfall F)', () => {
    globalThis.location = { href: `http://localhost/?ref=${VALID_BYTES32}` };
    // Replace setItem with one that throws (quota simulation)
    const orig = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    let result;
    assert.doesNotThrow(() => { result = lootboxMod.persistAffiliateCodeFromUrl(11155111, CONNECTED); });
    assert.equal(result, false);
    globalThis.localStorage.setItem = orig;  // restore for test isolation
  });

  test('readAffiliateCode: localStorage.getItem throw does NOT crash (Pitfall F)', () => {
    const orig = globalThis.localStorage.getItem.bind(globalThis.localStorage);
    globalThis.localStorage.getItem = () => { throw new Error('SecurityError'); };
    let code;
    assert.doesNotThrow(() => { code = lootboxMod.readAffiliateCode(11155111, CONNECTED); });
    assert.equal(code, '0x0000000000000000000000000000000000000000000000000000000000000000', 'falls back to ZeroHash');
    globalThis.localStorage.getItem = orig;
  });

  test('readAffiliateCode rejects malformed localStorage value (e.g. truncated hex)', () => {
    globalThis.localStorage.setItem(
      `affiliate-code:11155111:${CONNECTED.toLowerCase()}`,
      '0xdeadbeef'  // valid hex but only 8 chars — fails 64-char regex
    );
    const code = lootboxMod.readAffiliateCode(11155111, CONNECTED);
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
// gracefully or fails open; lootboxQuantity=0 produces value=0n; BURNIE path
// routes to purchaseCoin.populateTransaction.
// ===========================================================================

/**
 * Builds a fake contract that implements the v6 method-attached populateTransaction
 * form: contract.purchase.populateTransaction(args) returns a Promise<unsignedTx>.
 * Same shape for purchaseCoin. Records calls for assertions.
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
    getNetwork: async () => ({ chainId: 11155111n }),
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
      ticketQuantity: 1, lootboxQuantity: 1, payKind: 'ETH',
    });
    assert.equal(typeof result.buildTx, 'function', 'buildTx is a function');
    assert.equal(typeof result.abort, 'function', 'abort is a function');
    assert.equal(typeof result.expiresAt, 'number', 'expiresAt is a number');
  });

  test('expiresAt is in the future and within 30s TTL', async () => {
    const before = Date.now();
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1, payKind: 'ETH',
    });
    const after = Date.now();
    assert.ok(result.expiresAt > before, 'expiresAt > before');
    // Allow a small wall-clock slack (after - before may be a few ms).
    assert.ok(result.expiresAt - before <= 30_000 + 50, 'expiresAt within 30s + slack of pre-warm start');
    assert.ok(result.expiresAt - after <= 30_000, 'expiresAt within 30s of pre-warm end');
  });

  test('uses ethers v6 method-attached populateTransaction form for ETH', async () => {
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 5, lootboxQuantity: 1, payKind: 'ETH',
    });
    assert.equal(fakeContract._calls.purchasePopulate.length, 1, 'purchase.populateTransaction called once');
    const { args, txOverrides } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[0], CONNECTED, 'buyer is connected.address (lowercase)');
    assert.equal(args[1], 500n, 'ticketQuantity * 100 (NatSpec scaling)');
    assert.ok(args[2] > 0n, 'lootBoxAmount > 0 (default LOOTBOX_MIN_WEI × 1)');
    assert.equal(args[4], 0, 'payKind = MintPaymentKind.DirectEth (0)');
    assert.ok(txOverrides && txOverrides.value > 0n, '{value: lootBoxAmountWei} override');
  });

  test('buildTx calls signer.sendTransaction synchronously (no await) inside the click frame', async () => {
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1, payKind: 'ETH',
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
        ticketQuantity: 1, lootboxQuantity: 1, payKind: 'ETH',
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
        ticketQuantity: 1, lootboxQuantity: 1, payKind: 'ETH',
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
      ticketQuantity: 0, lootboxQuantity: 1, payKind: 'ETH',
    });
    result.abort();
    assert.throws(() => result.buildTx(), /Pre-warm stale/, 'aborted buildTx throws synchronously');
    assert.equal(fakeSigner._calls.sendTransaction.length, 0,
      'sendTransaction NOT called after abort');
  });

  test('estimateGas success: gasLimit attached to populated tx', async () => {
    fakeSigner.estimateGas = async (_tx) => 42_000n;
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1, payKind: 'ETH',
    });
    result.buildTx();
    const sentTx = fakeSigner._calls.sendTransaction[0].tx;
    assert.equal(sentTx.gasLimit, 42_000n, 'gasLimit attached from estimateGas');
  });

  test('estimateGas rejection: pre-warm still resolves; gasLimit undefined (graceful fallback)', async () => {
    fakeSigner = makeFakePrewarmSigner({ estimateGasShouldReject: true });
    fakeProvider = makeFakePrewarmProvider(fakeSigner);
    contractsMod.setProvider(fakeProvider);
    const result = await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1, payKind: 'ETH',
    });
    assert.equal(typeof result.buildTx, 'function', 'pre-warm resolves despite estimateGas rejection');
    result.buildTx();
    const sentTx = fakeSigner._calls.sendTransaction[0].tx;
    assert.equal(sentTx.gasLimit, undefined,
      'gasLimit undefined → signer.sendTransaction will re-estimate internally');
  });

  test('lootboxQuantity=0 + ticketQuantity=1: lootBoxAmountWei=0n is acceptable {value:0n}', async () => {
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 1, lootboxQuantity: 0, payKind: 'ETH',
    });
    const { args, txOverrides } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[2], 0n, 'lootBoxAmount = LOOTBOX_MIN_WEI * 0 = 0n');
    assert.equal(txOverrides.value, 0n, 'value override = 0n (tickets-only purchase)');
  });

  test('BURNIE pay-kind routes to purchaseCoin.populateTransaction (no value, no affiliate)', async () => {
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 2, lootboxQuantity: 3, payKind: 'BURNIE',
    });
    assert.equal(fakeContract._calls.purchaseCoinPopulate.length, 1,
      'purchaseCoin.populateTransaction called once');
    assert.equal(fakeContract._calls.purchasePopulate.length, 0,
      'purchase.populateTransaction NOT called for BURNIE');
    const { args } = fakeContract._calls.purchaseCoinPopulate[0];
    // purchaseCoin signature: (buyer, ticketQuantity*100, burnieAmount) — 3 args, no affiliate.
    assert.equal(args.length, 3, 'purchaseCoin takes 3 args (no affiliate, no overrides for non-payable)');
    assert.equal(args[0], CONNECTED);
    assert.equal(args[1], 200n, 'ticketQuantity * 100');
    assert.equal(args[2], lootboxMod.BURNIE_LOOTBOX_MIN_WEI * 3n, 'BURNIE_LOOTBOX_MIN_WEI × 3');
    assert.equal(fakeContract._calls.purchaseCoinStaticCall.length, 1,
      'purchaseCoin static-call also runs at pre-warm time');
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
      ticketQuantity: 0, lootboxQuantity: 1, payKind: 'ETH',
    });
    const { args } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[3], '0x0000000000000000000000000000000000000000000000000000000000000000',
      'ZeroHash affiliate default');
  });

  test('explicit args.affiliateCode overrides readAffiliateCode default', async () => {
    const explicit = '0x' + 'aa'.repeat(32);
    await lootboxMod.prewarmLootboxBuy({
      ticketQuantity: 0, lootboxQuantity: 1, payKind: 'ETH', affiliateCode: explicit,
    });
    const { args } = fakeContract._calls.purchasePopulate[0];
    assert.equal(args[3], explicit, 'explicit affiliateCode used verbatim');
  });
});
