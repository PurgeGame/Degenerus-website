// /app/app/store.js — Phase 58 Plan 02 reactive store (DD-03).
//
// EXTENDS the 58-01 minimal shim (preserved API: get/update/subscribe + namespaces).
// Adds:
//   - batch({updates}) — multi-path with deduplicated subscriber notifications
//   - deriveCanSign() — true iff (mode==='self' || 'operator') AND chainOk===true AND connected.address truthy
//   - getViewedAddress() — viewing.address || connected.address || null (polling target precedence)
//   - getActingAddress() — the address a WRITE acts on: connected in 'self', viewing in
//     'operator', null in 'view'/'combined' (account-switcher / operator-mode CORE layer)
//   - ui.mode auto-derivation: 'combined' | 'operator' | 'view' | 'self' (see deriveMode)
//   - __resetForTest() — node:test helper to reset state between cases (NOT for production)
//
// Account-switcher / operator-mode extension (2026-07-16):
//   - viewing.combined (boolean) — the switcher's "All accounts" selection. Mutually
//     exclusive with viewing.address (the switcher writes both via batch); deriveMode
//     checks combined FIRST regardless, so a stale viewing.address never leaks in.
//   - approvals.list (string[] lowercase) — owners who granted operator approval TO the
//     connected wallet (written by polling.js from the indexer /approvers payload). When
//     the current viewing target appears in this list, viewing it becomes 'operator'
//     mode (writable) rather than 'view' (read-only).
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
    combined: false,  // boolean — account-switcher "All accounts" selection (mutually exclusive with address)
  },
  approvals: {
    list: [],         // string[] lowercase — owners who approved the connected wallet as operator
  },
  ui: {
    mode: 'self',          // 'self' | 'view' | 'operator' | 'combined' (auto-derived)
    chainOk: null,         // boolean | null — null = no wallet; true/false = on/off Sepolia
    walletPickerOpen: false,
    proEligible: false,    // Phase 64 — connected wallet's activity score > 80 pts (pro-gate.js)
    allInEligible: false,  // connected self-view currently clears the >60 Degen Score ALL IN gate
    foilQuest: null,       // current account's unfinished daily foil quest + routed purchase level
    // The right-side Protocol Coins instrument owns the FLIP spoiler gate.
    // Its compact mirror on the buy side subscribes to this exact disclosure
    // state so the same balance is never visible in one column and masked in
    // the other. `{ address, visible }` is intentionally account-scoped.
    protocolCoinsFlipDisclosure: null,
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
 *   ui.mode === 'self' OR 'operator'  (self OR an approved operator acting for another)
 *   ui.chainOk === true               (on Sepolia)
 *   connected.address                 (wallet attached — the signer in both modes)
 * 'view' and 'combined' are read-only.
 */
export function deriveCanSign() {
  const mode = getPath(_state, 'ui.mode');
  const chain = getPath(_state, 'ui.chainOk');
  const addr = getPath(_state, 'connected.address');
  return (mode === 'self' || mode === 'operator') && chain === true && Boolean(addr);
}

/**
 * getViewedAddress — polling-target precedence: viewing → connected → null.
 * Consumed by main.js boot, polling re-arm subscribers, and any read/view-call
 * domain-module that reads on behalf of the active view target. UNCHANGED by the
 * operator-mode extension — reads still follow the viewed account.
 */
export function getViewedAddress() {
  return getPath(_state, 'viewing.address') || getPath(_state, 'connected.address') || null;
}

/**
 * getActingAddress — the address a WRITE (sendTx) acts ON (the contract's
 * player/buyer arg), by mode:
 *   'self'     → connected.address (the signer acts for itself)
 *   'operator' → viewing.address   (the signer is an approved operator for this owner)
 *   'view'     → null              (read-only — nothing to act on)
 *   'combined' → null              (read-only aggregate — pick one account to act)
 * The signer is ALWAYS connected.address (enforced by sendTx's freshAddress guard);
 * this returns the on-chain player the contract resolves via _resolvePlayer(player).
 */
export function getActingAddress() {
  const mode = getPath(_state, 'ui.mode');
  if (mode === 'operator') return getPath(_state, 'viewing.address') || null;
  if (mode === 'self') return getPath(_state, 'connected.address') || null;
  return null;   // 'view' / 'combined' — read-only
}

// ---------------------------------------------------------------------------
// ui.mode auto-derivation — internal subscriber.
//
// Policy (operator-mode extension 2026-07-16; combined checked FIRST):
//   1. viewing.combined && connected                              → 'combined'
//   2. viewing && connected && viewing!==connected (case-insens):
//        approvals.list contains viewing (case-insens)            → 'operator'
//        else                                                     → 'view'
//   3. viewing && !connected                                      → 'view'   (deep-link)
//   4. else                                                       → 'self'
//
// Subscribed to:
//   - 'viewing.address' — always re-evaluate (mode is a function of viewing)
//   - 'viewing.combined' — always re-evaluate (mode is a function of combined)
//   - 'connected.address' — re-evaluate ONLY when viewing.address is truthy
//     (when viewing is null AND not combined, mode is structurally 'self'; a
//     connected change does not need to overwrite a manually-set ui.mode value,
//     which preserves the 58-01 contracts.test.js synthetic test where
//     ui.mode='view' is set directly with viewing=null to exercise the chokepoint.)
//   - 'approvals.list' — re-evaluate ONLY when viewing.address is truthy (the
//     list only flips 'view'↔'operator' for the CURRENT viewing target; when
//     viewing is null it cannot change the derived mode).
// ---------------------------------------------------------------------------

function deriveMode() {
  const viewing = getPath(_state, 'viewing.address');
  const connected = getPath(_state, 'connected.address');
  const combined = getPath(_state, 'viewing.combined');
  const approvals = getPath(_state, 'approvals.list') || [];
  let next;
  if (combined && connected) {
    next = 'combined';
  } else if (viewing && connected && String(viewing).toLowerCase() !== String(connected).toLowerCase()) {
    const v = String(viewing).toLowerCase();
    const isOperator = Array.isArray(approvals)
      && approvals.some((a) => String(a).toLowerCase() === v);
    next = isOperator ? 'operator' : 'view';
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

function _onCombinedChanged() {
  // Always re-evaluate — mode is a function of viewing.combined (a combined
  // toggle flips 'combined'↔prior even when viewing.address is null).
  _scheduleDerive();
}

function _onApprovalsChanged() {
  // Re-evaluate ONLY when viewing is truthy — approvals.list flips the current
  // viewing target between 'view' and 'operator'; when viewing is null it
  // cannot change the derived mode (and, like connected-change, must not
  // overwrite a manually-set ui.mode). This preserves the sync-snapshot
  // chokepoint semantics: approvals arriving AFTER viewing.address still
  // re-derive because viewing is truthy at that point.
  if (getPath(_state, 'viewing.address')) {
    _scheduleDerive();
  }
}

function _installInternalSubscribers() {
  // Use the public subscribe() so the initial-fire semantics match beta/app/store.js.
  // Note: initial subscribe fire is also routed through the microtask scheduler,
  // so module-init derive doesn't run synchronously during import.
  subscribe('viewing.address', _onViewingChanged);
  subscribe('viewing.combined', _onCombinedChanged);
  subscribe('connected.address', _onConnectedChanged);
  subscribe('approvals.list', _onApprovalsChanged);
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
  _state.viewing.combined = false;
  _state.approvals.list = [];
  _state.ui.mode = 'self';
  _state.ui.chainOk = null;
  _state.ui.walletPickerOpen = false;
  _state.ui.proEligible = false;
  _state.ui.allInEligible = false;
  _state.ui.foilQuest = null;
  _state.ui.protocolCoinsFlipDisclosure = null;
  // Phase 59 Plan 59-02: clear dynamic top-level namespaces (e.g. `app.*`) added
  // via setPath. polling-store-wired tests assert app.lastDay === undefined after
  // a failed fetch — without this, prior-test state leaks across cases.
  // Static namespaces (connected/viewing/ui) above are reset in-place to preserve
  // existing reference identity; dynamic ones are deleted entirely.
  for (const k of Object.keys(_state)) {
    if (k !== 'connected' && k !== 'viewing' && k !== 'ui' && k !== 'approvals') {
      delete _state[k];
    }
  }
  _subs.clear();
  _derivePending = false;
  _installInternalSubscribers();
}
