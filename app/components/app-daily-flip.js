// /app/components/app-daily-flip.js — the daily coinflip widget (user ask).
//
// Lives INSIDE the jackpot hero as its right column (user call: the coinflip
// is part of the jackpot widget, not a sibling panel). The coin uses one
// physical flipping surface with two synchronized artworks
// (shared/coinflip-face-red.svg = WWXRP/Purge side,
// shared/coinflip-face-eth.svg = green ETH side, both derived from the
// user's coinflip-coin.svg):
//
//   - unrevealed: the coin spins continuously (rotateX loop, end over end); the REVEAL
//     FLIP button (or tapping the coin) writes `flip_day_${CHAIN.id}_${day}`
//     (the SAME key the balances strip's fuzz gate reads) and plays one of four
//     deterministic, day-wide motion tracks followed by the day's ending — then
//     dispatches document 'flip:revealed';
//   - revealed: the static landed face + outcome copy.
//
// Data: /game/coinflip/day/:day (global outcome; one flip per day protocol-
// wide) + /player/:addr dashboard coinflip.{depositedAmount, claimablePreview}
// and top-level flipBalance.
//
// Actions (all Phase 58 sendTx chokepoint paths):
//   FLIP — depositCoinflipWithCarry(player, amount) stake (FLIP wei, UNSCALED),
//          with rolling-deploy fallback to depositCoinflip.
// Ticket redemption belongs to the purchase panel, so this side only owns the
// coinflip stake, its winnings claim, and the post-result Reverse Flip card.
// (CLAIM DGNRS removed — user call: no DGNRS claim in the coinflip column.)
// ETH and FLIP cashouts share one Protocol Coins popup; LINK funding remains
// focused, and none of these actions is routed through Pending.
//
// T-58-18: server-derived strings via textContent.

import { CHAIN, VOLUME_WINDOW } from '../app/chain-config.js';
import { displayEth, displayToken } from '../app/scaling.js';
import {
  flipPileLevel,
  flipPileVariant,
  flipWagerPreview,
} from '../app/flip-piles.js';
import {
  get,
  update,
  subscribe,
  getActingAddress,
  getViewedAddress,
} from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { readGameState } from '../app/game-state.js';
import {
  depositCoinflip,
  MAX_AUTO_REBUY_TAKE_PROFIT_WEI,
  readBafFlipEve,
  readUpcomingFlipBonus,
  readResolvedFlipBonus,
  readCoinflipDisplaySnapshot,
  protocolFlipTotalWei,
  readLatestCoinflipResult,
  readResolvedCoinflipStake,
  readReverseFlipQuote,
  reverseFlip,
  reverseFlipCostWei,
  setCoinflipAutoRebuy,
  setCoinflipAutoRebuyTakeProfit,
} from '../app/coinflip.js';
import { openPlayerFundsDialog } from '../app/player-funds.js';
import {
  burnSdgnrs,
  formatSdgnrsRedemptionAmount,
  MIN_SDGNRS_BURN_WEI,
  previewSdgnrsBurn,
  SDGNRS_REDEMPTION_SUBMITTED_EVENT,
} from '../app/sdgnrs.js';
import { readCharityVoteState, voteForCharity } from '../app/charity-vote.js';
import { compactUiError } from '../app/ui-error.js';
import { TX_CONFIRMED_EVENT } from '../app/contracts.js';
import { updateBalanceDisplay, resetBalanceDisplay } from '../app/balance-countup.js';
import { heldBalanceValue } from '../app/balance-hold.js';
import { appendCoinFaces } from '../app/coin-faces.js';
import { activeBafScoreLevel } from '../app/jackpot-resolutions.js';
import { setMajorDrawActivity } from '../app/major-draw-activity.js';
import {
  candidateRecordPayoutWei,
  candidateClaimsRecord,
  RECORD_KIND_FLIP,
} from '../app/records.js';
import { coinflipBoonBoostDelta } from '../app/boons.js';
import { questCompletionBonusModel } from '../app/quest-objectives.js';
import {
  warmup as warmupCoinflipSfx,
  sfxCoinflipLand,
  sfxCoinflipStart,
  sfxCoinflipTurn,
  sfxCoinflipWhoosh,
  sfxReverseBonk,
} from '../app/jackpot-sfx.js';
import {
  pendingSourceHasPublished,
  subscribePendingActions,
} from '../app/pending-actions.js';
import {
  LOOTBOX_REVEAL_ABORT_EVENT,
  LOOTBOX_REVEAL_COMPLETE_EVENT,
  LOOTBOX_REVEAL_QUEUED_EVENT,
} from './reveal-overlay.js';
import { registerComponentPoll } from '../app/component-poll.js';
import './boon-product-indicator.js';
import './quest-objective-indicator.js';

// Four equally-common reveal profiles, with the requested conditional win
// rates. The protocol result remains authoritative; the UI chooses a profile
// *after* resolution with complementary win/loss weights. Given the protocol's
// fair 50/50 result:
//
//   P(profile | win)  = winRate / 200
//   P(profile | loss) = (100 - winRate) / 200
//
// Therefore every profile appears 25% of the time and P(win | profile) is
// exactly its declared 60/55/45/40% in expectation. Selection uses only the
// global day and global outcome, never a player/address or browser RNG, so
// everybody receives the same reveal on the same day.
const FLIP_REVEAL_PROFILES = Object.freeze([
  Object.freeze({ id: 'comet', winRate: 60 }),
  Object.freeze({ id: 'ricochet', winRate: 55 }),
  Object.freeze({ id: 'orbit', winRate: 45 }),
  Object.freeze({ id: 'pulse', winRate: 40 }),
]);
const REVEAL_PROFILE_WEIGHT_TOTAL = 200;
const REVEAL_TRACK_MS = 3300;
const REVEAL_END_MS = 700;
const FLIP_FINISH_CUE_MS = 250;
const REVEAL_FAKE_END_MS = 1600;
const REVEAL_DOUBLE_END_MS = 2500;
const REVEAL_TRIPLE_END_MS = 3400;
const REVERSE_CARD_STAGGER_MS = 900;
const REVERSE_CARD_ENTRY_WAIT_MS = 100;
const REVEAL_BIASED_EXTENSION_MS = 650;
const REVEAL_BIASED_END_MS = REVEAL_END_MS + REVEAL_BIASED_EXTENSION_MS;
const REVERSE_CARD_ANIMATION_MS = 600;
// Five previously ordinary buckets become the sudden-stop easter egg. The
// axial speed never eases; the coin simply freezes on one of five complete
// presentations of the authoritative face.
const HARD_STOP_BUCKET_MIN = 4;
const HARD_STOP_BUCKET_MAX = 8;
const HARD_STOP_FIRST_OCCURRENCE = 4;
const HARD_STOP_OCCURRENCE_COUNT = 5;
const HARD_STOP_HALF_TURN_MS = 260;
// The final multiplier deserves a readable roulette sweep after the coin has
// landed. Fakeout thermometers stay inside their fixed Reverse-card beat.
const METER_SETTLE_MS = 1_600;
const METER_FAKEOUT_SETTLE_MS = 850;
const METER_FLASH_MS = 850;
const METER_DRAIN_MS = 350;
const METER_RECOVERY_TAIL_MS = 250;
const METER_REBOUND_MS = REVERSE_CARD_STAGGER_MS + METER_RECOVERY_TAIL_MS;
const METER_TERMINAL_DRAIN_MS = REVERSE_CARD_STAGGER_MS - METER_RECOVERY_TAIL_MS;
const LOSS_VERDICT_DELAY_MS = 300;
const BAF_TRANSFER_DURATION_MS = 820;
const LIVE_REVERSE_TAP_MS = 320;
const LIVE_REVERSE_FLIP_HALF_MS = 260;
const LIVE_REVERSE_RETURN_MS = 320;
const LIVE_REVERSE_TOTAL_MS = LIVE_REVERSE_TAP_MS
  + LIVE_REVERSE_FLIP_HALF_MS
  + LIVE_REVERSE_RETURN_MS;
// Keep the actionable Reverse card off the result surface until the complete
// coin choreography has landed and the player has had a clean beat to read it.
// This is deliberately shorter than RESULT_TRUTH_WINDOW_MS: the card may
// explain/queue the next reversal after three seconds, while live parity still
// cannot replace the authoritative result face for the full truth window.
const REVERSE_CARD_POST_REVEAL_DELAY_MS = 3_000;
// Once the reveal choreography reaches its authoritative landing, leave that
// face untouched long enough to read it. Reverse Flip may continue to change
// the live side after this window, but it cannot overwrite the just-shown
// result while the player is taking it in.
const RESULT_TRUTH_WINDOW_MS = 15_000;
// The range is a proportional convenience control; the adjacent number field
// remains the exact 18-decimal source of truth. One thousand stops gives the
// slider useful precision without converting a token balance through Number.
const SDGNRS_BURN_SLIDER_STEPS = 1_000n;
const ADD_BET_SLIDER_FINE_STEP = 100n;
const ADD_BET_SLIDER_COARSE_STEP = 1_000n;
const COINFLIP_REUSE_BONUS_BPS = 75n;
const BPS_DENOMINATOR = 10_000n;
const MODIFIER_MIN_PERCENT = 50;
const MODIFIER_MAX_PERCENT = 156;
const MODIFIER_TABLE_MIN_TOTAL_PERCENT = 150;
const MODIFIER_TABLE_MAX_TOTAL_PERCENT = 250;

function _rollTwoSummaryCount(rows) {
  if (!Array.isArray(rows)) return null;
  let total = 0;
  for (const row of rows) {
    const count = Number(row?.winnerCount);
    if (!Number.isInteger(count) || count < 0) return null;
    total += count;
  }
  return total;
}

function _rollTwoExpectedFlipRows(summary) {
  const rollTwo = summary?.rollTwo;
  if (!rollTwo || typeof rollTwo !== 'object') return null;

  // `coin` and `bonusDraw` describe the same trait-keyed FLIP winners. The
  // latter is the four-slot presentation view, so it is only a compatibility
  // fallback for payloads predating `coin`; adding both would double-count.
  const traitRows = Array.isArray(rollTwo.coin) ? rollTwo.coin : rollTwo.bonusDraw;
  const traitCount = _rollTwoSummaryCount(traitRows);
  const farFutureCount = Number(rollTwo.farFuture?.winnerCount);
  if (traitCount == null
    || !Number.isInteger(farFutureCount)
    || farFutureCount < 0) return null;
  return traitCount + farFutureCount;
}

function _isBonusSpinFlipWin(row) {
  const awardType = String(row?.awardType || '').toLowerCase();
  return awardType === 'farfuturecoin'
    || awardType.includes('flip')
    || String(row?.currency || '').toUpperCase() === 'FLIP';
}

/**
 * Exact Roll-2 FLIP credited to one player's next coinflip stake, while that
 * bonus board is still covered. `null` means the composed API fragments do
 * not yet agree, so callers must retain their last presentation-safe value.
 */
export function unrevealedBonusSpinFlipWei({
  payload,
  player,
  day,
  revealed = false,
} = {}) {
  if (revealed) return 0n;
  const targetDay = Number(day);
  const target = String(player || '').toLowerCase();
  if (!Number.isInteger(targetDay) || targetDay <= 0 || !target) return null;
  if (Number(payload?.day) !== targetDay || Number(payload?.roll2?.day) !== targetDay) {
    return null;
  }

  const wins = payload?.roll2?.wins;
  if (!Array.isArray(wins)) return null;
  const flipWins = wins.filter(_isBonusSpinFlipWin);
  const expectedFlipRows = _rollTwoExpectedFlipRows(payload?.summary);

  // An empty Roll-2 array is the composer's placeholder for a 404. Accept it
  // only when the independently composed summary proves this was a zero-FLIP
  // draw. When rows are present the exact endpoint itself is authoritative;
  // if a summary is also present, require the two fragments to agree.
  if (wins.length === 0 && expectedFlipRows == null) return null;
  if (expectedFlipRows != null && flipWins.length !== expectedFlipRows) return null;

  let total = 0n;
  for (const row of flipWins) {
    if (String(row?.winner || '').toLowerCase() !== target) continue;
    let amount;
    try { amount = BigInt(row?.amount ?? 0); }
    catch (_error) { return null; }
    if (amount < 0n) return null;
    total += amount;
  }
  return total;
}

/** Color only the multiplier number at the requested payout boundaries. */
export function dailyFlipMultiplierTone(totalPercent) {
  const value = Math.max(0, Math.trunc(Number(totalPercent) || 0));
  if (value <= 150) return 'low';
  if (value >= 250) return 'high';
  return null;
}

/** Keep the printed table selector on its 150–250 scale; exact bonuses stay in the popup. */
export function dailyFlipMeterPosition(totalPercent) {
  const value = Number(totalPercent);
  const bounded = Math.max(
    MODIFIER_TABLE_MIN_TOTAL_PERCENT,
    Math.min(MODIFIER_TABLE_MAX_TOTAL_PERCENT, Number.isFinite(value) ? value : 0),
  );
  return ((bounded - MODIFIER_TABLE_MIN_TOTAL_PERCENT)
    / (MODIFIER_TABLE_MAX_TOTAL_PERCENT - MODIFIER_TABLE_MIN_TOTAL_PERCENT)) * 100;
}

/** Snap a parked result to a whole lamp in the shared twenty-five-pip bank. */
export function dailyFlipMeterStopHeight(totalPercent) {
  const position = dailyFlipMeterPosition(totalPercent);
  if (position <= 0) return '0%';
  if (position >= 100) return '100%';
  const litPips = Math.max(1, Math.min(24, Math.round((position * 25) / 100)));
  // Twenty-five equal grid rows have twenty-four one-pixel gaps. Account for
  // the gaps so the animated clipping window parks exactly between two pips.
  const gapCorrection = ((25 - litPips) / 25).toFixed(2);
  return `calc(${litPips * 4}% - ${gapCorrection}px)`;
}

const FLIP_WEI_UNIT = 10n ** 18n;
const PROTOCOL_DAY_SECONDS = 86_400;

/**
 * Every table chip is the same FLIP badge: piles only have to FEEL like the
 * amount. The curve deliberately starts slowly, then opens up across the
 * common 1K–50K band: a starter bet is one neat stack, while a serious bet
 * spreads into several taller stacks before 100K hands off to mound art.
 */
export function coinflipBetChipCount(stakeWei) {
  let flip;
  try { flip = Number(BigInt(stakeWei ?? 0) / FLIP_WEI_UNIT); }
  catch (_error) { return 0; }
  if (flip <= 0) return 0;
  const decades = Math.max(0, Math.log10(flip / 100));
  const commonRangeCurve = 1
    + ((4 * decades) / 3)
    + ((5 * decades * decades) / 3);
  return Math.max(1, Math.min(24, Math.round(commonRangeCurve)));
}

/** Even table piles of at most seven chips, inside a stack budget. */
function _chipPiles(total, maxStacks) {
  if (!(total > 0)) return [];
  const stacks = Math.max(1, Math.min(maxStacks, Math.ceil(total / 7)));
  const base = Math.floor(total / stacks);
  return Array.from({ length: stacks }, (_, index) => (
    base + (index < total % stacks ? 1 : 0)
  ));
}

/** Split a wager's chips into table piles: at most seven chips per stack. */
export function coinflipBetChipPiles(stakeWei) {
  return _chipPiles(coinflipBetChipCount(stakeWei), 4);
}

/**
 * The payout is counted in the WAGER'S OWN chips, not on the log curve: the
 * dealer pushes back a multiple of what the player put down, so a 50% day
 * pays half the stake's stacks and a 150% day pays half again more than all
 * of them. Counting the winnings logarithmically prints nearly the same pile
 * for both, which reads as "you got your bet back" on every result.
 */
export function coinflipWinChipCount(stakeWei, totalWei) {
  let stake;
  let total;
  try {
    stake = BigInt(stakeWei ?? 0);
    total = BigInt(totalWei ?? 0);
  } catch (_error) { return 0; }
  if (stake <= 0n || total <= stake) return 0;
  const staked = coinflipBetChipCount(stake);
  if (staked === 0) return 0;
  // The contract pays 150%-256% of the stake, so this rides in [0.5, 1.56].
  // The clamp only guards against a malformed feed, never a real result.
  const paid = Math.min(4, Number(((total - stake) * 1_000n) / stake) / 1_000);
  return Math.max(1, Math.round(staked * paid));
}

/**
 * Payout piles. The budget is five stacks because the wager owns at most
 * three and the spot's chip lane holds eight of them at full table scale.
 */
export function coinflipWinChipPiles(stakeWei, totalWei) {
  return _chipPiles(coinflipWinChipCount(stakeWei, totalWei), 5);
}

// Cumulative growth frames baked into every pile-N-add.svg sprite, as shares
// of the base pile. MUST match WIN_FRACTIONS in shared/flip-chips/build-piles.py.
const WIN_PILE_FRACTIONS = [0.5, 1.0, 1.56];

/**
 * Which sprite frame a pile-scale win grows into. The three frames are the
 * payout classes the contract actually rolls — the unlucky 150% day, the
 * normal band, and the lucky 250% — so a whale's mound grows by what the day
 * paid instead of by a fixed amount.
 */
export function coinflipWinPileFrame(stakeWei, totalWei) {
  let stake;
  let total;
  try {
    stake = BigInt(stakeWei ?? 0);
    total = BigInt(totalWei ?? 0);
  } catch (_error) { return 0; }
  if (stake <= 0n || total <= stake) return 0;
  const paid = Number(((total - stake) * 1_000n) / stake) / 1_000;
  let frame = 0;
  // Nearest frame: the boundaries sit halfway between the baked fractions.
  while (frame < WIN_PILE_FRACTIONS.length - 1
    && paid >= (WIN_PILE_FRACTIONS[frame] + WIN_PILE_FRACTIONS[frame + 1]) / 2) {
    frame += 1;
  }
  return frame;
}

/**
 * How a wager physically presents on the felt: neat piles up to a point, a
 * mound once the bet gets heavy, and a massive disheveled pile for
 * seven-figure wagers.
 */
export function coinflipBetPresentation(stakeWei) {
  return flipPileLevel(stakeWei);
}

/** Bankroll magnitude as a bounded logarithmic count of physical chips. */
export function coinflipRackChipCount(balanceWei, capacity = 96) {
  let balance;
  try { balance = BigInt(balanceWei ?? 0); }
  catch (_error) { return 0; }
  if (balance <= 0n) return 0;
  const room = Math.max(1, Math.trunc(Number(capacity) || 96));
  const wholeFlipPlusOne = (balance / FLIP_WEI_UNIT) + 1n;
  const digits = wholeFlipPlusOne.toString();
  const prefixLength = Math.min(15, digits.length);
  const prefix = Number(digits.slice(0, prefixLength));
  const logarithm = Math.log10(prefix) + (digits.length - prefixLength);
  const fraction = Math.min(0.92, logarithm / 7);
  return Math.max(1, Math.round(room * fraction));
}

/** Claim-tray amount: one physical chip for every whole-FLIP doubling. */
export function coinflipClaimTrayAmountChipCount(balanceWei, capacity = 96) {
  let balance;
  try { balance = BigInt(balanceWei ?? 0); }
  catch (_error) { return 0; }
  if (balance <= 0n) return 0;
  const room = Math.max(1, Math.trunc(Number(capacity) || 96));
  const wholeFlip = balance / FLIP_WEI_UNIT;
  if (wholeFlip < 1n) return 1;
  return Math.min(room, wholeFlip.toString(2).length);
}

/** Split the fixed twenty-chip composition row using BigInt-only ratio math. */
export function coinflipClaimTrayRatioChipCounts(claimableWei, liquidWei) {
  const nonnegative = (value) => {
    try {
      const parsed = BigInt(value ?? 0);
      return parsed > 0n ? parsed : 0n;
    } catch (_error) {
      return 0n;
    }
  };
  const claimable = nonnegative(claimableWei);
  const liquid = nonnegative(liquidWei);
  const total = claimable + liquid;
  if (total === 0n) return { claimable: 0, liquid: 0 };
  if (claimable === 0n) return { claimable: 0, liquid: 20 };
  if (liquid === 0n) return { claimable: 20, liquid: 0 };
  const rounded = Number(((claimable * 20n) + (total / 2n)) / total);
  const claimableChips = Math.max(1, Math.min(19, rounded));
  return { claimable: claimableChips, liquid: 20 - claimableChips };
}

/** Print the FLIP unit only while the number stays short; long figures own
 *  the space and the table context makes the unit obvious. */
export function coinflipAmountLabel(weiValue) {
  const text = formatTomorrowBet(weiValue);
  return text.length > 7 ? text : `${text} FLIP`;
}

/** The practical reveal hour: round the 22:57 UTC boundary up for VRF settling. */
export function coinflipDailyJackpotLabel(nowMs = Date.now(), {
  anchorSeconds = VOLUME_WINDOW?.anchor,
  locale,
  timeZone,
} = {}) {
  const dayMs = PROTOCOL_DAY_SECONDS * 1_000;
  const numericNow = Number(nowMs);
  const safeNow = Number.isFinite(numericNow) ? numericNow : Date.now();
  const numericAnchor = Math.floor(Number(anchorSeconds) || 0);
  const dailyAnchor = ((numericAnchor % PROTOCOL_DAY_SECONDS) + PROTOCOL_DAY_SECONDS)
    % PROTOCOL_DAY_SECONDS;
  const utcDayStart = Math.floor(safeNow / dayMs) * dayMs;
  let nextBoundary = utcDayStart + (dailyAnchor * 1_000);
  if (nextBoundary <= safeNow) nextBoundary += dayMs;
  const hourMs = 60 * 60 * 1_000;
  const displayBoundary = Math.ceil(nextBoundary / hourMs) * hourMs;

  const options = { hour: 'numeric' };
  if (timeZone) options.timeZone = timeZone;
  let localTime;
  try {
    localTime = new Intl.DateTimeFormat(locale, options).format(new Date(displayBoundary));
  } catch (_error) {
    localTime = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
    }).format(new Date(displayBoundary));
  }
  return `DAILY AT ${localTime.replace(/\s+/gu, ' ').toUpperCase()}`;
}

const ERROR_AUTO_CLEAR_MS = 10_000;
const POLL_INTERVAL_MS = 15_000;
const RESULT_PENDING_POLL_MS = 2_000;
const EXACT_RESULT_TIMEOUT_MS = 8_000;
const REFRESH_TASK_TIMEOUT_MS = 12_000;
const REWARD_BOX_SOURCES = Object.freeze(['lootboxes', 'sdgnrs-redemptions']);
const REVERSE_FLIP_HELP = Object.freeze([
  'Reverses the outcome of the next flip.',
  'Alters all jackpot outcomes unpredictably.',
]);

/** Stable 32-bit day mixer. Math.imul + bitwise ops are identical in browsers. */
function _revealDayHash(day, salt) {
  const numericDay = Number(day);
  let x = ((Number.isFinite(numericDay) ? Math.trunc(numericDay) : 0) ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Stable ten-percent easter-egg gate: one result per day, never per render. */
function shouldFlashAllInDoIt(day) {
  return _revealDayHash(day, 0xd0170001) % 10 === 0;
}

/**
 * Losses deliberately carry no payout modifier on-chain. A fake apparent win
 * still needs a believable thermometer stop, though: clamping that zero to
 * the rail floor made multi-Reverse reveals appear frozen at 0. Keep this
 * presentation-only value day-wide and comfortably away from either edge.
 */
function fakeoutModifierPercent(day) {
  const lower = 72;
  const upper = 138;
  return lower + (_revealDayHash(day, 0xfa6e0ff1) % (upper - lower + 1));
}

/**
 * Public pure helper for tests/replays. `realReversalCount`, when supplied,
 * is the request-time Reverse queue frozen by the day-roll coordinator. It is
 * a hard ceiling: presentation can choose fewer cards for variety, but can
 * never invent more reversals than the protocol actually consumed that day.
 * The original one-card fakeout keeps
 * its 10% day-wide chance (5% in each direction under a fair result). Three
 * disjoint hash buckets add exact 2% double- and 1% triple-reversal chances.
 * Every reversal toggles the visible face; even sequences therefore begin on
 * the authoritative face and odd sequences begin opposite it, so the final
 * face always remains the protocol result.
 */
function selectFlipRevealPlan(day, won, realReversalCount = null) {
  const isWin = Boolean(won);
  const bucket = _revealDayHash(day, 0x51ed270b) % REVEAL_PROFILE_WEIGHT_TOTAL;
  let cursor = 0;
  let profile = FLIP_REVEAL_PROFILES.at(-1);
  for (const candidate of FLIP_REVEAL_PROFILES) {
    cursor += isWin ? candidate.winRate : 100 - candidate.winRate;
    if (bucket < cursor) {
      profile = candidate;
      break;
    }
  }

  // The last decimal digit preserves every existing one-card fakeout day.
  // Buckets 1, 2, and 3 were previously ordinary days, making the additions
  // disjoint and exactly 1% / 2% across the stable 100-bucket mixer.
  const reversalBucket = _revealDayHash(day, 0xa341316c) % 100;
  const hardStop = reversalBucket >= HARD_STOP_BUCKET_MIN
    && reversalBucket <= HARD_STOP_BUCKET_MAX;
  const plannedReversalCount = reversalBucket === 1
    ? 3
    : (reversalBucket === 2 || reversalBucket === 3)
      ? 2
      : reversalBucket % 10 === 0
        ? 1
        : 0;
  let reversalCap = null;
  if (realReversalCount != null) {
    try {
      const raw = BigInt(realReversalCount);
      reversalCap = raw <= 0n ? 0 : Number(raw > 3n ? 3n : raw);
    } catch (_e) { /* historical replays without a count keep the stable plan */ }
  }
  const reversalCount = reversalCap == null
    ? plannedReversalCount
    : Math.min(plannedReversalCount, reversalCap);
  const fakeOut = reversalCount > 0;
  const openingWon = reversalCount % 2 === 0 ? isWin : !isWin;
  const prefersWin = profile.winRate > 50;
  const hardStopOccurrence = hardStop
    ? HARD_STOP_FIRST_OCCURRENCE
      + (_revealDayHash(day, isWin ? 0x57dd0a11 : 0x57dd0a12)
        % HARD_STOP_OCCURRENCE_COUNT)
    : null;
  // Red is the front face at 0deg; ETH is the back face at 180deg. Therefore
  // the nth complete ETH presentation lands on an odd half-turn, while the
  // nth post-launch WWXRP presentation lands on an even half-turn.
  const hardStopHalfTurns = hardStop
    ? (isWin ? (hardStopOccurrence * 2) - 1 : hardStopOccurrence * 2)
    : null;
  const hardStopRotationDeg = hardStopHalfTurns == null ? null : hardStopHalfTurns * 180;
  const hardStopMs = hardStopHalfTurns == null
    ? null
    : hardStopHalfTurns * HARD_STOP_HALF_TURN_MS;
  const openingMs = hardStop
    ? 0
    : openingWon === prefersWin ? REVEAL_BIASED_END_MS : REVEAL_END_MS;
  let ending;
  if (reversalCount === 0) {
    ending = isWin ? 'win' : 'loss';
  } else if (reversalCount === 1) {
    ending = isWin ? 'loss-to-win' : 'win-to-loss';
  } else if (reversalCount === 2) {
    ending = isWin ? 'double-to-win' : 'double-to-loss';
  } else {
    ending = isWin ? 'triple-to-win' : 'triple-to-loss';
  }
  const endingMs = hardStop ? 0 : openingMs + (reversalCount * REVERSE_CARD_STAGGER_MS);
  const trackMs = hardStop ? hardStopMs : REVEAL_TRACK_MS;

  return Object.freeze({
    profile: profile.id,
    winRate: profile.winRate,
    ending,
    fakeOut,
    hardStop,
    hardStopOccurrence,
    hardStopHalfTurns,
    hardStopRotationDeg,
    reversalCount,
    bias: prefersWin ? 'win-heavy' : 'loss-heavy',
    openingWon,
    openingMs,
    trackMs,
    endingMs,
    totalMs: trackMs + endingMs,
  });
}

function reverseCardDelayMs(revealPlan, index) {
  return revealPlan.trackMs
    + revealPlan.openingMs
    + REVERSE_CARD_ENTRY_WAIT_MS
    + ((index - 1) * REVERSE_CARD_STAGGER_MS);
}

function _settleWithin(promise, ms) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Refresh timed out')), ms);
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (_) { /* defensive */ }
    }
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

/** Compact large sDGNRS readouts to two significant figures so narrow rails never clip. */
export function formatSdgnrsBalance(weiValue) {
  let raw;
  try { raw = BigInt(weiValue ?? 0); }
  catch (_e) { return '0'; }
  if (raw <= 0n) return '0';
  const unit = 10n ** 18n;
  if (raw < 1_000n * unit) return (raw / unit).toLocaleString('en-US');
  return formatSdgnrsRedemptionAmount(raw);
}

/** Coinflip amount display rounded to at most four significant whole-FLIP digits. */
export function formatTomorrowBet(weiValue, significantDigits = 4) {
  let raw;
  try { raw = BigInt(weiValue ?? 0); }
  catch (_e) { return '0'; }
  const unit = 10n ** 18n;
  const negative = raw < 0n;
  let whole = (negative ? -raw : raw) / unit;
  const digits = Math.max(1, Math.trunc(Number(significantDigits) || 4));
  const length = String(whole).length;
  if (length > digits) {
    const quantum = 10n ** BigInt(length - digits);
    whole = ((whole + (quantum / 2n)) / quantum) * quantum;
  }
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}`;
}

/** Keep the corner BAF instrument exact until millions, then use a short suffix. */
export function formatBafScore(weiValue) {
  let raw;
  try { raw = BigInt(weiValue ?? 0); }
  catch (_e) { return '0'; }

  const unit = 10n ** 18n;
  const negative = raw < 0n;
  const whole = (negative ? -raw : raw) / unit;
  if (whole < 1_000_000n) {
    return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}`;
  }

  const tiers = [
    [1_000_000_000_000_000n, 'Q'],
    [1_000_000_000_000n, 'T'],
    [1_000_000_000n, 'B'],
    [1_000_000n, 'M'],
  ];
  let tierIndex = tiers.findIndex(([scale]) => whole >= scale);
  if (tierIndex < 0) tierIndex = tiers.length - 1;

  for (;;) {
    const [scale, suffix] = tiers[tierIndex];
    const leading = whole / scale;
    const decimals = leading >= 100n ? 0 : leading >= 10n ? 1 : 2;
    const factor = 10n ** BigInt(decimals);
    const rounded = ((whole * factor) + (scale / 2n)) / scale;
    if (rounded >= 1_000n * factor && tierIndex > 0) {
      tierIndex -= 1;
      continue;
    }
    const integer = rounded / factor;
    const fraction = String(rounded % factor).padStart(decimals, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}${suffix}`;
  }
}

const COINFLIP_RECENT_WINDOW = 25;
const COINFLIP_RECENT_BUFFER = COINFLIP_RECENT_WINDOW + 1;

export function normalizeProtocolCoinflipStats(payload, recentLimit = COINFLIP_RECENT_WINDOW) {
  const whole = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
  };
  const recent = (Array.isArray(payload?.recent) ? payload.recent : [])
    .map((row) => {
      const rewardPercent = Number(row?.rewardPercent);
      return {
        day: whole(row?.day),
        win: row?.win === true,
        ...(row?.rewardPercent != null && Number.isFinite(rewardPercent) && rewardPercent >= 0
          ? { rewardPercent: Math.trunc(rewardPercent) }
          : {}),
      };
    })
    .filter((row) => row.day > 0)
    .sort((a, b) => b.day - a.day)
    .slice(0, Math.max(COINFLIP_RECENT_WINDOW, Math.trunc(Number(recentLimit) || 0)));
  return {
    wins: whole(payload?.wins),
    losses: whole(payload?.losses),
    recent,
  };
}

const COINFLIP_STATS_FALLBACK_BATCH = 6;
const protocolCoinflipOutcomes = new WeakMap();

function protocolOutcomeCache(fetcher) {
  let outcomes = protocolCoinflipOutcomes.get(fetcher);
  if (!outcomes) {
    outcomes = new Map();
    protocolCoinflipOutcomes.set(fetcher, outcomes);
  }
  return outcomes;
}

function protocolCoinflipOutcome(day, result) {
  if (typeof result?.win !== 'boolean') return null;
  const reportedDay = Number(result?.day);
  if (result?.day != null
    && (!Number.isFinite(reportedDay) || Math.trunc(reportedDay) !== day)) return null;
  const rewardPercent = Number(result?.rewardPercent);
  return {
    day,
    win: result.win,
    ...(result?.rewardPercent != null && Number.isFinite(rewardPercent) && rewardPercent >= 0
      ? { rewardPercent: Math.trunc(rewardPercent) }
      : {}),
  };
}

async function backfillProtocolCoinflipRecent(stats, latestDay, fetcher) {
  const outcomeByDay = protocolOutcomeCache(fetcher);
  const recentByDay = new Map();
  for (const row of stats.recent) {
    const merged = { ...outcomeByDay.get(row.day), ...row };
    outcomeByDay.set(row.day, merged);
    recentByDay.set(row.day, merged);
  }
  if (recentByDay.size >= COINFLIP_RECENT_BUFFER) return stats;

  const newestSummaryDay = stats.recent.reduce((latest, row) => Math.max(latest, row.day), 0);
  let scanDay = Math.max(0, Math.trunc(Number(latestDay) || 0), newestSummaryDay);
  while (scanDay > 0 && recentByDay.size < COINFLIP_RECENT_BUFFER) {
    const days = [];
    const remaining = COINFLIP_RECENT_BUFFER - recentByDay.size;
    while (scanDay > 0
      && days.length < COINFLIP_STATS_FALLBACK_BATCH
      && days.length < remaining) {
      days.push(scanDay);
      scanDay -= 1;
    }
    const missingDays = days.filter((day) => !outcomeByDay.has(day));
    const outcomes = await Promise.all(missingDays.map(async (day) => {
      try {
        return protocolCoinflipOutcome(day, await fetcher(`/game/coinflip/day/${day}`));
      } catch (error) {
        if (Number(error?.status) === 404) return null;
        throw error;
      }
    }));
    for (const outcome of outcomes) {
      if (outcome) outcomeByDay.set(outcome.day, outcome);
    }
    for (const day of days) {
      const outcome = outcomeByDay.get(day);
      if (outcome) recentByDay.set(day, outcome);
    }
  }

  return {
    ...stats,
    recent: [...recentByDay.values()]
      .sort((a, b) => b.day - a.day)
      .slice(0, COINFLIP_RECENT_BUFFER),
  };
}

async function hydrateProtocolCoinflipRewards(stats, fetcher) {
  const outcomeByDay = protocolOutcomeCache(fetcher);
  for (const row of stats.recent) {
    const cached = outcomeByDay.get(row.day);
    outcomeByDay.set(row.day, { ...cached, ...row });
  }
  const missingWinDays = stats.recent
    .filter((row) => row.win && !Number.isFinite(outcomeByDay.get(row.day)?.rewardPercent))
    .map((row) => row.day);
  for (let offset = 0; offset < missingWinDays.length; offset += COINFLIP_STATS_FALLBACK_BATCH) {
    const batch = missingWinDays.slice(offset, offset + COINFLIP_STATS_FALLBACK_BATCH);
    const outcomes = await Promise.all(batch.map(async (day) => {
      try {
        return protocolCoinflipOutcome(day, await fetcher(`/game/coinflip/day/${day}`));
      } catch (_error) {
        // Special marker colors are an enhancement. A delayed exact-day row
        // must not make the all-time score or ordinary win/loss bank disappear.
        return null;
      }
    }));
    for (const outcome of outcomes) {
      if (outcome) outcomeByDay.set(outcome.day, outcome);
    }
  }
  return {
    ...stats,
    recent: stats.recent.map((row) => {
      const rewardPercent = outcomeByDay.get(row.day)?.rewardPercent;
      return Number.isFinite(rewardPercent) ? { ...row, rewardPercent } : row;
    }),
  };
}

/**
 * Load the protocol-wide W–L record. There is one global CoinflipDayResolved per
 * settled game day, so the fallback walks those immutable day rows directly;
 * it must never infer the board from whichever player's wallet is being viewed.
 */
export async function loadProtocolCoinflipStats(latestDay, fetcher = fetchJSON) {
  try {
    const stats = normalizeProtocolCoinflipStats(
      await fetcher('/game/coinflip/stats'),
      COINFLIP_RECENT_BUFFER,
    );
    const filled = await backfillProtocolCoinflipRecent(stats, latestDay, fetcher);
    return hydrateProtocolCoinflipRewards(filled, fetcher);
  } catch (error) {
    if (Number(error?.status) !== 404) throw error;
  }

  const upperDay = Math.max(0, Math.trunc(Number(latestDay) || 0));
  const protocolDays = Array.from({ length: upperDay }, (_, index) => upperDay - index);
  const outcomeByDay = protocolOutcomeCache(fetcher);
  const unknownDays = protocolDays.filter((day) => !outcomeByDay.has(day));

  for (let offset = 0; offset < unknownDays.length; offset += COINFLIP_STATS_FALLBACK_BATCH) {
    const batch = unknownDays.slice(offset, offset + COINFLIP_STATS_FALLBACK_BATCH);
    const outcomes = await Promise.all(batch.map(async (day) => {
      try {
        const result = await fetcher(`/game/coinflip/day/${day}`);
        return protocolCoinflipOutcome(day, result);
      } catch (error) {
        // Today's row may still be unresolved. It is retried next refresh;
        // immutable settled outcomes remain cached for the deployment.
        if (Number(error?.status) === 404) return null;
        throw error;
      }
    }));
    for (const outcome of outcomes) {
      if (outcome) outcomeByDay.set(outcome.day, outcome);
    }
  }
  const settled = protocolDays.map((day) => outcomeByDay.get(day)).filter(Boolean);

  return normalizeProtocolCoinflipStats({
    wins: settled.filter((row) => row.win).length,
    losses: settled.filter((row) => !row.win).length,
    recent: settled.slice(0, COINFLIP_RECENT_BUFFER),
  }, COINFLIP_RECENT_BUFFER);
}

/** Keep today's public result hidden from the board until its local reveal lands. */
export function protocolCoinflipStatsForReveal(stats, {
  day = null,
  result = null,
  revealComplete = false,
  gateCurrentDay = true,
} = {}) {
  if (!stats) return null;
  // Keep one settled result behind the visible bank. If today's indexed result
  // is hidden until its local reveal, that backfill preserves the full
  // twenty-five-result history instead of briefly reducing the bank to twenty-four entries.
  const normalized = normalizeProtocolCoinflipStats(stats, COINFLIP_RECENT_BUFFER);
  const visibleRecent = (rows) => rows.slice(0, COINFLIP_RECENT_WINDOW);
  const targetDay = Math.trunc(Number(day) || 0);
  const recentIndex = normalized.recent.findIndex((row) => row.day === targetDay);
  const indexedResult = recentIndex >= 0 ? normalized.recent[recentIndex] : null;
  const resolvedWin = typeof result?.win === 'boolean' ? result.win : indexedResult?.win;
  const exactRewardPercent = Number(result?.rewardPercent);
  const resolvedRewardPercent = result?.rewardPercent != null
    && Number.isFinite(exactRewardPercent)
    && exactRewardPercent >= 0
    ? Math.trunc(exactRewardPercent)
    : indexedResult?.rewardPercent;
  const withResolvedReward = (rows) => (
    targetDay > 0 && Number.isFinite(resolvedRewardPercent)
      ? rows.map((row) => (row.day === targetDay
        ? { ...row, rewardPercent: resolvedRewardPercent }
        : row))
      : rows
  );
  if (!gateCurrentDay || targetDay <= 0 || typeof resolvedWin !== 'boolean') {
    return { ...normalized, recent: visibleRecent(withResolvedReward(normalized.recent)) };
  }

  const included = recentIndex >= 0;
  if (!revealComplete && included) {
    return {
      wins: Math.max(0, normalized.wins - (resolvedWin ? 1 : 0)),
      losses: Math.max(0, normalized.losses - (resolvedWin ? 0 : 1)),
      recent: visibleRecent(normalized.recent.filter((row) => row.day !== targetDay)),
    };
  }
  if (revealComplete && !included) {
    return {
      wins: normalized.wins + (resolvedWin ? 1 : 0),
      losses: normalized.losses + (resolvedWin ? 0 : 1),
      recent: [{
        day: targetDay,
        win: resolvedWin,
        ...(Number.isFinite(resolvedRewardPercent) ? { rewardPercent: resolvedRewardPercent } : {}),
      }, ...normalized.recent]
        .sort((a, b) => b.day - a.day)
        .slice(0, COINFLIP_RECENT_WINDOW),
    };
  }
  return { ...normalized, recent: visibleRecent(withResolvedReward(normalized.recent)) };
}

function parseTokenAmount(value) {
  const match = /^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const fraction = (match[2] || '').padEnd(18, '0');
  try { return (BigInt(match[1]) * (10n ** 18n)) + BigInt(fraction || '0'); }
  catch (_e) { return null; }
}

function parseWholeFlipInput(value) {
  const compact = String(value ?? '').replace(/,/g, '').trim();
  if (!/^\d+$/.test(compact)) return null;
  try { return BigInt(compact); }
  catch (_e) { return null; }
}

function tokenAmountInput(wei) {
  const raw = BigInt(wei || 0);
  const unit = 10n ** 18n;
  const whole = raw / unit;
  const fraction = String(raw % unit).padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

class AppDailyFlip extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #day = null;
  #flipResult = null;      // /game/coinflip/day payload or null
  #flipFetchedDay = null;
  #dashboard = null;
  #dashboardAddress = null;
  #coinflipStats = null;
  #liveBalances = null;
  #liveBalancesAddress = null;
  #bafScore = null;        // indexed score for the active x10 BAF bracket
  #bafLevel = null;
  #bafAddress = null;
  #bafFlipEve = null;      // exact GAME.purchaseInfo x9-final-day signal
  #upcomingFlipBonus = null; // exact AdvanceModule bonus for the next unlocked flip
  #resolvedFlipBonus = null; // RNG-verified bonus included in this resolved day's percent
  // Cache the direct lookup per player/bracket, but accept the live position
  // published by the full-width BAF rail. Both visible BAF surfaces therefore
  // share the same freshly polled rank without adding a second DB query.
  #bafLookupKey = null;
  #forceBafRefresh = false;
  #currentBetWei = null;   // live stored target-day stake plus replayed auto-rebuy carry
  #autoRebuyInfo = null;   // direct Coinflip auto-rebuy settings for #autoRebuyAddress
  #autoRebuyAddress = null;
  #autoRebuyError = '';
  #addBetError = '';
  #autoRebuyDraftAddress = null;
  #autoRebuyDraftReady = false;
  #resolvedBetWei = null;  // final CoinflipStakeUpdated.newTotal for the exact result day
  #rolloverBetCarry = null; // last live stake, promoted at the clock before chain confirmation
  #liveClaimableWei = null; // direct previewClaimCoinflips, bypassing indexer lag
  #ledgerTruthBlock = null; // confirmed tx block the next atomic ledger read must include
  #retireSettlementFloor = false; // exact post-tx ledger supersedes reveal optimism
  #fetchSeq = 0;
  #refreshQueued = false;
  #refreshInFlight = false;
  #refreshAgain = false;
  #active = false;
  #pollHandle = null;
  #resultRetryHandle = null;
  #visibilityListener = null;
  #txConfirmedListener = null;
  #postTxRefreshHandle = null;
  #landing = false;        // coin is mid-landing animation
  #revealRequestedDay = null; // click accepted while a rollover result is still loading
  #meterSettling = false;
  // This is deliberately separate from the animation's mounted/settling state.
  // Only the authoritative meter completion callback may publish a live win;
  // cleanup, refreshes, or an unrelated animation event cannot release it.
  #winningReceiptCommitted = true;
  #meterRecoveryTail = false;
  #meterFlashVisible = false;
  #meterTimer = null;
  #fakeoutMeterVisible = false;
  #fakeoutMeterDraining = false;
  #fakeoutMeterTerminalDraining = false;
  #fakeoutMeterRebounding = false;
  #fakeoutMeterTimers = new Set();
  #coinSfxTimers = new Set();
  #revealTimer = null;
  #revealFinishingTimer = null;
  #coinflipScoreTickDay = null;
  #coinflipScoreTickWin = null;
  #coinflipScoreTickTimer = null;
  #busy = false;
  #errorTimer = null;
  #reverseFlipQuote = null;
  // Chain quote and displayed parity are intentionally separate. If another
  // wallet nudges after today's flip resolves, the display advances through
  // each newly observed reversal instead of snapping directly to its parity.
  #reverseVisualQueued = null;
  #liveReverseAnimation = null;
  #liveReverseTimers = new Set();
  #liveReverseToken = 0;
  #showLiveSideOnCoin = false;
  #resultTruthWindowUntil = 0;
  #resultTruthWindowDay = null;
  #resultTruthWindowTimer = null;
  #reverseCardRevealUntil = 0;
  #reverseCardRevealDay = null;
  #reverseCardRevealTimer = null;
  #questActivateListener = null;
  #sdgnrsQuote = null;
  #sdgnrsQuoteAmount = null;
  #sdgnrsQuotePending = false;
  #sdgnrsQuoteSeq = 0;
  #charityVoteState = null;
  #charityVoteLoading = false;
  #charityVoteBusySlot = null;
  #charityVoteMessage = '';
  #charityVoteError = '';
  #charityVoteSeq = 0;
  // Day-scoped resolved receipt. It preserves the stake/payout named in the
  // result copy and the optimistic claimable total across a browser reload.
  // "Your bet" deliberately does NOT read this receipt: it comes from the
  // contract's live current-day coinflipAmount(player) view.
  #settlementState = null;
  #pendingLootboxCount = 0;
  #activeLootboxRevealIds = new Set();
  #completedJackpotDays = new Set();
  #lootboxQueuedListener = null;
  #lootboxCompleteListener = null;
  #lootboxAbortListener = null;
  #jackpotRevealListener = null;
  #latestDaySeen = null;
  #daySync = null;         // direct GAME day + exact-day jackpot/FLIP readiness
  // Request-time Reverse Flip count. The contract consumes/resets the live
  // queue when the word lands, but the waiting coin must stay parked on the
  // side players actually left it on until the reveal becomes available.
  #resolutionReverseQueued = null;
  #resolutionReverseDay = null;
  #browsingDay = null;
  #forceReplayDay = null;
  #betPositionShiftDay = null; // resolved receipt demoted after Today is activated
  #daySelectionListener = null;
  #bafTransfer = null;
  #bafTransferDoneKey = null;
  #bafImpactTimer = null;

  #activeDaySync(day = this.#day) {
    if (this.#browsingDay != null) return null;
    const syncDay = Number(this.#daySync?.day);
    return Number.isInteger(syncDay) && syncDay > 0 && syncDay === Number(day)
      ? this.#daySync
      : null;
  }

  #rngRequestStarted(sync = this.#daySync) {
    return sync?.rngRequested === true
      || sync?.rngLocked === true
      || sync?.jackpotReady === true
      || sync?.coinflipReady === true;
  }

  #latchResolutionReverse(sync = this.#daySync) {
    const day = Number(sync?.day);
    if (!Number.isInteger(day) || day <= 0 || !this.#rngRequestStarted(sync)) return;
    let queued = null;
    try {
      const raw = sync?.reverseQueued
        ?? this.#reverseFlipQuote?.queued
        ?? this.#reverseVisualQueued;
      if (raw != null) queued = BigInt(raw);
    } catch (_e) { /* unavailable quote leaves the current face untouched */ }
    if (queued == null) return;
    if (this.#resolutionReverseDay !== day || sync?.rngLocked === true) {
      this.#resolutionReverseDay = day;
      this.#resolutionReverseQueued = queued;
    }
  }

  #resolvingReverseQueued() {
    return this.#resolutionReverseDay === Number(this.#day)
      ? this.#resolutionReverseQueued
      : this.#reverseFlipQuote?.queued;
  }

  #adoptSharedBafPosition(position) {
    if (!position) return;
    const address = String(this.#viewedAddress() || '').toLowerCase();
    const sharedAddress = String(position.address || '').toLowerCase();
    const level = Number(position.level);
    if (!address || sharedAddress !== address || !Number.isInteger(level) || level <= 0) return;
    if (this.#bafLevel != null && Number(this.#bafLevel) !== level) return;
    this.#bafAddress = address;
    this.#bafLevel = level;
    this.#bafScore = position;
    this.#bafLookupKey = `${address}:${level}`;
    this.#repairSettlement();
    this.#render();
  }

  #dayAvailabilityReady(day = this.#day) {
    const sync = this.#activeDaySync(day);
    // Preserve historical replay and the pre-coordinator fallback. Once a
    // direct target exists, the Coinflip follows its own exact-day lane; it
    // must not stay closed while the jackpot/ticket lane keeps processing.
    return sync == null || sync.coinflipReady === true;
  }

  #syncedCoinflipResult(day = this.#day) {
    const sync = this.#activeDaySync(day);
    if (!sync?.coinflipReady || Number(sync.coinflipResult?.day) !== Number(day)) return null;
    return sync.coinflipResult;
  }

  #onDaySync(sync) {
    const day = Number(sync?.day);
    this.#daySync = Number.isInteger(day) && day > 0 ? sync : null;
    if (!this.#daySync) {
      this.#render();
      return;
    }
    // The wall-clock day can advance before advanceGame has requested VRF.
    // Leave the prior COIN intact until the request lock/result proves this
    // day has actually begun processing. The staged bet is a separate clocked
    // ledger transition, though: it already belongs on Today's spot.
    if (!this.#rngRequestStarted(sync) && day !== Number(this.#day)) {
      this.#handoffBetAtClock(day);
      return;
    }
    const genuinelyNew = this.#latestDaySeen == null || day > this.#latestDaySeen;
    if (genuinelyNew) this.#latestDaySeen = day;
    if (this.#day == null
      || (genuinelyNew && day !== Number(this.#day))
      || (this.#browsingDay == null && day !== Number(this.#day))) {
      this.#adoptDay(day, { lockedReverseQueued: sync?.reverseQueued });
    }
    if (Number(this.#day) !== day || this.#browsingDay != null) return;
    this.#latchResolutionReverse(sync);
    const result = this.#syncedCoinflipResult(day);
    if (result) {
      this.#flipResult = result;
      this.#flipFetchedDay = day;
      this.#repairSettlement();
    } else {
      // A same-number indexer row can belong to an earlier testnet deploy.
      // Keep it out until this deployment's exact coin and jackpot are ready.
      this.#flipResult = null;
      this.#flipFetchedDay = null;
    }
    this.#render();
    this.#maybeStartQueuedReveal();
  }

  #adoptDay(value, {
    forceReplay = false,
    browsing = false,
    lockedReverseQueued = null,
  } = {}) {
    const day = Number(value);
    if (!Number.isInteger(day) || day <= 0) return false;
    const sameDay = day === Number(this.#day);
    if (sameDay && !forceReplay) return false;
    const previousDay = Number(this.#day);
    const previousCurrentBet = this.#currentBetWei;
    const carriedReverseQuote = this.#reverseFlipQuote;
    const carriedReverseQueued = carriedReverseQuote?.queued ?? this.#reverseVisualQueued;
    const preparedRolloverCarry = !forceReplay
      && !browsing
      && this.#rolloverBetCarry?.day === day
      && this.#rolloverBetCarry?.address === this.#dashboardAddress
      ? this.#rolloverBetCarry
      : null;
    const rolloverCarry = preparedRolloverCarry ?? (!forceReplay
      && !browsing
      && Number.isInteger(previousDay)
      && day === previousDay + 1
      && previousCurrentBet != null
      && this.#dashboardAddress
      ? {
          day,
          address: this.#dashboardAddress,
          wei: this.#asWei(previousCurrentBet),
          promoted: false,
        }
      : null);
    // The staged bet just moved into Today (or resolved days ago), so the new
    // tomorrow starts empty: reseed the held readout to NO BET instead of
    // keeping the previous day's staged amount painted beside its own
    // promoted chips. The live read repaints it once the reveal gates open.
    if (!forceReplay && !browsing
      && Number.isInteger(previousDay) && day > previousDay
      && this.#dashboardAddress) {
      heldBalanceValue({
        namespace: `coinflip-tomorrow:${CHAIN.id}`,
        scope: this.#dashboardAddress,
        value: 0n,
        released: true,
      });
    }
    // Invalidate every task launched for the previous deployment/day before
    // clearing the presentation state. The next coalesced refresh starts from
    // the newly adopted direct-chain day.
    this.#fetchSeq += 1;
    this.#clearRevealTimer();
    this.#clearCoinflipScoreTick();
    this.#clearBafTransfer({ resetDone: true });
    this.#day = day;
    this.#browsingDay = browsing ? day : null;
    this.#forceReplayDay = forceReplay ? day : null;
    this.#betPositionShiftDay = null;
    this.#flipResult = null;
    this.#flipFetchedDay = null;
    this.#resolvedFlipBonus = null;
    this.#landing = false;
    this.#revealRequestedDay = null;
    this.#winningReceiptCommitted = true;
    if (this.#resultRetryHandle != null) {
      try { clearTimeout(this.#resultRetryHandle); } catch (_e) { /* defensive */ }
      this.#resultRetryHandle = null;
    }
    this.#clearModifierMeter();
    this.#clearFakeoutMeter();
    this.#settlementState = null;
    this.#currentBetWei = null;
    this.#resolvedBetWei = null;
    this.#rolloverBetCarry = rolloverCarry;
    this.#liveClaimableWei = null;
    this.#ledgerTruthBlock = null;
    this.#retireSettlementFloor = false;
    this.#bafScore = null;
    this.#bafLevel = null;
    this.#bafAddress = null;
    this.#bafLookupKey = null;
    this.#forceBafRefresh = false;
    this.#clearLiveReverseAnimation();
    this.#clearResultTruthWindow();
    let frozenQueued = null;
    try {
      const raw = lockedReverseQueued ?? carriedReverseQueued;
      if (!forceReplay && !browsing && raw != null) frozenQueued = BigInt(raw);
    } catch (_e) { /* malformed quote resets to the neutral face */ }
    this.#resolutionReverseDay = frozenQueued == null ? null : day;
    this.#resolutionReverseQueued = frozenQueued;
    this.#reverseFlipQuote = frozenQueued == null ? null : {
      queued: frozenQueued,
      costWei: carriedReverseQuote?.costWei ?? reverseFlipCostWei(frozenQueued),
      locked: true,
    };
    this.#reverseVisualQueued = frozenQueued;
    this.#showLiveSideOnCoin = false;
    this.#render();
    this.#scheduleRefresh();
    return true;
  }

  #handoffBetAtClock(day) {
    const previousDay = Number(this.#day);
    if (this.#browsingDay != null
      || !Number.isInteger(previousDay)
      || day !== previousDay + 1
      || !this.#dashboardAddress) return false;
    if (this.#rolloverBetCarry?.day === day
      && this.#rolloverBetCarry?.address === this.#dashboardAddress) return false;
    if (this.#currentBetWei == null) return false;

    // Freeze the already-painted Tomorrow amount before invalidating old-day
    // reads. This is presentation truth at the clock; the resolved-stake read
    // can add auto-rebuy carry later without delaying the physical deal.
    this.#rolloverBetCarry = {
      day,
      address: this.#dashboardAddress,
      wei: this.#asWei(this.#currentBetWei),
      promoted: true,
    };
    this.#fetchSeq += 1;
    this.#currentBetWei = null;
    heldBalanceValue({
      namespace: `coinflip-tomorrow:${CHAIN.id}`,
      scope: this.#dashboardAddress,
      value: 0n,
      released: true,
    });
    // Do not call #render(): the old coin deliberately stays mounted until
    // RNG begins. Only the independent Today/Tomorrow ledger changes here.
    this.#renderPosition();
    this.#scheduleRefresh();
    return true;
  }

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#active = true;
    this.#renderShell();
    this.#renderDailySchedule();
    this.#wireActions();
    this.#wireQuestPreset();
    this.#wireRewardSpoilerGate();

    this.#unsubs.push(subscribe('app.daySync', (sync) => this.#onDaySync(sync)));
    this.#unsubs.push(subscribe('app.bafPosition', (position) => {
      this.#adoptSharedBafPosition(position);
    }));
    this.#unsubs.push(subscribe('app.records', () => {
      this.#renderAddBetDialog();
    }));
    this.#unsubs.push(subscribe('app.boons', () => {
      this.#renderAddBetDialog();
    }));
    this.#unsubs.push(subscribe('ui.questObjectives', () => {
      this.#renderAddBetDialog();
    }));

    // On a NEW day: cancel any in-flight landing, re-render immediately so
    // the stale coin can't take clicks against the new day's key, then
    // refresh (codex finding — the old coin stayed clickable and a running
    // landing would dispatch with the mutated day).
    this.#unsubs.push(subscribe('app.lastDay', (payload) => {
      if (!payload || payload.day == null) return;
      const latest = Number(payload.day);
      if (!Number.isInteger(latest) || latest <= 0) return;
      const genuinelyNew = this.#latestDaySeen == null || latest > this.#latestDaySeen;
      if (genuinelyNew) this.#latestDaySeen = latest;
      if (this.#day == null) {
        this.#adoptDay(latest);
        return;
      }
      // Same-day fragment retries can turn an uncertain Roll-2 placeholder
      // into the exact bonus amount. Repaint immediately so ordinary deposits
      // stop inheriting that conservative hold as soon as the data agrees.
      if (latest === Number(this.#day)) this.#renderPosition();
      // Routine latest-day polling must not pull a manually selected replay
      // back to today. A genuinely newer resolved day still wins, matching the
      // jackpot shell's rollover behaviour.
      if (this.#browsingDay === Number(this.#day) && !genuinelyNew) return;
      if (genuinelyNew && latest !== Number(this.#day)) this.#adoptDay(latest);
    }));
    this.#unsubs.push(subscribe('connected.address', () => {
      this.#fetchSeq += 1;
      this.#clearBafTransfer({ resetDone: true });
      this.#settlementState = null;
      this.#dashboardAddress = null;
      this.#liveBalances = null;
      this.#liveBalancesAddress = null;
      this.#currentBetWei = null;
      this.#autoRebuyInfo = null;
      this.#autoRebuyAddress = null;
      this.#autoRebuyError = '';
      this.#autoRebuyDraftAddress = null;
      this.#autoRebuyDraftReady = false;
      this.#resolvedBetWei = null;
      this.#rolloverBetCarry = null;
      this.#liveClaimableWei = null;
      this.#ledgerTruthBlock = null;
      this.#retireSettlementFloor = false;
      this.#bafScore = null;
      this.#bafLevel = null;
      this.#bafAddress = null;
      this.#bafLookupKey = null;
      this.#bafFlipEve = null;
      this.#upcomingFlipBonus = null;
      this.#revealRequestedDay = null;
      this.#renderAutoRebuy({ syncDraft: true });
      this.#scheduleRefresh();
      const ballot = this.querySelector('[data-bind="df-charity-dialog"]');
      if (ballot && !ballot.hidden) this.#loadCharityVote();
    }));
    this.#unsubs.push(subscribe('viewing.address', () => {
      this.#fetchSeq += 1;
      this.#clearBafTransfer({ resetDone: true });
      this.#settlementState = null;
      this.#dashboardAddress = null;
      this.#liveBalances = null;
      this.#liveBalancesAddress = null;
      this.#currentBetWei = null;
      this.#autoRebuyInfo = null;
      this.#autoRebuyAddress = null;
      this.#autoRebuyError = '';
      this.#autoRebuyDraftAddress = null;
      this.#autoRebuyDraftReady = false;
      this.#resolvedBetWei = null;
      this.#rolloverBetCarry = null;
      this.#liveClaimableWei = null;
      this.#ledgerTruthBlock = null;
      this.#retireSettlementFloor = false;
      this.#bafScore = null;
      this.#bafLevel = null;
      this.#bafAddress = null;
      this.#bafLookupKey = null;
      this.#upcomingFlipBonus = null;
      this.#revealRequestedDay = null;
      this.#renderAutoRebuy({ syncDraft: true });
      this.#scheduleRefresh();
      const ballot = this.querySelector('[data-bind="df-charity-dialog"]');
      if (ballot && !ballot.hidden) this.#loadCharityVote();
    }));

    this.#pollHandle = registerComponentPoll(() => this.#scheduleRefresh(), POLL_INTERVAL_MS);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#daySelectionListener = (event) => {
        const detail = event?.detail;
        if (!detail?.manual) return;
        const selected = Number(detail.day);
        const latest = Number(detail.latestDay);
        if (Number.isInteger(latest) && latest > 0
          && (this.#latestDaySeen == null || latest > this.#latestDaySeen)) {
          this.#latestDaySeen = latest;
        }
        this.#adoptDay(selected, {
          forceReplay: true,
          browsing: Boolean(detail.historical),
        });
      };
      document.addEventListener('replay:day-selected', this.#daySelectionListener);
      this.#visibilityListener = () => {
        if (document.visibilityState === 'visible') this.#scheduleRefresh();
      };
      document.addEventListener('visibilitychange', this.#visibilityListener);
      this.#txConfirmedListener = (event) => {
        // Refresh both minted FLIP and the claimable-first spending ledger.
        // Pin the first reconciliation to the receipt block so wallet,
        // claimable, carry, and Tomorrow's Bet cannot straddle the write.
        // Once that complete snapshot lands it also supersedes the optimistic
        // reveal-time claimable floor retained for slow pre-result RPCs.
        const confirmedBlock = Number(event?.detail?.blockNumber);
        if (Number.isSafeInteger(confirmedBlock) && confirmedBlock >= 0) {
          this.#ledgerTruthBlock = this.#ledgerTruthBlock == null
            ? confirmedBlock
            : Math.max(Number(this.#ledgerTruthBlock), confirmedBlock);
        }
        if (this.#activeSettlement()) this.#retireSettlementFloor = true;
        this.#scheduleRefresh();
        if (this.#postTxRefreshHandle != null) {
          try { clearTimeout(this.#postTxRefreshHandle); } catch (_e) { /* defensive */ }
        }
        this.#postTxRefreshHandle = setTimeout(() => {
          this.#postTxRefreshHandle = null;
          this.#scheduleRefresh();
        }, 900);
        if (this.#postTxRefreshHandle && typeof this.#postTxRefreshHandle.unref === 'function') {
          try { this.#postTxRefreshHandle.unref(); } catch (_e) { /* defensive */ }
        }
      };
      document.addEventListener(TX_CONFIRMED_EVENT, this.#txConfirmedListener);
    }
    this.#scheduleRefresh();
  }

  disconnectedCallback() {
    resetBalanceDisplay(this.querySelector('[data-bind="df-funds-flip-total"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="df-baf-score"]'));
    this.#active = false;
    this.#fetchSeq += 1;
    this.#refreshQueued = false;
    this.#refreshAgain = false;
    this.#revealRequestedDay = null;
    if (this.#postTxRefreshHandle != null) {
      try { clearTimeout(this.#postTxRefreshHandle); } catch (_e) { /* defensive */ }
      this.#postTxRefreshHandle = null;
    }
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#questActivateListener && typeof document !== 'undefined') {
      try { document.removeEventListener('quest:activate', this.#questActivateListener); }
      catch (_e) { /* defensive */ }
      this.#questActivateListener = null;
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      if (this.#lootboxQueuedListener) {
        document.removeEventListener(LOOTBOX_REVEAL_QUEUED_EVENT, this.#lootboxQueuedListener);
      }
      if (this.#lootboxCompleteListener) {
        document.removeEventListener(LOOTBOX_REVEAL_COMPLETE_EVENT, this.#lootboxCompleteListener);
      }
      if (this.#lootboxAbortListener) {
        document.removeEventListener(LOOTBOX_REVEAL_ABORT_EVENT, this.#lootboxAbortListener);
      }
      if (this.#jackpotRevealListener) {
        document.removeEventListener('jackpot:revealed', this.#jackpotRevealListener);
      }
      if (this.#visibilityListener) {
        document.removeEventListener('visibilitychange', this.#visibilityListener);
      }
      if (this.#txConfirmedListener) {
        document.removeEventListener(TX_CONFIRMED_EVENT, this.#txConfirmedListener);
      }
      if (this.#daySelectionListener) {
        document.removeEventListener('replay:day-selected', this.#daySelectionListener);
      }
    }
    this.#lootboxQueuedListener = null;
    this.#lootboxCompleteListener = null;
    this.#lootboxAbortListener = null;
    this.#jackpotRevealListener = null;
    this.#visibilityListener = null;
    this.#txConfirmedListener = null;
    this.#daySelectionListener = null;
    this.#activeLootboxRevealIds.clear();
    this.#pendingLootboxCount = 0;
    if (typeof this.#pollHandle === 'function') {
      try { this.#pollHandle(); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#resultRetryHandle != null) {
      try { clearTimeout(this.#resultRetryHandle); } catch (_) { /* defensive */ }
      this.#resultRetryHandle = null;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
    this.#clearModifierMeter();
    this.#winningReceiptCommitted = true;
    this.#clearFakeoutMeter();
    this.#clearRevealTimer();
    this.#clearCoinflipScoreTick();
    this.#clearBafTransfer({ resetDone: true });
    this.#clearLiveReverseAnimation();
    this.#clearResultTruthWindow();
    this.#sdgnrsQuoteSeq += 1;
    this.#sdgnrsQuotePending = false;
    this.#charityVoteSeq += 1;
    this.#charityVoteLoading = false;
    this.#charityVoteBusySlot = null;
    this.#initialized = false;
  }

  /**
   * Jackpot-LCD handoff. The click is still the player's activation, so this
   * travels through the exact same audio, stale-day, queue, and landing path
   * as tapping the coin itself.
   */
  startCoinflipFromJackpot({ scroll = false } = {}) {
    const day = this.#day;
    if (!this.#initialized || !this.#active || day == null
      || this.#landing || this.#revealed() || !this.#dayAvailabilityReady(day)) return false;
    if (scroll) {
      try { this.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }
      catch (_error) { /* reveal remains available without smooth scrolling */ }
    }
    this.#onCoinClick(day);
    return this.#landing
      || this.#revealed()
      || Number(this.#revealRequestedDay) === Number(day);
  }

  #clearRevealTimer() {
    const wasAnimating = this.#revealTimer != null
      || this.#revealFinishingTimer != null
      || this.#landing;
    if (this.#revealTimer != null) {
      try { clearTimeout(this.#revealTimer); } catch (_) { /* defensive */ }
      this.#revealTimer = null;
    }
    if (this.#revealFinishingTimer != null) {
      try { clearTimeout(this.#revealFinishingTimer); } catch (_) { /* defensive */ }
      this.#revealFinishingTimer = null;
    }
    this.#clearCoinSfxTimers();
    if (wasAnimating) setMajorDrawActivity('daily-flip', false);
  }

  #clearCoinSfxTimers() {
    for (const timer of this.#coinSfxTimers) {
      try { clearTimeout(timer); } catch (_) { /* defensive */ }
    }
    this.#coinSfxTimers.clear();
  }

  #clearCoinflipScoreTick() {
    if (this.#coinflipScoreTickTimer != null) {
      try { clearTimeout(this.#coinflipScoreTickTimer); } catch (_) { /* defensive */ }
    }
    this.#coinflipScoreTickTimer = null;
    this.#coinflipScoreTickDay = null;
    this.#coinflipScoreTickWin = null;
    this.querySelector('[data-bind="df-coinflip-wins"]')?.classList?.remove('is-ticking');
    this.querySelector('[data-bind="df-coinflip-losses"]')?.classList?.remove('is-ticking');
    this.querySelector('.df-coinflip-record__group--score')?.classList?.remove('is-resolving');
    this.querySelector('.df-coinflip-record__group--recent')?.classList?.remove('is-resolving');
    this.querySelector('[data-bind="df-coinflip-recent"]')?.classList?.remove('is-shifting');
    this.querySelectorAll?.('.df-coinflip-record__mark')?.forEach?.((marker) => {
      marker.classList?.remove('is-new');
    });
  }

  #armCoinflipScoreTick(day, win) {
    this.#clearCoinflipScoreTick();
    this.#coinflipScoreTickDay = Number(day);
    this.#coinflipScoreTickWin = Boolean(win);
    if (typeof setTimeout !== 'function') return;
    this.#coinflipScoreTickTimer = setTimeout(() => this.#clearCoinflipScoreTick(), 650);
    this.#coinflipScoreTickTimer?.unref?.();
  }

  #scheduleCoinSfx(revealDay, delay, cue) {
    const timer = setTimeout(() => {
      this.#coinSfxTimers.delete(timer);
      if (!this.#landing || this.#day !== revealDay) return;
      try { cue(); } catch (_e) { /* sound must never stop the reveal */ }
    }, delay);
    this.#coinSfxTimers.add(timer);
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #scheduleCoinVerdictSfx(revealDay, delay, won) {
    const timer = setTimeout(() => {
      this.#coinSfxTimers.delete(timer);
      if (this.#day !== revealDay || !this.#revealed() || this.#landing) return;
      try { sfxCoinflipLand(won); } catch (_e) { /* sound is decorative */ }
    }, delay);
    this.#coinSfxTimers.add(timer);
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #scheduleCoinflipRevealSfx(revealDay, revealPlan, won) {
    sfxCoinflipStart();
    const profileBeats = {
      comet: [0.18, 0.45, 0.75],
      ricochet: [0.14, 0.31, 0.54, 0.75],
      orbit: [0.19, 0.46, 0.71],
      pulse: [0.14, 0.34, 0.57, 0.79],
    };
    const beats = profileBeats[revealPlan?.profile] || [0.2, 0.48, 0.76];
    beats.forEach((fraction, index) => {
      this.#scheduleCoinSfx(
        revealDay,
        Math.max(80, Math.round(revealPlan.trackMs * fraction)),
        () => sfxCoinflipWhoosh(0.48 + (index * 0.11), index % 2 === 1),
      );
    });
    // The rare hard stop must sound unplanned too: no deceleration sweep or
    // pre-landing tell. The authoritative verdict cue still follows finish().
    if (revealPlan?.hardStop) return;
    // One last soft sweep follows the visible deceleration without saying
    // which face will win. Verdict audio is scheduled only after finish().
    this.#scheduleCoinSfx(
      revealDay,
      revealPlan.trackMs + Math.round(revealPlan.openingMs * 0.38),
      () => sfxCoinflipWhoosh(0.46, true),
    );
    const reversalCount = Math.max(0, Math.trunc(Number(revealPlan?.reversalCount) || 0));
    if (reversalCount === 0) return;
    for (let index = 1; index <= reversalCount; index += 1) {
      this.#scheduleCoinSfx(
        revealDay,
        reverseCardDelayMs(revealPlan, index),
        () => sfxCoinflipWhoosh(0.72 + (index * 0.06), index % 2 === 0),
      );
      // CSS contact is exactly halfway through the 600ms card flight.
      this.#scheduleCoinSfx(
        revealDay,
        reverseCardDelayMs(revealPlan, index) + (REVERSE_CARD_ANIMATION_MS / 2),
        () => sfxReverseBonk(0.88 + (index * 0.06)),
      );
    }
  }

  #rewardGateAddress() {
    const raw = this.#dashboardAddress || getViewedAddress();
    return raw ? String(raw).toLowerCase() : null;
  }

  #lootboxRewardGateKey() {
    const address = this.#rewardGateAddress();
    return address ? `flip_reward_reveal_gate_${CHAIN.id}_${address}` : null;
  }

  #setLootboxRewardGate(pending) {
    const key = this.#lootboxRewardGateKey();
    if (!key || typeof localStorage === 'undefined') return;
    try {
      if (pending) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch (_e) { /* private browsing: in-memory gates still apply */ }
  }

  #lootboxRewardGatePending() {
    if (this.#pendingLootboxCount > 0 || this.#activeLootboxRevealIds.size > 0) return true;
    const key = this.#lootboxRewardGateKey();
    if (!key || typeof localStorage === 'undefined') return false;
    try { return localStorage.getItem(key) === '1'; }
    catch (_e) { return false; }
  }

  #bonusJackpotCleared() {
    if (this.#day == null) return true;
    if (this.#completedJackpotDays.has(Number(this.#day))) return true;
    if (typeof localStorage === 'undefined') return false;
    try {
      if (localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_${this.#day}`) === '1') {
        return true;
      }
      // `spun_day` was the only jackpot completion bit before the separate
      // Roll-1/bonus latch was introduced. Honor that durable state unless a
      // new-format session explicitly says the bonus roll is still pending.
      const spun = localStorage.getItem(`spun_day_${CHAIN.id}_${this.#day}`) === '1';
      const bonusPending = localStorage.getItem(
        `jackpot_bonus_pending_day_${CHAIN.id}_${this.#day}`,
      ) === '1';
      return spun && !bonusPending;
    }
    catch (_e) { return false; }
  }

  #tomorrowRewardGateOpen() {
    // Exact daily-jackpot FLIP is removed from the live stake below, so that
    // reward no longer requires freezing the player's ordinary deposits.
    // Lootbox rewards are not yet attributable inside the shared balance and
    // still use the last-safe-value gate.
    return !this.#lootboxRewardGatePending();
  }

  #tomorrowAutoRebuyGateOpen(hasResult) {
    // Auto rebuy folds the resolved payout into the next live stake. Until the
    // player flips that coin, showing Tomorrow's Bet would disclose the result
    // (including a loss that clears the carry). An unknown settings read is
    // treated conservatively so a faster stake RPC cannot flash the spoiler.
    if (this.#browsingDay != null || this.#revealed()) return true;
    // Result and settings arrive independently. Until the exact-day result
    // request has completed, do not let a faster current-stake read become the
    // value we preserve as "settled" for this reveal.
    if (this.#flipFetchedDay !== this.#day) return false;
    if (!hasResult) return true;
    const info = this.#activeAutoRebuyInfo();
    return Boolean(info && !info.enabled);
  }

  #wireRewardSpoilerGate() {
    this.#unsubs.push(subscribePendingActions((items) => {
      this.#pendingLootboxCount = (Array.isArray(items) ? items : [])
        .filter((item) => REWARD_BOX_SOURCES.includes(String(item?.source || ''))
          && item?.kind === 'lootbox'
          && item?.resolved === true).length;
      if (this.#pendingLootboxCount > 0) {
        this.#setLootboxRewardGate(true);
      } else if (
        this.#activeLootboxRevealIds.size === 0
        && REWARD_BOX_SOURCES.every((source) => pendingSourceHasPublished(source))
      ) {
        // A durable latch protects the initial async load from leaking a box
        // reward. Once both box providers explicitly report an empty manifest,
        // retire stale state. Ticket packs never enter this calculation.
        this.#setLootboxRewardGate(false);
      }
      this.#renderPosition();
    }));
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#lootboxQueuedListener = (event) => {
      const detail = event?.detail || {};
      const eventAddress = detail.address ? String(detail.address).toLowerCase() : null;
      const address = this.#rewardGateAddress();
      if (eventAddress && address && eventAddress !== address) return;
      if (detail.presentationId != null) {
        this.#activeLootboxRevealIds.add(String(detail.presentationId));
      }
      this.#setLootboxRewardGate(true);
      this.#renderPosition();
    };
    this.#lootboxCompleteListener = (event) => {
      const id = event?.detail?.presentationId;
      if (id != null) this.#activeLootboxRevealIds.delete(String(id));
      if (this.#activeLootboxRevealIds.size === 0 && this.#pendingLootboxCount === 0) {
        this.#setLootboxRewardGate(false);
      }
      this.#renderPosition();
    };
    this.#lootboxAbortListener = (event) => {
      for (const id of Array.isArray(event?.detail?.presentationIds)
        ? event.detail.presentationIds : []) {
        this.#activeLootboxRevealIds.delete(String(id));
      }
      // Closing before the result is consumed must not expose its FLIP leg.
      this.#setLootboxRewardGate(true);
      this.#renderPosition();
    };
    this.#jackpotRevealListener = (event) => {
      const day = Number(event?.detail?.day);
      if (event?.detail?.complete === true && Number.isInteger(day) && day > 0) {
        // Same-tab fallback for private browsing / blocked localStorage.
        this.#completedJackpotDays.add(day);
      }
      this.#renderPosition();
      // Jackpot playback and daily FLIP resolution share the same RNG
      // transition. Do not wait for the interval after either scratch stage.
      this.#scheduleRefresh();
    };
    document.addEventListener(LOOTBOX_REVEAL_QUEUED_EVENT, this.#lootboxQueuedListener);
    document.addEventListener(LOOTBOX_REVEAL_COMPLETE_EVENT, this.#lootboxCompleteListener);
    document.addEventListener(LOOTBOX_REVEAL_ABORT_EVENT, this.#lootboxAbortListener);
    document.addEventListener('jackpot:revealed', this.#jackpotRevealListener);
  }

  #setLiveReverseTimer(fn, delay) {
    const token = this.#liveReverseToken;
    const timer = setTimeout(() => {
      this.#liveReverseTimers.delete(timer);
      if (!this.#active || token !== this.#liveReverseToken) return;
      fn();
    }, delay);
    this.#liveReverseTimers.add(timer);
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (_) { /* defensive */ }
    }
    return timer;
  }

  #clearLiveReverseAnimation() {
    this.#liveReverseToken += 1;
    for (const timer of this.#liveReverseTimers) {
      try { clearTimeout(timer); } catch (_) { /* defensive */ }
    }
    this.#liveReverseTimers.clear();
    this.#liveReverseAnimation = null;
  }

  #clearResultTruthWindow() {
    if (this.#resultTruthWindowTimer != null) {
      try { clearTimeout(this.#resultTruthWindowTimer); } catch (_) { /* defensive */ }
    }
    this.#resultTruthWindowTimer = null;
    this.#resultTruthWindowUntil = 0;
    this.#resultTruthWindowDay = null;
    if (this.#reverseCardRevealTimer != null) {
      try { clearTimeout(this.#reverseCardRevealTimer); } catch (_) { /* defensive */ }
    }
    this.#reverseCardRevealTimer = null;
    this.#reverseCardRevealUntil = 0;
    this.#reverseCardRevealDay = null;
  }

  #resultTruthWindowActive() {
    return this.#resultTruthWindowDay === Number(this.#day)
      && this.#resultTruthWindowUntil > Date.now();
  }

  #reverseCardRevealHoldActive() {
    return this.#reverseCardRevealDay === Number(this.#day)
      && this.#reverseCardRevealUntil > Date.now();
  }

  #startReverseCardRevealHold(day) {
    this.#reverseCardRevealDay = Number(day);
    this.#reverseCardRevealUntil = Date.now() + REVERSE_CARD_POST_REVEAL_DELAY_MS;
    const heldDay = Number(day);
    const timer = setTimeout(() => {
      if (this.#reverseCardRevealTimer !== timer) return;
      this.#reverseCardRevealTimer = null;
      this.#reverseCardRevealUntil = 0;
      this.#reverseCardRevealDay = null;
      if (!this.#active || Number(this.#day) !== heldDay) return;
      this.#renderCoin();
      this.#renderReverseFlip();
    }, REVERSE_CARD_POST_REVEAL_DELAY_MS);
    this.#reverseCardRevealTimer = timer;
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #startResultTruthWindow(day) {
    this.#clearResultTruthWindow();
    this.#clearLiveReverseAnimation();
    this.#showLiveSideOnCoin = false;
    this.#resultTruthWindowDay = Number(day);
    this.#resultTruthWindowUntil = Date.now() + RESULT_TRUTH_WINDOW_MS;
    this.#startReverseCardRevealHold(day);
    const heldDay = Number(day);
    const timer = setTimeout(() => {
      if (this.#resultTruthWindowTimer !== timer) return;
      this.#resultTruthWindowTimer = null;
      this.#resultTruthWindowUntil = 0;
      this.#resultTruthWindowDay = null;
      if (!this.#active || Number(this.#day) !== heldDay) return;
      this.#renderCoin();
      this.#renderReverseFlip();
      this.#maybeStartLiveReverseAnimation();
    }, RESULT_TRUTH_WINDOW_MS);
    this.#resultTruthWindowTimer = timer;
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #styleReverseCardForQueued(card, queued) {
    if (!card || queued == null) return;
    const targetEth = (BigInt(queued) & 1n) === 0n;
    card.classList?.toggle('df-reversi-card--target-eth', targetEth);
    card.classList?.toggle('df-reversi-card--target-wwxrp', !targetEth);
    card.setAttribute('data-reverse-target', targetEth ? 'eth' : 'wwxrp');
    card.setAttribute('aria-label', `Explain Reverse Flip to ${targetEth ? 'ETH' : 'WWXRP'}`);
  }

  #maybeStartLiveReverseAnimation() {
    if (this.#resultTruthWindowActive()) return;
    const quote = this.#reverseFlipQuote;
    if (!quote || this.#reverseVisualQueued == null || this.#liveReverseAnimation) return;
    if (quote.queued <= this.#reverseVisualQueued) return;

    const hasResolvedSurface = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null
      && this.#revealed();
    if (!hasResolvedSurface || this.#reducedMotion()) {
      this.#reverseVisualQueued = quote.queued;
      if (hasResolvedSurface) {
        this.#showLiveSideOnCoin = true;
        this.#renderCoin();
        this.#renderReverseFlip();
      }
      return;
    }
    const dialog = this.querySelector('[data-bind="df-reverse-dialog"]');
    if (this.#landing || (dialog && !dialog.hidden)) return;

    const fromQueued = this.#reverseVisualQueued;
    const toQueued = fromQueued + 1n;
    const token = ++this.#liveReverseToken;
    this.#liveReverseAnimation = { token, fromQueued, toQueued };
    this.#showLiveSideOnCoin = true;
    this.#renderCoin();
    this.#renderReverseFlip();

    this.#setLiveReverseTimer(() => {
      const current = this.#liveReverseAnimation;
      if (!current || current.token !== token) return;
      const coin = this.querySelector('.df-coin--live-reverse');
      const card = this.querySelector('[data-bind="df-reverse-cta"]');
      coin?.classList?.add('df-coin--reverse-out');
      this.#styleReverseCardForQueued(card, toQueued);
      card?.setAttribute('aria-label', 'Reverse Flip changing the current side');
      sfxReverseBonk();

      this.#setLiveReverseTimer(() => {
        const active = this.#liveReverseAnimation;
        if (!active || active.token !== token) return;
        const liveCoin = this.querySelector('.df-coin--live-reverse');
        const image = liveCoin?.querySelector('img');
        const faceIsEth = (toQueued & 1n) === 1n;
        if (image) {
          image.src = faceIsEth
            ? '/shared/coinflip-face-eth.svg'
            : '/shared/coinflip-face-red.svg';
          image.alt = faceIsEth
            ? 'Current side — ETH (odd)'
            : 'Current side — WWXRP (even)';
        }
        sfxCoinflipTurn(faceIsEth, 1);
        liveCoin?.classList?.remove('df-coin--reverse-out');
        liveCoin?.classList?.add('df-coin--reverse-in');
        this.#reverseVisualQueued = toQueued;

        this.#setLiveReverseTimer(() => {
          const finishing = this.#liveReverseAnimation;
          if (!finishing || finishing.token !== token) return;
          this.#liveReverseAnimation = null;
          this.#renderCoin();
          this.#renderReverseFlip();
          this.#maybeStartLiveReverseAnimation();
        }, LIVE_REVERSE_RETURN_MS);
      }, LIVE_REVERSE_FLIP_HALF_MS);
    }, LIVE_REVERSE_TAP_MS);
  }

  #clearFakeoutMeter() {
    for (const timer of this.#fakeoutMeterTimers) {
      try { clearTimeout(timer); } catch (_) { /* defensive */ }
    }
    this.#fakeoutMeterTimers.clear();
    this.#fakeoutMeterVisible = false;
    this.#fakeoutMeterDraining = false;
    this.#fakeoutMeterTerminalDraining = false;
    this.#fakeoutMeterRebounding = false;
  }

  #scheduleFakeoutMeter(revealDay, delay, state) {
    const timer = setTimeout(() => {
      this.#fakeoutMeterTimers.delete(timer);
      if (!this.#landing || this.#day !== revealDay) return;
      this.#fakeoutMeterVisible = state !== 'hide';
      this.#fakeoutMeterDraining = state === 'drain' || state === 'terminal-drain';
      this.#fakeoutMeterTerminalDraining = state === 'terminal-drain';
      this.#fakeoutMeterRebounding = state === 'rebound';
      this.#renderModifierMeter();
    }, delay);
    this.#fakeoutMeterTimers.add(timer);
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #scheduleApparentWinMeters(revealDay, revealPlan, won) {
    const reversalCount = Math.max(0, Math.trunc(Number(revealPlan?.reversalCount) || 0));
    if (reversalCount === 0) return;
    let apparentWon = reversalCount % 2 === 0 ? Boolean(won) : !Boolean(won);
    let meterVisible = apparentWon;
    let meterHasRebounded = false;
    if (apparentWon) {
      this.#scheduleFakeoutMeter(revealDay, revealPlan.trackMs + revealPlan.openingMs, 'show');
    }

    // Each reversal completes on one of these ending offsets. A final red
    // result runs the thermometer to minimum and removes it on that exact
    // landing frame. Whenever another card remains, the mounted rail instead
    // rebounds from its floor and preserves the shorter branch it is mimicking.
    for (let completed = 1; completed <= reversalCount; completed += 1) {
      const nextWon = !apparentWon;
      const landingAt = revealPlan.trackMs
        + revealPlan.openingMs
        + (completed * REVERSE_CARD_STAGGER_MS);
      const anotherCardRemains = completed < reversalCount;
      if (apparentWon && !nextWon) {
        if (anotherCardRemains) {
          this.#scheduleFakeoutMeter(revealDay, landingAt - METER_DRAIN_MS, 'drain');
          this.#scheduleFakeoutMeter(revealDay, landingAt, 'rebound');
          meterHasRebounded = true;
        } else {
          const drainMs = meterHasRebounded ? METER_TERMINAL_DRAIN_MS : METER_DRAIN_MS;
          this.#scheduleFakeoutMeter(
            revealDay,
            landingAt - drainMs,
            meterHasRebounded ? 'terminal-drain' : 'drain',
          );
          this.#scheduleFakeoutMeter(revealDay, landingAt, 'hide');
          meterVisible = false;
        }
      } else if (!apparentWon && nextWon && completed < reversalCount && !meterVisible) {
        this.#scheduleFakeoutMeter(revealDay, landingAt, 'show');
        meterVisible = true;
      }
      apparentWon = nextWon;
    }
  }

  #clearModifierMeter() {
    if (this.#meterTimer != null) {
      try { clearTimeout(this.#meterTimer); } catch (_) { /* defensive */ }
      this.#meterTimer = null;
    }
    this.#meterSettling = false;
    this.#meterRecoveryTail = false;
    this.#meterFlashVisible = false;
  }

  #completeWinningMeter(revealDay) {
    if (!this.#meterSettling
      || this.#day !== revealDay
      || !this.#revealed()
      || this.#landing
      || !Boolean(this.#flipResult?.win)) return;
    if (this.#meterTimer != null) {
      try { clearTimeout(this.#meterTimer); } catch (_) { /* defensive */ }
      this.#meterTimer = null;
    }
    this.#meterSettling = false;
    this.#winningReceiptCommitted = true;
    this.#meterRecoveryTail = false;
    this.#meterFlashVisible = true;
    // The locked percentage is the first authoritative win signal. Publish
    // the W/L counter and slide LAST 25 on this exact frame so the record rail
    // cannot spoil an apparent green landing while the gauge is still moving.
    this.#armCoinflipScoreTick(revealDay, true);
    this.#renderCoinflipStats();
    // Commit the final visual and its audio verdict in one task. The sound can
    // no longer run at coin landing while the thermometer is still moving.
    this.#renderModifierMeter();
    this.#renderPosition();
    // Protocol Coins includes today's newly claimable FLIP. Commit it on the
    // same boundary as the resolved bet and BAF score so the balance cannot
    // announce the win while the final modifier is still settling.
    this.#renderFunds();
    // Today's green receipt is now authoritative. Carry that exact +FLIP
    // figure into BAF before committing the score increase; reduced-motion or
    // unavailable-layout environments fall back to the immediate count-up.
    if (!this.#startBafTransfer(revealDay)) this.#renderBafScore();
    try { sfxCoinflipLand(true); } catch (_e) { /* sound is decorative */ }
    this.#meterTimer = setTimeout(() => {
      this.#meterTimer = null;
      this.#meterFlashVisible = false;
      this.#renderModifierMeter();
    }, METER_FLASH_MS);
    if (this.#meterTimer && typeof this.#meterTimer.unref === 'function') {
      try { this.#meterTimer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #armWinningMeter(revealDay) {
    const settleMs = this.#meterRecoveryTail
      ? METER_RECOVERY_TAIL_MS
      : METER_SETTLE_MS;
    const expectedAnimation = this.#meterRecoveryTail
      ? 'df-meter-recovery-tail'
      : 'df-meter-settle';
    // animationend is the authoritative browser signal. The matching timer is
    // a fallback for headless/legacy environments where that event never fires.
    const marker = this.querySelector('[data-bind="df-modifier-marker"]');
    let onAnimationEnd = null;
    const settle = () => {
      if (marker && onAnimationEnd) marker.removeEventListener('animationend', onAnimationEnd);
      this.#completeWinningMeter(revealDay);
    };
    if (marker && typeof marker.addEventListener === 'function') {
      onAnimationEnd = (event) => {
        // A marker can acquire decorative animations from theme/layout rules.
        // Only the travel animation reaching its terminal frame publishes the
        // payout; an earlier unrelated animationend must be ignored.
        if (String(event?.animationName || '') !== expectedAnimation) return;
        settle();
      };
      marker.addEventListener('animationend', onAnimationEnd);
    }
    this.#meterTimer = setTimeout(settle, settleMs);
    if (this.#meterTimer && typeof this.#meterTimer.unref === 'function') {
      try { this.#meterTimer.unref(); } catch (_) { /* defensive */ }
    }
  }

  // ---------------------------------------------------------------------
  // Reveal gate — same key family as the balances strip fuzz gate.
  // ---------------------------------------------------------------------

  #flipKey() { return `flip_day_${CHAIN.id}_${this.#day}`; }

  #revealed() {
    if (this.#day == null) return false;
    if (Number(this.#forceReplayDay) === Number(this.#day)) return false;
    try {
      return typeof localStorage !== 'undefined'
        && localStorage.getItem(this.#flipKey()) === '1';
    } catch (_e) {
      return false;
    }
  }

  #markRevealed() {
    if (this.#day == null) return;
    if (Number(this.#forceReplayDay) === Number(this.#day)) this.#forceReplayDay = null;
    try { localStorage.setItem(this.#flipKey(), '1'); } catch (_e) { /* private browsing */ }
  }

  #viewedAddress() {
    return (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address')
      || get('connected.address')
      || null;
  }

  #settlementKey(day, address) {
    if (day == null || !address) return null;
    return `flip_settlement_${CHAIN.id}_${day}_${String(address).toLowerCase()}`;
  }

  #saveSettlement(state) {
    const key = this.#settlementKey(state?.day, state?.address);
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        day: state.day,
        address: state.address,
        // The outcome can be revealed before the slower historical stake-log
        // lookup finishes. Preserve unknown as null; never serialize it as a
        // fake zero/NONE receipt.
        betWei: state.betWei == null ? null : String(state.betWei),
        claimableBaseWei: String(state.claimableBaseWei),
        claimableTotalWei: String(state.claimableTotalWei ?? 0n),
        claimableFloorRetired: Boolean(state.claimableFloorRetired),
        rewardPercent: Number(state.rewardPercent || 0),
        won: Boolean(state.won),
        bafGainWei: state.bafGainWei == null ? null : String(state.bafGainWei),
        bafScoreBaseWei: state.bafScoreBaseWei == null ? null : String(state.bafScoreBaseWei),
        bafLevel: state.bafLevel == null ? null : Number(state.bafLevel),
      }));
    } catch (_e) { /* private browsing / quota */ }
  }

  #loadSettlement(day, address) {
    const key = this.#settlementKey(day, address);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (String(saved?.day) !== String(day)) return null;
      if (String(saved?.address || '').toLowerCase() !== String(address).toLowerCase()) return null;
      return {
        day,
        address: String(address).toLowerCase(),
        betWei: saved.betWei == null ? null : this.#asWei(saved.betWei),
        claimableBaseWei: this.#asWei(saved.claimableBaseWei),
        claimableTotalWei: saved.claimableTotalWei == null
          ? null
          : this.#asWei(saved.claimableTotalWei),
        claimableFloorRetired: Boolean(saved.claimableFloorRetired),
        rewardPercent: Number(saved.rewardPercent || 0),
        won: Boolean(saved.won),
        bafGainWei: saved.bafGainWei == null ? null : this.#asWei(saved.bafGainWei),
        bafScoreBaseWei: saved.bafScoreBaseWei == null
          ? null
          : this.#asWei(saved.bafScoreBaseWei),
        bafLevel: saved.bafLevel == null ? null : Number(saved.bafLevel),
      };
    } catch (_e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------

  #scheduleRefresh() {
    if (!this.#active) return;
    if (this.#refreshInFlight) {
      this.#refreshAgain = true;
      return;
    }
    if (this.#refreshQueued) return;
    this.#refreshQueued = true;
    const run = async () => {
      this.#refreshQueued = false;
      if (!this.#active) return;
      this.#refreshInFlight = true;
      try {
        await this.#refresh();
      } finally {
        this.#refreshInFlight = false;
        if (this.#active && this.#refreshAgain) {
          this.#refreshAgain = false;
          this.#scheduleRefresh();
        } else {
          this.#armPendingResultRetry();
        }
      }
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  #armPendingResultRetry() {
    const waiting = this.#active
      && this.#revealRequestedDay === this.#day
      && (this.#flipFetchedDay !== this.#day || this.#flipResult == null);
    if (!waiting || this.#resultRetryHandle != null || typeof setTimeout !== 'function') return;
    this.#resultRetryHandle = setTimeout(() => {
      this.#resultRetryHandle = null;
      if (this.#active && this.#revealRequestedDay === this.#day) this.#scheduleRefresh();
    }, RESULT_PENDING_POLL_MS);
    if (this.#resultRetryHandle && typeof this.#resultRetryHandle.unref === 'function') {
      try { this.#resultRetryHandle.unref(); } catch (_e) { /* defensive */ }
    }
  }

  #repairSettlement() {
    const settlement = this.#activeSettlement();
    if (!settlement || this.#resolvedBetWei == null) return;
    // Repair receipts saved by older UI builds that inferred the resolved bet
    // from the dashboard's newest stake (which may already belong to tomorrow).
    settlement.betWei = this.#resolvedBetWei;
    if (this.#flipFetchedDay === this.#day && this.#flipResult) {
      settlement.rewardPercent = Number(
        this.#flipResult.rewardPercent || settlement.rewardPercent || 0,
      );
    }
    if (this.#liveClaimableWei != null) {
      settlement.claimableTotalWei = this.#liveClaimableWei;
    } else if (settlement.claimableTotalWei == null) {
      settlement.claimableTotalWei = settlement.claimableBaseWei
        + this.#settlementGainWei(settlement);
    }
    // previewClaimCoinflips can be ahead of the indexed claim-state row for
    // unrelated older wins. That lag must never be painted as credit caused by
    // the currently revealed loss.
    const pendingBaf = settlement.won ? this.#pendingBafCreditWei() : 0n;
    const currentWin = this.#settlementGainWei(settlement);
    const bafFloor = pendingBaf != null && pendingBaf > currentWin
      ? pendingBaf
      : currentWin;
    if (!settlement.won) {
      // Repair receipts saved by the earlier UI, which could persist an
      // indexer-lag delta as BAF gain even though the day itself was a loss.
      settlement.bafGainWei = 0n;
    } else if (bafFloor > this.#asWei(settlement.bafGainWei)) {
      settlement.bafGainWei = bafFloor;
    }
    // If the score request lost the initial race with the reveal, capture its
    // baseline while the direct claim preview still proves the credit is
    // pending. That lets a later indexed refresh retire the optimistic amount.
    if (
      settlement.bafScoreBaseWei == null
      && pendingBaf != null
      && pendingBaf > 0n
      && this.#bafScore != null
      && this.#bafAddress === this.#dashboardAddress
    ) {
      settlement.bafScoreBaseWei = this.#asWei(this.#bafScore.score);
      settlement.bafLevel = this.#bafLevel;
    }
    this.#saveSettlement(settlement);
  }

  #runRefreshTask(seq, promise, onValue, onFailure = null) {
    return _settleWithin(promise, REFRESH_TASK_TIMEOUT_MS).then(
      (value) => {
        if (!this.#active || seq !== this.#fetchSeq) return;
        onValue(value);
        this.#render();
        this.#maybeStartQueuedReveal();
      },
      () => {
        if (!this.#active || seq !== this.#fetchSeq || !onFailure) return;
        onFailure();
        this.#render();
      },
    );
  }

  async #refresh() {
    const addr = this.#viewedAddress();
    let day = this.#day;
    const requestedDay = day;
    const seq = ++this.#fetchSeq;
    const address = addr == null ? null : String(addr).toLowerCase();
    const targetChanged = this.#dashboardAddress !== address;

    // Establish the target immediately so a slow response can never leave the
    // previous player's values on screen. Immutable reveal receipts can render
    // from local storage while the network catches up.
    if (targetChanged) {
      this.#dashboard = null;
      this.#dashboardAddress = address;
      this.#liveBalances = null;
      this.#liveBalancesAddress = address;
      this.#currentBetWei = null;
      this.#autoRebuyInfo = null;
      this.#autoRebuyAddress = address;
      this.#autoRebuyError = '';
      this.#resolvedBetWei = null;
      this.#rolloverBetCarry = null;
      this.#liveClaimableWei = null;
      this.#ledgerTruthBlock = null;
      this.#retireSettlementFloor = false;
      this.#bafScore = null;
      this.#bafLevel = null;
      this.#bafAddress = address;
      this.#bafLookupKey = null;
      this.#forceBafRefresh = false;
    }
    const currentSettlement = this.#activeSettlement();
    if (!currentSettlement) {
      this.#settlementState = this.#loadSettlement(day, address);
    }
    if (targetChanged || this.#settlementState) this.#render();

    // Start the deployment-local result probe alongside the address reads. It
    // used to block every balance and stake behind a single RPC response.
    const exactFlipPromise = _settleWithin(
      Promise.resolve().then(() => readLatestCoinflipResult()),
      EXACT_RESULT_TIMEOUT_MS,
    ).catch(() => null);
    const ledgerTruthBlock = this.#ledgerTruthBlock;
    const tasks = [
      this.#runRefreshTask(
        seq,
        addr ? fetchJSON(`/player/${address}`) : Promise.resolve(null),
        (value) => {
          if (value) this.#dashboard = value;
          else this.#dashboard = null;
        },
      ),
      this.#runRefreshTask(
        seq,
        requestedDay != null
          ? loadProtocolCoinflipStats(Math.max(
            Number(requestedDay) || 0,
            Number(this.#latestDaySeen) || 0,
          ))
          : Promise.resolve(null),
        (value) => {
          this.#coinflipStats = value;
        },
        () => {
          // The protocol record is immutable except for its newest row. Keep a
          // previously loaded board visible through a transient API miss.
        },
      ),
      this.#runRefreshTask(
        seq,
        requestedDay != null
          ? fetchJSON(`/game/coinflip/day/${requestedDay}`)
          : Promise.resolve(null),
        (value) => {
          const synced = this.#syncedCoinflipResult(requestedDay);
          const coordinated = this.#activeDaySync(requestedDay);
          this.#flipResult = coordinated ? synced : value;
          this.#flipFetchedDay = coordinated && !synced ? null : requestedDay;
          this.#repairSettlement();
        },
        () => {
          const synced = this.#syncedCoinflipResult(requestedDay);
          this.#flipResult = synced;
          this.#flipFetchedDay = synced ? requestedDay : null;
        },
      ),
      this.#runRefreshTask(
        seq,
        readBafFlipEve(),
        (value) => {
          this.#bafFlipEve = value;
        },
        () => {
          this.#bafFlipEve = null;
        },
      ),
      this.#runRefreshTask(
        seq,
        readUpcomingFlipBonus(),
        (value) => { this.#upcomingFlipBonus = value; },
        () => { this.#upcomingFlipBonus = null; },
      ),
      this.#runRefreshTask(
        seq,
        addr
          ? readGameState().then(async (state) => {
            const level = activeBafScoreLevel(state?.level);
            if (level == null) return { level: null, score: null };
            const lookupKey = `${address}:${level}`;
            if (this.#bafLookupKey === lookupKey) {
              return { level, score: this.#bafScore };
            }
            // Mark before awaiting. A temporary failure stays quiet until a
            // real invalidation instead of becoming a hot retry loop on every
            // ordinary 15-second widget refresh.
            this.#bafLookupKey = lookupKey;
            const force = this.#forceBafRefresh;
            this.#forceBafRefresh = false;
            const score = await fetchJSON(
              `/player/${address}/baf?level=${level}`,
              { force },
            );
            return { level, score };
          })
          : Promise.resolve({ level: null, score: null }),
        (value) => {
          this.#bafAddress = address;
          this.#bafLevel = value?.level ?? null;
          this.#bafScore = value?.score ?? null;
          if (value?.score && address && value?.level != null) {
            update('app.bafPosition', {
              ...value.score,
              address,
              level: Number(value.level),
            });
          }
          this.#repairSettlement();
        },
        () => {
          this.#bafAddress = address;
          this.#bafLevel = null;
          this.#bafScore = null;
          // A transient API miss must not permanently pin this bracket as
          // "already looked up". Successful reads stay cached; failures get
          // one ordinary-poll retry until rank data is available.
          this.#bafLookupKey = null;
        },
      ),
      this.#runRefreshTask(
        seq,
        addr
          ? readCoinflipDisplaySnapshot({ player: addr, blockTag: ledgerTruthBlock })
          : Promise.resolve(null),
        (snapshot) => {
          this.#liveBalancesAddress = address;
          this.#liveBalances = snapshot?.balances ?? null;
          const next = snapshot?.currentStakeWei == null
            ? null
            : this.#asWei(snapshot.currentStakeWei);
          const carry = this.#rolloverBetCarry;
          const carryAhead = carry?.address === this.#dashboardAddress
            && Number(carry.day) > Number(requestedDay);
          // Until RNG advances the coin day, this snapshot is still scoped to
          // the old table state. Do not repaint the new Tomorrow bucket with
          // the amount that was just dealt into Today.
          this.#currentBetWei = carryAhead ? null : next;
          this.#autoRebuyAddress = address;
          this.#autoRebuyInfo = snapshot?.autoRebuyInfo ?? null;
          this.#liveClaimableWei = snapshot?.claimableWei == null
            ? null
            : this.#asWei(snapshot.claimableWei);
          if (
            !carryAhead
            && next === 0n
            && carry?.day === this.#day
            && carry.address === this.#dashboardAddress
          ) {
            carry.promoted = true;
            if (this.#resolvedBetWei == null) this.#resolvedBetWei = carry.wei;
          }
          if (this.#retireSettlementFloor && snapshot?.ledgerComplete) {
            const settlement = this.#activeSettlement();
            if (settlement) {
              settlement.claimableFloorRetired = true;
              this.#saveSettlement(settlement);
            }
            this.#retireSettlementFloor = false;
            if (this.#ledgerTruthBlock === ledgerTruthBlock) this.#ledgerTruthBlock = null;
          }
          this.#repairSettlement();
        },
        () => {
          this.#liveBalancesAddress = address;
          this.#liveBalances = null;
          this.#currentBetWei = null;
          this.#autoRebuyAddress = address;
          this.#autoRebuyInfo = null;
          this.#liveClaimableWei = null;
        },
      ),
      this.#runRefreshTask(
        seq,
        addr && requestedDay != null
          ? readResolvedCoinflipStake({ player: addr, day: requestedDay })
          : Promise.resolve(null),
        (value) => {
          const carryAhead = this.#rolloverBetCarry?.address === this.#dashboardAddress
            && Number(this.#rolloverBetCarry?.day) > Number(requestedDay);
          if (value != null) {
            this.#resolvedBetWei = this.#asWei(value);
            if (!carryAhead) this.#rolloverBetCarry = null;
          } else if (!this.#rolloverBetCarry?.promoted) {
            this.#resolvedBetWei = null;
          }
          this.#repairSettlement();
        },
        () => {
          if (!this.#rolloverBetCarry?.promoted) this.#resolvedBetWei = null;
        },
      ),
      this.#runRefreshTask(
        seq,
        readReverseFlipQuote(),
        (value) => {
          const nextQuote = value == null ? null : {
            queued: this.#asWei(value.queued),
            costWei: this.#asWei(value.costWei),
            locked: Boolean(value.locked),
          };
          this.#reverseFlipQuote = nextQuote;
          if (nextQuote == null) return;
          const sync = this.#activeDaySync(requestedDay);
          if (sync && this.#rngRequestStarted(sync) && sync.coinflipReady !== true
            && (this.#resolutionReverseDay !== Number(requestedDay) || nextQuote.locked)) {
            this.#resolutionReverseDay = Number(requestedDay);
            this.#resolutionReverseQueued = nextQuote.queued;
          }
          if (this.#reverseVisualQueued == null
            || nextQuote.queued < this.#reverseVisualQueued) {
            this.#reverseVisualQueued = nextQuote.queued;
          }
        },
        () => { this.#reverseFlipQuote = null; },
      ),
    ];

    // The API's logical day keys can collide across redeploys. Establish the
    // exact Coinflip deployment's newest resolved day before any day-keyed API
    // read, but let all address-only values paint while this probe is pending.
    const exactFlip = await exactFlipPromise;
    if (!this.#active || seq !== this.#fetchSeq) {
      await Promise.allSettled(tasks);
      return;
    }
    const coordinatedDay = Number(this.#activeDaySync(requestedDay)?.day);
    if (exactFlip?.day != null
      && Number(exactFlip.day) !== Number(requestedDay)
      && Number(this.#browsingDay) !== Number(requestedDay)
      && Number(exactFlip.day) > Number(requestedDay)
      && (!Number.isInteger(coordinatedDay) || coordinatedDay !== Number(requestedDay))) {
      this.#adoptDay(exactFlip.day);
      await Promise.allSettled(tasks);
      return;
    }
    day = this.#day;

    if (exactFlip?.day != null
      && Number(exactFlip.day) === Number(day)
      && this.#dayAvailabilityReady(day)) tasks.push(
      this.#runRefreshTask(
        seq,
        Promise.resolve(exactFlip),
        (value) => {
          this.#flipResult = this.#syncedCoinflipResult(day) || value;
          this.#flipFetchedDay = day;
          this.#repairSettlement();
        },
      ),
    );
    await Promise.allSettled(tasks);
  }

  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-daily-flip">
        <div class="df-coinflip-record-rail">
          <span class="df-coinflip-record" data-bind="df-coinflip-record"
                aria-label="All-time coinflip record is loading">
            <span class="df-coinflip-record__group df-coinflip-record__group--score" data-majority="neutral">
              <small class="df-coinflip-record__label df-coinflip-record__label--record"
                     aria-hidden="true">ALL TIME</small>
              <strong class="df-coinflip-record__score">
                <b data-bind="df-coinflip-wins">—</b><i aria-hidden="true">–</i><b data-bind="df-coinflip-losses">—</b>
              </strong>
            </span>
            <span class="df-coinflip-record__group df-coinflip-record__group--recent" data-majority="neutral">
              <small class="df-coinflip-record__label df-coinflip-record__label--recent"
                     aria-hidden="true">LAST 25</small>
              <span class="df-coinflip-record__recent" data-bind="df-coinflip-recent"
                    role="img" aria-label="Last twenty-five coinflip results"></span>
            </span>
          </span>
        </div>
        <div class="df-modifier-meter-slot" aria-label="Win multiplier scale">
          <div class="df-modifier-meter-live" data-bind="df-modifier-meter-slot"></div>
          <div class="df-modifier-meter__table-scale" aria-hidden="true">
            <span>250%</span><span>200%</span><span>150%</span>
          </div>
        </div>
        <button type="button" class="df-auto-rebuy-cta"
                data-bind="df-auto-rebuy-cta" aria-haspopup="dialog"
                aria-controls="df-auto-rebuy-dialog" aria-expanded="false">
          <small class="df-auto-rebuy-cta__label" aria-hidden="true">AUTO REBUY</small>
          <span class="df-auto-rebuy-cta__spot" aria-hidden="true">
            <img class="df-auto-rebuy-cta__chip" src="/shared/flip-chips/face.svg" alt="">
          </span>
          <strong class="df-auto-rebuy-cta__status"
                  data-bind="df-auto-rebuy-cta-status">—</strong>
        </button>
        <div class="df-bet-table" data-bind="df-today-bet-cta" role="img"
             tabindex="-1" aria-label="Today's bet is loading">
          <small class="df-bet-table__today-label" aria-hidden="true">
            <b class="df-bet-table__add-cue" data-bind="df-today-add-cue" hidden>+</b>
            <span data-bind="df-today-felt-label">TODAY'S BET</span>
            <b data-bind="df-today-felt-bonus" hidden></b>
          </small>
          <div class="df-bet-oval" data-bind="df-bet-oval" role="img"
               aria-label="Today's bet is loading">
            <span class="df-today-winnings-row" data-bind="df-today-winnings-row"
                  data-state="empty" aria-hidden="true">
              <span class="df-bet-chip-rack" data-bind="df-today-winnings-rack" aria-hidden="true"></span>
            </span>
            <span class="df-bet-chip-rack" data-bind="df-bet-chip-rack" aria-hidden="true">—</span>
            <div class="df-position-slot df-bet-today-slot" data-bind="df-position-today"></div>
          </div>
        </div>
        <div class="df-baf-score" data-bind="df-baf-score-box" aria-label="Big Ass Flip rank and score">
          <a class="df-baf-score__title" href="/learn/baf/" aria-label="Learn about Big Ass Flip">
            <span class="df-baf-score__unit">BAF</span>
            <small class="df-baf-score__rank" data-bind="df-baf-rank">RANK —</small>
          </a>
          <strong class="df-baf-score__value" data-bind="df-baf-score">—</strong>
        </div>
        <header class="df-title-bar">
          <div class="df-title-bar__heading">
            <h2 class="df-section-title">
              <small>COMMUNITY</small>
              <strong>COINFLIP</strong>
            </h2>
          </div>
        </header>
        <div class="df-coin-stage">
          <svg class="df-once-daily" viewBox="0 0 200 200" role="img"
               aria-label="Daily jackpot time in your local time zone">
            <defs><path id="df-once-daily-arc" d="M 30 168 Q 100 230 170 168"></path></defs>
            <text><textPath href="#df-once-daily-arc" startOffset="50%" text-anchor="middle"
                            data-bind="df-daily-jackpot-label">DAILY AT —</textPath></text>
          </svg>
          <div class="df-coin-zone" data-bind="df-coin-zone"></div>
          <button type="button" class="df-reveal-cue" data-bind="df-reveal-hint" hidden
                  aria-label="Reveal the coin flip">
            <strong class="df-reveal-cue__copy">CLICK TO FLIP</strong>
            <span class="df-reveal-cue__arrow" aria-hidden="true">↓</span>
          </button>
        </div>
        <p class="df-outcome" data-bind="df-outcome"></p>
        <div class="df-error" data-bind="df-error" hidden role="alert"></div>
        <div class="df-table-watermark" aria-hidden="true">
          <span class="df-table-watermark__type">
            <strong>DEGENERUS</strong>
          </span>
          <span class="df-table-watermark__flame"></span>
          <span class="df-table-watermark__type">
            <strong>PROTOCOL</strong>
          </span>
        </div>
        <div class="df-position" data-bind="df-position">
          <div class="df-tomorrow-layout" data-bind="df-flip-cta"
               role="button" tabindex="0" aria-label="Add FLIP to tomorrow's bet"
               aria-haspopup="dialog" aria-controls="df-add-bet-dialog"
               aria-expanded="false" title="Add FLIP to tomorrow's bet">
            <small class="df-tomorrow-layout__felt-label" aria-hidden="true">
              <span data-bind="df-lower-felt-label">TOMORROW'S BET</span><b data-bind="df-tomorrow-felt-bonus" hidden></b>
            </small>
            <div class="df-tomorrow-bet-oval" data-bind="df-tomorrow-bet-oval" role="img"
                 aria-label="Tomorrow's bet is loading">
              <span class="df-tomorrow-layout__add-cue" data-bind="df-tomorrow-add-cue" aria-hidden="true">+</span>
              <span class="df-bet-chip-rack" data-bind="df-tomorrow-chip-rack" aria-hidden="true">—</span>
              <span class="df-flip-group df-next-bet" data-bind="df-add-bet-controls">
                <quest-objective-indicator class="df-next-bet__quest"
                                           data-quest-pointer="bottom-left"
                                           product="coinflip"></quest-objective-indicator>
                <boon-product-indicator class="df-next-bet__boon"
                                        product="coinflip"></boon-product-indicator>
              </span>
            </div>
            <div class="df-position-slot" data-bind="df-position-tomorrow"></div>
          </div>
        </div>
        <div class="df-funds" data-bind="df-funds" aria-label="FLIP balance and claim rack">
          <small class="df-funds__title" aria-hidden="true">CASH OUT</small>
          <button type="button" class="df-bankroll__well" data-write
                  data-bind="df-claim-flip-cta" aria-haspopup="dialog"
                  aria-label="Open ETH and FLIP cash out">
            <span class="df-bankroll__rack" data-bind="df-bankroll-rack" role="group"
                  aria-label="FLIP bankroll is loading"></span>
          </button>
          <div class="df-funds__coins" id="df-protocol-coins" data-bind="df-funds-coins">
            <small class="df-funds__box-label" aria-hidden="true">AVAILABLE FUNDS</small>
            <div class="df-funds__display df-funds__display--claimable df-funds__display--flip-total"
                 data-bind="df-funds-flip-total-box" aria-label="Wallet plus claimable coinflip FLIP">
              <strong class="df-funds__value df-funds__value--flip-total">
                <span class="df-funds__number" data-bind="df-funds-flip-total">—</span>
                <span class="df-funds__unit" data-bind="df-funds-flip-unit">FLIP</span>
              </strong>
            </div>
          </div>
        </div>
        <div class="df-reverse-dialog df-add-bet-dialog"
             id="df-add-bet-dialog" data-bind="df-add-bet-dialog" hidden
             role="dialog" aria-modal="true" aria-labelledby="df-add-bet-title">
          <div class="df-reverse-dialog__card df-add-bet-dialog__card">
            <button type="button" class="df-reverse-dialog__close"
                    data-bind="df-add-bet-close" aria-label="Close add bet">×</button>
            <header class="df-add-bet-dialog__head">
              <span class="df-add-bet-dialog__heading-copy">
                <h3 id="df-add-bet-title" data-bind="df-add-bet-title">ADD TO TOMORROW'S BET</h3>
              </span>
              <span class="df-add-bet-dialog__chip-scene" aria-hidden="true">
                <img class="df-add-bet-dialog__chip-pile"
                     src="/shared/flip-chips/coin.svg" alt=""
                     data-bind="df-add-bet-chip-pile"
                     data-pile-kind="coin" data-pile-count="1">
              </span>
            </header>
            <div class="df-add-bet-dialog__wager-deck">
              <label class="df-add-bet-dialog__value">
                <img class="df-add-bet-dialog__value-chip"
                     src="/whitepaper/flame-logo-split.svg" alt="" aria-hidden="true">
                <input type="text" name="df-amount" data-bind="df-add-bet-number"
                       min="100" step="100" value="1000" inputmode="numeric" autocomplete="off"
                       pattern="[0-9,]*"
                       aria-label="FLIP to add to tomorrow's bet">
                <b aria-hidden="true">FLIP</b>
              </label>
              <div class="df-add-bet-dialog__slider-deck">
                <input type="range" data-bind="df-add-bet-slider"
                       min="100" max="1000" step="100" value="1000"
                       aria-label="FLIP to add to tomorrow's bet"
                       aria-description="Drag in 1,000 FLIP steps. Use arrow keys or Shift-drag for 100 FLIP adjustments."
                       title="Drag: 1,000 FLIP · arrows or Shift-drag: 100 FLIP">
                <div class="df-add-bet-dialog__range" aria-hidden="true">
                  <span>100</span><span data-bind="df-add-bet-available">AVAILABLE —</span>
                </div>
              </div>
            </div>
            <p class="df-add-bet-dialog__bounty" data-bind="df-add-bet-bounty"
               hidden role="status"></p>
            <p class="df-add-bet-dialog__reuse" data-bind="df-add-bet-reuse"
               hidden role="status"></p>
            <p class="df-add-bet-dialog__boon" data-bind="df-add-bet-boon"
               hidden role="status"></p>
            <p class="df-add-bet-dialog__quest-bonus" data-bind="df-add-bet-quest-bonus"
               hidden role="status"></p>
            <boon-product-indicator class="df-boon-indicator"
                                    product="coinflip"></boon-product-indicator>
            <p class="df-add-bet-dialog__status" data-bind="df-add-bet-status"
               hidden role="alert"></p>
            <div class="df-reverse-dialog__actions">
              <button type="button" class="df-reverse-dialog__later"
                      data-bind="df-add-bet-close">Cancel</button>
              <button type="button" class="df-reverse-dialog__accept"
                      data-write data-write-locked data-write-lock-title="FLIP balance is loading"
                      data-bind="df-add-bet-confirm">Add bet</button>
            </div>
          </div>
        </div>
        <div class="df-reverse-dialog df-auto-rebuy-dialog"
             id="df-auto-rebuy-dialog" data-bind="df-auto-rebuy-dialog" hidden
             role="dialog" aria-modal="true" aria-labelledby="df-auto-rebuy-title">
          <div class="df-reverse-dialog__card df-auto-rebuy-dialog__card">
            <button type="button" class="df-reverse-dialog__close"
                    data-bind="df-auto-rebuy-close" aria-label="Close auto rebuy settings">×</button>
            <header class="df-auto-rebuy-dialog__head">
              <span class="df-auto-rebuy-dialog__mark" aria-hidden="true">↻</span>
              <span>
                <small>COMMUNITY COINFLIP</small>
                <h3 id="df-auto-rebuy-title">Auto rebuy</h3>
              </span>
            </header>
            <p class="df-auto-rebuy-dialog__intro">
              Keep the unbanked part of each win rolling into the next daily flip.
            </p>
            <div class="df-auto-rebuy-dialog__summary">
              <span>
                <small>STATUS</small>
                <strong data-bind="df-auto-rebuy-current">LOADING</strong>
              </span>
              <span>
                <small>ROLLING NOW</small>
                <strong data-bind="df-auto-rebuy-carry">—</strong>
              </span>
            </div>
            <label class="df-auto-rebuy-toggle">
              <span>
                <strong>Auto rebuy</strong>
                <small>Roll wins forward automatically</small>
              </span>
              <input type="checkbox" name="df-auto-rebuy-enabled" role="switch"
                     aria-label="Enable coinflip auto rebuy">
              <span class="df-auto-rebuy-toggle__track" aria-hidden="true">
                <span></span>
              </span>
            </label>
            <label class="df-auto-rebuy-profit">
              <span class="df-auto-rebuy-profit__label">
                <strong>Take profit chunk</strong>
                <small>FLIP</small>
              </span>
              <span class="df-auto-rebuy-profit__field">
                <input type="number" name="df-auto-rebuy-take-profit" min="0" step="any"
                       inputmode="decimal" value="0" aria-label="Take profit chunk in FLIP">
                <span>FLIP</span>
              </span>
              <small class="df-auto-rebuy-profit__help" data-bind="df-auto-rebuy-help">
                Set 0 to roll the full winning payout.
              </small>
            </label>
            <p class="df-auto-rebuy-dialog__status" data-bind="df-auto-rebuy-status"
               hidden role="alert"></p>
            <div class="df-reverse-dialog__actions df-auto-rebuy-dialog__actions">
              <button type="button" class="df-reverse-dialog__later"
                      data-bind="df-auto-rebuy-close">Cancel</button>
              <button type="button" class="df-reverse-dialog__accept"
                      data-bind="df-auto-rebuy-save" data-write data-write-locked
                      data-write-lock-title="Auto rebuy settings are loading">Save</button>
            </div>
          </div>
        </div>
        <div class="df-reverse-dialog df-burn-dialog" data-bind="df-burn-dialog" hidden
             role="dialog" aria-modal="true" aria-labelledby="df-burn-title">
          <div class="df-reverse-dialog__card df-burn-dialog__card">
            <button type="button" class="df-reverse-dialog__close" data-bind="df-burn-cancel"
                    aria-label="Close sDGNRS burn">×</button>
            <h3 id="df-burn-title">Burn sDGNRS</h3>
            <p class="df-reverse-dialog__copy">
              <span>Live-game burns settle on the next daily RNG at 25%–175% of the previewed ETH value.</span>
              <span>The payout normally splits between claimable ETH and a luckbox; FLIP backing pays only if the next flip wins.</span>
            </p>
            <label class="df-burn-dialog__amount">
              <span>Amount</span>
              <span class="df-burn-dialog__field">
                <input type="number" name="df-sdgnrs-amount" min="1" step="1" value="1"
                       inputmode="decimal" aria-label="sDGNRS to burn">
                <button type="button" data-bind="df-burn-max">MAX</button>
              </span>
              <span class="df-burn-dialog__slider">
                <input type="range" min="0" max="1000" step="1" value="0"
                       data-bind="df-burn-slider" aria-label="Choose sDGNRS burn amount">
                <span class="df-burn-dialog__slider-ends" aria-hidden="true">
                  <span>1 sDGNRS</span><span>MAX</span>
                </span>
              </span>
            </label>
            <div class="df-burn-dialog__quote" data-bind="df-burn-quote">
              <span>Expected ETH value</span>
              <strong data-bind="df-burn-expected">—</strong>
              <small data-bind="df-burn-flip-expected"></small>
            </div>
            <div class="df-reverse-dialog__actions">
              <button type="button" class="df-reverse-dialog__later" data-bind="df-burn-cancel">Cancel</button>
              <button type="button" class="df-reverse-dialog__accept df-burn-dialog__accept"
                      data-write data-write-locked data-write-lock-title="Enter an sDGNRS amount"
                      data-bind="df-burn-accept">Burn</button>
            </div>
          </div>
        </div>
        <div class="df-reverse-dialog df-charity-dialog" data-bind="df-charity-dialog" hidden
             role="dialog" aria-modal="true" aria-labelledby="df-charity-title">
          <div class="df-reverse-dialog__card df-charity-dialog__card">
            <button type="button" class="df-reverse-dialog__close" data-bind="df-charity-close"
                    aria-label="Close charity vote">×</button>
            <header class="df-charity-dialog__head">
              <span class="df-charity-dialog__mark" aria-hidden="true">♥</span>
              <span>
                <span class="df-charity-dialog__eyebrow">GNRUS · ON-CHAIN BALLOT</span>
                <h3 id="df-charity-title">Choose the next donation</h3>
              </span>
            </header>
            <p class="df-reverse-dialog__copy df-charity-dialog__copy">
              Your whole sDGNRS balance is your voting power. The leading eligible recipient receives
              2% of the remaining GNRUS allocation when this level resolves.
            </p>
            <div class="df-charity-dialog__mode">
              <span aria-hidden="true">+</span>
              <p><strong>Approval voting</strong>
                <small>Support any number of charities once per level. The contract has no downvote action.</small>
              </p>
            </div>
            <div class="df-charity-dialog__meta">
              <span>LEVEL <strong data-bind="df-charity-level">—</strong></span>
              <span>YOUR POWER <strong data-bind="df-charity-power">—</strong></span>
              <span>SUPPORTED <strong data-bind="df-charity-supported">—</strong></span>
            </div>
            <div class="df-charity-dialog__toolbar">
              <span>CURRENT RANKING</span>
              <button type="button" data-bind="df-charity-refresh" aria-label="Refresh charity ballot">↻ REFRESH</button>
            </div>
            <div class="df-charity-dialog__ballot" data-bind="df-charity-ballot"
                 aria-live="polite"></div>
            <p class="df-charity-dialog__status" data-bind="df-charity-status"
               hidden role="status"></p>
            <p class="df-charity-dialog__footnote">
              The previous winner sits out for one level. Ties resolve to the lowest numbered slot.
            </p>
          </div>
        </div>
        <div class="df-reverse-dialog" data-bind="df-reverse-dialog" hidden
             role="dialog" aria-modal="true" aria-labelledby="df-reverse-title">
          <div class="df-reverse-dialog__card">
            <button type="button" class="df-reverse-dialog__close" data-bind="df-reverse-cancel"
                    aria-label="Close Reverse Flip explanation">×</button>
            <div class="df-reverse-dialog__visuals">
              <img class="df-reverse-dialog__mark" src="/shared/reverse-flip-card.svg" alt="">
              <div class="df-reverse-dialog__side">
                <span>Current side</span>
                <div class="df-reverse-dialog__side-face">
                  <img data-bind="df-reverse-side-img" alt="" hidden>
                </div>
              </div>
            </div>
            <h3 id="df-reverse-title">Reverse Flip</h3>
            <p class="df-reverse-dialog__copy">
              <span>${REVERSE_FLIP_HELP[0]}</span>
              <span>${REVERSE_FLIP_HELP[1]}</span>
            </p>
            <div class="df-reverse-dialog__price">
              <span>Current cost</span>
              <strong data-bind="df-reverse-cost">Loading…</strong>
            </div>
            <div class="df-reverse-dialog__actions">
              <button type="button" class="df-reverse-dialog__later" data-bind="df-reverse-cancel">Not now</button>
              <button type="button" class="df-reverse-dialog__accept" data-write
                      data-bind="df-reverse-accept" data-write-locked
                      data-write-lock-title="Reverse Flip price is loading">Accept</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  #render() {
    this.#renderDailySchedule();
    this.#renderBafFlipEve();
    this.#renderCoin();
    this.#renderModifierMeter();
    this.#renderPosition();
    this.#renderCoinflipStats();
    this.#renderAutoRebuy();
    this.#renderFunds();
    this.#renderBafScore();
    this.#renderReverseFlip();
    this.#renderAddBetDialog();
    this.#maybeStartLiveReverseAnimation();
  }

  #renderDailySchedule() {
    const fixture = this.querySelector('.df-once-daily');
    const copy = this.querySelector('[data-bind="df-daily-jackpot-label"]');
    if (!fixture || !copy) return;
    const label = coinflipDailyJackpotLabel();
    if (copy.textContent !== label) copy.textContent = label;
    const accessible = `${label} in your local time zone`;
    fixture.setAttribute('aria-label', accessible);
    fixture.title = accessible;
  }

  #renderBafFlipEve() {
    const panel = this.querySelector('.app-daily-flip');
    const visible = this.#browsingDay == null && this.#bafFlipEve?.targetLevel != null;
    panel?.classList?.toggle('app-daily-flip--baf-eve', visible);
  }

  #formatFlipPrice(wei) {
    // Costs are shown as whole FLIP too. Round a fractional exact contract
    // quote up so the label never understates what the wallet will spend.
    const unit = 10n ** 18n;
    const raw = BigInt(wei || 0);
    const whole = raw > 0n ? (raw + unit - 1n) / unit : 0n;
    return whole.toLocaleString('en-US');
  }

  #addBetAvailableWei() {
    const acting = getActingAddress();
    if (!acting || !this.#dashboardAddress
      || String(acting).toLowerCase() !== String(this.#dashboardAddress).toLowerCase()) return null;
    const balances = this.#liveBalancesAddress === this.#dashboardAddress
      ? this.#liveBalances
      : null;
    const walletRaw = balances?.flipBalance ?? this.#dashboard?.flipBalance ?? null;
    if (walletRaw == null) return null;
    return protocolFlipTotalWei(this.#asWei(walletRaw), this.#visibleClaimableWei());
  }

  #snapAddBetSliderWhole(value, minWhole, maxWhole, step) {
    let raw;
    try { raw = BigInt(String(value || '0')); }
    catch (_e) { raw = minWhole; }
    const upper = minWhole + (((maxWhole - minWhole) / step) * step);
    const offset = raw > minWhole ? raw - minWhole : 0n;
    const snapped = minWhole + (((offset + (step / 2n)) / step) * step);
    return snapped < minWhole ? minWhole : snapped > upper ? upper : snapped;
  }

  #snapAddBetSliderCoarseWhole(value, minWhole, maxWhole) {
    const fine = this.#snapAddBetSliderWhole(
      value,
      minWhole,
      maxWhole,
      ADD_BET_SLIDER_FINE_STEP,
    );
    if (maxWhole < ADD_BET_SLIDER_COARSE_STEP) return fine;
    const coarse = ((fine + (ADD_BET_SLIDER_COARSE_STEP / 2n))
      / ADD_BET_SLIDER_COARSE_STEP) * ADD_BET_SLIDER_COARSE_STEP;
    const upper = minWhole + (((maxWhole - minWhole) / ADD_BET_SLIDER_FINE_STEP)
      * ADD_BET_SLIDER_FINE_STEP);
    return coarse < minWhole ? minWhole : coarse > upper ? upper : coarse;
  }

  #betPositionsShifted() {
    return this.#day != null
      && this.#browsingDay == null
      && Number(this.#betPositionShiftDay) === Number(this.#day);
  }

  #addBetOpener() {
    return this.querySelector(`[data-bind="${
      this.#betPositionsShifted() ? 'df-today-bet-cta' : 'df-flip-cta'
    }"]`);
  }

  #renderAddBetDialog({ reset = false } = {}) {
    const dialog = this.querySelector('[data-bind="df-add-bet-dialog"]');
    const opener = this.#addBetOpener();
    const todayOpener = this.querySelector('[data-bind="df-today-bet-cta"]');
    const tomorrowOpener = this.querySelector('[data-bind="df-flip-cta"]');
    const title = this.querySelector('[data-bind="df-add-bet-title"]');
    const chipPile = this.querySelector('[data-bind="df-add-bet-chip-pile"]');
    const slider = this.querySelector('[data-bind="df-add-bet-slider"]');
    const number = this.querySelector('[data-bind="df-add-bet-number"]');
    const availableLabel = this.querySelector('[data-bind="df-add-bet-available"]');
    const bounty = this.querySelector('[data-bind="df-add-bet-bounty"]');
    const reuse = this.querySelector('[data-bind="df-add-bet-reuse"]');
    const boon = this.querySelector('[data-bind="df-add-bet-boon"]');
    const questBonus = this.querySelector('[data-bind="df-add-bet-quest-bonus"]');
    const confirm = this.querySelector('[data-bind="df-add-bet-confirm"]');
    const status = this.querySelector('[data-bind="df-add-bet-status"]');
    if (!dialog || !slider || !number || !confirm) return;

    const dayName = this.#betPositionsShifted() ? 'today' : 'tomorrow';
    if (title) title.textContent = `ADD TO ${dayName.toUpperCase()}'S BET`;
    number.setAttribute('aria-label', `FLIP to add to ${dayName}'s bet`);
    slider.setAttribute('aria-label', `FLIP to add to ${dayName}'s bet`);

    const unit = 10n ** 18n;
    const minWhole = 100n;
    const available = this.#addBetAvailableWei();
    const maxWhole = available == null ? 0n : available / unit;
    const validRange = maxWhole >= minWhole;
    const sliderStep = ADD_BET_SLIDER_FINE_STEP;
    slider.min = String(minWhole);
    slider.max = validRange ? String(maxWhole) : String(minWhole);
    slider.step = String(sliderStep);
    number.min = String(minWhole);
    number.max = validRange ? String(maxWhole) : String(minWhole);
    number.step = String(ADD_BET_SLIDER_FINE_STEP);
    if (reset) {
      number.value = validRange ? String(maxWhole < 1_000n ? maxWhole : 1_000n) : '';
    }
    if (!validRange) number.value = '';
    number.placeholder = validRange
      ? `${minWhole.toLocaleString('en-US')}–${maxWhole.toLocaleString('en-US')}`
      : available == null ? 'LOADING' : 'NOT ENOUGH';
    const parsedWhole = parseWholeFlipInput(number.value);
    if (parsedWhole != null) number.value = parsedWhole.toLocaleString('en-US');
    const selectedWhole = validRange
      && parsedWhole != null
      && parsedWhole >= minWhole
      && parsedWhole <= maxWhole
      ? parsedWhole
      : null;
    const validSelection = selectedWhole != null;
    if (chipPile) {
      const pileWhole = parsedWhole != null && parsedWhole > 0n ? parsedWhole : minWhole;
      const preview = flipWagerPreview(pileWhole * unit);
      chipPile.setAttribute('src', preview.art);
      chipPile.setAttribute('data-pile-kind', preview.kind);
      chipPile.setAttribute('data-pile-count', String(preview.count));
    }
    const claimsBounty = validSelection && candidateClaimsRecord(
      get('app.records'),
      RECORD_KIND_FLIP,
      selectedWhole * unit,
    );
    const bountyWei = claimsBounty
      ? candidateRecordPayoutWei({
        state: get('app.records'),
        kind: RECORD_KIND_FLIP,
        candidate: selectedWhole * unit,
        today: Number(get('app.daySync')?.day ?? get('app.lastDay')?.day) || null,
      })
      : 0n;
    number.classList?.toggle('is-bounty-trigger', claimsBounty);
    number.parentElement?.classList?.toggle('is-bounty-trigger', claimsBounty);
    slider.classList?.toggle('is-bounty-trigger', claimsBounty);
    confirm.classList?.toggle('is-bounty-trigger', claimsBounty);
    this.querySelector('.df-add-bet-dialog__card')
      ?.classList?.toggle('is-bounty-trigger', claimsBounty);
    if (claimsBounty) {
      number.setAttribute('data-bounty-trigger', 'true');
      number.setAttribute(
        'aria-description',
        bountyWei == null
          ? 'This deposit reaches the live Biggest Flip bounty target; its live payout is loading.'
          : `This deposit reaches the live Biggest Flip bounty target and adds ${this.#fmtWhole(bountyWei)} FLIP.`,
      );
    } else {
      number.removeAttribute('data-bounty-trigger');
      number.removeAttribute('aria-description');
    }
    if (bounty) {
      bounty.hidden = !claimsBounty;
      bounty.textContent = !claimsBounty
        ? ''
        : bountyWei == null
          ? 'THE BIGGEST BOUNTY · LIVE AMOUNT LOADING'
          : `THE BIGGEST BOUNTY · +${this.#fmtWhole(bountyWei)} FLIP`;
      if (!claimsBounty) bounty.removeAttribute('title');
      else bounty.setAttribute(
        'title',
        'This FLIP credit is paid from the live shared record pool when the transaction confirms.',
      );
    }
    if (validSelection) {
      slider.value = String(this.#snapAddBetSliderWhole(
        selectedWhole,
        minWhole,
        maxWhole,
        sliderStep,
      ));
    }
    slider.disabled = !validRange || this.#busy;
    number.disabled = !validRange || this.#busy;
    if (validRange && !validSelection) number.setAttribute('aria-invalid', 'true');
    else number.removeAttribute('aria-invalid');
    const sliderWhole = validRange ? BigInt(slider.value || minWhole) : 0n;
    slider.setAttribute('aria-valuetext', validRange ? `${sliderWhole.toLocaleString('en-US')} FLIP` : 'Unavailable');
    if (availableLabel) {
      availableLabel.textContent = available == null
        ? 'AVAILABLE —'
        : `AVAILABLE ${this.#fmtWhole(available)} FLIP`;
    }
    if (reuse) {
      const selectedWei = (selectedWhole ?? 0n) * unit;
      const claimableWei = this.#visibleClaimableWei();
      const reusedWei = validSelection && claimableWei > 0n
        ? (selectedWei < claimableWei ? selectedWei : claimableWei)
        : 0n;
      const bonusWei = (reusedWei * COINFLIP_REUSE_BONUS_BPS) / BPS_DENOMINATOR;
      const bonusWhole = bonusWei / unit;
      reuse.hidden = bonusWhole === 0n;
      reuse.textContent = bonusWhole === 0n
        ? ''
        : `REUSED WINNINGS +0.75% · +${bonusWhole.toLocaleString('en-US')} FLIP`;
      if (bonusWhole === 0n) reuse.removeAttribute('title');
      else reuse.setAttribute(
        'title',
        `${this.#fmtWhole(reusedWei)} FLIP of this bet comes from winnings.`,
      );
    }
    if (boon) {
      const selectedWei = (selectedWhole ?? 0n) * unit;
      const boonWei = validSelection
        ? coinflipBoonBoostDelta(selectedWei, get('app.boons'))
        : 0n;
      boon.hidden = boonWei === 0n;
      boon.textContent = boonWei > 0n
        ? `+${tokenAmountInput(boonWei)} FLIP BOON`
        : '';
    }
    if (questBonus) {
      const completion = validSelection
        ? questCompletionBonusModel(
            get('ui.questObjectives'),
            'coinflip',
            selectedWhole * unit,
          )
        : null;
      questBonus.hidden = completion == null;
      questBonus.textContent = completion?.message || '';
    }
    confirm.disabled = !validSelection || this.#busy;
    if (validSelection && !this.#busy) {
      confirm.removeAttribute('data-write-locked');
      confirm.removeAttribute('data-write-lock-title');
    } else {
      confirm.setAttribute('data-write-locked', '');
      confirm.setAttribute(
        'data-write-lock-title',
        this.#busy
          ? 'Adding bet'
          : available == null
            ? 'FLIP balance is loading'
            : validRange
              ? `Enter a whole FLIP amount from 100 to ${maxWhole.toLocaleString('en-US')}`
              : 'At least 100 FLIP is required',
      );
    }
    todayOpener?.setAttribute('aria-expanded', String(opener === todayOpener && !dialog.hidden));
    tomorrowOpener?.setAttribute('aria-expanded', String(opener === tomorrowOpener && !dialog.hidden));
    if (status) {
      status.textContent = this.#addBetError;
      status.hidden = !this.#addBetError;
    }
  }

  #openAddBetDialog({ reset = true } = {}) {
    const dialog = this.querySelector('[data-bind="df-add-bet-dialog"]');
    if (!dialog) return;
    this.#addBetError = '';
    dialog.hidden = false;
    dialog.removeAttribute('hidden');
    this.#renderAddBetDialog({ reset });
    const number = this.querySelector('[data-bind="df-add-bet-number"]');
    queueMicrotask(() => {
      try {
        number?.focus?.({ preventScroll: true });
        number?.select?.();
      } catch (_e) { /* headless */ }
    });
  }

  #closeAddBetDialog() {
    // This only dismisses the presentation. A submitted deposit keeps waiting
    // for its receipt in #runAction, so leaving the modal cannot cancel the
    // write or allow a duplicate while #busy remains true.
    const dialog = this.querySelector('[data-bind="df-add-bet-dialog"]');
    if (!dialog) return;
    dialog.hidden = true;
    dialog.setAttribute('hidden', '');
    this.#addBetError = '';
    this.#renderAddBetDialog();
  }

  #activeAutoRebuyInfo() {
    if (this.#autoRebuyAddress !== this.#dashboardAddress) return null;
    return this.#autoRebuyInfo;
  }

  #canEditAutoRebuy() {
    const acting = getActingAddress();
    return Boolean(acting && this.#dashboardAddress
      && String(acting).toLowerCase() === String(this.#dashboardAddress).toLowerCase());
  }

  #renderCoinflipStats() {
    const host = this.querySelector('[data-bind="df-coinflip-record"]');
    const wins = this.querySelector('[data-bind="df-coinflip-wins"]');
    const losses = this.querySelector('[data-bind="df-coinflip-losses"]');
    const recentHost = this.querySelector('[data-bind="df-coinflip-recent"]');
    const scoreGroup = this.querySelector('.df-coinflip-record__group--score');
    const recentGroup = this.querySelector('.df-coinflip-record__group--recent');
    if (!host || !wins || !losses || !recentHost || !scoreGroup || !recentGroup) return;
    const exactResult = this.#flipFetchedDay === this.#day ? this.#flipResult : null;
    const recordRevealComplete = this.#revealed()
      && !this.#landing
      && (!Boolean(exactResult?.win) || this.#winningReceiptCommitted);
    const stats = protocolCoinflipStatsForReveal(this.#coinflipStats, {
      day: this.#day,
      result: exactResult,
      revealComplete: recordRevealComplete,
      gateCurrentDay: this.#browsingDay == null,
    });
    const nextWins = stats ? stats.wins.toLocaleString('en-US') : '—';
    const nextLosses = stats ? stats.losses.toLocaleString('en-US') : '—';
    const scoreTickActive = stats != null
      && this.#coinflipScoreTickDay === Number(this.#day)
      && typeof this.#coinflipScoreTickWin === 'boolean';
    const winsTicked = scoreTickActive && this.#coinflipScoreTickWin === true;
    const lossesTicked = scoreTickActive && this.#coinflipScoreTickWin === false;
    wins.classList?.toggle('is-ticking', winsTicked);
    losses.classList?.toggle('is-ticking', lossesTicked);
    scoreGroup.classList?.toggle('is-resolving', scoreTickActive);
    recentGroup.classList?.toggle('is-resolving', scoreTickActive);
    recentHost.classList?.toggle('is-shifting', scoreTickActive);
    wins.textContent = nextWins;
    losses.textContent = nextLosses;
    recentHost.textContent = '';

    const recent = stats?.recent || [];
    const majority = (green, red) => green > red ? 'win' : (red > green ? 'loss' : 'neutral');
    scoreGroup.setAttribute(
      'data-majority',
      stats ? majority(stats.wins, stats.losses) : 'neutral',
    );
    const recentWins = recent.filter((row) => row.win).length;
    recentGroup.setAttribute(
      'data-majority',
      recent.length ? majority(recentWins, recent.length - recentWins) : 'neutral',
    );
    const ordered = [...recent];
    for (let index = 0; index < COINFLIP_RECENT_WINDOW; index += 1) {
      const result = ordered[index] || null;
      const rewardPercent = Number(result?.rewardPercent);
      const markerTone = result?.win
        && result?.rewardPercent != null
        && Number.isFinite(rewardPercent)
        ? dailyFlipMultiplierTone(100 + Math.max(0, Math.trunc(rewardPercent)))
        : null;
      const markerToneClass = markerTone === 'low'
        ? ' is-roll-150'
        : (markerTone === 'high' ? ' is-roll-250' : '');
      const marker = document.createElement('span');
      marker.className = result == null
        ? 'df-coinflip-record__mark is-empty'
        : `df-coinflip-record__mark ${result.win ? 'is-win' : 'is-loss'}${markerToneClass}${
          result.day === Number(this.#day) && (winsTicked || lossesTicked) ? ' is-new' : ''
        }`;
      marker.setAttribute('aria-hidden', 'true');
      if (result) marker.title = `${result.win ? 'Win' : 'Loss'} · Day ${result.day}`;
      recentHost.appendChild(marker);
    }

    const recordCopy = stats
      ? `${stats.wins.toLocaleString('en-US')} wins and ${stats.losses.toLocaleString('en-US')} losses`
      : 'loading';
    const recentCopy = recent.length
      ? ordered.map((row) => row.win ? 'win' : 'loss').join(', ')
      : 'no completed flips yet';
    host.title = `All-time coinflip record: ${recordCopy}. Last 25: ${recentCopy}.`;
    host.setAttribute('aria-label', host.title);
    recentHost.setAttribute('aria-label', `Last twenty-five coinflip results: ${recentCopy}`);
  }

  #renderAutoRebuy({ syncDraft = false } = {}) {
    const trigger = this.querySelector('[data-bind="df-auto-rebuy-cta"]');
    const triggerStatus = this.querySelector('[data-bind="df-auto-rebuy-cta-status"]');
    const dialog = this.querySelector('[data-bind="df-auto-rebuy-dialog"]');
    const current = this.querySelector('[data-bind="df-auto-rebuy-current"]');
    const carry = this.querySelector('[data-bind="df-auto-rebuy-carry"]');
    const toggle = this.querySelector('[name="df-auto-rebuy-enabled"]');
    const input = this.querySelector('[name="df-auto-rebuy-take-profit"]');
    const help = this.querySelector('[data-bind="df-auto-rebuy-help"]');
    const status = this.querySelector('[data-bind="df-auto-rebuy-status"]');
    const save = this.querySelector('[data-bind="df-auto-rebuy-save"]');
    const info = this.#activeAutoRebuyInfo();
    const isOpen = Boolean(dialog && !dialog.hidden);
    const enabled = Boolean(info?.enabled);

    if (triggerStatus) triggerStatus.textContent = info ? (enabled ? 'ON' : 'OFF') : '—';
    if (trigger) {
      trigger.classList?.toggle('is-active', Boolean(info && enabled));
      trigger.setAttribute('aria-expanded', String(isOpen));
      trigger.setAttribute(
        'aria-label',
        info
          ? `Auto rebuy settings, ${enabled ? 'on' : 'off'}`
          : 'Auto rebuy settings, loading',
      );
      trigger.title = info
        ? `Auto rebuy · ${enabled ? 'ON' : 'OFF'}`
        : 'Auto rebuy settings';
    }
    if (current) {
      current.textContent = info ? (enabled ? 'ON' : 'OFF') : 'LOADING';
      current.classList?.toggle('is-active', Boolean(info && enabled));
    }
    if (carry) {
      carry.textContent = info ? `${this.#fmtWhole(info.carryWei)} FLIP` : '—';
    }

    const draftTargetChanged = this.#autoRebuyDraftAddress !== this.#dashboardAddress;
    const shouldSyncDraft = syncDraft
      || !isOpen
      || draftTargetChanged
      || (Boolean(info) && !this.#autoRebuyDraftReady);
    if (shouldSyncDraft) {
      if (toggle) toggle.checked = enabled;
      if (input) input.value = tokenAmountInput(info?.takeProfitWei ?? 0n);
      this.#autoRebuyDraftAddress = this.#dashboardAddress;
      this.#autoRebuyDraftReady = Boolean(info);
    }
    const draftEnabled = Boolean(toggle?.checked);
    const takeProfitWei = parseTokenAmount(input?.value);
    const amountValid = !draftEnabled || (takeProfitWei != null
      && takeProfitWei <= MAX_AUTO_REBUY_TAKE_PROFIT_WEI);
    const editable = this.#canEditAutoRebuy();
    const changed = Boolean(info) && (
      draftEnabled !== enabled
      || (draftEnabled && takeProfitWei !== info.takeProfitWei)
    );

    if (toggle) toggle.disabled = this.#busy || !editable || !info;
    if (input) input.disabled = this.#busy || !editable || !info || !draftEnabled;
    if (help) {
      if (!draftEnabled) {
        help.textContent = info?.enabled
          ? 'Saving OFF settles resolved flips and cashes out any remaining rolling FLIP.'
          : 'Turn auto rebuy on to choose how much of each win gets banked.';
      } else if (!amountValid) {
        help.textContent = 'Enter a valid non-negative FLIP amount.';
      } else if (takeProfitWei === 0n) {
        help.textContent = '0 rolls the full winning payout into the next daily flip.';
      } else {
        help.textContent = `Each full ${tokenAmountInput(takeProfitWei)} FLIP chunk is banked; the remainder keeps rolling.`;
      }
    }
    if (status) {
      status.textContent = this.#autoRebuyError;
      status.hidden = !this.#autoRebuyError;
      status.classList?.toggle('is-error', Boolean(this.#autoRebuyError));
    }
    if (save) {
      let lockedReason = '';
      if (this.#busy) lockedReason = 'Another Coinflip action is processing';
      else if (!editable) lockedReason = 'Connect to this player account to change auto rebuy';
      else if (!info) lockedReason = 'Auto rebuy settings are loading';
      else if (!amountValid) lockedReason = 'Enter a valid take profit amount';
      else if (!changed) lockedReason = 'No auto rebuy changes to save';
      save.disabled = Boolean(lockedReason);
      save.textContent = this.#busy ? 'Saving…' : 'Save';
      if (lockedReason) {
        save.setAttribute('data-write-locked', '');
        save.setAttribute('data-write-lock-title', lockedReason);
      } else {
        save.removeAttribute('data-write-locked');
        save.removeAttribute('data-write-lock-title');
      }
    }
  }

  #openAutoRebuyDialog() {
    const dialog = this.querySelector('[data-bind="df-auto-rebuy-dialog"]');
    if (!dialog) return;
    this.#autoRebuyError = '';
    this.#renderAutoRebuy({ syncDraft: true });
    dialog.hidden = false;
    this.#renderAutoRebuy();
    try {
      this.querySelector('[name="df-auto-rebuy-enabled"]')?.focus?.({ preventScroll: true });
    } catch (_e) { /* headless */ }
  }

  #closeAutoRebuyDialog({ restoreFocus = true } = {}) {
    const dialog = this.querySelector('[data-bind="df-auto-rebuy-dialog"]');
    if (dialog) dialog.hidden = true;
    this.#autoRebuyError = '';
    this.#renderAutoRebuy({ syncDraft: true });
    if (restoreFocus) {
      try {
        this.querySelector('[data-bind="df-auto-rebuy-cta"]')?.focus?.({ preventScroll: true });
      } catch (_e) { /* headless */ }
    }
  }

  #renderReverseFlip() {
    const card = this.querySelector('[data-bind="df-reverse-cta"]');
    const sideImg = this.querySelector('[data-bind="df-reverse-side-img"]');
    const cost = this.querySelector('[data-bind="df-reverse-cost"]');
    const accept = this.querySelector('[data-bind="df-reverse-accept"]');
    const quote = this.#reverseFlipQuote;
    if (card) {
      card.hidden = this.#liveReverseAnimation
        ? false
        : this.#reverseCardRevealHoldActive() || Boolean(quote?.locked);
    }
    card?.classList?.toggle('df-reversi-card--locked', Boolean(quote?.locked));
    if (!quote) {
      card?.classList?.remove('df-reversi-card--target-eth', 'df-reversi-card--target-wwxrp');
      card?.removeAttribute?.('data-reverse-target');
      if (sideImg) sideImg.hidden = true;
      if (card) card.title = 'Reverse Flip price is loading';
      if (cost) cost.textContent = 'Loading…';
      if (accept) {
        accept.textContent = 'Accept';
        accept.disabled = true;
        accept.setAttribute('data-write-locked', '');
        accept.setAttribute('data-write-lock-title', 'Reverse Flip price is loading');
      }
      return;
    }
    const odd = (quote.queued & 1n) === 1n;
    // The small card advertises the side this *next* reversal will create,
    // which is the opposite of the currently queued side shown in the dialog.
    if (card && !this.#liveReverseAnimation) {
      this.#styleReverseCardForQueued(card, this.#reverseVisualQueued ?? quote.queued);
    }
    if (sideImg) {
      sideImg.src = odd
        ? '/shared/coinflip-face-eth.svg'
        : '/shared/coinflip-face-red.svg';
      sideImg.alt = odd ? 'ETH — odd side' : 'WWXRP — even side';
      sideImg.title = odd ? 'ETH (odd)' : 'WWXRP (even)';
      sideImg.hidden = false;
    }
    if (quote.locked) {
      if (card) card.title = 'The next RNG is already locked';
      if (cost) cost.textContent = 'RNG locked';
      if (accept) {
        accept.textContent = 'RNG locked';
        accept.disabled = true;
        accept.setAttribute('data-write-locked', '');
        accept.setAttribute('data-write-lock-title', 'The next RNG is already locked');
      }
      return;
    }
    const price = `${this.#formatFlipPrice(quote.costWei)} FLIP`;
    if (card) card.title = `Reverse Flip · ${price}`;
    if (cost) cost.textContent = price;
    if (accept) {
      accept.textContent = `Accept · ${price}`;
      accept.removeAttribute('data-write-locked');
      accept.removeAttribute('data-write-lock-title');
      accept.disabled = this.#busy;
    }
  }

  #openReverseDialog() {
    const dialog = this.querySelector('[data-bind="df-reverse-dialog"]');
    if (!dialog) return;
    this.#renderReverseFlip();
    dialog.hidden = false;
    const accept = this.querySelector('[data-bind="df-reverse-accept"]');
    try { accept?.focus?.(); } catch (_e) { /* headless / detached */ }
  }

  #closeReverseDialog() {
    const dialog = this.querySelector('[data-bind="df-reverse-dialog"]');
    if (dialog) dialog.hidden = true;
    if (this.#reverseFlipQuote) {
      this.#showLiveSideOnCoin = true;
      this.#renderCoin();
      this.#renderReverseFlip();
      this.#maybeStartLiveReverseAnimation();
    }
    const card = this.querySelector('[data-bind="df-reverse-cta"]');
    try { card?.focus?.(); } catch (_e) { /* headless / detached */ }
  }

  #sdgnrsBalanceWei() {
    if (this.#liveBalancesAddress === this.#dashboardAddress
      && this.#liveBalances?.sdgnrsBalance != null) {
      return this.#asWei(this.#liveBalances.sdgnrsBalance);
    }
    if (this.#dashboard?.sdgnrsBalance == null) return null;
    return this.#asWei(this.#dashboard.sdgnrsBalance);
  }

  #ownsDisplayedSdgnrs() {
    const connected = get('connected.address');
    return Boolean(connected && this.#dashboardAddress
      && String(connected).toLowerCase() === String(this.#dashboardAddress).toLowerCase());
  }

  #renderSdgnrsBurn() {
    const button = this.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    const accept = this.querySelector('[data-bind="df-burn-accept"]');
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    const balance = this.#sdgnrsBalanceWei();
    const ownsBalance = this.#ownsDisplayedSdgnrs();
    const hasMinimum = balance != null && balance >= MIN_SDGNRS_BURN_WEI;
    const amount = parseTokenAmount(input?.value);
    const validAmount = amount != null
      && amount >= MIN_SDGNRS_BURN_WEI
      && balance != null
      && amount <= balance;
    this.#syncSdgnrsBurnSliderFromInput();

    if (button) {
      const locked = this.#busy || !ownsBalance || !hasMinimum;
      button.disabled = locked;
      button.textContent = this.#busy ? 'WAIT' : 'BURN';
      if (locked) {
        const reason = this.#busy
          ? 'Transaction in progress'
          : !ownsBalance
            ? 'Open your own wallet view to burn sDGNRS'
            : 'Minimum burn is 1 sDGNRS';
        button.setAttribute('data-write-locked', '');
        button.setAttribute('data-write-lock-title', reason);
        button.title = reason;
      } else {
        button.removeAttribute('data-write-locked');
        button.removeAttribute('data-write-lock-title');
        button.removeAttribute('title');
      }
    }
    if (accept) {
      const locked = this.#busy || !ownsBalance || !validAmount;
      accept.disabled = locked;
      accept.textContent = this.#busy ? 'Burning…' : 'Burn';
      if (locked) {
        accept.setAttribute('data-write-locked', '');
        accept.setAttribute('data-write-lock-title', this.#busy
          ? 'Transaction in progress'
          : 'Enter an amount from 1 through your sDGNRS balance');
      } else {
        accept.removeAttribute('data-write-locked');
        accept.removeAttribute('data-write-lock-title');
      }
    }
    const slider = this.querySelector('[data-bind="df-burn-slider"]');
    if (slider) slider.disabled = this.#busy || !ownsBalance || !hasMinimum;
  }

  #syncSdgnrsBurnSliderFromInput() {
    const slider = this.querySelector('[data-bind="df-burn-slider"]');
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    const balance = this.#sdgnrsBalanceWei();
    if (!slider) return;
    let position = 0n;
    const amount = parseTokenAmount(input?.value);
    if (balance != null && balance > MIN_SDGNRS_BURN_WEI && amount != null) {
      const clamped = amount < MIN_SDGNRS_BURN_WEI
        ? MIN_SDGNRS_BURN_WEI
        : amount > balance ? balance : amount;
      const span = balance - MIN_SDGNRS_BURN_WEI;
      position = ((clamped - MIN_SDGNRS_BURN_WEI) * SDGNRS_BURN_SLIDER_STEPS
        + (span / 2n)) / span;
    }
    slider.value = String(position);
    const progress = Number(position) / Number(SDGNRS_BURN_SLIDER_STEPS) * 100;
    if (slider.style?.setProperty) {
      slider.style.setProperty('--df-burn-slider-progress', `${progress}%`);
    } else if (slider.style) {
      slider.style['--df-burn-slider-progress'] = `${progress}%`;
    }
    const exact = amount == null ? 'Invalid amount' : `${tokenAmountInput(amount)} sDGNRS`;
    slider.setAttribute?.('aria-valuetext', exact);
  }

  #setSdgnrsBurnFromSlider() {
    const slider = this.querySelector('[data-bind="df-burn-slider"]');
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    const balance = this.#sdgnrsBalanceWei();
    if (!slider || !input || balance == null || balance < MIN_SDGNRS_BURN_WEI) return;
    const numeric = Math.max(0, Math.min(
      Number(SDGNRS_BURN_SLIDER_STEPS),
      Math.round(Number(slider.value) || 0),
    ));
    const position = BigInt(numeric);
    const span = balance - MIN_SDGNRS_BURN_WEI;
    const amount = position >= SDGNRS_BURN_SLIDER_STEPS
      ? balance
      : MIN_SDGNRS_BURN_WEI
        + ((span * position) / SDGNRS_BURN_SLIDER_STEPS);
    input.value = tokenAmountInput(amount);
    this.#renderSdgnrsBurn();
    this.#refreshSdgnrsBurnQuote();
  }

  #renderSdgnrsBurnQuote() {
    const expected = this.querySelector('[data-bind="df-burn-expected"]');
    const flip = this.querySelector('[data-bind="df-burn-flip-expected"]');
    if (!expected || !flip) return;
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    const amount = parseTokenAmount(input?.value);
    const sameAmount = amount != null && amount === this.#sdgnrsQuoteAmount;

    if (!sameAmount || amount < MIN_SDGNRS_BURN_WEI) {
      expected.textContent = '—';
      flip.textContent = 'Enter at least 1 sDGNRS';
      return;
    }
    if (this.#sdgnrsQuotePending) {
      expected.textContent = 'Calculating…';
      flip.textContent = '';
      return;
    }
    if (!this.#sdgnrsQuote) {
      expected.textContent = 'Unavailable';
      flip.textContent = 'The wallet preview could not be read';
      return;
    }

    const ethFixed = displayEth(this.#sdgnrsQuote.ethOut, 4);
    const eth = ethFixed.includes('.')
      ? ethFixed.replace(/0+$/, '').replace(/\.$/, '')
      : ethFixed;
    expected.textContent = `${eth} ETH`;
    flip.textContent = this.#sdgnrsQuote.flipOut > 0n
      ? `${this.#fmtWhole(this.#sdgnrsQuote.flipOut)} FLIP backing · pays only on a win`
      : 'No contingent FLIP backing';
  }

  #refreshSdgnrsBurnQuote() {
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    const amount = parseTokenAmount(input?.value);
    const balance = this.#sdgnrsBalanceWei();
    const valid = amount != null
      && amount >= MIN_SDGNRS_BURN_WEI
      && balance != null
      && amount <= balance;
    const seq = ++this.#sdgnrsQuoteSeq;
    this.#sdgnrsQuoteAmount = amount;
    this.#sdgnrsQuote = null;
    this.#sdgnrsQuotePending = valid;
    this.#renderSdgnrsBurnQuote();
    if (!valid) return;

    void previewSdgnrsBurn({ amount }).then((quote) => {
      if (!this.#active || seq !== this.#sdgnrsQuoteSeq) return;
      this.#sdgnrsQuote = quote;
      this.#sdgnrsQuotePending = false;
      this.#renderSdgnrsBurnQuote();
    }, () => {
      if (!this.#active || seq !== this.#sdgnrsQuoteSeq) return;
      this.#sdgnrsQuote = null;
      this.#sdgnrsQuotePending = false;
      this.#renderSdgnrsBurnQuote();
    });
  }

  #openSdgnrsBurnDialog() {
    if (!this.#ownsDisplayedSdgnrs()) return;
    const balance = this.#sdgnrsBalanceWei();
    if (balance == null || balance < MIN_SDGNRS_BURN_WEI) return;
    const dialog = this.querySelector('[data-bind="df-burn-dialog"]');
    if (!dialog) return;
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    if (input && (parseTokenAmount(input.value) ?? 0n) > balance) input.value = '1';
    dialog.hidden = false;
    this.#renderSdgnrsBurn();
    this.#refreshSdgnrsBurnQuote();
    try { input?.focus?.({ preventScroll: true }); } catch (_e) { /* headless */ }
  }

  #closeSdgnrsBurnDialog() {
    const dialog = this.querySelector('[data-bind="df-burn-dialog"]');
    if (dialog) dialog.hidden = true;
    const button = this.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    try { button?.focus?.(); } catch (_e) { /* headless */ }
  }

  #shortAddress(address) {
    const value = String(address || '');
    return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  }

  #charityVoteCanSign(state = this.#charityVoteState) {
    const connected = get('connected.address');
    if (!connected || !state || get('ui.mode') !== 'self') return false;
    const viewed = get('viewing.address');
    if (viewed && String(viewed).toLowerCase() !== String(connected).toLowerCase()) return false;
    return this.#asWei(state.votingPower) >= 10n ** 18n;
  }

  #charityWeight(value) {
    try { return BigInt(value ?? 0); }
    catch (_e) { return 0n; }
  }

  #renderCharityVote() {
    const level = this.querySelector('[data-bind="df-charity-level"]');
    const power = this.querySelector('[data-bind="df-charity-power"]');
    const supported = this.querySelector('[data-bind="df-charity-supported"]');
    const refresh = this.querySelector('[data-bind="df-charity-refresh"]');
    const ballot = this.querySelector('[data-bind="df-charity-ballot"]');
    const status = this.querySelector('[data-bind="df-charity-status"]');
    if (!ballot) return;
    ballot.textContent = '';
    ballot.setAttribute('aria-busy', this.#charityVoteLoading ? 'true' : 'false');

    const state = this.#charityVoteState;
    if (level) level.textContent = state == null ? '—' : String(state.level);
    if (power) {
      power.textContent = state == null
        ? (get('connected.address') ? '—' : 'CONNECT WALLET')
        : `${formatSdgnrsBalance(state.votingPower)} sDGNRS`;
    }
    if (supported) {
      const candidates = Array.isArray(state?.candidates) ? state.candidates : [];
      const eligible = candidates.filter((row) => !row.previousWinner).length;
      const voted = candidates.filter((row) => !row.previousWinner && row.voted).length;
      supported.textContent = state == null || !get('connected.address') ? '—' : `${voted} / ${eligible}`;
    }
    if (refresh) {
      refresh.disabled = this.#charityVoteLoading || this.#charityVoteBusySlot != null;
      refresh.textContent = this.#charityVoteLoading ? '↻ REFRESHING…' : '↻ REFRESH';
    }

    if (this.#charityVoteLoading && !state) {
      const loading = document.createElement('div');
      loading.className = 'df-charity-dialog__empty df-charity-dialog__loading';
      const spinner = document.createElement('span');
      spinner.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      copy.textContent = 'Loading the on-chain ballot…';
      loading.appendChild(spinner);
      loading.appendChild(copy);
      ballot.appendChild(loading);
    } else if (!state || !Array.isArray(state.candidates) || state.candidates.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'df-charity-dialog__empty';
      empty.textContent = this.#charityVoteError || 'No charities are active for this level.';
      ballot.appendChild(empty);
    } else {
      const candidates = [...state.candidates].sort((a, b) => {
        if (Boolean(a.previousWinner) !== Boolean(b.previousWinner)) {
          return a.previousWinner ? 1 : -1;
        }
        const aWeight = this.#charityWeight(a.weight);
        const bWeight = this.#charityWeight(b.weight);
        if (aWeight !== bWeight) return aWeight > bWeight ? -1 : 1;
        return Number(a.slot) - Number(b.slot);
      });
      const totalWeight = candidates.reduce(
        (sum, row) => sum + (row.previousWinner ? 0n : this.#charityWeight(row.weight)),
        0n,
      );
      const maxWeight = candidates.reduce((best, row) => {
        const weight = this.#charityWeight(row.weight);
        return !row.previousWinner && weight > best ? weight : best;
      }, 0n);
      const canSign = this.#charityVoteCanSign(state);
      const connected = get('connected.address');
      const viewed = get('viewing.address');
      const ownWallet = get('ui.mode') === 'self' && Boolean(connected)
        && (!viewed || String(viewed).toLowerCase() === String(connected).toLowerCase());
      for (const candidate of candidates) {
        const voteWeight = this.#charityWeight(candidate.weight);
        const shareTenths = !candidate.previousWinner && totalWeight > 0n
          ? Number((voteWeight * 1_000n) / totalWeight)
          : 0;
        const shareText = `${Math.floor(shareTenths / 10)}.${shareTenths % 10}%`;
        const row = document.createElement('article');
        row.className = 'df-charity-candidate';
        if (candidate.previousWinner) row.classList?.add('is-ineligible');
        if (candidate.voted) row.classList?.add('is-voted');
        if (!candidate.previousWinner && maxWeight > 0n && voteWeight === maxWeight) {
          row.classList?.add('is-leading');
        }
        row.setAttribute(
          'aria-label',
          `Charity ${Number(candidate.slot) + 1}, ${formatSdgnrsBalance(voteWeight * (10n ** 18n))} votes, ${shareText}`,
        );

        const slot = document.createElement('span');
        slot.className = 'df-charity-candidate__slot';
        slot.textContent = String(Number(candidate.slot) + 1).padStart(2, '0');
        row.appendChild(slot);

        const identity = document.createElement('span');
        identity.className = 'df-charity-candidate__identity';
        const titleLine = document.createElement('span');
        titleLine.className = 'df-charity-candidate__title';
        const name = document.createElement('strong');
        name.textContent = `CHARITY ${Number(candidate.slot) + 1}`;
        titleLine.appendChild(name);
        if (candidate.previousWinner) {
          const flag = document.createElement('small');
          flag.className = 'df-charity-candidate__flag is-ineligible';
          flag.textContent = 'LAST WINNER';
          titleLine.appendChild(flag);
        } else if (maxWeight > 0n && voteWeight === maxWeight) {
          const flag = document.createElement('small');
          flag.className = 'df-charity-candidate__flag is-leading';
          flag.textContent = 'LEADING';
          titleLine.appendChild(flag);
        } else if (candidate.voted) {
          const flag = document.createElement('small');
          flag.className = 'df-charity-candidate__flag is-voted';
          flag.textContent = 'SUPPORTED';
          titleLine.appendChild(flag);
        }
        identity.appendChild(titleLine);
        const address = document.createElement('a');
        address.textContent = this.#shortAddress(candidate.recipient);
        address.href = `${CHAIN.etherscanBase}/address/${candidate.recipient}`;
        address.target = '_blank';
        address.rel = 'noopener noreferrer';
        address.title = String(candidate.recipient || '');
        identity.appendChild(address);
        const progress = document.createElement('span');
        progress.className = 'df-charity-candidate__progress';
        progress.setAttribute('aria-hidden', 'true');
        const progressFill = document.createElement('span');
        progressFill.style.width = `${shareTenths / 10}%`;
        progress.appendChild(progressFill);
        identity.appendChild(progress);
        row.appendChild(identity);

        const tally = document.createElement('span');
        tally.className = 'df-charity-candidate__tally';
        const tallyValue = document.createElement('strong');
        tallyValue.textContent = formatSdgnrsBalance(voteWeight * (10n ** 18n));
        const tallyLabel = document.createElement('small');
        tallyLabel.textContent = `${shareText} · VOTES`;
        tally.appendChild(tallyValue);
        tally.appendChild(tallyLabel);
        row.appendChild(tally);

        const vote = document.createElement('button');
        vote.type = 'button';
        vote.className = 'df-charity-candidate__vote';
        vote.setAttribute('data-bind', `df-charity-vote-slot-${candidate.slot}`);
        vote.setAttribute('data-write', '');
        const busy = this.#charityVoteBusySlot === Number(candidate.slot);
        if (busy) vote.textContent = 'VOTING…';
        else if (candidate.previousWinner) vote.textContent = 'SITS OUT';
        else if (candidate.voted) vote.textContent = 'SUPPORTED ✓';
        else if (!connected) vote.textContent = 'CONNECT';
        else if (!ownWallet) vote.textContent = 'OWN WALLET';
        else if (!canSign) vote.textContent = 'NO POWER';
        else vote.textContent = '+ SUPPORT';
        vote.disabled = busy || this.#charityVoteBusySlot != null
          || candidate.previousWinner || candidate.voted || !canSign;
        vote.addEventListener('click', () => this.#castCharityVote(candidate.slot));
        row.appendChild(vote);
        ballot.appendChild(row);
      }
    }

    if (status) {
      const message = this.#charityVoteError
        || this.#charityVoteMessage
        || (this.#charityVoteLoading && state ? 'Refreshing on-chain totals…' : '');
      status.hidden = !message;
      status.textContent = message;
      status.classList?.toggle('is-error', Boolean(this.#charityVoteError));
    }
  }

  async #loadCharityVote() {
    const seq = ++this.#charityVoteSeq;
    this.#charityVoteLoading = true;
    this.#charityVoteError = '';
    this.#renderCharityVote();
    try {
      const state = await readCharityVoteState({ voter: get('connected.address') || null });
      if (!this.#active || seq !== this.#charityVoteSeq) return;
      this.#charityVoteState = state;
    } catch (error) {
      if (!this.#active || seq !== this.#charityVoteSeq) return;
      this.#charityVoteError = compactUiError(error, 'The charity ballot could not be loaded.');
    } finally {
      if (seq === this.#charityVoteSeq) {
        this.#charityVoteLoading = false;
        this.#renderCharityVote();
      }
    }
  }

  #openCharityVoteDialog() {
    const dialog = this.querySelector('[data-bind="df-charity-dialog"]');
    if (!dialog) return;
    dialog.hidden = false;
    this.#charityVoteState = null;
    this.#charityVoteMessage = '';
    this.#charityVoteError = '';
    this.#loadCharityVote();
    try { dialog.querySelector('[data-bind="df-charity-close"]')?.focus?.({ preventScroll: true }); }
    catch (_e) { /* headless */ }
  }

  #closeCharityVoteDialog() {
    this.#charityVoteSeq += 1;
    const dialog = this.querySelector('[data-bind="df-charity-dialog"]');
    if (dialog) dialog.hidden = true;
    this.#charityVoteLoading = false;
    this.#charityVoteBusySlot = null;
    const button = this.querySelector('[data-bind="df-charity-vote-cta"]');
    try { button?.focus?.(); } catch (_e) { /* headless */ }
  }

  async #castCharityVote(slot) {
    if (this.#charityVoteBusySlot != null) return;
    const slotNumber = Number(slot);
    const seq = ++this.#charityVoteSeq;
    this.#charityVoteBusySlot = slotNumber;
    this.#charityVoteMessage = '';
    this.#charityVoteError = '';
    this.#renderCharityVote();
    try {
      await voteForCharity({ slot: slotNumber });
      if (!this.#active || seq !== this.#charityVoteSeq) return;
      if (this.#charityVoteState) {
        const wholePower = this.#asWei(this.#charityVoteState.votingPower) / (10n ** 18n);
        this.#charityVoteState = {
          ...this.#charityVoteState,
          candidates: this.#charityVoteState.candidates.map((candidate) => (
            Number(candidate.slot) === slotNumber
              ? { ...candidate, voted: true, weight: this.#charityWeight(candidate.weight) + wholePower }
              : candidate
          )),
        };
      }
      this.#charityVoteMessage = `Support recorded for Charity ${slotNumber + 1}.`;
      this.#renderCharityVote();
      try {
        const state = await readCharityVoteState({ voter: get('connected.address') || null });
        if (!this.#active || seq !== this.#charityVoteSeq) return;
        this.#charityVoteState = state;
      } catch (_refreshError) {
        if (!this.#active || seq !== this.#charityVoteSeq) return;
        this.#charityVoteMessage = `Support recorded for Charity ${slotNumber + 1}. Refresh to update the ranking.`;
      }
    } catch (error) {
      if (!this.#active || seq !== this.#charityVoteSeq) return;
      this.#charityVoteError = compactUiError(error, 'Charity vote failed.');
    } finally {
      if (seq !== this.#charityVoteSeq) return;
      this.#charityVoteBusySlot = null;
      this.#renderCharityVote();
    }
  }

  #setMaxSdgnrsBurn() {
    const balance = this.#sdgnrsBalanceWei();
    const input = this.querySelector('[name="df-sdgnrs-amount"]');
    if (!input || balance == null) return;
    input.value = tokenAmountInput(balance);
    this.#renderSdgnrsBurn();
    this.#refreshSdgnrsBurnQuote();
  }

  #appendReverseCta(zone, animation = null) {
    if (!zone) return null;
    const reverse = document.createElement('button');
    reverse.type = 'button';
    reverse.className = 'df-reversi-card';
    reverse.setAttribute('data-bind', 'df-reverse-cta');
    reverse.setAttribute('aria-haspopup', 'dialog');
    reverse.setAttribute('aria-label', 'Explain Reverse Flip');
    const reverseArt = document.createElement('img');
    reverseArt.className = 'df-reversi-card__art';
    reverseArt.src = '/shared/reverse-flip-card.svg';
    reverseArt.alt = '';
    reverse.appendChild(reverseArt);
    if (animation) {
      reverse.classList.add('df-reversi-card--live-tap');
      reverse.disabled = true;
      if (reverse.style && typeof reverse.style.setProperty === 'function') {
        reverse.style.setProperty('--df-live-reverse-duration', `${LIVE_REVERSE_TOTAL_MS}ms`);
      }
      this.#styleReverseCardForQueued(reverse, animation.fromQueued);
      reverse.setAttribute('aria-label', 'Reverse Flip changing the current side');
    }
    reverse.addEventListener('click', () => this.#openReverseDialog());
    zone.appendChild(reverse);
    return reverse;
  }

  #appendSpinningCoin(zone, {
    resolving = false,
    disabled = false,
    reverseQueued = null,
    resolutionLocked = false,
  } = {}) {
    const renderedDay = this.#day;
    let queued = null;
    try {
      if (reverseQueued != null) queued = BigInt(reverseQueued);
    } catch (_e) { /* unavailable/corrupt quotes keep the neutral face */ }
    const queuedSideIsEth = queued != null && (queued & 1n) === 1n;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `df-coin df-coin--spinning${resolving ? ' df-coin--resolving' : ''}${disabled ? ' df-coin--syncing' : ''}${resolutionLocked ? ' df-coin--resolution-locked' : ''}${queuedSideIsEth ? ' df-coin--queued-eth' : ''}`;
    btn.disabled = Boolean(disabled);
    if (resolving && queued != null) {
      btn.setAttribute('data-reverse-flips', String(queued));
      btn.setAttribute('data-current-side', queuedSideIsEth ? 'eth' : 'wwxrp');
    }
    const queuedSideLabel = resolving && queued != null
      ? ` ${queued} Reverse Flip${queued === 1n ? '' : 's'} queued; current side ${queuedSideIsEth ? 'ETH' : 'WWXRP'}.`
      : '';
    btn.setAttribute(
      'aria-label',
      disabled
        ? `Daily jackpot and Community Coinflip are syncing.${queuedSideLabel}`
        : resolving
        ? `Community Coinflip is resolving — click to reveal when ready.${queuedSideLabel}`
        : 'Reveal the Community Coinflip result',
    );
    const inner = document.createElement('span');
    inner.className = 'df-coin3d__inner';
    appendCoinFaces(inner, { initialSide: queuedSideIsEth ? 'eth' : 'red' });
    btn.appendChild(inner);
    // Capture the rendered day. A detached previous-day button must never
    // queue or reveal whichever day the component has since adopted.
    btn.addEventListener('click', () => this.#onCoinClick(renderedDay));
    zone.appendChild(btn);
    return btn;
  }

  #renderCoin() {
    const zone = this.querySelector('[data-bind="df-coin-zone"]');
    const outcome = this.querySelector('[data-bind="df-outcome"]');
    const revealHint = this.querySelector('[data-bind="df-reveal-hint"]');
    if (!zone) return;

    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;

    // Mid-landing: the deceleration animation is running on the existing
    // DOM — do NOT rebuild the zone out from under it. (#onCoinClick
    // already hid the reveal button.)
    if (this.#landing) return;
    if (this.#liveReverseAnimation && zone.querySelector('.df-coin--live-reverse')) return;

    zone.textContent = '';
    // The coin itself is the reveal control; this left-side cue must never add
    // a helper-text row beneath the coin or remain after an early click queues it.
    if (revealHint) {
      const queued = this.#revealRequestedDay === this.#day;
      revealHint.hidden = this.#day == null || this.#revealed() || queued
        || !this.#dayAvailabilityReady();
    }

    if (!this.#dayAvailabilityReady()) {
      if (outcome) outcome.textContent = '';
      if (this.#day != null && !this.#revealed()) {
        this.#appendSpinningCoin(zone, {
          resolving: true,
          disabled: true,
          reverseQueued: this.#resolvingReverseQueued(),
          resolutionLocked: this.#rngRequestStarted(this.#activeDaySync())
            || Boolean(this.#reverseFlipQuote?.locked),
        });
      }
      return;
    }

    if (!hasResult) {
      if (outcome) outcome.textContent = '';
      // At rollover the jackpot payload generally arrives a few blocks before
      // the dedicated result read. Keep the neutral two-faced coin mounted and
      // clickable during that gap; a click queues the reveal for the exact day.
      if (this.#day != null && !this.#revealed()) {
        this.#appendSpinningCoin(zone, {
          resolving: true,
          reverseQueued: this.#resolvingReverseQueued(),
          resolutionLocked: Boolean(this.#reverseFlipQuote?.locked),
        });
      }
      return;
    }

    const won = Boolean(this.#flipResult.win);
    if (!this.#revealed()) {
      // CSS-3D two-faced coin: front = red WWXRP face, back = green ETH
      // face. Idles on a continuous rotateX loop; #onCoinClick swaps the
      // animation to a decelerating df-land-* that FINISHES on the day's
      // face (whole turns → red front; +half turn → ETH back).
      this.#appendSpinningCoin(zone);
      // Reverse Flip affects the next unresolved outcome, so it becomes
      // available only after this visible coin has completed its local reveal.
      // Do not park the card beside a still-spinning result and visually spoil
      // the full animation before the player even starts it.
      if (outcome) {
        outcome.textContent = '';
        outcome.className = 'df-outcome';
      }
    } else {
      const animation = this.#liveReverseAnimation;
      const visibleQueued = animation?.fromQueued
        ?? this.#reverseVisualQueued
        ?? this.#reverseFlipQuote?.queued;
      const showLiveSide = !this.#resultTruthWindowActive()
        && (this.#showLiveSideOnCoin || animation != null)
        && visibleQueued != null;
      const faceIsEth = showLiveSide
        ? (visibleQueued & 1n) === 1n
        : won;
      const face = document.createElement('div');
      face.className = 'df-coin df-coin--landed';
      if (animation) face.classList.add('df-coin--live-reverse');
      if (showLiveSide) {
        face.classList.add('df-coin--current-side');
        face.setAttribute('data-current-side', faceIsEth ? 'eth' : 'wwxrp');
      }
      const img = document.createElement('img');
      img.src = faceIsEth ? '/shared/coinflip-face-eth.svg' : '/shared/coinflip-face-red.svg';
      img.alt = showLiveSide
        ? (faceIsEth ? 'Current side — ETH (odd)' : 'Current side — WWXRP (even)')
        : (won ? 'Green ETH face — win' : 'Red face — loss');
      face.appendChild(img);
      zone.appendChild(face);
      // Reverse Flip is a post-result move. Its card sits beside the landed
      // coin and only opens the explanation; the write is gated behind the
      // dialog's explicit Accept button.
      if (animation || !this.#reverseCardRevealHoldActive()) {
        this.#appendReverseCta(zone, animation);
      }
      if (outcome) {
        // The resolved receipt now lives in Today's Bet for both outcomes.
        // Keep this line available only for transient/loading copy so a result
        // is never duplicated elsewhere in the widget.
        outcome.textContent = '';
        outcome.className = 'df-outcome';
      }
    }
  }

  #renderModifierMeter() {
    const host = this.querySelector('[data-bind="df-modifier-meter-slot"]');
    if (!host) return;

    const appendPipBank = (parent, variant, pipClassName) => {
      const bank = document.createElement('span');
      bank.className = `df-modifier-meter__pip-bank df-modifier-meter__pip-bank--${variant}`;
      bank.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < COINFLIP_RECENT_WINDOW; index += 1) {
        const pip = document.createElement('span');
        pip.className = `df-coinflip-record__mark ${pipClassName}`;
        pip.setAttribute('aria-hidden', 'true');
        bank.appendChild(pip);
      }
      parent.appendChild(bank);
      return bank;
    };
    const createTrack = () => {
      const track = document.createElement('div');
      track.className = 'df-modifier-meter__track';
      appendPipBank(track, 'idle', 'is-empty');
      return track;
    };
    const renderIdleTrack = () => {
      host.textContent = '';
      const track = createTrack();
      track.classList.add('df-modifier-meter__track--idle');
      host.appendChild(track);
    };

    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    if (!hasResult) {
      renderIdleTrack();
      return;
    }
    const won = Boolean(this.#flipResult.win);
    const revealComplete = this.#revealed() && !this.#landing;
    // The thermometer presents the day-wide result, not the player's payout.
    // It therefore runs on a global win even when this wallet had NO BET.
    // During a reversal sequence, the scanner follows any apparent green face
    // that has another card pending; this does not reveal which face is final.
    const showWinningMeter = won
      && revealComplete
      && (this.#meterSettling || this.#winningReceiptCommitted);
    const showFakeoutMeter = this.#landing
      && this.#fakeoutMeterVisible;
    if (!showWinningMeter && !showFakeoutMeter) {
      renderIdleTrack();
      return;
    }

    const rawPct = Number(this.#flipResult.rewardPercent || 0);
    const displayPct = showFakeoutMeter
      && !won
      && rawPct < MODIFIER_MIN_PERCENT
      ? fakeoutModifierPercent(this.#day)
      : rawPct;
    const pct = Math.max(
      MODIFIER_MIN_PERCENT,
      Math.min(MODIFIER_MAX_PERCENT, displayPct),
    );
    const totalPct = 100 + pct;
    const position = dailyFlipMeterPosition(totalPct);
    const stopHeight = dailyFlipMeterStopHeight(totalPct);
    const numberTone = dailyFlipMultiplierTone(totalPct);

    const meterStateClass = this.#landing
      ? `df-modifier-meter ${this.#fakeoutMeterRebounding
        ? 'df-modifier-meter--rebounding'
        : this.#fakeoutMeterTerminalDraining
          ? 'df-modifier-meter--terminal-draining'
          : this.#fakeoutMeterDraining
          ? 'df-modifier-meter--draining'
          : 'df-modifier-meter--settled df-modifier-meter--settling'}`
      : `df-modifier-meter df-modifier-meter--settled${
        this.#meterSettling
          ? (this.#meterRecoveryTail
            ? ' df-modifier-meter--recovery-tail'
            : ' df-modifier-meter--settling')
          : ''
      }`;
    const meterClass = `${meterStateClass}${
      numberTone ? ` df-modifier-meter--tone-${numberTone}` : ''
    }`;
    const displayKey = `${this.#day}:${totalPct}:${meterClass}:${this.#meterFlashVisible ? 'flash' : 'steady'}`;
    const current = host.querySelector('.df-modifier-meter');
    // Live refreshes can arrive during the 1.6-second sweep. Preserve the
    // mounted marker so those renders cannot restart its CSS animation while
    // the completion cue keeps the original deadline.
    if (current?.getAttribute('data-meter-key') === displayKey) return;
    host.textContent = '';
    const meter = document.createElement('div');
    meter.className = meterClass;
    meter.setAttribute('data-meter-key', displayKey);
    if (meter.style && typeof meter.style.setProperty === 'function') {
      meter.style.setProperty(
        '--df-meter-settle-duration',
        `${this.#landing ? METER_FAKEOUT_SETTLE_MS : METER_SETTLE_MS}ms`,
      );
      meter.style.setProperty('--df-meter-rebound-duration', `${METER_REBOUND_MS}ms`);
      meter.style.setProperty('--df-meter-recovery-tail-duration', `${METER_RECOVERY_TAIL_MS}ms`);
      meter.style.setProperty('--df-meter-terminal-drain-duration', `${METER_TERMINAL_DRAIN_MS}ms`);
      // Precompute the bounce points in JS instead of relying on nested CSS
      // min()/max() custom-property math. This keeps the rare triple-Reverse
      // handoff reliable in every browser and gives it a real full-rail loop.
      meter.style.setProperty('--df-meter-handoff', `${Math.min(96, position + 14)}%`);
      meter.style.setProperty('--df-meter-low', `${Math.max(4, position - 6)}%`);
      meter.style.setProperty('--df-meter-bounce', `${Math.min(96, position + 3)}%`);
    }
    meter.setAttribute('role', 'img');
    meter.setAttribute(
      'aria-label',
      this.#landing
        ? (this.#fakeoutMeterRebounding
          ? `Win multiplier rebounding from minimum to ${totalPct} percent`
          : this.#fakeoutMeterDraining
            ? 'Win multiplier falling to minimum'
            : `Win multiplier stopped at ${totalPct} percent`)
        : (this.#meterRecoveryTail
          ? `Win multiplier recovering to ${totalPct} percent`
          : `Win multiplier stopped at ${totalPct} percent`),
    );

    const track = createTrack();
    const marker = document.createElement('span');
    marker.className = 'df-modifier-meter__marker';
    marker.setAttribute('data-bind', 'df-modifier-marker');
    marker.style.height = stopHeight;
    if (marker.style && typeof marker.style.setProperty === 'function') {
      marker.style.setProperty('--df-meter-stop', stopHeight);
    }
    const pipToneClass = numberTone === 'low'
      ? 'is-win is-roll-150'
      : (numberTone === 'high' ? 'is-win is-roll-250' : 'is-win');
    appendPipBank(marker, 'fill', pipToneClass);
    appendPipBank(marker, 'peak', 'is-win is-roll-250');
    track.appendChild(marker);
    meter.appendChild(track);
    host.appendChild(meter);
    if (showWinningMeter && this.#meterFlashVisible) {
      const flash = document.createElement('div');
      flash.className = [
        'df-modifier-flash',
        numberTone ? `df-modifier-flash--${numberTone}` : '',
      ].filter(Boolean).join(' ');
      flash.textContent = `${totalPct}%`;
      flash.setAttribute('role', 'status');
      flash.setAttribute('aria-label', `${totalPct} percent total win multiplier`);
      host.appendChild(flash);
    }
  }

  // Whole-FLIP with thousands separators (mirrors app-balances-strip).
  #fmtWhole(weiStr) {
    const whole = displayToken(BigInt(weiStr || '0'), 0);
    const n = Number(whole);
    return Number.isSafeInteger(n) ? n.toLocaleString('en-US') : whole;
  }

  #fmtSdgnrs(weiStr) {
    return formatSdgnrsBalance(weiStr);
  }

  #asWei(value) {
    try { return BigInt(value || '0'); } catch (_e) { return 0n; }
  }

  #activeSettlement() {
    const state = this.#settlementState;
    if (!state || String(state.day) !== String(this.#day)) return null;
    if (state.address && state.address !== this.#dashboardAddress) return null;
    return state;
  }

  #resultStakeWei() {
    const rolloverCarry = this.#rolloverCarryStakeWei();
    // During the clock→RNG gap the coin still belongs to #day, but the felt's
    // Today ledger has already advanced. That newer carry must outrank the old
    // coin day's settlement until full day adoption catches up.
    if (this.#rolloverBetCarry?.day !== Number(this.#day) && rolloverCarry != null) {
      return rolloverCarry;
    }
    const settlement = this.#activeSettlement();
    return settlement?.betWei
      ?? this.#resolvedBetWei
      ?? rolloverCarry
      ?? null;
  }

  /**
   * The staged bet locks the moment the day ticks over, so the carried stake
   * IS today's bet: deal its chips at the tick instead of holding the loading
   * dash until the resolved-stake read lands with the same number. Auto-rebuy
   * top-ups still arrive with that read.
   */
  #rolloverCarryStakeWei() {
    const carry = this.#rolloverBetCarry;
    if (!carry) return null;
    if (carry.address !== this.#dashboardAddress) return null;
    const coinDay = Number(this.#day);
    const clockDay = Number(this.#daySync?.day);
    if (carry.day !== coinDay
      && !(carry.day === clockDay && carry.day === coinDay + 1)) return null;
    return carry.wei;
  }

  #winPayoutWei(stakeWei, rewardPercent) {
    const stake = this.#asWei(stakeWei);
    const pct = BigInt(Math.max(0, Math.trunc(Number(rewardPercent) || 0)));
    return stake + ((stake * pct) / 100n);
  }

  #settlementGainWei(settlement) {
    if (!settlement?.won) return 0n;
    const pct = this.#flipResult?.rewardPercent ?? settlement.rewardPercent;
    return this.#winPayoutWei(settlement.betWei, pct);
  }

  #pendingBafCreditWei() {
    const storedRaw = this.#dashboard?.coinflip?.claimablePreview;
    if (storedRaw == null || this.#liveClaimableWei == null) return null;
    const stored = this.#asWei(storedRaw);
    return this.#liveClaimableWei > stored
      ? this.#liveClaimableWei - stored
      : 0n;
  }

  #visibleClaimableWei() {
    const indexed = this.#asWei(this.#dashboard?.coinflip?.claimablePreview);
    const settlement = this.#activeSettlement();
    let visible = this.#liveClaimableWei == null ? indexed : this.#liveClaimableWei;
    if (!settlement) return visible;
    // A complete snapshot at/after a confirmed transaction is newer than the
    // reveal receipt and the indexer. In particular, a claim moves this value
    // into wallet FLIP; retaining the old optimistic floor would double-count
    // it in Protocol Coins and leave CLAIM enabled for an empty ledger.
    if (settlement.claimableFloorRetired && this.#liveClaimableWei != null) {
      return this.#liveClaimableWei;
    }
    const settledTotal = settlement.claimableTotalWei == null
      ? settlement.claimableBaseWei + this.#settlementGainWei(settlement)
      : this.#asWei(settlement.claimableTotalWei);
    if (indexed > visible) visible = indexed;
    return settledTotal > visible ? settledTotal : visible;
  }

  #ensureResolvedFlipBonus(day, rewardPercent) {
    const normalizedDay = Number(day);
    const normalizedReward = Number(rewardPercent);
    if (!Number.isInteger(normalizedDay) || normalizedDay <= 0
      || !Number.isInteger(normalizedReward) || normalizedReward < 0) {
      this.#resolvedFlipBonus = null;
      return;
    }
    const key = `${normalizedDay}:${normalizedReward}`;
    if (this.#resolvedFlipBonus?.key === key) return;

    const pending = { key, points: null, pending: true };
    this.#resolvedFlipBonus = pending;
    Promise.resolve(readResolvedFlipBonus({
      day: normalizedDay,
      rewardPercent: normalizedReward,
    })).then(
      (value) => {
        if (this.#resolvedFlipBonus !== pending) return;
        const points = Number(value?.points);
        this.#resolvedFlipBonus = {
          key,
          points: points === 0 || points === 2 || points === 6 ? points : null,
          pending: false,
        };
        if (this.#active) this.#renderPosition();
      },
      () => {
        if (this.#resolvedFlipBonus !== pending) return;
        this.#resolvedFlipBonus = { key, points: null, pending: false };
        if (this.#active) this.#renderPosition();
      },
    );
  }

  #renderPosition() {
    const host = this.querySelector('[data-bind="df-position"]');
    if (!host) return;
    // Keep both day buckets mounted so a result never replaces one amount with
    // a different day's amount. Today becomes the one resolved receipt;
    // the live next-day stake remains safe to show beside its Add Bet controls.
    const clockCarryPending = this.#rolloverBetCarry?.day !== Number(this.#day)
      && this.#rolloverCarryStakeWei() != null;
    const hasResult = !clockCarryPending
      && this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    // A winning result is not visually committed until the thermometer reaches
    // its number. Its landing sound fires in that same completion task, so the
    // Today row cannot turn green ahead of either cue.
    const revealComplete = hasResult
      && this.#revealed()
      && !this.#landing
      && (!Boolean(this.#flipResult?.win) || this.#winningReceiptCommitted);
    const resolvedStake = this.#resultStakeWei();
    const won = Boolean(this.#flipResult?.win);
    const modifier = Math.max(0, Math.trunc(Number(this.#flipResult?.rewardPercent) || 0));
    this.#ensureResolvedFlipBonus(hasResult && won ? this.#day : null, modifier);
    const totalMultiplier = 100 + modifier;
    // The stake is not an outcome spoiler: show the exact committed amount
    // while the coin is waiting to be revealed, then replace that same value
    // with its settled receipt. A zero stake is equally safe and clearer as an
    // immediate NO BET in the blue chip field than as a concealed placeholder.
    const noBet = resolvedStake != null && this.#asWei(resolvedStake) === 0n;
    // Release is only meaningful while the presented day IS the clock's day.
    // In the clock→RNG gap, on a cold load, or on a tab waking after the
    // boundary, the gates below would consult the PREVIOUS day's already-
    // revealed markers and release the next-day stake — which is exactly
    // where the jackpot's FLIP additions land — before THIS day's jackpot
    // has been watched.
    const clockDay = Number(this.#daySync?.day);
    const dayInSync = this.#day != null
      && (!Number.isInteger(clockDay) || clockDay === Number(this.#day));
    const hiddenBonusSpinWei = unrevealedBonusSpinFlipWei({
      payload: get('app.lastDay'),
      player: this.#dashboardAddress,
      day: this.#day,
      revealed: this.#bonusJackpotCleared(),
    });
    let spoilerSafeCurrentBetWei = null;
    let bonusSpinAmountKnown = hiddenBonusSpinWei != null;
    if (this.#currentBetWei != null && bonusSpinAmountKnown) {
      const currentBetWei = this.#asWei(this.#currentBetWei);
      if (currentBetWei >= hiddenBonusSpinWei) {
        spoilerSafeCurrentBetWei = currentBetWei - hiddenBonusSpinWei;
        // A Roll-2 row can reach the composed API just ahead of a stale RPC
        // snapshot. Never let subtracting that not-yet-observed credit make a
        // monotonic stake appear to decrease; wait for the next chain read.
        if (hiddenBonusSpinWei > 0n) {
          const priorSafeWei = heldBalanceValue({
            namespace: `coinflip-tomorrow:${CHAIN.id}`,
            scope: this.#dashboardAddress,
            value: null,
            released: false,
          });
          if (priorSafeWei != null && spoilerSafeCurrentBetWei < priorSafeWei) {
            spoilerSafeCurrentBetWei = null;
            bonusSpinAmountKnown = false;
          }
        }
      } else {
        bonusSpinAmountKnown = false;
      }
    }
    const tomorrowReleased = dayInSync
      && bonusSpinAmountKnown
      && this.#tomorrowRewardGateOpen()
      && this.#tomorrowAutoRebuyGateOpen(hasResult);
    // Hide only the exact bonus-spin credit, so direct deposits remain live.
    // Unknown fragments, auto-rebuy, and lootbox rewards retain the last safe
    // stake. A cold load without one uses the ordinary em dash.
    const displayedTomorrowWei = heldBalanceValue({
      namespace: `coinflip-tomorrow:${CHAIN.id}`,
      scope: this.#dashboardAddress,
      value: spoilerSafeCurrentBetWei,
      released: tomorrowReleased,
    });
    const tomorrowKnown = displayedTomorrowWei != null;
    const tomorrowHeld = !tomorrowReleased;
    const positionsShifted = revealComplete && this.#betPositionsShifted();
    const promotedNoBet = tomorrowKnown && this.#asWei(displayedTomorrowWei) === 0n;
    if (positionsShifted) {
      // The next live stake takes over the large chip spot. The settled stake
      // leaves its existing signed receipt in Yesterday's fixed lower oval.
      this.#renderTodayBetOval(displayedTomorrowWei);
      this.#renderTomorrowBetOval(resolvedStake, resolvedStake != null, false, 'Yesterday');
    } else {
      this.#renderTodayBetOval(
        resolvedStake,
        revealComplete && !won && !noBet ? 'lost' : 'stake',
        revealComplete && won && !noBet
          ? this.#winPayoutWei(resolvedStake, modifier)
          : null,
      );
      this.#renderTomorrowBetOval(displayedTomorrowWei, tomorrowKnown, tomorrowHeld);
    }
    const upcomingBonusPoints = Number(this.#upcomingFlipBonus?.points);
    const upcomingBonusVisible = this.#browsingDay == null
      && (upcomingBonusPoints === 2 || upcomingBonusPoints === 6);
    const todaySurface = this.querySelector('[data-bind="df-today-bet-cta"]');
    const lowerSurface = this.querySelector('[data-bind="df-flip-cta"]');
    const todayLabel = this.querySelector('[data-bind="df-today-felt-label"]');
    const lowerLabel = this.querySelector('[data-bind="df-lower-felt-label"]');
    const todayAddCue = this.querySelector('[data-bind="df-today-add-cue"]');
    const tomorrowAddCue = this.querySelector('[data-bind="df-tomorrow-add-cue"]');
    const lowerOval = this.querySelector('[data-bind="df-tomorrow-bet-oval"]');
    const todayActionable = revealComplete && this.#browsingDay == null;
    const addBetDialog = this.querySelector('[data-bind="df-add-bet-dialog"]');
    const dialogOpen = addBetDialog != null && !addBetDialog.hidden;
    const yesterdayReceiptLabel = !positionsShifted
      ? null
      : resolvedStake == null
        ? "Yesterday's result is unavailable"
        : noBet
          ? "Yesterday's bet: no bet"
          : won
            ? `Yesterday's bet won ${this.#fmtWhole(this.#winPayoutWei(resolvedStake, modifier))} FLIP`
            : `Yesterday's bet lost ${this.#fmtWhole(resolvedStake)} FLIP`;
    host.classList?.toggle('is-day-shifted', positionsShifted);
    todaySurface?.classList?.toggle('is-actionable', todayActionable);
    todaySurface?.classList?.toggle('is-add-bet', positionsShifted);
    lowerSurface?.classList?.toggle('is-yesterday', positionsShifted);
    if (todayLabel) todayLabel.textContent = "TODAY'S BET";
    if (lowerLabel) lowerLabel.textContent = positionsShifted ? "YESTERDAY'S BET" : "TOMORROW'S BET";
    // The whole promoted Today spot remains the Add Bet target, but its plus is
    // only empty-state paint. Keeping it above a real stack made the glyph show
    // through gaps between translucent chips and read as part of the wager.
    if (todayAddCue) todayAddCue.hidden = !(positionsShifted && promotedNoBet);
    if (tomorrowAddCue) tomorrowAddCue.hidden = positionsShifted;
    if (lowerOval) {
      if (positionsShifted) {
        lowerOval.setAttribute('data-yesterday-outcome', noBet ? 'no-bet' : won ? 'win' : 'loss');
        lowerOval.setAttribute('aria-label', yesterdayReceiptLabel);
      } else {
        lowerOval.removeAttribute('data-yesterday-outcome');
      }
    }
    if (todaySurface) {
      todaySurface.setAttribute('role', todayActionable ? 'button' : 'img');
      todaySurface.setAttribute('tabindex', todayActionable ? '0' : '-1');
      todaySurface.setAttribute(
        'aria-label',
        positionsShifted
          ? "Add FLIP to today's bet"
          : todayActionable
            ? "Today's result. Activate to move the live bet into Today."
            : this.querySelector('[data-bind="df-bet-oval"]')?.getAttribute('aria-label')
              || "Today's bet",
      );
      todaySurface.setAttribute('aria-expanded', String(positionsShifted && dialogOpen));
      if (positionsShifted) {
        todaySurface.setAttribute('aria-haspopup', 'dialog');
        todaySurface.setAttribute('aria-controls', 'df-add-bet-dialog');
      } else {
        todaySurface.removeAttribute('aria-haspopup');
        todaySurface.removeAttribute('aria-controls');
      }
    }
    if (lowerSurface) {
      lowerSurface.setAttribute('role', positionsShifted ? 'img' : 'button');
      lowerSurface.setAttribute('tabindex', positionsShifted ? '-1' : '0');
      lowerSurface.setAttribute('aria-expanded', String(!positionsShifted && dialogOpen));
      lowerSurface.setAttribute(
        'aria-label',
        positionsShifted ? yesterdayReceiptLabel : "Add FLIP to tomorrow's bet",
      );
      lowerSurface.setAttribute(
        'title',
        positionsShifted ? yesterdayReceiptLabel : "Add FLIP to tomorrow's bet",
      );
      if (positionsShifted) lowerSurface.setAttribute('aria-disabled', 'true');
      else lowerSurface.removeAttribute('aria-disabled');
    }
    const todayFeltBonus = this.querySelector('[data-bind="df-today-felt-bonus"]');
    const tomorrowFeltBonus = this.querySelector('[data-bind="df-tomorrow-felt-bonus"]');
    if (todayFeltBonus) {
      todayFeltBonus.textContent = positionsShifted && upcomingBonusVisible
        ? `+${upcomingBonusPoints}% BONUS`
        : '';
      todayFeltBonus.hidden = !(positionsShifted && upcomingBonusVisible);
    }
    if (tomorrowFeltBonus) {
      tomorrowFeltBonus.textContent = !positionsShifted && upcomingBonusVisible
        ? `+${upcomingBonusPoints}% BONUS`
        : '';
      tomorrowFeltBonus.hidden = positionsShifted || !upcomingBonusVisible;
    }
    const resolvedBonusPoints = Number(this.#resolvedFlipBonus?.points);
    const resolvedBonusVisible = revealComplete
      && won
      && (resolvedBonusPoints === 2 || resolvedBonusPoints === 6);
    const resolvedRow = {
      key: 'today',
      label: "Today's bet",
      value: resolvedStake == null
        ? '—'
        : noBet
          ? ''
          : revealComplete
            ? won
              ? `+${formatTomorrowBet(this.#winPayoutWei(resolvedStake, modifier))}`
              : `-${formatTomorrowBet(resolvedStake)}`
            : coinflipAmountLabel(resolvedStake),
      status: resolvedStake == null || !revealComplete || noBet
        ? null
        : won
          ? {
            outcome: 'WIN',
            percent: `${totalMultiplier}%`,
            percentTone: dailyFlipMultiplierTone(totalMultiplier),
            bonusPoints: resolvedBonusVisible ? resolvedBonusPoints : null,
          }
          : { outcome: 'LOSS', percent: null },
      outcome: noBet ? 'no-bet' : revealComplete ? (won ? 'win' : 'loss') : null,
    };
    const liveRow = {
      key: 'tomorrow',
      label: "Tomorrow's bet",
      number: !tomorrowKnown
        ? '—'
        : formatTomorrowBet(displayedTomorrowWei),
      unit: tomorrowKnown
        && formatTomorrowBet(displayedTomorrowWei).length <= 7
        ? 'FLIP'
        : '',
      held: tomorrowHeld,
      upcoming: true,
    };
    const rows = positionsShifted
      ? [
          {
            key: 'today',
            label: "Today's bet",
            value: !tomorrowKnown
              ? '—'
              : promotedNoBet ? '' : coinflipAmountLabel(displayedTomorrowWei),
            outcome: promotedNoBet ? 'no-bet' : null,
            held: tomorrowHeld,
            upcoming: true,
          },
          { ...resolvedRow, key: 'tomorrow', label: "Yesterday's bet" },
        ]
      : [resolvedRow, liveRow];
    for (const item of rows) {
      const slot = this.querySelector(`[data-bind="df-position-${item.key}"]`);
      if (!slot) continue;
      slot.textContent = '';
      const rowBonusPoints = Number(item.status?.bonusPoints);
      const rowHasResultBonus = rowBonusPoints === 2 || rowBonusPoints === 6;
      const row = document.createElement('div');
      row.className = [
        'df-position-row',
        item.outcome ? `df-position-row--${item.outcome}` : '',
        rowHasResultBonus ? 'df-position-row--result-bonus' : '',
      ].filter(Boolean).join(' ');
      row.setAttribute('data-position', item.key);
      if (item.held) row.setAttribute('data-balance-held', 'true');
      const l = document.createElement('span');
      l.className = 'df-position-label';
      if (item.upcoming === true && upcomingBonusVisible) {
        const bonus = document.createElement('span');
        bonus.className = 'df-position-bonus';
        bonus.setAttribute('data-bind', 'df-bonus-flip');
        bonus.setAttribute('role', 'status');
        bonus.dataset.tier = upcomingBonusPoints === 6 ? 'x0' : 'standard';
        bonus.setAttribute(
          'aria-label',
          `${item.label} receives a ${upcomingBonusPoints} percent bonus.`,
        );
        bonus.textContent = `+${upcomingBonusPoints}% BONUS`;
        l.appendChild(bonus);
        const copy = document.createElement('span');
        copy.className = 'df-position-label__copy';
        copy.textContent = item.label;
        l.appendChild(copy);
      } else {
        l.textContent = item.label;
      }
      // Every ledger instrument uses the same hierarchy. Once the day is
      // shifted, this same renderer paints the live amount in Today and the
      // immutable result in Yesterday without reinterpreting either value.
      row.appendChild(l);
      if (item.status != null) {
        if (rowHasResultBonus) {
          const bonus = document.createElement('span');
          bonus.className = 'df-position-bonus df-position-result-bonus';
          bonus.setAttribute('data-bind', 'df-result-bonus-flip');
          bonus.setAttribute('aria-hidden', 'true');
          bonus.dataset.tier = rowBonusPoints === 6 ? 'x0' : 'standard';
          bonus.textContent = `+${rowBonusPoints}% BONUS`;
          row.appendChild(bonus);
        }
        const multi = document.createElement('span');
        multi.className = 'df-position-multiplier';
        multi.setAttribute(
          'aria-label',
          [
            rowHasResultBonus ? `+${rowBonusPoints} percent bonus` : null,
            item.status.outcome,
            item.status.percent,
          ].filter(Boolean).join(' '),
        );
        const outcome = document.createElement('span');
        outcome.className = 'df-position-outcome';
        outcome.textContent = item.status.outcome;
        multi.appendChild(outcome);
        if (item.status.percent) {
          const percent = document.createElement('span');
          percent.className = [
            'df-position-percentage',
            item.status.percentTone
              ? `df-position-percentage--${item.status.percentTone}`
              : '',
          ].filter(Boolean).join(' ');
          percent.textContent = item.status.percent;
          multi.appendChild(percent);
        }
        row.appendChild(multi);
      }
      const result = document.createElement('span');
      result.className = 'df-position-result';
      const v = document.createElement('span');
      v.className = `df-position-value${item.outcome ? ` df-position-value--${item.outcome}` : ''}`;
      if (item.number != null) {
        const number = document.createElement('span');
        number.className = 'df-position-number';
        number.textContent = item.number;
        const unit = document.createElement('span');
        unit.className = 'df-position-unit';
        unit.textContent = item.unit ? ` ${item.unit}` : '';
        v.appendChild(number);
        v.appendChild(unit);
      } else {
        v.textContent = item.value;
      }
      result.appendChild(v);
      if (item.held) {
        result.setAttribute('title', 'Last settled value; updates after the RNG reveal');
        result.setAttribute('aria-label', `Last settled ${item.label.toLowerCase()}. Updates after the RNG reveal.`);
      }
      row.appendChild(result);
      slot.appendChild(row);
    }
  }

  #renderTodayBetOval(stakeWei, state = 'stake', totalWei = null) {
    const lost = state === 'lost';
    // A pile-scale win presents the whole payout as one bigger pile that owns
    // the entire spot; covering the stake lane and divider is deliberate.
    if (!lost && totalWei != null
      && coinflipBetPresentation(stakeWei) > 0
      && coinflipBetPresentation(totalWei) > 0) {
      this.#renderChipStrip({
        hostBind: 'df-bet-oval',
        rackBind: 'df-bet-chip-rack',
        renderKey: `win-pile:${stakeWei}:${totalWei}`,
        amountWei: stakeWei,
        growToWei: totalWei,
        emptyCopy: '',
        emptyAria: "Today's bet",
        valueLabel: "Today's payout",
      });
      this.#renderTodayWinningsRow(null, null);
      return;
    }
    this.#renderChipStrip({
      hostBind: 'df-bet-oval',
      rackBind: 'df-bet-chip-rack',
      renderKey: `${state}:${stakeWei == null ? 'loading' : String(stakeWei)}`,
      amountWei: lost ? null : stakeWei,
      emptyCopy: lost ? '' : stakeWei == null ? '—' : 'NO BET',
      emptyAria: lost
        ? "Today's bet lost; chips cleared"
        : stakeWei == null ? "Today's bet is loading" : "Today's bet: no bet",
      valueLabel: "Today's bet",
    });
    this.#renderTodayWinningsRow(lost ? null : stakeWei, lost ? null : totalWei);
  }

  #renderTodayWinningsRow(stakeWei, totalWei) {
    const host = this.querySelector('[data-bind="df-today-winnings-row"]');
    let addedWei = null;
    try {
      const stake = BigInt(stakeWei ?? 0);
      const total = BigInt(totalWei ?? 0);
      if (totalWei != null && total > stake) addedWei = total - stake;
    } catch (_error) { /* loading/invalid amounts leave the row empty */ }
    // Winnings are measured against the stake that earned them, so the payout
    // lane grows and shrinks with the day's multiplier. The chips decide the
    // lane: an empty rack must never open a row for the oval to grow into.
    const winPiles = addedWei == null ? [] : coinflipWinChipPiles(stakeWei, totalWei);
    if (host) {
      host.dataset.state = winPiles.length === 0 ? 'empty' : 'win';
      host.setAttribute('aria-hidden', String(winPiles.length === 0));
    }
    this.#renderChipStrip({
      hostBind: 'df-today-winnings-row',
      rackBind: 'df-today-winnings-rack',
      renderKey: winPiles.length === 0 ? 'empty' : `${stakeWei}:${totalWei}`,
      amountWei: addedWei,
      pileCounts: winPiles,
      emptyCopy: '',
      emptyAria: 'Winnings appear here after a win',
      valueLabel: 'Additional coinflip winnings',
    });
  }

  #renderTomorrowBetOval(stakeWei, known, held, dayLabel = 'Tomorrow') {
    // Tomorrow is the compact planning readout. Keep its amount textual so the
    // physical stacks remain reserved for the live wager in Today's large spot.
    let staged = null;
    try { staged = known && stakeWei != null ? BigInt(stakeWei) : null; }
    catch (_error) { staged = null; }
    const hasAmount = staged != null && staged > 0n;
    this.querySelector('[data-bind="df-tomorrow-bet-oval"]')
      ?.setAttribute('data-tomorrow-display', hasAmount ? 'amount' : 'placeholder');
    this.#renderChipStrip({
      hostBind: 'df-tomorrow-bet-oval',
      rackBind: 'df-tomorrow-chip-rack',
      renderKey: `${known ? stakeWei : 'loading'}:${held ? 'held' : 'live'}`,
      amountWei: null,
      emptyCopy: !known
        ? '—'
        : hasAmount
          ? coinflipAmountLabel(staged)
          : 'NO BET',
      emptyAria: !known
        ? `${dayLabel}'s bet is loading`
        : held && hasAmount
          ? `Last settled ${dayLabel.toLowerCase()}'s bet: ${this.#fmtWhole(stakeWei)} FLIP. Updates after the RNG reveal.`
          : hasAmount
            ? `${dayLabel}'s bet: ${this.#fmtWhole(stakeWei)} FLIP`
            : `${dayLabel}'s bet: no bet`,
      valueLabel: `${dayLabel}'s bet`,
    });
    const oval = this.querySelector('[data-bind="df-tomorrow-bet-oval"]');
    if (oval) oval.setAttribute('data-balance-held', String(held));
  }

  #advanceConfirmedTomorrowWager({ player, day, amount, held, safeBefore }) {
    if (!held || !this.#active || Number(day) !== Number(this.#day)) return;
    const scope = String(player || '').toLowerCase();
    const currentScope = String(this.#dashboardAddress || '').toLowerCase();
    if (!scope || scope !== currentScope) return;

    // If the reveal opened while the wallet was confirming, the ordinary
    // authoritative refresh owns the display. This exception is only for a
    // Tomorrow snapshot that is still spoiler-held.
    const oval = this.querySelector('[data-bind="df-tomorrow-bet-oval"]');
    if (oval?.getAttribute('data-balance-held') !== 'true') return;

    const before = safeBefore == null ? 0n : this.#asWei(safeBefore);
    const confirmedFloor = before + this.#asWei(amount);
    const currentSafe = heldBalanceValue({
      namespace: `coinflip-tomorrow:${CHAIN.id}`,
      scope,
      value: null,
      released: false,
    });
    // A concurrent authoritative refresh may already include this wager. In
    // that case retain its newer safe snapshot instead of adding twice.
    if (currentSafe == null || this.#asWei(currentSafe) < confirmedFloor) {
      heldBalanceValue({
        namespace: `coinflip-tomorrow:${CHAIN.id}`,
        scope,
        value: confirmedFloor,
        released: true,
      });
    }
    this.#renderPosition();
  }

  #renderChipStrip({
    hostBind,
    rackBind,
    renderKey,
    amountWei,
    growToWei = null,
    pileCounts = null,
    emptyCopy,
    emptyAria,
    valueLabel,
  }) {
    const host = this.querySelector(`[data-bind="${hostBind}"]`);
    const rack = this.querySelector(`[data-bind="${rackBind}"]`);
    if (!host || !rack || host.getAttribute('data-chip-key') === renderKey) return;
    host.setAttribute('data-chip-key', renderKey);
    rack.textContent = '';
    const piles = pileCounts
      ?? (amountWei == null ? [] : coinflipBetChipPiles(amountWei));
    if (piles.length === 0) {
      rack.textContent = emptyCopy;
      host.setAttribute('aria-label', emptyAria);
      return;
    }
    // The wager decides how the whole spot presents. A payout counted in the
    // wager's own chips stays in that lane even when the added FLIP alone
    // would rate a mound, so the two racks are never different currencies.
    const presentation = pileCounts ? 0 : coinflipBetPresentation(amountWei);
    if (presentation > 0) {
      // The pile keeps the wager's own composition; a win GROWS it in place
      // with the matching add-overlay instead of switching graphics, and how
      // far it grows is the day's own multiplier.
      const pile = document.createElement('i');
      pile.className = `df-bet-pile${growToWei != null ? ' df-bet-pile--held' : ''}`;
      pile.setAttribute('data-pile', String(presentation));
      // Same rung, different mound: the composition is picked from the stake,
      // so it holds all day and two players at one rung are not twins.
      pile.setAttribute('data-variant', flipPileVariant(amountWei));
      if (growToWei != null) {
        const add = document.createElement('i');
        add.className = 'df-bet-pile-add';
        add.setAttribute('data-pay', String(coinflipWinPileFrame(amountWei, growToWei)));
        pile.appendChild(add);
      }
      rack.appendChild(pile);
      host.setAttribute(
        'aria-label',
        `${valueLabel}: ${this.#fmtWhole(growToWei ?? amountWei)} FLIP.`,
      );
      return;
    }
    for (const count of piles) {
      const stackNode = document.createElement('span');
      stackNode.className = 'df-bet-chip-stack';
      stackNode.setAttribute('data-chip-count', String(count));
      // Short stacks spread so every chip edge reads; taller piles compress
      // into the same lane. Rise is a fraction of the responsive chip height,
      // so mobile and desktop lanes both stay inside their rows.
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
    host.setAttribute(
      'aria-label',
      `${valueLabel}: ${this.#fmtWhole(amountWei)} FLIP.`,
    );
  }

  #renderFunds() {
    const flipTotal = this.querySelector('[data-bind="df-funds-flip-total"]');
    const flipUnit = this.querySelector('[data-bind="df-funds-flip-unit"]');
    const flipTotalBox = this.querySelector('[data-bind="df-funds-flip-total-box"]');
    const claimFlip = this.querySelector('[data-bind="df-claim-flip-cta"]');
    // Auto-rebuy carry is already committed to the live coinflip position and
    // cannot be manually wagered again. It belongs in Today's/Tomorrow's Bet,
    // not AVAILABLE FUNDS. This plate is liquid wallet FLIP plus ordinary
    // claimable winnings only.
    const visibleAvailable = this.#visibleClaimableWei();
    const liveBalances = this.#liveBalancesAddress === this.#dashboardAddress
      ? this.#liveBalances
      : null;
    const walletRaw = liveBalances?.flipBalance ?? this.#dashboard?.flipBalance ?? null;
    const walletWei = walletRaw == null ? null : this.#asWei(walletRaw);
    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    const revealComplete = hasResult
      && this.#revealed()
      && !this.#landing
      && (!Boolean(this.#flipResult?.win) || this.#winningReceiptCommitted);
    const displayedAvailable = heldBalanceValue({
      namespace: `protocol-flip-available:${CHAIN.id}`,
      scope: this.#dashboardAddress,
      value: visibleAvailable,
      released: revealComplete,
    });
    // Wallet FLIP is not RNG-derived, so deposits, burns, and transfers keep
    // moving normally. Only claimable winnings wait on the reveal; auto-rebuy
    // carry remains visible in the committed bet instead of this balance.
    const protocolFlipWei = protocolFlipTotalWei(walletWei, displayedAvailable);
    this.#renderBankrollRack({
      liquidWei: walletWei,
      claimableWei: displayedAvailable,
      claimableVisible: displayedAvailable != null,
      combinedWei: protocolFlipWei,
      held: !revealComplete,
    });
    if (flipUnit) {
      flipUnit.textContent = 'FLIP';
      flipUnit.hidden = this.#fmtWhole(protocolFlipWei).length > 7;
    }
    if (flipTotal) {
      updateBalanceDisplay(flipTotal, {
        container: flipTotalBox,
        scope: this.#dashboardAddress == null ? null : `${this.#dashboardAddress}:flip-total`,
        // AVAILABLE FUNDS is minted wallet FLIP plus ordinary claimable
        // winnings. Auto-rebuy carry is committed to the live bet and cannot
        // be wagered a second time. Claiming still only moves value between
        // the two available ledgers, so this total stays transaction-stable.
        value: protocolFlipWei,
        visible: true,
        format: (raw) => raw === 0n ? '-' : this.#fmtWhole(raw),
        formatDelta: (delta) => `+${this.#fmtWhole(delta)} FLIP`,
      });
      flipTotal.removeAttribute('aria-hidden');
      flipTotal.removeAttribute('role');
      flipTotal.removeAttribute('tabindex');
      flipTotal.setAttribute('data-balance-held', String(!revealComplete));
      if (revealComplete) {
        flipTotal.removeAttribute('aria-label');
        flipTotal.removeAttribute('title');
      } else {
        flipTotal.setAttribute('aria-label', 'Last settled FLIP total. Updates after the coinflip reveal.');
        flipTotal.setAttribute('title', 'Last settled value; updates after the coinflip reveal');
      }
    }
    flipTotalBox?.setAttribute?.('data-balance-held', String(!revealComplete));
    // Publish the exact painted value only after the owning Protocol Coins
    // cell has adopted it. The left-side FLIP Balance mirrors this
    // account-scoped snapshot instead of independently racing live backing.
    const disclosureAddress = this.#dashboardAddress == null
      ? null
      : String(this.#dashboardAddress).toLowerCase();
    const disclosureValue = protocolFlipWei == null ? null : String(protocolFlipWei);
    const currentDisclosure = get('ui.protocolCoinsFlipDisclosure');
    if (currentDisclosure?.address !== disclosureAddress
      || currentDisclosure?.valueWei !== disclosureValue
      || currentDisclosure?.held !== !revealComplete) {
      update('ui.protocolCoinsFlipDisclosure', {
        address: disclosureAddress,
        valueWei: disclosureValue,
        held: !revealComplete,
      });
    }
    const connected = Boolean(getActingAddress());
    if (claimFlip) {
      claimFlip.disabled = !connected;
      claimFlip.title = connected ? 'Open ETH and FLIP cash out' : 'Connect a wallet first';
      claimFlip.setAttribute(
        'aria-label',
        connected ? 'Open ETH and FLIP cash out' : 'Connect a wallet to cash out',
      );
    }
    this.#renderSdgnrsBurn();
  }

  #renderBankrollRack({
    liquidWei,
    claimableWei = 0n,
    claimableVisible = false,
    combinedWei = null,
    held = false,
  }) {
    const host = this.querySelector('[data-bind="df-bankroll-rack"]');
    if (!host) return;
    const key = liquidWei == null
      ? 'loading'
      : `base:${liquidWei}:credit:${claimableVisible ? claimableWei ?? 0n : 'unknown'}:${held ? 'held' : 'live'}`;
    if (host.getAttribute('data-bankroll-key') === key) return;
    host.setAttribute('data-bankroll-key', key);
    host.textContent = '';
    host.classList?.remove('is-crediting');
    host.removeAttribute('title');
    if (liquidWei == null) {
      host.setAttribute('data-state', 'loading');
      host.setAttribute('aria-label', 'FLIP bankroll is loading');
      return;
    }
    const nonnegativeWei = (value) => {
      try {
        const parsed = BigInt(value ?? 0);
        return parsed > 0n ? parsed : 0n;
      } catch (_error) {
        return 0n;
      }
    };
    const liquid = nonnegativeWei(liquidWei);
    const claimable = claimableVisible ? nonnegativeWei(claimableWei) : 0n;
    const combined = combinedWei == null
      ? protocolFlipTotalWei(liquid, claimable)
      : nonnegativeWei(combinedWei);
    const ratioCounts = coinflipClaimTrayRatioChipCounts(claimable, liquid);
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
    } catch (_error) { /* keep the original fallback channel width */ }
    const capacity = Math.max(56, Math.floor((channelRem / 0.2) * 2) - 8);
    const totalCount = coinflipClaimTrayAmountChipCount(combined, capacity);

    host.setAttribute('data-state', combined === 0n ? 'empty' : 'visible');
    host.classList?.toggle('is-crediting', claimableVisible && !held && claimable > 0n);

    const ratioRow = document.createElement('span');
    ratioRow.className = 'df-bankroll__row df-bankroll__row--ratio';
    ratioRow.setAttribute('role', 'img');
    ratioRow.setAttribute(
      'aria-label',
      `Claimable ${this.#fmtWhole(claimable)} FLIP. Liquid ${this.#fmtWhole(liquid)} FLIP.`,
    );
    const totalRow = document.createElement('span');
    totalRow.className = 'df-bankroll__row df-bankroll__row--total';
    totalRow.setAttribute('role', 'img');
    totalRow.setAttribute(
      'aria-label',
      `Combined balance ${this.#fmtWhole(combined)} FLIP.`,
    );
    const splitBarrels = ({ count, source, tone, checkerboard = false }) => {
      const barrels = [];
      let remaining = count;
      let barrel = 0;
      while (remaining > 0) {
        const barrelCount = Math.min(20, remaining);
        barrels.push({
          count: barrelCount,
          source,
          tone: checkerboard ? (barrel % 2 === 0 ? 'claimable' : 'liquid') : tone,
          barrel,
        });
        remaining -= barrelCount;
        barrel += 1;
      }
      return barrels;
    };
    const appendBarrels = (row, stacks, kind) => {
      if (stacks.length === 0) return;
      const chipWidthRem = 0.17;
      const barrelGapRem = 0.2;
      const overlaps = stacks.reduce((sum, stack) => sum + Math.max(0, stack.count - 1), 0);
      const fixedWidth = (stacks.length * chipWidthRem)
        + (Math.max(0, stacks.length - 1) * barrelGapRem);
      const chipPitchRem = overlaps > 0
        ? Math.max(0.085, Math.min(0.2, (channelRem - fixedWidth) / overlaps))
        : 0.2;
      stacks.forEach((stack, stackIndex) => {
        const roll = document.createElement('span');
        roll.className = `df-bankroll__roll df-bankroll__roll--${kind}`;
        roll.setAttribute('data-bankroll-source', stack.source);
        roll.setAttribute('data-chip-color', stack.tone === 'claimable' ? 'red' : 'green');
        roll.setAttribute('data-chip-barrel', String(stack.barrel));
        roll.setAttribute('data-barrel-full', String(stack.count === 20));
        roll.setAttribute('data-chip-count', String(stack.count));
        roll.setAttribute(
          'style',
          `--df-bankroll-roll-span:${(chipWidthRem + ((stack.count - 1) * chipPitchRem)).toFixed(3)}rem`,
        );
        for (let index = 0; index < stack.count; index += 1) {
          const chip = document.createElement('i');
          chip.className = [
            'df-bankroll__chip',
            `df-bankroll__chip--${stack.tone}`,
          ].filter(Boolean).join(' ');
          chip.setAttribute('aria-hidden', 'true');
          chip.setAttribute('style', `--df-bankroll-chip-x:${(index * chipPitchRem).toFixed(3)}rem`);
          roll.appendChild(chip);
        }
        roll.setAttribute('data-chip-run', String(stackIndex));
        row.appendChild(roll);
      });
    };
    const ratioBarrels = [
      ...splitBarrels({
        count: ratioCounts.claimable,
        source: 'credit',
        tone: 'claimable',
      }),
      ...splitBarrels({
        count: ratioCounts.liquid,
        source: 'base',
        tone: 'liquid',
      }),
    ];
    const totalBarrels = splitBarrels({
      count: totalCount,
      source: 'total',
      tone: 'claimable',
      checkerboard: true,
    });
    appendBarrels(ratioRow, ratioBarrels, 'ratio');
    appendBarrels(totalRow, totalBarrels, 'total');

    if (ratioRow.children.length > 0) host.appendChild(ratioRow);
    if (totalRow.children.length > 0) host.appendChild(totalRow);
    const componentDisclosure = `Claimable ${this.#fmtWhole(claimable)} FLIP. Liquid ${this.#fmtWhole(liquid)} FLIP. Combined ${this.#fmtWhole(combined)} FLIP.`;
    host.setAttribute(
      'aria-label',
      claimableVisible
        ? held
          ? `Last settled claim tray. ${componentDisclosure} Wallet changes continue to update.`
          : componentDisclosure
        : `${componentDisclosure} Unresolved winnings are not included.`,
    );
    host.title = claimableVisible
      ? held ? 'Last settled winnings; wallet changes remain live' : `Exact balance: ${this.#fmtWhole(combined)} FLIP`
      : 'Winnings join the claim meter after reveal';
  }

  #renderBafScore() {
    const score = this.querySelector('[data-bind="df-baf-score"]');
    const rankEl = this.querySelector('[data-bind="df-baf-rank"]');
    const box = this.querySelector('[data-bind="df-baf-score-box"]');
    if (!score || !box) return;

    const scoreKnown = this.#bafScore != null && this.#bafAddress === this.#dashboardAddress;
    const indexed = scoreKnown ? this.#asWei(this.#bafScore.score) : null;
    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    const revealComplete = hasResult
      && this.#revealed()
      && !this.#landing
      && (!Boolean(this.#flipResult?.win) || this.#winningReceiptCommitted);
    const settlement = this.#activeSettlement();
    const sameBracket = settlement?.bafLevel == null
      || this.#bafLevel == null
      || Number(settlement.bafLevel) === Number(this.#bafLevel);
    const optimistic = revealComplete && sameBracket
      ? this.#asWei(settlement?.bafGainWei)
      : 0n;
    const base = settlement?.bafScoreBaseWei;
    const credited = optimistic > 0n
      && indexed != null
      && base != null
      && indexed >= this.#asWei(base) + optimistic;
    let pending = revealComplete && settlement?.won === true && !credited
      ? (this.#pendingBafCreditWei() ?? 0n)
      : 0n;
    if (!credited && optimistic > pending) pending = optimistic;
    const effective = indexed == null ? null : indexed + pending;
    const activeTransfer = this.#bafTransfer;
    const transferMatches = activeTransfer != null
      && Number(activeTransfer.day) === Number(this.#day)
      && activeTransfer.address === this.#dashboardAddress;
    const displayed = transferMatches ? activeTransfer.fromWei : effective;
    const rank = Number(this.#bafScore?.rank);
    // Keep the latest indexed rank visible while an already-revealed win is
    // folded into the score. The rank updates after that credit is indexed;
    // replacing a useful known rank with a dash made the feature look broken.
    if (rankEl) {
      rankEl.textContent = Number.isInteger(rank) && rank >= 1
        ? `RANK #${rank}`
        : 'RANK —';
      rankEl.title = pending > 0n && Number.isInteger(rank) && rank >= 1
        ? 'Current indexed rank; updates after pending BAF is recorded.'
        : '';
    }
    updateBalanceDisplay(score, {
      container: box,
      scope: scoreKnown ? `${this.#dashboardAddress}:baf:${this.#bafLevel}` : null,
      value: displayed,
      // BAF is a rank score derived from winning FLIP; it is not a token
      // balance. Pending winning payouts are painted directly into the number
      // after reveal, which makes the same-scope increase count up in place.
      format: (raw) => formatBafScore(raw),
      formatDelta: (delta) => `+${formatBafScore(delta)}`,
    });
    score.title = displayed == null ? '' : `Exact BAF score: ${this.#fmtWhole(displayed)}`;
  }

  #clearBafTransfer({ resetDone = false } = {}) {
    const transfer = this.#bafTransfer;
    if (transfer?.timer != null) {
      try { clearTimeout(transfer.timer); } catch (_e) { /* defensive */ }
    }
    try { transfer?.node?.remove?.(); } catch (_e) { /* detached DOM */ }
    this.#bafTransfer = null;
    if (this.#bafImpactTimer != null) {
      try { clearTimeout(this.#bafImpactTimer); } catch (_e) { /* defensive */ }
      this.#bafImpactTimer = null;
    }
    this.querySelector('[data-bind="df-baf-score-box"]')
      ?.classList?.remove('df-baf-score--transfer-impact');
    if (resetDone) this.#bafTransferDoneKey = null;
  }

  #finishBafTransfer(key) {
    const transfer = this.#bafTransfer;
    if (!transfer || transfer.key !== key) return;
    if (transfer.timer != null) {
      try { clearTimeout(transfer.timer); } catch (_e) { /* defensive */ }
    }
    try { transfer.node?.remove?.(); } catch (_e) { /* detached DOM */ }
    this.#bafTransfer = null;
    this.#bafTransferDoneKey = key;

    const box = this.querySelector('[data-bind="df-baf-score-box"]');
    box?.classList?.add('df-baf-score--transfer-impact');
    this.#renderBafScore();
    if (typeof setTimeout === 'function') {
      this.#bafImpactTimer = setTimeout(() => {
        this.#bafImpactTimer = null;
        box?.classList?.remove('df-baf-score--transfer-impact');
      }, 1_180);
      this.#bafImpactTimer?.unref?.();
    }
  }

  #startBafTransfer(revealDay) {
    if (this.#reducedMotion() || typeof document === 'undefined') return false;
    const settlement = this.#activeSettlement();
    if (!settlement?.won || Number(settlement.day) !== Number(revealDay)) return false;
    const currentGain = this.#settlementGainWei(settlement);
    if (currentGain <= 0n) return false;

    const scoreKnown = this.#bafScore != null && this.#bafAddress === this.#dashboardAddress;
    if (!scoreKnown) return false;
    const indexed = this.#asWei(this.#bafScore.score);
    const sameBracket = settlement.bafLevel == null
      || this.#bafLevel == null
      || Number(settlement.bafLevel) === Number(this.#bafLevel);
    if (!sameBracket) return false;
    const optimistic = this.#asWei(settlement.bafGainWei);
    const base = settlement.bafScoreBaseWei;
    const credited = optimistic > 0n
      && base != null
      && indexed >= this.#asWei(base) + optimistic;
    if (credited) return false;
    let pending = this.#pendingBafCreditWei() ?? 0n;
    if (optimistic > pending) pending = optimistic;
    if (pending < currentGain) pending = currentGain;
    const effective = indexed + pending;
    const fromWei = effective - currentGain;
    const key = [
      revealDay,
      this.#dashboardAddress || '',
      this.#bafLevel ?? '',
      currentGain,
      effective,
    ].join(':');
    if (this.#bafTransfer?.key === key) return true;
    if (this.#bafTransferDoneKey === key) return false;

    const source = this.querySelector(
      '[data-bind="df-position-today"] .df-position-value--win',
    );
    const target = this.querySelector('[data-bind="df-baf-score"]');
    if (!source || !target
      || typeof source.getBoundingClientRect !== 'function'
      || typeof target.getBoundingClientRect !== 'function'
      || typeof document.body?.appendChild !== 'function') return false;
    const start = source.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    if (![start.left, start.top, start.width, start.height, end.left, end.top, end.width, end.height]
      .every(Number.isFinite) || start.width <= 0 || start.height <= 0) return false;

    const node = document.createElement('span');
    node.className = 'df-baf-transfer';
    node.textContent = String(source.textContent || '')
      .replace(/\s*FLIP\s*$/i, '')
      .trim();
    node.setAttribute('aria-hidden', 'true');
    node.style.left = `${start.left}px`;
    node.style.top = `${start.top}px`;
    node.style.setProperty?.(
      '--df-baf-flight-x',
      `${(end.left + (end.width / 2)) - (start.left + (start.width / 2))}px`,
    );
    node.style.setProperty?.(
      '--df-baf-flight-y',
      `${(end.top + (end.height / 2)) - (start.top + (start.height / 2))}px`,
    );
    node.style.setProperty?.('--df-baf-flight-duration', `${BAF_TRANSFER_DURATION_MS}ms`);

    this.#bafTransfer = {
      key,
      day: revealDay,
      address: this.#dashboardAddress,
      fromWei,
      node,
      timer: null,
    };
    // Establish the score immediately before today's win without producing a
    // second delta cue for older pending credit. The flying receipt itself is
    // the +amount cue for this win.
    resetBalanceDisplay(target);
    this.#renderBafScore();
    document.body.appendChild(node);
    const finish = () => this.#finishBafTransfer(key);
    node.addEventListener?.('animationend', finish, { once: true });
    this.#bafTransfer.timer = setTimeout(finish, BAF_TRANSFER_DURATION_MS + 100);
    this.#bafTransfer.timer?.unref?.();
    return true;
  }

  #reducedMotion() {
    try {
      return typeof matchMedia !== 'function'
        || matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_e) {
      return true;
    }
  }

  #mountFakeoutReverseCards(revealPlan, won) {
    const reversalCount = Math.max(0, Math.trunc(Number(revealPlan?.reversalCount) || 0));
    if (reversalCount === 0) return;
    const zone = this.querySelector('[data-bind="df-coin-zone"]');
    if (!zone) return;

    for (let index = 1; index <= reversalCount; index += 1) {
      const remainingReversals = reversalCount - index;
      const targetWon = remainingReversals % 2 === 0 ? Boolean(won) : !Boolean(won);
      const target = targetWon ? 'eth' : 'wwxrp';
      const card = document.createElement('span');
      card.className = `df-fakeout-reverse-card df-fakeout-reverse-card--to-${target}`;
      card.setAttribute('data-bind', 'df-fakeout-reverse-card');
      card.setAttribute('data-fakeout-target', target);
      card.setAttribute('data-reversal-index', String(index));
      card.setAttribute('aria-hidden', 'true');
      if (card.style && typeof card.style.setProperty === 'function') {
        const delay = reverseCardDelayMs(revealPlan, index);
        card.style.setProperty('--df-fakeout-delay', `${delay}ms`);
        card.style.setProperty('--df-fakeout-duration', `${REVERSE_CARD_ANIMATION_MS}ms`);
      }

      const art = document.createElement('img');
      art.className = 'df-fakeout-reverse-card__art';
      art.src = '/shared/reverse-flip-card.svg';
      art.alt = '';
      card.appendChild(art);
      zone.appendChild(card);
    }
  }

  #maybeStartQueuedReveal() {
    if (this.#revealRequestedDay == null
      || Number(this.#revealRequestedDay) !== Number(this.#day)
      || this.#flipFetchedDay !== this.#day
      || this.#flipResult == null
      || !this.#dayAvailabilityReady()
      || this.#landing
      || this.#revealed()) return;
    const day = this.#day;
    this.#revealRequestedDay = null;
    this.#onCoinClick(day);
  }

  #onCoinClick(clickedDay = this.#day) {
    if (this.#landing || this.#revealed()) return;
    // Stale-DOM guard (codex finding): a click on a coin rendered for a
    // PREVIOUS day must not mark the new day revealed. Only act when the
    // fetched result belongs to the current day.
    if (this.#day == null || Number(clickedDay) !== Number(this.#day)) return;
    if (!this.#dayAvailabilityReady(clickedDay)) return;
    // Remove the printed felt prompt in the same input task. Audio warmup,
    // result polling, and reveal planning must never leave it hanging after
    // the player has already acted.
    const revealHint = this.querySelector('[data-bind="df-reveal-hint"]');
    if (revealHint) revealHint.hidden = true;
    // This call is intentionally inside the player's click so Safari/iOS can
    // unlock WebAudio even when the exact result still needs one more poll.
    warmupCoinflipSfx();
    if (this.#flipFetchedDay !== this.#day || this.#flipResult == null) {
      // Accept the player's jackpot-time click even if the result RPC/indexer
      // is a few blocks behind. The already-mounted coin keeps spinning; the
      // exact result read starts the deterministic landing as soon as it lands.
      this.#revealRequestedDay = this.#day;
      this.#renderCoin();
      this.#scheduleRefresh();
      return;
    }
    const revealDay = this.#day;
    const viewedAddress = this.#viewedAddress();
    const revealAddress = this.#dashboardAddress
      || (viewedAddress == null ? null : String(viewedAddress).toLowerCase());
    // Never substitute the dashboard's newest stake here: once a new target
    // day has started it may already be tomorrow's unresolved total. Outcome
    // presentation does not need to wait for the historical log scan; an
    // unknown stake remains an em dash and #repairSettlement fills it later.
    const settledBet = this.#resolvedBetWei;
    const won = Boolean(this.#flipResult.win);
    // Only the count frozen at the RNG request is authoritative. The live
    // Reverse quote can move again after resolution and must not retroactively
    // add cards to this day's reveal.
    const realReversalCount = this.#resolutionReverseDay === Number(revealDay)
      ? this.#resolutionReverseQueued
      : null;
    const revealPlan = selectFlipRevealPlan(revealDay, won, realReversalCount);
    const rewardPercent = Number(this.#flipResult.rewardPercent || 0);
    const currentWinCredit = won && settledBet != null
      ? this.#winPayoutWei(settledBet, rewardPercent)
      : 0n;
    const livePendingBaf = this.#pendingBafCreditWei() ?? 0n;
    const settlementState = {
      day: revealDay,
      address: revealAddress,
      betWei: settledBet,
      claimableBaseWei: this.#asWei(this.#dashboard?.coinflip?.claimablePreview),
      claimableTotalWei: this.#liveClaimableWei,
      claimableFloorRetired: false,
      rewardPercent,
      won,
      // Snapshot every not-yet-recorded winning payout. The current win is a
      // floor in case previewClaimCoinflips was read just before resolution.
      bafGainWei: won
        ? (livePendingBaf > currentWinCredit ? livePendingBaf : currentWinCredit)
        : 0n,
      bafScoreBaseWei: this.#bafScore == null ? null : this.#asWei(this.#bafScore.score),
      bafLevel: this.#bafLevel,
    };
    const reducedMotion = this.#reducedMotion();
    this.#clearCoinSfxTimers();
    this.#markRevealed();
    const finish = () => {
      this.#revealTimer = null;
      if (this.#revealFinishingTimer != null) {
        try { clearTimeout(this.#revealFinishingTimer); } catch (_) { /* defensive */ }
        this.#revealFinishingTimer = null;
      }
      this.#clearFakeoutMeter();
      this.#landing = false;
      setMajorDrawActivity('daily-flip', false);
      const stillCurrent = this.#day === revealDay;
      this.#clearCoinSfxTimers();
      this.#clearModifierMeter();
      this.#meterRecoveryTail = stillCurrent
        && won
        && revealPlan.reversalCount >= 2
        && !reducedMotion;
      this.#meterSettling = stillCurrent
        && won
        && !reducedMotion
        && typeof setTimeout === 'function';
      this.#winningReceiptCommitted = !stillCurrent || !won || !this.#meterSettling;
      if (stillCurrent) {
        // Production normally has the direct chain total already. If that read
        // was temporarily unavailable, preserve the old optimistic fallback
        // until the post-landing refresh obtains the exact contract value.
        if (settlementState.claimableTotalWei == null) {
          settlementState.claimableTotalWei = settlementState.claimableBaseWei
            + this.#settlementGainWei(settlementState);
        }
        this.#settlementState = settlementState;
        this.#saveSettlement(settlementState);
        this.#startResultTruthWindow(revealDay);
        if (!won || !this.#meterSettling) this.#armCoinflipScoreTick(revealDay, won);
      }
      this.#render();
      if (stillCurrent) {
        if (won) {
          if (this.#meterSettling) {
            // The cue is armed from the exact thermometer animation mounted by
            // #render and fires only when that marker reaches its final value.
            this.#armWinningMeter(revealDay);
          } else {
            // Reduced motion commits the result and its cue in this same task.
            try { sfxCoinflipLand(true); } catch (_e) { /* sound is decorative */ }
          }
        } else if (typeof setTimeout === 'function') {
          // Let the genuine red face sit silently for a beat. This prevents a
          // landing sound from spoiling a late Reverse-card correction.
          this.#scheduleCoinVerdictSfx(revealDay, LOSS_VERDICT_DELAY_MS, false);
        }
      }
      try {
        const ev = (typeof CustomEvent === 'function')
          ? new CustomEvent('flip:revealed', { detail: { day: revealDay } })
          : { type: 'flip:revealed', detail: { day: revealDay } };
        document.dispatchEvent(ev);
      } catch (_e) { /* headless — best-effort */ }
      // The reveal is presentation-only, but it is the point at which the
      // previously hidden claimable ledger becomes visible. Refresh the live
      // contract value on that frame instead of waiting up to 30 seconds for
      // the indexed dashboard poll.
      if (stillCurrent) {
        // A win is the only flip result that can change BAF. Refresh its cached
        // score/rank once after reveal; losses and idle polling keep the cached
        // leaderboard row.
        if (won) {
          this.#bafLookupKey = null;
          this.#forceBafRefresh = true;
        }
        this.#scheduleRefresh();
      }
    };
    if (reducedMotion || typeof setTimeout !== 'function') {
      finish();
      return;
    }
    // Swap the idle loop for the day's deterministic motion track + ending.
    // All eight possible endings begin only after the profile's identical
    // 3.3-second track frame. Every Reverse card toggles the visible face;
    // rare two- and three-card endings keep alternating until the last tap
    // lands on the authoritative protocol result.
    // #renderCoin leaves this DOM intact while #landing.
    this.#landing = true;
    setMajorDrawActivity('daily-flip', true);
    this.#clearFakeoutMeter();
    const inner = this.querySelector('.df-coin3d__inner');
    if (inner && inner.classList) {
      inner.classList.add(
        'df-reveal-active',
        `df-reveal-track--${revealPlan.profile}`,
        `df-reveal-bias--${revealPlan.bias}`,
        revealPlan.openingMs === REVEAL_BIASED_END_MS
          ? 'df-reveal-opening--biased'
          : 'df-reveal-opening--standard',
        `df-reveal-ending--${revealPlan.ending}`,
      );
      if (revealPlan.hardStop) inner.classList.add('df-reveal-hard-stop');
      inner.setAttribute('data-reveal-profile', revealPlan.profile);
      inner.setAttribute('data-reveal-win-rate', String(revealPlan.winRate));
      inner.setAttribute('data-reveal-ending', revealPlan.ending);
      inner.setAttribute('data-reveal-mode', revealPlan.hardStop ? 'hard-stop' : 'choreographed');
      if (inner.style && typeof inner.style.setProperty === 'function') {
        inner.style.setProperty('--df-track-duration', `${revealPlan.trackMs}ms`);
        inner.style.setProperty('--df-ending-duration', `${revealPlan.endingMs}ms`);
        if (revealPlan.hardStop) {
          inner.style.setProperty('--df-hard-stop-duration', `${revealPlan.totalMs}ms`);
          inner.style.setProperty('--df-hard-stop-rotation', `${revealPlan.hardStopRotationDeg}deg`);
        }
      }
    }
    this.#mountFakeoutReverseCards(revealPlan, won);
    this.#scheduleApparentWinMeters(revealDay, revealPlan, won);
    this.#scheduleCoinflipRevealSfx(revealDay, revealPlan, won);
    this.#renderModifierMeter();
    const outcome = this.querySelector('[data-bind="df-outcome"]');
    if (outcome) outcome.textContent = '';
    if (!revealPlan.hardStop && shouldFlashAllInDoIt(revealDay)) {
      // Cue the first normal landing, not the final Reverse-card landing. A
      // multi-reversal day therefore gets the same tiny wink at the same beat
      // as an ordinary flip, before any correction cards extend the sequence.
      const normalLandingMs = revealPlan.trackMs + revealPlan.openingMs;
      const finishing = setTimeout(() => {
        this.#revealFinishingTimer = null;
        if (!this.#landing || this.#day !== revealDay) return;
        try {
          const ev = (typeof CustomEvent === 'function')
            ? new CustomEvent('flip:finishing', {
              detail: { day: revealDay, durationMs: FLIP_FINISH_CUE_MS },
            })
            : {
              type: 'flip:finishing',
              detail: { day: revealDay, durationMs: FLIP_FINISH_CUE_MS },
            };
          document.dispatchEvent(ev);
        } catch (_e) { /* headless — best-effort */ }
      }, Math.max(0, normalLandingMs - FLIP_FINISH_CUE_MS));
      this.#revealFinishingTimer = finishing;
      if (finishing && typeof finishing.unref === 'function') {
        try { finishing.unref(); } catch (_) { /* defensive */ }
      }
    }
    const h = setTimeout(finish, revealPlan.totalMs);
    this.#revealTimer = h;
    if (h && typeof h.unref === 'function') {
      try { h.unref(); } catch (_) { /* defensive */ }
    }
  }

  // ---------------------------------------------------------------------
  // Actions.
  // ---------------------------------------------------------------------

  #resolvedBetCanShift() {
    const hasResult = this.#browsingDay == null
      && this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    return hasResult
      && this.#revealed()
      && !this.#landing
      && (!Boolean(this.#flipResult?.win) || this.#winningReceiptCommitted);
  }

  #activateTodayBet() {
    if (!this.#resolvedBetCanShift()) return;
    if (!this.#betPositionsShifted()) {
      this.#betPositionShiftDay = Number(this.#day);
      this.#renderPosition();
      return;
    }
    this.#openAddBetDialog();
  }

  #activateTomorrowBet() {
    if (this.#betPositionsShifted()) return;
    this.#openAddBetDialog();
  }

  #wireActions() {
    const revealHint = this.querySelector('[data-bind="df-reveal-hint"]');
    if (revealHint) revealHint.addEventListener('click', () => this.#onCoinClick(this.#day));
    const todayBet = this.querySelector('[data-bind="df-today-bet-cta"]');
    if (todayBet) {
      todayBet.addEventListener('click', () => this.#activateTodayBet());
      todayBet.addEventListener('keydown', (event) => {
        if (event?.key !== 'Enter' && event?.key !== ' ') return;
        try { event.preventDefault?.(); } catch (_e) { /* fakeDOM */ }
        this.#activateTodayBet();
      });
    }
    const flip = this.querySelector('[data-bind="df-flip-cta"]');
    if (flip) {
      flip.addEventListener('click', () => this.#activateTomorrowBet());
      flip.addEventListener('keydown', (event) => {
        if (event?.key !== 'Enter' && event?.key !== ' ') return;
        try { event.preventDefault?.(); } catch (_e) { /* fakeDOM */ }
        this.#activateTomorrowBet();
      });
    }
    const amountSlider = this.querySelector('[data-bind="df-add-bet-slider"]');
    const amountNumber = this.querySelector('[data-bind="df-add-bet-number"]');
    if (amountSlider) {
      const finishPointerAdjust = () => {
        delete amountSlider.dataset.pointerAdjust;
        delete amountSlider.dataset.fineAdjust;
      };
      amountSlider.addEventListener('pointerdown', (event) => {
        amountSlider.dataset.pointerAdjust = 'true';
        amountSlider.dataset.fineAdjust = event?.shiftKey ? 'true' : 'false';
      });
      amountSlider.addEventListener('pointerup', finishPointerAdjust);
      amountSlider.addEventListener('pointercancel', finishPointerAdjust);
      amountSlider.addEventListener('lostpointercapture', finishPointerAdjust);
      amountSlider.addEventListener('change', finishPointerAdjust);
      amountSlider.addEventListener('input', () => {
        this.#addBetError = '';
        const minWhole = BigInt(amountSlider.min || 100);
        const maxWhole = BigInt(amountSlider.max || minWhole);
        const step = BigInt(amountSlider.step || 1);
        const coarsePointerAdjust = amountSlider.dataset.pointerAdjust === 'true'
          && amountSlider.dataset.fineAdjust !== 'true';
        amountSlider.value = String(coarsePointerAdjust
          ? this.#snapAddBetSliderCoarseWhole(amountSlider.value, minWhole, maxWhole)
          : this.#snapAddBetSliderWhole(amountSlider.value, minWhole, maxWhole, step));
        if (amountNumber) amountNumber.value = amountSlider.value;
        this.#renderAddBetDialog();
      });
      amountSlider.addEventListener('keydown', (event) => {
        if (event?.key === 'Shift') amountSlider.dataset.fineAdjust = 'true';
        if (event?.key === 'Enter') this.#runAction('flip');
      });
      amountSlider.addEventListener('keyup', (event) => {
        if (event?.key === 'Shift') delete amountSlider.dataset.fineAdjust;
      });
      amountSlider.addEventListener('blur', finishPointerAdjust);
    }
    if (amountNumber) {
      amountNumber.addEventListener('input', () => {
        this.#addBetError = '';
        this.#renderAddBetDialog();
      });
      amountNumber.addEventListener('keydown', (event) => {
        if (event?.key === 'Enter'
          && !this.querySelector('[data-bind="df-add-bet-confirm"]')?.disabled) {
          this.#runAction('flip');
        }
      });
    }
    const addBetConfirm = this.querySelector('[data-bind="df-add-bet-confirm"]');
    if (addBetConfirm) addBetConfirm.addEventListener('click', () => this.#runAction('flip'));
    for (const close of this.querySelectorAll('[data-bind="df-add-bet-close"]')) {
      close.addEventListener('click', () => this.#closeAddBetDialog());
    }
    const addBetDialog = this.querySelector('[data-bind="df-add-bet-dialog"]');
    if (addBetDialog) {
      addBetDialog.addEventListener('keydown', (event) => {
        if (event?.key === 'Escape') this.#closeAddBetDialog();
      });
      addBetDialog.addEventListener('click', (event) => {
        if (event?.target === addBetDialog) this.#closeAddBetDialog();
      });
    }
    const autoRebuy = this.querySelector('[data-bind="df-auto-rebuy-cta"]');
    if (autoRebuy) autoRebuy.addEventListener('click', () => this.#openAutoRebuyDialog());
    const autoRebuyToggle = this.querySelector('[name="df-auto-rebuy-enabled"]');
    if (autoRebuyToggle) {
      autoRebuyToggle.addEventListener('change', () => {
        this.#autoRebuyError = '';
        this.#renderAutoRebuy();
      });
    }
    const autoRebuyProfit = this.querySelector('[name="df-auto-rebuy-take-profit"]');
    if (autoRebuyProfit) {
      autoRebuyProfit.addEventListener('input', () => {
        this.#autoRebuyError = '';
        this.#renderAutoRebuy();
      });
    }
    const autoRebuySave = this.querySelector('[data-bind="df-auto-rebuy-save"]');
    if (autoRebuySave) {
      autoRebuySave.addEventListener('click', () => this.#runAction('auto-rebuy'));
    }
    for (const close of this.querySelectorAll('[data-bind="df-auto-rebuy-close"]')) {
      close.addEventListener('click', () => this.#closeAutoRebuyDialog());
    }
    const autoRebuyDialog = this.querySelector('[data-bind="df-auto-rebuy-dialog"]');
    if (autoRebuyDialog) {
      autoRebuyDialog.addEventListener('keydown', (event) => {
        if (event?.key === 'Escape') this.#closeAutoRebuyDialog();
      });
      autoRebuyDialog.addEventListener('click', (event) => {
        if (event?.target === autoRebuyDialog) this.#closeAutoRebuyDialog();
      });
    }
    const claimFlip = this.querySelector('[data-bind="df-claim-flip-cta"]');
    if (claimFlip) claimFlip.addEventListener('click', () => openPlayerFundsDialog('cashout'));
    const burn = this.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    if (burn) burn.addEventListener('click', () => this.#openSdgnrsBurnDialog());
    const burnInput = this.querySelector('[name="df-sdgnrs-amount"]');
    if (burnInput) burnInput.addEventListener('input', () => {
      this.#renderSdgnrsBurn();
      this.#refreshSdgnrsBurnQuote();
    });
    const burnSlider = this.querySelector('[data-bind="df-burn-slider"]');
    if (burnSlider) burnSlider.addEventListener('input', () => this.#setSdgnrsBurnFromSlider());
    const burnMax = this.querySelector('[data-bind="df-burn-max"]');
    if (burnMax) burnMax.addEventListener('click', () => this.#setMaxSdgnrsBurn());
    const burnAccept = this.querySelector('[data-bind="df-burn-accept"]');
    if (burnAccept) burnAccept.addEventListener('click', () => this.#runAction('burn-sdgnrs'));
    for (const cancel of this.querySelectorAll('[data-bind="df-burn-cancel"]')) {
      cancel.addEventListener('click', () => this.#closeSdgnrsBurnDialog());
    }
    const burnDialog = this.querySelector('[data-bind="df-burn-dialog"]');
    if (burnDialog) {
      burnDialog.addEventListener('keydown', (event) => {
        if (event?.key === 'Escape') this.#closeSdgnrsBurnDialog();
      });
      burnDialog.addEventListener('click', (event) => {
        if (event?.target === burnDialog) this.#closeSdgnrsBurnDialog();
      });
    }
    const charityVote = this.querySelector('[data-bind="df-charity-vote-cta"]');
    if (charityVote) charityVote.addEventListener('click', () => this.#openCharityVoteDialog());
    const charityRefresh = this.querySelector('[data-bind="df-charity-refresh"]');
    if (charityRefresh) charityRefresh.addEventListener('click', () => this.#loadCharityVote());
    for (const close of this.querySelectorAll('[data-bind="df-charity-close"]')) {
      close.addEventListener('click', () => this.#closeCharityVoteDialog());
    }
    const charityDialog = this.querySelector('[data-bind="df-charity-dialog"]');
    if (charityDialog) {
      charityDialog.addEventListener('keydown', (event) => {
        if (event?.key === 'Escape') this.#closeCharityVoteDialog();
      });
      charityDialog.addEventListener('click', (event) => {
        if (event?.target === charityDialog) this.#closeCharityVoteDialog();
      });
    }
    const accept = this.querySelector('[data-bind="df-reverse-accept"]');
    if (accept) accept.addEventListener('click', () => this.#runAction('reverse'));
    for (const cancel of this.querySelectorAll('[data-bind="df-reverse-cancel"]')) {
      cancel.addEventListener('click', () => this.#closeReverseDialog());
    }
    const dialog = this.querySelector('[data-bind="df-reverse-dialog"]');
    if (dialog) {
      dialog.addEventListener('keydown', (event) => {
        if (event?.key === 'Escape') this.#closeReverseDialog();
      });
      dialog.addEventListener('click', (event) => {
        if (event?.target === dialog) this.#closeReverseDialog();
      });
    }
  }

  // Bare quest events remain form presets. The quest dialog's explicit
  // confirmation adds submit:true and may continue into this panel's existing
  // deposit path after the exact amount has been shown to the player.
  #wireQuestPreset() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#questActivateListener = async (event) => {
      if (Number(event?.detail?.questType) !== 2) return;
      let targetWei;
      try { targetWei = BigInt(event?.detail?.target ?? 0); }
      catch (_e) { targetWei = 0n; }
      if (targetWei <= 0n) targetWei = 2_000n * (10n ** 18n);
      // The quest sheet already displayed and confirmed this exact amount.
      // Submit it as a one-off payload; do not replace the player's ordinary
      // Tomorrow's Bet draft just to route the transaction through this panel.
      if (event?.detail?.submit) {
        await this.#runAction('flip', { amount: targetWei });
        return;
      }
      const input = this.querySelector('[name="df-amount"]');
      if (!input) return;
      const unit = 10n ** 18n;
      const whole = targetWei / unit;
      const fraction = String(targetWei % unit).padStart(18, '0').replace(/0+$/, '');
      input.value = fraction ? `${whole}.${fraction}` : String(whole);
      try { input.dispatchEvent(new Event('input', { bubbles: true })); }
      catch (_e) { try { input.dispatchEvent({ type: 'input', bubbles: true }); } catch (_e2) {} }
      this.#openAddBetDialog({ reset: false });
      // Keep the slider coherent even in browsers/webviews that reject a
      // synthetic Event constructor from a different realm.
      this.#renderAddBetDialog();
      try { this.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_e) {}
      try { input.focus?.({ preventScroll: true }); } catch (_e) {}
    };
    document.addEventListener('quest:activate', this.#questActivateListener);
  }

  async #runAction(kind, options = {}) {
    if (this.#busy) return;
    this.#busy = true;
    if (kind === 'auto-rebuy') this.#autoRebuyError = '';
    if (kind === 'flip') this.#addBetError = '';
    this.#renderFunds();
    this.#renderAutoRebuy();
    this.#renderAddBetDialog();
    this.#clearError();
    this.#setStatus('');
    try {
      const player = get('connected.address');
      if (!player) throw new Error('Connect a wallet first.');
      if (kind === 'flip') {
        let amount;
        try { amount = options?.amount == null ? null : BigInt(options.amount); }
        catch (_e) { amount = null; }
        if (amount == null) {
          const input = this.querySelector('[data-bind="df-add-bet-number"]');
          const whole = parseWholeFlipInput(input?.value);
          amount = whole == null ? null : whole * (10n ** 18n);
          if (amount == null) {
            throw new Error('Choose a valid FLIP amount.');
          }
        }
        if (amount == null || amount < 100n * (10n ** 18n)) {
          throw new Error('Minimum coinflip bet is 100 FLIP.');
        }
        const confirmedWagerScope = String(player).toLowerCase();
        const confirmedWagerDay = this.#day;
        const tomorrowOval = this.querySelector('[data-bind="df-tomorrow-bet-oval"]');
        const tomorrowHeld = tomorrowOval?.getAttribute('data-balance-held') === 'true';
        const safeTomorrowBefore = tomorrowHeld
          ? heldBalanceValue({
              namespace: `coinflip-tomorrow:${CHAIN.id}`,
              scope: confirmedWagerScope,
              value: null,
              released: false,
            })
          : null;
        // The current contract handles claimable -> unlocked auto-rebuy carry
        // -> wallet in one deposit. No preliminary carry-claim signature is
        // needed, and an RNG-locked carry leg never falls through to the wallet.
        await depositCoinflip({ player, amount, useCarry: true });
        this.#advanceConfirmedTomorrowWager({
          player: confirmedWagerScope,
          day: confirmedWagerDay,
          amount,
          held: tomorrowHeld,
          safeBefore: safeTomorrowBefore,
        });
        if (options?.amount == null) this.#closeAddBetDialog();
      } else if (kind === 'auto-rebuy') {
        const info = this.#activeAutoRebuyInfo();
        if (!info) throw new Error('Auto rebuy settings are still loading.');
        const target = getActingAddress();
        if (!target || !this.#dashboardAddress
          || String(target).toLowerCase() !== String(this.#dashboardAddress).toLowerCase()) {
          throw new Error('Connect to this player account to change auto rebuy.');
        }
        const toggle = this.querySelector('[name="df-auto-rebuy-enabled"]');
        const input = this.querySelector('[name="df-auto-rebuy-take-profit"]');
        const nextEnabled = Boolean(toggle?.checked);
        const parsedTakeProfit = parseTokenAmount(input?.value);
        if (nextEnabled && parsedTakeProfit == null) {
          throw new Error('Enter a valid non-negative take profit amount.');
        }
        const takeProfitWei = nextEnabled ? parsedTakeProfit : 0n;
        if (takeProfitWei > MAX_AUTO_REBUY_TAKE_PROFIT_WEI) {
          throw new Error('Take profit is too large for coinflip auto rebuy.');
        }
        if (nextEnabled !== Boolean(info.enabled)) {
          await setCoinflipAutoRebuy({
            player: target,
            enabled: nextEnabled,
            takeProfit: takeProfitWei,
          });
        } else if (nextEnabled && takeProfitWei !== info.takeProfitWei) {
          await setCoinflipAutoRebuyTakeProfit({
            player: target,
            takeProfit: takeProfitWei,
          });
        } else {
          this.#closeAutoRebuyDialog();
          return;
        }
        this.#autoRebuyInfo = {
          ...info,
          enabled: nextEnabled,
          takeProfitWei: nextEnabled ? takeProfitWei : info.takeProfitWei,
          carryWei: nextEnabled ? info.carryWei : 0n,
          startDay: nextEnabled ? info.startDay : 0,
        };
        this.#autoRebuyAddress = this.#dashboardAddress;
        this.#closeAutoRebuyDialog();
      } else if (kind === 'burn-sdgnrs') {
        const input = this.querySelector('[name="df-sdgnrs-amount"]');
        const amount = parseTokenAmount(input?.value);
        const balance = this.#sdgnrsBalanceWei();
        if (amount == null || amount < MIN_SDGNRS_BURN_WEI) {
          throw new Error('Minimum burn is 1 sDGNRS.');
        }
        if (balance == null || amount > balance) {
          throw new Error('Not enough sDGNRS for that burn.');
        }
        const redemption = await burnSdgnrs({ amount });
        for (const submission of Array.isArray(redemption?.submissions)
          ? redemption.submissions : []) {
          try {
            document.dispatchEvent(new CustomEvent(SDGNRS_REDEMPTION_SUBMITTED_EVENT, {
              detail: submission,
            }));
          } catch (_e) { /* headless */ }
        }
        this.#closeSdgnrsBurnDialog();
      } else if (kind === 'reverse') {
        const quote = this.#reverseFlipQuote;
        if (!quote) throw new Error('Reverse Flip price is still loading.');
        if (quote.locked) {
          throw new Error('RNG is locked while the next result is settling.');
        }
        this.#setStatus(`Reversing for ${this.#formatFlipPrice(quote.costWei)} FLIP…`);
        await reverseFlip();
        const queued = quote.queued + 1n;
        this.#reverseFlipQuote = {
          queued,
          costWei: reverseFlipCostWei(queued),
          locked: false,
        };
        this.#showLiveSideOnCoin = true;
        this.#closeReverseDialog();
        this.#setStatus('Next flip outcome reversed.');
      }
      setTimeout(() => this.#scheduleRefresh(), 250);
    } catch (error) {
      this.#setStatus('');
      if (kind === 'auto-rebuy') {
        this.#autoRebuyError = compactUiError(error);
        this.#renderAutoRebuy();
      } else if (kind === 'flip'
        && !this.querySelector('[data-bind="df-add-bet-dialog"]')?.hidden) {
        this.#addBetError = compactUiError(error);
        this.#renderAddBetDialog();
      } else {
        this.#renderError(compactUiError(error));
      }
    } finally {
      setTimeout(() => {
        this.#busy = false;
        this.#renderFunds();
        this.#renderAutoRebuy();
        this.#renderAddBetDialog();
        this.#renderBafScore();
        this.#renderReverseFlip();
      }, 500);
    }
  }

  // A one-line progress/receipt note for the multi-step flip. Distinct from
  // #renderError: this is not a failure, and it must not look like one.
  #setStatus(msg) {
    // Transaction state is already reflected by disabled controls and the
    // wallet flow. Keep the compact coinflip surface free of receipt chatter.
    void msg;
  }

  #renderError(msg) {
    const errEl = this.querySelector('[data-bind="df-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
    }
    this.#errorTimer = setTimeout(() => this.#clearError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimer && typeof this.#errorTimer.unref === 'function') {
      try { this.#errorTimer.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearError() {
    const errEl = this.querySelector('[data-bind="df-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
  }
}

// Idempotency-guarded register (Phase 58 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-daily-flip')) {
    customElements.define('app-daily-flip', AppDailyFlip);
  }
}

export {
  AppDailyFlip,
  FLIP_REVEAL_PROFILES,
  FLIP_FINISH_CUE_MS,
  shouldFlashAllInDoIt,
  fakeoutModifierPercent,
  REVEAL_TRACK_MS,
  REVEAL_END_MS,
  REVEAL_BIASED_END_MS,
  REVEAL_FAKE_END_MS,
  REVEAL_DOUBLE_END_MS,
  REVEAL_TRIPLE_END_MS,
  REVERSE_CARD_ENTRY_WAIT_MS,
  REVERSE_CARD_ANIMATION_MS,
  REVERSE_CARD_POST_REVEAL_DELAY_MS,
  RESULT_TRUTH_WINDOW_MS,
  selectFlipRevealPlan,
  reverseCardDelayMs,
};
