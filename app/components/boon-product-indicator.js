// Small, self-updating marker mounted beside the control an active boon affects.

import { get, subscribe } from '../app/store.js';
import { boonIndicatorModel } from '../app/boons.js';

class BoonProductIndicator extends HTMLElement {
  static get observedAttributes() { return ['product', 'variant', 'suppressed']; }

  #unsub = null;
  #decoratedHost = null;
  #hostHadTitle = false;
  #hostTitle = '';

  connectedCallback() {
    this.classList?.add('boon-product-indicator');
    if (!this.#unsub) {
      this.#unsub = subscribe('app.boons', () => this.#render());
    }
    // A boon only changes the value of the NEXT purchase, so this marker
    // appearing beside a buy control is exactly when the answer starts to
    // matter. Announce it rather than importing polling.js: this file is a
    // display marker, and the app has no bundler — a direct import would pull
    // the polling/contracts/ethers stack onto every page that shows a boon.
    // polling.js listens and coalesces, so several markers mounting together
    // cost one request.
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      document.dispatchEvent?.(new CustomEvent('degenerus:boon-surface-open'));
    }
    this.#render();
  }

  disconnectedCallback() {
    try { this.#unsub?.(); } catch (_e) { /* defensive */ }
    this.#unsub = null;
    this.#clearHostDecoration();
  }

  attributeChangedCallback() {
    this.#render();
  }

  #clearHostDecoration() {
    const host = this.#decoratedHost;
    if (!host) return;
    host.classList?.remove('has-active-boon');
    host.removeAttribute?.('data-active-boon-product');
    host.removeAttribute?.('data-active-boon-type');
    host.removeAttribute?.('data-boon-effect');
    host.removeAttribute?.('data-boon-strength');
    host.removeAttribute?.('data-boon-tier');
    host.removeAttribute?.('data-boon-pips');
    host.removeAttribute?.('data-boon-direction');
    if (this.#hostHadTitle) host.setAttribute?.('title', this.#hostTitle);
    else host.removeAttribute?.('title');
    this.#decoratedHost = null;
    this.#hostHadTitle = false;
    this.#hostTitle = '';
  }

  #decorateHost(product, model) {
    const selector = [
      '.dec-input-group',
      '.df-add-bet-dialog__card',
      '.df-bet-oval',
      '.df-tomorrow-bet-oval',
      '.df-tomorrow-layout',
      '.pass-product-row',
      '.pass-deity-section',
      '.pari-book',
      '.qst-score-control',
      '.deg-currency-option',
      '.dbb__input',
    ].join(', ');
    const host = this.closest?.(selector) || null;
    if (host !== this.#decoratedHost) {
      this.#clearHostDecoration();
      if (host) {
        this.#decoratedHost = host;
        this.#hostHadTitle = host.getAttribute?.('title') != null;
        this.#hostTitle = host.getAttribute?.('title') || '';
      }
    }
    if (!host) return;
    const effect = String(model.label || '').replace(/^BOON\s*/i, '');
    host.classList?.add('has-active-boon');
    host.setAttribute?.('data-active-boon-product', product);
    host.setAttribute?.('data-active-boon-type', String(model.boonType));
    host.setAttribute?.('data-boon-effect', effect);
    host.setAttribute?.('data-boon-strength', model.strength);
    host.setAttribute?.('data-boon-tier', String(model.tier));
    host.setAttribute?.('data-boon-pips', model.pips);
    host.setAttribute?.('data-boon-direction', model.direction);
    host.setAttribute?.('title', model.title);
  }

  #render() {
    const product = this.getAttribute?.('product') || '';
    const model = boonIndicatorModel(get('app.boons'), product);
    const suppressed = this.hasAttribute?.('suppressed') ?? this.getAttribute?.('suppressed') != null;
    this.hidden = suppressed || !model;
    if (suppressed || !model) {
      this.#clearHostDecoration();
      this.textContent = '';
      this.removeAttribute?.('title');
      this.removeAttribute?.('aria-label');
      this.removeAttribute?.('data-boon-type');
      this.removeAttribute?.('data-boon-product');
      this.removeAttribute?.('data-boon-effect');
      this.removeAttribute?.('data-boon-strength');
      this.removeAttribute?.('data-boon-tier');
      this.removeAttribute?.('data-boon-pips');
      this.removeAttribute?.('data-boon-direction');
      this.removeAttribute?.('tabindex');
      return;
    }
    const effect = String(model.label || '').replace(/^BOON\s*/i, '');
    // The live indicator is intentionally icon-only. Its exact value and use
    // live in the native hover tooltip and keyboard-accessible aria-label.
    this.textContent = '';
    this.title = model.title;
    this.setAttribute?.('aria-label', model.title);
    this.setAttribute?.('data-boon-type', String(model.boonType));
    this.setAttribute?.('data-boon-product', product);
    this.setAttribute?.('data-boon-effect', effect);
    this.setAttribute?.('data-boon-strength', model.strength);
    this.setAttribute?.('data-boon-tier', String(model.tier));
    this.setAttribute?.('data-boon-pips', model.pips);
    this.setAttribute?.('data-boon-direction', model.direction);
    const parent = this.parentElement;
    const nestedInAction = String(parent?.tagName || '').toUpperCase() === 'BUTTON'
      || parent?.getAttribute?.('role') === 'button'
      || parent?.classList?.contains?.('df-bet-oval')
      || parent?.classList?.contains?.('df-tomorrow-bet-oval');
    this.setAttribute?.('tabindex', nestedInAction ? '-1' : '0');
    this.#decorateHost(product, model);
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('boon-product-indicator')) {
    customElements.define('boon-product-indicator', BoonProductIndicator);
  }
}

export { BoonProductIndicator };
