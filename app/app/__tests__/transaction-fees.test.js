import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../chain-config.js';
import { sepoliaFeeOverrides, withTransactionFees, transactionFeeData } from '../transaction-fees.js';
import { _setSharedReadProviderForTests, _resetSharedReadProviderForTests } from '../read-provider.js';
import { setProvider, clearProvider, sendTx } from '../contracts.js';
import { update } from '../store.js';

const originalChainId = CHAIN.id;
const cheapProvider = { getBlock: async () => ({ baseFeePerGas: 25n }) };
afterEach(() => {
  CHAIN.id = originalChainId;
  clearProvider();
  _resetSharedReadProviderForTests();
});

test('Sepolia uses a 1-wei tip and twice the current base fee, including zero base fee', async () => {
  assert.deepEqual(await sepoliaFeeOverrides({ chainId: 11155111, provider: cheapProvider }),
    { maxPriorityFeePerGas: 1n, maxFeePerGas: 51n });
  assert.deepEqual(await sepoliaFeeOverrides({ chainId: 11155111, provider: { getBlock: async () => ({ baseFeePerGas: 0n }) } }),
    { maxPriorityFeePerGas: 1n, maxFeePerGas: 1n });
});

test('other networks retain wallet fee selection without querying Sepolia', async () => {
  const provider = { getBlock: async () => { throw new Error('must not read'); } };
  for (const chainId of [1, 84532]) assert.deepEqual(await sepoliaFeeOverrides({ chainId, provider }), {});
});

test('a failed Sepolia quote does not silently fall back to wallet defaults', async () => {
  for (const provider of [{ getBlock: async () => ({}) }, { getBlock: async () => { throw Error('offline'); } }]) {
    await assert.rejects(sepoliaFeeOverrides({ chainId: 11155111, provider, retryDelayMs: 0 }), /Could not read Sepolia gas fees/);
  }
});

test('a dropped or refused fee read is retried before the purchase gives up', async () => {
  let reads = 0;
  const provider = { getBlock: async () => {
    reads += 1;
    if (reads === 1) throw Object.assign(new Error('Chain RPC unavailable'), { code: 'RPC_UNAVAILABLE', retryAt: Date.now() + 5 });
    if (reads === 2) throw new Error('Failed to fetch');
    return { baseFeePerGas: 25n };
  } };
  assert.deepEqual(await sepoliaFeeOverrides({ chainId: 11155111, provider, retryDelayMs: 0 }),
    { maxPriorityFeePerGas: 1n, maxFeePerGas: 51n });
  assert.equal(reads, 3);
});

test('explicit fees are preserved, while ordinary and prewarmed requests get the policy', async () => {
  const options = { chainId: 11155111, provider: cheapProvider };
  for (const request of [{ gasPrice: 4n }, { maxFeePerGas: 9n, maxPriorityFeePerGas: 2n }]) {
    assert.equal(await withTransactionFees(request, options), request);
  }
  const request = { to: '0x1234', value: 24_000_000_000_000n, gasLimit: 8_000_000n };
  assert.deepEqual(await withTransactionFees(request, options),
    { ...request, maxFeePerGas: 51n, maxPriorityFeePerGas: 1n });
  assert.equal(request.maxFeePerGas, undefined, 'the caller request is not mutated');
});

test('affordability ignores an inflated wallet fee estimate on Sepolia', async () => {
  CHAIN.id = 11155111;
  _setSharedReadProviderForTests(cheapProvider);
  assert.deepEqual(await transactionFeeData({ getFeeData: async () => ({ maxFeePerGas: 2_000_000_000n }) }),
    { maxPriorityFeePerGas: 1n, maxFeePerGas: 51n });
});

test('the real sendTx path carries minimal fees through gas estimation and wallet submission', async () => {
  CHAIN.id = 11155111;
  _setSharedReadProviderForTests(cheapProvider);
  const address = '0xe753cde0c10c362a0f414b3da2a1bee0e68e92ec';
  update('connected.address', address);
  update('viewing.address', null);
  update('ui.mode', 'self');
  let estimated, submitted;
  const signer = {
    getAddress: async () => address,
    estimateGas: async (request) => { estimated = request; return 6_600_000n; },
    sendTransaction: async (request) => {
      submitted = request;
      return { hash: '0xfee', wait: async () => ({ status: 1 }) };
    },
  };
  setProvider({ getNetwork: async () => ({ chainId: 11155111n }), getSigner: async () => signer });
  await sendTx(s => s.sendTransaction({ to: address, value: 24_000_000_000_000n }), 'Buy deity pass');
  assert.equal(estimated.maxPriorityFeePerGas, 1n);
  assert.equal(submitted.maxPriorityFeePerGas, 1n);
  assert.equal(submitted.maxFeePerGas, 51n);
  assert.equal(submitted.gasLimit, 8_050_000n);
  assert.equal(submitted.value, 24_000_000_000_000n);
});
