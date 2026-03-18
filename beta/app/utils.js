// app/utils.js -- Formatting helpers used across all components

import { ethers } from 'ethers';
import { ETHERSCAN_BASE } from './constants.js';

export function formatEth(weiString) {
  if (!weiString || weiString === '0') return '0';
  const val = ethers.formatEther(weiString);
  const num = parseFloat(val);
  if (num === 0) return '0';
  if (num < 0.001) return '<0.001';
  if (num < 1) return num.toFixed(4);
  if (num < 100) return num.toFixed(3);
  return num.toFixed(2);
}

export function formatBurnie(weiString) {
  if (!weiString || weiString === '0') return '0';
  const val = ethers.formatEther(weiString);
  const num = parseFloat(val);
  if (num < 1) return num.toFixed(2);
  if (num < 1000) return Math.floor(num).toLocaleString();
  return Math.floor(num).toLocaleString();
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
