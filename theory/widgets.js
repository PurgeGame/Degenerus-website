import '/app/components/replay-panel.js';
import { traitToBadge, DISPLAY_ORDER } from '/app/app/jackpot-data.js';
import { ETH_DIVISOR } from '/app/app/chain-config.js';
import { warmup } from '/app/app/jackpot-sfx.js';
import { LEVEL_10_PRIZES } from './jackpot-example-data.js';

// Selected examples explain the draw; they are not a simulated return series.
const PLAYER = '0x0000000000000000000000000000000000000001';
const OTHER = '0x0000000000000000000000000000000000000002';
const TICKETS = [[63, 66, 149, 221], [38, 81, 172, 235], [0, 110, 183, 248]];
function awardsFor(mainTraits, prizeOrder, winningTraits = []) {
  return mainTraits.flatMap((traitId, quadrant) => {
    const prize = LEVEL_10_PRIZES[prizeOrder[quadrant]];
    const eth = Array.from({ length: prize.winners }, (_, index) => ({
      traitId, amount: String(BigInt(prize.amount) * 1000000n / ETH_DIVISOR),
      awardType: 'eth', level: 10,
      winner: index === 0 && winningTraits.includes(traitId) ? PLAYER : OTHER,
    }));
    const tickets = prize.tickets.flatMap(award => Array.from({ length: award.winners }, () => ({
      traitId, amount: award.amount, awardType: 'tickets', winner: OTHER,
      level: award.level, sourceLevel: award.sourceLevel,
    })));
    return [...eth, ...tickets];
  });
}
const SCENARIOS = [
  {
    description: 'Three drawn badges match your tickets. Pop the bubbles to find your prizes.',
    result: 'Two of your matching badges won ETH.',
    mainTraits: [63, 66, 159, 221],
    prizeOrder: [3, 1, 0, 2], winningTraits: [63, 221],
  },
  {
    description: 'Two badges match. Pop them to see whether your tickets won.',
    result: 'You matched two badges, but neither won a prize this day.',
    mainTraits: [38, 100, 149, 222], prizeOrder: [2, 0, 3, 1],
  },
  {
    description: 'None of the drawn badges match your tickets today.',
    result: 'No matches today. The same tickets can try again tomorrow.',
    mainTraits: [12, 88, 191, 230], prizeOrder: [1, 3, 2, 0],
  },
  {
    description: 'Just one badge matches today. Pop it and the center to reveal your prizes.',
    result: 'You won the grand prize of the level and a place in a Craps Battle.',
    mainTraits: [12, 88, 172, 230], prizeOrder: [1, 2, 0, 3], winningTraits: [172],
    crapsBattle: true,
  },
];

const tickets = document.getElementById('sample-tickets');
TICKETS.forEach((traits, index) => {
  const ticket = document.createElement('div');
  ticket.className = 'sample-ticket';
  ticket.setAttribute('role', 'img');
  const badges = DISPLAY_ORDER.map(q => traitToBadge(traits[q]));
  ticket.setAttribute('aria-label', `Ticket ${index + 1}: ${badges.map(b => b.label).join(', ')}`);
  for (const badge of badges) {
    const cell = document.createElement('div');
    cell.className = 'sample-ticket-badge';
    const img = document.createElement('img');
    img.src = badge.path;
    img.alt = '';
    cell.appendChild(img);
    ticket.appendChild(cell);
  }
  const center = document.createElement('div');
  center.className = 'sample-ticket-center';
  const flame = document.createElement('img');
  flame.src = '/specials/special_none.svg';
  flame.alt = '';
  center.appendChild(flame);
  ticket.appendChild(center);
  tickets.appendChild(ticket);
});

let panel;
let currentDay = -1;
let spinTimeout;
let centerObserver;
const mount = document.getElementById('jackpot-mount');
const next = document.getElementById('jackpot-next');
const description = document.getElementById('jackpot-description');
function mountDay(index) {
  const scenario = SCENARIOS[index];
  const fixture = {
    day: 42 + index, level: 10, purchaseLevel: 10, dayInPhase: 1 + index,
    player: PLAYER, entryCount: TICKETS.length * 4, playerTraits: TICKETS.flat(),
    futureTraits: [], bonusTraits: TICKETS[2], bonusTraitDraw: false, roll2Wins: [],
    mainTraits: scenario.mainTraits,
    roll1Wins: awardsFor(scenario.mainTraits, scenario.prizeOrder, scenario.winningTraits),
    coinDrawBattle: scenario.crapsBattle ? {
      kind: 'jackpot', day: 42 + index, key: `0x${'f'.repeat(64)}`,
      entrants: [{ player: PLAYER, betId: '1' }],
    } : null,
  };
  centerObserver?.disconnect();
  panel?.remove();
  panel = document.createElement('replay-panel');
  panel.setAttribute('single-button', '');
  // Seeding before connection prevents live replay/RPC requests.
  panel.setTutorialFixture(fixture);
  mount.replaceChildren(panel);
  panel.setTutorialFixture(fixture);
  if (scenario.crapsBattle) keepBattleAsPreview(panel);
  panel.addEventListener('replay:spin-complete', () => {
    clearTimeout(spinTimeout);
    description.textContent = SCENARIOS[index].description;
    next.textContent = 'Next Day →';
    next.disabled = false;
  });
  panel.addEventListener('replay:scratch-complete', () => {
    description.textContent = SCENARIOS[index].result;
  });
}

// Keep the production dice reveal, but this introductory example ends at the
// awarded seat. Capture mouse/touch clicks and keyboard activation before the
// replay component can open a battle or request its live data.
function keepBattleAsPreview(replay) {
  const center = replay.querySelector('[data-bind="center"]');
  const isRevealed = () => center.classList.contains('replay-ticket-center--craps');
  const stopOpen = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if ((isRevealed() && center.contains(event.target))
      || event.target.closest('[data-replay-action="craps-battle"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  replay.addEventListener('click', stopOpen, true);
  replay.addEventListener('keydown', stopOpen, true);
  const label = 'Craps Battle awarded. Preview only.';
  centerObserver = new MutationObserver(() => {
    if (!isRevealed()) return;
    for (const [name, value] of Object.entries({ role: 'img', tabindex: '-1', 'aria-label': label, title: label })) {
      if (center.getAttribute(name) !== value) center.setAttribute(name, value);
    }
    center.removeAttribute('aria-disabled');
  });
  centerObserver.observe(center, { attributes: true, attributeFilter: ['class', 'role', 'tabindex', 'aria-label', 'title', 'aria-disabled'] });
}
next.addEventListener('click', () => {
  warmup();
  clearTimeout(spinTimeout);
  const firstSpin = currentDay === -1;
  currentDay = (currentDay + 1) % SCENARIOS.length;
  const title = document.getElementById('jackpot-title');
  title.hidden = false;
  title.textContent = `Day ${currentDay + 1} of 4`;
  description.hidden = false;
  description.textContent = 'Drawing today’s badges…';
  next.textContent = 'Spinning…';
  next.disabled = true;
  if (!firstSpin) mountDay(currentDay);
  spinTimeout = setTimeout(() => {
    next.textContent = 'Next Day →';
    next.disabled = false;
    description.textContent = 'The draw could not finish. Press Next Day to try again.';
  }, 20000);
  panel.querySelector('[data-bind="reveal-btn"]').click();
});
mountDay(0);
next.disabled = false;
