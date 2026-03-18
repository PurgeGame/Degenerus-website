// components/connect-prompt.js -- Wallet connection prompt Custom Element
// Shows overlay when no wallet connected; hides after connection.
// Manages own visibility via store subscription to ui.connectionState.

import { subscribe } from '../app/store.js';
import { connectWallet, getDiscoveredProviders } from '../app/wallet.js';

class ConnectPrompt extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = `
      <div class="connect-prompt">
        <div class="connect-prompt-content">
          <h2>Connect Your Wallet</h2>
          <p class="text-dim">Connect your wallet to interact with the Degenerus Protocol on Sepolia testnet.</p>
          <div class="wallet-list" data-bind="wallets"></div>
          <button class="btn-primary connect-btn">Connect Wallet</button>
          <p class="connect-hint text-dim" data-bind="hint"></p>
        </div>
      </div>
    `;

    const btn = this.querySelector('.connect-btn');
    btn.addEventListener('click', () => this.#handleConnect());

    this.#unsubs.push(
      subscribe('ui.connectionState', (state) => {
        // Show when disconnected, hide when connected or connecting
        this.hidden = state === 'connected';

        // Update hint text based on state
        const hint = this.querySelector('[data-bind="hint"]');
        if (hint) {
          if (state === 'connecting') hint.textContent = 'Connecting...';
          else if (state === 'wrong-chain') hint.textContent = 'Please switch to Sepolia testnet.';
          else hint.textContent = '';
        }

        // Disable button while connecting
        if (btn) btn.disabled = state === 'connecting';
      }),
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }

  async #handleConnect() {
    const providers = getDiscoveredProviders();
    if (providers.length === 1) {
      // Single wallet -- connect directly
      await connectWallet(providers[0]);
    } else if (providers.length > 1) {
      // Multiple wallets -- connect first for now (wallet picker deferred)
      await connectWallet(providers[0]);
    } else {
      // No providers -- try default connection (will use fallback)
      await connectWallet();
    }
  }
}

customElements.define('connect-prompt', ConnectPrompt);
