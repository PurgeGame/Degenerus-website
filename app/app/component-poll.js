// /app/app/component-poll.js — the shared component poll scheduler
// (launch-readiness roadmap item 3, 2026-08-15).
//
// Before this module, ~25 components each owned a private setInterval, most
// with a copy-pasted _setIntervalUnref helper and no visibility handling:
// a hidden tab kept every panel polling the APIs and RPC forever. This
// scheduler gives every component timer the same discipline polling.js gives
// its own four cycles:
//
//   - hidden tab  → every registered poll STOPS (zero background traffic);
//   - visible     → every poll fires IMMEDIATELY (coherent catch-up, same
//                   philosophy as polling.js's return-from-hidden re-poll),
//                   then re-arms on its own interval;
//   - unregister  → idempotent, safe in disconnectedCallback.
//
// Registration does NOT fire the callback up front — components keep their
// existing mount-time refresh call, so ordering semantics stay identical to
// the setInterval they replace. Ticks are fire-and-forget; a rejected poll
// logs nothing here (components already handle their own errors).

const entries = new Set();
let listening = false;

function isHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function arm(entry) {
  if (entry.timer != null || isHidden()) return;
  entry.timer = setInterval(entry.fn, entry.intervalMs);
  // Node (tests) returns a Timeout with unref; browsers return a number.
  if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
}

function disarm(entry) {
  if (entry.timer == null) return;
  clearInterval(entry.timer);
  entry.timer = null;
}

function onVisibilityChange() {
  if (isHidden()) {
    for (const entry of entries) disarm(entry);
    return;
  }
  for (const entry of entries) {
    // Immediate catch-up, then the normal cadence.
    try { entry.fn(); } catch { /* the component's own error handling owns this */ }
    arm(entry);
  }
}

function ensureListener() {
  if (listening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  listening = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
}

/**
 * Register a repeating poll. Returns an idempotent unregister function.
 * Call from connectedCallback; call the returned fn from disconnectedCallback.
 */
export function registerComponentPoll(fn, intervalMs) {
  if (typeof fn !== 'function' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return () => {};
  }
  ensureListener();
  const entry = { fn, intervalMs, timer: null };
  entries.add(entry);
  arm(entry);
  return () => {
    if (!entries.has(entry)) return;
    disarm(entry);
    entries.delete(entry);
  };
}

/** Test hooks. */
export function _componentPollStatsForTests() {
  let armed = 0;
  for (const entry of entries) if (entry.timer != null) armed++;
  return { registered: entries.size, armed };
}
export function _resetComponentPollsForTests() {
  for (const entry of entries) disarm(entry);
  entries.clear();
}
export const _onVisibilityChangeForTests = onVisibilityChange;
