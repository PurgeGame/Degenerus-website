// /app/app/craps-events.js — the ONE call site for GET /game/craps/events.
//
// craps.js is a mission-critical money-in writer and
// app/__tests__/money-in-db-independence.test.js asserts its whole source
// stays free of any indexer/API dependency, so a dead indexer never blocks a
// wallet gesture. The lobby WINDOW read is API-first, so that one fetch lives
// here; craps.js imports only the wrapper below, never `fetchJSON`/`./api.js`.
// Same pattern as coinflip-day-status.js and parimutuel-winners.js.

import { fetchJSON } from './api.js';

let _fetch = fetchJSON;

/** The one call site for GET /game/craps/events[?since=]. */
export function fetchCrapsEventsJSON(path) {
  return _fetch(path);
}

/** Test-only: replace the underlying fetch. */
export function __setCrapsEventsTransportForTest(fetcher) {
  _fetch = typeof fetcher === 'function' ? fetcher : fetchJSON;
}
