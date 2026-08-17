// The FLIP wager-presentation ladder for the baked /shared/flip-chips/ pile
// art. Pure module: the coinflip felt (app-daily-flip) and the reveal overlay
// both size physical chip piles from it, and they cannot import each other
// without a cycle. Levels map 1:1 onto pile-1.svg … pile-20.svg.

const FLIP_WEI_UNIT = 10n ** 18n;

/**
 * Ladder level (1-20) for a FLIP amount in wei; 0 below pile scale. Twenty
 * baked pile graphics from 50K FLIP up, spaced by x1.45 so any win (>=x1.5
 * payout) always lands on a strictly bigger pile.
 */
export function flipPileLevel(amountWei) {
  let flip;
  try { flip = Number(BigInt(amountWei ?? 0) / FLIP_WEI_UNIT); }
  catch (_error) { return 0; }
  if (flip < 50_000) return 0;
  return Math.max(1, Math.min(20, Math.floor(Math.log(flip / 50_000) / Math.log(1.45)) + 1));
}

/** The baked pile art for a ladder level. */
export function flipPileArt(level) {
  return `/shared/flip-chips/pile-${level}.svg`;
}
