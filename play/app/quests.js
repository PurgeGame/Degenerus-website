// play/app/quests.js -- wallet-free quest helpers for the /play/ route
//
// Re-implementation of beta/app/quests.js that avoids the ethers-tainted
// path (beta/app/quests.js imports from ./utils.js which imports ethers
// at line 3). SHELL-01 guardrail (play/app/__tests__/play-shell-01.test.js)
// forbids that import chain in the play/ tree.
//
// Differences from beta/app/quests.js:
//  - Imports formatEth / formatBurnie from the wallet-free mirror at
//    beta/viewer/utils.js (same wei-string contract as beta/app/utils.js
//    but without the ethers bare-specifier taint).
//  - Fixes the quest-type enum bug: contract uses 9 for MINT_BURNIE;
//    0 is the null sentinel ("no quest rolled") per
//    /home/zak/Dev/PurgeGame/degenerus-audit/contracts/DegenerusQuests.sol
//    lines 173-175. beta/app/constants.js:155-165 and beta/app/quests.js:19
//    both map 0 -> MINT_BURNIE, which is wrong on-chain. This module
//    ships the correct mapping locally rather than fixing beta/ (left
//    for a later cleanup pass).
//  - getQuestProgress takes a quest ROW object directly from the API
//    response instead of a slotIndex store read. The /play/ panel
//    fetches fresh on every (player, day) change and renders from the
//    result synchronously; no reactive store read is needed at render
//    time.

import { formatEth, formatBurnie } from '../../beta/viewer/utils.js';

// Quest-type labels (contract values per DegenerusQuests.sol:149-178).
// Key is the on-chain questType integer; value is the display label.
// 0 is intentionally omitted -- it is the null sentinel meaning
// "no quest rolled"; panels should not render a slot with questType=0.
// 4 is RESERVED in the contract and is never rolled.
export const QUEST_TYPE_LABELS = {
  1: 'Mint ETH Tickets',
  2: 'Coinflip',
  3: 'Affiliate Earnings',
  5: 'Decimator Burns',
  6: 'Lootbox',
  7: 'Degenerette (ETH)',
  8: 'Degenerette (BURNIE)',
  9: 'Mint BURNIE Tickets',
};

// Render a human-readable target string for a quest row's requirements.
// questType: integer on-chain quest type (1, 2, 3, 5, 6, 7, 8, or 9)
// requirements: { mints: number, tokenAmount: string }
//   mints         -- for MINT_ETH (1) and MINT_BURNIE (9) quests
//   tokenAmount   -- wei-string for the amount-denominated quests
// Returns a display string ('4 tickets', '10.00 ETH', '1500 BURNIE', etc.)
// Unknown types return 'Unknown' -- caller may suppress or show as-is.
export function formatQuestTarget(questType, requirements) {
  switch (questType) {
    case 1:  // MINT_ETH
    case 9:  // MINT_BURNIE (contract uses 9; NOT 0 per DegenerusQuests.sol:173-175)
      return `${requirements.mints} ticket${requirements.mints !== 1 ? 's' : ''}`;
    case 2:  // FLIP
    case 3:  // AFFILIATE
    case 5:  // DECIMATOR
      return formatBurnie(requirements.tokenAmount) + ' BURNIE';
    case 6:  // LOOTBOX
      return formatEth(requirements.tokenAmount) + ' ETH';
    case 7:  // DEGENERETTE_ETH
      return formatEth(requirements.tokenAmount) + ' ETH wagered';
    case 8:  // DEGENERETTE_BURNIE
      return formatBurnie(requirements.tokenAmount) + ' BURNIE wagered';
    default:
      return 'Unknown';
  }
}

// Normalize a quest row from the /player/:address?day=N endpoint into
// the render-ready shape used by the panel.
// questRow: one element of the API response `quests[]` array:
//   { day, slot, questType, progress, target, completed,
//     requirementMints, requirementTokenAmount, highDifficulty }
// Returns { type, target, progress, completed } or null if questRow is falsy.
// The panel ignores highDifficulty entirely per Phase 51 D-20 (flag is a
// schema-only vestige; DegenerusQuests.sol:1090 hardcodes it false).
export function getQuestProgress(questRow) {
  if (!questRow) return null;
  const qt = questRow.questType;
  const isMint = qt === 1 || qt === 9;
  const targetNum = isMint
    ? Number(questRow.requirementMints)
    : Number(BigInt(questRow.requirementTokenAmount || '0'));
  const progressNum = isMint
    ? Number(questRow.progress || '0')
    : Number(BigInt(questRow.progress || '0'));
  const pct = targetNum > 0 ? Math.min((progressNum / targetNum) * 100, 100) : 0;
  return {
    type: QUEST_TYPE_LABELS[qt] || 'Unknown',
    target: formatQuestTarget(qt, {
      mints: Number(questRow.requirementMints),
      tokenAmount: questRow.requirementTokenAmount || '0',
    }),
    progress: pct,
    completed: Boolean(questRow.completed),
  };
}
