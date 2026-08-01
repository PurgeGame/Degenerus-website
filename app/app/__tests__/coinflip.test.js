// /app/app/__tests__/coinflip.test.js — Phase 62 Plan 62-03 (BUY-04).
//
// Run: cd website && node --test app/app/__tests__/coinflip.test.js
//
// Tests for coinflip.js write-path module: depositCoinflip + parseCoinflipDepositFromReceipt
// + AmountLTMin + CoinflipLocked reason-map registrations.
//
// RESEARCH R3 (HIGH confidence) invalidated CONTEXT D-01 step 1's conflation of
// coinflip with degenerette. Coinflip.depositCoinflip is a SYNCHRONOUS
// FLIP deposit emitting CoinflipDeposit ONLY (Coinflip.sol:46-95). NO
// BetPlaced event in Coinflip. NO per-bet poll cycle on the deposit tx.
//
// Sources:
//  - Coinflip.sol:46  — event CoinflipDeposit(address indexed player, uint256 creditedFlip)
//  - Coinflip.sol:101 — error AmountLTMin();
//  - Coinflip.sol:102 — error CoinflipLocked();
//  - Coinflip.sol:229 — function depositCoinflip(address player, uint256 amount) external
//
// RESEARCH Q5: FLIP/DGNRS/tickets are UNSCALED on Sepolia (only ETH is /1M
// per chain-config.sepolia.js ETH_DIVISOR). Min coinflip deposit = 100 FLIP
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

function makeFakeReverseFlipContract(opts = {}) {
  const calls = { reverseFlip: [] };
  const order = [];
  const reverseFlip = Object.assign(
    async (...args) => {
      calls.reverseFlip.push(args);
      order.push('send:reverseFlip');
      return makeFakeTx(makeFakeReceipt([]));
    },
    {
      staticCall: async (..._args) => {
        order.push('static:reverseFlip');
        if (opts.staticCallShouldRevert) {
          const err = new Error('static-call revert');
          err.revert = { name: opts.staticCallRevertName || 'RngLocked' };
          throw err;
        }
      },
    },
  );
  return {
    reverseFlip,
    connect(_signer) { return this; },
    _calls: calls,
    _order: order,
  };
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
// Reason-map registrations — Plan 62-03 registers AmountLTMin + CoinflipLocked.
// Phase 60 already registered NotApproved per RESEARCH R11 — DO NOT re-register.
// ===========================================================================

describe('Plan 62-03: coinflip.js reason-map registrations', () => {
  test('registers AmountLTMin with friendly userMessage citing 100 FLIP minimum', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'AmountLTMin' },
    });
    assert.equal(decoded.code, 'AmountLTMin');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /100|minimum|FLIP/i);
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

describe('coinflip stake reads', () => {
  afterEach(() => {
    coinflipMod.__resetCurrentStakeReaderForTest();
    coinflipMod.__resetResolvedStakeReaderForTest();
  });

  test('returns the contract-scoped current-day stake as bigint', async () => {
    let seenPlayer = null;
    coinflipMod.__setCurrentStakeReaderForTest(async ({ player }) => {
      seenPlayer = player;
      return '12000000000000000000000';
    });

    const stake = await coinflipMod.readCurrentCoinflipStake({ player: CONNECTED });
    assert.equal(seenPlayer, CONNECTED);
    assert.equal(stake, 12_000n * 10n ** 18n);
  });

  test('returns null when the current-day stake read is unavailable', async () => {
    coinflipMod.__setCurrentStakeReaderForTest(async () => {
      throw new Error('rpc unavailable');
    });
    assert.equal(await coinflipMod.readCurrentCoinflipStake({ player: CONNECTED }), null);
  });

  test('shares concurrent current-day reads for the same player', async () => {
    let calls = 0;
    let finish;
    coinflipMod.__setCurrentStakeReaderForTest(() => {
      calls += 1;
      return new Promise((resolve) => { finish = resolve; });
    });

    const first = coinflipMod.readCurrentCoinflipStake({ player: CONNECTED });
    const second = coinflipMod.readCurrentCoinflipStake({ player: CONNECTED });
    assert.equal(calls, 1, 'only one mutable chain read is in flight');
    finish('12000000000000000000000');
    assert.deepEqual(await Promise.all([first, second]), [
      12_000n * 10n ** 18n,
      12_000n * 10n ** 18n,
    ]);
  });

  test('returns and caches the final cumulative credit for one resolved day', async () => {
    let calls = 0;
    let args = null;
    coinflipMod.__setResolvedStakeReaderForTest(async (received) => {
      calls += 1;
      args = received;
      return '64857550066086392458598';
    });

    const first = await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 309 });
    const second = await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 309 });
    assert.deepEqual(args, { player: CONNECTED, day: 309 });
    assert.equal(first, 64857550066086392458598n);
    assert.equal(second, first);
    assert.equal(calls, 1, 'immutable player/day result is cached');
  });

  test('shares concurrent historical reads and persists the immutable result', async () => {
    let calls = 0;
    let finish;
    coinflipMod.__setResolvedStakeReaderForTest(() => {
      calls += 1;
      return new Promise((resolve) => { finish = resolve; });
    });

    const first = coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 310 });
    const second = coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 310 });
    assert.equal(calls, 1, 'only one historical scan is in flight');
    finish('9000000000000000000000');
    assert.deepEqual(await Promise.all([first, second]), [
      9_000n * 10n ** 18n,
      9_000n * 10n ** 18n,
    ]);
  });

  test('restores an immutable resolved stake from browser storage without RPC', async () => {
    const priorStorage = globalThis.localStorage;
    const values = new Map([
      [`coinflip_resolved_stake_v1:84532:${CONNECTED}:311`, '7000000000000000000000'],
    ]);
    globalThis.localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    };
    coinflipMod.__resetResolvedStakeReaderForTest();
    try {
      assert.equal(
        await coinflipMod.readResolvedCoinflipStake({ player: CONNECTED, day: 311 }),
        7_000n * 10n ** 18n,
      );
    } finally {
      if (priorStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = priorStorage;
    }
  });
});

// ===========================================================================
// reverseFlip quote + GAME write path.
// ===========================================================================

describe('reverseFlip quote and action', () => {
  const F = 10n ** 18n;

  afterEach(() => {
    coinflipMod.__resetReverseFlipQuoteReaderForTest();
    coinflipMod.__resetReverseFlipContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('mirrors the contract price: 100 FLIP compounded +50% per queued nudge', () => {
    assert.equal(coinflipMod.reverseFlipCostWei(0), 100n * F);
    assert.equal(coinflipMod.reverseFlipCostWei(1), 150n * F);
    assert.equal(coinflipMod.reverseFlipCostWei(2), 225n * F);
    assert.equal(coinflipMod.reverseFlipCostWei(3), 337_500_000_000_000_000_000n);
  });

  test('normalizes and shares a live reverse-flip quote read', async () => {
    let calls = 0;
    let finish;
    coinflipMod.__setReverseFlipQuoteReaderForTest(() => {
      calls += 1;
      return new Promise((resolve) => { finish = resolve; });
    });

    const first = coinflipMod.readReverseFlipQuote();
    const second = coinflipMod.readReverseFlipQuote();
    assert.equal(calls, 1, 'one storage/lock quote is in flight');
    finish({ queued: '2', locked: false });
    assert.deepEqual(await Promise.all([first, second]), [
      { queued: 2n, costWei: 225n * F, locked: false },
      { queued: 2n, costWei: 225n * F, locked: false },
    ]);
  });

  test('static-calls GAME.reverseFlip before the closure-form transaction', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const fake = makeFakeReverseFlipContract();
    coinflipMod.__setReverseFlipContractFactoryForTest(() => fake);

    const out = await coinflipMod.reverseFlip();
    assert.equal(out.receipt.status, 1);
    assert.equal(fake._calls.reverseFlip.length, 1, 'one reverseFlip transaction');
    assert.deepEqual(fake._order, ['static:reverseFlip', 'send:reverseFlip']);
  });

  test('RngLocked static-call failure is surfaced with useful copy and sends nothing', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const fake = makeFakeReverseFlipContract({
      staticCallShouldRevert: true,
      staticCallRevertName: 'RngLocked',
    });
    coinflipMod.__setReverseFlipContractFactoryForTest(() => fake);

    await assert.rejects(
      coinflipMod.reverseFlip(),
      /RNG is locked|settling/i,
    );
    assert.equal(fake._calls.reverseFlip.length, 0);
    assert.deepEqual(fake._order, ['static:reverseFlip']);
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
    const amount = '200000000000000000000'; // 200 FLIP
    await coinflipMod.depositCoinflip({ amount });
    assert.equal(lastFakeContract._calls.depositCoinflip.length, 1);
    const [args] = lastFakeContract._calls.depositCoinflip;
    assert.equal(args[0], CONNECTED, 'player = connected.address');
    assert.equal(args[1], 200n * 10n ** 18n, 'amount converted to BigInt wei');
  });

  test('rejects amount below 100 FLIP minimum (AmountLTMin defense-in-depth)', async () => {
    await assert.rejects(
      coinflipMod.depositCoinflip({ amount: '50000000000000000000' }),
      /Minimum|100 FLIP|AmountLTMin/i,
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

// ===========================================================================
// Claim-first funding (user call 2026-07-29).
//
// The stake is burned by FLIP.burnForCoinflip, which goes straight to _burn —
// unlike burnCoin / decimatorBurn / terminalDecimatorBurn it does NOT call
// _consumeCoinflipShortfall. Proven against live state: for an address holding
// 5,027,308 liquid + 6,816,975 claimable FLIP, a 5,100,000 stake reverts panic
// 0x11 while 5,027,308 goes through. So the UI mints the gap first.
// ===========================================================================

describe('depositCoinflip claim-first funding', () => {
  const F = 10n ** 18n;
  let fake;
  let claims;

  function install({ liquid, claimable, readFails = false }) {
    claims = [];
    coinflipMod.__setDepsForTest({
      readFunding: async () => (readFails ? null : { liquid, claimable }),
      claim: async ({ player, amount }) => { claims.push([player, amount]); return { claimed: amount }; },
    });
  }

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    fake = makeFakeContract();
    coinflipMod.__setContractFactoryForTest(() => fake);
  });

  afterEach(() => {
    coinflipMod.__resetContractFactoryForTest();
    coinflipMod.__resetDepsForTest();
    contractsMod.clearProvider();
  });

  test('a wallet that covers the stake claims nothing', async () => {
    install({ liquid: 5_000n * F, claimable: 9_000n * F });
    const out = await coinflipMod.depositCoinflip({ amount: 1_000n * F });
    assert.equal(claims.length, 0, 'no claim tx');
    assert.equal(out.claimed, 0n);
    assert.equal(fake._calls.depositCoinflip.length, 1);
  });

  test('a short wallet claims EXACTLY the shortfall, then deposits', async () => {
    install({ liquid: 400n * F, claimable: 5_000n * F });
    const out = await coinflipMod.depositCoinflip({ amount: 1_000n * F });
    assert.equal(claims.length, 1, 'one claim tx');
    // 600, not 5,000: claimable is also the recycling-bonus basis
    // (_depositCoinflip's rollAmount), so over-claiming forfeits 75bps of the
    // slice it drains. Claim the gap and no more.
    assert.deepEqual(claims[0], [CONNECTED, 600n * F]);
    assert.equal(out.claimed, 600n * F);
    assert.equal(fake._calls.depositCoinflip.length, 1, 'deposit still sent');
    assert.equal(fake._calls.depositCoinflip[0][1], 1_000n * F, 'full stake deposited');
  });

  test('neither leg covering it names BOTH numbers and sends nothing', async () => {
    install({ liquid: 100n * F, claimable: 200n * F });
    await assert.rejects(
      coinflipMod.depositCoinflip({ amount: 1_000n * F }),
      /100 FLIP in your wallet.*200 FLIP claimable.*stake is 1,000 FLIP/,
    );
    assert.equal(claims.length, 0, 'no claim attempted');
    assert.equal(fake._calls.depositCoinflip.length, 0, 'no deposit attempted');
  });

  test('an unreadable balance does not block a deposit — unknown is not zero', async () => {
    install({ readFails: true });
    await coinflipMod.depositCoinflip({ amount: 1_000n * F });
    assert.equal(claims.length, 0);
    assert.equal(fake._calls.depositCoinflip.length, 1);
  });

  test('claimFirst: false keeps the old single-tx behaviour', async () => {
    install({ liquid: 0n, claimable: 9_000n * F });
    await coinflipMod.depositCoinflip({ amount: 1_000n * F, claimFirst: false });
    assert.equal(claims.length, 0, 'opted out, so no claim');
    assert.equal(fake._calls.depositCoinflip.length, 1);
  });

  test('the claim runs BEFORE the deposit', async () => {
    const order = [];
    coinflipMod.__setDepsForTest({
      readFunding: async () => ({ liquid: 0n, claimable: 9_000n * F }),
      claim: async ({ amount }) => { order.push('claim'); return { claimed: amount }; },
    });
    fake = makeFakeContract();
    coinflipMod.__setContractFactoryForTest(() => fake);
    await coinflipMod.depositCoinflip({ amount: 1_000n * F });
    order.push(...fake._order.filter((o) => o.startsWith('send:')));
    assert.deepEqual(order, ['claim', 'send:depositCoinflip']);
  });
});

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

  test('canonical current-stake ABI: coinflipAmount(address player)', () => {
    assert.ok(
      SRC.includes('function coinflipAmount(address player) external view returns (uint256)'),
      'current-day coinflipAmount ABI fragment present',
    );
  });

  test('canonical exact-day cumulative stake event ABI is present', () => {
    assert.ok(
      SRC.includes('event CoinflipStakeUpdated(address indexed player, uint24 indexed day, uint256 amount, uint256 newTotal)'),
      'resolved-day reader is based on the cumulative newTotal event',
    );
  });

  test('canonical event ABI: CoinflipDeposit(address indexed player, uint256 creditedFlip)', () => {
    assert.ok(
      SRC.includes('event CoinflipDeposit(address indexed player, uint256 creditedFlip)'),
      'canonical CoinflipDeposit event signature present',
    );
  });

  // Plan 62-03's 2 + 1: Insufficient, added 2026-07-29. The coinflip stake is
  // BURNED from the player's FLIP, so an under-funded deposit fails inside
  // FLIP.sol — `Insufficient()` on the shortfall path — and read as "an
  // unexpected error" until it was mapped.
  test('reason-map registers 3 codes (AmountLTMin + CoinflipLocked + Insufficient)', () => {
    const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const registers = stripped.match(/register\s*\(/g) || [];
    assert.equal(registers.length, 3, `exactly 3 register calls expected, got ${registers.length}`);
    assert.ok(
      /register\(\s*['"]Insufficient['"]/.test(stripped),
      'Insufficient must be registered',
    );
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

  test('coinflip.js exports deposit, receipt parsing, and current-day stake read', () => {
    assert.ok(/export\s+async\s+function\s+depositCoinflip\b/.test(SRC));
    assert.ok(/export\s+function\s+parseCoinflipDepositFromReceipt\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+readCurrentCoinflipStake\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+readResolvedCoinflipStake\b/.test(SRC));
  });

  test('reverseFlip uses the GAME ABI, raw queued-count slot, and closure-form sendTx', () => {
    assert.ok(SRC.includes('function reverseFlip() external'));
    // run23+ generation: price-guarded overload + public quote view.
    assert.ok(SRC.includes('function reverseFlip(uint256 expectedCost) external'));
    assert.ok(SRC.includes('function rngNudgeQuote() external view returns (uint256 queued, uint256 cost)'));
    assert.ok(SRC.includes('provider.getStorage(CONTRACTS.GAME, REVERSE_FLIP_STORAGE_SLOT)'));
    assert.ok(SRC.includes('BigInt(packedSlot) & UINT64_MASK'));
    // Closure-form sendTx; args carry expectedCost on v2 deploys, empty on legacy.
    assert.match(SRC, /sendTx\(\s*\(s\)\s*=>\s*_buildReverseFlipContract\(s\)\.reverseFlip\(\.\.\.args\)/);
    assert.ok(SRC.includes("'Reverse flip'"));
  });
});
