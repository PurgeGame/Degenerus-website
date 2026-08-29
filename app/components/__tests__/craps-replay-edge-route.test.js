/**
 * The `/craps/replays/v1/*` edge route grammar.
 *
 * A public prefix that forwards arbitrary paths to an origin that reads a bucket is a read
 * primitive over that bucket. This pins the allowlist: only the four object shapes V1 defines
 * are proxied, and every other path is a 404 before a subrequest exists.
 *
 * The Fly route re-applies the same grammar (`src/api/routes/game.ts`), so this is the first of
 * two gates rather than the only one — but it is the one that runs on every request.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { routeKind } from '../../../functions/craps/[[path]].js';
import {
  crapsReplayArtifactPaths,
  crapsReplayPointerPath,
} from '../../craps/replay-contract.js';
import { SIM_CRAPS_REPLAY_PATHS } from '../../craps/fixtures/sim-battle-v1.js';

const BATTLE = `0x${'ab'.repeat(32)}`;
const DIGEST = 'a'.repeat(64);
const PATHS = crapsReplayArtifactPaths(BATTLE, DIGEST);

test('routes exactly the four objects one viewer needs', () => {
  assert.equal(routeKind(crapsReplayPointerPath(BATTLE)), 'pointer');
  assert.equal(routeKind(PATHS.manifest), 'immutable');
  assert.equal(routeKind(PATHS.featured), 'immutable');
  assert.equal(routeKind(`${PATHS.base}/seats/0000.json`), 'immutable');
  assert.equal(routeKind(`${PATHS.base}/seats/0157.json`), 'immutable');

  // The paths the contract module and the generated fixture actually produce must route.
  assert.equal(routeKind(SIM_CRAPS_REPLAY_PATHS.pointer), 'pointer');
  assert.equal(routeKind(SIM_CRAPS_REPLAY_PATHS.manifest), 'immutable');
  assert.equal(routeKind(SIM_CRAPS_REPLAY_PATHS.featured), 'immutable');
  for (const shard of SIM_CRAPS_REPLAY_PATHS.shards) assert.equal(routeKind(shard), 'immutable');
});

test('refuses everything outside the grammar', () => {
  const refused = [
    '/',
    '/craps/replays/v1/',
    '/craps/replays/v2/battles/x/latest.json',
    '/craps/replays/v1/battles',
    `/craps/replays/v1/battles/${BATTLE}`,
    `/craps/replays/v1/battles/${BATTLE}/latest.jsonx`,
    `/craps/replays/v1/battles/${BATTLE}/latest.json/extra`,
    // Digest shapes that are not digests.
    `/craps/replays/v1/battles/${BATTLE}/results/NOTHEX/manifest.json`,
    `/craps/replays/v1/battles/${BATTLE}/results/${'a'.repeat(65)}/manifest.json`,
    `/craps/replays/v1/battles/${BATTLE}/results/${'a'.repeat(8)}/manifest.json`,
    // Children V1 does not define.
    `/craps/replays/v1/battles/${BATTLE}/results/${DIGEST}/anything.json`,
    `/craps/replays/v1/battles/${BATTLE}/results/${DIGEST}/seats/1.json`,
    `/craps/replays/v1/battles/${BATTLE}/results/${DIGEST}/seats/0000.txt`,
    `/craps/replays/v1/battles/${BATTLE}/results/${DIGEST}/seats/0000.json/x`,
    // Traversal, raw and encoded, plus a doubled separator.
    `/craps/replays/v1/battles/${BATTLE}/results/${DIGEST}/../../latest.json`,
    '/craps/replays/v1/battles/../../secrets.json',
    '/craps/replays/v1/battles/%2e%2e%2f%2e%2e/latest.json',
    `/craps/replays/v1/battles//${BATTLE}/latest.json`,
    // Battle keys that are not battle keys.
    '/craps/replays/v1/battles/has space/latest.json',
    '/craps/replays/v1/battles/%FF%FE/latest.json',
    `/craps/replays/v1/battles/${'k'.repeat(161)}/latest.json`,
    '/craps/replays/v1/battles//latest.json',
  ];
  for (const path of refused) {
    assert.equal(routeKind(path), null, `expected ${path} to be refused`);
  }
});

test('accepts the battle key shapes the indexer actually mints', () => {
  // A scheduled window's key is a keccak; a custom battle is seeded under `slot:<n>` until its
  // arming event names one. Both must route.
  assert.equal(routeKind(crapsReplayPointerPath(`0x${'0'.repeat(64)}`)), 'pointer');
  assert.equal(routeKind(crapsReplayPointerPath('slot:1099511627785')), 'pointer');
  // crapsReplayPointerPath percent-encodes, so the colon arrives as %3A too.
  assert.equal(routeKind('/craps/replays/v1/battles/slot%3A1099511627785/latest.json'), 'pointer');
});
