// Purchase-day fill-draw craps battle (audit 5790a946): the chain reader, the verified in-browser
// replay, the table projection of one run, the centre's who-gets-it rule, and the phantom
// bonus-draw fix. The battle events here are produced by the SAME vendored port the replay uses
// (`resolveCoinDrawBattle`), which database/src/craps/__tests__/coin-draw.test.ts proves equal to
// the real CoinDrawBattle.resolve on 741 contract-executed runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readChainRoute } from '../../chain/router.js';
import { rpcFixture, PLAYER } from './helpers/chain-rpc.js';
import { resolveCoinDrawBattle, coinDrawWordForDay, replayCoinDrawBattle } from '../../chain/craps-engine.js';
import { materializeCoinDrawBattle, serializeCoinDrawReplay } from '../../chain/coin-draw-worker.js';
import { chainCoinDrawBattle, __resetCoinDrawJobsForTest } from '../../chain/coin-draw.js';
import { coinDrawRunTableOptions, openCoinDrawRun } from '../../craps/coin-draw-viewer.js';
import { coinDrawCentreModel } from '../coin-draw-centre.js';

const WEI = 10n ** 18n;
const DAY = 120;
const LEVEL = 6;
const DAY_WORD = 0x5eed_c0ffee_1234_5678_9abc_def0_1357_9bdf_2468_ace0n;
const addr = (i) => '0x' + (0xabc000n + BigInt(i)).toString(16).padStart(40, '0');

// Forty-four draws over thirty wallets, PLAYER drawn three times; the viewed wallet is always in.
function battleFixture() {
  const entrants = Array.from({ length: 44 }, (_, i) => (i % 15 === 3 ? PLAYER.toLowerCase() : addr(i % 29)));
  return resolveCoinDrawBattle(entrants, 61_234n * WEI, coinDrawWordForDay(DAY_WORD, LEVEL));
}

async function purchaseDay({ tamper = null } = {}) {
  const f = await rpcFixture(); const block = 9999; const forward = battleFixture();
  let index = 0;
  await f.event('GAME', 'DailyRngApplied', { day: DAY, rawWord: DAY_WORD, finalWord: DAY_WORD }, { block, index: index++ });
  // A purchase day: bonusTargetLevel 0, because there is no bonus-trait draw.
  await f.event('GAME', 'DailyWinningTraits', { day: DAY, mainTraitsPacked: 0x03020100, bonusTraitsPacked: 0xc3824100, bonusTargetLevel: 0 }, { block, index: index++ });
  for (const run of forward.runs) {
    const logged = tamper ? tamper(run) : run;
    await f.event('COIN_DRAW_BATTLE', 'CoinDrawBattleRun', { level: LEVEL, ...logged }, { block, index: index++ });
  }
  if (forward.pot) await f.event('COIN_DRAW_BATTLE', 'CoinDrawBattlePot', { level: LEVEL, winner: forward.pot.winner, pot: forward.pot.pot }, { block, index: index++ });
  await f.event('GAME', 'PrizePoolDailySnapshot', { day: DAY }, { block, index: index++ });
  return { f, forward };
}

test('a purchase day carries its fill-draw battle and no phantom bonus draw', async () => {
  const { f, forward } = await purchaseDay();
  const roll2 = await readChainRoute(`/game/jackpot/day/${DAY}/roll2`, { client: f.client });
  assert.equal(roll2.bonusTraitDraw, false);
  assert.equal(roll2.coinDrawBattle.kind, 'fill-draw');
  assert.equal(roll2.coinDrawBattle.key, `coin-draw:${DAY}`, 'a synthetic key, never a bytes32 CrapsBattle key');
  assert.equal(roll2.coinDrawBattle.entrants.length, forward.runs.length, 'busted runs are entrants too');
  assert.equal(roll2.coinDrawBattle.pot, String(forward.pot.pot));
  const summary = await readChainRoute(`/game/jackpot/day/${DAY}/summary`, { client: f.client });
  assert.equal(summary.rollTwo.bonusTargetLevel, 0);
  assert.equal(summary.rollTwo.bonusTraitDraw, false);
  assert.deepEqual(summary.rollTwo.bonusDraw, [], 'no four zero-winner bonus badges on a purchase day');
  // The packed bonus set still ships: it feeds the day's foil claims.
  assert.equal(summary.rollTwo.bonusTraitsPacked, 0xc3824100);
});

test('a jackpot day keeps its bonus draw and never carries a fill-draw battle', async () => {
  const f = await rpcFixture(); const block = 9999;
  await f.event('GAME', 'DailyRngApplied', { day: DAY, finalWord: 333 }, { block, index: 0 });
  await f.event('GAME', 'DailyWinningTraits', { day: DAY, mainTraitsPacked: 123, bonusTraitsPacked: 456, bonusTargetLevel: LEVEL + 1 }, { block, index: 1 });
  await f.event('GAME', 'CoinDrawCrapsWin', { winner: PLAYER, winnerLevel: 7, fullDay: false, refused: false }, { block, index: 2 });
  await f.event('GAME', 'PrizePoolDailySnapshot', { day: DAY }, { block, index: 3 });
  const roll2 = await readChainRoute(`/game/jackpot/day/${DAY}/roll2`, { client: f.client });
  assert.equal(roll2.bonusTraitDraw, true);
  assert.equal(roll2.coinDrawBattle, null);
  assert.equal(coinDrawCentreModel(roll2.coinDrawBattle, PLAYER), null, 'a jackpot day is never highlighted');
  const summary = await readChainRoute(`/game/jackpot/day/${DAY}/summary`, { client: f.client });
  assert.equal(summary.rollTwo.bonusDraw.length, 4);
});

test('the chain reader rebuilds and verifies the battle from events and the day word', async () => {
  __resetCoinDrawJobsForTest();
  const { f, forward } = await purchaseDay();
  const battle = await chainCoinDrawBattle(DAY, { client: f.client, replay: materializeCoinDrawBattle });
  assert.equal(battle.replayError, null);
  assert.equal(battle.dayWord, String(DAY_WORD));
  assert.equal(battle.replay.chipFlip, String(forward.chipFlip), 'the unlogged chip is recovered');
  assert.equal(battle.replay.runs.length, forward.runs.length);
  battle.replay.runs.forEach((run, i) => {
    assert.equal(run.bankrollOutWei, String(forward.runs[i].bankrollOut));
    assert.equal(run.totalRolls, Number(forward.runs[i].rolls));
    assert.equal(run.paidWei, String(forward.runs[i].paid));
    assert.equal(run.hands.flat().length, run.totalRolls);
  });
  const winner = battle.replay.runs[battle.replay.winnerIndex];
  assert.equal(winner.player, forward.pot.winner);
  assert.equal(winner.rank, 1);
});

test('a battle whose events do not reproduce fails closed but keeps the chain results', async () => {
  __resetCoinDrawJobsForTest();
  let tampered = false;
  const { f } = await purchaseDay({ tamper: (run) => {
    if (tampered || run.bankrollOut === 0n) return run;
    tampered = true; return { ...run, bankrollOut: run.bankrollOut + 1n };
  } });
  const battle = await chainCoinDrawBattle(DAY, { client: f.client, replay: materializeCoinDrawBattle });
  assert.equal(battle.replay, null);
  assert.match(battle.replayError, /No chip reproduces|do not match/);
  assert.ok(battle.runs.length > 0, 'the logged runs still stand');
  const opened = await openCoinDrawRun({ day: DAY, player: PLAYER, load: async () => battle, doc: { querySelector: () => null } });
  assert.equal(opened.ok, false);
  assert.match(opened.message, /Battle replay unavailable\. Your run: \d+ rolls/);
});

test('clicking through opens the table on the viewer\'s own run', async () => {
  __resetCoinDrawJobsForTest();
  const { f } = await purchaseDay();
  const battle = await chainCoinDrawBattle(DAY, { client: f.client, replay: materializeCoinDrawBattle });
  const calls = [];
  const table = { open: (options, opener) => calls.push({ options, opener }) };
  const doc = { querySelector: (selector) => (selector === 'app-craps-table' ? table : null) };
  const opener = { id: 'centre' };
  const result = await openCoinDrawRun({ day: DAY, player: PLAYER.toUpperCase().replace('0X', '0x'), opener, doc,
    load: async () => battle, loadProfiles: async () => new Map() });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const { options } = calls[0];
  const index = battle.replay.runs.findIndex((run) => run.player === PLAYER.toLowerCase());
  const run = battle.replay.runs[index];
  assert.equal(calls[0].opener, opener);
  assert.equal(options.viewerPlayer, PLAYER.toLowerCase());
  assert.equal(options.viewerBetId, `coin-draw:${DAY}:${index}`);
  assert.equal(options.tableIndex, `coin-draw:${DAY}`);
  const runs = battle.replay.runs;
  const longest = Math.max(...runs.map((entry) => entry.totalRolls));
  const frames = options.resolutionHands;
  assert.equal(frames.length, longest, 'the table rolls until the longest run is done');
  assert.ok(frames.slice(0, run.totalRolls).every((frame) => frame.viewerClosed === false), 'the run\'s own rolls come first');
  assert.ok(frames.slice(run.totalRolls).every((frame) => frame.viewerClosed === true && /^BATTLE (CONTINUES|COMPLETE) · /.test(frame.label)),
    'then the field rolls on without it');
  assert.equal(frames[run.totalRolls - 1].bankrollFlip, String(BigInt(run.bankrollOutWei) / WEI));
  assert.equal(options.fieldEntrants, runs.length);
  assert.equal(options.otherPlayers.length, runs.length - 1, 'every other run races on the same clock');
  const rivals = runs.filter((_, i) => i !== index);
  options.otherPlayers.forEach((rival, i) => {
    const entry = rivals[i];
    assert.equal(rival.player, entry.player);
    assert.equal(rival.resolution.bankrollsFlip.length, longest, 'one bankroll per tick of the shared clock');
    assert.equal(rival.resolution.roll, entry.totalRolls, 'a rival leaves the race on its own last roll');
    assert.equal(rival.resolution.type, entry.stop === 'bust' ? 'bust' : 'cashout');
    assert.equal(rival.resolution.rawEndingFlip, String(BigInt(entry.bankrollOutWei) / WEI));
    assert.equal(rival.resolution.standing, runs.length + 1 - entry.rank, 'the chain rank breaks the table\'s ties');
    assert.deepEqual(rival.resolution.survivals, [], 'a rival\'s own shooters are not the clock\'s');
  });
  const winner = runs.findIndex((entry) => entry.isWinner);
  assert.equal(options.battleWinnerBetId, winner < 0 ? null : `coin-draw:${DAY}:${winner}`);
  assert.equal(options.potRoll, BigInt(battle.replay.potWei) > 0n, 'the pot is rolled into the marquee');
  assert.equal(options.bankrollFlip, String(BigInt(run.bankrollInWei) / WEI));
  assert.equal(options.viewerResult.runPayoutWei, run.paidWei);
  assert.equal(options.entryLabel, 'FILL-DRAW BATTLE · 3 UNITS', 'no rank before the run is watched');
  assert.equal(Object.values(options.bets).reduce((n, v) => n + v, 0), 10, 'ten chips on the scattered board');

  const stranger = await openCoinDrawRun({ day: DAY, player: '0x' + '9'.repeat(40), doc, load: async () => battle });
  assert.equal(stranger.ok, false);
  assert.equal(calls.length, 1, 'a wallet that was not drawn opens nothing');
});

test('every run of a contract-executed battle projects onto the table, and a capped run closes as complete', () => {
  const golden = JSON.parse(readFileSync(new URL('../../../../database/src/craps/__tests__/coin-draw-golden.json', import.meta.url), 'utf8'));
  let projected = 0;
  for (const c of golden.cases.slice(0, 10)) {
    const replay = serializeCoinDrawReplay(replayCoinDrawBattle({ word: BigInt(c.word), runs: c.runs, pot: c.pot }));
    const battle = { key: `coin-draw:${c.id}`, transactionHash: '0x1', runs: c.runs, pot: c.pot, replay };
    replay.runs.forEach((_, i) => { coinDrawRunTableOptions(battle, i); projected++; });
  }
  assert.ok(projected > 100);
  // Capped non-goal runs are rare (the roll and shooter caps); drive the branch off a goal run.
  const c = golden.cases.find((g) => g.pot);
  const replay = serializeCoinDrawReplay(replayCoinDrawBattle({ word: BigInt(c.word), runs: c.runs, pot: c.pot }));
  const i = replay.runs.findIndex((run) => run.stop === 'goal');
  replay.runs[i] = { ...replay.runs[i], stop: 'capped' };
  const options = coinDrawRunTableOptions({ key: 'coin-draw:1', runs: c.runs, pot: c.pot, replay }, i);
  const last = options.resolutionHands[replay.runs[i].totalRolls - 1];
  assert.equal(options.viewerResult.stop, 'goal', 'a capped run is paid its bankroll, so the table locks it');
  assert.equal(last.viewerTerminal, 'goal');
  assert.match(last.label, /(ROLL|SHOOTER) CAP$/);
  assert.doesNotMatch(last.label, /GOAL LOCKED/);
  const rival = coinDrawRunTableOptions({ key: 'coin-draw:1', runs: c.runs, pot: c.pot, replay }, i === 0 ? 1 : 0)
    .otherPlayers.find((entry) => entry.player === replay.runs[i].player);
  assert.equal(rival.resolution.type, 'cashout', 'and a capped rival reads as locked, not busted');
});

test('the centre is the battle only for a wallet that was drawn into it', () => {
  const battle = { kind: 'fill-draw', key: 'coin-draw:5', day: 5, pot: String(12_400n * WEI), winner: addr(2), entrants: [
    { player: addr(1), units: '1', paid: '0' },
    { player: addr(2), units: '2', paid: String(3_000n * WEI) },
    { player: addr(3), units: '1', paid: String(900n * WEI) },
  ] };
  const bust = coinDrawCentreModel(battle, addr(1).toUpperCase().replace('0X', '0x'));
  assert.equal(bust.index, 0, 'a bust was still drawn in');
  for (const player of [addr(1), addr(2), addr(3)]) {
    const model = coinDrawCentreModel(battle, player);
    assert.doesNotMatch(model.ariaLabel, /\d|POT|PAID|BUST|WON/i, 'the centre never spoils the run or the pot');
    assert.deepEqual(Object.keys(model).sort(), ['ariaLabel', 'day', 'index', 'key', 'player']);
  }
  assert.equal(coinDrawCentreModel(battle, addr(4)), null, 'not drawn: no highlight');
  assert.equal(coinDrawCentreModel(battle, null), null, 'no viewer: no highlight');
  assert.equal(coinDrawCentreModel(battle, ''), null);
  assert.equal(coinDrawCentreModel(null, addr(1)), null, 'no battle (a jackpot day): no highlight');
  assert.equal(coinDrawCentreModel({ ...battle, kind: 'opener' }, addr(1)), null);
});
