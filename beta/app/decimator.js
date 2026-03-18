// app/decimator.js -- Decimator burn business logic: burn writes, state reads, bucket/multiplier helpers
// Components should import these functions rather than importing ethers or calling contracts directly.

import { ethers } from 'ethers';
import { getContract, sendTx, getReadProvider } from './contracts.js';
import { get, update, batch } from './store.js';
import { CONTRACTS, DECIMATOR_ABI, DECIMATOR_VIEW_ABI, DECIMATOR, DECIMATOR_CLAIM_ABI } from './constants.js';
import { refreshAfterAction } from './api.js';

// -- Write Functions (require wallet) --

/**
 * Burn BURNIE during a decimator window.
 * Burns go to the COIN contract (not GAME).
 * @param {string} amountStr - User-entered BURNIE amount (e.g. "5000")
 * @returns {Promise<object>} Transaction receipt
 */
export async function burnForDecimator(amountStr) {
  const amount = parseFloat(amountStr);
  if (!amount || amount < parseFloat(DECIMATOR.MIN_BURN)) {
    throw new Error('Minimum burn is 1,000 BURNIE');
  }

  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const amountWei = ethers.parseEther(amountStr);
  const contract = getContract(CONTRACTS.COIN, DECIMATOR_ABI);
  const receipt = await sendTx(
    contract.decimatorBurn(playerAddress, amountWei),
    'Decimator burn'
  );

  // Parse DecBurnRecorded event from receipt logs.
  // Event emitted via delegatecall from GAME address, so match by topic hash only.
  // DecBurnRecorded(address indexed player, uint24 indexed lvl, uint256 effectiveAmount, uint256 newTotalBurn, uint8 bucket, uint8 subBucket)
  const decBurnTopic = ethers.id('DecBurnRecorded(address,uint24,uint256,uint256,uint8,uint8)');
  for (const log of receipt.logs) {
    if (log.topics[0] === decBurnTopic) {
      try {
        // Non-indexed params: effectiveAmount, newTotalBurn, bucket, subBucket
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ['uint256', 'uint256', 'uint8', 'uint8'],
          log.data
        );
        const newTotalBurn = decoded[1];
        const bucket = Number(decoded[2]);
        batch([
          ['decimator.playerBurnTotal', newTotalBurn.toString()],
          ['decimator.playerBucket', bucket],
        ]);
        break;
      } catch { /* skip non-matching logs */ }
    }
  }

  await refreshAfterAction();
  return receipt;
}

/**
 * Claim decimator jackpot winnings for a given level.
 * @param {number} level - The level to claim for
 * @returns {Promise<object>} Transaction receipt
 */
export async function claimDecimatorJackpot(level) {
  const contract = getContract(CONTRACTS.GAME, DECIMATOR_CLAIM_ABI);
  const receipt = await sendTx(
    contract.claimDecimatorJackpot(level),
    'Claim decimator jackpot'
  );
  await refreshAfterAction();
  return receipt;
}

// -- Read Functions (use getReadProvider, work before wallet) --

/**
 * Fetch decimator state from contract and update store.
 * If no address is provided, only fetches window + pool state.
 * @param {string} [address] - Player wallet address (optional)
 */
export async function fetchDecimatorState(address) {
  const contract = new ethers.Contract(CONTRACTS.GAME, DECIMATOR_VIEW_ABI, getReadProvider());

  const calls = [
    contract.decWindow(),
    contract.futurePrizePoolTotalView(),
  ];
  if (address) {
    calls.push(contract.playerActivityScore(address));
  }

  const results = await Promise.allSettled(calls);

  const updates = [];

  // decWindow result: [on, lvl]
  if (results[0].status === 'fulfilled') {
    const [on, lvl] = results[0].value;
    updates.push(['decimator.windowOpen', on]);
    updates.push(['decimator.windowLevel', Number(lvl)]);
  }

  // futurePrizePoolTotalView result: compute burn pool share
  if (results[1].status === 'fulfilled') {
    const futurePrizePool = results[1].value;
    // Determine if current window level is x00 for 30% vs 10% share
    const windowLevel = results[0].status === 'fulfilled' ? Number(results[0].value[1]) : 0;
    const isX00 = windowLevel > 0 && windowLevel % 100 === 0;
    const shareBps = isX00 ? 30n : 10n;
    const burnPool = BigInt(futurePrizePool) * shareBps / 100n;
    updates.push(['decimator.burnPool', burnPool.toString()]);
  }

  // Activity score result (player-specific)
  if (address && results[2] && results[2].status === 'fulfilled') {
    const scoreBps = Number(results[2].value);
    const windowLevel = results[0].status === 'fulfilled' ? Number(results[0].value[1]) : 0;
    const isLevel100 = windowLevel > 0 && windowLevel % 100 === 0;
    updates.push(['decimator.playerBucket', computeBucket(scoreBps, isLevel100)]);
    updates.push(['decimator.activityMultiplier', computeMultiplier(scoreBps)]);
  }

  if (updates.length > 0) {
    batch(updates);
  }
}

/**
 * Fetch decimator claim status for a player at a given level.
 * @param {string} address - Player wallet address
 * @param {number} level - The level to check
 */
export async function fetchDecimatorClaimable(address, level) {
  const contract = new ethers.Contract(CONTRACTS.GAME, DECIMATOR_VIEW_ABI, getReadProvider());
  try {
    const [amountWei, winner] = await contract.decClaimable(address, level);
    batch([
      ['decimator.claimable', amountWei.toString()],
      ['decimator.isWinner', winner],
    ]);
  } catch {
    // Leave store unchanged on failure
  }
}

// -- Pure Helpers --

/**
 * Compute decimator bucket from activity score.
 * Mirrors _adjustDecimatorBucket from BurnieCoin.sol.
 * @param {number} activityScoreBps - Activity score in bps
 * @param {boolean} isLevel100 - Whether current level is x00
 * @returns {number} Bucket number (2-12)
 */
export function computeBucket(activityScoreBps, isLevel100) {
  const minBucket = isLevel100 ? DECIMATOR.MIN_BUCKET_100 : DECIMATOR.MIN_BUCKET_NORMAL;
  if (activityScoreBps === 0) return DECIMATOR.BUCKET_BASE;
  const capped = Math.min(activityScoreBps, DECIMATOR.ACTIVITY_CAP_BPS);
  const range = DECIMATOR.BUCKET_BASE - minBucket;
  const reduction = Math.round((range * capped) / DECIMATOR.ACTIVITY_CAP_BPS);
  return Math.max(DECIMATOR.BUCKET_BASE - reduction, minBucket);
}

/**
 * Compute burn weight multiplier from activity score.
 * @param {number} activityScoreBps - Activity score in bps
 * @returns {number} Multiplier (decimal, e.g. 1.783)
 */
export function computeMultiplier(activityScoreBps) {
  const capped = Math.min(activityScoreBps, DECIMATOR.ACTIVITY_CAP_BPS);
  return 1 + (capped / 30000);
}
