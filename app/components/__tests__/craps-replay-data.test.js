/**
 * The V1 Craps replay contract, exercised against the fixture the PRODUCTION serializer emits.
 *
 * ⚠ The fixture is GENERATED (`degenerus-sim/scripts/craps-replay-fixture.ts --write`) from
 * `database/src/craps/replay-bundle.ts` over a field replayed by `database/src/craps/battle.ts`
 * — the same two functions the indexer publishes with. So these assertions are PROPERTY-BASED,
 * never index-based: they locate the situation they care about (a seven-out, a hard-way
 * decision, a lost survival flip) and assert what must be true of it, rather than pinning
 * `events[8]`. A regenerated fixture rolls different dice; the properties are what must survive
 * that, and an assertion that could not survive it was pinning the fixture rather than the
 * contract.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.HTMLElement ??= class HTMLElement {};
globalThis.customElements ??= {
  registry: new Map(),
  define(name, ctor) { this.registry.set(name, ctor); },
  get(name) { return this.registry.get(name); },
};

import {
  CRAPS_REPLAY_DEFAULT_SHARD_SIZE,
  CRAPS_REPLAY_MAX_HANDS,
  CRAPS_REPLAY_MAX_ROLLS,
  __resetCrapsReplayLoaderForTest,
  assertSupportedCrapsReplayRuleset,
  crapsReplayArtifactPaths,
  crapsReplayPointerPath,
  crapsReplaySeatFromBetId,
  crapsReplayShardIndex,
  decodeCrapsReplayRankTimeline,
  encodeCrapsReplayLadder,
  encodeCrapsReplayRankTimeline,
  loadCrapsReplay,
  validateCrapsReplayCollection,
  validateCrapsReplayManifest,
  validateCrapsReplayPlayer,
  validateCrapsReplayPointer,
} from '../../craps/replay-contract.js';
import {
  decodeCrapsReplayTape,
  replayCrapsSeat,
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
  SIM_CRAPS_REPLAY_SHARDS,
  SIM_CRAPS_REPLAY_VIEWER,
} from '../../craps/fixtures/sim-battle-v1.js';
import { CRAPS_REPLAY_ESCALATOR_SHOOTERS } from '../../craps/replay-engine.js';

const clone = (value) => structuredClone(value);
const MANIFEST = validateCrapsReplayManifest(SIM_CRAPS_REPLAY_MANIFEST);
const ALL_PLAYERS = SIM_CRAPS_REPLAY_SHARDS.flatMap((shard) => shard.players);

test('full-field chip positions use a compact, exact roll-aligned codec', () => {
  const ranks = [1, 2, 11, 50, 65_536, 4_294_967_295];
  const encoded = encodeCrapsReplayRankTimeline(ranks);
  assert.equal(encoded.encoding, 'uint32be/base64');
  assert.deepEqual(decodeCrapsReplayRankTimeline(encoded, ranks.length), ranks);
  assert.throws(
    () => decodeCrapsReplayRankTimeline({ encoding: 'uint32be/base64', values: 'AAAAAA==' }),
    /one-based/,
  );
});

test('ready pointer is tiny, complete, and bound to its immutable digest path', () => {
  const pointer = validateCrapsReplayPointer(SIM_CRAPS_REPLAY_POINTER);
  assert.equal(pointer.status, 'ready');
  assert.equal(pointer.resolved, pointer.entrants);
  assert.equal(pointer.entrants, MANIFEST.field.entrants);
  assert.equal(pointer.manifestPath, SIM_CRAPS_REPLAY_PATHS.manifest);
  assert.equal(crapsReplayPointerPath(pointer.battleKey), SIM_CRAPS_REPLAY_PATHS.pointer);
  assert.deepEqual(crapsReplayArtifactPaths(pointer.battleKey, pointer.digest), {
    base: SIM_CRAPS_REPLAY_PATHS.manifest.replace('/manifest.json', ''),
    manifest: SIM_CRAPS_REPLAY_PATHS.manifest,
    featured: SIM_CRAPS_REPLAY_PATHS.featured,
    shardTemplate: SIM_CRAPS_REPLAY_PATHS.shard.replace('0000.json', '{shard}.json'),
  });

  // The acceptance gate: a ready pointer cannot exist while a seat is unresolved.
  const incomplete = clone(SIM_CRAPS_REPLAY_POINTER);
  incomplete.resolved = incomplete.entrants - 1;
  assert.throws(() => validateCrapsReplayPointer(incomplete), /must have resolved every entrant/);

  // A non-ready pointer must never expose a discoverable namespace — that is exactly the
  // partially-uploaded bundle the publication ordering exists to make unreachable.
  const settling = clone(SIM_CRAPS_REPLAY_POINTER);
  settling.status = 'settling';
  delete settling.digest;
  delete settling.manifestPath;
  assert.equal(validateCrapsReplayPointer(settling).manifestPath, null);
  settling.digest = '0123456789abcdef';
  assert.throws(() => validateCrapsReplayPointer(settling), /cannot expose immutable artifacts/);

  const failed = clone(SIM_CRAPS_REPLAY_POINTER);
  failed.status = 'failed';
  failed.error = 'replay-mismatch';
  delete failed.digest;
  delete failed.manifestPath;
  const parsedFailure = validateCrapsReplayPointer(failed);
  assert.equal(parsedFailure.error, 'replay-mismatch');
  assert.equal(parsedFailure.digest, null);
});

test('manifest, featured union, and every seat shard form a closed verified artifact set', () => {
  const manifest = assertSupportedCrapsReplayRuleset(SIM_CRAPS_REPLAY_MANIFEST);
  const featured = validateCrapsReplayCollection(SIM_CRAPS_REPLAY_FEATURED, manifest);

  assert.equal(manifest.verification.allSeatsReplayOk, true);
  assert.equal(manifest.verification.settledEntrants, manifest.field.entrants);
  assert.equal(featured.leaderboard.length, manifest.tape.maxHands);
  assert.equal(SIM_CRAPS_REPLAY_SHARDS.length, manifest.field.shardCount);

  // Every seat lands in exactly one shard, and every shard's seats fall inside its range.
  const seen = new Set();
  let placed = 0;
  SIM_CRAPS_REPLAY_SHARDS.forEach((raw, index) => {
    const shard = validateCrapsReplayCollection(raw, manifest);
    assert.equal(shard.shard.index, index);
    for (const player of shard.players) {
      assert.ok(!seen.has(player.betId), `bet id ${player.betId} appears in two shards`);
      seen.add(player.betId);
      assert.ok(BigInt(player.seat) >= BigInt(shard.shard.startSeat));
      assert.ok(BigInt(player.seat) <= BigInt(shard.shard.endSeat));
      assert.equal(crapsReplaySeatFromBetId(player.betId), BigInt(player.seat));
      assert.equal(crapsReplayShardIndex(player.seat, manifest.field.shardSize), index);
      placed += 1;
    }
  });
  assert.equal(placed, manifest.field.entrants);

  // The featured union is a strict subset of the field and covers every candidate row.
  for (const row of featured.leaderboard) {
    assert.ok(row.betIds.length <= 4, 'at most four candidates per shooter');
    for (const betId of row.betIds) assert.ok(seen.has(betId));
  }

  const unsupported = clone(SIM_CRAPS_REPLAY_MANIFEST);
  unsupported.ruleset.runtimeCodeHash = `0x${'9'.repeat(64)}`;
  assert.throws(() => assertSupportedCrapsReplayRuleset(unsupported), /unsupported ruleset/);

  const unverified = clone(featured.players[0]);
  unverified.replayOk = false;
  assert.throws(() => validateCrapsReplayPlayer(unverified), /not chain-verified/);
});

test('the replay manifest carries optional whole-pool and added-FLIP totals into table options', () => {
  assert.equal(MANIFEST.terms.bountyPoolWei, null,
    'older sealed bundles keep the whole bounty pool explicitly unknown');
  assert.equal(MANIFEST.terms.addedFlipWei, null,
    'older sealed bundles keep the new amount explicitly unknown');
  const withAdded = clone(SIM_CRAPS_REPLAY_MANIFEST);
  withAdded.terms.bountyPoolWei = '84900000000000000000000';
  withAdded.terms.addedFlipWei = '75000000000000000000000';
  const options = createCrapsReplayTableModel({
    ...SIM_CRAPS_REPLAY_ARTIFACTS,
    manifest: withAdded,
  }).tableOptions;
  assert.equal(options.bountyPoolWei, withAdded.terms.bountyPoolWei);
  assert.equal(options.addedFlipWei, withAdded.terms.addedFlipWei);
});

test('shard lookup is exact at the 256-seat production boundary', () => {
  // The fixture uses a small shard size so several boundaries fit in a checked-in file. The
  // PRODUCTION size is 256, and seats 1 / 256 / 257 are the arithmetic that matters.
  assert.equal(CRAPS_REPLAY_DEFAULT_SHARD_SIZE, 256);
  assert.equal(crapsReplayShardIndex(1n), 0);
  assert.equal(crapsReplayShardIndex(256n), 0);
  assert.equal(crapsReplayShardIndex(257n), 1);
  assert.equal(crapsReplayShardIndex(512n), 1);
  assert.equal(crapsReplayShardIndex(513n), 2);
  assert.throws(() => crapsReplayShardIndex(0n), /at least one/);

  // A bet id's low 64 bits ARE its seat, whichever lane it came through — and the window lane
  // and the whole-day lane each number from one, so seat numbers COLLIDE inside one field.
  const daySeat = ALL_PLAYERS.find((p) => p.name.startsWith('Day seat'));
  assert.ok(daySeat, 'the fixture carries the whole-day lane');
  const windowSeat = ALL_PLAYERS.find((p) => p.name === `Seat ${daySeat.seat}`);
  assert.ok(windowSeat, 'and a window seat with the same seat number');
  assert.notEqual(daySeat.betId, windowSeat.betId, 'the bet id is the only unique identity');
  assert.equal(
    crapsReplayShardIndex(daySeat.seat, MANIFEST.field.shardSize),
    crapsReplayShardIndex(windowSeat.seat, MANIFEST.field.shardSize),
    'colliding seats resolve to one shard, so a viewer always finds their own record',
  );
});

test('packed shared tape decodes once into exact shooter boundaries', () => {
  const tape = decodeCrapsReplayTape(SIM_CRAPS_REPLAY_MANIFEST);
  assert.equal(tape.totalRolls, MANIFEST.tape.totalRolls);
  assert.equal(tape.hands.length, MANIFEST.tape.maxHands);
  assert.equal(tape.offsets[0], 0);
  assert.ok(MANIFEST.tape.maxHands <= CRAPS_REPLAY_MAX_HANDS);
  assert.ok(MANIFEST.tape.totalRolls <= CRAPS_REPLAY_MAX_ROLLS);

  let consumed = 0;
  tape.hands.forEach((hand, index) => {
    assert.ok(hand.length > 0, `shooter ${index} rolled at least once`);
    assert.equal(tape.offsets[index], consumed, 'offsets are the running roll cursor');
    for (const roll of hand) {
      assert.ok(roll.d1 >= 1 && roll.d1 <= 6 && roll.d2 >= 1 && roll.d2 <= 6);
      assert.equal(roll.total, roll.d1 + roll.d2);
    }
    consumed += hand.length;
  });
  assert.equal(consumed, tape.totalRolls);

  const corrupt = clone(SIM_CRAPS_REPLAY_MANIFEST);
  corrupt.tape.totalRolls = MANIFEST.tape.totalRolls - 1;
  assert.throws(() => decodeCrapsReplayTape(corrupt), /decoded \d+ bytes, expected/);

  const badOffsets = clone(SIM_CRAPS_REPLAY_MANIFEST);
  badOffsets.tape.handOffsets = Buffer.alloc(MANIFEST.tape.maxHands * 4, 0).toString('base64');
  assert.throws(() => decodeCrapsReplayTape(badOffsets), /increasing|zero/);
});

test('browser roll decomposition meets every stored bankroll checkpoint for the whole field', () => {
  const tape = decodeCrapsReplayTape(MANIFEST);
  let seats = 0;
  let sevenOuts = 0;
  let comeOutSevens = 0;
  let pointsSet = 0;
  let pointsMade = 0;
  let darkWins = 0;
  let hardWayDecisions = 0;
  let boostedHands = 0;

  for (const raw of ALL_PLAYERS) {
    // THIS IS THE GATE: replayCrapsSeat throws unless every shooter lands on its stored ladder
    // entry exactly and the final ladder amount times the entry multiple equals `wonWei`.
    const trace = replayCrapsSeat(MANIFEST, raw, tape);
    seats += 1;

    assert.equal(
      trace.events.length, trace.player.totalRolls,
      'a seat animates exactly the rolls its verified settlement consumed',
    );
    assert.equal(trace.player.ladderWei.length, trace.player.handsPlayed + 1);

    for (const event of trace.events) {
      if (event.sevenOut) sevenOuts += 1;
      if (event.comeOut && event.total === 7) comeOutSevens += 1;
      if (event.comeOut && event.pointAfter !== 0) {
        pointsSet += 1;
        assert.deepEqual(event.payoutBets, [], 'a point-setting roll invents no payout');
      }
      if (!event.comeOut && event.pointBefore !== 0 && event.total === event.pointBefore) {
        pointsMade += 1;
        assert.equal(event.pointAfter, 0, 'a made point returns the table to a come-out');
      }
      if (event.payoutBets.includes('dont-pass')) {
        darkWins += 1;
        assert.ok(
          event.retiredBets.includes('dont-pass'),
          'a winning one-decision Don’t Pass is retired for the rest of the shooter',
        );
      }
      if (event.lostBets.includes('hard-4') || event.lostBets.includes('hard-8')) {
        hardWayDecisions += 1;
        assert.ok(event.retiredBets.some((bet) => bet.startsWith('hard-')),
          'a lost hard way is retired rather than silently reparked');
      }
    }
    for (const hand of trace.hands) if (hand.boost) boostedHands += 1;
  }

  assert.equal(seats, MANIFEST.field.entrants);
  assert.ok(sevenOuts > 0, 'the field seven-outs');
  assert.ok(comeOutSevens > 0, 'the field sees a come-out seven');
  assert.ok(pointsSet > 0, 'points are established');
  assert.ok(pointsMade > 0, 'points are made');
  assert.ok(darkWins > 0, 'Don’t Pass collects');
  assert.ok(hardWayDecisions > 0, 'a hard way is decided');
  assert.ok(boostedHands > 0, 'the shooter profit boost fires');
});

test('the escalator doubles the wager on the documented shooter boundaries', () => {
  const tape = decodeCrapsReplayTape(MANIFEST);
  const deep = ALL_PLAYERS
    .map((p) => replayCrapsSeat(MANIFEST, p, tape))
    .sort((a, b) => b.hands.length - a.hands.length)[0];
  // Derived from CRAPS_REPLAY_ESCALATOR_SHOOTERS rather than restated: the boundary moved from
  // every 5 shooters to every 3 at the 2026-08-29 re-vendor, and a hardcoded pair of ordinals is
  // exactly what let the stale escalator sit here undetected until the ladder replay drifted.
  const every = Number(CRAPS_REPLAY_ESCALATOR_SHOOTERS);
  assert.ok(deep.hands.length > every, 'the fixture carries a run past the first escalation');
  assert.equal(deep.hands[0].multiplier, '1');
  for (let i = 0; i < deep.hands.length; i++) {
    assert.equal(
      deep.hands[i].multiplier,
      String(2n ** BigInt(Math.floor(i / every))),
      `shooter ${i} wagers 2^floor(${i}/${every})x the board`,
    );
  }
});

test('survival flips carry their real ordinal, including the shooter a lost flip never reached', () => {
  const tape = decodeCrapsReplayTape(MANIFEST);
  const lost = ALL_PLAYERS.filter((p) => p.survivals.some((s) => !s.survived));
  const won = ALL_PLAYERS.filter((p) => p.survivals.some((s) => s.survived));
  assert.ok(lost.length > 0 && won.length > 0, 'the fixture covers both outcomes');

  for (const raw of lost) {
    const player = validateCrapsReplayPlayer(raw);
    const failure = player.survivals.find((s) => !s.survived);
    // A LOST flip is thrown for the shooter the seat was trying to ENTER, so it sits at
    // handsPlayed — one past the last shooter it played — and leaves a zero ladder tail.
    assert.equal(failure.shooter, player.handsPlayed, 'a lost flip belongs to the unreached shooter');
    assert.equal(player.ladderWei.at(-1), '0');
    assert.equal(player.wonWei, '0');
    assert.equal(player.stop, 'bust');
    const trace = replayCrapsSeat(MANIFEST, raw, tape);
    assert.equal(trace.failedSurvival.survived, false);
    // The animation keeps the PRE-flip figure: the coin is thrown between shooters.
    assert.notEqual(trace.events.at(-1).bankrollAfterWei, '0');
  }

  for (const raw of won) {
    const player = validateCrapsReplayPlayer(raw);
    for (const flip of player.survivals.filter((s) => s.survived)) {
      assert.ok(flip.shooter < player.handsPlayed, 'a won flip is followed by a played shooter');
    }
    replayCrapsSeat(MANIFEST, raw, tape);
  }

  // A schedule claiming a flip the run never threw must fail closed rather than animate it.
  const forged = clone(won[0]);
  forged.survivals = [{ shooter: 0, survived: true }, ...forged.survivals]
    .filter((s, i, all) => all.findIndex((o) => o.shooter === s.shooter) === i)
    .sort((a, b) => a.shooter - b.shooter);
  assert.throws(() => replayCrapsSeat(MANIFEST, forged, tape), /survival|ladder/i);
});

test('boost schedules are the real draw, not an inference from the ladder', () => {
  const tape = decodeCrapsReplayTape(MANIFEST);
  const boosted = ALL_PLAYERS.find((p) => p.boosts.length > 0);
  assert.ok(boosted, 'the fixture carries a boosted seat');
  for (const boost of boosted.boosts) {
    assert.ok(boost.shooter < boosted.handsPlayed, 'a boost belongs to a shooter actually played');
    assert.ok(boost.percent >= 1 && boost.percent <= 100);
  }
  const trace = replayCrapsSeat(MANIFEST, boosted, tape);

  // Dropping a boost that actually PAID breaks the ladder. That is the point of tracing it at
  // source: the uplift is house money on eligible profit, and an eligible shooter that made no
  // profit adds nothing — so no arithmetic over the bankroll curve can recover the schedule.
  const paidABoost = trace.hands.some(
    (hand) => hand.boost && BigInt(hand.events.at(-1).boostWei) > 0n,
  );
  if (paidABoost) {
    const stripped = clone(boosted);
    stripped.boosts = [];
    assert.throws(() => replayCrapsSeat(MANIFEST, stripped, tape), /ladder/);
  }
});

test('blank chips == 0 tickets are scattered ten ways, never treated as missing', () => {
  const chipWei = BigInt(MANIFEST.terms.boardStakeWei) / 10n;
  for (const player of ALL_PLAYERS) {
    const board = player.resolvedBoardWei.map((wei) => BigInt(wei));
    const total = board.reduce((sum, wei) => sum + wei, 0n);
    // Ten chips, always — a named board keeps seven and takes three; a blank one takes all ten.
    assert.equal(total, BigInt(MANIFEST.terms.boardStakeWei));
    assert.equal(total / chipWei, 10n);
    assert.ok(board.some((wei) => wei > 0n), 'no seat plays an empty board');
  }
  // A blank ticket's ten scattered chips land on more legs than a submission could name.
  const widelyScattered = ALL_PLAYERS.filter(
    (p) => p.resolvedBoardWei.filter((wei) => BigInt(wei) > 0n).length >= 6,
  );
  assert.ok(widelyScattered.length > 0, 'the fixture carries widely scattered boards');

  const empty = clone(ALL_PLAYERS[0]);
  empty.resolvedBoardWei = new Array(10).fill('0');
  assert.throws(() => validateCrapsReplayPlayer(empty), /board cannot be empty/);
});

test('ladder drift fails closed instead of presenting plausible but wrong payouts', () => {
  const player = clone(SIM_CRAPS_REPLAY_FEATURED.players[0]);
  const decoded = [...validateCrapsReplayPlayer(player).ladderWei];
  decoded[1] = (BigInt(decoded[1]) + 1n).toString();
  player.ladder = encodeCrapsReplayLadder(decoded);
  assert.throws(
    () => replayCrapsSeat(SIM_CRAPS_REPLAY_MANIFEST, player),
    /missed the stored bankroll ladder/,
  );
});

test('adapter seats the viewer, excludes them from the opponent rack, and aligns opponent frames', () => {
  const featured = validateCrapsReplayCollection(SIM_CRAPS_REPLAY_FEATURED, MANIFEST);
  // Deliberately choose a viewer who IS a featured candidate: that is the case the four-wide
  // candidate row exists for — the viewer must be dropped and three OTHERS still shown.
  const viewerBetId = featured.leaderboard[0].betIds[0];
  const viewerRecord = clone(SIM_CRAPS_REPLAY_FEATURED.players.find((p) => p.betId === viewerBetId));
  assert.ok(viewerRecord, 'the viewer is inside the featured union');
  const rankByRoll = Array.from(
    { length: viewerRecord.totalRolls + 1 },
    (_, index) => 1 + (index % MANIFEST.field.entrants),
  );
  viewerRecord.rankTimeline = encodeCrapsReplayRankTimeline(rankByRoll);
  const viewer = validateCrapsReplayPlayer(viewerRecord);

  const options = createCrapsReplayTableModel({
    ...SIM_CRAPS_REPLAY_ARTIFACTS, viewer: viewerRecord,
  }).tableOptions;

  assert.equal(options.viewerBetId, viewerBetId);
  assert.equal(options.fieldEntrants, MANIFEST.field.entrants);
  assert.deepEqual(options.rankTimeline, rankByRoll,
    'the one viewer shard carries exact field position without loading every other shard');
  assert.equal(options.resolutionHands.length, viewer.totalRolls);
  assert.equal(Object.values(options.bets).reduce((sum, count) => sum + count, 0), 10);

  for (const row of options.leaderboardTimeline) {
    assert.ok(!row.opponentBetIds.includes(viewerBetId), 'the viewer never appears as an opponent');
    assert.ok(row.opponentBetIds.length <= 3, 'the rack shows three');
  }
  // Four candidates are exactly why the top row still fills three racks with the viewer in it.
  assert.equal(
    options.leaderboardTimeline[0].opponentBetIds.length,
    Math.min(3, featured.leaderboard[0].betIds.length - 1),
  );

  assert.ok(options.otherPlayers.length > 0);
  for (const opponent of options.otherPlayers) {
    assert.notEqual(opponent.betId, viewerBetId);
    assert.equal(opponent.resolution.rollEvents.length, options.resolutionHands.length,
      'opponent frames are aligned to the viewer timeline, roll for roll');
    assert.equal(opponent.resolution.bankrollsFlip.length, options.resolutionHands.length);
    assert.equal(opponent.resolution.shooterBoosts.length, MANIFEST.tape.maxHands);
  }

  // ONE WALLET, SEVERAL SEATS: they stay several visual players keyed by BET ID, never merged.
  const byWallet = new Map();
  for (const player of ALL_PLAYERS) {
    byWallet.set(player.player, (byWallet.get(player.player) ?? new Set()).add(player.betId));
  }
  const shared = [...byWallet.entries()].find(([, seats]) => seats.size > 1);
  assert.ok(shared, 'the fixture has one wallet holding several seats');
  const sharedRecords = ALL_PLAYERS.filter((p) => p.player === shared[0]);
  assert.equal(new Set(sharedRecords.map((p) => p.betId)).size, sharedRecords.length);

  assert.equal(options.replayEngineVersion, MANIFEST.ruleset.engineVersion);
  assert.equal(options.replayDigest, MANIFEST.digest);
});

test('the table consumer preserves every sealed frame and every authoritative payout list', async () => {
  const { createCrapsResolutionRun } = await import('../app-craps-table.js');
  const options = createCrapsReplayTableModel(SIM_CRAPS_REPLAY_ARTIFACTS).tableOptions;
  const run = createCrapsResolutionRun({
    startingBankrollFlip: options.bankrollFlip,
    goalFlip: options.goalFlip,
    hands: options.resolutionHands,
    rolls: options.rolls,
  });
  assert.equal(run.frames.length, options.resolutionHands.length,
    'an exact empty terminal cannot be replaced by an inferred mid-shooter goal or bust');
  assert.ok(run.frames.every((frame) => frame.payoutBetsExact),
    'including an empty list, every sealed payout list remains authoritative');
  assert.deepEqual(
    run.frames.map((frame) => [frame.shooter, frame.globalRoll, frame.payoutBets]),
    options.resolutionHands.map((frame) => [frame.shooter, frame.globalRoll, frame.payoutBets]),
  );
});

test('the progressive shows a winner to the winner and a dark pool to everyone else', () => {
  assert.equal(MANIFEST.progressive.status, 'won');
  const winnerBetId = MANIFEST.progressive.winnerBetId;
  assert.ok(winnerBetId, 'a won progressive names its winner');
  assert.ok(MANIFEST.progressive.wonAtScoreBps >= 1);

  const others = SIM_CRAPS_REPLAY_FEATURED.players.filter((p) => p.betId !== winnerBetId);
  assert.ok(others.length > 0);

  const asOther = createCrapsReplayTableModel({
    ...SIM_CRAPS_REPLAY_ARTIFACTS, viewer: others[0],
  }).tableOptions;
  assert.equal(asOther.jackpot.status, 'won-other',
    'another player took it: the viewer is ineligible and the pool renders dark');
  assert.equal(asOther.jackpot.thresholdScoreBps, MANIFEST.progressive.thresholdScoreBps);
  assert.equal(asOther.jackpot.wonAtScoreBps, MANIFEST.progressive.wonAtScoreBps);

  const winnerRecord = SIM_CRAPS_REPLAY_FEATURED.players.find((p) => p.betId === winnerBetId)
    ?? ALL_PLAYERS.find((p) => p.betId === winnerBetId);
  assert.ok(winnerRecord, 'the progressive winner is a seat in this field');
  const asWinner = createCrapsReplayTableModel({
    ...SIM_CRAPS_REPLAY_ARTIFACTS, viewer: winnerRecord,
  }).tableOptions;
  assert.equal(asWinner.jackpot.status, 'won-you');
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
  const viewer = SIM_CRAPS_REPLAY_VIEWER;
  const shardIndex = crapsReplayShardIndex(viewer.seat, MANIFEST.field.shardSize);
  const shardPath = SIM_CRAPS_REPLAY_PATHS.shards[shardIndex];
  const bodies = new Map([
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, SIM_CRAPS_REPLAY_MANIFEST],
    [SIM_CRAPS_REPLAY_PATHS.featured, SIM_CRAPS_REPLAY_FEATURED],
    [shardPath, SIM_CRAPS_REPLAY_SHARDS[shardIndex]],
  ]);
  const calls = new Map();
  const fetchImpl = async (path) => {
    calls.set(path, (calls.get(path) ?? 0) + 1);
    await Promise.resolve();
    const body = bodies.get(path);
    return { ok: body != null, status: body == null ? 404 : 200, json: async () => clone(body) };
  };
  const request = {
    battleKey: SIM_CRAPS_REPLAY_POINTER.battleKey,
    viewerBetId: viewer.betId,
    fetchImpl,
  };
  const [first, second] = await Promise.all([loadCrapsReplay(request), loadCrapsReplay(request)]);
  assert.equal(first.viewer.betId, viewer.betId);
  assert.equal(second.ready, true);
  // A normal load touches FOUR objects: pointer, manifest, featured union, one seat shard.
  assert.equal(calls.size, 4, 'no other object is fetched');
  assert.equal(calls.get(SIM_CRAPS_REPLAY_PATHS.pointer), 2, 'mutable readiness is rechecked');
  assert.equal(calls.get(SIM_CRAPS_REPLAY_PATHS.manifest), 1);
  assert.equal(calls.get(SIM_CRAPS_REPLAY_PATHS.featured), 1);
  assert.equal(calls.get(shardPath), 1);
  __resetCrapsReplayLoaderForTest();

  // A non-ready pointer stops the load before any immutable request is made.
  const settlingCalls = new Map();
  const settling = { ...clone(SIM_CRAPS_REPLAY_POINTER), status: 'settling', resolved: 1 };
  delete settling.digest;
  delete settling.manifestPath;
  const result = await loadCrapsReplay({
    ...request,
    fetchImpl: async (path) => {
      settlingCalls.set(path, (settlingCalls.get(path) ?? 0) + 1);
      return { ok: true, status: 200, json: async () => clone(settling) };
    },
  });
  assert.equal(result.ready, false);
  assert.equal(result.pointer.status, 'settling');
  assert.equal(settlingCalls.size, 1, 'a settling battle fetches the pointer and nothing else');
  __resetCrapsReplayLoaderForTest();
});
