import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DECIMATOR_ETH_WEI,
  decimatorPayoutBreakdown,
} from '../decimator-payout.js';

describe('Decimator final payout breakdown', () => {
  test('normal prizes split exactly in half with the odd wei routed to rewards', () => {
    const split = decimatorPayoutBreakdown(11n);
    assert.equal(split.claimableEthWei, 5n);
    assert.equal(split.rewardWei, 6n);
    assert.equal(split.luckboxWei, 6n);
    assert.equal(split.rewardKind, 'luckbox');
  });

  test('the exact five-ETH reward threshold remains a Luckbox', () => {
    const split = decimatorPayoutBreakdown(10n * DECIMATOR_ETH_WEI);
    assert.equal(split.claimableEthWei, 5n * DECIMATOR_ETH_WEI);
    assert.equal(split.luckboxWei, 5n * DECIMATOR_ETH_WEI);
    assert.equal(split.rewardKind, 'luckbox');
  });

  test('a larger reward leg becomes Whale half-passes plus its eligible Luckbox remainder', () => {
    const split = decimatorPayoutBreakdown(13n * DECIMATOR_ETH_WEI);
    assert.equal(split.claimableEthWei, 6n * DECIMATOR_ETH_WEI + DECIMATOR_ETH_WEI / 2n);
    assert.equal(split.rewardKind, 'whale');
    assert.equal(split.halfPasses, 2n);
    assert.equal(split.luckboxWei, 2n * DECIMATOR_ETH_WEI);
    assert.equal(split.recirculatedDustWei, 0n);
  });

  test('a sub-0.01 ETH Whale remainder is honestly marked as recirculated dust', () => {
    const split = decimatorPayoutBreakdown(13_510n * DECIMATOR_ETH_WEI / 1_000n);
    assert.equal(split.rewardKind, 'whale');
    assert.equal(split.halfPasses, 3n);
    assert.equal(split.luckboxWei, 0n);
    assert.equal(split.recirculatedDustWei, 5n * DECIMATOR_ETH_WEI / 1_000n);
  });

  test('terminal mode remains all claimable ETH', () => {
    const split = decimatorPayoutBreakdown(7n * DECIMATOR_ETH_WEI, { terminal: true });
    assert.equal(split.claimableEthWei, 7n * DECIMATOR_ETH_WEI);
    assert.equal(split.rewardWei, 0n);
    assert.equal(split.rewardKind, 'eth');
  });
});
