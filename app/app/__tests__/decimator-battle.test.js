import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimatorBattleFixture } from '../../craps/fixtures/decimator-battle.js';
import { buildDecimatorReplay, replayDecimatorEntry, prepareDecimatorReplay } from '../../craps/decimator-replay.js';
import { decimatorFieldPage, decimatorStandings } from '../decimator-battle-model.js';
import { decimatorJackpotAwards } from '../../chain/jackpots.js';
import { buildRoll1BucketSummaries } from '../jackpot-buckets.js';
import { buildDaySummaryPrizes } from '../day-summary-prizes.js';

const { snapshot } = decimatorBattleFixture();

test('the complete field includes burned and generated slots that never emitted a run', () => {
  const all = decimatorFieldPage(snapshot, { limit: 100 });
  assert.equal(all.total, 40);
  assert.equal(all.rows.length, 40);
  assert.equal(all.rows.filter(row => row.eligible).length, 20);
  const out = decimatorFieldPage(snapshot, { filter: 'out', limit: 100 });
  assert.equal(out.total, 20);
  assert.ok(out.rows.every(row => !row.eligible && row.peak == null));
  assert.ok(out.rows.some(row => row.generated && row.address == null), 'unvisited generated slots have no invented recipient');
  assert.deepEqual([0, 5, 10, 15].flatMap(offset => decimatorFieldPage(snapshot, { filter: 'out', offset, limit: 5 }).rows.map(row => row.entryId)),
    out.rows.map(row => row.entryId), 'paging skips surviving ids without dropping eliminated slots');
});

test('sampling reconstructs unvisited survivors before their generated logs arrive', () => {
  const settling = { ...snapshot, ranked: false, battleEntries: snapshot.battleEntries.filter(row => !row.generated) };
  const rows = decimatorFieldPage(settling, { filter: 'survivors', limit: 100 }).rows;
  assert.equal(rows.length, snapshot.survivorCount);
  assert.ok(rows.some(row => row.generated && row.eligible && row.address == null));
});

test('verified shared dice keep peaks and ranks after a bust, including multiple entries per wallet', () => {
  const replay = buildDecimatorReplay(snapshot);
  assert.equal(replay.entries.length, snapshot.survivorCount);
  assert.ok(replay.frames.length <= 511);
  const final = decimatorStandings(replay, 48);
  assert.deepEqual(final.map(row => row.entryId), [...snapshot.battleEntries].filter(row => row.eligible).sort((a, b) => a.rank - b.rank).map(row => row.entryId));
  for (const entry of final) {
    assert.equal(entry.current.peak, entry.peak);
    assert.equal(entry.current.score, entry.score);
    assert.ok(entry.checkpoints.every((point, index) => !index || BigInt(point.peak) >= BigInt(entry.checkpoints[index - 1].peak)));
    assert.equal(entry.ended, true);
  }
  assert.ok(final.some(row => row.stop === 'bust' && BigInt(row.current.score) > 0n));
  assert.ok(new Set(replay.entries.map(row => row.address)).size < replay.entries.length);
});

test('replay rejects a wrong peak and incomplete logs instead of presenting fabricated dice', () => {
  const bad = structuredClone(snapshot);
  bad.battleEntries.find(row => row.eligible).peak = '1';
  assert.throws(() => buildDecimatorReplay(bad), /peak mismatch/);
  assert.throws(() => buildDecimatorReplay({ ...snapshot, battleEntries: snapshot.battleEntries.slice(1) }), /complete entry field/);
  assert.throws(() => buildDecimatorReplay({ ...snapshot, ranked: false }), /still settling/);
});

test('a generated run uses the precise mean stack and its own survival key', () => {
  const input = { ...snapshot, generatedStackTotal: '300001000000000000000000', generatedStackCount: '24' };
  const original = snapshot.battleEntries.find(row => row.generated);
  const run = replayDecimatorEntry(input, { ...original, peak: null, rankScore: null });
  const expected = (300001n * BigInt(run.peak) / 24n) * 10n ** 18n;
  assert.equal(run.rankScore, String(expected));
  assert.equal(run.score, String(expected / (3000n * 10n ** 18n)));
});

test('jackpot conversion exposes all allocated slots on misses and actual surviving entry hits', () => {
  const traits = 1n | (65n << 8n) | (129n << 16n) | (193n << 24n);
  const events = [{ name: 'DecimatorJackpotPlan', args: { lvl: 15, traits, generatedEntries: 11n,
    weights: 1n | (2n << 16n) | (3n << 32n) } },
  { name: 'DecimatorGenerated', args: { lvl: 15, recipient: '0xabc', id: 31n, quadrant: 1 } },
  { name: 'DecimatorGenerated', args: { lvl: 25, recipient: '0xdef', id: 31n, quadrant: 1 } }];
  const { buckets, wins } = decimatorJackpotAwards(events);
  assert.deepEqual(buckets.map(row => [row.traitId, row.entries, row.survivors]), [[1, 1, 0], [65, 4, 1], [129, 6, 0]]);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].awardType, 'decimator_entry');
  assert.equal(wins[0].amount, '1');
  assert.equal(wins[0].traitId, 65);
  const summaries = buildRoll1BucketSummaries(wins, [1, 65, 129, 193], 'ETH', buckets);
  assert.equal(summaries[0].decimatorEntries.entries, 1, 'no survivor event still yields the public allocated count');
  assert.equal(summaries[1].decimatorEntries.entries, 4);
  assert.equal(summaries[3].decimatorEntries, undefined, 'the solo bucket keeps its ETH award');
  assert.deepEqual(buildDaySummaryPrizes({ totalEth: '0', breakdown: wins }), [{
    type: 'decimator-entry', amount: 1n, level: 15, winningTraitIds: [65],
  }]);
});

test('closing a battle aborts and terminates its replay worker', async t => {
  const previous = globalThis.Worker; let worker;
  t.after(() => { if (previous) globalThis.Worker = previous; else delete globalThis.Worker; });
  globalThis.Worker = class {
    constructor() { worker = this; this.terminated = false; }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  const controller = new AbortController();
  const replay = prepareDecimatorReplay(snapshot, { signal: controller.signal });
  controller.abort();
  await assert.rejects(replay, /canceled/);
  assert.equal(worker.terminated, true);
});

test('Decimator skins the ordinary resolver with weighted peaks and a complete shared dice clock', async () => {
  const { decimatorTableOptions, decimatorTableStandings } = await import('../../craps/decimator-table.js');
  const { snapshot: wide } = decimatorBattleFixture({ wideStacks: true });
  const replay = buildDecimatorReplay(wide);
  const options = decimatorTableOptions(wide, replay);
  assert.equal(options.goalFlip, '0', 'no fixed goal or early cash-out');
  assert.equal(options.resolutionHands.length, replay.frames.length);
  assert.equal(options.fieldEntrants, 40);
  const starting = replay.entries.map(row => BigInt(row.stack));
  assert.ok(starting.reduce((a,b) => a > b ? a : b) / starting.reduce((a,b) => a < b ? a : b) > 1000n);
  const final = decimatorTableStandings(options.decimator, replay.frames.length, []);
  assert.deepEqual(final.filter(row => row.eligible).map(row => row.betId),
    [...wide.battleEntries].filter(row => row.eligible).sort((a,b) => a.rank - b.rank).map(row => row.entryId));
  assert.ok(final.every(row => row.amount > 0n), 'busts retain their score');
  assert.ok(options.resolutionHands.slice(0,-1).every(frame => frame.terminal === ''), 'a viewer bust never ends the shared battle');
});

test('a killed entry can watch the same resolution without inventing a board or run', async () => {
  const { decimatorTableOptions, decimatorTableStandings } = await import('../../craps/decimator-table.js');
  const replay = buildDecimatorReplay(snapshot);
  const killed = snapshot.battleEntries.find(row => !row.eligible);
  const options = decimatorTableOptions(snapshot, replay, { viewerEntryId: killed.entryId });
  assert.equal(options.viewerBetId, killed.entryId);
  assert.ok(Object.values(options.bets).every(count => count === 0));
  assert.ok(options.resolutionHands.every(frame => frame.viewerClosed && frame.bankrollFlip === '0'));
  assert.equal(options.otherPlayers.length, snapshot.survivorCount);
  const row = decimatorTableStandings(options.decimator, 0, []).find(row => row.local);
  assert.equal(row.status, 'DRAW OUT'); assert.equal(row.rank, null);
  assert.equal(row.amount, 0n);
});

test('the visible cutoff follows the paid boundary without using future scores or top outliers', async () => {
  const { decimatorCurrentCutoff } = await import('../../craps/decimator-table.js');
  const skin = { snapshot: { winnerCount: 3, winners: [{ score: '999999999' }] }, rows: [
    { eligible: true, values: [1000000n, 2000000n] },
    { eligible: true, values: [110n, 150n] },
    { eligible: true, values: [100n, 140n] },
    { eligible: true, values: [90n, 120n] },
    { eligible: false, values: [999999999n, 999999999n] },
  ] };
  assert.equal(decimatorCurrentCutoff(skin, 0), 100n);
  assert.equal(decimatorCurrentCutoff(skin, 1), 140n);
  skin.rows[0].values = [10n ** 30n, 10n ** 36n];
  assert.equal(decimatorCurrentCutoff(skin, 0), 100n, 'far-ahead players never drive the range');
  skin.snapshot.winnerCount = 0;
  assert.equal(decimatorCurrentCutoff(skin, 0), null);
});

test('off-chart peaks exit at the true crossing without collecting on the chart ceiling', async () => {
  const { decimatorVisiblePeakPoints } = await import('../../craps/decimator-table.js');
  const points = [{ step: 0, value: 80n }, { step: 10, value: 160n }, { step: 20, value: 5000n }];
  assert.deepEqual(decimatorVisiblePeakPoints(points, 100n), [{ step: 0, value: 80n }, { step: 2.5, value: 100n }]);
  assert.deepEqual(decimatorVisiblePeakPoints([{ step: 0, value: 1000n }], 100n), []);
  assert.deepEqual(decimatorVisiblePeakPoints(points, 5000n), points);
});
