// Two-mode level pool instrument.
//
// Purchase phase: nextPrizePool fills toward the contract progression target,
// with the growth market's strict O/U line sharing the same scale.
// Jackpot phase: the graph disappears. The strip names the level's fixed,
// banked prize pool and the largest single-winner share the next physical draw
// can allocate under the contract's 6%-14% / final-day rules.
//
// Live pools prefer the same fast app.goldRush sample that drives the headline;
// /game/state remains the rolling-deploy fallback. Contract benchmarks are
// published by app-parimutuel-panel's existing refresh, so this component owns
// no fetch or polling timer.

import { displayEth } from '../app/scaling.js';
import { activeTicketLevel } from '../app/active-level.js';
import { ETH_DIVISOR } from '../app/chain-config.js';
import { formatJackpotCountdown, secondsUntilDayCrossover } from '../app/jackpot-countdown.js';
import { get, subscribe } from '../app/store.js';

const SCALE_HEADROOM_BPS = 11_250n;
const JACKPOT_DAY_CAP = 5;
const DAILY_CURRENT_BPS_MAX = 1_400n;
const DAILY_ETH_BPS = 8_000n; // 20% of each physical draw buys tickets.
const DAILY_SOLO_SHARE_BPS = 4_000n;
const FINAL_SOLO_SHARE_BPS = 6_000n;
export const LEVEL_ONE_TARGET_WEI = (50n * 10n ** 18n) / ETH_DIVISOR;

function _wei(value) {
  if (value == null || value === '') return null;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function _clampPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function _position(value, scale) {
  if (value == null || scale <= 0n) return null;
  return _clampPercent(Number((value * 10_000n) / scale) / 100);
}

/** Level 1 has no prior pool to ratchet from; the contract bootstraps it at 50 ETH. */
export function prizePoolTargetForLevel(level, targetWei) {
  if (Number(level) === 1) return LEVEL_ONE_TARGET_WEI;
  const target = _wei(targetWei);
  return target != null && target > 0n ? target : null;
}

/** Exact strict OVER threshold: live * prev > current². */
export function growthOverTargetWei(ratchets) {
  const prev = _wei(ratchets?.prev);
  const current = _wei(ratchets?.current);
  if (prev == null || current == null || prev <= 0n || current <= 0n) return null;
  return (current * current) / prev + 1n;
}

/** The growth percentage the open O/U market asks the next pool to beat. */
export function growthLinePercent(ratchets) {
  const prev = _wei(ratchets?.prev);
  const current = _wei(ratchets?.current);
  if (prev == null || current == null || prev <= 0n) return null;
  return Number(((current - prev) * 10_000n) / prev) / 100;
}

/** Pure purchase-phase layout model shared with the component tests. */
export function poolProgressModel({ nextWei, targetWei, ratchets } = {}) {
  const next = _wei(nextWei);
  const target = _wei(targetWei);
  const growthTarget = growthOverTargetWei(ratchets);
  const values = [next, target, growthTarget].filter((value) => value != null && value > 0n);
  const high = values.reduce((max, value) => value > max ? value : max, 1n);
  const scale = (high * SCALE_HEADROOM_BPS + 9_999n) / 10_000n;
  const levelReady = next != null && target != null && target > 0n && next > target;
  const growthOver = next != null && growthTarget != null && next >= growthTarget;
  const levelBps = next != null && target != null && target > 0n
    ? Number((next * 1_000n) / target)
    : null;
  // Before progression, the readout identifies the goal. Once the goal has
  // actually been cleared, keep that marker as historical context but let the
  // visible amount ride the live edge of the pool instead.
  const referenceWei = levelReady ? next : target;
  const referencePercent = levelReady
    ? _position(next, scale)
    : _position(target, scale);

  return {
    next,
    target: target != null && target > 0n ? target : null,
    growthTarget,
    growthLinePercent: growthLinePercent(ratchets),
    fillPercent: _position(next ?? 0n, scale),
    targetPercent: _position(target, scale),
    growthPercent: _position(growthTarget, scale),
    levelReady,
    growthOver,
    levelPercent: levelBps == null ? null : levelBps / 10,
    referenceKind: levelReady ? 'CURRENT' : 'GUARANTEE',
    referenceWei,
    referencePercent,
    neededWei: next != null && target != null && target >= next
      ? target - next + 1n
      : 0n,
  };
}

function _jackpotStep(counter, compressedFlag) {
  if (compressedFlag === 2 && counter === 0) return JACKPOT_DAY_CAP;
  if (compressedFlag === 1 && counter > 0 && counter < JACKPOT_DAY_CAP - 1) return 2;
  return 1;
}

/**
 * Pure jackpot-phase model.
 *
 * Non-final draws can take at most 14% of the remaining current pool (28% on
 * a two-day compressed draw). The ETH leg is 80% of that draw and its solo
 * bucket receives 40%. The final physical draw takes the remaining pool, with
 * 80% in the ETH leg and 60% assigned to the solo bucket. This is a maximum
 * face-value share; its large-pool 75/25 ETH/whale-pass settlement is handled
 * by the contract after a winner exists.
 */
export function jackpotPoolModel({ currentWei, baselineWei, counter = 0, compressedFlag = 0 } = {}) {
  const current = _wei(currentWei);
  const suppliedBaseline = _wei(baselineWei);
  const completed = Math.max(0, Math.min(JACKPOT_DAY_CAP, Number(counter) || 0));
  const compressed = Number(compressedFlag) || 0;
  const step = _jackpotStep(completed, compressed);
  const finalDraw = completed + step >= JACKPOT_DAY_CAP;
  const drawStart = Math.min(JACKPOT_DAY_CAP, completed + 1);
  const drawEnd = Math.min(JACKPOT_DAY_CAP, completed + step);
  const baseline = [current, suppliedBaseline]
    .filter((value) => value != null && value > 0n)
    .reduce((max, value) => value > max ? value : max, 0n);

  let maxWinWei = null;
  if (current != null) {
    const drawBps = finalDraw
      ? 10_000n
      : DAILY_CURRENT_BPS_MAX * BigInt(step);
    const drawBudget = (current * drawBps) / 10_000n;
    const ethBudget = (drawBudget * DAILY_ETH_BPS) / 10_000n;
    const soloShareBps = finalDraw ? FINAL_SOLO_SHARE_BPS : DAILY_SOLO_SHARE_BPS;
    maxWinWei = (ethBudget * soloShareBps) / 10_000n;
  }

  const remainingPercent = current != null && baseline > 0n
    ? Number((current * 10_000n) / baseline) / 100
    : null;

  return {
    current,
    baseline: baseline > 0n ? baseline : null,
    maxWinWei,
    finalDraw,
    step,
    drawStart,
    drawEnd,
    remainingPercent,
    fillPercent: _clampPercent(remainingPercent),
  };
}

/**
 * Use the same authoritative phase counter for the day label and payout model.
 * The indexed game-state snapshot can briefly retain zero after the contract has
 * advanced, which otherwise makes a final draw look like an ordinary day-one draw.
 */
export function jackpotDrawCounter({ contractPhase = null, gameState = null, goldRush = null } = {}) {
  const raw = contractPhase?.day
    ?? gameState?.jackpotCounter
    ?? goldRush?.phaseDay
    ?? 0;
  return Math.max(0, Math.min(JACKPOT_DAY_CAP, Number(raw) || 0));
}

/** Fixed achieved pool banked when this level crossed into jackpot phase. */
export function jackpotPrizePoolWei({ gameState = null, ratchets = null } = {}) {
  const pools = gameState?.prizePools || {};
  const candidates = [
    pools.lastPrizePool,
    pools.lastLevelPool,
    gameState?.lastPrizePool,
    gameState?.lastLevelPool,
    // growthState(level).ratchetRound is the write-once achieved pool, unlike
    // currentPrizePool, which shrinks after every jackpot draw.
    ratchets?.current,
  ];
  for (const candidate of candidates) {
    const value = _wei(candidate);
    if (value != null && value > 0n) return value;
  }
  return null;
}

/**
 * Name a reward jackpot only after its target level's purchase pool has closed.
 * BAF/Decimator settle while that level enters jackpot phase, not when the
 * previous level's final jackpot ends. The RNG request promotes `level` before
 * settlement, so a locked final-purchase window already names the target level.
 */
export function transitionJackpotCountdownModel({
  level = null,
  jackpot = false,
  lastPurchaseDay = false,
  rngLocked = false,
} = {}) {
  const current = Number(level);
  if (jackpot || !lastPurchaseDay || !Number.isInteger(current) || current < 0) return null;

  const target = current + (rngLocked ? 0 : 1);
  const mod100 = target % 100;
  const decimator = mod100 === 0 || (target % 10 === 5 && mod100 !== 95);
  const baf = target > 0 && target % 10 === 0;
  if (!decimator && !baf) return null;
  if (decimator && baf) {
    return { kind: 'both', label: 'DECIMATOR + BAF CROSSOVER IN:', level: target };
  }
  return decimator
    ? { kind: 'decimator', label: 'DECIMATOR CROSSOVER IN:', level: target }
    : { kind: 'baf', label: 'BAF CROSSOVER IN:', level: target };
}

/** Level and phase-day copy formerly rendered as a top-navigation pill. */
export function phaseStripModel({
  gameState = null,
  goldRush = null,
  phaseClock = null,
  contractPhase = null,
} = {}) {
  const state = gameState && typeof gameState === 'object'
    ? { ...(goldRush || {}), ...gameState }
    : goldRush || {};
  const phase = String(state?.phase || '').toUpperCase();
  const transition = Boolean(state?.phaseTransitionActive);
  const hasContractPhase = typeof contractPhase?.jackpot === 'boolean';
  const jackpot = hasContractPhase
    ? contractPhase.jackpot
    : phase === 'JACKPOT' && !transition;

  if (jackpot) {
    const level = Number(state?.level);
    const counter = jackpotDrawCounter({
      contractPhase: hasContractPhase ? contractPhase : null,
      gameState: state,
      goldRush,
    });
    // A compressed physical draw can consume more than one logical jackpot
    // day. Label the draw by the day it resolves through, so a compressed
    // final draw is DAY 5/5 whenever the payout model correctly says GRAND
    // PRIZE (instead of the contradictory DAY 4/5 + GRAND PRIZE pairing).
    const compressedFlag = contractPhase?.compressedFlag
      ?? state?.compressedJackpotFlag
      ?? 0;
    const drawDay = Math.min(
      JACKPOT_DAY_CAP,
      counter + _jackpotStep(counter, Number(compressedFlag) || 0),
    );
    return {
      jackpot: true,
      level: Number.isInteger(level) && level >= 0 ? level : null,
      day: drawDay,
      dayLabel: `JACKPOT DAY ${drawDay}`,
    };
  }

  const effectiveState = hasContractPhase
    ? {
      ...state,
      phase: contractPhase.jackpot ? 'JACKPOT' : 'PURCHASE',
      jackpotPhaseFlag: contractPhase.jackpot,
      phaseTransitionActive: false,
    }
    : state;
  const level = activeTicketLevel(effectiveState);
  const clockLevel = Number(phaseClock?.level);
  const clockDay = Number(phaseClock?.dayInPhase);
  const clockPhase = String(phaseClock?.phase || '').toUpperCase();
  const samePurchaseClock = clockPhase === 'P'
    && level != null
    && clockLevel === Number(level)
    && Number.isFinite(clockDay)
    && clockDay > 0;
  const firstPurchaseDay = clockPhase === 'J'
    && level != null
    && Number.isFinite(clockLevel)
    && clockLevel + 1 === Number(level);
  const day = samePurchaseClock ? clockDay : firstPurchaseDay ? 1 : null;
  const finalPurchaseDay = contractPhase?.lastPurchaseDay === true;

  return {
    jackpot: false,
    level,
    day,
    dayLabel: day == null
      ? finalPurchaseDay ? 'PURCHASE (FINAL)' : 'PURCHASE'
      : `PURCHASE DAY ${day}${finalPurchaseDay ? ' (FINAL)' : ''}`,
  };
}

function _groupWhole(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** displayEth truncates by design; this strip explicitly asks for whole-ETH rounding. */
function _formatWholeEth(raw) {
  const value = _wei(raw);
  if (value == null) return '—';
  const tenths = displayEth(value, 1);
  const [wholeText, fraction = '0'] = tenths.split('.');
  let whole;
  try { whole = BigInt(wholeText || '0'); }
  catch (_e) { return '—'; }
  if (Number(fraction[0] || 0) >= 5) whole += 1n;
  return _groupWhole(whole);
}

function _formatGrowth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function _formatBarPercent(value) {
  if (value == null || value === '') return '—%';
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.max(0, Math.round(n))}%` : '—%';
}

class AppPoolProgress extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #phaseClock = null;
  #phaseClockListener = null;
  #countdownTimer = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    // A stale hot-reload chip must not survive after phase status moved here.
    try { document.getElementById?.('unav-state')?.remove?.(); } catch (_e) { /* defensive */ }
    this.#unsubs.push(
      subscribe('app.gameState', () => this.#render()),
      subscribe('app.goldRush', () => this.#render()),
      subscribe('app.poolBenchmarks', () => this.#render()),
    );
    if (typeof document !== 'undefined' && document.addEventListener) {
      this.#phaseClockListener = (event) => {
        this.#phaseClock = event?.detail || null;
        this.#render();
      };
      document.addEventListener('replay:phase-clock', this.#phaseClockListener);
    }
    this.#paintCountdown();
    this.#countdownTimer = setInterval(() => this.#paintCountdown(), 250);
    try { this.#countdownTimer?.unref?.(); } catch (_e) { /* browser timer */ }
  }

  disconnectedCallback() {
    for (const off of this.#unsubs) {
      try { off(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#phaseClockListener && typeof document !== 'undefined') {
      document.removeEventListener?.('replay:phase-clock', this.#phaseClockListener);
    }
    this.#phaseClockListener = null;
    if (this.#countdownTimer != null) clearInterval(this.#countdownTimer);
    this.#countdownTimer = null;
    this.#initialized = false;
  }

  #renderShell() {
    this.innerHTML = `
      <section class="pool-progress" data-mode="purchase" aria-label="Level prize pool">
        <div class="pool-progress__special-jackpot" data-el="pool-special-jackpot" hidden>
          <span data-el="pool-special-jackpot-label">NEXT JACKPOT IN:</span>
          <strong data-el="pool-special-jackpot-countdown">--:--</strong>
        </div>
        <header class="pool-progress__head">
          <strong class="pool-progress__day" data-el="pool-day">PURCHASE</strong>
        </header>
        <div class="pool-progress__body">
          <strong class="pool-progress__name" data-el="pool-name">LEVEL — PRIZE POOL</strong>
          <div class="pool-progress__track" data-el="pool-track"
               role="progressbar" aria-label="Level prize pool progress"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <span class="pool-progress__fill" data-el="pool-fill"></span>
            <span class="pool-progress__marker pool-progress__marker--target"
                  data-el="pool-target-marker" title="Level guarantee"></span>
            <span class="pool-progress__marker pool-progress__marker--growth"
                  data-el="pool-growth-marker" title="Over/under growth target"></span>
            <span class="pool-progress__marker-label" data-el="pool-reference-label">
              <small data-el="pool-reference-kind">GUARANTEE</small>
              <strong data-el="pool-target-inline">—</strong>
              <em>ETH</em>
            </span>
            <strong class="pool-progress__percent" data-el="pool-percent">—%</strong>
          </div>
        </div>
        <div class="pool-progress__jackpot" data-el="pool-jackpot-summary" hidden>
          <span class="pool-progress__jackpot-context">
            <strong class="pool-progress__jackpot-phase pool-progress__jackpot-phase--full">JACKPOT PHASE</strong>
            <strong class="pool-progress__jackpot-phase pool-progress__jackpot-phase--compact">JP</strong>
            <span>DAY <strong data-el="pool-jackpot-day">—/5</strong></span>
          </span>
          <span class="pool-progress__jackpot-pool">
            <span class="pool-progress__jackpot-pool-label">LEVEL <strong data-el="pool-jackpot-level">—</strong> PRIZE POOL :</span>
            <span class="pool-progress__jackpot-amount"><strong data-el="pool-jackpot-pool">—</strong> <em>ETH</em></span>
          </span>
          <span class="pool-progress__jackpot-tail">
            <span class="pool-progress__jackpot-next">
              <span class="pool-progress__jackpot-copy--full">NEXT JACKPOT IN:</span>
              <span class="pool-progress__jackpot-copy--compact">NEXT JP</span>
              <strong data-el="pool-jackpot-countdown">--:--</strong>
            </span>
            <i aria-hidden="true">·</i>
            <span class="pool-progress__jackpot-win">
              <span class="pool-progress__jackpot-copy--full" data-el="pool-jackpot-win-label-full">WIN UP TO</span>
              <span class="pool-progress__jackpot-copy--compact" data-el="pool-jackpot-win-label-compact">UP TO</span>
              <strong data-el="pool-jackpot-win">—</strong> <em>ETH</em>
            </span>
          </span>
        </div>
        <span class="pool-progress__status" data-el="pool-status" aria-live="polite"></span>
      </section>
    `;
  }

  #set(name, value) {
    const element = this.querySelector(`[data-el="${name}"]`);
    if (element) element.textContent = String(value);
    return element;
  }

  #paintCountdown() {
    const countdown = formatJackpotCountdown(secondsUntilDayCrossover());
    this.#set('pool-jackpot-countdown', countdown);
    this.#set('pool-special-jackpot-countdown', countdown);
    const special = this.querySelector('[data-el="pool-special-jackpot"]');
    if (special && !special.hidden) {
      const label = this.querySelector('[data-el="pool-special-jackpot-label"]')?.textContent || 'Special jackpot in:';
      special.setAttribute('aria-label', `${label.replace(/:$/, '')} ${countdown}`);
    }
  }

  #setMarker(name, position, title) {
    const marker = this.querySelector(`[data-el="${name}"]`);
    if (!marker) return;
    marker.hidden = position == null;
    if (marker.style && position != null) marker.style.left = `${position}%`;
    marker.title = title;
  }

  #render() {
    const gameState = get('app.gameState');
    const goldRush = get('app.goldRush');
    const benchmarks = get('app.poolBenchmarks');
    const stateLevel = Number(gameState?.level ?? goldRush?.level);
    const benchmarkLevel = Number(benchmarks?.level);
    const sameLevel = !Number.isInteger(stateLevel)
      || (Number.isInteger(benchmarkLevel) && benchmarkLevel === stateLevel);
    const benchmarkTargetWei = sameLevel ? benchmarks?.targetWei : null;
    const ratchets = sameLevel ? benchmarks?.ratchets : null;
    const contractPhase = sameLevel ? benchmarks?.contractPhase : null;
    const phase = phaseStripModel({
      gameState,
      goldRush,
      phaseClock: this.#phaseClock,
      contractPhase,
    });
    const targetWei = prizePoolTargetForLevel(phase.level, benchmarkTargetWei);
    const shell = this.querySelector('.pool-progress');
    const head = this.querySelector('.pool-progress__head');
    const body = this.querySelector('.pool-progress__body');
    const jackpotSummary = this.querySelector('[data-el="pool-jackpot-summary"]');
    const track = this.querySelector('[data-el="pool-track"]');
    const fill = this.querySelector('[data-el="pool-fill"]');
    const specialJackpot = this.querySelector('[data-el="pool-special-jackpot"]');
    const exactLevel = contractPhase?.level == null ? null : Number(contractPhase.level);
    const rewardJackpot = transitionJackpotCountdownModel({
      level: Number.isInteger(exactLevel) ? exactLevel : stateLevel,
      jackpot: phase.jackpot,
      lastPurchaseDay: contractPhase?.lastPurchaseDay === true,
      rngLocked: typeof contractPhase?.rngLocked === 'boolean'
        ? contractPhase.rngLocked
        : gameState?.rngLockedFlag === true,
    });

    this.#set('pool-day', phase.dayLabel);
    this.#set('pool-name', phase.level == null
      ? phase.jackpot ? 'DAILY JACKPOT' : 'PRIZE POOL'
      : `LEVEL ${phase.level} ${phase.jackpot ? 'DAILY JACKPOT' : 'PRIZE POOL'}`);
    shell?.setAttribute('data-mode', phase.jackpot ? 'jackpot' : 'purchase');

    if (phase.jackpot) {
      if (head) head.hidden = true;
      if (body) body.hidden = true;
      if (jackpotSummary) jackpotSummary.hidden = false;
      const currentWei = goldRush?.components?.currentWei
        ?? gameState?.prizePools?.currentPrizePool
        ?? null;
      const fixedPoolWei = jackpotPrizePoolWei({ gameState, ratchets });
      const model = jackpotPoolModel({
        currentWei,
        baselineWei: fixedPoolWei,
        counter: jackpotDrawCounter({ contractPhase, gameState, goldRush }),
        compressedFlag: contractPhase?.compressedFlag
          ?? gameState?.compressedJackpotFlag,
      });
      if (specialJackpot) {
        specialJackpot.hidden = true;
        specialJackpot.removeAttribute('data-kind');
        specialJackpot.removeAttribute('aria-label');
      }
      this.#set('pool-jackpot-level', phase.level ?? '—');
      this.#set('pool-jackpot-pool', _formatWholeEth(fixedPoolWei));
      this.#set('pool-jackpot-day', `${phase.day ?? '—'}/${JACKPOT_DAY_CAP}`);
      this.#set('pool-jackpot-win-label-full', model.finalDraw ? 'GRAND PRIZE:' : 'WIN UP TO');
      this.#set('pool-jackpot-win-label-compact', model.finalDraw ? 'GRAND PRIZE:' : 'UP TO');
      this.#set('pool-jackpot-win', _formatWholeEth(model.maxWinWei));
      this.#set('pool-status', model.maxWinWei == null
        ? 'Loading jackpot pool'
        : model.finalDraw
          ? `Level ${phase.level ?? '—'} final jackpot day; grand prize ${_formatWholeEth(model.maxWinWei)} ETH`
          : `Level ${phase.level ?? '—'} jackpot phase, day ${phase.day ?? '—'} of ${JACKPOT_DAY_CAP}; maximum next win ${_formatWholeEth(model.maxWinWei)} ETH`);
      return;
    }

    if (head) head.hidden = false;
    if (body) body.hidden = false;
    if (jackpotSummary) jackpotSummary.hidden = true;
    if (specialJackpot) {
      specialJackpot.hidden = rewardJackpot == null;
      if (rewardJackpot) {
        specialJackpot.dataset.kind = rewardJackpot.kind;
        specialJackpot.setAttribute(
          'aria-label',
          `${rewardJackpot.label.replace(/:$/, '')} ${this.querySelector('[data-el="pool-special-jackpot-countdown"]')?.textContent || ''}`.trim(),
        );
      } else {
        specialJackpot.removeAttribute('data-kind');
        specialJackpot.removeAttribute('aria-label');
      }
    }
    if (rewardJackpot) this.#set('pool-special-jackpot-label', rewardJackpot.label);
    const nextWei = goldRush?.components?.nextWei
      ?? gameState?.prizePools?.nextPrizePool
      ?? null;
    const model = poolProgressModel({ nextWei, targetWei, ratchets });
    const referenceKind = this.#set('pool-reference-kind', model.levelReady ? '' : 'GUARANTEE');
    if (referenceKind) referenceKind.hidden = model.levelReady;
    this.#set('pool-target-inline', _formatWholeEth(model.referenceWei));
    this.#set('pool-percent', _formatBarPercent(model.levelPercent));
    if (fill?.style) {
      fill.style.width = `${model.fillPercent}%`;
      const span = model.targetPercent != null && model.fillPercent > 0 && !model.levelReady
        ? Math.max(100, (model.targetPercent / model.fillPercent) * 100)
        : 100;
      fill.style.backgroundSize = `${span}% 100%`;
    }
    this.#setMarker('pool-target-marker', model.targetPercent,
      model.target == null ? 'Level guarantee' : `Level guarantee: ${_formatWholeEth(model.target)} ETH`);
    this.#setMarker('pool-growth-marker', model.growthPercent,
      model.growthTarget == null
        ? 'Over/under growth target'
        : `O/U ${_formatGrowth(model.growthLinePercent)} growth line`);
    const referenceLabel = this.querySelector('[data-el="pool-reference-label"]');
    if (referenceLabel) {
      referenceLabel.hidden = model.referencePercent == null;
      if (referenceLabel.style && model.referencePercent != null) {
        referenceLabel.style.left = `${model.referencePercent}%`;
      }
      referenceLabel.title = model.referenceWei == null
        ? 'Prize pool amount'
        : `${model.referenceKind === 'CURRENT' ? 'Current prize pool' : 'Level guarantee'}: ${_formatWholeEth(model.referenceWei)} ETH`;
    }
    if (track) {
      const aria = model.levelPercent == null ? 0 : Math.round(_clampPercent(model.levelPercent));
      track.setAttribute('aria-valuenow', String(aria));
      track.setAttribute('aria-valuetext', model.levelPercent == null
        ? 'Prize pool guarantee loading'
        : `${_formatBarPercent(model.levelPercent)} of the level guarantee`);
      track.classList?.remove('is-depleting');
      track.classList?.toggle('is-ready', model.levelReady);
      track.classList?.toggle('is-over-growth', model.growthOver);
    }
    this.#set('pool-status', model.levelReady
      ? `Level guarantee met; current prize pool ${_formatWholeEth(model.next)} ETH`
      : model.target == null || model.next == null
        ? 'Loading prize pool guarantee'
        : `${_formatBarPercent(model.levelPercent)} of guarantee`);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-pool-progress')) {
  customElements.define('app-pool-progress', AppPoolProgress);
}

export const _testing = {
  formatWholeEth: _formatWholeEth,
  formatGrowth: _formatGrowth,
};

export default AppPoolProgress;
