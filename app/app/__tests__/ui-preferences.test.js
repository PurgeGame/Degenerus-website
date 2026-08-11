import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AFKING_LOW_FUND_WARNING_STORAGE_KEY,
  ALL_IN_BUTTON_STORAGE_KEY,
  REVEAL_AUTO_OPEN_STORAGE_KEY,
  readAfkingLowFundWarningPreference,
  readAllInButtonPreference,
  readRevealAutoOpenPreference,
  subscribeUiPreferences,
  writeAfkingLowFundWarningPreference,
  writeAllInButtonPreference,
  writeRevealAutoOpenPreference,
} from '../ui-preferences.js';

globalThis.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.get(String(key)) ?? null; },
  setItem(key, value) { this.values.set(String(key), String(value)); },
  clear() { this.values.clear(); },
};

beforeEach(() => localStorage.clear());

describe('shared UI preferences', () => {
  test('automatic reveals stay opt-in and notify live consumers', () => {
    const seen = [];
    const unsubscribe = subscribeUiPreferences((detail) => seen.push(detail));
    assert.equal(readRevealAutoOpenPreference(), false);
    assert.equal(writeRevealAutoOpenPreference(true), true);
    assert.equal(localStorage.getItem(REVEAL_AUTO_OPEN_STORAGE_KEY), '1');
    assert.equal(readRevealAutoOpenPreference(), true);
    assert.deepEqual(seen.at(-1), { name: 'revealAutoOpen', value: true });
    unsubscribe();
  });

  test('ALL IN remains visible by default but honors an explicit off choice', () => {
    const seen = [];
    const unsubscribe = subscribeUiPreferences((detail) => seen.push(detail));
    assert.equal(readAllInButtonPreference(), true);
    assert.equal(writeAllInButtonPreference(false), false);
    assert.equal(localStorage.getItem(ALL_IN_BUTTON_STORAGE_KEY), '0');
    assert.equal(readAllInButtonPreference(), false);
    assert.deepEqual(seen.at(-1), { name: 'allInButton', value: false });
    unsubscribe();
  });

  test('the AFKing runway warning defaults on and can be ignored in this browser', () => {
    const seen = [];
    const unsubscribe = subscribeUiPreferences((detail) => seen.push(detail));
    assert.equal(readAfkingLowFundWarningPreference(), true);
    assert.equal(writeAfkingLowFundWarningPreference(false), false);
    assert.equal(localStorage.getItem(AFKING_LOW_FUND_WARNING_STORAGE_KEY), '0');
    assert.equal(readAfkingLowFundWarningPreference(), false);
    assert.deepEqual(seen.at(-1), { name: 'afkingLowFundWarning', value: false });
    unsubscribe();
  });
});
