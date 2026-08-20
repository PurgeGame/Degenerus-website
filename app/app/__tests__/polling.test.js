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

// A real (tiny) event target, not a no-op: polling.js now registers document
// listeners for the boon refresh triggers, and a stubbed-out addEventListener
// would silently make those untestable.
if (typeof globalThis.document === 'undefined') {
  const listeners = new Map();
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn); },
    dispatchEvent: (evt) => {
      for (const fn of listeners.get(evt?.type) ?? []) fn(evt);
      return true;
    },
  };
}
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
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
  refreshForDayShift,
  refreshJackpotAfterChainCompletion,
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
  // Same reason, for the shed-load gate: any case that answers 429/503 arms a
  // module-level cooldown that would otherwise fail every later test with
  // "API cooling down" instead of exercising what they assert.
  _testing.clearApiCooldown();
  _testing.invalidateJSONCache();
  _testing.resetGoldRushSnapshotReader();
  // Existing polling tests exercise the indexed soft-fallback unless a case
  // installs an exact packed-state reader explicitly.
  _testing.setBoonStateReader(async () => { throw new Error('RPC unavailable'); });
});

afterEach(() => {
  stop();
  _testing.resetBoonStateReader();
});

// ===========================================================================
// POLL_INTERVALS — LOCKED cadence (D-04)
// ===========================================================================

describe('POLL_INTERVALS (D-04 LOCKED cadence)', () => {
  test('cadence is 15s/30s/60s', () => {
    assert.equal(POLL_INTERVALS.gameState, 15_000);
    assert.equal(POLL_INTERVALS.playerData, 30_000);
    assert.equal(POLL_INTERVALS.health, 60_000);
  });

  test('lastDay has NO interval — it is day-change driven, not timed', () => {
    // A sealed day's jackpot record is permanent. Polling it re-sent ~13.4 KB of
    // identical bytes every 15s (83% of all client transfer) for a value that
    // changes once a day. publishGameState fires it on day change instead.
    assert.equal(POLL_INTERVALS.lastDay, undefined);
  });
});

// ===========================================================================
// start() registers 4 timers + fires eager cycle
// ===========================================================================

describe('start() registers 3 timers + fires eager first cycle', () => {
  test('start() schedules 3 intervals + eager first cycle hits 3 endpoints (no playerAddress)', async () => {
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
    // lastDay is fetched eagerly above but carries no recurring timer.
    assert.ok(!('lastDay' in handles), 'no lastDay timer slot');
  });

  test('start() with playerAddress also polls /player/:addr', async () => {
    start({ playerAddress: '0xabc' });
    await new Promise((r) => setTimeout(r, 30));
    const paths = fetchCalls.map((c) => c.url);
    assert.ok(paths.some((p) => p.endsWith('/player/0xabc')), 'player polled when addr supplied');
  });

  test('stop() clears all 3 intervals', async () => {
    start();
    await new Promise((r) => setTimeout(r, 10));
    stop();
    const handles = _testing.TIMER_HANDLES;
    assert.equal(handles.game, null, 'game cleared');
    assert.equal(handles.player, null, 'player cleared');
    assert.equal(handles.health, null, 'health cleared');
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

describe('gold-rush direct chain reader', () => {
  const GAME_STATE = {
    level: 7,
    phase: 'JACKPOT',
    jackpotCounter: 2,
    prizePools: {
      currentPrizePool: '100',
      nextPrizePool: '200',
      futurePrizePool: '300',
      claimableWinnings: '9000',
      frozen: true,
    },
  };
  const SNAPSHOT = {
    blockNumber: 456,
    currentWei: 100n,
    nextWei: 200n,
    futureWei: 300n,
    yieldAccumulatorWei: 40n,
    currentDay: 167n,
    phaseSlot0: 160n | (167n << 24n) | (40n << 96n),
    source: 'wallet',
  };

  test('contract-exact payload adds yield but excludes claimable', () => {
    const payload = _testing.buildGoldRushChainPayload(
      SNAPSHOT,
      GAME_STATE,
    );
    assert.equal(payload.headlineWei, '640');
    assert.equal(payload.components.claimableWei, '9000');
    assert.equal(payload.components.yieldAccumulatorWei, '40');
    assert.equal(payload.grandEthWei, '75');
    assert.equal(payload.atBlock, 456);
    assert.equal(payload.phaseClock.purchaseDay, 8);
    assert.equal(payload.level, 40);
    assert.equal(payload.phase, 'PURCHASE');
    assert.equal(payload.ready, true);
    assert.equal(payload.source, 'wallet');
  });

  test('polls the chain without touching any API route', async () => {
    fetchImpl = async (url) => {
      fetchCalls.push({ url });
      throw new Error(`Gold-rush must not fetch ${url}`);
    };
    storeMod.update('app.gameState', GAME_STATE);
    _testing.setGoldRushSnapshotReader(async () => ({
      ...SNAPSHOT,
      blockNumber: 789,
      yieldAccumulatorWei: 50n,
    }));

    const payload = await _testing.pollGoldRush(new AbortController().signal);

    assert.equal(payload.headlineWei, '650');
    assert.equal(payload.atBlock, 789);
    assert.equal(storeMod.get('app.goldRush').headlineWei, '650');
    assert.equal(fetchCalls.length, 0, 'no /gold-rush, /game/state, or /health fetch');
  });

  test('day rollover forces the direct phase clock while indexed pollers are unavailable', async () => {
    let reads = 0;
    fetchImpl = async (url) => {
      fetchCalls.push({ url });
      throw new Error('indexer wedged');
    };
    _testing.setGoldRushSnapshotReader(async () => {
      reads += 1;
      return { ...SNAPSHOT, blockNumber: 800, currentDay: 168n };
    });

    const results = await refreshForDayShift();

    assert.equal(results[0].status, 'fulfilled');
    assert.equal(reads, 1);
    assert.equal(storeMod.get('app.goldRush').phaseClock.purchaseDay, 9);
    assert.equal(fetchCalls.length, 0,
      'without registered indexed cycles, rollover still refreshes from chain only');
  });

  test('an RPC failure keeps the last good payload without consulting the API', async () => {
    const prior = _testing.buildGoldRushChainPayload(SNAPSHOT, GAME_STATE);
    storeMod.update('app.goldRush', prior);
    _testing.setGoldRushSnapshotReader(async () => { throw new Error('RPC unavailable'); });

    const payload = await _testing.pollGoldRush(new AbortController().signal);

    assert.equal(payload, null);
    assert.equal(storeMod.get('app.goldRush'), prior);
    assert.equal(fetchCalls.length, 0);
  });

  test('unchanged money keeps the move block pinned; a change advances it', () => {
    const first = _testing.buildGoldRushChainPayload(SNAPSHOT, GAME_STATE);
    const quiet = _testing.buildGoldRushChainPayload(
      { ...SNAPSHOT, blockNumber: 500 },
      GAME_STATE,
      first,
    );
    const moved = _testing.buildGoldRushChainPayload(
      { ...SNAPSHOT, blockNumber: 501, nextWei: 201n },
      GAME_STATE,
      quiet,
    );
    assert.equal(quiet.atBlock, 456, 'empty blocks do not reset adaptive cadence');
    assert.equal(quiet.deltaWei, '0');
    assert.equal(moved.atBlock, 501);
    assert.equal(moved.fromBlock, 456);
    assert.equal(moved.deltaWei, '1');
  });

  test('a new chain day advances the phase clock even when pool money is unchanged', () => {
    const first = _testing.buildGoldRushChainPayload(SNAPSHOT, GAME_STATE);
    const nextDay = _testing.buildGoldRushChainPayload(
      { ...SNAPSHOT, blockNumber: 500, currentDay: 168n },
      GAME_STATE,
      first,
    );

    assert.equal(nextDay.headlineWei, first.headlineWei);
    assert.equal(nextDay.deltaWei, '0');
    assert.equal(nextDay.phaseClock.purchaseDay, 9);
    assert.equal(nextDay.atBlock, 500,
      'a player-visible phase change resets the direct-chain adaptive cadence');
  });

  test('packed GAME state supplies jackpot draw and transition flags without the indexer', () => {
    const jackpotSlot = 160n
      | (168n << 24n)
      | (41n << 96n)
      | (1n << 120n)
      | (2n << 128n)
      | (1n << 152n)
      | (1n << 184n);
    const payload = _testing.buildGoldRushChainPayload(
      { ...SNAPSHOT, phaseSlot0: jackpotSlot, currentDay: 168n },
      null,
    );

    assert.equal(payload.level, 41);
    assert.equal(payload.phase, 'JACKPOT');
    assert.equal(payload.phaseDay, 2);
    assert.deepEqual(payload.phaseClock, {
      currentDay: 168,
      purchaseStartDay: 160,
      level: 41,
      jackpot: true,
      jackpotCounter: 2,
      purchaseDay: null,
      lastPurchaseDay: false,
      rngLocked: true,
      transition: false,
      gameOver: false,
      compressedFlag: 1,
      phase: 'JACKPOT',
    });
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
    // Visible-branch effect runs ONCE — three API reads (/game/state, /health,
    // /game/jackpot/last-day) plus the direct-chain Gold Rush read, which is
    // deliberately absent from fetchCalls. /player/:addr is also absent because
    // this visible branch carries addr=null. A double effect would make 6 API calls.
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

  // CR-01 regression: visible → re-arm all 3 setIntervals after hidden cleared them.
  test('visible after hidden re-arms all 3 setIntervals (CR-01 regression)', async () => {
    start({ playerAddress: '0xabc' });
    await new Promise((r) => setTimeout(r, 10));
    globalThis.document.visibilityState = 'hidden';
    handleVisibilityChange();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(_testing.TIMER_HANDLES.game, null, 'precondition: game cleared on hidden');
    assert.equal(_testing.TIMER_HANDLES.player, null, 'precondition: player cleared on hidden');
    assert.equal(_testing.TIMER_HANDLES.health, null, 'precondition: health cleared on hidden');

    globalThis.document.visibilityState = 'visible';
    handleVisibilityChange();
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(_testing.TIMER_HANDLES.game !== null, 'game re-armed on visible');
    assert.ok(_testing.TIMER_HANDLES.player !== null, 'player re-armed on visible');
    assert.ok(_testing.TIMER_HANDLES.health !== null, 'health re-armed on visible');
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
  test('propagates caller abort to the brokered fetch + prepends API_BASE', async () => {
    let captured = null;
    fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };
    const ctrl = new AbortController();
    const request = _testing.fetchJSONWithSignal('/foo', { signal: ctrl.signal });
    assert.equal(captured.url, 'https://degenerus-db.fly.dev/foo', 'API_BASE prepended');
    ctrl.abort();
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal(captured.opts.signal.aborted, true, 'last consumer abort cancels network work');
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
    assert.equal(captured.url, 'https://degenerus-db.fly.dev/baz');
    assert.equal(captured.opts.signal instanceof AbortSignal, true);
    assert.equal(captured.opts.signal.aborted, false);
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
  test('a completion-triggered read bypasses browser HTTP cache', async () => {
    let captured = null;
    fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          day: 9,
          level: 2,
          summary: null,
          winners: [],
          roll1: { day: 9, level: 2, purchaseLevel: null, wins: [] },
          roll2: { day: 9, level: 2, purchaseLevel: null, wins: [] },
          status: 'resolved-no-winners',
        }),
      };
    };

    await _testing.pollLastDay(new AbortController().signal, { force: true });

    assert.ok(captured.url.endsWith('/game/jackpot/last-day'));
    assert.equal(captured.opts.cache, 'no-store');
  });

  test('the chain completion edge coalesces to one result request per day', async () => {
    let jackpotDay = 20;
    fetchImpl = async (url, opts) => {
      fetchCalls.push({ url, opts });
      if (url.endsWith('/game/jackpot/last-day')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            day: jackpotDay,
            level: 4,
            summary: null,
            winners: [],
            roll1: { day: jackpotDay, level: 4, purchaseLevel: null, wins: [] },
            roll2: { day: jackpotDay, level: 4, purchaseLevel: null, wins: [] },
            status: 'resolved-no-winners',
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ url }) };
    };
    start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fetchCalls = [];
    jackpotDay = 21;

    const first = refreshJackpotAfterChainCompletion({ day: 21, includePlayer: false });
    const duplicate = refreshJackpotAfterChainCompletion({ day: 21, includePlayer: false });
    assert.equal(duplicate, first, 'same-day callers share one completion promise');
    const payload = await first;
    const resultCalls = fetchCalls.filter((call) => call.url.endsWith('/game/jackpot/last-day'));

    assert.equal(payload.day, 21);
    assert.equal(resultCalls.length, 1);
    assert.equal(resultCalls[0].opts.cache, 'no-store');
    assert.equal(storeMod.get('app.lastDay').day, 21);
    assert.equal(_testing.jackpotCompletionDay, 21);

    await refreshJackpotAfterChainCompletion({ day: 21, includePlayer: false });
    assert.equal(
      fetchCalls.filter((call) => call.url.endsWith('/game/jackpot/last-day')).length,
      1,
      'a repeated completion notification cannot create another request',
    );
  });

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

  test('game state is shared while player/health remain private to their pollers', async () => {
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
    // app.lastDay and the day-change signal are shared; player/health remain
    // private to their consumers.
    assert.ok(storeMod.get('app.lastDay') != null, 'app.lastDay set');
    assert.ok(storeMod.get('app.gameState') != null, 'app.gameState set');
    assert.equal(storeMod.get('app.game'), undefined, 'app.game untouched (Phase 60)');
    assert.equal(storeMod.get('app.player'), undefined, 'app.player untouched');
    assert.equal(storeMod.get('app.health'), undefined, 'app.health untouched');
  });

  test('a resolved day retries jackpot until app.lastDay catches up', () => {
    let refreshes = 0;
    const refreshLastDay = () => { refreshes += 1; };

    _testing.publishGameState({ dailyRng: { day: 171 } }, refreshLastDay);
    assert.equal(refreshes, 1, 'first exact snapshot requests the still-missing draw');

    _testing.publishGameState({ dailyRng: { day: 171 } }, refreshLastDay);
    assert.equal(refreshes, 2, 'a raced/stale jackpot response is retried on the next state poll');

    storeMod.update('app.lastDay', { day: 171 });
    _testing.publishGameState({ dailyRng: { day: 171 } }, refreshLastDay);
    assert.equal(refreshes, 2, 'once the displayed draw catches up, same-day polls stay quiet');

    _testing.publishGameState({ dailyRng: { day: 172 } }, refreshLastDay);
    assert.equal(refreshes, 3, 'normal rollover refreshes the draw immediately');

    storeMod.update('app.lastDay', { day: 172 });
    _testing.publishGameState({ dailyRng: { day: 10 } }, refreshLastDay);
    assert.equal(refreshes, 4, 'a lower day after redeploy is also a real epoch change');
    assert.equal(storeMod.get('app.gameState').dailyRng.day, 10);
  });

  test('same-day game polls retry an incomplete no-winners composition until it heals', () => {
    let refreshes = 0;
    storeMod.update('app.lastDay', {
      day: 234,
      status: 'resolved-no-winners',
      winners: [],
      summary: null,
      roll1: { wins: [] },
      roll2: { wins: [] },
    });

    _testing.publishGameState(
      { dailyRng: { day: 234 } },
      () => { refreshes += 1; },
    );
    assert.equal(refreshes, 1, 'same day does not make an unproven empty result permanent');
  });

  // The guard behind removing the 15s lastDay interval. Asserting on fetch counts
  // after a short wait would prove nothing — a re-added 15s timer would not have
  // fired yet. Spying on setInterval registration is exact and time-independent.
  test('start() registers no recurring timer that fetches last-day', async () => {
    const realSetInterval = globalThis.setInterval;
    const registered = [];
    globalThis.setInterval = (fn, ms) => {
      registered.push(ms);
      return realSetInterval(fn, ms);
    };
    try {
      start();
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      globalThis.setInterval = realSetInterval;
    }

    // Periods are jittered ±20%, so match each to its nominal by band rather
    // than by equality. The three bands do not overlap.
    const nominals = [POLL_INTERVALS.gameState, POLL_INTERVALS.playerData, POLL_INTERVALS.health]
      .sort((a, b) => a - b);
    const got = registered.sort((a, b) => a - b);
    assert.equal(got.length, 3, `exactly three intervals — nothing for last-day; saw ${got}`);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(
        got[i] >= nominals[i] * 0.8 && got[i] <= nominals[i] * 1.2,
        `interval ${got[i]} within ±20% of nominal ${nominals[i]}`,
      );
    }
    assert.equal(
      fetchCalls.filter((c) => c.url.endsWith('/game/jackpot/last-day')).length, 1,
      'last-day still fetched once, eagerly, at start',
    );
  });

  test('a steady sealed day never re-requests the jackpot payload', () => {
    const STEADY = { dailyRng: { day: 200 } };
    storeMod.update('app.lastDay', { day: 200 });
    // publishGameState is what the game cycle calls every tick. On a steady day it
    // must not invoke the refresh callback at all.
    for (let i = 0; i < 5; i += 1) {
      _testing.publishGameState(STEADY, () => { throw new Error('must not refresh'); });
    }

    // A real rollover still pulls it, through the same path.
    let refreshed = 0;
    _testing.publishGameState({ dailyRng: { day: 201 } }, () => { refreshed += 1; });
    assert.equal(refreshed, 1, 'rollover still refreshes immediately');
  });
});

// ===========================================================================
// approvers fetch + approvals.list (account-switcher, 2026-07-16)
// ===========================================================================

const CONNECTED = '0xc0ffee0000000000000000000000000000c0ff';
const APPROVER_A = '0xaaaa000000000000000000000000000000a001';
const APPROVER_B = '0xbbbb000000000000000000000000000000b002';

describe('shed-load cooldown (429 / 503)', () => {
  for (const status of [429, 503]) {
    test(`${status} arms a cooldown that suppresses the next read without a network call`, async () => {
      let calls = 0;
      fetchImpl = async () => { calls += 1; return { ok: false, status, json: async () => ({}) }; };

      await assert.rejects(() => _testing.fetchJSONWithSignal('/game/state', {}));
      assert.equal(calls, 1, 'the shedding response was a real request');
      assert.ok(_testing.cooldownUntil > Date.now(), 'cooldown armed');

      // The point: the client stops knocking. Not "retries more politely" —
      // makes no request at all until the window passes.
      await assert.rejects(
        () => _testing.fetchJSONWithSignal('/game/state', {}),
        /cooling down/,
      );
      assert.equal(calls, 1, 'no second request while shedding');
    });
  }

  test('a plain 500 is not treated as shed load', async () => {
    fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await assert.rejects(() => _testing.fetchJSONWithSignal('/game/state', {}), /API 500/);
    assert.equal(_testing.cooldownUntil, 0, '500 is a bug, not backpressure — keep polling');
  });

  test('Retry-After is honoured over the exponential default', async () => {
    fetchImpl = async () => ({
      ok: false,
      status: 429,
      headers: { get: (h) => (h === 'Retry-After' ? '30' : null) },
      json: async () => ({}),
    });
    await assert.rejects(() => _testing.fetchJSONWithSignal('/game/state', {}));
    const waitMs = _testing.cooldownUntil - Date.now();
    // 30s ±20% jitter, versus the 2s first-step default it would otherwise pick.
    assert.ok(waitMs > 20_000 && waitMs <= 36_000, `expected ~30s window, got ${waitMs}ms`);
  });

  test('a successful read clears the cooldown and resets the backoff step', async () => {
    fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(() => _testing.fetchJSONWithSignal('/game/state', {}));
    assert.ok(_testing.cooldownUntil > Date.now());

    _testing.clearApiCooldown();
    fetchImpl = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    };
    await _testing.fetchJSONWithSignal('/game/state', {});
    assert.equal(_testing.cooldownUntil, 0, 'recovery clears the gate');
  });

  test('jitter keeps a cohort from returning in lockstep', () => {
    const seen = new Set();
    for (let i = 0; i < 40; i += 1) seen.add(_testing.jittered(15_000));
    assert.ok(seen.size > 20, `expected spread across clients, saw ${seen.size} distinct periods`);
    for (const ms of seen) {
      assert.ok(ms >= 12_000 && ms <= 18_000, `${ms} inside ±20% of 15s`);
    }
  });
});

describe('boons + approvers are event-driven, not timed', () => {
  test('the recurring player cycle fetches neither approvers nor boons', async () => {
    storeMod.update('connected.address', CONNECTED);
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));

    // Everything above is the eager start(). What matters is the RECURRING tick.
    fetchCalls = [];
    _testing.invalidateJSONCache();
    await _testing.runPlayerCycle();
    await new Promise((r) => setTimeout(r, 20));

    const paths = fetchCalls.map((c) => c.url);
    assert.ok(paths.some((p) => p.endsWith('/player/0xviewed')), 'still polls player position');
    assert.ok(!paths.some((p) => p.includes('/approvers')), 'approvers left the timer');
    assert.ok(!paths.some((p) => p.includes('/boons/')), 'boons left the timer');
  });

  // /game/state carries the day as dailyRng.day — there is no currentDay field.
  const withDay = (day) => async (url, opts) => {
    fetchCalls.push({ url, opts });
    const body = url.endsWith('/game/state') ? { dailyRng: { day } } : { url };
    return { ok: true, status: 200, json: async () => body };
  };

  test('a buy surface opening refreshes boons, and simultaneous markers coalesce', async () => {
    fetchImpl = withDay(58);
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    fetchCalls = [];
    _testing.invalidateJSONCache();

    // Several <boon-product-indicator> elements mount together on one surface.
    for (let i = 0; i < 4; i += 1) {
      globalThis.document.dispatchEvent(new globalThis.CustomEvent('degenerus:boon-surface-open'));
    }
    await new Promise((r) => setTimeout(r, 30));

    const boonHits = fetchCalls.filter((c) => c.url.includes('/boons/')).length;
    assert.equal(boonHits, 1, 'four markers, one request');
  });

  // Regression: pollCurrentBoons read `state.currentDay`, a field /game/state has
  // never returned. The day was always NaN, so it returned an empty boon list
  // without ever calling the indexed route or the packed chain read — the boon
  // indicator could not light up in production. The day lives at dailyRng.day.
  test('resolves the day from dailyRng.day, not a currentDay field that does not exist', async () => {
    fetchImpl = withDay(58);
    const result = await _testing.pollCurrentBoons('0xViewed', undefined);
    assert.equal(result.day, 58, 'day resolved from dailyRng.day');
    assert.ok(
      fetchCalls.some((c) => c.url.endsWith('/player/0xviewed/boons/58')),
      `expected the indexed boons route to be reached; saw ${JSON.stringify(fetchCalls.map((c) => c.url))}`,
    );
  });

  test("the player's own confirmed transaction refreshes boons", async () => {
    fetchImpl = withDay(58);
    start({ playerAddress: '0xviewed' });
    await new Promise((r) => setTimeout(r, 30));
    fetchCalls = [];

    // In production contracts.js clears the render-wave cache immediately
    // before it dispatches this event. Mirror that write-chokepoint boundary.
    _testing.invalidateJSONCache();
    globalThis.document.dispatchEvent(new globalThis.CustomEvent('degenerus:tx-confirmed'));
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(
      fetchCalls.some((c) => c.url.includes('/boons/')),
      'a confirmed write re-reads boons — it may have consumed one',
    );
  });
});

describe('approvers fetch + approvals.list (account-switcher)', () => {
  test('connected wallet triggers /player/:connected/approvers on start', async () => {
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
      exact: false,
      boons: [{ boonType: 9, consumed: false, consumedBoostBps: null }],
    });
  });

  test('exact packed state replaces stale deity history and includes lootbox-awarded boons', async () => {
    const viewed = '0x1111000000000000000000000000000000000062';
    // Active purchase +25% (day 60, four-day window); the indexed response is
    // deliberately stale and claims a consumed/absent coinflip boon instead.
    const slot0 = (3n << 160n) | (60n << 112n);
    _testing.setBoonStateReader(async (address) => {
      assert.equal(address, viewed);
      return { slot0, slot1: 0n, currentDay: 62 };
    });
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
            boons: [{ boonType: 3, consumed: false }],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    start({ playerAddress: viewed });
    await new Promise((r) => setTimeout(r, 30));

    assert.deepEqual(storeMod.get('app.boons'), {
      address: viewed,
      day: 62,
      exact: true,
      boons: [{ boonType: 9, consumed: false, source: 'chain' }],
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
