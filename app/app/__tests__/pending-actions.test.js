// /app/app/__tests__/pending-actions.test.js

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  publishPendingActions,
  clearPendingActions,
  dismissPendingActionItems,
  getPendingActions,
  pendingSourceHasPublished,
  subscribePendingActions,
  PENDING_DISMISSALS_STORAGE_KEY,
  __setPendingDismissStorageForTest,
  __resetPendingActionsForTest,
} from '../pending-actions.js';

const dismissalStorage = {
  values: new Map(),
  getItem(key) { return this.values.get(String(key)) ?? null; },
  setItem(key, value) { this.values.set(String(key), String(value)); },
  removeItem(key) { this.values.delete(String(key)); },
  clear() { this.values.clear(); },
};

describe('pending-actions registry', () => {
  beforeEach(() => {
    dismissalStorage.clear();
    __setPendingDismissStorageForTest(dismissalStorage);
    __resetPendingActionsForTest();
  });

  test('providers replace only their own rows and stay in protocol chronology across states', () => {
    publishPendingActions('boxes', [
      { id: 'box:1', label: 'Box 1', state: 'waiting', order: 20 },
      { id: 'box:2', label: 'Box 2', state: 'ready', run() {}, order: 20 },
    ]);
    publishPendingActions('pari', [
      { id: 'pari:7', label: 'Pari 7', state: 'busy', order: 30 },
    ]);
    assert.deepEqual(
      getPendingActions().map((item) => [item.id, item.state]),
      [['box:1', 'waiting'], ['box:2', 'ready'], ['pari:7', 'busy']],
    );

    publishPendingActions('boxes', [{ id: 'box:3', label: 'Box 3', state: 'waiting' }]);
    assert.deepEqual(getPendingActions().map((item) => item.id), ['pari:7', 'box:3']);
  });

  test('explicit chronology orders siblings and readiness changes do not reshuffle them', () => {
    const run = () => {};
    publishPendingActions('boxes', [
      { id: 'new', label: 'New', state: 'ready', order: 20, chronology: 200, run },
      { id: 'old', label: 'Old', state: 'waiting', order: 20, chronology: 100 },
    ]);
    assert.deepEqual(getPendingActions().map((item) => item.id), ['old', 'new']);

    publishPendingActions('boxes', [
      { id: 'new', label: 'New', state: 'waiting', order: 20, chronology: 200 },
      { id: 'old', label: 'Old', state: 'ready', order: 20, chronology: 100, run },
    ]);
    assert.deepEqual(getPendingActions().map((item) => item.id), ['old', 'new']);
  });

  test('only a ready item keeps its callback', () => {
    const run = () => {};
    publishPendingActions('x', [
      { id: 'wait', label: 'Wait', state: 'waiting', run },
      { id: 'go', label: 'Go', state: 'ready', run },
    ]);
    const rows = getPendingActions();
    assert.equal(rows.find((item) => item.id === 'wait').run, null);
    assert.equal(rows.find((item) => item.id === 'go').run, run);
  });

  test('subscribers receive immediate and updated snapshots', () => {
    const seen = [];
    const unsub = subscribePendingActions((items) => seen.push(items.map((i) => i.id)));
    publishPendingActions('a', [{ id: 'one', label: 'One' }]);
    clearPendingActions('a');
    unsub();
    publishPendingActions('a', [{ id: 'two', label: 'Two' }]);
    assert.deepEqual(seen, [[], ['one'], []]);
  });

  test('distinguishes an explicit empty provider refresh from not-yet-loaded', () => {
    assert.equal(pendingSourceHasPublished('lootboxes'), false);
    publishPendingActions('lootboxes', []);
    assert.equal(pendingSourceHasPublished('lootboxes'), true);
    assert.deepEqual(getPendingActions(), []);
  });

  test('hard dismissal survives republishes, covers aliases, and clears each owner once', async () => {
    let clears = 0;
    const clearAll = async () => { clears += 1; };
    publishPendingActions('packs', [
      {
        id: 'ticket-packs:pending', label: 'Tickets pending', state: 'waiting',
        dismissIds: ['ticket-pack:8'], clearAll,
      },
      { id: 'box:1', label: 'Box', state: 'ready', run() {}, clearAll },
    ]);

    assert.equal(await dismissPendingActionItems(getPendingActions()), 2);
    assert.equal(clears, 1, 'one owner hook is called once for the whole source');
    assert.deepEqual(getPendingActions(), []);

    publishPendingActions('packs', [
      { id: 'ticket-pack:8', label: 'Pack is ready', state: 'ready', run() {} },
      { id: 'box:1', label: 'Same box, refreshed', state: 'ready', run() {} },
      { id: 'box:2', label: 'New box', state: 'ready', run() {} },
    ]);
    assert.deepEqual(getPendingActions().map((item) => item.id), ['box:2'],
      'cleared rows stay gone while genuinely new ids remain visible');
  });

  test('drain mode clears rows published by owner cleanup before allowing new work', async () => {
    let firstOwnerClears = 0;
    let replacementOwnerClears = 0;
    publishPendingActions('first', [{
      id: 'first:waiting', label: 'First wait', state: 'waiting',
      clearAll: async () => {
        firstOwnerClears += 1;
        await Promise.resolve();
        publishPendingActions('replacement', [{
          id: 'replacement:ready', label: 'Replacement', state: 'ready', run() {},
          clearAll: () => { replacementOwnerClears += 1; },
        }]);
      },
    }]);

    assert.equal(
      await dismissPendingActionItems(getPendingActions(), { drain: true }),
      2,
    );
    assert.equal(firstOwnerClears, 1);
    assert.equal(replacementOwnerClears, 1,
      'a replacement publisher gets its cleanup hook during the same CLEAR');
    assert.deepEqual(getPendingActions(), []);

    publishPendingActions('later', [{
      id: 'later:new', label: 'Actually new', state: 'ready', run() {},
    }]);
    assert.deepEqual(getPendingActions().map((item) => item.id), ['later:new'],
      'the drain fence closes once cleanup is quiet');
  });

  test('CLEAR survives a registry reload and is isolated to the viewed wallet', async () => {
    publishPendingActions('boxes', [{
      id: 'lootbox:77', dismissScope: '0xaaa', label: 'Box', state: 'ready', run() {},
    }]);
    await dismissPendingActionItems();

    const saved = JSON.parse(dismissalStorage.getItem(PENDING_DISMISSALS_STORAGE_KEY));
    assert.equal(saved.version, 1);
    assert.equal(saved.entries.length, 1, 'the browser receives one durable tombstone');

    // Model a full page reload: publishers/listeners and the in-memory map are
    // gone, but the browser storage entry remains.
    __resetPendingActionsForTest({ preserveDismissedStorage: true });
    publishPendingActions('boxes', [{
      id: 'lootbox:77', dismissScope: '0xaaa', label: 'Same box after reload', state: 'ready', run() {},
    }]);
    assert.deepEqual(getPendingActions(), [], 'the cleared row cannot be republished after reload');

    publishPendingActions('boxes', [{
      id: 'lootbox:77', dismissScope: '0xbbb', label: 'Another wallet box', state: 'ready', run() {},
    }]);
    assert.equal(getPendingActions().length, 1,
      'one wallet clearing a logical id does not hide another wallet\'s reward');
  });

  test('storage failures degrade to a durable-for-session tombstone', async () => {
    __setPendingDismissStorageForTest({
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() {},
    });
    publishPendingActions('x', [{ id: 'same', label: 'Same', state: 'ready', run() {} }]);
    await dismissPendingActionItems();
    publishPendingActions('x', [{ id: 'same', label: 'Same again', state: 'ready', run() {} }]);
    assert.deepEqual(getPendingActions(), []);
  });
});
