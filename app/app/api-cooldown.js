// Shared shed-load gate for every read the app makes.
//
// There are two REST clients — api.js's fetchJSON (components, no signal) and
// polling.js's fetchJSONWithSignal (the timers, abortable). They stay separate
// on purpose: polling needs AbortController-per-cycle and components do not.
// But backpressure has to be shared, or half the app keeps hammering an API
// that told the other half to stop.
//
// 503 is included deliberately: it is what the lag guard returns when the
// indexer falls behind, and hammering a struggling indexer is exactly wrong.
// A plain 500 is NOT — that is a bug, not backpressure, and backing off would
// only hide it.

const COOLDOWN_BASE_MS = 2_000;
const COOLDOWN_MAX_MS = 60_000;

let _cooldownUntil = 0;
let _consecutiveShed = 0;

/** True while the API has asked us to back off. Callers must not fetch. */
export function isCoolingDown(nowMs = Date.now()) {
  return nowMs < _cooldownUntil;
}

/** Timestamp the gate lifts; 0 when open. Exposed for tests and diagnostics. */
export function cooldownUntil() {
  return _cooldownUntil;
}

/** A successful read clears the gate and resets the backoff ladder. */
export function clearApiCooldown() {
  _cooldownUntil = 0;
  _consecutiveShed = 0;
}

/**
 * Record a 429/503 and arm the gate. Retry-After wins when the server sends
 * one; otherwise the delay doubles per consecutive shed, capped at 60s.
 *
 * @param {{headers?: {get?: (name: string) => string|null}}} res
 */
export function noteShedLoad(res) {
  _consecutiveShed += 1;
  const retryAfterSec = Number(res?.headers?.get?.('Retry-After'));
  const base = Number.isFinite(retryAfterSec) && retryAfterSec > 0
    ? retryAfterSec * 1000
    : Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (_consecutiveShed - 1));
  // ±20% so a shed cohort does not all return in lockstep and re-shed itself.
  _cooldownUntil = Date.now() + Math.min(COOLDOWN_MAX_MS, base) * (0.8 + Math.random() * 0.4);
}

/** True when this status means "stop asking", as opposed to "something broke". */
export function isShedStatus(status) {
  return status === 429 || status === 503;
}
