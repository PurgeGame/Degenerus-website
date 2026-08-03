// /app/app/scaling.js — Phase 56 APP-03 (D-03 LOCKED)
// Centralized display-math: chain-conditional config, never chain-conditional math.
// Mitigates v4.4 BAF + v4.5 /1M scaleEth regression class (Pitfall 2).
//
// Divisors are sourced from chain-config.js (single source of truth for ETH_DIVISOR
// and TICKET_DIVISOR). Mainnet cutover swaps the chain-config selector — these
// functions need ZERO changes. NO RAW `/100n` OR `/1_000_000n` LITERALS may exist
// anywhere in /app/ outside this module + chain-config.{sepolia,mainnet}.js
// (Plan 56-05 enforces the final divisor sweep grep gate).
//
// References:
//   - 56-CONTEXT.md D-03 LOCKED (implicit-chain `displayEth(raw)` + `displayTickets(raw)`)
//   - 56-RESEARCH.md lines 621-656 (canonical code shape)
//   - 56-VALIDATION.md APP-03 unit gate

import { ETH_DIVISOR, TICKET_DIVISOR } from './chain-config.js';
import { formatEther } from 'ethers';

/**
 * Format a raw on-chain ETH BigInt for display.
 *
 * Reads ETH_DIVISOR from the chain-config singleton. The testnet contracts
 * are deployed with /1M-scaled wei amounts (0.01 ether costs 1e10 wei
 * on-chain), so display MULTIPLIES raw by ETH_DIVISOR to render the
 * mainnet-equivalent number the player thinks in. On mainnet
 * (`ETH_DIVISOR = 1n`) the raw is forwarded unchanged.
 * (Phase 64 fix: this previously divided, which rendered every scaled
 * testnet amount as "0.0000".)
 *
 * WR-04: 0n flows through the same pad-to-digits path as every other
 * input, so `displayEth(0n)` and `displayEth(1n)` render to the same
 * width ("0.0000"). This avoids tabular-nums layout shift when a status
 * bar transitions from initial-zero to first-poll value.
 *
 * @param {bigint} raw - On-chain wei amount (/1M-scaled on testnet)
 * @param {number} [digits=4] - Decimal places to render (zero-padded)
 * @returns {string} Formatted ETH string (e.g. "1.0000", "0.5000", "0.0000")
 */
export function displayEth(raw, digits = 4) {
  const scaled = raw * ETH_DIVISOR;
  const eth = formatEther(scaled);
  const dot = eth.indexOf('.');
  if (dot === -1) {
    return digits > 0 ? eth + '.' + '0'.repeat(digits) : eth;
  }
  const intPart = eth.slice(0, dot);
  const frac = eth.slice(dot + 1).padEnd(digits, '0').slice(0, digits);
  return digits > 0 ? `${intPart}.${frac}` : intPart;
}

/**
 * Format a raw UNSCALED 18-decimal token amount (FLIP / DGNRS) for display.
 *
 * FLIP and DGNRS are NOT /1M-scaled on testnet (only ETH is — RESEARCH Q5),
 * so this is a plain formatEther. Coin amounts render as whole units by
 * default; callers can still request fixed precision for non-UI calculations.
 *
 * @param {bigint} raw - On-chain token wei (18 decimals, unscaled)
 * @param {number} [digits=0] - Decimal places to render (whole coins by default)
 * @returns {string} Formatted token string
 */
export function displayToken(raw, digits = 0) {
  const eth = formatEther(raw);
  const dot = eth.indexOf('.');
  if (dot === -1) {
    return digits > 0 ? eth + '.' + '0'.repeat(digits) : eth;
  }
  const intPart = eth.slice(0, dot);
  const frac = eth.slice(dot + 1).padEnd(digits, '0').slice(0, digits);
  return digits > 0 ? `${intPart}.${frac}` : intPart;
}

/**
 * Format an 18-decimal token amount while repairing only microscopic input
 * conversion dust around a whole token. Older UI builds converted decimal
 * strings through Number before sending them, so an intended 50,000 FLIP can
 * exist on-chain as 49,999.999999999995805696. Values farther than one
 * millionth of a token from a whole number remain untouched.
 */
export function displayTokenSnapped(raw, digits = 0) {
  const value = BigInt(raw ?? 0);
  const unit = 10n ** 18n;
  const tolerance = 10n ** 12n;
  const sign = value < 0n ? -1n : 1n;
  const magnitude = value < 0n ? -value : value;
  const remainder = magnitude % unit;
  let snapped = magnitude;
  if (remainder <= tolerance) snapped -= remainder;
  else if (unit - remainder <= tolerance) snapped += unit - remainder;
  return displayToken(snapped * sign, digits);
}

/**
 * Format a raw on-chain ticket count BigInt for display.
 *
 * Reads TICKET_DIVISOR from the chain-config singleton. Both chains
 * use `TICKET_DIVISOR = 100n` (BAF scaling — Phase 46 TIX-01..04
 * close-out). Returns a Number for direct UI rendering.
 *
 * @param {bigint} raw - On-chain ticket count (×TICKET_SCALE)
 * @returns {number} Display ticket count (integer; BigInt floor-divide)
 */
export function displayTickets(raw) {
  return Number(raw / TICKET_DIVISOR);
}
