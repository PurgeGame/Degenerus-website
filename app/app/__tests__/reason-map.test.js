// /app/app/__tests__/reason-map.test.js — APP-05 unit (D-10 + D-11 LOCKED)
// Run: node --test website/app/app/__tests__/reason-map.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRevertReason, register } from '../reason-map.js';

describe('seeded codes (D-11 LOCKED + Pitfall 4 reconciliation)', () => {
  // Each row: [errorName, expectedUserMessage, expectedRecoveryAction]
  // Verbatim copy per CONTEXT D-11 + Pitfall 4 aliases.
  const cases = [
    ['NotTimeYet',
      "It's not time for this action yet — wait for the next phase.",
      'Wait and try again.'],
    ['MustMintToday',
      'You must mint a luckbox today before claiming.',
      'Open a luckbox first, then retry.'],
    ['RngNotReady',
      'Random outcome is still being generated. Try again in a few seconds.',
      'Wait 10s and retry.'],
    ['E',
      'An unexpected error occurred. Please try again.',
      'Retry; if it persists, refresh the page.'],
    // Pitfall 4 alias: "Taken" semantics → InvalidToken (DegenerusDeityPass.sol:50)
    ['InvalidToken',
      "Someone else already claimed this — try a different one.",
      'Pick a different option and retry.'],
    // Pitfall 4 alias: "WindowClosed" semantics → NotDecimatorWindow (FLIP.sol:109)
    ['NotDecimatorWindow',
      'The decimator claim window is closed.',
      'Check upcoming windows in the calendar.'],
  ];

  for (const [name, userMessage, recoveryAction] of cases) {
    test(`decodes ${name} via error.revert.name`, () => {
      const result = decodeRevertReason({ revert: { name } });
      assert.equal(result.code, name);
      assert.equal(result.userMessage, userMessage);
      assert.equal(result.recoveryAction, recoveryAction);
    });
  }
});

describe('UNKNOWN catch-all', () => {
  test('unknown error name falls through to UNKNOWN', () => {
    const result = decodeRevertReason({ revert: { name: 'TotallyMadeUp' } });
    assert.equal(result.code, 'UNKNOWN');
    assert.match(result.userMessage, /Unexpected error/);
    assert.match(result.recoveryAction, /Refresh/);
  });

  test('null error returns UNKNOWN', () => {
    assert.equal(decodeRevertReason(null).code, 'UNKNOWN');
  });

  test('undefined error returns UNKNOWN', () => {
    assert.equal(decodeRevertReason(undefined).code, 'UNKNOWN');
  });

  test('error with no revert and no reason returns UNKNOWN', () => {
    const result = decodeRevertReason({ message: 'something else' });
    assert.equal(result.code, 'UNKNOWN');
  });
});

describe('application write guards', () => {
  test('preserves the configured-chain instruction instead of returning UNKNOWN', () => {
    const decoded = decodeRevertReason(
      new Error('Wrong network — switch to Base Sepolia.'),
    );
    assert.equal(decoded.code, 'WrongNetwork');
    assert.equal(decoded.userMessage, 'Wrong network — switch to Base Sepolia.');
    assert.match(decoded.recoveryAction, /approve.*Base Sepolia/i);
  });
});

describe('native wallet balance failures', () => {
  test('decodes the ethers INSUFFICIENT_FUNDS code', () => {
    const decoded = decodeRevertReason({
      code: 'INSUFFICIENT_FUNDS',
      shortMessage: 'insufficient funds for intrinsic transaction cost',
    });
    assert.equal(decoded.code, 'InsufficientWalletFunds');
    assert.match(decoded.userMessage, /enough ETH/i);
    assert.match(decoded.recoveryAction, /extra for gas/i);
  });

  test('decodes Base RPC OutOfFunds through ethers nested provider data', () => {
    const decoded = decodeRevertReason({
      code: 'UNKNOWN_ERROR',
      info: {
        error: { code: -32003, message: 'EVM error: OutOfFunds' },
        payload: { method: 'eth_call' },
      },
    });
    assert.equal(decoded.code, 'InsufficientWalletFunds');
    assert.match(decoded.userMessage, /transaction and network fee/i);
  });

  test('decodes OutOfFunds when a wallet supplies it only as the nested code', () => {
    const decoded = decodeRevertReason({
      error: { code: 'OutOfFunds' },
    });
    assert.equal(decoded.code, 'InsufficientWalletFunds');
  });

  test('does not confuse a Solidity Insufficient custom error with wallet ETH', () => {
    const decoded = decodeRevertReason({
      revert: { name: 'Insufficient' },
      reason: 'execution reverted with custom error Insufficient()',
    });
    assert.equal(decoded.code, 'UNKNOWN');
  });
});

describe('require-string fallback (legacy reverts)', () => {
  test('error.reason containing seeded key matches mapping', () => {
    const result = decodeRevertReason({ reason: 'execution reverted: NotTimeYet' });
    assert.equal(result.code, 'NotTimeYet');
  });

  test('error.shortMessage fallback', () => {
    const result = decodeRevertReason({ shortMessage: 'reverted with error MustMintToday' });
    assert.equal(result.code, 'MustMintToday');
  });

  test('reason takes precedence over shortMessage', () => {
    const result = decodeRevertReason({
      reason: 'reverted: RngNotReady',
      shortMessage: 'reverted: NotTimeYet',
    });
    assert.equal(result.code, 'RngNotReady');
  });
});

describe('register() extension', () => {
  test('register adds new mapping; decodeRevertReason returns it', () => {
    register('LootboxSoldOut', {
      code: 'LootboxSoldOut',
      userMessage: 'No Luckbox left for today.',
      recoveryAction: 'Try again tomorrow.',
    });
    const result = decodeRevertReason({ revert: { name: 'LootboxSoldOut' } });
    assert.equal(result.code, 'LootboxSoldOut');
    assert.equal(result.userMessage, 'No Luckbox left for today.');
    assert.equal(result.recoveryAction, 'Try again tomorrow.');
  });

  test('idempotent re-register replaces prior mapping', () => {
    register('TestKey', { code: 'TestKey', userMessage: 'first', recoveryAction: 'a' });
    register('TestKey', { code: 'TestKey', userMessage: 'second', recoveryAction: 'b' });
    const result = decodeRevertReason({ revert: { name: 'TestKey' } });
    assert.equal(result.userMessage, 'second');
    assert.equal(result.recoveryAction, 'b');
  });

  test('register a 4-byte-selector keyed mapping (downstream selector lookup via error.revert.selector)', () => {
    register('0xabcdef12', {
      code: 'CustomSelectorError',
      userMessage: 'Custom error.',
      recoveryAction: 'Retry.',
    });
    // WR-03: lookup must honor error.revert.selector (the canonical ethers v6
    // shape for ABI-unresolved custom errors), not just error.revert.name.
    const result = decodeRevertReason({ revert: { selector: '0xabcdef12' } });
    assert.equal(result.code, 'CustomSelectorError');
  });

  test('selector keyed mapping resolves via error.data prefix when revert is absent', () => {
    register('0xdeadbeef', {
      code: 'DataPrefixSelector',
      userMessage: 'Selector via data prefix.',
      recoveryAction: 'Retry.',
    });
    const result = decodeRevertReason({ data: '0xdeadbeef0000000000' });
    assert.equal(result.code, 'DataPrefixSelector');
  });
});

describe('Plan 60-02 reason-map extensions (LBX write-path errors)', () => {
  test('GameOverPossible decodes to user-facing message + recovery', () => {
    const decoded = decodeRevertReason({ revert: { name: 'GameOverPossible' } });
    assert.equal(decoded.code, 'GameOverPossible');
    assert.match(decoded.userMessage, /FLIP.*blocked|game-over/i);
    assert.match(decoded.recoveryAction, /next jackpot|ETH/i);
  });

  test('AfKingLockActive decodes to user-facing message + recovery', () => {
    const decoded = decodeRevertReason({ revert: { name: 'AfKingLockActive' } });
    assert.equal(decoded.code, 'AfKingLockActive');
    assert.match(decoded.userMessage, /lock|paused/i);
    assert.match(decoded.recoveryAction, /try again|few minutes/i);
  });

  test('NotApproved decodes to user-facing message + recovery', () => {
    const decoded = decodeRevertReason({ revert: { name: 'NotApproved' } });
    assert.equal(decoded.code, 'NotApproved');
    assert.match(decoded.userMessage, /not approved|approved to act/i);
    assert.match(decoded.recoveryAction, /your own wallet|connect/i);
  });
});

describe('WR-02 regressions: catch-all "E" must not hijack substring-fallback path', () => {
  test('reason "Error: insufficient gas" does NOT classify as E', () => {
    const result = decodeRevertReason({ reason: 'Error: insufficient gas' });
    assert.equal(result.code, 'UNKNOWN');
  });

  test('reason "InvalidToken: Error context" matches InvalidToken (not E)', () => {
    const result = decodeRevertReason({ reason: 'reverted with InvalidToken: Error context' });
    assert.equal(result.code, 'InvalidToken');
  });

  test('reason "VRFCoordinator failure" does NOT classify as E', () => {
    const result = decodeRevertReason({ reason: 'VRFCoordinator failure' });
    assert.equal(result.code, 'UNKNOWN');
  });

  test('error.revert.name === "E" still resolves via the revert.name path', () => {
    const result = decodeRevertReason({ revert: { name: 'E' } });
    assert.equal(result.code, 'E');
  });
});

describe('Phase 63 (Plan 63-01) WalletConnect error-code extensions', () => {
  test('UserRejected decodes to user-facing message + recovery (4001)', () => {
    const decoded = decodeRevertReason({ revert: { name: 'UserRejected' } });
    assert.equal(decoded.code, 'UserRejected');
    assert.match(decoded.userMessage, /rejected the connection/i);
    assert.match(decoded.recoveryAction, /tap Connect|retry/i);
  });

  test('SessionExpired decodes to user-facing message + recovery', () => {
    const decoded = decodeRevertReason({ revert: { name: 'SessionExpired' } });
    assert.equal(decoded.code, 'SessionExpired');
    assert.match(decoded.userMessage, /session expired|reconnect/i);
    assert.match(decoded.recoveryAction, /new session|tap Connect/i);
  });

  test('RateLimited decodes to user-facing message + recovery (HTTP 429/1013)', () => {
    const decoded = decodeRevertReason({ revert: { name: 'RateLimited' } });
    assert.equal(decoded.code, 'RateLimited');
    assert.match(decoded.userMessage, /too many requests|wait a moment/i);
    assert.match(decoded.recoveryAction, /retry/i);
  });

  test('ProjectIdInvalid decodes to user-facing message + recovery (HTTP 401/403)', () => {
    const decoded = decodeRevertReason({ revert: { name: 'ProjectIdInvalid' } });
    assert.equal(decoded.code, 'ProjectIdInvalid');
    assert.match(decoded.userMessage, /WalletConnect.*configuration|contact support/i);
    assert.match(decoded.recoveryAction, /refresh|file a bug/i);
  });

  test('USER_DISCONNECTED decodes to user-facing message + recovery (WC disconnect event)', () => {
    const decoded = decodeRevertReason({ revert: { name: 'USER_DISCONNECTED' } });
    assert.equal(decoded.code, 'USER_DISCONNECTED');
    assert.match(decoded.userMessage, /wallet disconnected/i);
    assert.match(decoded.recoveryAction, /reconnect|tap Connect/i);
  });
});

// ===========================================================================
// Solidity Panic(uint256) — added 2026-07-29. Not a custom error, so it never
// matched the registry: an under-funded token burn (balanceOf -= amount) landed
// in the UNKNOWN catch-all and read as "unexpected error".
// ===========================================================================

describe('Solidity panic decoding', () => {
  const panicData = (code) => '0x4e487b71' + code.toString(16).padStart(64, '0');

  test('0x11 (arithmetic underflow) reads as a balance problem', () => {
    const decoded = decodeRevertReason({ data: panicData(0x11) });
    assert.equal(decoded.code, 'Panic:0x11');
    assert.match(decoded.userMessage, /balance/i);
  });

  test('panic code is read from ethers reason text too', () => {
    const decoded = decodeRevertReason({
      reason: 'panic code 0x11 (Arithmetic operation overflowed outside of an unchecked block)',
    });
    assert.equal(decoded.code, 'Panic:0x11');
  });

  test('0x12 divide-by-zero and 0x01 assert have their own messages', () => {
    assert.equal(decodeRevertReason({ data: panicData(0x12) }).code, 'Panic:0x12');
    assert.equal(decodeRevertReason({ data: panicData(0x01) }).code, 'Panic:0x01');
  });

  test('an unlisted panic code still decodes as a panic, not UNKNOWN', () => {
    const decoded = decodeRevertReason({ data: panicData(0x41) });
    assert.equal(decoded.code, 'Panic');
    assert.notEqual(decoded.code, 'UNKNOWN');
  });

  test('a normal custom error is unaffected', () => {
    assert.equal(decodeRevertReason({ revert: { name: 'RngNotReady' } }).code, 'RngNotReady');
    assert.equal(decodeRevertReason({ data: '0x969bf728' }).code, 'UNKNOWN',
      'an unregistered selector still falls through (NothingToClaim registers in claims.js)');
  });
});
