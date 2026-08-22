// Player-facing prize extraction for the one-shot Day Summary receipt.
//
// The composed last-day payload is published at the day seal, while BAF rows
// and permissionless Decimator claims can finish indexing independently. Keep
// this reconciliation pure so the receipt can use the freshest exact-day row
// and still recover BAF totals from its grouped breakdown when the legacy
// `bafPrize` aggregate is empty.

const ENTRIES_PER_TICKET = 4n;

function _big(value) {
  try { return BigInt(value ?? 0); } catch (_error) { return 0n; }
}

function _count(value) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? BigInt(count) : 1n;
}

function _rows(winner, awardType) {
  const wanted = String(awardType || '').toLowerCase();
  return (Array.isArray(winner?.breakdown) ? winner.breakdown : [])
    .filter((row) => String(row?.awardType || '').toLowerCase() === wanted);
}

function _groupedTotal(rows) {
  let total = 0n;
  for (const row of Array.isArray(rows) ? rows : []) {
    total += _big(row?.amount) * _count(row?.count);
  }
  return total;
}

function _winningTraits(winner, ...awardTypes) {
  const accepted = new Set(awardTypes.map((type) => String(type).toLowerCase()));
  const traits = new Set();
  for (const row of Array.isArray(winner?.breakdown) ? winner.breakdown : []) {
    if (!accepted.has(String(row?.awardType || '').toLowerCase())) continue;
    // Missing trait ids are center prizes. Number(null) is 0, so test the raw
    // field before converting or a center award becomes a fake pink XRP badge.
    const rawTraitId = row?.traitId;
    if (rawTraitId == null || String(rawTraitId).trim() === '') continue;
    const traitId = Number(rawTraitId);
    if (Number.isInteger(traitId) && traitId >= 0 && traitId <= 255) traits.add(traitId);
  }
  return [...traits];
}

function _firstLevel(rows, fallback = null) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const level = Number(row?.level);
    if (Number.isInteger(level) && level > 0) return level;
  }
  const level = Number(fallback);
  return Number.isInteger(level) && level > 0 ? level : null;
}

/**
 * Convert one exact-day winner row into reveal-overlay prize descriptors.
 * Grouped breakdown rows carry a per-award amount plus `count`, so their BAF
 * total must multiply those fields. The normal totalEth/ticketCount fields
 * deliberately exclude BAF and remain separate receipt cards.
 */
export function buildDaySummaryPrizes(winner) {
  if (!winner || typeof winner !== 'object') return [];

  const prizes = [];
  const regularEth = _big(winner.totalEth);
  if (regularEth > 0n) {
    prizes.push({
      type: 'eth',
      amount: regularEth,
      winningTraitIds: _winningTraits(winner, 'eth'),
    });
  }

  const bafEthRows = _rows(winner, 'eth_baf');
  const groupedBafEth = _groupedTotal(bafEthRows);
  const declaredBafEth = _big(winner?.bafPrize?.eth);
  // Prefer the breakdown whenever it exists: it is the same evidence used by
  // the winner tooltip and currently arrives before the aggregate on x10 days.
  const bafEth = bafEthRows.length > 0 ? groupedBafEth : declaredBafEth;
  if (bafEth > 0n) {
    prizes.push({
      type: 'baf',
      amount: bafEth,
      level: _firstLevel(bafEthRows, winner.winningLevel),
    });
  }

  const coin = _big(winner.coinTotal);
  if (coin > 0n) {
    prizes.push({
      type: 'flip',
      amount: coin,
      winningTraitIds: _winningTraits(winner, 'flip', 'flip_baf', 'farFutureCoin'),
    });
  }

  const decimator = winner.decimatorPrize || {};
  const decimatorRegular = _big(decimator.regularEth);
  const decimatorLootbox = _big(decimator.lootboxEth);
  const decimatorTerminal = _big(decimator.terminalEth);
  if (decimatorRegular > 0n || decimatorLootbox > 0n || decimatorTerminal > 0n) {
    prizes.push({
      type: 'decimator',
      amount: decimatorRegular + decimatorTerminal,
      lootboxAmount: decimatorLootbox,
      terminalAmount: decimatorTerminal,
    });
  }

  const wholeTickets = Math.round(Number(winner.ticketCount || 0) / Number(ENTRIES_PER_TICKET));
  if (wholeTickets > 0) {
    const ticketRows = _rows(winner, 'tickets');
    prizes.push({
      type: 'tickets',
      amount: wholeTickets,
      level: _firstLevel(ticketRows),
      winningTraitIds: _winningTraits(winner, 'tickets', 'ticket'),
    });
  }

  const bafTicketRows = _rows(winner, 'tickets_baf');
  const groupedBafEntries = _groupedTotal(bafTicketRows);
  const declaredBafEntries = _big(winner?.bafPrize?.tickets);
  const bafEntries = bafTicketRows.length > 0 ? groupedBafEntries : declaredBafEntries;
  const bafTickets = bafEntries / ENTRIES_PER_TICKET;
  if (bafTickets > 0n) {
    prizes.push({
      type: 'baf-tickets',
      amount: bafTickets,
      level: _firstLevel(bafTicketRows, winner.winningLevel),
    });
  }

  return prizes;
}

