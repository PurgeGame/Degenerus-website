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
import { parseEther } from 'ethers';
import { get, subscribe, getViewedAddress, getActingAddress, deriveCanSign } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import {
  purchaseWhaleBundle,
  purchaseDeityPass,
  purchaseLazyPass,
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
        <div class="panel-header pass-desk-header">
          <div>
            <h2>PASSES</h2>
            <p>Long-term perks, daily powers, and automated play.</p>
          </div>
        </div>

        <!-- Account-switcher (2026-07-16): pass purchases are per-account
             writes with no combined-view analog — hidden alongside the buy
             rows in mode 'combined' (see #renderCombinedGate). -->
        <p class="pass-combined-note" data-bind="pass-combined-note" hidden></p>

        <div class="pass-shop-heading" data-bind="pass-shop-heading">
          <div>
            <strong>PASS SHOP</strong>
            <span data-bind="pass-shop-seat-copy">Every pass includes an AFKing automation seat.</span>
          </div>
          <small>ONE-TIME PURCHASES</small>
        </div>

        <!-- LAZY ROW — visible ONLY when the level window is open
             (levels 0-2 / x9 / x0; WhaleModule.sol:431-438). It is the
             shorter commitment, so it leads the premium-product shelf. -->
        <div class="pass-lazy-row pass-product-row pass-product-row--lazy" data-bind="pass-lazy-row" hidden>
          <span class="pass-product-heading">
            <span class="pass-product-sigil pass-product-sigil--lazy" aria-hidden="true">10</span>
            <span class="pass-product-copy">
              <span class="pass-section-title">Lazy pass
                <boon-product-indicator product="lazy"></boon-product-indicator>
              </span>
              <span class="pass-product-description">One ticket every level for the next 10 levels.</span>
            </span>
          </span>
          <span class="pass-product-perks" aria-label="Lazy pass benefits">
            <span class="pass-lootbox-perk pass-lazy-lootbox-perk" data-bind="pass-lazy-lootbox">BONUS LOOTBOX · 10% OF PASS</span>
            <span data-bind="pass-lazy-score">+85% DEGEN SCORE</span>
            <span data-bind="pass-lazy-afking-seat">AFKING SEAT</span>
          </span>
          <span class="pass-product-checkout pass-product-checkout--lazy">
            <button type="button" class="pass-lazy-buy" data-write data-bind="pass-lazy-buy">
              BUY LAZY PASS · …
            </button>
          </span>
        </div>
        <div class="pass-lazy-error" data-bind="pass-lazy-error" hidden role="alert"></div>

        <!-- WHALE ROW -->
        <div class="pass-whale-row pass-product-row pass-product-row--whale">
          <span class="pass-product-heading">
            <span class="pass-product-sigil pass-product-sigil--whale" aria-hidden="true">100</span>
            <span class="pass-product-copy">
              <span class="pass-section-title">Whale pass
                <boon-product-indicator product="whale"></boon-product-indicator>
              </span>
              <span class="pass-product-description">One ticket every other level for the next 100 levels.</span>
            </span>
          </span>
          <span class="pass-product-perks" aria-label="Whale pass benefits">
            <span class="pass-lootbox-perk pass-whale-lootbox-perk" data-bind="pass-whale-lootbox">BONUS LOOTBOX · 10% OF PASS</span>
            <span data-bind="pass-whale-score">+115% DEGEN SCORE</span>
            <span class="pass-whale-afking-seat" data-bind="pass-whale-afking-seat">AFKING SEAT</span>
          </span>
          <span class="pass-product-checkout pass-product-checkout--whale">
            <span class="pass-product-quantity">
              <small>QTY</small>
              <input type="number" name="pass-whale-qty" id="pass-whale-qty-input"
                     class="pass-whale-input" min="1" max="100" step="1" value="1" aria-label="Whale pass quantity">
              <span class="pass-whale-steps">
                <button type="button" data-bind="pass-whale-qty-up" aria-label="Increase Whale pass quantity">▲</button>
                <button type="button" data-bind="pass-whale-qty-down" aria-label="Decrease Whale pass quantity">▼</button>
              </span>
            </span>
            <button type="button" class="pass-whale-buy" data-write data-bind="pass-whale-buy">
              BUY WHALE PASS · …
            </button>
          </span>
        </div>
        <div class="pass-whale-error" data-bind="pass-whale-error" hidden role="alert"></div>

        <!-- DEITY PASS — buyers use the compact dropdown; holders get their
             owned symbol and daily controls already open. -->
        <details class="pass-deity-section" data-bind="pass-deity-details">
          <summary class="pass-deity-summary" data-bind="pass-deity-summary">
            <span class="pass-product-heading">
              <span class="pass-product-sigil pass-product-sigil--deity" aria-hidden="true">∞</span>
              <span class="pass-product-copy">
                <span class="pass-product-eyebrow" data-bind="pass-deity-eyebrow">LIFETIME PASS</span>
                <span class="pass-section-title">Deity pass
                  <boon-product-indicator product="deity"></boon-product-indicator>
                </span>
                <span class="pass-product-description">Permanent symbol coverage and three boons every day.</span>
              </span>
            </span>
            <span class="pass-product-perks pass-product-perks--deity" aria-label="Deity pass benefits">
              <span>PERMANENT</span>
              <span data-bind="pass-deity-score">+155% DEGEN SCORE</span>
              <span>3 DAILY BOONS</span>
              <span>10% LOOTBOX</span>
              <span data-bind="pass-deity-afking-seat">AFKING SEAT</span>
            </span>
            <span class="pass-deity-price">
              <small data-bind="pass-deity-meta-label">LIVE PRICE</small>
              <strong class="pass-deity-hint" data-bind="pass-deity-hint">pick your symbol</strong>
            </span>
          </summary>
          <div class="pass-deity-body">
            <div class="pass-deity-picker">
              <strong class="pass-deity-owned-name" data-bind="pass-deity-owned-name" hidden></strong>
              <span class="pass-deity-preview" aria-hidden="true">
                <img data-bind="pass-deity-preview" src="" alt="">
              </span>
              <select class="pass-deity-select" name="pass-deity-symbol"
                      data-bind="pass-deity-select" aria-label="Deity pass symbol"></select>
              <button type="button" class="pass-deity-buy" data-write data-bind="pass-deity-buy">Buy</button>
            </div>
            <div class="pass-deity-error" data-bind="pass-deity-error" hidden role="alert"></div>

          </div>
        </details>
      </section>

      <!-- AFKING SUBSCRIPTION is its own instrument below the premium passes.
           The seat arrives automatically with any pass, so every holder sees
           the complete editor immediately — there is no claim step. -->
      <section class="panel pass-afking" data-bind="pass-afking" hidden>
        <div class="pass-afking__head">
          <span class="pass-product-heading">
            <span class="pass-product-sigil pass-product-sigil--afking" aria-hidden="true">AUTO</span>
            <span class="pass-product-copy">
              <span class="pass-section-title">AFKing subscription</span>
              <span class="pass-product-description">Place an automatic order at each jackpot.</span>
            </span>
          </span>
          <div class="pass-afking__meta">
            <strong class="pass-afking__status" data-bind="pass-afking-status">SEAT READY</strong>
            <span class="pass-afking__wallet">
              <span class="pass-afking__balance">
                <small>PREPAID BALANCE</small>
                <span class="pass-afking__funding" data-bind="pass-afking-funding">—</span>
              </span>
              <button type="button" class="pass-afking__claim-button" data-write
                      data-bind="pass-afking-flip-claim" hidden>CLAIM</button>
              <button type="button" class="pass-afking__withdraw" data-write
                      data-bind="pass-afking-withdraw" hidden>Withdraw all</button>
            </span>
          </div>
        </div>
        <div class="pass-afking__lock" data-bind="pass-afking-lock" hidden role="status">
          <strong>RNG SETTLING</strong>
          <span>Settings and cancel unlock automatically. Funding and withdrawals stay open.</span>
        </div>
        <div class="pass-afking__controls" data-bind="pass-afking-controls" hidden>
          <section class="pass-afking__control-card pass-afking__order-card">
            <header class="pass-afking__control-head">
              <span>NEXT JACKPOT</span>
              <strong>Automatic order</strong>
              <small>Runs when the next jackpot begins.</small>
            </header>
            <div class="pass-afking__order-fields">
              <label class="pass-afking__field">
                <span>Product</span>
                <select name="pass-afking-mode" data-bind="pass-afking-mode">
                  <option value="lootbox">Lootboxes</option>
                  <option value="tickets">Tickets</option>
                </select>
              </label>
              <label class="pass-afking__field pass-afking__field--qty">
                <span>Quantity</span>
                <input type="number" name="pass-afking-qty" min="1" max="255" step="1" value="1">
              </label>
            </div>
          </section>
          <section class="pass-afking__control-card pass-afking__funding-card">
            <header class="pass-afking__control-head">
              <span>PREPAID ETH</span>
              <strong>Subscription funding</strong>
              <small>Add funds now or top up without changing the order.</small>
            </header>
            <div class="pass-afking__funding-controls">
              <label class="pass-afking__field pass-afking__field--fund">
                <span>Add funds</span>
                <input type="number" name="pass-afking-fund" min="0" step="0.01" value="0" inputmode="decimal">
                <small>ETH</small>
              </label>
              <button type="button" class="pass-afking__fund-button" data-write
                      data-bind="pass-afking-fund-button" hidden>Fund only</button>
            </div>
          </section>
          <label class="pass-afking__credit">
            <input type="checkbox" name="pass-afking-claimable-first" checked>
            <span>Use claimable ETH before prepaid funds</span>
          </label>
          <span class="pass-afking__costs">
            <span class="pass-afking__day-cost" data-bind="pass-afking-day-cost">—</span>
            <span class="pass-afking__coverage" data-bind="pass-afking-coverage">—</span>
          </span>
          <div class="pass-afking__actions">
            <button type="button" class="pass-afking__save" data-write data-bind="pass-afking-save">Start</button>
            <button type="button" class="pass-afking__cancel" data-write data-bind="pass-afking-cancel" hidden>Cancel</button>
          </div>
        </div>
        <div class="pass-afking-error" data-bind="pass-afking-error" hidden role="alert"></div>
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
    const deityBuy = this.querySelector('[data-bind="pass-deity-buy"]');
    if (deityBuy) deityBuy.addEventListener('click', (e) => this.#onDeityBuyClick(e));
    const deitySelect = this.querySelector('[data-bind="pass-deity-select"]');
    if (deitySelect) deitySelect.addEventListener('change', () => this.#renderDeityPreview());
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
    const afkingFundButton = this.querySelector('[data-bind="pass-afking-fund-button"]');
    if (afkingFundButton) afkingFundButton.addEventListener('click', (e) => this.#onAfkingFund(e));
    const afkingWithdraw = this.querySelector('[data-bind="pass-afking-withdraw"]');
    if (afkingWithdraw) afkingWithdraw.addEventListener('click', (e) => this.#onAfkingWithdraw(e));
    const afkingFlipClaim = this.querySelector('[data-bind="pass-afking-flip-claim"]');
    if (afkingFlipClaim) afkingFlipClaim.addEventListener('click', (e) => this.#onAfkingFlipClaim(e));
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
      this.#pinnedAddress = addr;
      // Level comes from /game/state. Deity availability and issued count come
      // from the pass NFT, because /player has neither a global count nor the
      // 32-symbol ownership catalog.
      const [stateRes, playerRes, deityRes, afkingRes] = await Promise.allSettled([
        fetchJSON('/game/state'),
        addr ? fetchJSON(`/player/${addr}`) : Promise.resolve(null),
        readDeityPassCatalog(),
        actionTarget ? readAfkingSubscription(actionTarget) : Promise.resolve(null),
      ]);
      if (signal.aborted) return;
      const gs = stateRes.status === 'fulfilled' ? stateRes.value : null;
      const data = playerRes.status === 'fulfilled' ? playerRes.value : null;
      const freshCatalog = deityRes.status === 'fulfilled' ? deityRes.value : null;
      if (freshCatalog) this.#deityCatalog = freshCatalog;
      this.#afkingState = afkingRes.status === 'fulfilled' ? afkingRes.value : null;
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
    const shopHeading = this.querySelector('[data-bind="pass-shop-heading"]');
    if (shopHeading) shopHeading.hidden = isCombined;
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
    const hintEl = this.querySelector('[data-bind="pass-deity-hint"]');
    const deityMetaLabel = this.querySelector('[data-bind="pass-deity-meta-label"]');
    const deityEyebrow = this.querySelector('[data-bind="pass-deity-eyebrow"]');
    if (hintEl) {
      const ownedSymbolId = this.#ownedDeitySymbolId();
      if (ownedSymbolId != null) {
        const ownedName = passSymbolBadge(ownedSymbolId).name;
        const ownedSymbol = ownedName.split(/\s+/).at(-1) || 'symbol';
        hintEl.textContent = `God of ${ownedSymbol.charAt(0).toUpperCase()}${ownedSymbol.slice(1)}`;
        if (deityMetaLabel) deityMetaLabel.textContent = 'OWNED';
        if (deityEyebrow) deityEyebrow.textContent = 'YOUR DEITY PASS';
      } else if (this.#deityCatalog?.issuedCount >= 32) {
        hintEl.textContent = 'sold out';
        if (deityMetaLabel) deityMetaLabel.textContent = 'STATUS';
        if (deityEyebrow) deityEyebrow.textContent = 'LIFETIME PASS';
      } else if (p?.deityNextPriceWei != null) {
        try { hintEl.textContent = `pick your symbol · next pass ${formatPassEth(p.deityNextPriceWei)} ETH`; }
        catch (_e) { hintEl.textContent = 'pick your symbol'; }
        if (deityMetaLabel) deityMetaLabel.textContent = 'LIVE PRICE';
        if (deityEyebrow) deityEyebrow.textContent = 'LIFETIME PASS';
      } else {
        hintEl.textContent = 'checking availability…';
        if (deityMetaLabel) deityMetaLabel.textContent = 'LIVE PRICE';
        if (deityEyebrow) deityEyebrow.textContent = 'LIFETIME PASS';
      }
    }
    this.#renderDeityCatalog();
    this.#renderAfking();
    // Lazy row — visible ONLY when the level window is open (user ask).
    const lazyRow = this.querySelector('[data-bind="pass-lazy-row"]');
    if (lazyRow) {
      const open = Boolean(p?.lazyOpen && p?.lazyCostWei != null);
      lazyRow.hidden = !open;
    }
    // Re-assert the combined-mode gate — this poll tick's price-window logic
    // above may have just re-revealed the lazy row; combined mode wins.
    this.#renderCombinedGate();
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
        el.textContent = gain > 0 ? `+${gain}% DEGEN SCORE` : '';
        el.hidden = gain <= 0;
      }
    }
  }

  #renderWhaleLootboxBenefit() {
    const benefit = this.querySelector('[data-bind="pass-whale-lootbox"]');
    if (!benefit) return;
    const unit = this.#pricingData?.whaleUnitPriceWei;
    const quantityInput = this.querySelector('[name="pass-whale-qty"]');
    const quantity = Math.max(1, Math.min(100, Math.trunc(Number(quantityInput?.value) || 1)));
    if (unit == null) {
      benefit.textContent = 'BONUS LOOTBOX · 10% OF PASS';
      return;
    }
    const lootboxValue = (BigInt(unit) * BigInt(quantity)) / 10n;
    benefit.textContent = `BONUS LOOTBOX · ${formatPassEth(lootboxValue)} ETH`;
  }

  #renderWhaleBuyLabel() {
    const buy = this.querySelector('[data-bind="pass-whale-buy"]');
    if (!buy || this.#busyWhale) return;
    const unit = this.#pricingData?.whaleUnitPriceWei;
    const quantityInput = this.querySelector('[name="pass-whale-qty"]');
    // Real number inputs expose .value even when empty. The fallback only
    // covers pre-hydration/minimal DOMs where the markup's value property has
    // not been reflected yet.
    const quantityValue = quantityInput && 'value' in quantityInput
      ? quantityInput.value
      : '1';
    const rawQuantity = Number.parseInt(quantityValue || '', 10);
    if (unit == null || !Number.isInteger(rawQuantity)
      || rawQuantity < 1 || rawQuantity > 100) {
      buy.textContent = 'BUY WHALE PASS · —';
      return;
    }
    const finalPrice = BigInt(unit) * BigInt(rawQuantity);
    buy.textContent = `BUY WHALE PASS · ${formatPassEth(finalPrice)} ETH`;
  }

  #renderLazyBuyLabel() {
    const buy = this.querySelector('[data-bind="pass-lazy-buy"]');
    if (!buy || this.#busyLazy) return;
    const cost = this.#pricingData?.lazyCostWei;
    buy.textContent = cost == null
      ? 'BUY LAZY PASS · —'
      : `BUY LAZY PASS · ${formatPassEth(cost)} ETH`;
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
      'pass-shop-seat-copy',
    ]) {
      const benefit = this.querySelector(`[data-bind="${bind}"]`);
      if (benefit) benefit.hidden = ownsSeat;
    }
  }

  #renderLazyLootboxBenefit() {
    const benefit = this.querySelector('[data-bind="pass-lazy-lootbox"]');
    if (!benefit) return;
    const cost = this.#pricingData?.lazyCostWei;
    if (cost == null) {
      benefit.textContent = 'BONUS LOOTBOX · 10% OF PASS';
      return;
    }
    benefit.textContent = `BONUS LOOTBOX · ${formatPassEth(BigInt(cost) / 10n, 3)} ETH`;
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
    const ownedName = this.querySelector('[data-bind="pass-deity-owned-name"]');
    if (deitySection) {
      deitySection.setAttribute('data-deity-owned', String(ownsDeityPass));
      deitySection.hidden = get('ui.mode') === 'combined' || ownsDeityPass;
    }
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
        ? `NEXT JACKPOT · ${formatPassEth(dayCost)} ETH`
        : 'NEXT JACKPOT · —';
    }

    const addedFunding = this.#afkingFundingInputWei();
    if (coverage) {
      if (dayCost <= 0n || addedFunding == null) {
        coverage.textContent = 'COVERAGE · —';
      } else {
        const available = BigInt(this.#afkingState?.fundingWei ?? 0n) + addedFunding;
        const days = available / dayCost;
        coverage.textContent = `COVERS · ${days} JACKPOT${days === 1n ? '' : 'S'}`;
      }
    }

    if (save && !this.#busyAfking) {
      if (this.#afkingState?.rngLocked) {
        save.textContent = 'RNG settling';
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
        || this.#busyAfkingWithdrawal
        || this.#busyAfkingClaim
        || addedFunding == null
        || addedFunding <= 0n;
      const fundLockTitle = !active
        ? 'Start the subscription with funding first'
        : this.#busyAfking || this.#busyAfkingFunding || this.#busyAfkingWithdrawal || this.#busyAfkingClaim
          ? 'AFKing transaction pending'
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
      this.#syncAfkingLockPolling();
      return;
    }

    const lockNotice = this.querySelector('[data-bind="pass-afking-lock"]');
    const controls = this.querySelector('[data-bind="pass-afking-controls"]');
    if (lockNotice) {
      lockNotice.hidden = !state.hasToken || !state.rngLocked;
      lockNotice.textContent = 'RNG SETTLING · Settings and cancel unlock automatically. Funding and withdrawals stay open.';
    }
    // A funded wallet can reclaim its ETH even if it has no seat. Only holders
    // get the subscription editor itself.
    if (controls) controls.hidden = !state.hasToken;

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
      status.textContent = state.active
        ? `ACTIVE · ${state.dailyQuantity}/JACKPOT`
        : (state.hasToken ? 'SEAT READY' : 'FUNDS READY');
      status.classList.toggle('pass-afking__status--active', Boolean(state.active));
    }
    const funding = this.querySelector('[data-bind="pass-afking-funding"]');
    if (funding) {
      funding.textContent = `${formatPassEth(state.fundingWei)} ETH`;
    }

    const withdraw = this.querySelector('[data-bind="pass-afking-withdraw"]');
    if (withdraw) {
      const selfMode = get('ui.mode') === 'self';
      withdraw.hidden = !selfMode || !hasFunding;
      withdraw.textContent = this.#busyAfkingWithdrawal ? 'Withdrawing…' : 'Withdraw all';
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
    const locked = Boolean(
      state.rngLocked
      || this.#busyAfking
      || this.#busyAfkingFunding
      || this.#busyAfkingWithdrawal
      || this.#busyAfkingClaim
    );
    if (save) {
      save.textContent = this.#busyAfking
        ? 'Saving…'
        : state.rngLocked
          ? 'RNG settling'
          : (state.active ? 'Update' : 'Start');
      const saveLockTitle = state.rngLocked
        ? 'Settings unlock automatically after RNG resolves'
        : this.#busyAfking || this.#busyAfkingFunding || this.#busyAfkingWithdrawal || this.#busyAfkingClaim
          ? 'Transaction pending'
          : '';
      _setDomainWriteLock(save, locked, saveLockTitle);
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

  async #onAfkingFund(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (
      this.#busyAfking
      || this.#busyAfkingFunding
      || this.#busyAfkingWithdrawal
      || this.#busyAfkingClaim
      || !this.#afkingState?.active
    ) return;
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
      || !this.#afkingState?.hasToken
    ) return;

    const qtyInput = this.querySelector('[name="pass-afking-qty"]');
    const modeInput = this.querySelector('[data-bind="pass-afking-mode"]');
    const creditInput = this.querySelector('[name="pass-afking-claimable-first"]');
    const fundInput = this.querySelector('[name="pass-afking-fund"]');
    const dailyQuantity = Number.parseInt(qtyInput?.value || '0', 10);
    if (!Number.isInteger(dailyQuantity) || dailyQuantity < 1 || dailyQuantity > 255) {
      this.#renderAfkingError('Jackpot quantity must be 1-255.');
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
