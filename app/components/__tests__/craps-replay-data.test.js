import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.HTMLElement ??= class HTMLElement {};
globalThis.customElements ??= {
  registry: new Map(),
  define(name, ctor) { this.registry.set(name, ctor); },
  get(name) { return this.registry.get(name); },
};

import {
  __resetCrapsReplayLoaderForTest,
  assertSupportedCrapsReplayRuleset,
  crapsReplayArtifactPaths,
  crapsReplayPointerPath,
  crapsReplaySeatFromBetId,
  crapsReplayShardIndex,
  encodeCrapsReplayLadder,
  loadCrapsReplay,
  validateCrapsReplayCollection,
  validateCrapsReplayManifest,
  validateCrapsReplayPlayer,
  validateCrapsReplayPointer,
} from '../../craps/replay-contract.js';
import {
  decodeCrapsReplayTape,
  replayCrapsSeat,
  replayCrapsViewport,
} from '../../craps/replay-engine.js';
import {
  createCrapsReplayTableModel,
} from '../../craps/replay-adapter.js';
import {
  SIM_CRAPS_REPLAY_ARTIFACTS,
  SIM_CRAPS_REPLAY_FEATURED,
  SIM_CRAPS_REPLAY_MANIFEST,
  SIM_CRAPS_REPLAY_PATHS,
  SIM_CRAPS_REPLAY_POINTER,
  SIM_CRAPS_REPLAY_SHARD,
} from '../../craps/fixtures/sim-battle-v1.js';

const clone = (value) => structuredClone(value);

test('ready pointer is tiny, complete, and bound to its immutable digest path', () => {
  const pointer = validateCrapsReplayPointer(SIM_CRAPS_REPLAY_POINTER);
  assert.equal(pointer.status, 'ready');
  assert.equal(pointer.resolved, pointer.entrants);
  assert.equal(pointer.manifestPath, SIM_CRAPS_REPLAY_PATHS.manifest);
  assert.equal(crapsReplayPointerPath('100'), SIM_CRAPS_REPLAY_PATHS.pointer);
  assert.deepEqual(crapsReplayArtifactPaths('100', pointer.digest), {
    base: SIM_CRAPS_REPLAY_PATHS.manifest.replace('/manifest.json', ''),
    manifest: SIM_CRAPS_REPLAY_PATHS.manifest,
    featured: SIM_CRAPS_REPLAY_PATHS.featured,
    shardTemplate: SIM_CRAPS_REPLAY_PATHS.shard.replace('0000.json', '{shard}.json'),
  });

  const incomplete = clone(SIM_CRAPS_REPLAY_POINTER);
  incomplete.resolved = 3;
  assert.throws(() => validateCrapsReplayPointer(incomplete), /must have resolved every entrant/);

  const settling = clone(SIM_CRAPS_REPLAY_POINTER);
  settling.status = 'settling';
  delete settling.digest;
  delete settling.manifestPath;
  assert.equal(validateCrapsReplayPointer(settling).manifestPath, null);
  settling.digest = '0123456789abcdef';
  assert.throws(() => validateCrapsReplayPointer(settling), /cannot expose immutable artifacts/);
});

test('manifest, featured union, and seat shard form a closed verified artifact set', () => {
  const manifest = assertSupportedCrapsReplayRuleset(SIM_CRAPS_REPLAY_MANIFEST);
  const featured = validateCrapsReplayCollection(SIM_CRAPS_REPLAY_FEATURED, manifest);
  const shard = validateCrapsReplayCollection(SIM_CRAPS_REPLAY_SHARD, manifest);
  assert.equal(manifest.verification.settledEntrants, 4);
  assert.equal(featured.leaderboard.length, manifest.tape.maxHands);
  assert.equal(featured.players.length, 4);
  assert.equal(shard.shard.index, 0);
  assert.equal(crapsReplaySeatFromBetId(featured.players[0].betId), 1n);
  assert.equal(crapsReplayShardIndex(1n, manifest.field.shardSize), 0);
  assert.equal(crapsReplayShardIndex(257n, manifest.field.shardSize), 1);

  const unsupported = clone(SIM_CRAPS_REPLAY_MANIFEST);
  unsupported.ruleset.runtimeCodeHash = `0x${'9'.repeat(64)}`;
  assert.throws(() => assertSupportedCrapsReplayRuleset(unsupported), /unsupported ruleset/);

  const unverified = clone(featured.players[0]);
  unverified.replayOk = false;
  assert.throws(() => validateCrapsReplayPlayer(unverified), /not chain-verified/);
});

test('packed shared tape decodes once into exact shooter boundaries', () => {
  const tape = decodeCrapsReplayTape(SIM_CRAPS_REPLAY_MANIFEST);
  assert.equal(tape.totalRolls, 110);
  assert.equal(tape.hands.length, 11);
  assert.equal(tape.offsets[0], 0);
  assert.equal(tape.offsets[1], 7);
  assert.deepEqual(tape.hands[0][0], { d1: 1, d2: 5, total: 6 });
  assert.equal(tape.hands[0].at(-1).total, 7);

  const corrupt = clone(SIM_CRAPS_REPLAY_MANIFEST);
  corrupt.tape.totalRolls = 109;
  assert.throws(() => decodeCrapsReplayTape(corrupt), /decoded 110 bytes, expected 109/);
});

test('browser roll decomposition meets every simulator bankroll checkpoint exactly', () => {
  const manifest = validateCrapsReplayManifest(SIM_CRAPS_REPLAY_MANIFEST);
  const featured = validateCrapsReplayCollection(SIM_CRAPS_REPLAY_FEATURED, manifest);
  const viewport = replayCrapsViewport(manifest, featured.players, featured.players[0]);
  assert.deepEqual(
    viewport.seats.map((seat) => [seat.player.name, seat.events.length, seat.player.stop]),
    [
      ['dicegoblin', 38, 'bust'],
      ['rollhard', 110, 'goal'],
      ['feltwitch', 47, 'bust'],
      ['blankcheck', 47, 'bust'],
    ],
  );

  const viewer = viewport.byBetId.get('1844674407370955161601');
  const firstPoint = viewer.events[0];
  assert.equal(firstPoint.label, 'POINT 6 SET');
  assert.deepEqual(firstPoint.payoutBets, [], 'point-setting roll does not invent a payout');
  const firstSevenOut = viewer.events.find((event) => event.sevenOut);
  assert.deepEqual(firstSevenOut.payoutBets, ['dont-pass']);
  assert.ok(firstSevenOut.lostBets.includes('pass'));
  assert.equal(viewer.hands[0].boost.percent, 6);

  const winner = viewport.byBetId.get('1844674407370955161602');
  const livePassNatural = winner.events[38];
  assert.deepEqual({
    globalRoll: livePassNatural.globalRoll,
    total: livePassNatural.total,
    comeOut: livePassNatural.comeOut,
    label: livePassNatural.label,
    payoutBets: livePassNatural.payoutBets,
    lostBets: livePassNatural.lostBets,
    deltaWei: livePassNatural.deltaWei.toString(),
  }, {
    globalRoll: 38,
    total: 7,
    comeOut: true,
    label: 'COME-OUT 7',
    payoutBets: ['pass'],
    lostBets: [],
    deltaWei: '120000000000000000000',
  }, 'viewer 2 frame 39 proves an eligible live Pass receives its exact come-out 7 payout');
  assert.equal(winner.hands[5].multiplier, '2', 'wager doubles after five shooters');
  assert.equal(winner.hands[10].multiplier, '4', 'wager doubles again after ten shooters');
  assert.equal(winner.hands[6].survival.survived, true);
  assert.equal(winner.events.at(-1).bankrollAfterWei, winner.player.wonWei);

  const failedFlip = viewport.byBetId.get('1844674407370955161604');
  assert.equal(failedFlip.failedSurvival.survived, false);
  assert.equal(failedFlip.events.at(-1).bankrollAfterWei, '643750000000000000000');
  assert.equal(failedFlip.player.ladderWei.at(-1), '0');
});

test('ladder drift fails closed instead of presenting plausible but wrong payouts', () => {
  const player = clone(SIM_CRAPS_REPLAY_FEATURED.players[0]);
  const decoded = [...validateCrapsReplayPlayer(player).ladderWei];
  decoded[1] = (BigInt(decoded[1]) + 1n).toString();
  player.ladder = encodeCrapsReplayLadder(decoded);
  assert.throws(
    () => replayCrapsSeat(SIM_CRAPS_REPLAY_MANIFEST, player),
    /roll replay missed the stored bankroll ladder/,
  );
});

test('adapter supplies exact local rolls, opponent events, and authoritative shooter seating', () => {
  const model = createCrapsReplayTableModel(SIM_CRAPS_REPLAY_ARTIFACTS);
  const options = model.tableOptions;
  assert.equal(options.resolutionHands.length, 38);
  assert.equal(options.otherPlayers.length, 3);
  assert.equal(Object.values(options.bets).reduce((sum, count) => sum + count, 0), 10);
  assert.deepEqual(options.resolutionHands[0].payoutBets, []);
  assert.deepEqual(options.resolutionHands.slice(0, 16).map((frame) => frame.point), [
    6, 6, 6, 6, 6, 6, 6,
    8, null, 5, 5,
    null, 9, null, null, null,
  ], 'the replay point sets on come-out, persists through ordinary rolls, and clears only when made or off');
  assert.ok(options.resolutionHands.find((frame) => frame.label.startsWith('SEVEN OUT')).payoutBets.includes('dont-pass'));
  assert.deepEqual(options.leaderboardTimeline[0].opponentBetIds, [
    '1844674407370955161602',
    '1844674407370955161603',
    '1844674407370955161604',
  ]);
  assert.equal(options.otherPlayers[0].resolution.bankrollsFlip.length, options.resolutionHands.length);
  assert.equal(options.otherPlayers[0].resolution.rollEvents.length, options.resolutionHands.length);
  assert.equal(options.replayEngineVersion, 'craps-solidity-484a5d60b-v1');
});

test('table aggregation keeps multiple seats from one wallet and exact opponent roll events separate', async () => {
  const { aggregateCrapsTableBets } = await import('../app-craps-table.js');
  const base = createCrapsReplayTableModel(SIM_CRAPS_REPLAY_ARTIFACTS).tableOptions.otherPlayers[0];
  const duplicate = clone(base);
  duplicate.betId = `${BigInt(base.betId) + 20n}`;
  duplicate.chips = { ...duplicate.chips, pass: 0, 'place-4': 1 };
  const table = aggregateCrapsTableBets([base, duplicate]);
  assert.equal(table.playerCount, 2);
  assert.notEqual(table.players[0].key, table.players[1].key);
  assert.deepEqual(table.players[0].rollEvents[0].payoutBets, base.rollEvents[0]?.payoutBets ?? []);
});

test('loader rechecks the pointer but single-flights immutable sharded artifacts', async () => {
  __resetCrapsReplayLoaderForTest();
  const bodies = new Map([
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, SIM_CRAPS_REPLAY_MANIFEST],
    [SIM_CRAPS_REPLAY_PATHS.featured, SIM_CRAPS_REPLAY_FEATURED],
    [SIM_CRAPS_REPLAY_PATHS.shard, SIM_CRAPS_REPLAY_SHARD],
  ]);
  const calls = new Map();
  const fetchImpl = async (path) => {
    calls.set(path, (calls.get(path) ?? 0) + 1);
    await Promise.resolve();
    const body = bodies.get(path);
    return {
      ok: body != null,
      status: body == null ? 404 : 200,
      json: async () => clone(body),
    };
  };
  const request = {
    battleKey: '100',
    viewerBetId: '1844674407370955161601',
    fetchImpl,
  };
  const [first, second] = await Promise.all([loadCrapsReplay(request), loadCrapsReplay(request)]);
  assert.equal(first.viewer.name, 'dicegoblin');
  assert.equal(second.ready, true);
  assert.equal(calls.get(SIM_CRAPS_REPLAY_PATHS.pointer), 2, 'mutable readiness is rechecked');
  assert.equal(calls.get(SIM_CRAPS_REPLAY_PATHS.manifest), 1);
  assert.equal(calls.get(SIM_CRAPS_REPLAY_PATHS.featured), 1);
  assert.equal(calls.get(SIM_CRAPS_REPLAY_PATHS.shard), 1);
  __resetCrapsReplayLoaderForTest();
});
