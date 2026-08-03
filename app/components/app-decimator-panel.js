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
import { fetchJSON } from '../../beta/app/api.js';
// Eager import — triggers Phase 60's reason-map registrations as a side-effect
// (GameOverPossible / AfKingLockActive / NotApproved). decimator.js is a thin
// re-export of lootbox.js's purchaseEth + purchaseCoin per Plan 62-01 D-01.
import { purchaseEth, scaledTicketPriceWei } from '../app/decimator.js';
import { readAfkingSubscription } from '../app/passes.js';
// readAffiliateCode comes directly from lootbox.js — Plan 62-01's decimator.js
// only re-exports the two purchase helpers per its minimal-surface design.
// LOOTBOX_MIN_WEI: floor on the lootbox ETH leg. There is no per-box price —
// the contract's lootBoxAmount is a free ETH value (min 0.01 ether); the
// widget takes it as a single ETH input and both legs ride ONE purchase() tx.
import {
  readAffiliateCode, LOOTBOX_MIN_WEI, parseLootboxIdxFromReceipt,
  scaledFoilPackCostWei, parseFoilPackBoughtFromReceipt,
  probeFoilPackAvailabilityState,
  readPresaleBoxState, purchasePresaleBox, parsePresaleBoxBuyFromReceipt,
  PRESALE_BOX_MIN_WEI,
  // A ticket is 4 entries; the contract takes entries and charges per entry, so
  // both the quote and the call go through these (see lootbox.js UNITS note).
  // claimableFirstPayment mirrors the click-time funding split for the bonus preview.
  ticketCostFromTickets, ENTRIES_PER_TICKET, claimableFirstPayment,
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
  redeemFlip,
  probeRedeemFlipWindow,
  flipCostFromTickets,
} from '../app/claims.js';
import { formatFlip } from '../../beta/viewer/utils.js';
import { queueReveal } from './reveal-overlay.js';
import { updateBalanceDisplay, resetBalanceDisplay } from '../app/balance-countup.js';
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
const FUNDING_PRIORITY_KEY = `purchase-funding-priority:${CHAIN.id}`;

function _readFundingPriority() {
  try { return localStorage.getItem(FUNDING_PRIORITY_KEY) === 'wallet' ? 'wallet' : 'claimable'; }
  catch (_e) { return 'claimable'; }
}

function _writeFundingPriority(priority) {
  try { localStorage.setItem(FUNDING_PRIORITY_KEY, priority === 'wallet' ? 'wallet' : 'claimable'); }
  catch (_e) { /* private mode: keep the in-memory choice */ }
}

// Purchase quotes are controls, not accounting tables: fixed-width values such
// as "0.0400" add noise and can make an input step look more precise than it
// is. Keep displayEth's chain scaling/precision, then trim only fractional zeroes.
function formatPurchaseEth(raw) {
  const fixed = displayEth(BigInt(raw || 0));
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

// The active testnet displays ETH in the protocol's /1M-normalized units,
// including the connected wallet readout. Keep the same multiplier and the
// purchase panel's no-trailing-zero convention in one place.
function formatFundsEth(raw) {
  const fixed = displayEth(BigInt(raw || 0), 2);
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
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
  #claimableWei = 0n;  // Acting player's indexed claimable balance (quote only).
  #claimableAddress = null;
  #claimableKnown = false;
  #walletEthWei = null;       // Connected signer's native wallet balance.
  #walletEthAddress = null;
  #afkingFundingWei = 0n;     // Acting player's spendable AFKing funding.
  #afkingFundingAddress = null;
  #afkingFundingKnown = false;
  #claimBusy = null;          // 'eth' while the footer claim is signing.
  #preferClaimable = true;    // ETH purchase funding preference; persisted per chain.
  #claimableSpoilerOverrideKey = null;
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
    this.#preferClaimable = _readFundingPriority() !== 'wallet';
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
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-wallet"]'));
    resetBalanceDisplay(this.querySelector('[data-bind="dec-funds-claimable"]'));
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

        <!-- Tickets + combined-buy lootbox leg on ONE line. The lootbox size is a
             free ETH amount (min 0.01) riding the same purchase() tx. Both default
             to 0; its ▲/▼ control steps by one live ticket price. -->
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
                     class="dec-input" min="0" step="0.25" value="0">
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
                     class="dec-input" min="0" step="0.01" value="0" aria-label="Buy lootbox amount in ETH">
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

        <!-- Stable half-and-half action rail. The bonus cell stays empty when
             the quote earns no FLIP, so changing quantities never resizes Buy. -->
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

        <!-- ETH purchase balance footer. Claimable is deliberately first. The
             window-gated alternate ticket payment is a compact option inside
             the ETH wallet display instead of a second purchase action. -->
        <div class="dec-funds" data-bind="dec-funds">
          <div class="dec-funds__display dec-funds__display--claimable"
               data-bind="dec-funds-claimable-display">
            <span class="dec-funds__label">
              <span>CLAIMABLE</span>
            </span>
            <label class="dec-funds__priority" data-bind="dec-funds-claimable-priority">
              <input type="radio" name="dec-funding-priority" value="claimable"
                     data-bind="dec-funds-claimable-first" checked>
              <span>USE FIRST</span>
            </label>
            <strong class="dec-funds__value dec-funds__value--claimable">
              <span class="dec-funds__number" data-bind="dec-funds-claimable">—</span>
              <span class="dec-funds__unit" data-bind="dec-funds-claimable-unit">ETH</span>
            </strong>
            <button type="button" class="dec-funds__claim" data-write
                    data-bind="dec-funds-claim" disabled>CLAIM</button>
          </div>
          <div class="dec-funds__display dec-funds__display--wallet"
               data-bind="dec-funds-wallet-display">
            <span class="dec-funds__label">
              <span data-bind="dec-funds-wallet-label">WALLET</span>
            </span>
            <label class="dec-funds__priority" data-bind="dec-funds-wallet-priority">
              <input type="radio" name="dec-funding-priority" value="wallet"
                     data-bind="dec-funds-wallet-first">
              <span>USE FIRST</span>
            </label>
            <label class="dec-flip-mode dec-funds__flip-mode"
                   data-bind="dec-flip-buy" hidden>
              <input type="checkbox" name="dec-redeem-with-flip"
                     data-bind="dec-flip-check">
              <span>USE FLIP</span>
            </label>
            <strong class="dec-funds__value" data-bind="dec-funds-wallet">—</strong>
            <a class="dec-funds__faucet" data-bind="dec-funds-faucet"
               href="${BASE_SEPOLIA_FAUCET_URL}" target="_blank"
               rel="noopener noreferrer" hidden>GET PLAY MONEY</a>
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
    const claimBtn = this.querySelector('[data-bind="dec-funds-claim"]');
    if (claimBtn) {
      claimBtn.addEventListener('click', (e) => this.#onClaimFundsClick(e));
    }
    const claimableValue = this.querySelector('[data-bind="dec-funds-claimable"]');
    if (claimableValue) {
      claimableValue.addEventListener('click', (event) => this.#revealClaimableSpoiler(event));
      claimableValue.addEventListener('keydown', (event) => this.#revealClaimableSpoiler(event));
    }
    const afkingJump = this.querySelector('[data-bind="dec-afking-jump"]');
    if (afkingJump) {
      afkingJump.addEventListener('click', () => this.#openAfkingPasses());
    }
    const walletFirst = this.querySelector('[data-bind="dec-funds-wallet-first"]');
    if (walletFirst) {
      walletFirst.addEventListener('change', () => this.#setFundingPriority(false));
    }
    const claimableFirst = this.querySelector('[data-bind="dec-funds-claimable-first"]');
    if (claimableFirst) {
      claimableFirst.addEventListener('change', () => this.#setFundingPriority(true));
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
        const ready = await this.#applyQuestPreset(detail);
        if (!detail?.submit || ![1, 4, 6, 9].includes(Number(detail?.questType))) return;
        if (!ready) {
          this.#renderError(Number(detail?.questType) === 4
            ? 'Foil packs are not available right now.'
            : 'FLIP redemption is not available right now.');
          return;
        }
        if (Number(detail.questType) === 9) await this.#onBuyWithFlipClick();
        else await this.#onBuyClick();
      })();
    };
    document.addEventListener('quest:activate', this.#questActivateListener);
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
    // The deployed combined selector has no foil flag. Once foil is selected,
    // remove the incompatible presale leg instead of leaving behind a disabled
    // control that looks like a broken option. Also keep the row out of sight
    // until the player has enough current or same-purchase credit to buy the
    // contract's minimum box.
    const visible = live && !foilSelected && available >= PRESALE_BOX_MIN_WEI;
    row.hidden = !visible;
    if (!visible) {
      if (foilSelected || (live && available < PRESALE_BOX_MIN_WEI)) input.value = '0';
      if (this.#presaleState && this.#presaleAddress === buyerKey && !this.#presaleState.active) {
        input.value = '0';
      }
      return;
    }

    availableEl.textContent = `${formatPurchaseEth(available)} ETH AVAILABLE`;
    input.max = formatPurchaseEth(available);
    input.setAttribute?.('max', input.max);
    const unavailable = this.#flipModeEnabled();
    input.disabled = unavailable;
    maxButton.disabled = unavailable || available < PRESALE_BOX_MIN_WEI;
    const wanted = this.#presaleWantedWei();
    row.classList?.toggle('dec-presale--selected', wanted > 0n && !unavailable);
    row.classList?.toggle('dec-presale--over-limit', wanted > available);
  }

  #setFundingPriority(preferClaimable) {
    // USE FLIP and the two ETH funding-priority choices are mutually
    // exclusive. Choosing either USE FIRST control exits FLIP mode while
    // retaining the selected ETH preference for future renders.
    const flipCheck = this.querySelector('[data-bind="dec-flip-check"]');
    const leavingFlip = Boolean(flipCheck?.checked);
    if (flipCheck) flipCheck.checked = false;
    this.#preferClaimable = Boolean(preferClaimable);
    _writeFundingPriority(this.#preferClaimable ? 'claimable' : 'wallet');
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
    const target = this.#targetLevel();
    if (this.#foilWanted() && target != null) {
      foilCostWei = scaledFoilPackCostWei(target);
      totalWei += foilCostWei;
    }
    totalWei += presaleCostWei;
    let amount = '';
    if (totalWei > 0n) {
      try { amount = `${formatPurchaseEth(totalWei)} ETH`; } catch (_e) { amount = ''; }
    }
    this.#setBuyLabel(presaleCostWei > 0n ? 'Buy in + presale box' : 'Buy in', amount);
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
    const connected = get('connected.address');
    const connectedLower = connected ? String(connected).toLowerCase() : null;
    const provider = getProvider();
    const walletBalancePromise = connectedLower && typeof provider?.getBalance === 'function'
      ? provider.getBalance(connectedLower)
      : Promise.resolve(null);
    const [gameResult, playerResult, walletResult, afkingResult, presaleResult] = await Promise.allSettled([
      fetchJSON('/game/state'),
      actingLower ? fetchJSON(`/player/${actingLower}`) : Promise.resolve(null),
      walletBalancePromise,
      actingLower ? readAfkingSubscription(actingLower) : Promise.resolve(null),
      actingLower ? readPresaleBoxState({ player: actingLower }) : Promise.resolve(null),
    ]);
    if (signal.aborted) return;

    if (gameResult.status === 'fulfilled' && gameResult.value) {
      this.#gameState = gameResult.value;
    }
    if (playerResult.status === 'fulfilled' && playerResult.value && actingLower) {
      let claimable = 0n;
      try { claimable = BigInt(playerResult.value.claimableEth || '0'); } catch (_e) { claimable = 0n; }
      this.#claimableWei = claimable;
      this.#claimableAddress = actingLower;
      this.#claimableKnown = true;
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

    if (afkingResult.status === 'fulfilled'
      && afkingResult.value != null
      && actingLower === this.#afkingPassAddress) {
      const state = afkingResult.value;
      // `canClaimSeat` is gone — seats auto-mint with the pass, so holding one IS the signal.
      this.#hasAfkingPass = Boolean(state.hasToken || state.active);
      try {
        this.#afkingFundingWei = BigInt(state.fundingWei ?? 0);
        this.#afkingFundingAddress = actingLower;
        this.#afkingFundingKnown = true;
      } catch (_e) {
        this.#afkingFundingWei = 0n;
        this.#afkingFundingAddress = actingLower;
        this.#afkingFundingKnown = false;
      }
    } else {
      // A failed pass snapshot must not leave a stale funding amount folded
      // into the wallet total for the same player.
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
  // zero-value probe identifies a buyable route by DirectEthInsufficient; the
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

    if (priceEl) {
      let text = '—';
      if (target != null) {
        try { text = `${formatPurchaseEth(scaledFoilPackCostWei(target))} ETH`; } catch (_e) { text = '—'; }
      }
      priceEl.textContent = text;
    }
    if (check) {
      check.disabled = !available || this.#flipModeEnabled();
      if (!available || this.#flipModeEnabled()) check.checked = false;
    }
    row.hidden = !available;
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
    // Do not simulate a one-ticket burn here. Doing so hides Redeem FLIP
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
    const row = this.querySelector('[data-bind="dec-flip-buy"]');
    if (!row) return;
    row.hidden = !this.#flipBuyOpen;
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

    // The saved ETH priority remains intact behind the scenes, but neither
    // USE FIRST indicator is selected while USE FLIP is active. This keeps the
    // three visible payment choices honest without making the user reselect a
    // preference when they leave FLIP mode.
    const walletFirst = this.querySelector('[data-bind="dec-funds-wallet-first"]');
    const claimableFirst = this.querySelector('[data-bind="dec-funds-claimable-first"]');
    if (walletFirst) walletFirst.checked = !flipMode && !this.#preferClaimable;
    if (claimableFirst) claimableFirst.checked = !flipMode && this.#preferClaimable;

    this.#renderFoilRow();
    this.#renderSnapshot();
  }

  #renderFundsFooter() {
    const root = this.querySelector('[data-bind="dec-funds"]');
    const walletLabel = this.querySelector('[data-bind="dec-funds-wallet-label"]');
    const walletValue = this.querySelector('[data-bind="dec-funds-wallet"]');
    const walletDisplay = this.querySelector('[data-bind="dec-funds-wallet-display"]');
    const faucet = this.querySelector('[data-bind="dec-funds-faucet"]');
    const claimableValue = this.querySelector('[data-bind="dec-funds-claimable"]');
    const claimableUnit = this.querySelector('[data-bind="dec-funds-claimable-unit"]');
    const claimableDisplay = this.querySelector('[data-bind="dec-funds-claimable-display"]');
    const claimBtn = this.querySelector('[data-bind="dec-funds-claim"]');
    const walletPriority = this.querySelector('[data-bind="dec-funds-wallet-priority"]');
    const claimablePriority = this.querySelector('[data-bind="dec-funds-claimable-priority"]');
    const walletFirst = this.querySelector('[data-bind="dec-funds-wallet-first"]');
    const claimableFirst = this.querySelector('[data-bind="dec-funds-claimable-first"]');
    if (!root || !walletLabel || !walletValue || !claimableValue || !claimBtn) return;

    walletLabel.textContent = 'WALLET';
    if (claimableUnit) claimableUnit.textContent = 'ETH';
    if (walletPriority) walletPriority.hidden = false;
    if (claimablePriority) claimablePriority.hidden = false;
    const flipMode = this.#flipModeEnabled();
    if (walletFirst) {
      walletFirst.checked = !flipMode && !this.#preferClaimable;
      walletFirst.disabled = false;
    }
    if (claimableFirst) {
      claimableFirst.checked = !flipMode && this.#preferClaimable;
      claimableFirst.disabled = false;
    }

    let claimable = 0n;
    try {
      claimable = this.#claimableWei;
    } catch (_e) {
      // A malformed snapshot stays visibly unknown instead of breaking buys.
    }

    const spoilerOpen = this.#claimableSpoilerOpen();
    const displayOpen = spoilerOpen
      || this.#claimableSpoilerOverrideKey === this.#claimableSpoilerKey();
    const acting = getActingAddress();
    const actingLower = acting ? String(acting).toLowerCase() : null;
    const connected = get('connected.address');
    const connectedLower = connected ? String(connected).toLowerCase() : null;
    const walletKnown = this.#walletEthWei != null
      && this.#walletEthAddress === connectedLower;
    const fundingKnown = this.#afkingFundingKnown
      && this.#afkingFundingAddress === actingLower;
    const walletTotal = walletKnown && fundingKnown
      ? BigInt(this.#walletEthWei) + BigInt(this.#afkingFundingWei)
      : null;
    updateBalanceDisplay(walletValue, {
      container: walletDisplay,
      scope: `${this.#walletEthAddress || ''}:${this.#afkingFundingAddress || ''}`,
      value: walletTotal,
      format: (raw) => raw === 0n ? '- ETH' : `${formatFundsEth(raw)} ETH`,
      formatDelta: (delta) => `+${formatFundsEth(delta)} ETH`,
    });
    const showFaucet = Boolean(isBaseSepolia(CHAIN) && walletTotal === 0n);
    walletValue.hidden = showFaucet;
    if (faucet) faucet.hidden = !showFaucet;
    updateBalanceDisplay(claimableValue, {
      container: claimableDisplay,
      scope: this.#claimableAddress,
      value: this.#claimableKnown ? claimable : null,
      visible: displayOpen,
      format: (raw) => raw === 0n ? '-' : formatFundsEth(raw),
      formatDelta: (delta) => `+${formatFundsEth(delta)} ETH`,
      hiddenText: '••••',
    });
    claimableDisplay?.classList?.toggle('dec-funds__display--spoiler', !displayOpen);
    if (!displayOpen) {
      claimableValue.removeAttribute('aria-hidden');
      claimableValue.setAttribute('role', 'button');
      claimableValue.setAttribute('tabindex', '0');
      claimableValue.setAttribute('title', 'Show this value anyway');
      claimableValue.setAttribute('aria-label', 'Claimable balance hidden. Activate to show anyway.');
      claimableDisplay?.setAttribute(
        'aria-label',
        'Claimable balance hidden until the main jackpot is revealed. Activate the number to show anyway.',
      );
    } else {
      claimableValue.removeAttribute('aria-hidden');
      claimableValue.removeAttribute('role');
      claimableValue.removeAttribute('tabindex');
      claimableValue.removeAttribute('title');
      claimableValue.removeAttribute('aria-label');
      claimableDisplay?.removeAttribute('aria-label');
    }
    root.classList?.toggle('has-claimable', displayOpen && claimable > 0n);
    const busy = this.#claimBusy === 'eth';
    const claimReady = Boolean(
      spoilerOpen && !this.#busy && !this.#claimBusy && getActingAddress() && claimable > 0n,
    );
    claimBtn.textContent = busy ? 'CLAIMING…' : 'CLAIM';
    claimBtn.disabled = !claimReady;
    if (claimReady) {
      claimBtn.removeAttribute('data-write-locked');
      claimBtn.removeAttribute('data-write-lock-title');
    } else {
      claimBtn.setAttribute('data-write-locked', '');
      claimBtn.setAttribute(
        'data-write-lock-title',
        !spoilerOpen
          ? 'Reveal the main jackpot first'
          : claimable <= 0n
            ? 'No ETH winnings to claim'
            : 'Claim is unavailable right now',
      );
    }
    claimBtn.setAttribute(
      'aria-label',
      'Claim ETH winnings',
    );
  }

  #claimableSpoilerOpen() {
    const rawDay = get('app.lastDay')?.day;
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
    const day = get('app.lastDay')?.day ?? '';
    const address = getActingAddress() || '';
    return `${day}:${String(address).toLowerCase()}`;
  }

  #revealClaimableSpoiler(event) {
    if (event?.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (this.#claimableSpoilerOpen()) return;
    try { event?.preventDefault?.(); } catch (_e) { /* fakeDOM */ }
    this.#claimableSpoilerOverrideKey = this.#claimableSpoilerKey();
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

  async #onBuyWithFlipClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busy) return;
    const btn = this.querySelector('[data-bind="dec-buy-cta"]');
    const tickets = this.#ticketsWanted();
    if (tickets <= 0) {
      this.#renderError('Enter a ticket amount (0.25 minimum) to redeem with FLIP.');
      return;
    }
    const player = get('connected.address');
    if (!player) {
      this.#renderError('Connect a wallet to redeem FLIP.');
      return;
    }
    this.#busy = true;
    if (btn) {
      btn.disabled = true;
      this.#setBuyLabel('Burning FLIP…');
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
    } catch (error) {
      this.#renderError(compactUiError(error, 'FLIP redemption did not go through. Try again.'));
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
    return activeTicketLevel(this.#gameState);
  }

  #ticketPriceWei() {
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
    const u6 = subscribe('ui.foilQuest', () => {
      // Quest definitions and game state arrive on independent polls. Refresh
      // the routed contract probe, but never let quest metadata choose a level.
      // Keep the last same-scope answer visible while that read is in flight.
      this.#renderSnapshot();
      this.#refreshFoilStatus();
    });
    this.#unsubs.push(u1, u2, u3, u4, u5, u6);
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

  async #onBuyClick(e) {
    try { e?.preventDefault?.(); } catch (_) { /* defensive */ }
    if (this.#busy) return;
    this.#busy = true;

    const btn = this.querySelector('[data-bind="dec-buy-cta"]');
    if (btn) {
      btn.disabled = true;
      this.#setBuyLabel('Buying…');
    }
    // Defensive: clear any prior error before a fresh attempt.
    this.#clearError();

    try {
      // TICKETS, fractional down to the entry (see #ticketsWanted). The field
      // used to be read with parseInt and sent as if it were entries, so "1"
      // bought a quarter ticket and paid for four.
      const ticketQuantity = this.#ticketsWanted();
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
      if (!Number.isFinite(boxFloat) || boxFloat < 0) {
        this.#renderError('Lootbox ETH must be 0 or at least 0.01.');
        return;
      }
      const lootBoxAmountWei = boxFloat > 0
        ? BigInt(Math.round(boxFloat * 1e18)) / ETH_DIVISOR
        : 0n;
      if (lootBoxAmountWei > 0n && lootBoxAmountWei < LOOTBOX_MIN_WEI) {
        this.#renderError('Minimum lootbox spend is 0.01 ETH.');
        return;
      }
      const presaleInput = this.querySelector('[name="dec-presale-box-eth"]');
      const presaleRaw = presaleInput == null || presaleInput.value == null
        || String(presaleInput.value).trim() === '' ? '0' : String(presaleInput.value);
      const presaleFloat = Number(presaleRaw);
      if (!Number.isFinite(presaleFloat) || presaleFloat < 0) {
        this.#renderError('Presale box ETH must be 0 or at least 0.01.');
        return;
      }
      const presaleBoxAmountWei = presaleFloat > 0
        ? BigInt(Math.round(presaleFloat * 1e18)) / ETH_DIVISOR
        : 0n;
      if (presaleBoxAmountWei > 0n && presaleBoxAmountWei < PRESALE_BOX_MIN_WEI) {
        this.#renderError('Minimum presale box size is 0.01 ETH.');
        return;
      }
      let foilWanted = this.#foilWanted();
      if (foilWanted && presaleBoxAmountWei > 0n) {
        this.#renderError('Buy the foil pack separately from a presale box.');
        return;
      }
      if (ticketQuantity < 0 || (ticketQuantity <= 0 && lootBoxAmountWei <= 0n
        && presaleBoxAmountWei <= 0n && !foilWanted)) {
        this.#renderError('Enter tickets, a lootbox amount, a presale box amount, or select the foil pack.');
        return;
      }

      // Match lootbox.js's actual write target (self or the owner selected in
      // operator mode), so the deferred ticket reveal is recorded for the
      // account that receives the tickets.
      const buyer = getActingAddress();
      const affiliateCode = readAffiliateCode(CHAIN.id, buyer);

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
        try {
          const gs = await fetchJSON('/game/state');
          if (gs) this.#gameState = gs;
        } catch (_e) { /* network blip — fall back to the cached snapshot */ }
        // Never re-check indexed ownership here. purchaseEth immediately runs
        // the exact contract static-call with this level/value, which is both
        // fresher and authoritative.
        const priceWei = this.#ticketPriceWei();
        if (priceWei == null) {
          this.#renderError('Ticket price unavailable — try again in a moment.');
          return;
        }
        // Exactly what the contract charges: priceWei * entryQuantityScaled /
        // (4 * QTY_SCALE). Quoting priceWei-per-ticket-count overpaid 4x, and
        // an overpay is credited to afking rather than refunded.
        if (ticketQuantity > 0) ticketCostWei = ticketCostFromTickets(priceWei, ticketQuantity);
        if (foilWanted) {
          const target = this.#targetLevel();
          foilCostWei = scaledFoilPackCostWei(target);
        }
      }

      const mintCostWei = ticketCostWei + lootBoxAmountWei;
      if (presaleBoxAmountWei > 0n) {
        let livePresale = null;
        try { livePresale = await readPresaleBoxState({ player: buyer }); }
        catch (_e) { livePresale = null; }
        if (!livePresale?.active || livePresale.remainingWei <= 0n) {
          this.#renderError('Presale boxes are not available right now.');
          return;
        }
        this.#presaleAddress = String(buyer || '').toLowerCase();
        this.#presaleState = livePresale;
        const available = presaleBoxAvailableWei(livePresale, mintCostWei);
        if (presaleBoxAmountWei > available) {
          this.#renderError(`Presale box limit is ${formatPurchaseEth(available)} ETH for this purchase.`);
          this.#renderPresaleRow(mintCostWei);
          return;
        }
      }

      const hasMintPurchase = ticketQuantity > 0 || lootBoxAmountWei > 0n || foilWanted;
      const { receipt, contract } = presaleBoxAmountWei > 0n && !hasMintPurchase
        ? await purchasePresaleBox({
            boxAmountWei: presaleBoxAmountWei,
            player: buyer,
            preferClaimable: this.#preferClaimable,
          })
        : await purchaseEth({
            ticketQuantity, lootboxQuantity: 0, affiliateCode, ticketCostWei, lootBoxAmountWei,
            foil: foilWanted, foilCostWei, presaleBoxAmountWei,
            preferClaimable: this.#preferClaimable,
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
          });
        }
        for (const b of parsePresaleBoxBuyFromReceipt(receipt, contract)) {
          const index = Number(b.lootboxIndex);
          if (!byIndex.has(index)) byIndex.set(index, { index, day: null });
        }
        boxes = [...byIndex.values()];
      } catch (_e) { boxes = []; }
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

      // Success — dispatch panel event for any external listener (mirrors
      // Phase 61's app-claims:tx-confirmed pattern). The app-root
      // <app-box-strip tray-only> consumes `boxes` at the document level.
      try {
        this.dispatchEvent(new CustomEvent('app-decimator:tx-confirmed', {
          detail: { ticketQuantity, lootBoxAmountWei, presaleBoxAmountWei, boxes },
          bubbles: true,
        }));
      } catch (_e) { /* defensive — fakeDOM CustomEvent shim */ }

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
    } catch (error) {
      // Decoded structured-revert error from lootbox.js (.userMessage / .code
      // / .recoveryAction / .cause). Render via textContent (T-58-18).
      this.#renderError(compactUiError(error, 'Purchase did not go through. Try again.'));
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
