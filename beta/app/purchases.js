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
  'function purchaseWhaleBundle(address buyer, uint256 quantity) payable',
  'function purchaseLazyPass(address buyer) payable',
  'function purchaseDeityPass(address buyer, uint8 symbolId) payable',
  'function hasActiveLazyPass(address player) view returns (bool)',
  'function deityPassTotalIssuedCount() view returns (uint32)',
  'function deityPassCountFor(address player) view returns (uint16)',
];

// ABI for deity pass NFT (separate contract for ownerOf checks)
const DEITY_PASS_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
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

// -- Deity Symbols (4 groups of 8, 32 total) --

export const DEITY_SYMBOLS = [
  { group: 'Crypto', symbols: ['WWXRP','Tron','Sui','Monero','Solana','Chainlink','Ethereum','Bitcoin'] },
  { group: 'Zodiac', symbols: ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Scorpio','Aquarius'] },
  { group: 'Cards', symbols: ['Horseshoe','King','Cash Sack','Club','Diamond','Heart','Spade','Ace'] },
  { group: 'Dice', symbols: ['One','Two','Three','Four','Five','Six','Seven','Eight'] },
];

// -- Pass Pricing Functions --

/**
 * Calculate lazy pass price.
 * Level <= 2: flat 0.24 ETH. Otherwise: 10x current ticket price, or 0.4 ETH fallback.
 * @param {number} level - Current game level
 * @param {string|bigint|null} mintPriceWei - Current ticket price in wei, or null
 * @returns {bigint} Price in wei
 */
export function calcLazyPassPrice(level, mintPriceWei) {
  if (level <= 2) {
    return ethers.parseEther('0.24') / TESTNET_DIVISOR;
  }
  if (mintPriceWei) {
    return BigInt(mintPriceWei) * 10n;
  }
  return ethers.parseEther('0.4') / TESTNET_DIVISOR;
}

/**
 * Calculate whale bundle total price.
 * Level <= 3: 2.4 ETH per bundle. Otherwise: 4 ETH per bundle.
 * @param {number} level - Current game level
 * @param {number} qty - Number of bundles
 * @returns {bigint} Total price in wei
 */
export function calcWhaleBundlePrice(level, qty) {
  const unitWei = level <= 3
    ? ethers.parseEther('2.4') / TESTNET_DIVISOR
    : ethers.parseEther('4') / TESTNET_DIVISOR;
  return unitWei * BigInt(Math.max(qty, 1));
}

/**
 * Calculate deity pass price using triangular pricing curve.
 * Base price 24 ETH + triangular(issued) * 1 ETH.
 * Uses read-only provider so it works before wallet connection.
 * @returns {Promise<bigint>} Price in wei
 */
export async function calcDeityPassPrice() {
  const basePrice = ethers.parseEther('24') / TESTNET_DIVISOR;
  try {
    const contract = new ethers.Contract(CONTRACTS.GAME, PURCHASE_ABI, getReadProvider());
    const issued = await contract.deityPassTotalIssuedCount();
    const triangular = (BigInt(issued) * (BigInt(issued) + 1n)) / 2n;
    return basePrice + triangular * (ethers.parseEther('1') / TESTNET_DIVISOR);
  } catch {
    return basePrice;
  }
}

// -- Pass Status Readers --

/**
 * Check whether the given address has an active lazy pass.
 * @param {string} address - Player wallet address
 * @returns {Promise<boolean>}
 */
export async function fetchHasLazyPass(address) {
  try {
    const contract = new ethers.Contract(CONTRACTS.GAME, PURCHASE_ABI, getReadProvider());
    return await contract.hasActiveLazyPass(address);
  } catch {
    return false;
  }
}

/**
 * Fetch deity pass count for the given address.
 * @param {string} address - Player wallet address
 * @returns {Promise<number>}
 */
export async function fetchDeityPassCount(address) {
  try {
    const contract = new ethers.Contract(CONTRACTS.GAME, PURCHASE_ABI, getReadProvider());
    return Number(await contract.deityPassCountFor(address));
  } catch {
    return 0;
  }
}

/**
 * Check all 32 deity symbol token IDs and return which are taken.
 * A symbol is taken if ownerOf(tokenId) resolves without revert.
 * @returns {Promise<Set<number>>} Set of taken token IDs (0-31)
 */
export async function fetchTakenSymbols() {
  const taken = new Set();
  try {
    const deityContract = new ethers.Contract(CONTRACTS.DEITY_PASS, DEITY_PASS_ABI, getReadProvider());
    const checks = Array.from({ length: 32 }, (_, i) => i);
    await Promise.allSettled(checks.map(async (id) => {
      try {
        await deityContract.ownerOf(id);
        taken.add(id);
      } catch {
        // Token not minted = symbol available
      }
    }));
  } catch {
    // Contract read failed entirely; return empty set
  }
  return taken;
}

// -- Pass Purchase Functions --

/**
 * Buy a lazy pass. Routes through CONTRACTS.GAME facade.
 * @param {string} affiliateCode - bytes32 affiliate code or ZeroHash
 */
export async function buyLazyPass(affiliateCode) {
  const level = get('game.level') || 0;
  const price = get('game.price');
  const priceWei = calcLazyPassPrice(level, price);
  const contract = getContract(CONTRACTS.GAME, PURCHASE_ABI);
  await sendTx(
    contract.purchaseLazyPass(ethers.ZeroAddress, { value: priceWei }),
    'Purchase Lazy Pass'
  );
  await refreshAfterAction();
}

/**
 * Buy whale bundle(s). Routes through CONTRACTS.GAME facade.
 * @param {number} qty - Number of bundles
 * @param {string} affiliateCode - bytes32 affiliate code or ZeroHash
 */
export async function buyWhaleBundle(qty, affiliateCode) {
  const level = get('game.level') || 0;
  const totalWei = calcWhaleBundlePrice(level, qty);
  const contract = getContract(CONTRACTS.GAME, PURCHASE_ABI);
  await sendTx(
    contract.purchaseWhaleBundle(ethers.ZeroAddress, BigInt(qty), { value: totalWei }),
    'Purchase Whale Bundle'
  );
  await refreshAfterAction();
}

/**
 * Buy a deity pass with the chosen symbol. Routes through CONTRACTS.GAME facade.
 * @param {number} symbolId - Symbol token ID (0-31)
 */
export async function buyDeityPass(symbolId) {
  const priceWei = await calcDeityPassPrice();
  const contract = getContract(CONTRACTS.GAME, PURCHASE_ABI);
  await sendTx(
    contract.purchaseDeityPass(ethers.ZeroAddress, symbolId, { value: priceWei }),
    'Purchase Deity Pass'
  );
  await refreshAfterAction();
}
