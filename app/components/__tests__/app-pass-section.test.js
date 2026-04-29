// /app/components/__tests__/app-pass-section.test.js — Phase 62 Plan 62-02 (BUY-02 + BUY-03)
// Run: cd website && node --test app/components/__tests__/app-pass-section.test.js
//
// Tests <app-pass-section> Custom Element: whale row + 32-cell deity grid + per-button
// click handlers + view-mode disable hook (data-write attribute) + error rendering via
// textContent (T-58-18) + NEVER optimistic balance subtraction (CF-06 / D-05) + click
// debouncing (#busyWhale + #busySymbols Set) + CONTEXT D-05 LOCKED 'E' override on
// deity-pass path (deityPassErrorOverride applied at panel level).
//
// Mirrors app-decimator-panel.test.js fakeDOM scaffold (verbatim port).

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (verbatim port of app-decimator-panel.test.js — Phase 62 Plan 62-01).
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
    dataset: {},
    style: {},
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
      const re = /<(\w+)([^>]*?)(?:\s\/>|>)/g;
      let match;
      while ((match = re.exec(this._innerHTML)) !== null) {
        const tagName = match[1];
        if (tagName === '/' || tagName.startsWith('!')) continue;
        const attrs = match[2];
        const child = makeFakeElement(tagName);
        const dataBindMatch = /data-bind="([^"]+)"/.exec(attrs);
        if (dataBindMatch) child.attributes['data-bind'] = dataBindMatch[1];
        const dataWriteMatch = /\bdata-write\b/.test(attrs);
        if (dataWriteMatch) child.attributes['data-write'] = '';
        const nameMatch = /\bname="([^"]+)"/.exec(attrs);
        if (nameMatch) child.attributes.name = nameMatch[1];
        const idMatch = /\bid="([^"]+)"/.exec(attrs);
        if (idMatch) child.attributes.id = idMatch[1];
        const classMatch = /\bclass="([^"]+)"/.exec(attrs);
        if (classMatch) {
          for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
        }
        if (/\bhidden\b/.test(attrs)) child.hidden = true;
        if (/\bdisabled\b/.test(attrs)) child.disabled = true;
        child.parentElement = this;
        this.children.push(child);
      }
    },
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
    append(...nodes) {
      for (const n of nodes) {
        if (n && typeof n === 'object') {
          n.parentElement = this;
          this.children.push(n);
        }
      }
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      return child;
    },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
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
        try { fn({ ...ev, currentTarget: this, target: this }); } catch { /* swallow */ }
      }
      return true;
    },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k.startsWith('data-')) {
        const dsKey = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[dsKey] = String(v);
      }
    },
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

class FakeHTMLElement {
  constructor() {
    const base = makeFakeElement(this.constructor.name || 'div');
    const descriptors = Object.getOwnPropertyDescriptors(base);
    Object.defineProperties(this, descriptors);
  }
}
globalThis.HTMLElement = FakeHTMLElement;
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.bubbles = !!init.bubbles;
  }
};

let _docBody = makeFakeElement('body');
const _docListeners = new Map();

globalThis.document = {
  createElement: (tag) => makeFakeElement(tag),
  querySelector: (sel) => _docBody.querySelector(sel),
  querySelectorAll: (sel) => _docBody.querySelectorAll(sel),
  body: _docBody,
  addEventListener: (type, fn) => {
    if (!_docListeners.has(type)) _docListeners.set(type, []);
    _docListeners.get(type).push(fn);
  },
  removeEventListener: () => {},
  dispatchEvent: () => true,
  visibilityState: 'visible',
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

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

let _fetchHandler = async () => ({ player: null, pending: {} });
globalThis.fetch = async (url) => {
  const data = await _fetchHandler(url);
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
};

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.localStorage.clear();
  _docListeners.clear();
  _fetchHandler = async () => ({ player: null, pending: {} });
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function settle(loops = 30) {
  for (let i = 0; i < loops; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < loops; i += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';
import * as passesMod from '../../app/passes.js';
import * as contractsMod from '../../app/contracts.js';

const PANEL_SRC = readFileSync(
  new URL('../app-pass-section.js', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// Fake contract harness
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) { return { status: 1, hash: '0xreceipt', logs: logs || [] }; }
function makeFakeTx(receipt) { return { hash: '0xtx', wait: async () => receipt }; }

function makeFakePassContract(opts = {}) {
  const calls = { purchaseWhaleBundle: [], purchaseDeityPass: [] };
  const stk = (name) => async () => {
    if (opts.staticCallShouldRevert?.[name]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[name] || 'E' };
      throw err;
    }
  };
  return {
    purchaseWhaleBundle: Object.assign(
      async (...args) => {
        calls.purchaseWhaleBundle.push(args);
        return makeFakeTx(makeFakeReceipt());
      },
      { staticCall: stk('purchaseWhaleBundle') }
    ),
    purchaseDeityPass: Object.assign(
      async (...args) => {
        calls.purchaseDeityPass.push(args);
        return makeFakeTx(makeFakeReceipt());
      },
      { staticCall: stk('purchaseDeityPass') }
    ),
    interface: { parseLog: () => null },
    connect(_signer) { return this; },
    _calls: calls,
  };
}

function makeFakeProvider(addr) {
  return {
    getNetwork: async () => ({ chainId: 11155111n }),
    getSigner: async () => ({ getAddress: async () => addr }),
  };
}

const CONNECTED = '0xab12000000000000000000000000000000000000';

function instantiate() {
  const Ctor = customElements.get('app-pass-section');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan 62-02: <app-pass-section> Custom Element', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    passesMod.__setContractFactoryForTest(() => makeFakePassContract());
    await import('../app-pass-section.js');
  });

  test("Custom element 'app-pass-section' registers idempotently", async () => {
    const ctor = customElements.get('app-pass-section');
    assert.ok(ctor, 'app-pass-section is registered');
    await assert.doesNotReject(import('../app-pass-section.js'));
    const ctor2 = customElements.get('app-pass-section');
    assert.equal(ctor, ctor2, 'same ctor reference after re-import (idempotent)');
  });

  test('Panel renders shell with whale row + deity grid (32 symbol cells)', () => {
    const el = instantiate();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    // Whale buy CTA exists
    const whaleBuyBtn = el.querySelector('.pass-whale-buy');
    assert.ok(whaleBuyBtn, 'whale buy CTA rendered');
    // Deity grid contains 32 symbol cells
    const deityCells = el.querySelectorAll('.pass-deity-symbol');
    assert.equal(deityCells.length, 32, '32 deity-symbol cells rendered');
  });

  test('Action buttons carry data-write attribute', () => {
    const el = instantiate();
    const whaleBuy = el.querySelector('.pass-whale-buy');
    assert.ok(whaleBuy && whaleBuy.attributes['data-write'] !== undefined,
      'whale buy CTA has data-write');
    const cells = el.querySelectorAll('.pass-deity-symbol');
    assert.ok(cells.length > 0);
    for (const c of cells) {
      assert.ok(c.attributes['data-write'] !== undefined,
        `deity cell has data-write (sid=${c.attributes['data-symbol-id']})`);
    }
  });

  test('Whale buy click invokes purchaseWhaleBundle with quantity from input', async () => {
    let recordedArgs = null;
    const originalWhale = passesMod.purchaseWhaleBundle;
    // Replace at module level using the contract factory seam — capture args
    // via a stub that mirrors purchaseWhaleBundle's signature.
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhaleBundle: Object.assign(
        async (...args) => {
          recordedArgs = args;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const qtyInput = el.querySelector('[name="pass-whale-qty"]');
    assert.ok(qtyInput, 'quantity input rendered');
    qtyInput.value = '3';

    const btn = el.querySelector('.pass-whale-buy');
    btn.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.ok(recordedArgs, 'purchaseWhaleBundle invoked through contract');
    // args = [buyer, quantity, overrides]
    assert.equal(recordedArgs[0], CONNECTED, 'buyer = connected.address');
    assert.equal(recordedArgs[1], 3n, 'quantity = BigInt(3)');

    el.disconnectedCallback();
  });

  test('Deity symbol click invokes purchaseDeityPass with symbolId', async () => {
    let recordedArgs = null;
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhaleBundle: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async (...args) => {
          recordedArgs = args;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const cells = el.querySelectorAll('.pass-deity-symbol');
    // Find cell with data-symbol-id=7
    let target = null;
    for (const c of cells) {
      if (c.attributes['data-symbol-id'] === '7') { target = c; break; }
    }
    assert.ok(target, 'symbol-id=7 cell present');
    target.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.ok(recordedArgs, 'purchaseDeityPass invoked');
    assert.equal(recordedArgs[0], CONNECTED, 'buyer = connected.address');
    assert.equal(recordedArgs[1], 7, 'symbolId = 7');

    el.disconnectedCallback();
  });

  test("Deity 'E' revert renders 'That symbol's taken — try another.' (CONTEXT D-05 LOCKED)", async () => {
    // Stub purchaseDeityPass to throw a structured 'E' error
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhaleBundle: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async () => {
          const err = new Error('decoded revert');
          err.code = 'E';
          err.userMessage = 'An unexpected error occurred. Please try again.';
          err.recoveryAction = 'Retry; if it persists, refresh the page.';
          throw err;
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const cells = el.querySelectorAll('.pass-deity-symbol');
    let target = null;
    for (const c of cells) {
      if (c.attributes['data-symbol-id'] === '7') { target = c; break; }
    }
    target.dispatchEvent({ type: 'click' });
    await settle(60);

    const errEl = el.querySelector('.pass-deity-error');
    assert.ok(errEl, '.pass-deity-error element present');
    assert.equal(
      errEl.textContent,
      "That symbol's taken — try another.",
      "deity 'E' revert surfaces CONTEXT D-05 LOCKED override copy via textContent",
    );

    el.disconnectedCallback();
  });

  test("Deity 'NotApproved' revert surfaces standard reason-map text (NOT the override)", async () => {
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhaleBundle: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async () => {
          const err = new Error('decoded revert');
          err.code = 'NotApproved';
          err.userMessage = 'Operator not approved.';
          err.recoveryAction = 'Connect to your own wallet to act.';
          throw err;
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const cells = el.querySelectorAll('.pass-deity-symbol');
    let target = null;
    for (const c of cells) {
      if (c.attributes['data-symbol-id'] === '3') { target = c; break; }
    }
    target.dispatchEvent({ type: 'click' });
    await settle(60);

    const errEl = el.querySelector('.pass-deity-error');
    assert.ok(errEl, '.pass-deity-error element present');
    assert.equal(
      errEl.textContent,
      'Operator not approved.',
      "non-'E' reverts surface standard reason-map decoded text",
    );
    assert.notEqual(
      errEl.textContent,
      "That symbol's taken — try another.",
      "non-'E' code must NOT trigger the deity override",
    );

    el.disconnectedCallback();
  });

  test('Deity click handler debounced — double-click invokes purchaseDeityPass exactly once', async () => {
    let callCount = 0;
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhaleBundle: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async () => {
          callCount += 1;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const cells = el.querySelectorAll('.pass-deity-symbol');
    let target = null;
    for (const c of cells) {
      if (c.attributes['data-symbol-id'] === '7') { target = c; break; }
    }
    // Two rapid clicks
    target.dispatchEvent({ type: 'click' });
    target.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(callCount, 1, 'double-click invokes purchaseDeityPass exactly once');

    el.disconnectedCallback();
  });

  test('NEVER optimistic balance subtraction (CF-06 / D-05): source contains no `amount = amount -` patterns', () => {
    assert.doesNotMatch(
      PANEL_SRC,
      /amount\s*=\s*amount\s*-/,
      'panel source contains no optimistic balance subtraction patterns',
    );
  });

  test('Error rendering uses textContent (T-58-18): source assigns .textContent', () => {
    assert.match(
      PANEL_SRC,
      /\.textContent\s*=/,
      'panel source assigns .textContent (T-58-18 hardening)',
    );
  });

  test('Panel source contains 10s + 250ms timing literals (CF-06 + D-05 mirror)', () => {
    assert.match(
      PANEL_SRC,
      /\b10[_]?000\b/,
      'panel source contains 10000 (or 10_000) literal for 10s error auto-clear',
    );
    assert.match(
      PANEL_SRC,
      /\b250\b/,
      'panel source contains 250 literal for post-confirm refetch debounce',
    );
  });

  test('Panel imports deityPassErrorOverride from passes.js', () => {
    assert.match(
      PANEL_SRC,
      /import\s*\{[^}]*deityPassErrorOverride[^}]*\}\s*from\s*['"]\.\.\/app\/passes\.js['"]/,
      'panel imports deityPassErrorOverride from passes.js',
    );
  });

  test('Panel invokes deityPassErrorOverride in deity catch path', () => {
    assert.match(
      PANEL_SRC,
      /deityPassErrorOverride\s*\(/,
      'panel invokes deityPassErrorOverride() helper',
    );
  });

  test('disconnectedCallback flushes #unsubs[] without throwing (idempotent)', () => {
    const el = instantiate();
    assert.doesNotThrow(() => el.disconnectedCallback());
    assert.doesNotThrow(() => el.disconnectedCallback());
  });
});
