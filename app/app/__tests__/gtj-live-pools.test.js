import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcFixture } from './helpers/chain-rpc.js';
import { gameState } from '../../chain/state.js';
import { _testing } from '../polling.js';
import { get, update, __resetForTest } from '../store.js';

test('regular chain snapshots keep gameplay pools current without refreshing the GTJ headline', async () => {
  const f = await rpcFixture();
  await f.field('GAME', 'purchaseStartDay', 160);
  await f.field('GAME', 'dailyIdx', 167);
  await f.field('GAME', 'level', 40);
  await f.field('GAME', 'lastPurchaseDay', 1);
  await f.field('GAME', 'rngLockedFlag', 1);
  f.answer('GAME', 'currentDayView', [168]);
  f.answer('GAME', 'rngWordForDay', [123]);
  f.answer('GAME', 'currentPrizePoolView', [100]);
  f.answer('GAME', 'nextPrizePoolView', [200]);
  f.answer('GAME', 'futurePrizePoolView', [300]);
  __resetForTest();
  const headline = { headlineWei: '999', atBlock: 9000 };
  update('app.goldRush', headline);

  const state = await gameState(f.s);
  assert.equal(state.phaseCurrentDay, 168);
  assert.equal(_testing.resolvedDayFromGameState(state), 167,
    'the phase clock must not replace the last resolved jackpot day');
  assert.equal(BigInt(state.phaseSlot0), await f.s.word('GAME', 0));
  _testing.publishGameState(state);

  const pools = get('app.livePools');
  assert.equal(pools.blockNumber, f.s.block.number);
  assert.equal(pools.phaseClock.level, 40);
  assert.equal(pools.phaseClock.purchaseDay, 9);
  assert.equal(pools.phaseClock.lastPurchaseDay, true);
  assert.equal(pools.phaseClock.rngLocked, true);
  assert.deepEqual(pools.components, { currentWei: '100', nextWei: '200', futureWei: '300' });
  assert.equal(get('app.goldRush'), headline, 'cosmetic amount waits for its minute sample');
});
