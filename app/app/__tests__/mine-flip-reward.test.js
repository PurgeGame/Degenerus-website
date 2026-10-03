import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from '../contracts.js';
import { CONTRACTS } from '../chain-config.js';
import { readMineFlipReward } from '../mine-flip.js';

const miner = '0xab12000000000000000000000000000000000000';
const other = '0xab13000000000000000000000000000000000000';
const iface = new ethers.Interface([
  'event MinerBounty(uint8 kind, address indexed miner, uint256 flipAmount)',
]);
const bounty = (amount, player = miner, address = CONTRACTS.GAME) => ({
  address, ...iface.encodeEventLog(iface.getEvent('MinerBounty'), [1, player, amount]),
});

test('confirmed miner rewards sum all bounty legs without counting other recipients or contracts', () => {
  const receipt = { status: 1, logs: [
    bounty(25n * 10n ** 18n), bounty(3n * 10n ** 18n),
    bounty(99n, other), bounty(100n, miner, other),
    { address: CONTRACTS.GAME, topics: [], data: '0x' },
  ] };
  assert.equal(readMineFlipReward(receipt, miner.toUpperCase()), 28n * 10n ** 18n);
});

test('failed, unconfirmed, and successful but unrewarded transactions produce no reward', () => {
  for (const status of [0, undefined, null]) {
    assert.equal(readMineFlipReward({ status, logs: [bounty(100n)] }, miner), 0n);
  }
  assert.equal(readMineFlipReward({ status: 1, logs: [bounty(0n)] }, miner), 0n);
  assert.equal(readMineFlipReward({ status: 1, logs: [] }, miner), 0n);
  assert.equal(readMineFlipReward(null, miner), 0n);
});
