// Stable lootbox-size palette. Box value is measured against the ticket price
// routed at purchase time, so ETH price changes do not make equal-value boxes
// look unrelated. Legacy/indexed rows fall back to the live routed price.

import {
  BOX_ORDER_LARGE_MULTIPLE,
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

const LOOTBOX_CASE_ASSETS = Object.freeze({
  small: Object.freeze({
    lockedFront: '/app/assets/lootbox/degenerus-lootbox-case-small-v14-locked-front.webp',
    retractedFront: '/app/assets/lootbox/degenerus-lootbox-case-small-v14-retracted-front.webp',
    top: '/app/assets/lootbox/degenerus-lootbox-case-small-v14-top.webp',
    innerLid: '/app/assets/lootbox/degenerus-lootbox-case-small-v14-inner-lid.webp',
    deadbolts: Object.freeze([
      '/app/assets/lootbox/degenerus-lootbox-case-small-v14-deadbolt-left.webp',
      '/app/assets/lootbox/degenerus-lootbox-case-small-v14-deadbolt-right.webp',
    ]),
  }),
  medium: Object.freeze({
    lockedFront: '/app/assets/lootbox/degenerus-lootbox-case-medium-v14-locked-front.webp',
    retractedFront: '/app/assets/lootbox/degenerus-lootbox-case-medium-v14-retracted-front.webp',
    top: '/app/assets/lootbox/degenerus-lootbox-case-medium-v14-top.webp',
    innerLid: '/app/assets/lootbox/degenerus-lootbox-case-medium-v14-inner-lid.webp',
    deadbolts: Object.freeze([
      '/app/assets/lootbox/degenerus-lootbox-case-medium-v14-deadbolt-left.webp',
      '/app/assets/lootbox/degenerus-lootbox-case-medium-v14-deadbolt-right.webp',
    ]),
  }),
  large: Object.freeze({
    lockedFront: '/app/assets/lootbox/degenerus-lootbox-case-large-v14-locked-front.webp',
    retractedFront: '/app/assets/lootbox/degenerus-lootbox-case-large-v14-retracted-front.webp',
    top: '/app/assets/lootbox/degenerus-lootbox-case-large-v14-top.webp',
    innerLid: '/app/assets/lootbox/degenerus-lootbox-case-large-v14-inner-lid.webp',
    deadbolts: Object.freeze([
      '/app/assets/lootbox/degenerus-lootbox-case-large-v14-deadbolt-1.webp',
      '/app/assets/lootbox/degenerus-lootbox-case-large-v14-deadbolt-2.webp',
      '/app/assets/lootbox/degenerus-lootbox-case-large-v14-deadbolt-3.webp',
      '/app/assets/lootbox/degenerus-lootbox-case-large-v14-deadbolt-4.webp',
    ]),
  }),
});

const LOOTBOX_CASE_GEOMETRY = Object.freeze({
  small: Object.freeze({
    seam: '40.6%', badgeTop: '59.4%', badgeSize: '11%',
    shellInset: '15.3%', innerLidInset: '9.7%', innerLidWidth: '80.6%',
    badgeClipFront: 'ellipse(5.7% 12.8% at 50% 59.4%)',
    badgeClipTop: 'ellipse(7.4% 6.5% at 50% 68.1%)',
    priceTop: '28%', priceHeight: '18%', priceWidth: '44%',
  }),
  medium: Object.freeze({
    seam: '37.1%', badgeTop: '61.6%', badgeSize: '12.35%',
    shellInset: '0%', innerLidInset: '0%', innerLidWidth: '100%',
    badgeClipFront: 'ellipse(6.3% 14% at 50% 61.6%)',
    badgeClipTop: 'ellipse(7.5% 6.3% at 50% 77.9%)',
    priceTop: '27%', priceHeight: '19%', priceWidth: '45%',
  }),
  large: Object.freeze({
    seam: '43.8%', badgeTop: '61.8%', badgeSize: '11.85%',
    shellInset: '0%', innerLidInset: '0%', innerLidWidth: '100%',
    badgeClipFront: 'ellipse(6.1% 13.5% at 50% 61.8%)',
    badgeClipTop: 'ellipse(7.3% 6.4% at 50% 72.5%)',
    priceTop: '20%', priceHeight: '19%', priceWidth: '42%',
  }),
});

/**
 * The contract's preset prices define the physical case family: 1x SMALL,
 * 5x MEDIUM and 25x LARGE. Custom/indexed amounts stay on the lower model
 * until they reach the next real preset boundary. Unknown legacy values use
 * MEDIUM deliberately as the neutral/generic protocol case.
 */
export function lootboxCaseModel(amountWei, ticketPriceWei) {
  const amount = _positiveBigInt(amountWei);
  const price = _positiveBigInt(ticketPriceWei);
  if (amount == null || price == null) return 'medium';
  if (amount >= price * BOX_ORDER_LARGE_MULTIPLE) return 'large';
  if (amount >= price * BOX_ORDER_MEDIUM_MULTIPLE) return 'medium';
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
export function lootboxCasePresentation(model = 'medium') {
  const normalizedModel = LOOTBOX_CASE_MODELS.includes(model) ? model : 'medium';
  const assets = LOOTBOX_CASE_ASSETS[normalizedModel];
  const geometry = LOOTBOX_CASE_GEOMETRY[normalizedModel];
  const image = (url) => `url("${url}")`;
  const css = {
    '--lootbox-case-art': image(assets.lockedFront),
    '--lootbox-case-locked-art': image(assets.lockedFront),
    '--lootbox-case-retracted-art': image(assets.retractedFront),
    '--lootbox-case-top-art': image(assets.top),
    '--lootbox-case-inner-lid-art': image(assets.innerLid),
    '--lootbox-case-seam': geometry.seam,
    '--lootbox-case-badge-top': geometry.badgeTop,
    '--lootbox-case-badge-size': geometry.badgeSize,
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
export function applyLootboxCasePresentation(element, model = 'medium') {
  const presentation = lootboxCasePresentation(model);
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
