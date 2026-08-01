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
//   CF-15: data-write attribute on whale buy CTA + each of 32 deity cells →
//          Phase 58 disable manager auto-disables when ui.mode === 'view-others'.
//
// Class palette: .pass-* prefix with sub-prefixes .pass-whale-* + .pass-deity-*.

import { CHAIN, ETH_DIVISOR } from '../app/chain-config.js';
import { displayEth } from '../app/scaling.js';
import { isAddress, parseEther } from 'ethers';
import { get, subscribe, getViewedAddress, getActingAddress, deriveCanSign } from '../app/store.js';
import { fetchJSON } from '../../beta/app/api.js';
import {
  purchaseWhaleBundle,
  purchaseDeityPass,
  purchaseLazyPass,
  deityPassErrorOverride,
  readDeityPassCatalog,
  readAfkingSubscription,
  claimAfkingSeat,
  updateAfkingSubscription,
  fundAfkingSubscription,
  readDeityBoonSlots,
  issueDeityBoon,
  smiteWithDeity,
} from '../app/passes.js';
import { boonTypePresentation } from '../app/boons.js';
import { scaledTicketPriceWei } from '../app/decimator.js';
import { activeTicketLevel } from '../app/active-level.js';
import { decodeRevertReason } from '../app/reason-map.js';
import './boon-product-indicator.js';

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
  const fileIdx = cat === 'cards' ? PASS_CARD_IDX[sym] : sym;
  return {
    path: `/badges-circular/${cat}_${String(fileIdx).padStart(2, '0')}_${PASS_SYMBOLS[cat][sym]}_gold.svg`,
    name: `${cat} ${PASS_SYMBOLS[cat][sym]}`,
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
// Boon discounts are not modeled — the static-call gate catches those.
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

function formatPassEth(raw, digits = 2) {
  try {
    const formatted = displayEth(BigInt(raw ?? 0), digits);
    return formatted.replace(/(?:\.0+|(?:(\.\d*?[1-9]))0+)$/, '$1') || '0';
  } catch (_error) {
    return '0';
  }
}

class AppPassSection extends HTMLElement {
  // --- Phase 60 / 61 / 62-01 idempotency-guard pattern ---
  #unsubs = [];
  #initialized = false;
  #busyWhale = false;
  #busyLazy = false;
  #busyAfking = false;
  #busyAfkingFunding = false;
  #busyAfkingSeat = false;
  #busyBoonSlot = null;
  #busyCurse = false;
  // Per-symbol-id debounce for the deity grid (T-62-02-05 mitigation).
  #busySymbols = new Set();
  #errorTimerWhale = null;
  #errorTimerDeity = null;
  #errorTimerLazy = null;
  #errorTimerAfking = null;
  #errorTimerBoon = null;
  #errorTimerCurse = null;
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
  #deityBoonState = null;
  #deityBoonAddress = null;
  #deityBoonFormAddress = null;

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
    if (this.#errorTimerBoon != null) {
      try { clearTimeout(this.#errorTimerBoon); } catch (_) { /* defensive */ }
      this.#errorTimerBoon = null;
    }
    if (this.#errorTimerCurse != null) {
      try { clearTimeout(this.#errorTimerCurse); } catch (_) { /* defensive */ }
      this.#errorTimerCurse = null;
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
        <div class="panel-header">
          <h2>PASSES</h2>
        </div>

        <!-- Account-switcher (2026-07-16): pass purchases are per-account
             writes with no combined-view analog — hidden alongside the buy
             rows in mode 'combined' (see #renderCombinedGate). -->
        <p class="pass-combined-note" data-bind="pass-combined-note" hidden></p>

        <!-- WHALE ROW (compact one-liner) -->
        <div class="pass-whale-row">
          <span class="pass-section-title">Whale pass
            <boon-product-indicator product="whale"></boon-product-indicator>
          </span>
          <input type="number" name="pass-whale-qty" id="pass-whale-qty-input"
                 class="pass-whale-input" min="1" max="100" step="1" value="1" aria-label="Whale pass quantity">
          <span class="pass-whale-price" data-bind="pass-whale-price">—</span>
          <button type="button" class="pass-whale-buy" data-write data-bind="pass-whale-buy">
            Buy
          </button>
        </div>
        <div class="pass-whale-error" data-bind="pass-whale-error" hidden role="alert"></div>

        <!-- LAZY ROW — visible ONLY when the level window is open
             (levels 0-2 / x9 / x0; WhaleModule.sol:431-438) -->
        <div class="pass-lazy-row" data-bind="pass-lazy-row" hidden>
          <span class="pass-section-title">Lazy pass
            <boon-product-indicator product="lazy"></boon-product-indicator>
          </span>
          <span class="pass-lazy-blurb">10 levels of auto-mint</span>
          <span class="pass-lazy-price" data-bind="pass-lazy-price">—</span>
          <button type="button" class="pass-lazy-buy" data-write data-bind="pass-lazy-buy">
            Buy
          </button>
        </div>
        <div class="pass-lazy-error" data-bind="pass-lazy-error" hidden role="alert"></div>

        <!-- AFKING SUBSCRIPTION — pass buyers first claim their free seat;
             minted-seat holders get the subscription editor immediately. -->
        <section class="pass-afking" data-bind="pass-afking" hidden>
          <div class="pass-afking__head">
            <span class="pass-section-title">AFKing subscription</span>
            <strong class="pass-afking__status" data-bind="pass-afking-status">SEAT READY</strong>
            <span class="pass-afking__funding" data-bind="pass-afking-funding">—</span>
          </div>
          <div class="pass-afking__claim" data-bind="pass-afking-claim" hidden>
            <span>Claim the included seat, then start with the settings below.</span>
            <button type="button" class="pass-afking__claim-button" data-write
                    data-bind="pass-afking-claim-button">1 · Claim seat</button>
          </div>
          <div class="pass-afking__lock" data-bind="pass-afking-lock" hidden role="status">
            <strong>RNG SETTLING</strong>
            <span>Settings and cancel unlock automatically. Funding stays open.</span>
          </div>
          <div class="pass-afking__controls" data-bind="pass-afking-controls" hidden>
            <label class="pass-afking__field">
              <span>Daily buy</span>
              <select name="pass-afking-mode" data-bind="pass-afking-mode">
                <option value="lootbox">Lootboxes</option>
                <option value="tickets">Tickets</option>
              </select>
            </label>
            <label class="pass-afking__field pass-afking__field--qty">
              <span>Per day</span>
              <input type="number" name="pass-afking-qty" min="1" max="255" step="1" value="1">
            </label>
            <label class="pass-afking__field pass-afking__field--fund">
              <span>Fund now</span>
              <input type="number" name="pass-afking-fund" min="0" step="0.01" value="0" inputmode="decimal">
              <small>ETH</small>
            </label>
            <button type="button" class="pass-afking__fund-button" data-write
                    data-bind="pass-afking-fund-button" hidden>Fund only</button>
            <label class="pass-afking__credit">
              <input type="checkbox" name="pass-afking-claimable-first" checked>
              <span>Claimable first</span>
            </label>
            <span class="pass-afking__costs">
              <span class="pass-afking__day-cost" data-bind="pass-afking-day-cost">—</span>
              <span class="pass-afking__coverage" data-bind="pass-afking-coverage">—</span>
            </span>
            <button type="button" class="pass-afking__save" data-write data-bind="pass-afking-save">Start</button>
            <button type="button" class="pass-afking__cancel" data-write data-bind="pass-afking-cancel" hidden>Cancel</button>
          </div>
          <div class="pass-afking-error" data-bind="pass-afking-error" hidden role="alert"></div>
        </section>

        <!-- DEITY PASS — intentionally the collapsed child of the default-open
             afKing pass section. Holders get the same picker header plus their
             three authoritative daily issuance slots inside the dropdown. -->
        <details class="pass-deity-section" data-bind="pass-deity-details">
          <summary class="pass-deity-summary">
            <span class="pass-section-title">Deity pass
              <boon-product-indicator product="deity"></boon-product-indicator>
            </span>
            <span class="pass-deity-hint" data-bind="pass-deity-hint">pick your symbol</span>
          </summary>
          <div class="pass-deity-body">
            <div class="pass-deity-picker">
              <span class="pass-deity-preview" aria-hidden="true">
                <img data-bind="pass-deity-preview" src="" alt="">
              </span>
              <strong class="pass-deity-owned-name" data-bind="pass-deity-owned-name" hidden></strong>
              <select class="pass-deity-select" name="pass-deity-symbol"
                      data-bind="pass-deity-select" aria-label="Deity pass symbol"></select>
              <button type="button" class="pass-deity-buy" data-write data-bind="pass-deity-buy">Buy</button>
            </div>
            <div class="pass-deity-error" data-bind="pass-deity-error" hidden role="alert"></div>

            <section class="pass-deity-boons" data-bind="pass-deity-boons" hidden>
              <div class="pass-deity-boons__head">
                <div>
                  <strong>Daily boons</strong>
                  <span>Give one to another player</span>
                </div>
                <span class="pass-deity-boons__status" data-bind="pass-deity-boons-status">SYNCING</span>
              </div>
              <label class="pass-deity-boons__recipient">
                <span>Recipient</span>
                <input type="text" name="pass-deity-boon-recipient"
                       placeholder="0x wallet address" autocomplete="off" spellcheck="false">
              </label>
              <div class="pass-deity-boons__slots" aria-label="Today's deity boons">
                <button type="button" class="pass-deity-boon-slot" data-write
                        data-bind="pass-deity-boon-slot-0" disabled>
                  <span data-bind="pass-deity-boon-name-0">Waiting for RNG</span>
                  <strong data-bind="pass-deity-boon-effect-0">SLOT 1</strong>
                </button>
                <button type="button" class="pass-deity-boon-slot" data-write
                        data-bind="pass-deity-boon-slot-1" disabled>
                  <span data-bind="pass-deity-boon-name-1">Waiting for RNG</span>
                  <strong data-bind="pass-deity-boon-effect-1">SLOT 2</strong>
                </button>
                <button type="button" class="pass-deity-boon-slot" data-write
                        data-bind="pass-deity-boon-slot-2" disabled>
                  <span data-bind="pass-deity-boon-name-2">Waiting for RNG</span>
                  <strong data-bind="pass-deity-boon-effect-2">SLOT 3</strong>
                </button>
              </div>
              <div class="pass-deity-boon-error" data-bind="pass-deity-boon-error" hidden role="alert"></div>
            </section>

            <section class="pass-deity-curse" data-bind="pass-deity-curse" hidden
                     title="Burn 200 FLIP to add two curse points. Active AFKing subscribers are immune.">
              <div class="pass-deity-curse__label">
                <strong>Quick curse</strong>
                <span>+2 curse · burns 200 FLIP</span>
              </div>
              <input type="text" name="pass-deity-curse-target"
                     placeholder="0x target wallet" aria-label="Wallet to curse"
                     autocomplete="off" spellcheck="false">
              <button type="button" class="pass-deity-curse__button" data-write
                      data-bind="pass-deity-curse-button">Curse · 200 FLIP</button>
              <div class="pass-deity-curse-error" data-bind="pass-deity-curse-error" hidden role="alert"></div>
            </section>
          </div>
        </details>
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
    const buy = this.querySelector('[data-bind="pass-deity-buy"]');
    if (buy) {
      buy.disabled = true;
      buy.setAttribute('data-write-locked', '');
      buy.setAttribute('data-write-lock-title', 'Checking symbol availability');
    }
  }

  #wireEventHandlers() {
    const whaleBuy = this.querySelector('[data-bind="pass-whale-buy"]');
    if (whaleBuy) whaleBuy.addEventListener('click', (e) => this.#onWhaleBuyClick(e));
    const lazyBuy = this.querySelector('[data-bind="pass-lazy-buy"]');
    if (lazyBuy) lazyBuy.addEventListener('click', (e) => this.#onLazyBuyClick(e));
    const deityBuy = this.querySelector('[data-bind="pass-deity-buy"]');
    if (deityBuy) deityBuy.addEventListener('click', (e) => this.#onDeityBuyClick(e));
    const deitySelect = this.querySelector('[data-bind="pass-deity-select"]');
    if (deitySelect) deitySelect.addEventListener('change', () => this.#renderDeityPreview());
    const afkingSave = this.querySelector('[data-bind="pass-afking-save"]');
    if (afkingSave) afkingSave.addEventListener('click', (e) => this.#onAfkingSave(e));
    const afkingClaim = this.querySelector('[data-bind="pass-afking-claim-button"]');
    if (afkingClaim) afkingClaim.addEventListener('click', (e) => this.#onAfkingSeatClaim(e));
    const afkingCancel = this.querySelector('[data-bind="pass-afking-cancel"]');
    if (afkingCancel) afkingCancel.addEventListener('click', (e) => this.#onAfkingCancel(e));
    const afkingQty = this.querySelector('[name="pass-afking-qty"]');
    if (afkingQty) afkingQty.addEventListener('input', () => this.#renderAfkingDayCost());
    const afkingMode = this.querySelector('[data-bind="pass-afking-mode"]');
    if (afkingMode) afkingMode.addEventListener('change', () => this.#renderAfkingDayCost());
    const afkingFund = this.querySelector('[name="pass-afking-fund"]');
    if (afkingFund) afkingFund.addEventListener('input', () => this.#renderAfkingDayCost());
    const afkingFundButton = this.querySelector('[data-bind="pass-afking-fund-button"]');
    if (afkingFundButton) afkingFundButton.addEventListener('click', (e) => this.#onAfkingFund(e));
    for (let slot = 0; slot < 3; slot += 1) {
      const boonButton = this.querySelector(`[data-bind="pass-deity-boon-slot-${slot}"]`);
      if (boonButton) boonButton.addEventListener('click', (e) => this.#onDeityBoonClick(e, slot));
    }
    const curseButton = this.querySelector('[data-bind="pass-deity-curse-button"]');
    if (curseButton) curseButton.addEventListener('click', (e) => this.#onDeityCurseClick(e));
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
      }
      if (String(actionTarget || '').toLowerCase() !== String(this.#deityBoonAddress || '').toLowerCase()) {
        this.#deityBoonState = null;
        this.#deityBoonFormAddress = null;
      }
      this.#pinnedAddress = addr;
      this.#deityBoonAddress = actionTarget;
      // Level comes from /game/state. Deity availability and issued count come
      // from the pass NFT, because /player has neither a global count nor the
      // 32-symbol ownership catalog.
      const [stateRes, playerRes, deityRes, afkingRes, deityBoonRes] = await Promise.allSettled([
        fetchJSON('/game/state'),
        addr ? fetchJSON(`/player/${addr}`) : Promise.resolve(null),
        readDeityPassCatalog(),
        actionTarget ? readAfkingSubscription(actionTarget) : Promise.resolve(null),
        actionTarget ? readDeityBoonSlots(actionTarget) : Promise.resolve(null),
      ]);
      if (signal.aborted) return;
      const gs = stateRes.status === 'fulfilled' ? stateRes.value : null;
      const data = playerRes.status === 'fulfilled' ? playerRes.value : null;
      const freshCatalog = deityRes.status === 'fulfilled' ? deityRes.value : null;
      if (freshCatalog) this.#deityCatalog = freshCatalog;
      this.#afkingState = afkingRes.status === 'fulfilled' ? afkingRes.value : null;
      this.#deityBoonState = deityBoonRes.status === 'fulfilled' ? deityBoonRes.value : null;
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
      this.#renderDeityBoons();
    });
    this.#unsubs.push(u1, u2, u3);
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
    if (deitySection) deitySection.hidden = isCombined;
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
    const priceEl = this.querySelector('[data-bind="pass-whale-price"]');
    if (priceEl) {
      if (!p || p.whaleUnitPriceWei == null) {
        priceEl.textContent = 'Loading price…';
      } else {
        try { priceEl.textContent = `${displayEth(p.whaleUnitPriceWei)} ETH each`; }
        catch (_e) { priceEl.textContent = '—'; }
      }
    }
    const hintEl = this.querySelector('[data-bind="pass-deity-hint"]');
    if (hintEl) {
      const ownedSymbolId = this.#ownedDeitySymbolId();
      if (ownedSymbolId != null) {
        const ownedName = passSymbolBadge(ownedSymbolId).name;
        hintEl.textContent = `your pass · ${ownedName}`;
      } else if (this.#deityCatalog?.issuedCount >= 32) {
        hintEl.textContent = 'sold out';
      } else if (p?.deityNextPriceWei != null) {
        try { hintEl.textContent = `pick your symbol · next pass ${displayEth(p.deityNextPriceWei)} ETH`; }
        catch (_e) { hintEl.textContent = 'pick your symbol'; }
      } else {
        hintEl.textContent = 'checking availability…';
      }
    }
    this.#renderDeityCatalog();
    this.#renderDeityBoons();
    this.#renderAfking();
    // Lazy row — visible ONLY when the level window is open (user ask).
    const lazyRow = this.querySelector('[data-bind="pass-lazy-row"]');
    if (lazyRow) {
      const open = Boolean(p?.lazyOpen && p?.lazyCostWei != null);
      lazyRow.hidden = !open;
      const lazyPrice = this.querySelector('[data-bind="pass-lazy-price"]');
      if (lazyPrice && open) {
        try { lazyPrice.textContent = `${displayEth(p.lazyCostWei)} ETH`; }
        catch (_e) { lazyPrice.textContent = '—'; }
      }
    }
    // Re-assert the combined-mode gate — this poll tick's price-window logic
    // above may have just re-revealed the lazy row; combined mode wins.
    this.#renderCombinedGate();
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
    const canSign = deriveCanSign();
    const select = this.querySelector('[data-bind="pass-deity-select"]');
    const buy = this.querySelector('[data-bind="pass-deity-buy"]');
    const ownedName = this.querySelector('[data-bind="pass-deity-owned-name"]');
    if (!select || !buy) return;

    const previous = Number(select.value);
    while (select.children?.length) select.removeChild(select.children[0]);

    let ids = [];
    if (ownedSymbolId != null) {
      ids = [ownedSymbolId];
    } else if (known) {
      ids = Array.from({ length: 32 }, (_unused, id) => id)
        .filter((id) => !catalog.takenSymbols.has(id));
    }

    if (!ids.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = known ? 'No symbols available' : 'Checking availability…';
      select.appendChild(option);
    } else {
      for (const symbolId of ids) {
        const badge = passSymbolBadge(symbolId);
        const option = document.createElement('option');
        option.value = String(symbolId);
        option.textContent = badge.name
          .split(' ')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' · ');
        select.appendChild(option);
      }
      const selected = ids.includes(previous) ? previous : ids[0];
      select.value = String(selected);
    }

    const busy = ids.some((id) => this.#busySymbols.has(id));
    let lockTitle = '';
    if (!known) lockTitle = 'Checking symbol availability';
    else if (ownedSymbolId != null) lockTitle = 'You already own this deity pass';
    else if (!ids.length) lockTitle = 'All deity symbols are taken';
    else if (busy) lockTitle = 'Purchase pending';

    const domainLocked = Boolean(lockTitle);
    if (ownedSymbolId != null) {
      const badge = passSymbolBadge(ownedSymbolId);
      const symbol = String(badge.name || '').trim().split(/\s+/).at(-1) || 'Symbol';
      if (ownedName) {
        ownedName.textContent = `God of ${symbol.charAt(0).toUpperCase()}${symbol.slice(1)}`;
        ownedName.hidden = false;
      }
      select.hidden = true;
      buy.hidden = true;
    } else {
      if (ownedName) {
        ownedName.textContent = '';
        ownedName.hidden = true;
      }
      select.hidden = false;
      buy.hidden = false;
    }
    select.disabled = domainLocked || !canSign;
    buy.disabled = domainLocked || !canSign;
    for (const control of [select, buy]) {
      if (domainLocked) {
        control.setAttribute('data-write-locked', '');
        control.setAttribute('data-write-lock-title', lockTitle);
      } else {
        control.removeAttribute('data-write-locked');
        control.removeAttribute('data-write-lock-title');
      }
    }
    buy.textContent = this.#pricingData?.deityNextPriceWei == null
      ? 'Buy'
      : `Buy · ${formatPassEth(this.#pricingData.deityNextPriceWei)} ETH`;
    this.#renderDeityPreview();
  }

  #renderDeityPreview() {
    const select = this.querySelector('[data-bind="pass-deity-select"]');
    const preview = this.querySelector('[data-bind="pass-deity-preview"]');
    if (!preview) return;
    const symbolId = Number(select?.value);
    if (!Number.isInteger(symbolId) || symbolId < 0 || symbolId > 31) {
      preview.src = '';
      preview.alt = '';
      preview.hidden = true;
      return;
    }
    const badge = passSymbolBadge(symbolId);
    preview.src = badge.path;
    preview.alt = badge.name;
    preview.hidden = false;
  }

  #renderDeityBoons() {
    const section = this.querySelector('[data-bind="pass-deity-boons"]');
    const curseSection = this.querySelector('[data-bind="pass-deity-curse"]');
    if (!section && !curseSection) return;
    const holderAddress = this.#deityBoonAddress || getActingAddress() || this.#pinnedAddress;
    const deityId = this.#ownedDeitySymbolId(holderAddress);
    const ownsPass = deityId != null;
    const visible = Boolean(ownsPass && get('ui.mode') !== 'combined');
    // smite() is stricter than the operator-aware boon path: msg.sender must
    // directly own this deity token, so never offer it while acting for another
    // account in operator mode.
    const connectedDeityId = this.#ownedDeitySymbolId(get('connected.address'));
    const curseVisible = Boolean(visible && get('ui.mode') === 'self' && connectedDeityId === deityId);
    if (section) section.hidden = !visible;
    if (curseSection) curseSection.hidden = !curseVisible;

    const details = this.querySelector('[data-bind="pass-deity-details"]');
    details?.classList?.toggle('pass-deity-section--holder', visible);
    if (!visible) return;

    const addressKey = String(holderAddress || '').toLowerCase();
    const recipient = this.querySelector('[name="pass-deity-boon-recipient"]');
    const curseTarget = this.querySelector('[name="pass-deity-curse-target"]');
    if (this.#deityBoonFormAddress !== addressKey) {
      if (recipient) recipient.value = '';
      if (curseTarget) curseTarget.value = '';
      this.#deityBoonFormAddress = addressKey;
    }

    // Cursing is not RNG/day gated. Ownership, signer state, and the contract's
    // static-call are the complete gate; the latter catches AFKing immunity and
    // the five-stack ceiling before the wallet opens.
    const curseButton = this.querySelector('[data-bind="pass-deity-curse-button"]');
    const canCurse = Boolean(curseVisible && deriveCanSign() && !this.#busyCurse);
    if (curseTarget) curseTarget.disabled = !canCurse;
    if (curseButton) {
      curseButton.disabled = !canCurse;
      curseButton.textContent = this.#busyCurse ? 'Cursing…' : 'Curse · 200 FLIP';
    }

    const state = this.#deityBoonState;
    const usedMask = Number(state?.usedMask ?? 0) & 0b111;
    const usedCount = [0, 1, 2].filter((slot) => (usedMask & (1 << slot)) !== 0).length;
    const remaining = 3 - usedCount;
    const status = this.querySelector('[data-bind="pass-deity-boons-status"]');
    if (status) {
      if (!state) status.textContent = 'SYNCING';
      else if (!state.ready) status.textContent = `DAY ${state.day} · RNG PENDING`;
      else status.textContent = `DAY ${state.day} · ${remaining}/3 LEFT`;
    }

    const canIssue = Boolean(state?.ready && remaining > 0 && deriveCanSign());
    if (recipient) recipient.disabled = !canIssue || this.#busyBoonSlot != null;

    for (let slot = 0; slot < 3; slot += 1) {
      const button = this.querySelector(`[data-bind="pass-deity-boon-slot-${slot}"]`);
      const name = this.querySelector(`[data-bind="pass-deity-boon-name-${slot}"]`);
      const effect = this.querySelector(`[data-bind="pass-deity-boon-effect-${slot}"]`);
      if (!button || !name || !effect) continue;

      const boonType = Number(state?.slots?.[slot] ?? 0);
      const used = (usedMask & (1 << slot)) !== 0;
      const presentation = boonType > 0 ? boonTypePresentation(boonType) : null;
      name.textContent = presentation?.name || (state?.ready ? 'Boon unavailable' : 'Waiting for RNG');
      effect.textContent = used
        ? 'ISSUED'
        : (presentation?.effect || `SLOT ${slot + 1}`);
      button.disabled = !canIssue || used || this.#busyBoonSlot != null;
      button.classList.toggle('pass-deity-boon-slot--used', used);
      button.classList.toggle('pass-deity-boon-slot--busy', this.#busyBoonSlot === slot);
      button.title = used
        ? 'Already issued today'
        : (presentation?.detail || 'Available after today\'s RNG resolves');
    }
  }

  #afkingMintPriceWei() {
    const snapshotPrice = BigInt(this.#afkingState?.mintPriceWei ?? 0n);
    if (snapshotPrice > 0n) return snapshotPrice;
    const targetLevel = activeTicketLevel(this.#gameState);
    if (targetLevel == null) return 0n;
    try { return scaledTicketPriceWei(targetLevel); }
    catch (_error) { return 0n; }
  }

  #afkingFundingInputWei() {
    const input = this.querySelector('[name="pass-afking-fund"]');
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
    const fundButton = this.querySelector('[data-bind="pass-afking-fund-button"]');
    if (!cost && !coverage && !save && !fundButton) return;
    const quantity = Math.min(255, Math.max(1, Number.parseInt(qtyInput?.value || '1', 10) || 1));
    const mintPrice = this.#afkingMintPriceWei();
    const dayCost = mintPrice * BigInt(quantity);
    if (cost) {
      cost.textContent = dayCost > 0n
        ? `COST / DAY · ${formatPassEth(dayCost)} ETH`
        : 'COST / DAY · —';
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
      const needsSeat = Boolean(!this.#afkingState?.hasToken && this.#afkingState?.canClaimSeat);
      if (this.#afkingState?.rngLocked) {
        save.textContent = 'RNG settling';
      } else if (needsSeat) {
        save.textContent = 'Claim seat first';
      } else {
        const action = this.#afkingState?.active ? 'Update' : 'Start';
        const fundingLabel = addedFunding != null && addedFunding > 0n
          ? ` + ${formatPassEth(addedFunding, 6)} ETH`
          : '';
        save.textContent = `${action}${fundingLabel}`;
      }
    }

    if (fundButton) {
      const active = Boolean(this.#afkingState?.hasToken && this.#afkingState?.active);
      fundButton.hidden = !active;
      fundButton.textContent = this.#busyAfkingFunding
        ? 'Funding…'
        : (addedFunding != null && addedFunding > 0n
          ? `Fund only · ${formatPassEth(addedFunding, 6)} ETH`
          : 'Fund only');
      const fundLocked = !active
        || this.#busyAfking
        || this.#busyAfkingFunding
        || addedFunding == null
        || addedFunding <= 0n;
      const fundLockTitle = !active
        ? 'Start the subscription with funding first'
        : this.#busyAfking || this.#busyAfkingFunding
          ? 'Funding transaction pending'
          : addedFunding == null || addedFunding <= 0n
            ? 'Enter an ETH amount to add'
            : '';
      _setDomainWriteLock(fundButton, fundLocked, fundLockTitle);
      if (!fundLocked) {
        fundButton.title = 'Add prepaid ETH without changing the daily settings; available during RNG locks';
      }
    }
  }

  #syncAfkingLockPolling() {
    const locked = Boolean(this.#afkingState?.rngLocked);
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
    const visible = Boolean(
      state && (state.hasToken || state.canClaimSeat) && get('ui.mode') !== 'combined',
    );
    section.hidden = !visible;
    if (!visible) {
      this.#syncAfkingLockPolling();
      return;
    }

    const claim = this.querySelector('[data-bind="pass-afking-claim"]');
    const lockNotice = this.querySelector('[data-bind="pass-afking-lock"]');
    const controls = this.querySelector('[data-bind="pass-afking-controls"]');
    const needsSeat = Boolean(!state.hasToken && state.canClaimSeat);
    if (claim) claim.hidden = !needsSeat;
    if (lockNotice) {
      lockNotice.hidden = !state.rngLocked;
      lockNotice.textContent = 'RNG SETTLING · Settings and cancel unlock automatically. Funding stays open.';
    }
    // Keep the complete editor visible before the free seat is claimed. This
    // lets an eligible pass holder choose delivery, amount, and funding first;
    // the settings survive the seat transaction and Start unlocks immediately.
    if (controls) controls.hidden = false;

    const addressKey = String(this.#pinnedAddress || '').toLowerCase();
    const qtyInput = this.querySelector('[name="pass-afking-qty"]');
    const modeInput = this.querySelector('[data-bind="pass-afking-mode"]');
    const fundInput = this.querySelector('[name="pass-afking-fund"]');
    const creditInput = this.querySelector('[name="pass-afking-claimable-first"]');
    if (this.#afkingFormAddress !== addressKey) {
      if (qtyInput) qtyInput.value = String(state.active ? Math.max(1, state.dailyQuantity) : 1);
      if (modeInput) modeInput.value = 'lootbox';
      if (fundInput) fundInput.value = '0';
      if (creditInput) creditInput.checked = true;
      this.#afkingFormAddress = addressKey;
    }
    const mintPrice = this.#afkingMintPriceWei();
    if (this.#afkingFundingSeededAddress !== addressKey && mintPrice > 0n) {
      // A funding field is useful for top-ups as well as first activation.
      // Seed both active and inactive holders with ten ticket prices once per
      // account, then leave their edits alone across the 30-second poll cycle.
      if (fundInput) fundInput.value = formatPassEth(mintPrice * 10n, 6);
      this.#afkingFundingSeededAddress = addressKey;
    }

    const status = this.querySelector('[data-bind="pass-afking-status"]');
    if (status) {
      status.textContent = needsSeat
        ? 'FREE SEAT READY'
        : (state.active ? `ACTIVE · ${state.dailyQuantity}/DAY` : 'SEAT READY');
      status.classList.toggle('pass-afking__status--active', Boolean(state.active));
    }
    const funding = this.querySelector('[data-bind="pass-afking-funding"]');
    if (funding) {
      funding.textContent = `FUNDS · ${formatPassEth(state.fundingWei)} ETH`;
    }

    const claimButton = this.querySelector('[data-bind="pass-afking-claim-button"]');
    if (claimButton) {
      claimButton.textContent = this.#busyAfkingSeat ? 'Claiming…' : '1 · Claim seat';
      _setDomainWriteLock(
        claimButton,
        !needsSeat || this.#busyAfkingSeat,
        this.#busyAfkingSeat ? 'Seat claim pending' : 'Seat already claimed',
      );
    }
    const save = this.querySelector('[data-bind="pass-afking-save"]');
    const cancel = this.querySelector('[data-bind="pass-afking-cancel"]');
    const locked = Boolean(state.rngLocked || this.#busyAfking || this.#busyAfkingFunding);
    if (save) {
      save.textContent = this.#busyAfking
        ? 'Saving…'
        : state.rngLocked
          ? 'RNG settling'
          : needsSeat
            ? '2 · Start after claim'
            : (state.active ? 'Update' : 'Start');
      const saveLockTitle = needsSeat
        ? 'Claim the included AFKing seat first'
        : state.rngLocked
          ? 'Settings unlock automatically after RNG resolves'
          : this.#busyAfking || this.#busyAfkingFunding
            ? 'Transaction pending'
            : '';
      _setDomainWriteLock(save, needsSeat || locked, saveLockTitle);
    }
    if (cancel) {
      cancel.hidden = !state.active;
      _setDomainWriteLock(
        cancel,
        locked,
        state.rngLocked ? 'Cancel unlocks automatically after RNG resolves' : 'Transaction pending',
      );
    }
    this.#renderAfkingDayCost();
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
      const cost = this.#pricingData?.lazyCostWei;
      if (cost == null) {
        this.#renderLazyError('Price unavailable — try again in a moment.');
        return;
      }
      await purchaseLazyPass({ msgValueWei: cost });

      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'lazy' },
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
      const unit = this.#pricingData?.whaleUnitPriceWei ?? 0n;
      const msgValueWei = unit * BigInt(quantity);

      await purchaseWhaleBundle({ quantity, msgValueWei });

      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'whale', quantity },
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
      setTimeout(() => { this.#busyWhale = false; }, DEBOUNCE_MS);
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
      const msgValueWei = this.#pricingData.deityNextPriceWei;
      await purchaseDeityPass({ symbolId, msgValueWei });

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
          detail: { kind: 'deity', symbolId },
          bubbles: true,
        }));
      } catch (_e) { /* defensive */ }

      this.#clearAllErrorStates();
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

  async #onDeityBoonClick(e, slot) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyBoonSlot != null || !deriveCanSign()) return;
    const actingAddress = getActingAddress();
    if (!actingAddress || this.#ownedDeitySymbolId(actingAddress) == null) return;
    if (!this.#deityBoonState?.ready) return;
    const slotNumber = Number(slot);
    if (!Number.isInteger(slotNumber) || slotNumber < 0 || slotNumber > 2) return;
    if ((Number(this.#deityBoonState.usedMask || 0) & (1 << slotNumber)) !== 0) return;

    const recipientInput = this.querySelector('[name="pass-deity-boon-recipient"]');
    const recipient = String(recipientInput?.value || '').trim();
    if (!isAddress(recipient)) {
      this.#renderBoonError('Enter a valid recipient wallet address.');
      return;
    }
    if (recipient.toLowerCase() === String(actingAddress).toLowerCase()) {
      this.#renderBoonError('Choose someone other than yourself.');
      return;
    }

    this.#busyBoonSlot = slotNumber;
    this.#clearBoonError();
    this.#renderDeityBoons();
    try {
      await issueDeityBoon({ recipient, slot: slotNumber });
      // The receipt has confirmed at this point, so lock the consumed slot now;
      // the debounced read below reconciles the new mask from chain state.
      this.#deityBoonState = {
        ...this.#deityBoonState,
        usedMask: Number(this.#deityBoonState.usedMask || 0) | (1 << slotNumber),
      };
      if (recipientInput) recipientInput.value = '';
      this.#clearAllErrorStates();
      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'deity-boon', slot: slotNumber, recipient },
          bubbles: true,
        }));
      } catch (_error) { /* defensive */ }
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      const decoded = error?.userMessage ? error : decodeRevertReason(error);
      this.#renderBoonError(decoded?.userMessage || error?.message || 'Could not give that boon.');
    } finally {
      this.#busyBoonSlot = null;
      this.#renderDeityBoons();
    }
  }

  async #onDeityCurseClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyCurse || !deriveCanSign() || get('ui.mode') !== 'self') return;
    const deityId = this.#ownedDeitySymbolId(get('connected.address'));
    if (deityId == null) return;

    const targetInput = this.querySelector('[name="pass-deity-curse-target"]');
    const target = String(targetInput?.value || '').trim();
    if (!isAddress(target) || /^0x0{40}$/i.test(target)) {
      this.#renderCurseError('Enter a valid target wallet address.');
      return;
    }

    this.#busyCurse = true;
    this.#clearCurseError();
    this.#renderDeityBoons();
    try {
      await smiteWithDeity({ deityId, target });
      if (targetInput) targetInput.value = '';
      this.#clearAllErrorStates();
      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'deity-curse', deityId, target },
          bubbles: true,
        }));
      } catch (_error) { /* defensive */ }
    } catch (error) {
      const decoded = error?.userMessage ? error : decodeRevertReason(error);
      this.#renderCurseError(decoded?.userMessage || error?.message || 'Could not curse that player.');
    } finally {
      this.#busyCurse = false;
      this.#renderDeityBoons();
    }
  }

  async #onAfkingFund(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyAfking || this.#busyAfkingFunding || !this.#afkingState?.active) return;
    const msgValueWei = this.#afkingFundingInputWei();
    if (msgValueWei == null || msgValueWei <= 0n) {
      this.#renderAfkingError('Enter an ETH amount to add.');
      return;
    }

    this.#busyAfkingFunding = true;
    this.#clearAfkingError();
    this.#renderAfking();
    try {
      await fundAfkingSubscription({ msgValueWei });
      const fundInput = this.querySelector('[name="pass-afking-fund"]');
      if (fundInput) fundInput.value = '0';
      this.#clearAllErrorStates();
      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'afking-funding', amountWei: msgValueWei },
          bubbles: true,
        }));
      } catch (_error) { /* defensive */ }
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderAfkingError(error?.userMessage || error?.message || 'Funding failed.');
    } finally {
      this.#busyAfkingFunding = false;
      this.#renderAfking();
    }
  }

  async #onAfkingSave(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyAfking || this.#afkingState?.rngLocked || !this.#afkingState?.hasToken) return;

    const qtyInput = this.querySelector('[name="pass-afking-qty"]');
    const modeInput = this.querySelector('[data-bind="pass-afking-mode"]');
    const creditInput = this.querySelector('[name="pass-afking-claimable-first"]');
    const fundInput = this.querySelector('[name="pass-afking-fund"]');
    const dailyQuantity = Number.parseInt(qtyInput?.value || '0', 10);
    if (!Number.isInteger(dailyQuantity) || dailyQuantity < 1 || dailyQuantity > 255) {
      this.#renderAfkingError('Daily size must be 1-255.');
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
      await updateAfkingSubscription({
        dailyQuantity,
        useTickets: modeInput?.value !== 'lootbox',
        drainGameCreditFirst: Boolean(creditInput?.checked),
        msgValueWei,
      });
      this.#afkingState = { ...this.#afkingState, active: true, dailyQuantity };
      if (fundInput) fundInput.value = '0';
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

  async #onAfkingSeatClaim(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyAfkingSeat || !this.#afkingState?.canClaimSeat || !deriveCanSign()) return;
    // Cosmetic editing can come later; use the deity badge when there is one
    // and stable defaults for the required on-chain color fields.
    const symbolId = this.#ownedDeitySymbolId() ?? 0;
    const bgRgb = 0xd9d9d9;
    const trimRgb = 0xc72734;

    this.#busyAfkingSeat = true;
    this.#clearAfkingError();
    this.#renderAfking();
    try {
      await claimAfkingSeat({ symbolId, bgRgb, trimRgb });
      this.#afkingState = {
        ...this.#afkingState,
        hasToken: true,
        canClaimSeat: false,
        tokenBalance: BigInt(this.#afkingState.tokenBalance ?? 0n) + 1n,
      };
      this.#clearAllErrorStates();
      try {
        this.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
          detail: { kind: 'afking-seat', symbolId },
          bubbles: true,
        }));
      } catch (_error) { /* defensive */ }
      setTimeout(() => this.#runPollCycle(), POST_CONFIRM_REFETCH_MS);
    } catch (error) {
      this.#renderAfkingError(error?.userMessage || error?.message || 'Seat claim failed.');
    } finally {
      this.#busyAfkingSeat = false;
      this.#renderAfking();
    }
  }

  async #onAfkingCancel(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busyAfking || this.#afkingState?.rngLocked || !this.#afkingState?.active) return;
    this.#busyAfking = true;
    this.#clearAfkingError();
    this.#renderAfking();
    try {
      await updateAfkingSubscription({ dailyQuantity: 0, msgValueWei: 0n });
      this.#afkingState = { ...this.#afkingState, active: false, dailyQuantity: 0 };
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
    const errEl = this.querySelector('[data-bind="pass-afking-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimerAfking != null) {
      try { clearTimeout(this.#errorTimerAfking); } catch (_) { /* defensive */ }
    }
    this.#errorTimerAfking = setTimeout(() => this.#clearAfkingError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimerAfking && typeof this.#errorTimerAfking.unref === 'function') {
      try { this.#errorTimerAfking.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearAfkingError() {
    const errEl = this.querySelector('[data-bind="pass-afking-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimerAfking != null) {
      try { clearTimeout(this.#errorTimerAfking); } catch (_) { /* defensive */ }
      this.#errorTimerAfking = null;
    }
  }

  #renderBoonError(msg) {
    const errEl = this.querySelector('[data-bind="pass-deity-boon-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimerBoon != null) {
      try { clearTimeout(this.#errorTimerBoon); } catch (_) { /* defensive */ }
    }
    this.#errorTimerBoon = setTimeout(() => this.#clearBoonError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimerBoon && typeof this.#errorTimerBoon.unref === 'function') {
      try { this.#errorTimerBoon.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearBoonError() {
    const errEl = this.querySelector('[data-bind="pass-deity-boon-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimerBoon != null) {
      try { clearTimeout(this.#errorTimerBoon); } catch (_) { /* defensive */ }
      this.#errorTimerBoon = null;
    }
  }

  #renderCurseError(msg) {
    const errEl = this.querySelector('[data-bind="pass-deity-curse-error"]');
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.hidden = false;
    if (this.#errorTimerCurse != null) {
      try { clearTimeout(this.#errorTimerCurse); } catch (_) { /* defensive */ }
    }
    this.#errorTimerCurse = setTimeout(() => this.#clearCurseError(), ERROR_AUTO_CLEAR_MS);
    if (this.#errorTimerCurse && typeof this.#errorTimerCurse.unref === 'function') {
      try { this.#errorTimerCurse.unref(); } catch (_) { /* defensive */ }
    }
  }

  #clearCurseError() {
    const errEl = this.querySelector('[data-bind="pass-deity-curse-error"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (this.#errorTimerCurse != null) {
      try { clearTimeout(this.#errorTimerCurse); } catch (_) { /* defensive */ }
      this.#errorTimerCurse = null;
    }
  }

  // Cross-section error clearing (next-success-anywhere). Mirrors Phase 61 D-05.
  #clearAllErrorStates() {
    this.#clearWhaleError();
    this.#clearDeityError();
    this.#clearLazyError();
    this.#clearAfkingError();
    this.#clearBoonError();
    this.#clearCurseError();
  }
}

// Idempotency-guarded registration (Phase 58/59/60/61/62-01 pattern).
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-pass-section')) {
    customElements.define('app-pass-section', AppPassSection);
  }
}

export { AppPassSection };
