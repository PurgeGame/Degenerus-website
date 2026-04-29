// /app/app/__tests__/claims.test.js — Phase 61 Plan 61-02 (CLM-03).
//
// Run: cd website && node --test app/app/__tests__/claims.test.js
//
// Coverage strategy: drive the full chain end-to-end with a fake contract injected
// at the claims.js layer via __setContractFactoryForTest (Phase 60 lootbox.test.js
// pattern, ported verbatim). Tests assert observable outcomes:
//   - claimEth / claimBurnie / claimDecimatorLevels invoke the closure-form sendTx
//     with the correct method args.
//   - Static-call gate runs BEFORE sendTx (Pitfall 9 + Pitfall 15 mitigation).
//   - Static-call revert throws structured error with .userMessage / .code / .cause.
//   - claimBurnie sources amount from /pending (NOT the /beta address-cast trick).
//   - claimDecimatorLevels fires N sequential txes; aborts subsequent levels on revert.
//   - claimDecimatorLevels emits onProgress before/after each tx.
//   - Reason-map registers EXACTLY 3 NEW codes (DecClaimInactive, DecAlreadyClaimed,
//     DecNotWinner) — does NOT register `NotClaimable` (Pitfall 10 corrective).
//   - Module source contains NO `await sleep(...)` between decimator txes
//     (RESEARCH.md correction over CONTEXT.md).
//
// Phase 56 (static-call) and Phase 58 (sendTx + requireSelf + chain-assert) primitives
// run for real — only the contract construction is mocked.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as claimsMod from '../claims.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import * as reasonMapMod from '../reason-map.js';

// ---------------------------------------------------------------------------
// Fake provider/signer/contract harness — verbatim port of lootbox.test.js
// pattern at lines 24-104. Tests are leaf nodes — no cross-imports.
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) {
  return { status: 1, hash: '0xreceipt-hash', logs: logs || [] };
}

function makeFakeTx(receipt) {
  return { hash: '0xtx-hash', wait: async () => receipt };
}

/**
 * Builds a fake ethers Contract whose method handlers record their call args
 * and return fake transactions. Mirrors lootbox.test.js makeFakeContract shape.
 */
function makeFakeContract(opts = {}) {
  const calls = {
    claimWinnings: [],
    claimCoinflips: [],
    claimDecimatorJackpot: [],
  };
  const staticCallStub = (methodName) => async (..._args) => {
    if (opts.staticCallShouldRevert?.[methodName]) {
      // Allow per-call sequencing for sequential decimator tests
      const idx = (opts._staticCallIndex?.[methodName] ?? 0);
      const stack = opts.staticCallShouldRevert[methodName];
      const trip = Array.isArray(stack) ? stack[idx] : stack;
      if (opts._staticCallIndex) opts._staticCallIndex[methodName] = idx + 1;
      if (trip) {
        const err = new Error('static-call revert');
        const nameStack = opts.staticCallRevertName?.[methodName];
        err.revert = {
          name: Array.isArray(nameStack)
            ? nameStack[idx] || 'DecClaimInactive'
            : (nameStack || 'DecClaimInactive'),
        };
        throw err;
      }
    }
    return undefined;
  };
  const sendTxStub = (methodName) => async (..._args) => {
    if (opts.sendTxShouldRevert?.[methodName]) {
      const idx = (opts._sendTxIndex?.[methodName] ?? 0);
      const stack = opts.sendTxShouldRevert[methodName];
      const trip = Array.isArray(stack) ? stack[idx] : stack;
      if (opts._sendTxIndex) opts._sendTxIndex[methodName] = idx + 1;
      if (trip) {
        const err = new Error('sendTx revert');
        const nameStack = opts.sendTxRevertName?.[methodName];
        err.revert = {
          name: Array.isArray(nameStack)
            ? nameStack[idx] || 'DecAlreadyClaimed'
            : (nameStack || 'DecAlreadyClaimed'),
        };
        throw err;
      }
    }
    return makeFakeTx(makeFakeReceipt(opts[methodName + 'Logs']));
  };

  const c = {
    claimWinnings: Object.assign(
      async (...args) => {
        calls.claimWinnings.push(args);
        return sendTxStub('claimWinnings')(...args);
      },
      { staticCall: staticCallStub('claimWinnings') }
    ),
    claimCoinflips: Object.assign(
      async (...args) => {
        calls.claimCoinflips.push(args);
        return sendTxStub('claimCoinflips')(...args);
      },
      { staticCall: staticCallStub('claimCoinflips') }
    ),
    claimDecimatorJackpot: Object.assign(
      async (...args) => {
        calls.claimDecimatorJackpot.push(args);
        return sendTxStub('claimDecimatorJackpot')(...args);
      },
      { staticCall: staticCallStub('claimDecimatorJackpot') }
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
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
const OTHER = '0xdef0000000000000000000000000000000000000';

// ===========================================================================
// Reason-map registrations — module-load side-effect.
// Plan 61-02 registers EXACTLY 3 NEW codes; does NOT register `NotClaimable`.
// ===========================================================================

describe('Plan 61-02: claims.js reason-map registrations', () => {
  test('registers DecClaimInactive with friendly userMessage', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'DecClaimInactive' },
    });
    assert.equal(decoded.code, 'DecClaimInactive');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /Decimator/i);
  });

  test('registers DecAlreadyClaimed with friendly userMessage', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'DecAlreadyClaimed' },
    });
    assert.equal(decoded.code, 'DecAlreadyClaimed');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /already claimed/i);
  });

  test('registers DecNotWinner with friendly userMessage', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'DecNotWinner' },
    });
    assert.equal(decoded.code, 'DecNotWinner');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /subbucket|did not win|not.*win/i);
  });

  test('does NOT register `NotClaimable` (Pitfall 10 corrective — does not exist on contract)', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'NotClaimable' },
    });
    // No mapping registered → falls back to UNKNOWN.
    assert.equal(decoded.code, 'UNKNOWN');
  });
});

// ===========================================================================
// claimEth — calls contract.claimWinnings(connected.address).
// ===========================================================================

describe('Plan 61-02: claimEth', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    claimsMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    claimsMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes contract.claimWinnings with connected.address (NOT ZeroAddress) — Pitfall 11', async () => {
    await claimsMod.claimEth();
    assert.equal(lastFakeContract._calls.claimWinnings.length, 1, 'claimWinnings called once');
    const [args] = lastFakeContract._calls.claimWinnings;
    assert.equal(args[0], CONNECTED, 'player arg is connected.address (NOT ZeroAddress per D-05)');
  });

  test('throws Wallet not connected when no address available', async () => {
    storeMod.update('connected.address', null);
    contractsMod.clearProvider();
    await assert.rejects(claimsMod.claimEth(), /Wallet not connected/i);
  });

  test('accepts explicit player arg overriding store', async () => {
    await claimsMod.claimEth({ player: OTHER });
    const [args] = lastFakeContract._calls.claimWinnings;
    assert.equal(args[0], OTHER, 'explicit player arg overrides connected.address');
  });

  test('static-call gate runs BEFORE sendTx (closure form) — order verification', async () => {
    // requireStaticCall → contract.connect(signer).claimWinnings.staticCall(...)
    // Then sendTx → buildTx(signer) which does the real .claimWinnings(...)
    // Both touch the SAME _calls accumulator differently — staticCall does NOT push
    // to .claimWinnings (only the real .claimWinnings(...) call does). The order
    // assertion is implicit: if staticCall trips, sendTx is never invoked, .claimWinnings
    // stays at length 0. The reverse order would not satisfy the gate semantics.
    const reverting = makeFakeContract({
      staticCallShouldRevert: { claimWinnings: true },
      staticCallRevertName: { claimWinnings: 'DecClaimInactive' },
    });
    claimsMod.__setContractFactoryForTest(() => reverting);
    await assert.rejects(claimsMod.claimEth(), /Decimator/i);
    assert.equal(
      reverting._calls.claimWinnings.length, 0,
      'sendTx NOT invoked when static-call gate trips (proves gate runs first)',
    );
  });

  test('static-call gate failure throws structured revert error with userMessage/code/cause', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { claimWinnings: true },
      staticCallRevertName: { claimWinnings: 'DecClaimInactive' },
    });
    claimsMod.__setContractFactoryForTest(() => reverting);
    let caught = null;
    try {
      await claimsMod.claimEth();
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'claimEth threw');
    assert.equal(caught.code, 'DecClaimInactive');
    assert.ok(caught.userMessage && caught.userMessage.length > 0);
    assert.ok(caught.cause, '.cause field present');
  });
});

// ===========================================================================
// claimBurnie — calls contract.claimCoinflips(player, amount) with EXPLICIT amount.
// Pitfall 6: amount sourced from /pending; NEVER address-cast trick.
// ===========================================================================

describe('Plan 61-02: claimBurnie', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    claimsMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    claimsMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes claimCoinflips(player, amount) with explicit BigInt amount', async () => {
    await claimsMod.claimBurnie({ amount: 500n });
    assert.equal(lastFakeContract._calls.claimCoinflips.length, 1);
    const [args] = lastFakeContract._calls.claimCoinflips;
    assert.equal(args[0], CONNECTED, 'player arg = connected.address');
    assert.equal(args[1], 500n, 'amount arg = BigInt 500n');
  });

  test('throws Nothing to claim on amount === 0n', async () => {
    await assert.rejects(claimsMod.claimBurnie({ amount: 0n }), /Nothing to claim/i);
  });

  test('throws Nothing to claim on amount === undefined', async () => {
    await assert.rejects(claimsMod.claimBurnie({ amount: undefined }), /Nothing to claim/i);
  });

  test('accepts amount as string and converts to BigInt', async () => {
    await claimsMod.claimBurnie({ amount: '500' });
    const [args] = lastFakeContract._calls.claimCoinflips;
    assert.equal(typeof args[1], 'bigint', 'amount arg coerced to BigInt');
    assert.equal(args[1], 500n);
  });

  test('does NOT use address-cast trick — second arg is explicit amount, NOT BigInt(player)', async () => {
    await claimsMod.claimBurnie({ amount: 500n });
    const [args] = lastFakeContract._calls.claimCoinflips;
    // The /beta trick passes the player address cast to uint256 as the 2nd arg.
    // Phase 61 must NOT do that — the 2nd arg must be the explicit amount.
    const playerCastUint = BigInt(CONNECTED);
    assert.notEqual(args[1], playerCastUint, 'second arg is NOT BigInt(player) — explicit amount only');
    assert.equal(args[1], 500n);
  });

  test('static-call revert throws structured error', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { claimCoinflips: true },
      staticCallRevertName: { claimCoinflips: 'E' },
    });
    claimsMod.__setContractFactoryForTest(() => reverting);
    let caught = null;
    try {
      await claimsMod.claimBurnie({ amount: 500n });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught);
    assert.equal(caught.code, 'E');
    assert.ok(caught.userMessage);
  });
});

// ===========================================================================
// claimDecimatorLevels — sequential N=1 loop in ascending order.
// D-02 LOCKED. NO sleep between txes (RESEARCH.md correction over CONTEXT.md).
// On revert at level K, abort K+1..N.
// ===========================================================================

describe('Plan 61-02: claimDecimatorLevels', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    claimsMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    claimsMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('fires N sequential txes — levels invoked in passed order (panel pre-sorts ascending)', async () => {
    await claimsMod.claimDecimatorLevels({ levels: [5, 10, 15] });
    assert.equal(lastFakeContract._calls.claimDecimatorJackpot.length, 3);
    assert.equal(lastFakeContract._calls.claimDecimatorJackpot[0][0], 5);
    assert.equal(lastFakeContract._calls.claimDecimatorJackpot[1][0], 10);
    assert.equal(lastFakeContract._calls.claimDecimatorJackpot[2][0], 15);
  });

  test('aborts subsequent levels on static-call revert at level K (partial progress preserved)', async () => {
    const reverting = makeFakeContract({
      // Level 5 ok; level 10 trips static-call gate; level 15 never invoked.
      staticCallShouldRevert: { claimDecimatorJackpot: [false, true, false] },
      staticCallRevertName: { claimDecimatorJackpot: ['', 'DecAlreadyClaimed', ''] },
      _staticCallIndex: { claimDecimatorJackpot: 0 },
    });
    claimsMod.__setContractFactoryForTest(() => reverting);

    await assert.rejects(
      claimsMod.claimDecimatorLevels({ levels: [5, 10, 15] }),
      /already claimed|Decimator/i,
    );
    // Level 5 succeeded; level 10 reverted at static-call gate (sendTx never reached);
    // level 15 never invoked. So real .claimDecimatorJackpot called exactly 1 time.
    assert.equal(
      reverting._calls.claimDecimatorJackpot.length, 1,
      'only level 5 sendTx executed (partial progress preserved)',
    );
  });

  test('emits onProgress before/after each tx (4 calls for 2 levels)', async () => {
    const events = [];
    await claimsMod.claimDecimatorLevels({
      levels: [5, 10],
      onProgress: (p) => events.push({ ...p }),
    });
    assert.ok(events.length >= 4, `expected >= 4 onProgress events, got ${events.length}`);
    // First level pending then confirmed
    assert.deepEqual(
      events.find((e) => e.currentLevel === 5 && e.status === 'pending'),
      { done: 0, total: 2, status: 'pending', currentLevel: 5 },
    );
    assert.deepEqual(
      events.find((e) => e.currentLevel === 5 && e.status === 'confirmed'),
      { done: 1, total: 2, status: 'confirmed', currentLevel: 5 },
    );
    // Second level pending then confirmed
    assert.deepEqual(
      events.find((e) => e.currentLevel === 10 && e.status === 'pending'),
      { done: 1, total: 2, status: 'pending', currentLevel: 10 },
    );
    assert.deepEqual(
      events.find((e) => e.currentLevel === 10 && e.status === 'confirmed'),
      { done: 2, total: 2, status: 'confirmed', currentLevel: 10 },
    );
  });

  test('throws No levels to claim on empty levels array', async () => {
    await assert.rejects(
      claimsMod.claimDecimatorLevels({ levels: [] }),
      /No levels to claim/i,
    );
  });

  test('claims.js source contains NO `await sleep(...)` between decimator txes (RESEARCH.md correction)', () => {
    // Read claims.js source via fs and assert no explicit sleep-between-txes.
    // Phase 60 has no sleep — await tx.wait() inside sendTx is the natural pacing.
    const src = readFileSync(new URL('../claims.js', import.meta.url), 'utf8');
    assert.equal(
      /await\s+sleep\s*\(/.test(src),
      false,
      'No `await sleep(...)` in claims.js — RESEARCH.md correction over CONTEXT.md',
    );
  });
});

// ===========================================================================
// claims.js source-level invariants — closure form, action labels, ABI canonical.
// These tests guard the must_haves.truths (Phase 58 closure form, Pitfall 6 ABI)
// against future regressions. Action label literals are asserted as sendTx args.
// ===========================================================================

describe('Plan 61-02: claims.js source-level invariants', () => {
  const SRC = readFileSync(new URL('../claims.js', import.meta.url), 'utf8');

  test('uses closure-form sendTx — typeof arg[0] is function', () => {
    // The closure form is `sendTx((s) => new Contract(...).method(args), 'Action')`
    // — both `sendTx((s) =>` and `sendTx(\n  (s) =>` (multi-line, lootbox.js style)
    // are accepted forms. Phase 58 grep gate uses the FORBIDDEN form only.
    const matches = SRC.match(/sendTx\(\s*\(s\)\s*=>/g) || [];
    assert.ok(matches.length >= 3, `expected >= 3 closure-form sendTx, got ${matches.length}`);
  });

  test('action label `Claim ETH winnings` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Claim ETH winnings'"), 'literal action label present');
  });

  test('action label `Claim BURNIE winnings` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Claim BURNIE winnings'"), 'literal action label present');
  });

  test('action label `Claim decimator level ${lvl}` template literal is sent to sendTx', () => {
    assert.ok(SRC.includes('Claim decimator level ${'), 'template-literal action label present');
  });

  test('canonical ABI: claimWinnings(address player)', () => {
    assert.ok(
      SRC.includes('function claimWinnings(address player) external'),
      'canonical CLAIMS_ABI fragment present',
    );
  });

  test('canonical ABI: claimCoinflips(address player, uint256 amount) — NOT /beta\'s WRONG (address, address)', () => {
    assert.ok(
      SRC.includes('function claimCoinflips(address player, uint256 amount) external returns (uint256 claimed)'),
      'canonical COINFLIP_ABI fragment present (not /beta address-cast form)',
    );
    // Negative assertion — the /beta WRONG form must not be present.
    assert.equal(
      /function\s+claimCoinflips\s*\(\s*address\s+\w+\s*,\s*address\s+\w+\s*\)/.test(SRC),
      false,
      '/beta WRONG `(address, address)` form must NOT appear in /app/ claims.js',
    );
  });

  test('canonical ABI: claimDecimatorJackpot(uint24 lvl)', () => {
    assert.ok(
      SRC.includes('function claimDecimatorJackpot(uint24 lvl) external'),
      'canonical DECIMATOR_CLAIM_ABI fragment present',
    );
  });

  test('reason-map registers EXACTLY 3 NEW codes (Dec*) — does NOT register `NotClaimable`', () => {
    const decRegisters = SRC.match(/register\('Dec(ClaimInactive|AlreadyClaimed|NotWinner)'/g) || [];
    assert.equal(decRegisters.length, 3, 'exactly 3 decimator codes registered');
    assert.equal(
      /register\('NotClaimable'/.test(SRC),
      false,
      'NotClaimable must NOT be registered (Pitfall 10 — does not exist on contract)',
    );
  });
});
