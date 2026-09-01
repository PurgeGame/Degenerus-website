import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('future slates count to rollover and stop spending comps one battle period early', () => {
  const clock = {
    daySeconds: 86_400,
    anchorSeconds: 0,
    openerCloseSeconds: 1_200,
    clockAlignSeconds: 180,
    routinePeriodSeconds: 14_400,
    eventLeadSeconds: 900,
  };
  const beforeCutoff = crapsEntry.crapsEntryState({
    day: 42,
    nowMs: 71_999_000,
    clock,
  });
  assert.equal(beforeCutoff.nextDayAtMs, 86_400_000);
  assert.equal(beforeCutoff.passCutoffAtMs, 72_000_000,
    'mainnet comps close four hours before the next day rolls');
  assert.equal(beforeCutoff.futurePassOpen, true);

  const atCutoff = crapsEntry.crapsEntryState({ day: 42, nowMs: 72_000_000, clock });
  assert.equal(atCutoff.futurePassOpen, false,
    'the exact cutoff no longer lets the automatic payment path spend a comp');
  assert.equal(crapsEntry.crapsBattleCountdownLabel(atCutoff.nextDayAtMs, 72_000_000), '4h');
  assert.equal((componentSource.match(/const compEligible = state\.futurePassOpen && !this\.#forceFlipDay/g) || []).length, 2,
    'both rendering and the last-second transaction path enforce the cutoff');
  assert.match(componentSource, /const usePass = kind === 'future-day' && compEligible && selectedPasses > 0/);
});

test('goal multipliers use player-facing difficulty labels', () => {
  assert.equal(crapsEntry.crapsGoalLabel(5), 'EASY');
  assert.equal(crapsEntry.crapsGoalLabel(10), 'HARD');
  assert.equal(crapsEntry.crapsGoalLabel(20), 'HARD');
  assert.equal(crapsEntry.crapsGoalLabel(50), 'V HARD');
  assert.equal(crapsEntry.crapsGoalLabel(null), '—');
});

test('individual battle goals use green for EASY and red for HARD', () => {
  assert.match(componentSource, /goal\.dataset\.difficulty = goalLabel === 'EASY'/);
  assert.match(cssSource, /\.craps-entry__goal\[data-difficulty="easy"\][^{]*\{[^}]*color:\s*#4ade80/s,
    'EASY battle goals are green');
  assert.match(cssSource, /\.craps-entry__goal\[data-difficulty="hard"\][^{]*\{[^}]*color:\s*#f87171/s,
    'HARD and V HARD battle goals are red');
});

test('High Roller selection exposes only the High Roller entrant field', () => {
  const field = { total: 37, high: 4 };
  assert.equal(crapsEntry.crapsEntrantCountForLane(field, false), 37);
  assert.equal(crapsEntry.crapsEntrantCountForLane(field, true), 4);
  assert.equal(crapsEntry.crapsEntrantCountForLane({ total: 37 }, true), null,
    'missing lane data never falls back to the combined field');
});

test('a lobby result stays sealed while the connected wallet has an unseen replay', () => {
  const address = '0xAB12000000000000000000000000000000000000';
  const battleKey = `0x${'ab'.repeat(32)}`;
  const result = { battleKey, winner: address.toLowerCase() };
  const replays = [{ battleKey, viewerBetId: '17' }];

  assert.equal(crapsEntry.crapsResultNeedsReveal(result, {
    address,
    replays,
    wasSeen: () => false,
  }), true);
  assert.equal(crapsEntry.crapsResultNeedsReveal(result, {
    address,
    replays,
    wasSeen: () => true,
  }), false);
  assert.equal(crapsEntry.crapsResultNeedsReveal({ battleKey: `0x${'cd'.repeat(32)}` }, {
    address,
    replays,
    wasSeen: () => false,
  }), false);
});

test('winner-list goal colors and total lane buy-ins come from sealed result data', () => {
  assert.equal(crapsEntry.crapsWinnerGoalResult({ winningStop: 1 }), 'met');
  assert.equal(crapsEntry.crapsWinnerGoalResult({ winningStop: 0 }), 'missed');
  assert.equal(crapsEntry.crapsWinnerGoalResult({ winningStop: null }), 'unknown');
  const result = { buyInWei: '500000000000000000000', highMultiple: 10 };
  assert.equal(crapsEntry.crapsWinnerListBuyInWei(result, false), '500000000000000000000');
  assert.equal(crapsEntry.crapsWinnerListBuyInWei(result, true), '5000000000000000000000');
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
    bonusMultiplier: 100,
  }), {
    battleKey,
    viewerBetId: '6234999496913828446217',
    settledMainPotWei: '12000000000000000000000',
    battleWinner: winner.toLowerCase(),
    battleWinnerBetId: '6234999496913828446217',
    battlePayoutWei: '9000000000000000000000',
    battleWinningStop: 1,
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
    /#bindWinnerReplay\([\s\S]*?concealed \? null : laneResult/s,
    'an unseen owned result cannot leak through the public replay button');
  assert.match(cssSource, /\.craps-entry__result-replay\s*\{[^}]*width:\s*1\.28rem[^}]*height:\s*1\.28rem[^}]*border:\s*0[^}]*background:\s*transparent/s,
    'the replay action is a small transparent icon instead of a text button');
  assert.match(cssSource, /\.craps-entry__result-replay svg\s*\{[^}]*width:\s*\.86rem[^}]*stroke:\s*currentColor/s,
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

test('the launcher uses the game dice badges and puts the jackpot in the header', () => {
  assert.match(componentSource, /dgnBadgePath\(3, 1, 6\)/, 'die 2 uses the silver game badge');
  assert.match(componentSource, /dgnBadgePath\(3, 4, 4\)/, 'die 5 uses the blue game badge');
  assert.equal((componentSource.match(/dgnBadgePath\(3,/g) || []).length, 2,
    'exactly two game dice badges form the header mark');
  assert.doesNotMatch(componentSource, /7 DAILY AUTOBATTLES/);
  assert.match(componentSource, /<header class="craps-entry__head">[\s\S]*?data-bind="craps-progressive"[\s\S]*?<\/header>/);
  assert.match(componentSource, /data-bind="craps-progressive-amount"/);
  assert.match(componentSource, /<small>RUN IT UP JACKPOT<\/small>/,
    'the progressive pool uses its player-facing Run It Up name');
  assert.doesNotMatch(componentSource, /Craps progressive jackpot/,
    'accessible meter copy uses the same player-facing name');
  assert.match(componentSource, /readCrapsProgressivePool\(\)/);
  assert.match(cssSource, /craps-entry__progressive/);
  assert.doesNotMatch(componentSource, /data-bind="craps-entry-day"/);
  assert.match(componentSource, /class="craps-entry__brand"[\s\S]*?<strong>CRAPS<\/strong><small>BATTLE<\/small>/,
    'the product remains Craps Battle while Craps carries the headline weight');
  const wei = 10n ** 18n;
  assert.equal(crapsEntry.crapsHeaderBoostLabel(999n * wei), '999');
  assert.equal(crapsEntry.crapsHeaderBoostLabel(7_350n * wei), '7.35K');
  assert.equal(crapsEntry.crapsHeaderBoostLabel(18_000n * wei), '18K');
});

test('a poker-lobby listing shows exact historical added FLIP and completed winners beside explicit entry terms', () => {
  assert.match(componentSource, /<table class="craps-entry__listing"/);
  assert.match(componentSource, /CLOSES IN<\/th><th class="craps-entry__wager">WAGER<\/th><th class="craps-entry__operator">\+<\/th><th>BATTLE<\/th><th>GOAL<\/th><th>BUY IN<\/th><th>ENTRANTS/,
    'the last column explicitly names its entrant count');
  assert.doesNotMatch(componentSource, /craps-battle-speed|craps-full-day-speed|<th>SPEED<\/th>/);
  assert.doesNotMatch(componentSource, /<small>FLIP<\/small>|craps-full-day-(?:entry|pot)-unit/,
    'the combined wager split has no repeated micro FLIP labels');
  assert.match(componentSource,
    /data-bind="craps-added-kicker">YESTERDAY<\/small><strong><output data-bind="craps-added-total">—<\/output> <em>FLIP<\/em><\/strong><small class="craps-entry__pot-boost-state">ADDED<\/small>/,
    'the historical addition uses the literal Yesterday / amount FLIP / Added stack');
  assert.match(componentSource, /bindText\('craps-added-kicker', 'YESTERDAY'\)/);
  assert.match(componentSource,
    /bindText\('craps-added-total', addedReady\s*\? crapsHeaderBoostLabel\(snapshot\.yesterdayAddedWei\)/,
    'the historical boost amount no longer carries a redundant plus sign');
  assert.match(cssSource, /\.craps-entry__pot-boost\s*\{[^}]*border-color:\s*rgba\(192,132,252/s,
    'the historical boost uses the shared purple boost color');
  assert.match(cssSource, /\.craps-entry__progressive\s*\{[^}]*border-color:\s*rgba\(250,204,21/s,
    'the Run It Up jackpot uses the gold jackpot color');
  assert.equal((componentSource.match(/data-bind="craps-added-total"/g) || []).length, 1);
  assert.doesNotMatch(componentSource, /craps-battle-added/);
  assert.match(componentSource, /snapshot\.yesterdayAddedWei/);
  assert.match(componentSource, /readCrapsLobbySnapshot\(day, player\)/);
  assert.match(componentSource, /data-bind="craps-battle-countdown"/);
  assert.match(componentSource, /crapsBattleCountdownLabel\(battle\.closeAtMs, nowMs\)/);
  assert.match(componentSource, /data-bind="craps-battle-entry"/);
  assert.match(componentSource, /data-bind="craps-battle-pot"/);
  assert.match(componentSource, /data-bind="craps-battle-goal"/);
  assert.match(componentSource, /crapsGoalLabel\(battleTerms\?\.goalMult\)/);
  assert.match(componentSource, /bindText\('craps-full-day-goal', futureDay \? '' : 'ALL 7'\)/,
    'the full-day entry names ALL 7 in the GOAL column');
  assert.match(componentSource, /data-bind="craps-day-countdown"/,
    'the full-day entry head carries the opener countdown');
  assert.doesNotMatch(componentSource, /'MIXED'/);
  assert.match(componentSource, /data-bind="craps-battle-winner"/);
  assert.match(componentSource, /data-bind="craps-battle-payout"/);
  assert.match(componentSource, /data-bind="craps-battle-boost"/);
  assert.match(componentSource,
    /<small>TOTAL WON<\/small><strong><output data-bind="craps-battle-payout">—<\/output><em class="craps-entry__boost-mark" data-bind="craps-battle-boost-detail" hidden><output data-bind="craps-battle-boost">—<\/output><\/em><\/strong>/,
    'the lobby tucks each exact boost into a compact visual mark beside TOTAL WON');
  assert.doesNotMatch(componentSource, /\(<output[^>]*craps-(?:battle|previous-event)-boost[^>]*>—<\/output> BOOST\)/,
    'resolved contests do not spend row space spelling out BOOST in parentheses');
  assert.doesNotMatch(componentSource,
    /data-bind="craps-(?:battle|previous-event)-(?:payout|buyin)">—<\/output> FLIP/,
    'completed rows do not repeat the understood FLIP unit after the prize and buy-in');
  assert.doesNotMatch(componentSource, /<small>BOOSTED<\/small>/,
    'boost is not repeated as its own result column');
  assert.match(componentSource,
    /class="craps-entry__result-buyin"[\s\S]*?data-bind="craps-battle-buyin"[\s\S]*?<td class="craps-entry__entrants" data-bind="craps-battle-entrants"/,
    'the total buy-in sits at the result block’s right edge beside entrants');
  assert.match(componentSource, /paintCrapsBoostMark\([\s\S]*?laneResult && !concealed \? laneResult\.winnerBoostWei : null/s,
    'the bolt mark follows the selected lane and only exposes an attributable boost');
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
  assert.match(componentSource, /body\.appendChild\(previousEventRow\)/,
    'the rollover-only prior-day result stays pinned beneath the reset current slate');
  assert.match(componentSource, /\.craps-entry__battle\[data-craps-period\]/,
    'the dedicated history row is not mistaken for one of the seven current battles');
  assert.match(componentSource,
    /new Map\([\s\S]*?Number\(row\.dataset\.crapsPeriod\)[\s\S]*?rowsByPeriod\.get\(period\)/,
    'urgency reordering cannot change a battle row\'s period identity on the next render');
  assert.match(componentSource,
    /this\.#scheduleDay != null && this\.#scheduleDay !== day[\s\S]*?this\.#boardBets = \{\};[\s\S]*?this\.#contractChips = 0;[\s\S]*?this\.#boardSet = false;/,
    'a new authoritative day clears the reusable custom board');
  assert.match(componentSource,
    /<td class="craps-entry__result"[^>]*colspan="6"[^>]*>[\s\S]*?<td class="craps-entry__entrants" data-bind="craps-battle-entrants">/,
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
    'ENTERED reopens that slip board while AMEND ENTRY submits its changed layout');
  assert.match(componentSource, /\? entryNeedsAmend \? 'AMEND ENTRY' : 'ENTERED'/,
    'a changed board promotes the individual battle action from ENTERED to AMEND ENTRY');
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
  assert.match(componentSource, /data-craps-board/);
  assert.match(componentSource,
    /class="craps-entry__lobby"[\s\S]*?<footer class="craps-entry__foot"[\s\S]*?class="craps-entry__pick-instruction">Pick your bets or choose RANDOM for 3x BONUS<\/span>[\s\S]*?<div class="craps-entry__setup"/s,
    'picks and the lane selector sit at the bottom beneath the battle list and status');
  assert.match(componentSource, /status\.hidden = !status\.textContent/,
    'transient status disappears when idle without displacing the permanent board instruction');
  assert.doesNotMatch(componentSource, /Full slate before Battle 1 · or enter one battle\./,
    'the old full-slate helper is gone');
  assert.doesNotMatch(componentSource, /Comp window closed · FLIP entry remains open\./,
    'an expired comp does not add a second idle helper above the permanent pick instruction');
  assert.match(componentSource, /<small>YOUR PICKS<\/small>[\s\S]*?data-craps-lane="normal"[\s\S]*?data-craps-lane="high"/s,
    'the bottom strip keeps picks and Normal/High Roller together');
  assert.match(componentSource, /data-craps-lane="normal"[\s\S]*?data-craps-lane="high"/);
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
    /data-bind="craps-tomorrow-terms" colspan="4"><span class="craps-entry__tomorrow-layout"><strong data-bind="craps-tomorrow-range">[^<]+<\/strong><small>7 BATTLES<\/small><\/span>/,
    'the rollover row puts seven battles to the right of its combined cost');
  assert.match(componentSource, /craps-tomorrow-range', compactRange\(futureFaceRange\)/,
    'the rendered range is the combined low..high, never the split sub-ranges');
  assert.match(componentSource, /const compactRange = \(range\) => `\$\{formatCrapsCompactFlip\(range\.low\)\} – \$\{formatCrapsCompactFlip\(range\.high\)\}`/,
    'the cost range gives the dash breathing room on both sides');
  assert.match(cssSource, /\.craps-entry__tomorrow-range \.craps-entry__tomorrow-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,33fr\) minmax\(max-content,12fr\)[^}]*column-gap:\s*\.18rem;[^}]*padding:\s*0 \.28rem 0 \.08rem/s,
    'the future-day scope keeps its full width and a safe gutter before BUY IN');
  assert.match(cssSource, /\.craps-entry__tomorrow-range small\s*\{[^}]*min-width:\s*max-content/s,
    '7 BATTLES cannot shrink underneath the adjacent buy button');
  assert.match(cssSource, /\.craps-entry__tomorrow-range strong\s*\{[^}]*text-align:\s*center/s,
    'the future-day cost centers beneath WAGER + BATTLE');
  assert.match(cssSource, /\.craps-entry__tomorrow-range small\s*\{[^}]*text-align:\s*center/s,
    'seven battles centers beneath GOAL');
  assert.doesNotMatch(componentSource, /craps-tomorrow-wager|craps-tomorrow-battle/,
    'the split per-column tomorrow ranges are gone');
  assert.match(componentSource, /fullDayHead\.colSpan = 1/,
    'the rollover clock stays in the normal CLOSES IN column');
  assert.match(componentSource, /fullDayTerms\.colSpan = futureDay \? 4 : 1/,
    'the future range consumes the freed term columns');
  assert.doesNotMatch(componentSource, /NEXT SLATE/);
  assert.match(componentSource, /data-bind="craps-battle-entrants"/);
  assert.match(componentSource, /data-bind="craps-previous-event-entrants"/);
  assert.match(componentSource, /data-bind="craps-previous-event-row"[\s\S]*?colspan="6"[\s\S]*?data-bind="craps-previous-event-entrants"/,
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
  assert.match(cssSource, /\.craps-entry__col-wager\s*\{[^}]*width:\s*15%/s);
  assert.match(cssSource, /\.craps-entry__col-operator\s*\{[^}]*width:\s*3%/s);
  assert.match(cssSource, /\.craps-entry__col-battle\s*\{[^}]*width:\s*15%/s);
  assert.match(cssSource, /\.craps-entry__col-action\s*\{[^}]*width:\s*25%/s);
  assert.match(cssSource, /\.craps-entry__col-entrants\s*\{[^}]*width:\s*15%/s);
  assert.match(cssSource, /\.craps-entry__entrants\s*\{[^}]*text-align:\s*center/s);
  assert.match(cssSource, /\.craps-entry__pass-count\s*\{[^}]*border-radius:\s*999px/s);
  assert.match(cssSource, /\.craps-entry__action > button\s*\{[^}]*width:\s*min\(100%,5\.2rem\)[^}]*height:\s*1\.1rem[^}]*background:\s*linear-gradient\(180deg,#f5c842,#b8790a\)[^}]*font-size:\s*\.55rem/s,
    'buy-in buttons remain compact yellow controls with readable type');
  assert.doesNotMatch(cssSource, /button\[data-state="pass"\]\s*\{[^}]*(?:#168a4b|#0d5a32)/s,
    'pass-funded purchases retain the yellow buy-in treatment');
  assert.match(cssSource, /button\[data-state="pass"\]\s*\{[^}]*word-spacing:\s*\.12rem/s,
    'the comp button keeps visible space between its number and label');
  assert.match(cssSource, /\.craps-entry__day-buy \.craps-entry__money strong\s*\{[^}]*color:\s*#f8fafc/s,
    'the day price stays white in every payment state');
  assert.match(cssSource, /\.craps-entry__day-buy\[data-payment="pass"\] \.craps-entry__money strong\s*\{[^}]*color:\s*#f8fafc/s,
    'a comp-funded day keeps its price white instead of borrowing the win green');
  assert.match(cssSource, /\.craps-entry__listing tbody :is\(th,td\)[^{]*\{[^}]*font-size:\s*\.64rem/s,
    'the dense lobby keeps its larger readable body type');
  assert.match(cssSource, /\.craps-entry__result\s*\{/);
  assert.match(cssSource, /\.craps-entry__result-grid\s*\{[^}]*display:\s*grid/s);
  assert.match(cssSource, /\.craps-entry__boost-mark\s*\{[^}]*display:\s*inline-flex[^}]*border-radius:\s*999px/s,
    'the boost uses a tiny pill instead of another result column');
  assert.match(cssSource, /\.craps-entry__result-total > strong > output:first-child\s*\{[^}]*color:\s*#86efac/s,
    'the total-won amount keeps the green win color');
  assert.doesNotMatch(cssSource, /\.craps-entry__result-total > small[^{]*\{[^}]*color:/s,
    'the TOTAL WON text inherits the same result-header color as WINNER and BUY IN');
  assert.match(cssSource, /\.craps-entry__boost-mark\s*\{[^}]*color:\s*#d8b4fe/s,
    'the boost amount uses the shared purple boost color');
  assert.match(cssSource, /\.craps-entry__pot-boost\s*\{[^}]*grid-template-areas:\s*"kicker" "value" "state"/s,
    'yesterday uses one deliberate three-line stack');
  assert.doesNotMatch(cssSource, /\.craps-entry__pot-boost strong::before/,
    'the header keeps the exact copy stack free of an extra bolt');
  assert.match(cssSource, /\.craps-entry__boost-mark::before\s*\{[^}]*clip-path:\s*polygon/s,
    'a CSS lightning bolt carries the boost meaning visually without emoji or extra copy');
  assert.match(cssSource, /\.craps-entry__result small\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    'completed-result headings cannot spill into adjacent columns');
  assert.match(componentSource, /winnerLabel\.textContent = 'WINNER'/,
    'the selected lane supplies context without repeating a long heading in every result row');
  assert.match(componentSource, /`DAY \$\{previousEvent\.day\} WINNER`/,
    'the previous-event heading stays concise enough for the result grid');
  assert.doesNotMatch(cssSource, /\.craps-entry__result:not\(\[hidden\]\)\s*\{[^}]*display:\s*grid/s);
  assert.match(cssSource, /data-state="completed"/);
  assert.match(componentSource,
    /row\.dataset\.goalResult = concealed[\s\S]*?laneResult \? crapsWinnerGoalResult\(laneResult\)[\s\S]*?result \? 'unknown' : 'pending'/,
    'goal coloring follows the selected lane and never borrows the main winner verdict');
  assert.match(cssSource, /data-state="completed"[^}]*--craps-winner-accent:\s*#8b949e/s,
    'non-goal winner rows use the neutral grey result state');
  assert.match(cssSource, /data-goal-result="met"[^}]*--craps-winner-accent:\s*#38a9f4/s,
    'goal winner rows use the blue result state');
  assert.match(cssSource, /data-state="entered"/);
  assert.match(cssSource, /button\[data-state="amend"\]/,
    'the pending amendment has a distinct clickable action treatment');
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
    battleStakeWei: (200n * 10n ** 18n).toString(),
    winner: address.toLowerCase(),
    amountWei: (12_300n * 10n ** 18n).toString(),
  };
  const identity = `${battleKey}:${viewerBetId}`;
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
  assert.equal(waiting[0].label, '200 FLIP\nBATTLE');
  assert.equal(waiting[0].icon, '/badges-circular/dice_04_5_silver.svg');
  assert.equal(waiting[0].iconBack, '/badges-circular/dice_01_2_blue.svg');

  const highWaiting = crapsEntry.crapsResolutionPendingActions({
    address,
    replays: [{ ...replay, entryMultiple: 10 }],
  });
  assert.equal(highWaiting[0].label, '2,000 FLIP\nBATTLE',
    'a High Roller Pending card shows the full multiplied battle stake');

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
  assert.equal(ready[0].shortLabel, 'View result');
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
    new RegExp(`${address.toLowerCase()}:${battleKey}:${viewerBetId}$`));
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
    states: new Map([['battle:1', { ready: false, status: 'failed', pointer }]]),
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

  assert.match(componentSource, /document\?\.addEventListener\?\.\('visibilitychange'/);
  assert.match(componentSource, /document\?\.hidden === true/);
  assert.match(componentSource, /navigator\?\.onLine === false/);
  assert.match(componentSource, /CRAPS_REPLAY_TERMINAL_STATES = new Set\(\['ready', 'failed', 'build-unavailable'\]\)/);
  assert.match(componentSource,
    /#scheduleReplayPoll\(\)[\s\S]*?crapsReplayPollDelay\(Math\.random\(\), this\.#replayPollAttempts\(\)\)/s);
  assert.match(componentSource, /#replayPollAttempts\(\)[\s\S]*?attempts < lowest/s,
    'the scheduler paces off the battle that has been waiting the least');
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
