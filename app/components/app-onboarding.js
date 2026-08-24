// /app/components/app-onboarding.js — one-time first-visit choice.
//
// A new browser can connect through the app's existing EIP-6963/WalletConnect
// flow or dismiss into the read-only demo. The dismissal is browser-local; no
// wallet address or tracking identifier is persisted.

import { get, subscribe } from '../app/store.js';
import { connectWithPicker } from '../app/wallet.js';
import { lock, unlock } from '../app/scroll-lock.js';

export const ONBOARDING_STORAGE_KEY = 'degenerus:onboarding:v1';
const SHOW_DELAY_MS = 700;

export function hasSeenOnboarding() {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'seen'; }
  catch (_e) { return false; }
}

export function rememberOnboarding() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(ONBOARDING_STORAGE_KEY, 'seen'); }
  catch (_e) { /* private mode: dismissal remains session-only */ }
}

export class AppOnboarding extends HTMLElement {
  #initialized = false;
  #unsub = null;
  #showTimer = null;
  #busy = false;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.hidden = true;
    this.innerHTML = `
      <div class="onb-backdrop" data-bind="onb-dismiss"></div>
      <section class="onb-dialog" role="dialog" aria-modal="true" aria-label="Choose how to enter Degenerus">
        <div class="onb-actions">
          <button type="button" class="onb-connect" data-bind="onb-connect">Connect Wallet</button>
          <button type="button" class="onb-tutorial onb-demo" data-bind="onb-demo">View Demo</button>
        </div>
      </section>
    `;

    for (const button of this.querySelectorAll('[data-bind="onb-dismiss"]')) {
      button.addEventListener('click', () => this.dismiss());
    }
    const connect = this.querySelector('[data-bind="onb-connect"]');
    if (connect) connect.addEventListener('click', () => this.#connect());
    const demo = this.querySelector('[data-bind="onb-demo"]');
    if (demo) demo.addEventListener('click', () => this.dismiss());
    this.addEventListener('keydown', (event) => {
      if (event?.key === 'Escape') this.dismiss();
    });

    this.#unsub = subscribe('connected.address', (address) => {
      if (!address) return;
      // An auto-reconnected or newly connected player does not need a second
      // prompt sitting over their own dashboard.
      rememberOnboarding();
      this.#hide();
    });

    if (!hasSeenOnboarding() && !get('connected.address')) {
      this.#showTimer = setTimeout(() => {
        this.#showTimer = null;
        if (!hasSeenOnboarding() && !get('connected.address')) this.show();
      }, SHOW_DELAY_MS);
    }
  }

  disconnectedCallback() {
    if (this.#showTimer != null) {
      clearTimeout(this.#showTimer);
      this.#showTimer = null;
    }
    if (this.#unsub) {
      try { this.#unsub(); } catch (_e) { /* defensive */ }
      this.#unsub = null;
    }
    if (!this.hidden) unlock();
  }

  show() {
    if (hasSeenOnboarding() || get('connected.address')) return;
    this.hidden = false;
    lock();
    const connect = this.querySelector('[data-bind="onb-connect"]');
    try { connect?.focus?.(); } catch (_e) { /* fake DOM / old browser */ }
  }

  dismiss() {
    rememberOnboarding();
    this.#hide();
  }

  #hide() {
    if (this.#showTimer != null) {
      clearTimeout(this.#showTimer);
      this.#showTimer = null;
    }
    const wasOpen = !this.hidden;
    this.hidden = true;
    if (wasOpen) unlock();
  }

  async #connect() {
    if (this.#busy) return;
    this.#busy = true;
    const button = this.querySelector('[data-bind="onb-connect"]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Connecting…';
    }
    rememberOnboarding();
    // Never stack this dialog under the wallet picker / WalletConnect modal.
    this.#hide();
    try {
      await connectWithPicker();
    } catch (_e) {
      // The nav remains available if a wallet prompt is rejected.
    } finally {
      this.#busy = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Connect Wallet';
      }
    }
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-onboarding')) {
    customElements.define('app-onboarding', AppOnboarding);
  }
}
