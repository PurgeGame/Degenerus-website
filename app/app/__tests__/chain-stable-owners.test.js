import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';
import { bingoProof } from '../../chain/positions.js';

async function seedRetainedLevel(f, level) {
  await f.field('GAME', 'ticketBufferLevels', BigInt(level) | (BigInt(level + 1) << 24n));
}

function answerProof(f, expectedId, expectedLevel) {
  let calls = 0;
  f.answer('GAME_LENS', 'findTraitEntry', ([game, level, trait, indices]) => {
    assert.equal(game.toLowerCase(), f.contracts.GAME.toLowerCase());
    assert.equal(level, BigInt(expectedLevel));
    assert.deepEqual(Array.from(indices), [BigInt(expectedId)]);
    assert.equal(trait, BigInt(calls * 8));
    return [true, calls++, 8, 8];
  });
  return () => calls;
}

test('permanent Bingo owner is the wallet ID itself, without a registration-history scan', async () => {
  const f = await rpcFixture();
  const id = 3_000_000_001;
  await seedRetainedLevel(f, 302);
  await f.wallet(id, PLAYER);
  const calls = answerProof(f, id, 302);
  assert.deepEqual(await bingoProof(PLAYER, 302, 0, { client: f.client }), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(calls(), 8);
  assert.equal(f.requests.filter(row => row.method === 'eth_getLogs').length, 0);
});

test('unregistered wallet cannot fabricate a Bingo proof', async () => {
  const f = await rpcFixture();
  await seedRetainedLevel(f, 2);
  f.answer('GAME_LENS', 'findTraitEntry', () => assert.fail('unregistered wallet must not scan traits'));
  await assert.rejects(bingoProof(PLAYER, 2, 0, { client: f.client }), error => error.code === 'INCOMPLETE_HISTORY');
});
