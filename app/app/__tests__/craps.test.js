import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { ethers } from '../contracts.js';
import * as contracts from '../contracts.js';
import { CHAIN, CONTRACTS } from '../chain-config.js';
import * as craps from '../craps.js';
import * as crapsResults from '../craps-results.js';
import * as reasonMap from '../reason-map.js';
import * as store from '../store.js';

// The craps window mirrors itself to localStorage so a reload pays a 12-block
// tail instead of the whole lookback. node has no Web Storage without a flag,
// so the suite supplies a real (enumerable) in-memory one.
if (typeof globalThis.localStorage === 'undefined') {
  const cells = new Map();
  globalThis.localStorage = {
    get length() { return cells.size; },
    key: (index) => [...cells.keys()][index] ?? null,
    getItem: (key) => (cells.has(String(key)) ? cells.get(String(key)) : null),
    setItem: (key, value) => { cells.set(String(key), String(value)); },
    removeItem: (key) => { cells.delete(String(key)); },
    clear: () => { cells.clear(); },
  };
}

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

// Only what the deployed CrapsBattle actually answers. A stub that also carries
// the old TABLE surface is how the missing `wordAt` stayed invisible for a whole
// run: the unit tests answered a call the chain reverts.
function fakeContract() {
  const calls = {
    amendSlip: [],
    'static:amendSlip': [],
    enterBonusBattle: [],
    'static:enterBonusBattle': [],
    enterBonusDay: [],
    'static:enterBonusDay': [],
    buyFutureCrapsDays: [],
    'static:buyFutureCrapsDays': [],
    applyCrapsPasses: [],
    'static:applyCrapsPasses': [],
    upgradeDayWindows: [],
    'static:upgradeDayWindows': [],
  };
  const contract = {
    progressivePool: async () => 1_250_000n * 10n ** 18n,
    previewSettlement: async () => ({ won: 381n, paid: 762n }),
    amendSlip: callable('amendSlip', calls),
    enterBonusBattle: callable('enterBonusBattle', calls),
    enterBonusDay: callable('enterBonusDay', calls),
    buyFutureCrapsDays: callable('buyFutureCrapsDays', calls),
    applyCrapsPasses: callable('applyCrapsPasses', calls),
    upgradeDayWindows: callable('upgradeDayWindows', calls, 4_500n),
    connect() { return this; },
    _calls: calls,
  };
  return contract;
}

function fakeProvider() {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => PLAYER }),
    getStorage: async () => '0x0000000000000000000000000000000000000000000000000000000200000011',
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

test('the craps ABI names only functions the deployed contract actually has', () => {
  const iface = new contracts.ethers.Interface(craps.FLIP_CRAPS_ABI);
  // Verified against the CrapsBattle artifact whose runtime bytecode matches the
  // deployed contract byte for byte. These are the doors the app uses.
  for (const method of [
    'amendSlip', 'enterBonusBattle', 'enterBonusDay', 'applyCrapsPasses', 'buyFutureCrapsDays',
    'upgradeDayWindows', 'progressivePool', 'previewSettlement',
  ]) assert.ok(iface.getFunction(method), method);
  assert.deepEqual(
    iface.getFunction('previewSettlement').outputs.map((o) => o.name),
    ['won', 'paid'],
    'previewSettlement returns two values, not the old (won, survived, paid)',
  );
  for (const event of [
    'CrapsSlipPlaced', 'CrapsSlipAmended', 'CrapsBetSettled', 'CrapsBonusOpened', 'CrapsBonusDonated',
    'CrapsBonusArmed', 'CrapsBattleFinalized', 'CrapsBattlePaid',
    'CrapsHighRollerDayOpened', 'CrapsHighRollerPaid', 'CrapsDayReserved',
    'CrapsDayWindowsUpgraded', 'CrapsProgressiveFunded',
  ]) assert.ok(iface.getEvent(event), event);

  // ⛔ THE GUARD. CrapsBattle sits a few hundred bytes under EIP-170 and the
  // whole standalone TABLE surface was cut to fit. Every name below reverts with
  // NO revert data on the deployed contract, and every caller swallows that — so
  // a stale entry surfaces as a panel stuck on a dash, never as an error.
  for (const absent of [
    'wordAt', 'currentIndex', 'isResolved', 'survivedAt', 'shooterDice', 'betOf',
    'resolveBets', 'maxOddsFor', 'rakeBpsFor', 'placeBet', 'placeSlip', 'stakeFor',
    'quote', 'theoFor', 'resolveHandAt', 'resolveHandsAt', 'resolveSlipAt',
  ]) {
    assert.equal(
      iface.getFunction(absent),
      null,
      `${absent} is not on the deployed contract and must not be in the ABI`,
    );
  }
  for (const absent of ['CrapsBetPlaced', 'CrapsRakeback']) {
    assert.equal(iface.getEvent(absent), null, absent);
  }
});

test('daily word derivation reproduces the seven published buy-ins, speeds, and goal multipliers', () => {
  const word = '102858562227254754036121703853225298402533986033002165985066946425924666406226';
  const day = craps.crapsBonusDayTerms(word);
  // Run-45 rules (audit 0880d134c): the scheduled depth is FIXED at 5 and the goal is FIXED at
  // 5x — the old two-way `(roll >> 32) % 2` draw is gone from the contract, so every window
  // reads 5 and the derivation must not consume those roll bits. Bankroll and bounty draws are
  // untouched, so every buy-in (and the 17,300 day total) matches the pre-delta fixture.
  assert.deepEqual(day.windows.map(({ buyInFlip, bankMult, speedLabel, goalMult }) => ({
    buyInFlip, bankMult, speedLabel, goalMult,
  })), [
    { buyInFlip: 2_000n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 5 },
    { buyInFlip: 400n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 5 },
    { buyInFlip: 500n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 5 },
    { buyInFlip: 400n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 5 },
    { buyInFlip: 400n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 5 },
    { buyInFlip: 1_500n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 5 },
    { buyInFlip: 12_100n, bankMult: 5, speedLabel: 'NORMAL', goalMult: 5 },
  ]);
  assert.equal(day.buyInFlip, 17_300n);
  assert.deepEqual(
    [day.minBankMult, day.maxBankMult, day.minGoalMult, day.maxGoalMult],
    [5, 5, 5, 5],
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

test('the narrow Added read combines battle and Run It Up funding with one-log fallback', () => {
  const wei = 10n ** 18n;
  assert.equal(craps.crapsAddedPerDayFromLogs(46, [
    { parsed: { name: 'CrapsHighRollerDayOpened', args: { day: 46n, mainBoostBudget: 32_000n * wei } } },
    { parsed: { name: 'CrapsProgressiveFunded', args: { day: 46n, contribution: 32_001n * wei } } },
  ]), 64_001n * wei, 'both contract halves are included');
  assert.equal(craps.crapsAddedPerDayFromLogs(46, [
    { parsed: { name: 'CrapsProgressiveFunded', args: { day: 46n, contribution: 32_000n * wei } } },
  ]), 64_000n * wei, 'either adjacent funding log can recover the whole-FLIP headline');
  assert.equal(craps.crapsAddedPerDayFromLogs(46, [
    { parsed: { name: 'CrapsHighRollerDayOpened', args: { day: 45n, mainBoostBudget: 25_000n * wei } } },
  ]), 50_000n * wei, 'the prior day remains a safe per-day fallback during rollover');
});

test('lobby history resolves current winners and yesterday exact protocol boost', () => {
  const day = 42;
  const wei = 10n ** 18n;
  const currentKey = `0x${'c1'.padStart(64, '0')}`;
  const currentIndex = '777';
  const currentWord = 123_456n;
  const dayTicketBetId = (336n << 64n) | 3n;
  // Tiers 1/1/2/1/3/1 across the six routine windows weigh 1+1+2+1+4+1 = 10;
  // the event window takes half the budget outright and carries no weight.
  const bankrolls = [300n, 300n, 1_200n, 300n, 3_000n, 300n, 15_000n];
  const previous = Array.from({ length: 7 }, (_, period) => ({
    key: `0x${(1000 + period).toString(16).padStart(64, '0')}`,
    index: String(900 + period),
    word: BigInt(50_000 + period),
    ceiling: BigInt(40_000 + (period * 10_000)) * wei,
    bankroll: bankrolls[period] * wei,
  }));
  // Exactly ONE of yesterday's windows actually seated a high roller, so only
  // that one may carry a side-lane boost however large the day's budget was.
  const highLanePeriod = 4; // bankroll 3,000 -> tier 3, weight 4 of the day's 10
  const highBudget = 40_000n * wei;
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
        name: 'CrapsBattleFinalized',
        args: {
          battleKey: currentKey, winningStop: 0n, winnerId: 3n, winningPeak: 0n,
          winningEnd: 0n, winningScoreBps: 0n, pot: 12_400n * wei,
        },
      },
    },
    {
      parsed: {
        name: 'CrapsProgressiveRolled',
        args: { battleKey: currentKey, source: 1n, amount: 100n * wei, balance: 900n * wei },
      },
    },
    {
      parsed: {
        name: 'CrapsBattlePaid',
        args: { betId: 77n, battleKey: currentKey, player: PLAYER, amount: 12_300n * wei },
      },
    },
    {
      parsed: {
        name: 'CrapsHighRollerDayOpened',
        args: { day: 41n, multiplier: 10n, mainBoostBudget: 25_000n * wei, highRollerBoostBudget: highBudget },
      },
    },
    {
      parsed: {
        name: 'CrapsProgressiveFunded',
        args: { day: 41n, contribution: 25_000n * wei, balance: 1_500_000n * wei },
      },
    },
    {
      parsed: {
        name: 'CrapsHighRollerDayOpened',
        args: { day: 42n, multiplier: 10n, mainBoostBudget: 25_000n * wei, highRollerBoostBudget: 0n },
      },
    },
    ...previous.flatMap(({ key, index, ceiling, bankroll }, period) => ([
      {
        parsed: {
          name: 'CrapsBonusOpened',
          args: {
            battleKey: key,
            slot: 329n + BigInt(index) - 900n,
            seed: ceiling,
            bankroll,
            battleStake: 200n * wei,
          },
        },
      },
      {
        parsed: {
          name: 'CrapsBonusArmed',
          args: { battleKey: key, slot: 329n + BigInt(index) - 900n, index: BigInt(index) },
        },
      },
      // A side lane only counts once the field it ran in has closed.
      {
        parsed: {
          name: 'CrapsBattleFinalized',
          args: {
            battleKey: key, winningStop: 1n, winnerId: 1n, winningPeak: 0n,
            winningEnd: 0n, winningScoreBps: 0n, pot: 0n,
          },
        },
      },
      // A CONTESTED lane — its boost is paid straight into the lane pot.
      ...(period === highLanePeriod ? [{
        parsed: {
          name: 'CrapsHighRollerPaid',
          args: { betId: 5n, battleKey: key, player: PLAYER, amount: 900n * wei, bankrollRider: false },
        },
      }] : []),
      // A SOLE lane elsewhere in the same day. Its boost RODE that seat's own run
      // and paid zero, and it still counts in full: the figure is what the house
      // committed, not what the dice returned.
      ...(period === 1 ? [{
        parsed: {
          name: 'CrapsHighRollerPaid',
          args: { betId: 6n, battleKey: key, player: PLAYER, amount: 0n, bankrollRider: true },
        },
      }] : []),
    ])),
    {
      parsed: {
        name: 'CrapsBattlePaid',
        args: {
          betId: 88n,
          battleKey: previous[6].key,
          player: '0x00000000000000000000000000000000000000ee',
          amount: 98_700n * wei,
        },
      },
    },
  ];
  const wordsByIndex = new Map([
    ...previous.map(({ index, word }) => [index, word]),
    [currentIndex, currentWord],
  ]);
  const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs, { wordsByIndex, player: PLAYER });
  const expectedMain = previous.reduce((sum, window) => sum + craps.crapsRealizedBoostWei({
    ceilingWei: window.ceiling,
    battleKey: window.key,
    wordValue: window.word,
  }), 0n);
  // BOTH lanes count, at the capital the house put up. The contested one paid its
  // boost into the lane pot; the sole one staked it on a run that busted — and a
  // busted ride does not un-commit the money.
  const laneBoost = (period, tier) => craps.crapsRealizedBoostFromBaseWei({
    // half the 40,000 budget is 20,000, split across the day's routine weight of 10.
    baseWei: craps.crapsWindowShareWei(highBudget, 10n, period, tier),
    battleKey: previous[period].key,
    wordValue: previous[period].word,
  });
  const contestedHigh = laneBoost(highLanePeriod, 3);   // bankroll 3,000 -> tier 3
  const soleHigh = laneBoost(1, 1);                     // bankroll   300 -> tier 1
  const expectedHigh = contestedHigh + soleHigh;
  const expectedHighAverage = craps.crapsWindowShareWei(highBudget, 10n, highLanePeriod, 3)
    + craps.crapsWindowShareWei(highBudget, 10n, 1, 1);

  assert.equal(snapshot.results[0].winner, PLAYER);
  assert.equal(snapshot.results[0].betId, '77');
  assert.equal(snapshot.results[0].amountWei, 12_300n * wei);
  assert.equal(snapshot.results[0].boostWei, craps.crapsRealizedBoostWei({
    ceilingWei: 25_000n * wei,
    battleKey: currentKey,
    wordValue: currentWord,
  }));
  assert.equal(snapshot.results[0].winningStop, 0);
  assert.equal(snapshot.results[0].buyInWei, 500n * wei);
  assert.equal(snapshot.results[0].highMultiple, 10);
  assert.equal(
    snapshot.results[0].winnerBoostWei,
    0n,
    'the winner receipt never shows a negative boost when the rollover exceeds the realized main boost',
  );
  assert.equal(snapshot.results.slice(1).every((result) => result == null), true);
  assert.equal(snapshot.playerEntries.days['42'].highMask, 0b0000101);
  assert.equal(snapshot.playerEntries.days['42'].betId, dayTicketBetId.toString());
  assert.equal(snapshot.playerEntries.days['42'].chips, 0);
  assert.equal(snapshot.playerEntries.days['43'].highMask, 0x7F);
  assert.equal(snapshot.playerEntries.windows.every((entry) => entry == null), true);
  assert.equal(snapshot.yesterdayDay, 41);
  assert.deepEqual(snapshot.yesterdayEventResult, {
    day: 41,
    period: 6,
    battleKey: previous[6].key,
    betId: '88',
    winner: '0x00000000000000000000000000000000000000ee',
    amountWei: 98_700n * wei,
    winningStop: 1,
    buyInWei: (bankrolls[6] + 200n) * wei,
    highMultiple: 10,
    entryMultiple: null,
    bonusMultiplier: craps.crapsBonusMultiplier({
      battleKey: previous[6].key,
      wordValue: previous[6].word,
    }),
    mainBoostWei: craps.crapsRealizedBoostWei({
      ceilingWei: previous[6].ceiling,
      battleKey: previous[6].key,
      wordValue: previous[6].word,
    }),
    winnerBoostWei: craps.crapsRealizedBoostWei({
      ceilingWei: previous[6].ceiling,
      battleKey: previous[6].key,
      wordValue: previous[6].word,
    }),
    // Nothing was split into passes in this fixture.
    winnerPassWei: 0n,
    progressivePaidWei: 0n,
    // The event window ran no high lane, so its side figure is a known zero.
    highBoostWei: 0n,
    boostWei: craps.crapsRealizedBoostWei({
      ceilingWei: previous[6].ceiling,
      battleKey: previous[6].key,
      wordValue: previous[6].word,
    }),
  });
  assert.equal(snapshot.yesterdayComplete, true);
  // The banner says ALL POTS, so both side lanes belong in the total.
  assert.ok(contestedHigh > 0n, 'the fixture must exercise a contested side lane');
  assert.ok(soleHigh > 0n, 'the fixture must exercise a SOLE side lane too');
  // ⛔ THE SOLE LANE PAID ZERO and must still be counted in full: the figure is
  // what the house committed, never what the dice returned. Dropping it here is
  // what made day 15 of run #43 read 565k instead of 1.33M.
  assert.equal(snapshot.yesterdayAddedHighWei, expectedHigh, 'a busted sole ride was dropped from the total');
  assert.equal(snapshot.yesterdayAddedMainWei, expectedMain);
  assert.equal(snapshot.yesterdayAddedHighWei, expectedHigh);
  assert.equal(snapshot.yesterdayAddedWei, expectedMain + expectedHigh);
  assert.equal(snapshot.yesterdayProgressiveFundedWei, 25_000n * wei,
    'the separate daily Run It Up contribution is retained without counting ladder rollovers twice');
  assert.equal(snapshot.yesterdayTotalAddedWei, expectedMain + expectedHigh + (25_000n * wei));
  assert.equal(snapshot.yesterdayAverageAddedWei,
    (25_000n * wei) + expectedHighAverage + (25_000n * wei));
  assert.equal(snapshot.todayAverageAddedWei, 50_000n * wei,
    'today\'s average includes the matching Run It Up half even when a bounded live log window omits its funded echo');
  assert.deepEqual(snapshot.requiredWordIndexes, [...previous.map(({ index }) => index), currentIndex]);
  assert.equal(snapshot.yesterdayAddedWei % (100n * wei), 0n, 'the contract floors boosts to 100-FLIP granules');
  // Day 42 banked no high action, so today's settled row carries a main-lane
  // figure and a side lane of exactly zero rather than an unknown.
  assert.equal(snapshot.results[0].highBoostWei, 0n);
  assert.equal(snapshot.results[0].boostWei, snapshot.results[0].mainBoostWei);
});

test('lobby history preserves the High Roller payment and sole-rider goal verdict', () => {
  const day = 42;
  const wei = 10n ** 18n;
  const mainWinner = '0x0000000000000000000000000000000000000011';
  const contestedWinner = '0x0000000000000000000000000000000000000022';
  const soleWinner = '0x0000000000000000000000000000000000000033';
  const keys = [
    `0x${'aa'.repeat(32)}`,
    `0x${'bb'.repeat(32)}`,
    `0x${'cc'.repeat(32)}`,
  ];
  const logs = [
    {
      parsed: {
        name: 'CrapsHighRollerDayOpened',
        args: { day: 42n, multiplier: 10n, mainBoostBudget: 0n, highRollerBoostBudget: 0n },
      },
    },
    ...keys.flatMap((battleKey, period) => ([
      {
        parsed: {
          name: 'CrapsBonusOpened',
          args: {
            battleKey,
            slot: BigInt(day * 8 + period + 1),
            seed: 0n,
            bankroll: 300n * wei,
            goal: 1_500n * wei,
            boardStake: 105n * wei,
            battleStake: 200n * wei,
          },
        },
      },
      {
        parsed: {
          name: 'CrapsBattleFinalized',
          args: {
            battleKey, winningStop: 1n, winnerId: 1n, winningPeak: 1_500n,
            winningEnd: 1_500n, winningScoreBps: 50_000n, pot: 5_000n * wei,
          },
        },
      },
      {
        parsed: {
          name: 'CrapsBattlePaid',
          args: { betId: BigInt(100 + period), battleKey, player: mainWinner, amount: 5_000n * wei },
        },
      },
      {
        parsed: {
          name: 'CrapsHighRollerPaid',
          args: period === 0
            ? {
                betId: 201n, battleKey, player: contestedWinner,
                amount: 9_000n * wei, bankrollRider: false,
              }
            : {
                betId: BigInt(202 + period), battleKey, player: soleWinner,
                amount: period === 1 ? 12_000n * wei : 0n, bankrollRider: true,
              },
        },
      },
    ])),
  ];

  const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs);
  assert.deepEqual(snapshot.results[0].highResult, {
    betId: '201',
    winner: contestedWinner,
    amountWei: 9_000n * wei,
    bankrollRider: false,
    winningStop: null,
    entryMultiple: 10,
    winnerBoostWei: null,
    // No CrapsProtocolAwardSplit in this fixture, so nothing of the lane award was
    // paid in passes. Zero, not null: absence of a split is a known zero, not unknown.
    winnerPassWei: 0n,
  }, 'a contested lane exposes its own comparator winner and prize');
  assert.equal(snapshot.results[1].highResult.winner, soleWinner);
  assert.equal(snapshot.results[1].highResult.winningStop, 1,
    'a non-zero sole rider payment proves that its run latched the goal');
  assert.equal(snapshot.results[2].highResult.winningStop, 0,
    'the required zero rider event proves that the sole run missed the goal');
});

test('lobby winners retain their paid multiple and chain-native Run It Up award', () => {
  const day = 86;
  const period = 3;
  const slot = BigInt(day * 8 + period + 1);
  const betId = (slot << 64n) | 4n;
  const wei = 10n ** 18n;
  const battleKey = `0x${'de'.repeat(32)}`;
  const winner = '0xffae3d078f451bc206a69ad77c94a6ee999de61a';
  const snapshot = craps.crapsLobbySnapshotFromLogs(day, [
    {
      parsed: {
        name: 'CrapsHighRollerDayOpened',
        args: { day: BigInt(day), multiplier: 100n, mainBoostBudget: 0n, highRollerBoostBudget: 0n },
      },
    },
    {
      parsed: {
        name: 'CrapsBonusOpened',
        args: {
          battleKey,
          slot,
          seed: 0n,
          bankroll: 400n * wei,
          goal: 2_000n * wei,
          boardStake: 140n * wei,
          battleStake: 200n * wei,
        },
      },
    },
    {
      parsed: {
        name: 'CrapsSlipPlaced',
        args: {
          player: winner,
          bet: (betId << 32n) | (99n << 160n),
        },
      },
    },
    {
      parsed: {
        name: 'CrapsBattleFinalized',
        args: {
          battleKey,
          winningStop: 1n,
          winnerId: 4n,
          winningPeak: 10_000n,
          winningEnd: 8_000n,
          winningScoreBps: 250_000n,
          pot: 8_300n * wei,
        },
      },
    },
    {
      parsed: {
        name: 'CrapsBattlePaid',
        args: { betId, battleKey, player: winner, amount: 8_300n * wei },
      },
    },
    {
      parsed: {
        name: 'CrapsProgressivePaid',
        args: {
          betId,
          battleKey,
          player: winner,
          rare: false,
          poolBps: 500n,
          peak: 10_000n,
          scoreBps: 250_000n,
          candidate: 60_000n * wei,
          paid: 60_000n * wei,
          balance: 1_140_000n * wei,
        },
      },
    },
  ]);

  assert.equal(snapshot.results[period].entryMultiple, 100,
    'the shared main-field row remembers that its winner bought a 100x seat');
  assert.equal(snapshot.results[period].progressivePaidWei, 60_000n * wei,
    'the finalization log is enough to identify a Run It Up hit');

  const enriched = craps.crapsLobbySnapshotWithWinnerTotals(snapshot, [{
    day,
    period,
    battleKey,
    lane: 'main',
    betId: betId.toString(),
    winner,
    bankrollRider: null,
    runPaidWei: 400_000n * wei,
    battlePaidWei: 8_300n * wei,
    highPaidWei: 0n,
    progressivePaidWei: 0n,
    totalWonWei: 408_300n * wei,
  }]);
  assert.equal(enriched.results[period].progressivePaidWei, 60_000n * wei,
    'a stale indexed zero cannot erase a positive chain event');
  assert.equal(enriched.results[period].totalWonWei, 468_300n * wei,
    'the total is recomputed with the authoritative progressive amount');
});

test('a day budget splits across its windows exactly as _windowShare does', () => {
  const wei = 10n ** 18n;
  const budget = 40_000n * wei;
  // Six routine windows at tiers 1/1/2/1/3/1 weigh 1+1+2+1+4+1 = 10.
  const windows = [1, 1, 2, 1, 3, 1, 0].map((tier) => ({ tier }));
  assert.equal(craps.crapsRoutineWeight(windows), 10n);
  // The day's EVENT window — the last — takes HALF the budget outright.
  assert.equal(craps.crapsWindowShareWei(budget, 10n, 6, 0), 20_000n * wei);
  // The other half splits by size: tier 3 carries 4 of the 10.
  assert.equal(craps.crapsWindowShareWei(budget, 10n, 4, 3), 8_000n * wei);
  assert.equal(craps.crapsWindowShareWei(budget, 10n, 0, 1), 2_000n * wei);
  // A partial day has no honest denominator, so it yields none.
  assert.equal(craps.crapsRoutineWeight([{ tier: 1 }, null, { tier: 2 }]), null);
  assert.equal(craps.crapsWindowShareWei(budget, 0n, 0, 1), 0n);
});

test('indexer winner totals add the exact run settlement without double-counting a sole rider', async () => {
  const battleKey = '0x' + 'ab'.repeat(32);
  const previousKey = '0x' + 'cd'.repeat(32);
  const mainWinner = '0x0000000000000000000000000000000000000011';
  const highWinner = '0x0000000000000000000000000000000000000022';
  const payload = {
    day: 42,
    results: [
      {
        day: 42,
        period: 0,
        battleKey,
        lane: 'main',
        betId: '101',
        winner: mainWinner,
        bankrollRider: null,
        runPaidWei: '18000',
        battlePaidWei: '5000',
        highPaidWei: '0',
        progressivePaidWei: '2000',
        totalWonWei: '25000',
      },
      {
        day: 42,
        period: 0,
        battleKey,
        lane: 'high',
        betId: '202',
        winner: highWinner,
        bankrollRider: true,
        runPaidWei: '12000',
        battlePaidWei: '0',
        highPaidWei: '0',
        progressivePaidWei: '0',
        totalWonWei: '12000',
      },
      {
        // A rider amount added again as a separate lane payout is rejected.
        day: 42,
        period: 1,
        battleKey: '0x' + 'ef'.repeat(32),
        lane: 'high',
        betId: '303',
        winner: highWinner,
        bankrollRider: true,
        runPaidWei: '12000',
        battlePaidWei: '0',
        highPaidWei: '9000',
        progressivePaidWei: '0',
        totalWonWei: '21000',
      },
      {
        day: 41,
        period: 6,
        battleKey: previousKey,
        lane: 'main',
        betId: '404',
        winner: mainWinner,
        bankrollRider: null,
        runPaidWei: null,
        battlePaidWei: '5000',
        highPaidWei: '0',
        progressivePaidWei: '0',
        totalWonWei: null,
      },
    ],
  };

  const totals = craps.crapsWinnerTotalsFromPayload(42, payload);
  assert.equal(totals.length, 3);
  assert.equal(totals[0].runPaidWei, 18_000n);
  assert.equal(totals[0].totalWonWei, 25_000n);
  assert.equal(totals[1].totalWonWei, 12_000n,
    'the sole rider lives inside the run settlement and is counted once');
  assert.equal(totals[2].totalWonWei, null,
    'an unattributed settlement remains unknown instead of showing the 5,000 battle-only partial');

  const snapshot = {
    day: 42,
    results: [{
      battleKey,
      betId: '101',
      winner: mainWinner,
      amountWei: 5_000n,
      highResult: {
        betId: '202',
        winner: highWinner,
        amountWei: 12_000n,
        bankrollRider: true,
      },
    }],
    yesterdayEventResult: {
      day: 41,
      period: 6,
      battleKey: previousKey,
      betId: '404',
      winner: mainWinner,
      amountWei: 5_000n,
    },
  };
  const enriched = craps.crapsLobbySnapshotWithWinnerTotals(snapshot, totals);
  assert.equal(enriched.results[0].amountWei, 5_000n, 'the lane prize remains available separately');
  assert.equal(enriched.results[0].totalWonWei, 25_000n);
  assert.equal(enriched.results[0].highResult.totalWonWei, 12_000n);
  assert.equal(enriched.yesterdayEventResult.totalWonWei, null);

  let requested = null;
  const loaded = await crapsResults.readCrapsWinnerTotals(42, async (path) => {
    requested = path;
    return payload;
  });
  assert.equal(requested, '/game/craps/lobby/42/results');
  assert.equal(loaded[0].totalWonWei, 25_000n);
});

test('the realized boost carries the contract rounding, not the raw draw', () => {
  const wei = 10n ** 18n;
  // Word 3 against this key rolls 853 — the 1x rung — so the granule count is
  // the base itself: 45 granules from a 450,000 FLIP ceiling, 5 from 50,000.
  const key = `0x${'ab'.padStart(64, '0')}`;
  const word = 3n;

  assert.equal(craps.crapsBonusMultiplier({ battleKey: key, wordValue: 1n }), 0.25);
  assert.equal(craps.crapsBonusMultiplier({ battleKey: key, wordValue: 3n }), 1);
  assert.equal(craps.crapsBonusMultiplier({ battleKey: key, wordValue: 37n }), 10);
  assert.equal(craps.crapsBonusMultiplier({ battleKey: key, wordValue: 47n }), 100);
  assert.equal(craps.crapsBonusMultiplier({ battleKey: key, wordValue: 0n }), null,
    'the UI never invents a multiplier before the settlement word is available');

  // Above the 40-granule floor CrapsBattle._roundBoost collapses to the NEAREST
  // ten granules, so 45 pays 50. Announcing the raw 45 understates the window by
  // 500 FLIP — the exact shortfall seen on the live run-43 day 5 window 4.
  assert.equal(
    craps.crapsRealizedBoostWei({ ceilingWei: 450_000n * wei, battleKey: key, wordValue: word }),
    5_000n * wei,
  );
  // At or below the floor the draw pays exact.
  assert.equal(
    craps.crapsRealizedBoostWei({ ceilingWei: 50_000n * wei, battleKey: key, wordValue: word }),
    500n * wei,
  );
});

test('settlement words are read out of GAME storage, which is where they live', async () => {
  // CrapsBattle keeps NO public `wordAt`: `_wordAt` is an internal extsload into
  // GAME's LOOTBOX_RNG_WORD_SLOT (34). Calling the absent selector reverts with
  // no data and blanks every realized-boost figure on the page.
  const index = 900n;
  const expectedKey = ethers.toBeHex(BigInt(ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [index, 34n]),
  )), 32);
  assert.equal(craps.crapsSettlementWordStorageKey(index), expectedKey);

  const reads = [];
  const provider = {
    getStorage: async (address, slot) => {
      reads.push([address, slot]);
      return slot === expectedKey
        ? `0x${(12_345n).toString(16).padStart(64, '0')}`
        : `0x${''.padStart(64, '0')}`;
    },
  };

  assert.equal(await craps.readCrapsSettlementWord(index, provider), 12_345n);
  assert.deepEqual(reads[0], [CONTRACTS.GAME, expectedKey]);
  // An undrawn word stays pending rather than reading as a zero boost.
  assert.equal(await craps.readCrapsSettlementWord(901n, provider), null);
});

test('lobby entry history scopes a direct High Roller seat to the connected wallet', () => {
  const day = 42;
  const period = 5;
  const slot = BigInt(day * 8 + period + 1);
  const betId = (slot << 64n) | 9n;
  const packedEventBet = 0x1241111n | (betId << 32n) | (9n << 160n);
  const amendedBoard = 0x1111444n;
  const logs = [
    {
      parsed: {
        name: 'CrapsSlipPlaced',
        args: { player: PLAYER, bet: packedEventBet },
      },
    },
    { parsed: { name: 'CrapsSlipAmended', args: { betId, chips: amendedBoard } } },
  ];

  const own = craps.crapsLobbySnapshotFromLogs(day, logs, { player: PLAYER });
  assert.deepEqual(own.playerEntries.windows[period], {
    day,
    period,
    source: 'window',
    multiple: 10,
    high: true,
    betId: betId.toString(),
    chips: Number(amendedBoard),
  });
  assert.equal(own.playerEntries.windows.filter(Boolean).length, 1);
  assert.deepEqual(own.playerEntries.days, {});

  const other = craps.crapsLobbySnapshotFromLogs(day, logs, {
    player: '0x00000000000000000000000000000000000000bb',
  });
  assert.equal(other.playerEntries.windows.every((entry) => entry == null), true);
});

test('lobby entrant counts fold day tickets and one main-pot seat per High Roller into every battle', () => {
  const day = 42;
  const wei = 10n ** 18n;
  const pack = (slot, seat, multiple = 1) => (
    ((((BigInt(slot) << 64n) | BigInt(seat)) << 32n) | (BigInt(multiple - 1) << 160n))
  );
  const slip = (player, slot, seat, multiple = 1) => ({
    parsed: { name: 'CrapsSlipPlaced', args: { player, bet: pack(slot, seat, multiple) } },
  });
  const opened = (period, battleStakeFlip) => ({
    parsed: {
      name: 'CrapsBonusOpened',
      args: {
        battleKey: `0x${(5000 + period).toString(16).padStart(64, '0')}`,
        slot: BigInt(day * 8 + period + 1),
        seed: 25_000n * wei,
        bankroll: 300n * wei,
        goal: 1_500n * wei,
        boardStake: 105n * wei,
        battleStake: BigInt(battleStakeFlip) * wei,
      },
    },
  });
  const logs = [
    opened(0, 200),
    opened(1, 300),
    // The historical EVENT row still owns the same public field breakdown as
    // a live row: direct seats plus every prior-day comp.
    slip('0x00000000000000000000000000000000000000a1', (day - 1) * 8, 1),
    slip('0x00000000000000000000000000000000000000a2', (day - 1) * 8, 2, 10),
    slip('0x00000000000000000000000000000000000000a3', (day - 1) * 8 + 7, 1),
    slip('0x00000000000000000000000000000000000000a4', (day - 1) * 8 + 7, 2, 10),
    slip(PLAYER, day * 8, 1),
    {
      parsed: {
        name: 'CrapsDayWindowsUpgraded',
        args: { player: PLAYER, day: BigInt(day), upgradedMask: 0b0000010n, burned: 4_500n * wei },
      },
    },
    // Repeated upgrade logs must not count the same day seat twice in HIGH.
    {
      parsed: {
        name: 'CrapsDayWindowsUpgraded',
        args: { player: PLAYER, day: BigInt(day), upgradedMask: 0b0000010n, burned: 4_500n * wei },
      },
    },
    slip('0x00000000000000000000000000000000000000b1', day * 8, 2, 10),
    slip('0x00000000000000000000000000000000000000c1', day * 8 + 1, 1),
    slip('0x00000000000000000000000000000000000000c2', day * 8 + 1, 2, 100),
    // A repeated provider log must not invent another entrant.
    slip('0x00000000000000000000000000000000000000c2', day * 8 + 1, 2, 100),
    slip('0x00000000000000000000000000000000000000d1', day * 8 + 2, 1),
    slip('0x00000000000000000000000000000000000000e1', (day + 1) * 8, 1),
    {
      parsed: {
        name: 'CrapsDayReserved',
        args: {
          player: '0x00000000000000000000000000000000000000e1',
          day: BigInt(day + 1),
          highRoller: true,
        },
      },
    },
  ];

  const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs);
  assert.deepEqual(snapshot.entrants.days, { '42': 2, '43': 1 });
  assert.deepEqual(snapshot.entrants.highDays, { '42': 1, '43': 1 });
  assert.deepEqual(snapshot.entrants.previousEvent, {
    period: 6,
    direct: 2,
    directHigh: 1,
    day: 2,
    dayHigh: 1,
    total: 4,
    high: 2,
    mainPotStakeWei: null,
  });
  assert.deepEqual(snapshot.entrants.windows[0], {
    period: 0,
    direct: 2,
    directHigh: 1,
    day: 2,
    dayHigh: 1,
    total: 4,
    high: 2,
    mainPotStakeWei: (4n * 200n * wei).toString(),
  });
  assert.deepEqual(snapshot.entrants.windows[1], {
    period: 1,
    direct: 1,
    directHigh: 0,
    day: 2,
    dayHigh: 2,
    total: 3,
    high: 2,
    mainPotStakeWei: (3n * 300n * wei).toString(),
  });
  assert.equal(snapshot.entrants.windows[2].total, 2);
  assert.equal(snapshot.entrants.windows[2].mainPotStakeWei, null);
  assert.equal(snapshot.playerEntries, null);
});

test('tomorrow face-cost ranges cover the shipped Normal and unknown High Roller presets', () => {
  assert.deepEqual(craps.CRAPS_FUTURE_DAY_FACE_RANGES, {
    normal: {
      low: 4_200n,
      high: 126_000n,
      wager: { low: 3_300n, high: 78_000n },
      battle: { low: 900n, high: 48_000n },
    },
    high: {
      low: 42_000n,
      high: 12_600_000n,
      wager: { low: 33_000n, high: 7_800_000n },
      battle: { low: 9_000n, high: 4_800_000n },
    },
  });
});

test('armed and finalized owned seats retain viewer ids across the Pending lifecycle', () => {
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
  const openBattleSlot = 42n * 8n + 4n;
  const openBetId = (openBattleSlot << 64n) | 11n;
  const openKey = `0x${'44'.padStart(64, '0')}`;
  const otherBattleSlot = 42n * 8n + 5n;
  const otherBetId = (otherBattleSlot << 64n) | 11n;
  const otherKey = `0x${'45'.padStart(64, '0')}`;
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
    { parsed: { name: 'CrapsSlipPlaced', args: { player: PLAYER, bet: pack(openBetId) } } },
    { parsed: { name: 'CrapsSlipPlaced', args: { player: '0x00000000000000000000000000000000000000cc', bet: pack(otherBetId) } } },
    { parsed: { name: 'CrapsBonusOpened', args: opened(priorKey, priorBattleSlot) } },
    { parsed: { name: 'CrapsBonusOpened', args: opened(directKey, directBattleSlot) } },
    { parsed: { name: 'CrapsBonusOpened', args: opened(pendingKey, pendingBattleSlot) } },
    { parsed: { name: 'CrapsBonusOpened', args: opened(openKey, openBattleSlot) } },
    { parsed: { name: 'CrapsBonusOpened', args: opened(otherKey, otherBattleSlot) } },
    {
      parsed: {
        name: 'CrapsBonusArmed',
        args: { battleKey: pendingKey, slot: pendingBattleSlot, index: 901n },
      },
    },
    {
      parsed: {
        name: 'CrapsBonusArmed',
        args: { battleKey: otherKey, slot: otherBattleSlot, index: 902n },
      },
    },
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
        name: 'CrapsBattlePaid',
        args: { battleKey: directKey, betId: directBetId, player: PLAYER, amount: 1_100n },
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
      buyInWei: (500n * wei).toString(),
      battleStakeWei: (200n * wei).toString(),
      finalized: true,
      winningStop: 1,
      winnerId: '2',
      winningPeakWei: '4000',
      winningEndWei: '3200',
      winningScoreBps: 130000,
      potWei: '900',
      winnerBetId: null,
      winner: null,
      amountWei: null,
      bonusMultiplier: null,
    },
    {
      day: 42,
      period: 1,
      slot: directBattleSlot.toString(),
      battleKey: directKey,
      viewerBetId: directBetId.toString(),
      buyInWei: (500n * wei).toString(),
      battleStakeWei: (200n * wei).toString(),
      finalized: true,
      winningStop: 0,
      winnerId: '9',
      winningPeakWei: '9000',
      winningEndWei: '9000',
      winningScoreBps: 300000,
      potWei: '1200',
      winnerBetId: directBetId.toString(),
      winner: PLAYER,
      amountWei: '1100',
      bonusMultiplier: null,
    },
    {
      day: 42,
      period: 2,
      slot: pendingBattleSlot.toString(),
      battleKey: pendingKey,
      viewerBetId: pendingBetId.toString(),
      buyInWei: (500n * wei).toString(),
      battleStakeWei: (200n * wei).toString(),
      finalized: false,
      winningStop: null,
      winnerId: null,
      winningPeakWei: null,
      winningEndWei: null,
      winningScoreBps: null,
      potWei: null,
      winnerBetId: null,
      winner: null,
      amountWei: null,
      bonusMultiplier: null,
    },
  ]);
  assert.equal(snapshot.resolvedReplays.some((replay) => replay.battleKey === openKey), false,
    'an owned battle that is still open does not enter Pending early');
  assert.equal(snapshot.resolvedReplays.some((replay) => replay.battleKey === otherKey), false,
    'another player\'s armed battle never enters this wallet\'s Pending feed');
});

test('resolved High Roller replays retain their full stake and exact side-field seats', () => {
  const day = 42;
  const wei = 10n ** 18n;
  const windowSlot = BigInt(day * 8 + 1);
  const daySlot = BigInt(day * 8);
  const directOwned = (windowSlot << 64n) | 1n;
  const directOther = (windowSlot << 64n) | 2n;
  const dayOwned = (daySlot << 64n) | 3n;
  const dayOther = (daySlot << 64n) | 4n;
  const battleKey = `0x${'46'.padStart(64, '0')}`;
  const otherPlayer = '0x00000000000000000000000000000000000000bb';
  const pack = (betId, multiple = 1) => (
    (betId << 32n) | (BigInt(multiple - 1) << 160n)
  );
  const slip = (player, betId, multiple = 1) => ({
    parsed: { name: 'CrapsSlipPlaced', args: { player, bet: pack(betId, multiple) } },
  });
  const logs = [
    slip(PLAYER, directOwned, 10),
    slip(otherPlayer, directOther, 10),
    slip(PLAYER, dayOwned),
    slip(otherPlayer, dayOther, 10),
    {
      parsed: {
        name: 'CrapsDayWindowsUpgraded',
        args: { player: PLAYER, day: BigInt(day), upgradedMask: 1n, burned: 1n },
      },
    },
    {
      parsed: {
        name: 'CrapsHighRollerDayOpened',
        args: { day: BigInt(day), multiplier: 10n, mainBoostBudget: 0n, highRollerBoostBudget: 0n },
      },
    },
    {
      parsed: {
        name: 'CrapsBonusOpened',
        args: {
          battleKey,
          slot: windowSlot,
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
        name: 'CrapsBonusArmed',
        args: { battleKey, slot: windowSlot, index: 903n },
      },
    },
    {
      parsed: {
        name: 'CrapsBattleFinalized',
        args: {
          battleKey,
          winningStop: 0n,
          winnerId: 2n,
          winningPeak: 9_000n,
          winningEnd: 9_000n,
          winningScoreBps: 300_000n,
          pot: 1_200n,
        },
      },
    },
    {
      parsed: {
        name: 'CrapsHighRollerPaid',
        args: {
          battleKey,
          betId: directOther,
          player: otherPlayer,
          amount: 8_000n * wei,
          bankrollRider: false,
        },
      },
    },
  ];

  const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs, { player: PLAYER });
  assert.equal(snapshot.resolvedReplays.length, 2,
    'the owned direct and upgraded day seats each publish a replay receipt');
  const expectedHighSeats = [dayOwned, dayOther, directOwned, directOther]
    .map(String)
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1);
  for (const replay of snapshot.resolvedReplays) {
    assert.equal(replay.entryMultiple, 10);
    assert.equal(replay.buyInWei, (500n * wei).toString());
    assert.equal(replay.entryBattleStakeWei, (2_000n * wei).toString());
    assert.deepEqual(replay.highRollerBetIds, expectedHighSeats);
    assert.equal(replay.highRollerEntrants, 4);
    assert.equal(replay.highWinnerBetId, directOther.toString());
    assert.equal(replay.highWinner, otherPlayer);
    assert.equal(replay.highPayoutWei, (8_000n * wei).toString());
    assert.equal(replay.highBankrollRider, false);
  }
});

test('the surviving chain reads normalize their values', async () => {
  assert.equal(await craps.readCrapsProgressivePool(), '1250000000000000000000000');
  assert.deepEqual(await craps.readCrapsPassCredits(PLAYER), { normal: 17, high: 2 });
  assert.deepEqual(craps.decodeCrapsPassCredits((9n << 32n) | 23n), { normal: 23, high: 9 });
  assert.match(craps.crapsPassCreditsStorageKey(PLAYER), /^0x[0-9a-f]{64}$/);
});


test('scheduled entries, amendments, future days, and upgrades use their distinct contract doors', async () => {
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

  await craps.placeCrapsBonusEntry({
    valid: true,
    method: 'applyCrapsPasses',
    contractArgs: [44, 1, false, 0x1241111],
  });
  assert.deepEqual(contract._calls['static:applyCrapsPasses'], [[44, 1, false, 0x1241111]]);
  assert.deepEqual(contract._calls.applyCrapsPasses, [[44, 1, false, 0x1241111]]);

  await craps.amendCrapsSlip({ betId: '6206227746803369984', contractChips: 0x1241111 });
  assert.deepEqual(contract._calls['static:amendSlip'], [['6206227746803369984', 0x1241111]]);
  assert.deepEqual(contract._calls.amendSlip, [['6206227746803369984', 0x1241111]]);

  await craps.upgradeCrapsDayWindows({ day: 42, periodMask: 0b0010101 });
  assert.deepEqual(contract._calls['static:upgradeDayWindows'], [[42, 0b0010101]]);
  assert.deepEqual(contract._calls.upgradeDayWindows, [[42, 0b0010101]]);
});

test('receipt parsing decodes the packed slip echo the contract really emits', () => {
  // CrapsSlipPlaced carries ONE word: chips, then the bet id at bit 32 and the
  // entry multiple at bit 160. There is no per-field event any more.
  const betId = (337n << 64n) | 4n;
  const packed = 0x1241111n | (betId << 32n) | (9n << 160n);
  const parsed = craps.parseCrapsReceipt({ logs: [
    { parsed: { name: 'CrapsSlipPlaced', args: { player: PLAYER, bet: packed } } },
    { parsed: { name: 'CrapsSlipAmended', args: { betId, chips: 0x1111444n } } },
    { parsed: { name: 'CrapsDayReserved', args: { player: PLAYER, day: 43n, highRoller: true } } },
    { parsed: { name: 'CrapsDayWindowsUpgraded', args: { player: PLAYER, day: 42n, upgradedMask: 5n, burned: 4_500n } } },
    { parsed: { name: 'CrapsBetSettled', args: { betId, player: PLAYER, won: 381n, paid: 762n } } },
  ] });
  assert.deepEqual(parsed.placed[0], {
    player: PLAYER, betId: betId.toString(), slot: '337', multiple: 10,
  });
  assert.deepEqual(parsed.reserved[0], { player: PLAYER, day: 43, highRoller: true });
  assert.deepEqual(parsed.upgraded[0], {
    player: PLAYER, day: 42, upgradedMask: 5, burnedWei: '4500',
  });
  assert.deepEqual(parsed.amended[0], { betId: betId.toString(), chips: 0x1111444 });
  assert.deepEqual(parsed.settled[0], {
    betId: betId.toString(), player: PLAYER, wonWei: '381', paidWei: '762',
  });
});

test('contract errors map to actionable craps copy', () => {
  // Contract reverts and the board editor's own client-side codes share the map.
  assert.match(reasonMap.decodeRevertReason({ revert: { name: 'BonusPeriodSpent' } }).userMessage, /already closed/i);
  assert.match(reasonMap.decodeRevertReason({ revert: { name: 'RngNotReady' } }).userMessage, /have not landed yet/i);
  assert.match(reasonMap.decodeRevertReason({ revert: { name: 'OddsAboveAllowance' } }).userMessage, /odds/i);
  assert.match(reasonMap.decodeRevertReason({ revert: { name: 'BadGoal' } }).userMessage, /twice/i);
  assert.match(reasonMap.decodeRevertReason({ revert: { name: 'NothingToUpgrade' } }).userMessage, /already/i);
});

// ---------------------------------------------------------------------------
// The shared craps window: API-first, chain-fallback, persisted.
//
// The lobby, the schedule and the Added rail all fold ONE window. These tests
// pin the two transports to the same fixture and assert the fold cannot tell
// them apart — the whole premise of serving the window from the indexer.
// ---------------------------------------------------------------------------

const WINDOW_HEAD = 46_300_000;
const WINDOW_LOOKBACK = 2_400;
const WINDOW_TAIL = 12;
const WINDOW_DAY = 42;
// Digits only. An address with letters comes back checksummed from an ethers
// decode and lowercase from the API, and the winner fields are deliberately
// NOT lowercased, so a mixed-case fixture would test the casing rather than
// the transport.
const WINDOW_PLAYER = '0x1234512345123451234512345123451234512345';
const WINDOW_DONOR = '0x9876598765987659876598765987659876598765';
const WINDOW_WEI = 10n ** 18n;

function windowInterface() {
  return new ethers.Interface(craps.CRAPS_LOBBY_EVENT_ABI);
}

/** One fixture, rendered as the indexer's EventRow. */
function crapsEventRow(iface, fixture) {
  const args = {};
  for (const input of iface.getEvent(fixture.name).inputs) {
    const value = fixture.args[input.name];
    args[input.name] = input.type === 'bool'
      ? Boolean(value)
      : input.type === 'address' || input.type.startsWith('bytes')
        ? String(value).toLowerCase()
        // uint/int arrive as DECIMAL STRINGS: the indexer stringifies BigInt.
        : String(value);
  }
  return {
    name: fixture.name,
    args,
    blockNumber: fixture.blockNumber,
    logIndex: fixture.logIndex,
    transactionHash: fixture.txHash,
  };
}

/** The same fixture, rendered as the raw log eth_getLogs would return. */
function crapsChainLog(iface, fixture, address) {
  const fragment = iface.getEvent(fixture.name);
  const { data, topics } = iface.encodeEventLog(
    fragment,
    fragment.inputs.map((input) => fixture.args[input.name]),
  );
  return {
    address,
    blockNumber: fixture.blockNumber,
    index: fixture.logIndex,
    transactionHash: fixture.txHash,
    topics,
    data,
  };
}

/** Every event name the window carries, in one coherent day-42 lobby. */
function crapsWindowFixtures() {
  const keyA = `0x${'1'.padStart(64, '0')}`;
  const keyB = `0x${'2'.padStart(64, '0')}`;
  const slotA = BigInt(WINDOW_DAY) * 8n + 1n;
  const slotB = BigInt(WINDOW_DAY) * 8n + 2n;
  const betId = (slotA << 64n) | 7n;
  const opened = (battleKey, slot) => ({
    battleKey,
    slot,
    seed: 25_000n * WINDOW_WEI,
    bankroll: 300n * WINDOW_WEI,
    goal: 1_500n * WINDOW_WEI,
    boardStake: 42n * WINDOW_WEI,
    battleStake: 200n * WINDOW_WEI,
  });
  return [
    { name: 'CrapsHighRollerDayOpened', args: { day: 42n, multiplier: 10n, mainBoostBudget: 1_000n * WINDOW_WEI, highRollerBoostBudget: 500n * WINDOW_WEI } },
    { name: 'CrapsProgressiveFunded', args: { day: 42n, contribution: 1_000n * WINDOW_WEI, balance: 9_000n * WINDOW_WEI } },
    { name: 'CrapsBonusOpened', args: opened(keyA, slotA) },
    { name: 'CrapsBonusOpened', args: opened(keyB, slotB) },
    { name: 'CrapsBonusDonated', args: { battleKey: keyA, donor: WINDOW_DONOR, amount: 7n * WINDOW_WEI, seed: 7n * WINDOW_WEI } },
    { name: 'CrapsSlipPlaced', args: { player: WINDOW_PLAYER, bet: (betId << 32n) | 5n } },
    { name: 'CrapsSlipAmended', args: { betId, chips: 5n } },
    { name: 'CrapsDayReserved', args: { player: WINDOW_PLAYER, day: 43n, highRoller: true } },
    { name: 'CrapsDayWindowsUpgraded', args: { player: WINDOW_PLAYER, day: 42n, upgradedMask: 3n, burned: 4_500n * WINDOW_WEI } },
    { name: 'CrapsBonusArmed', args: { battleKey: keyA, slot: slotA, index: 901n } },
    { name: 'CrapsBattleFinalized', args: { battleKey: keyA, winningStop: 1n, winnerId: 2n, winningPeak: 4_000n * WINDOW_WEI, winningEnd: 3_200n * WINDOW_WEI, winningScoreBps: 130_000n, pot: 900n * WINDOW_WEI } },
    { name: 'CrapsBattlePaid', args: { betId, battleKey: keyA, player: WINDOW_PLAYER, amount: 1_100n * WINDOW_WEI } },
    { name: 'CrapsHighRollerPaid', args: { betId, battleKey: keyA, player: WINDOW_PLAYER, amount: 400n * WINDOW_WEI, bankrollRider: false } },
    { name: 'CrapsProgressivePaid', args: { betId, battleKey: keyA, player: WINDOW_PLAYER, rare: false, poolBps: 250n, peak: 4_000n * WINDOW_WEI, scoreBps: 130_000n, candidate: 800n * WINDOW_WEI, paid: 700n * WINDOW_WEI, balance: 8_300n * WINDOW_WEI } },
    { name: 'CrapsProgressiveRolled', args: { battleKey: keyA, source: 1n, amount: 50n * WINDOW_WEI, balance: 8_350n * WINDOW_WEI } },
    { name: 'CrapsProtocolAwardSplit', args: { battleKey: keyA, player: WINDOW_PLAYER, source: 1n, grossProtocol: 300n * WINDOW_WEI, liquidFlip: 200n * WINDOW_WEI } },
  ].map((fixture, index) => ({
    ...fixture,
    blockNumber: WINDOW_HEAD - 200 + index,
    logIndex: index,
    txHash: `0x${String(index + 1).padStart(64, '0')}`,
  }));
}

function windowProvider(logs = []) {
  const calls = [];
  return {
    calls,
    getNetwork: async () => ({ chainId: 84532n }),
    getBlockNumber: async () => WINDOW_HEAD,
    getStorage: async () => `0x${'abc'.padStart(64, '0')}`,
    getLogs: async (filter) => {
      calls.push(filter);
      const from = Number(filter.fromBlock);
      const to = Number(filter.toBlock);
      return logs.filter((log) => log.blockNumber >= from && log.blockNumber <= to);
    },
  };
}

/** Drop the test contract factory (the API is skipped under one) but keep a real address. */
function useWindowTransport(logs = []) {
  craps.__setCrapsContractFactoryForTest(null, CONTRACTS.CRAPS);
  craps.__resetCrapsLogWindowForTest();
  const provider = windowProvider(logs);
  contracts.setProvider(provider);
  return provider;
}

function windowApiKey() {
  return `craps-window-api:v1:${CHAIN.id}:${String(CONTRACTS.CRAPS).toLowerCase()}`
    + `:${Number(CHAIN.deployBlock) || 0}`;
}

test('the indexed craps window folds to exactly the snapshot the log window folds to', async () => {
  const iface = windowInterface();
  const fixtures = crapsWindowFixtures();
  const provider = useWindowTransport(
    fixtures.map((fixture) => crapsChainLog(iface, fixture, CONTRACTS.CRAPS)),
  );

  craps.__setCrapsEventsFetcherForTest(async () => ({
    fromBlock: WINDOW_HEAD - WINDOW_LOOKBACK,
    toBlock: WINDOW_HEAD,
    lookbackBlocks: WINDOW_LOOKBACK,
    events: fixtures.map((fixture) => crapsEventRow(iface, fixture)),
  }));
  const fromApi = await craps.readCrapsLobbySnapshot(WINDOW_DAY, WINDOW_PLAYER);
  assert.equal(provider.calls.length, 0, 'a healthy API must never reach eth_getLogs');
  assert.equal(fromApi.day, WINDOW_DAY);
  // Proof the fold actually consumed the rows rather than shrugging at them.
  assert.equal(fromApi.schedule.windows[0].battleStakeFlip, 200n);
  assert.equal(fromApi.results[0].winner, WINDOW_PLAYER);
  assert.equal(fromApi.results[0].progressivePaidWei, 700n * WINDOW_WEI);
  assert.equal(fromApi.results[0].winnerPassWei, 100n * WINDOW_WEI);
  assert.equal(fromApi.playerEntries.windows[0].chips, 5);
  assert.deepEqual(fromApi.requiredWordIndexes, ['901']);

  craps.__resetCrapsLogWindowForTest();
  craps.__setCrapsEventsFetcherForTest(async () => { throw new Error('no such route'); });
  const fromChain = await craps.readCrapsLobbySnapshot(WINDOW_DAY, WINDOW_PLAYER);
  assert.ok(provider.calls.length >= 1, 'a dead API must fall back to the chain');
  assert.deepEqual(fromApi, fromChain);
});

test('the craps window refresh asks for the reorg tail and replaces the rows inside it', async () => {
  const iface = windowInterface();
  const provider = useWindowTransport();
  const dayOpened = (blockNumber, mainBoostBudget) => crapsEventRow(iface, {
    name: 'CrapsHighRollerDayOpened',
    blockNumber,
    logIndex: 0,
    txHash: `0x${'1'.padStart(64, '0')}`,
    args: { day: 42n, multiplier: 10n, mainBoostBudget, highRollerBoostBudget: 500n * WINDOW_WEI },
  });
  const funded = (blockNumber, contribution) => crapsEventRow(iface, {
    name: 'CrapsProgressiveFunded',
    blockNumber,
    logIndex: 1,
    txHash: `0x${'2'.padStart(64, '0')}`,
    args: { day: 42n, contribution, balance: 9_000n * WINDOW_WEI },
  });
  const responses = [
    {
      fromBlock: WINDOW_HEAD - WINDOW_LOOKBACK,
      toBlock: WINDOW_HEAD,
      events: [
        dayOpened(WINDOW_HEAD - 100, 1_000n * WINDOW_WEI),
        funded(WINDOW_HEAD - 5, 1_000n * WINDOW_WEI),
      ],
    },
    // The tail re-serves a rewritten block. The row below the tail survives.
    {
      fromBlock: WINDOW_HEAD - WINDOW_TAIL + 1,
      toBlock: WINDOW_HEAD + 3,
      events: [funded(WINDOW_HEAD - 5, 4_000n * WINDOW_WEI)],
    },
  ];
  const paths = [];
  craps.__setCrapsEventsFetcherForTest(async (path) => {
    paths.push(path);
    return responses[paths.length - 1];
  });

  assert.equal(await craps.readCrapsAddedPerDay(WINDOW_DAY), 2_000n * WINDOW_WEI);
  assert.equal(await craps.readCrapsAddedPerDay(WINDOW_DAY), 5_000n * WINDOW_WEI);
  assert.deepEqual(paths, [
    '/game/craps/events?lookback=2400',
    `/game/craps/events?lookback=2400&since=${WINDOW_HEAD - WINDOW_TAIL}`,
  ]);
  assert.equal(provider.calls.length, 0);
});

test('the craps window mirrors its cursor to localStorage so a reload pays only the tail', async () => {
  const iface = windowInterface();
  const fixtures = crapsWindowFixtures();
  const provider = useWindowTransport();
  craps.__setCrapsEventsFetcherForTest(async () => ({
    fromBlock: WINDOW_HEAD - WINDOW_LOOKBACK,
    toBlock: WINDOW_HEAD,
    events: fixtures.map((fixture) => crapsEventRow(iface, fixture)),
  }));
  assert.equal(await craps.readCrapsAddedPerDay(WINDOW_DAY), 2_000n * WINDOW_WEI);

  const stored = JSON.parse(globalThis.localStorage.getItem(windowApiKey()));
  assert.equal(stored.toBlock, WINDOW_HEAD);
  assert.equal(stored.fromBlock, WINDOW_HEAD - WINDOW_LOOKBACK);
  assert.equal(stored.rows.length, fixtures.length);
  assert.equal(stored.rows[0].name, 'CrapsHighRollerDayOpened');

  // A reload is a fresh module instance with an empty memory window. It must
  // revive the mirror and ask only for the reorg tail.
  const reloaded = await import('../craps.js?reload=craps-window-persistence');
  const paths = [];
  reloaded.__setCrapsEventsFetcherForTest(async (path) => {
    paths.push(path);
    return { fromBlock: WINDOW_HEAD - WINDOW_TAIL + 1, toBlock: WINDOW_HEAD, events: [] };
  });
  try {
    assert.equal(await reloaded.readCrapsAddedPerDay(WINDOW_DAY), 2_000n * WINDOW_WEI);
    assert.deepEqual(paths, [`/game/craps/events?lookback=2400&since=${WINDOW_HEAD - WINDOW_TAIL}`]);
    assert.equal(provider.calls.length, 0, 'a revived window never rescans the chain');
  } finally {
    reloaded.__resetCrapsContractFactoryForTest();
  }
});

test('a dead craps events route falls back to the chain and is not re-probed for five minutes', async () => {
  const iface = windowInterface();
  const fixtures = crapsWindowFixtures();
  const provider = useWindowTransport(
    fixtures.map((fixture) => crapsChainLog(iface, fixture, CONTRACTS.CRAPS)),
  );
  let fetches = 0;
  craps.__setCrapsEventsFetcherForTest(async () => {
    fetches += 1;
    const error = new Error('API 404: /game/craps/events');
    error.status = 404;
    throw error;
  });

  assert.equal(await craps.readCrapsAddedPerDay(WINDOW_DAY), 2_000n * WINDOW_WEI);
  assert.equal(await craps.readCrapsAddedPerDay(WINDOW_DAY), 2_000n * WINDOW_WEI);
  assert.equal(fetches, 1, 'the five-minute memo parks a route an old API cannot serve');
  assert.equal(provider.calls.length, 2, 'both refreshes came off the chain window');
  assert.equal(
    Number(provider.calls[1].fromBlock),
    WINDOW_HEAD - WINDOW_TAIL + 1,
    'and the second one only re-read the reorg tail',
  );
  assert.equal(globalThis.localStorage.getItem(windowApiKey()), null);

  // The memo lives in memory only, so a new session probes the route again.
  craps.__resetCrapsLogWindowForTest();
  assert.equal(await craps.readCrapsAddedPerDay(WINDOW_DAY), 2_000n * WINDOW_WEI);
  assert.equal(fetches, 2);
});

test('the Added rail folds the shared craps window instead of opening its own query', async () => {
  const iface = windowInterface();
  const fixtures = crapsWindowFixtures();
  const provider = useWindowTransport(
    fixtures.map((fixture) => crapsChainLog(iface, fixture, CONTRACTS.CRAPS)),
  );
  craps.__setCrapsEventsFetcherForTest(async () => ({
    fromBlock: WINDOW_HEAD - WINDOW_LOOKBACK,
    toBlock: WINDOW_HEAD,
    events: fixtures.map((fixture) => crapsEventRow(iface, fixture)),
  }));
  assert.equal(await craps.readCrapsAddedPerDay(WINDOW_DAY), 2_000n * WINDOW_WEI);
  assert.equal(provider.calls.length, 0, 'the rail no longer runs an eth_getLogs of its own');

  // Degraded to the chain, the rail still extends the LOBBY's cursor rather
  // than paying a second full lookback for two numbers.
  craps.__resetCrapsLogWindowForTest();
  craps.__setCrapsEventsFetcherForTest(async () => { throw new Error('no such route'); });
  await craps.readCrapsLobbySnapshot(WINDOW_DAY, WINDOW_PLAYER);
  assert.equal(provider.calls.length, 1);
  assert.equal(Number(provider.calls[0].fromBlock), WINDOW_HEAD - WINDOW_LOOKBACK);
  assert.equal(await craps.readCrapsAddedPerDay(WINDOW_DAY), 2_000n * WINDOW_WEI);
  assert.equal(provider.calls.length, 2);
  assert.equal(Number(provider.calls[1].fromBlock), WINDOW_HEAD - WINDOW_TAIL + 1);
  assert.deepEqual(provider.calls[1].topics.length, 1, 'and it reuses the window filter');
});
