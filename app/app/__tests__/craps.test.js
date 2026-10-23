import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';

import { ethers } from '../contracts.js';
import * as contracts from '../contracts.js';
import { CHAIN, CONTRACTS, CRAPS_SCHEDULE } from '../chain-config.js';
import * as craps from '../craps.js';
import * as crapsResults from '../craps-results.js';
import * as readProvider from '../read-provider.js';
import * as reasonMap from '../reason-map.js';
import * as store from '../store.js';
import { loadSchema } from '../../chain/schema.js';
import { setChainClientForTests } from '../../chain/client.js';
import { abi as crapsAbi, fields as crapsFields } from '../../chain/generated/craps.js';
import { abi as coinAbi } from '../../chain/generated/coin.js';
import { prepareWalletReceipt } from '../wallet-receipt.js';
import { _setWalletIdForTests, _resetWalletIdsForTests } from '../wallet-id.js';
import { walletAbi } from '../wallet-abi.js';
import { ACTIVE_CHAIN_ID } from './helpers/active-chain.js';
import { rpcFixture } from './helpers/chain-rpc.js';

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
    upgradeReservedDay: [],
    'static:upgradeReservedDay': [],
    convertNormalToHigh: [],
    'static:convertNormalToHigh': [],
  };
  const contract = {
    // FLIP is whole tokens on chain.
    amendSlip: callable('amendSlip', calls),
    enterBonusBattle: callable('enterBonusBattle', calls),
    enterBonusDay: callable('enterBonusDay', calls),
    buyFutureCrapsDays: callable('buyFutureCrapsDays', calls),
    applyCrapsPasses: callable('applyCrapsPasses', calls),
    upgradeDayWindows: callable('upgradeDayWindows', calls, 4_500n),
    upgradeReservedDay: callable('upgradeReservedDay', calls),
    convertNormalToHigh: callable('convertNormalToHigh', calls),
    connect() { return this; },
    _calls: calls,
  };
  return contract;
}

function fakeProvider() {
  return {
    getNetwork: async () => ({ chainId: BigInt(ACTIVE_CHAIN_ID) }),
    getSigner: async () => ({ getAddress: async () => PLAYER }),
    getStorage: async (_address, key) => BigInt(key) === BigInt(crapsFields._progressive.slot)
      ? ethers.toBeHex(1_250_000n, 32) : '0x0000000000000000000000000000000000000000000000000000000200000011',
  };
}

let contract;

const PLAYER_ID = 41;

beforeEach(() => {
  _setWalletIdForTests(PLAYER, PLAYER_ID);
  store.__resetForTest();
  store.update('connected.address', PLAYER);
  store.update('viewing.address', null);
  store.update('ui.mode', 'self');
  contracts.setProvider(fakeProvider());
  contract = fakeContract();
  craps.__setCrapsContractFactoryForTest(() => contract);
});

afterEach(() => {
  _resetWalletIdsForTests();
  setChainClientForTests(null);
  craps.__resetCrapsContractFactoryForTest();
  readProvider._resetSharedReadProviderForTests();
  contracts.clearProvider();
  store.__resetForTest();
});

test('the craps ABI names only functions the deployed contract actually has', () => {
  const iface = new contracts.ethers.Interface(craps.FLIP_CRAPS_ABI);
  // Verified against the CrapsBattle artifact whose runtime bytecode matches the
  // deployed contract byte for byte. These are the doors the app uses.
  for (const method of [
    'amendSlip', 'enterBonusBattle', 'enterBonusDay', 'applyCrapsPasses', 'buyFutureCrapsDays',
    'upgradeDayWindows', 'upgradeReservedDay', 'convertNormalToHigh',
  ]) assert.ok(iface.getFunction(method), method);
  // 635b010a cut `previewSettlement` to make room under EIP-170. A stale entry here
  // would show up as a panel that renders a dash forever, not as an error.
  assert.equal(
    iface.getFunction('previewSettlement'),
    null,
    'previewSettlement is GONE from the deployed surface and must not be re-listed',
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

test('daily word derivation reproduces the six buy-ins, depths, and goal multipliers', () => {
  const word = '102858562227254754036121703853225298402533986033002165985066946425924666406226';
  const day = craps.crapsBonusDayTerms(word);
  // The scheduled round is bankroll x 2/5 (2.5 rounds deep, `_schedRound`) and the goal is FIXED at
  // 5x, so every window reads 5 and the derivation consumes no goal bits. Five tier-drawn windows
  // (600 bank + a 200..400 bounty here) and the jackpot period, whose fee this word draws at 10,000.
  assert.deepEqual(day.windows.map(({ buyInFlip, bankMult, goalMult }) => ({
    buyInFlip, bankMult, goalMult,
  })), [
    { buyInFlip: 2_800n, bankMult: 2.5, goalMult: 5 },
    { buyInFlip: 2_800n, bankMult: 2.5, goalMult: 5 },
    { buyInFlip: 800n, bankMult: 2.5, goalMult: 5 },
    { buyInFlip: 3_200n, bankMult: 2.5, goalMult: 5 },
    { buyInFlip: 2_800n, bankMult: 2.5, goalMult: 5 },
    { buyInFlip: 10_000n, bankMult: 2.5, goalMult: 5 },
  ]);
  assert.equal(day.buyInFlip, 22_400n);
  assert.deepEqual(
    [day.minBankMult, day.maxBankMult, day.minGoalMult, day.maxGoalMult],
    [2.5, 2.5, 5, 5],
  );
});

test('Main Event funding applies the subsidy roll and then the pool roll, after the unrolled High Roller reserve', () => {
  const wei = 10n ** 18n;
  const slot = 41n * 8n + 6n;
  // Pool rolls of words 1/2/46/34: 0.5x / 3x / 20x / 100x. The subsidy roll (keyed by the slot)
  // scales the 19,000 left after the 5% reserve first.
  for (const [word, poolBps] of [[1n, 5_000n], [2n, 5_000n], [46n, 5_000n], [34n, 5_000n]]) {
    const subsidy = 19_000n * craps.crapsJackpotSubsidyBps(word, slot) / 10_000n;
    assert.equal(craps.crapsMainEventAddedWei(20_000n * wei, word, slot), (subsidy * poolBps / 10_000n) * wei);
  }
  assert.equal(craps.crapsMainEventAddedWei(20_000n * wei, 2n, slot), 47_500n * wei);
  assert.equal(craps.crapsMainEventAddedWei(20_000n * wei, 2n), null, 'no slot, no subsidy key');
  assert.equal(craps.crapsMainEventAddedWei(20_000n, 0n, slot), null);
  assert.equal(craps.crapsMainEventAddedWei(null, 1n, slot), null);
});

test('Main Event High Roller Added retains RIU for its winning seat without a routine boost', () => {
  const wei = 10n ** 18n;
  const slot = 9n * 8n + 6n;
  const battleKey = ethers.toBeHex(slot, 32);
  const iface = new ethers.Interface(craps.CRAPS_LOBBY_EVENT_ABI);
  const event = (name, args) => ({ parsed: { name, args } });
  for (const sameSeat of [true, false]) {
    const logs = [
      event('CrapsBonusOpened', { battleKey, slot, seed: 0n, bankroll: 0n, goal: 0n, boardStake: 0n, battleStake: 8_000n * wei }),
      iface.encodeEventLog(iface.getEvent('HighRollerReserveFunded'), [slot, 3_979n, 3_979n]),
      event('JackpotBattleLocked', { slot, added: 20_000n * wei, paidEntries: 24n }),
      event('JackpotBattleStarted', { slot, drawnEntries: 7n, word: 2n }),
      event('CrapsBattlePaid', { battleKey, betId: 77n, player: PLAYER, amount: 81_225n * wei }),
      event('CrapsHighRollerPaid', { battleKey, betId: sameSeat ? 77n : 78n, player: PLAYER,
        amount: 144_000n * wei, bankrollRider: false }),
      event('CrapsProgressivePaid', { battleKey, betId: 77n, player: PLAYER, paid: 16_794n * wei }),
    ];
    for (const day of [9, 10]) {
      const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs);
      const result = day === 9 ? snapshot.results[5] : snapshot.yesterdayEventResult;
      assert.equal(result.progressivePaidWei, 16_794n * wei);
      assert.equal(result.highResult.winnerBoostWei, 0n,
        'the jackpot side lane has a known zero routine boost without a routine RNG index');
      assert.equal(result.highResult.highReserveFundedWei, 3_979n * wei,
        'the separate reserve contribution is retained as High Roller funding');
      assert.equal(result.highResult.progressivePaidWei, sameSeat ? 16_794n * wei : 0n,
        'RIU belongs to the exact winning entry, even when the same wallet owns another seat');
      const enriched = craps.crapsLobbySnapshotWithWinnerTotals(snapshot, []);
      const enrichedResult = day === 9 ? enriched.results[5] : enriched.yesterdayEventResult;
      assert.equal(enrichedResult.highResult.progressivePaidWei, sameSeat ? 16_794n * wei : 0n,
        'the confirmed award does not depend on the optional totals projection');
    }
  }
});

test('current Main Event results include real funding and all jackpot-awarded seats exactly once', () => {
  // These raw logs carry whole FLIP; the decode hands token wei to every fold.
  const wei = 10n ** 18n;
  const iface = new ethers.Interface(craps.CRAPS_LOBBY_EVENT_ABI);
  const slot = 41n * 8n + 6n;
  const key = ethers.toBeHex(slot, 32);
  const event = (name, values) => iface.encodeEventLog(iface.getEvent(name), values);
  const logs = [
    event('CrapsBonusOpened', [key, slot, 0n, 0n, 0n, 0n, 8_000n]),
    event('JackpotBattleLocked', [slot, 42, 20_000n, 24]),
    event('JackpotBattleStarted', [slot, 3, 80, 80, 2]),
    // A detached jackpot must never inflate the paid Main Event's count.
    event('JackpotBattleLocked', [slot + 1n, 42, 40_000n, 0]),
    event('JackpotBattleStarted', [slot + 1n, 3, 500, 500, 1]),
    event('CrapsBattleFinalized', [key, 1, 1, 0, 0, 0, 70_000n]),
    // Decoded rows (the wallet decoration has already put the address under `player`).
    { parsed: { name: 'CrapsBattlePaid', args: { betId: 77n, battleKey: key, player: PLAYER, amount: 70_000n * wei } } },
  ];
  for (const day of [41, 42]) {
    const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs);
    const result = day === 41 ? snapshot.results[5] : snapshot.yesterdayEventResult;
    const entrants = day === 41 ? snapshot.entrants.windows[5] : snapshot.entrants.previousEvent;
    assert.equal(result.mainEventAddedWei, 47_500n * wei, 'word 2: a 5x subsidy and the 0.5x pool roll');
    assert.equal(result.winnerBoostWei, null, 'whole-field funding is not reclassified as the winner\'s personal boost');
    assert.equal(entrants.total, 104, '24 paid/day seats plus 80 jackpot seats');
    assert.equal(entrants.awarded, 80);
    assert.equal(entrants.high, 0, 'awarded seats do not become High Rollers');
    assert.equal(entrants.mainPotStakeWei, null, 'awarded seats do not invent paid entry stakes');
  }
  const pending = craps.crapsLobbySnapshotFromLogs(42, logs.slice(0, 2));
  assert.equal(pending.entrants.previousEvent.total, 24);
  assert.equal(pending.entrants.previousEvent.awarded, 0);
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
          bankroll: 600n * wei,
          goal: 3_000n * wei,
          boardStake: 168n * wei,
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
    bankrollFlip: 600n,
    battleStakeFlip: 200n,
    buyInFlip: 800n,
    playedFlip: 240n,
    postedStakeFlip: 168n,
    goalFlip: 3_000n,
    bankMult: 2.5,
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

test('daily Added includes the full Main Event input once and uses its prior allocation until lock', () => {
  const wei = 10n ** 18n;
  const slot = 45n * 8n + 6n;
  const locked = { parsed: { name: 'JackpotBattleLocked', args: {
    slot, requestDay: 46n, added: 20_000n * wei, paidEntries: 100n,
  } } };
  const logs = [
    { parsed: { name: 'CrapsHighRollerDayOpened', args: { day: 46n, mainBoostBudget: 32_000n * wei } } },
    { parsed: { name: 'CrapsProgressiveFunded', args: { day: 46n, contribution: 32_001n * wei } } },
    locked, locked,
    { parsed: { name: 'HighRollerReserveFunded', args: { slot, contribution: 1_000n * wei } } },
  ];
  assert.equal(craps.crapsAddedPerDayFromLogs(46, logs), 84_001n * wei,
    'the full allocation already includes its reserve; neither repeated logs nor seats add more');
  logs.push({ parsed: { name: 'JackpotBattleLocked', args: {
    slot: 46n * 8n + 6n, requestDay: 47n, added: 30_000n * wei, paidEntries: 200n,
  } } });
  assert.equal(craps.crapsAddedPerDayFromLogs(46, logs), 94_001n * wei,
    'today\'s locked allocation replaces yesterday\'s estimate');
});

test('lobby daily totals include Main Event capital without requiring an ordinary boost word for it', () => {
  // These raw logs carry whole FLIP; the decode hands token wei to every fold.
  const wei = 10n ** 18n;
  const iface = new ethers.Interface(craps.CRAPS_LOBBY_EVENT_ABI);
  const event = (name, values) => iface.encodeEventLog(iface.getEvent(name), values);
  const day = 42;
  const mainSlot = 41n * 8n + 6n;
  const logs = [
    event('CrapsHighRollerDayOpened', [41, 1, 25_000n, 0]),
    event('CrapsProgressiveFunded', [41, 25_000n, 100_000n]),
    event('CrapsHighRollerDayOpened', [42, 1, 30_000n, 0]),
    event('CrapsProgressiveFunded', [42, 30_000n, 130_000n]),
    event('CrapsBonusOpened', [ethers.toBeHex(mainSlot, 32), mainSlot, 0, 0, 0, 0, 8_000n]),
    event('JackpotBattleLocked', [mainSlot, 42, 20_000n, 24]),
    event('JackpotBattleStarted', [mainSlot, 3, 80, 80, 2]),
  ];
  const wordsByIndex = {};
  let ordinaryAdded = 0n;
  for (let period = 0; period < 5; period += 1) {
    const slot = 41n * 8n + BigInt(period + 1);
    const key = ethers.toBeHex(slot, 32);
    const index = BigInt(100 + period);
    const word = BigInt(50_000 + period);
    wordsByIndex[String(index)] = word;
    logs.push(
      event('CrapsBonusOpened', [key, slot, 500_000n, 600n, 0, 0, 200n]),
      event('CrapsBonusArmed', [key, slot, index]),
    );
    ordinaryAdded += craps.crapsRealizedBoostWei({ ceilingWei: 500_000n * wei, battleKey: key, wordValue: word });
  }
  const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs, { wordsByIndex });
  assert.equal(snapshot.yesterdayComplete, true,
    'the Main Event is separately funded and has no CrapsBonusArmed word');
  assert.equal(snapshot.yesterdayMainEventFundedWei, 20_000n * wei);
  assert.equal(snapshot.yesterdayTotalAddedWei, ordinaryAdded + 45_000n * wei);
  assert.equal(snapshot.yesterdayAverageAddedWei, 70_000n * wei);
  assert.equal(snapshot.todayAverageAddedWei, 80_000n * wei);
  assert.equal(craps.crapsAddedPerDayFromLogs(day, logs), snapshot.todayAverageAddedWei,
    'the standalone read and full lobby agree');
});

test('lobby history resolves current winners and yesterday exact protocol boost', () => {
  const day = 42;
  const wei = 10n ** 18n;
  const currentKey = `0x${'c1'.padStart(64, '0')}`;
  const currentIndex = '777';
  const currentWord = 123_456n;
  const dayTicketBetId = (336n << 64n) | 3n;
  // Tiers 1/1/2/1/3 across the five ordinary windows weigh 1+1+2+1+4 = 9; the sixth window is the
  // Main Event: it posts no bankroll, is never armed, and takes none of the boost budget.
  const bankrolls = [600n, 600n, 1_800n, 600n, 4_500n, 0n];
  const previous = Array.from({ length: 6 }, (_, period) => ({
    key: `0x${(1000 + period).toString(16).padStart(64, '0')}`,
    index: String(900 + period),
    word: BigInt(50_000 + period),
    ceiling: BigInt(40_000 + (period * 10_000)) * wei,
    bankroll: bankrolls[period] * wei,
  }));
  // Exactly ONE of yesterday's windows actually seated a high roller, so only
  // that one may carry a side-lane boost however large the day's budget was.
  const highLanePeriod = 4; // bankroll 4,500 -> tier 3, weight 4 of the day's 9
  const highBudget = 40_000n * wei;
  const logs = [
    {
      parsed: {
        name: 'CrapsBonusOpened',
        args: {
          battleKey: currentKey,
          slot: 337n,
          seed: 25_000n * wei,
          bankroll: 600n * wei,
          goal: 3_000n * wei,
          boardStake: 168n * wei,
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
        name: 'CrapsBattlePaid',
        args: { betId: 77n, battleKey: currentKey, player: PLAYER, amount: 12_300n * wei },
      },
    },
    // Yesterday's Main Event: its locked allocation and drawn field (word 2).
    { parsed: { name: 'JackpotBattleLocked', args: { slot: 334n, requestDay: 42n, added: 20_000n * wei, paidEntries: 24n } } },
    { parsed: { name: 'JackpotBattleStarted', args: { slot: 334n, drawnEntries: 0n, word: 2n } } },
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
            battleStake: period === 5 ? 8_000n * wei : 200n * wei,
          },
        },
      },
      // The Main Event (period 5) is never armed.
      ...(period < 5 ? [{
        parsed: {
          name: 'CrapsBonusArmed',
          args: { battleKey: key, slot: 329n + BigInt(index) - 900n, index: BigInt(index) },
        },
      }] : []),
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
          battleKey: previous[5].key,
          player: '0x00000000000000000000000000000000000000ee',
          amount: 98_700n * wei,
        },
      },
    },
  ];
  const wordsByIndex = new Map([
    ...previous.map(({ index, word }) => [index, word, 1n]),
    [currentIndex, currentWord],
  ]);
  const snapshot = craps.crapsLobbySnapshotFromLogs(day, logs, { wordsByIndex, player: PLAYER });
  const expectedMain = previous.slice(0, 5).reduce((sum, window) => sum + craps.crapsRealizedBoostWei({
    ceilingWei: window.ceiling,
    battleKey: window.key,
    wordValue: window.word,
  }), 0n);
  // BOTH lanes count, at the capital the house put up. The contested one paid its
  // boost into the lane pot; the sole one staked it on a run that busted — and a
  // busted ride does not un-commit the money.
  const laneBoost = (period, tier) => craps.crapsRealizedBoostFromBaseWei({
    // the whole 40,000 budget is split across the day's ordinary weight of 9.
    baseWei: craps.crapsWindowShareWei(highBudget, 9n, period, tier),
    battleKey: previous[period].key,
    wordValue: previous[period].word,
  });
  const contestedHigh = laneBoost(highLanePeriod, 3);   // bankroll 4,500 -> tier 3
  const soleHigh = laneBoost(1, 1);                     // bankroll   600 -> tier 1
  const expectedHigh = contestedHigh + soleHigh;
  const expectedHighAverage = craps.crapsWindowShareWei(highBudget, 9n, highLanePeriod, 3)
    + craps.crapsWindowShareWei(highBudget, 9n, 1, 1);

  assert.equal(snapshot.results[0].winner, PLAYER);
  assert.equal(snapshot.results[0].betId, '77');
  assert.equal(snapshot.results[0].amountWei, 12_300n * wei);
  assert.equal(snapshot.results[0].boostWei, craps.crapsRealizedBoostWei({
    ceilingWei: 25_000n * wei,
    battleKey: currentKey,
    wordValue: currentWord,
  }));
  assert.equal(snapshot.results[0].winningStop, 0);
  assert.equal(snapshot.results[0].buyInWei, 800n * wei);
  assert.equal(snapshot.results[0].highMultiple, 10);
  assert.equal(snapshot.results[0].winnerBoostWei, snapshot.results[0].mainBoostWei,
    'with nothing denied by standing, the winner receives the whole realized main boost');
  assert.equal(snapshot.results.slice(1).every((result) => result == null), true);
  assert.equal(snapshot.playerEntries.days['42'].highMask, 0b0000101);
  assert.equal(snapshot.playerEntries.days['42'].betId, dayTicketBetId.toString());
  assert.equal(snapshot.playerEntries.days['42'].chips, 0);
  assert.equal(snapshot.playerEntries.days['43'].highMask, 0x3F);
  assert.equal(snapshot.playerEntries.windows.every((entry) => entry == null), true);
  assert.equal(snapshot.yesterdayDay, 41);
  assert.deepEqual(snapshot.yesterdayEventResult, {
    day: 41,
    period: 5,
    battleKey: previous[5].key,
    betId: '88',
    winner: '0x00000000000000000000000000000000000000ee',
    amountWei: 98_700n * wei,
    winningStop: 1,
    winningScoreBps: 0,
    buyInWei: 8_000n * wei,
    highMultiple: 10,
    entryMultiple: null,
    // The Main Event is never armed, so it has no settlement word and no ladder boost; its own
    // funding is the subsidy-and-pool-rolled allocation (word 2, slot 334).
    bonusMultiplier: null,
    mainBoostWei: null,
    winnerBoostWei: null,
    mainEventAddedWei: 47_500n * wei,
    winnerPassWei: 0n,
    progressivePaidWei: 0n,
    highBoostWei: null,
    boostWei: null,
  });
  assert.equal(snapshot.yesterdayComplete, true);
  // The banner says ALL POTS, so both side lanes belong in the total.
  assert.ok(contestedHigh > 0n, 'the fixture must exercise a contested side lane');
  assert.ok(soleHigh > 0n, 'the fixture must exercise a SOLE side lane too');
  // ⛔ THE SOLE LANE PAID ZERO and must still be counted in full: the figure is
  // what the house committed, never what the dice returned.
  assert.equal(snapshot.yesterdayAddedHighWei, expectedHigh, 'a busted sole ride was dropped from the total');
  assert.equal(snapshot.yesterdayAddedMainWei, expectedMain);
  assert.equal(snapshot.yesterdayAddedHighWei, expectedHigh);
  assert.equal(snapshot.yesterdayAddedWei, expectedMain + expectedHigh);
  assert.equal(snapshot.yesterdayProgressiveFundedWei, 25_000n * wei,
    'the separate daily Run It Up contribution is retained');
  assert.equal(snapshot.yesterdayMainEventFundedWei, 20_000n * wei);
  assert.equal(snapshot.yesterdayTotalAddedWei, expectedMain + expectedHigh + (25_000n * wei) + (20_000n * wei));
  assert.equal(snapshot.yesterdayAverageAddedWei,
    (25_000n * wei) + expectedHighAverage + (25_000n * wei) + (20_000n * wei));
  assert.equal(snapshot.todayAverageAddedWei, 70_000n * wei,
    'today\'s average includes the matching Run It Up half even when a bounded live log window omits its funded echo, and yesterday\'s Main Event allocation until today\'s locks');
  assert.deepEqual(snapshot.requiredWordIndexes, [...previous.slice(0, 5).map(({ index }) => index), currentIndex]);
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
    winningScoreBps: null,
    entryMultiple: 10,
    winnerBoostWei: null,
    progressivePaidWei: 0n,
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
        biggestDiceRunHit: true,
        biggestDiceRunBefore: {
          player: '0x0000000000000000000000000000000000000099',
          scoreBps: '5030000',
          bountyWei: '66000',
        },
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
        period: 5,
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
  assert.equal(totals[0].biggestDiceRunHit, true);
  assert.deepEqual(totals[0].biggestDiceRunBefore, {
    player: '0x0000000000000000000000000000000000000099',
    scoreBps: 5_030_000n,
    bountyWei: 66_000n,
  });
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
    resolvedReplays: [{ battleKey, viewerBetId: '808' }],
    yesterdayEventResult: {
      day: 41,
      period: 5,
      battleKey: previousKey,
      betId: '404',
      winner: mainWinner,
      amountWei: 5_000n,
    },
  };
  const enriched = craps.crapsLobbySnapshotWithWinnerTotals(snapshot, totals);
  assert.equal(enriched.results[0].amountWei, 5_000n, 'the lane prize remains available separately');
  assert.equal(enriched.results[0].totalWonWei, 25_000n);
  assert.equal(enriched.results[0].biggestDiceRunHit, true);
  assert.equal(enriched.results[0].biggestDiceRunBefore.scoreBps, 5_030_000n);
  assert.equal(enriched.results[0].highResult.totalWonWei, 12_000n);
  assert.equal(enriched.results[0].highResult.biggestDiceRunHit, true,
    'the side-lane replay uses the same pre-battle record card as the main field');
  assert.equal(enriched.resolvedReplays[0].biggestDiceRunBefore.bountyWei, 66_000n,
    'the owned Pending replay receives the sealed pre-run card too');
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
  const word = 4n;

  assert.equal(craps.crapsBonusMultiplier({ battleKey: key, wordValue: 1n }), 0.25);
  assert.equal(craps.crapsBonusMultiplier({ battleKey: key, wordValue: 4n }), 1);
  assert.equal(craps.crapsBonusMultiplier({ battleKey: key, wordValue: 101n }), 10);
  assert.equal(craps.crapsBonusMultiplier({ battleKey: key, wordValue: 111n }), 100);
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

test('recycled settlement tags recover each battle’s own published word after storage is reused', async () => {
  craps.__resetCrapsSettlementWordsForTest();
  const iface = new ethers.Interface((await loadSchema('GAME')).abi);
  const arm = (slot, index, blockNumber, logIndex) => ({
    parsed: { name: 'CrapsBonusArmed', args: { slot, index, battleKey: ethers.toBeHex(slot, 32) } },
    blockNumber, logIndex,
  });
  const arms = [arm(337n, 0n, 100, 5), arm(338n, 0n, 102, 5), arm(339n, 1n, 103, 5)];
  const publication = (index, word, blockNumber, logIndex) => ({
    ...iface.encodeEventLog(iface.getEvent('LootboxRngApplied'), [index, word, 1n]),
    blockNumber, logIndex,
  });
  const events = [publication(0n, 999n, 100, 4), publication(0n, 222n, 102, 6),
    publication(0n, 111n, 100, 6)]; // RPC order is deliberately shuffled.
  const reads = [];
  const provider = { getLogs: async filter => { reads.push(filter); return events; } };
  const words = await craps.readRecycledCrapsSettlementWords(42, arms, ['0', '1'], provider, 104);
  assert.equal(words.get(ethers.toBeHex(337n, 32)), 111n);
  assert.equal(words.get(ethers.toBeHex(338n, 32)), 222n);
  assert.equal(words.has(ethers.toBeHex(339n, 32)), false, 'undrawn remains unknown');
  assert.equal(reads[0].address, CONTRACTS.GAME);
  assert.equal(reads[0].fromBlock, 100);
  assert.equal(reads[0].toBlock, 104);
  assert.deepEqual(reads[0].topics, [iface.getEvent('LootboxRngApplied').topicHash],
    'the event index is not indexed; the query filters by publication topic only');
  // A later publication must not rewrite a completed battle. Unknown tags keep polling.
  events.push(publication(0n, 333n, 105, 1), publication(1n, 444n, 105, 2));
  const later = await craps.readRecycledCrapsSettlementWords(42, arms, ['0', '1'], provider, 106);
  assert.equal(later.get(ethers.toBeHex(337n, 32)), 111n);
  assert.equal(later.get(ethers.toBeHex(338n, 32)), 222n);
  assert.equal(later.get(ethers.toBeHex(339n, 32)), 444n);
  assert.equal(reads[1].fromBlock, 103, 'completed battles use their session memo');
  const historical = await craps.readRecycledCrapsSettlementWords(42, [arms[2]], ['1'], {
    getLogs: async () => [],
  }, 104);
  assert.equal(historical.size, 0, 'a future publication cannot leak into an earlier pinned head');
  const wei = 10n ** 18n;
  const logs = arms.slice(0, 2).flatMap(row => [row,
    { parsed: { name: 'CrapsBonusOpened', args: { battleKey: row.parsed.args.battleKey,
      slot: row.parsed.args.slot, seed: 50000n * wei, bankroll: 1800n * wei,
      goal: 9000n * wei, boardStake: 504n * wei, battleStake: 100n * wei } } },
    { parsed: { name: 'CrapsBattlePaid', args: { battleKey: row.parsed.args.battleKey,
      betId: row.parsed.args.slot << 64n | 1n, player: PLAYER, amount: 1000n * wei } } },
  ]);
  const snapshot = craps.crapsLobbySnapshotFromLogs(42, logs, { wordsByIndex: words });
  for (let i = 0; i < 2; i++) assert.equal(snapshot.results[i].winnerBoostWei,
    craps.crapsRealizedBoostWei({ ceilingWei: 50000n * wei,
      battleKey: arms[i].parsed.args.battleKey, wordValue: [111n, 222n][i] }));
});

test('lobby entry history scopes a direct High Roller seat to the connected wallet', () => {
  const day = 42;
  const period = 5;
  const slot = BigInt(day * 8 + period + 1);
  const betId = (slot << 64n) | 9n;
  // The echo's own high bit (217) marks the seat; an entry multiple alone no longer does.
  const packedEventBet = 0x1241111n | (betId << 32n) | (9n << 160n) | (1n << 217n);
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
    transactionHash: null,
    entryLogIndex: 0,
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
  // A high seat echoes its high bits: bit 217 for a window slip, every window bit for a day ticket.
  const pack = (slot, seat, multiple = 1) => (
    ((((BigInt(slot) << 64n) | BigInt(seat)) << 32n) | (BigInt(multiple - 1) << 160n))
    | (multiple > 1 ? (BigInt(slot) % 8n === 0n ? 0x3Fn : 1n) << 217n : 0n)
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
        bankroll: 600n * wei,
        goal: 3_000n * wei,
        boardStake: 168n * wei,
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
    slip('0x00000000000000000000000000000000000000a3', (day - 1) * 8 + 6, 1),
    slip('0x00000000000000000000000000000000000000a4', (day - 1) * 8 + 6, 2, 10),
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
    period: 5,
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

test('tomorrow face-cost ranges reflect the six-window slate (five tier-drawn windows plus the jackpot fee)', () => {
  // CrapsBattle._bonusPreset packed tables: each of the five tier-drawn windows spans 800..8,000
  // FLIP (600/1,800/4,500 bank + 200..400/600..1,400/1,500..3,500 bounty); the sixth is the
  // jackpot period, whose fee is 6,000..10,000. A slate therefore spans 5*800+6,000=10,000 to
  // 5*8,000+10,000=50,000, and a High Roller day is that at 10x..100x.
  assert.deepEqual(craps.crapsFutureDayFaceRanges(), {
    normal: {
      low: 10_000n,
      high: 50_000n,
      wager: { low: 3_000n, high: 22_500n },
      battle: { low: 7_000n, high: 27_500n },
    },
    high: {
      low: 100_000n,
      high: 5_000_000n,
      wager: { low: 30_000n, high: 2_250_000n },
      battle: { low: 70_000n, high: 2_750_000n },
    },
  });
});

test('the future-day retail prices are CrapsPriceLib.NORMAL_RETAIL and HIGH_RETAIL', () => {
  assert.deepEqual(craps.crapsFutureDayPrices(), { normal: 25_000n, high: 500_000n });
});

test('the schedule tracks CrapsBattle._BONUS_PERIODS_PER_DAY and its day-ticket high mask width', () => {
  assert.equal(craps.crapsBonusWindows(), 6);
  assert.equal(craps.crapsAllWindowsMask(), 0x3F, '_BET_DAYHIGH_MASK');
  assert.equal(craps.crapsEventHighMask(), 0x3Fn);
  assert.equal(craps.crapsNormalPassesPerHigh(), 21, 'CrapsPriceLib.HIGH_EV');
});

test('day terms: five tier-drawn windows plus a board-less jackpot period priced off its roll', () => {
  const word = '102858562227254754036121703853225298402533986033002165985066946425924666406226';
  const day = craps.crapsBonusDayTerms(word);
  assert.equal(day.windows.length, 6);
  // Every ordinary window (bookends 0/4, routines 1-3) draws off the same tier table; only the
  // jackpot period (5) is a flat, board-less fee.
  for (const window of day.windows.slice(0, 5)) {
    assert.equal(window.event, false);
    assert.ok([600n, 1_800n, 4_500n].includes(window.bankrollFlip), 'bank table');
    assert.equal(window.buyInFlip, window.bankrollFlip + window.battleStakeFlip);
  }
  const jackpot = day.windows[5];
  assert.deepEqual(
    { event: jackpot.event, tier: jackpot.tier, bankrollFlip: jackpot.bankrollFlip, battleStakeFlip: jackpot.battleStakeFlip, playedFlip: jackpot.playedFlip, postedStakeFlip: jackpot.postedStakeFlip },
    { event: true, tier: 0, bankrollFlip: 0n, battleStakeFlip: 10_000n, playedFlip: 0n, postedStakeFlip: 0n },
    'CrapsPriceLib.jackpotPrice: this word draws the 10,000 fee',
  );
  assert.deepEqual([0n, 1n, 2n, 3n, 4n, 7n].map(craps.crapsJackpotEntryPriceFlip), [6_000n, 8_000n, 8_000n, 10_000n, 6_000n, 10_000n]);
  const fees = new Set(Array.from({ length: 64 }, (_, i) => craps.crapsBonusDayTerms(BigInt(i + 1)).windows[5].battleStakeFlip));
  assert.deepEqual([...fees].sort((a, b) => Number(a - b)), [6_000n, 8_000n, 10_000n]);
  assert.equal(day.buyInFlip, day.windows.reduce((sum, window) => sum + window.buyInFlip, 0n));
});

test('a scheduled round is bankroll x 2/5 (2.5 rounds deep)', () => {
  const word = '102858562227254754036121703853225298402533986033002165985066946425924666406226';
  // CrapsBattleStorage._schedRound: tier bankrolls 600 / 1,800 / 4,500 play 240 / 720 / 1,800.
  assert.deepEqual([600n, 1_800n, 4_500n].map(craps.crapsScheduledRoundFlip), [240n, 720n, 1_800n]);
  for (const window of craps.crapsBonusDayTerms(word).windows.slice(0, 5)) {
    assert.equal(window.playedFlip, window.bankrollFlip * 2n / 5n);
    assert.equal(window.postedStakeFlip, window.playedFlip / 10n * 7n, 'postedStake = played / _BONUS_CHIPS * _MAX_PICKED_CHIPS');
    assert.equal(window.bankMult, 2.5);
  }
});

test('a day budget splits across its ordinary windows exactly as _windowShare does', () => {
  const wei = 10n ** 18n;
  const budget = 40_000n * wei;
  // Five ordinary windows at tiers 1/1/2/1/3 weigh 1+1+2+1+4 = 9; the jackpot window carries none.
  const windows = [1, 1, 2, 1, 3, 0].map((tier) => ({ tier }));
  assert.equal(craps.crapsRoutineWeight(windows), 9n);
  assert.equal(craps.crapsWindowShareWei(budget, 9n, 5, 0), 0n, 'the jackpot period takes none of the boost budget');
  // Ordinary windows split the WHOLE budget by tier weight: tier 3 carries 4 of the 9.
  assert.equal(craps.crapsWindowShareWei(budget, 9n, 4, 3), 160_000n * wei / 9n);
  assert.equal(craps.crapsWindowShareWei(budget, 10n, 0, 1), 4_000n * wei);
  // A partial day has no honest denominator, so it yields none.
  assert.equal(craps.crapsRoutineWeight([{ tier: 1 }, null, { tier: 2 }]), null);
  assert.equal(craps.crapsWindowShareWei(budget, 0n, 0, 1), 0n);
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
      settlementState: 'complete',
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
      settlementState: 'complete',
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
      settlementState: 'awaiting-rng',
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
    | (multiple > 1 ? ((betId >> 64n) % 8n === 0n ? 0x3Fn : 1n) << 217n : 0n)
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
          bankroll: 600n * wei,
          goal: 3_000n * wei,
          boardStake: 168n * wei,
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
    assert.equal(replay.buyInWei, (800n * wei).toString());
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
  const unset = { chips: 0, placed: 0, initialized: false };
  assert.deepEqual(await craps.readCrapsPassCredits(PLAYER), { normal: 17, high: 2, preferredBoard: unset });
  assert.deepEqual(craps.decodeCrapsPassCredits((9n << 32n) | 23n), { normal: 23, high: 9, preferredBoard: unset });
  // CrapsPreferenceLib: pass x1 (leg 0), place 6 x2 (leg 3), hard 8 x3 (leg 8), two bits a leg.
  const compact = 1n | (2n << 6n) | (3n << 16n);
  const saved = (compact << 64n) | (1n << 84n) | (4n << 32n) | 5n;
  assert.deepEqual(craps.decodeCrapsPassCredits(saved), {
    normal: 5, high: 4,
    preferredBoard: { chips: 1 | (2 << 9) | (3 << 24), placed: 6, initialized: true },
  });
  assert.deepEqual(craps.decodeCrapsPreferredBoard(1n << 84n), { chips: 0, placed: 0, initialized: true });
  // The comps live in `_passCreditsById`, keyed by wallet ID, at the slot the audit's layout names.
  assert.equal(craps.crapsPassCreditsStorageKey(PLAYER_ID), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint32', 'uint256'], [PLAYER_ID, BigInt(crapsFields._passCreditsById.slot)],
  )));
});


test('scheduled entries, amendments, future days, and upgrades use their distinct contract doors', async () => {
  await craps.placeCrapsBonusEntry({
    valid: true,
    method: 'enterBonusBattle',
    contractArgs: [3, 0x1241111, 1],
  });
  // Every write leads with the acting account's ID; 0 means the caller.
  assert.deepEqual(contract._calls['static:enterBonusBattle'], [[0, 3, 0x1241111, 1, { from: PLAYER }]]);
  assert.deepEqual(contract._calls.enterBonusBattle, [[0, 3, 0x1241111, 1]]);

  await craps.placeCrapsBonusEntry({
    valid: true,
    method: 'enterBonusDay',
    contractArgs: [0x1241111, 1],
  });
  assert.deepEqual(contract._calls['static:enterBonusDay'], [[0, 0x1241111, 1, { from: PLAYER }]]);
  assert.deepEqual(contract._calls.enterBonusDay, [[0, 0x1241111, 1]]);

  await craps.placeCrapsBonusEntry({
    valid: true,
    method: 'buyFutureCrapsDays',
    contractArgs: [43, 1, true, 0x1241111],
  });
  assert.deepEqual(contract._calls['static:buyFutureCrapsDays'], [[0, 43, 1, true, 0x1241111, { from: PLAYER }]]);
  assert.deepEqual(contract._calls.buyFutureCrapsDays, [[0, 43, 1, true, 0x1241111]]);

  await craps.placeCrapsBonusEntry({
    valid: true,
    method: 'applyCrapsPasses',
    contractArgs: [44, 1, false, 0x1241111],
  });
  assert.deepEqual(contract._calls['static:applyCrapsPasses'], [[0, 44, 1, false, 0x1241111, { from: PLAYER }]]);
  assert.deepEqual(contract._calls.applyCrapsPasses, [[0, 44, 1, false, 0x1241111]]);

  await craps.amendCrapsSlip({ betId: '6206227746803369984', contractChips: 0x1241111 });
  assert.deepEqual(contract._calls['static:amendSlip'], [[0, '6206227746803369984', 0x1241111, { from: PLAYER }]]);
  assert.deepEqual(contract._calls.amendSlip, [[0, '6206227746803369984', 0x1241111]]);

  await craps.upgradeCrapsDayWindows({ day: 42, periodMask: 0b0010101 });
  assert.deepEqual(contract._calls['static:upgradeDayWindows'], [[0, 42, 0b0010101, { from: PLAYER }]]);
  assert.deepEqual(contract._calls.upgradeDayWindows, [[0, 42, 0b0010101]]);

  // A BLIND future reservation has no landed word to price windows off, so it takes a
  // different door: one banked HIGH comp for the whole day, nothing burned.
  const reserved = await craps.upgradeCrapsReservedDay({ day: 44 });
  assert.deepEqual(contract._calls['static:upgradeReservedDay'], [[0, 44, { from: PLAYER }]]);
  assert.deepEqual(contract._calls.upgradeReservedDay, [[0, 44]]);
  assert.equal(reserved.periodMask, 0x3F, 'the reserved-day door upgrades all six windows');

  const converted = await craps.convertCrapsNormalPassesToHigh({ highCount: 2 });
  assert.deepEqual(contract._calls['static:convertNormalToHigh'], [[0, 2, { from: PLAYER }]]);
  assert.deepEqual(contract._calls.convertNormalToHigh, [[0, 2]]);
  assert.equal(converted.normalsSpent, 42, '21 normal comps per High Roller comp');
});

test('the reserved-day upgrade refuses a day it could never name on-chain', async () => {
  await assert.rejects(() => craps.upgradeCrapsReservedDay({ day: 0 }), /valid future Craps day/);
  await assert.rejects(() => craps.upgradeCrapsReservedDay({ day: 0x1000000 }), /valid future Craps day/);
  await assert.rejects(() => craps.convertCrapsNormalPassesToHigh({ highCount: 0 }), /High Roller comps/);
  assert.equal(craps.crapsNormalPassesPerHigh(), 21, 'mirrors CrapsBattle._PASSES_PER_HIGH');
});

test('scheduled Craps preflight stays on the public reader before a browser-wallet send', async () => {
  const walletRequests = [];
  const browserProvider = new ethers.BrowserProvider({
    request: async ({ method }) => {
      walletRequests.push(method);
      if (method === 'eth_chainId') return CHAIN.hexId;
      if (method === 'eth_accounts') return [PLAYER];
      throw new Error(`Unexpected wallet request: ${method}`);
    },
  }, 'any');
  const publicReader = { transport: 'public' };
  const publicContract = fakeContract();
  const walletContract = fakeContract();
  const runners = [];
  contracts.setProvider(browserProvider);
  readProvider._setSharedReadProviderForTests(publicReader);
  craps.__setCrapsContractFactoryForTest((runner) => {
    runners.push(runner);
    return runner === publicReader ? publicContract : walletContract;
  });

  await craps.placeCrapsBonusEntry({
    valid: true,
    method: 'enterBonusBattle',
    contractArgs: [3, 0x1241111, 1],
  });

  assert.equal(runners[0], publicReader,
    'the simulation is composed on the shared public RPC, not the wallet transport');
  assert.equal(runners.includes(publicReader), true);
  assert.equal(walletRequests.includes('eth_call'), false,
    'the browser wallet is not asked to service a read-only eth_call');
  assert.equal(publicContract._calls['static:enterBonusBattle'].length, 1);
  const simulationArgs = publicContract._calls['static:enterBonusBattle'][0];
  assert.deepEqual(simulationArgs.slice(0, 4), [0, 3, 0x1241111, 1]);
  assert.equal(simulationArgs[4]?.from?.toLowerCase(), PLAYER,
    'the public simulation preserves the connected wallet as msg.sender');
  assert.deepEqual(walletContract._calls.enterBonusBattle, [[0, 3, 0x1241111, 1]],
    'only the actual transaction is composed with the fresh wallet signer');
});

test('receipt parsing decodes the packed slip echo the contract really emits', () => {
  // CrapsSlipPlaced carries ONE word: chips, then the bet id at bit 32, the entry
  // multiple at bit 160, the entry boon at 206 and the seat's high-roller bits at 217.
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
    player: PLAYER,
    betId: betId.toString(),
    slot: '337',
    multiple: 10,
    chips: 0x1241111,
    highMask: 0,
    high: false,
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

test('the slip echo carries the seat high bits at the shift the bet word stores them', () => {
  // `_writeSlip` ORs `highBits` into the event word unchanged, so bit 217 alone is a window
  // seat and 217..222 is a day ticket's per-period mask. A COMPED high day seat (evMult 0 →
  // multiple 1) is visible only through these bits.
  const windowBetId = (338n << 64n) | 7n;   // slot % 8 === 2 → window-local slip
  const dayBetId = (336n << 64n) | 9n;      // slot % 8 === 0 → whole-day ticket
  const HIGH_BIT = 1n << 217n;
  const DAY_HIGH = 0x3Fn << 217n;

  assert.deepEqual(craps.decodeCrapsSlipHighBits(HIGH_BIT, false), { highMask: 0x3F, high: true });
  assert.deepEqual(craps.decodeCrapsSlipHighBits(0n, false), { highMask: 0, high: false });
  assert.deepEqual(craps.decodeCrapsSlipHighBits(DAY_HIGH, true), { highMask: 0x3F, high: true });
  assert.deepEqual(craps.decodeCrapsSlipHighBits(0x05n << 217n, true), { highMask: 0x05, high: true });

  const comped = craps.parseCrapsReceipt({ logs: [
    // evMult stays ZERO on a banked HIGH pass, so `multiple` decodes to 1x.
    { parsed: { name: 'CrapsSlipPlaced', args: { player: PLAYER, bet: (dayBetId << 32n) | DAY_HIGH } } },
    { parsed: { name: 'CrapsSlipPlaced', args: { player: PLAYER, bet: (windowBetId << 32n) | HIGH_BIT } } },
  ] });
  assert.equal(comped.placed[0].multiple, 1, 'a comped high seat still echoes 1x');
  assert.equal(comped.placed[0].high, true, 'but its high bits say otherwise');
  assert.equal(comped.placed[0].highMask, 0x3F);
  assert.equal(comped.placed[1].high, true, 'a window-local high seat sets bit 217 alone');
  assert.equal(comped.placed[1].highMask, 0x3F);
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

// ⛔ WINDOW_HEAD MUST SIT ABOVE THE LIVE DEPLOY BLOCK — never hardcode it.
// readCrapsLobbySnapshot clamps its scan floor with `Math.max(deployBlock, toBlock - lookback)`,
// which is correct, but these tests assert the UNCLAMPED `WINDOW_HEAD - WINDOW_LOOKBACK` because
// what they exercise is the cursor EXTENDING, not the clamp. A literal head works only until the
// real chain passes it, so derive it: +100k blocks is comfortably clear of WINDOW_LOOKBACK.
const WINDOW_HEAD = (Number(CHAIN.deployBlock) || 0) + 100_000;
// ⛔ Same trap as WINDOW_HEAD: the lookback is DERIVED from the active profile's day length
// (app/app/craps.js crapsLogLookbackBlocks — four days of blocks, floored at 1,800, capped at
// 45,000), so it is derived here too.
const WINDOW_LOOKBACK = (() => {
  const daySeconds = Number(CRAPS_SCHEDULE?.daySeconds);
  const blockSeconds = Number(CRAPS_SCHEDULE?.blockSeconds);
  if (!(daySeconds > 0) || !(blockSeconds > 0)) return 45_000;
  return Math.min(45_000, Math.max(1_800, Math.ceil((4 * daySeconds) / blockSeconds)));
})();
const WINDOW_TAIL = 12;
const WINDOW_DAY = 42;
// Digits only. An address with letters comes back checksummed from an ethers
// decode and lowercase from the API, and the winner fields are deliberately
// NOT lowercased, so a mixed-case fixture would test the casing rather than
// the transport.
const WINDOW_PLAYER = '0x1234512345123451234512345123451234512345';
const WINDOW_DONOR = '0x9876598765987659876598765987659876598765';
const WINDOW_WEI = 10n ** 18n;

// The deployed events carry wallet IDs where the fixtures speak addresses.
const WINDOW_PLAYER_ID = 7;

function windowInterface() {
  return new ethers.Interface(walletAbi(craps.CRAPS_LOBBY_EVENT_ABI, crapsAbi));
}

/** One fixture, rendered as the indexer's EventRow (addresses already resolved, amounts in token wei). */
function crapsEventRow(iface, fixture) {
  const args = {};
  for (const [name, value] of Object.entries(fixture.args)) {
    args[name] = typeof value === 'boolean'
      ? value
      : typeof value === 'string' && value.startsWith('0x')
        ? value.toLowerCase()
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

// FLIP amounts are whole tokens on chain; the fixtures hold token wei.
const WINDOW_FLIP_FIELDS = Object.freeze({
  CrapsBattleFinalized: ['pot'],
  CrapsBattlePaid: ['amount'],
  CrapsBonusDonated: ['amount', 'seed'],
  CrapsBonusOpened: ['seed', 'bankroll', 'goal', 'boardStake', 'battleStake'],
  CrapsDayWindowsUpgraded: ['burned'],
  CrapsHighRollerDayOpened: ['mainBoostBudget', 'highRollerBoostBudget'],
  CrapsHighRollerPaid: ['amount'],
  CrapsProgressiveFunded: ['contribution', 'balance'],
  CrapsProgressivePaid: ['candidate', 'paid', 'balance'],
  CrapsProtocolAwardSplit: ['grossProtocol', 'liquidFlip'],
});

/** The same fixture, rendered as the raw log eth_getLogs would return. */
function crapsChainLog(iface, fixture, address) {
  const fragment = iface.getEvent(fixture.name);
  const flip = WINDOW_FLIP_FIELDS[fixture.name] ?? [];
  const { data, topics } = iface.encodeEventLog(
    fragment,
    fragment.inputs.map((input) => {
      if (input.name === 'playerId') return WINDOW_PLAYER_ID;
      const value = fixture.args[input.name];
      return flip.includes(input.name) ? value / WINDOW_WEI : value;
    }),
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
    bankroll: 600n * WINDOW_WEI,
    goal: 3_000n * WINDOW_WEI,
    boardStake: 168n * WINDOW_WEI,
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
    getNetwork: async () => ({ chainId: BigInt(ACTIVE_CHAIN_ID) }),
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

/**
 * Drop the test contract factory (the API is skipped under one) but keep a real address. Raw logs
 * carry wallet IDs, which the chain client resolves against a fixture chain that knows the
 * window's player and answers for the real CRAPS address.
 */
async function useWindowTransport(logs = []) {
  const chain = await rpcFixture({ head: WINDOW_HEAD + 10 });
  chain.contracts.CRAPS = CONTRACTS.CRAPS;
  await chain.wallet(WINDOW_PLAYER_ID, WINDOW_PLAYER);
  setChainClientForTests(chain.client);
  _setWalletIdForTests(WINDOW_PLAYER, WINDOW_PLAYER_ID);
  craps.__setCrapsContractFactoryForTest(null, CONTRACTS.CRAPS);
  craps.__resetCrapsLogWindowForTest();
  const provider = windowProvider(logs);
  contracts.setProvider(provider);
  return provider;
}

/** The lobby window's own eth_getLogs calls (not the GAME word-publication scan). */
const windowCalls = (provider) => provider.calls.filter((call) => Array.isArray(call.topics?.[0]));

test('an AlreadyInBonus repair reads only the affected player entry topics from chain', async () => {
  const iface = windowInterface();
  const slot = BigInt(WINDOW_DAY) * 8n;
  const betId = (slot << 64n) | 77n;
  const fixture = {
    name: 'CrapsSlipPlaced',
    args: { player: WINDOW_PLAYER, bet: (betId << 32n) | 0x1241111n },
    blockNumber: WINDOW_HEAD - 2,
    logIndex: 0,
    txHash: `0x${'77'.padStart(64, '0')}`,
  };
  const provider = await useWindowTransport([
    crapsChainLog(iface, fixture, CONTRACTS.CRAPS),
  ]);

  const entries = await craps.readCrapsPlayerEntriesOnChain(WINDOW_DAY, WINDOW_PLAYER);

  assert.equal(provider.calls.length, 1);
  assert.equal(Number(provider.calls[0].fromBlock), WINDOW_HEAD - WINDOW_LOOKBACK);
  assert.equal(Number(provider.calls[0].toBlock), WINDOW_HEAD);
  assert.deepEqual(new Set(provider.calls[0].topics[0]), new Set([
    iface.getEvent('CrapsSlipPlaced').topicHash,
    iface.getEvent('CrapsDayReserved').topicHash,
    iface.getEvent('CrapsDayWindowsUpgraded').topicHash,
  ]));
  assert.equal(
    provider.calls[0].topics[1].toLowerCase(),
    ethers.toBeHex(WINDOW_PLAYER_ID, 32),
    'the second topic pins the exact connected wallet by its account ID',
  );
  assert.equal(entries.player, WINDOW_PLAYER);
  assert.equal(entries.days[String(WINDOW_DAY)].betId, betId.toString());
  assert.equal(entries.days[String(WINDOW_DAY)].chips, 0x1241111);
  assert.equal(entries.windows.every((entry) => entry == null), true);
});

function windowApiKey() {
  return `craps-window-api:v3:${CHAIN.id}:${String(CONTRACTS.CRAPS).toLowerCase()}`
    + `:${Number(CHAIN.deployBlock) || 0}`;
}

test('the indexed craps window folds to exactly the snapshot the log window folds to', async () => {
  const iface = windowInterface();
  const fixtures = crapsWindowFixtures();
  const provider = await useWindowTransport(
    fixtures.map((fixture) => crapsChainLog(iface, fixture, CONTRACTS.CRAPS)),
  );

  craps.__setCrapsEventsFetcherForTest(async () => ({
    fromBlock: WINDOW_HEAD - WINDOW_LOOKBACK,
    toBlock: WINDOW_HEAD,
    lookbackBlocks: WINDOW_LOOKBACK,
    events: fixtures.map((fixture) => crapsEventRow(iface, fixture)),
  }));
  const fromApi = await craps.readCrapsLobbySnapshot(WINDOW_DAY, WINDOW_PLAYER);
  assert.equal(windowCalls(provider).length, 0, 'a healthy API must never scan the lobby window from chain');
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
  assert.ok(windowCalls(provider).length >= 1, 'a dead API must fall back to the chain');
  assert.deepEqual(fromApi, fromChain);
});

test('the craps window refresh asks for the reorg tail and replaces the rows inside it', async () => {
  const iface = windowInterface();
  const provider = await useWindowTransport();
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
    `/game/craps/events?lookback=${WINDOW_LOOKBACK}`,
    `/game/craps/events?lookback=${WINDOW_LOOKBACK}&since=${WINDOW_HEAD - WINDOW_TAIL}`,
  ]);
  assert.equal(provider.calls.length, 0);
});

test('the craps window mirrors its cursor to localStorage so a reload pays only the tail', async () => {
  const iface = windowInterface();
  const fixtures = crapsWindowFixtures();
  const provider = await useWindowTransport();
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
    assert.deepEqual(paths, [`/game/craps/events?lookback=${WINDOW_LOOKBACK}&since=${WINDOW_HEAD - WINDOW_TAIL}`]);
    assert.equal(provider.calls.length, 0, 'a revived window never rescans the chain');
  } finally {
    reloaded.__resetCrapsContractFactoryForTest();
  }
});

test('a dead craps events route falls back to the chain and is not re-probed for five minutes', async () => {
  const iface = windowInterface();
  const fixtures = crapsWindowFixtures();
  const provider = await useWindowTransport(
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
  assert.equal(windowCalls(provider).length, 2, 'both refreshes came off the chain window');
  assert.equal(
    Number(windowCalls(provider)[1].fromBlock),
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
  const provider = await useWindowTransport(
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
  assert.equal(windowCalls(provider).length, 1);
  assert.equal(Number(windowCalls(provider)[0].fromBlock), WINDOW_HEAD - WINDOW_LOOKBACK);
  assert.equal(await craps.readCrapsAddedPerDay(WINDOW_DAY), 2_000n * WINDOW_WEI);
  assert.equal(windowCalls(provider).length, 2);
  assert.equal(Number(windowCalls(provider)[1].fromBlock), WINDOW_HEAD - WINDOW_TAIL + 1);
  assert.deepEqual(windowCalls(provider)[1].topics.length, 1, 'and it reuses the window filter');
});


test('the entry boon reads the owned seat\'s one-hot mask, including consumed tiers', async () => {
  // Seat 4 of slot 337 (day 42, window 0) is lane 0 of its packed storage word: the owner's wallet
  // ID in the low 32 bits, the one-hot boon at bit 62, and the bank's day tag at bit 216.
  // (Each read below uses its own seat group, so the storage read memo cannot answer for it.)
  const seatId = (n) => (337n << 64n) | BigInt(1 + 3 * n);
  const word = (mask, owner = PLAYER_ID) => BigInt(owner) | (BigInt(mask) << 62n) | (42n << 216n);
  let stored;
  let requestedKey;
  contracts.setProvider({
    ...fakeProvider(),
    getStorage: async (_address, key) => {
      requestedKey = key;
      return ethers.toBeHex(stored, 32);
    },
  });
  const masks = [[0, 0], [1, 5], [2, 10], [4, 15], [3, 0], [7, 0]];
  for (const [n, [mask, percent]] of masks.entries()) {
    stored = word(mask);
    assert.equal(await craps.readCrapsEntryBoonPercent(seatId(n), PLAYER), percent);
  }
  stored = word(2);
  assert.equal(await craps.readCrapsEntryBoonPercent(seatId(6), '0x2222222222222222222222222222222222222222'), 0,
    'a seat owned by another account carries no boon for this wallet');
  stored = word(2) ^ (42n << 216n) | (41n << 216n);
  assert.equal(await craps.readCrapsEntryBoonPercent(seatId(7), PLAYER), 0, 'a bank reused by a later day reads as no seat');
  assert.equal(requestedKey, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256'], [(337n << 64n) | 8n, 0n],
  )), '_bets is mapping slot 0 keyed by the bank slot and the seat\'s word index');
});


test('comped entries use receipt funding and pass redemption, excluding later upgrades', async () => {
  // The receipt's account IDs are resolved before the synchronous parser reads it.
  const chain = await rpcFixture({ head: 10_000 });
  chain.contracts.COIN = CONTRACTS.COIN;
  await chain.wallet(PLAYER_ID, PLAYER);
  setChainClientForTests(chain.client);
  const iface = new ethers.Interface(walletAbi([
    'event CrapsCompSpent(address indexed player,uint256 amount)',
    'event Transfer(address indexed from,address indexed to,uint256 value)',
  ], coinAbi));
  const event = (name, args, index, address = CONTRACTS.COIN) => ({
    ...iface.encodeEventLog(iface.getEvent(name), args), index, address,
  });
  const entry = { transactionHash: '0xcomp', entryLogIndex: 5 };
  const spent = event('CrapsCompSpent', [PLAYER_ID, 25000n], 3);
  const paid = event('Transfer', [PLAYER, ethers.ZeroAddress, 25000n], 4);
  const receipt = { blockNumber: 9_999, logs: [spent] };
  await prepareWalletReceipt({ blockNumber: 9_999, logs: [spent, paid] }, chain.client);
  assert.equal(craps.crapsEntryWasComped(entry, PLAYER, {}, receipt), true);
  assert.equal(craps.crapsEntryWasComped(entry, PLAYER, {}, { logs: [spent, paid] }), false);
  assert.equal(craps.crapsEntryWasComped(entry, PLAYER, {}, { logs: [{ ...spent, index: 6 }] }), false);
  assert.equal(craps.crapsEntryWasComped(entry, PLAYER, {}, { logs: [{ ...spent, address: CONTRACTS.GAME }] }), false);
  const transaction = {
    to: CONTRACTS.CRAPS, from: PLAYER,
    data: ethers.id('applyCrapsPasses(uint32,uint24,uint8,bool,uint32)').slice(0, 10),
  };
  assert.equal(craps.crapsEntryWasComped(entry, PLAYER, transaction, { logs: [] }), true);
  const reads = [];
  const provider = {
    getTransaction: async (hash) => { reads.push(hash); return {}; },
    getTransactionReceipt: async () => receipt,
  };
  const entries = { player: PLAYER, days: { 42: entry }, windows: [entry, null] };
  const result = await craps.decorateCrapsCompEntries(entries, provider);
  assert.equal(result.days[42].comped, true);
  assert.equal(result.windows[0].comped, true);
  assert.equal(result.windows[1], null);
  await craps.decorateCrapsCompEntries(entries, provider);
  assert.equal(reads.length, 1, 'shared transaction reads are cached across rows and polls');
  assert.equal(entry.comped, undefined, 'the source entry is not mutated');
  const unavailable = await craps.decorateCrapsCompEntries(entries, {
    getTransaction: async () => { throw new Error('offline'); },
    getTransactionReceipt: async () => null,
  });
  assert.equal(unavailable.days[42].comped, undefined);
});


test('armed battle switches from awaiting RNG to settling when its committed word arrives', () => {
  const day = 42;
  const battleKey = '0x' + '151'.padStart(64, '0');
  const logs = [
    { parsed: { name: 'CrapsBonusOpened', args: { day: 42n, slot: 337n, battleKey,
      bankroll: 300n * 10n ** 18n, goal: 1500n * 10n ** 18n, boardStake: 42n * 10n ** 18n, battleStake: 200n * 10n ** 18n, seed: 0n } } },
    { parsed: { name: 'CrapsBonusArmed', args: { battleKey, slot: 337n, index: 99n } } },
  ];
  const pending = craps.crapsLobbySnapshotFromLogs(day, logs);
  assert.equal(pending.settlementStates[0], 'awaiting-rng');
  const ready = craps.crapsLobbySnapshotFromLogs(day, logs, { wordsByIndex: new Map([['99', 123n]]) });
  assert.equal(ready.settlementStates[0], 'settling');
});

// ---- the table surface and newcomer pricing ----

const SIM_CONTRACTS = new URL('../../../../degenerus-sim/contracts/', import.meta.url);
const flatSol = (path) => readFileSync(new URL(path, SIM_CONTRACTS), 'utf8').replace(/\s+/g, ' ');

test('the craps ABI carries no settlement door: mineFlip settles every field', () => {
  const iface = new contracts.ethers.Interface(craps.FLIP_CRAPS_ABI);
  const battle = flatSol('CrapsBattle.sol');
  assert.equal(iface.getFunction('armBonusWindow'), null, 'the stages arm in order; the door is gone');
  assert.ok(!battle.includes('function armBonusWindow('));
  assert.equal(iface.getFunction('createBattle').format('sighash'),
    'createBattle(uint32,uint8,uint16,uint24,uint40,bool,uint16)', 'minScore left the custom terms');
  assert.ok(flatSol('JackpotBattle.sol').includes('function createBattle( uint32 played, uint8 bankMult, uint16 goalMult, uint24 stakeUnits, uint40 closeTime, bool multiEntry, uint16 highRollerMult ) external returns (uint64 slot)'));
  assert.equal(iface.getEvent('CrapsProgressiveRolled'), null);
  assert.equal(iface.getError('ScoreRequiredForBonus'), null);
  assert.ok(!battle.includes('ScoreRequiredForBonus') && !battle.includes('CrapsProgressiveRolled'));
  // resolveSlot and keepScheduled[Budgeted] are gone from the table and the ABI;
  // closeBattle still binds a custom field to a table index.
  for (const name of ['resolveSlot', 'keepScheduled', 'keepScheduledBudgeted']) {
    assert.equal(iface.getFunction(name), null, `${name} left the ABI`);
    assert.ok(!battle.includes(`function ${name}(`), `${name} left CrapsBattle`);
  }
  assert.ok(iface.getFunction('closeBattle'));
  assert.ok(flatSol('JackpotBattle.sol').includes('function closeBattle(uint64 slot) external returns (uint48 index)'));
});

test('the jackpot fee and hidden subsidy roll mirror the contract source', () => {
  const price = flatSol('libraries/CrapsPriceLib.sol');
  assert.ok(price.includes('function jackpotPrice(uint256 roll) internal pure returns (uint256) { uint256 bucket = roll & 3; return bucket == 0 ? 6_000 : bucket == 3 ? 10_000 : JACKPOT_FEE; }'));
  assert.ok(flatSol('CrapsBattle.sol').includes('if (period == _BONUS_PERIODS_PER_DAY - 1) return (0, 0, 0, CrapsPriceLib.jackpotPrice(roll) / _BATTLE_STAKE_UNIT, 0);'));
  const battle = flatSol('JackpotBattle.sol');
  assert.ok(battle.includes('uint256 subsidyBps = _subsidyMultiplier(EntropyLib.hash2(RngTags.CRAPS_SUBSIDY, word)); uint256 mainAdded = r.added - r.added / _HIGH_RESERVE_DIVISOR; mainAdded = mainAdded * subsidyBps / 10_000;'));
  assert.ok(battle.includes('return roll < 60 ? 2_500 : roll < 90 ? 10_000 : roll < 99 ? 50_000 : 100_000;'));
  assert.ok(flatSol('libraries/RngTags.sol').includes('uint256 internal constant CRAPS_SUBSIDY = 41;'));
  // The subsidy roll and the pool roll are keyed exactly as the contract keys them.
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const slot = 41n * 8n + 6n;
  for (const word of [1n, 2n, 46n, 34n, 777n]) {
    const roll = BigInt(ethers.keccak256(coder.encode(['uint256', 'uint256'], [41n, word]))) % 100n;
    assert.equal(craps.crapsJackpotSubsidyBps(word, slot), roll < 60n ? 2_500n : roll < 90n ? 10_000n : roll < 99n ? 50_000n : 100_000n);
  }
});

test('newcomer pricing mirrors CrapsBattle account pricing', () => {
  const battle = flatSol('CrapsBattle.sol');
  assert.ok(battle.includes('function _newcomer(uint32 id) internal view returns (bool)'));
  assert.ok(battle.includes('uint256 packed = IGameCraps(_GAME).mintPackedOfId_g5372(id);'));
  assert.ok(battle.includes('return lastMintLevel == 0 || lastMintLevel + 1 < IGameCraps(_GAME).level();'));
  assert.ok(battle.includes('if (account & _ACCOUNT_NEWCOMER != 0) grossAndFlags += ((grossAndFlags >> 8) / 20) << 8;'));
  const bits = flatSol('libraries/BitPackingLib.sol');
  assert.ok(bits.includes('uint256 internal constant LEVEL_COUNT_SHIFT = 24;'));
  assert.ok(bits.includes('uint256 internal constant HAS_DEITY_PASS_SHIFT = 172;'));
  const mint = ({ last = 0n, count = 0n, deity = false } = {}) => last | (count << 24n) | (deity ? 1n << 172n : 0n);
  assert.equal(craps.crapsNewcomerPricing(mint(), 5), true, 'no history');
  assert.equal(craps.crapsNewcomerPricing(mint({ last: 3n, count: 2n }), 5), true, 'two levels, none recent');
  assert.equal(craps.crapsNewcomerPricing(mint({ last: 4n, count: 1n }), 5), false, 'minted at the previous level');
  assert.equal(craps.crapsNewcomerPricing(mint({ last: 5n, count: 1n }), 5), false, 'minted this level');
  assert.equal(craps.crapsNewcomerPricing(mint({ last: 1n, count: 3n }), 9), false, 'three credited levels');
  assert.equal(craps.crapsNewcomerPricing(mint({ deity: true }), 9), false, 'a deity pass');
  assert.equal(craps.crapsNewcomerPricing(mint(), 0), true, 'level 0, no mint: lastMintLevel is zero');
  const wei = 10n ** 18n;
  assert.equal(craps.crapsEntryPriceWei(8_000n * wei, true), 8_400n * wei);
  assert.equal(craps.crapsEntryPriceWei(8_000n * wei, false), 8_000n * wei);
  assert.equal(craps.crapsEntryPriceFlip(25_000n, true), 26_250n);
  assert.equal(craps.crapsEntryPriceFlip(4_500n, true), 4_725n);
});

test('newcomer pricing reads the wallet\'s mint history and the game level off GAME', async () => {
  const { Interface } = ethers;
  const game = new Interface(['function mintPackedFor(address) view returns (uint256)', 'function level() view returns (uint24)']);
  const calls = [];
  craps.__setCrapsContractFactoryForTest(null, CONTRACTS.CRAPS);
  contracts.setProvider({
    ...fakeProvider(),
    call: async ({ data }) => {
      const fn = game.getFunction(data.slice(0, 10));
      calls.push(fn.name);
      return game.encodeFunctionResult(fn, [fn.name === 'level' ? 9 : 0]);
    },
  });
  assert.equal(await craps.readCrapsNewcomerPricing(PLAYER), true, 'no mint history at level 9');
  assert.deepEqual(calls.sort(), ['level', 'mintPackedFor']);
  assert.equal(await craps.readCrapsNewcomerPricing('not an address'), false);
});


test('hottest shooter keeps its separate regular-pool prize and pass credit', () => {
  const key = `0x${'da'.repeat(32)}`, wei = 10n ** 18n;
  const event = (name, args) => ({ parsed: { name, args } });
  const logs = [
    event('CrapsBonusOpened', {battleKey:key,slot:337n,seed:0n,bankroll:300n*wei,goal:1500n*wei,boardStake:105n*wei,battleStake:200n*wei}),
    event('CrapsBattlePaid', {battleKey:key,betId:1n,player:PLAYER,amount:900n*wei}),
    event('CrapsHottestShooterPaid', {battleKey:key,betId:1n,player:PLAYER,rolls:37n,amount:80n*wei}),
    event('CrapsProtocolAwardSplit', {battleKey:key,player:PLAYER,source:5n,grossProtocol:80n*wei,liquidFlip:60n*wei}),
  ];
  const snapshot = craps.crapsLobbySnapshotFromLogs(42, logs, { player:PLAYER });
  const result = snapshot.results[0];
  assert.equal(result.amountWei, 900n*wei);
  assert.equal(result.hottestPaidWei, 80n*wei);
  assert.equal(result.hottestResult.rolls, 37);
  assert.equal(result.hottestResult.passValueWei, String(20n*wei));
  assert.equal(result.winnerPassWei, 20n*wei);
});

test('the chain window asks for every lobby event the deployed contract emits', async () => {
  // A timed-out events route must leave the lobby a working fallback: every name in the window
  // resolves to a topic on the deployed interface, and nothing retired is requested.
  const provider = await useWindowTransport();
  craps.__setCrapsEventsFetcherForTest(async () => { throw new Error('API request timed out'); });
  await craps.readCrapsBonusSchedule(WINDOW_DAY);
  assert.equal(provider.calls.length, 1, 'a dead API must fall back to the chain');
  const topics = provider.calls[0].topics[0];
  assert.equal(topics.length, 18);
  assert.ok(topics.every((hash) => /^0x[0-9a-f]{64}$/.test(hash)));
  const iface = windowInterface();
  for (const name of ['CrapsSlipPlaced', 'JackpotBattleStarted', 'CrapsProtocolAwardSplit']) {
    assert.ok(topics.includes(iface.getEvent(name).topicHash), name);
  }
  assert.ok(!topics.includes(contracts.ethers.id('CrapsProgressiveRolled(bytes32,uint8,uint256,uint256)')));
});
