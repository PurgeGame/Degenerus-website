// viewer/utils.js -- Utility functions for viewer page
// Does NOT import from app/utils.js (it imports ethers at line 1) -- SHELL-01

// Testnet display scaling. ONLY ETH is /1M-scaled on-chain by the Sepolia deploy —
// FLIP and DGNRS are stored unscaled — so the two need DIFFERENT multipliers. They
// shared one constant here until 2026-07-28, which forced a choice between a correct
// ETH figure and a correct FLIP figure; at 1n the draw board's per-quadrant ETH
// amounts came out 1e6 too small and floored to "0 ETH".
//
// Mirrors app/app/scaling.js, which has always kept them apart (displayEth multiplies
// by ETH_DIVISOR, displayToken does not). Mainnet cutover sets ETH_DISPLAY_SCALE back
// to 1n; TOKEN_DISPLAY_SCALE stays 1n on every chain.
export const ETH_DISPLAY_SCALE = 1_000_000n;
const TOKEN_DISPLAY_SCALE = 1n;

/** Truncate 0x address to "0x1234...abcd" format. */
export function truncateAddress(address) {
  if (!address) return '';
  return address.slice(0, 6) + '...' + address.slice(-4);
}

/**
 * Divide weiString by 10^decimals, return numeric value. Pure BigInt -- no ethers dependency.
 * `scale` is the testnet display multiplier — ETH_DISPLAY_SCALE for ETH amounts,
 * TOKEN_DISPLAY_SCALE for FLIP/DGNRS. Defaults to ETH so existing ETH callers are
 * unchanged; token callers must pass TOKEN_DISPLAY_SCALE explicitly.
 */
export function formatWei(weiString, decimals, scale = ETH_DISPLAY_SCALE) {
  if (!weiString || weiString === '0') return 0;
  const wei = BigInt(weiString) * scale;
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

/** Format FLIP wei string to human-readable string. FLIP is NOT /1M-scaled on testnet. */
export function formatFlip(weiString) {
  if (!weiString || weiString === '0') return '0';
  const num = formatWei(weiString, 18, TOKEN_DISPLAY_SCALE);
  if (num < 1) return num.toFixed(2);
  return Math.floor(num).toLocaleString();
}
