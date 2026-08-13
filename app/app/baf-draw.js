// Shared model for the BAF final-purchase-day weighted draw.
//
// Coinflip.BafDrawEntered emits `weight` in whole FLIP. It is the raw,
// self-funded principal only: boon credit, reuse credit, quest credit, and all
// other free stake are deliberately excluded by the contract.

const TOP_COUNT = 10;

function _big(value) {
  try { return BigInt(value ?? 0); } catch (_error) { return 0n; }
}

function _address(value) {
  return String(value || '').toLowerCase();
}

export function normalizeBafDraw(payload, targetDay, viewedAddress = null) {
  const day = Number(targetDay);
  const rows = Array.isArray(payload) ? payload : payload?.entries;
  const byRank = new Map();
  if (Number.isInteger(day) && Array.isArray(rows)) {
    for (const raw of rows) {
      const rank = Number(raw?.rank);
      const player = _address(raw?.player);
      if (Number(raw?.day) !== day || !player
        || !Number.isInteger(rank) || rank < 1 || rank > TOP_COUNT
        || byRank.has(rank)) continue;
      byRank.set(rank, {
        day,
        player,
        score: _big(raw?.score).toString(),
        rank,
      });
    }
  }
  const entries = [...byRank.values()].sort((left, right) => left.rank - right.rank);
  const viewed = _address(viewedAddress);
  const hasExactPlayerField = payload != null
    && !Array.isArray(payload)
    && Object.hasOwn(payload, 'player');
  const rawPlayer = payload?.player;
  const exactPlayer = rawPlayer
    && Number(rawPlayer.day) === day
    && (!viewed || _address(rawPlayer.player) === viewed)
      ? {
          day,
          player: _address(rawPlayer.player),
          score: _big(rawPlayer.score).toString(),
          rank: Number.isInteger(Number(rawPlayer.rank)) && Number(rawPlayer.rank) > 0
            ? Number(rawPlayer.rank)
            : null,
        }
      : null;
  const visiblePlayer = viewed
    ? entries.find((entry) => entry.player === viewed) || null
    : null;
  const player = exactPlayer
    || visiblePlayer
    || (viewed && hasExactPlayerField
      ? { day, player: viewed, score: '0', rank: null }
      : null);
  const hasTotal = payload != null
    && !Array.isArray(payload)
    && Object.hasOwn(payload, 'totalWeight');
  const participants = Number(payload?.totalParticipants);

  return {
    day: Number.isInteger(day) ? day : null,
    entries,
    totalWeight: hasTotal && payload.totalWeight != null
      ? _big(payload.totalWeight).toString()
      : null,
    totalParticipants: Number.isInteger(participants) && participants >= 0
      ? participants
      : null,
    player,
  };
}

/** Two-decimal draw chance without floating-point loss. */
export function formatBafDrawPercent(weightRaw, totalRaw) {
  if (totalRaw == null) return '—';
  const weight = _big(weightRaw);
  const total = _big(totalRaw);
  if (total <= 0n || weight <= 0n) return '0.00%';
  const hundredths = (weight * 10_000n) / total;
  if (hundredths === 0n) return '<0.01%';
  const whole = hundredths / 100n;
  const fraction = String(hundredths % 100n).padStart(2, '0');
  return `${whole}.${fraction}%`;
}

export const BAF_DRAW_COLORS = Object.freeze([
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6',
]);

/**
 * Pie allocation: top ten, the viewed player when outside the ten, then the
 * honest remainder. PPM endpoints avoid float drift while preserving tiny
 * visible probabilities in the legend.
 */
export function buildBafDrawAllocation(draw, viewedAddress = null) {
  const total = _big(draw?.totalWeight);
  if (total <= 0n) return { totalWeight: '0', entries: [] };
  const viewed = _address(viewedAddress || draw?.player?.player);
  const entries = [];
  const included = new Set();
  let represented = 0n;

  for (const row of Array.isArray(draw?.entries) ? draw.entries.slice(0, TOP_COUNT) : []) {
    const score = _big(row?.score);
    const player = _address(row?.player);
    if (!player || score <= 0n || included.has(player)) continue;
    included.add(player);
    represented += score;
    entries.push({
      ...row,
      player,
      score: score.toString(),
      kind: 'leader',
      isPlayer: Boolean(viewed && player === viewed),
      color: viewed && player === viewed
        ? '#d9fff5'
        : BAF_DRAW_COLORS[(Math.max(1, Number(row.rank)) - 1) % BAF_DRAW_COLORS.length],
    });
  }

  const playerScore = _big(draw?.player?.score);
  if (viewed && draw?.player && !included.has(viewed)) {
    included.add(viewed);
    represented += playerScore;
    entries.push({
      ...draw.player,
      player: viewed,
      score: playerScore.toString(),
      kind: 'player',
      isPlayer: true,
      color: '#d9fff5',
    });
  }

  const other = total > represented ? total - represented : 0n;
  if (other > 0n) {
    entries.push({
      player: null,
      score: other.toString(),
      rank: null,
      kind: 'other',
      isPlayer: false,
      color: '#334155',
    });
  }

  let cursor = 0n;
  return {
    totalWeight: total.toString(),
    entries: entries.map((entry, index) => {
      const score = _big(entry.score);
      const startPpm = cursor;
      cursor += (score * 1_000_000n) / total;
      const endPpm = index === entries.length - 1 ? 1_000_000n : cursor;
      return {
        ...entry,
        startPpm: Number(startPpm),
        endPpm: Number(endPpm),
        percent: formatBafDrawPercent(score, total),
      };
    }),
  };
}
