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
// existing mount-time refresh call. Each registration is single-flight: ticks
// that arrive while an async refresh is running collapse into one trailing
// refresh instead of stacking duplicate RPC/API work behind a slow endpoint.

import {
  isMajorDrawActive,
  subscribeMajorDrawActivity,
} from './major-draw-activity.js';

const entries = new Set();
let listening = false;
let drawUnsubscribe = null;

function isHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function isPaused() {
  return isHidden() || isMajorDrawActive();
}

function run(entry) {
  if (!entries.has(entry) || isPaused()) return;
  if (entry.running) {
    entry.trailing = true;
    return;
  }
  entry.running = true;
  let result;
  try { result = entry.fn(); }
  catch (_e) { result = undefined; }
  Promise.resolve(result).catch(() => {
    // Components own their presentation/error policy. Consuming the rejection
    // here prevents an otherwise-handled poll from becoming an unhandled one.
  }).finally(() => {
    entry.running = false;
    if (!entries.has(entry) || isPaused()) {
      entry.trailing = false;
      return;
    }
    if (entry.trailing) {
      entry.trailing = false;
      run(entry);
    }
  });
}

function arm(entry) {
  if (entry.timer != null || isPaused()) return;
  entry.timer = setInterval(() => run(entry), entry.intervalMs);
  // Node (tests) returns a Timeout with unref; browsers return a number.
  if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
}

function disarm(entry) {
  if (entry.timer == null) return;
  clearInterval(entry.timer);
  entry.timer = null;
}

function onVisibilityChange() {
  if (isPaused()) {
    for (const entry of entries) disarm(entry);
    return;
  }
  for (const entry of entries) {
    // Immediate catch-up, then the normal cadence.
    run(entry);
    arm(entry);
  }
}

function onMajorDrawActivity(active) {
  if (active) {
    for (const entry of entries) {
      disarm(entry);
      // A tick that arrived behind an in-flight request must not burst into
      // the draw when that request settles.
      entry.trailing = false;
    }
    return;
  }
  // Resume from a fresh interval. An immediate catch-up here would simply
  // move the deferred work into the final reel/scratch handoff.
  for (const entry of entries) arm(entry);
}

function ensureListener() {
  if (!drawUnsubscribe) drawUnsubscribe = subscribeMajorDrawActivity(onMajorDrawActivity);
  if (!listening && typeof document !== 'undefined'
    && typeof document.addEventListener === 'function') {
    listening = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
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
  const entry = { fn, intervalMs, timer: null, running: false, trailing: false };
  entries.add(entry);
  arm(entry);
  return () => {
    if (!entries.has(entry)) return;
    disarm(entry);
    entry.trailing = false;
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
  try { drawUnsubscribe?.(); } catch (_e) { /* defensive */ }
  drawUnsubscribe = null;
}
export const _onVisibilityChangeForTests = onVisibilityChange;
