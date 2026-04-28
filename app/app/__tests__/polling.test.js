// /app/app/__tests__/polling.test.js — APP-04 + APP-06 unit (D-10 LOCKED).
//
// Run: node --test website/app/app/__tests__/polling.test.js
//
// Covers:
//   - POLL_INTERVALS LOCKED cadence (D-04)
//   - start() registers 4 timers + fires eager first cycle
//   - AbortController-per-cycle (D-06)
//   - abortAllInflight() aborts every active controller
//   - Promise.allSettled fallback (Pitfall 7) — one rejected fetcher does not block others
//   - visibilitychange handler with 100ms debounce (Pitfall 3)
//   - fetchJSONWithSignal (Pitfall 5) — passes signal to native fetch + prepends API_BASE

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stub document for the node runtime (polling.js gates on `typeof document`).
// Must be installed BEFORE the dynamic import below so the module-level
// `document.addEventListener('visibilitychange', ...)` registration sees the stub.
// ---------------------------------------------------------------------------

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

// ---------------------------------------------------------------------------
// Stub global fetch with a counter-tracking mock (replaceable per-test via fetchImpl).
// ---------------------------------------------------------------------------

let fetchCalls = [];
let fetchImpl = async (url, opts) => {
  fetchCalls.push({ url, opts });
  return { ok: true, status: 200, json: async () => ({ url }) };
};
globalThis.fetch = (...args) => fetchImpl(...args);

// ---------------------------------------------------------------------------
// Import polling.js AFTER stubs are in place.
// ---------------------------------------------------------------------------

const polling = await import('../polling.js');
const {
  POLL_INTERVALS,
  start,
  stop,
  abortAllInflight,
  handleVisibilityChange,
  _testing,
} = polling;

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = async (url, opts) => {
    fetchCalls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ url }) };
  };
});

afterEach(() => {
  stop();
});

// ===========================================================================
// POLL_INTERVALS — LOCKED cadence (D-04)
// ===========================================================================

describe('POLL_INTERVALS (D-04 LOCKED cadence)', () => {
  test('cadence is 15s/30s/60s/60s', () => {
    assert.equal(POLL_INTERVALS.gameState, 15_000);
    assert.equal(POLL_INTERVALS.playerData, 30_000);
    assert.equal(POLL_INTERVALS.health, 60_000);
    assert.equal(POLL_INTERVALS.lastDay, 60_000);
  });
});

// ===========================================================================
// start() registers 4 timers + fires eager cycle
// ===========================================================================

describe('start() registers 4 timers + fires eager first cycle', () => {
  test('start() schedules 4 intervals + eager first cycle hits 3 endpoints (no playerAddress)', async () => {
    start();
    // Eager cycles fired synchronously; allow any microtasks + queued fetches to run.
    await new Promise((r) => setTimeout(r, 30));
    const paths = fetchCalls.map((c) => c.url).sort();
    assert.ok(paths.some((p) => p.endsWith('/game/state')), 'game polled');
    assert.ok(paths.some((p) => p.endsWith('/health')), 'health polled');
    assert.ok(paths.some((p) => p.endsWith('/game/jackpot/last-day')), 'lastDay polled');
    // playerAddress not provided → pollPlayer returns null without fetching.
    assert.ok(!paths.some((p) => p.includes('/player/')), 'no player fetch when addr=null');
    const handles = _testing.TIMER_HANDLES;
    assert.ok(handles.game !== null, 'game interval registered');
    assert.ok(handles.player !== null, 'player interval registered');
    assert.ok(handles.health !== null, 'health interval registered');
    assert.ok(handles.lastDay !== null, 'lastDay interval registered');
  });

  test('start() with playerAddress also polls /player/:addr', async () => {
    start({ playerAddress: '0xabc' });
    await new Promise((r) => setTimeout(r, 30));
    const paths = fetchCalls.map((c) => c.url);
    assert.ok(paths.some((p) => p.endsWith('/player/0xabc')), 'player polled when addr supplied');
  });

  test('stop() clears all 4 intervals', async () => {
    start();
    await new Promise((r) => setTimeout(r, 10));
    stop();
    const handles = _testing.TIMER_HANDLES;
    assert.equal(handles.game, null, 'game cleared');
    assert.equal(handles.player, null, 'player cleared');
    assert.equal(handles.health, null, 'health cleared');
    assert.equal(handles.lastDay, null, 'lastDay cleared');
  });

  test('subsequent start() re-registers fresh handles', async () => {
    start();
    stop();
    start();
    const handles = _testing.TIMER_HANDLES;
    assert.ok(handles.game !== null, 'game re-registered');
    assert.ok(handles.health !== null, 'health re-registered');
  });
});

// ===========================================================================
// AbortController-per-cycle (D-06)
// ===========================================================================

describe('AbortController-per-cycle (D-06)', () => {
  test('runCycle creates a new AbortController; previous cycle for same timer is aborted', async () => {
    const aborted = [];
    fetchImpl = async (url, opts) => {
      // Long-running fetch — never resolves; aborted by next cycle.
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => aborted.push(url));
      }
      return new Promise(() => {});
    };
    _testing.runCycle('test', [(s) => fetch('/foo', { signal: s }).then((r) => r.json())]);
    await new Promise((r) => setTimeout(r, 10));
    _testing.runCycle('test', [(s) => fetch('/foo', { signal: s }).then((r) => r.json())]);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(aborted.length, 1, 'previous cycle was aborted');
  });

  test('abortAllInflight() aborts every active controller and clears the map', async () => {
    const aborted = [];
    fetchImpl = async (url, opts) => {
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => aborted.push(url));
      }
      return new Promise(() => {});
    };
    _testing.runCycle('a', [(s) => fetch('/a', { signal: s })]);
    _testing.runCycle('b', [(s) => fetch('/b', { signal: s })]);
    await new Promise((r) => setTimeout(r, 5));
    abortAllInflight();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(aborted.length, 2, 'both controllers aborted');
    assert.equal(_testing.ACTIVE_CYCLES.size, 0, 'active-cycles map cleared');
  });

  test('after abortAllInflight, the next runCycle proceeds cleanly', async () => {
    fetchImpl = async (url, opts) => ({ ok: true, status: 200, json: async () => ({ url }) });
    abortAllInflight();
    const result = await _testing.runCycle('clean', [() => Promise.resolve('ok')]);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'fulfilled');
    assert.equal(result[0].value, 'ok');
  });
});

// ===========================================================================
// Promise.allSettled fallback (Pitfall 7)
// ===========================================================================

describe('Promise.allSettled fallback (Pitfall 7)', () => {
  test('one rejected fetcher does not block others in same cycle', async () => {
    const result = await _testing.runCycle('mixed', [
      () => Promise.reject(new Error('endpoint A down')),
      () => Promise.resolve({ ok: true }),
    ]);
    assert.equal(result.length, 2, 'both settled');
    assert.equal(result[0].status, 'rejected', 'first rejected');
    assert.equal(result[1].status, 'fulfilled', 'second fulfilled');
    assert.deepEqual(result[1].value, { ok: true });
  });

  test('runCycle resolves (not rejects) when one fetcher rejects', async () => {
    // The promise returned by runCycle must never reject — Promise.allSettled guarantees.
    const p = _testing.runCycle('only-rejects', [() => Promise.reject(new Error('boom'))]);
    const result = await p;
    assert.equal(result[0].status, 'rejected');
    assert.equal(result[0].reason.message, 'boom');
  });
});

// ===========================================================================
// visibilitychange handler (D-04 + Pitfall 3)
// ===========================================================================

describe('visibilitychange handler (D-04 + Pitfall 3)', () => {
  test('hidden → pauseAllTimers (after 100ms debounce)', async () => {
    start();
    await new Promise((r) => setTimeout(r, 10));
    globalThis.document.visibilityState = 'hidden';
    handleVisibilityChange();
    // Wait past the 100ms debounce.
    await new Promise((r) => setTimeout(r, 150));
    const handles = _testing.TIMER_HANDLES;
    assert.equal(handles.game, null, 'game timer cleared after hidden');
    assert.equal(handles.player, null, 'player timer cleared after hidden');
    assert.equal(handles.health, null, 'health timer cleared after hidden');
    assert.equal(handles.lastDay, null, 'lastDay timer cleared after hidden');
    // Restore for later tests.
    globalThis.document.visibilityState = 'visible';
  });

  test('debounce: two visibilitychange events within 50ms collapse to a single effect', async () => {
    globalThis.document.visibilityState = 'visible';
    // Drain any pending debounce from earlier tests.
    await new Promise((r) => setTimeout(r, 150));
    fetchCalls = [];
    handleVisibilityChange();             // schedule effect
    await new Promise((r) => setTimeout(r, 30));
    handleVisibilityChange();             // second call cancels first's setTimeout
    await new Promise((r) => setTimeout(r, 150));
    // Visible-branch effect runs ONCE — fires up to 4 immediate re-poll fetches:
    // /game/state, /health, /game/jackpot/last-day (and /player/:addr only if addr supplied).
    // The visible branch in handleVisibilityChange passes addr=null, so 3 fetches.
    // The assertion is debounce-correctness — we should see <= 4 fetches (single effect),
    // not 6+ (double effect).
    assert.ok(fetchCalls.length <= 4, `debounce held; saw ${fetchCalls.length} fetches`);
    assert.ok(fetchCalls.length >= 3, `effect ran at least once; saw ${fetchCalls.length} fetches`);
  });

  test('visible → immediate re-poll runs all 4 cycles', async () => {
    globalThis.document.visibilityState = 'visible';
    // Drain any pending debounce.
    await new Promise((r) => setTimeout(r, 150));
    fetchCalls = [];
    handleVisibilityChange();
    await new Promise((r) => setTimeout(r, 150));
    const paths = fetchCalls.map((c) => c.url);
    assert.ok(paths.some((p) => p.endsWith('/game/state')), 'game re-polled on visible');
    assert.ok(paths.some((p) => p.endsWith('/health')), 'health re-polled on visible');
    assert.ok(paths.some((p) => p.endsWith('/game/jackpot/last-day')), 'lastDay re-polled on visible');
  });

  // CR-01 regression: visible → re-arm all 4 setIntervals after hidden cleared them.
  test('visible after hidden re-arms all 4 setIntervals (CR-01 regression)', async () => {
    start({ playerAddress: '0xabc' });
    await new Promise((r) => setTimeout(r, 10));
    globalThis.document.visibilityState = 'hidden';
    handleVisibilityChange();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(_testing.TIMER_HANDLES.game, null, 'precondition: game cleared on hidden');
    assert.equal(_testing.TIMER_HANDLES.player, null, 'precondition: player cleared on hidden');
    assert.equal(_testing.TIMER_HANDLES.health, null, 'precondition: health cleared on hidden');
    assert.equal(_testing.TIMER_HANDLES.lastDay, null, 'precondition: lastDay cleared on hidden');

    globalThis.document.visibilityState = 'visible';
    handleVisibilityChange();
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(_testing.TIMER_HANDLES.game !== null, 'game re-armed on visible');
    assert.ok(_testing.TIMER_HANDLES.player !== null, 'player re-armed on visible');
    assert.ok(_testing.TIMER_HANDLES.health !== null, 'health re-armed on visible');
    assert.ok(_testing.TIMER_HANDLES.lastDay !== null, 'lastDay re-armed on visible');
  });

  // WR-01 regression: visible after hidden preserves the playerAddress captured at start().
  test('visible after hidden preserves playerAddress (WR-01 regression)', async () => {
    start({ playerAddress: '0xfeedface' });
    await new Promise((r) => setTimeout(r, 10));
    globalThis.document.visibilityState = 'hidden';
    handleVisibilityChange();
    await new Promise((r) => setTimeout(r, 150));

    globalThis.document.visibilityState = 'visible';
    fetchCalls = [];
    handleVisibilityChange();
    await new Promise((r) => setTimeout(r, 150));
    const paths = fetchCalls.map((c) => c.url);
    assert.ok(
      paths.some((p) => p.endsWith('/player/0xfeedface')),
      `player feed re-polled with captured addr on visible; saw paths=${JSON.stringify(paths)}`,
    );
  });
});

// ===========================================================================
// fetchJSONWithSignal (Pitfall 5)
// ===========================================================================

describe('fetchJSONWithSignal (Pitfall 5)', () => {
  test('passes signal through to native fetch + prepends API_BASE', async () => {
    let captured = null;
    fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const ctrl = new AbortController();
    await _testing.fetchJSONWithSignal('/foo', { signal: ctrl.signal });
    assert.equal(captured.url, 'http://localhost:3000/foo', 'API_BASE prepended');
    assert.equal(captured.opts.signal, ctrl.signal, 'signal threaded to fetch');
  });

  test('non-200 throws Error with status + path', async () => {
    fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(
      () => _testing.fetchJSONWithSignal('/bar', {}),
      /API 503: \/bar/,
    );
  });

  test('default (no opts) still works (signal undefined)', async () => {
    let captured = null;
    fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await _testing.fetchJSONWithSignal('/baz');
    assert.equal(captured.url, 'http://localhost:3000/baz');
    assert.equal(captured.opts.signal, undefined);
  });
});

// ===========================================================================
// abortAllInflight stub (Phase 58 wiring point)
// ===========================================================================

describe('abortAllInflight stub for Phase 58', () => {
  test('abortAllInflight is exported and callable on empty state', () => {
    assert.equal(typeof abortAllInflight, 'function');
    abortAllInflight(); // no throw on empty
    assert.equal(_testing.ACTIVE_CYCLES.size, 0);
  });

  test('after start() + abortAllInflight, all active controllers aborted', async () => {
    const aborted = [];
    fetchImpl = async (url, opts) => {
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => aborted.push(url));
      }
      return new Promise(() => {});
    };
    start();
    await new Promise((r) => setTimeout(r, 10));
    abortAllInflight();
    await new Promise((r) => setTimeout(r, 10));
    // 3 long-running cycles created (game, health, lastDay; player is null-short-circuited).
    assert.ok(aborted.length >= 3, `expected at least 3 aborts; got ${aborted.length}`);
    assert.equal(_testing.ACTIVE_CYCLES.size, 0);
  });
});
