import test from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';

test('day-summary Craps total includes all exact-day payouts, late Main Events, and sole riders once', async () => {
  const f = await rpcFixture({ head: 4000, timestamp: 48000, period: 1000 });
  const bet = slot => BigInt(slot) << 64n | 1n;
  const key = slot => '0x' + BigInt(slot).toString(16).padStart(64, '0');
  const pay = (name, slot, amount, extra = {}) => f.event('CRAPS', name, {
    betId: bet(slot), battleKey: key(slot), player: PLAYER,
    // Only paid is a real credit; won can precede the payout's rounding.
    won: 99999n, paid: amount, amount, ...extra,
  }, { block: 3800 }); // settlement after the nominal end of day 42
  await pay('CrapsBetSettled', 337, 100);
  await pay('CrapsBattlePaid', 337, 200);
  await pay('CrapsHighRollerPaid', 337, 300, { bankrollRider: false });
  await pay('CrapsProgressivePaid', 337, 400);
  await pay('CrapsHighRollerPaid', 338, 700, { bankrollRider: true });
  await pay('CrapsBetSettled', 338, 900);
  // An awarded Main Event seat uses the day's jackpot slot, just like a paid
  // seat, and belongs in the day's results even without a bonus-arm event.
  await pay('CrapsBetSettled', 342, 1000);
  await pay('CrapsBattlePaid', 342, 2000);
  // Whole-day seats reuse their bet ID across windows; each paid run counts.
  await pay('CrapsBetSettled', 336, 100);
  await pay('CrapsBetSettled', 336, 300);
  await pay('CrapsBetSettled', 336, 0);
  await pay('CrapsBattlePaid', 334, 777); // previous day, settled late
  await pay('CrapsBattlePaid', 345, 777); // next day
  await pay('CrapsBattlePaid', 1n << 40n, 777); // unrelated custom field
  await pay('CrapsBattlePaid', 337, 777, { player: OTHER_PLAYER });

  const data = await readChainRoute(`/viewer/player/${PLAYER}/day/42/craps`, { client: f.client });
  assert.equal(data.day, 42);
  assert.equal(data.address, PLAYER);
  assert.equal(data.totalWinnings, '5300');
  assert.equal(data.payoutCount, 9, 'counts payments without claiming each is a separate winning battle');
});
