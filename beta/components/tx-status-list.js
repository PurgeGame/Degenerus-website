// components/tx-status-list.js -- Transaction status list Custom Element
// Renders all pending/active transactions from ui.pendingTxs store path.
// Uses tx-status.css classes defined in Phase 6.

import { subscribe } from '../app/store.js';
import { txUrl } from '../app/utils.js';

class TxStatusList extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.#unsubs.push(
      subscribe('ui.pendingTxs', (txs) => this.#render(txs))
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }

  #render(txs) {
    if (!txs || txs.length === 0) {
      this.innerHTML = '';
      return;
    }
    this.innerHTML = txs.map(tx => {
      const cssClass = tx.status === 'confirmed' ? 'tx-confirmed'
        : tx.status === 'reverted' || tx.status === 'error' ? 'tx-failed'
        : 'tx-pending';
      const icon = tx.status === 'confirmed' ? 'OK'
        : tx.status === 'reverted' || tx.status === 'error' ? '!'
        : '';
      const spinner = tx.status === 'pending' || tx.status === 'submitted'
        ? '<span class="tx-spinner"></span>' : '';
      const hashLink = tx.hash
        ? `<a class="tx-hash" href="${txUrl(tx.hash)}" target="_blank" rel="noopener">${tx.hash.slice(0, 10)}...</a>`
        : '';
      return `<div class="tx-status ${cssClass}">
        ${spinner}${icon ? `<span class="tx-icon">${icon}</span>` : ''}
        <span>${tx.action}: ${tx.status}</span>
        ${hashLink}
      </div>`;
    }).join('');
  }
}

customElements.define('tx-status-list', TxStatusList);
