// WWXRP balance + Daily Incinerator burn footer for the Side Bets panel.
//
// The token used to live in the Community Coinflip's Protocol Coins drawer.
// It is still a side wager, however, so this component keeps the familiar
// balance/BURN treatment while owning its reads, account scope, and dialog.

import { readFlipWidgetBalances } from '../app/coinflip.js';
import { TX_CONFIRMED_EVENT } from '../app/contracts.js';
import {
  deriveCanSign,
  get,
  getViewedAddress,
  subscribe,
} from '../app/store.js';
import { burnWwxrp, MIN_WWXRP_BURN_WEI } from '../app/wwxrp.js';
import { compactUiError } from '../app/ui-error.js';
import { registerComponentPoll } from '../app/component-poll.js';

const TOKEN_WEI = 10n ** 18n;
const POLL_MS = 30_000;

let _readBalances = readFlipWidgetBalances;
let _burn = burnWwxrp;

function _address(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

/** Parse a decimal WWXRP input without crossing through floating point. */
export function parseWwxrpAmount(value) {
  const match = /^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const fraction = String(match[2] || '').padEnd(18, '0');
  try {
    return (BigInt(match[1]) * TOKEN_WEI) + BigInt(fraction || '0');
  } catch (_e) {
    return null;
  }
}

function _amountInput(value) {
  let raw;
  try { raw = BigInt(value ?? 0); } catch (_e) { raw = 0n; }
  if (raw < 0n) raw = 0n;
  const whole = raw / TOKEN_WEI;
  const fraction = String(raw % TOKEN_WEI).padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** Keep the narrow footer readable while retaining three useful figures. */
export function formatWwxrpBalance(value) {
  let raw;
  try { raw = BigInt(value ?? 0); } catch (_e) { return '—'; }
  if (raw < 0n) raw = -raw;
  const whole = raw / TOKEN_WEI;
  if (whole < 1_000n) return whole.toLocaleString('en-US');

  const tiers = [
    [10n ** 15n, 'Q'],
    [10n ** 12n, 'T'],
    [10n ** 9n, 'B'],
    [10n ** 6n, 'M'],
    [10n ** 3n, 'K'],
  ];
  let tierIndex = tiers.findIndex(([scale]) => whole >= scale);
  if (tierIndex < 0) tierIndex = tiers.length - 1;

  for (;;) {
    const [scale, suffix] = tiers[tierIndex];
    const scaledWhole = whole / scale;
    const decimals = scaledWhole >= 100n ? 0 : scaledWhole >= 10n ? 1 : 2;
    const factor = 10n ** BigInt(decimals);
    const rounded = ((whole * factor) + (scale / 2n)) / scale;
    if (rounded >= (1_000n * factor) && tierIndex > 0) {
      tierIndex -= 1;
      continue;
    }
    const integer = rounded / factor;
    const fraction = decimals === 0
      ? ''
      : String(rounded % factor).padStart(decimals, '0').replace(/0+$/, '');
    return `${integer.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}${suffix}`;
  }
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

class AppWwxrpBurn extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #poll = null;
  #txListener = null;
  #refreshQueued = false;
  #seq = 0;
  #address = null;
  #balance = null;
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
    this.#poll = registerComponentPoll(() => this.#queueRefresh(), POLL_MS);
    if (typeof document !== 'undefined') {
      this.#txListener = () => this.#queueRefresh();
      document.addEventListener?.(TX_CONFIRMED_EVENT, this.#txListener);
    }
    this.#onIdentityChange();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs) {
      try { unsubscribe(); } catch (_e) { /* defensive */ }
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
    this.hidden = true;
    this.innerHTML = `
      <section class="pari-wwxrp" data-bind="wwxrp-shell"
               aria-label="WWXRP balance and Daily Incinerator entry">
        <span class="pari-wwxrp__mark" aria-hidden="true">
          <img src="/shared/coinflip-face-red.svg" alt="">
        </span>
        <span class="pari-wwxrp__identity">
          <small>DAILY INCINERATOR</small>
          <strong>WWXRP</strong>
        </span>
        <strong class="pari-wwxrp__balance" data-bind="wwxrp-balance-wrap">
          <span data-bind="wwxrp-balance">—</span>
        </strong>
        <button type="button" class="pari-wwxrp__burn" data-write data-write-locked
                data-write-lock-title="WWXRP balance is loading"
                data-bind="wwxrp-open" aria-haspopup="dialog">INCINERATE</button>
        <p class="pari-wwxrp__feedback" data-bind="wwxrp-feedback"
           hidden role="status"></p>
      </section>

      <div class="df-reverse-dialog df-burn-dialog df-wwxrp-dialog"
           data-bind="wwxrp-dialog" hidden tabindex="-1"
           role="dialog" aria-modal="true" aria-labelledby="pari-wwxrp-title">
        <div class="df-reverse-dialog__card df-burn-dialog__card">
          <button type="button" class="df-reverse-dialog__close"
                  data-bind="wwxrp-cancel" aria-label="Close WWXRP incinerator">×</button>
          <h3 id="pari-wwxrp-title">Incinerate WWXRP</h3>
          <p class="df-reverse-dialog__copy">
            <span>Incinerate WWXRP for a weighted entry in today’s Daily Incinerator.</span>
            <span>The minimum is 25 WWXRP and burned tokens cannot be recovered.</span>
          </p>
          <label class="df-burn-dialog__amount">
            <span>Amount</span>
            <span class="df-burn-dialog__field">
              <input type="text" data-bind="wwxrp-amount" inputmode="decimal"
                     aria-label="WWXRP to burn">
              <button type="button" data-bind="wwxrp-max">MAX</button>
            </span>
          </label>
          <p class="pari-wwxrp__dialog-status" data-bind="wwxrp-dialog-status"
             hidden role="alert"></p>
          <div class="df-reverse-dialog__actions">
            <button type="button" class="df-reverse-dialog__later"
                    data-bind="wwxrp-cancel">Cancel</button>
            <button type="button" class="df-reverse-dialog__accept df-burn-dialog__accept"
                    data-write data-write-locked
                    data-write-lock-title="Enter at least 25 WWXRP"
                    data-bind="wwxrp-accept">Incinerate</button>
          </div>
        </div>
      </div>
    `;
    const input = this.querySelector('[data-bind="wwxrp-amount"]');
    if (input) input.value = '25';
  }

  #wire() {
    this.querySelector('[data-bind="wwxrp-open"]')
      ?.addEventListener('click', () => this.#openDialog());
    this.querySelector('[data-bind="wwxrp-max"]')
      ?.addEventListener('click', () => this.#setMax());
    this.querySelector('[data-bind="wwxrp-accept"]')
      ?.addEventListener('click', () => { void this.#submit(); });
    const input = this.querySelector('[data-bind="wwxrp-amount"]');
    input?.addEventListener('input', () => this.#render());
    input?.addEventListener('keydown', (event) => {
      if (event?.key === 'Enter') void this.#submit();
    });
    for (const cancel of this.querySelectorAll('[data-bind="wwxrp-cancel"]')) {
      cancel.addEventListener('click', () => this.#closeDialog());
    }
    const dialog = this.querySelector('[data-bind="wwxrp-dialog"]');
    dialog?.addEventListener('keydown', (event) => {
      if (event?.key === 'Escape') this.#closeDialog();
    });
    dialog?.addEventListener('click', (event) => {
      if (event?.target === dialog) this.#closeDialog();
    });
  }

  #onIdentityChange() {
    const next = _address(getViewedAddress());
    if (next !== this.#address) {
      this.#seq += 1;
      this.#address = next;
      this.#balance = null;
      this.#setFeedback('');
      this.#closeDialog({ restoreFocus: false });
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
      this.#balance = null;
      this.#seq += 1;
      this.#render();
    }
    if (!target) return;
    const seq = ++this.#seq;
    let snapshot;
    try { snapshot = await _readBalances({ player: target }); }
    catch (_e) { return; }
    if (seq !== this.#seq || target !== this.#address) return;
    if (snapshot?.wwxrpBalance != null) {
      try { this.#balance = BigInt(snapshot.wwxrpBalance); }
      catch (_e) { this.#balance = null; }
    } else {
      this.#balance = null;
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
    if (!this.#canWrite()) return 'Open your own wallet view to incinerate WWXRP';
    if (this.#balance == null) return 'WWXRP balance is loading';
    if (this.#balance < MIN_WWXRP_BURN_WEI) return 'Minimum burn is 25 WWXRP';
    return '';
  }

  #render() {
    this.hidden = !this.#address;
    const shell = this.querySelector('[data-bind="wwxrp-shell"]');
    if (shell) shell.hidden = !this.#address;

    const balance = this.querySelector('[data-bind="wwxrp-balance"]');
    const balanceWrap = this.querySelector('[data-bind="wwxrp-balance-wrap"]');
    if (balance) balance.textContent = this.#balance == null
      ? '—'
      : formatWwxrpBalance(this.#balance);
    if (balanceWrap) {
      const exact = this.#balance == null ? '' : `${_amountInput(this.#balance)} WWXRP`;
      balanceWrap.title = exact;
      if (exact) balanceWrap.setAttribute('aria-label', `WWXRP balance: ${exact}`);
      else balanceWrap.removeAttribute('aria-label');
    }

    const open = this.querySelector('[data-bind="wwxrp-open"]');
    const lockReason = this.#lockReason();
    if (open) open.textContent = this.#busy ? 'WAIT' : 'INCINERATE';
    _setWriteLock(open, Boolean(lockReason), lockReason);

    const input = this.querySelector('[data-bind="wwxrp-amount"]');
    const amount = parseWwxrpAmount(input?.value);
    const valid = amount != null
      && amount >= MIN_WWXRP_BURN_WEI
      && this.#balance != null
      && amount <= this.#balance;
    if (input) {
      if (input.value && !valid) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      input.disabled = this.#busy;
    }
    const accept = this.querySelector('[data-bind="wwxrp-accept"]');
    if (accept) accept.textContent = this.#busy ? 'Incinerating…' : 'Incinerate';
    _setWriteLock(
      accept,
      this.#busy || !this.#canWrite() || !valid,
      this.#busy ? 'Transaction in progress' : 'Enter an amount from 25 through your WWXRP balance',
    );
    const max = this.querySelector('[data-bind="wwxrp-max"]');
    if (max) max.disabled = this.#busy || this.#balance == null;
  }

  #openDialog() {
    if (this.#lockReason()) return;
    const dialog = this.querySelector('[data-bind="wwxrp-dialog"]');
    const input = this.querySelector('[data-bind="wwxrp-amount"]');
    if (!dialog || !input) return;
    const amount = parseWwxrpAmount(input.value);
    if (amount == null || amount < MIN_WWXRP_BURN_WEI || amount > this.#balance) {
      input.value = '25';
    }
    this.#setFeedback('');
    dialog.hidden = false;
    this.#render();
    try { input.focus?.({ preventScroll: true }); } catch (_e) { /* headless */ }
  }

  #closeDialog({ restoreFocus = true } = {}) {
    const dialog = this.querySelector('[data-bind="wwxrp-dialog"]');
    if (dialog) dialog.hidden = true;
    if (!restoreFocus) return;
    try {
      this.querySelector('[data-bind="wwxrp-open"]')?.focus?.({ preventScroll: true });
    } catch (_e) { /* headless */ }
  }

  #setMax() {
    if (this.#balance == null) return;
    const input = this.querySelector('[data-bind="wwxrp-amount"]');
    if (!input) return;
    input.value = _amountInput(this.#balance);
    this.#render();
  }

  #setFeedback(message, { error = false } = {}) {
    for (const bind of ['wwxrp-feedback', 'wwxrp-dialog-status']) {
      const node = this.querySelector(`[data-bind="${bind}"]`);
      if (!node) continue;
      node.textContent = String(message || '');
      node.hidden = !message;
      if (error) node.setAttribute('data-state', 'error');
      else node.removeAttribute('data-state');
    }
  }

  async #submit() {
    if (this.#busy || !this.#canWrite()) return;
    const input = this.querySelector('[data-bind="wwxrp-amount"]');
    const amount = parseWwxrpAmount(input?.value);
    if (amount == null || amount < MIN_WWXRP_BURN_WEI) {
      this.#setFeedback('Minimum burn is 25 WWXRP.', { error: true });
      return;
    }
    if (this.#balance == null || amount > this.#balance) {
      this.#setFeedback('Not enough WWXRP for that burn.', { error: true });
      return;
    }

    const target = this.#address;
    this.#busy = true;
    this.#setFeedback('');
    this.#render();
    try {
      await _burn({ amount });
      if (target !== this.#address) return;
      if (this.#balance != null) this.#balance -= amount;
      this.#closeDialog();
      this.#setFeedback(`${formatWwxrpBalance(amount)} WWXRP INCINERATED`);
      this.#queueRefresh();
    } catch (error) {
      if (target === this.#address) {
        this.#setFeedback(
          compactUiError(error, 'WWXRP incineration did not go through.'),
          { error: true },
        );
      }
    } finally {
      this.#busy = false;
      this.#render();
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-wwxrp-burn')) {
  customElements.define('app-wwxrp-burn', AppWwxrpBurn);
}

/** Test-only dependency seam. */
export function __setWwxrpBurnWidgetDepsForTest({ balances, burn } = {}) {
  if (typeof balances === 'function') _readBalances = balances;
  if (typeof burn === 'function') _burn = burn;
}

/** Test-only dependency reset. */
export function __resetWwxrpBurnWidgetDepsForTest() {
  _readBalances = readFlipWidgetBalances;
  _burn = burnWwxrp;
}
