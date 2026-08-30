// Optional indexed presentation data for the Craps lobby.
//
// Keep this transport outside craps.js: that module owns money-in contract
// writes and must remain wallet/RPC -> contract even when the API or DB is down.

import { fetchJSON } from './api.js';
import { crapsWinnerTotalsFromPayload } from './craps.js';

/** One optional indexer read supplies exact totals for all visible winner rows. */
export async function readCrapsWinnerTotals(dayValue, fetcher = fetchJSON) {
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0 || typeof fetcher !== 'function') return Object.freeze([]);
  return crapsWinnerTotalsFromPayload(
    day,
    await fetcher('/game/craps/lobby/' + day + '/results'),
  );
}
