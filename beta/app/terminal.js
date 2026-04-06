// app/terminal.js -- Terminal decimator + insurance business logic
// Handles terminal decimator burns, claims, state reads, insurance data,
// and time multiplier computation. Components import these functions
// rather than importing ethers or calling contracts directly.

import { ethers } from 'ethers';
import { getContract, sendTx } from './contracts.js';
import { get, batch } from './store.js';
import { CONTRACTS, DECIMATOR_ABI, DECIMATOR_CLAIM_ABI, DECIMATOR, DEATH_CLOCK } from './constants.js';
import { refreshAfterAction } from './api.js';

// -- Write Functions (require wallet) --

/**
 * Burn BURNIE for the terminal decimator (always-open death bet).
 * Burns go to the COIN contract (not GAME).
 * @param {string} amountStr - User-entered BURNIE amount (e.g. "5000")
 * @returns {Promise<object>} Transaction receipt
 */
export async function burnForTerminalDecimator(amountStr) {
  const amount = parseFloat(amountStr);
  if (!amount || amount < parseFloat(DECIMATOR.MIN_BURN)) {
    throw new Error('Minimum burn is 1,000 BURNIE');
  }

  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const amountWei = ethers.parseEther(amountStr);
  const contract = getContract(CONTRACTS.COIN, DECIMATOR_ABI);
  const receipt = await sendTx(
    contract.terminalDecimatorBurn(playerAddress, amountWei),
    'Terminal decimator burn'
  );

  await refreshAfterAction();
  return receipt;
}

/**
 * Claim terminal decimator jackpot winnings.
 * @returns {Promise<object>} Transaction receipt
 */
export async function claimTerminalDecimator() {
  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const contract = getContract(CONTRACTS.GAME, DECIMATOR_CLAIM_ABI);
  const receipt = await sendTx(
    contract.claimTerminalDecimatorJackpot(),
    'Claim terminal decimator'
  );

  await refreshAfterAction();
  return receipt;
}

// -- Read Functions --

/**
 * Compute terminal decimator time multiplier from death clock and update store.
 * All other terminal state (tickets, futurePool, decWindowOpen) comes from the API
 * via fetchPlayerData(). No contract reads needed here.
 */
export function fetchTerminalState() {
  const levelStartTime = get('game.levelStartTime');
  const level = get('game.level') || 0;
  if (!levelStartTime) return;

  const timeout = level === 0 ? DEATH_CLOCK.TIMEOUT_LEVEL_0 : DEATH_CLOCK.TIMEOUT_DEFAULT;
  const deadline = levelStartTime + timeout;
  const nowSec = Math.floor(Date.now() / 1000);
  const daysRemaining = Math.max(0, (deadline - nowSec) / 86400);
  const mult = computeTimeMultiplier(daysRemaining);
  batch([
    ['terminal.timeMultiplier', mult],
    ['terminal.daysRemaining', Math.floor(daysRemaining)],
  ]);
}

// -- Pure Helpers --

/**
 * Compute terminal decimator time multiplier from days remaining on death clock.
 * Mirrors _terminalDecMultiplierBps from DegenerusGameDecimatorModule.sol.
 * @param {number} daysRemaining - Days remaining on death clock
 * @returns {number|null} Multiplier (decimal), or null if burns blocked
 */
export function computeTimeMultiplier(daysRemaining) {
  if (daysRemaining <= 1) return null; // Burns blocked
  if (daysRemaining > 10) {
    return daysRemaining * 0.25; // 30x at 120 days, 2.75x at 11 days
  }
  // Linear: 2x at day 10, 1x at day 2
  return 1 + ((daysRemaining - 2) / 8);
}
