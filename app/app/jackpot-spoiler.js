// Shared provenance gate for player rewards materialized by the daily jackpot.
//
// The contract/indexer can expose ticket awards, Bingo proofs, and deferred
// claims while the player's spin board is still covered. Publishers use this
// context to withhold only that new jackpot-derived work; ordinary purchases
// and already-visible pending work remain independent.

import { CHAIN } from './chain-config.js';
import { get } from './store.js';

export const JACKPOT_TICKET_PROCESSING_LEVELS = 6;

function _positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function _storageValue(storage, key) {
  try { return storage?.getItem?.(key) ?? null; }
  catch (_e) { return null; }
}

export function jackpotDayRevealComplete(dayValue, { storage = globalThis.localStorage } = {}) {
  const day = _positiveInteger(dayValue);
  if (day == null) return true;
  if (_storageValue(storage, `jackpot_complete_day_${CHAIN.id}_${day}`) === '1') return true;
  // Compatibility with boards completed before the explicit all-rolls marker.
  return _storageValue(storage, `spun_day_${CHAIN.id}_${day}`) === '1'
    && _storageValue(storage, `jackpot_bonus_pending_day_${CHAIN.id}_${day}`) !== '1';
}

/**
 * Return the still-covered daily jackpot processing scope, or null.
 * `rngRequested` is latched for the day, so the scope remains active through
 * indexer catch-up and closes only when the player finishes the board.
 */
export function unresolvedJackpotContext({
  daySync = null,
  gameState = null,
  lastDay = null,
  storage = globalThis.localStorage,
} = {}) {
  const day = _positiveInteger(
    daySync?.day ?? gameState?.dailyRng?.day ?? gameState?.currentDay ?? lastDay?.day,
  );
  if (day == null) return null;
  let finalWordReady = false;
  try { finalWordReady = BigInt(gameState?.dailyRng?.finalWord ?? 0) > 0n; }
  catch (_e) { finalWordReady = false; }
  const requestStarted = daySync?.rngRequested === true
    || daySync?.rngLocked === true
    || daySync?.jackpotReady === true
    || gameState?.rngLockedFlag === true
    || finalWordReady;
  if (!requestStarted || jackpotDayRevealComplete(day, { storage })) return null;

  const exactLastDay = _positiveInteger(lastDay?.day) === day ? lastDay : null;
  const level = _positiveInteger(
    gameState?.level
      ?? exactLastDay?.roll1?.purchaseLevel
      ?? exactLastDay?.level,
  );
  return level == null ? null : { day, level };
}

export function currentUnresolvedJackpotContext() {
  return unresolvedJackpotContext({
    daySync: get('app.daySync'),
    gameState: get('app.gameState'),
    lastDay: get('app.lastDay'),
  });
}

export function jackpotProcessingCoversLevel(levelValue, context) {
  const level = Number(levelValue);
  const base = Number(context?.level);
  return Number.isInteger(level)
    && Number.isInteger(base)
    && level >= base
    && level < base + JACKPOT_TICKET_PROCESSING_LEVELS;
}
