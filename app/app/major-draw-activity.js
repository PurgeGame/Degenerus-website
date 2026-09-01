// Shared gate for presentation-only automatic popups.
//
// Jackpot and daily-FLIP animations are the two pieces of UI that must never
// be covered by OPEN WHEN READY. Each animator marks its own source active;
// once the final source settles, automatic opens remain quiet for a short
// reading window. Explicit player clicks do not consult this gate.

export const MAJOR_DRAW_POPUP_BUFFER_MS = 10_000;

const _active = new Set();
const _listeners = new Set();
const _activityListeners = new Set();
let _blockedUntil = 0;
let _releaseTimer = null;

function _notify() {
  for (const listener of [..._listeners]) {
    try { listener(isAutomaticPopupBlocked()); } catch (_e) { /* observer isolation */ }
  }
}

function _notifyActivity() {
  const active = isMajorDrawActive();
  for (const listener of [..._activityListeners]) {
    try { listener(active); } catch (_e) { /* observer isolation */ }
  }
}

function _clearReleaseTimer() {
  if (_releaseTimer == null) return;
  try { clearTimeout(_releaseTimer); } catch (_e) { /* defensive */ }
  _releaseTimer = null;
}

function _scheduleRelease() {
  _clearReleaseTimer();
  if (_active.size > 0) return;
  const delay = Math.max(0, _blockedUntil - Date.now());
  if (delay === 0) {
    _notify();
    return;
  }
  _releaseTimer = setTimeout(() => {
    _releaseTimer = null;
    _notify();
  }, delay);
  if (_releaseTimer && typeof _releaseTimer.unref === 'function') {
    try { _releaseTimer.unref(); } catch (_e) { /* browser timer */ }
  }
}

/** Mark one major draw animation as active or settled. */
export function setMajorDrawActivity(source, active) {
  const key = String(source || 'draw');
  const wasBlocked = isAutomaticPopupBlocked();
  const wasActive = isMajorDrawActive();
  if (active) {
    _active.add(key);
    _clearReleaseTimer();
  } else if (_active.delete(key) && _active.size === 0) {
    _blockedUntil = Date.now() + MAJOR_DRAW_POPUP_BUFFER_MS;
    _scheduleRelease();
  }
  const blocked = isAutomaticPopupBlocked();
  if (isMajorDrawActive() !== wasActive) _notifyActivity();
  if (blocked !== wasBlocked || active) _notify();
  return blocked;
}

/** True only while a draw is actively animating (not during the popup cooldown). */
export function isMajorDrawActive() {
  return _active.size > 0;
}

export function isAutomaticPopupBlocked(now = Date.now()) {
  return _active.size > 0 || Number(now) < _blockedUntil;
}

export function subscribeAutomaticPopupGate(listener) {
  if (typeof listener !== 'function') return () => {};
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** Observe active-animation transitions without inheriting the popup cooldown. */
export function subscribeMajorDrawActivity(listener) {
  if (typeof listener !== 'function') return () => {};
  _activityListeners.add(listener);
  return () => _activityListeners.delete(listener);
}

/** Test-only: remove active sources, cooldowns, listeners, and timers. */
export function __resetMajorDrawActivityForTest() {
  _active.clear();
  _blockedUntil = 0;
  _clearReleaseTimer();
  _listeners.clear();
  _activityListeners.clear();
}
