// Deterministic packing for the jackpot scratchoff's winning-trait badges.
// A small (at most ~6% of the grid stride) overlap keeps the loose scratch-ticket feel without
// allowing later badges to hide the result underneath them.

export const WIN_RECEIPT_BAND_PERCENT = 40;
export const WIN_ART_GAP_PERCENT = 2;
export const WIN_ART_EDGE_GUTTER_PERCENT = 3;
export const WIN_BADGE_MAX_PERCENT = 52;

function _overlapArea(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

/**
 * Pack up to twenty badges into the quadrant's art lane. Positions are stable
 * across renders, stay clear of the payout receipt, and use one spare grid
 * cell (when available) to avoid the center diamond.
 */
export function winningBadgeLayout({
  count,
  quadrant,
  soloIndex = -1,
  soloSize = 0,
} = {}) {
  const total = Math.max(0, Math.min(20, Math.trunc(Number(count) || 0)));
  if (total === 0) return [];
  const qIdx = Math.max(0, Math.min(3, Math.trunc(Number(quadrant) || 0)));
  const topRow = qIdx < 2;
  const leftColumn = qIdx % 2 === 0;
  const artStart = topRow
    ? WIN_RECEIPT_BAND_PERCENT + WIN_ART_GAP_PERCENT
    : WIN_ART_EDGE_GUTTER_PERCENT;
  const artEnd = topRow
    ? 100 - WIN_ART_EDGE_GUTTER_PERCENT
    : 100 - WIN_RECEIPT_BAND_PERCENT - WIN_ART_GAP_PERCENT;
  const artHeight = artEnd - artStart;
  const artLeft = WIN_ART_EDGE_GUTTER_PERCENT;
  const artRight = 100 - WIN_ART_EDGE_GUTTER_PERCENT;
  const artWidth = artRight - artLeft;

  let columns = 1;
  let rows = total;
  let cellFit = 0;
  for (let candidateColumns = 1; candidateColumns <= total; candidateColumns += 1) {
    const candidateRows = Math.ceil(total / candidateColumns);
    const fit = Math.min(artWidth / candidateColumns, artHeight / candidateRows);
    const fullness = total / (candidateColumns * candidateRows);
    const score = fit * (0.94 + fullness * 0.06);
    const bestScore = cellFit * (0.94 + (total / (columns * rows)) * 0.06);
    if (score > bestScore) {
      columns = candidateColumns;
      rows = candidateRows;
      cellFit = fit;
    }
  }

  const tierMax = total === 1 ? 65 : total <= 3 ? 50 : total <= 8 ? 35 : 26;
  let size = Math.min(tierMax, WIN_BADGE_MAX_PERCENT, cellFit * 1.06, artHeight);
  if (total === 1 && soloIndex === 0 && Number(soloSize) > 0) {
    size = Math.min(Number(soloSize), WIN_BADGE_MAX_PERCENT, artHeight);
  }
  const cellWidth = artWidth / columns;
  const cellHeight = artHeight / rows;
  const diamond = {
    left: leftColumn ? 72 : 0,
    right: leftColumn ? 100 : 28,
    top: topRow ? 72 : 0,
    bottom: topRow ? 100 : 28,
  };
  const candidates = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const outerColumn = leftColumn ? column : columns - 1 - column;
      const centeredLeft = artLeft + outerColumn * cellWidth + (cellWidth - size) / 2;
      const centeredTop = artStart + row * cellHeight + (cellHeight - size) / 2;
      const left = Math.max(artLeft, Math.min(artRight - size, centeredLeft));
      const top = Math.max(artStart, Math.min(artEnd - size, centeredTop));
      const rect = { left, top, right: left + size, bottom: top + size };
      candidates.push({
        ...rect,
        size,
        row,
        column: outerColumn,
        diamondOverlap: _overlapArea(rect, diamond),
      });
    }
  }

  return candidates
    .sort((a, b) => a.diamondOverlap - b.diamondOverlap || a.row - b.row || a.column - b.column)
    .slice(0, total)
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map(({ left, top, size: badgeSize }) => ({ left, top, size: badgeSize }));
}
