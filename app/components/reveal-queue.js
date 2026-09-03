// /app/components/reveal-queue.js — lightweight reveal-engine boundary.
//
// Most app surfaces only need to enqueue a prize or listen for one of the
// reveal lifecycle events. Keeping that synchronous contract here prevents
// every caller from pulling the large visual reveal engine into the critical
// module graph. The first accepted sequence loads reveal-overlay.js on demand;
// the sequence stays buffered until its custom element connects.

let _instance = null;
let _buffer = [];
let _overlayLoadPromise = null;
let _lootboxPresentationSeq = 0;
let _queuedLootboxPresentationIds = new Set();
let _queuedBingoPresentationIds = new Set();
let _queuedPariPresentationIds = new Set();
let _queuedReferralBonusPresentationIds = new Set();

// Ticket inventory listens for these lifecycle events so newly indexed cards
// remain behind their wrapper until the corresponding presentation is consumed.
export const PACK_REVEAL_COMPLETE_EVENT = 'degenerus:pack-reveal-complete';
export const PACK_REVEAL_ABORT_EVENT = 'degenerus:pack-reveal-abort';
export const REVEAL_OVERLAY_IDLE_EVENT = 'degenerus:reveal-overlay-idle';
export const LOOTBOX_REVEAL_COMPLETE_EVENT = 'degenerus:lootbox-reveal-complete';
export const LOOTBOX_REVEAL_ABORT_EVENT = 'degenerus:lootbox-reveal-abort';
export const LOOTBOX_REVEAL_QUEUED_EVENT = 'degenerus:lootbox-reveal-queued';
export const RESULT_REVEAL_ABORT_EVENT = 'degenerus:result-reveal-abort';

function _tombstoneSet(kind) {
  if (kind === 'bingo') return _queuedBingoPresentationIds;
  if (kind === 'pari') return _queuedPariPresentationIds;
  if (kind === 'referral-bonus') return _queuedReferralBonusPresentationIds;
  return null;
}

/** @internal RevealOverlay uses this to preserve abort identity after normalization. */
export function revealResultPresentation(seq) {
  if (seq?.resultPresentation) return seq.resultPresentation;
  const presentationId = String(seq?.presentationId || '');
  if (!presentationId || !_tombstoneSet(seq?.kind)) return null;
  return { kind: seq.kind, presentationId, release: seq?.revealRelease || null };
}

/** @internal Add the stable identity shared by receipt and indexer discovery. */
export function withLootboxPresentationId(seq) {
  if (seq?.kind !== 'lootbox') return seq;
  if (seq.presentationId) return seq;
  const release = seq?.lootboxRelease;
  const address = String(release?.address || '').toLowerCase();
  const key = String(release?.key || '');
  if (address && key) {
    return { ...seq, presentationId: `lootbox-reveal:${address}:${key}` };
  }
  return { ...seq, presentationId: `lootbox-reveal:${++_lootboxPresentationSeq}` };
}

function _withBingoPresentationId(seq) {
  if (seq?.kind !== 'bingo' || seq.presentationId) return seq;
  const player = String(seq.player || seq.address || '').toLowerCase();
  const level = Number(seq.level);
  const symbol = Number(seq.symbol ?? seq.sym);
  const quadrant = Number.isInteger(Number(seq.quadrant))
    ? Number(seq.quadrant)
    : (Number.isInteger(symbol) ? symbol >> 3 : Number.NaN);
  if (!player || !Number.isInteger(level) || level < 0
    || !Number.isInteger(quadrant) || quadrant < 0) return seq;
  return { ...seq, presentationId: `bingo-reveal:${player}:${level}:${quadrant}` };
}

function _withPariPresentationId(seq) {
  if (seq?.kind !== 'pari' || seq.presentationId) return seq;
  const market = String(seq.market || '').toLowerCase() === 'volume' ? 'volume' : 'growth';
  const round = Number(seq.round);
  if (!Number.isInteger(round) || round < 0) return seq;
  const player = String(seq.player || seq.address || 'current').toLowerCase();
  return { ...seq, presentationId: `pari-reveal:${player}:${market}:${round}` };
}

function _withReferralBonusPresentationId(seq) {
  if (seq?.kind !== 'referral-bonus' || seq.presentationId) return seq;
  const player = String(seq.player || seq.address || '').toLowerCase();
  const level = Number(seq.level);
  if (!player || !Number.isInteger(level) || level <= 0) return seq;
  return { ...seq, presentationId: `referral-bonus:${player}:${level}` };
}

/** @internal Publish the one-time lootbox identity before its visual starts. */
export function emitLootboxRevealQueued(seq) {
  const id = seq?.kind === 'lootbox' ? String(seq.presentationId || '') : '';
  if (!id || _queuedLootboxPresentationIds.has(id)) return;
  _queuedLootboxPresentationIds.add(id);
  if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function'
    || typeof CustomEvent !== 'function') return;
  const release = seq?.lootboxRelease;
  try {
    document.dispatchEvent(new CustomEvent(LOOTBOX_REVEAL_QUEUED_EVENT, {
      detail: {
        presentationId: id,
        address: release?.address == null ? null : String(release.address).toLowerCase(),
        key: release?.key == null ? null : String(release.key),
        lootboxIndex: release?.lootboxIndex == null ? null : Number(release.lootboxIndex),
        transactionHash: release?.transactionHash == null
          ? null
          : String(release.transactionHash).toLowerCase(),
      },
    }));
  } catch (_error) { /* spoiler bookkeeping must never break a reveal */ }
}

function _canLoadOverlay() {
  return typeof window !== 'undefined'
    && window === globalThis
    && typeof document?.querySelector === 'function'
    && Boolean(document.querySelector('reveal-overlay'));
}

/**
 * Begin loading the visual engine without making it part of the initial graph.
 * Exported for intent-based prewarming; queueReveal also calls it automatically.
 */
export function requestRevealOverlay() {
  if (_instance || !_canLoadOverlay()) return _overlayLoadPromise ?? Promise.resolve();
  if (!_overlayLoadPromise) {
    _overlayLoadPromise = import('./reveal-overlay.js').catch((error) => {
      // Keep the buffered sequence and permit a later user action to retry.
      _overlayLoadPromise = null;
      setTimeout(() => { throw error; }, 0);
    });
  }
  return _overlayLoadPromise;
}

/**
 * Enqueue a reveal sequence. Safe before <reveal-overlay> mounts. Returns true
 * exactly when the sequence was accepted, preserving caller-owned seen marks.
 */
export function queueReveal(seq) {
  if (!seq || typeof seq !== 'object') return false;
  const queued = _withReferralBonusPresentationId(
    _withPariPresentationId(
      _withBingoPresentationId(withLootboxPresentationId(seq)),
    ),
  );
  const presentationId = String(queued?.presentationId || '');
  if (queued?.kind === 'lootbox'
    && presentationId && _queuedLootboxPresentationIds.has(presentationId)) {
    void requestRevealOverlay();
    return false;
  }
  if (presentationId && _tombstoneSet(queued?.kind)?.has(presentationId)) {
    void requestRevealOverlay();
    return false;
  }
  const tombstones = _tombstoneSet(queued?.kind);
  if (tombstones && presentationId) tombstones.add(presentationId);
  emitLootboxRevealQueued(queued);
  if (_instance) _instance.enqueue(queued);
  else _buffer.push(queued);
  void requestRevealOverlay();
  return true;
}

/** @internal Bind the visual engine and synchronously drain buffered work. */
export function registerRevealOverlay(instance) {
  _instance = instance;
  if (_buffer.length === 0) return;
  const pending = _buffer;
  _buffer = [];
  for (const seq of pending) instance.enqueue(seq);
}

/** @internal Release the active visual engine without discarding queued work. */
export function unregisterRevealOverlay(instance) {
  if (_instance === instance) _instance = null;
}

/** @internal Release single-presentation tombstones when the player aborts. */
export function releaseResultRevealPresentations(sequences) {
  const released = [];
  for (const seq of Array.isArray(sequences) ? sequences : []) {
    const identity = revealResultPresentation(seq);
    if (!identity) continue;
    const tombstones = _tombstoneSet(identity.kind);
    if (!tombstones || !tombstones.has(identity.presentationId)) continue;
    tombstones.delete(identity.presentationId);
    released.push({ ...identity });
  }
  return released;
}

/** @internal Let an aborted lootbox presentation be offered again. */
export function releaseLootboxRevealPresentations(presentationIds) {
  for (const id of Array.isArray(presentationIds) ? presentationIds : []) {
    _queuedLootboxPresentationIds.delete(id);
  }
}

/** Test-only — drop the singleton, buffer, loader handle, and tombstones. */
export function __resetForTest() {
  _instance = null;
  _buffer = [];
  _overlayLoadPromise = null;
  _lootboxPresentationSeq = 0;
  _queuedLootboxPresentationIds = new Set();
  _queuedBingoPresentationIds = new Set();
  _queuedPariPresentationIds = new Set();
  _queuedReferralBonusPresentationIds = new Set();
}

/** Test-only — read and clear sequences queued while no visual engine exists. */
export function __takeQueuedForTest() {
  const out = _buffer;
  _buffer = [];
  return out;
}
