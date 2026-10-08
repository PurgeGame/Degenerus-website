import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureBetFeedItem } from './helpers/degenerette-fixture-bet.js';

test('each history replay links the reward spot to a fresh luckbox presentation', async () => {
  const { degeneretteReplaySequences } = await import('../degenerette-replay.js');
  const original = { kind: 'degenerette', lootboxLegs: [{ legType: 'dgnrs', amount: 7n }] };
  const first = degeneretteReplaySequences(original);
  const second = degeneretteReplaySequences(original);
  assert.equal(first[0].lootboxPresentationId, first[1].presentationId);
  assert.notEqual(first[1].presentationId, second[1].presentationId);
  assert.equal(original.lootboxPresentationId, undefined, 'the saved history row stays unchanged');
});

test('settled replay helpers import without a DOM or interactive panel registration', async () => {
  assert.equal(typeof globalThis.HTMLElement, 'undefined');
  const replay = await import('../degenerette-replay.js');
  // Audit 224de529 queued word: spinCount lives at bits 165..169.
  assert.equal(replay.dgnDecodePacked((3n << 165n).toString()).spinCount, 3);
  assert.deepEqual(replay.degeneretteReplaySequences({ kind: 'degenerette' }), [{ kind: 'degenerette' }]);
  assert.equal(typeof globalThis.customElements, 'undefined');
  for (const name of ['app-day-history-replays', 'app-transaction-history']) {
    const source = readFileSync(new URL(`../../components/${name}.js`, import.meta.url), 'utf8');
    assert.match(source, /from '\.\.\/app\/degenerette-replay\.js'/);
    assert.doesNotMatch(source, /from '\.\/app-degenerette-panel\.js'/,
      'history must not import the wager panel as a helper dependency');
  }
});

test('a five-card bet opens a complete replay from its DegeneretteResolved wire format', async () => {
  const { degeneretteRevealSequenceFromFeedItem, dgnDecodePacked } = await import('../degenerette-replay.js');
  const { ETH_DIVISOR } = await import('../chain-config.js');
  const { vector, item } = await fixtureBetFeedItem(5);
  assert.equal(dgnDecodePacked(item.packedData).owner, item.player);
  const sequence = degeneretteRevealSequenceFromFeedItem(item);
  assert.ok(sequence, 'a settled bet must produce a reveal');
  assert.equal(sequence.spins.length, 5);
  assert.ok(sequence.spins.every((row) => row.houseTraits != null), 'every reel re-derives and verifies');
  assert.equal(sequence.betId, '1');
  assert.equal(sequence.betIndex, String(item.betIndex));
  assert.equal(sequence.headline, `BET #${item.betIndex}-1`, 'betIds restart per index, so the index names the bet');
  assert.equal(sequence.heroIdx, vector.symbol >> 3);
  // Spin 0 is the shared vector: its reel, score and payout.
  const [zero] = sequence.spins;
  assert.equal(zero.houseTraits, Number(BigInt(vector.house)));
  assert.equal(zero.score, vector.score);
  const expected = BigInt(vector.eth_payout_wei);
  const gap = expected - zero.payout * BigInt(ETH_DIVISOR);
  assert.ok(gap >= 0n && gap < BigInt(ETH_DIVISOR), 'the spin pays the vector payout at the chain wei scale');
  assert.ok(zero.payout > 0n);
  assert.equal(sequence.recordBountySpins.length, 0);
});

test('a house reel that disagrees with the emitted wild count fails closed', async () => {
  const { degeneretteRevealSequenceFromFeedItem } = await import('../degenerette-replay.js');
  const { item } = await fixtureBetFeedItem(2);
  const resolved = item.results[0].resultData;
  // Corrupt spin 1's wild count (the tail byte's bits 4-6).
  const hex = resolved.spins.slice(2);
  const tail = parseInt(hex.slice(18, 20), 16) ^ 0x10;
  resolved.spins = `0x${hex.slice(0, 18)}${tail.toString(16).padStart(2, '0')}`;
  assert.equal(degeneretteRevealSequenceFromFeedItem(item), null,
    'an unverifiable later reel never plays a partial round');
});

test('feed fragments merge per (player, index, betId), never across indices', async () => {
  const { mergeDegeneretteFeedItems } = await import('../degenerette-replay.js');
  const player = '0xab12000000000000000000000000000000000000';
  const merged = mergeDegeneretteFeedItems([
    { player, betIndex: 7, betId: '1', results: [{ resultType: 'resolved', resultData: {} }] },
    { player, betIndex: 8, betId: '1', results: [] },
    { player: player.toUpperCase().replace('0X', '0x'), betIndex: 7, betId: '1', packedData: '5' },
  ]);
  assert.equal(merged.length, 2, 'bet 1 at index 7 and bet 1 at index 8 are different bets');
  const seven = merged.find((item) => item.betIndex === 7);
  assert.equal(seven.packedData, '5');
  assert.equal(seven.results.length, 1);
});
