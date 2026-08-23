// /app/coinflip-felt-demo.js — local visual demo for the coinflip felt zones,
// wager chip stacks, and the bankroll rack. Chip arithmetic comes from the
// real component exports; the DOM building mirrors app-daily-flip.js
// #renderChipStrip / #renderBankrollRack and must be kept in sync with them.

import {
  coinflipAmountLabel,
  coinflipBetChipCount,
  coinflipBetChipPiles,
  coinflipBetPresentation,
  coinflipPayoutStackArt,
  coinflipRackChipCount,
  coinflipWinChipCount,
  coinflipWinChipPiles,
} from '/app/components/app-daily-flip.js';
import { flipPileChipCount, flipPileVariant } from '/app/app/flip-piles.js';

const UNIT = 10n ** 18n;

const state = {
  customMode: 'win',
  todayFlip: 43_844n,
  todayWinPercent: null,
  todayLost: false,
  tomorrowFlip: 25_300n,
  tomorrowMasked: false,
  shifted: false,
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
if (params.has('shifted')) state.shifted = true;
if (params.has('bankroll')) state.bankrollFlip = BigInt(params.get('bankroll'));
if (params.has('credit')) state.bankrollCreditFlip = BigInt(params.get('credit'));
if (params.has('noanim')) document.body.classList.add('demo-no-anim');
if (params.has('width')) {
  document.querySelector('.coinflip-felt-demo__hero')
    .style.setProperty('--demo-width', `${params.get('width')}px`);
}

const $ = (bind) => document.querySelector(`[data-bind="${bind}"]`);
const fmt = (flip) => flip.toLocaleString('en-US');

/**
 * Any wager the operator can type: plain digits, grouped digits, or a k/m/b/t
 * suffix ("250k", "1.5m", "2b"). Returns null when the text is not a wager
 * yet, so a half-typed value leaves the felt alone instead of blanking it.
 */
const SUFFIX_ZEROS = { '': 0, k: 3, m: 6, b: 9, t: 12 };

function parseFlip(text) {
  const raw = String(text ?? '').trim().toLowerCase().replace(/[\s,_]/g, '');
  if (raw === '') return 0n;
  const match = raw.match(/^(\d*)(?:\.(\d*))?([kmbt]?)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const zeros = SUFFIX_ZEROS[match[3]];
  const whole = match[1] || '0';
  const frac = match[2] || '';
  return BigInt(whole + (frac.length > zeros
    ? frac.slice(0, zeros)
    : frac.padEnd(zeros, '0')));
}

// --- mirrors of the component's private renderers -------------------------

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
  piles.forEach((count, stackIndex) => {
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
      chip.setAttribute('data-chip-turn', String((stackIndex * 2 + index) % 4));
      chip.setAttribute('style', `--df-chip-rise:calc(var(--df-chip-height) * ${(index * riseStep).toFixed(3)})`);
      stackNode.appendChild(chip);
    }
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

// --- demo state → section -------------------------------------------------

function renderToday() {
  const won = state.todayWinPercent != null && !state.todayLost;
  const stakeWei = state.todayFlip * UNIT;
  // ?win= is the contract's reward percent, so the payout is the stake plus
  // that share of it — mirrors #winPayoutWei.
  const totalWei = won
    ? stakeWei + ((stakeWei * BigInt(state.todayWinPercent)) / 100n)
    : null;
  renderChipStrip({
    host: $('df-bet-oval'),
    rack: $('df-bet-chip-rack'),
    amountWei: state.todayLost || state.todayFlip === 0n ? null : stakeWei,
    emptyCopy: state.todayLost ? '' : 'NO BET',
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
        ? `+${fmt(totalWei / UNIT)}`
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

function renderShiftedPositions() {
  const resultFlip = state.todayFlip;
  const resultWinPercent = state.todayWinPercent;
  const resultLost = state.todayLost;
  const liveFlip = state.tomorrowFlip;

  // Reuse the production-mirroring Today renderer to deal the staged wager
  // into the large spot, then restore the immutable result for Yesterday.
  state.todayFlip = liveFlip;
  state.todayWinPercent = null;
  state.todayLost = false;
  renderToday();
  state.todayFlip = resultFlip;
  state.todayWinPercent = resultWinPercent;
  state.todayLost = resultLost;

  const lowerOval = $('df-tomorrow-bet-oval');
  const lowerRack = $('df-tomorrow-chip-rack');
  const outcome = resultFlip === 0n ? 'no-bet' : resultLost ? 'loss' : 'win';
  lowerOval.setAttribute('data-tomorrow-display', resultFlip > 0n ? 'amount' : 'placeholder');
  lowerOval.setAttribute('data-yesterday-outcome', outcome);
  renderChipStrip({
    host: lowerOval,
    rack: lowerRack,
    amountWei: null,
    emptyCopy: resultFlip > 0n ? coinflipAmountLabel(resultFlip * UNIT) : 'NO BET',
  });

  const slot = $('df-position-tomorrow');
  slot.textContent = '';
  const row = document.createElement('div');
  row.className = `df-position-row df-position-row--${outcome}`;
  row.setAttribute('data-position', 'tomorrow');
  if (outcome !== 'no-bet') {
    const multi = document.createElement('span');
    multi.className = 'df-position-multiplier';
    const tag = document.createElement('span');
    tag.className = 'df-position-outcome';
    tag.textContent = outcome === 'win' ? 'WIN' : 'LOSS';
    multi.appendChild(tag);
    if (outcome === 'win') {
      const pct = document.createElement('span');
      pct.className = 'df-position-percentage';
      pct.textContent = `${100 + Number(resultWinPercent || 0)}%`;
      multi.appendChild(pct);
    }
    row.appendChild(multi);
  }
  const result = document.createElement('span');
  result.className = 'df-position-result';
  const value = document.createElement('span');
  value.className = `df-position-value df-position-value--${outcome}`;
  value.textContent = outcome === 'no-bet'
    ? ''
    : outcome === 'loss'
      ? `-${fmt(resultFlip)}`
      : `+${fmt(resultFlip + ((resultFlip * BigInt(resultWinPercent || 0)) / 100n))}`;
  result.appendChild(value);
  row.appendChild(result);
  slot.appendChild(row);
}

function renderPositionChrome() {
  const top = $('demo-today-surface');
  const lower = $('demo-lower-surface');
  top.classList.add('is-actionable');
  top.classList.toggle('is-add-bet', state.shifted);
  lower.classList.toggle('is-yesterday', state.shifted);
  $('demo-today-label').textContent = "TODAY'S BET";
  $('demo-lower-label').textContent = state.shifted ? "YESTERDAY'S BET" : "TOMORROW'S BET";
  $('demo-today-add-cue').hidden = !state.shifted;
  $('demo-tomorrow-add-cue').hidden = state.shifted;
  if (!state.shifted) $('df-tomorrow-bet-oval').removeAttribute('data-yesterday-outcome');
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

/**
 * What the presentation code actually decided for the wager on the felt: the
 * lane it picked, the exact stack split, and the physical chip counts. The
 * bench is only useful if you can read the numbers behind the picture.
 */
function renderCustomReadout() {
  const out = $('demo-custom-readout');
  if (!out) return;
  out.textContent = '';
  const stakeWei = state.todayFlip * UNIT;
  const level = coinflipBetPresentation(stakeWei);
  const line = (label, body, tone) => {
    const row = document.createElement('span');
    const tag = document.createElement('b');
    tag.textContent = `${label} `;
    row.appendChild(tag);
    if (tone) {
      const hot = document.createElement('i');
      hot.textContent = tone;
      row.appendChild(hot);
      row.appendChild(document.createTextNode(' '));
    }
    row.appendChild(document.createTextNode(body));
    row.appendChild(document.createElement('br'));
    out.appendChild(row);
  };

  if (state.todayFlip === 0n) {
    line('BET', 'no bet — the spot prints NO BET');
    return;
  }
  if (level > 0) {
    const variant = flipPileVariant(stakeWei);
    line(
      'BET',
      `mound rung ${level}${variant === 'a' ? '' : `-${variant}`}, `
        + `${flipPileChipCount(stakeWei)} coins in the baked art`,
      `${fmt(state.todayFlip)} FLIP`,
    );
  } else {
    const piles = coinflipBetChipPiles(stakeWei);
    line(
      'BET',
      `composed stacks [${piles.join(', ')}] = ${coinflipBetChipCount(stakeWei)} chips`,
      `${fmt(state.todayFlip)} FLIP`,
    );
  }

  if (state.todayLost) {
    line('RESULT', 'loss — the spot clears and the receipt prints the stake back in red');
    return;
  }
  if (state.todayWinPercent == null) {
    line('RESULT', 'unresolved — the wager sits alone on the spot');
    return;
  }
  const pct = BigInt(state.todayWinPercent);
  const totalWei = stakeWei + ((stakeWei * pct) / 100n);
  const piles = coinflipWinChipPiles(stakeWei, totalWei);
  const chips = coinflipWinChipCount(stakeWei, totalWei);
  line(
    'PAYOUT',
    piles.length === 0
      ? 'nothing added'
      : `dealer rank ${piles.length} × [${piles.join(', ')}] = ${chips} chips`,
    `+${fmt((totalWei - stakeWei) / UNIT)} FLIP at ${100 + state.todayWinPercent}%`,
  );
}

function syncCustomFields() {
  const amount = $('demo-custom-amount');
  const percent = $('demo-custom-percent');
  const slider = $('demo-custom-slider');
  if (amount && document.activeElement !== amount) amount.value = fmt(state.todayFlip);
  const shown = state.todayWinPercent == null ? Number(percent?.value || 96) : state.todayWinPercent;
  if (percent && document.activeElement !== percent) percent.value = String(shown);
  if (slider) slider.value = String(Math.min(Number(slider.max), shown));
  document.querySelectorAll('[data-custom]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.custom === state.customMode);
  });
  // A preset stays lit only while it still describes what is on the felt, so
  // typing a wager cannot leave two controls claiming the same spot.
  document.querySelectorAll('[data-today]').forEach((button) => {
    const win = button.dataset.todayWin ? Number(button.dataset.todayWin) : null;
    button.classList.toggle('is-active',
      BigInt(button.dataset.today) === state.todayFlip
      && win === state.todayWinPercent
      && (button.dataset.todayLost === 'true') === state.todayLost);
  });
}

/** Apply the typed wager under the bench's current BET / WIN / LOSS mode. */
function applyCustom() {
  state.shifted = false;
  state.todayLost = state.customMode === 'loss';
  state.todayWinPercent = state.customMode === 'win'
    ? Number($('demo-custom-percent')?.value || 0)
    : null;
  renderAll();
}

function renderAll() {
  if (state.shifted) renderShiftedPositions();
  else {
    renderToday();
    renderTomorrow();
  }
  renderPositionChrome();
  renderBankroll();
  syncCustomFields();
  renderCustomReadout();
}

$('demo-today-surface').addEventListener('click', () => {
  if (state.todayWinPercent == null && !state.todayLost) return;
  state.shifted = true;
  renderAll();
});

document.querySelector('.coinflip-felt-demo__controls').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.resultShift != null) {
    if (state.todayWinPercent == null && !state.todayLost) state.todayWinPercent = 96;
    state.shifted = true;
    renderAll();
    return;
  }
  if (button.dataset.dayShift != null) {
    // Preview the rollover choreography: today's spot clears, then the
    // staged readout turns into chips that fill the circle.
    state.todayFlip = 0n;
    state.todayWinPercent = null;
    state.todayLost = false;
    state.shifted = false;
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
  if (button.dataset.custom != null) {
    state.customMode = button.dataset.custom;
    applyCustom();
    return;
  }
  if (button.dataset.today != null) {
    state.shifted = false;
    state.todayFlip = BigInt(button.dataset.today);
    state.todayWinPercent = button.dataset.todayWin ? Number(button.dataset.todayWin) : null;
    state.todayLost = button.dataset.todayLost === 'true';
    // The presets and the free-form bench drive the same wager, so a preset
    // click leaves the typed fields telling the truth about what is on felt.
    state.customMode = state.todayLost ? 'loss' : state.todayWinPercent == null ? 'bet' : 'win';
  }
  if (button.dataset.tomorrow != null) {
    state.shifted = false;
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

// --- free-form wager bench ------------------------------------------------

const customAmount = $('demo-custom-amount');
const customPercent = $('demo-custom-percent');
const customSlider = $('demo-custom-slider');

customAmount?.addEventListener('input', () => {
  const parsed = parseFlip(customAmount.value);
  // A half-typed value ("1.", "") is not a wager yet: hold the felt steady
  // rather than flashing it to NO BET between keystrokes.
  if (parsed == null) return;
  state.todayFlip = parsed;
  applyCustom();
});

// Normalize to grouped digits only once the operator is done typing.
customAmount?.addEventListener('change', () => {
  customAmount.value = fmt(state.todayFlip);
});

const setPercent = (value, source) => {
  const percent = Math.max(0, Math.round(Number(value) || 0));
  if (customPercent && source !== customPercent) customPercent.value = String(percent);
  if (customSlider && source !== customSlider) {
    customSlider.value = String(Math.min(Number(customSlider.max), percent));
  }
  state.customMode = 'win';
  applyCustom();
};

customPercent?.addEventListener('input', () => setPercent(customPercent.value, customPercent));
customSlider?.addEventListener('input', () => setPercent(customSlider.value, customSlider));

state.customMode = state.todayLost ? 'loss' : state.todayWinPercent == null ? 'bet' : 'win';

renderRecent();
renderAll();
