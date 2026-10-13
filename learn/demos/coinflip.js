// /learn/demos/coinflip.js - learn-page demo of the app's daily coinflip felt.
// Chip arithmetic, chip art and the coin reveal plan are the real app modules.
// renderChipStrip / renderBankrollRack below are verbatim copies of the private
// renderers mirrored in /app/coinflip-felt-demo.js (they are not exported), so
// keep them in sync with that file. No wallet, no RPC: static files only.

import {
  coinflipAmountLabel,
  coinflipBetPresentation,
  coinflipBetChipLayout,
  coinflipBetChipPiles,
  coinflipPayoutStackArt,
  coinflipRackChipCount,
  coinflipWinChipPiles,
  selectFlipRevealPlan,
  REVEAL_BIASED_END_MS,
} from '/app/components/app-daily-flip.js';
import { flipPileVariant } from '/app/app/flip-piles.js';
import { appendCoinFaces } from '/app/app/coin-faces.js';

const UNIT = 10n ** 18n;
const STAKE_FLIP = 25_000n;
const START_CLAIM_FLIP = 100_000n;

const $ = (bind) => document.querySelector(`[data-bind="${bind}"]`);
const fmt = (flip) => flip.toLocaleString('en-US');

// --- verbatim copies of the felt's chip renderers ---------------------------

function renderChipStrip({
  host,
  rack,
  amountWei,
  pileCounts = null,
  emptyCopy,
}) {
  rack.textContent = '';
  rack.removeAttribute('data-payout-layout');
  rack.removeAttribute('style');
  const piles = pileCounts
    ?? (amountWei == null ? [] : coinflipBetChipPiles(amountWei));
  if (piles.length === 0) {
    rack.textContent = emptyCopy;
    return;
  }
  if (pileCounts) {
    rack.setAttribute('data-payout-layout', 'rank');
    rack.setAttribute('style', `--df-payout-columns:${piles.length}`);
    piles.forEach((count, stackIndex) => {
      const stackNode = document.createElement('img');
      stackNode.className = 'df-payout-chip-stack';
      stackNode.src = coinflipPayoutStackArt(count, stackIndex);
      stackNode.width = count === 1 ? 120 : 128;
      stackNode.height = count === 1 ? 64 : 55 + (16 * count);
      stackNode.alt = '';
      stackNode.setAttribute('aria-hidden', 'true');
      stackNode.setAttribute('data-chip-count', String(count));
      stackNode.setAttribute(
        'style',
        `--df-payout-column:${stackIndex + 1};`
          + `--df-payout-delay:${(stackIndex * 0.045).toFixed(3)}s`,
      );
      rack.appendChild(stackNode);
    });
    return;
  }
  const presentation = coinflipBetPresentation(amountWei);
  if (presentation > 0) {
    const pile = document.createElement('i');
    pile.className = 'df-bet-pile';
    pile.setAttribute('data-pile', String(presentation));
    pile.setAttribute('data-variant', flipPileVariant(amountWei));
    rack.appendChild(pile);
    return;
  }
  coinflipBetChipLayout(amountWei).forEach(({ chips, count, turns }) => {
    const stackNode = document.createElement('span');
    stackNode.className = 'df-bet-chip-stack';
    stackNode.setAttribute('data-chip-count', String(count));
    stackNode.setAttribute('data-stack-turns', turns.join(''));
    chips.forEach(({ rise, turn }, index) => {
      const chip = document.createElement('i');
      chip.className = [
        'df-bet-chip',
        index === count - 1 ? 'is-top' : '',
      ].filter(Boolean).join(' ');
      chip.setAttribute('data-chip-turn', String(turn));
      chip.setAttribute(
        'style',
        `--df-chip-rise:calc(var(--df-chip-height) * ${rise.toFixed(3)})`,
      );
      stackNode.appendChild(chip);
    });
    rack.appendChild(stackNode);
  });
  void host;
}

function renderBankrollRack({ baseWei, creditWei = 0n, creditVisible = false }) {
  const host = $('df-bankroll-rack');
  if (!host) return;
  host.textContent = '';
  const credit = creditVisible ? creditWei : 0n;
  host.classList.toggle('is-crediting', credit > 0n);
  let channelRem = 13.2;
  try {
    const width = host.getBoundingClientRect?.().width;
    const rootFont = Number.parseFloat(
      globalThis.getComputedStyle?.(document.documentElement)?.fontSize,
    );
    if (Number.isFinite(width) && width > 0
      && Number.isFinite(rootFont) && rootFont > 0) {
      channelRem = (width / rootFont) - 0.4;
    }
  } catch (_error) { /* keep the fallback channel width */ }
  const capacity = Math.max(56, Math.floor((channelRem / 0.2) * 2) - 8);
  const baseCount = coinflipRackChipCount(baseWei, capacity);
  const creditCount = credit > 0n
    ? Math.max(2, Math.min(
      Math.max(0, capacity - baseCount),
      coinflipRackChipCount(credit, capacity),
    ))
    : 0;
  const groups = [
    { source: 'base', total: baseCount },
    ...(creditCount > 0 ? [{ source: 'credit', total: creditCount }] : []),
  ];
  const stacks = groups.flatMap(({ source, total }) => {
    const barrels = [];
    let remaining = total;
    let barrel = 0;
    while (remaining > 0) {
      const count = Math.min(20, remaining);
      barrels.push({ source, count, barrel });
      remaining -= count;
      barrel += 1;
    }
    return barrels;
  });
  host.dataset.state = stacks.length === 0 ? 'empty' : 'visible';
  if (stacks.length === 0) return;
  const enumerated = stacks.map((stack) => ({ ...stack, physicalCount: stack.count }));
  const baseRem = 0.17;
  const gapRem = 0.2;
  const overlapCount = enumerated.reduce((sum, stack) => sum + stack.physicalCount - 1, 0);
  const rowsOf = (stepRem) => {
    const spans = enumerated.map((stack) => baseRem + ((stack.physicalCount - 1) * stepRem));
    const totalSpan = spans.reduce((sum, span) => sum + span, 0);
    if (totalSpan + (Math.max(0, enumerated.length - 1) * gapRem) <= channelRem) {
      return [enumerated.map((stack, index) => ({ stack, span: spans[index] }))];
    }
    const rows = [[], []];
    let upperSpan = 0;
    enumerated.forEach((stack, index) => {
      const upper = upperSpan + (spans[index] / 2) <= totalSpan / 2 || rows[0].length === 0;
      if (upper) upperSpan += spans[index];
      rows[upper ? 0 : 1].push({ stack, span: spans[index] });
    });
    return rows.filter((row) => row.length > 0);
  };
  const rowSpan = (row) => row.reduce((sum, item) => sum + item.span, 0)
    + (Math.max(0, row.length - 1) * gapRem);
  let stepRem = overlapCount > 0
    ? Math.max(0.1, Math.min(
      0.2,
      ((2 * channelRem)
        - (enumerated.length * baseRem)
        - (Math.max(0, enumerated.length - 1) * gapRem)) / overlapCount,
    ))
    : 0.2;
  let rows = rowsOf(stepRem);
  for (let pass = 0; pass < 3; pass += 1) {
    const widest = Math.max(...rows.map(rowSpan));
    if (widest <= channelRem || stepRem <= 0.085) break;
    const fixed = rows.reduce((sum, row) => sum + (row.length * baseRem), 0) / rows.length;
    stepRem = Math.max(0.085, stepRem * ((channelRem - fixed) / Math.max(1, widest - fixed)));
    rows = rowsOf(stepRem);
  }
  for (const row of rows) {
    const rowNode = document.createElement('span');
    rowNode.className = 'df-bankroll__row';
    for (const { stack } of row) {
      const roll = document.createElement('span');
      roll.className = 'df-bankroll__roll';
      roll.setAttribute('data-bankroll-source', stack.source);
      roll.setAttribute('data-chip-barrel', String(stack.barrel));
      roll.setAttribute('data-barrel-full', String(stack.count === 20));
      roll.setAttribute('data-chip-count', String(stack.count));
      roll.setAttribute('style', `--df-bankroll-roll-span:${(baseRem + ((stack.physicalCount - 1) * stepRem)).toFixed(3)}rem`);
      for (let index = 0; index < stack.physicalCount; index += 1) {
        const chip = document.createElement('i');
        chip.className = 'df-bankroll__chip';
        chip.setAttribute('style', `--df-bankroll-chip-x:${(index * stepRem).toFixed(3)}rem`);
        roll.appendChild(chip);
      }
      rowNode.appendChild(roll);
    }
    host.appendChild(rowNode);
  }
}

// --- demo state ---------------------------------------------------------------

const state = {
  stakeFlip: STAKE_FLIP,
  claimFlip: START_CLAIM_FLIP,
  // null = unresolved, otherwise { won, percent }
  result: null,
  flipping: false,
  wins: 27,
  losses: 19,
  recent: [1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1],
};

const flipButton = $('demo-flip');
const note = $('demo-note');
const coinZone = $('df-coin-zone');
let finishTimer = null;

const reducedMotion = () => Boolean(
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
);

/**
 * The contract's reward draw (FlipRoundLib.coinflipRewardPercent, no bonus):
 * 5% pays 50, 5% pays 150, the other 90% pays a uniform 78 to 115.
 */
function drawRewardPercent() {
  const roll = Math.floor(Math.random() * 20);
  if (roll === 0) return 50;
  if (roll === 1) return 150;
  return 78 + Math.floor(Math.random() * 38);
}

function setNote(text, tone = '') {
  note.textContent = text;
  if (tone) note.setAttribute('data-tone', tone);
  else note.removeAttribute('data-tone');
}

// --- felt rendering -----------------------------------------------------------

function renderToday() {
  const stakeWei = state.stakeFlip * UNIT;
  const won = state.result?.won === true;
  const lost = state.result?.won === false;
  const totalWei = won
    ? stakeWei + ((stakeWei * BigInt(state.result.percent)) / 100n)
    : null;
  renderChipStrip({
    host: $('df-bet-oval'),
    rack: $('df-bet-chip-rack'),
    amountWei: lost ? null : stakeWei,
    emptyCopy: '',
  });
  const row = $('df-today-winnings-row');
  const addedWei = totalWei != null && totalWei > stakeWei ? totalWei - stakeWei : null;
  const winPiles = addedWei == null ? [] : coinflipWinChipPiles(stakeWei, totalWei);
  row.dataset.state = winPiles.length === 0 ? 'empty' : 'win';
  row.dataset.layout = coinflipBetPresentation(stakeWei) > 0 ? 'front' : 'behind';
  renderChipStrip({
    host: row,
    rack: $('df-today-winnings-rack'),
    amountWei: addedWei,
    pileCounts: winPiles,
    emptyCopy: '',
  });

  const slot = $('df-position-today');
  slot.textContent = '';
  const outcome = lost ? 'loss' : won ? 'win' : null;
  const positionRow = document.createElement('div');
  positionRow.className = [
    'df-position-row',
    outcome ? `df-position-row--${outcome}` : '',
  ].filter(Boolean).join(' ');
  positionRow.setAttribute('data-position', 'today');
  if (outcome) {
    const multi = document.createElement('span');
    multi.className = 'df-position-multiplier';
    const tag = document.createElement('span');
    tag.className = 'df-position-outcome';
    tag.textContent = won ? 'WIN' : 'LOSS';
    multi.appendChild(tag);
    if (won) {
      const pct = document.createElement('span');
      pct.className = 'df-position-percentage';
      pct.textContent = `${100 + state.result.percent}%`;
      multi.appendChild(pct);
    }
    positionRow.appendChild(multi);
  }
  const result = document.createElement('span');
  result.className = 'df-position-result';
  const value = document.createElement('span');
  value.className = `df-position-value${outcome ? ` df-position-value--${outcome}` : ''}`;
  value.textContent = lost
    ? `-${fmt(state.stakeFlip)}`
    : won
      ? `+${fmt(totalWei / UNIT)}`
      : coinflipAmountLabel(stakeWei);
  result.appendChild(value);
  positionRow.appendChild(result);
  slot.appendChild(positionRow);
}

function renderTomorrow() {
  const stakeWei = state.stakeFlip * UNIT;
  $('df-tomorrow-bet-oval').setAttribute('data-tomorrow-display', 'amount');
  renderChipStrip({
    host: $('df-tomorrow-bet-oval'),
    rack: $('df-tomorrow-chip-rack'),
    amountWei: null,
    emptyCopy: coinflipAmountLabel(stakeWei),
  });
  const slot = $('df-position-tomorrow');
  slot.textContent = '';
  const row = document.createElement('div');
  row.className = 'df-position-row';
  row.setAttribute('data-position', 'tomorrow');
  const result = document.createElement('span');
  result.className = 'df-position-result';
  const value = document.createElement('span');
  value.className = 'df-position-value';
  const number = document.createElement('span');
  number.className = 'df-position-number';
  number.textContent = fmt(state.stakeFlip);
  const unit = document.createElement('span');
  unit.className = 'df-position-unit';
  unit.textContent = ' FLIP';
  value.appendChild(number);
  value.appendChild(unit);
  result.appendChild(value);
  row.appendChild(result);
  slot.appendChild(row);
}

function renderBankroll() {
  renderBankrollRack({ baseWei: state.claimFlip * UNIT });
  $('df-funds-flip-total').textContent = state.claimFlip === 0n ? '-' : fmt(state.claimFlip);
}

function renderRecord() {
  const score = $('demo-score');
  score.textContent = '';
  const w = document.createElement('b');
  w.textContent = String(state.wins);
  const dash = document.createElement('i');
  dash.setAttribute('aria-hidden', 'true');
  dash.textContent = '–';
  const l = document.createElement('b');
  l.textContent = String(state.losses);
  score.append(w, dash, l);
  $('demo-score-group').dataset.majority = state.wins >= state.losses ? 'win' : 'loss';

  const recent = $('demo-recent');
  recent.textContent = '';
  for (const win of state.recent) {
    const mark = document.createElement('i');
    mark.className = `df-coinflip-record__mark ${win ? 'is-win' : 'is-loss'}`;
    recent.appendChild(mark);
  }
  const recentWins = state.recent.reduce((sum, win) => sum + win, 0);
  $('demo-recent-group').dataset.majority = recentWins * 2 >= state.recent.length ? 'win' : 'loss';
}

// --- coin ---------------------------------------------------------------------

/** The unresolved coin: the app's idle rotateX loop, built from the real faces. */
function mountIdleCoin() {
  coinZone.textContent = '';
  const coin = document.createElement('button');
  coin.type = 'button';
  coin.className = 'df-coin df-coin--spinning';
  coin.setAttribute('aria-label', 'Flip the community coin');
  const inner = document.createElement('span');
  inner.className = 'df-coin3d__inner';
  appendCoinFaces(inner);
  coin.appendChild(inner);
  coin.addEventListener('click', flip);
  coinZone.appendChild(coin);
  return inner;
}

function mountLandedCoin(won) {
  coinZone.textContent = '';
  const face = document.createElement('div');
  face.className = 'df-coin df-coin--landed';
  const img = document.createElement('img');
  img.src = won ? '/shared/coinflip-face-eth.svg' : '/shared/coinflip-face-red.svg';
  img.alt = won ? 'Green ETH face, win' : 'Red face, loss';
  face.appendChild(img);
  coinZone.appendChild(face);
}

// --- one flip -----------------------------------------------------------------

function settle(won, percent) {
  finishTimer = null;
  state.result = { won, percent };
  state.flipping = false;
  mountLandedCoin(won);
  renderToday();

  const stakeWei = state.stakeFlip * UNIT;
  state.recent.push(won ? 1 : 0);
  if (state.recent.length > 25) state.recent.shift();
  if (won) state.wins += 1; else state.losses += 1;
  renderRecord();

  if (won) {
    const paid = (stakeWei + ((stakeWei * BigInt(percent)) / 100n)) / UNIT;
    state.claimFlip += paid;
    renderBankroll();
    setNote(`Won: ${percent}% reward, pays ${fmt(paid)} FLIP`, 'win');
  } else {
    setNote(`Lost: ${fmt(state.stakeFlip)} FLIP burned`, 'loss');
  }
  flipButton.textContent = 'Flip again';
  flipButton.disabled = false;
}

function flip() {
  if (state.flipping) return;
  state.flipping = true;
  flipButton.disabled = true;
  setNote('The coin is in the air.');

  // A fresh day: today's spot goes back to the full stake and the coin to idle.
  state.result = null;
  renderToday();
  const inner = coinZone.querySelector('.df-coin3d__inner') ?? mountIdleCoin();

  const won = Math.random() < 0.5;
  const percent = won ? drawRewardPercent() : 0;
  if (reducedMotion()) {
    settle(won, percent);
    return;
  }

  // The same deterministic motion track + ending the app plays. A random day
  // number stands in for the protocol day; realReversalCount 0 keeps the plan
  // free of Reverse Flip cards, which the demo has no table for.
  const day = Math.floor(Math.random() * 2 ** 31);
  const plan = selectFlipRevealPlan(day, won, 0n);
  inner.classList.add(
    'df-reveal-active',
    `df-reveal-track--${plan.profile}`,
    `df-reveal-bias--${plan.bias}`,
    plan.openingMs === REVEAL_BIASED_END_MS ? 'df-reveal-opening--biased' : 'df-reveal-opening--standard',
    `df-reveal-ending--${plan.ending}`,
  );
  if (plan.hardStop) inner.classList.add('df-reveal-hard-stop');
  inner.style.setProperty('--df-track-duration', `${plan.trackMs}ms`);
  inner.style.setProperty('--df-ending-duration', `${plan.endingMs}ms`);
  if (plan.hardStop) {
    inner.style.setProperty('--df-hard-stop-duration', `${plan.totalMs}ms`);
    inner.style.setProperty('--df-hard-stop-rotation', `${plan.hardStopRotationDeg}deg`);
  }
  finishTimer = setTimeout(() => settle(won, percent), plan.totalMs);
}

flipButton.addEventListener('click', flip);

// --- fit to the iframe width --------------------------------------------------

const fit = $('demo-fit');
function fitToWidth() {
  const scale = Math.min(1, document.documentElement.clientWidth / 360);
  fit.style.zoom = scale < 1 ? String(scale) : '';
}
globalThis.addEventListener('resize', fitToWidth);
fitToWidth();

// --- boot ---------------------------------------------------------------------

mountIdleCoin();
renderToday();
renderTomorrow();
renderBankroll();
renderRecord();
setNote(`${fmt(state.stakeFlip)} FLIP rides on today's flip`);
