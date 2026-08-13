// Shared shed-load gates for every read the app makes.
//
// Pollers and panels now use api.js's one abort-aware request broker; this
// module owns the backpressure state they share. Personalized-capacity
// responses use a narrower gate so they do not suppress the shared state the
// server protected.
//
// 503 is included deliberately: it is what the lag guard returns when the
// indexer falls behind, and hammering a struggling indexer is exactly wrong.
// A plain 500 is NOT — that is a bug, not backpressure, and backing off would
// only hide it.

const COOLDOWN_BASE_MS = 2_000;
const COOLDOWN_MAX_MS = 60_000;

let _cooldownUntil = 0;
let _consecutiveShed = 0;
let _personalizedCooldownUntil = 0;
let _personalizedConsecutiveShed = 0;

/** True while the API has asked this traffic class to back off. */
export function isCoolingDown(scope = 'global', nowMs = Date.now()) {
  return nowMs < _cooldownUntil
    || (scope === 'personalized' && nowMs < _personalizedCooldownUntil);
}

/** Timestamp the gate lifts; 0 when open. Exposed for tests and diagnostics. */
export function cooldownUntil() {
  return _cooldownUntil;
}

export function personalizedCooldownUntil() {
  return _personalizedCooldownUntil;
}

/** A successful read clears the gate and resets the backoff ladder. */
export function clearApiCooldown(scope = 'all') {
  if (scope === 'all' || scope === 'global') {
    _cooldownUntil = 0;
    _consecutiveShed = 0;
  }
  if (scope === 'all' || scope === 'personalized') {
    _personalizedCooldownUntil = 0;
    _personalizedConsecutiveShed = 0;
  }
}

/**
 * Record a 429/503 and arm the gate. Retry-After wins when the server sends
 * one; otherwise the delay doubles per consecutive shed, capped at 60s.
 *
 * @param {{headers?: {get?: (name: string) => string|null}}} res
 */
export function noteShedLoad(res) {
  // The API's personalized bulkhead deliberately protects cached shared state.
  // Preserve that isolation in the browser: only a capacity response explicitly
  // tagged personalized pauses wallet routes. Lag-guard 503s and 429s remain
  // global because every read would hit the same underlying condition.
  const personalized = res?.headers?.get?.('X-Load-Shed') === 'capacity'
    && res?.headers?.get?.('X-Capacity-Lane') === 'personalized';
  if (personalized) _personalizedConsecutiveShed += 1;
  else _consecutiveShed += 1;
  const consecutive = personalized ? _personalizedConsecutiveShed : _consecutiveShed;
  const retryAfterSec = Number(res?.headers?.get?.('Retry-After'));
  const base = Number.isFinite(retryAfterSec) && retryAfterSec > 0
    ? retryAfterSec * 1000
    : Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (consecutive - 1));
  // ±20% so a shed cohort does not all return in lockstep and re-shed itself.
  const until = Date.now() + Math.min(COOLDOWN_MAX_MS, base) * (0.8 + Math.random() * 0.4);
  if (personalized) _personalizedCooldownUntil = until;
  else _cooldownUntil = until;
}

/** True when this status means "stop asking", as opposed to "something broke". */
export function isShedStatus(status) {
  return status === 429 || status === 503;
}
