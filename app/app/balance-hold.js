// Keep the last presentation-safe value on screen while an RNG result is
// waiting to be revealed. The latest chain/indexer value is still available to
// transaction code; this helper only chooses which value a balance readout may
// paint.

const STORAGE_PREFIX = 'degenerus_balance_hold_v1';
const _memory = new Map();

function _asBalance(value) {
  if (value == null) return null;
  try { return BigInt(value); } catch (_error) { return null; }
}

function _storageKey(namespace, scope) {
  const ledger = String(namespace || '').trim();
  const owner = String(scope || '').trim().toLowerCase();
  if (!ledger || !owner) return null;
  return `${STORAGE_PREFIX}:${encodeURIComponent(ledger)}:${encodeURIComponent(owner)}`;
}

function _read(key) {
  if (!key) return null;
  if (_memory.has(key)) return _memory.get(key);
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    const value = _asBalance(raw);
    if (value != null) _memory.set(key, value);
    return value;
  } catch (_error) {
    return null;
  }
}

function _write(key, value) {
  if (!key || value == null) return;
  _memory.set(key, value);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(value));
  } catch (_error) {
    // Private browsing can reject storage. The in-memory hold still protects
    // the current page session.
  }
}

/**
 * Return the value that is safe to paint for one RNG-sensitive ledger.
 *
 * While `released` is true, the live value is committed as the next hold.
 * While false, the last committed value is returned and a newly observed
 * value stays private. `allowDecrease` is useful for claimable ETH: spending
 * or claiming an existing balance is unrelated to a possible new payout, so
 * a decrease can safely pass through while increases remain held.
 */
export function heldBalanceValue({
  namespace,
  scope,
  value,
  released = true,
  allowDecrease = false,
} = {}) {
  const key = _storageKey(namespace, scope);
  const next = _asBalance(value);
  if (!key) return released ? next : null;

  const held = _read(key);
  if (released) {
    if (next != null) _write(key, next);
    return next ?? held;
  }

  if (held == null) return null;
  if (allowDecrease && next != null && next < held) {
    _write(key, next);
    return next;
  }
  return held;
}

/** Test-only state reset. Browser storage is deliberately left to the caller. */
export function __resetHeldBalancesForTest() {
  _memory.clear();
}
