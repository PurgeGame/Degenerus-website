import { ETH_DIVISOR } from './chain-config.js';
import { lootboxCaseAssets } from './lootbox-value-tone.js';

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
  17: { product: 'activity', label: 'BOON +5 RATING', detail: 'Adds +10 quest streak, worth 5 Degen Rating' },
  18: { product: 'activity', label: 'BOON +12.5 RATING', detail: 'Adds +25 quest streak, worth 12.5 Degen Rating' },
  19: { product: 'activity', label: 'BOON +25 RATING', detail: 'Adds +50 quest streak, worth 25 Degen Rating' },
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
  32: { product: 'degenerette-eth', label: '4% BONUS ETH BET', detail: 'Adds 4% effective stake to up to 10 ETH of your next eligible Degenerette bet, split across its spins' },
  33: { product: 'degenerette-eth', label: '8% BONUS ETH BET', detail: 'Adds 8% effective stake to up to 10 ETH of your next eligible Degenerette bet, split across its spins' },
  34: { product: 'degenerette-eth', label: '12% BONUS ETH BET', detail: 'Adds 12% effective stake to up to 10 ETH of your next eligible Degenerette bet, split across its spins' },
  35: { product: 'degenerette-flip', label: '4% BONUS FLIP BET', detail: 'Adds 4% effective stake to up to 100,000 FLIP of your next eligible Degenerette bet, split across its spins' },
  36: { product: 'degenerette-flip', label: '8% BONUS FLIP BET', detail: 'Adds 8% effective stake to up to 100,000 FLIP of your next eligible Degenerette bet, split across its spins' },
  37: { product: 'degenerette-flip', label: '12% BONUS FLIP BET', detail: 'Adds 12% effective stake to up to 100,000 FLIP of your next eligible Degenerette bet, split across its spins' },
  38: { product: 'degenerette-wwxrp', label: '4% BONUS WWXRP BET', detail: 'Adds 4% effective stake to your next eligible WWXRP Degenerette bet, split across its spins (uncapped)' },
  39: { product: 'degenerette-wwxrp', label: '8% BONUS WWXRP BET', detail: 'Adds 8% effective stake to your next eligible WWXRP Degenerette bet, split across its spins (uncapped)' },
  40: { product: 'degenerette-wwxrp', label: '12% BONUS WWXRP BET', detail: 'Adds 12% effective stake to your next eligible WWXRP Degenerette bet, split across its spins (uncapped)' },
});

/* Reuse real site art where it exists. Most controls already name/show the
   affected product, so their marker is just the amount-colored arrow. Currency
   boons keep the exact ETH / FLIP / WWXRP badge players already recognize. */
export const BOON_PRODUCT_ICONS = Object.freeze({
  purchase: null,
  lootbox: lootboxCaseAssets('medium').iconFront
    || lootboxCaseAssets('medium').lockedFront,
  coinflip: '/whitepaper/flame-logo-split.svg',
  quests: '/app/assets/boons/boon-quest-micro.svg',
  decimator: '/app/assets/decimator-draw-mark.svg',
  whale: '/badges-circular/crypto_06_ethereum_green.svg',
  activity: null,
  deity: '/badges-circular/crypto_06_ethereum_green.svg',
  lazy: '/badges-circular/crypto_06_ethereum_green.svg',
  'degenerette-eth': '/badges-circular/crypto_06_ethereum_green.svg',
  'degenerette-flip': '/whitepaper/flame-logo-split.svg',
  'degenerette-wwxrp': '/shared/coinflip-face-red.svg',
});

export const BOON_PRODUCT_COLORS = Object.freeze({
  purchase: '#f5a623',
  lootbox: '#a78bfa',
  coinflip: '#fb7185',
  quests: '#34d399',
  decimator: '#22d3ee',
  whale: '#60a5fa',
  activity: '#818cf8',
  deity: '#fbbf24',
  lazy: '#facc15',
  'degenerette-eth': '#a855f7',
  'degenerette-flip': '#f59e0b',
  'degenerette-wwxrp': '#ef4444',
});

export const BOON_AMOUNT_COLORS = Object.freeze({
  low: '#60a5fa',
  mid: '#cbd5e1',
  high: '#facc15',
  special: '#93c5fd',
  utility: '#67e8f9',
});

const BOON_DISCOUNT_COLORS = Object.freeze({
  low: '#ef4444',
  mid: '#cbd5e1',
  high: '#facc15',
});

const BOON_DIRECTION_BY_PRODUCT = Object.freeze({
  whale: 'down',
  deity: 'down',
  lazy: 'down',
});

// Tier is relative to its own boon family. A +12% Degenerette boon and a +50%
// Decimator boon are both the strongest roll in their lane and therefore share
// the same high-tier amount treatment.
const BOON_TIER_BY_TYPE = Object.freeze({
  1: 1, 2: 2, 3: 3,
  4: 0,
  5: 1, 6: 2, 22: 3,
  7: 1, 8: 2, 9: 3,
  13: 1, 14: 2, 15: 3,
  16: 1, 23: 2, 24: 3,
  17: 1, 18: 2, 19: 3,
  25: 1, 26: 2, 27: 3,
  28: 0,
  29: 1, 30: 2, 31: 3,
  32: 1, 33: 2, 34: 3,
  35: 1, 36: 2, 37: 3,
  38: 1, 39: 2, 40: 3,
});

const BOON_STRENGTH_BY_TIER = Object.freeze({ 1: 'low', 2: 'mid', 3: 'high' });

// Effective boost values used by the contracts' amount-bearing purchase
// paths. Keep pass discounts out of this table: their historical boon names
// do not always match the live discount and passBoonDiscountBps() is the
// contract-identical source for those products.
const BOON_BOOST_BPS_BY_TYPE = Object.freeze({
  1: 500, 2: 1_000, 3: 2_500,
  5: 500, 6: 1_500, 22: 2_500,
  7: 500, 8: 1_500, 9: 2_500,
  13: 1_000, 14: 2_500, 15: 5_000,
  32: 400, 33: 800, 34: 1_200,
  35: 400, 36: 800, 37: 1_200,
  38: 400, 39: 800, 40: 1_200,
});

/** Product emblem plus a color/pip tier that can be shared by every surface. */
export function boonVisualForProduct(product, tier = 0, strength = null, direction = null) {
  const normalizedTier = [1, 2, 3].includes(Number(tier)) ? Number(tier) : 0;
  const normalizedStrength = strength
    || BOON_STRENGTH_BY_TIER[normalizedTier]
    || 'special';
  const normalizedDirection = direction || BOON_DIRECTION_BY_PRODUCT[product] || 'up';
  const amountColors = normalizedDirection === 'down'
    ? BOON_DISCOUNT_COLORS
    : BOON_AMOUNT_COLORS;
  return {
    product: String(product || 'unknown'),
    icon: BOON_PRODUCT_ICONS[product] || null,
    color: BOON_PRODUCT_COLORS[product] || '#facc15',
    tier: normalizedTier,
    strength: normalizedStrength,
    amountColor: amountColors[normalizedStrength] || BOON_AMOUNT_COLORS.special,
    direction: normalizedDirection,
    pips: normalizedTier > 0 ? '●'.repeat(normalizedTier) : '✦',
  };
}

/** Exact visual metadata for one on-chain boon type. */
export function boonTypeVisual(boonType) {
  const type = Number(boonType);
  const ui = BOON_UI[type];
  if (!ui) return boonVisualForProduct('unknown');
  const strength = type === 4 ? 'utility' : (type === 28 ? 'special' : null);
  const direction = type === 28 ? 'up' : null;
  return boonVisualForProduct(ui.product, BOON_TIER_BY_TYPE[type] || 0, strength, direction);
}

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

  // Three independent 24-bit Degenerette lanes finish slot1. Each lane packs
  // tier in bits 0-1, deity provenance in bit 2, and a masked award day in
  // bits 3-23. Lootbox boons live through award day + 2; deity boons only live
  // on their issue day. This mirrors _degeneretteLaneLive on-chain.
  const currentDayMasked = currentDay % (2 ** 21);
  for (let laneIndex = 0; laneIndex < 3; laneIndex += 1) {
    const lane = _packedBits(slot1, 184 + laneIndex * 24, MASK_24);
    const tier = lane & 0x3;
    const deity = (lane & 0x4) !== 0;
    const stampDay = Math.floor(lane / 8) & 0x1FFFFF;
    const active = tier > 0 && (deity
      ? stampDay === currentDayMasked
      : (stampDay === 0 || currentDayMasked <= stampDay + 2));
    addTier(tier > 0 ? 32 + laneIndex * 3 + tier - 1 : null, active);
  }

  return rows;
}

function _boonRows(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.boons) ? payload.boons : [];
}

function _boonStrength(ui) {
  const amount = /[+\u2212-]?(\d+(?:\.\d+)?)%?/.exec(String(ui?.label || ''));
  return amount ? Number(amount[1]) : 0;
}

/** Activity boons store raw quest streak; each streak is worth 0.5 Degen Rating. */
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

// Purchase discounts are encoded as boon types rather than carrying their BPS
// in the indexed payload. Keep this table beside the canonical boon mapping so
// every price surface uses the exact same contract tiers.
const PASS_DISCOUNT_BPS_BY_TYPE = Object.freeze({
  16: 1000, 23: 2000, 24: 3500,
  25: 1000, 26: 2000, 27: 3500,
  29: 1000, 30: 2500, 31: 5000,
});

/** Return the active Whale / Deity / Lazy cost reduction in basis points. */
export function passBoonDiscountBps(payload, product) {
  const active = activeBoonForProduct(payload, product);
  return PASS_DISCOUNT_BPS_BY_TYPE[Number(active?.row?.boonType)] || 0;
}

/** Effective basis-point boost for an amount-bearing purchase draft. */
export function boonBoostBps(payload, product) {
  const active = activeBoonForProduct(payload, product);
  return BOON_BOOST_BPS_BY_TYPE[Number(active?.row?.boonType)] || 0;
}

/** Exact integer delta applied to a wei/token amount by its active boon. */
export function boonBoostDelta(amount, payload, product) {
  let raw;
  try { raw = BigInt(amount ?? 0); } catch (_error) { return 0n; }
  if (raw <= 0n) return 0n;
  return (raw * BigInt(boonBoostBps(payload, product))) / 10_000n;
}

// Coinflip.sol consumes the boon against at most 100,000 FLIP of one manual
// deposit. Keep this product-specific: the raw deposit above the cap still
// enters the coinflip and carries full BAF draw weight; it simply earns no
// additional boon credit.
export const COINFLIP_BOON_MAX_BASE_WEI = 100_000n * (10n ** 18n);

export function coinflipBoonBoostDelta(amount, payload) {
  let raw;
  try { raw = BigInt(amount ?? 0); } catch (_error) { return 0n; }
  if (raw <= 0n) return 0n;
  const eligible = raw > COINFLIP_BOON_MAX_BASE_WEI
    ? COINFLIP_BOON_MAX_BASE_WEI
    : raw;
  return boonBoostDelta(eligible, payload, 'coinflip');
}

// Degenerette caps the total bet principal eligible for its virtual stake
// bonus. ETH is stored in the active deployment's raw scale; FLIP and WWXRP
// remain ordinary 18-decimal token amounts on every chain profile.
export const DEGENERETTE_BOON_ETH_MAX_BASE_RAW = (10n * (10n ** 18n)) / ETH_DIVISOR;
export const DEGENERETTE_BOON_FLIP_MAX_BASE_RAW = 100_000n * (10n ** 18n);

/**
 * Contract-identical total effective-stake delta for one Degenerette bet.
 * `amount` is the paid total across every spin. The contract floors the bonus
 * per spin, so multiply that per-spin result back out for an exact UI total.
 */
export function degeneretteBoonBoostDelta(amount, payload, currency, spinCount = 1) {
  let raw;
  let spins;
  try {
    raw = BigInt(amount ?? 0);
    spins = BigInt(spinCount ?? 1);
  } catch (_error) {
    return 0n;
  }
  if (raw <= 0n || spins <= 0n) return 0n;

  const lane = Number(currency);
  let product;
  let maxBase = null;
  if (lane === 0) {
    product = 'degenerette-eth';
    maxBase = DEGENERETTE_BOON_ETH_MAX_BASE_RAW;
  } else if (lane === 1) {
    product = 'degenerette-flip';
    maxBase = DEGENERETTE_BOON_FLIP_MAX_BASE_RAW;
  } else if (lane === 3) {
    product = 'degenerette-wwxrp';
  } else {
    return 0n;
  }

  const eligible = maxBase != null && raw > maxBase ? maxBase : raw;
  const totalBonus = boonBoostDelta(eligible, payload, product);
  return (totalBonus / spins) * spins;
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
    ...boonTypeVisual(active.row.boonType),
    boonType: Number(active.row.boonType),
    label: activityAmount > 0 ? `BOON +${_formatScore(activityScore)} RATING` : active.ui.label,
    title: `${activityAmount > 0
      ? `Adds +${activityAmount} quest streak, worth ${_formatScore(activityScore)} Degen Rating`
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
  activity: 'Degen rating',
  deity: 'Deity pass',
  lazy: 'Lazy pass',
  'degenerette-eth': 'Degenerette',
  'degenerette-flip': 'Degenerette',
  'degenerette-wwxrp': 'Degenerette',
});

function _issuanceEffect(ui, boonType) {
  const compact = String(ui?.label || '').replace(/^BOON\s*/i, '');
  if (Number(boonType) === 28) return 'WHALE BOON ACTIVE';
  if (ui?.product === 'quests') return '1 MISSED DAY SHIELDED';
  if (ui?.product === 'activity') return compact.replace(/RATING$/i, 'DEGEN RATING');
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
    case 'degenerette-eth': return `${pct} BONUS ETH BET`;
    case 'degenerette-flip': return `${pct} BONUS FLIP BET`;
    case 'degenerette-wwxrp': return `${pct} BONUS WWXRP BET`;
    default: return compact;
  }
}

/** Compact, effective-value copy for a deity holder's daily issuance slots. */
export function boonTypePresentation(boonType) {
  const ui = BOON_UI[Number(boonType)];
  if (!ui) {
    return {
      ...boonTypeVisual(boonType),
      name: 'Mystery boon',
      effect: '',
      detail: 'Daily deity boon',
    };
  }
  return {
    ...boonTypeVisual(boonType),
    name: Number(boonType) === 28 ? 'Whale pass' : (BOON_PRODUCT_NAMES[ui.product] || 'Boon'),
    effect: _issuanceEffect(ui, boonType),
    detail: ui.detail,
  };
}

export const _testing = { BOON_UI };
