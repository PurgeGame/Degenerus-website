import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

globalThis.HTMLElement ||= class HTMLElement {};
globalThis.customElements ||= {
  registry: new Map(),
  get(name) { return this.registry.get(name); },
  define(name, ctor) { this.registry.set(name, ctor); },
};

const {
  growthOverTargetWei,
  growthLinePercent,
  poolProgressModel,
  sampledPoolHistory,
  prizePoolThermometerContext,
  jackpotPoolModel,
  jackpotCadenceModel,
  jackpotCompressionTier,
  isTurboTier,
  jackpotDrawCounter,
  jackpotPrizePoolWei,
  phaseStripModel,
  poolTargetMarkerLabel,
  prizePoolTargetForLevel,
  transitionJackpotCountdownModel,
  transitionJackpotLockedLabel,
  purchaseTurboJackpotModel,
  LEVEL_ONE_TARGET_WEI,
} = await import('../app-pool-progress.js');
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolvePath(__dirname, '../../index.html'), 'utf8');
const css = readFileSync(resolvePath(__dirname, '../../styles/app.css'), 'utf8');
const drawingCss = readFileSync(resolvePath(__dirname, '../../styles/daily-drawing.css'), 'utf8');
const pari = readFileSync(resolvePath(__dirname, '../app-parimutuel-panel.js'), 'utf8');
const component = readFileSync(resolvePath(__dirname, '../app-pool-progress.js'), 'utf8');

describe('next-pool progression model', () => {
  test('level 1 always uses the contract bootstrap target of 50 ETH', () => {
    assert.equal(LEVEL_ONE_TARGET_WEI, 50_000_000_000_000n,
      'the active testnet profile stores 50 ETH in /1M-scaled wei');
    assert.equal(prizePoolTargetForLevel(1, null), LEVEL_ONE_TARGET_WEI);
    assert.equal(prizePoolTargetForLevel(1, 999n), LEVEL_ONE_TARGET_WEI,
      'a stale benchmark cannot replace the genesis invariant');
    assert.equal(
      poolProgressModel({ nextWei: 25_000_000_000_000n, targetWei: LEVEL_ONE_TARGET_WEI })
        .levelPercent,
      50,
    );
  });

  test('growth marker is the exact strict O/U threshold', () => {
    assert.equal(growthOverTargetWei({ prev: 80n, current: 100n }), 126n,
      'first integer satisfying live * 80 > 100²');
    assert.equal(growthOverTargetWei({ prev: 0n, current: 100n }), null);
  });

  test('does not invent progress while the contract benchmark is loading', () => {
    const loading = poolProgressModel({ nextWei: 13_461n });
    assert.equal(loading.target, null);
    assert.equal(loading.levelPercent, null);
    assert.equal(loading.fillPercent, 0,
      'a pool cannot be positioned honestly until its guarantee is known');
  });

  test('keeps the closing pool separate from the next ticket level after final-day lock', () => {
    const closing = prizePoolThermometerContext({
      phaseLevel: 55,
      benchmarkLevel: 54,
      targetWei: 50n,
      ratchets: { prev: 12_182n, current: 0n, next: 0n },
      contractPhase: {
        level: 54,
        jackpot: false,
        lastPurchaseDay: true,
        rngLocked: true,
      },
    });
    assert.deepEqual(closing, {
      level: 54,
      targetWei: 12_182n,
      closing: true,
    }, 'the promoted buy route must not relabel the still-live closing pool or use bootstrap');

    assert.deepEqual(prizePoolThermometerContext({
      phaseLevel: 54,
      benchmarkLevel: 53,
      targetWei: 12_182n,
      ratchets: { prev: 11_000n, current: 12_182n },
      contractPhase: {
        level: 53,
        jackpot: false,
        lastPurchaseDay: false,
        rngLocked: false,
      },
    }), {
      level: 54,
      targetWei: 12_182n,
      closing: false,
    }, 'ordinary purchase phases continue to show the level accepting tickets');
  });

  test('one scale carries live pool, level target, and growth target', () => {
    const below = poolProgressModel({
      nextWei: 110n,
      targetWei: 120n,
      ratchets: { prev: 100n, current: 110n }, // O/U line = 122
    });
    assert.equal(below.levelReady, false);
    assert.equal(below.growthOver, false);
    assert.equal(below.neededWei, 11n, 'level progression requires nextPool > target');
    assert.ok(below.fillPercent < below.targetPercent);
    assert.ok(below.targetPercent < below.growthPercent);
    assert.ok(below.growthPercent < 100, 'headroom keeps the furthest marker inside the track');
    assert.equal(below.referenceKind, 'GUARANTEE');
    assert.equal(below.referenceWei, 120n);
    assert.equal(below.referencePercent, below.targetPercent,
      'before progression the amount remains attached to its target');

    const levelReady = poolProgressModel({
      nextWei: 121n,
      targetWei: 120n,
      ratchets: { prev: 100n, current: 110n },
    });
    assert.equal(levelReady.levelReady, true);
    assert.equal(levelReady.growthOver, false);
    assert.equal(levelReady.referenceKind, 'CURRENT');
    assert.equal(levelReady.referenceWei, 121n);
    assert.equal(levelReady.referencePercent, levelReady.fillPercent,
      'after progression the amount follows the live pool edge');

    const over = poolProgressModel({
      nextWei: 122n,
      targetWei: 120n,
      ratchets: { prev: 100n, current: 110n },
    });
    assert.equal(over.growthOver, true);
  });

  test('prior-level final pools become thermometer notches only after 100%', () => {
    const history = [
      { level: 1, poolWei: 80n },
      { level: 2, poolWei: 100n },
      { level: 3, poolWei: 999n }, // current level is not historical yet
    ];
    const below = poolProgressModel({
      nextWei: 120n,
      targetWei: 120n,
      history,
      currentLevel: 3,
    });
    assert.deepEqual(below.historyMarkers, [],
      'the historical scale stays off the tube until progression is secured');

    const ready = poolProgressModel({
      nextWei: 121n,
      targetWei: 120n,
      history,
      currentLevel: 3,
    });
    assert.deepEqual(ready.historyMarkers.map(({ level, poolWei }) => ({ level, poolWei })), [
      { level: 1, poolWei: 80n },
      { level: 2, poolWei: 100n },
    ]);
    assert.ok(ready.historyMarkers[0].position < ready.historyMarkers[1].position);
    assert.ok(ready.historyMarkers[1].position < 100,
      'headroom keeps the final-pool notches inside the tube');
  });

  test('samples completed levels from the current level in five-level steps', () => {
    const history = Array.from({ length: 36 }, (_unused, index) => ({
      level: index + 1,
      poolWei: BigInt(index + 1),
    }));
    assert.deepEqual(
      sampledPoolHistory(history, 37).map(({ level, kind }) => ({ level, kind })),
      [
        { level: 1, kind: 'start' },
        { level: 7, kind: 'interval' },
        { level: 12, kind: 'interval' },
        { level: 17, kind: 'interval' },
        { level: 22, kind: 'interval' },
        { level: 27, kind: 'interval' },
        { level: 32, kind: 'interval' },
        { level: 36, kind: 'previous' },
      ],
    );
  });

  test('resets historical thermometer scaling after each completed x00 level', () => {
    const history = Array.from({ length: 202 }, (_unused, index) => ({
      level: index + 1,
      poolWei: BigInt(index + 1),
    }));

    const firstCentury = sampledPoolHistory(history, 100);
    assert.equal(firstCentury[0].level, 1,
      'level 100 still completes the first century against its original baseline');

    assert.deepEqual(
      sampledPoolHistory(history, 103).map(({ level, kind }) => ({ level, kind })),
      [
        { level: 101, kind: 'start' },
        { level: 102, kind: 'previous' },
      ],
      'the new century starts at x01 without showing the completed x00 level',
    );
    assert.deepEqual(
      sampledPoolHistory(history, 203).map(({ level, kind }) => ({ level, kind })),
      [
        { level: 201, kind: 'start' },
        { level: 202, kind: 'previous' },
      ],
      'the same x01 reset repeats at later century boundaries',
    );

    const resetScale = poolProgressModel({
      nextWei: 125n,
      targetWei: 100n,
      history: [
        { level: 99, poolWei: 100_000n },
        { level: 100, poolWei: 80n },
        { level: 101, poolWei: 90n },
      ],
      currentLevel: 102,
    });
    assert.deepEqual(resetScale.historyMarkers.map(({ level }) => level), [101]);
    assert.ok(resetScale.fillPercent > 80,
      'a prior-century high cannot flatten the reset pool against the left edge');
  });

  test('the completed target keeps its special notch but uses completed-level hover copy', () => {
    const target = 120_000_000_000_000n;
    assert.equal(
      poolTargetMarkerLabel({ level: 7, targetWei: target }),
      'Level 7 guarantee · 120 ETH prize pool',
    );
    assert.equal(
      poolTargetMarkerLabel({ level: 7, targetWei: target, complete: true }),
      'Level 7 final prize pool · 120 ETH',
    );
  });

  test('the completed history ruler uses a bounded log pre-target section and linear over-target section', () => {
    const ready = poolProgressModel({
      nextWei: 125n,
      targetWei: 100n,
      history: [
        { level: 1, poolWei: 1n },
        { level: 2, poolWei: 10n },
        { level: 3, poolWei: 50n },
        { level: 4, poolWei: 100n },
      ],
      currentLevel: 5,
    });

    assert.equal(ready.targetPercent, 68,
      'the guarantee is a stable hinge between history and over-target space');
    assert.equal(ready.historyMarkers[0].position, 2,
      'the smallest completed pool starts inside the rounded endcap');
    assert.equal(ready.historyMarkers.length, 2,
      'only the start and immediately previous level survive this short ruler');
    assert.equal(ready.historyMarkers[1].position, 68);
    assert.ok(ready.fillPercent > 68 && ready.fillPercent < 100,
      'the live over-target amount stays linear and retains endpoint headroom');
  });

  test('prints the realized prior-level growth as the O/U line', () => {
    assert.equal(growthLinePercent({ prev: 100n, current: 109n }), 9);
    assert.equal(growthLinePercent({ prev: 100n, current: 95n }), -5);
  });
});

describe('jackpot depletion model', () => {
  test('uses the live contract counter when the indexed counter is stale', () => {
    assert.equal(jackpotDrawCounter({
      contractPhase: { jackpot: true, day: 4 },
      gameState: { jackpotCounter: 0 },
      goldRush: { phaseDay: 0 },
    }), 4);
  });

  test('quotes the contract maximum solo share for ordinary and final draws', () => {
    const ordinary = jackpotPoolModel({ currentWei: 100_000n, baselineWei: 125_000n, counter: 2 });
    assert.equal(ordinary.maxWinWei, 4_480n,
      '14% max draw × 80% ETH leg × 40% solo bucket');
    assert.equal(ordinary.remainingPercent, 80);
    assert.equal(ordinary.drawStart, 3);

    const final = jackpotPoolModel({ currentWei: 100_000n, baselineWei: 125_000n, counter: 4 });
    assert.equal(final.finalDraw, true);
    assert.equal(final.maxWinWei, 48_000n,
      'final draw × 80% ETH leg × 60% solo bucket');
  });

  test('uses the fixed banked level pool instead of the shrinking current pool', () => {
    assert.equal(jackpotPrizePoolWei({
      gameState: { prizePools: { currentPrizePool: '70', lastLevelPool: '100' } },
      ratchets: { current: '95' },
    }), 100n);
    assert.equal(jackpotPrizePoolWei({
      gameState: { prizePools: { currentPrizePool: '70' } },
      ratchets: { current: '95' },
    }), 95n, 'growthState ratchetRound is the deployed fallback');
  });

  test('a compressed middle draw combines two logical-day maximums', () => {
    const compressed = jackpotPoolModel({
      currentWei: 100_000n, baselineWei: 100_000n, counter: 1, compressedFlag: 1,
    });
    assert.equal(compressed.step, 2);
    assert.equal(compressed.drawStart, 2);
    assert.equal(compressed.drawEnd, 3);
    assert.equal(compressed.maxWinWei, 8_960n);
    assert.equal(compressed.physicalDraw, 2);
    assert.equal(compressed.physicalDrawCount, 3);
  });

  test('physical cadence names 5-day, 3-day, and 1-day jackpots honestly', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((counter) => jackpotCadenceModel({ counter }).drawNumber),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      [0, 1, 3].map((counter) => jackpotCadenceModel({ counter, compressedFlag: 1 }).drawNumber),
      [1, 2, 3],
    );
    assert.deepEqual(jackpotCadenceModel({ counter: 3, compressedFlag: 1 }), {
      drawNumber: 3,
      drawCount: 3,
      logicalStart: 4,
      logicalEnd: 5,
      step: 2,
    });
    assert.deepEqual(jackpotCadenceModel({ counter: 0, compressedFlag: 2 }), {
      drawNumber: 1,
      drawCount: 1,
      logicalStart: 1,
      logicalEnd: 5,
      step: 5,
    });
  });

  // ---------------------------------------------------------------------
  // Compression tier 3 — the chained turbo.
  //
  // storage/DegenerusGameStorage.sol:65 declares FOUR tiers:
  //   0=norm 1=comp 2=turbo 3=turbo+owed
  // Tier 3 is written by AdvanceModule.sol:329 when a turbo is armed while the
  // previous turbo's coinflip bonus latch is still owed (two back-to-back
  // levels that each met target inside one purchase day). It is a turbo: the
  // contract's own cadence predicate is `>= 2` (AdvanceModule.sol:2360,
  // JackpotModule.sol:2404, DegenerusGame.sol:2602/:2563).
  //
  // The client tested `=== 2`, so tier 3 fell through to the normal branch and
  // a one-physical-day jackpot was presented as a five-day phase.
  // ---------------------------------------------------------------------
  test('tier 3 is a turbo, not a normal five-day phase', () => {
    assert.equal(isTurboTier(3), true, 'chained arm is a turbo');
    assert.equal(isTurboTier(2), true);
    assert.equal(isTurboTier(1), false, 'compressed keeps three physical days');
    assert.equal(isTurboTier(0), false);

    assert.deepEqual(
      jackpotCadenceModel({ counter: 0, compressedFlag: 3 }),
      jackpotCadenceModel({ counter: 0, compressedFlag: 2 }),
      'a chained turbo renders exactly like a plain turbo',
    );
    assert.equal(jackpotCadenceModel({ counter: 0, compressedFlag: 3 }).drawCount, 1);
  });

  test('a chained turbo takes the whole pool on its single draw', () => {
    const chained = jackpotPoolModel({
      currentWei: 100_000n, baselineWei: 100_000n, counter: 0, compressedFlag: 3,
    });
    const plain = jackpotPoolModel({
      currentWei: 100_000n, baselineWei: 100_000n, counter: 0, compressedFlag: 2,
    });
    assert.equal(chained.step, 5, 'all five logical days collapse into one');
    assert.equal(chained.finalDraw, true, 'so the only draw is the final draw');
    assert.equal(chained.physicalDraw, 1);
    assert.equal(chained.physicalDrawCount, 1);
    assert.equal(chained.maxWinWei, plain.maxWinWei);
    // Under the old `=== 2` test this was step 1 / finalDraw false, which
    // quoted 14% of the pool at the 40% solo share instead of the grand prize.
    const understated = jackpotPoolModel({
      currentWei: 100_000n, baselineWei: 100_000n, counter: 0, compressedFlag: 0,
    });
    assert.ok(chained.maxWinWei > understated.maxWinWei * 5n,
      'the grand prize is not the ordinary daily slice');
  });

  test('the phase strip labels a chained turbo as a one-draw phase', () => {
    assert.equal(
      phaseStripModel({
        gameState: { level: 41, phase: 'JACKPOT', jackpotPhaseFlag: true },
        contractPhase: { jackpot: true, jackpotCounter: 0, compressedFlag: 3 },
      }).dayLabel,
      'JACKPOT DRAW 1 OF 1',
    );
  });
});

describe('jackpot cadence source resolution', () => {
  // The gold-rush slot0 decode (polling.js:333) names the counter
  // `jackpotCounter`; the parimutuel benchmark names the same contract field
  // `day`. Reading only `day` dropped the live chain counter on every render
  // driven by the chain ticker.
  test('the chain decode counter is honoured under its own field name', () => {
    assert.equal(
      jackpotDrawCounter({ contractPhase: { jackpot: true, jackpotCounter: 3 } }),
      3,
    );
    assert.equal(
      jackpotDrawCounter({ contractPhase: { jackpot: true, day: 2 } }),
      2,
      'the benchmark spelling still wins when present',
    );
  });

  test('a live chain counter outranks the lagging indexed snapshot', () => {
    // /game/state briefly retains the pre-advance counter. The chain value is
    // the authority; the old order let the stale one win.
    assert.equal(
      jackpotDrawCounter({
        contractPhase: { jackpot: true, jackpotCounter: 4 },
        gameState: { jackpotCounter: 0 },
        goldRush: { phaseDay: 4 },
      }),
      4,
    );
    assert.equal(
      jackpotDrawCounter({ gameState: { jackpotCounter: 0 }, goldRush: { phaseDay: 3 } }),
      3,
      'without a contract phase the chain-fed goldRush day still outranks the index',
    );
  });

  test('cold load with no source at all reads as draw zero, not NaN', () => {
    assert.equal(jackpotDrawCounter({}), 0);
    assert.equal(jackpotCompressionTier({}), 0);
    assert.equal(jackpotCadenceModel({}).drawCount, 5);
  });

  test('an unknown tier falls through to the next source instead of forging "normal"', () => {
    // readJackpotPhaseContext() returns null when jackpotCompressionTier()
    // fails. Under the old `?? 0` coercion that null became a hard 0, and `??`
    // never falls through a 0 — so one bad RPC read masked a live turbo.
    assert.equal(
      jackpotCompressionTier({
        contractPhase: { compressedFlag: null },
        goldRush: { phaseClock: { compressedFlag: 2 } },
      }),
      2,
      'the slot0 decode answers when the direct tier read failed',
    );
    assert.equal(
      jackpotCompressionTier({
        contractPhase: { compressedFlag: null },
        gameState: { compressedJackpotFlag: 1 },
      }),
      1,
    );
    assert.equal(
      jackpotCompressionTier({
        contractPhase: { compressedFlag: 0 },
        goldRush: { phaseClock: { compressedFlag: 2 } },
      }),
      0,
      'a real 0 is an answer, not a miss — it must not be overridden',
    );
    assert.equal(
      jackpotCompressionTier({ contractPhase: { compressedFlag: null } }),
      0,
      'no source anywhere fails closed to the ordinary cadence',
    );
  });

  test('a masked tier no longer downgrades a chained turbo to five days', () => {
    const resolved = jackpotCompressionTier({
      contractPhase: { compressedFlag: null },
      goldRush: { phaseClock: { compressedFlag: 3 } },
    });
    assert.equal(jackpotCadenceModel({ counter: 0, compressedFlag: resolved }).drawCount, 1);
  });
});

describe('phase strip copy', () => {
  test('purchase mode always reserves the phase-day label while its clock loads', () => {
    assert.deepEqual(phaseStripModel({
      gameState: { level: 37, phase: 'PURCHASE', jackpotPhaseFlag: false },
    }), {
      jackpot: false, level: 38, day: null, dayLabel: 'PURCHASE DAY —',
    });
  });

  test('purchase mode renders the phase day from the direct contract clock', () => {
    assert.deepEqual(phaseStripModel({
      gameState: { level: 36, phase: 'PURCHASE', jackpotPhaseFlag: false },
      contractPhase: { level: 36, jackpot: false, purchaseDay: 5 },
    }), {
      jackpot: false, level: 37, day: 5, dayLabel: 'PURCHASE DAY 5',
    });
  });

  test('the contract last-purchase latch marks that exact purchase day final', () => {
    assert.deepEqual(phaseStripModel({
      gameState: { level: 37, phase: 'PURCHASE', jackpotPhaseFlag: false },
      contractPhase: { jackpot: false, lastPurchaseDay: true, purchaseDay: 3 },
    }), {
      jackpot: false, level: 38, day: 3, dayLabel: 'PURCHASE DAY 3 (FINAL)',
    });
  });

  test('jackpot mode names the next unresolved draw day', () => {
    assert.deepEqual(phaseStripModel({
      gameState: { level: 37, phase: 'JACKPOT', jackpotPhaseFlag: true, jackpotCounter: 3 },
    }), {
      jackpot: true,
      level: 37,
      day: 4,
      dayCap: 5,
      logicalStart: 4,
      logicalEnd: 4,
      dayLabel: 'JACKPOT DRAW 4 OF 5',
    });
  });

  test('a compressed final draw is labelled physical draw 3 of 3', () => {
    assert.deepEqual(phaseStripModel({
      gameState: { level: 38, phase: 'JACKPOT', jackpotPhaseFlag: true, jackpotCounter: 0 },
      contractPhase: { jackpot: true, day: 3, compressedFlag: 1 },
    }), {
      jackpot: true,
      level: 38,
      day: 3,
      dayCap: 3,
      logicalStart: 4,
      logicalEnd: 5,
      dayLabel: 'JACKPOT DRAW 3 OF 3',
    });
    assert.equal(jackpotPoolModel({
      currentWei: 100_000n,
      baselineWei: 125_000n,
      counter: 3,
      compressedFlag: 1,
    }).finalDraw, true);
  });

  test('a turbo jackpot is one physical draw covering all five logical days', () => {
    assert.deepEqual(phaseStripModel({
      gameState: { level: 39, phase: 'JACKPOT', jackpotPhaseFlag: true, jackpotCounter: 0 },
      contractPhase: { jackpot: true, day: 0, compressedFlag: 2 },
    }), {
      jackpot: true,
      level: 39,
      day: 1,
      dayCap: 1,
      logicalStart: 1,
      logicalEnd: 5,
      dayLabel: 'JACKPOT DRAW 1 OF 1',
    });
  });

  test('contract phase wins when the indexer briefly reports the opposite phase', () => {
    assert.deepEqual(phaseStripModel({
      gameState: { level: 37, phase: 'PURCHASE', jackpotPhaseFlag: false, jackpotCounter: 0 },
      contractPhase: { jackpot: true, day: 2 },
    }), {
      jackpot: true,
      level: 37,
      day: 3,
      dayCap: 5,
      logicalStart: 3,
      logicalEnd: 3,
      dayLabel: 'JACKPOT DRAW 3 OF 5',
    });
    assert.deepEqual(phaseStripModel({
      gameState: { level: 37, phase: 'JACKPOT', jackpotPhaseFlag: true, jackpotCounter: 4 },
      contractPhase: { jackpot: false, day: 0 },
    }), {
      jackpot: false, level: 38, day: null, dayLabel: 'PURCHASE DAY —',
    });
  });
});

describe('special level-transition jackpot countdown', () => {
  test('names Decimator only after the target level purchase pool closes', () => {
    assert.deepEqual(transitionJackpotCountdownModel({
      level: 34, jackpot: false, lastPurchaseDay: true,
    }), {
      kind: 'decimator', label: 'DECIMATOR DRAWING IN:', level: 35,
    });
    assert.equal(transitionJackpotCountdownModel({
      level: 34, jackpot: false, lastPurchaseDay: false,
    }), null, 'a still-open target-driven purchase phase cannot quote a transition time');
    assert.equal(transitionJackpotCountdownModel({
      level: 94, jackpot: false, lastPurchaseDay: true,
    }), null, 'level 95 is the intentional Decimator exception');
  });

  test('names BAF at the x10 purchase close and never on the previous final jackpot', () => {
    assert.deepEqual(transitionJackpotCountdownModel({
      level: 39, jackpot: false, lastPurchaseDay: true,
    }), {
      kind: 'baf', label: 'BIG ASS FLIP LOCKS IN:', level: 40,
    });
    assert.equal(transitionJackpotCountdownModel({
      level: 39, jackpot: true, lastPurchaseDay: false,
    }), null, 'finishing level 39 only opens level 40 purchases; it does not resolve BAF');
    assert.deepEqual(transitionJackpotCountdownModel({
      level: 40, jackpot: false, lastPurchaseDay: true, rngLocked: true,
    }), {
      kind: 'baf', label: 'BIG ASS FLIP LOCKS IN:', level: 40,
    }, 'the RNG request promotes the level without moving the BAF target to 50');
  });

  test('combines both reward jackpots at a closed x100 purchase pool', () => {
    assert.deepEqual(transitionJackpotCountdownModel({
      level: 99, jackpot: false, lastPurchaseDay: true,
    }), {
      kind: 'both', label: 'DECIMATOR + BIG ASS FLIP LOCK IN:', level: 100,
    });
  });

  test('changes lock-in copy at the tracked day boundary', () => {
    assert.equal(transitionJackpotLockedLabel('baf'), 'BIG ASS FLIP LOCKED IN');
    assert.equal(
      transitionJackpotLockedLabel('both'),
      'DECIMATOR + BIG ASS FLIP LOCKED IN',
    );
    assert.match(component, /deadlineMs:\s*Date\.now\(\) \+ \(secondsUntilDayCrossover\(\) \* 1000\)/,
      'the special clock retains this boundary instead of resetting to the next day');
    assert.match(component, /remaining <= 0[\s\S]*transitionJackpotLockedLabel/,
      'crossing the retained boundary swaps the countdown for locked-in copy');
  });
});

describe('day-one turbo jackpot promotion', () => {
  test('replaces the purchase label only after a non-BAF pool strictly clears its target', () => {
    const overTarget = poolProgressModel({ nextWei: 1_000_001n, targetWei: 1_000_000n });
    assert.deepEqual(purchaseTurboJackpotModel({
      level: 39,
      purchaseDay: 1,
      levelReady: overTarget.levelReady,
      nextWei: overTarget.next,
    }), {
      level: 39,
      grandPrizeWei: 480_000n,
    }, 'the one-draw turbo grand prize is the 80% ETH leg times the 60% solo share');

    const exactTarget = poolProgressModel({ nextWei: 1_000_000n, targetWei: 1_000_000n });
    assert.equal(purchaseTurboJackpotModel({
      level: 39,
      purchaseDay: 1,
      levelReady: exactTarget.levelReady,
      nextWei: 1_000_000n,
    }), null, 'an exact 100% reading is not the contract strict-over threshold');
    assert.equal(purchaseTurboJackpotModel({
      level: 39,
      purchaseDay: 2,
      levelReady: true,
      nextWei: 1_000_000n,
    }), null, 'clearing the target after day one does not create turbo mode');
    assert.equal(purchaseTurboJackpotModel({
      level: 40,
      purchaseDay: 1,
      levelReady: true,
      nextWei: 1_000_000n,
    }), null, 'BAF target levels retain their dedicated transition treatment');
  });

  test('renders one full-width turbo header with countdown and up-to grand-prize copy', () => {
    assert.match(component, /data-el="pool-turbo-jackpot"/);
    assert.match(component, /TURBO JACKPOT IN/);
    assert.match(component, /GRAND PRIZE: UP TO/);
    assert.match(component, /poolDay\.hidden = turboActive/,
      'PURCHASE DAY 1 leaves the header as soon as turbo becomes eligible');
    assert.match(component, /grandPrizeWei[\s\S]*_formatWholeEth/,
      'the estimated one-draw maximum is formatted into the visible header');
    assert.match(css,
      /\.pool-progress__turbo-jackpot\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*justify-content:\s*center/s,
      'the replacement uses the whole top row rather than fighting the old phase cell');
    assert.match(css,
      /\.pool-progress__turbo-jackpot-prize\s*\{[^}]*color:\s*#facc15/s,
      'GRAND PRIZE: UP TO keeps the neutral turbo-label color');
    assert.match(css,
      /\.pool-progress__turbo-jackpot-prize strong\s*\{[^}]*color:\s*#86efac/s,
      'the estimated ETH number is the green value');
    assert.match(css,
      /\.pool-progress__turbo-jackpot-prize em\s*\{[^}]*color:\s*#86efac/s,
      'the ETH unit stays attached to the green amount treatment');
  });

  test('restores PURCHASE DAY 1 at the retained crossover instead of wrapping to another day', () => {
    assert.match(component,
      /deadlineMs:\s*Date\.now\(\) \+ \(secondsUntilDayCrossover\(\) \* 1000\)/,
      'the turbo cue owns the exact boundary it originally advertised');
    assert.match(component,
      /turboRemaining <= 0[\s\S]*turboJackpot\.hidden = true[\s\S]*poolDay\.hidden = false/,
      'once that boundary arrives, the stale purchase snapshot falls back to its normal day label');
    assert.match(component,
      /turboRemaining <= 0[\s\S]*poolDay\.textContent = 'PURCHASE DAY 1'/,
      'a stale final-day latch cannot leave FINAL copy behind after the turbo draw boundary');
  });
});

describe('pool thermometer and daily-jackpot shell wiring', () => {
  test('thermometer sits between the jackpot headline and daily instrument', () => {
    // Prefix match: the tag carries class="gr" + the static LCP shell now.
    const headline = html.indexOf('<gold-rush-headline');
    const meter = html.indexOf('<app-pool-progress>');
    const hero = html.indexOf('<section class="jackpot-hero"');
    assert.ok(headline >= 0 && headline < meter && meter < hero);
    assert.match(html, /src="\/app\/components\/app-pool-progress\.js"/);
  });

  test('center draw has the requested Degenerus Daily Drawing machine marquee', () => {
    const drawStart = html.indexOf('<div class="jackpot-hero__draw">');
    const drawEnd = html.indexOf('<app-daily-flip>', drawStart);
    const draw = html.slice(drawStart, drawEnd);
    assert.match(draw,
      /<div class="jackpot-hero__machine">[\s\S]*?<last-day-jackpot>[\s\S]*?<replay-panel single-button>[\s\S]*?<\/div>[\s\S]*?<nav class="jackpot-day-history"/,
      'the fixed drawing instrument closes before expandable history content');
    assert.match(draw,
      /<h2 class="jackpot-hero__draw-title"[^>]*>[\s\S]*?flame-center-silver\.svg[\s\S]*?<strong>DEGENERUS DAILY DRAWING<\/strong>[\s\S]*?<\/h2>/,
      'the accessible marquee includes the canonical flame and one-line attraction name');
    assert.match(drawingCss, /\.jackpot-hero__draw-title\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*row[^}]*height:\s*2\.72rem[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*text-align:\s*center/s,
      'the single-line machine marquee remains centered inside its compact recess');
    assert.match(drawingCss, /\.jackpot-hero__machine\s*\{[^}]*daily-drawing-backplate-v9\.webp[^}]*100% 100% no-repeat/s,
      'only the compact machine owns its purpose-built backplate artwork');
    assert.match(css, /\.jackpot-hero__machine\s*\{[^}]*container-type:\s*inline-size/s,
      'board and foil modules share the machine container instead of the expandable hero row');
    assert.match(css, /\.jackpot-hero last-day-jackpot \.panel\s*\{[^}]*padding:\s*0/s,
      'the headless jackpot bridge contributes no blank band below the label');
  });

  test('existing side-bet refresh publishes contract-exact shared benchmarks', () => {
    assert.match(pari, /readPrizePoolTarget/);
    assert.match(pari, /readGrowthRatchetHistory/);
    assert.match(pari, /update\('app\.poolBenchmarks'/);
    assert.match(pari, /lastPurchaseDay:\s*phaseContext\.lastPurchaseDay === true/,
      'the phase strip receives the contract last-purchase latch');
    assert.match(pari, /rngLocked:\s*phaseContext\.rngLocked === true/,
      'the reward-jackpot clock receives the contract transition lock');
    assert.match(css, /\.pool-progress__track\s*\{/);
    assert.match(component, /data-el="pool-target-marker"/);
    assert.match(component, /data-el="pool-growth-marker"/);
    assert.match(component, /data-el="pool-history-markers"/);
    assert.match(component, /pool-target-marker" title="Level guarantee" tabindex="0"/,
      'thresholds are keyboard-focusable as well as hoverable');
    assert.match(component, /complete:\s*model\.levelReady/,
      'the target tooltip switches vocabulary only after the level target is complete');
    assert.match(component, /`\$\{levelLabel\} growth O\/U · \$\{_formatMarkerEth\(model\.growthTarget\)\} ETH prize pool/,
      'the growth tooltip names its level and ETH position');
    assert.match(css, /\.pool-progress__marker\s*\{[^}]*width:\s*5px[^}]*pointer-events:\s*auto/s,
      'the formerly faint lines are wider real hover targets');
    assert.match(css, /\.pool-progress__marker::before\s*\{[^}]*content:\s*none/s,
      'threshold lines remain but their decorative diamond caps do not');
    assert.match(component, /const label = `\$\{prefix\} final prize pool · \$\{_formatMarkerEth\(row\.poolWei\)\} ETH`/,
      'each historical notch names its exact level and final pool');
    assert.match(component, /row\.level > 3 && \(anchor - row\.level\) % 5 === 0/,
      'historical levels are sampled backward from the current level in five-level steps');
    assert.match(css, /\.pool-progress__marker--history\s*\{[^}]*top:\s*auto[^}]*bottom:\s*1px[^}]*width:\s*2px[^}]*min-width:\s*2px[^}]*max-width:\s*2px[^}]*height:\s*42%[^}]*box-shadow:\s*none/s,
      'every ordinary historical final uses one consistent, crisp width inside the tube');
    assert.match(css, /\.pool-progress__marker--history-previous\s*\{[^}]*width:\s*3px[^}]*height:\s*82%[^}]*var\(--gauge-cream\)/s,
      'the immediately previous level is the strongest historical graduation');
    assert.match(css, /\.pool-progress__marker--history-start\s*\{[^}]*width:\s*2px[^}]*height:\s*62%[^}]*rgba\(240, 217, 166, 0\.82\)/s,
      'the starting point is distinct from both interval ticks and the previous level');
    assert.match(css, /\.pool-progress__track\.is-ready \.pool-progress__fill\s*\{[^}]*background:\s*var\(--gauge-blue\)/s,
      'the post-guarantee thermometer switches to a subdued solid blue fill');
    assert.match(css, /\.pool-progress__track::before\s*\{[^}]*background:\s*linear-gradient\(180deg, rgba\(255, 245, 207, 0\.1\)/s,
      'the dark glass track carries only a restrained instrument highlight');
    assert.match(css, /\.pool-progress__marker--history\s*\{[^}]*background:\s*rgba\(240, 217, 166, 0\.66\)/s,
      'the level graduations use muted cream against the dark completed fill');
    assert.match(css, /\.pool-progress__marker--history-previous\s*\{[^}]*background:\s*var\(--gauge-cream\)/s,
      'the previous level uses the strongest cream treatment');
    assert.match(css, /\.pool-progress__track\.is-ready \.pool-progress__marker--target\s*\{[^}]*width:\s*2px[^}]*background:\s*var\(--gauge-brass\)/s,
      'the guarantee remains the strongest brass ruler hinge');
    assert.match(css, /\.pool-progress__track\.is-ready \.pool-progress__marker--growth\s*\{[^}]*width:\s*2px[^}]*background:\s*#7dd3fc[^}]*box-shadow:\s*0 0 5px/s,
      'the O/U line uses cyan rather than text to distinguish its role');
    assert.doesNotMatch(component, /pool-progress__history-level|<small>O\/U<\/small>/,
      'the sparse tick marks do not carry collision-prone inline labels');
    assert.match(component, /if \(referenceKind\) referenceKind\.hidden = model\.levelReady/,
      'the completed live endpoint keeps its amount but hides the redundant text label');
    assert.ok(
      pari.indexOf('void this.#loadPoolBenchmarks(seq, level)')
        < pari.indexOf('const [growth, volume, credit, decimatorPosition, decimatorContext]'),
      'direct phase reads start before side-bet and player market reads',
    );
    assert.ok(
      pari.indexOf("update('app.poolBenchmarks'")
        < pari.indexOf('const seal = await readLastVolumeSeal'),
      'pool publication lives on a separate path from the slower volume-log scan',
    );
    const fastPublish = pari.indexOf('const published = this.#publishPoolBenchmarks');
    const historyRead = pari.indexOf('const history = await readGrowthRatchetHistory');
    assert.ok(fastPublish >= 0 && fastPublish < historyRead,
      'the live target and phase publish before completed-level history is fetched');
  });

  test('live pool values use the same fast sample as the Grand Prize ticker', () => {
    const nextFast = component.indexOf('goldRush?.components?.nextWei');
    const nextSlow = component.indexOf('gameState?.prizePools?.nextPrizePool', nextFast);
    const currentFast = component.indexOf('goldRush?.components?.currentWei');
    const currentSlow = component.indexOf('gameState?.prizePools?.currentPrizePool', currentFast);
    assert.ok(nextFast >= 0 && nextSlow > nextFast,
      'purchase pool prefers app.goldRush and falls back to the 15s game-state sample');
    assert.ok(currentFast >= 0 && currentSlow > currentFast,
      'jackpot pool uses the same fast precedence');
    assert.match(component, /subscribe\('app\.goldRush', \(\) => this\.#render\(\)\)/,
      'every Grand Prize sample immediately repaints the pool instrument');
  });

  test('phase day is chain-derived and can never collapse to a bare phase name', () => {
    assert.doesNotMatch(component, /fetchJSON\('\/replay\/rng'\)/,
      'the strip has no indexer dependency');
    assert.match(component, /goldRush\?\.phaseClock/,
      'the strip consumes the packed GAME phase clock from the direct-chain ticker');
    assert.match(component, /contractPhase\?\.purchaseDay/,
      'the purchase day comes from the direct contract snapshot');
    assert.match(component, />PURCHASE DAY —<\/strong>/,
      'the initial shell always reserves a day value');
  });

  test('amount follows target before progression and current afterward while percent lives in the bar', () => {
    assert.match(css, /\.pool-progress__marker-label\s*\{[^}]*bottom:\s*calc\(100% \+ 0\.42rem\)/s,
      'the amount shares the phase row instead of creating a third visual level');
    assert.match(css, /\.pool-progress__marker-label\s*\{[^}]*right:\s*auto[^}]*left:\s*0[^}]*translateX\(-50%\)/s,
      'the amount is centered directly over whichever live reference it follows');
    assert.match(component, /referenceLabel\.style\.left = `\$\{model\.referencePercent\}%`/,
      'the rendered amount advances from target to current along the fill');
    assert.match(component, /model\.levelReady \? 'CURRENT' : 'GUARANTEE'/,
      'the live edge retains semantic context while its visible readout is amount-only');
    assert.match(css, /\.pool-progress__track\s*\{[^}]*margin-right:\s*0/s,
      'the target callout no longer shortens the graph');
    assert.match(css, /\.pool-progress__percent\s*\{[^}]*position:\s*absolute/s);
    assert.match(component, /if \(percent\) percent\.hidden = model\.levelReady/,
      'the percentage disappears once the thermometer has switched to its post-guarantee state');
    assert.match(css, /\.pool-progress__percent\[hidden\]\s*\{[^}]*display:\s*none !important/s);
    assert.match(css, /app-pool-progress \+ \.jackpot-hero\s*\{[^}]*margin-top:\s*0\.3rem/s);
  });

  test('purchase mode keeps one compact prize-pool thermometer', () => {
    assert.doesNotMatch(component, /DEATH CLOCK|pool-death-cap|pool-life-track/,
      'the parked death-clock concept is absent from the live instrument');
    assert.match(css, /\.pool-progress__body\s*\{[^}]*grid-template-areas:\s*"pool-name pool-track"/s);
  });

  test('jackpot mode uses one desktop row and two deliberate narrow rows', () => {
    assert.match(component, /pool-jackpot-summary/);
    const phaseIndex = component.indexOf('pool-progress__jackpot-context');
    const poolIndex = component.indexOf('pool-progress__jackpot-pool">');
    const winIndex = component.indexOf('pool-progress__jackpot-win');
    assert.ok(phaseIndex < poolIndex && poolIndex < winIndex,
      'the enlarged prize pool occupies the middle slot');
    assert.match(component, /pool-progress__jackpot-pool-label">LEVEL <strong data-el="pool-jackpot-level">—<\/strong> PRIZE POOL :/);
    assert.match(component, /JACKPOT PHASE/);
    assert.match(component, /DRAW <strong data-el="pool-jackpot-day">—\/—<\/strong>/);
    assert.match(component, /WIN UP TO/);
    assert.match(component, /model\.finalDraw \? 'GRAND PRIZE:' : 'WIN UP TO'/,
      'the deterministic final-day share is presented as the grand prize');
    assert.match(component, /NEXT JACKPOT IN:/);
    assert.match(component, /pool-jackpot-countdown/);
    assert.match(component, /secondsUntilDayCrossover/,
      'the strip shares the top-bar countdown clock');
    assert.match(component, /DECIMATOR DRAWING IN:/);
    assert.doesNotMatch(component, /DECIMATOR CROSSOVER/);
    assert.match(component, /BIG ASS FLIP LOCKS IN:/);
    assert.match(component, /pool-special-jackpot-countdown/);
    const headStart = component.indexOf('<header class="pool-progress__head">');
    const headEnd = component.indexOf('</header>', headStart);
    const phaseDay = component.indexOf('data-el="pool-day"', headStart);
    const lockIn = component.indexOf('data-el="pool-special-jackpot"', headStart);
    assert.ok(headStart >= 0 && phaseDay > headStart && lockIn > phaseDay && lockIn < headEnd,
      'the lock-in countdown shares the PURCHASE DAY ... (FINAL) header line');
    assert.match(css,
      /\.pool-progress__special-jackpot\s*\{[^}]*grid-column:\s*2[^}]*justify-content:\s*center[^}]*justify-self:\s*center[^}]*margin:\s*0/s,
      'the large lock-in countdown is centered instead of clipping against the right edge');
    assert.match(css,
      /\.pool-progress__head\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s,
      'equal side tracks keep the lock-in cue centered across the whole strip');
    assert.match(css,
      /@media \(max-width: 560px\)[\s\S]*?\.pool-progress__special-jackpot\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*2[^}]*width:\s*100%[\s\S]*?\.pool-progress__head\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
      'phones place the centered lock-in cue on its own line instead of overlapping the phase label');
    assert.match(component, /if \(body\) body\.hidden = true/,
      'the purchase thermometer is absent throughout jackpot phase');
    assert.match(css, /\.pool-progress__jackpot\s*\{[^}]*display:\s*grid[^}]*white-space:\s*nowrap/s,
      'desktop jackpot context stays on one physical line');
    assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.pool-progress__jackpot\s*\{[^}]*grid-template-areas:\s*"pool pool"\s*"context tail"/s,
      'narrow jackpot context has a centered pool row and a details row');
  });
});
