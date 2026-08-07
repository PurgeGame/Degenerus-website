// One reader for the shared game snapshot, and one correct way to get the day
// out of it.
//
// polling.js writes `app.gameState` to the store every 15s. Fourteen call sites
// were re-fetching /game/state over the network anyway, which made it the most
// requested endpoint on the site — a production page load showed 32 requests
// across three loads, roughly double the poll cadence, for a value already in
// memory.
//
// The day accessor exists because /game/state has NO `currentDay` field and
// never has: the day lives at `dailyRng.day`. Two separate call sites read the
// nonexistent one, and both failed silently — `Number(undefined)` is NaN, the
// guard below it returned early, and the feature simply never appeared. That
// killed the boon indicator (polling.js) and the boons panel
// (app-boons-panel.js). Anything needing the day should call gameDay().

import { get } from './store.js';
import { fetchJSON } from './api.js';

/**
 * The shared game snapshot. Reads the store by default — polling.js keeps it
 * within one 15s cycle, which is fresher than most callers were achieving with
 * their own uncoordinated fetches anyway.
 *
 * Pass `{ fresh: true }` only when the answer must reflect a write this client
 * just made and cannot wait for the next cycle. That is a real need at a few
 * sites; it is not the default.
 *
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<object|null>}
 */
export async function readGameState({ fresh = false } = {}) {
  if (!fresh) {
    const cached = get('app.gameState');
    if (cached) return cached;
  }
  // Store not populated yet (first paint, before the eager cycle lands) or a
  // deliberate fresh read. fetchJSON coalesces concurrent identical GETs, so a
  // boot burst across many panels is still one request.
  return fetchJSON('/game/state').catch(() => null);
}

/**
 * Resolve the current game day from a snapshot.
 *
 * `dailyRng.day` first — that is the field the API actually returns.
 * `currentDay` is kept as a fallback purely so a future payload that does carry
 * it keeps working; it is not present today.
 *
 * @param {object|null} state
 * @returns {number|null} a positive integer day, or null
 */
export function gameDay(state) {
  const raw = state?.dailyRng?.day ?? state?.currentDay ?? null;
  const day = Number(raw);
  return Number.isInteger(day) && day > 0 ? day : null;
}
