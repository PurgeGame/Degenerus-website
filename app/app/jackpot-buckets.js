// Pure jackpot-board aggregation used by replay-panel's public scratch reveals.
//
// Roll 1 emits one JackpotEthWin row per winning entry. Buckets pay the same
// ETH amount to every entry, so total / row count is the displayed "per win"
// value and row count is the multiplier. Ticket companion awards are carried
// alongside that currency result so the public background can show the actual
// tickets distributed too; whale passes and DGNRS remain player-only details.

/**
 * @param {Array<object>|null|undefined} wins Roll 1 event rows
 * @param {Array<number|null|undefined>} displayTraits Four drawn trait IDs
 * @returns {Array<{
 *   traitId: number,
 *   winnerCount: number,
 *   uniqueWinnerCount: number,
 *   perWinWei: bigint,
 *   ticketWinnerCount: number,
 *   ticketUniqueWinnerCount: number,
 *   ticketEntriesTotal: bigint,
 *   ticketEntriesPerWinner: bigint,
 *   ticketEntriesMin: bigint,
 *   ticketEntriesMax: bigint,
 * }|null>}
 */
export function buildRoll1BucketSummaries(
  wins,
  displayTraits,
  currency = 'ETH',
) {
  const traits = Array.isArray(displayTraits) ? displayTraits : [];
  if (!Array.isArray(wins)) return traits.map(() => null);
  const payoutCurrency = String(currency).toUpperCase() === 'FLIP' ? 'FLIP' : 'ETH';

  const byTrait = new Map();
  for (const row of wins) {
    if (!row || row.traitId == null) continue;
    const awardType = String(row.awardType || '').toLowerCase();
    const isEth = awardType === 'eth';
    const isFlip = awardType === 'flip' || row.currency === 'FLIP';
    const isTicket = awardType === 'tickets' || awardType === 'ticket';
    const isCurrency = payoutCurrency === 'FLIP' ? isFlip : isEth;
    if (!isCurrency && !isTicket) continue;
    const traitId = Number(row.traitId);
    if (!Number.isInteger(traitId) || traitId < 0 || traitId > 255) continue;
    let amount;
    try { amount = BigInt(row.amount || 0); } catch (_e) { continue; }
    let group = byTrait.get(traitId);
    if (!group) {
      group = {
        rows: 0,
        total: 0n,
        winners: new Set(),
        ticketRows: 0,
        ticketTotal: 0n,
        ticketMin: null,
        ticketMax: 0n,
        ticketWinners: new Set(),
      };
      byTrait.set(traitId, group);
    }
    const winner = String(row.winner || '').toLowerCase();
    if (isCurrency) {
      group.rows += 1;
      group.total += amount;
      if (winner) group.winners.add(winner);
    } else {
      group.ticketRows += 1;
      group.ticketTotal += amount;
      if (group.ticketMin == null || amount < group.ticketMin) group.ticketMin = amount;
      if (amount > group.ticketMax) group.ticketMax = amount;
      if (winner) group.ticketWinners.add(winner);
    }
  }

  return traits.map((rawTraitId) => {
    const traitId = Number(rawTraitId);
    if (!Number.isInteger(traitId) || traitId < 0 || traitId > 255) return null;
    const group = byTrait.get(traitId);
    if (!group || group.rows === 0) {
      return {
        traitId,
        winnerCount: 0,
        uniqueWinnerCount: 0,
        perWinWei: 0n,
        ticketWinnerCount: group?.ticketRows ?? 0,
        ticketUniqueWinnerCount: group?.ticketWinners?.size ?? 0,
        ticketEntriesTotal: group?.ticketTotal ?? 0n,
        ticketEntriesPerWinner: group?.ticketRows
          ? group.ticketTotal / BigInt(group.ticketRows)
          : 0n,
        ticketEntriesMin: group?.ticketMin ?? 0n,
        ticketEntriesMax: group?.ticketMax ?? 0n,
        ...(payoutCurrency === 'FLIP' ? { currency: 'FLIP' } : {}),
      };
    }
    return {
      traitId,
      winnerCount: group.rows,
      uniqueWinnerCount: group.winners.size,
      perWinWei: group.total / BigInt(group.rows),
      ticketWinnerCount: group.ticketRows,
      ticketUniqueWinnerCount: group.ticketWinners.size,
      ticketEntriesTotal: group.ticketTotal,
      ticketEntriesPerWinner: group.ticketRows
        ? group.ticketTotal / BigInt(group.ticketRows)
        : 0n,
      ticketEntriesMin: group.ticketMin ?? 0n,
      ticketEntriesMax: group.ticketMax ?? 0n,
      ...(payoutCurrency === 'FLIP' ? { currency: 'FLIP' } : {}),
    };
  });
}

/**
 * Split the pre-game (game level 0 / purchase level 1) double-FLIP draw.
 *
 * That path intentionally emits no ETH or ticket distributions, so the normal
 * Roll 1 API is empty. The contract's first draw targets level 1 with the
 * persisted main traits; its second targets levels 2..5 with the persisted
 * bonus traits. Null-trait far-future rows cannot be distinguished after
 * indexing and remain on the bonus center, matching the existing API.
 */
export function splitOpeningFlipDraw(distributions, mainTraits, bonusTraits) {
  const rows = Array.isArray(distributions) ? distributions : [];
  const main = new Set((Array.isArray(mainTraits) ? mainTraits : []).map(Number));
  const bonus = new Set((Array.isArray(bonusTraits) ? bonusTraits : []).map(Number));
  const flipRows = rows.filter((row) => {
    const awardType = String(row?.awardType || '').toLowerCase();
    return row && (awardType === 'flip' || row.currency === 'FLIP');
  });
  return {
    mainWins: flipRows.filter((row) => (
      row.traitId != null
      && Number(row.level) === 1
      && main.has(Number(row.traitId))
    )),
    bonusWins: flipRows.filter((row) => (
      row.traitId == null
      || (
        Number(row.level) >= 2
        && Number(row.level) <= 5
        && bonus.has(Number(row.traitId))
      )
    )),
  };
}

/**
 * Aggregate the public Roll 2 result for the same four-quadrant scratch board.
 * Roll 2 pays one equal FLIP amount per winning entry; null-trait rows belong
 * to the far-future center and are deliberately left out of these quadrants.
 *
 * @param {Array<object>|null|undefined} wins Roll 2 event rows
 * @param {Array<number|null|undefined>} displayTraits Four drawn trait IDs
 * @returns {Array<{
 *   traitId: number,
 *   winnerCount: number,
 *   uniqueWinnerCount: number,
 *   perWinWei: bigint,
 *   currency: 'FLIP',
 *   ticketWinnerCount: number,
 *   ticketUniqueWinnerCount: number,
 *   ticketEntriesTotal: bigint,
 *   ticketEntriesPerWinner: bigint,
 *   ticketEntriesMin: bigint,
 *   ticketEntriesMax: bigint,
 * }|null>}
 */
export function buildRoll2BucketSummaries(wins, displayTraits) {
  const traits = Array.isArray(displayTraits) ? displayTraits : [];
  if (!Array.isArray(wins)) return traits.map(() => null);

  const byTrait = new Map();
  for (const row of wins) {
    if (!row || row.traitId == null) continue;
    const awardType = String(row.awardType || '').toLowerCase();
    const isFlip = awardType === 'flip' || row.currency === 'FLIP';
    const isTicket = awardType === 'tickets' || awardType === 'ticket';
    if (!isFlip && !isTicket) continue;
    const traitId = Number(row.traitId);
    if (!Number.isInteger(traitId) || traitId < 0 || traitId > 255) continue;
    let amount;
    try { amount = BigInt(row.amount || 0); } catch (_e) { continue; }
    let group = byTrait.get(traitId);
    if (!group) {
      group = {
        rows: 0,
        total: 0n,
        winners: new Set(),
        ticketRows: 0,
        ticketTotal: 0n,
        ticketMin: null,
        ticketMax: 0n,
        ticketWinners: new Set(),
      };
      byTrait.set(traitId, group);
    }
    const winner = String(row.winner || '').toLowerCase();
    if (isFlip) {
      group.rows += 1;
      group.total += amount;
      if (winner) group.winners.add(winner);
    } else {
      group.ticketRows += 1;
      group.ticketTotal += amount;
      if (group.ticketMin == null || amount < group.ticketMin) group.ticketMin = amount;
      if (amount > group.ticketMax) group.ticketMax = amount;
      if (winner) group.ticketWinners.add(winner);
    }
  }

  return traits.map((rawTraitId) => {
    const traitId = Number(rawTraitId);
    if (!Number.isInteger(traitId) || traitId < 0 || traitId > 255) return null;
    const group = byTrait.get(traitId);
    if (!group || group.rows === 0) {
      return {
        traitId,
        winnerCount: 0,
        uniqueWinnerCount: 0,
        perWinWei: 0n,
        currency: 'FLIP',
        ticketWinnerCount: group?.ticketRows ?? 0,
        ticketUniqueWinnerCount: group?.ticketWinners?.size ?? 0,
        ticketEntriesTotal: group?.ticketTotal ?? 0n,
        ticketEntriesPerWinner: group?.ticketRows
          ? group.ticketTotal / BigInt(group.ticketRows)
          : 0n,
        ticketEntriesMin: group?.ticketMin ?? 0n,
        ticketEntriesMax: group?.ticketMax ?? 0n,
      };
    }
    return {
      traitId,
      winnerCount: group.rows,
      uniqueWinnerCount: group.winners.size,
      perWinWei: group.total / BigInt(group.rows),
      currency: 'FLIP',
      ticketWinnerCount: group.ticketRows,
      ticketUniqueWinnerCount: group.ticketWinners.size,
      ticketEntriesTotal: group.ticketTotal,
      ticketEntriesPerWinner: group.ticketRows
        ? group.ticketTotal / BigInt(group.ticketRows)
        : 0n,
      ticketEntriesMin: group.ticketMin ?? 0n,
      ticketEntriesMax: group.ticketMax ?? 0n,
    };
  });
}
