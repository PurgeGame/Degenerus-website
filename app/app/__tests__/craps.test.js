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
    resolveBets: [],
    'static:resolveBets': [],
  };
  const contract = {
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
    'resolveHandsAt', 'resolveSlipAt',
  ]) assert.ok(iface.getFunction(method), method);
  for (const event of ['CrapsBetPlaced', 'CrapsSlipPlaced', 'CrapsBetSettled', 'CrapsRakeback']) {
    assert.ok(iface.getEvent(event), event);
  }
  assert.deepEqual(
    iface.getFunction('stakeFor').inputs[0].components.map((component) => component.name),
    ['passLine', 'dontPassLine', 'place4', 'place5', 'place6', 'place8', 'place9', 'place10', 'hard4', 'hard8', 'passOddsMult'],
  );
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
});
