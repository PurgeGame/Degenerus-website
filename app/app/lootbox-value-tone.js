// Stable lootbox-size palette. Box value is measured against the ticket price
// routed at purchase time, so ETH price changes do not make equal-value boxes
// look unrelated. Legacy/indexed rows fall back to the live routed price.

import {
  BOX_ORDER_MEDIUM_MULTIPLE,
  scaledTicketPriceWei,
} from './lootbox.js';
import { currentPurchaseTicketLevel } from './ticket-level-tone.js';

function _positiveBigInt(value) {
  try {
    const parsed = BigInt(value ?? 0);
    return parsed > 0n ? parsed : null;
  } catch (_e) {
    return null;
  }
}

export function currentLootboxTicketPriceWei() {
  const level = currentPurchaseTicketLevel();
  if (level == null) return null;
  try { return _positiveBigInt(scaledTicketPriceWei(level)); }
  catch (_e) { return null; }
}

export function lootboxTicketPriceForLevel(level) {
  const parsed = Number(level);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  try { return _positiveBigInt(scaledTicketPriceWei(parsed)); }
  catch (_e) { return null; }
}

function _unitsLabel(amount, price) {
  // Two decimal places are enough to distinguish entry-sized boxes while
  // keeping the diagnostic title compact. Round half-up without Number loss.
  const hundredths = (amount * 100n + price / 2n) / price;
  const whole = hundredths / 100n;
  const fraction = String(hundredths % 100n).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}×`;
}

export const LOOTBOX_CASE_MODELS = Object.freeze(['small', 'medium', 'large']);
// The physical SMALL and MEDIUM presets are 1x and 5x ticket price. Bronze
// owns values below their exact midpoint; the midpoint itself starts silver.
const LOOTBOX_CASE_SILVER_MULTIPLE = (1n + BOX_ORDER_MEDIUM_MULTIPLE) / 2n;
const LOOTBOX_CASE_GOLD_MULTIPLE = 16n;

const LOOTBOX_CASE_ASSETS = Object.freeze({
  small: Object.freeze({
    // Opening keeps the established low-lid, front-facing composition. The
    // Buy In thumbnail remains the approved taller render; only the reveal
    // swaps back to the flatter case that was already working in motion.
    lockedFront: '/app/assets/lootbox/degenerus-lootbox-case-compact-v36-old-panels-clean-lid-continuous-side-rails.webp',
    iconFront: '/app/assets/lootbox/degenerus-lootbox-case-small-v26-approved-locked-front.webp',
    retractedFront: '/app/assets/lootbox/degenerus-lootbox-case-compact-v36-old-panels-clean-lid-continuous-side-rails.webp',
    revealToneMask: '/app/assets/lootbox/degenerus-lootbox-case-compact-v36-shell-tone-mask.webp',
    trimOverlay: '/app/assets/lootbox/degenerus-lootbox-case-small-v34-continuous-bronze-side-rails-overlay.webp',
    lockedToneMask: '/app/assets/lootbox/degenerus-lootbox-case-small-v26-locked-shell-mask.webp',
    topToneMask: '/app/assets/lootbox/degenerus-lootbox-case-small-v21-buy-in-shell-mask.webp',
    top: '/app/assets/lootbox/degenerus-lootbox-case-small-v21-plain-lid-large-badge-buy-in-card.webp',
    cardTop: '/app/assets/lootbox/degenerus-lootbox-case-small-v21-plain-lid-large-badge-buy-in-card.webp',
    purchaseTop: '/app/assets/lootbox/degenerus-lootbox-case-small-v21-plain-lid-large-badge-buy-in-card.webp',
    innerLid: '/app/assets/lootbox/degenerus-lootbox-case-small-v14-inner-lid.webp',
    deadbolts: Object.freeze([
      '/app/assets/lootbox/degenerus-lootbox-case-small-v18-deadbolt-left.webp',
      '/app/assets/lootbox/degenerus-lootbox-case-small-v18-deadbolt-right.webp',
    ]),
  }),
  medium: Object.freeze({
    lockedFront: '/app/assets/lootbox/degenerus-lootbox-case-compact-v36-old-panels-clean-lid-continuous-side-rails.webp',
    iconFront: '/app/assets/lootbox/degenerus-lootbox-case-medium-v27-approved-locked-front.webp',
    retractedFront: '/app/assets/lootbox/degenerus-lootbox-case-compact-v36-old-panels-clean-lid-continuous-side-rails.webp',
    revealToneMask: '/app/assets/lootbox/degenerus-lootbox-case-compact-v36-shell-tone-mask.webp',
    lockedToneMask: '/app/assets/lootbox/degenerus-lootbox-case-medium-v27-locked-shell-mask.webp',
    topToneMask: '/app/assets/lootbox/degenerus-lootbox-case-medium-v26-buy-in-shell-mask.webp',
    // Keep the already-approved animated lid untouched. Priced card surfaces
    // use the restrained engraving, whose blank center preserves label contrast.
    top: '/app/assets/lootbox/degenerus-lootbox-case-medium-v26-purple-gold-perspective-buy-in-card.webp',
    cardTop: '/app/assets/lootbox/degenerus-lootbox-case-medium-v28-quiet-quadrant-buy-in-card.webp',
    purchaseTop: '/app/assets/lootbox/degenerus-lootbox-case-medium-v28-quiet-quadrant-buy-in-card.webp',
    innerLid: '/app/assets/lootbox/degenerus-lootbox-case-medium-v14-inner-lid.webp',
    deadbolts: Object.freeze([
      '/app/assets/lootbox/degenerus-lootbox-case-medium-v17-deadbolt-left.webp',
      '/app/assets/lootbox/degenerus-lootbox-case-medium-v17-deadbolt-right.webp',
    ]),
  }),
  large: Object.freeze({
    lockedFront: '/app/assets/lootbox/degenerus-lootbox-case-large-v43-side-connected-bracket-locked-front.png',
    retractedFront: '/app/assets/lootbox/degenerus-lootbox-case-large-v43-side-connected-bracket-retracted-front.png',
    top: '/app/assets/lootbox/degenerus-lootbox-case-large-v32-top.png',
    // The 1280px top remains the reveal asset, but the purchase card only
    // needs a 480px derivative. This keeps ~1.85 MiB off startup and defers the
    // full-resolution image until a player actually opens a large Luckbox.
    cardTop: '/app/assets/lootbox/degenerus-lootbox-case-large-v33-card.webp',
    purchaseTop: '/app/assets/lootbox/degenerus-lootbox-case-large-v33-card.webp',
    innerLid: '/app/assets/lootbox/degenerus-lootbox-case-large-v16-inner-lid.webp',
    deadbolts: Object.freeze([
      '/app/assets/lootbox/degenerus-lootbox-case-large-v31-deadbolt-left.png',
      '/app/assets/lootbox/degenerus-lootbox-case-large-v31-deadbolt-right.png',
    ]),
  }),
});

const LOOTBOX_CASE_GEOMETRY = Object.freeze({
  small: Object.freeze({
    caseAspect: '1200 / 539', caseWidth: 'min(430px, 76vw, 58dvh)',
    revealToneOpacity: '1',
    seam: '36%', badgeTop: '62.06%', badgeSize: '11.1%', badgeStaticSize: '11.1%',
    topBadgeTop: '77.5%', topBadgeSize: '16.8%', topBadgeScaleY: '0.78',
    shellInset: '0%', innerLidInset: '0%', innerLidWidth: '100%',
    badgeClipFront: 'ellipse(10.6% 17.4% at 50% 62.06%)',
    badgeClipTop: 'ellipse(11.8% 6.8% at 50% 78.9%)',
    // priceTop is the panel CENTER because CSS translates the label by -50%.
    priceTop: '37.25%', priceHeight: '20%', priceWidth: '44%',
  }),
  medium: Object.freeze({
    caseAspect: '1200 / 539', caseWidth: 'var(--rvl-box-w)',
    revealToneOpacity: '1',
    seam: '36%', badgeTop: '62.06%', badgeSize: '11.1%', badgeStaticSize: '11.1%',
    topBadgeTop: '77.5%', topBadgeSize: '16.8%', topBadgeScaleY: '0.78',
    shellInset: '0%', innerLidInset: '0%', innerLidWidth: '100%',
    badgeClipFront: 'ellipse(10.6% 17.4% at 50% 62.06%)',
    badgeClipTop: 'ellipse(11.8% 6.8% at 50% 78.9%)',
    priceTop: '37.25%', priceHeight: '20%', priceWidth: '44%',
  }),
  large: Object.freeze({
    caseAspect: '1200 / 539', caseWidth: 'var(--rvl-box-w)',
    revealToneOpacity: '0',
    seam: '34%', badgeTop: '61.6%', badgeSize: '10.35%', badgeStaticSize: '11.5%',
    topBadgeTop: '66.5%', topBadgeSize: '12.2%', topBadgeScaleY: '0.92',
    shellInset: '0%', innerLidInset: '0%', innerLidWidth: '100%',
    badgeClipFront: 'ellipse(5.3% 11.8% at 49.94% 61.6%)',
    badgeClipTop: 'ellipse(5.5% 5.5% at 50% 66.5%)',
    priceTop: '25.4%', priceHeight: '21.5%', priceWidth: '42%',
  }),
});

/**
 * Bronze SMALL covers values below the midpoint between the physical 1x and
 * 5x presets. Silver MEDIUM starts at that 3x midpoint, and every amount in
 * the 16x gold color band uses the authored LARGE gold case. Unknown legacy
 * values use MEDIUM deliberately.
 */
export function lootboxCaseModel(amountWei, ticketPriceWei) {
  const amount = _positiveBigInt(amountWei);
  const price = _positiveBigInt(ticketPriceWei);
  if (amount == null || price == null) return 'medium';
  if (amount >= price * LOOTBOX_CASE_GOLD_MULTIPLE) return 'large';
  if (amount >= price * LOOTBOX_CASE_SILVER_MULTIPLE) return 'medium';
  return 'small';
}

export function lootboxCaseAssets(model = 'medium') {
  return LOOTBOX_CASE_ASSETS[LOOTBOX_CASE_MODELS.includes(model) ? model : 'medium'];
}

/**
 * Return the complete physical-case presentation for any UI surface. Keeping
 * both art and model-specific registration geometry here prevents a custom box
 * from becoming SMALL in the tray but MEDIUM in the opener, for example.
 */
export function lootboxCasePresentation(model = 'medium', { fullResolution = false } = {}) {
  const normalizedModel = LOOTBOX_CASE_MODELS.includes(model) ? model : 'medium';
  const assets = LOOTBOX_CASE_ASSETS[normalizedModel];
  const geometry = LOOTBOX_CASE_GEOMETRY[normalizedModel];
  const image = (url) => `url("${url}")`;
  const css = {
    '--lootbox-case-art': image(assets.iconFront || assets.lockedFront),
    '--lootbox-case-locked-art': image(assets.lockedFront),
    '--lootbox-case-retracted-art': image(assets.retractedFront),
    '--lootbox-case-reveal-tone-mask': image(assets.revealToneMask || assets.retractedFront),
    '--lootbox-case-locked-tone-mask': image(assets.lockedToneMask || assets.lockedFront),
    '--lootbox-case-trim-overlay': assets.trimOverlay ? image(assets.trimOverlay) : 'none',
    '--lootbox-case-top-art': image(fullResolution ? assets.top : assets.cardTop),
    '--lootbox-case-top-tone-mask': image(assets.topToneMask || (fullResolution ? assets.top : assets.cardTop)),
    '--lootbox-case-purchase-art': image(assets.purchaseTop),
    '--lootbox-case-inner-lid-art': image(assets.innerLid),
    '--lootbox-case-front-face': assets.frontFace ? image(assets.frontFace) : 'none',
    '--lootbox-case-aspect': geometry.caseAspect,
    '--lootbox-case-width': geometry.caseWidth,
    '--lootbox-case-reveal-tone-opacity': geometry.revealToneOpacity,
    '--lootbox-case-seam': geometry.seam,
    '--lootbox-case-badge-top': geometry.badgeTop,
    '--lootbox-case-badge-size': geometry.badgeSize,
    '--lootbox-static-badge-size': geometry.badgeStaticSize,
    '--lootbox-top-badge-top': geometry.topBadgeTop,
    '--lootbox-top-badge-size': geometry.topBadgeSize,
    '--lootbox-top-badge-scale-y': geometry.topBadgeScaleY,
    '--lootbox-case-shell-inset': geometry.shellInset,
    '--lootbox-inner-lid-inset': geometry.innerLidInset,
    '--lootbox-inner-lid-width': geometry.innerLidWidth,
    '--lootbox-badge-clip': geometry.badgeClipFront,
    '--lootbox-top-badge-clip': geometry.badgeClipTop,
    '--lootbox-price-top': geometry.priceTop,
    '--lootbox-price-height': geometry.priceHeight,
    '--lootbox-price-width': geometry.priceWidth,
  };
  assets.deadbolts.forEach((url, index) => {
    css[`--lootbox-deadbolt-${index + 1}`] = image(url);
  });
  return { model: normalizedModel, assets, geometry, css };
}

/** Apply the canonical family selection without replacing unrelated styles. */
export function applyLootboxCasePresentation(element, model = 'medium', options) {
  const presentation = lootboxCasePresentation(model, options);
  element?.setAttribute?.('data-lootbox-case-model', presentation.model);
  if (element?.style?.setProperty) {
    Object.entries(presentation.css).forEach(([name, value]) => {
      element.style.setProperty(name, value);
    });
  }
  return presentation;
}

/**
 * Doubling bands make size recognizable without requiring readable copy:
 * sub-ticket steel, then green → blue → purple → red → gold.
 */
export function lootboxValuePresentation(
  amountWei,
  ticketPriceWei = currentLootboxTicketPriceWei(),
) {
  const amount = _positiveBigInt(amountWei);
  const price = _positiveBigInt(ticketPriceWei);
  if (amount == null || price == null) {
    return {
      tone: 'unknown', model: 'medium', unitsLabel: null,
      amountWei: amount, ticketPriceWei: price,
    };
  }
  let tone = 'steel';
  if (amount >= price * 16n) tone = 'gold';
  else if (amount >= price * 8n) tone = 'red';
  else if (amount >= price * 4n) tone = 'purple';
  else if (amount >= price * 2n) tone = 'blue';
  else if (amount >= price) tone = 'green';
  return {
    tone,
    model: lootboxCaseModel(amount, price),
    unitsLabel: _unitsLabel(amount, price),
    amountWei: amount,
    ticketPriceWei: price,
  };
}
