import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentLinkToken} from '../../../db/deployment-link-token.mjs';

const mock = '0x' + '11'.repeat(20), real = '0x' + '22'.repeat(20);
test('real Base Sepolia deployments use Chainlink LINK even when a mock exists', () => {
  assert.equal(deploymentLinkToken({chainId: 84532, vrfMode: 'real', mocks: {LINK_TOKEN: mock}}),
    '0xe4ab69c077896252fafbd49efd26b5d171a32410');
});
test('recorded external token is authoritative and mock mode keeps its own token', () => {
  assert.equal(deploymentLinkToken({chainId: 1, vrfMode: 'real', externalContracts: {LINK_TOKEN: real}, mocks: {LINK_TOKEN: mock}}), real);
  assert.equal(deploymentLinkToken({chainId: 31337, vrfMode: 'mock', mocks: {LINK_TOKEN: {address: mock}}}), mock);
});
test('real VRF cannot silently fall back to a spare mock or an unknown network token', () => {
  assert.throws(() => deploymentLinkToken({chainId: 999, vrfMode: 'real', mocks: {LINK_TOKEN: mock}}));
  assert.throws(() => deploymentLinkToken({chainId: 84532, vrfMode: 'real', linkToken: mock, mocks: {LINK_TOKEN: mock}}));
});
