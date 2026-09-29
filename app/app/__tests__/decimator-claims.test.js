import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { decimatorEntryKey } from '../../chain/games.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';

// Audit 3c79c1486: the burn record is the player's ENTRY in its (level, bucket, subbucket) list,
// decEntry[_decEntryKey(lvl, denom, sub, position)], named by decPointer[player] while that level
// is the player's latest window. A settled entry is deleted; since audit ab95963ac the mineFlip walk
// is the only settlement path, and it idles once the game is over.
const ENTRY = { lvl: 25, bucket: 5, subBucket: 0, position: 2 };
const WEIGHT_MILLI = 10n; // 0.01 FLIP of weight = 1e16 wei

async function winner({ over = false, claimed = false, cash = 5n, rewards = 6n } = {}) {
  const f = await rpcFixture();
  await f.field('GAME', 'gameOver', over ? 1 : 0);
  for (const [member, value] of Object.entries(ENTRY)) await f.field('GAME', 'decPointer', value, PLAYER, member);
  const key = decimatorEntryKey(ENTRY.lvl, ENTRY.bucket, ENTRY.subBucket, ENTRY.position);
  if (!claimed) {
    await f.field('GAME', 'decEntry', BigInt(PLAYER), key, 'owner');
    await f.field('GAME', 'decEntry', WEIGHT_MILLI, key, 'weightMilli');
  }
  await f.field('GAME', 'decClaimRounds', 11n, 25, 'poolWei');
  await f.field('GAME', 'decClaimRounds', WEIGHT_MILLI * 10n ** 15n, 25, 'totalBurn');
  await f.event('GAME', 'DecBurnRecorded', {
    player: PLAYER, lvl: 25, bucket: ENTRY.bucket, subBucket: ENTRY.subBucket, position: ENTRY.position,
    effectiveAmount: WEIGHT_MILLI * 10n ** 15n, newTotalBurn: WEIGHT_MILLI * 10n ** 15n,
  }, { block: 9000 });
  if (claimed) await f.event('GAME', 'DecimatorClaimed', {
    player: PLAYER, lvl: 25, amountWei: 11n, ethPortion: cash, lootboxPortion: rewards,
  });
  return readChainRoute(`/player/${PLAYER}/decimator?level=25`, { client: f.client });
}

test('an unpaid win carries the walk\'s 50/50 split; there is no terminal all-ETH claim', async () => {
  const live = await winner();
  assert.equal(live.ethAmount, '5'); assert.equal(live.lootboxAmount, '6');
  assert.equal(live.cashOnly, false);
  assert.equal(live.position, ENTRY.position, 'its place in the walk order');
  assert.equal(live.bucket, ENTRY.bucket);
  assert.equal(live.claimed, false);
  // No terminal all-ETH claim exists any more (audit ab95963ac removed claimDecimatorJackpot).
  const ended = await winner({ over: true });
  assert.equal(ended.ethAmount, '5'); assert.equal(ended.lootboxAmount, '6');
  assert.equal(ended.cashOnly, false);
  assert.equal(ended.claimed, false);
});

test('paid wins preserve their emitted split after gameOver', async () => {
  const old = await winner({ over: true, claimed: true });
  assert.equal(old.claimed, true, 'an emptied winning entry is settled');
  assert.equal(old.ethAmount, '5'); assert.equal(old.lootboxAmount, '6');
  assert.equal(old.cashOnly, false);
  assert.equal(old.effectiveAmount, String(WEIGHT_MILLI * 10n ** 15n),
    'a settled entry keeps its weight from the burn record');
  const ended = await winner({ over: true, claimed: true, cash: 11n, rewards: 0n });
  assert.equal(ended.ethAmount, '11'); assert.equal(ended.cashOnly, true);
});

test('an older round is located by its entry events once the pointer has moved on', async () => {
  const f = await rpcFixture();
  // The player has since burned in the level-35 window, so the pointer names 35.
  for (const [member, value] of Object.entries({ lvl: 35, bucket: 4, subBucket: 3, position: 0 })) {
    await f.field('GAME', 'decPointer', value, PLAYER, member);
  }
  // Level 25: recorded at (5, 0, 2), then migrated to the better bucket 4 at (4, 1, 7).
  await f.event('GAME', 'DecBurnRecorded', { player: PLAYER, lvl: 25, bucket: 5, subBucket: 0, position: 2,
    effectiveAmount: 10n ** 16n, newTotalBurn: 10n ** 16n }, { block: 8000, index: 0 });
  await f.event('GAME', 'DecBurnMigrated', { player: PLAYER, lvl: 25, fromBucket: 5, fromSubBucket: 0,
    toBucket: 4, toSubBucket: 1, toPosition: 7, movedBurn: 10n ** 16n }, { block: 8001, index: 0 });
  const key = decimatorEntryKey(25, 4, 1, 7);
  await f.field('GAME', 'decEntry', BigInt(PLAYER), key, 'owner');
  await f.field('GAME', 'decEntry', 10n, key, 'weightMilli');
  await f.field('GAME', 'decClaimRounds', 40n, 25, 'poolWei');
  await f.field('GAME', 'decClaimRounds', 4n * 10n ** 16n, 25, 'totalBurn');
  await f.field('GAME', 'decBucketOffsetPacked', 1n << 8n, 25); // bucket 4 wins subbucket 1
  const row = await readChainRoute(`/player/${PLAYER}/decimator?level=25`, { client: f.client });
  assert.deepEqual([row.bucket, row.subbucket, row.position, row.winningSubbucket], [4, 1, 7, 1]);
  assert.equal(BigInt(row.ethAmount) + BigInt(row.lootboxAmount), 10n, 'pool x weight / total');
  const rounds = await readChainRoute(`/game/decimator/player/${PLAYER}`, { client: f.client });
  assert.deepEqual(rounds.rounds.map((r) => [r.level, r.position, r.isWinner]), [[25, 7, true]]);
});
