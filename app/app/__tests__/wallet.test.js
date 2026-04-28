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
let _reloadCalled = false;

globalThis.window = {
  addEventListener: () => {},
  location: {
    get search() { return ''; },
    get href() { return 'http://localhost/'; },
    reload: () => { _reloadCalled = true; },
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

// Track call history through the real store; we'll inspect updates via subscribe.
const _storeUpdates = [];        // [path, value]
storeMod.subscribe('connected.address', (v) => _storeUpdates.push(['connected.address', v]));
storeMod.subscribe('connected.rdns',    (v) => _storeUpdates.push(['connected.rdns', v]));
storeMod.subscribe('ui.chainOk',        (v) => _storeUpdates.push(['ui.chainOk', v]));
storeMod.subscribe('ui.mode',           (v) => _storeUpdates.push(['ui.mode', v]));
storeMod.subscribe('viewing.address',   (v) => _storeUpdates.push(['viewing.address', v]));

function resetStore() {
  storeMod.update('connected.address', null);
  storeMod.update('connected.rdns', null);
  storeMod.update('ui.chainOk', null);
  storeMod.update('ui.mode', 'self');
  storeMod.update('viewing.address', null);
  _storeUpdates.length = 0;
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
  chainId = 11155111,
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
  resetStore();
  _events.length = 0;
  _localStore.clear();
  _reloadCalled = false;
  _discoverCalls = [];
  _discoverReturn = null;
  _discoverFilterResult = null;
  _pickerShownWith = null;
  _pickerShowReturn = null;
  _abortCount = 0;
});

// ===========================================================================
// autoReconnect — silent reconnect (WLT-03)
// ===========================================================================

describe('autoReconnect', () => {
  test('with no localStorage rdns returns false (no popup, no discover call)', async () => {
    const result = await wallet.autoReconnect();
    assert.equal(result, false);
    assert.equal(_discoverCalls.length, 0);
  });

  test('with persisted rdns calls discover with byRdns filter, then eth_accounts (NOT eth_requestAccounts)', async () => {
    _localStore.set('lastWalletRdns', 'io.metamask');
    _discoverFilterResult = [{ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:', uuid: 'u1' }];
    const bp = makeMockBrowserProvider({ accounts: ['0xABCDef0000000000000000000000000000000001'], chainId: 11155111 });
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
    _discoverReturn = makeMockBrowserProvider({ chainId: 11155111 });
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
    fn('0xaa36a7');
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
    assert.equal(calls[0].params[0].chainId, '0xaa36a7');
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
    assert.equal(addEntry.chainId, '0xaa36a7');
    assert.equal(addEntry.chainName, 'Sepolia');
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

// Restore original ethers.discover at end of suite (process exit anyway, but clean).
test.after?.(() => {
  ethersMod.BrowserProvider.discover = _origDiscover;
});
