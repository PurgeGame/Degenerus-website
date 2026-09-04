// Compact LINK funding-swap surface for the Side Bets rail. The reward quote uses
// the same amount-weighted curve and live on-chain inputs as the full funds
// dialog; this component only owns presentation and transaction state.

import { TX_CONFIRMED_EVENT } from '../app/contracts.js';
import { registerComponentPoll } from '../app/component-poll.js';
import {
  donateLink,
  formatLinkDonationMultiplier,
  linkDonationFlipQuote,
  readLinkDonationState,
} from '../app/link-donation.js?rev=link-reward-v1';
import {
  deriveCanSign,
  get,
  getViewedAddress,
  subscribe,
} from '../app/store.js';
import { compactUiError } from '../app/ui-error.js';

const TOKEN_WEI = 10n ** 18n;
const POLL_MS = 30_000;

let _readState = readLinkDonationState;
let _donate = donateLink;

function _address(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

/** Parse a decimal LINK amount without crossing through floating point. */
export function parseLinkDonationAmount(value) {
  const match = /^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const fraction = String(match[2] || '').padEnd(18, '0');
  try {
    return (BigInt(match[1]) * TOKEN_WEI) + BigInt(fraction || '0');
  } catch (_error) {
    return null;
  }
}

function _amountInput(value) {
  let raw;
  try { raw = BigInt(value ?? 0); } catch (_error) { raw = 0n; }
  if (raw < 0n) raw = 0n;
  const whole = raw / TOKEN_WEI;
  const fraction = String(raw % TOKEN_WEI).padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** Compact token values while retaining useful precision for small LINK quotes. */
export function formatLinkDonationAmount(value) {
  let raw;
  try { raw = BigInt(value ?? 0); } catch (_error) { return '—'; }
  const negative = raw < 0n;
  if (negative) raw = -raw;
  const tiers = [
    [1_000_000_000_000n * TOKEN_WEI, 'T'],
    [1_000_000_000n * TOKEN_WEI, 'B'],
    [1_000_000n * TOKEN_WEI, 'M'],
    [1_000n * TOKEN_WEI, 'K'],
  ];
  const tier = tiers.find(([threshold]) => raw >= threshold);
  const scale = tier?.[0] ?? TOKEN_WEI;
  const suffix = tier?.[1] ?? '';
  const whole = raw / scale;
  const decimals = suffix
    ? (whole >= 100n ? 0 : whole >= 10n ? 1 : 2)
    : (whole >= 100n ? 0 : whole >= 10n ? 1 : whole >= 1n ? 2 : 4);
  const factor = 10n ** BigInt(decimals);
  const rounded = ((raw * factor) + (scale / 2n)) / scale;
  if (raw > 0n && rounded === 0n) return `${negative ? '-' : ''}<0.${'0'.repeat(Math.max(0, decimals - 1))}1`;
  const integer = rounded / factor;
  const fraction = decimals === 0
    ? ''
    : String(rounded % factor).padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}${suffix}`;
}

function _setWriteLock(button, locked, reason = '') {
  if (!button) return;
  button.disabled = Boolean(locked);
  if (locked) {
    button.setAttribute('data-write-locked', '');
    button.setAttribute('data-write-lock-title', reason);
    button.title = reason;
  } else {
    button.removeAttribute('data-write-locked');
    button.removeAttribute('data-write-lock-title');
    button.removeAttribute('title');
  }
}

class AppLinkDonation extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #poll = null;
  #txListener = null;
  #refreshQueued = false;
  #seq = 0;
  #address = null;
  #state = null;
  #busy = false;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wire();
    for (const key of ['connected.address', 'viewing.address']) {
      this.#unsubs.push(subscribe(key, () => this.#onIdentityChange()));
    }
    for (const key of ['ui.mode', 'ui.chainOk']) {
      this.#unsubs.push(subscribe(key, () => this.#render()));
    }
    this.#poll = registerComponentPoll(() => this.#refresh(), POLL_MS);
    if (typeof document !== 'undefined') {
      this.#txListener = () => this.#queueRefresh();
      document.addEventListener?.(TX_CONFIRMED_EVENT, this.#txListener);
    }
    this.#onIdentityChange();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs) {
      try { unsubscribe(); } catch (_error) { /* defensive */ }
    }
    this.#unsubs = [];
    if (typeof this.#poll === 'function') this.#poll();
    if (this.#txListener && typeof document !== 'undefined') {
      document.removeEventListener?.(TX_CONFIRMED_EVENT, this.#txListener);
    }
    this.#poll = null;
    this.#txListener = null;
    this.#refreshQueued = false;
    this.#seq += 1;
    this.#initialized = false;
  }

  #renderShell() {
    this.innerHTML = `
      <section class="pari-link pari-funding-card pari-funding-card--link" data-bind="link-shell"
               aria-label="Fund Chainlink RNG with LINK and receive the quoted FLIP reward">
        <span class="pari-link__mark pari-funding-card__mark" aria-hidden="true">
          <img src="/symbols/crypto_05_chainlink_blue.svg" alt="">
        </span>
        <span class="pari-link__identity pari-funding-card__identity">
          <small>CHAINLINK RNG</small>
          <strong>LINK FUNDING SWAP</strong>
          <span class="pari-link__balance pari-funding-card__balance" data-bind="link-balance-wrap">
            <small>WALLET</small>
            <strong><span data-bind="link-balance">—</span><em>LINK</em></strong>
          </span>
        </span>
        <span class="pari-link__amount pari-funding-card__amount">
          <span class="pari-link__quote pari-funding-card__meta" data-bind="link-quote"
                data-state="loading" aria-live="polite">
            <small>GET</small>
            <strong>
              <output data-bind="link-quote-input">1 LINK</output>
              <i aria-hidden="true">→</i>
              <output data-bind="link-quote-reward">— FLIP</output>
            </strong>
            <em data-bind="link-multiplier">—</em>
          </span>
          <span class="pari-link__amount-control pari-funding-card__amount-control">
            <input type="text" data-bind="link-amount" inputmode="decimal"
                   autocomplete="off" spellcheck="false" aria-label="LINK funding amount">
            <span class="pari-link__unit pari-funding-card__unit">LINK</span>
            <button type="button" data-bind="link-max">MAX</button>
          </span>
        </span>
        <button type="button" class="pari-link__donate pari-funding-card__action" data-write data-write-locked
                data-write-lock-title="LINK balance is loading" data-bind="link-donate">
          <b data-bind="link-donate-label">FUND</b>
        </button>
        <p class="pari-link__feedback pari-funding-card__feedback" data-bind="link-feedback" hidden role="status"></p>
      </section>
    `;
    const input = this.querySelector('[data-bind="link-amount"]');
    if (input) input.value = '1';
  }

  #wire() {
    this.querySelector('[data-bind="link-donate"]')
      ?.addEventListener('click', () => { void this.#submit(); });
    this.querySelector('[data-bind="link-max"]')
      ?.addEventListener('click', () => this.#setMax());
    const input = this.querySelector('[data-bind="link-amount"]');
    input?.addEventListener('input', () => this.#render());
    input?.addEventListener('keydown', (event) => {
      if (event?.key === 'Enter') void this.#submit();
    });
  }

  #onIdentityChange() {
    const next = _address(getViewedAddress());
    if (next !== this.#address) {
      this.#seq += 1;
      this.#address = next;
      this.#state = null;
      this.#setFeedback('');
    }
    this.#render();
    this.#queueRefresh();
  }

  #queueRefresh() {
    if (!this.#initialized || this.#refreshQueued) return;
    this.#refreshQueued = true;
    queueMicrotask(() => {
      this.#refreshQueued = false;
      if (this.#initialized) void this.#refresh();
    });
  }

  async #refresh() {
    const target = _address(getViewedAddress());
    if (target !== this.#address) {
      this.#address = target;
      this.#state = null;
      this.#seq += 1;
      this.#render();
    }
    if (!target) return;
    const seq = ++this.#seq;
    let snapshot;
    try { snapshot = await _readState({ player: target }); }
    catch (_error) { return; }
    if (seq !== this.#seq || target !== this.#address) return;
    if (!snapshot) {
      this.#state = null;
    } else {
      const normalized = {};
      for (const key of [
        'balanceWei',
        'creditWei',
        'subscriptionBalanceWei',
        'ethPerLinkWei',
        'mintPriceWei',
      ]) {
        try { normalized[key] = snapshot[key] == null ? null : BigInt(snapshot[key]); }
        catch (_error) { normalized[key] = null; }
      }
      this.#state = normalized;
    }
    this.#render();
  }

  #canWrite() {
    const connected = _address(get('connected.address'));
    return Boolean(
      connected
      && connected === this.#address
      && get('ui.mode') === 'self'
      && deriveCanSign()
    );
  }

  #lockReason() {
    if (this.#busy) return 'Transaction in progress';
    if (!this.#address) return 'Connect a wallet first';
    if (!this.#canWrite()) return 'Open your own wallet view to donate LINK';
    if (this.#state?.balanceWei == null) return 'LINK balance is loading';
    if (this.#state.balanceWei <= 0n) return 'No LINK is available to donate';
    return '';
  }

  #quote(amount) {
    const pricingReady = this.#state?.subscriptionBalanceWei != null
      && this.#state?.ethPerLinkWei != null
      && this.#state?.mintPriceWei != null;
    if (!pricingReady || amount == null || amount < 0n) return null;
    return linkDonationFlipQuote({
      amountWei: amount,
      subscriptionBalanceWei: this.#state.subscriptionBalanceWei,
      ethPerLinkWei: this.#state.ethPerLinkWei,
      mintPriceWei: this.#state.mintPriceWei,
    });
  }

  #render() {
    const balance = this.querySelector('[data-bind="link-balance"]');
    const balanceWrap = this.querySelector('[data-bind="link-balance-wrap"]');
    if (balance) balance.textContent = this.#state?.balanceWei == null
      ? '—'
      : formatLinkDonationAmount(this.#state.balanceWei);
    if (balanceWrap) {
      const exact = this.#state?.balanceWei == null
        ? ''
        : `${_amountInput(this.#state.balanceWei)} LINK`;
      balanceWrap.title = exact;
      if (exact) balanceWrap.setAttribute('aria-label', `LINK wallet balance: ${exact}`);
      else balanceWrap.removeAttribute('aria-label');
    }

    const input = this.querySelector('[data-bind="link-amount"]');
    const amount = parseLinkDonationAmount(input?.value);
    const quote = this.#quote(amount);
    const quoteBox = this.querySelector('[data-bind="link-quote"]');
    const quoteInput = this.querySelector('[data-bind="link-quote-input"]');
    const quoteReward = this.querySelector('[data-bind="link-quote-reward"]');
    const multiplier = this.querySelector('[data-bind="link-multiplier"]');
    const pricingReady = this.#state?.subscriptionBalanceWei != null
      && this.#state?.ethPerLinkWei != null
      && this.#state?.mintPriceWei != null;
    const inputLabel = amount == null ? '— LINK' : `${formatLinkDonationAmount(amount)} LINK`;
    const rewardLabel = quote == null ? '— FLIP' : `${formatLinkDonationAmount(quote.flipWei)} FLIP`;
    if (quoteInput) quoteInput.textContent = inputLabel;
    if (quoteReward) quoteReward.textContent = rewardLabel;
    if (multiplier) {
      multiplier.textContent = quote == null
        ? '—'
        : formatLinkDonationMultiplier(quote.averageMultiplierWei);
    }
    if (quoteBox) {
      quoteBox.dataset.state = this.#state == null
        ? 'loading'
        : pricingReady ? 'ready' : 'unavailable';
      quoteBox.setAttribute('aria-label', quote
        ? `Funding with ${inputLabel} is estimated to receive ${rewardLabel} at an average ${formatLinkDonationMultiplier(quote.averageMultiplierWei)} reward multiplier.`
        : pricingReady
            ? 'Enter a valid LINK funding amount for a FLIP reward quote.'
          : this.#state == null
            ? 'Loading the current LINK funding reward quote.'
            : 'The current LINK funding reward quote is unavailable.');
    }

    const valid = amount != null
      && amount > 0n
      && this.#state?.balanceWei != null
      && amount <= this.#state.balanceWei;
    if (input) {
      if (input.value && !valid) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      input.disabled = this.#busy;
    }
    const donate = this.querySelector('[data-bind="link-donate"]');
    const donateLabel = this.querySelector('[data-bind="link-donate-label"]');
    if (donateLabel) donateLabel.textContent = this.#busy ? 'WAIT' : 'FUND';
    const lockReason = this.#lockReason();
    _setWriteLock(
      donate,
      Boolean(lockReason) || !valid,
      lockReason || 'Enter an amount up to your LINK wallet balance',
    );
    const max = this.querySelector('[data-bind="link-max"]');
    if (max) max.disabled = this.#busy || this.#state?.balanceWei == null;
  }

  #setMax() {
    if (this.#state?.balanceWei == null) return;
    const input = this.querySelector('[data-bind="link-amount"]');
    if (!input) return;
    input.value = _amountInput(this.#state.balanceWei);
    this.#render();
  }

  #setFeedback(message, { error = false } = {}) {
    const node = this.querySelector('[data-bind="link-feedback"]');
    if (!node) return;
    node.textContent = String(message || '');
    node.hidden = !message;
    if (error) node.setAttribute('data-state', 'error');
    else node.removeAttribute('data-state');
  }

  async #submit() {
    if (this.#busy || !this.#canWrite()) return;
    const input = this.querySelector('[data-bind="link-amount"]');
    const amount = parseLinkDonationAmount(input?.value);
    if (amount == null || amount <= 0n) {
      this.#setFeedback('Enter a LINK amount to donate.', { error: true });
      return;
    }
    if (this.#state?.balanceWei == null || amount > this.#state.balanceWei) {
      this.#setFeedback('Not enough LINK for that funding amount.', { error: true });
      return;
    }

    const target = this.#address;
    this.#busy = true;
    this.#setFeedback('');
    this.#render();
    try {
      await _donate({ amount });
      if (target !== this.#address) return;
      if (this.#state?.balanceWei != null) this.#state.balanceWei -= amount;
      this.#setFeedback(`${formatLinkDonationAmount(amount)} LINK FUNDED · FLIP CREDITED`);
      this.#queueRefresh();
    } catch (error) {
      if (target === this.#address) {
        this.#setFeedback(
          compactUiError(error, 'LINK funding did not go through.'),
          { error: true },
        );
      }
    } finally {
      this.#busy = false;
      this.#render();
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-link-donation')) {
  customElements.define('app-link-donation', AppLinkDonation);
}

/** Test-only dependency seam. */
export function __setLinkDonationWidgetDepsForTest({ read, donate } = {}) {
  if (typeof read === 'function') _readState = read;
  if (typeof donate === 'function') _donate = donate;
}

/** Test-only dependency reset. */
export function __resetLinkDonationWidgetDepsForTest() {
  _readState = readLinkDonationState;
  _donate = donateLink;
}
