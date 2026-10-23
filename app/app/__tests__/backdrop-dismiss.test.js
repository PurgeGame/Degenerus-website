import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { dismissOnBackdrop } from '../backdrop-dismiss.js';

function fakeBackdrop() {
  const listeners = {};
  return {
    addEventListener(type, fn) { listeners[type] = fn; },
    fire(type, target) { listeners[type]?.({ type, target }); },
  };
}

describe('dismissOnBackdrop', () => {
  test('a press and click on the backdrop closes', () => {
    const backdrop = fakeBackdrop();
    let closed = 0;
    dismissOnBackdrop(backdrop, () => { closed += 1; });
    backdrop.fire('pointerdown', backdrop);
    backdrop.fire('click', backdrop);
    assert.equal(closed, 1);
  });

  test('a tap that began on a field stays open even when the click lands on the backdrop', () => {
    // Phone: focusing the amount lifts the card, and the click is hit-tested again.
    const backdrop = fakeBackdrop();
    const field = {};
    let closed = 0;
    dismissOnBackdrop(backdrop, () => { closed += 1; });
    backdrop.fire('pointerdown', field);
    backdrop.fire('click', backdrop);
    assert.equal(closed, 0);
    // The press is forgotten after its click: the next backdrop tap closes.
    backdrop.fire('pointerdown', backdrop);
    backdrop.fire('click', backdrop);
    assert.equal(closed, 1);
  });

  test('a click inside the card never closes; a click without a press is judged by its target', () => {
    const backdrop = fakeBackdrop();
    let closed = 0;
    dismissOnBackdrop(backdrop, () => { closed += 1; });
    backdrop.fire('click', {});
    assert.equal(closed, 0);
    backdrop.fire('click', backdrop);
    assert.equal(closed, 1);
  });

  test('a missing backdrop is ignored', () => {
    assert.doesNotThrow(() => dismissOnBackdrop(null, () => {}));
  });
});
