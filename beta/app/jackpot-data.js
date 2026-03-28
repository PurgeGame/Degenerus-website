// app/jackpot-data.js -- Pure helper functions for jackpot display logic.
// No ethers import, no contract calls. Data transformation only.

import { BADGE_QUADRANTS, BADGE_COLORS, BADGE_ITEMS, badgePath } from './constants.js';

/**
 * Derive 4 winning trait indices from a VRF RNG word.
 * Each quadrant gets 6 bits of the RNG word, producing a trait index in that quadrant's range.
 * Quadrant 0: 0-63, Quadrant 1: 64-127, Quadrant 2: 128-191, Quadrant 3: 192-255.
 *
 * NOTE: This gives the RANDOM traits. The contract may use burn-weighted selection instead.
 * For accurate replay, use the traitId from JackpotTicketWinner events when available.
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
 * Map a trait index (0-255) to its badge category, item name, color, and SVG path.
 *
 * Layout: 4 quadrants × 8 items × 8 colors = 256 traits.
 *   Quadrant 0 (0-63): cards, Quadrant 1 (64-127): crypto,
 *   Quadrant 2 (128-191): dice, Quadrant 3 (192-255): zodiac.
 * Within each quadrant: item = floor((trait % 64) / 8), color = trait % 8.
 *
 * @param {number|null} traitIndex - Trait index (0-255)
 * @returns {{ category: string, item: string, color: string, path: string, label: string } | null}
 */
export function traitToBadge(traitIndex) {
  if (traitIndex == null) return null;
  const quadrant = Math.floor(traitIndex / 64);
  const category = BADGE_QUADRANTS[quadrant] || 'cards';
  const withinQuadrant = traitIndex % 64;
  const itemIdx = Math.floor(withinQuadrant / 8);
  const colorIdx = withinQuadrant % 8;
  const color = BADGE_COLORS[colorIdx] || 'blue';
  const items = BADGE_ITEMS[category] || [];
  const item = items[itemIdx] || String(itemIdx);
  return {
    category,
    item,
    color,
    path: badgePath(category, itemIdx, colorIdx),
    label: `${item} ${color}`,
  };
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

/**
 * Map contract quadrant order [Q0, Q1, Q2, Q3] to display positions.
 * Contract: Q0=cards, Q1=crypto, Q2=dice, Q3=zodiac.
 * Whitepaper ticket layout: TL=crypto(Q1), TR=zodiac(Q3), BL=cards(Q0), BR=dice(Q2).
 * Returns indices into the contract array for display order [TL, TR, BL, BR].
 */
export const DISPLAY_ORDER = [0, 1, 2, 3]; // TL=Q0(crypto), TR=Q1(zodiac), BL=Q2(cards), BR=Q3(dice)

/**
 * Reorder contract-order traits [Q0,Q1,Q2,Q3] into display order [TL,TR,BL,BR].
 * @param {Array} contractOrder - 4 traits in contract quadrant order
 * @returns {Array} 4 traits in display position order
 */
export function toDisplayOrder(contractOrder) {
  return DISPLAY_ORDER.map(i => contractOrder[i]);
}
