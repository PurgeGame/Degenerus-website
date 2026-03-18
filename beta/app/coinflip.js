// app/coinflip.js -- Coinflip business logic: deposit, claim, auto-rebuy, bounty reads
// Components should import these functions rather than importing ethers or calling contracts directly.

import { ethers } from 'ethers';
import { getContract, sendTx, getReadProvider } from './contracts.js';
import { get, update, batch } from './store.js';
import { CONTRACTS, COINFLIP_ABI, COINFLIP } from './constants.js';
import { refreshAfterAction } from './api.js';

// -- Write Functions (require wallet) --

/**
 * Deposit BURNIE into the daily coinflip.
 * @param {string} amountStr - User-entered BURNIE amount (e.g. "500")
 * @returns {Promise<object>} Transaction receipt
 */
export async function depositCoinflip(amountStr) {
  const amount = parseFloat(amountStr);
  if (!amount || amount < parseFloat(COINFLIP.MIN_DEPOSIT)) {
    throw new Error('Minimum deposit is 100 BURNIE');
  }

  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const amountWei = ethers.parseEther(amountStr);
  const contract = getContract(CONTRACTS.COINFLIP, COINFLIP_ABI);
  const receipt = await sendTx(
    contract.depositCoinflip(playerAddress, amountWei),
    'Coinflip deposit'
  );
  await refreshAfterAction();
  return receipt;
}

/**
 * Claim coinflip winnings.
 * @returns {Promise<object>} Transaction receipt
 */
export async function claimCoinflips() {
  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const contract = getContract(CONTRACTS.COINFLIP, COINFLIP_ABI);
  const receipt = await sendTx(
    contract.claimCoinflips(playerAddress, playerAddress),
    'Claim coinflip winnings'
  );
  await refreshAfterAction();
  return receipt;
}

/**
 * Set auto-rebuy configuration.
 * @param {boolean} enabled - Whether auto-rebuy is enabled
 * @param {string} takeProfitStr - BURNIE take-profit amount string, or '0' for no limit
 */
export async function setAutoRebuy(enabled, takeProfitStr) {
  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const takeProfitWei = ethers.parseEther(takeProfitStr || '0');
  const contract = getContract(CONTRACTS.COINFLIP, COINFLIP_ABI);
  await sendTx(
    contract.setCoinflipAutoRebuy(playerAddress, enabled, takeProfitWei),
    'Set auto-rebuy'
  );
  await refreshAfterAction();
}

// -- Read Functions (use getReadProvider, work before wallet) --

/**
 * Fetch player coinflip state from contract and update store.
 * @param {string} address - Player wallet address
 */
export async function fetchCoinflipState(address) {
  if (!address) return;

  const contract = new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, getReadProvider());

  const [stakeResult, claimableResult, rebuyResult] = await Promise.allSettled([
    contract.coinflipAmount(address),
    contract.previewClaimCoinflips(address),
    contract.coinflipAutoRebuyInfo(address),
  ]);

  const updates = [];

  if (stakeResult.status === 'fulfilled') {
    updates.push(['coinflip.playerStake', stakeResult.value.toString()]);
  }

  if (claimableResult.status === 'fulfilled') {
    updates.push(['coinflip.claimable', claimableResult.value.toString()]);
  }

  if (rebuyResult.status === 'fulfilled') {
    const [enabled, stop, carry] = rebuyResult.value;
    updates.push(['coinflip.autoRebuy', {
      enabled,
      stop: stop.toString(),
      carry: carry.toString(),
    }]);
  }

  if (updates.length > 0) {
    batch(updates);
  }
}

/**
 * Fetch global bounty state from contract and update store.
 */
export async function fetchBountyState() {
  const contract = new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, getReadProvider());

  try {
    const [bounty, record] = await Promise.all([
      contract.currentBounty(),
      contract.biggestFlipEver(),
    ]);

    batch([
      ['coinflip.bounty.pool', bounty.toString()],
      ['coinflip.bounty.recordAmount', record.toString()],
    ]);
  } catch {
    // Bounty reads failed; leave store values unchanged
  }
}

// -- Pure Helpers --

/**
 * Get multiplier tier info from a coinflip reward percentage.
 * @param {number} rewardPercent - Reward percentage from contract (50, 78-115, or 150)
 * @returns {{ label: string, class: string, desc: string }}
 */
export function getMultiplierTier(rewardPercent) {
  if (rewardPercent === 50) {
    return { label: '1.50x', class: 'tier-low', desc: 'Unlucky roll' };
  }
  if (rewardPercent === 150) {
    return { label: '2.50x', class: 'tier-high', desc: 'Lucky roll!' };
  }
  return {
    label: (1 + rewardPercent / 100).toFixed(2) + 'x',
    class: 'tier-normal',
    desc: 'Standard range',
  };
}

/**
 * Check if coinflip actions are locked (RNG resolution or phase transition).
 * @returns {boolean}
 */
export function isCoinflipLocked() {
  return get('game.rngLocked') || get('game.phaseTransitionActive');
}
