// Jackpot-day boards per deployment (chain/schema.js). Run 56 (audit 224de529) logs a bonus set
// with DailyWinningTraits and packs it into dailyFoilDraw; run 57+ (audit 9ee8986d) draws one board
// a day, plays the jackpot battle on jackpot days too, and claims foils without a drawKind.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { readChainRoute } from '../../chain/router.js';
import { dailyBoards, decodeFoilDraw, jackpotEvents } from '../../chain/jackpots.js';
import { useSchema, CURRENT_SCHEMA_HASH, RUN56_SCHEMA_HASH } from '../../chain/schema.js';
import { rpcFixture, PLAYER, OTHER_PLAYER } from './helpers/chain-rpc.js';

const DAY = 120;
const LEVEL = 6;
const WEI = 10n ** 18n;
const MAIN = 0xc3824100;
const BONUS = 0xc7864504;
const RUN56_DEFAULT = useSchema(RUN56_SCHEMA_HASH);
// replay-panel.js is a custom element, so its board gate is source-sliced like its other suites.
const replaySource = readFileSync(new URL('../../components/replay-panel.js', import.meta.url), 'utf8');
const gateStart = replaySource.indexOf('function hasDayBoards(rng) {');
const hasDayBoards = runInNewContext(`(${replaySource.slice(gateStart, replaySource.indexOf('\n}\n', gateStart) + 2)})`);
afterEach(() => { useSchema(RUN56_DEFAULT); });

// _packFoilDraw: run 56 = main | bonus << 32 | lvl << 64; run 57+ = main | lvl << 64.
const packRun56 = (main, bonus, lvl) => BigInt(main) | (BigInt(bonus) << 32n) | (BigInt(lvl) << 64n);
const packCurrent = (main, lvl) => BigInt(main) | (BigInt(lvl) << 64n);

test('DailyWinningTraits decodes per deployment: run 57+ never has a bonus draw', () => {
  useSchema(RUN56_SCHEMA_HASH);
  assert.deepEqual(dailyBoards({ mainTraitsPacked: String(MAIN), bonusTraitsPacked: String(BONUS), bonusTargetLevel: '7' }),
    { mainTraitsPacked: MAIN, bonusTraitsPacked: BONUS, bonusTargetLevel: 7, bonusTraitDraw: true });
  assert.equal(dailyBoards({ mainTraitsPacked: '1', bonusTraitsPacked: String(BONUS), bonusTargetLevel: '0' }).bonusTraitDraw, false,
    'a run-56 purchase day keeps its packed set but draws no bonus');
  useSchema(CURRENT_SCHEMA_HASH);
  assert.deepEqual(dailyBoards({ mainTraitsPacked: String(MAIN) }),
    { mainTraitsPacked: MAIN, bonusTraitsPacked: null, bonusTargetLevel: null, bonusTraitDraw: false });
  assert.deepEqual(dailyBoards(undefined), { mainTraitsPacked: null, bonusTraitsPacked: null, bonusTargetLevel: null, bonusTraitDraw: null });
});

test('dailyFoilDraw unpacks the layout its deployment packed', () => {
  useSchema(RUN56_SCHEMA_HASH);
  assert.deepEqual(decodeFoilDraw(packRun56(MAIN, BONUS, LEVEL)), { mainSet: MAIN, bonusSet: BONUS, level: LEVEL });
  assert.equal(decodeFoilDraw(0n), null);
  useSchema(CURRENT_SCHEMA_HASH);
  assert.deepEqual(decodeFoilDraw(packCurrent(MAIN, LEVEL)), { mainSet: MAIN, bonusSet: null, level: LEVEL });
  assert.equal(decodeFoilDraw(null), null, 'an unsealed day has no draw');
});

test('CoinDrawCrapsWin is read only from a run-56 deployment', () => {
  useSchema(RUN56_SCHEMA_HASH);
  assert.ok(jackpotEvents().includes('CoinDrawCrapsWin'));
  useSchema(CURRENT_SCHEMA_HASH);
  assert.ok(!jackpotEvents().includes('CoinDrawCrapsWin'));
});

// A jackpot day at LEVEL: two ETH winners, a daily ticket leg (sourceLevel LEVEL) and a day-1
// early-bird ticket leg (sourceLevel LEVEL + 1), both on the main board.
async function jackpotDay(schema) {
  useSchema(schema);
  const f = await rpcFixture(); const block = 9999; let index = 0;
  const run56 = schema === RUN56_SCHEMA_HASH;
  await f.field('GAME', 'dailyFoilDraw', run56 ? packRun56(MAIN, BONUS, LEVEL) : packCurrent(MAIN, LEVEL), DAY);
  await f.event('GAME', 'DailyRngApplied', { day: DAY, rawWord: 777, finalWord: 777 }, { block, index: index++ });
  await f.event('GAME', 'DailyWinningTraits', run56
    ? { day: DAY, mainTraitsPacked: MAIN, bonusTraitsPacked: BONUS, bonusTargetLevel: LEVEL + 1 }
    : { day: DAY, mainTraitsPacked: MAIN }, { block, index: index++ });
  await f.event('GAME', 'JackpotEthWin', { winner: PLAYER, level: LEVEL, traitId: 0x00, amount: 5n * WEI, entryIndex: 1 }, { block, index: index++ });
  await f.event('GAME', 'JackpotTicketWin', { winner: OTHER_PLAYER, entryLevel: LEVEL + 1, traitId: 0x41, entryCount: 8, sourceLevel: LEVEL, entryIndex: 2 }, { block, index: index++ });
  await f.event('GAME', 'JackpotTicketWin', { winner: PLAYER, entryLevel: LEVEL + 1, traitId: 0x82, entryCount: 4, sourceLevel: LEVEL + 1, entryIndex: 3 }, { block, index: index++ });
  if (!run56) {
    // Audit 0889affc1: the day's far-future draw only AWARDS seats in the craps-table jackpot battle
    // (CRAPS JackpotBattleEntry); what they win settles later as CrapsBetSettled, never a jackpot row.
    await f.event('CRAPS', 'JackpotBattleEntry', { slot: BigInt(DAY) * 8n + 6n, betId: ((BigInt(DAY) * 8n + 6n) << 64n) | 1n, player: PLAYER, units: 1, chips: 3 }, { block, index: index++ });
  }
  await f.event('GAME', 'PrizePoolDailySnapshot', { day: DAY }, { block, index: index++ });
  return f;
}

test('run 57+: the main board includes a Craps seat reveal without counting it as winnings', async () => {
  const f = await jackpotDay(CURRENT_SCHEMA_HASH);
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

test('run 56: a jackpot day keeps its bonus draw and the early-bird tickets on roll 2', async () => {
  const f = await jackpotDay(RUN56_SCHEMA_HASH);
  const summary = await readChainRoute(`/game/jackpot/day/${DAY}/summary`, { client: f.client });
  assert.equal(summary.rollTwo.bonusTraitDraw, true);
  assert.equal(summary.rollTwo.bonusTraitsPacked, BONUS);
  assert.equal(summary.rollTwo.bonusTargetLevel, LEVEL + 1);
  assert.deepEqual(summary.rollTwo.bonusDraw.map(row => row.traitId), [0xc7, 0x86, 0x45, 0x04]);
  assert.equal(summary.rollTwo.coinDrawBattle, null);
  const roll1 = await readChainRoute(`/game/jackpot/day/${DAY}/roll1`, { client: f.client });
  assert.equal(roll1.level, LEVEL);
  assert.deepEqual(roll1.wins.map(row => row.awardType).sort(), ['eth', 'tickets']);
  const roll2 = await readChainRoute(`/game/jackpot/day/${DAY}/roll2`, { client: f.client });
  assert.deepEqual(roll2.wins.map(row => [row.awardType, row.sourceLevel]), [['tickets', LEVEL + 1]]);
});

test('replay rng rows: a one-board day is complete without a bonus set', async () => {
  for (const schema of [RUN56_SCHEMA_HASH, CURRENT_SCHEMA_HASH]) {
    const f = await jackpotDay(schema);
    const { days } = await readChainRoute(`/replay/rng?beforeDay=${DAY + 1}&limit=1`, { client: f.client });
    const row = days.find(entry => entry.day === DAY);
    assert.equal(row.mainTraitsPacked, MAIN);
    if (schema === RUN56_SCHEMA_HASH) {
      assert.equal(row.bonusTraitsPacked, BONUS); assert.equal(row.bonusTraitDraw, true);
    } else {
      assert.equal(row.bonusTraitsPacked, null); assert.equal(row.bonusTraitDraw, false);
    }
    assert.equal(hasDayBoards(row), true);
  }
  // A run-56 day still needs its bonus set; a row with no boards is never complete.
  assert.equal(hasDayBoards({ mainTraitsPacked: MAIN, bonusTraitsPacked: null, bonusTraitDraw: true }), false);
  assert.equal(hasDayBoards({ mainTraitsPacked: MAIN, bonusTraitsPacked: null }), false);
  assert.equal(hasDayBoards({ mainTraitsPacked: null, bonusTraitsPacked: null, bonusTraitDraw: false }), false);
  assert.equal((replaySource.match(/hasFinalWord && hasDayBoards\(rng\)|!hasFinalWord \|\| !hasDayBoards\(rng\)/g) || []).length, 2,
    'both the exact-rolls gate and the draw milestone use the one-board-aware check');
});

test('foil claims read back per deployment: run 57+ claims are all the main draw', async () => {
  for (const schema of [RUN56_SCHEMA_HASH, CURRENT_SCHEMA_HASH]) {
    useSchema(schema);
    const f = await rpcFixture();
    f.answer('GAME_LENS', 'foilRecordOf', [[true, 3, 31_500, 0]]);
    await f.event('GAME', 'FoilMatchClaimed', schema === RUN56_SCHEMA_HASH
      ? { player: PLAYER, day: DAY, ticketIndex: 2, drawKind: 1, tier: 5, faces: 24 }
      : { player: PLAYER, day: DAY, ticketIndex: 2, tier: 5, faces: 48 });
    const foil = await readChainRoute(`/player/${PLAYER}/foil?level=${LEVEL}`, { client: f.client });
    assert.deepEqual(foil.claims, [{ day: DAY, ticketIndex: 2, drawKind: schema === RUN56_SCHEMA_HASH ? 1 : 0, tier: 5 }]);
  }
});
