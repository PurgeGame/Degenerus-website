// /app/app/coinflip-day-status.js — the ONE call site for GET /coinflip/day/:day.
//
// coinflip.js is a mission-critical money-in writer (Coinflip.depositCoinflip)
// and app/__tests__/money-in-db-independence.test.js asserts its whole source
// stays free of any indexer/API dependency, so a dead indexer never blocks
// FLIP moving into the game. readResolvedCoinflipStake's day-resolution READ
// is API-first, so that one fetch lives in this satellite module instead —
// coinflip.js imports only the wrapper below, never `fetchJSON`/`./api.js`
// directly. Mirrors how craps.js keeps its read-side API window off the
// write door (see money-in-db-independence.test.js's craps.js checks).

import { fetchJSON } from './api.js';

let _fetch = fetchJSON;

/** The one call site for GET /coinflip/day/:day?player=<addr>. */
export function fetchCoinflipDayJSON(path) {
  return _fetch(path);
}

/** Test-only: replace the underlying fetch. */
export function __setCoinflipDayStatusFetcherForTest(fetcher) {
  _fetch = typeof fetcher === 'function' ? fetcher : fetchJSON;
}

/** Test-only: restore the production fetch. */
export function __resetCoinflipDayStatusFetcherForTest() {
  _fetch = fetchJSON;
}
