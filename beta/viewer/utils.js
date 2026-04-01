// viewer/utils.js -- Utility functions for viewer page
// Does NOT import from app/utils.js (it imports ethers at line 1) -- SHELL-01

/** Truncate 0x address to "0x1234...abcd" format. */
export function truncateAddress(address) {
  if (!address) return '';
  return address.slice(0, 6) + '...' + address.slice(-4);
}

/** Divide weiString by 10^decimals, return numeric value. Pure BigInt -- no ethers dependency. */
export function formatWei(weiString, decimals) {
  if (!weiString || weiString === '0') return 0;
  const wei = BigInt(weiString);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = wei / divisor;
  const remainder = wei % divisor;
  const fracStr = remainder.toString().padStart(decimals, '0').slice(0, 6);
  return parseFloat(`${whole}.${fracStr}`);
}

/** Format ETH wei string to human-readable string. Precision tiers match app/utils.js. */
export function formatEth(weiString) {
  if (!weiString || weiString === '0') return '0';
  const num = formatWei(weiString, 18);
  if (num === 0) return '0';
  if (num < 0.001) return '<0.001';
  if (num < 1) return num.toFixed(4);
  if (num < 100) return num.toFixed(3);
  return num.toFixed(2);
}

/** Format BURNIE wei string to human-readable string. */
export function formatBurnie(weiString) {
  if (!weiString || weiString === '0') return '0';
  const num = formatWei(weiString, 18);
  if (num < 1) return num.toFixed(2);
  return Math.floor(num).toLocaleString();
}
