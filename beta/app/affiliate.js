// app/affiliate.js -- Affiliate business logic: code creation, referral input, earnings reads
// Components should import these functions rather than importing ethers or calling contracts directly.

import { ethers } from 'ethers';
import { getContract, sendTx, getReadProvider } from './contracts.js';
import { get, update, batch } from './store.js';
import { CONTRACTS, AFFILIATE_ABI } from './constants.js';
import { refreshAfterAction, fetchJSON } from './api.js';

// -- Constants --
const CODE_PATTERN = /^[A-Za-z0-9]{3,31}$/;
const MAX_KICKBACK = 25;
const REFERRER_STORAGE_KEY = 'degenerus_referrer_code';

/**
 * Create a new affiliate referral code on-chain.
 * @param {string} codeStr - Alphanumeric code (3-31 chars)
 * @param {number} kickbackPct - Kickback percentage (0-25)
 * @returns {Promise<object>} Transaction receipt
 */
export async function createCode(codeStr, kickbackPct) {
  if (!CODE_PATTERN.test(codeStr)) {
    throw new Error('Code must be 3-31 alphanumeric characters');
  }
  const pct = parseInt(kickbackPct, 10);
  if (isNaN(pct) || pct < 0 || pct > MAX_KICKBACK) {
    throw new Error('Kickback must be 0-25%');
  }

  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  const upperCode = codeStr.toUpperCase();
  const encodedCode = ethers.encodeBytes32String(upperCode);
  const contract = getContract(CONTRACTS.AFFILIATE, AFFILIATE_ABI);
  const receipt = await sendTx(
    contract.createAffiliateCode(encodedCode, pct),
    'Create affiliate code'
  );

  update('affiliate.code', upperCode);

  // Persist to localStorage so it survives page refresh
  try {
    localStorage.setItem(`degenerus_affiliate_code_${playerAddress}`, upperCode);
  } catch { /* ignore */ }

  await refreshAfterAction();
  return receipt;
}

/**
 * Register as referred by an affiliate code on-chain.
 * @param {string} codeStr - Affiliate code to register under
 * @returns {Promise<object>} Transaction receipt
 */
export async function referPlayer(codeStr) {
  if (!codeStr || !codeStr.trim()) {
    throw new Error('Enter a referral code');
  }

  const playerAddress = get('player.address');
  if (!playerAddress) throw new Error('Wallet not connected');

  // Check if already referred to prevent locked-code reverts
  const existingReferrer = await getReferrerAddress(playerAddress);
  if (existingReferrer && existingReferrer !== ethers.ZeroAddress) {
    throw new Error('Already referred to another code');
  }

  const upperCode = codeStr.trim().toUpperCase();
  const encodedCode = ethers.encodeBytes32String(upperCode);
  const contract = getContract(CONTRACTS.AFFILIATE, AFFILIATE_ABI);
  const receipt = await sendTx(
    contract.referPlayer(encodedCode),
    'Set referral code'
  );

  await refreshAfterAction();
  return receipt;
}

/**
 * Fetch affiliate state for a player and update store.
 * Non-critical: fails silently.
 * @param {string} address - Player wallet address
 */
export async function fetchAffiliateState(address) {
  if (!address) return;

  try {
    // Read referrer from contract
    const referrer = await getReferrerAddress(address);
    if (referrer && referrer !== ethers.ZeroAddress) {
      update('affiliate.referredBy', referrer);
    }

    // Read earnings from DB API
    try {
      const data = await fetchJSON('/player/' + address);
      if (data && data.totalAffiliateEarned) {
        update('affiliate.totalEarned', data.totalAffiliateEarned);
      }
    } catch { /* API read failed; non-critical */ }

    // Read stored affiliate code from localStorage
    try {
      const storedCode = localStorage.getItem(`degenerus_affiliate_code_${address}`);
      if (storedCode) {
        update('affiliate.code', storedCode);
      }
    } catch { /* localStorage unavailable */ }
  } catch {
    // Contract read failed; non-critical
  }
}

/**
 * Capture referral code from URL query parameters.
 * Checks: ref, referral, code (in priority order).
 * Stores in localStorage and cleans URL params.
 * @returns {string|null} The captured code, or null
 */
export function captureReferralFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('ref') || params.get('referral') || params.get('code') || '').trim();

  if (!code) return null;

  const upperCode = code.toUpperCase();
  try {
    localStorage.setItem(REFERRER_STORAGE_KEY, upperCode);
  } catch { /* ignore */ }

  // Clean URL params without page reload
  params.delete('ref');
  params.delete('referral');
  params.delete('code');
  const cleanUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  history.replaceState(null, '', cleanUrl);

  return upperCode;
}

/**
 * Read stored referral code from localStorage.
 * @returns {string|null} The stored code, or null
 */
export function getStoredReferralCode() {
  try {
    return localStorage.getItem(REFERRER_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

// -- Internal helpers --

/**
 * Read referrer address from contract (read-only, no wallet needed).
 * @param {string} address - Player address
 * @returns {Promise<string>} Referrer address or ZeroAddress
 */
async function getReferrerAddress(address) {
  const contract = new ethers.Contract(CONTRACTS.AFFILIATE, AFFILIATE_ABI, getReadProvider());
  return await contract.getReferrer(address);
}
