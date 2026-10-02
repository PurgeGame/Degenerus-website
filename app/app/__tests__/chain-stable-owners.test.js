import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';
import { bingoProof } from '../../chain/positions.js';
import { useSchema, CURRENT_SCHEMA_HASH, BEFORE_STABLE_OWNERS_SCHEMA_HASH } from '../../chain/schema.js';

async function seedRetainedLevel(f, level) {
  await f.field('GAME', 'ticketBufferLevels', BigInt(level) | (BigInt(level + 1) << 24n));
}

function answerProof(f, expectedIndex, expectedLevel) {
  let calls = 0;
  f.answer('GAME_LENS', 'findTraitEntry', ([game, level, trait, indices]) => {
    assert.equal(game.toLowerCase(), f.contracts.GAME.toLowerCase());
    assert.equal(level, BigInt(expectedLevel));
    assert.deepEqual(Array.from(indices), [BigInt(expectedIndex)]);
    assert.equal(trait, BigInt(calls * 8));
    return [true, calls++, 8, 8];
  });
  return () => calls;
}

test('permanent Bingo owner is ID minus one without a registration-history scan', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    const id = 3_000_000_001;
    await seedRetainedLevel(f, 302);
    await f.field('GAME', 'ticketOwnerId', id, PLAYER);
    await f.field('GAME', 'ticketOwners', id);
    await f.field('GAME', 'ticketOwners', BigInt(PLAYER), id - 1);
    const calls = answerProof(f, id - 1, 302);
    assert.deepEqual(await bingoProof(PLAYER, 302, 0, { client: f.client }), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(calls(), 8);
    assert.equal(f.requests.filter(row => row.method === 'eth_getLogs').length, 0);
  } finally { useSchema(previous); }
});

test('unregistered permanent owner cannot fabricate a Bingo proof', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    await seedRetainedLevel(f, 2);
    f.answer('GAME_LENS', 'findTraitEntry', () => assert.fail('unregistered wallet must not scan traits'));
    await assert.rejects(bingoProof(PLAYER, 2, 0, { client: f.client }), error => error.code === 'INCOMPLETE_HISTORY');
  } finally { useSchema(previous); }
});

test('permanent Bingo discovery verifies the ID resolves back to the same wallet', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    await seedRetainedLevel(f, 2);
    await f.field('GAME', 'ticketOwnerId', 7, PLAYER);
    await f.field('GAME', 'ticketOwners', 7);
    await f.field('GAME', 'ticketOwners', BigInt(OTHER_PLAYER), 6);
    await assert.rejects(bingoProof(PLAYER, 2, 0, { client: f.client }), /Ticket owner mismatch/);
  } finally { useSchema(previous); }
});

test('historical per-level Bingo still discovers owners through its pinned events', async () => {
  const previous = useSchema(BEFORE_STABLE_OWNERS_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    await seedRetainedLevel(f, 2);
    await f.event('GAME', 'EntryOwnerRegistered', { lvl: 2, idx: 17, owner: PLAYER });
    const calls = answerProof(f, 17, 2);
    assert.deepEqual(await bingoProof(PLAYER, 2, 0, { client: f.client }), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(calls(), 8);
    assert.ok(f.requests.some(row => row.method === 'eth_getLogs'));
  } finally { useSchema(previous); }
});
