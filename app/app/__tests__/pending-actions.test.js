// /app/app/__tests__/pending-actions.test.js

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  publishPendingActions,
  clearPendingActions,
  getPendingActions,
  subscribePendingActions,
  __resetPendingActionsForTest,
} from '../pending-actions.js';

describe('pending-actions registry', () => {
  beforeEach(() => __resetPendingActionsForTest());

  test('providers replace only their own rows and ready items sort first', () => {
    publishPendingActions('boxes', [
      { id: 'box:1', label: 'Box 1', state: 'waiting', order: 20 },
      { id: 'box:2', label: 'Box 2', state: 'ready', run() {}, order: 20 },
    ]);
    publishPendingActions('pari', [
      { id: 'pari:7', label: 'Pari 7', state: 'busy', order: 30 },
    ]);
    assert.deepEqual(
      getPendingActions().map((item) => [item.id, item.state]),
      [['box:2', 'ready'], ['pari:7', 'busy'], ['box:1', 'waiting']],
    );

    publishPendingActions('boxes', [{ id: 'box:3', label: 'Box 3', state: 'waiting' }]);
    assert.deepEqual(getPendingActions().map((item) => item.id), ['pari:7', 'box:3']);
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
});
