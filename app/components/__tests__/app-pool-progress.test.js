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
  jackpotPoolModel,
  jackpotCadenceModel,
  jackpotDrawCounter,
  jackpotPrizePoolWei,
  phaseStripModel,
  poolTargetMarkerLabel,
  prizePoolTargetForLevel,
  transitionJackpotCountdownModel,
  transitionJackpotLockedLabel,
  LEVEL_ONE_TARGET_WEI,
} = await import('../app-pool-progress.js');
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolvePath(__dirname, '../../index.html'), 'utf8');
const css = readFileSync(resolvePath(__dirname, '../../styles/app.css'), 'utf8');
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
    assert.ok(ready.historyMarkers[1].position > 30,
      'a true bounded log scale keeps early historical pools out of a left-edge barcode');
    assert.ok(ready.historyMarkers[1].position < ready.historyMarkers[2].position);
    assert.equal(ready.historyMarkers[3].position, 68);
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
});

describe('phase strip copy', () => {
  test('purchase mode moves active level and DB phase-day out of the nav', () => {
    assert.deepEqual(phaseStripModel({
      gameState: { level: 36, phase: 'PURCHASE', jackpotPhaseFlag: false },
      phaseClock: { level: 37, phase: 'P', dayInPhase: 5 },
    }), {
      jackpot: false, level: 37, day: 5, dayLabel: 'PURCHASE DAY 5',
    });
  });

  test('the contract last-purchase latch marks that exact purchase day final', () => {
    assert.deepEqual(phaseStripModel({
      gameState: { level: 37, phase: 'PURCHASE', jackpotPhaseFlag: false },
      phaseClock: { level: 38, phase: 'P', dayInPhase: 3 },
      contractPhase: { jackpot: false, lastPurchaseDay: true },
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
      jackpot: false, level: 38, day: null, dayLabel: 'PURCHASE',
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

describe('pool thermometer and daily-jackpot shell wiring', () => {
  test('thermometer sits between the jackpot headline and daily instrument', () => {
    const headline = html.indexOf('<gold-rush-headline>');
    const meter = html.indexOf('<app-pool-progress>');
    const hero = html.indexOf('<section class="jackpot-hero"');
    assert.ok(headline >= 0 && headline < meter && meter < hero);
    assert.match(html, /src="\/app\/components\/app-pool-progress\.js"/);
  });

  test('center draw has the requested DAILY JACKPOT label', () => {
    const drawStart = html.indexOf('<div class="jackpot-hero__draw">');
    const drawEnd = html.indexOf('<app-daily-flip>', drawStart);
    assert.match(html.slice(drawStart, drawEnd),
      /<h2 class="jackpot-hero__draw-title">DAILY JACKPOT<\/h2>/);
    assert.match(css, /\.jackpot-hero__draw-title\s*\{[^}]*height:\s*2\.55rem[^}]*align-items:\s*center[^}]*color:\s*var\(--text-primary[^}]*font-size:\s*1\.05rem[^}]*letter-spacing:\s*0\.13em[^}]*text-align:\s*left/s,
      'Daily Jackpot uses the shared fixed-height heading baseline and typography');
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
    assert.match(component, /Level \$\{row\.level\} final prize pool · \$\{_formatMarkerEth\(row\.poolWei\)\} ETH/,
      'each historical notch names its exact level and final pool');
    assert.match(component, /const major = Number\(row\.level\) % 5 === 0/,
      'every fifth historical level receives the major thermometer graduation');
    assert.match(css, /\.pool-progress__marker--history\s*\{[^}]*top:\s*auto[^}]*bottom:\s*1px[^}]*width:\s*2px[^}]*min-width:\s*2px[^}]*max-width:\s*2px[^}]*height:\s*42%[^}]*box-shadow:\s*none/s,
      'every ordinary historical final uses one consistent, crisp width inside the tube');
    assert.match(css, /\.pool-progress__marker--history-major\s*\{[^}]*width:\s*3px[^}]*min-width:\s*3px[^}]*max-width:\s*3px[^}]*height:\s*72%[^}]*box-shadow:\s*none/s,
      'only five-level graduations are longer and one pixel thicker');
    assert.match(css, /\.pool-progress__track\.is-ready \.pool-progress__fill\s*\{[^}]*background:\s*#93c5fd/s,
      'the post-guarantee thermometer switches to a solid light blue fill');
    assert.match(css, /\.pool-progress__track::before\s*\{[^}]*background:\s*none/s,
      'the old always-on white grid does not compete with the post-guarantee graduations');
    assert.match(css, /\.pool-progress__marker--history\s*\{[^}]*background:\s*rgba\(0, 0, 0, 0\.82\)/s,
      'the level graduations become black against the post-guarantee light blue');
    assert.match(css, /\.pool-progress__marker--history-major\s*\{[^}]*background:\s*#050505/s,
      'major five-level graduations use the same black treatment');
    assert.match(css, /\.pool-progress__track\.is-ready \.pool-progress__marker--target\s*\{[^}]*width:\s*2px[^}]*background:\s*#111827/s,
      'the guarantee remains the strongest dark ruler hinge');
    assert.match(css, /\.pool-progress__track\.is-ready \.pool-progress__marker--growth\s*\{[^}]*width:\s*1px[^}]*background:\s*#334155/s,
      'the growth line is subordinate to the guarantee and current endpoint');
    assert.match(component, /mobileSkip = !major && Number\(row\.level\) % 2 !== 0/,
      'narrow screens can suppress alternate minor ticks without losing fifth-level majors');
    assert.match(css, /@media \(max-width:\s*560px\)[^}]*\.pool-progress__marker--history-mobile-skip\s*\{\s*display:\s*none/s,
      'mobile uses the art-directed sparse history ruler');
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

  test('amount follows target before progression and current afterward while percent lives in the bar', () => {
    assert.match(css, /\.pool-progress__marker-label\s*\{[^}]*bottom:\s*calc\(100% \+ 0\.42rem\)/s,
      'the amount shares the phase row instead of creating a third visual level');
    assert.match(css, /\.pool-progress__marker-label\s*\{[^}]*right:\s*auto[^}]*left:\s*0[^}]*translateX\(-50%\)/s,
      'the amount is centered directly over whichever live reference it follows');
    assert.match(component, /referenceLabel\.style\.left = `\$\{model\.referencePercent\}%`/,
      'the rendered amount advances from target to current along the fill');
    assert.match(component, /model\.levelReady \? '' : 'GUARANTEE'/,
      'after clearing the target the live edge shows only its ETH total, without a CURRENT label');
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
