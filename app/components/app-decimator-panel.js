// /app/components/app-decimator-panel.js — Phase 62 Plan 62-01 (BUY-01)
//
// Decimator level-mint panel. Custom Element shell mirrors Phase 60's
// app-packs-panel.js + Phase 61's app-claims-panel.js: light DOM, idempotent
// customElements.define guard, symmetric connectedCallback / disconnectedCallback,
// #unsubs[] for store subscriptions, panel-owned 30s poll cycle (Phase 61 D-04
// LOCKED — NOT polling.js's fictional generic API per RESEARCH Pitfall 9).
//
// On-chain surface: DegenerusGame.purchase() with entryQuantityScaled plus the
// packed Small / Medium / Large / Custom box order. purchaseEth is re-exported
// through decimator.js; importing it eagerly also installs the purchase-path
// revert mappings.
//
// Carry-forwards (CONTEXT 62-CONTEXT.md):
//   CF-01: Phase 58 closure-form sendTx — flows through decimator.purchaseEth/Coin
//          → lootbox.js → sendTx((s) => new Contract(...).method(args), 'Action').
//   CF-02: Phase 56 reason-map decodeRevertReason on every catch.
//   CF-03: Phase 56 requireStaticCall pre-flight inside lootbox.js.
//   CF-05: Phase 60 receipt-log-first parsers (re-imported when needed).
//   CF-06: Phase 61 D-05 NEVER optimistic balance subtraction. Pre-click balance
//          stays visible; 250ms post-confirm refetch via #runPollCycle.
//   CF-07: T-58-18 — error.userMessage rendered via .textContent NOT innerHTML.
//   CF-15: data-write attribute on Buy CTA → Phase 58 disable manager auto-disables
//          when ui.mode === 'view-others'.
//
// Class palette: .dec-* prefix (RESEARCH R10 verified non-colliding against
// the then-existing prefixes: .app-/.chain-/.last-/.ldj-/.player-/.view-/
// .wallet-. .clm- and .lbx- were retired with their panels 2026-08-08.)

import { CHAIN, ETH_DIVISOR } from '../app/chain-config.js';
import { displayEth } from '../app/scaling.js';
import { compactUiError } from '../app/ui-error.js';
import { get, getActingAddress, getViewedAddress, subscribe, update } from '../app/store.js';
import {
  readAllInButtonPreference,
  subscribeUiPreferences,
} from '../app/ui-preferences.js';
import { getProvider } from '../app/contracts.js';
import { permissionlessReadProvider, readNativeBalance } from '../app/read-provider.js';
import { fetchJSON } from '../app/api.js';
import { readGameState } from '../app/game-state.js';
import {
  reportPendingActionError,
  subscribePendingActions,
} from '../app/pending-actions.js';
// Eager import — triggers Phase 60's reason-map registrations as a side-effect
// (GameOverPossible / AfKingLockActive / NotApproved). decimator.js is a thin
// re-export of lootbox.js's purchaseEth + purchaseCoin per Plan 62-01 D-01.
import {
  purchaseEth,
  scaledTicketPriceWei,
  readPlayerActivityScore,
  burnForDecimator,
  DECIMATOR_MIN_FLIP_WEI,
  decimatorWindowIsOpen,
} from '../app/decimator.js';
import {
  readAfkingFunding,
  readAfkingSubscription,
  withdrawAfkingSubscriptionFunding,
} from '../app/passes.js';
// readAffiliateCode comes directly from lootbox.js — Plan 62-01's decimator.js
// only re-exports the two purchase helpers per its minimal-surface design.
// Box purchases now use the contract's packed four-tier order. Preset boxes
// price at 1x / 5x / 25x the frozen ticket price; custom boxes carry their
// own per-box ETH size (minimum 0.01 ETH).
import {
  readAffiliateCode, LOOTBOX_MIN_WEI, parseLootboxIdxFromReceipt,
  foilPackCostFromPriceWei, readPurchaseQuote,
  parseFoilPackBoughtFromReceipt,
  probeFoilPackAvailabilityState,
  readPresaleBoxState, purchasePresaleBox, parsePresaleBoxBuyFromReceipt,
  PRESALE_BOX_MIN_WEI,
  packBoxOrder, boxOrderCostFromPriceWei, BOX_ORDER_MAX_BOXES,
  BOX_ORDER_MEDIUM_MULTIPLE, BOX_ORDER_LARGE_MULTIPLE,
  // A ticket is 4 entries; the contract takes entries and charges per entry, so
  // both the quote and the call go through these (see lootbox.js UNITS note).
  // These mirror the click-time funding split for the bonus preview, including
  // the Claimable allocation that protects a regular mint beside a presale box.
  ticketCostFromTickets, entriesScaledFromTickets, ENTRIES_PER_TICKET,
  purchaseFundingPayment, readCenturyBonusUsed,
  preserveMintBonusWithPresale, MINT_PAYMENT_KIND_CLAIMABLE,
  readPurchaseFundingPriority as _readFundingPriority,
  writePurchaseFundingPriority as _writeFundingPriority,
  readPurchaseUseAfking as _readUseAfking,
  writePurchaseUseAfking as _writeUseAfking,
} from '../app/lootbox.js';
import {
  applyLootboxCasePresentation,
  lootboxCaseAssets,
  lootboxCaseModel,
} from '../app/lootbox-value-tone.js';
// Reveal plumbing: ticket purchases queue a pack-opening reveal; lootbox legs
// found in the BUY receipt itself (afking idx-0 auto-opens) reveal instantly.
// Boxes that need a separate openBox call go to the app-root
// <app-box-strip tray-only> controller via the tx-confirmed event's `boxes`
// detail. It publishes the eventual open/replay action to the bottom tray.
import {
  enrichHumanBoxSpinLegs,
  enrichLootboxBoonLegs,
  lootboxPresentationKey,
  parseOpenLegsFromReceipt,
} from '../app/lootbox-legs.js';
// Contract port of _activeTicketLevel — the level a buy routes to right now.
import { activeTicketLevel } from '../app/active-level.js';
import { dgnBadgePath, dgnTicketAccent } from '../app/dgn-traits.js';
// FLIP ticket buy (GAME.redeemFlip) — a second, window-gated payment path for
// the ticket leg only. Public pool views drive visibility independently of
// whether the current player can afford one whole ticket.
import {
  claimEth,
  readClaimableEth,
  redeemFlip,
  probeRedeemFlipWindow,
  flipCostFromTickets,
} from '../app/claims.js';
import {
  protocolFlipTotalWei,
  readCoinflipDisplaySnapshot,
} from '../app/coinflip.js';
import { formatFlip } from '../viewer/utils.js';
import { queueReveal } from './reveal-overlay.js';
import { updateBalanceDisplay, resetBalanceDisplay } from '../app/balance-countup.js';
import { heldBalanceValue } from '../app/balance-hold.js';
import { degeneretteLimits } from '../app/degenerette.js';
// Ticket reveals are deferred until the traits roll — see app/app/pack-watch.js.
import { recordPendingPack, lootboxTicketPackRelease } from '../app/pack-watch.js';
import { BASE_SEPOLIA_FAUCET_URL, isBaseSepolia } from './testnet-beta-banner.js';
import {
  candidateRecordPayoutWei,
  candidateClaimsRecord,
  RECORD_KIND_BUY,
  RECORD_KIND_LUCKBOX,
  toBigInt,
} from '../app/records.js';
import { boonBoostBps, boonBoostDelta } from '../app/boons.js';
import './boon-product-indicator.js';
import './quest-objective-indicator.js';
import { registerComponentPoll } from '../app/component-poll.js';
import { lock, unlock } from '../app/scroll-lock.js';

const POLL_INTERVAL_MS = 30_000;       // Phase 56 D-04 / Phase 61 D-04 LOCKED.
const POST_CONFIRM_REFETCH_MS = 250;   // CF-06 — 250ms debounced refetch on tx confirm.
const ERROR_AUTO_CLEAR_MS = 10_000;    // 10s — mirrors Phase 61 D-05 pattern.
const PURCHASE_TICKET_SAMPLE_REFRESH_MS = 60_000;
// Buy In deliberately keeps dedicated static card renders even if a reveal
// surface changes its animation art later. The medium render is perspective-
// matched to the green and gold cases solely for this three-box row.
const BUY_IN_COMPACT_CASE_ART = Object.freeze({
  small: '/app/assets/lootbox/degenerus-lootbox-case-small-v21-plain-lid-large-badge-buy-in-card.webp',
  medium: '/app/assets/lootbox/degenerus-lootbox-case-medium-v28-quiet-quadrant-buy-in-card.webp',
});
// The large Buy In card deliberately uses the taller historical top-down
// render with the four-part front panel. Reveal/opening art stays on the
// current animation set.
const BUY_IN_GOLD_CASE_ART = '/app/assets/lootbox/degenerus-lootbox-case-large-v36-buy-in-card.webp';
const BUY_IN_COMPACT_CASE_GEOMETRY = Object.freeze({
  small: Object.freeze({
    priceTop: '31.3%', priceHeight: '18%', priceWidth: '58%',
    badgeClip: 'ellipse(7.4% 6.5% at 50% 68.1%)',
  }),
  medium: Object.freeze({
    priceTop: '35.4%', priceHeight: '18%', priceWidth: '58%',
    badgeClip: 'ellipse(7.5% 6.8% at 50% 78.5%)',
  }),
});
const BUY_IN_GOLD_CASE_GEOMETRY = Object.freeze({
  priceTop: '25.4%', priceHeight: '21.5%', priceWidth: '42%',
  badgeTop: '66.5%', badgeSize: '12.2%', badgeScaleY: '0.92',
});

/** Contract-exact heavy-tail color bucket used by DegenerusTraitUtils.traitFromWord. */
export function purchaseTicketColorBucket(randomWord) {
  const scaled = (Number(randomWord) >>> 0) >>> 24;
  if (scaled < 64) return 0;
  if (scaled < 128) return 1;
  if (scaled < 192) return 2;
  if (scaled < 224) return 3;
  if (scaled < 240) return 4;
  if (scaled < 248) return 5;
  if (scaled < 254) return 6;
  return 7;
}

/**
 * Build the four canonical trait bytes from four uint64 words represented as
 * [low32, high32] pairs. Color comes from low32; symbol is high32 & 7.
 */
export function purchaseTicketTraitsFromWords(randomWords) {
  const words = Array.from(randomWords || [], (word) => Number(word) >>> 0);
  if (words.length < 8) throw new RangeError('Eight uint32 words are required for a ticket sample.');
  return Array.from({ length: 4 }, (_unused, quadrant) => {
    const col = purchaseTicketColorBucket(words[quadrant * 2]);
    const sym = words[(quadrant * 2) + 1] & 7;
    return Object.freeze({
      q: quadrant,
      quadrant,
      col,
      sym,
      byte: (quadrant << 6) | (col << 3) | sym,
    });
  });
}

/**
 * Build one standalone entry from independent random words. Quadrant and
 * symbol are uniform; color keeps the contract's heavy-tail odds. Every one
 * of the 256 canonical trait IDs therefore remains reachable.
 */
export function purchaseEntryTraitFromWords(randomWords) {
  const words = Array.from(randomWords || [], (word) => Number(word) >>> 0);
  if (words.length < 3) throw new RangeError('Three uint32 words are required for an entry sample.');
  const q = words[0] & 3;
  const col = purchaseTicketColorBucket(words[1]);
  const sym = words[2] & 7;
  return Object.freeze({
    q,
    quadrant: q,
    col,
    sym,
    byte: (q << 6) | (col << 3) | sym,
  });
}

function randomPurchaseWords(length) {
  const words = new Uint32Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(words);
  } else {
    for (let index = 0; index < words.length; index += 1) {
      words[index] = Math.floor(Math.random() * 0x1_0000_0000);
    }
  }
  return words;
}

function randomPurchaseTicketTraits() {
  return purchaseTicketTraitsFromWords(randomPurchaseWords(8));
}

function randomPurchaseEntryTrait() {
  return purchaseEntryTraitFromWords(randomPurchaseWords(3));
}
// Purchase quotes are controls, not accounting tables: fixed-width values such
// as "0.0400" add noise and can make an input step look more precise than it
// is. Keep displayEth's chain scaling/precision, then trim fractional zeroes
// unless a specific readout needs a small fixed minimum (the pack quote uses
// two places so its 10x relationship reads as 0.40 beside a 0.04 ticket).
function formatPurchaseEth(raw, minimumFractionDigits = 0) {
  const fixed = displayEth(BigInt(raw || 0));
  const trimmed = fixed.includes('.')
    ? fixed.replace(/0+$/, '').replace(/\.$/, '')
    : fixed;
  const minDigits = Math.max(0, Math.trunc(Number(minimumFractionDigits) || 0));
  if (minDigits === 0) return trimmed;
  const [whole, fraction = ''] = trimmed.split('.');
  return `${whole}.${fraction.padEnd(minDigits, '0')}`;
}

// Quote CTAs can contain the player's entire balance and a four-digit ticket
// count. Group only the display string; all transaction math keeps the exact
// unformatted values returned alongside it.
function groupAllInNumber(raw) {
  const original = String(raw ?? '');
  const normalized = original.replaceAll(',', '');
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(normalized);
  if (!match) return original;
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${match[1]}${grouped}${match[3] || ''}`;
}

// Keep all three rate quotes byte-for-byte identical while giving CSS real cells
// for the label, equals sign, amount, and unit. This lets ENTRY and TICKET
// share one visual price column without padding either quote with display
// characters. The separator renders as a dash; the aria-label keeps the equals
// sign because that is the relation being stated, and a lone dash reads as
// nothing (or "minus") to a screen reader. The unit is its own cell so
// ETH/FLIP stays on a single x across
// every line however many digits the amount takes; the leading spaces here
// collapse in the grid cells and exist only to keep the row's text readable
// when it is copied or read without the aria-label.
function renderPurchasePriceRow(host, kind, amount, unit) {
  if (!host) return;
  host.textContent = '';
  for (const [className, text] of [
    ['dec-price__count', '1'],
    ['dec-price__kind', ` ${kind}`],
    ['dec-price__sep', ' - '],
    ['dec-price__amount', amount],
    ['dec-price__unit', unit ? ` ${unit}` : ''],
  ]) {
    const part = document.createElement('span');
    part.className = className;
    part.textContent = text;
    host.appendChild(part);
  }
  host.setAttribute('aria-label', `1 ${kind} = ${amount}${unit ? ` ${unit}` : ''}`);
}

/** Compact the visible buy-bonus tally without ever rounding the reward up. */
export function formatPurchaseBonusFlip(value) {
  let raw;
  try { raw = BigInt(value ?? 0); } catch (_e) { return '0'; }
  const negative = raw < 0n;
  const whole = (negative ? -raw : raw) / (10n ** 18n);
  const sign = negative && whole > 0n ? '-' : '';
  if (whole < 1_000n) return `${sign}${whole.toLocaleString('en-US')}`;

  const tiers = [
    [10n ** 15n, 'Q'],
    [10n ** 12n, 'T'],
    [10n ** 9n, 'B'],
    [10n ** 6n, 'M'],
    [10n ** 3n, 'K'],
  ];
  const [divisor, suffix] = tiers.find(([threshold]) => whole >= threshold);
  const leading = whole / divisor;
  const decimals = leading >= 100n ? 0 : leading >= 10n ? 1 : 2;
  const factor = 10n ** BigInt(decimals);
  const truncated = (whole * factor) / divisor;
  const integer = truncated / factor;
  if (decimals === 0) return `${sign}${integer}${suffix}`;
  const fraction = String(truncated % factor)
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${sign}${integer}${fraction ? `.${fraction}` : ''}${suffix}`;
}

const PURCHASE_UNITS_PER_TICKET = 400n;
const PURCHASE_TICKETS_PER_PACK = 10;
const PURCHASE_BOON_MAX_VALUE_WEI = (10n * (10n ** 18n)) / ETH_DIVISOR;
const CENTURY_BONUS_MAX_VALUE_WEI = (20n * (10n ** 18n)) / ETH_DIVISOR;

/** Exact ActivityCurveLib.centuryBps port (whole activity points -> bps). */
export function centuryBonusBps(score) {
  let points;
  try {
    points = typeof score === 'number'
      ? BigInt(Number.isFinite(score) ? Math.trunc(score) : 0)
      : BigInt(score ?? 0);
  } catch (_e) {
    points = 0n;
  }
  if (points <= 0n) return 0n;
  if (points <= 305n) return (points * 9_000n) / 305n;
  if (points <= 500n) return 9_000n + ((points - 305n) * 800n) / 195n;
  if (points >= 30_000n) return 10_000n;
  return 9_800n + ((points - 500n) * 200n) / 29_500n;
}

/** Exact purchase-unit formatter: 400 units = one ticket, no float rounding. */
export function formatPurchaseTicketUnits(value) {
  let units;
  try { units = BigInt(value ?? 0n); } catch (_e) { return '0'; }
  if (units <= 0n) return '0';
  const whole = units / PURCHASE_UNITS_PER_TICKET;
  const remainder = units % PURCHASE_UNITS_PER_TICKET;
  const fraction = ((remainder * 10_000n) / PURCHASE_UNITS_PER_TICKET)
    .toString()
    .padStart(4, '0')
    .replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Contract-parity x00 purchase bonus in scaled entry units.
 * The curve consumes the ticket-boon-adjusted quantity and then applies the
 * player's remaining 20-ETH-equivalent allowance for this century.
 */
export function purchaseCenturyBonus({
  targetLevel = null,
  tickets = 0,
  priceWei = 0n,
  activityScore = 0,
  ticketBoonBps = 0,
  usedUnits = 0n,
} = {}) {
  const level = Number(targetLevel);
  if (!Number.isInteger(level) || level <= 0 || level % 100 !== 0) return null;
  let price;
  let used;
  try {
    price = BigInt(priceWei ?? 0n);
    used = BigInt(usedUnits ?? 0n);
  } catch (_e) {
    return null;
  }
  if (price <= 0n) return null;
  if (used < 0n) used = 0n;
  const baseUnits = entriesScaledFromTickets(tickets);
  if (baseUnits <= 0n) return null;

  let adjustedUnits = baseUnits;
  const parsedBoonBps = Number(ticketBoonBps);
  const boostBps = Number.isFinite(parsedBoonBps) && parsedBoonBps > 0
    ? BigInt(Math.trunc(parsedBoonBps))
    : 0n;
  if (boostBps > 0n) {
    const costWei = (price * baseUnits) / PURCHASE_UNITS_PER_TICKET;
    const eligibleWei = costWei > PURCHASE_BOON_MAX_VALUE_WEI
      ? PURCHASE_BOON_MAX_VALUE_WEI
      : costWei;
    const eligibleUnits = (eligibleWei * PURCHASE_UNITS_PER_TICKET) / price;
    adjustedUnits += (eligibleUnits * boostBps) / 10_000n;
  }

  const bps = centuryBonusBps(activityScore);
  const grossBonusUnits = (adjustedUnits * bps) / 10_000n;
  const maxBonusUnits = (CENTURY_BONUS_MAX_VALUE_WEI * PURCHASE_UNITS_PER_TICKET) / price;
  const remainingUnits = maxBonusUnits > used ? maxBonusUnits - used : 0n;
  const bonusUnits = grossBonusUnits > remainingUnits ? remainingUnits : grossBonusUnits;
  return {
    level,
    bps,
    baseUnits,
    adjustedUnits,
    grossBonusUnits,
    maxBonusUnits,
    remainingUnits,
    bonusUnits,
  };
}

// The active testnet displays ETH in the protocol's /1M-normalized units,
// including the connected wallet readout. Keep the same multiplier and the
// purchase panel's no-trailing-zero convention in one place.
function formatFundsEth(raw) {
  const fixed = displayEth(BigInt(raw || 0), 2);
  const trimmed = fixed.includes('.')
    ? fixed.replace(/0+$/, '').replace(/\.$/, '')
    : fixed;
  const [whole, fraction] = trimmed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

// Read-only account views still need their public balances. Combined mode is
// the exception: it has its own aggregate payload and no single display target.
function decimatorReadAddress() {
  if (get('ui.mode') === 'combined') return null;
  return getViewedAddress() || getActingAddress();
}

const ETH_BALANCE_RNG_PHASES = new Set([
  'submitting',
  'awaitingRng',
  'request-ready',
  'requesting-rng',
  'waiting-rng',
  'result-ready',
  'resolving',
  'indexing',
]);

/**
 * Exact shared-pool FLIP credit for a normal ticket + luckbox purchase.
 *
 * The mint module arms the luckbox record first; DegenerusGame arms the plain
 * ticket leg after that delegatecall returns. When one transaction clears both
 * bars, the second share is therefore taken from the already-reduced pool.
 * `null` means a qualifying legacy record is missing the clock needed for an
 * exact preview; callers must not invent a bounty amount in that case.
 */
export function purchaseRecordBountyWei({
  state,
  tickets = 0,
  luckboxWei = 0n,
  today = null,
} = {}) {
  const parsedTickets = Number(tickets);
  const ticketCandidate = Number.isFinite(parsedTickets) && parsedTickets > 0
    ? BigInt(Math.floor(parsedTickets))
    : 0n;
  let pool = toBigInt(state?.recordPoolWei);
  let total = 0n;
  for (const [kind, candidate] of [
    [RECORD_KIND_LUCKBOX, luckboxWei],
    [RECORD_KIND_BUY, ticketCandidate],
  ]) {
    const paid = candidateRecordPayoutWei({
      state,
      kind,
      candidate,
      today,
      poolWei: pool,
    });
    if (paid == null) return null;
    total += paid;
    pool = paid < pool ? pool - paid : 0n;
  }
  return total;
}

/** Whether unseen player work can still make the displayed ETH total a spoiler. */
export function pendingMayChangeEth(items = []) {
  return (Array.isArray(items) ? items : []).some((item) => {
    if (!item || item.mayAddEth === false) return false;
    const phase = String(item.phase || '');
    if (phase && !ETH_BALANCE_RNG_PHASES.has(phase)
      && !['decimator', 'baf'].includes(String(item.kind || ''))) return false;
    if (item.mayAddEth === true) return true;

    const kind = String(item.kind || '');
    if (kind === 'decimator' || kind === 'baf') return true;
    if (kind === 'lootbox') return item.resolved === true;
    if (kind !== 'degenerette') return false;

    const hasCurrency = item.currency != null && Number.isFinite(Number(item.currency));
    return (hasCurrency && Number(item.currency) === 0)
      || (!hasCurrency && /\bETH\b/i.test(`${item.label || ''} ${item.detail || ''}`));
  });
}

/**
 * Deterministic buyer FLIP credit from the current form values.
 *
 * The base and bulk legs are ticket-only. The rebuy leg is 10% of claimable
 * ETH recycled once that payment slice reaches three ticket prices. A foil
 * purchase applies the threshold independently to its foil and ordinary
 * purchase slices, matching the two contract modules.
 */
export function purchaseFlipCreditBreakdown({
  tickets = 0,
  priceWei = 0n,
  totalCostWei = 0n,
  mintCostWei = 0n,
  foilCostWei = 0n,
  presaleCostWei = 0n,
  claimableWei = 0n,
  afkingWei = 0n,
  preferClaimable = true,
  useAfking = false,
  bountyWei = 0n,
} = {}) {
  const parsedTickets = Number(tickets);
  const ticketCount = Number.isFinite(parsedTickets) && parsedTickets > 0
    ? parsedTickets
    : 0;
  // flipCostFromTickets intentionally falls back to one ticket for malformed
  // transaction inputs. A quote has different semantics: zero tickets means
  // zero ticket-derived credit (lootbox- and foil-only buys still may earn a
  // recycle bonus below).
  // The purchase reward is ticket-based, not entry-based: a fractional tail
  // does not receive the base credit. Thus 0.75 earns zero and 1.25 earns the
  // same base credit as one whole ticket.
  const bonusTickets = Math.floor(ticketCount);
  const ticketFaceFlip = bonusTickets >= 1 ? flipCostFromTickets(bonusTickets) : 0n;
  const purchase = ticketFaceFlip / 10n; // 100 FLIP per whole ticket
  const bulk = bonusTickets >= 10 ? ticketFaceFlip / 20n : 0n; // +50 / ticket

  let price = 0n;
  let total = 0n;
  let mintCost = 0n;
  let foilCost = 0n;
  let presaleCost = 0n;
  let claimable = 0n;
  let afking = 0n;
  let bounty = 0n;
  try { price = BigInt(priceWei); } catch (_e) { price = 0n; }
  try { total = BigInt(totalCostWei); } catch (_e) { total = 0n; }
  try { mintCost = BigInt(mintCostWei); } catch (_e) { mintCost = 0n; }
  try { foilCost = BigInt(foilCostWei); } catch (_e) { foilCost = 0n; }
  try { presaleCost = BigInt(presaleCostWei); } catch (_e) { presaleCost = 0n; }
  try { claimable = BigInt(claimableWei); } catch (_e) { claimable = 0n; }
  try { afking = BigInt(afkingWei); } catch (_e) { afking = 0n; }
  try { bounty = BigInt(bountyWei); } catch (_e) { bounty = 0n; }
  if (claimable < 0n) claimable = 0n;
  if (afking < 0n) afking = 0n;
  if (bounty < 0n) bounty = 0n;

  let rebuy = 0n;
  if (price > 0n && total > 0n) {
    const payment = preserveMintBonusWithPresale(
      purchaseFundingPayment(
        total,
        claimable,
        afking,
        { useClaimable: preferClaimable, useAfking },
      ),
      mintCost,
      presaleCost,
    );
    const threshold = price * 3n;
    const coinPerTicket = flipCostFromTickets(1);
    const creditFor = (claimableUsed) => (
      claimableUsed >= threshold
        ? (claimableUsed * coinPerTicket) / (price * 10n)
        : 0n
    );

    if (foilCost > 0n) {
      // _purchaseWithFoil gives fresh ETH to the ordinary mint/lootbox slice
      // first, then to foil. Each module evaluates the 3-ticket threshold.
      const mintFresh = payment.msgValueWei < mintCost ? payment.msgValueWei : mintCost;
      const foilFresh = payment.msgValueWei > mintFresh
        ? payment.msgValueWei - mintFresh
        : 0n;
      const mintClaimable = mintCost > mintFresh ? mintCost - mintFresh : 0n;
      const foilClaimable = foilCost > foilFresh ? foilCost - foilFresh : 0n;
      rebuy = creditFor(mintClaimable) + creditFor(foilClaimable);
    } else {
      // A combined mint + presale-box call allocates fresh ETH to the mint leg
      // first, then spends claimable on the rest. Only claimable consumed by
      // the mint earns this recycle bonus; the presale box itself does not.
      const freshForMint = payment.payKind === MINT_PAYMENT_KIND_CLAIMABLE
        ? 0n
        : payment.msgValueWei < mintCost ? payment.msgValueWei : mintCost;
      const mintShortfall = mintCost > freshForMint ? mintCost - freshForMint : 0n;
      const spendableClaimable = preferClaimable && claimable > 1n
        ? claimable - 1n
        : 0n;
      const mintClaimable = spendableClaimable < mintShortfall
        ? spendableClaimable
        : mintShortfall;
      rebuy = creditFor(presaleCost > 0n ? mintClaimable : payment.claimableUsedWei);
    }
  }

  return { purchase, bulk, rebuy, bounty, total: purchase + bulk + rebuy + bounty };
}

/** Maximum presale box that can be attached to the current draft purchase.
 * The combined contract call mints first, so its newly earned 25% credit is
 * immediately spendable by the box leg in the same transaction. */
export function presaleBoxAvailableWei(state, mintCostWei = 0n) {
  if (!state?.active) return 0n;
  let credit = 0n;
  let remaining = 0n;
  let mintCost = 0n;
  try { credit = BigInt(state.creditWei ?? 0n); } catch (_e) { credit = 0n; }
  try { remaining = BigInt(state.remainingWei ?? 0n); } catch (_e) { remaining = 0n; }
  try { mintCost = BigInt(mintCostWei ?? 0n); } catch (_e) { mintCost = 0n; }
  if (credit < 0n) credit = 0n;
  if (remaining <= 0n) return 0n;
  if (mintCost < 0n) mintCost = 0n;
  const available = credit + (mintCost / 4n);
  return available < remaining ? available : remaining;
}

/** Maximum quarter-ticket preset whose integer contract cost fits the budget. */
export function allInTicketAmount({ availableWei = 0n, priceWei = 0n, reservedWei = 0n } = {}) {
  let available = 0n;
  let price = 0n;
  let reserved = 0n;
  try { available = BigInt(availableWei); } catch (_e) { available = 0n; }
  try { price = BigInt(priceWei); } catch (_e) { price = 0n; }
  try { reserved = BigInt(reservedWei); } catch (_e) { reserved = 0n; }
  if (price <= 0n || available <= reserved) return '0';
  const spendable = available - reserved;
  let entries = ((spendable + 1n) * BigInt(ENTRIES_PER_TICKET) - 1n) / price;
  const maxSafeEntries = BigInt(Number.MAX_SAFE_INTEGER);
  if (entries > maxSafeEntries) entries = maxSafeEntries;
  if (entries <= 0n) return '0';
  const whole = entries / BigInt(ENTRIES_PER_TICKET);
  const remainder = Number(entries % BigInt(ENTRIES_PER_TICKET));
  return remainder === 0 ? String(whole) : `${whole}.${['', '25', '5', '75'][remainder]}`;
}

const ALL_IN_COINFLIP_MIN_WEI = 100n * (10n ** 18n);
const FLIP_WEI = 10n ** 18n;
// One displayed ETH cent remains in the connected wallet for transaction gas.
// LOOTBOX_MIN_WEI already expresses exactly 0.01 ETH in the active chain scale.
const ALL_IN_GAS_RESERVE_WEI = LOOTBOX_MIN_WEI;

export function allInDestinations(
  currency,
  flipTicketsOpen = false,
  decimatorOpen = false,
) {
  if (String(currency).toUpperCase() === 'FLIP') {
    return [
      'coinflip',
      'degenerette',
      ...(flipTicketsOpen ? ['tickets'] : []),
      ...(decimatorOpen ? ['decimator'] : []),
    ];
  }
  return ['tickets', 'lootbox', 'degenerette'];
}

/** Floor an ETH ALL IN budget to one displayed cent before route-specific math. */
export function floorAllInEthBudgetWei(raw) {
  let value = 0n;
  try { value = BigInt(raw ?? 0); } catch (_error) { return 0n; }
  if (value <= 0n || LOOTBOX_MIN_WEI <= 0n) return 0n;
  return value - (value % LOOTBOX_MIN_WEI);
}

export function allInWalletAfterGasReserveWei(raw) {
  let wallet = 0n;
  try { wallet = BigInt(raw ?? 0); } catch (_error) { return 0n; }
  return wallet > ALL_IN_GAS_RESERVE_WEI ? wallet - ALL_IN_GAS_RESERVE_WEI : 0n;
}

/** ALL IN is an earned high-variance surface, unlocked above 60 Degen Rating. */
export function allInDegenScoreEligible(value) {
  const score = Number(value);
  return Number.isFinite(score) && score > 60;
}

/** Exact, non-mutating quote for the dedicated ALL IN confirmation sheet. */
export function allInSelectionQuote({
  currency = 'ETH',
  target = 'tickets',
  spins = 5,
  purchaseEthWei = null,
  degeneretteEthWei = null,
  flipWei = null,
  ticketPriceWei = null,
  flipTicketsOpen = false,
  decimatorOpen = false,
  gasReady = true,
} = {}) {
  const unit = String(currency).toUpperCase() === 'FLIP' ? 'FLIP' : 'ETH';
  const formatSpend = (raw) => unit === 'ETH'
    ? `${groupAllInNumber(formatPurchaseEth(raw))} ETH`
    : `${groupAllInNumber(formatFlip(String(raw)))} FLIP`;
  const fail = (message) => ({
    valid: false,
    currency: unit,
    target,
    spins: Math.max(1, Math.trunc(Number(spins) || 1)),
    message,
    buttonLabel: 'ALL IN UNAVAILABLE',
  });
  if (!gasReady) return fail('Keep at least 0.01 ETH in your wallet for gas.');
  if (!allInDestinations(unit, flipTicketsOpen, decimatorOpen).includes(target)) {
    return fail('That format is not available for this currency right now.');
  }
  let budget = null;
  try {
    budget = BigInt(unit === 'FLIP'
      ? flipWei
      : target === 'degenerette' ? degeneretteEthWei : purchaseEthWei);
  } catch (_e) { budget = null; }
  if (budget == null) return fail(`${unit} balance is still loading.`);
  if (unit === 'ETH') budget = floorAllInEthBudgetWei(budget);
  if (budget <= 0n) return fail(`No ${unit} is available to go all in.`);

  let spendWei = budget;
  let outputLabel = '';
  let ticketAmount = null;
  let amountPerSpin = null;
  let spinCount = Math.max(1, Math.trunc(Number(spins) || 1));
  if (target === 'tickets') {
    let price = null;
    try {
      price = unit === 'FLIP' ? flipCostFromTickets(1) : BigInt(ticketPriceWei);
    } catch (_e) { price = null; }
    if (price == null || price <= 0n) return fail('Ticket price is still loading.');
    ticketAmount = allInTicketAmount({ availableWei: budget, priceWei: price });
    if (ticketAmount === '0') return fail(`Not enough ${unit} for one entry.`);
    spendWei = unit === 'FLIP'
      ? flipCostFromTickets(Number(ticketAmount))
      : ticketCostFromTickets(price, Number(ticketAmount));
    outputLabel = `${groupAllInNumber(ticketAmount)} ${ticketAmount === '1' ? 'TICKET' : 'TICKETS'}`;
  } else if (target === 'lootbox') {
    if (budget < LOOTBOX_MIN_WEI) return fail('At least 0.01 ETH is required for a luckbox.');
    outputLabel = '1 LUCKBOX';
  } else if (target === 'coinflip') {
    if (budget < ALL_IN_COINFLIP_MIN_WEI) return fail('At least 100 FLIP is required for Coinflip.');
    outputLabel = "TODAY'S COINFLIP";
  } else if (target === 'decimator') {
    if (budget < DECIMATOR_MIN_FLIP_WEI) {
      return fail('At least 1,000 FLIP is required for the Decimator.');
    }
    outputLabel = 'DECIMATOR';
  } else {
    const lane = unit === 'ETH' ? 0 : 1;
    const limits = degeneretteLimits(lane);
    spinCount = Math.min(limits.maxSpins, spinCount);
    const divisor = lane === 0 ? BigInt(ETH_DIVISOR) : 1n;
    const minimum = (limits.minBetFullScale + divisor - 1n) / divisor;
    amountPerSpin = budget / BigInt(spinCount);
    if (amountPerSpin < minimum) {
      return fail(`Not enough ${unit} for ${spinCount} Degenerette spins.`);
    }
    spendWei = amountPerSpin * BigInt(spinCount);
    outputLabel = `${groupAllInNumber(spinCount)} ${spinCount === 1 ? 'SPIN' : 'SPINS'}`;
  }
  const spendLabel = formatSpend(spendWei);
  const fingerprint = [unit, target, spinCount, spendWei, outputLabel].join(':');
  return {
    valid: true,
    currency: unit,
    target,
    spins: spinCount,
    spendWei,
    spendLabel,
    outputLabel,
    ticketAmount,
    amountPerSpin,
    fingerprint,
    message: target === 'degenerette' ? 'Uses your current Degenerette ticket and Hero.' : '',
    buttonLabel: `ALL IN: ${spendLabel} FOR ${outputLabel}`,
  };
}

class AppDecimatorPanel extends HTMLElement {
  // --- Phase 60 / 61 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  #busy = false;
  #errorTimer = null;
  // --- Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED — NOT polling.js) ---
  #pollHandle = null;
  #pollController = null;
  #lastPollAt = 0;
  #visibilityListener = null;
  #jackpotRevealListener = null;
  #coinflipFinishingListener = null;
  #coinflipRevealedListener = null;
  #allInCueTimer = null;
  #storageListener = null;
  #questActivateListener = null;
  #ticketSampleTimer = null;
  #buyInDialogOpen = false;
  #buyInDialogChoice = 'tickets';
  #buyInDialogReturnFocus = null;
  #customBoxOpen = false;
  #presaleOptionAvailable = false;
  // --- Pinned data (server-derived; rendered via textContent) ---
  #gameState = null;   // Phase 64 — /game/state snapshot (level + jackpotPhaseFlag → ticket price)
  #purchaseQuote = null; // Exact purchaseInfo() buy-now route/price.
  #claimableWei = 0n;  // Acting player's indexed claimable balance (quote only).
  #claimableAddress = null;
  #claimableKnown = false;
  #degenScore = null;
  #degenScoreAddress = null;
  #centuryUsedUnits = 0n;
  #centuryUsageAddress = null;
  #centuryUsageLevel = null;
  #centuryUsageKnown = false;
  #flipBalanceWei = null;      // Acting player's spendable FLIP balance.
  #flipBalanceAddress = null;
  #coinflipClaimableWei = 0n; // Settled/mintable Coinflip FLIP.
  #coinflipClaimableAddress = null;
  #coinflipClaimableKnown = false;
  // Indexed auto-rebuy carry: FLIP the player owns that claimable excludes.
  // Only ever added to TOTALS — no single transaction can spend it.
  #coinflipCarryWeiIndexed = 0n;
  #coinflipCarryAddress = null;
  #coinflipBackingWei = 0n; // Claimable plus active auto-rebuy carry.
  #coinflipBackingAddress = null;
  #coinflipBackingKnown = false;
  #afkingPendingFlipWei = 0n; // Accrued AFKing FLIP, converted from whole tokens.
  #afkingPendingFlipAddress = null;
  #afkingPendingFlipKnown = false;
  #walletEthWei = null;       // Connected signer's native wallet balance.
  #walletEthAddress = null;
  #afkingFundingWei = 0n;     // Acting player's spendable AFKing funding.
  #afkingFundingAddress = null;
  #afkingFundingKnown = false;
  #claimBusy = null;          // 'eth' while the footer claim is signing.
  #preferClaimable = true;    // ETH purchase funding preference; persisted per chain.
  #useAfking = true;          // Allow prepaid AFKing funds to cover purchase shortfalls.
  #fundingOrder = ['claimable', 'wallet', 'afking'];
  #fundsExpanded = false;     // Available Funds mirrors Protocol Coins disclosure.
  #pendingActions = [];       // Unseen ETH-capable RNG results hold the settled claimable value.
  // Referral assignment is player-specific and permanent after the first buy.
  // null = unknown (keep the field hidden), false = first-buy field available,
  // true = already assigned (field stays out of the purchase flow).
  #affiliateAssigned = null;
  #affiliateAddress = null;
  #affiliatePrefilledFor = null;
  #affiliateLocallyAssigned = new Set();
  // The purchase shortcut is an acquisition prompt, not an alternate route
  // into an already-owned seat. null means the exact pass read is unavailable
  // or still loading, so the safe rendering is hidden until a definitive
  // no-seat answer arrives for this acting player.
  #hasAfkingPass = null;
  #afkingPassAddress = null;
  // --- Exact zero-value purchase.staticCall result for the acting buyer.
  #foilStatus = null;
  #foilSeq = 0;
  #purchasePulseTimers = new WeakMap();
  #lastRenderedBonusFlip = 0n;
  // Presale is a live contract latch. The same-tx purchase leg can add 25%
  // credit before its attached box consumes it, so the rendered maximum also
  // depends on the current ticket/lootbox draft.
  #presaleState = null;
  #presaleAddress = null;
  // --- FLIP ticket buy (GAME.redeemFlip). The internal latch is governed by
  //     public pool/target/lock views. This flag is window availability only,
  //     never player affordability; the write validates the entered amount.
  #flipBuyOpen = false;
  #flipProbeSeq = 0;
  // Account-switcher (2026-07-16) — combined-mode summary source.
  #combined = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    const storedPriority = _readFundingPriority();
    const storedUseAfking = _readUseAfking();
    const primarySource = storedPriority === 'claimable'
      ? 'claimable'
      : storedPriority === 'afking' || storedUseAfking
        ? 'afking'
        : 'wallet';
    this.#preferClaimable = primarySource === 'claimable';
    this.#useAfking = primarySource !== 'wallet';
    this.#fundingOrder = [
      primarySource,
      ...this.#fundingOrder.filter((source) => source !== primarySource),
    ];
    this.#renderShell();
    this.#startTicketSample();
    this.#wireEventHandlers();
    this.#wireAllInCoinflipCue();
    this.#wireQuestPresets();
    this.#wireVisibilityRePoll();
    this.#wireClaimableSpoilerGate();
    this.#wireStoreSubscriptions();
    this.#renderCombinedSummary();
    this.#startPolling();
    // Eager first cycle on mount — no need to wait 30s.
    this.#runPollCycle();
  }

  disconnectedCallback() {
    this.#closeBuyInDialog({ restoreFocus: false });
    this.#closeBuilderPopovers({ restoreFocus: false });
    this.#clearPurchaseTargetPulse(this.querySelector('[data-bind="dec-flip-credit"]'));
    if (this.#ticketSampleTimer != null) {
      try { clearInterval(this.#ticketSampleTimer); } catch (_) { /* defensive */ }
      this.#ticketSampleTimer = null;
    }
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-total"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="dec-flip-balance-value"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-wallet"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-claimable"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-afking"]'));
    if (typeof this.#pollHandle === 'function') {
      try { this.#pollHandle(); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
      this.#pollController = null;
    }
    if (this.#visibilityListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_) { /* defensive */ }
    }
    this.#visibilityListener = null;
    if (this.#jackpotRevealListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('jackpot:revealed', this.#jackpotRevealListener); }
      catch (_) { /* defensive */ }
    }
    this.#jackpotRevealListener = null;
    if (this.#coinflipFinishingListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('flip:finishing', this.#coinflipFinishingListener); }
      catch (_) { /* defensive */ }
    }
    this.#coinflipFinishingListener = null;
    if (this.#coinflipRevealedListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('flip:revealed', this.#coinflipRevealedListener); }
      catch (_) { /* defensive */ }
    }
    this.#coinflipRevealedListener = null;
    this.#restoreAllInLabel();
    if (this.#storageListener
      && typeof window !== 'undefined'
      && typeof window.removeEventListener === 'function') {
      try { window.removeEventListener('storage', this.#storageListener); }
      catch (_) { /* defensive */ }
    }
    this.#storageListener = null;
    if (this.#questActivateListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('quest:activate', this.#questActivateListener); }
      catch (_e) { /* defensive */ }
    }
    this.#questActivateListener = null;
    if (this.#errorTimer != null) {
      try { clearTimeout(this.#errorTimer); } catch (_) { /* defensive */ }
      this.#errorTimer = null;
    }
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (get('ui.allInEligible') === true) update('ui.allInEligible', false);
  }

  // ---------------------------------------------------------------------
  // Render shell — STATIC innerHTML; T-58-18 hardening (no server data).
  // ---------------------------------------------------------------------

  #renderShell() {
    // Condensed shell: the purchase desk gets one short, useful identity line
    // without restoring the old blurb/level snapshot. The routed level and
    // price remain in the header; the visual box builder mirrors purchase()'s
    // packed Small / Medium / Large / Custom order.
    this.innerHTML = `
      <div class="panel app-decimator-panel">
        <div class="panel-header">
          <div class="dec-header-title">
            <h2 class="dec-purchase-heading">BUY IN</h2>
            <a class="dec-purchase-help" href="/learn/purchases/"
               aria-label="Learn about tickets, Luckbox, and foil packs"
               title="Learn about purchase options"><span aria-hidden="true">i</span></a>
          </div>
          <div class="dec-price" data-bind="dec-price"
               aria-label="Current entry, ticket, and pack prices">
            <span class="dec-price__row" data-bind="dec-entry-price">1 ENTRY - —</span>
            <span class="dec-price__row" data-bind="dec-ticket-price">1 TICKET - —</span>
            <span class="dec-price__row" data-bind="dec-pack-price">1 PACK - —</span>
          </div>
          <div class="dec-flip-credit dec-flip-credit--header is-idle"
               data-bind="dec-flip-credit"
               aria-label="Play to earn bonus FLIP with tickets">
            <img src="/whitepaper/flame-logo-split.svg" alt="">
            <span data-bind="dec-flip-credit-label">PLAY TO EARN</span>
            <strong data-bind="dec-flip-credit-total">BONUS FLIP</strong>
            <small class="dec-flip-credit__boon" data-bind="dec-purchase-boon-effect"
                   hidden></small>
          </div>
        </div>

        <!-- Account-switcher (2026-07-16): mode 'combined' shows the summed
             unclaimed decimator jackpot across the combined accounts (from
             app.playerCombined.decimator) — buying itself stays a per-account
             write (Buy CTA auto-disables via [data-write] + canSign). -->
        <div class="dec-combined-summary" data-bind="dec-combined-summary" hidden></div>

        <!-- Visual order builders mirror the deployed ABI. Ticket pieces add
             entry-sized increments to the footer total. Box quantities pack
             into [small:8][medium:8][large:8][custom:8][customSize:48]. -->
        <div class="dec-purchase-builders dec-input-row dec-input-row--pair">
          <section class="dec-purchase-builder dec-input-group dec-input-group--tickets"
                   aria-label="Add tickets">
            <span class="dec-input-accessories" role="group" aria-label="Ticket purchase modifiers">
              <boon-product-indicator product="purchase" data-bind="dec-ticket-boon"
                                      variant="purchase-control"></boon-product-indicator>
            </span>

            <div class="dec-ticket-pieces" role="group" aria-label="Add tickets to your buy in">
              <button type="button" class="dec-ticket-piece dec-ticket-piece--entry"
                      data-bind="dec-ticket-add-entry" aria-label="Add one entry, 0.25 ticket"
                      title="Click to add 0.25 ticket · right-click to remove">
                <span class="dec-ticket-piece__copy"><strong>ENTRY</strong></span>
                <span class="dec-ticket-piece__art" aria-hidden="true">
                  <span class="dec-entry-face ticket-entry-card tc-small"
                        data-bind="dec-entry-face" data-quadrant="0">
                    <span class="dec-ticket-trait trait-quadrant"><img data-bind="dec-entry-badge" alt=""></span>
                  </span>
                </span>
              </button>
              <button type="button" class="dec-ticket-piece dec-ticket-piece--ticket"
                      data-bind="dec-ticket-add-ticket" aria-label="Add one ticket"
                      title="Click to add one ticket · right-click to remove">
                <span class="dec-ticket-piece__copy"><strong>TICKET</strong></span>
                <span class="dec-ticket-piece__art" aria-hidden="true">
                  <span class="dec-ticket-face" data-bind="dec-ticket-sample">
                    <span class="dec-ticket-trait"><img data-bind="dec-ticket-badge-0" alt=""></span>
                    <span class="dec-ticket-trait"><img data-bind="dec-ticket-badge-1" alt=""></span>
                    <span class="dec-ticket-trait"><img data-bind="dec-ticket-badge-2" alt=""></span>
                    <span class="dec-ticket-trait"><img data-bind="dec-ticket-badge-3" alt=""></span>
                    <span class="dec-ticket-center"><img src="/whitepaper/flame-center.svg" alt=""></span>
                  </span>
                </span>
                <quest-objective-indicator class="dec-ticket-single-quest"
                                           product="purchase"
                                           quest-roles="DAILY,BONUS"></quest-objective-indicator>
              </button>
              <button type="button" class="dec-ticket-piece dec-ticket-piece--pack"
                      data-bind="dec-ticket-add-pack" aria-label="Add one pack, 10 tickets"
                      title="Click to add 10 tickets · right-click to remove">
                <span class="dec-ticket-piece__art" aria-hidden="true">
                  <span class="dec-pack-face">
                    <span class="dec-pack-mark"><img src="/whitepaper/flame-logo.svg" alt=""></span>
                    <span class="dec-pack-level" data-bind="dec-pack-level">LEVEL —</span>
                    <span class="dec-pack-count">10 TICKETS</span>
                  </span>
                </span>
                <quest-objective-indicator class="dec-ticket-pack-quest"
                                           product="purchase"
                                           quest-roles="LEVEL"></quest-objective-indicator>
              </button>
              <label class="dec-ticket-piece dec-ticket-piece--foil" data-bind="dec-foil-row"
                     aria-label="Toggle one foil pack, limit one" hidden>
                <input type="checkbox" name="dec-foil" class="dec-foil-check"
                       data-bind="dec-foil-check">
                <span class="dec-foil-limit-stamp"><strong>LIMIT</strong><small>1</small></span>
                <span class="dec-ticket-piece__art" aria-hidden="true">
                  <span class="dec-pack-face dec-foil-pack-face">
                    <span class="dec-pack-shine"></span>
                    <span class="dec-pack-mark dec-foil-pack-badge"><img src="/whitepaper/flame-logo.svg" alt=""></span>
                    <span class="dec-pack-level" data-bind="dec-foil-level">LEVEL —</span>
                    <span class="dec-pack-count">4 FOILS</span>
                  </span>
                  <span class="dec-foil-selected-check">✓</span>
                </span>
                <quest-objective-indicator product="foil"></quest-objective-indicator>
                <span class="dec-foil-price dec-visually-hidden" data-bind="dec-foil-price">—</span>
              </label>
            </div>
          </section>

          <section class="dec-purchase-builder dec-input-group dec-input-group--lootbox"
                   data-bind="dec-lootbox-group" aria-labelledby="dec-box-builder-title">
            <div class="dec-builder-head">
              <span class="dec-builder-title">
                <button type="button" class="dec-custom-box-toggle" data-bind="dec-custom-box-toggle"
                        aria-expanded="false" aria-controls="dec-custom-box-fields">
                  <span class="dec-custom-box-logo" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M4.5 8.5 7.2 5.8h9.6l2.7 2.7v9.7h-15Z"></path>
                      <path d="M4.5 10.3h15M8.2 8.2V6M15.8 8.2V6M12 12v4M10 14h4"></path>
                    </svg>
                  </span>
                  <span class="dec-custom-box-toggle__copy">
                    <strong id="dec-box-builder-title" data-bind="dec-box-options-title">CUSTOM LUCKBOXES</strong>
                    <small data-bind="dec-custom-box-selection" hidden></small>
                  </span>
                </button>
                <span class="dec-input-accessories" role="group" aria-label="Luckbox purchase modifiers">
                  <quest-objective-indicator product="lootbox"></quest-objective-indicator>
                  <boon-product-indicator product="lootbox"
                                          variant="purchase-control"></boon-product-indicator>
                </span>
              </span>
            </div>

            <div class="dec-box-grid">
              <article class="dec-box-card dec-box-card--small" data-tone="green"
                       data-lootbox-case-model="small">
                <button type="button" class="dec-box-card__add" data-bind="dec-box-add-small"
                        aria-label="Add one small Luckbox"
                        title="Click to add one small Luckbox · right-click to remove">
                  <span class="dec-box-card__art" aria-hidden="true">
                    <img class="dec-box-card__image" src="${BUY_IN_COMPACT_CASE_ART.small}" alt="" loading="lazy" decoding="async" fetchpriority="low">
                    <span class="dec-box-card__quickload"></span>
                    <span class="dec-box-value">
                      <strong data-bind="dec-box-price-small">—</strong>
                      <small class="dec-box-value__unit" data-bind="dec-box-price-small-unit" hidden>ETH</small>
                    </span>
                  </span>
                </button>
                <span class="dec-box-quantity">
                  <button type="button" class="dec-box-step" data-step-for="dec-box-small" data-dir="-1"
                          aria-label="Remove one small Luckbox">−</button>
                  <input type="number" name="dec-box-small" min="0" max="100" step="1" value="0"
                         inputmode="numeric" aria-label="Small Luckbox quantity">
                  <button type="button" class="dec-box-step" data-step-for="dec-box-small" data-dir="1"
                          aria-label="Add one small Luckbox">+</button>
                </span>
              </article>

              <article class="dec-box-card dec-box-card--medium" data-tone="purple"
                       data-lootbox-case-model="medium">
                <button type="button" class="dec-box-card__add" data-bind="dec-box-add-medium"
                        aria-label="Add one medium Luckbox"
                        title="Click to add one medium Luckbox · right-click to remove">
                  <span class="dec-box-card__art" aria-hidden="true">
                    <img class="dec-box-card__image" src="${BUY_IN_COMPACT_CASE_ART.medium}" alt="" loading="lazy" decoding="async" fetchpriority="low">
                    <span class="dec-box-card__quickload"></span>
                    <span class="dec-box-value">
                      <strong data-bind="dec-box-price-medium">—</strong>
                      <small class="dec-box-value__unit" data-bind="dec-box-price-medium-unit" hidden>ETH</small>
                    </span>
                  </span>
                </button>
                <span class="dec-box-quantity">
                  <button type="button" class="dec-box-step" data-step-for="dec-box-medium" data-dir="-1"
                          aria-label="Remove one medium Luckbox">−</button>
                  <input type="number" name="dec-box-medium" min="0" max="100" step="1" value="0"
                         inputmode="numeric" aria-label="Medium Luckbox quantity">
                  <button type="button" class="dec-box-step" data-step-for="dec-box-medium" data-dir="1"
                          aria-label="Add one medium Luckbox">+</button>
                </span>
              </article>

              <article class="dec-box-card dec-box-card--large" data-tone="gold"
                       data-lootbox-case-model="large">
                <button type="button" class="dec-box-card__add" data-bind="dec-box-add-large"
                        aria-label="Add one large Luckbox"
                        title="Click to add one large Luckbox · right-click to remove">
                  <span class="dec-box-card__art" aria-hidden="true">
                    <img class="dec-box-card__image" src="${BUY_IN_GOLD_CASE_ART}" alt="" loading="lazy" decoding="async" fetchpriority="low">
                    <span class="dec-box-card__quickload"></span>
                    <span class="dec-box-value">
                      <strong data-bind="dec-box-price-large">—</strong>
                      <small class="dec-box-value__unit" data-bind="dec-box-price-large-unit" hidden>ETH</small>
                    </span>
                  </span>
                </button>
                <span class="dec-box-quantity">
                  <button type="button" class="dec-box-step" data-step-for="dec-box-large" data-dir="-1"
                          aria-label="Remove one large Luckbox">−</button>
                  <input type="number" name="dec-box-large" min="0" max="100" step="1" value="0"
                         inputmode="numeric" aria-label="Large Luckbox quantity">
                  <button type="button" class="dec-box-step" data-step-for="dec-box-large" data-dir="1"
                          aria-label="Add one large Luckbox">+</button>
                </span>
              </article>
            </div>
            <p class="dec-box-summary dec-visually-hidden" data-bind="dec-box-summary"
               aria-live="polite"></p>
          </section>
        </div>

        <div id="dec-custom-box-fields" class="dec-builder-popover"
             data-bind="dec-custom-box-fields" hidden>
          <button type="button" class="dec-builder-popover__backdrop"
                  data-bind="dec-custom-box-close" aria-label="Close Luckbox options"></button>
          <section class="dec-builder-dialog dec-box-options-dialog" role="dialog" aria-modal="true"
                   aria-labelledby="dec-custom-box-title">
            <header class="dec-builder-dialog__head">
              <span><strong id="dec-custom-box-title">LUCKBOX OPTIONS</strong><small>Choose custom boxes or available presale credit</small></span>
              <button type="button" class="dec-builder-dialog__close" data-bind="dec-custom-box-close"
                      aria-label="Close Luckbox options">×</button>
            </header>
            <label class="dec-builder-dialog__field" for="dec-box-custom-count">
              <span>BOXES</span>
              <span class="dec-custom-box-control dec-box-quantity">
                <button type="button" class="dec-box-step" data-step-for="dec-box-custom-count" data-dir="-1"
                        aria-label="Remove one custom Luckbox">−</button>
                <input type="number" id="dec-box-custom-count" name="dec-box-custom-count" min="0" max="100" step="1" value="0"
                       inputmode="numeric" aria-label="Custom Luckbox quantity">
                <button type="button" class="dec-box-step" data-step-for="dec-box-custom-count" data-dir="1"
                        aria-label="Add one custom Luckbox">+</button>
              </span>
            </label>
            <label class="dec-builder-dialog__field" for="dec-box-custom-eth">
              <span>ETH EACH</span>
              <span class="dec-custom-box-control dec-custom-box-control--size">
                <input type="number" id="dec-box-custom-eth" name="dec-box-custom-eth" min="0.01" step="0.01" value="0.01"
                       inputmode="decimal" aria-label="Custom Luckbox ETH per box">
                <strong>ETH</strong>
              </span>
            </label>
            <!-- The configured amount selects the physical case automatically.
                 Keep this as an art-only preview: count and ETH each are already
                 stated by the two controls immediately above it. -->
            <div class="dec-box-preview" data-bind="dec-custom-box-preview" hidden>
              <span class="dec-box-preview__art" data-lootbox-case-model="small" aria-hidden="true">
                <img class="dec-box-preview__image" data-bind="dec-custom-box-preview-art"
                     src="${BUY_IN_COMPACT_CASE_ART.small}" alt=""
                     loading="lazy" decoding="async" fetchpriority="low">
              </span>
            </div>

            <!-- Live credit-gated presale appears as an option in this same
                 chooser only while the acting player can use it. -->
            <div class="dec-presale__offer" data-bind="dec-presale-row" hidden>
              <div class="dec-presale__label">
                <span class="dec-presale__art" aria-hidden="true" data-lootbox-case-model="medium">
                  <img src="${lootboxCaseAssets('medium').cardTop}" alt="" loading="lazy" decoding="async" fetchpriority="low"><b>PRESALE</b>
                </span>
                <span><strong>PRESALE BOX</strong><small data-bind="dec-presale-available">— ETH AVAILABLE</small></span>
              </div>
              <div class="dec-presale__controls">
                <input type="number" name="dec-presale-box-eth"
                       min="0" step="0.01" value="0"
                       inputmode="decimal" aria-label="Presale box amount in ETH">
                <span>ETH</span>
                <button type="button" data-bind="dec-presale-max">MAX</button>
              </div>
            </div>
            <button type="button" class="dec-builder-dialog__done" data-write
                    data-bind="dec-custom-box-buy">
              <span data-bind="dec-custom-box-buy-action">BUY IN</span>
              <strong data-bind="dec-custom-box-buy-amount" hidden></strong>
            </button>
          </section>
        </div>

        <!-- One stable order rail: Clear, editable tickets, then purchase. -->
        <div class="dec-buy-row">
          <button type="button" data-bind="dec-ticket-clear" class="dec-ticket-clear">CLEAR</button>
          <span class="dec-ticket-total__field">
            <input type="number" name="dec-tickets" id="dec-tickets-input"
                   class="dec-input" min="0" step="0.25" value="0"
                   inputmode="decimal" aria-label="Tickets in order">
            <strong>TIX</strong>
            <span class="dec-ticket-stepper">
              <button type="button" class="dec-step" data-step-for="dec-tickets" data-dir="1"
                      aria-label="Add one ticket"></button>
              <button type="button" class="dec-step" data-step-for="dec-tickets" data-dir="-1"
                      aria-label="Remove one ticket"></button>
            </span>
          </span>
          <!-- CF-15: data-write triggers Phase 58 view-mode disable manager. -->
          <button type="button" class="dec-buy-cta" data-write data-bind="dec-buy-cta">
            <span class="dec-buy-cta__action" data-bind="dec-buy-cta-action">CLICK TO ADD</span>
            <strong class="dec-buy-cta__amount" data-bind="dec-buy-cta-amount" hidden></strong>
          </button>
        </div>

        <button type="button" class="dec-afking-jump" data-bind="dec-afking-jump"
                aria-controls="afking-passes" hidden>
          <span class="dec-afking-jump__mark" aria-hidden="true">AFK</span>
          <strong>BUY AFKING PASS</strong>
          <span class="dec-afking-jump__arrow" aria-hidden="true">↓</span>
        </button>

        <!-- Error display (T-58-18: textContent-only target) -->
        <div class="dec-error" data-bind="dec-error" hidden role="alert"></div>

        <!-- Decorative spacer: fills the flexible space between the action
             rail and the counter ledger with the house seal pressed tonally
             into the felt (art only — aria-hidden, no data, no handlers; all
             visuals live in purchase-desk.css and the block stays
             display:none outside the basic layout). -->
        <div class="dec-desk-cage" aria-hidden="true">
          <span class="dec-desk-cage__seal"></span>
        </div>

        <!-- ALL IN keeps its normal half-width action footprint above the ledgers.
             During the redemption window FLIP then receives a full compact row,
             matching the collapsed ETH ledger beneath it. -->
        <div class="dec-funds-stack">
          <button type="button" class="dec-all-in" data-bind="dec-all-in" disabled
                  aria-label="Use all available ETH for tickets">
            <img class="dec-all-in__flame" src="/whitepaper/flame-center.svg"
                 alt="" aria-hidden="true">
            <strong class="dec-all-in__label">ALL IN</strong>
            <img class="dec-all-in__flame" src="/whitepaper/flame-center.svg"
                 alt="" aria-hidden="true">
          </button>

          <div class="dec-flip-balance" data-bind="dec-flip-balance" hidden
               aria-label="FLIP balance">
            <span class="dec-flip-balance__action">
              <button type="button" class="dec-flip-toggle dec-flip-balance__mode"
                      data-bind="dec-funds-total-flip" aria-pressed="false" hidden>USE FLIP</button>
              <quest-objective-indicator class="dec-redeem-quest"
                                         data-quest-pointer="bottom-left"
                                         product="redeem-flip"></quest-objective-indicator>
            </span>
            <span class="dec-flip-balance__label">FLIP BALANCE</span>
            <strong class="dec-flip-balance__value">
              <span data-bind="dec-flip-balance-value">—</span>
              <span class="dec-flip-balance__unit">FLIP</span>
            </strong>
          </div>

          <!-- Protocol-Coins-style funds disclosure: the collapsed row is an
               aggregate only; opening it swaps in the ordered source rows. -->
          <div class="dec-funds" data-bind="dec-funds">
            <button type="button" class="dec-funds__summary" data-bind="dec-funds-toggle"
                    aria-expanded="false" aria-controls="dec-funds-breakdown">
              <span class="dec-funds__summary-label">AVAILABLE FUNDS</span>
              <span class="dec-funds__chevron" aria-hidden="true"></span>
            </button>
            <div class="dec-funds__total" data-bind="dec-funds-total-display">
              <button type="button" class="dec-flip-toggle dec-funds__eth-mode"
                      data-bind="dec-funds-total-eth" hidden
                      aria-label="Use ETH for purchases">USE ETH</button>
              <strong class="dec-funds__value dec-funds__total-value">
                <span class="dec-funds__number" data-bind="dec-funds-total">—</span>
                <span class="dec-funds__unit">ETH</span>
              </strong>
            </div>
            <div id="dec-funds-breakdown" class="dec-funds__breakdown"
                 data-bind="dec-funds-breakdown" data-expanded="false" hidden>
            <div class="dec-funds__display dec-funds__display--claimable"
                 data-bind="dec-funds-claimable-display">
              <span class="dec-funds__label"><span>CLAIMABLE</span></span>
              <button type="button" class="dec-funds__priority"
                      data-bind="dec-funds-use-claimable" aria-pressed="true">
                USE FIRST
              </button>
              <strong class="dec-funds__value dec-funds__value--claimable">
                <span class="dec-funds__number" data-bind="dec-funds-claimable">—</span>
                <span class="dec-funds__unit" data-bind="dec-funds-claimable-unit">ETH</span>
              </strong>
              <button type="button" class="dec-funds__claim" data-write
                      data-bind="dec-funds-claim" hidden disabled>CLAIM</button>
            </div>
            <div class="dec-funds__display dec-funds__display--afking"
                 data-bind="dec-funds-afking-display" hidden>
              <span class="dec-funds__label"><span>AFKING</span></span>
              <button type="button" class="dec-funds__priority"
                      data-bind="dec-funds-use-afking" aria-pressed="false">
                USE FIRST
              </button>
              <strong class="dec-funds__value" data-bind="dec-funds-afking">—</strong>
              <button type="button" class="dec-funds__claim" data-write
                      data-bind="dec-funds-afking-claim" hidden disabled>CLAIM</button>
            </div>
            <div class="dec-funds__display dec-funds__display--wallet"
                 data-bind="dec-funds-wallet-display" hidden>
              <span class="dec-funds__label">
                <span data-bind="dec-funds-wallet-label">WALLET</span>
              </span>
              <button type="button" class="dec-funds__priority"
                      data-bind="dec-funds-use-wallet" aria-pressed="false">
                USE FIRST
              </button>
              <!-- Internal state bridge retained for quest presets and the
                   transaction path; the visible selectors above are buttons. -->
              <input type="checkbox" name="dec-redeem-with-flip"
                     data-bind="dec-flip-check" hidden aria-hidden="true" tabindex="-1">
              <span class="dec-funds__wallet-value">
                <strong class="dec-funds__value" data-bind="dec-funds-wallet">—</strong>
                <a class="dec-funds__faucet" data-bind="dec-funds-faucet"
                   href="${BASE_SEPOLIA_FAUCET_URL}" target="_blank"
                   rel="noopener noreferrer" hidden>GET PLAY MONEY</a>
              </span>
            </div>
            </div>
          </div>
        </div>
      </div>
    `;
    this.querySelectorAll?.('[data-lootbox-case-model]').forEach((element) => {
      applyLootboxCasePresentation(element, element.getAttribute('data-lootbox-case-model'));
      const model = element.getAttribute('data-lootbox-case-model');
      if (model === 'small' || model === 'medium') {
        const geometry = BUY_IN_COMPACT_CASE_GEOMETRY[model];
        element.style.setProperty('--lootbox-case-purchase-art', `url("${BUY_IN_COMPACT_CASE_ART[model]}")`);
        element.style.setProperty('--lootbox-price-top', geometry.priceTop);
        element.style.setProperty('--lootbox-price-height', geometry.priceHeight);
        element.style.setProperty('--lootbox-price-width', geometry.priceWidth);
        element.style.setProperty('--lootbox-top-badge-clip', geometry.badgeClip);
      } else if (model === 'large') {
        element.style.setProperty('--lootbox-case-purchase-art', `url("${BUY_IN_GOLD_CASE_ART}")`);
        element.style.setProperty('--lootbox-price-top', BUY_IN_GOLD_CASE_GEOMETRY.priceTop);
        element.style.setProperty('--lootbox-price-height', BUY_IN_GOLD_CASE_GEOMETRY.priceHeight);
        element.style.setProperty('--lootbox-price-width', BUY_IN_GOLD_CASE_GEOMETRY.priceWidth);
        element.style.setProperty('--lootbox-top-badge-top', BUY_IN_GOLD_CASE_GEOMETRY.badgeTop);
        element.style.setProperty('--lootbox-top-badge-size', BUY_IN_GOLD_CASE_GEOMETRY.badgeSize);
        element.style.setProperty('--lootbox-top-badge-scale-y', BUY_IN_GOLD_CASE_GEOMETRY.badgeScaleY);
      }
    });
    // A CSS-only case silhouette paints immediately. Keep the image, latches,
    // badge, and live price together behind it until the authored bitmap has
    // fully loaded; otherwise a cold cache briefly leaves the price floating
    // by itself in an empty grid track.
    this.querySelectorAll?.('.dec-box-card__image').forEach((image) => {
      const revealArt = () => image.classList?.add('is-art-ready');
      if (image.complete && Number(image.naturalWidth) > 0) revealArt();
      else image.addEventListener?.('load', revealArt, { once: true });
    });
  }

  #startTicketSample() {
    this.#renderTicketSample();
    if (this.#ticketSampleTimer != null) {
      try { clearInterval(this.#ticketSampleTimer); } catch (_) { /* defensive */ }
    }
    this.#ticketSampleTimer = setInterval(
      () => this.#renderTicketSample(),
      PURCHASE_TICKET_SAMPLE_REFRESH_MS,
    );
    // Node's test runner should not stay alive solely for this visual timer.
    this.#ticketSampleTimer?.unref?.();
  }

  #renderTicketSample(piece = 'all') {
    const refreshTicket = piece === 'all' || piece === 'ticket';
    const refreshEntry = piece === 'all' || piece === 'entry';
    let traits = null;
    let entryTrait = null;
    try {
      if (refreshTicket) traits = randomPurchaseTicketTraits();
      if (refreshEntry) entryTrait = randomPurchaseEntryTrait();
    }
    catch (_e) { return; }
    const ticket = this.querySelector('[data-bind="dec-ticket-sample"]');
    const entry = this.querySelector('[data-bind="dec-entry-face"]');
    const setAccent = (element, sampleTraits) => {
      if (!element) return;
      const accent = dgnTicketAccent(sampleTraits).hex;
      try {
        if (typeof element.style?.setProperty === 'function') {
          element.style.setProperty('--ticket-line-color', accent);
        } else if (element.style) {
          element.style['--ticket-line-color'] = accent;
        }
      } catch (_e) { /* visual enhancement only */ }
    };
    if (refreshTicket && traits) {
      const images = traits.map((_trait, quadrant) => (
        this.querySelector(`[data-bind="dec-ticket-badge-${quadrant}"]`)
      ));
      const currentPaths = images.map((image) => image?.getAttribute?.('src') || '');
      let nextTraits = traits;
      let nextPaths = nextTraits.map((trait, quadrant) => (
        dgnBadgePath(quadrant, trait.sym, trait.col)
      ));
      // A fresh random draw can theoretically repeat the complete ticket.
      // Force one quadrant forward so every accepted click visibly replaces
      // the source artwork instead of occasionally appearing to do nothing.
      if (currentPaths.length > 0
        && nextPaths.every((path, quadrant) => path === currentPaths[quadrant])) {
        const first = nextTraits[0];
        const sym = (Number(first.sym) + 1) & 7;
        nextTraits = [{
          ...first,
          sym,
          byte: (Number(first.q) << 6) | (Number(first.col) << 3) | sym,
        }, ...nextTraits.slice(1)];
        nextPaths = nextTraits.map((trait, quadrant) => (
          dgnBadgePath(quadrant, trait.sym, trait.col)
        ));
      }
      setAccent(ticket, nextTraits);
      images.forEach((image, quadrant) => image?.setAttribute?.('src', nextPaths[quadrant]));
    }
    if (refreshEntry && entryTrait) {
      const entryBadge = this.querySelector('[data-bind="dec-entry-badge"]');
      const currentPath = entryBadge?.getAttribute?.('src') || '';
      let nextTrait = entryTrait;
      let nextPath = dgnBadgePath(nextTrait.q, nextTrait.sym, nextTrait.col);
      if (nextPath === currentPath) {
        const sym = (Number(nextTrait.sym) + 1) & 7;
        nextTrait = {
          ...nextTrait,
          sym,
          byte: (Number(nextTrait.q) << 6) | (Number(nextTrait.col) << 3) | sym,
        };
        nextPath = dgnBadgePath(nextTrait.q, nextTrait.sym, nextTrait.col);
      }
      setAccent(entry, [nextTrait]);
      entry?.setAttribute?.('data-quadrant', String(nextTrait.q));
      entry?.setAttribute?.('data-trait-id', String(nextTrait.byte));
      entryBadge?.setAttribute?.('src', nextPath);
    }
  }

  #renderBuilderPopovers() {
    const customToggle = this.querySelector('[data-bind="dec-custom-box-toggle"]');
    const custom = this.querySelector('[data-bind="dec-custom-box-fields"]');
    customToggle?.setAttribute?.('aria-expanded', String(this.#customBoxOpen));
    if (custom) {
      custom.hidden = !this.#customBoxOpen;
      if (custom.hidden) custom.setAttribute?.('hidden', '');
      else custom.removeAttribute?.('hidden');
    }
  }

  // Only the fields this popover owns. The Small / Medium / Large presets live
  // on the builder cards outside it, so dismissing the chooser must not touch
  // a selection the player made out there.
  #resetCustomBoxDraft() {
    const count = this.querySelector('[name="dec-box-custom-count"]');
    if (count) count.value = '0';
    const size = this.querySelector('[name="dec-box-custom-eth"]');
    if (size) size.value = '0.01';
    const presale = this.querySelector('[name="dec-presale-box-eth"]');
    if (presale) presale.value = '0';
  }

  #closeCustomBoxPopover({ restoreFocus = true, reset = false } = {}) {
    const wasOpen = this.#customBoxOpen;
    // Dismissing abandons the draft. These amounts are only ever visible inside
    // this popover, so leaving them armed behind a closed chooser would put
    // boxes the player thought they had cancelled into the next BUY IN.
    if (reset && wasOpen) {
      this.#resetCustomBoxDraft();
      this.#updateTotalLabel();
    }
    this.#customBoxOpen = false;
    this.#renderBuilderPopovers();
    if (wasOpen && restoreFocus) {
      try { this.querySelector('[data-bind="dec-custom-box-toggle"]')?.focus?.({ preventScroll: true }); }
      catch (_e) { /* focus is progressive enhancement */ }
    }
  }

  #closeBuilderPopovers({ restoreFocus = false } = {}) {
    const customWasOpen = this.#customBoxOpen;
    this.#customBoxOpen = false;
    this.#renderBuilderPopovers();
    if (!restoreFocus || !customWasOpen) return;
    try { this.querySelector('[data-bind="dec-custom-box-toggle"]')?.focus?.({ preventScroll: true }); }
    catch (_e) { /* focus is progressive enhancement */ }
  }

  #wireEventHandlers() {
    const buyBtn = this.querySelector('[data-bind="dec-buy-cta"]');
    if (buyBtn) {
      buyBtn.addEventListener('click', (e) => {
        if (!this.#hasBuySelection()) {
          try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
          const builders = this.querySelector('.dec-purchase-builders');
          builders?.classList?.remove('is-prompting');
          // Restart the compact visual cue without opening a second chooser.
          void builders?.offsetWidth;
          builders?.classList?.add('is-prompting');
          try { this.querySelector('[data-bind="dec-ticket-add-entry"]')?.focus?.({ preventScroll: true }); }
          catch (_e) { /* focus is progressive enhancement */ }
          return;
        }
        void (this.#flipModeEnabled() ? this.#onBuyWithFlipClick(e) : this.#onBuyClick(e));
      });
    }
    for (const close of Array.from(
      this.querySelectorAll?.('[data-bind="dec-buy-dialog-close"]') || [],
    )) {
      close.addEventListener?.('click', () => this.#closeBuyInDialog());
    }
    this.querySelector('[data-bind="dec-buy-dialog-tickets"]')?.addEventListener?.(
      'click', () => this.#selectBuyInDialogChoice('tickets'),
    );
    this.querySelector('[data-bind="dec-buy-dialog-luckbox"]')?.addEventListener?.(
      'click', () => this.#selectBuyInDialogChoice('luckbox'),
    );
    this.querySelector('[data-bind="dec-buy-dialog-foil"]')?.addEventListener?.(
      'click', () => this.#selectBuyInDialogChoice('foil'),
    );
    const buyInAmount = this.querySelector('[name="dec-buy-dialog-amount"]');
    buyInAmount?.addEventListener?.('input', () => this.#renderBuyInDialog());
    buyInAmount?.addEventListener?.('change', () => this.#renderBuyInDialog());
    this.querySelector('[data-bind="dec-buy-dialog-down"]')?.addEventListener?.('click', () => {
      const model = this.#buyInDialogAmountModel();
      if (!buyInAmount || model.fixed) return;
      this.#stepInput(buyInAmount, -1, model.step);
      this.#renderBuyInDialog();
    });
    this.querySelector('[data-bind="dec-buy-dialog-up"]')?.addEventListener?.('click', () => {
      const model = this.#buyInDialogAmountModel();
      if (!buyInAmount || model.fixed) return;
      this.#stepInput(buyInAmount, 1, model.step);
      this.#renderBuyInDialog();
    });
    this.querySelector('[data-bind="dec-buy-dialog-confirm"]')?.addEventListener?.(
      'click', (event) => { void this.#submitBuyInDialog(event); },
    );
    this.querySelector('[data-bind="dec-buy-dialog"]')?.addEventListener?.('keydown', (event) => {
      if (event?.key === 'Escape') this.#closeBuyInDialog();
    });
    const allIn = this.querySelector('[data-bind="dec-all-in"]');
    if (allIn) allIn.addEventListener('click', () => this.#openAllInDialog());
    const claimBtn = this.querySelector('[data-bind="dec-funds-claim"]');
    if (claimBtn) {
      claimBtn.addEventListener('click', (e) => this.#onClaimFundsClick(e));
    }
    const afkingClaimBtn = this.querySelector('[data-bind="dec-funds-afking-claim"]');
    if (afkingClaimBtn) {
      afkingClaimBtn.addEventListener('click', (e) => this.#onClaimAfkingFundsClick(e));
    }
    const afkingJump = this.querySelector('[data-bind="dec-afking-jump"]');
    if (afkingJump) {
      afkingJump.addEventListener('click', () => this.#openAfkingPasses());
    }
    const fundsToggle = this.querySelector('[data-bind="dec-funds-toggle"]');
    const fundsBreakdown = this.querySelector('[data-bind="dec-funds-breakdown"]');
    if (fundsToggle && fundsBreakdown) {
      fundsToggle.addEventListener('click', (event) => {
        const open = fundsToggle.getAttribute('aria-expanded') !== 'true';
        this.#fundsExpanded = open;
        fundsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (fundsBreakdown.dataset) fundsBreakdown.dataset.expanded = String(open);
        this.#renderFundsFooter();
        // A pointer tap should not leave the disclosure's hover/focus treatment
        // painted over the newly opened ledger. Preserve keyboard focus for
        // keyboard activation (click detail 0) so the control remains usable.
        if (Number(event?.detail) > 0) fundsToggle.blur?.();
      });
    }
    const useClaimable = this.querySelector('[data-bind="dec-funds-use-claimable"]');
    if (useClaimable) {
      useClaimable.addEventListener('click', () => this.#setPrimaryFundingSource('claimable'));
    }
    const useAfking = this.querySelector('[data-bind="dec-funds-use-afking"]');
    if (useAfking) {
      useAfking.addEventListener('click', () => this.#setPrimaryFundingSource('afking'));
    }
    const useWallet = this.querySelector('[data-bind="dec-funds-use-wallet"]');
    if (useWallet) {
      useWallet.addEventListener('click', () => this.#setPrimaryFundingSource('wallet'));
    }
    const flipCheck = this.querySelector('[data-bind="dec-flip-check"]');
    if (flipCheck) {
      flipCheck.addEventListener('change', () => {
        // FLIP is a tickets-only payment source. Seed a useful one-ticket
        // quote when the field is still zero, but never overwrite an amount
        // the player already entered.
        if (flipCheck.checked) {
          const tickets = this.querySelector('[name="dec-tickets"]');
          const current = Number(tickets?.value ?? 0);
          if (tickets && Number.isFinite(current) && current === 0) tickets.value = '1';
          const presale = this.querySelector('[name="dec-presale-box-eth"]');
          if (presale) presale.value = '0';
        } else {
          // Do not let a prior FLIP quote remain painted while the control is
          // visibly back in ETH mode. #renderPurchaseMode immediately replaces
          // this baseline with the value-accurate ETH total.
          this.#setBuyLabel('CLICK TO ADD');
        }
        this.#renderPurchaseMode();
      });
    }
    for (const bind of ['dec-funds-total-flip', 'dec-funds-total-eth']) {
      const toggle = this.querySelector(`[data-bind="${bind}"]`);
      if (!toggle) continue;
      toggle.addEventListener('click', () => {
        const state = this.querySelector('[data-bind="dec-flip-check"]');
        if (!state || !this.#flipBuyOpen) return;
        state.checked = !this.#flipModeEnabled();
        this.#emitFormEvent(state, 'change');
        this.#updateTotalLabel();
      });
    }
    for (const [bind, amount] of [
      ['dec-ticket-add-entry', 0.25],
      ['dec-ticket-add-ticket', 1],
      ['dec-ticket-add-pack', PURCHASE_TICKETS_PER_PACK],
    ]) {
      const control = this.querySelector(`[data-bind="${bind}"]`);
      const adjust = (dir) => {
        const input = this.querySelector('[name="dec-tickets"]');
        if (!input) return;
        const before = Number(input.value) || 0;
        this.#stepInput(input, dir, amount);
        this.#updateTotalLabel();
        return Number(input.value) !== before;
      };
      control?.addEventListener?.('click', () => {
        if (adjust(1)) {
          this.#animatePurchaseAddition(control, {
            label: amount === 0.25 ? '+¼' : `+${amount}`,
          });
          // #animatePurchaseAddition snapshots the clicked artwork
          // synchronously. Reroll only after that clone exists so the piece
          // flying into TIX keeps the symbols the player actually selected.
          if (amount === 0.25) this.#renderTicketSample('entry');
          else if (amount === 1) this.#renderTicketSample('ticket');
        }
      });
      control?.addEventListener?.('contextmenu', (event) => {
        event?.preventDefault?.();
        if (!control.disabled) adjust(-1);
      });
    }
    this.querySelector('[data-bind="dec-ticket-clear"]')?.addEventListener?.('click', () => {
      const input = this.querySelector('[name="dec-tickets"]');
      if (input) input.value = '0';
      this.#clearBoxDraft();
      const foil = this.querySelector('[data-bind="dec-foil-check"]');
      if (foil) foil.checked = false;
      const foilRow = this.querySelector('[data-bind="dec-foil-row"]');
      foilRow?.classList?.remove('is-selected');
      foilRow?.setAttribute?.('aria-pressed', 'false');
      const presale = this.querySelector('[name="dec-presale-box-eth"]');
      if (presale) presale.value = '0';
      this.#closeBuilderPopovers({ restoreFocus: false });
      this.#updateTotalLabel();
    });
    for (const [bind, name] of [
      ['dec-box-add-small', 'dec-box-small'],
      ['dec-box-add-medium', 'dec-box-medium'],
      ['dec-box-add-large', 'dec-box-large'],
    ]) {
      const control = this.querySelector(`[data-bind="${bind}"]`);
      control?.addEventListener?.('click', () => this.#stepBoxInput(name, 1));
      control?.addEventListener?.('contextmenu', (event) => {
        event?.preventDefault?.();
        if (!control.disabled) this.#stepBoxInput(name, -1);
      });
    }
    const customToggle = this.querySelector('[data-bind="dec-custom-box-toggle"]');
    customToggle?.addEventListener?.('click', () => {
      this.#customBoxOpen = !this.#customBoxOpen;
      if (this.#customBoxOpen) {
        const count = this.querySelector('[name="dec-box-custom-count"]');
        const current = Number(count?.value ?? 0);
        if (count && (!Number.isInteger(current) || current <= 0) && !this.#presaleOptionAvailable) {
          count.value = '1';
        }
      }
      this.#renderBuilderPopovers();
      this.#updateTotalLabel();
      if (this.#customBoxOpen) {
        const customCount = Number(this.querySelector('[name="dec-box-custom-count"]')?.value ?? 0);
        const amount = customCount > 0
          ? this.querySelector('[name="dec-box-custom-eth"]')
          : this.querySelector('[name="dec-presale-box-eth"]');
        try {
          amount?.focus?.({ preventScroll: true });
          amount?.select?.();
        } catch (_e) { /* focus and selection are progressive enhancement */ }
      }
    });
    for (const close of Array.from(
      this.querySelectorAll?.('[data-bind="dec-custom-box-close"]') || [],
    )) {
      close.addEventListener?.('click', () => this.#closeCustomBoxPopover({ reset: true }));
    }
    this.querySelector('[data-bind="dec-custom-box-fields"]')?.addEventListener?.(
      'keydown', (event) => {
        if (event?.key === 'Escape') this.#closeCustomBoxPopover({ reset: true });
      },
    );
    this.querySelector('[data-bind="dec-custom-box-buy"]')?.addEventListener?.(
      'click', (event) => {
        // This is the chooser's commit, not a hand-off to the main rail: it
        // closes WITHOUT resetting (the draft is what the tx spends) and always
        // sends. #onBuyClick owns the in-flight guard and every empty/invalid
        // order path, so the main CTA being momentarily disabled is not a
        // reason to swallow the click and leave the player with nothing.
        this.#closeCustomBoxPopover({ restoreFocus: false });
        void this.#onBuyClick(event);
      },
    );
    // Live total-cost label on the Buy button as quantities change.
    for (const name of [
      'dec-tickets',
      'dec-box-small',
      'dec-box-medium',
      'dec-box-large',
      'dec-box-custom-count',
      'dec-box-custom-eth',
      'dec-presale-box-eth',
    ]) {
      const inp = this.querySelector(`[name="${name}"]`);
      if (inp && typeof inp.addEventListener === 'function') {
        inp.addEventListener('input', () => {
          if (name === 'dec-presale-box-eth' && Number(inp.value || 0) > 0) {
            // The deployed combined selector has no foil flag. Selecting a
            // presale box therefore exits the optional foil leg explicitly.
            const foil = this.querySelector('[data-bind="dec-foil-check"]');
            if (foil) foil.checked = false;
            const foilRow = this.querySelector('[data-bind="dec-foil-row"]');
            foilRow?.classList?.remove('is-selected');
            foilRow?.setAttribute?.('aria-pressed', 'false');
          }
          this.#updateTotalLabel();
        });
      }
    }
    // Foil checkbox adds its leg to the total.
    const foilCheck = this.querySelector('[data-bind="dec-foil-check"]');
    if (foilCheck && typeof foilCheck.addEventListener === 'function') {
      foilCheck.addEventListener('change', () => {
        if (foilCheck.checked) {
          const presale = this.querySelector('[name="dec-presale-box-eth"]');
          if (presale) presale.value = '0';
        }
        const foilRow = this.querySelector('[data-bind="dec-foil-row"]');
        foilRow?.classList?.toggle('is-selected', Boolean(foilCheck.checked));
        foilRow?.setAttribute?.('aria-pressed', String(Boolean(foilCheck.checked)));
        this.#renderBuilderPopovers();
        this.#updateTotalLabel();
        if (foilCheck.checked) {
          this.#animatePurchaseAddition(foilRow, {
            targetSelector: '[data-bind="dec-buy-cta"]',
            label: '+FOIL',
            tone: 'foil',
          });
        }
      });
    }
    const presaleMax = this.querySelector('[data-bind="dec-presale-max"]');
    if (presaleMax && typeof presaleMax.addEventListener === 'function') {
      presaleMax.addEventListener('click', () => {
        const input = this.querySelector('[name="dec-presale-box-eth"]');
        if (!input) return;
        const available = this.#presaleAvailableForDraft();
        if (available < PRESALE_BOX_MIN_WEI) return;
        input.value = formatPurchaseEth(available);
        const foil = this.querySelector('[data-bind="dec-foil-check"]');
        if (foil) foil.checked = false;
        const foilRow = this.querySelector('[data-bind="dec-foil-row"]');
        foilRow?.classList?.remove('is-selected');
        foilRow?.setAttribute?.('aria-pressed', 'false');
        this.#updateTotalLabel();
      });
    }
    // The dedicated left button exposes the quarter-ticket entry size; the
    // familiar right-side arrows move whole tickets. Lootbox arrows retain
    // their dynamic one-ticket-price step.
    // (querySelectorAll is guarded for fakeDOM.)
    const quarterSteps = typeof this.querySelectorAll === 'function'
      ? this.querySelectorAll('.dec-quarter-step') : [];
    for (const quarterStep of Array.from(quarterSteps)) {
      if (!quarterStep || typeof quarterStep.addEventListener !== 'function') continue;
      quarterStep.addEventListener('click', () => {
        const input = this.querySelector('[name="dec-tickets"]');
        const dir = Number(quarterStep.getAttribute?.('data-dir')) || 0;
        if (!input || !dir) return;
        this.#stepInput(input, dir, 0.25);
        this.#updateTotalLabel();
      });
    }
    const steppers = typeof this.querySelectorAll === 'function'
      ? this.querySelectorAll('.dec-step') : [];
    for (const btn of Array.from(steppers)) {
      if (!btn || typeof btn.addEventListener !== 'function') continue;
      btn.addEventListener('click', () => {
        const name = btn.getAttribute && btn.getAttribute('data-step-for');
        const dir = Number(btn.getAttribute && btn.getAttribute('data-dir')) || 0;
        const input = name ? this.querySelector(`[name="${name}"]`) : null;
        if (!input || !dir) return;
        this.#stepInput(input, dir, name === 'dec-tickets' ? 1 : null);
        this.#updateTotalLabel();
      });
    }
    const boxSteps = typeof this.querySelectorAll === 'function'
      ? this.querySelectorAll('.dec-box-step') : [];
    for (const btn of Array.from(boxSteps)) {
      if (!btn || typeof btn.addEventListener !== 'function') continue;
      btn.addEventListener('click', () => {
        const name = btn.getAttribute?.('data-step-for');
        const dir = Number(btn.getAttribute?.('data-dir')) || 0;
        if (name && dir) this.#stepBoxInput(name, dir);
      });
    }
  }

  #buyInDialogFoilAvailable() {
    if (this.#flipModeEnabled()) return false;
    const row = this.querySelector('[data-bind="dec-foil-row"]');
    const check = this.querySelector('[data-bind="dec-foil-check"]');
    return Boolean(row && !row.hidden && check && !check.disabled);
  }

  #buyInDialogAmountModel(choice = this.#buyInDialogChoice) {
    if (choice === 'luckbox') {
      return {
        fixed: false,
        label: 'ETH PER BOX',
        unit: 'ETH',
        minimum: 'MIN 0.01',
        min: 0.01,
        step: 0.01,
        initial: '0.01',
      };
    }
    if (choice === 'foil') {
      return {
        fixed: true,
        label: 'FOIL PACK',
        unit: 'PACK',
        minimum: 'LIMIT 1',
        min: 1,
        step: 1,
        initial: '1',
      };
    }
    return {
      fixed: false,
      label: 'TICKETS',
      unit: 'TIX',
      minimum: 'MIN 0.25',
      min: 0.25,
      step: 0.25,
      initial: '1',
    };
  }

  #buyInTicketText(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '0';
    return Number.isInteger(amount)
      ? String(amount)
      : String(amount).replace(/0+$/, '').replace(/\.$/, '');
  }

  #buyInDialogQuote() {
    const fail = (message) => ({
      valid: false,
      choice: this.#buyInDialogChoice,
      costLabel: '—',
      actionLabel: 'SET BUY IN',
      message,
    });
    const choice = this.#buyInDialogChoice;
    if (choice === 'foil') {
      if (!this.#buyInDialogFoilAvailable()) return fail('Foil packs are not available right now.');
      const price = this.#ticketPriceWei();
      if (price == null || price <= 0n) return fail('Price is still loading.');
      const costWei = foilPackCostFromPriceWei(price);
      return {
        valid: true,
        choice,
        foil: true,
        costWei,
        costLabel: `${formatPurchaseEth(costWei)} ETH`,
        actionLabel: 'BUY FOIL PACK',
        message: '',
      };
    }

    const input = this.querySelector('[name="dec-buy-dialog-amount"]');
    const raw = Number(input?.value ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) return fail('Set an amount.');
    if (choice === 'luckbox') {
      let costWei = 0n;
      try { costWei = BigInt(Math.round(raw * 1e18)) / ETH_DIVISOR; }
      catch (_e) { costWei = 0n; }
      if (costWei < LOOTBOX_MIN_WEI) return fail('Custom boxes are at least 0.01 ETH each.');
      return {
        valid: true,
        choice,
        lootBoxAmountWei: costWei,
        costWei,
        costLabel: `${formatPurchaseEth(costWei)} ETH`,
        actionLabel: 'BUY CUSTOM BOX',
        message: '',
      };
    }

    const tickets = Math.round(raw * ENTRIES_PER_TICKET) / ENTRIES_PER_TICKET;
    if (tickets < 0.25) return fail('Minimum buy-in is 0.25 ticket.');
    const count = this.#buyInTicketText(tickets);
    if (this.#flipModeEnabled()) {
      const costWei = flipCostFromTickets(tickets);
      return {
        valid: true,
        choice: 'tickets',
        tickets,
        costWei,
        costLabel: `${formatFlip(costWei.toString())} FLIP`,
        actionLabel: `BURN FOR ${count} ${tickets === 1 ? 'TICKET' : 'TICKETS'}`,
        message: '',
      };
    }
    const price = this.#ticketPriceWei();
    if (price == null || price <= 0n) return fail('Price is still loading.');
    const costWei = ticketCostFromTickets(price, tickets);
    return {
      valid: true,
      choice: 'tickets',
      tickets,
      costWei,
      costLabel: `${formatPurchaseEth(costWei)} ETH`,
      actionLabel: `BUY ${count} ${tickets === 1 ? 'TICKET' : 'TICKETS'}`,
      message: '',
    };
  }

  #openBuyInDialog(returnFocus = null) {
    if (this.#busy || this.#buyInDialogOpen || get('ui.mode') !== 'self') return;
    const dialog = this.querySelector('[data-bind="dec-buy-dialog"]');
    if (!dialog) return;
    this.#buyInDialogChoice = 'tickets';
    this.#buyInDialogReturnFocus = returnFocus || null;
    const amount = this.querySelector('[name="dec-buy-dialog-amount"]');
    if (amount) amount.value = this.#buyInDialogAmountModel('tickets').initial;
    this.#clearError();
    this.#buyInDialogOpen = true;
    dialog.hidden = false;
    dialog.removeAttribute?.('hidden');
    returnFocus?.setAttribute?.('aria-expanded', 'true');
    lock();
    this.#renderBuyInDialog();
    try {
      this.querySelector('[data-bind="dec-buy-dialog-tickets"]')?.focus?.({ preventScroll: true });
    } catch (_e) { /* focus is progressive enhancement */ }
  }

  #closeBuyInDialog({ restoreFocus = true } = {}) {
    if (!this.#buyInDialogOpen) return;
    const dialog = this.querySelector('[data-bind="dec-buy-dialog"]');
    if (dialog) {
      dialog.hidden = true;
      dialog.setAttribute?.('hidden', '');
    }
    const returnFocus = this.#buyInDialogReturnFocus;
    returnFocus?.setAttribute?.('aria-expanded', 'false');
    this.#buyInDialogOpen = false;
    this.#buyInDialogReturnFocus = null;
    unlock();
    if (restoreFocus) {
      try { returnFocus?.focus?.({ preventScroll: true }); }
      catch (_e) { /* focus is progressive enhancement */ }
    }
  }

  #selectBuyInDialogChoice(choice) {
    if (!this.#buyInDialogOpen) return;
    if (choice === 'luckbox' && this.#flipModeEnabled()) return;
    if (choice === 'foil' && !this.#buyInDialogFoilAvailable()) return;
    if (!['tickets', 'luckbox', 'foil'].includes(choice)) return;
    this.#buyInDialogChoice = choice;
    const amount = this.querySelector('[name="dec-buy-dialog-amount"]');
    const model = this.#buyInDialogAmountModel(choice);
    if (amount) amount.value = model.initial;
    this.#renderBuyInDialog();
    try {
      (model.fixed
        ? this.querySelector('[data-bind="dec-buy-dialog-confirm"]')
        : amount)?.focus?.({ preventScroll: true });
    } catch (_e) { /* focus is progressive enhancement */ }
  }

  #renderBuyInDialog() {
    if (!this.#buyInDialogOpen) return;
    const flipMode = this.#flipModeEnabled();
    const foilAvailable = this.#buyInDialogFoilAvailable();
    if ((this.#buyInDialogChoice === 'luckbox' && flipMode)
      || (this.#buyInDialogChoice === 'foil' && !foilAvailable)) {
      this.#buyInDialogChoice = 'tickets';
    }

    const choices = [
      ['tickets', this.querySelector('[data-bind="dec-buy-dialog-tickets"]'), true],
      ['luckbox', this.querySelector('[data-bind="dec-buy-dialog-luckbox"]'), !flipMode],
      ['foil', this.querySelector('[data-bind="dec-buy-dialog-foil"]'), foilAvailable],
    ];
    for (const [choice, button, visible] of choices) {
      if (!button) continue;
      const selected = this.#buyInDialogChoice === choice;
      button.hidden = !visible;
      if (visible) button.removeAttribute?.('hidden');
      else button.setAttribute?.('hidden', '');
      button.disabled = !visible;
      button.classList?.toggle('is-selected', selected);
      button.setAttribute?.('aria-pressed', String(selected));
    }

    const model = this.#buyInDialogAmountModel();
    const amountRow = this.querySelector('[data-bind="dec-buy-dialog-amount-row"]');
    const amount = this.querySelector('[name="dec-buy-dialog-amount"]');
    const label = this.querySelector('[data-bind="dec-buy-dialog-amount-label"]');
    const minimum = this.querySelector('[data-bind="dec-buy-dialog-minimum"]');
    const unit = this.querySelector('[data-bind="dec-buy-dialog-unit"]');
    if (amountRow) amountRow.hidden = model.fixed;
    if (amount) {
      amount.min = String(model.min);
      amount.step = String(model.step);
      amount.setAttribute?.('min', amount.min);
      amount.setAttribute?.('step', amount.step);
    }
    if (label) label.textContent = model.label;
    if (minimum) minimum.textContent = model.minimum;
    if (unit) unit.textContent = model.unit;

    const quote = this.#buyInDialogQuote();
    const quoteEl = this.querySelector('[data-bind="dec-buy-dialog-quote"]');
    const feedback = this.querySelector('[data-bind="dec-buy-dialog-feedback"]');
    const confirm = this.querySelector('[data-bind="dec-buy-dialog-confirm"]');
    if (quoteEl) quoteEl.textContent = quote.costLabel;
    if (feedback) feedback.textContent = quote.message;
    if (confirm) {
      confirm.textContent = quote.actionLabel;
      confirm.disabled = !quote.valid || this.#busy || get('ui.mode') !== 'self';
      confirm.classList?.toggle('is-incomplete', !quote.valid);
    }
  }

  async #submitBuyInDialog(event) {
    try { event?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (!this.#buyInDialogOpen || this.#busy || get('ui.mode') !== 'self') return false;
    const quote = this.#buyInDialogQuote();
    if (!quote.valid) {
      this.#renderBuyInDialog();
      return false;
    }

    const tickets = this.querySelector('[name="dec-tickets"]');
    const presale = this.querySelector('[name="dec-presale-box-eth"]');
    const foil = this.querySelector('[data-bind="dec-foil-check"]');
    if (tickets) tickets.value = quote.choice === 'tickets' ? String(quote.tickets) : '0';
    if (quote.choice === 'luckbox') this.#setCustomBoxDraft(quote.lootBoxAmountWei);
    else this.#clearBoxDraft();
    if (presale) presale.value = '0';
    if (foil) foil.checked = quote.choice === 'foil';

    this.#closeBuyInDialog({ restoreFocus: false });
    this.#updateTotalLabel();
    return this.#flipModeEnabled()
      ? this.#onBuyWithFlipClick(event)
      : this.#onBuyClick(event);
  }

  #openAfkingPasses() {
    if (typeof document === 'undefined') return;
    const passes = document.querySelector('#afking-passes')
      || document.querySelector('.more-ways');
    if (!passes) return;
    passes.open = true;
    if (typeof passes.setAttribute === 'function') passes.setAttribute('open', '');
    const panel = typeof passes.querySelector === 'function'
      ? passes.querySelector('app-pass-section')
      : null;
    const afking = panel && typeof panel.querySelector === 'function'
      ? panel.querySelector('[data-bind="pass-afking"]')
      : null;
    const target = afking && !afking.hidden ? afking : (panel || passes);
    const reveal = () => {
      if (typeof target?.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const focusTarget = afking && !afking.hidden
        ? afking.querySelector?.('[data-bind="pass-afking-save"]')
        : null;
      if (typeof focusTarget?.focus === 'function') focusTarget.focus({ preventScroll: true });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal);
    else reveal();
  }

  // A bare quest activation only configures the form. The quest confirmation
  // dialog adds submit:true after showing the exact action; that explicit
  // confirmation is allowed to continue through the panel's normal guarded
  // purchase/redeem handler.
  #wireQuestPresets() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#questActivateListener = (event) => {
      void (async () => {
        const detail = event?.detail;
        if (detail?.submit && [1, 4, 6, 9].includes(Number(detail?.questType))) {
          const submission = await this.#questSubmission(detail);
          if (!submission) {
            this.#renderError(Number(detail?.questType) === 4
              ? 'Foil packs are not available right now.'
              : Number(detail?.questType) === 9
                ? 'FLIP redemption is not available right now.'
                : 'That quest purchase is not available right now.');
            return;
          }
          if (submission.kind === 'flip') {
            await this.#onBuyWithFlipClick(undefined, { tickets: submission.ticketQuantity });
          } else {
            await this.#onBuyClick(undefined, submission);
          }
          return;
        }
        await this.#applyQuestPreset(detail);
      })();
    };
    document.addEventListener('quest:activate', this.#questActivateListener);
  }

  async #questSubmission(detail) {
    const questType = Number(detail?.questType);
    let target = 0n;
    try { target = BigInt(detail?.target ?? 0); } catch (_e) { target = 0n; }
    if (questType === 9) {
      await this.#refreshFlipBuyStatus();
      if (!this.#flipBuyOpen) return null;
      const ticketQuantity = Number(target > 0n ? target : 1n);
      return Number.isFinite(ticketQuantity) && ticketQuantity > 0
        ? { kind: 'flip', ticketQuantity }
        : null;
    }

    const price = this.#ticketPriceWei();
    if (questType === 1 && detail?.purchaseKind !== 'lootbox') {
      let ticketQuantity = 1;
      const explicitTickets = detail?.source === 'records-bounty'
        ? Number(detail?.ticketQuantity)
        : null;
      if (Number.isSafeInteger(explicitTickets) && explicitTickets > 0) {
        // The Biggest Degen is denominated in whole tickets, while ordinary
        // buy quests are denominated in ETH. Preserve the exact live record
        // target instead of reverse-quoting it through floating-point ETH.
        ticketQuantity = explicitTickets;
      } else if (price != null && price > 0n && target > 0n) {
        const entries = (target * BigInt(ENTRIES_PER_TICKET) + price - 1n) / price;
        ticketQuantity = Math.max(0.25, Number(entries) / ENTRIES_PER_TICKET);
      }
      return {
        kind: 'eth', ticketQuantity, lootBoxAmountWei: 0n,
        presaleBoxAmountWei: 0n, foilWanted: false,
        ...(detail?.source === 'records-bounty' ? {
          preferClaimable: true,
          useAfking: true,
        } : {}),
      };
    }
    if ((questType === 1 && detail?.purchaseKind === 'lootbox') || questType === 6) {
      let amount = target;
      if (amount <= 0n && price != null) amount = questType === 6 ? price * 2n : price;
      if (amount < LOOTBOX_MIN_WEI) amount = LOOTBOX_MIN_WEI;
      return {
        kind: 'eth', ticketQuantity: 0, lootBoxAmountWei: amount,
        presaleBoxAmountWei: 0n, foilWanted: false,
        ...(detail?.source === 'records-bounty' ? {
          preferClaimable: true,
          useAfking: true,
        } : {}),
      };
    }
    if (questType === 4) {
      await this.#refreshFoilStatus();
      // The quest purchase is isolated from the ordinary form. A checked USE
      // FLIP draft may disable its foil checkbox visually, but it must not
      // make an otherwise-live foil quest unavailable.
      const available = Boolean(this.#foilStatus?.available);
      return available ? {
        kind: 'eth', ticketQuantity: 0, lootBoxAmountWei: 0n,
        presaleBoxAmountWei: 0n, foilWanted: true,
      } : null;
    }
    return null;
  }

  #emitFormEvent(input, type) {
    if (!input || typeof input.dispatchEvent !== 'function') return;
    try { input.dispatchEvent(new Event(type, { bubbles: true })); }
    catch (_e) { try { input.dispatchEvent({ type, bubbles: true }); } catch (_e2) {} }
  }

  #clearPurchaseTargetPulse(target) {
    if (!target?.classList) return;
    const priorTimer = this.#purchasePulseTimers.get(target);
    if (priorTimer != null) {
      try { clearTimeout(priorTimer); } catch (_e) { /* defensive */ }
      this.#purchasePulseTimers.delete(target);
    }
    target.classList.remove('is-receiving');
  }

  #pulsePurchaseTarget(target, durationMs = 460) {
    if (!target?.classList) return;
    this.#clearPurchaseTargetPulse(target);
    void target.offsetWidth;
    target.classList.add('is-receiving');
    const timer = setTimeout(() => {
      target.classList.remove('is-receiving');
      this.#purchasePulseTimers.delete(target);
    }, durationMs);
    this.#purchasePulseTimers.set(target, timer);
    timer?.unref?.();
  }

  #animatePurchaseAddition(source, {
    targetSelector = '.dec-ticket-total__field',
    label = '',
    tone = 'ticket',
  } = {}) {
    const target = this.querySelector(targetSelector);
    const panel = this.querySelector('.app-decimator-panel');
    const artwork = source?.querySelector?.('.dec-ticket-piece__art');
    if (!target || !panel || !artwork) return;
    if (typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    if (typeof artwork.cloneNode !== 'function'
      || typeof artwork.getBoundingClientRect !== 'function'
      || typeof target.getBoundingClientRect !== 'function'
      || typeof panel.getBoundingClientRect !== 'function') return;

    const sourceRect = artwork.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (!(sourceRect.width > 0 && sourceRect.height > 0 && targetRect.width > 0)) return;

    const scale = Math.min(1, 54 / Math.max(sourceRect.width, sourceRect.height));
    const width = sourceRect.width * scale;
    const height = sourceRect.height * scale;
    const startX = sourceRect.left - panelRect.left + (sourceRect.width - width) / 2;
    const startY = sourceRect.top - panelRect.top + (sourceRect.height - height) / 2;
    const endX = targetRect.left - panelRect.left + (targetRect.width - width) / 2;
    const endY = targetRect.top - panelRect.top + (targetRect.height - height) / 2;
    const dx = endX - startX;
    const dy = endY - startY;
    const arc = Math.min(42, Math.max(18, Math.abs(dy) * 0.18));

    const flyer = artwork.cloneNode(true);
    flyer.classList?.add('dec-purchase-flyer', `dec-purchase-flyer--${tone}`);
    flyer.setAttribute?.('aria-hidden', 'true');
    flyer.removeAttribute?.('data-bind');
    for (const bound of Array.from(flyer.querySelectorAll?.('[data-bind]') || [])) {
      bound.removeAttribute?.('data-bind');
    }
    const quantity = document.createElement?.('strong');
    if (quantity) {
      quantity.className = 'dec-purchase-flyer__quantity';
      quantity.textContent = label;
      flyer.appendChild?.(quantity);
    }
    flyer.style.left = `${startX}px`;
    flyer.style.top = `${startY}px`;
    flyer.style.width = `${width}px`;
    flyer.style.height = `${height}px`;
    flyer.style.setProperty?.('--dec-flight-x', `${dx}px`);
    flyer.style.setProperty?.('--dec-flight-y', `${dy}px`);
    flyer.style.setProperty?.('--dec-flight-mid-x', `${dx * 0.56}px`);
    flyer.style.setProperty?.('--dec-flight-mid-y', `${dy * 0.46 - arc}px`);
    panel.appendChild?.(flyer);

    let finished = false;
    let fallbackTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (fallbackTimer != null) clearTimeout(fallbackTimer);
      flyer.remove?.();
      this.#pulsePurchaseTarget(target);
    };
    const onAnimationEnd = (event) => {
      // Animated foil details can emit their own bubbling animation events;
      // only the wrapper's flight marks the handoff complete.
      if (event?.target && event.target !== flyer) return;
      flyer.removeEventListener?.('animationend', onAnimationEnd);
      finish();
    };
    flyer.addEventListener?.('animationend', onAnimationEnd);
    fallbackTimer = setTimeout(finish, 900);
    fallbackTimer?.unref?.();
  }

  async #applyQuestPreset(detail) {
    const questType = Number(detail?.questType);
    if (![1, 4, 6, 9].includes(questType)) return false;

    const tickets = this.querySelector('[name="dec-tickets"]');
    const foil = this.querySelector('[data-bind="dec-foil-check"]');
    const flip = this.querySelector('[data-bind="dec-flip-check"]');
    const price = this.#ticketPriceWei();
    let target = 0n;
    try { target = BigInt(detail?.target ?? 0); } catch (_e) { target = 0n; }
    let focus = tickets;
    let ready = true;

    if (questType === 1) {
      if (detail?.purchaseKind === 'lootbox') {
        // The primary daily can be fulfilled by either product. Preserve the
        // dialog's explicit choice and spend exactly the remaining ETH target,
        // subject to the contract's ordinary lootbox floor.
        let amount = target;
        if (amount <= 0n && price != null) amount = price;
        if (amount < LOOTBOX_MIN_WEI) amount = LOOTBOX_MIN_WEI;
        if (tickets) tickets.value = '0';
        focus = this.#setCustomBoxDraft(amount);
      } else {
        // Ticket choice: express the raw spend target as quarter-ticket entries.
        let wanted = 1;
        if (price != null && price > 0n && target > 0n) {
          const entries = (target * BigInt(ENTRIES_PER_TICKET) + price - 1n) / price;
          wanted = Math.max(0.25, Number(entries) / ENTRIES_PER_TICKET);
        }
        if (tickets) tickets.value = String(wanted);
        this.#clearBoxDraft();
      }
      if (foil) foil.checked = false;
      if (flip) flip.checked = false;
      this.#renderPurchaseMode();
    } else if (questType === 6) {
      // Lootbox quests are spend targets. Daily targets are two ticket prices;
      // level quests carry their larger DB-projected target in the same field.
      let amount = target;
      if (amount <= 0n && price != null) amount = price * 2n;
      if (amount < LOOTBOX_MIN_WEI) amount = LOOTBOX_MIN_WEI;
      if (tickets) tickets.value = '0';
      focus = this.#setCustomBoxDraft(amount);
      if (foil) foil.checked = false;
      if (flip) flip.checked = false;
      this.#renderPurchaseMode();
    } else if (questType === 4) {
      if (tickets) tickets.value = '0';
      this.#clearBoxDraft();
      if (flip) flip.checked = false;
      this.#renderPurchaseMode();
      await this.#refreshFoilStatus();
      if (foil) foil.checked = Boolean(this.#foilStatus?.available && !foil.disabled);
      ready = Boolean(foil?.checked);
      focus = foil;
    } else if (questType === 9) {
      await this.#refreshFlipBuyStatus();
      const current = Number(tickets?.value ?? 0);
      // A bare quest click preserves an existing non-zero draft. The quest
      // action sheet, however, carries an explicit player-selected quantity and
      // must configure exactly what its confirm button promised.
      if (tickets && detail?.configuredAmount && target > 0n) {
        tickets.value = target.toString();
      } else if (tickets && (!Number.isFinite(current) || current <= 0)) {
        tickets.value = '1';
      }
      this.#clearBoxDraft();
      if (foil) foil.checked = false;
      if (flip) flip.checked = this.#flipBuyOpen;
      ready = Boolean(flip?.checked);
      this.#renderPurchaseMode();
    }

    this.#emitFormEvent(focus, focus === foil ? 'change' : 'input');
    this.#updateTotalLabel();
    try { this.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_e) {}
    try { focus?.focus?.({ preventScroll: true }); } catch (_e) {}
    return ready;
  }

  // Claimable changes as the jackpot settles, so showing it before the scratch
  // completes can spoil the result. last-day-jackpot owns the persisted key and
  // sends the same-tab event after the final cover is removed.
  #wireClaimableSpoilerGate() {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.#jackpotRevealListener = () => this.#renderFundsFooter();
      document.addEventListener('jackpot:revealed', this.#jackpotRevealListener);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const prefix = `spun_day_${CHAIN.id}_`;
      this.#storageListener = (event) => {
        if (typeof event?.key === 'string' && event.key.startsWith(prefix)) {
          this.#renderFundsFooter();
        }
      };
      window.addEventListener('storage', this.#storageListener);
    }
  }

  // Give the high-score ALL IN action one tiny final-landing wink without
  // changing its accessible name or click behavior. app-daily-flip announces
  // the last quarter-second of the normal landing separately from
  // flip:revealed so Reverse cards never move the cue to the extended ending.
  #wireAllInCoinflipCue() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#coinflipFinishingListener = (event) => {
      const button = this.querySelector('[data-bind="dec-all-in"]');
      const label = button?.querySelector?.('.dec-all-in__label')
        || this.querySelector('.dec-all-in__label');
      if (!button || !label || button.hidden || button.disabled) return;
      if (this.#allInCueTimer != null) {
        try { clearTimeout(this.#allInCueTimer); } catch (_) { /* defensive */ }
        this.#allInCueTimer = null;
      }
      const requested = Number(event?.detail?.durationMs);
      const durationMs = Number.isFinite(requested)
        ? Math.max(180, Math.min(900, requested))
        : 250;
      label.textContent = 'DO IT';
      button.classList?.remove('dec-all-in--do-it');
      // Force a fresh pulse if a replay cue arrives before the old class has
      // painted; this is visual only and is safe in the lightweight test DOM.
      void button.offsetWidth;
      button.classList?.add('dec-all-in--do-it');
      this.#allInCueTimer = setTimeout(() => this.#restoreAllInLabel(), durationMs);
      this.#allInCueTimer?.unref?.();
    };
    this.#coinflipRevealedListener = () => this.#restoreAllInLabel();
    document.addEventListener('flip:finishing', this.#coinflipFinishingListener);
    document.addEventListener('flip:revealed', this.#coinflipRevealedListener);
  }

  #restoreAllInLabel() {
    if (this.#allInCueTimer != null) {
      try { clearTimeout(this.#allInCueTimer); } catch (_) { /* defensive */ }
      this.#allInCueTimer = null;
    }
    const button = this.querySelector('[data-bind="dec-all-in"]');
    const label = button?.querySelector?.('.dec-all-in__label')
      || this.querySelector('.dec-all-in__label');
    if (label) label.textContent = 'ALL IN';
    button?.classList?.remove('dec-all-in--do-it');
  }

  // Step a number input by an explicit button step, or by its native step when
  // no override is supplied. Clamp at min and round away floating-point dust.
  #stepInput(input, dir, stepOverride = null) {
    if (stepOverride == null) {
      try {
        if (dir > 0 && typeof input.stepUp === 'function') { input.stepUp(); return; }
        if (dir < 0 && typeof input.stepDown === 'function') { input.stepDown(); return; }
      } catch (_e) { /* invalid current value — fall through to manual step */ }
    }
    const step = stepOverride == null ? (Number(input.step) || 1) : Number(stepOverride);
    const min = input.min != null && input.min !== '' ? Number(input.min) : -Infinity;
    let next = (Number(input.value) || 0) + step * dir;
    if (next < min) next = min;
    input.value = String(Math.round(next * 1e6) / 1e6);
  }

  #boxCountValue(name) {
    const raw = this.querySelector(`[name="${name}"]`)?.value;
    if (raw == null || String(raw).trim() === '') return 0;
    return Number(raw);
  }

  #boxSelection() {
    return {
      small: this.#boxCountValue('dec-box-small'),
      medium: this.#boxCountValue('dec-box-medium'),
      large: this.#boxCountValue('dec-box-large'),
      customCount: this.#boxCountValue('dec-box-custom-count'),
      customSizeWei: this.#ethInputWei('dec-box-custom-eth'),
    };
  }

  #boxDraft(priceWei = this.#ticketPriceWei()) {
    const selection = this.#boxSelection();
    const counts = [selection.small, selection.medium, selection.large, selection.customCount];
    const hasInput = counts.some((count) => !Number.isFinite(count) || count !== 0);
    const totalBoxes = counts.reduce(
      (total, count) => total + (Number.isInteger(count) && count > 0 ? count : 0),
      0,
    );
    try {
      const order = packBoxOrder(selection);
      const presetCount = selection.small + selection.medium + selection.large;
      const quotedPrice = priceWei == null ? 0n : BigInt(priceWei);
      const pricePending = order > 0n && presetCount > 0 && quotedPrice <= 0n;
      return {
        selection,
        hasInput,
        totalBoxes,
        order,
        costWei: boxOrderCostFromPriceWei(quotedPrice, order),
        pricePending,
        error: null,
      };
    } catch (error) {
      return {
        selection,
        hasInput,
        totalBoxes,
        order: 0n,
        costWei: 0n,
        pricePending: false,
        error: compactUiError(error, 'Check the box quantities and custom size.'),
      };
    }
  }

  #stepBoxInput(name, dir) {
    const input = this.querySelector(`[name="${name}"]`);
    if (!input || input.disabled) return;
    const names = [
      'dec-box-small',
      'dec-box-medium',
      'dec-box-large',
      'dec-box-custom-count',
    ];
    let current = Number(input.value ?? 0);
    if (!Number.isInteger(current) || current < 0) current = 0;
    const others = names
      .filter((candidate) => candidate !== name)
      .reduce((total, candidate) => {
        const count = this.#boxCountValue(candidate);
        return total + (Number.isInteger(count) && count > 0 ? count : 0);
      }, 0);
    const ceiling = Math.max(0, BOX_ORDER_MAX_BOXES - others);
    input.value = String(Math.min(ceiling, Math.max(0, current + Math.sign(dir))));
    if (name === 'dec-box-custom-count' && Number(input.value) > 0) {
      this.#customBoxOpen = true;
    }
    this.#updateTotalLabel();
  }

  #setCustomBoxDraft(amountWei = 0n) {
    for (const name of ['dec-box-small', 'dec-box-medium', 'dec-box-large']) {
      const input = this.querySelector(`[name="${name}"]`);
      if (input) input.value = '0';
    }
    const count = this.querySelector('[name="dec-box-custom-count"]');
    const size = this.querySelector('[name="dec-box-custom-eth"]');
    const amount = BigInt(amountWei ?? 0n);
    if (count) count.value = amount > 0n ? '1' : '0';
    if (size && amount > 0n) size.value = formatPurchaseEth(amount);
    this.#customBoxOpen = amount > 0n;
    return size;
  }

  #clearBoxDraft() {
    for (const name of [
      'dec-box-small',
      'dec-box-medium',
      'dec-box-large',
      'dec-box-custom-count',
    ]) {
      const input = this.querySelector(`[name="${name}"]`);
      if (input) input.value = '0';
    }
    const customSize = this.querySelector('[name="dec-box-custom-eth"]');
    if (customSize) customSize.value = '0.01';
    this.#customBoxOpen = false;
  }

  #renderBoxOptionsButton(selection = this.#boxSelection()) {
    const toggle = this.querySelector('[data-bind="dec-custom-box-toggle"]');
    const title = this.querySelector('[data-bind="dec-box-options-title"]');
    const detail = this.querySelector('[data-bind="dec-custom-box-selection"]');
    if (!toggle || !title || !detail) return;

    const customSelected = Number.isInteger(selection.customCount) && selection.customCount > 0;
    const presaleAmount = this.#presaleWantedWei();
    const presaleSelected = presaleAmount > 0n;
    const parts = [];
    if (customSelected) {
      parts.push(
        `${selection.customCount} CUSTOM · ${formatPurchaseEth(selection.customSizeWei)} ETH EACH`,
      );
    }
    if (presaleSelected) parts.push(`PRESALE · ${formatPurchaseEth(presaleAmount)} ETH`);
    if (parts.length === 0 && this.#presaleOptionAvailable) parts.push('PRESALE AVAILABLE');

    title.textContent = this.#presaleOptionAvailable
      ? 'CUSTOM / PRESALE BOXES'
      : 'CUSTOM LUCKBOXES';
    detail.textContent = parts.join(' · ');
    detail.hidden = parts.length === 0;
    if (detail.hidden) detail.setAttribute?.('hidden', '');
    else detail.removeAttribute?.('hidden');

    toggle.classList?.toggle('is-selected', customSelected || presaleSelected);
    toggle.classList?.toggle('has-presale', this.#presaleOptionAvailable);
    const ariaParts = [];
    if (customSelected) {
      ariaParts.push(
        `${selection.customCount} custom ${selection.customCount === 1 ? 'Luckbox' : 'Luckboxes'} at ${formatPurchaseEth(selection.customSizeWei)} ETH each`,
      );
    }
    if (presaleSelected) ariaParts.push(`presale box at ${formatPurchaseEth(presaleAmount)} ETH`);
    toggle.setAttribute?.(
      'aria-label',
      ariaParts.length > 0
        ? `Edit ${ariaParts.join(' and ')}`
        : this.#presaleOptionAvailable
          ? 'Configure custom Luckboxes or an available presale box'
          : 'Configure custom Luckboxes',
    );
  }

  // The case tier is decided by ETH-per-box against the live ticket price
  // (lootbox-value-tone.js:145), so it moves as the player types. Mirror the
  // Buy In card renders rather than the reveal art: this is the same three
  // physical cases the preset cards above already show.
  #renderCustomBoxPreview(selection = this.#boxSelection()) {
    const host = this.querySelector('[data-bind="dec-custom-box-preview"]');
    if (!host) return;
    const priceWei = this.#ticketPriceWei();
    const price = priceWei == null ? 0n : BigInt(priceWei);
    const size = BigInt(selection?.customSizeWei ?? 0n);
    const count = Number(selection?.customCount ?? 0);
    // Naming a tier needs a live price. Without one the model resolver falls
    // back to MEDIUM, which would show the player a case they may not get.
    const known = price > 0n && size > 0n && Number.isInteger(count) && count > 0;
    host.hidden = !known;
    if (known) host.removeAttribute?.('hidden');
    else {
      host.setAttribute?.('hidden', '');
      return;
    }
    const model = lootboxCaseModel(size, price);
    const art = this.querySelector('[data-bind="dec-custom-box-preview-art"]');
    if (art) {
      const src = model === 'large' ? BUY_IN_GOLD_CASE_ART : BUY_IN_COMPACT_CASE_ART[model];
      if (src && art.getAttribute?.('src') !== src) art.setAttribute?.('src', src);
      art.parentElement?.setAttribute?.('data-lootbox-case-model', model);
    }
    host.setAttribute?.('aria-label', 'Custom Luckbox preview');
  }

  #renderBoxDraft(draft = this.#boxDraft()) {
    const { selection, totalBoxes, costWei, pricePending, error } = draft;
    const group = this.querySelector('[data-bind="dec-lootbox-group"]');
    group?.classList?.toggle('has-selection', totalBoxes > 0);
    group?.classList?.toggle('has-error', Boolean(error));

    for (const [tier, count] of [
      ['small', selection.small],
      ['medium', selection.medium],
      ['large', selection.large],
    ]) {
      this.querySelector(`.dec-box-card--${tier}`)?.classList?.toggle(
        'is-selected',
        Number.isInteger(count) && count > 0,
      );
    }

    const customToggle = this.querySelector('[data-bind="dec-custom-box-toggle"]');
    customToggle?.setAttribute?.('aria-expanded', String(this.#customBoxOpen));
    this.#renderBoxOptionsButton(selection);
    const customFields = this.querySelector('[data-bind="dec-custom-box-fields"]');
    if (customFields) {
      customFields.hidden = !this.#customBoxOpen;
      if (this.#customBoxOpen) customFields.removeAttribute?.('hidden');
      else customFields.setAttribute?.('hidden', '');
    }
    this.#renderCustomBoxPreview(selection);

    for (const name of [
      'dec-box-small',
      'dec-box-medium',
      'dec-box-large',
      'dec-box-custom-count',
      'dec-box-custom-eth',
    ]) {
      const input = this.querySelector(`[name="${name}"]`);
      if (!input) continue;
      if (error) input.setAttribute?.('aria-invalid', 'true');
      else input.removeAttribute?.('aria-invalid');
    }

    const summary = this.querySelector('[data-bind="dec-box-summary"]');
    if (!summary) return;
    summary.classList?.toggle('is-error', Boolean(error));
    if (error) {
      summary.textContent = error;
    } else if (totalBoxes === 0) {
      summary.textContent = 'Choose any mix of boxes.';
    } else if (pricePending) {
      summary.textContent = `${totalBoxes} ${totalBoxes === 1 ? 'box' : 'boxes'} selected · price loading`;
    } else {
      let cost = '';
      try { cost = formatPurchaseEth(costWei); } catch (_e) { cost = ''; }
      summary.textContent = `${totalBoxes} ${totalBoxes === 1 ? 'box' : 'boxes'} · ${cost || '—'} ETH`;
    }
  }

  // Total purchase cost = tickets + lootbox + optional foil. The action and its
  // amount use separate lines so long quotes do not squeeze the button.
  // Skipped while #busy (the click handler owns its pending label then).
  // The ticket field, in TICKETS, snapped to the entry the chain will actually
  // buy (0.25 of a ticket). Returns 0 for blank/negative/garbage.
  #ticketsWanted() {
    const raw = this.querySelector('[name="dec-tickets"]')?.value ?? '0';
    const t = parseFloat(raw);
    if (!Number.isFinite(t) || t <= 0) return 0;
    return Math.round(t * ENTRIES_PER_TICKET) / ENTRIES_PER_TICKET;
  }

  #hasBuySelection() {
    if (this.#ticketsWanted() > 0) return true;
    if (this.#flipModeEnabled()) return false;
    return this.#boxDraft().hasInput
      || this.#presaleWantedWei() > 0n
      || this.#foilWanted();
  }

  #ethInputWei(name) {
    const raw = this.querySelector(`[name="${name}"]`)?.value ?? '0';
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return 0n;
    try { return BigInt(Math.round(amount * 1e18)) / ETH_DIVISOR; }
    catch (_e) { return 0n; }
  }

  #draftMintCostWei() {
    const price = this.#ticketPriceWei();
    let total = this.#boxDraft(price).costWei;
    const tickets = this.#ticketsWanted();
    if (price != null && tickets > 0) total += ticketCostFromTickets(price, tickets);
    return total;
  }

  #allInEthAvailableWei({ includeAfking = false } = {}) {
    const acting = getActingAddress();
    const connected = get('connected.address');
    const actingLower = acting ? String(acting).toLowerCase() : null;
    const connectedLower = connected ? String(connected).toLowerCase() : null;
    if (!actingLower || actingLower !== connectedLower || get('ui.mode') !== 'self') return null;
    if (this.#walletEthWei == null || this.#walletEthAddress !== connectedLower) return null;
    // The funds footer may remain masked to preserve the reveal, but ALL IN is
    // an explicit spending surface: use every balance value we already know.
    // Pending results can add funds later; they do not invalidate the current
    // wallet + indexed-claimable quote.
    if (!this.#claimableKnown || this.#claimableAddress !== actingLower) return null;
    let available = allInWalletAfterGasReserveWei(this.#walletEthWei)
      + (this.#claimableWei > 1n ? this.#claimableWei - 1n : 0n);
    if (includeAfking
      && this.#afkingFundingKnown
      && this.#afkingFundingAddress === actingLower) {
      available += this.#afkingFundingWei;
    }
    return available;
  }

  #allInFlipSourcesWei() {
    const acting = getActingAddress();
    const actingLower = acting ? String(acting).toLowerCase() : null;
    if (!actingLower || get('ui.mode') !== 'self'
      || this.#flipBalanceAddress !== actingLower
      || this.#flipBalanceWei == null) return null;
    try {
      const walletWei = BigInt(this.#flipBalanceWei);
      const coinflipClaimableWei = this.#coinflipClaimableKnown
        && this.#coinflipClaimableAddress === actingLower
        ? BigInt(this.#coinflipClaimableWei)
        : 0n;
      const spendableWei = protocolFlipTotalWei(walletWei, coinflipClaimableWei);
      if (spendableWei == null) return null;
      const rngLocked = Boolean(this.#purchaseQuote?.rngLocked);
      // Generic GAME burns can consume settled Coinflip winnings directly,
      // except while the RNG lock freezes that settlement path. Coinflip's own
      // deposit has a native claimable-first waterfall and needs no claim tx.
      const burnSpendableWei = protocolFlipTotalWei(
        walletWei,
        rngLocked ? 0n : coinflipClaimableWei,
      );
      return {
        walletWei,
        coinflipClaimableWei,
        spendableWei,
        burnSpendableWei,
        rngLocked,
        totalWei: spendableWei,
      };
    } catch (_e) { return null; }
  }

  /**
   * Indexed auto-rebuy carry for the viewed account, or 0n when it belongs to
   * another address. TOTALS only: no deposit or burn reaches the carry, so it
   * must never widen an action's spend cap.
   */
  #coinflipCarryWei() {
    const displayTarget = decimatorReadAddress();
    const actingLower = displayTarget ? String(displayTarget).toLowerCase() : null;
    if (!actingLower || this.#coinflipCarryAddress !== actingLower) return 0n;
    try { return BigInt(this.#coinflipCarryWeiIndexed); }
    catch (_e) { return 0n; }
  }

  async #refreshAllInFlipSources() {
    const acting = getActingAddress();
    const actingLower = acting ? String(acting).toLowerCase() : null;
    if (!actingLower) return;
    const snapshot = await readCoinflipDisplaySnapshot({ player: actingLower });
    if (snapshot?.balances?.flipBalance != null) {
      this.#flipBalanceWei = BigInt(snapshot.balances.flipBalance);
      this.#flipBalanceAddress = actingLower;
    }
    if (snapshot?.claimableWei != null) {
      this.#coinflipClaimableWei = BigInt(snapshot.claimableWei);
      this.#coinflipClaimableAddress = actingLower;
      this.#coinflipClaimableKnown = true;
    }
    if (snapshot?.backingWei != null) {
      this.#coinflipBackingWei = BigInt(snapshot.backingWei);
      this.#coinflipBackingAddress = actingLower;
      this.#coinflipBackingKnown = true;
    }
    this.#renderFundsFooter();
  }

  async #refreshAllInEthSources() {
    const acting = getActingAddress();
    const connected = get('connected.address');
    const actingLower = acting ? String(acting).toLowerCase() : null;
    const connectedLower = connected ? String(connected).toLowerCase() : null;
    if (!actingLower || actingLower !== connectedLower || get('ui.mode') !== 'self') return;
    const provider = permissionlessReadProvider(getProvider());
    const [walletResult, claimableResult, afkingResult] = await Promise.allSettled([
      typeof provider?.getBalance === 'function'
        ? readNativeBalance(connectedLower, { provider })
        : Promise.resolve(null),
      readClaimableEth({ player: actingLower }),
      readAfkingFunding(actingLower),
    ]);
    // Do not let an answer started for a prior wallet cross an account switch.
    if (String(getActingAddress() || '').toLowerCase() !== actingLower
      || String(get('connected.address') || '').toLowerCase() !== connectedLower
      || get('ui.mode') !== 'self') return;
    if (walletResult.status === 'fulfilled' && walletResult.value != null) {
      try {
        this.#walletEthWei = BigInt(walletResult.value);
        this.#walletEthAddress = connectedLower;
      } catch (_error) { /* preserve the last known wallet value */ }
    }
    if (claimableResult.status === 'fulfilled' && claimableResult.value != null) {
      try {
        this.#claimableWei = BigInt(claimableResult.value);
        this.#claimableAddress = actingLower;
        this.#claimableKnown = true;
      } catch (_error) { /* preserve the indexed fallback */ }
    }
    let afkingAdopted = false;
    if (afkingResult.status === 'fulfilled' && afkingResult.value != null) {
      try {
        this.#afkingFundingWei = BigInt(afkingResult.value);
        this.#afkingFundingAddress = actingLower;
        this.#afkingFundingKnown = true;
        afkingAdopted = true;
      } catch (_error) { /* optional source; Wallet + Claimable stay usable */ }
    }
    if (!afkingAdopted) {
      // Unknown optional funding must be excluded, not allowed to keep a stale
      // amount or invalidate the independently known Wallet + Claimable quote.
      this.#afkingFundingWei = 0n;
      this.#afkingFundingAddress = actingLower;
      this.#afkingFundingKnown = false;
    }
    this.#renderFundsFooter();
  }

  #allInGasReady() {
    const connected = get('connected.address');
    const connectedLower = connected ? String(connected).toLowerCase() : null;
    if (!connectedLower || this.#walletEthAddress !== connectedLower || this.#walletEthWei == null) {
      return false;
    }
    try { return BigInt(this.#walletEthWei) >= ALL_IN_GAS_RESERVE_WEI; }
    catch (_error) { return false; }
  }

  #allInQuote(selection) {
    const flipSources = String(selection?.currency).toUpperCase() === 'FLIP'
      ? this.#allInFlipSourcesWei()
      : null;
    const coinflipTarget = String(selection?.target) === 'coinflip';
    const quote = allInSelectionQuote({
      ...selection,
      purchaseEthWei: this.#allInEthAvailableWei({ includeAfking: true }),
      degeneretteEthWei: this.#allInEthAvailableWei(),
      flipWei: flipSources == null
        ? null
        : coinflipTarget ? flipSources.spendableWei : flipSources.burnSpendableWei,
      ticketPriceWei: this.#ticketPriceWei(),
      flipTicketsOpen: this.#flipBuyOpen,
      decimatorOpen: decimatorWindowIsOpen(this.#gameState),
      gasReady: this.#allInGasReady(),
    });
    if (coinflipTarget && flipSources?.rngLocked) {
      quote.valid = false;
      quote.message = 'Coinflip is locked while RNG is settling.';
      quote.buttonLabel = 'ALL IN UNAVAILABLE';
    }
    if (quote.valid && flipSources) {
      quote.flipSources = flipSources;
      quote.transactionWei = quote.spendWei;
      quote.fingerprint = [
        quote.fingerprint,
        flipSources.walletWei,
        flipSources.coinflipClaimableWei,
        flipSources.rngLocked,
      ].join(':');
    }
    return quote;
  }

  #openAllInDialog() {
    if (this.#busy || get('ui.mode') !== 'self') return;
    const detail = {
      destinations: {
        ETH: allInDestinations('ETH'),
        FLIP: allInDestinations(
          'FLIP',
          this.#flipBuyOpen,
          decimatorWindowIsOpen(this.#gameState),
        ),
      },
      quote: (selection) => this.#allInQuote(selection),
      // Balance visibility is a privacy preference, not an eligibility gate.
      // The dialog refreshes direct values behind the spoiler before deciding
      // whether either currency route is affordable.
      refreshCurrency: (currency) => String(currency).toUpperCase() === 'FLIP'
        ? this.#refreshAllInFlipSources()
        : this.#refreshAllInEthSources(),
      confirm: (selection, fingerprint) => this.#confirmAllIn(selection, fingerprint),
    };
    try {
      this.dispatchEvent(new CustomEvent('app-all-in:open', { detail, bubbles: true }));
    } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }
  }

  async #confirmAllIn(selection, fingerprint) {
    if (this.#busy) throw new Error('Another purchase is already in progress.');
    if (String(selection?.currency).toUpperCase() === 'FLIP') {
      await this.#refreshAllInFlipSources();
    } else {
      await this.#refreshAllInEthSources();
    }
    if (String(selection?.target) === 'decimator') {
      try {
        const freshState = await readGameState({ fresh: true });
        if (freshState && typeof freshState === 'object') this.#gameState = freshState;
      } catch (_error) { /* the contract preflight remains authoritative */ }
    }
    const quote = this.#allInQuote(selection);
    if (!quote.valid) throw new Error(quote.message || 'ALL IN is unavailable.');
    if (fingerprint && quote.fingerprint !== fingerprint) {
      throw new Error('Your available balance changed. Review the updated ALL IN amount.');
    }
    // Every FLIP destination consumes the protocol ledger in its own call:
    // Coinflip is claimable-first, while GAME burns draw any wallet shortfall
    // straight from settled Coinflip winnings. Never insert a claim tx here.
    if (quote.target === 'tickets') {
      if (quote.currency === 'FLIP') {
        return this.#onBuyWithFlipClick(undefined, {
          tickets: Number(quote.ticketAmount),
          allIn: true,
        });
      }
      return this.#onBuyClick(undefined, {
        ticketQuantity: Number(quote.ticketAmount),
        lootBoxAmountWei: 0n,
        presaleBoxAmountWei: 0n,
        foilWanted: false,
        preferClaimable: true,
        useAfking: true,
        allIn: true,
      });
    }
    if (quote.target === 'lootbox') {
      return this.#onBuyClick(undefined, {
        ticketQuantity: 0,
        lootBoxAmountWei: quote.spendWei,
        presaleBoxAmountWei: 0n,
        foilWanted: false,
        preferClaimable: true,
        useAfking: true,
        allIn: true,
      });
    }
    if (quote.target === 'decimator') {
      return this.#onAllInDecimatorBurn(quote.spendWei);
    }
    const questType = quote.target === 'coinflip'
      ? 2
      : quote.currency === 'ETH' ? 7 : 8;
    try {
      document.dispatchEvent(new CustomEvent('quest:activate', {
        detail: {
          questType,
          target: quote.target === 'coinflip' ? quote.transactionWei : quote.spendWei,
          amountPerSpin: quote.amountPerSpin,
          spinCount: quote.spins,
          submit: true,
          preferClaimable: quote.currency === 'ETH',
          allIn: true,
        },
      }));
    } catch (_e) {
      throw new Error('The selected ALL IN surface is not ready.');
    }
    return true;
  }

  async #onAllInDecimatorBurn(amountWei) {
    const player = getActingAddress();
    if (!player) throw new Error('Connect a wallet to enter the Decimator.');
    this.#busy = true;
    const allIn = this.querySelector('[data-bind="dec-all-in"]');
    if (allIn) allIn.disabled = true;
    this.#clearError();
    try {
      const { receipt } = await burnForDecimator({ player, amount: amountWei });
      try {
        this.dispatchEvent(new CustomEvent('app-decimator:burn-confirmed', {
          detail: {
            player,
            amountWei,
            transactionHash: receipt?.hash || receipt?.transactionHash || null,
          },
          bubbles: true,
        }));
      } catch (_error) { /* refresh event is progressive enhancement */ }
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
      return true;
    } catch (error) {
      const message = compactUiError(error, 'Decimator ALL IN did not go through. Try again.');
      this.#renderError(message);
      throw new Error(message, { cause: error });
    } finally {
      this.#busy = false;
      if (allIn) allIn.disabled = false;
      this.#renderFundsFooter();
    }
  }

  #presaleAvailableForDraft(mintCostWei = this.#draftMintCostWei()) {
    const buyer = getActingAddress();
    const buyerKey = buyer ? String(buyer).toLowerCase() : null;
    if (!buyerKey || this.#presaleAddress !== buyerKey) return 0n;
    return presaleBoxAvailableWei(this.#presaleState, mintCostWei);
  }

  #presaleWantedWei() {
    return this.#ethInputWei('dec-presale-box-eth');
  }

  #renderPresaleRow(mintCostWei = this.#draftMintCostWei()) {
    const row = this.querySelector('[data-bind="dec-presale-row"]');
    const toggle = this.querySelector('[data-bind="dec-custom-box-toggle"]');
    const input = this.querySelector('[name="dec-presale-box-eth"]');
    const availableEl = this.querySelector('[data-bind="dec-presale-available"]');
    const maxButton = this.querySelector('[data-bind="dec-presale-max"]');
    if (!row || !toggle || !input || !availableEl || !maxButton) return;

    const buyer = getActingAddress();
    const buyerKey = buyer ? String(buyer).toLowerCase() : null;
    const live = Boolean(
      buyerKey
      && this.#presaleAddress === buyerKey
      && this.#presaleState?.active
      && BigInt(this.#presaleState?.remainingWei ?? 0n) > 0n
      && get('ui.mode') !== 'combined'
    );
    const available = live ? this.#presaleAvailableForDraft(mintCostWei) : 0n;
    const foilSelected = this.#foilWanted();
    const flipMode = this.#flipModeEnabled();
    // The deployed combined selector has no foil flag. Once foil is selected,
    // remove the incompatible presale leg instead of leaving behind a disabled
    // control that looks like a broken option. Also keep the row out of sight
    // until the player has enough current or same-purchase credit to buy the
    // contract's minimum box.
    const visible = live && !foilSelected && !flipMode && available >= PRESALE_BOX_MIN_WEI;
    this.#presaleOptionAvailable = visible;
    if (!visible) {
      row.hidden = true;
      row.setAttribute?.('hidden', '');
      if (foilSelected || flipMode || (live && available < PRESALE_BOX_MIN_WEI)) input.value = '0';
      if (this.#presaleState && this.#presaleAddress === buyerKey && !this.#presaleState.active) {
        input.value = '0';
      }
      this.#renderBoxOptionsButton();
      return;
    }

    availableEl.textContent = `${formatPurchaseEth(available)} ETH AVAILABLE`;
    input.max = formatPurchaseEth(available);
    input.setAttribute?.('max', input.max);
    input.disabled = false;
    maxButton.disabled = available < PRESALE_BOX_MIN_WEI;
    const wanted = this.#presaleWantedWei();
    row.hidden = false;
    row.removeAttribute?.('hidden');
    row.classList?.toggle('dec-presale--selected', wanted > 0n);
    row.classList?.toggle('dec-presale--over-limit', wanted > available);
    this.#renderBoxOptionsButton();
  }

  #setPrimaryFundingSource(source) {
    if (!this.#fundingOrder.includes(source)) return;
    // USE FLIP is a separate ticket-redemption path. Choosing an ETH source
    // exits that mode, promotes the chosen row, and keeps the other two in
    // their current relative order.
    const flipCheck = this.querySelector('[data-bind="dec-flip-check"]');
    const leavingFlip = Boolean(flipCheck?.checked);
    if (flipCheck) flipCheck.checked = false;
    this.#fundingOrder = [
      source,
      ...this.#fundingOrder.filter((candidate) => candidate !== source),
    ];
    this.#preferClaimable = source === 'claimable';
    this.#useAfking = source !== 'wallet';
    _writeFundingPriority(source);
    _writeUseAfking(this.#useAfking);
    if (leavingFlip) this.#renderPurchaseMode();
    this.#renderFundsFooter();
    this.#updateTotalLabel();
  }

  #setBuyLabel(action, amount = '') {
    const btn = this.querySelector('[data-bind="dec-buy-cta"]');
    const actionEl = this.querySelector('[data-bind="dec-buy-cta-action"]');
    const amountEl = this.querySelector('[data-bind="dec-buy-cta-amount"]');
    if (!btn || !actionEl || !amountEl) return;
    const actionText = String(action || 'CLICK TO ADD');
    const amountText = String(amount || '');
    actionEl.textContent = actionText;
    amountEl.textContent = amountText;
    amountEl.hidden = !amountText;
    btn.setAttribute('aria-label', amountText ? `${actionText} ${amountText}` : actionText);
  }

  #setBoxOptionsBuyAmount(amount = '') {
    const btn = this.querySelector('[data-bind="dec-custom-box-buy"]');
    const actionEl = this.querySelector('[data-bind="dec-custom-box-buy-action"]');
    const amountEl = this.querySelector('[data-bind="dec-custom-box-buy-amount"]');
    if (!btn || !actionEl || !amountEl) return;
    const amountText = String(amount || '');
    actionEl.textContent = 'BUY IN';
    amountEl.textContent = amountText;
    amountEl.hidden = !amountText;
    if (amountEl.hidden) amountEl.setAttribute?.('hidden', '');
    else amountEl.removeAttribute?.('hidden');
    btn.setAttribute('aria-label', amountText ? `Buy in ${amountText}` : 'Buy in');
  }

  #updateTotalLabel() {
    this.#renderBountyTriggers();
    const btn = this.querySelector('[data-bind="dec-buy-cta"]');
    if (!btn || this.#busy) return;
    // Tickets are divisible to the entry (0.25), so parseFloat — parseInt threw
    // away the fraction and quoted the wrong number.
    const tq = this.#ticketsWanted();
    const priceWei = this.#ticketPriceWei();
    const boxDraft = this.#boxDraft(priceWei);
    this.#renderBoxDraft(boxDraft);
    if (this.#flipModeEnabled()) {
      // FLIP is tickets-only. Run the presale renderer before this branch's
      // early return so switching payment modes cannot leave the ETH-only row
      // painted from the previous quote.
      this.#renderPresaleRow(0n);
      // FLIP is burned, not paid as ETH. Give the full-width action rail an
      // explicit exchange quote so cost and output read as one action.
      let burn = '';
      if (tq > 0) {
        try {
          burn = `${formatFlip(flipCostFromTickets(tq).toString())} FLIP`;
        } catch (_e) { /* retain action without a quote */ }
      }
      const ticketCount = Number.isInteger(tq)
        ? String(tq)
        : String(tq).replace(/0+$/, '').replace(/\.$/, '');
      const output = tq > 0
        ? `for ${ticketCount} ${tq === 1 ? 'ticket' : 'tickets'}`
        : 'for tickets';
      this.#setBoxOptionsBuyAmount('');
      this.#setBuyLabel(burn ? `Burn ${burn}` : 'Burn FLIP', output);
      this.#renderFlipCredit(null);
      return;
    }
    let totalWei = 0n;
    let mintCostWei = boxDraft.costWei;
    let foilCostWei = 0n;
    if (priceWei != null && tq > 0) mintCostWei += ticketCostFromTickets(priceWei, tq);
    this.#renderPresaleRow(mintCostWei);
    const presaleCostWei = this.#presaleWantedWei();
    totalWei = mintCostWei;
    // Foil leg (additive): ten ticket prices at the same target level.
    if (this.#foilWanted() && priceWei != null) {
      foilCostWei = foilPackCostFromPriceWei(priceWei);
      totalWei += foilCostWei;
    }
    totalWei += presaleCostWei;
    let amount = '';
    if (totalWei > 0n) {
      try { amount = `${formatPurchaseEth(totalWei)} ETH`; } catch (_e) { amount = ''; }
    }
    const action = totalWei > 0n ? 'BUY IN' : 'CLICK TO ADD';
    this.#setBoxOptionsBuyAmount(amount);
    this.#setBuyLabel(action, amount);
    const recordBountyWei = purchaseRecordBountyWei({
      state: get('app.records'),
      tickets: tq,
      // The packed-order contract arms Biggest Luckbox only for a custom
      // tier, using the size of one custom box (never the whole order).
      luckboxWei: boxDraft.error || boxDraft.selection.customCount <= 0
        ? 0n
        : boxDraft.selection.customSizeWei,
      today: Number(get('app.daySync')?.day ?? get('app.lastDay')?.day) || null,
    });
    this.#renderFlipCredit({
      tickets: tq,
      // Boon previews use the whole box spend; the record preview above uses
      // one custom box because those two protocol rules intentionally differ.
      luckboxWei: boxDraft.costWei,
      priceWei,
      totalCostWei: totalWei,
      mintCostWei,
      foilCostWei,
      presaleCostWei,
      claimableWei: this.#claimableWei,
      afkingWei: this.#afkingFundingWei,
      preferClaimable: this.#preferClaimable,
      useAfking: this.#useAfking,
      bountyWei: recordBountyWei ?? 0n,
      targetLevel: this.#targetLevel(),
      activityScore: this.#degenScore,
      centuryUsedUnits: this.#centuryUsedUnits,
      centuryUsageKnown: this.#centuryUsageKnown,
    });
    if (this.#buyInDialogOpen) this.#renderBuyInDialog();
  }

  #renderBountyTriggers() {
    const state = get('app.records');
    const ethPurchase = !this.#flipModeEnabled();
    const tickets = this.#ticketsWanted();
    // The contract records `entryQuantityScaled / (4 * QTY_SCALE)`, so a
    // fractional entry tail cannot round a ticket candidate upward.
    const ticketCandidate = Number.isFinite(tickets) && tickets > 0
      ? BigInt(Math.floor(tickets))
      : 0n;
    const ticketClaims = ethPurchase && candidateClaimsRecord(
      state,
      RECORD_KIND_BUY,
      ticketCandidate,
    );
    const boxDraft = this.#boxDraft();
    const customCandidateWei = boxDraft.error || boxDraft.selection.customCount <= 0
      ? 0n
      : boxDraft.selection.customSizeWei;
    const luckboxClaims = ethPurchase && candidateClaimsRecord(
      state,
      RECORD_KIND_LUCKBOX,
      customCandidateWei,
    );

    const paint = (input, group, active, description) => {
      input?.classList?.toggle('is-bounty-trigger', active);
      group?.classList?.toggle('is-bounty-trigger', active);
      if (!input) return;
      if (active) {
        input.setAttribute('data-bounty-trigger', 'true');
        input.setAttribute('aria-description', description);
      } else {
        input.removeAttribute('data-bounty-trigger');
        input.removeAttribute('aria-description');
      }
    };
    paint(
      this.querySelector('[name="dec-tickets"]'),
      this.querySelector('.dec-input-group--tickets'),
      ticketClaims,
      'This manual ETH ticket buy reaches the live Biggest Degen bounty target.',
    );
    paint(
      this.querySelector('[name="dec-box-custom-eth"]'),
      this.querySelector('.dec-input-group--lootbox'),
      luckboxClaims,
      'This custom box reaches the live Biggest Luckbox bounty target.',
    );
  }

  #renderFlipCredit(args) {
    const box = this.querySelector('[data-bind="dec-flip-credit"]');
    if (!box) return;
    const parts = args ? purchaseFlipCreditBreakdown(args) : null;
    const boonPayload = get('app.boons');
    const boonEffects = [];
    const centuryEffects = [];
    const ticketBps = boonBoostBps(boonPayload, 'purchase');
    const ticketCount = Number(args?.tickets || 0);
    if (ticketBps > 0 && Number.isFinite(ticketCount) && ticketCount > 0) {
      const extraTickets = ticketCount * ticketBps / 10_000;
      const formatted = extraTickets.toLocaleString('en-US', { maximumFractionDigits: 3 });
      boonEffects.push(`+${formatted} ${extraTickets === 1 ? 'TICKET' : 'TICKETS'} BOON`);
    }
    const luckboxDelta = boonBoostDelta(args?.luckboxWei, boonPayload, 'lootbox');
    if (luckboxDelta > 0n) {
      boonEffects.push(`+${formatPurchaseEth(luckboxDelta)} ETH BOON`);
    }
    const activityKnown = args?.activityScore != null
      && Number.isFinite(Number(args.activityScore));
    const century = activityKnown ? purchaseCenturyBonus({
      targetLevel: args?.targetLevel,
      tickets: ticketCount,
      priceWei: args?.priceWei,
      activityScore: args.activityScore,
      ticketBoonBps: ticketBps,
      usedUnits: args?.centuryUsedUnits ?? 0n,
    }) : null;
    if (century?.bonusUnits > 0n) {
      const formatted = formatPurchaseTicketUnits(century.bonusUnits);
      const ticketWord = century.bonusUnits === PURCHASE_UNITS_PER_TICKET ? 'TICKET' : 'TICKETS';
      centuryEffects.push(`${args?.centuryUsageKnown === false ? '~' : ''}+${formatted} LVL ${century.level} ${ticketWord}`);
    }
    const detailEffects = [...centuryEffects, ...boonEffects];
    const boonEffect = this.querySelector('[data-bind="dec-purchase-boon-effect"]');
    if (boonEffect) {
      boonEffect.textContent = detailEffects.join(' · ');
      boonEffect.hidden = detailEffects.length === 0;
    }
    const bounty = parts?.bounty ?? 0n;
    const includesBounty = bounty > 0n;
    const label = this.querySelector('[data-bind="dec-flip-credit-label"]');
    box.classList?.toggle('dec-flip-credit--bounty', includesBounty);
    if (includesBounty) {
      box.setAttribute('data-includes-bounty', 'true');
      box.setAttribute(
        'title',
        `Includes +${formatFlip(bounty.toString())} FLIP from The Biggest Bounty.`,
      );
    } else {
      box.removeAttribute('data-includes-bounty');
      box.removeAttribute('title');
    }
    const active = Boolean(
      args
      && args.priceWei != null
      && args.totalCostWei > 0n
      && parts
      && (parts.total > 0n || detailEffects.length > 0)
    );
    box.hidden = false;
    box.removeAttribute?.('hidden');
    box.classList?.toggle('is-idle', !active);
    const total = this.querySelector('[data-bind="dec-flip-credit-total"]');
    if (!active) {
      this.#lastRenderedBonusFlip = 0n;
      this.#clearPurchaseTargetPulse(box);
      if (label) label.textContent = 'PLAY TO EARN';
      if (total) {
        total.textContent = 'BONUS FLIP';
        total.classList?.remove('is-zero');
      }
      box.classList?.remove('dec-flip-credit--bounty');
      box.removeAttribute('data-includes-bounty');
      box.removeAttribute('title');
      box.setAttribute('aria-label', 'Play to earn bonus FLIP with tickets.');
      return;
    }

    if (label) label.textContent = includesBounty ? 'BONUS + BOUNTY' : 'BONUS';
    if (!total) return;
    const previousBonusFlip = this.#lastRenderedBonusFlip;
    this.#lastRenderedBonusFlip = parts.total;
    total.textContent = `+${formatPurchaseBonusFlip(parts.total)} FLIP`;
    total.classList?.toggle('is-zero', parts.total === 0n);
    if (parts.total > previousBonusFlip) {
      this.#pulsePurchaseTarget(box, 660);
    } else if (parts.total < previousBonusFlip) {
      this.#clearPurchaseTargetPulse(box);
    }
    const summary = includesBounty
      ? `Bonus total ${formatFlip(parts.total.toString())} FLIP, including ${formatFlip(bounty.toString())} FLIP from The Biggest Bounty.`
      : `Bonus total ${formatFlip(parts.total.toString())} FLIP.`;
    const centurySummary = century?.bonusUnits > 0n
      ? ` Level ${century.level} bonus: +${formatPurchaseTicketUnits(century.bonusUnits)} tickets${args?.centuryUsageKnown === false ? ' estimated from current activity score' : ''}.`
      : '';
    box.setAttribute('aria-label', `${summary}${centurySummary}${boonEffects.length
      ? ` Purchase boon: ${boonEffects.join(', ')}.`
      : ''}`);
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED — NOT polling.js).
  // ---------------------------------------------------------------------

  #startPolling() {
    if (typeof this.#pollHandle === 'function') {
      try { this.#pollHandle(); } catch (_) { /* defensive */ }
    }
    this.#pollHandle = registerComponentPoll(() => this.#runPollCycle(), POLL_INTERVAL_MS);
  }

  async #runPollCycle() {
    // Visibility guard — pause polling while tab hidden.
    if (typeof document !== 'undefined'
      && document.visibilityState
      && document.visibilityState !== 'visible') {
      return;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
    }
    this.#pollController = new AbortController();
    const signal = this.#pollController.signal;
    this.#lastPollAt = Date.now();

    // Price and the viewed player's claimable quote are independent. The
    // shared purchase helper re-reads claimable from chain at click time; this
    // indexed value exists only to explain the expected wallet/claimable split.
    // Reads follow the viewed account even when no signer exists. This keeps
    // the disconnected sDGNRS protocol-wallet view useful while every write
    // handler continues to require getActingAddress().
    const displayTarget = decimatorReadAddress();
    const actingLower = displayTarget ? String(displayTarget).toLowerCase() : null;
    // Retire a prior wallet's answer synchronously. For the same wallet and
    // routed level, #refreshFoilStatus keeps the definitive result pinned.
    this.#renderFoilRow();
    if (this.#affiliateAddress !== actingLower) {
      // Account/mode changed: hide immediately and never carry one player's
      // input or assignment state into another player's purchase form.
      this.#affiliateAddress = actingLower;
      this.#affiliateAssigned = null;
      this.#affiliatePrefilledFor = null;
      const input = this.querySelector('[name="dec-affiliate-code"]');
      if (input) input.value = '';
      this.#renderAffiliateInput();
    }
    if (this.#afkingPassAddress !== actingLower) {
      this.#afkingPassAddress = actingLower;
      this.#hasAfkingPass = null;
      this.#afkingFundingWei = 0n;
      this.#afkingFundingAddress = actingLower;
      this.#afkingFundingKnown = false;
      this.#renderAfkingShortcut();
    }
    if (this.#presaleAddress !== actingLower) {
      this.#presaleAddress = actingLower;
      this.#presaleState = null;
      this.#renderPresaleRow();
    }
    if (this.#degenScoreAddress !== actingLower) {
      this.#degenScore = null;
      this.#degenScoreAddress = actingLower;
    }
    if (this.#flipBalanceAddress !== actingLower) {
      this.#flipBalanceWei = null;
      this.#flipBalanceAddress = actingLower;
      this.#coinflipClaimableWei = 0n;
      this.#coinflipClaimableAddress = actingLower;
      this.#coinflipClaimableKnown = false;
      this.#coinflipBackingWei = 0n;
      this.#coinflipBackingAddress = actingLower;
      this.#coinflipBackingKnown = false;
      this.#afkingPendingFlipWei = 0n;
      this.#afkingPendingFlipAddress = actingLower;
      this.#afkingPendingFlipKnown = false;
    }
    const connected = get('connected.address');
    const connectedLower = connected ? String(connected).toLowerCase() : null;
    const provider = permissionlessReadProvider(getProvider());
    const walletBalancePromise = connectedLower && typeof provider?.getBalance === 'function'
      ? readNativeBalance(connectedLower, { provider })
      : Promise.resolve(null);
    // Purchase-critical reads resolve and paint independently of the indexed
    // dashboard wave. A dead /game/state or /player request must not hold the
    // live contract quote, presale option, or Buy In controls behind the API's
    // timeout.
    const purchaseQuotePromise = readPurchaseQuote().catch(() => null);
    const presaleStatePromise = actingLower
      ? readPresaleBoxState({ player: actingLower }).catch(() => null)
      : Promise.resolve(null);
    const dashboardResultsPromise = Promise.allSettled([
      // Display fallback only. purchaseInfo() above and the click-time read
      // below are the authority for anything that sends value.
      readGameState(),
      actingLower ? fetchJSON(`/player/${actingLower}`) : Promise.resolve(null),
      actingLower ? readPlayerActivityScore(actingLower) : Promise.resolve(null),
      actingLower
        ? readCoinflipDisplaySnapshot({ player: actingLower })
        : Promise.resolve(null),
      walletBalancePromise,
      actingLower ? readAfkingFunding(actingLower) : Promise.resolve(null),
      actingLower ? readAfkingSubscription(actingLower) : Promise.resolve(null),
    ]);

    const purchaseQuote = await purchaseQuotePromise;
    if (signal.aborted) return;
    this.#purchaseQuote = purchaseQuote;
    this.#renderSnapshot();
    this.#refreshFoilStatus();
    this.#refreshFlipBuyStatus();

    const presaleState = await presaleStatePromise;
    if (signal.aborted) return;
    if (presaleState != null && this.#presaleAddress === actingLower) {
      this.#presaleState = presaleState;
      this.#renderPresaleRow(this.#draftMintCostWei());
    }

    const [
      gameResult,
      playerResult,
      liveScoreResult,
      flipLedgerResult,
      walletResult,
      afkingFundingResult,
      afkingResult,
    ] = await dashboardResultsPromise;
    if (signal.aborted) return;

    if (gameResult.status === 'fulfilled' && gameResult.value) {
      this.#gameState = gameResult.value;
    }
    const indexedScore = playerResult.status === 'fulfilled' && playerResult.value
      ? Number(
        playerResult.value.scoreBreakdown?.totalBps
        ?? playerResult.value.activityScore,
      )
      : null;
    const liveScore = liveScoreResult.status === 'fulfilled'
      && liveScoreResult.value != null
      ? Number(liveScoreResult.value)
      : null;
    const selectedScore = Number.isFinite(liveScore)
      ? liveScore
      : Number.isFinite(indexedScore) ? indexedScore : null;
    if (actingLower && selectedScore != null) {
      // GAME is the same authoritative score source used by the quest HUD.
      // The indexed row remains a resilient fallback during RPC degradation.
      this.#degenScore = selectedScore;
      this.#degenScoreAddress = actingLower;
    }
    if (playerResult.status === 'fulfilled' && playerResult.value && actingLower) {
      let claimable = 0n;
      try { claimable = BigInt(playerResult.value.claimableEth || '0'); } catch (_e) { claimable = 0n; }
      this.#claimableWei = claimable;
      this.#claimableAddress = actingLower;
      this.#claimableKnown = true;
      try {
        this.#flipBalanceWei = BigInt(playerResult.value.flipBalance ?? 0n);
        this.#flipBalanceAddress = actingLower;
      } catch (_e) {
        this.#flipBalanceWei = null;
        this.#flipBalanceAddress = actingLower;
      }
      try {
        this.#coinflipClaimableWei = BigInt(playerResult.value.coinflip?.claimablePreview ?? 0n);
        this.#coinflipClaimableAddress = actingLower;
        this.#coinflipClaimableKnown = true;
      } catch (_e) {
        this.#coinflipClaimableWei = 0n;
        this.#coinflipClaimableAddress = actingLower;
        this.#coinflipClaimableKnown = false;
      }
      try {
        this.#coinflipCarryWeiIndexed = BigInt(playerResult.value.coinflip?.autoRebuyCarry ?? 0n);
      } catch (_e) {
        this.#coinflipCarryWeiIndexed = 0n;
      }
      this.#coinflipCarryAddress = actingLower;
      const affiliate = playerResult.value.affiliate;
      if (affiliate && Object.prototype.hasOwnProperty.call(affiliate, 'referrer')) {
        const referrer = String(affiliate.referrer || '').toLowerCase();
        this.#affiliateAssigned = this.#affiliateLocallyAssigned.has(actingLower) || Boolean(
          referrer && referrer !== '0x0000000000000000000000000000000000000000',
        );
      }
    } else if (this.#claimableAddress !== actingLower) {
      // Never carry one account's quote across an account/mode switch.
      this.#claimableWei = 0n;
      this.#claimableAddress = actingLower;
      this.#claimableKnown = false;
    }
    const centuryTarget = this.#targetLevel();
    const centuryScopeMatches = this.#centuryUsageAddress === actingLower
      && this.#centuryUsageLevel === centuryTarget;
    if (!centuryScopeMatches) {
      this.#centuryUsedUnits = 0n;
      this.#centuryUsageAddress = actingLower;
      this.#centuryUsageLevel = centuryTarget;
      this.#centuryUsageKnown = false;
    }
    if (actingLower && Number.isInteger(centuryTarget) && centuryTarget % 100 === 0) {
      try {
        const used = await readCenturyBonusUsed({
          player: actingLower,
          targetLevel: centuryTarget,
          provider,
        });
        if (signal.aborted) return;
        if (used != null
          && this.#centuryUsageAddress === actingLower
          && this.#centuryUsageLevel === centuryTarget) {
          this.#centuryUsedUnits = BigInt(used);
          this.#centuryUsageKnown = true;
        }
      } catch (_e) {
        // Preserve a same-player/same-century answer through a transient RPC
        // failure. A new scope was already cleared above and stays estimated.
      }
    } else {
      this.#centuryUsedUnits = 0n;
      this.#centuryUsageKnown = false;
    }
    // Adopt wallet, claimable, and carry-inclusive backing together. They were
    // read at one block, so the left FLIP balance cannot show one side of a
    // claim transaction while ALL IN prices against the other.
    const flipLedger = flipLedgerResult.status === 'fulfilled'
      ? flipLedgerResult.value
      : null;
    if (flipLedger?.balances?.flipBalance != null && actingLower) {
      try {
        this.#flipBalanceWei = BigInt(flipLedger.balances.flipBalance);
        this.#flipBalanceAddress = actingLower;
      } catch (_e) { /* retain the indexed fallback */ }
    }
    if (flipLedger?.claimableWei != null && actingLower) {
      try {
        this.#coinflipClaimableWei = BigInt(flipLedger.claimableWei);
        this.#coinflipClaimableAddress = actingLower;
        this.#coinflipClaimableKnown = true;
      } catch (_e) { /* retain the indexed fallback */ }
    }
    if (flipLedger?.backingWei != null && actingLower) {
      try {
        this.#coinflipBackingWei = BigInt(flipLedger.backingWei);
        this.#coinflipBackingAddress = actingLower;
        this.#coinflipBackingKnown = true;
      } catch (_e) { /* retain claimable-only fallback */ }
    }
    if (walletResult.status === 'fulfilled' && walletResult.value != null && connectedLower) {
      try {
        this.#walletEthWei = BigInt(walletResult.value);
        this.#walletEthAddress = connectedLower;
      } catch (_e) {
        this.#walletEthWei = null;
        this.#walletEthAddress = connectedLower;
      }
    } else if (this.#walletEthAddress !== connectedLower) {
      // Never carry the prior signer's wallet balance across an account switch.
      this.#walletEthWei = null;
      this.#walletEthAddress = connectedLower;
    }

    let fundingReadSettled = false;
    if (afkingFundingResult.status === 'fulfilled'
      && afkingFundingResult.value != null
      && actingLower) {
      try {
        this.#afkingFundingWei = BigInt(afkingFundingResult.value);
        this.#afkingFundingAddress = actingLower;
        this.#afkingFundingKnown = true;
        fundingReadSettled = true;
      } catch (_e) { /* fall through to the full snapshot */ }
    }

    if (afkingResult.status === 'fulfilled'
      && afkingResult.value != null
      && actingLower === this.#afkingPassAddress) {
      const state = afkingResult.value;
      // `canClaimSeat` is gone — seats auto-mint with the pass, so holding one IS the signal.
      this.#hasAfkingPass = Boolean(state.hasToken || state.active);
      if (!fundingReadSettled) {
        try {
          this.#afkingFundingWei = BigInt(state.fundingWei ?? 0);
          this.#afkingFundingAddress = actingLower;
          this.#afkingFundingKnown = true;
          fundingReadSettled = true;
        } catch (_e) { /* handled below */ }
      }
      try {
        this.#afkingPendingFlipWei = state.pendingFlipKnown
          ? BigInt(state.pendingFlipWhole ?? 0n) * FLIP_WEI
          : 0n;
        this.#afkingPendingFlipAddress = actingLower;
        this.#afkingPendingFlipKnown = Boolean(state.pendingFlipKnown);
      } catch (_e) {
        this.#afkingPendingFlipWei = 0n;
        this.#afkingPendingFlipAddress = actingLower;
        this.#afkingPendingFlipKnown = false;
      }
    } else {
      this.#afkingPendingFlipWei = 0n;
      this.#afkingPendingFlipAddress = actingLower;
      this.#afkingPendingFlipKnown = false;
    }
    if (!fundingReadSettled) {
      // Keep the optional AFKing source unknown without making the independent
      // Wallet and Claimable sources disappear from Available Funds.
      this.#afkingFundingWei = 0n;
      this.#afkingFundingAddress = actingLower;
      this.#afkingFundingKnown = false;
    }

    this.#renderAffiliateInput();
    this.#renderAfkingShortcut();
    this.#renderSnapshot();
    // Foil ownership rides the same cycle (needs the fresh target level).
    this.#refreshFoilStatus();
    // So does the FLIP-window probe — the window latches open mid-phase and
    // is cleared at the final jackpot day's RNG request, so it has to be
    // re-asked rather than answered once.
    this.#refreshFlipBuyStatus();
  }

  #renderAffiliateInput() {
    const row = this.querySelector('[data-bind="dec-affiliate-row"]');
    const input = this.querySelector('[name="dec-affiliate-code"]');
    if (!row || !input) return;
    const show = Boolean(
      this.#affiliateAddress
      && this.#affiliateAssigned === false
      && get('ui.mode') !== 'combined',
    );
    row.hidden = !show;
    if (show) row.removeAttribute('hidden');
    else row.setAttribute('hidden', '');
    if (!show || this.#affiliatePrefilledFor === this.#affiliateAddress) return;
    // Preserve anything the player has already typed. If the field is still
    // blank and an ENS referral capture is resolving asynchronously, leave it
    // eligible for a later poll to pick up the newly saved bytes32 value.
    if (String(input.value || '').trim()) {
      this.#affiliatePrefilledFor = this.#affiliateAddress;
      return;
    }
    const saved = readAffiliateCode(CHAIN.id, this.#affiliateAddress);
    const friendly = formatPurchaseAffiliateCode(saved);
    if (friendly) {
      input.value = friendly;
      this.#affiliatePrefilledFor = this.#affiliateAddress;
    }
  }

  #renderAfkingShortcut() {
    const jump = this.querySelector('[data-bind="dec-afking-jump"]');
    if (!jump) return;
    const show = Boolean(
      this.#afkingPassAddress
      && this.#hasAfkingPass === false
      && get('ui.mode') !== 'combined',
    );
    jump.hidden = !show;
    if (show) jump.removeAttribute?.('hidden');
    else jump.setAttribute?.('hidden', '');
  }

  // ---------------------------------------------------------------------
  // Foil pack availability comes from the exact deployed purchase route. The
  // zero-value probe identifies a buyable route by Insolvent — the canonical
  // waterfall's shortfall revert since audit c19a1088, which replaced the
  // deleted DirectEthInsufficient; the
  // amount-accurate submit preflight remains the race guard.
  // ---------------------------------------------------------------------

  async #refreshFoilStatus() {
    // In operator mode the viewed owner receives the pack; checking the
    // connected operator instead can offer an already-owned pack and then
    // bounce at FoilAlreadyBought.
    const buyer = getActingAddress();
    const buyerKey = buyer ? String(buyer).toLowerCase() : null;
    const target = this.#targetLevel();
    if (!buyerKey || target == null) {
      this.#foilStatus = null;
      this.#renderFoilRow();
      return this.#foilStatus;
    }
    const seq = ++this.#foilSeq;
    const sameScope = this.#foilStatus != null
      && this.#foilStatus.buyer === buyerKey
      && Number(this.#foilStatus.level) === Number(target);
    // A routine poll used to clear the definitive answer here, hiding the row
    // until purchase.staticCall returned. Keep the last same-wallet/same-level
    // answer pinned so slow RPCs and transient failures cannot make the foil
    // control blink in and out. A wallet or routed-level change still clears it
    // immediately, because carrying that answer across scopes would be wrong.
    if (!sameScope) {
      this.#foilStatus = null;
      this.#renderFoilRow();
    }
    try {
      const probe = await probeFoilPackAvailabilityState({ buyer });
      const available = probe.available === true;
      if (seq !== this.#foilSeq) return; // superseded (wallet/level change)
      // A negative zero-value simulation can be temporary (RPC trouble or the
      // brief StaleAdvance/liveness boundary). Once this exact buyer/level has
      // been positively verified, do not make the checkbox blink out on that
      // weaker signal. The amount-accurate click preflight remains the final
      // race guard, while #markFoilOwned retires a confirmed local purchase
      // immediately.
      if (available || probe.definitive || !sameScope || this.#foilStatus?.available !== true) {
        this.#foilStatus = { buyer: buyerKey, level: target, available: Boolean(available) };
      }
    } catch (_e) {
      if (seq !== this.#foilSeq) return;
      // A failed refresh is not evidence that a previously buyable route
      // became unavailable. Preserve the pinned answer for this scope; first
      // load failures remain safely hidden.
      if (!sameScope) {
        this.#foilStatus = { buyer: buyerKey, level: target, available: false };
      }
    }
    this.#renderFoilRow();
    return this.#foilStatus;
  }

  #renderFoilRow() {
    const row = this.querySelector('[data-bind="dec-foil-row"]');
    if (!row) return;
    const check = this.querySelector('[data-bind="dec-foil-check"]');
    const priceEl = this.querySelector('[data-bind="dec-foil-price"]');
    const target = this.#targetLevel();
    const buyer = getActingAddress();
    const buyerKey = buyer ? String(buyer).toLowerCase() : null;
    const available = Boolean(
      buyerKey
      && this.#foilStatus?.buyer === buyerKey
      && target != null
      && Number(this.#foilStatus?.level) === Number(target)
      && this.#foilStatus?.available === true
    );
    const flipMode = this.#flipModeEnabled();

    if (priceEl) {
      let text = '—';
      const priceWei = this.#ticketPriceWei();
      if (priceWei != null) {
        try { text = `${formatPurchaseEth(foilPackCostFromPriceWei(priceWei))} ETH`; } catch (_e) { text = '—'; }
      }
      priceEl.textContent = text;
      row.setAttribute?.('aria-label', `Toggle one foil pack, limit one${text === '—' ? '' : `, ${text}`}`);
    }
    if (check) {
      check.disabled = !available || flipMode;
      if (!available || flipMode) check.checked = false;
      row.classList?.toggle('is-selected', Boolean(check.checked));
      row.setAttribute?.('aria-pressed', String(Boolean(check.checked)));
    }
    // redeemFlip is a tickets-only route. Hiding the incompatible add-on is
    // clearer than leaving a disabled foil control in the FLIP draft; it is
    // restored from the pinned availability probe as soon as ETH mode returns.
    row.hidden = !available || flipMode;
    this.#updateTotalLabel();
  }

  // ---------------------------------------------------------------------
  // FLIP ticket buy — GAME.redeemFlip(buyer, entryQuantityScaled).
  //
  // A separate tx from purchase(): tickets only, flat 1,000 FLIP each
  // (PRICE_COIN_UNIT), no lootbox or foil leg, and the contract skips activity
  // score / affiliate credit / buyer-side FLIP minting on this path
  // (MintModule.sol:979-982). Availability comes from the public opening
  // predicate; see claims.js probeRedeemFlipWindow.
  // ---------------------------------------------------------------------

  async #refreshFlipBuyStatus() {
    const buyer = getActingAddress();
    const seq = ++this.#flipProbeSeq;
    if (!buyer) {
      this.#flipBuyOpen = false;
      this.#renderFlipBuyRow();
      return;
    }
    // Do not simulate a one-ticket burn here. Doing so hides the FLIP balance
    // from players holding less than 1,000 FLIP even while the window is open.
    // The entered amount is simulated only when the player presses Buy.
    let open = false;
    try { open = await probeRedeemFlipWindow(); }
    catch (_e) { open = false; }
    if (seq !== this.#flipProbeSeq) return;  // superseded (wallet change / newer poll)
    this.#flipBuyOpen = open;
    this.#renderFlipBuyRow();
  }

  #renderFlipBuyRow() {
    if (!this.#flipBuyOpen) {
      const check = this.querySelector('[data-bind="dec-flip-check"]');
      if (check) check.checked = false;
    }
    this.#renderPurchaseMode();
  }

  #flipModeEnabled() {
    const check = this.querySelector('[data-bind="dec-flip-check"]');
    return Boolean(this.#flipBuyOpen && check?.checked);
  }

  #renderPurchaseMode() {
    const flipMode = this.#flipModeEnabled();
    const toggle = this.querySelector('[data-bind="dec-funds-total-flip"]');
    if (toggle) {
      toggle.setAttribute?.('aria-pressed', String(flipMode));
      toggle.classList?.toggle('is-active', flipMode);
      toggle.textContent = flipMode ? 'USING FLIP' : 'USE FLIP';
      toggle.setAttribute?.('aria-label', flipMode ? 'Use ETH instead of FLIP' : 'Use FLIP for tickets');
    }
    const useEth = this.querySelector('[data-bind="dec-funds-total-eth"]');
    if (useEth) {
      useEth.textContent = 'USE ETH';
      useEth.hidden = !flipMode;
      if (useEth.hidden) useEth.setAttribute?.('hidden', '');
      else useEth.removeAttribute?.('hidden');
    }
    const ticketLabel = this.querySelector('[data-bind="dec-ticket-action-label"]');
    if (ticketLabel) ticketLabel.textContent = flipMode ? 'Burn for tickets' : 'Buy tickets';
    const ticketBoon = this.querySelector('[data-bind="dec-ticket-boon"]');
    if (ticketBoon) {
      // The marker owns its own visibility — it hides itself whenever no boon
      // is live. Never un-hide it from here: this method runs on every poll
      // cycle (via #renderFlipBuyRow), so `hidden = flipMode` painted a bare
      // boon arrow beside the ticket input on every cycle, which then vanished
      // at the next app.boons publish. Suppression is the one-way signal; its
      // removal re-renders the element, which decides for itself.
      if (flipMode) {
        ticketBoon.hidden = true;
        ticketBoon.setAttribute?.('suppressed', '');
      } else {
        ticketBoon.removeAttribute?.('suppressed');
      }
    }
    const buyRow = this.querySelector('.dec-buy-row');
    if (buyRow?.classList) buyRow.classList.toggle('dec-buy-row--flip', flipMode);
    const lootboxGroup = this.querySelector('[data-bind="dec-lootbox-group"]');
    if (lootboxGroup) {
      lootboxGroup.hidden = flipMode;
      lootboxGroup.classList?.toggle('dec-input-group--disabled', flipMode);
    }
    if (flipMode) this.#clearBoxDraft();
    for (const name of [
      'dec-box-small',
      'dec-box-medium',
      'dec-box-large',
      'dec-box-custom-count',
      'dec-box-custom-eth',
    ]) {
      const input = this.querySelector(`[name="${name}"]`);
      if (input) input.disabled = flipMode;
    }
    for (const selector of ['.dec-box-step', '.dec-box-card__add']) {
      for (const control of Array.from(this.querySelectorAll?.(selector) || [])) {
        control.disabled = flipMode;
      }
    }
    const customToggle = this.querySelector('[data-bind="dec-custom-box-toggle"]');
    if (customToggle) customToggle.disabled = flipMode;

    const foilRow = this.querySelector('[data-bind="dec-foil-row"]');
    const foilCheck = this.querySelector('[data-bind="dec-foil-check"]');
    if (foilRow?.classList) foilRow.classList.toggle('dec-foil--payment-disabled', flipMode);
    if (foilCheck && flipMode) foilCheck.checked = false;

    // The ordered ETH source preference remains intact behind USE FLIP, so a
    // quest or one-off redemption never rewrites the normal payment waterfall.
    this.#renderFoilRow();
    this.#renderSnapshot();
  }

  #renderFundsFooter() {
    const root = this.querySelector('[data-bind="dec-funds"]');
    const totalDisplay = this.querySelector('[data-bind="dec-funds-total-display"]');
    const totalValue = this.querySelector('[data-bind="dec-funds-total"]');
    const walletLabel = this.querySelector('[data-bind="dec-funds-wallet-label"]');
    const walletValue = this.querySelector('[data-bind="dec-funds-wallet"]');
    const walletDisplay = this.querySelector('[data-bind="dec-funds-wallet-display"]');
    const faucet = this.querySelector('[data-bind="dec-funds-faucet"]');
    const claimableValue = this.querySelector('[data-bind="dec-funds-claimable"]');
    const claimableUnit = this.querySelector('[data-bind="dec-funds-claimable-unit"]');
    const claimableDisplay = this.querySelector('[data-bind="dec-funds-claimable-display"]');
    const claimBtn = this.querySelector('[data-bind="dec-funds-claim"]');
    const useClaimable = this.querySelector('[data-bind="dec-funds-use-claimable"]');
    const afkingDisplay = this.querySelector('[data-bind="dec-funds-afking-display"]');
    const afkingValue = this.querySelector('[data-bind="dec-funds-afking"]');
    const afkingClaimBtn = this.querySelector('[data-bind="dec-funds-afking-claim"]');
    const useAfking = this.querySelector('[data-bind="dec-funds-use-afking"]');
    const useWallet = this.querySelector('[data-bind="dec-funds-use-wallet"]');
    const totalFlip = this.querySelector('[data-bind="dec-funds-total-flip"]');
    const totalEth = this.querySelector('[data-bind="dec-funds-total-eth"]');
    const allIn = this.querySelector('[data-bind="dec-all-in"]');
    const flipBalanceDisplay = this.querySelector('[data-bind="dec-flip-balance"]');
    const flipBalanceValue = this.querySelector('[data-bind="dec-flip-balance-value"]');
    if (!root || !walletLabel || !walletValue || !claimableValue || !claimBtn) return;

    walletLabel.textContent = 'WALLET';
    if (claimableUnit) claimableUnit.textContent = 'ETH';
    const flipMode = this.#flipModeEnabled();
    const displayTarget = decimatorReadAddress();
    const actingLower = displayTarget ? String(displayTarget).toLowerCase() : null;
    if (flipBalanceDisplay) {
      const showFlipBalance = this.#flipBuyOpen && get('ui.mode') !== 'combined';
      flipBalanceDisplay.hidden = !showFlipBalance;
      if (showFlipBalance) flipBalanceDisplay.removeAttribute?.('hidden');
      else flipBalanceDisplay.setAttribute?.('hidden', '');
    }
    const flipWalletWei = this.#flipBalanceAddress === actingLower
      ? this.#flipBalanceWei
      : null;
    const flipClaimableWei = this.#coinflipClaimableKnown
      && this.#coinflipClaimableAddress === actingLower
      ? this.#coinflipClaimableWei
      : 0n;
    // The chain backing read is claimable + active carry. Falling back to
    // claimable alone dropped the carry entirely, understating the player's
    // coinflip FLIP by whatever auto-rebuy had accumulated. The indexed carry
    // mirror keeps the total honest when that read is unavailable.
    const flipBackingWei = this.#coinflipBackingKnown
      && this.#coinflipBackingAddress === actingLower
      ? this.#coinflipBackingWei
      : flipClaimableWei + this.#coinflipCarryWei();
    // Display all coinflip value the player could withdraw, including active
    // auto-rebuy carry. The right-side rack publishes the value it actually
    // painted so this mirror cannot race ahead of its reveal.
    const protocolCoinsDisclosure = get('ui.protocolCoinsFlipDisclosure');
    const matchingFlipDisclosure = Boolean(
      actingLower
      && protocolCoinsDisclosure?.address === actingLower
    );
    const flipBackingDisplayed = heldBalanceValue({
      namespace: `protocol-flip-backing:${CHAIN.id}`,
      scope: actingLower,
      value: flipBackingWei,
      released: matchingFlipDisclosure && protocolCoinsDisclosure?.held === false,
    });
    let protocolFlipWei = protocolFlipTotalWei(flipWalletWei, flipBackingDisplayed);
    if (matchingFlipDisclosure && protocolCoinsDisclosure?.valueWei != null) {
      try { protocolFlipWei = BigInt(protocolCoinsDisclosure.valueWei); }
      catch (_error) { /* retain the locally composed settled value */ }
    }
    const flipBalanceHeld = !matchingFlipDisclosure || protocolCoinsDisclosure?.held !== false;
    flipBalanceDisplay?.setAttribute?.('data-balance-held', String(flipBalanceHeld));
    updateBalanceDisplay(flipBalanceValue, {
      container: flipBalanceDisplay,
      scope: actingLower == null ? null : `${actingLower}:flip-total`,
      value: protocolFlipWei,
      visible: true,
      format: (raw) => raw === 0n ? '-' : formatFlip(String(raw)),
      formatDelta: (delta) => `+${formatFlip(String(delta))} FLIP`,
    });

    let claimable = 0n;
    try {
      claimable = this.#claimableWei;
    } catch (_e) {
      // A malformed snapshot stays visibly unknown instead of breaking buys.
    }

    const connected = get('connected.address');
    const connectedLower = connected ? String(connected).toLowerCase() : null;
    const walletKnown = this.#walletEthWei != null
      && this.#walletEthAddress === connectedLower;
    const fundingKnown = this.#afkingFundingKnown
      && this.#afkingFundingAddress === actingLower;
    const walletBalance = walletKnown ? BigInt(this.#walletEthWei) : null;
    const afkingBalance = fundingKnown ? BigInt(this.#afkingFundingWei) : null;
    const spendableClaimable = this.#claimableKnown && claimable > 1n ? claimable - 1n : 0n;
    const ethRewardsReleased = this.#claimableSpoilerOpen()
      && !pendingMayChangeEth(this.#pendingActions);
    const displayedClaimable = heldBalanceValue({
      namespace: `claimable-eth:${CHAIN.id}`,
      scope: actingLower,
      value: this.#claimableKnown ? spendableClaimable : null,
      released: ethRewardsReleased,
      // Existing winnings can be spent or claimed while another result is
      // pending. Let that decrease paint; only a possible new award is held.
      allowDecrease: true,
    });
    const claimableHasFunds = displayedClaimable != null && displayedClaimable > 0n;
    const afkingHasFunds = fundingKnown && afkingBalance > 0n;
    const walletHasFunds = walletKnown && walletBalance > 0n;
    const rows = {
      claimable: claimableDisplay,
      afking: afkingDisplay,
      wallet: walletDisplay,
    };
    const buttons = {
      claimable: useClaimable,
      afking: useAfking,
      wallet: useWallet,
    };
    const orderedSources = this.#fundingOrder.filter((source) => rows[source]);
    const compactSource = orderedSources.find((source) => source !== 'afking' || afkingHasFunds)
      || 'wallet';
    const breakdown = this.querySelector('[data-bind="dec-funds-breakdown"]');
    if (breakdown) {
      breakdown.hidden = !this.#fundsExpanded;
      if (this.#fundsExpanded) breakdown.removeAttribute?.('hidden');
      else breakdown.setAttribute?.('hidden', '');
      if (breakdown.dataset) breakdown.dataset.expanded = String(this.#fundsExpanded);
    }
    for (const [rank, source] of orderedSources.entries()) {
      const row = rows[source];
      row.style.order = String(rank);
      row.setAttribute?.('data-funding-rank', String(rank + 1));
      row.classList?.toggle('is-priority', rank === 0);
    }
    // Keep assistive-technology order aligned with the visual grid in a real
    // DOM. The lightweight test DOM has flattened parents, so `order` remains
    // the deterministic fallback there.
    if (breakdown && orderedSources.every((source) => rows[source]?.parentElement === breakdown)) {
      for (const source of orderedSources) breakdown.appendChild(rows[source]);
    }
    const selectedSource = this.#fundingOrder[0];
    for (const source of orderedSources) {
      const button = buttons[source];
      if (!button) continue;
      const selected = source === selectedSource;
      const isTopVisibleSource = source === compactSource;
      button.setAttribute?.('aria-pressed', selected ? 'true' : 'false');
      button.classList?.toggle('is-active', selected);
      // USE expresses future payment order, so it remains actionable even
      // when that source is currently empty. Only the already-active top row
      // omits its redundant promotion control.
      button.disabled = false;
      button.textContent = 'USE FIRST';
      button.hidden = !this.#fundsExpanded || isTopVisibleSource;
      if (button.hidden) button.setAttribute?.('hidden', '');
      else button.removeAttribute?.('hidden');
      button.title = selected ? `${source.toUpperCase()} is used first` : `Use ${source.toUpperCase()} first`;
    }
    if (totalFlip) {
      totalFlip.hidden = !this.#flipBuyOpen || get('ui.mode') === 'combined';
      if (totalFlip.hidden) totalFlip.setAttribute?.('hidden', '');
      else totalFlip.removeAttribute?.('hidden');
      totalFlip.setAttribute?.('aria-pressed', String(flipMode));
      totalFlip.classList?.toggle('is-active', flipMode);
    }
    if (totalEth) {
      totalEth.hidden = !flipMode;
      if (totalEth.hidden) totalEth.setAttribute?.('hidden', '');
      else totalEth.removeAttribute?.('hidden');
    }
    let showAllIn = false;
    if (allIn) {
      const rawAllInEligible = get('ui.mode') === 'self'
        && actingLower != null
        && this.#degenScoreAddress === actingLower
        && allInDegenScoreEligible(this.#degenScore);
      if (get('ui.allInEligible') !== rawAllInEligible) {
        update('ui.allInEligible', rawAllInEligible);
      }
      showAllIn = rawAllInEligible && readAllInButtonPreference();
      allIn.hidden = !showAllIn;
      if (allIn.hidden) allIn.setAttribute?.('hidden', '');
      else allIn.removeAttribute?.('hidden');
      allIn.disabled = this.#busy;
      allIn.setAttribute?.('aria-label', 'Open ALL IN choices');
      allIn.title = 'Choose a currency and where to go all in';
    }
    root.setAttribute?.('data-primary-funding', compactSource);
    const displayedClaimableKnown = displayedClaimable != null;
    const totalComplete = displayedClaimableKnown && fundingKnown && walletKnown;
    const totalKnown = displayedClaimableKnown || fundingKnown || walletKnown;
    const totalBalance = totalKnown
      ? (displayedClaimableKnown ? displayedClaimable : 0n)
        + (fundingKnown ? afkingBalance : 0n)
        + (walletKnown ? walletBalance : 0n)
      : null;
    root.setAttribute?.('data-funds-complete', String(totalComplete));
    if (totalDisplay) {
      totalDisplay.hidden = this.#fundsExpanded;
      if (totalDisplay.hidden) totalDisplay.setAttribute?.('hidden', '');
      else totalDisplay.removeAttribute?.('hidden');
      totalDisplay.classList?.toggle('dec-funds__total--flip-active', flipMode);
      totalDisplay.setAttribute?.('data-balance-held', String(!ethRewardsReleased));
      if (!ethRewardsReleased) {
        totalDisplay.setAttribute?.('aria-label',
          'Last settled available funds. Wallet and AFKING changes continue to update.');
      } else {
        totalDisplay.removeAttribute?.('aria-label');
      }
    }
    if (totalValue) {
      totalValue.removeAttribute('role');
      totalValue.removeAttribute('tabindex');
      const totalLabel = !ethRewardsReleased
        ? 'Last settled winnings; wallet and AFKING changes remain live'
        : totalComplete ? 'Available funds' : 'Available funds; some sources are still loading';
      totalValue.setAttribute('title', totalLabel);
      totalValue.setAttribute('aria-label', totalLabel);
    }
    updateBalanceDisplay(totalValue, {
      container: totalDisplay,
      scope: `${actingLower || ''}:${connectedLower || ''}`,
      value: totalBalance,
      visible: true,
      format: formatFundsEth,
      formatDelta: (delta) => `+${formatFundsEth(delta)} ETH`,
    });
    updateBalanceDisplay(walletValue, {
      container: walletDisplay,
      scope: this.#walletEthAddress,
      value: walletBalance,
      format: (raw) => raw === 0n ? '- ETH' : `${formatFundsEth(raw)} ETH`,
      formatDelta: (delta) => `+${formatFundsEth(delta)} ETH`,
    });
    // AFKing is spendable purchase credit, but it cannot pay the gas needed to
    // submit that purchase. The faucet therefore follows native Wallet alone.
    const showFaucet = Boolean(
      isBaseSepolia(CHAIN)
      && walletKnown
      && BigInt(this.#walletEthWei) === 0n
    );
    if (walletDisplay) {
      const showWallet = this.#fundsExpanded;
      walletDisplay.hidden = !showWallet;
      if (showWallet) walletDisplay.removeAttribute?.('hidden');
      else walletDisplay.setAttribute?.('hidden', '');
    }
    const showFaucetAction = showFaucet && this.#fundsExpanded;
    walletValue.hidden = showFaucetAction && (walletBalance == null || walletBalance === 0n);
    if (faucet) faucet.hidden = !showFaucetAction;

    if (claimableDisplay) {
      const showClaimable = this.#fundsExpanded;
      claimableDisplay.hidden = !showClaimable;
      if (showClaimable) claimableDisplay.removeAttribute?.('hidden');
      else claimableDisplay.setAttribute?.('hidden', '');
    }
    updateBalanceDisplay(claimableValue, {
      container: claimableDisplay,
      scope: this.#claimableAddress,
      value: displayedClaimable,
      visible: true,
      format: (raw) => raw === 0n ? '-' : formatFundsEth(raw),
      formatDelta: (delta) => `+${formatFundsEth(delta)} ETH`,
    });

    if (afkingDisplay) {
      const showAfking = afkingHasFunds && this.#fundsExpanded;
      afkingDisplay.hidden = !showAfking;
      if (showAfking) afkingDisplay.removeAttribute?.('hidden');
      else afkingDisplay.setAttribute?.('hidden', '');
    }
    updateBalanceDisplay(afkingValue, {
      container: afkingDisplay,
      scope: this.#afkingFundingAddress,
      value: fundingKnown ? afkingBalance : null,
      format: (raw) => raw === 0n ? '- ETH' : `${formatFundsEth(raw)} ETH`,
      formatDelta: (delta) => `+${formatFundsEth(delta)} ETH`,
    });
    claimableDisplay?.setAttribute?.('data-balance-held', String(!ethRewardsReleased));
    claimableValue.removeAttribute('aria-hidden');
    claimableValue.removeAttribute('role');
    claimableValue.removeAttribute('tabindex');
    if (!ethRewardsReleased) {
      claimableValue.setAttribute('title', 'Last settled value; updates after RNG reveals');
      claimableValue.setAttribute('aria-label', 'Last settled claimable balance. Updates after RNG reveals.');
      claimableDisplay?.setAttribute(
        'aria-label',
        'Last settled claimable balance. Updates after RNG reveals.',
      );
    } else {
      claimableValue.removeAttribute('title');
      claimableValue.removeAttribute('aria-label');
      claimableDisplay?.removeAttribute('aria-label');
    }
    root.classList?.toggle('has-claimable', claimableHasFunds);
    root.classList?.toggle('has-afking-funding', afkingHasFunds);
    root.classList?.toggle('is-expanded', this.#fundsExpanded);
    const busy = this.#claimBusy === 'eth';
    const claimReady = Boolean(
      !this.#busy && !this.#claimBusy && getActingAddress() && claimableHasFunds,
    );
    // Keep the action's location stable while expanded. Eligibility controls
    // its disabled/grey state; a zero balance must not make the button vanish.
    const showClaimAction = this.#fundsExpanded;
    claimBtn.hidden = !showClaimAction;
    if (showClaimAction) claimBtn.removeAttribute?.('hidden');
    else claimBtn.setAttribute?.('hidden', '');
    claimBtn.textContent = busy ? 'CLAIMING…' : 'CLAIM';
    claimBtn.disabled = !claimReady;
    if (claimReady) {
      claimBtn.removeAttribute('data-write-locked');
      claimBtn.removeAttribute('data-write-lock-title');
    } else {
      claimBtn.setAttribute('data-write-locked', '');
      claimBtn.setAttribute(
        'data-write-lock-title',
        !claimableHasFunds
          ? 'No ETH winnings to claim'
          : 'Claim is unavailable right now',
      );
    }
    claimBtn.setAttribute(
      'aria-label',
      'Claim ETH winnings',
    );

    if (afkingClaimBtn) {
      const afkingBusy = this.#claimBusy === 'afking';
      const selfMode = get('ui.mode') === 'self';
      const afkingClaimReady = Boolean(
        selfMode && !this.#busy && !this.#claimBusy && getActingAddress() && afkingHasFunds,
      );
      const showAfkingClaimAction = this.#fundsExpanded && afkingHasFunds;
      afkingClaimBtn.hidden = !showAfkingClaimAction;
      if (showAfkingClaimAction) afkingClaimBtn.removeAttribute?.('hidden');
      else afkingClaimBtn.setAttribute?.('hidden', '');
      afkingClaimBtn.textContent = afkingBusy ? 'CLAIMING…' : 'CLAIM';
      afkingClaimBtn.disabled = !afkingClaimReady;
      afkingClaimBtn.setAttribute('aria-label', 'Claim all AFKing funding');
      if (afkingClaimReady) {
        afkingClaimBtn.removeAttribute('data-write-locked');
        afkingClaimBtn.removeAttribute('data-write-lock-title');
        afkingClaimBtn.title = 'Withdraw all prepaid AFKing ETH to this wallet';
      } else {
        const reason = !selfMode
          ? 'Switch to your own wallet view to claim AFKing funding'
          : !afkingHasFunds
            ? 'No AFKing funding to claim'
            : 'Claim is unavailable right now';
        afkingClaimBtn.setAttribute('data-write-locked', '');
        afkingClaimBtn.setAttribute('data-write-lock-title', reason);
        afkingClaimBtn.title = reason;
      }
    }
  }

  #claimableSpoilerOpen() {
    const rawDay = get('app.daySync')?.day ?? get('app.lastDay')?.day;
    if (rawDay == null) return true; // no resolved main jackpot to spoil yet
    const day = Number(rawDay);
    if (!Number.isFinite(day)) return false;
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(`spun_day_${CHAIN.id}_${day}`) === '1';
    } catch (_e) {
      return false;
    }
  }

  async #onClaimFundsClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busy || this.#claimBusy) return;
    const player = getActingAddress();
    if (!player) {
      this.#renderError('Connect your wallet to claim.');
      return;
    }
    const amount = this.#claimableWei;
    if (amount <= 0n) {
      this.#renderError('No ETH winnings to claim.');
      return;
    }

    this.#claimBusy = 'eth';
    this.#renderFundsFooter();
    try {
      await claimEth({ player });
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderError(compactUiError(error, 'Claim did not go through. Try again.'));
    } finally {
      this.#claimBusy = null;
      this.#renderFundsFooter();
    }
  }

  async #onClaimAfkingFundsClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busy || this.#claimBusy || get('ui.mode') !== 'self') return;
    if (!this.#afkingFundingKnown || this.#afkingFundingWei <= 0n) {
      this.#renderError('No AFKing funding to claim.');
      return;
    }

    this.#claimBusy = 'afking';
    this.#renderFundsFooter();
    try {
      await withdrawAfkingSubscriptionFunding();
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderError(compactUiError(error, 'AFKing funding claim did not go through. Try again.'));
    } finally {
      this.#claimBusy = null;
      this.#renderFundsFooter();
    }
  }

  #clearCompletedBuyDraft() {
    // A mined buy should not leave the visible form armed with the same
    // amounts. Programmatic quest/all-in buys deliberately bypass this helper
    // so their temporary values cannot erase a player's normal draft.
    const tickets = this.querySelector('[name="dec-tickets"]');
    if (tickets) tickets.value = '0';
    this.#clearBoxDraft();
    const foil = this.querySelector('[data-bind="dec-foil-check"]');
    if (foil) foil.checked = false;
    const foilRow = this.querySelector('[data-bind="dec-foil-row"]');
    foilRow?.classList?.remove('is-selected');
    foilRow?.setAttribute?.('aria-pressed', 'false');
    const presale = this.querySelector('[name="dec-presale-box-eth"]');
    if (presale) presale.value = '0';
    this.#closeBuilderPopovers({ restoreFocus: false });
  }

  async #onBuyWithFlipClick(e, options = {}) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    const allInFlow = options?.allIn === true;
    if (this.#busy) return false;
    const btn = this.querySelector('[data-bind="dec-buy-cta"]');
    const override = Number(options?.tickets);
    const hasTicketOverride = Number.isFinite(override) && override > 0;
    const tickets = hasTicketOverride
      ? Math.round(override * ENTRIES_PER_TICKET) / ENTRIES_PER_TICKET
      : this.#ticketsWanted();
    if (tickets <= 0) {
      const message = 'Enter a ticket amount (0.25 minimum) to redeem with FLIP.';
      this.#renderError(message);
      if (allInFlow) throw new Error(message);
      return false;
    }
    const player = get('connected.address');
    if (!player) {
      const message = 'Connect a wallet to redeem FLIP.';
      this.#renderError(message);
      if (allInFlow) throw new Error(message);
      return false;
    }
    this.#busy = true;
    if (btn) {
      btn.disabled = true;
      if (!allInFlow) this.#setBuyLabel('Burning FLIP…');
    }
    try {
      const { receipt } = await redeemFlip({ player, tickets });
      if (!hasTicketOverride) this.#clearCompletedBuyDraft();
      // Same as the ETH ticket leg: FLIP-bought entries are trait-less until
      // the level draw, so no popup here — pack-watch pops the reveal once the
      // symbols are real. Fire-and-forget.
      const target = this.#targetLevel();
      if (target != null) {
        recordPendingPack({
          address: player,
          level: target,
          expectedTickets: Math.floor(tickets),
          sourceKey: receipt?.hash ? `redeem:${String(receipt.hash).toLowerCase()}` : null,
        }).catch(() => {});
      }
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
      return true;
    } catch (error) {
      const message = compactUiError(error, 'FLIP redemption did not go through. Try again.');
      this.#renderError(message);
      if (allInFlow) throw new Error(message, { cause: error });
    } finally {
      this.#busy = false;
      if (btn) btn.disabled = false;
      this.#updateTotalLabel();
    }
  }

  #foilWanted() {
    const check = this.querySelector('[data-bind="dec-foil-check"]');
    if (!check || check.disabled) return false;
    return Boolean(check.checked);
  }

  #markFoilOwned(level, buyer = getActingAddress(), source = 'receipt') {
    const lvl = Number(level);
    if (!Number.isInteger(lvl) || lvl < 0) return;
    const buyerKey = buyer ? String(buyer).toLowerCase() : null;
    this.#foilStatus = { buyer: buyerKey, level: lvl, available: false };
    const check = this.querySelector('[data-bind="dec-foil-check"]');
    if (check) check.checked = false;
    this.#renderFoilRow();
    void this.#refreshFoilStatus();
  }

  // The level a buy made RIGHT NOW routes to — gates the ticket price, the
  // foil-pack one-per-level key, and the Buy total. See active-level.js for the
  // contract port and why the old inline `jackpotPhase ? level : level + 1`
  // shorthand kept the foil row hidden past the point the contract would sell
  // the next level's pack. Returns null when /game/state hasn't loaded.
  #targetLevel() {
    const fallback = activeTicketLevel(
      this.#gameState,
      get('app.poolBenchmarks')?.contractPhase,
    );
    const current = Number(this.#purchaseQuote?.currentLevel);
    let price = 0n;
    try { price = BigInt(this.#purchaseQuote?.priceWei ?? 0n); } catch (_e) { price = 0n; }
    if (Number.isInteger(current) && current >= 0 && price > 0n) {
      const currentPrice = scaledTicketPriceWei(current);
      const nextPrice = scaledTicketPriceWei(current + 1);
      // purchaseInfo returns the actual game level plus the exact routed price.
      // A tier boundary makes the otherwise-hidden sealed-window route explicit.
      if (price === nextPrice && price !== currentPrice) return current + 1;
      if (price === currentPrice && price !== nextPrice) return current;
    }
    return fallback;
  }

  #ticketPriceWei() {
    try {
      const exact = BigInt(this.#purchaseQuote?.priceWei ?? 0n);
      if (exact > 0n) return exact;
    } catch (_e) { /* fall through to the API-derived curve */ }
    const target = this.#targetLevel();
    return target == null ? null : scaledTicketPriceWei(target);
  }

  // Visibility-aware refresh — on foreground return AFTER ≥5min hidden, fire
  // an immediate cycle within 1s. Mirrors Phase 56 D-04 + Phase 61 D-04.
  #wireVisibilityRePoll() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.#visibilityListener = () => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - this.#lastPollAt;
      if (elapsed >= 5 * 60 * 1000) {
        this.#runPollCycle();
      }
    };
    document.addEventListener('visibilitychange', this.#visibilityListener);
  }

  // Store subscriptions — Phase 58 namespace. On wallet switch (connected.address)
  // OR view-target switch (viewing.address), fire an immediate cycle restart.
  #wireStoreSubscriptions() {
    const u1 = subscribe('connected.address', () => this.#runPollCycle());
    const u2 = subscribe('viewing.address', () => this.#runPollCycle());
    // Account-switcher (2026-07-16): mode flip re-renders the combined
    // summary immediately; the merged payload updates live as polling.js's
    // combined-mode cycle refreshes.
    const u3 = subscribe('ui.mode', () => {
      if (get('ui.mode') !== 'self') this.#closeBuyInDialog({ restoreFocus: false });
      else if (this.#buyInDialogOpen) this.#renderBuyInDialog();
      this.#renderCombinedSummary();
      this.#renderAfkingShortcut();
      this.#runPollCycle();
    });
    const u4 = subscribe('app.playerCombined', (payload) => {
      this.#combined = payload;
      if (get('ui.mode') === 'combined') this.#renderCombinedSummary();
    });
    // A newly resolved day closes the spoiler gate immediately and supplies
    // the day-scoped key read by #claimableSpoilerOpen().
    const u5 = subscribe('app.lastDay', () => {
      this.#renderFundsFooter();
      this.#updateTotalLabel();
    });
    const u7 = subscribe('app.daySync', () => {
      this.#renderFundsFooter();
      this.#updateTotalLabel();
    });
    const u9 = subscribe('ui.protocolCoinsFlipDisclosure', () => this.#renderFundsFooter());
    const u8 = subscribePendingActions((items) => {
      this.#pendingActions = Array.isArray(items) ? items : [];
      this.#renderFundsFooter();
    });
    const u6 = subscribe('ui.foilQuest', () => {
      // Quest definitions and game state arrive on independent polls. Refresh
      // the routed contract probe, but never let quest metadata choose a level.
      // Keep the last same-scope answer visible while that read is in flight.
      this.#renderSnapshot();
      this.#refreshFoilStatus();
    });
    const u10 = subscribe('app.records', () => this.#updateTotalLabel());
    const u11 = subscribe('app.poolBenchmarks', () => {
      this.#renderSnapshot();
      this.#refreshFoilStatus();
    });
    const u12 = subscribeUiPreferences(({ name }) => {
      if (name === 'allInButton') this.#renderFundsFooter();
    });
    const u13 = subscribe('app.boons', () => this.#updateTotalLabel());
    this.#unsubs.push(u1, u2, u3, u4, u5, u6, u7, u8, u9, u10, u11, u12, u13);
  }

  // ---------------------------------------------------------------------
  // Account-switcher (2026-07-16) — combined-mode summary. Sums unclaimed
  // decimator.claimablePerLevel across the combined accounts (combine.js's
  // merged shape); futurePoolTotal is GLOBAL (combine.js takes the first
  // non-null value, not a per-account sum) and is shown for context only.
  // ---------------------------------------------------------------------

  #renderCombinedSummary() {
    const host = this.querySelector('[data-bind="dec-combined-summary"]');
    if (!host) return;
    const isCombined = get('ui.mode') === 'combined';
    if (!isCombined) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const d = this.#combined;
    const levels = Array.isArray(d?.decimator?.claimablePerLevel) ? d.decimator.claimablePerLevel : [];
    let unclaimedWei = 0n;
    let levelCount = 0;
    for (const l of levels) {
      if (!l || l.claimed) continue;
      let n = 0n;
      try { n = BigInt(l.ethAmount || '0'); } catch (_) { n = 0n; }
      if (n > 0n) { unclaimedWei += n; levelCount += 1; }
    }
    let unclaimedText = '0 ETH';
    try { unclaimedText = `${formatPurchaseEth(unclaimedWei)} ETH`; } catch (_e) { /* keep default */ }
    const addrCount = Array.isArray(d?.addresses) ? d.addresses.length : 0;
    host.textContent = levelCount > 0
      ? `Combined: ${unclaimedText} unclaimed decimator jackpot across ${levelCount} level${levelCount === 1 ? '' : 's'} (${addrCount} accounts). Buying needs a single account.`
      : `Combined: no unclaimed decimator jackpot across ${addrCount} accounts. Buying needs a single account.`;
  }

  // ---------------------------------------------------------------------
  // Render snapshot — server-derived strings via textContent (T-58-18).
  // CF-06: NEVER optimistic balance subtraction. The balance text reflects
  // server state only; pending-tx state does NOT decrement it locally.
  // ---------------------------------------------------------------------

  #renderSnapshot() {
    // Phase 64: price renders from /game/state into the header slot.
    const priceEl = this.querySelector('[data-bind="dec-price"]');
    const entryPriceEl = this.querySelector('[data-bind="dec-entry-price"]');
    const ticketPriceEl = this.querySelector('[data-bind="dec-ticket-price"]');
    const packPriceEl = this.querySelector('[data-bind="dec-pack-price"]');
    if (!priceEl || !entryPriceEl || !ticketPriceEl || !packPriceEl) return;
    const priceWei = this.#ticketPriceWei();
    const targetLevel = this.#targetLevel();
    const levelText = targetLevel == null ? 'LEVEL —' : `LEVEL ${targetLevel}`;
    let entryPriceText = '—';
    let ticketPriceText = '—';
    let packPriceText = '—';
    // The unit is set only after all amounts resolve, so a throw leaves the
    // group on the bare unavailable dash instead of a unit with no number.
    let priceUnit = '';
    if (this.#flipModeEnabled()) {
      try {
        entryPriceText = formatFlip(flipCostFromTickets(1 / ENTRIES_PER_TICKET).toString());
        ticketPriceText = formatFlip(flipCostFromTickets(1).toString());
        packPriceText = formatFlip(flipCostFromTickets(PURCHASE_TICKETS_PER_PACK).toString());
        priceUnit = 'FLIP';
      } catch (_e) { /* keep unavailable prices */ }
    } else if (priceWei != null) {
      try {
        entryPriceText = formatPurchaseEth(ticketCostFromTickets(priceWei, 1 / ENTRIES_PER_TICKET));
        ticketPriceText = formatPurchaseEth(priceWei);
        packPriceText = formatPurchaseEth(
          priceWei * BigInt(PURCHASE_TICKETS_PER_PACK),
          2,
        );
        priceUnit = 'ETH';
      } catch (_e) { /* keep unavailable prices */ }
    }
    renderPurchasePriceRow(entryPriceEl, 'ENTRY', entryPriceText, priceUnit);
    renderPurchasePriceRow(ticketPriceEl, 'TICKET', ticketPriceText, priceUnit);
    renderPurchasePriceRow(packPriceEl, 'PACK', packPriceText, priceUnit);
    for (const bind of ['dec-pack-level', 'dec-foil-level']) {
      const level = this.querySelector(`[data-bind="${bind}"]`);
      if (level) level.textContent = levelText;
    }
    // Preset cases carry the exact 1x / 5x / 25x ABI tier prices in their art.
    // Fractional amounts already read as prices. Whole amounts need the compact
    // ETH suffix so a lone "1" or "3" cannot be mistaken for the old tier ID.
    // The contract freezes those prices for a player's active box period; the
    // static call remains authoritative if an older frozen order crosses a level.
    for (const [bind, multiple] of [
      ['dec-box-price-small', 1n],
      ['dec-box-price-medium', BOX_ORDER_MEDIUM_MULTIPLE],
      ['dec-box-price-large', BOX_ORDER_LARGE_MULTIPLE],
    ]) {
      const label = this.querySelector(`[data-bind="${bind}"]`);
      const unit = this.querySelector(`[data-bind="${bind}-unit"]`);
      if (!label) continue;
      if (priceWei == null) {
        label.textContent = '—';
        if (unit) unit.hidden = true;
        continue;
      }
      try {
        const amount = formatPurchaseEth(priceWei * multiple);
        label.textContent = amount;
        if (unit) {
          unit.textContent = 'ETH';
          unit.hidden = !/^[1-9]\d*$/.test(amount);
        }
      } catch (_e) {
        label.textContent = '—';
        if (unit) unit.hidden = true;
      }
    }
    this.#renderFundsFooter();
    // Price is now known — refresh the Buy button's total-cost label.
    this.#updateTotalLabel();
  }

  // ---------------------------------------------------------------------
  // Buy click handler — closure-form sendTx via decimator.purchaseEth/Coin.
  // CF-01: closure form is enforced inside lootbox.js (re-exported).
  // CF-06: NO optimistic balance subtraction. Pre-click balance stays visible.
  //        On confirm → 250ms post-confirm refetch via #runPollCycle.
  // CF-07: error.userMessage rendered via textContent (T-58-18).
  // T-62-01-04: #busy guard makes double-clicks invoke purchaseEth exactly once.
  // ---------------------------------------------------------------------

  async #onBuyClick(e, questPurchase = null) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    const allInFlow = questPurchase?.allIn === true;
    if (this.#busy) return false;
    this.#busy = true;

    const btn = this.querySelector('[data-bind="dec-buy-cta"]');
    if (btn) {
      btn.disabled = true;
      if (!allInFlow) this.#setBuyLabel('Buying…');
    }
    // Defensive: clear any prior error before a fresh attempt.
    this.#clearError();
    let submittedLootboxHash = null;
    let submittedLootboxPlayer = null;
    const rejectPurchase = (message) => {
      this.#renderError(message);
      if (allInFlow) throw new Error(message);
      return false;
    };

    try {
      // TICKETS, fractional down to the entry (see #ticketsWanted). The field
      // used to be read with parseInt and sent as if it were entries, so "1"
      // bought a quarter ticket and paid for four.
      const ticketQuantity = questPurchase?.ticketQuantity == null
        ? this.#ticketsWanted()
        : Number(questPurchase.ticketQuantity);
      // The current ABI accepts one packed order, not a raw ETH amount. The
      // visual form owns four quantities; legacy quest/all-in callers that
      // still provide lootBoxAmountWei become one custom box so those flows
      // stay exact while they migrate.
      let boxOrder = 0n;
      let boxCostWei = 0n;
      try {
        if (questPurchase == null) {
          const draft = this.#boxDraft(this.#ticketPriceWei());
          if (draft.error) return rejectPurchase(draft.error);
          boxOrder = draft.order;
          boxCostWei = draft.costWei;
        } else if (questPurchase.boxSelection != null) {
          boxOrder = packBoxOrder(questPurchase.boxSelection);
          boxCostWei = questPurchase.boxCostWei == null
            ? boxOrderCostFromPriceWei(this.#ticketPriceWei() ?? 0n, boxOrder)
            : BigInt(questPurchase.boxCostWei);
        } else if (questPurchase.boxOrder != null) {
          boxOrder = BigInt(questPurchase.boxOrder);
          boxCostWei = questPurchase.boxCostWei == null
            ? boxOrderCostFromPriceWei(this.#ticketPriceWei() ?? 0n, boxOrder)
            : BigInt(questPurchase.boxCostWei);
        } else {
          const legacySizeWei = BigInt(questPurchase.lootBoxAmountWei ?? 0n);
          if (legacySizeWei > 0n) {
            boxOrder = packBoxOrder({ customCount: 1, customSizeWei: legacySizeWei });
            boxCostWei = legacySizeWei;
          }
        }
      } catch (error) {
        return rejectPurchase(compactUiError(error, 'Check the Luckbox order.'));
      }
      const presaleInput = this.querySelector('[name="dec-presale-box-eth"]');
      const presaleRaw = presaleInput == null || presaleInput.value == null
        || String(presaleInput.value).trim() === '' ? '0' : String(presaleInput.value);
      const presaleFloat = Number(presaleRaw);
      if (questPurchase == null && (!Number.isFinite(presaleFloat) || presaleFloat < 0)) {
        return rejectPurchase('Presale box ETH must be 0 or at least 0.01.');
      }
      const presaleBoxAmountWei = questPurchase?.presaleBoxAmountWei == null
        ? (presaleFloat > 0 ? BigInt(Math.round(presaleFloat * 1e18)) / ETH_DIVISOR : 0n)
        : BigInt(questPurchase.presaleBoxAmountWei);
      if (presaleBoxAmountWei > 0n && presaleBoxAmountWei < PRESALE_BOX_MIN_WEI) {
        return rejectPurchase('Minimum presale box size is 0.01 ETH.');
      }
      let foilWanted = questPurchase?.foilWanted == null
        ? this.#foilWanted()
        : Boolean(questPurchase.foilWanted);
      if (foilWanted && presaleBoxAmountWei > 0n) {
        return rejectPurchase('Buy the foil pack separately from a presale box.');
      }
      if (ticketQuantity < 0 || (ticketQuantity <= 0 && boxOrder <= 0n
        && presaleBoxAmountWei <= 0n && !foilWanted)) {
        return rejectPurchase('Add tickets or Luckboxes, enter a presale box amount, or select the foil pack.');
      }

      // Match lootbox.js's actual write target (self or the owner selected in
      // operator mode), so the deferred ticket reveal is recorded for the
      // account that receives the tickets.
      const buyer = getActingAddress();
      const affiliateCode = readAffiliateCode(CHAIN.id, buyer);
      let purchaseTicketPriceWei = this.#ticketPriceWei();

      // Funding needs one fresh routed price for tickets, preset boxes, and
      // foil. Custom box sizes are already encoded in the order, but they use
      // the same purchase and payment waterfall.
      let ticketCostWei = 0n;
      let foilCostWei = 0n;
      let purchaseQuote = null;
      const hasPresetBoxes = (boxOrder & 0xFFFFFFn) !== 0n;
      if (ticketQuantity > 0 || boxOrder > 0n || foilWanted) {
        // purchaseInfo() is the complete buy-now authority. Never put the DB
        // in this click's promise graph: an indexed outage must not consume the
        // wallet gesture or add the API timeout before the wallet prompt.
        const quote = await readPurchaseQuote({ fresh: true });
        purchaseQuote = quote;
        if (quote) this.#purchaseQuote = quote;
        // Never re-check indexed ownership here. purchaseEth immediately runs
        // the exact contract static-call with this level/value, which is both
        // fresher and authoritative.
        purchaseTicketPriceWei = this.#ticketPriceWei();
        if (purchaseTicketPriceWei == null && (ticketQuantity > 0 || hasPresetBoxes || foilWanted)) {
          return rejectPurchase('Ticket price unavailable — try again in a moment.');
        }
        // Exactly what the contract charges: priceWei * entryQuantityScaled /
        // (4 * QTY_SCALE). Quoting priceWei-per-ticket-count overpaid 4x, and
        // an overpay is credited to afking rather than refunded.
        if (ticketQuantity > 0) {
          ticketCostWei = ticketCostFromTickets(purchaseTicketPriceWei, ticketQuantity);
        }
        if (foilWanted) {
          foilCostWei = foilPackCostFromPriceWei(purchaseTicketPriceWei);
        }
        if (boxOrder > 0n) {
          boxCostWei = boxOrderCostFromPriceWei(purchaseTicketPriceWei ?? 0n, boxOrder);
          if (boxCostWei <= 0n) {
            return rejectPurchase('Luckbox price unavailable — try again in a moment.');
          }
        }
      }

      const mintCostWei = ticketCostWei + boxCostWei;
      if (presaleBoxAmountWei > 0n) {
        let livePresale = null;
        try { livePresale = await readPresaleBoxState({ player: buyer }); }
        catch (_e) { livePresale = null; }
        if (!livePresale?.active || livePresale.remainingWei <= 0n) {
          return rejectPurchase('Presale boxes are not available right now.');
        }
        this.#presaleAddress = String(buyer || '').toLowerCase();
        this.#presaleState = livePresale;
        const available = presaleBoxAvailableWei(livePresale, mintCostWei);
        if (presaleBoxAmountWei > available) {
          const message = `Presale box limit is ${formatPurchaseEth(available)} ETH for this purchase.`;
          this.#renderError(message);
          this.#renderPresaleRow(mintCostWei);
          if (allInFlow) throw new Error(message);
          return false;
        }
      }

      // Keep the aggregate amount under the legacy event key while pending
      // consumers migrate; new consumers also receive the packed order and
      // explicitly named cost.
      const lootBoxAmountWei = boxCostWei;
      const hasMintPurchase = ticketQuantity > 0 || boxOrder > 0n || foilWanted;
      const hasRngBoxPurchase = boxOrder > 0n || presaleBoxAmountWei > 0n;
      const onSubmitted = hasRngBoxPurchase
        ? (tx) => {
            submittedLootboxHash = String(tx?.hash || `local-${Date.now()}`).toLowerCase();
            submittedLootboxPlayer = String(buyer || '').toLowerCase();
            try {
              this.dispatchEvent(new CustomEvent('app-decimator:tx-submitted', {
                detail: {
                  player: buyer,
                  transactionHash: submittedLootboxHash,
                  boxOrder,
                  boxCostWei,
                  lootBoxAmountWei,
                  presaleBoxAmountWei,
                  ticketPriceWei: purchaseTicketPriceWei,
                },
                bubbles: true,
              }));
            } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }
          }
        : undefined;
      const { receipt, contract } = presaleBoxAmountWei > 0n && !hasMintPurchase
        ? await purchasePresaleBox({
            boxAmountWei: presaleBoxAmountWei,
            player: buyer,
            preferClaimable: questPurchase?.preferClaimable ?? this.#preferClaimable,
            useAfking: questPurchase?.useAfking ?? this.#useAfking,
            onSubmitted,
          })
        : await purchaseEth({
            ticketQuantity, boxOrder, boxCostWei, affiliateCode, ticketCostWei,
            foil: foilWanted, foilCostWei, presaleBoxAmountWei,
            purchaseQuote,
            preferClaimable: questPurchase?.preferClaimable ?? this.#preferClaimable,
            useAfking: questPurchase?.useAfking ?? this.#useAfking,
            onSubmitted,
          });

      if (questPurchase == null) this.#clearCompletedBuyDraft();

      // Receipt-log-first reveal plumbing (CF-05):
      //   - LootBoxIdx entries → pending boxes for the app-root box controller
      //     (index 0 = afking auto-open; the controller skips those).
      //   - Open legs already IN the buy receipt (afking auto-opens resolve
      //     inside the purchase tx) → reveal immediately.
      //   - Ticket leg → pack-opening reveal (sealed; traits come with the
      //     level draw).
      let boxes = [];
      try {
        const byIndex = new Map();
        for (const b of parseLootboxIdxFromReceipt(receipt, contract)) {
          byIndex.set(Number(b.lootboxIndex), {
            index: Number(b.lootboxIndex),
            day: b.day != null ? Number(b.day) : null,
            amountWei: b.amountWei ?? lootBoxAmountWei,
            hasLootboxLeg: true,
            hasPresaleLeg: false,
            ticketPriceWei: purchaseTicketPriceWei,
          });
        }
        for (const b of parsePresaleBoxBuyFromReceipt(receipt, contract)) {
          const index = Number(b.lootboxIndex);
          const prior = byIndex.get(index);
          if (prior) {
            prior.amountWei = BigInt(prior.amountWei ?? 0) + BigInt(b.amountWei ?? 0);
            prior.hasPresaleLeg = true;
          } else {
            byIndex.set(index, {
              index,
              day: null,
              amountWei: b.amountWei,
              hasLootboxLeg: false,
              hasPresaleLeg: true,
              ticketPriceWei: purchaseTicketPriceWei,
            });
          }
        }
        boxes = [...byIndex.values()];
      } catch (_e) { boxes = []; }

      // Publish the mined RNG work before any optional receipt enrichment.
      // Boon metadata and reveal decoration may require additional RPC reads;
      // neither should delay the player's lootbox from entering Pending.
      try {
        this.dispatchEvent(new CustomEvent('app-decimator:tx-confirmed', {
          detail: {
            ticketQuantity,
            boxOrder,
            boxCostWei,
            lootBoxAmountWei,
            presaleBoxAmountWei,
            ticketPriceWei: purchaseTicketPriceWei,
            boxes,
            player: buyer,
            transactionHash: receipt?.hash || receipt?.transactionHash || null,
            submittedTransactionHash: submittedLootboxHash,
          },
          bubbles: true,
        }));
      } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }

      try {
        // Foil leg confirmed by its receipt event (NOT optimistic — the tx
        // mined): clear the selected add-on and retain an informational marker.
        // The marker does not hide or disable future level attempts.
        const foilBought = parseFoilPackBoughtFromReceipt(receipt, contract)
          .find((f) => String(f.buyer || '').toLowerCase() === String(buyer || '').toLowerCase());
        const boughtFoilLevel = foilBought?.level ?? (foilWanted ? this.#targetLevel() : null);
        if (boughtFoilLevel != null) {
          this.#markFoilOwned(boughtFoilLevel, buyer);
        }
        // NO popup yet: normal and foil tickets are trait-less until the draw.
        // One pending record covers both legs, tells pack-watch to wait for the
        // laggier /foil endpoint, then lets it present those four lines in their
        // own branded foil pack rather than mixing them into ordinary tickets.
        const pendingPackLevel = foilBought?.level ?? this.#targetLevel();
        if ((ticketQuantity > 0 || foilWanted) && pendingPackLevel != null) {
          recordPendingPack({
            address: buyer,
            level: pendingPackLevel,
            standardExpected: ticketQuantity > 0,
            foilExpected: Boolean(foilWanted || foilBought),
            expectedTickets: Math.floor(ticketQuantity) + ((foilWanted || foilBought) ? 4 : 0),
            sourceKey: receipt?.hash ? `purchase:${String(receipt.hash).toLowerCase()}` : null,
          }).catch(() => {});
        }
        let autoLegs = parseOpenLegsFromReceipt(receipt, buyer);
        const openedBoxIndex = autoLegs.find(
          (leg) => leg?.legType === 'opened' && leg.lootboxIndex != null,
        )?.lootboxIndex;
        // Spin rolls suppress LootBoxOpened, but this purchase still published
        // exactly one RNG index. Preserve it here so a losing FLIP survival
        // draw can recover and display the exact preliminary payout at risk.
        const autoBoxIndex = openedBoxIndex
          ?? (boxes.length === 1 ? boxes[0]?.index : null);
        autoLegs = await enrichHumanBoxSpinLegs(autoLegs, {
          player: buyer,
          lootboxIndex: autoBoxIndex,
          blockNumber: receipt?.blockNumber ?? null,
        });
        autoLegs = await enrichLootboxBoonLegs(autoLegs, {
          player: buyer,
          lootboxIndex: autoBoxIndex,
          blockNumber: receipt?.blockNumber ?? null,
        });
        if (autoLegs.length > 0) {
          // Spin rolls intentionally suppress LootBoxOpened, so a pure
          // BoxSpin receipt has no index-bearing result leg. The purchase
          // event still published the one shared RNG batch to Pending above;
          // reuse it so receipt completion retires that exact indexed action.
          const transactionHash = receipt?.hash || receipt?.transactionHash || null;
          const releaseKey = lootboxPresentationKey(autoBoxIndex, transactionHash);
          const ticketPackRelease = lootboxTicketPackRelease({
            address: buyer,
            legs: autoLegs,
            sourceKey: releaseKey
              ? `lootbox:${releaseKey}`
              : transactionHash ? `lootbox-tx:${String(transactionHash).toLowerCase()}` : null,
          });
          queueReveal({
            kind: 'lootbox',
            lootboxIndex: autoBoxIndex,
            amountWei: lootBoxAmountWei + presaleBoxAmountWei,
            ticketPriceWei: purchaseTicketPriceWei,
            legs: autoLegs,
            ...(ticketPackRelease ? { ticketPackRelease } : {}),
            lootboxRelease: releaseKey ? {
              address: buyer,
              key: releaseKey,
              lootboxIndex: Number(autoBoxIndex ?? 0),
              transactionHash,
            } : null,
          });
        }
      } catch (_e) { /* reveal is decoration — never fail the buy over it */ }

      // Every successful first purchase closes the referral slot, including a
      // deliberate blank code (the contract assigns its no-referrer sink).
      if (hasMintPurchase && this.#affiliateAssigned === false) {
        this.#affiliateLocallyAssigned.add(String(buyer || '').toLowerCase());
        this.#affiliateAssigned = true;
        this.#renderAffiliateInput();
      }

      if (presaleBoxAmountWei > 0n && presaleInput) presaleInput.value = '0';

      // 250ms post-confirm refetch (CF-06) — additive to the 30s poll tick.
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
      return true;
    } catch (error) {
      // Decoded structured-revert error from lootbox.js (.userMessage / .code
      // / .recoveryAction / .cause). Render via textContent (T-58-18).
      const failureMessage = compactUiError(error, 'Purchase did not go through. Try again.');
      this.#renderError(failureMessage);
      if (submittedLootboxHash) {
        try {
          this.dispatchEvent(new CustomEvent('app-decimator:tx-failed', {
            detail: {
              player: submittedLootboxPlayer,
              transactionHash: submittedLootboxHash,
              message: failureMessage,
            },
            bubbles: true,
          }));
        } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }
        reportPendingActionError(failureMessage);
      }
      if (allInFlow) throw new Error(failureMessage, { cause: error });
    } finally {
      if (btn) btn.disabled = false;
      this.#busy = false;
      // Recompute both button lines after the pending label.
      this.#updateTotalLabel();
    }
  }

  // ---------------------------------------------------------------------
  // Error rendering — textContent only (T-58-18). 10s auto-clear timer.
  // ---------------------------------------------------------------------

  #renderError(msg) {
    const errEl = this.querySelector('[data-bind="dec-error"]');
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
    const errEl = this.querySelector('[data-bind="dec-error"]');
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

// Idempotency-guarded registration (Phase 58/59/60/61 pattern). Required for
// node:test re-import safety AND production hot-module-replacement scenarios.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-decimator-panel')) {
    customElements.define('app-decimator-panel', AppDecimatorPanel);
  }
}

export { AppDecimatorPanel };
