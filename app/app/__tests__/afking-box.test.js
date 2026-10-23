import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';
import { afkingSpinMatches, afkingDelivery } from '../../chain/afking-box.js';


// Run 75, wallet 337: the day-20 afKing box rolled a WWXRP spin in a keeper's mineFlip
// (block 11944386). Its word is the LootboxRngApplied two blocks earlier; its AfkingDelivered
// (block 11944374) reports day 20 and a 0.20 display-ETH spend.
const WORD = 52722198312156341047218223502993239537973553433910213068764245861046977268953n;
const BET_ID = 10294806784116921939n;
const DELIVERED = (20n << 128n) | 200_000_000_000n;

test('an afKing spin is matched exactly from its seed, and only its own', () => {
  assert.equal(afkingSpinMatches({ betId: BET_ID, playerId: 337, word: WORD, day: 20 }), true);
  assert.equal(afkingSpinMatches({ betId: BET_ID, playerId: 337, word: WORD, day: 19 }), true);
  assert.equal(afkingSpinMatches({ betId: BET_ID, playerId: 338, word: WORD, day: 20 }), false);
  assert.equal(afkingSpinMatches({ betId: BET_ID, playerId: 337, word: WORD + 1n, day: 20 }), false);
  assert.deepEqual(afkingDelivery(DELIVERED), { day: 20, spendRawWei: 200_000_000_000n });
});

test('the chain leg feed files an anchorless afKing spin under index 0 with its delivery spend', async () => {
  const { readChainRoute } = await import('../../chain/router.js');
  const f = await rpcFixture();
  await f.wallet(337, PLAYER);
  await f.event('GAME', 'AfkingDelivered', { player: 337, packed: DELIVERED }, { block: 9900 });
  await f.event('GAME', 'LootboxRngApplied', { index: 0, word: WORD, requestId: 1 }, { block: 9950 });
  // The keeper's sweep: the afKing spin, then a stranger's spin that no seed explains.
  await f.event('GAME', 'BoxSpin', { playerId: 337, betId: BET_ID, packedSpins: 0, payout: 0, ethShare: 0 }, { block: 9960, tx: '0x' + 'ab'.repeat(32) });
  await f.event('GAME', 'BoxSpin', { playerId: 337, betId: BET_ID ^ 1n, packedSpins: 0, payout: 0, ethShare: 0 }, { block: 9961, tx: '0x' + 'cd'.repeat(32) });
  const feed = await readChainRoute(`/lootbox/legs?player=${PLAYER}`, { client: f.client });
  const spins = feed.items.filter(item => item.legType === 'spin');
  const afking = spins.find(item => item.transactionHash === '0x' + 'ab'.repeat(32));
  assert.equal(afking.lootboxIndex, 0, 'the afKing spin is the subscriber\'s index-0 box');
  assert.equal(afking.origin, 'afking');
  assert.equal(afking.afkingSpendRawWei, '200000000000');
  const other = spins.find(item => item.transactionHash === '0x' + 'cd'.repeat(32));
  assert.equal(other.lootboxIndex, null, 'a spin the afKing seed does not produce is not claimed');
});

test('a sweep that settles a queued order and the afKing box keeps their legs apart', async () => {
  const { openLegsFromFeed } = await import('../lootbox-legs.js');
  const tx = '0x' + 'ee'.repeat(32);
  const player = PLAYER.toLowerCase();
  const tag = String((1n << 46n) | 1n);
  const rows = [
    { player, transactionHash: tx, logIndex: 1, legType: 'spin', lootboxIndex: 0, origin: 'afking', spin: { spinType: 'wwxrp', reels: [] } },
    { player, transactionHash: tx, logIndex: 2, legType: 'opened', lootboxIndex: Number(tag), origin: 'normal', rewardData: { futureTickets: 400, flip: '0', amount: '10' } },
  ];
  const order = openLegsFromFeed(rows, { player, lootboxIndex: tag });
  assert.deepEqual(order.map(leg => leg.legType), ['opened'], 'the queued order gets only its own box');
  const afking = openLegsFromFeed(rows, { player, lootboxIndex: 0, transactionHash: tx });
  assert.ok(afking.some(leg => leg.legType === 'spin'), 'the afKing box keeps its spin');
});
