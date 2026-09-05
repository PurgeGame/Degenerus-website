import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CHAIN, CONTRACTS } from '../../app/chain-config.js';

globalThis.HTMLElement ??= class HTMLElement {};
globalThis.customElements ??= {
  registry: new Map(),
  define(name, ctor) { this.registry.set(name, ctor); },
  get(name) { return this.registry.get(name); },
};

const moduleUrl = new URL('../app-craps-entry.js', import.meta.url);
const indexUrl = new URL('../../index.html', import.meta.url);
const cssUrl = new URL('../../styles/app.css', import.meta.url);
const componentSource = readFileSync(moduleUrl, 'utf8');
const indexSource = readFileSync(indexUrl, 'utf8');
const cssSource = readFileSync(cssUrl, 'utf8');

const crapsEntry = await import(moduleUrl);

const replayIdentity = (battleKey, viewerBetId, {
  chainId = CHAIN.id,
  contract = CONTRACTS.CRAPS,
} = {}) => [chainId, contract.toLowerCase(), battleKey.toLowerCase(), viewerBetId].join(':');

test('the browser clock mirrors all seven contract battle boundaries', () => {
  const period = (iso) => crapsEntry.crapsPeriodAt(Date.parse(iso));
  assert.equal(period('2026-08-28T22:57:00Z'), 0);
  assert.equal(period('2026-08-28T23:01:59Z'), 0);
  assert.equal(period('2026-08-28T23:02:00Z'), 1);
  assert.equal(period('2026-08-28T23:04:00Z'), 2);
  assert.equal(period('2026-08-28T23:06:00Z'), 3);
  assert.equal(period('2026-08-28T23:08:00Z'), 4);
  assert.equal(period('2026-08-28T23:10:00Z'), 5);
  assert.equal(period('2026-08-28T23:12:00Z'), 6);
  assert.equal(period('2026-08-28T23:14:00Z'), 7);
  assert.deepEqual(crapsEntry.crapsBattleCloseLabels(Date.parse('2026-08-28T22:57:00Z')),
    ['23:02', '23:04', '23:06', '23:08', '23:10', '23:12', '23:14']);
  assert.equal(
    crapsEntry.crapsBattleCountdownLabel(
      Date.parse('2026-08-28T23:04:00Z'),
      Date.parse('2026-08-28T23:02:54Z'),
    ),
    '2m',
  );
  assert.equal(
    crapsEntry.crapsBattleCountdownLabel(
      Date.parse('2026-08-29T00:04:01Z'),
      Date.parse('2026-08-28T23:03:00Z'),
    ),
    '1h 2m',
  );
  assert.equal(
    crapsEntry.crapsBattleCountdownLabel(
      Date.parse('2026-08-29T00:03:00Z'),
      Date.parse('2026-08-28T23:03:00Z'),
    ),
    '1h',
  );
});

test('future slates keep using available comps after the final battle until rollover', () => {
  const clock = {
    daySeconds: 86_400,
    anchorSeconds: 0,
    openerCloseSeconds: 1_200,
    clockAlignSeconds: 180,
    routinePeriodSeconds: 14_400,
    eventLeadSeconds: 900,
  };
  const afterFinalBattle = crapsEntry.crapsEntryState({
    day: 42,
    nowMs: 85_500_000,
    clock,
  });
  assert.equal(afterFinalBattle.currentPeriod, 7,
    'the event battle has closed for the day');
  assert.equal(afterFinalBattle.dayEntryKind, 'future-day');
  assert.equal(afterFinalBattle.dayEntryDay, 43,
    'the reservation still targets a strictly future contract day');
  assert.equal(afterFinalBattle.nextDayAtMs, 86_400_000);
  assert.equal(crapsEntry.crapsBattleCountdownLabel(afterFinalBattle.nextDayAtMs, 85_500_000), '15m');
  assert.doesNotMatch(componentSource, /passCutoffAtMs|futurePassOpen/,
    'the UI does not invent an earlier cutoff for a contract-valid future day');
  assert.equal((componentSource.match(/const compEligible = !this\.#forceFlipDay/g) || []).length, 2,
    'rendering and the last-second transaction path both retain automatic comp use');
  assert.match(componentSource, /const usePass = kind === 'future-day' && compEligible && selectedPasses > 0/);
});

test('goal multipliers use player-facing difficulty labels', () => {
  assert.equal(crapsEntry.crapsGoalLabel(5), 'EASY');
  assert.equal(crapsEntry.crapsGoalLabel(10), 'HARD');
  assert.equal(crapsEntry.crapsGoalLabel(20), 'HARD');
  assert.equal(crapsEntry.crapsGoalLabel(50), 'V HARD');
  assert.equal(crapsEntry.crapsGoalLabel(null), '—');
});

test('the legacy launcher omits the retired goal presentation', () => {
  assert.doesNotMatch(componentSource, /<th[^>]*>GOAL<\/th>|data-bind="craps-(?:battle|full-day)-goal"/);
  assert.doesNotMatch(componentSource, /dataset\.goalResult/);
  assert.doesNotMatch(cssSource, /craps-entry__goal|data-goal-result/);
});

test('the compact surface keeps ten chips and packs the audited contract order', () => {
  assert.deepEqual([0, 1, 2, 3].map(crapsEntry.crapsEntryNextSpotCount), [1, 2, 3, 0],
    'spot clicks add through three chips and the fourth click clears the stack');
  assert.equal(crapsEntry.packCrapsEntryBoard({
    passLine: 1,
    place4: 2,
    hard8: 3,
    dontPassLine: 1,
  }), (1 | (2 << 3) | (3 << 24) | (1 << 27)) >>> 0);

  const initial = crapsEntry.crapsEntryBoardSummary({});
  assert.deepEqual({
    placed: initial.placed,
    random: initial.random,
    chance: initial.chance,
    stacks: [initial.leftRandomStack, initial.rightRandomStack],
  }, { placed: 0, random: 10, chance: 15, stacks: [5, 5] });

  const fivePlaced = crapsEntry.crapsEntryBoardSummary({ place4: 3, place8: 2 });
  assert.deepEqual({
    placed: fivePlaced.placed,
    random: fivePlaced.random,
    chance: fivePlaced.chance,
    stacks: [fivePlaced.leftRandomStack, fivePlaced.rightRandomStack],
  }, { placed: 5, random: 5, chance: 8, stacks: [5, 0] });

  const sevenPlaced = crapsEntry.crapsEntryBoardSummary({ place4: 3, place8: 3, hard4: 1 });
  assert.deepEqual({
    placed: sevenPlaced.placed,
    random: sevenPlaced.random,
    chance: sevenPlaced.chance,
    stacks: [sevenPlaced.leftRandomStack, sevenPlaced.rightRandomStack],
  }, { placed: 7, random: 3, chance: 5, stacks: [3, 0] });
});

test('High Roller selection exposes only the High Roller entrant field', () => {
  const field = { total: 37, high: 4 };
  assert.equal(crapsEntry.crapsEntrantCountForLane(field, false), 37);
  assert.equal(crapsEntry.crapsEntrantCountForLane(field, true), 4);
  assert.equal(crapsEntry.crapsEntrantCountForLane({ total: 37 }, true), null,
    'missing lane data never falls back to the combined field');
});

test('a lobby result stays sealed and only claims readiness once its replay can open', () => {
  const address = '0xAB12000000000000000000000000000000000000';
  const battleKey = `0x${'ab'.repeat(32)}`;
  const result = { battleKey, winner: address.toLowerCase() };
  const replays = [{ battleKey, viewerBetId: '17' }];
  const identity = replayIdentity(battleKey, '17');

  assert.equal(crapsEntry.crapsResultNeedsReveal(result, {
    address,
    replays,
    wasSeen: () => false,
  }), true);
  assert.equal(crapsEntry.crapsResultRevealState(result, {
    address,
    replays,
    states: new Map([[identity, { ready: false, status: 'settling' }]]),
  }), 'waiting');
  assert.deepEqual(crapsEntry.crapsResultRevealCopy('waiting'), {
    status: 'RESULT SETTLING',
    route: 'STATUS IN PENDING',
    aria: 'result is still settling; follow its status in Pending',
  });
  assert.equal(crapsEntry.crapsResultRevealState(result, {
    address,
    replays,
    states: new Map([[identity, { ready: true, status: 'ready' }]]),
  }), 'ready');
  assert.deepEqual(crapsEntry.crapsResultRevealCopy('ready'), {
    status: 'RESULT READY',
    route: 'VIEW IN PENDING',
    aria: 'result ready; view it in Pending to reveal',
  });
  assert.equal(crapsEntry.crapsResultRevealState(result, {
    address,
    replays,
    states: new Map([[identity, { ready: false, status: 'build-unavailable' }]]),
  }), 'unavailable');
  assert.equal(crapsEntry.crapsResultNeedsReveal(result, {
    address,
    replays,
    wasSeen: () => true,
  }), false);
  assert.equal(crapsEntry.crapsResultRevealState(result, {
    address,
    replays,
    wasSeen: () => true,
  }), null);
  assert.equal(crapsEntry.crapsResultNeedsReveal({ battleKey: `0x${'cd'.repeat(32)}` }, {
    address,
    replays,
    wasSeen: () => false,
  }), false);
  assert.match(componentSource,
    /data-bind="craps-battle-result-status">RESULT SETTLING<\/small><strong data-bind="craps-battle-result-route">STATUS IN PENDING/,
    'the static shell never advertises a replay as ready before loader state arrives');
});

test('winner-list goal colors and actual winner buy-ins come from sealed result data', () => {
  assert.equal(crapsEntry.crapsWinnerGoalResult({ winningStop: 1 }), 'met');
  assert.equal(crapsEntry.crapsWinnerGoalResult({ winningStop: 0 }), 'missed');
  assert.equal(crapsEntry.crapsWinnerGoalResult({ winningStop: null }), 'unknown');
  const result = { buyInWei: '500000000000000000000', highMultiple: 10 };
  assert.equal(crapsEntry.crapsWinnerListBuyInWei(result, false), '500000000000000000000');
  assert.equal(crapsEntry.crapsWinnerListBuyInWei(result, true), '5000000000000000000000');
  assert.equal(crapsEntry.crapsWinnerListBuyInWei({
    ...result,
    entryMultiple: 100,
  }, false), '50000000000000000000000',
  'a High Roller who wins the shared main field still shows the 100x price they paid');
});

test('result Added amount and color include an actual progressive payout', () => {
  assert.equal(crapsEntry.crapsAddedResultWei('800', null), 800n);
  assert.equal(crapsEntry.crapsAddedResultWei('800', '2000'), 2800n,
    'the purple Added figure includes both the normal boost and progressive payout');
  assert.equal(crapsEntry.crapsAddedResultWei(null, '2000'), null,
    'the UI does not present a partial Added amount when its normal boost is unknown');
  assert.equal(crapsEntry.crapsAddedResultTone(null), 'added');
  assert.equal(crapsEntry.crapsAddedResultTone('0'), 'added');
  assert.equal(crapsEntry.crapsAddedResultTone('1'), 'progressive');
});

test('the winner total counts day passes, so the boost can never exceed it', () => {
  // REGRESSION (run #45, day 68 battle 5): the card read a +269K boost against a 158.9K
  // total. Both figures were right; they were just different things. `_splitAward` spends
  // half the ADMITTED boost on day passes and SUBTRACTS what it banks from the liquid pot,
  // so the FLIP payment is the award MINUS the passes. Counting only the FLIP made a
  // component of the award look bigger than the award. Real numbers from that battle:
  // 2,690 boost units admitted = 269,000 FLIP, 5 normal passes at 22,800 = 114,000 banked,
  // 158,900 FLIP credited. 158,900 + 114,000 = 272,900, which covers the boost.
  const wei = 10n ** 18n;
  const withPasses = {
    totalWonWei: 158_900n * wei,
    winnerPassWei: 114_000n * wei,
    winnerBoostWei: 269_000n * wei,
  };
  assert.equal(crapsEntry.crapsWinnerTotalLabel(withPasses), '272.9K',
    'the pass award is part of what the battle paid and belongs in the total');
  assert.ok(withPasses.winnerBoostWei <= withPasses.totalWonWei + withPasses.winnerPassWei,
    'the boost is a COMPONENT of the total, so it must never exceed it');
  // A battle that banked nothing in passes is unchanged.
  assert.equal(crapsEntry.crapsWinnerTotalLabel({ totalWonWei: 158_900n * wei, winnerPassWei: 0n }),
    '158.9K', 'no split means no change to the reported total');
  // The still-loading shape keeps its `>=` marker and still counts known passes.
  assert.equal(crapsEntry.crapsWinnerTotalLabel({ amountWei: 158_900n * wei, winnerPassWei: 114_000n * wei }),
    '\u2265272.9K', 'a partial total still counts the passes it already knows about');
  // A result with no pass field at all (a lane that never split) must not throw.
  assert.equal(crapsEntry.crapsWinnerTotalLabel({ totalWonWei: 1_000n * wei }), '1,000');
});

test('winner-list results follow the selected main or High Roller lane', () => {
  const main = {
    battleKey: `0x${'12'.repeat(32)}`,
    winner: '0x0000000000000000000000000000000000000011',
    amountWei: '5000',
    winnerBoostWei: '400',
    winningStop: 1,
    buyInWei: '500',
    highMultiple: 10,
    highResult: {
      winner: '0x0000000000000000000000000000000000000022',
      amountWei: '9000',
      winnerBoostWei: '700',
      winningStop: null,
      bankrollRider: false,
    },
  };

  assert.equal(crapsEntry.crapsWinnerResultForLane(main, false), main,
    'Normal selection keeps the main battle winner and bounty');
  assert.deepEqual(crapsEntry.crapsWinnerResultForLane(main, true), {
    ...main,
    ...main.highResult,
    lane: 'high',
  }, 'a contested High Roller field paints its own winner and side prize');

  const soleGoal = {
    ...main,
    highResult: {
      winner: '0x0000000000000000000000000000000000000033',
      amountWei: '1',
      winnerBoostWei: null,
      winningStop: 1,
      bankrollRider: true,
    },
  };
  assert.equal(crapsEntry.crapsWinnerResultForLane(soleGoal, true)?.winner,
    soleGoal.highResult.winner, 'a sole High Roller is shown after hitting the goal');
  assert.equal(crapsEntry.crapsWinnerResultForLane({
    ...soleGoal,
    highResult: { ...soleGoal.highResult, amountWei: '0', winningStop: 0 },
  }, true), null, 'a sole High Roller who missed the goal is not presented as a winner');
  assert.equal(crapsEntry.crapsWinnerResultForLane({ ...main, highResult: null }, true), null,
    'an empty High Roller field never falls back to the main winner');
});

test('result-bar replays open with the winning seat as the viewer', () => {
  const battleKey = `0x${'34'.repeat(32)}`;
  const winner = '0xAB12000000000000000000000000000000000000';
  assert.deepEqual(crapsEntry.crapsWinnerReplayRequest({
    battleKey,
    betId: '6234999496913828446217',
    winner,
    potWei: '12000000000000000000000',
    amountWei: 9_000n * 10n ** 18n,
    winningStop: 1,
    winningScoreBps: 5_030_000,
    biggestDiceRunHit: true,
    biggestDiceRunBefore: {
      player: '0x0000000000000000000000000000000000000099',
      scoreBps: 4_200_000n,
      bountyWei: 66_000n,
    },
    bonusMultiplier: 100,
  }), {
    battleKey,
    viewerBetId: '6234999496913828446217',
    settledMainPotWei: '12000000000000000000000',
    battleWinner: winner.toLowerCase(),
    battleWinnerBetId: '6234999496913828446217',
    battlePayoutWei: '9000000000000000000000',
    battleWinningStop: 1,
    winningScoreBps: '5030000',
    biggestDiceRunHit: true,
    biggestDiceRunBefore: {
      player: '0x0000000000000000000000000000000000000099',
      scoreBps: 4_200_000n,
      bountyWei: 66_000n,
    },
    bonusMultiplier: 100,
  }, 'the replay loader receives the winner bet id as its initial perspective');
  const highWinner = '0xCD34000000000000000000000000000000000000';
  const highRequest = crapsEntry.crapsWinnerReplayRequest(crapsEntry.crapsWinnerResultForLane({
    battleKey,
    betId: '17',
    winner,
    amountWei: '5000',
    winningStop: 0,
    highResult: {
      betId: '29',
      winner: highWinner,
      amountWei: '9000',
      winningStop: 1,
      bankrollRider: false,
    },
  }, true));
  assert.equal(highRequest.viewerBetId, '29');
  assert.equal(highRequest.battleWinner, highWinner.toLowerCase(),
    'High Roller replay follows that lane winner instead of the main winner');
  assert.equal(crapsEntry.crapsWinnerReplayRequest({ battleKey, betId: null, winner }), null);
  assert.equal(crapsEntry.crapsWinnerReplayRequest({ battleKey: 'bad', betId: '1', winner }), null);

  assert.match(componentSource,
    /data-bind="craps-battle-result-details"[\s\S]*?class="craps-entry__result-replay" data-craps-winner-replay/,
    'each completed battle has a compact replay control in its result bar');
  assert.match(componentSource,
    /data-bind="craps-previous-event-result-details"[\s\S]*?class="craps-entry__result-replay" data-craps-winner-replay/,
    'the rollover event result exposes the same replay control');
  assert.equal((componentSource.match(/class="craps-entry__result-replay"[^>]*>[\s\S]*?<svg viewBox="0 0 24 24"[^>]*>[\s\S]*?<circle cx="7\.5"[\s\S]*?<circle cx="14"[\s\S]*?<rect x="4"[\s\S]*?<path d="m16 12\.25 4-2v7\.5l-4-2Z"/g) || []).length, 2,
    'both replay actions use the compact two-reel movie-camera glyph');
  assert.doesNotMatch(componentSource, /craps-entry__result-replay[^<]*[\s\S]{0,180}>REPLAY</,
    'the result row no longer spends space on a REPLAY text pill');
  assert.match(componentSource,
    /#clickListener = \(event\) => \{[\s\S]*?\[data-craps-winner-replay\][\s\S]*?#openWinnerReplay\(replay\)/,
    'the result action is handled before buy-in controls');
  assert.match(componentSource,
    /#openWinnerReplay\(button\)[\s\S]*?openCrapsReplayTable\(table, \{[\s\S]*?\.\.\.replay,[\s\S]*?fetchImpl: crapsReplayFetch/s,
    'the winner-scoped request reuses the verified replay table adapter');
  assert.match(componentSource,
    /#biggestDiceRunForReplay\(replay[\s\S]*?biggestDiceRunHit === true[\s\S]*?biggestDiceRunBefore[\s\S]*?bountyWei[\s\S]*?readPreviousDiceRunRecord\(candidate\)/s,
    'the replay header prefers the result\'s explicit pre-run Biggest card and retains a compatibility fallback');
  assert.match(componentSource,
    /#bindWinnerReplay\([\s\S]*?concealed \? null : laneResult/s,
    'an unseen owned result cannot leak through the public replay button');
  assert.match(cssSource, /\.craps-entry__result-replay\s*\{[^}]*width:\s*1\.02rem[^}]*height:\s*1\.02rem[^}]*border:\s*0[^}]*background:\s*transparent/s,
    'the replay action is a small transparent icon instead of a text button');
  assert.match(cssSource, /\.craps-entry__result-replay svg\s*\{[^}]*width:\s*\.7rem[^}]*stroke:\s*currentColor/s,
    'the camera stays crisp and inherits the interactive state color');
});

test('a Normal future reservation remains visibly upgradeable when High Roller is selected', () => {
  assert.equal(crapsEntry.crapsDayTicketNeedsHighUpgrade({ highMask: 0 }, true), true);
  assert.equal(crapsEntry.crapsDayTicketNeedsHighUpgrade({ highMask: 0x03 }, true), true);
  assert.equal(crapsEntry.crapsDayTicketNeedsHighUpgrade({ highMask: 0x7F }, true), false);
  assert.equal(crapsEntry.crapsDayTicketNeedsHighUpgrade({ highMask: 0 }, false), false);
  assert.equal(crapsEntry.crapsDayTicketNeedsHighUpgrade(null, true), false);
});

test('winner totals retain a visible, honest chain lower bound while the indexer is unavailable', () => {
  const wei = 10n ** 18n;
  assert.equal(crapsEntry.crapsWinnerTotalLabel({
    amountWei: 5_000n * wei,
    totalWonWei: null,
  }), '≥5,000');
  assert.equal(crapsEntry.crapsWinnerTotalLabel({
    amountWei: 5_000n * wei,
    totalWonWei: 25_000n * wei,
  }), '25K');
  assert.equal(crapsEntry.crapsWinnerTotalLabel({
    amountWei: 5_000n * wei,
    progressivePaidWei: 20_000n * wei,
    totalWonWei: null,
  }), '≥25K', 'a chain-native Run It Up payment remains in the known lower bound');
  assert.equal(crapsEntry.crapsWinnerTotalLabel(null), '—');
});

test('the day row rolls to tomorrow after Battle 1 while later windows remain selectable today', () => {
  const state = crapsEntry.crapsEntryState({
    day: 42,
    nowMs: Date.parse('2026-08-28T23:02:00Z'),
  });
  assert.equal(state.fullDayOpen, true);
  assert.equal(state.currentPeriod, 1);
  assert.equal(state.dayEntryKind, 'future-day');
  assert.equal(state.dayEntryDay, 43);
  assert.deepEqual(state.battles.map(({ state: status, joinable }) => [status, joinable]), [
    ['closed', false],
    ['current', true],
    ['upcoming', true],
    ['upcoming', true],
    ['upcoming', true],
    ['upcoming', true],
    ['upcoming', true],
  ]);
  assert.equal(state.battles[0].slot, '337');
  assert.equal(state.battles[6].slot, '343');
});

test('the Craps day quest offers exact Today terms only before Battle 1 resolves', () => {
  const beforeFirstResolution = crapsEntry.crapsDayQuestPurchaseOptions({
    state: { day: 42, currentPeriod: 0 },
    todayPrice: 17_300n,
  });
  assert.deepEqual(beforeFirstResolution, {
    today: { day: 42, price: '17300' },
    tomorrow: { day: 43, price: '25000', label: 'TOMORROW' },
  });

  assert.deepEqual(crapsEntry.crapsDayQuestPurchaseOptions({
    state: { day: 42, currentPeriod: 1 },
    todayPrice: 17_300n,
  }), {
    today: null,
    tomorrow: { day: 43, price: '25000', label: 'TOMORROW' },
  });
  assert.equal(crapsEntry.crapsDayQuestPurchaseOptions({
    state: { day: 42, currentPeriod: 0 },
    todayPrice: null,
  }).today, null, 'Today stays hidden until its exact live price is available');

  assert.deepEqual(crapsEntry.crapsDayQuestPurchaseOptions({
    state: { day: 42, currentPeriod: 0 },
    todayPrice: 17_300n,
    playerEntries: {
      days: { 42: { betId: '336' }, 43: { source: 'comp' }, 44: { source: 'paid' } },
      windows: Array(7).fill(null),
    },
  }), {
    today: null,
    tomorrow: { day: 45, price: '25000', label: 'DAY 45' },
  }, 'an owned current slate is hidden and comp-reserved future days are skipped');

  assert.equal(crapsEntry.crapsDayQuestPurchaseOptions({
    state: { day: 42, currentPeriod: 0 },
    todayPrice: 17_300n,
    playerEntries: { days: {}, windows: [{ betId: '337' }] },
  }).today, null, 'a direct current battle also makes the whole-day Today option invalid');
});

test('lobby order keeps the next event first, tomorrow above newest settled history', () => {
  assert.deepEqual(crapsEntry.crapsLobbyRowOrder({ currentPeriod: 0, futureDay: false }),
    ['day', 0, 1, 2, 3, 4, 5, 6, 'tomorrow']);
  assert.deepEqual(crapsEntry.crapsLobbyRowOrder({ currentPeriod: 3, futureDay: true }),
    [3, 4, 5, 6, 'day', 2, 1, 0]);
  assert.deepEqual(crapsEntry.crapsLobbyRowOrder({
    currentPeriod: 2,
    futureDay: true,
    settledPeriods: [2],
  }), [3, 4, 5, 6, 'day', 2, 1, 0]);
  assert.deepEqual(crapsEntry.crapsLobbyRowOrder({ currentPeriod: 7, futureDay: true }),
    ['day', 6, 5, 4, 3, 2, 1, 0]);
});

test('the authoritative chain day wins while indexed game state is stale at rollover', () => {
  assert.equal(crapsEntry.crapsActiveDay({ indexedDay: 42, chainDay: 43 }), 43,
    'a prepaid day-43 ticket must be looked up as soon as the chain crosses into day 43');
  assert.equal(crapsEntry.crapsActiveDay({ indexedDay: 43, chainDay: null }), 43,
    'indexed game state remains the startup fallback until the direct chain clock is available');
  assert.equal(crapsEntry.crapsActiveDay({ indexedDay: 44, chainDay: 43 }), 43,
    'once available, the direct chain clock is authoritative in either disagreement direction');
});

test('the previous day clears as soon as the new day is rolled', () => {
  const day28 = Object.freeze({ day: 28, winner: '0x2800000000000000000000000000000000000000' });
  assert.strictEqual(crapsEntry.crapsPreviousEventDuringRollover({
    day: 29,
    wordValue: 0,
    result: day28,
  }), day28, 'the old result may bridge the pre-roll handoff');
  assert.equal(crapsEntry.crapsPreviousEventDuringRollover({
    day: 29,
    wordValue: '123',
    result: day28,
  }), null, 'the current day word clears the old result immediately');
  assert.equal(crapsEntry.crapsPreviousEventDuringRollover({
    day: 30,
    wordValue: 0,
    result: day28,
  }), null, 'older history can never leak into a later rollover');
});

test('entry terms combine exact economics with the event-published added FLIP ceiling', () => {
  const word = '102858562227254754036121703853225298402533986033002165985066946425924666406226';
  const schedule = {
    windows: Array.from({ length: 7 }, (_, period) => ({
      addedFlipWei: BigInt(period + 1) * 10n ** 18n,
    })),
  };
  const terms = crapsEntry.crapsEntryTerms({ wordValue: word, schedule });
  assert.equal(terms.complete, true);
  assert.equal(terms.buyInFlip, 17_300n);
  assert.equal(terms.addedFlipWei, 28n * 10n ** 18n);
  assert.equal(terms.highMult, 10);
  // Run-45 rules: fixed 5x depth AND fixed 5x goal (audit 0880d134c — the two-way draw is gone).
  assert.deepEqual(terms.windows.map(({ buyInFlip, bankMult, goalMult }) => (
    [buyInFlip, bankMult, goalMult]
  )), [
    [2_000n, 5, 5], [400n, 5, 5], [500n, 5, 5], [400n, 5, 5],
    [400n, 5, 5], [1_500n, 5, 5], [12_100n, 5, 5],
  ]);
});

test('entry selections use the reserved day slot and numbered battle slots', () => {
  assert.deepEqual(crapsEntry.crapsEntrySelection({ day: 42, kind: 'day' }), {
    entryKind: 'day',
    entryDay: 42,
    entryPeriod: null,
    battleSlot: '336',
    tableIndex: '336',
    entryLabel: 'DAY 42 · ALL 7 BATTLES',
  });
  assert.deepEqual(crapsEntry.crapsEntrySelection({ day: 42, kind: 'window', period: 6 }), {
    entryKind: 'window',
    entryDay: 42,
    entryPeriod: 6,
    battleSlot: '343',
    tableIndex: '343',
    entryLabel: 'DAY 42 · BATTLE 7',
  });
  assert.deepEqual(crapsEntry.crapsEntrySelection({ day: 42, kind: 'future-day' }), {
    entryKind: 'future-day',
    entryDay: 43,
    entryPeriod: null,
    battleSlot: '344',
    tableIndex: '344',
    entryLabel: 'DAY 43 · RESERVE ALL 7 BATTLES',
  });
  assert.deepEqual(crapsEntry.crapsEntrySelection({
    day: 42,
    kind: 'future-day',
    targetDay: 45,
  }), {
    entryKind: 'future-day',
    entryDay: 45,
    entryPeriod: null,
    battleSlot: '360',
    tableIndex: '360',
    entryLabel: 'DAY 45 · RESERVE ALL 7 BATTLES',
  });
  assert.throws(
    () => crapsEntry.crapsEntrySelection({ day: 42, kind: 'future-day', targetDay: 42 }),
    /future Craps day/,
  );
  assert.throws(
    () => crapsEntry.crapsEntrySelection({ day: 42, kind: 'window', period: 7 }),
    /seven Craps battles/,
  );
});

test('lobby rows build exact normal, High Roller, and future-day contract calls', () => {
  const board = 0x1241111;
  const normal = crapsEntry.crapsEntryWager({
    day: 42, kind: 'window', period: 3, buyInFlip: 400n, contractChips: board,
  });
  assert.equal(normal.method, 'enterBonusBattle');
  assert.deepEqual(normal.contractArgs, [3, board, 1]);
  assert.equal(normal.totalFlip, '400');

  const high = crapsEntry.crapsEntryWager({
    day: 42, kind: 'window', period: 3, buyInFlip: 400n,
    highRoller: true, highMult: 10, contractChips: board,
  });
  assert.deepEqual(high.contractArgs, [3, board, 10]);
  assert.equal(high.totalFlip, '4000');

  const futureNormal = crapsEntry.crapsEntryWager({
    day: 42, kind: 'future-day', contractChips: board,
  });
  assert.equal(futureNormal.method, 'buyFutureCrapsDays');
  assert.deepEqual(futureNormal.contractArgs, [43, 1, false, board]);
  assert.equal(futureNormal.totalFlip, '25000');
  assert.equal(futureNormal.payment, 'flip');

  const futureAfterComp = crapsEntry.crapsEntryWager({
    day: 42, kind: 'future-day', targetDay: 44, contractChips: board,
  });
  assert.deepEqual(futureAfterComp.contractArgs, [44, 1, false, board]);
  assert.equal(futureAfterComp.entryDay, 44);
  assert.equal(futureAfterComp.totalFlip, '25000');

  const futurePass = crapsEntry.crapsEntryWager({
    day: 42, kind: 'future-day', contractChips: board, usePass: true,
  });
  assert.equal(futurePass.method, 'applyCrapsPasses');
  assert.deepEqual(futurePass.contractArgs, [43, 1, false, board]);
  assert.equal(futurePass.payment, 'pass');
  assert.equal(futurePass.totalFlip, '0');
  assert.equal(futurePass.stakedWei, '0');

  const futureHigh = crapsEntry.crapsEntryWager({
    day: 42, kind: 'future-day', highRoller: true, contractChips: board,
  });
  assert.deepEqual(futureHigh.contractArgs, [43, 1, true, board]);
  assert.equal(futureHigh.totalFlip, '450000');
});

test('an entered seat becomes amendable only after its board changes', () => {
  const entry = { betId: '6206227746803369984', chips: 0x1241111 };
  assert.equal(crapsEntry.crapsEntryNeedsAmend(entry, {
    boardSet: false,
    contractChips: 0x1111444,
  }), false);
  assert.equal(crapsEntry.crapsEntryNeedsAmend(entry, {
    boardSet: true,
    contractChips: 0x1241111,
  }), false);
  assert.equal(crapsEntry.crapsEntryNeedsAmend(entry, {
    boardSet: true,
    contractChips: 0x1111444,
  }), true);
});

test('the widget occupies the third play-grid track and loads with the idle panels', () => {
  assert.match(indexSource, /<section class="play-grid"[^>]*>[\s\S]*?<app-quest-panel>[\s\S]*?<app-degenerette-panel>[\s\S]*?<app-craps-entry>/s);
  assert.match(indexSource, /['"]\/app\/components\/app-craps-entry\.js['"]/);
  assert.match(cssSource, /grid-template-areas:\s*"quests degenerette craps"/);
  assert.match(cssSource, /> app-craps-entry\s*\{[\s\S]*?grid-area:\s*craps/s);
  assert.match(componentSource, /data-craps-entry="day"/);
  assert.match(componentSource, /data-craps-entry="future-day"/);
  assert.equal((componentSource.match(/data-craps-entry="window"/g) || []).length, 3,
    'the click selector, quest-focus selector, and one generated template cover all seven windows');
});

test('Craps entry failures are visible and duplicate-entry state repairs from chain', () => {
  assert.match(componentSource,
    /class="craps-entry__message" data-bind="craps-entry-message"\s+role="status" aria-live="polite" aria-atomic="true" hidden/,
    'handled wallet and preflight failures have a visible live region');
  assert.match(componentSource,
    /const messageNode = this\.querySelector\('\[data-bind="craps-entry-message"\]'\);[\s\S]*?messageNode\.textContent = this\.#message;[\s\S]*?messageNode\.hidden = !this\.#message;/,
    'the component paints rather than silently stores its action message');
  assert.match(componentSource,
    /error\?\.code === 'AlreadyInBonus'[\s\S]*?readCrapsPlayerEntriesOnChain\(state\.day, player\)[\s\S]*?playerEntries: freshPlayerEntries/,
    'an authoritative duplicate-entry rejection replaces a stale indexed projection with wallet-filtered chain state');
  assert.doesNotMatch(componentSource, /this\.#message = kind === 'future-day'/,
    'successful entries update the lobby without adding routine confirmation copy');
  assert.equal((componentSource.match(/<button type="button" data-write data-craps-entry=/g) || []).length, 3,
    'all three entry-button templates participate in the shared wallet/write gate');
  assert.match(componentSource, /button\.disabled = Boolean\(domainLocked \|\| !canSign\)/,
    'component domain locks and wallet signing state compose without enabling each other');
  assert.match(cssSource, /\.craps-entry__message\s*\{[^}]*color:\s*#fde68a/,
    'the compact status remains legible against the Craps felt on phone');
});

test('the unified signboard presents Craps Autobattle and the Run It Up jackpot', () => {
  assert.match(componentSource, /craps-entry__identity craps-entry__identity--craps/);
  assert.match(componentSource, /craps-autobattle-integrated-swords-v8\.webp/,
    'the approved lockup is one transparent asset, so its swords cannot clip either word');
  assert.doesNotMatch(componentSource, /craps-entry__craps-(?:logo-base|logo-finish|swords)/,
    'the live header does not reconstruct the lockup from overlapping image layers');
  assert.match(componentSource, /alt="CRAPS AUTO BATTLE bookended by silver and blue dice badges, with crossed swords between AUTO and BATTLE"/,
    'the combined logo preserves both circular dice badges and the battle mark');
  assert.doesNotMatch(componentSource, /dgnBadgePath|dgn-traits\.js/,
    'the finished logo does not reconstruct itself from unrelated game badges');
  assert.doesNotMatch(componentSource, /7 DAILY AUTOBATTLES/);
  assert.match(componentSource, /craps-entry__runup-kicker"[^>]*>FEATURING THE</);
  assert.match(componentSource, /craps-entry__runup-submark"[^>]*>PROGRESSIVE JACKPOT</);
  assert.match(componentSource, /<header class="craps-entry__head">[\s\S]*?data-bind="craps-progressive"[\s\S]*?<\/header>/);
  assert.match(componentSource, /data-bind="craps-progressive-amount"/);
  assert.match(componentSource, /run-it-up-progressive-jackpot-logo-v2\.webp/,
    'the right identity integrates Progressive Jackpot into the Run It Up artwork');
  assert.match(componentSource, /Run It Up Progressive Jackpot/,
    'accessible meter copy matches the finished logo');
  assert.match(componentSource, /readCrapsProgressivePool\(\)/);
  assert.match(cssSource, /\.craps-entry__head\s*\{[^}]*min-height:\s*5rem[^}]*grid-template-rows:\s*minmax\(0,1fr\) 1\.62rem[^}]*background:\s*linear-gradient\(180deg,#e8edf0/s,
    'one chrome chassis contains both logos and the counter rail');
  assert.match(componentSource, /<div class="craps-entry__display-face">[\s\S]*?<div class="craps-entry__logo-deck">[\s\S]*?<div class="craps-entry__header-metrics">/s,
    'the logo and counter rows share one structural display face');
  assert.match(cssSource, /\.craps-entry__display-face\s*\{[^}]*grid-template-rows:\s*minmax\(0,1fr\) 1\.62rem[^}]*radial-gradient\(ellipse at 50% -18%,rgba\(36,175,112,\.2\),transparent 72%\),linear-gradient\(180deg,#10372a 0,#082117 46%,#04150e 74%,#020b07 100%\)/s,
    'one uninterrupted deep-emerald gradient spans the complete inner sign');
  assert.match(cssSource, /\.craps-entry__identity\s*\{[^}]*place-items:\s*center/s,
    'each brand lockup is centered on both axes within its exact half');
  assert.match(cssSource, /\.craps-entry__craps-logo\s*\{[^}]*width:\s*93%[^}]*justify-self:\s*center/s,
    'the reduced-width Auto Battle artwork does not cling to the left grid edge');
  assert.doesNotMatch(cssSource, /\.craps-entry__craps-logo::(?:before|after)/,
    'the corrected production asset needs no clipped CSS layer over its wordmark or dice badges');
  assert.match(cssSource, /\.craps-entry__logo-deck\s*\{[^}]*grid-template-columns:\s*50% 50%[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
    'the logo row contributes no separate panel surface');
  assert.doesNotMatch(cssSource, /\.craps-entry__logo-deck::before/,
    'the shared logo background has no center rule splitting it into two panels');
  assert.match(cssSource, /\.craps-entry__header-metrics\s*\{[^}]*grid-row:\s*2[^}]*grid-template-columns:\s*50% 50%/s,
    'both metrics occupy one structural footer row across the shared header');
  assert.match(cssSource, /\.craps-entry__header-metrics\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
    'the counter row contributes no boundary or separate background');
  assert.match(cssSource, /\.craps-entry__runup-submark\s*\{[^}]*width:\s*68%[^}]*border-radius:\s*0[^}]*clip-path:\s*none/s,
    'Progressive Jackpot uses a straight recessed light rail instead of another oval');
  assert.doesNotMatch(cssSource, /\.craps-entry__identity--runup::after/,
    'the logo bay has no masking panel that can read as a stray dark rectangle');
  assert.match(cssSource, /\.craps-entry__run-it-up-mark img\s*\{[^}]*clip-path:\s*inset\(0 0 31% 0\)/s,
    'the baked-in plaque is cropped directly at the artwork edge');
  assert.doesNotMatch(cssSource, /\.craps-entry__head::(?:before|after)/,
    'the cabinet does not add decorative corner rivets');
  assert.match(cssSource, /\.craps-entry__daily-added\s*\{[^}]*display:\s*flex[^}]*width:\s*calc\(100% - \.72rem\)[^}]*height:\s*calc\(100% - \.16rem\)[^}]*place-self:\s*center[^}]*align-items:\s*center[^}]*justify-content:\s*center/s,
    'the silver plaque is geometrically centered in the complete left bay');
  assert.match(cssSource, /\.craps-entry__added-key\s*\{[^}]*place-items:\s*center start[^}]*line-height:\s*\.94/s,
    'the two-line Added Yesterday key has enough compact-layout line height');
  assert.match(cssSource, /\.craps-entry__daily-added\s*\{[^}]*border:\s*1px solid rgba\(190,204,213,\.78\)[^}]*border-radius:\s*\.16rem[^}]*background:\s*linear-gradient\(180deg,rgba\(203,217,225,\.28\)/s,
    'Added sits in a restrained rectangular silver counter well');
  assert.match(cssSource, /\.craps-entry__progressive-meter\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center[^}]*border:\s*1px solid rgba\(222,174,65,\.8\)[^}]*border-radius:\s*\.16rem[^}]*background:\s*linear-gradient\(180deg,rgba\(226,177,68,\.25\)/s,
    'the Run It Up jackpot sits in the matching rectangular gold counter well');
  assert.doesNotMatch(cssSource, /\.craps-entry__(?:daily-added|progressive-meter)(?:::before)?\s*\{[^}]*clip-path:/s,
    'the counter wells have no pointed badge ends or nested plaque layer');
  assert.match(cssSource, /\.craps-entry__progressive-value\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s,
    'the right FLIP mark and number are vertically centered as one unit');
  assert.equal((componentSource.match(/class="craps-entry__flip-mark"/g) || []).length, 2,
    'both signboard numbers use the same FLIP mark');
  assert.match(componentSource, /class="craps-entry__progressive-value"><img class="craps-entry__flip-mark"[\s\S]*?<output data-bind="craps-progressive-amount"[^>]*>—<\/output><\/span>/);
  assert.match(cssSource, /\.craps-entry__daily-added > strong\s*\{[^}]*color:\s*#58d5ff/s,
    'Added is the blue half of the shared meter');
  assert.match(cssSource, /\.craps-entry__progressive-meter\s*\{[^}]*color:\s*#d69cff/s,
    'Run It Up keeps its purple number inside the gold plaque');
  assert.match(cssSource, /\.craps-entry__runup-kicker\s*\{[^}]*top:\s*\.31rem[^}]*left:\s*47%/s,
    'FEATURING THE stays lowered and shifted over UN IT');
  assert.doesNotMatch(componentSource, /data-bind="craps-entry-day"/);
  const wei = 10n ** 18n;
  assert.equal(crapsEntry.crapsHeaderBoostLabel(999n * wei), '999');
  assert.equal(crapsEntry.crapsHeaderBoostLabel(7_350n * wei), '7.35K');
  assert.equal(crapsEntry.crapsHeaderBoostLabel(18_000n * wei), '18K');
  assert.equal(crapsEntry.crapsHeaderJackpotLabel(1_500_000n * wei), '1,500,000',
    'Run It Up uses the whole amount while it fits its half of the header');
  assert.equal(crapsEntry.crapsHeaderJackpotLabel(1_500_000n * wei, 5), '1.5M',
    'an amount too wide for its rail still has a compact fallback');
  assert.deepEqual(crapsEntry.crapsHeaderAddedMetric({
    yesterdayTotalAddedWei: 40_000n * wei,
    yesterdayAverageAddedWei: 50_000n * wei,
  }), {
    actualWei: 40_000n * wei,
    averageWei: 50_000n * wei,
    valueWei: 50_000n * wei,
    showsYesterday: false,
    label: 'ADDED',
    period: 'PER DAY',
  });
  assert.equal(crapsEntry.crapsHeaderAddedMetric({
    yesterdayTotalAddedWei: 90_000n * wei,
    yesterdayAverageAddedWei: 50_000n * wei,
  }).period, 'YESTERDAY', 'an above-average completed day earns the headline');
  assert.deepEqual(crapsEntry.crapsHeaderAddedMetric({
    todayAverageAddedWei: 50_000n * wei,
  }), {
    actualWei: null,
    averageWei: 50_000n * wei,
    valueWei: 50_000n * wei,
    showsYesterday: false,
    label: 'ADDED',
    period: 'PER DAY',
  }, 'live can fall back to today\'s known funding when bounded history omits yesterday');
  assert.equal(crapsEntry.crapsHeaderAddedMetric(null, 50_000n * wei).valueWei, 50_000n * wei,
    'the independent funding read prevents a failed lobby scan from blanking Added');
});

test('a poker-lobby listing separates battle stakes from settled added FLIP', () => {
  assert.match(componentSource, /<table class="craps-entry__listing"/);
  assert.match(componentSource, /CLOSES IN<\/th><th class="craps-entry__wager">WAGER<\/th><th class="craps-entry__operator">\+<\/th><th class="craps-entry__battle-key">BATTLE<\/th><th><span class="craps-entry__buy-in-heading">BUY IN<boon-product-indicator product="craps" hidden><\/boon-product-indicator><\/span><\/th><th>ENTRANTS/,
    'open entries label the at-risk battle-pool contribution instead of calling it Added');
  assert.match(componentSource, /Wager \$\{dayEntry[^`]+FLIP plus \$\{dayBattle[^`]+FLIP to the battle pool\./s);
  assert.match(componentSource, /FLIP wager plus \$\{battlePrice\} FLIP to the battle pool\./,
    'entry accessibility copy preserves the same wager-plus-battle distinction');
  assert.doesNotMatch(componentSource, /<th[^>]*>GOAL<\/th>|data-bind="craps-(?:battle|full-day)-goal"/,
    'the retired Goal column is absent from the real launcher');
  assert.doesNotMatch(componentSource, /craps-battle-speed|craps-full-day-speed|<th>SPEED<\/th>/);
  assert.doesNotMatch(componentSource, /<small>FLIP<\/small>|craps-full-day-(?:entry|pot)-unit/,
    'the combined wager split has no repeated micro FLIP labels');
  assert.match(componentSource,
    /data-bind="craps-added-banner"[\s\S]*?<img class="craps-entry__flip-mark"[^>]*face\.svg[^>]*>[\s\S]*?<strong><output data-bind="craps-added-total"[^>]*>—<\/output><\/strong>[\s\S]*?<span class="craps-entry__added-key"><b data-bind="craps-added-label">ADDED<\/b><small data-bind="craps-added-period">PER DAY<\/small><\/span>/,
    'the FLIP mark leads the amount while the Added period owns the two-level key at right');
  assert.doesNotMatch(componentSource, /craps-entry__(?:daily-added|progressive-meter)[^`]*?<em>FLIP<\/em>/s,
    'the physical FLIP marks replace redundant text units in the signboard rail');
  assert.doesNotMatch(componentSource, /AVG ADDED|average added per day/,
    'the rail says only Added per day or Added yesterday');
  assert.match(componentSource, /readCrapsAddedPerDay\(day\)/,
    'a narrow funding query keeps the rail independent of the larger lobby snapshot');
  assert.match(componentSource, /import \* as crapsApi from '\.\.\/app\/craps\.js'/,
    'the newly-added funding reader is obtained through the module namespace');
  assert.match(componentSource, /CRAPS_COMPONENT_REVISION = new URL\(import\.meta\.url\)\.search/);
  assert.match(componentSource, /import\(CRAPS_ADDED_API_URL\)[\s\S]*?revisedReader\(day\)/,
    'a tab holding the prior craps.js generation loads the funding reader at the component revision');
  assert.match(componentSource,
    /bindText\('craps-added-total', addedReady\s*\? crapsHeaderBoostLabel\(addedMetric\.valueWei\)/,
    'the selected average-or-yesterday amount no longer carries a redundant plus sign');
  assert.match(componentSource, /including the daily Run It Up funding/,
    'the accessible headline makes the jackpot contribution explicit');
  assert.match(cssSource, /\.craps-entry__daily-added\s*\{[^}]*background:\s*linear-gradient\(180deg,rgba\(203,217,225,\.28\)[^}]*\}[\s\S]*?\.craps-entry__daily-added > strong\s*\{[^}]*color:\s*#58d5ff/s,
    'the daily addition keeps its blue readout inside the silver plaque');
  assert.match(cssSource, /@media \(min-width: 1100px\)[\s\S]*?\.craps-entry__head\s*\{[^}]*min-height:\s*5\.66rem[^}]*grid-template-rows:\s*minmax\(0,1fr\) 2\.02rem[^}]*\}[\s\S]*?\.craps-entry__daily-added > strong,body\.layout-basic \.craps-entry__progressive-meter\s*\{[^}]*font-size:\s*1\.15rem[^}]*\}[\s\S]*?\.craps-entry__added-key\s*\{[^}]*font-size:\s*\.46rem[^}]*line-height:\s*\.9[^}]*\}[\s\S]*?\.craps-entry__flip-mark\s*\{[^}]*width:\s*1\.5rem/s,
    'desktop gives Added Yesterday more rail height and line spacing without shrinking it');
  assert.equal((componentSource.match(/data-bind="craps-added-total"/g) || []).length, 1);
  assert.doesNotMatch(componentSource, /craps-battle-added/);
  assert.match(componentSource, /snapshot\?\.yesterdayTotalAddedWei/);
  assert.match(componentSource, /snapshot\?\.yesterdayAverageAddedWei/);
  assert.match(componentSource, /readCrapsLobbySnapshot\(day, player\)/);
  assert.match(componentSource, /data-bind="craps-battle-countdown"/);
  assert.match(componentSource, /crapsBattleCountdownLabel\(battle\.closeAtMs, nowMs\)/);
  assert.match(componentSource, /data-bind="craps-battle-entry"/);
  assert.match(componentSource, /data-bind="craps-battle-pot"/);
  assert.match(componentSource, /data-bind="craps-full-day-terms" colspan="3"[\s\S]*?data-bind="craps-full-day-entry">ROLLING<[\s\S]*?data-bind="craps-full-day-separator" hidden>\+<[\s\S]*?data-bind="craps-full-day-pot-cell" hidden/s,
    'the initial full-day terms occupy the WAGER + BATTLE span as one rolling state');
  assert.match(componentSource, /craps-entry__rolling-terms" colspan="3"><strong data-bind="craps-battle-entry">ROLLING<\/strong>[\s\S]*?craps-entry__operator craps-entry__open-cell" hidden>\+<[\s\S]*?craps-entry__battle-fee craps-entry__open-cell" hidden/s,
    'individual rows never flash an unexplained dash-plus-dash before the day word lands');
  assert.match(componentSource, /const dayRolling = !futureDay && !dayReady[\s\S]*?fullDayTerms\.colSpan = futureDay \|\| dayRolling \? 3 : 1[\s\S]*?fullDaySeparator\.hidden = futureDay \|\| dayRolling/s);
  assert.match(componentSource, /const rolling = !ready && !result[\s\S]*?termsCell\.colSpan = rolling \? 3 : 1[\s\S]*?entryPriceNode\.textContent = rolling \? 'ROLLING'/s,
    'resolved terms restore the normal wager and battle columns');
  assert.match(cssSource, /\.craps-entry__rolling-terms strong\s*\{[^}]*color:\s*#d8b4fe[^}]*letter-spacing:\s*\.08em/s);
  assert.match(componentSource, /data-bind="craps-day-countdown"/,
    'the full-day entry head carries the opener countdown');
  assert.doesNotMatch(componentSource, /'MIXED'/);
  assert.match(componentSource, /data-bind="craps-battle-winner"/);
  assert.match(componentSource, /data-bind="craps-battle-payout"/);
  assert.match(componentSource, /data-bind="craps-battle-boost"/);
  assert.match(componentSource,
    /data-bind="craps-results-head"[^>]*hidden>[\s\S]*?<span>WINNER<\/span><span>TOTAL WON<\/span><span>ADDED<\/span><span>BUY IN<\/span>[\s\S]*?<th scope="col">ENTRANTS<\/th>/,
    'settled rows get one shared header with Added as a real column');
  assert.match(componentSource,
    /class="craps-entry__result-total"><strong><output data-bind="craps-battle-payout">—<\/output><\/strong><\/span>[\s\S]*?class="craps-entry__result-added" data-bind="craps-battle-boost-detail"><strong><output data-bind="craps-battle-boost">—<\/output><\/strong><\/span>/,
    'each settled amount occupies its aligned column without an oval badge');
  assert.doesNotMatch(componentSource, /<small>(?:TOTAL WON|BUY IN)<\/small>|craps-entry__boost-mark/,
    'settled rows do not repeat the shared headings or revive the old boost pill');
  assert.doesNotMatch(componentSource, /\(<output[^>]*craps-(?:battle|previous-event)-boost[^>]*>—<\/output> BOOST\)/,
    'resolved contests do not spend row space spelling out BOOST in parentheses');
  assert.doesNotMatch(componentSource,
    /data-bind="craps-(?:battle|previous-event)-(?:payout|buyin)">—<\/output> FLIP/,
    'completed rows do not repeat the understood FLIP unit after the prize and buy-in');
  assert.doesNotMatch(componentSource, /<small>BOOSTED<\/small>/);
  assert.match(componentSource,
    /class="craps-entry__result-buyin"[\s\S]*?data-bind="craps-battle-buyin"[\s\S]*?<td class="craps-entry__entrants" data-bind="craps-battle-entrants"/,
    'the total buy-in sits at the result block’s right edge beside entrants');
  assert.match(componentSource, /paintCrapsAddedValue\([\s\S]*?laneResult && !concealed \? laneResult\.winnerBoostWei : null,\s*laneResult && !concealed \? laneResult\.progressivePaidWei : null/s,
    'the Added column follows the selected lane and receives its attributed progressive payout state');
  assert.match(componentSource, /crapsWinnerTotalLabel\(laneResult\)/,
    'the result shows the exact total or an explicit lower bound while attribution loads');
  assert.match(componentSource, /crapsWinnerResultForLane\(result, this\.#highRoller\)/,
    'the selected lane controls the completed-row winner and payment');
  assert.match(componentSource, /data-bind="craps-previous-event-row"/);
  assert.match(componentSource, /snapshot\?\.yesterdayEventResult/);
  assert.match(componentSource,
    /this\.#snapshot\?\.results\?\.\[CRAPS_BATTLES_PER_DAY - 1\][\s\S]*?this\.#previousEventResult = completedEvent/,
    'the completed event survives the day handoff while the fresh snapshot loads');
  assert.match(componentSource,
    /const previousEvent = crapsPreviousEventDuringRollover\(\{[\s\S]*?wordValue: currentWordFromStore\(state\.day\)/,
    'the prior-day row expires as soon as the current day word lands');
  assert.match(componentSource, /appendLobbyRow\(previousEventRow\)/,
    'the rollover-only prior-day result stays pinned beneath the reset current slate');
  assert.match(componentSource, /resultsHead\.hidden = false;[\s\S]*?body\.appendChild\(resultsHead\)/,
    'the shared results heading moves directly above the first completed row');
  assert.match(componentSource, /\.craps-entry__battle\[data-craps-period\]/,
    'the dedicated history row is not mistaken for one of the seven current battles');
  assert.match(componentSource,
    /new Map\([\s\S]*?Number\(row\.dataset\.crapsPeriod\)[\s\S]*?rowsByPeriod\.get\(period\)/,
    'urgency reordering cannot change a battle row\'s period identity on the next render');
  assert.match(componentSource,
    /this\.#scheduleDay != null && this\.#scheduleDay !== day[\s\S]*?this\.#boardBets = \{\};[\s\S]*?this\.#boardHistory = \[\];[\s\S]*?this\.#contractChips = 0;[\s\S]*?this\.#boardSet = false;/,
    'a new authoritative day clears the reusable custom board');
  assert.match(componentSource,
    /<td class="craps-entry__result"[^>]*colspan="5"[^>]*>[\s\S]*?<td class="craps-entry__entrants" data-bind="craps-battle-entrants">/,
    'completed rows retain their entrant count in the rightmost column');
  assert.doesNotMatch(componentSource,
    /class="craps-entry__entrants craps-entry__open-cell" data-bind="craps-battle-entrants"/,
    'entrant counts do not disappear when the open cells yield to a result');
  assert.match(componentSource, /row\.dataset\.state = result \? 'completed'/);
  assert.match(componentSource, /playerEntries/);
  assert.match(componentSource, /data-craps-upgrade/);
  assert.match(componentSource, /upgradeCrapsDayWindows/);
  assert.match(componentSource, /class="craps-entry__entered"/);
  assert.doesNotMatch(componentSource, /✓ ENTERED|✓ ENTERED ROWS/,
    'owned seats use plain status text rather than disabled button copy');
  assert.match(componentSource,
    /button\.dataset\.state === 'entered'[\s\S]*?this\.#openBoard\(button,[\s\S]*?button\.dataset\.state === 'amend'[\s\S]*?this\.#amend\(button\)/s,
    'ENTERED reopens that slip board while CHANGE BET submits its changed layout');
  assert.match(componentSource, /\? entryNeedsAmend \? 'CHANGE BET' : 'ENTERED'/,
    'a changed board promotes the individual battle action from ENTERED to CHANGE BET');
  assert.doesNotMatch(componentSource, /AMEND ENTRY|AMENDING…/,
    'internal amendment terminology is not exposed in the player-facing action');
  assert.match(componentSource, /amendCrapsSlip\(\{ betId, contractChips: this\.#contractChips \}\)/,
    'the amendment action uses the deployed amendSlip adapter');
  assert.match(componentSource,
    /const dayAmendOpen = dayTicket\?\.day > state\.day \|\| Boolean\(state\.battles\[0\]\?\.joinable\)/,
    'day-wide entries stop offering amendments once their first battle closes');
  assert.match(componentSource,
    /const amendOpen = entry\?\.source === 'day'[\s\S]*?Boolean\(state\.battles\[0\]\?\.joinable\)[\s\S]*?: battle\.joinable/,
    'day-wide and direct entries use their respective contract amendment windows');
  assert.match(componentSource, /`UPGRADE \$\{formatCrapsCompactFlip/);
  assert.match(componentSource,
    /dayUpgradeWhenOpen[\s\S]*?tomorrowUpgradeWhenOpen[\s\S]*?'UPGRADE WHEN OPEN'/,
    'Normal future reservations show the High Roller upgrade state instead of ENTERED');
  assert.match(componentSource, /`\$\{price == null \? '—' : formatCrapsCompactFlip\(price\)\} FLIP`/);
  assert.doesNotMatch(componentSource, /ENTER: (?:—|1 COMP|\$\{)/,
    'compact buy-in controls show only their price or comp payment');
  assert.match(componentSource,
    /class="craps-entry__lobby"[\s\S]*?<section class="craps-entry__betting"[\s\S]*?class="craps-entry__surface-strip"[\s\S]*?class="craps-entry__mini-felt"/s,
    'one coherent compact betting surface sits directly beneath the lobby');
  assert.doesNotMatch(componentSource, /craps-entry__foot|craps-entry__setup|YOUR BETTING BOARD|data-craps-board/,
    'the old footer, setup panel, and detached board opener are gone');
  assert.doesNotMatch(componentSource, /data-bind="craps-status"|craps-entry__status/,
    'quest routing and transaction feedback never inserts a red row into the widget');
  assert.match(componentSource,
    /targetDay = positiveDay\(detail\?\.crapsTargetDay\)[\s\S]*?detail\.crapsHandled = true;[\s\S]*?detail\.crapsPurchase = purchase;[\s\S]*?this\.#forceFlipDay = false/,
    'the paid day quest submits the exact unreserved slate and acknowledges its result to the quest sheet');
  assert.match(componentSource,
    /advancePastReserved[\s\S]*?error\?\.code === 'DayNotReservable'[\s\S]*?buildWager\(selection\.entryDay \+ 1\)/,
    'a stale reservation snapshot advances past a comp-owned day during preflight without making the player click twice');
  assert.match(componentSource,
    /crapsDayQuestPurchaseOptions\(\{[\s\S]*?playerEntries,[\s\S]*?\}\)/,
    'quest options account for days already reserved by paid entries or comps');
  assert.doesNotMatch(componentSource, /CRAPS DAY QUEST ·/,
    'the old focus-only red quest banner is gone');
  assert.doesNotMatch(componentSource, /Full slate before Battle 1 · or enter one battle\./,
    'the old full-slate helper is gone');
  assert.doesNotMatch(componentSource, /Comp window closed · FLIP entry remains open\./,
    'an expired comp does not add a second idle helper above the permanent pick instruction');
  assert.doesNotMatch(componentSource, /Today live · reserve the next slate\./,
    'the compact lane-and-bonus bar is the only routine bottom-row guidance');
  assert.doesNotMatch(componentSource, /comp reserves the next slate/,
    'the selected comp is already visible on the control and needs no idle explainer');
  assert.match(componentSource,
    /class="craps-entry__surface-strip"[\s\S]*?data-bind="craps-random-count">10<\/output>[\s\S]*?data-bind="craps-hot-shooter-chance">15<\/output>%[\s\S]*?HOT SHOOTER BONUS[\s\S]*?data-craps-lane="normal"[\s\S]*?data-craps-lane="high"/s,
    'the random equation and right-side Normal/High Roller selector share one thin strip');
  assert.match(componentSource, /<strong class="craps-entry__place-prompt"[^>]*aria-live="polite"[^>]*><span data-craps-place-prompt="top">PLACE<\/span><span data-craps-place-prompt="bottom">YOUR BETS<\/span><\/strong>\s*<div class="craps-entry__lane"/,
    'the readable two-line betting callout owns the middle section before the lane selector');
  assert.match(cssSource, /\.craps-entry__surface-strip\s*\{[^}]*grid-template-columns:\s*minmax\(0,1\.35fr\) minmax\(3\.2rem,\.34fr\) minmax\(6\.7rem,\.92fr\)/s);
  assert.match(cssSource, /\.craps-entry__place-prompt\s*\{[^}]*color:\s*#ff8588[^}]*font-size:\s*\.39rem/s,
    'the center callout is red and large enough to read');
  assert.match(componentSource,
    /class="craps-entry__lane"[^>]*role="group"[\s\S]*?data-craps-lane="normal"[\s\S]*?data-craps-lane="high"/,
    'Low Stakes and High Roller remain one mutually exclusive control');
  assert.match(componentSource, /data-craps-lane="normal"[^>]*>[\s\S]*?<span>LOW<br>STAKES<\/span>/,
    'the standard lane uses the approved Low Stakes label');
  assert.match(componentSource, /data-craps-lane="high"[^>]*>[\s\S]*?<span>HIGH<br>ROLLER<\/span>/,
    'both lane labels use the larger two-line treatment');
  assert.match(cssSource, /\.craps-entry__lane button > span\s*\{[^}]*font-size:\s*0\.44rem[^}]*line-height:\s*0\.88/s,
    'the stacked lane copy is larger without increasing the header height');
  assert.doesNotMatch(componentSource, /data-craps-lane="normal"[^>]*>[\s\S]*?<span>NORMAL<\/span>/,
    'the retired Normal label is not rendered in the lane selector');
  assert.match(cssSource,
    /\.craps-entry__lane\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)[^}]*overflow:\s*hidden[^}]*border:[^}]*border-radius:\s*4px/s,
    'the lane selector uses one shared segmented housing');
  assert.match(cssSource, /\.craps-entry__lane button \+ button\s*\{[^}]*border-left:/s,
    'one internal divider separates the two lane segments');
  assert.match(cssSource, /Approved Craps entry felt:[\s\S]*?\.craps-entry__surface-strip\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/s,
    'the approved felt header shares the wager grid’s six exact column guides');
  assert.match(cssSource, /\.craps-entry__surface-strip::before\s*\{[^}]*inset:\s*0 33\.333% 0 0[^}]*background:\s*linear-gradient\(180deg, rgba\(1, 46, 29, 0\.86\), rgba\(0, 24, 15, 0\.78\)\)/s,
    'one continuous dark-green strip backs the Random bonus and Place Your Bets copy');
  assert.match(cssSource, /\.craps-entry__betting\s*\{[^}]*community-coinflip-felt-v6\.webp[^}]*center top \/ cover no-repeat/s,
    'the Craps board reuses the production Community Coinflip felt instead of approximating its cloth');
  assert.match(cssSource, /\.craps-entry__lobby\s*\{[^}]*border-radius:\s*0/s,
    'the combined entry-options and results table has square corners throughout');
  assert.match(cssSource, /Approved Craps entry felt:[\s\S]*?\.craps-entry__betting\s*\{[^}]*border-radius:\s*0 0 4px 4px/s,
    'the felt starts with square top corners and keeps its lower outer corners rounded');
  assert.match(cssSource, /\[data-craps-lane="normal"\]\[aria-pressed="true"\]\s*\{[^}]*background:\s*linear-gradient\(180deg, #f2f3f3, #aeb4b7\)/s,
    'selected Low Stakes uses the silver state');
  assert.match(cssSource, /\[data-craps-lane="high"\]\[aria-pressed="true"\]\s*\{[^}]*background:\s*linear-gradient\(180deg, #f8d56c, #c98b18\)/s,
    'selected High Roller uses the gold state');
  assert.match(cssSource, /@media \(min-width: 1100px\)[\s\S]*?\.craps-entry__betting\s*\{[^}]*flex:\s*1 1 auto[^}]*grid-template-rows:\s*auto minmax\(0,1fr\)[^}]*\}[\s\S]*?\.craps-entry__surface-strip\s*\{[^}]*grid-row:\s*1[^}]*\}[\s\S]*?\.craps-entry__mini-felt\s*\{[^}]*grid-row:\s*2[^}]*grid-template-rows:\s*minmax\(2\.35rem,1\.35fr\) minmax\(1\.74rem,1fr\)/s,
    'the desktop betting felt, rather than the lobby, consumes the neighboring widgets’ extra height');
  assert.match(cssSource, /@media \(min-width: 1100px\)[\s\S]*?\.craps-entry__listing tbody :is\(th,td\)\s*\{[^}]*font-size:\s*\.57rem[^}]*\}[\s\S]*?\.craps-entry__money strong\s*\{[^}]*font-size:\s*\.6rem/s,
    'desktop lobby copy steps up when the full three-column row has room');
  assert.equal((componentSource.match(/data-craps-bet="(?:place-[45689]|place-10|hard-[48]|pass|dont-pass)"/g) || []).length, 10,
    'the felt exposes all ten supported contract betting spots as large tap targets');
  assert.match(componentSource,
    /data-craps-bet="pass"[\s\S]*?data-craps-how-to-play[\s\S]*?data-craps-bet="hard-8"/,
    'the rules spot occupies the half of the old double-width Pass cell that was freed');
  assert.doesNotMatch(componentSource, /craps-entry__how-icon/,
    'How To Play is text-only rather than another info-icon button');
  assert.match(componentSource,
    /\[data-craps-how-to-play\][\s\S]*?new CustomEvent\('craps-rules:open',[\s\S]*?detail: \{ trigger: howToPlay \}/,
    'the inline rules spot asks the shared rules popup to open and identifies its focus return target');
  assert.match(cssSource,
    /\[data-craps-bet="pass"\]\s*\{\s*grid-column:\s*2;\s*\}[\s\S]*?\[data-craps-how-to-play\]\s*\{\s*grid-column:\s*3;/,
    'Pass and How To Play each occupy one of the six equal lower-row spots');
  assert.match(componentSource, /dice_01_2_silver\.svg[\s\S]*?dice_01_2_blue\.svg[\s\S]*?HARD <b>4<\/b>/,
    'Hard 4 carries bare silver and blue dice faces');
  assert.match(componentSource, /dice_03_4_silver\.svg[\s\S]*?dice_03_4_blue\.svg[\s\S]*?HARD <b>8<\/b>/,
    'Hard 8 carries bare silver and blue dice faces');
  assert.equal((componentSource.match(/data-craps-random-stack="(?:left|right)" src="\/shared\/flip-chips\/stack-5-high-red\.svg"/g) || []).length, 2,
    'RANDOM begins as two clipping-safe stacks of five');
  assert.match(cssSource, /\.craps-entry__bet-spot\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*0;/s,
    'global mobile button sizing cannot overflow or clip a felt cell');
  assert.match(cssSource, /\.craps-entry__bet-label\s*\{[^}]*font:\s*1000 1\.24rem\/1/s,
    'the six place numbers use the larger felt-scale type');
  assert.match(cssSource, /\.craps-entry__pays\s*\{[^}]*font:\s*1000 \.39rem\/1/s,
    'place odds remain readable beneath the larger numbers');
  assert.match(cssSource, /\[data-craps-bet="pass"\] \.craps-entry__bet-label\s*\{[^}]*left:\s*50%[^}]*font-size:\s*\.68rem/s);
  assert.match(cssSource, /\.craps-entry__how-to-play\s*\{[^}]*border-color:[^}]*background:[^}]*!important/s,
    'the rules control reads as a distinct but coherent felt spot');
  assert.match(cssSource, /\.craps-entry__bet-spot--hard \.craps-entry__bet-label b\s*\{[^}]*font-size:\s*\.76rem/s,
    'the compact lower row scales its most important labels too');
  assert.match(cssSource, /@media \(max-width: 768px\)[^{]*\{[^}]*\.craps-entry__mini-felt\s*\{[^}]*grid-template-rows:\s*2\.75rem 2\.5rem/s,
    'narrow screens enlarge both whole-cell tap targets without resizing the chip artwork');
  assert.match(cssSource, /\.craps-entry__betting\s*\{[^}]*community-coinflip-felt-v6\.webp[^}]*#06351f/s,
    'one rich green felt texture spans the complete wager table');
  assert.match(cssSource, /\.craps-entry__mini-felt\s*\{[^}]*background:\s*transparent/s,
    'the board cells do not lay a second disconnected felt panel over that table');
  assert.match(componentSource, /CRAPS_ENTRY_MAX_CHIPS_PER_BET = 3/);
  assert.match(componentSource, /CRAPS_ENTRY_MAX_PLACED_CHIPS = 7/);
  assert.match(componentSource, /const clearedFullSpot = current >= CRAPS_ENTRY_MAX_CHIPS_PER_BET;\s*const nextCount = crapsEntryNextSpotCount\(current\);\s*if \(nextCount === 0\) \{\s*delete next\[field\];\s*this\.#boardHistory = this\.#boardHistory\.filter\(\(placedField\) => placedField !== field\);/,
    'a fourth click clears all three chips from that spot and removes them from placement history');
  assert.match(componentSource, /if \(!clearedFullSpot\) this\.#resetPlacePrompt\(\);[\s\S]*?this\.#render\(\);\s*if \(clearedFullSpot\) this\.#flashPlacePrompt\('MAX 3', 'PER SLOT'\);/,
    'clearing a full spot briefly explains the per-slot cap after removing its chips');
  assert.match(componentSource, /if \(crapsEntryBoardSummary\(next\)\.placed >= CRAPS_ENTRY_MAX_PLACED_CHIPS\) \{\s*this\.#flashPlacePrompt\('MINIMUM 3', 'RANDOM'\);/,
    'an eighth placement attempt briefly explains the three-Random floor');
  assert.match(componentSource, /CRAPS_ENTRY_LIMIT_PROMPT_MS = 1_200[\s\S]*?#flashPlacePrompt\(top, bottom\)[\s\S]*?this\.#paintPlacePrompt\('PLACE', 'YOUR BETS', 'Place your bets'\);\s*}, CRAPS_ENTRY_LIMIT_PROMPT_MS\)/,
    'limit feedback restores the default prompt after a short delay');
  assert.match(componentSource, /Three chips on this spot\. Tap to clear all three\./,
    'full spots explain that the next click clears the complete stack');
  assert.match(componentSource, /Three chips must remain random\. Tap Random to reclaim the last placed chip\./,
    'capped spots expose the same reason to touch and assistive users');
  assert.match(componentSource, /#cycleInlineBet\(betSpot\.dataset\.crapsBet\)/);
  assert.match(componentSource, /#reclaimInlineBet\(\)/);
  assert.match(componentSource, /this\.#contractChips = packCrapsEntryBoard\(next\)/,
    'inline picks feed the existing buy and amend calldata');
  assert.doesNotMatch(componentSource, />\s*(?:UNDO|CLEAR)\s*</,
    'the tiny surface carries no redundant undo or clear controls');
  assert.match(componentSource, /CRAPS_FUTURE_DAY_PRICES/);
  assert.match(componentSource, /readCrapsPassCredits/);
  assert.match(componentSource, /applyCrapsPasses/);
  assert.match(componentSource,
    /const totalsRead = readCrapsWinnerTotals\(day\)\.then\([\s\S]*?await readCrapsLobbySnapshot\(day, player\),\s*this\.#winnerTotals[\s\S]*?void totalsRead\.then/,
    'the exact indexer total paints asynchronously after the chain snapshot');
  assert.match(componentSource,
    /!read\.ok[\s\S]*?this\.#winnerTotals = read\.totals/,
    'a transient indexer outage retains the last immutable exact totals');
  assert.doesNotMatch(componentSource,
    /Promise\.allSettled\(\[[\s\S]*?readCrapsWinnerTotals/,
    'an unavailable indexer cannot hold transaction-critical chain reads behind an API timeout');
  assert.doesNotMatch(componentSource,
    /Promise\.allSettled\(\[\s*readCrapsLobbySnapshot[\s\S]*?readCrapsPassCredits/,
    'a wallet pass read cannot hold public battle results on SETTLING');
  assert.match(componentSource,
    /document\?\.hidden !== true[\s\S]*?#refreshSchedule\(true\)/,
    'foregrounding the lobby forces a fresh result snapshot after timer throttling');
  assert.match(componentSource, /\? '1 COMP'/);
  assert.match(componentSource, /Craps comp/);
  assert.doesNotMatch(componentSource, /DAY PASS|1 PASS|Craps passes|Craps pass balance|pass will reserve/,
    'free Craps days are consistently presented as comps');
  assert.match(componentSource, /class="craps-entry__pass-count" data-bind="craps-normal-passes"/);
  assert.match(componentSource, /class="craps-entry__pass-count" data-bind="craps-high-passes"/);
  assert.doesNotMatch(componentSource, /YOUR PASSES|craps-pass-wallet|craps-high-mult|TODAY \$\{terms\.highMult\}×/);
  assert.match(componentSource, /data-bind="craps-tomorrow-row"/);
  assert.doesNotMatch(componentSource, />TOMORROW<\/strong>/,
    'future slate rows use an exact rollover clock instead of a vague day label');
  assert.match(componentSource, /<th scope="row"><time data-bind="craps-tomorrow-countdown">—<\/time><\/th>/,
    'the second future-slate row uses the same countdown treatment');
  assert.match(componentSource, /CRAPS_FUTURE_DAY_FACE_RANGES/);
  // The next word has not been drawn, so one spanned cell carries the combined
  // cost with its seven-battle scope on the same line.
  assert.match(componentSource,
    /data-bind="craps-tomorrow-terms" colspan="3"><span class="craps-entry__tomorrow-layout"><strong data-bind="craps-tomorrow-range">[^<]+<\/strong><small>7 BATTLES<\/small><\/span>/,
    'the rollover row puts seven battles to the right of its combined cost');
  assert.match(componentSource, /craps-tomorrow-range', compactRange\(futureFaceRange\)/,
    'the rendered range is the combined low..high, never the split sub-ranges');
  assert.match(componentSource, /const compactRange = \(range\) => `\$\{formatCrapsCompactFlip\(range\.low\)\} – \$\{formatCrapsCompactFlip\(range\.high\)\}`/,
    'the cost range gives the dash breathing room on both sides');
  assert.match(cssSource, /\.craps-entry__tomorrow-range \.craps-entry__tomorrow-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\) max-content[^}]*column-gap:\s*\.12rem;[^}]*padding:\s*0 \.18rem 0 \.06rem/s,
    'the future-day scope keeps its full width and a safe gutter before BUY IN');
  assert.match(cssSource, /\.craps-entry__tomorrow-range small\s*\{[^}]*min-width:\s*max-content/s,
    '7 BATTLES cannot shrink underneath the adjacent buy button');
  assert.match(cssSource, /\.craps-entry__tomorrow-range strong\s*\{[^}]*text-align:\s*center/s,
    'the future-day cost centers beneath WAGER + BATTLE');
  assert.match(cssSource, /\.craps-entry__tomorrow-range small\s*\{[^}]*text-align:\s*center/s,
    'seven battles remains legible inside the combined term cell');
  assert.doesNotMatch(componentSource, /craps-tomorrow-wager|craps-tomorrow-battle/,
    'the split per-column tomorrow ranges are gone');
  assert.match(componentSource, /fullDayHead\.colSpan = 1/,
    'the rollover clock stays in the normal CLOSES IN column');
  assert.match(componentSource, /fullDayTerms\.colSpan = futureDay \|\| dayRolling \? 3 : 1/,
    'the future range and opening roll consume the freed term columns');
  assert.doesNotMatch(componentSource, /NEXT SLATE/);
  assert.match(componentSource, /data-bind="craps-battle-entrants"/);
  assert.match(componentSource, /data-bind="craps-previous-event-entrants"/);
  assert.match(componentSource, /data-bind="craps-previous-event-row"[\s\S]*?colspan="5"[\s\S]*?data-bind="craps-previous-event-entrants"/,
    'the previous event keeps the same result and Entrants columns as every completed battle');
  assert.match(componentSource, /data-bind="craps-battle-result-locked"/);
  assert.match(componentSource, /data-bind="craps-previous-event-result-locked"/);
  assert.match(componentSource, /snapshot\?\.entrants\?\.windows/);
  assert.match(componentSource, /snapshot\?\.entrants\?\.highDays/);
  assert.match(componentSource, /crapsEntrantCountForLane\(field, this\.#highRoller\)/,
    'the lane selector controls each battle entrant count');
  assert.match(componentSource, /mainPotStakeWei/);
  assert.match(componentSource, /buyFutureCrapsDays/);
  assert.doesNotMatch(componentSource, /DEEP/);
  assert.match(cssSource, /\.craps-entry\s*\{[^}]*min-height:\s*0/s);
  assert.match(cssSource, /\.craps-entry__listing\s*\{/);
  assert.match(cssSource, /\.craps-entry__col-wager\s*\{[^}]*width:\s*16%/s);
  assert.match(cssSource, /\.craps-entry__col-operator\s*\{[^}]*width:\s*3%/s);
  assert.match(cssSource, /\.craps-entry__col-battle\s*\{[^}]*width:\s*17%/s);
  assert.match(cssSource, /\.craps-entry__col-action\s*\{[^}]*width:\s*29%/s);
  assert.match(cssSource, /\.craps-entry__col-entrants\s*\{[^}]*width:\s*18%/s);
  assert.match(cssSource, /\.craps-entry__entrants\s*\{[^}]*text-align:\s*center/s);
  assert.match(cssSource, /\.craps-entry__pass-count\s*\{[^}]*border-radius:\s*999px/s);
  assert.match(cssSource, /\.craps-entry__action > button\s*\{[^}]*width:\s*min\(100%,5\.2rem\)[^}]*height:\s*\.94rem[^}]*background:\s*linear-gradient\(180deg,#f5c842,#b8790a\)[^}]*font-size:\s*\.43rem/s,
    'buy-in buttons remain compact yellow controls with readable type');
  assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*?\.craps-entry__action > button,[\s\S]*?\.craps-entry__entered\s*\{[^}]*height:\s*2\.25rem[^}]*min-height:\s*2\.25rem[^}]*font-size:\s*0\.62rem[^}]*line-height:\s*1/s,
    'mobile buy-in controls override the generic 44px rule with denser buttons and larger labels');
  assert.doesNotMatch(cssSource, /button\[data-state="pass"\]\s*\{[^}]*(?:#168a4b|#0d5a32)/s,
    'pass-funded purchases retain the yellow buy-in treatment');
  assert.match(cssSource, /button\[data-state="pass"\]\s*\{[^}]*word-spacing:\s*\.12rem/s,
    'the comp button keeps visible space between its number and label');
  assert.match(cssSource, /\.craps-entry__day-buy \.craps-entry__money strong\s*\{[^}]*color:\s*#f8fafc/s,
    'the day price stays white in every payment state');
  assert.match(cssSource, /\.craps-entry__day-buy\[data-payment="pass"\] \.craps-entry__money strong\s*\{[^}]*color:\s*#f8fafc/s,
    'a comp-funded day keeps its price white instead of borrowing the win green');
  assert.match(cssSource, /\.craps-entry__listing tbody :is\(th,td\)[^{]*\{[^}]*font-size:\s*\.53rem/s,
    'the dense lobby keeps its larger readable body type');
  assert.match(cssSource, /\.craps-entry__result\s*\{/);
  assert.match(cssSource, /:is\(\.craps-entry__result-grid,\.craps-entry__results-head-grid\)\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,1\.25fr\) minmax\(0,1fr\) minmax\(0,\.72fr\) minmax\(0,\.7fr\) 1\.02rem/s,
    'the shared header and settled rows use exactly the same five tracks');
  assert.match(cssSource, /\.craps-entry__results-head\s*\{[^}]*height:\s*\.78rem/s);
  assert.doesNotMatch(cssSource, /\.craps-entry__boost-mark/,
    'the old oval boost badge is fully removed');
  assert.match(cssSource, /\.craps-entry__result-total strong\s*\{[^}]*color:\s*#86efac/s,
    'the total-won amount keeps the green win color');
  assert.match(cssSource, /\.craps-entry__result-added\[data-state="ready"\] strong\s*\{[^}]*color:\s*#58d5ff/s,
    'ordinary Added winnings match the blue amount in the top Added display');
  assert.match(cssSource, /\.craps-entry__result-added\[data-state="ready"\]\[data-tone="progressive"\] strong\s*\{[^}]*color:\s*#d69cff/s,
    'an attributed progressive hit switches only that Added amount to purple');
  assert.match(cssSource, /\.craps-entry__daily-added\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*white-space:\s*nowrap/s,
    'daily Added uses the available width for its amount, unit, and stacked period key');
  assert.match(cssSource, /\.craps-entry__result small\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    'the compact battle/day row labels cannot spill into adjacent columns');
  assert.doesNotMatch(componentSource, /craps-battle-winner-label|winnerLabel\.textContent = `BATTLE/,
    'resolved rows do not repeat their battle numbers beneath the shared WINNER heading');
  assert.match(componentSource, /`DAY \$\{previousEvent\.day\} EVENT`/,
    'the previous-event row label stays concise beneath the shared heading');
  assert.doesNotMatch(cssSource, /\.craps-entry__result:not\(\[hidden\]\)\s*\{[^}]*display:\s*grid/s);
  assert.match(cssSource, /data-state="completed"/);
  assert.match(cssSource, /data-state="completed"[^}]*--craps-winner-accent:\s*#8b949e/s,
    'completed winner rows use one neutral result state without reviving Goal');
  assert.doesNotMatch(cssSource, /data-goal-result/);
  assert.match(cssSource, /data-state="entered"/);
  assert.match(cssSource, /button\[data-state="amend"\]\s*\{[^}]*background:\s*linear-gradient\(180deg, rgba\(22, 101, 52, 0\.88\), rgba\(20, 83, 45, 0\.82\)\)[^}]*color:\s*#dcfce7/s,
    'CHANGE BET retains the green owned-entry button treatment');
  assert.match(cssSource, /data-state="upgrade"/);
  assert.match(cssSource, /shopping-cart-cursor\.svg/);
});

test('owned finalized battles publish durable Pending replays through the shared table', () => {
  assert.match(componentSource, /publishPendingActions/);
  assert.match(componentSource, /clearPendingActions/);
  assert.match(componentSource, /openCrapsReplayTable/);
  assert.match(componentSource, /settledMainPotWei:\s*replay\.potWei/,
    'the finalized chain pot backfills prize totals missing from older sealed bundles');
  assert.match(componentSource, /battleWinner:\s*replay\.winner[\s\S]*?battleWinnerBetId:\s*replay\.winnerBetId[\s\S]*?battlePayoutWei:\s*replay\.amountWei[\s\S]*?battleWinningStop:\s*replay\.winningStop/s,
    'the paid winner seat, exact payout, and win route reach the replay presentation');
  assert.match(componentSource, /bonusMultiplier:\s*replay\.bonusMultiplier/,
    'the settlement-word multiplier reaches the opening battle reveal');
  assert.match(componentSource,
    /highRollerBetIds:\s*replay\.highRollerBetIds[\s\S]*?highRollerEntrants:\s*replay\.highRollerEntrants[\s\S]*?highWinnerBetId:\s*replay\.highWinnerBetId/,
    'an owned High Roller replay carries its exact side field and winner into the staged reveal');
  assert.match(componentSource, /snapshot\?\.resolvedReplays/);
  assert.match(componentSource, /kind:\s*'craps'/);
  assert.match(componentSource, /autoOpen:\s*false/);
  assert.match(componentSource, /onResolutionAcknowledged/);
  assert.match(componentSource, /craps-resolution-seen/);
});

test('Pending replay rows stay waiting until sealed data is ready and exclude seen receipts', async () => {
  const address = '0xAB12000000000000000000000000000000000000';
  const battleKey = `0x${'ab'.repeat(32)}`;
  const viewerBetId = '6234999496913828446217';
  const replay = {
    day: 42,
    period: 1,
    slot: '338',
    battleKey,
    viewerBetId,
    buyInWei: (500n * 10n ** 18n).toString(),
    battleStakeWei: (200n * 10n ** 18n).toString(),
    winner: address.toLowerCase(),
    amountWei: (12_300n * 10n ** 18n).toString(),
  };
  const identity = replayIdentity(battleKey, viewerBetId);
  const runs = [];
  let clears = 0;

  const waiting = crapsEntry.crapsResolutionPendingActions({ address, replays: [replay] });
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].state, 'waiting');
  assert.equal(waiting[0].pinned, true);
  assert.equal(waiting[0].run, null);
  assert.equal(waiting[0].autoOpen, false);
  assert.equal(waiting[0].dismissScope, address.toLowerCase());
  assert.equal(waiting[0].compact, true);
  assert.equal(waiting[0].label, '500 FLIP\nBATTLE');
  assert.equal(waiting[0].icon, '/badges-circular/dice_04_5_silver.svg');
  assert.equal(waiting[0].iconBack, '/badges-circular/dice_01_2_blue.svg');

  const highWaiting = crapsEntry.crapsResolutionPendingActions({
    address,
    replays: [{ ...replay, entryMultiple: 10 }],
  });
  assert.equal(highWaiting[0].label, '5,000 FLIP\nBATTLE',
    'a High Roller Pending card shows the full multiplied buy-in');

  const unknownBuyIn = crapsEntry.crapsResolutionPendingActions({
    address,
    replays: [{ ...replay, buyInWei: null }],
  });
  assert.equal(unknownBuyIn[0].label, '— FLIP\nBATTLE',
    'missing buy-in data is never misrepresented as a zero-cost battle');

  const armed = crapsEntry.crapsResolutionPendingActions({
    address,
    replays: [{ ...replay, finalized: false }],
  });
  assert.equal(armed[0].shortLabel, 'Waiting to settle');
  assert.equal(armed[0].detail, 'Waiting to settle.');
  assert.equal(armed[0].run, null,
    'an armed field is acknowledged in Pending but cannot open before final replay data exists');

  const ready = crapsEntry.crapsResolutionPendingActions({
    address,
    replays: [replay],
    states: new Map([[identity, { ready: true, status: 'ready' }]]),
    run: async (row, scope) => { runs.push([row.viewerBetId, scope]); return true; },
    clearAll: () => { clears += 1; },
  });
  assert.equal(ready[0].state, 'ready');
  assert.equal(ready[0].shortLabel, 'Craps battle');
  assert.equal(ready[0].detail,
    'Battle settled. Open the replay to reveal your result and final rewards.');
  assert.doesNotMatch(ready[0].detail, /won|12\.3K|0xab12/i,
    'the Pending row must not disclose the outcome before the replay opens');
  assert.equal(await ready[0].run(), true);
  assert.deepEqual(runs, [[viewerBetId, address.toLowerCase()]]);
  ready[0].clearAll();
  assert.equal(clears, 1, 'CLEAR acknowledges the sealed result without opening it');

  const seen = crapsEntry.crapsResolutionPendingActions({
    address,
    replays: [replay],
    states: new Map([[identity, { ready: true }]]),
    wasSeen: () => true,
  });
  assert.deepEqual(seen, []);
  assert.match(crapsEntry.crapsResolutionSeenKey(address, battleKey, viewerBetId),
    new RegExp(`${CHAIN.id}:${CONTRACTS.CRAPS.toLowerCase()}:${address.toLowerCase()}:${battleKey}:${viewerBetId}$`));
  assert.notEqual(
    crapsEntry.crapsResolutionSeenKey(address, battleKey, viewerBetId),
    crapsEntry.crapsResolutionSeenKey(
      address,
      battleKey,
      viewerBetId,
      CHAIN.id,
      `0x${'ef'.repeat(20)}`,
    ),
    'a repeated battle and seat identity cannot inherit another deployment\'s acknowledgement',
  );
});

test('replay publication copy covers every pointer state without leaking failure codes', () => {
  const pointer = { entrants: 12_345, resolved: 0, error: 'replay-mismatch' };
  assert.equal(crapsEntry.crapsReplayStatusCopy({ status: 'pending', pointer }),
    'Waiting to settle · 12,345 entrants.');
  assert.equal(crapsEntry.crapsReplayStatusCopy({
    status: 'settling', pointer: { ...pointer, resolved: 8_765 },
  }), 'Settling · 8,765 of 12,345 resolved.');
  assert.equal(crapsEntry.crapsReplayStatusCopy({ status: 'failed', pointer }),
    'Replay unavailable.');
  assert.equal(crapsEntry.crapsReplayStatusCopy({ status: 'build-unavailable' }),
    'Replay unavailable for this build.');
  assert.doesNotMatch(crapsEntry.crapsReplayStatusCopy({ status: 'failed', pointer }),
    /replay-mismatch/);

  assert.equal(crapsEntry.crapsReplayLoaderState({ ready: false, pointer: {
    status: 'settling', entrants: 12_345, resolved: 8_765,
  } }).status, 'settling');
  assert.equal(crapsEntry.crapsReplayLoaderState({ ready: false, pointer: {
    status: 'failed', error: 'replay-mismatch',
  } }).status, 'failed');

  const failedRow = crapsEntry.crapsResolutionPendingActions({
    address: '0xab12000000000000000000000000000000000000',
    replays: [{ day: 42, period: 0, slot: '337', battleKey: 'battle', viewerBetId: '1' }],
    states: new Map([[replayIdentity('battle', '1'), { ready: false, status: 'failed', pointer }]]),
  })[0];
  assert.equal(failedRow.passive, true, 'terminal failures are plain status, not a WAITING action');
  assert.equal(failedRow.run, null);
});

test('replay polling is one-second jittered, visibility-aware, and stops on terminal states', () => {
  assert.equal(crapsEntry.crapsReplayPollDelay(0), 850);
  assert.equal(crapsEntry.crapsReplayPollDelay(0.5), 1000);
  assert.equal(crapsEntry.crapsReplayPollDelay(1), 1150);
  // The hot window keeps its sub-second cadence, then doubles away from the
  // edge boundary so an unbuilt pointer cannot hold a 1 Hz 404 loop open.
  assert.equal(crapsEntry.crapsReplayPollDelay(0.5, 10), 1000,
    'the tenth attempt is still inside the builder hot window');
  assert.equal(crapsEntry.crapsReplayPollDelay(0.5, 11), 2000);
  assert.equal(crapsEntry.crapsReplayPollDelay(0.5, 13), 8000);
  assert.equal(crapsEntry.crapsReplayPollDelay(0.5, 60), 30_000,
    'backoff is capped, and a long outage never stops retrying entirely');
  assert.equal(crapsEntry.crapsReplayFailureStatus({ name: 'CrapsReplayDriftError' }),
    'build-unavailable');
  assert.equal(crapsEntry.crapsReplayFailureStatus({
    name: 'CrapsReplayValidationError', path: 'manifest.ruleset.engineVersion',
  }), 'build-unavailable');
  assert.equal(crapsEntry.crapsReplayFailureStatus(new Error('HTTP 503')), 'retrying');
  assert.equal(crapsEntry.crapsReplayFailureStatus({
    name: 'CrapsReplayLegacyDeploymentMismatchError',
  }), 'retrying', 'a rollout-era legacy pointer collision keeps polling for its scoped replacement');

  assert.match(componentSource, /document\?\.addEventListener\?\.\('visibilitychange'/);
  assert.match(componentSource, /document\?\.hidden === true/);
  assert.match(componentSource, /navigator\?\.onLine === false/);
  assert.match(componentSource, /CRAPS_REPLAY_TERMINAL_STATES = new Set\(\['ready', 'failed', 'build-unavailable'\]\)/);
  assert.match(componentSource,
    /#scheduleReplayPoll\(\)[\s\S]*?crapsReplayPollDelay\(Math\.random\(\), this\.#replayPollAttempts\(\)\)/s);
  assert.match(componentSource, /#replayPollAttempts\(\)[\s\S]*?attempts < lowest/s,
    'the scheduler paces off the battle that has been waiting the least');
});

test('caught replay failures emit privacy-safe diagnostics from every open path', () => {
  const rawAddress = '0xab12000000000000000000000000000000000000';
  const rawBetId = '4537899042132549697537';
  const diagnostic = crapsEntry.crapsReplayDiagnostic({
    name: 'CrapsReplayValidationError',
    path: `collection.players.${rawBetId}`,
    message: `Craps replay ${rawBetId} for ${rawAddress} failed at https://example.invalid/private`,
  }, 'pending-open');
  assert.equal(diagnostic.kind, 'error');
  assert.equal(diagnostic.data.src, 'craps-replay:pending-open');
  assert.match(diagnostic.data.m, /CrapsReplayValidationError/);
  assert.doesNotMatch(diagnostic.data.m, new RegExp(rawAddress, 'i'));
  assert.doesNotMatch(diagnostic.data.m, new RegExp(rawBetId));
  assert.doesNotMatch(diagnostic.data.m, /example\.invalid/);

  const previousQueue = globalThis.__telemetryQ;
  const queue = [];
  globalThis.__telemetryQ = queue;
  try {
    crapsEntry.reportCrapsReplayFailure(new TypeError('Craps replay board is invalid'), 'winner-open');
    assert.equal(queue.length, 1);
    assert.equal(queue[0].data.src, 'craps-replay:winner-open');
  } finally {
    if (previousQueue === undefined) delete globalThis.__telemetryQ;
    else globalThis.__telemetryQ = previousQueue;
  }

  assert.match(componentSource, /reportCrapsReplayFailure\(error, 'preload'\)/);
  assert.match(componentSource, /reportCrapsReplayFailure\(error, 'winner-open'\)/);
  assert.match(componentSource, /reportCrapsReplayFailure\(error, 'pending-open'\)/);
  assert.match(componentSource, /onReplayDegraded: \(error\) => reportCrapsReplayFailure\(error, 'side-lane'\)/);
  assert.match(componentSource,
    /if \(!result\.ready\)[\s\S]*?return false;[\s\S]*?markResolutionSeen\(address, replay\);[\s\S]*?this\.#publishResolvedReplays\(\);[\s\S]*?return true;/s,
    'a successfully opened battle retires before Pending can offer the same replay again');
});

test('winner cells wear the linked Discord identity and never lose the address', () => {
  assert.match(componentSource, /from '\.\.\/app\/profiles\.js'/,
    'identity rides the shared profiles module, not a private fetch');
  assert.match(componentSource, /__setCrapsProfilesForTest/,
    'the lookup has a swappable seam so an outage is testable');
  assert.match(componentSource,
    /this\.#paintWinner\(winner, concealed[\s\S]*?laneResult\?\.winner/s,
    'the selected current-lane winner stays sealed until the connected viewer finishes their replay');
  assert.match(componentSource,
    /this\.#paintWinner\(previousEventWinner, previousEventConcealed[\s\S]*?previousEventLaneResult\?\.winner/s,
    'the selected previous-event lane follows the same unseen-replay seal');
  assert.match(componentSource, /referrerPolicy = 'no-referrer'/,
    'avatar loads leak nothing to the CDN');
  assert.match(componentSource, /addEventListener\('error', \(\) => portrait\.remove\(\)/,
    'a rotted avatar drops to name-only rather than a broken image');
  assert.match(componentSource, /profile\?\.name \|\| compactWinner\(raw\)/,
    'an unlinked wallet keeps the shortened address');
  assert.match(componentSource, /`\$\{profile\.name\} · \$\{raw\}` : raw/,
    'the full address always survives in the title');
});

test('a closed battle awaiting its result refreshes the lobby window on a 5s settle watch', () => {
  const componentSource = readFileSync(new URL('../app-craps-entry.js', import.meta.url), 'utf8');
  assert.match(componentSource, /const CRAPS_SETTLE_WATCH_MS = 5_000;/,
    'the settle watch is a short, explicit cadence');
  assert.match(componentSource, /if \(battle\.state === 'closed' && !result\) awaitingSettlement = true;/,
    'SETTLING is derived from a closed battle with no result yet');
  assert.match(componentSource, /this\.#awaitingSettlement = awaitingSettlement;/,
    'the render publishes the flag the watcher gates on');
  assert.match(componentSource, /registerComponentPoll\(\(\) => \{\s*if \(this\.#awaitingSettlement\) void this\.#refreshSchedule\(\);\s*\}, CRAPS_SETTLE_WATCH_MS\)/,
    'the watch rides the shared component poll so hidden tabs pause it, and only fires while settling');
  assert.match(componentSource, /if \(typeof this\.#settleWatchTimer === 'function'\)/,
    'disconnect releases the settle watch');
});
