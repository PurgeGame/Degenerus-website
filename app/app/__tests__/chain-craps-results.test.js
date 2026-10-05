import test from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { crapsWinnerTotalsFromPayload, crapsLobbySnapshotWithWinnerTotals } from '../craps.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';
import { useSchema, RUN56_SCHEMA_HASH } from '../../chain/schema.js';
import { crapsStoredWinnerPeak } from '../../chain/craps-results.js';
// FLIP/WWXRP fixtures in this file are 18-decimal (audits up to 95d88f68b, frozen schema d0e3665a).
// Pin that schema so the suite reads the same under any deployment profile; whole-token units
// (audit eb04b2e80 on) are pinned by whole-token-units.test.js.
import { useSchema as pinTestSchema, BEFORE_WHOLE_TOKENS_SCHEMA_HASH } from '../../chain/schema.js';
pinTestSchema(BEFORE_WHOLE_TOKENS_SCHEMA_HASH);

const keyOf = slot => '0x' + slot.toString(16).padStart(64, '0');
const betOf = (slot, seat = 1n) => (slot << 64n) | seat;
const read = f => readChainRoute('/game/craps/lobby/42/results', { client: f.client });
const fixture = () => rpcFixture({ head: 4000, timestamp: 48000, period: 1000 });
const packedScore = (peak, goal = false) => (goal ? 1n << 104n : 0n)
  | ((goal ? peak : (7n << 34n) | (1n << 33n) | peak) << 60n) | (3n << 16n);

test('stored peaks decode goals and busts without confusing hand count, remainder or winner bits', () => {
  const wei = 10n ** 18n;
  for (const high of [false, true]) for (const goal of [false, true]) {
    const word = high ? 2n | (packedScore(6250n, goal) << 32n) | (9n << 137n) | (1n << 169n)
      : 2n | (2n << 32n) | (packedScore(6250n, goal) << 64n) | (9n << 169n);
    assert.deepEqual(crapsStoredWinnerPeak(word, high), { peakBankrollWei: 6250n * wei, winningStop: goal ? 1 : 0 });
  }
  assert.equal(crapsStoredWinnerPeak(2n | (1n << 32n) | (9n << 169n)), null);
});

test('winner totals carry actual main and High Roller peaks even when finalization reports zero', async () => {
  const f = await fixture(), slot = 337n, betId = betOf(slot), wei = 10n ** 18n;
  const key = await arm(f, slot, 2);
  await f.event('CRAPS', 'CrapsBonusOpened', { battleKey: key, slot, bankroll: 1000n * wei }, { block: 3500 });
  await f.field('CRAPS', '_battles', 2n | (2n << 32n) | (packedScore(6250n) << 64n) | (1n << 169n), key);
  await f.field('CRAPS', '_highField', 2n | (packedScore(3500n) << 32n) | (2n << 137n) | (1n << 169n), key);
  await settle(f, betId, 0n, 3501);
  await settle(f, betOf(slot, 2n), 0n, 3502, OTHER_PLAYER);
  await finish(f, key, betId, 5000n, 3502);
  await f.event('CRAPS', 'CrapsHighRollerPaid', { battleKey: key, betId: betOf(slot, 2n), player: OTHER_PLAYER, amount: 7000n, bankrollRider: false }, { block: 3502 });
  const data = await read(f);
  const totals = crapsWinnerTotalsFromPayload(42, data);
  assert.deepEqual(totals.map(row => [row.lane, row.peakBankrollWei, row.startingBankrollWei, row.winningStop]),
    [['main', 6250n * wei, 1000n * wei, 0], ['high', 3500n * wei, 1000n * wei, 0]]);
  const result = { battleKey: key, betId: String(betId), winner: PLAYER, winningScoreBps: 0,
    highResult: { betId: String(betOf(slot, 2n)), winner: OTHER_PLAYER } };
  const snapshot = crapsLobbySnapshotWithWinnerTotals({ results: [result], yesterdayEventResult: result }, totals);
  assert.equal(snapshot.results[0].peakBankrollWei, 6250n * wei);
  assert.equal(snapshot.results[0].highResult.peakBankrollWei, 3500n * wei);
  assert.equal(snapshot.results[0].highResult.winningStop, 0);
  assert.equal(snapshot.yesterdayEventResult.startingBankrollWei, 1000n * wei);
});
async function arm(f, slot, count, block = 3500) {
  const battleKey = keyOf(slot);
  await f.field('CRAPS', '_battles', BigInt(count) | (BigInt(count) << 32n), battleKey);
  await f.event('CRAPS', 'CrapsBonusArmed', { battleKey, slot, index: slot }, { block });
  return battleKey;
}
async function settle(f, betId, paid, block, player = PLAYER) {
  await f.event('CRAPS', 'CrapsBetSettled', { betId, player, won: paid, paid }, { block });
}
async function finish(f, battleKey, betId, amount, block, player = PLAYER) {
  await f.event('CRAPS', 'CrapsBattleFinalized', { battleKey }, { block });
  await f.event('CRAPS', 'CrapsBattlePaid', { battleKey, betId, player, amount }, { block });
}

test('Dice Run record hits stay attached to the finalizing battle through lobby enrichment', async () => {
  const f = await fixture(), slot = 337n, betId = betOf(slot);
  const battleKey = await arm(f, slot, 1);
  await settle(f, betId, 500n, 3501);
  await f.event('CRAPS', 'CrapsBattleFinalized', { battleKey, winningScoreBps: 1_500_000n }, { block: 3501 });
  await f.event('CRAPS', 'CrapsBattlePaid', { battleKey, betId, player: PLAYER, amount: 100n }, { block: 3501 });
  await f.event('COINFLIP', 'BigRecordUpdated', { kind: 4, player: PLAYER, value: 1_500_000n }, { block: 3501 });
  const otherKey = await arm(f, slot + 1n, 1);
  await settle(f, betOf(slot + 1n), 300n, 3502);
  await finish(f, otherKey, betOf(slot + 1n), 100n, 3502);
  const totals = crapsWinnerTotalsFromPayload(42, await read(f));
  assert.equal(totals.find(row => row.battleKey === battleKey).biggestDiceRunHit, true);
  assert.equal(totals.find(row => row.battleKey === otherKey).biggestDiceRunHit, false);
  const result = { battleKey, betId: String(betId), winner: PLAYER };
  const enriched = crapsLobbySnapshotWithWinnerTotals({ results: [result], yesterdayEventResult: result }, totals);
  assert.equal(enriched.results[0].biggestDiceRunHit, true);
  assert.equal(enriched.yesterdayEventResult.biggestDiceRunHit, true);
});

test('winner totals include runs settled before the final payout transaction and every paid component', async () => {
  const f = await fixture(), slot = 337n, betId = betOf(slot);
  const battleKey = await arm(f, slot, 2);
  await settle(f, betId, 18000n, 3501);
  await settle(f, betOf(slot, 2n), 0n, 3502, OTHER_PLAYER);
  await finish(f, battleKey, betId, 5000n, 3502);
  await f.event('CRAPS', 'CrapsHighRollerPaid', { battleKey, betId, player: PLAYER, amount: 7000n, bankrollRider: false }, { block: 3502 });
  await f.event('CRAPS', 'CrapsProgressivePaid', { battleKey, betId, player: PLAYER, paid: 2000n }, { block: 3502 });
  // A later window can still be midway through its walk without blanking the
  // already-complete winner above.
  await arm(f, 338n, 3, 3503);
  await settle(f, betOf(338n), 0n, 3504, OTHER_PLAYER);
  const data = await read(f);
  assert.equal(data.results.length, 2);
  for (const row of data.results) {
    assert.equal(row.runPaidWei, '18000');
    assert.equal(row.totalWonWei, '32000');
  }
  assert.equal(crapsWinnerTotalsFromPayload(42, data).length, 2, 'totals survive the frontend validation');
});

test('reused whole-day bet IDs get their own run in each window, including day-only intermediate batches', async () => {
  const f = await fixture(), daySlot = 336n, winner = betOf(daySlot);
  await f.field('CRAPS', '_dayTickets', 2n, daySlot);
  const first = await arm(f, 337n, 3), second = await arm(f, 338n, 3);
  await settle(f, betOf(337n), 0n, 3501, OTHER_PLAYER);
  await settle(f, winner, 1000n, 3502);
  await settle(f, betOf(daySlot, 2n), 0n, 3503, OTHER_PLAYER);
  await finish(f, first, winner, 300n, 3503);
  await settle(f, betOf(338n), 0n, 3510, OTHER_PLAYER);
  await settle(f, winner, 0n, 3511);
  await settle(f, betOf(daySlot, 2n), 0n, 3512, OTHER_PLAYER);
  await finish(f, second, winner, 500n, 3512);
  const data = await read(f);
  assert.deepEqual(data.results.map(r => [r.period, r.runPaidWei, r.totalWonWei]), [[0, '1000', '1300'], [1, '0', '500']]);
});

test('current and previous Main Events are discovered without a bonus-arm event', async () => {
  const f = await fixture();
  for (const [slot, block] of [[334n, 3500], [342n, 3600]]) {
    const battleKey = keyOf(slot), betId = betOf(slot);
    await f.field('CRAPS', '_battles', 1n | (1n << 32n), battleKey);
    await f.field('CRAPS', '_battles', 1n | (1n << 32n) | (packedScore(2250n) << 64n) | (1n << 169n), battleKey);
    await f.field('CRAPS', '_jackpotRounds', 1000n * 10n ** 18n, slot, 'bankroll');
    await f.event('CRAPS', 'JackpotBattleStarted', { slot, drawnEntries: 1, drawnUnits: 1, word: 123 }, { block });
    await settle(f, betId, 12000n, block + 1);
    await finish(f, battleKey, betId, 5000n, block + 1);
  }
  const data = await read(f);
  assert.deepEqual(data.results.map(r => [r.day, r.period, r.totalWonWei]), [[41, 5, '17000'], [42, 5, '17000']]);
  assert.deepEqual(data.results.map(r => [r.peakBankrollWei, r.startingBankrollWei, r.winningStop]),
    Array(2).fill(['2250000000000000000000', '1000000000000000000000', 0]));
  assert.equal(crapsWinnerTotalsFromPayload(42, data).length, 2);
});

test('a sole High Roller payout emitted before its run is included once', async () => {
  const f = await fixture(), slot = 337n, betId = betOf(slot);
  const battleKey = await arm(f, slot, 1);
  await f.event('CRAPS', 'CrapsHighRollerPaid', { battleKey, betId, player: PLAYER, amount: 4000n, bankrollRider: true }, { block: 3501 });
  await settle(f, betId, 12000n, 3501);
  await finish(f, battleKey, betId, 5000n, 3501);
  const data = await read(f);
  assert.equal(data.results.find(r => r.lane === 'high').totalWonWei, '17000');
  assert.equal(data.results.find(r => r.lane === 'high').highPaidWei, '0');
  assert.equal(crapsWinnerTotalsFromPayload(42, data).length, 2);
});

test('missing settlement history leaves an unknown total instead of reporting just the pot as exact', async () => {
  const f = await fixture(), slot = 337n, betId = betOf(slot);
  const battleKey = await arm(f, slot, 2);
  await settle(f, betId, 12000n, 3501);
  await finish(f, battleKey, betId, 5000n, 3502);
  const data = await read(f);
  assert.equal(data.results[0].runPaidWei, null);
  assert.equal(data.results[0].totalWonWei, null);
  assert.equal(data.results[0].battlePaidWei, '5000');
});

test('the older seven-window deployment still includes yesterday’s period-six Main Event', async t => {
  const previous = useSchema(RUN56_SCHEMA_HASH);
  t.after(() => useSchema(previous));
  const f = await fixture(), slot = 335n, betId = betOf(slot);
  const battleKey = await arm(f, slot, 1);
  await settle(f, betId, 12000n, 3501);
  await finish(f, battleKey, betId, 5000n, 3502);
  const data = await read(f);
  assert.deepEqual(data.results.map(r => [r.day, r.period, r.totalWonWei]), [[41, 6, '17000']]);
  assert.equal(crapsWinnerTotalsFromPayload(42, data).length, 1);
});
