import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../chain-config.js';
import { _setSharedReadProviderForTests, _resetSharedReadProviderForTests } from '../read-provider.js';
import { setProvider, clearProvider, sendTx } from '../contracts.js';
import { update } from '../store.js';

const originalChainId = CHAIN.id;
const originalDocument = globalThis.document;
afterEach(() => {
  CHAIN.id = originalChainId;
  clearProvider();
  _resetSharedReadProviderForTests();
  globalThis.document = originalDocument;
});

// A phone back from the wallet app: the WalletConnect-side wait() never
// settles, but the shared read provider already has the mined receipt.
test('a write settles from the shared read provider when the tab is shown again', async () => {
  CHAIN.id = 11155111;
  const listeners = new Map();
  globalThis.document = {
    visibilityState: 'hidden',
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent: () => true,
  };
  const receipt = { status: 1, hash: '0xabc', blockNumber: 7, logs: [] };
  _setSharedReadProviderForTests({
    getBlock: async () => ({ baseFeePerGas: 25n }),
    getTransactionReceipt: async (hash) => (hash === '0xabc' ? receipt : null),
  });
  const address = '0xe753cde0c10c362a0f414b3da2a1bee0e68e92ec';
  update('connected.address', address);
  update('viewing.address', null);
  update('ui.mode', 'self');
  const signer = {
    getAddress: async () => address,
    estimateGas: async () => 100_000n,
    sendTransaction: async () => ({ hash: '0xabc', wait: () => new Promise(() => {}) }),
  };
  setProvider({ getNetwork: async () => ({ chainId: 11155111n }), getSigner: async () => signer });
  const pending = sendTx((s) => s.sendTransaction({ to: address }), 'Buy tickets');
  for (let i = 0; i < 50 && !listeners.has('visibilitychange'); i += 1) await new Promise((r) => setTimeout(r, 5));
  globalThis.document.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  const settled = await pending;
  assert.equal(settled.blockNumber, 7);
  assert.equal(listeners.has('visibilitychange'), false, 'the watcher detaches once settled');
});
