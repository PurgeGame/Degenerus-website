// /app/app/pending-actions.js — shared registry for player-owned work that is
// waiting on a draw/RNG and the same work once it becomes actionable.
//
// The gameplay components remain the owners of their transactions and receipt
// parsing. They publish small UI descriptors here; the fixed bottom tray then
// shows one honest manifest without duplicating contract state machines.

const _sources = new Map();
const _listeners = new Set();
const _firstSeen = new Map();
// Hard CLEAR tombstones live with the registry rather than one tray mount.
// Publishers are intentionally free to keep polling/replacing their rows; an
// already-cleared logical item must not reappear just because that happened.
const _dismissed = new Set();
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
  for (const items of _sources.values()) {
    for (const item of items) {
      if (!_dismissed.has(_dismissKey(item.source, item.id))) out.push(item);
    }
  }
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

function _dismissKey(source, id) {
  return `${String(source || '')}:${String(id || '')}`;
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

/**
 * Permanently dismiss the supplied logical rows for this app session.
 *
 * This is presentation-only: it never cancels or consumes on-chain work.
 * Provider `clearAll` hooks may retire their own durable browser receipts,
 * while the registry tombstones guarantee that a routine republish cannot
 * resurrect a cleared reminder. Related ids cover rows that transition from
 * one aggregate placeholder into one or more ready actions.
 */
export async function dismissPendingActionItems(items = null) {
  const rows = Array.isArray(items) ? [...items] : _snapshot();
  if (rows.length === 0) return 0;

  for (const item of rows) {
    _dismissed.add(_dismissKey(item?.source, item?.id));
    for (const relatedId of Array.isArray(item?.dismissIds) ? item.dismissIds : []) {
      _dismissed.add(_dismissKey(item?.source, relatedId));
    }
  }
  // Hide synchronously. The owner cleanup below can involve storage or a
  // refresh and must not leave the cleared queue painted while it completes.
  _notify();

  const owners = new Map();
  for (const item of rows) {
    if (typeof item?.clearAll !== 'function') continue;
    owners.set(String(item.source || item.id), item.clearAll);
  }
  for (const clearAll of owners.values()) await clearAll();
  return rows.length;
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
  _dismissed.clear();
  _firstSeenSeq = 0;
}
