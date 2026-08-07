// app/api.js — the components' REST client.
//
// This file used to carry a second, complete polling stack: startPolling,
// stopPolling, gameTimer/playerTimer/healthTimer/jackpotPollTimer,
// pollGameState, pollPlayerData, fetchPlayerData, checkHealth,
// refreshAfterAction, and its own consecutiveFails/MAX_BACKOFF — against a
// separate POLL_INTERVALS in constants.js. None of it ran. main.js imports
// `start` from polling.js, and every single `from './api.js'` in the codebase
// imports `{ fetchJSON }` and nothing else. Seven of eight exports were dead.
//
// It was worse than dead weight: it was ~200 lines of plausible, authoritative
// -looking polling code sitting next to the real thing, and it did mislead a
// reader looking for the app's backoff behaviour. Deleted 2026-08-07.
//
// What remains is the one thing components actually use.

import { API_BASE } from './constants.js';
import {
  isCoolingDown, noteShedLoad, clearApiCooldown, isShedStatus,
} from './api-cooldown.js';

// App panels mount together and many consume the same large player payload.
// Share only requests that are currently in flight: this collapses the boot
// burst without serving stale data after a transaction or on the next poll.
const inflightJSON = new Map();

export function fetchJSON(path) {
  const key = String(path);
  const existing = inflightJSON.get(key);
  if (existing) return existing;

  const request = (async () => {
    // Shared with polling.js via api-cooldown.js. Without this, a shedding API
    // stopped the timers but every panel kept knocking on its own schedule.
    if (isCoolingDown()) throw new Error(`API cooling down: ${key}`);
    const res = await fetch(API_BASE + key);
    if (isShedStatus(res.status)) {
      noteShedLoad(res);
      throw new Error(`API ${res.status}: ${key}`);
    }
    if (!res.ok) throw new Error(`API ${res.status}: ${key}`);
    clearApiCooldown();
    return res.json();
  })();
  const tracked = request.finally(() => {
    if (inflightJSON.get(key) === tracked) inflightJSON.delete(key);
  });
  inflightJSON.set(key, tracked);
  return tracked;
}
