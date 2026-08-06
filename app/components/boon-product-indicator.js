// Small, self-updating marker mounted beside the control an active boon affects.

import { get, subscribe } from '../app/store.js';
import { boonIndicatorModel } from '../app/boons.js';

class BoonProductIndicator extends HTMLElement {
  static get observedAttributes() { return ['product']; }

  #unsub = null;
  #decoratedHost = null;
  #hostHadTitle = false;
  #hostTitle = '';

  connectedCallback() {
    this.classList?.add('boon-product-indicator');
    if (!this.#unsub) {
      this.#unsub = subscribe('app.boons', () => this.#render());
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
    if (this.#hostHadTitle) host.setAttribute?.('title', this.#hostTitle);
    else host.removeAttribute?.('title');
    this.#decoratedHost = null;
    this.#hostHadTitle = false;
    this.#hostTitle = '';
  }

  #decorateHost(product, model) {
    const selector = [
      '.dec-input-group',
      '.df-next-bet__stepper',
      '.pass-product-row',
      '.pass-deity-section',
      '.pari-book',
      '.qst-score-control',
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
    host.setAttribute?.('title', model.title);
  }

  #render() {
    const product = this.getAttribute?.('product') || '';
    const model = boonIndicatorModel(get('app.boons'), product);
    this.hidden = !model;
    if (!model) {
      this.#clearHostDecoration();
      this.textContent = '';
      this.removeAttribute?.('title');
      this.removeAttribute?.('aria-label');
      this.removeAttribute?.('data-boon-type');
      this.removeAttribute?.('data-boon-product');
      this.removeAttribute?.('data-boon-effect');
      this.removeAttribute?.('tabindex');
      return;
    }
    const effect = String(model.label || '').replace(/^BOON\s*/i, '');
    this.textContent = model.label;
    this.title = model.title;
    this.setAttribute?.('aria-label', model.title);
    this.setAttribute?.('data-boon-type', String(model.boonType));
    this.setAttribute?.('data-boon-product', product);
    this.setAttribute?.('data-boon-effect', effect);
    this.setAttribute?.('tabindex', '0');
    this.#decorateHost(product, model);
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('boon-product-indicator')) {
    customElements.define('boon-product-indicator', BoonProductIndicator);
  }
}

export { BoonProductIndicator };
