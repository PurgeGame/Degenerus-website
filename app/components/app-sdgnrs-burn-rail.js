// Compact sDGNRS / DGNRS utility rail below AFKING PASSES.
//
// Both tokens are one-for-one claims on the same sDGNRS backing, so the rail
// previews their combined balance with one previewBurnValue read. The actual
// burn and charity ballot remain owned by app-daily-flip; this component only
// requests those existing dialogs so there is one transaction implementation.

import { fetchJSON } from '../app/api.js';
import { registerComponentPoll } from '../app/component-poll.js';
import { TX_CONFIRMED_EVENT } from '../app/contracts.js';
import { displayEth } from '../app/scaling.js';
import {
  formatSdgnrsRedemptionAmount,
  previewSdgnrsBurn,
  SDGNRS_BURN_DIALOG_REQUEST_EVENT,
  SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT,
} from '../app/sdgnrs.js';
import {
  get,
  getViewedAddress,
  subscribe,
} from '../app/store.js';

const TOKEN_WEI = 10n ** 18n;
const POLL_MS = 30_000;

function _wei(value) {
  try {
    const parsed = BigInt(value ?? 0);
    return parsed > 0n ? parsed : 0n;
  } catch (_e) {
    return 0n;
  }
}

function _address(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

/** Format a decimal string with at most two significant figures. */
export function formatBurnRailSignificant(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '—';
  if (numeric === 0) return '0';
  return new Intl.NumberFormat('en-US', {
    useGrouping: false,
    maximumSignificantDigits: 2,
  }).format(numeric);
}

/** Format the contract's wei-valued ETH/stETH expectation for the rail. */
export function formatBurnRailEth(value) {
  return formatBurnRailSignificant(displayEth(_wei(value), 12));
}

/** Pure balance extraction shared by render code and tests. */
export function burnRailBalances(payload) {
  if (!payload || typeof payload !== 'object') {
    return { sdgnrs: 0n, dgnrs: 0n, total: 0n, known: false };
  }
  const sdgnrs = _wei(payload.sdgnrsBalance);
  const dgnrs = _wei(payload.dgnrsBalance);
  return { sdgnrs, dgnrs, total: sdgnrs + dgnrs, known: true };
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

export class AppSdgnrsBurnRail extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #poll = null;
  #txListener = null;
  #refreshQueued = false;
  #fetchSeq = 0;
  #quoteSeq = 0;
  #address = null;
  #payload = null;
  #quote = null;
  #quoteAmount = null;
  #quotePending = false;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireActions();

    for (const key of ['connected.address', 'viewing.address', 'ui.mode', 'ui.chainOk']) {
      this.#unsubs.push(subscribe(key, () => this.#onScopeChange()));
    }
    this.#unsubs.push(subscribe('app.playerCombined', (payload) => {
      if (get('ui.mode') !== 'combined') return;
      this.#payload = payload;
      this.#address = null;
      this.#render();
      this.#refreshQuote();
    }));

    this.#poll = registerComponentPoll(() => this.#queueRefresh(), POLL_MS);
    if (typeof document !== 'undefined') {
      this.#txListener = () => this.#queueRefresh();
      document.addEventListener?.(TX_CONFIRMED_EVENT, this.#txListener);
    }
    this.#onScopeChange();
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
    this.#fetchSeq += 1;
    this.#quoteSeq += 1;
    this.#initialized = false;
  }

  #renderShell() {
    this.innerHTML = `
      <section class="sdgnrs-rail" data-bind="sdr-shell"
               aria-label="sDGNRS and DGNRS balances with combined expected burn value">
        <span class="sdgnrs-rail__logo" role="img" aria-label="sDGNRS">
          <img class="sdgnrs-rail__logo-frame"
               src="/badges-circular/crypto_06_ethereum_purple.svg" alt="">
          <img class="sdgnrs-rail__logo-mark"
               src="/specials/special_eth.svg" alt="">
        </span>

        <span class="sdgnrs-rail__metric sdgnrs-rail__metric--balances">
          <small>BALANCES</small>
          <strong class="sdgnrs-rail__balances">
            <span class="sdgnrs-rail__token">
              <b data-bind="sdr-sdgnrs">—</b><em>sDGNRS</em>
            </span>
            <i data-bind="sdr-dgnrs-divider" hidden aria-hidden="true">·</i>
            <span class="sdgnrs-rail__token sdgnrs-rail__token--dgnrs"
                  data-bind="sdr-dgnrs-wrap" hidden>
              <b data-bind="sdr-dgnrs">—</b><em>DGNRS</em>
            </span>
          </strong>
        </span>

        <span class="sdgnrs-rail__metric sdgnrs-rail__metric--value">
          <small>EXPECTED BURN VALUE</small>
          <strong class="sdgnrs-rail__value">
            <b data-bind="sdr-eth">—</b>
            <i data-bind="sdr-plus" hidden aria-hidden="true">+</i>
            <b class="sdgnrs-rail__flip" data-bind="sdr-flip" hidden
               title="FLIP backing pays only if the resolving coinflip wins"></b>
          </strong>
        </span>

        <span class="sdgnrs-rail__actions">
          <button type="button" class="sdgnrs-rail__vote" data-bind="sdr-vote"
                  aria-haspopup="dialog" title="Open charity vote">
            <span aria-hidden="true">♥</span><b>VOTE</b>
          </button>
          <button type="button" class="sdgnrs-rail__burn" data-bind="sdr-burn"
                  data-write data-write-locked data-write-lock-title="Balance is loading"
                  aria-haspopup="dialog">
            <span class="sdgnrs-rail__burn-emblem" aria-hidden="true">
              <img src="/app/assets/jackpot/flame-center-silver.svg" alt="">
            </span>
            <b>BURN</b>
          </button>
        </span>
      </section>
    `;
  }

  #wireActions() {
    const burn = this.querySelector('[data-bind="sdr-burn"]');
    burn?.addEventListener('click', () => {
      const balances = burnRailBalances(this.#payload);
      const preferredAsset = balances.sdgnrs >= TOKEN_WEI ? 'sdgnrs' : 'dgnrs';
      this.#requestDialog(SDGNRS_BURN_DIALOG_REQUEST_EVENT, burn, { preferredAsset });
    });
    const vote = this.querySelector('[data-bind="sdr-vote"]');
    vote?.addEventListener('click', () => {
      this.#requestDialog(SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT, vote);
    });
  }

  #requestDialog(type, trigger, extra = {}) {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
    document.dispatchEvent(new CustomEvent(type, {
      detail: { trigger, ...extra },
    }));
  }

  #onScopeChange() {
    const combined = get('ui.mode') === 'combined';
    const nextAddress = combined ? null : _address(getViewedAddress());
    const scopeChanged = nextAddress !== this.#address;
    if (scopeChanged || combined) {
      this.#fetchSeq += 1;
      this.#quoteSeq += 1;
      this.#address = nextAddress;
      this.#payload = combined ? get('app.playerCombined') : null;
      this.#quote = null;
      this.#quoteAmount = null;
      this.#quotePending = false;
    }
    this.#render();
    if (combined) this.#refreshQuote();
    else this.#queueRefresh();
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
    if (get('ui.mode') === 'combined') {
      this.#payload = get('app.playerCombined');
      this.#address = null;
      this.#render();
      this.#refreshQuote();
      return;
    }
    const target = _address(getViewedAddress());
    if (target !== this.#address) {
      this.#address = target;
      this.#payload = null;
      this.#quote = null;
      this.#quoteAmount = null;
      this.#quoteSeq += 1;
      this.#render();
    }
    if (!target) return;
    const seq = ++this.#fetchSeq;
    try {
      const payload = await fetchJSON(`/player/${target}`);
      if (!this.#initialized || seq !== this.#fetchSeq
        || get('ui.mode') === 'combined' || target !== this.#address) return;
      this.#payload = payload;
      this.#render();
      this.#refreshQuote();
    } catch (_e) {
      if (seq === this.#fetchSeq && !this.#payload) this.#render();
    }
  }

  #refreshQuote() {
    const balances = burnRailBalances(this.#payload);
    const amount = balances.total;
    if (!balances.known || amount <= 0n) {
      this.#quoteSeq += 1;
      this.#quote = null;
      this.#quoteAmount = amount;
      this.#quotePending = false;
      this.#render();
      return;
    }
    if (this.#quoteAmount === amount && (this.#quote || this.#quotePending)) return;
    const seq = ++this.#quoteSeq;
    this.#quote = null;
    this.#quoteAmount = amount;
    this.#quotePending = true;
    this.#render();
    void previewSdgnrsBurn({ amount, publicRead: true }).then((quote) => {
      if (!this.#initialized || seq !== this.#quoteSeq || amount !== this.#quoteAmount) return;
      this.#quote = quote;
      this.#quotePending = false;
      this.#render();
    }, () => {
      if (!this.#initialized || seq !== this.#quoteSeq || amount !== this.#quoteAmount) return;
      this.#quote = null;
      this.#quotePending = false;
      this.#render();
    });
  }

  #ownsDisplayedBalances() {
    const connected = _address(get('connected.address'));
    return get('ui.mode') === 'self' && Boolean(connected && this.#address)
      && connected === this.#address;
  }

  #render() {
    const shell = this.querySelector('[data-bind="sdr-shell"]');
    if (!shell) return;
    const balances = burnRailBalances(this.#payload);
    const sdgnrs = this.querySelector('[data-bind="sdr-sdgnrs"]');
    const dgnrs = this.querySelector('[data-bind="sdr-dgnrs"]');
    const dgnrsWrap = this.querySelector('[data-bind="sdr-dgnrs-wrap"]');
    const divider = this.querySelector('[data-bind="sdr-dgnrs-divider"]');
    const eth = this.querySelector('[data-bind="sdr-eth"]');
    const flip = this.querySelector('[data-bind="sdr-flip"]');
    const plus = this.querySelector('[data-bind="sdr-plus"]');

    if (sdgnrs) {
      sdgnrs.textContent = balances.known
        ? formatSdgnrsRedemptionAmount(balances.sdgnrs)
        : '—';
    }
    const showDgnrs = balances.known && balances.dgnrs > 0n;
    if (dgnrs) dgnrs.textContent = formatSdgnrsRedemptionAmount(balances.dgnrs);
    if (dgnrsWrap) dgnrsWrap.hidden = !showDgnrs;
    if (divider) divider.hidden = !showDgnrs;

    const hasQuote = Boolean(this.#quote);
    const showFlip = hasQuote && _wei(this.#quote.flipOut) > 0n;
    if (eth) {
      eth.textContent = this.#quotePending
        ? '…'
        : hasQuote ? `≈${formatBurnRailEth(this.#quote.ethOut)} ETH` : '—';
    }
    if (flip) {
      flip.hidden = !showFlip;
      flip.textContent = showFlip
        ? `${formatSdgnrsRedemptionAmount(this.#quote.flipOut)} FLIP`
        : '';
      if (showFlip) {
        flip.setAttribute(
          'aria-label',
          `${formatSdgnrsRedemptionAmount(this.#quote.flipOut)} FLIP backing if the resolving coinflip wins`,
        );
      }
    }
    if (plus) plus.hidden = !showFlip;

    shell.classList?.toggle('is-loading', !balances.known || this.#quotePending);
    shell.classList?.toggle('is-readonly', get('ui.mode') !== 'self');
    const burn = this.querySelector('[data-bind="sdr-burn"]');
    const hasMinimum = balances.sdgnrs >= TOKEN_WEI || balances.dgnrs >= TOKEN_WEI;
    const owns = this.#ownsDisplayedBalances();
    const locked = !balances.known || !owns || !hasMinimum || get('ui.chainOk') === false;
    const reason = !balances.known
      ? 'Balance is loading'
      : !owns
        ? 'Open your own wallet view to burn DGNRS'
        : !hasMinimum
          ? 'Minimum burn is 1 sDGNRS or DGNRS'
          : 'Switch to the supported network to burn';
    _setWriteLock(burn, locked, reason);
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-sdgnrs-burn-rail')) {
    customElements.define('app-sdgnrs-burn-rail', AppSdgnrsBurnRail);
  }
}
