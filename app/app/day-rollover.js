// Authoritative daily draw handoff.
//
// The indexer feeds remain the rich source for jackpot/player presentation,
// but they are deliberately not the clock: at a day boundary those endpoints
// can arrive in either order and may briefly return yesterday. One pinned RPC
// snapshot supplies the deployment-local GAME day plus that exact day's FLIP
// result. The resulting app.daySync state exposes two exact-day readiness
// lanes: jackpot consumers use jackpotReady and coinflip consumers use
// coinflipReady. `ready` remains the aggregate transition state only.

import { ethers } from './contracts.js';
import { CHAIN, CONTRACTS, VOLUME_WINDOW } from './chain-config.js';
import { readProviderBlockNumber, sharedReadProvider } from './read-provider.js';
import { get, subscribe, update } from './store.js';
import { isMajorDrawActive } from './major-draw-activity.js';

const GAME_DAY_ABI = [
  'function currentDayView() external view returns (uint24)',
  'function rngLocked() external view returns (bool)',
  // DegenerusGame.sol:2481 — `rngWordCurrent != 0`. The VRF callback assigns
  // that word (DegenerusGame.sol:2211), so this view flips true in the same
  // block the randomness lands, with no indexer in the path. There is no
  // checked-in GAME ABI artifact to regenerate; every module declares its own
  // minimal fragments, and this one was verified by raw eth_call against the
  // live Base Sepolia GAME (0xe57d3910…, selector 0xabd9f3da -> 0x00…00).
  'function isRngFulfilled() external view returns (bool)',
  // O(1) keeper-work predicate. Once the day's RNG has arrived, the falling
  // edge to false is the chain-authoritative signal that the jackpot advance
  // pipeline has drained; no indexer/API polling is needed to discover it.
  'function advanceDue() external view returns (bool)',
  'function rngNudgeQuote() external view returns (uint256 queued, uint256 cost)',
];
const COINFLIP_DAY_ABI = [
  'function getCoinflipDayResult(uint24 day) external view returns (uint16 rewardPercent, bool win)',
];

const NEAR_BOUNDARY_SECONDS = 20;
const POST_BOUNDARY_POLL_SECONDS = Math.max(
  NEAR_BOUNDARY_SECONDS,
  Math.floor(Number(VOLUME_WINDOW?.jackpotReadyDelay) || 0),
);
const NEAR_BOUNDARY_POLL_MS = 1_000;
const WARMING_POLL_MS = 1_500;
const INDEXER_WAIT_POLL_MS = 15_000;
const TESTNET_STEADY_POLL_MS = 10_000;
const MAINNET_STEADY_POLL_MS = 30_000;

let _provider = null;
let _snapshotReader = null;
let _timer = null;
let _running = false;
let _probeInFlight = null;
let _lastDayUnsub = null;
let _visibilityListener = null;
let _onRefreshNeeded = null;

function _positiveDay(value) {
  const day = Number(value);
  return Number.isInteger(day) && day > 0 ? day : null;
}

function _normalizedCoinflip(day, raw) {
  const rewardPercent = Number(raw?.rewardPercent ?? raw?.encodedRewardPercent ?? raw?.[0] ?? 0);
  const win = Boolean(raw?.win ?? raw?.[1]);
  if (!Number.isFinite(rewardPercent) || rewardPercent <= 0) return null;
  return {
    day,
    win,
    rewardPercent: win ? Math.max(0, Math.trunc(rewardPercent)) : 0,
    resolved: true,
    source: 'chain',
  };
}

function _phase(jackpotReady, coinflipReady) {
  if (jackpotReady && coinflipReady) return 'synced';
  if (jackpotReady) return 'waiting-coinflip';
  if (coinflipReady) return 'waiting-jackpot';
  return 'waiting-both';
}

/**
 * Pure reducer used by the live watcher and ordering fuzz tests.
 *
 * Read responses are monotonic by block/day. Once one exact lane is verified
 * for a target day, a stale API/RPC response cannot make that lane unresolved
 * again. A genuinely newer chain day resets both lanes together.
 */
export function reconcileDaySync({ snapshot, lastDay = null, previous = null, now = Date.now() }) {
  let day = _positiveDay(snapshot?.day);
  if (day == null) return previous || null;
  const previousDay = _positiveDay(previous?.day);
  const blockNumber = Number(snapshot?.blockNumber);
  const previousBlock = Number(previous?.chainBlock);
  const staleBlock = Number.isFinite(blockNumber) && Number.isFinite(previousBlock)
    && blockNumber < previousBlock;
  const staleDay = previousDay != null && day < previousDay;

  // An old in-flight probe must never pull the UI back to yesterday. A new
  // deployment loads a new address bundle/page and therefore starts without a
  // previous reducer state.
  if (previousDay != null && (staleBlock || staleDay)) day = previousDay;
  const sameTarget = previousDay === day;
  const incomingCoinflip = _positiveDay(snapshot?.coinflip?.day) === day
    ? snapshot.coinflip
    : null;
  const coinflipResult = incomingCoinflip?.resolved
    ? incomingCoinflip
    : (sameTarget ? previous?.coinflipResult ?? null : null);
  const indexedJackpotDay = _positiveDay(lastDay?.day);
  const indexedJackpotResolved = indexedJackpotDay === day
    && lastDay?.status !== 'pre-game';
  const jackpotReady = indexedJackpotResolved
    || Boolean(sameTarget && previous?.jackpotReady);
  const coinflipReady = Boolean(coinflipResult?.resolved)
    || Boolean(sameTarget && previous?.coinflipReady);
  // currentDayView follows the wall clock, so it can move before anybody has
  // actually submitted the daily VRF request. Keep that boundary distinct
  // from the request itself: the jackpot/coin surfaces use rngRequested to
  // begin their processing handoff only once the lock (or a completed exact-
  // day result) proves the request happened.
  const hasLockReading = typeof snapshot?.rngLocked === 'boolean';
  const rngLocked = hasLockReading
    ? snapshot.rngLocked
    : Boolean(sameTarget && previous?.rngLocked);
  // isRngFulfilled() reads `rngWordCurrent != 0`, and the advance pipeline
  // ZEROES that word once it has drained it (DegenerusGameAdvanceModule.sol
  // :1570, :1955, :2330, :2461). So `true` is proof the day's word arrived and
  // `false` proves nothing whatsoever — it is equally the state before the VRF
  // callback and the state after the drain. Latch it positive-only for the
  // day: a word that arrived cannot un-arrive, and a failed read (null) leaves
  // whatever the latch already knew untouched.
  const rngFulfilled = snapshot?.rngFulfilled === true
    || Boolean(sameTarget && previous?.rngFulfilled);
  const rngRequested = rngLocked
    || rngFulfilled
    || indexedJackpotResolved
    || Boolean(coinflipResult?.resolved)
    || Boolean(sameTarget && previous?.rngRequested);
  const advanceDue = typeof snapshot?.advanceDue === 'boolean'
    ? snapshot.advanceDue
    : (sameTarget && typeof previous?.advanceDue === 'boolean'
      ? previous.advanceDue
      : null);
  // `advanceDue === false` also describes an idle pre-request day, so require
  // proof that this day's RNG arrived/resolved before treating it as the
  // completion edge. The positive latch survives the contract zeroing its
  // transient RNG word and makes cold loads after completion work via the
  // permanent exact-day coinflip result.
  const completionEvidence = rngFulfilled
    || Boolean(coinflipResult?.resolved)
    || indexedJackpotResolved;
  const processingComplete = Boolean(sameTarget && previous?.processingComplete)
    || Boolean(rngRequested && completionEvidence && advanceDue === false);
  let incomingReverseQueued = null;
  try {
    if (snapshot?.reverseQueued != null) incomingReverseQueued = BigInt(snapshot.reverseQueued);
  } catch { /* malformed/legacy quote */ }
  let reverseQueued = incomingReverseQueued;
  if (sameTarget && previous?.reverseQueued != null) {
    try {
      const previousQueued = BigInt(previous.reverseQueued);
      // _applyDailyRng consumes the queue and resets the live quote to zero.
      // Preserve the request-time parity until both UI lanes have caught up.
      reverseQueued = previous?.rngRequested && !rngLocked && incomingReverseQueued === 0n
        ? previousQueued
        : (incomingReverseQueued ?? previousQueued);
    } catch { /* malformed previous state cannot poison the new sample */ }
  }
  const ready = jackpotReady && coinflipReady;

  return {
    day,
    previousDay: previousDay != null && previousDay !== day ? previousDay : previous?.previousDay ?? null,
    detectedAt: sameTarget ? previous?.detectedAt ?? now : now,
    chainBlock: Number.isFinite(blockNumber) && !staleBlock
      ? blockNumber
      : (previous?.chainBlock ?? null),
    jackpotDay: jackpotReady ? day : null,
    coinflipDay: coinflipReady ? day : null,
    jackpotReady,
    coinflipReady,
    rngLocked,
    rngFulfilled,
    rngRequested,
    advanceDue,
    processingComplete,
    reverseQueued: reverseQueued == null ? null : reverseQueued.toString(),
    ready,
    phase: _phase(jackpotReady, coinflipReady),
    coinflipResult: coinflipReady ? (coinflipResult ?? previous?.coinflipResult ?? null) : null,
  };
}

function _materialKey(state) {
  if (!state) return '';
  return [
    state.day,
    state.jackpotReady ? 1 : 0,
    state.coinflipReady ? 1 : 0,
    state.rngLocked ? 1 : 0,
    state.rngFulfilled ? 1 : 0,
    state.rngRequested ? 1 : 0,
    state.advanceDue == null ? '' : (state.advanceDue ? 1 : 0),
    state.processingComplete ? 1 : 0,
    state.reverseQueued ?? '',
    state.coinflipResult?.win ? 1 : 0,
    state.coinflipResult?.rewardPercent ?? '',
  ].join(':');
}

async function _readSnapshot() {
  if (_snapshotReader) return _snapshotReader();
  if (!_provider && CHAIN.rpcUrl) {
    _provider = sharedReadProvider();  // C15: shared batched read stream
  }
  if (!_provider || !CONTRACTS.GAME || !CONTRACTS.COINFLIP) {
    throw new Error('Daily draw clock unavailable');
  }
  const game = new ethers.Contract(CONTRACTS.GAME, GAME_DAY_ABI, _provider);
  const coinflip = new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_DAY_ABI, _provider);
  let blockNumber = null;
  try { blockNumber = Number(await readProviderBlockNumber(_provider)); }
  catch (_e) { /* unpinned best effort */ }
  const overrides = blockNumber == null ? [] : [{ blockTag: blockNumber }];
  const day = _positiveDay(await game.currentDayView(...overrides));
  if (day == null) throw new Error('Invalid chain day');
  const [coinflipResult, lockResult, fulfilledResult, advanceResult, nudgeResult] = await Promise.allSettled([
    coinflip.getCoinflipDayResult(day, ...overrides),
    game.rngLocked(...overrides),
    game.isRngFulfilled(...overrides),
    game.advanceDue(...overrides),
    game.rngNudgeQuote(...overrides),
  ]);
  if (coinflipResult.status !== 'fulfilled') throw coinflipResult.reason;
  const raw = coinflipResult.value;
  return {
    day,
    blockNumber,
    coinflip: _normalizedCoinflip(day, raw),
    rngLocked: lockResult.status === 'fulfilled' ? Boolean(lockResult.value) : null,
    // null, never false, when the read failed: an absent answer must not be
    // reducible to "the word is not in".
    rngFulfilled: fulfilledResult.status === 'fulfilled' ? Boolean(fulfilledResult.value) : null,
    advanceDue: advanceResult.status === 'fulfilled' ? Boolean(advanceResult.value) : null,
    reverseQueued: nudgeResult.status === 'fulfilled'
      ? String(nudgeResult.value?.queued ?? nudgeResult.value?.[0] ?? 0)
      : null,
  };
}

function _secondsToBoundary(nowMs = Date.now()) {
  const period = Math.max(1, Math.floor(Number(VOLUME_WINDOW?.period) || 0));
  const anchor = Math.floor(Number(VOLUME_WINDOW?.anchor) || 0);
  const seconds = Math.floor(Number(nowMs) / 1000);
  if (!Number.isFinite(seconds)) return period;
  const elapsed = ((seconds - anchor) % period + period) % period;
  return elapsed === 0 ? period : period - elapsed;
}

function _secondsSinceBoundary(nowMs = Date.now()) {
  const period = Math.max(1, Math.floor(Number(VOLUME_WINDOW?.period) || 0));
  const anchor = Math.floor(Number(VOLUME_WINDOW?.anchor) || 0);
  const seconds = Math.floor(Number(nowMs) / 1000);
  if (!Number.isFinite(seconds)) return period;
  return ((seconds - anchor) % period + period) % period;
}

export function nextDayProbeDelay(state = get('app.daySync'), nowMs = Date.now()) {
  // Once the chain says the advance pipeline drained, more rapid chain reads
  // cannot make the indexer catch up faster. The completion handler owns its
  // one bounded API retry; leave only a slow safety probe behind it.
  if (state?.processingComplete && !state.ready) return INDEXER_WAIT_POLL_MS;
  if (state && !state.ready) return WARMING_POLL_MS;
  // A boundary probe can land before the first block carrying the new day. Do
  // not immediately fall back to the steady cadence at elapsed=0: keep probing
  // through the post-boundary confirmation window so the next block is caught.
  if (_secondsToBoundary(nowMs) <= NEAR_BOUNDARY_SECONDS
    || _secondsSinceBoundary(nowMs) <= POST_BOUNDARY_POLL_SECONDS) {
    return NEAR_BOUNDARY_POLL_MS;
  }
  return Number(VOLUME_WINDOW?.period) <= 3_600
    ? TESTNET_STEADY_POLL_MS
    : MAINNET_STEADY_POLL_MS;
}

function _dispatchDayShift(previous, next) {
  if (!previous || Number(previous.day) === Number(next?.day)
    || typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
  try {
    const detail = { day: next.day, previousDay: previous.day };
    const event = typeof CustomEvent === 'function'
      ? new CustomEvent('game:day-shift', { detail })
      : { type: 'game:day-shift', detail };
    document.dispatchEvent(event);
  } catch (_e) { /* presentation hint only */ }
}

function _promptRefresh(previous, next) {
  if (typeof _onRefreshNeeded !== 'function' || !next) return;
  const dayChanged = Boolean(previous && Number(previous.day) !== Number(next.day));
  const readyChanged = Boolean(previous && previous.ready !== next.ready);
  const requestChanged = Boolean(previous && previous.rngRequested !== next.rngRequested);
  const processingCompleteChanged = Boolean(
    next.processingComplete && previous?.processingComplete !== true,
  );
  if (!dayChanged && !readyChanged && !requestChanged && !processingCompleteChanged) return;
  try {
    _onRefreshNeeded({
      dayChanged,
      readyChanged,
      requestChanged,
      processingCompleteChanged,
      state: next,
    });
  }
  catch (_e) { /* normal cadence remains armed */ }
}

function _publish(snapshot) {
  const previous = get('app.daySync') || null;
  const next = reconcileDaySync({ snapshot, lastDay: get('app.lastDay'), previous });
  if (!next) return previous;
  if (_materialKey(previous) !== _materialKey(next)) update('app.daySync', next);
  _dispatchDayShift(previous, next);
  _promptRefresh(previous, next);
  return next;
}

function _schedule() {
  if (!_running || typeof setTimeout !== 'function') return;
  if (_timer != null) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = null;
    if (isMajorDrawActive()) {
      // Keep the chain clock off the reel's main-thread lane. Resume from the
      // next ordinary cadence instead of issuing a catch-up at draw release.
      _schedule();
      return;
    }
    void refreshDayRollover();
  }, nextDayProbeDelay());
  try { _timer?.unref?.(); } catch (_e) { /* browser timer */ }
}

export async function refreshDayRollover() {
  if (!_running && !_snapshotReader) return get('app.daySync') || null;
  if (_probeInFlight) return _probeInFlight;
  const request = (async () => {
    try { return _publish(await _readSnapshot()); }
    catch (_e) { return get('app.daySync') || null; }
    finally {
      if (_probeInFlight === request) _probeInFlight = null;
      _schedule();
    }
  })();
  _probeInFlight = request;
  return request;
}

export function startDayRollover({ onRefreshNeeded = null } = {}) {
  stopDayRollover();
  _running = true;
  _onRefreshNeeded = typeof onRefreshNeeded === 'function' ? onRefreshNeeded : null;
  _lastDayUnsub = subscribe('app.lastDay', () => {
    const current = get('app.daySync');
    if (!current?.day) return;
    _publish({
      day: current.day,
      blockNumber: current.chainBlock,
      coinflip: current.coinflipResult,
      rngLocked: current.rngLocked,
      rngFulfilled: current.rngFulfilled,
      advanceDue: current.advanceDue,
      reverseQueued: current.reverseQueued,
    });
  });
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    _visibilityListener = () => {
      if (document.visibilityState === 'visible') void refreshDayRollover();
      else if (_timer != null) {
        clearTimeout(_timer);
        _timer = null;
      }
    };
    document.addEventListener('visibilitychange', _visibilityListener);
  }
  void refreshDayRollover();
}

export function stopDayRollover() {
  _running = false;
  if (_timer != null) clearTimeout(_timer);
  _timer = null;
  if (_lastDayUnsub) _lastDayUnsub();
  _lastDayUnsub = null;
  if (_visibilityListener && typeof document !== 'undefined'
    && typeof document.removeEventListener === 'function') {
    document.removeEventListener('visibilitychange', _visibilityListener);
  }
  _visibilityListener = null;
  _onRefreshNeeded = null;
}

export const _testing = {
  setSnapshotReader(fn) { _snapshotReader = typeof fn === 'function' ? fn : null; },
  reset() {
    stopDayRollover();
    _snapshotReader = null;
    _provider = null;
    _probeInFlight = null;
  },
  normalizedCoinflip: _normalizedCoinflip,
  secondsToBoundary: _secondsToBoundary,
  secondsSinceBoundary: _secondsSinceBoundary,
  publish: _publish,
};
