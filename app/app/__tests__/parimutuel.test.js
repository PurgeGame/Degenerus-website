// /app/app/__tests__/parimutuel.test.js — the two OVER/UNDER books.
//
// Run: cd website && node --test app/app/__tests__/parimutuel.test.js
//
// Covers the write paths (placeBet / placeVolumeBet / claim / claimVolume), the
// view decoding, the payout arithmetic and the clock helpers. Harness shape is
// the coinflip.test.js / passes.test.js fake provider+contract port.
//
// Sources (degenerus-audit/contracts/DegenerusParimutuel.sol):
//   :66  STAKE = 1_000 ether — one fixed bet per address per round, both books
//   :257 placeBet(player, over)          :303 claim(player, rounds[])
//   :440 placeVolumeBet(player, over)    :499 claimVolume(player, rounds[])
//   :477 _openVolumeRound — window off the clock, round = day index + 1
//   :718 _payoutFrom — STAKE * (over + under) / winCount
//   :141 MarketClosed  :144 AlreadyBet  :149 NothingToSettle  :154 NotEligible
//
// The testnet overlay rescales the volume window with the 600s game day
// (contracts-testnet/DegenerusParimutuel.sol:478 — `(ts - 82620) % 600 < 540`),
// and chain-config.sepolia.js VOLUME_WINDOW mirrors those constants. The clock
// tests below are written against that active profile.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as pari from '../parimutuel.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';
import * as reasonMapMod from '../reason-map.js';
import { VOLUME_WINDOW } from '../chain-config.js';

const CONNECTED = '0xab12000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeFakeTx() {
  return { hash: '0xtx-hash', wait: async () => ({ status: 1, hash: '0xreceipt-hash', logs: [] }) };
}

function makeFakeContract(opts = {}) {
  const calls = {
    placeBet: [],
    placeVolumeBet: [],
    claim: [],
    claimVolume: [],
    claimRound: [],
    claimVolumeRound: [],
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
    placeVolumeBet: writeStub('placeVolumeBet'),
    claim: writeStub('claim'),
    claimVolume: writeStub('claimVolume'),
    claimRound: writeStub('claimRound'),
    claimVolumeRound: writeStub('claimVolumeRound'),
    // marketState(player, round) → the 8 growth returns
    marketState: async (player, round) => (
      opts.marketState ? opts.marketState(player, round) : [42, 3n, 1n, 150n * 10n ** 18n, 0, false, 0, 0n]
    ),
    // volumeMarketState(player, round) → the 8 volume returns (adds `voided`)
    volumeMarketState: async (player, round) => (
      opts.volumeMarketState ? opts.volumeMarketState(player, round) : [88, 2n, 5n, 0, false, 0, false, 0n]
    ),
    volumeBetCredit: async () => (opts.volumeBetCredit ?? 25n * 10n ** 18n),
    connect(_signer) { return this; },
    _calls: calls,
    _order: order,
  };
}

function makeFakeProvider(connectedAddr) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
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

describe('volumeWindow / volumeRoundNow mirror _openVolumeRound', () => {
  const { anchor, period, openSeconds } = VOLUME_WINDOW;

  test('active testnet profile matches the deployed post-change clock constants', () => {
    assert.equal(period, 600);
    assert.equal(openSeconds, 540);
    assert.equal(VOLUME_WINDOW.creditDecayStart, 154);
    assert.equal(VOLUME_WINDOW.creditDecayStep, 86);
  });

  test('open at the top of a game day, for openSeconds', () => {
    const w = pari.volumeWindow(anchor + period * 5);
    assert.equal(w.open, true);
    assert.equal(w.secondsToClose, openSeconds);
  });

  test('closed once the window elapses, counting down to the next open', () => {
    const w = pari.volumeWindow(anchor + period * 5 + openSeconds);
    assert.equal(w.open, false);
    assert.equal(w.secondsToOpen, period - openSeconds);
  });

  test('the last second of the window still reads open', () => {
    const w = pari.volumeWindow(anchor + period * 5 + openSeconds - 1);
    assert.equal(w.open, true);
    assert.equal(w.secondsToClose, 1);
  });

  // Day indices are DEPLOY-relative (GameTimeLib:34), so a round is a small
  // number. Verified against live VolumeRoundSealed logs on the current deploy:
  // round 22 sealed in the window at day index 22.
  test('round = deploy-relative day index + 1', () => {
    const { deployDayBoundary: base } = VOLUME_WINDOW;
    assert.ok(Number.isFinite(base), 'the active profile carries a deploy boundary');
    assert.equal(pari.volumeRoundNow(anchor + period * base), 2, 'deploy day → day 1 → round 2');
    assert.equal(pari.volumeRoundNow(anchor + period * (base + 21) + 18), 23,
      'day index 22 (the round 22 seal) is betting into round 23');
  });
});

// ===========================================================================
// Reads
// ===========================================================================

describe('view decoding', () => {
  afterEach(() => {
    pari.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('readGrowthMarket maps the 8 marketState returns', async () => {
    pari.__setContractFactoryForTest(() => makeFakeContract({
      marketState: () => [42, 3n, 1n, 150n * 10n ** 18n, 1, false, 1, 4_000n * 10n ** 18n],
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

  test('readVolumeMarket carries the voided flag (no growth equivalent)', async () => {
    pari.__setContractFactoryForTest(() => makeFakeContract({
      volumeMarketState: () => [0, 2n, 5n, 2, false, 0, true, pari.STAKE_WEI],
    }));
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    const s = await pari.readVolumeMarket({ player: CONNECTED, round: 87 });
    assert.equal(s.openRound, 0, 'closed book reports openRound 0');
    assert.equal(s.side, pari.SIDE_UNDER);
    assert.equal(s.voided, true);
    assert.equal(s.payout, pari.STAKE_WEI, 'a voided round refunds the stake');
  });

  test('readVolumeCredit returns the decaying placement credit', async () => {
    pari.__setContractFactoryForTest(() => makeFakeContract({ volumeBetCredit: 15n * 10n ** 18n }));
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    assert.equal(await pari.readVolumeCredit(), 15n * 10n ** 18n);
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

  test('placeGrowthBet calls placeBet(player, over) after a static-call pre-flight', async () => {
    await pari.placeGrowthBet({ player: CONNECTED, over: true });
    assert.deepEqual(fake._calls.placeBet, [[CONNECTED, true]]);
    assert.deepEqual(fake._order, ['static:placeBet', 'send:placeBet']);
  });

  test('placeVolumeBet calls placeVolumeBet(player, over)', async () => {
    await pari.placeVolumeBet({ player: CONNECTED, over: false });
    assert.deepEqual(fake._calls.placeVolumeBet, [[CONNECTED, false]]);
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

describe('claims', () => {
  let fake;

  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    fake = makeFakeContract();
    pari.__setContractFactoryForTest(() => fake);
  });

  afterEach(() => {
    pari.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('claimGrowth passes the round list through', async () => {
    await pari.claimGrowth({ player: CONNECTED, rounds: [41, 40] });
    assert.deepEqual(fake._calls.claim, [[CONNECTED, [41, 40]]]);
  });

  test('claimVolume passes the round list through', async () => {
    await pari.claimVolume({ player: CONNECTED, rounds: [87] });
    assert.deepEqual(fake._calls.claimVolume, [[CONNECTED, [87]]]);
  });

  test('drops non-positive / non-integer rounds and refuses an empty batch', async () => {
    await pari.claimGrowth({ player: CONNECTED, rounds: [41, 0, -3, 'x'] });
    assert.deepEqual(fake._calls.claim, [[CONNECTED, [41]]]);
    await assert.rejects(
      pari.claimGrowth({ player: CONNECTED, rounds: [0] }),
      /Nothing to claim/i,
    );
  });

  test('community growth claim keeps the clicked player first and dedupes winners', async () => {
    const other = '0xcd34000000000000000000000000000000000000';
    const result = await pari.claimGrowthRound({
      player: CONNECTED,
      round: 41,
      players: [other, CONNECTED.toUpperCase(), other],
    });
    assert.deepEqual(fake._calls.claimRound, [[41, [CONNECTED, other]]]);
    assert.deepEqual(result.players, [CONNECTED, other]);
    assert.deepEqual(fake._order, ['static:claimRound', 'send:claimRound']);
  });
});

describe('readRoundWinners', () => {
  afterEach(() => {
    pari.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('discovers only the winning side and stops at the expected winner count', async () => {
    const winnerA = '0x1111000000000000000000000000000000000000';
    const loser = '0x2222000000000000000000000000000000000000';
    const winnerB = '0x3333000000000000000000000000000000000000';
    const queries = [];
    const provider = {
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => 9000,
    };
    const contract = {
      filters: {
        BetPlaced: (player, round) => ({ player, round }),
      },
      queryFilter: async (filter, from, to) => {
        queries.push({ filter, from, to });
        return [
          { args: { player: winnerA, over: true } },
          { args: { player: loser, over: false } },
          { args: { player: winnerB, over: true } },
          { args: { player: winnerA.toUpperCase(), over: true } },
        ];
      },
    };
    contractsMod.setProvider(provider);
    pari.__setContractFactoryForTest(() => contract);

    assert.deepEqual(await pari.readRoundWinners({
      kind: 'growth',
      round: 41,
      outcome: pari.SIDE_OVER,
      expectedCount: 2,
    }), [winnerA, winnerB]);
    assert.equal(queries.length, 1, 'the expected count stops the backwards scan');
    assert.equal(queries[0].filter.round, 41);
    assert.ok(queries[0].to - queries[0].from < 1800, 'RPC range stays under the cap');
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

describe('UNITS_PER_TICKET', () => {
  test('400 raw purchase units = one whole ticket (4 entries x QTY_SCALE 100)', () => {
    assert.equal(pari.UNITS_PER_TICKET, 400n);
  });
});

describe('readLastVolumeSeal', () => {
  const SRC = readFileSync(new URL('../parimutuel.js', import.meta.url), 'utf8');

  test('the seal carries the volume series the contract keeps private', () => {
    assert.match(SRC, /event VolumeRoundSealed\(uint24 indexed round, uint48 total, uint48 previous\)/);
  });

  // Public RPCs cap eth_getLogs by block range (Base Sepolia: 2,000), so a
  // from-zero query returns NOTHING — found live, 2026-07-29. The scan walks
  // back from the head in under-cap chunks instead.
  test('scans backwards in chunks under the RPC block-range cap', () => {
    assert.match(SRC, /LOG_CHUNK_BLOCKS = 1800/);
    assert.match(SRC, /queryFilter\(contract\.filters\.VolumeRoundSealed\(\), from, to\)/);
    assert.ok(!/queryFilter\([^)]*\b0, 'latest'/.test(SRC), 'no unbounded from-zero log query');
  });

  test('an unreachable head or log service reads null, not a throw', async () => {
    pari.__setContractFactoryForTest(() => ({
      filters: { VolumeRoundSealed: () => ({}) },
      queryFilter: async () => { throw new Error('range too wide'); },
      connect() { return this; },
    }));
    assert.equal(await pari.readLastVolumeSeal(), null);
    pari.__resetContractFactoryForTest();
  });
});
