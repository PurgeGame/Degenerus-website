// Compact launcher for the seven scheduled Craps battles. Players set one
// reusable chip board here, then use the dense schedule rows to buy seats.

import { get, subscribe } from '../app/store.js';
import { gameDay } from '../app/game-state.js';
import { dgnBadgePath } from '../app/dgn-traits.js';
import { CHAIN, CRAPS_SCHEDULE } from '../app/chain-config.js';
import { loadCrapsReplay } from '../craps/replay-contract.js';
import { crapsReplayFetch } from '../craps/replay-fetch.js';
import { openCrapsReplayTable } from '../craps/replay-adapter.js';
import { clearPendingActions, publishPendingActions } from '../app/pending-actions.js';
import { fetchProfiles } from '../app/profiles.js';
import {
  CRAPS_FUTURE_DAY_FACE_RANGES,
  CRAPS_FUTURE_DAY_PRICES,
  amendCrapsSlip,
  crapsBonusDayTerms,
  crapsLobbySnapshotWithWinnerTotals,
  placeCrapsBonusEntry,
  readCrapsPassCredits,
  readCrapsLobbySnapshot,
  readCrapsProgressivePool,
  upgradeCrapsDayWindows,
} from '../app/craps.js';
import { readCrapsWinnerTotals } from '../app/craps-results.js';
import {
  CRAPS_TABLE_OPEN_EVENT,
  formatCrapsCompactFlip,
  unpackCrapsContractChips,
} from './app-craps-table.js?rev=bonus-reveal-v1';

export const CRAPS_ENTRY_CONFIRMED_EVENT = 'degenerus:craps:entered';
export const CRAPS_BATTLES_PER_DAY = 7;

const FLIP_WEI = 10n ** 18n;
const PENDING_SOURCE = 'craps-resolutions';

// Identity is decoration: a winner cell must survive the profile service being
// down, so lookups ride a swappable seam and every failure keeps the address.
let _fetchProfiles = fetchProfiles;

/** Test-only seam for the Discord identity lookup. */
export function __setCrapsProfilesForTest(impl) {
  _fetchProfiles = typeof impl === 'function' ? impl : fetchProfiles;
}
const CRAPS_REPLAY_POLL_MIN_MS = 850;
const CRAPS_REPLAY_POLL_JITTER_MS = 300;
// The sub-second cadence buys the hot window: a battle that just finalized
// while the builder is still sealing its artifacts, where the reveal should
// land the moment the pointer flips. It is the wrong steady state. A pointer
// still missing after ten seconds is not about to appear within the next one,
// and each unsettled battle was holding a 1 Hz 404 loop open indefinitely.
const CRAPS_REPLAY_POLL_FAST_ATTEMPTS = 10;
const CRAPS_REPLAY_POLL_MAX_MS = 30_000;
const CRAPS_REPLAY_TERMINAL_STATES = new Set(['ready', 'failed', 'build-unavailable']);

/**
 * Keep synchronized result viewers spread around the edge's one-second cache
 * boundary, then double away from it once the builder is clearly not close.
 */
export function crapsReplayPollDelay(randomValue = Math.random(), attempts = 0) {
  const requested = Number(randomValue);
  const unit = Number.isFinite(requested)
    ? Math.max(0, Math.min(0.999999, requested))
    : 0.5;
  const base = CRAPS_REPLAY_POLL_MIN_MS + Math.floor(unit * (CRAPS_REPLAY_POLL_JITTER_MS + 1));
  const over = Math.max(0, Math.trunc(Number(attempts) || 0) - CRAPS_REPLAY_POLL_FAST_ATTEMPTS);
  if (over === 0) return base;
  return Math.min(CRAPS_REPLAY_POLL_MAX_MS, base * (2 ** Math.min(over, 8)));
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

/** Keep public lobby results sealed while this wallet still owns an unseen replay. */
export function crapsResultNeedsReveal(result, {
  address,
  replays = [],
  wasSeen = () => false,
} = {}) {
  const scope = String(address ?? '').toLowerCase();
  const battleKey = String(result?.battleKey ?? '').toLowerCase();
  if (!scope || !battleKey || !Array.isArray(replays)) return false;
  return replays.some((replay) => (
    String(replay?.battleKey ?? '').toLowerCase() === battleKey
    && !wasSeen(scope, replay)
  ));
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

export function crapsEntryState({ day = null, nowMs = Date.now(), clock = CRAPS_SCHEDULE } = {}) {
  const currentPeriod = crapsPeriodAt(nowMs, clock);
  const currentDay = positiveDay(day);
  const daySlot = currentDay == null ? null : BigInt(currentDay) * 8n;
  const closeLabels = crapsBattleCloseLabels(nowMs, clock);
  const cycleStart = cycleStartAt(nowMs, clock);
  const closeTimes = closeOffsets(clock).map((offset) => (cycleStart + offset) * 1000);
  const nextDayAtMs = (cycleStart + clock.daySeconds) * 1000;
  // A comp must be committed one normal battle period before rollover: four
  // hours on mainnet and the equivalent scaled period on the testnet clock.
  const passCutoffAtMs = nextDayAtMs - (clock.routinePeriodSeconds * 1000);
  const dayEntryKind = currentPeriod === 0 ? 'day' : 'future-day';
  const dayEntryDay = currentDay == null ? null : currentDay + (dayEntryKind === 'future-day' ? 1 : 0);
  return Object.freeze({
    day: currentDay,
    currentPeriod,
    nextDayAtMs,
    passCutoffAtMs,
    futurePassOpen: Number(nowMs) < passCutoffAtMs,
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

/** Urgency order for the lobby: next open rows, tomorrow, then newest history. */
export function crapsLobbyRowOrder({ currentPeriod = 0, futureDay = false, settledPeriods = [] } = {}) {
  const period = Math.max(0, Math.min(CRAPS_BATTLES_PER_DAY, Math.trunc(Number(currentPeriod) || 0)));
  const settled = new Set((Array.isArray(settledPeriods) ? settledPeriods : [])
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0 && value < CRAPS_BATTLES_PER_DAY));
  const open = Array.from({ length: CRAPS_BATTLES_PER_DAY }, (_, value) => value)
    .filter((value) => value >= period && !settled.has(value));
  const history = Array.from({ length: CRAPS_BATTLES_PER_DAY }, (_, value) => value)
    .filter((value) => value < period || settled.has(value))
    .reverse();
  return Object.freeze(!futureDay && period === 0
    ? ['day', ...open, 'tomorrow', ...history]
    : [...open, 'day', ...history]);
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
  usePass = false,
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
  const paysWithPass = future && Boolean(usePass);
  const totalFlip = paysWithPass
    ? 0n
    : future
      ? CRAPS_FUTURE_DAY_PRICES[highRoller ? 'high' : 'normal']
      : base * BigInt(entryMultiple);
  const method = paysWithPass
    ? 'applyCrapsPasses'
    : future
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
    payment: paysWithPass ? 'pass' : 'flip',
    contractChips: packed,
    contractArgs: Object.freeze(contractArgs),
    totalFlip: totalFlip.toString(),
    stakedWei: (totalFlip * FLIP_WEI).toString(),
  });
}

export function crapsEntryNeedsAmend(entry, { boardSet = false, contractChips = 0 } = {}) {
  if (!boardSet || entry?.betId == null) return false;
  const selected = Number(contractChips);
  const entered = Number(entry.chips ?? 0);
  if (!Number.isInteger(selected) || selected < 0 || selected > 0xFFFFFFFF) return false;
  if (!Number.isInteger(entered) || entered < 0 || entered > 0xFFFFFFFF) return false;
  return selected !== entered;
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

/** Keep yesterday's event only across the brief gap before today's word lands. */
export function crapsPreviousEventDuringRollover({ day = null, wordValue = 0, result = null } = {}) {
  const currentDay = positiveDay(day);
  if (currentDay == null || positiveDay(result?.day) !== currentDay - 1) return null;
  let currentDayRolled = false;
  try { currentDayRolled = BigInt(wordValue ?? 0) > 0n; } catch (_error) { /* wait for valid proof */ }
  return currentDayRolled ? null : result;
}

function compactWei(value) {
  if (value == null) return '—';
  let wei;
  try { wei = BigInt(value); } catch (_error) { return '—'; }
  return formatCrapsCompactFlip((wei + (FLIP_WEI / 2n)) / FLIP_WEI);
}

/** The narrow green header chip always stays compact, including 1K–9.9K boosts. */
export function crapsHeaderBoostLabel(value) {
  if (value == null) return '—';
  let wei;
  try { wei = BigInt(value); } catch (_error) { return '—'; }
  const flip = (wei + (FLIP_WEI / 2n)) / FLIP_WEI;
  return flip.toLocaleString('en-US', {
    notation: 'compact',
    maximumSignificantDigits: 3,
  });
}

/** Paint the resolved-row boost as a compact bolt badge; prose lives in a11y/tooltip copy. */
function paintCrapsBoostMark(container, output, value) {
  const amount = compactWei(value);
  const ready = value != null && amount !== '—';
  if (output) output.textContent = ready ? `+${amount}` : '—';
  if (!container) return;
  container.hidden = !ready;
  const label = ready ? `${amount} FLIP boost included in total won` : 'Boost unavailable';
  container.setAttribute('aria-label', label);
  container.title = ready ? label : '';
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
  clearAll = null,
} = {}) {
  const scope = String(address ?? '').toLowerCase();
  if (!scope || !Array.isArray(replays)) return [];
  return replays.flatMap((replay) => {
    if (wasSeen(scope, replay)) return [];
    const identity = resolutionIdentity(replay);
    const loader = states.get(identity) ?? (replay?.finalized === false
      ? { ready: false, status: 'pending', pointer: null }
      : null);
    const ready = loader?.ready === true;
    const loaderStatus = String(loader?.status ?? 'checking');
    let entryBattleStakeWei = replay.entryBattleStakeWei ?? null;
    if (entryBattleStakeWei == null) {
      try {
        const multiple = BigInt(replay.entryMultiple ?? 1);
        const baseStake = BigInt(replay.battleStakeWei);
        entryBattleStakeWei = multiple >= 1n && multiple <= 256n
          ? (baseStake * multiple).toString()
          : replay.battleStakeWei;
      } catch (_error) { entryBattleStakeWei = replay.battleStakeWei; }
    }
    const battleStakeLabel = compactWei(entryBattleStakeWei);
    const detail = !ready
      ? crapsReplayStatusCopy(loader)
      : 'Battle settled. Open the replay to reveal your result and final rewards.';
    const shortLabel = ready
      ? 'View result'
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
      label: `${battleStakeLabel} FLIP\nBATTLE`,
      shortLabel,
      detail,
      icon: '/badges-circular/dice_04_5_silver.svg',
      iconBack: '/badges-circular/dice_01_2_blue.svg',
      compact: true,
      state: ready ? 'ready' : 'waiting',
      phase: loaderStatus,
      // Finalization can land before the sealed replay shards. Keep the same
      // owned result visible through that handoff instead of dropping it until
      // the action becomes clickable.
      pinned: true,
      passive: ['failed', 'build-unavailable'].includes(loaderStatus),
      autoOpen: false,
      order: 14,
      chronology: Number(replay.slot),
      run: ready ? () => run(replay, scope) : null,
      ...(typeof clearAll === 'function' ? { clearAll } : {}),
    }];
  });
}

const CRAPS_GOAL_LABELS = Object.freeze({ 5: 'EASY', 10: 'HARD', 20: 'HARD', 50: 'V HARD' });

export function crapsGoalLabel(value) {
  return CRAPS_GOAL_LABELS[Number(value)] ?? '—';
}

/** Pick the public main field or the High Roller side field for the active lane. */
export function crapsEntrantCountForLane(field, highRoller = false) {
  const raw = highRoller ? field?.high : field?.total;
  if (raw == null) return null;
  const count = Number(raw);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

/** Color-key a finalized winner by the comparator route sealed on-chain. */
export function crapsWinnerGoalResult(result) {
  const raw = result && typeof result === 'object' ? result.winningStop : result;
  if (raw == null) return 'unknown';
  const stop = Number(raw);
  return stop === 1 ? 'met' : stop === 0 ? 'missed' : 'unknown';
}

/** Total WAGER + BATTLE buy-in for the lane currently selected in the lobby. */
export function crapsWinnerListBuyInWei(result, highRoller = false) {
  if (result?.buyInWei == null) return null;
  let base;
  try { base = BigInt(result.buyInWei); } catch (_error) { return null; }
  if (base < 0n) return null;
  if (!highRoller) return base.toString();
  const multiple = Number(result.highMultiple);
  if (!Number.isInteger(multiple) || multiple < 1 || multiple > 256) return null;
  return (base * BigInt(multiple)).toString();
}

/** Select the on-chain winner/payment for the lane currently shown in the lobby. */
export function crapsWinnerResultForLane(result, highRoller = false) {
  if (!result || typeof result !== 'object') return null;
  if (!highRoller) return result;
  const high = result.highResult;
  if (!high || typeof high !== 'object') return null;
  let amount;
  try { amount = BigInt(high.amountWei); } catch (_error) { return null; }
  // A field of one is not a side contest. It appears as the High Roller
  // winner only when its rider returned non-zero, which is exactly the
  // contract's observable proof that the run latched its goal.
  if (high.bankrollRider && amount === 0n) return null;
  return Object.freeze({
    ...result,
    ...high,
    lane: 'high',
  });
}

/** Build a public replay request with the winning seat as the initial camera. */
export function crapsWinnerReplayRequest(result) {
  const battleKey = String(result?.battleKey ?? '').toLowerCase();
  const winner = String(result?.winner ?? '').toLowerCase();
  let viewerBetId;
  try {
    const betId = BigInt(result?.betId);
    if (betId <= 0n) return null;
    viewerBetId = betId.toString();
  } catch (_error) {
    return null;
  }
  if (!/^0x[0-9a-f]{64}$/.test(battleKey) || !/^0x[0-9a-f]{40}$/.test(winner)) return null;
  const optionalUint = (value) => {
    if (value == null) return null;
    try {
      const parsed = BigInt(value);
      return parsed >= 0n ? parsed.toString() : null;
    } catch (_error) {
      return null;
    }
  };
  const winningStop = result?.winningStop == null ? null : Number(result.winningStop);
  const bonusMultiplier = Number(result?.bonusMultiplier);
  const hasBonusMultiplier = [0.25, 1, 10, 100].includes(bonusMultiplier);
  return Object.freeze({
    battleKey,
    viewerBetId,
    settledMainPotWei: optionalUint(result?.potWei),
    battleWinner: winner,
    battleWinnerBetId: viewerBetId,
    battlePayoutWei: optionalUint(result?.amountWei),
    battleWinningStop: winningStop === 0 || winningStop === 1 ? winningStop : null,
    ...(hasBonusMultiplier ? { bonusMultiplier } : {}),
  });
}

/** Exact indexed total when known; otherwise an honest lower bound from the chain prize. */
export function crapsWinnerTotalLabel(result) {
  if (!result || typeof result !== 'object') return '—';
  if (result.totalWonWei != null) return compactWei(result.totalWonWei);
  if (result.amountWei == null) return '—';
  const knownPayment = compactWei(result.amountWei);
  return knownPayment === '—' ? '—' : `≥${knownPayment}`;
}

/** A Normal whole-day reservation still needs promotion for the selected High Roller lane. */
export function crapsDayTicketNeedsHighUpgrade(ticket, highRoller = false) {
  if (!ticket || highRoller !== true) return false;
  const highMask = Number(ticket.highMask ?? (ticket.high ? 0x7F : 0));
  return (highMask & 0x7F) !== 0x7F;
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
  #winnerTotals = [];
  #previousEventResult = null;
  #previousEventEntrants = null;
  #resolvedReplays = [];
  #profiles = new Map();
  #profileKey = '';
  #scheduleDay = null;
  #schedulePlayer = null;
  #schedulePending = false;
  #scheduleSeq = 0;
  #passCredits = null;
  #replayStates = new Map();
  #replaySeq = 0;
  #replayPollTimer = null;
  #replayLoadPending = false;
  #replayLifecycleListening = false;
  #winnerReplayTargets = new Map();
  #winnerReplayOpening = null;
  #highRoller = false;
  #boardBets = {};
  #contractChips = 0;
  #boardSet = false;
  #busyKey = null;
  #message = '';
  #forceFlipDay = false;
  #questActivationListening = false;
  #storeListener = () => {
    this.#render();
    void this.#refreshSchedule();
  };
  #replayLifecycleListener = () => {
    // Browsers can heavily throttle a background tab's interval. Refresh chain
    // truth immediately when the lobby becomes visible/online again, and use
    // force so one superseded request can never keep the rows on SETTLING.
    if (globalThis.document?.hidden !== true && globalThis.navigator?.onLine !== false) {
      void this.#refreshSchedule(true);
    }
    if (!this.#replayPollingAllowed()) {
      this.#stopReplayPoll();
      return;
    }
    if (this.#replayNeedsPolling()) {
      void this.#refreshResolvedReplays(this.#resolvedReplays, this.#schedulePlayer);
    }
  };
  #questActivateListener = (event) => {
    const questType = Number(event?.detail?.questType);
    if (questType !== 10 && questType !== 11) return;
    if (questType === 11) {
      // Buying a future day with FLIP is the qualifying level-quest action.
      // Applying a banked reward comp is still the normal payment priority,
      // but it cannot advance this particular quest because no burn occurs.
      this.#forceFlipDay = true;
      this.#highRoller = false;
      this.#message = 'CRAPS DAY QUEST · Buy the next Normal slate with FLIP; banked comps stay untouched.';
    } else {
      this.#forceFlipDay = false;
      this.#message = 'CRAPS QUEST · Choose any open paid battle.';
    }
    this.#render();
    const tomorrow = this.querySelector('[data-craps-entry="future-day"]');
    const explicitTomorrow = tomorrow && !tomorrow.closest?.('tr')?.hidden ? tomorrow : null;
    const target = questType === 11
      ? explicitTomorrow ?? this.querySelector('[data-craps-entry="day"]')
      : [...this.querySelectorAll('[data-craps-entry="window"]')].find((button) => !button.disabled && !button.hidden);
    try { target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_error) { /* detached DOM */ }
    try { target?.focus?.({ preventScroll: true }); } catch (_error) { /* detached DOM */ }
  };
  #clickListener = (event) => {
    const replay = event?.target?.closest?.('[data-craps-winner-replay]');
    if (replay && !replay.disabled) {
      void this.#openWinnerReplay(replay);
      return;
    }
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
    if (button.dataset.state === 'entered') {
      this.#openBoard(button, {
        betId: button.dataset.crapsBetId,
        chips: Number(button.dataset.crapsEntryChips ?? 0),
      });
      return;
    }
    if (button.dataset.state === 'amend') {
      void this.#amend(button);
      return;
    }
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
    if (!this.#questActivationListening) {
      this.#questActivationListening = true;
      globalThis.document?.addEventListener?.('quest:activate', this.#questActivateListener);
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
    if (this.#questActivationListening) {
      this.#questActivationListening = false;
      globalThis.document?.removeEventListener?.('quest:activate', this.#questActivateListener);
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
          <div class="craps-entry__brand">
            <span class="craps-entry__dice" aria-hidden="true">
              <img src="${dgnBadgePath(3, 1, 6)}" width="102" height="102" alt="">
              <img src="${dgnBadgePath(3, 4, 4)}" width="102" height="102" alt="">
            </span>
            <div class="craps-entry__title-lockup">
              <h2 id="craps-entry-title"><strong>CRAPS</strong><small>BATTLE</small></h2>
              <div class="craps-entry__progressive" data-bind="craps-progressive" data-state="loading"
                   aria-label="Run It Up jackpot amount unavailable">
                <span class="craps-entry__run-it-up-mark" aria-hidden="true">
                  <img src="/app/assets/craps/run-it-up-jackpot-logo-v2.webp" width="1200" height="500" loading="lazy" decoding="async" alt="">
                </span>
                <small>RUN IT UP JACKPOT</small><strong><output data-bind="craps-progressive-amount" aria-live="polite">—</output> <em>FLIP</em></strong>
              </div>
            </div>
          </div>
          <span class="craps-entry__pot-boost" data-bind="craps-added-banner" data-state="loading"
                aria-label="Yesterday's added FLIP unavailable">
            <small data-bind="craps-added-kicker">YESTERDAY</small><strong><output data-bind="craps-added-total">—</output> <em>FLIP</em></strong><small class="craps-entry__pot-boost-state">ADDED</small>
          </span>
        </header>

        <div class="craps-entry__lobby">
          <table class="craps-entry__listing" aria-label="Craps battle buy-ins">
            <colgroup><col class="craps-entry__col-close"><col class="craps-entry__col-wager"><col class="craps-entry__col-operator"><col class="craps-entry__col-battle"><col class="craps-entry__col-goal"><col class="craps-entry__col-action"><col class="craps-entry__col-entrants"></colgroup>
            <thead><tr><th>CLOSES IN</th><th class="craps-entry__wager">WAGER</th><th class="craps-entry__operator">+</th><th>BATTLE</th><th>GOAL</th><th>BUY IN</th><th>ENTRANTS</th></tr></thead>
            <tbody>
              <tr class="craps-entry__day-buy" data-bind="craps-day-row" data-state="open">
                <th scope="row" data-bind="craps-day-head"><small data-bind="craps-day-kicker">FULL DAY</small><time data-bind="craps-day-countdown">—</time></th>
                <td class="craps-entry__money craps-entry__wager" data-bind="craps-full-day-terms"><span class="craps-entry__tomorrow-layout"><strong data-bind="craps-full-day-entry">—</strong><small class="craps-entry__range-note" data-bind="craps-full-day-range-note" hidden>7 BATTLES</small></span></td>
                <td class="craps-entry__operator" data-bind="craps-full-day-separator">+</td>
                <td class="craps-entry__money craps-entry__battle-fee" data-bind="craps-full-day-pot-cell"><strong data-bind="craps-full-day-pot">—</strong></td>
                <td class="craps-entry__goal" data-bind="craps-full-day-goal">—</td>
                <td class="craps-entry__action"><button type="button" data-craps-entry="day" data-terms="loading">— FLIP</button><span class="craps-entry__entered" data-bind="craps-day-entered" hidden>ENTERED</span></td>
                <td class="craps-entry__entrants" data-bind="craps-day-entrants">—</td>
              </tr>
              ${Array.from({ length: CRAPS_BATTLES_PER_DAY }, (_, period) => `
                <tr class="craps-entry__battle" data-craps-period="${period}" data-state="upcoming" data-terms="loading">
                  <th scope="row" class="craps-entry__open-cell"><time data-bind="craps-battle-countdown">—</time></th>
                  <td class="craps-entry__money craps-entry__wager craps-entry__open-cell"><strong data-bind="craps-battle-entry">—</strong></td>
                  <td class="craps-entry__operator craps-entry__open-cell">+</td>
                  <td class="craps-entry__money craps-entry__battle-fee craps-entry__open-cell"><strong data-bind="craps-battle-pot">—</strong></td>
                  <td class="craps-entry__goal craps-entry__open-cell" data-bind="craps-battle-goal">—</td>
                  <td class="craps-entry__action craps-entry__open-cell">
                    <button type="button" data-craps-entry="window" data-craps-period="${period}">— FLIP</button>
                    <span class="craps-entry__entered" data-bind="craps-battle-entered" hidden>ENTERED</span>
                  </td>
                  <td class="craps-entry__result" data-bind="craps-battle-result" colspan="6" hidden>
                    <div class="craps-entry__result-locked" data-bind="craps-battle-result-locked" hidden>
                      <small>RESULT READY</small><strong>VIEW IN PENDING</strong>
                    </div>
                    <div class="craps-entry__result-grid" data-bind="craps-battle-result-details">
                      <span><small data-bind="craps-battle-winner-label">WINNER</small><strong data-bind="craps-battle-winner">—</strong></span>
                      <span class="craps-entry__result-total"><small>TOTAL WON</small><strong><output data-bind="craps-battle-payout">—</output><em class="craps-entry__boost-mark" data-bind="craps-battle-boost-detail" hidden><output data-bind="craps-battle-boost">—</output></em></strong></span>
                      <span class="craps-entry__result-buyin"><small>BUY IN</small><strong><output data-bind="craps-battle-buyin">—</output></strong></span>
                      <button type="button" class="craps-entry__result-replay" data-craps-winner-replay hidden aria-label="Replay from the winner's perspective" title="Watch from the winner's perspective"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="7.5" cy="6.75" r="2.75"></circle><circle cx="14" cy="6.5" r="2.25"></circle><rect x="4" y="10" width="12" height="8" rx="1.5"></rect><path d="m16 12.25 4-2v7.5l-4-2Z"></path></svg></button>
                    </div>
                  </td>
                  <td class="craps-entry__entrants" data-bind="craps-battle-entrants">—</td>
                </tr>`).join('')}
              <tr class="craps-entry__day-buy craps-entry__day-buy--tomorrow" data-bind="craps-tomorrow-row" data-state="open" hidden>
                <th scope="row"><time data-bind="craps-tomorrow-countdown">—</time></th>
                <td class="craps-entry__money craps-entry__tomorrow-range" data-bind="craps-tomorrow-terms" colspan="4"><span class="craps-entry__tomorrow-layout"><strong data-bind="craps-tomorrow-range">4.2K – 126K</strong><small>7 BATTLES</small></span></td>
                <td class="craps-entry__action"><button type="button" data-craps-entry="future-day" data-terms="loading">— FLIP</button><span class="craps-entry__entered" data-bind="craps-tomorrow-entered" hidden>ENTERED</span></td>
                <td class="craps-entry__entrants" data-bind="craps-tomorrow-entrants">—</td>
              </tr>
              <tr class="craps-entry__battle craps-entry__previous-event"
                  data-bind="craps-previous-event-row" data-state="completed" hidden>
                <td class="craps-entry__result" colspan="6">
                  <div class="craps-entry__result-locked" data-bind="craps-previous-event-result-locked" hidden>
                    <small>RESULT READY</small><strong>VIEW IN PENDING</strong>
                  </div>
                  <div class="craps-entry__result-grid" data-bind="craps-previous-event-result-details">
                    <span><small data-bind="craps-previous-event-label">YESTERDAY'S EVENT WINNER</small><strong data-bind="craps-previous-event-winner">—</strong></span>
                    <span class="craps-entry__result-total"><small>TOTAL WON</small><strong><output data-bind="craps-previous-event-payout">—</output><em class="craps-entry__boost-mark" data-bind="craps-previous-event-boost-detail" hidden><output data-bind="craps-previous-event-boost">—</output></em></strong></span>
                    <span class="craps-entry__result-buyin"><small>BUY IN</small><strong><output data-bind="craps-previous-event-buyin">—</output></strong></span>
                    <button type="button" class="craps-entry__result-replay" data-craps-winner-replay hidden aria-label="Replay from the winner's perspective" title="Watch from the winner's perspective"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="7.5" cy="6.75" r="2.75"></circle><circle cx="14" cy="6.5" r="2.25"></circle><rect x="4" y="10" width="12" height="8" rx="1.5"></rect><path d="m16 12.25 4-2v7.5l-4-2Z"></path></svg></button>
                  </div>
                </td>
                <td class="craps-entry__entrants" data-bind="craps-previous-event-entrants">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer class="craps-entry__foot">
          <span class="craps-entry__status" data-bind="craps-entry-status" aria-live="polite" hidden></span>
          <span class="craps-entry__pick-instruction">Pick your bets or choose RANDOM for 3x BONUS</span>
        </footer>

        <div class="craps-entry__setup" aria-label="Craps picks and entry lane">
          <button type="button" class="craps-entry__board" data-craps-board>
            <span><small>YOUR PICKS</small><strong data-bind="craps-board-state">RANDOM DRAW</strong></span>
            <b data-bind="craps-board-action">SET PICKS</b>
          </button>
          <div class="craps-entry__lane" role="group" aria-label="Craps entry lane">
            <button type="button" data-craps-lane="normal" aria-pressed="true"><span>NORMAL</span><strong class="craps-entry__pass-count" data-bind="craps-normal-passes" hidden>0</strong></button>
            <button type="button" data-craps-lane="high" aria-pressed="false"><span>HIGH ROLLER</span><strong class="craps-entry__pass-count" data-bind="craps-high-passes" hidden>0</strong></button>
          </div>
        </div>
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
    this.#winnerReplayTargets.clear();
    const futureDay = state.dayEntryKind === 'future-day';
    const dayEntryDay = state.dayEntryDay;
    const bindText = (name, value) => {
      const node = this.querySelector(`[data-bind="${name}"]`);
      if (node) node.textContent = value;
    };
    const bindEntryTarget = (button, entry) => {
      if (!button) return;
      if (entry?.betId != null) {
        button.dataset.crapsBetId = String(entry.betId);
        button.dataset.crapsEntryChips = String(Number(entry.chips ?? 0) >>> 0);
      } else {
        button.removeAttribute('data-craps-bet-id');
        button.removeAttribute('data-craps-entry-chips');
      }
    };
    const needsAmend = (entry) => crapsEntryNeedsAmend(entry, {
      boardSet: this.#boardSet,
      contractChips: this.#contractChips,
    });

    bindText('craps-board-state', this.#boardSet ? '7-CHIP BOARD' : 'RANDOM DRAW');
    bindText('craps-board-action', this.#boardSet ? 'EDIT PICKS' : 'SET PICKS');
    const normalPasses = Number(this.#passCredits?.normal ?? 0);
    const highPasses = Number(this.#passCredits?.high ?? 0);
    const paintPassCount = (name, count) => {
      const node = this.querySelector(`[data-bind="${name}"]`);
      if (!node) return;
      node.hidden = count <= 0;
      node.textContent = count.toLocaleString('en-US');
    };
    paintPassCount('craps-normal-passes', normalPasses);
    paintPassCount('craps-high-passes', highPasses);
    for (const lane of this.querySelectorAll('[data-craps-lane]')) {
      const selected = (lane.dataset.crapsLane === 'high') === this.#highRoller;
      const laneHigh = lane.dataset.crapsLane === 'high';
      const count = laneHigh ? highPasses : normalPasses;
      lane.setAttribute('aria-pressed', String(selected));
      lane.setAttribute('aria-label', `${laneHigh ? 'High Roller' : 'Normal'} Craps lane${count > 0 ? `, ${count.toLocaleString('en-US')} ${count === 1 ? 'comp' : 'comps'} available` : ''}`);
      lane.disabled = this.#busyKey != null;
    }
    const board = this.querySelector('[data-craps-board]');
    if (board) board.disabled = this.#busyKey != null;

    const addedBanner = this.querySelector('[data-bind="craps-added-banner"]');
    const snapshot = this.#snapshot?.day === state.day ? this.#snapshot : null;
    const dayEntrants = (entryDay) => crapsEntrantCountForLane({
      total: snapshot?.entrants?.days?.[String(entryDay)],
      high: snapshot?.entrants?.highDays?.[String(entryDay)],
    }, this.#highRoller);
    const playerEntries = connectedPlayer
      && snapshot?.playerEntries?.player === connectedPlayer
      ? snapshot.playerEntries
      : null;
    const addedReady = snapshot?.yesterdayAddedWei != null;
    bindText('craps-added-kicker', 'YESTERDAY');
    bindText('craps-added-total', addedReady
      ? crapsHeaderBoostLabel(snapshot.yesterdayAddedWei)
      : '—');
    if (addedBanner) {
      addedBanner.dataset.state = addedReady ? 'ready' : this.#schedulePending ? 'loading' : 'unavailable';
      addedBanner.setAttribute('aria-label', addedReady
        ? `Yesterday added ${compactWei(snapshot.yesterdayAddedWei)} FLIP across all Craps pots`
        : this.#schedulePending ? 'Loading yesterday\'s added FLIP' : 'Yesterday\'s added FLIP unavailable');
    }

    const selectedPasses = this.#highRoller ? highPasses : normalPasses;
    const passInventoryReady = !connectedPlayer || this.#passCredits != null;
    const compEligible = state.futurePassOpen && !this.#forceFlipDay;
    const usePass = futureDay && compEligible && selectedPasses > 0;
    const dayReady = dayEntryDay != null
      && (futureDay || (terms?.complete && multiple != null))
      && (!futureDay || !compEligible || passInventoryReady);
    const dayPrice = futureDay
      ? CRAPS_FUTURE_DAY_PRICES[this.#highRoller ? 'high' : 'normal']
      : dayReady ? terms.buyInFlip * BigInt(multiple) : null;
    const dayEntry = !futureDay && dayReady ? terms.bankrollFlip * BigInt(multiple) : null;
    const dayBattle = !futureDay && dayReady ? terms.battleStakeFlip * BigInt(multiple) : null;
    const futureFaceRange = CRAPS_FUTURE_DAY_FACE_RANGES[this.#highRoller ? 'high' : 'normal'];
    const compactRange = (range) => `${formatCrapsCompactFlip(range.low)} – ${formatCrapsCompactFlip(range.high)}`;
    const dayKicker = this.querySelector('[data-bind="craps-day-kicker"]');
    if (dayKicker) {
      dayKicker.hidden = futureDay;
      dayKicker.textContent = 'FULL DAY';
    }
    // Today's full slate closes with Battle 1. Once that closes, the same cell
    // counts to the next protocol-day rollover instead of switching to a vague
    // TOMORROW label.
    const dayCountdown = this.querySelector('[data-bind="craps-day-countdown"]');
    if (dayCountdown) {
      const opener = state.battles[0] ?? null;
      const closesAtMs = futureDay ? state.nextDayAtMs : opener?.closeAtMs;
      dayCountdown.textContent = closesAtMs == null
        ? '—'
        : crapsBattleCountdownLabel(closesAtMs, nowMs);
      if (closesAtMs != null) {
        dayCountdown.dateTime = new Date(closesAtMs).toISOString();
        dayCountdown.title = futureDay
          ? `Next day rolls ${new Date(closesAtMs).toISOString().slice(11, 16)} UTC`
          : `Closes ${opener.closeLabel} UTC`;
      }
    }
    // Tomorrow's word has not been drawn, so its row abandons the WAGER + BATTLE
    // columns: one spanned cell carries the combined face-cost range instead of
    // two per-column ranges pretending to be independent draws.
    const combinedTomorrowRange = `Tomorrow's ${this.#highRoller ? 'High Roller' : 'Normal'} slate draws a combined seven-battle buy-in between ${futureFaceRange.low.toLocaleString('en-US')} and ${futureFaceRange.high.toLocaleString('en-US')} FLIP.`;
    bindText('craps-full-day-entry', futureDay
      ? compactRange(futureFaceRange)
      : dayEntry == null ? '—' : formatCrapsCompactFlip(dayEntry));
    bindText('craps-full-day-separator', '+');
    bindText('craps-full-day-pot', dayBattle == null ? '—' : formatCrapsCompactFlip(dayBattle));
    bindText('craps-full-day-goal', futureDay ? '' : 'ALL 7');
    const fullDayHead = this.querySelector('[data-bind="craps-day-head"]');
    const fullDayTerms = this.querySelector('[data-bind="craps-full-day-terms"]');
    const fullDayRangeNote = this.querySelector('[data-bind="craps-full-day-range-note"]');
    const fullDaySeparator = this.querySelector('[data-bind="craps-full-day-separator"]');
    const fullDayPotCell = this.querySelector('[data-bind="craps-full-day-pot-cell"]');
    const fullDayGoalCell = this.querySelector('[data-bind="craps-full-day-goal"]');
    // The rollover timer uses the normal CLOSES IN column. Tomorrow's combined
    // range then spans all four term columns without repeating micro-labels.
    if (fullDayHead) fullDayHead.colSpan = 1;
    if (fullDayTerms) {
      fullDayTerms.colSpan = futureDay ? 4 : 1;
      fullDayTerms.classList.toggle('craps-entry__tomorrow-range', futureDay);
      fullDayTerms.setAttribute('aria-label', futureDay
        ? combinedTomorrowRange
        : `Wager ${dayEntry?.toLocaleString?.('en-US') ?? 'unknown'} plus Battle fee ${dayBattle?.toLocaleString?.('en-US') ?? 'unknown'} FLIP.`);
    }
    if (fullDayRangeNote) fullDayRangeNote.hidden = !futureDay;
    if (fullDaySeparator) fullDaySeparator.hidden = futureDay;
    if (fullDayPotCell) fullDayPotCell.hidden = futureDay;
    if (fullDayGoalCell) fullDayGoalCell.hidden = futureDay;
    const selectedDayEntrants = dayEntrants(dayEntryDay);
    bindText('craps-day-entrants', selectedDayEntrants == null
      ? '—'
      : selectedDayEntrants.toLocaleString('en-US'));
    const dayRow = this.querySelector('[data-bind="craps-day-row"]');
    const dayButton = this.querySelector('[data-craps-entry="day"]');
    const dayEnteredStatus = this.querySelector('[data-bind="craps-day-entered"]');
    const dayTicket = dayEntryDay == null
      ? null
      : playerEntries?.days?.[String(dayEntryDay)] ?? null;
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
    // Future reservations cannot be upgraded until their word opens the seven
    // window terms on-chain. Still surface the selected-lane mismatch instead
    // of claiming that a Normal ticket is already entered as High Roller.
    const dayUpgradeWhenOpen = Boolean(
      futureDay && crapsDayTicketNeedsHighUpgrade(dayTicket, this.#highRoller),
    );
    const plainDayEntered = dayEntered && !dayCanUpgrade && !dayUpgradeWhenOpen;
    const dayAmendOpen = dayTicket?.day > state.day || Boolean(state.battles[0]?.joinable);
    const dayAmendable = plainDayEntered && dayTicket?.betId != null && dayAmendOpen;
    const dayNeedsAmend = dayAmendable && needsAmend(dayTicket);
    if (dayRow) {
      dayRow.dataset.state = dayCanUpgrade || dayUpgradeWhenOpen
        ? 'upgrade'
        : dayEntered ? 'entered' : dayReady ? 'open' : 'loading';
      dayRow.dataset.payment = usePass ? 'pass' : 'flip';
    }
    if (dayButton) {
      dayButton.removeAttribute('data-craps-upgrade');
      if (dayCanUpgrade) dayButton.dataset.crapsUpgrade = String(dayUpgradeMask);
      bindEntryTarget(dayButton, dayTicket);
      dayButton.hidden = plainDayEntered && !dayAmendable;
      dayButton.disabled = this.#busyKey != null
        || dayUpgradeWhenOpen
        || (dayEntered ? !dayCanUpgrade && !dayAmendable : !dayReady);
      dayButton.dataset.terms = dayReady ? 'ready' : 'loading';
      dayButton.dataset.state = dayCanUpgrade || dayUpgradeWhenOpen
        ? 'upgrade'
        : dayAmendable
          ? dayNeedsAmend ? 'amend' : 'entered'
          : dayEntered ? 'entered' : usePass ? 'pass' : 'buy';
      const dayBusy = this.#busyKey === 'day'
        || this.#busyKey === `upgrade-${dayUpgradeMask}`
        || this.#busyKey === `amend-${dayTicket?.betId}`;
      dayButton.textContent = dayBusy
        ? this.#busyKey?.startsWith?.('amend-') ? 'AMENDING…' : 'ENTERING…'
        : dayCanUpgrade
          ? `UPGRADE ${formatCrapsCompactFlip(dayUpgradePrice)}`
          : dayUpgradeWhenOpen
            ? 'UPGRADE WHEN OPEN'
          : dayAmendable
            ? dayNeedsAmend ? 'AMEND ENTRY' : 'ENTERED'
            : dayEntered
              ? 'ENTERED'
            : usePass
              ? '1 COMP'
              : `${dayPrice == null ? '—' : formatCrapsCompactFlip(dayPrice)} FLIP`;
      dayButton.setAttribute('aria-label', dayCanUpgrade
        ? `Upgrade the remaining open battles on your day ticket for ${dayUpgradePrice} FLIP.`
        : dayUpgradeWhenOpen
          ? 'This is a Normal reservation. Its High Roller upgrade becomes available when that day opens and its exact terms land on-chain.'
        : dayAmendable
          ? dayNeedsAmend
            ? 'Amend this Craps slate with the changed chip placement.'
            : 'Entered in this Craps slate. Edit its chip placement.'
          : dayEntered
            ? 'This wallet is already entered for this Craps slate.'
          : dayReady
            ? usePass
              ? `Use one ${this.#highRoller ? 'High Roller' : 'Normal'} Craps comp to reserve all seven battles. ${selectedPasses.toLocaleString('en-US')} ${selectedPasses === 1 ? 'comp' : 'comps'} available. ${this.#boardSet ? 'Your board is set.' : 'The contract will draw a random ten-chip board.'}`
              : `Buy all seven Craps battles in the ${this.#highRoller ? 'High Roller' : 'Normal'} lane for ${dayPrice} FLIP. ${this.#boardSet ? 'Your board is set.' : 'The contract will draw a random ten-chip board.'}`
            : 'Full-day Craps terms are loading');
    }
    if (dayEnteredStatus) dayEnteredStatus.hidden = !plainDayEntered || dayAmendable;

    // Before Battle 1, today's live all-seven entry stays at the top while a
    // second, blind reservation for tomorrow remains available at the bottom.
    const tomorrowRow = this.querySelector('[data-bind="craps-tomorrow-row"]');
    const tomorrowButton = this.querySelector('[data-craps-entry="future-day"]');
    const tomorrowEnteredStatus = this.querySelector('[data-bind="craps-tomorrow-entered"]');
    const showTomorrow = !futureDay && state.day != null;
    const tomorrowDay = state.day == null ? null : state.day + 1;
    const tomorrowTicket = tomorrowDay == null
      ? null
      : playerEntries?.days?.[String(tomorrowDay)] ?? null;
    const tomorrowUsePass = showTomorrow && compEligible && selectedPasses > 0;
    const tomorrowReady = showTomorrow
      && tomorrowDay != null
      && (!compEligible || passInventoryReady);
    const tomorrowUpgradeWhenOpen = Boolean(
      showTomorrow && crapsDayTicketNeedsHighUpgrade(tomorrowTicket, this.#highRoller),
    );
    const tomorrowAmendable = Boolean(
      showTomorrow && tomorrowTicket?.betId != null && !tomorrowUpgradeWhenOpen,
    );
    const tomorrowNeedsAmend = tomorrowAmendable && needsAmend(tomorrowTicket);
    const tomorrowPrice = CRAPS_FUTURE_DAY_PRICES[this.#highRoller ? 'high' : 'normal'];
    bindText('craps-tomorrow-range', compactRange(futureFaceRange));
    const tomorrowCountdown = this.querySelector('[data-bind="craps-tomorrow-countdown"]');
    if (tomorrowCountdown) {
      tomorrowCountdown.textContent = crapsBattleCountdownLabel(state.nextDayAtMs, nowMs);
      tomorrowCountdown.dateTime = new Date(state.nextDayAtMs).toISOString();
      tomorrowCountdown.title = `Next day rolls ${new Date(state.nextDayAtMs).toISOString().slice(11, 16)} UTC`;
    }
    const tomorrowTerms = this.querySelector('[data-bind="craps-tomorrow-terms"]');
    if (tomorrowTerms) tomorrowTerms.setAttribute('aria-label', combinedTomorrowRange);
    const tomorrowEntrants = dayEntrants(tomorrowDay);
    bindText('craps-tomorrow-entrants', tomorrowEntrants == null
      ? '—'
      : tomorrowEntrants.toLocaleString('en-US'));
    if (tomorrowRow) {
      tomorrowRow.hidden = !showTomorrow;
      tomorrowRow.dataset.state = tomorrowUpgradeWhenOpen
        ? 'upgrade'
        : tomorrowTicket ? 'entered' : tomorrowReady ? 'open' : 'loading';
      tomorrowRow.dataset.payment = tomorrowUsePass ? 'pass' : 'flip';
    }
    if (tomorrowButton) {
      bindEntryTarget(tomorrowButton, tomorrowTicket);
      tomorrowButton.hidden = !showTomorrow || Boolean(tomorrowTicket && !tomorrowAmendable);
      tomorrowButton.disabled = !showTomorrow
        || this.#busyKey != null
        || tomorrowUpgradeWhenOpen
        || (!tomorrowTicket && !tomorrowReady);
      tomorrowButton.dataset.terms = tomorrowReady ? 'ready' : 'loading';
      tomorrowButton.dataset.state = tomorrowUpgradeWhenOpen
        ? 'upgrade'
        : tomorrowAmendable
        ? tomorrowNeedsAmend ? 'amend' : 'entered'
        : tomorrowTicket ? 'entered' : tomorrowUsePass ? 'pass' : 'buy';
      const tomorrowBusy = this.#busyKey === 'future-day'
        || this.#busyKey === `amend-${tomorrowTicket?.betId}`;
      tomorrowButton.textContent = tomorrowBusy
        ? this.#busyKey?.startsWith?.('amend-') ? 'AMENDING…' : 'ENTERING…'
        : tomorrowUpgradeWhenOpen
          ? 'UPGRADE WHEN OPEN'
        : tomorrowAmendable
          ? tomorrowNeedsAmend ? 'AMEND ENTRY' : 'ENTERED'
          : tomorrowTicket
            ? 'ENTERED'
          : tomorrowUsePass
            ? '1 COMP'
            : `${formatCrapsCompactFlip(tomorrowPrice)} FLIP`;
      tomorrowButton.setAttribute('aria-label', tomorrowAmendable
        ? tomorrowNeedsAmend
          ? 'Amend tomorrow\'s Craps slate with the changed chip placement.'
          : 'Entered in tomorrow\'s Craps slate. Edit its chip placement.'
        : tomorrowUpgradeWhenOpen
          ? 'This is a Normal reservation. Its High Roller upgrade becomes available when tomorrow opens and its exact terms land on-chain.'
        : tomorrowTicket
          ? 'This wallet is already entered for tomorrow\'s Craps slate.'
        : tomorrowReady
          ? tomorrowUsePass
            ? `Use one ${this.#highRoller ? 'High Roller' : 'Normal'} Craps comp to reserve tomorrow's seven battles. ${selectedPasses.toLocaleString('en-US')} ${selectedPasses === 1 ? 'comp' : 'comps'} available.`
            : `Reserve tomorrow's seven Craps battles in the ${this.#highRoller ? 'High Roller' : 'Normal'} lane for ${tomorrowPrice} FLIP.`
          : 'Tomorrow\'s Craps comp balance is loading.');
    }
    if (tomorrowEnteredStatus) {
      tomorrowEnteredStatus.hidden = !showTomorrow
        || !tomorrowTicket
        || tomorrowAmendable
        || tomorrowUpgradeWhenOpen;
    }

    // The lobby physically moves rows into urgency order after every render.
    // Never let that DOM order become battle identity on the next render:
    // Firefox and Chrome can run a different number of async renders between
    // minute boundaries, which previously painted period 0's winner into an
    // arbitrary row and left the real row displaying SETTLING forever.
    const rowsByPeriod = new Map([...this.querySelectorAll('.craps-entry__battle[data-craps-period]')]
      .map((row) => [Number(row.dataset.crapsPeriod), row]));
    const rows = Array.from(
      { length: CRAPS_BATTLES_PER_DAY },
      (_, period) => rowsByPeriod.get(period),
    );
    const currentDayTicket = state.day == null
      ? null
      : playerEntries?.days?.[String(state.day)] ?? null;
    state.battles.forEach((battle, index) => {
      const row = rows[index];
      if (!row) return;
      const battleTerms = terms?.windows?.[index] ?? null;
      const result = snapshot?.results?.[index] ?? null;
      const laneResult = crapsWinnerResultForLane(result, this.#highRoller);
      const concealed = Boolean(result && this.#resultNeedsReveal(result));
      const ready = Boolean(battleTerms && multiple != null);
      const price = ready ? battleTerms.buyInFlip * BigInt(multiple) : null;
      const entryPrice = ready ? battleTerms.bankrollFlip * BigInt(multiple) : null;
      const battlePrice = ready ? battleTerms.battleStakeFlip * BigInt(multiple) : null;
      const directEntry = playerEntries?.windows?.[index] ?? null;
      const dayEntry = currentDayTicket ? Object.freeze({
        source: 'day',
        high: Boolean((currentDayTicket.highMask ?? 0) & (1 << index)),
        betId: currentDayTicket.betId,
        chips: currentDayTicket.chips,
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
      const amendOpen = entry?.source === 'day'
        ? Boolean(state.battles[0]?.joinable)
        : battle.joinable;
      const amendable = Boolean(entry?.betId != null && !canUpgrade && amendOpen);
      const entryNeedsAmend = amendable && needsAmend(entry);
      row.dataset.state = result ? 'completed' : battle.state;
      row.dataset.goalResult = concealed
        ? 'pending'
        : laneResult ? crapsWinnerGoalResult(laneResult) : result ? 'unknown' : 'pending';
      row.dataset.resultVisibility = concealed ? 'concealed' : result ? 'revealed' : 'pending';
      row.dataset.entry = entry ? entry.high ? 'high' : 'normal' : 'none';
      row.dataset.terms = ready ? 'ready' : this.#schedulePending ? 'loading' : 'unavailable';
      const close = row.querySelector('[data-bind="craps-battle-countdown"]');
      const entryPriceNode = row.querySelector('[data-bind="craps-battle-entry"]');
      const potPriceNode = row.querySelector('[data-bind="craps-battle-pot"]');
      const goal = row.querySelector('[data-bind="craps-battle-goal"]');
      const entrantNode = row.querySelector('[data-bind="craps-battle-entrants"]');
      const button = row.querySelector('[data-craps-entry="window"]');
      const enteredStatus = row.querySelector('[data-bind="craps-battle-entered"]');
      const resultBox = row.querySelector('[data-bind="craps-battle-result"]');
      const resultLocked = row.querySelector('[data-bind="craps-battle-result-locked"]');
      const resultDetails = row.querySelector('[data-bind="craps-battle-result-details"]');
      const winner = row.querySelector('[data-bind="craps-battle-winner"]');
      const winnerLabel = row.querySelector('[data-bind="craps-battle-winner-label"]');
      const payout = row.querySelector('[data-bind="craps-battle-payout"]');
      const boost = row.querySelector('[data-bind="craps-battle-boost"]');
      const boostDetail = row.querySelector('[data-bind="craps-battle-boost-detail"]');
      const resultBuyIn = row.querySelector('[data-bind="craps-battle-buyin"]');
      const replayButton = row.querySelector('[data-craps-winner-replay]');
      for (const cell of row.querySelectorAll('.craps-entry__open-cell')) cell.hidden = Boolean(result);
      if (close) {
        close.textContent = battle.state === 'closed'
          ? 'SETTLING'
          : crapsBattleCountdownLabel(battle.closeAtMs, nowMs);
        close.dateTime = new Date(battle.closeAtMs).toISOString();
        close.title = `Closes ${battle.closeLabel} UTC`;
      }
      if (entryPriceNode) entryPriceNode.textContent = entryPrice == null ? '—' : formatCrapsCompactFlip(entryPrice);
      if (potPriceNode) potPriceNode.textContent = battlePrice == null ? '—' : formatCrapsCompactFlip(battlePrice);
      if (goal) {
        const goalLabel = crapsGoalLabel(battleTerms?.goalMult);
        goal.textContent = goalLabel;
        goal.dataset.difficulty = goalLabel === 'EASY'
          ? 'easy'
          : goalLabel.includes('HARD') ? 'hard' : 'unknown';
      }
      if (entrantNode) {
        const field = snapshot?.entrants?.windows?.[index] ?? null;
        const shown = crapsEntrantCountForLane(field, this.#highRoller);
        const known = shown != null;
        entrantNode.textContent = known ? shown.toLocaleString('en-US') : '—';
        entrantNode.dataset.lane = this.#highRoller ? 'high' : 'main';
        if (known) {
          const dayCount = Number(this.#highRoller ? field?.dayHigh : field?.day) || 0;
          const pot = field?.mainPotStakeWei == null ? null : compactWei(field.mainPotStakeWei);
          const detail = (this.#highRoller ? [
            `${shown.toLocaleString('en-US')} High Roller ${shown === 1 ? 'entrant' : 'entrants'}`,
            dayCount > 0 ? `includes ${dayCount.toLocaleString('en-US')} High Roller full-day ${dayCount === 1 ? 'seat' : 'seats'}` : null,
            'High Roller side field only',
          ] : [
            `${shown.toLocaleString('en-US')} ${shown === 1 ? 'entrant' : 'entrants'}`,
            pot == null ? null : `${pot} FLIP staked in the main pot`,
            dayCount > 0 ? `includes ${dayCount.toLocaleString('en-US')} full-day ${dayCount === 1 ? 'seat' : 'seats'}` : null,
            'each High Roller contributes one main-pot stake',
          ]).filter(Boolean).join(' · ');
          entrantNode.title = detail;
          entrantNode.setAttribute('aria-label', detail);
        } else {
          entrantNode.title = '';
          entrantNode.setAttribute('aria-label', 'Craps entrants loading');
        }
      }
      if (resultBox) resultBox.hidden = !result;
      if (resultLocked) resultLocked.hidden = !concealed;
      if (resultDetails) resultDetails.hidden = concealed;
      if (winnerLabel) {
        winnerLabel.textContent = 'WINNER';
        winnerLabel.setAttribute('aria-label', this.#highRoller ? 'High Roller winner' : 'Winner');
      }
      this.#paintWinner(winner, concealed
        ? null
        : laneResult?.winner ?? (result && this.#highRoller ? 'NO WINNER' : null));
      if (payout) {
        payout.textContent = laneResult && !concealed ? crapsWinnerTotalLabel(laneResult) : '—';
        payout.title = laneResult && !concealed && laneResult.totalWonWei == null && laneResult.amountWei != null
          ? 'Known on-chain winner payment; exact total is still loading.'
          : '';
      }
      paintCrapsBoostMark(
        boostDetail,
        boost,
        laneResult && !concealed ? laneResult.winnerBoostWei : null,
      );
      if (resultBuyIn) {
        resultBuyIn.textContent = laneResult && !concealed
          ? compactWei(crapsWinnerListBuyInWei(laneResult, this.#highRoller))
          : '—';
      }
      this.#bindWinnerReplay(
        replayButton,
        concealed ? null : laneResult,
        `Battle ${battle.number}`,
      );
      if (concealed) {
        row.setAttribute('aria-label', `Battle ${battle.number} result ready; view it in Pending to reveal`);
      } else {
        row.removeAttribute('aria-label');
      }
      if (button) {
        button.removeAttribute('data-craps-upgrade');
        if (canUpgrade) button.dataset.crapsUpgrade = String(upgradeMask);
        bindEntryTarget(button, entry);
        button.hidden = Boolean(result) || Boolean(entry && !canUpgrade && !amendable);
        button.disabled = this.#busyKey != null
          || (entry
            ? !canUpgrade && !amendable
            : !battle.joinable || !ready);
        button.dataset.state = canUpgrade
          ? 'upgrade'
          : amendable
            ? entryNeedsAmend ? 'amend' : 'entered'
            : entry ? 'entered' : 'buy';
        const entryBusy = this.#busyKey === `window-${index}`
          || this.#busyKey === `upgrade-${upgradeMask}`
          || this.#busyKey === `amend-${entry?.betId}`;
        button.textContent = entryBusy
          ? this.#busyKey?.startsWith?.('amend-') ? 'AMENDING…' : 'ENTERING…'
          : canUpgrade
            ? `UPGRADE ${formatCrapsCompactFlip(upgradePrice)}`
            : amendable
              ? entryNeedsAmend ? 'AMEND ENTRY' : 'ENTERED'
              : entry
                ? 'ENTERED'
              : battle.state === 'closed'
                ? 'SETTLING'
                : `${price == null ? '—' : formatCrapsCompactFlip(price)} FLIP`;
        button.setAttribute('aria-label', amendable
          ? entryNeedsAmend
            ? `Amend Battle ${battle.number} with the changed chip placement.`
            : `Entered in Battle ${battle.number}${entry.high ? ' as High Roller' : ''}. Edit its chip placement.`
          : entry && !canUpgrade
            ? `This wallet is entered in Battle ${battle.number}${entry.high ? ' as High Roller' : ''}.`
          : canUpgrade
            ? `Upgrade Battle ${battle.number} to High Roller for ${upgradePrice} FLIP.`
            : battle.state === 'closed'
              ? `Battle ${battle.number} is closed and settling`
              : ready
                ? `Enter Battle ${battle.number} for ${price} FLIP: ${entryPrice} FLIP wager plus ${battlePrice} FLIP battle fee; goal ${crapsGoalLabel(battleTerms.goalMult)}.`
                : `Battle ${battle.number}, terms loading`);
      }
      if (enteredStatus) enteredStatus.hidden = Boolean(result) || !entry || canUpgrade || amendable;
    });

    const previousEvent = crapsPreviousEventDuringRollover({
      day: state.day,
      wordValue: currentWordFromStore(state.day),
      result: snapshot?.yesterdayEventResult ?? this.#previousEventResult,
    });
    const previousEventEntrants = snapshot?.entrants?.previousEvent ?? this.#previousEventEntrants;
    const previousEventLaneResult = crapsWinnerResultForLane(previousEvent, this.#highRoller);
    const previousEventConcealed = Boolean(previousEvent && this.#resultNeedsReveal(previousEvent));
    const previousEventRow = this.querySelector('[data-bind="craps-previous-event-row"]');
    const previousEventWinner = this.querySelector('[data-bind="craps-previous-event-winner"]');
    const previousEventLocked = this.querySelector('[data-bind="craps-previous-event-result-locked"]');
    const previousEventDetails = this.querySelector('[data-bind="craps-previous-event-result-details"]');
    const previousEventEntrantNode = this.querySelector('[data-bind="craps-previous-event-entrants"]');
    const previousEventReplay = this.querySelector('.craps-entry__previous-event [data-craps-winner-replay]');
    if (previousEventRow) {
      previousEventRow.hidden = !previousEvent;
      previousEventRow.dataset.day = previousEvent ? String(previousEvent.day) : '';
      previousEventRow.dataset.goalResult = previousEventConcealed
        ? 'pending'
        : previousEventLaneResult
          ? crapsWinnerGoalResult(previousEventLaneResult)
          : 'unknown';
      previousEventRow.dataset.resultVisibility = previousEventConcealed
        ? 'concealed'
        : previousEvent ? 'revealed' : 'pending';
      previousEventRow.setAttribute('aria-label', previousEvent
        ? previousEventConcealed
          ? `Day ${previousEvent.day} event result ready; view it in Pending to reveal`
          : previousEventLaneResult
            ? `Day ${previousEvent.day} ${this.#highRoller ? 'High Roller ' : ''}result, ${crapsWinnerGoalResult(previousEventLaneResult) === 'met' ? 'goal met' : crapsWinnerGoalResult(previousEventLaneResult) === 'missed' ? 'goal not met' : 'goal result unavailable'}`
            : `Day ${previousEvent.day} High Roller result, no winner`
        : 'Previous Craps event result unavailable');
    }
    if (previousEventLocked) previousEventLocked.hidden = !previousEventConcealed;
    if (previousEventDetails) previousEventDetails.hidden = previousEventConcealed;
    bindText('craps-previous-event-label', previousEvent
      ? `DAY ${previousEvent.day} WINNER`
      : 'PREVIOUS WINNER');
    this.#paintWinner(previousEventWinner, previousEventConcealed
      ? null
      : previousEventLaneResult?.winner ?? (previousEvent && this.#highRoller ? 'NO WINNER' : null));
    bindText('craps-previous-event-payout', previousEventConcealed
      ? '—'
      : crapsWinnerTotalLabel(previousEventLaneResult));
    const previousEventPayout = this.querySelector('[data-bind="craps-previous-event-payout"]');
    if (previousEventPayout) {
      previousEventPayout.title = previousEventLaneResult
        && !previousEventConcealed
        && previousEventLaneResult.totalWonWei == null
        && previousEventLaneResult.amountWei != null
        ? 'Known on-chain winner payment; exact total is still loading.'
        : '';
    }
    const previousEventBoost = this.querySelector('[data-bind="craps-previous-event-boost"]');
    const previousEventBoostDetail = this.querySelector('[data-bind="craps-previous-event-boost-detail"]');
    paintCrapsBoostMark(
      previousEventBoostDetail,
      previousEventBoost,
      previousEventConcealed ? null : previousEventLaneResult?.winnerBoostWei,
    );
    bindText('craps-previous-event-buyin', compactWei(
      previousEventConcealed ? null : crapsWinnerListBuyInWei(previousEventLaneResult, this.#highRoller),
    ));
    this.#bindWinnerReplay(
      previousEventReplay,
      previousEventConcealed ? null : previousEventLaneResult,
      previousEvent ? `Day ${previousEvent.day} event` : 'previous event',
    );
    if (previousEventEntrantNode) {
      const shown = crapsEntrantCountForLane(previousEventEntrants, this.#highRoller);
      const known = shown != null;
      previousEventEntrantNode.textContent = known ? shown.toLocaleString('en-US') : '—';
      previousEventEntrantNode.dataset.lane = this.#highRoller ? 'high' : 'main';
      previousEventEntrantNode.title = known
        ? `${shown.toLocaleString('en-US')} ${this.#highRoller ? 'High Roller ' : ''}${shown === 1 ? 'entrant' : 'entrants'}`
        : '';
      previousEventEntrantNode.setAttribute('aria-label', known
        ? previousEventEntrantNode.title
        : 'Previous Craps event entrants loading');
    }

    const body = this.querySelector('.craps-entry__listing tbody');
    if (body && dayRow && tomorrowRow) {
      const order = crapsLobbyRowOrder({
        currentPeriod: state.currentPeriod,
        futureDay,
        settledPeriods: rows.flatMap((row, period) => (
          ['closed', 'completed'].includes(row.dataset.state) ? [period] : []
        )),
      });
      for (const item of order) {
        body.appendChild(item === 'day' ? dayRow : item === 'tomorrow' ? tomorrowRow : rows[item]);
      }
      if (previousEventRow) body.appendChild(previousEventRow);
    }

    const status = this.querySelector('[data-bind="craps-entry-status"]');
    if (status) {
      status.dataset.state = this.#message ? 'message' : 'idle';
      status.textContent = this.#message || (futureDay && compEligible && !passInventoryReady
        ? 'Checking comps…'
        : futureDay && usePass
          ? `1 ${this.#highRoller ? 'High Roller' : 'Normal'} comp reserves the next slate.`
          : futureDay && !state.futurePassOpen && selectedPasses > 0
            ? ''
          : futureDay
            ? 'Today live · reserve the next slate.'
            : '');
      status.hidden = !status.textContent;
    }
    this.#renderProgressive();
    void this.#refreshWinnerProfiles();
  }

  /**
   * A winner cell shows the Discord identity when the wallet linked one, and the
   * shortened address otherwise. The full address always survives in the title —
   * identity is decoration and must never hide the on-chain fact.
   */
  #paintWinner(node, address) {
    if (!node) return;
    const raw = String(address ?? '');
    node.textContent = '';
    if (!/^0x[0-9a-f]{40}$/i.test(raw)) {
      node.textContent = raw || '—';
      node.title = raw;
      return;
    }
    const profile = this.#profiles.get(raw.toLowerCase()) ?? null;
    if (profile?.avatar && typeof globalThis.document?.createElement === 'function') {
      const portrait = globalThis.document.createElement('img');
      portrait.className = 'craps-entry__winner-pfp';
      portrait.src = profile.avatar;
      portrait.alt = '';
      portrait.loading = 'lazy';
      portrait.referrerPolicy = 'no-referrer';
      // A Discord avatar can 404 long after the battle settled (deleted account,
      // rotated hash). Drop to name-only rather than leaving a broken image.
      portrait.addEventListener('error', () => portrait.remove(), { once: true });
      node.append(portrait);
    }
    node.append(profile?.name || compactWinner(raw));
    node.title = profile?.name ? `${profile.name} · ${raw}` : raw;
  }

  #bindWinnerReplay(button, result, label) {
    if (!button) return;
    const replay = crapsWinnerReplayRequest(result);
    const key = replay ? resolutionIdentity(replay) : '';
    const opening = Boolean(key && key === this.#winnerReplayOpening);
    button.hidden = !replay;
    button.disabled = !replay || opening;
    button.dataset.state = opening ? 'loading' : 'ready';
    button.dataset.crapsWinnerReplay = key;
    button.parentElement?.setAttribute?.('data-replay', replay ? 'ready' : 'none');
    const description = `Replay ${label} from the winner's perspective`;
    button.setAttribute('aria-label', opening ? `Loading ${description.toLowerCase()}` : description);
    button.setAttribute('aria-busy', String(opening));
    button.title = 'Watch from the winner\'s perspective';
    if (replay) this.#winnerReplayTargets.set(key, replay);
  }

  #resultNeedsReveal(result) {
    return crapsResultNeedsReveal(result, {
      address: this.#schedulePlayer,
      replays: this.#resolvedReplays,
      wasSeen: resolutionWasSeen,
    });
  }

  #winnerAddresses() {
    const out = new Set();
    const remember = (value) => {
      const address = String(value ?? '').toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(address)) out.add(address);
    };
    for (const result of this.#snapshot?.results ?? []) {
      if (this.#resultNeedsReveal(result)) continue;
      remember(result?.winner);
      remember(result?.highResult?.winner);
    }
    const day = currentDayFromStore();
    const previous = crapsPreviousEventDuringRollover({
      day,
      wordValue: currentWordFromStore(day),
      result: this.#snapshot?.yesterdayEventResult ?? this.#previousEventResult,
    });
    if (this.#resultNeedsReveal(previous)) return [...out].sort();
    remember(previous?.winner);
    remember(previous?.highResult?.winner);
    return [...out].sort();
  }

  async #refreshWinnerProfiles() {
    const addresses = this.#winnerAddresses();
    const key = addresses.join(',');
    if (!key || key === this.#profileKey) return;
    this.#profileKey = key;
    const profiles = await _fetchProfiles(addresses);
    if (this.#profileKey !== key || !profiles?.size) return;
    this.#profiles = profiles;
    this.#render();
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
      ? `Run It Up jackpot ${formatted} FLIP`
      : this.#progressivePending ? 'Loading the Run It Up jackpot' : 'Run It Up jackpot amount unavailable');
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
    if (this.#scheduleDay != null && this.#scheduleDay !== day) {
      const completedEvent = this.#scheduleDay === day - 1
        ? this.#snapshot?.results?.[CRAPS_BATTLES_PER_DAY - 1] ?? null
        : null;
      this.#previousEventResult = completedEvent
        ? Object.freeze({ day: this.#scheduleDay, ...completedEvent })
        : null;
      this.#previousEventEntrants = completedEvent
        ? this.#snapshot?.entrants?.windows?.[CRAPS_BATTLES_PER_DAY - 1] ?? null
        : null;
      this.#boardBets = {};
      this.#contractChips = 0;
      this.#boardSet = false;
      this.#message = '';
    }
    const playerChanged = this.#schedulePlayer !== player;
    if (this.#scheduleDay !== day || playerChanged) {
      this.#schedule = null;
      this.#snapshot = null;
      this.#passCredits = null;
      this.#replaySeq += 1;
      this.#replayLoadPending = false;
      this.#stopReplayPoll();
      this.#replayStates.clear();
      if (playerChanged) this.#resolvedReplays = [];
      clearPendingActions(PENDING_SOURCE);
    }
    this.#scheduleDay = day;
    this.#schedulePlayer = player;
    const seq = ++this.#scheduleSeq;
    this.#schedulePending = true;
    this.#render();
    // Pass inventory is wallet-specific decoration. Do not make public battle
    // results wait for it: a blocked storage read could otherwise hold this
    // refresh open, suppress later polls, and leave resolved rows showing
    // SETTLING indefinitely.
    void (player ? readCrapsPassCredits(player) : Promise.resolve(null)).then((credits) => {
      if (seq !== this.#scheduleSeq || this.#schedulePlayer !== player) return;
      this.#passCredits = credits;
      this.#render();
    }).catch(() => {
      // Preserve the last known inventory; result polling remains independent.
    });
    // Start the optional indexer read beside the chain read, but never await it
    // on the transaction-critical path. A wedged API must not hold buy controls
    // behind its transport timeout; it may only delay the derived TOTAL WON text.
    const totalsRead = readCrapsWinnerTotals(day).then(
      (totals) => ({ ok: true, totals }),
      () => ({ ok: false, totals: null }),
    );
    try {
      const snapshot = crapsLobbySnapshotWithWinnerTotals(
        await readCrapsLobbySnapshot(day, player),
        this.#winnerTotals,
      );
      if (seq !== this.#scheduleSeq) return;
      if (snapshot?.day === day) {
        this.#snapshot = snapshot;
        this.#previousEventResult = snapshot.yesterdayEventResult ?? this.#previousEventResult;
        this.#previousEventEntrants = snapshot.entrants?.previousEvent ?? this.#previousEventEntrants;
        this.#resolvedReplays = Array.isArray(snapshot.resolvedReplays)
          ? snapshot.resolvedReplays
          : [];
        if (snapshot.schedule?.day === day) this.#schedule = snapshot.schedule;
        void this.#refreshResolvedReplays(snapshot?.resolvedReplays, player);
        void totalsRead.then((read) => {
          if (
            !read.ok
            || seq !== this.#scheduleSeq
            || this.#scheduleDay !== day
            || this.#schedulePlayer !== player
            || this.#snapshot?.day !== day
          ) return;
          this.#winnerTotals = read.totals;
          this.#snapshot = crapsLobbySnapshotWithWinnerTotals(this.#snapshot, read.totals);
          this.#previousEventResult = this.#snapshot.yesterdayEventResult
            ?? this.#previousEventResult;
          this.#render();
        });
      }
    } catch (_error) {
      // Entry, pot, and goal remain available from the committed day word;
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
    const replays = this.#resolvedReplays;
    const rows = crapsResolutionPendingActions({
      address,
      replays,
      states: this.#replayStates,
      wasSeen: resolutionWasSeen,
      run: (replay, scope) => this.#openResolvedReplay(replay, scope),
      clearAll: () => this.#dismissAllResolvedReplays(),
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
    const replays = this.#resolvedReplays;
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

  /**
   * Attempts already spent by the battle that has been waiting the least. A
   * newly settled battle therefore keeps the fast cadence for its own hot
   * window even while an older pointer sits in backoff beside it.
   */
  #replayPollAttempts() {
    const address = String(this.#schedulePlayer ?? '').toLowerCase();
    let lowest = null;
    for (const replay of this.#resolvedReplays) {
      if (resolutionWasSeen(address, replay)) continue;
      const state = this.#replayStates.get(resolutionIdentity(replay));
      if (state && CRAPS_REPLAY_TERMINAL_STATES.has(state.status)) continue;
      const attempts = Math.max(0, Math.trunc(Number(state?.attempts) || 0));
      if (lowest == null || attempts < lowest) lowest = attempts;
    }
    return lowest ?? 0;
  }

  #scheduleReplayPoll() {
    this.#stopReplayPoll();
    if (this.#replayLoadPending || !this.#replayPollingAllowed() || !this.#replayNeedsPolling()) return;
    this.#replayPollTimer = globalThis.setTimeout?.(() => {
      this.#replayPollTimer = null;
      void this.#refreshResolvedReplays(this.#resolvedReplays, this.#schedulePlayer);
    }, crapsReplayPollDelay(Math.random(), this.#replayPollAttempts())) ?? null;
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
        this.#replayStates.set(identity, {
          ready: false,
          status: replay?.finalized === false ? 'pending' : 'checking',
          pointer: null,
          attempts: 0,
        });
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
        const attempts = Math.max(0, Math.trunc(Number(prior?.attempts) || 0)) + 1;
        try {
          const artifacts = await loadCrapsReplay({
            battleKey: replay.battleKey,
            viewerBetId: replay.viewerBetId,
            fetchImpl: crapsReplayFetch,
          });
          return { identity, state: { ...crapsReplayLoaderState(artifacts), attempts } };
        } catch (error) {
          const failureStatus = crapsReplayFailureStatus(error);
          return {
            identity,
            // A pointer can legitimately 404 before the replay builder observes
            // the Armed event. Chain truth still says settlement is pending;
            // retain that honest state while retrying transport failures.
            state: {
              ready: false,
              status: replay?.finalized === false && failureStatus === 'retrying'
                ? 'pending'
                : failureStatus,
              pointer: null,
              attempts,
            },
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

  async #openWinnerReplay(button) {
    const key = String(button?.dataset?.crapsWinnerReplay ?? '');
    const replay = this.#winnerReplayTargets.get(key);
    if (!replay || this.#winnerReplayOpening) return false;
    const table = globalThis.document?.querySelector?.('app-craps-table');
    if (!table?.open) {
      this.#message = 'The Craps replay table is unavailable.';
      this.#render();
      return false;
    }
    this.#winnerReplayOpening = key;
    this.#message = 'Loading the winner\'s replay…';
    this.#render();
    try {
      const result = await openCrapsReplayTable(table, {
        ...replay,
        fetchImpl: crapsReplayFetch,
      });
      if (!result.ready) {
        this.#message = crapsReplayStatusCopy(crapsReplayLoaderState(result));
        return false;
      }
      this.#message = '';
      return true;
    } catch (error) {
      this.#message = crapsReplayFailureStatus(error) === 'build-unavailable'
        ? 'Replay unavailable for this build.'
        : 'Replay temporarily unavailable. Try again.';
      return false;
    } finally {
      this.#winnerReplayOpening = null;
      this.#render();
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
        fetchImpl: crapsReplayFetch,
        // Older sealed bundles predate the optional prize totals. The chain's
        // finalization event still carries the exact settled main bounty, so
        // let the adapter use it instead of painting two permanent dashes.
        settledMainPotWei: replay.potWei,
        battleWinner: replay.winner,
        battleWinnerBetId: replay.winnerBetId,
        battlePayoutWei: replay.amountWei,
        battleWinningStop: replay.winningStop,
        bonusMultiplier: replay.bonusMultiplier,
        highRollerBetIds: replay.highRollerBetIds,
        highRollerEntrants: replay.highRollerEntrants,
        highWinnerBetId: replay.highWinnerBetId,
        highWinner: replay.highWinner,
        highPayoutWei: replay.highPayoutWei,
        highWinningStop: replay.highWinningStop,
        highBankrollRider: replay.highBankrollRider,
        onResolutionAcknowledged: () => {
          if (resolutionWasSeen(address, replay)) return;
          markResolutionSeen(address, replay);
          this.#replayStates.delete(resolutionIdentity(replay));
          this.#render();
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

  #dismissAllResolvedReplays() {
    const address = String(this.#schedulePlayer ?? '').toLowerCase();
    if (!address) return;
    for (const replay of this.#resolvedReplays) markResolutionSeen(address, replay);
    this.#replayStates.clear();
    this.#stopReplayPoll();
    this.#render();
    this.#publishResolvedReplays();
  }

  #openBoard(opener, entry = null) {
    const state = crapsEntryState({ day: currentDayFromStore() });
    const terms = this.#termsFor(state);
    const reference = terms?.windows?.find(Boolean) ?? null;
    const editingEntry = entry?.betId != null;
    const entryChips = Number(entry?.chips ?? 0) >>> 0;
    const confirm = async (wager) => {
      this.#boardBets = { ...wager.chips };
      this.#contractChips = wager.contractChips;
      this.#boardSet = true;
      this.#message = editingEntry
        ? wager.contractChips === entryChips
          ? 'Entry board unchanged.'
          : 'Chip placement changed. Select AMEND ENTRY to update it.'
        : 'Your board is set for the Buy In buttons.';
      this.#render();
      return true;
    };
    globalThis.document?.dispatchEvent?.(new CustomEvent(CRAPS_TABLE_OPEN_EVENT, {
      detail: {
        opener,
        screen: 'placement',
        entryKind: 'board',
        entryLabel: editingEntry ? 'EDIT ENTRY BOARD' : this.#boardSet ? 'EDIT YOUR BOARD' : 'SET YOUR BOARD',
        bets: editingEntry ? unpackCrapsContractChips(entryChips) : this.#boardBets,
        bankrollFlip: 0n,
        battleStakeFlip: 0n,
        goalFlip: 0n,
        playedFlip: reference?.playedFlip ?? 10n,
        confirm,
      },
    }));
  }

  #applyAmendedBoard(betId, chips) {
    const playerEntries = this.#snapshot?.playerEntries;
    if (!playerEntries) return;
    const id = String(betId);
    const patchEntry = (entry) => entry?.betId != null && String(entry.betId) === id
      ? Object.freeze({ ...entry, chips })
      : entry;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      playerEntries: Object.freeze({
        ...playerEntries,
        days: Object.freeze(Object.fromEntries(Object.entries(playerEntries.days ?? {}).map(
          ([day, entry]) => [day, patchEntry(entry)],
        ))),
        windows: Object.freeze((playerEntries.windows ?? []).map(patchEntry)),
      }),
    });
  }

  async #amend(button) {
    if (this.#busyKey != null || !this.#boardSet) return;
    const betId = String(button?.dataset?.crapsBetId ?? '');
    const enteredChips = Number(button?.dataset?.crapsEntryChips ?? 0) >>> 0;
    if (!/^\d+$/.test(betId) || this.#contractChips === enteredChips) {
      this.#openBoard(button, { betId, chips: enteredChips });
      return;
    }
    const busyKey = `amend-${betId}`;
    this.#busyKey = busyKey;
    this.#message = '';
    this.#render();
    try {
      const result = await amendCrapsSlip({ betId, contractChips: this.#contractChips });
      await this.#refreshSchedule(true);
      this.#applyAmendedBoard(betId, this.#contractChips);
      this.#message = 'Entry amended with your new board.';
      this.dispatchEvent(new CustomEvent(CRAPS_ENTRY_CONFIRMED_EVENT, {
        detail: { kind: 'amend', betId, contractChips: this.#contractChips, result },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this.#message = String(error?.userMessage || error?.message || 'The Craps entry was not amended. Try again.');
    } finally {
      if (this.#busyKey === busyKey) this.#busyKey = null;
      this.#render();
    }
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
    const kind = requestedKind === 'day'
      ? state.dayEntryKind
      : requestedKind === 'future-day'
        ? 'future-day'
        : 'window';
    const battle = kind === 'window' ? state.battles[period] : null;
    if (kind === 'window' && (!battle || !battle.joinable)) return;
    const selection = crapsEntrySelection({ day: state.day, kind, period });
    const terms = this.#termsFor(state);
    const selectedTerms = kind === 'window' ? terms?.windows?.[period] : terms;
    const highMult = terms?.highMult ?? null;
    if (kind !== 'future-day' && (!selectedTerms || (this.#highRoller && highMult == null))) return;
    const selectedPasses = Number(this.#highRoller
      ? this.#passCredits?.high ?? 0
      : this.#passCredits?.normal ?? 0);
    const compEligible = state.futurePassOpen && !this.#forceFlipDay;
    if (kind === 'future-day' && compEligible && this.#passCredits == null) return;
    const usePass = kind === 'future-day' && compEligible && selectedPasses > 0;

    const baseWager = crapsEntryWager({
      day: state.day,
      kind,
      period,
      buyInFlip: kind === 'day' ? terms.buyInFlip : selectedTerms?.buyInFlip,
      highRoller: this.#highRoller,
      highMult,
      contractChips: this.#contractChips,
      usePass,
    });
    const wager = Object.freeze({
      ...baseWager,
      chips: { ...this.#boardBets },
    });

    const busyKey = requestedKind === 'day'
      ? 'day'
      : requestedKind === 'future-day'
        ? 'future-day'
        : `window-${period}`;
    this.#busyKey = busyKey;
    this.#message = '';
    this.#render();
    try {
      const result = await placeCrapsBonusEntry(wager);
      this.#message = kind === 'future-day'
        ? usePass
          ? `Next slate reserved with one ${this.#highRoller ? 'High Roller' : 'Normal'} Craps comp.`
          : `Next slate purchased with FLIP in the ${this.#highRoller ? 'High Roller' : 'Normal'} lane.`
        : `${kind === 'day' ? 'Full slate' : `Battle ${period + 1}`} entered in the ${this.#highRoller ? 'High Roller' : 'Normal'} lane.`;
      if (kind === 'future-day') this.#forceFlipDay = false;
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
