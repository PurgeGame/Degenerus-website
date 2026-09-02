// /app/app/parimutuel-winners.js — the ONE call site for
// GET /game/parimutuel/:market/:round/winners.
//
// parimutuel.js is a mission-critical money-in writer (placeGrowthBet) and
// app/__tests__/money-in-db-independence.test.js asserts its whole source
// stays free of any indexer/API dependency, so a dead indexer never blocks a
// bet. readRoundWinners' community-winner discovery is API-first, so that one
// fetch lives in this satellite module instead — parimutuel.js imports only
// the wrapper below, never `fetchJSON`/`./api.js` directly. Mirrors how
// craps.js keeps its read-side API window off the write door.

import { fetchJSON } from './api.js';

let _fetch = fetchJSON;

/** The one call site for GET /game/parimutuel/:market/:round/winners. */
export function fetchParimutuelWinnersJSON(path) {
  return _fetch(path);
}

/** Test-only: replace the underlying fetch. */
export function __setParimutuelWinnersFetcherForTest(fetcher) {
  _fetch = typeof fetcher === 'function' ? fetcher : fetchJSON;
}

/** Test-only: restore the production fetch. */
export function __resetParimutuelWinnersFetcherForTest() {
  _fetch = fetchJSON;
}
