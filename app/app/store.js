// /app/app/store.js — Phase 58 Plan 01 minimal stub (created by 58-01 RULE-3 deviation
// because wallet.js + contracts.js have static imports of './store.js' and the test
// suite can't load them otherwise; plan 58-02 lands the full store with derived
// selectors + URL sync + Proxy ancestor-walk pattern verbatim from beta/app/store.js).
//
// Plan 58-02 will EXTEND this file (deriveCanSign, getViewedAddress, deriveMode subscriber).
// This stub provides the minimal get/update/subscribe surface that wallet.js + contracts.js
// require for chokepoint and listener wiring. Schema is the Phase 58 namespace per
// 58-PATTERNS.md `connected.* / viewing.* / ui.*`.

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
    mode: 'self',          // 'self' | 'view'
    chainOk: null,         // boolean | null — null = no wallet; true/false = on/off Sepolia
    walletPickerOpen: false,
  },
};

// path-keyed subscriber registry: 'connected.address' → Set<fn>
const _subs = new Map();

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

function notify(path, value) {
  // notify exact-path subscribers
  const direct = _subs.get(path);
  if (direct) {
    for (const fn of direct) {
      try { fn(value); } catch (e) { /* swallow — same as beta/app/store.js */ }
    }
  }
  // notify ancestors (e.g., 'connected' subscribers fire when 'connected.address' changes)
  const parts = path.split('.');
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const ancestor = parts.slice(0, i).join('.');
    const subs = _subs.get(ancestor);
    if (subs) {
      const ancVal = getPath(_state, ancestor);
      for (const fn of subs) {
        try { fn(ancVal); } catch (e) { /* swallow */ }
      }
    }
  }
}

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
  try { fn(getPath(_state, path)); } catch (e) { /* swallow */ }
  return () => {
    const set = _subs.get(path);
    if (set) set.delete(fn);
  };
}

// Plan 58-02 will add: deriveCanSign(), getViewedAddress(), batch(), deriveMode subscriber.
