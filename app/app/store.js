// /app/app/store.js — Phase 58 Plan 02 reactive store (DD-03).
//
// EXTENDS the 58-01 minimal shim (preserved API: get/update/subscribe + namespaces).
// Adds:
//   - batch({updates}) — multi-path with deduplicated subscriber notifications
//   - deriveCanSign() — true iff mode==='self' AND chainOk===true AND connected.address truthy
//   - getViewedAddress() — viewing.address || connected.address || null (polling target precedence)
//   - ui.mode auto-derivation: 'view' when viewing.address && (!connected || viewing!==connected); 'self' otherwise
//   - __resetForTest() — node:test helper to reset state between cases (NOT for production)
//
// Mirrors /beta/app/store.js path-walk + ancestor-walk subscribe pattern (verified at /beta/
// scale across 16 panels — RESEARCH §Don't Hand-Roll). /app/-namespaced state shape:
//   - connected.{address, chainId, rdns}      — written by wallet.js (58-01)
//   - viewing.{address}                        — written by router.js (?as=) + player-dropdown
//   - ui.{mode, chainOk, walletPickerOpen}     — mode auto-derived
//
// ui.mode auto-derive policy:
//   - viewing.address change → schedule derive (always — mode is a function of viewing)
//   - connected.address change → schedule derive ONLY when viewing.address is truthy
//   - The derive itself runs via queueMicrotask, NOT synchronously inside update().
//     Rationale: beta/app/store.js subscribers fire synchronously inside update(),
//     and 58-01's contracts.test.js exercises requireSelf() SYNCHRONOUSLY right after
//     update('viewing.address', X) — expecting layer-3 chokepoint ("Connected wallet
//     does not match viewing target") to fire. If derive ran synchronously, mode would
//     flip to 'view' first and layer-1 would throw a different message. Microtask
//     deferral preserves the 58-01 chokepoint test's synchronous-state-snapshot semantics
//     while still flipping mode before any actual UI render or async signing flow.

const _state = {
  connected: {
    address: null,    // 0x... lowercase | null — set by wallet.js
    chainId: null,    // number | null
    rdns: null,       // string | null — for "Connected via MetaMask" display
  },
  viewing: {
    address: null,    // 0x... lowercase | null — set by router.js (?as=) or player-dropdown.js
  },
  ui: {
    mode: 'self',          // 'self' | 'view' (auto-derived)
    chainOk: null,         // boolean | null — null = no wallet; true/false = on/off Sepolia
    walletPickerOpen: false,
  },
  // Phase 60+ adds: game.*, player.*, claims.*, ... (mirroring /beta/app/store.js shape)
};

// path-keyed subscriber registry: 'connected.address' → Set<fn>
const _subs = new Map();

// ---------------------------------------------------------------------------
// Path walkers (verbatim shape from /beta/app/store.js getPath / set helpers).
// ---------------------------------------------------------------------------

function getPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// notify — exact-path subscribers + ancestor-walk (matches beta/app/store.js L121-129).
// ---------------------------------------------------------------------------

function notify(path, value) {
  // exact-path subscribers
  const direct = _subs.get(path);
  if (direct) {
    for (const fn of direct) {
      try { fn(value); } catch (_e) { /* swallow — same as beta/app/store.js */ }
    }
  }
  // ancestors (e.g., 'connected' subscribers fire when 'connected.address' changes)
  const parts = path.split('.');
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const ancestor = parts.slice(0, i).join('.');
    const subs = _subs.get(ancestor);
    if (subs) {
      const ancVal = getPath(_state, ancestor);
      for (const fn of subs) {
        try { fn(ancVal); } catch (_e) { /* swallow */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public surface: get / update / subscribe / batch (matches /beta/app/store.js).
// ---------------------------------------------------------------------------

export function get(path) {
  return getPath(_state, path);
}

export function update(path, value) {
  setPath(_state, path, value);
  notify(path, value);
}

export function subscribe(path, fn) {
  if (!_subs.has(path)) _subs.set(path, new Set());
  _subs.get(path).add(fn);
  // Initial fire — match beta/app/store.js semantics (subscribers see current value on subscribe).
  try { fn(getPath(_state, path)); } catch (_e) { /* swallow */ }
  return () => {
    const set = _subs.get(path);
    if (set) set.delete(fn);
  };
}

/**
 * batch({updates}) — apply multiple {path, value} writes, then deduplicate
 * subscriber notifications (each unique path fires at most once with its
 * latest value). Mirrors /beta/app/store.js batch() shape (L166-189).
 */
export function batch({ updates }) {
  const seen = new Set();
  const orderedPaths = [];
  for (const { path, value } of updates) {
    setPath(_state, path, value);
    if (!seen.has(path)) {
      seen.add(path);
      orderedPaths.push(path);
    }
  }
  // Notify each unique path once with its current (post-batch) value.
  for (const path of orderedPaths) {
    notify(path, getPath(_state, path));
  }
}

// ---------------------------------------------------------------------------
// Derived helpers (DD-03 — RESEARCH §Pattern 5 lines 437-446).
// ---------------------------------------------------------------------------

/**
 * deriveCanSign — true iff the active session can sign transactions.
 *   ui.mode === 'self'   (NOT viewing another player)
 *   ui.chainOk === true  (on Sepolia)
 *   connected.address    (wallet attached)
 */
export function deriveCanSign() {
  const mode = getPath(_state, 'ui.mode');
  const chain = getPath(_state, 'ui.chainOk');
  const addr = getPath(_state, 'connected.address');
  return mode === 'self' && chain === true && Boolean(addr);
}

/**
 * getViewedAddress — polling-target precedence: viewing → connected → null.
 * Consumed by main.js boot, polling re-arm subscribers, and any future
 * domain-module that reads on behalf of the active view target.
 */
export function getViewedAddress() {
  return getPath(_state, 'viewing.address') || getPath(_state, 'connected.address') || null;
}

// ---------------------------------------------------------------------------
// ui.mode auto-derivation — internal subscriber.
//
// Policy (matches plan 58-02 truth #5 + must_haves.truths):
//   viewing && connected && viewing!==connected (case-insensitive) → 'view'
//   viewing && !connected                                          → 'view'   (deep-link)
//   else                                                           → 'self'
//
// Subscribed to:
//   - 'viewing.address' — always re-evaluate (mode is a function of viewing)
//   - 'connected.address' — re-evaluate ONLY when viewing.address is truthy
//     (when viewing is null, mode is structurally 'self'; a connected change
//     does not need to overwrite a manually-set ui.mode value, which preserves
//     the 58-01 contracts.test.js synthetic test where ui.mode='view' is set
//     directly with viewing=null to exercise the chokepoint.)
// ---------------------------------------------------------------------------

function deriveMode() {
  const viewing = getPath(_state, 'viewing.address');
  const connected = getPath(_state, 'connected.address');
  let next;
  if (viewing && connected && String(viewing).toLowerCase() !== String(connected).toLowerCase()) {
    next = 'view';
  } else if (viewing && !connected) {
    next = 'view';
  } else {
    next = 'self';
  }
  if (_state.ui.mode !== next) {
    _state.ui.mode = next;
    notify('ui.mode', next);
  }
}

// Microtask scheduler — coalesces multiple derive triggers within a sync block
// so requireSelf() (called synchronously after update()) sees the pre-derive
// snapshot, while UI/async flows (after `await`) see the post-derive snapshot.
let _derivePending = false;
function _scheduleDerive() {
  if (_derivePending) return;
  _derivePending = true;
  queueMicrotask(() => {
    _derivePending = false;
    deriveMode();
  });
}

function _onViewingChanged() {
  _scheduleDerive();
}

function _onConnectedChanged() {
  // Re-evaluate ONLY when viewing is truthy (when viewing is null, mode is
  // structurally 'self' regardless of connected; a connected-only change does
  // not need to overwrite a manually-set ui.mode — preserves 58-01's
  // contracts.test.js synthetic case where update('ui.mode','view') is set
  // directly with viewing=null to exercise the chokepoint.)
  if (getPath(_state, 'viewing.address')) {
    _scheduleDerive();
  }
}

function _installInternalSubscribers() {
  // Use the public subscribe() so the initial-fire semantics match beta/app/store.js.
  // Note: initial subscribe fire is also routed through the microtask scheduler,
  // so module-init derive doesn't run synchronously during import.
  subscribe('viewing.address', _onViewingChanged);
  subscribe('connected.address', _onConnectedChanged);
}

_installInternalSubscribers();

// ---------------------------------------------------------------------------
// Test-only reset helper — NOT for production consumers.
// Resets all state to defaults AND re-installs internal subscribers so
// node:test cases run in any order with a clean slate.
// ---------------------------------------------------------------------------

export function __resetForTest() {
  _state.connected.address = null;
  _state.connected.chainId = null;
  _state.connected.rdns = null;
  _state.viewing.address = null;
  _state.ui.mode = 'self';
  _state.ui.chainOk = null;
  _state.ui.walletPickerOpen = false;
  _subs.clear();
  _derivePending = false;
  _installInternalSubscribers();
}
