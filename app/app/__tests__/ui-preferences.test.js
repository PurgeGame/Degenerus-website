import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIGHTWEIGHT_MODE_STORAGE_KEY,
  readLightweightModePreference, writeLightweightModePreference, syncLightweightMode,
  AFKING_LOW_FUND_WARNING_STORAGE_KEY,
  ALL_IN_BUTTON_STORAGE_KEY,
  MINE_FLIP_BUTTON_STORAGE_KEY,
  HIDE_BALANCES_STORAGE_KEY,
  readHideBalancesPreference,
  writeHideBalancesPreference,
  syncBalancePrivacy,
  BIGGEST_BOUNTIES_MODE_STORAGE_KEY,
  REVEAL_AUTO_OPEN_STORAGE_KEY,
  readAfkingLowFundWarningPreference,
  readAllInButtonPreference,
  readMineFlipButtonPreference,
  readBiggestBountiesModePreference,
  readRevealAutoOpenPreference,
  subscribeUiPreferences,
  writeAfkingLowFundWarningPreference,
  writeAllInButtonPreference,
  writeMineFlipButtonPreference,
  writeBiggestBountiesModePreference,
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
  test('Hide balances defaults to No and persists ETH/Both choices for live consumers', (t) => {
    const seen = [];
    t.after(subscribeUiPreferences(detail => seen.push(detail)));
    const previousDocument = globalThis.document;
    const attributes = new Map();
    globalThis.document = { documentElement: { setAttribute: (key, value) => attributes.set(key, value) } };
    t.after(() => { globalThis.document = previousDocument; });
    assert.equal(readHideBalancesPreference(), 'none');
    for (const mode of ['eth', 'both', 'none']) {
      assert.equal(writeHideBalancesPreference(mode), mode);
      assert.equal(localStorage.getItem(HIDE_BALANCES_STORAGE_KEY), mode);
      assert.equal(readHideBalancesPreference(), mode);
      assert.equal(attributes.get('data-blur-balances'), mode, 'all balance surfaces update together');
      assert.deepEqual(seen.at(-1), { name: 'hideBalances', value: mode });
    }
    localStorage.setItem(HIDE_BALANCES_STORAGE_KEY, 'both');
    syncBalancePrivacy();
    assert.equal(attributes.get('data-blur-balances'), 'both', 'restores the saved mode on load');
    localStorage.setItem(HIDE_BALANCES_STORAGE_KEY, 'unexpected');
    assert.equal(readHideBalancesPreference(), 'none');
    assert.equal(writeHideBalancesPreference('unexpected'), 'none');
  });

  test('Mine FLIP defaults on, saves either choice, and notifies mounted consumers', (t) => {
    const seen = [];
    t.after(subscribeUiPreferences((detail) => seen.push(detail)));
    assert.equal(readMineFlipButtonPreference(), true);
    for (const enabled of [false, true]) {
      assert.equal(writeMineFlipButtonPreference(enabled), enabled);
      assert.equal(localStorage.getItem(MINE_FLIP_BUTTON_STORAGE_KEY), enabled ? '1' : '0');
      assert.equal(readMineFlipButtonPreference(), enabled);
      assert.deepEqual(seen.at(-1), { name: 'mineFlipButton', value: enabled });
    }
  });

  test('Mine FLIP can still be switched off when browser storage is unavailable', () => {
    const saved = globalThis.localStorage;
    globalThis.localStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    try {
      writeMineFlipButtonPreference(false);
      assert.equal(readMineFlipButtonPreference(), false);
      writeMineFlipButtonPreference(true);
      assert.equal(readMineFlipButtonPreference(), true);
    } finally {
      globalThis.localStorage = saved;
      writeMineFlipButtonPreference(true);
    }
  });

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

  test('Biggest Bounties defaults clickable, supports view-only, and can be hidden', () => {
    const seen = [];
    const unsubscribe = subscribeUiPreferences((detail) => seen.push(detail));
    assert.equal(readBiggestBountiesModePreference(), 'on');

    assert.equal(writeBiggestBountiesModePreference('view'), 'view');
    assert.equal(localStorage.getItem(BIGGEST_BOUNTIES_MODE_STORAGE_KEY), 'view');
    assert.equal(readBiggestBountiesModePreference(), 'view');
    assert.deepEqual(seen.at(-1), { name: 'biggestBountiesMode', value: 'view' });

    assert.equal(writeBiggestBountiesModePreference('off'), 'off');
    assert.equal(readBiggestBountiesModePreference(), 'off');
    assert.deepEqual(seen.at(-1), { name: 'biggestBountiesMode', value: 'off' });

    assert.equal(writeBiggestBountiesModePreference('unexpected'), 'on');
    assert.equal(readBiggestBountiesModePreference(), 'on');
    unsubscribe();
  });
});

test('Lightweight mode persists, notifies mounted consumers and works without storage', (t) => {
  const seen = [];
  const unsubscribe = subscribeUiPreferences(detail => seen.push(detail));
  t.after(unsubscribe);
  assert.equal(readLightweightModePreference(), false);
  writeLightweightModePreference(true);
  assert.equal(localStorage.getItem(LIGHTWEIGHT_MODE_STORAGE_KEY), '1');
  assert.equal(readLightweightModePreference(), true);
  assert.deepEqual(seen.at(-1), { name: 'lightweightMode', value: true });
  let applied;
  syncLightweightMode({ documentElement: { classList: { toggle: (name, value) => { applied = [name, value]; } } } });
  assert.deepEqual(applied, ['lightweight-mode', true]);
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  try {
    writeLightweightModePreference(true);
    assert.equal(readLightweightModePreference(), true);
    writeLightweightModePreference(false);
    assert.equal(readLightweightModePreference(), false);
  } finally { globalThis.localStorage = saved; writeLightweightModePreference(false); }
});
