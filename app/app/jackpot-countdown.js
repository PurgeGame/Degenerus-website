// Compact countdown to the protocol's next day crossover. This deliberately
// does not guess how long keeper/RNG processing will take after the boundary:
// comparing this exact clock with the live jackpot phase makes that lag
// observable instead of hiding it behind a hard-coded readiness estimate.

import { VOLUME_WINDOW } from './chain-config.js';

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/** Whole seconds remaining until the next protocol day boundary. */
export function secondsUntilDayCrossover(nowMs = Date.now(), clock = VOLUME_WINDOW) {
  const period = Math.max(1, Math.floor(Number(clock?.period) || 0));
  const anchor = Math.floor(Number(clock?.anchor) || 0);
  const nowSeconds = Number(nowMs) / 1000;
  if (!Number.isFinite(nowSeconds)) return period;
  const elapsed = positiveModulo(nowSeconds - anchor, period);
  // ceil keeps the display from announcing 00:00 early. At the exact boundary
  // the counter begins tracking the following protocol day.
  return Math.max(1, Math.ceil(period - elapsed));
}

export function formatJackpotCountdown(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

/**
 * Mount the timer into the app-only nav node created by shared/nav.js.
 * Returns a cleanup function so tests or a future client-side nav remount can
 * retire the interval without leaking another clock.
 */
export function mountJackpotCountdown({
  root = typeof document === 'undefined' ? null : document,
  now = () => Date.now(),
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
  clock = VOLUME_WINDOW,
} = {}) {
  const host = root?.querySelector?.('[data-bind="nav-jackpot-countdown"]');
  const value = host?.querySelector?.('[data-bind="nav-jackpot-countdown-value"]');
  if (!host || !value) return () => {};

  const paint = () => {
    const remaining = secondsUntilDayCrossover(now(), clock);
    const text = formatJackpotCountdown(remaining);
    value.textContent = text;
    host.setAttribute?.('aria-label', `Next jackpot in ${text}`);
    host.title = `Next jackpot in ${text}`;
  };
  paint();
  const timer = setTimer(paint, 250);
  try { timer?.unref?.(); } catch (_e) { /* browser timers have no unref */ }
  return () => clearTimer(timer);
}
