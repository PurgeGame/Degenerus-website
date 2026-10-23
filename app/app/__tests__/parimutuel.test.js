// /app/app/__tests__/parimutuel.test.js — the Growth OVER/UNDER book.
//
// Run: cd website && node --test app/app/__tests__/parimutuel.test.js
//
// Covers the write path (placeBet), the view decoding, and the payout arithmetic. Winners
// are paid automatically, so there is no claim. Harness shape is the coinflip.test.js /
// passes.test.js fake provider+contract port.
//
// Sources (degenerus-audit/contracts/DegenerusParimutuel.sol):
//   STAKE = 1_000 FLIP — one fixed bet per wallet per round
//   placeBet(id, over)
//   _payoutFrom — STAKE * (over + under) / winCount
//   MarketClosed · AlreadyBet · NotEligible
//
// The ticket-VOLUME book is gone from the contract; a guard test below pins the module to the
// growth-only surface so the dead lane cannot silently return.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as pari from '../parimutuel.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import * as reasonMapMod from '../reason-map.js';
import { ACTIVE_CHAIN_ID } from './helpers/active-chain.js';
import { _setWalletIdForTests } from '../wallet-id.js';

const CONNECTED = '0xab12000000000000000000000000000000000000';
const CONNECTED_ID = 5;
_setWalletIdForTests(CONNECTED, CONNECTED_ID);

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeFakeTx() {
  return { hash: '0xtx-hash', wait: async () => ({ status: 1, hash: '0xreceipt-hash', logs: [] }) };
}

function makeFakeContract(opts = {}) {
  const calls = {
    placeBet: [],
  };
  const order = [];

  const staticCallStub = (name) => async (..._args) => {
    order.push(`static:${name}`);
    if (opts.staticCallShouldRevert?.[name]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[name] || 'MarketClosed' };
      throw err;
    }
    return undefined;
  };

  const writeStub = (name) => Object.assign(
    async (...args) => {
      calls[name].push(args);
      order.push(`send:${name}`);
      return makeFakeTx();
    },
    { staticCall: staticCallStub(name) },
  );

  return {
    placeBet: writeStub('placeBet'),
    // marketState(player, round) → the 8 growth returns
    marketState: async (player, round) => (
      opts.marketState ? opts.marketState(player, round) : [42, 3n, 1n, 150n * 10n ** 18n, 0, false, 0, 0n]
    ),
    connect(_signer) { return this; },
    _calls: calls,
    _order: order,
  };
}

function makeFakeProvider(connectedAddr) {
  return {
    getNetwork: async () => ({ chainId: BigInt(ACTIVE_CHAIN_ID) }),
    getSigner: async () => ({ getAddress: async () => connectedAddr }),
  };
}

// ===========================================================================
// Reason-map registrations
// ===========================================================================

describe('parimutuel.js reason-map registrations', () => {
  test('MarketClosed decodes to window copy', () => {
    const d = reasonMapMod.decodeRevertReason({ revert: { name: 'MarketClosed' } });
    assert.equal(d.code, 'MarketClosed');
    assert.match(d.userMessage, /closed/i);
  });

  test('AlreadyBet decodes to one-bet-per-round copy', () => {
    const d = reasonMapMod.decodeRevertReason({ revert: { name: 'AlreadyBet' } });
    assert.equal(d.code, 'AlreadyBet');
    assert.match(d.userMessage, /already|one per round/i);
  });

  test('NotEligible decodes to the never-bought-anything gate', () => {
    const d = reasonMapMod.decodeRevertReason({ revert: { name: 'NotEligible' } });
    assert.equal(d.code, 'NotEligible');
    assert.match(d.userMessage, /bought|buy/i);
  });

  test('does NOT re-register NotApproved (Phase 60 baseline owns it)', () => {
    const SRC = readFileSync(new URL('../parimutuel.js', import.meta.url), 'utf8');
    assert.equal(/register\(\s*['"]NotApproved['"]/.test(SRC), false);
  });

  // The tests above hand decodeRevertReason a pre-named revert, which assumes
  // work ethers can only do when the error is declared in the ABI this module
  // builds its Contract with. Undeclared, error.revert stays null, the
  // name-keyed registry misses, and the real reason collapses into the generic
  // "Unexpected error" copy. Drive the module's own ABI to prove otherwise.
  test('every bet revert is declared in the ABI, so none decodes as UNKNOWN', () => {
    const SRC = readFileSync(new URL('../parimutuel.js', import.meta.url), 'utf8');
    const abi = [...SRC.matchAll(/'(error [^']+)'/g)].map((m) => m[1]);
    const iface = new contractsMod.ethers.Interface(abi);
    // DegenerusParimutuel.sol — placeBet, plus FLIP's burn gate.
    for (const signature of [
      'NotApproved()', 'MarketClosed()', 'AlreadyBet()',
      'NotEligible()', 'OnlyGame()',
    ]) {
      // Insufficient is deliberately absent: it is a shared selector answered by
      // the write path's local override, asserted in the next test.
      const selector = contractsMod.ethers.id(signature).slice(0, 10);
      let revert = null;
      try { revert = iface.parseError(selector); } catch (_e) { revert = null; }
      assert.ok(revert, `${signature} must be declared in PARIMUTUEL_ABI`);
      const decoded = reasonMapMod.decodeRevertReason({
        code: 'CALL_EXCEPTION',
        data: selector,
        revert: { name: revert.name, selector, args: [] },
      });
      assert.notEqual(decoded.code, 'UNKNOWN',
        `${signature} fell through to the generic unexpected-error copy`);
      assert.doesNotMatch(decoded.userMessage, /Unexpected error/i,
        `${signature} must explain itself to the player`);
    }
  });

  // Insufficient is a shared FLIP selector. affiliate.js claims it globally for
  // a taken referral code and coinflip.js for a short stake, and register() is a
  // plain Map.set — so the global copy depends on import order and can say
  // "That code is already taken" to someone placing a bet. The betting path must
  // therefore answer from its own table, and must name the fixed 1,000 stake.
  test('an under-funded bet names the 1,000 FLIP stake, not shared Insufficient copy', async () => {
    await import('../affiliate.js');
    await import('../coinflip.js');
    const shared = reasonMapMod.decodeRevertReason({ revert: { name: 'Insufficient' } });

    const SRC = readFileSync(new URL('../parimutuel.js', import.meta.url), 'utf8');
    const abi = [...SRC.matchAll(/'(error [^']+)'/g)].map((m) => m[1]);
    const selector = contractsMod.ethers.id('Insufficient()').slice(0, 10);
    const revert = new contractsMod.ethers.Interface(abi).parseError(selector);
    assert.ok(revert, 'Insufficient must be declared so ethers can name it');

    const bet = pari.__structuredRevertErrorForTest(
      { code: 'CALL_EXCEPTION', data: selector, revert: { name: revert.name, selector, args: [] } },
      'static-call placeBet',
    );
    assert.equal(bet.code, 'Insufficient');
    assert.match(bet.userMessage, /1,000 FLIP/,
      'the fixed stake is the number the player needs to see');
    assert.notEqual(bet.userMessage, shared.userMessage,
      'the betting copy does not inherit whichever module registered Insufficient last');
    assert.doesNotMatch(bet.userMessage, /code is already taken/i);
  });
});

// ===========================================================================
// Pure helpers — no chain, no DOM.
// ===========================================================================

describe('payoutPerWinner mirrors _payoutFrom', () => {
  test('STAKE * (over + under) / winCount', () => {
    assert.equal(
      pari.payoutPerWinner(3n, 1n, pari.SIDE_OVER),
      (pari.STAKE_WEI * 4n) / 3n,
    );
    assert.equal(
      pari.payoutPerWinner(3n, 1n, pari.SIDE_UNDER),
      pari.STAKE_WEI * 4n,
    );
  });

  test('an empty losing side pays exactly the stake back', () => {
    assert.equal(pari.payoutPerWinner(2n, 0n, pari.SIDE_OVER), pari.STAKE_WEI);
  });

  test('an empty winning side quotes 0 rather than dividing by zero', () => {
    assert.equal(pari.payoutPerWinner(2n, 0n, pari.SIDE_UNDER), 0n);
  });

  test('the stake is 1,000 FLIP, unscaled on both chains', () => {
    assert.equal(pari.STAKE_WEI, 1_000n * 10n ** 18n);
  });
});

// ===========================================================================
// Reads
// ===========================================================================

describe('view decoding', () => {
  afterEach(() => {
    pari.__resetContractFactoryForTest();
    pari.__resetGameFactoryForTest();
    pari.__resetQuestFactoryForTest();
    contractsMod.clearProvider();
  });

  test('readGrowthMarket maps the 8 marketState returns', async () => {
    pari.__setContractFactoryForTest(() => makeFakeContract({
      marketState: () => [42, 3n, 1n, 150n, 1, false, 1, 4_000n], // raw whole FLIP
    }));
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const s = await pari.readGrowthMarket({ player: CONNECTED, round: 42 });
    assert.equal(s.round, 42);
    assert.equal(s.openRound, 42);
    assert.equal(s.overCount, 3n);
    assert.equal(s.underCount, 1n);
    assert.equal(s.questReward, 150n * 10n ** 18n);
    assert.equal(s.side, pari.SIDE_OVER);
    assert.equal(s.claimed, false);
    assert.equal(s.outcome, pari.SIDE_OVER);
    assert.equal(s.payout, 4_000n * 10n ** 18n);
  });

  test('the volume book stays excised (the contract has no volume surface)', () => {
    assert.equal(pari.readVolumeMarket, undefined);
    assert.equal(pari.readVolumeCredit, undefined);
    assert.equal(pari.placeVolumeBet, undefined);
    assert.equal(pari.claimVolume, undefined);
    assert.equal(pari.claimVolumeRound, undefined);
    assert.equal(pari.readLastVolumeSeal, undefined);
  });

  test('readMarketBetGates keeps bet permission separate from bonus eligibility', async () => {
    pari.__setQuestFactoryForTest(() => ({
      marketBetGates: async (player, level) => {
        assert.equal(player, CONNECTED_ID, 'the quest gate is keyed by wallet ID');
        assert.equal(level, 42);
        return [true, false];
      },
    }));
    assert.deepEqual(
      await pari.readMarketBetGates({ player: CONNECTED, level: 42 }),
      { mayBet: true, earnsReward: false },
    );
  });

  test('phase context reads the exact last-purchase-day latch', async () => {
    pari.__setGameFactoryForTest(() => ({
      purchaseInfo: async () => [38, false, true, false, 0n],
      jackpotDuration: async () => 3,
    }));
    assert.deepEqual(await pari.readJackpotPhaseContext(), {
      level: 38,
      jackpot: false,
      lastPurchaseDay: true,
      rngLocked: false,
      jackpotDays: 3,
    });
  });

  test('a turbo schedule (jackpotDuration() = 1) survives the read verbatim', async () => {
    pari.__setGameFactoryForTest(() => ({
      purchaseInfo: async () => [38, true, false, true, 0n],
      jackpotDuration: async () => 1,
    }));
    assert.equal((await pari.readJackpotPhaseContext()).jackpotDays, 1);
  });

  test('a failed jackpotDuration() read reports null, never a forged normal schedule', async () => {
    // Returning 3 for a failed read would make a transient RPC error indistinguishable from
    // a genuine normal cadence and mask a live turbo behind a three-day label.
    pari.__setGameFactoryForTest(() => ({
      purchaseInfo: async () => [38, true, false, true, 0n],
      jackpotDuration: async () => { throw new Error('rpc hiccup'); },
    }));
    const context = await pari.readJackpotPhaseContext();
    assert.equal(context.jackpotDays, null);
    assert.equal(context.level, 38, 'the rest of the snapshot is still usable');
    assert.equal(context.jackpot, true);
  });

  test('growthState round 0 remains readable for the level-1 bootstrap target', async () => {
    const calls = [];
    pari.__setGameFactoryForTest(() => ({
      growthState: async (round) => {
        calls.push(round);
        return [0n, 0n, 0n, 0, false, 0];
      },
    }));
    assert.deepEqual(await pari.readGrowthRatchets({ round: 0 }), {
      prev: 0n,
      current: 0n,
      next: 0n,
      currentLevel: 0,
      bettingOpen: false,
      phaseDay: 0,
    });
    assert.deepEqual(calls, [0]);
  });

  test('historical final pools cover three levels per growthState read and stay cached', async () => {
    const calls = [];
    pari.__setGameFactoryForTest(() => ({
      growthState: async (round) => {
        calls.push(round);
        if (round === 2) return [50n, 64n, 81n, 4, false, 0];
        if (round === 5) return [100n, 0n, 0n, 4, false, 0];
        throw new Error('unexpected history center');
      },
    }));
    assert.deepEqual(await pari.readGrowthRatchetHistory({ throughLevel: 4 }), [
      { level: 1, poolWei: 50n },
      { level: 2, poolWei: 64n },
      { level: 3, poolWei: 81n },
      { level: 4, poolWei: 100n },
    ]);
    assert.deepEqual(calls, [2, 5], 'centers 2 and 5 cover levels 1 through 4');

    await pari.readGrowthRatchetHistory({ throughLevel: 4 });
    assert.deepEqual(calls, [2, 5], 'write-once ratchets are not re-read on every panel poll');
  });
});

// ===========================================================================
// Writes
// ===========================================================================

describe('bet placement', () => {
  let fake;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    fake = makeFakeContract();
    pari.__setContractFactoryForTest(() => fake);
  });

  afterEach(() => {
    pari.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('placeGrowthBet calls placeBet(0, over) for the connected wallet after a static-call pre-flight', async () => {
    await pari.placeGrowthBet({ player: CONNECTED, over: true });
    assert.deepEqual(fake._calls.placeBet, [[0, true]]);
    assert.deepEqual(fake._order, ['static:placeBet', 'send:placeBet']);
  });

  test('a reverting pre-flight surfaces the mapped message and never sends', async () => {
    fake = makeFakeContract({
      staticCallShouldRevert: { placeBet: true },
      staticCallRevertName: { placeBet: 'AlreadyBet' },
    });
    pari.__setContractFactoryForTest(() => fake);
    await assert.rejects(
      pari.placeGrowthBet({ player: CONNECTED, over: true }),
      /already/i,
    );
    assert.deepEqual(fake._calls.placeBet, [], 'no tx sent');
  });

  test('rejects with no player', async () => {
    await assert.rejects(pari.placeGrowthBet({ over: true }), /Wallet not connected/i);
  });
});

// ===========================================================================
// Structural gates — the Phase 58 chokepoint contract.
// ===========================================================================

describe('parimutuel.js structural gates', () => {
  const SRC = readFileSync(new URL('../parimutuel.js', import.meta.url), 'utf8');

  test('every sendTx call is closure-form (no pre-resolved tx promise)', () => {
    assert.equal(/sendTx\([a-zA-Z_]+\.[a-zA-Z_]+\(/.test(SRC), false);
    assert.match(SRC, /sendTx\(\s*\(s\) =>/);
  });

  test('no raw scaling literals (Plan 56-05 divisor sweep)', () => {
    assert.equal(/\/\s*100n|\/\s*1_000_000n/.test(SRC), false);
  });
});
// ===========================================================================
// Benchmark helpers (user call 2026-07-29): the books show the number the open
// round has to beat, never a payout quote.
// ===========================================================================

describe('growthBps', () => {
  test('a ratio of consecutive pools, in basis points', () => {
    assert.equal(pari.growthBps(100n, 115n), 1500);
    assert.equal(pari.growthBps(80n * 10n ** 18n, 92n * 10n ** 18n), 1500);
  });

  test('a shrink is signed, not clamped — it is real information', () => {
    assert.equal(pari.growthBps(100n, 90n), -1000);
  });

  test('no prior pool (level 1, or an unbanked term) reads null, not 0%', () => {
    assert.equal(pari.growthBps(0n, 100n), null);
    assert.equal(pari.growthBps(100n, 0n), null);
    assert.equal(pari.growthBps(null, undefined), null);
  });
});

test('pool benchmarks read phase, target and ratchets at one block during a level transition', async () => {
  const calls = [];
  const blockTag = 47018167;
  const pinned = (name, out) => async (...args) => {
    calls.push([name, args]);
    assert.equal(args.at(-1)?.blockTag, blockTag, `${name} must not read a different latest state`);
    return out;
  };
  pari.__setGameFactoryForTest(() => ({
    purchaseInfo: pinned('phase', [413, false, true, true, 0n]),
    jackpotDuration: pinned('duration', 1),
    growthState: pinned('ratchets', [29992980031120142n, 0n, 0n, 413, false, 0]),
    prizePoolTargetView: pinned('target', 50000000000000n),
  }));
  try {
    const snapshot = await pari.readPoolBenchmarkSnapshot({ blockTag });
    assert.equal(snapshot.level, 413);
    assert.equal(snapshot.ratchets.prev, 29992980031120142n);
    assert.equal(snapshot.phaseContext.lastPurchaseDay, true);
    assert.equal(calls.find(([name]) => name === 'ratchets')[1][0], 413);
    assert.equal(calls.length, 4);
  } finally { pari.__resetGameFactoryForTest(); }
});
