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
    affiliateCode: [],
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
    affiliateCode: async (...args) => {
      calls.affiliateCode.push(args);
      return [
        opts.affiliateOwner || '0x0000000000000000000000000000000000000000',
        opts.affiliateKickback || 0,
      ];
    },
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
// First-purchase referral field encoding + validation.
// ===========================================================================

describe('purchase affiliate input helpers', () => {
  afterEach(() => {
    affiliateMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('normalizes blank, address, full bytes32, and vanity input', () => {
    const address = '0x' + 'b'.repeat(40);
    const padded = '0x' + '0'.repeat(24) + 'b'.repeat(40);
    assert.equal(affiliateMod.normalizePurchaseAffiliateCode(''), '0x' + '0'.repeat(64));
    assert.equal(affiliateMod.normalizePurchaseAffiliateCode(address), padded);
    assert.equal(affiliateMod.normalizePurchaseAffiliateCode(padded.toUpperCase().replace('0X', '0x')), padded);
    const vanity = affiliateMod.normalizePurchaseAffiliateCode('degen');
    assert.match(vanity, /^0x[0-9a-f]{64}$/i);
    assert.equal(affiliateMod.formatPurchaseAffiliateCode(vanity), 'DEGEN');
    assert.equal(affiliateMod.formatPurchaseAffiliateCode(padded), address);
  });

  test('rejects malformed purchase input before any transaction', () => {
    assert.throws(
      () => affiliateMod.normalizePurchaseAffiliateCode('not a valid code'),
      /3-31|address|bytes32/i,
    );
  });

  test('address referrals validate without an RPC and self-referrals are rejected', async () => {
    const other = '0x' + 'b'.repeat(40);
    const expected = '0x' + '0'.repeat(24) + 'b'.repeat(40);
    assert.equal(
      await affiliateMod.validatePurchaseAffiliateCode(other, CONNECTED),
      expected,
    );
    await assert.rejects(
      affiliateMod.validatePurchaseAffiliateCode(CONNECTED, CONNECTED),
      /own affiliate code/i,
    );
  });

  test('registered vanity codes resolve on-chain; unknown codes are rejected', async () => {
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const owner = '0x' + 'b'.repeat(40);
    const valid = makeFakeContract({ affiliateOwner: owner });
    affiliateMod.__setContractFactoryForTest(() => valid);
    const code = await affiliateMod.validatePurchaseAffiliateCode('DEGEN', CONNECTED);
    assert.equal(code, affiliateMod.normalizePurchaseAffiliateCode('DEGEN'));
    assert.equal(valid._calls.affiliateCode.length, 1, 'vanity ownership checked once');

    affiliateMod.__setContractFactoryForTest(() => makeFakeContract());
    await assert.rejects(
      affiliateMod.validatePurchaseAffiliateCode('UNKNOWN', CONNECTED),
      /not registered/i,
    );
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
    const key = `affiliate-code:84532:${CONNECTED.toLowerCase()}`;
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

// ===========================================================================
// Own registered code — readRegisteredCode (sync local) +
// resolveRegisteredCode (DB-first, chain-verified fallback).
// Semantics fixed 2026-07-16: affiliate-code:{chain}:{addr} = OWN code only;
// legacy values may still be an incoming referral (old dual-write), hence
// the on-chain ownership check on the localStorage path.
// ===========================================================================

const { CHAIN } = await import('../chain-config.js');

describe('own registered code: readRegisteredCode + resolveRegisteredCode', () => {
  const addr = CONNECTED.toLowerCase();
  const key = `affiliate-code:${CHAIN.id}:${addr}`;
  const vanity = contractsMod.ethers.encodeBytes32String('SHARK');

  beforeEach(() => {
    globalThis.localStorage = {
      _m: new Map(),
      getItem(k) { return this._m.get(k) ?? null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); },
      clear() { this._m.clear(); },
    };
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    // Default: indexer unreachable → tests exercise the localStorage
    // fallback unless they install their own fetch.
    affiliateMod.__setFetchJSONForTest(async () => { throw new Error('indexer down'); });
  });
  afterEach(() => {
    affiliateMod.__resetContractFactoryForTest();
    affiliateMod.__setFetchJSONForTest(null);
    contractsMod.clearProvider();
  });

  test('readRegisteredCode: vanity value → returned; address-range / junk / absent → null', () => {
    localStorage.setItem(key, vanity);
    assert.equal(affiliateMod.readRegisteredCode(CONNECTED), vanity);
    localStorage.setItem(key, '0x' + '0'.repeat(24) + addr.slice(2)); // default code
    assert.equal(affiliateMod.readRegisteredCode(CONNECTED), null);
    localStorage.setItem(key, '0xdeadbeef');
    assert.equal(affiliateMod.readRegisteredCode(CONNECTED), null);
    localStorage.clear();
    assert.equal(affiliateMod.readRegisteredCode(CONNECTED), null);
  });

  test('DB ownCode wins — no localStorage, no provider, no RPC needed', async () => {
    contractsMod.clearProvider();
    affiliateMod.__setFetchJSONForTest(async (path) => {
      assert.equal(path, `/player/${addr}`);
      return { affiliate: { ownCode: vanity } };
    });
    affiliateMod.__setContractFactoryForTest(() => ({
      affiliateCode: async () => { throw new Error('must not be called'); },
    }));
    assert.equal(await affiliateMod.resolveRegisteredCode(CONNECTED), vanity);
  });

  test('DB says no code / junk code → falls through to verified localStorage', async () => {
    affiliateMod.__setFetchJSONForTest(async () => ({ affiliate: { ownCode: null } }));
    localStorage.setItem(key, vanity);
    affiliateMod.__setContractFactoryForTest(() => ({
      affiliateCode: async (code) => {
        assert.equal(code, vanity);
        return { owner: CONNECTED, kickback: 5 };
      },
    }));
    assert.equal(await affiliateMod.resolveRegisteredCode(CONNECTED), vanity, 'DB null → localStorage path');

    // Address-range ownCode (a default code, not a vanity registration) is junk too.
    affiliateMod.__setFetchJSONForTest(async () => (
      { affiliate: { ownCode: '0x' + '0'.repeat(24) + addr.slice(2) } }
    ));
    assert.equal(await affiliateMod.resolveRegisteredCode(CONNECTED), vanity, 'address-range ownCode rejected');
  });

  test('legacy stored code owned by someone else (old dual-write) → null', async () => {
    localStorage.setItem(key, vanity);
    affiliateMod.__setContractFactoryForTest(() => ({
      affiliateCode: async () => ({ owner: '0x1111111111111111111111111111111111111111', kickback: 0 }),
    }));
    assert.equal(await affiliateMod.resolveRegisteredCode(CONNECTED), null);
  });

  test('nothing stored / no provider / RPC error → null', async () => {
    assert.equal(await affiliateMod.resolveRegisteredCode(CONNECTED), null, 'nothing stored');
    localStorage.setItem(key, vanity);
    contractsMod.clearProvider();
    assert.equal(await affiliateMod.resolveRegisteredCode(CONNECTED), null, 'no provider');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    affiliateMod.__setContractFactoryForTest(() => ({
      affiliateCode: async () => { throw new Error('rpc down'); },
    }));
    assert.equal(await affiliateMod.resolveRegisteredCode(CONNECTED), null, 'RPC error');
  });
});
