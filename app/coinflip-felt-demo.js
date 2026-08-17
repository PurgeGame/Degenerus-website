// /app/coinflip-felt-demo.js — local visual demo for the coinflip felt zones,
// wager chip stacks, and the bankroll rack. Chip arithmetic comes from the
// real component exports; the DOM building mirrors app-daily-flip.js
// #renderChipStrip / #renderBankrollRack and must be kept in sync with them.

import {
  coinflipAmountLabel,
  coinflipBetChipPiles,
  coinflipBetPresentation,
  coinflipRackChipCount,
} from '/app/components/app-daily-flip.js';

const UNIT = 10n ** 18n;

const state = {
  todayFlip: 43_844n,
  todayWinPercent: null,
  todayLost: false,
  tomorrowFlip: 25_300n,
  tomorrowMasked: false,
  bankrollFlip: 987_654n,
  bankrollCreditFlip: 0n,
};

// Headless screenshot support: ?today=43844&win=150&lost=1&tomorrow=25300
// &masked=1&bankroll=987654&credit=65766&width=430
const params = new URLSearchParams(location.search);
if (params.has('today')) state.todayFlip = BigInt(params.get('today'));
if (params.has('win')) state.todayWinPercent = Number(params.get('win'));
if (params.has('lost')) state.todayLost = true;
if (params.has('tomorrow')) state.tomorrowFlip = BigInt(params.get('tomorrow'));
if (params.has('masked')) state.tomorrowMasked = true;
if (params.has('bankroll')) state.bankrollFlip = BigInt(params.get('bankroll'));
if (params.has('credit')) state.bankrollCreditFlip = BigInt(params.get('credit'));
if (params.has('noanim')) document.body.classList.add('demo-no-anim');
if (params.has('width')) {
  document.querySelector('.coinflip-felt-demo__hero')
    .style.setProperty('--demo-width', `${params.get('width')}px`);
}

const $ = (bind) => document.querySelector(`[data-bind="${bind}"]`);
const fmt = (flip) => flip.toLocaleString('en-US');

// --- mirrors of the component's private renderers -------------------------

function renderChipStrip({ host, rack, amountWei, growToWei = null, emptyCopy }) {
  rack.textContent = '';
  const piles = amountWei == null ? [] : coinflipBetChipPiles(amountWei);
  if (piles.length === 0) {
    rack.textContent = emptyCopy;
    return;
  }
  const presentation = coinflipBetPresentation(amountWei);
  if (presentation > 0) {
    const pile = document.createElement('i');
    pile.className = `df-bet-pile${growToWei != null ? ' df-bet-pile--held' : ''}`;
    pile.setAttribute('data-pile', String(presentation));
    if (growToWei != null) {
      const add = document.createElement('i');
      add.className = 'df-bet-pile-add';
      pile.appendChild(add);
    }
    rack.appendChild(pile);
    return;
  }
  for (const count of piles) {
    const stackNode = document.createElement('span');
    stackNode.className = 'df-bet-chip-stack';
    stackNode.setAttribute('data-chip-count', String(count));
    const riseStep = Math.min(0.25, 1.15 / Math.max(1, count - 1));
    for (let index = 0; index < count; index += 1) {
      const chip = document.createElement('i');
      chip.className = [
        'df-bet-chip',
        index === count - 1 ? 'is-top' : '',
      ].filter(Boolean).join(' ');
      chip.setAttribute('style', `--df-chip-rise:calc(var(--df-chip-height) * ${(index * riseStep).toFixed(3)})`);
      stackNode.appendChild(chip);
    }
    rack.appendChild(stackNode);
  }
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

// --- demo state → section -------------------------------------------------

function renderToday() {
  const won = state.todayWinPercent != null && !state.todayLost;
  const stakeWei = state.todayFlip * UNIT;
  const totalWei = won ? (stakeWei * BigInt(state.todayWinPercent)) / 100n : null;
  renderChipStrip({
    host: $('df-bet-oval'),
    rack: $('df-bet-chip-rack'),
    amountWei: state.todayLost || state.todayFlip === 0n ? null : stakeWei,
    growToWei: won && totalWei != null && coinflipBetPresentation(stakeWei) > 0
      ? totalWei
      : null,
    emptyCopy: state.todayLost ? '' : 'NO BET',
  });
  const row = $('df-today-winnings-row');
  const winPile = won && totalWei != null && coinflipBetPresentation(stakeWei) > 0;
  const addedWei = !winPile && totalWei != null && totalWei > stakeWei ? totalWei - stakeWei : null;
  row.dataset.state = addedWei == null ? 'empty' : 'win';
  renderChipStrip({
    host: row,
    rack: $('df-today-winnings-rack'),
    amountWei: addedWei,
    emptyCopy: '',
  });
  const slot = $('df-position-today');
  slot.textContent = '';
  const positionRow = document.createElement('div');
  const outcome = state.todayFlip === 0n
    ? 'no-bet'
    : state.todayLost ? 'loss' : won ? 'win' : null;
  positionRow.className = [
    'df-position-row',
    outcome ? `df-position-row--${outcome}` : '',
  ].filter(Boolean).join(' ');
  positionRow.setAttribute('data-position', 'today');
  if (outcome === 'win' || outcome === 'loss') {
    const multi = document.createElement('span');
    multi.className = 'df-position-multiplier';
    const tag = document.createElement('span');
    tag.className = 'df-position-outcome';
    tag.textContent = outcome === 'win' ? 'WIN' : 'LOSS';
    multi.appendChild(tag);
    if (outcome === 'win') {
      const pct = document.createElement('span');
      pct.className = 'df-position-percentage';
      pct.textContent = `${100 + state.todayWinPercent}%`;
      multi.appendChild(pct);
    }
    positionRow.appendChild(multi);
  }
  const result = document.createElement('span');
  result.className = 'df-position-result';
  const value = document.createElement('span');
  value.className = `df-position-value${outcome ? ` df-position-value--${outcome}` : ''}`;
  value.textContent = state.todayFlip === 0n
    ? ''
    : state.todayLost
      ? `-${fmt(state.todayFlip)}`
      : won
        ? `+${fmt((state.todayFlip * BigInt(state.todayWinPercent)) / 100n)}`
        : coinflipAmountLabel(state.todayFlip * UNIT);
  result.appendChild(value);
  positionRow.appendChild(result);
  slot.appendChild(positionRow);
}

function renderTomorrow() {
  const hasAmount = !state.tomorrowMasked && state.tomorrowFlip > 0n;
  $('df-tomorrow-bet-oval').setAttribute(
    'data-tomorrow-display',
    hasAmount ? 'amount' : 'placeholder',
  );
  renderChipStrip({
    host: $('df-tomorrow-bet-oval'),
    rack: $('df-tomorrow-chip-rack'),
    amountWei: null,
    emptyCopy: state.tomorrowMasked
      ? '••••'
      : hasAmount ? coinflipAmountLabel(state.tomorrowFlip * UNIT) : 'NO BET',
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
  number.textContent = state.tomorrowMasked ? '••••' : fmt(state.tomorrowFlip);
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
  renderBankrollRack({
    baseWei: state.bankrollFlip * UNIT,
    creditWei: state.bankrollCreditFlip * UNIT,
    creditVisible: state.bankrollCreditFlip > 0n,
  });
  const total = state.bankrollFlip + state.bankrollCreditFlip;
  $('df-funds-flip-total').textContent = total === 0n ? '-' : fmt(total);
}

function renderRecent() {
  const recent = $('demo-recent');
  recent.textContent = '';
  const pattern = [1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1];
  for (const win of pattern) {
    const mark = document.createElement('i');
    mark.className = `df-coinflip-record__mark ${win ? 'is-win' : 'is-loss'}`;
    recent.appendChild(mark);
  }
}

function renderAll() {
  renderToday();
  renderTomorrow();
  renderBankroll();
}

document.querySelector('.coinflip-felt-demo__controls').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.dayShift != null) {
    // Preview the rollover choreography: today's spot clears, then the
    // staged readout turns into chips that fill the circle.
    state.todayFlip = 0n;
    state.todayWinPercent = null;
    state.todayLost = false;
    renderAll();
    setTimeout(() => {
      state.todayFlip = state.tomorrowFlip;
      state.tomorrowFlip = 0n;
      renderAll();
    }, 650);
    return;
  }
  const group = button.closest('fieldset');
  group.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === button));
  if (button.dataset.width) {
    document.querySelector('.coinflip-felt-demo__hero')
      .style.setProperty('--demo-width', `${button.dataset.width}px`);
    return;
  }
  if (button.dataset.today != null) {
    state.todayFlip = BigInt(button.dataset.today);
    state.todayWinPercent = button.dataset.todayWin ? Number(button.dataset.todayWin) : null;
    state.todayLost = button.dataset.todayLost === 'true';
  }
  if (button.dataset.tomorrow != null) {
    state.tomorrowFlip = BigInt(button.dataset.tomorrow);
    state.tomorrowMasked = button.dataset.tomorrowMasked === 'true';
  }
  if (button.dataset.bankroll != null) {
    state.bankrollFlip = BigInt(button.dataset.bankroll);
    state.bankrollCreditFlip = button.dataset.bankrollCredit
      ? BigInt(button.dataset.bankrollCredit)
      : 0n;
  }
  renderAll();
});

renderRecent();
renderAll();
