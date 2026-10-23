import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';
import { buildBafResolutionSnapshot } from '../baf-resolution.js';

test('resolution reconstructs real sampled comparisons with frozen scores, ties, duplicates and empty spots', async () => {
  const f = await rpcFixture();
  const third = '0x3333333333333333333333333333333333333333';
  await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER); await f.wallet(74, third);
  await f.field('JACKPOTS', 'bafLevel', 1, 10, 'epoch');
  await f.event('GAME', 'DailyRngApplied', { day: 119, finalWord: 3 }, { block: 9989 });
  for (const [id, newTotal] of [[37, 200], [73, 300], [74, 200]]) {
    await f.event('JACKPOTS', 'BafFlipRecorded', { id, lvl: 10, amount: newTotal, newTotal }, { block: 9990 });
  }
  const draw = (round, candidates, sourceLevel = 10) => f.event('GAME', 'BafCandidates', {
    level: 10, day: 119, round, sourceLevel, traitId: 7, candidates,
  }, { block: 9991 });
  await draw(0, [37, 73, 73, 0]); // duplicate best must not take second place
  await draw(1, [37, 74, 73, 0]); // tied second keeps the first sampled ID
  await draw(2, [74, 37, 73, 0]);
  await draw(12, [37, 74], 11); // no fake padding of a short sample
  await draw(24, [37, 73], 12); // far-future candidates aren't recorded by this contract
  await f.event('GAME', 'JackpotEthWin', { walletId: 37, level: 10, traitId: 420, amount: 100 }, { block: 9991 });
  // Later credits and other brackets must never change the recorded matchup.
  await f.event('JACKPOTS', 'BafFlipRecorded', { id: 37, lvl: 10, newTotal: 9999 }, { block: 9992 });
  await f.event('JACKPOTS', 'BafFlipRecorded', { id: 37, lvl: 20, newTotal: 9999 }, { block: 9990 });
  const metadata = await readChainRoute('/game/baf/10/resolution', { client: f.client });
  assert.equal(metadata.comparisons.length, 4);
  assert.deepEqual(metadata.comparisons[0].players.map(p => p.placement), [2, 1, 0, 0]);
  assert.deepEqual(metadata.comparisons[1].players.map(p => p.placement), [2, 0, 1, 0]);
  assert.deepEqual(metadata.comparisons[2].players.map(p => p.placement), [2, 0, 1, 0]);
  assert.equal(metadata.comparisons[0].players[0].score, String(200n * 10n ** 18n));
  const snapshot = buildBafResolutionSnapshot({ level: 10, player: PLAYER, metadata });
  assert.equal(snapshot.comparisonsAvailable, true);
  assert.equal(snapshot.comparisons.length, 4);
  assert.equal(snapshot.comparisons[3].players.length, 2);
  assert.equal(snapshot.comparisons[0].players.at(-1).empty, true);
  assert.equal(snapshot.comparisons[2].players.find(p => p.isPlayer).placement, 0, 'sampled losing entries remain visible');
  assert.equal(snapshot.player.eth, '100', 'aggregate prizes are included exactly once');
  assert.ok(snapshot.comparisons.every(group => group.players.every(p => p.prizes === null)), 'payouts cannot be attributed to individual samples from aggregate receipts');
});

test('BAF round receipt includes all bracket prizes, future tickets and direct whale passes', async () => {
  const f = await rpcFixture();
  await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER);
  await f.field('JACKPOTS', 'bafLevel', 1, 10, 'epoch');
  await f.event('GAME', 'DailyRngApplied', { day: 119, finalWord: 3 }, { block: 9990 });
  for (let i = 0; i < 60; i++) {
    await f.event('GAME', 'JackpotEthWin', { walletId: 37, level: 10, traitId: 420, amount: 2 }, { block: 9991 });
  }
  await f.event('GAME', 'JackpotTicketWin', { walletId: 37, entryLevel: 17, sourceLevel: 10, traitId: 420, entryCount: 12 }, { block: 9991 });
  await f.event('GAME', 'JackpotTicketWin', { walletId: 37, entryLevel: 21, sourceLevel: 11, traitId: 420, entryCount: 8 }, { block: 9991 });
  await f.event('GAME', 'JackpotWhalePassWin', { walletId: 37, source: 2, halfPassCount: 14 }, { block: 9991 });
  await f.event('GAME', 'JackpotEthWin', { walletId: 73, level: 10, traitId: 420, amount: 33 }, { block: 9991 });
  // Other rounds, ordinary ticket draws, and other sources must stay out.
  await f.event('GAME', 'JackpotTicketWin', { walletId: 37, entryLevel: 10, sourceLevel: 20, traitId: 420, entryCount: 400 }, { block: 9992 });
  await f.event('GAME', 'JackpotTicketWin', { walletId: 37, entryLevel: 17, sourceLevel: 10, traitId: 2, entryCount: 400 }, { block: 9992 });
  await f.event('GAME', 'JackpotWhalePassWin', { walletId: 37, source: 1, halfPassCount: 100 }, { block: 9991 });
  await f.event('GAME', 'JackpotWhalePassWin', { walletId: 37, source: 2, halfPassCount: 100 }, { block: 9992 });
  const metadata = await readChainRoute('/game/baf/10/resolution', { client: f.client });
  assert.equal(metadata.status, 'closed');
  assert.equal(metadata.day, 119);
  assert.equal(metadata.rngWord, '3');
  assert.equal(metadata.estimatedPoolWei, null, 'a scatter payment is not a pool estimate');
  assert.equal(metadata.wins.length, 64, 'this route is not limited to a wallet history page');
  assert.equal(metadata.awards.ticketEntries, '20');
  const snapshot = buildBafResolutionSnapshot({ level: 10, player: PLAYER, metadata, history: { wins: [] } });
  assert.equal(snapshot.player.eth, '120');
  assert.equal(snapshot.player.tickets, '5');
  assert.equal(snapshot.player.whalePassHalves, '14');
  assert.equal(snapshot.survivorRank, 4);
});

test('BAF stays open while staged awards are still paying, and finalizes even without winners', async () => {
  const pending = await rpcFixture();
  await pending.event('GAME', 'JackpotEthWin', { walletId: 37, level: 10, traitId: 420, amount: 2 });
  assert.equal((await readChainRoute('/game/baf/10/resolution', { client: pending.client })).status, 'open');
  const empty = await rpcFixture();
  await empty.field('JACKPOTS', 'bafLevel', 1, 10, 'epoch');
  assert.equal((await readChainRoute('/game/baf/10/resolution', { client: empty.client })).status, 'closed');
});

test('weighted winner uses deposit order and the exact roll, not leaderboard rank', async () => {
  const f = await rpcFixture();
  await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER);
  await f.event('COINFLIP', 'BafDrawEntered', { day: 119, id: 37, index: 0, weight: 30, cumulativeWeight: 30 }, { block: 9990 });
  await f.event('COINFLIP', 'BafDrawEntered', { day: 119, id: 73, index: 1, weight: 70, cumulativeWeight: 100 }, { block: 9991 });
  // Fixed contract vector: word 1 gives roll 27 of 100, word 3 gives 64.
  const first = await readChainRoute(`/leaderboards/coinflip?day=119&player=${PLAYER}&rngWord=1`, { client: f.client });
  assert.equal(first.entries[0].player, OTHER_PLAYER);
  assert.equal(first.winner, PLAYER);
  const second = await readChainRoute('/leaderboards/coinflip?day=119&rngWord=3', { client: f.client });
  assert.equal(second.winner, OTHER_PLAYER);
  const empty = await readChainRoute('/leaderboards/coinflip?day=118&rngWord=1', { client: f.client });
  assert.equal(empty.winner, null);
});

test('a skipped BAF bracket reports its skipped status and no wins', async () => {
  const f = await rpcFixture();
  await f.event('JACKPOTS', 'BafSkipped', { lvl: 10, day: 119 });
  const metadata = await readChainRoute('/game/baf/10/resolution', { client: f.client });
  assert.equal(metadata.status, 'skipped');
  assert.deepEqual(metadata.wins, []);
});
