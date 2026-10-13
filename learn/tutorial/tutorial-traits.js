import { DGN_COLORS, DGN_QUADRANTS, DGN_SYMBOLS, DGN_CARD_IDX, dgnBadgePath, dgnDisplaySymbol, dgnTraitIdToQSC } from '../../app/app/dgn-traits.js';
import { ACTIVE_TICKET_TRAITS, SECOND_ACTIVE_TICKET_TRAITS } from './tutorial-state.js?v=22';

// Regular ticket color widths from DegenerusTraitUtils.weightedColorBucket.
export const COLOR_WEIGHTS = Object.freeze([64, 64, 64, 32, 16, 8, 6, 2]);
const CATEGORIES = ['Crypto', 'Zodiac', 'Cards', 'Dice'];
const TICKETS = [ACTIVE_TICKET_TRAITS, SECOND_ACTIVE_TICKET_TRAITS];
const label = value => ({ wwxrp: 'WWXRP', sui: 'SUI', cashsack: 'Cash sack' })[value]
  || value.charAt(0).toUpperCase() + value.slice(1);
const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 5 });

// Existing corner-cut ticket quadrants, including the paper and colored edge.
export function badgeQuadrantPath(badgeId) {
  const { q, sym, col } = dgnTraitIdToQSC(badgeId);
  const category = DGN_QUADRANTS[q];
  const index = category === 'cards' ? DGN_CARD_IDX[sym] : sym;
  return '/badges-q' + q + '/' + category + '_' + String(index).padStart(2, '0')
    + '_' + DGN_SYMBOLS[category][sym] + '_' + DGN_COLORS[col] + '.svg';
}

export function badgeDetail(badgeId) {
  const { q, sym, col } = dgnTraitIdToQSC(badgeId);
  return { q, sym, col, color: DGN_COLORS[col], category: CATEGORIES[q],
    name: label(DGN_COLORS[col]) + ' ' + label(dgnDisplaySymbol(q, sym, col)),
    image: dgnBadgePath(q, sym, col), frequency: COLOR_WEIGHTS[col] / 256 * 100 };
}

export function badgePossibilities(badgeId) {
  const { q, sym, col } = badgeDetail(badgeId);
  return {
    symbols: Array.from({ length: 8 }, (_, symbol) => {
      const id = (q << 6) | (col << 3) | symbol;
      return { badgeId: id, name: label(dgnDisplaySymbol(q, symbol, col)), image: badgeQuadrantPath(id),
        frequency: 12.5, selected: symbol === sym };
    }),
    colors: DGN_COLORS.map((color, index) => {
      const id = (q << 6) | (index << 3) | sym;
      return { badgeId: id, name: label(color), image: badgeQuadrantPath(id),
        frequency: COLOR_WEIGHTS[index] / 256 * 100, selected: index === col };
    }),
  };
}

export function renderBadgeLesson(root, page, selected, buildPaperTicket) {
  const key = page + ':' + selected;
  if (root.dataset.renderedKey === key) return;
  root.dataset.renderedKey = key;
  root.dataset.page = page;
  root.scrollTop = 0;

  if (page === 'badges') {
    root.innerHTML = '<header class="tut-badges__heading"><span>YOUR TWO TICKETS</span><h2>Eight independent jackpot entries.</h2></header>'
      + '<div class="tut-badges__tickets">' + TICKETS.map((_, index) =>
        '<div><span class="tut-badges__ticket-label">TICKET ' + (index + 1) + ' · 4 ENTRIES</span><div data-ticket="' + index + '"></div></div>').join('') + '</div>'
      + '<p class="tut-badges__footnote">Each badge is an independent entry into the daily jackpots.</p>';
    TICKETS.forEach((badges, index) => {
      root.querySelector('[data-ticket="' + index + '"]').appendChild(buildPaperTicket(badges, false));
    });
    return;
  }

  const badge = badgeDetail(selected);
  const ticketIndex = TICKETS.findIndex(ticket => ticket.includes(selected));
  const eyebrow = 'TICKET ' + (ticketIndex + 1) + ' · ' + badge.category.toUpperCase() + ' QUADRANT';
  if (page === 'badge-closeup') {
    root.innerHTML = '<header class="tut-badges__heading"><span>' + eyebrow + '</span><h2>One quadrant of your ticket.</h2></header>'
      + '<figure class="tut-badges__selected"><img class="tut-badges__quadrant" src="' + badgeQuadrantPath(selected) + '" alt="' + badge.name + ' ticket quadrant">'
      + '<figcaption>' + badge.name + '</figcaption></figure>'
      + '<p class="tut-badges__footnote">One symbol + one color = one badge.</p>';
    return;
  }

  const colors = page === 'badge-colors';
  const choices = badgePossibilities(selected)[colors ? 'colors' : 'symbols'];
  root.innerHTML = '<header class="tut-badges__heading"><span>' + eyebrow + '</span>'
    + '<h2>' + (colors ? '8 colors. Different chances.' : '8 symbols. Equal chances.') + '</h2></header>'
    + '<div class="tut-badges__section-label">' + (colors
      ? label(dgnDisplaySymbol(badge.q, badge.sym, badge.col)).toUpperCase() + ' IN EVERY VERSION'
      : badge.color.toUpperCase() + ' IN EVERY VERSION') + '</div>'
    + '<div class="tut-badges__choices ' + (colors ? 'tut-badges__colors' : 'tut-badges__symbols') + '">'
    + choices.map(choice => '<figure class="tut-badges__choice' + (choice.selected ? ' is-selected' : '') + '"'
      + ' data-chance="' + choice.frequency + '" data-badge-id="' + choice.badgeId + '">'
      + '<img src="' + choice.image + '" alt="' + badgeDetail(choice.badgeId).name + ' ticket quadrant">'
      + '<figcaption><strong>' + choice.name + '</strong><span>' + percent.format(choice.frequency) + '%</span></figcaption></figure>').join('') + '</div>';
}
