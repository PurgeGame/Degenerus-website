import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_FILTERS, historyEventActivities, historyEventNames } from '../history-activity.js';
import { eventCatalog } from '../../chain/facts.js';
import { walletFieldPairs } from '../../chain/wallet-events.js';
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
      // A player-keyed event names its player by an indexed address or by a wallet-ID field.
      for (const row of events) {
        const keyed = row.event.inputs.some(input => input.type === 'address' && input.indexed)
          || (await walletFieldPairs(row.contract, name)).length > 0;
        assert.ok(keyed, name);
      }
    }
  }
});
test('funding, purchases, growth and redemptions use exact signed amounts', () => {
  const rows = historyEventActivities([
    event('EntriesBought', { buyer: player, weiIn: '45', entryQuantityScaled: '500' }),
    event('BetPlaced', { player, round: 4, over: true, questReward: '999' }, 1),
    event('RedemptionSubmitted', { player, sdgnrsAmount: '8', batchId: 2 }, 2),
    event('RedemptionClaimed', { player, ethPayout: '20', lootboxEth: '30', flipPaid: '40' }, 3),
    event('MiddayRngCredited', { donor: player, added: '50' }, 4),
  ], player);
  assert.deepEqual(rows[0].deltas.map(d => d.value), [-45n, 1.25]);
  assert.deepEqual(rows[1].deltas.map(d => d.value), [-1000n * unit], 'quest reward belongs to its own event');
  assert.equal(rows[1].category, 'growth');
  assert.match(rows[1].detail, /OVER/);
  assert.deepEqual(rows[2].deltas.map(d => d.value), [-8n]);
  assert.match(rows[2].detail, /Redemption batch 2/);
  assert.deepEqual(rows[3].deltas.map(d => d.value), [20n, 40n, 30n]);
  assert.deepEqual(rows[4].deltas, [{ asset: 'LINK', kind: 'token', value: -50n }]);
});
test('an AFKing order paid from the payee\'s stETH is a signed stETH debit', () => {
  const rows = historyEventActivities([
    event('AfkingStethFunded', { subscriber: player, shortfall: '99', received: '100' }),
    event('AfkingStethFunded', { subscriber: other, shortfall: '5', received: '5' }, 1),
  ], player);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, 'funds');
  assert.deepEqual(rows[0].deltas, [{ asset: 'STETH', kind: 'eth', value: -100n }]);
});
test('operator/counterparty logs never appear as the viewed player\'s activity', () => {
  const rows = historyEventActivities([
    event('WhalePassClaimed', { player: other, caller: player, halfPasses: 2 }),
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
