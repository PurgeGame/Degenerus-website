// One mounted host for Protocol Coins actions. Dedicated entry points can open
// ETH, FLIP, or LINK directly; the coinflip CASH OUT entry shows ETH and FLIP
// together without routing either action through Pending or a second popup.

import { formatEther, parseEther } from 'ethers';
import { ETH_DIVISOR } from '../app/chain-config.js';
import { claimEthAmount, claimFlip, readClaimableEth } from '../app/claims.js';
import { readClaimableCoinflip } from '../app/coinflip.js';
import {
  donateLink,
  formatLinkDonationMultiplier,
  linkDonationFlipQuote,
  readLinkDonationState,
} from '../app/link-donation.js';
import { normalizePlayerFundsMode, PLAYER_FUNDS_OPEN_EVENT } from '../app/player-funds.js';
import { getActingAddress, subscribe } from '../app/store.js';
import { compactUiError } from '../app/ui-error.js';

function _trim(value) {
  return String(value ?? '').replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function _ethInput(raw) {
  try { return _trim(formatEther(BigInt(raw || 0) * ETH_DIVISOR)); }
  catch (_e) { return '0'; }
}

function _tokenInput(raw) {
  try { return _trim(formatEther(BigInt(raw || 0))); }
  catch (_e) { return '0'; }
}

function _parseEthInput(value) {
  try { return parseEther(String(value ?? '').trim()) / ETH_DIVISOR; }
  catch (_e) { return null; }
}

function _parseTokenInput(value) {
  try { return parseEther(String(value ?? '').trim()); }
  catch (_e) { return null; }
}

const COMPACT_SCALES = [
  [1_000_000_000_000n, 'T'],
  [1_000_000_000n, 'B'],
  [1_000_000n, 'M'],
  [1_000n, 'K'],
];

function _compactAmountLabel(amount, unit) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(amount ?? '').trim());
  if (!match) return `0 ${unit}`;
  const whole = BigInt(match[1] || 0);
  const fraction = match[2] || '';
  let scaleIndex = COMPACT_SCALES.findIndex(([scale]) => whole >= scale);
  if (scaleIndex >= 0) {
    const micros = (whole * 1_000_000n)
      + BigInt((fraction + '000000').slice(0, 6));
    let [scale, suffix] = COMPACT_SCALES[scaleIndex];
    let hundredths = ((micros * 100n) + (scale * 500_000n)) / (scale * 1_000_000n);
    if (hundredths >= 100_000n && scaleIndex > 0) {
      [scale, suffix] = COMPACT_SCALES[--scaleIndex];
      hundredths = ((micros * 100n) + (scale * 500_000n)) / (scale * 1_000_000n);
    }
    const major = hundredths / 100n;
    const minor = String(hundredths % 100n).padStart(2, '0').replace(/0+$/, '');
    return `${major.toLocaleString('en-US')}${minor ? `.${minor}` : ''}${suffix} ${unit}`;
  }
  const visibleFraction = fraction.slice(0, 4).replace(/0+$/, '');
  if (whole === 0n && !visibleFraction && /[1-9]/.test(fraction)) return `<0.0001 ${unit}`;
  return `${whole.toLocaleString('en-US')}${visibleFraction ? `.${visibleFraction}` : ''} ${unit}`;
}

function _paintBalance(node, amount, unit) {
  if (!node) return;
  if (amount == null) {
    node.textContent = '—';
    node.removeAttribute('title');
    node.removeAttribute('aria-label');
    return;
  }
  const exact = `${amount} ${unit}`;
  node.textContent = _compactAmountLabel(amount, unit);
  node.setAttribute('title', `Exact balance: ${exact}`);
  node.setAttribute('aria-label', `Available balance: ${exact}`);
}

class AppPlayerFundsDialog extends HTMLElement {
  #initialized = false;
  #open = false;
  #mode = 'flip';
  #busy = null;
  #address = null;
  #ethWei = null;
  #flipWei = null;
  #linkState = null;
  #requestSeq = 0;
  #openListener = null;
  #unsub = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wire();
    this.#openListener = (event) => this.open(event?.detail?.mode);
    if (typeof document !== 'undefined') {
      document.addEventListener?.(PLAYER_FUNDS_OPEN_EVENT, this.#openListener);
    }
    this.#unsub = subscribe('connected.address', () => {
      if (this.#open) void this.#refresh({ seed: false });
    });
  }

  disconnectedCallback() {
    if (this.#openListener && typeof document !== 'undefined') {
      document.removeEventListener?.(PLAYER_FUNDS_OPEN_EVENT, this.#openListener);
    }
    try { this.#unsub?.(); } catch (_e) { /* defensive */ }
    this.#openListener = null;
    this.#unsub = null;
    this.#requestSeq += 1;
    this.#initialized = false;
  }

  open(mode = 'flip') {
    this.#mode = normalizePlayerFundsMode(mode);
    this.#open = true;
    this.#setError('');
    this.#render();
    void this.#refresh({ seed: true });
  }

  #close() {
    if (this.#busy) return;
    this.#open = false;
    this.#setError('');
    this.#render();
  }

  #renderShell() {
    this.innerHTML = `
      <div class="pfd-backdrop" data-bind="pfd-backdrop" hidden>
        <section class="pfd-card" role="dialog" aria-modal="true" aria-labelledby="pfd-title">
          <button type="button" class="pfd-close" data-bind="pfd-close" aria-label="Close funds popup">×</button>
          <header class="pfd-head">
            <span class="pfd-head__mark"><img src="/whitepaper/flame-logo-split.svg" alt="" aria-hidden="true"></span>
            <span class="pfd-head__copy">
              <small data-bind="pfd-kicker">PROTOCOL FUNDS</small>
              <h2 id="pfd-title" data-bind="pfd-title">Claim FLIP</h2>
              <p data-bind="pfd-subtitle">Move settled winnings to your wallet.</p>
            </span>
          </header>
          <div class="pfd-section" data-bind="pfd-eth-section" hidden>
            <article class="pfd-balance pfd-balance--eth">
              <header class="pfd-asset-head">
                <span class="pfd-asset">
                  <span class="pfd-asset__icon"><img src="/shared/eth-blue.svg" alt="" aria-hidden="true"></span>
                  <span class="pfd-asset__name"><strong>ETH</strong><small>ACTIVITY RULES APPLY</small></span>
                </span>
                <span class="pfd-available"><small>AVAILABLE</small><strong data-bind="pfd-eth-balance">—</strong></span>
              </header>
              <div class="pfd-input-row">
                <label class="pfd-amount-field">
                  <input type="text" inputmode="decimal" name="pfd-eth" value="0" autocomplete="off" spellcheck="false" aria-label="ETH amount to claim">
                  <span aria-hidden="true">ETH</span>
                </label>
                <button type="button" data-bind="pfd-eth-max">MAX</button>
                <button type="button" data-write data-bind="pfd-eth-claim">CLAIM ETH</button>
              </div>
            </article>
          </div>
          <div class="pfd-section" data-bind="pfd-flip-section">
            <article class="pfd-balance pfd-balance--flip">
              <header class="pfd-asset-head">
                <span class="pfd-asset">
                  <span class="pfd-asset__icon"><img src="/whitepaper/flame-logo-split.svg" alt="" aria-hidden="true"></span>
                  <span class="pfd-asset__name"><strong>FLIP</strong><small>SETTLED COINFLIP WINS</small></span>
                </span>
                <span class="pfd-available"><small>AVAILABLE</small><strong data-bind="pfd-flip-balance">—</strong></span>
              </header>
              <div class="pfd-input-row">
                <label class="pfd-amount-field">
                  <input type="text" inputmode="decimal" name="pfd-flip" value="0" autocomplete="off" spellcheck="false" aria-label="FLIP amount to claim">
                  <span aria-hidden="true">FLIP</span>
                </label>
                <button type="button" data-bind="pfd-flip-max">MAX</button>
                <button type="button" data-write data-bind="pfd-flip-claim">CLAIM FLIP</button>
              </div>
            </article>
          </div>
          <div class="pfd-section pfd-link" data-bind="pfd-link-section" hidden>
            <div class="pfd-link__stats">
              <span><small>WALLET</small><strong data-bind="pfd-link-balance">—</strong></span>
              <span><small>RNG CREDIT</small><strong data-bind="pfd-link-credit">—</strong></span>
            </div>
            <div class="pfd-link__quote" data-bind="pfd-link-quote" data-state="loading" aria-live="polite">
              <span><small>CURRENT MULTIPLIER</small><strong data-bind="pfd-link-multiplier">—</strong></span>
              <span class="pfd-link__conversion">
                <small>YOUR QUOTE</small>
                <strong><output data-bind="pfd-link-quote-input">0 LINK</output><i aria-hidden="true">→</i><output data-bind="pfd-link-quote-reward">— FLIP</output></strong>
              </span>
            </div>
            <p>Funds Chainlink, banks equal RNG credit, and earns the live FLIP reward quoted above.</p>
            <div class="pfd-input-row">
              <label class="pfd-amount-field">
                <input type="text" inputmode="decimal" name="pfd-link" value="0" autocomplete="off" spellcheck="false" aria-label="LINK amount to donate">
                <span aria-hidden="true">LINK</span>
              </label>
              <button type="button" data-bind="pfd-link-max">MAX</button>
              <button type="button" data-write data-bind="pfd-link-donate">DONATE LINK</button>
            </div>
          </div>
          <p class="pfd-error" data-bind="pfd-error" hidden role="alert"></p>
        </section>
      </div>
    `;
  }

  #wire() {
    this.querySelector('[data-bind="pfd-close"]')?.addEventListener('click', () => this.#close());
    this.querySelector('[data-bind="pfd-backdrop"]')?.addEventListener('click', (event) => {
      if (event?.target === this.querySelector('[data-bind="pfd-backdrop"]')) this.#close();
    });
    this.querySelector('[data-bind="pfd-eth-max"]')?.addEventListener('click', () => {
      const input = this.querySelector('[name="pfd-eth"]');
      if (input) input.value = _ethInput(this.#ethWei ?? 0n);
      this.#renderButtons();
    });
    this.querySelector('[data-bind="pfd-flip-max"]')?.addEventListener('click', () => {
      const input = this.querySelector('[name="pfd-flip"]');
      if (input) input.value = _tokenInput(this.#flipWei ?? 0n);
      this.#renderButtons();
    });
    this.querySelector('[data-bind="pfd-link-max"]')?.addEventListener('click', () => {
      const input = this.querySelector('[name="pfd-link"]');
      if (input) input.value = _tokenInput(this.#linkState?.balanceWei ?? 0n);
      this.#renderButtons();
    });
    for (const name of ['pfd-eth', 'pfd-flip', 'pfd-link']) {
      this.querySelector(`[name="${name}"]`)?.addEventListener('input', () => this.#renderButtons());
    }
    this.querySelector('[data-bind="pfd-eth-claim"]')?.addEventListener('click', () => this.#run('eth'));
    this.querySelector('[data-bind="pfd-flip-claim"]')?.addEventListener('click', () => this.#run('flip'));
    this.querySelector('[data-bind="pfd-link-donate"]')?.addEventListener('click', () => this.#run('link'));
    this.addEventListener('keydown', (event) => {
      if (event?.key === 'Escape') this.#close();
    });
  }

  async #refresh({ seed = false } = {}) {
    const address = getActingAddress();
    this.#address = address ? String(address).toLowerCase() : null;
    const seq = ++this.#requestSeq;
    if (!this.#address) {
      this.#ethWei = 0n;
      this.#flipWei = 0n;
      this.#linkState = { balanceWei: 0n, creditWei: 0n };
      this.#render();
      return;
    }
    const [eth, flip, link] = await Promise.allSettled([
      readClaimableEth({ player: this.#address }),
      readClaimableCoinflip({ player: this.#address }),
      readLinkDonationState({ player: this.#address }),
    ]);
    if (seq !== this.#requestSeq) return;
    this.#ethWei = eth.status === 'fulfilled' && eth.value != null ? BigInt(eth.value) : null;
    this.#flipWei = flip.status === 'fulfilled' && flip.value != null ? BigInt(flip.value) : null;
    this.#linkState = link.status === 'fulfilled' ? link.value : null;
    if (seed) {
      const ethInput = this.querySelector('[name="pfd-eth"]');
      const flipInput = this.querySelector('[name="pfd-flip"]');
      if (ethInput) ethInput.value = _ethInput(this.#ethWei ?? 0n);
      if (flipInput) flipInput.value = _tokenInput(this.#flipWei ?? 0n);
    }
    this.#render();
  }

  #setError(message) {
    const node = this.querySelector('[data-bind="pfd-error"]');
    if (!node) return;
    node.textContent = String(message || '');
    node.hidden = !message;
  }

  #render() {
    const backdrop = this.querySelector('[data-bind="pfd-backdrop"]');
    if (backdrop) backdrop.hidden = !this.#open;
    const eth = this.querySelector('[data-bind="pfd-eth-section"]');
    const flip = this.querySelector('[data-bind="pfd-flip-section"]');
    const link = this.querySelector('[data-bind="pfd-link-section"]');
    const cashout = this.#mode === 'cashout';
    if (eth) eth.hidden = !cashout && this.#mode !== 'eth';
    if (flip) flip.hidden = !cashout && this.#mode !== 'flip';
    if (link) link.hidden = this.#mode !== 'link';
    const titles = {
      cashout: ['WITHDRAWAL DESK', 'Cash out', 'Move claimable funds to your wallet.'],
      eth: ['ETH CASHOUT', 'Claim ETH', 'Move claimable ETH to your wallet.'],
      flip: ['COINFLIP FUNDS', 'Claim FLIP', 'Move settled winnings to your wallet.'],
      link: ['CHAINLINK RNG', 'Fund RNG', 'Top up the protocol RNG subscription.'],
    };
    const [kicker, title, subtitle] = titles[this.#mode] || titles.flip;
    const kickerNode = this.querySelector('[data-bind="pfd-kicker"]');
    const titleNode = this.querySelector('[data-bind="pfd-title"]');
    const subtitleNode = this.querySelector('[data-bind="pfd-subtitle"]');
    if (kickerNode) kickerNode.textContent = kicker;
    if (titleNode) titleNode.textContent = title;
    if (subtitleNode) subtitleNode.textContent = subtitle;
    const ethLabel = this.querySelector('[data-bind="pfd-eth-balance"]');
    const flipLabel = this.querySelector('[data-bind="pfd-flip-balance"]');
    const linkBalance = this.querySelector('[data-bind="pfd-link-balance"]');
    const linkCredit = this.querySelector('[data-bind="pfd-link-credit"]');
    _paintBalance(ethLabel, this.#ethWei == null ? null : _ethInput(this.#ethWei), 'ETH');
    _paintBalance(flipLabel, this.#flipWei == null ? null : _tokenInput(this.#flipWei), 'FLIP');
    _paintBalance(linkBalance, this.#linkState == null ? null : _tokenInput(this.#linkState.balanceWei), 'LINK');
    _paintBalance(linkCredit, this.#linkState == null ? null : _tokenInput(this.#linkState.creditWei), 'LINK');
    this.#renderButtons();
  }

  #renderButtons() {
    const connected = Boolean(this.#address);
    const ethAmount = _parseEthInput(this.querySelector('[name="pfd-eth"]')?.value);
    const flipAmount = _parseTokenInput(this.querySelector('[name="pfd-flip"]')?.value);
    const linkAmount = _parseTokenInput(this.querySelector('[name="pfd-link"]')?.value);
    this.#renderLinkQuote(linkAmount);
    const models = [
      ['pfd-eth-claim', ethAmount, this.#ethWei, 'CLAIM ETH', 'CLAIMING…', 'eth'],
      ['pfd-flip-claim', flipAmount, this.#flipWei, 'CLAIM FLIP', 'CLAIMING…', 'flip'],
      ['pfd-link-donate', linkAmount, this.#linkState?.balanceWei, 'DONATE LINK', 'DONATING…', 'link'],
    ];
    for (const [bind, amount, balance, label, busyLabel, kind] of models) {
      const button = this.querySelector(`[data-bind="${bind}"]`);
      if (!button) continue;
      const valid = connected && amount != null && amount > 0n && balance != null && amount <= balance;
      button.disabled = Boolean(this.#busy) || !valid;
      button.textContent = this.#busy === kind ? busyLabel : label;
    }
  }

  #renderLinkQuote(amountWei) {
    const container = this.querySelector('[data-bind="pfd-link-quote"]');
    const multiplierNode = this.querySelector('[data-bind="pfd-link-multiplier"]');
    const inputNode = this.querySelector('[data-bind="pfd-link-quote-input"]');
    const rewardNode = this.querySelector('[data-bind="pfd-link-quote-reward"]');
    if (!container || !multiplierNode || !inputNode || !rewardNode) return;
    const amount = amountWei != null && amountWei >= 0n ? amountWei : null;
    const pricingReady = this.#linkState?.subscriptionBalanceWei != null
      && this.#linkState?.ethPerLinkWei != null
      && this.#linkState?.mintPriceWei != null;
    const rateQuote = !pricingReady ? null : linkDonationFlipQuote({
      amountWei: 0n,
      subscriptionBalanceWei: this.#linkState.subscriptionBalanceWei,
      ethPerLinkWei: this.#linkState.ethPerLinkWei,
      mintPriceWei: this.#linkState.mintPriceWei,
    });
    const currentMultiplierWei = rateQuote?.currentMultiplierWei ?? null;
    const quote = amount == null || !pricingReady ? null : linkDonationFlipQuote({
      amountWei: amount,
      subscriptionBalanceWei: this.#linkState.subscriptionBalanceWei,
      ethPerLinkWei: this.#linkState.ethPerLinkWei,
      mintPriceWei: this.#linkState.mintPriceWei,
    });
    const inputLabel = amount == null
      ? '— LINK'
      : _compactAmountLabel(_tokenInput(amount), 'LINK');
    const rewardLabel = quote == null
      ? '— FLIP'
      : _compactAmountLabel(_tokenInput(quote.flipWei), 'FLIP');
    multiplierNode.textContent = formatLinkDonationMultiplier(currentMultiplierWei);
    inputNode.textContent = inputLabel;
    rewardNode.textContent = rewardLabel;
    container.dataset.state = this.#linkState == null
      ? 'loading'
      : pricingReady ? 'ready' : 'unavailable';
    container.setAttribute('aria-label', quote
      ? `Current LINK reward multiplier ${multiplierNode.textContent}. Donating ${inputLabel} is estimated to earn ${rewardLabel}.`
      : pricingReady
        ? `Current LINK reward multiplier ${multiplierNode.textContent}. Enter a valid LINK amount for a FLIP quote.`
        : this.#linkState == null
          ? 'Loading the current LINK reward quote.'
          : 'The current LINK reward quote is unavailable.');
  }

  async #run(kind) {
    if (this.#busy || !this.#address) return;
    const input = this.querySelector(`[name="pfd-${kind}"]`);
    const amount = kind === 'eth' ? _parseEthInput(input?.value) : _parseTokenInput(input?.value);
    const balance = kind === 'eth'
      ? this.#ethWei
      : kind === 'flip' ? this.#flipWei : this.#linkState?.balanceWei;
    if (amount == null || amount <= 0n || balance == null || amount > balance) return;
    this.#busy = kind;
    this.#setError('');
    this.#renderButtons();
    try {
      if (kind === 'eth') await claimEthAmount({ player: this.#address, amount });
      else if (kind === 'flip') await claimFlip({ player: this.#address, amount });
      else await donateLink({ amount });
      await this.#refresh({ seed: true });
    } catch (error) {
      this.#setError(compactUiError(error, `${kind === 'link' ? 'Donation' : 'Claim'} did not go through.`));
    } finally {
      this.#busy = null;
      this.#renderButtons();
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-player-funds-dialog')) {
  customElements.define('app-player-funds-dialog', AppPlayerFundsDialog);
}

export {
  _compactAmountLabel as formatCompactFundsLabel,
  _ethInput as formatClaimEthInput,
  _parseEthInput as parseClaimEthInput,
};
