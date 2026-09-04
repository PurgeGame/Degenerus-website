// Full-width all-time records rail. Five permanent marks, one shared FLIP pool.
//
// This is the only surface in /app/ that shows something the game never resets.
// Levels turn over, jackpots resolve, the Decimator burns — these five numbers
// only ever go up, and the shared pot is funded by the game's settlement paths.
//
// The original four direct-action records claim at `mark + ceil(mark/5)`.
// Scheduled Dice Run is the fifth category and claims on every strict
// improvement above its 100x entry floor, so its target track closes the gap.

import {
  accruedPayoutWei,
  accruedShareBps,
  candidateRecordPayoutWei,
  fetchRecords,
  fetchProfiles,
  formatRecordValue,
  readLiveRecordMark,
  readPreviousDiceRunRecord,
  recordClaimTarget,
  recordClaimTargetForMark,
  RECORD_KIND_BUY,
  RECORD_KIND_DICE_RUN,
  RECORD_KIND_FLIP,
  RECORD_KIND_LUCKBOX,
  RECORD_KIND_SPIN,
  shortAddress,
} from '../app/records.js';
import { displayEthCompact, displayToken } from '../app/scaling.js';
import { TX_CONFIRMED_EVENT } from '../app/contracts.js';
import { registerComponentPoll } from '../app/component-poll.js';
import {
  readPurchaseQuote,
  ticketCostFromTickets,
} from '../app/lootbox.js';
import { ETH_DIVISOR } from '../app/chain-config.js';
import { degeneretteLimits } from '../app/degenerette.js';
import { questCompletionBonusModel } from '../app/quest-objectives.js';
import { get, getActingAddress, getViewedAddress, subscribe, update } from '../app/store.js';
import {
  readBiggestBountiesModePreference,
  subscribeUiPreferences,
} from '../app/ui-preferences.js';
import { openCrapsReplayTable } from '../craps/replay-adapter.js';
import { crapsReplayFetch } from '../craps/replay-fetch.js';

const POLL_MS = 15_000;
const PROFILE_LINKED_EVENT = 'degenerus:discord-profile-linked';
const BOUNTY_SOURCE = 'records-bounty';
const DISPLAY_ETH_UNIT = 10n ** 18n;
export const BIGGEST_SPIN_PRICE_STEP_WEI = (
  (10n ** 15n) / BigInt(ETH_DIVISOR)
) || 1n;
export const BIGGEST_SPIN_MAX_SPINS = degeneretteLimits(0)?.maxSpins ?? 25;

/** Fill share for the four records whose claim target is exactly 120% of the mark. */
const MARK_FILL_PERCENT = 100 / 1.2;
const DISPLAY_KIND_ORDER = new Map([
  [RECORD_KIND_SPIN, 0],
  [RECORD_KIND_LUCKBOX, 1],
  [RECORD_KIND_BUY, 2],
  [RECORD_KIND_FLIP, 3],
  [RECORD_KIND_DICE_RUN, 4],
]);

const RECORD_CARD_ART = '/app/assets/biggest-bounty-card-v13.webp';

const RECORD_KIND_CARD_TITLE = new Map([
  [RECORD_KIND_DICE_RUN, 'DICE RUN'],
  [RECORD_KIND_SPIN, 'DEGENERETTE'],
  [RECORD_KIND_LUCKBOX, 'LUCKBOX'],
  [RECORD_KIND_BUY, 'PACK RIPPED'],
  [RECORD_KIND_FLIP, 'COINFLIP'],
]);

export function recordBountyQuestProduct(kind) {
  const value = Number(kind);
  if (value === RECORD_KIND_BUY) return 'purchase';
  if (value === RECORD_KIND_LUCKBOX) return 'lootbox';
  if (value === RECORD_KIND_FLIP) return 'coinflip';
  if (value === RECORD_KIND_SPIN) return 'degenerette-eth';
  return null;
}

let _fetchRecords = fetchRecords;
let _fetchProfiles = fetchProfiles;
let _readLiveRecordMark = readLiveRecordMark;
let _readPurchaseQuote = readPurchaseQuote;

function group(value) {
  const [whole, fraction] = String(value ?? '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

/** Poker-chip-sized FLIP amount with at most two significant figures. */
export function formatCompactBountyWei(value) {
  let raw;
  try { raw = BigInt(value ?? 0); } catch (_e) { return '—'; }
  if (raw < 0n) raw = -raw;
  const whole = raw / (10n ** 18n);
  if (whole === 0n) return raw > 0n ? '<1' : '0';
  const digits = whole.toString().length;
  const quantum = digits > 2 ? 10n ** BigInt(digits - 2) : 1n;
  const rounded = quantum > 1n
    ? ((whole + (quantum / 2n)) / quantum) * quantum
    : whole;
  const units = [
    [10n ** 15n, 'Q'],
    [10n ** 12n, 'T'],
    [10n ** 9n, 'B'],
    [10n ** 6n, 'M'],
    [10n ** 3n, 'K'],
  ];
  const unit = units.find(([threshold]) => rounded >= threshold);
  if (!unit) return group(rounded.toString());
  const [divisor, suffix] = unit;
  const tenths = (rounded * 10n) / divisor;
  if (tenths < 100n && tenths % 10n !== 0n) {
    return `${tenths / 10n}.${tenths % 10n}${suffix}`;
  }
  return `${rounded / divisor}${suffix}`;
}

function formatCompactWholeDown(value) {
  let whole;
  try { whole = BigInt(value ?? 0); } catch (_e) { return '—'; }
  if (whole < 0n) whole = -whole;
  if (whole < 1_000n) return group(whole.toString());
  const digits = whole.toString().length;
  const quantum = 10n ** BigInt(Math.max(0, digits - 3));
  const truncated = (whole / quantum) * quantum;
  const units = [
    [10n ** 15n, 'Q'],
    [10n ** 12n, 'T'],
    [10n ** 9n, 'B'],
    [10n ** 6n, 'M'],
    [10n ** 3n, 'K'],
  ];
  const [divisor, suffix] = units.find(([threshold]) => truncated >= threshold)
    || [1n, ''];
  const hundredths = (truncated * 100n) / divisor;
  const scaledWhole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${scaledWhole}.${fraction}${suffix}` : `${scaledWhole}${suffix}`;
}

function formatCompactEthRecord(value) {
  let raw;
  try { raw = BigInt(value ?? 0); } catch (_e) { return '—'; }
  if (raw < 0n) raw = -raw;
  const unit = 10n ** 18n;
  const displayWei = raw * BigInt(ETH_DIVISOR);
  const whole = displayWei / unit;
  if (whole >= 1_000n) return formatCompactWholeDown(whole);

  const wholeText = whole.toString();
  const fractionText = (displayWei % unit).toString().padStart(18, '0');
  if (whole > 0n) {
    const fractionDigits = Math.max(0, 3 - wholeText.length);
    const fraction = fractionText.slice(0, fractionDigits).replace(/0+$/, '');
    return fraction ? `${wholeText}.${fraction}` : wholeText;
  }
  const firstSignificant = fractionText.search(/[1-9]/);
  if (firstSignificant < 0) return '0';
  const fraction = fractionText.slice(0, firstSignificant + 3).replace(/0+$/, '');
  return `0.${fraction}`;
}

/** Short display-only record amount; the title and expanded card stay exact. */
export function formatCompactRecordValue(kind, raw) {
  if (Number(kind) === RECORD_KIND_DICE_RUN) {
    let bps = 0n;
    try { bps = BigInt(raw ?? 0); } catch (_e) { /* use zero */ }
    if (bps < 0n) bps = -bps;
    const wholeDigits = (bps / 10_000n).toString().length;
    const decimalDigits = Math.max(0, 3 - wholeDigits);
    const quantum = 10n ** BigInt(Math.max(0, 4 - decimalDigits));
    const value = formatRecordValue(kind, (bps / quantum) * quantum);
    return { amount: `${value.amount}x`, suffix: '' };
  }
  if (Number(kind) === RECORD_KIND_BUY) {
    return { amount: formatCompactWholeDown(raw), suffix: 'TIX' };
  }
  if (Number(kind) === RECORD_KIND_FLIP) {
    let whole = 0n;
    try { whole = BigInt(raw ?? 0) / (10n ** 18n); } catch (_e) { /* use zero */ }
    return { amount: formatCompactWholeDown(whole), suffix: 'FLIP' };
  }
  if ([RECORD_KIND_SPIN, RECORD_KIND_LUCKBOX].includes(Number(kind))) {
    return { amount: formatCompactEthRecord(raw), suffix: 'ETH' };
  }
  return formatRecordValue(kind, raw);
}

/** Display order only; on-chain record kind IDs remain unchanged. */
export function orderBiggestRecords(records) {
  return [...(Array.isArray(records) ? records : [])].sort((a, b) => (
    (DISPLAY_KIND_ORDER.get(Number(a?.kind)) ?? Number.MAX_SAFE_INTEGER)
      - (DISPLAY_KIND_ORDER.get(Number(b?.kind)) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function nonNegativeWei(value) {
  try {
    const parsed = BigInt(value ?? 0);
    return parsed > 0n ? parsed : 0n;
  } catch (_e) {
    return 0n;
  }
}

/** Parse a player-facing ETH decimal into the active deployment's raw wei. */
export function parseRecordBountyEthInput(value) {
  const match = /^\s*(?:(\d+)(?:\.(\d{0,18}))?|\.(\d{1,18}))\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  try {
    const whole = match[1] || '0';
    const fraction = (match[2] || match[3] || '').padEnd(18, '0');
    const fullScale = (BigInt(whole) * DISPLAY_ETH_UNIT) + BigInt(fraction || '0');
    return fullScale / BigInt(ETH_DIVISOR);
  } catch (_e) {
    return null;
  }
}

function divideRoundUp(value, divisor) {
  return value <= 0n ? 0n : (value + divisor - 1n) / divisor;
}

function roundUpTo(value, quantum) {
  return divideRoundUp(value, quantum) * quantum;
}

/**
 * Apply the player's Degenerette controls while preserving the record floor.
 * The contract judges total ETH across the bet, so the minimum price per spin
 * is ceil(live target / spins), rounded upward to a player-readable .001 ETH
 * notch, not the whole target repeated on every reel.
 */
export function recordBountySpinSelection(quote, {
  spinCount = quote?.spinCount ?? 1,
  amountPerSpinWei = quote?.amountPerSpinWei ?? quote?.targetWei,
} = {}) {
  if (!quote || Number(quote.kind) !== RECORD_KIND_SPIN) return quote ?? null;
  const count = Number(spinCount);
  if (!Number.isInteger(count) || count < 1 || count > BIGGEST_SPIN_MAX_SPINS) return null;
  const targetWei = nonNegativeWei(quote.targetWei);
  if (targetWei <= 0n) return null;
  const minimumPerSpinWei = roundUpTo(
    divideRoundUp(targetWei, BigInt(count)),
    BIGGEST_SPIN_PRICE_STEP_WEI,
  );
  let perSpinWei = nonNegativeWei(amountPerSpinWei);
  if (perSpinWei < minimumPerSpinWei) perSpinWei = minimumPerSpinWei;
  perSpinWei = roundUpTo(perSpinWei, BIGGEST_SPIN_PRICE_STEP_WEI);
  return {
    ...quote,
    spinCount: count,
    amountPerSpinWei: perSpinWei,
    minimumPerSpinWei,
    costWei: perSpinWei * BigInt(count),
  };
}

/** Build the exact one-action preset represented by a Biggest bubble. */
export function recordBountyTransactionQuote({
  state,
  kind,
  liveMarkWei = null,
  ticketPriceWei = null,
  today = null,
} = {}) {
  const recordKind = Number(kind);
  // Dice Run can only be established by the finalized winner of a scheduled
  // Craps field. There is no honest one-click transaction preset for its card.
  if (recordKind === RECORD_KIND_DICE_RUN) return null;
  const record = Array.isArray(state?.records)
    ? state.records.find((entry) => Number(entry?.kind) === recordKind)
    : null;
  if (!record) return null;

  const hasLiveMark = liveMarkWei != null;
  const liveMark = hasLiveMark ? nonNegativeWei(liveMarkWei) : null;
  const targetWei = hasLiveMark
    ? recordClaimTargetForMark(recordKind, liveMark)
    : recordClaimTarget(state, recordKind);
  if (targetWei == null || targetWei <= 0n) return null;

  let costWei = targetWei;
  if (recordKind === RECORD_KIND_BUY) {
    const ticketCount = Number(targetWei);
    const price = nonNegativeWei(ticketPriceWei);
    if (!Number.isSafeInteger(ticketCount) || ticketCount <= 0 || price <= 0n) return null;
    costWei = ticketCostFromTickets(price, ticketCount);
  }

  // A chain mark newer than the indexed row gives us an exact target but not
  // the private claim clock that prices its share. Show the live pool as
  // loading until the event lands instead of attaching the old holder's payout.
  const indexedMark = nonNegativeWei(record.value);
  const clockMatchesMark = !hasLiveMark || indexedMark === liveMark;
  const payoutWei = clockMatchesMark
    ? candidateRecordPayoutWei({ state, kind: recordKind, candidate: targetWei, today })
    : null;

  const action = recordKind === RECORD_KIND_FLIP
    ? "ONE COINFLIP DEPOSIT"
    : recordKind === RECORD_KIND_SPIN
      ? 'DEGENERETTE BET'
      : recordKind === RECORD_KIND_LUCKBOX
        ? 'ONE LUCKBOX BUY'
        : 'ONE TICKET BUY';
  const quote = {
    kind: recordKind,
    meta: record.meta,
    action,
    targetWei,
    costWei,
    payoutWei,
    liveMarkWei: liveMark,
    currency: recordKind === RECORD_KIND_FLIP ? 'FLIP' : 'ETH',
  };
  return recordKind === RECORD_KIND_SPIN
    ? recordBountySpinSelection(quote)
    : quote;
}

/** The event payload consumed by the app's existing guarded action panels. */
export function recordBountyActivationDetail(quote) {
  if (!quote || quote.targetWei == null) return null;
  const common = {
    source: BOUNTY_SOURCE,
    variant: 'bounty',
    submit: true,
  };
  if (quote.kind === RECORD_KIND_FLIP) {
    return { ...common, questType: 2, target: String(quote.targetWei) };
  }
  if (quote.kind === RECORD_KIND_SPIN) {
    const spinCount = Number(quote.spinCount ?? 1);
    const amountPerSpinWei = nonNegativeWei(quote.amountPerSpinWei ?? quote.targetWei);
    if (!Number.isInteger(spinCount)
      || spinCount < 1
      || spinCount > BIGGEST_SPIN_MAX_SPINS
      || amountPerSpinWei * BigInt(spinCount) < nonNegativeWei(quote.targetWei)) return null;
    return {
      ...common,
      questType: 7,
      target: String(amountPerSpinWei * BigInt(spinCount)),
      amountPerSpin: String(amountPerSpinWei),
      spinCount,
      preferClaimable: true,
    };
  }
  if (quote.kind === RECORD_KIND_LUCKBOX) {
    return {
      ...common,
      questType: 6,
      target: String(quote.targetWei),
      preferClaimable: true,
      useAfking: true,
    };
  }
  if (quote.kind === RECORD_KIND_BUY) {
    return {
      ...common,
      questType: 1,
      target: String(quote.costWei),
      ticketQuantity: String(quote.targetWei),
      purchaseKind: 'ticket',
      preferClaimable: true,
      useAfking: true,
    };
  }
  return null;
}

/** Escape for interpolation into innerHTML. Holder names are user-controlled. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Stable repaint key for snapshots containing bigint values and profile Maps. */
export function renderSnapshotKey(value) {
  try {
    return JSON.stringify(value, (_key, entry) => {
      if (typeof entry === 'bigint') return `bigint:${entry}`;
      if (entry instanceof Map) {
        return [...entry.entries()].sort(([left], [right]) => (
          String(left).localeCompare(String(right))
        ));
      }
      return entry;
    });
  } catch (_e) {
    return null;
  }
}

/**
 * A deterministic two-letter monogram for a holder with no linked Discord
 * account, so every card carries a portrait rather than an empty ring.
 */
export function addressMonogram(address) {
  const hex = String(address || '').replace(/^0x/i, '').toUpperCase();
  return hex.length >= 2 ? hex.slice(0, 2) : '··';
}

/**
 * Hue derived from the address so the same holder keeps the same portrait
 * colour across cards and sessions.
 */
export function addressHue(address) {
  const hex = String(address || '').replace(/^0x/i, '').slice(0, 6);
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed % 360 : 0;
}

class AppRecordsRail extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #timer = null;
  #txConfirmedListener = null;
  #profileLinkedListener = null;
  #seq = 0;
  #state = null;
  #profiles = new Map();
  #viewedAddress = null;
  #noticeTimer = null;
  #bountyDialogQuote = null;
  #bountyDialogKind = null;
  #bountyDialogBusy = false;
  #bountyDialogLoading = false;
  #bountyDialogSeq = 0;
  #bountySpinDraftValid = true;
  #diceRunReplayOpening = false;
  #daySyncDay = null;
  #renderedStateKey = null;
  #renderedProfilesKey = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireBountyDialog();
    for (const key of ['connected.address', 'viewing.address']) {
      this.#unsubs.push(subscribe(key, () => {
        this.#viewedAddress = getViewedAddress?.() || getActingAddress?.() || null;
        this.#render();
      }));
    }
    // The accrued share grows every game day, so a rollover re-prices all four
    // cards without needing a poll. Only the DAY matters here — daySync also
    // republishes on reverse-flip queue movement and RNG phase flips, and a
    // full card rebuild for each of those is pure churn.
    this.#unsubs.push(subscribe('app.daySync', (state) => {
      const day = Number(state?.day) || null;
      if (day === this.#daySyncDay) return;
      this.#daySyncDay = day;
      this.#render();
    }));
    this.#unsubs.push(subscribe('ui.questObjectives', () => {
      if (this.#bountyDialogQuote) this.#renderBountyQuestBonus();
    }));
    this.#unsubs.push(subscribeUiPreferences(({ name }) => {
      if (name !== 'biggestBountiesMode') return;
      if (readBiggestBountiesModePreference() !== 'on') {
        this.#closeBountyDialog({ restoreFocus: false });
      }
      this.#render();
    }));
    // A record can be hit by a flip, Degenerette spin, luckbox, or ticket buy.
    // Every app write publishes this event after its receipt, so re-read the
    // authoritative on-chain pool immediately instead of leaving the winning
    // player looking at the pre-payout balance until the interval fires.
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#txConfirmedListener = () => { void this.#refresh(); };
      document.addEventListener(TX_CONFIRMED_EVENT, this.#txConfirmedListener);
      // Discord OAuth can finish between the 15-second records polls. Re-read
      // just the public holder identities as soon as the link tab returns.
      this.#profileLinkedListener = () => { void this.#refreshProfiles(); };
      document.addEventListener(PROFILE_LINKED_EVENT, this.#profileLinkedListener);
    }
    this.#timer = registerComponentPoll(() => this.#refresh(), POLL_MS);
    void this.#refresh();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs) {
      try { unsubscribe(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#txConfirmedListener && typeof document !== 'undefined') {
      try { document.removeEventListener?.(TX_CONFIRMED_EVENT, this.#txConfirmedListener); }
      catch (_e) { /* defensive */ }
    }
    this.#txConfirmedListener = null;
    if (this.#profileLinkedListener && typeof document !== 'undefined') {
      try { document.removeEventListener?.(PROFILE_LINKED_EVENT, this.#profileLinkedListener); }
      catch (_e) { /* defensive */ }
    }
    this.#profileLinkedListener = null;
    if (typeof this.#timer === 'function') this.#timer();
    this.#timer = null;
    if (this.#noticeTimer != null) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = null;
    this.#closeBountyDialog({ restoreFocus: false });
    this.#seq += 1;
    this.#initialized = false;
  }

  #renderShell() {
    this.hidden = true;
    this.innerHTML = `
      <section class="records-rail" data-bind="records-shell" hidden aria-labelledby="records-rail-title">
        <details class="records-rail__disclosure">
          <summary class="records-rail__summary" title="Show or hide full bounty details">
          <span class="records-rail__identity">
            <span class="records-rail__wordmark" id="records-rail-title" role="heading"
                  aria-level="2" aria-label="The Biggest Bounties">
              <img src="/app/assets/biggest-bounty-wordmark-v39-clean-pillowed-painted-wood.webp"
                   alt="" aria-hidden="true" loading="lazy" decoding="async">
            </span>
          </span>

          <span class="records-rail__leaders" data-bind="records-leaders"
                role="group" aria-label="The five current Biggest records"></span>

          <span class="records-rail__toggle" aria-hidden="true">
            <span class="records-rail__chevron"></span>
          </span>
          </summary>

          <div class="records-rail__expanded">
            <div class="records-rail__expanded-intro">
              <span class="records-rail__rule">Hit an open minimum. The original four pay at +20%; Dice Run pays on any new high.</span>
            </div>
            <ol class="records-rail__cards" data-bind="records-cards" aria-label="Full details for the five all-time records"></ol>
          </div>
        </details>
        <span class="records-rail__notice" data-bind="records-bounty-notice"
              role="status" aria-live="polite" hidden></span>
      </section>
      <div class="records-bounty-dialog" data-bind="records-bounty-dialog" hidden
           role="dialog" aria-modal="true" aria-labelledby="records-bounty-title">
        <button type="button" class="records-bounty-dialog__backdrop"
                data-bind="records-bounty-close" aria-label="Close bounty transaction"></button>
        <section class="records-bounty-dialog__card">
          <button type="button" class="records-bounty-dialog__close"
                  data-bind="records-bounty-close" aria-label="Close bounty transaction">×</button>
          <header class="records-bounty-dialog__hero">
            <span class="records-bounty-dialog__sigil" aria-hidden="true">
              <img src="/app/assets/biggest-bounty-emblem.webp" alt="" loading="lazy" decoding="async">
            </span>
            <span class="records-bounty-dialog__heading">
              <span class="records-bounty-dialog__eyebrow">THE BIGGEST BOUNTY</span>
              <h3 id="records-bounty-title" data-bind="records-bounty-title">BIGGEST PACK RIPPED</h3>
            </span>
          </header>
          <section class="records-bounty-dialog__headline" aria-label="Current bounty on this record">
            <small>BOUNTY ON THE LINE</small>
            <strong>
              <img src="/whitepaper/flame-logo-split.svg" alt="FLIP">
              <b data-bind="records-bounty-payout">—</b>
            </strong>
            <span>BREAK THE RECORD. TAKE THE BOUNTY.</span>
          </section>
          <section class="records-bounty-dialog__spin-controls"
                   data-bind="records-bounty-spin-controls"
                   aria-label="Degenerette bounty bet controls" hidden>
            <label class="records-bounty-dialog__spin-field">
              <span>SPINS</span>
              <span class="records-bounty-dialog__stepper">
                <button type="button" data-bind="records-bounty-spins-down"
                        aria-label="Decrease spins">−</button>
                <input type="number" inputmode="numeric" min="1"
                       max="${BIGGEST_SPIN_MAX_SPINS}" step="1" value="1"
                       data-bind="records-bounty-spins" aria-label="Number of spins">
                <button type="button" data-bind="records-bounty-spins-up"
                        aria-label="Increase spins">+</button>
              </span>
            </label>
            <label class="records-bounty-dialog__spin-field records-bounty-dialog__spin-field--price">
              <span>PRICE / SPIN</span>
              <span class="records-bounty-dialog__price-input">
                <input type="text" inputmode="decimal" autocomplete="off"
                       data-bind="records-bounty-spin-price" aria-label="ETH price per spin"
                       aria-description="Rounded up to the nearest 0.001 ETH">
                <b>ETH</b>
              </span>
            </label>
            <p class="records-bounty-dialog__spin-floor">
              <strong data-bind="records-bounty-spin-min">—</strong>
              <span data-bind="records-bounty-spin-target">—</span>
            </p>
          </section>
          <p class="records-bounty-dialog__quest-bonus" data-bind="records-bounty-quest-bonus"
             role="status" hidden></p>
          <p class="records-bounty-dialog__alert" data-bind="records-bounty-alert"
             aria-live="polite" hidden></p>
          <button type="button" class="records-bounty-dialog__confirm" data-write
                  data-bind="records-bounty-confirm">
            <span class="records-bounty-dialog__confirm-copy">
              <small data-bind="records-bounty-confirm-action">CONFIRM EXACT SHOT</small>
              <strong data-bind="records-bounty-confirm-amount">—</strong>
            </span>
          </button>
        </section>
      </div>
    `;
  }

  #wireBountyDialog() {
    for (const close of this.querySelectorAll?.('[data-bind="records-bounty-close"]') || []) {
      close.addEventListener('click', () => this.#closeBountyDialog());
    }
    const confirm = this.querySelector('[data-bind="records-bounty-confirm"]');
    if (confirm) confirm.addEventListener('click', () => { void this.#confirmBountyDialog(); });
    const spins = this.querySelector('[data-bind="records-bounty-spins"]');
    if (spins) spins.addEventListener('input', () => this.#setBountySpinCount(spins.value));
    const spinsDown = this.querySelector('[data-bind="records-bounty-spins-down"]');
    if (spinsDown) spinsDown.addEventListener('click', () => this.#stepBountySpinCount(-1));
    const spinsUp = this.querySelector('[data-bind="records-bounty-spins-up"]');
    if (spinsUp) spinsUp.addEventListener('click', () => this.#stepBountySpinCount(1));
    const price = this.querySelector('[data-bind="records-bounty-spin-price"]');
    if (price) {
      price.addEventListener('input', () => this.#setBountySpinPrice(price.value));
      price.addEventListener('change', () => this.#clampBountySpinPrice());
      price.addEventListener('blur', () => this.#clampBountySpinPrice());
    }
    const dialog = this.querySelector('[data-bind="records-bounty-dialog"]');
    if (dialog) {
      dialog.addEventListener('keydown', (event) => {
        if (event?.key === 'Escape' && !this.#bountyDialogBusy) this.#closeBountyDialog();
      });
    }
  }

  #showNotice(message, { error = false, persist = false } = {}) {
    const notice = this.querySelector('[data-bind="records-bounty-notice"]');
    if (!notice) return;
    if (this.#noticeTimer != null) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = null;
    notice.textContent = String(message || '');
    notice.hidden = !message;
    notice.classList?.toggle('is-error', Boolean(error));
    notice.classList?.toggle('is-working', Boolean(message) && !error);
    if (message && !persist) {
      this.#noticeTimer = setTimeout(() => {
        notice.hidden = true;
        notice.textContent = '';
        this.#noticeTimer = null;
      }, error ? 5_000 : 2_000);
      try { this.#noticeTimer?.unref?.(); } catch (_e) { /* browser timer */ }
    }
  }

  async #openDiceRunReplay(record) {
    if (this.#diceRunReplayOpening) return false;
    const replay = record?.replay ?? null;
    if (!replay?.battleKey || !replay?.viewerBetId) {
      this.#showNotice('The Dice Run replay link is temporarily unavailable.', { error: true });
      return false;
    }
    const table = globalThis.document?.querySelector?.('app-craps-table');
    if (!table?.open) {
      this.#showNotice('The Craps replay table is unavailable.', { error: true });
      return false;
    }

    this.#diceRunReplayOpening = true;
    this.#showNotice('LOADING BIGGEST DICE RUN REPLAY…', { persist: true });
    try {
      const previous = await readPreviousDiceRunRecord(record);
      let profile = previous?.player ? this.#profiles.get(previous.player) ?? null : null;
      if (previous?.player && !profile) {
        try {
          const profiles = await _fetchProfiles([previous.player]);
          profile = profiles?.get?.(previous.player) ?? null;
          this.#profiles = new Map([...this.#profiles, ...(profiles ?? [])]);
        } catch (_error) { /* the address remains an honest holder label */ }
      }
      const result = await openCrapsReplayTable(table, {
        ...replay,
        biggestDiceRun: previous ? {
          scoreBps: previous.value?.toString?.() ?? String(previous.value ?? 0),
          player: previous.player,
          label: previous.player == null ? 'UNCLAIMED' : profile?.name ?? shortAddress(previous.player),
          avatar: profile?.avatar,
          bountyWei: previous.bountyWei?.toString?.() ?? null,
        } : null,
        fetchImpl: crapsReplayFetch,
      });
      if (!result?.ready) {
        const status = String(result?.pointer?.status ?? '');
        this.#showNotice(
          status === 'pending' || status === 'settling'
            ? 'The Dice Run replay is still being sealed. Try again shortly.'
            : 'The Dice Run replay is unavailable.',
          { error: status === 'failed' },
        );
        return false;
      }
      this.#showNotice('');
      return true;
    } catch (_error) {
      this.#showNotice('The Dice Run replay is temporarily unavailable. Try again.', { error: true });
      return false;
    } finally {
      this.#diceRunReplayOpening = false;
    }
  }

  #formatEthWei(value) {
    return `${group(displayEthCompact(nonNegativeWei(value), 6))} ETH`;
  }

  #formatFlipWei(value) {
    const rendered = displayToken(nonNegativeWei(value), 6);
    const compact = rendered.includes('.')
      ? rendered.replace(/0+$/, '').replace(/\.$/, '')
      : rendered;
    return `${group(compact)} FLIP`;
  }

  #formatQuoteAmount(value, currency) {
    return currency === 'FLIP' ? this.#formatFlipWei(value) : this.#formatEthWei(value);
  }

  #formatBountyEthInput(value) {
    return displayEthCompact(nonNegativeWei(value), 18) || '0';
  }

  #setBountySpinCount(value) {
    const quote = this.#bountyDialogQuote;
    if (!quote || quote.kind !== RECORD_KIND_SPIN) return;
    const requested = Math.trunc(Number(value));
    const spinCount = Math.min(
      BIGGEST_SPIN_MAX_SPINS,
      Math.max(1, Number.isFinite(requested) ? requested : quote.spinCount || 1),
    );
    // If the price is still at the old floor, redistribute the qualifying
    // total across the new reel count. Deliberately raised prices stay raised.
    const wasAtFloor = quote.amountPerSpinWei === quote.minimumPerSpinWei;
    const next = recordBountySpinSelection(quote, {
      spinCount,
      amountPerSpinWei: wasAtFloor ? 0n : quote.amountPerSpinWei,
    });
    if (!next) return;
    this.#bountyDialogQuote = next;
    this.#bountySpinDraftValid = true;
    this.#renderBountySpinControls();
    this.#renderBountyQuestBonus();
    this.#renderBountyConfirm();
  }

  #stepBountySpinCount(direction) {
    const quote = this.#bountyDialogQuote;
    if (!quote || quote.kind !== RECORD_KIND_SPIN || this.#bountyDialogBusy) return;
    this.#setBountySpinCount((quote.spinCount || 1) + Number(direction || 0));
  }

  #setBountySpinPrice(value) {
    const quote = this.#bountyDialogQuote;
    if (!quote || quote.kind !== RECORD_KIND_SPIN) return;
    const price = this.querySelector('[data-bind="records-bounty-spin-price"]');
    const controls = this.querySelector('[data-bind="records-bounty-spin-controls"]');
    const parsed = parseRecordBountyEthInput(value);
    const valid = parsed != null && parsed >= quote.minimumPerSpinWei;
    this.#bountySpinDraftValid = valid;
    price?.setAttribute?.('aria-invalid', valid ? 'false' : 'true');
    controls?.classList?.toggle?.('is-invalid', !valid);
    if (valid) {
      const next = recordBountySpinSelection(quote, { amountPerSpinWei: parsed });
      if (next) this.#bountyDialogQuote = next;
    }
    this.#renderBountyQuestBonus();
    this.#renderBountyConfirm();
  }

  #clampBountySpinPrice() {
    const quote = this.#bountyDialogQuote;
    if (!quote || quote.kind !== RECORD_KIND_SPIN) return;
    const price = this.querySelector('[data-bind="records-bounty-spin-price"]');
    const parsed = parseRecordBountyEthInput(price?.value);
    const next = recordBountySpinSelection(quote, {
      amountPerSpinWei: parsed != null && parsed >= quote.minimumPerSpinWei
        ? parsed
        : quote.minimumPerSpinWei,
    });
    if (!next) return;
    this.#bountyDialogQuote = next;
    this.#bountySpinDraftValid = true;
    this.#renderBountySpinControls();
    this.#renderBountyQuestBonus();
    this.#renderBountyConfirm();
  }

  async #loadBountyQuote(kind) {
    if (Number(kind) === RECORD_KIND_DICE_RUN) {
      return { error: 'The Dice Run record is set by a finalized scheduled Craps winner.' };
    }
    const connected = String(get('connected.address') || '').toLowerCase();
    const acting = String(getActingAddress?.() || '').toLowerCase();
    const mode = get('ui.mode');
    if (!connected) return { error: 'Connect your wallet to take a record shot.' };
    if (!acting || acting !== connected || (mode != null && mode !== 'self')) {
      return { error: 'Switch to your connected account to prepare this transaction.' };
    }

    const recordKind = Number(kind);
    const capture = (promise) => Promise.resolve(promise).then(
      (value) => ({ ok: true, value }),
      () => ({ ok: false, value: null }),
    );
    const isBuy = recordKind === RECORD_KIND_BUY;
    const [stateResult, markResult, priceResult] = await Promise.all([
      capture(this.#refresh({ loadProfiles: false })),
      capture(_readLiveRecordMark(recordKind)),
      capture(isBuy ? _readPurchaseQuote() : null),
    ]);

    const state = stateResult.value || this.#state;
    if (!state) return { error: 'The live record target is still loading. Try again.' };
    const liveMark = markResult.ok ? markResult.value : null;
    if (liveMark == null) {
      return { error: 'Could not verify the record on-chain. Try again in a moment.' };
    }
    const ticketPriceWei = isBuy ? priceResult.value?.priceWei : null;
    const today = Number(get('app.daySync')?.day ?? get('app.lastDay')?.day) || null;
    const quote = recordBountyTransactionQuote({
      state,
      kind: recordKind,
      liveMarkWei: liveMark,
      ticketPriceWei,
      today,
    });
    if (!quote) {
      return { error: isBuy
        ? 'The live ticket price is unavailable. Try again in a moment.'
        : 'The live record target is unavailable. Try again in a moment.' };
    }

    return { quote };
  }

  async #openBountyDialog(kind) {
    if (Number(kind) === RECORD_KIND_DICE_RUN) return;
    if (readBiggestBountiesModePreference() !== 'on') return;
    if (this.#bountyDialogBusy || this.#bountyDialogLoading || this.#bountyDialogQuote) return;
    const seq = ++this.#bountyDialogSeq;
    this.#bountyDialogLoading = true;
    this.#showNotice('CHECKING LIVE TARGET…', { persist: true });
    let result;
    try {
      result = await this.#loadBountyQuote(kind);
    } catch (_e) {
      result = { error: 'Could not verify the live record. Try again in a moment.' };
    }
    if (seq !== this.#bountyDialogSeq) return;
    this.#bountyDialogLoading = false;
    this.#showNotice('');
    if (result.error) {
      this.#showNotice(result.error, { error: true });
      return;
    }
    const { quote } = result;
    this.#bountyDialogKind = Number(kind);
    this.#bountyDialogQuote = quote;
    // `content-visibility: auto` normally contains this below-the-fold rail.
    // Release that containment before revealing the fixed child so its inset
    // resolves against the viewport instead of clipping to the rail's height.
    this.setAttribute('data-bounty-dialog-open', '');
    this.#renderBountyDialog();
    const dialog = this.querySelector('[data-bind="records-bounty-dialog"]');
    if (dialog) {
      dialog.hidden = false;
      dialog.removeAttribute?.('hidden');
    }
    const focusConfirm = () => {
      try {
        this.querySelector('[data-bind="records-bounty-confirm"]')
          ?.focus?.({ preventScroll: true });
      } catch (_e) { /* fake DOM */ }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusConfirm);
    else focusConfirm();
  }

  #renderBountyDialog(alertMessage = '', { error = false } = {}) {
    const quote = this.#bountyDialogQuote;
    if (!quote) return;
    const title = this.querySelector('[data-bind="records-bounty-title"]');
    const payout = this.querySelector('[data-bind="records-bounty-payout"]');
    const alert = this.querySelector('[data-bind="records-bounty-alert"]');
    const confirm = this.querySelector('[data-bind="records-bounty-confirm"]');
    if (title) title.textContent = quote.meta?.label || 'THE BIGGEST';
    if (payout) {
      payout.textContent = quote.payoutWei == null
        ? 'LIVE AMOUNT LOADING'
        : group(displayToken(quote.payoutWei, 0));
    }
    if (alert) {
      alert.textContent = alertMessage;
      alert.hidden = !alertMessage;
      alert.classList?.toggle('is-error', Boolean(error));
    }
    this.#renderBountySpinControls();
    this.#renderBountyQuestBonus();
    this.#renderBountyConfirm(confirm);
  }

  #renderBountyQuestBonus() {
    const host = this.querySelector('[data-bind="records-bounty-quest-bonus"]');
    if (!host) return;
    const quote = this.#bountyDialogQuote;
    const product = recordBountyQuestProduct(quote?.kind);
    const valid = quote?.kind !== RECORD_KIND_SPIN || this.#bountySpinDraftValid;
    const completion = quote && product && valid
      ? questCompletionBonusModel(get('ui.questObjectives'), product, quote.costWei)
      : null;
    host.hidden = completion == null;
    host.textContent = completion?.message || '';
  }

  #renderBountySpinControls() {
    const quote = this.#bountyDialogQuote;
    const controls = this.querySelector('[data-bind="records-bounty-spin-controls"]');
    if (!controls) return;
    const isSpin = quote?.kind === RECORD_KIND_SPIN;
    controls.hidden = !isSpin;
    if (!isSpin) {
      controls.setAttribute?.('hidden', '');
      return;
    }
    controls.removeAttribute?.('hidden');
    controls.classList?.remove?.('is-invalid');
    const spins = this.querySelector('[data-bind="records-bounty-spins"]');
    const spinsDown = this.querySelector('[data-bind="records-bounty-spins-down"]');
    const spinsUp = this.querySelector('[data-bind="records-bounty-spins-up"]');
    const price = this.querySelector('[data-bind="records-bounty-spin-price"]');
    const minimum = this.querySelector('[data-bind="records-bounty-spin-min"]');
    const target = this.querySelector('[data-bind="records-bounty-spin-target"]');
    if (spins) {
      spins.value = String(quote.spinCount);
      spins.disabled = this.#bountyDialogBusy;
    }
    if (spinsDown) spinsDown.disabled = this.#bountyDialogBusy || quote.spinCount <= 1;
    if (spinsUp) {
      spinsUp.disabled = this.#bountyDialogBusy || quote.spinCount >= BIGGEST_SPIN_MAX_SPINS;
    }
    if (price) {
      price.value = this.#formatBountyEthInput(quote.amountPerSpinWei);
      price.disabled = this.#bountyDialogBusy;
      price.setAttribute?.('aria-invalid', 'false');
      price.setAttribute?.('data-min-wei', String(quote.minimumPerSpinWei));
    }
    if (minimum) {
      minimum.textContent = `MIN ${this.#formatBountyEthInput(quote.minimumPerSpinWei)} ETH / SPIN`;
    }
    if (target) {
      target.textContent = `${this.#formatBountyEthInput(quote.targetWei)} ETH TOTAL BOUNTY FLOOR`;
    }
  }

  #renderBountyConfirm(provided = null) {
    const quote = this.#bountyDialogQuote;
    const confirm = provided || this.querySelector('[data-bind="records-bounty-confirm"]');
    if (!quote || !confirm) return;
    const valid = quote.kind !== RECORD_KIND_SPIN || this.#bountySpinDraftValid;
    confirm.disabled = this.#bountyDialogBusy || !valid;
    const verb = confirm.querySelector?.('[data-bind="records-bounty-confirm-action"]');
    const amount = confirm.querySelector?.('[data-bind="records-bounty-confirm-amount"]');
    const copy = this.#bountyConfirmCopy(quote);
    if (verb) {
      verb.textContent = this.#bountyDialogBusy
        ? 'CHECKING LIVE TARGET…'
        : valid ? copy.action : 'PRICE BELOW BOUNTY FLOOR';
    }
    if (amount) {
      amount.textContent = this.#bountyDialogBusy
        ? ''
        : valid
          ? copy.amount
          : `MIN ${this.#formatBountyEthInput(quote.minimumPerSpinWei)} ETH / SPIN`;
      amount.hidden = this.#bountyDialogBusy;
    }
    confirm.setAttribute?.('aria-label', this.#bountyDialogBusy
      ? 'Checking the live record target'
      : valid
        ? copy.ariaLabel
        : `Price per spin must be at least ${this.#formatBountyEthInput(quote.minimumPerSpinWei)} ETH`);
  }

  #bountyConfirmCopy(quote) {
    const fullCost = this.#formatQuoteAmount(quote.costWei, quote.currency);
    if (quote.kind === RECORD_KIND_FLIP) {
      return {
        action: 'DEPOSIT',
        amount: fullCost,
        ariaLabel: `Deposit ${fullCost} to take The Biggest Flip`,
      };
    }
    if (quote.kind === RECORD_KIND_SPIN) {
      const spins = Number(quote.spinCount || 1);
      const perSpin = this.#formatEthWei(quote.amountPerSpinWei || quote.targetWei);
      return {
        action: spins === 1 ? 'SPIN ONCE' : `SPIN ${spins}×`,
        amount: fullCost,
        ariaLabel: `Place ${spins} Degenerette spin${spins === 1 ? '' : 's'} at ${perSpin} each, ${fullCost} total, to take The Biggest Degenerette`,
      };
    }
    if (quote.kind === RECORD_KIND_LUCKBOX) {
      return {
        action: 'BUY LUCKBOX',
        amount: fullCost,
        ariaLabel: `Buy a ${fullCost} Luckbox to take The Biggest Luckbox`,
      };
    }
    const target = formatRecordValue(quote.kind, quote.targetWei);
    const tickets = `${target.amount} ${target.suffix}`.trim();
    return {
      action: `BUY ${tickets}`,
      amount: fullCost,
      ariaLabel: `Buy ${tickets} for ${fullCost} to take The Biggest Pack Ripped`,
    };
  }

  #quoteMoved(previous, next) {
    if (!previous || !next) return true;
    return previous.targetWei !== next.targetWei
      || previous.kind !== next.kind
      || (previous.kind !== RECORD_KIND_SPIN && previous.costWei !== next.costWei)
      || previous.payoutWei !== next.payoutWei;
  }

  async #confirmBountyDialog() {
    if (this.#bountyDialogBusy || this.#bountyDialogKind == null) return;
    const seq = ++this.#bountyDialogSeq;
    const previous = this.#bountyDialogQuote;
    this.#bountyDialogBusy = true;
    this.#renderBountyDialog();
    let result;
    try {
      result = await this.#loadBountyQuote(this.#bountyDialogKind);
    } catch (_e) {
      result = { error: 'Could not refresh the live target.' };
    }
    if (seq !== this.#bountyDialogSeq) return;
    this.#bountyDialogBusy = false;
    if (result.error || !result.quote) {
      this.#renderBountyDialog(result.error || 'Could not refresh the live target.', { error: true });
      return;
    }
    const baseNext = result.quote;
    const moved = this.#quoteMoved(previous, baseNext);
    const next = previous?.kind === RECORD_KIND_SPIN
      ? recordBountySpinSelection(baseNext, {
        spinCount: previous.spinCount,
        amountPerSpinWei: previous.amountPerSpinWei === previous.minimumPerSpinWei
          ? 0n
          : previous.amountPerSpinWei,
      })
      : baseNext;
    this.#bountyDialogQuote = next || baseNext;
    this.#bountySpinDraftValid = true;
    if (moved) {
      this.#renderBountyDialog('TARGET OR PRICE MOVED · REVIEW THE UPDATED TX', { error: true });
      return;
    }

    const detail = recordBountyActivationDetail(this.#bountyDialogQuote);
    if (!detail || typeof document === 'undefined') {
      this.#renderBountyDialog('THE TRANSACTION ROUTE IS NOT AVAILABLE', { error: true });
      return;
    }
    try {
      document.dispatchEvent(new CustomEvent('quest:activate', { detail }));
    } catch (_e) {
      this.#renderBountyDialog('COULD NOT OPEN THE TRANSACTION', { error: true });
      return;
    }
    this.#closeBountyDialog({ restoreFocus: false });
  }

  #closeBountyDialog({ restoreFocus = true } = {}) {
    this.#bountyDialogSeq += 1;
    const kind = this.#bountyDialogKind;
    this.removeAttribute('data-bounty-dialog-open');
    const dialog = this.querySelector?.('[data-bind="records-bounty-dialog"]');
    if (dialog) {
      dialog.hidden = true;
      dialog.setAttribute?.('hidden', '');
    }
    this.#bountyDialogQuote = null;
    this.#bountyDialogKind = null;
    this.#bountyDialogBusy = false;
    this.#bountyDialogLoading = false;
    this.#bountySpinDraftValid = true;
    if (restoreFocus && kind != null) {
      try {
        this.querySelector?.(`.records-rail__leader[data-kind="${kind}"]`)
          ?.focus?.({ preventScroll: true });
      } catch (_e) { /* fake DOM */ }
    }
  }

  async #refresh({ loadProfiles = true } = {}) {
    const seq = ++this.#seq;
    let state = null;
    try {
      state = await _fetchRecords();
    } catch (_e) {
      // Keep the last good rail up rather than blanking it on one failed poll.
      return null;
    }
    if (seq !== this.#seq) return null;
    this.#state = state;
    // One authoritative snapshot powers both the board and the qualifying
    // glow on the four wager inputs. Publishing it here keeps every surface on
    // the rail's immediate post-transaction refresh and 15-second live poll.
    // Records move rarely relative to that poll, and a full rebuild re-adds a
    // listener per leader card — publish and repaint only when the snapshot
    // (or the viewed account) actually changed.
    const viewed = getViewedAddress?.() || getActingAddress?.() || null;
    const stateKey = renderSnapshotKey({ state, viewed: String(viewed ?? '') });
    if (stateKey == null || stateKey !== this.#renderedStateKey) {
      this.#renderedStateKey = stateKey;
      update('app.records', state);
      this.#viewedAddress = viewed;
      this.#render();
    }

    if (!loadProfiles) return state;

    const holders = state.records.map((record) => record.player).filter(Boolean);
    const profiles = await _fetchProfiles(holders);
    if (seq !== this.#seq) return null;
    const profilesKey = renderSnapshotKey(profiles ?? null);
    if (profilesKey == null || profilesKey !== this.#renderedProfilesKey) {
      this.#renderedProfilesKey = profilesKey;
      this.#profiles = profiles;
      this.#render();
    }
    return state;
  }

  async #refreshProfiles() {
    const records = this.#state?.records;
    if (!Array.isArray(records)) return null;
    const seq = this.#seq;
    const holders = records.map((record) => record.player).filter(Boolean);
    const profiles = await _fetchProfiles(holders);
    if (seq !== this.#seq) return null;
    this.#profiles = profiles;
    this.#render();
    return profiles;
  }

  #render() {
    const shell = this.querySelector('[data-bind="records-shell"]');
    if (!shell) return;
    const mode = readBiggestBountiesModePreference();
    const state = this.#state;
    if (!state || mode === 'off') {
      this.hidden = true;
      shell.hidden = true;
      return;
    }
    this.hidden = false;
    shell.hidden = false;

    const displayedRecords = orderBiggestRecords(state.records);

    const leaders = this.querySelector('[data-bind="records-leaders"]');
    if (leaders) {
      leaders.innerHTML = '';
      for (const record of displayedRecords) {
        leaders.appendChild(this.#renderLeader(record));
      }
    }

    const list = this.querySelector('[data-bind="records-cards"]');
    if (!list) return;
    list.innerHTML = '';
    const viewed = String(this.#viewedAddress || '').toLowerCase();

    for (const record of displayedRecords) {
      list.appendChild(this.#renderCard(record, viewed));
    }
  }

  #renderLeader(record) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'records-rail__leader';
    item.dataset.kind = String(record.kind);
    if (!record.held) item.classList.add('is-open');

    const value = formatRecordValue(record.kind, record.value);
    // Open records still show their real entry floor, but that floor must use
    // the same compact number/unit treatment as a held record. Rendering the
    // raw `floorText` here regressed 200,000 FLIP / 100 TICKETS back into one
    // oversized monospace string.
    const compactValue = formatCompactRecordValue(
      record.kind,
      record.held ? record.value : record.meta.floorValue,
    );
    const amountFit = compactValue.amount.length >= 6
      ? 'tight'
      : compactValue.amount.length >= 5
        ? 'compact'
        : 'standard';
    const profile = record.player ? this.#profiles.get(record.player) : null;
    const holderAddress = shortAddress(record.player);
    const holder = record.held ? (profile?.name || holderAddress) : 'OPEN RECORD';
    const holderDetail = record.held && profile?.name
      ? `${profile.name} · ${holderAddress}`
      : holder;
    const payoutWei = this.#recordPayoutWei(record);
    const compactPayout = payoutWei == null ? '—' : formatCompactBountyWei(payoutWei);
    const cardTitle = RECORD_KIND_CARD_TITLE.get(Number(record.kind)) || record.meta.short;
    const isDiceRun = Number(record.kind) === RECORD_KIND_DICE_RUN;
    item.classList.toggle('is-replay', isDiceRun && Boolean(record.held));
    // Dice Run is a read-only replay action, so it remains available in VIEW
    // mode. The other four buttons prepare transactions and require ON.
    const interactive = isDiceRun
      ? Boolean(record.held)
      : readBiggestBountiesModePreference() === 'on';
    item.classList.toggle('is-view-only', !interactive);
    if (interactive) {
      item.removeAttribute('aria-disabled');
      item.removeAttribute('tabindex');
    } else {
      // Keep the native button enabled so its useful record/bounty tooltip is
      // still available in VIEW mode. The click guard below owns the no-write
      // behavior, while aria-disabled removes it from the keyboard action path.
      item.setAttribute('aria-disabled', 'true');
      item.setAttribute('tabindex', '-1');
    }
    const instruction = isDiceRun
      ? record.held
        ? ' Click to replay from the record holder\'s perspective.'
        : ' Set by the winning scheduled Dice Run.'
      : interactive
        ? ' Click to prepare the exact record shot.'
        : '';
    item.title = record.held
      ? `${record.meta.label}: ${value.amount} ${value.suffix}, held by ${holder}; bounty ${compactPayout} FLIP.${instruction}`
      : `${record.meta.label}: unhit; bounty ${compactPayout} FLIP.${instruction}`;
    item.setAttribute('aria-label', item.title);
    item.innerHTML = `
      <img class="records-rail__leader-card-art"
           src="${RECORD_CARD_ART}"
           alt="" aria-hidden="true" loading="lazy" decoding="async">
      <span class="records-rail__leader-presentation">
        ${record.held
          ? this.#portrait(record.player, profile)
          : '<span class="records-rail__portrait records-rail__portrait--open" aria-hidden="true">?</span>'}
        <span class="records-rail__bounty-sight"
              aria-label="${record.held ? `Held by ${escapeHtml(holderDetail)}; ` : 'Open record; '}current bounty ${escapeHtml(compactPayout)} FLIP"
              title="${escapeHtml(holderDetail)} · bounty ${escapeHtml(compactPayout)} FLIP">
          <svg class="records-rail__bounty-crosshair" viewBox="0 0 24 24"
               focusable="false" aria-hidden="true">
            <path d="M12 1v4M12 19v4M1 12h4M19 12h4"></path>
            <circle cx="12" cy="12" r="7"></circle>
            <circle cx="12" cy="12" r="2.25"></circle>
          </svg>
          <b class="records-rail__leader-bounty-amount" aria-hidden="true">${escapeHtml(compactPayout)}</b>
        </span>
      </span>
      <span class="records-rail__leader-title" aria-hidden="true">
        <span>THE BIGGEST</span>
        <strong>${escapeHtml(cardTitle)}</strong>
      </span>
      <span class="records-rail__leader-strip">
        <span class="records-rail__leader-holder" aria-hidden="true">${escapeHtml(holder)}</span>
      </span>
      <span class="records-rail__leader-bet">
        <strong class="records-rail__leader-value"
                data-amount-fit="${amountFit}"
                aria-label="Current record ${escapeHtml(compactValue.amount)} ${escapeHtml(compactValue.suffix)}">
          <span class="records-rail__leader-amount">${escapeHtml(compactValue.amount)}</span>
          ${compactValue.suffix
            ? `<em>${escapeHtml(compactValue.suffix)}</em>`
            : ''}
        </strong>
      </span>
    `;
    item.addEventListener('click', (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (Number(record.kind) === RECORD_KIND_DICE_RUN) {
        if (record.held) void this.#openDiceRunReplay(record);
        return;
      }
      if (readBiggestBountiesModePreference() !== 'on') return;
      void this.#openBountyDialog(record.kind);
    });
    this.#wirePortraitFallback(item, record.player);
    return item;
  }

  #renderCard(record, viewed) {
    const item = document.createElement('li');
    item.className = 'records-rail__card';
    item.dataset.kind = String(record.kind);
    if (!record.held) item.classList.add('is-open');
    if (record.player && record.player === viewed) item.classList.add('is-you');

    const value = formatRecordValue(record.kind, record.value);
    const bar = formatRecordValue(record.kind, record.barToBeat);
    const strictImprovement = Number(record.kind) === RECORD_KIND_DICE_RUN;
    const profile = record.player ? this.#profiles.get(record.player) : null;

    // What breaking this record pays right now. A missing indexed clock uses
    // the contract-guaranteed 5% floor, so a freshly hit record never flashes
    // a dash while its exact clock metadata catches up.
    const today = Number(get('app.daySync')?.day ?? get('app.lastDay')?.day) || null;
    const shareBps = accruedShareBps({ held: record.held, clockDay: record.clockDay, today });
    const payoutWei = this.#recordPayoutWei(record, today);
    const title = record.claimCount > 0
      ? `${record.meta.label} — paid out ${record.claimCount}×`
      : record.meta.label;

    item.innerHTML = `
      <header class="records-rail__card-head">
        <span class="records-rail__card-title">
          <b title="${escapeHtml(title)}">${escapeHtml(record.meta.label)}</b>
        </span>
        ${shareBps
          ? `<i aria-label="${(shareBps / 100).toFixed(1)} percent share"
                title="Share of the bounty pool paid for breaking this record">${(shareBps / 100).toFixed(1)}%</i>`
          : ''}
      </header>
      ${record.held
        ? `
          <div class="records-rail__metric">
            <small>CURRENT RECORD</small>
            <strong class="records-rail__mark">${escapeHtml(value.amount)}<em>${escapeHtml(value.suffix)}</em></strong>
          </div>
          <div class="records-rail__holder">
            ${this.#portrait(record.player, profile)}
            <span class="records-rail__holder-copy">
              <small>HELD BY</small>
              <b class="records-rail__holder-name">${escapeHtml(profile?.name || shortAddress(record.player))}</b>
            </span>
          </div>
          <div class="records-rail__track${strictImprovement ? ' records-rail__track--strict' : ''}" role="presentation">
            <span class="records-rail__fill" style="width:${strictImprovement ? '100' : MARK_FILL_PERCENT.toFixed(3)}%"></span>
            <span class="records-rail__notch"></span>
          </div>
          <div class="records-rail__stakes">
            <span class="records-rail__beat">
              <small>TARGET TO CLAIM</small>
              <b>${escapeHtml(bar.amount)} <em>${escapeHtml(bar.suffix)}</em></b>
            </span>
            ${payoutWei == null
              ? ''
              : `<span class="records-rail__pays">
                  <small>PAYOUT NOW</small>
                  <b>${escapeHtml(group(displayToken(payoutWei, 0)))} <em>FLIP</em></b>
                </span>`}
          </div>
        `
        : `
          <div class="records-rail__metric records-rail__metric--open">
            <small>CURRENT RECORD</small>
            <strong class="records-rail__mark records-rail__mark--open">UNHIT</strong>
          </div>
          <div class="records-rail__holder records-rail__holder--open">
            <span class="records-rail__portrait records-rail__portrait--open" aria-hidden="true">?</span>
            <span class="records-rail__holder-copy">
              <small>HELD BY</small>
              <b class="records-rail__holder-name">Nobody yet</b>
            </span>
          </div>
          <div class="records-rail__stakes">
            <span class="records-rail__pays">
              <small>CURRENT BOUNTY</small>
              <b>${payoutWei == null
                ? '—'
                : escapeHtml(group(displayToken(payoutWei, 0)))} <em>FLIP</em></b>
            </span>
            <span class="records-rail__beat">
              <small>MIN TO HIT</small>
              <b>${escapeHtml(record.meta.floorText)}</b>
            </span>
          </div>
        `}
    `;

    // A Discord avatar can 404 long after the record was set (deleted account,
    // rotated hash). Fall back to the monogram rather than leaving a broken
    // image in the hall of fame.
    this.#wirePortraitFallback(item, record.player);
    return item;
  }

  #recordPayoutWei(record, today = Number(
    get('app.daySync')?.day ?? get('app.lastDay')?.day,
  ) || null) {
    const shareBps = accruedShareBps({
      held: record.held,
      clockDay: record.clockDay,
      today,
    });
    return accruedPayoutWei(this.#state?.recordPoolWei, shareBps);
  }

  #wirePortraitFallback(root, address) {
    const portrait = root?.querySelector?.('img.records-rail__portrait');
    if (portrait) {
      portrait.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'records-rail__portrait records-rail__portrait--monogram';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.style.setProperty('--portrait-hue', String(addressHue(address)));
        fallback.textContent = addressMonogram(address);
        portrait.replaceWith(fallback);
      }, { once: true });
    }
  }

  #portrait(address, profile) {
    const alt = escapeHtml(profile?.name || shortAddress(address));
    if (profile?.avatar) {
      return `<img class="records-rail__portrait" src="${escapeHtml(profile.avatar)}"
                   alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`;
    }
    return `<span class="records-rail__portrait records-rail__portrait--monogram"
                  style="--portrait-hue:${addressHue(address)}"
                  aria-hidden="true">${escapeHtml(addressMonogram(address))}</span>`;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-records-rail')) {
  customElements.define('app-records-rail', AppRecordsRail);
}

export function __setRecordsRailDepsForTest({
  records,
  profiles,
  mark,
  price,
} = {}) {
  if (typeof records === 'function') _fetchRecords = records;
  if (typeof profiles === 'function') _fetchProfiles = profiles;
  if (typeof mark === 'function') _readLiveRecordMark = mark;
  if (typeof price === 'function') _readPurchaseQuote = price;
}

export function __resetRecordsRailDepsForTest() {
  _fetchRecords = fetchRecords;
  _fetchProfiles = fetchProfiles;
  _readLiveRecordMark = readLiveRecordMark;
  _readPurchaseQuote = readPurchaseQuote;
}
