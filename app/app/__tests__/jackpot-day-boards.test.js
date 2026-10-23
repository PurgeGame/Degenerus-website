// Jackpot-day boards: one board a day, the jackpot battle played on jackpot days too, and foils
// claimed without a drawKind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { readChainRoute } from '../../chain/router.js';
import { dailyBoards, decodeFoilDraw, JACKPOT_EVENTS } from '../../chain/jackpots.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';

const DAY = 120;
const LEVEL = 6;
const WEI = 10n ** 18n;
const MAIN = 0xc3824100;
// replay-panel.js is a custom element, so its board gate is source-sliced like its other suites.
const replaySource = readFileSync(new URL('../../components/replay-panel.js', import.meta.url), 'utf8');
const gateStart = replaySource.indexOf('function hasDayBoards(rng) {');
const hasDayBoards = runInNewContext(`(${replaySource.slice(gateStart, replaySource.indexOf('\n}\n', gateStart) + 2)})`);

// _packFoilDraw = main | lvl << 64 (bits 32-63, the old bonus set, stay zero).
const packCurrent = (main, lvl) => BigInt(main) | (BigInt(lvl) << 64n);

test('DailyWinningTraits decodes one board and never a bonus draw', () => {
  assert.deepEqual(dailyBoards({ mainTraitsPacked: String(MAIN) }),
    { mainTraitsPacked: MAIN, bonusTraitsPacked: null, bonusTargetLevel: null, bonusTraitDraw: false });
  assert.deepEqual(dailyBoards(undefined), { mainTraitsPacked: null, bonusTraitsPacked: null, bonusTargetLevel: null, bonusTraitDraw: null });
});

test('dailyFoilDraw unpacks the main set and the cycle level', () => {
  assert.deepEqual(decodeFoilDraw(packCurrent(MAIN, LEVEL)), { mainSet: MAIN, bonusSet: null, level: LEVEL });
  assert.equal(decodeFoilDraw(0n), null);
  assert.equal(decodeFoilDraw(null), null, 'an unsealed day has no draw');
});

test('the Game\'s own award events are the four jackpot wins', () => {
  assert.deepEqual(JACKPOT_EVENTS, ['JackpotEthWin', 'JackpotFlipWin', 'JackpotTicketWin', 'JackpotWhalePassWin']);
});

// A jackpot day at LEVEL: two ETH winners, a daily ticket leg (sourceLevel LEVEL) and a day-1
// early-bird ticket leg (sourceLevel LEVEL + 1), both on the main board.
async function jackpotDay() {
  const f = await rpcFixture(); const block = 9999; let index = 0;
  await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER);
  await f.field('GAME', 'dailyFoilDraw', packCurrent(MAIN, LEVEL) | (BigInt(DAY) << 217n), DAY & 1);
  await f.event('GAME', 'DailyRngApplied', { day: DAY, rawWord: 777, finalWord: 777 }, { block, index: index++ });
  await f.event('GAME', 'DailyWinningTraits', { day: DAY, mainTraitsPacked: MAIN }, { block, index: index++ });
  await f.event('GAME', 'JackpotEthWin', { winner: PLAYER, walletId: 37, level: LEVEL, traitId: 0x00, amount: 5n * WEI, entryIndex: 1 }, { block, index: index++ });
  await f.event('GAME', 'JackpotTicketWin', { winner: OTHER_PLAYER, walletId: 73, entryLevel: LEVEL + 1, traitId: 0x41, entryCount: 8, sourceLevel: LEVEL, entryIndex: 2 }, { block, index: index++ });
  await f.event('GAME', 'JackpotTicketWin', { winner: PLAYER, walletId: 37, entryLevel: LEVEL + 1, traitId: 0x82, entryCount: 4, sourceLevel: LEVEL + 1, entryIndex: 3 }, { block, index: index++ });
  // The day's far-future draw only AWARDS seats in the craps-table jackpot battle
  // (CRAPS JackpotBattleEntry); what they win settles later as CrapsBetSettled, never a jackpot row.
  await f.event('CRAPS', 'JackpotBattleEntry', { slot: BigInt(DAY) * 8n + 6n, betId: ((BigInt(DAY) * 8n + 6n) << 64n) | 1n, playerId: 37, units: 1, chips: 3 }, { block, index: index++ });
  await f.event('GAME', 'PrizePoolDailySnapshot', { day: DAY }, { block, index: index++ });
  return f;
}

test('the main board includes a Craps seat reveal without counting it as winnings', async () => {
  const f = await jackpotDay();
  const summary = await readChainRoute(`/game/jackpot/day/${DAY}/summary`, { client: f.client });
  assert.equal(summary.rollOne.mainTraitsPacked, MAIN);
  assert.equal(summary.rollTwo.bonusTraitDraw, false);
  assert.equal(summary.rollTwo.bonusTraitsPacked, null);
  assert.equal(summary.rollTwo.bonusTargetLevel, null);
  assert.deepEqual(summary.rollTwo.bonusDraw, [], 'no bonus badges for a draw that never happened');
  const battle = summary.rollTwo.coinDrawBattle;
  assert.equal(battle.kind, 'jackpot');
  assert.equal(battle.day, DAY);
  assert.equal(battle.key, `0x${(BigInt(DAY) * 8n + 6n).toString(16).padStart(64, '0')}`);
  assert.deepEqual(battle.entrants, [{ player: PLAYER,
    betId: String(((BigInt(DAY) * 8n + 6n) << 64n) | 1n), units: '1' }]);
  const roll1 = await readChainRoute(`/game/jackpot/day/${DAY}/roll1`, { client: f.client });
  assert.equal(roll1.level, LEVEL, 'the level comes from dailyFoilDraw bits 64-87');
  assert.deepEqual(roll1.wins.map(row => row.awardType).sort(), ['eth', 'tickets', 'tickets'],
    'the early-bird tickets are a main-board result, so they reveal with roll 1');
  assert.deepEqual(summary.rollOne.tickets.map(row => row.traitId), [0x41], 'the daily ticket summary keeps its own leg');
  const roll2 = await readChainRoute(`/game/jackpot/day/${DAY}/roll2`, { client: f.client });
  assert.equal(roll2.bonusTraitDraw, false);
  assert.deepEqual(roll2.coinDrawBattle, battle);
  assert.deepEqual(roll2.wins, [], 'an awarded battle seat is not a jackpot win');
  const winners = await readChainRoute(`/game/jackpot/day/${DAY}/winners`, { client: f.client });
  assert.equal(winners.winners.find(w => w.address === PLAYER).hasBonus, false);
});

test('converted jackpot roll1 carries Decimator slot buckets and recipient entry awards', async () => {
  const f = await rpcFixture(); const block = 9999; const level = 15;
  await f.wallet(37, PLAYER); await f.wallet(73, OTHER_PLAYER);
  await f.field('GAME', 'dailyFoilDraw', packCurrent(MAIN, level) | (BigInt(DAY) << 217n), DAY & 1);
  await f.event('GAME', 'DailyRngApplied', { day: DAY, rawWord: 777, finalWord: 777 }, { block, index: 0 });
  await f.event('GAME', 'DailyWinningTraits', { day: DAY, mainTraitsPacked: MAIN }, { block, index: 1 });
  await f.event('GAME', 'DecimatorJackpotPlan', { lvl: level, word: 777, originalPool: 1000,
    originalStack: 9000, originalCount: 3, generatedEntries: 3, traits: MAIN, weights: 1n | (2n << 16n) }, { block, index: 2 });
  await f.event('GAME', 'DecimatorGenerated', { lvl: level, id: 4, recipientId: 37, quadrant: 0,
    chips: 0, normalizedPeak: 3000n * WEI, score: 9000000n * WEI }, { block, index: 3 });
  await f.event('GAME', 'JackpotEthWin', { walletId: 73, level, traitId: 0xc3, amount: 5n * WEI, entryIndex: 1 }, { block, index: 4 });
  await f.event('GAME', 'PrizePoolDailySnapshot', { day: DAY }, { block, index: 5 });
  const roll1 = await readChainRoute(`/game/jackpot/day/${DAY}/roll1`, { client: f.client });
  assert.deepEqual(roll1.decimatorEntries.map(row => [row.traitId, row.entries, row.survivors]), [[0, 1, 1], [0x41, 2, 0]]);
  const mine = roll1.wins.find(row => row.winner === PLAYER);
  assert.deepEqual([mine.awardType, mine.amount, mine.decimatorEntryId, mine.traitId], ['decimator_entry', '1', '4', 0]);
  const winners = await readChainRoute(`/game/jackpot/day/${DAY}/winners`, { client: f.client });
  const entryWinner = winners.winners.find(row => row.address === PLAYER);
  assert.equal(String(entryWinner.totalEth), '0', 'an entry award never becomes ETH');
  assert.equal(entryWinner.breakdown[0].awardType, 'decimator_entry');
});

test('replay rng rows: a one-board day is complete without a bonus set', async () => {
  const f = await jackpotDay();
  const { days } = await readChainRoute(`/replay/rng?beforeDay=${DAY + 1}&limit=1`, { client: f.client });
  const row = days.find(entry => entry.day === DAY);
  assert.equal(row.mainTraitsPacked, MAIN);
  assert.equal(row.bonusTraitsPacked, null); assert.equal(row.bonusTraitDraw, false);
  assert.equal(hasDayBoards(row), true);
  // A row that still expects a bonus set, or has no boards, is never complete.
  assert.equal(hasDayBoards({ mainTraitsPacked: MAIN, bonusTraitsPacked: null, bonusTraitDraw: true }), false);
  assert.equal(hasDayBoards({ mainTraitsPacked: MAIN, bonusTraitsPacked: null }), false);
  assert.equal(hasDayBoards({ mainTraitsPacked: null, bonusTraitsPacked: null, bonusTraitDraw: false }), false);
  assert.equal((replaySource.match(/hasFinalWord && hasDayBoards\(rng\)|!hasFinalWord \|\| !hasDayBoards\(rng\)/g) || []).length, 2,
    'both the exact-rolls gate and the draw milestone use the one-board-aware check');
});

test('foil claims read back as the main draw', async () => {
  const f = await rpcFixture();
  await f.wallet(37, PLAYER);
  f.answer('GAME_LENS', 'foilRecordOf', [[true, 3, 31_500, 0, false, 0, [0, 0, 0, 0]]]);
  await f.event('GAME', 'FoilMatchClaimed', { id: 37, day: DAY, ticketIndex: 2, tier: 5, faces: 48 });
  const foil = await readChainRoute(`/player/${PLAYER}/foil?level=${LEVEL}`, { client: f.client });
  assert.deepEqual(foil.claims, [{ day: DAY, ticketIndex: 2, drawKind: 0, tier: 5 }]);
});
