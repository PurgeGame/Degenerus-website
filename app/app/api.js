// app/api.js — the components' REST client.
//
// This file used to carry a second, complete polling stack: startPolling,
// stopPolling, gameTimer/playerTimer/healthTimer/jackpotPollTimer,
// pollGameState, pollPlayerData, fetchPlayerData, checkHealth,
// refreshAfterAction, and its own consecutiveFails/MAX_BACKOFF — against a
// separate POLL_INTERVALS in constants.js. None of it ran. main.js imports
// `start` from polling.js, and every single `from './api.js'` in the codebase
// imports `{ fetchJSON }` and nothing else. Seven of eight exports were dead.
//
// It was worse than dead weight: it was ~200 lines of plausible, authoritative
// -looking polling code sitting next to the real thing, and it did mislead a
// reader looking for the app's backoff behaviour. Deleted 2026-08-07.
//
// What remains is the one thing components actually use.

import { API_BASE } from './constants.js';
import {
  isCoolingDown, noteShedLoad, clearApiCooldown, isShedStatus,
} from './api-cooldown.js';

// App panels mount and poll independently, while polling.js used to carry a
// second transport. A real browser trace found five identical /player reads in
// one 826ms burst: localhost answered too quickly for in-flight-only sharing to
// catch the later panels. Keep one abort-aware broker for BOTH call sites and a
// deliberately tiny completed-response window. One second is short enough not
// to change any 5s/15s/30s product cadence, but long enough to collapse a single
// render/poll wave even when the first response is already back.
const RECENT_JSON_TTL_MS = 1_000;
const MAX_RECENT_JSON = 256;
const inflightJSON = new Map();
const recentJSON = new Map();
let cacheGeneration = 0;

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function recentGet(key) {
  const hit = recentJSON.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    recentJSON.delete(key);
    return null;
  }
  return hit;
}

function recentSet(key, value) {
  recentJSON.delete(key);
  recentJSON.set(key, { value, expiresAt: Date.now() + RECENT_JSON_TTL_MS });
  while (recentJSON.size > MAX_RECENT_JSON) {
    const oldest = recentJSON.keys().next().value;
    if (oldest === undefined) break;
    recentJSON.delete(oldest);
  }
}

function createFlight(key) {
  const controller = new AbortController();
  const generation = cacheGeneration;
  const flight = {
    controller,
    consumers: 0,
    settled: false,
    promise: null,
  };

  flight.promise = (async () => {
    // Shared with polling.js via this broker. Without this, a shedding API
    // stopped the timers but every panel kept knocking on its own schedule.
    if (isCoolingDown()) throw new Error(`API cooling down: ${key}`);
    const res = await fetch(API_BASE + key, { signal: controller.signal });
    if (isShedStatus(res.status)) {
      noteShedLoad(res);
      throw new Error(`API ${res.status}: ${key}`);
    }
    if (!res.ok) throw new Error(`API ${res.status}: ${key}`);
    clearApiCooldown();
    const value = await res.json();
    // A transaction invalidation aborts old flights and advances the epoch.
    // Never let a late, pre-transaction response repopulate the recent cache.
    if (generation === cacheGeneration) recentSet(key, value);
    return value;
  })().finally(() => {
    flight.settled = true;
    if (inflightJSON.get(key) === flight) inflightJSON.delete(key);
  });

  return flight;
}

function attachConsumer(flight, signal) {
  flight.consumers += 1;
  return new Promise((resolve, reject) => {
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      if (signal) signal.removeEventListener('abort', onAbort);
      flight.consumers = Math.max(0, flight.consumers - 1);
      // A hidden tab/account switch still cancels actual network work when no
      // other panel is using it. One caller aborting cannot sink shared work.
      if (flight.consumers === 0 && !flight.settled) flight.controller.abort();
    };
    const onAbort = () => {
      release();
      reject(abortError(signal));
    };

    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    flight.promise.then(
      (value) => {
        if (!active) return;
        release();
        resolve(value);
      },
      (error) => {
        if (!active) return;
        release();
        reject(error);
      },
    );
  });
}

/**
 * Clear completed reads and cancel pre-invalidation flights. Every confirmed
 * transaction calls this before its follow-up reads, so the one-second burst
 * window never hides a write that the wallet just confirmed.
 */
export function invalidateJSONCache() {
  cacheGeneration += 1;
  recentJSON.clear();
  for (const flight of inflightJSON.values()) flight.controller.abort();
  inflightJSON.clear();
}

/**
 * Shared GET client for panels and polling.js.
 *
 * Each caller gets independent AbortSignal semantics. The underlying fetch is
 * aborted only when every consumer has gone away.
 */
export function fetchJSON(path, { signal, force = false } = {}) {
  const key = String(path);
  if (signal?.aborted) return Promise.reject(abortError(signal));

  if (!force) {
    const recent = recentGet(key);
    if (recent) return Promise.resolve(recent.value);
  }

  let flight = inflightJSON.get(key);
  if (!flight) {
    flight = createFlight(key);
    inflightJSON.set(key, flight);
  }
  return attachConsumer(flight, signal);
}
