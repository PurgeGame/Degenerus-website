// /app/app/__tests__/component-poll.test.js
//
// Run: cd website && node --test app/app/__tests__/component-poll.test.js
//
// What must hold:
//   - a registered poll ticks on its interval and stops on unregister
//   - unregister is idempotent
//   - hidden tab disarms every poll; visible re-fires each immediately and re-arms
//   - registering while hidden stays disarmed until visible

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let hidden = false;
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener: () => {} };
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  get visibilityState() { return hidden ? 'hidden' : 'visible'; },
};
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

const cp = await import('../component-poll.js');
const drawGate = await import('../major-draw-activity.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  cp._resetComponentPollsForTests();
  drawGate.__resetMajorDrawActivityForTest();
  hidden = false;
});

test('ticks on its interval; unregister stops it and is idempotent', async () => {
  let ticks = 0;
  const un = cp.registerComponentPoll(() => { ticks++; }, 20);
  assert.equal(cp._componentPollStatsForTests().armed, 1);
  await sleep(70);
  assert.ok(ticks >= 2, `expected >=2 ticks, got ${ticks}`);
  un();
  un();
  const at = ticks;
  await sleep(50);
  assert.equal(ticks, at, 'no ticks after unregister');
  assert.deepEqual(cp._componentPollStatsForTests(), { registered: 0, armed: 0 });
});

test('hidden disarms; visible re-fires immediately and re-arms', async () => {
  let ticks = 0;
  cp.registerComponentPoll(() => { ticks++; }, 5_000);
  assert.equal(ticks, 0, 'registration does not fire the callback');

  hidden = true;
  cp._onVisibilityChangeForTests();
  assert.equal(cp._componentPollStatsForTests().armed, 0, 'hidden = disarmed');

  hidden = false;
  cp._onVisibilityChangeForTests();
  assert.equal(ticks, 1, 'return-from-hidden fires the coherent catch-up');
  assert.equal(cp._componentPollStatsForTests().armed, 1, 're-armed');
});

test('registering while hidden stays disarmed until visible', () => {
  hidden = true;
  let ticks = 0;
  cp.registerComponentPoll(() => { ticks++; }, 1_000);
  assert.equal(cp._componentPollStatsForTests().armed, 0);
  hidden = false;
  cp._onVisibilityChangeForTests();
  assert.equal(ticks, 1);
  assert.equal(cp._componentPollStatsForTests().armed, 1);
});

test('major draw activity excludes component poll work from the reel task lane', async () => {
  const order = [];
  cp.registerComponentPoll(() => {
    // Always-mounted consumers include the 12s sDGNRS log-discovery refresh.
    // Any synchronous continuation here owns the same browser thread as the reel.
    order.push('background-start', 'background-end');
  }, 12_000);
  drawGate.setMajorDrawActivity('jackpot-replay', true);
  assert.equal(cp._componentPollStatsForTests().armed, 0,
    'entering a draw disarms the registered background intervals');

  const reelContinuation = Promise.resolve().then(() => order.push('reel'));
  cp._onVisibilityChangeForTests();
  await reelContinuation;

  assert.deepEqual(order, ['reel'],
    'component callbacks must not be admitted while a major draw owns the frame lane');

  drawGate.setMajorDrawActivity('jackpot-replay', false);
  assert.deepEqual(order, ['reel'],
    'leaving the draw does not burst deferred work into the scratch handoff');
  assert.equal(cp._componentPollStatsForTests().armed, 1,
    'the normal interval cadence resumes after the draw');
});

test('bad arguments return a no-op unregister', () => {
  assert.equal(typeof cp.registerComponentPoll(null, 100), 'function');
  assert.equal(typeof cp.registerComponentPoll(() => {}, 0), 'function');
  assert.equal(cp._componentPollStatsForTests().registered, 0);
});

test('slow async ticks are single-flight and collapse into one trailing refresh', async () => {
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const releases = [];
  const unregister = cp.registerComponentPoll(() => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve) => {
      releases.push(() => {
        active -= 1;
        resolve();
      });
    });
  }, 10);

  await sleep(36);
  assert.equal(calls, 1, 'interval ticks do not overlap the first slow request');
  releases.shift()();
  await sleep(2);
  assert.equal(calls, 2, 'missed ticks become one immediate trailing refresh');
  assert.equal(maxActive, 1);

  unregister();
  releases.shift()();
  await sleep(15);
  assert.equal(calls, 2, 'finishing after unregister cannot schedule more work');
});
