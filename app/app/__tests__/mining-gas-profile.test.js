import { test } from 'node:test';
import assert from 'node:assert/strict';
import { miningGasBounds } from '../mining-gas-profile.js';

test('Sepolia mining includes a state reservoir after Glamsterdam activation', () => {
  assert.deepEqual(miningGasBounds(11155111, 1791294816), { min: 30_000_000n, max: 30_000_000n });
  assert.deepEqual(miningGasBounds(11155111, 1791294815), { min: 10_000_000n, max: 16_000_000n });
});

test('Base Sepolia and local legacy EVM retain limits below their total transaction cap', () => {
  for (const chain of [84532, 31337]) {
    assert.deepEqual(miningGasBounds(chain, 1800000000), { min: 10_000_000n, max: 16_000_000n });
  }
});
