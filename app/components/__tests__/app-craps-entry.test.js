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

test('goal multipliers use player-facing difficulty labels', () => {
  assert.equal(crapsEntry.crapsGoalLabel(5), 'EASY');
  assert.equal(crapsEntry.crapsGoalLabel(10), 'HARD');
  assert.equal(crapsEntry.crapsGoalLabel(20), 'HARD');
  assert.equal(crapsEntry.crapsGoalLabel(50), 'V HARD');
  assert.equal(crapsEntry.crapsGoalLabel(null), '—');
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
  // Run-43 draw: fixed 5x depth, two-way even 5x/20x goal (audit 0b0ed9fb3).
  assert.deepEqual(terms.windows.map(({ buyInFlip, bankMult, goalMult }) => (
    [buyInFlip, bankMult, goalMult]
  )), [
    [2_000n, 5, 5], [400n, 5, 20], [500n, 5, 20], [400n, 5, 5],
    [400n, 5, 20], [1_500n, 5, 20], [12_100n, 5, 20],
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

test('the launcher reuses the live table dice badges and puts the jackpot in the header', () => {
  assert.match(componentSource, /dgnBadgePath\(3, 1, 6\)/, 'die 2 uses the table silver badge');
  assert.match(componentSource, /dgnBadgePath\(3, 4, 4\)/, 'die 5 uses the table blue badge');
  assert.equal((componentSource.match(/dgnBadgePath\(3,/g) || []).length, 2, 'exactly two dice badges render');
  assert.doesNotMatch(componentSource, /7 DAILY AUTOBATTLES/);
  assert.match(componentSource, /<header class="craps-entry__head">[\s\S]*?data-bind="craps-progressive"[\s\S]*?<\/header>/);
  assert.match(componentSource, /data-bind="craps-progressive-amount"/);
  assert.match(componentSource, /readCrapsProgressivePool\(\)/);
  assert.match(cssSource, /craps-entry__progressive/);
  assert.doesNotMatch(componentSource, /data-bind="craps-entry-day"/);
});

test('a poker-lobby listing shows exact historical boost and completed winners beside explicit entry terms', () => {
  assert.match(componentSource, /<table class="craps-entry__listing"/);
  assert.match(componentSource, /CLOSES IN<\/th><th>WAGER \+ POT<\/th><th>GOAL<\/th><th>BUY IN/);
  assert.doesNotMatch(componentSource, /craps-battle-speed|craps-full-day-speed|<th>SPEED<\/th>/);
  assert.doesNotMatch(componentSource, /<small>FLIP<\/small>|craps-full-day-(?:entry|pot)-unit/,
    'the combined wager split has no repeated micro FLIP labels');
  assert.match(componentSource, /YEST\. ACTUAL BOOST · ALL POTS/);
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
  assert.match(componentSource, /bindText\('craps-full-day-goal', ''\)/);
  assert.doesNotMatch(componentSource, /'MIXED'/);
  assert.match(componentSource, /data-bind="craps-battle-winner"/);
  assert.match(componentSource, /data-bind="craps-battle-payout"/);
  assert.match(componentSource, /data-bind="craps-battle-boost"/);
  assert.match(componentSource, /<td class="craps-entry__result"[^>]*colspan="4"[^>]*>\s*<div class="craps-entry__result-grid">/);
  assert.match(componentSource, /row\.dataset\.state = result \? 'completed'/);
  assert.match(componentSource, /playerEntries/);
  assert.match(componentSource, /data-craps-upgrade/);
  assert.match(componentSource, /upgradeCrapsDayWindows/);
  assert.match(componentSource, /class="craps-entry__entered"/);
  assert.doesNotMatch(componentSource, /✓ ENTERED|✓ ENTERED ROWS/,
    'owned seats use plain status text rather than disabled button copy');
  assert.match(componentSource, /`UPGRADE \$\{formatCrapsCompactFlip/);
  assert.match(componentSource, /`ENTER: \$\{price == null/);
  assert.match(componentSource, /data-craps-board/);
  assert.match(componentSource, /data-craps-lane="normal"[\s\S]*?data-craps-lane="high"/);
  assert.match(componentSource, /CRAPS_FUTURE_DAY_PRICES/);
  assert.match(componentSource, /readCrapsPassCredits/);
  assert.match(componentSource, /applyCrapsPasses/);
  assert.match(componentSource, /ENTER: 1 PASS/);
  assert.match(componentSource, /data-bind="craps-pass-wallet"/);
  assert.match(componentSource, /data-bind="craps-tomorrow-row"/);
  assert.match(componentSource, /buyFutureCrapsDays/);
  assert.doesNotMatch(componentSource, /DEEP/);
  assert.match(cssSource, /\.craps-entry\s*\{[^}]*min-height:\s*0/s);
  assert.match(cssSource, /\.craps-entry__listing\s*\{/);
  assert.match(cssSource, /\.craps-entry__listing tbody :is\(th,td\)[^{]*\{[^}]*font-size:\s*\.52rem/s);
  assert.match(cssSource, /\.craps-entry__result\s*\{/);
  assert.match(cssSource, /\.craps-entry__result-grid\s*\{[^}]*display:\s*grid/s);
  assert.doesNotMatch(cssSource, /\.craps-entry__result:not\(\[hidden\]\)\s*\{[^}]*display:\s*grid/s);
  assert.match(cssSource, /data-state="completed"/);
  assert.match(cssSource, /data-state="entered"/);
  assert.match(cssSource, /data-state="upgrade"/);
  assert.match(cssSource, /shopping-cart-cursor\.svg/);
});

test('owned finalized battles publish durable Pending replays through the shared table', () => {
  assert.match(componentSource, /publishPendingActions/);
  assert.match(componentSource, /clearPendingActions/);
  assert.match(componentSource, /openCrapsReplayTable/);
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
    winner: address.toLowerCase(),
    amountWei: (12_300n * 10n ** 18n).toString(),
  };
  const identity = `${battleKey}:${viewerBetId}`;
  const runs = [];

  const waiting = crapsEntry.crapsResolutionPendingActions({ address, replays: [replay] });
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].state, 'waiting');
  assert.equal(waiting[0].pinned, true);
  assert.equal(waiting[0].run, null);
  assert.equal(waiting[0].autoOpen, false);
  assert.equal(waiting[0].dismissScope, address.toLowerCase());

  const ready = crapsEntry.crapsResolutionPendingActions({
    address,
    replays: [replay],
    states: new Map([[identity, { ready: true, status: 'ready' }]]),
    run: async (row, scope) => { runs.push([row.viewerBetId, scope]); return true; },
  });
  assert.equal(ready[0].state, 'ready');
  assert.equal(ready[0].shortLabel, 'View result');
  assert.match(ready[0].detail, /Main pot won · 12\.3K FLIP/);
  assert.equal(await ready[0].run(), true);
  assert.deepEqual(runs, [[viewerBetId, address.toLowerCase()]]);

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
  assert.match(componentSource, /#scheduleReplayPoll\(\)[\s\S]*?crapsReplayPollDelay\(\)/s);
});
