// Deterministic packing for the jackpot scratchoff's winning-trait badges.
// The cells keep every win readable; bounded jitter, rotation, and shuffled
// layers stop a busy reveal from looking like a spreadsheet.

export const WIN_RECEIPT_BAND_PERCENT = 40;
export const WIN_ART_GAP_PERCENT = 2;
export const WIN_ART_EDGE_GUTTER_PERCENT = 3;
export const WIN_BADGE_MAX_PERCENT = 52;

function _overlapArea(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function _unitNoise(seed) {
  let value = Math.trunc(Number(seed) || 0) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function _clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
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
  let size = Math.min(tierMax, WIN_BADGE_MAX_PERCENT, cellFit * 1.04, artHeight);
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

  const packed = candidates
    .sort((a, b) => a.diamondOverlap - b.diamondOverlap || a.row - b.row || a.column - b.column)
    .slice(0, total)
    .sort((a, b) => a.row - b.row || a.column - b.column);

  return packed.map(({ left, top, size: badgeSize, row, column }, index) => {
    // At 1.3% of badge width per axis, neighbors still look hand-scattered
    // without spending the layout's full 12% overlap budget.
    const jitter = total === 1 ? 0 : badgeSize * 0.013;
    const seed = 0x9e3779b9
      ^ Math.imul(qIdx + 1, 0x85ebca6b)
      ^ Math.imul(total + 3, 0xc2b2ae35)
      ^ Math.imul(row + 5, 0x27d4eb2d)
      ^ Math.imul(column + 7, 0x165667b1)
      ^ Math.imul(index + 11, 0xd3a2646c);
    const xOffset = (_unitNoise(seed) * 2 - 1) * jitter;
    const yOffset = (_unitNoise(seed ^ 0xa511e9b3) * 2 - 1) * jitter;
    const rotationNoise = _unitNoise(seed ^ 0x63d83595) * 2 - 1;
    const rotation = total === 1
      ? (qIdx - 1.5) * 1.4
      : Math.round(rotationNoise * 130) / 10;
    const layer = 1 + Math.floor(_unitNoise(seed ^ 0xb5297a4d) * 5);
    return {
      left: _clamp(left + xOffset, artLeft, artRight - badgeSize),
      top: _clamp(top + yOffset, artStart, artEnd - badgeSize),
      size: badgeSize,
      rotation,
      layer,
    };
  });
}
