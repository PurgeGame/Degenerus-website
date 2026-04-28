// /app/app/__tests__/store.test.js — Phase 58 Plan 02 unit (DD-03).
//
// Run: cd website && node --test app/app/__tests__/store.test.js
//
// Covers:
//   - get/update/subscribe baseline (Proxy-namespaced state, ancestor-walk notify)
//   - batch({updates}) — multi-path with deduped notifications
//   - deriveCanSign 4-state matrix (mode/chainOk/connected.address)
//   - getViewedAddress precedence (viewing || connected || null)
//   - ui.mode auto-derivation (view-mode whenever viewing.address && (!connected || viewing!==connected))
//   - Direct update('ui.mode','self') honored when viewing.address null (regression gate for 58-01)
//
// store.js is pure JS (no DOM). Uses __resetForTest() between cases.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as storeMod from '../store.js';

const {
  get,
  update,
  subscribe,
  batch,
  deriveCanSign,
  getViewedAddress,
  __resetForTest,
} = storeMod;

beforeEach(() => {
  __resetForTest();
});

// ===========================================================================
// Baseline: get / update / subscribe (mirrors beta/app/store.js semantics)
// ===========================================================================

describe('get on fresh state', () => {
  test("get('connected.address') returns null on fresh state", () => {
    assert.equal(get('connected.address'), null);
  });

  test("get('viewing.address') returns null on fresh state", () => {
    assert.equal(get('viewing.address'), null);
  });

  test("get('ui.mode') returns 'self' on fresh state", () => {
    assert.equal(get('ui.mode'), 'self');
  });
});

describe('update + get', () => {
  test("update('connected.address', '0xabc...') then get returns the value", () => {
    update('connected.address', '0xabc0000000000000000000000000000000000001');
    assert.equal(get('connected.address'), '0xabc0000000000000000000000000000000000001');
  });
});

describe('subscribe', () => {
  test('subscribe(path, fn) immediately invokes fn with current value, returns unsubscribe', () => {
    const seen = [];
    const unsub = subscribe('connected.address', (v) => seen.push(v));
    assert.equal(seen.length, 1, 'fn invoked once on subscribe');
    assert.equal(seen[0], null, 'initial value is null');
    assert.equal(typeof unsub, 'function', 'returns unsubscribe function');
  });

  test('subscribe + update fires fn with new value', () => {
    const seen = [];
    subscribe('connected.address', (v) => seen.push(v));
    update('connected.address', '0xaaaa000000000000000000000000000000000001');
    assert.equal(seen.length, 2);
    assert.equal(seen[1], '0xaaaa000000000000000000000000000000000001');
  });

  test("subscribe ancestor: update('viewing.address', X) notifies subscribers of 'viewing'", () => {
    const seen = [];
    subscribe('viewing', (v) => seen.push(v));
    update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    // initial fire (current viewing namespace) + ancestor-walk fire after update
    assert.ok(seen.length >= 2, 'ancestor subscriber fired on descendant update');
    assert.equal(seen[seen.length - 1].address, '0xbbbb000000000000000000000000000000000002');
  });
});

// ===========================================================================
// batch — deduplicated notifications
// ===========================================================================

describe('batch', () => {
  test('batch({updates: [{path, value}]}) deduplicates notifications — same path twice fires once with last value', () => {
    let count = 0;
    let last = undefined;
    subscribe('connected.address', (v) => { count += 1; last = v; });
    // Reset count to ignore the immediate-fire from subscribe()
    const baseline = count;
    batch({
      updates: [
        { path: 'connected.address', value: '0xaaaa000000000000000000000000000000000001' },
        { path: 'connected.address', value: '0xbbbb000000000000000000000000000000000002' },
      ],
    });
    assert.equal(count - baseline, 1, 'subscriber fired exactly once for deduped path');
    assert.equal(last, '0xbbbb000000000000000000000000000000000002', 'last value won');
  });

  test('batch fires each unique path once even with multi-path updates', () => {
    const seenA = [];
    const seenC = [];
    subscribe('connected.address', (v) => seenA.push(v));
    subscribe('connected.chainId', (v) => seenC.push(v));
    const baseA = seenA.length;
    const baseC = seenC.length;
    batch({
      updates: [
        { path: 'connected.address', value: '0xaaaa000000000000000000000000000000000001' },
        { path: 'connected.chainId', value: 11155111 },
      ],
    });
    assert.equal(seenA.length - baseA, 1);
    assert.equal(seenC.length - baseC, 1);
    assert.equal(seenA[seenA.length - 1], '0xaaaa000000000000000000000000000000000001');
    assert.equal(seenC[seenC.length - 1], 11155111);
  });
});

// ===========================================================================
// deriveCanSign — 4-state matrix (DD-03)
// ===========================================================================

// Helper to drain the microtask queue (deriveMode is queued via queueMicrotask
// so requireSelf() in 58-01's chokepoint test sees the pre-derive snapshot).
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('deriveCanSign', () => {
  test('deriveCanSign returns false when no wallet connected', () => {
    update('ui.mode', 'self');
    update('ui.chainOk', true);
    update('connected.address', null);
    assert.equal(deriveCanSign(), false);
  });

  test('deriveCanSign returns false when chainOk===false', () => {
    update('ui.mode', 'self');
    update('ui.chainOk', false);
    update('connected.address', '0xaaaa000000000000000000000000000000000001');
    assert.equal(deriveCanSign(), false);
  });

  test("deriveCanSign returns false when ui.mode==='view'", async () => {
    update('connected.address', '0xaaaa000000000000000000000000000000000001');
    update('ui.chainOk', true);
    update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    await flushMicrotasks();
    // mode auto-derives to 'view' from the viewing != connected combination.
    assert.equal(get('ui.mode'), 'view');
    assert.equal(deriveCanSign(), false);
  });

  test("deriveCanSign returns true when mode='self' AND chainOk=true AND connected.address truthy", async () => {
    update('connected.address', '0xaaaa000000000000000000000000000000000001');
    update('ui.chainOk', true);
    await flushMicrotasks();
    // viewing null → mode stays 'self'
    assert.equal(get('ui.mode'), 'self');
    assert.equal(deriveCanSign(), true);
  });
});

// ===========================================================================
// getViewedAddress — precedence (DD-03)
// ===========================================================================

describe('getViewedAddress', () => {
  test('getViewedAddress returns viewing.address when set', () => {
    update('connected.address', '0xaaaa000000000000000000000000000000000001');
    update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    assert.equal(getViewedAddress(), '0xbbbb000000000000000000000000000000000002');
  });

  test('getViewedAddress returns connected.address when viewing.address null', () => {
    update('connected.address', '0xaaaa000000000000000000000000000000000001');
    update('viewing.address', null);
    assert.equal(getViewedAddress(), '0xaaaa000000000000000000000000000000000001');
  });

  test('getViewedAddress returns null when both null', () => {
    update('connected.address', null);
    update('viewing.address', null);
    assert.equal(getViewedAddress(), null);
  });
});

// ===========================================================================
// ui.mode auto-derivation (DD-03 — the heart of view-mode)
// ===========================================================================

describe('ui.mode auto-derivation', () => {
  test("ui.mode auto-derives to 'view' when viewing.address set AND differs from connected.address", async () => {
    update('connected.address', '0xaaaa000000000000000000000000000000000001');
    update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    await flushMicrotasks();
    assert.equal(get('ui.mode'), 'view');
  });

  test("ui.mode auto-derives to 'view' when viewing.address set AND no wallet (deep-link without connect)", async () => {
    update('connected.address', null);
    update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    await flushMicrotasks();
    assert.equal(get('ui.mode'), 'view');
  });

  test("ui.mode auto-derives to 'self' when viewing===connected (case-insensitive)", async () => {
    update('connected.address', '0xAAAA000000000000000000000000000000000001');
    // viewing same address but lowercase
    update('viewing.address', '0xaaaa000000000000000000000000000000000001');
    await flushMicrotasks();
    assert.equal(get('ui.mode'), 'self');
  });

  test("ui.mode auto-derives to 'self' when viewing.address null", async () => {
    update('connected.address', '0xaaaa000000000000000000000000000000000001');
    update('viewing.address', '0xbbbb000000000000000000000000000000000002');
    await flushMicrotasks();
    // mode is 'view' here
    assert.equal(get('ui.mode'), 'view');
    update('viewing.address', null);
    await flushMicrotasks();
    assert.equal(get('ui.mode'), 'self');
  });

  test("wallet.js-style direct update('ui.mode','self') on disconnect is honored (does not get overwritten by derive subscriber when viewing is also null)", async () => {
    // Synthetic regression gate for 58-01 contracts.test.js #1 pattern:
    // explicit update('ui.mode', 'view') with viewing=null must NOT be auto-corrected
    // by a connected.address change (derive only re-evaluates when viewing is set,
    // because mode is fundamentally a function of viewing.address).
    update('ui.mode', 'view');
    update('connected.address', '0xaaaa000000000000000000000000000000000001');
    await flushMicrotasks();
    // viewing is null → derive subscriber on connected.address must skip → mode stays 'view'
    assert.equal(get('ui.mode'), 'view');
    // Now an explicit reset (mirrors wallet.js disconnect path):
    update('connected.address', null);
    update('ui.mode', 'self');
    await flushMicrotasks();
    assert.equal(get('ui.mode'), 'self');
  });
});
