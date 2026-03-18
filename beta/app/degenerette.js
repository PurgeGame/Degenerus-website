// app/degenerette.js -- Degenerette business logic: bet placement, VRF persistence, resolution
// Components should import these functions rather than importing ethers or calling contracts directly.

import { ethers } from 'ethers';
import { getContract, sendTx, getReadProvider } from './contracts.js';
import { get, update, batch } from './store.js';
import { CONTRACTS, DEGENERETTE_ABI, DEGENERETTE } from './constants.js';
import { refreshAfterAction } from './api.js';

// -- Write Functions (require wallet) --

/**
 * Place a degenerette bet.
 * @param {number} currency - 0 = ETH, 1 = BURNIE, 3 = WWXRP
 * @param {string} amountStr - Bet amount per ticket (e.g. "0.01")
 * @param {number} ticketCount - Number of spins (1-10)
 * @param {number} customTicket - Packed uint32 trait selections (use packCustomTicket)
 * @param {number} heroQuadrant - Hero quadrant override (0 = none)
 * @returns {Promise<object>} Transaction receipt
 */
export async function placeBet(currency, amountStr, ticketCount, customTicket = 0, heroQuadrant = 0) {
  // Validate currency
  const validCurrencies = Object.values(DEGENERETTE.CURRENCY);
  if (!validCurrencies.includes(currency)) {
    throw new Error(`Invalid currency: ${currency}`);
  }

  // Validate amount
  const currencyKey = Object.keys(DEGENERETTE.CURRENCY).find(k => DEGENERETTE.CURRENCY[k] === currency);
  const minBet = parseFloat(DEGENERETTE.MIN_BET[currencyKey]);
  if (!amountStr || parseFloat(amountStr) < minBet) {
    throw new Error(`Minimum bet is ${DEGENERETTE.MIN_BET[currencyKey]} ${currencyKey}`);
  }

  // Validate ticket count
  if (!ticketCount || ticketCount < 1 || ticketCount > DEGENERETTE.MAX_SPINS) {
    throw new Error(`Spins must be 1-${DEGENERETTE.MAX_SPINS}`);
  }

  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const contract = getContract(CONTRACTS.GAME, DEGENERETTE_ABI);
  const amountWei = ethers.parseEther(amountStr);
  const msgValue = currency === DEGENERETTE.CURRENCY.ETH ? amountWei * BigInt(ticketCount) : 0n;

  const receipt = await sendTx(
    contract.placeFullTicketBets(
      ethers.ZeroAddress, currency, amountWei, ticketCount,
      customTicket, heroQuadrant,
      { value: msgValue }
    ),
    'Degenerette bet'
  );

  // Parse BetPlaced event from receipt
  const betEvent = parseBetPlacedEvent(receipt);
  if (betEvent) {
    savePendingBet(playerAddress, betEvent.betId, betEvent.rngIndex, {
      currency,
      amount: amountStr,
      ticketCount,
    });

    // Update store with new pending bet
    const pending = get('degenerette.pendingBets') || [];
    update('degenerette.pendingBets', [...pending, {
      betId: betEvent.betId,
      rngIndex: betEvent.rngIndex,
      currency,
      amount: amountStr,
      ticketCount,
      timestamp: Date.now(),
    }]);
  }

  await refreshAfterAction();
  return receipt;
}

/**
 * Resolve pending degenerette bets.
 * @param {number[]} betIds - Array of bet IDs to resolve
 * @returns {Promise<object>} Transaction receipt
 */
export async function resolveBets(betIds) {
  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const contract = getContract(CONTRACTS.GAME, DEGENERETTE_ABI);
  const receipt = await sendTx(
    contract.resolveBets(ethers.ZeroAddress, betIds.map(id => BigInt(id))),
    'Resolve degenerette bets'
  );

  // Clear resolved bets from localStorage
  clearResolvedBets(playerAddress, betIds);

  // Update store: remove resolved bets from pending
  const pending = get('degenerette.pendingBets') || [];
  const resolvedSet = new Set(betIds);
  const remaining = pending.filter(b => !resolvedSet.has(b.betId));
  update('degenerette.pendingBets', remaining);

  // Parse resolution results from receipt logs
  const results = parseResolutionEvents(receipt);
  if (results.length > 0) {
    update('degenerette.lastResults', results);
  }

  await refreshAfterAction();
  return receipt;
}

// -- localStorage Persistence --

/**
 * Load pending bets from localStorage for a given player.
 * @param {string} playerAddress
 * @returns {Array} Pending bets array
 */
export function loadPendingBets(playerAddress) {
  try {
    const stored = JSON.parse(localStorage.getItem(DEGENERETTE.PENDING_BETS_KEY) || '{}');
    return stored[playerAddress] || [];
  } catch {
    return [];
  }
}

/**
 * Save a pending bet to localStorage.
 * @param {string} playerAddress
 * @param {number} betId
 * @param {number} rngIndex
 * @param {object} metadata - { currency, amount, ticketCount }
 */
export function savePendingBet(playerAddress, betId, rngIndex, metadata) {
  try {
    const stored = JSON.parse(localStorage.getItem(DEGENERETTE.PENDING_BETS_KEY) || '{}');
    if (!stored[playerAddress]) stored[playerAddress] = [];
    stored[playerAddress].push({ betId, rngIndex, ...metadata, timestamp: Date.now() });
    localStorage.setItem(DEGENERETTE.PENDING_BETS_KEY, JSON.stringify(stored));
  } catch {
    console.warn('[Degenerette] Failed to save pending bet to localStorage');
  }
}

/**
 * Remove resolved bets from localStorage.
 * @param {string} playerAddress
 * @param {number[]} resolvedIds - Bet IDs that were resolved
 */
export function clearResolvedBets(playerAddress, resolvedIds) {
  try {
    const stored = JSON.parse(localStorage.getItem(DEGENERETTE.PENDING_BETS_KEY) || '{}');
    if (stored[playerAddress]) {
      const resolvedSet = new Set(resolvedIds);
      stored[playerAddress] = stored[playerAddress].filter(b => !resolvedSet.has(b.betId));
      localStorage.setItem(DEGENERETTE.PENDING_BETS_KEY, JSON.stringify(stored));
    }
  } catch {
    console.warn('[Degenerette] Failed to clear resolved bets from localStorage');
  }
}

// -- Event Parsing --

/**
 * Parse BetPlaced event from transaction receipt.
 * BetPlaced(address indexed player, uint48 indexed index, uint64 indexed betId, uint256 packed)
 * Events emitted via delegatecall come from GAME address, so we match by topic hash only.
 * @param {object} receipt - ethers transaction receipt
 * @returns {{ betId: number, rngIndex: number } | null}
 */
export function parseBetPlacedEvent(receipt) {
  const betPlacedTopic = ethers.id('BetPlaced(address,uint48,uint64,uint256)');

  for (const log of receipt.logs) {
    if (log.topics[0] === betPlacedTopic) {
      try {
        const rngIndex = Number(BigInt(log.topics[2]));
        const betId = Number(BigInt(log.topics[3]));
        return { betId, rngIndex };
      } catch { /* skip non-matching logs */ }
    }
  }
  return null;
}

/**
 * Parse FullTicketResult events from resolution receipt.
 * FullTicketResult(address indexed player, uint64 indexed betId, uint8 matches, uint256 payout)
 * @param {object} receipt
 * @returns {Array<{ betId: number, matches: number, payout: string, currency: number }>}
 */
function parseResolutionEvents(receipt) {
  const resultTopic = ethers.id('FullTicketResult(address,uint64,uint8,uint256)');
  const results = [];

  for (const log of receipt.logs) {
    if (log.topics[0] === resultTopic) {
      try {
        const betId = Number(BigInt(log.topics[2]));
        // Non-indexed: matches (uint8), payout (uint256)
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ['uint8', 'uint256'],
          log.data
        );
        results.push({
          betId,
          matches: Number(decoded[0]),
          payout: decoded[1].toString(),
        });
      } catch { /* skip non-matching logs */ }
    }
  }
  return results;
}

// -- Pure Helpers --

/**
 * Pack four trait selections into a uint32 customTicket.
 * Format: [D:24-31][C:16-23][B:8-15][A:0-7]
 * @param {number} traitA - Quadrant A trait index (0-74)
 * @param {number} traitB - Quadrant B trait index (0-74)
 * @param {number} traitC - Quadrant C trait index (0-74)
 * @param {number} traitD - Quadrant D trait index (0-74)
 * @returns {number}
 */
export function packCustomTicket(traitA, traitB, traitC, traitD) {
  return (
    ((traitD & 0xFF) << 24) |
    ((traitC & 0xFF) << 16) |
    ((traitB & 0xFF) << 8) |
    (traitA & 0xFF)
  );
}

// -- Read Functions (use getReadProvider, work before wallet) --

/**
 * Fetch degenerette state for a player from contract and localStorage.
 * Updates store with current nonce and pending bets.
 * @param {string} address - Player wallet address
 */
export async function fetchDegeneretteState(address) {
  if (!address) return;

  // Load pending bets from localStorage
  const pending = loadPendingBets(address);
  update('degenerette.pendingBets', pending);

  // Read current nonce from contract
  try {
    const contract = new ethers.Contract(CONTRACTS.GAME, DEGENERETTE_ABI, getReadProvider());
    const nonce = await contract.degeneretteBetNonce(address);
    update('degenerette.playerNonce', Number(nonce));
  } catch {
    // Contract read failed; leave store value unchanged
  }
}

/**
 * Get the currency label for display.
 * @param {number} currency
 * @returns {string}
 */
export function currencyLabel(currency) {
  switch (currency) {
    case DEGENERETTE.CURRENCY.ETH: return 'ETH';
    case DEGENERETTE.CURRENCY.BURNIE: return 'BURNIE';
    case DEGENERETTE.CURRENCY.WWXRP: return 'WWXRP';
    default: return 'Unknown';
  }
}
