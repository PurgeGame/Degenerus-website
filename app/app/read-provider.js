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

// Mirrors api.js cacheGeneration: a read that was IN FLIGHT when the receipt
// boundary invalidated must not repopulate the cache when it lands — its value
// was computed against pre-confirmation state.
let cacheGeneration = 0;

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

// ---------------------------------------------------------------------------
// MULTICALL AGGREGATION (C15 step 3, 2026-08-14)
// ---------------------------------------------------------------------------
// The read cache killed REPETITION; this layer kills FAN-OUT. Distinct
// questions issued in the same stall window — the app's mount waves ask ~80+
// of them — collapse into ONE eth_call to the canonical Multicall3 contract
// (same address on every chain), instead of one eth_call each. The public
// RPC's rate limiter counts calls, not bytes, so this is the difference
// between a cold load spending ~100+ calls and spending a handful. Bonus:
// every question in an aggregate is answered at the SAME block.
//
// Safety properties, each load-bearing:
//   - Only pure {to, data, blockTag} reads aggregate. A `from` changes
//     msg.sender inside Multicall3, so sender-flavored reads go direct. Any
//     unknown field goes direct (same fail-open rule as the cache).
//   - aggregate3 runs with allowFailure=true; a sub-call that reverted is
//     RETRIED individually so the caller receives ethers' genuine
//     CALL_EXCEPTION (custom-error data intact), not a synthesized one.
//   - If the aggregate itself fails (RPC gas cap, transport), every entry
//     falls back to a direct call — correctness never depends on Multicall3.
//   - One getCode probe per provider decides availability. Chains without
//     Multicall3 (the local anvil sim) keep exactly today's behavior. Calls
//     arriving before the probe resolves are QUEUED, not sent direct — the
//     first mount wave is precisely the fan-out this layer exists to catch.
//
// Order of wrappers: cache ABOVE, multicall BELOW — a cached answer must
// never spend a slot in an aggregate.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL_STALL_MS = 20;   // matches the provider's own batchStallTime
const MULTICALL_MAX_BATCH = 25;  // keeps one aggregate under public-RPC eth_call gas caps
let _multicallIface = null;
function multicallIface() {
  if (!_multicallIface) {
    _multicallIface = new ethers.Interface([
      'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
    ]);
  }
  return _multicallIface;
}

/** Aggregatable = the cache's pure-read shape, minus any sender identity. */
function _multicallIdentity(tx) {
  const identity = _readCacheKey(tx);
  if (identity === null) return null;
  if (typeof tx.from === 'string' && tx.from !== '') return null;
  if (String(tx.to).toLowerCase() === MULTICALL3.toLowerCase()) return null;
  const tag = normalizeBlockTag(tx.blockTag);
  // 'safe'/'finalized' are moving tags the aggregate would pin differently
  // per group member on a reorg boundary — rare enough to just go direct.
  if (tag !== 'latest' && !tag.startsWith('#')) return null;
  return tag;
}

/**
 * Wrap a provider's `call` so same-window distinct questions travel as one
 * Multicall3 aggregate. Exported so tests can attach it to a stub provider.
 */
export function attachMulticall(provider) {
  if (!provider || typeof provider.call !== 'function' || provider._multicallAttached) {
    return provider;
  }
  const perform = provider.call.bind(provider);
  let available = null;          // null = probing, then true/false forever
  let probeStarted = false;
  const groups = new Map();     // blockTag fragment -> { entries, timer }

  const flushGroup = (tag) => {
    const group = groups.get(tag);
    if (!group) return;
    groups.delete(tag);
    for (let i = 0; i < group.entries.length; i += MULTICALL_MAX_BATCH) {
      const chunk = group.entries.slice(i, i + MULTICALL_MAX_BATCH);
      if (chunk.length === 1) {
        // A lone question gains nothing from the wrapper contract.
        const e = chunk[0];
        perform(e.tx).then(e.resolve, e.reject);
        continue;
      }
      const data = multicallIface().encodeFunctionData('aggregate3', [
        chunk.map((e) => ({ target: e.tx.to, allowFailure: true, callData: e.tx.data })),
      ]);
      const aggTx = { to: MULTICALL3, data };
      if (tag !== 'latest') aggTx.blockTag = chunk[0].tx.blockTag;
      perform(aggTx).then(
        (raw) => {
          let results;
          try {
            [results] = multicallIface().decodeFunctionResult('aggregate3', raw);
          } catch {
            // Undecodable aggregate (a proxy RPC mangling calls, or a
            // codeless address answering '0x') — never trust it again.
            available = false;
            for (const e of chunk) perform(e.tx).then(e.resolve, e.reject);
            return;
          }
          chunk.forEach((e, idx) => {
            const r = results[idx];
            if (r.success) e.resolve(r.returnData);
            // Reverted inside the aggregate: retry direct so the caller gets
            // ethers' real error object, revert data and all.
            else perform(e.tx).then(e.resolve, e.reject);
          });
        },
        () => {
          for (const e of chunk) perform(e.tx).then(e.resolve, e.reject);
        },
      );
    }
  };

  const flushAll = () => {
    for (const tag of [...groups.keys()]) {
      const group = groups.get(tag);
      if (group?.timer != null) clearTimeout(group.timer);
      flushGroup(tag);
    }
  };

  const drainDirect = () => {
    for (const tag of [...groups.keys()]) {
      const group = groups.get(tag);
      groups.delete(tag);
      if (group.timer != null) clearTimeout(group.timer);
      for (const e of group.entries) perform(e.tx).then(e.resolve, e.reject);
    }
  };

  const startProbe = () => {
    if (probeStarted) return;
    probeStarted = true;
    const probe = typeof provider.getCode === 'function'
      ? provider.getCode(MULTICALL3)
      : Promise.reject(new Error('no getCode'));
    probe.then(
      (code) => { available = typeof code === 'string' && code.length > 2; },
      () => { available = false; },
    ).then(() => { available ? flushAll() : drainDirect(); });
  };

  provider.call = (tx) => {
    const tag = _multicallIdentity(tx);
    if (tag === null || available === false) return perform(tx);
    return new Promise((resolve, reject) => {
      let group = groups.get(tag);
      if (!group) {
        group = { entries: [], timer: null };
        groups.set(tag, group);
        // While the probe is unresolved the group has NO timer — the probe's
        // completion is the flush signal, so the first mount wave aggregates.
        if (available === true) {
          group.timer = setTimeout(() => { group.timer = null; flushGroup(tag); }, MULTICALL_STALL_MS);
        }
      }
      group.entries.push({ tx, resolve, reject });
      if (available === null) startProbe();
    });
  };
  provider._multicallAttached = true;
  return provider;
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
    const generation = cacheGeneration;
    const flight = perform(tx).then(
      (value) => {
        if (inflightCalls.get(key) === flight) inflightCalls.delete(key);
        if (generation === cacheGeneration) store(key, pinned, value);
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
  cacheGeneration += 1;
  recentCalls.clear();
  pinnedCalls.clear();
  inflightCalls.clear();
}

// ---------------------------------------------------------------------------
// TRANSPORT FAILOVER (2026-08-14)
// ---------------------------------------------------------------------------
// The app ships ONE primary endpoint; when CHAIN.fallbackRpcUrls lists spares,
// this replaces the provider's `_send` (ethers' raw HTTP hook — batching, the
// multicall layer and the read cache all sit ABOVE it, untouched) with one
// that walks the endpoint list on TRANSPORT failures only: network errors,
// non-2xx (429/5xx), unparseable bodies, or a hang past the timeout. A revert
// is a SUCCESSFUL response carrying a JSON-RPC error object and passes
// through unchanged — failover can never rewrite an error the contract meant.
// After PROMOTE_AFTER consecutive primary failures the preferred index
// advances so live traffic stops paying the dead endpoint's timeout; a later
// rotation can land back on the primary once it recovers.
const FAILOVER_TIMEOUT_MS = 10_000;
const PROMOTE_AFTER = 3;

/** Build a `_send` that walks `urls`. Exported with injectable fetch for tests. */
export function _makeFailoverSend(urls, fetchImpl) {
  const doFetch = fetchImpl ?? ((...args) => fetch(...args));
  const state = { preferred: 0, consecutiveFailures: 0 };
  const send = async (payload) => {
    let lastError;
    // Anchor the walk to the preference AT REQUEST START — mid-request
    // promotion must only redirect FUTURE requests, never skew this walk.
    const start = state.preferred;
    for (let attempt = 0; attempt < urls.length; attempt++) {
      const index = (start + attempt) % urls.length;
      try {
        const response = await doFetch(urls[index], {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(FAILOVER_TIMEOUT_MS) : undefined,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} from ${urls[index]}`);
        const json = await response.json();
        if (index === state.preferred) state.consecutiveFailures = 0;
        return Array.isArray(json) ? json : [json];
      } catch (error) {
        lastError = error;
        if (index === state.preferred) {
          state.consecutiveFailures += 1;
          if (state.consecutiveFailures >= PROMOTE_AFTER) {
            state.preferred = (state.preferred + 1) % urls.length;
            state.consecutiveFailures = 0;
          }
        }
      }
    }
    throw lastError;
  };
  send._state = state; // test hook
  return send;
}

/** The shared public read provider (null when CHAIN.rpcUrl is unset). */
export function sharedReadProvider() {
  if (!_shared && CHAIN.rpcUrl) {
    // Cache above, multicall below: a cached answer never spends an
    // aggregate slot; a cache MISS joins the window's aggregate.
    const provider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 10, batchStallTime: 20 },
    );
    const fallbacks = Array.isArray(CHAIN.fallbackRpcUrls) ? CHAIN.fallbackRpcUrls.filter(Boolean) : [];
    if (fallbacks.length > 0) {
      provider._send = _makeFailoverSend([CHAIN.rpcUrl, ...fallbacks]);
    }
    _shared = attachReadCache(attachMulticall(provider));
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
