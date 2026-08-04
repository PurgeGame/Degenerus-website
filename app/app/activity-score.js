// Activity-score display helpers shared by the compact and expanded panels.
//
// `scoreBreakdown.questStreakPoints` is a legacy field name: the indexer stores
// the raw effective quest-streak count there, while the current contract adds
// floor(count / 2) to the Degen Score. Recovering the credited term from the
// authoritative total also keeps the UI compatible with older API responses
// that briefly returned the already-halved value for active afKing players.

function _number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function questStreakScorePoints(score) {
  if (!score || score.totalBps == null) {
    return Math.floor(Math.max(0, _number(score?.questStreakPoints)) / 2);
  }

  const total = _number(score.totalBps);
  const nonQuest = _number(score.mintLevelStreakPoints)
    + _number(score.mintCountPoints)
    + _number(score.affiliatePoints)
    + _number(score.passBonus?.points);
  const curse = Math.abs(_number(score.cursePoints));
  return Math.max(0, Math.floor(total + curse - nonQuest));
}

/** Loot-style display tier shared by every Degen Score readout. */
export function degenScoreLootTier(value) {
  const points = Number(value);
  if (!Number.isFinite(points)) return null;
  if (points < 60) return 'white';
  if (points < 150) return 'green';
  if (points < 300) return 'purple';
  if (points < 1_000) return 'orange';
  return 'gold';
}
