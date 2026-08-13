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
