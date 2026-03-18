// app/baf.js -- BAF leaderboard business logic: DB API reads, context helpers, score formatting
// Components should import these functions rather than importing ethers or calling contracts directly.

import { get, batch } from './store.js';
import { fetchJSON } from './api.js';
import { formatEth } from './utils.js';

/**
 * Fetch BAF leaderboard for the given level and update store.
 * Non-critical: fails silently.
 * @param {number} level - Current game level
 */
export async function fetchBafLeaderboard(level) {
  if (!level || level <= 0) return;

  try {
    const data = await fetchJSON('/leaderboards/baf?level=' + level);

    // Expect array of { player, score, rank }
    const top4 = Array.isArray(data) ? data.slice(0, 4) : [];

    // Check if connected player is in the top 4
    const playerAddress = get('player.address');
    let playerScore = '0';
    if (playerAddress) {
      const entry = top4.find(e =>
        e.player && e.player.toLowerCase() === playerAddress.toLowerCase()
      );
      if (entry) {
        playerScore = entry.score || '0';
      }
    }

    const ctx = bafContext(level);

    batch([
      ['baf.top4', top4],
      ['baf.playerScore', playerScore],
      ['baf.prominence', ctx.prominence],
    ]);
  } catch {
    // Leaderboard fetch failed; non-critical, leave store unchanged
  }
}

/**
 * Get BAF context information for the given level.
 * Pure helper, no async.
 * @param {number} level - Current game level
 * @returns {{ nextBafLevel: number, levelsUntilBaf: number, isBafLevel: boolean, prominence: string }}
 */
export function bafContext(level) {
  const nextBafLevel = Math.ceil((level + 1) / 10) * 10;
  const levelsUntilBaf = nextBafLevel - level;
  const isBafLevel = level > 0 && level % 10 === 0;

  let prominence;
  if (levelsUntilBaf <= 3) {
    prominence = 'high';
  } else if (levelsUntilBaf <= 7) {
    prominence = 'medium';
  } else {
    prominence = 'low';
  }

  return { nextBafLevel, levelsUntilBaf, isBafLevel, prominence };
}

/**
 * Format BAF score for display.
 * BAF scores are ETH-denominated cumulative coinflip stakes.
 * @param {string} scoreStr - Score as wei string
 * @returns {string} Formatted score
 */
export function formatBafScore(scoreStr) {
  return formatEth(scoreStr);
}
