import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// The run #55 fixture is a real Base Sepolia chain feed in the PRE-224de529
// wire format (per-player nonce, old packed layout, one DegeneretteResult row
// per spin). Re-express that exact bet in the audit 224de529 format — queued
// bet word + one DegeneretteResolved carrying `spins` — to prove the new
// decoding reproduces the same verified reels and the same per-spin payouts
// the old events carried.
async function run55BetInNewFormat() {
  const { dgnHouseTraits, dgnGoldMatches } = await import('../dgn-reels.js');
  const { degeneretteStakeUnit } = await import('../degenerette.js');
  const bet = JSON.parse(readFileSync(new URL('./fixtures/degenerette-run55-bet1.json', import.meta.url)));
  const old = BigInt(bet.packedData);
  const symbol = Number(old & 0x1Fn);
  const spinCount = Number((old >> 32n) & 0xFFn);
  const currency = Number((old >> 40n) & 0x3n);
  const amountPerSpin = (old >> 42n) & ((1n << 128n) - 1n);
  const activity = (old >> 202n) & 0xFFFFn;
  const record = ((old >> 220n) & ((1n << 36n) - 1n)) !== 0n;
  const stakeUnits = amountPerSpin / degeneretteStakeUnit(currency);
  assert.equal(stakeUnits * degeneretteStakeUnit(currency), amountPerSpin, 'the run #55 stake is a whole unit');
  const packed = BigInt(bet.player) | (BigInt(symbol) << 160n) | (BigInt(spinCount) << 165n)
    | (BigInt(currency) << 170n) | ((record ? 1n : 0n) << 171n) | (activity << 172n) | (stakeUnits << 188n);
  const rows = bet.results.filter((row) => row.resultType === 'result')
    .sort((a, b) => Number(a.resultData.spinIndex) - Number(b.resultData.spinIndex));
  const spins = '0x' + rows.map((row) => {
    const traits = Number(row.resultData.playerTraits) >>> 0;
    const house = dgnHouseTraits({ rngWord: bet.rngWord, index: bet.betIndex,
      spinIdx: Number(row.resultData.spinIndex), currency, playerTraits: traits, heroQuadrant: symbol >> 3 });
    const tail = Number(row.resultData.matches) | (dgnGoldMatches(traits, house) << 4);
    return traits.toString(16).padStart(8, '0') + tail.toString(16).padStart(2, '0');
  }).join('');
  const resolved = bet.results.find((row) => row.resultType === 'resolved');
  return {
    old: bet,
    oldRows: rows,
    item: {
      ...bet,
      packedData: String(packed),
      results: [{
        ...resolved,
        resultData: {
          player: bet.player, index: String(bet.betIndex), betId: bet.betId,
          totalPayout: resolved.resultData.totalPayout, resultTraits: resolved.resultData.resultTraits, spins,
        },
      }],
    },
  };
}

test('the reported five-card bet opens a complete replay from its audit 224de529 chain feed', async () => {
  const { degeneretteRevealSequenceFromFeedItem, dgnDecodePacked } = await import('../degenerette-replay.js');
  const { item, oldRows } = await run55BetInNewFormat();
  assert.equal(dgnDecodePacked(item.packedData).owner, item.player);
  const sequence = degeneretteRevealSequenceFromFeedItem(item);
  assert.ok(sequence, 'a settled bet must produce a reveal');
  assert.equal(sequence.spins.length, 5);
  assert.ok(sequence.spins.every((row) => row.houseTraits != null), 'every reel re-derives and verifies');
  assert.equal(sequence.betId, '1');
  assert.equal(sequence.betIndex, String(item.betIndex));
  assert.equal(sequence.headline, `BET #${item.betIndex}-1`, 'betIds restart per index, so the index names the bet');
  // Per-spin payouts are no longer emitted; the module's math over score,
  // matched gold, stake and activity reproduces what DegeneretteResult carried.
  assert.deepEqual(sequence.spins.map((row) => String(row.payout)),
    oldRows.map((row) => String(row.resultData.payout)));
  assert.equal(sequence.recordBountySpins.length, 1);
  assert.deepEqual(sequence.recordBountySpins[0].reels.map(r => r.heroQuadrant), [0, 0, 0]);
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
