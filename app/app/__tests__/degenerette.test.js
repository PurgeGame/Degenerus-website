// /app/app/__tests__/degenerette.test.js — Phase 62 Plan 62-03 (BUY-05).
//
// Run: cd website && node --test app/app/__tests__/degenerette.test.js
//
// Tests for degenerette.js write-path module: placeBet + resolveBets +
// parseBetPlacedFromReceipt + parseBetResolvedFromReceipt +
// parseSpinResultsFromReceipt + InvalidBet + UnsupportedCurrency
// reason-map registrations.
//
// Audit 224de529 (docs/DEGENERETTE-BET-QUEUE.md): a bet is ONE tx.
//   placeDegeneretteBet(player, currency, amountPerSpin, spinCount, symbol) payable
//     → appends a word to degeneretteQueue[index], emits
//       DegeneretteBetPlaced(player, index, betId = queue position + 1, packed)
//   The mineFlip() keeper sweep settles it once the index's word lands; the
//   optional resolveDegeneretteBets(index, betIds[]) settles it early. Either
//   way one DegeneretteResolved(player, index, betId, totalPayout,
//   resultTraits, spins) carries every spin.
//
// AUDIT a5d4d2cd (vendored into degenerus-sim) replaced the old
// `uint32 customTraits, uint8 heroQuadrant` pair with a single `uint8 symbol`
// (0..31: quadrant = symbol >> 3, icon = symbol & 7). The player's ticket is
// generated fresh from the RNG seed every spin — colors are never chosen.
// See DegenerusGameDegeneretteModule.sol.
//
// Sources:
//  - DegenerusGame.sol — placeDegeneretteBet / resolveDegeneretteBets(uint48, uint64[])
//    (delegate-called via GAME) and degeneretteBetInfo(uint48, uint64).
//  - DegenerusGameDegeneretteModule.sol — InvalidBet / UnsupportedCurrency errors,
//    DegeneretteBetPlaced / DegeneretteResolved events.
//
// Only ETH (0) and FLIP (1) fund a bet; WWXRP (3) and anything else →
// UnsupportedCurrency.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as degeneretteMod from '../degenerette.js';
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
    placeDegeneretteBet: [],
    resolveDegeneretteBets: [],
    degeneretteBetInfo: [],
    claimableWinningsOf: [],
  };
  const order = [];
  const staticCallStub = (methodName) => async (..._args) => {
    order.push(`static:${methodName}`);
    if (opts.staticCallShouldRevert?.[methodName]) {
      const err = new Error('static-call revert');
      err.revert = {
        name: opts.staticCallRevertName?.[methodName] || 'InvalidBet',
      };
      throw err;
    }
    return undefined;
  };
  const sendTxStub = (methodName) => async (..._args) => {
    order.push(`send:${methodName}`);
    if (opts.sendTxShouldRevert?.[methodName]) {
      const err = new Error('sendTx revert');
      err.revert = { name: opts.sendTxRevertName?.[methodName] || 'InvalidBet' };
      throw err;
    }
    return makeFakeTx(makeFakeReceipt(opts[methodName + 'Logs']));
  };

  const c = {
    placeDegeneretteBet: Object.assign(
      async (...args) => {
        calls.placeDegeneretteBet.push(args);
        return sendTxStub('placeDegeneretteBet')(...args);
      },
      { staticCall: staticCallStub('placeDegeneretteBet') }
    ),
    resolveDegeneretteBets: Object.assign(
      async (...args) => {
        calls.resolveDegeneretteBets.push(args);
        return sendTxStub('resolveDegeneretteBets')(...args);
      },
      { staticCall: staticCallStub('resolveDegeneretteBets') }
    ),
    degeneretteBetInfo: async (...args) => {
      calls.degeneretteBetInfo.push(args);
      return opts.betInfo ?? 1n;
    },
    claimableWinningsOf: async (...args) => {
      calls.claimableWinningsOf.push(args);
      if (opts.claimableReadError) throw opts.claimableReadError;
      return opts.claimableWinnings ?? 0n;
    },
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
    _order: order,
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
// Reason-map registrations — Plan 62-03 registers InvalidBet + UnsupportedCurrency.
// Phase 56 baseline already covers RngNotReady — DO NOT re-register.
// ===========================================================================

describe('Plan 62-03: degenerette.js reason-map registrations', () => {
  test('registers InvalidBet with friendly userMessage citing inputs', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'InvalidBet' },
    });
    assert.equal(decoded.code, 'InvalidBet');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /invalid|amount|count|inputs/i);
  });

  test('registers UnsupportedCurrency with friendly userMessage', () => {
    const decoded = reasonMapMod.decodeRevertReason({
      revert: { name: 'UnsupportedCurrency' },
    });
    assert.equal(decoded.code, 'UnsupportedCurrency');
    assert.ok(decoded.userMessage && decoded.userMessage.length > 0);
    assert.match(decoded.userMessage, /currency|not supported|ETH|FLIP/i);
  });

  test('does NOT re-register RngNotReady (Phase 56 baseline already covers per RESEARCH R11)', () => {
    const SRC = readFileSync(new URL('../degenerette.js', import.meta.url), 'utf8');
    assert.equal(
      /register\(\s*['"]RngNotReady['"]/.test(SRC),
      false,
      "degenerette.js must NOT register 'RngNotReady' (Phase 56 baseline)",
    );
  });
});

// ===========================================================================
// placeBet — calls contract.placeDegeneretteBet(...) with msg.value.
// ===========================================================================

describe('Plan 62-03: placeBet', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    degeneretteMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    degeneretteMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes placeDegeneretteBet(player, currency, amount, count, symbol) with closure-form sendTx + msg.value', async () => {
    const amountPerTicket = 10n ** 16n;  // 0.01 ETH
    const ticketCount = 3;
    const msgValueWei = amountPerTicket * BigInt(ticketCount);
    await degeneretteMod.placeBet({
      currency: 0,
      amountPerTicketWei: amountPerTicket,
      ticketCount,
      symbol: 21, // quadrant 2 (21 >> 3), icon 5 (21 & 7)
      msgValueWei,
    });
    assert.equal(lastFakeContract._calls.placeDegeneretteBet.length, 1);
    const [args] = lastFakeContract._calls.placeDegeneretteBet;
    assert.equal(args[0], CONNECTED, 'player = connected.address');
    assert.equal(args[1], 0, 'currency = ETH (0)');
    assert.equal(args[2], amountPerTicket, 'amountPerTicket bigint');
    assert.equal(args[3], 3, 'ticketCount = 3');
    assert.equal(args[4], 21, 'symbol = 21 (quadrant << 3 | icon)');
    // 6th arg = overrides object containing value
    assert.ok(args[5] && typeof args[5] === 'object', 'overrides object passed');
    assert.equal(args[5].value, msgValueWei, 'msg.value matches msgValueWei');
  });

  test('claimable-first ETH wager preserves the sentinel and sends only the wallet shortfall', async () => {
    const amountPerTicket = 10n ** 16n;
    const ticketCount = 3;
    const totalWager = amountPerTicket * BigInt(ticketCount);
    lastFakeContract = makeFakeContract({
      claimableWinnings: (amountPerTicket * 2n) + 1n,
    });
    degeneretteMod.__setContractFactoryForTest(() => lastFakeContract);

    const { payment } = await degeneretteMod.placeBet({
      currency: 0,
      amountPerTicketWei: amountPerTicket,
      ticketCount,
      symbol: 0,
      preferClaimable: true,
    });

    assert.deepEqual(lastFakeContract._calls.claimableWinningsOf, [[CONNECTED]],
      'the click-time split reads the acting player from chain');
    const [args] = lastFakeContract._calls.placeDegeneretteBet;
    assert.equal(args[5].value, amountPerTicket,
      'two spins come from claimable and the final spin comes from wallet ETH');
    assert.equal(payment.claimableUsedWei, amountPerTicket * 2n);
    assert.equal(payment.msgValueWei, amountPerTicket);
    assert.equal(payment.totalCostWei, totalWager);
  });

  test('wallet-first ETH wager does not read or consume available claimable', async () => {
    const amountPerTicket = 10n ** 16n;
    lastFakeContract = makeFakeContract({ claimableWinnings: amountPerTicket + 1n });
    degeneretteMod.__setContractFactoryForTest(() => lastFakeContract);

    const { payment } = await degeneretteMod.placeBet({
      currency: 0,
      amountPerTicketWei: amountPerTicket,
      ticketCount: 2,
      symbol: 0,
      preferClaimable: false,
    });

    assert.deepEqual(lastFakeContract._calls.claimableWinningsOf, []);
    const [args] = lastFakeContract._calls.placeDegeneretteBet;
    assert.equal(args[5].value, amountPerTicket * 2n);
    assert.equal(payment.claimableUsedWei, 0n);
  });

  test('claimable read failure safely falls back to the full wallet wager', async () => {
    const amountPerTicket = 10n ** 16n;
    lastFakeContract = makeFakeContract({ claimableReadError: new Error('rpc unavailable') });
    degeneretteMod.__setContractFactoryForTest(() => lastFakeContract);

    await degeneretteMod.placeBet({
      currency: 0,
      amountPerTicketWei: amountPerTicket,
      ticketCount: 2,
      symbol: 0,
      preferClaimable: true,
    });

    const [args] = lastFakeContract._calls.placeDegeneretteBet;
    assert.equal(args[5].value, amountPerTicket * 2n);
  });

  test('rejects spinCount < 1', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 0,
        symbol: 0,
        msgValueWei: 0n,
      }),
      /Spins must be 1-25 for ETH/i,
    );
  });

  // Per-currency caps, verbatim from DegenerusGameDegeneretteModule.sol
  // (MAX_SPINS_ETH 25 / FLIP 15). The old flat 1-10 UI cap hid 15 of the ETH
  // spins the contract allows.
  test('accepts the contract cap per currency and rejects one past it', async () => {
    const cases = [
      { currency: 0, cap: 25, amount: 10n ** 16n, unit: 'ETH' },
      { currency: 1, cap: 15, amount: 100n * 10n ** 18n, unit: 'FLIP' },
    ];
    for (const { currency, cap, amount, unit } of cases) {
      await degeneretteMod.placeBet({
        currency,
        amountPerTicketWei: amount,
        ticketCount: cap,
        symbol: 0,
        msgValueWei: currency === 0 ? amount * BigInt(cap) : 0n,
      });
      await assert.rejects(
        degeneretteMod.placeBet({
          currency,
          amountPerTicketWei: amount,
          ticketCount: cap + 1,
          symbol: 0,
          msgValueWei: 0n,
        }),
        new RegExp(`Spins must be 1-${cap} for ${unit}`, 'i'),
        `${unit} rejects ${cap + 1} spins`,
      );
    }
    assert.equal(
      lastFakeContract._calls.placeDegeneretteBet.length, 2,
      'both at-cap bets went through',
    );
  });

  test('rejects a bet below the contract minimum, per currency', async () => {
    // MIN_BET_*: 0.005 ETH / 100 FLIP per spin.
    // ETH callers pass CHAIN-scale wei, so the boundary is scale-dependent —
    // derive it rather than hardcoding a mainnet figure that passes on testnet.
    const { ETH_DIVISOR } = await import('../chain-config.js');
    const ethMinChainWei = (5n * 10n ** 15n) / BigInt(ETH_DIVISOR);
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0, amountPerTicketWei: ethMinChainWei - 1n, ticketCount: 1, symbol: 0,
      }),
      /Minimum bet is 0.005 ETH per card/i,
    );
    // …and exactly at the ETH minimum goes through.
    await degeneretteMod.placeBet({
      currency: 0, amountPerTicketWei: ethMinChainWei, ticketCount: 1, symbol: 0,
      msgValueWei: ethMinChainWei,
    });
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 1, amountPerTicketWei: 99n * 10n ** 18n, ticketCount: 1, symbol: 0,
      }),
      /Minimum bet is 100 FLIP per card/i,
    );
    // Exactly at the minimum is a valid bet.
    await degeneretteMod.placeBet({
      currency: 1, amountPerTicketWei: 100n * 10n ** 18n, ticketCount: 1, symbol: 0,
    });
  });

  test('rejects WWXRP (3): audit 224de529 removed WWXRP bets', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 3, amountPerTicketWei: 10n ** 18n, ticketCount: 1, symbol: 0,
      }),
      /Unsupported currency\. Pick ETH or FLIP/i,
    );
    assert.equal(lastFakeContract._calls.placeDegeneretteBet.length, 0);
    assert.equal(degeneretteMod.degeneretteLimits(3), null);
  });

  // The queued word stores whole stake units; placement reverts InvalidBet on
  // anything finer. The ETH unit is 1 gwei scaled by the deployment's
  // ETH_DIVISOR (1,000 wei on the /1M testnet), FLIP's is 1 whole token.
  test('floors sub-unit dust so the send never reverts InvalidBet on granularity', async () => {
    const { ETH_DIVISOR } = await import('../chain-config.js');
    const ethUnit = (10n ** 9n) / BigInt(ETH_DIVISOR);
    assert.equal(degeneretteMod.degeneretteStakeUnit(0), ethUnit);
    assert.equal(degeneretteMod.degeneretteStakeUnit(1), 10n ** 18n);
    assert.equal(degeneretteMod.degeneretteStakeUnit(3), null);
    const ethAmount = (10n ** 16n) / BigInt(ETH_DIVISOR);
    const { amountPerSpin } = await degeneretteMod.placeBet({
      currency: 0, amountPerTicketWei: ethAmount + ethUnit - 1n, ticketCount: 2, symbol: 0,
    });
    assert.equal(amountPerSpin, ethAmount);
    const [ethArgs] = lastFakeContract._calls.placeDegeneretteBet;
    assert.equal(ethArgs[2], ethAmount, 'the sub-unit remainder never reaches the contract');
    assert.equal(ethArgs[2] % ethUnit, 0n);
    assert.equal(ethArgs[5].value, ethAmount * 2n, 'msg.value covers exactly the floored wager');

    await degeneretteMod.placeBet({
      currency: 1, amountPerTicketWei: 250n * 10n ** 18n + 5n * 10n ** 17n, ticketCount: 1, symbol: 0,
    });
    assert.equal(lastFakeContract._calls.placeDegeneretteBet[1][2], 250n * 10n ** 18n);

    // Flooring can never sneak a bet under the minimum.
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 1, amountPerTicketWei: 100n * 10n ** 18n - 1n, ticketCount: 1, symbol: 0,
      }),
      /Minimum bet is 100 FLIP per card/i,
    );
    assert.equal(degeneretteMod.floorDegeneretteStake(ethUnit * 5n + 1n, 0), ethUnit * 5n);
    assert.equal(degeneretteMod.floorDegeneretteStake(1n, 3), null);
  });

  test('rejects currency 2 (unsupported) client-side', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 2,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 1,
        symbol: 0,
        msgValueWei: 0n,
      }),
      /Unsupported currency|UnsupportedCurrency|not supported/i,
    );
  });

  test('rejects amountPerTicketWei = 0', async () => {
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 0n,
        ticketCount: 1,
        symbol: 0,
        msgValueWei: 0n,
      }),
      /Amount.*greater than 0|Amount must|InvalidBet/i,
    );
  });

  test('rejects when wallet not connected', async () => {
    storeMod.update('connected.address', null);
    contractsMod.clearProvider();
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 1,
        symbol: 0,
        msgValueWei: 10n ** 16n,
      }),
      /Wallet not connected/i,
    );
  });

  test('static-call gate runs BEFORE sendTx — order verification', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { placeDegeneretteBet: true },
      staticCallRevertName: { placeDegeneretteBet: 'InvalidBet' },
    });
    degeneretteMod.__setContractFactoryForTest(() => reverting);
    await assert.rejects(
      degeneretteMod.placeBet({
        currency: 0,
        amountPerTicketWei: 10n ** 16n,
        ticketCount: 1,
        symbol: 0,
        msgValueWei: 10n ** 16n,
      }),
    );
    assert.equal(
      reverting._calls.placeDegeneretteBet.length, 0,
      'sendTx NOT invoked when static-call gate trips',
    );
  });
});

// ===========================================================================
// resolveBets — the OPTIONAL early settle: resolveDegeneretteBets(index, betIds[]).
// ===========================================================================

describe('resolveBets (optional early settle)', () => {
  let lastFakeContract;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lastFakeContract = makeFakeContract();
    degeneretteMod.__setContractFactoryForTest(() => lastFakeContract);
  });

  afterEach(() => {
    degeneretteMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('invokes resolveDegeneretteBets(index, betIds[]) behind its static-call gate', async () => {
    const result = await degeneretteMod.resolveBets({ index: 7, betIds: [42n] });
    assert.equal(lastFakeContract._calls.resolveDegeneretteBets.length, 1);
    const [args] = lastFakeContract._calls.resolveDegeneretteBets;
    assert.equal(args[0], 7n, 'the RNG index is the first argument (uint48)');
    assert.deepEqual(args[1], [42n], 'betIds passed as array of BigInt');
    assert.equal(args.length, 2, 'no player argument: credits always go to each bet owner');
    assert.deepEqual(lastFakeContract._order,
      ['static:resolveDegeneretteBets', 'send:resolveDegeneretteBets']);
    assert.equal(result.index, 7n);
  });

  test('requires the index: a bare betId names nothing (ids restart per index)', async () => {
    await assert.rejects(degeneretteMod.resolveBets({ betIds: [42n] }), /bet index is required/i);
    await assert.rejects(degeneretteMod.resolveBets({ index: 2n ** 48n, betIds: [1n] }), /out of range/i);
    assert.equal(lastFakeContract._calls.resolveDegeneretteBets.length, 0);
  });

  test('rejects empty betIds array', async () => {
    await assert.rejects(
      degeneretteMod.resolveBets({ index: 7, betIds: [] }),
      /betIds.*non-empty|at least one bet|empty/i,
    );
  });

  test('coerces betIds entries to BigInt', async () => {
    await degeneretteMod.resolveBets({ index: '7', betIds: [42] });
    const [args] = lastFakeContract._calls.resolveDegeneretteBets;
    assert.equal(args[1][0], 42n, 'number coerced to BigInt');
  });

  test('a reverted first id (already settled by the sweep) never reaches the wallet', async () => {
    const reverting = makeFakeContract({
      staticCallShouldRevert: { resolveDegeneretteBets: true },
      staticCallRevertName: { resolveDegeneretteBets: 'InvalidBet' },
    });
    degeneretteMod.__setContractFactoryForTest(() => reverting);
    await assert.rejects(
      degeneretteMod.resolveBets({ index: 7, betIds: [42n] }),
      (error) => error.code === 'InvalidBet',
    );
    assert.equal(reverting._calls.resolveDegeneretteBets.length, 0);
  });
});

// ===========================================================================
// Queued bet word, spins and exact per-spin payouts (audit 224de529).
// ===========================================================================

const FLIP = 10n ** 18n;
function betWord({
  owner = CONNECTED, symbol = 0, spinCount = 1, currency = 0, record = false, activity = 0, stakeUnits = 1n,
} = {}) {
  return BigInt(owner)
    | (BigInt(symbol) << 160n)
    | (BigInt(spinCount) << 165n)
    | (BigInt(currency) << 170n)
    | ((record ? 1n : 0n) << 171n)
    | (BigInt(activity) << 172n)
    | (BigInt(stakeUnits) << 188n);
}
function spinsHex(rows) {
  return '0x' + rows.map(({ traits, score, gold = 0 }) => (
    (traits >>> 0).toString(16).padStart(8, '0') + ((score & 15) | (gold << 4)).toString(16).padStart(2, '0')
  )).join('');
}

describe('queued bet word and settled spins', () => {
  test('decodeDegeneretteBetWord reads the LSB→MSB queue layout', async () => {
    const { ETH_DIVISOR } = await import('../chain-config.js');
    const word = betWord({ symbol: 21, spinCount: 25, currency: 0, record: true, activity: 305, stakeUnits: 5_000_000n });
    const bet = degeneretteMod.decodeDegeneretteBetWord(word);
    assert.equal(bet.owner, CONNECTED);
    assert.equal(bet.symbol, 21);
    assert.equal(bet.heroQuadrant, 2);
    assert.equal(bet.spinCount, 25);
    assert.equal(bet.currency, 0);
    assert.equal(bet.recordArmed, true);
    assert.equal(bet.activityScore, 305);
    assert.equal(bet.stakeUnits, 5_000_000n);
    // 5,000,000 gwei = 0.005 ETH full-scale, expressed in the chain's own wei.
    assert.equal(bet.amountPerSpin, (5n * 10n ** 15n) / BigInt(ETH_DIVISOR));
    const flip = degeneretteMod.decodeDegeneretteBetWord(betWord({ currency: 1, stakeUnits: 250n }));
    assert.equal(flip.amountPerSpin, 250n * FLIP);
    assert.equal(flip.recordArmed, false);
    assert.equal(degeneretteMod.decodeDegeneretteBetWord(0n), null, 'zero = settled/unknown');
  });

  test('degeneretteBetKey is the contract (index << 64) | betId, ordered by placement', () => {
    assert.equal(degeneretteMod.degeneretteBetKey(7, 3), (7n << 64n) | 3n);
    assert.ok(degeneretteMod.degeneretteBetKey(8, 1) > degeneretteMod.degeneretteBetKey(7, 900));
    assert.equal(degeneretteMod.degeneretteBetKey(null, 1), null);
  });

  test('decodeDegeneretteSpins unpacks 5 bytes per spin: big-endian traits then score | gold << 4', () => {
    const spins = degeneretteMod.decodeDegeneretteSpins(spinsHex([
      { traits: 0xC0804000, score: 9, gold: 4 },
      { traits: 0x01020304, score: 0 },
    ]));
    assert.deepEqual(spins, [
      { spinIndex: 0, playerTraits: 0xC0804000, score: 9, goldMatches: 4 },
      { spinIndex: 1, playerTraits: 0x01020304, score: 0, goldMatches: 0 },
    ]);
    assert.equal(degeneretteMod.decodeDegeneretteSpins('0x0102'), null, 'a partial spin is malformed');
  });

  test('degeneretteSpinPayout matches the Solidity _degenerettePayout on harness vectors', () => {
    const vectors = JSON.parse(readFileSync(
      new URL('./fixtures/degenerette-payout-vectors.json', import.meta.url), 'utf8'));
    assert.ok(vectors.length > 600);
    for (const [currency, stake, activity, score, gold, expected] of vectors) {
      assert.equal(
        String(degeneretteMod.degeneretteSpinPayout({
          currency, amountPerSpin: BigInt(stake), activityScore: activity, score, goldMatches: gold,
        })),
        expected,
        `currency ${currency} stake ${stake} activity ${activity} S${score} gold ${gold}`,
      );
    }
  });

  test('degeneretteSpinResults prices every spin from the bet word', () => {
    // S4 = 10x base; one matched gold is ×5/4; FLIP at activity 0 returns 90%:
    // 100 FLIP × 10 × 1.25 × 0.9 = 1,125 FLIP.
    const word = betWord({ symbol: 21, spinCount: 2, currency: 1, stakeUnits: 100n });
    const rows = degeneretteMod.degeneretteSpinResults({
      player: CONNECTED, index: 7n, betId: 3n,
      spins: spinsHex([{ traits: 0x01020304, score: 4, gold: 1 }, { traits: 0x05060708, score: 0 }]),
    }, word);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].payout, 1_125n * FLIP);
    assert.equal(rows[0].matches, 4n);
    assert.equal(rows[0].goldMatches, 1n);
    assert.equal(rows[0].index, 7n);
    assert.equal(rows[1].payout, 0n);
    assert.equal(degeneretteMod.degeneretteSpinResults({ spins: '0x' }, word), null);
    assert.equal(degeneretteMod.degeneretteSpinResults({ spins: rows }, 0n), null,
      'without the bet word no payout is guessed');
  });
});

// ===========================================================================
// Fresh-state reads + exact chain replay by (player, index, betId).
// ===========================================================================

describe('degenerette fresh-state and chain replay', () => {
  let fake;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    fake = makeFakeContract({ betInfo: 0x1234n });
    degeneretteMod.__setContractFactoryForTest(() => fake);
  });

  afterEach(() => {
    degeneretteMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('readBetInfo reads the exact (index, betId) queue slot', async () => {
    assert.equal(
      await degeneretteMod.readBetInfo({ index: 7, betId: 42 }),
      0x1234n,
    );
    assert.deepEqual(fake._calls.degeneretteBetInfo, [[7n, 42n]]);
    assert.equal(await degeneretteMod.readBetInfo({ betId: 42 }), null, 'no index, no slot');
  });

  test('canResolveBets simulates the exact settle entrypoint', async () => {
    assert.equal(await degeneretteMod.canResolveBets({ index: 7, betIds: [42] }), true);
    assert.equal(await degeneretteMod.canResolveBets({ betIds: [42] }), false);
  });

  function eventContract(queries, { spins, packed = null, placedPacked = null } = {}) {
    return {
      filters: {
        DegeneretteResolved: (player, index, betId) => ({ event: 'resolved', player, index, betId }),
        DegeneretteBetPlaced: (player, index, betId) => ({ event: 'placed', player, index, betId }),
      },
      queryFilter: async (filter, from, to) => {
        queries.push({ filter, from, to });
        if (filter.event === 'resolved') {
          return [{
            transactionHash: '0xresolved-transaction',
            args: {
              player: CONNECTED, index: 7n, betId: 42n,
              totalPayout: 2_250n * FLIP, resultTraits: 13n, spins,
            },
          }];
        }
        return placedPacked == null ? [] : [{
          args: { player: CONNECTED, index: 7n, betId: 42n, packed: placedPacked },
        }];
      },
      _packed: packed,
    };
  }

  test('a settled bet replays from exact (player, index, betId) topics, priced from its placement', async () => {
    const queries = [];
    contractsMod.setProvider({ ...makeFakeProvider(CONNECTED), getBlockNumber: async () => 5000 });
    const word = betWord({ symbol: 21, spinCount: 1, currency: 1, stakeUnits: 100n });
    degeneretteMod.__setContractFactoryForTest(() => eventContract(queries, {
      spins: spinsHex([{ traits: 21, score: 4, gold: 1 }]),
      placedPacked: word,
    }));

    const replay = await degeneretteMod.readResolvedBet({ player: CONNECTED, index: 7, betId: 42 });
    assert.equal(replay.resolved.totalPayout, 2_250n * FLIP);
    assert.equal(replay.resolved.resultTraits, 13n);
    assert.equal(replay.resolved.index, 7n);
    assert.equal(replay.resolved.spinCount, 1n);
    assert.equal(replay.resolved.transactionHash, '0xresolved-transaction');
    assert.equal(replay.spins.length, 1);
    assert.equal(replay.spins[0].playerTraits, 21n);
    assert.equal(replay.spins[0].payout, 1_125n * FLIP, 'the retired per-spin payout, recomputed');
    assert.equal(replay.packedData, word);
    assert.ok(queries.every((query) => query.to - query.from < 1800));
    assert.ok(queries.every((query) => query.filter.player === CONNECTED));
    assert.ok(queries.every((query) => query.filter.index === 7n && query.filter.betId === 42n));
    const count = queries.length;
    assert.equal(
      (await degeneretteMod.readResolvedBet({ player: CONNECTED, index: 7, betId: 42 })).resolved.totalPayout,
      2_250n * FLIP,
    );
    assert.equal(queries.length, count, 'an immutable settled replay is never scanned twice');
  });

  test('a known bet word skips the placement scan', async () => {
    const queries = [];
    contractsMod.setProvider({ ...makeFakeProvider(CONNECTED), getBlockNumber: async () => 5000 });
    degeneretteMod.__setContractFactoryForTest(() => eventContract(queries, {
      spins: spinsHex([{ traits: 21, score: 0 }]),
    }));
    const word = betWord({ spinCount: 1, currency: 1, stakeUnits: 100n });
    const replay = await degeneretteMod.readResolvedBet({ player: CONNECTED, index: 7, betId: 42, packedData: word });
    assert.equal(replay.spins[0].payout, 0n);
    assert.ok(queries.every((query) => query.filter.event === 'resolved'));
  });

  test('chain replay refuses a settlement whose spins do not cover every placed spin', async () => {
    contractsMod.setProvider({ ...makeFakeProvider(CONNECTED), getBlockNumber: async () => 5000 });
    degeneretteMod.__setContractFactoryForTest(() => eventContract([], {
      spins: spinsHex([{ traits: 21, score: 4 }]),
      placedPacked: betWord({ spinCount: 2, currency: 1, stakeUnits: 100n }),
    }));
    const replay = await degeneretteMod.readResolvedBet({ player: CONNECTED, index: 7, betId: 42 });
    assert.equal(replay, null, 'spin 1 must exist before a two-spin reveal is staged');
  });
});

// ===========================================================================
// Settlement receipt narrowing — a keeper sweep settles many bets per tx.
// ===========================================================================

describe('degeneretteSettlementReceipt', () => {
  const GAME = '0x00000000000000000000000000000000000000ga'.replace('ga', 'aa');
  const OTHER = '0xcd34000000000000000000000000000000000000';
  let iface;
  let enc;

  beforeEach(async () => {
    const { ethers } = await import('ethers');
    iface = new ethers.Interface([
      'event DegeneretteResolved(address indexed player, uint32 indexed index, uint64 indexed betId, uint256 totalPayout, uint32 resultTraits, bytes spins)',
      'event LootBoxOpened(address indexed player, uint48 indexed lootboxIndex, uint256 amount, uint24 futureLevel, uint32 futureTickets, uint256 flip, bool roundedUp)',
      'event BoxSpin(address indexed player, uint64 betId, uint256 packedSpins, uint256 payout, uint256 ethShare)',
      'event PayoutCapped(address indexed player, uint256 cappedEthPayout, uint256 excessConverted)',
    ]);
    let index = 0;
    enc = (name, args) => {
      const { data, topics } = iface.encodeEventLog(iface.getEvent(name), args);
      return { data, topics, address: GAME, index: index++ };
    };
  });

  test('keeps only this bet\'s Luckbox window, its settlement and its record chain', () => {
    const RECORD_BET_ID = (1n << 63n) | (3n << 60n) | 5n;
    const logs = [
      enc('LootBoxOpened', [CONNECTED, 7, 1n, 1, 4, 0n, false]),      // 0 player's human box at index 7
      enc('LootBoxOpened', [OTHER, 0, 1n, 1, 4, 0n, false]),          // 1 other bettor's direct box
      enc('DegeneretteResolved', [OTHER, 7, 1n, 5n, 1, '0x0000000104']), // 2 other bettor's settlement
      enc('PayoutCapped', [CONNECTED, 1n, 2n]),                       // 3 our bet's pool cap
      enc('LootBoxOpened', [CONNECTED, 0, 9n, 1, 4, 0n, false]),      // 4 our direct box
      enc('DegeneretteResolved', [CONNECTED, 7, 2n, 9n, 1, '0x0000000109']), // 5 our settlement
      enc('BoxSpin', [CONNECTED, RECORD_BET_ID, 0n, 3n, 0n]),         // 6 our record chain
      enc('LootBoxOpened', [CONNECTED, 8, 1n, 1, 4, 0n, false]),      // 7 next index's human box
    ];
    const own = degeneretteMod.degeneretteSettlementReceipt({ hash: '0xsweep', logs }, {
      player: CONNECTED, index: 7, betId: 2, game: GAME,
    });
    assert.deepEqual(own.logs.map((log) => log.index), [3, 4, 5, 6]);
    assert.equal(own.hash, '0xsweep');

    const theirs = degeneretteMod.degeneretteSettlementReceipt({ logs }, {
      player: OTHER, index: 7, betId: 1, game: GAME,
    });
    assert.deepEqual(theirs.logs.map((log) => log.index), [1, 2]);
    assert.equal(degeneretteMod.degeneretteSettlementReceipt({ logs }, {
      player: CONNECTED, index: 7, betId: 3, game: GAME,
    }), null, 'no settlement for that bet in this receipt');
  });

  test('a bet whose spins leave no Luckbox is never handed a neighbour\'s box', () => {
    const logs = [
      enc('LootBoxOpened', [CONNECTED, 0, 1n, 1, 4, 0n, false]),      // an AFKing box of ours
      enc('DegeneretteResolved', [CONNECTED, 7, 1n, 0n, 1, '0x0000000100']),
    ];
    // FLIP bets never open a direct box; neither does an ETH bet with no spin above 3x.
    const flipWord = betWord({ spinCount: 1, currency: 1, stakeUnits: 100n });
    const own = degeneretteMod.degeneretteSettlementReceipt({ logs }, {
      player: CONNECTED, index: 7, betId: 1, game: GAME, packedData: flipWord,
    });
    assert.deepEqual(own.logs.map((log) => log.index), [1]);
    assert.equal(degeneretteMod.degeneretteExpectsLuckbox(flipWord, [{ payout: 10n ** 30n }]), false);
    const ethWord = betWord({ spinCount: 1, currency: 0, stakeUnits: 10n });
    const ethStake = degeneretteMod.decodeDegeneretteBetWord(ethWord).amountPerSpin;
    assert.equal(degeneretteMod.degeneretteExpectsLuckbox(ethWord, [{ payout: ethStake * 3n }]), false);
    assert.equal(degeneretteMod.degeneretteExpectsLuckbox(ethWord, [{ payout: ethStake * 3n + 1n }]), true);
  });
});

// ===========================================================================
// Receipt parsers — Phase 60 D-03 receipt-log-first source of truth.
// ===========================================================================

describe('Plan 62-03: degenerette.js receipt parsers', () => {
  test('parseBetPlacedFromReceipt returns [{player, index, betId, packed}]', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'DegeneretteBetPlaced',
          args: {
            player: CONNECTED,
            index: 7n,
            betId: 42n,
            packed: 0xdeadbeefn,
          },
        },
      },
    ]);
    const fakeContract = { interface: { parseLog: (log) => log.parsed ?? null } };
    const out = degeneretteMod.parseBetPlacedFromReceipt(receipt, fakeContract);
    assert.equal(out.length, 1);
    assert.equal(out[0].player, CONNECTED);
    assert.equal(out[0].index, 7n);
    assert.equal(out[0].betId, 42n);
    assert.equal(out[0].packed, 0xdeadbeefn);
  });

  test('parseBetResolvedFromReceipt returns DegeneretteResolved entries with decoded spins', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'DegeneretteResolved',
          args: {
            player: CONNECTED,
            index: 7n,
            betId: 42n,
            totalPayout: 5n * 10n ** 16n,
            resultTraits: 1234n,
            spins: spinsHex([{ traits: 1, score: 2 }, { traits: 2, score: 0 }, { traits: 3, score: 5, gold: 2 }]),
          },
        },
      },
    ]);
    const fakeContract = { interface: { parseLog: (log) => log.parsed ?? null } };
    const out = degeneretteMod.parseBetResolvedFromReceipt(receipt, fakeContract);
    assert.equal(out.length, 1);
    assert.equal(out[0].player, CONNECTED);
    assert.equal(out[0].index, 7n);
    assert.equal(out[0].betId, 42n);
    assert.equal(out[0].spinCount, 3n, 'spin count = 5-byte groups in `spins`');
    assert.equal(out[0].totalPayout, 5n * 10n ** 16n);
    assert.equal(out[0].resultTraits, 1234n);
    assert.equal(out[0].spins[2].goldMatches, 2);
    assert.equal(out[0].transactionHash, '0xreceipt-hash');
  });

  test('parseSpinResultsFromReceipt prices each settled spin from the bet word', () => {
    const receipt = makeFakeReceipt([
      {
        parsed: {
          name: 'DegeneretteResolved',
          args: {
            player: CONNECTED, index: 7n, betId: 42n, totalPayout: 0n, resultTraits: 0n,
            spins: spinsHex([{ traits: 1234, score: 4, gold: 1 }, { traits: 5678, score: 2 }]),
          },
        },
      },
    ]);
    const fakeContract = { interface: { parseLog: (log) => log.parsed ?? null } };
    const word = betWord({ spinCount: 2, currency: 1, stakeUnits: 100n });
    const out = degeneretteMod.parseSpinResultsFromReceipt(receipt, fakeContract, { packed: word });
    assert.equal(out.length, 2);
    assert.equal(out[0].matches, 4n);
    assert.equal(out[0].payout, 1_125n * FLIP);
    assert.equal(out[1].matches, 2n);
    assert.equal(out[1].payout, degeneretteMod.degeneretteSpinPayout({
      currency: 1, amountPerSpin: 100n * FLIP, score: 2,
    }));
    assert.deepEqual(degeneretteMod.parseSpinResultsFromReceipt(receipt, fakeContract), [],
      'no bet word, no invented payouts');
  });

  // The regression that made all of this dead: production logs carry
  // topics+data, not a `parsed` property. With no parser injected the module
  // must decode them off its own ABI.
  test('parsers decode REAL encoded logs with no injected parser', async () => {
    const { ethers } = await import('ethers');
    const iface = new ethers.Interface([
      'event DegeneretteResolved(address indexed player, uint32 indexed index, uint64 indexed betId, uint256 totalPayout, uint32 resultTraits, bytes spins)',
    ]);
    const enc = (name, args) => {
      const { data, topics } = iface.encodeEventLog(iface.getEvent(name), args);
      return { data, topics, address: '0x0000000000000000000000000000000000000001' };
    };
    const receipt = {
      status: 1,
      logs: [
        enc('DegeneretteResolved', [CONNECTED, 7, 42n, 7n * 10n ** 15n, 1234,
          spinsHex([{ traits: 1234, score: 4 }, { traits: 1234, score: 0 }])]),
      ],
    };

    const resolved = degeneretteMod.parseBetResolvedFromReceipt(receipt);
    assert.equal(resolved.length, 1, 'resolved entry decoded from a real log');
    assert.equal(resolved[0].index, 7n);
    assert.equal(resolved[0].spinCount, 2n);
    assert.equal(resolved[0].totalPayout, 7n * 10n ** 15n);
    assert.equal(resolved[0].resultTraits, 1234n);

    const spins = degeneretteMod.parseSpinResultsFromReceipt(receipt, undefined, {
      packed: betWord({ spinCount: 2, currency: 0, stakeUnits: 10_000_000n }),
    });
    assert.equal(spins.length, 2, 'both spins decoded from the one event');
    assert.equal(spins[0].spinIndex, 0n);
    assert.equal(spins[0].matches, 4n);
    assert.equal(spins[1].payout, 0n);

    // A log from another contract/event must not throw or leak through.
    const foreign = { status: 1, logs: [{ data: '0x', topics: ['0x' + '11'.repeat(32)] }] };
    assert.deepEqual(degeneretteMod.parseBetResolvedFromReceipt(foreign), []);
  });

  test('parseRecordStakeFromReceipt recovers the whole-FLIP biggest-spin claim', async () => {
    const { ethers } = await import('ethers');
    const { CONTRACTS } = await import('../chain-config.js');
    const iface = new ethers.Interface([
      'event BigRecordUpdated(uint8 indexed kind, address indexed player, uint256 value, uint128 paid, uint256 sdgnrsPaid)',
    ]);
    const log = (kind, player, paid) => ({
      ...iface.encodeEventLog(iface.getEvent('BigRecordUpdated'), [kind, player, 10n ** 18n, paid, 0n]),
      address: CONTRACTS.COINFLIP,
    });
    const receipt = { logs: [log(0, CONNECTED, 5n * FLIP), log(1, CONNECTED, 1234n * FLIP + 7n)] };
    assert.equal(degeneretteMod.parseRecordStakeFromReceipt(receipt, CONNECTED), 1234n * FLIP,
      'only the spin record, floored to whole FLIP like degeneretteRecordBounty');
    assert.equal(degeneretteMod.parseRecordStakeFromReceipt(receipt, '0xcd34000000000000000000000000000000000000'), 0n);
  });

  test('parseBetPlacedFromReceipt ignores foreign logs gracefully', () => {
    const throwingContract = {
      interface: { parseLog: () => { throw new Error('foreign'); } },
    };
    const receipt = makeFakeReceipt([{ topics: [], data: '0x' }]);
    assert.deepEqual(degeneretteMod.parseBetPlacedFromReceipt(receipt, throwingContract), []);
  });

  test('all parsers return empty array on null/empty receipt', () => {
    const fakeContract = { interface: { parseLog: () => null } };
    assert.deepEqual(degeneretteMod.parseBetPlacedFromReceipt(null, fakeContract), []);
    assert.deepEqual(degeneretteMod.parseBetResolvedFromReceipt({ logs: undefined }, fakeContract), []);
    assert.deepEqual(degeneretteMod.parseSpinResultsFromReceipt({ logs: [] }, fakeContract), []);
  });
});

// ===========================================================================
// degenerette.js source-level invariants.
// ===========================================================================

describe('Plan 62-03: degenerette.js source-level invariants', () => {
  const SRC = readFileSync(new URL('../degenerette.js', import.meta.url), 'utf8');
  const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('uses closure-form sendTx — minimum 2 occurrences (one per writer)', () => {
    const matches = SRC.match(/sendTx\(\s*\(s\)\s*=>/g) || [];
    assert.ok(matches.length >= 2, `expected >= 2 closure-form sendTx, got ${matches.length}`);
  });

  test('action label `Place degenerette bet` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Place degenerette bet'"), 'place action label present');
  });

  test('action label `Settle degenerette bet` is sent to sendTx', () => {
    assert.ok(SRC.includes("'Settle degenerette bet'"), 'settle action label present');
  });

  test('canonical ABI: placeDegeneretteBet signature', () => {
    assert.ok(
      SRC.includes('function placeDegeneretteBet(address player, uint8 currency, uint128 amountPerSpin, uint8 spinCount, uint8 symbol) external payable'),
      'canonical placeDegeneretteBet ABI fragment present',
    );
  });

  test('payable preflight carries the same ETH value as the wallet send', () => {
    assert.match(
      SRC,
      /requireStaticCall\([\s\S]*?'placeDegeneretteBet'[\s\S]*?\[buyer, cur, amount, tc, sym, \{ value \}\]/,
      'ETH bets must not be simulated with msg.value=0',
    );
  });

  test('canonical ABI: resolveDegeneretteBets(uint48 index, …) and degeneretteBetInfo(uint48, uint64)', () => {
    assert.ok(SRC.includes('function resolveDegeneretteBets(uint48 index, uint64[] calldata betIds) external'));
    assert.ok(SRC.includes('function degeneretteBetInfo(uint48 index, uint64 betId) external view returns (uint256 packed)'));
  });

  // Checked against degenerus-audit forge-out (audit 224de529): the per-spin
  // DegeneretteResult event and the degeneretteResolve community batch are gone.
  test('canonical event ABIs: DegeneretteBetPlaced + the reshaped DegeneretteResolved', () => {
    assert.ok(SRC.includes('event DegeneretteBetPlaced(address indexed player, uint32 indexed index, uint64 indexed betId, uint256 packed)'));
    assert.ok(SRC.includes('event DegeneretteResolved(address indexed player, uint32 indexed index, uint64 indexed betId, uint256 totalPayout, uint32 resultTraits, bytes spins)'));
    assert.ok(!/event DegeneretteResult\(/.test(stripped), 'no retired per-spin event in the ABI');
    assert.ok(!/degeneretteResolve\(/.test(stripped), 'no retired community batch');
    assert.ok(!/FullTicket/.test(stripped), 'no stale FullTicket* event names in code');
  });

  test('reason-map registers exactly the input errors (no batch race signal any more)', () => {
    const registers = stripped.match(/register\s*\(/g) || [];
    assert.equal(registers.length, 2, `exactly 2 register calls expected, got ${registers.length}`);
    assert.ok(/register\(\s*['"]InvalidBet['"]/.test(stripped));
    assert.ok(/register\(\s*['"]UnsupportedCurrency['"]/.test(stripped));
    assert.ok(!/BatchAlreadyTaken/.test(stripped));
  });

  test('NO pre-resolved-promise sendTx (Phase 58 closure-form gate)', () => {
    assert.equal(
      /sendTx\([a-zA-Z_]+\.[a-zA-Z_]+\(/.test(stripped),
      false,
      'NO pre-resolved promise sendTx pattern allowed',
    );
  });

  test('requireStaticCall invoked at least 2 times (one per writer)', () => {
    const matches = SRC.match(/requireStaticCall\(/g) || [];
    assert.ok(matches.length >= 2, `expected >= 2 requireStaticCall, got ${matches.length}`);
  });

  test('exports placement, the early settle, fresh-state read, parsers, and receiptParser', () => {
    assert.ok(/export\s+async\s+function\s+placeBet\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+resolveBets\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+readBetInfo\b/.test(SRC));
    assert.ok(/export\s+async\s+function\s+readResolvedBet\b/.test(SRC));
    assert.ok(!/resolveCommunityBets/.test(stripped), 'the community batch path is gone');
    assert.ok(/export\s+function\s+parseBetPlacedFromReceipt\b/.test(SRC));
    assert.ok(/export\s+function\s+parseBetResolvedFromReceipt\b/.test(SRC));
    assert.ok(/export\s+function\s+parseSpinResultsFromReceipt\b/.test(SRC));
    assert.ok(/export\s+function\s+receiptParser\b/.test(SRC));
  });

  // The parsers must decode REAL logs when no parser is injected — the panel
  // used to pass a `log.parsed`-only stub, so production parsed nothing.
  test('parsers default to receiptParser() rather than requiring a contract', () => {
    assert.match(SRC, /parseBetPlacedFromReceipt\(receipt, contract = receiptParser\(\)\)/);
    assert.match(SRC, /parseBetResolvedFromReceipt\(receipt, contract = receiptParser\(\)\)/);
    assert.match(SRC, /parseSpinResultsFromReceipt\(receipt, contract = receiptParser\(\)/);
    assert.match(SRC, /new ethers\.Interface\(DEGENERETTE_ABI\)/);
  });

  test('uses exact contract state probes instead of the retired lootbox RNG poll helper', () => {
    assert.match(SRC, /export\s+async\s+function\s+readBetInfo\b/);
    assert.match(SRC, /export\s+async\s+function\s+canResolveBets\b/);
    assert.doesNotMatch(SRC, /pollRngForLootbox/,
      'Degenerette readiness is checked against its own deployed settle entrypoint');
  });

  test('the side-effect-free resolution probe uses the public read provider', () => {
    const start = SRC.indexOf('export async function canResolveBets(');
    const end = SRC.indexOf('\n}', start) + 2;
    const probe = SRC.slice(start, end);
    assert.match(probe, /const provider = _readProvider\(\);/,
      'background readiness must use the shared public provider instead of MetaMask');
    assert.doesNotMatch(probe, /const provider = getProvider\(\);/);
  });
});
