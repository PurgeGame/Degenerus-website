// Explicit context for the useful disconnected fallback account. The app polls
// the live sDGNRS protocol wallet until a player connects; this banner makes it
// impossible to mistake those balances/results for their own.

import { CONTRACTS } from '../app/chain-config.js';
import { connectWithPicker } from '../app/wallet.js';
import { get, subscribe } from '../app/store.js';

const PROTOCOL_ADDRESS = CONTRACTS.SDGNRS
  ? String(CONTRACTS.SDGNRS).toLowerCase()
  : null;

export function isDisconnectedProtocolWalletView({ connected, viewing } = {}) {
  return Boolean(
    PROTOCOL_ADDRESS
    && !connected
    && viewing
    && String(viewing).toLowerCase() === PROTOCOL_ADDRESS
  );
}

function _shortAddress(address) {
  const value = String(address || '');
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export class AppProtocolWalletBanner extends HTMLElement {
  #initialized = false;
  #busy = false;
  #unsubs = [];

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.innerHTML = `
      <div class="protocol-wallet-banner__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3 4.5 6.2v5.4c0 4.5 3 7.7 7.5 9.4 4.5-1.7 7.5-4.9 7.5-9.4V6.2L12 3Z"/>
          <path d="M8.2 11.8h7.6M9.2 9.2h5.6v5.3H9.2z"/>
        </svg>
      </div>
      <span class="protocol-wallet-banner__copy">
        <strong>VIEWING THE sDGNRS PROTOCOL WALLET</strong>
        <small>Live read-only protocol activity · ${_shortAddress(PROTOCOL_ADDRESS)}</small>
      </span>
      <button type="button" class="protocol-wallet-banner__connect"
              data-bind="protocol-wallet-connect">CONNECT YOUR WALLET</button>`;
    this.querySelector('[data-bind="protocol-wallet-connect"]')
      ?.addEventListener('click', () => void this.#connect());
    this.#unsubs = [
      subscribe('connected.address', () => this.#render()),
      subscribe('viewing.address', () => this.#render()),
    ];
    this.#render();
  }

  disconnectedCallback() {
    for (const unsubscribe of this.#unsubs.splice(0)) {
      try { unsubscribe?.(); } catch (_error) { /* defensive */ }
    }
    this.#initialized = false;
    this.#busy = false;
  }

  #render() {
    const visible = isDisconnectedProtocolWalletView({
      connected: get('connected.address'),
      viewing: get('viewing.address'),
    });
    this.hidden = !visible;
    const button = this.querySelector('[data-bind="protocol-wallet-connect"]');
    if (button) {
      button.disabled = this.#busy;
      button.textContent = this.#busy ? 'CONNECTING…' : 'CONNECT YOUR WALLET';
    }
  }

  async #connect() {
    if (this.#busy || get('connected.address')) return;
    this.#busy = true;
    this.#render();
    try { await connectWithPicker(); }
    catch (_error) { /* the wallet/picker owns rejection details */ }
    finally {
      this.#busy = false;
      this.#render();
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-protocol-wallet-banner')) {
  customElements.define('app-protocol-wallet-banner', AppProtocolWalletBanner);
}
