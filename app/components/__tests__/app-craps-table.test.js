import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

globalThis.HTMLElement ??= class HTMLElement {};
globalThis.customElements ??= {
  registry: new Map(),
  define(name, ctor) { this.registry.set(name, ctor); },
  get(name) { return this.registry.get(name); },
};

const moduleUrl = new URL('../app-craps-table.js', import.meta.url);
const cssUrl = new URL('../../styles/craps-table.css', import.meta.url);
const demoUrl = new URL('../../craps-table-demo.html', import.meta.url);
const demoScriptUrl = new URL('../../craps-table-demo.js', import.meta.url);
const indexUrl = new URL('../../index.html', import.meta.url);
const goldChipUrl = new URL('../../../shared/flip-chips/coin-high-gold.svg', import.meta.url);
const goldStackUrl = new URL('../../../shared/flip-chips/stack-7-high-gold.svg', import.meta.url);
const COMPONENT_SRC = readFileSync(moduleUrl, 'utf8');
const CSS_SRC = readFileSync(cssUrl, 'utf8');
const DEMO_SRC = readFileSync(demoUrl, 'utf8');
const DEMO_SCRIPT_SRC = readFileSync(demoScriptUrl, 'utf8');
const INDEX_SRC = readFileSync(indexUrl, 'utf8');
const GOLD_CHIP_SRC = readFileSync(goldChipUrl, 'utf8');
const GOLD_STACK_SRC = readFileSync(goldStackUrl, 'utf8');

test('resolution acknowledgment is gated on painted completion and exact-once state', async () => {
  const { canAcknowledgeCrapsResolution } = await import(moduleUrl);
  const callback = () => {};
  assert.equal(canAcknowledgeCrapsResolution({ completed: false, onAcknowledged: callback }), false);
  assert.equal(canAcknowledgeCrapsResolution({ completed: true, onAcknowledged: callback }), true);
  assert.equal(canAcknowledgeCrapsResolution({
    completed: true,
    acknowledged: true,
    onAcknowledged: callback,
  }), false);
  assert.equal(canAcknowledgeCrapsResolution({ completed: true }), false);
});

test('a battle win replaces a busted bankroll return in the final result', async () => {
  const { crapsFinalResolutionSummary, CRAPS_FLIP_WEI } = await import(moduleUrl);
  assert.deepEqual(crapsFinalResolutionSummary({
    terminal: 'bust',
    finalTray: 0n,
    battleWonByViewer: true,
    battlePayoutWei: 84_900n * CRAPS_FLIP_WEI,
  }), {
    event: 'BATTLE WON',
    result: '84.9K PAID',
    state: 'win',
    bayResult: 'win',
    ariaLabel: 'Craps battle won. 84,900 FLIP paid.',
  });
  assert.equal(crapsFinalResolutionSummary({
    terminal: 'bust',
    finalTray: 777n,
  }).result, '0 RETURN');
  assert.match(COMPONENT_SRC,
    /const battleAwardFlip = battleWon[\s\S]*?this\.#battlePayoutWei[\s\S]*?this\.#paintResolutionTray\(battleAwardFlip \?\? finalTray, \{[\s\S]*?active: false,[\s\S]*?battleAward: battleAwardFlip != null/s,
    'a winning viewer finishes on the paid Battle amount even when their run tray busted');
  assert.match(COMPONENT_SRC,
    /#paintResolutionTray\(amount, \{[\s\S]*?battleAward = false[\s\S]*?const reserveState = battleAward[\s\S]*?\? 'safe'[\s\S]*?FLIP Battle prize paid/s,
    'a paid Battle award uses green award pips instead of becoming fake jackpot progress');
  assert.match(COMPONENT_SRC,
    /battleWinner: true,[\s\S]*?battleAwardWei,[\s\S]*?state: 'paid',[\s\S]*?status: 'WINNER'/s,
    'the finalized winning leaderboard rack becomes a paid winner instead of retaining a zero bust');
  assert.match(COMPONENT_SRC,
    /const amountCopy = entry\.battleAwardWei[\s\S]*?<strong>\$\{amountCopy\}<\/strong>/s,
    'the final winner row prints its exact Battle award');
});

test('final battle ordering keeps the contract comparator after every visible rack busts', async () => {
  const { compareFinalCrapsBattleEntries } = await import(moduleUrl);
  const entries = [
    { betId: '1', rankStop: 'bust', rankHands: 8, rankEnd: 900, rankStanding: 500 },
    { betId: '2', rankStop: 'bust', rankHands: 10, rankEnd: 20, rankStanding: 10 },
    { betId: '3', rankStop: 'bust', rankHands: 10, rankEnd: 40, rankStanding: 5 },
  ];
  assert.deepEqual(
    entries.toSorted((left, right) => compareFinalCrapsBattleEntries(left, right)).map((entry) => entry.betId),
    ['3', '2', '1'],
    'busts rank on shooters completed and raw remainder, not their displayed zero',
  );
  assert.equal(compareFinalCrapsBattleEntries(
    { betId: '4', rankStop: 'bust', rankHands: 20, rankEnd: 500 },
    { betId: '5', rankStop: 'goal', rankPeak: 1, rankEnd: 1 },
  ), 1, 'every goal outranks every bust');
  assert.equal(compareFinalCrapsBattleEntries(
    { betId: '6', rankStop: 'bust', rankHands: 10, rankEnd: 40, rankStanding: 5 },
    { betId: '7', rankStop: 'bust', rankHands: 10, rankEnd: 40, rankStanding: 5 },
    '7',
  ), 1, 'the finalized chain winner resolves an otherwise exact tie');
  assert.equal(compareFinalCrapsBattleEntries(
    { betId: null, battleWinner: true, rankStop: 'bust', rankHands: 1 },
    { betId: '8', rankStop: 'goal', rankPeak: 999 },
  ), -1, 'the verified local-winner fallback stays first even without a bet id');

  assert.match(COMPONENT_SRC,
    /const finalized = frames\.length > 0 && roundNumber >= frames\.length[\s\S]*?compareFinalCrapsBattleEntries\(a, b, this\.#battleWinnerBetId\)/s,
    'the leaderboard switches from live chip order to the final contract order');
});

test('a local bust locks zero and RUN BUSTED while the shared table finishes', () => {
  assert.match(COMPONENT_SRC,
    /#paintViewerBustOutcome\(\)[\s\S]*?event: 'RUN BUSTED'[\s\S]*?result: '0 RETURN'[\s\S]*?state: 'loss'/s);
  assert.match(COMPONENT_SRC,
    /#displayedViewerBankroll\(amount\)[\s\S]*?this\.#viewerBustLocked \? 0n/s,
    'every later tray paint reads zero after the local bust');
  assert.match(COMPONENT_SRC,
    /#paintResolutionResult[\s\S]*?frame\?\.viewerTerminal === 'bust'[\s\S]*?this\.#viewerBustLocked = true[\s\S]*?this\.#paintViewerBustOutcome\(\)/s,
    'the terminal dice result locks the local outcome');
  assert.match(COMPONENT_SRC,
    /#spinResolutionDice[\s\S]*?if \(this\.#viewerBustLocked\) this\.#paintViewerBustOutcome\(\)/s,
    'later opponent rolls cannot replace the local terminal copy');
  assert.match(COMPONENT_SRC,
    /if \(survived\)[\s\S]*?SURVIVED · 2×[\s\S]*?else this\.#paintViewerBustOutcome\(\)/s,
    'a failed survival flip enters the same persistent bust state only after landing');
});

test('leaderboard players are complete, roll-aligned replay perspectives', () => {
  assert.match(COMPONENT_SRC,
    /class="craps-battle-rack__watch"[\s\S]*?data-perspective-bet-id=[\s\S]*?Watch the rest of the battle from/s,
    'every loaded opponent row exposes an accessible viewpoint control');
  assert.match(COMPONENT_SRC,
    /#selectPerspective\(betId,[\s\S]*?this\.#resolutionActive && !this\.#awaitingRoll[\s\S]*?this\.#pendingPerspectiveBetId = selectedBetId[\s\S]*?resumeResolutionIndex: this\.#resolutionIndex[\s\S]*?autoRoll: this\.#autoRoll/s,
    'an in-flight click queues for the resolved boundary and carries the exact position and pace');
  assert.match(COMPONENT_SRC,
    /#queueNextResolutionRoll\(delay = 0\)[\s\S]*?this\.#pendingPerspectiveBetId[\s\S]*?#selectPerspective\(selectedBetId, \{ atResolvedBoundary: true \}\)/s,
    'auto-play honors the queued camera change before starting another roll');
  assert.match(COMPONENT_SRC,
    /#restoreResolutionPerspective\(resumeResolutionIndex\)[\s\S]*?this\.#viewerBustLocked = frames[\s\S]*?this\.#paintResolutionFrame\(frame, index\)[\s\S]*?this\.#paintOpponentRacks\(index \+ 1/s,
    'the selected bankroll, terminal state, felt, and opponent racks are rebuilt at that roll');
  assert.match(COMPONENT_SRC,
    /viewingAnotherPlayer \? 'WATCHING'[\s\S]*?String\(entry\.betId \?\? ''\) === this\.#originalViewerBetId[\s\S]*?\? 'YOU'/s,
    'the camera seat is marked WATCHING while the wallet owner remains marked YOU');
  assert.match(CSS_SRC, /\.craps-battle-rack__watch:focus-visible/,
    'keyboard users receive a visible focus state for perspective controls');
});

test('Craps resolution speed inherits the main reveal pace and scales the full run', async () => {
  const {
    normalizeCrapsResolutionSpeed,
    crapsResolutionDelay,
  } = await import(moduleUrl);
  assert.equal(normalizeCrapsResolutionSpeed(2.26), 2.5);
  assert.equal(normalizeCrapsResolutionSpeed(99), 3);
  assert.equal(normalizeCrapsResolutionSpeed('junk'), 1);
  assert.equal(crapsResolutionDelay(520, 2), 260);
  assert.equal(crapsResolutionDelay(520, 0.5), 1040);

  assert.match(
    COMPONENT_SRC,
    /import \{\s*readDegeneretteSpeed,\s*writeDegeneretteSpeed,\s*\} from '..\/app\/degenerette-preferences\.js';/s,
    'Craps shares the DEFAULT SPEED preference instead of inventing a second setting',
  );
  assert.match(
    COMPONENT_SRC,
    /class="craps-run-speed"[\s\S]*?type="range" min="0\.5" max="3" step="0\.5"[\s\S]*?data-bind="craps-resolution-speed"[\s\S]*?data-bind="craps-resolution-speed-value"/s,
    'the live resolution rail carries a compact 0.5x–3x speed slider',
  );
  assert.match(
    COMPONENT_SRC,
    /this\.#setResolutionSpeed\(readDegeneretteSpeed\(\)\)[\s\S]*?addEventListener\('input',[\s\S]*?#setResolutionSpeed[\s\S]*?addEventListener\('change',[\s\S]*?persist: true/s,
    'each opening starts from the main slider and a committed local change writes it back',
  );
  assert.match(
    COMPONENT_SRC,
    /#resolutionDelay\(milliseconds\)[\s\S]*?crapsResolutionDelay\(milliseconds, this\.#resolutionSpeed\)/s,
    'JavaScript timers all resolve through the active Craps speed',
  );
  assert.match(COMPONENT_SRC, /this\.#resolutionDelay\(4_000\)/,
    'the long survival coin beat is speed-aware too');
  assert.match(
    COMPONENT_SRC,
    /setProperty\?\.\([\s\S]*?`--craps-speed-\$\{duration\}`,[\s\S]*?`\$\{crapsResolutionDelay\(duration, next\)\}ms`/s,
    'the same multiplier is published to the CSS animation durations',
  );
  assert.match(CSS_SRC, /\.craps-run-speed\s*\{[\s\S]*?input\[type="range"\]/s,
    'the local slider has a compact physical-rail treatment');
  assert.match(
    CSS_SRC,
    /\.craps-survival-coin\.is-flipping\s*\{[\s\S]*?var\(--craps-speed-3300, 3300ms\)[\s\S]*?var\(--craps-speed-700, 700ms\)/s,
    'the CSS coin choreography consumes the same speed clock',
  );
});

test('craps model exposes the eleven WIP contract legs', async () => {
  const { CRAPS_BETS, CRAPS_BET_GROUPS } = await import(moduleUrl);
  assert.equal(CRAPS_BET_GROUPS.length, 3);
  assert.equal(CRAPS_BETS.length, 11);
  assert.deepEqual(
    CRAPS_BET_GROUPS.map((group) => [group.id, group.bets.length]),
    [['line', 2], ['odds', 1], ['place', 8]],
  );
  assert.deepEqual(
    CRAPS_BETS.map((bet) => [bet.id, bet.contractField]),
    [
      ['pass', 'passLine'],
      ['dont-pass', 'dontPassLine'],
      ['pass-odds', 'passOddsMult'],
      ['place-4', 'place4'],
      ['place-5', 'place5'],
      ['place-6', 'place6'],
      ['place-8', 'place8'],
      ['place-9', 'place9'],
      ['place-10', 'place10'],
      ['hard-4', 'hard4'],
      ['hard-8', 'hard8'],
    ],
  );
  for (const cut of ['lay-odds', 'hard-6', 'hard-10', 'fire', 'small', 'tall', 'all']) {
    assert.equal(CRAPS_BETS.some((bet) => bet.id === cut), false);
  }
});

test('the placement selector caps every betting spot at four chips', async () => {
  const {
    CRAPS_MAX_CHIPS_PER_BET,
    normalizeCrapsChipsPerBet,
    unpackCrapsContractChips,
  } = await import(moduleUrl);
  assert.equal(CRAPS_MAX_CHIPS_PER_BET, 4);
  assert.deepEqual(
    [-1, 0, 1, 4, 5, 7].map(normalizeCrapsChipsPerBet),
    [0, 0, 1, 4, 4, 4],
  );
  assert.deepEqual(unpackCrapsContractChips(4 | (3 << 3) | (5 << 6)), {
    passLine: 4,
    place4: 3,
    place5: 4,
  });
  assert.match(
    COMPONENT_SRC,
    /#placeChip\(id\)[\s\S]*?previous >= BigInt\(CRAPS_MAX_CHIPS_PER_BET\)[\s\S]*?Four chips is the maximum[\s\S]*?return;[\s\S]*?this\.#bets\.set\(id, previous \+ 1n\)/s,
    'the fifth click is rejected before history or picker state changes',
  );
  assert.match(
    COMPONENT_SRC,
    /#render\(\) \{[\s\S]*?const battleScreen = this\.#screen === 'battle';[\s\S]*?this\.#renderChips\(\);[\s\S]*?if \(battleScreen\) this\.#paintBattleLeaderboard\(0\);[\s\S]*?if \(battleScreen\) \{\s*this\.#renderOtherPlayers\(\);\s*this\.#renderDiceBay\(\);\s*\}/s,
    'the chip picker repaints without entering hidden battle-only renderers',
  );
});

test('fixed wager uses pass odds as a multiplier and produces contract-ready arguments', async () => {
  const { createCrapsWager } = await import(moduleUrl);
  const wager = createCrapsWager({
    bets: {
      pass: 60,
      passOddsMult: 3,
      'place-4': 60,
      'place-5': 60,
      'place-6': 60,
      'place-8': 60,
      'place-9': 60,
      'place-10': 60,
      'hard-4': 60,
      'hard-8': 60,
    },
    hands: 4,
    maxOdds: 100,
    rakeBps: 5000,
    tableIndex: 1842,
  });

  assert.equal(wager.valid, true);
  assert.equal(wager.method, 'placeBet');
  assert.equal(wager.hands, 4);
  assert.equal(wager.oddsStakeFlip, '180');
  assert.equal(wager.perHandFlip, '720');
  assert.equal(wager.maxLossFlip, '2880');
  assert.equal(wager.stakedWei, '2880000000000000000000');
  assert.equal(wager.tableIndex, '1842');
  assert.deepEqual(wager.contractBets, {
    passLine: '60',
    dontPassLine: '0',
    place4: '60',
    place5: '60',
    place6: '60',
    place8: '60',
    place9: '60',
    place10: '60',
    hard4: '60',
    hard8: '60',
    passOddsMult: 3,
  });
  assert.deepEqual(wager.contractArgs, [wager.contractBets, 4]);
});

test('bankroll slip uses the flat FlipCraps call shape', async () => {
  const { createCrapsWager } = await import(moduleUrl);
  const wager = createCrapsWager({
    bets: { passLine: 60, passOddsMult: 3, place6: 60, place8: 60, hard8: 60 },
    mode: 'slip',
    bankrollFlip: 3000,
    goalFlip: 9000,
    maxOdds: 100,
  });

  assert.equal(wager.valid, true);
  assert.equal(wager.mode, 'slip');
  assert.equal(wager.method, 'placeSlip');
  assert.equal(wager.maxSlipHands, 512);
  assert.equal(wager.maxLossFlip, '3000');
  assert.deepEqual(wager.contractArgs, [
    wager.contractBets,
    '3000000000000000000000',
    '9000000000000000000000',
    false,
  ]);
});

test('bankroll rack separates live action from chips sitting out', async () => {
  const {
    crapsNextShooterAffordability,
    crapsPayoutChipCount,
    crapsRackPipLayout,
    crapsRackReserveState,
    crapsRackSplit,
  } = await import(moduleUrl);
  assert.deepEqual(crapsRackSplit({ bankrollFlip: 3000, perHandFlip: 720 }), {
    totalFlip: '3000', inPlayFlip: '720', bankedFlip: '2280',
  });
  assert.deepEqual(crapsRackSplit({ bankrollFlip: 3000, perHandFlip: 720, active: false }), {
    totalFlip: '3000', inPlayFlip: '0', bankedFlip: '3000',
  });
  assert.deepEqual(crapsRackSplit({ bankrollFlip: 3000, perHandFlip: 720, allInPlay: true }), {
    totalFlip: '3000', inPlayFlip: '3000', bankedFlip: '0',
  });
  assert.deepEqual(crapsRackSplit({ bankrollFlip: 3000, perHandFlip: 720, wagerMultiplier: 2 }), {
    totalFlip: '3000', inPlayFlip: '1440', bankedFlip: '1560',
  });
  assert.equal(crapsRackReserveState({ bankedFlip: 720, nextStakeFlip: 720, goalFlip: 9000 }), 'safe');
  assert.equal(crapsRackReserveState({ bankedFlip: 360, nextStakeFlip: 720, goalFlip: 9000 }), 'survival-risk');
  assert.equal(crapsRackReserveState({ bankedFlip: 359, nextStakeFlip: 720, goalFlip: 9000 }), 'bust-risk');
  assert.equal(crapsRackReserveState({ bankedFlip: 9000, nextStakeFlip: 12_000, goalFlip: 9000 }), 'goal-locked',
    'the contract checks goal before survival or bust affordability');
  assert.equal(crapsNextShooterAffordability({ bankrollFlip: 900, nextStakeFlip: 600, goalFlip: 900 }), 'goal');
  assert.equal(crapsNextShooterAffordability({ bankrollFlip: 600, nextStakeFlip: 600, goalFlip: 900 }), 'play');
  assert.equal(crapsNextShooterAffordability({ bankrollFlip: 599, nextStakeFlip: 600, goalFlip: 900 }), 'survival');
  assert.equal(crapsNextShooterAffordability({ bankrollFlip: 300, nextStakeFlip: 600, goalFlip: 900 }), 'survival',
    'exactly half of the next mandatory board still gets the survival flip');
  assert.equal(crapsNextShooterAffordability({ bankrollFlip: 299, nextStakeFlip: 600, goalFlip: 900 }), 'bust');
  const rack = crapsRackPipLayout({
    bankrollFlip: 500,
    capacityFlip: 1000,
    inPlayFlip: 100,
    slotCount: 30,
  });
  assert.equal(rack.percentage, 50, 'the returned bankroll percentage stays exact and linear');
  assert.equal(rack.filledCount, 21, 'the painted fill gives early bankroll growth more room');
  assert.equal(rack.bankedCount, 17);
  assert.equal(rack.inPlayCount, 4,
    'banked and in-play colors retain their share of the curved filled region');
  const twentyX = crapsRackPipLayout({
    bankrollFlip: 3_000,
    capacityFlip: 60_000,
    inPlayFlip: 600,
    slotCount: 30,
  });
  assert.equal(twentyX.percentage, 5);
  assert.equal(twentyX.filledCount, 7,
    'a 20x goal begins with a readable cluster instead of one nearly invisible pip');
  assert.equal(twentyX.bankedCount, 6);
  assert.equal(twentyX.inPlayCount, 1);
  assert.equal(crapsRackPipLayout({
    bankrollFlip: 3_000,
    capacityFlip: 60_000,
    inPlayFlip: 3_000,
    slotCount: 30,
  }).bankedCount, 0, 'an all-in bankroll stays entirely red under the curved scale');
  assert.deepEqual(
    [3_000, 6_000, 12_000, 30_000, 60_000].map((bankrollFlip) => (
      crapsRackPipLayout({ bankrollFlip, capacityFlip: 60_000, slotCount: 30 }).filledCount
    )),
    [7, 9, 13, 21, 30],
    'the 20x tray preserves visible progress from the opening bankroll through the goal',
  );
  assert.equal(crapsPayoutChipCount(60, 600), 1);
  assert.equal(crapsPayoutChipCount(240, 600), 4,
    'a payout already enlarged by the wager multiplier produces a heavier chip count');
});

test('goal lock remaps the bankroll tray onto progressive high-water points', async () => {
  const { crapsProgressiveTrayScale } = await import(moduleUrl);
  const fiveX = crapsProgressiveTrayScale({
    startingBankrollFlip: 3_000,
    goalFlip: 15_000,
    highPointFlip: 18_600,
    thresholdScoreBps: 250_000,
    slotCount: 30,
  });
  assert.equal(fiveX.highPointFlip, 18_600n);
  assert.equal(fiveX.scoreBps, 62_000n);
  assert.equal(fiveX.commonScoreBps, 250_000n);
  assert.equal(fiveX.rareScoreBps, 1_200_000n);
  assert.equal(fiveX.commonMultiple, 25);
  assert.equal(fiveX.rareMultiple, 120);
  assert.equal(fiveX.commonPointPercent, 20.83);
  assert.equal(fiveX.highPointPercent, 5.16);
  assert.equal(fiveX.achievedCount, 2);

  const twentyX = crapsProgressiveTrayScale({
    startingBankrollFlip: 300,
    goalFlip: 6_000,
    highPointFlip: 15_000,
    slotCount: 30,
  });
  assert.equal(twentyX.commonScoreBps, 500_000n,
    'the 20x schedule selects its 50x common point even without duplicate UI data');
  assert.equal(twentyX.rareScoreBps, 2_250_000n);
  assert.equal(twentyX.highPointPercent, 22.22);
  assert.equal(twentyX.achievedCount, 7);
  assert.equal(crapsProgressiveTrayScale({ startingBankrollFlip: 0, highPointFlip: 1 }), null);

  assert.match(COMPONENT_SRC,
    /jackpot\.thresholdScoreBps \?\? detail\.jackpotThresholdScoreBps[\s\S]*?#jackpotThresholdScoreBps/s,
    'the locked scale consumes score basis points from the sealed progressive snapshot');
  assert.match(COMPONENT_SRC,
    /#resolutionHighPoint\(amount\)[\s\S]*?frames\[index\]\?\.bankrollFlip[\s\S]*?bankroll > highPoint/s,
    'the marker keeps the highest bankroll reached, not merely the final return');
  assert.match(COMPONENT_SRC,
    /data-bind="craps-jp-scale"[\s\S]*?data-bind="craps-jp-common-label"[\s\S]*?data-bind="craps-jp-rare-label"[\s\S]*?data-bind="craps-jp-high-amount"/s,
    'the original tray carries both JP points and an exact high-point amount');
  assert.match(COMPONENT_SRC,
    /goalLocked && this\.#jackpotThresholdScoreBps != null[\s\S]*?crapsProgressiveTrayScale[\s\S]*?this\.#paintProgressiveTrayScale\(progressiveScale, chips\)/s,
    'the scale changes only after a goal is locked and progressive terms are known');
  assert.match(CSS_SRC,
    /\.craps-run-rail__tray\[data-scale="progressive"\][\s\S]*?grid-template-areas:[\s\S]*?"well"[\s\S]*?\.craps-run-rail__bankroll \{ display: none; \}/s,
    'the locked tray gives the new scale the full width instead of adding another rack');
  assert.match(CSS_SRC,
    /\.is-goal-locked\.is-jp-achieved[\s\S]*?--craps-rack-chip-tone:\s*#1598f0/s,
    'achieved progressive pips use the former safe-reserve role in blue');
  assert.match(CSS_SRC,
    /\.is-goal-locked\.is-jp-pending[\s\S]*?--craps-rack-chip-tone:\s*#86cdf2/s,
    'unreached progressive pips use a pale-blue version of the former grey remainder');
  assert.match(CSS_SRC,
    /\.craps-run-rail__high-point\s*\{[\s\S]*?left:\s*var\(--craps-jp-high-at[\s\S]*?\.craps-run-rail__high-point > span[\s\S]*?left:\s*0\.3rem/s,
    'the exact amount sits immediately to the right of the high-water marker');
});

test('felt stacks physically double every three completed shooters', async () => {
  const {
    crapsEscalatedChipPresentation,
    crapsWagerMultiplierForShooter,
  } = await import(moduleUrl);

  // ⛔ EVERY THREE SHOOTERS, capped at uint32.max — both moved at the 2026-08-29 re-vendor
  // (`Craps._ESC_HANDS` 5 -> 3, `_ESC_CAP` uint16 -> uint32.max). Shooter 255 is past the
  // ceiling and pins there; 75 and 80 sit either side of a doubling to prove the step, not just
  // the cap.
  assert.deepEqual(
    [0, 4, 5, 9, 10, 14, 15, 75, 80, 255].map(crapsWagerMultiplierForShooter),
    [1, 2, 2, 8, 8, 16, 32, 33_554_432, 67_108_864, 4_294_967_295],
  );
  // The ordinals below are chosen for the MULTIPLIER they land on (1x, 2x, 4x, 8x, 16x), not for
  // themselves — the presentation is a function of the multiple, and the ordinals that produce
  // each one moved when _ESC_HANDS went 5 -> 3. Under the new ladder m = 2^floor(n/3).
  assert.deepEqual(crapsEscalatedChipPresentation(7, 2), {   // 1x
    baseChipCount: '7', effectiveChipCount: '7', multiplier: 1,
    visualScale: 1,
    kind: 'stacks', stacks: ['7'], art: ['/shared/flip-chips/stack-7-high-red.svg'],
  });
  assert.deepEqual(crapsEscalatedChipPresentation(7, 3), {   // 2x
    baseChipCount: '7', effectiveChipCount: '14', multiplier: 2,
    visualScale: 1,
    kind: 'stacks', stacks: ['7', '7'],
    art: ['/shared/flip-chips/stack-7-high-red.svg', '/shared/flip-chips/stack-7-high-red.svg'],
  });
  assert.deepEqual(crapsEscalatedChipPresentation(7, 6), {   // 4x
    baseChipCount: '7', effectiveChipCount: '28', multiplier: 4,
    visualScale: 1,
    kind: 'stacks', stacks: ['10', '9', '9'],
    art: [
      '/shared/flip-chips/stack-10-high-red.svg',
      '/shared/flip-chips/stack-9-high-red.svg',
      '/shared/flip-chips/stack-9-high-red.svg',
    ],
  });
  assert.equal(crapsEscalatedChipPresentation(7, 9).kind, 'pile');    // 8x
  assert.equal(crapsEscalatedChipPresentation(7, 9).effectiveChipCount, '56');
  assert.deepEqual(crapsEscalatedChipPresentation(7, 9).art, ['/shared/flip-chips/pile-6.svg']);
  assert.deepEqual(crapsEscalatedChipPresentation(7, 12).art, ['/shared/flip-chips/pile-8.svg']); // 16x
  for (const shooter of [12, 15, 18, 21, 24, 27, 30, 255]) {
    assert.equal(crapsEscalatedChipPresentation(7, shooter).visualScale, 1,
      'pile art keeps its full lane size so the individual chips remain legible');
  }
  assert.deepEqual(crapsEscalatedChipPresentation(7, 3, 'gold').art, [
    '/shared/flip-chips/stack-7-high-gold.svg',
    '/shared/flip-chips/stack-7-high-gold.svg',
  ]);
  assert.deepEqual(crapsEscalatedChipPresentation(7, 9, 'silver').art, [
    '/shared/flip-chips/pile-6-metal-silver.svg',
  ]);
});

test('opponent bonus stacks use the upright gold face with its silver secondary', () => {
  for (const source of [GOLD_CHIP_SRC, GOLD_STACK_SRC]) {
    assert.match(source, /gold-facing/);
    assert.match(source, /<g id="coin-gold">/);
    assert.match(source, /fill="url\(#face-silver\)"[\s\S]*?fill="url\(#face-gold\)"/s);
    assert.match(source, /transform="rotate\(0 60 60\)"/);
    assert.doesNotMatch(source, /transform="rotate\(-180 60 60\)"/);
  }
});

test('wager validation mirrors the 60 FLIP minimum, pass requirement, odds allowance, bankroll, and goal errors', async () => {
  const { createCrapsWager } = await import(moduleUrl);
  const belowMinimum = createCrapsWager({ bets: { passLine: 30 } });
  assert.deepEqual(belowMinimum.errors.map((error) => error.code), ['StakeBelowTableMinimum']);

  const noPass = createCrapsWager({ bets: { place5: 60, passOddsMult: 4 }, maxOdds: 3 });
  assert.deepEqual(noPass.errors.map((error) => error.code), ['PassRequired', 'OddsAboveAllowance']);

  const badSlip = createCrapsWager({
    bets: { passLine: 60 },
    mode: 'slip',
    bankrollFlip: 10,
    goalFlip: 10,
  });
  assert.deepEqual(badSlip.errors.map((error) => error.code), ['BankrollBelowStake', 'BadGoal']);

  const empty = createCrapsWager();
  assert.equal(empty.errors[0].code, 'NoStake');
});

test('stake/theo helpers use whole FLIP inputs and contract payout math', async () => {
  const {
    CRAPS_FLIP_WEI,
    crapsRemainingEntrantsAtRound,
    crapsStandingAtRound,
    crapsStakeFor,
    crapsTheoFor,
    formatCrapsCompactFlip,
    formatCrapsFlip,
    formatCrapsJackpotFlip,
    formatCrapsStanding,
  } = await import(moduleUrl);
  assert.equal(crapsStakeFor({ passLine: 30, passOddsMult: 3, place4: 30, place9: 30, place10: 30 }), 210n);
  assert.equal(crapsTheoFor({
    passLine: 251,
    place4: 10,
    place5: 15,
    place6: 36,
    place8: 36,
    place9: 15,
    place10: 10,
    hard4: 8,
    hard8: 10,
  }), 15n * CRAPS_FLIP_WEI);
  assert.equal(formatCrapsFlip('16777215'), '16,777,215');
  assert.equal(formatCrapsCompactFlip('3000'), '3,000');
  assert.equal(formatCrapsCompactFlip('9999'), '9,999');
  assert.equal(formatCrapsCompactFlip('10000'), '10K');
  assert.equal(formatCrapsCompactFlip('10500'), '10.5K');
  assert.equal(formatCrapsJackpotFlip('1000000'), '1.00M');
  assert.equal(formatCrapsJackpotFlip('1250000'), '1.25M');
  assert.equal(formatCrapsJackpotFlip('1256000'), '1.26M');
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21, 50].map(formatCrapsStanding),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '50th'],
  );
  assert.equal(crapsStandingAtRound({ rankTimeline: [50, 21, 3], roundNumber: 1 }), 21,
    'an authoritative full-field timeline wins over any viewport estimate');
  assert.equal(crapsStandingAtRound({ fallbackRank: 4, fieldEntrants: 50, loadedEntrants: 4 }), null,
    'a featured-only viewport cannot pretend fourth in the viewport means fourth in the field');
  assert.equal(crapsStandingAtRound({ fallbackRank: 4, loadedEntrants: 4 }), 4,
    'the full local demo can calculate its standing without a publisher timeline');
  assert.equal(crapsRemainingEntrantsAtRound({
    remainingTimeline: [24, 19, 7], roundNumber: 1, fieldEntrants: 24,
  }), 19, 'an authoritative full-field timeline supplies the active entrant count');
  assert.equal(crapsRemainingEntrantsAtRound({
    standings: [{ state: 'live' }, { state: 'cashout' }, { state: 'bust' }],
    fieldEntrants: 3,
    loadedEntrants: 3,
  }), 1, 'a fully loaded field can count the entrants that are still playing');
  assert.equal(crapsRemainingEntrantsAtRound({
    standings: [{ state: 'live' }, { state: 'bust' }],
    fieldEntrants: 24,
    loadedEntrants: 2,
  }), null, 'a featured-only viewport cannot invent a full-field remaining count');
});

test('the ten-row leaderboard includes YOU and only reorders at table checkpoints', async () => {
  const {
    crapsLeaderboardCheckpoint,
    crapsLeaderboardRows,
    toggleCrapsFeltOpponent,
  } = await import(moduleUrl);
  const opponents = Array.from({ length: 12 }, (_, index) => ({
    key: `opponent-${index + 1}`,
    local: false,
    opponentIndex: index,
    rank: index + 1,
  }));
  const local = { key: 'local', local: true, opponentIndex: -1, rank: 3 };
  const topThreeViewer = crapsLeaderboardRows([
    opponents[0], opponents[1], local, ...opponents.slice(2),
  ], { localRank: 3 });
  assert.equal(topThreeViewer.length, 10);
  assert.equal(topThreeViewer.filter((entry) => entry.local).length, 1);
  assert.deepEqual(topThreeViewer.map((entry) => entry.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const pinnedViewer = crapsLeaderboardRows([...opponents, local], { localRank: 37 });
  assert.equal(pinnedViewer.length, 10);
  assert.equal(pinnedViewer.at(-1).key, 'local');
  assert.equal(pinnedViewer.at(-1).rank, 37, 'a pinned viewer keeps the true field place');
  assert.equal(pinnedViewer.filter((entry) => !entry.local).length, 9);

  assert.equal(crapsLeaderboardCheckpoint({ label: 'POINT 8 MADE' }), true);
  assert.equal(crapsLeaderboardCheckpoint({ label: 'SEVEN-OUT' }), true);
  assert.equal(crapsLeaderboardCheckpoint({ label: 'BATTLE COMPLETE', terminal: 'bust' }), true);
  assert.equal(crapsLeaderboardCheckpoint({ label: 'POINT 8 SET' }), false);
  assert.equal(crapsLeaderboardCheckpoint({ label: 'PLACE 6 PAYS' }), false);

  assert.deepEqual(toggleCrapsFeltOpponent([], 'one'), ['one']);
  assert.deepEqual(toggleCrapsFeltOpponent(['one'], 'two'), ['one', 'two']);
  assert.deepEqual(toggleCrapsFeltOpponent(['one', 'two'], 'three'), ['two', 'three'],
    'a third selection replaces the oldest felt opponent');
  assert.deepEqual(toggleCrapsFeltOpponent(['two', 'three'], 'two'), ['three'],
    'clicking a selected opponent hides their felt chips');
});

test('other players aggregate generic chip counts without entering the local seven', async () => {
  const { aggregateCrapsTableBets, createCrapsWager } = await import(moduleUrl);
  const table = aggregateCrapsTableBets([
    {
      player: '0x1111111111111111111111111111111111111111',
      discordPfp: '/avatars/one.png',
      color: '#123abc',
      resolution: {
        type: 'cashout', roll: 4, amountFlip: 600, survived: true, paidFlip: 1200,
        shooterBoosts: [{ active: true, percent: 20 }, null, { active: true, percent: 20 }],
      },
      chips: { passLine: 2, dontPassLine: 1, place6: 3 },
    },
    {
      player: '0x2222222222222222222222222222222222222222',
      label: 'rollhard.eth',
      resolution: { type: 'bust', roll: 2, startingBankrollFlip: 360, bankrollsFlip: [180, 0] },
      chips: { place6: 2, hard4: 1 },
    },
  ]);

  assert.equal(table.playerCount, 2);
  assert.deepEqual(Object.fromEntries(Object.entries(table.bets).map(([id, row]) => [id, {
    chipCount: row.chipCount,
    playerCount: row.playerCount,
  }])), {
    pass: { chipCount: '2', playerCount: 1 },
    'dont-pass': { chipCount: '1', playerCount: 1 },
    'place-6': { chipCount: '5', playerCount: 2 },
    'hard-4': { chipCount: '1', playerCount: 1 },
  });
  assert.deepEqual(table.players.map(({ label, color, avatar, totalChips, betCount }) => ({ label, color, avatar, totalChips, betCount })), [
    { label: '0x1111…1111', color: '#123abc', avatar: '/avatars/one.png', totalChips: '6', betCount: 3 },
    { label: 'rollhard.eth', color: '#ff66b3', avatar: '', totalChips: '3', betCount: 2 },
  ]);
  assert.deepEqual(table.players.map(({ totalChips, betIds }) => ({ totalChips, betIds })), [
    { totalChips: '6', betIds: ['pass', 'dont-pass', 'place-6'] },
    { totalChips: '3', betIds: ['place-6', 'hard-4'] },
  ]);
  assert.deepEqual(table.bets['place-6'].players.map(({ label, chipCount, color }) => ({ label, chipCount, color })), [
    { label: '0x1111…1111', chipCount: '3', color: '#123abc' },
    { label: 'rollhard.eth', chipCount: '2', color: '#ff66b3' },
  ]);
  assert.deepEqual(table.bets['place-6'].players.map(({ exitType, exitRoll }) => ({ exitType, exitRoll })), [
    { exitType: 'cashout', exitRoll: 4 },
    { exitType: 'bust', exitRoll: 2 },
  ]);
  assert.equal(table.players[1].exitType, 'bust');
  assert.equal(table.players[0].exitType, 'cashout');
  assert.equal(table.players[0].exitRoll, 4);
  assert.equal(table.players[0].survived, true);
  assert.equal(table.players[0].paidFlip, '1200');
  assert.deepEqual(table.players[0].shooterBoosts, [
    { percent: 20 }, null, { percent: 20 },
  ]);
  assert.equal(table.players[0].passLineChips, '2');
  assert.equal(table.players[0].lineChips, '3');
  assert.equal(table.players[1].passLineChips, '0');
  assert.equal(table.players[1].exitRoll, 2);
  assert.equal(table.players[1].startingBankrollFlip, '360');
  assert.deepEqual(table.players[1].bankrollsFlip, ['180', '0']);
  const longReplay = aggregateCrapsTableBets([{
    betId: '99',
    resolution: { type: 'cashout', roll: 4_600, amountFlip: 1 },
    chips: { passLine: 1 },
  }]);
  assert.equal(longReplay.players[0].exitRoll, 4_600,
    'roll identity uses the 4,607-roll replay cap, not the 256-shooter cap');
  assert.equal(createCrapsWager({ bets: { passLine: 30 } }).perHandFlip, '30');
});

test('tracked rivals flip their own survival coins beside their portraits', async () => {
  const { aggregateCrapsTableBets } = await import(moduleUrl);
  const table = aggregateCrapsTableBets([{
    player: '0x3333333333333333333333333333333333333333',
    resolution: {
      type: 'bust',
      roll: 4,
      survivals: [null, { survived: true }, false, 'junk'],
    },
    chips: { passLine: 1 },
  }]);
  assert.deepEqual(table.players[0].survivals, [null, { survived: true }, { survived: false }, null],
    'boolean and object flips normalize; junk fails closed to no coin');

  assert.match(
    COMPONENT_SRC,
    /#startSurvivalFlip\(\{ bankrollFlip[\s\S]*?#beginOpponentCoinFlips\([\s\S]*?'paired',\s*\);[\s\S]*?#paintOpponentRacks\(frameIndex \+ 1\)/s,
    'paired rival coins begin before the rack repaint so the repaint renders them',
  );
  assert.match(COMPONENT_SRC, /sfxCoinflipLand\(survived\);[\s\S]{0,160}?this\.#landOpponentCoinFlips\(\);/,
    'rival coins land together with the player coin');
  assert.match(
    COMPONENT_SRC,
    /#startOpponentOnlySurvivalFlips\(\s*this\.#opponentSurvivalFlipsAt\(this\.#endedShooterAtFrame\(nextIndex\)\),\s*proceed,\s*\)/,
    'a boundary where only rivals hit the survival range still gets its own beat',
  );
  assert.match(COMPONENT_SRC, /coinInAir = this\.#opponentCoinFlips\.get\(player\.key\)\?\.phase === 'flipping'/,
    'a coin still in the air must not pre-paint its own bust');
  assert.match(
    COMPONENT_SRC,
    /survivalBeat = frame\?\.survival != null\s*\|\| this\.#opponentSurvivalFlipsAt\(this\.#endedShooterAtFrame\(this\.#resolutionIndex\)\)\.length > 0/,
    'a survival boundary retains the keyed rival coin while the live top ten changes underneath it',
  );
  assert.match(COMPONENT_SRC, /craps-battle-rack__coin-pop">\$\{coinFlip\.survived \? 'SURVIVED' : 'BUSTED'\}/,
    'the coin pops its verdict when it lands');
  assert.match(
    CSS_SRC,
    /\.craps-battle-rack__coin\[data-phase="flipping"\] \.craps-battle-rack__coin-face \{[^}]*craps-survival-face-track/s,
    'the mini coin reuses the big coin face-swap flip',
  );
  assert.match(
    CSS_SRC,
    /\.craps-battle-rack__coin\[data-phase="landed"\]\[data-result="win"\] \.craps-battle-rack__coin-face \{[^}]*coinflip-face-eth\.svg/s,
  );
  assert.match(CSS_SRC, /@keyframes craps-rack-coin-pop/);
  assert.match(DEMO_SCRIPT_SRC, /survivalRun \? \{ survivals: \[\{ survived: false \}\] \}/,
    'the demo survival run shows a rival busting its coin');
  assert.match(DEMO_SCRIPT_SRC, /survivalRun \? \{ survivals: \[null, \{ survived: true \}\] \}/,
    'the demo survival run shows a rival doubling through its coin');
});

test('settlement roll logs decode into shared shooter replays', async () => {
  const { decodeCrapsRolls } = await import(moduleUrl);
  assert.deepEqual(decodeCrapsRolls('0x2311004400'), [
    {
      ordinal: 0,
      rolls: [
        { d1: 2, d2: 3, total: 5, hard: false },
        { d1: 1, d2: 1, total: 2, hard: true },
      ],
    },
    { ordinal: 1, rolls: [{ d1: 4, d2: 4, total: 8, hard: true }] },
  ]);
  assert.throws(() => decodeCrapsRolls('0x70'), /Invalid die/);
});

test('the transient seven distinguishes a come-out win from seven-out', async () => {
  const { crapsSevenRollOutcome } = await import(moduleUrl);
  assert.equal(crapsSevenRollOutcome({ total: 7, label: 'COME-OUT 7' }, { comeOut: true }), 'win');
  assert.equal(crapsSevenRollOutcome({ total: 7, label: 'SEVEN OUT' }, { comeOut: false }), 'crap-out');
  assert.equal(crapsSevenRollOutcome({ total: 7, label: 'SEVEN-OUT' }, { comeOut: true }), 'crap-out',
    'an explicit seven-out label wins over inconsistent phase data');
  assert.equal(crapsSevenRollOutcome({ total: 6, label: 'POINT 6 MADE' }, { comeOut: false }), '');
});

test('resolution run pairs exact bankroll snapshots with each shared shooter', async () => {
  const {
    crapsBoardDealBetIds,
    crapsComeOutHeldBetIds,
    crapsRetiredBetIds,
    createCrapsResolutionRun,
    normalizeCrapsShooterBoost,
  } = await import(moduleUrl);
  const run = createCrapsResolutionRun({
    startingBankrollFlip: 300,
    goalFlip: 600,
    rolls: '0x33004400',
    hands: [
      { bankrollFlip: 420, label: 'WIN' },
      { deltaFlip: -420 },
      { bankrollFlip: 600, terminal: 'goal' },
    ],
  });
  assert.equal(run.capacityFlip, '600');
  assert.deepEqual(run.frames.map(({ bankrollFlip, deltaFlip, d1, d2, point, terminal }) => ({ bankrollFlip, deltaFlip, d1, d2, point, terminal })), [
    { bankrollFlip: '420', deltaFlip: '120', d1: 3, d2: 3, point: 6, terminal: '' },
    { bankrollFlip: '0', deltaFlip: '-420', d1: 4, d2: 4, point: 8, terminal: 'bust' },
  ]);

  const explicitPointRun = createCrapsResolutionRun({
    startingBankrollFlip: 300,
    rolls: '0x330022004200',
    hands: [
      { bankrollFlip: 300, label: 'POINT 6 SET', point: 6 },
      { bankrollFlip: 300, label: 'POINT 6 MADE', point: null },
      { bankrollFlip: 300, label: 'LEGACY INFERRED POINT' },
    ],
  });
  assert.deepEqual(explicitPointRun.frames.map((frame) => frame.point), [6, null, 6],
    'an explicit off point stays off; only legacy frames with no point field infer from rolls');

  const exactLineRun = createCrapsResolutionRun({
    startingBankrollFlip: 1_000,
    hands: [
      {
        bankrollFlip: 820,
        label: 'CRAPS 3',
        dice: [1, 2],
        point: null,
        payoutBets: ['dont-pass'],
        lostBets: ['pass'],
      },
      {
        bankrollFlip: 820,
        label: 'COME-OUT 7',
        dice: [3, 4],
        point: null,
        payoutBets: [],
        lostBets: [],
      },
      {
        bankrollFlip: 1_000,
        label: 'COME-OUT 7',
        dice: [3, 4],
        point: null,
        payoutBets: ['pass'],
        lostBets: ['dont-pass'],
      },
    ],
  });
  assert.deepEqual(
    exactLineRun.frames.map(({ payoutBets, lostBets, retiredBets, payoutBetsExact }) => ({
      payoutBets, lostBets, retiredBets, payoutBetsExact,
    })),
    [
      {
        payoutBets: ['dont-pass'], lostBets: ['pass'], retiredBets: ['pass', 'dont-pass'], payoutBetsExact: true,
      },
      { payoutBets: [], lostBets: [], retiredBets: [], payoutBetsExact: true },
      {
        payoutBets: ['pass'], lostBets: ['dont-pass'], retiredBets: ['dont-pass'], payoutBetsExact: true,
      },
    ],
    'exact line winners and deaths survive normalization, including an authoritative empty payout list',
  );
  assert.deepEqual(crapsBoardDealBetIds(
    ['pass', 'dont-pass', 'place-6', 'hard-8'],
    { phase: 'come-out' },
  ), ['pass', 'dont-pass'], 'come-out deals only line chips');
  assert.deepEqual(crapsBoardDealBetIds(
    ['pass', 'dont-pass', 'place-6', 'hard-8'],
    { phase: 'point' },
  ), ['place-6', 'hard-8'], 'point establishment deals the parked number and hardway chips');
  assert.deepEqual(crapsComeOutHeldBetIds(
    ['pass', 'dont-pass', 'place-6', 'hard-8'],
    { heldBetIds: ['dont-pass'], resetLines: false },
  ), ['dont-pass', 'place-6', 'hard-8'],
  'same-shooter come-out parks non-lines while preserving the exact dead line');
  assert.deepEqual(crapsComeOutHeldBetIds(
    ['pass', 'dont-pass', 'place-6', 'hard-8'],
    { heldBetIds: ['pass', 'dont-pass'], resetLines: true },
  ), ['place-6', 'hard-8'],
  'the next shooter recommits both lines while leaving point bets parked');
  assert.deepEqual(crapsRetiredBetIds({
    payoutBets: ['place-8', 'pass'],
    lostBets: ['hard-8', 'dont-pass'],
  }), ['hard-8', 'dont-pass'], 'losing hardways and lines retire for the shooter');
  assert.deepEqual(crapsRetiredBetIds({
    payoutBets: ['dont-pass'],
    lostBets: ['pass'],
  }), ['pass', 'dont-pass'], 'winning Don’t Pass retires with the losing Pass decision');

  const goalRun = createCrapsResolutionRun({
    startingBankrollFlip: 300,
    goalFlip: 600,
    hands: [
      { bankrollFlip: 600, label: 'GOAL HIT', dice: [4, 4], terminal: 'goal' },
      { bankrollFlip: 690, label: 'PLACE 6 PAID', dice: [4, 2] },
      { bankrollFlip: 600, label: 'SEVEN OUT', dice: [4, 3] },
      { bankrollFlip: 900, label: 'SHOULD NOT PLAY', dice: [3, 3] },
    ],
  });
  assert.deepEqual(goalRun.frames.map(({ bankrollFlip, terminal }) => ({ bankrollFlip, terminal })), [
    { bankrollFlip: '600', terminal: '' },
    { bankrollFlip: '690', terminal: '' },
    { bankrollFlip: '600', terminal: 'goal' },
  ]);

  const sealedRun = createCrapsResolutionRun({
    startingBankrollFlip: 300,
    goalFlip: 600,
    hands: [
      { bankrollFlip: 720, label: 'INTRA-SHOOTER HIGH', dice: [3, 3], shooter: 0, globalRoll: 0, terminal: '' },
      { bankrollFlip: 510, label: 'SHOOTER CONTINUES', dice: [2, 3], shooter: 0, globalRoll: 1, terminal: '' },
      { bankrollFlip: 630, label: 'SEALED GOAL', dice: [4, 3], shooter: 0, globalRoll: 2, terminal: 'goal' },
    ],
  });
  assert.deepEqual(
    sealedRun.frames.map(({ bankrollFlip, shooter, globalRoll, terminal }) => ({
      bankrollFlip, shooter, globalRoll, terminal,
    })),
    [
      { bankrollFlip: '720', shooter: 0, globalRoll: 0, terminal: '' },
      { bankrollFlip: '510', shooter: 0, globalRoll: 1, terminal: '' },
      { bankrollFlip: '630', shooter: 0, globalRoll: 2, terminal: 'goal' },
    ],
    'sealed terminal flags, not a temporary bankroll crossing, decide where replay stops',
  );

  const survivalRun = createCrapsResolutionRun({
    startingBankrollFlip: 3000,
    goalFlip: 9000,
    hands: [
      { bankrollFlip: 420, label: 'SEVEN OUT', survival: { survived: true } },
      { bankrollFlip: 960, label: 'NEXT SHOOTER' },
      { bankrollFlip: 360, label: 'SEVEN OUT', survival: { survived: false } },
    ],
  });
  assert.deepEqual(
    survivalRun.frames.map(({
      startingBankrollFlip, bankrollFlip, deltaFlip, survival, terminal,
    }) => ({ startingBankrollFlip, bankrollFlip, deltaFlip, survival, terminal })),
    [
      {
        startingBankrollFlip: '3000', bankrollFlip: '420', deltaFlip: '-2580',
        survival: { survived: true }, terminal: '',
      },
      {
        startingBankrollFlip: '840', bankrollFlip: '960', deltaFlip: '120',
        survival: null, terminal: '',
      },
      {
        startingBankrollFlip: '960', bankrollFlip: '360', deltaFlip: '-600',
        survival: { survived: false }, terminal: 'bust',
      },
    ],
    'a successful survival doubling becomes the next shooter baseline, not table winnings',
  );

  assert.deepEqual(normalizeCrapsShooterBoost(true, 25), { percent: 25 });
  assert.deepEqual(normalizeCrapsShooterBoost({ active: true, profitPercent: 300 }), { percent: 255 });
  assert.equal(normalizeCrapsShooterBoost({ active: false, percent: 20 }), null);
  const boostRun = createCrapsResolutionRun({
    startingBankrollFlip: 300,
    hands: [
      { bankrollFlip: 330, label: 'PLACE 6 PAID', shooterBoost: { active: true, percent: 20 } },
      { bankrollFlip: 300, label: 'SEVEN OUT' },
      { bankrollFlip: 360, label: 'PLACE 8 PAID' },
      { bankrollFlip: 300, label: 'SEVEN OUT' },
      { bankrollFlip: 420, label: 'HARD 8 HIT', shooterBoost: true, shooterBoostPercent: 35 },
    ],
  });
  assert.deepEqual(boostRun.frames.map((frame) => frame.shooterBoost), [
    { percent: 20 },
    { percent: 20 },
    null,
    null,
    { percent: 35 },
  ], 'one eligibility draw persists across every roll in its shooter and resets after seven-out');
});

test('popup presents seven-chip battle play, player bands, settlement, and replay accessibly', () => {
  assert.match(COMPONENT_SRC, /role="dialog" aria-modal="true"/);
  assert.match(COMPONENT_SRC, /<h2 id="craps-title">CRAPS<\/h2>/);
  assert.match(COMPONENT_SRC, /class="craps-dialog__prizes"[\s\S]*?craps-dialog__prize--jackpot[\s\S]*?craps-dialog__jackpot-label[\s\S]*?RUN IT UP[\s\S]*?JACKPOT[\s\S]*?craps-dialog__prize--goal[\s\S]*?<small>GOAL<\/small>[\s\S]*?craps-dialog__prize--bounty/s,
    'the header stacks the jackpot label, keeps a compact goal, and leaves the widest tile for Battle');
  assert.match(COMPONENT_SRC, /#paintTitleGoal\(\)[\s\S]*?formatCrapsCompactFlip\(this\.#goal\)/s,
    'the header goal is painted from the active run rather than static copy');
  assert.match(CSS_SRC, /\.craps-dialog__prizes\s*\{[\s\S]*?grid-template-columns:\s*minmax\(8rem, 0\.82fr\) minmax\(5\.4rem, 0\.5fr\) minmax\(14rem, 1\.68fr\)[\s\S]*?justify-self:\s*center/s,
    'the compact goal yields header space to the wider Battle prize');
  assert.match(CSS_SRC, /\.craps-dialog__prizes\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?left:\s*50%;[\s\S]*?transform:\s*translateX\(-50%\)/s,
    'the prize strip and its middle goal are centered on the table, independent of asymmetric title controls');
  assert.match(CSS_SRC, /\.craps-dialog__prize--goal\s*\{[\s\S]*?--prize-accent:\s*#42c9c1/s,
    'goal keeps its own teal identity while using the common prize sizing');
  assert.match(CSS_SRC, /\.craps-dialog__prize--goal\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?grid-template-rows:\s*auto auto;[\s\S]*?place-items:\s*center/s,
    'the compact goal stacks its label over the amount so neither needs a wide box');
  assert.doesNotMatch(COMPONENT_SRC, /craps-dialog__title-row|class="craps-dialog__goal"/,
    'the former undersized title-row goal is gone');
  assert.doesNotMatch(COMPONENT_SRC, /craps-dialog__rule|craps-intro|craps-table-felt__stamp/,
    'the compact top rail avoids bringing back instructional clutter');
  assert.match(COMPONENT_SRC, /class="craps-dialog__prizes"[^>]*data-bind="craps-prize-marquee"[\s\S]*?craps-dialog__jackpot-label[\s\S]*?<span>RUN IT UP<\/span><span>JACKPOT<\/span>[\s\S]*?data-bind="craps-jackpot-marquee-amount"[\s\S]*?<small>GOAL<\/small>[\s\S]*?data-bind="craps-title-goal-amount"[\s\S]*?data-bind="craps-bounty-label">BATTLE<\/small>[\s\S]*?data-bind="craps-bounty-amount"[\s\S]*?<small>ADDED<\/small>[\s\S]*?data-bind="craps-bounty-added-amount"/s,
    'the persistent header prominently names and displays jackpot, goal, battle prize, and added FLIP');
  assert.match(COMPONENT_SRC, /<strong><output data-bind="craps-jackpot-marquee-amount">—<\/output><\/strong>/,
    'the jackpot amount stands alone without a redundant FLIP suffix');
  assert.match(COMPONENT_SRC, /jackpotMarqueeAmount\.textContent = showJackpot \? formatCrapsJackpotFlip\(jackpotAmount\) : '—'/,
    'the jackpot marquee keeps two decimal places at million scale');
  assert.doesNotMatch(COMPONENT_SRC, /MAIN BOUNTY|BOUNTY POOL/,
    'the clipped bounty heading is replaced by the compact BATTLE label');
  assert.match(CSS_SRC, /\.craps-dialog__prize--bounty\s*\{[\s\S]*?grid-template-columns:[^;]*minmax\(4\.9rem, 1\.1fr\)/s,
    'the compact battle amount keeps enough width for a full four-figure abbreviation beside FLIP');
  assert.match(COMPONENT_SRC, /detail\.bountyPoolFlip \?\? detail\.totalBountyFlip[\s\S]*?detail\.bountyPoolWei \?\? detail\.totalBountyWei/s,
    'the bounty readout consumes an exact whole-pool value in either UI unit');
  assert.doesNotMatch(COMPONENT_SRC, /const bountyAmount = this\.#battleStake \* BigInt\(this\.#entryMultiple\)/,
    'the header never relabels the viewer’s individual entry stake as the pool');
  assert.match(CSS_SRC, /\.craps-dialog__prize output\s*\{[\s\S]*?font:\s*1000 clamp\(0\.88rem, 1\.55vw, 1\.12rem\)/s,
    'prize values use display-sized type instead of the tiny progressive tray labels');
  assert.match(CSS_SRC, /\.craps-dialog__prize--jackpot\[data-state="won-other"\]\s*\{[\s\S]*?grayscale\(0\.94\) brightness\(0\.62\)/s,
    'the prominent jackpot value darkens with the tray after another player wins');
  assert.match(COMPONENT_SRC, /detail\.addedFlip \?\? detail\.addedBountyFlip[\s\S]*?detail\.addedFlipWei \?\? detail\.addedBountyWei/s,
    'the table accepts whole-FLIP UI data and the replay contract’s exact added-FLIP wei');
  assert.match(CSS_SRC, /\.craps-dialog__prize-added\s*\{[\s\S]*?border-left:[\s\S]*?\.craps-dialog__prize-added output\s*\{[\s\S]*?font-size:/s,
    'added FLIP has a bounded secondary compartment rather than competing with the bounty total');
  assert.doesNotMatch(COMPONENT_SRC, /<legend>/,
    'the felt has no redundant line, odds, or place section captions');
  assert.match(COMPONENT_SRC, /name="craps-bankroll"/);
  assert.match(COMPONENT_SRC, /class="craps-run-rail"[^>]*data-bind="craps-resolution"/);
  assert.match(COMPONENT_SRC, /class="craps-run-rail__rack"[^>]*data-bind="craps-resolution-chips"/);
  // ⛔ THE PROGRESSIVE RACK IS GONE — the main player bankroll rack carries that job now, so
  // there is no second tray, no jackpot meter and no score end caps to assert. The jackpot's
  // headline figure survives in the MARQUEE, which the prize-marquee assertions below cover.
  assert.doesNotMatch(COMPONENT_SRC, /craps-jackpot-tray|craps-jackpot-chips|craps-jackpot-meter/,
    'no second progressive tray, meter or chip rack remains');
  assert.match(COMPONENT_SRC, /jackpot\.amountFlip[\s\S]*?detail\.jackpotAmountFlip/s,
    'the widget consumes one progressive snapshot without polling');
  assert.match(COMPONENT_SRC, /jackpot\.claimedByOther === true[\s\S]*?jackpot\.eligible === false[\s\S]*?this\.#jackpotState = otherWon \? 'won-other'/s,
    'an explicit other-player win makes the viewer ineligible');
  assert.match(COMPONENT_SRC, /#paintResolutionResult\(frame, index, \{ comeOut = false \} = \{\}\)[\s\S]*?#paintJackpotTray\(index \+ 1\)/s,
    'each resolved replay roll advances the progressive tray locally');
  assert.match(COMPONENT_SRC, /createCrapsResolutionRun/);
  assert.doesNotMatch(COMPONENT_SRC, /craps-run-head/);
  assert.match(COMPONENT_SRC, /data-bind="craps-dice-bay"/);
  assert.match(COMPONENT_SRC, /data-bind="craps-roll-total"/);
  assert.match(COMPONENT_SRC, /data-point-puck="\$\{escapeHtml\(bet\.number\)\}"/);
  assert.match(COMPONENT_SRC, /class="craps-bet__odds"><small>PAYS<\/small>\$\{escapeHtml\(bet\.pays\)\}<\/span>/,
    'standard live betting spots print their repo-defined payout odds directly on the felt');
  assert.match(COMPONENT_SRC, /class="craps-bet__hardway-legend"[\s\S]*?<small>HARD<\/small><strong>\$\{hardwayNumber\}<\/strong><em>PAYS \$\{escapeHtml\(bet\.pays\)\}<\/em>/s,
    'hardways reserve a bottom-left three-line legend that stays readable under placed chips');
  assert.match(COMPONENT_SRC, /bet\.id === 'dont-pass'[\s\S]*?class="craps-bet__wwxrp-mark" src="\/shared\/coinflip-face-red\.svg"/s,
    'the Don’t Pass lane carries the canonical small WWXRP felt mark');
  assert.match(COMPONENT_SRC, /shortLabel: 'PASS'/);
  assert.match(COMPONENT_SRC, /shortLabel: "DON'T PASS"/);
  assert.doesNotMatch(COMPONENT_SRC, /shortLabel: ['"](?:PASS LINE|DON'T PASS LINE)['"]/,
    'the felt uses the short physical-table lane names');
  assert.match(COMPONENT_SRC, /id: 'place-4'[\s\S]*?pays: '2:1'[\s\S]*?id: 'place-5'[\s\S]*?pays: '3:2'[\s\S]*?id: 'place-6'[\s\S]*?pays: '7:6'[\s\S]*?id: 'place-8'[\s\S]*?pays: '7:6'[\s\S]*?id: 'place-9'[\s\S]*?pays: '3:2'[\s\S]*?id: 'place-10'[\s\S]*?pays: '2:1'/s,
    'place payouts match the current true-odds contract table');
  assert.match(COMPONENT_SRC, /id: 'dont-pass'[\s\S]*?pays: '3:4'[\s\S]*?edge: '13\.73%'/s,
    'the changed single-decision Don’t Pass price matches the current contract');
  assert.match(COMPONENT_SRC, /data-bind="craps-roll-board"/);
  assert.match(COMPONENT_SRC, /data-bind="craps-resolution-auto"/);
  assert.match(COMPONENT_SRC, /data-bind="craps-resolution-roll"/);
  assert.match(COMPONENT_SRC, /#queueNextResolutionRoll/);
  assert.match(COMPONENT_SRC, /data-bind="craps-survival-stage"/);
  assert.match(COMPONENT_SRC, /coinflip-face-eth\.svg/);
  assert.match(COMPONENT_SRC, /class="craps-battle-board"[^>]*data-bind="craps-battle-board"/);
  assert.match(COMPONENT_SRC, /data-bind="craps-battle-rows"/);
  assert.match(COMPONENT_SRC, /class="craps-battle-rack__identity"[\s\S]*?class="craps-battle-rack__amount"[\s\S]*?\$\{amountCopy\}[\s\S]*?class="craps-battle-rack__well"/s,
    'every featured rack prints its current bankroll or final Battle award to the left of the chip well');
  assert.doesNotMatch(COMPONENT_SRC, /class="craps-battle-rack__amount"[\s\S]{0,180}?<small>FLIP<\/small>/s,
    'rack balances do not repeat a visible FLIP unit label');
  assert.match(COMPONENT_SRC, /aria-label="Live top ten including you\. Tap up to two opponents to show their chips on the felt\.[^"]+"[\s\S]*?<strong>LIVE TOP 10<\/strong><small>TAP PLAYERS · MAX 2<\/small>/s,
    'the leaderboard identifies its ten-player scope and makes the opt-in felt interaction discoverable');
  assert.doesNotMatch(COMPONENT_SRC, /craps-battle-round|CURRENT BATTLE · TOP 3/,
    'the leaderboard does not retain the obsolete top-three caption or round label');
  assert.match(COMPONENT_SRC, /#paintOpponentRacks/);
  assert.match(COMPONENT_SRC, /status = 'BUST'/,
    'a player who exhausts their bankroll stays visible in a fixed busted rack');
  assert.match(COMPONENT_SRC, /else if \(goalHit\) \{[\s\S]*?state = 'cashout';[\s\S]*?status = 'LOCKED'/s,
    'reaching the goal locks immediately without an ending flip');
  assert.doesNotMatch(COMPONENT_SRC, /FLIP PENDING|AT FLIP|ROUND SURVIVED|ROUND BUSTED|DOUBLE OR NOTHING/,
    'obsolete shared and end-of-run flip states are gone');
  assert.match(COMPONENT_SRC, /SURVIVAL FLIP/);
  assert.match(COMPONENT_SRC, /SURVIVED · 2×/);
  assert.match(COMPONENT_SRC, /RUN BUSTED/,
    'a failed survival lands on the same terminal outcome as every other bust');
  assert.match(COMPONENT_SRC, /data-bind="craps-shooter-boost"/);
  assert.match(COMPONENT_SRC, /data-bind="craps-shooter-boost-copy"/);
  assert.match(COMPONENT_SRC, /copy\.textContent = 'BONUS SHOOTER'/,
    'the local activation is one small gold Degenerette-style text hit');
  assert.match(COMPONENT_SRC, /data-bind="craps-shooter-boost-multiplier"/);
  assert.match(COMPONENT_SRC, /`\+\$\{percent\}%`/,
    'the persistent indicator prints the bonus as a percentage instead of a multiplier');
  assert.doesNotMatch(COMPONENT_SRC, /DICE IN THE AIR/,
    'the outcome headline stays empty until the actual roll result lands');
  assert.doesNotMatch(COMPONENT_SRC, /RANDOM PROFIT BOOST|ELIGIBLE PROFIT IS BOOSTED|craps-shooter-boost-players/,
    'the old full activation card and player list are gone');
  assert.match(COMPONENT_SRC, /#finishResolution\(skipped = false\)[\s\S]*?this\.#completeResolution\(\);[\s\S]*?#resolutionOutcome\(\)/s,
    'terminal resolution completes directly');
  assert.doesNotMatch(COMPONENT_SRC, /#finishResolution\(skipped = false\)[\s\S]*?this\.#startSurvivalFlip\([\s\S]*?#resolutionOutcome\(\)/s,
    'the terminal resolution path never starts a coin flip');
  assert.match(COMPONENT_SRC, /CRAPS_RACK_SLOTS = 50/);
  assert.match(COMPONENT_SRC, /CRAPS_OPPONENT_MEDAL_COLORS = Object\.freeze\(\['#f4c84f', '#c8d4df', '#c77b45'\]\)/,
    'featured opponents use ranked gold, silver, and bronze identity colors');
  assert.match(COMPONENT_SRC, /bankrollsFlip: Object\.freeze/,
    'battle racks can consume exact opponent bankroll snapshots');
  assert.match(COMPONENT_SRC, /import \{ dgnBadgePath \} from '..\/app\/dgn-traits\.js'/);
  assert.match(COMPONENT_SRC, /CRAPS_DICE_BADGE_COLORS = Object\.freeze\(\[6, 4\]\)/,
    'the table dice use the canonical silver and blue badge rings');
  assert.match(COMPONENT_SRC, /dgnBadgePath\(3, normalizedFace - 1, colorIndex\)/);
  assert.match(COMPONENT_SRC, /1 \+ Math\.floor\(Math\.random\(\) \* 6\)/);
  assert.match(COMPONENT_SRC, /const dicePair = this\.querySelector\('\.craps-dice-bay__dice'\)/);
  assert.match(COMPONENT_SRC, /const lockAt = 7/);
  assert.match(COMPONENT_SRC, /data-bind="craps-die-one"[\s\S]*?data-bind="craps-dice-lock-readout"[\s\S]*?data-bind="craps-die-two"/s,
    'the transient lock result is physically centered between the two dice');
  assert.doesNotMatch(COMPONENT_SRC, /craps-dice-lock-point|craps-dice-bay__lock-point/,
    'the transient lock hit shows only the rolled number');
  assert.match(COMPONENT_SRC, /dice\.forEach\(\(die, dieIndex\) => this\.#paintDiceBadge\(die, targets\[dieIndex\], colors\[dieIndex\]\)\)[\s\S]*?this\.#lockDicePair\(dicePair\)/,
    'both dice land together before one shared pair-lock beat');
  assert.match(COMPONENT_SRC, /this\.#lockDicePair\(dicePair\);\s*this\.#popDiceLockReadout\(frame, \{ comeOut \}\);[\s\S]*?setTimeout/s,
    'the lock number pops on the shared landing beat without delaying settlement');
  assert.match(COMPONENT_SRC, /dicePair\?\.classList\?\.remove\('is-locking'\);\s*this\.#resetDiceLockReadout\(\);/,
    'each spin clears the previous transient number before the badges move');
  assert.doesNotMatch(COMPONENT_SRC, /#lockDiceBadge|const locked = \[false, false\]/,
    'individual dice no longer lock on separate beats');
  assert.doesNotMatch(COMPONENT_SRC, /craps-dice-bay__status/,
    'the enlarged badges own the dice bay without tiny status copy');
  assert.match(COMPONENT_SRC, /data-bind="craps-payout-flight"/);
  assert.match(COMPONENT_SRC, /#animatePayout\(frame, frameIndex, \{ visualOnly = false, comeOut = false \} = \{\}\)/);
  assert.match(COMPONENT_SRC, /#animateFeaturedPayouts\(frame, frameIndex, \{ comeOut = false \} = \{\}\)/);
  assert.doesNotMatch(COMPONENT_SRC, /if \(after <= before\) return \[\]/,
    'a gross winning bet still collects when other losses make the player net-negative');
  assert.match(COMPONENT_SRC, /targetRack\?\.querySelector\?\.\('\.craps-battle-rack__well'\)[\s\S]*?candidate\.dataset\.playerKey === entry\.key/s,
    'featured payout flights connect that player’s actual corner chip to that player’s rack');
  assert.match(COMPONENT_SRC, /#animateSettlementsTogether\(frame, frameIndex, onDone, \{ comeOut = false \} = \{\}\)[\s\S]*?const lossDuration =[\s\S]*?const lostBetDuration =[\s\S]*?const payoutDuration =[\s\S]*?this\.#animatePayout\(frame, frameIndex, \{ visualOnly: delta <= 0n, comeOut \}\)[\s\S]*?const localDuration = Math\.max\(lossDuration, lostBetDuration, payoutDuration\);[\s\S]*?const featuredDuration = this\.#animateFeaturedPayouts\(frame, frameIndex, \{ comeOut \}\);[\s\S]*?Math\.max\(\s*this\.#resolutionDelay\(760\),\s*localDuration,\s*featuredDuration,?\s*\)/s,
    'local and featured-opponent settlements launch in one beat and share the longest duration');
  assert.doesNotMatch(COMPONENT_SRC, /const animateFeatured =|this\.#animatePayout\(frame, nextIndex, animateFeatured\)/,
    'opponent collections no longer wait for the local payout to finish');
  assert.match(COMPONENT_SRC, /#animatePayout\(frame, frameIndex, \{ visualOnly = false, comeOut = false \} = \{\}\)[\s\S]*?chip\.style\.setProperty\('--flight-delay', '0ms'\);[\s\S]*?return this\.#resolutionDelay\(570\);/s,
    'every local payout chip starts without an internal stagger');
  assert.match(COMPONENT_SRC, /#animateFeaturedPayouts\(frame, frameIndex, \{ comeOut = false \} = \{\}\)[\s\S]*?chip\.style\.setProperty\('--flight-delay', '0ms'\);[\s\S]*?return this\.#resolutionDelay\(570\);/s,
    'every featured-opponent payout chip starts on that exact same frame');
  assert.doesNotMatch(COMPONENT_SRC, /--flight-delay', `\$\{(?:flightIndex|playerFlightIndex) \*/,
    'no player or chip-order payout delay remains');
  assert.match(COMPONENT_SRC, /#animateBankrollLoss\(frame, \{ clearBoard = false \} = \{\}\)/);
  assert.match(COMPONENT_SRC, /#queueNextResolutionRoll\(80\)/,
    'the normal post-settlement pause keeps winning rolls near a two-second cadence');
  assert.match(COMPONENT_SRC, /const duration = Math\.max\(\s*this\.#resolutionDelay\(760\),\s*localDuration,\s*featuredDuration,?\s*\)/s,
    'results retain a readable minimum settlement beat even when nobody collects');
  assert.match(COMPONENT_SRC, /#animateSevenOutClear\(frameIndex, onDone\)/);
  assert.match(COMPONENT_SRC, /#animateSevenOutClear\(frameIndex, onDone\)[\s\S]*?index \* 8[\s\S]*?const duration = 240 \+ Math\.max\(0, spots\.length - 1\) \* 8/s,
    'seven-out losing stacks disappear in one quick, tightly staggered beat');
  assert.match(COMPONENT_SRC, /#animateBankrollLoss\(frame, \{ clearBoard = false \} = \{\}\)[\s\S]*?if \(clearBoard\) meter\.classList\?\.add\('is-seven-out'\)/s,
    'the bankroll rack receives a distinct seven-out destruction state');
  assert.match(COMPONENT_SRC, /#clearBankrollLoss\(\)[\s\S]*?remove\('is-crapping-out', 'is-seven-out'\)/s,
    'the transient rack destruction state is always cleaned up');
  assert.match(COMPONENT_SRC, /#boardBetSpots\(\)[\s\S]*?spot\.dataset\.active === 'true' \|\| spot\.dataset\.otherActive === 'true'/s,
    'seven-out also clears crowd-only spots that have no featured corner chip');
  assert.match(COMPONENT_SRC, /const clearBoard = this\.#isSevenOut\(frame\);[\s\S]*?this\.#animateBankrollLoss\(frame, \{ clearBoard \}\)/s,
    'seven-out removes the red tray chips and felt stacks in the shared settlement beat');
  assert.match(COMPONENT_SRC, /if \(this\.#isSevenOut\(frame\)\) inferred\.unshift\('dont-pass'\)/,
    'Don’t Pass is always included among the seven-out winners');
  assert.match(COMPONENT_SRC, /#sevenOutClearSpots\(\)[\s\S]*?spot\.dataset\.bet !== 'dont-pass'/s,
    'the winning Don’t Pass stack is excluded from the seven-out clear');
  assert.match(COMPONENT_SRC, /#holdBoardCleared\(\)[\s\S]*?table\.dataset\.board = 'dont-pass'[\s\S]*?this\.#releaseBoardBetSpots\(\[dontPass\]\)/s,
    'the existing Don’t Pass stack remains live while losing bets stay cleared');
  assert.match(COMPONENT_SRC, /#featuredPayoutBetIds\(player, frame, frameIndex, \{ comeOut = false \} = \{\}\)[\s\S]*?hasExactTimeline[\s\S]*?exactEvent \? normalizedPayoutBetIds\(exactEvent\.payoutBets\) : \[\][\s\S]*?return hasExactTimeline \? requested/s,
    'featured opponents collect every exact winning placement and a null aligned event stays empty');
  assert.match(COMPONENT_SRC, /#payoutBetIds\(frame, frameIndex[\s\S]*?frame\?\.payoutBetsExact \? requested : requested\.slice\(0, 2\)/s,
    'the viewer animation does not truncate an authoritative multi-spot payout');
  assert.doesNotMatch(COMPONENT_SRC, /sources\.slice\(0, 2\)\.forEach/,
    'featured exact payouts are not silently capped at two felt sources');
  assert.match(COMPONENT_SRC, /#animateBoardReload\(frame, frameIndex, onDone, \{/);
  assert.match(COMPONENT_SRC, /const opponentRackByKey = new Map\([\s\S]*?\[data-battle-key\][\s\S]*?opponentRackChips\.at\(-1\)[\s\S]*?is-board-deal is-featured-deal/s,
    'featured opponent redeals visibly travel from that opponent’s top rack to their felt marker');
  assert.match(COMPONENT_SRC, /const afterBoardClear = \(\) => \{[\s\S]*?this\.#animateBoardReload\(frame, nextIndex, continueRun, \{[\s\S]*?phase: 'come-out',[\s\S]*?resetRetirements: true,[\s\S]*?else this\.#animateSevenOutClear\(nextIndex, afterBoardClear\)/s,
    'seven-out clears the felt before restoring the next shooter’s placement');
  assert.match(COMPONENT_SRC, /crapsBoardDealBetIds\(heldSpots\.map\(\(spot\) => spot\.dataset\.bet\), \{ phase \}\)/,
    'shooter change deals only the held spots allowed in that board phase');
  assert.match(COMPONENT_SRC, /#boardInPlayFlip\(phase, \{[\s\S]*?dealingBetIds: spots\.map\(\(spot\) => spot\.dataset\.bet\)/s,
    'the projected rack stake receives only concrete, non-retired deal IDs');
  assert.match(COMPONENT_SRC, /#retiredBetIds = new Set\(\)/,
    'per-shooter retirement is distinct from temporary off-felt placement');
  assert.match(COMPONENT_SRC, /const spots = heldSpots\.filter\(\(spot\) => \([\s\S]*?dealIds\.has\(spot\.dataset\.bet\)[\s\S]*?!this\.#retiredBetIds\.has\(spot\.dataset\.bet\)/s,
    'point establishment cannot redeal a hardway retired earlier in the shooter');
  assert.match(COMPONENT_SRC, /#holdLostBetCollection\(frame\)[\s\S]*?crapsRetiredBetIds\(frame\)[\s\S]*?this\.#retiredBetIds\.add\(id\)/s,
    'settlement accumulates both losing bets and winning one-decision Don’t Pass retirements');
  assert.match(COMPONENT_SRC, /#animateBoardReload\(frame, frameIndex, onDone, \{[\s\S]*?resetRetirements = false[\s\S]*?if \(resetRetirements\) this\.#retiredBetIds\.clear\(\)/s,
    'only an explicit next-shooter reload clears per-shooter retirements');
  assert.match(COMPONENT_SRC, /this\.#animateBoardReload\(frame, nextIndex, animateSettlement, \{ phase: 'point' \}\)/,
    'establishing a point visibly deals every parked number and hardway chip before settlement');
  assert.match(COMPONENT_SRC, /#holdComeOutBoard\(\{ resetLines = true \} = \{\}\)[\s\S]*?crapsComeOutHeldBetIds\([\s\S]*?resetLines/s,
    'the initial and post-seven-out board parks number and hardway chips during come-out');
  assert.match(COMPONENT_SRC, /#startResolution\(\)[\s\S]*?this\.#holdComeOutBoard\(\)[\s\S]*?this\.#paintResolutionTray\(BigInt\(this\.#resolutionRun\.startingBankrollFlip\), \{[\s\S]*?inPlayFlip: this\.#boardInPlayFlip\(\)/s,
    'the opening rack leaves parked number and hardway chips off the felt, not merely hidden');
  assert.match(COMPONENT_SRC, /#animateLostBetCollection\(frame, frameIndex, onDone\)/,
    'a line decision visibly collects the losing felt stack before any replacement deal');
  assert.match(COMPONENT_SRC, /const pointMade =[\s\S]*?if \(pointMade\) \{[\s\S]*?this\.#holdComeOutBoard\(\{ resetLines: false \}\)[\s\S]*?continueRun\(\)/s,
    'a point-made decision parks point bets but preserves exact same-shooter line liveness');
  assert.match(COMPONENT_SRC, /#holdComeOutBoard\(\{ resetLines = true \} = \{\}\)[\s\S]*?else table\.dataset\.comeOut = 'same-shooter'/s,
    'only a made-point come-out marks the parked place and hardway stacks as visibly off');
  assert.match(CSS_SRC, /data-board="come-out"\]\[data-come-out="same-shooter"\][\s\S]*?is-seven-cleared[\s\S]*?visibility:\s*visible;[\s\S]*?opacity:\s*0\.46/s,
    'same-shooter come-out stacks stay on the felt in a muted OFF state');
  assert.match(COMPONENT_SRC, /data-bind="craps-point-status" data-state="off">OFF<\/strong>/,
    'the existing point readout supplies the one uncluttered OFF label');
  assert.doesNotMatch(COMPONENT_SRC, /if \(pointMade\) \{[\s\S]{0,500}?#animateBoardReload/s,
    'point-made never invokes the next-shooter line recommit primitive');
  assert.match(COMPONENT_SRC, /const dontPassWasHeld = dontPass\?\.classList\?\.contains\('is-seven-cleared'\)[\s\S]*?if \(dontPass && !dontPassWasHeld\) this\.#releaseBoardBetSpots\(\[dontPass\]\)/s,
    'seven-out keeps a previously retired Don’t Pass held for the next-shooter deal');
  assert.match(COMPONENT_SRC, /frame\?\.payoutBetsExact[\s\S]*?return explicit;/s,
    'an authoritative empty payout list cannot be replaced by inferred come-out winners');
  assert.match(COMPONENT_SRC, /class="craps-run-rail__bankroll"[\s\S]*?class="craps-run-rail__well"[\s\S]*?class="craps-run-rail__rack"/,
    'the bankroll readout leads the full-width physical chip trough');
  assert.match(COMPONENT_SRC, /if \(amountNode\) amountNode\.textContent = formatCrapsFlip\(bankroll\);/,
    'the player bankroll always renders its exact whole-FLIP amount');
  assert.match(COMPONENT_SRC, /#paintLocalStanding\(rank, standings, roundNumber = 0\)[\s\S]*?crapsRemainingEntrantsAtRound\(\{[\s\S]*?roundNumber,[\s\S]*?#localRankAtRound\(roundNumber, localStanding\?\.rank, standings\)[\s\S]*?#paintLocalStanding\(this\.#leaderboardViewerRank, standings, roundNumber\)/s,
    'the information bar shares the viewer’s checkpointed leaderboard rank');
  assert.match(COMPONENT_SRC, /CRAPS_RACK_SLOTS = 50/);
  assert.doesNotMatch(COMPONENT_SRC, /CRAPS_(?:RUN|BATTLE)_RACK_SLOTS/,
    'YOU and all three battle racks use one shared pip count');
  assert.match(COMPONENT_SRC, /'<i class="df-bankroll__chip craps-run-chip"><\/i>'/,
    'the bankroll rack reuses the Coinflip edge-on chip');
  assert.doesNotMatch(COMPONENT_SRC, /craps-run-barrel|data-barrel/,
    'the rack has no artificial barrel groups');
  assert.match(COMPONENT_SRC, /crapsRackSplit\([\s\S]*?perHandFlip: this\.#wager\(\)\.perHandFlip/s,
    'rack colors come from the actual next-board stake split');
  assert.doesNotMatch(COMPONENT_SRC, /letItRide|LET IT RIDE|craps-ride/,
    'the bankroll game has no compounding mode or stale ride control');
  assert.doesNotMatch(COMPONENT_SRC, /class="craps-run-rail__amount"/,
    'the rack does not spend a column on a redundant bankroll-run label');
  assert.doesNotMatch(COMPONENT_SRC, /class="craps-run-rail__goal"/,
    'the goal moved to the title row instead of consuming rack width');
  assert.match(COMPONENT_SRC, /table\.hidden = false/,
    'the shared felt stays mounted throughout the bankroll replay');
  assert.doesNotMatch(COMPONENT_SRC, /craps-resolution__stage|craps-resolution__dice/,
    'resolution does not replace the table with a second dice screen');
  assert.match(COMPONENT_SRC, /const CRAPS_BATTLE_BET_GROUPS = Object\.freeze\(\[[\s\S]*?id: 'line'[\s\S]*?id: 'dont-line'[\s\S]*?id: 'hard-8'[\s\S]*?\]\);[\s\S]*?CRAPS_BATTLE_BET_GROUPS\.map\(groupMarkup\)/s,
    'the live battle groups render both lines and omit the unused odds control');
  assert.match(COMPONENT_SRC, /if \(bet\.kind !== 'stake'\) return '';/);
  assert.doesNotMatch(COMPONENT_SRC, /data-odds=|craps-odds-max|craps-odds-action|craps-perk-odds/,
    'the table offers no hidden or visible odds controls');
  assert.match(COMPONENT_SRC, /const method = this\.#entryKind === 'board'[\s\S]*?'setBoard'[\s\S]*?'enterBonusDay'[\s\S]*?'enterBonusBattle'[\s\S]*?'enterBattle'/s,
    'the table preserves board-only, whole-day, scheduled-window, and custom-battle modes');
  assert.match(COMPONENT_SRC, /const contractArgs = this\.#entryKind === 'board'[\s\S]*?\[contractChips\][\s\S]*?\[contractChips, this\.#entryMultiple\][\s\S]*?\[this\.#entryPeriod, contractChips, this\.#entryMultiple\][\s\S]*?this\.#battleSlot/s,
    'board setup and scheduled entries return the packed chip word with the correct call shape');
  assert.match(COMPONENT_SRC, /data-bind="craps-entry-label" hidden/,
    'scheduled entry dialogs should identify the selected day or battle');
  assert.match(COMPONENT_SRC, /'SAVE BOARD'[\s\S]*?'ENTER FULL DAY'[\s\S]*?`ENTER BATTLE \$\{\(this\.#entryPeriod \?\? 0\) \+ 1\}`/s,
    'board and scheduled entry submit copy should identify the selected mode');
  assert.match(COMPONENT_SRC, /const scheduledTerms = this\.#entryKind !== 'custom'/);
  assert.match(COMPONENT_SRC, /bankroll\.readOnly = scheduledTerms[\s\S]*?goal\.readOnly = scheduledTerms/s,
    'scheduled bankroll and goal are protocol terms, not editable transaction inputs');
  assert.match(COMPONENT_SRC, /const buyIn = this\.#entryKind === 'board'[\s\S]*?\? 0n[\s\S]*?\(this\.#bankroll \+ this\.#battleStake\) \* BigInt\(this\.#entryMultiple\)/s,
    'board setup is free while entry buy-ins scale both bankroll and bounty with the lane multiple');
  // The packed order is the CONTRACT's, not the struct's: don't-pass is last in the word even
  // though `contractChipCountsFrom` lists it second. Swapping those two silently moves every bet
  // to the other side of the table, so the order is asserted here rather than trusted.
  assert.match(COMPONENT_SRC, /PACKED_LEG_ORDER = Object\.freeze\(\[\s*'passLine', 'place4', 'place5', 'place6', 'place8',\s*'place9', 'place10', 'hard4', 'hard8', 'dontPassLine',\s*\]\)/s,
    'the packed chip word follows the contract leg order with dontPass last');
  assert.doesNotMatch(COMPONENT_SRC, /craps-roll-copy/);
  assert.doesNotMatch(COMPONENT_SRC, /data-bind="craps-roll-number"|data-bind="craps-resolution-players"/,
    'the oversized roll counter and floating player pills are removed from the result board');
  assert.match(COMPONENT_SRC, /<small>OUTCOME<\/small>[\s\S]*?<small>PLACE<\/small>[\s\S]*?<small>REMAINING<\/small>[\s\S]*?<small>ENTRANTS<\/small>[\s\S]*?<small>LAST RESULT<\/small>[\s\S]*?<small>POINT<\/small>[\s\S]*?<small>LAST ROLL<\/small>/,
    'the outcome shares its information row with place, remaining, and entrants');
  assert.match(COMPONENT_SRC, /data-bind="craps-point-status" data-state="off">OFF<\/strong>/,
    'the center point display stays present and reads OFF between points');
  assert.doesNotMatch(COMPONENT_SRC, /ROLL TOTAL|data-bind="craps-point-off"/);
  assert.match(COMPONENT_SRC, /event: frame\.label,\s*result: formatSignedCrapsFlip\(delta\)/,
    'the fixed point cell removes duplicated point copy and Last Result carries only the compact number');
  assert.doesNotMatch(COMPONENT_SRC, /formatCrapsCompactFlip\(finalTray\)\} FLIP PAID/,
    'the final Last Result value does not waste width repeating the FLIP unit');
  assert.doesNotMatch(COMPONENT_SRC, /RUN TOTAL|SHOOTER TOTAL|craps-run-result|craps-roll-board__run/,
    'the rack is the only running-bankroll display');
  assert.doesNotMatch(COMPONENT_SRC, /class="craps-dice-bay__total"/,
    'the dice bay adds only a transient lock hit; Last Roll remains the permanent result cell');
  assert.doesNotMatch(COMPONENT_SRC, /craps-resolution-result-kicker|craps-resolution-combined/,
    'the bottom rail does not repeat the fixed result board');
  assert.doesNotMatch(COMPONENT_SRC, /data-mode="fixed"/);
  assert.doesNotMatch(COMPONENT_SRC, /craps-shooters/);
  assert.doesNotMatch(COMPONENT_SRC, /data-bind="craps-table-state"|data-bind="craps-survival"/,
    'the redundant header table-state and survival badge are gone');
  assert.match(COMPONENT_SRC, /DEGEN SCORE/);
  assert.doesNotMatch(COMPONENT_SRC, /RAKEBACK/);
  assert.doesNotMatch(COMPONENT_SRC, /EXPECTED COMP/);
  assert.match(COMPONENT_SRC, /data-bind="craps-total"/);
  assert.match(COMPONENT_SRC, /data-bind="craps-player-strip"/);
  assert.match(COMPONENT_SRC, /data-bind="craps-chip-corners"/,
    'each spot reserves the featured-player placement bands');
  assert.doesNotMatch(COMPONENT_SRC, /data-bind="craps-other-wager"|craps-bet__crowd-stack|crowdChipStacks/,
    'untracked players do not produce anonymous stacks on the felt');
  assert.match(COMPONENT_SRC, /#feltOpponentKeys = this\.#feltOpponentKeys[\s\S]*?slice\(-CRAPS_MAX_FELT_OPPONENTS\)[\s\S]*?this\.#featuredPlayerKeys = \[local\?\.key, \.\.\.this\.#feltOpponentKeys\][\s\S]*?const opponentSeats = new Map[\s\S]*?`top-\$\{index \+ 1\}`/s,
    'the felt contains YOU plus no more than the two opponents explicitly selected');
  assert.doesNotMatch(COMPONENT_SRC, /const leadingRival = standings\.find/,
    'rank changes never volunteer an opponent onto the felt');
  assert.match(COMPONENT_SRC, /data-felt-player-key="\$\{escapeHtml\(entry\.key\)\}"[\s\S]*?aria-pressed="\$\{String\(onFelt\)\}"/s,
    'every opponent row exposes an accessible show/hide chips control');
  assert.match(COMPONENT_SRC, /#toggleFeltOpponent\(playerKey\)[\s\S]*?toggleCrapsFeltOpponent\(this\.#feltOpponentKeys, key\)[\s\S]*?this\.#paintOpponentRacks\(roundNumber\)/s,
    'a row click immediately repaints the selected felt stacks');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\[data-seat="top-1"\][^}]*left:\s*0;[^}]*width:\s*50%[\s\S]*?\.craps-bet__seat-chip\[data-seat="top-2"\][^}]*right:\s*0;[^}]*width:\s*50%/s,
    'two selected opponents split the upper felt without covering each other');
  assert.match(COMPONENT_SRC, /const face = shooterBoost \? 'gold' : 'red';[\s\S]*?crapsEscalatedChipPresentation\(baseCount, shooterOrdinal, face\)[\s\S]*?data-seat="\$\{seat\}"[\s\S]*?data-face="\$\{face\}"[\s\S]*?data-wager-multiplier="\$\{wagerMultiplier\}"/s,
    'all eligible stacks use the canonical upright gold face without changing their physical escalator');
  assert.match(COMPONENT_SRC, /#shooterOrdinalAtRound[\s\S]*?this\.#isSevenOut[\s\S]*?#wagerMultiplierAtRound/s,
    'wager growth follows completed seven-outs rather than individual dice rolls');
  assert.match(COMPONENT_SRC, /#paintOpponentRacks\(roundNumber[\s\S]*?#syncWagerMultiplier\(roundNumber\)[\s\S]*?#paintRemainingOtherWagers\(roundNumber\)/s,
    'felt stacks adopt the new multiple as the next shooter is dealt');
  assert.match(COMPONENT_SRC, /chip\.className = 'is-featured-payout';\s*chip\.src = CRAPS_CHIP_ART\[source\?\.dataset\?\.face\] \?\? CRAPS_CHIP_ART\.red;/,
    'featured payout flights retain the source player’s normal or metallic boost face');
  assert.doesNotMatch(COMPONENT_SRC, /const label = `#\$\{entry\.rank\} \$\{entry\.initials\}`|<small>\$\{escapeHtml\(label\)\}<\/small>/,
    'felt stacks use no redundant player labels');
  assert.match(COMPONENT_SRC, /function playerChipArt[\s\S]*?stack-\$\{level\}-high-\$\{face\}\.svg/s,
    'one through seven chips on a player spot render as their true physical stack height');
  assert.match(COMPONENT_SRC, /const count = normalizeCrapsChipsPerBet\(raw\);[\s\S]*?result\.set\(bet\.id, BigInt\(count\)\)/s,
    'initial and remote placements retain their contract-bounded per-spot counts instead of collapsing them to one');
  assert.match(COMPONENT_SRC, /#placeChip\(id\)[\s\S]*?this\.#bets\.set\(id, previous \+ 1n\)[\s\S]*?#removeChip\(id\)[\s\S]*?previous - 1n/s,
    'placement clicks add to a stack and direct stack clicks remove one chip');
  assert.match(COMPONENT_SRC, /red: '\/shared\/flip-chips\/coin-high-red\.svg'[\s\S]*?green: '\/shared\/flip-chips\/coin-high-green\.svg'[\s\S]*?gold: '\/shared\/flip-chips\/coin-high-gold\.svg'[\s\S]*?silver: '\/shared\/flip-chips\/coin-high-silver\.svg'/s,
    'the component uses canonical high-angle FLIP vectors plus the temporary metallic boost skin');
  assert.doesNotMatch(COMPONENT_SRC, /craps-bet__chip-3d|\/shared\/flip-chips\/face\.svg/,
    'placements never rebuild or distort a flat chip face in CSS');
  assert.doesNotMatch(COMPONENT_SRC, /<small>OTHERS<\/small>|<output>×\$\{count\}<\/output>/);
  assert.doesNotMatch(COMPONENT_SRC, /<output>\$\{escapeHtml\(formatCrapsCompactFlip\(entry\.amount\)\)\}<\/output>/,
    'leaderboard bankrolls are communicated by the larger physical racks without duplicate amounts');
  assert.match(COMPONENT_SRC, /#remainingOtherBet\(id, roundNumber = 0\)[\s\S]*?roundNumber >= player\.exitRoll[\s\S]*?players\.reduce\(\(total, player\) => total \+ player\.amount, 0n\)/,
    'the other wager is one live aggregate that drops players after they leave the run');
  assert.match(COMPONENT_SRC, /const layoutLocalRank = localRank \?\? CRAPS_LEADERBOARD_ROWS \+ 1;[\s\S]*?crapsLeaderboardRows\(standings, \{ localRank: layoutLocalRank \}\)[\s\S]*?this\.#leaderboardPlayerKeys = selected\.map[\s\S]*?rows\.innerHTML = visibleStandings\.map/s,
    'the separate leaderboard renders YOU plus nine opponents in its checkpointed order');
  assert.match(COMPONENT_SRC, /#paintResolutionFrame\(frame, index[\s\S]*?const standingsCheckpoint = crapsLeaderboardCheckpoint\(frame\)[\s\S]*?this\.#paintBattleLeaderboard\(index \+ 1\);[\s\S]*?standingsCheckpoint \|\| nextShooter/s,
    'rolls repaint chip amounts while made points and completed shooters advance the row order');
  assert.match(COMPONENT_SRC, /if \(this\.#viewerBustRank != null\) return this\.#viewerBustRank;[\s\S]*?local\?\.state === 'bust'[\s\S]*?this\.#viewerBustRank = rank/s,
    'YOU freezes at the exact checkpoint rank captured on bust');
  assert.match(COMPONENT_SRC, /displayRank: entry\.local \? this\.#leaderboardViewerRank : rank[\s\S]*?const rankLabel = entry\.displayRank == null \? '—' : String\(entry\.displayRank\)/s,
    'a partial bundle shows an unknown viewer rank honestly until the indexer supplies it');
  assert.match(COMPONENT_SRC, /const playerColor = local[\s\S]*?CRAPS_OPPONENT_MEDAL_COLORS\[Math\.max\(0, entry\.rank - 1\)\][\s\S]*?style="--player-color:\$\{escapeHtml\(playerColor\)\}"/s,
    'felt shadows follow the current rival’s actual rank color');
  assert.match(COMPONENT_SRC, /visibleStandings\.map\(\(entry\)[\s\S]*?CRAPS_OPPONENT_MEDAL_COLORS\[Math\.max\(0, entry\.rank - 1\)\][\s\S]*?style="--player-color:\$\{escapeHtml\(playerColor\)\}"/s,
    'leaderboard stripes preserve the gold, silver, and bronze rank mapping');
  assert.match(COMPONENT_SRC, /\$\{battleMarkup\(\)\}\s*<div class="craps-table-felt">/s,
    'the leaderboard remains structurally outside the betting felt');
  assert.match(COMPONENT_SRC, /const previousPositions = new Map[\s\S]*?--craps-rank-shift-x[\s\S]*?--craps-rank-shift-y[\s\S]*?is-rank-shifting/s,
    'rank changes animate from each row’s previous position instead of jumping');
  assert.match(COMPONENT_SRC, /setOtherBets\(input = \[\]\)/);
  assert.match(COMPONENT_SRC, /const requestedScreen = String\(detail\.screen \?\? detail\.view \?\? ''\)[\s\S]*?\['battle', 'live', 'spectate'\]\.includes\(requestedScreen\)/s,
    'callers explicitly choose placement or battle presentation');
  assert.match(COMPONENT_SRC, /const showBattleRack = !visible && this\.#screen === 'battle'[\s\S]*?this\.#paintResolutionTray\(this\.#bankroll/s,
    'the battle presentation keeps the live bankroll rack visible without the setup footer');
  assert.match(COMPONENT_SRC, /discordPfp/);
  assert.match(COMPONENT_SRC, /CRAPS_MIN_LEG_FLIP = 60n/);
  assert.match(COMPONENT_SRC, /<small>BUY-IN<\/small>/);
  assert.match(COMPONENT_SRC, /CRAPS_TABLE_SETTLE_EVENT/);
  assert.match(COMPONENT_SRC, /CRAPS_TABLE_REPLAY_EVENT/);
  assert.match(COMPONENT_SRC, /onResolutionAcknowledged/);
  assert.match(COMPONENT_SRC, /#acknowledgeResolution\(\)/);
  assert.match(COMPONENT_SRC, /dataset\?\.phase === 'complete'/,
    'closing only acknowledges a replay after final rewards have been painted');
  assert.match(COMPONENT_SRC, /event\?\.key === 'Escape'/);
  assert.match(COMPONENT_SRC, /event\?\.key === 'Tab'/);
  const spinResolutionDiceSrc = COMPONENT_SRC.slice(
    COMPONENT_SRC.indexOf('  #spinResolutionDice('),
    COMPONENT_SRC.indexOf('  #paintResolutionResult('),
  );
  assert.doesNotMatch(spinResolutionDiceSrc, /this\.#setPoint\(null\)/,
    'an established point stays locked beside its number while the next roll is spinning');
  assert.doesNotMatch(COMPONENT_SRC, /<small>(?:ROLL|WHAT HAPPENED|COMBINED RESULT)<\/small>/,
    'the result board uses the event values directly instead of dashboard labels');
  assert.doesNotMatch(COMPONENT_SRC, /<small>EDGE<\/small>/);
});

test('layout aligns the two lines and hardways beneath six numbers with a compact status row', () => {
  assert.match(CSS_SRC, /grid-template-columns:\s*repeat\(12,[\s\S]*?grid-template-rows:\s*auto 5\.25rem 7\.35rem/s);
  assert.match(CSS_SRC, /"place place place place place place place place place place place place"\s*"hard4 hard4 line line line line hard8 hard8 dont dont dont dont"\s*"result result result result result result roll roll roll roll roll roll"/s,
    'Hard 4 sits beneath 4, Pass spans 5/6, Hard 8 sits beneath 8, and Don’t Pass spans 9/10');
  assert.match(CSS_SRC, /@media \(max-width: 700px\)[\s\S]*?"hard4 line line hard8 dont dont"[\s\S]*?"roll roll roll roll roll roll"[\s\S]*?"result result result result result result"/s,
    'narrow widths preserve the four-bet rail before stacking dice and results below it');
  assert.match(CSS_SRC, /\.craps-group--place \.craps-group__bets\s*\{\s*grid-template-columns:\s*repeat\(6,/s);
  assert.match(COMPONENT_SRC, /class="craps-bet__name">\$\{pointPuck\}\$\{bet\.id === 'dont-pass'[\s\S]*?: ''\}\$\{escapeHtml\(bet\.shortLabel\)\}<\/span>/,
    'the point puck is inside the number label immediately before the numeral');
  assert.match(CSS_SRC, /\.craps-bet--number \.craps-bet__name\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?gap:/s,
    'the point puck and number share one vertically centered inline row');
  const pointPuckRule = CSS_SRC.match(/\.craps-point-puck\s*\{[^}]*\}/s)?.[0] ?? '';
  assert.match(pointPuckRule, /position:\s*relative;/);
  assert.doesNotMatch(pointPuckRule, /\b(?:top|right):/,
    'the puck is never independently anchored above the number');
  assert.match(CSS_SRC, /\.craps-group--hard-4\s*\{\s*grid-area:\s*hard4;/s);
  assert.match(CSS_SRC, /\.craps-group--hard-8\s*\{\s*grid-area:\s*hard8;/s);
  assert.match(CSS_SRC, /\.craps-group--dont-line\s*\{[\s\S]*?grid-area:\s*dont;/s);
  assert.match(CSS_SRC, /\.craps-group\s*\{[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/s,
    'group wrappers expose bare felt instead of drawing a second outside border');
  assert.match(CSS_SRC, /\.craps-group--place \.craps-bet\s*\{[\s\S]*?min-height:\s*9\.2rem/s);
  assert.match(CSS_SRC, /\.craps-group--line \[data-bet="pass"\],[\s\S]*?\.craps-group--dont-line \[data-bet="dont-pass"\]\s*\{[\s\S]*?min-height:\s*4\.4rem/s,
    'both line bets remain thinner rails while leaving room for visible corner chips');
  assert.doesNotMatch(CSS_SRC, /\.craps-group--odds|\.craps-odds-max/);
  assert.match(CSS_SRC, /\.craps-dice-bay\s*\{/);
  assert.match(CSS_SRC, /\.craps-dice-bay__dice\.is-locking\s*\{[\s\S]*?craps-dice-pair-lock/);
  assert.doesNotMatch(CSS_SRC, /craps-dice-bay__lock-point/,
    'the lock animation has no point badge beside the result');
  assert.match(CSS_SRC, /\.craps-dice-bay__lock-number\s*\{[\s\S]*?left:\s*50%[\s\S]*?font-size:\s*clamp\(1\.55rem, 3\.25vw, 2\.35rem\)/s,
    'the roll total is large and centered between the dice');
  assert.match(CSS_SRC, /\.craps-dice-bay__lock-readout\.is-popping \.craps-dice-bay__lock-number\s*\{[\s\S]*?craps-dice-number-pop var\(--craps-speed-680, 680ms\)/s);
  assert.match(COMPONENT_SRC, /#popDiceLockReadout\(frame, \{ comeOut \}\)/,
    'the transient total receives the actual pre-roll table phase');
  assert.match(CSS_SRC, /\.craps-dice-bay__lock-readout\[data-seven-outcome="win"\][\s\S]*?#6ef08c/s,
    'a winning come-out seven pops green');
  assert.match(CSS_SRC, /\.craps-dice-bay__lock-readout\[data-seven-outcome="crap-out"\][\s\S]*?#ff626b/s,
    'a seven-out pops red');
  assert.match(CSS_SRC, /@keyframes craps-dice-number-pop/);
  assert.doesNotMatch(CSS_SRC, /craps-dice-flash|craps-dice-badge-lock|img\.is-locking/,
    'the resolved state does not add a third dice beat');
  assert.match(CSS_SRC, /\.craps-dice-bay\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?height:\s*100%/s,
    'the dice bay is constrained to the same compact row as the current battle');
  assert.match(CSS_SRC, /\.craps-dice-bay__dice\s*\{[\s\S]*?width:\s*min\(100%, 20rem\)[\s\S]*?height:\s*100%/s,
    'the dice pair uses the full vertical space of its reclaimed bay');
  assert.match(CSS_SRC, /\.craps-dice-bay__dice img\s*\{[\s\S]*?width:\s*auto;[\s\S]*?height:\s*132%;[\s\S]*?max-width:\s*56%/s,
    'the visible dice compensate for transparent badge padding and fill most of the bay height');
  assert.doesNotMatch(CSS_SRC, /\.craps-table-felt__stamp\s*\{/);
  assert.doesNotMatch(CSS_SRC, /\.craps-table-felt::before\s*\{/,
    'the felt has no inset rounded outline cutting across the outside number corners');
  assert.match(CSS_SRC, /\.craps-table-felt\s*\{[^}]*overflow:\s*visible;/s,
    'the felt does not clip the outside 4 and 10 betting-area corners');
  assert.match(CSS_SRC, /\.craps-roll-board\s*\{/);
  assert.match(CSS_SRC, /grid-template-areas:\s*"event event event event event event place place remaining remaining entrants entrants"\s*"outcome outcome outcome outcome point point point point total total total total"/s,
    'outcome shares the top information row while the three roll-result cells stay equal below');
  assert.match(CSS_SRC, /\.craps-roll-board :is\(\.craps-roll-board__event, \.craps-roll-board__place, \.craps-roll-board__remaining, \.craps-roll-board__entrants\)[\s\S]*?border-bottom:/s);
  assert.match(CSS_SRC, /\.craps-roll-board :is\(\.craps-roll-board__point, \.craps-roll-board__total\)/,
    'the three lower cells keep permanent visual boundaries');
  assert.match(CSS_SRC, /\.craps-roll-board__event strong\s*\{[\s\S]*?font-size:\s*clamp\(1\.02rem, 2\.05vw, 1\.38rem\)/s,
    'the outcome uses the available panel space instead of tiny dashboard type');
  assert.match(CSS_SRC, /\.craps-roll-board__point strong\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?border:\s*0;[\s\S]*?background:\s*none;/s,
    'the fixed center point display stays unclipped without drawing a second puck');
  assert.match(CSS_SRC, /\.craps-roll-board__point strong\[data-state="on"\]\s*\{[\s\S]*?color:\s*#8fd0ff/s,
    'the active point remains visually distinct as plain table information');
  assert.doesNotMatch(CSS_SRC, /\.craps-roll-board::before/,
    'the result board has no decorative outline rail competing with its fixed cells');
  assert.doesNotMatch(CSS_SRC, /craps-roll-player|craps-player-bust|craps-player-cashout/,
    'other-player results no longer move around inside the table result board');
  assert.match(CSS_SRC, /\.craps-dialog__card\[data-screen="battle"\] \.craps-table-rail\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) clamp\(18rem, 24vw, 22rem\);[\s\S]*?grid-template-areas:\s*"felt leaderboard"/s,
    'wide battle layouts reserve a vertical leaderboard beside the felt');
  assert.match(CSS_SRC, /\.craps-battle-board__rows\s*\{[\s\S]*?grid-auto-flow:\s*row;[\s\S]*?grid-auto-rows:\s*minmax\(2\.1rem, 1fr\);[\s\S]*?overflow-y:\s*auto/s,
    'the desktop top ten forms one aligned vertical stack');
  assert.match(CSS_SRC, /@media \(max-width: 860px\)[\s\S]*?grid-template-areas:\s*"leaderboard"\s*"felt"[\s\S]*?\.craps-battle-board__rows\s*\{[\s\S]*?grid-auto-flow:\s*column;[\s\S]*?overflow-x:\s*auto/s,
    'compact layouts move the leaderboard above the felt as a horizontal strip');
  assert.match(CSS_SRC, /\.craps-battle-rack\s*\{[\s\S]*?grid-template-columns:/s,
    'each opponent row contains place, Discord avatar, name, thermometer, and amount');
  assert.match(CSS_SRC, /\.craps-battle-rack__amount\s*\{[\s\S]*?grid-area:\s*amount;[\s\S]*?justify-items:\s*end;/s,
    'the featured balance hugs the tray’s left edge');
  assert.match(CSS_SRC, /\.craps-battle-rack\s*\{[\s\S]*?grid-template-columns:\s*minmax\(6\.2rem, 0\.78fr\) minmax\(3rem, 0\.22fr\) minmax\(5rem, 1fr\);[\s\S]*?grid-template-areas:\s*"identity amount well"/s,
    'desktop rows align identity, amount, and the same 0.22-to-1 rack proportion');
  assert.match(COMPONENT_SRC, /const avatar = `<b>\$\{escapeHtml\(entry\.initials\)\}<\/b>\$\{entry\.avatar[\s\S]*?<img src="\$\{escapeHtml\(entry\.avatar\)\}" alt="" decoding="async" referrerpolicy="no-referrer">`/s,
    'Discord portraits layer over a durable initials fallback');
  assert.match(COMPONENT_SRC, /querySelectorAll\('\.craps-battle-rack__avatar img'\)[\s\S]*?addEventListener\?\.\('error', \(\) => portrait\.remove\?\.\(\), \{ once: true \}\)/s,
    'a stale Discord avatar falls back without leaving broken image chrome');
  assert.match(CSS_SRC, /\.craps-battle-rack \.df-bankroll__chip\.craps-battle-rack__chip/,
    'leaderboard racks reuse the edge-on main-rack chip treatment');
  assert.match(CSS_SRC, /\.craps-battle-rack \.df-bankroll__chip\.craps-battle-rack__chip\s*\{[\s\S]*?position:\s*relative;[\s\S]*?left:\s*auto;[\s\S]*?bottom:\s*auto;/s,
    'leaderboard chips reset the generic absolute bankroll-chip positioning instead of overlapping');
  assert.match(COMPONENT_SRC, /class="craps-battle-rack__chips craps-run-rail__rack"/,
    'every opponent rack uses the same inner physical trough as YOU');
  assert.match(CSS_SRC, /Every participant gets the exact same 50-pip tray language[\s\S]*?:is\([\s\S]*?craps-battle-rack__chip[\s\S]*?craps-run-chip[\s\S]*?--craps-rack-chip-tone:\s*#e71922/s,
    'local and opponent pips share one base visual rule');
  assert.match(CSS_SRC, /\.craps-roll-board :is\(\.craps-roll-board__place, \.craps-roll-board__remaining, \.craps-roll-board__entrants\) strong\s*\{[\s\S]*?text-transform:\s*uppercase/s,
    'place and field counts remain legible, fixed cells in the information bar');
  assert.match(CSS_SRC, /@keyframes craps-survival-coin-track/);
  assert.match(CSS_SRC, /@keyframes craps-survival-face-track[\s\S]*?coinflip-face-red\.svg[\s\S]*?coinflip-face-eth\.svg/s);
  assert.match(CSS_SRC, /\.craps-shooter-boost\s*\{[\s\S]*?z-index:\s*60;[\s\S]*?color:\s*#ffe58d;[\s\S]*?opacity:\s*0;[\s\S]*?font-size:\s*clamp\(0\.82rem, 1\.6vw, 1\.15rem\)/s,
    'the bonus activation is little gold text, not a full card');
  assert.doesNotMatch(CSS_SRC, /\.craps-shooter-boost\s*\{[^}]*(?:background|border|padding|box-shadow|backdrop-filter)\s*:/s,
    'the floating text has no popup window chrome');
  assert.match(CSS_SRC, /\.craps-shooter-boost\.is-active\s*\{\s*animation:\s*craps-shooter-boost-pop var\(--craps-speed-720, 720ms\) ease-out both;/s);
  assert.match(CSS_SRC, /\.craps-roll-board\[data-shooter-boost="active"\] \.craps-roll-board__result\s*\{[\s\S]*?#f4c84f/s,
    'the lower-left result cell gets the persistent gold bonus treatment');
  assert.match(CSS_SRC, /\.craps-roll-board__boost-multiplier\s*\{[\s\S]*?top:\s*0\.18rem;[\s\S]*?right:\s*0\.44rem;[\s\S]*?background:\s*#f4c84f/s,
    'the active boost percentage sits in the outcome panel upper-right');
  assert.match(CSS_SRC, /@keyframes craps-shooter-boost-pop/);
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-shooter-boosted:not\(\.is-local\) \.craps-bet__seat-art/,
    'boosted opponent stacks receive a dedicated metallic glow');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-shooter-boosted:not\(\.is-local\) \.craps-bet__seat-art\s*\{[\s\S]*?rgba\(255, 221, 126, 0\.72\)/s,
    'the opponent glow reinforces the gold face instead of washing it back to silver');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local\.is-shooter-boosted \.craps-bet__seat-art/,
    'the local boosted stack receives a stronger warm-gold glow');
  assert.match(CSS_SRC, /@keyframes craps-payout-chip-flight/);
  assert.match(CSS_SRC, /@keyframes craps-seven-out-stack-clear/);
  assert.match(CSS_SRC, /\.craps-table-rail\[data-board="clearing"\][\s\S]*?\.craps-bet\.is-seven-clearing \.craps-bet__corner-grid\s*\{[\s\S]*?craps-seven-out-dust-field var\(--craps-speed-240, 240ms\)/s,
    'seven-out overrides the generic lost-bet sweep with an in-place dust field');
  assert.match(CSS_SRC, /\.craps-table-rail\[data-board="clearing"\][\s\S]*?\.craps-bet__seat-chip::before,[\s\S]*?box-shadow:[\s\S]*?craps-seven-out-dust-left/s,
    'felt stacks emit small dust fragments during the crumble');
  assert.match(CSS_SRC, /@keyframes craps-seven-out-chip-crumble[\s\S]*?clip-path:\s*polygon[\s\S]*?scaleY\(0\.08\)/s,
    'the chip art fractures downward instead of flying toward a rack');
  const crumbleStart = CSS_SRC.indexOf('@keyframes craps-seven-out-chip-crumble');
  const crumbleEnd = CSS_SRC.indexOf('@keyframes craps-seven-out-dust-left', crumbleStart);
  assert.ok(crumbleStart >= 0 && crumbleEnd > crumbleStart);
  assert.doesNotMatch(CSS_SRC.slice(crumbleStart, crumbleEnd), /translate/,
    'the crumbling chip itself stays anchored to its betting spot');
  assert.match(CSS_SRC, /@keyframes craps-board-chip-deal/);
  assert.match(CSS_SRC, /@keyframes craps-board-stack-restore/);
  assert.match(CSS_SRC, /animation:\s*craps-payout-chip-flight var\(--craps-speed-520, 520ms\)/,
    'concurrent payout flights remain visible while fitting the two-second roll cadence');
  assert.match(CSS_SRC, /@keyframes craps-bankroll-chip-loss/);
  assert.match(CSS_SRC, /\.craps-run-rail__well\.is-seven-out \.craps-run-chip\.is-lost\s*\{[\s\S]*?craps-bankroll-chip-dust var\(--craps-speed-240, 240ms\)/s,
    'red in-play rack cells crumble quickly on a seven-out while ordinary losses keep their own cue');
  assert.match(CSS_SRC, /\.craps-run-rail__well\s*\{/);
  assert.match(COMPONENT_SRC, /data-bind="craps-battle-bounty-receipt"[\s\S]*?stack-7-high-gold\.svg[\s\S]*?data-bind="craps-battle-bounty-amount"[\s\S]*?<small>BOOST PAID<\/small>[\s\S]*?data-bind="craps-battle-boost-amount"/s,
    'the battle payout and its boost render under the bankroll rack beside a gold chip stack');
  assert.match(COMPONENT_SRC, /#animateBattleBountyReceipt\(\)[\s\S]*?LAST STANDING · BOUNTY WON[\s\S]*?GOAL WIN · BOUNTY WON[\s\S]*?chip\.src = CRAPS_CHIP_ART\.gold/s,
    'both battle win routes animate gold bounty chips into the under-rack receipt');
  assert.match(COMPONENT_SRC, /#completeResolution\(\)[\s\S]*?this\.#animateBattleBountyReceipt\(\)/s,
    'the bounty receipt waits until the resolved battle run is complete');
  assert.match(CSS_SRC, /\.craps-run-rail__tray\s*\{[\s\S]*?grid-template-areas:\s*"bankroll well"\s*"\. bounty"/s,
    'the battle award occupies its own row below the rack instead of becoming bankroll chips');
  assert.match(CSS_SRC, /\.craps-run-rail__bounty-boost\s*\{[\s\S]*?margin-left:\s*auto/s,
    'the paid boost remains a distinct amount within the battle award receipt');
  assert.match(CSS_SRC, /\.craps-run-rail__rack\s*\{[\s\S]*?display:\s*flex[\s\S]*?justify-content:\s*flex-start[\s\S]*?gap:\s*0/s,
    'one continuous chip row fills the trough');
  assert.doesNotMatch(CSS_SRC, /transparent calc\(50% - 2px\)/,
    'the bankroll row has no fake shelf divider');
  // ⛔ THE PROGRESSIVE RACK IS GONE — the main player bankroll rack carries that job now, so the
  // second tray, its purple chips and its won-other dimming were all removed along with the grid
  // row they occupied. Asserted as ABSENT so the dead styles cannot drift back in.
  assert.doesNotMatch(CSS_SRC, /craps-run-rail__jackpot|craps-jackpot-chip|data-jackpot/,
    'no progressive tray, chip or grid-row styling survives');
  assert.doesNotMatch(CSS_SRC, /\.craps-run-barrel\s*\{/);
  assert.match(CSS_SRC, /\.craps-run-rail \.df-bankroll__chip\.craps-run-chip\s*\{[\s\S]*?height:\s*0\.76rem[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0\.07rem/s,
    'craps scales up the Coinflip rack chip while preserving its edge treatment');
  assert.doesNotMatch(CSS_SRC, /\.craps-run-chip:nth-child\([^)]*\)::before/,
    'the trough has no decorative crosshair dividers');
  assert.match(CSS_SRC, /\.craps-run-chip\.is-filled\s*\{/);
  assert.match(CSS_SRC, /\.craps-run-chip\.is-in-play\s*\{[\s\S]*?#ed0e11/s,
    'red tray chips are the amount currently in play');
  assert.match(CSS_SRC, /\.craps-run-chip\.is-banked\s*\{[\s\S]*?#30d100/s,
    'green tray chips are bankroll that is not in play');
  assert.match(COMPONENT_SRC, /export function crapsRackPipLayout\([\s\S]*?Math\.sqrt\(percentage \/ 100\)[\s\S]*?const bankedCount = Math\.max\(0, filledCount - inPlayCount\)[\s\S]*?inPlayStart: bankedCount/s,
    'one curved pip layout owns the shared fill and banked/in-play boundary');
  assert.match(COMPONENT_SRC, /#paintRackPips\(chips, layout,[\s\S]*?const filled = index < filledCount[\s\S]*?is-banked', bankedChip[\s\S]*?is-in-play', filled && index >= bankedCount/s,
    'one state painter assigns the exact same pip classes in every tray');
  assert.match(COMPONENT_SRC, /#paintBattleLeaderboard[\s\S]*?this\.#paintRackPips\(chips,[\s\S]*?#paintResolutionTray[\s\S]*?this\.#paintRackPips\(chips,/s,
    'featured and local trays both call the shared painter');
  assert.match(COMPONENT_SRC, /const bankedBefore = new Set\(rack\.querySelectorAll\('\.craps-run-chip\.is-filled\.is-banked'\)\)/);
  assert.match(COMPONENT_SRC, /allGreenChips\.filter\(\(chip\) => bankedBefore\.has\(chip\)\)/);
  assert.match(COMPONENT_SRC, /const startX = local[\s\S]*?dealRect\.left \+ dealRect\.width/s,
    'chips dealt back to the felt launch from the red cells that just turned green');
  assert.match(COMPONENT_SRC, /const boundaryAt = \(bankroll\) => \{[\s\S]*?layout\.bankedCount[\s\S]*?leftRect\.right \+ rightRect\.left/s,
    'every payout chip targets the moving seam between red bankroll and green action');
  assert.match(COMPONENT_SRC, /const impactBankroll = visualOnly[\s\S]*?startingBankroll \+ \(\(delta \* BigInt\(flightIndex \+ 1\)\) \/ BigInt\(flightCount\)\)/s,
    'each incoming chip carries its proportional part of the verified payout');
  assert.match(COMPONENT_SRC, /const firstPayoutChip =[\s\S]*?firstPayoutChip\?\.addEventListener\?\.\('animationend', paintImpact, \{ once: true \}\)/s,
    'one common impact callback lands local and opponent rack changes together');
  assert.match(COMPONENT_SRC, /const paintImpact = \(\) => \{[\s\S]*?this\.#paintResolutionTray\(endingBankroll,[\s\S]*?this\.#paintBattleLeaderboard\(frameIndex \+ 1, endingBankroll\)/s,
    'the player rack and featured opponent racks update in the same impact callback');
  assert.doesNotMatch(COMPONENT_SRC, /shooterPayoutFloor|heldShooterPayoutFrom|payoutFromFlip|is-new-this-shooter/,
    'settled winnings immediately join the ordinary green reserve instead of shifting to teal');
  assert.doesNotMatch(CSS_SRC, /is-new-this-shooter|#15bdb5|#08736f/,
    'neither the player nor opponent rack defines a teal payout state');
  assert.doesNotMatch(CSS_SRC, /--rack-split-|\.is-last-roll-payout|\.is-payout\s*\{/,
    'no split-color or payout-age rack treatment remains');
  assert.doesNotMatch(COMPONENT_SRC, /lastRollPayoutFrom|lastRollPayoutFloor/,
    'the component no longer tracks a second latest-roll color state');
  assert.match(COMPONENT_SRC, /boardState === 'come-out'[\s\S]*?this\.#bets\.get\('pass'\)[\s\S]*?this\.#bets\.get\('dont-pass'\)[\s\S]*?this\.#playedFlip \/ CRAPS_BOARD_CHIPS/s,
    'the come-out rack converts both line chip counts to the battle slot’s chip value');
  assert.match(COMPONENT_SRC, /const bankedDescription = reserveRisk[\s\S]*?FLIP grey off the felt[\s\S]*?reserve chips are green[\s\S]*?const rackDescription = battleAward[\s\S]*?FLIP Battle prize paid[\s\S]*?: progressiveScale[\s\S]*?High point[\s\S]*?Run It Up jackpot points[\s\S]*?: goalLocked[\s\S]*?FLIP blue; the off-felt reserve guarantees the goal[\s\S]*?FLIP red on the felt\. \$\{bankedDescription\}/s,
    'rack accessibility distinguishes a paid Battle award from progressive, blue, grey, green, and red bankroll states');
  assert.match(CSS_SRC, /\.craps-battle-rack \.craps-battle-rack__chip\.is-in-play\s*\{[\s\S]*?#ed0e11/s,
    'battle players use the same red in-play tray chips');
  assert.match(CSS_SRC, /\.craps-battle-rack \.craps-battle-rack__chip\.is-banked\s*\{[\s\S]*?#30d100/s,
    'battle players use the same green banked tray chips');
  assert.match(COMPONENT_SRC, /crapsRackReserveState\(\{[\s\S]*?bankedFlip: banked,[\s\S]*?nextStakeFlip: nextStake,[\s\S]*?goalFlip: goal/s,
    'local rack reserve colors use the off-table amount, next mandatory board, and goal');
  assert.match(COMPONENT_SRC, /data-reserve-state="\$\{escapeHtml\(entry\.reserveState\)\}"/,
    'each featured opponent exposes the same reserve convention');
  assert.match(COMPONENT_SRC, /is-reserve-risk', bankedChip && reserveRisk[\s\S]*?is-goal-locked', filled && goalLocked/s,
    'grey applies to the endangered reserve while a locked win turns the whole rack blue');
  assert.match(CSS_SRC, /\.craps-run-rail \.craps-run-chip\.is-banked\.is-reserve-risk\s*\{[\s\S]*?#727d85/s,
    'survival-flip and bust reserves are grey');
  assert.match(CSS_SRC, /\.craps-run-rail \.craps-run-chip\.is-filled\.is-goal-locked\s*\{[\s\S]*?#1598f0/s,
    'a guaranteed goal turns every filled rack chip blue');
  assert.match(CSS_SRC, /Grey danger chips and blue locked-win chips supersede ordinary bankroll colors[\s\S]*?\.is-filled\.is-reserve-risk,[\s\S]*?\.is-filled\.is-goal-locked[\s\S]*?var\(--craps-rack-chip-tone\)/s,
    'grey danger and blue locked-win states override the ordinary rack colors');
  assert.match(COMPONENT_SRC, /const inPlay = chips\.filter\(\(chip\) => \([\s\S]*?contains\('is-in-play'\)[\s\S]*?!chip\.classList\?\.contains\('is-goal-locked'\)[\s\S]*?const lost = inPlay\.slice/s,
    'a seven-out clears the felt without making locked blue rack chips disappear');
  assert.match(COMPONENT_SRC, /const affordability = crapsNextShooterAffordability\(\{[\s\S]*?bankrollFlip: bankroll,[\s\S]*?nextStakeFlip: nextStake,[\s\S]*?goalFlip: this\.#goal/s,
    'the survival decision uses remaining bankroll and the escalated next stake');
  assert.match(COMPONENT_SRC, /affordability === 'survival' && typeof survivalResult === 'boolean'[\s\S]*?this\.#startSurvivalFlip\(\{[\s\S]*?bankrollFlip: bankroll,[\s\S]*?nextStakeFlip: nextStake/s,
    'a coin appears only at an actual between-shooter survival threshold');
  assert.match(COMPONENT_SRC, /const inPlay = state === 'risk'[\s\S]*?state === 'live'/,
    'opponent mini-racks split their snapshots into live and banked balances');
  assert.match(COMPONENT_SRC, /const startsNewShooter = nextIndex === 0\s*\|\| this\.#isSevenOut\(previousFrame\)\s*\|\| Boolean\(previousFrame\?\.terminal\)[\s\S]*?this\.#announceShooterBoost\(nextIndex, prepareSpin\)/s,
    'the bonus popout runs once at the shooter boundary');
  assert.match(COMPONENT_SRC, /stage\.classList\?\.add\('is-active'\);[\s\S]*?This is purely informational: the dice begin on the same tick\.[\s\S]*?onDone\?\.\(\)/s,
    'the text animation never delays the dice or autoplay');
  assert.doesNotMatch(COMPONENT_SRC, /shooterBoostAnnouncementActive/,
    'bonus presentation is not a gameplay control gate');
  assert.match(COMPONENT_SRC, /const local = this\.#activeShooterBoostEntries\(roundNumber\)\.find\(\(entry\) => entry\.local\);[\s\S]*?if \(!local\) \{[\s\S]*?onDone\?\.\(\)/s,
    'opponent-only boosts never pause play or show textual announcements');
  assert.match(COMPONENT_SRC, /const bonusDescription = local && shooterBoost/,
    'opponent bonus state is not repeated in chip hover text');
  assert.doesNotMatch(COMPONENT_SRC, /craps-battle-rack\$\{[\s\S]*?is-shooter-boosted/,
    'opponent rack rows do not add a second textual or framed bonus treatment');
  assert.match(CSS_SRC, /\.craps-run-chip\.is-lost\s*\{[\s\S]*?craps-bankroll-chip-loss/s);
  assert.match(CSS_SRC, /\.craps-run-rail__tray\s*\{[\s\S]*?grid-template-columns:\s*minmax\(max-content, 0\.22fr\) minmax\(0, 1fr\)/s,
    'the player amount keeps the rack proportion until exact text needs more room');
  assert.match(CSS_SRC, /\.craps-run-rail__bankroll\s*\{[\s\S]*?place-content:\s*center end;[\s\S]*?justify-items:\s*end;/s,
    'the local amount also hugs the tray’s left edge');
  assert.match(CSS_SRC, /\.craps-dialog__card\s*\{[\s\S]*?width:\s*min\(99vw, 88rem\)/s,
    'the table uses substantially more of a desktop viewport');
  assert.match(CSS_SRC, /\.craps-bet__corner-grid\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0\.24rem;/s);
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\[data-seat="top-1"\] \{ left: 0; width: 50%; \}/,
    'the first selected rival receives the upper-left half of each felt spot');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\[data-seat="top-2"\] \{ right: 0; left: auto; width: 50%; \}/,
    'the optional second rival receives the upper-right half');
  assert.doesNotMatch(CSS_SRC, /data-seat="top-3"/,
    'the felt never creates a third opponent lane');
  assert.match(CSS_SRC, /\.craps-bet__odds\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?z-index:\s*2;[\s\S]*?bottom:\s*0\.28rem;[\s\S]*?font:\s*1000 clamp\(0\.66rem, 1\.25vw, 0\.88rem\)/s,
    'larger payout odds are printed directly into the lower felt band');
  assert.match(CSS_SRC, /\.craps-bet__corner-grid\s*\{[\s\S]*?z-index:\s*10;/s,
    'physical chip placements always cover the felt names and payout printing');
  assert.match(CSS_SRC, /\.craps-bet__wwxrp-mark\s*\{[\s\S]*?width:\s*clamp\(1\.2rem, 2vw, 1\.6rem\)/s);
  assert.match(CSS_SRC, /\.craps-group--line \[data-bet="pass"\] \.craps-bet__name\s*\{[\s\S]*?font-size:\s*clamp\(2\.5rem, 4\.6vw, 3\.55rem\)/s,
    'PASS is the dominant felt lane mark');
  assert.match(CSS_SRC, /\.craps-group--dont-line \[data-bet="dont-pass"\] \.craps-bet__name\s*\{[\s\S]*?font-size:\s*clamp\(1\.35rem, 2\.6vw, 1\.9rem\)/s,
    'Don’t Pass remains clearly readable beside its WWXRP mark');
  assert.doesNotMatch(CSS_SRC, /@media \(min-width: 701px\) and \(max-width: 860px\)[\s\S]*?\[data-bet="pass"\][\s\S]*?font-size:\s*0\.72rem/s,
    'tablet widths never collapse PASS back to tiny text');
  assert.match(CSS_SRC, /\.craps-bet__hardway-legend\s*\{[\s\S]*?z-index:\s*11;[\s\S]*?bottom:\s*0\.3rem;[\s\S]*?left:\s*0\.36rem;/s,
    'hardway identity and payout copy occupy a protected bottom-left legend');
  assert.match(CSS_SRC, /\.craps-group--dont-line \[data-bet="dont-pass"\]\s*\{[\s\S]*?border-color:\s*rgba\(237, 14, 17, 0\.86\)/s,
    'Don’t Pass has the one red printed lane border');
  assert.match(CSS_SRC, /\[data-bet="dont-pass"\] \.craps-bet__name\s*\{[\s\S]*?top:\s*50%;[\s\S]*?left:\s*50%;[\s\S]*?transform:\s*translate\(-50%, -50%\)/s,
    'the complete WWXRP and Don’t Pass lockup is centered as one unit');
  assert.match(CSS_SRC, /@media \(max-width: 600px\)[\s\S]*?:is\(\.craps-group--line, \.craps-group--dont-line\) \.craps-bet \{ padding-inline: 0\.2rem; \}[\s\S]*?\.craps-group--dont-line \[data-bet="dont-pass"\] \.craps-bet__name \{[\s\S]*?font-size:\s*clamp\(0\.98rem, 4\.1vw, 1\.15rem\)/s,
    'mobile retains the complete WWXRP Don’t Pass mark instead of clipping it behind legacy side padding');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\s*\{[\s\S]*?top:\s*0;[\s\S]*?width:\s*30%;[\s\S]*?height:\s*min\(2rem, 44%\)/s,
    'the compact opponent lanes stay separated along the top edge and out of the local band');
  assert.match(CSS_SRC, /\.craps-group--place \.craps-bet__seat-chip:not\(\.is-local\)\s*\{[\s\S]*?height:\s*min\(2\.3rem, 44%\)/s,
    'the number fields cap their top lane before it can overlap the local band');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip:not\(\.is-local\) \.craps-bet__seat-art\s*\{[\s\S]*?align-self:\s*end;[\s\S]*?drop-shadow\(0 0 0\.035rem color-mix\(in srgb, var\(--player-color\) 78%, transparent\)\)[\s\S]*?drop-shadow\(0 0\.055rem 0\.035rem rgba\(0, 0, 0, 0\.76\)\)/s,
    'opponent identity remains as a tight edge tint above one felt-contact shadow');
  assert.doesNotMatch(CSS_SRC, /drop-shadow\((?:1px 0|\-1px 0|0 1px|0 \-1px) 0 var\(--player-color\)\)/,
    'opponent chips no longer use a four-sided sticker outline');
  assert.doesNotMatch(CSS_SRC, /\.craps-bet__seat-chip small\s*\{/,
    'no obsolete label-pill styling remains above opponent bets');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local \.craps-bet__seat-art\s*\{[\s\S]*?drop-shadow\(0 0 0\.075rem color-mix\(in srgb, var\(--player-color\) 72%, transparent\)\)[\s\S]*?drop-shadow\(0 0\.065rem 0\.04rem rgba\(0, 0, 0, 0\.78\)\)/s,
    'the local stack keeps a narrow YOU-color edge without a floating halo');
  assert.match(CSS_SRC, /\.craps-battle-rack\s*\{[\s\S]*?box-shadow:[\s\S]*?inset 0\.16rem 0 var\(--player-color\)/s,
    'each top rack repeats the exact color used by that opponent’s felt shadow');
  assert.match(CSS_SRC, /\.craps-bet__seat-art\s*\{[\s\S]*?width:\s*min\(2rem, 92%\);[\s\S]*?height:\s*auto;[\s\S]*?object-fit:\s*contain/s,
    'opponent chips stay compact while preserving the native intermediate-angle SVG proportions');
  assert.match(CSS_SRC, /\.craps-bet__seat-art-set\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*flex-end;[\s\S]*?overflow:\s*visible;/s,
    'doubled wagers can grow into multiple bottom-aligned dealer stacks');
  assert.match(CSS_SRC, /\.craps-bet__seat-art-set\s*\{[\s\S]*?transform:\s*scale\(var\(--craps-bet-chip-scale, 1\)\);[\s\S]*?transform-origin:\s*bottom center;/s,
    'escalated artwork remains anchored to its felt contact point');
  assert.match(CSS_SRC, /\.craps-bet__seat-art-set\[data-kind="pile"\]\s*\{[\s\S]*?width:\s*160%;[\s\S]*?height:\s*128%;[\s\S]*?max-width:\s*none;[\s\S]*?transform:\s*scale\(1\.35\)/s,
    'pile art receives a wider lane so its individual chips remain readable');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local \.craps-bet__seat-art\.is-pile\s*\{[\s\S]*?width:\s*min\(8rem, 100%\)/s,
    'the viewed player gets the largest readable pile without adding a second felt lane');
  assert.match(COMPONENT_SRC, /data-columns="\$\{presentation\.art\.length\}"[\s\S]*?style="--craps-bet-chip-scale:\$\{presentation\.visualScale\}"/s,
    'each rendered player pile carries its wager-derived visual scale');
  assert.doesNotMatch(CSS_SRC, /craps-bet__chip-3d|--chip-wall|object-fit:\s*fill/,
    'there are no fabricated sidewalls, CSS perspective, or stretched chip faces');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local\s*\{[\s\S]*?right:\s*0;[\s\S]*?width:\s*50%;[\s\S]*?height:\s*49%/s,
    'YOU owns a bounded lower-right corner without colliding with the top lanes');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local \.craps-bet__seat-art\s*\{[\s\S]*?width:\s*min\(4\.3rem, 98%\)/s,
    'the featured local chip stays prominent without swallowing its betting spot');
  assert.match(CSS_SRC, /\.craps-bet__seat-art-set:is\(\[data-columns="2"\], \[data-columns="3"\]\)\s*\{[\s\S]*?justify-content:\s*space-between/s,
    'multi-stack wagers distribute every stack into separate horizontal space');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local \.craps-bet__seat-art-set\[data-columns="2"\] \.craps-bet__seat-art\s*\{[\s\S]*?width:\s*48%[\s\S]*?data-columns="2"[\s\S]*?margin-left:\s*0/s,
    'two local stacks fit beside each other without overlap');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local \.craps-bet__seat-art-set\[data-columns="3"\] \.craps-bet__seat-art\s*\{[\s\S]*?width:\s*32%[\s\S]*?data-columns="3"[\s\S]*?margin-left:\s*0/s,
    'three local stacks fit beside each other without overlap');
  assert.doesNotMatch(CSS_SRC, /\.craps-bet__seat-art[^\{]*\{[^}]*margin-left:\s*-/s,
    'no player chip layout uses negative margins to overlap adjacent stacks');
  assert.match(CSS_SRC, /:is\(\.craps-group--hard-4, \.craps-group--hard-8\) \.craps-bet__seat-chip\.is-local \.craps-bet__seat-art\s*\{[\s\S]*?width:\s*min\(3\.3rem, 98%\)/s,
    'local hardway stacks are reduced to fit their narrow outside bays');
  assert.doesNotMatch(CSS_SRC, /craps-bet__field-total|craps-bet__crowd-stack/,
    'the removed anonymous aggregate has no leftover layout layer');
  assert.match(CSS_SRC, /\.craps-payout-flight img\.is-featured-payout\s*\{[\s\S]*?width:\s*clamp\(1\.02rem, 1\.55vw, 1\.35rem\)/s,
    'featured-player payouts stay visible but smaller than the local payout');
  assert.match(CSS_SRC, /\.craps-player-strip\s*\{/);
  assert.match(CSS_SRC, /\.craps-dialog__card\[data-screen="placement"\] :is\([\s\S]*?\.craps-battle-board,[\s\S]*?\.craps-roll-board,[\s\S]*?\.craps-dice-bay,[\s\S]*?\.craps-bet__seat-chip:not\(\.is-local\)[\s\S]*?display:\s*none !important/s,
    'placement is an isolated board without battle standings, dice, outcomes, or opponent chips');
  assert.match(CSS_SRC, /\.craps-dialog__card\[data-screen="battle"\] \.craps-controls\s*\{\s*display:\s*none !important;/,
    'battle removes the complete setup footer');
  assert.match(CSS_SRC, /@media \(max-width: 600px\)/);
  assert.match(CSS_SRC, /@media \(max-width: 760px\)[\s\S]*?\.craps-run-rail/s,
    'the resolution rail changes rows before its controls can crush the rack');
});

test('standalone demo and main app both mount the same component', () => {
  assert.match(DEMO_SRC, /<app-craps-table><\/app-craps-table>/);
  assert.match(DEMO_SCRIPT_SRC, /playedFlip:\s*params\.get\('played'\) \|\| 600/);
  assert.match(DEMO_SCRIPT_SRC, /battleStakeFlip:\s*params\.get\('battleStake'\) \|\| 300/);
  assert.match(DEMO_SCRIPT_SRC, /bountyPoolFlip:\s*params\.get\('bountyPool'\) \|\| 84_900/,
    'the demo keeps the whole pool distinct from one entrant’s battle stake');
  assert.match(DEMO_SCRIPT_SRC, /addedFlip:\s*params\.get\('added'\) \|\| 75_000/,
    'the demo exposes the added-FLIP compartment with an overridable value');
  assert.match(DEMO_SCRIPT_SRC, /completedShooters:\s*params\.get\('shooters'\) \|\| 0/,
    'the demo can open immediately before or after an escalator boundary');
  assert.match(DEMO_SCRIPT_SRC, /initialBets:\s*filled[\s\S]*?dontPassDemo[\s\S]*?'dont-pass': 2[\s\S]*?: \{ pass: 2, 'place-6': 2, 'place-8': 2, 'hard-8': 1 \}[\s\S]*?: \{\}/s,
    'the default demo visibly proves that multiple generic chips may share one spot');
  assert.match(DEMO_SCRIPT_SRC, /const dontPassDemo = params\.has\('dontPass'\)/,
    'the demo can put the viewer directly on Don’t Pass for seven-out payout review');
  assert.doesNotMatch(DEMO_SCRIPT_SRC, /passOddsMult|maxOdds|selectedChip\s*:/);
  assert.match(DEMO_SCRIPT_SRC, /otherPlayers:/);
  assert.match(DEMO_SCRIPT_SRC, /chips:\s*\{\s*passLine:\s*1,\s*dontPassLine:\s*1,[\s\S]*?place10:\s*1\s*\}/s);
  assert.match(DEMO_SCRIPT_SRC, /function demoCrowdPlayers\([\s\S]*?\.\.\.demoCrowdPlayers\(\)/s,
    'the demo includes enough field players to exercise balanced multi-stack aggregates');
  assert.match(DEMO_SCRIPT_SRC, /bankrollsFlip:\s*\[4320, 3660,[\s\S]*?bankrollsFlip:\s*\[4080, 3420,/s,
    'the demo crosses opponent ranks before the first shooter change so top-row reseating is visible');
  assert.match(DEMO_SCRIPT_SRC, /resolution:\s*\{\s*type:\s*'bust'/);
  assert.match(DEMO_SCRIPT_SRC, /resolution:\s*\{\s*type:\s*'cashout'/);
  assert.match(DEMO_SCRIPT_SRC, /const survivalRun = params\.get\('run'\) === 'survival'/);
  assert.match(DEMO_SCRIPT_SRC, /const bonusRun = params\.get\('run'\) === 'bonus'/);
  assert.match(DEMO_SCRIPT_SRC, /\[0, 5\]\.includes\(index\)[\s\S]*?shooterBoost:\s*\{ active: true, percent: 20 \}/s,
    'the dedicated bonus route activates the local player at two shooter boundaries');
  assert.match(DEMO_SCRIPT_SRC, /shooterBoosts:\s*\[\{ active: true, percent: 30 \}, null, \{ active: true, percent: 30 \}\]/,
    'the demo also exercises a player-specific opponent eligibility schedule');
  assert.match(DEMO_SCRIPT_SRC, /bankrollFlip:\s*420[\s\S]*?survival:\s*\{\s*survived:\s*true\s*\}[\s\S]*?bankrollFlip:\s*360[\s\S]*?survival:\s*\{\s*survived:\s*false\s*\}/s,
    'the demo exercises both outcomes only in the actual survival bankroll band');
  assert.match(DEMO_SCRIPT_SRC, /jackpot:\s*\{[\s\S]*?scoreBps:\s*params\.get\('jackpotScoreBps'\)[\s\S]*?thresholdScoreBps:\s*params\.get\('jackpotThresholdScoreBps'\)[\s\S]*?amountFlip:\s*params\.get\('jackpotAmount'\)[\s\S]*?status:\s*jackpotWinner === 'other' \? 'won-other'/s,
    'the demo exposes score, jackpot-value, and winner-state inputs for the progressive tray');
  assert.doesNotMatch(DEMO_SCRIPT_SRC, /Ending round survived|Ending round busted|paid:\s*survived\s*\?/,
    'the demo has no global end-of-run flip');
  assert.match(DEMO_SCRIPT_SRC, /Run returns/);
  assert.match(DEMO_SCRIPT_SRC, /Run busted · returns 0/);
  assert.match(DEMO_SRC, /at least half, but less than all/);
  assert.match(DEMO_SCRIPT_SRC, /label:\s*'SEVEN OUT'\s*,\s*dice:\s*\[(?:4, 3|6, 1)\]/,
    'the replay fixture keeps the dice and event copy truthful');
  assert.match(DEMO_SCRIPT_SRC, /autoRoll:\s*params\.get\('manual'\) !== 'true'/);
  assert.match(DEMO_SCRIPT_SRC, /discordPfp:/);
  assert.match(DEMO_SCRIPT_SRC, /BONUS FLIP CREDITED/);
  assert.match(DEMO_SCRIPT_SRC, /wager\.method[\s\S]*?generic chips/s);
  assert.match(DEMO_SCRIPT_SRC, /resolutionHands:/);
  assert.match(DEMO_SCRIPT_SRC, /showResolution:/);
  assert.match(DEMO_SCRIPT_SRC, /tableIndex:/);
  assert.match(DEMO_SCRIPT_SRC, /screen:\s*params\.get\('screen'\) === 'placement' \? 'placement' : 'battle'/,
    'the demo defaults to battle and exposes the isolated placement screen by query');
  assert.match(INDEX_SRC, /href="\/app\/styles\/craps-table\.css"/);
  assert.match(INDEX_SRC, /<app-craps-table><\/app-craps-table>/);
  assert.match(INDEX_SRC, /'\/app\/components\/app-craps-table\.js'/);
});
