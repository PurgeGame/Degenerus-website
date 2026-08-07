// /app/components/app-decimator-panel.js — Phase 62 Plan 62-01 (BUY-01)
//
// Decimator level-mint panel. Custom Element shell mirrors Phase 60's
// app-packs-panel.js + Phase 61's app-claims-panel.js: light DOM, idempotent
// customElements.define guard, symmetric connectedCallback / disconnectedCallback,
// #unsubs[] for store subscriptions, panel-owned 30s poll cycle (Phase 61 D-04
// LOCKED — NOT polling.js's fictional generic API per RESEARCH Pitfall 9).
//
// On-chain surface: DegenerusGame.purchase() (RESEARCH Example 1) — SAME call as
// Phase 60 LBX-01, just with ticketQuantity > 0 and lootboxQuantity = 0 for
// tickets-only level-mint. Re-exports purchaseEth + purchaseCoin from decimator.js
// (which re-exports from lootbox.js — eager import triggers Phase 60's reason-map
// registrations: GameOverPossible / AfKingLockActive / NotApproved).
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
// existing 9 prefixes: .app-/.chain-/.clm-/.last-/.lbx-/.ldj-/.player-/.view-/.wallet-).

import { CHAIN, ETH_DIVISOR } from '../app/chain-config.js';
import { displayEth } from '../app/scaling.js';
import { compactUiError } from '../app/ui-error.js';
import { get, getActingAddress, subscribe } from '../app/store.js';
import { getProvider } from '../app/contracts.js';
import { fetchJSON } from '../app/api.js';
import {
  reportPendingActionError,
  subscribePendingActions,
} from '../app/pending-actions.js';
// Eager import — triggers Phase 60's reason-map registrations as a side-effect
// (GameOverPossible / AfKingLockActive / NotApproved). decimator.js is a thin
// re-export of lootbox.js's purchaseEth + purchaseCoin per Plan 62-01 D-01.
import { purchaseEth, scaledTicketPriceWei } from '../app/decimator.js';
import {
  claimAfkingSubscriptionFlip,
  readAfkingFunding,
  readAfkingSubscription,
  withdrawAfkingSubscriptionFunding,
} from '../app/passes.js';
// readAffiliateCode comes directly from lootbox.js — Plan 62-01's decimator.js
// only re-exports the two purchase helpers per its minimal-surface design.
// LOOTBOX_MIN_WEI: floor on the lootbox ETH leg. There is no per-box price —
// the contract's lootBoxAmount is a free ETH value (min 0.01 ether); the
// widget takes it as a single ETH input and both legs ride ONE purchase() tx.
import {
  readAffiliateCode, LOOTBOX_MIN_WEI, parseLootboxIdxFromReceipt,
  foilPackCostFromPriceWei, readPurchaseQuote,
  parseFoilPackBoughtFromReceipt,
  probeFoilPackAvailabilityState,
  readPresaleBoxState, purchasePresaleBox, parsePresaleBoxBuyFromReceipt,
  PRESALE_BOX_MIN_WEI,
  // A ticket is 4 entries; the contract takes entries and charges per entry, so
  // both the quote and the call go through these (see lootbox.js UNITS note).
  // claimableFirstPayment mirrors the click-time funding split for the bonus preview.
  ticketCostFromTickets, ENTRIES_PER_TICKET, claimableFirstPayment,
  readPurchaseFundingPriority as _readFundingPriority,
  writePurchaseFundingPriority as _writeFundingPriority,
  readPurchaseUseAfking as _readUseAfking,
  writePurchaseUseAfking as _writeUseAfking,
} from '../app/lootbox.js';
// Reveal plumbing: ticket purchases queue a pack-opening reveal; lootbox legs
// found in the BUY receipt itself (afking idx-0 auto-opens) reveal instantly.
// Boxes that need a separate openBox call go to the app-root
// <app-box-strip tray-only> controller via the tx-confirmed event's `boxes`
// detail. It publishes the eventual open/replay action to the bottom tray.
import { enrichLootboxBoonLegs, parseOpenLegsFromReceipt } from '../app/lootbox-legs.js';
// Contract port of _activeTicketLevel — the level a buy routes to right now.
import { activeTicketLevel } from '../app/active-level.js';
// FLIP ticket buy (GAME.redeemFlip) — a second, window-gated payment path for
// the ticket leg only. Public pool views drive visibility independently of
// whether the current player can afford one whole ticket.
import {
  claimEth,
  claimFlip,
  redeemFlip,
  probeRedeemFlipWindow,
  flipCostFromTickets,
} from '../app/claims.js';
import { readClaimableCoinflip } from '../app/coinflip.js';
import { formatFlip } from '../viewer/utils.js';
import { queueReveal } from './reveal-overlay.js';
import { updateBalanceDisplay, resetBalanceDisplay } from '../app/balance-countup.js';
import { degeneretteLimits } from '../app/degenerette.js';
// Ticket reveals are deferred until the traits roll — see app/app/pack-watch.js.
import { recordPendingPack, recordLootboxTicketPacks } from '../app/pack-watch.js';
import { BASE_SEPOLIA_FAUCET_URL, isBaseSepolia } from './testnet-beta-banner.js';
import './boon-product-indicator.js';

// Wraps setInterval with .unref() in Node.js (no-op in browsers). Used for the
// 30s poll tick so node:test processes exit cleanly when no other open handles
// remain. Verbatim port of app-claims-panel.js _setIntervalUnref (Phase 61).
function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

const POLL_INTERVAL_MS = 30_000;       // Phase 56 D-04 / Phase 61 D-04 LOCKED.
const POST_CONFIRM_REFETCH_MS = 250;   // CF-06 — 250ms debounced refetch on tx confirm.
const ERROR_AUTO_CLEAR_MS = 10_000;    // 10s — mirrors Phase 61 D-05 pattern.
// Purchase quotes are controls, not accounting tables: fixed-width values such
// as "0.0400" add noise and can make an input step look more precise than it
// is. Keep displayEth's chain scaling/precision, then trim only fractional zeroes.
function formatPurchaseEth(raw) {
  const fixed = displayEth(BigInt(raw || 0));
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
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
  preferClaimable = true,
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
  try { price = BigInt(priceWei); } catch (_e) { price = 0n; }
  try { total = BigInt(totalCostWei); } catch (_e) { total = 0n; }
  try { mintCost = BigInt(mintCostWei); } catch (_e) { mintCost = 0n; }
  try { foilCost = BigInt(foilCostWei); } catch (_e) { foilCost = 0n; }
  try { presaleCost = BigInt(presaleCostWei); } catch (_e) { presaleCost = 0n; }

  let rebuy = 0n;
  if (price > 0n && total > 0n) {
    const payment = claimableFirstPayment(total, preferClaimable ? claimableWei : 0n);
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
      const freshForMint = payment.msgValueWei < mintCost
        ? payment.msgValueWei
        : mintCost;
      const mintClaimable = mintCost > freshForMint ? mintCost - freshForMint : 0n;
      rebuy = creditFor(presaleCost > 0n ? mintClaimable : payment.claimableUsedWei);
    }
  }

  return { purchase, bulk, rebuy, total: purchase + bulk + rebuy };
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

export function allInDestinations(currency, flipTicketsOpen = false) {
  if (String(currency).toUpperCase() === 'FLIP') {
    return ['coinflip', 'degenerette', ...(flipTicketsOpen ? ['tickets'] : [])];
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

/** ALL IN is an earned high-variance surface, unlocked above 60 Degen Score. */
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
  if (!allInDestinations(unit, flipTicketsOpen).includes(target)) {
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
    if (budget < LOOTBOX_MIN_WEI) return fail('At least 0.01 ETH is required for a lootbox.');
    outputLabel = '1 LOOTBOX';
  } else if (target === 'coinflip') {
    if (budget < ALL_IN_COINFLIP_MIN_WEI) return fail('At least 100 FLIP is required for Coinflip.');
    outputLabel = "TODAY'S COINFLIP";
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
  #storageListener = null;
  #questActivateListener = null;
  // --- Pinned data (server-derived; rendered via textContent) ---
  #gameState = null;   // Phase 64 — /game/state snapshot (level + jackpotPhaseFlag → ticket price)
  #purchaseQuote = null; // Exact purchaseInfo() buy-now route/price.
  #claimableWei = 0n;  // Acting player's indexed claimable balance (quote only).
  #claimableAddress = null;
  #claimableKnown = false;
  #degenScore = null;
  #degenScoreAddress = null;
  #flipBalanceWei = null;      // Acting player's spendable FLIP balance.
  #flipBalanceAddress = null;
  #coinflipClaimableWei = 0n; // Settled/mintable Coinflip FLIP.
  #coinflipClaimableAddress = null;
  #coinflipClaimableKnown = false;
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
  #pendingActions = [];       // Unseen ETH-capable RNG results mask the compact total.
  #claimableSpoilerOverrideKey = null;
  #claimableSpoilerHiddenKey = null;
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
    this.#wireEventHandlers();
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
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-total"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="dec-flip-balance-value"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-wallet"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-claimable"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-afking"]'));
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
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
  }

  // ---------------------------------------------------------------------
  // Render shell — STATIC innerHTML; T-58-18 hardening (no server data).
  // ---------------------------------------------------------------------

  #renderShell() {
    // Condensed shell: the purchase desk gets one short, useful identity line
    // without restoring the old blurb/level snapshot. The routed level and
    // price remain in the header. The lootbox leg is a single ETH-value input — there is no
    // per-box price; purchase()'s lootBoxAmount is a free ETH amount with a
    // 0.01 ETH floor.
    this.innerHTML = `
      <div class="panel app-decimator-panel">
        <div class="panel-header">
          <div class="dec-header-title">
            <h2 class="dec-purchase-heading">BUY IN</h2>
            <a class="dec-purchase-help" href="/learn/purchases/"
               aria-label="Learn about tickets, lootboxes, and foil packs"
               title="Learn about purchase options"><span aria-hidden="true">i</span></a>
          </div>
          <span class="dec-price" data-bind="dec-price">Price - —</span>
        </div>

        <!-- Account-switcher (2026-07-16): mode 'combined' shows the summed
             unclaimed decimator jackpot across the combined accounts (from
             app.playerCombined.decimator) — buying itself stays a per-account
             write (Buy CTA auto-disables via [data-write] + canSign). -->
        <div class="dec-combined-summary" data-bind="dec-combined-summary" hidden></div>

        <!-- Tickets + combined-buy lootbox leg share the compact desktop rail and
             become full-width touch rows on phones. The lootbox size is a free ETH
             amount (min 0.01) riding the same purchase() tx. Both default to 0;
             its ▲/▼ control steps by one live ticket price. -->
        <div class="dec-input-row dec-input-row--pair">
          <span class="dec-input-group dec-input-group--tickets">
            <label class="dec-input-label" for="dec-tickets-input">
              <span data-bind="dec-ticket-action-label">Buy tickets</span>
              <boon-product-indicator product="purchase"></boon-product-indicator>
            </label>
            <span class="dec-stepper">
              <span class="dec-quarter-stepper">
                <button type="button" class="dec-quarter-step" data-dir="1"
                        aria-label="Increase by 0.25 ticket" tabindex="-1">+.25</button>
                <button type="button" class="dec-quarter-step" data-dir="-1"
                        aria-label="Decrease by 0.25 ticket" tabindex="-1">−.25</button>
              </span>
              <input type="number" name="dec-tickets" id="dec-tickets-input"
                     class="dec-input" min="0" step="0.25" value="0"
                     inputmode="decimal">
              <span class="dec-stepper-btns">
                <button type="button" class="dec-step" data-step-for="dec-tickets" data-dir="1" aria-label="Increase by one whole ticket" tabindex="-1">▲</button>
                <button type="button" class="dec-step" data-step-for="dec-tickets" data-dir="-1" aria-label="Decrease by one whole ticket" tabindex="-1">▼</button>
              </span>
            </span>
          </span>
          <span class="dec-input-group dec-input-group--lootbox" data-bind="dec-lootbox-group">
            <label class="dec-input-label" for="dec-lootbox-eth-input">
              <span>Buy lootbox</span>
              <boon-product-indicator product="lootbox"></boon-product-indicator>
            </label>
            <span class="dec-stepper">
              <input type="number" name="dec-lootbox-eth" id="dec-lootbox-eth-input"
                     class="dec-input" min="0" step="0.01" value="0"
                     inputmode="decimal" aria-label="Buy lootbox amount in ETH">
              <span class="dec-stepper-btns">
                <button type="button" class="dec-step" data-step-for="dec-lootbox-eth" data-dir="1" aria-label="Increase lootbox size by one ticket price" tabindex="-1">▲</button>
                <button type="button" class="dec-step" data-step-for="dec-lootbox-eth" data-dir="-1" aria-label="Decrease lootbox size by one ticket price" tabindex="-1">▼</button>
              </span>
            </span>
          </span>
        </div>

        <!-- Optional foil leg: one compact add-on row. Detailed mechanics live
             on /learn/purchases/ so the transaction form stays scannable. -->
        <label class="dec-foil" data-bind="dec-foil-row" hidden>
          <!-- No data-write on the checkbox — panel convention keeps inputs
               enabled in view mode (the Buy CTA is the gated write control). -->
          <input type="checkbox" name="dec-foil" class="dec-foil-check" data-bind="dec-foil-check">
          <span class="dec-foil-label">Foil pack (limit 1)</span>
          <span class="dec-foil-price" data-bind="dec-foil-price">—</span>
        </label>

        <!-- Live credit-gated presale. A non-zero amount attaches the box to
             this normal purchase; with no other amount it uses the standalone
             presale-box selector. The regular purchase earns 25% box credit
             before the attached leg is checked on-chain. -->
        <div class="dec-presale" data-bind="dec-presale-row" hidden>
          <div class="dec-presale__label">
            <strong>PRESALE BOX</strong>
            <span data-bind="dec-presale-available">— ETH AVAILABLE</span>
          </div>
          <div class="dec-presale__controls">
            <input type="number" name="dec-presale-box-eth"
                   min="0" step="0.01" value="0"
                   inputmode="decimal" aria-label="Presale box amount in ETH">
            <span>ETH</span>
            <button type="button" data-bind="dec-presale-max">MAX</button>
          </div>
        </div>

        <!-- Stable half-and-half desktop action rail. On phones the optional bonus
             and primary action stack so BUY IN gets the whole tap width. -->
        <div class="dec-buy-row">
          <div class="dec-flip-credit" data-bind="dec-flip-credit" hidden>
            <img src="/whitepaper/flame-logo-split.svg" alt="">
            <span>BONUS</span>
            <strong data-bind="dec-flip-credit-total">+0 FLIP</strong>
          </div>
          <!-- CF-15: data-write triggers Phase 58 view-mode disable manager. -->
          <button type="button" class="dec-buy-cta" data-write data-bind="dec-buy-cta">
            <span class="dec-buy-cta__action" data-bind="dec-buy-cta-action">Buy in</span>
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

        <!-- Keep the FLIP ledger in the left action slot for the entire redemption
             window. Its embedded mode button and USE ETH both return to ETH mode. -->
        <div class="dec-funds-stack">
          <div class="dec-flip-balance" data-bind="dec-flip-balance" hidden
               aria-label="Available FLIP balance">
            <button type="button" class="dec-flip-toggle dec-flip-balance__mode"
                    data-bind="dec-funds-total-flip" aria-pressed="false" hidden>
              USE FLIP
            </button>
            <span class="dec-flip-balance__label">FLIP BALANCE</span>
            <strong class="dec-flip-balance__value">
              <span data-bind="dec-flip-balance-value">—</span>
              <span class="dec-flip-balance__unit">FLIP</span>
            </strong>
          </div>

          <button type="button" class="dec-all-in" data-bind="dec-all-in" disabled
                  aria-label="Use all available ETH for tickets">
            <strong class="dec-all-in__label">ALL IN</strong>
            <img class="dec-all-in__flame" src="/whitepaper/flame-center.svg"
                 alt="" aria-hidden="true">
          </button>

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
  }

  #wireEventHandlers() {
    const buyBtn = this.querySelector('[data-bind="dec-buy-cta"]');
    if (buyBtn) {
      buyBtn.addEventListener('click', (e) => (
        this.#flipModeEnabled() ? this.#onBuyWithFlipClick(e) : this.#onBuyClick(e)
      ));
    }
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
    const claimableValue = this.querySelector('[data-bind="dec-funds-claimable"]');
    const totalValue = this.querySelector('[data-bind="dec-funds-total"]');
    for (const value of [claimableValue, totalValue]) {
      if (!value) continue;
      value.addEventListener('click', (event) => this.#toggleClaimableSpoiler(event));
      value.addEventListener('keydown', (event) => this.#toggleClaimableSpoiler(event));
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
          this.#setBuyLabel('Buy in');
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
    // Live total-cost label on the Buy button as quantities change.
    for (const name of ['dec-tickets', 'dec-lootbox-eth', 'dec-presale-box-eth']) {
      const inp = this.querySelector(`[name="${name}"]`);
      if (inp && typeof inp.addEventListener === 'function') {
        inp.addEventListener('input', () => {
          if (name === 'dec-presale-box-eth' && Number(inp.value || 0) > 0) {
            // The deployed combined selector has no foil flag. Selecting a
            // presale box therefore exits the optional foil leg explicitly.
            const foil = this.querySelector('[data-bind="dec-foil-check"]');
            if (foil) foil.checked = false;
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
        this.#updateTotalLabel();
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
      if (price != null && price > 0n && target > 0n) {
        const entries = (target * BigInt(ENTRIES_PER_TICKET) + price - 1n) / price;
        ticketQuantity = Math.max(0.25, Number(entries) / ENTRIES_PER_TICKET);
      }
      return {
        kind: 'eth', ticketQuantity, lootBoxAmountWei: 0n,
        presaleBoxAmountWei: 0n, foilWanted: false,
      };
    }
    if ((questType === 1 && detail?.purchaseKind === 'lootbox') || questType === 6) {
      let amount = target;
      if (amount <= 0n && price != null) amount = questType === 6 ? price * 2n : price;
      if (amount < LOOTBOX_MIN_WEI) amount = LOOTBOX_MIN_WEI;
      return {
        kind: 'eth', ticketQuantity: 0, lootBoxAmountWei: amount,
        presaleBoxAmountWei: 0n, foilWanted: false,
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

  async #applyQuestPreset(detail) {
    const questType = Number(detail?.questType);
    if (![1, 4, 6, 9].includes(questType)) return false;

    const tickets = this.querySelector('[name="dec-tickets"]');
    const lootbox = this.querySelector('[name="dec-lootbox-eth"]');
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
        if (lootbox) lootbox.value = formatPurchaseEth(amount);
        focus = lootbox;
      } else {
        // Ticket choice: express the raw spend target as quarter-ticket entries.
        let wanted = 1;
        if (price != null && price > 0n && target > 0n) {
          const entries = (target * BigInt(ENTRIES_PER_TICKET) + price - 1n) / price;
          wanted = Math.max(0.25, Number(entries) / ENTRIES_PER_TICKET);
        }
        if (tickets) tickets.value = String(wanted);
        if (lootbox) lootbox.value = '0';
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
      if (lootbox) lootbox.value = formatPurchaseEth(amount);
      if (foil) foil.checked = false;
      if (flip) flip.checked = false;
      this.#renderPurchaseMode();
      focus = lootbox;
    } else if (questType === 4) {
      if (tickets) tickets.value = '0';
      if (lootbox) lootbox.value = '0';
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
      if (lootbox) lootbox.value = '0';
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

  #ethInputWei(name) {
    const raw = this.querySelector(`[name="${name}"]`)?.value ?? '0';
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return 0n;
    try { return BigInt(Math.round(amount * 1e18)) / ETH_DIVISOR; }
    catch (_e) { return 0n; }
  }

  #draftMintCostWei() {
    let total = this.#ethInputWei('dec-lootbox-eth');
    const price = this.#ticketPriceWei();
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
    if (includeAfking) {
      if (!this.#afkingFundingKnown || this.#afkingFundingAddress !== actingLower) return null;
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
      const afkingPendingWei = this.#afkingPendingFlipKnown
        && this.#afkingPendingFlipAddress === actingLower
        ? BigInt(this.#afkingPendingFlipWei)
        : 0n;
      return {
        walletWei,
        coinflipClaimableWei,
        afkingPendingWei,
        totalWei: walletWei + coinflipClaimableWei + afkingPendingWei,
      };
    } catch (_e) { return null; }
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
    const quote = allInSelectionQuote({
      ...selection,
      purchaseEthWei: this.#allInEthAvailableWei({ includeAfking: true }),
      degeneretteEthWei: this.#allInEthAvailableWei(),
      flipWei: flipSources?.totalWei ?? null,
      ticketPriceWei: this.#ticketPriceWei(),
      flipTicketsOpen: this.#flipBuyOpen,
      gasReady: this.#allInGasReady(),
    });
    if (quote.valid && flipSources) {
      quote.flipSources = flipSources;
      quote.fingerprint = [
        quote.fingerprint,
        flipSources.walletWei,
        flipSources.coinflipClaimableWei,
        flipSources.afkingPendingWei,
      ].join(':');
    }
    return quote;
  }

  #openAllInDialog() {
    if (this.#busy || get('ui.mode') !== 'self') return;
    const detail = {
      destinations: {
        ETH: allInDestinations('ETH'),
        FLIP: allInDestinations('FLIP', this.#flipBuyOpen),
      },
      quote: (selection) => this.#allInQuote(selection),
      confirm: (selection, fingerprint) => this.#confirmAllIn(selection, fingerprint),
    };
    try {
      this.dispatchEvent(new CustomEvent('app-all-in:open', { detail, bubbles: true }));
    } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }
  }

  async #confirmAllIn(selection, fingerprint) {
    if (this.#busy) throw new Error('Another purchase is already in progress.');
    const quote = this.#allInQuote(selection);
    if (!quote.valid) throw new Error(quote.message || 'ALL IN is unavailable.');
    if (fingerprint && quote.fingerprint !== fingerprint) {
      throw new Error('Your available balance changed. Review the updated ALL IN amount.');
    }
    if (quote.currency === 'FLIP') {
      const player = getActingAddress();
      const sources = quote.flipSources;
      if (sources?.afkingPendingWei > 0n) {
        await claimAfkingSubscriptionFlip();
      }
      // Coinflip deposits consume their settled ledger natively. Every other
      // FLIP route burns ERC-20 balance, so materialize that source first.
      if (quote.target !== 'coinflip' && sources?.coinflipClaimableWei > 0n) {
        await claimFlip({ player, amount: sources.coinflipClaimableWei });
      }
    }
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
    const questType = quote.target === 'coinflip'
      ? 2
      : quote.currency === 'ETH' ? 7 : 8;
    try {
      document.dispatchEvent(new CustomEvent('quest:activate', {
        detail: {
          questType,
          target: quote.spendWei,
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
    const input = this.querySelector('[name="dec-presale-box-eth"]');
    const availableEl = this.querySelector('[data-bind="dec-presale-available"]');
    const maxButton = this.querySelector('[data-bind="dec-presale-max"]');
    if (!row || !input || !availableEl || !maxButton) return;

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
    row.hidden = !visible;
    if (row.hidden) row.setAttribute?.('hidden', '');
    else row.removeAttribute?.('hidden');
    if (!visible) {
      if (foilSelected || flipMode || (live && available < PRESALE_BOX_MIN_WEI)) input.value = '0';
      if (this.#presaleState && this.#presaleAddress === buyerKey && !this.#presaleState.active) {
        input.value = '0';
      }
      return;
    }

    availableEl.textContent = `${formatPurchaseEth(available)} ETH AVAILABLE`;
    input.max = formatPurchaseEth(available);
    input.setAttribute?.('max', input.max);
    input.disabled = false;
    maxButton.disabled = available < PRESALE_BOX_MIN_WEI;
    const wanted = this.#presaleWantedWei();
    row.classList?.toggle('dec-presale--selected', wanted > 0n);
    row.classList?.toggle('dec-presale--over-limit', wanted > available);
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
    const actionText = String(action || 'Buy in');
    const amountText = String(amount || '');
    actionEl.textContent = actionText;
    amountEl.textContent = amountText;
    amountEl.hidden = !amountText;
    btn.setAttribute('aria-label', amountText ? `${actionText} ${amountText}` : actionText);
  }

  #updateTotalLabel() {
    const btn = this.querySelector('[data-bind="dec-buy-cta"]');
    if (!btn || this.#busy) return;
    // Tickets are divisible to the entry (0.25), so parseFloat — parseInt threw
    // away the fraction and quoted the wrong number.
    const tq = this.#ticketsWanted();
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
      this.#setBuyLabel(burn ? `Burn ${burn}` : 'Burn FLIP', output);
      this.#renderFlipCredit(null);
      return;
    }
    const boxFloat = Number(this.querySelector('[name="dec-lootbox-eth"]')?.value ?? '0') || 0;
    let totalWei = 0n;
    let mintCostWei = 0n;
    let foilCostWei = 0n;
    const priceWei = this.#ticketPriceWei();
    if (priceWei != null && tq > 0) mintCostWei += ticketCostFromTickets(priceWei, tq);
    if (boxFloat > 0) {
      try { mintCostWei += BigInt(Math.round(boxFloat * 1e18)) / ETH_DIVISOR; } catch (_e) { /* skip */ }
    }
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
    const hasPrimaryDraft = tq > 0 || boxFloat > 0 || this.#foilWanted();
    const action = presaleCostWei > 0n
      ? (hasPrimaryDraft ? 'Buy in + presale box' : 'Buy presale box')
      : 'Buy in';
    this.#setBuyLabel(action, amount);
    this.#renderFlipCredit({
      tickets: tq,
      priceWei,
      totalCostWei: totalWei,
      mintCostWei,
      foilCostWei,
      presaleCostWei,
      claimableWei: this.#claimableWei,
      preferClaimable: this.#preferClaimable,
    });
  }

  #renderFlipCredit(args) {
    const box = this.querySelector('[data-bind="dec-flip-credit"]');
    if (!box) return;
    const parts = args ? purchaseFlipCreditBreakdown(args) : null;
    const show = Boolean(
      args
      && args.priceWei != null
      && args.totalCostWei > 0n
      && parts
      && parts.total > 0n
    );
    box.hidden = !show;
    if (!show) return;

    const total = this.querySelector('[data-bind="dec-flip-credit-total"]');
    if (!total) return;
    total.textContent = `+${formatFlip(parts.total.toString())} FLIP`;
    total.classList?.toggle('is-zero', parts.total === 0n);
  }

  // ---------------------------------------------------------------------
  // Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED — NOT polling.js).
  // ---------------------------------------------------------------------

  #startPolling() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
    }
    if (typeof setInterval !== 'function') return;
    this.#pollHandle = _setIntervalUnref(() => this.#runPollCycle(), POLL_INTERVAL_MS);
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

    // Price and the acting player's claimable quote are independent. The
    // shared purchase helper re-reads claimable from chain at click time; this
    // indexed value exists only to explain the expected wallet/claimable split.
    const acting = getActingAddress();
    const actingLower = acting ? String(acting).toLowerCase() : null;
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
      this.#afkingPendingFlipWei = 0n;
      this.#afkingPendingFlipAddress = actingLower;
      this.#afkingPendingFlipKnown = false;
    }
    const connected = get('connected.address');
    const connectedLower = connected ? String(connected).toLowerCase() : null;
    const provider = getProvider();
    const walletBalancePromise = connectedLower && typeof provider?.getBalance === 'function'
      ? provider.getBalance(connectedLower)
      : Promise.resolve(null);
    const [
      gameResult,
      purchaseResult,
      playerResult,
      walletResult,
      coinflipResult,
      afkingFundingResult,
      afkingResult,
      presaleResult,
    ] = await Promise.allSettled([
      fetchJSON('/game/state'),
      readPurchaseQuote(),
      actingLower ? fetchJSON(`/player/${actingLower}`) : Promise.resolve(null),
      walletBalancePromise,
      actingLower ? readClaimableCoinflip({ player: actingLower }) : Promise.resolve(null),
      actingLower ? readAfkingFunding(actingLower) : Promise.resolve(null),
      actingLower ? readAfkingSubscription(actingLower) : Promise.resolve(null),
      actingLower ? readPresaleBoxState({ player: actingLower }) : Promise.resolve(null),
    ]);
    if (signal.aborted) return;

    if (gameResult.status === 'fulfilled' && gameResult.value) {
      this.#gameState = gameResult.value;
    }
    this.#purchaseQuote = purchaseResult.status === 'fulfilled'
      ? purchaseResult.value
      : null;
    if (playerResult.status === 'fulfilled' && playerResult.value && actingLower) {
      let claimable = 0n;
      try { claimable = BigInt(playerResult.value.claimableEth || '0'); } catch (_e) { claimable = 0n; }
      this.#claimableWei = claimable;
      this.#claimableAddress = actingLower;
      this.#claimableKnown = true;
      const score = Number(
        playerResult.value.scoreBreakdown?.totalBps
        ?? playerResult.value.activityScore,
      );
      this.#degenScore = Number.isFinite(score) ? score : null;
      this.#degenScoreAddress = actingLower;
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
    if (coinflipResult.status === 'fulfilled' && coinflipResult.value != null && actingLower) {
      try {
        this.#coinflipClaimableWei = BigInt(coinflipResult.value);
        this.#coinflipClaimableAddress = actingLower;
        this.#coinflipClaimableKnown = true;
      } catch (_e) { /* retain the indexed fallback */ }
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

    if (presaleResult.status === 'fulfilled'
      && presaleResult.value != null
      && this.#presaleAddress === actingLower) {
      this.#presaleState = presaleResult.value;
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
    }
    if (check) {
      check.disabled = !available || flipMode;
      if (!available || flipMode) check.checked = false;
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
    const buyRow = this.querySelector('.dec-buy-row');
    if (buyRow?.classList) buyRow.classList.toggle('dec-buy-row--flip', flipMode);
    const lootboxGroup = this.querySelector('[data-bind="dec-lootbox-group"]');
    const lootboxInput = this.querySelector('[name="dec-lootbox-eth"]');
    if (lootboxGroup) {
      lootboxGroup.hidden = flipMode;
      lootboxGroup.classList?.toggle('dec-input-group--disabled', flipMode);
    }
    if (lootboxInput) {
      lootboxInput.disabled = flipMode;
      if (flipMode) lootboxInput.value = '0';
    }
    for (const step of Array.from(this.querySelectorAll?.('.dec-step') || [])) {
      if (step.getAttribute?.('data-step-for') === 'dec-lootbox-eth') step.disabled = flipMode;
    }

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
    const acting = getActingAddress();
    const actingLower = acting ? String(acting).toLowerCase() : null;
    if (flipBalanceDisplay) {
      const showFlipBalance = this.#flipBuyOpen && get('ui.mode') !== 'combined';
      flipBalanceDisplay.hidden = !showFlipBalance;
      if (showFlipBalance) flipBalanceDisplay.removeAttribute?.('hidden');
      else flipBalanceDisplay.setAttribute?.('hidden', '');
    }
    updateBalanceDisplay(flipBalanceValue, {
      container: flipBalanceDisplay,
      scope: this.#flipBalanceAddress,
      value: this.#flipBalanceAddress === actingLower ? this.#flipBalanceWei : null,
      format: (raw) => formatFlip(String(raw)),
      formatDelta: (delta) => `+${formatFlip(String(delta))} FLIP`,
      hiddenText: '—',
    });

    let claimable = 0n;
    try {
      claimable = this.#claimableWei;
    } catch (_e) {
      // A malformed snapshot stays visibly unknown instead of breaking buys.
    }

    const spoilerOpen = this.#claimableSpoilerOpen();
    const spoilerKey = this.#claimableSpoilerKey();
    const forcedVisible = this.#claimableSpoilerOverrideKey === spoilerKey;
    const forcedHidden = this.#claimableSpoilerHiddenKey === spoilerKey;
    const displayOpen = !forcedHidden && (spoilerOpen || forcedVisible);
    const connected = get('connected.address');
    const connectedLower = connected ? String(connected).toLowerCase() : null;
    const walletKnown = this.#walletEthWei != null
      && this.#walletEthAddress === connectedLower;
    const fundingKnown = this.#afkingFundingKnown
      && this.#afkingFundingAddress === actingLower;
    const walletBalance = walletKnown ? BigInt(this.#walletEthWei) : null;
    const afkingBalance = fundingKnown ? BigInt(this.#afkingFundingWei) : null;
    const spendableClaimable = this.#claimableKnown && claimable > 1n ? claimable - 1n : 0n;
    const totalDisplayOpen = !forcedHidden && (
      forcedVisible || (spoilerOpen && !pendingMayChangeEth(this.#pendingActions))
    );
    const totalSpoiler = !totalDisplayOpen;
    const claimableHasFunds = this.#claimableKnown && spendableClaimable > 0n;
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
      showAllIn = get('ui.mode') !== 'combined'
        && this.#degenScoreAddress === actingLower
        && allInDegenScoreEligible(this.#degenScore);
      allIn.hidden = !showAllIn;
      if (allIn.hidden) allIn.setAttribute?.('hidden', '');
      else allIn.removeAttribute?.('hidden');
      allIn.disabled = this.#busy;
      allIn.setAttribute?.('aria-label', 'Open ALL IN choices');
      allIn.title = 'Choose a currency and where to go all in';
    }
    root.setAttribute?.('data-primary-funding', compactSource);
    const totalComplete = this.#claimableKnown && fundingKnown && walletKnown;
    const totalKnown = this.#claimableKnown || fundingKnown || walletKnown;
    const totalBalance = totalKnown
      ? (this.#claimableKnown ? spendableClaimable : 0n)
        + (fundingKnown ? afkingBalance : 0n)
        + (walletKnown ? walletBalance : 0n)
      : null;
    root.setAttribute?.('data-funds-complete', String(totalComplete));
    if (totalDisplay) {
      totalDisplay.hidden = this.#fundsExpanded;
      if (totalDisplay.hidden) totalDisplay.setAttribute?.('hidden', '');
      else totalDisplay.removeAttribute?.('hidden');
      totalDisplay.classList?.toggle('dec-funds__total--spoiler', totalSpoiler);
      totalDisplay.classList?.toggle('dec-funds__total--flip-active', flipMode);
      if (totalSpoiler) {
        totalDisplay.setAttribute?.(
          'aria-label',
          'Total available funds hidden until pending RNG results are viewed.',
        );
      } else {
        totalDisplay.removeAttribute?.('aria-label');
      }
    }
    if (totalValue) {
      totalValue.setAttribute('role', 'button');
      totalValue.setAttribute('tabindex', '0');
      const totalAction = totalDisplayOpen ? 'Hide available funds' : 'Show available funds';
      const totalLabel = totalComplete ? totalAction : `${totalAction}; some sources are still loading`;
      totalValue.setAttribute('title', totalLabel);
      totalValue.setAttribute('aria-label', totalLabel);
    }
    updateBalanceDisplay(totalValue, {
      container: totalDisplay,
      scope: `${actingLower || ''}:${connectedLower || ''}`,
      value: totalBalance,
      visible: !totalSpoiler,
      format: formatFundsEth,
      formatDelta: (delta) => `+${formatFundsEth(delta)} ETH`,
      hiddenText: '••••',
      revealDelay: 240,
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
      value: this.#claimableKnown ? spendableClaimable : null,
      visible: displayOpen,
      format: (raw) => raw === 0n ? '-' : formatFundsEth(raw),
      formatDelta: (delta) => `+${formatFundsEth(delta)} ETH`,
      hiddenText: '••••',
      // On unblur, hold the private pre-reveal balance for one short beat,
      // then show the newly-safe +ETH cue.
      revealDelay: 240,
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
    claimableDisplay?.classList?.toggle('dec-funds__display--spoiler', !displayOpen);
    claimableValue.removeAttribute('aria-hidden');
    claimableValue.setAttribute('role', 'button');
    claimableValue.setAttribute('tabindex', '0');
    claimableValue.setAttribute('title', displayOpen ? 'Hide claimable balance' : 'Show claimable balance');
    claimableValue.setAttribute('aria-label', displayOpen ? 'Hide claimable balance' : 'Show claimable balance');
    if (!displayOpen) {
      claimableDisplay?.setAttribute(
        'aria-label',
        'Claimable balance hidden. Activate the number to show it.',
      );
    } else {
      claimableDisplay?.removeAttribute('aria-label');
    }
    root.classList?.toggle('has-claimable', displayOpen && claimableHasFunds);
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

  #claimableSpoilerKey() {
    const day = get('app.daySync')?.day ?? get('app.lastDay')?.day ?? '';
    const address = getActingAddress() || '';
    return `${day}:${String(address).toLowerCase()}`;
  }

  #toggleClaimableSpoiler(event) {
    if (event?.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    try { event?.preventDefault?.(); } catch (_e) { /* fakeDOM */ }
    const key = this.#claimableSpoilerKey();
    const forcedVisible = this.#claimableSpoilerOverrideKey === key;
    const forcedHidden = this.#claimableSpoilerHiddenKey === key;
    const naturallyVisible = this.#claimableSpoilerOpen();
    const visible = forcedVisible || (!forcedHidden && naturallyVisible);
    this.#claimableSpoilerOverrideKey = visible ? null : key;
    this.#claimableSpoilerHiddenKey = visible ? key : null;
    this.#renderFundsFooter();
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

  async #onBuyWithFlipClick(e, options = {}) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    const allInFlow = options?.allIn === true;
    if (this.#busy) return false;
    const btn = this.querySelector('[data-bind="dec-buy-cta"]');
    const override = Number(options?.tickets);
    const tickets = Number.isFinite(override) && override > 0
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
    const fallback = activeTicketLevel(this.#gameState);
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
    const u5 = subscribe('app.lastDay', () => this.#renderFundsFooter());
    const u7 = subscribe('app.daySync', () => this.#renderFundsFooter());
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
    this.#unsubs.push(u1, u2, u3, u4, u5, u6, u7, u8);
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
    if (!priceEl) return;
    const priceWei = this.#ticketPriceWei();
    let priceText = 'Price - —';
    if (this.#flipModeEnabled()) {
      try {
        const price = `${formatFlip(flipCostFromTickets(1).toString())} FLIP`;
        priceText = `Price - ${price}`;
      } catch (_e) { priceText = 'Price - —'; }
    } else if (priceWei != null) {
      try {
        const price = `${formatPurchaseEth(priceWei)} ETH`;
        priceText = `Price - ${price}`;
      } catch (_e) { priceText = 'Price - —'; }
    }
    priceEl.textContent = priceText;
    // The lootbox is a variable-size ETH leg. One arrow press should add or
    // remove the same ETH amount as one ticket at the currently routed level.
    const lootboxInput = this.querySelector('[name="dec-lootbox-eth"]');
    if (lootboxInput && priceWei != null) {
      try {
        const step = formatPurchaseEth(priceWei);
        lootboxInput.step = step;
        lootboxInput.setAttribute?.('step', step);
      } catch (_e) { /* retain the safe 0.01 shell default */ }
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
      // Lootbox leg: a single ETH value (no per-box price). Convert the
      // input float to full-scale wei, then /1M-descale to the deployed
      // contract's wei scale (ETH_DIVISOR; 1n on mainnet) — same shape as
      // app-degenerette-panel's ETH amount handling.
      const boxInput = this.querySelector('[name="dec-lootbox-eth"]');
      // Missing/empty value reads as 0 (fakeDOM inputs have no .value until
      // assigned; browsers give '' for a cleared number input).
      const boxRaw = boxInput == null || boxInput.value == null
        || String(boxInput.value).trim() === '' ? '0' : String(boxInput.value);
      const boxFloat = Number(boxRaw);
      if (questPurchase == null && (!Number.isFinite(boxFloat) || boxFloat < 0)) {
        return rejectPurchase('Lootbox ETH must be 0 or at least 0.01.');
      }
      const lootBoxAmountWei = questPurchase?.lootBoxAmountWei == null
        ? (boxFloat > 0 ? BigInt(Math.round(boxFloat * 1e18)) / ETH_DIVISOR : 0n)
        : BigInt(questPurchase.lootBoxAmountWei);
      if (lootBoxAmountWei > 0n && lootBoxAmountWei < LOOTBOX_MIN_WEI) {
        return rejectPurchase('Minimum lootbox spend is 0.01 ETH.');
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
      if (ticketQuantity < 0 || (ticketQuantity <= 0 && lootBoxAmountWei <= 0n
        && presaleBoxAmountWei <= 0n && !foilWanted)) {
        return rejectPurchase('Enter tickets, a lootbox amount, a presale box amount, or select the foil pack.');
      }

      // Match lootbox.js's actual write target (self or the owner selected in
      // operator mode), so the deferred ticket reveal is recorded for the
      // account that receives the tickets.
      const buyer = getActingAddress();
      const affiliateCode = readAffiliateCode(CHAIN.id, buyer);
      let purchaseTicketPriceWei = this.#ticketPriceWei();

      // Phase 64: the funding helper needs the exact total cost before it can
      // spend claimable first and send only the wallet shortfall. Price comes
      // from /game/state level + phase. The lootbox leg
      // rides the SAME purchase() tx — its ETH value adds to the total
      // (user ask: buy lootboxes at the same time as tickets). The foil leg
      // (ten ticket prices, one per level) prices from the SAME fresh
      // snapshot — a level flip between quote and click would otherwise
      // quote the wrong claimable/wallet split.
      let ticketCostWei = 0n;
      let foilCostWei = 0n;
      if (ticketQuantity > 0 || foilWanted) {
        // Codex finding: a cached /game/state can cross a phase/level
        // boundary between polls — underpay silently pulls afking credit,
        // overpay silently credits it (no revert to save us). Refetch at
        // click time so the total and its wallet shortfall use fresh state.
        const [gameRead, quoteRead] = await Promise.allSettled([
          fetchJSON('/game/state'),
          readPurchaseQuote(),
        ]);
        if (gameRead.status === 'fulfilled' && gameRead.value) {
          this.#gameState = gameRead.value;
        }
        if (quoteRead.status === 'fulfilled') this.#purchaseQuote = quoteRead.value;
        // Never re-check indexed ownership here. purchaseEth immediately runs
        // the exact contract static-call with this level/value, which is both
        // fresher and authoritative.
        purchaseTicketPriceWei = this.#ticketPriceWei();
        if (purchaseTicketPriceWei == null) {
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
      }

      const mintCostWei = ticketCostWei + lootBoxAmountWei;
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

      const hasMintPurchase = ticketQuantity > 0 || lootBoxAmountWei > 0n || foilWanted;
      const hasRngBoxPurchase = lootBoxAmountWei > 0n || presaleBoxAmountWei > 0n;
      const onSubmitted = hasRngBoxPurchase
        ? (tx) => {
            submittedLootboxHash = String(tx?.hash || `local-${Date.now()}`).toLowerCase();
            submittedLootboxPlayer = String(buyer || '').toLowerCase();
            try {
              this.dispatchEvent(new CustomEvent('app-decimator:tx-submitted', {
                detail: {
                  player: buyer,
                  transactionHash: submittedLootboxHash,
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
            ticketQuantity, lootboxQuantity: 0, affiliateCode, ticketCostWei, lootBoxAmountWei,
            foil: foilWanted, foilCostWei, presaleBoxAmountWei,
            preferClaimable: questPurchase?.preferClaimable ?? this.#preferClaimable,
            useAfking: questPurchase?.useAfking ?? this.#useAfking,
            onSubmitted,
          });

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
        autoLegs = await enrichLootboxBoonLegs(autoLegs, {
          player: buyer,
          blockNumber: receipt?.blockNumber ?? null,
        });
        if (autoLegs.length > 0) {
          const autoBoxIndex = autoLegs.find(
            (leg) => leg?.legType === 'opened' && leg.lootboxIndex != null,
          )?.lootboxIndex;
          const transactionHash = receipt?.hash || receipt?.transactionHash || null;
          const releaseKey = transactionHash
            ? `tx:${String(transactionHash).toLowerCase()}`
            : null;
          recordLootboxTicketPacks({
            address: buyer,
            legs: autoLegs,
            sourceKey: releaseKey ? `lootbox:${releaseKey}` : null,
          }).catch(() => {});
          queueReveal({
            kind: 'lootbox',
            lootboxIndex: autoBoxIndex,
            amountWei: lootBoxAmountWei + presaleBoxAmountWei,
            ticketPriceWei: purchaseTicketPriceWei,
            legs: autoLegs,
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
