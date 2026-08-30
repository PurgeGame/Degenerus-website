// Craps Battle table. Each player places seven equal, generic chips before the
// shared run starts. The component owns presentation and validation only; a
// caller supplies placement/settlement callbacks or listens for its events.

import { lock, unlock } from '../app/scroll-lock.js';
import { dgnBadgePath } from '../app/dgn-traits.js';
import {
  readDegeneretteSpeed,
  writeDegeneretteSpeed,
} from '../app/degenerette-preferences.js';
import {
  sfxCoinflipLand,
  sfxCoinflipStart,
  sfxCoinflipWhoosh,
  sfxCrapsBetPlace,
  sfxCrapsBonusShooter,
  sfxCrapsDiceLand,
  sfxCrapsDiceTick,
  sfxCrapsDouble,
  sfxCrapsSettlement,
  sfxFanfare,
  sfxNoWin,
} from '../app/jackpot-sfx.js';
import { crapsReplayArtifactsToTableOptions } from '../craps/replay-adapter.js';
import { CRAPS_REPLAY_MAX_ROLLS } from '../craps/replay-contract.js';

export const CRAPS_TABLE_OPEN_EVENT = 'degenerus:craps:open';
export const CRAPS_TABLE_SUBMIT_EVENT = 'degenerus:craps:submit';
export const CRAPS_TABLE_SETTLE_EVENT = 'degenerus:craps:settle';
export const CRAPS_TABLE_REPLAY_EVENT = 'degenerus:craps:replay';

export const CRAPS_FLIP_WEI = 10n ** 18n;
export const CRAPS_MIN_LEG_FLIP = 60n;
export const CRAPS_MAX_LEG_FLIP = 16_777_215n;
export const CRAPS_MAX_FIXED_HANDS = 25;
// Mirrors `Craps._MAX_SLIP_HANDS`. 256 -> 512 at the 2026-08-29 re-vendor: a run no longer
// STOPS when it wins — it latches the goal and plays on — so it needs the room.
export const CRAPS_MAX_SLIP_HANDS = 512;
export const CRAPS_MAX_ODDS_MULT = 1_000;
export const CRAPS_PICKED_CHIPS = 7;
export const CRAPS_MAX_CHIPS_PER_BET = 4;
export const CRAPS_BONUS_WINDOWS_PER_DAY = 7;
// Mirrors `Craps._ESC_HANDS` / `Craps._ESC_CAP`, BOTH moved at the same re-vendor. A stale
// pair here recomputes a wager the chain never charged; see craps/replay-engine.js, which holds
// the same two numbers for the ladder replay.
export const CRAPS_ESCALATOR_SHOOTERS = 3;
export const CRAPS_MAX_WAGER_MULTIPLIER = 4_294_967_295;

export function canAcknowledgeCrapsResolution({
  completed = false,
  acknowledged = false,
  onAcknowledged = null,
} = {}) {
  return completed === true && acknowledged !== true && typeof onAcknowledged === 'function';
}

/** Semantic treatment for a transient seven between the dice. */
export function crapsSevenRollOutcome(frame = {}, { comeOut = false } = {}) {
  if (Number(frame?.total) !== 7) return '';
  if (/\bseven(?:\s|-)?out\b/i.test(String(frame?.label ?? ''))) return 'crap-out';
  return comeOut ? 'win' : 'crap-out';
}

/** Meaningful standings beats: a made point or the end of a shooter. */
export function crapsLeaderboardCheckpoint(frame = {}) {
  const label = String(frame?.label ?? '');
  const pointMade = frame?.pointMade === true
    || /\bpoint\s+(?:4|5|6|8|9|10)\s+made\b/i.test(label);
  const shooterEnded = frame?.shooterEnded === true
    || frame?.sevenOut === true
    || /\bseven(?:\s|-)?out\b/i.test(label)
    || Boolean(frame?.terminal);
  return pointMade || shooterEnded;
}

const CRAPS_DICE_BADGE_COLORS = Object.freeze([6, 4]); // silver, blue
const CRAPS_POINT_NUMBERS = Object.freeze([4, 5, 6, 8, 9, 10]);
const CRAPS_RACK_SLOTS = 50;
const CRAPS_LEADERBOARD_ROWS = 10;
const CRAPS_LEADERBOARD_OPPONENTS = CRAPS_LEADERBOARD_ROWS - 1;
const CRAPS_MAX_FELT_OPPONENTS = 2;
const CRAPS_PROGRESSIVE_COMMON_5X_BPS = 250_000n;
const CRAPS_PROGRESSIVE_RARE_5X_BPS = 1_200_000n;
const CRAPS_PROGRESSIVE_COMMON_20X_BPS = 500_000n;
const CRAPS_PROGRESSIVE_RARE_20X_BPS = 2_250_000n;
const CRAPS_LOCAL_PLAYER_COLOR = '#6ef08c';
const CRAPS_OPPONENT_MEDAL_COLORS = Object.freeze(['#f4c84f', '#c8d4df', '#c77b45']);
const CRAPS_BOARD_CHIPS = 10n;
const CRAPS_CHIP_ART = Object.freeze({
  red: '/shared/flip-chips/coin-high-red.svg',
  green: '/shared/flip-chips/coin-high-green.svg',
  gold: '/shared/flip-chips/coin-high-gold.svg',
  silver: '/shared/flip-chips/coin-high-silver.svg',
});
const CRAPS_CHIP_FACES = new Set(Object.keys(CRAPS_CHIP_ART));
const CRAPS_RESOLUTION_CSS_DURATIONS = Object.freeze([
  140, 160, 180, 220, 240, 260, 280, 300, 360, 400, 420,
  500, 520, 600, 680, 700, 720, 900, 2_200, 3_300,
]);

export function normalizeCrapsResolutionSpeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0.5, Math.min(3, Math.round(numeric * 2) / 2));
}

export function crapsResolutionDelay(milliseconds, speed = 1) {
  const duration = Number(milliseconds);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.round(duration / normalizeCrapsResolutionSpeed(speed)));
}

const lineBets = [
  {
    id: 'pass',
    contractField: 'passLine',
    kind: 'stake',
    label: 'Pass Line',
    shortLabel: 'PASS',
    pays: '1:1',
    edge: '2.79%',
    wins: 'Every 7 or 11 come-out and every point made',
    dies: 'Its first come-out 2, 3, or 12, or the seven-out',
    note: 'Pays and stays until its first loss',
  },
];

const dontPassBet = Object.freeze({
  id: 'dont-pass',
  contractField: 'dontPassLine',
  kind: 'stake',
  label: "Don't Pass Line",
  shortLabel: "DON'T PASS",
  pays: '3:4',
  edge: '13.73%',
  wins: 'Come-out 2 or 3, or a seven-out after a point is set',
  dies: 'Come-out 7 or 11, or the shooter makes the point',
  note: 'One decision per shooter; come-out 12 pushes and leaves it live',
});

const oddsBets = [
  {
    id: 'pass-odds',
    contractField: 'passOddsMult',
    kind: 'multiplier',
    label: 'Pass Odds',
    shortLabel: 'PASS ODDS',
    pays: '2:1 · 3:2 · 6:5',
    edge: '0%',
    wins: 'Every point made while the Pass Line is live',
    dies: 'A seven-out while riding a point',
    note: 'Requires Pass Line; stake equals line stake × multiplier and rides each point',
  },
];

const placeBets = [
  {
    id: 'place-4',
    contractField: 'place4',
    kind: 'stake',
    label: 'Place 4',
    shortLabel: '4',
    pays: '2:1',
    edge: '0%',
    wins: 'Every 4; the bet pays and stays up',
    dies: 'Any 7',
    note: 'True odds; off on every come-out',
    number: '4',
  },
  {
    id: 'place-5',
    contractField: 'place5',
    kind: 'stake',
    label: 'Place 5',
    shortLabel: '5',
    pays: '3:2',
    edge: '0%',
    wins: 'Every 5; the bet pays and stays up',
    dies: 'Any 7',
    note: 'True odds; off on every come-out',
    number: '5',
  },
  {
    id: 'place-6',
    contractField: 'place6',
    kind: 'stake',
    label: 'Place 6',
    shortLabel: '6',
    pays: '7:6',
    edge: '2.78%',
    wins: 'Every 6; the bet pays and stays up',
    dies: 'Any 7',
    note: 'Off on every come-out',
    number: '6',
  },
  {
    id: 'place-8',
    contractField: 'place8',
    kind: 'stake',
    label: 'Place 8',
    shortLabel: '8',
    pays: '7:6',
    edge: '2.78%',
    wins: 'Every 8; the bet pays and stays up',
    dies: 'Any 7',
    note: 'Off on every come-out',
    number: '8',
  },
  {
    id: 'place-9',
    contractField: 'place9',
    kind: 'stake',
    label: 'Place 9',
    shortLabel: '9',
    pays: '3:2',
    edge: '0%',
    wins: 'Every 9; the bet pays and stays up',
    dies: 'Any 7',
    note: 'True odds; off on every come-out',
    number: '9',
  },
  {
    id: 'place-10',
    contractField: 'place10',
    kind: 'stake',
    label: 'Place 10',
    shortLabel: '10',
    pays: '2:1',
    edge: '0%',
    wins: 'Every 10; the bet pays and stays up',
    dies: 'Any 7',
    note: 'True odds; off on every come-out',
    number: '10',
  },
];

const hardwayBets = [
  Object.freeze({
    id: 'hard-4',
    contractField: 'hard4',
    kind: 'stake',
    label: 'Hard Four',
    shortLabel: 'HARD 4',
    pays: '7:1',
    edge: '12.5%',
    wins: '2–2; the bet pays and stays up',
    dies: 'Easy 4, or any 7',
    note: 'Off on every come-out',
    dice: '2–2',
  }),
  Object.freeze({
    id: 'hard-8',
    contractField: 'hard8',
    kind: 'stake',
    label: 'Hard Eight',
    shortLabel: 'HARD 8',
    pays: '9:1',
    edge: '10%',
    wins: '4–4; the bet pays and stays up',
    dies: 'Easy 8, or any 7',
    note: 'Off on every come-out',
    dice: '4–4',
  }),
];

export const CRAPS_BET_GROUPS = Object.freeze([
  Object.freeze({
    id: 'line',
    label: 'Lines',
    instruction: 'Pays and stays until its first loss',
    bets: Object.freeze([...lineBets.map(Object.freeze), dontPassBet]),
  }),
  Object.freeze({
    id: 'odds',
    label: 'Behind the Line',
    instruction: 'True odds · tied to the Pass Line',
    bets: Object.freeze(oddsBets.map(Object.freeze)),
  }),
  Object.freeze({
    id: 'place',
    label: 'Place Bets + Hardways',
    instruction: 'Off on come-out · pay and stay until they die',
    bets: Object.freeze([...placeBets.map(Object.freeze), ...hardwayBets]),
  }),
]);

export const CRAPS_BETS = Object.freeze(CRAPS_BET_GROUPS.flatMap((group) => (
  group.bets.map((bet) => Object.freeze({ ...bet, group: group.id, groupLabel: group.label }))
)));

const CRAPS_BATTLE_BET_GROUPS = Object.freeze([
  Object.freeze({ id: 'place', label: 'Place Bets', bets: Object.freeze(placeBets.map(Object.freeze)) }),
  Object.freeze({ id: 'hard-4', label: 'Hard Four', bets: Object.freeze([hardwayBets[0]]) }),
  Object.freeze({ id: 'line', label: 'Pass Line', bets: Object.freeze(lineBets.map(Object.freeze)) }),
  Object.freeze({ id: 'dont-line', label: "Don't Pass Line", bets: Object.freeze([dontPassBet]) }),
  Object.freeze({ id: 'hard-8', label: 'Hard Eight', bets: Object.freeze([hardwayBets[1]]) }),
]);
const BATTLE_STAKE_BETS = Object.freeze(CRAPS_BETS.filter((bet) => bet.kind === 'stake'));
const BET_BY_ID = new Map(CRAPS_BETS.map((bet) => [bet.id, bet]));
const BET_ID_BY_FIELD = new Map(CRAPS_BETS.map((bet) => [bet.contractField, bet.id]));
const STAKE_BETS = CRAPS_BETS.filter((bet) => bet.kind === 'stake');
const PLAYER_COLORS = Object.freeze(['#55b8ff', '#ff66b3', '#a986ff', '#44d6a1', '#ff9157', '#e5cf58']);
const PLAYER_STACK_VARIANTS = Object.freeze(['-b', '-c', '-messy', '']);

function wholeFlip(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  const normalized = String(value ?? '').trim().replace(/[,_\s]/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  try { return BigInt(normalized); } catch (_error) { return null; }
}

function signedWholeFlip(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
  const normalized = String(value ?? '').trim().replace(/[,_\s]/g, '');
  if (!/^-?\d+$/.test(normalized)) return null;
  try { return BigInt(normalized); } catch (_error) { return null; }
}

/**
 * One physical rack scale shared by YOU and every featured battle entrant.
 * The exact percentage remains linear data, but the painted fill uses a
 * square-root curve so long goals still have useful resolution near the start.
 */
export function crapsRackPipLayout({
  bankrollFlip = 0,
  capacityFlip = 1,
  inPlayFlip = 0,
  slotCount = CRAPS_RACK_SLOTS,
} = {}) {
  const bankroll = wholeFlip(bankrollFlip) ?? 0n;
  const requestedCapacity = wholeFlip(capacityFlip) ?? 1n;
  const capacity = requestedCapacity > 0n ? requestedCapacity : 1n;
  const slots = clampInteger(slotCount, 0, 512, CRAPS_RACK_SLOTS);
  const clamped = bankroll > capacity ? capacity : bankroll;
  const basisPoints = capacity > 0n ? Number((clamped * 10_000n) / capacity) : 0;
  const percentage = Math.max(0, Math.min(100, basisPoints / 100));
  const visualFraction = percentage > 0 ? Math.sqrt(percentage / 100) : 0;
  const visualPercentage = visualFraction * 100;
  const filledCount = bankroll > 0n && slots > 0
    ? Math.max(1, Math.round(visualFraction * slots))
    : 0;
  const requestedInPlay = wholeFlip(inPlayFlip) ?? 0n;
  const inPlay = requestedInPlay > bankroll ? bankroll : requestedInPlay;
  const banked = bankroll - inPlay;
  let inPlayCount = inPlay > 0n && slots > 0
    ? Math.max(1, Math.round(Number(
        (inPlay * BigInt(filledCount) * 1_000n) / (bankroll || 1n),
      ) / 1_000))
    : 0;
  inPlayCount = Math.min(filledCount, inPlayCount);
  if (inPlay > 0n && banked > 0n && filledCount > 1) {
    inPlayCount = Math.max(1, Math.min(filledCount - 1, inPlayCount));
  }
  const bankedCount = Math.max(0, filledCount - inPlayCount);
  return Object.freeze({
    bankroll,
    capacity,
    percentage,
    visualPercentage,
    chipCount: filledCount,
    filledCount,
    inPlay,
    banked,
    inPlayCount,
    bankedCount,
    inPlayStart: bankedCount,
  });
}

/**
 * The post-goal tray measures the run's high-water score against the two
 * progressive points. Score basis points use 10,000 == 1x starting bankroll.
 */
export function crapsProgressiveTrayScale({
  startingBankrollFlip = 0,
  goalFlip = 0,
  highPointFlip = 0,
  thresholdScoreBps = null,
  slotCount = CRAPS_RACK_SLOTS,
} = {}) {
  const starting = wholeFlip(startingBankrollFlip) ?? 0n;
  const goal = wholeFlip(goalFlip) ?? 0n;
  const highPoint = wholeFlip(highPointFlip) ?? 0n;
  const explicitCommon = wholeFlip(thresholdScoreBps);
  if (starting <= 0n || highPoint <= 0n) return null;

  const goalScoreBps = (goal * 10_000n) / starting;
  const highGoal = goalScoreBps >= 100_000n;
  const commonScoreBps = explicitCommon != null && explicitCommon > 0n
    ? explicitCommon
    : highGoal ? CRAPS_PROGRESSIVE_COMMON_20X_BPS : CRAPS_PROGRESSIVE_COMMON_5X_BPS;
  const rareScoreBps = commonScoreBps >= CRAPS_PROGRESSIVE_COMMON_20X_BPS
    ? CRAPS_PROGRESSIVE_RARE_20X_BPS
    : CRAPS_PROGRESSIVE_RARE_5X_BPS;
  const scoreBps = (highPoint * 10_000n) / starting;
  const clampedScoreBps = scoreBps > rareScoreBps ? rareScoreBps : scoreBps;
  const slots = clampInteger(slotCount, 0, 512, CRAPS_RACK_SLOTS);
  const percentOf = (value) => Number((value * 10_000n) / rareScoreBps) / 100;
  const highPointPercent = Math.max(0, Math.min(100, percentOf(clampedScoreBps)));
  const achievedCount = slots > 0
    ? Math.max(1, Math.min(slots, Math.round((highPointPercent / 100) * slots)))
    : 0;

  return Object.freeze({
    startingBankrollFlip: starting,
    highPointFlip: highPoint,
    scoreBps,
    commonScoreBps,
    rareScoreBps,
    commonMultiple: Number(commonScoreBps / 10_000n),
    rareMultiple: Number(rareScoreBps / 10_000n),
    commonPointPercent: Math.max(0, Math.min(100, percentOf(commonScoreBps))),
    highPointPercent,
    achievedCount,
    slotCount: slots,
  });
}

function formatCrapsScoreMultiple(value) {
  const scoreBps = wholeFlip(value) ?? 0n;
  const hundredths = scoreBps / 100n;
  const whole = hundredths / 100n;
  const fraction = String(hundredths % 100n).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}×`;
}

/** Convert a multiplier-scaled payout into the base-board chips it represents. */
export function crapsPayoutChipCount(deltaFlip = 0, playedFlip = 0) {
  const delta = signedWholeFlip(deltaFlip) ?? 0n;
  const board = wholeFlip(playedFlip) ?? 0n;
  const baseChip = board / CRAPS_BOARD_CHIPS;
  if (delta <= 0n || baseChip <= 0n) return 0;
  const count = (delta + baseChip - 1n) / baseChip;
  return Number(count > 512n ? 512n : count);
}

function normalizedPayoutBetIds(input) {
  const values = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? Object.entries(input).filter(([, amount]) => amount === true || Number(amount) > 0).map(([id]) => id)
      : [];
  return [...new Set(values.map((value) => {
    const id = String(value ?? '').trim();
    return BET_BY_ID.has(id) ? id : BET_ID_BY_FIELD.get(id);
  }).filter(Boolean))];
}

const CRAPS_LINE_BET_IDS = Object.freeze(['pass', 'dont-pass']);
const CRAPS_LINE_BET_ID_SET = new Set(CRAPS_LINE_BET_IDS);

/** The physical placements dealt for a board phase. */
export function crapsBoardDealBetIds(input = [], { phase = 'live' } = {}) {
  const ids = normalizedPayoutBetIds(input);
  if (phase === 'come-out') return ids.filter((id) => CRAPS_LINE_BET_ID_SET.has(id));
  if (phase === 'point') return ids.filter((id) => !CRAPS_LINE_BET_ID_SET.has(id));
  return ids;
}

/** Bet spots held OFF for a come-out, preserving same-shooter line deaths. */
export function crapsComeOutHeldBetIds(input = [], {
  heldBetIds = [],
  resetLines = false,
} = {}) {
  const ids = normalizedPayoutBetIds(input);
  const available = new Set(ids);
  const held = new Set(normalizedPayoutBetIds(heldBetIds).filter((id) => available.has(id)));
  for (const id of ids) {
    if (CRAPS_LINE_BET_ID_SET.has(id)) {
      if (resetLines) held.delete(id);
    } else {
      held.add(id);
    }
  }
  return ids.filter((id) => held.has(id));
}

/** Exact per-roll bets that can no longer act again during the current shooter. */
export function crapsRetiredBetIds(frame = {}) {
  const explicit = normalizedPayoutBetIds(frame?.retiredBets ?? frame?.inactiveBets);
  const lost = normalizedPayoutBetIds(frame?.lostBets ?? frame?.losers);
  const payouts = normalizedPayoutBetIds(frame?.payoutBets ?? frame?.winningBets ?? frame?.payouts);
  return [...new Set([
    ...explicit,
    ...lost,
    ...(payouts.includes('dont-pass') ? ['dont-pass'] : []),
  ])];
}

function crapsPointFromRolls(rolls) {
  for (const roll of Array.isArray(rolls) ? rolls : []) {
    const total = Number(roll?.total ?? (Number(roll?.d1) + Number(roll?.d2)));
    if (CRAPS_POINT_NUMBERS.includes(total)) return total;
  }
  return null;
}

function wholeNumber(value) {
  const parsed = wholeFlip(value);
  if (parsed == null || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(parsed);
}

function clampInteger(value, minimum, maximum, fallback = minimum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function normalizeCrapsChipsPerBet(value) {
  const count = wholeNumber(value);
  if (count == null || count <= 0) return 0;
  return Math.min(count, CRAPS_MAX_CHIPS_PER_BET);
}


function inputMap(input) {
  if (input instanceof Map) return new Map(input);
  if (Array.isArray(input)) {
    return new Map(input.map((row) => [row?.id ?? row?.field, row?.amountFlip ?? row?.amount ?? row?.value]));
  }
  return new Map(Object.entries(input || {}));
}

function stakeMap(input) {
  const source = inputMap(input);
  const result = new Map();
  for (const bet of STAKE_BETS) {
    const raw = source.has(bet.id) ? source.get(bet.id) : source.get(bet.contractField);
    const amount = wholeFlip(raw);
    if (amount != null && amount > 0n) result.set(bet.id, amount);
  }
  return result;
}

// Battle entries place seven equal chips. Values are counts, never token
// denominations; the battle slot supplies the value represented by a chip.
function chipSelectionMap(input) {
  const source = inputMap(input);
  const result = new Map();
  for (const bet of BATTLE_STAKE_BETS) {
    const raw = source.has(bet.id) ? source.get(bet.id) : source.get(bet.contractField);
    const count = normalizeCrapsChipsPerBet(raw);
    if (count > 0) {
      result.set(bet.id, BigInt(count));
    }
  }
  return result;
}

function selectedChipCount(input) {
  const counts = input instanceof Map ? input : chipSelectionMap(input);
  return [...counts.values()].reduce((total, count) => total + count, 0n);
}

function contractChipCountsFrom(counts) {
  const value = (id) => Number(counts.get(id) ?? 0n);
  return Object.freeze({
    passLine: value('pass'),
    dontPassLine: value('dont-pass'),
    place4: value('place-4'),
    place5: value('place-5'),
    place6: value('place-6'),
    place8: value('place-8'),
    place9: value('place-9'),
    place10: value('place-10'),
    hard4: value('hard-4'),
    hard8: value('hard-8'),
  });
}

/**
 * `_packChips` — the thirty-bit chip word every CrapsBattle door takes since audit 40a533d2f.
 *
 * ⚠ THE ORDER HERE IS THE CONTRACT'S, NOT THE STRUCT'S. `contractChipCountsFrom` lists
 * `dontPassLine` second for readability; the packed word puts don't-pass LAST. Packing by object
 * key order would silently swap two legs and place every bet on the wrong side of the table.
 * Three bits a leg, low bits first, masked to 3 bits each exactly as the contract does.
 */
const PACKED_LEG_ORDER = Object.freeze([
  'passLine', 'place4', 'place5', 'place6', 'place8',
  'place9', 'place10', 'hard4', 'hard8', 'dontPassLine',
]);

function packContractChips(chipCounts) {
  let packed = 0;
  for (let i = 0; i < PACKED_LEG_ORDER.length; i += 1) {
    packed |= (Number(chipCounts[PACKED_LEG_ORDER[i]] ?? 0) & 7) << (3 * i);
  }
  return packed >>> 0;
}

/** Expand a stored uint32 board into the contract-field counts accepted by the picker. */
export function unpackCrapsContractChips(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0xFFFFFFFF) return Object.freeze({});
  const packed = numeric >>> 0;
  const counts = {};
  for (let i = 0; i < PACKED_LEG_ORDER.length; i += 1) {
    const count = (packed >>> (3 * i)) & 7;
    if (count > 0) counts[PACKED_LEG_ORDER[i]] = normalizeCrapsChipsPerBet(count);
  }
  return Object.freeze(counts);
}

function oddsFrom(input, explicit) {
  if (explicit != null) return wholeNumber(explicit) ?? 0;
  const source = inputMap(input);
  return wholeNumber(source.get('passOddsMult') ?? source.get('pass-odds')) ?? 0;
}

function shortPlayerLabel(value, fallback) {
  const label = String(value ?? '').trim();
  if (!label) return fallback;
  if (/^0x[0-9a-f]{40}$/i.test(label)) return `${label.slice(0, 6)}…${label.slice(-4)}`;
  return label;
}

function playerColor(value, index) {
  const color = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : PLAYER_COLORS[index % PLAYER_COLORS.length];
}

function playerAvatar(value) {
  const source = String(value ?? '').trim();
  return /^(?:\/(?!\/)|https:\/\/|data:image\/(?:png|jpeg|webp|gif|svg\+xml)[;,])/i.test(source) ? source : '';
}

function playerInitials(label) {
  const words = String(label ?? '').replace(/^0x/i, '').match(/[a-z0-9]+/gi) ?? [];
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || 'DG').toUpperCase();
}

/** Normalize settled, player-specific eligibility for one whole shooter. */
export function normalizeCrapsShooterBoost(value, fallbackPercent = null) {
  if (value == null || value === false) return null;
  let active = value === true;
  let percentValue = fallbackPercent;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
    const numeric = Number(value);
    active = Number.isFinite(numeric) && numeric > 0;
    percentValue = value;
  } else if (value && typeof value === 'object') {
    const activeValue = value.active ?? value.boosted ?? value.eligible;
    if (activeValue === false) return null;
    percentValue = value.percent
      ?? value.profitPercent
      ?? value.boostPercent
      ?? value.percentProfit
      ?? fallbackPercent;
    active = activeValue === true || percentValue != null;
  }
  if (!active) return null;
  const numericPercent = Number(percentValue);
  const percent = Number.isFinite(numericPercent) && numericPercent > 0
    ? Math.min(255, Math.floor(numericPercent))
    : null;
  return Object.freeze({ percent });
}

function normalizeCrapsShooterBoostSchedule(entry, exit) {
  const fallbackPercent = exit.shooterBoostPercent
    ?? exit.bonusPercent
    ?? entry.shooterBoostPercent
    ?? entry.bonusPercent
    ?? null;
  const aligned = exit.shooterBoosts
    ?? exit.shooterBonuses
    ?? entry.shooterBoosts
    ?? entry.shooterBonuses;
  if (Array.isArray(aligned)) {
    return Object.freeze(aligned.map((value) => normalizeCrapsShooterBoost(value, fallbackPercent)));
  }
  const ordinals = exit.boostedShooterOrdinals
    ?? exit.boostedShooters
    ?? entry.boostedShooterOrdinals
    ?? entry.boostedShooters;
  if (!Array.isArray(ordinals)) return Object.freeze([]);
  const valid = ordinals
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < CRAPS_MAX_SLIP_HANDS);
  const schedule = Array.from({ length: valid.length > 0 ? Math.max(...valid) + 1 : 0 }, () => null);
  valid.forEach((ordinal) => { schedule[ordinal] = normalizeCrapsShooterBoost(true, fallbackPercent); });
  return Object.freeze(schedule);
}

function normalizedCrapsChipFace(facing) {
  return CRAPS_CHIP_FACES.has(facing) ? facing : 'red';
}

function playerChipArt(value, facing = 'red') {
  const count = wholeFlip(value) ?? 1n;
  const level = Number(count > 10n ? 10n : count < 1n ? 1n : count);
  const face = normalizedCrapsChipFace(facing);
  return level === 1
    ? CRAPS_CHIP_ART[face]
    : `/shared/flip-chips/stack-${level}-high-${face}.svg`;
}

function escalatedChipVisualScale(effectiveChipCount) {
  void effectiveChipCount;
  // Pile SVGs already encode higher wagers by fitting more physical chips into
  // their fixed view box. Scaling that artwork down again made each chip
  // illegible, so every rung now uses the full felt lane allocated to it.
  return 1;
}

/** Contract-matching wager multiple for a zero-based shooter ordinal. */
export function crapsWagerMultiplierForShooter(shooterOrdinal = 0) {
  const ordinal = clampInteger(shooterOrdinal, 0, CRAPS_MAX_SLIP_HANDS - 1, 0);
  const multiple = 1n << BigInt(Math.floor(ordinal / CRAPS_ESCALATOR_SHOOTERS));
  return Number(multiple > BigInt(CRAPS_MAX_WAGER_MULTIPLIER)
    ? BigInt(CRAPS_MAX_WAGER_MULTIPLIER)
    : multiple);
}

/**
 * Turn an escalated spot into a bounded piece of physical chip art.
 * Up to 30 chips remain exact, split into balanced dealer stacks so a doubled
 * seven-stack becomes two sevens rather than a ten plus loose singles. Larger
 * bets graduate to the existing pile ladder, poker-tourney style. Each rung
 * stays full size so its individual chips remain readable on the felt.
 */
export function crapsEscalatedChipPresentation(chipCount = 0, shooterOrdinal = 0, facing = 'red') {
  const baseCount = wholeFlip(chipCount) ?? 0n;
  const multiplier = BigInt(crapsWagerMultiplierForShooter(shooterOrdinal));
  const effectiveCount = baseCount * multiplier;
  const face = normalizedCrapsChipFace(facing);
  if (effectiveCount <= 0n) {
    return Object.freeze({
      baseChipCount: baseCount.toString(),
      effectiveChipCount: '0',
      multiplier: Number(multiplier),
      visualScale: 1,
      kind: 'empty',
      stacks: Object.freeze([]),
      art: Object.freeze([]),
    });
  }

  if (effectiveCount <= 30n) {
    const columns = Number((effectiveCount + 9n) / 10n);
    const even = effectiveCount / BigInt(columns);
    const remainder = Number(effectiveCount % BigInt(columns));
    const stacks = Array.from({ length: columns }, (_, index) => (
      even + (index < remainder ? 1n : 0n)
    ));
    return Object.freeze({
      baseChipCount: baseCount.toString(),
      effectiveChipCount: effectiveCount.toString(),
      multiplier: Number(multiplier),
      visualScale: 1,
      kind: 'stacks',
      stacks: Object.freeze(stacks.map(String)),
      art: Object.freeze(stacks.map((count) => playerChipArt(count, face))),
    });
  }

  // Pile rung 5 represents roughly 37 chips and each following rung grows
  // about 1.45x. Number conversion is safe for a battle board: seven base
  // chips x uint32.max remains well below Number.MAX_SAFE_INTEGER.
  const pileLevel = Math.max(5, Math.min(20,
    5 + Math.round(Math.log(Number(effectiveCount) / 37) / Math.log(1.45))));
  const variant = face === 'green' ? '-c' : '';
  const pileArt = face === 'gold' || face === 'silver'
    ? `/shared/flip-chips/pile-${pileLevel}-metal-${face}.svg`
    : `/shared/flip-chips/pile-${pileLevel}${variant}.svg`;
  return Object.freeze({
    baseChipCount: baseCount.toString(),
    effectiveChipCount: effectiveCount.toString(),
    multiplier: Number(multiplier),
    visualScale: escalatedChipVisualScale(effectiveCount),
    kind: 'pile',
    stacks: Object.freeze([effectiveCount.toString()]),
    art: Object.freeze([pileArt]),
  });
}

function stackArtFor(amount, variant = '') {
  const value = wholeFlip(amount) ?? 0n;
  const thresholds = [60n, 150n, 300n, 600n, 1_500n, 3_000n, 6_000n, 15_000n];
  const level = 2 + thresholds.findIndex((threshold) => value <= threshold);
  const normalizedLevel = level < 2 ? 10 : Math.min(10, level);
  const safeVariant = PLAYER_STACK_VARIANTS.includes(variant) ? variant : '';
  return Object.freeze({
    level: normalizedLevel,
    scale: (0.9 + ((normalizedLevel - 2) * 0.035)).toFixed(3),
    src: `/shared/flip-chips/stack-${normalizedLevel}${safeVariant}.svg`,
  });
}

/** Aggregate read-only battle chips without mixing them into the local player's seven. */
export function aggregateCrapsTableBets(input = []) {
  const entries = Array.isArray(input) ? input : (input ? [input] : []);
  const betTotals = new Map();
  const players = new Map();

  const addBet = (id, amount, playerKey) => {
    if (amount <= 0n) return;
    const row = betTotals.get(id) ?? { amount: 0n, players: new Map() };
    row.amount += amount;
    row.players.set(playerKey, (row.players.get(playerKey) ?? 0n) + amount);
    betTotals.set(id, row);
  };

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const source = entry.chips ?? entry.bets ?? entry;
    const amounts = chipSelectionMap(source);
    const playerValue = entry.player ?? entry.address ?? null;
    const betId = entry.betId == null ? null : String(entry.betId);
    // Custom battles may allow one wallet to buy multiple seats. Bet id, when present, is
    // therefore the presentation identity; collapsing by address would merge two boards.
    const playerKey = betId
      ? `bet:${betId}`
      : playerValue ? String(playerValue).toLowerCase() : `table-seat-${index + 1}`;
    const playerIndex = players.size;
    const label = shortPlayerLabel(entry.label ?? entry.discordName ?? playerValue, `PLAYER ${playerIndex + 1}`);
    const exit = entry.resolution ?? entry.exit ?? {};
    const exitTypeRaw = String(exit.type ?? exit.outcome ?? entry.exitType ?? '').toLowerCase();
    const exitType = exitTypeRaw === 'bust' || exitTypeRaw === 'busted'
      ? 'bust'
      : exitTypeRaw === 'cashout' || exitTypeRaw === 'cashed-out' || exitTypeRaw === 'cashed out'
        ? 'cashout'
        : '';
    const exitRoll = exitType
      ? clampInteger(exit.roll ?? exit.atRoll ?? entry.exitRoll, 1, CRAPS_REPLAY_MAX_ROLLS, 1)
      : 0;
    const bankrolls = (Array.isArray(exit.bankrollsFlip ?? exit.bankrolls ?? entry.bankrollsFlip)
      ? (exit.bankrollsFlip ?? exit.bankrolls ?? entry.bankrollsFlip)
      : [])
      .map(wholeFlip)
      .filter((value) => value != null);
    const flipSurvivedValue = exit.survived ?? exit.flipSurvived ?? entry.survived ?? entry.flipSurvived;
    const flipSurvived = typeof flipSurvivedValue === 'boolean' ? flipSurvivedValue : null;
    const flipPaid = wholeFlip(exit.paidFlip ?? exit.flipPaid ?? entry.paidFlip ?? entry.flipPaid);
    const rawEnding = wholeFlip(
      exit.rawEndingFlip ?? exit.endingFlip ?? entry.rawEndingFlip ?? entry.endingFlip
        ?? exit.amountFlip ?? exit.amount ?? entry.exitAmountFlip,
    ) ?? 0n;
    const highPoint = wholeFlip(
      exit.highPointFlip ?? exit.peakFlip ?? entry.highPointFlip ?? entry.peakFlip,
    ) ?? rawEnding;
    const handsPlayed = clampInteger(
      exit.handsPlayed ?? entry.handsPlayed,
      0,
      CRAPS_MAX_SLIP_HANDS,
      0,
    );
    const standing = clampInteger(exit.standing ?? entry.standing, 0, 0xffff, 0);
    const shooterBoosts = normalizeCrapsShooterBoostSchedule(entry, exit);
    // Per-shooter survival-flip schedule, indexed by the shooter that just ended.
    const rawSurvivals = exit.survivals ?? entry.survivals;
    const survivals = Object.freeze((Array.isArray(rawSurvivals) ? rawSurvivals : []).map((flip) => {
      const survived = typeof flip === 'boolean'
        ? flip
        : flip && typeof flip === 'object' ? flip.survived : null;
      return typeof survived === 'boolean' ? Object.freeze({ survived }) : null;
    }));
    const rawRollEvents = exit.rollEvents ?? entry.rollEvents;
    const rollEvents = Object.freeze((Array.isArray(rawRollEvents) ? rawRollEvents : []).map((event) => (
      event && typeof event === 'object'
        ? Object.freeze({
            payoutBets: Object.freeze(normalizedPayoutBetIds(event.payoutBets ?? event.winningBets ?? event.payouts)),
            lostBets: Object.freeze(normalizedPayoutBetIds(event.lostBets ?? event.losers)),
            retiredBets: Object.freeze(crapsRetiredBetIds(event)),
            deltaFlip: signedWholeFlip(event.deltaFlip ?? event.delta)?.toString() ?? '0',
            bankrollFlip: wholeFlip(event.bankrollFlip ?? event.bankroll)?.toString() ?? null,
            shooter: clampInteger(event.shooter, 0, CRAPS_MAX_SLIP_HANDS - 1, 0),
          })
        : null
    )));
    const player = players.get(playerKey) ?? {
      key: playerKey,
      betId,
      player: playerValue == null ? null : String(playerValue),
      label,
      color: playerColor(entry.color, playerIndex),
      avatar: playerAvatar(entry.discordPfp ?? entry.discordAvatar ?? entry.avatarUrl ?? entry.avatar ?? entry.pfp),
      initials: playerInitials(label),
      variant: '',
      totalChips: 0n,
      passLineChips: 0n,
      lineChips: 0n,
      bets: new Set(),
      exitType,
      exitRoll,
      exitAmount: wholeFlip(exit.amountFlip ?? exit.amount ?? entry.exitAmountFlip) ?? 0n,
      startingBankroll: wholeFlip(exit.startingBankrollFlip ?? exit.startingBankroll ?? entry.bankrollFlip) ?? 0n,
      goal: wholeFlip(exit.goalFlip ?? entry.goalFlip) ?? 0n,
      bankrolls,
      flipSurvived,
      flipPaid,
      rawEnding,
      highPoint,
      handsPlayed,
      standing,
      shooterBoosts,
      survivals,
      rollEvents,
    };
    if (!player.avatar) {
      player.avatar = playerAvatar(entry.discordPfp ?? entry.discordAvatar ?? entry.avatarUrl ?? entry.avatar ?? entry.pfp);
    }
    if (player.flipSurvived == null && flipSurvived != null) player.flipSurvived = flipSurvived;
    if (player.flipPaid == null && flipPaid != null) player.flipPaid = flipPaid;
    if (player.shooterBoosts.length === 0 && shooterBoosts.length > 0) player.shooterBoosts = shooterBoosts;
    if (player.survivals.length === 0 && survivals.length > 0) player.survivals = survivals;
    if (player.rollEvents.length === 0 && rollEvents.length > 0) player.rollEvents = rollEvents;

    for (const bet of BATTLE_STAKE_BETS) {
      const amount = amounts.get(bet.id) ?? 0n;
      if (amount === 0n) continue;
      addBet(bet.id, amount, playerKey);
      player.totalChips += amount;
      if (bet.id === 'pass') player.passLineChips += amount;
      if (bet.id === 'pass' || bet.id === 'dont-pass') player.lineChips += amount;
      player.bets.add(bet.id);
    }
    if (player.totalChips > 0n) players.set(playerKey, player);
  });

  return Object.freeze({
    playerCount: players.size,
    players: Object.freeze([...players.values()].map((player) => Object.freeze({
      key: player.key,
      betId: player.betId,
      player: player.player,
      label: player.label,
      color: player.color,
      avatar: player.avatar,
      initials: player.initials,
      variant: player.variant,
      totalChips: player.totalChips.toString(),
      passLineChips: player.passLineChips.toString(),
      lineChips: player.lineChips.toString(),
      betCount: player.bets.size,
      exitType: player.exitType,
      exitRoll: player.exitRoll,
      exitAmountFlip: player.exitAmount.toString(),
      startingBankrollFlip: player.startingBankroll.toString(),
      goalFlip: player.goal.toString(),
      bankrollsFlip: Object.freeze(player.bankrolls.map((amount) => amount.toString())),
      shooterBoosts: player.shooterBoosts,
      survivals: player.survivals,
      rollEvents: player.rollEvents,
      betIds: Object.freeze([...player.bets]),
      survived: player.flipSurvived,
      paidFlip: player.flipPaid?.toString() ?? null,
      rawEndingFlip: player.rawEnding.toString(),
      highPointFlip: player.highPoint.toString(),
      handsPlayed: player.handsPlayed,
      standing: player.standing,
    }))),
    bets: Object.freeze(Object.fromEntries([...betTotals].map(([id, row]) => [id, Object.freeze({
      chipCount: row.amount.toString(),
      playerCount: row.players.size,
      players: Object.freeze([...row.players].map(([playerKey, amount]) => {
        const player = players.get(playerKey);
        return Object.freeze({
          key: player?.key ?? playerKey,
          player: player?.player ?? null,
          label: player?.label ?? 'PLAYER',
          color: player?.color ?? PLAYER_COLORS[0],
          variant: player?.variant ?? '',
          exitType: player?.exitType ?? '',
          exitRoll: player?.exitRoll ?? 0,
          chipCount: amount.toString(),
        });
      })),
    })]))),
  });
}

function contractBetsFrom(amounts, oddsMult) {
  const value = (id) => (amounts.get(id) ?? 0n).toString();
  return Object.freeze({
    passLine: value('pass'),
    dontPassLine: value('dont-pass'),
    place4: value('place-4'),
    place5: value('place-5'),
    place6: value('place-6'),
    place8: value('place-8'),
    place9: value('place-9'),
    place10: value('place-10'),
    hard4: value('hard-4'),
    hard8: value('hard-8'),
    passOddsMult: oddsMult,
  });
}

export function formatCrapsFlip(value) {
  const amount = wholeFlip(value) ?? 0n;
  return amount.toLocaleString('en-US');
}

export function formatCrapsCompactFlip(value) {
  const amount = wholeFlip(value) ?? 0n;
  const unit = amount >= 1_000_000n ? 1_000_000n : amount >= 10_000n ? 1_000n : 0n;
  if (unit === 0n) return formatCrapsFlip(amount);
  const suffix = unit === 1_000_000n ? 'M' : 'K';
  const tenths = ((amount * 10n) + (unit / 2n)) / unit;
  return tenths % 10n === 0n
    ? `${tenths / 10n}${suffix}`
    : `${tenths / 10n}.${tenths % 10n}${suffix}`;
}

/** Keep the marquee compact while showing hundredths of a million. */
export function formatCrapsJackpotFlip(value) {
  const amount = wholeFlip(value) ?? 0n;
  if (amount < 1_000_000n) return formatCrapsCompactFlip(amount);
  const hundredths = ((amount * 100n) + 500_000n) / 1_000_000n;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}M`;
}

/** Human-readable, one-based battle position with the correct teen suffixes. */
export function formatCrapsStanding(value) {
  const rank = wholeNumber(value);
  if (rank == null || rank < 1) return '—';
  const lastTwo = rank % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? 'th'
    : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th';
  return `${rank.toLocaleString('en-US')}${suffix}`;
}

/**
 * Prefer the publisher's full-field rank for this roll. A locally calculated
 * fallback is safe only when every entrant is actually loaded (as in the demo).
 */
export function crapsStandingAtRound({
  rankTimeline = [],
  roundNumber = 0,
  fallbackRank = null,
  fieldEntrants = null,
  loadedEntrants = null,
} = {}) {
  if (Array.isArray(rankTimeline) && rankTimeline.length > 0) {
    const index = clampInteger(roundNumber, 0, rankTimeline.length - 1, 0);
    const exact = wholeNumber(rankTimeline[index]);
    if (exact != null && exact >= 1) return exact;
  }
  const fallback = wholeNumber(fallbackRank);
  if (fallback == null || fallback < 1) return null;
  const field = wholeNumber(fieldEntrants);
  const loaded = wholeNumber(loadedEntrants);
  if (field != null && field > 0 && (loaded == null || loaded < field)) return null;
  return fallback;
}

/**
 * Build the ten-row viewport: YOU is always present and the other nine slots
 * belong to the strongest loaded opponents. An exact publisher rank may put
 * YOU below tenth without lying about the player's real place.
 */
export function crapsLeaderboardRows(standings = [], {
  localRank = null,
  rowLimit = CRAPS_LEADERBOARD_ROWS,
} = {}) {
  const limit = clampInteger(rowLimit, 1, CRAPS_LEADERBOARD_ROWS, CRAPS_LEADERBOARD_ROWS);
  const entries = Array.isArray(standings) ? standings : [];
  const local = entries.find((entry) => entry?.local) ?? null;
  if (!local) return entries.slice(0, limit);

  const exactLocalRank = wholeNumber(localRank) ?? wholeNumber(local.rank) ?? 1;
  const opponents = entries
    .filter((entry) => !entry?.local)
    .slice(0, Math.min(CRAPS_LEADERBOARD_OPPONENTS, Math.max(0, limit - 1)));
  let opponentRank = 1;
  const rows = opponents.map((entry) => {
    if (exactLocalRank <= limit && opponentRank === exactLocalRank) opponentRank += 1;
    return { ...entry, rank: opponentRank++ };
  });
  rows.push({ ...local, rank: exactLocalRank });
  rows.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.local !== right.local) return left.local ? -1 : 1;
    return left.opponentIndex - right.opponentIndex;
  });
  return rows;
}

/** Toggle one opponent on the felt, replacing the oldest pick at the two-player cap. */
export function toggleCrapsFeltOpponent(selectedKeys = [], playerKey = '') {
  const target = String(playerKey ?? '').trim();
  const selected = [...new Set((Array.isArray(selectedKeys) ? selectedKeys : [])
    .map((key) => String(key ?? '').trim())
    .filter(Boolean))].slice(-CRAPS_MAX_FELT_OPPONENTS);
  if (!target) return selected;
  if (selected.includes(target)) return selected.filter((key) => key !== target);
  return [...selected, target].slice(-CRAPS_MAX_FELT_OPPONENTS);
}

/**
 * Prefer a publisher-provided full-field count. A viewport-derived fallback is
 * exact only when the component has every entrant, as in the standalone demo.
 */
export function crapsRemainingEntrantsAtRound({
  remainingTimeline = [],
  roundNumber = 0,
  standings = [],
  fieldEntrants = null,
  loadedEntrants = null,
} = {}) {
  const field = wholeNumber(fieldEntrants);
  if (Array.isArray(remainingTimeline) && remainingTimeline.length > 0) {
    const index = clampInteger(roundNumber, 0, remainingTimeline.length - 1, 0);
    const exact = wholeNumber(remainingTimeline[index]);
    if (exact != null && (field == null || exact <= field)) return exact;
  }
  const loaded = wholeNumber(loadedEntrants);
  if (field != null && field > 0 && (loaded == null || loaded < field)) return null;
  if (!Array.isArray(standings)) return null;
  return standings.filter((entry) => ['live', 'risk'].includes(String(entry?.state))).length;
}

/**
 * Contract-order two finalized battle entries. The visible bankroll is zero for
 * a bust, but the battle comparator still ranks that run by shooters completed,
 * then by its raw ending remainder and entry-time standing.
 */
export function compareFinalCrapsBattleEntries(left = {}, right = {}, winnerBetId = null) {
  const winner = winnerBetId == null ? null : String(winnerBetId);
  const leftWinner = left.battleWinner === true
    || (winner != null && String(left.betId ?? '') === winner);
  const rightWinner = right.battleWinner === true
    || (winner != null && String(right.betId ?? '') === winner);
  if (leftWinner !== rightWinner) return leftWinner ? -1 : 1;

  const isGoal = (entry) => entry.rankStop === 'goal' || entry.state === 'cashout';
  const leftGoal = isGoal(left);
  const rightGoal = isGoal(right);
  if (leftGoal !== rightGoal) return leftGoal ? -1 : 1;

  const primary = (entry, goal) => goal
    ? (wholeFlip(entry.rankPeak) ?? 0n)
    : BigInt(wholeNumber(entry.rankHands) ?? 0);
  const leftPrimary = primary(left, leftGoal);
  const rightPrimary = primary(right, rightGoal);
  if (leftPrimary !== rightPrimary) return leftPrimary > rightPrimary ? -1 : 1;

  const leftEnd = wholeFlip(left.rankEnd) ?? 0n;
  const rightEnd = wholeFlip(right.rankEnd) ?? 0n;
  if (leftEnd !== rightEnd) return leftEnd > rightEnd ? -1 : 1;

  const leftStanding = wholeNumber(left.rankStanding) ?? 0;
  const rightStanding = wholeNumber(right.rankStanding) ?? 0;
  if (leftStanding !== rightStanding) return rightStanding - leftStanding;

  try {
    const leftId = BigInt(left.betId ?? 0);
    const rightId = BigInt(right.betId ?? 0);
    if (leftId !== rightId) return leftId < rightId ? -1 : 1;
  } catch (_error) { /* stable presentation fallback below */ }
  if (left.local !== right.local) return left.local ? -1 : 1;
  return (wholeNumber(left.opponentIndex) ?? 0) - (wholeNumber(right.opponentIndex) ?? 0);
}

function formatSignedCrapsFlip(value) {
  const amount = signedWholeFlip(value) ?? 0n;
  if (amount === 0n) return '±0';
  return `${amount > 0n ? '+' : '−'}${formatCrapsCompactFlip(amount > 0n ? amount : -amount)}`;
}

export function formatCrapsWei(value, fractionDigits = 2) {
  let amount;
  try { amount = BigInt(value ?? 0); } catch (_error) { amount = 0n; }
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / CRAPS_FLIP_WEI;
  const digits = clampInteger(fractionDigits, 0, 6, 2);
  if (digits === 0) return `${negative ? '-' : ''}${formatCrapsFlip(whole)}`;
  const scale = 10n ** BigInt(digits);
  const fraction = ((absolute % CRAPS_FLIP_WEI) * scale) / CRAPS_FLIP_WEI;
  const trimmed = fraction.toString().padStart(digits, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${formatCrapsFlip(whole)}${trimmed ? `.${trimmed}` : ''}`;
}

export function crapsFinalResolutionSummary({
  terminal = null,
  finalTray = 0n,
  battleWonByViewer = false,
  battlePayoutWei = null,
} = {}) {
  // A bust deletes its remainder. Never let a raw replay tail leak into the
  // player-facing return even if an older caller passes that tail as finalTray.
  const endingBankroll = terminal === 'bust' ? 0n : (wholeFlip(finalTray) ?? 0n);
  let payoutWei = null;
  try { payoutWei = battlePayoutWei == null ? null : BigInt(battlePayoutWei); }
  catch (_error) { payoutWei = null; }

  if (battleWonByViewer === true) {
    const hasPayout = payoutWei != null && payoutWei > 0n;
    const payoutCopy = hasPayout
      ? payoutWei % CRAPS_FLIP_WEI === 0n
        ? formatCrapsCompactFlip(payoutWei / CRAPS_FLIP_WEI)
        : formatCrapsWei(payoutWei)
      : null;
    return {
      event: 'BATTLE WON',
      result: payoutCopy ? `${payoutCopy} PAID` : 'WIN CONFIRMED',
      state: 'win',
      bayResult: 'win',
      ariaLabel: payoutCopy
        ? `Craps battle won. ${formatCrapsWei(payoutWei)} FLIP paid.`
        : 'Craps battle won.',
    };
  }

  const busted = terminal === 'bust';
  const goalLocked = terminal === 'goal';
  return {
    event: busted ? 'RUN BUSTED' : goalLocked ? 'GOAL LOCKED' : 'RUN COMPLETE',
    result: `${formatCrapsCompactFlip(endingBankroll)} RETURN`,
    state: busted ? 'loss' : goalLocked ? 'win' : 'ready',
    bayResult: busted ? 'loss' : goalLocked ? 'win' : 'push',
    ariaLabel: busted
      ? 'Craps bankroll run busted.'
      : goalLocked
        ? 'Craps bankroll goal locked.'
        : 'Craps bankroll run complete.',
  };
}

export function crapsStakeFor(bets = {}, passOddsMult) {
  const amounts = stakeMap(bets);
  const odds = Math.max(0, oddsFrom(bets, passOddsMult));
  const flat = STAKE_BETS.reduce((sum, bet) => sum + (amounts.get(bet.id) ?? 0n), 0n);
  return flat + ((amounts.get('pass') ?? 0n) * BigInt(odds));
}

export function crapsTheoFor(bets = {}) {
  const amounts = stakeMap(bets);
  const wei = (id) => (amounts.get(id) ?? 0n) * CRAPS_FLIP_WEI;
  return (wei('pass') * 7n) / 251n
    + (wei('dont-pass') * 7n) / 252n
    + wei('place-4') / 10n
    + wei('place-5') / 15n
    + wei('place-6') / 36n
    + wei('place-8') / 36n
    + wei('place-9') / 15n
    + wei('place-10') / 10n
    + wei('hard-4') / 8n
    + wei('hard-8') / 10n;
}

/** Split a live slip balance into chips riding the next shooter and chips banked. */
export function crapsRackSplit({
  bankrollFlip = 0,
  perHandFlip = 0,
  wagerMultiplier = 1,
  active = true,
  allInPlay = false,
} = {}) {
  const bankroll = wholeFlip(bankrollFlip) ?? 0n;
  const baseBoard = (wholeFlip(perHandFlip) ?? 0n)
    * BigInt(clampInteger(wagerMultiplier, 1, CRAPS_MAX_WAGER_MULTIPLIER, 1));
  let inPlay = 0n;
  if (active && bankroll > 0n) {
    if (allInPlay) inPlay = bankroll;
    else if (baseBoard > 0n && bankroll >= baseBoard) inPlay = baseBoard;
  }
  return Object.freeze({
    totalFlip: bankroll.toString(),
    inPlayFlip: inPlay.toString(),
    bankedFlip: (bankroll - inPlay).toString(),
  });
}

/** Classify only the chips safely off the felt against the next mandatory board. */
export function crapsRackReserveState({
  bankedFlip = 0,
  nextStakeFlip = 0,
  goalFlip = 0,
  active = true,
} = {}) {
  const banked = wholeFlip(bankedFlip) ?? 0n;
  const nextStake = wholeFlip(nextStakeFlip) ?? 0n;
  const goal = wholeFlip(goalFlip) ?? 0n;
  // Craps.sol checks goal before affordability. Once the off-table reserve
  // alone reaches goal, no result on the live felt can take that finish away.
  if (goal > 0n && banked >= goal) return 'goal-locked';
  if (active && nextStake > 0n && banked < nextStake) {
    return banked * 2n < nextStake ? 'bust-risk' : 'survival-risk';
  }
  return 'safe';
}

/** Contract stop decision made between shooters, before the next board is escrowed. */
export function crapsNextShooterAffordability({
  bankrollFlip = 0,
  nextStakeFlip = 0,
  goalFlip = 0,
} = {}) {
  const bankroll = wholeFlip(bankrollFlip) ?? 0n;
  const nextStake = wholeFlip(nextStakeFlip) ?? 0n;
  const goal = wholeFlip(goalFlip) ?? 0n;
  if (goal > 0n && bankroll >= goal) return 'goal';
  if (nextStake <= 0n || bankroll >= nextStake) return 'play';
  return bankroll * 2n < nextStake ? 'bust' : 'survival';
}

/** Contract-ready, JSON-safe placement payload. */
export function createCrapsWager({
  bets = {},
  passOddsMult,
  mode = 'fixed',
  shooters,
  hands,
  maxShooters = CRAPS_MAX_FIXED_HANDS,
  maxOdds = 3,
  bankrollFlip = 0,
  goalFlip = 0,
  rakeBps = 0,
  tableIndex = null,
} = {}) {
  const amounts = stakeMap(bets);
  const oddsMult = Math.max(0, oddsFrom(bets, passOddsMult));
  const allowance = clampInteger(maxOdds, 0, CRAPS_MAX_ODDS_MULT, 3);
  const fixedHands = clampInteger(
    hands ?? shooters ?? 1,
    1,
    Math.min(CRAPS_MAX_FIXED_HANDS, clampInteger(maxShooters, 1, CRAPS_MAX_FIXED_HANDS, CRAPS_MAX_FIXED_HANDS)),
    1,
  );
  const playMode = mode === 'slip' ? 'slip' : 'fixed';
  const bankroll = wholeFlip(bankrollFlip) ?? 0n;
  const goal = wholeFlip(goalFlip) ?? 0n;
  const rate = clampInteger(rakeBps, 0, 7_500, 0);
  const contractBets = contractBetsFrom(amounts, oddsMult);
  const perHand = crapsStakeFor(contractBets);
  const passLine = amounts.get('pass') ?? 0n;
  const oddsStake = passLine * BigInt(oddsMult);
  const theoPerHandWei = crapsTheoFor(contractBets);
  const rakePerUnitWei = (theoPerHandWei * BigInt(rate)) / 10_000n;
  const maxLoss = playMode === 'fixed' ? perHand * BigInt(fixedHands) : bankroll;
  const rows = CRAPS_BETS.flatMap((bet) => {
    const amount = bet.kind === 'multiplier' ? oddsStake : (amounts.get(bet.id) ?? 0n);
    if (amount === 0n) return [];
    return [{
      id: bet.id,
      field: bet.contractField,
      label: bet.label,
      group: bet.group,
      amountFlip: amount.toString(),
      ...(bet.kind === 'multiplier' ? { multiplier: oddsMult } : {}),
    }];
  });
  const errors = [];
  for (const bet of STAKE_BETS) {
    const amount = amounts.get(bet.id) ?? 0n;
    if (amount > 0n && amount < CRAPS_MIN_LEG_FLIP) {
      errors.push({ code: 'StakeBelowTableMinimum', message: `${bet.label} must be at least 60 FLIP.` });
    }
    if (amount > CRAPS_MAX_LEG_FLIP) {
      errors.push({ code: 'StakeAboveTableMax', message: `${bet.label} exceeds the 16,777,215 FLIP table max.` });
    }
  }
  if (perHand === 0n) errors.push({ code: 'NoStake', message: 'Place at least one 60 FLIP chip.' });
  if (oddsMult > 0 && passLine === 0n) {
    errors.push({ code: 'PassRequired', message: 'Pass Odds require a Pass Line bet.' });
  }
  if (oddsMult > allowance) {
    errors.push({ code: 'OddsAboveAllowance', message: `Your current Pass Odds allowance is ${allowance}×.` });
  }
  if (playMode === 'slip') {
    if (bankroll < perHand) {
      errors.push({ code: 'BankrollBelowStake', message: `Bankroll must cover the ${formatCrapsFlip(perHand)} FLIP base board.` });
    }
    if (goal !== 0n && goal <= bankroll) {
      errors.push({ code: 'BadGoal', message: 'Payout goal must exceed the starting bankroll, or be 0 for none.' });
    }
  }

  const bankrollWei = bankroll * CRAPS_FLIP_WEI;
  const goalWei = goal * CRAPS_FLIP_WEI;
  const method = playMode === 'fixed' ? 'placeBet' : 'placeSlip';
  const contractArgs = playMode === 'fixed'
    ? [contractBets, fixedHands]
    : [contractBets, bankrollWei.toString(), goalWei.toString(), false];

  return {
    mode: playMode,
    method,
    tableIndex: tableIndex == null ? null : String(tableIndex),
    contractBets,
    contractArgs,
    hands: playMode === 'fixed' ? fixedHands : 0,
    shooters: playMode === 'fixed' ? fixedHands : 0,
    maxSlipHands: playMode === 'slip' ? CRAPS_MAX_SLIP_HANDS : null,
    bankrollFlip: bankroll.toString(),
    bankrollWei: bankrollWei.toString(),
    goalFlip: goal.toString(),
    goalWei: goalWei.toString(),
    passOddsMult: oddsMult,
    maxOdds: allowance,
    oddsStakeFlip: oddsStake.toString(),
    betCount: rows.length,
    bets: rows,
    perHandFlip: perHand.toString(),
    perShooterFlip: perHand.toString(),
    maxLossFlip: maxLoss.toString(),
    totalFlip: maxLoss.toString(),
    stakedWei: (maxLoss * CRAPS_FLIP_WEI).toString(),
    theoPerHandWei: theoPerHandWei.toString(),
    rakeBps: rate,
    expectedRakebackPerUnitWei: rakePerUnitWei.toString(),
    expectedRakebackWei: playMode === 'fixed'
      ? (rakePerUnitWei * BigInt(fixedHands)).toString()
      : null,
    valid: errors.length === 0,
    errors,
  };
}

/** Backwards-compatible fixed-bet name retained for existing callers. */
export function createCrapsBetSlip(options = {}) {
  return createCrapsWager({ ...options, mode: 'fixed' });
}

/** Decode CrapsBetSettled.rolls into replayable hands and die pairs. */
export function decodeCrapsRolls(value) {
  let bytes;
  if (value instanceof Uint8Array) bytes = value;
  else if (Array.isArray(value)) bytes = Uint8Array.from(value);
  else {
    const hex = String(value ?? '').trim().replace(/^0x/i, '');
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('Invalid craps roll log.');
    bytes = Uint8Array.from(hex.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
  }
  const hands = [];
  let rolls = [];
  for (const packed of bytes) {
    if (packed === 0) {
      if (rolls.length > 0) hands.push({ ordinal: hands.length, rolls });
      rolls = [];
      continue;
    }
    const d1 = packed >> 4;
    const d2 = packed & 0x0f;
    if (d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) throw new Error('Invalid die in craps roll log.');
    rolls.push({ d1, d2, total: d1 + d2, hard: d1 === d2 });
  }
  if (rolls.length > 0) hands.push({ ordinal: hands.length, rolls });
  return hands;
}

/**
 * Pair exact resolver bankroll snapshots with the shared shooter dice.
 * Consumers should pass the post-shooter bankroll returned by resolveSlipAt;
 * the animation only presents those values and never recalculates settlement.
 */
export function createCrapsResolutionRun({
  startingBankrollFlip = 0,
  goalFlip = 0,
  hands = [],
  rolls = null,
} = {}) {
  const starting = wholeFlip(startingBankrollFlip) ?? 0n;
  const goal = wholeFlip(goalFlip) ?? 0n;
  let shooterHands = [];
  if (rolls != null) {
    try { shooterHands = decodeCrapsRolls(rolls); }
    catch (_error) { shooterHands = []; }
  }
  let previous = starting;
  let activeShooterBoost = null;
  let previousShooterEnded = true;
  const rawFrames = (Array.isArray(hands) ? hands : []).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const explicitBankroll = wholeFlip(
      entry.bankrollFlip ?? entry.endingBankrollFlip ?? entry.bankroll ?? entry.balanceFlip,
    );
    const explicitDelta = signedWholeFlip(entry.deltaFlip ?? entry.delta);
    let bankroll = explicitBankroll;
    if (bankroll == null && explicitDelta != null) bankroll = previous + explicitDelta;
    if (bankroll == null) return [];
    if (bankroll < 0n) bankroll = 0n;
    const startingBankroll = previous;
    const delta = bankroll - startingBankroll;
    const sharedRolls = shooterHands[index]?.rolls ?? [];
    const shownRoll = sharedRolls[0] ?? null;
    const dice = Array.isArray(entry.dice) ? entry.dice : null;
    const d1 = clampInteger(dice?.[0] ?? entry.d1 ?? shownRoll?.d1, 1, 6, 2);
    const d2 = clampInteger(dice?.[1] ?? entry.d2 ?? shownRoll?.d2, 1, 6, 5);
    const hasExplicitPoint = Object.prototype.hasOwnProperty.call(entry, 'point');
    const requestedPoint = Number(entry.point);
    const point = hasExplicitPoint
      ? (CRAPS_POINT_NUMBERS.includes(requestedPoint) ? requestedPoint : null)
      : crapsPointFromRolls(sharedRolls);
    const requestedTerminal = String(entry.terminal ?? '').toLowerCase();
    const terminalExact = Object.prototype.hasOwnProperty.call(entry, 'terminal');
    const survivalInput = entry.survivalFlip ?? entry.survival ?? null;
    const survivalValue = typeof survivalInput === 'boolean'
      ? survivalInput
      : survivalInput && typeof survivalInput === 'object'
        ? survivalInput.survived
        : null;
    const survivalSurvived = typeof survivalValue === 'boolean' ? survivalValue : null;
    const viewerTerminalValue = String(entry.viewerTerminal ?? '').toLowerCase();
    const viewerTerminal = viewerTerminalValue === 'goal' || viewerTerminalValue === 'bust'
      ? viewerTerminalValue
      : '';
    const viewerClosed = entry.viewerClosed === true;
    const goalReached = requestedTerminal === 'goal'
      || (!terminalExact && goal > 0n && bankroll >= goal);
    const terminal = goalReached
      ? 'goal'
      : requestedTerminal === 'bust'
        || (!terminalExact && (survivalSurvived === false || bankroll === 0n))
          ? 'bust'
          : '';
    const boostKey = ['shooterBoost', 'shooterBonus', 'bonusShooter', 'boosted']
      .find((key) => Object.prototype.hasOwnProperty.call(entry, key));
    if (previousShooterEnded) activeShooterBoost = null;
    if (boostKey) {
      activeShooterBoost = normalizeCrapsShooterBoost(
        entry[boostKey],
        entry.shooterBoostPercent ?? entry.bonusPercent ?? null,
      );
    }
    const shooterBoost = activeShooterBoost;
    const payoutKeys = ['payoutBets', 'winningBets', 'payouts'];
    const payoutBetsExact = payoutKeys.some((key) => Object.prototype.hasOwnProperty.call(entry, key));
    const payoutBets = normalizedPayoutBetIds(
      entry.payoutBets ?? entry.winningBets ?? entry.payouts,
    );
    const lostBets = normalizedPayoutBetIds(entry.lostBets ?? entry.losers);
    const retiredBets = crapsRetiredBetIds(entry);
    const label = String(entry.label ?? entry.result ?? (delta > 0n ? 'SHOOTER WIN' : delta < 0n ? 'SHOOTER LOSS' : 'PUSH'));
    previous = survivalSurvived === true
      ? bankroll * 2n
      : survivalSurvived === false ? 0n : bankroll;
    previousShooterEnded = Boolean(terminal) || /\bseven(?:\s|-)?out\b/i.test(label);
    return [Object.freeze({
      ordinal: index,
      shooter: wholeNumber(entry.shooter),
      globalRoll: wholeNumber(entry.globalRoll),
      startingBankrollFlip: startingBankroll.toString(),
      bankrollFlip: bankroll.toString(),
      deltaFlip: delta.toString(),
      d1,
      d2,
      total: d1 + d2,
      point,
      rollCount: sharedRolls.length,
      label,
      payoutBets: Object.freeze(payoutBets),
      payoutBetsExact,
      lostBets: Object.freeze(lostBets),
      retiredBets: Object.freeze(retiredBets),
      shooterBoost,
      survival: survivalSurvived == null
        ? null
        : Object.freeze({ survived: survivalSurvived }),
      viewerTerminal,
      viewerClosed,
      terminal,
      terminalExact,
    })];
  });
  const exactTimeline = rawFrames.length > 0 && rawFrames.every((frame) => frame.terminalExact);
  const exactTerminalIndex = exactTimeline
    ? rawFrames.findIndex((frame) => frame.terminal === 'goal' || frame.terminal === 'bust')
    : -1;
  const bustIndex = exactTimeline ? -1 : rawFrames.findIndex((frame) => frame.terminal === 'bust');
  const goalReachedIndex = exactTimeline ? -1 : rawFrames.findIndex((frame) => frame.terminal === 'goal');
  const goalSevenOutIndex = goalReachedIndex < 0
    ? -1
    : rawFrames.findIndex((frame, index) => (
        index >= goalReachedIndex && /\bseven(?:\s|-)?out\b/i.test(String(frame.label ?? ''))
      ));
  const goalWinsRace = !exactTimeline
    && goalSevenOutIndex >= 0
    && (bustIndex < 0 || goalSevenOutIndex < bustIndex);
  const terminalIndex = exactTimeline
    ? exactTerminalIndex
    : goalWinsRace ? goalSevenOutIndex : bustIndex;
  const frames = (terminalIndex >= 0 ? rawFrames.slice(0, terminalIndex + 1) : rawFrames)
    .map((frame, index) => Object.freeze({
      ...frame,
      terminal: index === terminalIndex
        ? exactTimeline ? frame.terminal : (goalWinsRace ? 'goal' : 'bust')
        : '',
    }));
  const peak = frames.reduce((highest, frame) => {
    const amount = BigInt(frame.bankrollFlip);
    return amount > highest ? amount : highest;
  }, starting);
  const capacity = goal > 0n ? goal : (peak > starting ? peak : starting * 2n || 1n);
  return Object.freeze({
    startingBankrollFlip: starting.toString(),
    goalFlip: goal.toString(),
    capacityFlip: capacity.toString(),
    frames: Object.freeze(frames),
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function betRules(bet) {
  return `Pays ${bet.pays}. Wins: ${bet.wins}. Loses: ${bet.dies}.${bet.note ? ` ${bet.note}.` : ''}`;
}

function betMarkup(bet) {
  if (bet.kind !== 'stake') return '';
  const numberClass = bet.number ? ' craps-bet--number' : '';
  const hardwayNumber = bet.id === 'hard-4' ? '4' : bet.id === 'hard-8' ? '8' : null;
  const pointPuck = bet.number
    ? `<span class="craps-point-puck" data-point-puck="${escapeHtml(bet.number)}" hidden aria-hidden="true">ON</span>`
    : '';
  const feltLegend = hardwayNumber
    ? `<span class="craps-bet__hardway-legend" aria-hidden="true"><small>HARD</small><strong>${hardwayNumber}</strong><em>PAYS ${escapeHtml(bet.pays)}</em></span>`
    : `<span class="craps-bet__name">${pointPuck}${bet.id === 'dont-pass'
        ? '<img class="craps-bet__wwxrp-mark" src="/shared/coinflip-face-red.svg" alt="" aria-hidden="true">'
        : ''}${escapeHtml(bet.shortLabel)}</span>
      <span class="craps-bet__odds"><small>PAYS</small>${escapeHtml(bet.pays)}</span>`;
  return `
    <button type="button" class="craps-bet${numberClass}" data-bet="${escapeHtml(bet.id)}"
            data-stake-bet data-active="false" title="${escapeHtml(betRules(bet))}">
      ${feltLegend}
      ${bet.dice ? `<span class="craps-bet__dice">${escapeHtml(bet.dice)}</span>` : ''}
      <span class="craps-bet__corner-grid" data-bind="craps-chip-corners" aria-hidden="true"></span>
    </button>`;
}

function groupMarkup(group) {
  return `
    <section class="craps-group craps-group--${escapeHtml(group.id)}" data-group="${escapeHtml(group.id)}"
             aria-label="${escapeHtml(group.label)}">
      <div class="craps-group__bets">${group.bets.map(betMarkup).join('')}</div>
    </section>`;
}

function battleMarkup() {
  return `
    <section class="craps-battle-board" data-bind="craps-battle-board"
             aria-label="Live top ten including you. Tap up to two opponents to show their chips on the felt. Rankings update after made points and completed shooters" hidden>
      <header class="craps-battle-board__head" aria-hidden="true">
        <strong>LIVE TOP 10</strong><small>TAP PLAYERS · MAX 2</small>
      </header>
      <div class="craps-battle-board__rows" data-bind="craps-battle-rows" role="list"></div>
    </section>`;
}

class AppCrapsTable extends HTMLElement {
  #initialized = false;
  #isOpen = false;
  #busy = false;
  #bets = new Map();
  #otherBets = new Map();
  #tablePlayers = [];
  #featuredPlayerKeys = [];
  #feltOpponentKeys = [];
  #leaderboardPlayerKeys = [];
  #leaderboardRanksByKey = new Map();
  #leaderboardViewerRank = null;
  #viewerBetId = null;
  #originalViewerBetId = null;
  #viewerLabel = 'YOU';
  #viewerAvatar = '';
  #viewerResult = null;
  #viewerBustRank = null;
  #leaderboardTimeline = [];
  #rankTimeline = [];
  #remainingEntrantsTimeline = [];
  #fieldEntrants = null;
  #history = [];
  #playedFlip = 600n;
  #battleStake = 0n;
  #bountyPoolWei = null;
  #bountyPoolScope = null;
  #addedFlipWei = null;
  #battleWonByViewer = false;
  #battlePayoutWei = null;
  #battleBoostWei = null;
  #battleWinningStop = null;
  #battleWinnerBetId = null;
  #battleBountyTimer = null;
  #battleSlot = null;
  #entryKind = 'custom';
  #entryPeriod = null;
  #entryLabel = '';
  #entryMultiple = 1;
  #completedShooters = 0;
  #wagerMultiplier = 1n;
  #bankroll = 0n;
  #goal = 0n;
  #jackpotAmountFlip = null;
  #jackpotState = 'live';
  #jackpotThresholdScoreBps = null;
  #jackpotWonAtScoreBps = null;
  #balance = null;
  #rakeBps = 0;
  #activityScore = null;
  #tableIndex = null;
  #tableResolved = false;
  #screen = 'placement';
  #pendingBetIds = [];
  #rolls = null;
  #preview = null;
  #resolutionRun = null;
  #resolutionActive = false;
  #resolutionIndex = -1;
  #resolutionTimer = null;
  #retiredBetIds = new Set();
  #viewerBustLocked = false;
  #autoRoll = true;
  #resolutionSpeed = 1;
  #awaitingRoll = false;
  #survivalFlipActive = false;
  #opponentCoinFlips = new Map();
  #showResolutionOnOpen = false;
  #resolutionCompleted = false;
  #resolutionAcknowledged = false;
  #onResolutionAcknowledged = null;
  #onPerspectiveSelect = null;
  #pendingPerspectiveBetId = null;
  #confirm = null;
  #settle = null;
  #returnFocus = null;
  #message = '';
  #openListener = (event) => this.open(event?.detail, event?.target);

  connectedCallback() {
    if (!this.#initialized) {
      this.#initialized = true;
      this.#renderShell();
      this.#wire();
    }
    globalThis.document?.addEventListener?.(CRAPS_TABLE_OPEN_EVENT, this.#openListener);
  }

  disconnectedCallback() {
    globalThis.document?.removeEventListener?.(CRAPS_TABLE_OPEN_EVENT, this.#openListener);
    this.#stopResolutionTimer();
    this.#stopBattleBountyTimer();
    if (this.#isOpen) {
      this.#isOpen = false;
      unlock();
    }
  }

  open(options = {}, opener = null) {
    this.#stopResolutionTimer();
    const retainedReturnFocus = this.#isOpen ? this.#returnFocus : null;
    const supplied = options && typeof options === 'object' ? options : {};
    const replayArtifacts = supplied.replay ?? supplied.replayArtifacts ?? null;
    const replayOptions = replayArtifacts && replayArtifacts.ready !== false
      ? crapsReplayArtifactsToTableOptions(replayArtifacts)
      : null;
    // Explicit call-site controls (manual roll, opener, etc.) may override presentation
    // defaults, while all settlement data comes from the verified replay projection.
    const detail = replayOptions ? { ...replayOptions, ...supplied } : supplied;
    const initial = detail.bets ?? detail.initialBets ?? {};
    this.#bets = chipSelectionMap(initial);
    this.#loadOtherBets(detail.otherPlayers ?? detail.otherBets ?? detail.tableBets ?? []);
    this.#featuredPlayerKeys = [];
    this.#feltOpponentKeys = [];
    this.#leaderboardPlayerKeys = [];
    this.#leaderboardRanksByKey = new Map();
    this.#leaderboardViewerRank = null;
    this.#viewerBustRank = null;
    this.#viewerBetId = detail.viewerBetId == null ? null : String(detail.viewerBetId);
    this.#originalViewerBetId = detail.originalViewerBetId == null
      ? this.#viewerBetId
      : String(detail.originalViewerBetId);
    this.#viewerLabel = shortPlayerLabel(
      detail.viewerLabel ?? detail.viewerName ?? detail.viewerDiscordName,
      'YOU',
    );
    this.#viewerAvatar = playerAvatar(
      detail.viewerDiscordPfp ?? detail.viewerDiscordAvatar ?? detail.viewerAvatarUrl ?? detail.viewerAvatar,
    );
    const viewerResult = detail.viewerResult && typeof detail.viewerResult === 'object'
      ? detail.viewerResult
      : {};
    const viewerStop = String(viewerResult.stop ?? '').trim().toLowerCase();
    this.#viewerResult = Object.freeze({
      stop: viewerStop === 'goal' || viewerStop === 'bust' ? viewerStop : null,
      handsPlayed: clampInteger(viewerResult.handsPlayed, 0, CRAPS_MAX_SLIP_HANDS, 0),
      rawEndingFlip: wholeFlip(viewerResult.rawEndingFlip ?? viewerResult.endingFlip),
      highPointFlip: wholeFlip(viewerResult.highPointFlip ?? viewerResult.peakFlip),
      standing: clampInteger(viewerResult.standing, 0, 0xffff, 0),
    });
    this.#leaderboardTimeline = Array.isArray(detail.leaderboardTimeline)
      ? detail.leaderboardTimeline.map((row) => ({
          shooter: clampInteger(row?.shooter, 0, CRAPS_MAX_SLIP_HANDS - 1, 0),
          opponentBetIds: Array.isArray(row?.opponentBetIds)
            ? row.opponentBetIds.map(String).slice(0, CRAPS_LEADERBOARD_ROWS)
            : [],
        }))
      : [];
    const fieldEntrants = wholeNumber(detail.fieldEntrants ?? detail.entrants);
    this.#fieldEntrants = fieldEntrants != null && fieldEntrants > 0 ? fieldEntrants : null;
    const rawRankTimeline = detail.rankTimeline ?? detail.rankByRoll ?? detail.positionTimeline;
    this.#rankTimeline = Object.freeze((Array.isArray(rawRankTimeline) ? rawRankTimeline : []).map((value) => {
      const rank = wholeNumber(value);
      if (rank == null || rank < 1 || (this.#fieldEntrants != null && rank > this.#fieldEntrants)) return null;
      return rank;
    }));
    const rawRemainingTimeline = detail.remainingEntrantsTimeline
      ?? detail.remainingTimeline
      ?? detail.remainingByRoll;
    this.#remainingEntrantsTimeline = Object.freeze(
      (Array.isArray(rawRemainingTimeline) ? rawRemainingTimeline : []).map((value) => {
        const remaining = wholeNumber(value);
        if (remaining == null || (this.#fieldEntrants != null && remaining > this.#fieldEntrants)) return null;
        return remaining;
      }),
    );
    const boardStake = wholeFlip(detail.boardStakeFlip ?? detail.postedStakeFlip);
    this.#playedFlip = wholeFlip(detail.playedFlip ?? detail.roundFlip)
      ?? (boardStake == null ? null : (boardStake * CRAPS_BOARD_CHIPS) / BigInt(CRAPS_PICKED_CHIPS))
      ?? 600n;
    this.#battleStake = wholeFlip(detail.battleStakeFlip ?? detail.bountyFlip) ?? 0n;
    const bountyPoolFlip = wholeFlip(detail.bountyPoolFlip ?? detail.totalBountyFlip);
    this.#bountyPoolWei = bountyPoolFlip == null
      ? wholeFlip(detail.bountyPoolWei ?? detail.totalBountyWei)
      : bountyPoolFlip * CRAPS_FLIP_WEI;
    this.#bountyPoolScope = String(detail.bountyPoolScope ?? '').trim().toLowerCase();
    const addedFlip = wholeFlip(detail.addedFlip ?? detail.addedBountyFlip);
    this.#addedFlipWei = addedFlip == null
      ? wholeFlip(detail.addedFlipWei ?? detail.addedBountyWei)
      : addedFlip * CRAPS_FLIP_WEI;
    this.#battleWonByViewer = detail.battleWonByViewer === true;
    this.#battlePayoutWei = wholeFlip(detail.battlePayoutWei ?? detail.battleAwardWei);
    this.#battleBoostWei = wholeFlip(detail.battleBoostWei ?? detail.battleBoostPaidWei);
    const battleWinningStop = wholeNumber(detail.battleWinningStop ?? detail.winningStop);
    this.#battleWinningStop = battleWinningStop === 0 || battleWinningStop === 1
      ? battleWinningStop
      : null;
    this.#battleWinnerBetId = detail.battleWinnerBetId == null
      ? null
      : String(detail.battleWinnerBetId);
    this.#battleSlot = detail.battleSlot ?? detail.slot ?? detail.tableIndex ?? null;
    const requestedEntryKind = String(detail.entryKind ?? '').trim().toLowerCase();
    this.#entryKind = requestedEntryKind === 'day'
      ? 'day'
      : requestedEntryKind === 'board'
        ? 'board'
        : ['window', 'bonus', 'battle-window'].includes(requestedEntryKind)
          ? 'window'
          : 'custom';
    this.#entryPeriod = this.#entryKind === 'window'
      ? clampInteger(detail.entryPeriod ?? detail.period, 0, CRAPS_BONUS_WINDOWS_PER_DAY - 1, 0)
      : null;
    this.#entryLabel = String(detail.entryLabel ?? '').trim().slice(0, 80);
    this.#entryMultiple = clampInteger(detail.entryMultiple ?? detail.multiple, 1, 256, 1);
    this.#completedShooters = clampInteger(
      detail.completedShooters
        ?? detail.shooterOrdinal
        ?? (detail.shooterNumber == null ? 0 : Number(detail.shooterNumber) - 1),
      0,
      CRAPS_MAX_SLIP_HANDS - 1,
      0,
    );
    this.#wagerMultiplier = BigInt(crapsWagerMultiplierForShooter(this.#completedShooters));
    this.#bankroll = wholeFlip(detail.bankrollFlip) ?? 0n;
    this.#goal = wholeFlip(detail.goalFlip) ?? 0n;
    const jackpot = detail.jackpot && typeof detail.jackpot === 'object' ? detail.jackpot : {};
    this.#jackpotAmountFlip = wholeFlip(
      jackpot.amountFlip
        ?? jackpot.amount
        ?? detail.jackpotAmountFlip
        ?? detail.progressiveJackpotFlip,
    );
    const jackpotResult = String(
      jackpot.status
        ?? jackpot.result
        ?? detail.jackpotStatus
        ?? '',
    ).trim().toLowerCase();
    const otherWon = jackpot.claimedByOther === true
      || jackpot.eligible === false
      || ['won-other', 'other-won', 'ineligible', 'lost'].includes(jackpotResult);
    const viewerWon = jackpot.wonByViewer === true
      || ['won-you', 'you-won', 'viewer-won'].includes(jackpotResult);
    this.#jackpotState = otherWon ? 'won-other' : viewerWon ? 'won-you' : 'live';
    const jackpotThresholdScoreBps = wholeFlip(
      jackpot.thresholdScoreBps ?? detail.jackpotThresholdScoreBps,
    );
    this.#jackpotThresholdScoreBps = jackpotThresholdScoreBps != null && jackpotThresholdScoreBps > 0n
      ? jackpotThresholdScoreBps
      : null;
    // Bounded by the widest cutoff (2,250,000 bps = 225x) with headroom, NOT by a roll count —
    // CRAPS_REPLAY_MAX_ROLLS would clamp every real score to garbage.
    const jackpotWonAtScoreBps = jackpot.wonAtScoreBps ?? detail.jackpotWonAtScoreBps;
    this.#jackpotWonAtScoreBps = jackpotWonAtScoreBps == null
      ? null
      : clampInteger(jackpotWonAtScoreBps, 0, 1_000_000_000, 0);
    this.#history = [];
    this.#balance = detail.balanceFlip == null ? null : (wholeFlip(detail.balanceFlip) ?? 0n);
    this.#rakeBps = clampInteger(detail.rakeBps, 0, 7_500, 0);
    const score = detail.degenScore ?? detail.activityScore;
    this.#activityScore = score == null ? null : (wholeFlip(score) ?? 0n);
    this.#tableIndex = detail.tableIndex == null ? null : String(detail.tableIndex);
    this.#tableResolved = Boolean(detail.tableResolved ?? detail.resolved);
    const requestedScreen = String(detail.screen ?? detail.view ?? '').trim().toLowerCase();
    this.#screen = this.#tableResolved || ['battle', 'live', 'spectate'].includes(requestedScreen)
      ? 'battle'
      : 'placement';
    this.#pendingBetIds = Array.isArray(detail.pendingBetIds)
      ? detail.pendingBetIds.map(String).filter((id) => /^\d+$/.test(id))
      : [];
    this.#rolls = detail.rolls ?? null;
    this.#preview = detail.preview && typeof detail.preview === 'object' ? { ...detail.preview } : null;
    this.#resolutionActive = false;
    this.#resolutionIndex = -1;
    this.#viewerBustLocked = false;
    this.#autoRoll = detail.autoRoll !== false;
    this.#setResolutionSpeed(readDegeneretteSpeed());
    this.#awaitingRoll = false;
    this.#survivalFlipActive = false;
    this.#opponentCoinFlips.clear();
    this.#showResolutionOnOpen = Boolean(detail.showResolution ?? detail.animateResolution);
    this.#resolutionCompleted = false;
    this.#resolutionAcknowledged = false;
    this.#resetBattleBountyReceipt();
    this.#onResolutionAcknowledged = typeof detail.onResolutionAcknowledged === 'function'
      ? detail.onResolutionAcknowledged
      : null;
    this.#onPerspectiveSelect = typeof detail.onPerspectiveSelect === 'function'
      ? detail.onPerspectiveSelect
      : null;
    this.#pendingPerspectiveBetId = null;
    this.#confirm = typeof detail.confirm === 'function' ? detail.confirm : null;
    this.#settle = typeof detail.settle === 'function' ? detail.settle : null;
    this.#busy = false;
    this.#message = '';
    this.#returnFocus = detail.opener
      || opener
      || retainedReturnFocus
      || globalThis.document?.activeElement
      || null;

    if (detail.bankrollFlip == null) {
      const base = this.#wager().perHandFlip;
      if (BigInt(base) > 0n) this.#bankroll = BigInt(base) * 10n;
    }
    this.#resolutionRun = createCrapsResolutionRun({
      startingBankrollFlip: this.#bankroll,
      goalFlip: this.#goal,
      hands: detail.resolutionHands ?? detail.runHands ?? detail.bankrollRun ?? [],
      rolls: this.#rolls,
    });
    this.#syncWagerMultiplier(0);

    const dialog = this.querySelector('[data-bind="craps-dialog"]');
    const card = this.querySelector('[data-bind="craps-card"]');
    if (!dialog) return;
    if (!this.#isOpen) lock();
    this.#isOpen = true;
    dialog.hidden = false;
    dialog.removeAttribute?.('hidden');
    if (card) card.dataset.screen = this.#screen;
    this.#renderChips();
    this.#render();
    this.#resetBoardBetState();
    this.#setResolutionVisible(false);
    if (this.#showResolutionOnOpen && this.#resolutionRun.frames.length > 0) {
      const resumeResolutionIndex = wholeNumber(detail.resumeResolutionIndex);
      this.#resolutionTimer = globalThis.setTimeout?.(
        () => {
          this.#resolutionTimer = null;
          this.#startResolution({ resumeResolutionIndex });
        },
        this.#resolutionDelay(80),
      ) ?? null;
    }
    try { this.querySelector('[data-stake-bet]')?.focus?.({ preventScroll: true }); }
    catch (_error) { /* focus is progressive enhancement */ }
  }

  close() { this.#close(); }

  /** Replace the live table snapshot without disturbing the player's editable board. */
  setOtherBets(input = []) {
    this.#loadOtherBets(input);
    if (this.#initialized && this.#isOpen) this.#render();
  }

  #loadOtherBets(input) {
    const snapshot = aggregateCrapsTableBets(input);
    this.#tablePlayers = [...snapshot.players];
    this.#otherBets = new Map(Object.entries(snapshot.bets).map(([id, row]) => [id, {
      amount: BigInt(row.chipCount),
      playerCount: row.playerCount,
      players: row.players.map((player) => ({ ...player, amount: BigInt(player.chipCount) })),
    }]));
  }

  #renderShell() {
    const rackChips = Array.from(
      { length: CRAPS_RACK_SLOTS },
      () => '<i class="df-bankroll__chip craps-run-chip"></i>',
    ).join('');
    this.innerHTML = `
      <div class="craps-dialog" data-bind="craps-dialog" role="dialog" aria-modal="true"
           aria-label="Degenerus craps table" hidden>
        <button type="button" class="craps-dialog__backdrop" data-bind="craps-close" aria-label="Close craps table"></button>
        <section class="craps-dialog__card" data-bind="craps-card" tabindex="-1">
          <header class="craps-dialog__head">
            <span class="craps-dialog__dice" aria-hidden="true"><i data-face="2"></i><i data-face="5"></i></span>
            <span class="craps-dialog__heading">
              <h2 id="craps-title">CRAPS</h2>
              <small data-bind="craps-entry-label" hidden></small>
            </span>
            <aside class="craps-dialog__prizes" data-bind="craps-prize-marquee"
                   aria-label="Current battle prizes" hidden>
              <span class="craps-dialog__prize craps-dialog__prize--jackpot"
                    data-bind="craps-jackpot-marquee" data-state="building" hidden>
                <small class="craps-dialog__jackpot-label"><span>RUN IT UP</span><span>JACKPOT</span></small>
                <strong><output data-bind="craps-jackpot-marquee-amount">—</output></strong>
              </span>
              <span class="craps-dialog__prize craps-dialog__prize--goal"
                    data-bind="craps-title-goal" hidden>
                <small>GOAL</small>
                <strong><output data-bind="craps-title-goal-amount">—</output><em>FLIP</em></strong>
              </span>
              <span class="craps-dialog__prize craps-dialog__prize--bounty"
                    data-bind="craps-bounty-marquee" hidden>
                <small data-bind="craps-bounty-label">BATTLE</small>
                <strong><output data-bind="craps-bounty-amount">—</output><em>FLIP</em></strong>
                <span class="craps-dialog__prize-added" data-bind="craps-bounty-added" data-state="unavailable">
                  <small>ADDED</small>
                  <strong><output data-bind="craps-bounty-added-amount">—</output><em>FLIP</em></strong>
                </span>
              </span>
            </aside>
            <button type="button" class="craps-dialog__close" data-bind="craps-close" aria-label="Close craps table">×</button>
          </header>

          <div class="craps-table-rail" data-bind="craps-table-rail">
            ${battleMarkup()}
            <div class="craps-table-felt">
              <div class="craps-groups">
                ${CRAPS_BATTLE_BET_GROUPS.map(groupMarkup).join('')}
                <section class="craps-dice-bay" data-bind="craps-dice-bay" data-state="open" aria-label="Shared table dice roll">
                  <span class="craps-dice-bay__dice" aria-hidden="true">
                    <img data-bind="craps-die-one" data-face="2" src="${dgnBadgePath(3, 1, CRAPS_DICE_BADGE_COLORS[0])}" alt="">
                    <output class="craps-dice-bay__lock-readout" data-bind="craps-dice-lock-readout" hidden>
                      <strong class="craps-dice-bay__lock-number" data-bind="craps-dice-lock-number">—</strong>
                    </output>
                    <img data-bind="craps-die-two" data-face="5" src="${dgnBadgePath(3, 4, CRAPS_DICE_BADGE_COLORS[1])}" alt="">
                  </span>
                  <span class="craps-survival-stage" data-bind="craps-survival-stage" hidden aria-hidden="true">
                    <span class="craps-survival-coin" data-bind="craps-survival-coin"><span class="craps-survival-coin__face"></span></span>
                    <img class="craps-survival-landed" data-bind="craps-survival-landed" src="/shared/coinflip-face-red.svg" alt="" hidden>
                  </span>
                </section>
                <section class="craps-roll-board" data-bind="craps-roll-board" data-state="waiting" aria-live="polite">
                  <span class="craps-roll-board__event">
                    <small>OUTCOME</small><strong data-bind="craps-roll-event">COME-OUT WAITING</strong>
                    <output class="craps-roll-board__boost-multiplier"
                            data-bind="craps-shooter-boost-multiplier" hidden></output>
                  </span>
                  <span class="craps-roll-board__place"><small>PLACE</small><strong data-bind="craps-resolution-standing">—</strong></span>
                  <span class="craps-roll-board__remaining"><small>REMAINING</small><strong data-bind="craps-battle-remaining">—</strong></span>
                  <span class="craps-roll-board__entrants"><small>ENTRANTS</small><strong data-bind="craps-battle-entrants">—</strong></span>
                  <span class="craps-roll-board__result"><small>LAST RESULT</small><strong data-bind="craps-roll-result">—</strong></span>
                  <span class="craps-roll-board__point"><small>POINT</small><strong data-bind="craps-point-status" data-state="off">OFF</strong></span>
                  <span class="craps-roll-board__total"><small>LAST ROLL</small><strong data-bind="craps-roll-total">—</strong></span>
                </section>
              </div>
              <output class="craps-shooter-boost" data-bind="craps-shooter-boost"
                      role="status" aria-live="assertive" hidden>
                <strong data-bind="craps-shooter-boost-copy">BONUS</strong>
              </output>
            </div>
          </div>

          <section class="craps-run-rail" data-bind="craps-resolution" data-bind-tray="craps-resolution-tray"
                   data-phase="idle" data-direction="push" aria-label="Craps bankroll run" hidden>
            <section class="craps-run-rail__tray" data-bind="craps-resolution-tray"
                     data-scale="bankroll" aria-label="Player bankroll tray">
              <span class="craps-run-rail__bankroll">
                <output data-bind="craps-resolution-bankroll" aria-label="Current bankroll">0</output>
              </span>
              <div class="craps-run-rail__well" data-bind="craps-resolution-meter"
                   role="progressbar" aria-valuemin="0" aria-valuenow="0">
                <span class="craps-run-rail__rack" data-bind="craps-resolution-chips" aria-hidden="true">
                  ${rackChips}
                </span>
                <span class="craps-run-rail__jp-scale" data-bind="craps-jp-scale" hidden aria-hidden="true">
                  <span class="craps-run-rail__jp-point craps-run-rail__jp-point--common"
                        data-bind="craps-jp-common-point">
                    <small data-bind="craps-jp-common-label">RUN IT UP —</small>
                  </span>
                  <span class="craps-run-rail__jp-point craps-run-rail__jp-point--rare"
                        data-bind="craps-jp-rare-point">
                    <small data-bind="craps-jp-rare-label">RARE —</small>
                  </span>
                  <span class="craps-run-rail__high-point" data-bind="craps-jp-high-point">
                    <span><small>HIGH</small><strong><output data-bind="craps-jp-high-amount">—</output></strong></span>
                  </span>
                </span>
              </div>
              <div class="craps-run-rail__bounty" data-bind="craps-battle-bounty-receipt"
                   role="status" aria-live="polite" data-state="hidden" hidden>
                <img data-bind="craps-battle-bounty-stack"
                     src="/shared/flip-chips/stack-7-high-gold.svg" alt="">
                <span>
                  <small data-bind="craps-battle-bounty-kind">BOUNTY WON</small>
                  <strong><output data-bind="craps-battle-bounty-amount">—</output><em>FLIP</em></strong>
                </span>
                <span class="craps-run-rail__bounty-boost">
                  <small>BOOST PAID</small>
                  <strong>+<output data-bind="craps-battle-boost-amount">—</output><em>FLIP</em></strong>
                </span>
              </div>
            </section>
            <footer class="craps-run-rail__receipt" aria-live="polite">
              <span><em data-bind="craps-resolution-bonus" hidden></em></span>
              <div>
                <label class="craps-run-speed" title="Craps resolution speed">
                  <span>SPEED</span>
                  <input type="range" min="0.5" max="3" step="0.5" value="1"
                         data-bind="craps-resolution-speed" aria-label="Craps resolution speed">
                  <output data-bind="craps-resolution-speed-value">1×</output>
                </label>
                <button type="button" data-bind="craps-resolution-auto" aria-pressed="true">AUTO ON</button>
                <button type="button" class="craps-run-rail__roll" data-bind="craps-resolution-roll" hidden>ROLL</button>
                <button type="button" data-bind="craps-resolution-skip">SKIP</button>
                <button type="button" data-bind="craps-resolution-replay" hidden>REPLAY</button>
                <button type="button" class="craps-run-rail__done" data-bind="craps-resolution-done" hidden>DONE</button>
              </div>
            </footer>
          </section>

          <div class="craps-payout-flight" data-bind="craps-payout-flight" aria-hidden="true"></div>

          <footer class="craps-controls" data-bind="craps-controls">
            <section class="craps-player-strip" data-bind="craps-player-strip" aria-label="Other players at this table" hidden>
              <div class="craps-player-strip__players" data-bind="craps-other-seats"></div>
            </section>

            <div class="craps-controls__setup">
              <section class="craps-chip-picker" aria-labelledby="craps-chip-label">
                <span class="craps-control-label" id="craps-chip-label">YOUR 7 CHIPS <strong data-bind="craps-chip-count">7 LEFT</strong></span>
                <div class="craps-chip-picker__chips" data-bind="craps-chips" role="status" aria-live="polite"></div>
                <small class="craps-exact-hint">TAP FELT TO ADD · TAP YOUR STACK TO REMOVE</small>
              </section>

              <section class="craps-session-setup" aria-labelledby="craps-bankroll-label">
                <header class="craps-session-head">
                  <span class="craps-control-label" id="craps-bankroll-label">BANKROLL</span>
                  <span class="craps-perks">
                    <span>DEGEN SCORE <strong data-bind="craps-activity">—</strong></span>
                  </span>
                </header>
                <div class="craps-slip-setup">
                  <label><span>STARTING BANKROLL</span><input type="number" name="craps-bankroll" min="0" step="1" inputmode="numeric"><small>FLIP</small></label>
                  <label><span>PAYOUT GOAL</span><input type="number" name="craps-goal" min="0" step="1" inputmode="numeric"><small>0 = none</small></label>
                </div>
              </section>

              <div class="craps-controls__checkout">
                <div class="craps-slip-summary" aria-live="polite">
                  <span><small>CHIPS</small><strong data-bind="craps-per-shooter">0 / 7</strong></span>
                  <span><small>GOAL</small><strong data-bind="craps-plan">NONE</strong></span>
                  <span class="craps-slip-summary__total"><small>BUY-IN</small><strong data-bind="craps-total">0 FLIP</strong></span>
                </div>
                <div class="craps-slip-actions">
                  <span class="craps-slip-actions__tools">
                    <button type="button" data-bind="craps-undo" disabled>UNDO</button>
                    <button type="button" data-bind="craps-clear" disabled>CLEAR</button>
                    <button type="button" data-bind="craps-replay" hidden>WATCH RUN</button>
                  </span>
                  <p data-bind="craps-status" role="status"></p>
                  <button type="button" class="craps-submit" data-bind="craps-submit" disabled>PLACE BETS</button>
                </div>
              </div>
            </div>
          </footer>
        </section>
      </div>`;
  }

  #wire() {
    for (const close of this.querySelectorAll('[data-bind="craps-close"]')) close.addEventListener('click', () => this.#close());
    this.querySelector('[data-bind="craps-card"]')?.addEventListener('keydown', (event) => {
      if (event?.key === 'Escape') { event.preventDefault?.(); this.#close(); }
      else if (event?.key === 'Tab') this.#trapFocus(event);
    });
    this.querySelector('.craps-groups')?.addEventListener('click', (event) => {
      const spot = event?.target?.closest?.('[data-stake-bet]');
      if (!spot) return;
      const localStack = event?.target?.closest?.('.craps-bet__seat-chip.is-local');
      const stackArt = event?.target?.closest?.('.craps-bet__seat-art');
      if (localStack && stackArt) this.#removeChip(spot.dataset.bet);
      else this.#placeChip(spot.dataset.bet);
    });
    this.querySelector('[data-bind="craps-battle-rows"]')?.addEventListener('click', (event) => {
      const watch = event?.target?.closest?.('[data-perspective-bet-id]');
      if (watch) {
        this.#selectPerspective(watch.dataset.perspectiveBetId);
        return;
      }
      const feltToggle = event?.target?.closest?.('[data-felt-player-key]');
      if (feltToggle) this.#toggleFeltOpponent(feltToggle.dataset.feltPlayerKey);
    });
    const bankroll = this.querySelector('[name="craps-bankroll"]');
    bankroll?.addEventListener('input', () => this.#setSlipAmount('bankroll', bankroll.value));
    const goal = this.querySelector('[name="craps-goal"]');
    goal?.addEventListener('input', () => this.#setSlipAmount('goal', goal.value));
    this.querySelector('[data-bind="craps-undo"]')?.addEventListener('click', () => this.#undo());
    this.querySelector('[data-bind="craps-clear"]')?.addEventListener('click', () => this.#clear());
    this.querySelector('[data-bind="craps-replay"]')?.addEventListener('click', () => this.#replay());
    const resolutionSpeed = this.querySelector('[data-bind="craps-resolution-speed"]');
    resolutionSpeed?.addEventListener('input', (event) => {
      event.stopPropagation?.();
      this.#setResolutionSpeed(resolutionSpeed.value);
    });
    resolutionSpeed?.addEventListener('change', (event) => {
      event.stopPropagation?.();
      this.#setResolutionSpeed(resolutionSpeed.value, { persist: true });
    });
    resolutionSpeed?.addEventListener('pointerdown', (event) => event.stopPropagation?.());
    resolutionSpeed?.addEventListener('click', (event) => event.stopPropagation?.());
    this.querySelector('[data-bind="craps-resolution-auto"]')?.addEventListener('click', () => this.#toggleAutoRoll());
    this.querySelector('[data-bind="craps-resolution-roll"]')?.addEventListener('click', () => this.#rollNextResolution());
    this.querySelector('[data-bind="craps-resolution-skip"]')?.addEventListener('click', () => this.#finishResolution(true));
    this.querySelector('[data-bind="craps-resolution-replay"]')?.addEventListener('click', () => this.#startResolution());
    this.querySelector('[data-bind="craps-resolution-done"]')?.addEventListener('click', () => this.#close());
    this.querySelector('[data-bind="craps-submit"]')?.addEventListener('click', () => this.#submit());
  }

  #selectPerspective(betId, { atResolvedBoundary = false } = {}) {
    const selectedBetId = betId == null ? '' : String(betId);
    if (!selectedBetId || selectedBetId === this.#viewerBetId || !this.#onPerspectiveSelect) return;
    // The current roll must land before a viewpoint swap. Otherwise painting
    // the selected trace at this index would reveal a die or coin result that
    // is still in flight on the shared table.
    if (this.#resolutionActive && !this.#awaitingRoll && !atResolvedBoundary) {
      this.#pendingPerspectiveBetId = selectedBetId;
      return;
    }
    this.#pendingPerspectiveBetId = null;
    const wasActive = this.#resolutionActive;
    this.#stopResolutionTimer();
    try {
      const switched = this.#onPerspectiveSelect({
        betId: selectedBetId,
        resumeResolutionIndex: this.#resolutionIndex,
        autoRoll: this.#autoRoll,
      });
      if (switched !== false) return;
    } catch (_error) { /* keep the current perspective playing if a seat is unavailable */ }
    if (wasActive) this.#queueNextResolutionRoll(180);
  }

  #toggleFeltOpponent(playerKey) {
    const key = String(playerKey ?? '');
    const roundNumber = Math.max(0, this.#resolutionIndex + 1);
    const entry = this.#battleStandings(roundNumber).find((candidate) => candidate.key === key);
    if (!entry || entry.local) return;
    this.#feltOpponentKeys = toggleCrapsFeltOpponent(this.#feltOpponentKeys, key);
    this.#paintOpponentRacks(roundNumber);
  }

  #renderChips() {
    const host = this.querySelector('[data-bind="craps-chips"]');
    if (!host) return;
    const placed = Number(selectedChipCount(this.#bets));
    const left = Math.max(0, CRAPS_PICKED_CHIPS - placed);
    host.innerHTML = Array.from({ length: CRAPS_PICKED_CHIPS }, (_, index) => `
      <i class="craps-entry-chip${index < left ? ' is-remaining' : ' is-placed'}" aria-hidden="true">
        <img src="${CRAPS_CHIP_ART.red}" alt="">
      </i>`).join('');
    host.setAttribute('aria-label', `${left} of ${CRAPS_PICKED_CHIPS} chips left to place`);
    const count = this.querySelector('[data-bind="craps-chip-count"]');
    if (count) count.textContent = `${left} LEFT`;
  }

  #placeChip(id) {
    const bet = BET_BY_ID.get(id);
    if (this.#busy || this.#tableResolved || this.#screen !== 'placement' || bet?.kind !== 'stake') return;
    const previous = this.#bets.get(id) ?? 0n;
    const used = selectedChipCount(this.#bets);
    if (previous >= BigInt(CRAPS_MAX_CHIPS_PER_BET)) {
      this.#message = 'Four chips is the maximum on one bet. Spread the remaining chips.';
      this.#render();
      return;
    }
    if (used >= BigInt(CRAPS_PICKED_CHIPS)) {
      this.#message = 'All seven chips are placed. Tap a red stack to take one back.';
      this.#render();
      return;
    }
    this.#history.push({ type: 'bet', id, previous });
    this.#bets.set(id, previous + 1n);
    sfxCrapsBetPlace();
    this.#message = '';
    this.#render();
    const spot = this.querySelector(`[data-bet="${id}"]`);
    spot?.classList?.remove('is-hit');
    void spot?.offsetWidth;
    spot?.classList?.add('is-hit');
  }

  #removeChip(id) {
    const bet = BET_BY_ID.get(id);
    if (this.#busy || this.#tableResolved || this.#screen !== 'placement' || bet?.kind !== 'stake') return;
    const previous = this.#bets.get(id) ?? 0n;
    if (previous <= 0n) return;
    this.#history.push({ type: 'bet', id, previous });
    if (previous === 1n) this.#bets.delete(id);
    else this.#bets.set(id, previous - 1n);
    this.#message = '';
    this.#render();
  }

  #setSlipAmount(field, value) {
    if (this.#busy || this.#tableResolved || this.#entryKind !== 'custom') return;
    const amount = wholeFlip(value);
    if (amount == null) return;
    if (field === 'goal') this.#goal = amount;
    else this.#bankroll = amount;
    this.#message = '';
    this.#render();
  }

  #undo() {
    if (this.#busy || this.#tableResolved) return;
    const action = this.#history.pop();
    if (!action) return;
    if (action.previous > 0n) this.#bets.set(action.id, action.previous);
    else this.#bets.delete(action.id);
    this.#message = '';
    this.#render();
  }

  #clear() {
    if (this.#busy || this.#tableResolved || this.#bets.size === 0) return;
    this.#bets.clear();
    this.#history = [];
    this.#message = '';
    this.#render();
  }

  #wager() {
    const chipCounts = contractChipCountsFrom(this.#bets);
    const contractChips = packContractChips(chipCounts);
    const placed = selectedChipCount(this.#bets);
    const remaining = BigInt(CRAPS_PICKED_CHIPS) - placed;
    const errors = [];
    if (remaining > 0n) {
      errors.push({
        code: 'BoardNeedsSevenChips',
        message: `Place ${remaining} more chip${remaining === 1n ? '' : 's'} on any spot.`,
      });
    } else if (remaining < 0n) {
      errors.push({ code: 'TooManyBoardChips', message: 'Remove chips until exactly seven remain.' });
    }
    const buyIn = this.#entryKind === 'board'
      ? 0n
      : (this.#bankroll + this.#battleStake) * BigInt(this.#entryMultiple);
    const method = this.#entryKind === 'board'
      ? 'setBoard'
      : this.#entryKind === 'day'
        ? 'enterBonusDay'
        : this.#entryKind === 'window'
          ? 'enterBonusBattle'
          : 'enterBattle';
    const contractArgs = this.#entryKind === 'board'
      ? [contractChips]
      : this.#entryKind === 'day'
        ? [contractChips, this.#entryMultiple]
        : this.#entryKind === 'window'
          ? [this.#entryPeriod, contractChips, this.#entryMultiple]
          : [this.#battleSlot == null ? null : String(this.#battleSlot), contractChips, this.#entryMultiple];
    return Object.freeze({
      mode: this.#entryKind === 'custom' ? 'battle' : this.#entryKind === 'board' ? 'board' : `bonus-${this.#entryKind}`,
      method,
      entryKind: this.#entryKind,
      entryPeriod: this.#entryPeriod,
      battleSlot: this.#battleSlot == null ? null : String(this.#battleSlot),
      tableIndex: this.#tableIndex,
      chips: chipCounts,
      contractBets: chipCounts,
      // The door takes a PACKED uint32 now, not the ten-field struct (audit 40a533d2f). The
      // readable struct is kept above for the UI and the tests; only the calldata is packed.
      contractChips,
      contractArgs,
      entryMultiple: this.#entryMultiple,
      selectedChips: Number(placed),
      remainingChips: Number(remaining > 0n ? remaining : 0n),
      bankrollFlip: this.#bankroll.toString(),
      bankrollWei: (this.#bankroll * CRAPS_FLIP_WEI).toString(),
      goalFlip: this.#goal.toString(),
      goalWei: (this.#goal * CRAPS_FLIP_WEI).toString(),
      battleStakeFlip: this.#battleStake.toString(),
      playedFlip: this.#playedFlip.toString(),
      perHandFlip: this.#playedFlip.toString(),
      perShooterFlip: this.#playedFlip.toString(),
      maxLossFlip: buyIn.toString(),
      totalFlip: buyIn.toString(),
      stakedWei: (buyIn * CRAPS_FLIP_WEI).toString(),
      bets: BATTLE_STAKE_BETS.flatMap((bet) => {
        const count = this.#bets.get(bet.id) ?? 0n;
        return count > 0n ? [{ id: bet.id, field: bet.contractField, label: bet.label, chipCount: Number(count) }] : [];
      }),
      valid: errors.length === 0,
      errors: Object.freeze(errors),
    });
  }

  #remainingOtherBet(id, roundNumber = 0) {
    const other = this.#otherBets.get(id) ?? { amount: 0n, playerCount: 0, players: [] };
    const players = roundNumber > 0
      ? other.players.filter((player) => !(
          player.exitType && player.exitRoll > 0 && roundNumber >= player.exitRoll
        ))
      : other.players;
    return {
      amount: players.reduce((total, player) => total + player.amount, 0n),
      playerCount: players.length,
      players,
    };
  }

  #runShooterIndexAtRound(roundNumber = 0) {
    const frames = this.#resolutionRun?.frames ?? [];
    const resolvedFrames = clampInteger(
      roundNumber,
      0,
      frames.length,
      0,
    );
    if (frames.length > 0 && frames.every((frame) => wholeNumber(frame.shooter) != null)) {
      const upcoming = frames[resolvedFrames];
      if (upcoming) return wholeNumber(upcoming.shooter);
      const last = frames.at(-1);
      return wholeNumber(last.shooter) + (this.#isSevenOut(last) ? 1 : 0);
    }
    let shooterIndex = 0;
    for (let index = 0; index < resolvedFrames; index += 1) {
      if (this.#isSevenOut(frames[index])) shooterIndex += 1;
    }
    return shooterIndex;
  }

  #shooterOrdinalAtRound(roundNumber = 0) {
    const ordinal = this.#completedShooters + this.#runShooterIndexAtRound(roundNumber);
    return Math.min(CRAPS_MAX_SLIP_HANDS - 1, ordinal);
  }

  #wagerMultiplierAtRound(roundNumber = 0) {
    return BigInt(crapsWagerMultiplierForShooter(this.#shooterOrdinalAtRound(roundNumber)));
  }

  #syncWagerMultiplier(roundNumber = 0) {
    const previousMultiplier = this.#wagerMultiplier;
    const multiplier = this.#wagerMultiplierAtRound(roundNumber);
    this.#wagerMultiplier = multiplier;
    const rail = this.querySelector('[data-bind="craps-table-rail"]');
    const felt = this.querySelector('.craps-table-felt');
    if (rail) rail.dataset.wagerMultiplier = multiplier.toString();
    if (felt) felt.dataset.wagerMultiplier = multiplier.toString();
    if (this.#resolutionActive && multiplier > previousMultiplier) sfxCrapsDouble();
    return multiplier;
  }

  #featuredStandings(roundNumber = 0, localBankroll = null, roundResult = null, atRoundFlip = false, reorder = false) {
    const standings = this.#battleStandings(roundNumber, localBankroll, roundResult, atRoundFlip);
    const byKey = new Map(standings.map((entry) => [entry.key, entry]));
    const local = standings.find((entry) => entry.local);
    // Opponent stacks are opt-in. Keep at most the two players the viewer
    // selected; rank checkpoints never volunteer a new player onto the felt.
    this.#feltOpponentKeys = this.#feltOpponentKeys
      .filter((key) => byKey.has(key) && !byKey.get(key)?.local)
      .slice(-CRAPS_MAX_FELT_OPPONENTS);
    this.#featuredPlayerKeys = [local?.key, ...this.#feltOpponentKeys].filter(Boolean);
    return this.#featuredPlayerKeys.map((key) => byKey.get(key)).filter(Boolean);
  }

  #paintBetCorners(spot, id, roundNumber = 0) {
    if (!spot) return { amount: 0n, playerCount: 0, players: [] };
    const other = this.#remainingOtherBet(id, roundNumber);
    const featured = this.#featuredStandings(roundNumber);
    const opponentSeats = new Map(featured
      .filter((entry) => !entry.local)
      .map((entry, index) => [entry.key, `top-${index + 1}`]));
    const otherByKey = new Map(other.players.map((player) => [player.key, player]));
    const shooterOrdinal = this.#shooterOrdinalAtRound(roundNumber);
    const wagerMultiplier = BigInt(crapsWagerMultiplierForShooter(shooterOrdinal));
    const corners = spot.querySelector('[data-bind="craps-chip-corners"]');
    const resolvedFrame = roundNumber > 0
      ? this.#resolutionRun?.frames[Math.min(roundNumber - 1, (this.#resolutionRun?.frames.length ?? 1) - 1)]
      : null;
    const viewerClosed = resolvedFrame?.viewerClosed === true;
    // YOU owns the lower band. Up to two explicitly selected opponents split
    // the upper band; an untouched leaderboard leaves that half clear.
    if (corners) {
      corners.innerHTML = featured.map((entry) => {
        const local = entry.local;
        if (local && viewerClosed) return '';
        const seat = local ? 'you' : opponentSeats.get(entry.key);
        const baseCount = entry.local ? (this.#bets.get(id) ?? 0n) : (otherByKey.get(entry.key)?.amount ?? 0n);
        if (baseCount <= 0n) return '';
        const playerColor = local
          ? entry.color
          : (CRAPS_OPPONENT_MEDAL_COLORS[Math.max(0, entry.rank - 1)] ?? entry.color);
        // Eligibility is per player even though the dice are shared. A live
        // boost skins only that player's physical FLIP stacks with the canonical
        // upright gold face; its secondary wedge and edge remain silver.
        const shooterBoost = entry.shooterBoost;
        const face = shooterBoost ? 'gold' : 'red';
        const presentation = crapsEscalatedChipPresentation(baseCount, shooterOrdinal, face);
        const count = BigInt(presentation.effectiveChipCount);
        const art = presentation.art.map((src, index) => (
          `<img class="craps-bet__seat-art${presentation.kind === 'pile' ? ' is-pile' : ''}"
                data-stack-index="${index}" src="${src}" alt="">`
        )).join('');
        const bonusDescription = local && shooterBoost
          ? ` · bonus shooter${shooterBoost.percent ? ` +${shooterBoost.percent}% eligible profit` : ''}`
          : '';
        return `<span class="craps-bet__seat-chip${local ? ' is-local' : ''}${shooterBoost ? ' is-shooter-boosted' : ''}"
                      data-player-key="${escapeHtml(entry.key)}" data-seat="${seat}"
                      data-face="${face}" data-base-chip-count="${baseCount}"
                      data-chip-count="${count}" data-wager-multiplier="${wagerMultiplier}"
                      data-shooter-boost="${shooterBoost ? 'active' : 'off'}"
                      style="--player-color:${escapeHtml(playerColor)}"
                      title="${escapeHtml(`${entry.label}: ${count} chip${count === 1n ? '' : 's'}${bonusDescription}`)}">
          <span class="craps-bet__seat-art-set" data-kind="${presentation.kind}"
                data-columns="${presentation.art.length}"
                style="--craps-bet-chip-scale:${presentation.visualScale}">${art}</span>
        </span>`;
      }).join('');
    }

    const active = other.amount > 0n;
    spot.dataset.otherActive = String(active);
    return { ...other, amount: other.amount * wagerMultiplier };
  }

  #paintRemainingOtherWagers(roundNumber = 0) {
    for (const spot of this.querySelectorAll('[data-bet]')) {
      this.#paintBetCorners(spot, spot.dataset.bet, roundNumber);
    }
  }

  #renderOtherPlayers() {
    const rack = this.querySelector('[data-bind="craps-player-strip"]');
    const host = this.querySelector('[data-bind="craps-other-seats"]');
    const count = this.querySelector('[data-bind="craps-other-count"]');
    const active = this.#tablePlayers.length > 0;
    if (count) count.textContent = String(this.#tablePlayers.length);
    if (rack) {
      rack.hidden = !active;
      if (active) rack.removeAttribute?.('hidden');
      else rack.setAttribute?.('hidden', '');
    }
    if (!host) return;
    host.innerHTML = this.#tablePlayers.map((player) => {
      const spots = `${player.betCount} SPOT${player.betCount === 1 ? '' : 'S'}`;
      const description = `${player.label}: ${player.totalChips} chips across ${spots.toLowerCase()}`;
      const avatar = player.avatar
        ? `<img src="${escapeHtml(player.avatar)}" alt="">`
        : `<b>${escapeHtml(player.initials)}</b>`;
      return `<span class="craps-table-seat" style="--player-color:${escapeHtml(player.color)}" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}">
        <span class="craps-table-seat__avatar">${avatar}<i aria-hidden="true"></i></span>
        <span><strong>${escapeHtml(player.label)}</strong><small>${escapeHtml(spots)}</small></span>
      </span>`;
    }).join('');
  }

  #setPoint(value = null) {
    const requested = Number(value);
    const point = CRAPS_POINT_NUMBERS.includes(requested) ? requested : null;
    for (const puck of this.querySelectorAll('[data-point-puck]')) {
      const active = point != null && Number(puck.dataset.pointPuck) === point;
      puck.hidden = !active;
      if (active) puck.removeAttribute?.('hidden');
      else puck.setAttribute?.('hidden', '');
    }
    const status = this.querySelector('[data-bind="craps-point-status"]');
    if (status) {
      status.textContent = point == null ? 'OFF' : String(point);
      status.dataset.state = point == null ? 'off' : 'on';
      status.setAttribute?.('aria-label', point == null ? 'Point is off' : `Point is ${point}`);
    }
  }

  #setRollBoard({ event, result, state } = {}) {
    const board = this.querySelector('[data-bind="craps-roll-board"]');
    const eventNode = this.querySelector('[data-bind="craps-roll-event"]');
    const resultNode = this.querySelector('[data-bind="craps-roll-result"]');
    if (board && state) board.dataset.state = state;
    if (eventNode && event != null) eventNode.textContent = String(event);
    if (resultNode && result != null) resultNode.textContent = String(result);
  }

  #paintViewerBustOutcome() {
    this.#setRollBoard({ event: 'RUN BUSTED', result: '0 RETURN', state: 'loss' });
  }

  #displayedViewerBankroll(amount) {
    return this.#viewerBustLocked ? 0n : (wholeFlip(amount) ?? 0n);
  }

  #resetSurvivalStage() {
    const stage = this.querySelector('[data-bind="craps-survival-stage"]');
    const coin = this.querySelector('[data-bind="craps-survival-coin"]');
    const landed = this.querySelector('[data-bind="craps-survival-landed"]');
    if (stage) { stage.hidden = true; stage.setAttribute?.('hidden', ''); }
    if (coin) {
      coin.hidden = false;
      coin.removeAttribute?.('hidden');
      coin.classList?.remove('is-flipping', 'is-win', 'is-bust');
    }
    if (landed) { landed.hidden = true; landed.setAttribute?.('hidden', ''); }
  }

  #showSurvivalLanding(survived) {
    const stage = this.querySelector('[data-bind="craps-survival-stage"]');
    const coin = this.querySelector('[data-bind="craps-survival-coin"]');
    const landed = this.querySelector('[data-bind="craps-survival-landed"]');
    if (stage) { stage.hidden = false; stage.removeAttribute?.('hidden'); }
    if (coin) { coin.hidden = true; coin.setAttribute?.('hidden', ''); }
    if (landed) {
      landed.src = survived ? '/shared/coinflip-face-eth.svg' : '/shared/coinflip-face-red.svg';
      landed.hidden = false;
      landed.removeAttribute?.('hidden');
    }
  }

  #resetShooterBoostAnnouncement({ clearTable = false } = {}) {
    const stage = this.querySelector('[data-bind="craps-shooter-boost"]');
    const copy = this.querySelector('[data-bind="craps-shooter-boost-copy"]');
    if (stage) {
      stage.hidden = true;
      stage.setAttribute?.('hidden', '');
      stage.classList?.remove('is-active');
    }
    if (copy) copy.textContent = '';
    if (clearTable) {
      const table = this.querySelector('[data-bind="craps-table-rail"]');
      if (table) table.dataset.shooterBoost = 'off';
      const board = this.querySelector('[data-bind="craps-roll-board"]');
      const multiplier = this.querySelector('[data-bind="craps-shooter-boost-multiplier"]');
      if (board) board.dataset.shooterBoost = 'off';
      if (multiplier) {
        multiplier.hidden = true;
        multiplier.setAttribute?.('hidden', '');
        multiplier.textContent = '';
      }
    }
  }

  #announceShooterBoost(roundNumber, onDone) {
    // Opponent eligibility is communicated only by their metallic felt chips.
    // This brief Degenerette-style text hit belongs exclusively to the viewer.
    const local = this.#activeShooterBoostEntries(roundNumber).find((entry) => entry.local);
    if (!local) {
      this.#resetShooterBoostAnnouncement();
      onDone?.();
      return;
    }
    sfxCrapsBonusShooter();
    const reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    if (reducedMotion) { onDone?.(); return; }
    const stage = this.querySelector('[data-bind="craps-shooter-boost"]');
    const copy = this.querySelector('[data-bind="craps-shooter-boost-copy"]');
    if (!stage || !copy) { onDone?.(); return; }
    copy.textContent = 'BONUS SHOOTER';
    stage.classList?.remove('is-active');
    stage.hidden = false;
    stage.removeAttribute?.('hidden');
    void stage.offsetWidth;
    stage.classList?.add('is-active');
    stage.addEventListener?.('animationend', () => {
      stage.hidden = true;
      stage.setAttribute?.('hidden', '');
      stage.classList?.remove('is-active');
    }, { once: true });
    // This is purely informational: the dice begin on the same tick.
    onDone?.();
  }

  #opponentRackProgress(player, rollNumber) {
    const snapshots = Array.isArray(player.bankrollsFlip)
      ? player.bankrollsFlip.map((amount) => wholeFlip(amount)).filter((amount) => amount != null)
      : [];
    const starting = wholeFlip(player.startingBankrollFlip) ?? 0n;
    const goal = wholeFlip(player.goalFlip) ?? 0n;
    const exitAmount = wholeFlip(player.exitAmountFlip) ?? 0n;
    const snapshot = rollNumber > 0 && snapshots.length > 0
      ? snapshots[Math.min(rollNumber - 1, snapshots.length - 1)]
      : starting;
    const knownAmounts = [starting, goal, exitAmount, ...snapshots];
    const capacity = knownAmounts.reduce((highest, amount) => amount > highest ? amount : highest, 0n) || 1n;
    if (snapshots.length > 0) {
      return { amount: snapshot, capacity, exact: true };
    }
    const exitRoll = Math.max(1, Number(player.exitRoll) || 1);
    const elapsed = Math.max(0, Math.min(exitRoll, rollNumber));
    if (player.exitType === 'bust') {
      return { amount: starting * BigInt(exitRoll - elapsed) / BigInt(exitRoll), capacity: starting || 1n, exact: false };
    }
    if (player.exitType === 'cashout' && exitAmount > starting) {
      return {
        amount: starting + ((exitAmount - starting) * BigInt(elapsed) / BigInt(exitRoll)),
        capacity: exitAmount,
        exact: false,
      };
    }
    return { amount: starting, capacity, exact: false };
  }

  #opponentBattleEntry(player, opponentIndex, roundNumber = 0, roundResult = null, atRoundFlip = false) {
    const boardState = this.querySelector('[data-bind="craps-table-rail"]')?.dataset?.board ?? 'live';
    // A coin still in the air must not spoil its own outcome: hold the seat in
    // its pre-flip state until the landing paints the bust or the doubled base.
    const coinInAir = this.#opponentCoinFlips.get(player.key)?.phase === 'flipping';
    const exited = !coinInAir
      && Boolean(player.exitType && player.exitRoll > 0 && roundNumber >= player.exitRoll);
    const runBusted = exited && player.exitType === 'bust';
    const goalHit = exited && player.exitType === 'cashout';
    const progress = this.#opponentRackProgress(player, roundNumber);
    let amount = progress.amount;
    let state = 'live';
    let status = 'LIVE';
    if (runBusted) {
      amount = 0n;
      state = 'bust';
      status = 'BUST';
    } else if (goalHit) {
      state = 'cashout';
      amount = wholeFlip(player.exitAmountFlip) ?? amount;
      status = 'LOCKED';
    }
    const wagerMultiplier = this.#wagerMultiplierAtRound(roundNumber);
    const baseBoard = this.#playedFlip * wagerMultiplier;
    const feltStake = boardState === 'come-out'
      ? (wholeFlip(player.lineChips ?? player.passLineChips) ?? 0n)
        * (this.#playedFlip / CRAPS_BOARD_CHIPS)
        * wagerMultiplier
      : ['empty', 'clearing'].includes(boardState)
        ? 0n
        : baseBoard;
    const inPlay = state === 'risk'
      ? amount
      : state === 'live' && feltStake > 0n && amount >= feltStake ? feltStake : 0n;
    const banked = amount - inPlay;
    const goal = wholeFlip(player.goalFlip) ?? 0n;
    const reserveState = crapsRackReserveState({
      bankedFlip: banked,
      nextStakeFlip: baseBoard,
      goalFlip: goal,
      active: state === 'live',
    });
    const shooterBoost = state === 'live'
      ? player.shooterBoosts?.[this.#runShooterIndexAtRound(roundNumber)] ?? null
      : null;
    return {
      key: player.key ?? `opponent-${opponentIndex}`,
      betId: player.betId ?? null,
      opponentIndex,
      local: false,
      label: player.label,
      initials: player.initials,
      avatar: player.avatar,
      color: player.color,
      betIds: Array.isArray(player.betIds) ? player.betIds : [],
      amount,
      capacity: progress.capacity > amount ? progress.capacity : amount || 1n,
      feltStake,
      nextStake: baseBoard,
      goal,
      inPlay,
      banked,
      reserveState,
      shooterBoost,
      rankStop: player.exitType === 'cashout' ? 'goal' : player.exitType === 'bust' ? 'bust' : null,
      rankHands: player.handsPlayed,
      rankPeak: player.highPointFlip,
      rankEnd: player.rawEndingFlip,
      rankStanding: player.standing,
      state,
      status,
    };
  }

  #localBattleEntry(roundNumber = 0, localBankroll = null, roundResult = null, atRoundFlip = false) {
    const frames = this.#resolutionRun?.frames ?? [];
    const frame = roundNumber > 0 ? frames[Math.min(roundNumber - 1, frames.length - 1)] : null;
    const liveFrame = frames[roundNumber] ?? null;
    const starting = wholeFlip(this.#resolutionRun?.startingBankrollFlip) ?? this.#bankroll;
    let amount = wholeFlip(localBankroll)
      ?? (frame ? wholeFlip(frame.bankrollFlip) : null)
      ?? starting;
    let state = 'live';
    let status = roundNumber > 0 ? 'LIVE' : 'YOU';
    const localTerminal = this.#viewerBustLocked
      ? 'bust'
      : frame?.viewerTerminal === 'goal'
        ? 'goal'
        : frame?.terminal
          || (frame?.viewerClosed === true ? frame.viewerTerminal : '');
    if (localTerminal === 'bust' || amount === 0n) {
      amount = 0n;
      state = 'bust';
      status = 'BUST';
    } else if (localTerminal === 'goal') {
      state = 'cashout';
      status = 'LOCKED';
    }
    const boardState = this.querySelector('[data-bind="craps-table-rail"]')?.dataset?.board ?? 'live';
    const wagerMultiplier = this.#wagerMultiplierAtRound(roundNumber);
    const baseBoard = BigInt(this.#wager().perHandFlip) * wagerMultiplier;
    const feltStake = boardState === 'come-out'
      ? ((this.#bets.get('pass') ?? 0n) + (this.#bets.get('dont-pass') ?? 0n))
        * (this.#playedFlip / CRAPS_BOARD_CHIPS)
        * wagerMultiplier
      : ['empty', 'clearing'].includes(boardState)
        ? 0n
        : baseBoard;
    const inPlay = state === 'risk'
      ? amount
      : state === 'live' && feltStake > 0n && amount >= feltStake ? feltStake : 0n;
    const banked = amount - inPlay;
    const reserveState = crapsRackReserveState({
      bankedFlip: banked,
      nextStakeFlip: baseBoard,
      goalFlip: this.#goal,
      active: state === 'live',
    });
    const capacity = wholeFlip(this.#resolutionRun?.capacityFlip)
      ?? (this.#goal > amount ? this.#goal : amount)
      ?? 1n;
    return {
      key: 'local',
      betId: this.#viewerBetId,
      opponentIndex: -1,
      local: true,
      label: this.#viewerLabel,
      initials: playerInitials(this.#viewerLabel),
      avatar: this.#viewerAvatar,
      color: CRAPS_LOCAL_PLAYER_COLOR,
      betIds: [...this.#bets.keys()],
      amount,
      capacity: capacity > amount ? capacity : amount || 1n,
      feltStake,
      nextStake: baseBoard,
      goal: this.#goal,
      inPlay,
      banked,
      reserveState,
      shooterBoost: state === 'live' ? liveFrame?.shooterBoost ?? null : null,
      rankStop: this.#viewerResult?.stop ?? (localTerminal || null),
      rankHands: this.#viewerResult?.handsPlayed
        || ((wholeNumber(frame?.shooter) ?? this.#runShooterIndexAtRound(roundNumber)) + 1),
      rankPeak: this.#viewerResult?.highPointFlip
        ?? frames.reduce((highest, candidate) => {
          const bankroll = wholeFlip(candidate?.bankrollFlip) ?? 0n;
          return bankroll > highest ? bankroll : highest;
        }, starting),
      rankEnd: this.#viewerResult?.rawEndingFlip ?? (wholeFlip(frame?.bankrollFlip) ?? amount),
      rankStanding: this.#viewerResult?.standing ?? 0,
      state,
      status,
    };
  }

  #battleStandings(roundNumber = 0, localBankroll = null, roundResult = null, atRoundFlip = false) {
    const frames = this.#resolutionRun?.frames ?? [];
    const finalized = frames.length > 0 && roundNumber >= frames.length;
    const entries = [
      this.#localBattleEntry(roundNumber, localBankroll, roundResult, atRoundFlip),
      ...this.#tablePlayers.map((player, index) => (
        this.#opponentBattleEntry(player, index, roundNumber, roundResult, atRoundFlip)
      )),
    ].map((entry) => {
      const battleWinner = finalized && (this.#battleWinnerBetId != null
        ? String(entry.betId ?? '') === this.#battleWinnerBetId
        : entry.local && this.#battleWonByViewer);
      const battleAwardWei = battleWinner && this.#battlePayoutWei != null && this.#battlePayoutWei > 0n
        ? this.#battlePayoutWei
        : null;
      const battleAwardFlip = battleAwardWei == null
        ? null
        : (battleAwardWei + CRAPS_FLIP_WEI - 1n) / CRAPS_FLIP_WEI;
      return battleWinner
        ? {
          ...entry,
          battleWinner: true,
          battleAwardWei,
          battleAwardFlip,
          feltStake: 0n,
          reserveState: 'safe',
          state: 'paid',
          status: 'WINNER',
        }
        : { ...entry, battleWinner: false, battleAwardWei: null, battleAwardFlip: null };
    });
    const capacity = entries.reduce((highest, entry) => {
      const candidate = entry.capacity > entry.amount ? entry.capacity : entry.amount;
      return candidate > highest ? candidate : highest;
    }, 1n);
    entries.sort((a, b) => {
      if (finalized) return compareFinalCrapsBattleEntries(a, b, this.#battleWinnerBetId);
      if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
      if (a.local !== b.local) return a.local ? -1 : 1;
      return a.opponentIndex - b.opponentIndex;
    });
    let rank = 0;
    let previousAmount = null;
    return entries.map((entry, index) => {
      if (finalized || previousAmount == null || entry.amount !== previousAmount) rank = index + 1;
      previousAmount = entry.amount;
      return {
        ...entry,
        rank,
        capacity,
        rackCapacity: entry.battleAwardFlip ?? capacity,
        finalized,
      };
    });
  }

  #activeShooterBoostEntries(roundNumber = 0) {
    return this.#battleStandings(roundNumber)
      .filter((entry) => entry.state === 'live' && entry.shooterBoost);
  }

  #battleRackChipLayout(entry, slotCount, amount = entry.amount) {
    const bankroll = wholeFlip(amount) ?? 0n;
    const feltStake = wholeFlip(entry.feltStake) ?? 0n;
    const inPlay = entry.state === 'risk'
      ? bankroll
      : entry.state === 'live' && feltStake > 0n && bankroll >= feltStake ? feltStake : 0n;
    return crapsRackPipLayout({
      bankrollFlip: bankroll,
      capacityFlip: entry.rackCapacity ?? entry.capacity,
      inPlayFlip: inPlay,
      slotCount,
    });
  }

  #paintRackPips(chips, layout, { reserveState = 'safe' } = {}) {
    const filledCount = layout?.filledCount ?? layout?.chipCount ?? 0;
    const bankedCount = layout?.bankedCount ?? 0;
    const reserveRisk = reserveState === 'survival-risk' || reserveState === 'bust-risk';
    const goalLocked = reserveState === 'goal-locked';
    [...chips].forEach((chip, index) => {
      const filled = index < filledCount;
      const bankedChip = filled && index < bankedCount;
      chip.classList?.toggle('is-filled', filled);
      chip.classList?.toggle('is-banked', bankedChip);
      chip.classList?.toggle('is-in-play', filled && index >= bankedCount);
      chip.classList?.toggle('is-reserve-risk', bankedChip && reserveRisk);
      chip.classList?.toggle('is-goal-locked', filled && goalLocked);
    });
  }

  #localRankAtRound(roundNumber, fallbackRank, standings) {
    if (this.#viewerBustRank != null) return this.#viewerBustRank;
    const local = Array.isArray(standings) ? standings.find((entry) => entry.local) : null;
    const knownWinnerRank = local?.finalized
      && this.#battleWinnerBetId != null
      && String(local.betId ?? '') === this.#battleWinnerBetId
      ? 1
      : null;
    const rank = knownWinnerRank ?? crapsStandingAtRound({
      rankTimeline: this.#rankTimeline,
      roundNumber,
      fallbackRank,
      fieldEntrants: this.#fieldEntrants,
      loadedEntrants: Array.isArray(standings) ? standings.length : 0,
    });
    if (local?.state === 'bust' && rank != null) this.#viewerBustRank = rank;
    return rank;
  }

  #paintLocalStanding(rank, standings, roundNumber = 0) {
    const standing = this.querySelector('[data-bind="craps-resolution-standing"]');
    const remainingNode = this.querySelector('[data-bind="craps-battle-remaining"]');
    const entrantsNode = this.querySelector('[data-bind="craps-battle-entrants"]');
    const loadedEntrants = Array.isArray(standings) ? standings.length : 0;
    const total = this.#fieldEntrants ?? loadedEntrants;
    const remaining = crapsRemainingEntrantsAtRound({
      remainingTimeline: this.#remainingEntrantsTimeline,
      roundNumber,
      standings,
      fieldEntrants: this.#fieldEntrants,
      loadedEntrants,
    });
    if (standing) {
      if (rank == null) {
        standing.textContent = '—';
        standing.dataset.rank = 'unknown';
        standing.setAttribute('aria-label', 'Battle position unavailable until full-field standings load');
      } else {
        const ordinal = formatCrapsStanding(rank);
        standing.textContent = ordinal;
        standing.dataset.rank = String(rank);
        standing.setAttribute('aria-label', `${ordinal} place${total ? ` of ${total}` : ''} by chips`);
      }
    }
    if (remainingNode) {
      remainingNode.textContent = remaining == null ? '—' : remaining.toLocaleString('en-US');
      remainingNode.setAttribute('aria-label', remaining == null
        ? 'Remaining entrants unavailable until full-field standings load'
        : `${remaining.toLocaleString('en-US')} entrants remaining`);
    }
    if (entrantsNode) {
      entrantsNode.textContent = total > 0 ? total.toLocaleString('en-US') : '—';
      entrantsNode.setAttribute('aria-label', total > 0
        ? `${total.toLocaleString('en-US')} total entrants`
        : 'Total entrants unavailable');
    }
    const bankroll = this.querySelector('.craps-run-rail__bankroll');
    if (bankroll) bankroll.dataset.rank = rank == null ? 'unknown' : String(rank);
  }

  #paintBattleLeaderboard(roundNumber = 0, localBankroll = null, roundResult = null, atRoundFlip = false, reorder = false) {
    const host = this.querySelector('[data-bind="craps-battle-board"]');
    const rows = this.querySelector('[data-bind="craps-battle-rows"]');
    if (!host || !rows) return [];
    const previousPositions = new Map([...rows.querySelectorAll('[data-battle-key]')].map((rack) => (
      [rack.dataset.battleKey, rack.getBoundingClientRect?.()]
    )));
    const standings = this.#battleStandings(roundNumber, localBankroll, roundResult, atRoundFlip);
    const localStanding = standings.find((entry) => entry.local);
    const localRank = this.#localRankAtRound(roundNumber, localStanding?.rank, standings);
    const standingsByKey = new Map(standings.map((entry) => [entry.key, entry]));
    const shouldReorder = reorder
      || this.#leaderboardPlayerKeys.length === 0
      || this.#leaderboardPlayerKeys.some((key) => !standingsByKey.has(key));
    if (shouldReorder) {
      const layoutLocalRank = localRank ?? CRAPS_LEADERBOARD_ROWS + 1;
      const selected = crapsLeaderboardRows(standings, { localRank: layoutLocalRank });
      this.#leaderboardPlayerKeys = selected.map((entry) => entry.key);
      this.#leaderboardRanksByKey = new Map(selected.map((entry) => [entry.key, entry.rank]));
      this.#leaderboardViewerRank = localRank;
    }
    const visibleStandings = this.#leaderboardPlayerKeys
      .map((key) => {
        const entry = standingsByKey.get(key);
        const rank = this.#leaderboardRanksByKey.get(key);
        return entry && rank != null ? {
          ...entry,
          rank,
          displayRank: entry.local ? this.#leaderboardViewerRank : rank,
        } : null;
      })
      .filter(Boolean);
    this.#paintLocalStanding(this.#leaderboardViewerRank, standings, roundNumber);
    const featured = this.#featuredStandings(roundNumber, localBankroll, roundResult, atRoundFlip, reorder);
    const feltRivalKeys = new Set(featured.filter((entry) => !entry.local).map((entry) => entry.key));
    host.dataset.leader = visibleStandings[0]?.local ? 'you' : 'other';
    rows.dataset.count = String(visibleStandings.length);
    host.hidden = visibleStandings.length === 0;
    if (visibleStandings.length > 0) host.removeAttribute?.('hidden');
    else host.setAttribute?.('hidden', '');
    const rail = host.parentElement;
    if (rail) rail.dataset.leaderboard = visibleStandings.length > 0 ? 'visible' : 'empty';
    const chipMarkup = Array.from(
      { length: CRAPS_RACK_SLOTS },
      () => '<i class="df-bankroll__chip craps-battle-rack__chip"></i>',
    ).join('');
    rows.innerHTML = visibleStandings.map((entry) => {
      // Keep initials behind the live Discord portrait. If Discord rotates or
      // removes an avatar URL, its load error drops cleanly to this fallback.
      const avatar = `<b>${escapeHtml(entry.initials)}</b>${entry.avatar
        ? `<img src="${escapeHtml(entry.avatar)}" alt="" decoding="async" referrerpolicy="no-referrer">`
        : ''}`;
      const coinFlip = this.#opponentCoinFlips.get(entry.key);
      const coin = coinFlip
        ? `<span class="craps-battle-rack__coin" data-phase="${escapeHtml(coinFlip.phase)}"
                 data-result="${coinFlip.survived ? 'win' : 'bust'}"
                 data-cadence="${escapeHtml(coinFlip.cadence)}" aria-hidden="true">
             <i class="craps-battle-rack__coin-face"></i>
             <b class="craps-battle-rack__coin-pop">${coinFlip.survived ? 'SURVIVED' : 'BUSTED'}</b>
           </span>`
        : '';
      const playerColor = entry.local
        ? entry.color
        : CRAPS_OPPONENT_MEDAL_COLORS[Math.max(0, entry.rank - 1)] ?? entry.color;
      const viewingAnotherPlayer = entry.local
        && this.#originalViewerBetId != null
        && this.#viewerBetId !== this.#originalViewerBetId;
      const identityMeta = entry.local
        ? (viewingAnotherPlayer ? 'WATCHING' : entry.label === 'YOU' ? '' : 'YOU')
        : this.#originalViewerBetId != null
          && String(entry.betId ?? '') === this.#originalViewerBetId
            ? 'YOU'
            : entry.status;
      const canWatch = !entry.local && entry.betId != null && this.#onPerspectiveSelect != null;
      const watchControl = canWatch
        ? `<button type="button" class="craps-battle-rack__watch"
                   data-perspective-bet-id="${escapeHtml(entry.betId)}"
                   aria-label="Watch the rest of the battle from ${escapeHtml(entry.label)}'s perspective"
                   title="Watch ${escapeHtml(entry.label)}"><span aria-hidden="true">▶</span></button>`
        : '';
      const onFelt = !entry.local && feltRivalKeys.has(entry.key);
      const feltControl = !entry.local
        ? `<button type="button" class="craps-battle-rack__felt-toggle"
                   data-felt-player-key="${escapeHtml(entry.key)}"
                   aria-pressed="${String(onFelt)}"
                   aria-label="${onFelt ? 'Hide' : 'Show'} ${escapeHtml(entry.label)}'s chips on the felt"
                   title="${onFelt ? 'Hide' : 'Show'} felt chips"></button>`
        : '';
      const rankLabel = entry.displayRank == null ? '—' : String(entry.displayRank);
      const rackAmount = entry.battleAwardFlip ?? entry.amount;
      const rackCapacity = entry.rackCapacity ?? entry.capacity;
      const amountCopy = entry.battleAwardWei != null
        ? entry.battleAwardWei % CRAPS_FLIP_WEI === 0n
          ? formatCrapsCompactFlip(entry.battleAwardWei / CRAPS_FLIP_WEI)
          : formatCrapsWei(entry.battleAwardWei)
        : formatCrapsCompactFlip(entry.amount);
      const amountAria = entry.battleAwardWei != null
        ? `${formatCrapsWei(entry.battleAwardWei)} FLIP battle prize`
        : `${formatCrapsFlip(entry.amount)} FLIP`;
      const percentage = rackCapacity > 0n
        ? Math.max(0, Math.min(100, Number((rackAmount * 10_000n) / rackCapacity) / 100))
        : 0;
      return `<article class="craps-battle-rack${entry.local ? ' is-you' : ''}${entry.displayRank === 1 ? ' is-leader' : ''}${onFelt ? ' is-felt-rival' : ''}"
                       role="listitem"
                       data-battle-key="${escapeHtml(entry.key)}"
                       data-battle-local="${String(entry.local)}"
                       data-battle-opponent-index="${entry.opponentIndex}"
                       data-on-felt="${String(onFelt)}"
                       data-state="${escapeHtml(entry.state)}"
                       data-reserve-state="${escapeHtml(entry.reserveState)}"
                       data-shooter-boost="${entry.shooterBoost ? 'active' : 'off'}"
                       style="--player-color:${escapeHtml(playerColor)}"
                       aria-label="Rank ${rankLabel}, ${escapeHtml(entry.label)}, ${escapeHtml(amountAria)}, ${escapeHtml(entry.status.toLowerCase())}">
        ${feltControl}${watchControl}
        <span class="craps-battle-rack__identity">
          <span class="craps-battle-rack__rank">#${rankLabel}</span>
          <span class="craps-battle-rack__avatar">${avatar}</span>
          <span class="craps-battle-rack__player"><strong>${escapeHtml(entry.label)}</strong>${identityMeta
            ? `<em>${escapeHtml(identityMeta)}</em>`
            : ''}</span>
        </span>
        <output class="craps-battle-rack__amount" aria-hidden="true">
          <strong>${amountCopy}</strong>
        </output>
        <span class="craps-battle-rack__well" role="progressbar" aria-valuemin="0" aria-valuemax="100"
              aria-valuenow="${Math.round(percentage)}" aria-valuetext="${escapeHtml(amountAria)}">
          <span class="craps-battle-rack__chips craps-run-rail__rack" aria-hidden="true">${chipMarkup}</span>
        </span>${coin}
      </article>`;
    }).join('');
    for (const portrait of rows.querySelectorAll('.craps-battle-rack__avatar img')) {
      portrait.addEventListener?.('error', () => portrait.remove?.(), { once: true });
    }
    visibleStandings.forEach((entry) => {
      const rack = [...rows.querySelectorAll('[data-battle-key]')]
        .find((candidate) => candidate.dataset.battleKey === entry.key);
      if (!rack) return;
      const chips = [...rack.querySelectorAll('.craps-battle-rack__chip')];
      const { filledCount, bankedCount } = this.#battleRackChipLayout(
        entry,
        chips.length,
        entry.battleAwardFlip ?? entry.amount,
      );
      this.#paintRackPips(chips, { filledCount, bankedCount }, {
        reserveState: entry.reserveState,
      });
      const previous = previousPositions.get(entry.key);
      const current = rack.getBoundingClientRect?.();
      const dx = Number(previous?.left) - Number(current?.left);
      const dy = Number(previous?.top) - Number(current?.top);
      if (Number.isFinite(dx) && Number.isFinite(dy) && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        rack.style?.setProperty?.('--craps-rank-shift-x', `${dx}px`);
        rack.style?.setProperty?.('--craps-rank-shift-y', `${dy}px`);
        rack.classList?.add('is-rank-shifting');
      }
    });
    return visibleStandings;
  }

  #paintOpponentRacks(roundNumber = 0, roundResult = null, atRoundFlip = false, reorder = false) {
    this.#syncWagerMultiplier(roundNumber);
    if (reorder) this.#featuredStandings(roundNumber, null, roundResult, atRoundFlip, true);
    this.#paintRemainingOtherWagers(roundNumber);
    this.#paintBattleLeaderboard(roundNumber, null, roundResult, atRoundFlip, reorder);
    const table = this.querySelector('[data-bind="craps-table-rail"]');
    const board = this.querySelector('[data-bind="craps-roll-board"]');
    const multiplier = this.querySelector('[data-bind="craps-shooter-boost-multiplier"]');
    const localBoost = this.#activeShooterBoostEntries(roundNumber).find((entry) => entry.local)?.shooterBoost ?? null;
    if (table) {
      table.dataset.shooterBoost = localBoost ? 'active' : 'off';
    }
    if (board) board.dataset.shooterBoost = localBoost ? 'active' : 'off';
    if (multiplier) {
      const percent = localBoost?.percent;
      multiplier.textContent = percent ? `+${percent}%` : localBoost ? 'BONUS' : '';
      multiplier.hidden = !localBoost;
      if (localBoost) {
        multiplier.removeAttribute?.('hidden');
        multiplier.setAttribute?.(
          'aria-label',
          percent ? `${percent}% shooter profit boost` : 'Bonus shooter',
        );
      } else {
        multiplier.setAttribute?.('hidden', '');
        multiplier.removeAttribute?.('aria-label');
      }
    }
  }

  #setResolutionSpeed(value, { persist = false } = {}) {
    const next = normalizeCrapsResolutionSpeed(value);
    this.#resolutionSpeed = next;
    const range = this.querySelector('[data-bind="craps-resolution-speed"]');
    const output = this.querySelector('[data-bind="craps-resolution-speed-value"]');
    if (range) range.value = String(next);
    if (output) output.textContent = `${next}×`;
    const card = this.querySelector('[data-bind="craps-card"]');
    for (const duration of CRAPS_RESOLUTION_CSS_DURATIONS) {
      card?.style?.setProperty?.(
        `--craps-speed-${duration}`,
        `${crapsResolutionDelay(duration, next)}ms`,
      );
    }
    if (persist) writeDegeneretteSpeed(next);
    return next;
  }

  #resolutionDelay(milliseconds) {
    return crapsResolutionDelay(milliseconds, this.#resolutionSpeed);
  }

  #syncRollControls() {
    const screen = this.querySelector('[data-bind="craps-resolution"]');
    const auto = this.querySelector('[data-bind="craps-resolution-auto"]');
    const roll = this.querySelector('[data-bind="craps-resolution-roll"]');
    const complete = screen?.dataset?.phase === 'complete';
    const flipping = this.#survivalFlipActive;
    if (auto) {
      auto.textContent = this.#autoRoll ? 'AUTO ON' : 'AUTO OFF';
      auto.setAttribute('aria-pressed', String(this.#autoRoll));
      auto.hidden = complete || flipping;
      auto.disabled = !this.#resolutionActive || !this.#awaitingRoll || flipping;
    }
    if (roll) {
      const visible = this.#resolutionActive && this.#awaitingRoll && !this.#autoRoll && !flipping;
      roll.hidden = !visible;
      roll.disabled = !visible;
      if (visible) roll.removeAttribute?.('hidden');
      else roll.setAttribute?.('hidden', '');
    }
  }

  #toggleAutoRoll() {
    if (!this.#resolutionActive || !this.#awaitingRoll
      || this.#survivalFlipActive) return;
    this.#stopResolutionTimer();
    this.#autoRoll = !this.#autoRoll;
    this.#syncRollControls();
    if (this.#autoRoll) this.#queueNextResolutionRoll(180);
    else {
      this.#setRollBoard({ state: 'ready' });
      try { this.querySelector('[data-bind="craps-resolution-roll"]')?.focus?.({ preventScroll: true }); }
      catch (_error) { /* optional */ }
    }
  }

  #rollNextResolution() {
    if (!this.#resolutionActive || !this.#awaitingRoll || this.#autoRoll
      || this.#survivalFlipActive) return;
    this.#awaitingRoll = false;
    this.#syncRollControls();
    this.#advanceResolution();
  }

  #queueNextResolutionRoll(delay = 0) {
    if (!this.#resolutionActive || this.#survivalFlipActive) return;
    if (this.#pendingPerspectiveBetId) {
      const selectedBetId = this.#pendingPerspectiveBetId;
      this.#pendingPerspectiveBetId = null;
      this.#selectPerspective(selectedBetId, { atResolvedBoundary: true });
      return;
    }
    this.#awaitingRoll = true;
    this.#syncRollControls();
    if (!this.#autoRoll) {
      this.#setRollBoard({ state: 'ready' });
      return;
    }
    this.#resolutionTimer = globalThis.setTimeout?.(() => {
      this.#resolutionTimer = null;
      if (!this.#resolutionActive || !this.#awaitingRoll || !this.#autoRoll) return;
      this.#awaitingRoll = false;
      this.#syncRollControls();
      this.#advanceResolution();
    }, this.#resolutionDelay(delay)) ?? null;
  }

  #renderDiceBay() {
    const bay = this.querySelector('[data-bind="craps-dice-bay"]');
    const dieOne = this.querySelector('[data-bind="craps-die-one"]');
    const dieTwo = this.querySelector('[data-bind="craps-die-two"]');
    const totalNode = this.querySelector('[data-bind="craps-roll-total"]');
    if (!bay) return;

    let hands = [];
    if (this.#rolls != null) {
      try { hands = decodeCrapsRolls(this.#rolls); }
      catch (_error) { hands = []; }
    }
    const first = hands[0]?.rolls?.[0] ?? null;
    const rollCount = hands.reduce((total, hand) => total + hand.rolls.length, 0);
    const state = this.#tableResolved ? (first ? 'rolled' : 'ready') : 'open';
    bay.dataset.state = state;
    this.#paintDiceBadge(dieOne, first?.d1 ?? 2, CRAPS_DICE_BADGE_COLORS[0]);
    this.#paintDiceBadge(dieTwo, first?.d2 ?? 5, CRAPS_DICE_BADGE_COLORS[1]);
    this.#resetSurvivalStage();
    this.#setPoint(null);

    if (!this.#tableResolved) {
      if (totalNode) totalNode.textContent = '—';
      this.#setRollBoard({ event: 'COME-OUT WAITING', result: '—', state: 'waiting' });
      bay.setAttribute('aria-label', 'Shared table dice roll. The table is open and waiting for dice.');
    } else if (first) {
      if (totalNode) totalNode.textContent = String(first.total);
      this.#setRollBoard({ event: 'TABLE ROLLED', result: 'READY', state: 'ready' });
      bay.setAttribute('aria-label', `Shared table dice roll. First roll ${first.d1} and ${first.d2}, total ${first.total}. ${rollCount} rolls across ${hands.length} shooters. Replay ready.`);
    } else {
      if (totalNode) totalNode.textContent = '—';
      this.#setRollBoard({ event: 'TABLE ROLLED', result: 'READY', state: 'ready' });
      bay.setAttribute('aria-label', 'Shared table dice roll is public. Settlement is ready.');
    }
  }

  #render() {
    const wager = this.#wager();
    const perHand = BigInt(wager.perHandFlip);
    const maxLoss = BigInt(wager.maxLossFlip);
    const overBalance = this.#balance != null && maxLoss > this.#balance;
    const locked = this.#busy || this.#tableResolved || this.#screen !== 'placement';
    const scheduledTerms = this.#entryKind !== 'custom';
    const battleScreen = this.#screen === 'battle';

    // Keep the editable picker independent from the much richer replay paint.
    // Battle racks, standings, and dice are hidden on placement screens; running
    // those painters here only lets an unrelated replay-data failure strand the
    // board on its static shell after #placeChip has already changed the model.
    this.#renderChips();

    const entryLabel = this.querySelector('[data-bind="craps-entry-label"]');
    if (entryLabel) {
      entryLabel.textContent = this.#entryLabel;
      entryLabel.hidden = this.#entryLabel.length === 0;
    }

    if (battleScreen) this.#paintBattleLeaderboard(0);
    for (const spot of this.querySelectorAll('[data-stake-bet]')) {
      const bet = BET_BY_ID.get(spot.dataset.bet);
      if (!bet) continue;
      const amount = this.#bets.get(bet.id) ?? 0n;
      const active = amount > 0n;
      const atChipLimit = amount >= BigInt(CRAPS_MAX_CHIPS_PER_BET);
      const other = this.#paintBetCorners(spot, bet.id);
      spot.dataset.active = String(active);
      spot.dataset.chipLimit = String(atChipLimit);
      spot.disabled = locked;
      spot.setAttribute('aria-pressed', String(active));
      const otherCopy = other.amount > 0n
        ? ` Other players have ${other.amount} chips here.`
        : '';
      const localCopy = active
        ? `Your stack has ${amount} chip${amount === 1n ? '' : 's'}.`
        : 'Your stack is empty.';
      const limitCopy = atChipLimit ? ' This bet is at the four-chip maximum.' : '';
      spot.setAttribute('aria-label', `${bet.label}. ${betRules(bet)} ${localCopy}${limitCopy}${otherCopy}`);
    }

    if (battleScreen) {
      this.#renderOtherPlayers();
      this.#renderDiceBay();
    }

    const bankroll = this.querySelector('[name="craps-bankroll"]');
    const goal = this.querySelector('[name="craps-goal"]');
    const sessionSetup = this.querySelector('.craps-session-setup');
    if (sessionSetup) sessionSetup.hidden = this.#entryKind === 'board';
    if (bankroll) {
      bankroll.value = this.#bankroll.toString();
      bankroll.min = perHand.toString();
      bankroll.disabled = locked;
      bankroll.readOnly = scheduledTerms;
      bankroll.setAttribute('aria-readonly', String(scheduledTerms));
    }
    if (goal) {
      goal.value = this.#goal.toString();
      goal.disabled = locked;
      goal.readOnly = scheduledTerms;
      goal.setAttribute('aria-readonly', String(scheduledTerms));
    }

    const activity = this.querySelector('[data-bind="craps-activity"]');
    if (activity) activity.textContent = this.#activityScore == null ? '—' : formatCrapsFlip(this.#activityScore);

    const perNode = this.querySelector('[data-bind="craps-per-shooter"]');
    const planNode = this.querySelector('[data-bind="craps-plan"]');
    const totalNode = this.querySelector('[data-bind="craps-total"]');
    if (perNode) perNode.textContent = `${wager.selectedChips} / ${CRAPS_PICKED_CHIPS}`;
    if (planNode) planNode.textContent = this.#entryKind === 'board'
      ? 'SAVE THEN BUY IN'
      : this.#goal === 0n ? 'NONE' : `${formatCrapsCompactFlip(this.#goal)} FLIP`;
    if (totalNode) totalNode.textContent = this.#entryKind === 'board'
      ? 'BOARD ONLY'
      : `${formatCrapsCompactFlip(maxLoss)} FLIP`;

    const firstError = wager.errors.find((error) => error.code !== 'NoStake') ?? wager.errors[0];
    const status = this.querySelector('[data-bind="craps-status"]');
    if (status) {
      if (this.#message) status.textContent = this.#message;
      else if (this.#tableResolved) status.textContent = 'Dice are public. Betting on this table is closed.';
      else if (firstError) status.textContent = firstError.message;
      else if (overBalance) status.textContent = `${formatCrapsFlip(maxLoss - this.#balance)} FLIP over balance.`;
      else if (this.#entryKind === 'board') status.textContent = 'PLACE ALL SEVEN CHIPS · SAVE THIS BOARD FOR THE BUY IN BUTTONS';
      else if (this.#balance != null) status.textContent = `${formatCrapsCompactFlip(this.#balance)} FLIP AVAILABLE · SEVEN EQUAL CHIPS SET THE BOARD`;
      else status.textContent = 'PLACE ALL SEVEN CHIPS · STACKING ALLOWED';
      status.classList?.toggle('is-error', Boolean(this.#message || firstError || overBalance || this.#tableResolved));
    }

    const undo = this.querySelector('[data-bind="craps-undo"]');
    const clear = this.querySelector('[data-bind="craps-clear"]');
    const replay = this.querySelector('[data-bind="craps-replay"]');
    if (undo) undo.disabled = locked || this.#history.length === 0;
    if (clear) clear.disabled = locked || this.#bets.size === 0;
    if (replay) {
      replay.hidden = this.#rolls == null;
      if (this.#rolls != null) replay.removeAttribute?.('hidden');
      else replay.setAttribute?.('hidden', '');
      replay.disabled = this.#busy;
    }

    const submit = this.querySelector('[data-bind="craps-submit"]');
    if (submit) {
      if (this.#tableResolved) {
        const count = this.#pendingBetIds.length;
        submit.disabled = this.#busy || count === 0;
        submit.textContent = this.#busy ? 'SETTLING…' : count > 0 ? `SETTLE ${count} BET${count === 1 ? '' : 'S'}` : 'TABLE ROLLED';
      } else {
        submit.disabled = this.#busy || !wager.valid || overBalance;
        submit.textContent = this.#busy
          ? 'LOCKING WAGER…'
          : !wager.valid
            ? 'FINISH THE BOARD'
            : this.#entryKind === 'board'
              ? 'SAVE BOARD'
              : `${this.#entryKind === 'day'
                ? 'ENTER FULL DAY'
                : this.#entryKind === 'window'
                  ? `ENTER BATTLE ${(this.#entryPeriod ?? 0) + 1}`
                  : 'ENTER BATTLE'} · ${formatCrapsCompactFlip(maxLoss)} FLIP`;
      }
    }
    this.#paintTitleGoal();
  }

  async #submit() {
    if (this.#busy) return;
    if (this.#tableResolved) { await this.#settlePending(); return; }
    const wager = this.#wager();
    const maxLoss = BigInt(wager.maxLossFlip);
    if (!wager.valid || (this.#balance != null && maxLoss > this.#balance)) return;

    if (!this.#confirm) {
      const event = new CustomEvent(CRAPS_TABLE_SUBMIT_EVENT, { detail: wager, bubbles: true, composed: true, cancelable: true });
      if (this.dispatchEvent(event)) this.#close();
      return;
    }

    this.#busy = true;
    this.#message = '';
    this.#render();
    try {
      const completed = await this.#confirm(wager);
      this.#busy = false;
      if (completed !== false) this.#close();
      else { this.#message = 'Wager was not submitted.'; this.#render(); }
    } catch (error) {
      this.#busy = false;
      this.#message = String(error?.userMessage || error?.message || 'Wager was not submitted. Try again.');
      this.#render();
    }
  }

  async #settlePending() {
    if (this.#pendingBetIds.length === 0) return;
    const detail = { betIds: [...this.#pendingBetIds], tableIndex: this.#tableIndex, preview: this.#preview };
    if (!this.#settle) {
      const event = new CustomEvent(CRAPS_TABLE_SETTLE_EVENT, { detail, bubbles: true, composed: true, cancelable: true });
      if (this.dispatchEvent(event)) this.#close();
      return;
    }
    this.#busy = true;
    this.#message = '';
    this.#render();
    try {
      const completed = await this.#settle(detail);
      this.#busy = false;
      if (completed !== false && this.#resolutionRun.frames.length > 0) {
        this.#pendingBetIds = [];
        this.#startResolution();
      } else if (completed !== false) this.#close();
      else { this.#message = 'Bets were not settled.'; this.#render(); }
    } catch (error) {
      this.#busy = false;
      this.#message = String(error?.userMessage || error?.message || 'Bets were not settled. Try again.');
      this.#render();
    }
  }

  #replay() {
    if (this.#rolls == null) return;
    let hands;
    try { hands = decodeCrapsRolls(this.#rolls); }
    catch (error) { this.#message = error.message; this.#render(); return; }
    this.dispatchEvent(new CustomEvent(CRAPS_TABLE_REPLAY_EVENT, {
      detail: { tableIndex: this.#tableIndex, rolls: this.#rolls, hands }, bubbles: true, composed: true,
    }));
    if (this.#resolutionRun.frames.length > 0) this.#startResolution();
  }

  #stopResolutionTimer() {
    if (this.#resolutionTimer != null) globalThis.clearTimeout?.(this.#resolutionTimer);
    this.#resolutionTimer = null;
    this.#clearPayoutFlight();
    this.#clearBankrollLoss();
  }

  #clearPayoutFlight() {
    const host = this.querySelector('[data-bind="craps-payout-flight"]');
    if (host) {
      host.textContent = '';
      delete host.dataset.active;
      delete host.dataset.flow;
    }
    this.querySelectorAll('.craps-bet.is-paying').forEach((spot) => spot.classList?.remove('is-paying'));
    this.querySelectorAll('.craps-bet.is-paying-others').forEach((spot) => spot.classList?.remove('is-paying-others'));
    this.querySelectorAll('.craps-bet__seat-chip.is-paying-featured').forEach((seat) => seat.classList?.remove('is-paying-featured'));
    this.querySelectorAll('.craps-battle-rack.is-collecting').forEach((rack) => rack.classList?.remove('is-collecting'));
  }

  #boardBetSpots() {
    return [...this.querySelectorAll('[data-bet]')].filter((spot) => {
      return spot.dataset.active === 'true' || spot.dataset.otherActive === 'true';
    });
  }

  #sevenOutClearSpots() {
    return this.#boardBetSpots().filter((spot) => (
      spot.dataset.bet !== 'dont-pass'
      && !spot.classList?.contains('is-seven-cleared')
    ));
  }

  #releaseBoardBetSpots(spots) {
    for (const spot of spots) {
      spot.classList?.remove('is-seven-clearing', 'is-seven-cleared', 'is-seven-reloading');
      spot.style?.removeProperty?.('--board-clear-delay');
      spot.style?.removeProperty?.('--board-deal-delay');
    }
  }

  #boardInPlayFlip(phase = null, { dealingBetIds = [] } = {}) {
    const boardState = phase
      ?? this.querySelector('[data-bind="craps-table-rail"]')?.dataset?.board
      ?? 'live';
    if (boardState === 'empty' || boardState === 'clearing') return 0n;
    const allowed = boardState === 'come-out'
      ? CRAPS_LINE_BET_ID_SET
      : boardState === 'dont-pass'
        ? new Set(['dont-pass'])
        : null;
    const dealing = new Set(normalizedPayoutBetIds(dealingBetIds));
    const liveChips = this.#boardBetSpots().reduce((sum, spot) => {
      const id = spot.dataset.bet;
      if (allowed && !allowed.has(id)) return sum;
      if (this.#retiredBetIds.has(id) && !dealing.has(id)) return sum;
      const held = spot.classList?.contains('is-seven-cleared')
        || spot.classList?.contains('is-seven-clearing');
      if (held && !dealing.has(id)) return sum;
      return sum + (this.#bets.get(id) ?? 0n);
    }, 0n);
    return liveChips
      * (this.#playedFlip / CRAPS_BOARD_CHIPS)
      * this.#wagerMultiplier;
  }

  #resetBoardBetState() {
    const table = this.querySelector('[data-bind="craps-table-rail"]');
    if (table) {
      delete table.dataset.board;
      delete table.dataset.comeOut;
    }
    this.#retiredBetIds.clear();
    this.#releaseBoardBetSpots(this.querySelectorAll('[data-bet]'));
  }

  #holdComeOutBoard({ resetLines = true } = {}) {
    const table = this.querySelector('[data-bind="craps-table-rail"]');
    const spots = this.#boardBetSpots();
    const parked = new Set(crapsComeOutHeldBetIds(
      spots.map((spot) => spot.dataset.bet),
      {
        heldBetIds: spots
          .filter((spot) => spot.classList?.contains('is-seven-cleared'))
          .map((spot) => spot.dataset.bet),
        resetLines,
      },
    ));
    for (const spot of spots) {
      if (parked.has(spot.dataset.bet)) {
        spot.classList?.remove('is-seven-clearing', 'is-seven-reloading');
        spot.classList?.add('is-seven-cleared');
      } else {
        this.#releaseBoardBetSpots([spot]);
      }
    }
    if (table) {
      table.dataset.board = 'come-out';
      if (resetLines) delete table.dataset.comeOut;
      else table.dataset.comeOut = 'same-shooter';
    }
  }

  #holdBoardCleared() {
    const table = this.querySelector('[data-bind="craps-table-rail"]');
    if (table) {
      table.dataset.board = 'dont-pass';
      delete table.dataset.comeOut;
    }
    const dontPass = this.querySelector('[data-bet="dont-pass"]');
    const dontPassWasHeld = dontPass?.classList?.contains('is-seven-cleared');
    if (dontPass && !dontPassWasHeld) this.#releaseBoardBetSpots([dontPass]);
    for (const spot of this.#sevenOutClearSpots()) {
      spot.classList?.remove('is-seven-clearing', 'is-seven-reloading');
      spot.classList?.add('is-seven-cleared');
    }
    const frame = this.#resolutionRun?.frames[this.#resolutionIndex];
    const nextShooter = this.#isSevenOut(frame)
      && !frame?.terminal
      && this.#resolutionIndex < (this.#resolutionRun?.frames.length ?? 0) - 1;
    // A survival boundary keeps the old rival's coin keyed to that player even
    // if the live top-ten order changes underneath the flip beat.
    const survivalBeat = frame?.survival != null
      || this.#opponentSurvivalFlipsAt(this.#endedShooterAtFrame(this.#resolutionIndex)).length > 0;
    const standingsCheckpoint = crapsLeaderboardCheckpoint(frame);
    this.#paintOpponentRacks(
      this.#resolutionIndex + 1,
      null,
      false,
      standingsCheckpoint && !survivalBeat,
    );
  }

  #isSevenOut(frame) {
    return /\bseven(?:\s|-)?out\b/i.test(String(frame?.label ?? ''));
  }

  #animateSevenOutClear(frameIndex, onDone) {
    const spots = this.#sevenOutClearSpots();
    if (spots.length === 0) { onDone?.(); return; }
    const table = this.querySelector('[data-bind="craps-table-rail"]');
    if (table) table.dataset.board = 'clearing';
    spots.forEach((spot, index) => {
      spot.style?.setProperty?.('--board-clear-delay', `${this.#resolutionDelay(index * 8)}ms`);
      spot.classList?.remove('is-seven-cleared', 'is-seven-reloading');
      void spot.offsetWidth;
      spot.classList?.add('is-seven-clearing');
    });
    const duration = 240 + Math.max(0, spots.length - 1) * 8;
    this.#resolutionTimer = globalThis.setTimeout?.(() => {
      this.#resolutionTimer = null;
      if (!this.#resolutionActive || this.#resolutionIndex !== frameIndex) return;
      this.#holdBoardCleared();
      onDone?.();
    }, this.#resolutionDelay(duration)) ?? null;
  }

  #animateBoardReload(frame, frameIndex, onDone, {
    phase = 'live',
    bankrollFlip = frame.bankrollFlip,
    resetRetirements = false,
  } = {}) {
    if (resetRetirements) this.#retiredBetIds.clear();
    const heldSpots = this.#boardBetSpots().filter((spot) => spot.classList?.contains('is-seven-cleared'));
    const dealIds = new Set(crapsBoardDealBetIds(heldSpots.map((spot) => spot.dataset.bet), { phase }));
    // A shooter starts with the two line placements only. The number and hardway
    // placements stay physically parked until the come-out establishes a point.
    const spots = heldSpots.filter((spot) => (
      dealIds.has(spot.dataset.bet)
      && !this.#retiredBetIds.has(spot.dataset.bet)
    ));
    const host = this.querySelector('[data-bind="craps-payout-flight"]');
    const card = this.querySelector('[data-bind="craps-card"]');
    const rack = this.querySelector('[data-bind="craps-resolution-chips"]');
    const table = this.querySelector('[data-bind="craps-table-rail"]');
    const bankroll = this.#displayedViewerBankroll(bankrollFlip);
    const viewerClosed = frame?.viewerClosed === true;
    if (viewerClosed) this.#paintOpponentRacks(frameIndex + 1);
    const inPlayFlip = viewerClosed
      ? 0n
      : this.#boardInPlayFlip(phase, {
          dealingBetIds: spots.map((spot) => spot.dataset.bet),
        });
    let flightCount = 0;
    let betPlacePlayed = false;
    const playBetPlace = () => {
      if (betPlacePlayed || flightCount === 0) return;
      betPlacePlayed = true;
      sfxCrapsBetPlace();
    };
    const finish = () => {
      playBetPlace();
      this.#paintResolutionTray(bankroll, {
        active: !viewerClosed,
        inPlayFlip,
      });
      this.#releaseBoardBetSpots(spots);
      if (table) {
        if (phase === 'come-out') table.dataset.board = 'come-out';
        else delete table.dataset.board;
        delete table.dataset.comeOut;
      }
      this.#paintOpponentRacks(frameIndex + 1);
      this.#clearPayoutFlight();
      onDone?.();
    };
    if (spots.length === 0 || !host || !card || !rack
      || typeof card.getBoundingClientRect !== 'function'
      || typeof rack.getBoundingClientRect !== 'function') {
      finish();
      return;
    }
    // Capture the red bankroll cells before the next base board turns them
    // green. Those exact cells are the physical source of the felt reload.
    const bankedBefore = new Set(rack.querySelectorAll('.craps-run-chip.is-filled.is-banked'));
    this.#paintResolutionTray(bankroll, {
      active: !viewerClosed,
      inPlayFlip,
    });
    const cardRect = card.getBoundingClientRect();
    const rackRect = rack.getBoundingClientRect();
    if (!cardRect.width || !rackRect.width) { finish(); return; }
    const allGreenChips = [...rack.querySelectorAll('.craps-run-chip.is-filled.is-in-play')];
    const newlyGreenChips = allGreenChips.filter((chip) => bankedBefore.has(chip));
    const greenChips = newlyGreenChips.length > 0 ? newlyGreenChips : allGreenChips;
    const firstGreenRect = greenChips[0]?.getBoundingClientRect?.();
    const lastGreenRect = greenChips.at(-1)?.getBoundingClientRect?.();
    const dealRect = firstGreenRect?.width && lastGreenRect?.width
      ? {
          left: firstGreenRect.left,
          top: firstGreenRect.top,
          width: Math.max(firstGreenRect.width, lastGreenRect.right - firstGreenRect.left),
          height: firstGreenRect.height,
        }
      : {
          left: rackRect.left + rackRect.width * 0.66,
          top: rackRect.top,
          width: rackRect.width * 0.3,
          height: rackRect.height,
        };
    const opponentRackByKey = new Map(
      [...this.querySelectorAll('[data-battle-key]')]
        .map((opponentRack) => [opponentRack.dataset.battleKey, opponentRack]),
    );
    if (table) table.dataset.board = 'reloading';
    this.#clearPayoutFlight();
    host.dataset.active = 'true';
    host.dataset.flow = 'deal';
    spots.forEach((spot, index) => {
      const delay = this.#resolutionDelay(index * 12);
      spot.style?.setProperty?.('--board-deal-delay', `${delay}ms`);
      spot.classList?.add('is-seven-reloading');
      const lane = spots.length <= 1 ? 0.5 : index / (spots.length - 1);
      const markers = [...spot.querySelectorAll?.('.craps-bet__seat-chip') ?? []]
        .filter((candidate) => !candidate.hidden && candidate.dataset.playerKey);
      markers.forEach((marker, markerIndex) => {
        if (typeof marker.getBoundingClientRect !== 'function') return;
        const targetRect = marker.getBoundingClientRect();
        if (!targetRect.width) return;
        const local = marker.dataset.playerKey === 'local';
        const opponentRack = local ? null : opponentRackByKey.get(marker.dataset.playerKey);
        const opponentRackChips = opponentRack
          ? [...opponentRack.querySelectorAll('.craps-battle-rack__chip.is-filled')]
          : [];
        const opponentSource = opponentRackChips.at(-1)
          ?? opponentRack?.querySelector?.('.craps-battle-rack__well');
        const opponentRect = opponentSource?.getBoundingClientRect?.();
        if (!local && !opponentRect?.width) return;
        const startX = local
          ? dealRect.left + dealRect.width * (0.12 + lane * 0.76) - cardRect.left
          : opponentRect.left + opponentRect.width * 0.5 - cardRect.left + (markerIndex - 1.5) * 2;
        const startY = local
          ? dealRect.top + dealRect.height * 0.5 - cardRect.top
          : opponentRect.top + opponentRect.height * 0.5 - cardRect.top;
        const endX = targetRect.left + targetRect.width * 0.5 - cardRect.left;
        const endY = targetRect.top + targetRect.height * 0.5 - cardRect.top;
        const dx = endX - startX;
        const dy = endY - startY;
        const chip = globalThis.document?.createElement?.('img');
        if (!chip) return;
        chip.className = local ? 'is-board-deal' : 'is-board-deal is-featured-deal';
        chip.src = CRAPS_CHIP_ART[marker.dataset.face] ?? CRAPS_CHIP_ART.red;
        chip.alt = '';
        chip.draggable = false;
        const halfSize = local ? 17 : 11;
        chip.style.left = `${startX - halfSize}px`;
        chip.style.top = `${startY - halfSize}px`;
        chip.style.setProperty('--flight-mid-x', `${dx * 0.52 + (index % 2 === 0 ? -18 : 18)}px`);
        chip.style.setProperty('--flight-mid-y', `${dy * 0.48 - 44 - (index % 3) * 8}px`);
        chip.style.setProperty('--flight-end-x', `${dx}px`);
        chip.style.setProperty('--flight-end-y', `${dy}px`);
        chip.style.setProperty('--flight-delay', `${delay}ms`);
        host.appendChild(chip);
        flightCount += 1;
      });
    });
    host.querySelector?.('img.is-board-deal')
      ?.addEventListener?.('animationend', playBetPlace, { once: true });
    const duration = 300 + Math.max(0, spots.length - 1) * 12;
    this.#resolutionTimer = globalThis.setTimeout?.(() => {
      this.#resolutionTimer = null;
      if (this.#resolutionActive && this.#resolutionIndex === frameIndex) finish();
    }, this.#resolutionDelay(flightCount > 0 ? duration : 360)) ?? null;
  }

  #clearBankrollLoss() {
    this.querySelector('[data-bind="craps-resolution-meter"]')
      ?.classList?.remove('is-crapping-out', 'is-seven-out');
    this.querySelectorAll('[data-bind="craps-resolution-chips"] .craps-run-chip.is-lost').forEach((chip) => {
      chip.classList?.remove('is-lost');
      chip.style?.removeProperty?.('--loss-delay');
    });
  }

  #lostBetSpots(frame) {
    const ids = new Set(crapsRetiredBetIds(frame));
    if (ids.size === 0) return [];
    return this.#boardBetSpots().filter((spot) => (
      ids.has(spot.dataset.bet) && !spot.classList?.contains('is-seven-cleared')
    ));
  }

  #holdLostBetCollection(frame) {
    for (const id of crapsRetiredBetIds(frame)) this.#retiredBetIds.add(id);
    for (const spot of this.#lostBetSpots(frame)) {
      spot.classList?.remove('is-seven-clearing', 'is-seven-reloading');
      spot.classList?.add('is-seven-cleared');
    }
  }

  #animateLostBetCollection(frame, frameIndex, onDone) {
    const spots = this.#lostBetSpots(frame);
    if (spots.length === 0) return 0;
    spots.forEach((spot, index) => {
      spot.style?.setProperty?.('--board-clear-delay', `${this.#resolutionDelay(index * 16)}ms`);
      spot.classList?.remove('is-seven-cleared', 'is-seven-reloading');
      void spot.offsetWidth;
      spot.classList?.add('is-seven-clearing');
    });
    const duration = 380 + Math.max(0, spots.length - 1) * 16;
    const first = spots[0];
    first?.addEventListener?.('animationend', () => {
      if (!this.#resolutionActive || this.#resolutionIndex !== frameIndex) return;
      onDone?.();
    }, { once: true });
    return this.#resolutionDelay(duration);
  }

  #setResolutionVisible(visible) {
    const screen = this.querySelector('[data-bind="craps-resolution"]');
    const table = this.querySelector('[data-bind="craps-table-rail"]');
    const controls = this.querySelector('[data-bind="craps-controls"]');
    const felt = this.querySelector('.craps-table-felt');
    const card = this.querySelector('[data-bind="craps-card"]');
    const showBattleRack = !visible && this.#screen === 'battle';
    const showRack = visible || showBattleRack;
    if (screen) {
      screen.hidden = !showRack;
      screen.dataset.view = visible ? 'resolution' : showBattleRack ? 'battle' : 'placement';
      if (showRack) screen.removeAttribute?.('hidden');
      else screen.setAttribute?.('hidden', '');
      if (showBattleRack) screen.dataset.phase = 'live';
    }
    // Resolution is part of the shared felt, not a replacement screen. Keep
    // every wager visible while the normal dice bay replays the run.
    if (table) {
      table.hidden = false;
      table.removeAttribute?.('hidden');
      table.dataset.resolution = visible ? 'active' : 'idle';
    }
    felt?.classList?.toggle('is-resolving', visible);
    card?.classList?.toggle('is-resolving', visible);
    if (card) card.dataset.screen = this.#screen;
    if (felt) felt.setAttribute('aria-busy', String(visible && this.#resolutionActive));
    if (controls) {
      const hideControls = visible || this.#screen === 'battle';
      controls.hidden = hideControls;
      if (hideControls) controls.setAttribute?.('hidden', '');
      else controls.removeAttribute?.('hidden');
    }
    if (showBattleRack) {
      this.#paintResolutionTray(this.#bankroll, {
        active: true,
        inPlayFlip: this.#boardInPlayFlip(),
      });
    }
    const replayedRolls = visible
      ? Math.max(0, this.#resolutionIndex + 1)
      : this.#tableResolved && !this.#showResolutionOnOpen
        ? this.#resolutionRun?.frames.length ?? 0
        : 0;
    this.#paintJackpotTray(replayedRolls);
  }

  #paintTitleGoal() {
    const titleGoal = this.querySelector('[data-bind="craps-title-goal"]');
    const titleGoalAmount = this.querySelector('[data-bind="craps-title-goal-amount"]');
    const showGoal = this.#entryKind !== 'board' && this.#goal > 0n;
    if (titleGoal) {
      titleGoal.hidden = !showGoal;
      titleGoal.setAttribute(
        'aria-label',
        showGoal ? `Bankroll goal ${formatCrapsFlip(this.#goal)} FLIP.` : 'Bankroll goal unavailable.',
      );
    }
    if (titleGoalAmount) {
      titleGoalAmount.textContent = showGoal ? formatCrapsCompactFlip(this.#goal) : '—';
    }
    return showGoal;
  }

  #paintJackpotTray(addedRolls = 0) {
    const showGoal = this.#paintTitleGoal();
    const marquee = this.querySelector('[data-bind="craps-prize-marquee"]');
    const jackpotMarquee = this.querySelector('[data-bind="craps-jackpot-marquee"]');
    const jackpotMarqueeAmount = this.querySelector('[data-bind="craps-jackpot-marquee-amount"]');
    const bountyMarquee = this.querySelector('[data-bind="craps-bounty-marquee"]');
    const bountyAmountNode = this.querySelector('[data-bind="craps-bounty-amount"]');
    const bountyAdded = this.querySelector('[data-bind="craps-bounty-added"]');
    const bountyAddedAmountNode = this.querySelector('[data-bind="craps-bounty-added-amount"]');
    // ⛔ THE PROGRESSIVE RACK IS GONE. It was a second 100-chip tray creeping toward a threshold,
    // and the main player BANKROLL rack now carries that job. Removing it also retired the last
    // consumer of the old roll-cutoff model: the rack filled on ROLLS, the progressive has drawn
    // on a high-water SCORE since the 2026-08-29 re-vendor, and the two are different units. What
    // survives here is the MARQUEE — the jackpot headline, goal and bounty pool — which never
    // depended on the rack.
    const replayedRolls = clampInteger(addedRolls, 0, CRAPS_REPLAY_MAX_ROLLS, 0);
    const replayFrameCount = this.#resolutionRun?.frames.length ?? 0;
    const personalReplayFinished = replayFrameCount > 0 && replayedRolls >= replayFrameCount;
    const resultSettled = this.#jackpotWonAtScoreBps == null || personalReplayFinished;
    const resultState = resultSettled ? this.#jackpotState : 'live';
    const displayState = resultState === 'live' ? 'ready' : resultState;
    const jackpotAmount = this.#jackpotAmountFlip;
    const bountyPoolWei = this.#bountyPoolWei;
    const bountyPoolWholeFlip = bountyPoolWei == null ? null : bountyPoolWei / CRAPS_FLIP_WEI;
    const bountyAmountCopy = bountyPoolWei == null
      ? '—'
      : bountyPoolWholeFlip >= 1_000n
        ? formatCrapsCompactFlip(bountyPoolWholeFlip)
        : formatCrapsWei(bountyPoolWei);
    const addedFlipWei = this.#addedFlipWei;
    const addedWholeFlip = addedFlipWei == null ? null : addedFlipWei / CRAPS_FLIP_WEI;
    const addedAmountCopy = addedFlipWei == null
      ? '—'
      : `+${addedWholeFlip >= 1_000n
        ? formatCrapsCompactFlip(addedWholeFlip)
        : formatCrapsWei(addedFlipWei)}`;
    const showJackpot = jackpotAmount != null && jackpotAmount > 0n;
    const showBounty = this.#entryKind !== 'board'
      && (this.#screen === 'battle' || this.#battleStake > 0n || bountyPoolWei != null);

    if (jackpotMarquee) {
      jackpotMarquee.hidden = !showJackpot;
      jackpotMarquee.dataset.state = displayState;
      jackpotMarquee.setAttribute(
        'aria-label',
        showJackpot ? `Run It Up jackpot ${formatCrapsFlip(jackpotAmount)} FLIP.` : 'Run It Up jackpot unavailable.',
      );
    }
    if (jackpotMarqueeAmount) {
      jackpotMarqueeAmount.textContent = showJackpot ? formatCrapsJackpotFlip(jackpotAmount) : '—';
    }
    if (bountyMarquee) {
      bountyMarquee.hidden = !showBounty;
      bountyMarquee.dataset.state = bountyPoolWei == null ? 'unavailable' : 'ready';
      bountyMarquee.setAttribute(
        'aria-label',
        showBounty && bountyPoolWei != null
          ? `${this.#bountyPoolScope === 'main' ? 'Main battle bounty' : 'Whole battle bounty pool'} ${formatCrapsWei(bountyPoolWei)} FLIP.${addedFlipWei == null
            ? ' Added FLIP unavailable.'
            : ` ${formatCrapsWei(addedFlipWei)} FLIP added.`}`
          : 'Whole battle bounty pool unavailable.',
      );
    }
    if (bountyAmountNode) bountyAmountNode.textContent = showBounty ? bountyAmountCopy : '—';
    if (bountyAdded) bountyAdded.dataset.state = addedFlipWei == null ? 'unavailable' : 'ready';
    if (bountyAddedAmountNode) bountyAddedAmountNode.textContent = addedAmountCopy;
    if (marquee) {
      const prizeCount = Number(showJackpot) + Number(showGoal) + Number(showBounty);
      marquee.hidden = prizeCount === 0;
      marquee.dataset.count = String(prizeCount);
    }

    // `data-jackpot` is no longer written: the rack it reserved a grid row for is gone, and the
    // CSS that keyed on [data-jackpot="active"] went with it.
  }

  #resolutionHighPoint(amount) {
    let highPoint = wholeFlip(this.#resolutionRun?.startingBankrollFlip) ?? 0n;
    const current = wholeFlip(amount) ?? 0n;
    if (current > highPoint) highPoint = current;
    const frames = this.#resolutionRun?.frames ?? [];
    const throughIndex = Math.min(frames.length - 1, Math.max(-1, this.#resolutionIndex));
    for (let index = 0; index <= throughIndex; index += 1) {
      const bankroll = wholeFlip(frames[index]?.bankrollFlip) ?? 0n;
      if (bankroll > highPoint) highPoint = bankroll;
    }
    return highPoint;
  }

  #paintProgressiveTrayScale(scale, chips) {
    const tray = this.querySelector('[data-bind="craps-resolution-tray"]');
    const overlay = this.querySelector('[data-bind="craps-jp-scale"]');
    const commonLabel = this.querySelector('[data-bind="craps-jp-common-label"]');
    const rareLabel = this.querySelector('[data-bind="craps-jp-rare-label"]');
    const highAmount = this.querySelector('[data-bind="craps-jp-high-amount"]');
    const active = scale != null;
    if (tray) {
      tray.dataset.scale = active ? 'progressive' : 'bankroll';
      tray.setAttribute('aria-label', active ? 'Player Run It Up jackpot high-point tray' : 'Player bankroll tray');
    }
    if (overlay) {
      overlay.hidden = !active;
      if (active) overlay.removeAttribute?.('hidden');
      else overlay.setAttribute?.('hidden', '');
    }
    if (!active) {
      [...chips].forEach((chip) => {
        chip.classList?.remove('is-jp-achieved', 'is-jp-pending');
      });
      return false;
    }

    overlay?.style?.setProperty?.('--craps-jp-common-at', `${scale.commonPointPercent}%`);
    overlay?.style?.setProperty?.('--craps-jp-high-at', `${scale.highPointPercent}%`);
    if (overlay) {
      overlay.dataset.highScoreBps = scale.scoreBps.toString();
      overlay.dataset.commonScoreBps = scale.commonScoreBps.toString();
      overlay.dataset.rareScoreBps = scale.rareScoreBps.toString();
    }
    if (commonLabel) commonLabel.textContent = `RUN IT UP ${scale.commonMultiple}×`;
    if (rareLabel) rareLabel.textContent = `RARE ${scale.rareMultiple}×`;
    if (highAmount) highAmount.textContent = formatCrapsFlip(scale.highPointFlip);
    [...chips].forEach((chip, index) => {
      const achieved = index < scale.achievedCount;
      chip.classList?.toggle('is-filled', true);
      chip.classList?.toggle('is-banked', false);
      chip.classList?.toggle('is-in-play', false);
      chip.classList?.toggle('is-reserve-risk', false);
      chip.classList?.toggle('is-goal-locked', true);
      chip.classList?.toggle('is-jp-achieved', achieved);
      chip.classList?.toggle('is-jp-pending', !achieved);
    });
    return true;
  }

  #resolutionTrayFill(amount, slotCount = CRAPS_RACK_SLOTS) {
    return crapsRackPipLayout({
      bankrollFlip: amount,
      capacityFlip: this.#resolutionRun?.capacityFlip ?? 1,
      slotCount,
    });
  }

  #resolutionTrayLayout(amount, {
    active = true,
    allInPlay = false,
    inPlayFlip = null,
    slotCount = CRAPS_RACK_SLOTS,
  } = {}) {
    const fill = this.#resolutionTrayFill(amount, slotCount);
    const { bankroll } = fill;
    const requestedInPlay = active ? wholeFlip(inPlayFlip) : null;
    const split = requestedInPlay == null
      ? crapsRackSplit({
          bankrollFlip: bankroll,
          perHandFlip: this.#wager().perHandFlip,
          wagerMultiplier: this.#wagerMultiplier,
          active,
          allInPlay,
        })
      : {
          inPlayFlip: (requestedInPlay > bankroll ? bankroll : requestedInPlay).toString(),
          bankedFlip: (bankroll - (requestedInPlay > bankroll ? bankroll : requestedInPlay)).toString(),
        };
    const layout = crapsRackPipLayout({
      bankrollFlip: bankroll,
      capacityFlip: fill.capacity,
      inPlayFlip: split.inPlayFlip,
      slotCount,
    });
    return {
      ...fill,
      ...layout,
    };
  }

  #paintResolutionTray(amount, {
    active = true,
    allInPlay = false,
    inPlayFlip = null,
    battleAward = false,
  } = {}) {
    const chips = this.querySelectorAll('[data-bind="craps-resolution-chips"] .craps-run-chip');
    const {
      bankroll,
      capacity,
      chipCount,
      inPlay,
      banked,
      bankedCount,
    } = this.#resolutionTrayLayout(amount, {
      active,
      allInPlay,
      inPlayFlip,
      slotCount: chips.length,
    });
    const amountNode = this.querySelector('[data-bind="craps-resolution-bankroll"]');
    const meter = this.querySelector('[data-bind="craps-resolution-meter"]');
    const goal = BigInt(this.#resolutionRun?.goalFlip ?? 0);
    const nextStake = BigInt(this.#wager().perHandFlip) * this.#wagerMultiplier;
    const reserveState = battleAward
      ? 'safe'
      : crapsRackReserveState({
          bankedFlip: banked,
          nextStakeFlip: nextStake,
          goalFlip: goal,
          active,
        });
    const reserveRisk = reserveState === 'survival-risk' || reserveState === 'bust-risk';
    const goalLocked = reserveState === 'goal-locked';
    const progressiveScale = goalLocked && this.#jackpotThresholdScoreBps != null
      ? crapsProgressiveTrayScale({
          startingBankrollFlip: this.#resolutionRun?.startingBankrollFlip,
          goalFlip: goal,
          highPointFlip: this.#resolutionHighPoint(bankroll),
          thresholdScoreBps: this.#jackpotThresholdScoreBps,
          slotCount: chips.length,
        })
      : null;
    const bankedDescription = reserveRisk
      ? `${formatCrapsFlip(banked)} FLIP grey off the felt; a full loss forces ${reserveState === 'bust-risk' ? 'a bust' : 'the survival flip'}.`
      : `${formatCrapsFlip(banked)} FLIP committed off the felt; reserve chips are green.`;
    const rackDescription = battleAward
      ? `${formatCrapsFlip(bankroll)} FLIP Battle prize paid.`
      : progressiveScale
      ? `Goal locked. High point ${formatCrapsFlip(progressiveScale.highPointFlip)} FLIP, ${formatCrapsScoreMultiple(progressiveScale.scoreBps)} starting bankroll. Run It Up jackpot points are ${progressiveScale.commonMultiple} times for the jackpot and ${progressiveScale.rareMultiple} times for the rare jackpot.`
      : goalLocked
        ? `${formatCrapsFlip(bankroll)} FLIP blue; the off-felt reserve guarantees the goal.`
      : `${formatCrapsFlip(inPlay)} FLIP red on the felt. ${bankedDescription}`;
    if (amountNode) amountNode.textContent = formatCrapsFlip(bankroll);
    if (meter) {
      meter.setAttribute(
        'aria-valuemax',
        progressiveScale ? progressiveScale.rareScoreBps.toString() : capacity.toString(),
      );
      meter.setAttribute(
        'aria-valuenow',
        progressiveScale
          ? (progressiveScale.scoreBps > progressiveScale.rareScoreBps
              ? progressiveScale.rareScoreBps
              : progressiveScale.scoreBps).toString()
          : bankroll.toString(),
      );
      meter.setAttribute(
        'aria-valuetext',
        rackDescription,
      );
      meter.dataset.inPlayFlip = inPlay.toString();
      meter.dataset.bankedFlip = banked.toString();
      meter.dataset.reserveState = reserveState;
      meter.dataset.scale = progressiveScale ? 'progressive' : 'bankroll';
      if (progressiveScale) {
        meter.dataset.highPointFlip = progressiveScale.highPointFlip.toString();
        meter.dataset.highScoreBps = progressiveScale.scoreBps.toString();
      } else {
        delete meter.dataset.highPointFlip;
        delete meter.dataset.highScoreBps;
      }
      meter.classList?.toggle('is-goal-reached', goalLocked);
    }
    if (!this.#paintProgressiveTrayScale(progressiveScale, chips)) {
      this.#paintRackPips(chips, { filledCount: chipCount, bankedCount }, {
        reserveState,
      });
    }
  }

  #stopBattleBountyTimer() {
    if (this.#battleBountyTimer != null) globalThis.clearTimeout?.(this.#battleBountyTimer);
    this.#battleBountyTimer = null;
  }

  #resetBattleBountyReceipt() {
    this.#stopBattleBountyTimer();
    const receipt = this.querySelector('[data-bind="craps-battle-bounty-receipt"]');
    const rail = this.querySelector('[data-bind="craps-resolution"]');
    if (receipt) {
      receipt.hidden = true;
      receipt.setAttribute?.('hidden', '');
      receipt.dataset.state = 'hidden';
      receipt.removeAttribute?.('aria-label');
    }
    if (rail) rail.dataset.bountyWin = 'false';
    for (const chip of this.querySelectorAll('.craps-payout-flight img.is-bounty-award')) chip.remove?.();
  }

  #animateBattleBountyReceipt() {
    const payoutWei = this.#battlePayoutWei;
    if (!this.#battleWonByViewer || payoutWei == null || payoutWei <= 0n) return;
    this.#stopBattleBountyTimer();
    const receipt = this.querySelector('[data-bind="craps-battle-bounty-receipt"]');
    const amount = this.querySelector('[data-bind="craps-battle-bounty-amount"]');
    const boost = this.querySelector('[data-bind="craps-battle-boost-amount"]');
    const kind = this.querySelector('[data-bind="craps-battle-bounty-kind"]');
    const boostRow = this.querySelector('.craps-run-rail__bounty-boost');
    const rail = this.querySelector('[data-bind="craps-resolution"]');
    if (!receipt) return;
    const payoutFlip = payoutWei / CRAPS_FLIP_WEI;
    const boostWei = this.#battleBoostWei;
    const boostFlip = boostWei == null ? null : boostWei / CRAPS_FLIP_WEI;
    const winKind = this.#battleWinningStop === 0
      ? 'LAST STANDING · BOUNTY WON'
      : this.#battleWinningStop === 1
        ? 'GOAL WIN · BOUNTY WON'
        : 'BATTLE BOUNTY WON';
    if (kind) kind.textContent = winKind;
    if (amount) amount.textContent = formatCrapsCompactFlip(payoutFlip);
    if (boost) boost.textContent = boostFlip == null ? '—' : formatCrapsCompactFlip(boostFlip);
    if (boostRow) boostRow.hidden = boostFlip == null;
    receipt.hidden = false;
    receipt.removeAttribute?.('hidden');
    receipt.dataset.state = 'pending';
    receipt.setAttribute(
      'aria-label',
      `${winKind}. ${formatCrapsWei(payoutWei)} FLIP paid.${boostWei == null
        ? ''
        : ` ${formatCrapsWei(boostWei)} FLIP of that payout was boost.`}`,
    );
    if (rail) rail.dataset.bountyWin = 'true';

    const reveal = () => {
      receipt.dataset.state = 'revealed';
      for (const chip of this.querySelectorAll('.craps-payout-flight img.is-bounty-award')) chip.remove?.();
      const host = this.querySelector('[data-bind="craps-payout-flight"]');
      if (host && host.children?.length === 0) {
        delete host.dataset.active;
        delete host.dataset.flow;
      }
    };
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      reveal();
      return;
    }
    const host = this.querySelector('[data-bind="craps-payout-flight"]');
    const card = this.querySelector('[data-bind="craps-card"]');
    const source = this.querySelector('[data-bind="craps-bounty-marquee"]');
    const target = this.querySelector('[data-bind="craps-battle-bounty-stack"]');
    if (!host || !card || !source || !target
      || typeof card.getBoundingClientRect !== 'function') {
      reveal();
      return;
    }
    const cardRect = card.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect?.();
    const targetRect = target.getBoundingClientRect?.();
    if (!cardRect.width || !sourceRect?.width || !targetRect?.width) {
      reveal();
      return;
    }
    host.dataset.active = 'true';
    host.dataset.flow = 'bounty';
    for (let index = 0; index < 3; index += 1) {
      const chip = globalThis.document?.createElement?.('img');
      if (!chip) continue;
      const startX = sourceRect.left + sourceRect.width * (0.38 + index * 0.12) - cardRect.left;
      const startY = sourceRect.top + sourceRect.height * 0.62 - cardRect.top;
      const endX = targetRect.left + targetRect.width / 2 - cardRect.left;
      const endY = targetRect.top + targetRect.height / 2 - cardRect.top;
      const dx = endX - startX;
      const dy = endY - startY;
      chip.className = 'is-bounty-award';
      chip.src = CRAPS_CHIP_ART.gold;
      chip.alt = '';
      chip.draggable = false;
      chip.style.left = `${startX - 17}px`;
      chip.style.top = `${startY - 17}px`;
      chip.style.setProperty('--flight-mid-x', `${dx * 0.48 + (index - 1) * 12}px`);
      chip.style.setProperty('--flight-mid-y', `${dy * 0.4 - 34 - index * 5}px`);
      chip.style.setProperty('--flight-end-x', `${dx}px`);
      chip.style.setProperty('--flight-end-y', `${dy}px`);
      chip.style.setProperty('--flight-delay', `${this.#resolutionDelay(index * 65)}ms`);
      host.appendChild(chip);
    }
    this.#battleBountyTimer = globalThis.setTimeout?.(() => {
      this.#battleBountyTimer = null;
      reveal();
    }, this.#resolutionDelay(760)) ?? null;
  }

  #paintDiceBadge(node, face, colorIndex) {
    if (!node) return;
    const normalizedFace = clampInteger(face, 1, 6, 1);
    node.dataset.face = String(normalizedFace);
    node.src = dgnBadgePath(3, normalizedFace - 1, colorIndex);
  }

  #lockDicePair(node) {
    if (!node) return;
    node.classList?.remove('is-locking');
    void node.offsetWidth;
    node.classList?.add('is-locking');
  }

  #resetDiceLockReadout() {
    const readout = this.querySelector('[data-bind="craps-dice-lock-readout"]');
    if (!readout) return;
    readout.classList?.remove('is-popping');
    delete readout.dataset.sevenOutcome;
    readout.hidden = true;
    readout.setAttribute?.('hidden', '');
  }

  #popDiceLockReadout(frame, { comeOut = false } = {}) {
    const readout = this.querySelector('[data-bind="craps-dice-lock-readout"]');
    const total = this.querySelector('[data-bind="craps-dice-lock-number"]');
    if (!readout || !total) return;
    total.textContent = String(frame?.total ?? '—');
    const sevenOutcome = crapsSevenRollOutcome(frame, { comeOut });
    if (sevenOutcome) readout.dataset.sevenOutcome = sevenOutcome;
    else delete readout.dataset.sevenOutcome;
    readout.hidden = false;
    readout.removeAttribute?.('hidden');
    readout.classList?.remove('is-popping');
    void readout.offsetWidth;
    readout.classList?.add('is-popping');
  }

  #framePayoutBetIds(frame, { comeOut = false } = {}) {
    const explicit = normalizedPayoutBetIds(frame?.payoutBets ?? frame?.winningBets ?? frame?.payouts);
    // Sealed replay frames provide an authoritative list. In particular, an empty
    // list means a visually familiar number rolled after that line had already died.
    if (frame?.payoutBetsExact) return explicit;
    const inferred = [];
    const label = String(frame?.label ?? '').toLowerCase();
    const total = Number(frame?.total);
    if (comeOut) {
      // Number and hardway bets are off while a point is being established.
      // A resolver-provided winner list can describe the whole roll, so keep
      // only the two line decisions here instead of visually paying the new
      // point the instant it turns on.
      const lineWinners = explicit.filter((id) => id === 'pass' || id === 'dont-pass');
      if (total === 7 || total === 11) inferred.push('pass');
      else if (total === 2 || total === 3) inferred.push('dont-pass');
      return [...new Set([...lineWinners, ...inferred])];
    }
    if (label.includes('hard 4') || label.includes('hard four')) inferred.push('hard-4');
    if (label.includes('hard 8') || label.includes('hard eight')) inferred.push('hard-8');
    if ([4, 5, 6, 8, 9, 10].includes(total)) inferred.push(`place-${total}`);
    if (frame?.d1 === frame?.d2 && total === 4) inferred.unshift('hard-4');
    if (frame?.d1 === frame?.d2 && total === 8) inferred.unshift('hard-8');
    if (this.#isSevenOut(frame)) inferred.unshift('dont-pass');
    if (label.includes('odds')) inferred.push('pass-odds');
    if (/don['’]?t pass/.test(label)) inferred.push('dont-pass');
    else if (label.includes('pass') || label.includes('point')) inferred.push('pass');
    return [...new Set([...explicit, ...inferred])];
  }

  #payoutBetIds(frame, frameIndex, { comeOut = false } = {}) {
    const requested = this.#framePayoutBetIds(frame, { comeOut })
      .map((id) => id === 'pass-odds' ? 'pass' : id)
      .filter((id, index, values) => values.indexOf(id) === index && (this.#bets.get(id) ?? 0n) > 0n);
    return frame?.payoutBetsExact ? requested : requested.slice(0, 2);
  }

  #animatePayout(frame, frameIndex, { visualOnly = false, comeOut = false } = {}) {
    const delta = BigInt(frame?.deltaFlip ?? 0);
    if (delta <= 0n && !visualOnly) return 0;
    const host = this.querySelector('[data-bind="craps-payout-flight"]');
    const card = this.querySelector('[data-bind="craps-card"]');
    const rack = this.querySelector('[data-bind="craps-resolution-chips"]');
    const target = rack ?? this.querySelector('[data-bind="craps-resolution-meter"]');
    const betIds = this.#payoutBetIds(frame, frameIndex, { comeOut });
    if (!host || !card || !target || betIds.length === 0
      || typeof card.getBoundingClientRect !== 'function'
      || typeof target.getBoundingClientRect !== 'function') {
      return 0;
    }
    const cardRect = card.getBoundingClientRect();
    const fallbackTargetRect = target.getBoundingClientRect();
    const rackChips = rack ? [...rack.querySelectorAll('.craps-run-chip')] : [];
    if (!cardRect.width || !fallbackTargetRect.width) return 0;
    host.dataset.active = 'true';
    host.dataset.flow = 'all';
    const sources = betIds.map((id, sourceIndex) => {
      const spot = this.querySelector(`[data-bet="${id}"]`);
      if (!spot || typeof spot.getBoundingClientRect !== 'function') return null;
      const playerStack = [...spot.querySelectorAll?.('.craps-bet__seat-chip') ?? []]
        .find((candidate) => candidate.dataset.playerKey === 'local');
      const source = playerStack && !playerStack.hidden ? playerStack : spot;
      const sourceRect = source.getBoundingClientRect();
      if (!sourceRect.width) return null;
      spot.classList?.add('is-paying');
      return { sourceIndex, source, sourceRect };
    }).filter(Boolean);
    const coinsForSpot = betIds.length > 1 ? 3 : 4;
    const flightCount = sources.length * coinsForSpot;
    if (flightCount === 0) return 0;

    const endingBankroll = BigInt(frame.bankrollFlip);
    const startingBankroll = visualOnly ? endingBankroll : endingBankroll - delta;
    const boundaryAt = (bankroll) => {
      const layout = this.#resolutionTrayLayout(bankroll, {
        active: true,
        slotCount: rackChips.length,
      });
      const dividerIndex = Math.max(0, Math.min(rackChips.length, layout.bankedCount));
      const leftRect = rackChips[dividerIndex - 1]?.getBoundingClientRect?.();
      const rightRect = rackChips[dividerIndex]?.getBoundingClientRect?.();
      const referenceRect = rightRect?.width ? rightRect : leftRect?.width ? leftRect : fallbackTargetRect;
      const x = leftRect?.width && rightRect?.width
        ? (leftRect.right + rightRect.left) / 2
        : rightRect?.width ? rightRect.left : leftRect?.width ? leftRect.right : fallbackTargetRect.left + fallbackTargetRect.width / 2;
      return { x, y: referenceRect.top + referenceRect.height / 2 };
    };

    let flightIndex = 0;
    sources.forEach(({ sourceIndex, source, sourceRect }) => {
      for (let chipIndex = 0; chipIndex < coinsForSpot; chipIndex += 1) {
        const chip = globalThis.document?.createElement?.('img');
        if (!chip) continue;
        const impactBankroll = visualOnly
          ? endingBankroll
          : startingBankroll + ((delta * BigInt(flightIndex + 1)) / BigInt(flightCount));
        const impactTarget = boundaryAt(impactBankroll);
        const startX = sourceRect.left + sourceRect.width / 2 - cardRect.left + (chipIndex - 1.5) * 3;
        const startY = sourceRect.top + sourceRect.height / 2 - cardRect.top - chipIndex * 2;
        const endX = impactTarget.x - cardRect.left;
        const endY = impactTarget.y - cardRect.top;
        const dx = endX - startX;
        const dy = endY - startY;
        chip.src = CRAPS_CHIP_ART[source?.dataset?.face] ?? CRAPS_CHIP_ART.red;
        chip.alt = '';
        chip.draggable = false;
        chip.style.left = `${startX - 17}px`;
        chip.style.top = `${startY - 17}px`;
        chip.style.setProperty('--flight-mid-x', `${dx * 0.5 + (sourceIndex ? 14 : -14)}px`);
        chip.style.setProperty('--flight-mid-y', `${dy * 0.43 - 38 - chipIndex * 6}px`);
        chip.style.setProperty('--flight-end-x', `${dx}px`);
        chip.style.setProperty('--flight-end-y', `${dy}px`);
        chip.style.setProperty('--flight-delay', '0ms');
        host.appendChild(chip);
        flightIndex += 1;
      }
    });
    return this.#resolutionDelay(570);
  }

  #featuredPayoutBetIds(player, frame, frameIndex, { comeOut = false } = {}) {
    const owned = new Set(Array.isArray(player?.betIds) ? player.betIds : []);
    const hasExactTimeline = Array.isArray(player?.rollEvents) && player.rollEvents.length > 0;
    const exactEvent = hasExactTimeline ? player.rollEvents[frameIndex] : null;
    // A null aligned event means this seat was already out. It is authoritative
    // absence, not permission to infer a payout from the viewer's shared roll.
    const requested = (hasExactTimeline
      ? exactEvent ? normalizedPayoutBetIds(exactEvent.payoutBets) : []
      : this.#framePayoutBetIds(frame, { comeOut }))
      .filter((id) => owned.has(id))
      .filter((id, index, values) => values.indexOf(id) === index && this.querySelector(`[data-bet="${id}"]`));
    return hasExactTimeline ? requested : requested.slice(0, 2);
  }

  #animateFeaturedPayouts(frame, frameIndex, { comeOut = false } = {}) {
    const roundNumber = frameIndex + 1;
    const localBankroll = wholeFlip(frame?.bankrollFlip) ?? 0n;
    const standings = this.#battleStandings(roundNumber, localBankroll);
    const host = this.querySelector('[data-bind="craps-payout-flight"]');
    const card = this.querySelector('[data-bind="craps-card"]');
    if (!host || !card || typeof card.getBoundingClientRect !== 'function') {
      return 0;
    }
    const cardRect = card.getBoundingClientRect();
    if (!cardRect.width) return 0;

    const byKey = new Map(standings.map((entry) => [entry.key, entry]));
    const payouts = this.#featuredPlayerKeys.flatMap((key) => {
      const entry = byKey.get(key);
      if (!entry || entry.local) return [];
      const player = this.#tablePlayers[entry.opponentIndex];
      if (!player) return [];
      const targetRack = [...this.querySelectorAll('[data-battle-key]')]
        .find((candidate) => candidate.dataset.battleKey === entry.key);
      const targetWell = targetRack?.querySelector?.('.craps-battle-rack__well');
      const betIds = this.#featuredPayoutBetIds(player, frame, frameIndex, { comeOut });
      if (!targetRack || !targetWell || betIds.length === 0) return [];
      const targetChips = [...targetRack.querySelectorAll('.craps-battle-rack__chip')];
      const boundaryChip = targetChips.find((chip) => !chip.classList?.contains('is-filled')) ?? targetChips.at(-1);
      const targetRect = boundaryChip?.getBoundingClientRect?.() ?? targetWell.getBoundingClientRect();
      if (!targetRect?.width) return [];
      const sources = betIds.flatMap((id) => {
        const spot = this.querySelector(`[data-bet="${id}"]`);
        const source = [...spot?.querySelectorAll?.('.craps-bet__seat-chip') ?? []]
          .find((candidate) => candidate.dataset.playerKey === entry.key);
        if (!spot || !source || typeof source.getBoundingClientRect !== 'function') return [];
        const sourceRect = source.getBoundingClientRect();
        if (!sourceRect.width) return [];
        return [{ source, sourceRect }];
      });
      return sources.length > 0 ? [{ entry, targetRack, targetRect, sources }] : [];
    });
    if (payouts.length === 0) return 0;

    host.dataset.active = 'true';
    host.dataset.flow = 'all';
    let flightIndex = 0;
    payouts.forEach(({ targetRack, targetRect, sources }, playerIndex) => {
      targetRack.classList?.add('is-collecting');
      sources.forEach(({ source, sourceRect }, sourceIndex) => {
        source.classList?.add('is-paying-featured');
        const coinsForSource = sources.length === 1 ? 2 : 1;
        for (let chipIndex = 0; chipIndex < coinsForSource; chipIndex += 1) {
          const chip = globalThis.document?.createElement?.('img');
          if (!chip) continue;
          const startX = sourceRect.left + sourceRect.width / 2 - cardRect.left + (chipIndex - 0.5) * 3;
          const startY = sourceRect.top + sourceRect.height / 2 - cardRect.top - chipIndex * 2;
          const endX = targetRect.left + targetRect.width / 2 - cardRect.left;
          const endY = targetRect.top + targetRect.height / 2 - cardRect.top;
          const dx = endX - startX;
          const dy = endY - startY;
          chip.className = 'is-featured-payout';
          chip.src = CRAPS_CHIP_ART[source?.dataset?.face] ?? CRAPS_CHIP_ART.red;
          chip.alt = '';
          chip.draggable = false;
          chip.style.left = `${startX - 11}px`;
          chip.style.top = `${startY - 11}px`;
          chip.style.setProperty('--flight-mid-x', `${dx * 0.5 + (sourceIndex ? 9 : -9)}px`);
          chip.style.setProperty('--flight-mid-y', `${dy * 0.42 - 22 - chipIndex * 4 - playerIndex * 3}px`);
          chip.style.setProperty('--flight-end-x', `${dx}px`);
          chip.style.setProperty('--flight-end-y', `${dy}px`);
          chip.style.setProperty('--flight-delay', '0ms');
          host.appendChild(chip);
          flightIndex += 1;
        }
      });
    });
    if (flightIndex === 0) return 0;
    return this.#resolutionDelay(570);
  }

  #animateBankrollLoss(frame, { clearBoard = false } = {}) {
    const delta = BigInt(frame?.deltaFlip ?? 0);
    if (delta >= 0n && !clearBoard) return 0;
    const meter = this.querySelector('[data-bind="craps-resolution-meter"]');
    const chips = [...this.querySelectorAll('[data-bind="craps-resolution-chips"] .craps-run-chip')];
    const startingBankroll = wholeFlip(frame?.startingBankrollFlip) ?? 0n;
    const startingFill = this.#resolutionTrayFill(startingBankroll, chips.length).filledCount;
    const lossCount = delta < 0n && startingBankroll > 0n && startingFill > 0
      ? Math.max(1, Math.round(Number(
          ((-delta) * BigInt(startingFill) * 1_000n) / startingBankroll,
        ) / 1_000))
      : 0;
    // Once the off-felt reserve has locked the goal, every rack cell is a
    // visual receipt of that guaranteed finish. The felt still clears on a
    // seven-out, but blue receipt cells must never perform the loss exit.
    const inPlay = chips.filter((chip) => (
      chip.classList?.contains('is-in-play')
      && !chip.classList?.contains('is-goal-locked')
    ));
    const lost = inPlay.slice(-Math.min(lossCount, inPlay.length));
    const spots = clearBoard ? this.#sevenOutClearSpots() : [];
    const table = clearBoard ? this.querySelector('[data-bind="craps-table-rail"]') : null;
    if ((!meter || lost.length === 0) && spots.length === 0) return 0;
    sfxCrapsSettlement('sweep');
    const screen = this.querySelector('[data-bind="craps-resolution"]');
    if (screen) screen.dataset.direction = 'loss';
    if (meter && lost.length > 0) {
      meter.classList?.add('is-crapping-out');
      if (clearBoard) meter.classList?.add('is-seven-out');
      else meter.classList?.remove('is-seven-out');
      [...lost].reverse().forEach((chip, index) => {
        chip.style?.setProperty?.(
          '--loss-delay',
          `${this.#resolutionDelay(Math.min(index, 18) * (clearBoard ? 6 : 16))}ms`,
        );
        chip.classList?.add('is-lost');
      });
    }
    if (spots.length > 0) {
      if (table) table.dataset.board = 'clearing';
      spots.forEach((spot, index) => {
        spot.style?.setProperty?.(
          '--board-clear-delay',
          `${this.#resolutionDelay(index * (clearBoard ? 8 : 16))}ms`,
        );
        spot.classList?.remove('is-seven-cleared', 'is-seven-reloading');
        void spot.offsetWidth;
        spot.classList?.add('is-seven-clearing');
      });
    }
    const lossDuration = lost.length > 0
      ? (clearBoard ? 240 : 420) + Math.min(lost.length - 1, 18) * (clearBoard ? 6 : 16)
      : 0;
    const boardDuration = spots.length > 0
      ? (clearBoard ? 240 : 380) + Math.max(0, spots.length - 1) * (clearBoard ? 8 : 16)
      : 0;
    return this.#resolutionDelay(Math.max(lossDuration, boardDuration));
  }

  #localPayoutSoundChipCount(frame, frameIndex, payoutBetIds) {
    const deltaChips = crapsPayoutChipCount(frame?.deltaFlip, this.#playedFlip);
    const multiplier = this.#wagerMultiplierAtRound(frameIndex);
    const placedWinners = payoutBetIds.reduce(
      (sum, betId) => sum + (this.#bets.get(betId) ?? 0n),
      0n,
    );
    const grossFloor = placedWinners * multiplier;
    const boundedFloor = Number(grossFloor > 512n ? 512n : grossFloor);
    return Math.max(1, deltaChips, boundedFloor);
  }

  #featuredPayoutSoundChipCount(frameIndex) {
    const featured = new Set(this.#featuredPlayerKeys);
    const multiplier = Number(this.#wagerMultiplierAtRound(frameIndex));
    let chipCount = 0;
    for (const player of this.#tablePlayers) {
      if (!featured.has(player.key)) continue;
      const event = player.rollEvents?.[frameIndex];
      if (!event || event.payoutBets.length === 0) continue;
      const deltaChips = crapsPayoutChipCount(event.deltaFlip, this.#playedFlip);
      chipCount += Math.max(1, deltaChips, event.payoutBets.length * multiplier);
    }
    return Math.max(1, Math.min(512, chipCount));
  }

  #animateSettlementsTogether(frame, frameIndex, onDone, { comeOut = false } = {}) {
    const delta = BigInt(frame?.deltaFlip ?? 0);
    const clearBoard = this.#isSevenOut(frame);
    const localPayoutBetIds = this.#payoutBetIds(frame, frameIndex, { comeOut });
    const localHasPayout = localPayoutBetIds.length > 0;
    const localPayoutChips = localHasPayout
      ? this.#localPayoutSoundChipCount(frame, frameIndex, localPayoutBetIds)
      : 0;
    this.#clearPayoutFlight();
    const lossDuration = delta < 0n || clearBoard
      ? this.#animateBankrollLoss(frame, { clearBoard })
      : 0;
    const lostBetDuration = clearBoard
      ? 0
      : this.#animateLostBetCollection(frame, frameIndex, () => this.#holdLostBetCollection(frame));
    const payoutDuration = localHasPayout
      ? this.#animatePayout(frame, frameIndex, { visualOnly: delta <= 0n, comeOut })
      : 0;
    const localDuration = Math.max(lossDuration, lostBetDuration, payoutDuration);
    const featuredDuration = this.#animateFeaturedPayouts(frame, frameIndex, { comeOut });
    const duration = Math.max(
      this.#resolutionDelay(760),
      localDuration,
      featuredDuration,
    );
    let impactPainted = false;
    const paintImpact = () => {
      if (impactPainted || !this.#resolutionActive || this.#resolutionIndex !== frameIndex) return;
      impactPainted = true;
      const endingBankroll = this.#displayedViewerBankroll(frame?.bankrollFlip);
      this.#paintResolutionTray(endingBankroll, {
        active: frame?.viewerClosed !== true,
        inPlayFlip: frame?.viewerClosed === true
          ? 0n
          : clearBoard ? this.#boardInPlayFlip('dont-pass') : this.#boardInPlayFlip(),
      });
      if (featuredDuration > 0) {
        this.#paintBattleLeaderboard(frameIndex + 1, endingBankroll);
      }
    };
    let localClackPlayed = false;
    let opponentClackPlayed = false;
    const playLocalClack = () => {
      if (localClackPlayed || !localHasPayout || payoutDuration <= 0) return;
      localClackPlayed = true;
      sfxCrapsSettlement('collect', localPayoutChips);
    };
    const playOpponentClack = () => {
      if (opponentClackPlayed || featuredDuration <= 0) return;
      opponentClackPlayed = true;
      sfxCrapsSettlement('opponent', this.#featuredPayoutSoundChipCount(frameIndex));
    };
    const payoutHost = this.querySelector('[data-bind="craps-payout-flight"]');
    const firstLocalPayoutChip = payoutHost?.querySelector?.('img:not(.is-board-deal):not(.is-featured-payout)');
    const firstOpponentPayoutChip = payoutHost?.querySelector?.('img.is-featured-payout');
    const firstPayoutChip = payoutHost?.querySelector?.('img:not(.is-board-deal)');
    firstLocalPayoutChip?.addEventListener?.('animationend', playLocalClack, { once: true });
    firstOpponentPayoutChip?.addEventListener?.('animationend', playOpponentClack, { once: true });
    firstPayoutChip?.addEventListener?.('animationend', paintImpact, { once: true });
    const finish = () => {
      if (payoutDuration > 0 || featuredDuration > 0) paintImpact();
      playLocalClack();
      playOpponentClack();
      if (!clearBoard) this.#holdLostBetCollection(frame);
      this.#clearPayoutFlight();
      this.#clearBankrollLoss();
      if (!this.#resolutionActive || this.#resolutionIndex !== frameIndex) return;
      if (clearBoard) this.#holdBoardCleared();
      onDone?.({ boardCleared: clearBoard });
    };
    if (duration <= 0) { finish(); return; }
    this.#resolutionTimer = globalThis.setTimeout?.(() => {
      this.#resolutionTimer = null;
      finish();
    }, duration) ?? null;
  }

  #spinResolutionDice(frame, index, onDone) {
    const bay = this.querySelector('[data-bind="craps-dice-bay"]');
    const table = this.querySelector('[data-bind="craps-table-rail"]');
    const totalNode = this.querySelector('[data-bind="craps-roll-total"]');
    const dicePair = this.querySelector('.craps-dice-bay__dice');
    const dice = [
      this.querySelector('[data-bind="craps-die-one"]'),
      this.querySelector('[data-bind="craps-die-two"]'),
    ];
    const targets = [Number(frame.d1), Number(frame.d2)];
    const colors = CRAPS_DICE_BADGE_COLORS;
    const comeOut = table?.dataset?.board === 'come-out';
    const shooterNumber = (wholeNumber(frame?.shooter) ?? this.#runShooterIndexAtRound(index)) + 1;
    const lockAt = 7;
    let step = 0;
    const priorBankroll = BigInt(
      frame.startingBankrollFlip
        ?? (index > 0
          ? this.#resolutionRun.frames[index - 1].bankrollFlip
          : this.#resolutionRun.startingBankrollFlip),
    );
    this.#resetSurvivalStage();
    // A come-out reload has only the Pass Line on the felt, so every other
    // committed chip remains red until this shooter establishes a point.
    const displayedPriorBankroll = this.#displayedViewerBankroll(priorBankroll);
    this.#paintResolutionTray(displayedPriorBankroll, {
      active: frame?.viewerClosed !== true,
      inPlayFlip: frame?.viewerClosed === true ? 0n : this.#boardInPlayFlip(),
    });
    dicePair?.classList?.remove('is-locking');
    this.#resetDiceLockReadout();
    if (totalNode) totalNode.textContent = '—';
    if (this.#viewerBustLocked) this.#paintViewerBustOutcome();
    else {
      this.#setRollBoard({
        event: '—',
        state: 'spinning',
      });
    }
    if (bay) {
      bay.dataset.state = 'spinning';
      bay.dataset.result = 'push';
      bay.setAttribute('aria-label', `Shooter ${shooterNumber} dice are rolling.`);
    }

    const tick = () => {
      if (!this.#resolutionActive || this.#resolutionIndex !== index) return;
      if (step >= lockAt) {
        dice.forEach((die, dieIndex) => this.#paintDiceBadge(die, targets[dieIndex], colors[dieIndex]));
        if (totalNode) totalNode.textContent = String(frame.total);
        this.#lockDicePair(dicePair);
        this.#popDiceLockReadout(frame, { comeOut });
        sfxCrapsDiceLand({
          total: frame.total,
          sevenOutcome: crapsSevenRollOutcome(frame, { comeOut }),
        });
        this.#resolutionTimer = globalThis.setTimeout?.(() => {
          this.#resolutionTimer = null;
          if (this.#resolutionActive && this.#resolutionIndex === index) onDone?.();
        }, this.#resolutionDelay(300)) ?? null;
        return;
      }
      dice.forEach((die, dieIndex) => {
        this.#paintDiceBadge(die, 1 + Math.floor(Math.random() * 6), colors[dieIndex]);
      });
      if (step % 2 === 0) {
        sfxCrapsDiceTick(step, frame.globalRoll ?? frame.ordinal ?? index);
      }
      step += 1;
      const delay = this.#resolutionDelay(72 + Math.floor(step * 9));
      this.#resolutionTimer = globalThis.setTimeout?.(tick, delay) ?? null;
    };
    tick();
  }

  #paintResolutionResult(frame, index, { comeOut = false } = {}) {
    const rawBankroll = BigInt(frame.bankrollFlip);
    const delta = BigInt(frame.deltaFlip);
    const pendingFailedSurvival = frame?.viewerClosed !== true
      && frame?.viewerTerminal === 'bust'
      && frame?.survival?.survived === false;
    if (frame?.viewerTerminal === 'bust' && !pendingFailedSurvival) {
      this.#viewerBustLocked = true;
    }
    const bankroll = this.#displayedViewerBankroll(rawBankroll);
    const direction = this.#viewerBustLocked
      ? 'loss'
      : delta > 0n ? 'win' : delta < 0n ? 'loss' : 'push';
    const screen = this.querySelector('[data-bind="craps-resolution"]');
    const bay = this.querySelector('[data-bind="craps-dice-bay"]');
    const dieOne = this.querySelector('[data-bind="craps-die-one"]');
    const dieTwo = this.querySelector('[data-bind="craps-die-two"]');
    const totalNode = this.querySelector('[data-bind="craps-roll-total"]');
    const shooterNumber = (wholeNumber(frame?.shooter) ?? this.#runShooterIndexAtRound(index)) + 1;
    if (screen) screen.dataset.direction = direction;
    if (bay) {
      bay.dataset.state = 'resolved';
      bay.dataset.result = direction;
      bay.setAttribute('aria-label', `Shooter ${shooterNumber} rolled ${frame.d1} and ${frame.d2}, total ${frame.total}. ${frame.label}.`);
    }
    this.#paintDiceBadge(dieOne, frame.d1, CRAPS_DICE_BADGE_COLORS[0]);
    this.#paintDiceBadge(dieTwo, frame.d2, CRAPS_DICE_BADGE_COLORS[1]);
    if (totalNode) totalNode.textContent = String(frame.total);
    const pointEnded = /seven|bankroll empty/i.test(frame.label) || Boolean(frame.terminal);
    const establishedPoint = comeOut && CRAPS_POINT_NUMBERS.includes(Number(frame.total))
      ? Number(frame.total)
      : null;
    this.#setPoint(comeOut ? establishedPoint : pointEnded ? null : frame.point);
    if (this.#viewerBustLocked) this.#paintViewerBustOutcome();
    else {
      this.#setRollBoard({
        event: frame.label,
        result: formatSignedCrapsFlip(delta),
        state: direction,
      });
    }
    this.#paintJackpotTray(index + 1);
    return { bankroll, delta };
  }

  #paintResolutionFrame(frame, index, { nextBoardIsLive = null, comeOut = false } = {}) {
    const { bankroll } = this.#paintResolutionResult(frame, index, { comeOut });
    const nextShooter = this.#isSevenOut(frame)
      && !frame.terminal
      && index < this.#resolutionRun.frames.length - 1;
    const standingsCheckpoint = crapsLeaderboardCheckpoint(frame);
    const boardCleared = this.querySelector('[data-bind="craps-table-rail"]')?.dataset?.board === 'empty';
    if (this.#isSevenOut(frame) && !boardCleared) {
      // Keep the just-resolved shooter's physical stacks on their old multiple
      // until the seven-out clear completes. The cleared/redeal beat installs
      // both the next seating order and the next three-shooter escalator band.
      this.#paintBattleLeaderboard(index + 1);
    } else {
      this.#paintOpponentRacks(index + 1, null, false, standingsCheckpoint || nextShooter);
    }
    const boardCanContinue = !frame.terminal
      && index < this.#resolutionRun.frames.length - 1
      && bankroll >= BigInt(this.#wager().perHandFlip) * this.#wagerMultiplier;
    const rackActive = frame?.viewerClosed !== true
      && (nextBoardIsLive == null ? boardCanContinue : Boolean(nextBoardIsLive));
    this.#paintResolutionTray(bankroll, {
      active: rackActive,
      inPlayFlip: rackActive ? this.#boardInPlayFlip() : null,
    });
  }

  #restoreResolutionPerspective(resumeResolutionIndex) {
    const frames = this.#resolutionRun?.frames ?? [];
    if (frames.length === 0) return -1;
    const index = clampInteger(resumeResolutionIndex, 0, frames.length - 1, 0);
    const frame = frames[index];
    this.#resolutionIndex = index;

    // A viewpoint change happens only between resolved rolls, so every
    // personal terminal at or before this frame is safe to restore directly.
    this.#viewerBustLocked = frames
      .slice(0, index + 1)
      .some((candidate) => candidate?.viewerTerminal === 'bust');

    this.#resetBoardBetState();
    const currentShooter = wholeNumber(frame?.shooter) ?? this.#runShooterIndexAtRound(index);
    const shooterFrames = frames.slice(0, index + 1).filter((candidate) => (
      (wholeNumber(candidate?.shooter) ?? currentShooter) === currentShooter
    ));
    for (const candidate of shooterFrames) this.#holdLostBetCollection(candidate);

    // `point` is the post-roll point. Null means the next shared roll is a
    // come-out roll (new shooter, point made, or another natural/crap).
    const hasNextRoll = index < frames.length - 1;
    if (hasNextRoll && frame?.point == null && !frame?.terminal) {
      this.#holdComeOutBoard({ resetLines: this.#isSevenOut(frame) });
    }

    this.#syncWagerMultiplier(index + 1);
    this.#paintResolutionFrame(frame, index);
    // A seven-out's ordinary paint path deliberately waits for its animation
    // before reseating. A perspective switch has no transition to wait for.
    this.#paintOpponentRacks(index + 1, null, false, true);
    return index;
  }

  #startResolution({ resumeResolutionIndex = null } = {}) {
    if (!this.#resolutionRun || this.#resolutionRun.frames.length === 0) return;
    this.#stopResolutionTimer();
    this.#resetBattleBountyReceipt();
    this.#viewerBustLocked = false;
    this.#viewerBustRank = null;
    this.#featuredPlayerKeys = [];
    this.#feltOpponentKeys = [];
    this.#leaderboardPlayerKeys = [];
    this.#leaderboardRanksByKey = new Map();
    this.#leaderboardViewerRank = null;
    this.#resolutionActive = true;
    this.#resolutionIndex = -1;
    this.#awaitingRoll = false;
    this.#survivalFlipActive = false;
    this.#opponentCoinFlips.clear();
    this.#resetBoardBetState();
    this.#holdComeOutBoard();
    this.#syncWagerMultiplier(0);
    this.#setResolutionVisible(true);
    const screen = this.querySelector('[data-bind="craps-resolution"]');
    const bay = this.querySelector('[data-bind="craps-dice-bay"]');
    const dieOne = this.querySelector('[data-bind="craps-die-one"]');
    const dieTwo = this.querySelector('[data-bind="craps-die-two"]');
    const totalNode = this.querySelector('[data-bind="craps-roll-total"]');
    const skip = this.querySelector('[data-bind="craps-resolution-skip"]');
    const replay = this.querySelector('[data-bind="craps-resolution-replay"]');
    const done = this.querySelector('[data-bind="craps-resolution-done"]');
    const bonus = this.querySelector('[data-bind="craps-resolution-bonus"]');
    if (screen) {
      screen.dataset.phase = 'running';
      screen.dataset.direction = 'push';
    }
    if (bay) {
      bay.dataset.state = 'ready';
      bay.dataset.result = 'push';
      bay.setAttribute('aria-label', 'The shared table bankroll run is starting.');
    }
    this.#paintDiceBadge(dieOne, 2, CRAPS_DICE_BADGE_COLORS[0]);
    this.#paintDiceBadge(dieTwo, 5, CRAPS_DICE_BADGE_COLORS[1]);
    if (totalNode) totalNode.textContent = '—';
    this.#resetSurvivalStage();
    this.#resetShooterBoostAnnouncement({ clearTable: true });
    this.#setPoint(null);
    this.#setRollBoard({
      event: this.#autoRoll ? 'RUN READY' : 'PRESS ROLL',
      result: '—',
      state: 'ready',
    });
    this.#paintOpponentRacks(0, null, false, true);
    if (skip) skip.hidden = false;
    if (replay) replay.hidden = true;
    if (done) done.hidden = true;
    if (bonus) { bonus.hidden = true; bonus.textContent = ''; }
    this.#paintResolutionTray(BigInt(this.#resolutionRun.startingBankrollFlip), {
      active: true,
      inPlayFlip: this.#boardInPlayFlip(),
    });
    this.#paintJackpotTray(0);
    if (resumeResolutionIndex != null) {
      const resumedAt = this.#restoreResolutionPerspective(resumeResolutionIndex);
      if (resumedAt >= this.#resolutionRun.frames.length - 1) {
        this.#completeResolution();
        return;
      }
      this.#queueNextResolutionRoll(180);
      return;
    }
    const reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    if (reducedMotion) {
      this.#finishResolution(true);
      return;
    }
    this.#queueNextResolutionRoll(520);
    try {
      (this.#autoRoll ? skip : this.querySelector('[data-bind="craps-resolution-roll"]'))?.focus?.({ preventScroll: true });
    } catch (_error) { /* optional */ }
  }

  #advanceResolution() {
    this.#stopResolutionTimer();
    this.#awaitingRoll = false;
    this.#syncRollControls();
    const nextIndex = this.#resolutionIndex + 1;
    const frame = this.#resolutionRun?.frames[nextIndex];
    if (!frame) { this.#finishResolution(false); return; }
    this.#resolutionIndex = nextIndex;
    const spin = () => this.#spinResolutionDice(frame, nextIndex, () => {
      const bay = this.querySelector('[data-bind="craps-dice-bay"]');
      const table = this.querySelector('[data-bind="craps-table-rail"]');
      const comeOut = table?.dataset?.board === 'come-out';
      if (bay) bay.dataset.state = 'resolved';
      this.#paintResolutionResult(frame, nextIndex, { comeOut });
      const finishFrame = ({ boardCleared = false } = {}) => {
        const last = nextIndex === this.#resolutionRun.frames.length - 1;
        const sevenOut = this.#isSevenOut(frame);
        const bankroll = BigInt(frame.bankrollFlip);
        const nextStake = BigInt(this.#wager().perHandFlip)
          * this.#wagerMultiplierAtRound(nextIndex + 1);
        const affordability = crapsNextShooterAffordability({
          bankrollFlip: bankroll,
          nextStakeFlip: nextStake,
          goalFlip: this.#goal,
        });
        const survivalResult = frame.survival?.survived;
        const spectating = frame.viewerClosed === true;
        const canReload = sevenOut
          && !last
          && !frame.terminal
          && (spectating || affordability === 'play');
        const dontPassRemainsLive = sevenOut && !last && !frame.terminal;
        const pointMade = !comeOut
          && frame.point == null
          && /\bpoint\s+\d+\s+made\b/i.test(String(frame.label ?? ''));
        this.#paintResolutionFrame(frame, nextIndex, {
          nextBoardIsLive: sevenOut ? dontPassRemainsLive : null,
          comeOut,
        });
        const continueRun = () => {
          if (last) {
            this.#resolutionTimer = globalThis.setTimeout?.(() => {
              this.#resolutionTimer = null;
              this.#finishResolution(false);
            }, this.#resolutionDelay(720)) ?? null;
          } else this.#queueNextResolutionRoll(80);
        };
        if (!sevenOut) {
          if (pointMade) {
            // Place and hardway chips stay visible but muted while they are OFF
            // between points. Exact line deaths remain held for this shooter;
            // only a seven-out/new shooter recommits the board.
            this.#holdComeOutBoard({ resetLines: false });
            this.#paintResolutionTray(bankroll, {
              active: true,
              inPlayFlip: this.#boardInPlayFlip(),
            });
          }
          continueRun();
          return;
        }
        const afterBoardClear = () => {
          if (!spectating && affordability === 'survival' && typeof survivalResult === 'boolean') {
            this.#startSurvivalFlip({
              bankrollFlip: bankroll,
              nextStakeFlip: nextStake,
              survived: survivalResult,
              frameIndex: nextIndex,
            }, (postFlipBankroll) => {
              if (!survivalResult || last) { continueRun(); return; }
              this.#animateBoardReload(frame, nextIndex, continueRun, {
                phase: 'come-out',
                bankrollFlip: postFlipBankroll,
                resetRetirements: true,
              });
            });
            return;
          }
          const proceed = () => {
            if (canReload) {
              this.#animateBoardReload(frame, nextIndex, continueRun, {
                phase: 'come-out',
                resetRetirements: true,
              });
            } else continueRun();
          };
          this.#startOpponentOnlySurvivalFlips(
            this.#opponentSurvivalFlipsAt(this.#endedShooterAtFrame(nextIndex)),
            proceed,
          );
        };
        if (boardCleared) afterBoardClear();
        else this.#animateSevenOutClear(nextIndex, afterBoardClear);
      };
      const animateSettlement = () => {
        this.#animateSettlementsTogether(frame, nextIndex, finishFrame, { comeOut });
      };
      if (comeOut && CRAPS_POINT_NUMBERS.includes(Number(frame.total))) {
        this.#animateBoardReload(frame, nextIndex, animateSettlement, { phase: 'point' });
      } else animateSettlement();
    });
    const previousFrame = nextIndex > 0 ? this.#resolutionRun.frames[nextIndex - 1] : null;
    const startsNewShooter = nextIndex === 0
      || this.#isSevenOut(previousFrame)
      || Boolean(previousFrame?.terminal);
    const prepareSpin = () => {
      // Once YOU close out, the table still deals the tracked leaders from
      // their own racks. Your frozen receipt never leaks back onto the felt.
      const boardState = this.querySelector('[data-bind="craps-table-rail"]')?.dataset?.board;
      if (frame.viewerClosed === true) {
        this.#paintOpponentRacks(nextIndex + 1, null, false, startsNewShooter);
      }
      if (frame.viewerClosed === true
        && this.#isSevenOut(previousFrame)
        && boardState !== 'come-out') {
        this.#animateBoardReload(frame, nextIndex, spin, {
          phase: 'come-out',
          bankrollFlip: frame.startingBankrollFlip,
          resetRetirements: true,
        });
      } else spin();
    };
    if (startsNewShooter) this.#announceShooterBoost(nextIndex, prepareSpin);
    else prepareSpin();
  }

  #finishResolution(skipped = false) {
    if (!this.#resolutionRun || this.#resolutionRun.frames.length === 0) return;
    if (this.#survivalFlipActive && !skipped) return;
    this.#stopResolutionTimer();
    this.#resetShooterBoostAnnouncement();
    this.#clearOpponentCoinFlips();
    this.#awaitingRoll = false;
    const lastIndex = this.#resolutionRun.frames.length - 1;
    const last = this.#resolutionRun.frames[lastIndex];
    if (skipped || this.#resolutionIndex < lastIndex) {
      this.#resolutionIndex = lastIndex;
      this.#paintResolutionFrame(last, lastIndex);
    }
    if (skipped) {
      this.#resetBoardBetState();
      if (this.#isSevenOut(last)) this.#holdBoardCleared();
      this.#survivalFlipActive = false;
    }
    this.#completeResolution();
  }

  #resolutionOutcome() {
    const last = this.#resolutionRun.frames.at(-1);
    let bonusFlip = 0n;
    try {
      bonusFlip = this.#preview?.bonusFlip != null
        ? (wholeFlip(this.#preview.bonusFlip) ?? 0n)
        : BigInt(this.#preview?.bonusFlipWei ?? 0) / CRAPS_FLIP_WEI;
    } catch (_error) { bonusFlip = 0n; }
    const runBankroll = BigInt(last.bankrollFlip);
    const busted = last.terminal === 'bust' || last.survival?.survived === false;
    const finalTray = busted
      ? 0n
      : last.survival?.survived === true ? runBankroll * 2n : runBankroll;
    return { bonusFlip, runBankroll, finalTray, last, busted };
  }

  #startSurvivalFlip({ bankrollFlip, nextStakeFlip, survived, frameIndex }, onDone) {
    const runBankroll = BigInt(bankrollFlip);
    const nextStake = BigInt(nextStakeFlip);
    const postFlipBankroll = survived ? runBankroll * 2n : 0n;
    const currentFrame = this.#resolutionRun?.frames[frameIndex];
    const nextShooterNumber = (wholeNumber(currentFrame?.shooter)
      ?? this.#runShooterIndexAtRound(frameIndex)) + 2;
    const reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    if (typeof survived !== 'boolean') {
      onDone?.(runBankroll);
      return;
    }
    if (reducedMotion) {
      if (!survived) {
        this.#viewerBustLocked = true;
        this.#paintViewerBustOutcome();
      }
      this.#paintResolutionTray(postFlipBankroll, { active: false });
      onDone?.(postFlipBankroll);
      return;
    }
    this.#survivalFlipActive = true;
    this.#awaitingRoll = false;
    // Featured rivals in the same survival range flip beside their portraits on
    // the shared cadence, landing together with the player's coin.
    this.#beginOpponentCoinFlips(
      this.#opponentSurvivalFlipsAt(this.#endedShooterAtFrame(frameIndex)),
      'paired',
    );
    const screen = this.querySelector('[data-bind="craps-resolution"]');
    const bay = this.querySelector('[data-bind="craps-dice-bay"]');
    const stage = this.querySelector('[data-bind="craps-survival-stage"]');
    const coin = this.querySelector('[data-bind="craps-survival-coin"]');
    const landed = this.querySelector('[data-bind="craps-survival-landed"]');
    if (screen) screen.dataset.phase = 'coinflip';
    this.#paintResolutionTray(runBankroll, { active: true, allInPlay: true });
    if (bay) {
      bay.dataset.state = 'coinflip';
      bay.dataset.result = 'push';
      bay.setAttribute('aria-label', `Player survival coin before shooter ${nextShooterNumber}. ${formatCrapsFlip(runBankroll)} FLIP must double to cover ${formatCrapsFlip(nextStake)} FLIP.`);
    }
    this.#setPoint(null);
    if (stage) { stage.hidden = false; stage.removeAttribute?.('hidden'); }
    if (landed) { landed.hidden = true; landed.setAttribute?.('hidden', ''); }
    if (coin) {
      coin.hidden = false;
      coin.removeAttribute?.('hidden');
      coin.classList?.remove('is-flipping', 'is-win', 'is-bust');
      void coin.offsetWidth;
      coin.classList?.add('is-flipping', survived ? 'is-win' : 'is-bust');
    }
    this.#setRollBoard({
      event: 'SURVIVAL FLIP',
      result: `${formatCrapsCompactFlip(runBankroll)} / ${formatCrapsCompactFlip(nextStake)} NEEDED`,
      state: 'coinflip',
    });
    this.#paintOpponentRacks(frameIndex + 1);
    this.#syncRollControls();
    sfxCoinflipStart();
    this.#resolutionTimer = globalThis.setTimeout?.(() => {
      this.#resolutionTimer = null;
      if (!this.#resolutionActive || !this.#survivalFlipActive) return;
      this.#showSurvivalLanding(survived);
      sfxCoinflipLand(survived);
      if (survived) sfxCrapsDouble({ at: 0.14 });
      else this.#viewerBustLocked = true;
      this.#landOpponentCoinFlips();
      if (bay) bay.dataset.state = 'coin-landed';
      this.#paintResolutionTray(postFlipBankroll, { active: false });
      if (survived) {
        this.#setRollBoard({
          event: 'SURVIVED · 2×',
          result: `${formatCrapsCompactFlip(postFlipBankroll)} BANKROLL`,
          state: 'win',
        });
      } else this.#paintViewerBustOutcome();
      this.#resolutionTimer = globalThis.setTimeout?.(() => {
        this.#resolutionTimer = null;
        if (!this.#resolutionActive || !this.#survivalFlipActive) return;
        this.#survivalFlipActive = false;
        if (screen) screen.dataset.phase = 'running';
        this.#resetSurvivalStage();
        this.#clearOpponentCoinFlips();
        // Repaint the next roll's head-to-head rival and top-ten order after
        // every survival verdict has popped.
        this.#paintOpponentRacks(frameIndex + 1, null, false, true);
        this.#syncRollControls();
        onDone?.(postFlipBankroll);
      }, this.#resolutionDelay(680)) ?? null;
    }, this.#resolutionDelay(4_000)) ?? null;
  }

  #endedShooterAtFrame(frameIndex) {
    const frame = this.#resolutionRun?.frames[frameIndex];
    return wholeNumber(frame?.shooter) ?? this.#runShooterIndexAtRound(frameIndex);
  }

  #opponentSurvivalFlipsAt(shooter) {
    if (!Number.isInteger(shooter) || shooter < 0) return [];
    const featured = new Set(this.#featuredPlayerKeys);
    return this.#tablePlayers
      .filter((player) => featured.has(player.key))
      .map((player) => ({ key: player.key, survived: player.survivals?.[shooter]?.survived }))
      .filter((flip) => typeof flip.survived === 'boolean');
  }

  #beginOpponentCoinFlips(flips, cadence) {
    this.#opponentCoinFlips.clear();
    for (const flip of flips) {
      this.#opponentCoinFlips.set(flip.key, { survived: flip.survived, phase: 'flipping', cadence });
    }
  }

  #landOpponentCoinFlips() {
    if (this.#opponentCoinFlips.size === 0) return;
    for (const [key, flip] of this.#opponentCoinFlips) {
      this.#opponentCoinFlips.set(key, { ...flip, phase: 'landed' });
    }
    for (const coin of this.querySelectorAll?.('.craps-battle-rack__coin') ?? []) {
      coin.dataset.phase = 'landed';
    }
  }

  #clearOpponentCoinFlips() {
    if (this.#opponentCoinFlips.size === 0) return;
    this.#opponentCoinFlips.clear();
    for (const coin of this.querySelectorAll?.('.craps-battle-rack__coin') ?? []) coin.remove?.();
  }

  /**
   * Between-shooter beat for boundaries where only tracked rivals hit the
   * survival range: their coins flip beside their portraits while the player's
   * own board simply reloads.
   */
  #startOpponentOnlySurvivalFlips(flips, onDone) {
    const reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    if (reducedMotion || flips.length === 0) { onDone?.(); return; }
    this.#beginOpponentCoinFlips(flips, 'solo');
    this.#paintBattleLeaderboard(this.#resolutionIndex + 1);
    sfxCoinflipWhoosh(0.35);
    this.#resolutionTimer = globalThis.setTimeout?.(() => {
      this.#resolutionTimer = null;
      if (!this.#resolutionActive) return;
      this.#landOpponentCoinFlips();
      this.#resolutionTimer = globalThis.setTimeout?.(() => {
        this.#resolutionTimer = null;
        if (!this.#resolutionActive) return;
        this.#clearOpponentCoinFlips();
        // The deferred seating change from #holdBoardCleared.
        this.#paintOpponentRacks(this.#resolutionIndex + 1, null, false, true);
        onDone?.();
      }, this.#resolutionDelay(720)) ?? null;
    }, this.#resolutionDelay(1_300)) ?? null;
  }

  #completeResolution() {
    if (!this.#resolutionRun || this.#resolutionRun.frames.length === 0) return;
    this.#stopResolutionTimer();
    this.#survivalFlipActive = false;
    this.#clearOpponentCoinFlips();
    this.#resetShooterBoostAnnouncement({ clearTable: true });
    this.#awaitingRoll = false;
    const { bonusFlip, finalTray, last, busted } = this.#resolutionOutcome();
    if (busted) this.#viewerBustLocked = true;
    const battleWon = this.#battleWonByViewer === true;
    const battleAwardFlip = battleWon && this.#battlePayoutWei != null && this.#battlePayoutWei > 0n
      ? (this.#battlePayoutWei + CRAPS_FLIP_WEI - 1n) / CRAPS_FLIP_WEI
      : null;
    this.#paintResolutionTray(battleAwardFlip ?? finalTray, {
      active: false,
      battleAward: battleAwardFlip != null,
    });
    this.#paintJackpotTray(this.#resolutionRun.frames.length);
    const screen = this.querySelector('[data-bind="craps-resolution"]');
    const skip = this.querySelector('[data-bind="craps-resolution-skip"]');
    const replay = this.querySelector('[data-bind="craps-resolution-replay"]');
    const done = this.querySelector('[data-bind="craps-resolution-done"]');
    const bonus = this.querySelector('[data-bind="craps-resolution-bonus"]');
    const bay = this.querySelector('[data-bind="craps-dice-bay"]');
    const finalSummary = crapsFinalResolutionSummary({
      terminal: last.terminal,
      finalTray,
      battleWonByViewer: battleWon,
      battlePayoutWei: this.#battlePayoutWei,
    });
    if (screen) screen.dataset.phase = 'complete';
    if (bonus) {
      bonus.hidden = bonusFlip === 0n;
      bonus.textContent = bonusFlip > 0n ? `BONUS FLIP +${formatCrapsCompactFlip(bonusFlip)} FLIP` : '';
    }
    this.#resetSurvivalStage();
    if (bay) {
      bay.dataset.state = 'rolled';
      bay.dataset.result = finalSummary.bayResult;
      bay.setAttribute('aria-label', finalSummary.ariaLabel);
    }
    this.#setRollBoard(finalSummary);
    this.#setPoint(null);
    this.#paintOpponentRacks(this.#resolutionRun.frames.length);
    if (skip) skip.hidden = true;
    if (replay) replay.hidden = false;
    if (done) done.hidden = false;
    this.#resolutionCompleted = true;
    this.#resolutionActive = false;
    if (battleWon) sfxFanfare(true);
    else if (last.terminal === 'goal') sfxFanfare(false);
    else if (last.terminal === 'bust') sfxNoWin();
    this.#animateBattleBountyReceipt();
    this.#syncRollControls();
    this.querySelector('.craps-table-felt')?.setAttribute?.('aria-busy', 'false');
    try { replay?.focus?.({ preventScroll: true }); } catch (_error) { /* optional */ }
  }

  #close() {
    if (!this.#isOpen || this.#busy) return;
    this.#acknowledgeResolution();
    this.#stopResolutionTimer();
    this.#stopBattleBountyTimer();
    this.#resolutionActive = false;
    this.#awaitingRoll = false;
    this.#survivalFlipActive = false;
    this.#clearOpponentCoinFlips();
    this.#resetShooterBoostAnnouncement({ clearTable: true });
    this.#resetBoardBetState();
    const dialog = this.querySelector('[data-bind="craps-dialog"]');
    if (dialog) { dialog.hidden = true; dialog.setAttribute?.('hidden', ''); }
    this.#isOpen = false;
    this.#confirm = null;
    this.#settle = null;
    this.#onResolutionAcknowledged = null;
    this.#onPerspectiveSelect = null;
    this.#pendingPerspectiveBetId = null;
    unlock();
    try { this.#returnFocus?.focus?.({ preventScroll: true }); } catch (_error) { /* optional */ }
    this.#returnFocus = null;
  }

  #acknowledgeResolution() {
    if (!canAcknowledgeCrapsResolution({
      completed: this.#resolutionCompleted,
      acknowledged: this.#resolutionAcknowledged,
      onAcknowledged: this.#onResolutionAcknowledged,
    })) return;
    const screen = this.querySelector('[data-bind="craps-resolution"]');
    const finalRewardsPainted = screen?.dataset?.phase === 'complete' || this.#resolutionCompleted;
    if (!finalRewardsPainted) return;
    this.#resolutionAcknowledged = true;
    try {
      this.#onResolutionAcknowledged({
        tableIndex: this.#tableIndex,
        battleSlot: this.#battleSlot,
        viewerBetId: this.#viewerBetId,
      });
    } catch (_error) { /* presentation retirement cannot trap the dialog open */ }
  }

  #trapFocus(event) {
    const card = this.querySelector('[data-bind="craps-card"]');
    if (!card) return;
    const focusable = [...card.querySelectorAll('button:not([disabled]), input:not([disabled])')]
      .filter((node) => !node.hidden && !node.closest?.('[hidden]'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = globalThis.document?.activeElement;
    if (event.shiftKey && active === first) { event.preventDefault?.(); last.focus?.(); }
    else if (!event.shiftKey && active === last) { event.preventDefault?.(); first.focus?.(); }
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-craps-table')) customElements.define('app-craps-table', AppCrapsTable);
}

export { AppCrapsTable };
