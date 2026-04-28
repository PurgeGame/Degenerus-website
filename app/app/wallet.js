// /app/app/wallet.js — Phase 58 Plan 01 wallet stack (WLT-01..03).
//
// EIP-6963 discovery via ethers v6 BrowserProvider.discover({timeout, filter}) —
// replaces the raw eip6963:announceProvider listener + setTimeout(500) race-wait
// pattern from /beta/app/wallet.js with deterministic ethers-managed dedup + filter.
//
// rdns persistence ONLY — rdns is the schema-stable wallet identifier per EIP-6963
// (T-58-04 + T-58-08). The address-based and uuid-based persistence keys used by
// /beta/ are intentionally NOT persisted here (uuid is per-session ephemeral; an
// address as the lookup key cannot survive an account switch within the same wallet).
//
// autoReconnect uses eth_accounts (silent, no popup) — eth_requestAccounts is
// reserved for explicit user "Connect" clicks via connectWithPicker.
//
// accountsChanged + chainChanged + disconnect listeners call polling.abortAllInflight()
// before mutating store, so stale fetches cannot land on the post-change wallet.
// chainChanged does NOT trigger a page refresh — preserves ?as= URL state and view-mode
// for users who cold-loaded with a deep link (T-58-06).
//
// Bidirectional bridge with /shared/nav.js: listens for `wallet-connected` /
// `wallet-disconnected` CustomEvents (defensive idempotency, no re-emit loop —
// T-58-07) and dispatches them on /app/-driven connect/disconnect flows.
//
// Three structural changes vs /beta/app/wallet.js (the analog):
//   1. discovery: raw eip6963:announceProvider listener → BrowserProvider.discover
//   2. persistence: rdns OR uuid → rdns ONLY (uuid is per-session ephemeral)
//   3. auto-reconnect: setTimeout(500) race → discover({filter: byRdns}, deterministic)
// And one preserved pattern: nav.js bridge events (verbatim from /beta/ L193-208).

import { BrowserProvider } from 'ethers';
import { CHAIN } from './chain-config.js';
import { update, get } from './store.js';
import { setProvider, clearProvider, switchToSepolia } from './contracts.js';
import { abortAllInflight } from './polling.js';

// ---------------------------------------------------------------------------
// Picker resolver — module-scope Promise resolver for wallet-picker.js click
// (RESEARCH §Pattern 1, lines 187-218).
// ---------------------------------------------------------------------------

let _pickerResolve = null;

export function onUserPickedWallet(info) {
  if (_pickerResolve) {
    _pickerResolve(info);
    _pickerResolve = null;
  }
}

// ---------------------------------------------------------------------------
// connectWithPicker — explicit user-initiated connect (popup OK on user click).
// Discovers EIP-6963 wallets, presents picker for 2+ wallets, persists rdns.
// ---------------------------------------------------------------------------

export async function connectWithPicker() {
  const browserProvider = await BrowserProvider.discover({
    timeout: 1000,
    filter: (found) => {
      if (!found || found.length === 0) return null;
      if (found.length === 1) return found[0];
      return new Promise((resolve) => {
        _pickerResolve = resolve;
        const picker = typeof document !== 'undefined' ? document.querySelector('wallet-picker') : null;
        if (picker && typeof picker.show === 'function') {
          // wallet-picker.js (Plan 58-03) returns a Promise from show(); we wire either path.
          const ret = picker.show(found);
          if (ret && typeof ret.then === 'function') {
            ret.then((info) => {
              if (_pickerResolve) {
                _pickerResolve(info);
                _pickerResolve = null;
              }
            });
          }
          // Otherwise the click handler in wallet-picker calls onUserPickedWallet().
        } else {
          // Graceful degradation: no picker mounted → first wallet.
          resolve(found[0]);
          _pickerResolve = null;
        }
      });
    },
  }).catch(() => null);

  if (!browserProvider) return connectLegacy();

  // Explicit connect — request accounts (popup OK on user click).
  const accounts = await browserProvider.provider.request({
    method: 'eth_requestAccounts',
  }).catch(() => []);
  if (!accounts || accounts.length === 0) return null;

  const rdns = browserProvider.providerInfo?.rdns;
  if (rdns) localStorage.setItem('lastWalletRdns', rdns);

  setProvider(browserProvider);
  const addr = accounts[0].toLowerCase();
  update('connected.address', addr);
  update('connected.rdns', rdns || null);

  const network = await browserProvider.getNetwork().catch(() => null);
  update('ui.chainOk', network ? Number(network.chainId) === CHAIN.id : null);

  attachListeners(browserProvider);
  emitConnected(addr);
  return browserProvider;
}

// ---------------------------------------------------------------------------
// connectLegacy — window.ethereum fallback for wallets without EIP-6963.
// Persists sentinel rdns 'legacy:window.ethereum' so autoReconnect routes back.
// ---------------------------------------------------------------------------

export async function connectLegacy() {
  const eth = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window.ethereum : null;
  if (!eth) {
    // No wallet at all — UI shows install CTA via wallet-picker zero-state in plan 58-03.
    return null;
  }
  const browserProvider = new BrowserProvider(eth);
  const accounts = await eth.request({ method: 'eth_requestAccounts' }).catch(() => []);
  if (!accounts || accounts.length === 0) return null;

  // Legacy wallets have no rdns; persist sentinel so autoReconnect knows to use eth fallback.
  localStorage.setItem('lastWalletRdns', 'legacy:window.ethereum');

  setProvider(browserProvider);
  const addr = accounts[0].toLowerCase();
  update('connected.address', addr);
  update('connected.rdns', 'legacy:window.ethereum');

  const network = await browserProvider.getNetwork().catch(() => null);
  update('ui.chainOk', network ? Number(network.chainId) === CHAIN.id : null);

  attachListeners(browserProvider);
  emitConnected(addr);
  return browserProvider;
}

// ---------------------------------------------------------------------------
// autoReconnect — silent reconnect via persisted rdns.
// MUST call eth_accounts (silent), NEVER eth_requestAccounts (would popup).
// ---------------------------------------------------------------------------

export async function autoReconnect() {
  const rdns = localStorage.getItem('lastWalletRdns');
  if (!rdns) return false;

  // Legacy fallback path (window.ethereum without EIP-6963)
  if (rdns === 'legacy:window.ethereum') {
    const eth = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window.ethereum : null;
    if (!eth) return false;
    const accounts = await eth.request({ method: 'eth_accounts' }).catch(() => []);
    if (!accounts || accounts.length === 0) return false;
    const browserProvider = new BrowserProvider(eth);
    setProvider(browserProvider);
    update('connected.address', accounts[0].toLowerCase());
    update('connected.rdns', 'legacy:window.ethereum');
    const net = await browserProvider.getNetwork().catch(() => null);
    update('ui.chainOk', net ? Number(net.chainId) === CHAIN.id : null);
    attachListeners(browserProvider);
    return true;
  }

  // EIP-6963 path — discover with byRdns filter (deterministic, no race).
  const browserProvider = await BrowserProvider.discover({
    timeout: 1000,
    filter: (found) => (found && found.find((p) => p.rdns === rdns)) || null,
  }).catch(() => null);
  if (!browserProvider) return false;

  // SILENT — eth_accounts (NOT eth_requestAccounts → no popup).
  const accounts = await browserProvider.provider.request({
    method: 'eth_accounts',
  }).catch(() => []);
  if (!accounts || accounts.length === 0) return false;

  setProvider(browserProvider);
  update('connected.address', accounts[0].toLowerCase());
  update('connected.rdns', browserProvider.providerInfo?.rdns || null);

  const network = await browserProvider.getNetwork().catch(() => null);
  update('ui.chainOk', network ? Number(network.chainId) === CHAIN.id : null);

  attachListeners(browserProvider);
  return true;
}

// ---------------------------------------------------------------------------
// attachListeners — wire EIP-1193 lifecycle events on the discovered provider.
// CRITICAL: chainChanged does NOT trigger a page refresh — preserves ?as= URL
// state for view-mode users (T-58-06).
// ---------------------------------------------------------------------------

function attachListeners(browserProvider) {
  const eth = browserProvider.provider;
  if (!eth || typeof eth.on !== 'function') return;

  eth.on('accountsChanged', (accounts) => {
    abortAllInflight();
    if (!accounts || accounts.length === 0) {
      // Clear viewing.address FIRST so deriveMode (microtask) sees a consistent
      // (viewing=null, connected=null) state and produces 'self' on its own.
      // Writing connected.address first would let deriveMode (scheduled by the
      // connected-clear) flip ui.mode back to 'view' in a microtask, undoing
      // the explicit ui.mode='self' write below (BL-01).
      update('viewing.address', null);
      update('connected.address', null);
      update('connected.rdns', null);
      update('ui.mode', 'self');
      localStorage.removeItem('lastWalletRdns');
      clearProvider();
      document.dispatchEvent(new CustomEvent('wallet-disconnected'));
    } else {
      const addr = accounts[0].toLowerCase();
      update('connected.address', addr);
      // DO NOT touch ui.mode here — view-mode is derived from viewing.address vs
      // connected.address (handled in plan 58-02 store.js deriveMode subscriber).
      document.dispatchEvent(new CustomEvent('wallet-connected', {
        detail: { address: addr },
      }));
    }
  });

  eth.on('chainChanged', (hexId) => {
    abortAllInflight();
    update('ui.chainOk', hexId === CHAIN.hexId);
    // CRITICAL: NO page refresh on chainChanged — preserves ?as= URL state for
    // view-mode users (T-58-06). The store update is sufficient to drive UI re-render.
  });

  eth.on('disconnect', () => {
    // BL-01: clear viewing.address FIRST so deriveMode produces 'self' from a
    // consistent post-write state (see accountsChanged([]) above).
    update('viewing.address', null);
    update('connected.address', null);
    update('connected.rdns', null);
    update('ui.mode', 'self');
    localStorage.removeItem('lastWalletRdns');
    clearProvider();
    document.dispatchEvent(new CustomEvent('wallet-disconnected'));
  });
}

// ---------------------------------------------------------------------------
// disconnect — explicit user-driven disconnect (e.g., nav.js disconnect button).
// ---------------------------------------------------------------------------

export function disconnect() {
  // BL-01: clear viewing.address FIRST so deriveMode produces 'self' from a
  // consistent post-write state (see accountsChanged([]) above).
  update('viewing.address', null);
  update('connected.address', null);
  update('connected.rdns', null);
  update('ui.mode', 'self');
  localStorage.removeItem('lastWalletRdns');
  clearProvider();
  document.dispatchEvent(new CustomEvent('wallet-disconnected'));
}

// ---------------------------------------------------------------------------
// nav.js bridge — bidirectional event sync without re-emit loops (T-58-07).
// nav.js does NOT listen for `wallet-connected` (verified RESEARCH A4); it
// dispatches the event when its own connect chain completes. We listen so the
// /app/ store stays in sync with nav.js-driven flows. We do NOT re-emit.
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  document.addEventListener('wallet-connected', (e) => {
    const addr = e?.detail?.address ? String(e.detail.address).toLowerCase() : null;
    if (addr && get('connected.address') !== addr) {
      update('connected.address', addr);
      // Do NOT re-emit — defensive idempotency check via address comparison.
    }
  });

  document.addEventListener('wallet-disconnected', () => {
    if (get('connected.address')) {
      // BL-01: clear viewing.address FIRST so deriveMode produces 'self' from a
      // consistent post-write state (see accountsChanged([]) in attachListeners).
      update('viewing.address', null);
      update('connected.address', null);
      update('connected.rdns', null);
      update('ui.mode', 'self');
      localStorage.removeItem('lastWalletRdns');
      clearProvider();
    }
  });
}

function emitConnected(address) {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('wallet-connected', {
      detail: { address },
    }));
  }
}

// ---------------------------------------------------------------------------
// Test-only export surface (NOT for downstream consumers).
// ---------------------------------------------------------------------------

export { attachListeners as _testAttachListeners };
