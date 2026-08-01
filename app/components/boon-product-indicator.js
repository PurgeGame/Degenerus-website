// Small, self-updating marker mounted beside the control an active boon affects.

import { get, subscribe } from '../app/store.js';
import { boonIndicatorModel } from '../app/boons.js';

class BoonProductIndicator extends HTMLElement {
  static get observedAttributes() { return ['product']; }

  #unsub = null;

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
  }

  attributeChangedCallback() {
    this.#render();
  }

  #render() {
    const product = this.getAttribute?.('product') || '';
    const model = boonIndicatorModel(get('app.boons'), product);
    this.hidden = !model;
    if (!model) {
      this.textContent = '';
      this.removeAttribute?.('title');
      this.removeAttribute?.('aria-label');
      this.removeAttribute?.('data-boon-type');
      return;
    }
    this.textContent = model.label;
    this.title = model.title;
    this.setAttribute?.('aria-label', model.title);
    this.setAttribute?.('data-boon-type', String(model.boonType));
    this.setAttribute?.('tabindex', '0');
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('boon-product-indicator')) {
    customElements.define('boon-product-indicator', BoonProductIndicator);
  }
}

export { BoonProductIndicator };
