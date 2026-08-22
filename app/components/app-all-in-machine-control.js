// Cabinet-mounted ALL IN control. The purchase desk remains the transaction
// owner; this component only mirrors its earned eligibility and delegates the
// click to the existing, fully guarded controller button.

import { get, subscribe } from '../app/store.js';
import {
  readAllInButtonPreference,
  subscribeUiPreferences,
} from '../app/ui-preferences.js';

export function allInMachineControlActive({ eligible = false, preferred = true } = {}) {
  return eligible === true && preferred === true;
}

class AppAllInMachineControl extends HTMLElement {
  #unsubs = [];
  #controllerObserver = null;
  #active = false;
  #opening = false;

  connectedCallback() {
    if (this.hasAttribute('data-mounted')) return;
    this.setAttribute('data-mounted', '');
    this.innerHTML = `
      <span class="jackpot-all-in-socket" data-bind="all-in-machine-socket"
            role="img" aria-label="Empty ALL IN socket">
        <span class="jackpot-all-in-socket__port" aria-hidden="true">
          <span class="jackpot-all-in-socket__pins">
            <span class="jackpot-all-in-socket__pin"></span>
            <span class="jackpot-all-in-socket__pin"></span>
            <span class="jackpot-all-in-socket__pin"></span>
            <span class="jackpot-all-in-socket__pin"></span>
          </span>
        </span>
      </span>
      <button type="button" class="jackpot-all-in-button"
              data-bind="all-in-machine-button" aria-label="Open ALL IN choices"
              title="Choose a currency and where to go all in" hidden disabled>
        <img src="/app/assets/jackpot/all-in-button-v1.webp?v=physical-1" width="256" height="256"
             alt="" aria-hidden="true" decoding="async">
      </button>
    `;

    this.querySelector('[data-bind="all-in-machine-button"]')
      ?.addEventListener('click', () => { void this.#activate(); });
    this.#unsubs.push(
      subscribe('ui.allInEligible', () => this.#render()),
      subscribeUiPreferences(({ name }) => {
        if (name === 'allInButton') this.#render();
      }),
    );
    this.#render();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs) {
      try { unsubscribe(); } catch (_error) { /* one teardown cannot block another */ }
    }
    this.#unsubs = [];
    this.#controllerObserver?.disconnect?.();
    this.#controllerObserver = null;
    this.removeAttribute('data-mounted');
  }

  #controller() {
    if (typeof document === 'undefined') return null;
    return document.querySelector?.('app-decimator-panel [data-bind="dec-all-in"]') || null;
  }

  #render() {
    const scoreEligible = get('ui.allInEligible') === true;
    this.#active = allInMachineControlActive({
      eligible: scoreEligible,
      preferred: readAllInButtonPreference(),
    });

    const socket = this.querySelector('[data-bind="all-in-machine-socket"]');
    const button = this.querySelector('[data-bind="all-in-machine-button"]');
    if (!socket || !button) return;

    socket.hidden = this.#active;
    button.hidden = !this.#active;
    socket.setAttribute(
      'aria-label',
      scoreEligible
        ? 'Empty ALL IN socket; button hidden in settings'
        : 'Empty ALL IN socket; unlocks above 60 Degen Rating',
    );
    this.toggleAttribute('data-active', this.#active);
    this.#observeController();
    this.#syncControllerState();
  }

  #observeController() {
    this.#controllerObserver?.disconnect?.();
    this.#controllerObserver = null;
    const controller = this.#controller();
    if (!controller || typeof MutationObserver !== 'function') return;
    this.#controllerObserver = new MutationObserver(() => this.#syncControllerState());
    this.#controllerObserver.observe(controller, {
      attributes: true,
      attributeFilter: ['class', 'disabled', 'hidden'],
    });
  }

  #syncControllerState() {
    const button = this.querySelector('[data-bind="all-in-machine-button"]');
    if (!button) return;
    const controller = this.#controller();
    button.disabled = !this.#active || !controller || controller.disabled === true;
    button.classList.toggle(
      'is-cued',
      Boolean(controller?.classList?.contains?.('dec-all-in--do-it')),
    );
  }

  async #activate() {
    if (!this.#active || this.#opening) return;
    const controller = this.#controller();
    if (!controller || controller.hidden || controller.disabled) {
      this.#syncControllerState();
      return;
    }

    this.#opening = true;
    try {
      // The chooser is normally an idle-loaded module. A first interaction can
      // beat that idle import, so make its document listener ready before the
      // purchase desk dispatches app-all-in:open.
      await import('./app-all-in-dialog.js');
      if (!this.#active) return;
      const readyController = this.#controller();
      if (!readyController || readyController.hidden || readyController.disabled) {
        this.#syncControllerState();
        return;
      }
      readyController.click?.();
    } finally {
      this.#opening = false;
      this.#syncControllerState();
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-all-in-machine-control')) {
  customElements.define('app-all-in-machine-control', AppAllInMachineControl);
}

export { AppAllInMachineControl };
