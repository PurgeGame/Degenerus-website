// Compact launcher for the seven scheduled Craps battles. Players set one
// reusable chip board here, then use the dense schedule rows to buy seats.

import { get, subscribe } from '../app/store.js';
import { gameDay } from '../app/game-state.js';
import { dgnBadgePath } from '../app/dgn-traits.js';
import { CHAIN, CRAPS_SCHEDULE } from '../app/chain-config.js';
import { loadCrapsReplay } from '../craps/replay-contract.js';
import { openCrapsReplayTable } from '../craps/replay-adapter.js';
import { clearPendingActions, publishPendingActions } from '../app/pending-actions.js';
import {
  CRAPS_FUTURE_DAY_PRICES,
  crapsBonusDayTerms,
  placeCrapsBonusEntry,
  readCrapsLobbySnapshot,
  readCrapsProgressivePool,
  upgradeCrapsDayWindows,
} from '../app/craps.js';
import {
  CRAPS_TABLE_OPEN_EVENT,
  formatCrapsCompactFlip,
} from './app-craps-table.js';

export const CRAPS_ENTRY_CONFIRMED_EVENT = 'degenerus:craps:entered';
export const CRAPS_BATTLES_PER_DAY = 7;

const FLIP_WEI = 10n ** 18n;
const PENDING_SOURCE = 'craps-resolutions';
const CRAPS_REPLAY_POLL_MIN_MS = 850;
const CRAPS_REPLAY_POLL_JITTER_MS = 300;
const CRAPS_REPLAY_TERMINAL_STATES = new Set(['ready', 'failed', 'build-unavailable']);

/** Keep synchronized result viewers spread around the edge's one-second cache boundary. */
export function crapsReplayPollDelay(randomValue = Math.random()) {
  const requested = Number(randomValue);
  const unit = Number.isFinite(requested)
    ? Math.max(0, Math.min(0.999999, requested))
    : 0.5;
  return CRAPS_REPLAY_POLL_MIN_MS + Math.floor(unit * (CRAPS_REPLAY_POLL_JITTER_MS + 1));
}

/** Validation/drift is terminal for this browser build; transport failures are retryable. */
export function crapsReplayFailureStatus(error) {
  const name = String(error?.name ?? '');
  const path = String(error?.path ?? '');
  const message = String(error?.message ?? '');
  const sealedDataFailure = name === 'CrapsReplayDriftError'
    || name === 'CrapsReplayValidationError'
    || path.startsWith('manifest.ruleset')
    || /unsupported (?:engine|ruleset|schema)/i.test(message)
    || (name === 'TypeError' && /^Craps replay\b/i.test(message));
  return sealedDataFailure ? 'build-unavailable' : 'retrying';
}

export function crapsReplayLoaderState(artifacts) {
  if (artifacts?.ready === true) {
    // The loader already retains immutable JSON in its bounded cache. Keep the
    // launcher state tiny instead of pinning a second validated shard per battle.
    return Object.freeze({ ready: true, status: 'ready', pointer: artifacts.pointer ?? null });
  }
  const pointer = artifacts?.pointer ?? null;
  return Object.freeze({
    ready: false,
    status: ['pending', 'settling', 'failed'].includes(pointer?.status)
      ? pointer.status
      : 'retrying',
    pointer,
  });
}

export function crapsReplayStatusCopy(loader = {}) {
  const status = String(loader?.status ?? 'checking');
  const pointer = loader?.pointer ?? null;
  const entrants = Number(pointer?.entrants);
  const resolved = Number(pointer?.resolved);
  if (status === 'pending') {
    return Number.isInteger(entrants)
      ? `Waiting to settle · ${entrants.toLocaleString('en-US')} entrants.`
      : 'Waiting to settle.';
  }
  if (status === 'settling') {
    return Number.isInteger(resolved) && Number.isInteger(entrants)
      ? `Settling · ${resolved.toLocaleString('en-US')} of ${entrants.toLocaleString('en-US')} resolved.`
      : 'Settling replay.';
  }
  if (status === 'failed') return 'Replay unavailable.';
  if (status === 'build-unavailable') return 'Replay unavailable for this build.';
  if (status === 'retrying') return 'Replay status temporarily unavailable; retrying.';
  return 'Checking sealed replay status.';
}

export function crapsResolutionSeenKey(address, battleKey, viewerBetId) {
  return [
    'craps-resolution-seen',
    CHAIN.id,
    Number(CHAIN.deployBlock || 0),
    String(address || '').toLowerCase(),
    String(battleKey || '').toLowerCase(),
    String(viewerBetId || ''),
  ].join(':');
}

function resolutionWasSeen(address, replay) {
  try {
    return localStorage.getItem(crapsResolutionSeenKey(
      address,
      replay?.battleKey,
      replay?.viewerBetId,
    )) === '1';
  } catch (_error) {
    return false;
  }
}

function markResolutionSeen(address, replay) {
  try {
    localStorage.setItem(crapsResolutionSeenKey(
      address,
      replay?.battleKey,
      replay?.viewerBetId,
    ), '1');
  } catch (_error) { /* private browsing: the result remains available next load */ }
}

function resolutionIdentity(replay) {
  return `${String(replay?.battleKey || '').toLowerCase()}:${String(replay?.viewerBetId || '')}`;
}

function positiveDay(value) {
  const day = Number(value);
  return Number.isInteger(day) && day > 0 ? day : null;
}

function closeOffsets(clock = CRAPS_SCHEDULE) {
  return Object.freeze(Array.from({ length: CRAPS_BATTLES_PER_DAY }, (_, period) => {
    if (period === 0) return clock.openerCloseSeconds + clock.clockAlignSeconds;
    if (period === CRAPS_BATTLES_PER_DAY - 1) return clock.daySeconds - clock.eventLeadSeconds;
    return clock.clockAlignSeconds + (clock.routinePeriodSeconds * period);
  }));
}

function cycleStartAt(timestampMs, clock = CRAPS_SCHEDULE) {
  const seconds = Math.floor(Number(timestampMs) / 1000);
  return Math.floor((seconds - clock.anchorSeconds) / clock.daySeconds) * clock.daySeconds
    + clock.anchorSeconds;
}

/** The deployed contract's `_currentBonusSlot` calculation, in browser time. */
export function crapsPeriodAt(timestampMs = Date.now(), clock = CRAPS_SCHEDULE) {
  const seconds = Math.floor(Number(timestampMs) / 1000);
  const elapsed = ((seconds - clock.anchorSeconds) % clock.daySeconds + clock.daySeconds) % clock.daySeconds;
  if (elapsed >= clock.daySeconds - clock.eventLeadSeconds) return CRAPS_BATTLES_PER_DAY;
  if (elapsed < clock.openerCloseSeconds + clock.clockAlignSeconds) return 0;
  return Math.min(
    CRAPS_BATTLES_PER_DAY - 1,
    1 + Math.floor((elapsed - clock.clockAlignSeconds) / clock.routinePeriodSeconds),
  );
}

export function crapsBattleCloseLabels(timestampMs = Date.now(), clock = CRAPS_SCHEDULE) {
  const start = cycleStartAt(timestampMs, clock);
  return Object.freeze(closeOffsets(clock).map((offset) => (
    new Date((start + offset) * 1000).toISOString().slice(11, 16)
  )));
}

export function crapsBattleCountdownLabel(closeAtMs, nowMs = Date.now()) {
  const totalMinutes = Math.max(0, Math.ceil((Number(closeAtMs) - Number(nowMs)) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${totalMinutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function crapsEntryState({ day = null, nowMs = Date.now() } = {}) {
  const currentPeriod = crapsPeriodAt(nowMs);
  const currentDay = positiveDay(day);
  const daySlot = currentDay == null ? null : BigInt(currentDay) * 8n;
  const closeLabels = crapsBattleCloseLabels(nowMs);
  const cycleStart = cycleStartAt(nowMs);
  const closeTimes = closeOffsets().map((offset) => (cycleStart + offset) * 1000);
  const dayEntryKind = currentPeriod === 0 ? 'day' : 'future-day';
  const dayEntryDay = currentDay == null ? null : currentDay + (dayEntryKind === 'future-day' ? 1 : 0);
  return Object.freeze({
    day: currentDay,
    currentPeriod,
    dayEntryKind,
    dayEntryDay,
    fullDayOpen: currentDay != null,
    battles: Object.freeze(Array.from({ length: CRAPS_BATTLES_PER_DAY }, (_, period) => Object.freeze({
      period,
      number: period + 1,
      closeLabel: closeLabels[period],
      closeAtMs: closeTimes[period],
      slot: daySlot == null ? null : (daySlot + BigInt(period + 1)).toString(),
      state: period < currentPeriod ? 'closed' : period === currentPeriod ? 'current' : 'upcoming',
      joinable: period >= currentPeriod,
    }))),
  });
}

/** Merge pure word-derived terms with event-published added-FLIP ceilings. */
export function crapsEntryTerms({ wordValue = 0, schedule = null } = {}) {
  let derived = null;
  try { derived = crapsBonusDayTerms(wordValue); } catch (_error) { derived = null; }
  const windows = Object.freeze(Array.from({ length: CRAPS_BATTLES_PER_DAY }, (_, period) => {
    const base = derived?.windows?.[period] ?? null;
    const live = schedule?.windows?.[period] ?? null;
    return base && live ? Object.freeze({ ...base, ...live }) : live ?? base;
  }));
  if (windows.every((window) => window == null)) return null;
  const complete = windows.every(Boolean);
  const total = (field) => complete
    ? windows.reduce((sum, window) => sum + window[field], 0n)
    : null;
  const addedReady = complete && windows.every((window) => window.addedFlipWei != null);
  const bankMultiples = windows.filter(Boolean).map((window) => window.bankMult);
  const goalMultiples = windows.filter(Boolean).map((window) => window.goalMult);
  return Object.freeze({
    complete,
    windows,
    bankrollFlip: total('bankrollFlip'),
    battleStakeFlip: total('battleStakeFlip'),
    buyInFlip: total('buyInFlip'),
    addedFlipWei: addedReady
      ? windows.reduce((sum, window) => sum + window.addedFlipWei, 0n)
      : null,
    highMult: derived?.highMult ?? windows.find(Boolean)?.highMult ?? null,
    minBankMult: bankMultiples.length ? Math.min(...bankMultiples) : null,
    maxBankMult: bankMultiples.length ? Math.max(...bankMultiples) : null,
    minGoalMult: goalMultiples.length ? Math.min(...goalMultiples) : null,
    maxGoalMult: goalMultiples.length ? Math.max(...goalMultiples) : null,
  });
}

export function crapsEntrySelection({ day = null, kind, period = null } = {}) {
  const currentDay = positiveDay(day);
  const normalizedKind = ['day', 'future-day', 'window'].includes(kind) ? kind : null;
  if (!normalizedKind) throw new Error('Choose a full-day or individual Craps entry.');
  const normalizedPeriod = normalizedKind === 'window' ? Number(period) : null;
  if (normalizedKind === 'window'
    && (!Number.isInteger(normalizedPeriod) || normalizedPeriod < 0 || normalizedPeriod >= CRAPS_BATTLES_PER_DAY)) {
    throw new Error('Choose one of the seven Craps battles.');
  }
  const entryDay = currentDay == null
    ? null
    : currentDay + (normalizedKind === 'future-day' ? 1 : 0);
  const daySlot = entryDay == null ? null : BigInt(entryDay) * 8n;
  const battleSlot = daySlot == null
    ? null
    : normalizedKind === 'window'
      ? (daySlot + BigInt(normalizedPeriod + 1)).toString()
      : daySlot.toString();
  return Object.freeze({
    entryKind: normalizedKind,
    entryDay,
    entryPeriod: normalizedPeriod,
    battleSlot,
    tableIndex: battleSlot,
    entryLabel: normalizedKind === 'window'
      ? `DAY ${entryDay ?? '—'} · BATTLE ${normalizedPeriod + 1}`
      : normalizedKind === 'future-day'
        ? `DAY ${entryDay ?? '—'} · RESERVE ALL 7 BATTLES`
        : `DAY ${entryDay ?? '—'} · ALL 7 BATTLES`,
  });
}

/** Build the exact scheduled-entry calldata and displayed burn from one lobby row. */
export function crapsEntryWager({
  day = null,
  kind,
  period = null,
  buyInFlip = null,
  highRoller = false,
  highMult = null,
  contractChips = 0,
} = {}) {
  const selection = crapsEntrySelection({ day, kind, period });
  const packed = Number(contractChips);
  if (!Number.isInteger(packed) || packed < 0 || packed > 0xFFFFFFFF) {
    throw new Error('The Craps board is not a packed uint32.');
  }
  const future = selection.entryKind === 'future-day';
  const entryMultiple = highRoller
    ? future ? null : Number(highMult)
    : 1;
  if (!future && (!Number.isInteger(entryMultiple) || entryMultiple < 1 || entryMultiple > 256)) {
    throw new Error('The High Roller multiple is not available yet.');
  }
  let base = null;
  if (!future) {
    if (buyInFlip == null) throw new Error('The Craps buy-in is not available yet.');
    try { base = BigInt(buyInFlip); } catch (_error) { base = null; }
    if (base == null || base < 0n) throw new Error('The Craps buy-in is not available yet.');
  }
  const totalFlip = future
    ? CRAPS_FUTURE_DAY_PRICES[highRoller ? 'high' : 'normal']
    : base * BigInt(entryMultiple);
  const method = future
    ? 'buyFutureCrapsDays'
    : selection.entryKind === 'day' ? 'enterBonusDay' : 'enterBonusBattle';
  const contractArgs = future
    ? [selection.entryDay, 1, Boolean(highRoller), packed]
    : selection.entryKind === 'day'
      ? [packed, entryMultiple]
      : [selection.entryPeriod, packed, entryMultiple];
  return Object.freeze({
    valid: true,
    mode: future ? 'future-day' : `bonus-${selection.entryKind}`,
    method,
    ...selection,
    entryMultiple,
    highRoller: Boolean(highRoller),
    contractChips: packed,
    contractArgs: Object.freeze(contractArgs),
    totalFlip: totalFlip.toString(),
    stakedWei: (totalFlip * FLIP_WEI).toString(),
  });
}

function currentDayFromStore() {
  return gameDay(get('app.gameState'))
    ?? positiveDay(get('app.daySync')?.day)
    ?? null;
}

function currentWordFromStore(day) {
  const state = get('app.gameState');
  if (positiveDay(gameDay(state)) !== positiveDay(day)) return 0;
  return state?.dailyRng?.finalWord ?? 0;
}

function compactWei(value) {
  if (value == null) return '—';
  let wei;
  try { wei = BigInt(value); } catch (_error) { return '—'; }
  return formatCrapsCompactFlip((wei + (FLIP_WEI / 2n)) / FLIP_WEI);
}

function compactWinner(value) {
  const address = String(value ?? '');
  return /^0x[0-9a-f]{40}$/i.test(address)
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address || '—';
}

export function crapsResolutionPendingActions({
  address,
  replays = [],
  states = new Map(),
  wasSeen = () => false,
  run = () => false,
} = {}) {
  const scope = String(address ?? '').toLowerCase();
  if (!scope || !Array.isArray(replays)) return [];
  return replays.flatMap((replay) => {
    if (wasSeen(scope, replay)) return [];
    const identity = resolutionIdentity(replay);
    const loader = states.get(identity);
    const ready = loader?.ready === true;
    const loaderStatus = String(loader?.status ?? 'checking');
    const wonMainPot = String(replay?.winner ?? '').toLowerCase() === scope;
    const detail = !ready
      ? crapsReplayStatusCopy(loader)
      : wonMainPot && replay.amountWei != null
        ? `Main pot won · ${compactWei(replay.amountWei)} FLIP. Final rewards are ready.`
        : 'Battle settled. Your roll-by-roll result and final rewards are ready.';
    const shortLabel = ready
      ? 'Watch run'
      : ['failed', 'build-unavailable'].includes(loaderStatus)
        ? 'Replay unavailable'
        : loaderStatus === 'pending'
          ? 'Waiting to settle'
          : loaderStatus === 'settling'
            ? 'Settling replay'
            : 'Checking replay';
    return [{
      id: `craps-resolution:${scope}:${identity}`,
      dismissScope: scope,
      dismissKey: identity,
      kind: 'craps',
      kindLabel: 'CRAPS FINAL',
      label: `Day ${replay.day} · Battle ${Number(replay.period) + 1}`,
      shortLabel,
      detail,
      state: ready ? 'ready' : 'waiting',
      phase: loaderStatus,
      passive: ['failed', 'build-unavailable'].includes(loaderStatus),
      autoOpen: false,
      order: 14,
      chronology: Number(replay.slot),
      run: ready ? () => run(replay, scope) : null,
    }];
  });
}

const CRAPS_GOAL_LABELS = Object.freeze({ 5: 'EASY', 10: 'HARD', 50: 'V HARD' });

export function crapsGoalLabel(value) {
  return CRAPS_GOAL_LABELS[Number(value)] ?? '—';
}

function timer(fn, milliseconds) {
  const handle = globalThis.setInterval?.(fn, milliseconds);
  if (handle && typeof handle.unref === 'function') handle.unref();
  return handle;
}

export class AppCrapsEntry extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #timer = null;
  #refreshTimer = null;
  #progressiveWei = null;
  #progressivePending = false;
  #progressiveSeq = 0;
  #schedule = null;
  #snapshot = null;
  #scheduleDay = null;
  #schedulePlayer = null;
  #schedulePending = false;
  #scheduleSeq = 0;
  #replayStates = new Map();
  #replaySeq = 0;
  #replayPollTimer = null;
  #replayLoadPending = false;
  #replayLifecycleListening = false;
  #highRoller = false;
  #boardBets = {};
  #contractChips = 0;
  #boardSet = false;
  #busyKey = null;
  #message = '';
  #storeListener = () => {
    this.#render();
    void this.#refreshSchedule();
  };
  #replayLifecycleListener = () => {
    if (!this.#replayPollingAllowed()) {
      this.#stopReplayPoll();
      return;
    }
    if (this.#replayNeedsPolling()) {
      void this.#refreshResolvedReplays(this.#snapshot?.resolvedReplays, this.#schedulePlayer);
    }
  };
  #clickListener = (event) => {
    const lane = event?.target?.closest?.('[data-craps-lane]');
    if (lane && !lane.disabled) {
      this.#highRoller = lane.dataset.crapsLane === 'high';
      this.#message = '';
      this.#render();
      return;
    }
    const board = event?.target?.closest?.('[data-craps-board]');
    if (board && !board.disabled) {
      this.#openBoard(board);
      return;
    }
    const upgrade = event?.target?.closest?.('[data-craps-upgrade]');
    if (upgrade && !upgrade.disabled) {
      void this.#upgrade(Number(upgrade.dataset.crapsUpgrade));
      return;
    }
    const button = event?.target?.closest?.('[data-craps-entry]');
    if (!button || button.disabled) return;
    const kind = button.dataset.crapsEntry;
    const period = kind === 'window' ? Number(button.dataset.crapsPeriod) : null;
    void this.#buy(kind, period);
  };

  connectedCallback() {
    if (!this.#initialized) {
      this.#initialized = true;
      this.#renderShell();
      this.addEventListener('click', this.#clickListener);
    }
    if (this.#unsubs.length === 0) {
      this.#unsubs.push(
        subscribe('app.gameState', this.#storeListener),
        subscribe('app.daySync', this.#storeListener),
        subscribe('connected.address', this.#storeListener),
      );
    }
    if (!this.#replayLifecycleListening) {
      this.#replayLifecycleListening = true;
      globalThis.document?.addEventListener?.('visibilitychange', this.#replayLifecycleListener);
      globalThis.addEventListener?.('online', this.#replayLifecycleListener);
      globalThis.addEventListener?.('offline', this.#replayLifecycleListener);
    }
    if (this.#timer == null) {
      this.#timer = timer(() => this.#render(), 60_000);
    }
    if (this.#refreshTimer == null) {
      this.#refreshTimer = timer(() => {
        void this.#refreshProgressive();
        void this.#refreshSchedule();
      }, 30_000);
    }
    this.#render();
    void this.#refreshProgressive();
    void this.#refreshSchedule();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs.splice(0)) unsubscribe?.();
    if (this.#timer != null) globalThis.clearInterval?.(this.#timer);
    if (this.#refreshTimer != null) globalThis.clearInterval?.(this.#refreshTimer);
    this.#timer = null;
    this.#refreshTimer = null;
    this.#stopReplayPoll();
    if (this.#replayLifecycleListening) {
      this.#replayLifecycleListening = false;
      globalThis.document?.removeEventListener?.('visibilitychange', this.#replayLifecycleListener);
      globalThis.removeEventListener?.('online', this.#replayLifecycleListener);
      globalThis.removeEventListener?.('offline', this.#replayLifecycleListener);
    }
    this.#progressiveSeq += 1;
    this.#scheduleSeq += 1;
    this.#replaySeq += 1;
    this.#replayLoadPending = false;
    this.#replayStates.clear();
    clearPendingActions(PENDING_SOURCE);
  }

  #renderShell() {
    this.innerHTML = `
      <section class="craps-entry" aria-labelledby="craps-entry-title">
        <header class="craps-entry__head">
          <span class="craps-entry__dice" aria-hidden="true">
            <img src="${dgnBadgePath(3, 1, 6)}" width="102" height="102" alt="">
            <img src="${dgnBadgePath(3, 4, 4)}" width="102" height="102" alt="">
          </span>
          <h2 id="craps-entry-title"><small>CRAPS</small>BATTLE</h2>
          <div class="craps-entry__progressive" data-bind="craps-progressive" data-state="loading"
               aria-label="Craps progressive jackpot amount unavailable">
            <small>JACKPOT</small><strong><output data-bind="craps-progressive-amount" aria-live="polite">—</output> <em>FLIP</em></strong>
          </div>
          <span class="craps-entry__pot-boost" data-bind="craps-added-banner" data-state="loading">
            <small data-bind="craps-added-kicker">YEST. ACTUAL BOOST · ALL POTS</small><strong><output data-bind="craps-added-total">—</output> <em>FLIP</em></strong>
          </span>
        </header>

        <div class="craps-entry__setup">
          <button type="button" class="craps-entry__board" data-craps-board>
            <span><small>YOUR PLAY</small><strong data-bind="craps-board-state">RANDOM 10-CHIP</strong></span>
            <b data-bind="craps-board-action">SET YOUR BOARD</b>
          </button>
          <div class="craps-entry__lane" role="group" aria-label="Craps entry lane">
            <button type="button" data-craps-lane="normal" aria-pressed="true">NORMAL</button>
            <button type="button" data-craps-lane="high" aria-pressed="false">HIGH ROLLER <small data-bind="craps-high-mult">—</small></button>
          </div>
        </div>

        <div class="craps-entry__lobby">
          <table class="craps-entry__listing" aria-label="Craps battle buy-ins">
            <colgroup><col class="craps-entry__col-close"><col class="craps-entry__col-buyin"><col class="craps-entry__col-mult"><col class="craps-entry__col-speed"><col class="craps-entry__col-action"></colgroup>
            <thead><tr><th>CLOSES IN</th><th>BUY-IN</th><th>GOAL</th><th>SPEED</th><th>ENTER</th></tr></thead>
            <tbody>
              <tr class="craps-entry__day-buy" data-bind="craps-day-row" data-state="open">
                <th scope="row"><small data-bind="craps-day-kicker">DAY PASS</small><strong data-bind="craps-day-title">ALL 7</strong></th>
                <td><strong data-bind="craps-full-day-buyin">—</strong><small>FLIP</small></td>
                <td data-bind="craps-full-day-goal">—</td>
                <td data-bind="craps-full-day-speed">—</td>
                <td><button type="button" data-craps-entry="day" data-terms="loading">BUY —</button></td>
              </tr>
              ${Array.from({ length: CRAPS_BATTLES_PER_DAY }, (_, period) => `
                <tr class="craps-entry__battle" data-craps-period="${period}" data-state="upcoming" data-terms="loading">
                  <th scope="row" class="craps-entry__open-cell"><time data-bind="craps-battle-countdown">—</time></th>
                  <td class="craps-entry__open-cell"><strong data-bind="craps-battle-buyin">—</strong><small>FLIP</small></td>
                  <td class="craps-entry__open-cell" data-bind="craps-battle-goal">—</td>
                  <td class="craps-entry__open-cell" data-bind="craps-battle-speed">—</td>
                  <td class="craps-entry__action craps-entry__open-cell">
                    <button type="button" data-craps-entry="window" data-craps-period="${period}">BUY —</button>
                  </td>
                  <td class="craps-entry__result" data-bind="craps-battle-result" colspan="5" hidden>
                    <span><small>WINNER</small><strong data-bind="craps-battle-winner">—</strong></span>
                    <span><small>TOTAL WON</small><strong><output data-bind="craps-battle-payout">—</output> FLIP</strong></span>
                    <span><small>BOOSTED</small><strong><output data-bind="craps-battle-boost">—</output> FLIP</strong></span>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <footer class="craps-entry__foot" data-bind="craps-entry-status" aria-live="polite">Set a board or buy in with the random draw.</footer>
      </section>`;
  }

  #termsFor(state) {
    return crapsEntryTerms({
      wordValue: currentWordFromStore(state.day),
      schedule: this.#schedule?.day === state.day ? this.#schedule : null,
    });
  }

  #render() {
    const nowMs = Date.now();
    const state = crapsEntryState({ day: currentDayFromStore(), nowMs });
    const terms = this.#termsFor(state);
    const multiple = this.#highRoller ? terms?.highMult ?? null : 1;
    const connectedPlayer = String(get('connected.address') ?? '').toLowerCase();
    const bindText = (name, value) => {
      const node = this.querySelector(`[data-bind="${name}"]`);
      if (node) node.textContent = value;
    };

    bindText('craps-board-state', this.#boardSet ? '7-CHIP BOARD' : 'RANDOM DRAW');
    bindText('craps-board-action', this.#boardSet ? 'EDIT BOARD' : 'SET YOUR BOARD');
    bindText('craps-high-mult', terms?.highMult == null ? 'DRAWN DAILY' : `TODAY ${terms.highMult}×`);
    for (const lane of this.querySelectorAll('[data-craps-lane]')) {
      const selected = (lane.dataset.crapsLane === 'high') === this.#highRoller;
      lane.setAttribute('aria-pressed', String(selected));
      lane.disabled = this.#busyKey != null;
    }
    const board = this.querySelector('[data-craps-board]');
    if (board) board.disabled = this.#busyKey != null;

    const addedBanner = this.querySelector('[data-bind="craps-added-banner"]');
    const snapshot = this.#snapshot?.day === state.day ? this.#snapshot : null;
    const playerEntries = connectedPlayer
      && snapshot?.playerEntries?.player === connectedPlayer
      ? snapshot.playerEntries
      : null;
    const addedReady = snapshot?.yesterdayAddedWei != null;
    bindText('craps-added-kicker', 'YEST. ACTUAL BOOST · ALL POTS');
    bindText('craps-added-total', addedReady
      ? `+${compactWei(snapshot.yesterdayAddedWei)}`
      : '—');
    if (addedBanner) addedBanner.dataset.state = addedReady ? 'ready' : this.#schedulePending ? 'loading' : 'unavailable';

    const futureDay = state.dayEntryKind === 'future-day';
    const dayReady = state.dayEntryDay != null && (futureDay || (terms?.complete && multiple != null));
    const dayPrice = futureDay
      ? CRAPS_FUTURE_DAY_PRICES[this.#highRoller ? 'high' : 'normal']
      : dayReady ? terms.buyInFlip * BigInt(multiple) : null;
    bindText('craps-day-kicker', futureDay ? 'NEXT SLATE' : 'DAY PASS');
    bindText('craps-day-title', 'ALL 7');
    bindText('craps-full-day-buyin', dayPrice == null ? '—' : formatCrapsCompactFlip(dayPrice));
    bindText('craps-full-day-speed', '');
    bindText('craps-full-day-goal', '');
    const dayRow = this.querySelector('[data-bind="craps-day-row"]');
    const dayButton = this.querySelector('[data-craps-entry="day"]');
    const dayTicket = state.dayEntryDay == null
      ? null
      : playerEntries?.days?.[String(state.dayEntryDay)] ?? null;
    const directCurrentEntry = !futureDay && playerEntries?.windows?.some(Boolean);
    const joinableMask = state.battles.reduce((mask, battle) => (
      battle.joinable ? mask | (1 << battle.period) : mask
    ), 0);
    const dayUpgradeMask = !futureDay && dayTicket && this.#highRoller && multiple != null
      ? joinableMask & ~(dayTicket.highMask ?? 0)
      : 0;
    const dayUpgradePrice = dayUpgradeMask && terms?.complete && multiple != null
      ? terms.windows.reduce((sum, window, period) => (
          dayUpgradeMask & (1 << period)
            ? sum + window.buyInFlip * BigInt(multiple - 1)
            : sum
        ), 0n)
      : null;
    const dayEntered = Boolean(dayTicket || directCurrentEntry);
    const dayCanUpgrade = dayUpgradeMask > 0 && dayUpgradePrice != null;
    if (dayRow) {
      dayRow.dataset.state = dayCanUpgrade ? 'upgrade' : dayEntered ? 'entered' : dayReady ? 'open' : 'loading';
    }
    if (dayButton) {
      dayButton.removeAttribute('data-craps-upgrade');
      if (dayCanUpgrade) dayButton.dataset.crapsUpgrade = String(dayUpgradeMask);
      dayButton.disabled = this.#busyKey != null || (dayEntered ? !dayCanUpgrade : !dayReady);
      dayButton.dataset.terms = dayReady ? 'ready' : 'loading';
      dayButton.dataset.state = dayCanUpgrade ? 'upgrade' : dayEntered ? 'entered' : 'buy';
      dayButton.textContent = this.#busyKey === 'day' || this.#busyKey === `upgrade-${dayUpgradeMask}`
        ? 'LOCKING…'
        : dayCanUpgrade
          ? `UPGRADE ${formatCrapsCompactFlip(dayUpgradePrice)}`
          : dayEntered
            ? directCurrentEntry && !dayTicket ? '✓ ENTERED ROWS' : '✓ ENTERED'
            : `BUY ${dayPrice == null ? '—' : formatCrapsCompactFlip(dayPrice)}`;
      dayButton.setAttribute('aria-label', dayCanUpgrade
        ? `Upgrade the remaining open battles on your day ticket for ${dayUpgradePrice} FLIP.`
        : dayEntered
          ? 'This wallet is already entered for this Craps slate.'
          : dayReady
            ? `Buy all seven Craps battles in the ${this.#highRoller ? 'High Roller' : 'Normal'} lane for ${dayPrice} FLIP. ${this.#boardSet ? 'Your seven-chip board is set.' : 'The contract will draw a random ten-chip board.'}`
            : 'Full-day Craps terms are loading');
    }

    const rows = [...this.querySelectorAll('.craps-entry__battle')];
    const currentDayTicket = state.day == null
      ? null
      : playerEntries?.days?.[String(state.day)] ?? null;
    state.battles.forEach((battle, index) => {
      const row = rows[index];
      if (!row) return;
      const battleTerms = terms?.windows?.[index] ?? null;
      const result = snapshot?.results?.[index] ?? null;
      const ready = Boolean(battleTerms && multiple != null);
      const price = ready ? battleTerms.buyInFlip * BigInt(multiple) : null;
      const directEntry = playerEntries?.windows?.[index] ?? null;
      const dayEntry = currentDayTicket ? Object.freeze({
        source: 'day',
        high: Boolean((currentDayTicket.highMask ?? 0) & (1 << index)),
      }) : null;
      const entry = directEntry ?? dayEntry;
      const upgradeMask = 1 << index;
      const canUpgrade = Boolean(
        entry?.source === 'day'
        && !entry.high
        && this.#highRoller
        && multiple != null
        && battle.joinable
        && battleTerms,
      );
      const upgradePrice = canUpgrade
        ? battleTerms.buyInFlip * BigInt(multiple - 1)
        : null;
      row.dataset.state = result ? 'completed' : battle.state;
      row.dataset.entry = entry ? entry.high ? 'high' : 'normal' : 'none';
      row.dataset.terms = ready ? 'ready' : this.#schedulePending ? 'loading' : 'unavailable';
      const close = row.querySelector('[data-bind="craps-battle-countdown"]');
      const buyIn = row.querySelector('[data-bind="craps-battle-buyin"]');
      const speed = row.querySelector('[data-bind="craps-battle-speed"]');
      const goal = row.querySelector('[data-bind="craps-battle-goal"]');
      const button = row.querySelector('[data-craps-entry="window"]');
      const resultBox = row.querySelector('[data-bind="craps-battle-result"]');
      const winner = row.querySelector('[data-bind="craps-battle-winner"]');
      const payout = row.querySelector('[data-bind="craps-battle-payout"]');
      const boost = row.querySelector('[data-bind="craps-battle-boost"]');
      for (const cell of row.querySelectorAll('.craps-entry__open-cell')) cell.hidden = Boolean(result);
      if (close) {
        close.textContent = battle.state === 'closed'
          ? 'SETTLING'
          : crapsBattleCountdownLabel(battle.closeAtMs, nowMs);
        close.dateTime = new Date(battle.closeAtMs).toISOString();
        close.title = `Closes ${battle.closeLabel} UTC`;
      }
      if (buyIn) buyIn.textContent = price == null ? '—' : formatCrapsCompactFlip(price);
      if (speed) speed.textContent = battleTerms?.speedLabel ?? '—';
      if (goal) goal.textContent = crapsGoalLabel(battleTerms?.goalMult);
      if (resultBox) resultBox.hidden = !result;
      if (winner) {
        winner.textContent = compactWinner(result?.winner);
        winner.title = result?.winner ?? '';
      }
      if (payout) payout.textContent = result ? compactWei(result.amountWei) : '—';
      if (boost) boost.textContent = result ? compactWei(result.boostWei) : '—';
      if (button) {
        button.removeAttribute('data-craps-upgrade');
        if (canUpgrade) button.dataset.crapsUpgrade = String(upgradeMask);
        button.hidden = Boolean(result);
        button.disabled = Boolean(entry && !canUpgrade)
          || !battle.joinable
          || (!canUpgrade && !ready)
          || this.#busyKey != null;
        button.dataset.state = canUpgrade ? 'upgrade' : entry ? 'entered' : 'buy';
        button.textContent = this.#busyKey === `window-${index}` || this.#busyKey === `upgrade-${upgradeMask}`
          ? 'LOCKING…'
          : canUpgrade
            ? `UPGRADE ${formatCrapsCompactFlip(upgradePrice)}`
            : entry
              ? '✓ ENTERED'
              : battle.state === 'closed'
                ? 'SETTLING'
                : `BUY ${price == null ? '—' : formatCrapsCompactFlip(price)}`;
        button.setAttribute('aria-label', entry && !canUpgrade
          ? `This wallet is entered in Battle ${battle.number}${entry.high ? ' as High Roller' : ''}.`
          : canUpgrade
            ? `Upgrade Battle ${battle.number} to High Roller for ${upgradePrice} FLIP.`
            : battle.state === 'closed'
          ? `Battle ${battle.number} is closed and settling`
          : ready
            ? `Buy into Battle ${battle.number} for ${price} FLIP. Speed ${battleTerms.speedLabel}; goal ${crapsGoalLabel(battleTerms.goalMult)}.`
            : `Battle ${battle.number}, terms loading`);
      }
    });

    const status = this.querySelector('[data-bind="craps-entry-status"]');
    if (status) {
      status.dataset.state = this.#message ? 'message' : 'idle';
      status.textContent = this.#message || (futureDay
        ? 'Today is underway. The day button reserves the next full slate; its terms draw at open.'
        : 'Buy the full slate before the first battle, or choose any individual row.');
    }
    this.#renderProgressive();
  }

  #renderProgressive() {
    const meter = this.querySelector('[data-bind="craps-progressive"]');
    const amount = this.querySelector('[data-bind="craps-progressive-amount"]');
    if (!meter || !amount) return;
    const hasAmount = this.#progressiveWei != null;
    const formatted = hasAmount ? compactWei(this.#progressiveWei) : null;
    meter.dataset.state = hasAmount ? 'live' : this.#progressivePending ? 'loading' : 'unavailable';
    amount.textContent = formatted ?? '—';
    meter.setAttribute('aria-label', hasAmount
      ? `Craps progressive jackpot ${formatted} FLIP`
      : this.#progressivePending ? 'Loading the Craps progressive jackpot' : 'Craps progressive jackpot amount unavailable');
  }

  async #refreshProgressive() {
    const seq = ++this.#progressiveSeq;
    this.#progressivePending = true;
    this.#renderProgressive();
    try {
      const amountWei = await readCrapsProgressivePool();
      if (seq !== this.#progressiveSeq) return;
      this.#progressiveWei = amountWei;
    } catch (_error) {
      // Preserve the last good number through a transient RPC failure.
    } finally {
      if (seq === this.#progressiveSeq) {
        this.#progressivePending = false;
        this.#renderProgressive();
      }
    }
  }

  async #refreshSchedule(force = false) {
    const day = currentDayFromStore();
    if (day == null) return;
    const player = String(get('connected.address') ?? '').toLowerCase() || null;
    if (!force && this.#schedulePending && this.#scheduleDay === day && this.#schedulePlayer === player) return;
    if (this.#scheduleDay !== day || this.#schedulePlayer !== player) {
      this.#schedule = null;
      this.#snapshot = null;
      this.#replaySeq += 1;
      this.#replayLoadPending = false;
      this.#stopReplayPoll();
      this.#replayStates.clear();
      clearPendingActions(PENDING_SOURCE);
    }
    this.#scheduleDay = day;
    this.#schedulePlayer = player;
    const seq = ++this.#scheduleSeq;
    this.#schedulePending = true;
    this.#render();
    try {
      const snapshot = await readCrapsLobbySnapshot(day, player);
      if (seq !== this.#scheduleSeq) return;
      if (snapshot?.day === day) {
        this.#snapshot = snapshot;
        if (snapshot.schedule?.day === day) this.#schedule = snapshot.schedule;
        void this.#refreshResolvedReplays(snapshot?.resolvedReplays, player);
      }
    } catch (_error) {
      // Buy-in, speed, and goal remain available from the committed day word;
      // retain the last good winners and historical boost through an RPC blip.
    } finally {
      if (seq === this.#scheduleSeq) {
        this.#schedulePending = false;
        this.#render();
      }
    }
  }

  #publishResolvedReplays() {
    const address = String(this.#schedulePlayer ?? '').toLowerCase();
    const replays = Array.isArray(this.#snapshot?.resolvedReplays)
      ? this.#snapshot.resolvedReplays
      : [];
    const rows = crapsResolutionPendingActions({
      address,
      replays,
      states: this.#replayStates,
      wasSeen: resolutionWasSeen,
      run: (replay, scope) => this.#openResolvedReplay(replay, scope),
    });
    publishPendingActions(PENDING_SOURCE, rows);
  }

  #replayPollingAllowed() {
    if (this.isConnected === false) return false;
    if (globalThis.document?.hidden === true) return false;
    if (globalThis.navigator?.onLine === false) return false;
    return Boolean(this.#schedulePlayer);
  }

  #replayNeedsPolling() {
    const address = String(this.#schedulePlayer ?? '').toLowerCase();
    if (!address) return false;
    const replays = Array.isArray(this.#snapshot?.resolvedReplays)
      ? this.#snapshot.resolvedReplays
      : [];
    return replays.some((replay) => {
      if (resolutionWasSeen(address, replay)) return false;
      const state = this.#replayStates.get(resolutionIdentity(replay));
      return !state || !CRAPS_REPLAY_TERMINAL_STATES.has(state.status);
    });
  }

  #stopReplayPoll() {
    if (this.#replayPollTimer != null) globalThis.clearTimeout?.(this.#replayPollTimer);
    this.#replayPollTimer = null;
  }

  #scheduleReplayPoll() {
    this.#stopReplayPoll();
    if (this.#replayLoadPending || !this.#replayPollingAllowed() || !this.#replayNeedsPolling()) return;
    this.#replayPollTimer = globalThis.setTimeout?.(() => {
      this.#replayPollTimer = null;
      void this.#refreshResolvedReplays(this.#snapshot?.resolvedReplays, this.#schedulePlayer);
    }, crapsReplayPollDelay()) ?? null;
    if (this.#replayPollTimer && typeof this.#replayPollTimer.unref === 'function') {
      this.#replayPollTimer.unref();
    }
  }

  async #refreshResolvedReplays(input, address) {
    if (this.#replayLoadPending) return;
    this.#stopReplayPoll();
    const replays = (Array.isArray(input) ? input : [])
      .filter((replay) => !resolutionWasSeen(address, replay));
    const relevant = new Set(replays.map(resolutionIdentity));
    for (const identity of this.#replayStates.keys()) {
      if (!relevant.has(identity)) this.#replayStates.delete(identity);
    }
    for (const replay of replays) {
      const identity = resolutionIdentity(replay);
      if (!this.#replayStates.has(identity)) {
        this.#replayStates.set(identity, { ready: false, status: 'checking', pointer: null });
      }
    }
    this.#publishResolvedReplays();
    if (!address || replays.length === 0) return;

    const seq = ++this.#replaySeq;
    this.#replayLoadPending = true;
    try {
      const outcomes = await Promise.all(replays.map(async (replay) => {
        const identity = resolutionIdentity(replay);
        const prior = this.#replayStates.get(identity);
        if (prior?.ready || CRAPS_REPLAY_TERMINAL_STATES.has(prior?.status)) {
          return { identity, state: prior };
        }
        try {
          const artifacts = await loadCrapsReplay({
            battleKey: replay.battleKey,
            viewerBetId: replay.viewerBetId,
          });
          return { identity, state: crapsReplayLoaderState(artifacts) };
        } catch (error) {
          return {
            identity,
            state: { ready: false, status: crapsReplayFailureStatus(error), pointer: null },
          };
        }
      }));
      if (seq !== this.#replaySeq || address !== this.#schedulePlayer) return;
      for (const { identity, state } of outcomes) this.#replayStates.set(identity, state);
      this.#publishResolvedReplays();
    } finally {
      if (seq === this.#replaySeq) {
        this.#replayLoadPending = false;
        this.#scheduleReplayPoll();
      }
    }
  }

  async #openResolvedReplay(replay, address) {
    const table = globalThis.document?.querySelector?.('app-craps-table');
    if (!table?.open) throw new Error('The Craps replay table is unavailable.');
    let result;
    try {
      result = await openCrapsReplayTable(table, {
        battleKey: replay.battleKey,
        viewerBetId: replay.viewerBetId,
        onResolutionAcknowledged: () => {
          if (resolutionWasSeen(address, replay)) return;
          markResolutionSeen(address, replay);
          this.#replayStates.delete(resolutionIdentity(replay));
          this.#publishResolvedReplays();
          this.#scheduleReplayPoll();
        },
      });
    } catch (error) {
      this.#replayStates.set(resolutionIdentity(replay), {
        ready: false,
        status: crapsReplayFailureStatus(error),
        pointer: null,
      });
      this.#publishResolvedReplays();
      this.#scheduleReplayPoll();
      return false;
    }
    if (!result.ready) {
      this.#replayStates.set(resolutionIdentity(replay), crapsReplayLoaderState(result));
      this.#publishResolvedReplays();
      this.#scheduleReplayPoll();
      return false;
    }
    return true;
  }

  #openBoard(opener) {
    const state = crapsEntryState({ day: currentDayFromStore() });
    const terms = this.#termsFor(state);
    const reference = terms?.windows?.find(Boolean) ?? null;
    const confirm = async (wager) => {
      this.#boardBets = { ...wager.chips };
      this.#contractChips = wager.contractChips;
      this.#boardSet = true;
      this.#message = 'Your seven-chip board is set for the Buy In buttons.';
      this.#render();
      return true;
    };
    globalThis.document?.dispatchEvent?.(new CustomEvent(CRAPS_TABLE_OPEN_EVENT, {
      detail: {
        opener,
        screen: 'placement',
        entryKind: 'board',
        entryLabel: this.#boardSet ? 'EDIT YOUR BOARD' : 'SET YOUR BOARD',
        bets: this.#boardBets,
        bankrollFlip: 0n,
        battleStakeFlip: 0n,
        goalFlip: 0n,
        playedFlip: reference?.playedFlip ?? 10n,
        confirm,
      },
    }));
  }

  async #upgrade(periodMask) {
    const state = crapsEntryState({ day: currentDayFromStore() });
    if (state.day == null || !Number.isInteger(periodMask) || periodMask <= 0 || periodMask > 0x7F) return;
    const busyKey = `upgrade-${periodMask}`;
    this.#busyKey = busyKey;
    this.#message = '';
    this.#render();
    try {
      const result = await upgradeCrapsDayWindows({ day: state.day, periodMask });
      const count = Array.from({ length: CRAPS_BATTLES_PER_DAY }, (_, period) => (
        periodMask & (1 << period) ? 1 : 0
      )).reduce((sum, value) => sum + value, 0);
      this.#message = `${count === 1 ? 'Battle upgraded' : `${count} battles upgraded`} to High Roller.`;
      await this.#refreshSchedule(true);
      this.dispatchEvent(new CustomEvent(CRAPS_ENTRY_CONFIRMED_EVENT, {
        detail: { kind: 'upgrade', day: state.day, periodMask, result },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this.#message = String(error?.userMessage || error?.message || 'The Craps upgrade was not submitted. Try again.');
    } finally {
      if (this.#busyKey === busyKey) this.#busyKey = null;
      this.#render();
    }
  }

  async #buy(requestedKind, period) {
    const state = crapsEntryState({ day: currentDayFromStore() });
    const kind = requestedKind === 'day' ? state.dayEntryKind : 'window';
    const battle = kind === 'window' ? state.battles[period] : null;
    if (kind === 'window' && (!battle || !battle.joinable)) return;
    const selection = crapsEntrySelection({ day: state.day, kind, period });
    const terms = this.#termsFor(state);
    const selectedTerms = kind === 'window' ? terms?.windows?.[period] : terms;
    const highMult = terms?.highMult ?? null;
    if (kind !== 'future-day' && (!selectedTerms || (this.#highRoller && highMult == null))) return;

    const baseWager = crapsEntryWager({
      day: state.day,
      kind,
      period,
      buyInFlip: kind === 'day' ? terms.buyInFlip : selectedTerms?.buyInFlip,
      highRoller: this.#highRoller,
      highMult,
      contractChips: this.#contractChips,
    });
    const wager = Object.freeze({
      ...baseWager,
      chips: { ...this.#boardBets },
    });

    const busyKey = requestedKind === 'day' ? 'day' : `window-${period}`;
    this.#busyKey = busyKey;
    this.#message = '';
    this.#render();
    try {
      const result = await placeCrapsBonusEntry(wager);
      this.#message = kind === 'future-day'
        ? `Next slate reserved in the ${this.#highRoller ? 'High Roller' : 'Normal'} lane.`
        : `${kind === 'day' ? 'Full slate' : `Battle ${period + 1}`} entered in the ${this.#highRoller ? 'High Roller' : 'Normal'} lane.`;
      await this.#refreshSchedule(true);
      this.dispatchEvent(new CustomEvent(CRAPS_ENTRY_CONFIRMED_EVENT, {
        detail: { kind, period, day: selection.entryDay, battleSlot: selection.battleSlot, wager, result },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this.#message = String(error?.userMessage || error?.message || 'Craps entry was not submitted. Try again.');
    } finally {
      if (this.#busyKey === busyKey) this.#busyKey = null;
      this.#render();
    }
  }
}

if (!customElements.get('app-craps-entry')) customElements.define('app-craps-entry', AppCrapsEntry);
