// play/app/tickets-inventory.js -- wallet-free trait decomposer for the /play/ route
//
// Re-implementation of the traitToBadge() decomposer from
// beta/viewer/badge-inventory.js lines 6-32. The beta file also renders a
// cumulative-counts grid using fetchJSON; we re-implement the pure
// decomposer locally to avoid pulling that coupling into play/ (keeps
// the SHELL-01 surface narrow). The CARD_IDX reshuffle is load-bearing
// (Phase 52 RESEARCH Pitfall 1): copying QUADRANTS/ITEMS without
// CARD_IDX silently corrupts the `cards` quadrant because the
// filesystem's fileIdx order does not match the contract's symbolIdx
// order. Verified against three independent beta sources:
//   - beta/app/constants.js:53
//   - beta/app/jackpot-rolls.js:26
//   - beta/viewer/badge-inventory.js:14
// All three use the array literal [3, 4, 5, 6, 0, 2, 1, 7]. Do NOT
// "fix" this -- the SVG files on disk reflect the legacy order.
//
// SHELL-01: zero imports. Pure module.
// Contract: DegenerusGameMintModule.sol lines 440-478 (trait bit layout).

// QUADRANTS[0]=crypto, [1]=zodiac, [2]=cards, [3]=dice
export const QUADRANTS = ['crypto', 'zodiac', 'cards', 'dice'];

export const COLORS = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];

export const ITEMS = {
  crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
  cards:  ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
  dice:   ['1', '2', '3', '4', '5', '6', '7', '8'],
};

// THE CARD_IDX RESHUFFLE (Pitfall 1 guard).
// For the `cards` quadrant ONLY, contract symbolIdx (0-7) maps to
// filesystem fileIdx via this array. Other quadrants map 1:1.
export const CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7];

export function badgePath(category, symbolIdx, colorIdx) {
  const fileIdx = category === 'cards' ? CARD_IDX[symbolIdx] : symbolIdx;
  const name = ITEMS[category][symbolIdx];
  const color = COLORS[colorIdx];
  return `/badges-circular/${category}_${String(fileIdx).padStart(2, '0')}_${name}_${color}.svg`;
}

// Decompose a contract traitId (0-255) into its display parts.
// Returns { category, item, itemIdx, colorIdx, color, path } or null if
// traitId is null/out-of-range (INTEG-01 response may include null
// traitIds for pending entries; caller renders a placeholder in that case).
export function traitToBadge(traitId) {
  if (traitId == null || typeof traitId !== 'number' || traitId < 0 || traitId > 255) return null;
  const quadrant = Math.floor(traitId / 64);       // 0-3
  const category = QUADRANTS[quadrant];
  const within = traitId % 64;
  const itemIdx = Math.floor(within / 8);          // 0-7 (symbolIdx on contract)
  const colorIdx = within % 8;                     // 0-7
  return {
    category,
    item: ITEMS[category][itemIdx],
    itemIdx,
    colorIdx,
    color: COLORS[colorIdx],
    path: badgePath(category, itemIdx, colorIdx),
  };
}
