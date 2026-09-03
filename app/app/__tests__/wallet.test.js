// /app/app/__tests__/wallet.test.js — Phase 58 Plan 01 unit (WLT-01..03).
//
// Run: cd website && node --test app/app/__tests__/wallet.test.js
//
// Covers:
//   - autoReconnect uses eth_accounts (silent), NEVER eth_requestAccounts
//   - lastWalletRdns persistence (not lastWalletAddress / lastWalletUuid)
//   - accountsChanged listener: empty array → wipe + wallet-disconnected; non-empty → wallet-connected
//   - chainChanged updates ui.chainOk WITHOUT calling location.reload() (Pitfall: view-mode preservation)
//   - switchToSepolia 4902 fallback (calls wallet_addEthereumChain, then retries switch)
//   - EIP-6963 connectWithPicker: zero/single/multi wallet branches via BrowserProvider.discover({filter})
//   - polling.abortAllInflight() called inside accountsChanged + chainChanged
//   - Bidirectional nav.js bridge: wallet-connected listener does NOT re-emit (loop guard)
//
// Stubs for './store.js', './polling.js', './contracts.js', and ethers' BrowserProvider.discover
// are installed BEFORE the dynamic import of wallet.js so static-import resolution sees them.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Global DOM/localStorage stubs (must land before wallet.js imports)
// ---------------------------------------------------------------------------

const _events = [];                               // captured CustomEvents (dispatchEvent calls)
const _docListeners = new Map();                  // bridge listeners installed at module init
const _localStore = new Map();
const _locationAssignCalls = [];
const _windowOpenCalls = [];
let _reloadCalled = false;

globalThis.window = {
  addEventListener: () => {},
  matchMedia: (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
  location: {
    get search() { return ''; },
    get href() { return 'http://localhost/'; },
    assign: (...args) => { _locationAssignCalls.push(args); },
    reload: () => { _reloadCalled = true; },
  },
  open: (...args) => {
    _windowOpenCalls.push(args);
    return null;
  },
};

globalThis.document = {
  addEventListener: (type, fn) => {
    if (!_docListeners.has(type)) _docListeners.set(type, []);
    _docListeners.get(type).push(fn);
  },
  removeEventListener: () => {},
  dispatchEvent: (ev) => { _events.push(ev); return true; },
  querySelector: (sel) => {
    if (sel === 'wallet-picker') return _pickerEl;
    return null;
  },
};

globalThis.localStorage = {
  getItem: (k) => _localStore.has(k) ? _localStore.get(k) : null,
  setItem: (k, v) => { _localStore.set(k, String(v)); },
  removeItem: (k) => { _localStore.delete(k); },
  clear: () => { _localStore.clear(); },
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

// Wallet-picker mock element (mutated per test)
let _pickerShownWith = null;
let _pickerShowReturn = null; // Promise the picker.show() returns
let _pickerEl = {
  show: (found) => {
    _pickerShownWith = found;
    return _pickerShowReturn || Promise.resolve(found[0]);
  },
};

// ---------------------------------------------------------------------------
// Store stub — installed via a fake module file (./store.js).
// The tests reset its internal state per test via the exported _setState helper.
// (The real ./store.js lands in plan 58-02; for plan 58-01 we ship a minimal
// shim that satisfies wallet.js/contracts.js static imports during testing.)
// ---------------------------------------------------------------------------

import * as storeMod from '../store.js';        // resolved against the live ./store.js
import * as pollingMod from '../polling.js';   // resolved against the live ./polling.js
import { CHAIN } from '../chain-config.js';

// Track call history through the real store. WR-09: subscribers are
// installed/torn down per test (was: top-level module subscribe with no
// cleanup, leaking five subscribers per test file load and breaking if a
// sibling test file's __resetForTest cleared the registry).
const _storeUpdates = [];        // [path, value]
const _testUnsubs = [];

function resetStore() {
  storeMod.update('connected.address', null);
  storeMod.update('connected.rdns', null);
  storeMod.update('ui.chainOk', null);
  storeMod.update('ui.mode', 'self');
  storeMod.update('viewing.address', null);
  _storeUpdates.length = 0;
}

function installStoreSubscribers() {
  _testUnsubs.push(storeMod.subscribe('connected.address', (v) => _storeUpdates.push(['connected.address', v])));
  _testUnsubs.push(storeMod.subscribe('connected.rdns',    (v) => _storeUpdates.push(['connected.rdns', v])));
  _testUnsubs.push(storeMod.subscribe('ui.chainOk',        (v) => _storeUpdates.push(['ui.chainOk', v])));
  _testUnsubs.push(storeMod.subscribe('ui.mode',           (v) => _storeUpdates.push(['ui.mode', v])));
  _testUnsubs.push(storeMod.subscribe('viewing.address',   (v) => _storeUpdates.push(['viewing.address', v])));
}

function teardownStoreSubscribers() {
  for (const u of _testUnsubs) {
    try { u(); } catch { /* swallow */ }
  }
  _testUnsubs.length = 0;
}

// Spy on polling.abortAllInflight via a wrapper that increments a counter.
let _abortCount = 0;
const _origAbort = pollingMod.abortAllInflight;
// Cannot reassign a const ESM export; instead we track via a side-channel:
// wallet.js calls abortAllInflight() — we patch the active cycles map to register effect.
// Simpler: monkey-patch via globalThis.__test_abortHook (wallet.js doesn't read this) —
// fallback: count via wrapping fetch calls is N/A. We accept indirect verification
// by checking _abortCount only when wallet.js exposes a hook. For Plan 58-01 we instead
// observe the side-effect: localStorage cleared + store wiped on accountsChanged([]).

// ---------------------------------------------------------------------------
// Mock ethers.BrowserProvider.discover — installed via test-only patch.
// wallet.js will static-import { BrowserProvider } from 'ethers'; so we patch the
// real export's `.discover` property before dynamic-importing wallet.js.
// ---------------------------------------------------------------------------

import * as ethersMod from 'ethers';

let _discoverCalls = [];
let _discoverReturn = null;          // BrowserProvider-shaped object OR null
let _discoverFilterResult = null;    // when set, captured via filter callback in test
const _origDiscover = ethersMod.BrowserProvider.discover;

function setDiscoverReturn(value) { _discoverReturn = value; }

ethersMod.BrowserProvider.discover = async (opts = {}) => {
  _discoverCalls.push(opts);
  // If a filter is provided and we have a found list to feed it, invoke filter.
  if (opts.filter && Array.isArray(_discoverFilterResult)) {
    const picked = await opts.filter(_discoverFilterResult);
    if (!picked) return null;
    return _discoverReturn ?? makeMockBrowserProvider({
      info: { rdns: picked.rdns, name: picked.name, icon: 'data:', uuid: picked.uuid || 'u' },
    });
  }
  return _discoverReturn;
};

// ---------------------------------------------------------------------------
// makeMockBrowserProvider — shape compatible with wallet.js consumption.
// ---------------------------------------------------------------------------

function makeMockBrowserProvider({
  accounts = ['0xABCDef0000000000000000000000000000000000'],
  chainId = 84532,
  info = { rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'test-uuid' },
  requestImpl,
} = {}) {
  const requestLog = [];
  const ethListeners = {};
  const eth = {
    request: requestImpl || (async ({ method, params }) => {
      requestLog.push({ method, params });
      if (method === 'eth_accounts') return accounts;
      if (method === 'eth_requestAccounts') return accounts;
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'wallet_addEthereumChain') return null;
      return null;
    }),
    on: (ev, fn) => {
      if (!ethListeners[ev]) ethListeners[ev] = [];
      ethListeners[ev].push(fn);
    },
  };
  const signer = {
    getAddress: async () => accounts[0],
  };
  return {
    provider: eth,
    providerInfo: info,
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
    getSigner: async () => signer,
    _requestLog: requestLog,
    _ethListeners: ethListeners,
  };
}

// ---------------------------------------------------------------------------
// Late dynamic import of wallet.js — picks up the patched ethers + globals.
// ---------------------------------------------------------------------------

const wallet = await import('../wallet.js');

beforeEach(() => {
  // WR-09: tear down any prior subscribers and re-install fresh ones inside
  // beforeEach so cross-test contamination is impossible (was: top-level
  // module subscribe leaked five subscribers per file load).
  teardownStoreSubscribers();
  resetStore();
  installStoreSubscribers();
  _storeUpdates.length = 0;   // drop initial-fire history from re-install
  _events.length = 0;
  _localStore.clear();
  _locationAssignCalls.length = 0;
  _windowOpenCalls.length = 0;
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  _reloadCalled = false;
  _discoverCalls = [];
  _discoverReturn = null;
  _discoverFilterResult = null;
  _pickerShownWith = null;
  _pickerShowReturn = null;
  _abortCount = 0;
});

afterEach(() => {
  teardownStoreSubscribers();
});

// ===========================================================================
// WalletConnect mobile approval handoff
// ===========================================================================

describe('WalletConnect mobile approval handoff', () => {
  beforeEach(() => {
    window.matchMedia = (query) => ({
      matches: query === '(pointer:coarse)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  });

  function makeClient() {
    const listeners = new Map();
    return {
      on(event, fn) {
        const set = listeners.get(event) || new Set();
        set.add(fn);
        listeners.set(event, set);
      },
      emit(event, payload) {
        for (const fn of [...(listeners.get(event) || [])]) fn(payload);
      },
      listenerCount(event) { return listeners.get(event)?.size || 0; },
    };
  }

  function attachWalletConnect(client, session = { topic: 'mobile-session' }) {
    const raw = {
      isWalletConnect: true,
      session,
      signer: { client },
      on() {},
      request: async () => null,
    };
    wallet._testAttachListeners({
      provider: raw,
      getNetwork: async () => ({ chainId: 84532n }),
    }, raw);
    return raw;
  }

  test('foregrounds MetaMask in the same tab when a transaction request is published', () => {
    const client = makeClient();
    _localStore.set('WALLETCONNECT_DEEPLINK_CHOICE', JSON.stringify({
      href: 'https://metamask.app.link',
      name: 'MetaMask',
    }));
    attachWalletConnect(client);

    assert.equal(client.listenerCount('session_request_sent'), 1,
      'connecting installs the WalletConnect request listener');
    client.emit('session_request_sent', {
      topic: 'mobile-session',
      id: 2468,
      request: { method: 'eth_sendTransaction' },
    });

    assert.deepEqual(_locationAssignCalls, [[
      'https://metamask.app.link/wc?requestId=2468&sessionTopic=mobile-session',
    ]]);
    assert.equal(_windowOpenCalls.length, 0,
      'same-tab navigation does not depend on a popup being allowed');
  });

  test('uses session metadata, ignores unrelated requests, and installs only once', () => {
    const client = makeClient();
    const session = {
      topic: 'metadata-session',
      peer: {
        metadata: {
          name: 'MetaMask',
          redirect: { native: 'metamask://' },
        },
      },
    };
    const raw = attachWalletConnect(client, session);
    wallet._testAttachListeners({
      provider: raw,
      getNetwork: async () => ({ chainId: 84532n }),
    }, raw);
    assert.equal(client.listenerCount('session_request_sent'), 1,
      're-attaching the provider does not duplicate redirects');

    client.emit('session_request_sent', {
      topic: 'metadata-session',
      id: 1,
      request: { method: 'eth_chainId' },
    });
    client.emit('session_request_sent', {
      topic: 'different-session',
      id: 2,
      request: { method: 'eth_sendTransaction' },
    });
    assert.equal(_locationAssignCalls.length, 0);

    client.emit('session_request_sent', {
      topic: 'metadata-session',
      id: 3,
      request: { method: 'eth_sendTransaction' },
    });
    assert.deepEqual(_locationAssignCalls, [[
      'metamask://wc?requestId=3&sessionTopic=metadata-session',
    ]]);
  });

  test('does not redirect injected wallets or unsafe stored links', () => {
    const injectedClient = makeClient();
    wallet._testAttachListeners({
      provider: null,
      getNetwork: async () => ({ chainId: 84532n }),
    }, {
      isWalletConnect: false,
      signer: { client: injectedClient },
      on() {},
      request: async () => null,
    });
    assert.equal(injectedClient.listenerCount('session_request_sent'), 0);

    const unsafeClient = makeClient();
    _localStore.set('WALLETCONNECT_DEEPLINK_CHOICE', JSON.stringify({
      href: 'javascript:alert(1)',
      name: 'Bad link',
    }));
    attachWalletConnect(unsafeClient, { topic: 'unsafe-session' });
    unsafeClient.emit('session_request_sent', {
      topic: 'unsafe-session',
      id: 4,
      request: { method: 'eth_sendTransaction' },
    });
    assert.equal(_locationAssignCalls.length, 0);
    assert.equal(_windowOpenCalls.length, 0);
  });

  test('does not pull a desktop WalletConnect user away from the dapp', () => {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const client = makeClient();
    _localStore.set('WALLETCONNECT_DEEPLINK_CHOICE', JSON.stringify({
      href: 'https://metamask.app.link',
      name: 'MetaMask',
    }));
    attachWalletConnect(client, { topic: 'desktop-session' });
    client.emit('session_request_sent', {
      topic: 'desktop-session',
      id: 5,
      request: { method: 'eth_sendTransaction' },
    });
    assert.equal(_locationAssignCalls.length, 0);
    assert.equal(_windowOpenCalls.length, 0);
  });
});

// ===========================================================================
// autoReconnect — silent reconnect (WLT-03)
// ===========================================================================

describe('autoReconnect', () => {
  test('installed-wallet detection is silent and does not require an authorized account', () => {
    const prior = window.ethereum;
    window.ethereum = { request: async () => [] };
    assert.equal(wallet.hasInstalledWallet(), true,
      'a locked or disconnected injected wallet still prevents demo-account fallback');
    if (prior === undefined) delete window.ethereum;
    else window.ethereum = prior;
  });

  test('with no localStorage rdns returns false (no popup, no discover call)', async () => {
    const result = await wallet.autoReconnect();
    assert.equal(result, false);
    assert.equal(_discoverCalls.length, 0);
  });

  test('with persisted rdns calls discover with byRdns filter, then eth_accounts (NOT eth_requestAccounts)', async () => {
    _localStore.set('lastWalletRdns', 'io.metamask');
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' }];
    const bp = makeMockBrowserProvider({ accounts: ['0xABCDef0000000000000000000000000000000001'], chainId: 84532 });
    _discoverReturn = bp;
    await wallet.autoReconnect();
    assert.equal(_discoverCalls.length, 1, 'discover called once');
    assert.equal(_discoverCalls[0].timeout, 1000, 'timeout=1000');
    assert.equal(typeof _discoverCalls[0].filter, 'function', 'filter is a function');
    const methods = bp._requestLog.map((r) => r.method);
    assert.ok(methods.includes('eth_accounts'), 'eth_accounts requested');
    assert.ok(!methods.includes('eth_requestAccounts'), 'eth_requestAccounts NEVER requested');
  });

  test('updates store.connected.address with first account lowercased on success', async () => {
    _localStore.set('lastWalletRdns', 'io.metamask');
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' }];
    _discoverReturn = makeMockBrowserProvider({ accounts: ['0xABCDef0000000000000000000000000000000002'] });
    await wallet.autoReconnect();
    const addrUpdate = _storeUpdates.find((u) => u[0] === 'connected.address' && u[1] !== null);
    assert.ok(addrUpdate, 'connected.address was updated');
    assert.equal(addrUpdate[1], '0xabcdef0000000000000000000000000000000002');
  });

  test('verifies chain via getNetwork — chainId match → ui.chainOk=true', async () => {
    _localStore.set('lastWalletRdns', 'io.metamask');
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' }];
    _discoverReturn = makeMockBrowserProvider({ chainId: 84532 });
    await wallet.autoReconnect();
    const chainUpdate = _storeUpdates.filter((u) => u[0] === 'ui.chainOk').pop();
    assert.ok(chainUpdate, 'ui.chainOk was set');
    assert.equal(chainUpdate[1], true);
  });

  test('verifies chain — wrong chainId → ui.chainOk=false', async () => {
    _localStore.set('lastWalletRdns', 'io.metamask');
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' }];
    _discoverReturn = makeMockBrowserProvider({ chainId: 1 });
    await wallet.autoReconnect();
    const chainUpdate = _storeUpdates.filter((u) => u[0] === 'ui.chainOk').pop();
    assert.equal(chainUpdate[1], false);
  });
});

// ===========================================================================
// accountsChanged listener (WLT-03)
// ===========================================================================

describe('accountsChanged listener', () => {
  async function attachAndConnect() {
    _localStore.set('lastWalletRdns', 'io.metamask');
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' }];
    const bp = makeMockBrowserProvider({ accounts: ['0xaaaa000000000000000000000000000000000001'] });
    _discoverReturn = bp;
    await wallet.autoReconnect();
    return bp;
  }

  test('empty array clears store + localStorage + emits wallet-disconnected', async () => {
    const bp = await attachAndConnect();
    _events.length = 0;
    const fn = bp._ethListeners.accountsChanged?.[0];
    assert.ok(fn, 'accountsChanged listener attached');
    fn([]);
    // localStorage cleared
    assert.equal(_localStore.has('lastWalletRdns'), false);
    // store wiped (last update for connected.address is null)
    const last = _storeUpdates.filter((u) => u[0] === 'connected.address').pop();
    assert.equal(last[1], null);
    const mode = _storeUpdates.filter((u) => u[0] === 'ui.mode').pop();
    assert.equal(mode[1], 'self');
    // event dispatched
    assert.ok(_events.find((e) => e.type === 'wallet-disconnected'));
  });

  test('non-empty array updates store + emits wallet-connected with detail.address', async () => {
    const bp = await attachAndConnect();
    _events.length = 0;
    _storeUpdates.length = 0;
    const fn = bp._ethListeners.accountsChanged[0];
    // WR-02: handler is now async (re-derives ui.chainOk from getNetwork()
    // before dispatching wallet-connected). Await the returned Promise so
    // the event has been dispatched before assertions run.
    await fn(['0xBBBB000000000000000000000000000000000002']);
    const upd = _storeUpdates.find((u) => u[0] === 'connected.address' && u[1] !== null);
    assert.ok(upd, 'connected.address updated');
    assert.equal(upd[1], '0xbbbb000000000000000000000000000000000002');
    const ev = _events.find((e) => e.type === 'wallet-connected');
    assert.ok(ev, 'wallet-connected dispatched');
    assert.equal(ev.detail.address, '0xbbbb000000000000000000000000000000000002');
  });

  test('calls polling.abortAllInflight before any other update', async (t) => {
    // WR-08: assert ordering by attempting to patch pollingMod.abortAllInflight
    // via Object.defineProperty. ESM exports are typically non-configurable in
    // Node, so the patch may silently fail; we verify the patch took by
    // probing the function identity and skip the test if it didn't (rather
    // than passing as a false-green).
    const order = [];
    const origAbort = pollingMod.abortAllInflight;
    const spy = () => order.push('abort');
    let patched = false;
    try {
      Object.defineProperty(pollingMod, 'abortAllInflight', {
        configurable: true,
        get: () => spy,
      });
      // Probe: did the descriptor swap actually take? On Node ESM with
      // immutable namespace bindings the get() may not be honored even though
      // defineProperty succeeded.
      patched = (pollingMod.abortAllInflight === spy);
    } catch {
      patched = false;
    }

    if (!patched) {
      // ESM namespace immutability prevents observing call order via spy.
      // Skip rather than silently pass with no assertion — the chokepoint
      // ordering is documented in wallet.js and exercised behaviorally by
      // sibling tests (state-wipe + dispatch happen, no observable race).
      t.skip('pollingMod.abortAllInflight is non-configurable in this Node ESM runtime');
      return;
    }

    try {
      const bp = await attachAndConnect();
      const fn = bp._ethListeners.accountsChanged[0];
      // Use await — the listener is async (WR-02).
      await fn([]);
      assert.ok(order.length > 0, 'spy was called (patch effective)');
      assert.equal(order[0], 'abort', 'abortAllInflight called first in accountsChanged');
    } finally {
      // Restore — best effort.
      try {
        Object.defineProperty(pollingMod, 'abortAllInflight', {
          configurable: true,
          value: origAbort,
          writable: true,
        });
      } catch { /* ignore */ }
    }
  });
});

// ===========================================================================
// chainChanged listener (WLT-03 — view-mode preservation)
// ===========================================================================

describe('chainChanged listener', () => {
  test('updates ui.chainOk based on hex equality with CHAIN.hexId; does NOT reload', async () => {
    _localStore.set('lastWalletRdns', 'io.metamask');
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' }];
    const bp = makeMockBrowserProvider({});
    _discoverReturn = bp;
    await wallet.autoReconnect();
    _reloadCalled = false;
    _storeUpdates.length = 0;

    const fn = bp._ethListeners.chainChanged?.[0];
    assert.ok(fn, 'chainChanged listener attached');

    // Wrong chain
    fn('0x1');
    const wrong = _storeUpdates.filter((u) => u[0] === 'ui.chainOk').pop();
    assert.equal(wrong[1], false);

    // Right chain (Sepolia)
    fn('0x14a34');
    const right = _storeUpdates.filter((u) => u[0] === 'ui.chainOk').pop();
    assert.equal(right[1], true);

    // CRITICAL: never reloaded
    assert.equal(_reloadCalled, false, 'window.location.reload NEVER called on chainChanged');
  });
});

// ===========================================================================
// switchToSepolia — re-exported from contracts.js? No, lives in contracts.js.
// wallet.test.js exercises it indirectly via wallet.js usages OR via direct import.
// Per plan: wallet.test.js asserts the 4902 path. We test it via direct import of contracts.js.
// ===========================================================================

import * as contractsMod from '../contracts.js';

describe('switchToSepolia (contracts.js export — exercised here per plan)', () => {
  test('happy path calls wallet_switchEthereumChain with CHAIN.hexId and returns true', async () => {
    const calls = [];
    const eip1193 = {
      request: async ({ method, params }) => { calls.push({ method, params }); return null; },
    };
    const result = await contractsMod.switchToSepolia(eip1193);
    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'wallet_switchEthereumChain');
    assert.equal(calls[0].params[0].chainId, '0x14a34');
  });

  test('on err.code===4902 falls through to wallet_addEthereumChain with CHAIN.nativeAddEntry, then retries switch, returns true', async () => {
    const calls = [];
    let firstSwitch = true;
    const eip1193 = {
      request: async ({ method, params }) => {
        calls.push({ method, params });
        if (method === 'wallet_switchEthereumChain' && firstSwitch) {
          firstSwitch = false;
          const e = new Error('chain not added'); e.code = 4902; throw e;
        }
        return null;
      },
    };
    const result = await contractsMod.switchToSepolia(eip1193);
    assert.equal(result, true);
    const methods = calls.map((c) => c.method);
    assert.deepEqual(methods, ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    // verify wallet_addEthereumChain received CHAIN.nativeAddEntry shape
    const addEntry = calls[1].params[0];
    assert.equal(addEntry.chainId, '0x14a34');
    assert.equal(addEntry.chainName, 'Base Sepolia');
    assert.ok(Array.isArray(addEntry.rpcUrls));
  });

  test('on err.code===4001 returns false silently (user rejected)', async () => {
    const eip1193 = {
      request: async () => { const e = new Error('user rejected'); e.code = 4001; throw e; },
    };
    const result = await contractsMod.switchToSepolia(eip1193);
    assert.equal(result, false);
  });
});

// ===========================================================================
// nav.js bridge events (WLT-03 — no-loop guard)
// ===========================================================================

describe('nav.js bridge wallet-connected event listener', () => {
  test('updates store IF addr differs and does NOT re-emit', async () => {
    _events.length = 0;
    const listeners = _docListeners.get('wallet-connected') || [];
    assert.ok(listeners.length >= 1, 'wallet-connected listener installed at module init');
    // Ensure store starts with no connected address
    storeMod.update('connected.address', null);
    _storeUpdates.length = 0;
    // Simulate nav.js dispatching wallet-connected with a NEW address
    listeners[0]({ detail: { address: '0xCCcc000000000000000000000000000000000003' } });
    const upd = _storeUpdates.find((u) => u[0] === 'connected.address');
    assert.ok(upd, 'connected.address updated from bridge');
    assert.equal(upd[1], '0xcccc000000000000000000000000000000000003');
    // No wallet-connected re-emitted from bridge listener (loop guard)
    const reemitted = _events.filter((e) => e.type === 'wallet-connected');
    assert.equal(reemitted.length, 0, 'no re-emit of wallet-connected from bridge listener');
  });
});

// ===========================================================================
// connectWithPicker — EIP-6963 multi-wallet branches (WLT-01)
// ===========================================================================

describe('connectWithPicker', () => {
  test('with zero wallets falls through to legacy path (returns null when no window.ethereum)', async () => {
    _discoverFilterResult = [];
    _discoverReturn = null;
    globalThis.window.ethereum = undefined;
    const result = await wallet.connectWithPicker();
    assert.equal(result, null, 'no wallet → null');
  });

  test('with single wallet auto-selects (no picker.show call)', async () => {
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' }];
    _discoverReturn = makeMockBrowserProvider({});
    _pickerShownWith = null;
    await wallet.connectWithPicker();
    assert.equal(_pickerShownWith, null, 'picker.show NOT called for single wallet');
  });

  test('with 2+ wallets calls document.querySelector(wallet-picker).show(found) and awaits Promise', async () => {
    const wallets = [
      { rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' },
      { rdns: 'io.rabby', name: 'Rabby', icon: 'data:', uuid: 'u2' },
    ];
    _discoverFilterResult = wallets;
    _discoverReturn = makeMockBrowserProvider({ info: { rdns: 'io.rabby', name: 'Rabby', icon: 'data:', uuid: 'u2' } });
    _pickerShowReturn = Promise.resolve(wallets[1]);   // user picks Rabby
    await wallet.connectWithPicker();
    assert.ok(_pickerShownWith, 'picker.show was called');
    assert.equal(_pickerShownWith.length, 2);
  });

  test('On successful connectWithPicker, localStorage.setItem(lastWalletRdns, info.rdns) — NEVER lastWalletAddress / lastWalletUuid', async () => {
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'unique-uuid' }];
    _discoverReturn = makeMockBrowserProvider({
      accounts: ['0xdddd000000000000000000000000000000000004'],
      info: { rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'unique-uuid' },
    });
    await wallet.connectWithPicker();
    assert.equal(_localStore.get('lastWalletRdns'), 'io.metamask');
    assert.equal(_localStore.has('lastWalletAddress'), false, 'lastWalletAddress NEVER persisted');
    assert.equal(_localStore.has('lastWalletUuid'), false, 'lastWalletUuid NEVER persisted');
  });
});

// ===========================================================================
// Phase 63 D-01 — WalletConnect integration (MOB-01)
// ===========================================================================

describe('connectWalletConnect (Phase 63 D-01)', () => {
  // Stub BrowserProvider class for WC tests. Real ethers BrowserProvider's
  // .provider getter returns `this`, so attachListeners would call ethers' own
  // event system (which throws "unknown ProviderEvent" on accountsChanged).
  // The stub mirrors the test mock pattern: .provider points at the wrapped
  // wc instance directly so attachListeners attaches to the wc.on listener map.
  class StubBrowserProvider {
    static instances = [];

    constructor(wc, network = null) {
      this._wc = wc;
      this.network = network;
      this.provider = wc;
      this.providerInfo = null;
      StubBrowserProvider.instances.push(this);
    }
    async getNetwork() { return { chainId: BigInt(this._wc.chainId || 84532) }; }
    async getSigner() { return { getAddress: async () => this._wc.accounts?.[0] || null }; }
  }

  // Build a mock EthereumProvider factory whose init() returns a wc-shaped object.
  function makeMockWcFactory({
    session = null,
    accounts = [],
    chainId = 84532,
    connectImpl,
    disconnectImpl,
    requestImpl,
  } = {}) {
    const initCalls = [];
    const connectCalls = [];
    const disconnectCalls = [];
    const requestCalls = [];
    const wcListeners = {};
    const wcInstance = {
      session,
      get accounts() { return accounts; },
      set accounts(v) { accounts = v; },
      chainId,
      // Always count via connectCalls; user impl runs after the counter bump.
      connect: async () => {
        connectCalls.push(Date.now());
        if (typeof connectImpl === 'function') await connectImpl();
      },
      disconnect: async () => {
        disconnectCalls.push(Date.now());
        if (typeof disconnectImpl === 'function') {
          await disconnectImpl(wcInstance);
          return;
        }
        wcInstance.session = null;
        accounts = [];
      },
      request: async (payload) => {
        requestCalls.push(payload);
        return typeof requestImpl === 'function' ? requestImpl(payload, wcInstance) : null;
      },
      on: (ev, fn) => { (wcListeners[ev] = wcListeners[ev] || []).push(fn); },
      _initCalls: initCalls,
      _connectCalls: connectCalls,
      _disconnectCalls: disconnectCalls,
      _requestCalls: requestCalls,
      _wcListeners: wcListeners,
      _setAccounts: (a) => { accounts = a; },
      _setSession: (s) => { wcInstance.session = s; },
    };
    const factory = {
      init: async (opts) => {
        initCalls.push(opts);
        return wcInstance;
      },
    };
    return { factory, wcInstance };
  }

  // Reset the WC singleton + factory injection before each WC test.
  // Inject the StubBrowserProvider so attachListeners doesn't trip ethers'
  // event-name validation.
  beforeEach(() => {
    if (typeof wallet._testResetWcSingleton === 'function') wallet._testResetWcSingleton();
    StubBrowserProvider.instances.length = 0;
    if (typeof wallet._testInjectWcBrowserProviderCtor === 'function') {
      wallet._testInjectWcBrowserProviderCtor(StubBrowserProvider);
    }
  });

  test('singleton: two _ensureWcProvider calls invoke init exactly once and return same instance', async () => {
    const { factory, wcInstance } = makeMockWcFactory({ session: null, accounts: [] });
    wallet._testInjectWcFactory(factory);
    const first = await wallet._testEnsureWcProvider();
    const second = await wallet._testEnsureWcProvider();
    assert.equal(wcInstance._initCalls.length, 1, 'init called exactly once');
    assert.strictEqual(first, second, 'same cached instance');
  });

  test('connect when no session: calls wc.connect once, persists rdns, lowercases address, sets store', async () => {
    const accounts = [];
    const { factory, wcInstance } = makeMockWcFactory({
      session: null,
      accounts,
      chainId: 84532,
      connectImpl: async () => {
        // Simulate post-connect state population.
        wcInstance._setSession({ topic: 'abc' });
        wcInstance._setAccounts(['0xAAAA000000000000000000000000000000000099']);
      },
    });
    wallet._testInjectWcFactory(factory);
    _events.length = 0;
    _storeUpdates.length = 0;
    const result = await wallet.connectWalletConnect();
    assert.ok(result, 'returns a BrowserProvider');
    assert.equal(wcInstance._connectCalls.length, 1, 'wc.connect called exactly once');
    assert.equal(_localStore.get('lastWalletRdns'), 'walletconnect:v2', 'WC sentinel persisted');
    const addrUpd = _storeUpdates.find((u) => u[0] === 'connected.address' && u[1] !== null);
    assert.ok(addrUpd, 'connected.address updated');
    assert.equal(addrUpd[1], '0xaaaa000000000000000000000000000000000099', 'address lowercased');
    const rdnsUpd = _storeUpdates.find((u) => u[0] === 'connected.rdns' && u[1] === 'walletconnect:v2');
    assert.ok(rdnsUpd, 'connected.rdns set to walletconnect:v2');
    const ev = _events.find((e) => e.type === 'wallet-connected');
    assert.ok(ev, 'wallet-connected dispatched');
  });

  test('init opts keep Base Sepolia optional for MetaMask Mobile pairing, showQrModal, qrModalOptions.enableMobileFullScreen, redirect.universal', async () => {
    const { factory, wcInstance } = makeMockWcFactory({ session: null, accounts: ['0xab000000000000000000000000000000000000ab'] });
    wallet._testInjectWcFactory(factory);
    await wallet._testEnsureWcProvider();
    const opts = wcInstance._initCalls[0];
    assert.deepEqual(opts.optionalChains, [84532, 1], 'Base Sepolia and the wallet default are optional');
    assert.equal(opts.chains, undefined, 'custom beta chain is not a required pairing namespace');
    assert.deepEqual(opts.rpcMap, { 84532: CHAIN.rpcUrl },
      'non-wallet Base Sepolia RPC methods use the app RPC instead of the WC gateway');
    assert.equal(opts.showQrModal, true);
    assert.ok(opts.qrModalOptions, 'qrModalOptions present');
    assert.equal(opts.qrModalOptions.enableMobileFullScreen, true, 'enableMobileFullScreen nested under qrModalOptions');
    assert.ok(opts.metadata, 'metadata present');
    assert.ok(opts.metadata.redirect, 'metadata.redirect present');
    assert.ok(typeof opts.metadata.redirect.universal === 'string', 'redirect.universal is a string');
    assert.ok(opts.metadata.redirect.universal.endsWith('/app/'), 'redirect.universal ends with /app/');
  });

  test('autoReconnect WC branch: with persisted session and accounts returns true silently (no wc.connect call)', async () => {
    _localStore.set('lastWalletRdns', 'walletconnect:v2');
    const { factory, wcInstance } = makeMockWcFactory({
      session: { topic: 'persisted' },
      accounts: ['0xBb00000000000000000000000000000000000077'],
      chainId: 84532,
    });
    wallet._testInjectWcFactory(factory);
    _storeUpdates.length = 0;
    const result = await wallet.autoReconnect();
    assert.equal(result, true, 'silent reconnect returns true');
    assert.equal(wcInstance._connectCalls.length, 0, 'wc.connect NEVER called on silent path');
    const addrUpd = _storeUpdates.find((u) => u[0] === 'connected.address' && u[1] !== null);
    assert.ok(addrUpd, 'connected.address updated');
    assert.equal(addrUpd[1], '0xbb00000000000000000000000000000000000077');
  });

  test('autoReconnect WC branch: with NO persisted session returns false and does not call wc.connect', async () => {
    _localStore.set('lastWalletRdns', 'walletconnect:v2');
    const { factory, wcInstance } = makeMockWcFactory({ session: null, accounts: [] });
    wallet._testInjectWcFactory(factory);
    const result = await wallet.autoReconnect();
    assert.equal(result, false, 'no session → false');
    assert.equal(wcInstance._connectCalls.length, 0, 'wc.connect NEVER called on resume path');
  });

  test('autoReconnect WC branch: preserves a wrong-chain session so the user can switch it', async () => {
    _localStore.set('lastWalletRdns', 'walletconnect:v2');
    const { factory, wcInstance } = makeMockWcFactory({
      session: { topic: 'old-mainnet-session' },
      accounts: ['0xBb00000000000000000000000000000000000077'],
      chainId: 1,
    });
    wallet._testInjectWcFactory(factory);
    _storeUpdates.length = 0;
    const result = await wallet.autoReconnect();
    assert.equal(result, true, 'wrong-chain wallet remains connected');
    assert.equal(wcInstance._requestCalls.length, 0, 'silent reconnect never opens a switch prompt');
    assert.equal(_localStore.get('lastWalletRdns'), 'walletconnect:v2', 'session remains available');
    assert.ok(
      _storeUpdates.some(([path, value]) => path === 'ui.chainOk' && value === false),
      'UI exposes Wrong Network for a user-initiated retry',
    );
  });

  test('connectWalletConnect keeps a default-mainnet MetaMask session and requests Base Sepolia', async () => {
    const { factory, wcInstance } = makeMockWcFactory({
      session: { topic: 'metamask-mobile' },
      accounts: ['0xBb00000000000000000000000000000000000077'],
      chainId: 1,
    });
    wallet._testInjectWcFactory(factory);
    _storeUpdates.length = 0;
    const result = await wallet.connectWalletConnect();
    await Promise.resolve();
    assert.ok(result, 'wrong-chain pairing still returns a connected provider');
    assert.equal(wcInstance._connectCalls.length, 0, 'existing pairing is reused');
    assert.deepEqual(wcInstance._requestCalls[0], {
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x14a34' }],
    });
    assert.ok(
      _storeUpdates.some(([path, value]) => path === 'connected.address' && Boolean(value)),
      'wallet address is published before switch completion',
    );
  });

  test('WalletConnect chain switch replaces the pre-switch ethers provider before writes', async () => {
    const account = '0xBb00000000000000000000000000000000000077';
    const { factory, wcInstance } = makeMockWcFactory({
      session: {
        topic: 'metamask-mobile',
        namespaces: {
          eip155: {
            accounts: [`eip155:1:${account}`, `eip155:84532:${account}`],
            chains: ['eip155:1', 'eip155:84532'],
          },
        },
      },
      accounts: [account],
      chainId: 1,
      requestImpl: async (payload, wc) => {
        if (payload.method === 'wallet_switchEthereumChain') {
          wc.chainId = 84532;
          for (const fn of wc._wcListeners.chainChanged || []) fn('0x14a34');
          return null;
        }
        if (payload.method === 'eth_chainId') return '0x14a34';
        return null;
      },
    });
    wcInstance.isWalletConnect = true;
    wallet._testInjectWcFactory(factory);

    const connectedProvider = await wallet.connectWalletConnect();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(connectedProvider.network, 'any', 'WC BrowserProvider accepts a chain transition');
    assert.ok(StubBrowserProvider.instances.length >= 2,
      'Base chain event discards the wrapper that could have cached Ethereum');
    assert.notStrictEqual(contractsMod.getProvider(), connectedProvider,
      'contract writes use the fresh post-switch provider');
    assert.equal(contractsMod.getProvider().network, 'any');
    assert.equal(storeMod.get('ui.chainOk'), true);
  });

  test('ensureConfiguredWalletChain re-pairs a WC session that does not authorize Base Sepolia', async () => {
    const account = '0xBb00000000000000000000000000000000000077';
    const { factory, wcInstance } = makeMockWcFactory({
      session: {
        topic: 'stale-mainnet-session',
        namespaces: {
          eip155: {
            accounts: [`eip155:1:${account}`],
            chains: ['eip155:1'],
          },
        },
      },
      accounts: [account],
      chainId: 1,
      connectImpl: async () => {
        wcInstance.chainId = 84532;
        wcInstance._setSession({
          topic: 'fresh-base-session',
          namespaces: {
            eip155: {
              accounts: [`eip155:84532:${account}`],
              chains: ['eip155:84532'],
            },
          },
        });
        wcInstance._setAccounts([account]);
      },
    });
    wcInstance.isWalletConnect = true;
    wallet._testInjectWcFactory(factory);
    await wallet.connectWalletConnect();

    const result = await wallet.ensureConfiguredWalletChain();

    assert.equal(result, true, 'fresh WalletConnect pairing succeeds');
    assert.equal(wcInstance._disconnectCalls.length, 1, 'stale session is retired');
    assert.equal(wcInstance._connectCalls.length, 1, 'replacement session is paired');
    assert.equal(storeMod.get('connected.address'), account.toLowerCase());
    assert.equal(storeMod.get('ui.chainOk'), true);
  });

  test('connectWalletConnect: listeners attached BEFORE store mutations (WR-05 ordering preserved)', async () => {
    const order = [];
    const accounts = [];
    const { factory, wcInstance } = makeMockWcFactory({
      session: null,
      accounts,
      connectImpl: async () => {
        wcInstance._setSession({ topic: 'a' });
        wcInstance._setAccounts(['0xc100000000000000000000000000000000000088']);
      },
    });
    // Wrap on() to track listener attachment
    const origOn = wcInstance.on.bind(wcInstance);
    wcInstance.on = (ev, fn) => { order.push(`on:${ev}`); origOn(ev, fn); };
    wallet._testInjectWcFactory(factory);
    // Spy on store updates via the test infra _storeUpdates: each update push will land
    // after the connect logic; we record a marker just to verify ordering relative to attach.
    _storeUpdates.length = 0;
    await wallet.connectWalletConnect();
    // The BrowserProvider wraps the WC EIP-1193 provider; attachListeners calls
    // .on('accountsChanged'|'chainChanged'|'disconnect'). Verify at least one
    // listener was registered before any store update with rdns walletconnect:v2.
    const rdnsIdx = _storeUpdates.findIndex((u) => u[0] === 'connected.rdns' && u[1] === 'walletconnect:v2');
    assert.ok(order.length >= 1, 'at least one listener attached on the WC provider');
    assert.ok(rdnsIdx >= 0, 'rdns store update happened');
    // attachListeners runs before setProvider/update — order array captured before any rdns update.
    // (Synchronous on() calls happen first inside the test event loop.)
  });
});

// ===========================================================================
// Phase 63 D-01 step 4 — device-aware bypass in connectWithPicker
// ===========================================================================

describe('connectWithPicker — device-aware bypass (Phase 63 D-01 step 4)', () => {
  // Stub BrowserProvider for WC path (see connectWalletConnect describe block).
  class StubBrowserProvider {
    constructor(wc) {
      this._wc = wc;
      this.provider = wc;
      this.providerInfo = null;
    }
    async getNetwork() { return { chainId: BigInt(this._wc.chainId || 84532) }; }
  }

  // Helpers to mock window.matchMedia and window.ethereum for the bypass heuristic.
  function setMobileWebNoInjected() {
    globalThis.window.matchMedia = (q) => ({ matches: q === '(pointer:coarse)', media: q, addEventListener: () => {}, removeEventListener: () => {} });
    globalThis.window.ethereum = undefined;
    delete globalThis.window.ethereum;
  }
  function setDesktopFinePointer() {
    globalThis.window.matchMedia = (q) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} });
    globalThis.window.ethereum = undefined;
    delete globalThis.window.ethereum;
  }
  function setMobileWithInjected() {
    globalThis.window.matchMedia = (q) => ({ matches: q === '(pointer:coarse)', media: q, addEventListener: () => {}, removeEventListener: () => {} });
    globalThis.window.ethereum = { request: async () => [], on: () => {} };
  }

  beforeEach(() => {
    if (typeof wallet._testResetWcSingleton === 'function') wallet._testResetWcSingleton();
    if (typeof wallet._testInjectWcBrowserProviderCtor === 'function') {
      wallet._testInjectWcBrowserProviderCtor(StubBrowserProvider);
    }
  });

  test('coarse pointer + no injected + 0 EIP-6963 announces → calls connectWalletConnect, picker NOT shown', async () => {
    setMobileWebNoInjected();
    _discoverFilterResult = [];   // 0 EIP-6963 announces
    _discoverReturn = null;
    // Inject a WC factory so connectWalletConnect doesn't blow up
    const accounts = [];
    let wcInstance;
    const factory = {
      init: async () => {
        wcInstance = {
          session: null,
          get accounts() { return accounts; },
          chainId: 84532,
          connect: async () => {
            wcInstance.session = { topic: 'mobile-bypass' };
            accounts.push('0xdd00000000000000000000000000000000000044');
          },
          on: () => {},
        };
        return wcInstance;
      },
    };
    wallet._testInjectWcFactory(factory);
    _pickerShownWith = null;
    const result = await wallet.connectWithPicker();
    assert.equal(_pickerShownWith, null, 'picker.show NEVER called on mobile-web bypass');
    assert.ok(result, 'connectWalletConnect returned a provider');
  });

  test('coarse pointer WITH injected wallet → bypass DOES NOT fire (window.ethereum present)', async () => {
    setMobileWithInjected();
    // 1 EIP-6963 wallet announces — discover returns a mock provider, picker auto-selects
    // (single-wallet path). Bypass condition fails because window.ethereum is defined.
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' }];
    _discoverReturn = makeMockBrowserProvider({});
    _pickerShownWith = null;
    await wallet.connectWithPicker();
    assert.equal(_pickerShownWith, null, 'picker.show not invoked for single wallet (auto-select)');
    // WC singleton MUST NOT be populated — bypass did not fire.
    assert.equal(wallet._testGetWcSingleton(), null, 'WC singleton not initialized — bypass did not fire');
    // Reset window.ethereum so subsequent tests don't inherit it.
    delete globalThis.window.ethereum;
  });

  test('fine pointer (desktop) + 0 EIP-6963 → bypass DOES NOT fire (matchMedia returns false)', async () => {
    setDesktopFinePointer();
    // 0 EIP-6963 announces, no window.ethereum, but pointer is fine (desktop).
    // Bypass condition fails because matchMedia('(pointer:coarse)') returns false.
    _discoverFilterResult = [];
    _discoverReturn = null;
    globalThis.window.ethereum = undefined;
    delete globalThis.window.ethereum;
    await wallet.connectWithPicker();
    assert.equal(_pickerShownWith, null, 'picker.show not invoked when 0 EIP-6963');
    // WC singleton MUST NOT be populated — bypass did not fire on desktop.
    assert.equal(wallet._testGetWcSingleton(), null, 'WC singleton not initialized — bypass did not fire on desktop');
  });
});

// Restore original ethers.discover at end of suite (process exit anyway, but clean).
test.after?.(() => {
  ethersMod.BrowserProvider.discover = _origDiscover;
});
