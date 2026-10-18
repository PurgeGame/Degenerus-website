import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { deviceWalletProvider, hasDeviceWallet, deviceWalletSupported } = await import('../device-wallet.js');

const SEPOLIA = { id: 11155111, name: 'Ethereum Sepolia', rpcUrl: 'http://127.0.0.1:1' };
beforeEach(() => store.clear());

test('creates one wallet per chain in this browser and restores it without creating', async () => {
  assert.equal(deviceWalletProvider({ chain: SEPOLIA, create: false }), null, 'restore never creates');
  const first = deviceWalletProvider({ chain: SEPOLIA });
  assert.ok(hasDeviceWallet(SEPOLIA));
  const again = deviceWalletProvider({ chain: SEPOLIA, create: false });
  assert.equal(again.address, first.address, 'same key on the next visit');
  assert.deepEqual(await first.request({ method: 'eth_accounts' }), [first.address]);
  assert.equal(await first.request({ method: 'eth_chainId' }), '0xaa36a7');
});

test('stays on its own chain and is never offered on mainnet', async () => {
  const eth = deviceWalletProvider({ chain: SEPOLIA });
  assert.equal(await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] }), null);
  await assert.rejects(eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }), (e) => e.code === 4902);
  assert.equal(deviceWalletSupported({ id: 1 }), false);
  assert.equal(deviceWalletProvider({ chain: { id: 1, rpcUrl: 'http://127.0.0.1:1' } }), null);
});

test('signs messages with the stored key', async () => {
  const eth = deviceWalletProvider({ chain: SEPOLIA });
  const signature = await eth.request({ method: 'personal_sign', params: ['hello degenerus', eth.address] });
  assert.equal(ethers.verifyMessage('hello degenerus', signature).toLowerCase(), eth.address);
});
