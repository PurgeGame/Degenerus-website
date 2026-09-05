import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountAmbientMotion } from '../ambient-motion.js';

test('decorations pause outside the viewport and hidden tabs, including late mounts', (t) => {
  let intersect, mutate, visibility;
  const observed = new Set();
  const makeElement = () => ({
    nodeType: 1, isConnected: true, paused: false,
    matches: () => true, querySelectorAll: () => [],
    hasAttribute() { return this.paused; },
    toggleAttribute(name, value) { this.paused = value; },
    removeAttribute() { this.paused = false; },
  });
  const first = makeElement();
  const root = {
    body: { nodeType: 1, matches: () => false, querySelectorAll: () => [first] },
    visibilityState: 'visible',
    addEventListener(name, fn) { visibility = fn; },
    removeEventListener() { visibility = null; },
  };
  const oldIO = globalThis.IntersectionObserver;
  const oldMO = globalThis.MutationObserver;
  t.after(() => {
    if (oldIO === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = oldIO;
    if (oldMO === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = oldMO;
  });
  globalThis.IntersectionObserver = class {
    constructor(fn) { intersect = fn; }
    observe(el) { observed.add(el); }
    unobserve(el) { observed.delete(el); }
    disconnect() { observed.clear(); }
  };
  globalThis.MutationObserver = class {
    constructor(fn) { mutate = fn; }
    observe() {}
    disconnect() {}
  };
  const cleanup = mountAmbientMotion(root);
  assert.equal(first.paused, true);
  intersect([{ target: first, isIntersecting: true }]);
  assert.equal(first.paused, false);
  root.visibilityState = 'hidden';
  visibility();
  assert.equal(first.paused, true);
  root.visibilityState = 'visible';
  visibility();
  assert.equal(first.paused, false);
  intersect([{ target: first, isIntersecting: false }]);
  assert.equal(first.paused, true);

  const late = makeElement();
  mutate([{ addedNodes: [late], removedNodes: [] }]);
  assert.ok(observed.has(late));
  assert.equal(late.paused, true);
  // Moving a live element should not drop its observer.
  mutate([{ addedNodes: [late], removedNodes: [late] }]);
  assert.ok(observed.has(late));
  late.isConnected = false;
  mutate([{ addedNodes: [], removedNodes: [late] }]);
  assert.equal(observed.has(late), false);
  assert.equal(late.paused, false);
  intersect([{ target: late, isIntersecting: false }]);
  assert.equal(late.paused, false, 'ignore queued records for retired nodes');
  cleanup();
  assert.equal(first.paused, false);
  assert.equal(observed.size, 0);
  assert.equal(visibility, null);
});
