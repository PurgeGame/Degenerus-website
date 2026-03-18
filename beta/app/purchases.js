// app/purchases.js -- Purchase business logic: contract calls, price calc, pool target, EV indicator, affiliate code
// Components should import these functions rather than importing ethers or calling contracts directly.

import { ethers } from 'ethers';
import { getContract, sendTx, getReadProvider } from './contracts.js';
import { get } from './store.js';
import { CONTRACTS } from './constants.js';
import { refreshAfterAction } from './api.js';

// -- Constants --
const TICKET_UNIT = 400n;           // 1 user ticket = 400 contract units
const TESTNET_DIVISOR = 1000000n;   // Sepolia price divisor
const BURNIE_PER_TICKET = 1000;     // Display constant: 1000 BURNIE per ticket

const REFERRER_KEY = 'degenerette_referrer_code';

// ABI fragments for purchase-related contract calls
const PURCHASE_ABI = [
  'function purchase(address buyer, uint256 ticketQuantity, uint256 lootBoxAmount, bytes32 affiliateCode, uint8 payKind) payable',
  'function purchaseCoin(address buyer, uint256 ticketQuantity, uint256 lootBoxBurnieAmount)',
  'function purchaseBurnieLootbox(address buyer, uint256 burnieAmount)',
  'function prizePoolTargetView() view returns (uint256)',
  'function lootboxPresaleActiveFlag() view returns (bool)',
  'function purchaseInfo() view returns (uint24 lvl, bool inJackpotPhase, bool lastPurchaseDay, bool rngLocked, uint256 priceWei)',
];

// -- Purchase Functions --

/**
 * Buy ETH tickets and/or lootbox.
 * @param {number} ticketQty - User-facing ticket count (0+)
 * @param {string} lootboxEthStr - Lootbox ETH amount as string (e.g. "0.05"), or falsy for none
 * @param {string} affiliateCode - bytes32-encoded affiliate code, or ZeroHash
 */
export async function buyEthTicketsAndLootbox(ticketQty, lootboxEthStr, affiliateCode) {
  if (ticketQty <= 0 && (!lootboxEthStr || parseFloat(lootboxEthStr) <= 0)) {
    throw new Error('Enter ticket quantity or lootbox amount');
  }

  const contract = getContract(CONTRACTS.GAME, PURCHASE_ABI);
  const priceWei = BigInt(get('game.price'));
  const ticketScaled = BigInt(Math.max(ticketQty, 0)) * TICKET_UNIT;
  const lootboxWei = lootboxEthStr ? ethers.parseEther(lootboxEthStr) : 0n;
  const ticketWei = priceWei * BigInt(Math.max(ticketQty, 0));
  const msgValue = ticketWei + lootboxWei;

  const receipt = await sendTx(
    contract.purchase(
      ethers.ZeroAddress,
      ticketScaled,
      lootboxWei,
      affiliateCode || ethers.ZeroHash,
      0,
      { value: msgValue }
    ),
    'Purchase ETH tickets'
  );
  await refreshAfterAction();
  return receipt;
}

/**
 * Buy BURNIE tickets and/or lootbox.
 * No approval needed: BurnieCoin has a game-contract bypass.
 * @param {number} ticketQty - User-facing ticket count (0+)
 * @param {string} lootboxBurnieStr - Lootbox BURNIE amount as string, or falsy for none
 */
export async function buyBurnieTickets(ticketQty, lootboxBurnieStr) {
  if (ticketQty <= 0 && (!lootboxBurnieStr || parseFloat(lootboxBurnieStr) <= 0)) {
    throw new Error('Enter ticket quantity or BURNIE lootbox amount');
  }

  const contract = getContract(CONTRACTS.GAME, PURCHASE_ABI);
  const ticketScaled = BigInt(Math.max(ticketQty, 0)) * TICKET_UNIT;
  const lootboxBurnie = lootboxBurnieStr ? ethers.parseEther(lootboxBurnieStr) : 0n;

  let txPromise;
  if (ticketQty > 0) {
    txPromise = contract.purchaseCoin(ethers.ZeroAddress, ticketScaled, lootboxBurnie);
  } else {
    txPromise = contract.purchaseBurnieLootbox(ethers.ZeroAddress, lootboxBurnie);
  }

  const receipt = await sendTx(txPromise, 'Purchase BURNIE tickets');
  await refreshAfterAction();
  return receipt;
}

// -- Read-Only Contract Queries --

/**
 * Fetch the prize pool target for the current level.
 * Uses read-only provider so it works before wallet connection.
 * @returns {Promise<string>} Target in wei as string, or '0' on error
 */
export async function fetchPoolTarget() {
  try {
    const contract = new ethers.Contract(CONTRACTS.GAME, PURCHASE_ABI, getReadProvider());
    return (await contract.prizePoolTargetView()).toString();
  } catch {
    return '0';
  }
}

/**
 * Fetch whether the lootbox presale is active.
 * Uses read-only provider so it works before wallet connection.
 * @returns {Promise<boolean>} true if presale active, false otherwise or on error
 */
export async function fetchPresaleFlag() {
  try {
    const contract = new ethers.Contract(CONTRACTS.GAME, PURCHASE_ABI, getReadProvider());
    return await contract.lootboxPresaleActiveFlag();
  } catch {
    return false;
  }
}

// -- Pure Calculation Helpers --

/**
 * Calculate pool fill percentage (0-100).
 * @param {string} nextPoolWei - Current nextPrizePool in wei
 * @param {string} targetWei - Pool target in wei
 * @returns {number} Percentage clamped to 0-100
 */
export function calcPoolFillPercent(nextPoolWei, targetWei) {
  if (!targetWei || targetWei === '0') return 0;
  const next = BigInt(nextPoolWei || '0');
  const target = BigInt(targetWei);
  if (target === 0n) return 0;
  const pct = Number(next * 10000n / target) / 100;
  return Math.min(pct, 100);
}

/**
 * Return CSS class for lootbox EV indicator based on activity score.
 * @param {number} activityScoreBps - Activity score in basis points
 * @returns {string} CSS class name
 */
export function lootboxEvClass(activityScoreBps) {
  const score = activityScoreBps / 10000;
  if (score >= 2.55) return 'ev-capped';
  if (score >= 0.60) return 'ev-positive';
  return 'ev-negative';
}

/**
 * Return human-readable EV label based on activity score.
 * @param {number} activityScoreBps - Activity score in basis points
 * @returns {string} Label text
 */
export function lootboxEvLabel(activityScoreBps) {
  const score = activityScoreBps / 10000;
  if (score >= 2.55) return 'Max EV';
  if (score >= 0.60) return '+EV';
  return '-EV (score below 0.60)';
}

/**
 * Return badge text showing the free lootbox bonus for a ticket purchase.
 * @param {string|bigint} priceWei - Ticket price in wei
 * @param {boolean} isPresale - Whether presale is active (20% vs 10%)
 * @returns {string} Badge text
 */
export function lootboxBadgeText(priceWei, isPresale) {
  const bps = isPresale ? 2000n : 1000n;
  const lootWei = (BigInt(priceWei) * bps) / 10000n;
  const pct = isPresale ? '20%' : '10%';
  return `+ free ${ethers.formatEther(lootWei)} ETH lootbox (${pct})`;
}

/**
 * Resolve affiliate code from URL params or localStorage.
 * URL params checked: ref, referral, code. If found, saved to localStorage.
 * @returns {string} bytes32-encoded affiliate code, or ZeroHash if none
 */
export function getAffiliateCode() {
  let raw = '';
  try { raw = localStorage.getItem(REFERRER_KEY) || ''; } catch { raw = ''; }

  const params = new URLSearchParams(window.location.search);
  const urlRef = (params.get('ref') || params.get('referral') || params.get('code') || '').trim().toUpperCase();
  if (urlRef) {
    raw = urlRef;
    try { localStorage.setItem(REFERRER_KEY, urlRef); } catch { /* ignore */ }
  }

  if (!raw) return ethers.ZeroHash;
  try {
    return ethers.encodeBytes32String(raw.slice(0, 31));
  } catch {
    return ethers.ZeroHash;
  }
}
