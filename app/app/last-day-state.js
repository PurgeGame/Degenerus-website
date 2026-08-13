// Consistency helpers for the composed /game/jackpot/last-day payload.
//
// The endpoint is assembled from independently cached summary, winner, and
// roll fragments. At a day seal, a fresh summary can therefore prove payouts
// while the winner fragment is still carrying its pre-resolution empty value.
// An empty array is not authoritative in that contradictory state.

function _positive(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0;
}

function _rowsHaveWinners(rows) {
  return Array.isArray(rows) && rows.some((row) =>
    _positive(row?.winnerCount) || _positive(row?.uniqueCount));
}

export function lastDayHasWinnerEvidence(payload) {
  if (Array.isArray(payload?.winners) && payload.winners.length > 0) return true;
  if (Array.isArray(payload?.roll1?.wins) && payload.roll1.wins.length > 0) return true;
  if (Array.isArray(payload?.roll2?.wins) && payload.roll2.wins.length > 0) return true;

  const summary = payload?.summary;
  if (!summary || typeof summary !== 'object') return false;

  if (_rowsHaveWinners(summary.rollOne?.eth)
    || _rowsHaveWinners(summary.rollOne?.tickets)
    || summary.rollOne?.solo
    || _rowsHaveWinners(summary.rollTwo?.coin)
    || _rowsHaveWinners(summary.rollTwo?.bonusDraw)
    || _positive(summary.rollTwo?.farFuture?.winnerCount)
    || _positive(summary.baf?.eth?.winnerCount)
    || _positive(summary.baf?.tickets?.winnerCount)
    || _positive(summary.decimator?.regular?.claimCount)
    || _positive(summary.decimator?.terminal?.claimCount)) {
    return true;
  }
  return false;
}

export function normalizeLastDayPayload(payload) {
  if (payload?.status !== 'resolved-no-winners' || !lastDayHasWinnerEvidence(payload)) {
    return payload;
  }
  return { ...payload, status: 'resolved' };
}

function _hasCompleteEmptySummary(payload) {
  const summary = payload?.summary;
  return Boolean(summary
    && typeof summary === 'object'
    && summary.blockRange?.start != null
    && summary.rollOne
    && summary.rollTwo);
}

// Keep asking while independently cached fragments disagree, or while the API
// supplied no complete summary capable of proving that an empty day is real.
// A fully shaped zero-winner summary is definitive and does not create polling.
export function lastDayPayloadNeedsRecheck(payload) {
  if (!payload || payload.day == null) return false;
  const winnersEmpty = !Array.isArray(payload.winners) || payload.winners.length === 0;
  if (winnersEmpty && lastDayHasWinnerEvidence(payload)) return true;
  return payload.status === 'resolved-no-winners' && !_hasCompleteEmptySummary(payload);
}
