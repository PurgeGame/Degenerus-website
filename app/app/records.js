// /app/app/records.js — the four all-time records and the pool they claim from.
//
// One shared FLIP pool (Coinflip.sol:218 `recordPool`) backs four permanent
// high-water marks: biggest flip, biggest Degenerette spin, biggest lootbox
// deposit, biggest ticket buy. The pool takes a 2,000 FLIP drip every
// settlement (:1133) plus level-transition funding, so it grows every day
// nobody breaks a record.
//
// ⛔ THE MARKS ARE ON CHAIN; THE HOLDERS ARE NOT. Every `biggest*Ever` slot
// holds a bare uint128 — no address. The holder exists only in
// `BigRecordUpdated(kind, player, value, paid, sdgnrsPaid)`, which the indexer
// rolls into `coinflip_records`. The shared pool is different: a successful
// claim subtracts `paid` immediately inside `_armBigRecord`, between settlement
// snapshots, so its headline is read directly from `recordPool()` while the DB
// remains the source for holder and record history.

import { fetchJSON } from './api.js';
import { CHAIN, CONTRACTS, ETH_DIVISOR } from './chain-config.js';
import { ethers, getProvider } from './contracts.js';
import { displayEthCompact, displayToken } from './scaling.js';

/** RECORD_KIND_* — ICoinflip.sol:14-17. Slot order is the render order. */
export const RECORD_KIND_FLIP = 0;
export const RECORD_KIND_SPIN = 1;
export const RECORD_KIND_LUCKBOX = 2;
export const RECORD_KIND_BUY = 3;

/** Session API — the only place an address maps to a Discord display identity. */
const SESSION_API = 'https://api.degener.us';
const RECORD_POOL_ABI = ['function recordPool() external view returns (uint128)'];

let _publicPoolProvider = null;
let _poolReadInflight = null;
let _lastLiveRecordPool = null;
let _fetchRecordsJSON = fetchJSON;
let _readRecordPool = readLiveRecordPool;

/**
 * Per-kind presentation facts.
 *
 * `unit` drives formatting and is NOT interchangeable: FLIP wei for the flip
 * record, ETH wei for spin and lootbox, a plain whole-ticket COUNT for the buy
 * record (`entryQuantityScaled / (4 * QTY_SCALE)` —
 * DegenerusGameFoilPackModule.sol:199-202, so no ticket divisor applies).
 *
 * `floorText` is the entry floor below which a candidate never even reads the
 * record slot. The FLIP and ticket floors are chain-invariant so they are
 * stated outright; the two ETH floors are contract literals that the testnet
 * deploy carries at /1M scale, so they are only named on mainnet.
 */
export const RECORD_KINDS = [
  {
    kind: RECORD_KIND_FLIP,
    unit: 'flip',
    label: 'BIGGEST FLIP',
    short: 'FLIP',
    // Coinflip.sol:174 BIGGEST_FLIP_MIN = 200_000 ether (FLIP, unscaled).
    floorText: '200,000+ FLIP takes it',
    verb: 'flip',
  },
  {
    kind: RECORD_KIND_SPIN,
    unit: 'eth',
    label: 'BIGGEST DEGENERETTE',
    short: 'DEGENERETTE',
    // DegenerusGameDegeneretteModule.sol:256 BIGGEST_SPIN_MIN_ETH = 1 ether.
    floorText: ETH_DIVISOR === 1n ? '1+ ETH takes it' : 'any qualifying spin takes it',
    verb: 'spin',
  },
  {
    kind: RECORD_KIND_LUCKBOX,
    unit: 'eth',
    label: 'BIGGEST LUCKBOX',
    short: 'LUCKBOX',
    // DegenerusGameMintModule.sol:131 BIGGEST_BOX_MIN_ETH = 5 ether.
    floorText: ETH_DIVISOR === 1n ? '5+ ETH takes it' : 'any qualifying lootbox takes it',
    verb: 'lootbox',
  },
  {
    kind: RECORD_KIND_BUY,
    unit: 'tickets',
    label: 'BIGGEST DEGEN',
    short: 'DEGEN',
    // DegenerusGame.sol:162 BIGGEST_BUY_MIN_TICKETS = 100 (whole tickets).
    floorText: '100+ tickets takes it',
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
    _publicPoolProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 1 },
    );
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
 * ⛔ AN UNSET MARK IS ALWAYS ZERO. The contract only stamps a clock when a mark
 * is written, so an unset record reads day 0 and the curve would saturate
 * straight to the 75% ceiling — while the `mark == 0` bootstrap branch
 * (Coinflip.sol:863-867) in fact pays nothing at all. Returns null when the
 * clock is unknown (a row indexed before clockDay existed), which renders as
 * "share unknown" rather than a fabricated number.
 *
 * @returns {number|null} bps, or null when it cannot be known
 */
export function accruedShareBps({ held, clockDay, today }) {
  if (!held) return 0;
  // Explicit null guards before coercion: Number(null) is 0 and passes
  // isInteger, which would read an unknown clock as "stamped on day zero" and
  // hand back a fully accrued share.
  if (clockDay == null || today == null) return null;
  const stamped = Number(clockDay);
  const now = Number(today);
  if (!Number.isInteger(stamped) || !Number.isInteger(now) || now <= 0) return null;
  const elapsed = now > stamped ? now - stamped : 0;
  return Math.min(SHARE_FLOOR_BPS + elapsed * SHARE_PER_DAY_BPS, SHARE_CEIL_BPS);
}

/** The pool FLIP that share is worth. null when the share is unknown. */
export function accruedPayoutWei(poolWei, shareBps) {
  if (shareBps == null) return null;
  return (toBigInt(poolWei) * BigInt(shareBps)) / 10_000n;
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
export function normalizeRecords(payload, liveRecordPool = null) {
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  const byKind = new Map(rows.map((row) => [Number(row?.kind), row]));

  return {
    recordPoolWei: liveRecordPool == null
      ? toBigInt(payload?.recordPool)
      : toBigInt(liveRecordPool),
    records: RECORD_KINDS.map((meta) => {
      const row = byKind.get(meta.kind) ?? null;
      const value = toBigInt(row?.value);
      const player = String(row?.player || '').toLowerCase() || null;
      return {
        kind: meta.kind,
        meta,
        player: value > 0n ? player : null,
        value,
        // Trust the server's bar when present so the two cannot drift, but
        // recompute if an older deploy omits it.
        barToBeat: row?.barToBeat != null ? toBigInt(row.barToBeat) : barToBeat(value),
        claimCount: Number(row?.claimCount ?? 0) || 0,
        totalPaidFlip: toBigInt(row?.totalPaidFlip),
        // Explicit null guard: Number(null) is 0, and a 0 here would read as
        // "stamped on day zero" and max the share instead of suppressing it.
        clockDay: row?.clockDay == null || !Number.isInteger(Number(row.clockDay))
          ? null
          : Number(row.clockDay),
        held: value > 0n,
      };
    }),
  };
}

/** GET the four records plus the shared pool. Throws on a failed read. */
export async function fetchRecords() {
  const [payload, liveRecordPool] = await Promise.all([
    _fetchRecordsJSON('/records'),
    Promise.resolve().then(() => _readRecordPool()).catch(() => null),
  ]);
  return normalizeRecords(payload, liveRecordPool);
}

/** Test-only readers for the API history and authoritative pool getter. */
export function __setRecordsReadersForTest({ json, pool } = {}) {
  if (typeof json === 'function') _fetchRecordsJSON = json;
  if (typeof pool === 'function') _readRecordPool = pool;
}

export function __resetRecordsReadersForTest() {
  _fetchRecordsJSON = fetchJSON;
  _readRecordPool = readLiveRecordPool;
  _poolReadInflight = null;
  _lastLiveRecordPool = null;
}

/**
 * Map record-holder addresses to their public Discord display identity.
 *
 * Unlinked addresses are simply absent from the response, so the caller keeps
 * its shortened-address fallback for them. Never throws: an identity layer
 * outage must not blank the records themselves.
 *
 * @returns {Promise<Map<string, {name: string, avatar: string|null}>>} keyed by
 *          lowercased address
 */
export async function fetchProfiles(addresses) {
  const unique = [...new Set(
    (addresses || [])
      .map((address) => String(address || '').toLowerCase())
      .filter((address) => /^0x[0-9a-f]{40}$/.test(address)),
  )];
  const out = new Map();
  if (unique.length === 0) return out;

  try {
    const url = `${SESSION_API}/api/profiles?addresses=${encodeURIComponent(unique.join(','))}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return out;
    const body = await res.json();
    for (const profile of (Array.isArray(body?.profiles) ? body.profiles : [])) {
      const address = String(profile?.address || '').toLowerCase();
      const name = String(profile?.discord_name || '').trim();
      if (!address || !name) continue;
      const avatar = String(profile?.discord_avatar || '').trim();
      out.set(address, {
        name,
        // Only ever an https CDN URL. Anything else is dropped rather than
        // written into an img src.
        avatar: /^https:\/\//.test(avatar) ? avatar : null,
      });
    }
  } catch (_e) { /* identity is decoration; the records still render */ }
  return out;
}
