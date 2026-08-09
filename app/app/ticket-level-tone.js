// Shared RPG-style ticket-level difficulty colors.
//
// Ticket levels are compared with the level purchases route to right now. The
// last resolved day's roll1.purchaseLevel is the UI's authoritative source (it
// is also what the ticket inventory uses); /game/state is the startup fallback.

import { activeTicketLevel } from './active-level.js';
import { get } from './store.js';

function _level(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function currentPurchaseTicketLevel() {
  const indexed = _level(get('app.lastDay')?.roll1?.purchaseLevel);
  if (indexed != null) return indexed;
  return _level(activeTicketLevel(get('app.gameState')));
}

/**
 * RPG threat ladder relative to the current purchase level:
 * current/past = white, +1 = blue, +2 = green, +3 = yellow,
 * +4 = orange, +5 and beyond = red.
 */
export function ticketLevelTone(ticketLevel, purchaseLevel = currentPurchaseTicketLevel()) {
  const ticket = _level(ticketLevel);
  if (ticket == null) return null;
  const current = _level(purchaseLevel);
  if (current == null || ticket <= current) return 'white';
  const distance = ticket - current;
  if (distance === 1) return 'blue';
  if (distance === 2) return 'green';
  if (distance === 3) return 'yellow';
  if (distance === 4) return 'orange';
  return 'red';
}

/** Add the shared CSS hook without replacing a component's existing classes. */
export function applyTicketLevelTone(element, ticketLevel, purchaseLevel) {
  if (!element) return null;
  const tone = ticketLevelTone(ticketLevel, purchaseLevel);
  element.classList?.add?.('ticket-level-tone');
  element.setAttribute?.('data-ticket-level-tone', tone || 'unknown');
  return tone;
}
