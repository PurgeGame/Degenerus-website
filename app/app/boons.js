// Compact product mapping for the player-facing active-boon indicators.
// The DB feed carries the contract boon type; this table deliberately uses the
// EFFECTIVE values. Whale/deity tier names 25/50 are historical tier labels,
// while the contract discounts for those tiers are 20%/35%.

const BOON_UI = Object.freeze({
  1:  { product: 'coinflip', label: 'BOON +5%', detail: 'Your next coinflip deposit gets 5% bonus FLIP' },
  2:  { product: 'coinflip', label: 'BOON +10%', detail: 'Your next coinflip deposit gets 10% bonus FLIP' },
  3:  { product: 'coinflip', label: 'BOON +25%', detail: 'Your next coinflip deposit gets 25% bonus FLIP' },
  4:  { product: 'quests', label: 'BOON SHIELD', detail: "Protects today's quest streak" },
  5:  { product: 'lootbox', label: 'BOON +5%', detail: 'Your next luckbox purchase gets +5% value' },
  6:  { product: 'lootbox', label: 'BOON +15%', detail: 'Your next luckbox purchase gets +15% value' },
  7:  { product: 'purchase', label: 'BOON +5%', detail: 'Your next ETH ticket purchase gets +5% entries' },
  8:  { product: 'purchase', label: 'BOON +15%', detail: 'Your next ETH ticket purchase gets +15% entries' },
  9:  { product: 'purchase', label: 'BOON +25%', detail: 'Your next ETH ticket purchase gets +25% entries' },
  13: { product: 'decimator', label: 'BOON +10%', detail: 'Your next Decimator burn gets +10%' },
  14: { product: 'decimator', label: 'BOON +25%', detail: 'Your next Decimator burn gets +25%' },
  15: { product: 'decimator', label: 'BOON +50%', detail: 'Your next Decimator burn gets +50%' },
  16: { product: 'whale', label: 'BOON −10%', detail: 'Your next whale pass purchase costs 10% less' },
  17: { product: 'activity', label: 'BOON +5 SCORE', detail: 'Adds +10 quest streak, worth 5 Degen Score' },
  18: { product: 'activity', label: 'BOON +12.5 SCORE', detail: 'Adds +25 quest streak, worth 12.5 Degen Score' },
  19: { product: 'activity', label: 'BOON +25 SCORE', detail: 'Adds +50 quest streak, worth 25 Degen Score' },
  22: { product: 'lootbox', label: 'BOON +25%', detail: 'Your next luckbox purchase gets +25% value' },
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

const MASK_24 = (1n << 24n) - 1n;
const MASK_8 = 0xFFn;

function _packedBits(word, shift, mask) {
  return Number((word >> BigInt(shift)) & mask);
}

function _tierType(tier, types) {
  return Number.isInteger(tier) && tier > 0 && tier <= types.length
    ? types[tier - 1]
    : null;
}

function _isActiveDay({ tier, stampDay, deityDay, currentDay, expiresAfter = null }) {
  if (!tier) return false;
  if (deityDay > 0) return deityDay === currentDay;
  if (expiresAfter == null || stampDay === 0) return true;
  return currentDay <= stampDay + expiresAfter;
}

/**
 * Decode the GAME's public boonPacked(player) getter into the consumable boons
 * that are active right now. This is the authority for product highlighting:
 * the indexed /boons route only contains deity-issued history and therefore
 * cannot see lootbox-awarded boons or pass discounts consumed without a
 * BoonConsumed event.
 */
export function decodePackedBoons(slot0Raw, slot1Raw, currentDayRaw) {
  let slot0;
  let slot1;
  let currentDay;
  try {
    slot0 = BigInt(slot0Raw ?? 0);
    slot1 = BigInt(slot1Raw ?? 0);
    currentDay = Number(BigInt(currentDayRaw ?? 0));
  } catch (_e) {
    return [];
  }
  if (!Number.isInteger(currentDay) || currentDay < 1) return [];

  const rows = [];
  const addTier = (boonType, active) => {
    if (boonType != null && active) {
      rows.push({ boonType, consumed: false, source: 'chain' });
    }
  };

  const coinflipTier = _packedBits(slot0, 48, MASK_8);
  addTier(_tierType(coinflipTier, [1, 2, 3]), _isActiveDay({
    tier: coinflipTier,
    stampDay: _packedBits(slot0, 0, MASK_24),
    deityDay: _packedBits(slot0, 24, MASK_24),
    currentDay,
    expiresAfter: 2,
  }));

  const lootboxTier = _packedBits(slot0, 104, MASK_8);
  addTier(_tierType(lootboxTier, [5, 6, 22]), _isActiveDay({
    tier: lootboxTier,
    stampDay: _packedBits(slot0, 56, MASK_24),
    deityDay: _packedBits(slot0, 80, MASK_24),
    currentDay,
    expiresAfter: 2,
  }));

  const purchaseTier = _packedBits(slot0, 160, MASK_8);
  addTier(_tierType(purchaseTier, [7, 8, 9]), _isActiveDay({
    tier: purchaseTier,
    stampDay: _packedBits(slot0, 112, MASK_24),
    deityDay: _packedBits(slot0, 136, MASK_24),
    currentDay,
    expiresAfter: 4,
  }));

  const decimatorTier = _packedBits(slot0, 168, MASK_8);
  addTier(_tierType(decimatorTier, [13, 14, 15]), _isActiveDay({
    tier: decimatorTier,
    stampDay: 0,
    deityDay: _packedBits(slot0, 176, MASK_24),
    currentDay,
  }));

  const whaleTier = _packedBits(slot0, 248, MASK_8);
  addTier(_tierType(whaleTier, [16, 23, 24]), _isActiveDay({
    tier: whaleTier,
    stampDay: _packedBits(slot0, 200, MASK_24),
    deityDay: _packedBits(slot0, 224, MASK_24),
    currentDay,
    expiresAfter: 4,
  }));

  const activityPending = _packedBits(slot1, 0, MASK_24);
  if (_isActiveDay({
    tier: activityPending,
    stampDay: _packedBits(slot1, 24, MASK_24),
    deityDay: _packedBits(slot1, 48, MASK_24),
    currentDay,
    expiresAfter: 2,
  })) {
    const boonType = activityPending >= 50 ? 19 : (activityPending >= 25 ? 18 : 17);
    rows.push({ boonType, consumed: false, source: 'chain', boostAmount: activityPending });
  }

  const deityPassTier = _packedBits(slot1, 72, MASK_8);
  addTier(_tierType(deityPassTier, [25, 26, 27]), _isActiveDay({
    tier: deityPassTier,
    stampDay: _packedBits(slot1, 80, MASK_24),
    deityDay: _packedBits(slot1, 104, MASK_24),
    currentDay,
    expiresAfter: 4,
  }));

  const lazyTier = _packedBits(slot1, 176, MASK_8);
  addTier(_tierType(lazyTier, [29, 30, 31]), _isActiveDay({
    tier: lazyTier,
    stampDay: _packedBits(slot1, 128, MASK_24),
    deityDay: _packedBits(slot1, 152, MASK_24),
    currentDay,
    expiresAfter: 4,
  }));

  return rows;
}

function _boonRows(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.boons) ? payload.boons : [];
}

function _boonStrength(ui) {
  const amount = /[+\u2212-](\d+)/.exec(String(ui?.label || ''));
  return amount ? Number(amount[1]) : 0;
}

/** Activity boons store raw quest streak; each streak is worth 0.5 Degen Score. */
export function activityBoonScore(rawStreak) {
  const streak = Number(rawStreak);
  return Number.isFinite(streak) && streak > 0 ? streak / 2 : 0;
}

function _formatScore(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
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
  const activityAmount = active.ui.product === 'activity'
    ? Number(active.row?.boostAmount ?? 0)
    : 0;
  const activityScore = activityBoonScore(activityAmount);
  return {
    boonType: Number(active.row.boonType),
    label: activityAmount > 0 ? `BOON +${_formatScore(activityScore)} SCORE` : active.ui.label,
    title: `${activityAmount > 0
      ? `Adds +${activityAmount} quest streak, worth ${_formatScore(activityScore)} Degen Score`
      : active.ui.detail}${Number.isInteger(day) && day > 0 ? ` · Day ${day}` : ''}`,
  };
}

const BOON_PRODUCT_NAMES = Object.freeze({
  coinflip: 'Coinflip',
  quests: 'Quest',
  lootbox: 'Luckbox',
  purchase: 'Tickets',
  decimator: 'Decimator',
  whale: 'Whale',
  activity: 'Degen score',
  deity: 'Deity pass',
  lazy: 'Lazy pass',
});

function _issuanceEffect(ui, boonType) {
  const compact = String(ui?.label || '').replace(/^BOON\s*/i, '');
  if (Number(boonType) === 28) return 'WHALE BOON ACTIVE';
  if (ui?.product === 'quests') return '1 MISSED DAY SHIELDED';
  if (ui?.product === 'activity') return compact.replace(/SCORE$/i, 'DEGEN SCORE');
  const amount = /([+−-]?\d+(?:\.\d+)?)%/.exec(compact)?.[1];
  if (!amount) return compact;
  const pct = `${amount.replace(/^\+/, '')}%`;
  switch (ui.product) {
    case 'coinflip': return `${pct} BONUS FLIP`;
    case 'lootbox': return `${pct} BIGGER LUCKBOX`;
    case 'purchase': return `${pct} MORE TICKETS`;
    case 'decimator': return `${pct} MORE ENTRY WEIGHT`;
    case 'whale': return `${pct.replace(/^−/, '')} OFF WHALE PASS`;
    case 'deity': return `${pct.replace(/^−/, '')} OFF DEITY PASS`;
    case 'lazy': return `${pct.replace(/^−/, '')} OFF LAZY PASS`;
    default: return compact;
  }
}

/** Compact, effective-value copy for a deity holder's daily issuance slots. */
export function boonTypePresentation(boonType) {
  const ui = BOON_UI[Number(boonType)];
  if (!ui) {
    return { product: 'unknown', name: 'Mystery boon', effect: '', detail: 'Daily deity boon' };
  }
  return {
    product: ui.product,
    name: Number(boonType) === 28 ? 'Whale pass' : (BOON_PRODUCT_NAMES[ui.product] || 'Boon'),
    effect: _issuanceEffect(ui, boonType),
    detail: ui.detail,
  };
}

export const _testing = { BOON_UI };
