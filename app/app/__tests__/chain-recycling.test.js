import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';
import { useSchema, loadSchema, CURRENT_SCHEMA_HASH, BEFORE_HEADER_TAIL_SCHEMA_HASH } from '../../chain/schema.js';
import { retainedTicketLevels, pendingBoxWord, lootboxWord, lootboxSession, inLootboxSession, liveLootboxWord } from '../../chain/recycling.js';
import { bingoProof, bingoCandidates } from '../../chain/positions.js';

test('recycled schema keeps retained Bingo open until actual parity reassignment', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    await f.field('GAME', 'level', 3);
    await f.field('GAME', 'ticketBufferLevels', 2n | (3n << 24n));
    assert.deepEqual(await retainedTicketLevels(f.s), [2, 3]);
    const rows = await bingoCandidates(f.s, PLAYER);
    assert.deepEqual(rows.scope, { fromLevel: 2, toLevel: 3 }, 'completed level 2 remains discoverable');
    await assert.rejects(bingoProof(PLAYER, 2, 0, { client: f.client }), error => error.code !== 'BingoExpired');
    await f.field('GAME', 'ticketBufferLevels', 4n | (3n << 24n));
    await assert.rejects(bingoProof(PLAYER, 2, 0, { client: f.client }), error => error.code === 'BingoExpired');
  } finally { useSchema(previous); }
});

test('binary storage masks processed orders and binds repeated tags by publication order', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    await f.field('GAME', 'rngFlagsAndNudges', (1n << 12n) | (1n << 15n));
    await f.field('GAME', 'humanReadComplete', false);
    await f.field('GAME', 'lootboxOrder', 77, 0, PLAYER);
    assert.equal(await pendingBoxWord(f.s, 'lootboxOrder', 0, PLAYER), 77n);
    assert.equal(await pendingBoxWord(f.s, 'lootboxOrder', 2, PLAYER), 0n, 'invalid tags never alias');
    await f.field('GAME', 'lootboxOrder', 77n | (1n << 255n), 0, PLAYER);
    assert.equal(await pendingBoxWord(f.s, 'lootboxOrder', 0, PLAYER), 0n);
    await f.event('GAME', 'LootboxRngApplied', { index: 0, word: 345, requestId: 11 }, { block: 2 });
    await f.event('GAME', 'LootboxRngApplied', { index: 0, word: 456, requestId: 13 }, { block: 5 });
    assert.equal(await lootboxWord(f.s, 0, { fromBlock: 1 }), 345n);
    assert.equal(await lootboxWord(f.s, 0, { fromBlock: 3 }), 456n, 'same tag, later session');
  } finally { useSchema(previous); }
});

test('binary raw decoder accepts only the published read payload and kills terminal consumers', () => {
  const state = (1n << 252n) | (1n << 255n);
  assert.equal(liveLootboxWord(1n << 252n, 0, 99n), 0n, 'callback alone cannot publish');
  assert.equal(liveLootboxWord(state, 0, 99n), 99n);
  assert.equal(liveLootboxWord(state, 1, 99n), 0n, 'write has no usable word');
  assert.equal(liveLootboxWord(state, 2, 99n), 0n, 'invalid tag');
  assert.equal(liveLootboxWord(state, 0, 1n), 0n, 'waiting sentinel');
  assert.equal(liveLootboxWord(state | (1n << 253n), 0, 99n), 0n);
});

test('same-block publication ordinals isolate repeated physical tags', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    await f.event('GAME', 'LootboxRngApplied', { index: 0, word: 111, requestId: 2 }, { block: 8, index: 1 });
    await f.event('GAME', 'LootboxRngApplied', { index: 0, word: 222, requestId: 4 }, { block: 8, index: 5 });
    await f.event('GAME', 'LootboxRngApplied', { index: 0, word: 333, requestId: 6 }, { block: 9, index: 1 });
    const commitment = { blockNumber: 8, logIndex: 2 };
    const session = await lootboxSession(f.s, 0, { fromBlock: 8, afterLogIndex: 2 });
    assert.equal(session.word, 222n);
    assert.equal(inLootboxSession({ blockNumber: 8, logIndex: 3 }, session, commitment), false);
    assert.equal(inLootboxSession({ blockNumber: 8, logIndex: 6 }, session, commitment), true);
    assert.equal(inLootboxSession({ blockNumber: 9, logIndex: 2 }, session, commitment), false);
  } finally { useSchema(previous); }
});

test('an old resolution does not hide a new bet reusing the same physical tag and id', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const { pendingBets } = await import('../../chain/pending.js');
    const f = await rpcFixture();
    await f.event('GAME', 'DegeneretteBetPlaced', { player: PLAYER, index: 0, betId: 1, packed: 11 }, { block: 4, index: 0 });
    await f.event('GAME', 'DegeneretteResolved', { player: PLAYER, index: 0, betId: 1 }, { block: 4, index: 1 });
    await f.event('GAME', 'DegeneretteBetPlaced', { player: PLAYER, index: 0, betId: 1, packed: 22 }, { block: 4, index: 2 });
    f.answer('GAME', 'degeneretteBetInfo', () => [22n]);
    assert.deepEqual(await pendingBets(f.s, PLAYER), [{ betId: '1', betIndex: 0, packedData: '22' }]);
  } finally { useSchema(previous); }
});


test('header-tail schemas append validity bitmaps and keep deployed stamped-header schemas intact', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const current = await loadSchema('GAME');
    const f = await rpcFixture();
    assert.equal(current.fields.traitBucketLive.slot, '76');
    await f.field('GAME', 'traitBucketLive', 1n << 255n, 0);
    await f.field('GAME', 'traitBucketLive', 1n << 7n, 1);
    assert.equal(await f.s.field('GAME', 'traitBucketLive', 0), 1n << 255n);
    assert.equal(await f.s.field('GAME', 'traitBucketLive', 1), 1n << 7n);
    useSchema(BEFORE_HEADER_TAIL_SCHEMA_HASH);
    const old = await loadSchema('GAME');
    assert.equal(old.fields.traitBucketLive, undefined);
    assert.deepEqual(old.fields.ticketBufferLevels, current.fields.ticketBufferLevels);
    assert.deepEqual(old.fields.lvlTraitEntry, current.fields.lvlTraitEntry, 'original parity mapping root retained');
  } finally { useSchema(previous); }
});
