import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatEth, formatFlip } from '../utils.js';
import { formatFlip as formatViewerFlip } from '../../viewer/utils.js';

test('legacy beta ETH keeps the testnet display multiplier', () => {
  assert.equal(formatEth('1000000000000'), '1.000');
});

test('legacy beta coin displays use unscaled whole ERC-20 units', () => {
  const raw = '1750000000000000000';
  assert.equal(formatFlip(raw), '1');
  assert.equal(formatViewerFlip(raw), '1');
});
