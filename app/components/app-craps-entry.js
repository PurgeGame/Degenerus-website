// Compact launcher for the seven scheduled Craps battles. Players set one
// reusable chip board here, then use the dense schedule rows to buy seats.

import { get, subscribe } from '../app/store.js';
import { gameDay } from '../app/game-state.js';
import { CHAIN, CRAPS_SCHEDULE } from '../app/chain-config.js';
import { loadCrapsReplay } from '../craps/replay-contract.js';
import { crapsReplayFetch } from '../craps/replay-fetch.js';
import { openCrapsReplayTable } from '../craps/replay-adapter.js';
import { clearPendingActions, publishPendingActions } from '../app/pending-actions.js';
import { registerComponentPoll } from '../app/component-poll.js';
import { fetchProfiles } from '../app/profiles.js';
import * as crapsApi from '../app/craps.js';
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
const CRAPS_ENTRY_RANDOM_CHIPS = 10;
const CRAPS_ENTRY_MAX_PLACED_CHIPS = 7;
const CRAPS_ENTRY_MAX_CHIPS_PER_BET = 3;
const CRAPS_ENTRY_LIMIT_PROMPT_MS = 1_200;
const CRAPS_ENTRY_HOT_SHOOTER_CHANCES = Object.freeze([15, 14, 12, 11, 9, 8, 6, 5]);

// Mirror the lazy component's local revision onto this newly-added transitive
// read. An already-open preview can otherwise pair the current component with
// the prior canonical craps.js module and leave the funding rail blank.
const CRAPS_COMPONENT_REVISION = new URL(import.meta.url).search;
const CRAPS_ADDED_API_URL = new URL(
  `../app/craps.js${CRAPS_COMPONENT_REVISION || '?rev=added-per-day-v2'}`,
  import.meta.url,
).href;
let crapsAddedApiPromise = null;

async function readCrapsAddedPerDay(day) {
  const reader = crapsApi.readCrapsAddedPerDay;
  if (typeof reader === 'function') return reader(day);
  try {
    crapsAddedApiPromise ??= import(CRAPS_ADDED_API_URL);
    const revisedReader = (await crapsAddedApiPromise).readCrapsAddedPerDay;
    return typeof revisedReader === 'function' ? revisedReader(day) : null;
  } catch (_error) {
    crapsAddedApiPromise = null;
    return null;
  }
}

const CRAPS_ENTRY_PACKED_LEGS = Object.freeze([
  'passLine', 'place4', 'place5', 'place6', 'place8',
  'place9', 'place10', 'hard4', 'hard8', 'dontPassLine',
]);
const CRAPS_ENTRY_BET_FIELDS = Object.freeze({
  pass: 'passLine',
  'dont-pass': 'dontPassLine',
  'place-4': 'place4',
  'place-5': 'place5',
  'place-6': 'place6',
  'place-8': 'place8',
  'place-9': 'place9',
  'place-10': 'place10',
  'hard-4': 'hard4',
  'hard-8': 'hard8',
});
const CRAPS_ENTRY_STACK_ART = Object.freeze({
  1: '/shared/flip-chips/coin-high-red.svg',
  2: '/shared/flip-chips/stack-2-high-red.svg',
  3: '/shared/flip-chips/stack-3-high-red.svg',
  4: '/shared/flip-chips/stack-4-high-red.svg',
  5: '/shared/flip-chips/stack-5-high-red.svg',
});

function normalizedEntryBoardCounts(bets = {}) {
  return Object.freeze(Object.fromEntries(CRAPS_ENTRY_PACKED_LEGS.map((field) => {
    const requested = Number(bets?.[field] ?? 0);
    const count = Number.isFinite(requested)
      ? Math.max(0, Math.min(CRAPS_ENTRY_MAX_CHIPS_PER_BET, Math.trunc(requested)))
      : 0;
    return [field, count];
  })));
}

export function crapsEntryNextSpotCount(count = 0) {
  const current = Math.max(0, Math.min(CRAPS_ENTRY_MAX_CHIPS_PER_BET, Math.trunc(Number(count) || 0)));
  return current >= CRAPS_ENTRY_MAX_CHIPS_PER_BET ? 0 : current + 1;
}

/** Pack the inline launcher's readable board with the contract's audited leg order. */
export function packCrapsEntryBoard(bets = {}) {
  const counts = normalizedEntryBoardCounts(bets);
  let packed = 0;
  for (let index = 0; index < CRAPS_ENTRY_PACKED_LEGS.length; index += 1) {
    packed |= (counts[CRAPS_ENTRY_PACKED_LEGS[index]] & 7) << (3 * index);
  }
  return packed >>> 0;
}

/** The contract randomizes the ten-chip complement; its count drives the displayed boost chance. */
export function crapsEntryBoardSummary(bets = {}) {
  const counts = normalizedEntryBoardCounts(bets);
  const placed = Object.values(counts).reduce((total, count) => total + count, 0);
  const boundedPlaced = Math.max(0, Math.min(CRAPS_ENTRY_MAX_PLACED_CHIPS, placed));
  const random = CRAPS_ENTRY_RANDOM_CHIPS - boundedPlaced;
  return Object.freeze({
    counts,
    placed: boundedPlaced,
    random,
    chance: CRAPS_ENTRY_HOT_SHOOTER_CHANCES[boundedPlaced],
    leftRandomStack: Math.min(5, random),
    rightRandomStack: Math.max(0, random - 5),
    contractChips: packCrapsEntryBoard(counts),
  });
}

function entryBoardHistory(bets = {}) {
  const counts = normalizedEntryBoardCounts(bets);
  return Object.values(CRAPS_ENTRY_BET_FIELDS).flatMap((field) => (
    Array.from({ length: counts[field] }, () => field)
  ));
}

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
const CRAPS_SETTLE_WATCH_MS = 5_000;
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

function sanitizedReplayDiagnosticValue(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/\b0x[0-9a-f]{8,}\b/gi, '[hex]')
    .replace(/\b[0-9]{8,}\b/g, '[id]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

/** Describe a swallowed replay exception without retaining wallet, bet, battle, or URL data. */
export function crapsReplayDiagnostic(error, stage = 'open') {
  let name = '';
  let path = '';
  let message = '';
  try { name = sanitizedReplayDiagnosticValue(error?.name); } catch (_error) { /* hostile error */ }
  try { path = sanitizedReplayDiagnosticValue(error?.path); } catch (_error) { /* hostile error */ }
  try { message = sanitizedReplayDiagnosticValue(error?.message); } catch (_error) { /* hostile error */ }
  const safeStage = String(stage ?? 'open').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'open';
  return {
    kind: 'error',
    t: Date.now(),
    data: {
      m: [name || 'Error', path, message].filter(Boolean).join(' | ').slice(0, 300),
      src: `craps-replay:${safeStage}`,
    },
  };
}

/** Queue caught replay failures for the same best-effort telemetry path as global errors. */
export function reportCrapsReplayFailure(error, stage = 'open') {
  const diagnostic = crapsReplayDiagnostic(error, stage);
  try {
    const queue = globalThis.__telemetryQ;
    if (queue && typeof queue.push === 'function') queue.push(diagnostic);
  } catch (_error) { /* diagnostics can never affect replay control flow */ }
  return diagnostic;
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

function unseenResultReplays(result, {
  address,
  replays = [],
  wasSeen = () => false,
} = {}) {
  const scope = String(address ?? '').toLowerCase();
  const battleKey = String(result?.battleKey ?? '').toLowerCase();
  if (!scope || !battleKey || !Array.isArray(replays)) return [];
  return replays.filter((replay) => (
    String(replay?.battleKey ?? '').toLowerCase() === battleKey
    && !wasSeen(scope, replay)
  ));
}

/** The lobby keeps owned outcomes sealed, but only calls them ready once the
 * replay loader has the complete artifact bundle that Pending can open. */
export function crapsResultRevealState(result, {
  address,
  replays = [],
  states = new Map(),
  wasSeen = () => false,
} = {}) {
  const matching = unseenResultReplays(result, { address, replays, wasSeen });
  if (matching.length === 0) return null;
  const loaders = matching.map((replay) => states?.get?.(resolutionIdentity(replay)) ?? null);
  if (loaders.some((loader) => loader?.ready === true)) return 'ready';
  if (loaders.every((loader) => ['failed', 'build-unavailable'].includes(loader?.status))) {
    return 'unavailable';
  }
  return 'waiting';
}

export function crapsResultRevealCopy(state) {
  if (state === 'ready') {
    return {
      status: 'RESULT READY',
      route: 'VIEW IN PENDING',
      aria: 'result ready; view it in Pending to reveal',
    };
  }
  if (state === 'unavailable') {
    return {
      status: 'REPLAY UNAVAILABLE',
      route: 'CLEAR IN PENDING',
      aria: 'replay unavailable; clear it in Pending',
    };
  }
  return {
    status: 'RESULT SETTLING',
    route: 'STATUS IN PENDING',
    aria: 'result is still settling; follow its status in Pending',
  };
}

/** Keep public lobby results sealed while this wallet still owns an unseen replay. */
export function crapsResultNeedsReveal(result, {
  address,
  replays = [],
  wasSeen = () => false,
} = {}) {
  return unseenResultReplays(result, { address, replays, wasSeen }).length > 0;
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
  const dayEntryKind = currentPeriod === 0 ? 'day' : 'future-day';
  const dayEntryDay = currentDay == null ? null : currentDay + (dayEntryKind === 'future-day' ? 1 : 0);
  return Object.freeze({
    day: currentDay,
    currentPeriod,
    nextDayAtMs,
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

export function crapsDayQuestPurchaseOptions({
  state = null,
  todayPrice = null,
  playerEntries = null,
} = {}) {
  const day = positiveDay(state?.day);
  let livePrice = null;
  try {
    const parsed = BigInt(todayPrice);
    if (parsed > 0n) livePrice = parsed;
  } catch (_error) { /* today remains unavailable until exact terms load */ }
  const ownedDays = playerEntries?.days && typeof playerEntries.days === 'object'
    ? playerEntries.days
    : {};
  const alreadyEnteredToday = day != null && (
    Boolean(ownedDays[String(day)])
    || (Array.isArray(playerEntries?.windows) && playerEntries.windows.some(Boolean))
  );
  const todayOpen = day != null
    && Number(state?.currentPeriod) === 0
    && livePrice != null
    && !alreadyEnteredToday;
  let futureDay = day == null ? null : day + 1;
  while (futureDay != null
    && futureDay <= 0xFFFFFF
    && Boolean(ownedDays[String(futureDay)])) {
    futureDay += 1;
  }
  if (futureDay != null && futureDay > 0xFFFFFF) futureDay = null;
  return Object.freeze({
    today: todayOpen
      ? Object.freeze({ day, price: livePrice.toString() })
      : null,
    // Keep the `tomorrow` property for the quest panel's two-choice API, but
    // the option itself advances past any day already reserved by a comp.
    tomorrow: futureDay == null
      ? null
      : Object.freeze({
          day: futureDay,
          price: CRAPS_FUTURE_DAY_PRICES.normal.toString(),
          label: futureDay === day + 1 ? 'TOMORROW' : `DAY ${futureDay}`,
        }),
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

export function crapsEntrySelection({ day = null, kind, period = null, targetDay = null } = {}) {
  const currentDay = positiveDay(day);
  const normalizedKind = ['day', 'future-day', 'window'].includes(kind) ? kind : null;
  if (!normalizedKind) throw new Error('Choose a full-day or individual Craps entry.');
  const normalizedPeriod = normalizedKind === 'window' ? Number(period) : null;
  if (normalizedKind === 'window'
    && (!Number.isInteger(normalizedPeriod) || normalizedPeriod < 0 || normalizedPeriod >= CRAPS_BATTLES_PER_DAY)) {
    throw new Error('Choose one of the seven Craps battles.');
  }
  const requestedFutureDay = normalizedKind === 'future-day' && targetDay != null
    ? positiveDay(targetDay)
    : null;
  if (normalizedKind === 'future-day'
    && targetDay != null
    && (currentDay == null || requestedFutureDay == null || requestedFutureDay <= currentDay)) {
    throw new Error('Choose an unreserved future Craps day.');
  }
  const entryDay = currentDay == null
    ? null
    : normalizedKind === 'future-day'
      ? requestedFutureDay ?? currentDay + 1
      : currentDay;
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
  targetDay = null,
  buyInFlip = null,
  highRoller = false,
  highMult = null,
  contractChips = 0,
  usePass = false,
} = {}) {
  const selection = crapsEntrySelection({ day, kind, period, targetDay });
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

export function crapsActiveDay({ indexedDay = null, chainDay = null } = {}) {
  // GAME.currentDayView (published through app.daySync) is the day boundary.
  // The richer indexed game state can legitimately remain on yesterday while
  // its post-roll snapshot catches up, so it is only a startup fallback.
  return positiveDay(chainDay)
    ?? positiveDay(indexedDay)
    ?? null;
}

function currentDayFromStore() {
  return crapsActiveDay({
    indexedDay: gameDay(get('app.gameState')),
    chainDay: get('app.daySync')?.day,
  });
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

function roundedWholeFlip(value) {
  if (value == null) return null;
  let wei;
  try { wei = BigInt(value); } catch (_error) { return null; }
  return (wei + (FLIP_WEI / 2n)) / FLIP_WEI;
}

function compactWei(value) {
  const flip = roundedWholeFlip(value);
  return flip == null ? '—' : formatCrapsCompactFlip(flip);
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

/** Prefer the full Run It Up balance while it still fits the narrow number rail. */
export function crapsHeaderJackpotLabel(value, maxCharacters = 13) {
  const flip = roundedWholeFlip(value);
  if (flip == null) return '—';
  const full = flip.toLocaleString('en-US');
  return full.length <= Math.max(1, Number(maxCharacters) || 13)
    ? full
    : formatCrapsCompactFlip(flip);
}

/** Choose the honest promotional headline without hiding a weak prior day. */
export function crapsHeaderAddedMetric(snapshot = null, fallbackPerDayWei = null) {
  let actualWei;
  let averageWei;
  try {
    if (snapshot?.yesterdayTotalAddedWei == null || snapshot?.yesterdayAverageAddedWei == null) {
      const perDayWei = snapshot?.todayAverageAddedWei ?? fallbackPerDayWei;
      if (perDayWei == null) return null;
      averageWei = BigInt(perDayWei);
      if (averageWei < 0n) return null;
      return Object.freeze({
        actualWei: null,
        averageWei,
        valueWei: averageWei,
        showsYesterday: false,
        label: 'ADDED',
        period: 'PER DAY',
      });
    }
    actualWei = BigInt(snapshot.yesterdayTotalAddedWei);
    averageWei = BigInt(snapshot.yesterdayAverageAddedWei);
  } catch (_error) { return null; }
  if (actualWei < 0n || averageWei < 0n) return null;
  const showsYesterday = actualWei > averageWei;
  return Object.freeze({
    actualWei,
    averageWei,
    valueWei: showsYesterday ? actualWei : averageWei,
    showsYesterday,
    label: 'ADDED',
    period: showsYesterday ? 'YESTERDAY' : 'PER DAY',
  });
}

/** Keep ordinary protocol-added winnings blue; reserve purple for an actual progressive hit. */
export function crapsAddedResultTone(progressivePaidWei = 0) {
  try {
    return BigInt(progressivePaidWei ?? 0) > 0n ? 'progressive' : 'added';
  } catch (_error) {
    return 'added';
  }
}

/** The Added result is the winner's regular boost plus any Run It Up payout. */
export function crapsAddedResultWei(boostWei, progressivePaidWei = 0) {
  if (boostWei == null) return null;
  try {
    const boost = BigInt(boostWei);
    const progressive = BigInt(progressivePaidWei ?? 0);
    return boost < 0n || progressive < 0n ? null : boost + progressive;
  } catch (_error) {
    return null;
  }
}

/** Paint the resolved boost in the shared results table's plain Added column. */
function paintCrapsAddedValue(container, output, boostWei, progressivePaidWei = 0) {
  const value = crapsAddedResultWei(boostWei, progressivePaidWei);
  const amount = compactWei(value);
  const ready = value != null && amount !== '—';
  const tone = crapsAddedResultTone(progressivePaidWei);
  if (output) output.textContent = ready ? `+${amount}` : '—';
  if (!container) return;
  container.dataset.state = ready ? 'ready' : 'unavailable';
  container.dataset.tone = tone;
  const label = ready
    ? tone === 'progressive'
      ? `${amount} FLIP added, including the Run It Up Progressive payout, in total won`
      : `${amount} FLIP boost included in total won`
    : 'Boost unavailable';
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
    let entryBuyInWei = replay.entryBuyInWei ?? null;
    if (entryBuyInWei == null) {
      try {
        if (replay.buyInWei == null) throw new TypeError('Missing Craps buy-in');
        const multiple = BigInt(replay.entryMultiple ?? 1);
        const baseBuyIn = BigInt(replay.buyInWei);
        entryBuyInWei = multiple >= 1n && multiple <= 256n
          ? (baseBuyIn * multiple).toString()
          : replay.buyInWei;
      } catch (_error) { entryBuyInWei = replay.buyInWei; }
    }
    const buyInLabel = compactWei(entryBuyInWei);
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
      label: `${buyInLabel} FLIP\nBATTLE`,
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

/** Total WAGER + BATTLE buy-in the named winner actually paid for this window. */
export function crapsWinnerListBuyInWei(result, highRoller = false) {
  if (result?.buyInWei == null) return null;
  let base;
  try { base = BigInt(result.buyInWei); } catch (_error) { return null; }
  if (base < 0n) return null;
  // A High Roller still competes in the main field. Keying this number only to
  // the currently selected lane made a 100x winner look as though they bought
  // the 1x seat (day 86 battle 4: 60,000 displayed as 600).
  const sealedMultiple = Number(result.entryMultiple);
  const multiple = Number.isInteger(sealedMultiple) && sealedMultiple >= 1 && sealedMultiple <= 256
    ? sealedMultiple
    : highRoller ? Number(result.highMultiple) : 1;
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
  // ⭐ PASSES ARE PART OF WHAT THE BATTLE PAID. `_splitAward` spends half the admitted boost
  // on day passes and SUBTRACTS them from the liquid pot, so the FLIP payment alone is the
  // award minus the passes. Reporting only the FLIP made the boost read LARGER than the
  // total it is part of (day 68 battle 5, run #45: a 269K boost against a 158.9K total,
  // because 114K of it was paid as 5 passes). Count them at the contract's own valuation.
  const passes = typeof result.winnerPassWei === 'bigint' ? result.winnerPassWei : 0n;
  if (result.totalWonWei != null) return compactWei(result.totalWonWei + passes);
  if (result.amountWei == null) return '—';
  // CrapsProgressivePaid is available in the same chain log window as the
  // battle prize, even when the run-total projection is still catching up.
  const progressive = typeof result.progressivePaidWei === 'bigint'
    ? result.progressivePaidWei
    : 0n;
  const knownPayment = compactWei(result.amountWei + progressive + passes);
  return knownPayment === '—' ? '—' : `≥${knownPayment}`;
}

/** A Normal whole-day reservation still needs promotion for the selected High Roller lane. */
export function crapsDayTicketNeedsHighUpgrade(ticket, highRoller = false) {
  if (!ticket || highRoller !== true) return false;
  const highMask = Number(ticket.highMask ?? (ticket.high ? 0x7F : 0));
  return (highMask & 0x7F) !== 0x7F;
}

export class AppCrapsEntry extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #timer = null;
  #refreshTimer = null;
  // True while some battle has closed and its result has not arrived: the
  // window between the chain finalizing and the indexer/replay pipeline
  // catching up, where the row reads SETTLING.
  #awaitingSettlement = false;
  #settleWatchTimer = null;
  #progressiveWei = null;
  #progressivePending = false;
  #progressiveSeq = 0;
  #addedPerDayWei = null;
  #addedPerDayDay = null;
  #addedPending = false;
  #addedSeq = 0;
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
  #boardHistory = [];
  #contractChips = 0;
  #boardSet = false;
  #busyKey = null;
  #message = '';
  #placePromptTimer = null;
  #forceFlipDay = false;
  #questActivationListening = false;
  #storeListener = () => {
    this.#render();
    void this.#refreshAddedPerDay();
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
    const detail = event?.detail;
    const questType = Number(detail?.questType);
    if (questType !== 10 && questType !== 11) return;
    if (questType === 11) {
      const requestedDay = detail?.crapsDay === 'today' ? 'today' : 'tomorrow';
      const targetDay = positiveDay(detail?.crapsTargetDay);
      const state = crapsEntryState({ day: currentDayFromStore() });
      // A quest day is always a paid Normal-lane entry. Calling #buy here makes
      // CONFIRM the purchase action instead of a focus-only routing hint.
      this.#forceFlipDay = true;
      this.#highRoller = false;
      this.#message = '';
      const purchase = requestedDay === 'today' && state.currentPeriod !== 0
        ? Promise.resolve({
            ok: false,
            message: "Today's full Craps slate has already started. Choose a future day.",
          })
        : this.#buy(
            requestedDay === 'today' ? 'day' : 'future-day',
            null,
            {
              targetDay: requestedDay === 'today' ? null : targetDay,
              advancePastReserved: requestedDay !== 'today',
            },
          );
      // The mutable event detail is the synchronous acknowledgement channel
      // back to the quest sheet. It keeps the sheet open until preflight and
      // the wallet transaction have genuinely succeeded.
      detail.crapsHandled = true;
      detail.crapsPurchase = purchase;
      void purchase.then(
        () => {
          this.#forceFlipDay = false;
          this.#render();
        },
        () => {
          this.#forceFlipDay = false;
          this.#render();
        },
      );
      return;
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
  #questOptionsListener = (event) => {
    const detail = event?.detail;
    if (!detail || typeof detail !== 'object') return;
    const state = crapsEntryState({ day: currentDayFromStore() });
    const terms = this.#termsFor(state);
    const connectedPlayer = String(get('connected.address') ?? '').toLowerCase();
    const snapshot = this.#snapshot?.day === state.day ? this.#snapshot : null;
    const playerEntries = connectedPlayer
      && snapshot?.playerEntries?.player === connectedPlayer
      ? snapshot.playerEntries
      : null;
    Object.assign(detail, crapsDayQuestPurchaseOptions({
      state,
      todayPrice: terms?.complete ? terms.buyInFlip : null,
      playerEntries,
    }));
  };
  #clickListener = (event) => {
    const howToPlay = event?.target?.closest?.('[data-craps-how-to-play]');
    if (howToPlay && !howToPlay.disabled) {
      this.ownerDocument?.dispatchEvent?.(new CustomEvent('craps-rules:open', {
        detail: { trigger: howToPlay },
      }));
      return;
    }
    const replay = event?.target?.closest?.('[data-craps-winner-replay]');
    if (replay && !replay.disabled) {
      void this.#openWinnerReplay(replay);
      return;
    }
    const betSpot = event?.target?.closest?.('[data-craps-bet]');
    if (betSpot && !betSpot.disabled) {
      this.#cycleInlineBet(betSpot.dataset.crapsBet);
      return;
    }
    const randomSlot = event?.target?.closest?.('[data-craps-random]');
    if (randomSlot && !randomSlot.disabled) {
      this.#reclaimInlineBet();
      return;
    }
    const lane = event?.target?.closest?.('[data-craps-lane]');
    if (lane && !lane.disabled) {
      this.#highRoller = lane.dataset.crapsLane === 'high';
      this.#message = '';
      this.#render();
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
      globalThis.document?.addEventListener?.('quest:craps-options', this.#questOptionsListener);
    }
    // Shared scheduler, not raw setIntervals: the 30s cycle drives the craps
    // log-window scan + storage reads and must stop in hidden tabs; the 60s
    // repaint is pure DOM and gets the same discipline for free.
    if (this.#timer == null) {
      this.#timer = registerComponentPoll(() => this.#render(), 60_000);
    }
    if (this.#refreshTimer == null) {
      this.#refreshTimer = registerComponentPoll(() => {
        void this.#refreshProgressive();
        void this.#refreshAddedPerDay(true);
        void this.#refreshSchedule();
      }, 30_000);
    }
    if (this.#settleWatchTimer == null) {
      // SETTLING is the one state a player actively watches. The lobby window
      // is a 2s-cached indexer read, so while a closed battle awaits its
      // result, refresh it every 5s instead of waiting out the 30s cycle.
      this.#settleWatchTimer = registerComponentPoll(() => {
        if (this.#awaitingSettlement) void this.#refreshSchedule();
      }, CRAPS_SETTLE_WATCH_MS);
    }
    this.#render();
    void this.#refreshProgressive();
    void this.#refreshAddedPerDay();
    void this.#refreshSchedule();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs.splice(0)) unsubscribe?.();
    if (typeof this.#timer === 'function') { try { this.#timer(); } catch (_e) { /* defensive */ } }
    if (typeof this.#refreshTimer === 'function') {
      try { this.#refreshTimer(); } catch (_e) { /* defensive */ }
    }
    if (typeof this.#settleWatchTimer === 'function') {
      try { this.#settleWatchTimer(); } catch (_e) { /* defensive */ }
    }
    this.#timer = null;
    this.#refreshTimer = null;
    this.#settleWatchTimer = null;
    this.#resetPlacePrompt();
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
      globalThis.document?.removeEventListener?.('quest:craps-options', this.#questOptionsListener);
    }
    this.#progressiveSeq += 1;
    this.#addedSeq += 1;
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
          <div class="craps-entry__display-face">
            <div class="craps-entry__logo-deck">
              <section class="craps-entry__identity craps-entry__identity--craps"
                       aria-label="Craps Autobattle, added FLIP per day unavailable">
                <h2 class="craps-entry__craps-logo" id="craps-entry-title">
                  <img class="craps-entry__craps-lockup" src="/app/assets/craps/craps-autobattle-integrated-swords-v8.webp" width="2025" height="466"
                       loading="lazy" decoding="async" alt="CRAPS AUTO BATTLE bookended by silver and blue dice badges, with crossed swords between AUTO and BATTLE">
                </h2>
              </section>
              <section class="craps-entry__identity craps-entry__identity--runup" aria-label="Run It Up Progressive Jackpot">
                <span class="craps-entry__runup-kicker" aria-hidden="true">FEATURING THE</span>
                <span class="craps-entry__run-it-up-mark" aria-hidden="true">
                  <img src="/app/assets/craps/run-it-up-progressive-jackpot-logo-v2.webp" width="1400" height="517"
                       loading="lazy" decoding="async" alt="">
                </span>
                <span class="craps-entry__runup-submark" aria-hidden="true">PROGRESSIVE JACKPOT</span>
              </section>
            </div>
            <div class="craps-entry__header-metrics">
              <span class="craps-entry__daily-added" data-bind="craps-added-banner" data-state="loading"
                    aria-label="Added FLIP per day unavailable">
                <img class="craps-entry__flip-mark" src="/shared/flip-chips/face.svg" width="64" height="64" alt="">
                <strong><output data-bind="craps-added-total" aria-live="polite">—</output></strong>
                <span class="craps-entry__added-key"><b data-bind="craps-added-label">ADDED</b><small data-bind="craps-added-period">PER DAY</small></span>
              </span>
              <strong class="craps-entry__progressive-meter" data-bind="craps-progressive" data-state="loading"
                      aria-label="Run It Up Progressive Jackpot amount unavailable"><span class="craps-entry__progressive-value"><img class="craps-entry__flip-mark" src="/shared/flip-chips/face.svg" width="64" height="64" alt=""><output data-bind="craps-progressive-amount" aria-live="polite">—</output></span></strong>
            </div>
          </div>
        </header>

        <div class="craps-entry__lobby">
          <table class="craps-entry__listing" aria-label="Craps battle buy-ins">
            <colgroup><col class="craps-entry__col-close"><col class="craps-entry__col-wager"><col class="craps-entry__col-operator"><col class="craps-entry__col-battle"><col class="craps-entry__col-action"><col class="craps-entry__col-entrants"></colgroup>
            <thead><tr><th>CLOSES IN</th><th class="craps-entry__wager">WAGER</th><th class="craps-entry__operator">+</th><th class="craps-entry__battle-key">BATTLE</th><th>BUY IN</th><th>ENTRANTS</th></tr></thead>
            <tbody>
              <tr class="craps-entry__day-buy" data-bind="craps-day-row" data-state="open">
                <th scope="row" data-bind="craps-day-head"><small data-bind="craps-day-kicker">FULL DAY</small><time data-bind="craps-day-countdown">—</time></th>
                <td class="craps-entry__money craps-entry__wager craps-entry__rolling-terms" data-bind="craps-full-day-terms" colspan="3"><span class="craps-entry__tomorrow-layout"><strong data-bind="craps-full-day-entry">ROLLING</strong><small class="craps-entry__range-note" data-bind="craps-full-day-range-note" hidden>7 BATTLES</small></span></td>
                <td class="craps-entry__operator" data-bind="craps-full-day-separator" hidden>+</td>
                <td class="craps-entry__money craps-entry__battle-fee" data-bind="craps-full-day-pot-cell" hidden><strong data-bind="craps-full-day-pot">—</strong></td>
                <td class="craps-entry__action"><button type="button" data-craps-entry="day" data-terms="loading">— FLIP</button><span class="craps-entry__entered" data-bind="craps-day-entered" hidden>ENTERED</span></td>
                <td class="craps-entry__entrants" data-bind="craps-day-entrants">—</td>
              </tr>
              ${Array.from({ length: CRAPS_BATTLES_PER_DAY }, (_, period) => `
                <tr class="craps-entry__battle" data-craps-period="${period}" data-state="upcoming" data-terms="loading">
                  <th scope="row" class="craps-entry__open-cell"><time data-bind="craps-battle-countdown">—</time></th>
                  <td class="craps-entry__money craps-entry__wager craps-entry__open-cell craps-entry__rolling-terms" colspan="3"><strong data-bind="craps-battle-entry">ROLLING</strong></td>
                  <td class="craps-entry__operator craps-entry__open-cell" hidden>+</td>
                  <td class="craps-entry__money craps-entry__battle-fee craps-entry__open-cell" hidden><strong data-bind="craps-battle-pot">—</strong></td>
                  <td class="craps-entry__action craps-entry__open-cell">
                    <button type="button" data-craps-entry="window" data-craps-period="${period}">— FLIP</button>
                    <span class="craps-entry__entered" data-bind="craps-battle-entered" hidden>ENTERED</span>
                  </td>
                  <td class="craps-entry__result" data-bind="craps-battle-result" colspan="5" hidden>
                    <div class="craps-entry__result-locked" data-bind="craps-battle-result-locked" hidden>
                      <small data-bind="craps-battle-result-status">RESULT SETTLING</small><strong data-bind="craps-battle-result-route">STATUS IN PENDING</strong>
                    </div>
                    <div class="craps-entry__result-grid" data-bind="craps-battle-result-details">
                      <span><strong data-bind="craps-battle-winner">—</strong></span>
                      <span class="craps-entry__result-total"><strong><output data-bind="craps-battle-payout">—</output></strong></span>
                      <span class="craps-entry__result-added" data-bind="craps-battle-boost-detail"><strong><output data-bind="craps-battle-boost">—</output></strong></span>
                      <span class="craps-entry__result-buyin"><strong><output data-bind="craps-battle-buyin">—</output></strong></span>
                      <button type="button" class="craps-entry__result-replay" data-craps-winner-replay hidden aria-label="Replay from the winner's perspective" title="Watch from the winner's perspective"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="7.5" cy="6.75" r="2.75"></circle><circle cx="14" cy="6.5" r="2.25"></circle><rect x="4" y="10" width="12" height="8" rx="1.5"></rect><path d="m16 12.25 4-2v7.5l-4-2Z"></path></svg></button>
                    </div>
                  </td>
                  <td class="craps-entry__entrants" data-bind="craps-battle-entrants">—</td>
                </tr>`).join('')}
              <tr class="craps-entry__day-buy craps-entry__day-buy--tomorrow" data-bind="craps-tomorrow-row" data-state="open" hidden>
                <th scope="row"><time data-bind="craps-tomorrow-countdown">—</time></th>
                <td class="craps-entry__money craps-entry__tomorrow-range" data-bind="craps-tomorrow-terms" colspan="3"><span class="craps-entry__tomorrow-layout"><strong data-bind="craps-tomorrow-range">4.2K – 126K</strong><small>7 BATTLES</small></span></td>
                <td class="craps-entry__action"><button type="button" data-craps-entry="future-day" data-terms="loading">— FLIP</button><span class="craps-entry__entered" data-bind="craps-tomorrow-entered" hidden>ENTERED</span></td>
                <td class="craps-entry__entrants" data-bind="craps-tomorrow-entrants">—</td>
              </tr>
              <tr class="craps-entry__results-head" data-bind="craps-results-head" hidden>
                <th colspan="5" scope="colgroup"><div class="craps-entry__results-head-grid"><span>WINNER</span><span>TOTAL WON</span><span>ADDED</span><span>BUY IN</span><span aria-hidden="true"></span></div></th>
                <th scope="col">ENTRANTS</th>
              </tr>
              <tr class="craps-entry__battle craps-entry__previous-event"
                  data-bind="craps-previous-event-row" data-state="completed" hidden>
                <td class="craps-entry__result" colspan="5">
                  <div class="craps-entry__result-locked" data-bind="craps-previous-event-result-locked" hidden>
                    <small data-bind="craps-previous-event-result-status">RESULT SETTLING</small><strong data-bind="craps-previous-event-result-route">STATUS IN PENDING</strong>
                  </div>
                  <div class="craps-entry__result-grid" data-bind="craps-previous-event-result-details">
                    <span><small data-bind="craps-previous-event-label">PREVIOUS EVENT</small><strong data-bind="craps-previous-event-winner">—</strong></span>
                    <span class="craps-entry__result-total"><strong><output data-bind="craps-previous-event-payout">—</output></strong></span>
                    <span class="craps-entry__result-added" data-bind="craps-previous-event-boost-detail"><strong><output data-bind="craps-previous-event-boost">—</output></strong></span>
                    <span class="craps-entry__result-buyin"><strong><output data-bind="craps-previous-event-buyin">—</output></strong></span>
                    <button type="button" class="craps-entry__result-replay" data-craps-winner-replay hidden aria-label="Replay from the winner's perspective" title="Watch from the winner's perspective"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="7.5" cy="6.75" r="2.75"></circle><circle cx="14" cy="6.5" r="2.25"></circle><rect x="4" y="10" width="12" height="8" rx="1.5"></rect><path d="m16 12.25 4-2v7.5l-4-2Z"></path></svg></button>
                  </div>
                </td>
                <td class="craps-entry__entrants" data-bind="craps-previous-event-entrants">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <section class="craps-entry__betting" aria-label="Craps betting board">
          <div class="craps-entry__surface-strip" aria-label="Entry lane and Hot Shooter bonus status">
            <span class="craps-entry__bonus-equation" aria-live="polite">
              <span class="craps-entry__bonus-equation-line"><strong><output data-bind="craps-random-count">10</output></strong><small>RANDOM</small><b>=</b>
                <strong class="craps-entry__hot-value"><output data-bind="craps-hot-shooter-chance">15</output>%</strong><small>HOT SHOOTER BONUS</small></span>
            </span>
            <strong class="craps-entry__place-prompt" aria-label="Place your bets" aria-live="polite" aria-atomic="true"><span data-craps-place-prompt="top">PLACE</span><span data-craps-place-prompt="bottom">YOUR BETS</span></strong>
            <div class="craps-entry__lane" role="group" aria-label="Craps entry lane">
              <button type="button" data-craps-lane="normal" aria-pressed="true"><span>LOW<br>STAKES</span><strong class="craps-entry__pass-count" data-bind="craps-normal-passes" hidden>0</strong></button>
              <button type="button" data-craps-lane="high" aria-pressed="false"><span>HIGH<br>ROLLER</span><strong class="craps-entry__pass-count" data-bind="craps-high-passes" hidden>0</strong></button>
            </div>
          </div>

          <div class="craps-entry__mini-felt">
            <div class="craps-entry__number-row">
              <button class="craps-entry__bet-spot" type="button" data-craps-bet="place-4" data-count="0"><span class="craps-entry__bet-label">4</span><span class="craps-entry__pays">2:1</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
              <button class="craps-entry__bet-spot" type="button" data-craps-bet="place-5" data-count="0"><span class="craps-entry__bet-label">5</span><span class="craps-entry__pays">3:2</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
              <button class="craps-entry__bet-spot" type="button" data-craps-bet="place-6" data-count="0"><span class="craps-entry__bet-label">6</span><span class="craps-entry__pays">7:6</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
              <button class="craps-entry__bet-spot" type="button" data-craps-bet="place-8" data-count="0"><span class="craps-entry__bet-label">8</span><span class="craps-entry__pays">7:6</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
              <button class="craps-entry__bet-spot" type="button" data-craps-bet="place-9" data-count="0"><span class="craps-entry__bet-label">9</span><span class="craps-entry__pays">3:2</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
              <button class="craps-entry__bet-spot" type="button" data-craps-bet="place-10" data-count="0"><span class="craps-entry__bet-label">10</span><span class="craps-entry__pays">2:1</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
            </div>
            <div class="craps-entry__line-row">
              <button class="craps-entry__bet-spot craps-entry__bet-spot--hard" type="button" data-craps-bet="hard-4" data-count="0"><span class="craps-entry__hard-dice" aria-hidden="true"><img src="/symbols/dice_01_2_silver.svg" alt=""><img src="/symbols/dice_01_2_blue.svg" alt=""></span><span class="craps-entry__bet-label">HARD <b>4</b></span><span class="craps-entry__pays">7:1</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
              <button class="craps-entry__bet-spot" type="button" data-craps-bet="pass" data-count="0"><span class="craps-entry__bet-label">PASS</span><span class="craps-entry__pays">1:1</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
              <button class="craps-entry__bet-spot craps-entry__how-to-play" type="button" data-craps-how-to-play aria-label="How to play Craps Autobattle" aria-haspopup="dialog"><span class="craps-entry__bet-label">HOW TO<br>PLAY</span></button>
              <button class="craps-entry__bet-spot craps-entry__bet-spot--hard" type="button" data-craps-bet="hard-8" data-count="0"><span class="craps-entry__hard-dice" aria-hidden="true"><img src="/symbols/dice_03_4_silver.svg" alt=""><img src="/symbols/dice_03_4_blue.svg" alt=""></span><span class="craps-entry__bet-label">HARD <b>8</b></span><span class="craps-entry__pays">9:1</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
              <button class="craps-entry__bet-spot craps-entry__bet-spot--dont" type="button" data-craps-bet="dont-pass" data-count="0"><span class="craps-entry__bet-label">DON'T<br>PASS</span><span class="craps-entry__pays">3:4</span><span class="craps-entry__chip-stack"><img data-craps-stack src="/shared/flip-chips/coin-high-red.svg" alt=""></span></button>
              <button class="craps-entry__bet-spot craps-entry__random-slot" type="button" data-craps-random data-random-count="10" aria-label="10 random chips remaining"><span class="craps-entry__bet-label">RANDOM</span><span class="craps-entry__random-stack" aria-hidden="true"><img data-craps-random-stack="left" src="/shared/flip-chips/stack-5-high-red.svg" alt=""><img data-craps-random-stack="right" src="/shared/flip-chips/stack-5-high-red.svg" alt=""></span></button>
            </div>
          </div>
        </section>
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
      lane.setAttribute('aria-label', `${laneHigh ? 'High Roller' : 'Low Stakes'} Craps lane${count > 0 ? `, ${count.toLocaleString('en-US')} ${count === 1 ? 'comp' : 'comps'} available` : ''}`);
      lane.disabled = this.#busyKey != null;
    }
    this.#paintInlineBoard();

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
    const standaloneAddedWei = this.#addedPerDayDay === state.day ? this.#addedPerDayWei : null;
    const addedMetric = crapsHeaderAddedMetric(snapshot, standaloneAddedWei);
    const addedReady = addedMetric != null;
    bindText('craps-added-total', addedReady
      ? crapsHeaderBoostLabel(addedMetric.valueWei)
      : '—');
    bindText('craps-added-label', addedMetric?.label ?? 'ADDED');
    bindText('craps-added-period', addedMetric?.period ?? 'PER DAY');
    if (addedBanner) {
      addedBanner.dataset.state = addedReady
        ? 'ready'
        : this.#schedulePending || this.#addedPending ? 'loading' : 'unavailable';
      const addedDescription = addedMetric?.showsYesterday
        ? `${compactWei(addedMetric.actualWei)} FLIP added yesterday, including the daily Run It Up funding`
        : addedMetric?.actualWei != null
          ? `${compactWei(addedMetric.averageWei)} FLIP added per day, including Run It Up funding`
          : addedMetric
            ? `${compactWei(addedMetric.averageWei)} FLIP added per day, including Run It Up funding`
          : this.#schedulePending || this.#addedPending
            ? 'Loading added FLIP per day'
            : 'Added FLIP per day unavailable';
      addedBanner.setAttribute('aria-label', addedDescription);
      addedBanner.title = addedDescription;
      this.querySelector('.craps-entry__identity--craps')?.setAttribute('aria-label', addedBanner.getAttribute('aria-label'));
    }

    const selectedPasses = this.#highRoller ? highPasses : normalPasses;
    const passInventoryReady = !connectedPlayer || this.#passCredits != null;
    const compEligible = !this.#forceFlipDay;
    const usePass = futureDay && compEligible && selectedPasses > 0;
    const dayReady = dayEntryDay != null
      && (futureDay || (terms?.complete && multiple != null))
      && (!futureDay || !compEligible || passInventoryReady);
    const dayPrice = futureDay
      ? CRAPS_FUTURE_DAY_PRICES[this.#highRoller ? 'high' : 'normal']
      : dayReady ? terms.buyInFlip * BigInt(multiple) : null;
    const dayEntry = !futureDay && dayReady ? terms.bankrollFlip * BigInt(multiple) : null;
    const dayBattle = !futureDay && dayReady ? terms.battleStakeFlip * BigInt(multiple) : null;
    const dayRolling = !futureDay && !dayReady;
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
    const combinedTomorrowRange = `Tomorrow's ${this.#highRoller ? 'High Roller' : 'Low Stakes'} slate draws a combined seven-battle buy-in between ${futureFaceRange.low.toLocaleString('en-US')} and ${futureFaceRange.high.toLocaleString('en-US')} FLIP.`;
    bindText('craps-full-day-entry', futureDay
      ? compactRange(futureFaceRange)
      : dayRolling ? 'ROLLING' : formatCrapsCompactFlip(dayEntry));
    bindText('craps-full-day-separator', '+');
    bindText('craps-full-day-pot', dayBattle == null ? '—' : formatCrapsCompactFlip(dayBattle));
    const fullDayHead = this.querySelector('[data-bind="craps-day-head"]');
    const fullDayTerms = this.querySelector('[data-bind="craps-full-day-terms"]');
    const fullDayRangeNote = this.querySelector('[data-bind="craps-full-day-range-note"]');
    const fullDaySeparator = this.querySelector('[data-bind="craps-full-day-separator"]');
    const fullDayPotCell = this.querySelector('[data-bind="craps-full-day-pot-cell"]');
    // The rollover timer uses the normal CLOSES IN column. Tomorrow's combined
    // range then spans all three term columns without repeating micro-labels.
    if (fullDayHead) fullDayHead.colSpan = 1;
    if (fullDayTerms) {
      fullDayTerms.colSpan = futureDay || dayRolling ? 3 : 1;
      fullDayTerms.classList.toggle('craps-entry__tomorrow-range', futureDay);
      fullDayTerms.classList.toggle('craps-entry__rolling-terms', dayRolling);
      fullDayTerms.setAttribute('aria-label', futureDay
        ? combinedTomorrowRange
        : dayRolling
          ? 'Today\'s wager and battle-pool amounts are rolling.'
        : `Wager ${dayEntry?.toLocaleString?.('en-US') ?? 'unknown'} FLIP plus ${dayBattle?.toLocaleString?.('en-US') ?? 'unknown'} FLIP to the battle pool.`);
    }
    if (fullDayRangeNote) fullDayRangeNote.hidden = !futureDay;
    if (fullDaySeparator) fullDaySeparator.hidden = futureDay || dayRolling;
    if (fullDayPotCell) fullDayPotCell.hidden = futureDay || dayRolling;
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
        ? this.#busyKey?.startsWith?.('amend-') ? 'CHANGING…' : 'ENTERING…'
        : dayCanUpgrade
          ? `UPGRADE ${formatCrapsCompactFlip(dayUpgradePrice)}`
          : dayUpgradeWhenOpen
            ? 'UPGRADE WHEN OPEN'
          : dayAmendable
            ? dayNeedsAmend ? 'CHANGE BET' : 'ENTERED'
            : dayEntered
              ? 'ENTERED'
            : usePass
              ? '1 COMP'
              : `${dayPrice == null ? '—' : formatCrapsCompactFlip(dayPrice)} FLIP`;
      dayButton.setAttribute('aria-label', dayCanUpgrade
        ? `Upgrade the remaining open battles on your day ticket for ${dayUpgradePrice} FLIP.`
        : dayUpgradeWhenOpen
          ? 'This is a Low Stakes reservation. Its High Roller upgrade becomes available when that day opens and its exact terms land on-chain.'
        : dayAmendable
          ? dayNeedsAmend
            ? 'Change this Craps slate to the displayed chip placement.'
            : 'Entered in this Craps slate. Edit its chip placement.'
          : dayEntered
            ? 'This wallet is already entered for this Craps slate.'
          : dayReady
            ? usePass
              ? `Use one ${this.#highRoller ? 'High Roller' : 'Low Stakes'} Craps comp to reserve all seven battles. ${selectedPasses.toLocaleString('en-US')} ${selectedPasses === 1 ? 'comp' : 'comps'} available. ${this.#boardSet ? 'Your board is set.' : 'The contract will draw a random ten-chip board.'}`
              : `Buy all seven Craps battles in the ${this.#highRoller ? 'High Roller' : 'Low Stakes'} lane for ${dayPrice} FLIP. ${this.#boardSet ? 'Your board is set.' : 'The contract will draw a random ten-chip board.'}`
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
        ? this.#busyKey?.startsWith?.('amend-') ? 'CHANGING…' : 'ENTERING…'
        : tomorrowUpgradeWhenOpen
          ? 'UPGRADE WHEN OPEN'
        : tomorrowAmendable
          ? tomorrowNeedsAmend ? 'CHANGE BET' : 'ENTERED'
          : tomorrowTicket
            ? 'ENTERED'
          : tomorrowUsePass
            ? '1 COMP'
            : `${formatCrapsCompactFlip(tomorrowPrice)} FLIP`;
      tomorrowButton.setAttribute('aria-label', tomorrowAmendable
        ? tomorrowNeedsAmend
          ? 'Change tomorrow\'s Craps slate to the displayed chip placement.'
          : 'Entered in tomorrow\'s Craps slate. Edit its chip placement.'
        : tomorrowUpgradeWhenOpen
          ? 'This is a Low Stakes reservation. Its High Roller upgrade becomes available when tomorrow opens and its exact terms land on-chain.'
        : tomorrowTicket
          ? 'This wallet is already entered for tomorrow\'s Craps slate.'
        : tomorrowReady
          ? tomorrowUsePass
            ? `Use one ${this.#highRoller ? 'High Roller' : 'Low Stakes'} Craps comp to reserve tomorrow's seven battles. ${selectedPasses.toLocaleString('en-US')} ${selectedPasses === 1 ? 'comp' : 'comps'} available.`
            : `Reserve tomorrow's seven Craps battles in the ${this.#highRoller ? 'High Roller' : 'Low Stakes'} lane for ${tomorrowPrice} FLIP.`
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
    let awaitingSettlement = false;
    state.battles.forEach((battle, index) => {
      const row = rows[index];
      if (!row) return;
      const battleTerms = terms?.windows?.[index] ?? null;
      const result = snapshot?.results?.[index] ?? null;
      if (battle.state === 'closed' && !result) awaitingSettlement = true;
      const laneResult = crapsWinnerResultForLane(result, this.#highRoller);
      const revealState = result ? this.#resultRevealState(result) : null;
      const concealed = revealState != null;
      const revealCopy = crapsResultRevealCopy(revealState);
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
      row.dataset.resultVisibility = concealed ? 'concealed' : result ? 'revealed' : 'pending';
      row.dataset.entry = entry ? entry.high ? 'high' : 'normal' : 'none';
      row.dataset.terms = ready ? 'ready' : this.#schedulePending ? 'loading' : 'unavailable';
      const close = row.querySelector('[data-bind="craps-battle-countdown"]');
      const entryPriceNode = row.querySelector('[data-bind="craps-battle-entry"]');
      const potPriceNode = row.querySelector('[data-bind="craps-battle-pot"]');
      const termsCell = entryPriceNode?.closest('td');
      const separatorCell = row.querySelector('.craps-entry__operator.craps-entry__open-cell');
      const potCell = potPriceNode?.closest('td');
      const entrantNode = row.querySelector('[data-bind="craps-battle-entrants"]');
      const button = row.querySelector('[data-craps-entry="window"]');
      const enteredStatus = row.querySelector('[data-bind="craps-battle-entered"]');
      const resultBox = row.querySelector('[data-bind="craps-battle-result"]');
      const resultLocked = row.querySelector('[data-bind="craps-battle-result-locked"]');
      const resultStatus = row.querySelector('[data-bind="craps-battle-result-status"]');
      const resultRoute = row.querySelector('[data-bind="craps-battle-result-route"]');
      const resultDetails = row.querySelector('[data-bind="craps-battle-result-details"]');
      const winner = row.querySelector('[data-bind="craps-battle-winner"]');
      const payout = row.querySelector('[data-bind="craps-battle-payout"]');
      const boost = row.querySelector('[data-bind="craps-battle-boost"]');
      const boostDetail = row.querySelector('[data-bind="craps-battle-boost-detail"]');
      const resultBuyIn = row.querySelector('[data-bind="craps-battle-buyin"]');
      const replayButton = row.querySelector('[data-craps-winner-replay]');
      for (const cell of row.querySelectorAll('.craps-entry__open-cell')) cell.hidden = Boolean(result);
      const rolling = !ready && !result;
      if (termsCell) {
        termsCell.colSpan = rolling ? 3 : 1;
        termsCell.classList.toggle('craps-entry__rolling-terms', rolling);
        termsCell.setAttribute('aria-label', rolling
          ? `${battle.closeLabel} wager and battle-pool amounts are rolling.`
          : `Wager ${entryPrice?.toLocaleString?.('en-US') ?? 'unknown'} FLIP plus ${battlePrice?.toLocaleString?.('en-US') ?? 'unknown'} FLIP to the battle pool.`);
      }
      if (separatorCell) separatorCell.hidden = Boolean(result) || rolling;
      if (potCell) potCell.hidden = Boolean(result) || rolling;
      if (close) {
        close.textContent = battle.state === 'closed'
          ? 'SETTLING'
          : crapsBattleCountdownLabel(battle.closeAtMs, nowMs);
        close.dateTime = new Date(battle.closeAtMs).toISOString();
        close.title = `Closes ${battle.closeLabel} UTC`;
      }
      if (entryPriceNode) entryPriceNode.textContent = rolling ? 'ROLLING' : entryPrice == null ? '—' : formatCrapsCompactFlip(entryPrice);
      if (potPriceNode) potPriceNode.textContent = battlePrice == null ? '—' : formatCrapsCompactFlip(battlePrice);
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
      if (resultLocked) {
        resultLocked.hidden = !concealed;
        resultLocked.dataset.state = revealState ?? 'revealed';
      }
      if (resultStatus) resultStatus.textContent = revealCopy.status;
      if (resultRoute) resultRoute.textContent = revealCopy.route;
      if (resultDetails) resultDetails.hidden = concealed;
      this.#paintWinner(winner, concealed
        ? null
        : laneResult?.winner ?? (result && this.#highRoller ? 'NO WINNER' : null));
      if (payout) {
        payout.textContent = laneResult && !concealed ? crapsWinnerTotalLabel(laneResult) : '—';
        payout.title = laneResult && !concealed && laneResult.totalWonWei == null && laneResult.amountWei != null
          ? 'Known on-chain winner payment; exact total is still loading.'
          : '';
      }
      paintCrapsAddedValue(
        boostDetail,
        boost,
        laneResult && !concealed ? laneResult.winnerBoostWei : null,
        laneResult && !concealed ? laneResult.progressivePaidWei : null,
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
        row.setAttribute('aria-label', `Battle ${battle.number} ${revealCopy.aria}`);
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
          ? this.#busyKey?.startsWith?.('amend-') ? 'CHANGING…' : 'ENTERING…'
          : canUpgrade
            ? `UPGRADE ${formatCrapsCompactFlip(upgradePrice)}`
            : amendable
              ? entryNeedsAmend ? 'CHANGE BET' : 'ENTERED'
              : entry
                ? 'ENTERED'
              : battle.state === 'closed'
                ? 'SETTLING'
                : `${price == null ? '—' : formatCrapsCompactFlip(price)} FLIP`;
        button.setAttribute('aria-label', amendable
          ? entryNeedsAmend
            ? `Change Battle ${battle.number} to the displayed chip placement.`
            : `Entered in Battle ${battle.number}${entry.high ? ' as High Roller' : ''}. Edit its chip placement.`
          : entry && !canUpgrade
            ? `This wallet is entered in Battle ${battle.number}${entry.high ? ' as High Roller' : ''}.`
          : canUpgrade
            ? `Upgrade Battle ${battle.number} to High Roller for ${upgradePrice} FLIP.`
            : battle.state === 'closed'
              ? `Battle ${battle.number} is closed and settling`
              : ready
                ? `Enter Battle ${battle.number} for ${price} FLIP: ${entryPrice} FLIP wager plus ${battlePrice} FLIP to the battle pool.`
                : `Battle ${battle.number}, terms loading`);
      }
      if (enteredStatus) enteredStatus.hidden = Boolean(result) || !entry || canUpgrade || amendable;
    });
    this.#awaitingSettlement = awaitingSettlement;

    const previousEvent = crapsPreviousEventDuringRollover({
      day: state.day,
      wordValue: currentWordFromStore(state.day),
      result: snapshot?.yesterdayEventResult ?? this.#previousEventResult,
    });
    const previousEventEntrants = snapshot?.entrants?.previousEvent ?? this.#previousEventEntrants;
    const previousEventLaneResult = crapsWinnerResultForLane(previousEvent, this.#highRoller);
    const previousEventRevealState = previousEvent
      ? this.#resultRevealState(previousEvent)
      : null;
    const previousEventConcealed = previousEventRevealState != null;
    const previousEventRevealCopy = crapsResultRevealCopy(previousEventRevealState);
    const previousEventRow = this.querySelector('[data-bind="craps-previous-event-row"]');
    const previousEventWinner = this.querySelector('[data-bind="craps-previous-event-winner"]');
    const previousEventLocked = this.querySelector('[data-bind="craps-previous-event-result-locked"]');
    const previousEventStatus = this.querySelector('[data-bind="craps-previous-event-result-status"]');
    const previousEventRoute = this.querySelector('[data-bind="craps-previous-event-result-route"]');
    const previousEventDetails = this.querySelector('[data-bind="craps-previous-event-result-details"]');
    const previousEventEntrantNode = this.querySelector('[data-bind="craps-previous-event-entrants"]');
    const previousEventReplay = this.querySelector('.craps-entry__previous-event [data-craps-winner-replay]');
    if (previousEventRow) {
      previousEventRow.hidden = !previousEvent;
      previousEventRow.dataset.day = previousEvent ? String(previousEvent.day) : '';
      previousEventRow.dataset.resultVisibility = previousEventConcealed
        ? 'concealed'
        : previousEvent ? 'revealed' : 'pending';
      previousEventRow.setAttribute('aria-label', previousEvent
        ? previousEventConcealed
          ? `Day ${previousEvent.day} event ${previousEventRevealCopy.aria}`
          : previousEventLaneResult
            ? `Day ${previousEvent.day} ${this.#highRoller ? 'High Roller ' : ''}result`
            : `Day ${previousEvent.day} High Roller result, no winner`
        : 'Previous Craps event result unavailable');
    }
    if (previousEventLocked) {
      previousEventLocked.hidden = !previousEventConcealed;
      previousEventLocked.dataset.state = previousEventRevealState ?? 'revealed';
    }
    if (previousEventStatus) previousEventStatus.textContent = previousEventRevealCopy.status;
    if (previousEventRoute) previousEventRoute.textContent = previousEventRevealCopy.route;
    if (previousEventDetails) previousEventDetails.hidden = previousEventConcealed;
    bindText('craps-previous-event-label', previousEvent
      ? `DAY ${previousEvent.day} EVENT`
      : 'PREVIOUS EVENT');
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
    paintCrapsAddedValue(
      previousEventBoostDetail,
      previousEventBoost,
      previousEventConcealed ? null : previousEventLaneResult?.winnerBoostWei,
      previousEventConcealed ? null : previousEventLaneResult?.progressivePaidWei,
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
      const resultsHead = this.querySelector('[data-bind="craps-results-head"]');
      const order = crapsLobbyRowOrder({
        currentPeriod: state.currentPeriod,
        futureDay,
        settledPeriods: rows.flatMap((row, period) => (
          ['closed', 'completed'].includes(row.dataset.state) ? [period] : []
        )),
      });
      let resultsStarted = false;
      const appendLobbyRow = (row) => {
        if (!row) return;
        if (!row.hidden && row.dataset.state === 'completed' && !resultsStarted) {
          if (resultsHead) {
            resultsHead.hidden = false;
            body.appendChild(resultsHead);
          }
          resultsStarted = true;
        }
        body.appendChild(row);
      };
      for (const item of order) {
        appendLobbyRow(item === 'day' ? dayRow : item === 'tomorrow' ? tomorrowRow : rows[item]);
      }
      appendLobbyRow(previousEventRow);
      if (resultsHead) resultsHead.hidden = !resultsStarted;
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
    return this.#resultRevealState(result) != null;
  }

  #resultRevealState(result) {
    return crapsResultRevealState(result, {
      address: this.#schedulePlayer,
      replays: this.#resolvedReplays,
      states: this.#replayStates,
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
    const formatted = hasAmount ? crapsHeaderJackpotLabel(this.#progressiveWei) : null;
    const full = hasAmount ? roundedWholeFlip(this.#progressiveWei)?.toLocaleString('en-US') : null;
    meter.dataset.state = hasAmount ? 'live' : this.#progressivePending ? 'loading' : 'unavailable';
    amount.textContent = formatted ?? '—';
    meter.setAttribute('aria-label', hasAmount
      ? `Run It Up Progressive Jackpot ${full} FLIP`
      : this.#progressivePending ? 'Loading the Run It Up Progressive Jackpot' : 'Run It Up Progressive Jackpot amount unavailable');
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

  async #refreshAddedPerDay(force = false) {
    const day = currentDayFromStore();
    if (day == null
      || (this.#addedPending && this.#addedPerDayDay === day)
      || (!force && this.#addedPerDayDay === day && this.#addedPerDayWei != null)) return;
    const seq = ++this.#addedSeq;
    this.#addedPending = true;
    this.#addedPerDayDay = day;
    this.#render();
    try {
      const amountWei = await readCrapsAddedPerDay(day);
      if (seq !== this.#addedSeq || this.#addedPerDayDay !== day) return;
      if (amountWei != null) this.#addedPerDayWei = amountWei;
    } catch (_error) {
      // The full lobby read may still provide the value; preserve same-day data.
    } finally {
      if (seq === this.#addedSeq && this.#addedPerDayDay === day) {
        this.#addedPending = false;
        this.#render();
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
      this.#boardHistory = [];
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
          reportCrapsReplayFailure(error, 'preload');
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
      this.#render();
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
        onReplayDegraded: (error) => reportCrapsReplayFailure(error, 'side-lane'),
      });
      if (!result.ready) {
        this.#message = crapsReplayStatusCopy(crapsReplayLoaderState(result));
        return false;
      }
      this.#message = '';
      return true;
    } catch (error) {
      reportCrapsReplayFailure(error, 'winner-open');
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
        onReplayDegraded: (error) => reportCrapsReplayFailure(error, 'side-lane'),
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
      reportCrapsReplayFailure(error, 'pending-open');
      this.#replayStates.set(resolutionIdentity(replay), {
        ready: false,
        status: crapsReplayFailureStatus(error),
        pointer: null,
      });
      this.#render();
      this.#publishResolvedReplays();
      this.#scheduleReplayPoll();
      return false;
    }
    if (!result.ready) {
      this.#replayStates.set(resolutionIdentity(replay), crapsReplayLoaderState(result));
      this.#render();
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

  #paintInlineBoard() {
    const summary = crapsEntryBoardSummary(this.#boardBets);
    this.#contractChips = summary.contractChips;
    for (const spot of this.querySelectorAll('[data-craps-bet]')) {
      const id = String(spot.dataset.crapsBet ?? '');
      const field = CRAPS_ENTRY_BET_FIELDS[id];
      const count = field ? summary.counts[field] : 0;
      spot.dataset.count = String(count);
      spot.classList.toggle('has-chip', count > 0);
      spot.classList.toggle('is-full', count >= CRAPS_ENTRY_MAX_CHIPS_PER_BET);
      spot.disabled = this.#busyKey != null;
      const stack = spot.querySelector('[data-craps-stack]');
      if (stack && count > 0) stack.src = CRAPS_ENTRY_STACK_ART[count];
      const readable = id.replaceAll('-', ' ');
      const randomMinimumReached = summary.placed >= CRAPS_ENTRY_MAX_PLACED_CHIPS
        && count < CRAPS_ENTRY_MAX_CHIPS_PER_BET;
      spot.setAttribute('aria-label', `${readable}, ${count} ${count === 1 ? 'chip' : 'chips'}. ${count >= CRAPS_ENTRY_MAX_CHIPS_PER_BET
        ? 'Three chips on this spot. Tap to clear all three.'
        : randomMinimumReached
          ? 'Three chips must remain random. Tap Random to reclaim the last placed chip.'
          : 'Tap to add a chip, three maximum.'}`);
      spot.title = count >= CRAPS_ENTRY_MAX_CHIPS_PER_BET
        ? '3 chips · tap to clear this spot'
        : randomMinimumReached
          ? '3 RANDOM minimum · reclaim one before placing another'
          : 'Tap anywhere to add a chip · 3 max';
    }
    const randomCount = this.querySelector('[data-bind="craps-random-count"]');
    const chance = this.querySelector('[data-bind="craps-hot-shooter-chance"]');
    if (randomCount) randomCount.textContent = String(summary.random);
    if (chance) chance.textContent = String(summary.chance);
    const randomSlot = this.querySelector('[data-craps-random]');
    if (!randomSlot) return;
    randomSlot.disabled = this.#busyKey != null;
    randomSlot.dataset.randomCount = String(summary.random);
    const randomStacks = randomSlot.querySelectorAll('[data-craps-random-stack]');
    randomStacks.forEach((stack, index) => {
      const count = index === 0 ? summary.leftRandomStack : summary.rightRandomStack;
      stack.hidden = count === 0;
      if (count > 0) stack.src = CRAPS_ENTRY_STACK_ART[count];
    });
    const canReclaim = summary.placed > 0;
    randomSlot.setAttribute('aria-label', `${summary.random} random chips remaining. ${canReclaim ? 'Tap to reclaim the last manually placed chip.' : 'All ten chips will be placed randomly.'}`);
    randomSlot.title = canReclaim
      ? 'Tap to reclaim the last placed chip'
      : 'All 10 chips will be placed randomly';
  }

  #paintPlacePrompt(top, bottom, label) {
    const prompt = this.querySelector('.craps-entry__place-prompt');
    const topLine = prompt?.querySelector('[data-craps-place-prompt="top"]');
    const bottomLine = prompt?.querySelector('[data-craps-place-prompt="bottom"]');
    if (!prompt || !topLine || !bottomLine) return;
    topLine.textContent = top;
    bottomLine.textContent = bottom;
    prompt.setAttribute('aria-label', label);
  }

  #resetPlacePrompt() {
    if (this.#placePromptTimer != null) globalThis.clearTimeout?.(this.#placePromptTimer);
    this.#placePromptTimer = null;
    this.#paintPlacePrompt('PLACE', 'YOUR BETS', 'Place your bets');
  }

  #flashPlacePrompt(top, bottom) {
    if (this.#placePromptTimer != null) globalThis.clearTimeout?.(this.#placePromptTimer);
    this.#paintPlacePrompt(top, bottom, `${top} ${bottom}`);
    this.#placePromptTimer = globalThis.setTimeout?.(() => {
      this.#placePromptTimer = null;
      this.#paintPlacePrompt('PLACE', 'YOUR BETS', 'Place your bets');
    }, CRAPS_ENTRY_LIMIT_PROMPT_MS) ?? null;
  }

  #cycleInlineBet(id) {
    if (this.#busyKey != null) return;
    const field = CRAPS_ENTRY_BET_FIELDS[String(id ?? '')];
    if (!field) return;
    const next = { ...normalizedEntryBoardCounts(this.#boardBets) };
    const current = next[field] ?? 0;
    const clearedFullSpot = current >= CRAPS_ENTRY_MAX_CHIPS_PER_BET;
    const nextCount = crapsEntryNextSpotCount(current);
    if (nextCount === 0) {
      delete next[field];
      this.#boardHistory = this.#boardHistory.filter((placedField) => placedField !== field);
    } else {
      const exclusive = field === 'passLine'
        ? 'dontPassLine'
        : field === 'dontPassLine' ? 'passLine' : null;
      if (exclusive && next[exclusive] > 0) {
        delete next[exclusive];
        this.#boardHistory = this.#boardHistory.filter((placedField) => placedField !== exclusive);
      }
      if (crapsEntryBoardSummary(next).placed >= CRAPS_ENTRY_MAX_PLACED_CHIPS) {
        this.#flashPlacePrompt('MINIMUM 3', 'RANDOM');
        this.querySelector('[data-craps-random]')?.animate?.([
          { transform: 'scale(1)' },
          { transform: 'scale(1.055)' },
          { transform: 'scale(1)' },
        ], { duration: 220, easing: 'ease-out' });
        return;
      }
      next[field] = nextCount;
      this.#boardHistory.push(field);
    }
    if (!clearedFullSpot) this.#resetPlacePrompt();
    this.#boardBets = next;
    this.#boardSet = true;
    this.#contractChips = packCrapsEntryBoard(next);
    this.#message = '';
    this.#render();
    if (clearedFullSpot) this.#flashPlacePrompt('MAX 3', 'PER SLOT');
  }

  #reclaimInlineBet() {
    if (this.#busyKey != null) return;
    if (this.#boardHistory.length === 0) this.#boardHistory = entryBoardHistory(this.#boardBets);
    const field = this.#boardHistory.pop();
    if (!field) return;
    this.#resetPlacePrompt();
    const next = { ...normalizedEntryBoardCounts(this.#boardBets) };
    if (next[field] <= 1) delete next[field];
    else next[field] -= 1;
    this.#boardBets = next;
    this.#boardSet = true;
    this.#contractChips = packCrapsEntryBoard(next);
    this.#message = '';
    this.#render();
    this.querySelector('[data-craps-random]')?.animate?.([
      { transform: 'scale(1)' },
      { transform: 'scale(1.035)' },
      { transform: 'scale(1)' },
    ], { duration: 160, easing: 'ease-out' });
  }

  #openBoard(opener, entry = null) {
    const state = crapsEntryState({ day: currentDayFromStore() });
    const terms = this.#termsFor(state);
    const reference = terms?.windows?.find(Boolean) ?? null;
    const editingEntry = entry?.betId != null;
    const entryChips = Number(entry?.chips ?? 0) >>> 0;
    const confirm = async (wager) => {
      this.#boardBets = { ...wager.chips };
      this.#boardHistory = entryBoardHistory(wager.chips);
      this.#contractChips = wager.contractChips;
      this.#boardSet = true;
      this.#message = editingEntry
        ? wager.contractChips === entryChips
          ? 'Entry board unchanged.'
          : 'Chip placement changed. Select CHANGE BET to update it.'
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
      this.#message = 'Entry changed to your new board.';
      this.dispatchEvent(new CustomEvent(CRAPS_ENTRY_CONFIRMED_EVENT, {
        detail: { kind: 'amend', betId, contractChips: this.#contractChips, result },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this.#message = String(error?.userMessage || error?.message || 'The Craps bet was not changed. Try again.');
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

  async #buy(requestedKind, period, {
    targetDay = null,
    advancePastReserved = false,
  } = {}) {
    const fail = (message) => {
      this.#message = String(message || 'Craps entry was not submitted. Try again.');
      this.#render();
      return { ok: false, message: this.#message };
    };
    if (this.#busyKey != null) return fail('Another Craps action is already in progress.');
    const state = crapsEntryState({ day: currentDayFromStore() });
    if (state.day == null) return fail('The current Craps day is still loading. Try again.');
    const kind = requestedKind === 'day'
      ? state.dayEntryKind
      : requestedKind === 'future-day'
        ? 'future-day'
        : 'window';
    const battle = kind === 'window' ? state.battles[period] : null;
    if (kind === 'window' && (!battle || !battle.joinable)) {
      return fail('That Craps battle is no longer open. Choose another battle.');
    }
    const terms = this.#termsFor(state);
    const selectedTerms = kind === 'window' ? terms?.windows?.[period] : terms;
    const highMult = terms?.highMult ?? null;
    if (kind !== 'future-day' && (!selectedTerms || (this.#highRoller && highMult == null))) {
      return fail('The Craps buy-in is still loading. Try again.');
    }
    const selectedPasses = Number(this.#highRoller
      ? this.#passCredits?.high ?? 0
      : this.#passCredits?.normal ?? 0);
    const compEligible = !this.#forceFlipDay;
    if (kind === 'future-day' && compEligible && this.#passCredits == null) {
      return fail('Your Craps comps are still loading. Try again.');
    }
    const usePass = kind === 'future-day' && compEligible && selectedPasses > 0;

    let selection;
    let wager;
    const buildWager = (entryTargetDay) => {
      selection = crapsEntrySelection({
        day: state.day,
        kind,
        period,
        targetDay: entryTargetDay,
      });
      const baseWager = crapsEntryWager({
        day: state.day,
        kind,
        period,
        targetDay: entryTargetDay,
        buyInFlip: kind === 'day' ? terms.buyInFlip : selectedTerms?.buyInFlip,
        highRoller: this.#highRoller,
        highMult,
        contractChips: this.#contractChips,
        usePass,
      });
      wager = Object.freeze({
        ...baseWager,
        chips: { ...this.#boardBets },
      });
    };
    try {
      buildWager(targetDay);
    } catch (error) {
      return fail(error?.message);
    }

    const busyKey = requestedKind === 'day'
      ? 'day'
      : requestedKind === 'future-day'
        ? 'future-day'
        : `window-${period}`;
    this.#busyKey = busyKey;
    this.#message = '';
    this.#render();
    try {
      let result;
      let reservationRetries = 0;
      let purchaseCompleted = false;
      while (!purchaseCompleted) {
        try {
          result = await placeCrapsBonusEntry(wager);
          purchaseCompleted = true;
        } catch (error) {
          const canAdvance = advancePastReserved
            && kind === 'future-day'
            && error?.code === 'DayNotReservable'
            && selection.entryDay < 0xFFFFFF
            && reservationRetries < 32;
          if (canAdvance) {
            reservationRetries += 1;
            try {
              buildWager(selection.entryDay + 1);
            } catch (buildError) {
              const message = String(buildError?.message || 'Choose an unreserved future Craps day.');
              this.#message = message;
              return { ok: false, error: buildError, message };
            }
            continue;
          }
          const message = String(error?.userMessage || error?.message || 'Craps entry was not submitted. Try again.');
          this.#message = message;
          try { await this.#refreshSchedule(true); } catch (_refreshError) { /* retain the transaction error */ }
          return { ok: false, error, message };
        }
      }
      this.#message = kind === 'future-day'
        ? usePass
          ? `Day ${selection.entryDay} reserved with one ${this.#highRoller ? 'High Roller' : 'Low Stakes'} Craps comp.`
          : `Day ${selection.entryDay} purchased with FLIP in the ${this.#highRoller ? 'High Roller' : 'Low Stakes'} lane.`
        : `${kind === 'day' ? 'Full slate' : `Battle ${period + 1}`} entered in the ${this.#highRoller ? 'High Roller' : 'Low Stakes'} lane.`;
      try { await this.#refreshSchedule(true); } catch (_refreshError) { /* the purchase still succeeded */ }
      try {
        this.dispatchEvent(new CustomEvent(CRAPS_ENTRY_CONFIRMED_EVENT, {
          detail: { kind, period, day: selection.entryDay, battleSlot: selection.battleSlot, wager, result },
          bubbles: true,
          composed: true,
        }));
      } catch (_eventError) { /* transaction success is authoritative */ }
      return { ok: true, result, wager, day: selection.entryDay };
    } finally {
      if (this.#busyKey === busyKey) this.#busyKey = null;
      this.#render();
    }
  }
}

if (!customElements.get('app-craps-entry')) customElements.define('app-craps-entry', AppCrapsEntry);
