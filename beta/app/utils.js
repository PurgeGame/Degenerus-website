// app/utils.js -- Formatting helpers used across all components

import { ethers } from 'ethers';
import { ETHERSCAN_BASE, ETH_DISPLAY_SCALE, TOKEN_DISPLAY_SCALE } from './constants.js';

export function formatEth(weiString) {
  if (!weiString || weiString === '0') return '0';
  const scaled = BigInt(weiString) * ETH_DISPLAY_SCALE;
  const val = ethers.formatEther(scaled);
  const num = parseFloat(val);
  if (num === 0) return '0';
  if (num < 0.001) return '<0.001';
  if (num < 1) return num.toFixed(4);
  if (num < 100) return num.toFixed(3);
  return num.toFixed(2);
}

export function formatFlip(weiString) {
  if (!weiString || weiString === '0') return '0';
  try {
    const whole = (BigInt(weiString) * TOKEN_DISPLAY_SCALE) / (10n ** 18n);
    return whole.toLocaleString();
  } catch {
    return '0';
  }
}

export function truncateAddress(address) {
  if (!address) return '';
  return address.slice(0, 6) + '...' + address.slice(-4);
}

export function txUrl(hash) {
  return `${ETHERSCAN_BASE}/tx/${hash}`;
}

export function addressUrl(address) {
  return `${ETHERSCAN_BASE}/address/${address}`;
}

export function formatScore(bps) {
  return (bps / 10000).toFixed(2);
}
