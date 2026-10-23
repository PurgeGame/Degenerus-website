import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from '../contracts.js';
import { CONTRACTS } from '../chain-config.js';
import { readMineFlipReward, readMineFlipStakeCredit } from '../mine-flip.js';
import { abi as gameAbi } from '../../chain/generated/game.js';
import { abi as coinflipAbi } from '../../chain/generated/coinflip.js';
import { prepareWalletReceipt } from '../wallet-receipt.js';
import { rpcFixture } from './helpers/chain-rpc.js';

// FLIP is whole tokens on chain: raw event amounts are whole FLIP and the readers return token wei.
const WEI = 10n ** 18n;
const miner = '0xab12000000000000000000000000000000000000';
const other = '0xab13000000000000000000000000000000000000';
const MINER_ID = 41, OTHER_ID = 42;
const game = new ethers.Interface(gameAbi);
const coinflip = new ethers.Interface(coinflipAbi);
const bounty = (amount, player = miner, address = CONTRACTS.GAME) => ({
  address, ...game.encodeEventLog(game.getEvent('MinerBounty'), [1, player, amount]),
});
const stake = (amount, total, id = MINER_ID, address = CONTRACTS.COINFLIP) => ({
  address, ...coinflip.encodeEventLog(coinflip.getEvent('CoinflipStakeUpdated'), [id, 68, amount, total]),
});
// A stake event names its player by wallet ID; a receipt is resolved before the synchronous reader sees it.
async function resolved(logs, status = 1) {
  const chain = await rpcFixture({ head: 10_000 });
  chain.contracts.GAME = CONTRACTS.GAME;
  chain.contracts.COINFLIP = CONTRACTS.COINFLIP;
  await chain.wallet(MINER_ID, miner);
  await chain.wallet(OTHER_ID, other);
  const receipt = { status, blockNumber: 9_999, logs };
  await prepareWalletReceipt(receipt, chain.client);
  return receipt;
}

test('mining credit uses the accepted stake delta and absolute total, including the daily cap', async () => {
  const receipt = await resolved([
    stake(900n, 900n), // unrelated earlier winnings in the same crank
    stake(25n, 925n), bounty(125n),
    stake(999n, 999n, OTHER_ID), stake(888n, 888n, MINER_ID, other),
  ]);
  assert.deepEqual(readMineFlipStakeCredit(receipt, miner.toUpperCase()), {
    day: 68, amountWei: String(25n * WEI), totalWei: String(925n * WEI),
  });
  assert.equal(readMineFlipStakeCredit({ ...receipt, status: 0 }, miner), null);
  assert.equal(readMineFlipStakeCredit(await resolved([bounty(125n)]), miner), null);
  assert.deepEqual(readMineFlipStakeCredit(await resolved([stake(0n, 925n), bounty(125n)]), miner), {
    day: 68, amountWei: '0', totalWei: String(925n * WEI),
  });
});

test('confirmed miner rewards sum all bounty legs without counting other recipients or contracts', () => {
  const receipt = { status: 1, logs: [
    bounty(25n), bounty(3n),
    bounty(99n, other), bounty(100n, miner, other),
    { address: CONTRACTS.GAME, topics: [], data: '0x' },
  ] };
  assert.equal(readMineFlipReward(receipt, miner.toUpperCase()), 28n * WEI);
});

test('failed, unconfirmed, and successful but unrewarded transactions produce no reward', () => {
  for (const status of [0, undefined, null]) {
    assert.equal(readMineFlipReward({ status, logs: [bounty(100n)] }, miner), 0n);
  }
  assert.equal(readMineFlipReward({ status: 1, logs: [bounty(0n)] }, miner), 0n);
  assert.equal(readMineFlipReward({ status: 1, logs: [] }, miner), 0n);
  assert.equal(readMineFlipReward(null, miner), 0n);
});
