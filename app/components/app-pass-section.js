// /app/components/app-pass-section.js — Phase 62 Plan 62-02 (BUY-02 + BUY-03)
//
// Whale + Deity pass section. Custom Element shell mirrors Phase 60's
// app-packs-panel.js + Phase 61's app-claims-panel.js + Phase 62 Plan 62-01's
// app-decimator-panel.js: light DOM, idempotent customElements.define guard,
// symmetric connectedCallback / disconnectedCallback, #unsubs[] for store
// subscriptions, panel-owned 30s poll cycle (Phase 61 D-04 LOCKED — NOT
// polling.js's fictional generic API per RESEARCH Pitfall 9).
//
// On-chain surfaces:
//   BUY-02 — DegenerusGame.purchaseWhaleBundle(buyer, quantity) payable
//            via passes.js purchaseWhaleBundle({quantity, msgValueWei}).
//   BUY-03 — DegenerusGame.purchaseDeityPass(buyer, symbolId) payable
//            via passes.js purchaseDeityPass({symbolId, msgValueWei}).
//
// CONTEXT D-05 LOCKED: deity-pass click handler applies deityPassErrorOverride
// at the panel level — when the static-call gate or sendTx surfaces a
// `revert E()`, the panel renders inline error
//   "That symbol's taken — try another."
// and keeps the picker open with the selected symbol cleared so the user
// re-picks visibly. 10s auto-clear + clear-on-next-success-anywhere mirrors
// Phase 61 D-05 pattern.
//
// Carry-forwards (CONTEXT 62-CONTEXT.md):
//   CF-01: Phase 58 closure-form sendTx — flows through passes.js.
//   CF-02: Phase 56 reason-map decodeRevertReason on every catch.
//   CF-03: Phase 56 requireStaticCall pre-flight inside passes.js.
//   CF-06: Phase 61 D-05 NEVER optimistic balance subtraction. Pre-click
//          balance / pricing stays visible; 250ms post-confirm refetch via
//          #runPollCycle.
//   CF-07: T-58-18 — error.userMessage rendered via .textContent NOT innerHTML.
//   CF-15: data-write attributes stay on the transaction CTAs; the 32 Deity
//          tiles only choose a symbol and inherit the dialog's domain lock.
//
// Class palette: .pass-* prefix with sub-prefixes .pass-whale-* + .pass-deity-*.

import { CHAIN, ETH_DIVISOR } from '../app/chain-config.js';
import { displayEth } from '../app/scaling.js';
import { parseEther } from 'ethers';
import { get, update, subscribe, getViewedAddress, getActingAddress, deriveCanSign } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { readGameState } from '../app/game-state.js';
import {
  purchaseWhaleBundle,
  purchaseDeityPass,
  purchaseLazyPass,
  parsePassLootboxesFromReceipt,
  deityPassErrorOverride,
  readDeityPassCatalog,
  readAfkingSubscription,
  updateAfkingSubscription,
  fundAfkingSubscription,
  withdrawAfkingSubscriptionFunding,
  claimAfkingSubscriptionFlip,
} from '../app/passes.js';
import { scaledTicketPriceWei } from '../app/decimator.js';
import { activeTicketLevel } from '../app/active-level.js';
import { decodeRevertReason } from '../app/reason-map.js';
import { passBoonDiscountBps } from '../app/boons.js';
import './boon-product-indicator.js';

function passPurchaseConfirmationDetail(receipt, metadata = {}) {
  const parsed = parsePassLootboxesFromReceipt(receipt);
  const player = parsed[0]?.buyer || getActingAddress() || '';
  const owner = String(player).toLowerCase();
  const boxes = parsed
    .filter((box) => !owner || String(box.buyer || '').toLowerCase() === owner)
    .map((box) => ({
      index: Number(box.lootboxIndex),
      day: null,
      amountWei: box.amountWei,
      hasLootboxLeg: true,
      hasPresaleLeg: false,
    }));
  return {
    ...metadata,
    player,
    transactionHash: receipt?.hash || receipt?.transactionHash || null,
    boxes,
    lootBoxAmountWei: boxes.reduce((sum, box) => sum + BigInt(box.amountWei ?? 0), 0n),
    presaleBoxAmountWei: 0n,
  };
}

// Deity symbolId (0-31) → trait symbol: fullSymId = quadrant*8 + symIdx
// (JackpotModule.sol:1444-1446). Rendered as GOLD badges — "the real symbols"
// (user ask), color-agnostic since deity passes bind to a symbol, not a color.
const PASS_QUADRANTS = ['crypto', 'zodiac', 'cards', 'dice'];
const PASS_SYMBOLS = Object.freeze({
  crypto: ['xrp', 'tron', 'sui', 'monero', 'solana', 'chainlink', 'ethereum', 'bitcoin'],
  zodiac: ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'libra', 'sagittarius', 'aquarius'],
  cards:  ['club', 'diamond', 'heart', 'spade', 'horseshoe', 'cashsack', 'king', 'ace'],
  dice:   ['1', '2', '3', '4', '5', '6', '7', '8'],
});
const PASS_CARD_IDX = [3, 4, 5, 6, 0, 2, 1, 7];  // cards file-index remap — load-bearing

function passSymbolBadge(symbolId) {
  const q = (symbolId >> 3) & 3;
  const sym = symbolId & 7;
  const cat = PASS_QUADRANTS[q];
  const symbolSlug = PASS_SYMBOLS[cat][sym];
  const fileIdx = cat === 'cards' ? PASS_CARD_IDX[sym] : sym;
  return {
    path: `/badges-circular/${cat}_${String(fileIdx).padStart(2, '0')}_${symbolSlug}_gold.svg`,
    // The on-disk badge retains its historical `xrp` filename, but the
    // protocol trait and deity pass are player-facing WWXRP everywhere.
    name: `${cat} ${symbolSlug === 'xrp' ? 'WWXRP' : symbolSlug}`,
  };
}

// Lazy pass availability (WhaleModule.sol:431-438): levels 0-2, x9 (not x99),
// x0 (a century x00 only during its purchase phase). Boon holders can also
// buy off-window — the static-call gate resolves those; visibility uses the
// level rule only.
function lazyPassLevelOpen(level, jackpotPhaseFlag) {
  const lvl = Number(level);
  if (!Number.isFinite(lvl)) return false;
  if (lvl <= 2) return true;
  if (lvl % 10 === 9 && lvl % 100 !== 99) return true;
  if (lvl % 10 === 0 && !(lvl % 100 === 0 && jackpotPhaseFlag)) return true;
  return false;
}

// Client-side lazy pass price (WhaleModule.sol:454-475):
//   levels 0-2 → FLAT 0.24-ether benefit package (totalPrice = benefitValue;
//                the balance over base cost pays out as bonus tickets) —
//                codex-verified: summing priceForLevel here UNDERPAYS at 0-1;
//   levels 3+  → Σ priceForLevel(startLevel..+9), startLevel = level+1.
function lazyPassCostWei(level) {
  const lvl = Number(level);
  if (!Number.isFinite(lvl)) return null;
  if (lvl <= 2) return (24n * ETH_BASE_WEI) / 100n / ETH_DIVISOR;  // 0.24 ether, /1M-scaled
  const startLevel = lvl + 1;
  let total = 0n;
  for (let i = 0; i < 10; i += 1) {
    const p = scaledTicketPriceWei(startLevel + i);
    if (p == null) return null;
    total += p;
  }
  return total;
}

// Wraps setInterval with .unref() in Node.js (no-op in browsers). Used for the
// 30s poll tick so node:test processes exit cleanly when no other open handles
// remain. Verbatim port of app-decimator-panel.js _setIntervalUnref.
function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

function _setTimeoutUnref(fn, ms) {
  const h = setTimeout(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

// Keep component-owned business locks intact when view-mode-banner.js next
// refreshes every [data-write] control. Setting `.disabled` alone is racy: the
// global signer manager correctly re-enables writable controls and cannot know
// that this particular action is unavailable during RNG settlement.
function _setDomainWriteLock(control, locked, title = '') {
  if (!control) return;
  if (locked) {
    control.setAttribute('data-write-locked', '');
    control.setAttribute('data-write-lock-title', title || 'Action unavailable');
  } else {
    control.removeAttribute('data-write-locked');
    control.removeAttribute('data-write-lock-title');
  }
  control.disabled = Boolean(locked || !deriveCanSign());
  if (locked) control.title = title || 'Action unavailable';
  else {
    control.title = '';
    control.removeAttribute('title');
  }
}

const POLL_INTERVAL_MS = 30_000;       // Phase 56 D-04 / Phase 61 D-04 LOCKED.
const AFKING_LOCK_POLL_MS = 4_000;     // RNG locks are brief; don't leave stale controls for 30s.
const POST_CONFIRM_REFETCH_MS = 250;   // CF-06 — 250ms debounced refetch on tx confirm.
const ERROR_AUTO_CLEAR_MS = 10_000;    // 10s — mirrors Phase 61 D-05 pattern.
const DEBOUNCE_MS = 500;               // 500ms click debounce window.

// Documented price formulas (RESEARCH Open Q4). Whale: 2.4 ETH (lvl 0-3) or
// 4 ETH (lvl 4+) per quantity unit; deity: 24 ETH base + sum-of-prior. The
// panel computes msgValueWei from /player/:address currentLevel; if the data
// is unavailable we surface a "Loading price…" state and disable Buy CTAs.
// Sepolia uses /1M scaling per chain-config.sepolia.js ETH_DIVISOR (Phase 51 D).
const ETH_BASE_WEI = 10n ** 18n;

// Compute whale unit price (per-quantity msgValueWei). Returns null when the
// /player snapshot isn't loaded yet.
function computeWhaleUnitPriceWei(currentLevel, chainId) {
  if (currentLevel == null) return null;
  const lvl = Number(currentLevel);
  // Levels 0-3: 2.4 ETH; level 4+: 4 ETH (per CONTEXT D-01 documented formulas).
  const ethBase = lvl <= 3 ? (24n * ETH_BASE_WEI) / 10n : 4n * ETH_BASE_WEI;
  // Testnet /1M scaling (chain-config ETH_DIVISOR) on the active testnet chain.
  if (chainId === CHAIN.id) return ethBase / ETH_DIVISOR;
  return ethBase;
}

// Compute deity next-price. n = the authoritative number of minted deity-pass
// NFTs; the next price is 24 ETH + sum(1..n) ETH.
function computeDeityNextPriceWei(passesSold, chainId) {
  const n = Number(passesSold || 0);
  // 24 ETH base + sum(1..n) ETH = 24 + n*(n+1)/2 ETH.
  const ethBase = 24n * ETH_BASE_WEI;
  const ethPriorSum = (BigInt(n) * BigInt(n + 1) / 2n) * ETH_BASE_WEI;
  const total = ethBase + ethPriorSum;
  if (chainId === CHAIN.id) return total / ETH_DIVISOR;
  return total;
}

function _discountedWei(priceWei, discountBps) {
  if (priceWei == null) return null;
  const bps = Math.max(0, Math.min(10_000, Math.trunc(Number(discountBps) || 0)));
  return (BigInt(priceWei) * BigInt(10_000 - bps)) / 10_000n;
}

/** Contract-identical whole-price discount for Deity and Lazy passes. */
export function discountedPassPriceWei(basePriceWei, boonPayload, product) {
  return _discountedWei(basePriceWei, passBoonDiscountBps(boonPayload, product));
}

/**
 * WhaleModule applies a live boon to the first pass only and always uses the
 * standard 4 ETH unit on that branch. Every remaining pass is full-price 4 ETH.
 */
export function whalePassPurchasePriceWei({
  currentLevel,
  quantity = 1,
  boonPayload = null,
  chainId = CHAIN.id,
} = {}) {
  const qty = Math.trunc(Number(quantity));
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) return null;
  const unit = computeWhaleUnitPriceWei(currentLevel, chainId);
  if (unit == null) return null;
  const discountBps = passBoonDiscountBps(boonPayload, 'whale');
  if (discountBps <= 0) return BigInt(unit) * BigInt(qty);
  const standardUnit = chainId === CHAIN.id
    ? (4n * ETH_BASE_WEI) / ETH_DIVISOR
    : 4n * ETH_BASE_WEI;
  return _discountedWei(standardUnit, discountBps)
    + standardUnit * BigInt(qty - 1);
}

function formatPassEth(raw, digits = 2) {
  try {
    const formatted = displayEth(BigInt(raw ?? 0), digits);
    return formatted.replace(/(?:\.0+|(?:(\.\d*?[1-9]))0+)$/, '$1') || '0';
  } catch (_error) {
    return '0';
  }
}

// Buying any live pass floors both purchase-derived score components to their
// contract maxima (level streak 50 + mint count 25), then applies the pass's
// own 10/40/80-point bonus. Show the actual increase from the player's indexed
// components instead of advertising only component E.
export function projectedPassScoreGain(scoreBreakdown, passBonusPoints) {
  const finite = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const score = scoreBreakdown && typeof scoreBreakdown === 'object' ? scoreBreakdown : {};
  const currentPass = finite(score.passBonus?.points ?? score.passBonusPoints);
  return Math.max(0, 50 - finite(score.mintLevelStreakPoints))
    + Math.max(0, 25 - finite(score.mintCountPoints))
    + Math.max(0, finite(passBonusPoints) - currentPass);
}

/**
 * Infer how many live Whale-pass equivalents are represented by the indexed
 * future queue. One full pass is two half-pass units; each half-pass produces
 * one whole ticket per four-level cycle. Reading all four residue lanes keeps
 * odd jackpot awards exact instead of silently flooring (11 halves = 5½ passes).
 * Taking the lowest repeated whole-ticket count in each lane ignores one-off
 * ticket buys while preserving stacked Whale quantities.
 */
export function inferActiveWhalePassCount(tickets, currentLevel) {
  const level = Math.max(0, Math.trunc(Number(currentLevel) || 0));
  const lanes = [[], [], [], []];
  for (const row of Array.isArray(tickets) ? tickets : []) {
    const target = Math.trunc(Number(row?.level));
    const entries = Math.max(0, Math.trunc(Number(row?.entryCount) || 0));
    if (!Number.isInteger(target) || target <= level || target > level + 24 || entries < 4) continue;
    lanes[target & 3].push(Math.floor(entries / 4));
  }
  const repeated = lanes.filter((lane) => lane.length >= 3);
  // A single ordinary future ticket is not evidence of a Whale pass. Require
  // the repeating queue signature here; callers with an authoritative active
  // whale score can still fall back to one pass while the indexer catches up.
  if (repeated.length !== 4) return 0;
  const inferredHalfPasses = repeated.reduce((sum, lane) => sum + Math.min(...lane), 0);
  return Math.max(0, Math.min(200, inferredHalfPasses)) / 2;
}

function formatActiveWhalePassCount(count) {
  const halfPasses = Math.max(0, Math.round(Number(count || 0) * 2));
  const whole = Math.floor(halfPasses / 2);
  return halfPasses % 2 === 0 ? String(whole) : (whole ? `${whole}½` : '½');
}

/** Compact active premium-pass status for the closed AFKING drawer. */
export function activePassSummary(playerData, currentLevel) {
  const kind = String(playerData?.scoreBreakdown?.passBonus?.kind || '').toLowerCase();
  // Deity is the higher activity-score tier, so a player who owns both reports
  // `kind: deity` even though their Whale ticket streams remain active. Read
  // those streams independently instead of hiding the Whale passes behind the
  // Deity score label.
  const inferredWhales = inferActiveWhalePassCount(playerData?.tickets, currentLevel);
  if (kind === 'whale_100' || inferredWhales > 0) {
    const count = inferredWhales || 1;
    return {
      kind: 'whale',
      sigil: '100',
      label: `${formatActiveWhalePassCount(count)} ACTIVE WHALE PASS${count === 1 ? '' : 'ES'}`,
    };
  }
  if (kind === 'whale_10') {
    return { kind: 'lazy', sigil: '10', label: 'ACTIVE LAZY PASS' };
  }
  return null;
}

/** Exact subscription and prepaid-day copy used only by the closed drawer. */
export function afkingClosedSummary(state, mintPriceWei) {
  if (!state) return { subscription: null, funding: null, fundedDays: null };
  if (!state.active) {
    return {
      subscription: state.hasToken ? 'SUB INACTIVE' : null,
      funding: null,
      fundedDays: null,
    };
  }
  const quantity = Math.max(1, Math.trunc(Number(state.dailyQuantity) || 1));
  const product = state.settingsKnown
    ? (state.useTickets ? (quantity === 1 ? 'TICKET' : 'TICKETS') : 'LUCKBOX')
    : (quantity === 1 ? 'ITEM' : 'ITEMS');
  let fundedDays = null;
  try {
    const unit = BigInt(mintPriceWei ?? 0n);
    const daily = unit * BigInt(quantity);
    if (daily > 0n) fundedDays = BigInt(state.fundingWei ?? 0n) / daily;
  } catch (_error) { /* leave coverage unknown */ }
  return {
    subscription: `SUB ACTIVE: ${quantity} ${product}`,
    funding: `FUNDED FOR: ${fundedDays == null ? '\u2014' : fundedDays} ${fundedDays === 1n ? 'DAY' : 'DAYS'}`,
    fundedDays,
  };
}

class AppPassSection extends HTMLElement {
  // --- Phase 60 / 61 / 62-01 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  #busyWhale = false;
  #busyLazy = false;
  #busyAfking = false;
  #busyAfkingFunding = false;
  #busyAfkingWithdrawal = false;
  #busyAfkingClaim = false;
  // Per-symbol-id debounce for the deity grid (T-62-02-05 mitigation).
  #busySymbols = new Set();
  #errorTimerWhale = null;
  #errorTimerDeity = null;
  #errorTimerLazy = null;
  #errorTimerAfking = null;
  // --- Panel-owned 30s poll lifecycle (Phase 61 D-04 LOCKED — NOT polling.js) ---
  #pollHandle = null;
  #pollController = null;
  #afkingLockPollHandle = null;
  #lastPollAt = 0;
  #visibilityListener = null;
  // --- Pinned data from /player/:address (server-derived; rendered via textContent) ---
  #playerData = null;
  #pinnedAddress = null;
  // Cached pricing snapshot for click-time msgValueWei computation.
  #pricingData = null;
  // Full game state is retained so AFKing pricing can fall back to the same
  // active-ticket-level calculation as the purchase widget when the batched
  // contract snapshot is temporarily unavailable.
  #gameState = null;
  // Canonical 32-symbol catalog from the soulbound deity-pass NFT. null means
  // availability is unknown, never "all symbols available".
  #deityCatalog = null;
  // Authoritative token + GAME subscription snapshot. Pass buyers can have a
  // claimable free seat before balanceOf turns positive, so either state may
  // surface the editor.
  #afkingState = null;
  #afkingFormAddress = null;
  #afkingFundingSeededAddress = null;
  #afkingTopupSeededAddress = null;
  #afkingDialogOpen = false;
  #deityDialogOpen = false;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#renderDeityPicker();
    this.#wireEventHandlers();
    this.#wireVisibilityRePoll();
    this.#wireStoreSubscriptions();
    this.#renderCombinedGate();
    this.#startPolling();
    // Eager first cycle on mount — no need to wait 30s.
    this.#runPollCycle();
  }

  disconnectedCallback() {
    if (this.#pollHandle != null) {
      try { clearInterval(this.#pollHandle); } catch (_) { /* defensive */ }
      this.#pollHandle = null;
    }
    if (this.#pollController) {
      try { this.#pollController.abort(); } catch (_) { /* defensive */ }
      this.#pollController = null;
    }
    if (this.#afkingLockPollHandle != null) {
      try { clearTimeout(this.#afkingLockPollHandle); } catch (_) { /* defensive */ }
      this.#afkingLockPollHandle = null;
    }
    if (this.#visibilityListener
      && typeof document !== 'undefined'
      && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this.#visibilityListener); }
      catch (_) { /* defensive */ }
    }
    this.#visibilityListener = null;
    this.#deityDialogOpen = false;
    if (this.#errorTimerWhale != null) {
      try { clearTimeout(this.#errorTimerWhale); } catch (_) { /* defensive */ }
      this.#errorTimerWhale = null;
    }
    if (this.#errorTimerDeity != null) {
      try { clearTimeout(this.#errorTimerDeity); } catch (_) { /* defensive */ }
      this.#errorTimerDeity = null;
    }
    if (this.#errorTimerLazy != null) {
      try { clearTimeout(this.#errorTimerLazy); } catch (_) { /* defensive */ }
      this.#errorTimerLazy = null;
    }
    if (this.#errorTimerAfking != null) {
      try { clearTimeout(this.#errorTimerAfking); } catch (_) { /* defensive */ }
      this.#errorTimerAfking = null;
    }
    this.#busySymbols.clear();
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
  }

  // ---------------------------------------------------------------------
  // Render shell — STATIC innerHTML; T-58-18 hardening (no server data).
  // ---------------------------------------------------------------------

  #renderShell() {
    this.innerHTML = `
      <section class="panel app-pass-section">
        <!-- Account-switcher (2026-07-16): pass purchases are per-account
             writes with no combined-view analog — hidden alongside the buy
             rows in mode 'combined' (see #renderCombinedGate). -->
        <p class="pass-combined-note" data-bind="pass-combined-note" hidden></p>

        <!-- LAZY ROW — visible ONLY when the level window is open
             (levels 0-2 / x9 / x0; WhaleModule.sol:431-438). It is the
             shorter commitment, so it leads the premium-product shelf. -->
        <div class="pass-lazy-row pass-product-row pass-product-row--lazy" data-bind="pass-lazy-row" hidden>
          <span class="pass-product-heading">
            <span class="pass-product-sigil pass-product-sigil--lazy" aria-hidden="true">10</span>
            <span class="pass-product-copy">
              <span class="pass-section-title">Lazy pass</span>
              <span class="pass-product-description">One ticket every level for the next 10 levels.</span>
            </span>
          </span>
          <span class="pass-product-perks" aria-label="Lazy pass benefits">
            <span class="pass-lootbox-perk pass-lazy-lootbox-perk" data-bind="pass-lazy-lootbox">BONUS LUCKBOX · 10% OF PASS</span>
            <span data-bind="pass-lazy-score">+85% DEGEN RATING</span>
            <span data-bind="pass-lazy-afking-seat">AFKING SEAT</span>
          </span>
          <span class="pass-product-checkout pass-product-checkout--lazy">
            <boon-product-indicator class="pass-cost-boon" product="lazy"></boon-product-indicator>
            <button type="button" class="pass-lazy-buy" data-write data-bind="pass-lazy-buy">
              BUY LAZY PASS
              …
            </button>
          </span>
        </div>
        <div class="pass-lazy-error" data-bind="pass-lazy-error" hidden role="alert"></div>

        <!-- WHALE ROW -->
        <div class="pass-whale-row pass-product-row pass-product-row--whale">
          <span class="pass-product-heading">
            <span class="pass-product-sigil pass-product-sigil--whale" aria-hidden="true">100</span>
            <span class="pass-product-copy">
              <span class="pass-section-title">Whale pass</span>
              <span class="pass-product-description">One ticket every other level for the next 100 levels.</span>
            </span>
          </span>
          <span class="pass-product-perks" aria-label="Whale pass benefits">
            <span class="pass-lootbox-perk pass-whale-lootbox-perk" data-bind="pass-whale-lootbox">BONUS LUCKBOX · 10% OF PASS</span>
            <span data-bind="pass-whale-score">+115% DEGEN RATING</span>
            <span class="pass-whale-afking-seat" data-bind="pass-whale-afking-seat">AFKING SEAT</span>
          </span>
          <span class="pass-product-checkout pass-product-checkout--whale">
            <span class="pass-product-quantity">
              <small>QTY</small>
              <input type="number" name="pass-whale-qty" id="pass-whale-qty-input"
                     class="pass-whale-input" min="1" max="100" step="1" value="1"
                     inputmode="numeric" pattern="[0-9]*" aria-label="Whale pass quantity">
              <span class="pass-whale-steps">
                <button type="button" data-bind="pass-whale-qty-down" aria-label="Decrease Whale pass quantity">−</button>
                <button type="button" data-bind="pass-whale-qty-up" aria-label="Increase Whale pass quantity">+</button>
              </span>
              </span>
            <boon-product-indicator class="pass-cost-boon" product="whale"></boon-product-indicator>
            <button type="button" class="pass-whale-buy" data-write data-bind="pass-whale-buy">
              BUY WHALE PASS
              …
            </button>
          </span>
        </div>
        <div class="pass-whale-error" data-bind="pass-whale-error" hidden role="alert"></div>

        <!-- DEITY PASS — the shelf stays concise; symbol selection happens in
             a focused purchase dialog instead of spilling across the row. -->
        <section class="pass-deity-section" data-bind="pass-deity-details">
          <div class="pass-deity-summary" data-bind="pass-deity-summary">
            <span class="pass-product-heading pass-product-heading--deity">
              <span class="pass-product-copy">
                <span class="pass-deity-title-lockup">
                  <span class="deity-pass-lockup pass-deity-wordmark">
                    <img class="deity-pass-lockup__symbol" data-bind="pass-deity-brand-symbol"
                         src="" alt="" aria-hidden="true" hidden>
                    <img class="deity-pass-lockup__frame"
                         src="/app/assets/deity-pass-lockup-v3.webp"
                         width="1400" height="320" alt="Deity Pass">
                  </span>
                </span>
                <span class="pass-product-description">15 entries every level and three boons per day forever.</span>
              </span>
            </span>
            <span class="pass-product-perks pass-product-perks--deity" aria-label="Deity pass benefits">
              <span class="pass-lootbox-perk pass-deity-lootbox-perk"
                    data-bind="pass-deity-lootbox">BONUS LUCKBOX · 10% OF PASS</span>
              <span data-bind="pass-deity-score">+155% DEGEN RATING</span>
              <span data-bind="pass-deity-afking-seat">AFKING SEAT</span>
            </span>
            <span class="pass-cost-action pass-deity-open-wrap">
              <boon-product-indicator class="pass-cost-boon" product="deity"></boon-product-indicator>
              <button type="button" class="pass-deity-open" data-bind="pass-deity-open"
                      aria-haspopup="dialog" aria-expanded="false">BUY DEITY PASS
                …</button>
            </span>
          </div>

          <div class="pass-deity-dialog" data-bind="pass-deity-dialog" hidden
               role="dialog" aria-modal="true" aria-labelledby="pass-deity-dialog-title"
               tabindex="-1">
            <div class="pass-deity-dialog__card">
              <header class="pass-deity-dialog__head">
                <span>
                  <span class="deity-pass-lockup pass-deity-dialog__wordmark" aria-hidden="true">
                    <img class="deity-pass-lockup__symbol" data-bind="pass-deity-brand-symbol"
                         src="" alt="" hidden>
                    <img class="deity-pass-lockup__frame"
                         src="/app/assets/deity-pass-lockup-v3.webp"
                         width="1400" height="320" alt="">
                  </span>
                  <strong id="pass-deity-dialog-title">CHOOSE YOUR DEITY</strong>
                </span>
                <button type="button" class="pass-deity-dialog__close"
                        data-bind="pass-deity-dialog-close" aria-label="Close deity symbol picker">×</button>
              </header>

              <div class="pass-deity-dialog__selection" aria-live="polite">
              <span class="pass-deity-preview" aria-hidden="true">
                <img data-bind="pass-deity-preview" src="" alt="">
              </span>
                <span>
                  <small>SELECTED</small>
                  <strong data-bind="pass-deity-selected-name">—</strong>
                </span>
              </div>

              <div class="pass-deity-symbol-groups" data-bind="pass-deity-symbol-grid"
                   aria-label="Available deity pass symbols"></div>
              <select class="pass-deity-select" name="pass-deity-symbol"
                      data-bind="pass-deity-select" aria-label="Selected deity pass symbol"
                      hidden tabindex="-1"></select>
              <div class="pass-deity-error" data-bind="pass-deity-error" hidden role="alert"></div>
              <span class="pass-cost-action pass-deity-buy-wrap">
                <boon-product-indicator class="pass-cost-boon" product="deity"></boon-product-indicator>
                <button type="button" class="pass-deity-buy" data-write data-bind="pass-deity-buy">BUY DEITY PASS
                  …</button>
              </span>
            </div>
          </div>
        </section>
      </section>

      <!-- AFKING SUBSCRIPTION is its own compact instrument below the premium
           passes. Day-to-day state, funding, and claims stay in view; initial
           setup and infrequent settings live in a focused popup. -->
      <section class="panel pass-afking" data-bind="pass-afking" hidden>
        <div class="pass-afking__head">
          <span class="pass-product-heading">
            <span class="pass-product-sigil pass-product-sigil--afking" aria-hidden="true">AUTO</span>
            <span class="pass-product-copy">
              <span class="pass-section-title">AFKING SUBSCRIPTION</span>
              <strong class="pass-afking__current" data-bind="pass-afking-current">NO AUTOMATIC ORDER</strong>
              <span class="pass-afking__policy" data-bind="pass-afking-policy" hidden></span>
            </span>
          </span>
          <strong class="pass-afking__status" data-bind="pass-afking-status">READY</strong>
        </div>
        <div class="pass-afking__quick">
          <span class="pass-afking__balance">
            <small>PREPAID</small>
            <span class="pass-afking__funding" data-bind="pass-afking-funding">—</span>
          </span>
          <div class="pass-afking__topup" data-bind="pass-afking-topup" hidden>
            <label class="pass-afking__topup-field">
              <span>TOP UP</span>
              <input type="number" name="pass-afking-topup" min="0" step="0.01" value="0"
                     inputmode="decimal" aria-label="AFKING top up amount in ETH">
              <small>ETH</small>
            </label>
            <button type="button" class="pass-afking__fund-button" data-write
                    data-bind="pass-afking-fund-button">TOP UP</button>
          </div>
          <button type="button" class="pass-afking__claim-button" data-write
                  data-bind="pass-afking-flip-claim" hidden>CLAIM</button>
          <button type="button" class="pass-afking__edit" data-bind="pass-afking-edit"
                  aria-haspopup="dialog" aria-expanded="false">SET UP</button>
        </div>
        <div class="pass-afking-error pass-afking-error--inline" data-bind="pass-afking-error" hidden role="alert"></div>

        <div class="pass-afking__dialog" data-bind="pass-afking-dialog" hidden
             role="dialog" aria-modal="true" aria-labelledby="pass-afking-dialog-title">
          <div class="pass-afking__dialog-card">
            <header class="pass-afking__dialog-head">
              <span>
                <small>AFKING SUBSCRIPTION</small>
                <strong id="pass-afking-dialog-title" data-bind="pass-afking-dialog-title">SET UP</strong>
              </span>
              <span class="pass-afking__dialog-state" data-bind="pass-afking-dialog-state">READY</span>
            </header>
            <div class="pass-afking__lock" data-bind="pass-afking-lock" hidden role="status">
              <strong>RNG SETTLING</strong>
              <span>Settings unlock automatically. Top ups and claims stay open.</span>
            </div>
            <div class="pass-afking__controls" data-bind="pass-afking-controls" hidden>
              <section class="pass-afking__control-card pass-afking__order-card">
                <header class="pass-afking__control-head">
                  <span>DAILY ORDER</span>
                  <strong>Automatic order</strong>
                  <small>Runs automatically once per day.</small>
                </header>
                <div class="pass-afking__order-fields">
                  <label class="pass-afking__field">
                    <span>Product</span>
                    <select name="pass-afking-mode" data-bind="pass-afking-mode">
                      <option value="lootbox">Luckbox</option>
                      <option value="tickets">Tickets</option>
                    </select>
                  </label>
                  <label class="pass-afking__field pass-afking__field--qty">
                    <span>Quantity</span>
                    <input type="number" name="pass-afking-qty" min="1" max="255" step="1" value="1">
                  </label>
                </div>
              </section>
              <section class="pass-afking__control-card pass-afking__funding-card" data-bind="pass-afking-initial-funding">
                <header class="pass-afking__control-head">
                  <span>STARTING BALANCE</span>
                  <strong>Initial funding</strong>
                  <small>You can top up from the main card after setup.</small>
                </header>
                <label class="pass-afking__field pass-afking__field--fund">
                  <span>Add funds</span>
                  <input type="number" name="pass-afking-fund" min="0" step="0.01" value="0" inputmode="decimal">
                  <small>ETH</small>
                </label>
              </section>
              <label class="pass-afking__credit">
                <input type="checkbox" name="pass-afking-claimable-first" checked>
                <span>Use claimable ETH before prepaid funds</span>
              </label>
              <span class="pass-afking__costs">
                <span class="pass-afking__day-cost" data-bind="pass-afking-day-cost">—</span>
                <span class="pass-afking__coverage" data-bind="pass-afking-coverage">—</span>
              </span>
              <div class="pass-afking-error pass-afking-error--dialog"
                   data-bind="pass-afking-dialog-error" hidden role="alert"></div>
              <div class="pass-afking__actions">
                <button type="button" class="pass-afking__withdraw" data-write
                        data-bind="pass-afking-withdraw" hidden>WITHDRAW ALL</button>
                <button type="button" class="pass-afking__cancel" data-write
                        data-bind="pass-afking-cancel" hidden>CANCEL SUBSCRIPTION</button>
                <button type="button" class="pass-afking__dialog-close"
                        data-bind="pass-afking-dialog-close">BACK</button>
                <button type="button" class="pass-afking__save" data-write
                        data-bind="pass-afking-save">START</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  #renderDeityPicker() {
    const select = this.querySelector('[data-bind="pass-deity-select"]');
    if (select) {
      select.disabled = true;
      select.setAttribute('data-write-locked', '');
      select.setAttribute('data-write-lock-title', 'Checking symbol availability');
    }
    for (const control of [
      this.querySelector('[data-bind="pass-deity-open"]'),
      this.querySelector('[data-bind="pass-deity-buy"]'),
    ]) {
      if (!control) continue;
      control.disabled = true;
      control.setAttribute('data-write-locked', '');
      control.setAttribute('data-write-lock-title', 'Checking symbol availability');
    }
  }

  #wireEventHandlers() {
    const whaleBuy = this.querySelector('[data-bind="pass-whale-buy"]');
    if (whaleBuy) whaleBuy.addEventListener('click', (e) => this.#onWhaleBuyClick(e));
    const whaleQty = this.querySelector('[name="pass-whale-qty"]');
    const updateWhaleQty = () => {
      this.#renderWhaleLootboxBenefit();
      this.#renderWhaleBuyLabel();
    };
    if (whaleQty) whaleQty.addEventListener('input', updateWhaleQty);
    for (const [bind, delta] of [['pass-whale-qty-up', 1], ['pass-whale-qty-down', -1]]) {
      const step = this.querySelector(`[data-bind="${bind}"]`);
      if (step) step.addEventListener('click', () => {
        const current = Number.parseInt(whaleQty?.value || '1', 10) || 1;
        if (whaleQty) whaleQty.value = String(Math.min(100, Math.max(1, current + delta)));
        updateWhaleQty();
      });
    }
    const lazyBuy = this.querySelector('[data-bind="pass-lazy-buy"]');
    if (lazyBuy) lazyBuy.addEventListener('click', (e) => this.#onLazyBuyClick(e));
    const deityOpen = this.querySelector('[data-bind="pass-deity-open"]');
    if (deityOpen) deityOpen.addEventListener('click', (e) => this.#openDeityDialog(e));
    const deityBuy = this.querySelector('[data-bind="pass-deity-buy"]');
    if (deityBuy) deityBuy.addEventListener('click', (e) => this.#onDeityBuyClick(e));
    const deitySelect = this.querySelector('[data-bind="pass-deity-select"]');
    if (deitySelect) deitySelect.addEventListener('change', () => this.#renderDeityPreview());
    const deityDialogClose = this.querySelector('[data-bind="pass-deity-dialog-close"]');
    if (deityDialogClose) {
      deityDialogClose.addEventListener('click', (e) => this.#closeDeityDialog(e));
    }
    const deityDialog = this.querySelector('[data-bind="pass-deity-dialog"]');
    if (deityDialog) {
      deityDialog.addEventListener('click', (e) => {
        if (e?.target === e?.currentTarget) this.#closeDeityDialog(e);
      });
      deityDialog.addEventListener('keydown', (e) => {
        if (e?.key === 'Escape') this.#closeDeityDialog(e);
      });
    }
    const afkingSave = this.querySelector('[data-bind="pass-afking-save"]');
    if (afkingSave) afkingSave.addEventListener('click', (e) => this.#onAfkingSave(e));
    const afkingCancel = this.querySelector('[data-bind="pass-afking-cancel"]');
    if (afkingCancel) afkingCancel.addEventListener('click', (e) => this.#onAfkingCancel(e));
    const afkingQty = this.querySelector('[name="pass-afking-qty"]');
    if (afkingQty) afkingQty.addEventListener('input', () => this.#renderAfkingDayCost());
    const afkingMode = this.querySelector('[data-bind="pass-afking-mode"]');
    if (afkingMode) afkingMode.addEventListener('change', () => this.#renderAfkingDayCost());
    const afkingFund = this.querySelector('[name="pass-afking-fund"]');
    if (afkingFund) afkingFund.addEventListener('input', () => this.#renderAfkingDayCost());
    const afkingTopup = this.querySelector('[name="pass-afking-topup"]');
    if (afkingTopup) afkingTopup.addEventListener('input', () => this.#renderAfkingTopup());
    const afkingFundButton = this.querySelector('[data-bind="pass-afking-fund-button"]');
    if (afkingFundButton) afkingFundButton.addEventListener('click', (e) => this.#onAfkingFund(e));
    const afkingWithdraw = this.querySelector('[data-bind="pass-afking-withdraw"]');
    if (afkingWithdraw) afkingWithdraw.addEventListener('click', (e) => this.#onAfkingWithdraw(e));
    const afkingFlipClaim = this.querySelector('[data-bind="pass-afking-flip-claim"]');
    if (afkingFlipClaim) afkingFlipClaim.addEventListener('click', (e) => this.#onAfkingFlipClaim(e));
    const afkingEdit = this.querySelector('[data-bind="pass-afking-edit"]');
    if (afkingEdit) afkingEdit.addEventListener('click', (e) => this.#openAfkingDialog(e));
    const afkingDialogClose = this.querySelector('[data-bind="pass-afking-dialog-close"]');
    if (afkingDialogClose) afkingDialogClose.addEventListener('click', (e) => this.#closeAfkingDialog(e));
    const afkingDialog = this.querySelector('[data-bind="pass-afking-dialog"]');
    if (afkingDialog) {
      afkingDialog.addEventListener('click', (e) => {
        if (e?.target === e?.currentTarget) this.#closeAfkingDialog(e);
      });
      afkingDialog.addEventListener('keydown', (e) => {
        if (e?.key === 'Escape') this.#closeAfkingDialog(e);
      });
    }
  }

  #openDeityDialog(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    const opener = this.querySelector('[data-bind="pass-deity-open"]');
    const dialog = this.querySelector('[data-bind="pass-deity-dialog"]');
    if (!dialog || opener?.disabled || this.#ownedDeitySymbolId() != null) return;
    this.#deityDialogOpen = true;
    dialog.hidden = false;
    opener?.setAttribute('aria-expanded', 'true');
    this.#clearDeityError();
    this.#renderDeityPreview();
    try { dialog.focus?.({ preventScroll: true }); } catch (_) { /* defensive */ }
  }

  #closeDeityDialog(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    const dialog = this.querySelector('[data-bind="pass-deity-dialog"]');
    const opener = this.querySelector('[data-bind="pass-deity-open"]');
    this.#deityDialogOpen = false;
    if (dialog) dialog.hidden = true;
    opener?.setAttribute('aria-expanded', 'false');
    this.#clearDeityError();
    try { opener?.focus?.({ preventScroll: true }); } catch (_) { /* defensive */ }
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

    try {
      const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
        || get('viewing.address')
        || get('connected.address')
        || null;
      const actionTarget = getActingAddress() || addr;
      if (String(addr || '').toLowerCase() !== String(this.#pinnedAddress || '').toLowerCase()) {
        this.#afkingFormAddress = null;
        this.#afkingFundingSeededAddress = null;
        this.#afkingTopupSeededAddress = null;
        this.#afkingDialogOpen = false;
        this.#deityDialogOpen = false;
        // A verified snapshot may survive a transient RPC failure, but it must
        // never survive an account switch.
        this.#afkingState = null;
      }
      this.#pinnedAddress = addr;
      // Level comes from /game/state. Deity availability and issued count come
      // from the pass NFT, because /player has neither a global count nor the
      // 32-symbol ownership catalog.
      const [stateRes, playerRes, deityRes, afkingRes] = await Promise.allSettled([
        readGameState(),
        addr ? fetchJSON(`/player/${addr}`) : Promise.resolve(null),
        readDeityPassCatalog(),
        actionTarget ? readAfkingSubscription(actionTarget) : Promise.resolve(null),
      ]);
      if (signal.aborted) return;
      const gs = stateRes.status === 'fulfilled' ? stateRes.value : null;
      const data = playerRes.status === 'fulfilled' ? playerRes.value : null;
      const freshCatalog = deityRes.status === 'fulfilled' ? deityRes.value : null;
      if (freshCatalog) this.#deityCatalog = freshCatalog;
      const afkingReadKnown = afkingRes.status === 'fulfilled' && afkingRes.value != null;
      // Keep the last verified state for this same account when a core AFKing
      // RPC read blips. readAfkingSubscription() returns null rather than fake
      // zero balances, so replacing here would make the panel flicker and lose
      // the player's last trustworthy funding value.
      if (afkingReadKnown) this.#afkingState = afkingRes.value;
      this.#playerData = data || null;
      this.#gameState = gs;
      const level = gs?.level ?? data?.level ?? data?.currentLevel ?? null;
      const jackpotPhase = Boolean(gs?.jackpotPhaseFlag ?? (gs?.phase === 'JACKPOT'));
      this.#pricingData = {
        currentLevel: level,
        whaleUnitPriceWei: computeWhaleUnitPriceWei(level, CHAIN.id),
        deityNextPriceWei: this.#deityCatalog
          ? computeDeityNextPriceWei(this.#deityCatalog.issuedCount, CHAIN.id)
          : null,
        lazyOpen: lazyPassLevelOpen(level, jackpotPhase),
        lazyCostWei: lazyPassCostWei(level),
      };
      if (afkingReadKnown && this.#afkingState) {
        const coverage = afkingClosedSummary(this.#afkingState, this.#afkingMintPriceWei());
        update('app.afkingSubscription', Object.freeze({
          address: String(actionTarget || '').toLowerCase() || null,
          known: true,
          active: Boolean(this.#afkingState.active),
          fundedDays: coverage.fundedDays,
          dailyQuantity: Math.max(1, Math.trunc(Number(this.#afkingState.dailyQuantity) || 1)),
          settingsKnown: Boolean(this.#afkingState.settingsKnown),
          useTickets: this.#afkingState.settingsKnown
            ? Boolean(this.#afkingState.useTickets)
            : null,
        }));
      } else {
        // Explicitly invalidate warning eligibility until a fresh authoritative
        // read succeeds. Retained component state is presentation-only here;
        // the alert must never evaluate a stale balance as current.
        update('app.afkingSubscription', Object.freeze({
          address: String(actionTarget || '').toLowerCase() || null,
          known: false,
          active: Boolean(actionTarget && this.#afkingState?.active),
          fundedDays: null,
          dailyQuantity: actionTarget
            ? Math.max(1, Math.trunc(Number(this.#afkingState?.dailyQuantity) || 1))
            : 0,
          settingsKnown: Boolean(actionTarget && this.#afkingState?.settingsKnown),
          useTickets: actionTarget && this.#afkingState?.settingsKnown
            ? Boolean(this.#afkingState.useTickets)
            : null,
        }));
      }
      this.#renderPricing();
    } catch (_e) {
      // Network blip — next cycle retries. Don't crash the panel.
    }
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

  #wireStoreSubscriptions() {
    const u1 = subscribe('connected.address', () => this.#runPollCycle());
    const u2 = subscribe('viewing.address', () => this.#runPollCycle());
    const u3 = subscribe('ui.mode', () => {
      this.#renderCombinedGate();
      this.#renderDeityCatalog();
      this.#renderClosedDrawerSummary();
    });
    const u4 = subscribe('app.poolBenchmarks', (benchmarks) => {
      if (benchmarks?.contractPhase) this.#renderAfkingDayCost();
    });
    const u5 = subscribe('app.boons', () => this.#renderPricing());
    this.#unsubs.push(u1, u2, u3, u4, u5);
  }

  // ---------------------------------------------------------------------
  // Account-switcher (2026-07-16) — combined-mode gate. Passes are
  // per-account writes (whale/lazy/deity); there is no single-account
  // target in combined view, so the buy rows hide behind the identity-panel
  // note (mirrors app-quest-panel.js / app-activity-panel.js conventions —
  // this panel has no pre-existing "-empty" bind, so the note is new).
  // ---------------------------------------------------------------------

  #renderCombinedGate() {
    const isCombined = get('ui.mode') === 'combined';
    if (isCombined && this.#deityDialogOpen) this.#closeDeityDialog();
    const note = this.querySelector('[data-bind="pass-combined-note"]');
    if (note) {
      note.hidden = !isCombined;
      if (isCombined) note.textContent = 'Per-account stat. Pick a single account.';
    }
    const whaleRow = this.querySelector('.pass-whale-row');
    if (whaleRow) whaleRow.hidden = isCombined;
    const lazyRow = this.querySelector('[data-bind="pass-lazy-row"]');
    // Combined mode force-hides regardless of #renderPricing's price-window
    // gate (which only runs when NOT combined below).
    if (lazyRow && isCombined) lazyRow.hidden = true;
    const deitySection = this.querySelector('.pass-deity-section');
    if (deitySection) {
      const ownsDeityPass = deitySection.getAttribute('data-deity-owned') === 'true';
      deitySection.hidden = isCombined || ownsDeityPass;
    }
    const afkingSection = this.querySelector('[data-bind="pass-afking"]');
    if (afkingSection && isCombined) afkingSection.hidden = true;
  }

  // ---------------------------------------------------------------------
  // Render pricing snapshot — server-derived strings via textContent (T-58-18).
  // CF-06: NEVER optimistic balance subtraction. The price text reflects the
  // computed snapshot; pending-tx state does NOT mutate it locally.
  // ---------------------------------------------------------------------

  #renderPricing() {
    const p = this.#pricingData;
    this.#renderPassScoreBenefits();
    this.#renderWhaleBuyLabel();
    this.#renderLazyBuyLabel();
    this.#renderWhaleLootboxBenefit();
    this.#renderPassSeatBenefits();
    this.#renderLazyLootboxBenefit();
    this.#renderDeityLootboxBenefit();
    this.#renderDeityCatalog();
    this.#renderAfking();
    // A valid Lazy discount is also an on-chain purchase gate, so its row is
    // available outside the normal x9/x0 window while that boon is live.
    const lazyRow = this.querySelector('[data-bind="pass-lazy-row"]');
    if (lazyRow) {
      const boonOpen = passBoonDiscountBps(this.#actingBoonPayload(), 'lazy') > 0;
      const open = Boolean(p?.lazyCostWei != null && (p?.lazyOpen || boonOpen));
      lazyRow.hidden = !open;
    }
    // Re-assert the combined-mode gate — this poll tick's price-window logic
    // above may have just re-revealed the lazy row; combined mode wins.
    this.#renderCombinedGate();
    this.#renderClosedDrawerSummary();
  }

  #renderClosedDrawerSummary() {
    const drawer = this.closest?.('#afking-passes')
      || (typeof document !== 'undefined' ? document.querySelector?.('#afking-passes') : null);
    if (!drawer) return;
    const closed = drawer.querySelector('[data-bind="pass-summary-closed"]');
    if (!closed) return;
    if (get('ui.mode') === 'combined') {
      closed.hidden = true;
      return;
    }

    const afking = afkingClosedSummary(this.#afkingState, this.#afkingMintPriceWei());
    const stateGroup = drawer.querySelector('[data-bind="pass-summary-state"]');
    const subscription = drawer.querySelector('[data-bind="pass-summary-subscription"]');
    const funding = drawer.querySelector('[data-bind="pass-summary-funding"]');
    if (subscription) subscription.textContent = afking.subscription || '';
    if (funding) {
      funding.textContent = afking.funding || '';
      funding.hidden = !afking.funding;
    }
    if (stateGroup) {
      stateGroup.hidden = !afking.subscription;
      stateGroup.setAttribute('data-active', String(Boolean(this.#afkingState?.active)));
    }

    const deityId = this.#ownedDeitySymbolId();
    const deity = drawer.querySelector('[data-bind="pass-summary-deity"]');
    if (deity) {
      deity.hidden = deityId == null;
      if (deityId == null) deity.removeAttribute('data-symbol');
    }
    if (deityId != null) {
      const badge = passSymbolBadge(deityId);
      const symbol = String(badge.name || '').trim().split(/\s+/).at(-1) || 'Symbol';
      if (deity) deity.setAttribute('data-symbol', symbol.toLowerCase());
      const badgeImage = drawer.querySelector('[data-bind="pass-summary-deity-badge"]');
      const deityName = drawer.querySelector('[data-bind="pass-summary-deity-name"]');
      if (badgeImage) {
        badgeImage.src = badge.path;
        badgeImage.alt = `${symbol} deity pass`;
      }
      if (deityName) deityName.textContent = `GOD OF ${symbol.toUpperCase()}`;
    }

    const premium = activePassSummary(this.#playerData, this.#pricingData?.currentLevel);
    const activePass = drawer.querySelector('[data-bind="pass-summary-active-pass"]');
    const activePassSigil = drawer.querySelector('[data-bind="pass-summary-active-pass-sigil"]');
    const activePassLabel = drawer.querySelector('[data-bind="pass-summary-active-pass-label"]');
    if (activePass) {
      activePass.hidden = !premium;
      if (premium) activePass.setAttribute('data-kind', premium.kind);
      else activePass.removeAttribute('data-kind');
    }
    if (activePassSigil) activePassSigil.textContent = premium?.sigil || '';
    if (activePassLabel) activePassLabel.textContent = premium?.label || '';

    closed.hidden = !afking.subscription && deityId == null && !premium;
  }

  #renderPassScoreBenefits() {
    const score = this.#playerData?.scoreBreakdown || null;
    const ownsDeityPass = this.#ownedDeitySymbolId() != null;
    for (const [bind, bonus] of [
      ['pass-lazy-score', 10],
      ['pass-whale-score', 40],
      ['pass-deity-score', 80],
    ]) {
      const el = this.querySelector(`[data-bind="${bind}"]`);
      if (el) {
        const gain = ownsDeityPass ? 0 : projectedPassScoreGain(score, bonus);
        el.textContent = gain > 0 ? `+${gain}% DEGEN RATING` : '';
        el.hidden = gain <= 0;
      }
    }
  }

  #actingBoonPayload() {
    const payload = get('app.boons');
    const quotedAddress = String(payload?.address || '').toLowerCase();
    const actingAddress = String(getActingAddress() || '').toLowerCase();
    // Never apply another viewed wallet's discount to this wallet's quote.
    if (quotedAddress && actingAddress && quotedAddress !== actingAddress) return null;
    return payload;
  }

  #whalePurchasePrice(quantity) {
    return whalePassPurchasePriceWei({
      currentLevel: this.#pricingData?.currentLevel,
      quantity,
      boonPayload: this.#actingBoonPayload(),
      chainId: CHAIN.id,
    });
  }

  #lazyPurchasePrice() {
    return discountedPassPriceWei(
      this.#pricingData?.lazyCostWei,
      this.#actingBoonPayload(),
      'lazy',
    );
  }

  #deityPurchasePrice() {
    return discountedPassPriceWei(
      this.#pricingData?.deityNextPriceWei,
      this.#actingBoonPayload(),
      'deity',
    );
  }

  #passBoonCopy(product, { firstOnly = false } = {}) {
    const bps = passBoonDiscountBps(this.#actingBoonPayload(), product);
    if (bps <= 0) return '';
    const percent = Number.isInteger(bps / 100) ? String(bps / 100) : (bps / 100).toFixed(2);
    return ` · BOON −${percent}%${firstOnly ? ' 1ST' : ''}`;
  }

  #renderWhaleLootboxBenefit() {
    const benefit = this.querySelector('[data-bind="pass-whale-lootbox"]');
    if (!benefit) return;
    const quantityInput = this.querySelector('[name="pass-whale-qty"]');
    const quantity = Math.max(1, Math.min(100, Math.trunc(Number(quantityInput?.value) || 1)));
    const total = this.#whalePurchasePrice(quantity);
    if (total == null) {
      benefit.textContent = 'BONUS LUCKBOX · 10% OF PASS';
      return;
    }
    const lootboxValue = BigInt(total) / 10n;
    benefit.textContent = `BONUS LUCKBOX · ${formatPassEth(lootboxValue)} ETH`;
  }

  #renderWhaleBuyLabel() {
    const buy = this.querySelector('[data-bind="pass-whale-buy"]');
    if (!buy || this.#busyWhale) return;
    const quantityInput = this.querySelector('[name="pass-whale-qty"]');
    // Real number inputs expose .value even when empty. The fallback only
    // covers pre-hydration/minimal DOMs where the markup's value property has
    // not been reflected yet.
    const quantityValue = quantityInput && 'value' in quantityInput
      ? quantityInput.value
      : '1';
    const rawQuantity = Number.parseInt(quantityValue || '', 10);
    const finalPrice = this.#whalePurchasePrice(rawQuantity);
    if (finalPrice == null || !Number.isInteger(rawQuantity)
      || rawQuantity < 1 || rawQuantity > 100) {
      buy.textContent = 'BUY WHALE PASS\n—';
      return;
    }
    buy.textContent = `BUY WHALE PASS\n${formatPassEth(finalPrice)} ETH${this.#passBoonCopy('whale', { firstOnly: true })}`;
  }

  #renderLazyBuyLabel() {
    const buy = this.querySelector('[data-bind="pass-lazy-buy"]');
    if (!buy || this.#busyLazy) return;
    const cost = this.#lazyPurchasePrice();
    buy.textContent = cost == null
      ? 'BUY LAZY PASS\n—'
      : `BUY LAZY PASS\n${formatPassEth(cost)} ETH${this.#passBoonCopy('lazy')}`;
  }

  #renderPassSeatBenefits() {
    // Every premium pass can grant the same AFKing seat, but seats never
    // stack. Deity ownership is authoritative even if the seat token's index
    // is briefly behind, so do not advertise another seat on any pass card.
    const ownsSeat = Boolean(
      this.#afkingState?.hasToken || this.#ownedDeitySymbolId() != null,
    );
    for (const bind of [
      'pass-lazy-afking-seat',
      'pass-whale-afking-seat',
      'pass-deity-afking-seat',
    ]) {
      const benefit = this.querySelector(`[data-bind="${bind}"]`);
      if (benefit) benefit.hidden = ownsSeat;
    }
  }

  #renderLazyLootboxBenefit() {
    const benefit = this.querySelector('[data-bind="pass-lazy-lootbox"]');
    if (!benefit) return;
    const cost = this.#lazyPurchasePrice();
    if (cost == null) {
      benefit.textContent = 'BONUS LUCKBOX · 10% OF PASS';
      return;
    }
    benefit.textContent = `BONUS LUCKBOX · ${formatPassEth(BigInt(cost) / 10n, 3)} ETH`;
  }

  #renderDeityLootboxBenefit() {
    const benefit = this.querySelector('[data-bind="pass-deity-lootbox"]');
    if (!benefit) return;
    const cost = this.#deityPurchasePrice();
    if (cost == null) {
      benefit.textContent = 'BONUS LUCKBOX · 10% OF PASS';
      return;
    }
    benefit.textContent = `BONUS LUCKBOX · ${formatPassEth(BigInt(cost) / 10n, 3)} ETH`;
  }

  #ownedDeitySymbolId(ownerAddress = this.#pinnedAddress) {
    const address = String(ownerAddress || '').toLowerCase();
    if (!address || !this.#deityCatalog?.ownersBySymbol) return null;
    for (const [symbolId, owner] of this.#deityCatalog.ownersBySymbol.entries()) {
      if (String(owner || '').toLowerCase() === address) return Number(symbolId);
    }
    return null;
  }

  #renderDeityCatalog() {
    const catalog = this.#deityCatalog;
    const known = Boolean(catalog?.takenSymbols instanceof Set);
    const ownedSymbolId = this.#ownedDeitySymbolId();
    const ownsDeityPass = ownedSymbolId != null;
    const canSign = deriveCanSign();
    const deitySection = this.querySelector('[data-bind="pass-deity-details"]');
    const select = this.querySelector('[data-bind="pass-deity-select"]');
    const buy = this.querySelector('[data-bind="pass-deity-buy"]');
    const opener = this.querySelector('[data-bind="pass-deity-open"]');
    const symbolGroups = this.querySelector('[data-bind="pass-deity-symbol-grid"]');
    const dialog = this.querySelector('[data-bind="pass-deity-dialog"]');
    if (deitySection) {
      deitySection.setAttribute('data-deity-owned', String(ownsDeityPass));
      deitySection.hidden = get('ui.mode') === 'combined' || ownsDeityPass;
    }
    if (!select || !buy || !opener || !symbolGroups) return;

    const previous = Number(select.value);
    while (select.children?.length) select.removeChild(select.children[0]);
    while (symbolGroups.children?.length) symbolGroups.removeChild(symbolGroups.children[0]);

    let availableIds = [];
    if (ownedSymbolId != null) {
      availableIds = [ownedSymbolId];
    } else if (known) {
      availableIds = Array.from({ length: 32 }, (_unused, id) => id)
        .filter((id) => !catalog.takenSymbols.has(id));
    }

    if (!availableIds.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = known ? 'No symbols available' : 'Checking availability…';
      select.appendChild(option);
    } else {
      for (const symbolId of availableIds) {
        const badge = passSymbolBadge(symbolId);
        const option = document.createElement('option');
        option.value = String(symbolId);
        option.textContent = badge.name
          .split(' ')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' · ');
        select.appendChild(option);
      }
      const selected = availableIds.includes(previous) ? previous : availableIds[0];
      select.value = String(selected);
    }

    const busy = this.#busySymbols.size > 0;
    let lockTitle = '';
    if (!known) lockTitle = 'Checking symbol availability';
    else if (ownedSymbolId != null) lockTitle = 'You already own this deity pass';
    else if (!availableIds.length) lockTitle = 'All deity symbols are taken';
    else if (busy) lockTitle = 'Purchase pending';

    const domainLocked = Boolean(lockTitle);
    const selectedId = Number(select.value);

    // Four stable rows keep all 32 choices aligned. Taken symbols remain in
    // place as disabled context instead of making every later icon jump.
    for (let quadrant = 0; quadrant < PASS_QUADRANTS.length; quadrant += 1) {
      const category = PASS_QUADRANTS[quadrant];
      const group = document.createElement('section');
      group.className = 'pass-deity-symbol-group';
      const groupTitle = document.createElement('strong');
      groupTitle.className = 'pass-deity-symbol-group__title';
      groupTitle.textContent = category.toUpperCase();
      const grid = document.createElement('div');
      grid.className = 'pass-deity-grid';
      group.append(groupTitle, grid);

      for (let offset = 0; offset < 8; offset += 1) {
        const symbolId = quadrant * 8 + offset;
        const badge = passSymbolBadge(symbolId);
        const symbol = String(badge.name || '').trim().split(/\s+/).at(-1) || 'Symbol';
        const taken = Boolean(known && catalog.takenSymbols.has(symbolId));
        const symbolBusy = this.#busySymbols.has(symbolId);
        const button = document.createElement('button');
        button.className = `pass-deity-symbol${taken ? ' pass-deity-symbol--taken' : ''}`;
        button.setAttribute('type', 'button');
        button.setAttribute('data-symbol-id', String(symbolId));
        button.setAttribute('aria-label', `${symbol} deity symbol${taken ? ', taken' : ''}`);
        button.setAttribute('aria-pressed', String(symbolId === selectedId));
        button.disabled = !known || taken || domainLocked || !canSign || symbolBusy;
        button.title = taken ? `${symbol} is already taken` : `Choose ${symbol}`;

        const image = document.createElement('img');
        image.src = badge.path;
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = symbol.toUpperCase();
        button.append(image, label);
        button.addEventListener('click', () => {
          if (button.disabled) return;
          select.value = String(symbolId);
          this.#renderDeityPreview();
        });
        grid.appendChild(button);
      }
      symbolGroups.appendChild(group);
    }

    select.hidden = true;
    buy.hidden = ownsDeityPass;
    opener.hidden = ownsDeityPass;
    select.disabled = domainLocked || !canSign;
    buy.disabled = domainLocked || !canSign;
    opener.disabled = domainLocked || !canSign;
    for (const control of [select, buy, opener]) {
      if (domainLocked) {
        control.setAttribute('data-write-locked', '');
        control.setAttribute('data-write-lock-title', lockTitle);
      } else {
        control.removeAttribute('data-write-locked');
        control.removeAttribute('data-write-lock-title');
      }
    }

    const price = this.#deityPurchasePrice();
    const label = !known
      ? 'BUY DEITY PASS\nCHECKING…'
      : !availableIds.length && !ownsDeityPass
        ? 'DEITY PASS\nSOLD OUT'
        : price == null
          ? 'BUY DEITY PASS\n—'
          : `BUY DEITY PASS\n${formatPassEth(price)} ETH${this.#passBoonCopy('deity')}`;
    opener.textContent = label;
    buy.textContent = busy
      ? 'PURCHASE PENDING…'
      : price == null
        ? 'BUY DEITY PASS\n—'
        : `BUY DEITY PASS\n${formatPassEth(price)} ETH${this.#passBoonCopy('deity')}`;

    if (ownsDeityPass || (known && !availableIds.length) || get('ui.mode') === 'combined') {
      this.#deityDialogOpen = false;
    }
    if (dialog) dialog.hidden = !this.#deityDialogOpen;
    opener.setAttribute('aria-expanded', String(this.#deityDialogOpen));
    this.#renderDeityPreview();
  }

  #renderDeityPreview() {
    const select = this.querySelector('[data-bind="pass-deity-select"]');
    const preview = this.querySelector('[data-bind="pass-deity-preview"]');
    const selectedName = this.querySelector('[data-bind="pass-deity-selected-name"]');
    const brandSymbols = this.querySelectorAll('[data-bind="pass-deity-brand-symbol"]');
    if (!preview) return;
    const symbolId = Number(select?.value);
    if (!Number.isInteger(symbolId) || symbolId < 0 || symbolId > 31) {
      preview.src = '';
      preview.alt = '';
      preview.hidden = true;
      for (const brandSymbol of brandSymbols) {
        brandSymbol.src = '';
        brandSymbol.hidden = true;
      }
      if (selectedName) selectedName.textContent = '—';
      return;
    }
    const badge = passSymbolBadge(symbolId);
    const symbol = String(badge.name || '').trim().split(/\s+/).at(-1) || 'Symbol';
    preview.src = badge.path;
    preview.alt = `${symbol} deity symbol`;
    preview.hidden = false;
    for (const brandSymbol of brandSymbols) {
      brandSymbol.src = badge.path;
      brandSymbol.hidden = false;
    }
    if (selectedName) selectedName.textContent = `GOD OF ${symbol.toUpperCase()}`;
    for (const button of this.querySelectorAll('.pass-deity-symbol')) {
      const selected = Number(button.getAttribute('data-symbol-id')) === symbolId;
      button.classList.toggle('pass-deity-symbol--selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  #afkingMintPriceWei() {
    const snapshotPrice = BigInt(this.#afkingState?.mintPriceWei ?? 0n);
    if (snapshotPrice > 0n) return snapshotPrice;
    const targetLevel = activeTicketLevel(
      this.#gameState,
      get('app.poolBenchmarks')?.contractPhase,
    );
    if (targetLevel == null) return 0n;
    try { return scaledTicketPriceWei(targetLevel); }
    catch (_error) { return 0n; }
  }

  #afkingFundingInputWei(name = 'pass-afking-fund') {
    const input = this.querySelector(`[name="${name}"]`);
    const value = String(input?.value || '0').trim();
    try {
      const wei = parseEther(value || '0') / ETH_DIVISOR;
      return wei >= 0n ? wei : null;
    } catch (_error) {
      return null;
    }
  }

  #renderAfkingDayCost() {
    const cost = this.querySelector('[data-bind="pass-afking-day-cost"]');
    const coverage = this.querySelector('[data-bind="pass-afking-coverage"]');
    const qtyInput = this.querySelector('[name="pass-afking-qty"]');
    const save = this.querySelector('[data-bind="pass-afking-save"]');
    if (!cost && !coverage && !save) return;
    const quantity = Math.min(255, Math.max(1, Number.parseInt(qtyInput?.value || '1', 10) || 1));
    const mintPrice = this.#afkingMintPriceWei();
    const dayCost = mintPrice * BigInt(quantity);
    if (cost) {
      cost.textContent = dayCost > 0n
        ? `DAILY COST · ${formatPassEth(dayCost)} ETH`
        : 'DAILY COST · —';
    }

    const addedFunding = this.#afkingFundingInputWei();
    if (coverage) {
      if (dayCost <= 0n || addedFunding == null) {
        coverage.textContent = 'COVERAGE · —';
      } else {
        const available = BigInt(this.#afkingState?.fundingWei ?? 0n) + addedFunding;
        const days = available / dayCost;
        coverage.textContent = `COVERS · ${days} DAY${days === 1n ? '' : 'S'}`;
      }
    }

    if (save && !this.#busyAfking) {
      if (this.#afkingState?.rngLocked) {
        save.textContent = 'RNG SETTLING';
      } else if (this.#afkingState?.active && !this.#afkingState?.settingsKnown) {
        save.textContent = 'LOADING SETTINGS';
      } else {
        const action = this.#afkingState?.active ? 'SAVE CHANGES' : 'START';
        const fundingLabel = addedFunding != null && addedFunding > 0n
          ? ` + ${formatPassEth(addedFunding, 6)} ETH`
          : '';
        save.textContent = `${action}${fundingLabel}`;
      }
    }

  }

  #renderAfkingTopup() {
    const topup = this.querySelector('[data-bind="pass-afking-topup"]');
    const fundButton = this.querySelector('[data-bind="pass-afking-fund-button"]');
    const active = Boolean(this.#afkingState?.hasToken && this.#afkingState?.active);
    if (topup) topup.hidden = !active;
    if (!fundButton) return;
    const addedFunding = this.#afkingFundingInputWei('pass-afking-topup');
    fundButton.textContent = this.#busyAfkingFunding ? 'TOPPING UP…' : 'TOP UP';
    const busy = this.#busyAfking
      || this.#busyAfkingFunding
      || this.#busyAfkingWithdrawal
      || this.#busyAfkingClaim;
    const fundLocked = !active || busy || addedFunding == null || addedFunding <= 0n;
    const fundLockTitle = !active
      ? 'Start the subscription first'
      : busy
        ? 'AFKing transaction pending'
        : addedFunding == null || addedFunding <= 0n
          ? 'Enter an ETH amount to add'
          : '';
    _setDomainWriteLock(fundButton, fundLocked, fundLockTitle);
    if (!fundLocked) {
      fundButton.title = 'Add prepaid ETH without changing the subscription';
    }
  }

  #openAfkingDialog(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    const state = this.#afkingState;
    if (!state || (!state.hasToken && BigInt(state.fundingWei ?? 0n) <= 0n)) return;
    this.#afkingDialogOpen = true;
    this.#clearAfkingError();
    this.#renderAfking();
    const firstControl = state.hasToken
      ? this.querySelector('[data-bind="pass-afking-mode"]')
      : this.querySelector('[data-bind="pass-afking-withdraw"]');
    try { firstControl?.focus?.(); } catch (_) { /* defensive */ }
  }

  #closeAfkingDialog(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyAfking || this.#busyAfkingWithdrawal) return;
    this.#afkingDialogOpen = false;
    this.#clearAfkingError();
    this.#renderAfking();
    try { this.querySelector('[data-bind="pass-afking-edit"]')?.focus?.(); }
    catch (_) { /* defensive */ }
  }

  #syncAfkingLockPolling() {
    const locked = Boolean(this.#afkingState?.hasToken && this.#afkingState?.rngLocked);
    if (!locked) {
      if (this.#afkingLockPollHandle != null) {
        try { clearTimeout(this.#afkingLockPollHandle); } catch (_) { /* defensive */ }
        this.#afkingLockPollHandle = null;
      }
      return;
    }
    if (this.#afkingLockPollHandle != null || typeof setTimeout !== 'function') return;
    this.#afkingLockPollHandle = _setTimeoutUnref(() => {
      this.#afkingLockPollHandle = null;
      this.#runPollCycle();
    }, AFKING_LOCK_POLL_MS);
  }

  #renderAfking() {
    const section = this.querySelector('[data-bind="pass-afking"]');
    if (!section) return;
    const state = this.#afkingState;
    const hasFunding = BigInt(state?.fundingWei ?? 0n) > 0n;
    const hasPendingFlip = Boolean(
      state?.pendingFlipKnown && BigInt(state?.pendingFlipWhole ?? 0n) > 0n,
    );
    const visible = Boolean(
      state && (state.hasToken || hasFunding || hasPendingFlip) && get('ui.mode') !== 'combined',
    );
    section.hidden = !visible;
    if (!visible) {
      this.#afkingDialogOpen = false;
      const closedDialog = this.querySelector('[data-bind="pass-afking-dialog"]');
      if (closedDialog) closedDialog.hidden = true;
      this.#syncAfkingLockPolling();
      return;
    }

    const lockNotice = this.querySelector('[data-bind="pass-afking-lock"]');
    const controls = this.querySelector('[data-bind="pass-afking-controls"]');
    if (lockNotice) {
      lockNotice.hidden = !state.hasToken || !state.rngLocked;
      lockNotice.textContent = 'RNG SETTLING · Settings unlock automatically. Top ups and claims stay open.';
    }

    const addressKey = String(this.#pinnedAddress || '').toLowerCase();
    const qtyInput = this.querySelector('[name="pass-afking-qty"]');
    const modeInput = this.querySelector('[data-bind="pass-afking-mode"]');
    const fundInput = this.querySelector('[name="pass-afking-fund"]');
    const topupInput = this.querySelector('[name="pass-afking-topup"]');
    const creditInput = this.querySelector('[name="pass-afking-claimable-first"]');
    if (this.#afkingFormAddress !== addressKey) {
      if (qtyInput) qtyInput.value = String(state.active ? Math.max(1, state.dailyQuantity) : 1);
      if (modeInput) modeInput.value = state.settingsKnown && state.useTickets ? 'tickets' : 'lootbox';
      if (fundInput) fundInput.value = '0';
      if (topupInput) topupInput.value = '0';
      if (creditInput) {
        creditInput.checked = state.settingsKnown ? Boolean(state.drainGameCreditFirst) : true;
      }
      this.#afkingFormAddress = addressKey;
    }
    const mintPrice = this.#afkingMintPriceWei();
    if (this.#afkingFundingSeededAddress !== addressKey && mintPrice > 0n) {
      // Initial setup starts with a useful ten-price suggestion. Existing
      // subscriptions use the always-visible top-up control instead.
      if (fundInput) fundInput.value = state.active ? '0' : formatPassEth(mintPrice * 10n, 6);
      this.#afkingFundingSeededAddress = addressKey;
    }
    if (state.active && this.#afkingTopupSeededAddress !== addressKey && mintPrice > 0n) {
      const dailyQuantity = BigInt(Math.max(1, Math.trunc(Number(state.dailyQuantity) || 1)));
      if (topupInput) topupInput.value = formatPassEth(mintPrice * dailyQuantity * 10n, 6);
      this.#afkingTopupSeededAddress = addressKey;
    }

    const status = this.querySelector('[data-bind="pass-afking-status"]');
    if (status) {
      status.textContent = state.active ? 'ACTIVE' : (state.hasToken ? 'READY' : 'FUNDS ONLY');
      status.classList.toggle('pass-afking__status--active', Boolean(state.active));
    }
    const current = this.querySelector('[data-bind="pass-afking-current"]');
    if (current) {
      if (state.active) {
        const quantity = Math.max(1, Number(state.dailyQuantity) || 1);
        const product = state.settingsKnown
          ? (state.useTickets ? (quantity === 1 ? 'TICKET' : 'TICKETS') : 'LUCKBOX')
          : (quantity === 1 ? 'ITEM' : 'ITEMS');
        current.textContent = `${quantity} ${product} / DAY`;
      } else {
        current.textContent = state.hasToken ? 'NO AUTOMATIC ORDER' : 'NO AFKING SEAT';
      }
    }
    const policy = this.querySelector('[data-bind="pass-afking-policy"]');
    if (policy) {
      policy.hidden = !state.active || !state.settingsKnown;
      policy.textContent = state.drainGameCreditFirst ? 'CLAIMABLE FIRST' : 'PREPAID FIRST';
    }
    const funding = this.querySelector('[data-bind="pass-afking-funding"]');
    if (funding) {
      funding.textContent = `${formatPassEth(state.fundingWei)} ETH`;
    }

    const edit = this.querySelector('[data-bind="pass-afking-edit"]');
    if (edit) {
      edit.hidden = !state.hasToken && !hasFunding;
      edit.textContent = state.active ? 'EDIT' : (state.hasToken ? 'SET UP' : 'MANAGE');
      edit.disabled = this.#busyAfking || this.#busyAfkingWithdrawal;
      edit.setAttribute('aria-expanded', String(this.#afkingDialogOpen));
    }

    const dialog = this.querySelector('[data-bind="pass-afking-dialog"]');
    const dialogVisible = Boolean(this.#afkingDialogOpen && (state.hasToken || hasFunding));
    if (dialog) {
      dialog.hidden = !dialogVisible;
      dialog.setAttribute('aria-hidden', String(!dialogVisible));
    }
    if (controls) {
      controls.hidden = !dialogVisible;
      controls.classList.toggle('pass-afking__controls--editing', Boolean(state.active));
      controls.classList.toggle('pass-afking__controls--funds-only', !state.hasToken);
    }
    const dialogTitle = this.querySelector('[data-bind="pass-afking-dialog-title"]');
    if (dialogTitle) {
      dialogTitle.textContent = state.active
        ? 'EDIT SUBSCRIPTION'
        : (state.hasToken ? 'START SUBSCRIPTION' : 'MANAGE FUNDS');
    }
    const dialogState = this.querySelector('[data-bind="pass-afking-dialog-state"]');
    if (dialogState) dialogState.textContent = status?.textContent || 'READY';

    const orderCard = this.querySelector('.pass-afking__order-card');
    const initialFunding = this.querySelector('[data-bind="pass-afking-initial-funding"]');
    const credit = this.querySelector('.pass-afking__credit');
    const costs = this.querySelector('.pass-afking__costs');
    if (orderCard) orderCard.hidden = !state.hasToken;
    if (initialFunding) initialFunding.hidden = !state.hasToken || state.active;
    if (credit) credit.hidden = !state.hasToken;
    if (costs) costs.hidden = !state.hasToken;

    const withdraw = this.querySelector('[data-bind="pass-afking-withdraw"]');
    if (withdraw) {
      const selfMode = get('ui.mode') === 'self';
      withdraw.hidden = !selfMode || !hasFunding;
      withdraw.textContent = this.#busyAfkingWithdrawal ? 'WITHDRAWING…' : 'WITHDRAW ALL';
      const withdrawLocked = !selfMode
        || !hasFunding
        || this.#busyAfking
        || this.#busyAfkingFunding
        || this.#busyAfkingWithdrawal
        || this.#busyAfkingClaim;
      _setDomainWriteLock(
        withdraw,
        withdrawLocked,
        withdrawLocked ? 'AFKing transaction pending' : '',
      );
      if (!withdrawLocked) {
        withdraw.title = state.active
          ? 'Withdraw all prepaid ETH. The subscription remains active and may stop when funding runs out.'
          : 'Withdraw all prepaid AFKing ETH to this wallet.';
      }
    }

    const flipClaim = this.querySelector('[data-bind="pass-afking-flip-claim"]');
    if (flipClaim) {
      const pendingKnown = Boolean(state.pendingFlipKnown);
      const pending = pendingKnown ? BigInt(state.pendingFlipWhole ?? 0n) : 0n;
      flipClaim.hidden = !pendingKnown || pending <= 0n;
      const pendingLabel = pending.toLocaleString('en-US');
      flipClaim.textContent = this.#busyAfkingClaim
        ? `CLAIMING ${pendingLabel} FLIP…`
        : `CLAIM ${pendingLabel} FLIP`;
      const claimDescription = `Claim ${pendingLabel} bonus FLIP`;
      flipClaim.setAttribute?.('aria-label', claimDescription);
      flipClaim.title = claimDescription;
      const claimLocked = pending <= 0n
        || this.#busyAfking
        || this.#busyAfkingFunding
        || this.#busyAfkingWithdrawal
        || this.#busyAfkingClaim;
      _setDomainWriteLock(
        flipClaim,
        claimLocked,
        claimLocked ? 'AFKing transaction pending' : '',
      );
      if (!claimLocked) {
        flipClaim.title = claimDescription;
      }
    }

    const save = this.querySelector('[data-bind="pass-afking-save"]');
    const cancel = this.querySelector('[data-bind="pass-afking-cancel"]');
    const settingsUnavailable = Boolean(state.active && !state.settingsKnown);
    const locked = Boolean(
      state.rngLocked
      || settingsUnavailable
      || this.#busyAfking
      || this.#busyAfkingFunding
      || this.#busyAfkingWithdrawal
      || this.#busyAfkingClaim
    );
    if (save) {
      save.hidden = !state.hasToken;
      save.textContent = this.#busyAfking
        ? 'SAVING…'
        : state.rngLocked
          ? 'RNG SETTLING'
          : settingsUnavailable
            ? 'LOADING SETTINGS'
            : (state.active ? 'SAVE CHANGES' : 'START');
      const saveLockTitle = state.rngLocked
        ? 'Settings unlock automatically after RNG resolves'
        : settingsUnavailable
          ? 'Waiting for current on-chain settings'
        : this.#busyAfking || this.#busyAfkingFunding || this.#busyAfkingWithdrawal || this.#busyAfkingClaim
          ? 'Transaction pending'
          : '';
      _setDomainWriteLock(save, locked, saveLockTitle);
    }
    if (cancel) {
      cancel.hidden = !state.hasToken || !state.active;
      _setDomainWriteLock(
        cancel,
        locked,
        state.rngLocked ? 'Cancel unlocks automatically after RNG resolves' : 'Transaction pending',
      );
    }
    this.#renderAfkingDayCost();
    this.#renderAfkingTopup();
    this.#syncAfkingLockPolling();
  }

  // ---------------------------------------------------------------------
  // Lazy pass buy — purchaseLazyPass(buyer) payable; exact msg.value
  // (client-side Σ priceForLevel; boon discounts resolve via static-call).
  // ---------------------------------------------------------------------

  async #onLazyBuyClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyLazy) return;
    this.#busyLazy = true;

    const btn = this.querySelector('[data-bind="pass-lazy-buy"]');
    if (btn) btn.disabled = true;
    this.#clearLazyError();

    try {
      const cost = this.#lazyPurchasePrice();
      if (cost == null) {
        this.#renderLazyError('Price unavailable — try again in a moment.');
        return;
      }
      const { receipt } = await purchaseLazyPass({ msgValueWei: cost });

      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: passPurchaseConfirmationDetail(receipt, { kind: 'lazy' }),
          bubbles: true,
        }));
      } catch (_e) { /* defensive */ }
      this.#clearAllErrorStates();
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      const msg = error?.userMessage || error?.message || 'Buy failed.';
      this.#renderLazyError(msg);
    } finally {
      if (btn) btn.disabled = false;
      setTimeout(() => { this.#busyLazy = false; }, DEBOUNCE_MS);
    }
  }

  #renderLazyError(msg) {
    const errEl = this.querySelector('[data-bind="pass-lazy-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimerLazy != null) {
      try { clearTimeout(this.#errorTimerLazy); } catch (_) { /* defensive */ }
    }
    this.#errorTimerLazy = setTimeout(() => this.#clearLazyError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimerLazy && typeof this.#errorTimerLazy.unref === 'function') {
      try { this.#errorTimerLazy.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearLazyError() {
    const errEl = this.querySelector('[data-bind="pass-lazy-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimerLazy != null) {
      try { clearTimeout(this.#errorTimerLazy); } catch (_) { /* defensive */ }
      this.#errorTimerLazy = null;
    }
  }

  // ---------------------------------------------------------------------
  // Whale buy click handler — closure-form sendTx via passes.purchaseWhaleBundle.
  // ---------------------------------------------------------------------

  async #onWhaleBuyClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyWhale) return;
    this.#busyWhale = true;

    const btn = this.querySelector('[data-bind="pass-whale-buy"]');
    const originalLabel = btn ? btn.textContent : 'Buy whale pass';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Buying…';
    }
    this.#clearWhaleError();

    try {
      const qtyInput = this.querySelector('[name="pass-whale-qty"]');
      const rawValue = qtyInput ? qtyInput.value : '0';
      const quantity = parseInt(rawValue, 10);
      if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100) {
        this.#renderWhaleError('Quantity must be 1-100.');
        return;
      }
      const msgValueWei = this.#whalePurchasePrice(quantity);
      if (msgValueWei == null) {
        this.#renderWhaleError('Price unavailable — try again in a moment.');
        return;
      }

      const { receipt } = await purchaseWhaleBundle({ quantity, msgValueWei });

      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: passPurchaseConfirmationDetail(receipt, { kind: 'whale', quantity }),
          bubbles: true,
        }));
      } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }

      // Clear all error states across the panel on next-success-anywhere.
      this.#clearAllErrorStates();
      // 250ms post-confirm refetch (CF-06).
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      const msg = error?.userMessage || error?.message || 'Buy failed.';
      this.#renderWhaleError(msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
      // Release debounce after window expires.
      setTimeout(() => {
        this.#busyWhale = false;
        this.#renderWhaleBuyLabel();
      }, DEBOUNCE_MS);
    }
  }

  // ---------------------------------------------------------------------
  // Deity picker buy handler — refreshes the catalog immediately before the
  // preflight so a stale symbol or stale triangular price never reaches the
  // wallet prompt.
  //
  // CONTEXT D-05 LOCKED 'E' override:
  //   On revert, decode via reason-map (or use error.code if pre-decoded), then
  //   apply deityPassErrorOverride. If decoded.code === 'E', the override
  //   surfaces "That symbol's taken — try another." and the picker stays open
  //   with the selected symbol cleared so the user re-picks visibly.
  // ---------------------------------------------------------------------

  async #onDeityBuyClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    const select = this.querySelector('[data-bind="pass-deity-select"]');
    const symbolId = Number(select?.value);
    if (!Number.isInteger(symbolId) || symbolId < 0 || symbolId > 31) return;
    if (!this.#deityCatalog || this.#pricingData?.deityNextPriceWei == null) return;
    if (this.#deityCatalog.takenSymbols.has(symbolId)) return;
    if (this.#ownedDeitySymbolId() != null) return;
    if (this.#busySymbols.has(symbolId)) return;
    this.#busySymbols.add(symbolId);

    this.#clearDeityError();

    try {
      const freshCatalog = await readDeityPassCatalog();
      if (freshCatalog) {
        this.#deityCatalog = freshCatalog;
        this.#pricingData.deityNextPriceWei = computeDeityNextPriceWei(
          freshCatalog.issuedCount,
          CHAIN.id,
        );
      }
      if (this.#deityCatalog.takenSymbols.has(symbolId)) {
        this.#renderDeityError("That symbol's taken — try another.");
        return;
      }
      const msgValueWei = this.#deityPurchasePrice();
      if (msgValueWei == null) {
        this.#renderDeityError('Price unavailable — try again in a moment.');
        return;
      }
      const { receipt } = await purchaseDeityPass({ symbolId, msgValueWei });

      // Receipt confirmation is authoritative enough to update the catalog
      // immediately; the 250ms poll below reconciles owner/address details.
      const actingAddress = getActingAddress() || this.#pinnedAddress || '';
      const takenSymbols = new Set(this.#deityCatalog.takenSymbols);
      const ownersBySymbol = new Map(this.#deityCatalog.ownersBySymbol);
      takenSymbols.add(symbolId);
      ownersBySymbol.set(symbolId, actingAddress);
      this.#deityCatalog = {
        issuedCount: takenSymbols.size,
        takenSymbols,
        ownersBySymbol,
      };
      this.#pricingData.deityNextPriceWei = computeDeityNextPriceWei(
        this.#deityCatalog.issuedCount,
        CHAIN.id,
      );

      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: passPurchaseConfirmationDetail(receipt, { kind: 'deity', symbolId }),
          bubbles: true,
        }));
      } catch (_e) { /* defensive */ }

      this.#clearAllErrorStates();
      this.#closeDeityDialog();
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      // CONTEXT D-05 LOCKED override path. Use error.code if pre-decoded
      // (passes.js wraps revert errors via _structuredRevertError); otherwise
      // decode via reason-map.
      const decoded = error?.code
        ? { code: error.code, userMessage: error.userMessage, recoveryAction: error.recoveryAction }
        : decodeRevertReason(error);
      const overridden = deityPassErrorOverride(decoded);
      const msg = overridden?.userMessage || error?.message || 'Buy failed.';
      this.#renderDeityError(msg);
      if (['SymbolTaken', 'DeityPassConflict', 'DeityPass-Taken'].includes(overridden?.code)) {
        const takenSymbols = new Set(this.#deityCatalog.takenSymbols);
        takenSymbols.add(symbolId);
        this.#deityCatalog = {
          ...this.#deityCatalog,
          issuedCount: Math.max(this.#deityCatalog.issuedCount, takenSymbols.size),
          takenSymbols,
        };
      }
    } finally {
      this.#renderPricing();
      setTimeout(() => {
        this.#busySymbols.delete(symbolId);
        this.#renderDeityCatalog();
      }, DEBOUNCE_MS);
    }
  }

  async #onAfkingFund(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (
      this.#busyAfking
      || this.#busyAfkingFunding
      || this.#busyAfkingWithdrawal
      || this.#busyAfkingClaim
      || !this.#afkingState?.active
    ) return;
    const msgValueWei = this.#afkingFundingInputWei('pass-afking-topup');
    if (msgValueWei == null || msgValueWei <= 0n) {
      this.#renderAfkingError('Enter an ETH amount to add.');
      return;
    }

    this.#busyAfkingFunding = true;
    this.#clearAfkingError();
    this.#renderAfking();
    try {
      await fundAfkingSubscription({ msgValueWei });
      const fundInput = this.querySelector('[name="pass-afking-topup"]');
      if (fundInput) fundInput.value = '0';
      this.#clearAllErrorStates();
      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'afking-funding', amountWei: msgValueWei },
          bubbles: true,
        }));
      } catch (_error) { /* defensive */ }
      this.#afkingDialogOpen = false;
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderAfkingError(error?.userMessage || error?.message || 'Funding failed.');
    } finally {
      this.#busyAfkingFunding = false;
      this.#renderAfking();
    }
  }

  async #onAfkingWithdraw(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (
      this.#busyAfking
      || this.#busyAfkingFunding
      || this.#busyAfkingWithdrawal
      || this.#busyAfkingClaim
      || get('ui.mode') !== 'self'
      || BigInt(this.#afkingState?.fundingWei ?? 0n) <= 0n
    ) return;

    this.#busyAfkingWithdrawal = true;
    this.#clearAfkingError();
    this.#renderAfking();
    try {
      const { amountWei } = await withdrawAfkingSubscriptionFunding();
      this.#clearAllErrorStates();
      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'afking-withdrawal', amountWei },
          bubbles: true,
        }));
      } catch (_error) { /* defensive */ }
      this.#afkingState = { ...this.#afkingState, fundingWei: 0n };
      this.#afkingDialogOpen = false;
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderAfkingError(error?.userMessage || error?.message || 'Withdrawal failed.');
    } finally {
      this.#busyAfkingWithdrawal = false;
      this.#renderAfking();
    }
  }

  async #onAfkingFlipClaim(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (
      this.#busyAfking
      || this.#busyAfkingFunding
      || this.#busyAfkingWithdrawal
      || this.#busyAfkingClaim
      || !this.#afkingState?.pendingFlipKnown
      || BigInt(this.#afkingState?.pendingFlipWhole ?? 0n) <= 0n
    ) return;

    this.#busyAfkingClaim = true;
    this.#clearAfkingError();
    this.#renderAfking();
    try {
      const pendingFlipWhole = BigInt(this.#afkingState?.pendingFlipWhole ?? 0n);
      await claimAfkingSubscriptionFlip();
      this.#afkingState = {
        ...this.#afkingState,
        pendingFlipWhole: 0n,
        pendingFlipKnown: true,
      };
      this.#clearAllErrorStates();
      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'afking-flip-claim', pendingFlipWhole },
          bubbles: true,
        }));
      } catch (_error) { /* defensive */ }
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderAfkingError(error?.userMessage || error?.message || 'Bonus FLIP claim failed.');
    } finally {
      this.#busyAfkingClaim = false;
      this.#renderAfking();
    }
  }

  async #onAfkingSave(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (
      this.#busyAfking
      || this.#busyAfkingFunding
      || this.#busyAfkingWithdrawal
      || this.#busyAfkingClaim
      || this.#afkingState?.rngLocked
      || (this.#afkingState?.active && !this.#afkingState?.settingsKnown)
      || !this.#afkingState?.hasToken
    ) return;

    const qtyInput = this.querySelector('[name="pass-afking-qty"]');
    const modeInput = this.querySelector('[data-bind="pass-afking-mode"]');
    const creditInput = this.querySelector('[name="pass-afking-claimable-first"]');
    const fundInput = this.querySelector('[name="pass-afking-fund"]');
    const dailyQuantity = Number.parseInt(qtyInput?.value || '0', 10);
    if (!Number.isInteger(dailyQuantity) || dailyQuantity < 1 || dailyQuantity > 255) {
      this.#renderAfkingError('Daily quantity must be 1-255.');
      return;
    }

    let msgValueWei = 0n;
    try {
      const funding = String(fundInput?.value || '0').trim();
      if (funding && Number(funding) < 0) throw new Error('negative');
      msgValueWei = parseEther(funding || '0') / ETH_DIVISOR;
    } catch (_error) {
      this.#renderAfkingError('Enter a valid ETH funding amount.');
      return;
    }

    this.#busyAfking = true;
    this.#clearAfkingError();
    this.#renderAfking();
    try {
      const useTickets = modeInput?.value !== 'lootbox';
      const drainGameCreditFirst = Boolean(creditInput?.checked);
      await updateAfkingSubscription({
        dailyQuantity,
        useTickets,
        drainGameCreditFirst,
        msgValueWei,
      });
      this.#afkingState = {
        ...this.#afkingState,
        active: true,
        dailyQuantity,
        settingsKnown: true,
        useTickets,
        drainGameCreditFirst,
      };
      if (fundInput) fundInput.value = '0';
      this.#afkingDialogOpen = false;
      this.#clearAllErrorStates();
      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'afking', dailyQuantity },
          bubbles: true,
        }));
      } catch (_error) { /* defensive */ }
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderAfkingError(error?.userMessage || error?.message || 'Subscription update failed.');
    } finally {
      this.#busyAfking = false;
      this.#renderAfking();
    }
  }

  // #onAfkingSeatClaim was REMOVED along with the whole claim flow: the token dropped `claimSeat`
  // once seats began auto-minting with the pass (GAME `_grantSeatCoin` → token `mintSeatFor`).
  // Seat ART is still changeable on-chain via `setSeatTraits(tokenId, …)`, but that needs the
  // holder's tokenId and the token exposes no owner→token lookup, so an art editor needs a tokenId
  // source first (index the new `SeatMinted(owner, tokenId, …)` event, or add a `seatOf(address)`).

  async #onAfkingCancel(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (
      this.#busyAfking
      || this.#busyAfkingFunding
      || this.#busyAfkingWithdrawal
      || this.#busyAfkingClaim
      || this.#afkingState?.rngLocked
      || !this.#afkingState?.active
    ) return;
    this.#busyAfking = true;
    this.#clearAfkingError();
    this.#renderAfking();
    try {
      await updateAfkingSubscription({ dailyQuantity: 0, msgValueWei: 0n });
      this.#afkingState = { ...this.#afkingState, active: false, dailyQuantity: 0 };
      this.#afkingDialogOpen = false;
      this.#clearAllErrorStates();
      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'afking', dailyQuantity: 0 },
          bubbles: true,
        }));
      } catch (_error) { /* defensive */ }
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderAfkingError(error?.userMessage || error?.message || 'Cancellation failed.');
    } finally {
      this.#busyAfking = false;
      this.#renderAfking();
    }
  }

  // ---------------------------------------------------------------------
  // Error rendering — textContent only (T-58-18). 10s auto-clear timer.
  // ---------------------------------------------------------------------

  #renderWhaleError(msg) {
    const errEl = this.querySelector('[data-bind="pass-whale-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimerWhale != null) {
      try { clearTimeout(this.#errorTimerWhale); } catch (_) { /* defensive */ }
    }
    this.#errorTimerWhale = setTimeout(() => this.#clearWhaleError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimerWhale && typeof this.#errorTimerWhale.unref === 'function') {
      try { this.#errorTimerWhale.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearWhaleError() {
    const errEl = this.querySelector('[data-bind="pass-whale-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimerWhale != null) {
      try { clearTimeout(this.#errorTimerWhale); } catch (_) { /* defensive */ }
      this.#errorTimerWhale = null;
    }
  }

  #renderDeityError(msg) {
    const errEl = this.querySelector('[data-bind="pass-deity-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimerDeity != null) {
      try { clearTimeout(this.#errorTimerDeity); } catch (_) { /* defensive */ }
    }
    this.#errorTimerDeity = setTimeout(() => this.#clearDeityError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimerDeity && typeof this.#errorTimerDeity.unref === 'function') {
      try { this.#errorTimerDeity.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearDeityError() {
    const errEl = this.querySelector('[data-bind="pass-deity-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimerDeity != null) {
      try { clearTimeout(this.#errorTimerDeity); } catch (_) { /* defensive */ }
      this.#errorTimerDeity = null;
    }
  }

  #renderAfkingError(msg) {
    const errEls = [
      this.querySelector('[data-bind="pass-afking-error"]'),
      this.querySelector('[data-bind="pass-afking-dialog-error"]'),
    ].filter(Boolean);
    if (errEls.length === 0) return;
    for (const errEl of errEls) {
      errEl.textContent = String(msg);
      errEl.hidden = false;
    }
    if (this.#errorTimerAfking != null) {
      try { clearTimeout(this.#errorTimerAfking); } catch (_) { /* defensive */ }
    }
    this.#errorTimerAfking = setTimeout(() => this.#clearAfkingError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimerAfking && typeof this.#errorTimerAfking.unref === 'function') {
      try { this.#errorTimerAfking.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearAfkingError() {
    for (const errEl of [
      this.querySelector('[data-bind="pass-afking-error"]'),
      this.querySelector('[data-bind="pass-afking-dialog-error"]'),
    ].filter(Boolean)) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimerAfking != null) {
      try { clearTimeout(this.#errorTimerAfking); } catch (_) { /* defensive */ }
      this.#errorTimerAfking = null;
    }
  }

  // Cross-section error clearing (next-success-anywhere). Mirrors Phase 61 D-05.
  #clearAllErrorStates() {
    this.#clearWhaleError();
    this.#clearDeityError();
    this.#clearLazyError();
    this.#clearAfkingError();
  }
}

// Idempotency-guarded registration (Phase 58/59/60/61/62-01 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-pass-section')) {
    customElements.define('app-pass-section', AppPassSection);
  }
}

export { AppPassSection };
