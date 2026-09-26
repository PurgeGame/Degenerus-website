import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';

async function winner({ over = false, claimed = false, cash = 5n, rewards = 6n } = {}) {
  const f = await rpcFixture();
  await f.field('GAME', 'gameOver', over ? 1 : 0);
  await f.field('GAME', 'decBurn', 10n, 25, PLAYER, 'burn');
  await f.field('GAME', 'decBurn', 5n, 25, PLAYER, 'bucket');
  await f.field('GAME', 'decBurn', claimed ? 1n : 0n, 25, PLAYER, 'claimed');
  await f.field('GAME', 'decClaimRounds', 11n, 25, 'poolWei');
  await f.field('GAME', 'decClaimRounds', 10n, 25, 'totalBurn');
  if (claimed) await f.event('GAME', 'DecimatorClaimed', {
    player: PLAYER, lvl: 25, amountWei: 11n, ethPortion: cash, lootboxPortion: rewards,
  });
  return readChainRoute(`/player/${PLAYER}/decimator?level=25`, { client: f.client });
}

test('unclaimed regular rounds become all-ETH only after gameOver', async () => {
  const live = await winner();
  assert.equal(live.ethAmount, '5'); assert.equal(live.lootboxAmount, '6');
  assert.equal(live.cashOnly, false);
  const ended = await winner({ over: true });
  assert.equal(ended.ethAmount, '11'); assert.equal(ended.lootboxAmount, '0');
  assert.equal(ended.cashOnly, true);
});

test('historical claims preserve their emitted split after gameOver', async () => {
  const old = await winner({ over: true, claimed: true });
  assert.equal(old.ethAmount, '5'); assert.equal(old.lootboxAmount, '6');
  assert.equal(old.cashOnly, false);
  const ended = await winner({ over: true, claimed: true, cash: 11n, rewards: 0n });
  assert.equal(ended.ethAmount, '11'); assert.equal(ended.cashOnly, true);
});
