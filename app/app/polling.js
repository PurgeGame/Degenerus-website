// /app/app/polling.js — Phase 56 Plan 56-03 (APP-04 + APP-06).
//
// 4-timer polling hierarchy at LOCKED cadence (D-04):
//   - gameTimer    15s
//   - playerTimer  30s
//   - healthTimer  60s
//   - lastDayTimer 60s   (NEW — consumed by Phase 59 JKP; route ships in Phase 57)
//
// AbortController-per-cycle (D-06): each timer firing creates a new AbortController;
// the previous in-flight cycle for the same timer is aborted before the new one starts.
// All fetches in a cycle share that cycle's signal via Promise.allSettled
// (NOT the short-circuiting variant) — one bad endpoint does not blank the
// other 3 panels (Pitfall 7).
//
// document.visibilitychange handler with 100ms debounce (Pitfall 3 iOS Safari double-fire):
// hidden → pauseAllTimers + abortAllInflight; visible → immediate re-poll across all 4 cycles.
//
// Pitfall 5 reconciliation (D-04 satisfied): cross-imports ONLY the API_BASE constant
// from /beta/app/constants.js (READ-ONLY — zero /beta/ edits). /beta/'s fetchJSON does
// not accept {signal}, so polling.js wraps native fetch (~5 LOC) inline.
//
// abortAllInflight() exported as a stub for Phase 58 accountsChanged/disconnect wiring.

import { API_BASE } from '../../beta/app/constants.js';

// ---------------------------------------------------------------------------
// LOCKED constants (D-04 + Pitfall 3)
// ---------------------------------------------------------------------------

export const POLL_INTERVALS = {
  gameState: 15_000,   // 15s
  playerData: 30_000,  // 30s
  health: 60_000,      // 60s
  lastDay: 60_000,     // 60s NEW
};

const VISIBILITY_DEBOUNCE_MS = 100; // Pitfall 3 mitigation
const TIMER_HANDLES = { game: null, player: null, health: null, lastDay: null };
const ACTIVE_CYCLES = new Map(); // timerName → AbortController

// ---------------------------------------------------------------------------
// Pitfall 5 reconciliation: own fetch wrapper that supports {signal}.
// D-04 satisfied — cross-import API_BASE only, no /beta/ edit, no fetchJSON cross-import.
// ---------------------------------------------------------------------------

async function fetchJSONWithSignal(path, { signal } = {}) {
  const res = await fetch(API_BASE + path, { signal });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// 4 pollers — each accepts a signal arg threaded through fetchJSONWithSignal.
// Phase 56 ships skeleton only; Phase 58+ wires results into the /app/ store.
// ---------------------------------------------------------------------------

async function pollGame(signal) {
  return fetchJSONWithSignal('/game/state', { signal });
}

async function pollPlayer(addr, signal) {
  if (!addr) return null;
  return fetchJSONWithSignal(`/player/${addr}`, { signal });
}

async function pollHealth(signal) {
  return fetchJSONWithSignal('/health', { signal });
}

async function pollLastDay(signal) {
  // Phase 57 ships /game/jackpot/last-day. Until then, tolerate 404 and return null.
  // Soft-fail: UI panels (Phase 59) will render a cold-start state.
  try {
    return await fetchJSONWithSignal('/game/jackpot/last-day', { signal });
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// runCycle (D-06 abort-per-cycle + Promise.allSettled)
// ---------------------------------------------------------------------------

function runCycle(timerName, fetchers) {
  // Abort the previous cycle for this timer if still running.
  const prev = ACTIVE_CYCLES.get(timerName);
  if (prev) prev.abort();
  const ctrl = new AbortController();
  ACTIVE_CYCLES.set(timerName, ctrl);
  // Promise.allSettled — D-06 + Pitfall 7: one rejected fetcher does not blank the others.
  return Promise.allSettled(fetchers.map((f) => f(ctrl.signal))).finally(() => {
    if (ACTIVE_CYCLES.get(timerName) === ctrl) ACTIVE_CYCLES.delete(timerName);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle: start / stop / abortAllInflight / pauseAllTimers
// ---------------------------------------------------------------------------

export function start({ playerAddress = null } = {}) {
  // Clear any previously registered handles before re-registering.
  pauseAllTimers();
  const game     = () => runCycle('game',     [(s) => pollGame(s)]);
  const player   = () => runCycle('player',   [(s) => pollPlayer(playerAddress, s)]);
  const health   = () => runCycle('health',   [(s) => pollHealth(s)]);
  const lastDay  = () => runCycle('lastDay',  [(s) => pollLastDay(s)]);
  // Eager first cycle (each timer fires immediately, before the first setInterval tick).
  game(); player(); health(); lastDay();
  TIMER_HANDLES.game     = setInterval(game,    POLL_INTERVALS.gameState);
  TIMER_HANDLES.player   = setInterval(player,  POLL_INTERVALS.playerData);
  TIMER_HANDLES.health   = setInterval(health,  POLL_INTERVALS.health);
  TIMER_HANDLES.lastDay  = setInterval(lastDay, POLL_INTERVALS.lastDay);
}

export function stop() {
  pauseAllTimers();
}

export function abortAllInflight() {
  // Phase 58 (WLT) wires this to accountsChanged / disconnect events.
  for (const ctrl of ACTIVE_CYCLES.values()) ctrl.abort();
  ACTIVE_CYCLES.clear();
}

function pauseAllTimers() {
  for (const k of Object.keys(TIMER_HANDLES)) {
    if (TIMER_HANDLES[k]) clearInterval(TIMER_HANDLES[k]);
    TIMER_HANDLES[k] = null;
  }
  abortAllInflight();
}

// ---------------------------------------------------------------------------
// visibilitychange handler with 100ms debounce (Pitfall 3 + APP-04)
// ---------------------------------------------------------------------------

let visTimeout = null;
export function handleVisibilityChange() {
  if (visTimeout) clearTimeout(visTimeout);
  visTimeout = setTimeout(() => {
    visTimeout = null;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      // Immediate re-poll across all 4 cycles (within 1s per APP-04 success criterion).
      runCycle('game',    [(s) => pollGame(s)]);
      runCycle('player',  [(s) => pollPlayer(null, s)]); // Phase 58 supplies addr
      runCycle('health',  [(s) => pollHealth(s)]);
      runCycle('lastDay', [(s) => pollLastDay(s)]);
    } else {
      pauseAllTimers();
    }
  }, VISIBILITY_DEBOUNCE_MS);
}

// Browser-only side-effect registration. typeof guard makes polling.js importable
// inside `node --test` without throwing (browser runtime is unaffected).
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

// ---------------------------------------------------------------------------
// Test-only introspection surface (NOT for downstream consumers).
// ---------------------------------------------------------------------------

export const _testing = {
  get TIMER_HANDLES() { return TIMER_HANDLES; },
  get ACTIVE_CYCLES() { return ACTIVE_CYCLES; },
  runCycle,
  pauseAllTimers,
  fetchJSONWithSignal,
};
