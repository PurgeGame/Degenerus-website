import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChainRoute } from '../../chain/router.js';
import { useSchema, CURRENT_SCHEMA_HASH, RUN56_SCHEMA_HASH } from '../../chain/schema.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';
import { buildBafResolutionSnapshot } from '../baf-resolution.js';

test('BAF round receipt includes all bracket prizes, future tickets and direct whale passes', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    await f.field('JACKPOTS', 'bafLevel', 1, 10, 'epoch');
    await f.event('GAME', 'DailyRngApplied', { day: 119, finalWord: 3 }, { block: 9990 });
    for (let i = 0; i < 60; i++) {
      await f.event('GAME', 'JackpotEthWin', { winner: PLAYER, level: 10, traitId: 420, amount: 2 }, { block: 9991 });
    }
    await f.event('GAME', 'JackpotTicketWin', { winner: PLAYER, entryLevel: 17, sourceLevel: 10, traitId: 420, entryCount: 12 }, { block: 9991 });
    await f.event('GAME', 'JackpotTicketWin', { winner: PLAYER, entryLevel: 21, sourceLevel: 11, traitId: 420, entryCount: 8 }, { block: 9991 });
    await f.event('GAME', 'JackpotWhalePassWin', { winner: PLAYER, source: 2, halfPassCount: 14 }, { block: 9991 });
    await f.event('GAME', 'JackpotEthWin', { winner: OTHER_PLAYER, level: 10, traitId: 420, amount: 33 }, { block: 9991 });
    // Other rounds, ordinary ticket draws, and other sources must stay out.
    await f.event('GAME', 'JackpotTicketWin', { winner: PLAYER, entryLevel: 10, sourceLevel: 20, traitId: 420, entryCount: 400 }, { block: 9992 });
    await f.event('GAME', 'JackpotTicketWin', { winner: PLAYER, entryLevel: 17, sourceLevel: 10, traitId: 2, entryCount: 400 }, { block: 9992 });
    await f.event('GAME', 'JackpotWhalePassWin', { winner: PLAYER, source: 1, halfPassCount: 100 }, { block: 9991 });
    await f.event('GAME', 'JackpotWhalePassWin', { winner: PLAYER, source: 2, halfPassCount: 100 }, { block: 9992 });
    const metadata = await readChainRoute('/game/baf/10/resolution', { client: f.client });
    assert.equal(metadata.status, 'closed');
    assert.equal(metadata.day, 119);
    assert.equal(metadata.cutMode, 'staged');
    assert.equal(metadata.rngWord, '3');
    assert.equal(metadata.estimatedPoolWei, null, 'a scatter payment is not a pool estimate');
    assert.equal(metadata.wins.length, 64, 'this route is not limited to a wallet history page');
    assert.equal(metadata.awards.ticketEntries, '20');
    const snapshot = buildBafResolutionSnapshot({ level: 10, player: PLAYER, metadata, history: { wins: [] } });
    assert.equal(snapshot.player.eth, '120');
    assert.equal(snapshot.player.tickets, '5');
    assert.equal(snapshot.player.whalePassHalves, '14');
    assert.equal(snapshot.survivorRank, 3);
  } finally { useSchema(previous); }
});

test('BAF stays open while staged awards are still paying, and finalizes even without winners', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const pending = await rpcFixture();
    await pending.event('GAME', 'JackpotEthWin', { winner: PLAYER, level: 10, traitId: 420, amount: 2 });
    assert.equal((await readChainRoute('/game/baf/10/resolution', { client: pending.client })).status, 'open');
    const empty = await rpcFixture();
    await empty.field('JACKPOTS', 'bafLevel', 1, 10, 'epoch');
    assert.equal((await readChainRoute('/game/baf/10/resolution', { client: empty.client })).status, 'closed');
  } finally { useSchema(previous); }
});

test('legacy BAF metadata selects its original domain-separated cut and skipped status', async () => {
  const previous = useSchema(RUN56_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    await f.event('JACKPOTS', 'BafSkipped', { lvl: 10, day: 119 });
    const metadata = await readChainRoute('/game/baf/10/resolution', { client: f.client });
    assert.equal(metadata.status, 'skipped');
    assert.equal(metadata.cutMode, 'legacy');
    assert.deepEqual(metadata.wins, []);
  } finally { useSchema(previous); }
});

test('weighted winner uses deposit order and the exact roll, not leaderboard rank', async () => {
  const previous = useSchema(CURRENT_SCHEMA_HASH);
  try {
    const f = await rpcFixture();
    await f.event('COINFLIP', 'BafDrawEntered', { day: 119, player: PLAYER, index: 0, weight: 30, cumulativeWeight: 30 }, { block: 9990 });
    await f.event('COINFLIP', 'BafDrawEntered', { day: 119, player: OTHER_PLAYER, index: 1, weight: 70, cumulativeWeight: 100 }, { block: 9991 });
    // Fixed contract vector: word 1 gives roll 27 of 100, word 3 gives 64.
    const first = await readChainRoute(`/leaderboards/coinflip?day=119&player=${PLAYER}&rngWord=1`, { client: f.client });
    assert.equal(first.entries[0].player, OTHER_PLAYER);
    assert.equal(first.winner, PLAYER);
    const second = await readChainRoute('/leaderboards/coinflip?day=119&rngWord=3', { client: f.client });
    assert.equal(second.winner, OTHER_PLAYER);
    const empty = await readChainRoute('/leaderboards/coinflip?day=118&rngWord=1', { client: f.client });
    assert.equal(empty.winner, null);
  } finally { useSchema(previous); }
});
