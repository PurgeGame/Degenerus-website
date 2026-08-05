import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatJackpotCountdown,
  mountJackpotCountdown,
  secondsUntilDayCrossover,
} from '../jackpot-countdown.js';

test('countdown follows the exact game-day crossover and ignores readiness estimates', () => {
  const testnet = { anchor: 82_620, period: 600, jackpotReadyDelay: 60 };
  assert.equal(secondsUntilDayCrossover((82_620 + 125) * 1000, testnet), 475,
    'the hard-coded one-minute readiness estimate does not move the boundary');
  assert.equal(secondsUntilDayCrossover((82_620 + 599.001) * 1000, testnet), 1);
  assert.equal(secondsUntilDayCrossover((82_620 + 600) * 1000, testnet), 600,
    'at crossover the clock immediately tracks the following protocol day');
  assert.equal(secondsUntilDayCrossover((82_620 + 660) * 1000, testnet), 540);
});

test('countdown uses compact minute and hour formats', () => {
  assert.equal(formatJackpotCountdown(475), '07:55');
  assert.equal(formatJackpotCountdown(3_661), '01:01:01');
});

test('mounted topbar clock paints immediately, ticks, and cleans up', () => {
  let current = (82_620 + 125) * 1000;
  let tick = null;
  let delay = null;
  let cleared = null;
  const value = { textContent: '' };
  const host = {
    title: '',
    attrs: {},
    querySelector(selector) {
      return selector === '[data-bind="nav-jackpot-countdown-value"]' ? value : null;
    },
    setAttribute(name, val) { this.attrs[name] = val; },
  };
  const root = {
    querySelector(selector) {
      return selector === '[data-bind="nav-jackpot-countdown"]' ? host : null;
    },
  };

  const cleanup = mountJackpotCountdown({
    root,
    now: () => current,
    clock: { anchor: 82_620, period: 600 },
    setTimer(fn, ms) { tick = fn; delay = ms; return 17; },
    clearTimer(id) { cleared = id; },
  });

  assert.equal(value.textContent, '07:55');
  assert.equal(host.attrs['aria-label'], 'Next jackpot in 07:55');
  assert.equal(host.title, 'Next jackpot in 07:55');
  assert.equal(delay, 250);
  current += 1_000;
  tick();
  assert.equal(value.textContent, '07:54');
  cleanup();
  assert.equal(cleared, 17);
});
