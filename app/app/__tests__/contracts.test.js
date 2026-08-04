// /app/app/__tests__/contracts.test.js — Phase 58 Plan 01 unit (WLT-04 chokepoint).
//
// Run: cd website && node --test app/app/__tests__/contracts.test.js
//
// Covers:
//   - requireSelf throws on view-mode + on connected≠viewing + on missing connection
//   - sendTx aborts BEFORE provider.getSigner() in view-mode (devtools-bypass defense)
//   - sendTx wrong-chain throws BEFORE getSigner
//   - sendTx re-derives signer EVERY call (no module-level cache)
//   - sendTx throws "Account changed mid-flow" when signer.getAddress mismatches connected
//   - sendTx receipt.status===0 → throws "Reverted" (preserves /beta/mint.js bug-class fix)
//   - sendTx passes the FRESH signer to buildTx callback (not a captured one)
//   - assertChainOrBlank returns true when _provider is null
//   - assertChain throws when _provider chainId !== CHAIN.id

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal globals (contracts.js does not touch window/document directly,
// but we keep parity with wallet.test.js so the live store.js + polling.js
// modules import cleanly).
// ---------------------------------------------------------------------------

if (typeof globalThis.window === 'undefined') {
  globalThis.window = { addEventListener: () => {} };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
}
if (typeof globalThis.localStorage === 'undefined') {
  const _ls = new Map();
  globalThis.localStorage = {
    getItem: (k) => _ls.has(k) ? _ls.get(k) : null,
    setItem: (k, v) => { _ls.set(k, String(v)); },
    removeItem: (k) => { _ls.delete(k); },
  };
}

// ---------------------------------------------------------------------------
// Live store + contracts modules — store.js is shipped as a minimal shim by
// plan 58-01 (rule-3 deviation: blocking on missing module); plan 58-02 will
// extend the schema. The test resets store state before each case.
// ---------------------------------------------------------------------------

import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';

const {
  setProvider, clearProvider, requireSelf, sendTx, assertChain, assertChainOrBlank,
  gasEstimateWithHeadroom,
} = contractsMod;

function resetStore() {
  storeMod.update('connected.address', null);
  storeMod.update('connected.rdns', null);
  storeMod.update('viewing.address', null);
  storeMod.update('ui.mode', 'self');
  storeMod.update('ui.chainOk', null);
}

// ---------------------------------------------------------------------------
// Mock provider helpers
// ---------------------------------------------------------------------------

function makeProvider({
  chainId = 84532,
  signerAddress = '0xabcdef0000000000000000000000000000000000',
  receiptStatus = 1,
  txHash = '0xdeadbeef',
} = {}) {
  let getSignerCalls = 0;
  let signerObj = null;
  return {
    getSignerCallCount: () => getSignerCalls,
    lastSigner: () => signerObj,
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
    getSigner: async () => {
      getSignerCalls += 1;
      signerObj = {
        getAddress: async () => signerAddress,
        _id: getSignerCalls, // distinct identity per call to verify re-derivation
      };
      return signerObj;
    },
    _txReceiptStatus: receiptStatus,
    _txHash: txHash,
  };
}

beforeEach(() => {
  resetStore();
  clearProvider();
});

// ===========================================================================
// requireSelf — chokepoint (WLT-04)
// ===========================================================================

describe('requireSelf chokepoint', () => {
  test('throws when ui.mode === "view"', () => {
    storeMod.update('ui.mode', 'view');
    storeMod.update('connected.address', '0xaaaa000000000000000000000000000000000001');
    assert.throws(() => requireSelf(), /Read-only mode/);
  });

  test('throws when connected.address is null (Wallet not connected)', () => {
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', null);
    assert.throws(() => requireSelf(), /Wallet not connected/);
  });

  test('throws when viewing.address !== connected.address (case-insensitive)', () => {
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xAAAA000000000000000000000000000000000001');
    storeMod.update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    assert.throws(() => requireSelf(), /Connected wallet does not match viewing target/);
  });

  test('returns true when ui.mode==="self" AND connected matches viewing (or viewing null)', () => {
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xAAAA000000000000000000000000000000000001');
    // viewing null
    storeMod.update('viewing.address', null);
    assert.equal(requireSelf(), true);
    // viewing matches (different case)
    storeMod.update('viewing.address', '0xaaaa000000000000000000000000000000000001');
    assert.equal(requireSelf(), true);
  });

  // --- operator-mode + combined-mode extension (account-switcher CORE layer) ---

  test('operator mode: returns true even though viewing !== connected (approved operator)', () => {
    // In 'operator' mode the connected wallet is an approved operator acting for
    // the viewed owner, so the viewing!==connected mismatch throw is SKIPPED.
    storeMod.update('ui.mode', 'operator');
    storeMod.update('connected.address', '0xAAAA000000000000000000000000000000000001');
    storeMod.update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    assert.equal(requireSelf(), true);
  });

  test('combined mode: throws "Combined view is read-only"', () => {
    storeMod.update('ui.mode', 'combined');
    storeMod.update('connected.address', '0xAAAA000000000000000000000000000000000001');
    assert.throws(() => requireSelf(), /Combined view is read-only/);
  });

  test('view-mode throw message is unchanged by the extension', () => {
    storeMod.update('ui.mode', 'view');
    storeMod.update('connected.address', '0xaaaa000000000000000000000000000000000001');
    storeMod.update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    assert.throws(() => requireSelf(), /Read-only mode — cannot sign transactions/);
  });
});

// ===========================================================================
// sendTx operator pass-through / combined block (account-switcher CORE layer)
// ===========================================================================

describe('sendTx operator + combined modes', () => {
  test('operator mode: sendTx proceeds to getSigner (chokepoint does NOT block)', async () => {
    const provider = makeProvider({ signerAddress: '0xabcdef0000000000000000000000000000000000' });
    setProvider(provider);
    // connected = operator (the signer); viewing = owner acted for.
    storeMod.update('ui.mode', 'operator');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    storeMod.update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    const buildTx = (s) => Promise.resolve({ hash: '0x', wait: async () => ({ status: 1 }) });
    const receipt = await sendTx(buildTx, 'operator-act');
    assert.equal(receipt.status, 1);
    // freshAddress guard is pinned to the CONNECTED operator (correct — operator signs).
    assert.equal(provider.getSignerCallCount(), 1);
  });

  test('combined mode: sendTx aborts BEFORE getSigner with the combined message', async () => {
    const provider = makeProvider();
    setProvider(provider);
    storeMod.update('ui.mode', 'combined');
    storeMod.update('connected.address', '0xaaaa000000000000000000000000000000000001');
    await assert.rejects(sendTx(() => Promise.resolve({}), 'x'), /Combined view is read-only/);
    assert.equal(provider.getSignerCallCount(), 0, 'getSigner NEVER called in combined mode');
  });
});

// ===========================================================================
// sendTx chokepoint enforcement (WLT-04 + T-58-02)
// ===========================================================================

describe('sendTx in view-mode aborts BEFORE provider.getSigner()', () => {
  test('view-mode → throws synchronously and getSigner spy never called', async () => {
    const provider = makeProvider();
    setProvider(provider);
    storeMod.update('ui.mode', 'view');
    storeMod.update('connected.address', '0xaaaa000000000000000000000000000000000001');
    let buildTxCalled = false;
    const buildTx = (s) => { buildTxCalled = true; return Promise.resolve({ hash: '0x', wait: async () => ({ status: 1 }) }); };
    await assert.rejects(sendTx(buildTx, 'test'), /Read-only mode/);
    assert.equal(provider.getSignerCallCount(), 0, 'getSigner NEVER called when chokepoint trips');
    assert.equal(buildTxCalled, false, 'buildTx callback NEVER invoked');
  });
});

describe('sendTx wrong-chain enforcement (T-58-03)', () => {
  test('throws "Wrong network" when chainId !== CHAIN.id; getSigner NOT called', async () => {
    const provider = makeProvider({ chainId: 1 }); // mainnet, wrong for testnet build
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    storeMod.update('viewing.address', null);
    await assert.rejects(sendTx(() => Promise.resolve({}), 'test'), /Wrong network/);
    assert.equal(provider.getSignerCallCount(), 0, 'getSigner NOT called on wrong chain');
  });
});

// ===========================================================================
// Per-write signer re-derivation (WLT-03 — T-58-01)
// ===========================================================================

describe('sendTx re-derives signer EVERY invocation', () => {
  test('two consecutive sendTx calls → getSigner spy count === 2 (no cache)', async () => {
    const provider = makeProvider({ signerAddress: '0xabcdef0000000000000000000000000000000000' });
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    storeMod.update('viewing.address', null);
    const buildTx = (s) => Promise.resolve({ hash: '0xdeadbeef', wait: async () => ({ status: 1 }) });
    await sendTx(buildTx, 'first');
    await sendTx(buildTx, 'second');
    assert.equal(provider.getSignerCallCount(), 2, 'getSigner called twice (no module-level cache)');
  });

  test('passes the FRESH signer to buildTx — same object getSigner() returned on this call', async () => {
    const provider = makeProvider({ signerAddress: '0xabcdef0000000000000000000000000000000000' });
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    let receivedSigner = null;
    const buildTx = (s) => {
      receivedSigner = s;
      return Promise.resolve({ hash: '0x', wait: async () => ({ status: 1 }) });
    };
    await sendTx(buildTx, 'test');
    assert.ok(receivedSigner, 'buildTx received a signer arg');
    assert.equal(receivedSigner, provider.lastSigner(), 'buildTx received the same signer getSigner() returned');
  });
});

describe('sendTx gas estimate headroom', () => {
  test('pads an ordinary signer estimate by 20% before sending', async () => {
    const sent = [];
    const signer = {
      getAddress: async () => '0xabcdef0000000000000000000000000000000000',
      estimateGas: async () => 50_000n,
      sendTransaction: async (request) => {
        sent.push(request);
        return { hash: '0xgas', wait: async () => ({ status: 1 }) };
      },
    };
    setProvider({
      getNetwork: async () => ({ chainId: 84532n }),
      getSigner: async () => signer,
    });
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');

    await sendTx((fresh) => fresh.sendTransaction({ to: '0x1' }), 'gas-safe');

    assert.equal(sent.length, 1);
    assert.equal(sent[0].gasLimit, 60_000n);
  });

  test('respects an explicit gasLimit and exposes deterministic rounding', async () => {
    assert.equal(gasEstimateWithHeadroom(42_000n), 50_400n);
    assert.equal(gasEstimateWithHeadroom(42_001n), 50_402n);

    const sent = [];
    const signer = {
      getAddress: async () => '0xabcdef0000000000000000000000000000000000',
      estimateGas: async () => { throw new Error('must not estimate'); },
      sendTransaction: async (request) => {
        sent.push(request);
        return { hash: '0xexplicit', wait: async () => ({ status: 1 }) };
      },
    };
    setProvider({
      getNetwork: async () => ({ chainId: 84532n }),
      getSigner: async () => signer,
    });
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');

    await sendTx(
      (fresh) => fresh.sendTransaction({ to: '0x1', gasLimit: 77_777n }),
      'explicit-gas',
    );
    assert.equal(sent[0].gasLimit, 77_777n);
  });
});

// ===========================================================================
// Account-change mid-flow detection (T-58-01)
// ===========================================================================

describe('sendTx account-change mid-flow', () => {
  test('throws "Account changed mid-flow" when signer.getAddress mismatches store.connected.address', async () => {
    const provider = makeProvider({ signerAddress: '0xfffff00000000000000000000000000000000001' });
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    storeMod.update('viewing.address', null);
    await assert.rejects(
      sendTx(() => Promise.resolve({ hash: '0x', wait: async () => ({ status: 1 }) }), 'test'),
      /Account changed mid-flow/,
    );
  });
});

// ===========================================================================
// Receipt-status check (Pattern D — preserves /beta/mint.js:756 bug-class fix)
// ===========================================================================

describe('sendTx receipt handling', () => {
  test('returns receipt on success', async () => {
    const provider = makeProvider({ signerAddress: '0xabcdef0000000000000000000000000000000000' });
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    const tx = { hash: '0xdeadbeef', wait: async () => ({ status: 1, hash: '0xdeadbeef' }) };
    const receipt = await sendTx(() => Promise.resolve(tx), 'happy');
    assert.equal(receipt.status, 1);
  });

  test('throws "Reverted: <hash>" when receipt.status === 0', async () => {
    const provider = makeProvider({ signerAddress: '0xabcdef0000000000000000000000000000000000' });
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    const tx = { hash: '0xreverted', wait: async () => ({ status: 0, hash: '0xreverted' }) };
    await assert.rejects(sendTx(() => Promise.resolve(tx), 'rev'), /Reverted/);
  });

  test('accepts a successful speed-up replacement instead of reporting a false failure', async () => {
    const provider = makeProvider({ signerAddress: '0xabcdef0000000000000000000000000000000000' });
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    const replacementReceipt = { status: 1, hash: '0xspeedup' };
    const tx = {
      hash: '0xoriginal',
      wait: async () => {
        const error = new Error('transaction was replaced');
        error.code = 'TRANSACTION_REPLACED';
        error.cancelled = false;
        error.receipt = replacementReceipt;
        throw error;
      },
    };
    assert.equal(await sendTx(() => Promise.resolve(tx), 'speed-up'), replacementReceipt);
  });

  test('recovers a mined receipt when an injected provider drops the wait subscription', async () => {
    const recovered = { status: 1, hash: '0xconfirmed' };
    const base = makeProvider({ signerAddress: '0xabcdef0000000000000000000000000000000000' });
    const provider = {
      ...base,
      getTransactionReceipt: async (hash) => hash === '0xconfirmed' ? recovered : null,
    };
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    const tx = {
      hash: '0xconfirmed',
      wait: async () => { throw new Error('provider subscription disconnected'); },
    };
    assert.equal(await sendTx(() => Promise.resolve(tx), 'confirmed'), recovered);
  });

  test('keeps reconciling briefly when the receipt RPC lags behind a successful write', async () => {
    const recovered = { status: 1, hash: '0xslow-confirmed' };
    const base = makeProvider({ signerAddress: '0xabcdef0000000000000000000000000000000000' });
    let reads = 0;
    const provider = {
      ...base,
      getTransactionReceipt: async (hash) => {
        if (hash !== '0xslow-confirmed') return null;
        reads += 1;
        return reads >= 2 ? recovered : null;
      },
    };
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    const tx = {
      hash: '0xslow-confirmed',
      wait: async () => { throw new Error('provider timed out waiting for receipt'); },
    };

    assert.equal(await sendTx(() => Promise.resolve(tx), 'slow-confirmed'), recovered);
    assert.equal(reads, 2, 'a missing first receipt is retried before surfacing an error');
  });

  test('does not treat a cancelled replacement as success', async () => {
    const provider = makeProvider({ signerAddress: '0xabcdef0000000000000000000000000000000000' });
    setProvider(provider);
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', '0xabcdef0000000000000000000000000000000000');
    const tx = {
      hash: '0xoriginal',
      wait: async () => {
        const error = new Error('transaction cancelled');
        error.code = 'TRANSACTION_REPLACED';
        error.cancelled = true;
        error.receipt = { status: 1, hash: '0xcancel' };
        throw error;
      },
    };
    await assert.rejects(sendTx(() => Promise.resolve(tx), 'cancelled'), /cancelled/);
  });
});

// ===========================================================================
// switchToSepolia 4902 fallback (mirror of wallet.test.js coverage)
// ===========================================================================

describe('switchToSepolia 4902 fallback', () => {
  test('on 4902 calls wallet_addEthereumChain with CHAIN.nativeAddEntry, then retries switch, returns true', async () => {
    const calls = [];
    let firstSwitch = true;
    const eip = {
      request: async ({ method, params }) => {
        calls.push({ method, params });
        if (method === 'wallet_switchEthereumChain' && firstSwitch) {
          firstSwitch = false;
          const e = new Error('not added'); e.code = 4902; throw e;
        }
        return null;
      },
    };
    const ok = await contractsMod.switchToSepolia(eip);
    assert.equal(ok, true);
    const methods = calls.map((c) => c.method);
    assert.deepEqual(methods, ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    const addEntry = calls[1].params[0];
    assert.equal(addEntry.chainId, '0x14a34');
  });
});

// ===========================================================================
// assertChainOrBlank / assertChain
// ===========================================================================

describe('assertChainOrBlank read-side gate', () => {
  test('returns true when _provider is null (no wallet) — degraded read-only mode never throws', async () => {
    clearProvider();
    const ok = await assertChainOrBlank();
    assert.equal(ok, true);
  });

  test('returns true on Sepolia chain', async () => {
    setProvider(makeProvider({ chainId: 84532 }));
    const ok = await assertChainOrBlank();
    assert.equal(ok, true);
  });

  test('returns false on wrong chain (does NOT throw on read side)', async () => {
    setProvider(makeProvider({ chainId: 1 }));
    const ok = await assertChainOrBlank();
    assert.equal(ok, false);
  });
});

describe('assertChain write-side gate', () => {
  test('throws when _provider chainId !== CHAIN.id', async () => {
    setProvider(makeProvider({ chainId: 1 }));
    await assert.rejects(assertChain(), /Wrong network/);
  });

  test('returns true on Sepolia', async () => {
    setProvider(makeProvider({ chainId: 84532 }));
    const ok = await assertChain();
    assert.equal(ok, true);
  });
});
