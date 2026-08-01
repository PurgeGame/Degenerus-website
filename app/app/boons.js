// Compact product mapping for the player-facing active-boon indicators.
// The DB feed carries the contract boon type; this table deliberately uses the
// EFFECTIVE values. Whale/deity tier names 25/50 are historical tier labels,
// while the contract discounts for those tiers are 20%/35%.

const BOON_UI = Object.freeze({
  1:  { product: 'coinflip', label: 'BOON +5%', detail: 'Your next coinflip deposit gets +5%' },
  2:  { product: 'coinflip', label: 'BOON +10%', detail: 'Your next coinflip deposit gets +10%' },
  3:  { product: 'coinflip', label: 'BOON +25%', detail: 'Your next coinflip deposit gets +25%' },
  5:  { product: 'lootbox', label: 'BOON +5%', detail: 'Your next lootbox purchase gets +5% value' },
  6:  { product: 'lootbox', label: 'BOON +15%', detail: 'Your next lootbox purchase gets +15% value' },
  7:  { product: 'purchase', label: 'BOON +5%', detail: 'Your next ETH ticket purchase gets +5% entries' },
  8:  { product: 'purchase', label: 'BOON +15%', detail: 'Your next ETH ticket purchase gets +15% entries' },
  9:  { product: 'purchase', label: 'BOON +25%', detail: 'Your next ETH ticket purchase gets +25% entries' },
  13: { product: 'decimator', label: 'BOON +10%', detail: 'Your next Decimator burn gets +10%' },
  14: { product: 'decimator', label: 'BOON +25%', detail: 'Your next Decimator burn gets +25%' },
  15: { product: 'decimator', label: 'BOON +50%', detail: 'Your next Decimator burn gets +50%' },
  16: { product: 'whale', label: 'BOON −10%', detail: 'Your next whale pass purchase costs 10% less' },
  17: { product: 'activity', label: 'BOON +10 SCORE', detail: 'Your pending activity boon adds 10 Degen Score' },
  18: { product: 'activity', label: 'BOON +25 SCORE', detail: 'Your pending activity boon adds 25 Degen Score' },
  19: { product: 'activity', label: 'BOON +50 SCORE', detail: 'Your pending activity boon adds 50 Degen Score' },
  22: { product: 'lootbox', label: 'BOON +25%', detail: 'Your next lootbox purchase gets +25% value' },
  23: { product: 'whale', label: 'BOON −20%', detail: 'Your next whale pass purchase costs 20% less' },
  24: { product: 'whale', label: 'BOON −35%', detail: 'Your next whale pass purchase costs 35% less' },
  25: { product: 'deity', label: 'BOON −10%', detail: 'Your deity pass purchase costs 10% less' },
  26: { product: 'deity', label: 'BOON −20%', detail: 'Your deity pass purchase costs 20% less' },
  27: { product: 'deity', label: 'BOON −35%', detail: 'Your deity pass purchase costs 35% less' },
  28: { product: 'whale', label: 'BOON PASS', detail: 'Your whale pass boon is active' },
  29: { product: 'lazy', label: 'BOON −10%', detail: 'Your lazy pass purchase costs 10% less' },
  30: { product: 'lazy', label: 'BOON −25%', detail: 'Your lazy pass purchase costs 25% less' },
  31: { product: 'lazy', label: 'BOON −50%', detail: 'Your lazy pass purchase costs 50% less' },
});

function _boonRows(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.boons) ? payload.boons : [];
}

function _boonStrength(ui) {
  const amount = /[+\u2212-](\d+)/.exec(String(ui?.label || ''));
  return amount ? Number(amount[1]) : 0;
}

/** Return the strongest unconsumed boon that applies to one visible product. */
export function activeBoonForProduct(payload, product) {
  const wanted = String(product || '');
  return _boonRows(payload)
    .filter((row) => row?.consumed !== true && BOON_UI[Number(row?.boonType)]?.product === wanted)
    .map((row) => ({ row, ui: BOON_UI[Number(row.boonType)] }))
    .sort((a, b) => (
      _boonStrength(b.ui) - _boonStrength(a.ui)
      || Number(b.row.boonType) - Number(a.row.boonType)
    ))[0] || null;
}

/** Text/tooltip model shared by every <boon-product-indicator>. */
export function boonIndicatorModel(payload, product) {
  const active = activeBoonForProduct(payload, product);
  if (!active) return null;
  const day = Number(payload?.day);
  return {
    boonType: Number(active.row.boonType),
    label: active.ui.label,
    title: `${active.ui.detail}${Number.isInteger(day) && day > 0 ? ` · Day ${day}` : ''}`,
  };
}

export const _testing = { BOON_UI };
