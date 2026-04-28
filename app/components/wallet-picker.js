// /app/components/wallet-picker.js — Phase 58 EIP-6963 multi-wallet picker UI.
//
// Two responsibilities (kept in one module under v4.6 single-concern rule —
// "wallet UI" is one concern, splitting two ~30 LOC sections into separate
// files would create cross-imports for no benefit):
//
//   1. <wallet-picker> Custom Element — modal listing discovered EIP-6963
//      wallets (name + icon + rdns); show(found) returns Promise<info|null>;
//      consumed by wallet.js's connectWithPicker filter callback (Plan 58-01).
//
//   2. Module-init chain-chip subscriber — flips chain-chip state classes on
//      every ui.chainOk transition; surfaces switch-to-Sepolia CTA on
//      mismatch. Runs once at import time (not inside the Custom Element).
//
// Security (T-58-13 mitigation):
//   - name + rdns rendered via element.textContent, NEVER innerHTML
//     interpolation of wallet-supplied data.
//   - icon set via element.src setter (browser blocks javascript: URIs in
//     img.src by default; data: URIs for images are safe).
//   - Static skeleton uses innerHTML for trusted literal markup only.
//
// Single-wallet auto-select happens UPSTREAM in wallet.js's filter callback
// (when found.length === 1, the picker is never invoked). show() is only
// called for 2+ wallets OR for the explicit zero-wallets install-CTA path.

import { subscribe } from '../app/store.js';
import { getProvider, switchToSepolia } from '../app/contracts.js';

// ---------------------------------------------------------------------------
// <wallet-picker> Custom Element.
// ---------------------------------------------------------------------------

export class WalletPicker extends HTMLElement {
  #resolve = null;

  connectedCallback() {
    this.hidden = true;
    // Static skeleton — trusted literal markup only. No wallet-supplied data
    // is interpolated here; per-row content is appended via createElement +
    // textContent inside show().
    this.innerHTML = `
      <div class="wallet-picker-backdrop" data-close></div>
      <div class="wallet-picker-modal" role="dialog" aria-label="Choose wallet" aria-modal="true">
        <h3>Choose a wallet</h3>
        <ul class="wallet-list" data-bind="list"></ul>
        <div class="wallet-picker-empty" data-bind="empty" hidden>
          <p>No wallet detected.</p>
          <p>Install one to play:</p>
          <ul class="wallet-install-links">
            <li><a href="https://metamask.io/download/" target="_blank" rel="noopener">MetaMask</a></li>
            <li><a href="https://www.coinbase.com/wallet/downloads" target="_blank" rel="noopener">Coinbase Wallet</a></li>
            <li><a href="https://rabby.io/" target="_blank" rel="noopener">Rabby</a></li>
          </ul>
        </div>
        <button class="btn-secondary wallet-picker-cancel" data-close type="button">Cancel</button>
      </div>`;

    this.addEventListener('click', (e) => {
      const t = e.target;
      if (t && typeof t.matches === 'function' && t.matches('[data-close]')) {
        this.cancel();
      }
    });
    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancel();
    });
  }

  disconnectedCallback() {
    // Resolve any pending show() Promise to null so awaiters don't hang.
    if (this.#resolve) {
      try { this.#resolve(null); } catch { /* swallow */ }
      this.#resolve = null;
    }
  }

  /**
   * show(found) — render the picker and await the user's selection.
   *
   * @param {Array<{icon: string, name: string, rdns: string, uuid: string}>} found
   *   The EIP-6963 ProviderInfo array from BrowserProvider.discover. Empty
   *   array → renders the install-CTA zero-state.
   * @returns {Promise<object|null>} Resolves to the picked info on row click,
   *   or null on cancel/Escape/backdrop-click/disconnectedCallback.
   */
  show(found) {
    const list = this.querySelector('[data-bind="list"]');
    const empty = this.querySelector('[data-bind="empty"]');
    if (!list || !empty) return Promise.resolve(null);

    // Clear prior rows. Empty-string innerHTML is safe (no wallet data
    // touched) and also drops any previously-appended <li> children.
    list.innerHTML = '';

    if (!found || found.length === 0) {
      // Zero-wallets state — show install CTA, hide list.
      list.hidden = true;
      empty.hidden = false;
    } else {
      empty.hidden = true;
      list.hidden = false;
      for (const info of found) {
        const li = document.createElement('li');
        li.className = 'wallet-row';
        li.tabIndex = 0;

        const img = document.createElement('img');
        img.className = 'wallet-icon';
        // src setter — browser handles URI validation; NEVER interpolated into innerHTML.
        img.src = info.icon || '';
        img.alt = '';

        const nameEl = document.createElement('span');
        nameEl.className = 'wallet-name';
        // textContent assignment — NEVER innerHTML (T-58-13).
        nameEl.textContent = info.name || 'Unknown wallet';

        const rdnsEl = document.createElement('span');
        rdnsEl.className = 'wallet-rdns';
        rdnsEl.textContent = info.rdns || '';

        li.appendChild(img);
        li.appendChild(nameEl);
        li.appendChild(rdnsEl);
        li.addEventListener('click', () => this.pick(info));
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.preventDefault) e.preventDefault();
            this.pick(info);
          }
        });
        list.appendChild(li);
      }
    }

    this.hidden = false;
    return new Promise((resolve) => { this.#resolve = resolve; });
  }

  pick(info) {
    if (this.#resolve) {
      this.#resolve(info);
      this.#resolve = null;
    }
    this.hidden = true;
  }

  cancel() {
    if (this.#resolve) {
      this.#resolve(null);
      this.#resolve = null;
    }
    this.hidden = true;
  }
}

if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('wallet-picker')) {
    customElements.define('wallet-picker', WalletPicker);
  }
}

// ---------------------------------------------------------------------------
// chain-chip state-class manager (module-init).
//
// Subscribes to ui.chainOk and flips one of three classes on the #chain-chip
// element. Phase 56 ships the chip with class chain-chip--neutral and
// data-state="placeholder"; this subscriber removes the placeholder lock and
// drives live state going forward.
// ---------------------------------------------------------------------------

export function _updateChainChip(chainOk) {
  if (typeof document === 'undefined') return;
  const chip = document.getElementById('chain-chip');
  if (!chip) return;

  // Remove all three state classes; we set exactly one below.
  chip.classList.remove('chain-chip--neutral', 'chain-chip--ok', 'chain-chip--mismatch');
  if (chip.removeAttribute) chip.removeAttribute('data-state');

  const label = chip.querySelector('.chain-chip__label');

  if (chainOk === true) {
    chip.classList.add('chain-chip--ok');
    if (label) label.textContent = 'Sepolia';
    // Drop any prior switch CTA (no longer needed).
    const cta = chip.querySelector('.chain-chip__switch');
    if (cta && cta.remove) cta.remove();
  } else if (chainOk === false) {
    chip.classList.add('chain-chip--mismatch');
    if (label) label.textContent = 'Wrong network — switch to Sepolia';
    // Inject the switch CTA if not already present.
    let cta = chip.querySelector('.chain-chip__switch');
    if (!cta) {
      cta = document.createElement('button');
      cta.className = 'chain-chip__switch';
      cta.type = 'button';
      cta.textContent = 'Switch';
      cta.addEventListener('click', async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        try {
          const provider = getProvider();
          const eth = provider && provider.provider;
          if (eth) await switchToSepolia(eth);
        } catch { /* swallow — UI surface, error toast is Phase 60+ */ }
      });
      chip.appendChild(cta);
    }
  } else {
    // null / undefined / anything else → neutral placeholder state.
    chip.classList.add('chain-chip--neutral');
    if (label) label.textContent = 'Sepolia testnet';
    const cta = chip.querySelector('.chain-chip__switch');
    if (cta && cta.remove) cta.remove();
  }
}

// Install the subscriber. If the DOM isn't ready yet, defer until DOMContentLoaded
// so document.getElementById('chain-chip') resolves on the initial fire.
//
// Test-only: _installChainChipSubscriber is exported so node:test cases can
// re-register after store.__resetForTest() clears the subscriber map between cases.
export function _installChainChipSubscriber() {
  return subscribe('ui.chainOk', _updateChainChip);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _installChainChipSubscriber);
  } else {
    _installChainChipSubscriber();
  }
}
