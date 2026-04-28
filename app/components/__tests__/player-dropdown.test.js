// /app/components/__tests__/player-dropdown.test.js — Phase 58 Plan 04 (DD-02 typeahead consumer).
//
// Run: cd website && node --test app/components/__tests__/player-dropdown.test.js
//
// Covers:
//   - <2 char input: never fires fetch
//   - >=2 char input: fires fetch after 300ms debounce
//   - Two rapid keystrokes within 300ms: ONE fetch (debounce coalesces)
//   - Two keystrokes 400ms apart: TWO fetches; the FIRST AbortController.abort() called before second fetch
//   - Successful response renders one <li> per result
//   - affiliateCode preferred over address abbreviation in row label
//   - Click on <li> calls store.update('viewing.address', address.toLowerCase())
//   - Click on <li> clears input + hides result list
//   - AbortError caught silently
//   - Non-AbortError logs warning (but does not throw)
//   - XSS: malicious affiliateCode rendered via textContent (NEVER innerHTML interpolation)
//
// Stub strategy mirrors wallet-picker.test.js (Plan 58-03):
//   - FakeHTMLElement with Object.defineProperties for accessor preservation
//   - Live-import store.js (subscribe/update semantics match production)
//   - Mock globalThis.fetch + globalThis.AbortController

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fake DOM element factory (minimal — supports the picker's surface only).
// ---------------------------------------------------------------------------

function makeFakeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentElement: null,
    attributes: {},
    eventListeners: {},
    _innerHTML: '',
    _textContent: '',
    _src: '',
    _alt: '',
    _value: '',
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
    set innerHTML(v) {
      this._innerHTML = String(v);
      this.children = [];
      // Materialize the player-dropdown skeleton when the literal contains the
      // input + ul markers — the connectedCallback template only.
      if (v && typeof v === 'string' && v.includes('player-search-input') && v.includes('player-search-results')) {
        const input = makeFakeElement('input');
        input.classList.add('player-search-input');
        const ul = makeFakeElement('ul');
        ul.classList.add('player-search-results');
        ul.hidden = true;
        this.appendChild(input);
        this.appendChild(ul);
      }
    },
    get textContent() {
      if (this._textContent) return this._textContent;
      let acc = '';
      for (const c of this.children) acc += c.textContent || '';
      return acc;
    },
    set textContent(v) {
      this._textContent = String(v);
      this.children = [];
    },
    get value() { return this._value; },
    set value(v) { this._value = String(v); },
    get src() { return this._src; },
    set src(v) { this._src = String(v); },
    get alt() { return this._alt; },
    set alt(v) { this._alt = String(v); },
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
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
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
    blur() { /* no-op stub */ },
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
// Global stubs — install BEFORE dynamic import of player-dropdown.js.
// ---------------------------------------------------------------------------

class FakeHTMLElement {
  constructor() {
    const base = makeFakeElement(this.constructor.name || 'div');
    const descriptors = Object.getOwnPropertyDescriptors(base);
    Object.defineProperties(this, descriptors);
  }
}
globalThis.HTMLElement = FakeHTMLElement;

const _docListeners = new Map();
globalThis.document = {
  readyState: 'complete',
  addEventListener: (type, fn) => {
    if (!_docListeners.has(type)) _docListeners.set(type, []);
    _docListeners.get(type).push(fn);
  },
  removeEventListener: () => {},
  dispatchEvent: () => true,
  createElement: (tag) => makeFakeElement(tag),
  getElementById: () => null,
  querySelector: () => null,
  body: makeFakeElement('body'),
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

// AbortController spy — track abort() calls + signal.aborted state.
class FakeAbortController {
  constructor() {
    this.signal = { aborted: false };
    FakeAbortController._instances.push(this);
  }
  abort() {
    this.signal.aborted = true;
    FakeAbortController._abortCalls += 1;
  }
}
FakeAbortController._instances = [];
FakeAbortController._abortCalls = 0;
FakeAbortController._reset = () => {
  FakeAbortController._instances.length = 0;
  FakeAbortController._abortCalls = 0;
};
globalThis.AbortController = FakeAbortController;

// fetch spy — settable response queue per test; logs URL + signal.
const _fetchLog = {
  calls: [],   // [{url, signal, resolve, reject}]
  reset() { this.calls.length = 0; },
};
function makeFakeFetch() {
  return (url, opts = {}) => {
    let resolveFn, rejectFn;
    const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
    _fetchLog.calls.push({ url, signal: opts.signal || null, resolve: resolveFn, reject: rejectFn, promise });
    return promise;
  };
}
globalThis.fetch = makeFakeFetch();

// console spy
const _consoleSpy = { warns: [], errors: [] };
const _origWarn = console.warn;
const _origError = console.error;
console.warn = (...args) => { _consoleSpy.warns.push(args); };
console.error = (...args) => { _consoleSpy.errors.push(args); };
process.on('exit', () => { console.warn = _origWarn; console.error = _origError; });

// ---------------------------------------------------------------------------
// Live store — same module player-dropdown.js writes against.
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

// ---------------------------------------------------------------------------
// Per-test reset.
// ---------------------------------------------------------------------------

beforeEach(async () => {
  storeMod.__resetForTest();
  _fetchLog.reset();
  FakeAbortController._reset();
  _consoleSpy.warns.length = 0;
  _consoleSpy.errors.length = 0;
  _docListeners.clear();
  await import('../player-dropdown.js'); // ensure module is loaded (cached after first load)
});

afterEach(() => {
  // No subscribers to clean up — player-dropdown.js does not install module-init subscribers.
});

async function importDropdown() {
  return import('../player-dropdown.js');
}

// flushMicrotasks — needed when an in-flight fetch is being awaited.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// Sleep helper (real timer; debounce is 300ms).
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// ===========================================================================
// PlayerDropdown render + debounce + fetch flow
// ===========================================================================

describe('PlayerDropdown debounce + AbortController (DD-02)', () => {
  test('Empty input does NOT trigger fetch', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    input.value = '';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    assert.equal(_fetchLog.calls.length, 0, 'fetch never called for empty input');
  });

  test('Single-char input does NOT trigger fetch (min query length 2)', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    input.value = 'a';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    assert.equal(_fetchLog.calls.length, 0, 'fetch never called for 1-char input');
  });

  test('Input >= 2 chars triggers debounced fetch with /players/search and q=', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    assert.equal(_fetchLog.calls.length, 1, 'one fetch fired after 300ms debounce');
    const url = _fetchLog.calls[0].url;
    assert.ok(url.includes('/players/search'), `URL contains /players/search; got ${url}`);
    assert.ok(url.includes('q=ab'), `URL contains q=ab; got ${url}`);
    assert.ok(url.includes('limit=25'), `URL contains limit=25; got ${url}`);
  });

  test('Two rapid keystrokes within 300ms result in ONE fetch (debounce coalesces)', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(50);
    input.value = 'abc';
    input.dispatchEvent({ type: 'input' });
    await sleep(400);
    assert.equal(_fetchLog.calls.length, 1, 'debounce coalesced two keystrokes into one fetch');
    const url = _fetchLog.calls[0].url;
    assert.ok(url.includes('q=abc'), `latest value ("abc") used; got ${url}`);
  });

  test('Two keystrokes ~400ms apart produce TWO fetches; first fetch AbortController.abort() called before second', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    assert.equal(_fetchLog.calls.length, 1, 'first fetch fired');
    const firstSignal = _fetchLog.calls[0].signal;
    // Don't resolve the first fetch yet — second keystroke must abort it.
    input.value = 'abc';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    assert.equal(_fetchLog.calls.length, 2, 'second fetch fired');
    assert.equal(firstSignal.aborted, true, 'first fetch signal was aborted before second fetch started');
    assert.ok(FakeAbortController._abortCalls >= 1, 'AbortController.abort() was called at least once');
  });
});

describe('PlayerDropdown response rendering', () => {
  test('Successful response renders one <li> per result', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    const ul = dd.querySelector('ul');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    assert.equal(_fetchLog.calls.length, 1);
    // Resolve the fetch with 3 results.
    _fetchLog.calls[0].resolve({
      ok: true,
      json: async () => ({
        query: 'ab',
        results: [
          { address: '0xab12000000000000000000000000000000000000', ens: null, affiliateCode: 'foo', activityScore: 5000 },
          { address: '0xcd34000000000000000000000000000000000000', ens: null, affiliateCode: null, activityScore: 3000 },
          { address: '0xef56000000000000000000000000000000000000', ens: null, affiliateCode: 'bar', activityScore: 7500 },
        ],
        total: 3,
      }),
    });
    await flushMicrotasks();
    assert.equal(ul.children.length, 3, 'one <li> per result');
  });

  test('Row with affiliateCode displays affiliateCode; row without falls back to address', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    const ul = dd.querySelector('ul');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    _fetchLog.calls[0].resolve({
      ok: true,
      json: async () => ({
        results: [
          { address: '0xab12000000000000000000000000000000000000', ens: null, affiliateCode: 'foo', activityScore: 5000 },
          { address: '0xcd34cd34cd34cd34cd34cd34cd34cd34cd34cd34', ens: null, affiliateCode: null, activityScore: 3000 },
        ],
      }),
    });
    await flushMicrotasks();
    assert.equal(ul.children.length, 2);
    const row1Text = ul.children[0].textContent;
    const row2Text = ul.children[1].textContent;
    assert.ok(row1Text.includes('foo'), `row1 mentions affiliateCode; got: ${row1Text}`);
    assert.ok(row2Text.includes('0xcd34'), `row2 falls back to address; got: ${row2Text}`);
  });

  test('XSS: crafted affiliateCode rendered via textContent (literal preserved, not parsed as HTML)', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    const ul = dd.querySelector('ul');
    input.value = 'xy';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    _fetchLog.calls[0].resolve({
      ok: true,
      json: async () => ({
        results: [
          {
            address: '0xab12000000000000000000000000000000000000',
            ens: null,
            affiliateCode: '<img src=x onerror=alert(1)>',
            activityScore: 5000,
          },
        ],
      }),
    });
    await flushMicrotasks();
    assert.equal(ul.children.length, 1);
    const li = ul.children[0];
    // textContent must contain the literal angle-bracketed string (proving it was assigned via textContent).
    assert.ok(li.textContent.includes('<img'), `literal angle bracket present (textContent path); got: ${li.textContent}`);
    // No actual <img> child element must exist (proving HTML was not parsed).
    assert.equal(li.children.length, 0, 'no actual child element parsed from malicious string');
  });
});

describe('PlayerDropdown click → store update', () => {
  test('Click on <li> calls store.update(viewing.address, address.toLowerCase())', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    const ul = dd.querySelector('ul');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    _fetchLog.calls[0].resolve({
      ok: true,
      json: async () => ({
        results: [
          { address: '0xAB12000000000000000000000000000000000000', ens: null, affiliateCode: 'foo', activityScore: 5000 },
        ],
      }),
    });
    await flushMicrotasks();
    assert.equal(ul.children.length, 1);
    // Click the row.
    ul.children[0].dispatchEvent({ type: 'click' });
    // Now flush the microtask-deferred deriveMode in store.js.
    await flushMicrotasks();
    const addr = storeMod.get('viewing.address');
    assert.equal(addr, '0xab12000000000000000000000000000000000000', 'address lowercased and written to viewing.address');
  });

  test('Click on <li> clears input value and hides result list', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    const ul = dd.querySelector('ul');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    _fetchLog.calls[0].resolve({
      ok: true,
      json: async () => ({
        results: [{ address: '0xab12000000000000000000000000000000000000', ens: null, affiliateCode: 'foo', activityScore: 5000 }],
      }),
    });
    await flushMicrotasks();
    ul.children[0].dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    assert.equal(input.value, '', 'input cleared after pick');
    assert.equal(ul.hidden, true, 'result list hidden after pick');
  });
});

describe('PlayerDropdown error handling', () => {
  test('AbortError is caught silently (no console.warn/error)', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    const err = new Error('aborted');
    err.name = 'AbortError';
    _fetchLog.calls[0].reject(err);
    await flushMicrotasks();
    // No warnings/errors logged for AbortError.
    assert.equal(_consoleSpy.warns.length, 0, 'no warn on AbortError');
    assert.equal(_consoleSpy.errors.length, 0, 'no error on AbortError');
  });

  test('Non-AbortError fetch failure is logged via console.warn (does not throw)', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    const err = new Error('boom');
    _fetchLog.calls[0].reject(err);
    await flushMicrotasks();
    assert.ok(_consoleSpy.warns.length >= 1, 'warning logged for non-Abort error');
  });
});

describe('PlayerDropdown lifecycle cleanup', () => {
  test('disconnectedCallback aborts in-flight fetch and clears debounce timer', async () => {
    const mod = await importDropdown();
    const dd = new mod.PlayerDropdown();
    dd.connectedCallback();
    const input = dd.querySelector('input');
    input.value = 'ab';
    input.dispatchEvent({ type: 'input' });
    await sleep(350);
    assert.equal(_fetchLog.calls.length, 1);
    const signal = _fetchLog.calls[0].signal;
    dd.disconnectedCallback();
    assert.equal(signal.aborted, true, 'in-flight fetch aborted on disconnect');
  });
});
