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

  test('register a 4-byte-selector keyed mapping (downstream selector lookup)', () => {
    register('0xabcdef12', {
      code: 'CustomSelectorError',
      userMessage: 'Custom error.',
      recoveryAction: 'Retry.',
    });
    const result = decodeRevertReason({ revert: { name: '0xabcdef12' } });
    assert.equal(result.code, 'CustomSelectorError');
  });
});
