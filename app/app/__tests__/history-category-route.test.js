import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';
// FLIP/WWXRP fixtures in this file are 18-decimal (audits up to 95d88f68b, frozen schema d0e3665a).
// Pin that schema so the suite reads the same under any deployment profile; whole-token units
// (audit eb04b2e80 on) are pinned by whole-token-units.test.js.
import { useSchema as pinTestSchema, BEFORE_WHOLE_TOKENS_SCHEMA_HASH } from '../../chain/schema.js';
pinTestSchema(BEFORE_WHOLE_TOKENS_SCHEMA_HASH);

test('category facts page by cursor across token and admin events', async () => {
  const f = await rpcFixture();
  await f.event('COIN', 'DecimatorBurn', {player:PLAYER,amountBurned:10,bucket:2}, {block:9999,index:1});
  await f.event('ADMIN', 'LinkCreditRecorded', {player:PLAYER,amount:20}, {block:9999,index:2});
  const route = `/player/${PLAYER}/facts?names=DecimatorBurn,LinkCreditRecorded&limit=1`;
  const first = await readChainRoute(route, {client:f.client});
  assert.deepEqual(first.events.map(row => row.name), ['LinkCreditRecorded']);
  assert.equal(first.events[0].args.amount, '20');
  assert.ok(first.nextCursor);
  const older = await readChainRoute(`${route}&before=${first.nextCursor}`, {client:f.client});
  assert.deepEqual(older.events.map(row => row.name), ['DecimatorBurn']);
  assert.equal(older.events[0].args.amountBurned, '10');
});

test('an older deployment can report missing event types alongside available activity', async () => {
  const f = await rpcFixture();
  await f.event('PARIMUTUEL', 'BetPlaced', {player:PLAYER,round:7,over:true,questReward:0});
  const result = await readChainRoute(`/player/${PLAYER}/facts?names=BetPlaced,RetiredEvent&limit=10`, {client:f.client});
  assert.deepEqual(result.events.map(row => row.name), ['BetPlaced']);
  assert.deepEqual(result.unsupported, ['RetiredEvent']);
  const legacy = await readChainRoute(`/player/${PLAYER}/facts?names=BetPlaced&since=9999`, {client:f.client});
  assert.deepEqual(legacy.events, []);
  assert.equal(legacy.truncated, false);
});
