// /app/components/__tests__/view-mode-banner.test.js — Phase 58 Plan 04 (DD-02 banner + [data-write] manager).
//
// Run: cd website && node --test app/components/__tests__/view-mode-banner.test.js
//
// Covers:
//   - Banner hidden when ui.mode === 'self'
//   - Banner visible when ui.mode === 'view'
//   - Back-CTA click clears viewing.address (update('viewing.address', null))
//   - [data-write] manager: ui.mode = 'view' → all [data-write] disabled + title='Connect to your own wallet to act'
//   - [data-write] manager: canSign === false → all [data-write] disabled + tooltip
//   - [data-write] manager: ui.mode = 'self' AND canSign true → all [data-write] enabled + tooltip cleared
//   - Manager idempotency: firing subscriber twice with same value does not throw
//   - MutationObserver: late-mounted [data-write] buttons are picked up by the manager
//
// Stub strategy mirrors player-dropdown.test.js (same Wave 3 plan):
//   - FakeHTMLElement / fake document with getElementById('view-mode-banner')
//   - Live-import store.js for subscribe/update semantics
//   - MutationObserver stub captures the registered observer + childList callback

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fake DOM element factory.
// ---------------------------------------------------------------------------

function makeFakeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    parentElement: null,
    attributes: {},
    eventListeners: {},
    _innerHTML: '',
    _textContent: '',
    _title: '',
    hidden: false,
    disabled: false,
    tabIndex: 0,
    className: '',
    classList: {
      _set: new Set(),
      add(...cs) { for (const c of cs) this._set.add(c); },
      remove(...cs) { for (const c of cs) this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        if (force === true) { this._set.add(c); return true; }
        if (force === false) { this._set.delete(c); return false; }
        if (this._set.has(c)) { this._set.delete(c); return false; }
        this._set.add(c); return true;
      },
    },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v); },
    get textContent() {
      if (this._textContent) return this._textContent;
      let acc = '';
      for (const c of this.children) acc += c.textContent || '';
      return acc;
    },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    get title() { return this._title; },
    set title(v) { this._title = String(v); },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      return child;
    },
    contains(other) {
      if (other === this) return true;
      const stack = [...this.children];
      while (stack.length) {
        const cur = stack.shift();
        if (cur === other) return true;
        if (cur.children && cur.children.length) stack.unshift(...cur.children);
      }
      return false;
    },
    querySelector(sel) {
      const stack = [...this.children];
      while (stack.length) {
        const cur = stack.shift();
        if (matches(cur, sel)) return cur;
        if (cur.children && cur.children.length) stack.unshift(...cur.children);
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      const stack = [...this.children];
      while (stack.length) {
        const cur = stack.shift();
        if (matches(cur, sel)) out.push(cur);
        if (cur.children && cur.children.length) stack.unshift(...cur.children);
      }
      return out;
    },
    matches(sel) { return matches(this, sel); },
    addEventListener(type, fn) {
      if (!this.eventListeners[type]) this.eventListeners[type] = [];
      this.eventListeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      const arr = this.eventListeners[type];
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(ev) {
      const arr = this.eventListeners[ev.type] || [];
      for (const fn of arr) {
        try { fn(ev); } catch { /* swallow */ }
      }
      return true;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
  };
  return el;
}

function matches(el, sel) {
  if (!el) return false;
  if (/^[a-z][a-z0-9-]*$/i.test(sel)) {
    return el.tagName === sel.toUpperCase();
  }
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    if (el.classList && el.classList.contains(cls)) return true;
    if (typeof el.className === 'string' && el.className.split(/\s+/).includes(cls)) return true;
    return false;
  }
  if (sel.startsWith('#')) {
    return el.attributes && el.attributes.id === sel.slice(1);
  }
  const attrEq = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attrEq) {
    return el.attributes && el.attributes[attrEq[1]] === attrEq[2];
  }
  const attrPres = sel.match(/^\[([\w-]+)\]$/);
  if (attrPres) {
    return el.attributes && Object.prototype.hasOwnProperty.call(el.attributes, attrPres[1]);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fake document — installed BEFORE dynamic-import of view-mode-banner.js.
// ---------------------------------------------------------------------------

class FakeHTMLElement {
  constructor() {
    const base = makeFakeElement(this.constructor.name || 'div');
    const descriptors = Object.getOwnPropertyDescriptors(base);
    Object.defineProperties(this, descriptors);
  }
}
globalThis.HTMLElement = FakeHTMLElement;

// Banner placeholder + back-CTA inside it.
const _bannerEl = makeFakeElement('div');
_bannerEl.attributes.id = 'view-mode-banner';
_bannerEl.classList.add('view-mode-banner');
_bannerEl.hidden = true;
const _bannerCta = makeFakeElement('button');
_bannerCta.classList.add('view-mode-banner__cta');
_bannerEl.appendChild(_bannerCta);

// Document body — root of [data-write] tree. Hosts the late-mount node for the
// MutationObserver test.
const _docBody = makeFakeElement('body');

const _docListeners = new Map();
let _docReadyState = 'complete';

// Track [data-write] elements: tests append them to _docBody and the document's
// querySelectorAll('[data-write]') reflects the body's subtree.
globalThis.document = {
  get readyState() { return _docReadyState; },
  set readyState(v) { _docReadyState = v; },
  addEventListener: (type, fn) => {
    if (!_docListeners.has(type)) _docListeners.set(type, []);
    _docListeners.get(type).push(fn);
  },
  removeEventListener: () => {},
  dispatchEvent: () => true,
  createElement: (tag) => makeFakeElement(tag),
  getElementById: (id) => {
    if (id === 'view-mode-banner') return _bannerEl;
    return null;
  },
  querySelector: (sel) => _docBody.querySelector(sel),
  querySelectorAll: (sel) => _docBody.querySelectorAll(sel),
  body: _docBody,
};

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { search: '', href: 'http://localhost/' },
};

globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};

// MutationObserver stub: capture the callback so tests can fire it manually.
let _mutationObserverCallback = null;
let _mutationObserverTarget = null;
class FakeMutationObserver {
  constructor(cb) { this._cb = cb; }
  observe(target, opts) {
    _mutationObserverCallback = this._cb;
    _mutationObserverTarget = target;
    this._opts = opts;
  }
  disconnect() {}
}
globalThis.MutationObserver = FakeMutationObserver;

// ---------------------------------------------------------------------------
// Live store — same module view-mode-banner.js writes against.
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function makeWriteButton() {
  const btn = makeFakeElement('button');
  btn.attributes['data-write'] = '';
  btn.disabled = false;
  btn.title = '';
  return btn;
}

function resetDom() {
  _bannerEl.hidden = true;
  _bannerCta.eventListeners = {};
  // Re-attach an empty handler container on the CTA — _bannerCta.addEventListener will repopulate.
  _docBody.children = [];
  _mutationObserverCallback = null;
  _mutationObserverTarget = null;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// view-mode-banner.js's module-init runs when imported. Its setup runs once and
// installs subscribers that get cleared by store.__resetForTest(). Like wallet-picker.js
// in plan 58-03, we re-install via test-only export between tests.
let _bannerSetupHandle = null;

beforeEach(async () => {
  storeMod.__resetForTest();
  resetDom();
  _docListeners.clear();
  // Ensure module loaded (cached after first import).
  const mod = await import('../view-mode-banner.js');
  // BL-02: setupBanner / setupDataWriteManager are idempotent across the
  // process lifetime. To re-install subscribers after storeMod.__resetForTest
  // wiped the registry, tear down via the module's __resetForTest first.
  if (typeof mod.__resetForTest === 'function') mod.__resetForTest();
  // Re-run setup so the subscribers are reinstalled in the fresh store registry.
  // setupBanner re-subscribes to ui.mode AND re-binds the back-CTA click handler.
  // setupDataWriteManager re-subscribes to ui.mode/ui.chainOk/connected.address +
  // re-installs the MutationObserver.
  mod.setupBanner();
  mod.setupDataWriteManager();
  _bannerSetupHandle = mod;
});

afterEach(() => {
  _bannerSetupHandle = null;
});

async function importBanner() {
  return import('../view-mode-banner.js');
}

// ===========================================================================
// Banner visibility + back-CTA
// ===========================================================================

describe('view-mode-banner banner visibility (DD-02)', () => {
  test('Banner hidden initially (ui.mode === self)', () => {
    assert.equal(_bannerEl.hidden, true, 'banner hidden when mode=self');
  });

  test('Banner becomes visible when ui.mode flips to view', async () => {
    storeMod.update('viewing.address', '0xab12000000000000000000000000000000000000');
    await flushMicrotasks();
    assert.equal(storeMod.get('ui.mode'), 'view');
    assert.equal(_bannerEl.hidden, false, 'banner visible when mode=view');
  });

  test('Banner becomes hidden again when ui.mode flips back to self', async () => {
    storeMod.update('viewing.address', '0xab12000000000000000000000000000000000000');
    await flushMicrotasks();
    assert.equal(_bannerEl.hidden, false);
    storeMod.update('viewing.address', null);
    await flushMicrotasks();
    assert.equal(storeMod.get('ui.mode'), 'self');
    assert.equal(_bannerEl.hidden, true, 'banner hidden when mode flips back to self');
  });

  test('Back-to-my-account CTA click clears viewing.address', async () => {
    storeMod.update('viewing.address', '0xab12000000000000000000000000000000000000');
    await flushMicrotasks();
    assert.equal(_bannerEl.hidden, false);
    // Click the back-CTA.
    _bannerCta.dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    assert.equal(storeMod.get('viewing.address'), null, 'viewing.address cleared');
    assert.equal(storeMod.get('ui.mode'), 'self', 'ui.mode auto-derives back to self');
  });
});

// ===========================================================================
// [data-write] disable manager
// ===========================================================================

describe('[data-write] disable manager (DD-02)', () => {
  test('ui.mode=view disables every [data-write] + title=Connect to your own wallet to act', async () => {
    const btn1 = makeWriteButton();
    const btn2 = makeWriteButton();
    _docBody.appendChild(btn1);
    _docBody.appendChild(btn2);

    storeMod.update('viewing.address', '0xab12000000000000000000000000000000000000');
    await flushMicrotasks();
    // Trigger refresh by re-firing a path the manager subscribes to.
    storeMod.update('ui.chainOk', false);
    await flushMicrotasks();

    assert.equal(btn1.disabled, true, 'btn1 disabled');
    assert.equal(btn2.disabled, true, 'btn2 disabled');
    assert.equal(btn1.title, 'Connect to your own wallet to act', 'tooltip text exact match');
    assert.equal(btn2.title, 'Connect to your own wallet to act', 'tooltip text exact match');
  });

  test('canSign=false (no connected wallet) disables every [data-write] + tooltip', async () => {
    const btn = makeWriteButton();
    _docBody.appendChild(btn);
    // Initial state: connected.address null, ui.mode self → canSign false.
    // Re-trigger via update.
    storeMod.update('ui.chainOk', null);
    await flushMicrotasks();
    assert.equal(btn.disabled, true, 'disabled when no wallet');
    assert.equal(btn.title, 'Connect to your own wallet to act');
  });

  test('canSign true (mode=self, chainOk=true, connected truthy) enables [data-write] + clears tooltip', async () => {
    const btn = makeWriteButton();
    _docBody.appendChild(btn);
    // Pre-disable to verify the manager flips it back.
    btn.disabled = true;
    btn.title = 'Connect to your own wallet to act';

    storeMod.update('connected.address', '0xab12000000000000000000000000000000000000');
    storeMod.update('ui.chainOk', true);
    await flushMicrotasks();

    assert.equal(storeMod.deriveCanSign(), true, 'canSign true precondition');
    assert.equal(btn.disabled, false, 'enabled when canSign true');
    assert.equal(btn.title, '', 'tooltip cleared');
  });

  test('Mode flip view→self with canSign true re-enables [data-write]', async () => {
    const btn = makeWriteButton();
    _docBody.appendChild(btn);
    storeMod.update('connected.address', '0xaa11000000000000000000000000000000000000');
    storeMod.update('ui.chainOk', true);
    await flushMicrotasks();
    assert.equal(btn.disabled, false);
    // Now go to view-mode.
    storeMod.update('viewing.address', '0xbb22000000000000000000000000000000000000');
    await flushMicrotasks();
    assert.equal(btn.disabled, true, 'disabled on flip to view');
    assert.equal(btn.title, 'Connect to your own wallet to act');
    // Flip back.
    storeMod.update('viewing.address', null);
    await flushMicrotasks();
    assert.equal(btn.disabled, false, 're-enabled when back to self+canSign');
    assert.equal(btn.title, '', 'tooltip cleared on re-enable');
  });

  test('Manager idempotent: firing subscriber twice with same value does not throw', async () => {
    const btn = makeWriteButton();
    _docBody.appendChild(btn);
    storeMod.update('ui.chainOk', false);
    await flushMicrotasks();
    storeMod.update('ui.chainOk', false);
    await flushMicrotasks();
    assert.equal(btn.disabled, true);
  });

  test('MutationObserver: late-mounted [data-write] button picked up after refresh', async () => {
    // Simulate Phase 60+ panel mounting a button after view-mode-banner.js init.
    const btn = makeWriteButton();
    _docBody.appendChild(btn);
    // Fire the registered MutationObserver callback.
    assert.ok(_mutationObserverCallback, 'observer was registered');
    _mutationObserverCallback([{ addedNodes: [btn] }]);
    await flushMicrotasks();
    // Initial state has canSign=false → late-mounted button gets disabled.
    assert.equal(btn.disabled, true, 'late-mounted button disabled by manager');
    assert.equal(btn.title, 'Connect to your own wallet to act');
  });
});
