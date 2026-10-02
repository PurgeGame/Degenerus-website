import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBubbleCover } from '../bubble-reveal.js';

function harness({ reducedMotion = false } = {}) {
  const timers = new Map();
  let id = 0;
  function node() {
    const properties = new Map();
    return {
      children: [], removed: false, clientWidth: 100, clientHeight: 80,
      style: { setProperty: (key, value) => properties.set(key, value), getPropertyValue: key => properties.get(key) },
      classList: { add() {} },
      setAttribute() {},
      appendChild(child) { this.children.push(child); },
      remove() { this.removed = true; },
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 50, height: 40 }),
    };
  }
  const doc = {
    createElement: node, createElementNS: node,
    defaultView: {
      matchMedia: () => ({ matches: reducedMotion }),
      setTimeout(callback, delay) { timers.set(++id, { callback, delay }); return id; },
      clearTimeout(key) { timers.delete(key); },
    },
  };
  return { doc, timers };
}

test('shorter jackpot pops use the same duration for animation and completion', () => {
  const { doc, timers } = harness();
  const cover = createBubbleCover(doc, { durationMs: 140 });
  let completions = 0;
  assert.equal(cover.element.style.getPropertyValue('--bubble-reveal-duration'), '140ms');
  assert.equal(cover.pop(null, { onComplete: () => completions++ }), true);
  assert.equal(cover.pop(null, { onComplete: () => completions++ }), false);
  assert.equal(completions, 0);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 140);
  timer.callback();
  timer.callback();
  assert.equal(completions, 1, 'completion remains single-shot');
  assert.equal(cover.element.removed, true);
});

test('other callers retain their existing pop duration', () => {
  for (const durationMs of [undefined, 0, -1, NaN]) {
    const { doc, timers } = harness();
    const cover = createBubbleCover(doc, { durationMs });
    cover.pop();
    assert.equal(cover.element.style.getPropertyValue('--bubble-reveal-duration'), '220ms');
    assert.equal([...timers.values()][0].delay, 220);
  }
});

test('a grouped pop skips layout measurements and completes exactly once', () => {
  const { doc, timers } = harness();
  const cover = createBubbleCover(doc, { durationMs: 140 });
  cover.element.getBoundingClientRect = () => { throw new Error('batch reveal forced layout'); };
  let completions = 0;
  assert.equal(cover.pop(null, { batch: true, onComplete: () => completions++ }), true);
  assert.equal(cover.pop(null, { batch: true }), false);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 140);
  timer.callback();
  timer.callback();
  assert.equal(completions, 1);
  assert.equal(cover.element.removed, true);
});

test('instant and reduced-motion reveals finish without scheduling a timer', () => {
  for (const reducedMotion of [true, false]) {
    const { doc, timers } = harness({ reducedMotion });
    const cover = createBubbleCover(doc, { durationMs: 140 });
    let completions = 0;
    cover.pop(null, { instant: !reducedMotion, onComplete: () => completions++ });
    assert.equal(completions, 1);
    assert.equal(timers.size, 0);
  }
});

test('disposing a fast pop cancels its completion when the board changes', () => {
  for (const batch of [false, true]) {
    const { doc, timers } = harness();
    const cover = createBubbleCover(doc, { durationMs: 140 });
    let completions = 0;
    cover.pop(null, { batch, onComplete: () => completions++ });
    const timer = [...timers.values()][0];
    cover.dispose();
    timer.callback();
    assert.equal(timers.size, 0);
    assert.equal(completions, 0);
  }
});
