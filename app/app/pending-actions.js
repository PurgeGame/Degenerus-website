// /app/app/pending-actions.js — shared registry for player-owned work that is
// waiting on a draw/RNG and the same work once it becomes actionable.
//
// The gameplay components remain the owners of their transactions and receipt
// parsing. They publish small UI descriptors here; the fixed bottom tray then
// shows one honest manifest without duplicating contract state machines.

import { CHAIN, CONTRACTS } from './chain-config.js';
import { getViewedAddress } from './store.js';

const _sources = new Map();
const _listeners = new Set();
const _errorListeners = new Set();
const _firstSeen = new Map();
// Hard CLEAR tombstones live with the registry rather than one tray mount and
// are persisted below. Publishers are intentionally free to keep polling or
// replacing their rows; an already-cleared logical item must not reappear just
// because the page reloaded or a fresh indexer response arrived.
const _dismissed = new Map();
let _firstSeenSeq = 0;
// A source can publish an intentionally empty result after its first database
// refresh. Keep that distinct from "this controller has not loaded yet" so
// spoiler gates can retire stale durable latches without racing startup.
const _publishedSources = new Set();

const STATES = new Set(['waiting', 'ready', 'busy']);
const MAX_DISMISSED_ITEMS = 1_000;
export const PENDING_DISMISSALS_STORAGE_KEY = [
  'degenerus:pending-dismissals:v1',
  CHAIN.id,
  String(CONTRACTS.GAME || 'game').toLowerCase(),
].join(':');
let _dismissedLoaded = false;
let _dismissStorageOverride;

function _storage() {
  if (_dismissStorageOverride !== undefined) return _dismissStorageOverride;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (_error) {
    return null;
  }
}

function _loadDismissed() {
  if (_dismissedLoaded) return;
  _dismissedLoaded = true;
  let parsed = null;
  try {
    const raw = _storage()?.getItem(PENDING_DISMISSALS_STORAGE_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch (_error) {
    return;
  }
  const entries = Array.isArray(parsed?.entries)
    ? parsed.entries
    : Array.isArray(parsed) ? parsed : [];
  for (const entry of entries.slice(-MAX_DISMISSED_ITEMS)) {
    const key = Array.isArray(entry) ? entry[0] : entry;
    const at = Array.isArray(entry) ? Number(entry[1]) : 0;
    if (typeof key !== 'string' || !key) continue;
    _dismissed.set(key, Number.isFinite(at) ? at : 0);
  }
}

function _persistDismissed() {
  const newest = [..._dismissed.entries()]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .slice(-MAX_DISMISSED_ITEMS);
  _dismissed.clear();
  for (const entry of newest) _dismissed.set(entry[0], entry[1]);
  try {
    _storage()?.setItem(PENDING_DISMISSALS_STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: newest,
    }));
  } catch (_error) { /* private mode/quota: session tombstones still work */ }
}

function _rememberDismissed(key) {
  _loadDismissed();
  _dismissed.delete(key);
  _dismissed.set(key, Date.now());
}

function _currentDismissScope(explicitScope) {
  if (explicitScope != null && String(explicitScope)) {
    return String(explicitScope).toLowerCase();
  }
  try {
    const viewed = getViewedAddress();
    if (viewed) return String(viewed).toLowerCase();
  } catch (_error) { /* registry is also usable before the wallet store boots */ }
  return 'anonymous';
}

function _normalize(source, item, index) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id ?? `${source}:${index}`);
  const dismissScope = _currentDismissScope(item.dismissScope);
  const dismissKey = String(item.dismissKey ?? id);
  const stableKey = `${dismissScope}:${source}:${id}`;
  if (!_firstSeen.has(stableKey)) _firstSeen.set(stableKey, ++_firstSeenSeq);
  const state = STATES.has(item.state) ? item.state : 'waiting';
  const chronology = Number(item.chronology);
  return {
    ...item,
    id,
    source,
    dismissScope,
    dismissKey,
    state,
    label: String(item.label || 'Pending action'),
    detail: item.detail == null ? '' : String(item.detail),
    chronology: Number.isFinite(chronology) ? chronology : _firstSeen.get(stableKey),
    firstSeenOrder: _firstSeen.get(stableKey),
    run: state === 'ready' && typeof item.run === 'function' ? item.run : null,
  };
}

function _snapshot() {
  _loadDismissed();
  const out = [];
  for (const items of _sources.values()) {
    for (const item of items) {
      if (!_dismissed.has(_dismissKey(item.dismissScope, item.source, item.dismissKey))) out.push(item);
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

function _dismissKey(scope, source, id) {
  return `${String(scope || 'anonymous')}:${String(source || '')}:${String(id || '')}`;
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
 * Permanently dismiss the supplied logical rows in this browser.
 *
 * This is presentation-only: it never cancels or consumes on-chain work.
 * Provider `clearAll` hooks may retire their own durable browser receipts,
 * while the registry tombstones guarantee that a routine republish cannot
 * resurrect a cleared reminder. Related ids cover rows that transition from
 * one aggregate placeholder into one or more ready actions. Pass
 * `{ drain: true }` for the user-facing CLEAR operation so rows published by
 * owner cleanup are included before the operation closes.
 */
export async function dismissPendingActionItems(items = null, { drain = false } = {}) {
  let rows = Array.isArray(items) ? [...items] : _snapshot();
  const dismissedRows = new Set();
  const invokedOwners = new Set();
  const failures = [];
  let quietPasses = 0;

  // CLEAR is a small fixed-point operation. Owner cleanup and reveal-complete
  // listeners are allowed to publish replacement rows (for example, an
  // aggregate ticket wait becoming a concrete pack). In drain mode, keep the
  // clear open across those microtasks and tombstone every row that belongs to
  // the same already-existing backlog. A later publish after this operation
  // completes is still treated as genuinely new work.
  for (let pass = 0; pass < 50; pass += 1) {
    const owners = new Map();
    if (rows.length > 0) {
      for (const item of rows) {
        const scope = _currentDismissScope(item?.dismissScope);
        const key = _dismissKey(scope, item?.source, item?.dismissKey ?? item?.id);
        _rememberDismissed(key);
        dismissedRows.add(`${scope}:${String(item?.source || '')}:${String(item?.id || key)}`);
        for (const relatedId of Array.isArray(item?.dismissIds) ? item.dismissIds : []) {
          const relatedKey = _dismissKey(scope, item?.source, relatedId);
          _rememberDismissed(relatedKey);
        }
        if (typeof item?.clearAll !== 'function') continue;
        const owner = String(item.source || item.id);
        if (!invokedOwners.has(owner)) owners.set(owner, item.clearAll);
      }

      // Persist before any publisher cleanup or refresh can run. If the page
      // is closed immediately after CLEAR, the exact same rows stay retired.
      _persistDismissed();
      // Hide synchronously. Owner cleanup may involve storage or a refresh and
      // must not leave the cleared queue painted while it completes.
      _notify();
    }

    const ownerEntries = [...owners.entries()];
    for (const [owner] of ownerEntries) invokedOwners.add(owner);
    const settled = await Promise.allSettled(ownerEntries.map(([, clearAll]) => (
      Promise.resolve().then(() => clearAll())
    )));
    settled.forEach((result) => {
      if (result.status === 'rejected') failures.push(result.reason);
    });

    if (!drain) break;
    // Two empty microtask turns close the synchronous publish gap without
    // muting an unrelated action created after the user's clear has finished.
    await Promise.resolve();
    rows = _snapshot();
    if (rows.length === 0) {
      quietPasses += 1;
      if (quietPasses >= 2) break;
    } else {
      quietPasses = 0;
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Pending cleanup failed');
  return dismissedRows.size;
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

/** Publish a short, presentation-only failure without mutating any owner row. */
export function reportPendingActionError(message) {
  const text = String(message || '').trim();
  if (!text) return;
  for (const listener of _errorListeners) {
    try { listener(text); } catch (_e) { /* one surface cannot block another */ }
  }
}

/** Subscribe to scoped transaction failures shown by the shared Pending tray. */
export function subscribePendingActionErrors(listener) {
  if (typeof listener !== 'function') return () => {};
  _errorListeners.add(listener);
  return () => _errorListeners.delete(listener);
}

/** Test-only storage seam. */
export function __setPendingDismissStorageForTest(storage) {
  _dismissStorageOverride = storage;
  _dismissed.clear();
  _dismissedLoaded = false;
}

/** Test-only reset. */
export function __resetPendingActionsForTest({ preserveDismissedStorage = false } = {}) {
  _sources.clear();
  _listeners.clear();
  _errorListeners.clear();
  _publishedSources.clear();
  _firstSeen.clear();
  _dismissed.clear();
  _dismissedLoaded = false;
  if (!preserveDismissedStorage) {
    try { _storage()?.removeItem(PENDING_DISMISSALS_STORAGE_KEY); } catch (_error) { /* test shim */ }
  }
  _firstSeenSeq = 0;
}
