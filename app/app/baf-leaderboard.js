import { CONTRACTS } from './chain-config.js';

export function isBafRankEligible(player) {
  const address = String(player ?? '').toLowerCase();
  return Boolean(address) && address !== String(CONTRACTS.VAULT ?? '').toLowerCase();
}

/** The API includes a fifth score; promote it when the vault occupies a slot. */
export function eligibleBafLeaders(payload, level, count = 4) {
  const rows = Array.isArray(payload) ? payload : payload?.entries;
  if (!Array.isArray(rows)) return [];
  const byRank = new Map();
  for (const row of rows) {
    const rank = Number(row?.rank);
    if (Number(row?.level) !== Number(level) || !Number.isInteger(rank) || rank < 1
      || !row?.player || byRank.has(rank)) continue;
    byRank.set(rank, row);
  }
  let excluded = 0;
  return [...byRank.entries()].sort(([a], [b]) => a - b).flatMap(([rank, row]) => {
    if (!isBafRankEligible(row.player)) {
      excluded += 1;
      return [];
    }
    const eligibleRank = rank - excluded;
    return eligibleRank <= count ? [{ ...row, rank: eligibleRank }] : [];
  });
}
