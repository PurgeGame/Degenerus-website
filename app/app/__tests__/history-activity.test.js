import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_FILTERS, historyEventActivities, historyEventNames } from '../history-activity.js';
import { eventCatalog } from '../../chain/facts.js';
const player = `0x${'1'.repeat(40)}`;
const other = `0x${'2'.repeat(40)}`;
const unit = 10n ** 18n;
const event = (name, args, logIndex = 0) => ({ name, args, logIndex, blockNumber: 123, transactionHash: `0x${'a'.repeat(64)}` });
test('every additional category reads known events with a player topic', async () => {
  const catalog = await eventCatalog();
  for (const [key] of HISTORY_FILTERS) {
    for (const name of historyEventNames(key)) {
      const events = catalog.filter(row => row.event.name === name);
      assert.ok(events.length, `${key}: ${name}`);
      assert.ok(events.every(row => row.event.inputs.some(input => input.type === 'address' && input.indexed)), name);
    }
  }
});
test('funding, purchases, growth and redemptions use exact signed amounts', () => {
  const rows = historyEventActivities([
    event('EntriesBought', { buyer: player, weiIn: '45', entryQuantityScaled: '500' }),
    event('BetPlaced', { player, round: 4, over: true, questReward: '999' }, 1),
    event('BetClaimed', { player, round: 4, payout: String(2000n * unit) }, 2),
    event('RedemptionSubmitted', { player, sdgnrsAmount: '8', ethValueOwed: '99', flipEscrowed: '11', periodIndex: 2 }, 3),
    event('RedemptionClaimed', { player, ethPayout: '20', lootboxEth: '30', flipPaid: '40' }, 4),
    event('MiddayRngCredited', { donor: player, added: '50' }, 5),
  ], player);
  assert.deepEqual(rows[0].deltas.map(d => d.value), [-45n, 1.25]);
  assert.deepEqual(rows[1].deltas.map(d => d.value), [-1000n * unit], 'quest reward belongs to its own event');
  assert.equal(rows[1].category, 'growth');
  assert.match(rows[1].detail, /OVER/);
  assert.equal(rows[2].deltas[0].value, 2000n * unit);
  assert.deepEqual(rows[3].deltas.map(d => d.value), [-8n], 'owed and escrow values are not proceeds');
  assert.deepEqual(rows[4].deltas.map(d => d.value), [20n, 40n, 30n]);
  assert.deepEqual(rows[5].deltas, [{ asset: 'LINK', kind: 'token', value: -50n }]);
});
test('operator/counterparty logs never appear as the viewed player\'s activity', () => {
  const rows = historyEventActivities([
    event('WhalePassClaimed', { player: other, caller: player, halfPasses: 2 }),
    event('FarFutureSwap', { player: other, buyer: player, ethCashWei: '100' }),
    event('DrawClaimed', { winner: other, caller: player, prize: '100' }),
  ], player);
  assert.deepEqual(rows, []);
});
test('Craps rider rewards already in the slip payout are not counted twice', () => {
  const rows = historyEventActivities([
    event('CrapsBetSettled', { player, betId: 1, won: '1000', paid: '35' }),
    event('CrapsHighRollerPaid', { player, betId: 1, amount: '10', bankrollRider: true }, 1),
    event('CrapsHighRollerPaid', { player, betId: 2, amount: '15', bankrollRider: false }, 2),
  ], player);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((total, row) => total + row.deltas[0].value, 0n), 50n);
});
test('coinflip snapshots and stake movements are not fictional wallet payments', () => {
  const rows = historyEventActivities([
    event('CoinflipStakeUpdated', { player, day: 7, amount: String(10n * unit), newTotal: String(50n * unit) }),
    event('CoinflipClaimState', { player, claimableStored: String(50n * unit), autoRebuyCarry: String(5n * unit) }, 1),
  ], player);
  assert.deepEqual(rows.map(row => row.deltas), [[], []]);
  assert.match(rows[0].detail, /10 FLIP added/);
  assert.match(rows[1].detail, /50 FLIP claimable/);
});
