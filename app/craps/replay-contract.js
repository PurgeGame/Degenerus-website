/**
 * Canonical, CDN-facing contract for a sealed Craps battle replay.
 *
 * The mutable pointer is deliberately tiny. Everything it discovers is immutable and
 * content-addressed, so a resolved battle can be requested by every open tab without
 * turning the database API into a fan-out service.
 */

export const CRAPS_REPLAY_SCHEMA_VERSION = 1;
// 0b0ed9fb3: the run-#43 ruleset — goal latch + peak ranking, the two-way 5/20 goal draw, and
// the posted-stake → played-round restore at the materializer's load boundary. Exact-match
// checked against `manifest.ruleset.engineVersion`, so bundles from the drifted 484a5d60b
// materializer fail closed here rather than animating the wrong chips.
export const CRAPS_REPLAY_ENGINE_VERSION = 'craps-solidity-0b0ed9fb3-v1';
export const CRAPS_REPLAY_CDN_PREFIX = '/craps/replays/v1';
export const CRAPS_REPLAY_DEFAULT_SHARD_SIZE = 256;
// Mirrors `Craps._MAX_SLIP_HANDS` and `Craps._SLIP_ROLL_CEILING` (`_SLIP_ROLL_BUDGET - 1 +
// _MAX_ROLLS`). BOTH doubled at the 2026-08-29 re-vendor — the goal now LATCHES and the run plays
// on, so the contract gave it room. Stale here, this validator REJECTS the manifest for any long
// battle and the table renders nothing; the packed-nibble and offset strings still fit their own
// caps at the new sizes (11_604 / 2_732 chars against 16_384 / 4_096).
export const CRAPS_REPLAY_MAX_HANDS = 512;
export const CRAPS_REPLAY_MAX_ROLLS = 8_703;
export const CRAPS_REPLAY_LEG_ORDER = Object.freeze([
  'passLine', 'place4', 'place5', 'place6', 'place8',
  'place9', 'place10', 'hard4', 'hard8', 'dontPass',
]);

// Runtime hashes this browser build is allowed to replay. A contract re-vendor must add its
// verified hash EXPLICITLY; silently accepting a new engine would make the animation look
// authoritative while applying stale payout rules.
//
// The entry is the keccak of the DEPLOYED `CrapsBattle` runtime code, which is what
// `manifest.ruleset.runtimeCodeHash` carries. Adding one is not a formality — the procedure is:
//
//   1. re-run the database repo's craps differential suite against the new artifact
//      (`npx vitest run src/craps/__tests__/engine-differential.test.ts`), which pins the
//      TypeScript port to the deployed Solidity;
//   2. regenerate this repo's fixture through the production serializer
//      (`cd degenerus-sim && npx tsx scripts/craps-replay-fixture.ts --write`);
//   3. add the hash here.
//
// 0x7fa2e3de… — audit 484a5d60b, the build the engine was first ported against.
// 0x300a278f… — audit 0b34a4713 (the craps RNG-gate redeploy). Settlement is byte-identical:
//   the differential suite passes unchanged against it, and the change was to the ARMING path
//   (`_armSlot`'s lootbox RNG request), not to `_settleSlip`. The runtime hash moved anyway,
//   because the runtime did — which is exactly why this list keys on the code and not on a
//   version string somebody has to remember to bump.
// 0xff6c3a41… — audit 0b0ed9fb3, the run-#43 deploy (CrapsBattle 0x006c1c39…, keccak verified
//   against the live Base Sepolia code). Differential suite green against the re-vendored
//   harness, and the day-2 field reproduces its chain settlements to the wei once the
//   materializer restores the played round from the posted stake.
export const CRAPS_REPLAY_SUPPORTED_RUNTIME_HASHES = Object.freeze([
  '0x7fa2e3de9a9102cc1832fc8f1eb240040d641e5c173d9dc61bb38a2c125e8471',
  '0x300a278f022ee77a2a30959a1d9db9ab540d2aa4d113d927c3ec297a6c3dad0a',
  '0xff6c3a41a60f9eb5d5ef16553282ae304a739949a321e08ad5b83e3aabfcb4c2',
]);

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const DIGEST = /^[0-9a-f]{16,64}$/;
const POINTER_STATES = new Set(['pending', 'settling', 'ready', 'failed']);
const STOP_STATES = new Set(['bust', 'goal']);
const COLLECTION_KINDS = new Set(['craps-replay-featured', 'craps-replay-seat-shard']);

export class CrapsReplayValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'CrapsReplayValidationError';
    this.path = path;
  }
}

function fail(path, message) {
  throw new CrapsReplayValidationError(path, message);
}

function objectAt(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  return value;
}

function stringAt(value, path, { min = 1, max = 2_048 } = {}) {
  if (typeof value !== 'string') fail(path, 'expected a string');
  const out = value.trim();
  if (out.length < min || out.length > max) fail(path, `length must be ${min}..${max}`);
  return out;
}

function integerAt(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(path, `expected an integer in ${min}..${max}`);
  }
  return value;
}

function decimalAt(value, path, { positive = false } = {}) {
  const out = stringAt(value, path, { max: 96 });
  if (!DECIMAL.test(out) || (positive && out === '0')) {
    fail(path, positive ? 'expected a positive decimal string' : 'expected an unsigned decimal string');
  }
  return out;
}

function addressAt(value, path) {
  const out = stringAt(value, path, { max: 42 }).toLowerCase();
  if (!ADDRESS.test(out)) fail(path, 'expected a 20-byte hex address');
  return out;
}

function hashAt(value, path) {
  const out = stringAt(value, path, { max: 66 }).toLowerCase();
  if (!HASH.test(out)) fail(path, 'expected a 32-byte hex hash');
  return out;
}

function digestAt(value, path) {
  const out = stringAt(value, path, { max: 64 }).toLowerCase();
  if (!DIGEST.test(out)) fail(path, 'expected a 16..64 character lowercase hex digest');
  return out;
}

function nullableString(value, path, options) {
  return value == null || value === '' ? null : stringAt(value, path, options);
}

function isoDateAt(value, path) {
  const out = stringAt(value, path, { max: 40 });
  if (!Number.isFinite(Date.parse(out))) fail(path, 'expected an ISO timestamp');
  return out;
}

function replayPathAt(value, path) {
  const out = stringAt(value, path, { max: 2_048 });
  if (!out.startsWith(`${CRAPS_REPLAY_CDN_PREFIX}/`) || out.includes('..') || /[?#]/.test(out)) {
    fail(path, `must be a clean path beneath ${CRAPS_REPLAY_CDN_PREFIX}`);
  }
  return out;
}

function avatarAt(value, path) {
  if (value == null || value === '') return null;
  const out = stringAt(value, path, { max: 2_048 });
  if (!(out.startsWith('/') || /^https:\/\//i.test(out))) {
    fail(path, 'must be an https URL or same-origin path');
  }
  return out;
}

export function decodeCrapsReplayBase64(value, path = 'base64') {
  const input = stringAt(value, path, { min: 0, max: 1_500_000 });
  if (input === '') return new Uint8Array();
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(input)) fail(path, 'invalid base64');
  const canonical = input.replaceAll('-', '+').replaceAll('_', '/');
  try {
    if (typeof globalThis.Buffer === 'function') {
      return Uint8Array.from(globalThis.Buffer.from(canonical, 'base64'));
    }
    const binary = globalThis.atob(canonical);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    fail(path, 'invalid base64');
  }
}

function encodeBase64(bytes) {
  if (typeof globalThis.Buffer === 'function') return globalThis.Buffer.from(bytes).toString('base64');
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return globalThis.btoa(binary);
}

/** Big-endian uint128 ladder codec shared by simulator fixtures and the browser validator. */
export function encodeCrapsReplayLadder(values) {
  if (!Array.isArray(values)) fail('ladder', 'expected an array');
  const bytes = new Uint8Array(values.length * 16);
  values.forEach((raw, index) => {
    let value = BigInt(decimalAt(String(raw), `ladder[${index}]`));
    if (value >= (1n << 128n)) fail(`ladder[${index}]`, 'does not fit uint128');
    for (let byte = 15; byte >= 0; byte -= 1) {
      bytes[index * 16 + byte] = Number(value & 0xffn);
      value >>= 8n;
    }
  });
  return Object.freeze({ encoding: 'uint128be/base64', values: encodeBase64(bytes) });
}

export function decodeCrapsReplayLadder(input, expectedLength = null, path = 'ladder') {
  const value = objectAt(input, path);
  if (value.encoding !== 'uint128be/base64') fail(`${path}.encoding`, 'unsupported ladder encoding');
  const bytes = decodeCrapsReplayBase64(value.values, `${path}.values`);
  if (bytes.length % 16 !== 0) fail(`${path}.values`, 'decoded byte length must be divisible by 16');
  const length = bytes.length / 16;
  if (expectedLength != null && length !== expectedLength) fail(path, `expected ${expectedLength} entries, decoded ${length}`);
  const out = [];
  for (let index = 0; index < length; index += 1) {
    let amount = 0n;
    for (let byte = 0; byte < 16; byte += 1) amount = (amount << 8n) | BigInt(bytes[index * 16 + byte]);
    out.push(amount.toString());
  }
  return Object.freeze(out);
}

/** Compact one-based full-field position after entry and after every played roll. */
export function encodeCrapsReplayRankTimeline(values) {
  if (!Array.isArray(values)) fail('rankTimeline', 'expected an array');
  if (values.length > CRAPS_REPLAY_MAX_ROLLS + 1) fail('rankTimeline', 'too many entries');
  const bytes = new Uint8Array(values.length * 4);
  values.forEach((raw, index) => {
    const rank = integerAt(Number(raw), `rankTimeline[${index}]`, { min: 1, max: 0xffffffff });
    bytes[index * 4] = Math.floor(rank / 0x1000000) & 0xff;
    bytes[index * 4 + 1] = Math.floor(rank / 0x10000) & 0xff;
    bytes[index * 4 + 2] = Math.floor(rank / 0x100) & 0xff;
    bytes[index * 4 + 3] = rank & 0xff;
  });
  return Object.freeze({ encoding: 'uint32be/base64', values: encodeBase64(bytes) });
}

export function decodeCrapsReplayRankTimeline(input, expectedLength = null, path = 'rankTimeline') {
  const value = objectAt(input, path);
  if (value.encoding !== 'uint32be/base64') fail(`${path}.encoding`, 'unsupported rank encoding');
  const bytes = decodeCrapsReplayBase64(value.values, `${path}.values`);
  if (bytes.length % 4 !== 0) fail(`${path}.values`, 'decoded byte length must be divisible by 4');
  const length = bytes.length / 4;
  if (length > CRAPS_REPLAY_MAX_ROLLS + 1) fail(path, 'too many entries');
  if (expectedLength != null && length !== expectedLength) fail(path, `expected ${expectedLength} entries, decoded ${length}`);
  const out = [];
  for (let index = 0; index < length; index += 1) {
    const rank = (bytes[index * 4] * 0x1000000)
      + (bytes[index * 4 + 1] * 0x10000)
      + (bytes[index * 4 + 2] * 0x100)
      + bytes[index * 4 + 3];
    if (rank < 1) fail(`${path}[${index}]`, 'rank must be one-based');
    out.push(rank);
  }
  return Object.freeze(out);
}

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(frozen);
  return Object.freeze(value);
}

function battleSegment(battleKey) {
  return encodeURIComponent(stringAt(String(battleKey ?? ''), 'battleKey', { max: 160 }));
}

export function crapsReplayPointerPath(battleKey) {
  return `${CRAPS_REPLAY_CDN_PREFIX}/battles/${battleSegment(battleKey)}/latest.json`;
}

export function crapsReplayArtifactPaths(battleKey, digest) {
  const safeDigest = digestAt(digest, 'digest');
  const base = `${CRAPS_REPLAY_CDN_PREFIX}/battles/${battleSegment(battleKey)}/results/${safeDigest}`;
  return Object.freeze({
    base,
    manifest: `${base}/manifest.json`,
    featured: `${base}/featured.json`,
    shardTemplate: `${base}/seats/{shard}.json`,
  });
}

export function crapsReplaySeatFromBetId(betId) {
  const id = BigInt(decimalAt(String(betId), 'betId'));
  return id & 0xffffffffffffffffn;
}

export function crapsReplayShardIndex(seat, shardSize = CRAPS_REPLAY_DEFAULT_SHARD_SIZE) {
  const normalizedSeat = typeof seat === 'bigint' ? seat : BigInt(decimalAt(String(seat), 'seat', { positive: true }));
  const size = BigInt(integerAt(Number(shardSize), 'shardSize', { min: 1, max: 4_096 }));
  if (normalizedSeat < 1n) fail('seat', 'must be at least one');
  const index = (normalizedSeat - 1n) / size;
  if (index > BigInt(Number.MAX_SAFE_INTEGER)) fail('seat', 'shard index exceeds browser limits');
  return Number(index);
}

export function crapsReplayShardPath(manifest, shardIndex) {
  const normalized = validateCrapsReplayManifest(manifest);
  const index = integerAt(shardIndex, 'shardIndex', { min: 0, max: normalized.field.shardCount - 1 });
  return normalized.field.shardPathTemplate.replace('{shard}', String(index).padStart(4, '0'));
}

export function validateCrapsReplayPointer(input) {
  const value = objectAt(input, 'pointer');
  if (value.schemaVersion !== CRAPS_REPLAY_SCHEMA_VERSION) fail('pointer.schemaVersion', 'unsupported schema');
  if (value.kind !== 'craps-replay-pointer') fail('pointer.kind', 'expected craps-replay-pointer');
  const status = stringAt(value.status, 'pointer.status', { max: 16 });
  if (!POINTER_STATES.has(status)) fail('pointer.status', 'unsupported state');
  const battleKey = stringAt(value.battleKey, 'pointer.battleKey', { max: 160 });
  const entrants = integerAt(value.entrants, 'pointer.entrants', { max: 0xffffffff });
  const resolved = integerAt(value.resolved, 'pointer.resolved', { max: entrants });
  const base = {
    schemaVersion: CRAPS_REPLAY_SCHEMA_VERSION,
    kind: 'craps-replay-pointer',
    battleKey,
    status,
    entrants,
    resolved,
    finalizedBlock: value.finalizedBlock == null ? null : decimalAt(value.finalizedBlock, 'pointer.finalizedBlock'),
    publishedAt: value.publishedAt == null ? null : isoDateAt(value.publishedAt, 'pointer.publishedAt'),
    error: status === 'failed' ? nullableString(value.error, 'pointer.error', { max: 240 }) : null,
  };
  if (status !== 'ready') {
    if (value.digest != null || value.manifestPath != null) {
      fail('pointer', 'non-ready pointers cannot expose immutable artifacts');
    }
    return frozen({ ...base, digest: null, manifestPath: null });
  }
  if (resolved !== entrants) fail('pointer.resolved', 'a ready pointer must have resolved every entrant');
  const digest = digestAt(value.digest, 'pointer.digest');
  const expected = crapsReplayArtifactPaths(battleKey, digest).manifest;
  const manifestPath = replayPathAt(value.manifestPath, 'pointer.manifestPath');
  if (manifestPath !== expected) fail('pointer.manifestPath', `expected ${expected}`);
  return frozen({ ...base, digest, manifestPath });
}

function validateRuleset(input) {
  const value = objectAt(input, 'manifest.ruleset');
  return Object.freeze({
    engineVersion: stringAt(value.engineVersion, 'manifest.ruleset.engineVersion', { max: 80 }),
    chainId: integerAt(value.chainId, 'manifest.ruleset.chainId', { min: 1 }),
    contract: addressAt(value.contract, 'manifest.ruleset.contract'),
    runtimeCodeHash: hashAt(value.runtimeCodeHash, 'manifest.ruleset.runtimeCodeHash'),
  });
}

function validateTape(input) {
  const value = objectAt(input, 'manifest.tape');
  const maxHands = integerAt(value.maxHands, 'manifest.tape.maxHands', { max: CRAPS_REPLAY_MAX_HANDS });
  const totalRolls = integerAt(value.totalRolls, 'manifest.tape.totalRolls', { max: CRAPS_REPLAY_MAX_ROLLS });
  const encoding = stringAt(value.encoding, 'manifest.tape.encoding', { max: 40 });
  if (encoding !== 'packed-nibbles+uint32be/base64') fail('manifest.tape.encoding', 'unsupported tape encoding');
  const rolls = stringAt(value.rolls, 'manifest.tape.rolls', { min: totalRolls > 0 ? 1 : 0, max: 16_384 });
  const handOffsets = stringAt(value.handOffsets, 'manifest.tape.handOffsets', { min: maxHands > 0 ? 1 : 0, max: 4_096 });
  return Object.freeze({ encoding, maxHands, totalRolls, rolls, handOffsets });
}

function validateProgressive(input) {
  const value = objectAt(input ?? {}, 'manifest.progressive');
  const status = stringAt(value.status ?? 'live', 'manifest.progressive.status', { max: 16 });
  if (!new Set(['live', 'won', 'not-awarded']).has(status)) {
    fail('manifest.progressive.status', 'unsupported state');
  }
  const winnerBetId = value.winnerBetId == null ? null : decimalAt(value.winnerBetId, 'manifest.progressive.winnerBetId');
  // ⛔ SCORE BASIS POINTS, NOT A ROLL COUNT (2026-08-29 re-vendor, audit 03e8c3600). The rung is
  // drawn on the winner's HIGH POINT over its own starting bankroll — 10,000 is 1x — and the
  // cutoffs run to 2,250,000. The old bound here was CRAPS_REPLAY_MAX_ROLLS, which would have
  // rejected every real score as out of range, so the field was RENAMED rather than repurposed.
  const wonAtScoreBps = value.wonAtScoreBps == null
    ? null
    : integerAt(value.wonAtScoreBps, 'manifest.progressive.wonAtScoreBps', { min: 1, max: 1_000_000_000 });
  if (status === 'won' && (winnerBetId == null || wonAtScoreBps == null)) {
    fail('manifest.progressive', 'a won progressive requires winnerBetId and wonAtScoreBps');
  }
  return Object.freeze({
    scoreBpsBefore: decimalAt(value.scoreBpsBefore ?? '0', 'manifest.progressive.scoreBpsBefore'),
    thresholdScoreBps: decimalAt(value.thresholdScoreBps ?? '0', 'manifest.progressive.thresholdScoreBps'),
    amountWei: value.amountWei == null ? null : decimalAt(value.amountWei, 'manifest.progressive.amountWei'),
    winnerBetId,
    wonAtScoreBps,
    status,
  });
}

export function validateCrapsReplayManifest(input) {
  const value = objectAt(input, 'manifest');
  if (value.schemaVersion !== CRAPS_REPLAY_SCHEMA_VERSION) fail('manifest.schemaVersion', 'unsupported schema');
  if (value.kind !== 'craps-replay-manifest') fail('manifest.kind', 'expected craps-replay-manifest');
  const battleKey = stringAt(value.battleKey, 'manifest.battleKey', { max: 160 });
  const digest = digestAt(value.digest, 'manifest.digest');
  const paths = crapsReplayArtifactPaths(battleKey, digest);
  const field = objectAt(value.field, 'manifest.field');
  const entrants = integerAt(field.entrants, 'manifest.field.entrants', { min: 1, max: 0xffffffff });
  const shardSize = integerAt(field.shardSize, 'manifest.field.shardSize', { min: 1, max: 4_096 });
  const expectedShardCount = Math.ceil(entrants / shardSize);
  const shardCount = integerAt(field.shardCount, 'manifest.field.shardCount', { min: 1, max: expectedShardCount });
  if (shardCount !== expectedShardCount) fail('manifest.field.shardCount', `expected ${expectedShardCount}`);
  const featuredPath = replayPathAt(field.featuredPath, 'manifest.field.featuredPath');
  const shardPathTemplate = replayPathAt(field.shardPathTemplate, 'manifest.field.shardPathTemplate');
  if (featuredPath !== paths.featured) fail('manifest.field.featuredPath', `expected ${paths.featured}`);
  if (shardPathTemplate !== paths.shardTemplate) fail('manifest.field.shardPathTemplate', `expected ${paths.shardTemplate}`);
  const terms = objectAt(value.terms, 'manifest.terms');
  const verification = objectAt(value.verification, 'manifest.verification');
  if (verification.allSeatsReplayOk !== true) fail('manifest.verification.allSeatsReplayOk', 'must be true before publication');
  const settledEntrants = integerAt(verification.settledEntrants, 'manifest.verification.settledEntrants', { max: entrants });
  if (settledEntrants !== entrants) fail('manifest.verification.settledEntrants', 'must equal field entrants');
  return frozen({
    schemaVersion: CRAPS_REPLAY_SCHEMA_VERSION,
    kind: 'craps-replay-manifest',
    battleKey,
    digest,
    ruleset: validateRuleset(value.ruleset),
    settlement: Object.freeze({
      boundSlot: decimalAt(value.settlement?.boundSlot, 'manifest.settlement.boundSlot'),
      boundIndex: decimalAt(value.settlement?.boundIndex, 'manifest.settlement.boundIndex'),
      finalizedBlock: decimalAt(value.settlement?.finalizedBlock, 'manifest.settlement.finalizedBlock'),
      finalizedBlockHash: hashAt(value.settlement?.finalizedBlockHash, 'manifest.settlement.finalizedBlockHash'),
    }),
    terms: Object.freeze({
      bankrollWei: decimalAt(terms.bankrollWei, 'manifest.terms.bankrollWei', { positive: true }),
      goalWei: decimalAt(terms.goalWei, 'manifest.terms.goalWei', { positive: true }),
      boardStakeWei: decimalAt(terms.boardStakeWei, 'manifest.terms.boardStakeWei', { positive: true }),
      battleStakeWei: decimalAt(terms.battleStakeWei ?? '0', 'manifest.terms.battleStakeWei'),
      bountyPoolWei: terms.bountyPoolWei == null
        ? null
        : decimalAt(terms.bountyPoolWei, 'manifest.terms.bountyPoolWei'),
      addedFlipWei: terms.addedFlipWei == null
        ? null
        : decimalAt(terms.addedFlipWei, 'manifest.terms.addedFlipWei'),
    }),
    tape: validateTape(value.tape),
    progressive: validateProgressive(value.progressive),
    field: Object.freeze({ entrants, shardSize, shardCount, featuredPath, shardPathTemplate }),
    verification: Object.freeze({
      allSeatsReplayOk: true,
      settledEntrants,
      replayedWonDigest: hashAt(verification.replayedWonDigest, 'manifest.verification.replayedWonDigest'),
    }),
    publishedAt: isoDateAt(value.publishedAt, 'manifest.publishedAt'),
  });
}

function validateSparseSchedule(input, path, handsPlayed, kind) {
  if (!Array.isArray(input ?? [])) fail(path, 'expected an array');
  let previous = -1;
  return Object.freeze((input ?? []).map((raw, index) => {
    const value = objectAt(raw, `${path}[${index}]`);
    // A lost survival flip belongs to the shooter the seat TRIED to enter, so it may sit at
    // `handsPlayed`; a boost can only belong to a shooter that was actually played.
    const maxShooter = kind === 'boost' ? handsPlayed - 1 : handsPlayed;
    if (maxShooter < 0) fail(`${path}[${index}].shooter`, 'schedule cannot exist without a shooter');
    const shooter = integerAt(value.shooter, `${path}[${index}].shooter`, { max: maxShooter });
    if (shooter <= previous) fail(`${path}[${index}].shooter`, 'schedule must be strictly increasing');
    previous = shooter;
    if (kind === 'boost') {
      return Object.freeze({ shooter, percent: integerAt(value.percent, `${path}[${index}].percent`, { min: 1, max: 100 }) });
    }
    if (typeof value.survived !== 'boolean') fail(`${path}[${index}].survived`, 'expected a boolean');
    return Object.freeze({ shooter, survived: value.survived });
  }));
}

export function validateCrapsReplayPlayer(input, path = 'player') {
  const value = objectAt(input, path);
  const betId = decimalAt(value.betId, `${path}.betId`, { positive: true });
  const seat = decimalAt(value.seat, `${path}.seat`, { positive: true });
  if (crapsReplaySeatFromBetId(betId) !== BigInt(seat)) fail(`${path}.seat`, 'does not match betId low 64 bits');
  if (!Array.isArray(value.resolvedBoardWei) || value.resolvedBoardWei.length !== CRAPS_REPLAY_LEG_ORDER.length) {
    fail(`${path}.resolvedBoardWei`, `expected ${CRAPS_REPLAY_LEG_ORDER.length} legs`);
  }
  const resolvedBoardWei = Object.freeze(value.resolvedBoardWei.map((amount, index) => (
    decimalAt(amount, `${path}.resolvedBoardWei[${index}]`)
  )));
  if (resolvedBoardWei.every((amount) => amount === '0')) fail(`${path}.resolvedBoardWei`, 'board cannot be empty');
  const handsPlayed = integerAt(value.handsPlayed, `${path}.handsPlayed`, { max: CRAPS_REPLAY_MAX_HANDS });
  const totalRolls = integerAt(value.totalRolls, `${path}.totalRolls`, { max: CRAPS_REPLAY_MAX_ROLLS });
  const ladderWei = decodeCrapsReplayLadder(value.ladder, handsPlayed + 1, `${path}.ladder`);
  const rankByRoll = value.rankTimeline == null
    ? null
    : decodeCrapsReplayRankTimeline(value.rankTimeline, totalRolls + 1, `${path}.rankTimeline`);
  const stop = stringAt(value.stop, `${path}.stop`, { max: 8 });
  if (!STOP_STATES.has(stop)) fail(`${path}.stop`, 'expected bust or goal');
  if (value.replayOk !== true) fail(`${path}.replayOk`, 'seat is not chain-verified');
  return frozen({
    betId,
    seat,
    player: addressAt(value.player, `${path}.player`),
    name: stringAt(value.name ?? `Seat ${seat}`, `${path}.name`, { max: 64 }),
    avatarUrl: avatarAt(value.avatarUrl, `${path}.avatarUrl`),
    entryMultiple: integerAt(value.entryMultiple ?? 1, `${path}.entryMultiple`, { min: 1, max: 256 }),
    standing: integerAt(value.standing ?? 0, `${path}.standing`, { max: 0xffff }),
    resolvedBoardWei,
    bankrollInWei: decimalAt(value.bankrollInWei, `${path}.bankrollInWei`, { positive: true }),
    goalWei: decimalAt(value.goalWei, `${path}.goalWei`, { positive: true }),
    handsPlayed,
    totalRolls,
    unitsPlayed: decimalAt(value.unitsPlayed, `${path}.unitsPlayed`),
    stop,
    ladder: Object.freeze({
      encoding: 'uint128be/base64',
      values: stringAt(value.ladder?.values, `${path}.ladder.values`, { min: 1, max: 6_000 }),
    }),
    ladderWei,
    rankTimeline: value.rankTimeline == null ? null : Object.freeze({
      encoding: 'uint32be/base64',
      values: stringAt(value.rankTimeline?.values, `${path}.rankTimeline.values`, { min: 1, max: 32_000 }),
    }),
    rankByRoll,
    boosts: validateSparseSchedule(value.boosts, `${path}.boosts`, handsPlayed, 'boost'),
    survivals: validateSparseSchedule(value.survivals, `${path}.survivals`, handsPlayed, 'survival'),
    wonWei: decimalAt(value.wonWei, `${path}.wonWei`),
    paidWei: decimalAt(value.paidWei, `${path}.paidWei`),
    replayOk: true,
  });
}

export function validateCrapsReplayCollection(input, manifestInput) {
  const manifest = validateCrapsReplayManifest(manifestInput);
  const value = objectAt(input, 'collection');
  if (value.schemaVersion !== CRAPS_REPLAY_SCHEMA_VERSION) fail('collection.schemaVersion', 'unsupported schema');
  if (!COLLECTION_KINDS.has(value.kind)) fail('collection.kind', 'unsupported collection kind');
  const battleKey = stringAt(value.battleKey, 'collection.battleKey', { max: 160 });
  const digest = digestAt(value.digest, 'collection.digest');
  if (battleKey !== manifest.battleKey || digest !== manifest.digest) fail('collection', 'does not belong to manifest');
  if (!Array.isArray(value.players)) fail('collection.players', 'expected an array');
  const players = Object.freeze(value.players.map((player, index) => validateCrapsReplayPlayer(player, `collection.players[${index}]`)));
  const seen = new Set();
  for (const player of players) {
    if (seen.has(player.betId)) fail('collection.players', `duplicate betId ${player.betId}`);
    if (player.rankByRoll?.some((rank) => rank > manifest.field.entrants)) {
      fail('collection.players', `rank for ${player.betId} exceeds ${manifest.field.entrants} entrants`);
    }
    seen.add(player.betId);
  }
  if (value.kind === 'craps-replay-seat-shard') {
    const shard = objectAt(value.shard, 'collection.shard');
    const index = integerAt(shard.index, 'collection.shard.index', { max: manifest.field.shardCount - 1 });
    const startSeat = BigInt(index * manifest.field.shardSize + 1);
    const endSeat = BigInt(Math.min(manifest.field.entrants, (index + 1) * manifest.field.shardSize));
    for (const player of players) {
      const seat = BigInt(player.seat);
      if (seat < startSeat || seat > endSeat) fail('collection.players', `seat ${seat} is outside shard ${index}`);
    }
    return frozen({
      schemaVersion: CRAPS_REPLAY_SCHEMA_VERSION,
      kind: value.kind,
      battleKey,
      digest,
      shard: { index, startSeat: startSeat.toString(), endSeat: endSeat.toString() },
      players,
    });
  }
  if (!Array.isArray(value.leaderboard)) fail('collection.leaderboard', 'expected an array');
  if (value.leaderboard.length !== manifest.tape.maxHands) {
    fail('collection.leaderboard', `expected one row for each of ${manifest.tape.maxHands} shooters`);
  }
  const leaderboard = Object.freeze(value.leaderboard.map((raw, index) => {
    const row = objectAt(raw, `collection.leaderboard[${index}]`);
    const shooter = integerAt(row.shooter, `collection.leaderboard[${index}].shooter`, { max: Math.max(0, manifest.tape.maxHands - 1) });
    if (shooter !== index) fail(`collection.leaderboard[${index}].shooter`, 'must be sequential');
    // Eleven candidates let every viewer render the best ten OTHER seats even when the
    // viewer is themselves in the global top ten. Older four-wide bundles remain valid.
    if (!Array.isArray(row.betIds) || row.betIds.length > 11) fail(`collection.leaderboard[${index}].betIds`, 'expected at most eleven candidate bet ids');
    const betIds = Object.freeze(row.betIds.map((betId, betIndex) => decimalAt(betId, `collection.leaderboard[${index}].betIds[${betIndex}]`, { positive: true })));
    for (const betId of betIds) if (!seen.has(betId)) fail(`collection.leaderboard[${index}].betIds`, `missing featured player ${betId}`);
    return Object.freeze({ shooter, betIds });
  }));
  return frozen({
    schemaVersion: CRAPS_REPLAY_SCHEMA_VERSION,
    kind: value.kind,
    battleKey,
    digest,
    players,
    leaderboard,
  });
}

export function assertSupportedCrapsReplayRuleset(manifestInput, {
  engineVersion = CRAPS_REPLAY_ENGINE_VERSION,
  runtimeCodeHashes = CRAPS_REPLAY_SUPPORTED_RUNTIME_HASHES,
} = {}) {
  const manifest = validateCrapsReplayManifest(manifestInput);
  if (manifest.ruleset.engineVersion !== engineVersion) {
    fail('manifest.ruleset.engineVersion', `unsupported engine ${manifest.ruleset.engineVersion}`);
  }
  const supported = new Set([...runtimeCodeHashes].map((hash) => String(hash).toLowerCase()));
  if (!supported.has(manifest.ruleset.runtimeCodeHash)) {
    fail('manifest.ruleset.runtimeCodeHash', `unsupported ruleset ${manifest.ruleset.runtimeCodeHash}`);
  }
  return manifest;
}

const immutableFlights = new Map();
const immutableCache = new Map();
const IMMUTABLE_CACHE_LIMIT = 32;

async function fetchJson(path, fetchImpl, { immutable = false } = {}) {
  if (immutable && immutableCache.has(path)) return immutableCache.get(path);
  if (immutable && immutableFlights.has(path)) return immutableFlights.get(path);
  const flight = (async () => {
    const response = await fetchImpl(path, { headers: { accept: 'application/json' } });
    if (!response?.ok) throw new Error(`Craps replay ${path} returned HTTP ${response?.status ?? 'unknown'}`);
    const payload = await response.json();
    if (immutable) {
      immutableCache.set(path, payload);
      while (immutableCache.size > IMMUTABLE_CACHE_LIMIT) immutableCache.delete(immutableCache.keys().next().value);
    }
    return payload;
  })();
  if (immutable) immutableFlights.set(path, flight);
  try { return await flight; }
  finally { if (immutableFlights.get(path) === flight) immutableFlights.delete(path); }
}

/**
 * Load the sealed artifacts needed by one viewer. The pointer is always rechecked; immutable
 * artifacts are single-flight and cached by their digest path inside the tab.
 */
export async function loadCrapsReplay({ battleKey, viewerBetId, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('loadCrapsReplay requires fetch');
  const requestedBattleKey = stringAt(String(battleKey ?? ''), 'battleKey', { max: 160 });
  const pointer = validateCrapsReplayPointer(await fetchJson(crapsReplayPointerPath(battleKey), fetchImpl));
  if (pointer.battleKey !== requestedBattleKey) fail('pointer.battleKey', `expected ${requestedBattleKey}`);
  if (pointer.status !== 'ready') return frozen({ ready: false, pointer });

  const manifest = assertSupportedCrapsReplayRuleset(await fetchJson(pointer.manifestPath, fetchImpl, { immutable: true }));
  if (manifest.battleKey !== pointer.battleKey || manifest.digest !== pointer.digest) {
    fail('manifest', 'does not match the ready pointer');
  }
  const betId = decimalAt(String(viewerBetId ?? ''), 'viewerBetId', { positive: true });
  const seat = crapsReplaySeatFromBetId(betId);
  const shardIndex = crapsReplayShardIndex(seat, manifest.field.shardSize);
  if (shardIndex >= manifest.field.shardCount) fail('viewerBetId', 'seat is outside the battle field');
  const [featuredRaw, shardRaw] = await Promise.all([
    fetchJson(manifest.field.featuredPath, fetchImpl, { immutable: true }),
    fetchJson(crapsReplayShardPath(manifest, shardIndex), fetchImpl, { immutable: true }),
  ]);
  const featured = validateCrapsReplayCollection(featuredRaw, manifest);
  const shard = validateCrapsReplayCollection(shardRaw, manifest);
  const viewer = featured.players.find((player) => player.betId === betId)
    ?? shard.players.find((player) => player.betId === betId);
  if (!viewer) fail('viewerBetId', `seat ${seat} was not present in its shard`);
  return frozen({ ready: true, pointer, manifest, featured, shard, viewer });
}

export function __resetCrapsReplayLoaderForTest() {
  immutableFlights.clear();
  immutableCache.clear();
}
