// /app/app/records.js — the four all-time records and the pool they claim from.
//
// One shared FLIP pool (Coinflip.sol:218 `recordPool`) backs four permanent
// high-water marks: biggest flip, biggest Degenerette spin, biggest lootbox
// deposit, biggest ticket buy. Settlement and level-transition paths fund the
// pool, while successful record claims reduce it immediately.
//
// ⛔ THE MARKS ARE ON CHAIN; THE HOLDERS ARE NOT. Every `biggest*Ever` slot
// holds a bare uint128 — no address. The holder exists only in
// `BigRecordUpdated(kind, player, value, paid, sdgnrsPaid)`, which the indexer
// rolls into `coinflip_records`. Both the permanent marks and shared pool move
// in the claim transaction, so their headlines are read directly from the
// contract while the DB remains the source for holder and record history.

import { fetchJSON } from './api.js';
import { CHAIN, CONTRACTS, ETH_DIVISOR } from './chain-config.js';
import { sharedReadProvider } from './read-provider.js';
import { ethers, getProvider } from './contracts.js';
import { displayEthCompact, displayToken } from './scaling.js';

/** RECORD_KIND_* — ICoinflip.sol:14-17. Slot order is the render order. */
export const RECORD_KIND_FLIP = 0;
export const RECORD_KIND_SPIN = 1;
export const RECORD_KIND_LUCKBOX = 2;
export const RECORD_KIND_BUY = 3;

/** Session API — the only place an address maps to a Discord display identity. */
const SESSION_API = 'https://api.degener.us';
const RECORD_POOL_ABI = [
  'function recordPool() external view returns (uint128)',
  'function biggestFlipEver() external view returns (uint128)',
  'function biggestSpinEver() external view returns (uint128)',
  'function biggestLuckboxEver() external view returns (uint128)',
  'function biggestBuyEver() external view returns (uint128)',
];
const TOKEN_UNIT = 10n ** 18n;
// Coinflip storage layout for this immutable deployment. Slot 4 packs the
// claimable-day latch, one bool, then the four uint24 record clocks at byte
// offsets 4/7/10/13. There is no public Solidity getter for these clocks, so a
// single eth_getStorageAt keeps accrued bounty shares exact while an indexer
// migration or replay is catching up.
const RECORD_CLOCK_STORAGE_SLOT = 4n;
const RECORD_CLOCK_BYTE_OFFSETS = Object.freeze([4n, 7n, 10n, 13n]);
const UINT24_MASK = (1n << 24n) - 1n;

const RECORD_GETTER_BY_KIND = new Map([
  [RECORD_KIND_FLIP, 'biggestFlipEver'],
  [RECORD_KIND_SPIN, 'biggestSpinEver'],
  [RECORD_KIND_LUCKBOX, 'biggestLuckboxEver'],
  [RECORD_KIND_BUY, 'biggestBuyEver'],
]);

let _publicPoolProvider = null;
let _poolReadInflight = null;
let _lastLiveRecordPool = null;
let _clockReadInflight = null;
let _lastLiveRecordClocks = null;
let _markReadInflight = null;
let _lastLiveRecordMarks = null;
let _lastRecordsPayload = null;
let _fetchRecordsJSON = fetchJSON;
let _readRecordPool = readLiveRecordPool;
let _readRecordClocks = readLiveRecordClocks;
let _readRecordMarks = readLiveRecordMarks;

/**
 * Per-kind presentation facts.
 *
 * `unit` drives formatting and is NOT interchangeable: FLIP wei for the flip
 * record, ETH wei for spin and lootbox, a plain whole-ticket COUNT for the buy
 * record (`entryQuantityScaled / (4 * QTY_SCALE)` —
 * DegenerusGameFoilPackModule.sol:199-202, so no ticket divisor applies).
 *
 * `floorText` is the player-facing entry floor below which a candidate never
 * even reads the record slot. ETH values use the same mainnet-equivalent
 * display scale as every other amount in the app, including on testnet.
 */
export const RECORD_KINDS = [
  {
    kind: RECORD_KIND_FLIP,
    unit: 'flip',
    label: 'BIGGEST FLIP',
    short: 'FLIP',
    // Coinflip.sol:174 BIGGEST_FLIP_MIN = 200_000 ether (FLIP, unscaled).
    floorText: '200,000 FLIP',
    floorValue: 200_000n * TOKEN_UNIT,
    verb: 'flip',
  },
  {
    kind: RECORD_KIND_SPIN,
    unit: 'eth',
    label: 'BIGGEST DEGENERETTE',
    short: 'DEGENERETTE',
    // DegenerusGameDegeneretteModule.sol:256 BIGGEST_SPIN_MIN_ETH = 1 ether.
    floorText: '1 ETH',
    floorValue: TOKEN_UNIT / ETH_DIVISOR,
    verb: 'spin',
  },
  {
    kind: RECORD_KIND_LUCKBOX,
    unit: 'eth',
    label: 'BIGGEST LUCKBOX',
    short: 'LUCKBOX',
    // DegenerusGameMintModule.sol:131 BIGGEST_BOX_MIN_ETH = 5 ether.
    floorText: '5 ETH',
    floorValue: (5n * TOKEN_UNIT) / ETH_DIVISOR,
    verb: 'lootbox',
  },
  {
    kind: RECORD_KIND_BUY,
    unit: 'tickets',
    label: 'BIGGEST PACK RIPPED',
    short: 'PACK RIPPED',
    // DegenerusGame.sol:162 BIGGEST_BUY_MIN_TICKETS = 100 (whole tickets).
    floorText: '100 TICKETS',
    floorValue: 100n,
    verb: 'buy',
  },
];

const KIND_BY_ID = new Map(RECORD_KINDS.map((entry) => [entry.kind, entry]));

/** Presentation facts for a RECORD_KIND_*, or null when the kind is unknown. */
export function recordKindMeta(kind) {
  return KIND_BY_ID.get(Number(kind)) ?? null;
}

export function toBigInt(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
}

function recordPoolProvider() {
  if (!_publicPoolProvider && CHAIN.rpcUrl) {
    // The pool is global, so pin reads to the configured chain instead of the
    // wallet's current network. This also keeps the board live for visitors
    // who have not connected a wallet.
    _publicPoolProvider = sharedReadProvider();  // C15: shared batched read stream
  }
  return _publicPoolProvider || getProvider();
}

/**
 * Authoritative shared bounty balance.
 *
 * `_armBigRecord` writes `recordPool = pool - paid` before it emits
 * BigRecordUpdated. The indexed singleton is a settlement snapshot and can
 * therefore remain higher after an intra-day record claim; this direct getter
 * is what makes the displayed pool fall in the same mined block as the hit.
 */
export async function readLiveRecordPool() {
  if (_poolReadInflight) return _poolReadInflight;
  const request = (async () => {
    try {
      const provider = recordPoolProvider();
      if (!provider || !CONTRACTS.COINFLIP) return null;
      const value = await new ethers.Contract(
        CONTRACTS.COINFLIP,
        RECORD_POOL_ABI,
        provider,
      ).recordPool();
      if (value == null) return _lastLiveRecordPool;
      _lastLiveRecordPool = toBigInt(value);
      return _lastLiveRecordPool;
    } catch (_e) {
      // The API snapshot is still a useful degraded read if the public RPC is
      // unavailable on first paint. Once a chain value has landed, retain it
      // so one failed poll cannot make a paid-out pool jump back upward.
      return _lastLiveRecordPool;
    }
  })();
  _poolReadInflight = request;
  try {
    return await request;
  } finally {
    if (_poolReadInflight === request) _poolReadInflight = null;
  }
}

/** Decode Coinflip's four packed uint24 record claim clocks. */
export function decodeRecordClockSlot(raw) {
  let packed;
  try { packed = BigInt(raw ?? 0); } catch (_e) { return null; }
  return RECORD_CLOCK_BYTE_OFFSETS.map((byteOffset) => {
    const day = Number((packed >> (byteOffset * 8n)) & UINT24_MASK);
    return Number.isInteger(day) && day > 0 ? day : null;
  });
}

/**
 * Exact per-kind record clocks from the deployed Coinflip storage.
 *
 * The API remains the normal indexed source, but rows created before its
 * clockDay migration legitimately return null. Reading one packed slot avoids
 * flattening every category to the 5% safety floor in that state.
 */
export async function readLiveRecordClocks() {
  if (_clockReadInflight) return _clockReadInflight;
  const request = (async () => {
    try {
      const provider = recordPoolProvider();
      if (!provider || !CONTRACTS.COINFLIP || typeof provider.getStorage !== 'function') {
        return _lastLiveRecordClocks;
      }
      const raw = await provider.getStorage(CONTRACTS.COINFLIP, RECORD_CLOCK_STORAGE_SLOT);
      const decoded = decodeRecordClockSlot(raw);
      if (!decoded || !decoded.some((day) => day != null)) return _lastLiveRecordClocks;
      _lastLiveRecordClocks = decoded;
      return decoded;
    } catch (_e) {
      return _lastLiveRecordClocks;
    }
  })();
  _clockReadInflight = request;
  try {
    return await request;
  } finally {
    if (_clockReadInflight === request) _clockReadInflight = null;
  }
}

/**
 * Authoritative permanent high-water marks, in RECORD_KIND_* order.
 *
 * A bounty claim updates its mark and pays down `recordPool` in the same
 * transaction. Reading only the pool from chain made the bounty visibly move
 * while its winning amount remained stuck on the indexer's previous row.
 */
export async function readLiveRecordMarks() {
  if (_markReadInflight) return _markReadInflight;
  const request = (async () => {
    try {
      const provider = recordPoolProvider();
      if (!provider || !CONTRACTS.COINFLIP) return _lastLiveRecordMarks;
      const contract = new ethers.Contract(CONTRACTS.COINFLIP, RECORD_POOL_ABI, provider);
      const values = await Promise.all(RECORD_KINDS.map((meta) => {
        const getter = RECORD_GETTER_BY_KIND.get(meta.kind);
        return typeof contract[getter] === 'function' ? contract[getter]() : null;
      }));
      if (values.some((value) => value == null)) return _lastLiveRecordMarks;
      _lastLiveRecordMarks = values.map((value) => toBigInt(value));
      return _lastLiveRecordMarks;
    } catch (_e) {
      return _lastLiveRecordMarks;
    }
  })();
  _markReadInflight = request;
  try {
    return await request;
  } finally {
    if (_markReadInflight === request) _markReadInflight = null;
  }
}

/**
 * The smallest candidate that CLAIMS a share of the pool rather than merely
 * ratcheting the mark.
 *
 * Mirrors `(candidate - mark) * RECORD_BEAT_DIV >= mark` (Coinflip.sol:872).
 * The contract multiplies the increase instead of dividing the mark, so the
 * exact threshold is `mark + ceil(mark/5)`, not `mark + mark/5` — those differ
 * for any mark not divisible by five, and the floored form would understate the
 * bar.
 */
export function barToBeat(mark) {
  const value = toBigInt(mark);
  if (value <= 0n) return 0n;
  return value + (value + 4n) / 5n;
}

/** Exact bounty-paying target when the current on-chain mark is already known. */
export function recordClaimTargetForMark(kind, mark) {
  const meta = recordKindMeta(kind);
  if (!meta) return null;
  const value = toBigInt(mark);
  return value > 0n ? barToBeat(value) : toBigInt(meta.floorValue);
}

/**
 * Exact candidate that would claim this kind's live bounty right now.
 *
 * The first holder clears the contract entry floor. Once a mark exists, the
 * live `barToBeat` is the +20% claim predicate; merely nudging the record above
 * its mark does not pay the bounty and therefore must not light a wager field.
 */
export function recordClaimTarget(state, kind) {
  const meta = recordKindMeta(kind);
  const record = Array.isArray(state?.records)
    ? state.records.find((entry) => Number(entry?.kind) === Number(kind))
    : null;
  if (!meta || !record) return null;
  return record.held
    ? toBigInt(record.barToBeat)
    : recordClaimTargetForMark(kind, 0n);
}

/**
 * Read one permanent record directly from Coinflip.
 *
 * The API remains necessary for holder identity and claim history, but it can
 * trail a mined BigRecordUpdated event. Transaction presets use this getter so
 * the amount placed in the wallet is based on the head-chain mark, not a stale
 * indexer row.
 */
export async function readLiveRecordMark(kind) {
  const recordKind = Number(kind);
  if (!RECORD_GETTER_BY_KIND.has(recordKind)) return null;
  const marks = await readLiveRecordMarks();
  return Array.isArray(marks) ? marks[recordKind] ?? null : null;
}

/** True only when `candidate` reaches the exact live bounty-paying target. */
export function candidateClaimsRecord(state, kind, candidate) {
  const target = recordClaimTarget(state, kind);
  if (target == null || target <= 0n) return false;
  let value;
  try { value = BigInt(candidate); } catch (_e) { return false; }
  return value >= target;
}

/**
 * The share curve a record claim takes from the pool — Coinflip.sol:166-168.
 * A 5% floor, +0.5% per day since THAT kind last stamped its clock, capped at
 * 75% (reached 140 days out). Mirrored here rather than read on chain: the
 * clock lives in `internal` storage with no getter.
 */
const SHARE_FLOOR_BPS = 500;
const SHARE_PER_DAY_BPS = 50;
const SHARE_CEIL_BPS = 7_500;

/**
 * What a claim on this record would take from the pool right now, in bps.
 *
 * An unset mark still has a live bounty. Coinflip's constructor stamps every
 * category at deploy day 1, and the `mark == 0` branch pays the share accrued
 * from that clock when somebody clears the category's entry floor. The API has
 * no event from which to reconstruct that untouched clock, so a null clock is
 * exactly inferable as day 1 only while `held` is false. For a held record whose
 * indexer clock is missing, the exact accrual is unknown but the contract's 5%
 * floor is not: show that guaranteed minimum rather than a misleading dash.
 *
 * @returns {number|null} bps, or null when it cannot be known
 */
export function accruedShareBps({ held, clockDay, today }) {
  // A held row without its clock can always be quoted at the contract floor,
  // even during the brief boot window before the app's current day arrives.
  if (clockDay == null && held) return SHARE_FLOOR_BPS;
  if (today == null) return null;
  // GameTimeLib is 1-indexed. Untouched categories have no BigRecordUpdated
  // event, but their constructor clock is known exactly. Some early indexed
  // deploy-day claims were stored as zero; normalize that impossible contract
  // day to day 1 as well.
  let stamped;
  if (clockDay == null) {
    stamped = 1;
  } else {
    stamped = Number(clockDay);
    if (stamped === 0) stamped = 1;
  }
  const now = Number(today);
  if (!Number.isInteger(stamped) || stamped <= 0
    || !Number.isInteger(now) || now <= 0) return null;
  const elapsed = now > stamped ? now - stamped : 0;
  return Math.min(SHARE_FLOOR_BPS + elapsed * SHARE_PER_DAY_BPS, SHARE_CEIL_BPS);
}

/** The pool FLIP that share is worth. null when the share is unknown. */
export function accruedPayoutWei(poolWei, shareBps) {
  if (shareBps == null) return null;
  return (toBigInt(poolWei) * BigInt(shareBps)) / 10_000n;
}

/**
 * Exact FLIP credit a live candidate would take from the shared pool.
 *
 * `0n` means the candidate does not clear this record's bounty bar. `null`
 * means it clears the bar but the current day is unavailable for a record
 * whose exact clock is known; a missing held clock still returns its guaranteed
 * 5% floor.
 */
export function candidateRecordPayoutWei({
  state,
  kind,
  candidate,
  today,
  poolWei = state?.recordPoolWei,
} = {}) {
  if (!candidateClaimsRecord(state, kind, candidate)) return 0n;
  const record = Array.isArray(state?.records)
    ? state.records.find((entry) => Number(entry?.kind) === Number(kind))
    : null;
  if (!record) return 0n;
  const shareBps = accruedShareBps({
    held: Boolean(record.held),
    clockDay: record.clockDay,
    today,
  });
  return accruedPayoutWei(poolWei, shareBps);
}

function group(value) {
  const [whole, fraction] = String(value ?? '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

/**
 * Render a record value in its own unit.
 *
 * @returns {{amount: string, suffix: string}} suffix is '' for ticket counts,
 *          which read as a bare number with their label supplied by the card.
 */
export function formatRecordValue(kind, raw) {
  const meta = recordKindMeta(kind);
  const value = toBigInt(raw);
  if (meta?.unit === 'eth') {
    return { amount: group(displayEthCompact(value, 4)), suffix: 'ETH' };
  }
  if (meta?.unit === 'tickets') {
    return { amount: group(value.toString()), suffix: 'TICKETS' };
  }
  return { amount: group(displayToken(value, 0)), suffix: 'FLIP' };
}

/** Short address for a holder with no linked Discord account. */
export function shortAddress(value) {
  const address = String(value || '');
  if (!address) return '—';
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Normalize the `/records` payload into four ordered, defensive slots.
 *
 * The route already zero-fills missing kinds, but a stale deploy or a partial
 * response must still produce four cards rather than a collapsing row.
 */
export function normalizeRecords(
  payload,
  liveRecordPool = null,
  liveRecordClocks = null,
  liveRecordMarks = null,
) {
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  const byKind = new Map(rows.map((row) => [Number(row?.kind), row]));

  return {
    recordPoolWei: liveRecordPool == null
      ? toBigInt(payload?.recordPool)
      : toBigInt(liveRecordPool),
    records: RECORD_KINDS.map((meta) => {
      const row = byKind.get(meta.kind) ?? null;
      const indexedValue = toBigInt(row?.value);
      const rawLiveMark = Array.isArray(liveRecordMarks)
        ? liveRecordMarks[meta.kind]
        : null;
      const liveMark = rawLiveMark == null ? null : toBigInt(rawLiveMark);
      // Permanent marks only ratchet upward. Taking the maximum prevents a
      // briefly lagging RPC from rolling back an already-indexed newer mark.
      const chainAhead = liveMark != null && liveMark > indexedValue;
      const value = chainAhead ? liveMark : indexedValue;
      const player = String(row?.player || '').toLowerCase() || null;
      const indexedClock = row?.clockDay == null || !Number.isInteger(Number(row.clockDay))
        ? null
        : Number(row.clockDay);
      const rawLiveClock = Array.isArray(liveRecordClocks)
        ? liveRecordClocks[meta.kind]
        : null;
      const liveClock = Number.isInteger(Number(rawLiveClock)) && Number(rawLiveClock) > 0
        ? Number(rawLiveClock)
        : null;
      return {
        kind: meta.kind,
        meta,
        // The contract has no holder getter. Never attach the old indexed
        // holder to a newer chain mark while BigRecordUpdated is catching up.
        player: value > 0n && !chainAhead ? player : null,
        value,
        barToBeat: barToBeat(value),
        claimCount: Number(row?.claimCount ?? 0) || 0,
        totalPaidFlip: toBigInt(row?.totalPaidFlip),
        // The packed chain clock is authoritative and also fills pre-migration
        // API rows. Explicit guards matter: Number(null) is 0, which would
        // otherwise max the accrued share instead of suppressing it.
        clockDay: liveClock ?? indexedClock,
        held: value > 0n,
      };
    }),
  };
}

/** GET indexed history plus the chain-authoritative pool, clocks, and marks. */
export async function fetchRecords() {
  const [payloadResult, poolResult, clocksResult, marksResult] = await Promise.allSettled([
    _fetchRecordsJSON('/records'),
    Promise.resolve().then(() => _readRecordPool()),
    Promise.resolve().then(() => _readRecordClocks()),
    Promise.resolve().then(() => _readRecordMarks()),
  ]);
  if (payloadResult.status === 'fulfilled') _lastRecordsPayload = payloadResult.value;
  return normalizeRecords(
    payloadResult.status === 'fulfilled' ? payloadResult.value : _lastRecordsPayload,
    poolResult.status === 'fulfilled' ? poolResult.value : null,
    clocksResult.status === 'fulfilled' ? clocksResult.value : null,
    marksResult.status === 'fulfilled' ? marksResult.value : null,
  );
}

/** Test-only readers for indexed history and authoritative chain state. */
export function __setRecordsReadersForTest({ json, pool, clocks, marks } = {}) {
  if (typeof json === 'function') _fetchRecordsJSON = json;
  if (typeof pool === 'function') _readRecordPool = pool;
  if (typeof clocks === 'function') _readRecordClocks = clocks;
  else if (typeof json === 'function' || typeof pool === 'function' || typeof marks === 'function') {
    // Existing reader-seam tests must never leak a public-RPC request.
    _readRecordClocks = async () => null;
  }
  if (typeof marks === 'function') _readRecordMarks = marks;
  else if (typeof json === 'function' || typeof pool === 'function' || typeof clocks === 'function') {
    _readRecordMarks = async () => null;
  }
}

export function __resetRecordsReadersForTest() {
  _fetchRecordsJSON = fetchJSON;
  _readRecordPool = readLiveRecordPool;
  _readRecordClocks = readLiveRecordClocks;
  _readRecordMarks = readLiveRecordMarks;
  _poolReadInflight = null;
  _lastLiveRecordPool = null;
  _clockReadInflight = null;
  _lastLiveRecordClocks = null;
  _markReadInflight = null;
  _lastLiveRecordMarks = null;
  _lastRecordsPayload = null;
}

// Discord display identity now lives in ./profiles.js so components that do
// not touch the chain can use it too. Re-exported here for existing callers.
export { fetchProfiles } from './profiles.js';
