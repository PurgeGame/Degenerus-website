// /app/app/__tests__/coinflip.test.js — Phase 62 Plan 62-03 (BUY-04).
//
// Run: cd website && node --test app/app/__tests__/coinflip.test.js
//
// Tests for coinflip.js write-path module: depositCoinflip + parseCoinflipDepositFromReceipt
// + AmountLTMin + CoinflipLocked reason-map registrations.
//
// RESEARCH R3 (HIGH confidence) invalidated CONTEXT D-01 step 1's conflation of
// coinflip with degenerette. BurnieCoinflip.depositCoinflip is a SYNCHRONOUS
// BURNIE deposit emitting CoinflipDeposit ONLY (BurnieCoinflip.sol:46-95). NO
// BetPlaced event in BurnieCoinflip. NO per-bet poll cycle on the deposit tx.
//
// Sources:
//  - BurnieCoinflip.sol:46  — event CoinflipDeposit(address indexed player, uint256 creditedFlip)
//  - BurnieCoinflip.sol:101 — error AmountLTMin();
//  - BurnieCoinflip.sol:102 — error CoinflipLocked();
//  - BurnieCoinflip.sol:229 — function depositCoinflip(address player, uint256 amount) external
//
// RESEARCH Q5: BURNIE/DGNRS/tickets are UNSCALED on Sepolia (only ETH is /1M
// per chain-config.sepolia.js ETH_DIVISOR). Min coinflip deposit = 100 BURNIE
// = 100n * 10n**18n wei.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as coinflipMod from '../coinflip.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import * as reasonMapMod from '../reason-map.js';

// ---------------------------------------------------------------------------
// Fake provider/signer/contract harness — verbatim port of passes.test.js shape.
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) {
  return { status: 1, hash: '0xreceipt-hash', logs: logs || [] };
}

function makeFakeTx(receipt) {
  return { hash: '0xtx-hash', wait: async () => receipt };
}

function makeFakeContract(opts = {}) {
  const calls = {
    depositCoinflip: [],
  };
  const order = [];
  const staticCallStub = (methodName) => async (..._args) => {
    order.push(`static:${methodName}`);
    if (opts.staticCallShouldRevert?.[methodName]) {
      const err = new Error('static-call revert');
      err.revert = {
        name: opts.staticCallRevertName?.[methodName] || 'AmountLTMin',
      };
      throw err;
    }
    return undefined;
  };
  const sendTxStub = (methodName) => async (..._args) => {
    order.push(`send:${methodName}`);
    if (opts.sendTxShouldRevert?.[methodName]) {
      const err = new Error('sendTx revert');
      err.revert = { name: opts.sendTxRevertName?.[methodName] || 'CoinflipLocked' };
      throw err;
    }
    return makeFakeTx(makeFakeReceipt(opts[methodName + 'Logs']));
  };

  const c = {
    depositCoinflip: Object.assign(
      async (...args) => {
        calls.depositCoinflip.push(args);
        return sendTxStub('depositCoinflip')(...args);
      },
      { staticCall: staticCallStub('depositCoinflip') }
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
    _order: order,
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
// Reason-map registrations — Plan 62-03 registers AmountLTMin + CoinflipLocked.
// Phase 60 already registered NotApproved per RESEARCH R11 — DO NOT re-register.
// ===========================================================================

describe('Plan 62-03: coinflip.js reason-map registrations', () => {
  test('registers AmountLTMin with friendly userMessage citing 100 BURNIE minimum', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'AmountLTMin' },
    });
    assert.equal(decoded.code, 'AmountLTMin');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /100|minimum|BURNIE/i);
  });

  test('registers CoinflipLocked with friendly userMessage citing jackpot resolution', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'CoinflipLocked' },
    });
    assert.equal(decoded.code, 'CoinflipLocked');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /locked|jackpot|few minutes/i);
  });

  test('does NOT re-register NotApproved (Phase 60 already covers per RESEARCH R11)', () => {
    const SRC = readFileSync(new URL('../coinflip.js', import.meta.url), 'utf8');
    assert.equal(
      /register\(\s*['"]NotApproved['"]/.test(SRC),
      false,
      "coinflip.js must NOT register 'NotApproved' (Phase 60 baseline)",
    );
  });
});

// ===========================================================================
// depositCoinflip — calls contract.depositCoinflip(player, amount).
// ===========================================================================

describe('Plan 62-03: depositCoinflip', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    coinflipMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    coinflipMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes depositCoinflip(buyer, amount) with closure-form sendTx', async () => {
    const amount = '200000000000000000000'; // 200 BURNIE
    await coinflipMod.depositCoinflip({ amount });
    assert.equal(lastFakeContract._calls.depositCoinflip.length, 1);
    const [args] = lastFakeContract._calls.depositCoinflip;
    assert.equal(args[0], CONNECTED, 'player = connected.address');
    assert.equal(args[1], 200n * 10n ** 18n, 'amount converted to BigInt wei');
  });

  test('rejects amount below 100 BURNIE minimum (AmountLTMin defense-in-depth)', async () => {
    await assert.rejects(
      coinflipMod.depositCoinflip({ amount: '50000000000000000000' }),
      /Minimum|100 BURNIE|AmountLTMin/i,
    );
  });

  test('rejects when wallet not connected', async () => {
    storeMod.update('connected.address', null);
    contractsMod.clearProvider();
    await assert.rejects(
      coinflipMod.depositCoinflip({ amount: '200000000000000000000' }),
      /Wallet not connected/i,
    );
  });

  test('accepts amount as string and converts to BigInt', async () => {
    await coinflipMod.depositCoinflip({ amount: '500000000000000000000' });
    const [args] = lastFakeContract._calls.depositCoinflip;
    assert.equal(args[1], 500n * 10n ** 18n, 'string amount converted to 500e18 BigInt');
  });

  test('accepts amount as bigint directly', async () => {
    await coinflipMod.depositCoinflip({ amount: 250n * 10n ** 18n });
    const [args] = lastFakeContract._calls.depositCoinflip;
    assert.equal(args[1], 250n * 10n ** 18n);
  });

  test('parseCoinflipDepositFromReceipt returns parsed CoinflipDeposit events', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'CoinflipDeposit',
          args: { player: CONNECTED, creditedFlip: 350n * 10n ** 18n },
        },
      },
    ]);
    const out = coinflipMod.parseCoinflipDepositFromReceipt(receipt, lastFakeContract);
    assert.equal(out.length, 1);
    assert.equal(out[0].player, CONNECTED);
    assert.equal(out[0].creditedFlip, 350n * 10n ** 18n);
  });

  test('parseCoinflipDepositFromReceipt ignores foreign logs gracefully', () => {
    const throwingContract = {
      interface: {
        parseLog: () => { throw new Error('foreign log'); },
      },
    };
    const receipt = makeFakeReceipt([{ topics: [], data: '0x' }]);
    const out = coinflipMod.parseCoinflipDepositFromReceipt(receipt, throwingContract);
    assert.deepEqual(out, []);
  });

  test('parseCoinflipDepositFromReceipt returns empty array on null receipt', () => {
    assert.deepEqual(coinflipMod.parseCoinflipDepositFromReceipt(null, lastFakeContract), []);
    assert.deepEqual(coinflipMod.parseCoinflipDepositFromReceipt({ logs: undefined }, lastFakeContract), []);
  });

  test('static-call gate runs BEFORE sendTx — order verification', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { depositCoinflip: true },
      staticCallRevertName: { depositCoinflip: 'AmountLTMin' },
    });
    coinflipMod.__setContractFactoryForTest(() => reverting);
    await assert.rejects(
      coinflipMod.depositCoinflip({ amount: '200000000000000000000' }),
    );
    assert.equal(
      reverting._calls.depositCoinflip.length, 0,
      'sendTx NOT invoked when static-call gate trips',
    );
    // Order: static-call before sendTx
    assert.ok(
      reverting._order[0]?.startsWith('static:'),
      'static-call invoked first in sequence',
    );
  });
});

// ===========================================================================
// coinflip.js source-level invariants — closure form, action label, ABI canonical.
// ===========================================================================

describe('Plan 62-03: coinflip.js source-level invariants', () => {
  const SRC = readFileSync(new URL('../coinflip.js', import.meta.url), 'utf8');

  test('uses closure-form sendTx — minimum 1 occurrence', () => {
    const matches = SRC.match(/sendTx\(\s*\(s\)\s*=>/g) || [];
    assert.ok(matches.length >= 1, `expected >= 1 closure-form sendTx, got ${matches.length}`);
  });

  test('action label `Coinflip deposit` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Coinflip deposit'"), 'literal action label present');
  });

  test('canonical ABI: depositCoinflip(address player, uint256 amount) external', () => {
    assert.ok(
      SRC.includes('function depositCoinflip(address player, uint256 amount) external'),
      'canonical COINFLIP_ABI fragment present',
    );
  });

  test('canonical event ABI: CoinflipDeposit(address indexed player, uint256 creditedFlip)', () => {
    assert.ok(
      SRC.includes('event CoinflipDeposit(address indexed player, uint256 creditedFlip)'),
      'canonical CoinflipDeposit event signature present',
    );
  });

  test('reason-map registers EXACTLY 2 NEW codes (AmountLTMin + CoinflipLocked)', () => {
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const registers = stripped.match(/register\s*\(/g) || [];
    assert.equal(registers.length, 2, `exactly 2 register calls expected, got ${registers.length}`);
    assert.ok(
      /register\(\s*['"]AmountLTMin['"]/.test(stripped),
      'AmountLTMin must be registered',
    );
    assert.ok(
      /register\(\s*['"]CoinflipLocked['"]/.test(stripped),
      'CoinflipLocked must be registered',
    );
  });

  test('NO pre-resolved-promise sendTx (Phase 58 closure-form gate)', () => {
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      /sendTx\([a-zA-Z_]+\.[a-zA-Z_]+\(/.test(stripped),
      false,
      'NO pre-resolved promise sendTx pattern allowed',
    );
  });

  test('requireStaticCall invoked at least once before sendTx', () => {
    const matches = SRC.match(/requireStaticCall\(/g) || [];
    assert.ok(matches.length >= 1, `expected >= 1 requireStaticCall, got ${matches.length}`);
  });

  test('coinflip.js exports depositCoinflip + parseCoinflipDepositFromReceipt', () => {
    assert.ok(/export\s+async\s+function\s+depositCoinflip\b/.test(SRC));
    assert.ok(/export\s+function\s+parseCoinflipDepositFromReceipt\b/.test(SRC));
  });
});
