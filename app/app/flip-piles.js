// The FLIP wager-presentation ladder for the baked /shared/flip-chips/ pile
// art. Pure module: the coinflip felt (app-daily-flip) and the reveal overlay
// both size physical chip piles from it, and they cannot import each other
// without a cycle. Levels map 1:1 onto pile-1.svg … pile-20.svg.

const FLIP_WEI_UNIT = 10n ** 18n;

/**
 * Ladder level (5-20) for a FLIP amount in wei; 0 below pile scale. Most real
 * wagers live between 1K and 50K FLIP, so that whole band stays readable as
 * increasingly tall and numerous dealer stacks. Level 5 opens the loose
 * mound ladder at 100K. Its x1.45 rungs keep the large-wager progression
 * legible without flooding the felt. Rungs 1-4 remain unserved because their
 * shallow scatters read as less money than the tidy stacks they would replace.
 */
const FIRST_PILE_LEVEL = 5;
const FIRST_PILE_FLIP = 100_000;
const PILE_GROWTH = 1.45;

export function flipPileLevel(amountWei) {
  let flip;
  try { flip = Number(BigInt(amountWei ?? 0) / FLIP_WEI_UNIT); }
  catch (_error) { return 0; }
  if (!(flip >= FIRST_PILE_FLIP)) return 0;
  const level = Math.floor(Math.log(flip / FIRST_PILE_FLIP) / Math.log(PILE_GROWTH))
    + FIRST_PILE_LEVEL;
  return Math.min(20, level);
}

/**
 * One-piece art for the Add Bet amount preview. Below mound scale, roughly
 * three stack changes per decade keep the common 1K–50K range growing all the
 * way across the control instead of capping early. At 100K this joins the
 * exact pile ladder used by the felt and reward reveals.
 */
export function flipWagerPreview(amountWei) {
  const pile = flipPileLevel(amountWei);
  if (pile > 0) {
    return { kind: 'pile', count: pile, art: flipPileArt(pile, 'c') };
  }
  let flip;
  try { flip = Number(BigInt(amountWei ?? 0) / FLIP_WEI_UNIT); }
  catch (_error) { flip = 0; }
  const stack = Math.max(1, Math.min(
    10,
    1 + Math.round(Math.max(0, Math.log10(Math.max(1, flip) / 100)) * 3),
  ));
  return {
    kind: stack === 1 ? 'coin' : 'stack',
    count: stack,
    art: stack === 1
      ? '/shared/flip-chips/coin.svg'
      : `/shared/flip-chips/stack-${stack}.svg`,
  };
}

// Interchangeable compositions baked per rung. Same size, different pile.
const PILE_VARIANTS = ['a', 'b', 'c'];

// Physical chip counts in the baked pile art, keyed by ladder level and
// variant. Coinflip payouts no longer count against these: the dealer pays a
// bounded rank of clean stacks, not a coin-for-coin match of a 180-coin
// sprawl. The table remains the integrity check on the shipped art, and the
// honest source for any surface that needs to know what a mound actually holds.
//
// Keep this table in sync with pile-N[-b|-c].svg when build-piles.py is run.
// Each value is the number of rendered `<use href="#c...">` coin instances.
const PILE_CHIP_COUNTS = Object.freeze({
  5: Object.freeze({ a: 37, b: 37, c: 37 }),
  6: Object.freeze({ a: 46, b: 42, c: 46 }),
  7: Object.freeze({ a: 50, b: 52, c: 52 }),
  8: Object.freeze({ a: 56, b: 57, c: 59 }),
  9: Object.freeze({ a: 90, b: 80, c: 82 }),
  10: Object.freeze({ a: 103, b: 93, c: 105 }),
  11: Object.freeze({ a: 97, b: 93, c: 95 }),
  12: Object.freeze({ a: 98, b: 100, c: 115 }),
  13: Object.freeze({ a: 126, b: 164, c: 168 }),
  14: Object.freeze({ a: 141, b: 179, c: 152 }),
  15: Object.freeze({ a: 150, b: 150, c: 158 }),
  16: Object.freeze({ a: 150, b: 151, c: 144 }),
  17: Object.freeze({ a: 142, b: 149, c: 153 }),
  18: Object.freeze({ a: 148, b: 156, c: 144 }),
  19: Object.freeze({ a: 148, b: 153, c: 149 }),
  20: Object.freeze({ a: 180, b: 169, c: 176 }),
});

/**
 * Which of a rung's compositions this wager shows. Keyed off the stake, so a
 * bet keeps ONE pile all day and its payout arithmetic can count that exact
 * composition, while two players at the same rung do not stare at twins.
 */
export function flipPileVariant(amountWei) {
  let wei;
  try { wei = BigInt(amountWei ?? 0); }
  catch (_error) { return PILE_VARIANTS[0]; }
  if (wei < 0n) wei = -wei;
  return PILE_VARIANTS[Number(wei % BigInt(PILE_VARIANTS.length))];
}

/** Number of physical chips visible in this wager's exact baked pile. */
export function flipPileChipCount(amountWei) {
  const level = flipPileLevel(amountWei);
  if (level === 0) return 0;
  return PILE_CHIP_COUNTS[level]?.[flipPileVariant(amountWei)] ?? 0;
}

/** The baked pile art for a ladder level and composition. */
export function flipPileArt(level, variant = PILE_VARIANTS[0]) {
  const suffix = variant === PILE_VARIANTS[0] ? '' : `-${variant}`;
  return `/shared/flip-chips/pile-${level}${suffix}.svg`;
}
