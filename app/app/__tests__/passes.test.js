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
    purchaseWhaleBundle: [],
    purchaseDeityPass: [],
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
    purchaseWhaleBundle: Object.assign(
      async (...args) => {
        calls.purchaseWhaleBundle.push(args);
        return sendTxStub('purchaseWhaleBundle')(...args);
      },
      { staticCall: staticCallStub('purchaseWhaleBundle') }
    ),
    purchaseDeityPass: Object.assign(
      async (...args) => {
        calls.purchaseDeityPass.push(args);
        return sendTxStub('purchaseDeityPass')(...args);
      },
      { staticCall: staticCallStub('purchaseDeityPass') }
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
  };
  return c;
}

function makeFakeProvider(connectedAddr) {
  return {
    getNetwork: async () => ({ chainId: 11155111n }),
    getSigner: async () => ({
      getAddress: async () => connectedAddr,
    }),
  };
}

const CONNECTED = '0xab12000000000000000000000000000000000000';

// ===========================================================================
// Reason-map registrations — Plan 62-02 registers ONLY RngLocked.
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

  test('invokes purchaseWhaleBundle(buyer, qty) with closure-form sendTx + msg.value', async () => {
    const value = 12n * 10n ** 18n;
    await passesMod.purchaseWhaleBundle({ quantity: 5, msgValueWei: value });
    assert.equal(lastFakeContract._calls.purchaseWhaleBundle.length, 1);
    const [args] = lastFakeContract._calls.purchaseWhaleBundle;
    assert.equal(args[0], CONNECTED, 'buyer = connected.address');
    assert.equal(args[1], 5n, 'quantity arg = BigInt 5n');
    // 3rd arg = overrides object containing value
    assert.ok(args[2] && typeof args[2] === 'object', 'overrides object passed');
    assert.equal(args[2].value, value, 'msg.value matches msgValueWei');
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
      staticCallShouldRevert: { purchaseWhaleBundle: true },
      staticCallRevertName: { purchaseWhaleBundle: 'E' },
    });
    passesMod.__setContractFactoryForTest(() => reverting);
    await assert.rejects(
      passesMod.purchaseWhaleBundle({ quantity: 1, msgValueWei: 0n }),
    );
    assert.equal(
      reverting._calls.purchaseWhaleBundle.length, 0,
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

  test('canonical ABI: purchaseWhaleBundle(address buyer, uint256 quantity) external payable', () => {
    assert.ok(
      SRC.includes('function purchaseWhaleBundle(address buyer, uint256 quantity) external payable'),
      'canonical PASSES_ABI fragment present',
    );
  });

  test('canonical ABI: purchaseDeityPass(address buyer, uint8 symbolId) external payable', () => {
    assert.ok(
      SRC.includes('function purchaseDeityPass(address buyer, uint8 symbolId) external payable'),
      'canonical PASSES_ABI fragment present',
    );
  });

  test('reason-map registers EXACTLY 1 NEW code (RngLocked)', () => {
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const registers = stripped.match(/register\s*\(/g) || [];
    assert.equal(registers.length, 1, `exactly 1 register call expected, got ${registers.length}`);
    assert.ok(
      /register\(\s*['"]RngLocked['"]/.test(stripped),
      'RngLocked must be registered',
    );
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
