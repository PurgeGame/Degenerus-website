// Icon-only marker mounted beside a control that advances an unfinished quest.

import { get, subscribe } from '../app/store.js';
import { questObjectiveIndicatorModel } from '../app/quest-objectives.js';

class QuestObjectiveIndicator extends HTMLElement {
  static get observedAttributes() { return ['product']; }

  #unsub = null;

  connectedCallback() {
    this.classList?.add('quest-objective-indicator');
    this.addEventListener?.('click', this.#activate);
    this.addEventListener?.('keydown', this.#onKeydown);
    if (!this.#unsub) {
      this.#unsub = subscribe('ui.questObjectives', () => this.#render());
    }
    this.#render();
  }

  disconnectedCallback() {
    this.removeEventListener?.('click', this.#activate);
    this.removeEventListener?.('keydown', this.#onKeydown);
    try { this.#unsub?.(); } catch (_e) { /* defensive */ }
    this.#unsub = null;
  }

  attributeChangedCallback() {
    this.#render();
  }

  #onKeydown = (event) => {
    if (event?.key !== 'Enter' && event?.key !== ' ') return;
    this.#activate(event);
  };

  #activate = (event) => {
    const product = this.getAttribute?.('product') || '';
    const model = questObjectiveIndicatorModel(get('ui.questObjectives'), product);
    if (!model || typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
    try { event?.preventDefault?.(); } catch (_e) { /* cross-realm event */ }
    try { event?.stopPropagation?.(); } catch (_e) { /* cross-realm event */ }
    const detail = {
      product,
      trigger: this,
      quests: model.quests.map((quest) => ({
        questType: Number(quest?.questType ?? 0),
        role: String(quest?.role || '').toUpperCase(),
      })),
    };
    try {
      let activation;
      if (typeof CustomEvent === 'function') {
        activation = new CustomEvent('quest:open', { detail });
      } else {
        activation = new Event('quest:open');
        Object.defineProperty(activation, 'detail', { configurable: true, value: detail });
      }
      document.dispatchEvent(activation);
    } catch (_e) { /* detached/headless document */ }
  };

  #render() {
    const product = this.getAttribute?.('product') || '';
    const model = questObjectiveIndicatorModel(get('ui.questObjectives'), product);
    this.hidden = !model;
    this.textContent = '';
    if (!model) {
      this.removeAttribute?.('title');
      this.removeAttribute?.('aria-label');
      this.removeAttribute?.('data-quest-product');
      this.removeAttribute?.('data-quest-count');
      this.removeAttribute?.('tabindex');
      this.removeAttribute?.('role');
      return;
    }
    this.title = `${model.title} · Click to complete`;
    this.setAttribute?.('aria-label', `${model.title}. Click to complete.`);
    this.setAttribute?.('role', 'button');
    this.setAttribute?.('data-quest-product', product);
    this.setAttribute?.('data-quest-count', String(model.count));
    const nestedInButton = String(this.parentElement?.tagName || '').toUpperCase() === 'BUTTON';
    this.setAttribute?.('tabindex', nestedInButton ? '-1' : '0');
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('quest-objective-indicator')) {
    customElements.define('quest-objective-indicator', QuestObjectiveIndicator);
  }
}

export { QuestObjectiveIndicator };
