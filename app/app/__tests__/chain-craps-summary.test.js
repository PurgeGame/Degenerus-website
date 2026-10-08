import test from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';
// FLIP/WWXRP fixtures in this file are 18-decimal (audits up to 95d88f68b, frozen schema d0e3665a).
// Pin that schema so the suite reads the same under any deployment profile; whole-token units
// (audit eb04b2e80 on) are pinned by whole-token-units.test.js.
import { useSchema as pinTestSchema, BEFORE_WHOLE_TOKENS_SCHEMA_HASH, CURRENT_SCHEMA_HASH } from '../../chain/schema.js';
pinTestSchema(BEFORE_WHOLE_TOKENS_SCHEMA_HASH);

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

test('a jackpot battle belongs to its drawing day, including detached fields and every credited prize', async () => {
  const previous = pinTestSchema(CURRENT_SCHEMA_HASH);
  try {
    for (const suffix of [6n, 7n]) {
      const f = await rpcFixture({ head: 4000, timestamp: 48000, period: 1000 });
      await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER);
      const slot = 41n * 8n + suffix;
      const bet = n => BigInt(n) << 64n | 1n;
      const key = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
      const pay = (name, amount, extra = {}) => f.event('CRAPS', name, {
        slot, betId: bet(slot), battleKey: key(slot), playerId: 37, winnerId: 37,
        won: 999999n, paid: amount, amount, ...extra,
      }, { block: 3800 });
      await f.event('CRAPS', 'JackpotBattleLocked', { slot, requestDay: 42 }, { block: 3501 });
      await pay('CrapsBetSettled', 100);
      await pay('CrapsBattlePaid', 200);
      await pay('CrapsHighRollerPaid', 300, { bankrollRider: false });
      await pay('CrapsProgressivePaid', 400);
      await pay('HighRollerReserveDrawn', 500);
      await pay('CrapsHottestShooterPaid', 600);
      await f.event('CRAPS', 'JackpotBattleStarted', { slot }, { block: 3701 });
      // A reserved day ticket keeps slot zero in its bet ID. Its Main Event
      // run still belongs to the draw, including the last run after finalization.
      if (suffix === 6n) {
        await pay('CrapsBetSettled', 25, { betId: bet(328) });
      }
      await pay('CrapsBetSettled', 0);
      await pay('CrapsHighRollerPaid', 10000, { bankrollRider: true });
      await pay('CrapsBattlePaid', 10000, { playerId: 73 });
      await pay('HighRollerReserveDrawn', 10000, { winnerId: 73 });
      // The same-day lobby's Main Event is tomorrow's draw, not this receipt.
      await f.event('CRAPS', 'JackpotBattleLocked', { slot: 342, requestDay: 43 }, { block: 3700 });
      await pay('CrapsBattlePaid', 10000, { betId: bet(342), battleKey: key(342) });
      await pay('CrapsBattlePaid', 10000, { betId: bet(1n << 40n), battleKey: key(1n << 40n) });
      // Ordinary same-day play remains a separate part of the total.
      await pay('CrapsBetSettled', 50, { betId: bet(337) });
      const receipt = await readChainRoute(`/viewer/player/${PLAYER}/day/42/craps`, { client: f.client });
      const dayTicket = suffix === 6n ? 25n : 0n;
      assert.equal(receipt.totalWinnings, String((2150n + dayTicket) * 10n ** 18n));
      assert.equal(receipt.payoutCount, dayTicket ? 8 : 7);
      assert.deepEqual(receipt.jackpot, { totalWinnings: String((2100n + dayTicket) * 10n ** 18n), payoutCount: dayTicket ? 7 : 6 });
      const prior = await readChainRoute(`/viewer/player/${PLAYER}/day/41/craps`, { client: f.client });
      assert.equal(prior.totalWinnings, '0', 'the slot day cannot count the same jackpot winnings again');
    }
  } finally { pinTestSchema(previous); }
});

test('jackpot receipts report credited comps and net progressive FLIP without counting comp value twice', async () => {
  const previous = pinTestSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture({ head: 4000, timestamp: 48000, period: 1000 });
      await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER);
    const slot = 334n;
    const battleKey = '0x' + slot.toString(16).padStart(64, '0');
    const betId = slot << 64n | 1n;
    const emit = (name, args) => f.event('CRAPS', name, { playerId: 37, battleKey, betId, ...args }, { block: 3800 });
    await f.event('CRAPS', 'JackpotBattleLocked', { slot, requestDay: 42 }, { block: 3501 });
    await emit('CrapsPassesCredited', { highRoller: true, count: 2 });
    await emit('CrapsProtocolAwardSplit', { source: 1, grossProtocol: 10000, liquidFlip: 5000 });
    await emit('CrapsBattlePaid', { amount: 12000 }); // Already net of its comp slice.
    await emit('CrapsProgressivePaid', { paid: 50000 }); // Gross, before its comp slice.
    await emit('CrapsPassesCredited', { highRoller: false, count: 80 });
    await emit('CrapsProtocolAwardSplit', { source: 4, grossProtocol: 50000, liquidFlip: 26000 });
    await emit('CrapsPassesCredited', { highRoller: false, count: 999 }); // Unrelated award.
    await emit('CrapsPassesCredited', { playerId: 73, highRoller: true, count: 999 });
    await emit('CrapsProtocolAwardSplit', { playerId: 73, source: 1, grossProtocol: 10000, liquidFlip: 5000 });
    const receipt = await readChainRoute(`/viewer/player/${PLAYER}/day/42/craps`, { client: f.client });
    assert.equal(receipt.totalWinnings, String(38000n * 10n ** 18n));
    assert.equal(receipt.payoutCount, 2);
    assert.deepEqual(receipt.jackpot, { totalWinnings: receipt.totalWinnings, payoutCount: 2, normalPasses: 80, highPasses: 2 });
  } finally { pinTestSchema(previous); }
});
