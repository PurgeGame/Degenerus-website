import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { decimatorPayout } from '../../chain/games.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';

// Audit 92a1358d0: the Decimator is a shared-dice craps battle. A wallet holds ONE entry per
// event: decBattlePlayers[wallet] = lvl << 64 | id names it and decBattleEntries[lvl << 64 | id]
// = owner | chips << 160 | whole-FLIP stack << 190. Sealing emits the word in DecimatorResolved
// (the round struct does not store it); survivors are sampled from it (decimator-sampling.js), the
// best are ranked and paid in heap order as claimable ETH or half whale passes. There is no claim.
// Survival sampling vectors and generated entries are pinned in decimator-survivors.test.js.
const LEVEL = 25;
const ID = 3n;
const WALLET = 7; // PLAYER's wallet ID: per-player storage and events are keyed by it
const CHIPS = 1 | (2 << 9);
const STACK_FLIP = 1_900n;
const STACK = STACK_FLIP * 10n ** 18n;
const HALF_PASS = 2_250_000_000_000_000_000n;

async function round({ phase, winners = 0, paid = 0, pool = 0n, champion = 0n, count = 12 } = {}) {
  const f = await rpcFixture();
  await f.wallet(WALLET, PLAYER);
  await f.field('GAME', 'decBattlePlayers', (BigInt(LEVEL) << 64n) | ID, WALLET);
  await f.field('GAME', 'decEntriesLevel', LEVEL);
  await f.field('GAME', 'decBattleEntries', BigInt(WALLET) | (BigInt(CHIPS) << 32n) | (STACK_FLIP << 62n), (ID - 1n) / 2n);
  await f.field('GAME', 'decBattleRounds', count, LEVEL, 'count');
  await f.field('GAME', 'decBattleRounds', phase, LEVEL, 'phase');
  await f.field('GAME', 'decBattleRounds', winners, LEVEL, 'winners');
  await f.field('GAME', 'decBattleRounds', paid, LEVEL, 'paid');
  await f.field('GAME', 'decBattleRounds', pool, LEVEL, 'poolWei');
  await f.field('GAME', 'decBattleRounds', champion, LEVEL, 'champion');
  await f.event('GAME', 'DecBurnRecorded', {
    player: WALLET, lvl: LEVEL, entryId: ID, baseAmount: 1_000n, credited: STACK_FLIP, stack: STACK_FLIP, chips: CHIPS,
  }, { block: 9000 });
  if (phase) await f.event('GAME', 'DecimatorResolved', { lvl: LEVEL, rngWord: 1n, poolWei: pool, entrants: count }, { block: 9100 });
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
  assert.equal(row.survived, null, 'survivors are drawn at the seal');
  assert.equal(row.winner, false);
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

test('a paid winner reports what DecimatorClaimed credited; an entry outside the heap lost', async () => {
  const f = await round({ phase: 3, winners: 2, paid: 2, pool: 10n ** 18n, champion: ID });
  await f.event('GAME', 'DecimatorClaimed', { walletId: WALLET, lvl: LEVEL, entryId: ID, amountWei: 5n, halfPasses: 1n });
  const paid = await read(f);
  assert.equal(paid.winner, true);
  assert.equal(paid.claimed, true);
  assert.equal(paid.champion, true);
  assert.equal(paid.ethAmount, '5');
  assert.equal(paid.halfPasses, '1');
  assert.equal(paid.cashOnly, false);
  const lost = await read(await round({ phase: 3, winners: 2, paid: 2, pool: 10n ** 18n, champion: 1n }));
  assert.equal(lost.winner, false);
});
