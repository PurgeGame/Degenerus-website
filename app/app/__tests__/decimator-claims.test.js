import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { decimatorCoinHeads, decimatorPayout } from '../../chain/games.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';

// Audit 92a1358d0: the Decimator is a shared-dice craps battle. A wallet holds ONE entry per
// event: decBattlePlayers[player] = lvl << 64 | id names it and (audit 32c604531)
// decBattleEntries[lvl << 64 | id] = owner | chips << 160 | whole-FLIP stack << 190. Sealing stores the word;
// the entry's final coin drops tails, heads runs play the dice, and ranked winners are paid in
// heap order as claimable ETH or half whale passes. There is no claim.
const LEVEL = 25;
const ID = 3n;
const CHIPS = 1 | (2 << 9);
const STACK_FLIP = 1_900n;
const STACK = STACK_FLIP * 10n ** 18n;
const HALF_PASS = 2_250_000_000_000_000_000n;
// Pick sealed words whose coin for this entry lands each way, exactly as _run computes it.
const words = Array.from({ length: 64 }, (_, i) => BigInt(i + 1));
const HEADS_WORD = words.find(word => decimatorCoinHeads(word, LEVEL, ID));
const TAILS_WORD = words.find(word => !decimatorCoinHeads(word, LEVEL, ID));

async function round({ phase, word = HEADS_WORD, winners = 0, paid = 0, pool = 0n, champion = 0n, count = 12 } = {}) {
  const f = await rpcFixture();
  await f.field('GAME', 'decBattlePlayers', (BigInt(LEVEL) << 64n) | ID, PLAYER);
  await f.field('GAME', 'decBattleEntries', BigInt(PLAYER) | (BigInt(CHIPS) << 160n) | (STACK_FLIP << 190n), (BigInt(LEVEL) << 64n) | ID);
  await f.field('GAME', 'decBattleRounds', count, LEVEL, 'count');
  await f.field('GAME', 'decBattleRounds', phase, LEVEL, 'phase');
  await f.field('GAME', 'decBattleRounds', word, LEVEL, 'rngWord');
  await f.field('GAME', 'decBattleRounds', winners, LEVEL, 'winners');
  await f.field('GAME', 'decBattleRounds', paid, LEVEL, 'paid');
  await f.field('GAME', 'decBattleRounds', pool, LEVEL, 'poolWei');
  await f.field('GAME', 'decBattleRounds', champion, LEVEL, 'champion');
  await f.event('GAME', 'DecBurnRecorded', {
    player: PLAYER, lvl: LEVEL, entryId: ID, baseAmount: 1_000n * 10n ** 18n, credited: STACK, stack: STACK, chips: CHIPS,
  }, { block: 9000 });
  return f;
}
const read = f => readChainRoute(`/player/${PLAYER}/decimator?level=${LEVEL}`, { client: f.client });

test('payout terms match _payTerms: the champion takes 5% plus half in passes, then ETH and passes alternate', () => {
  const pool = 100n * 10n ** 18n;
  // base = 95 / 10 = 9.5 ETH, champion = 100 - 9 * 9.5 = 14.5 ETH, of which 3 half passes (6.75).
  assert.deepEqual(decimatorPayout(pool, 10, 0), { ethWei: 14_500_000_000_000_000_000n - 3n * HALF_PASS, halfPasses: 3n });
  assert.deepEqual(decimatorPayout(pool, 10, 2), { ethWei: 0n, halfPasses: 4n }, 'even places take whole half passes');
  // Four pass places leave 0.5 ETH each; five ETH places share the 2 ETH leftover, 0.4 ETH each.
  assert.deepEqual(decimatorPayout(pool, 10, 1), { ethWei: 9_900_000_000_000_000_000n, halfPasses: 0n });
  // Below one half pass a share is all ETH.
  assert.deepEqual(decimatorPayout(10n ** 18n, 10, 3), { ethWei: 95_000_000_000_000_000n, halfPasses: 0n });
});

test('an open event reports the entry, its stack and its board', async () => {
  const row = await read(await round({ phase: 0 }));
  assert.equal(row.entryId, String(ID));
  assert.equal(row.stack, String(STACK));
  assert.equal(row.chips, CHIPS);
  assert.equal(row.roundStatus, 'open');
  assert.equal(row.coin, null, 'no coin before the seal');
  assert.equal(row.winner, false);
});

test('a sealed event shows the final coin; tails sits out the dice', async () => {
  const tails = await read(await round({ phase: 1, word: TAILS_WORD }));
  assert.equal(tails.roundStatus, 'settling');
  assert.equal(tails.coin, 'tails');
  const f = await round({ phase: 1, word: HEADS_WORD });
  await f.event('GAME', 'DecimatorRun', { lvl: LEVEL, entryId: ID, normalizedPeak: 7_830n * 10n ** 18n });
  const heads = await read(f);
  assert.equal(heads.coin, 'heads');
  assert.equal(heads.peak, String(7_830n * 10n ** 18n));
  assert.equal(heads.winner, false, 'nothing is ranked yet');
});

test('a ranked winner the keepers have not reached is found in the heap and priced', async () => {
  const pool = 100n * 10n ** 18n;
  const f = await round({ phase: 2, winners: 10, paid: 1, pool, champion: 9n });
  // Unpaid heap places run from `paid`; this entry sits at place 2 (an even, pass place).
  await f.field('GAME', 'decBattleHeap', 5n, 1);
  await f.field('GAME', 'decBattleHeap', (77n << 64n) | ID, 2);
  const row = await read(f);
  assert.equal(row.roundStatus, 'closed');
  assert.equal(row.winner, true);
  assert.equal(row.claimed, false);
  assert.equal(row.champion, false);
  assert.equal(row.ethAmount, '0');
  assert.equal(row.halfPasses, '4');
  const rounds = await readChainRoute(`/game/decimator/player/${PLAYER}`, { client: f.client });
  assert.deepEqual(rounds.rounds.map(r => [r.level, r.isWinner, r.claimed]), [[LEVEL, true, false]],
    'a winner paid only in passes still counts as a winner');
});

test('a paid winner reports what DecimatorClaimed credited; a heads entry outside the heap lost', async () => {
  const f = await round({ phase: 3, winners: 2, paid: 2, pool: 10n ** 18n, champion: ID });
  await f.event('GAME', 'DecimatorClaimed', { player: PLAYER, lvl: LEVEL, entryId: ID, amountWei: 5n, halfPasses: 1n });
  const paid = await read(f);
  assert.equal(paid.winner, true);
  assert.equal(paid.claimed, true);
  assert.equal(paid.champion, true);
  assert.equal(paid.ethAmount, '5');
  assert.equal(paid.halfPasses, '1');
  assert.equal(paid.cashOnly, false);
  const lost = await read(await round({ phase: 3, winners: 2, paid: 2, pool: 10n ** 18n, champion: 1n }));
  assert.equal(lost.coin, 'heads');
  assert.equal(lost.winner, false);
});
