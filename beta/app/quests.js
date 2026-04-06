// app/quests.js -- Quest business logic: progress formatting, streak display
// All quest data now comes from the API via fetchPlayerData() in api.js.
// Components should import these functions rather than calling contracts directly.

import { get } from './store.js';
import { QUEST_TYPE_LABELS } from './constants.js';
import { formatEth, formatBurnie } from './utils.js';

// -- Pure Helpers --

/**
 * Format the target description for a quest based on its type and requirements.
 * @param {number} questType - Quest type enum value (0-8)
 * @param {{ mints: number, tokenAmount: bigint }} requirements - Quest requirements
 * @returns {string} Human-readable target description
 */
export function formatQuestTarget(questType, requirements) {
  switch (questType) {
    case 0: // MINT_BURNIE
    case 1: // MINT_ETH
      return `${requirements.mints} ticket${requirements.mints !== 1 ? 's' : ''}`;
    case 2: // FLIP
    case 3: // AFFILIATE
    case 5: // DECIMATOR
      return formatBurnie(requirements.tokenAmount.toString()) + ' BURNIE';
    case 6: // LOOTBOX
      return formatEth(requirements.tokenAmount.toString()) + ' ETH';
    case 7: // DEGENERETTE_ETH
      return formatEth(requirements.tokenAmount.toString()) + ' ETH wagered';
    case 8: // DEGENERETTE_BURNIE
      return formatBurnie(requirements.tokenAmount.toString()) + ' BURNIE wagered';
    default:
      return 'Unknown';
  }
}

/**
 * Get quest progress info for a given slot index.
 * @param {number} slotIndex - 0 or 1
 * @returns {{ type: string, target: string, progress: number, completed: boolean, highDifficulty: boolean } | null}
 */
export function getQuestProgress(slotIndex) {
  const slot = get(`quest.slots`)?.[slotIndex];
  const progress = get(`quest.progress`)?.[slotIndex] ?? 0;
  const completed = get(`quest.completed`)?.[slotIndex] ?? false;

  if (!slot) return null;

  // Calculate percentage based on quest type
  let pct;
  if (slot.questType === 0 || slot.questType === 1) {
    // Mint quests: progress is count of mints
    pct = slot.requirements.mints > 0
      ? (progress / slot.requirements.mints) * 100
      : 0;
  } else {
    // Token quests: progress is token amount
    const target = Number(slot.requirements.tokenAmount);
    pct = target > 0 ? (progress / target) * 100 : 0;
  }

  pct = Math.min(pct, 100);

  return {
    type: QUEST_TYPE_LABELS[slot.questType] || 'Unknown',
    target: formatQuestTarget(slot.questType, slot.requirements),
    progress: pct,
    completed,
    highDifficulty: slot.highDifficulty,
  };
}
