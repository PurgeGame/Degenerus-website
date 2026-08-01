// /app/app/pending-actions.js — shared registry for player-owned work that is
// waiting on a draw/RNG and the same work once it becomes actionable.
//
// The gameplay components remain the owners of their transactions and receipt
// parsing. They publish small UI descriptors here; the nav widget can then show
// one honest manifest without duplicating contract state machines.

const _sources = new Map();
const _listeners = new Set();

const STATES = new Set(['waiting', 'ready', 'busy']);

function _normalize(source, item, index) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id ?? `${source}:${index}`);
  const state = STATES.has(item.state) ? item.state : 'waiting';
  return {
    ...item,
    id,
    source,
    state,
    label: String(item.label || 'Pending action'),
    detail: item.detail == null ? '' : String(item.detail),
    run: state === 'ready' && typeof item.run === 'function' ? item.run : null,
  };
}

function _snapshot() {
  const out = [];
  for (const items of _sources.values()) out.push(...items);
  return out.sort((a, b) => {
    const rank = { ready: 0, busy: 1, waiting: 2 };
    const byState = rank[a.state] - rank[b.state];
    return byState || Number(a.order ?? 100) - Number(b.order ?? 100);
  });
}

function _notify() {
  const snapshot = _snapshot();
  for (const listener of _listeners) {
    try { listener(snapshot); } catch (_e) { /* one widget cannot break publishers */ }
  }
}

/**
 * Replace one provider's rows atomically.
 *
 * @param {string} source stable provider id
 * @param {Array<object>} items waiting/ready/busy descriptors
 */
export function publishPendingActions(source, items) {
  const key = String(source || '');
  if (!key) return;
  const normalized = (Array.isArray(items) ? items : [])
    .map((item, index) => _normalize(key, item, index))
    .filter(Boolean);
  if (normalized.length > 0) _sources.set(key, normalized);
  else _sources.delete(key);
  _notify();
}

/** Remove every row owned by one provider. */
export function clearPendingActions(source) {
  if (_sources.delete(String(source || ''))) _notify();
}

/** Current flattened manifest. Returned as a new array. */
export function getPendingActions() {
  return _snapshot();
}

/** Subscribe to the manifest. The callback receives the current state now. */
export function subscribePendingActions(listener) {
  if (typeof listener !== 'function') return () => {};
  _listeners.add(listener);
  try { listener(_snapshot()); } catch (_e) { /* defensive */ }
  return () => _listeners.delete(listener);
}

/** Test-only reset. */
export function __resetPendingActionsForTest() {
  _sources.clear();
  _listeners.clear();
}

