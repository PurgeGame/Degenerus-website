// Shared mapping between contract quest types and the control that advances
// them. The quest panel publishes unfinished objectives once; compact markers
// elsewhere only consume this model, so every surface agrees about what is open.

export const QUEST_PRODUCTS_BY_TYPE = Object.freeze({
  1: Object.freeze(['purchase', 'lootbox']),
  2: Object.freeze(['coinflip']),
  3: Object.freeze(['affiliate']),
  4: Object.freeze(['foil']),
  5: Object.freeze(['decimator']),
  6: Object.freeze(['lootbox']),
  7: Object.freeze(['degenerette-eth']),
  8: Object.freeze(['degenerette-flip']),
  9: Object.freeze(['redeem-flip']),
});

export function questProductsForType(questType) {
  return QUEST_PRODUCTS_BY_TYPE[Number(questType)] || Object.freeze([]);
}

function _objectiveRows(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.quests) ? payload.quests : [];
}

function _asBigInt(value) {
  try { return BigInt(String(value ?? 0)); }
  catch (_error) { return null; }
}

function _completionReward(quest) {
  const role = String(quest?.role || '').toUpperCase();
  const fallbackFlip = role === 'LEVEL' ? 800 : 100;
  const fallbackStreak = role === 'LEVEL' ? 5 : 0;
  const flip = Number(quest?.flipReward ?? fallbackFlip);
  const streak = Number(quest?.streakReward ?? fallbackStreak);
  return {
    flip: Number.isFinite(flip) && flip > 0 ? Math.trunc(flip) : 0,
    streak: Number.isFinite(streak) && streak > 0 ? Math.trunc(streak) : 0,
  };
}

/** Compact tooltip/count model for an unfinished-quest marker. */
export function questObjectiveIndicatorModel(payload, product) {
  const wanted = String(product || '');
  if (!wanted) return null;
  const quests = _objectiveRows(payload).filter((quest) => (
    quest?.completed !== true
      && questProductsForType(quest?.questType).includes(wanted)
  ));
  if (quests.length === 0) return null;

  const descriptions = quests.map((quest) => {
    const role = String(quest?.role || '').trim();
    const label = String(quest?.label || 'Quest').trim();
    return role ? `${role}: ${label}` : label;
  });
  const lead = quests.length === 1 ? 'Unfinished quest' : `${quests.length} unfinished quests`;
  return {
    count: quests.length,
    title: `${lead} · ${descriptions.join(' · ')}`,
    quests,
  };
}

/**
 * Reward preview for an ordinary action dialog.
 *
 * The quest panel publishes its already-merged progress/target rows, so a
 * transaction surface only supplies the exact amount this action advances.
 * This keeps bounty shortcuts and native controls from reconstructing quest
 * state independently or promising a reward while a completion gate is shut.
 */
export function questCompletionBonusModel(payload, product, actionProgress) {
  const wanted = String(product || '');
  const delta = _asBigInt(actionProgress);
  if (!wanted || delta == null || delta <= 0n) return null;

  const matching = _objectiveRows(payload).filter((quest) => (
    quest?.completed !== true
      && quest?.progressAvailable !== false
      && questProductsForType(quest?.questType).includes(wanted)
  ));
  if (matching.length === 0) return null;

  const reachesTarget = (quest) => {
    const progress = _asBigInt(quest?.progress);
    const target = _asBigInt(quest?.target);
    return progress != null && target != null && target > 0n
      && progress < target && progress + delta >= target;
  };
  const candidates = matching.filter(reachesTarget);
  if (candidates.length === 0) return null;

  // A Luckbox can satisfy the MINT_ETH primary and the Luckbox bonus inside
  // the same contract call. No other locked bonus quest may bypass primary.
  const completesMintPrimary = candidates.some((quest) => (
    String(quest?.role || '').toUpperCase() === 'DAILY'
      && Number(quest?.questType) === 1
  ));
  const quests = candidates.filter((quest) => {
    const role = String(quest?.role || '').toUpperCase();
    if (role === 'LEVEL' && quest?.eligible === false) return false;
    if (role !== 'BONUS' || quest?.gated !== true) return true;
    return wanted === 'lootbox'
      && Number(quest?.questType) === 6
      && completesMintPrimary;
  });
  if (quests.length === 0) return null;

  const reward = quests.reduce((sum, quest) => {
    const item = _completionReward(quest);
    sum.flip += item.flip;
    sum.streak += item.streak;
    return sum;
  }, { flip: 0, streak: 0 });
  const rewardParts = [];
  if (reward.flip > 0) rewardParts.push(`+${reward.flip.toLocaleString('en-US')} FLIP`);
  if (reward.streak > 0) rewardParts.push(`+${reward.streak} STREAK`);
  if (rewardParts.length === 0) return null;

  const lead = quests.length === 1
    ? 'QUEST COMPLETION BONUS'
    : `${quests.length} QUEST COMPLETION BONUSES`;
  return {
    count: quests.length,
    flipReward: reward.flip,
    streakReward: reward.streak,
    message: `${lead} · ${rewardParts.join(' · ')}`,
    quests,
  };
}
