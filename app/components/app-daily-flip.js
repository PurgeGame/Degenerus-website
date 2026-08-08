// /app/components/app-daily-flip.js — the daily coinflip widget (user ask).
//
// Lives INSIDE the jackpot hero as its right column (user call: the coinflip
// is part of the jackpot widget, not a sibling panel). The coin is a CSS-3D
// two-facer (shared/coinflip-face-red.svg = WWXRP/Purge side,
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
//   FLIP — depositCoinflip(player, amount) stake (FLIP wei, UNSCALED).
// Ticket redemption belongs to the purchase panel, so this side only owns the
// coinflip stake, its winnings claim, and the post-result Reverse Flip card.
// (CLAIM DGNRS removed — user call: no DGNRS claim in the coinflip column.
// The inline FLIP-winnings claim chip on the Claimable row stays.)
//
// T-58-18: server-derived strings via textContent.

import { CHAIN } from '../app/chain-config.js';
import { displayEth, displayToken } from '../app/scaling.js';
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
  readCoinflipAutoRebuyInfo,
  readClaimableCoinflip,
  readCurrentCoinflipStake,
  readBafFlipEve,
  readFlipWidgetBalances,
  protocolFlipTotalWei,
  readLatestCoinflipResult,
  readResolvedCoinflipStake,
  readReverseFlipQuote,
  reverseFlip,
  reverseFlipCostWei,
  setCoinflipAutoRebuy,
  setCoinflipAutoRebuyTakeProfit,
} from '../app/coinflip.js';
import { claimFlip } from '../app/claims.js';
import {
  burnSdgnrs,
  MIN_SDGNRS_BURN_WEI,
  previewSdgnrsBurn,
  SDGNRS_REDEMPTION_SUBMITTED_EVENT,
} from '../app/sdgnrs.js';
import { burnWwxrp, MIN_WWXRP_BURN_WEI } from '../app/wwxrp.js';
import { readCharityVoteState, voteForCharity } from '../app/charity-vote.js';
import { compactUiError } from '../app/ui-error.js';
import { TX_CONFIRMED_EVENT } from '../app/contracts.js';
import { updateBalanceDisplay, resetBalanceDisplay } from '../app/balance-countup.js';
import { activeBafScoreLevel } from '../app/jackpot-resolutions.js';
import { setMajorDrawActivity } from '../app/major-draw-activity.js';
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
import './boon-product-indicator.js';

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
const MODIFIER_MIN_PERCENT = 50;
const MODIFIER_MAX_PERCENT = 156;
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
 * Public pure helper for tests/replays. The original one-card fakeout keeps
 * its 10% day-wide chance (5% in each direction under a fair result). Three
 * disjoint hash buckets add exact 2% double- and 1% triple-reversal chances.
 * Every reversal toggles the visible face; even sequences therefore begin on
 * the authoritative face and odd sequences begin opposite it, so the final
 * face always remains the protocol result.
 */
function selectFlipRevealPlan(day, won) {
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
  const reversalCount = reversalBucket === 1
    ? 3
    : (reversalBucket === 2 || reversalBucket === 3)
      ? 2
      : reversalBucket % 10 === 0
        ? 1
        : 0;
  const fakeOut = reversalCount > 0;
  const openingWon = reversalCount % 2 === 0 ? isWin : !isWin;
  const prefersWin = profile.winRate > 50;
  const openingMs = openingWon === prefersWin ? REVEAL_BIASED_END_MS : REVEAL_END_MS;
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
  const endingMs = openingMs + (reversalCount * REVERSE_CARD_STAGGER_MS);

  return Object.freeze({
    profile: profile.id,
    winRate: profile.winRate,
    ending,
    fakeOut,
    reversalCount,
    bias: prefersWin ? 'win-heavy' : 'loss-heavy',
    openingWon,
    openingMs,
    trackMs: REVEAL_TRACK_MS,
    endingMs,
    totalMs: REVEAL_TRACK_MS + endingMs,
  });
}

function reverseCardDelayMs(revealPlan, index) {
  return revealPlan.trackMs
    + revealPlan.openingMs
    + REVERSE_CARD_ENTRY_WAIT_MS
    + ((index - 1) * REVERSE_CARD_STAGGER_MS);
}

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
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

function compactBetAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  const tiers = [
    [1e12, 't'],
    [1e9, 'b'],
    [1e6, 'm'],
    [1e3, 'k'],
  ];
  for (const [size, suffix] of tiers) {
    if (amount < size) continue;
    return `${Math.round(amount / size)}${suffix}`;
  }
  return String(Math.round(amount));
}

/** Compact the sDGNRS ledger balance to at most three significant figures. */
export function formatSdgnrsBalance(weiValue) {
  let raw;
  try { raw = BigInt(weiValue ?? 0); }
  catch (_e) { return '0'; }
  if (raw <= 0n) return '0';

  const unit = 10n ** 18n;
  if (raw < 1_000n * unit) return (raw / unit).toLocaleString('en-US');

  const tiers = [
    [1_000_000_000_000n * unit, 'T'],
    [1_000_000_000n * unit, 'B'],
    [1_000_000n * unit, 'M'],
    [1_000n * unit, 'K'],
  ];
  let tierIndex = tiers.findIndex(([scale]) => raw >= scale);
  if (tierIndex < 0) tierIndex = tiers.length - 1;

  // Re-evaluate precision after a rounding carry (9.999M -> 10.0M), and
  // promote a 999.9K carry to 1.00M instead of displaying 1,000K.
  for (;;) {
    const [scale, suffix] = tiers[tierIndex];
    const whole = raw / scale;
    let decimals = whole >= 100n ? 0 : whole >= 10n ? 1 : 2;
    let factor = 10n ** BigInt(decimals);
    let rounded = ((raw * factor) + (scale / 2n)) / scale;

    while (decimals > 0 && rounded >= 1_000n) {
      decimals -= 1;
      factor = 10n ** BigInt(decimals);
      rounded = ((raw * factor) + (scale / 2n)) / scale;
    }
    if (rounded >= 1_000n && tierIndex > 0) {
      tierIndex -= 1;
      continue;
    }

    const integer = rounded / factor;
    if (decimals === 0) return `${integer.toLocaleString('en-US')}${suffix}`;
    const fraction = String(rounded % factor).padStart(decimals, '0');
    return `${integer.toLocaleString('en-US')}.${fraction}${suffix}`;
  }
}

/** Whole-FLIP display rounded to at most four significant digits. */
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

function parseTokenAmount(value) {
  const match = /^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const fraction = (match[2] || '').padEnd(18, '0');
  try { return (BigInt(match[1]) * (10n ** 18n)) + BigInt(fraction || '0'); }
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
  #liveBalances = null;
  #liveBalancesAddress = null;
  #bafScore = null;        // indexed score for the active x10 BAF bracket
  #bafLevel = null;
  #bafAddress = null;
  #bafFlipEve = null;      // exact GAME.purchaseInfo x9-final-day signal
  // Rank is useful context, not a live ledger. Cache one lookup per
  // player/bracket and invalidate it only when a revealed win can change the
  // score (or when the player/day target changes).
  #bafLookupKey = null;
  #currentBetWei = null;   // live coinflipAmount(player), scoped to the current target day
  #autoRebuyInfo = null;   // direct Coinflip auto-rebuy settings for #autoRebuyAddress
  #autoRebuyAddress = null;
  #autoRebuyError = '';
  #autoRebuyDraftAddress = null;
  #autoRebuyDraftReady = false;
  #resolvedBetWei = null;  // final CoinflipStakeUpdated.newTotal for the exact result day
  #rolloverBetCarry = null; // last live stake, promoted only after the new day reads zero
  #liveClaimableWei = null; // direct previewClaimCoinflips, bypassing indexer lag
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
  #browsingDay = null;
  #forceReplayDay = null;
  #daySelectionListener = null;
  #tomorrowSpoilerOverrideKey = null;
  #flipTotalSpoilerOverrideKey = null;
  #fundsExpanded = false;
  #bafTransfer = null;
  #bafTransferDoneKey = null;
  #bafImpactTimer = null;

  #spoilerOverrideKey(kind) {
    return `${kind}:${this.#day ?? ''}:${this.#dashboardAddress ?? ''}`;
  }

  #activateSpoilerValue(kind, event = null) {
    if (event?.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    try { event?.preventDefault?.(); } catch (_e) { /* fakeDOM */ }
    if (kind === 'tomorrow') {
      this.#tomorrowSpoilerOverrideKey = this.#spoilerOverrideKey(kind);
      this.#renderPosition();
    } else if (kind === 'flip-total') {
      this.#flipTotalSpoilerOverrideKey = this.#spoilerOverrideKey(kind);
      this.#renderFunds();
    }
  }

  #activeDaySync(day = this.#day) {
    if (this.#browsingDay != null) return null;
    const syncDay = Number(this.#daySync?.day);
    return Number.isInteger(syncDay) && syncDay > 0 && syncDay === Number(day)
      ? this.#daySync
      : null;
  }

  #dayAvailabilityReady(day = this.#day) {
    const sync = this.#activeDaySync(day);
    // Preserve historical replay and the pre-coordinator fallback. Once a
    // direct target exists, both jackpot and coinflip unlock together.
    return sync == null || sync.ready === true;
  }

  #syncedCoinflipResult(day = this.#day) {
    const sync = this.#activeDaySync(day);
    if (!sync?.ready || Number(sync.coinflipResult?.day) !== Number(day)) return null;
    return sync.coinflipResult;
  }

  #onDaySync(sync) {
    const day = Number(sync?.day);
    this.#daySync = Number.isInteger(day) && day > 0 ? sync : null;
    if (!this.#daySync) {
      this.#render();
      return;
    }
    const genuinelyNew = this.#latestDaySeen == null || day > this.#latestDaySeen;
    if (genuinelyNew) this.#latestDaySeen = day;
    if (this.#day == null
      || (genuinelyNew && day !== Number(this.#day))
      || (this.#browsingDay == null && day !== Number(this.#day))) {
      this.#adoptDay(day);
    }
    if (Number(this.#day) !== day || this.#browsingDay != null) return;
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

  #adoptDay(value, { forceReplay = false, browsing = false } = {}) {
    const day = Number(value);
    if (!Number.isInteger(day) || day <= 0) return false;
    const sameDay = day === Number(this.#day);
    if (sameDay && !forceReplay) return false;
    const previousDay = Number(this.#day);
    const previousCurrentBet = this.#currentBetWei;
    const rolloverCarry = !forceReplay
      && !browsing
      && Number.isInteger(previousDay)
      && day === previousDay + 1
      && previousCurrentBet != null
      && this.#asWei(previousCurrentBet) > 0n
      && this.#dashboardAddress
      ? {
          day,
          address: this.#dashboardAddress,
          wei: this.#asWei(previousCurrentBet),
          promoted: false,
        }
      : null;
    // Invalidate every task launched for the previous deployment/day before
    // clearing the presentation state. The next coalesced refresh starts from
    // the newly adopted direct-chain day.
    this.#fetchSeq += 1;
    this.#clearRevealTimer();
    this.#clearBafTransfer({ resetDone: true });
    this.#day = day;
    this.#browsingDay = browsing ? day : null;
    this.#forceReplayDay = forceReplay ? day : null;
    this.#flipResult = null;
    this.#flipFetchedDay = null;
    this.#landing = false;
    this.#revealRequestedDay = null;
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
    this.#bafScore = null;
    this.#bafLevel = null;
    this.#bafAddress = null;
    this.#bafLookupKey = null;
    this.#clearLiveReverseAnimation();
    this.#clearResultTruthWindow();
    this.#reverseFlipQuote = null;
    this.#reverseVisualQueued = null;
    this.#showLiveSideOnCoin = false;
    this.#render();
    this.#scheduleRefresh();
    return true;
  }

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#active = true;
    this.#fundsExpanded = false;
    this.#renderShell();
    this.#syncFundsExpansion();
    this.#wireActions();
    this.#wireQuestPreset();
    this.#wireRewardSpoilerGate();

    this.#unsubs.push(subscribe('app.daySync', (sync) => this.#onDaySync(sync)));

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
      this.#bafScore = null;
      this.#bafLevel = null;
      this.#bafAddress = null;
      this.#bafLookupKey = null;
      this.#bafFlipEve = null;
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
      this.#bafScore = null;
      this.#bafLevel = null;
      this.#bafAddress = null;
      this.#bafLookupKey = null;
      this.#revealRequestedDay = null;
      this.#renderAutoRebuy({ syncDraft: true });
      this.#scheduleRefresh();
      const ballot = this.querySelector('[data-bind="df-charity-dialog"]');
      if (ballot && !ballot.hidden) this.#loadCharityVote();
    }));

    if (typeof setInterval === 'function') {
      this.#pollHandle = _setIntervalUnref(() => this.#scheduleRefresh(), POLL_INTERVAL_MS);
    }
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
      this.#txConfirmedListener = () => {
        // Refresh both minted FLIP and the claimable-first spending ledger.
        // The immediate read normally lands on the receipt block; one short
        // follow-up covers injected RPC replicas that trail it briefly.
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
    resetBalanceDisplay(this.querySelector('[data-bind="df-funds-wwxrp"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="df-funds-sdgnrs"]'));
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
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
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
    this.#clearFakeoutMeter();
    this.#clearRevealTimer();
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
    return this.#bonusJackpotCleared() && !this.#lootboxRewardGatePending();
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
    this.#meterRecoveryTail = false;
    this.#meterFlashVisible = true;
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
    const settle = () => this.#completeWinningMeter(revealDay);
    // animationend is the authoritative browser signal. The matching timer is
    // a fallback for headless/legacy environments where that event never fires.
    const marker = this.querySelector('[data-bind="df-modifier-marker"]');
    if (marker && typeof marker.addEventListener === 'function') {
      marker.addEventListener('animationend', settle, { once: true });
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
      this.#bafScore = null;
      this.#bafLevel = null;
      this.#bafAddress = address;
      this.#bafLookupKey = null;
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
            const score = await fetchJSON(`/player/${address}/baf?level=${level}`);
            return { level, score };
          })
          : Promise.resolve({ level: null, score: null }),
        (value) => {
          this.#bafAddress = address;
          this.#bafLevel = value?.level ?? null;
          this.#bafScore = value?.score ?? null;
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
        addr ? readFlipWidgetBalances({ player: addr }) : Promise.resolve(null),
        (value) => {
          this.#liveBalancesAddress = address;
          this.#liveBalances = value;
        },
        () => {
          this.#liveBalancesAddress = address;
          this.#liveBalances = null;
        },
      ),
      this.#runRefreshTask(
        seq,
        addr ? readCurrentCoinflipStake({ player: addr }) : Promise.resolve(null),
        (value) => {
          const next = value == null ? null : this.#asWei(value);
          this.#currentBetWei = next;
          const carry = this.#rolloverBetCarry;
          if (
            next === 0n
            && carry?.day === this.#day
            && carry.address === this.#dashboardAddress
          ) {
            carry.promoted = true;
            if (this.#resolvedBetWei == null) this.#resolvedBetWei = carry.wei;
          }
        },
        () => { this.#currentBetWei = null; },
      ),
      this.#runRefreshTask(
        seq,
        addr ? readCoinflipAutoRebuyInfo({ player: addr }) : Promise.resolve(null),
        (value) => {
          this.#autoRebuyAddress = address;
          this.#autoRebuyInfo = value;
        },
        () => {
          this.#autoRebuyAddress = address;
          this.#autoRebuyInfo = null;
        },
      ),
      this.#runRefreshTask(
        seq,
        addr ? readClaimableCoinflip({ player: addr }) : Promise.resolve(null),
        (value) => {
          this.#liveClaimableWei = value == null ? null : this.#asWei(value);
          this.#repairSettlement();
        },
        () => { this.#liveClaimableWei = null; },
      ),
      this.#runRefreshTask(
        seq,
        addr && requestedDay != null
          ? readResolvedCoinflipStake({ player: addr, day: requestedDay })
          : Promise.resolve(null),
        (value) => {
          if (value != null) {
            this.#resolvedBetWei = this.#asWei(value);
            this.#rolloverBetCarry = null;
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
        <h2 class="df-section-title">DAILY COINFLIP</h2>
        <div class="df-coin-stage">
          <div class="df-coin-zone" data-bind="df-coin-zone"></div>
          <div class="df-modifier-meter-slot" data-bind="df-modifier-meter-slot"></div>
          <button type="button" class="df-reveal-cue" data-bind="df-reveal-hint" hidden
                  aria-label="Reveal the coin flip">
            <strong class="df-reveal-cue__copy"><span>CLICK</span><span>TO FLIP</span></strong>
            <span class="df-reveal-cue__arrow" aria-hidden="true"></span>
          </button>
        </div>
        <p class="df-outcome" data-bind="df-outcome"></p>
        <div class="df-error" data-bind="df-error" hidden role="alert"></div>
        <div class="df-position" data-bind="df-position">
          <div class="df-position-slot" data-bind="df-position-today"></div>
          <button type="button" class="df-auto-rebuy-cta"
                  data-bind="df-auto-rebuy-cta" aria-haspopup="dialog"
                  aria-controls="df-auto-rebuy-dialog" aria-expanded="false">
            <span class="df-auto-rebuy-cta__icon" aria-hidden="true">↻</span>
            <strong class="df-auto-rebuy-cta__status"
                    data-bind="df-auto-rebuy-cta-status">—</strong>
          </button>
          <div class="df-baf-score" data-bind="df-baf-score-box" aria-label="Big Ass Flip score">
            <span class="df-baf-score__label">
              <a class="df-baf-score__info" href="/learn/baf/" aria-label="Learn about Big Ass Flip" title="Learn about Big Ass Flip">i</a>
              <span>BIG ASS FLIP SCORE</span>
            </span>
            <span class="df-baf-score__title">
              <span class="df-baf-score__unit">BAF</span>
              <small class="df-baf-score__rank" data-bind="df-baf-rank">RANK —</small>
            </span>
            <strong class="df-baf-score__value" data-bind="df-baf-score">—</strong>
          </div>
          <div class="df-tomorrow-layout">
            <span class="df-flip-group df-next-bet" data-bind="df-add-bet-controls">
              <span class="df-next-bet__stepper">
                <input type="number" name="df-amount" class="df-amount" min="0" step="100" value="1000" aria-label="FLIP to add to tomorrow's bet">
                <span class="df-next-bet__arrows" aria-hidden="false">
                  <button type="button" data-bind="df-bet-up" aria-label="Increase bet by 100 FLIP">▲</button>
                  <button type="button" data-bind="df-bet-down" aria-label="Decrease bet by 100 FLIP">▼</button>
                </span>
                <boon-product-indicator class="df-boon-indicator"
                                        product="coinflip"></boon-product-indicator>
              </span>
              <button type="button" class="df-flip-cta" data-write data-bind="df-flip-cta" aria-label="Add bet" title="Bet 1k">ADD BET</button>
            </span>
            <div class="df-position-slot" data-bind="df-position-tomorrow"></div>
          </div>
        </div>
        <div class="df-funds" data-bind="df-funds" aria-label="Protocol Coins">
          <button type="button" class="df-funds__title df-funds__toggle"
                  data-bind="df-funds-toggle" aria-expanded="false"
                  aria-controls="df-protocol-coins" aria-label="Show all Protocol Coins">
            <span>PROTOCOL COINS</span>
            <span class="df-funds__chevron" aria-hidden="true"></span>
          </button>
          <div class="df-funds__coins" id="df-protocol-coins" data-bind="df-funds-coins">
            <div class="df-funds__display df-funds__display--claimable df-funds__display--flip-total"
                 data-bind="df-funds-flip-total-box" aria-label="Owned plus claimable FLIP">
              <strong class="df-funds__value df-funds__value--flip-total">
                <span class="df-funds__number" data-bind="df-funds-flip-total">—</span>
                <span class="df-funds__unit" data-bind="df-funds-flip-unit">FLIP</span>
              </strong>
              <button type="button" class="df-claim-flip-cta" data-write data-write-locked
                      data-write-lock-title="Coinflip result is loading"
                      data-bind="df-claim-flip-cta" disabled>CLAIM</button>
            </div>
            <div class="df-funds__display df-funds__display--wwxrp" data-bind="df-funds-wwxrp-box" hidden
                 aria-label="WWXRP balance">
              <strong class="df-funds__value" data-bind="df-funds-wwxrp">—</strong>
              <button type="button" class="df-burn-wwxrp-cta" data-write data-write-locked
                      data-write-lock-title="WWXRP balance is loading"
                      data-bind="df-burn-wwxrp-cta" aria-haspopup="dialog">BURN</button>
            </div>
            <div class="df-funds__display df-funds__display--sdgnrs" data-bind="df-funds-sdgnrs-box" hidden
                 aria-label="sDGNRS balance">
              <strong class="df-funds__value" data-bind="df-funds-sdgnrs">—</strong>
              <span class="df-funds__sdgnrs-actions">
                <button type="button" class="df-charity-vote-cta"
                        data-bind="df-charity-vote-cta" aria-haspopup="dialog">VOTE</button>
                <button type="button" class="df-burn-sdgnrs-cta" data-write data-write-locked
                        data-write-lock-title="sDGNRS balance is loading"
                        data-bind="df-burn-sdgnrs-cta" aria-haspopup="dialog">BURN</button>
              </span>
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
                <small>DAILY COINFLIP</small>
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
        <div class="df-reverse-dialog df-burn-dialog df-wwxrp-dialog"
             data-bind="df-wwxrp-dialog" hidden
             role="dialog" aria-modal="true" aria-labelledby="df-wwxrp-title">
          <div class="df-reverse-dialog__card df-burn-dialog__card">
            <button type="button" class="df-reverse-dialog__close"
                    data-bind="df-wwxrp-cancel" aria-label="Close WWXRP burn">×</button>
            <h3 id="df-wwxrp-title">Burn WWXRP</h3>
            <p class="df-reverse-dialog__copy">
              <span>Burn WWXRP for a weighted entry in today’s daily draw.</span>
              <span>The minimum is 25 WWXRP and burned tokens cannot be recovered.</span>
            </p>
            <label class="df-burn-dialog__amount">
              <span>Amount</span>
              <span class="df-burn-dialog__field">
                <input type="number" name="df-wwxrp-amount" min="25" step="1" value="25"
                       inputmode="decimal" aria-label="WWXRP to burn">
                <button type="button" data-bind="df-wwxrp-max">MAX</button>
              </span>
            </label>
            <div class="df-reverse-dialog__actions">
              <button type="button" class="df-reverse-dialog__later"
                      data-bind="df-wwxrp-cancel">Cancel</button>
              <button type="button" class="df-reverse-dialog__accept df-burn-dialog__accept"
                      data-write data-write-locked data-write-lock-title="Enter at least 25 WWXRP"
                      data-bind="df-wwxrp-accept">Burn</button>
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
    this.#renderBafFlipEve();
    this.#renderCoin();
    this.#renderModifierMeter();
    this.#renderPosition();
    this.#renderAutoRebuy();
    this.#renderFunds();
    this.#renderBafScore();
    this.#renderReverseFlip();
    this.#renderBetTooltip();
    this.#maybeStartLiveReverseAnimation();
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

  #renderBetTooltip() {
    const input = this.querySelector('[name="df-amount"]');
    const add = this.querySelector('[data-bind="df-flip-cta"]');
    if (!add) return;
    const abbreviated = compactBetAmount(input?.value ?? 0);
    add.title = `Bet ${abbreviated}`;
  }

  #stepBetAmount(direction) {
    const input = this.querySelector('[name="df-amount"]');
    if (!input) return;
    const current = Number(input.value);
    const step = Number(input.step || 100);
    const minimum = Number(input.min || 0);
    const next = Math.max(
      Number.isFinite(minimum) ? minimum : 0,
      (Number.isFinite(current) ? current : 0)
        + (Number(direction) < 0 ? -1 : 1) * (Number.isFinite(step) && step > 0 ? step : 100),
    );
    input.value = Number.isInteger(next)
      ? String(next)
      : String(Number(next.toFixed(6)));
    this.#renderBetTooltip();
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

  #wwxrpBalanceWei() {
    if (this.#liveBalancesAddress === this.#dashboardAddress
      && this.#liveBalances?.wwxrpBalance != null) {
      return this.#asWei(this.#liveBalances.wwxrpBalance);
    }
    if (this.#dashboard?.wwxrpBalance == null) return null;
    return this.#asWei(this.#dashboard.wwxrpBalance);
  }

  #ownsDisplayedWwxrp() {
    const connected = get('connected.address');
    return Boolean(connected && this.#dashboardAddress
      && String(connected).toLowerCase() === String(this.#dashboardAddress).toLowerCase());
  }

  #renderWwxrpBurn() {
    const button = this.querySelector('[data-bind="df-burn-wwxrp-cta"]');
    const accept = this.querySelector('[data-bind="df-wwxrp-accept"]');
    const input = this.querySelector('[name="df-wwxrp-amount"]');
    const balance = this.#wwxrpBalanceWei();
    const ownsBalance = this.#ownsDisplayedWwxrp();
    const hasMinimum = balance != null && balance >= MIN_WWXRP_BURN_WEI;
    const amount = parseTokenAmount(input?.value);
    const validAmount = amount != null
      && amount >= MIN_WWXRP_BURN_WEI
      && balance != null
      && amount <= balance;

    if (button) {
      const locked = this.#busy || !ownsBalance || !hasMinimum;
      button.disabled = locked;
      button.textContent = this.#busy ? 'WAIT' : 'BURN';
      if (locked) {
        const reason = this.#busy
          ? 'Transaction in progress'
          : !ownsBalance
            ? 'Open your own wallet view to burn WWXRP'
            : 'Minimum burn is 25 WWXRP';
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
          : 'Enter an amount from 25 through your WWXRP balance');
      } else {
        accept.removeAttribute('data-write-locked');
        accept.removeAttribute('data-write-lock-title');
      }
    }
  }

  #openWwxrpBurnDialog() {
    if (!this.#ownsDisplayedWwxrp()) return;
    const balance = this.#wwxrpBalanceWei();
    if (balance == null || balance < MIN_WWXRP_BURN_WEI) return;
    const dialog = this.querySelector('[data-bind="df-wwxrp-dialog"]');
    if (!dialog) return;
    const input = this.querySelector('[name="df-wwxrp-amount"]');
    const amount = parseTokenAmount(input?.value);
    if (input && (amount == null || amount < MIN_WWXRP_BURN_WEI || amount > balance)) {
      input.value = '25';
    }
    dialog.hidden = false;
    this.#renderWwxrpBurn();
    try { input?.focus?.({ preventScroll: true }); } catch (_e) { /* headless */ }
  }

  #closeWwxrpBurnDialog() {
    const dialog = this.querySelector('[data-bind="df-wwxrp-dialog"]');
    if (dialog) dialog.hidden = true;
    const button = this.querySelector('[data-bind="df-burn-wwxrp-cta"]');
    try { button?.focus?.(); } catch (_e) { /* headless */ }
  }

  #setMaxWwxrpBurn() {
    const balance = this.#wwxrpBalanceWei();
    const input = this.querySelector('[name="df-wwxrp-amount"]');
    if (!input || balance == null) return;
    input.value = tokenAmountInput(balance);
    this.#renderWwxrpBurn();
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
        ? `Daily jackpot and coinflip are syncing.${queuedSideLabel}`
        : resolving
        ? `Daily coinflip is resolving — click to reveal when ready.${queuedSideLabel}`
        : 'Reveal the daily coinflip result',
    );
    const inner = document.createElement('span');
    inner.className = 'df-coin3d__inner';
    const faceRed = document.createElement('span');
    faceRed.className = 'df-coin3d__face df-coin3d__face--red';
    const redImg = document.createElement('img');
    redImg.src = '/shared/coinflip-face-red.svg';
    redImg.alt = '';
    faceRed.appendChild(redImg);
    inner.appendChild(faceRed);
    const faceEth = document.createElement('span');
    faceEth.className = 'df-coin3d__face df-coin3d__face--eth';
    const ethImg = document.createElement('img');
    ethImg.src = '/shared/coinflip-face-eth.svg';
    ethImg.alt = '';
    faceEth.appendChild(ethImg);
    inner.appendChild(faceEth);
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
          reverseQueued: this.#reverseFlipQuote?.queued,
          resolutionLocked: Boolean(this.#reverseFlipQuote?.locked),
        });
      }
      return;
    }

    if (!hasResult) {
      if (outcome) {
        outcome.textContent = this.#day == null ? 'Waiting for the first resolved day…' : '';
      }
      // At rollover the jackpot payload generally arrives a few blocks before
      // the dedicated result read. Keep the neutral two-faced coin mounted and
      // clickable during that gap; a click queues the reveal for the exact day.
      if (this.#day != null && !this.#revealed()) {
        this.#appendSpinningCoin(zone, {
          resolving: true,
          reverseQueued: this.#reverseFlipQuote?.queued,
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

    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    if (!hasResult) {
      host.textContent = '';
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
      && (this.#meterSettling || this.#meterFlashVisible);
    const showFakeoutMeter = this.#landing
      && this.#fakeoutMeterVisible;
    if (!showWinningMeter && !showFakeoutMeter) {
      host.textContent = '';
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
    const position = ((pct - MODIFIER_MIN_PERCENT)
      / (MODIFIER_MAX_PERCENT - MODIFIER_MIN_PERCENT)) * 100;
    const totalPct = 100 + pct;

    if (showWinningMeter && this.#meterFlashVisible) {
      const displayKey = `${this.#day}:${totalPct}:flash`;
      const current = host.querySelector('.df-modifier-flash');
      if (current?.getAttribute('data-meter-key') === displayKey) return;
      host.textContent = '';
      const flash = document.createElement('div');
      flash.className = 'df-modifier-flash';
      flash.textContent = `${totalPct}%`;
      flash.setAttribute('data-meter-key', displayKey);
      flash.setAttribute('role', 'status');
      flash.setAttribute('aria-label', `${totalPct} percent total win multiplier`);
      host.appendChild(flash);
      return;
    }

    const meterClass = this.#landing
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
    const displayKey = `${this.#day}:${totalPct}:${meterClass}`;
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

    const scale = document.createElement('div');
    scale.className = 'df-modifier-meter__scale';
    for (const labelText of ['256%', '200%', '150%']) {
      const label = document.createElement('span');
      label.textContent = labelText;
      scale.appendChild(label);
    }
    meter.appendChild(scale);

    const track = document.createElement('div');
    track.className = 'df-modifier-meter__track';
    const marker = document.createElement('span');
    marker.className = 'df-modifier-meter__marker';
    marker.setAttribute('data-bind', 'df-modifier-marker');
    marker.style.bottom = `${position}%`;
    if (marker.style && typeof marker.style.setProperty === 'function') {
      marker.style.setProperty('--df-meter-stop', `${position}%`);
    }
    track.appendChild(marker);
    meter.appendChild(track);

    const readout = document.createElement('div');
    readout.className = 'df-modifier-meter__readout';
    readout.textContent = this.#landing
      ? (this.#fakeoutMeterDraining ? '150%' : `${totalPct}%`)
      : `${totalPct}%`;
    meter.appendChild(readout);
    host.appendChild(meter);
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
    const settlement = this.#activeSettlement();
    return settlement?.betWei
      ?? this.#resolvedBetWei
      ?? null;
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
    const settledTotal = settlement.claimableTotalWei == null
      ? settlement.claimableBaseWei + this.#settlementGainWei(settlement)
      : this.#asWei(settlement.claimableTotalWei);
    if (indexed > visible) visible = indexed;
    return settledTotal > visible ? settledTotal : visible;
  }

  #renderPosition() {
    const host = this.querySelector('[data-bind="df-position"]');
    if (!host) return;
    // Keep both day buckets mounted so a result never replaces one amount with
    // a different day's amount. Today becomes the one resolved receipt;
    // the live next-day stake remains safe to show beside its Add Bet controls.
    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    // A winning result is not visually committed until the thermometer reaches
    // its number. Its landing sound fires in that same completion task, so the
    // Today row cannot turn green ahead of either cue.
    const revealComplete = hasResult
      && this.#revealed()
      && !this.#landing
      && !(Boolean(this.#flipResult?.win) && this.#meterSettling);
    const resolvedStake = this.#resultStakeWei();
    const won = Boolean(this.#flipResult?.win);
    const modifier = Math.max(0, Math.trunc(Number(this.#flipResult?.rewardPercent) || 0));
    // The stake is not an outcome spoiler: show the exact committed amount
    // while the coin is waiting to be revealed, then replace that same value
    // with its settled receipt. A zero stake is equally safe and clearer as an
    // immediate NO BET than as a concealed placeholder.
    const noBet = resolvedStake != null && this.#asWei(resolvedStake) === 0n;
    const tomorrowGateOpen = this.#tomorrowRewardGateOpen()
      || this.#tomorrowSpoilerOverrideKey === this.#spoilerOverrideKey('tomorrow');
    const tomorrowKnown = this.#currentBetWei != null;
    const rows = [
      {
        key: 'today',
        label: "Today's bet",
        value: resolvedStake == null
          ? '—'
          : noBet
            ? 'NO BET'
            : revealComplete
              ? won
                ? `+${this.#fmtWhole(this.#winPayoutWei(resolvedStake, modifier))} FLIP`
                : `-${this.#fmtWhole(resolvedStake)} FLIP`
              : `${this.#fmtWhole(resolvedStake)} FLIP`,
        status: resolvedStake == null || !revealComplete || noBet
          ? null
          : won
            ? { outcome: 'WIN', percent: `${100 + modifier}%` }
            : { outcome: 'LOSS', percent: null },
        outcome: noBet ? 'no-bet' : revealComplete ? (won ? 'win' : 'loss') : null,
        spoiler: false,
      },
      {
        key: 'tomorrow',
        label: "Tomorrow's bet",
        number: !tomorrowKnown
          ? '—'
          : tomorrowGateOpen
            ? formatTomorrowBet(this.#currentBetWei)
            : '••••',
        unit: tomorrowKnown ? 'FLIP' : '',
        spoiler: tomorrowKnown && !tomorrowGateOpen,
      },
    ];
    for (const item of rows) {
      const slot = this.querySelector(`[data-bind="df-position-${item.key}"]`);
      if (!slot) continue;
      slot.textContent = '';
      const row = document.createElement('div');
      row.className = [
        'df-position-row',
        item.spoiler ? 'df-position-row--spoiler' : '',
        item.outcome ? `df-position-row--${item.outcome}` : '',
      ].filter(Boolean).join(' ');
      row.setAttribute('data-position', item.key);
      const l = document.createElement('span');
      l.className = 'df-position-label';
      l.textContent = item.label;
      // Every red ledger instrument uses the same hierarchy: title directly
      // above its right-aligned FLIP figure. The add controls remain a separate
      // compact lane inside Tomorrow's Bet.
      row.appendChild(l);
      if (item.status != null) {
        const multi = document.createElement('span');
        multi.className = 'df-position-multiplier';
        multi.setAttribute(
          'aria-label',
          [item.status.outcome, item.status.percent].filter(Boolean).join(' '),
        );
        const outcome = document.createElement('span');
        outcome.className = 'df-position-outcome';
        outcome.textContent = item.status.outcome;
        multi.appendChild(outcome);
        if (item.status.percent) {
          const percent = document.createElement('span');
          percent.className = 'df-position-percentage';
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
      if (item.spoiler) {
        result.setAttribute('role', 'button');
        result.setAttribute('tabindex', '0');
        result.setAttribute('title', 'Show this value anyway');
        result.setAttribute(
          'aria-label',
          'Hidden until jackpot and luckbox rewards are revealed. Activate to show anyway.',
        );
        result.addEventListener('click', (event) => this.#activateSpoilerValue('tomorrow', event));
        result.addEventListener('keydown', (event) => this.#activateSpoilerValue('tomorrow', event));
      }
      row.appendChild(result);
      slot.appendChild(row);
    }
  }

  #renderFunds() {
    const flipTotal = this.querySelector('[data-bind="df-funds-flip-total"]');
    const flipUnit = this.querySelector('[data-bind="df-funds-flip-unit"]');
    const flipTotalBox = this.querySelector('[data-bind="df-funds-flip-total-box"]');
    const claim = this.querySelector('[data-bind="df-claim-flip-cta"]');
    const wwxrp = this.querySelector('[data-bind="df-funds-wwxrp"]');
    const wwxrpBox = this.querySelector('[data-bind="df-funds-wwxrp-box"]');
    const sdgnrs = this.querySelector('[data-bind="df-funds-sdgnrs"]');
    const sdgnrsBox = this.querySelector('[data-bind="df-funds-sdgnrs-box"]');
    const visibleClaimable = this.#visibleClaimableWei();
    const liveBalances = this.#liveBalancesAddress === this.#dashboardAddress
      ? this.#liveBalances
      : null;
    const walletRaw = liveBalances?.flipBalance ?? this.#dashboard?.flipBalance ?? null;
    const walletWei = walletRaw == null ? null : this.#asWei(walletRaw);
    const protocolFlipWei = protocolFlipTotalWei(walletWei, visibleClaimable);
    const wwxrpWei = this.#wwxrpBalanceWei();
    const sdgnrsWei = this.#sdgnrsBalanceWei();
    const hasResult = this.#day != null
      && this.#flipFetchedDay === this.#day
      && this.#flipResult != null;
    const revealComplete = hasResult
      && this.#revealed()
      && !this.#landing
      && !(Boolean(this.#flipResult?.win) && this.#meterSettling);
    const flipTotalVisible = revealComplete
      || this.#flipTotalSpoilerOverrideKey === this.#spoilerOverrideKey('flip-total');
    if (flipUnit) flipUnit.textContent = 'FLIP';
    if (flipTotal) {
      updateBalanceDisplay(flipTotal, {
        container: flipTotalBox,
        scope: this.#dashboardAddress == null ? null : `${this.#dashboardAddress}:flip-total`,
        // Protocol Coins is the player's effective FLIP total: minted wallet
        // FLIP plus every still-unclaimed coinflip payout. Claiming merely
        // moves value between those two ledgers, so the displayed total stays
        // stable through the transaction.
        value: protocolFlipWei,
        visible: flipTotalVisible,
        format: (raw) => raw === 0n ? '-' : this.#fmtWhole(raw),
        formatDelta: (delta) => `+${this.#fmtWhole(delta)} FLIP`,
        hiddenText: '••••',
      });
      if (flipTotalVisible) {
        flipTotal.removeAttribute('aria-hidden');
        flipTotal.removeAttribute('aria-label');
        flipTotal.removeAttribute('role');
        flipTotal.removeAttribute('tabindex');
        flipTotal.removeAttribute('title');
      } else {
        flipTotal.removeAttribute('aria-hidden');
        flipTotal.setAttribute('aria-label', 'FLIP total hidden. Activate to show anyway.');
        flipTotal.setAttribute('role', 'button');
        flipTotal.setAttribute('tabindex', '0');
        flipTotal.setAttribute('title', 'Show this value anyway');
      }
    }
    flipTotalBox?.classList?.toggle('df-funds__display--spoiler', !flipTotalVisible);
    // Publish the disclosure result only after the owning Protocol Coins cell
    // has adopted it. The left-side FLIP Balance mirrors this account-scoped
    // state instead of attempting to recreate the reveal/landing rules.
    const disclosureAddress = this.#dashboardAddress == null
      ? null
      : String(this.#dashboardAddress).toLowerCase();
    const currentDisclosure = get('ui.protocolCoinsFlipDisclosure');
    if (currentDisclosure?.address !== disclosureAddress
      || currentDisclosure?.visible !== flipTotalVisible) {
      update('ui.protocolCoinsFlipDisclosure', {
        address: disclosureAddress,
        visible: flipTotalVisible,
      });
    }
    if (claim) {
      const connected = Boolean(get('connected.address'));
      const canClaim = revealComplete && !this.#busy && visibleClaimable > 0n && connected;
      claim.disabled = !canClaim;
      claim.textContent = this.#busy ? 'WAIT' : 'CLAIM';
      if (canClaim) {
        claim.removeAttribute('data-write-locked');
        claim.removeAttribute('data-write-lock-title');
      } else {
        const reason = this.#busy
          ? 'Another Coinflip action is processing'
          : !connected
            ? 'Connect a wallet to claim'
            : !revealComplete
              ? 'Reveal the Coinflip result before claiming'
              : 'No FLIP winnings to claim';
        claim.setAttribute('data-write-locked', '');
        claim.setAttribute('data-write-lock-title', reason);
      }
    }
    updateBalanceDisplay(wwxrp, {
      container: wwxrpBox,
      scope: this.#dashboardAddress,
      value: wwxrpWei,
      format: (raw) => raw === 0n ? '- WWXRP' : `${this.#fmtWhole(raw)} WWXRP`,
      formatDelta: (delta) => `+${this.#fmtWhole(delta)} WWXRP`,
    });
    updateBalanceDisplay(sdgnrs, {
      container: sdgnrsBox,
      scope: this.#dashboardAddress,
      value: sdgnrsWei,
      format: (raw) => raw === 0n ? '- sDGNRS' : `${this.#fmtSdgnrs(raw)} sDGNRS`,
      formatDelta: (delta) => `+${this.#fmtSdgnrs(delta)} sDGNRS`,
    });
    if (sdgnrs) {
      const exact = sdgnrsWei == null ? null : `${tokenAmountInput(sdgnrsWei)} sDGNRS`;
      sdgnrs.title = exact || '';
      if (exact) sdgnrs.setAttribute('aria-label', `sDGNRS balance: ${exact}`);
      else sdgnrs.removeAttribute('aria-label');
    }
    this.#renderWwxrpBurn();
    this.#renderSdgnrsBurn();
  }

  #syncFundsExpansion() {
    const toggle = this.querySelector('[data-bind="df-funds-toggle"]');
    const coins = this.querySelector('[data-bind="df-funds-coins"]');
    const expanded = this.#fundsExpanded === true;
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute(
        'aria-label',
        expanded ? 'Show only FLIP' : 'Show all Protocol Coins',
      );
    }
    if (coins?.dataset) coins.dataset.expanded = String(expanded);
    for (const name of ['df-funds-wwxrp-box', 'df-funds-sdgnrs-box']) {
      const row = this.querySelector(`[data-bind="${name}"]`);
      if (row) row.hidden = !expanded;
    }
  }

  #toggleFundsExpansion() {
    this.#fundsExpanded = !this.#fundsExpanded;
    this.#syncFundsExpansion();
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
      && !(Boolean(this.#flipResult?.win) && this.#meterSettling);
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
      format: (raw) => this.#fmtWhole(raw),
      formatDelta: (delta) => `+${this.#fmtWhole(delta)}`,
    });
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
    const revealPlan = selectFlipRevealPlan(revealDay, won);
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
        if (won) this.#bafLookupKey = null;
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
    const revealHint = this.querySelector('[data-bind="df-reveal-hint"]');
    if (revealHint) revealHint.hidden = true;
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
      inner.setAttribute('data-reveal-profile', revealPlan.profile);
      inner.setAttribute('data-reveal-win-rate', String(revealPlan.winRate));
      inner.setAttribute('data-reveal-ending', revealPlan.ending);
      if (inner.style && typeof inner.style.setProperty === 'function') {
        inner.style.setProperty('--df-track-duration', `${revealPlan.trackMs}ms`);
        inner.style.setProperty('--df-ending-duration', `${revealPlan.endingMs}ms`);
      }
    }
    this.#mountFakeoutReverseCards(revealPlan, won);
    this.#scheduleApparentWinMeters(revealDay, revealPlan, won);
    this.#scheduleCoinflipRevealSfx(revealDay, revealPlan, won);
    this.#renderModifierMeter();
    const outcome = this.querySelector('[data-bind="df-outcome"]');
    if (outcome) outcome.textContent = '';
    if (shouldFlashAllInDoIt(revealDay)) {
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

  #wireActions() {
    const fundsToggle = this.querySelector('[data-bind="df-funds-toggle"]');
    if (fundsToggle) fundsToggle.addEventListener('click', () => this.#toggleFundsExpansion());
    const revealHint = this.querySelector('[data-bind="df-reveal-hint"]');
    if (revealHint) revealHint.addEventListener('click', () => this.#onCoinClick(this.#day));
    const flip = this.querySelector('[data-bind="df-flip-cta"]');
    if (flip) flip.addEventListener('click', () => this.#runAction('flip'));
    const amount = this.querySelector('[name="df-amount"]');
    if (amount) amount.addEventListener('input', () => this.#renderBetTooltip());
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
    const betUp = this.querySelector('[data-bind="df-bet-up"]');
    if (betUp) betUp.addEventListener('click', () => this.#stepBetAmount(1));
    const betDown = this.querySelector('[data-bind="df-bet-down"]');
    if (betDown) betDown.addEventListener('click', () => this.#stepBetAmount(-1));
    const claim = this.querySelector('[data-bind="df-claim-flip-cta"]');
    if (claim) claim.addEventListener('click', () => this.#runAction('claim-flip'));
    const flipTotal = this.querySelector('[data-bind="df-funds-flip-total"]');
    if (flipTotal) {
      flipTotal.addEventListener('click', (event) => this.#activateSpoilerValue('flip-total', event));
      flipTotal.addEventListener('keydown', (event) => this.#activateSpoilerValue('flip-total', event));
    }
    const wwxrpBurn = this.querySelector('[data-bind="df-burn-wwxrp-cta"]');
    if (wwxrpBurn) wwxrpBurn.addEventListener('click', () => this.#openWwxrpBurnDialog());
    const wwxrpInput = this.querySelector('[name="df-wwxrp-amount"]');
    if (wwxrpInput) wwxrpInput.addEventListener('input', () => this.#renderWwxrpBurn());
    const wwxrpMax = this.querySelector('[data-bind="df-wwxrp-max"]');
    if (wwxrpMax) wwxrpMax.addEventListener('click', () => this.#setMaxWwxrpBurn());
    const wwxrpAccept = this.querySelector('[data-bind="df-wwxrp-accept"]');
    if (wwxrpAccept) wwxrpAccept.addEventListener('click', () => this.#runAction('burn-wwxrp'));
    for (const cancel of this.querySelectorAll('[data-bind="df-wwxrp-cancel"]')) {
      cancel.addEventListener('click', () => this.#closeWwxrpBurnDialog());
    }
    const wwxrpDialog = this.querySelector('[data-bind="df-wwxrp-dialog"]');
    if (wwxrpDialog) {
      wwxrpDialog.addEventListener('keydown', (event) => {
        if (event?.key === 'Escape') this.#closeWwxrpBurnDialog();
      });
      wwxrpDialog.addEventListener('click', (event) => {
        if (event?.target === wwxrpDialog) this.#closeWwxrpBurnDialog();
      });
    }
    const burn = this.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    if (burn) burn.addEventListener('click', () => this.#openSdgnrsBurnDialog());
    const burnInput = this.querySelector('[name="df-sdgnrs-amount"]');
    if (burnInput) burnInput.addEventListener('input', () => {
      this.#renderSdgnrsBurn();
      this.#refreshSdgnrsBurnQuote();
    });
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
      // Keep the control coherent even in browsers/webviews that reject a
      // synthetic Event constructor from a different realm.
      this.#renderBetTooltip();
      try { this.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_e) {}
      try { input.focus?.({ preventScroll: true }); } catch (_e) {}
    };
    document.addEventListener('quest:activate', this.#questActivateListener);
  }

  async #runAction(kind, options = {}) {
    if (this.#busy) return;
    this.#busy = true;
    if (kind === 'auto-rebuy') this.#autoRebuyError = '';
    this.#renderFunds();
    this.#renderAutoRebuy();
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
          const input = this.querySelector('[name="df-amount"]');
          const amountFloat = Number(input ? input.value : '0');
          if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
            throw new Error('Stake must be greater than 0 FLIP.');
          }
          // FLIP is UNSCALED 18-dec on every chain (only ETH /1M-scales).
          amount = BigInt(Math.round(amountFloat * 1e6)) * (10n ** 12n);
        }
        if (amount == null || amount <= 0n) throw new Error('Stake must be greater than 0 FLIP.');
        // The current contract handles its own claimable-first waterfall in
        // this one deposit. No separate claim signature is needed.
        await depositCoinflip({ player, amount });
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
      } else if (kind === 'claim-flip') {
        // Coinflip FLIP winnings — amount from the dashboard's
        // claimablePreview plus any just-landed win that the next dashboard
        // refresh has not absorbed yet.
        const amount = this.#visibleClaimableWei();
        if (amount <= 0n) throw new Error('Nothing to claim.');
        await claimFlip({ player, amount });
      } else if (kind === 'burn-wwxrp') {
        const input = this.querySelector('[name="df-wwxrp-amount"]');
        const amount = parseTokenAmount(input?.value);
        const balance = this.#wwxrpBalanceWei();
        if (amount == null || amount < MIN_WWXRP_BURN_WEI) {
          throw new Error('Minimum burn is 25 WWXRP.');
        }
        if (balance == null || amount > balance) {
          throw new Error('Not enough WWXRP for that burn.');
        }
        await burnWwxrp({ amount });
        this.#closeWwxrpBurnDialog();
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
      } else {
        this.#renderError(compactUiError(error));
      }
    } finally {
      setTimeout(() => {
        this.#busy = false;
        this.#renderFunds();
        this.#renderAutoRebuy();
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
