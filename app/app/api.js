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
// A dashboard mounts several address-scoped panels at once. Letting every
// panel open a request simultaneously multiplies one browser into a database
// burst; a small per-tab lane preserves the primary player read while letting
// the remaining widgets fill progressively. Shared/global reads bypass this
// lane so health and game state never sit behind wallet history.
const MAX_PERSONALIZED_FETCHES = 3;
// Keep one of those slots available for reads that gate an explicit user
// action. Background panels may use two slots; an interaction can immediately
// take the third instead of waiting behind unrelated wallet hydration.
const MAX_BACKGROUND_PERSONALIZED_FETCHES = 2;
// A fetch with no deadline is not a slow read, it is a permanent one: the
// browser can hold a stalled connection open indefinitely, and every hung
// personalized read keeps its lane slot (released only in the finally below),
// so three of them wedge MAX_PERSONALIZED_FETCHES for the life of the tab.
// That is what stranded replay-panel's bonus spin at "BONUS SPINNING…" — its
// future-trait hydration never settled, so the flow never reached its reel.
// Well past any healthy p99, short enough that a wedged socket surfaces as a
// failed read the caller can retry.
const REQUEST_TIMEOUT_MS = 20_000;
const inflightJSON = new Map();
const recentJSON = new Map();
const personalizedQueue = [];
let personalizedActive = 0;
let personalizedBackgroundActive = 0;
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

function isPersonalizedKey(key) {
  let url;
  try { url = new URL(key, 'https://api.invalid'); } catch { return false; }
  const path = url.pathname;
  return path.startsWith('/player/')
    || path.startsWith('/viewer/player/')
    || path.startsWith('/replay/player-traits/')
    || /\/player\//.test(path)
    || /(?:^|[?&])player=0x[0-9a-f]{40}(?:&|$)/i.test(url.search);
}

function isInteractionPriority(priority) {
  return priority === 'interaction';
}

function canOpenPersonalizedSlot(priority) {
  if (personalizedActive >= MAX_PERSONALIZED_FETCHES) return false;
  return isInteractionPriority(priority)
    || personalizedBackgroundActive < MAX_BACKGROUND_PERSONALIZED_FETCHES;
}

function openPersonalizedSlot(priority) {
  const background = !isInteractionPriority(priority);
  personalizedActive += 1;
  if (background) personalizedBackgroundActive += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    personalizedActive = Math.max(0, personalizedActive - 1);
    if (background) {
      personalizedBackgroundActive = Math.max(0, personalizedBackgroundActive - 1);
    }
    drainPersonalizedQueue();
  };
}

function drainPersonalizedQueue() {
  while (personalizedActive < MAX_PERSONALIZED_FETCHES && personalizedQueue.length > 0) {
    let nextIndex = -1;
    let backgroundIndex = -1;
    for (let index = 0; index < personalizedQueue.length; index += 1) {
      const candidate = personalizedQueue[index];
      if (!candidate || candidate.settled || candidate.signal.aborted) {
        personalizedQueue.splice(index, 1);
        index -= 1;
        continue;
      }
      if (isInteractionPriority(candidate.priority)) {
        nextIndex = index;
        break;
      }
      if (backgroundIndex === -1 && canOpenPersonalizedSlot(candidate.priority)) {
        backgroundIndex = index;
      }
    }
    if (nextIndex === -1) nextIndex = backgroundIndex;
    if (nextIndex === -1) break;

    const [entry] = personalizedQueue.splice(nextIndex, 1);
    entry.settled = true;
    entry.signal.removeEventListener('abort', entry.onAbort);
    entry.setPromoter(null);
    entry.resolve(openPersonalizedSlot(entry.priority));
  }
}

function acquirePersonalizedSlot(signal, priority, setPromoter) {
  if (signal.aborted) throw abortError(signal);
  // Preserve the transport's existing same-turn start semantics when a slot is
  // free. Only saturated address traffic pays a queue/microtask hop.
  if (canOpenPersonalizedSlot(priority)) return openPersonalizedSlot(priority);
  return new Promise((resolve, reject) => {
    const entry = {
      signal,
      priority,
      resolve,
      reject,
      setPromoter,
      settled: false,
      onAbort: null,
      promote: null,
    };
    entry.promote = () => {
      if (entry.settled || isInteractionPriority(entry.priority)) return;
      entry.priority = 'interaction';
      drainPersonalizedQueue();
    };
    entry.onAbort = () => {
      if (entry.settled) return;
      entry.settled = true;
      const index = personalizedQueue.indexOf(entry);
      if (index !== -1) personalizedQueue.splice(index, 1);
      entry.setPromoter(null);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', entry.onAbort, { once: true });
    personalizedQueue.push(entry);
    entry.setPromoter(entry.promote);
    drainPersonalizedQueue();
  });
}

export class ApiRequestError extends Error {
  constructor(status, key, response) {
    super(`API ${status}: ${key}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.response = response;
  }
}

function createFlight(key, { cache, priority = 'background' } = {}) {
  const controller = new AbortController();
  const generation = cacheGeneration;
  const flight = {
    controller,
    consumers: 0,
    settled: false,
    promise: null,
    priority: isInteractionPriority(priority) ? 'interaction' : 'background',
    promoteQueued: null,
  };

  // The deadline is wall-clock time visible to the caller, so it includes
  // admission wait as well as response headers and body parsing.
  let timeoutTimer = setTimeout(() => {
    const timeout = new Error(`API request timed out: ${key}`);
    timeout.name = 'TimeoutError';
    try { controller.abort(timeout); } catch { /* already settled */ }
  }, REQUEST_TIMEOUT_MS);
  try { timeoutTimer?.unref?.(); } catch { /* browser timer */ }

  flight.promise = (async () => {
    let releaseSlot = null;
    try {
      // Shared with polling.js via this broker. Without this, a shedding API
      // stopped the timers but every panel kept knocking on its own schedule.
      const personalized = isPersonalizedKey(key);
      const cooldownScope = personalized ? 'personalized' : 'global';
      if (isCoolingDown(cooldownScope)) throw new Error(`API cooling down: ${key}`);
      const acquired = personalized
        ? acquirePersonalizedSlot(
            controller.signal,
            flight.priority,
            (promote) => { flight.promoteQueued = promote; },
          )
        : null;
      releaseSlot = acquired && typeof acquired.then === 'function'
        ? await acquired
        : acquired;
      // A different flight may have armed cooldown while this request waited
      // in the per-tab lane. Honor it before touching the network.
      if (isCoolingDown(cooldownScope)) throw new Error(`API cooling down: ${key}`);
      const res = await fetch(API_BASE + key, {
        signal: controller.signal,
        ...(cache ? { cache } : {}),
      });
      if (isShedStatus(res.status)) {
        noteShedLoad(res);
        try { await res.body?.cancel?.(); } catch { /* connection cleanup is best-effort */ }
        throw new ApiRequestError(res.status, key, res);
      }
      if (!res.ok) {
        try { await res.body?.cancel?.(); } catch { /* connection cleanup is best-effort */ }
        throw new ApiRequestError(res.status, key, res);
      }
      // A personalized success proves both the global condition and the
      // narrower wallet lane are open. Clear both ladders so an expired global
      // incident cannot make the next unrelated shed jump straight to a later
      // exponential-backoff step. A shared success must not clear a still-hot
      // personalized capacity gate.
      clearApiCooldown(personalized ? 'all' : 'global');
      const value = await res.json();
      // A transaction invalidation aborts old flights and advances the epoch.
      // Never let a late, pre-transaction response repopulate the recent cache.
      if (generation === cacheGeneration) recentSet(key, value);
      return value;
    } finally {
      if (timeoutTimer != null) {
        try { clearTimeout(timeoutTimer); } catch { /* defensive */ }
        timeoutTimer = null;
      }
      flight.promoteQueued = null;
      releaseSlot?.();
    }
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
export function fetchJSON(path, {
  signal,
  force = false,
  cache,
  priority = 'background',
} = {}) {
  const key = String(path);
  if (signal?.aborted) return Promise.reject(abortError(signal));

  if (!force) {
    const recent = recentGet(key);
    if (recent) return Promise.resolve(recent.value);
  }

  let flight = inflightJSON.get(key);
  if (!flight) {
    flight = createFlight(key, {
      cache: cache ?? (force ? 'no-store' : undefined),
      priority,
    });
    inflightJSON.set(key, flight);
  } else if (isInteractionPriority(priority) && !isInteractionPriority(flight.priority)) {
    // Coalescing is URL-keyed. Promote an already-queued background flight when
    // a user action attaches so first-caller order cannot defeat priority.
    flight.priority = 'interaction';
    flight.promoteQueued?.();
  }
  return attachConsumer(flight, signal);
}
