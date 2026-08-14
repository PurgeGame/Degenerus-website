// /app/app/read-provider.js — the ONE shared public chain-read provider
// (perf work order C15, 2026-08-14).
//
// Before this module, 14 modules each built a private JsonRpcProvider and most
// pinned `batchMaxCount: 1` to avoid per-module mount bursts — the net effect
// was ~127 separate RPC POSTs on a cold load, each its own HTTP request
// against the public RPC's rate limiter. One shared provider inverts that:
// every read issued in the same ~20ms window — across ALL modules — coalesces
// into a single JSON-RPC batch POST, so the mount wave costs a handful of
// requests instead of a hundred, and the RPC sees one orderly stream instead
// of 14 competing bursts.
//
// Knobs, and why they are what they are:
//   staticNetwork  — the chain is known from chain-config; never spend an
//                    eth_chainId probe per provider instance.
//   batchMaxCount  — 10. Public RPCs accept small batches happily; huge ones
//                    trip request-size/compute limits. 10 keeps any single
//                    POST modest while still collapsing the mount wave.
//   batchStallTime — 20ms. Long enough to catch a mount wave's same-tick
//                    reads, short enough to be invisible in interaction paths.
//
// The wallet's BrowserProvider (contracts.js) is NOT this — writes and
// wallet-session reads keep their own path. This module is for public
// chain-truth reads only.
//
// polling.js's gold-rush leg uses CHAIN.goldRushPublicRpcUrl (a different
// endpoint) and keeps its own provider — only CHAIN.rpcUrl readers share this.
//
// ---------------------------------------------------------------------------
// THE READ CACHE (C15 follow-on, 2026-08-14)
// ---------------------------------------------------------------------------
// Batching fixed the request COUNT but not the question count. A Playwright
// trace of a cold load measured 245 eth_calls asking only 80 distinct
// questions — the same read issued up to 9 times, because independent panels
// each ask the chain the same thing as they mount. Batching packs those
// duplicates into fewer POSTs; it still pays for every one of them in RPC
// compute, and the duplication grows with every panel added.
//
// So this provider answers a repeat question from memory, in two classes:
//
//   PINNED reads (an explicit block number) are IMMUTABLE — the state at a
//   mined block does not change — so a repeat is served from the cache with no
//   staleness whatsoever. Measured: 98 pinned calls asking 48 questions.
//
//   `latest` reads get the same one-second completed-response window the REST
//   broker uses (api.js RECENT_JSON_TTL_MS) and for the same measured reason:
//   in-flight sharing alone misses the panels that mount just after the first
//   response lands. One second is far below every 5s/15s/30s product cadence,
//   so no panel refreshes any less often than it used to.
//
// Combined, that policy answers 99 of 245 cold-load eth_calls (40%) without
// touching the wire; a 2s window was measured at 100, so the extra second buys
// one call and is not worth the staleness. Everything past the window is a
// genuine poll refresh and still goes to the chain.
//
// The freshness boundary is the same as REST's: contracts.js `sendTx` calls
// invalidateReadCache() the moment a receipt lands, before any component sees
// the confirmation event, so a confirmed write is never hidden by this window.
// Invalidation clears the pinned class too — cheap, and it means a reorg can
// never leave a rewritten block cached.

import { ethers } from 'ethers';
import { CHAIN } from './chain-config.js';

// Mirrors api.js RECENT_JSON_TTL_MS — one freshness rule across both transports.
const RECENT_CALL_TTL_MS = 1_000;
const MAX_RECENT_CALLS = 256;
const MAX_PINNED_CALLS = 512;

// Only these fields may appear on a request we are willing to cache. Anything
// else (value, gas, nonce, a field a future ethers adds) means we do not fully
// understand the request, so it goes straight to the wire — fail-open on
// correctness, never on freshness.
const CACHEABLE_FIELDS = new Set(['to', 'data', 'from', 'blockTag']);

const inflightCalls = new Map();
const recentCalls = new Map();
const pinnedCalls = new Map();

let _shared = null;

/**
 * Normalize a block tag into a cache-key fragment.
 * Returns null for anything we will not cache.
 */
function normalizeBlockTag(tag) {
  if (tag === undefined || tag === null || tag === 'latest') return 'latest';
  // 'pending' is explicitly a moving target — never cache it.
  if (tag === 'pending') return null;
  if (tag === 'safe' || tag === 'finalized') return String(tag);
  if (typeof tag === 'number' || typeof tag === 'bigint') return `#${BigInt(tag)}`;
  if (typeof tag === 'string' && /^0x[0-9a-f]+$/i.test(tag)) return `#${BigInt(tag)}`;
  return null;
}

/**
 * Build the cache identity for a call request.
 * @returns {{key: string, pinned: boolean}|null} null when the request must not be cached.
 */
export function _readCacheKey(tx) {
  if (!tx || typeof tx !== 'object') return null;
  for (const [field, value] of Object.entries(tx)) {
    if (value === undefined || value === null) continue;
    if (!CACHEABLE_FIELDS.has(field)) return null;
  }
  const to = typeof tx.to === 'string' ? tx.to.toLowerCase() : null;
  const data = typeof tx.data === 'string' ? tx.data : null;
  if (!to || !data) return null;
  const block = normalizeBlockTag(tx.blockTag);
  if (block === null) return null;
  const from = typeof tx.from === 'string' ? tx.from.toLowerCase() : '';
  return { key: `${to}|${data}|${from}|${block}`, pinned: block.startsWith('#') };
}

function recentGet(key) {
  const hit = recentCalls.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    recentCalls.delete(key);
    return null;
  }
  return hit;
}

function store(key, pinned, value) {
  const map = pinned ? pinnedCalls : recentCalls;
  const cap = pinned ? MAX_PINNED_CALLS : MAX_RECENT_CALLS;
  map.delete(key);
  map.set(key, pinned ? { value } : { value, expiresAt: Date.now() + RECENT_CALL_TTL_MS });
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * Wrap a provider's `call` so repeat questions are answered from memory.
 * Exported so tests can attach it to a stub provider.
 */
export function attachReadCache(provider) {
  if (!provider || typeof provider.call !== 'function' || provider._readCacheAttached) {
    return provider;
  }
  const perform = provider.call.bind(provider);
  provider.call = (tx) => {
    const identity = _readCacheKey(tx);
    if (identity === null) return perform(tx);
    const { key, pinned } = identity;

    const hit = pinned ? pinnedCalls.get(key) : recentGet(key);
    if (hit) return Promise.resolve(hit.value);

    const existing = inflightCalls.get(key);
    if (existing) return existing;

    // A failed read is never cached — only the in-flight entry is cleared, so
    // the next caller retries against the chain.
    const flight = perform(tx).then(
      (value) => {
        if (inflightCalls.get(key) === flight) inflightCalls.delete(key);
        store(key, pinned, value);
        return value;
      },
      (error) => {
        if (inflightCalls.get(key) === flight) inflightCalls.delete(key);
        throw error;
      },
    );
    inflightCalls.set(key, flight);
    return flight;
  };
  provider._readCacheAttached = true;
  return provider;
}

/**
 * Clear cached chain reads. Every confirmed transaction calls this before its
 * follow-up reads, so the one-second window never hides a write the wallet
 * just confirmed. Clears the pinned class too, so a reorg cannot leave a
 * rewritten block cached.
 */
export function invalidateReadCache() {
  recentCalls.clear();
  pinnedCalls.clear();
  inflightCalls.clear();
}

/** The shared public read provider (null when CHAIN.rpcUrl is unset). */
export function sharedReadProvider() {
  if (!_shared && CHAIN.rpcUrl) {
    _shared = attachReadCache(new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 10, batchStallTime: 20 },
    ));
  }
  return _shared;
}

/** Test hook: drop the singleton so a fresh CHAIN config takes effect. */
export function _resetSharedReadProviderForTests() {
  _shared = null;
  invalidateReadCache();
}

/** Test hook: cache occupancy, for assertions about what was retained. */
export function _readCacheStatsForTests() {
  return { recent: recentCalls.size, pinned: pinnedCalls.size, inflight: inflightCalls.size };
}
