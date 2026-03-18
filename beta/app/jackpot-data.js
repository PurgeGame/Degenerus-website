// app/jackpot-data.js -- Pure helper functions for jackpot display logic.
// No ethers import, no contract calls. Data transformation only.

import { BADGE_CATEGORIES, BADGE_COLORS, badgePath } from './constants.js';

/**
 * Derive 4 winning trait indices from a VRF RNG word.
 * Each quadrant gets 6 bits of the RNG word, producing a trait index in that quadrant's range.
 * Quadrant 0: 0-63, Quadrant 1: 64-127, Quadrant 2: 128-191, Quadrant 3: 192-255.
 *
 * @param {string|BigInt} rngWord - The VRF result word (BigInt-compatible)
 * @returns {Array<number|null>} Array of 4 trait indices, or [null,null,null,null] if unavailable
 */
export function deriveWinningTraits(rngWord) {
  if (!rngWord || rngWord === '0') return [null, null, null, null];
  const word = BigInt(rngWord);
  return [
    Number(word & 0x3Fn),
    Number(64n + ((word >> 6n) & 0x3Fn)),
    Number(128n + ((word >> 12n) & 0x3Fn)),
    Number(192n + ((word >> 18n) & 0x3Fn)),
  ];
}

/**
 * Map a trait index to its badge category, color, and SVG path.
 * category = traitIndex % 6 (indexes into BADGE_CATEGORIES)
 * color = Math.floor(traitIndex / 6) % 8 (indexes into BADGE_COLORS)
 *
 * @param {number|null} traitIndex - Trait index (0-255)
 * @returns {{ category: string, color: string, path: string } | null}
 */
export function traitToBadge(traitIndex) {
  if (traitIndex == null) return null;
  const catIdx = traitIndex % 6;
  const colIdx = Math.floor(traitIndex / 6) % 8;
  const category = BADGE_CATEGORIES[catIdx];
  const color = BADGE_COLORS[colIdx];
  return { category, color, path: badgePath(category, color) };
}

/**
 * Estimate the ETH allocation for today's jackpot draw.
 * Days 1-4: random 6-14% of remaining currentPrizePool (show range).
 * Day 5: 100% of remaining pool.
 *
 * @param {string} currentPoolWei - Current prize pool in wei as string
 * @param {number} jackpotDay - Day counter (1-5)
 * @returns {{ min: string, max: string, label: string }} Allocation estimate with wei strings
 */
export function estimateAllocation(currentPoolWei, jackpotDay) {
  if (!jackpotDay || jackpotDay < 1 || jackpotDay > 5 || !currentPoolWei || currentPoolWei === '0') {
    return { min: '0', max: '0', label: '--' };
  }

  const pool = BigInt(currentPoolWei);

  if (jackpotDay === 5) {
    return { min: pool.toString(), max: pool.toString(), label: '100%' };
  }

  // Days 1-4: 6-14% range
  const min = (pool * 6n) / 100n;
  const max = (pool * 14n) / 100n;
  return { min: min.toString(), max: max.toString(), label: '~6-14%' };
}

/**
 * Return a human-readable label for a quadrant index.
 *
 * @param {number} index - Quadrant index (0-3)
 * @returns {string} Quadrant label
 */
export function quadrantLabel(index) {
  return ['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right'][index] || '';
}
