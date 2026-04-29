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
      'You must mint a lootbox today before claiming.',
      'Open a lootbox first, then retry.'],
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
    // Pitfall 4 alias: "WindowClosed" semantics → NotDecimatorWindow (BurnieCoin.sol:109)
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
      userMessage: 'No lootboxes left for today.',
      recoveryAction: 'Try again tomorrow.',
    });
    const result = decodeRevertReason({ revert: { name: 'LootboxSoldOut' } });
    assert.equal(result.code, 'LootboxSoldOut');
    assert.equal(result.userMessage, 'No lootboxes left for today.');
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
    assert.match(decoded.userMessage, /BURNIE.*blocked|game-over/i);
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
