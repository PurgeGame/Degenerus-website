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
import * as storeMod from '../store.js';

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
  // Plan 59-02: clear store between tests so app.lastDay assertions are deterministic.
  storeMod.__resetForTest();
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
    // Visible-branch effect runs ONCE — fires up to 5 immediate re-poll fetches:
    // /game/state, /health, /game/jackpot/last-day, /game/jackpot/gold-rush (and
    // /player/:addr only if addr supplied). The visible branch in
    // handleVisibilityChange passes addr=null, so 4 fetches.
    // The assertion is debounce-correctness — we should see <= 5 fetches (single
    // effect), not 8 (double effect).
    assert.ok(fetchCalls.length <= 5, `debounce held; saw ${fetchCalls.length} fetches`);
    assert.ok(fetchCalls.length >= 4, `effect ran at least once; saw ${fetchCalls.length} fetches`);
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

// ===========================================================================
// pollLastDay store wiring (Phase 59 Plan 59-02)
// ===========================================================================

describe('pollLastDay store wiring (Phase 59 Plan 59-02)', () => {
  test('successful fetch writes payload to app.lastDay store path', async () => {
    fetchImpl = async (url) => {
      if (url.endsWith('/game/jackpot/last-day')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            day: 7,
            level: 2,
            summary: null,
            winners: [],
            roll1: { day: 7, level: 2, purchaseLevel: null, wins: [] },
            roll2: { day: 7, level: 2, purchaseLevel: null, wins: [] },
            status: 'resolved-no-winners',
          }),
        };
      }
      // Other 3 polled endpoints return generic ok payloads.
      return { ok: true, status: 200, json: async () => ({ url }) };
    };
    start();
    await new Promise((r) => setTimeout(r, 30));
    const stored = storeMod.get('app.lastDay');
    assert.ok(stored != null, 'app.lastDay populated after first cycle');
    assert.equal(stored.day, 7);
    assert.equal(stored.status, 'resolved-no-winners');
    assert.equal(stored.level, 2);
  });

  test('failed fetch leaves app.lastDay untouched (catch returns null silently)', async () => {
    fetchImpl = async (url) => {
      if (url.endsWith('/game/jackpot/last-day')) {
        throw new Error('network error');
      }
      return { ok: true, status: 200, json: async () => ({ url }) };
    };
    start();
    await new Promise((r) => setTimeout(r, 30));
    const stored = storeMod.get('app.lastDay');
    assert.equal(stored, undefined, 'no store write on fetch failure');
  });

  test('store write occurs only for pollLastDay (other 3 pollers do NOT touch app.*)', async () => {
    fetchImpl = async (url) => {
      if (url.endsWith('/game/jackpot/last-day')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            day: 11, level: 3, summary: null, winners: [],
            roll1: { day: 11, level: 3, purchaseLevel: null, wins: [] },
            roll2: { day: 11, level: 3, purchaseLevel: null, wins: [] },
            status: 'resolved-no-winners',
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ url }) };
    };
    start({ playerAddress: '0xabc' });
    await new Promise((r) => setTimeout(r, 30));
    // app.lastDay populated; app.game / app.player / app.health remain undefined
    // (Plan 59-02 only wires pollLastDay; Phase 60+ extends to other 3).
    assert.ok(storeMod.get('app.lastDay') != null, 'app.lastDay set');
    assert.equal(storeMod.get('app.game'), undefined, 'app.game untouched (Phase 60)');
    assert.equal(storeMod.get('app.player'), undefined, 'app.player untouched');
    assert.equal(storeMod.get('app.health'), undefined, 'app.health untouched');
  });
});

// ===========================================================================
// approvers fetch + approvals.list (account-switcher, 2026-07-16)
// ===========================================================================

const CONNECTED = '0xc0ffee0000000000000000000000000000c0ff';
const APPROVER_A = '0xaaaa000000000000000000000000000000a001';
const APPROVER_B = '0xbbbb000000000000000000000000000000b002';

describe('approvers fetch + approvals.list (account-switcher)', () => {
  test('connected wallet triggers /player/:connected/approvers in the same player cycle', async () => {
    storeMod.update('connected.address', CONNECTED);
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    const paths = fetchCalls.map((c) => c.url);
    assert.ok(
      paths.some((p) => p.endsWith(`/player/${CONNECTED}/approvers`)),
      `expected an approvers fetch; saw ${JSON.stringify(paths)}`,
    );
  });

  test('no connected wallet → no approvers fetch, approvals.list stays empty', async () => {
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    const paths = fetchCalls.map((c) => c.url);
    assert.ok(!paths.some((p) => p.includes('/approvers')), 'no approvers fetch when disconnected');
    assert.deepEqual(storeMod.get('approvals.list'), [], 'approvals.list untouched (default empty)');
  });

  test('approvers response is lowercased, deduped, and excludes the connected wallet itself', async () => {
    storeMod.update('connected.address', CONNECTED);
    fetchImpl = async (url) => {
      if (url.endsWith('/approvers')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            operator: CONNECTED,
            approvers: [
              { owner: APPROVER_A.toUpperCase(), blockNumber: '10' },
              { owner: APPROVER_B, blockNumber: '9' },
              { owner: APPROVER_A, blockNumber: '8' },       // duplicate (different case)
              { owner: CONNECTED, blockNumber: '7' },         // self — must be excluded
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ url }) };
    };
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    const list = storeMod.get('approvals.list');
    assert.deepEqual(list, [APPROVER_A, APPROVER_B], 'lowercased, deduped, self excluded');
  });

  test('failed approvers fetch leaves approvals.list unchanged (soft-fail, other 3 endpoints unaffected)', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    fetchImpl = async (url) => {
      if (url.endsWith('/approvers')) throw new Error('network error');
      return { ok: true, status: 200, json: async () => ({ url }) };
    };
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(storeMod.get('approvals.list'), [APPROVER_A], 'prior list preserved on fetch failure');
  });
});

// ===========================================================================
// Current active boons → product-local indicators.
// ===========================================================================

describe('current boon feed → app.boons', () => {
  test('viewed player cycle resolves the live day and stores its boon rows', async () => {
    const viewed = '0x1111000000000000000000000000000000000062';
    fetchImpl = async (url, opts) => {
      fetchCalls.push({ url, opts });
      if (url.endsWith('/game/state')) {
        return { ok: true, status: 200, json: async () => ({ currentDay: 62 }) };
      }
      if (url.endsWith(`/player/${viewed}/boons/62`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            day: 62,
            address: viewed,
            boons: [{ boonType: 9, consumed: false, consumedBoostBps: null }],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    start({ playerAddress: viewed });
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(fetchCalls.some((call) => call.url.endsWith(`/player/${viewed}/boons/62`)));
    assert.deepEqual(storeMod.get('app.boons'), {
      address: viewed,
      day: 62,
      boons: [{ boonType: 9, consumed: false, consumedBoostBps: null }],
    });
  });

  test('combined mode clears product boons without fetching one account', async () => {
    storeMod.update('app.boons', {
      address: CONNECTED,
      day: 62,
      boons: [{ boonType: 9, consumed: false }],
    });
    storeMod.update('ui.mode', 'combined');
    start({ playerAddress: CONNECTED });
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(!fetchCalls.some((call) => call.url.includes('/boons/')));
    assert.deepEqual(storeMod.get('app.boons'), { address: null, day: null, boons: [] });
  });

  test('a failed refresh preserves the same account\'s last good boon payload', async () => {
    const viewed = '0x1111000000000000000000000000000000000062';
    const prior = { address: viewed, day: 61, boons: [{ boonType: 6, consumed: false }] };
    storeMod.update('app.boons', prior);
    fetchImpl = async (url) => {
      if (url.endsWith('/game/state')) {
        return { ok: true, status: 200, json: async () => ({ currentDay: 62 }) };
      }
      if (url.includes('/boons/')) throw new Error('boon API unavailable');
      return { ok: true, status: 200, json: async () => ({}) };
    };
    start({ playerAddress: viewed });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(storeMod.get('app.boons'), prior);
  });
});

// ===========================================================================
// combined mode player cycle → app.playerCombined (account-switcher, 2026-07-16)
// ===========================================================================

describe('combined mode player cycle → app.playerCombined', () => {
  function playerPayload(addr, claimableEth) {
    return {
      player: addr,
      claimableEth,
      flipBalance: '0',
      dgnrsBalance: '0',
      coinflip: null,
      decimator: { claimablePerLevel: [], futurePoolTotal: '0' },
      terminal: null,
      tickets: [],
    };
  }

  test("mode='combined' fetches /player/:addr for [connected, ...approvals.list] and writes the merge to app.playerCombined", async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A, APPROVER_B]);
    storeMod.update('ui.mode', 'combined');
    fetchImpl = async (url) => {
      fetchCalls.push({ url });
      if (url.endsWith(`/player/${CONNECTED}`)) {
        return { ok: true, status: 200, json: async () => playerPayload(CONNECTED, '10') };
      }
      if (url.endsWith(`/player/${APPROVER_A}`)) {
        return { ok: true, status: 200, json: async () => playerPayload(APPROVER_A, '20') };
      }
      if (url.endsWith(`/player/${APPROVER_B}`)) {
        return { ok: true, status: 200, json: async () => playerPayload(APPROVER_B, '30') };
      }
      if (url.endsWith('/approvers')) {
        return { ok: true, status: 200, json: async () => ({ operator: CONNECTED, approvers: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ url }) };
    };
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));

    const paths = fetchCalls.map((c) => c.url);
    for (const addr of [CONNECTED, APPROVER_A, APPROVER_B]) {
      assert.ok(paths.some((p) => p.endsWith(`/player/${addr}`)), `fetched /player/${addr}`);
    }

    const merged = storeMod.get('app.playerCombined');
    assert.ok(merged, 'app.playerCombined populated');
    assert.equal(merged.claimableEth, '60', 'sums claimableEth across all 3 accounts (BigInt)');
    assert.deepEqual(
      [...merged.addresses].sort(),
      [CONNECTED, APPROVER_A, APPROVER_B].sort(),
      'addresses[] includes connected + every approver',
    );
  });

  test("mode!=='combined' does not fetch other accounts' /player/:addr", async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    // ui.mode stays 'self' (default) — combined branch must not fire.
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    const paths = fetchCalls.map((c) => c.url);
    assert.ok(!paths.some((p) => p.endsWith(`/player/${APPROVER_A}`)), 'no combined fetch when mode is self');
  });

  test('leaving combined mode nulls app.playerCombined (only when a stale value is present)', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', []);
    storeMod.update('ui.mode', 'combined');
    fetchImpl = async (url) => {
      fetchCalls.push({ url });
      if (url.endsWith(`/player/${CONNECTED}`)) {
        return { ok: true, status: 200, json: async () => playerPayload(CONNECTED, '10') };
      }
      return { ok: true, status: 200, json: async () => ({ url }) };
    };
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(storeMod.get('app.playerCombined') != null, 'precondition: playerCombined populated');

    // Flip out of combined mode and re-run the eager cycle via start() again.
    storeMod.update('ui.mode', 'self');
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(storeMod.get('app.playerCombined'), null, 'nulled after leaving combined mode');
  });

  test('no-churn: app.playerCombined write is skipped when already null and mode stays non-combined', async () => {
    storeMod.update('connected.address', CONNECTED);
    // app.playerCombined starts undefined (never set) — not "null" yet.
    let writeCount = 0;
    const unsub = storeMod.subscribe('app.playerCombined', () => { writeCount += 1; });
    writeCount = 0; // subscribe() fires once immediately with current value — discount it
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(writeCount, 0, 'no app.playerCombined write when never-combined and value already absent');
    unsub();
  });
});
