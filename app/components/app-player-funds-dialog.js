// One mounted host for Protocol Coins actions. Dedicated entry points can open
// ETH, FLIP, or LINK directly; the coinflip CASH OUT entry shows ETH and FLIP
// together without routing either action through Pending or a second popup.

import { formatEther, parseEther } from 'ethers';
import { ETH_DIVISOR } from '../app/chain-config.js';
import { claimEthAmount, claimFlip, readClaimableEth } from '../app/claims.js';
import { readClaimableCoinflip } from '../app/coinflip.js';
import { donateLink, readLinkDonationState } from '../app/link-donation.js';
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

function _wholeTokenLabel(raw, unit) {
  const value = BigInt(raw || 0);
  const whole = value / (10n ** 18n);
  const fraction = String(value % (10n ** 18n)).padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} ${unit}`;
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
            <img src="/whitepaper/flame-logo-split.svg" alt="" aria-hidden="true">
            <span><small data-bind="pfd-kicker">PROTOCOL FUNDS</small><h2 id="pfd-title" data-bind="pfd-title">Claim FLIP</h2></span>
          </header>
          <div class="pfd-section" data-bind="pfd-eth-section" hidden>
            <article class="pfd-balance pfd-balance--eth">
              <header><span>CLAIMABLE ETH</span><strong data-bind="pfd-eth-balance">—</strong></header>
              <div class="pfd-input-row">
                <input type="text" inputmode="decimal" name="pfd-eth" value="0" aria-label="ETH amount to claim">
                <button type="button" data-bind="pfd-eth-max">MAX</button>
                <button type="button" data-write data-bind="pfd-eth-claim">CLAIM ETH</button>
              </div>
            </article>
            <p class="pfd-note">ETH cashouts use the normal activity-curse rules.</p>
          </div>
          <div class="pfd-section" data-bind="pfd-flip-section">
            <article class="pfd-balance pfd-balance--flip">
              <header><span>CLAIMABLE FLIP</span><strong data-bind="pfd-flip-balance">—</strong></header>
              <div class="pfd-input-row">
                <input type="text" inputmode="decimal" name="pfd-flip" value="0" aria-label="FLIP amount to claim">
                <button type="button" data-bind="pfd-flip-max">MAX</button>
                <button type="button" data-write data-bind="pfd-flip-claim">CLAIM FLIP</button>
              </div>
            </article>
            <p class="pfd-note">Moves settled coinflip winnings into your wallet.</p>
          </div>
          <div class="pfd-section pfd-link" data-bind="pfd-link-section" hidden>
            <div class="pfd-link__stats">
              <span><small>WALLET</small><strong data-bind="pfd-link-balance">—</strong></span>
              <span><small>RNG CREDIT</small><strong data-bind="pfd-link-credit">—</strong></span>
            </div>
            <p>Donated LINK goes straight to the Chainlink subscription and gives you equal mid-day RNG credit.</p>
            <div class="pfd-input-row">
              <input type="text" inputmode="decimal" name="pfd-link" value="0" aria-label="LINK amount to donate">
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
      cashout: ['PROTOCOL FUNDS', 'Cash out'],
      eth: ['ETH CASHOUT', 'Claim ETH'],
      flip: ['COINFLIP FUNDS', 'Claim FLIP'],
      link: ['CHAINLINK RNG', 'Fund RNG'],
    };
    const [kicker, title] = titles[this.#mode] || titles.flip;
    const kickerNode = this.querySelector('[data-bind="pfd-kicker"]');
    const titleNode = this.querySelector('[data-bind="pfd-title"]');
    if (kickerNode) kickerNode.textContent = kicker;
    if (titleNode) titleNode.textContent = title;
    const ethLabel = this.querySelector('[data-bind="pfd-eth-balance"]');
    const flipLabel = this.querySelector('[data-bind="pfd-flip-balance"]');
    const linkBalance = this.querySelector('[data-bind="pfd-link-balance"]');
    const linkCredit = this.querySelector('[data-bind="pfd-link-credit"]');
    if (ethLabel) ethLabel.textContent = this.#ethWei == null ? '—' : `${_ethInput(this.#ethWei)} ETH`;
    if (flipLabel) flipLabel.textContent = this.#flipWei == null ? '—' : _wholeTokenLabel(this.#flipWei, 'FLIP');
    if (linkBalance) linkBalance.textContent = this.#linkState == null ? '—' : _wholeTokenLabel(this.#linkState.balanceWei, 'LINK');
    if (linkCredit) linkCredit.textContent = this.#linkState == null ? '—' : _wholeTokenLabel(this.#linkState.creditWei, 'LINK');
    this.#renderButtons();
  }

  #renderButtons() {
    const connected = Boolean(this.#address);
    const ethAmount = _parseEthInput(this.querySelector('[name="pfd-eth"]')?.value);
    const flipAmount = _parseTokenInput(this.querySelector('[name="pfd-flip"]')?.value);
    const linkAmount = _parseTokenInput(this.querySelector('[name="pfd-link"]')?.value);
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

export { _ethInput as formatClaimEthInput, _parseEthInput as parseClaimEthInput };
