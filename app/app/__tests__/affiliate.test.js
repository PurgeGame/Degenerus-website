// /app/app/__tests__/affiliate.test.js — Phase 62 Plan 62-06 (AFF-01).
//
// Run: cd website && node --test app/app/__tests__/affiliate.test.js
//
// Coverage strategy: drive the full chain end-to-end with a fake contract
// injected at the affiliate.js layer via __setContractFactoryForTest (Phase 60
// lootbox.test.js / Phase 61 claims.test.js pattern, ported verbatim).
//
// RESEARCH Pitfall 5: defaultCodeForAddress MUST LEFT-pad to 32 bytes — RIGHT-pad
// fails the contract's BigInt(code) <= type(uint160).max check at
// Affiliate.sol:711-712. Critical correctness assertion.
//
// RESEARCH R7 + Pitfall 8: Plan 62-06 registers EXACTLY 3 NEW codes (Zero,
// Insufficient, InvalidKickback). The Insufficient registration is
// CONTEXT-BOUNDED to the createAffiliateCode/Customize-CTA path because the
// underlying error code is reused across multiple paths in Affiliate.sol.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as affiliateMod from '../affiliate.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import * as reasonMapMod from '../reason-map.js';

// ---------------------------------------------------------------------------
// Fake provider/signer/contract harness — port of claims.test.js pattern.
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) {
  return { status: 1, hash: '0xreceipt-hash', logs: logs || [] };
}
function makeFakeTx(receipt) {
  return { hash: '0xtx-hash', wait: async () => receipt };
}

function makeFakeContract(opts = {}) {
  const calls = {
    createAffiliateCode: [],
  };
  const staticCallStub = (methodName) => async (..._args) => {
    if (opts.staticCallShouldRevert?.[methodName]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[methodName] || 'Insufficient' };
      throw err;
    }
    return undefined;
  };
  const sendTxStub = (methodName) => async (..._args) => {
    if (opts.sendTxShouldRevert?.[methodName]) {
      const err = new Error('sendTx revert');
      err.revert = { name: opts.sendTxRevertName?.[methodName] || 'Insufficient' };
      throw err;
    }
    return makeFakeTx(makeFakeReceipt());
  };

  const c = {
    createAffiliateCode: Object.assign(
      async (...args) => {
        calls.createAffiliateCode.push(args);
        return sendTxStub('createAffiliateCode')(...args);
      },
      { staticCall: staticCallStub('createAffiliateCode') }
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
// defaultCodeForAddress — Pitfall 5 LEFT-pad correctness.
// ===========================================================================

describe('Plan 62-06: defaultCodeForAddress (Pitfall 5 — LEFT-pad)', () => {
  test('LEFT-pads to 32 bytes (Pitfall 5 critical)', () => {
    const addr = '0x' + 'a'.repeat(40);
    const expected = '0x' + '0'.repeat(24) + 'a'.repeat(40);
    assert.equal(affiliateMod.defaultCodeForAddress(addr), expected);
    // RIGHT-pad would be '0x' + 'a'.repeat(40) + '0'.repeat(24) — explicitly NOT this.
    const wrongRightPad = '0x' + 'a'.repeat(40) + '0'.repeat(24);
    assert.notEqual(affiliateMod.defaultCodeForAddress(addr), wrongRightPad);
    // Length === 66 (= 0x + 64 hex chars).
    assert.equal(affiliateMod.defaultCodeForAddress(addr).length, 66);
  });

  test('lowercases the input', () => {
    const upper = '0xABCDEF0123456789012345678901234567890123';
    const expected = '0x' + '0'.repeat(24) + 'abcdef0123456789012345678901234567890123';
    assert.equal(affiliateMod.defaultCodeForAddress(upper), expected);
  });

  test('satisfies the contract uint160 max check at Affiliate.sol:711-712', () => {
    // BigInt(code) MUST be <= type(uint160).max = 2**160 - 1.
    const maxAddr = '0x' + 'f'.repeat(40);
    const code = affiliateMod.defaultCodeForAddress(maxAddr);
    const codeBI = BigInt(code);
    const uint160Max = (1n << 160n) - 1n;
    assert.ok(codeBI <= uint160Max, `BigInt(code)=${codeBI} must be <= uint160 max=${uint160Max}`);
    // And LEFT-pad gives exactly 2**160 - 1 for the all-Fs address.
    assert.equal(codeBI, uint160Max);
  });
});

// ===========================================================================
// buildAffiliateUrl
// ===========================================================================

describe('Plan 62-06: buildAffiliateUrl', () => {
  test('uses default code when no registeredCode', () => {
    const addr = '0x' + 'a'.repeat(40);
    const url = affiliateMod.buildAffiliateUrl(addr);
    const expectedCode = '0x' + '0'.repeat(24) + 'a'.repeat(40);
    assert.equal(url, `https://purgegame.com/app/?ref=${expectedCode}`);
  });

  test('uses registeredCode when provided', () => {
    const addr = '0x' + 'a'.repeat(40);
    const vanity = '0x' + '4445474500000000000000000000000000000000000000000000000000000000'.slice(2);
    const url = affiliateMod.buildAffiliateUrl(addr, vanity);
    assert.equal(url, `https://purgegame.com/app/?ref=${vanity}`);
  });
});

// ===========================================================================
// createAffiliateCode — closure form + validation + localStorage persistence.
// ===========================================================================

describe('Plan 62-06: createAffiliateCode', () => {
  let lastFakeContract;
  let storedKeys;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    affiliateMod.__setContractFactoryForTest(() => lastFakeContract);
    // Stub localStorage to capture writes.
    storedKeys = new Map();
    globalThis.localStorage = {
      _m: storedKeys,
      getItem(k) { return storedKeys.get(k) ?? null; },
      setItem(k, v) { storedKeys.set(k, String(v)); },
      removeItem(k) { storedKeys.delete(k); },
      clear() { storedKeys.clear(); },
    };
  });

  afterEach(() => {
    affiliateMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes contract.createAffiliateCode with bytes32-encoded code + pct (closure form via sendTx)', async () => {
    await affiliateMod.createAffiliateCode({ codeStr: 'DEGEN', kickbackPct: 10 });
    assert.equal(lastFakeContract._calls.createAffiliateCode.length, 1);
    const [args] = lastFakeContract._calls.createAffiliateCode;
    // bytes32 encoding of 'DEGEN' (uppercase) — first 5 bytes are 'DEGEN' ASCII, rest zero.
    // Per ethers.encodeBytes32String — DEGEN = 0x4445_47454e_00...0
    assert.equal(typeof args[0], 'string', 'first arg is bytes32 hex string');
    assert.ok(/^0x[0-9a-f]{64}$/i.test(args[0]), 'first arg is 32-byte hex');
    // bytes32 ASCII prefix: D=0x44 E=0x45 G=0x47 E=0x45 N=0x4E (uppercase DEGEN).
    // First 5 bytes (10 hex chars) after the 0x prefix.
    assert.equal(
      args[0].slice(0, 12).toUpperCase(),
      '0X444547454E',
      'first 5 bytes are "DEGEN" ASCII (uppercased)',
    );
    assert.equal(args[1], 10, 'second arg = kickbackPct (10)');
  });

  test('rejects invalid codeStr — too short', async () => {
    await assert.rejects(
      affiliateMod.createAffiliateCode({ codeStr: 'AB', kickbackPct: 0 }),
      /3-31|alphanumeric|invalid/i,
    );
  });

  test('rejects invalid codeStr — has space', async () => {
    await assert.rejects(
      affiliateMod.createAffiliateCode({ codeStr: 'has space', kickbackPct: 0 }),
      /3-31|alphanumeric|invalid/i,
    );
  });

  test('rejects kickbackPct out of range (-1)', async () => {
    await assert.rejects(
      affiliateMod.createAffiliateCode({ codeStr: 'DEGEN', kickbackPct: -1 }),
      /Kickback|0.*25|range/i,
    );
  });

  test('rejects kickbackPct out of range (26)', async () => {
    await assert.rejects(
      affiliateMod.createAffiliateCode({ codeStr: 'DEGEN', kickbackPct: 26 }),
      /Kickback|0.*25|range/i,
    );
  });

  test('persists registered code to localStorage on confirm (Phase 60 D-05 mechanism)', async () => {
    const result = await affiliateMod.createAffiliateCode({ codeStr: 'DEGEN', kickbackPct: 10 });
    // Phase 60 D-05 key format: `affiliate-code:${CHAIN.id}:${addr.toLowerCase()}`.
    const key = `affiliate-code:11155111:${CONNECTED.toLowerCase()}`;
    const stored = storedKeys.get(key);
    assert.ok(stored, `localStorage[${key}] was set`);
    assert.equal(stored, result.encodedCode, 'stored value === encoded code returned');
    assert.ok(/^0x[0-9a-f]{64}$/i.test(stored), 'stored value is bytes32 hex');
  });

  test('throws Wallet not connected when no address available', async () => {
    storeMod.update('connected.address', null);
    contractsMod.clearProvider();
    await assert.rejects(
      affiliateMod.createAffiliateCode({ codeStr: 'DEGEN', kickbackPct: 0 }),
      /Wallet not connected/i,
    );
  });

  test('static-call gate runs BEFORE sendTx; gate failure throws structured revert error', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { createAffiliateCode: true },
      staticCallRevertName: { createAffiliateCode: 'Insufficient' },
    });
    affiliateMod.__setContractFactoryForTest(() => reverting);
    let caught = null;
    try {
      await affiliateMod.createAffiliateCode({ codeStr: 'DEGEN', kickbackPct: 0 });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'createAffiliateCode threw');
    assert.equal(caught.code, 'Insufficient');
    assert.ok(caught.userMessage && caught.userMessage.length > 0);
    assert.ok(/already taken|different/i.test(caught.userMessage), 'Customize-context userMessage');
    // sendTx NOT invoked when static-call gate trips.
    assert.equal(reverting._calls.createAffiliateCode.length, 0, 'sendTx skipped when gate trips');
  });
});

// ===========================================================================
// Reason-map registrations — Plan 62-06's 3 NEW codes.
// ===========================================================================

describe('Plan 62-06: affiliate.js reason-map registrations', () => {
  test('registers Zero with friendly userMessage', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'Zero' },
    });
    assert.equal(decoded.code, 'Zero');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /reserved|invalid|3-31/i);
  });

  test('registers Insufficient with Customize-CTA-context userMessage (Pitfall 8)', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'Insufficient' },
    });
    assert.equal(decoded.code, 'Insufficient');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /already taken|different/i, 'context-bounded copy');
  });

  test('registers InvalidKickback with friendly userMessage', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'InvalidKickback' },
    });
    assert.equal(decoded.code, 'InvalidKickback');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /Kickback|0.*25|25/i);
  });
});

// ===========================================================================
// Source-level invariants — closure-form gate, ABI canonical, register count.
// ===========================================================================

describe('Plan 62-06: affiliate.js source-level invariants', () => {
  const SRC = readFileSync(new URL('../affiliate.js', import.meta.url), 'utf8');

  test('uses closure-form sendTx — typeof arg[0] is function', () => {
    const matches = SRC.match(/sendTx\(\s*\(s\)\s*=>/g) || [];
    assert.ok(matches.length >= 1, `expected >= 1 closure-form sendTx, got ${matches.length}`);
  });

  test('action label `Register affiliate code` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Register affiliate code'"), 'literal action label present');
  });

  test('canonical ABI: createAffiliateCode(bytes32 code_, uint8 kickbackPct)', () => {
    assert.ok(
      SRC.includes('function createAffiliateCode(bytes32 code_, uint8 kickbackPct) external'),
      'canonical AFFILIATE_ABI fragment present',
    );
  });

  test('reason-map registers EXACTLY 3 NEW codes (Zero, Insufficient, InvalidKickback)', () => {
    const registers = SRC.match(/register\(/g) || [];
    assert.equal(registers.length, 3, `exactly 3 register() calls; got ${registers.length}`);
    assert.ok(/register\('Zero'/.test(SRC), 'register Zero');
    assert.ok(/register\('Insufficient'/.test(SRC), 'register Insufficient');
    assert.ok(/register\('InvalidKickback'/.test(SRC), 'register InvalidKickback');
    // Negative — these belong to other phases / paths.
    assert.equal(/register\('Taken'/.test(SRC), false, 'no Taken (Phase 56 baseline)');
    assert.equal(/register\('InvalidToken'/.test(SRC), false, 'no InvalidToken');
  });

  test('Insufficient registration documents context-bounded scope (Pitfall 8)', () => {
    assert.match(
      SRC,
      /CONTEXT-BOUNDED|Pitfall 8|context-bounded/i,
      'Insufficient registration includes a context-bounded inline comment per Pitfall 8',
    );
  });

  test('localStorage persistence key format: affiliate-code:${CHAIN.id}:${addr}', () => {
    assert.match(SRC, /affiliate-code:/, 'localStorage key prefix present');
  });

  test('uses ethers.zeroPadValue (LEFT-pad — Pitfall 5 enforcement)', () => {
    assert.match(SRC, /zeroPadValue/, 'ethers.zeroPadValue used for LEFT-pad');
  });

  test('exports defaultCodeForAddress, buildAffiliateUrl, createAffiliateCode', () => {
    assert.match(SRC, /export\s+function\s+defaultCodeForAddress/, 'defaultCodeForAddress exported');
    assert.match(SRC, /export\s+function\s+buildAffiliateUrl/, 'buildAffiliateUrl exported');
    assert.match(SRC, /export\s+async\s+function\s+createAffiliateCode/, 'createAffiliateCode exported (async)');
  });
});
