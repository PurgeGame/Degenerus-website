import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import * as contracts from '../contracts.js';
import * as craps from '../craps.js';
import * as reasonMap from '../reason-map.js';
import * as store from '../store.js';

const PLAYER = '0xab12000000000000000000000000000000000000';
const BETS = Object.freeze({
  passLine: '30',
  dontPassLine: '0',
  place4: '0',
  place5: '0',
  place6: '30',
  place8: '30',
  place9: '0',
  place10: '0',
  hard4: '0',
  hard8: '30',
  passOddsMult: 3,
});

function receipt(logs = []) {
  return { status: 1, hash: '0xreceipt', logs };
}

function tx(logs = []) {
  return { hash: '0xtx', wait: async () => receipt(logs) };
}

function callable(name, calls, result, logs = []) {
  const method = async (...args) => {
    calls[name].push(args);
    return tx(logs);
  };
  method.staticCall = async (...args) => {
    calls[`static:${name}`].push(args);
    return result;
  };
  return method;
}

function fakeContract() {
  const calls = {
    placeBet: [],
    'static:placeBet': [],
    placeSlip: [],
    'static:placeSlip': [],
    enterBonusBattle: [],
    'static:enterBonusBattle': [],
    enterBonusDay: [],
    'static:enterBonusDay': [],
    buyFutureCrapsDays: [],
    'static:buyFutureCrapsDays': [],
    upgradeDayWindows: [],
    'static:upgradeDayWindows': [],
    resolveBets: [],
    'static:resolveBets': [],
  };
  const contract = {
    progressivePool: async () => 1_250_000n * 10n ** 18n,
    currentIndex: async () => 1842n,
    wordAt: async (index) => BigInt(index) === 1841n ? 99n : 0n,
    isResolved: async (index) => BigInt(index) === 1841n,
    survivedAt: async () => true,
    maxOddsFor: async () => 100n,
    rakeBpsFor: async () => 5000n,
    stakeFor: async () => 210n * 10n ** 18n,
    quote: async () => 630n * 10n ** 18n,
    theoFor: async () => 508n,
    betOf: async () => ({
      player: PLAYER,
      index: 1841n,
      hands: 3n,
      rakeBps: 5000n,
      settled: false,
      mode: 0n,
      staked: 630n * 10n ** 18n,
      goal: 0n,
      bets: BETS,
    }),
    previewSettlement: async () => ({ won: 381n, survived: true, paid: 762n }),
    shooterDice: async () => [4n, 4n, 3n, 4n],
    resolveHandAt: async () => ({ staked: 210n, returned: 250n, net: 40n }),
    resolveHandsAt: async () => ({ hands: 3n, returned: 700n, net: 70n }),
    resolveSlipAt: async () => ({ bankrollIn: 3000n, bankrollOut: 4200n, handsPlayed: 8n, stop: 1n }),
    placeBet: callable('placeBet', calls),
    placeSlip: callable('placeSlip', calls),
    enterBonusBattle: callable('enterBonusBattle', calls),
    enterBonusDay: callable('enterBonusDay', calls),
    buyFutureCrapsDays: callable('buyFutureCrapsDays', calls),
    upgradeDayWindows: callable('upgradeDayWindows', calls, 4_500n),
    resolveBets: callable('resolveBets', calls),
    connect() { return this; },
    _calls: calls,
  };
  return contract;
}

function fakeProvider() {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => PLAYER }),
  };
}

let contract;

beforeEach(() => {
  store.__resetForTest();
  store.update('connected.address', PLAYER);
  store.update('viewing.address', null);
  store.update('ui.mode', 'self');
  contracts.setProvider(fakeProvider());
  contract = fakeContract();
  craps.__setCrapsContractFactoryForTest(() => contract);
});

afterEach(() => {
  craps.__resetCrapsContractFactoryForTest();
  contracts.clearProvider();
  store.__resetForTest();
});

test('FlipCraps ABI exposes the complete front-end surface', () => {
  const iface = new contracts.ethers.Interface(craps.FLIP_CRAPS_ABI);
  for (const method of [
    'placeBet', 'placeSlip', 'resolveBets', 'currentIndex', 'wordAt', 'isResolved',
    'stakeFor', 'quote', 'theoFor', 'maxOddsFor', 'rakeBpsFor', 'betOf',
    'previewSettlement', 'survivedAt', 'shooterDice', 'resolveHandAt',
    'resolveHandsAt', 'resolveSlipAt', 'enterBonusBattle', 'enterBonusDay',
    'buyFutureCrapsDays', 'upgradeDayWindows',
    'progressivePool',
  ]) assert.ok(iface.getFunction(method), method);
  for (const event of [
    'CrapsBetPlaced', 'CrapsSlipPlaced', 'CrapsBetSettled', 'CrapsRakeback',
    'CrapsBonusOpened', 'CrapsBonusDonated',
  ]) {
    assert.ok(iface.getEvent(event), event);
  }
  assert.deepEqual(
    iface.getFunction('stakeFor').inputs[0].components.map((component) => component.name),
    ['passLine', 'dontPassLine', 'place4', 'place5', 'place6', 'place8', 'place9', 'place10', 'hard4', 'hard8', 'passOddsMult'],
  );
});

test('daily word derivation reproduces the seven published buy-ins, speeds, and goal multipliers', () => {
  const word = '102858562227254754036121703853225298402533986033002165985066946425924666406226';
  const day = craps.crapsBonusDayTerms(word);
  // Run-43 draw (audit 0b0ed9fb3): the scheduled depth is FIXED at 5 and the
  // goal is a two-way even draw between 5x and 20x on `(roll >> 32) % 2`.
  // Bankroll and bounty draws are untouched, so every buy-in (and the 17,300
  // day total) matches the pre-delta fixture.
  assert.deepEqual(day.windows.map(({ buyInFlip, bankMult, speedLabel, goalMult }) => ({
    buyInFlip, bankMult, speedLabel, goalMult,
  })), [
    { buyInFlip: 2_000n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 5 },
    { buyInFlip: 400n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 20 },
    { buyInFlip: 500n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 20 },
    { buyInFlip: 400n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 5 },
    { buyInFlip: 400n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 20 },
    { buyInFlip: 1_500n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 20 },
    { buyInFlip: 12_100n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 20 },
  ]);
  assert.equal(day.buyInFlip, 17_300n);
  assert.deepEqual(
    [day.minBankMult, day.maxBankMult, day.minGoalMult, day.maxGoalMult],
    [5, 5, 5, 20],
  );
});

test('opening logs supply the honest added-FLIP ceiling and include later donations', () => {
  const day = 42;
  const wei = 10n ** 18n;
  const key = `0x${'ab'.repeat(32)}`;
  const schedule = craps.crapsBonusScheduleFromLogs(day, [
    {
      parsed: {
        name: 'CrapsBonusOpened',
        args: {
          battleKey: key,
          slot: 337n,
          seed: 25_000n * wei,
          bankroll: 300n * wei,
          goal: 1_500n * wei,
          boardStake: 105n * wei,
          battleStake: 200n * wei,
        },
      },
    },
    {
      parsed: {
        name: 'CrapsBonusDonated',
        args: { battleKey: key, donor: PLAYER, amount: 500n * wei, seed: 500n * wei },
      },
    },
  ]);
  assert.equal(schedule.complete, false);
  assert.deepEqual(schedule.windows[0], {
    day: 42,
    period: 0,
    number: 1,
    slot: '337',
    battleKey: key,
    event: false,
    tier: 1,
    bankrollFlip: 300n,
    battleStakeFlip: 200n,
    buyInFlip: 500n,
    playedFlip: 150n,
    postedStakeFlip: 105n,
    goalFlip: 1_500n,
    bankMult: 2,
    speedLabel: 'TURBO',
    goalMult: 5,
    houseAddedFlipWei: 25_000n * wei,
    donatedFlipWei: 500n * wei,
    addedFlipWei: 25_500n * wei,
  });
});

test('lobby history resolves current winners and yesterday exact protocol boost', () => {
  const day = 42;
  const wei = 10n ** 18n;
  const currentKey = `0x${'c1'.padStart(64, '0')}`;
  const currentIndex = '777';
  const currentWord = 123_456n;
  const dayTicketBetId = (336n << 64n) | 3n;
  const previous = Array.from({ length: 7 }, (_, period) => ({
    key: `0x${(1000 + period).toString(16).padStart(64, '0')}`,
    index: String(900 + period),
    word: BigInt(50_000 + period),
    ceiling: BigInt(40_000 + (period * 10_000)) * wei,
  }));
  const logs = [
    {
      parsed: {
        name: 'CrapsBonusOpened',
        args: {
          battleKey: currentKey,
          slot: 337n,
          seed: 25_000n * wei,
          bankroll: 300n * wei,
          goal: 1_500n * wei,
          boardStake: 105n * wei,
          battleStake: 200n * wei,
        },
      },
    },
    {
      parsed: {
        name: 'CrapsSlipPlaced',
        args: { player: PLAYER, bet: dayTicketBetId << 32n },
      },
    },
    {
      parsed: {
        name: 'CrapsDayWindowsUpgraded',
        args: { player: PLAYER, day: 42n, upgradedMask: 0b0000101n, burned: 4_500n * wei },
      },
    },
    {
      parsed: {
        name: 'CrapsDayReserved',
        args: { player: PLAYER, day: 43n, highRoller: true },
      },
    },
    {
      parsed: {
        name: 'CrapsBonusArmed',
        args: { battleKey: currentKey, slot: 337n, index: BigInt(currentIndex) },
      },
    },
    {
      parsed: {
        name: 'CrapsBattlePaid',
        args: { betId: 77n, battleKey: currentKey, player: PLAYER, amount: 12_300n * wei },
      },
    },
    ...previous.flatMap(({ key, index, ceiling }) => ([
      {
        parsed: {
          name: 'CrapsBonusOpened',
          args: { battleKey: key, slot: 329n + BigInt(index) - 900n, seed: ceiling },
        },
      },
      {
        parsed: {
          name: 'CrapsBonusArmed',
          args: { battleKey: key, slot: 329n + BigInt(index) - 900n, index: BigInt(index) },
        },
      },
    ])),
  ];
  const wordsByIndex = new Map([
    ...previous.map(({ index, word }) => [index, word]),
    [currentIndex, currentWord],
  ]);
  const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs, { wordsByIndex, player: PLAYER });
  const expectedAdded = previous.reduce((sum, window) => sum + craps.crapsRealizedBoostWei({
    ceilingWei: window.ceiling,
    battleKey: window.key,
    wordValue: window.word,
  }), 0n);

  assert.equal(snapshot.results[0].winner, PLAYER);
  assert.equal(snapshot.results[0].amountWei, 12_300n * wei);
  assert.equal(snapshot.results[0].boostWei, craps.crapsRealizedBoostWei({
    ceilingWei: 25_000n * wei,
    battleKey: currentKey,
    wordValue: currentWord,
  }));
  assert.equal(snapshot.results.slice(1).every((result) => result == null), true);
  assert.equal(snapshot.playerEntries.days['42'].highMask, 0b0000101);
  assert.equal(snapshot.playerEntries.days['43'].highMask, 0x7F);
  assert.equal(snapshot.playerEntries.windows.every((entry) => entry == null), true);
  assert.equal(snapshot.yesterdayDay, 41);
  assert.equal(snapshot.yesterdayComplete, true);
  assert.equal(snapshot.yesterdayAddedWei, expectedAdded);
  assert.deepEqual(snapshot.requiredWordIndexes, [...previous.map(({ index }) => index), currentIndex]);
  assert.equal(snapshot.yesterdayAddedWei % (100n * wei), 0n, 'the contract floors boosts to 100-FLIP granules');
});

test('lobby entry history scopes a direct High Roller seat to the connected wallet', () => {
  const day = 42;
  const period = 5;
  const slot = BigInt(day * 8 + period + 1);
  const betId = (slot << 64n) | 9n;
  const packedEventBet = 0x1241111n | (betId << 32n) | (9n << 160n);
  const logs = [{
    parsed: {
      name: 'CrapsSlipPlaced',
      args: { player: PLAYER, bet: packedEventBet },
    },
  }];

  const own = craps.crapsLobbySnapshotFromLogs(day, logs, { player: PLAYER });
  assert.deepEqual(own.playerEntries.windows[period], {
    day,
    period,
    source: 'window',
    multiple: 10,
    high: true,
  });
  assert.equal(own.playerEntries.windows.filter(Boolean).length, 1);
  assert.deepEqual(own.playerEntries.days, {});

  const other = craps.crapsLobbySnapshotFromLogs(day, logs, {
    player: '0x00000000000000000000000000000000000000bb',
  });
  assert.equal(other.playerEntries.windows.every((entry) => entry == null), true);
});

test('finalized direct and day-ticket seats retain viewer ids for pending replays', () => {
  const day = 42;
  const priorDaySlot = 41n * 8n;
  const priorBetId = (priorDaySlot << 64n) | 4n;
  const priorBattleSlot = priorDaySlot + 1n;
  const priorKey = `0x${'41'.padStart(64, '0')}`;
  const directBattleSlot = 42n * 8n + 2n;
  const directBetId = (directBattleSlot << 64n) | 9n;
  const directKey = `0x${'42'.padStart(64, '0')}`;
  const pendingBattleSlot = 42n * 8n + 3n;
  const pendingBetId = (pendingBattleSlot << 64n) | 10n;
  const pendingKey = `0x${'43'.padStart(64, '0')}`;
  const otherBattleSlot = 42n * 8n + 4n;
  const otherBetId = (otherBattleSlot << 64n) | 11n;
  const otherKey = `0x${'44'.padStart(64, '0')}`;
  const wei = 10n ** 18n;
  const pack = (betId) => betId << 32n;
  const opened = (battleKey, slot) => ({
    battleKey,
    slot,
    seed: 25_000n * wei,
    bankroll: 300n * wei,
    goal: 1_500n * wei,
    boardStake: 105n * wei,
    battleStake: 200n * wei,
  });
  const logs = [
    { parsed: { name: 'CrapsSlipPlaced', args: { player: PLAYER, bet: pack(priorBetId) } } },
    { parsed: { name: 'CrapsSlipPlaced', args: { player: PLAYER, bet: pack(directBetId) } } },
    { parsed: { name: 'CrapsSlipPlaced', args: { player: PLAYER, bet: pack(pendingBetId) } } },
    { parsed: { name: 'CrapsSlipPlaced', args: { player: '0x00000000000000000000000000000000000000cc', bet: pack(otherBetId) } } },
    { parsed: { name: 'CrapsBonusOpened', args: opened(priorKey, priorBattleSlot) } },
    { parsed: { name: 'CrapsBonusOpened', args: opened(directKey, directBattleSlot) } },
    { parsed: { name: 'CrapsBonusOpened', args: opened(pendingKey, pendingBattleSlot) } },
    { parsed: { name: 'CrapsBonusOpened', args: opened(otherKey, otherBattleSlot) } },
    {
      parsed: {
        name: 'CrapsBattleFinalized',
        args: { battleKey: priorKey, winningStop: 1n, winnerId: 2n, winningPeak: 4_000n, winningEnd: 3_200n, winningScoreBps: 130_000n, pot: 900n },
      },
    },
    {
      parsed: {
        name: 'CrapsBattleFinalized',
        args: { battleKey: directKey, winningStop: 0n, winnerId: 9n, winningPeak: 9_000n, winningEnd: 9_000n, winningScoreBps: 300_000n, pot: 1_200n },
      },
    },
    {
      parsed: {
        name: 'CrapsBattleFinalized',
        args: { battleKey: otherKey, winningStop: 1n, winnerId: 11n, winningPeak: 600n, winningEnd: 150n, winningScoreBps: 20_000n, pot: 300n },
      },
    },
  ];

  const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs, { player: PLAYER });
  assert.deepEqual(snapshot.resolvedReplays, [
    {
      day: 41,
      period: 0,
      slot: priorBattleSlot.toString(),
      battleKey: priorKey,
      viewerBetId: priorBetId.toString(),
      winningStop: 1,
      winnerId: '2',
      winningPeakWei: '4000',
      winningEndWei: '3200',
      winningScoreBps: 130000,
      potWei: '900',
      winner: null,
      amountWei: null,
    },
    {
      day: 42,
      period: 1,
      slot: directBattleSlot.toString(),
      battleKey: directKey,
      viewerBetId: directBetId.toString(),
      winningStop: 0,
      winnerId: '9',
      winningPeakWei: '9000',
      winningEndWei: '9000',
      winningScoreBps: 300000,
      potWei: '1200',
      winner: null,
      amountWei: null,
    },
  ]);
});

test('table, perk, quote, bet, preview, dice, and breakdown reads normalize chain values', async () => {
  assert.deepEqual(await craps.readCrapsTable({ index: 1841 }), {
    available: true,
    currentIndex: '1842',
    index: '1841',
    resolved: true,
    word: '99',
    survived: true,
  });
  assert.deepEqual(await craps.readCrapsPerks(PLAYER), { available: true, maxOdds: 100, rakeBps: 5000 });
  assert.equal(await craps.readCrapsProgressivePool(), '1250000000000000000000000');
  assert.deepEqual(await craps.readCrapsQuote({ bets: BETS, hands: 3 }), {
    stakeWei: '210000000000000000000',
    quoteWei: '630000000000000000000',
    theoPerHandWei: '508',
  });
  assert.equal((await craps.readCrapsBet(7)).staked, '630000000000000000000');
  assert.deepEqual(await craps.previewCrapsSettlement(7), { won: '381', survived: true, paid: '762' });
  assert.deepEqual(await craps.readCrapsShooterDice(1841, 0), [
    { d1: 4, d2: 4, total: 8, hard: true },
    { d1: 3, d2: 4, total: 7, hard: false },
  ]);
  assert.deepEqual(await craps.readCrapsBreakdown({ bets: BETS, index: 1841, hands: 1 }), {
    staked: '210', returned: '250', net: '40',
  });
  assert.deepEqual(await craps.readCrapsBreakdown({
    bets: BETS,
    index: 1841,
    mode: 'ride',
    bankrollWei: 3000,
    goalWei: 9000,
  }), {
    bankrollIn: '3000', bankrollOut: '4200', handsPlayed: '8', stop: '1',
  });
});

test('fixed placement and permissionless settlement both preflight and use sendTx closure paths', async () => {
  await craps.placeCrapsWager({ valid: true, method: 'placeBet', contractArgs: [BETS, 3] });
  assert.deepEqual(contract._calls['static:placeBet'], [[BETS, 3]]);
  assert.deepEqual(contract._calls.placeBet, [[BETS, 3]]);

  await craps.resolveCrapsBets({ betIds: ['7', 8n] });
  assert.deepEqual(contract._calls['static:resolveBets'], [[[7n, 8n]]]);
  assert.deepEqual(contract._calls.resolveBets, [[[7n, 8n]]]);
});

test('scheduled battle, live day, future day, and upgrades use their distinct contract doors', async () => {
  await craps.placeCrapsBonusEntry({
    valid: true,
    method: 'enterBonusBattle',
    contractArgs: [3, 0x1241111, 1],
  });
  assert.deepEqual(contract._calls['static:enterBonusBattle'], [[3, 0x1241111, 1]]);
  assert.deepEqual(contract._calls.enterBonusBattle, [[3, 0x1241111, 1]]);

  await craps.placeCrapsBonusEntry({
    valid: true,
    method: 'enterBonusDay',
    contractArgs: [0x1241111, 1],
  });
  assert.deepEqual(contract._calls['static:enterBonusDay'], [[0x1241111, 1]]);
  assert.deepEqual(contract._calls.enterBonusDay, [[0x1241111, 1]]);

  await craps.placeCrapsBonusEntry({
    valid: true,
    method: 'buyFutureCrapsDays',
    contractArgs: [43, 1, true, 0x1241111],
  });
  assert.deepEqual(contract._calls['static:buyFutureCrapsDays'], [[43, 1, true, 0x1241111]]);
  assert.deepEqual(contract._calls.buyFutureCrapsDays, [[43, 1, true, 0x1241111]]);

  await craps.upgradeCrapsDayWindows({ day: 42, periodMask: 0b0010101 });
  assert.deepEqual(contract._calls['static:upgradeDayWindows'], [[42, 0b0010101]]);
  assert.deepEqual(contract._calls.upgradeDayWindows, [[42, 0b0010101]]);
});

test('settlement receipt parsing preserves the replay log and survival result', () => {
  const parsed = craps.parseCrapsReceipt({ logs: [
    { parsed: { name: 'CrapsBetPlaced', args: { betId: 7n, player: PLAYER, index: 1841n, hands: 3n, staked: 630n } } },
    { parsed: { name: 'CrapsBetSettled', args: { betId: 7n, player: PLAYER, staked: 630n, won: 381n, survived: true, paid: 762n, rolls: '0x443400' } } },
    { parsed: { name: 'CrapsRakeback', args: { player: PLAYER, betId: 7n, amount: 12n } } },
  ] });
  assert.equal(parsed.placed[0].index, '1841');
  assert.equal(parsed.settled[0].survived, true);
  assert.equal(parsed.settled[0].rolls, '0x443400');
  assert.equal(parsed.rakeback[0].amount, '12');
});

test('contract errors map to actionable craps copy', () => {
  assert.match(reasonMap.decodeRevertReason({ revert: { name: 'IndexAlreadyRevealed' } }).userMessage, /already rolled/i);
  assert.match(reasonMap.decodeRevertReason({ revert: { name: 'OddsAboveAllowance' } }).userMessage, /odds/i);
  assert.match(reasonMap.decodeRevertReason({ revert: { name: 'BadGoal' } }).userMessage, /twice/i);
  assert.match(reasonMap.decodeRevertReason({ revert: { name: 'NothingToUpgrade' } }).userMessage, /already/i);
});
