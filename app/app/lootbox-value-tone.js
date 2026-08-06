// Stable lootbox-size palette. Box value is measured against the ticket price
// routed at purchase time, so ETH price changes do not make equal-value boxes
// look unrelated. Legacy/indexed rows fall back to the live routed price.

import { scaledTicketPriceWei } from './lootbox.js';
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
    return { tone: 'unknown', unitsLabel: null, amountWei: amount, ticketPriceWei: price };
  }
  let tone = 'steel';
  if (amount >= price * 16n) tone = 'gold';
  else if (amount >= price * 8n) tone = 'red';
  else if (amount >= price * 4n) tone = 'purple';
  else if (amount >= price * 2n) tone = 'blue';
  else if (amount >= price) tone = 'green';
  return {
    tone,
    unitsLabel: _unitsLabel(amount, price),
    amountWei: amount,
    ticketPriceWei: price,
  };
}

