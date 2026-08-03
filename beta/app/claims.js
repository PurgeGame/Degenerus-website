// app/claims.js -- Unified claims business logic: ETH + FLIP aggregation and claim transactions
// Components should import these functions rather than importing ethers or calling contracts directly.

import { ethers } from 'ethers';
import { getContract, sendTx, getReadProvider } from './contracts.js';
import { get, batch } from './store.js';
import { CONTRACTS, CLAIMS_ABI, COINFLIP_ABI } from './constants.js';
import { refreshAfterAction } from './api.js';

// -- Read Functions (use getReadProvider, work before wallet) --

/**
 * Fetch all claimable amounts (ETH from game, FLIP from coinflip) and update store.
 * Uses Promise.allSettled for resilience (one failing doesn't block the other).
 * @param {string} address - Player wallet address
 */
export async function fetchAllClaimable(address) {
  if (!address) return;

  const [ethResult, flipResult] = await Promise.allSettled([
    fetchEthClaimable(address),
    fetchFlipClaimable(address),
  ]);

  batch([
    ['claims.eth', ethResult.status === 'fulfilled' ? ethResult.value : '0'],
    ['claims.flip', flipResult.status === 'fulfilled' ? flipResult.value : '0'],
  ]);
}

/**
 * Read ETH claimable from game contract, subtracting the 1 wei sentinel.
 * @param {string} address - Player wallet address
 * @returns {Promise<string>} Claimable ETH amount as wei string
 */
async function fetchEthClaimable(address) {
  const contract = new ethers.Contract(CONTRACTS.GAME, CLAIMS_ABI, getReadProvider());
  const raw = await contract.claimableWinningsOf(address);
  const value = BigInt(raw);
  // Subtract 1 wei sentinel: contract stores 1 wei to avoid cold SSTORE costs
  return value > 1n ? (value - 1n).toString() : '0';
}

/**
 * Read FLIP claimable from coinflip contract.
 * @param {string} address - Player wallet address
 * @returns {Promise<string>} Claimable FLIP amount as wei string
 */
async function fetchFlipClaimable(address) {
  const contract = new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, getReadProvider());
  const raw = await contract.previewClaimCoinflips(address);
  return raw.toString();
}

// -- Write Functions (require wallet) --

/**
 * Claim ETH winnings from the game contract.
 * @returns {Promise<object>} Transaction receipt
 */
export async function claimEth() {
  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const contract = getContract(CONTRACTS.GAME, CLAIMS_ABI);
  const receipt = await sendTx(
    contract.claimWinnings(ethers.ZeroAddress),
    'Claim ETH winnings'
  );

  await refreshAfterAction();
  await fetchAllClaimable(playerAddress);
  return receipt;
}

/**
 * Claim FLIP winnings from the coinflip contract.
 * @returns {Promise<object>} Transaction receipt
 */
export async function claimFlip() {
  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const contract = getContract(CONTRACTS.COINFLIP, COINFLIP_ABI);
  const receipt = await sendTx(
    contract.claimCoinflips(playerAddress, playerAddress),
    'Claim FLIP winnings'
  );

  await refreshAfterAction();
  await fetchAllClaimable(playerAddress);
  return receipt;
}

