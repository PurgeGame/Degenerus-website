// app/quests.js -- Quest business logic: contract reads, progress formatting, streak display
// Components should import these functions rather than importing ethers or calling contracts directly.

import { ethers } from 'ethers';
import { getReadProvider } from './contracts.js';
import { get, batch } from './store.js';
import { CONTRACTS, QUEST_ABI, QUEST_TYPE_LABELS } from './constants.js';
import { formatEth, formatBurnie } from './utils.js';

// -- Read Functions (use getReadProvider, work before wallet) --

/**
 * Fetch player quest state from contract and update store.
 * @param {string} address - Player wallet address
 */
export async function fetchQuestState(address) {
  if (!address) return;

  try {
    const contract = new ethers.Contract(CONTRACTS.QUESTS, QUEST_ABI, getReadProvider());
    const view = await contract.getPlayerQuestView(address);

    // Parse the PlayerQuestView struct
    const slots = view.quests.map((q) => {
      // Treat zero day + zero questType as no quest assigned
      if (Number(q.day) === 0 && Number(q.questType) === 0) return null;
      return {
        day: Number(q.day),
        questType: Number(q.questType),
        highDifficulty: q.highDifficulty,
        requirements: {
          mints: Number(q.requirements.mints),
          tokenAmount: q.requirements.tokenAmount,
        },
      };
    });

    batch([
      ['quest.slots', slots],
      ['quest.progress', [Number(view.progress[0]), Number(view.progress[1])]],
      ['quest.completed', [view.completed[0], view.completed[1]]],
      ['quest.baseStreak', Number(view.baseStreak)],
      ['quest.lastCompletedDay', Number(view.lastCompletedDay)],
    ]);
  } catch (err) {
    console.error('[quests] Failed to fetch quest state:', err);
  }
}

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
