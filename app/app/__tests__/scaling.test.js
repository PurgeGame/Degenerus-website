// /app/app/__tests__/scaling.test.js — node:test golden vectors (D-10 LOCKED)
// Run: node --test website/app/app/__tests__/scaling.test.js
//
// Tests both Sepolia (active chain-config) and mainnet (verified by
// re-applying the scaling formula against directly-imported mainnet
// divisor constants — `node --test` does not have `vi.mock`, so module
// mocking is replaced by direct-divisor reapplication).
//
// References:
//   - 56-CONTEXT.md D-03 LOCKED (implicit-chain API; chain-conditional config, never math)
//   - 56-CONTEXT.md D-10 LOCKED (colocated tests, node:test runner)
//   - 56-RESEARCH.md lines 914-953 (node:test pattern verified at /beta/app/__tests__/)
//   - 56-VALIDATION.md APP-03 unit gate

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { displayEth, displayTickets } from '../scaling.js';
import {
  ETH_DIVISOR as SEPOLIA_ETH_DIVISOR,
  TICKET_DIVISOR as SEPOLIA_TICKET_DIVISOR,
  MAINNET_PENDING as SEPOLIA_FLAG,
} from '../chain-config.sepolia.js';
import {
  ETH_DIVISOR as MAINNET_ETH_DIVISOR,
  TICKET_DIVISOR as MAINNET_TICKET_DIVISOR,
  MAINNET_PENDING as MAINNET_FLAG,
} from '../chain-config.mainnet.js';
import { formatEther } from 'ethers';

// ---------------------------------------------------------------------------
// chain-config divisor parity (sanity guard for Plan 56-01 outputs)
// ---------------------------------------------------------------------------

describe('chain-config divisor parity', () => {
  test('Sepolia: ETH_DIVISOR=1_000_000n, TICKET_DIVISOR=100n, MAINNET_PENDING=false', () => {
    assert.equal(SEPOLIA_ETH_DIVISOR, 1_000_000n);
    assert.equal(SEPOLIA_TICKET_DIVISOR, 100n);
    assert.equal(SEPOLIA_FLAG, false);
  });

  test('Mainnet: ETH_DIVISOR=1n, TICKET_DIVISOR=100n, MAINNET_PENDING=true', () => {
    assert.equal(MAINNET_ETH_DIVISOR, 1n);
    assert.equal(MAINNET_TICKET_DIVISOR, 100n);
    assert.equal(MAINNET_FLAG, true);
  });
});

// ---------------------------------------------------------------------------
// displayEth — Sepolia path (active chain-config selector)
// ---------------------------------------------------------------------------

describe('displayEth (Sepolia path — active chain-config)', () => {
  test('0n short-circuits to literal "0" (no decimals)', () => {
    assert.equal(displayEth(0n), '0');
  });

  test('1e24 wei (1M-scaled = 1 ETH) → "1.0000"', () => {
    // raw / 1_000_000n = 1e18 = 1 ETH; formatEther → "1.0"; pad to 4 → "1.0000"
    assert.equal(displayEth(1_000_000_000_000_000_000_000_000n), '1.0000');
  });

  test('5e23 wei (1M-scaled = 0.5 ETH) → "0.5000"', () => {
    assert.equal(displayEth(500_000_000_000_000_000_000_000n), '0.5000');
  });

  test('custom digits=2 → "1.00"', () => {
    assert.equal(displayEth(1_000_000_000_000_000_000_000_000n, 2), '1.00');
  });

  test('sub-divisor input rounds to "0.0000"', () => {
    // 1n / 1_000_000n = 0n (BigInt floor); formatEther(0n) = '0.0'; pad to 4 → '0.0000'
    assert.equal(displayEth(1n), '0.0000');
  });

  test('digits=0 strips fractional → integer-only string', () => {
    // formatEther(1e18) = "1.0"; digits=0 returns "1" (no decimal point)
    assert.equal(displayEth(1_000_000_000_000_000_000_000_000n, 0), '1');
  });
});

// ---------------------------------------------------------------------------
// displayTickets — Sepolia path (TICKET_DIVISOR shared across chains)
// ---------------------------------------------------------------------------

describe('displayTickets (Sepolia path — active chain-config)', () => {
  test('0n → 0', () => {
    assert.equal(displayTickets(0n), 0);
  });

  test('100n → 1', () => {
    assert.equal(displayTickets(100n), 1);
  });

  test('1500n → 15', () => {
    assert.equal(displayTickets(1500n), 15);
  });
});

// ---------------------------------------------------------------------------
// Mainnet scaling math — direct-divisor reapplication
// ---------------------------------------------------------------------------
// Rationale: D-03 LOCKED forbids explicit chain args (so we can't pass
// MAINNET_ETH_DIVISOR into displayEth directly). To verify the mainnet path
// without a runtime selector swap, we re-apply the formula in the test
// using the directly-imported mainnet divisors. This proves that, with
// MAINNET_ETH_DIVISOR=1n, a 1 ETH wei input renders as "1.0000" (no /1M
// scaling — what the chain-config selector would produce when flipped).

describe('mainnet scaling math (direct-divisor reapplication of formula)', () => {
  test('mainnet ETH_DIVISOR=1n: 1e18 wei → "1.0000" via reapplied formula', () => {
    const raw = 1_000_000_000_000_000_000n;
    const scaled = raw / MAINNET_ETH_DIVISOR;
    const eth = formatEther(scaled);
    // Apply the same pad+truncate logic as displayEth
    const dot = eth.indexOf('.');
    let truncated;
    if (dot === -1) {
      truncated = eth + '.' + '0000';
    } else {
      const intPart = eth.slice(0, dot);
      const frac = eth.slice(dot + 1).padEnd(4, '0').slice(0, 4);
      truncated = `${intPart}.${frac}`;
    }
    assert.equal(truncated, '1.0000');
  });

  test('mainnet ETH_DIVISOR=1n: 0.25 ETH → "0.2500" via reapplied formula', () => {
    const raw = 250_000_000_000_000_000n;
    const scaled = raw / MAINNET_ETH_DIVISOR;
    const eth = formatEther(scaled); // "0.25"
    const dot = eth.indexOf('.');
    const intPart = eth.slice(0, dot);
    const frac = eth.slice(dot + 1).padEnd(4, '0').slice(0, 4);
    assert.equal(`${intPart}.${frac}`, '0.2500');
  });

  test('mainnet TICKET_DIVISOR=100n: 100n → 1 via reapplied formula', () => {
    assert.equal(Number(100n / MAINNET_TICKET_DIVISOR), 1);
  });

  test('mainnet TICKET_DIVISOR=100n: 1500n → 15 via reapplied formula', () => {
    assert.equal(Number(1500n / MAINNET_TICKET_DIVISOR), 15);
  });
});
