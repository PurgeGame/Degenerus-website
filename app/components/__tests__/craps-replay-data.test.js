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
import { readFileSync } from 'node:fs';
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
  crapsReplayBattleAward,
  crapsReplayPrizeAmounts,
  loadCrapsReplayProfiles,
  normalizeCrapsReplayShooters,
  openCrapsReplayTable,
  protocolSeatLabel,
} from '../../craps/replay-adapter.js';
import { CONTRACTS } from '../../app/chain-config.js';
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
const REPLAY_DEPLOYMENT = Object.freeze({
  chainId: MANIFEST.ruleset.chainId,
  contract: MANIFEST.ruleset.contract,
});
const ALL_PLAYERS = SIM_CRAPS_REPLAY_SHARDS.flatMap((shard) => shard.players);
const RUN_44_CRAPS_RUNTIME_HASH = '0xde6033ca6191100bd7803a214cbdc9a3bc0c5e8446948158c2da2061d47cf796';
const RUN_47_CRAPS_RUNTIME_HASH = '0x45c30da17eafd909ee1b8806745f0efe519814a8bde8a1a2bb1b153c017bec42';
const CURRENT_CRAPS_RUNTIME_HASH = '0x4daa99994b751204ddd189f133e57e4586b2a8d91047a788031f247e37065a57';

function contestedHighRollerFixture() {
  const existing = clone(ALL_PLAYERS.find((player) => player.entryMultiple > 1));
  const featuredIds = new Set(SIM_CRAPS_REPLAY_FEATURED.players.map((player) => player.betId));
  const promoted = clone(ALL_PLAYERS.find((player) => (
    player.entryMultiple === 1
    && !featuredIds.has(player.betId)
    && crapsReplayShardIndex(player.seat, MANIFEST.field.shardSize)
      !== crapsReplayShardIndex(existing.seat, MANIFEST.field.shardSize)
  )));
  const validated = validateCrapsReplayPlayer(promoted);
  promoted.entryMultiple = existing.entryMultiple;
  promoted.wonWei = (
    BigInt(validated.ladderWei.at(-1)) * BigInt(promoted.entryMultiple)
  ).toString();
  return { existing, promoted };
}

test('the differentially verified run-44 Craps runtime is explicitly replayable', () => {
  const manifest = clone(SIM_CRAPS_REPLAY_MANIFEST);
  manifest.ruleset.runtimeCodeHash = RUN_44_CRAPS_RUNTIME_HASH;
  assert.equal(
    assertSupportedCrapsReplayRuleset(manifest).ruleset.runtimeCodeHash,
    RUN_44_CRAPS_RUNTIME_HASH,
  );
});

test('the differentially verified run-47 Craps runtime is explicitly replayable', () => {
  const manifest = clone(SIM_CRAPS_REPLAY_MANIFEST);
  manifest.ruleset.contract = CONTRACTS.CRAPS;
  manifest.ruleset.runtimeCodeHash = RUN_47_CRAPS_RUNTIME_HASH;
  assert.equal(
    assertSupportedCrapsReplayRuleset(manifest).ruleset.runtimeCodeHash,
    RUN_47_CRAPS_RUNTIME_HASH,
  );
});

test('the differentially verified current Craps runtime is explicitly replayable', () => {
  const manifest = clone(SIM_CRAPS_REPLAY_MANIFEST);
  manifest.ruleset.contract = CONTRACTS.CRAPS;
  manifest.ruleset.runtimeCodeHash = CURRENT_CRAPS_RUNTIME_HASH;
  assert.equal(
    assertSupportedCrapsReplayRuleset(manifest).ruleset.runtimeCodeHash,
    CURRENT_CRAPS_RUNTIME_HASH,
  );
});

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

test('replay paths namespace a reused battle key by chain and Craps deployment', () => {
  const deployment = MANIFEST.ruleset;
  const nextContract = `0x${'ef'.repeat(20)}`;
  const scopedPointer = crapsReplayPointerPath(MANIFEST.battleKey, deployment);
  const nextPointer = crapsReplayPointerPath(MANIFEST.battleKey, {
    chainId: deployment.chainId,
    contract: nextContract,
  });
  const scopedArtifacts = crapsReplayArtifactPaths(MANIFEST.battleKey, MANIFEST.digest, deployment);

  assert.equal(
    scopedPointer,
    `/craps/replays/v1/chains/${deployment.chainId}/contracts/${deployment.contract}`
      + `/battles/${MANIFEST.battleKey}/latest.json`,
  );
  assert.notEqual(scopedPointer, crapsReplayPointerPath(MANIFEST.battleKey),
    'the rollout-only legacy pointer is not the canonical deployment namespace');
  assert.notEqual(scopedPointer, nextPointer,
    'the same scheduled battle key cannot collide across Craps contracts');
  assert.equal(scopedArtifacts.manifest,
    scopedPointer.replace('/latest.json', `/results/${MANIFEST.digest}/manifest.json`));
  assert.throws(
    () => crapsReplayPointerPath(MANIFEST.battleKey, { chainId: 0, contract: deployment.contract }),
    /chainId/,
  );
  assert.throws(
    () => crapsReplayPointerPath(MANIFEST.battleKey, { chainId: deployment.chainId, contract: 'bad' }),
    /contract/,
  );
});

test('loader selects the requested deployment when two contracts reuse a battle key', async () => {
  __resetCrapsReplayLoaderForTest();
  const viewer = SIM_CRAPS_REPLAY_VIEWER;
  const deployment = MANIFEST.ruleset;
  const legacyContract = `0x${'ef'.repeat(20)}`;
  const shardIndex = crapsReplayShardIndex(viewer.seat, MANIFEST.field.shardSize);
  const scoped = `/craps/replays/v1/chains/${deployment.chainId}/contracts/${deployment.contract}`
    + `/battles/${MANIFEST.battleKey}`;
  const scopedBase = `${scoped}/results/${MANIFEST.digest}`;
  const currentManifest = clone(SIM_CRAPS_REPLAY_MANIFEST);
  currentManifest.field.featuredPath = `${scopedBase}/featured.json`;
  currentManifest.field.shardPathTemplate = `${scopedBase}/seats/{shard}.json`;
  const currentPointer = {
    ...clone(SIM_CRAPS_REPLAY_POINTER),
    manifestPath: `${scopedBase}/manifest.json`,
  };
  const legacyManifest = clone(SIM_CRAPS_REPLAY_MANIFEST);
  legacyManifest.ruleset.contract = legacyContract;
  const bodies = new Map([
    [`${scoped}/latest.json`, currentPointer],
    [`${scopedBase}/manifest.json`, currentManifest],
    [`${scopedBase}/featured.json`, SIM_CRAPS_REPLAY_FEATURED],
    [`${scopedBase}/seats/${String(shardIndex).padStart(4, '0')}.json`, SIM_CRAPS_REPLAY_SHARDS[shardIndex]],
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, legacyManifest],
    [SIM_CRAPS_REPLAY_PATHS.featured, SIM_CRAPS_REPLAY_FEATURED],
    [SIM_CRAPS_REPLAY_PATHS.shards[shardIndex], SIM_CRAPS_REPLAY_SHARDS[shardIndex]],
  ]);
  const calls = [];

  const loaded = await loadCrapsReplay({
    battleKey: MANIFEST.battleKey,
    viewerBetId: viewer.betId,
    chainId: deployment.chainId,
    contract: deployment.contract,
    fetchImpl: async (path) => {
      calls.push(path);
      const body = bodies.get(path);
      return { ok: body != null, status: body == null ? 404 : 200, json: async () => clone(body) };
    },
  });

  assert.equal(loaded.manifest.ruleset.contract, deployment.contract);
  assert.equal(calls[0], `${scoped}/latest.json`);
  assert.equal(calls.includes(SIM_CRAPS_REPLAY_PATHS.pointer), false,
    'a present scoped pointer never consults a colliding legacy pointer');
  __resetCrapsReplayLoaderForTest();
});

test('rollout fallback accepts only a legacy manifest for the requested deployment', async () => {
  const viewer = SIM_CRAPS_REPLAY_VIEWER;
  const deployment = MANIFEST.ruleset;
  const shardIndex = crapsReplayShardIndex(viewer.seat, MANIFEST.field.shardSize);
  const scopedPointer = crapsReplayPointerPath(MANIFEST.battleKey, deployment);
  const matchingBodies = new Map([
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, SIM_CRAPS_REPLAY_MANIFEST],
    [SIM_CRAPS_REPLAY_PATHS.featured, SIM_CRAPS_REPLAY_FEATURED],
    [SIM_CRAPS_REPLAY_PATHS.shards[shardIndex], SIM_CRAPS_REPLAY_SHARDS[shardIndex]],
  ]);
  const matchingCalls = [];
  const request = {
    battleKey: MANIFEST.battleKey,
    viewerBetId: viewer.betId,
    chainId: deployment.chainId,
    contract: deployment.contract,
  };

  __resetCrapsReplayLoaderForTest();
  const loaded = await loadCrapsReplay({
    ...request,
    fetchImpl: async (path) => {
      matchingCalls.push(path);
      const body = matchingBodies.get(path);
      return { ok: body != null, status: body == null ? 404 : 200, json: async () => clone(body) };
    },
  });
  assert.equal(loaded.ready, true);
  assert.deepEqual(matchingCalls.slice(0, 2), [scopedPointer, SIM_CRAPS_REPLAY_PATHS.pointer]);

  __resetCrapsReplayLoaderForTest();
  const collidingManifest = clone(SIM_CRAPS_REPLAY_MANIFEST);
  collidingManifest.ruleset.contract = `0x${'ef'.repeat(20)}`;
  const collidingBodies = new Map([
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, collidingManifest],
  ]);
  await assert.rejects(
    loadCrapsReplay({
      ...request,
      fetchImpl: async (path) => {
        const body = collidingBodies.get(path);
        return { ok: body != null, status: body == null ? 404 : 200, json: async () => clone(body) };
      },
    }),
    (error) => error?.name === 'CrapsReplayLegacyDeploymentMismatchError',
    'another deployment\'s legacy pointer remains retryable while scoped producer objects arrive',
  );
  __resetCrapsReplayLoaderForTest();
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
    assert.ok(row.betIds.length <= 11, 'at most eleven candidates per shooter');
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

test('older replay bundles recover bounty and added totals from the finalized pot', () => {
  const wei = 10n ** 18n;
  assert.deepEqual(crapsReplayPrizeAmounts({
    bountyPoolWei: null,
    addedFlipWei: null,
    settledMainPotWei: 84_900n * wei,
    battleStakeWei: 300n * wei,
    entrants: 33,
  }), {
    bountyPoolWei: (84_900n * wei).toString(),
    addedFlipWei: (75_000n * wei).toString(),
    bountyPoolScope: 'main',
  });

  assert.deepEqual(crapsReplayPrizeAmounts({
    bountyPoolWei: 90_000n * wei,
    addedFlipWei: 80_000n * wei,
    settledMainPotWei: 84_900n * wei,
    battleStakeWei: 300n * wei,
    entrants: 33,
  }), {
    bountyPoolWei: (90_000n * wei).toString(),
    addedFlipWei: (80_000n * wei).toString(),
    bountyPoolScope: 'whole',
  }, 'sealed exact totals take precedence over the live compatibility fallback');
});

test('battle award uses the paid event without adding it to the replay bankroll', () => {
  const wei = 10n ** 18n;
  const viewer = '0xaA00000000000000000000000000000000000001';
  const winner = viewer.toLowerCase();
  assert.deepEqual(crapsReplayBattleAward({
    viewer,
    winner,
    payoutWei: 84_900n * wei,
    battleStakeWei: 300n * wei,
    entrants: 33,
    winningStop: 0,
  }), {
    battleWinner: winner,
    battleWonByViewer: true,
    battlePayoutWei: (84_900n * wei).toString(),
    battleBoostWei: (75_000n * wei).toString(),
    battleWinningStop: 0,
  }, 'last-standing winners receive the exact chain payout and its boost component');

  assert.deepEqual(crapsReplayBattleAward({
    viewer,
    winner: '0xbb00000000000000000000000000000000000002',
    payoutWei: 2_000n,
  }), {
    battleWinner: '0xbb00000000000000000000000000000000000002',
    battleWonByViewer: false,
    battlePayoutWei: '2000',
    battleBoostWei: null,
    battleWinningStop: null,
  }, 'another winner never triggers the local receipt or invents a stop reason');

  assert.equal(crapsReplayBattleAward({
    viewer,
    winner: viewer,
    viewerBetId: '41',
    winnerBetId: '42',
  }).battleWonByViewer, false,
  'two seats owned by one wallet are not both declared the battle winner');
});

test('Discord identities load in endpoint-sized batches without one failure blanking every rack', async () => {
  const addresses = Array.from(
    { length: 18 },
    (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}`,
  );
  const batches = [];
  const profiles = await loadCrapsReplayProfiles(addresses, async (batch) => {
    batches.push([...batch]);
    if (batches.length === 2) throw new Error('temporary profile outage');
    return new Map(batch.map((address) => [address, {
      name: `Discord ${address.slice(-2)}`,
      avatar: `https://cdn.discordapp.com/avatars/${address.slice(-2)}.png`,
    }]));
  });
  assert.deepEqual(batches.map((batch) => batch.length), [8, 8, 2]);
  assert.equal(profiles.size, 10);
  assert.equal(profiles.get(addresses[0])?.name, 'Discord 01');
  assert.equal(profiles.has(addresses[8]), false);
  assert.equal(profiles.get(addresses[17])?.name, 'Discord 12');
});

test('replay opening carries repaired prizes, the paid battle receipt, and live identities into the table', async () => {
  __resetCrapsReplayLoaderForTest();
  const viewer = SIM_CRAPS_REPLAY_VIEWER;
  const viewerShard = crapsReplayShardIndex(viewer.seat, MANIFEST.field.shardSize);
  const bodies = new Map([
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, SIM_CRAPS_REPLAY_MANIFEST],
    [SIM_CRAPS_REPLAY_PATHS.featured, SIM_CRAPS_REPLAY_FEATURED],
    [SIM_CRAPS_REPLAY_PATHS.shards[viewerShard], SIM_CRAPS_REPLAY_SHARDS[viewerShard]],
  ]);
  const opened = [];
  const profileBatchSizes = [];
  const settlementReads = [];
  const settledMainPotWei = 84_900n * 10n ** 18n;
  await openCrapsReplayTable({ open: (options) => opened.push(options) }, {
    ...REPLAY_DEPLOYMENT,
    battleKey: SIM_CRAPS_REPLAY_POINTER.battleKey,
    viewerBetId: viewer.betId,
    settledMainPotWei,
    battleWinner: viewer.player,
    battleWinnerBetId: viewer.betId,
    battlePayoutWei: settledMainPotWei,
    battleWinningStop: 1,
    bonusMultiplier: 10,
    loadSettlementWord: async (index) => {
      settlementReads.push(index);
      return 5n;
    },
    fetchImpl: async (path) => ({
      ok: bodies.has(path),
      status: bodies.has(path) ? 200 : 404,
      json: async () => clone(bodies.get(path)),
    }),
    loadProfiles: async (addresses) => {
      profileBatchSizes.push(addresses.length);
      return new Map(addresses.map((address) => [address, {
        name: `Discord ${address.slice(-4)}`,
        avatar: `https://cdn.discordapp.com/avatars/${address.slice(-4)}.png`,
      }]));
    },
  });

  assert.equal(opened.length, 1);
  const options = opened[0];
  const expectedAddedWei = settledMainPotWei
    - BigInt(MANIFEST.terms.battleStakeWei) * BigInt(MANIFEST.field.entrants);
  assert.ok(profileBatchSizes.length >= 1, 'the replay opener requests the featured identity union');
  assert.ok(profileBatchSizes.every((size) => size <= 8));
  assert.equal(options.bountyPoolWei, settledMainPotWei.toString());
  assert.equal(options.bountyPoolScope, 'main');
  assert.equal(options.addedFlipWei, expectedAddedWei.toString());
  assert.equal(options.battleWonByViewer, true);
  assert.equal(options.battleWinnerBetId, viewer.betId);
  assert.equal(options.battlePayoutWei, settledMainPotWei.toString());
  assert.equal(options.battleBoostWei, options.addedFlipWei);
  assert.equal(options.battleWinningStop, 1);
  assert.equal(options.bonusMultiplier, 10,
    'the authoritative boost rung survives the replay adapter');
  assert.deepEqual(settlementReads, [],
    'an explicit valid rung does not add a redundant storage read');
  assert.ok(options.otherPlayers.every((player) => player.label.startsWith('Discord ')));
  assert.ok(options.otherPlayers.every((player) => player.discordPfp?.startsWith('https://')));

  const watched = options.otherPlayers[0];
  assert.equal(typeof options.onPerspectiveSelect, 'function');
  assert.equal(options.onPerspectiveSelect({
    betId: watched.betId,
    resumeResolutionIndex: 7,
    autoRoll: false,
  }), true);
  assert.equal(opened.length, 2, 'switching perspective reopens from the verified in-memory model');
  const watchedOptions = opened[1];
  assert.equal(watchedOptions.viewerBetId, watched.betId);
  assert.equal(watchedOptions.originalViewerBetId, viewer.betId);
  assert.equal(watchedOptions.resumeResolutionIndex, 7);
  assert.equal(watchedOptions.autoRoll, false);
  assert.equal(watchedOptions.battleWonByViewer, false,
    'the exact winning seat does not follow the camera');
  assert.ok(watchedOptions.otherPlayers.some((player) => player.betId === viewer.betId),
    'the original player remains available to click back to');
  assert.equal(watchedOptions.onPerspectiveSelect({
    betId: viewer.betId,
    resumeResolutionIndex: 8,
    autoRoll: true,
  }), true);
  assert.equal(opened[2].viewerBetId, viewer.betId, 'the same control switches back to YOU');
  assert.equal(opened[2].resumeResolutionIndex, 8);
  assert.equal(options.onPerspectiveSelect({ betId: '999999999999999999999' }), false,
    'a click cannot escape the already verified viewport');
  __resetCrapsReplayLoaderForTest();
});

test('a Dice Run record replay recovers its sealed bonus rung before opening', async () => {
  __resetCrapsReplayLoaderForTest();
  const viewer = SIM_CRAPS_REPLAY_VIEWER;
  const viewerShard = crapsReplayShardIndex(viewer.seat, MANIFEST.field.shardSize);
  const bodies = new Map([
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, SIM_CRAPS_REPLAY_MANIFEST],
    [SIM_CRAPS_REPLAY_PATHS.featured, SIM_CRAPS_REPLAY_FEATURED],
    [SIM_CRAPS_REPLAY_PATHS.shards[viewerShard], SIM_CRAPS_REPLAY_SHARDS[viewerShard]],
  ]);
  const opened = [];
  const readIndexes = [];

  await openCrapsReplayTable({ open: (options) => opened.push(options) }, {
    ...REPLAY_DEPLOYMENT,
    battleKey: SIM_CRAPS_REPLAY_POINTER.battleKey,
    viewerBetId: viewer.betId,
    settledMainPotWei: 84_900n * 10n ** 18n,
    fetchImpl: async (path) => ({
      ok: bodies.has(path),
      status: bodies.has(path) ? 200 : 404,
      json: async () => clone(bodies.get(path)),
    }),
    loadProfiles: async () => new Map(),
    loadSettlementWord: async (index) => {
      readIndexes.push(String(index));
      return 5n;
    },
  });

  assert.deepEqual(readIndexes, [MANIFEST.settlement.boundIndex],
    'metadata-poor replay launchers recover the immutable word at the manifest-bound index');
  assert.equal(opened[0]?.bonusMultiplier, 1,
    'the shared opener derives the exact contract rung instead of skipping the pre-roll reveal');
  __resetCrapsReplayLoaderForTest();
});

test('a settlement-word outage degrades without blocking a verified replay', async () => {
  __resetCrapsReplayLoaderForTest();
  const viewer = SIM_CRAPS_REPLAY_VIEWER;
  const viewerShard = crapsReplayShardIndex(viewer.seat, MANIFEST.field.shardSize);
  const bodies = new Map([
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, SIM_CRAPS_REPLAY_MANIFEST],
    [SIM_CRAPS_REPLAY_PATHS.featured, SIM_CRAPS_REPLAY_FEATURED],
    [SIM_CRAPS_REPLAY_PATHS.shards[viewerShard], SIM_CRAPS_REPLAY_SHARDS[viewerShard]],
  ]);
  const opened = [];

  await openCrapsReplayTable({ open: (options) => opened.push(options) }, {
    ...REPLAY_DEPLOYMENT,
    battleKey: SIM_CRAPS_REPLAY_POINTER.battleKey,
    viewerBetId: viewer.betId,
    settledMainPotWei: 84_900n * 10n ** 18n,
    fetchImpl: async (path) => ({
      ok: bodies.has(path),
      status: bodies.has(path) ? 200 : 404,
      json: async () => clone(bodies.get(path)),
    }),
    loadProfiles: async () => new Map(),
    loadSettlementWord: async () => { throw new Error('temporary RPC outage'); },
  });

  assert.equal(opened.length, 1, 'word recovery is presentation-only and cannot block the replay');
  assert.equal(Object.hasOwn(opened[0], 'bonusMultiplier'), false,
    'an unavailable word never invents a multiplier');
  __resetCrapsReplayLoaderForTest();
});

test('a contested High Roller replay runs its exact side field before the main battle', async () => {
  __resetCrapsReplayLoaderForTest();
  const { existing: viewer, promoted: rival } = contestedHighRollerFixture();
  const viewerShardIndex = crapsReplayShardIndex(viewer.seat, MANIFEST.field.shardSize);
  const rivalShardIndex = crapsReplayShardIndex(rival.seat, MANIFEST.field.shardSize);
  const rivalShard = clone(SIM_CRAPS_REPLAY_SHARDS[rivalShardIndex]);
  const rivalIndex = rivalShard.players.findIndex((player) => player.betId === rival.betId);
  rivalShard.players[rivalIndex] = rival;
  const bodies = new Map([
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, SIM_CRAPS_REPLAY_MANIFEST],
    [SIM_CRAPS_REPLAY_PATHS.featured, SIM_CRAPS_REPLAY_FEATURED],
    [SIM_CRAPS_REPLAY_PATHS.shards[viewerShardIndex], SIM_CRAPS_REPLAY_SHARDS[viewerShardIndex]],
    [SIM_CRAPS_REPLAY_PATHS.shards[rivalShardIndex], rivalShard],
  ]);
  const opened = [];
  const acknowledged = () => {};
  const mainWinner = SIM_CRAPS_REPLAY_FEATURED.players[0];
  const highPayoutWei = (8_000n * 10n ** 18n).toString();

  const loaded = await openCrapsReplayTable({ open: (options) => opened.push(options) }, {
    ...REPLAY_DEPLOYMENT,
    battleKey: SIM_CRAPS_REPLAY_POINTER.battleKey,
    viewerBetId: viewer.betId,
    highRollerBetIds: [viewer.betId, rival.betId],
    highRollerEntrants: 2,
    highWinnerBetId: rival.betId,
    highWinner: rival.player,
    highPayoutWei,
    highBankrollRider: false,
    battleWinnerBetId: mainWinner.betId,
    battleWinner: mainWinner.player,
    battlePayoutWei: '9000',
    onResolutionAcknowledged: acknowledged,
    fetchImpl: async (path) => ({
      ok: bodies.has(path),
      status: bodies.has(path) ? 200 : 404,
      json: async () => clone(bodies.get(path)),
    }),
    loadProfiles: async () => new Map(),
  });

  assert.equal(loaded.ready, true);
  assert.deepEqual(loaded.highRollers.map((player) => player.betId), [viewer.betId, rival.betId]);
  assert.equal(opened.length, 1);
  const high = opened[0];
  assert.equal(high.replayLane, 'high');
  assert.equal(high.entryLabel, 'HIGH ROLLER BATTLE');
  assert.equal(high.fieldEntrants, 2);
  assert.equal(high.viewerBetId, viewer.betId);
  assert.deepEqual(high.otherPlayers.map((player) => player.betId), [rival.betId]);
  assert.equal(high.battleWinnerBetId, rival.betId);
  assert.equal(high.battlePayoutWei, highPayoutWei);
  assert.equal(high.onResolutionAcknowledged, undefined,
    'the side round cannot retire the Pending receipt');
  assert.equal(typeof high.onResolutionPhaseComplete, 'function');

  assert.equal(high.onResolutionPhaseComplete({ autoRoll: false }), true);
  assert.equal(opened.length, 2, 'the High Roller winner advances the presentation to the main battle');
  const main = opened[1];
  assert.equal(main.replayLane, 'main');
  assert.equal(main.entryLabel, 'MAIN BATTLE');
  assert.equal(main.fieldEntrants, MANIFEST.field.entrants);
  assert.ok(main.otherPlayers.some((player) => player.entryMultiple === 1),
    'the main phase restores Normal entrants');
  assert.equal(main.battleWinnerBetId, mainWinner.betId);
  assert.equal(main.onResolutionPhaseComplete, undefined);
  assert.equal(main.onResolutionAcknowledged, acknowledged,
    'only the completed main battle may retire the Pending receipt');
  assert.equal(main.autoRoll, false);
  __resetCrapsReplayLoaderForTest();
});

test('a missing optional High Roller shard falls back to the complete main replay', async () => {
  __resetCrapsReplayLoaderForTest();
  const { existing: viewer, promoted: rival } = contestedHighRollerFixture();
  const viewerShardIndex = crapsReplayShardIndex(viewer.seat, MANIFEST.field.shardSize);
  const rivalShardIndex = crapsReplayShardIndex(rival.seat, MANIFEST.field.shardSize);
  const bodies = new Map([
    [SIM_CRAPS_REPLAY_PATHS.pointer, SIM_CRAPS_REPLAY_POINTER],
    [SIM_CRAPS_REPLAY_PATHS.manifest, SIM_CRAPS_REPLAY_MANIFEST],
    [SIM_CRAPS_REPLAY_PATHS.featured, SIM_CRAPS_REPLAY_FEATURED],
    [SIM_CRAPS_REPLAY_PATHS.shards[viewerShardIndex], SIM_CRAPS_REPLAY_SHARDS[viewerShardIndex]],
  ]);
  const opened = [];
  const degraded = [];

  const loaded = await openCrapsReplayTable({ open: (options) => opened.push(options) }, {
    ...REPLAY_DEPLOYMENT,
    battleKey: SIM_CRAPS_REPLAY_POINTER.battleKey,
    viewerBetId: viewer.betId,
    highRollerBetIds: [viewer.betId, rival.betId],
    highRollerEntrants: 2,
    highWinnerBetId: rival.betId,
    highWinner: rival.player,
    highPayoutWei: (8_000n * 10n ** 18n).toString(),
    highBankrollRider: false,
    fetchImpl: async (path) => ({
      ok: bodies.has(path),
      status: bodies.has(path)
        ? 200
        : path === crapsReplayPointerPath(MANIFEST.battleKey, REPLAY_DEPLOYMENT) ? 404 : 503,
      json: async () => clone(bodies.get(path)),
    }),
    loadProfiles: async () => new Map(),
    onReplayDegraded: (error) => degraded.push(error),
  });

  assert.equal(loaded.ready, true);
  assert.equal(loaded.highRollerFallback, true);
  assert.deepEqual(loaded.highRollers, []);
  assert.equal(degraded.length, 1, 'the launcher can report the optional side-lane failure');
  assert.match(degraded[0]?.message ?? '', /HTTP 503/);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].replayLane, 'main',
    'an unavailable side-lane shard cannot block the viewer\'s complete main replay');
  assert.equal(Object.hasOwn(opened[0], 'onReplayDegraded'), false,
    'diagnostic callbacks are adapter-only and never leak into the table model');
  __resetCrapsReplayLoaderForTest();
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
  // Deliberately choose a viewer who IS a featured candidate: candidate rows include one
  // spare seat so the viewer can be dropped without shrinking the rival viewport.
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
  assert.deepEqual(options.viewerResult, {
    stop: viewer.stop,
    handsPlayed: viewer.handsPlayed,
    rawEndingFlip: (BigInt(viewer.ladderWei.at(-1)) / (10n ** 18n)).toString(),
    highPointFlip: (viewer.ladderWei.reduce((highest, amount) => (
      BigInt(amount) > highest ? BigInt(amount) : highest
    ), 0n) / (10n ** 18n)).toString(),
    standing: viewer.standing,
    runPayoutWei: viewer.paidWei,
  });
  assert.equal(options.fieldEntrants, MANIFEST.field.entrants);
  assert.deepEqual(options.rankTimeline, rankByRoll,
    'the one viewer shard carries exact field position without loading every other shard');
  const battleRolls = Math.max(viewer.totalRolls, ...featured.players.map((player) => player.totalRolls));
  assert.equal(options.resolutionHands.length, battleRolls,
    'the shared replay lasts through the final tracked battle closeout');
  assert.ok(options.resolutionHands.length > viewer.totalRolls,
    'an early viewer exit does not cut off the visible top-ten battle');
  assert.equal(options.resolutionHands[viewer.totalRolls - 1].terminal, '',
    'the personal terminal does not stop the shared table clock');
  assert.equal(options.resolutionHands[viewer.totalRolls].viewerClosed, true);
  assert.equal(options.resolutionHands.at(-1).terminal, viewer.stop,
    'the viewer outcome is restored only when the battle presentation finishes');
  assert.equal(Object.values(options.bets).reduce((sum, count) => sum + count, 0), 10);

  for (const row of options.leaderboardTimeline) {
    assert.ok(!row.opponentBetIds.includes(viewerBetId), 'the viewer never appears as an opponent');
    assert.ok(row.opponentBetIds.length <= 10, 'the rack exposes at most ten rivals');
  }
  // The legacy fixture is four-wide; future bundles may publish eleven candidates for ten rivals.
  assert.equal(
    options.leaderboardTimeline[0].opponentBetIds.length,
    Math.min(10, featured.leaderboard[0].betIds.length - 1),
  );

  assert.ok(options.otherPlayers.length > 0);
  const sealedByBet = new Map(ALL_PLAYERS.map((p) => [p.betId, p]));
  for (const opponent of options.otherPlayers) {
    assert.notEqual(opponent.betId, viewerBetId);
    assert.equal(opponent.resolution.rollEvents.length, options.resolutionHands.length,
      'opponent frames are aligned to the full shared battle timeline, roll for roll');
    assert.equal(opponent.resolution.bankrollsFlip.length, options.resolutionHands.length);
    assert.equal(opponent.resolution.handsPlayed, sealedByBet.get(opponent.betId).handsPlayed);
    assert.equal(opponent.resolution.standing, sealedByBet.get(opponent.betId).standing);
    assert.equal(opponent.resolution.rawEndingFlip,
      (BigInt(sealedByBet.get(opponent.betId).wonWei) / BigInt(sealedByBet.get(opponent.betId).entryMultiple) / (10n ** 18n)).toString());
    assert.equal(opponent.resolution.shooterBoosts.length, MANIFEST.tape.maxHands);
    assert.equal(opponent.resolution.survivals.length, MANIFEST.tape.maxHands);
    assert.deepEqual(
      opponent.resolution.survivals.flatMap((flip, shooter) => (
        flip ? [{ shooter: shooter + 1, survived: flip.survived }] : []
      )),
      (sealedByBet.get(opponent.betId).survivals ?? []).map(({ shooter, survived }) => ({ shooter, survived })),
      'the rack coin schedule is the sealed survival list, indexed by the shooter that just ended',
    );
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

test('a featured seat can become the complete replay perspective without dropping the original viewer', () => {
  const original = validateCrapsReplayPlayer(SIM_CRAPS_REPLAY_ARTIFACTS.viewer);
  const selected = SIM_CRAPS_REPLAY_FEATURED.players.find((player) => player.betId !== original.betId);
  assert.ok(selected, 'the fixture has a featured perspective distinct from the original viewer');

  const switched = createCrapsReplayTableModel(SIM_CRAPS_REPLAY_ARTIFACTS, {
    perspectiveBetId: selected.betId,
  });
  const options = switched.tableOptions;
  assert.equal(options.viewerBetId, selected.betId);
  assert.equal(options.originalViewerBetId, original.betId);
  assert.equal(options.bankrollFlip, (BigInt(selected.bankrollInWei) / (10n ** 18n)).toString());
  assert.equal(options.goalFlip, (BigInt(selected.goalWei) / (10n ** 18n)).toString());
  assert.deepEqual(options.bets, createCrapsReplayTableModel({
    ...SIM_CRAPS_REPLAY_ARTIFACTS,
    viewer: selected,
  }).tableOptions.bets, 'the selected player owns the local felt placements');
  assert.ok(options.resolutionHands.length > 0, 'the selected player owns a complete frame timeline');
  assert.ok(options.otherPlayers.some((player) => player.betId === original.betId),
    'the original viewer moves into the opponent list');
  assert.ok(!options.otherPlayers.some((player) => player.betId === selected.betId),
    'the selected player is no longer duplicated as an opponent');
});

test('a goal-completing perspective carries its exact credited run payout into the table', () => {
  const goalWinner = SIM_CRAPS_REPLAY_FEATURED.players.find((player) => (
    player.stop === 'goal' && BigInt(player.paidWei) > 0n
  ));
  assert.ok(goalWinner, 'the production fixture includes a paid goal completion');
  const options = createCrapsReplayTableModel(SIM_CRAPS_REPLAY_ARTIFACTS, {
    perspectiveBetId: goalWinner.betId,
  }).tableOptions;
  assert.equal(options.viewerResult.stop, 'goal');
  assert.equal(options.viewerResult.runPayoutWei, goalWinner.paidWei,
    'the sealed CrapsBetSettled credit reaches the final result without being replaced by the bounty');

  const defaultOptions = createCrapsReplayTableModel(SIM_CRAPS_REPLAY_ARTIFACTS).tableOptions;
  const paidOpponent = defaultOptions.otherPlayers.find((player) => (
    player.resolution.type === 'cashout' && BigInt(player.resolution.runPayoutWei ?? 0) > 0n
  ));
  assert.ok(paidOpponent, 'the featured viewport includes a paid goal opponent');
  const sealedOpponent = SIM_CRAPS_REPLAY_FEATURED.players.find((player) => (
    player.betId === paidOpponent.betId
  ));
  assert.equal(paidOpponent.resolution.runPayoutWei, sealedOpponent.paidWei,
    'a winning Top 10 opponent carries the same exact run credit for its separate RUN number');
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

test('live Discord identity overlays the sealed seat labels, and an outage keeps them', () => {
  const base = createCrapsReplayTableModel(SIM_CRAPS_REPLAY_ARTIFACTS).tableOptions;
  assert.ok(base.otherPlayers.length > 0);
  const viewerAddress = SIM_CRAPS_REPLAY_ARTIFACTS.viewer.player.toLowerCase();
  const target = base.otherPlayers.find((player) => String(player.player).toLowerCase() !== viewerAddress);
  assert.ok(target, 'fixture has an opponent wallet distinct from the viewer');
  const profiles = new Map([
    [String(target.player).toLowerCase(), {
      name: 'DegenDave',
      avatar: 'https://cdn.discordapp.com/avatars/1/a.png',
    }],
    [viewerAddress, {
      name: 'ViewerVera',
      avatar: 'https://cdn.discordapp.com/avatars/2/b.png',
    }],
  ]);

  const overlaid = createCrapsReplayTableModel(SIM_CRAPS_REPLAY_ARTIFACTS, { profiles }).tableOptions;
  const dressed = overlaid.otherPlayers.find((player) => player.betId === target.betId);
  assert.equal(dressed.label, 'DegenDave', 'a linked wallet shows its Discord name');
  assert.equal(dressed.discordPfp, 'https://cdn.discordapp.com/avatars/1/a.png');
  assert.equal(overlaid.viewerLabel, 'ViewerVera', 'YOU carries the viewer Discord name into the ten rows');
  assert.equal(overlaid.viewerDiscordPfp, 'https://cdn.discordapp.com/avatars/2/b.png');
  for (const other of overlaid.otherPlayers) {
    if (profiles.has(String(other.player).toLowerCase())) continue;
    const sealed = base.otherPlayers.find((player) => player.betId === other.betId);
    assert.equal(other.label, sealed.label, 'unlinked seats keep their sealed labels');
    assert.equal(other.discordPfp, sealed.discordPfp);
  }

  // No profiles at all — the deterministic model is byte-identical to the bundle's.
  const bare = createCrapsReplayTableModel(SIM_CRAPS_REPLAY_ARTIFACTS, { profiles: null }).tableOptions;
  assert.deepEqual(
    bare.otherPlayers.map((player) => [player.label, player.discordPfp]),
    base.otherPlayers.map((player) => [player.label, player.discordPfp]),
  );
  assert.equal(bare.viewerLabel, base.viewerLabel);
  assert.equal(bare.viewerDiscordPfp, base.viewerDiscordPfp);
});

test('next-run shooter sidecars preserve hand order, identity, and the actual hot proc', () => {
  const player = SIM_CRAPS_REPLAY_ARTIFACTS.viewer.player;
  const profiles = new Map([[player.toLowerCase(), {
    name: 'Shooter Sam',
    avatar: 'https://cdn.discordapp.com/avatars/3/c.png',
  }]]);
  const shooters = normalizeCrapsReplayShooters({
    shooters: {
      0: { player, betId: '41' },
      1: { player, betId: '41', hotShooterBoostPercent: 5 },
    },
  }, profiles);

  assert.deepEqual(shooters, [
    {
      shooter: 0,
      player,
      betId: '41',
      label: 'Shooter Sam',
      avatar: 'https://cdn.discordapp.com/avatars/3/c.png',
      hotShooterBoostPercent: null,
    },
    {
      shooter: 1,
      player,
      betId: '41',
      label: 'Shooter Sam',
      avatar: 'https://cdn.discordapp.com/avatars/3/c.png',
      hotShooterBoostPercent: 5,
    },
  ]);
});

test('protocol seats are named from the active chain profile, not hardcoded', () => {
  // The vault is auto-seated at every scheduled window and sDGNRS spends banked day passes, so
  // both sit in ordinary fields and would otherwise render as an anonymous "Seat 12".
  assert.equal(protocolSeatLabel(CONTRACTS.VAULT), 'The Vault');
  assert.equal(protocolSeatLabel(CONTRACTS.SDGNRS), 'sDGNRS');

  // Addresses arrive from the bundle in mixed case; the lookup must not care.
  assert.equal(protocolSeatLabel(CONTRACTS.VAULT.toUpperCase().replace('0X', '0x')), 'The Vault');

  // An ordinary wallet keeps its own identity, and junk never resolves to a protocol name.
  assert.equal(protocolSeatLabel('0x1111111111111111111111111111111111111111'), null);
  assert.equal(protocolSeatLabel(null), null);
  assert.equal(protocolSeatLabel(undefined), null);
  assert.equal(protocolSeatLabel(''), null);

  // ⛔ The addresses must come from chain-config, which the launcher republishes per run. A
  // literal here would label the PREVIOUS run's vault and eventually brand a stranger's wallet.
  const src = readFileSync(new URL('../../craps/replay-adapter.js', import.meta.url), 'utf8');
  assert.match(src, /CONTRACTS\?\.VAULT/, 'vault label must read the active chain profile');
  assert.match(src, /CONTRACTS\?\.SDGNRS/, 'sDGNRS label must read the active chain profile');
});
