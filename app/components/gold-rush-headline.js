// /app/components/gold-rush-headline.js — the headline jackpot number.
//
// DISPLAY NAME vs CODE NAME: players see "Golden Ticket Jackpot". Everything in
// code stays "gold rush" on purpose — the contract calls it that (`_armGoldRush`,
// `_payGoldRush`), the API route is `/game/jackpot/gold-rush`, and the store key
// is `app.goldRush`. Renaming the internals would cut the widget loose from the
// vocabulary of the thing it reports on. The display string below is the only
// place the player-facing name lives.
//
// THE NUMBER STAYS THE HERO. `headlineWei` from /game/jackpot/gold-rush is the
// figure _payGoldRush's grand branch sizes the grand award off
// (DegenerusGameJackpotModule.sol:1483-1491): currentPrizePool + nextPrizePool +
// futurePrizePool + yieldAccumulator. claimablePool is excluded by the contract and
// so excluded here — that is money already owed to players.
//
// The small Degenerus Protocol lockup added above the title is identity, not another
// data row: the jackpot amount remains the only headline. An earlier version broke
// out the payout legs (25% of futurePrizePool as cash, the remainder 75% in half whale
// passes and 25% in flip credit) — deleted on the user's call, and the odds back them up.
//
// The jackpot board is NOT rolled with the mint's weighted colour table. It comes from
// JackpotBucketLib.getRandomTraits, which takes 6 raw bits per quadrant (uniform over
// 64), and the gold test is `((trait >> 3) & 7) == 7` — bits 3-5, uniform over 8. So
// gold is 1/8 per quadrant, and a 4-gold board is 1/8^4 = 1/4096: about once every 11
// years at one main draw a day. That ARMS the rush, and every rung of the armed ladder
// pays something (0 golds is a 100 WWXRP consolation, 1 gold a whale pass, 2/3/4 golds
// ETH off futurePrizePool).
//
// The GRAND is the compound event: 4 golds to arm, then the NEXT board rolling 4 golds
// again AND repeating the armed quadrant's symbol (`traits[quadrant] & 7`, uniform over
// 8) — 1/4096 × 1/4096 × 1/8 ≈ one draw in 1.3e8, order 370,000 years. Itemising the
// split of that is noise dressed as precision. The number's job is to be big and to
// move, so: label, number, tick.
//
// THE TICK. The API's `atBlock` is the block the headline last MOVED at, and
// `deltaWei` is by how much. The widget remembers the last `atBlock` it rendered;
// when a poll brings a new one it animates from the previous headline to the new
// one instead of snapping, so money arriving on-chain reads as the number climbing.
// Positive deltas celebrate (gold flash + a rising "+X ETH" floater); negative ones
// animate down with a cool flash and no floater — a drop is a real event (a jackpot
// payout, the level-settlement drawdown, game-over zeroing) and dressing it up as a
// win would be a lie.
//
// During the jackpot phase the pools are frozen and in-window purchases route
// to pending accumulators, which the contract excludes from the headline. That
// state needs no extra player-facing label; the level/phase clock already says
// where the game is.
//
// Data arrives via the store (`app.goldRush`, written by polling.js's 5s goldRush
// cycle) — this component owns no fetch of its own.
//
// T-58-18 discipline: every server-derived string goes in via textContent.

import { displayEthCompact } from '../app/scaling.js';
import { subscribe } from '../app/store.js';

// Count-up duration. Long enough to read as motion, short enough that the next
// 5s poll never lands mid-animation.
const TICK_MS = 900;
// Decimals on the headline (user call: 3, not 4). A four-figure headline reads as
// false precision next to a number in the thousands; three still moves on a single
// ticket at run-#18 scale, which is what the live ticker needs. The "+X ETH"
// floater keeps 4 — it reports a single delta, where the extra digit is the
// difference between "something happened" and "0.000".
const HEADLINE_DIGITS = 3;
const DELTA_DIGITS = 4;

/** Group the integer part of a formatted ETH string with thin separators. */
function groupEth(formatted) {
  const dot = formatted.indexOf('.');
  const intPart = dot === -1 ? formatted : formatted.slice(0, dot);
  const frac = dot === -1 ? '' : formatted.slice(dot);
  const neg = intPart.startsWith('-');
  const digits = neg ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac}`;
}

/**
 * Format raw on-chain wei as a grouped display-ETH string.
 * displayEth owns the testnet /1M re-scale — no divisor literals live here
 * (the /app/ single-source-of-truth rule in scaling.js's header).
 */
function fmtEth(rawWei, digits = HEADLINE_DIGITS) {
  return groupEth(displayEthCompact(rawWei, digits));
}

/** Width bucket used by the narrow-screen CSS; punctuation consumes room too. */
function headlineAmountFit(formatted) {
  const length = String(formatted ?? '').length;
  if (length >= 13) return 'long';
  if (length >= 10) return 'medium';
  return 'normal';
}

function paintHeadlineAmount(amount, rawWei) {
  if (!amount) return;
  const formatted = fmtEth(rawWei);
  amount.textContent = formatted;
  amount.setAttribute('data-fit', headlineAmountFit(formatted));
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// easeOutCubic — fast start, settles into the final value. Reads as money
// landing rather than a linear odometer.
function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

class GoldRushHeadline extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #els = null;
  // Last atBlock rendered — the animation trigger. null until the first payload.
  #lastBlock = null;
  // Headline currently displayed, as raw wei. The animation's starting point; kept
  // separate from the payload's prevHeadlineWei so an animation interrupted by a
  // fast second move continues from what the player can actually see.
  #shownWei = null;
  #rafId = null;
  #flashTimer = null;
  #floatTimer = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#unsubs.push(subscribe('app.goldRush', (payload) => this.#onPayload(payload)));
  }

  disconnectedCallback() {
    for (const off of this.#unsubs) { try { off(); } catch (_) { /* defensive */ } }
    this.#unsubs = [];
    if (this.#rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#rafId);
    if (this.#flashTimer) clearTimeout(this.#flashTimer);
    if (this.#floatTimer) clearTimeout(this.#floatTimer);
    this.#rafId = null;
    this.#initialized = false;
  }

  #renderShell() {
    this.classList.add('gr');
    this.innerHTML = `
      <div class="gr__inner">
        <div class="gr__masthead">
          <span class="gr__brand">
            <img class="gr__brand-logo" src="/whitepaper/flame-logo.svg" alt="">
            <span class="gr__brand-copy">
              <strong>DEGENERUS</strong>
              <small>PROTOCOL</small>
            </span>
          </span>
          <span class="gr__masthead-divider" aria-hidden="true"></span>
          <div class="gr__label">
            <span class="gr__label-text">Golden Ticket Jackpot</span>
            <span class="gr__chip" data-el="chip" hidden></span>
          </div>
        </div>
        <div class="gr__amount-row">
          <span class="gr__amount" data-el="amount">—</span>
          <span class="gr__unit-code" title="Ethereum" aria-label="Ethereum">ETH</span>
          <span class="gr__float" data-el="float" hidden></span>
        </div>
      </div>
    `;
    this.#els = {
      chip: this.querySelector('[data-el="chip"]'),
      amount: this.querySelector('[data-el="amount"]'),
      float: this.querySelector('[data-el="float"]'),
    };
  }

  #onPayload(payload) {
    if (!payload || !this.#els) return;
    let headline;
    try {
      headline = BigInt(payload.headlineWei);
    } catch (_e) {
      return; // malformed payload — keep the last good number on screen
    }

    this.#renderStatus(payload);
    const block = payload.atBlock ?? null;
    const first = this.#lastBlock === null;
    const moved = !first && block !== null && block !== this.#lastBlock;
    this.#lastBlock = block;

    if (first || !moved || this.#shownWei === null) {
      // First paint, or a poll that found the same sample: show the number, no motion.
      this.#shownWei = headline;
      paintHeadlineAmount(this.#els.amount, headline);
      return;
    }

    const from = this.#shownWei;
    if (from === headline) return; // block advanced, value identical — nothing to animate
    this.#animateTo(from, headline);
    this.#flash(headline > from);
    if (headline > from) this.#floatDelta(headline - from);
  }

  #renderStatus(payload) {
    const { chip } = this.#els;
    // Precedence: a stalled indexer is the most important thing to say, because
    // every other state below is inferred from data that would then be stale.
    const lag = Number(payload.lagBlocks ?? 0);
    if (payload.ready === false) {
      chip.hidden = false;
      chip.textContent = 'warming up';
      chip.className = 'gr__chip gr__chip--wait';
    } else if (lag > 50) {
      chip.hidden = false;
      chip.textContent = `indexer ${lag} blocks behind`;
      chip.className = 'gr__chip gr__chip--wait';
    } else {
      chip.hidden = true;
      chip.textContent = '';
      chip.className = 'gr__chip';
    }
  }

  /**
   * Interpolate the displayed value from `from` to `to` over TICK_MS.
   *
   * Interpolation is done on the raw wei BigInt and re-formatted each frame, so
   * every intermediate value is a real amount at full precision — no float
   * rounding creeping into a number that is supposed to be exact.
   */
  #animateTo(from, to) {
    const { amount } = this.#els;
    if (this.#rafId != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    this.#shownWei = to;

    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      paintHeadlineAmount(amount, to);
      return;
    }

    const span = to - from;
    const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const step = () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const t = Math.min(1, (now - startedAt) / TICK_MS);
      if (t >= 1) {
        paintHeadlineAmount(amount, to);
        this.#rafId = null;
        return;
      }
      // Eased progress in permille, applied to the BigInt span.
      const permille = BigInt(Math.round(easeOutCubic(t) * 1000));
      paintHeadlineAmount(amount, from + (span * permille) / 1000n);
      this.#rafId = requestAnimationFrame(step);
    };
    this.#rafId = requestAnimationFrame(step);
  }

  #flash(up) {
    this.classList.remove('gr--up', 'gr--down');
    // Force a reflow so re-adding the class restarts the CSS animation when two
    // moves land back to back.
    void this.offsetWidth;
    this.classList.add(up ? 'gr--up' : 'gr--down');
    if (this.#flashTimer) clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => {
      this.classList.remove('gr--up', 'gr--down');
      this.#flashTimer = null;
    }, TICK_MS + 400);
  }

  #floatDelta(deltaWei) {
    const { float } = this.#els;
    float.textContent = `+${fmtEth(deltaWei, DELTA_DIGITS)}`;
    float.hidden = false;
    float.classList.remove('is-rising');
    void float.offsetWidth;
    float.classList.add('is-rising');
    if (this.#floatTimer) clearTimeout(this.#floatTimer);
    this.#floatTimer = setTimeout(() => {
      float.hidden = true;
      float.classList.remove('is-rising');
      this.#floatTimer = null;
    }, 1600);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('gold-rush-headline')) {
  customElements.define('gold-rush-headline', GoldRushHeadline);
}

// Test surface — the pure formatting helpers, exercised by
// __tests__/gold-rush-headline.test.js without a DOM.
export const _testing = {
  groupEth, fmtEth, easeOutCubic, headlineAmountFit,
};
export default GoldRushHeadline;
