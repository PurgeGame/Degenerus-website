import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetBalanceDisplay, updateBalanceDisplay } from '../balance-countup.js';

function makeClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
  };
}

function makeDisplay() {
  const attributes = new Map();
  const container = {
    classList: makeClassList(),
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    offsetWidth: 100,
  };
  const element = { textContent: '', parentElement: container };
  return { element, container };
}

let frames;
let nextFrameId;

function runFrame(timestamp) {
  const queued = [...frames.values()];
  frames.clear();
  for (const callback of queued) callback(timestamp);
}

describe('balance count-up presentation', () => {
  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    globalThis.requestAnimationFrame = (callback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => frames.delete(id);
    globalThis.matchMedia = () => ({ matches: false });
  });

  afterEach(() => {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
    delete globalThis.matchMedia;
  });

  test('first paint and account changes snap without pretending an award landed', () => {
    const { element, container } = makeDisplay();
    const format = (value) => `${value} FLIP`;
    updateBalanceDisplay(element, { scope: '0xaaa', value: 100n, format });
    assert.equal(element.textContent, '100 FLIP');
    assert.equal(container.classList.contains('balance-rise'), false);

    updateBalanceDisplay(element, { scope: '0xbbb', value: 250n, format });
    assert.equal(element.textContent, '250 FLIP');
    assert.equal(frames.size, 0);
    resetBalanceDisplay(element);
  });

  test('a same-wallet increase counts up and exposes only the formatted delta flare', () => {
    const { element, container } = makeDisplay();
    const format = (value) => `${value} FLIP`;
    updateBalanceDisplay(element, { scope: '0xaaa', value: 100n, format });
    updateBalanceDisplay(element, {
      scope: '0xaaa', value: 200n, format, duration: 200,
      formatDelta: (value) => `+${value} FLIP`,
    });

    assert.equal(element.textContent, '100 FLIP');
    assert.equal(container.classList.contains('balance-rise'), true);
    assert.equal(container.getAttribute('data-balance-delta'), '+100 FLIP');
    runFrame(0);
    runFrame(100);
    assert.ok(BigInt(element.textContent.split(' ')[0]) > 100n);
    assert.ok(BigInt(element.textContent.split(' ')[0]) < 200n);
    runFrame(200);
    assert.equal(element.textContent, '200 FLIP');
    resetBalanceDisplay(element);
  });

  test('masked claimable values never enter the DOM, then animate from their private baseline', () => {
    const { element, container } = makeDisplay();
    const format = (value) => `${value} ETH`;
    updateBalanceDisplay(element, {
      scope: '0xaaa', value: 123456789n, visible: false, hiddenText: '••••', format,
    });
    updateBalanceDisplay(element, {
      scope: '0xaaa', value: 223456789n, visible: false, hiddenText: '••••', format,
    });
    assert.equal(element.textContent, '••••');
    assert.doesNotMatch(element.textContent, /123|223/);
    assert.equal(container.getAttribute('data-balance-delta'), null);

    updateBalanceDisplay(element, {
      scope: '0xaaa', value: 323456789n, visible: true, hiddenText: '••••', format, duration: 200,
    });
    assert.equal(element.textContent, '123456789 ETH');
    assert.equal(container.classList.contains('balance-rise'), true);
    runFrame(0);
    runFrame(200);
    assert.equal(element.textContent, '323456789 ETH');
    resetBalanceDisplay(element);
  });

  test('a decrease snaps and clears any increase treatment', () => {
    const { element, container } = makeDisplay();
    updateBalanceDisplay(element, { scope: '0xaaa', value: 500n });
    updateBalanceDisplay(element, { scope: '0xaaa', value: 700n, duration: 200 });
    assert.equal(container.classList.contains('balance-rise'), true);
    updateBalanceDisplay(element, { scope: '0xaaa', value: 400n });
    assert.equal(element.textContent, '400');
    assert.equal(container.classList.contains('balance-rise'), false);
    assert.equal(frames.size, 0);
    resetBalanceDisplay(element);
  });
});
