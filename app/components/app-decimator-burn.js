// Full-width Decimator event rail. The ordinary side-bet card yields to this
// surface on the main app, while its legacy renderer remains available to
// standalone embeds that do not mount <app-decimator-burn>.

import { displayEth, displayToken } from '../app/scaling.js';
import { get, getActingAddress, getViewedAddress, subscribe } from '../app/store.js';
import { readGameState } from '../app/game-state.js';
import { activeBoonForProduct } from '../app/boons.js';
import { degenScoreLootTier } from '../app/activity-score.js';
import {
  burnForDecimator,
  DECIMATOR_MIN_FLIP_WEI,
  decimatorBracket,
  decimatorEffectiveBaseMultiplierBps,
  decimatorEffectiveMultiplierBps,
  decimatorEntryScoreWei,
  decimatorMultiplierCapApplied,
  decimatorPoolWei,
  decimatorWindowIsOpen,
  readDecimatorContext,
  readDecimatorRawBurnTotal,
} from '../app/decimator.js';
import { compactUiError } from '../app/ui-error.js';
import { registerComponentPoll } from '../app/component-poll.js';
import './boon-product-indicator.js';
import './quest-objective-indicator.js';

const POLL_MS = 15_000;
const POST_BURN_REFRESH_MS = 350;
const FLIP = 10n ** 18n;

let _readGame = readGameState;
let _readContext = readDecimatorContext;
let _readRawBurn = readDecimatorRawBurnTotal;
let _burn = burnForDecimator;

function _fmtFlip(raw) {
  try {
    const value = displayToken(BigInt(raw || 0), 0);
    const number = Number(value);
    return Number.isSafeInteger(number) ? number.toLocaleString('en-US') : value;
  } catch (_e) { return '—'; }
}

function _compactFlip(raw) {
  let value;
  try { value = BigInt(raw ?? 0); }
  catch (_e) { return '—'; }

  const negative = value < 0n;
  const whole = (negative ? -value : value) / FLIP;
  const sign = negative ? '-' : '';
  if (whole < 1_000n) return `${sign}${whole.toLocaleString('en-US')}`;

  const tiers = [
    [1_000_000_000_000n, 'T'],
    [1_000_000_000n, 'B'],
    [1_000_000n, 'M'],
    [1_000n, 'K'],
  ];
  const [scale, suffix] = tiers.find(([threshold]) => whole >= threshold);
  const units = whole / scale;
  const decimals = units >= 100n ? 0 : units >= 10n ? 1 : 2;
  const factor = 10n ** BigInt(decimals);
  const truncated = (whole * factor) / scale;
  const integer = truncated / factor;
  const fraction = decimals === 0
    ? ''
    : String(truncated % factor).padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${integer}${fraction ? `.${fraction}` : ''}${suffix}`;
}

export function formatDecimatorBurnQuote(weight, boonWeight = 0n) {
  let boon = 0n;
  try { boon = BigInt(boonWeight ?? 0); } catch (_e) { boon = 0n; }
  const total = _compactFlip(weight);
  return boon > 0n
    ? `+${total} · +${_compactFlip(boon)} BOON`
    : `+${total} SCORE`;
}

function _fmtEth(raw) {
  try {
    const value = displayEth(BigInt(raw || 0), 3)
      .replace(/\.000$/, '')
      .replace(/(\.\d*?)0+$/, '$1');
    const [whole, fraction] = value.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction == null ? grouped : `${grouped}.${fraction}`;
  } catch (_e) { return '—'; }
}

function _parseFlip(raw) {
  const match = String(raw ?? '').trim().replace(/,/g, '')
    .match(/^(\d+)(?:\.(\d{1,18}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * FLIP + BigInt(String(match[2] || '').padEnd(18, '0'));
}

function _inputFlip(raw) {
  const value = BigInt(raw || 0);
  const whole = value / FLIP;
  const remainder = value % FLIP;
  if (remainder === 0n) return String(whole);
  return `${whole}.${String(remainder).padStart(18, '0').replace(/0+$/, '')}`;
}

function _percentFromBps(value, { signed = false } = {}) {
  const bps = Number(value || 0);
  if (!Number.isFinite(bps)) return '—';
  const percent = bps / 100;
  const text = Number.isInteger(percent)
    ? String(percent)
    : percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${signed && percent > 0 ? '+' : ''}${text}%`;
}

export function decimatorBoonBps(payload) {
  const type = Number(activeBoonForProduct(payload, 'decimator')?.row?.boonType || 0);
  if (type === 13) return 1_000;
  if (type === 14) return 2_500;
  if (type === 15) return 5_000;
  return 0;
}

class AppDecimatorBurn extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #timer = null;
  #postBurnTimer = null;
  #errorTimer = null;
  #questListener = null;
  #burnListener = null;
  #seq = 0;
  #gameState = null;
  #context = null;
  #targetLevel = null;
  #open = false;
  #busy = false;
  #draft = '1000';

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wire();
    for (const key of ['connected.address', 'viewing.address', 'ui.mode', 'app.boons']) {
      this.#unsubs.push(subscribe(key, () => {
        if (key === 'app.boons' || key === 'ui.mode') this.#render();
        else void this.#refresh();
      }));
    }
    this.#timer = registerComponentPoll(() => this.#refresh(), POLL_MS);
    void this.#refresh();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs) {
      try { unsubscribe(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (typeof this.#timer === 'function') this.#timer();
    if (this.#postBurnTimer != null) clearTimeout(this.#postBurnTimer);
    if (this.#errorTimer != null) clearTimeout(this.#errorTimer);
    if (typeof document !== 'undefined') {
      if (this.#questListener) document.removeEventListener?.('quest:activate', this.#questListener);
      if (this.#burnListener) document.removeEventListener?.('app-decimator:burn-confirmed', this.#burnListener);
    }
    this.#timer = null;
    this.#postBurnTimer = null;
    this.#errorTimer = null;
    this.#questListener = null;
    this.#burnListener = null;
    this.#seq += 1;
    this.#initialized = false;
  }

  #renderShell() {
    this.hidden = true;
    this.innerHTML = `
      <section class="dbb" data-bind="dbb-shell" hidden aria-labelledby="dbb-title">
        <header class="dbb__identity">
          <span class="dbb__reactor" aria-hidden="true">
            <span class="dbb__reactor-ring"></span>
            <img src="/app/assets/decimator-draw-mark.svg" alt="">
          </span>
          <span class="dbb__identity-copy">
            <small>LEVEL <span data-bind="dbb-level">—</span> EVENT</small>
            <h2 id="dbb-title">DECIMATOR</h2>
            <span class="dbb__live">BURN <img src="/whitepaper/flame-logo-split.svg" alt="FLIP"> TO WIN</span>
          </span>
        </header>

        <div class="dbb__stats" aria-label="Live Decimator results">
          <article class="dbb-stat dbb-stat--prize">
            <span><small>PRIZE POOL</small><strong><b data-bind="dbb-prize">—</b><em>ETH</em></strong></span>
          </article>
          <article class="dbb-stat dbb-stat--burned">
            <span><small>FLIP BURNED</small><strong><b data-bind="dbb-burned">—</b><em>FLIP</em></strong></span>
          </article>
        </div>

        <div class="dbb__entry">
          <span class="dbb__entry-meta">
            <span class="dbb__bracket">
              <span class="dbb__bracket-id">
                <small>BRACKET</small>
                <strong><b data-bind="dbb-bracket-number">—</b></strong>
              </span>
              <span class="dbb__bracket-score">
                <small>DEGEN RATING</small>
                <strong data-bind="dbb-bracket-range">—</strong>
              </span>
            </span>
            <span class="dbb__actual-multi"
                  title="Total includes activity, timing, and any boon. CAPPED applies to the non-boon base.">
              <small>YOUR MULTIPLIER</small>
              <strong>
                <b data-bind="dbb-live-multi">—</b>
                <em data-bind="dbb-multi-cap" hidden></em>
              </strong>
            </span>
          </span>
          <div class="dbb__entry-controls">
            <label class="dbb__input">
              <boon-product-indicator product="decimator"></boon-product-indicator>
              <span class="dbb__input-control">
                <small>BURN AMOUNT</small>
                <input type="text" inputmode="decimal" name="dbb-amount" value="1000"
                       aria-label="Decimator burn amount in FLIP">
                <b>FLIP</b>
                <span class="dbb__stepper">
                  <button type="button" data-bind="dbb-up" aria-label="Add 1,000 FLIP">▲</button>
                  <button type="button" data-bind="dbb-down" aria-label="Remove 1,000 FLIP">▼</button>
                </span>
              </span>
            </label>
            <button type="button" class="dbb__burn" data-write data-bind="dbb-burn">
              <span data-bind="dbb-burn-action">BURN FLIP</span>
              <strong data-bind="dbb-quote">SCORE —</strong>
              <quest-objective-indicator product="decimator"></quest-objective-indicator>
            </button>
          </div>
          <p class="dbb__feedback" data-bind="dbb-feedback" hidden role="status"></p>
        </div>

        <article class="dbb-stat dbb-stat--score">
          <span><small>YOUR DECIMATOR SCORE</small><strong data-bind="dbb-player-score">—</strong></span>
        </article>
      </section>
    `;
  }

  #wire() {
    const input = this.querySelector('[name="dbb-amount"]');
    input?.addEventListener('input', () => {
      this.#draft = String(input.value || '');
      this.#paintQuote();
    });
    input?.addEventListener('keydown', (event) => {
      if (event?.key === 'Enter') void this.#enter();
    });
    this.querySelector('[data-bind="dbb-up"]')?.addEventListener('click', () => this.#step(1));
    this.querySelector('[data-bind="dbb-down"]')?.addEventListener('click', () => this.#step(-1));
    this.querySelector('[data-bind="dbb-burn"]')?.addEventListener('click', () => this.#enter());
    if (typeof document !== 'undefined') {
      this.#questListener = (event) => {
        if (Number(event?.detail?.questType) !== 5) return;
        let amount;
        try { amount = BigInt(event?.detail?.target ?? 0); } catch (_e) { amount = 0n; }
        if (amount < DECIMATOR_MIN_FLIP_WEI) amount = 2_000n * FLIP;
        this.#draft = _inputFlip(amount);
        if (input) input.value = this.#draft;
        this.#paintQuote();
        try { this.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_e) {}
        if (event?.detail?.submit) void this.#enter();
      };
      this.#burnListener = (event) => {
        if (event?.target === this) return;
        void this.#refresh();
      };
      document.addEventListener?.('quest:activate', this.#questListener);
      document.addEventListener?.('app-decimator:burn-confirmed', this.#burnListener);
    }
  }

  #step(direction) {
    const input = this.querySelector('[name="dbb-amount"]');
    const parsed = _parseFlip(input?.value);
    const current = parsed == null ? DECIMATOR_MIN_FLIP_WEI : parsed;
    const stepped = current + BigInt(direction) * 1_000n * FLIP;
    const next = stepped < DECIMATOR_MIN_FLIP_WEI ? DECIMATOR_MIN_FLIP_WEI : stepped;
    this.#draft = _inputFlip(next);
    if (input) input.value = this.#draft;
    this.#paintQuote();
  }

  async #refresh() {
    const seq = ++this.#seq;
    let state = null;
    try { state = await _readGame(); } catch (_e) { state = null; }
    if (seq !== this.#seq) return;
    this.#gameState = state;
    const level = Number(state?.level);
    this.#targetLevel = Number.isInteger(level) && level >= 0 ? level + 1 : null;
    this.#open = this.#targetLevel != null && decimatorWindowIsOpen(state);
    if (!this.#open) {
      this.#context = null;
      this.#render();
      return;
    }

    // Paint the open rail immediately, then fill chain/indexed numbers as each
    // read arrives. Raw burn scanning is cursor-cached and intentionally does
    // not hold the prize or modifier rail hostage on its first pass.
    this.#render();
    const viewed = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || getActingAddress()
      || null;
    const contextPromise = _readContext(viewed, this.#targetLevel).catch(() => null);
    const rawPromise = _readRawBurn({
      level: this.#targetLevel,
      // The API normally supplies this exact boundary. If it is temporarily
      // null, decimator.js falls back to the indexed stage-7 opening block.
      sinceTimestamp: state?.levelStartTime,
    }).catch(() => null);
    const context = await contextPromise;
    if (seq !== this.#seq) return;
    if (context) this.#context = context;
    this.#render();
    const raw = await rawPromise;
    if (seq !== this.#seq) return;
    if (raw != null) this.#context = { ...(this.#context || {}), totalRawBurnWei: BigInt(raw) };
    this.#render();
  }

  #render() {
    const shell = this.querySelector('[data-bind="dbb-shell"]');
    this.hidden = !this.#open;
    if (shell) shell.hidden = !this.#open;
    if (!this.#open || !shell) return;

    const level = this.querySelector('[data-bind="dbb-level"]');
    if (level) level.textContent = this.#targetLevel == null ? '—' : String(this.#targetLevel);
    const futurePool = this.#context?.futurePoolWei
      ?? this.#gameState?.prizePools?.futurePrizePool;
    const prize = this.#targetLevel == null ? null : decimatorPoolWei(futurePool, this.#targetLevel);
    const values = [
      ['dbb-prize', prize == null ? '—' : _fmtEth(prize)],
      ['dbb-burned', this.#context?.totalRawBurnWei == null ? '—' : _fmtFlip(this.#context.totalRawBurnWei)],
      ['dbb-player-score', this.#context?.totalBurnWeight == null ? '—' : _fmtFlip(this.#context.totalBurnWeight)],
    ];
    for (const [bind, value] of values) {
      const node = this.querySelector(`[data-bind="${bind}"]`);
      if (node) node.textContent = value;
    }

    const bracketScore = this.#context?.activityScore;
    const bracket = bracketScore == null
      ? null
      : decimatorBracket(bracketScore, { level: this.#targetLevel });
    const bracketNumber = this.querySelector('[data-bind="dbb-bracket-number"]');
    const bracketRange = this.querySelector('[data-bind="dbb-bracket-range"]');
    if (bracketNumber) bracketNumber.textContent = bracket == null ? '—' : String(bracket.bucket);
    if (bracketRange) {
      const range = bracket == null
        ? null
        : bracket.maxScore == null
          ? `${bracket.minScore.toLocaleString('en-US')}+`
          : `${bracket.minScore.toLocaleString('en-US')}–${bracket.maxScore.toLocaleString('en-US')}`;
      bracketRange.textContent = range || '—';
      const scoreTier = degenScoreLootTier(bracketScore);
      if (scoreTier) bracketRange.setAttribute('data-score-tier', scoreTier);
      else bracketRange.removeAttribute('data-score-tier');
    }
    this.#paintQuote(decimatorBoonBps(get('app.boons')));
  }

  #canWrite() {
    const acting = getActingAddress();
    const connected = get('connected.address');
    return Boolean(
      acting
      && connected
      && String(acting).toLowerCase() === String(connected).toLowerCase()
      && get('ui.mode') === 'self'
    );
  }

  #paintQuote(knownBoonBps = null) {
    const input = this.querySelector('[name="dbb-amount"]');
    const quote = this.querySelector('[data-bind="dbb-quote"]');
    const button = this.querySelector('[data-bind="dbb-burn"]');
    const action = this.querySelector('[data-bind="dbb-burn-action"]');
    const amount = _parseFlip(input?.value);
    const score = Number(this.#context?.activityScore);
    let weight = null;
    let boonWeight = 0n;
    let actualMultiplierBps = null;
    let baseMultiplierBps = null;
    let multiplierCapped = false;
    if (amount != null && amount >= DECIMATOR_MIN_FLIP_WEI && Number.isFinite(score)) {
      let previous = 0n;
      try { previous = BigInt(this.#context?.totalBurnWeight ?? 0); } catch (_e) { previous = 0n; }
      const scoreArgs = {
        amountWei: amount,
        previousScoreWei: previous,
        activityScore: Math.max(0, Math.trunc(score)),
        dayOneActive: this.#context?.dayOneActive === true,
        lastPurchaseDay: this.#context?.lastPurchaseDay === true,
        boonBps: knownBoonBps ?? decimatorBoonBps(get('app.boons')),
      };
      weight = decimatorEntryScoreWei(scoreArgs);
      if (scoreArgs.boonBps > 0) {
        const withoutBoon = decimatorEntryScoreWei({ ...scoreArgs, boonBps: 0 });
        boonWeight = weight > withoutBoon ? weight - withoutBoon : 0n;
      }
      actualMultiplierBps = decimatorEffectiveMultiplierBps(scoreArgs);
      baseMultiplierBps = decimatorEffectiveBaseMultiplierBps(scoreArgs);
      multiplierCapped = decimatorMultiplierCapApplied(scoreArgs);
    }
    if (quote) {
      const hasBoonQuote = weight != null && boonWeight > 0n;
      quote.textContent = amount != null && amount < DECIMATOR_MIN_FLIP_WEI
        ? 'MIN 1,000 FLIP'
        : weight == null
          ? 'SCORE —'
          : formatDecimatorBurnQuote(weight, boonWeight);
      quote.classList?.toggle('has-boon', hasBoonQuote);
      if (hasBoonQuote) {
        const detail = `Adds ${_fmtFlip(weight)} score, including ${_fmtFlip(boonWeight)} from Decimator boon`;
        quote.setAttribute?.('title', detail);
        quote.setAttribute?.('aria-label', detail);
      } else {
        quote.removeAttribute?.('title');
        quote.removeAttribute?.('aria-label');
      }
    }
    if (action) action.textContent = this.#busy ? 'BURNING…' : 'BURN FLIP';
    const liveMulti = this.querySelector('[data-bind="dbb-live-multi"]');
    if (liveMulti) {
      liveMulti.textContent = actualMultiplierBps == null
        ? '—'
        : _percentFromBps(actualMultiplierBps);
    }
    const cap = this.querySelector('[data-bind="dbb-multi-cap"]');
    if (cap) {
      const showCap = multiplierCapped
        && actualMultiplierBps != null
        && actualMultiplierBps <= 10_000n;
      cap.hidden = !showCap;
      cap.textContent = !showCap
        ? ''
        : baseMultiplierBps === actualMultiplierBps ? '(CAPPED)' : '(BASE CAPPED)';
    }
    if (button) {
      button.disabled = this.#busy
        || !this.#open
        || !this.#canWrite()
        || amount == null
        || amount < DECIMATOR_MIN_FLIP_WEI;
    }
  }

  #setFeedback(message, error = false) {
    const node = this.querySelector('[data-bind="dbb-feedback"]');
    if (!node) return;
    node.textContent = String(message || '');
    node.hidden = !message;
    node.classList?.toggle('is-error', Boolean(error));
    if (this.#errorTimer != null) clearTimeout(this.#errorTimer);
    this.#errorTimer = null;
    if (message) {
      this.#errorTimer = setTimeout(() => {
        node.hidden = true;
        node.textContent = '';
      }, 10_000);
      try { this.#errorTimer?.unref?.(); } catch (_e) { /* browser timer */ }
    }
  }

  async #enter() {
    if (this.#busy || !this.#open || !this.#canWrite()) return;
    const input = this.querySelector('[name="dbb-amount"]');
    const amount = _parseFlip(input?.value);
    if (amount == null || amount < DECIMATOR_MIN_FLIP_WEI) {
      this.#setFeedback('Minimum burn is 1,000 FLIP.', true);
      return;
    }
    const player = getActingAddress();
    if (!player) return;
    this.#busy = true;
    this.#setFeedback('');
    this.#paintQuote();
    try {
      const { receipt } = await _burn({ player, amount });
      this.#setFeedback('BURN CONFIRMED');
      try {
        this.dispatchEvent(new CustomEvent('app-decimator:burn-confirmed', {
          bubbles: true,
          detail: {
            player,
            amountWei: amount,
            transactionHash: receipt?.hash || receipt?.transactionHash || null,
          },
        }));
      } catch (_e) { /* progressive refresh event */ }
      if (this.#postBurnTimer != null) clearTimeout(this.#postBurnTimer);
      this.#postBurnTimer = setTimeout(() => { void this.#refresh(); }, POST_BURN_REFRESH_MS);
      try { this.#postBurnTimer?.unref?.(); } catch (_e) { /* browser timer */ }
    } catch (error) {
      this.#setFeedback(compactUiError(error, 'Decimator burn did not go through.'), true);
    } finally {
      this.#busy = false;
      this.#paintQuote();
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-decimator-burn')) {
  customElements.define('app-decimator-burn', AppDecimatorBurn);
}

export function __setDecimatorBurnWidgetDepsForTest({ game, context, rawBurn, burn } = {}) {
  if (typeof game === 'function') _readGame = game;
  if (typeof context === 'function') _readContext = context;
  if (typeof rawBurn === 'function') _readRawBurn = rawBurn;
  if (typeof burn === 'function') _burn = burn;
}

export function __resetDecimatorBurnWidgetDepsForTest() {
  _readGame = readGameState;
  _readContext = readDecimatorContext;
  _readRawBurn = readDecimatorRawBurnTotal;
  _burn = burnForDecimator;
}

export { _parseFlip as parseDecimatorFlipInput };
