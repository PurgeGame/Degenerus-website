import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';

test('category facts page by cursor across token and admin events', async () => {
  const f = await rpcFixture(); await f.wallet(37, PLAYER);
  await f.event('COIN', 'DecimatorBurn', {player:37,amountBurned:10,entryId:2}, {block:9999,index:1});
  await f.event('ADMIN', 'LinkCreditRecorded', {player:37,amount:20}, {block:9999,index:2});
  const route = `/player/${PLAYER}/facts?names=DecimatorBurn,LinkCreditRecorded&limit=1`;
  const first = await readChainRoute(route, {client:f.client});
  assert.deepEqual(first.events.map(row => row.name), ['LinkCreditRecorded']);
  assert.equal(first.events[0].args.amount, String(20n * 10n ** 18n));
  assert.ok(first.nextCursor);
  const older = await readChainRoute(`${route}&before=${first.nextCursor}`, {client:f.client});
  assert.deepEqual(older.events.map(row => row.name), ['DecimatorBurn']);
  assert.equal(older.events[0].args.amountBurned, String(10n * 10n ** 18n), 'whole-FLIP chain amounts arrive as token wei');
});

test('a route can report unknown event types alongside available activity', async () => {
  const f = await rpcFixture(); await f.wallet(37, PLAYER);
  await f.event('PARIMUTUEL', 'BetPlaced', {id:37,round:7,over:true,questReward:0});
  const result = await readChainRoute(`/player/${PLAYER}/facts?names=BetPlaced,RetiredEvent&limit=10`, {client:f.client});
  assert.deepEqual(result.events.map(row => row.name), ['BetPlaced']);
  assert.deepEqual(result.unsupported, ['RetiredEvent']);
  const later = await readChainRoute(`/player/${PLAYER}/facts?names=BetPlaced&since=9999`, {client:f.client});
  assert.deepEqual(later.events, []);
  assert.equal(later.truncated, false);
});
