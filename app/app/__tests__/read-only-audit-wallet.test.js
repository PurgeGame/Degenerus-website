import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readOnlyWalletSource } from '../../../db/read-only-wallet.mjs';

test('the simulated audit wallet forwards public reads and refuses signing, writes and connection prompts', async () => {
  const address = `0x${'12'.repeat(20)}`;
  const values = new Map([['lastWalletRdns', 'previous-wallet']]);
  const requests = [];
  const context = {
    window: {}, performance, AbortSignal,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
    fetch: async (url, options) => {
      requests.push({ url, ...JSON.parse(options.body) });
      return { ok: true, json: async () => ({ jsonrpc: '2.0', result: '0x1234' }) };
    },
  };
  runInNewContext(readOnlyWalletSource({ address, rpcUrl: 'https://rpc.example', chainId: 84532 }), context);
  const request = context.window.ethereum.request;
  assert.equal((await request({ method: 'eth_accounts' }))[0], address);
  assert.equal(await request({ method: 'eth_chainId' }), '0x14a34');
  assert.equal(requests.length, 0, 'session metadata requires no network request');
  assert.equal(await request({ method: 'eth_getBalance', params: [address, 'latest'] }), '0x1234');
  assert.deepEqual(requests[0].params, [address, 'latest']);
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'eth_signTypedData_v4', 'wallet_sendCalls', 'eth_requestAccounts']) {
    await assert.rejects(request({ method, params: [] }), error => error.code === 4001);
  }
  assert.equal(requests.length, 1, 'none of the rejected requests reaches an RPC');
  assert.equal(context.window.__auditWallet.blocked.length, 6);
  context.window.__auditWallet.restore();
  assert.equal(values.get('lastWalletRdns'), 'previous-wallet');
});

test('the simulated audit wallet validates its public identity before generating browser code', () => {
  assert.throws(() => readOnlyWalletSource({ address: 'not-an-address', rpcUrl: 'https://rpc.example', chainId: 1 }), /public wallet address/);
  assert.throws(() => readOnlyWalletSource({ address: `0x${'ab'.repeat(20)}`, rpcUrl: 'http://rpc.example', chainId: 1 }), /HTTPS/);
});
