// /app/app/pending-actions.js — shared registry for player-owned work that is
// waiting on a draw/RNG and the same work once it becomes actionable.
//
// The gameplay components remain the owners of their transactions and receipt
// parsing. They publish small UI descriptors here; the fixed bottom tray then
// shows one honest manifest without duplicating contract state machines.

const _sources = new Map();
const _listeners = new Set();
const _firstSeen = new Map();
let _firstSeenSeq = 0;
// A source can publish an intentionally empty result after its first database
// refresh. Keep that distinct from "this controller has not loaded yet" so
// spoiler gates can retire stale durable latches without racing startup.
const _publishedSources = new Set();

const STATES = new Set(['waiting', 'ready', 'busy']);

function _normalize(source, item, index) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id ?? `${source}:${index}`);
  const stableKey = `${source}:${id}`;
  if (!_firstSeen.has(stableKey)) _firstSeen.set(stableKey, ++_firstSeenSeq);
  const state = STATES.has(item.state) ? item.state : 'waiting';
  const chronology = Number(item.chronology);
  return {
    ...item,
    id,
    source,
    state,
    label: String(item.label || 'Pending action'),
    detail: item.detail == null ? '' : String(item.detail),
    chronology: Number.isFinite(chronology) ? chronology : _firstSeen.get(stableKey),
    firstSeenOrder: _firstSeen.get(stableKey),
    run: state === 'ready' && typeof item.run === 'function' ? item.run : null,
  };
}

function _snapshot() {
  const out = [];
  for (const items of _sources.values()) out.push(...items);
  return out.sort((a, b) => {
    // `order` is the protocol timeline (player rewards/claims → permissionless
    // Mine FLIP maintenance), not a visual priority. A row becoming ready must never jump in
    // front of older work. `chronology` orders siblings within one step and the
    // stable discovery counter covers publishers without a chain timestamp.
    const byStep = Number(a.order ?? 100) - Number(b.order ?? 100);
    const byChronology = Number(a.chronology) - Number(b.chronology);
    return byStep || byChronology || Number(a.firstSeenOrder) - Number(b.firstSeenOrder);
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
  _publishedSources.add(key);
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

/** Whether a provider has completed at least one explicit publish this mount. */
export function pendingSourceHasPublished(source) {
  return _publishedSources.has(String(source || ''));
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
  _publishedSources.clear();
  _firstSeen.clear();
  _firstSeenSeq = 0;
}
