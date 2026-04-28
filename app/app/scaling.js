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
 * Reads ETH_DIVISOR from the chain-config singleton. On Sepolia
 * (`ETH_DIVISOR = 1_000_000n`) the raw is descaled by /1M before
 * `formatEther`; on mainnet (`ETH_DIVISOR = 1n`) the raw is forwarded
 * unchanged. The fractional portion is zero-padded to `digits` so the
 * UI gets a stable-width string.
 *
 * WR-04: 0n flows through the same pad-to-digits path as every other
 * input, so `displayEth(0n)` and `displayEth(1n)` render to the same
 * width ("0.0000"). This avoids tabular-nums layout shift when a status
 * bar transitions from initial-zero to first-poll value.
 *
 * @param {bigint} raw - On-chain wei amount (post-/1M-scaling on Sepolia)
 * @param {number} [digits=4] - Decimal places to render (zero-padded)
 * @returns {string} Formatted ETH string (e.g. "1.0000", "0.5000", "0.0000")
 */
export function displayEth(raw, digits = 4) {
  const scaled = raw / ETH_DIVISOR;
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
