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
import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { CHAIN, WALLETCONNECT_PROJECT_ID } from './chain-config.js';
import { update, get } from './store.js';
import { setProvider, clearProvider, switchToSepolia } from './contracts.js';
import { abortAllInflight } from './polling.js';

// ---------------------------------------------------------------------------
// Picker resolver — module-scope Promise resolver for wallet-picker.js click
// (RESEARCH §Pattern 1, lines 187-218).
// ---------------------------------------------------------------------------

let _pickerResolve = null;

// ---------------------------------------------------------------------------
// Phase 63 D-01 — singleton EthereumProvider cached for page lifetime.
// Issue #2930 mitigation: dual EthereumProvider instances on mobile redirect
// to the wrong app. Init runs at most once per page; subsequent
// connectWalletConnect / autoReconnect WC-branch calls reuse the cached
// instance (RESEARCH F-2: loadPersistedSession runs inside init and populates
// _wcProvider.session / .accounts / .chainId on every init call).
// ---------------------------------------------------------------------------

let _wcProvider = null;

// Test-seam: factory injection for EthereumProvider.init. Production code uses
// the imported EthereumProvider directly; tests inject a mock factory so they
// don't attempt to fetch the esm.sh bundle (too brittle for node:test).
let _wcEthereumProviderFactory = null;

// Test-seam: BrowserProvider constructor injection for the WC path. ethers'
// real BrowserProvider construction asserts EIP-1193 shape on the passed object
// AND its `.provider` getter returns `this` — so node:test cases mocking the WC
// EthereumProvider need to inject a stub BrowserProvider class to avoid
// ethers' "unknown ProviderEvent" assertion when attachListeners runs against
// the wrapped provider's internal subscription system. In production this is
// always the imported BrowserProvider from ethers.
let _wcBrowserProviderCtor = null;

export function onUserPickedWallet(info) {
  if (_pickerResolve) {
    _pickerResolve(info);
    _pickerResolve = null;
  }
}

// ---------------------------------------------------------------------------
// Phase 63 D-01 — WalletConnect v2 helpers (init opts + singleton ensure).
// ---------------------------------------------------------------------------

function _wcInitOpts() {
  // RESEARCH §Pattern 1 verified bundle behavior:
  //   - optionalChains (NOT chains) so wallets that don't pre-support Sepolia
  //     can still pair (required-namespace blocks them).
  //   - showQrModal:true triggers AppKit lazy-load of the bundled WC modal.
  //   - enableMobileFullScreen MUST be nested under qrModalOptions (top-level
  //     is silently ignored — verified in bundle: this.rpc.qrModalOptions?.enableMobileFullScreen===!0).
  //   - metadata.redirect.universal MUST be the runtime origin (mandatory v1.9.5+).
  //   - --wcm-z-index 2000 exceeds existing wallet-picker z-index 1000 so WC's
  //     bundled modal renders above our picker (RESEARCH Anti-Pattern line 505).
  const win = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window : null;
  const origin = (win && win.location && win.location.origin) ? win.location.origin : '';
  return {
    projectId: WALLETCONNECT_PROJECT_ID,
    optionalChains: [11155111, 1],
    showQrModal: true,
    qrModalOptions: {
      enableMobileFullScreen: true,
      themeMode: 'dark',
      themeVariables: {
        '--wcm-z-index': '2000',
        '--wcm-accent-color': 'var(--accent, #4caf50)',
        '--wcm-background-color': 'var(--bg-secondary, #1a1a1a)',
        '--wcm-font-family': 'inherit',
      },
    },
    metadata: {
      name: 'Degenerus',
      description: 'Degenerus Protocol — on-chain gambling game',
      url: origin,
      icons: [`${origin}/badges-circular/flame_red.svg`],
      redirect: {
        native: 'degenerus://',
        universal: `${origin}/app/`,
      },
    },
  };
}

async function _ensureWcProvider() {
  // Issue #2930 mitigation: never re-init on the same page.
  if (_wcProvider) return _wcProvider;
  const factory = _wcEthereumProviderFactory || EthereumProvider;
  _wcProvider = await factory.init(_wcInitOpts());
  // VERIFIED (RESEARCH F-2): loadPersistedSession runs inside init();
  // _wcProvider.session is truthy iff a prior session was persisted.
  return _wcProvider;
}

// ---------------------------------------------------------------------------
// connectWalletConnect — sibling to connectLegacy / connectWithPicker.
// Phase 63 D-01: WC v2 provider as a connect option. Wraps the WC EIP-1193
// provider in a BrowserProvider so the existing setProvider / clearProvider
// chokepoint (Phase 58) is reused verbatim (CF-04, no new chokepoint).
// ---------------------------------------------------------------------------

export async function connectWalletConnect() {
  const wc = await _ensureWcProvider();
  if (!wc.session || !wc.accounts || wc.accounts.length === 0) {
    // No persisted session — open the QR modal / deep-link to mobile wallet.
    // wc.connect() is the popup-equivalent and is intentionally invoked here
    // (NEVER from autoReconnect — that path is silent).
    await wc.connect();
  }
  if (!wc.accounts || wc.accounts.length === 0) return null;

  const BPCtor = _wcBrowserProviderCtor || BrowserProvider;
  const browserProvider = new BPCtor(wc);
  // WR-05: attach EIP-1193 listeners BEFORE returning so chainChanged /
  // accountsChanged events fired during WC session establishment are not lost.
  attachListeners(browserProvider);

  setProvider(browserProvider);
  const addr = String(wc.accounts[0]).toLowerCase();
  update('connected.address', addr);
  update('connected.rdns', 'walletconnect:v2');
  localStorage.setItem('lastWalletRdns', 'walletconnect:v2');
  update('ui.chainOk', wc.chainId === CHAIN.id);

  emitConnected(addr);
  return browserProvider;
}

// ---------------------------------------------------------------------------
// connectWithPicker — explicit user-initiated connect (popup OK on user click).
// Discovers EIP-6963 wallets, presents picker for 2+ wallets, persists rdns.
// ---------------------------------------------------------------------------

export async function connectWithPicker() {
  // Phase 63 D-01 step 4 — device-aware bypass.
  // Mobile-web with no injected wallet → skip picker, call WalletConnect directly.
  // Heuristic: (pointer:coarse) AND no window.ethereum AND zero EIP-6963 announces.
  // The picker is for desktop / extension users + MM in-dApp browser path.
  // (This bypass lives in wallet.js connectWithPicker ONLY — wallet-picker.js
  // does NOT contain pointer:coarse / isMobileWebNoInjected per WARNING 2 fix.)
  const win = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window : null;
  const isMobileWebNoInjected = !!(
    win
    && typeof win.matchMedia === 'function'
    && win.matchMedia('(pointer:coarse)').matches
    && typeof win.ethereum === 'undefined'
  );

  // Capture the EIP-6963 discovered list via the filter callback so we can
  // route to WC bypass when the list is empty AND the device is mobile-web.
  let _discoveredFound = null;

  const browserProvider = await BrowserProvider.discover({
    timeout: 1000,
    filter: (found) => {
      _discoveredFound = found;
      if (!found || found.length === 0) return null;
      if (found.length === 1) return found[0];
      return new Promise((resolve) => {
        // BL-05: track resolution state via a single boolean so neither
        // picker.show()'s Promise nor a stray onUserPickedWallet() call can
        // double-resolve into a stale outer Promise. Both code paths still
        // function (whichever fires first wins; subsequent calls are no-ops).
        let resolved = false;
        const finish = (info) => {
          if (resolved) return;
          resolved = true;
          _pickerResolve = null;
          resolve(info);
        };
        _pickerResolve = finish;
        const picker = typeof document !== 'undefined' ? document.querySelector('wallet-picker') : null;
        if (picker && typeof picker.show === 'function') {
          // wallet-picker.js (Plan 58-03) returns a Promise from show(). We
          // wrap synchronous and async failures so the outer Promise can
          // never leak: any error → resolve(null), letting connectWithPicker
          // fall through to legacy/null instead of hanging forever.
          let ret;
          try {
            ret = picker.show(found);
          } catch {
            finish(null);
            return;
          }
          if (ret && typeof ret.then === 'function') {
            ret.then(finish, () => finish(null));
          }
          // The click handler in wallet-picker also calls onUserPickedWallet()
          // → finish(info) via _pickerResolve. The `resolved` guard makes the
          // duplicate call a no-op.
        } else {
          // Graceful degradation: no picker mounted → first wallet.
          finish(found[0]);
        }
      });
    },
  }).catch(() => null);

  // Phase 63 D-01 step 4 — device-aware bypass dispatch.
  // If we're on mobile-web with no injected wallet AND zero EIP-6963 announces,
  // route directly to WalletConnect (WC's bundled modal owns the per-wallet
  // deep-link dispatch table on mobile). This is the SINGLE-SCOPE owner of the
  // bypass — wallet-picker.js does NOT replicate this check.
  if (
    isMobileWebNoInjected
    && (!_discoveredFound || _discoveredFound.length === 0)
    && !browserProvider
  ) {
    return connectWalletConnect();
  }

  if (!browserProvider) return connectLegacy();

  // WR-05: attach listeners BEFORE eth_requestAccounts so chainChanged /
  // accountsChanged events fired during wallet startup are not lost.
  attachListeners(browserProvider);

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

  emitConnected(addr);
  return browserProvider;
}

// ---------------------------------------------------------------------------
// connectLegacy — window.ethereum fallback for wallets without EIP-6963.
// Persists sentinel rdns 'legacy:window.ethereum' so autoReconnect routes back.
//
// WR-10 contract: this function calls eth_requestAccounts which WILL surface
// the wallet's permission prompt if the site is not already authorized. It
// is intended to be invoked from explicit user-initiated paths only:
//   - connectWithPicker fallback (when EIP-6963 discovery returns null)
//   - direct user click that opted into "legacy connect" UI
// Do NOT call from autoReconnect / silent boot flows — autoReconnect uses
// eth_accounts (silent) for the legacy path.
// ---------------------------------------------------------------------------

export async function connectLegacy() {
  const eth = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window.ethereum : null;
  if (!eth) {
    // No wallet at all — UI shows install CTA via wallet-picker zero-state in plan 58-03.
    return null;
  }
  const browserProvider = new BrowserProvider(eth);
  // WR-05: attach EIP-1193 listeners BEFORE eth_requestAccounts so
  // chainChanged/accountsChanged events fired during the wallet's startup /
  // permission-grant flow (e.g., MetaMask Snap chain init) are not lost.
  attachListeners(browserProvider);
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
    const browserProvider = new BrowserProvider(eth);
    // WR-05: attach listeners BEFORE eth_accounts so wallet-startup events
    // are not lost.
    attachListeners(browserProvider);
    const accounts = await eth.request({ method: 'eth_accounts' }).catch(() => []);
    if (!accounts || accounts.length === 0) return false;
    setProvider(browserProvider);
    update('connected.address', accounts[0].toLowerCase());
    update('connected.rdns', 'legacy:window.ethereum');
    const net = await browserProvider.getNetwork().catch(() => null);
    update('ui.chainOk', net ? Number(net.chainId) === CHAIN.id : null);
    return true;
  }

  // Phase 63 D-01 — WalletConnect silent reconnect path.
  // EthereumProvider.init() runs loadPersistedSession internally (RESEARCH F-2);
  // wc.session is truthy iff a prior session was persisted. SILENT semantics —
  // NEVER call wc.connect() here (popup-equivalent; reserved for explicit user
  // click via connectWalletConnect).
  if (rdns === 'walletconnect:v2') {
    try {
      const wc = await _ensureWcProvider();
      if (!wc.session || !wc.accounts || wc.accounts.length === 0) return false;
      const BPCtor = _wcBrowserProviderCtor || BrowserProvider;
      const browserProvider = new BPCtor(wc);
      // WR-05: attach listeners BEFORE consuming wc state so chainChanged
      // events fired during silent resume are not lost.
      attachListeners(browserProvider);
      setProvider(browserProvider);
      update('connected.address', String(wc.accounts[0]).toLowerCase());
      update('connected.rdns', 'walletconnect:v2');
      update('ui.chainOk', wc.chainId === CHAIN.id);
      return true;
    } catch (_) {
      return false;
    }
  }

  // EIP-6963 path — discover with byRdns filter (deterministic, no race).
  const browserProvider = await BrowserProvider.discover({
    timeout: 1000,
    filter: (found) => (found && found.find((p) => p.rdns === rdns)) || null,
  }).catch(() => null);
  if (!browserProvider) return false;

  // WR-05: attach listeners BEFORE eth_accounts so wallet-startup events
  // are not lost.
  attachListeners(browserProvider);

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

  eth.on('accountsChanged', async (accounts) => {
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
      // WR-02: a new account may be on a different chain (some wallets allow
      // per-account chain settings, e.g., MetaMask Snap, Coinbase Wallet).
      // Re-derive ui.chainOk so the banner / button-enable state stay in sync
      // even before any user-driven write triggers assertChain().
      const network = await browserProvider.getNetwork().catch(() => null);
      update('ui.chainOk', network ? Number(network.chainId) === CHAIN.id : null);
      // DO NOT touch ui.mode here — view-mode is derived from viewing.address vs
      // connected.address (handled in plan 58-02 store.js deriveMode subscriber).
      document.dispatchEvent(new CustomEvent('wallet-connected', {
        detail: { address: addr },
      }));
    }
  });

  eth.on('chainChanged', (hexId) => {
    abortAllInflight();
    // WR-01: defensively normalize hexId. EIP-1193 says it's a hex string,
    // but buggy/malicious wallet extensions can pass a number, object, or
    // undefined. Compare lowercased per EIP-695 (some wallets return uppercase).
    const hex = (typeof hexId === 'string') ? hexId.toLowerCase() : null;
    update('ui.chainOk', hex !== null && hex === CHAIN.hexId.toLowerCase());
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

// Phase 63 D-01 test seams — WC provider singleton + factory injection.
export const _testEnsureWcProvider = _ensureWcProvider;
export const _testWcInitOpts = _wcInitOpts;
export function _testInjectWcFactory(fn) { _wcEthereumProviderFactory = fn; }
export function _testInjectWcBrowserProviderCtor(ctor) { _wcBrowserProviderCtor = ctor; }
export function _testResetWcSingleton() { _wcProvider = null; _wcEthereumProviderFactory = null; _wcBrowserProviderCtor = null; }
export function _testGetWcSingleton() { return _wcProvider; }
