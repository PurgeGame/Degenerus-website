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
    kind: 'stacks', stacks: ['7'], art: ['/shared/flip-chips/stack-7-high-red.svg'],
  });
  assert.deepEqual(crapsEscalatedChipPresentation(7, 3), {   // 2x
    baseChipCount: '7', effectiveChipCount: '14', multiplier: 2,
    kind: 'stacks', stacks: ['7', '7'],
    art: ['/shared/flip-chips/stack-7-high-red.svg', '/shared/flip-chips/stack-7-high-red.svg'],
  });
  assert.deepEqual(crapsEscalatedChipPresentation(7, 6), {   // 4x
    baseChipCount: '7', effectiveChipCount: '28', multiplier: 4,
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
    crapsStandingAtRound,
    crapsStakeFor,
    crapsTheoFor,
    formatCrapsCompactFlip,
    formatCrapsFlip,
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
  assert.equal(formatCrapsCompactFlip('3000'), '3K');
  assert.equal(formatCrapsCompactFlip('3150'), '3.2K');
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
  assert.doesNotMatch(COMPONENT_SRC, /craps-dialog__rule|craps-intro|craps-table-felt__stamp/,
    'the compact top rail avoids bringing back instructional clutter');
  assert.match(COMPONENT_SRC, /class="craps-dialog__prizes"[^>]*data-bind="craps-prize-marquee"[\s\S]*?<small>JACKPOT<\/small>[\s\S]*?data-bind="craps-jackpot-marquee-amount"[\s\S]*?<small>BOUNTY POOL<\/small>[\s\S]*?data-bind="craps-bounty-amount"[\s\S]*?<small>ADDED<\/small>[\s\S]*?data-bind="craps-bounty-added-amount"/s,
    'the persistent header prominently names and displays both battle prizes');
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
  assert.doesNotMatch(COMPONENT_SRC, /craps-battle-board__head|craps-battle-round|CURRENT BATTLE · TOP 3/,
    'the top-three racks do not waste a rail on a redundant caption or round label');
  assert.match(COMPONENT_SRC, /#paintOpponentRacks/);
  assert.match(COMPONENT_SRC, /status = 'BUST'/,
    'a player who exhausts their bankroll stays visible in a fixed busted rack');
  assert.match(COMPONENT_SRC, /else if \(goalHit\) \{[\s\S]*?state = 'cashout';[\s\S]*?status = 'LOCKED'/s,
    'reaching the goal locks immediately without an ending flip');
  assert.doesNotMatch(COMPONENT_SRC, /FLIP PENDING|AT FLIP|ROUND SURVIVED|ROUND BUSTED|DOUBLE OR NOTHING/,
    'obsolete shared and end-of-run flip states are gone');
  assert.match(COMPONENT_SRC, /SURVIVAL FLIP/);
  assert.match(COMPONENT_SRC, /SURVIVED · 2×/);
  assert.match(COMPONENT_SRC, /SURVIVAL BUST · 0×/);
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
  assert.match(COMPONENT_SRC, /CRAPS_BATTLE_RACK_SLOTS = 30/);
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
  assert.match(COMPONENT_SRC, /this\.#lockDicePair\(dicePair\);\s*this\.#popDiceLockReadout\(frame\);[\s\S]*?setTimeout/s,
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
  assert.match(COMPONENT_SRC, /#animateSettlementsTogether\(frame, frameIndex, onDone, \{ comeOut = false \} = \{\}\)[\s\S]*?const lossDuration =[\s\S]*?const lostBetDuration =[\s\S]*?const payoutDuration =[\s\S]*?this\.#animatePayout\(frame, frameIndex, \{ visualOnly: delta <= 0n, comeOut \}\)[\s\S]*?const localDuration = Math\.max\(lossDuration, lostBetDuration, payoutDuration\);[\s\S]*?const featuredDuration = this\.#animateFeaturedPayouts\(frame, frameIndex, \{ comeOut \}\);[\s\S]*?Math\.max\(760, localDuration, featuredDuration\)/s,
    'local and featured-opponent settlements launch in one beat and share the longest duration');
  assert.doesNotMatch(COMPONENT_SRC, /const animateFeatured =|this\.#animatePayout\(frame, nextIndex, animateFeatured\)/,
    'opponent collections no longer wait for the local payout to finish');
  assert.match(COMPONENT_SRC, /#animatePayout\(frame, frameIndex, \{ visualOnly = false, comeOut = false \} = \{\}\)[\s\S]*?chip\.style\.setProperty\('--flight-delay', '0ms'\);[\s\S]*?return 570;/s,
    'every local payout chip starts without an internal stagger');
  assert.match(COMPONENT_SRC, /#animateFeaturedPayouts\(frame, frameIndex, \{ comeOut = false \} = \{\}\)[\s\S]*?chip\.style\.setProperty\('--flight-delay', '0ms'\);[\s\S]*?return 570;/s,
    'every featured-opponent payout chip starts on that exact same frame');
  assert.doesNotMatch(COMPONENT_SRC, /--flight-delay', `\$\{(?:flightIndex|playerFlightIndex) \*/,
    'no player or chip-order payout delay remains');
  assert.match(COMPONENT_SRC, /#animateBankrollLoss\(frame, \{ clearBoard = false \} = \{\}\)/);
  assert.match(COMPONENT_SRC, /#queueNextResolutionRoll\(80\)/,
    'the normal post-settlement pause keeps winning rolls near a two-second cadence');
  assert.match(COMPONENT_SRC, /const duration = Math\.max\(760, localDuration, featuredDuration\)/,
    'results retain a readable minimum settlement beat even when nobody collects');
  assert.match(COMPONENT_SRC, /#animateSevenOutClear\(frameIndex, onDone\)/);
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
  assert.doesNotMatch(COMPONENT_SRC, /if \(pointMade\) \{[\s\S]{0,500}?#animateBoardReload/s,
    'point-made never invokes the next-shooter line recommit primitive');
  assert.match(COMPONENT_SRC, /const dontPassWasHeld = dontPass\?\.classList\?\.contains\('is-seven-cleared'\)[\s\S]*?if \(dontPass && !dontPassWasHeld\) this\.#releaseBoardBetSpots\(\[dontPass\]\)/s,
    'seven-out keeps a previously retired Don’t Pass held for the next-shooter deal');
  assert.match(COMPONENT_SRC, /frame\?\.payoutBetsExact[\s\S]*?return explicit;/s,
    'an authoritative empty payout list cannot be replaced by inferred come-out winners');
  assert.match(COMPONENT_SRC, /class="craps-run-rail__bankroll"[\s\S]*?class="craps-run-rail__well"[\s\S]*?class="craps-run-rail__rack"[\s\S]*?class="craps-run-rail__goal"/,
    'bankroll and goal readouts flank the physical chip trough instead of covering it');
  assert.match(COMPONENT_SRC, /data-bind="craps-resolution-standing"[\s\S]*?#paintLocalStanding\(roundNumber, localStanding\?\.rank, standings\.length\)/s,
    'the main bankroll display paints the viewer position from each chip standing update');
  assert.match(COMPONENT_SRC, /CRAPS_RUN_RACK_SLOTS = 96/);
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
  assert.doesNotMatch(COMPONENT_SRC, /class="craps-run-rail__goal"><small>GOAL/,
    'the end stop communicates the goal without another label inside the rack');
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
  assert.match(COMPONENT_SRC, /<small>OUTCOME<\/small>[\s\S]*?<small>LAST RESULT<\/small>[\s\S]*?<small>POINT<\/small>[\s\S]*?<small>LAST ROLL<\/small>/,
    'outcome, result, point, and last roll own permanent cells in reading order');
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
  assert.match(COMPONENT_SRC, /let opponentLane = 0[\s\S]*?const seat = local \? 'you' : `top-\$\{\+\+opponentLane\}`/s,
    'the three tracked opponents keep fixed top-row lanes while YOU owns the lower band');
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
  assert.match(COMPONENT_SRC, /result\.set\(bet\.id, BigInt\(Math\.min\(count, CRAPS_PICKED_CHIPS\)\)\)/,
    'initial and remote placements retain per-spot counts instead of collapsing them to one');
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
  assert.match(COMPONENT_SRC, /const opponents = standings\.filter\(\(entry\) => !entry\.local\)\.slice\(0, 3\)/,
    'the local player plus the three highest opponents own the two felt bands');
  assert.match(COMPONENT_SRC, /const opponentStandings = visibleStandings\.filter\(\(entry\) => !entry\.local\)\.slice\(0, 3\)[\s\S]*?rows\.innerHTML = opponentStandings\.map/s,
    'only the three featured opponents appear above the felt while YOU keeps the separate lower rack');
  assert.match(COMPONENT_SRC, /const playerColor = local[\s\S]*?CRAPS_OPPONENT_MEDAL_COLORS\[opponentLane - 1\][\s\S]*?style="--player-color:\$\{escapeHtml\(playerColor\)\}"/s,
    'felt shadows follow each opponent’s medal lane color');
  assert.match(COMPONENT_SRC, /opponentStandings\.map\(\(entry, medalIndex\)[\s\S]*?CRAPS_OPPONENT_MEDAL_COLORS\[medalIndex\][\s\S]*?style="--player-color:\$\{escapeHtml\(playerColor\)\}"/s,
    'top rack stripes repeat the same gold, silver, and bronze mapping');
  assert.match(COMPONENT_SRC, /\$\{battleMarkup\(\)\}\s*<div class="craps-table-felt">/s,
    'the opponent rail is physically above and outside the betting felt');
  assert.match(COMPONENT_SRC, /const nextShooter = this\.#isSevenOut\(frame\)[\s\S]*?this\.#paintOpponentRacks\(index \+ 1, null, false, nextShooter\)/s,
    'top-row seats only reorder after a nonterminal seven-out changes the shooter');
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
  assert.match(CSS_SRC, /\.craps-dice-bay__lock-readout\.is-popping \.craps-dice-bay__lock-number\s*\{[\s\S]*?craps-dice-number-pop 680ms/s);
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
  assert.match(CSS_SRC, /grid-template-areas:\s*"event event event"\s*"outcome point total"/s,
    'the lower row reads Last Result, Point, Last Roll from left to right');
  assert.match(CSS_SRC, /\.craps-roll-board__event\s*\{\s*border-bottom:/s);
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
  assert.match(CSS_SRC, /\.craps-dialog__card\[data-screen="battle"\] \.craps-table-rail\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\)/s,
    'battle layout reserves a top rail outside the felt');
  assert.match(CSS_SRC, /\.craps-battle-board__rows\[data-columns="3"\]\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);\s*\}/s,
    'the top three opponent racks share one horizontal row');
  assert.match(CSS_SRC, /\.craps-battle-rack\s*\{[\s\S]*?grid-template-columns:/s,
    'each opponent row contains place, Discord avatar, name, and thermometer');
  assert.match(CSS_SRC, /\.craps-battle-rack \.df-bankroll__chip\.craps-battle-rack__chip/,
    'leaderboard racks reuse the edge-on main-rack chip treatment');
  assert.match(CSS_SRC, /\.craps-run-rail__standing\s*\{[\s\S]*?font:[\s\S]*?Roboto Mono/s,
    'the viewer position remains a legible part of the main bankroll display');
  assert.match(CSS_SRC, /@keyframes craps-survival-coin-track/);
  assert.match(CSS_SRC, /@keyframes craps-survival-face-track[\s\S]*?coinflip-face-red\.svg[\s\S]*?coinflip-face-eth\.svg/s);
  assert.match(CSS_SRC, /\.craps-shooter-boost\s*\{[\s\S]*?z-index:\s*60;[\s\S]*?color:\s*#ffe58d;[\s\S]*?opacity:\s*0;[\s\S]*?font-size:\s*clamp\(0\.82rem, 1\.6vw, 1\.15rem\)/s,
    'the bonus activation is little gold text, not a full card');
  assert.doesNotMatch(CSS_SRC, /\.craps-shooter-boost\s*\{[^}]*(?:background|border|padding|box-shadow|backdrop-filter)\s*:/s,
    'the floating text has no popup window chrome');
  assert.match(CSS_SRC, /\.craps-shooter-boost\.is-active\s*\{\s*animation:\s*craps-shooter-boost-pop 0\.72s ease-out both;/s);
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
  assert.match(CSS_SRC, /@keyframes craps-board-chip-deal/);
  assert.match(CSS_SRC, /@keyframes craps-board-stack-restore/);
  assert.match(CSS_SRC, /animation:\s*craps-payout-chip-flight 520ms/,
    'concurrent payout flights remain visible while fitting the two-second roll cadence');
  assert.match(CSS_SRC, /@keyframes craps-bankroll-chip-loss/);
  assert.match(CSS_SRC, /\.craps-run-rail__well\s*\{/);
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
  assert.match(COMPONENT_SRC, /const bankedCount = Math\.max\(0, chipCount - inPlayCount\)/);
  assert.match(COMPONENT_SRC, /inPlayStart: bankedCount/);
  assert.match(COMPONENT_SRC, /const filled = index < chipCount/);
  assert.match(COMPONENT_SRC, /is-banked', bankedChip/);
  assert.match(COMPONENT_SRC, /is-in-play', inPlayChip/,
    'green live chips sit immediately after the red bankroll instead of floating at the rack edge');
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
  assert.match(COMPONENT_SRC, /lastRollPayoutFromFlip: delta > 0n && !clearBoard \? startingBankroll : null/s,
    'the common impact marks positive profit from the latest roll');
  assert.match(COMPONENT_SRC, /const payoutStartIndex = payoutLayout\?\.bankedCount[\s\S]*?const lastRollPayoutStartIndex = lastRollPayoutLayout\?\.bankedCount[\s\S]*?const payoutChip[\s\S]*?const lastRollPayoutChip/s,
    'the rack independently tracks this-shooter profit and the newest roll subset');
  assert.match(CSS_SRC, /\.craps-run-rail \.craps-run-chip\.is-payout\s*\{[\s\S]*?--rack-split-top-tone:\s*#ed0e11;[\s\S]*?--rack-split-bottom-tone:\s*#30d100;/s,
    'older current-shooter winnings show red on top and green on the bottom');
  assert.match(CSS_SRC, /\.craps-run-rail \.craps-run-chip\.is-last-roll-payout\s*\{[\s\S]*?--rack-split-top-tone:\s*#30d100;[\s\S]*?--rack-split-bottom-tone:\s*#ed0e11;/s,
    'the latest roll is inverted to green on top and red on the bottom');
  assert.match(COMPONENT_SRC, /const startsNewShooter = index === 0 \|\| this\.#isSevenOut\(previousFrame\) \|\| Boolean\(previousFrame\?\.terminal\)[\s\S]*?this\.#shooterPayoutFloor = priorBankroll/s,
    'the payout hold resets at a shooter boundary rather than at every roll');
  assert.match(COMPONENT_SRC, /#spinResolutionDice[\s\S]*?this\.#paintResolutionTray\(priorBankroll, \{[\s\S]*?payoutFromFlip: this\.#heldShooterPayoutFrom\(priorBankroll\),[\s\S]*?lastRollPayoutFromFlip: this\.#lastRollPayoutFloor[\s\S]*?event:\s*'—'/s,
    'the newest-roll orientation remains visible while the next dice are in flight');
  assert.match(COMPONENT_SRC, /const shooterEnded = this\.#isSevenOut\(frame\) \|\| Boolean\(frame\.terminal\)[\s\S]*?lastRollPayoutFromFlip: !shooterEnded && delta > 0n \? priorBankroll : null[\s\S]*?this\.#lastRollPayoutFloor = !shooterEnded && delta > 0n \? priorBankroll : null/s,
    'after the next result, prior newest chips shift and only fresh profit stays inverted');
  assert.match(COMPONENT_SRC, /boardState === 'come-out'[\s\S]*?this\.#bets\.get\('pass'\)[\s\S]*?this\.#bets\.get\('dont-pass'\)[\s\S]*?this\.#playedFlip \/ CRAPS_BOARD_CHIPS/s,
    'the come-out rack converts both line chip counts to the battle slot’s chip value');
  assert.match(COMPONENT_SRC, /const bankedDescription = reserveRisk[\s\S]*?FLIP grey off the felt[\s\S]*?FLIP green and committed off the felt[\s\S]*?const rackDescription = goalLocked[\s\S]*?FLIP blue; the off-felt reserve guarantees the goal[\s\S]*?FLIP red on the felt\. \$\{bankedDescription\}/s,
    'rack accessibility describes the blue, grey, green, and red reserve convention');
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
  assert.match(CSS_SRC, /Grey danger chips and blue locked-win chips are deliberately unsplit[\s\S]*?\.is-filled\.is-reserve-risk,[\s\S]*?\.is-filled\.is-goal-locked[\s\S]*?var\(--craps-rack-chip-tone\)/s,
    'grey danger and blue locked-win states override the payout split');
  assert.match(COMPONENT_SRC, /const inPlay = chips\.filter\(\(chip\) => \([\s\S]*?contains\('is-in-play'\)[\s\S]*?!chip\.classList\?\.contains\('is-goal-locked'\)[\s\S]*?const lost = inPlay\.slice/s,
    'a seven-out clears the felt without making locked blue rack chips disappear');
  assert.match(COMPONENT_SRC, /const affordability = crapsNextShooterAffordability\(\{[\s\S]*?bankrollFlip: bankroll,[\s\S]*?nextStakeFlip: nextStake,[\s\S]*?goalFlip: this\.#goal/s,
    'the survival decision uses remaining bankroll and the escalated next stake');
  assert.match(COMPONENT_SRC, /affordability === 'survival' && typeof survivalResult === 'boolean'[\s\S]*?this\.#startSurvivalFlip\(\{[\s\S]*?bankrollFlip: bankroll,[\s\S]*?nextStakeFlip: nextStake/s,
    'a coin appears only at an actual between-shooter survival threshold');
  assert.match(COMPONENT_SRC, /const inPlay = state === 'risk'[\s\S]*?state === 'live'/,
    'opponent mini-racks split their snapshots into live and banked balances');
  assert.match(COMPONENT_SRC, /const startsNewShooter = nextIndex === 0\s*\|\| this\.#isSevenOut\(previousFrame\)\s*\|\| Boolean\(previousFrame\?\.terminal\)[\s\S]*?this\.#announceShooterBoost\(nextIndex, spin\)/s,
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
  assert.match(CSS_SRC, /\.craps-run-rail__well\.is-goal-reached \+ \.craps-run-rail__goal/,
    'the external goal stop lights when the rack reaches it');
  assert.match(CSS_SRC, /\.craps-dialog__card\s*\{[\s\S]*?width:\s*min\(99vw, 88rem\)/s,
    'the table uses substantially more of a desktop viewport');
  assert.match(CSS_SRC, /\.craps-bet__corner-grid\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0\.24rem;/s);
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\[data-seat="top-1"\] \{ left: 0; \}/);
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\[data-seat="top-2"\] \{ left: 35%; \}/);
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\[data-seat="top-3"\] \{ right: 0; \}/);
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
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\s*\{[\s\S]*?top:\s*0;[\s\S]*?width:\s*30%;[\s\S]*?height:\s*2rem/s,
    'the compact opponent lanes stay separated along the top edge');
  assert.match(CSS_SRC, /\.craps-group--place \.craps-bet__seat-chip:not\(\.is-local\)\s*\{[\s\S]*?height:\s*2\.3rem/s,
    'the number fields give stacks a compact fixed-height top lane');
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
  assert.doesNotMatch(CSS_SRC, /craps-bet__chip-3d|--chip-wall|object-fit:\s*fill/,
    'there are no fabricated sidewalls, CSS perspective, or stretched chip faces');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local\s*\{[\s\S]*?right:\s*0;[\s\S]*?width:\s*50%;[\s\S]*?height:\s*49%/s,
    'YOU owns a bounded lower-right corner without colliding with the top lanes');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local \.craps-bet__seat-art\s*\{[\s\S]*?width:\s*min\(4\.3rem, 98%\)/s,
    'the featured local chip stays prominent without swallowing its betting spot');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local \.craps-bet__seat-art-set\[data-columns="2"\] \.craps-bet__seat-art\s*\{[\s\S]*?width:\s*61%[\s\S]*?data-columns="2"[\s\S]*?margin-left:\s*-22%/s,
    'two local stacks remain inside the hero corner instead of widening the chip diameter');
  assert.match(CSS_SRC, /\.craps-bet__seat-chip\.is-local \.craps-bet__seat-art-set\[data-columns="3"\] \.craps-bet__seat-art\s*\{[\s\S]*?width:\s*44%[\s\S]*?data-columns="3"[\s\S]*?margin-left:\s*-16%/s,
    'three local stacks remain inside the hero corner');
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
  assert.match(DEMO_SCRIPT_SRC, /jackpot:\s*\{[\s\S]*?rolls:\s*params\.get\('jackpotRolls'\)[\s\S]*?threshold:\s*params\.get\('jackpotThreshold'\)[\s\S]*?amountFlip:\s*params\.get\('jackpotAmount'\)[\s\S]*?status:\s*jackpotWinner === 'other' \? 'won-other'/s,
    'the demo exposes roll, jackpot-value, and winner-state inputs for the progressive tray');
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
