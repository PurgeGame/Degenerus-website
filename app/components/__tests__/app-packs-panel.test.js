// /app/components/__tests__/app-packs-panel.test.js — Phase 60 Plan 60-01 (LBX-01)
// Run: cd website && node --test app/components/__tests__/app-packs-panel.test.js
//
// Tests Custom Element registration + scaffold render + pay-kind toggle + quantity
// picker behavior. Plan 60-02 will extend with sendTx + receipt-log parsing tests.
// Plan 60-03 will extend with RNG poll + Open CTA + reveal animation tests.
// Plan 60-04 will extend with localStorage idempotency + boot CTA tests.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fake DOM (verbatim port of last-day-jackpot.test.js fake-DOM scaffolding)
// + globalThis.localStorage shim (forward-compat with Plan 60-04 idempotency tests).
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
        const idMatch = /\bid="([^"]+)"/.exec(attrs);
        if (idMatch) child.attributes.id = idMatch[1];
        const classMatch = /\bclass="([^"]+)"/.exec(attrs);
        if (classMatch) {
          for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
        }
        const styleMatch = /\bstyle="([^"]+)"/.exec(attrs);
        if (styleMatch) {
          for (const decl of styleMatch[1].split(';')) {
            const [k, v] = decl.split(':').map(s => s && s.trim());
            if (k && v) child.style[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
          }
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
        try { fn(ev); } catch { /* swallow */ }
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

// ---------------------------------------------------------------------------
// Fake document + globalThis stubs — installed BEFORE dynamic import of the
// component (which needs HTMLElement at module-load time for class extends).
// ---------------------------------------------------------------------------

class FakeHTMLElement {
  constructor() {
    const base = makeFakeElement(this.constructor.name || 'div');
    const descriptors = Object.getOwnPropertyDescriptors(base);
    Object.defineProperties(this, descriptors);
  }
}
globalThis.HTMLElement = FakeHTMLElement;

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

// localStorage shim — forward-compat with Plan 60-04 idempotency tests.
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

// Plan 60-01 widget does NOT call fetch (no write logic, no subscriptions).
// Stub for safety. Plan 60-02/03/04 may add real fetch flows.
globalThis.fetch = async () => { throw new Error('fetch should not be called in Plan 60-01 tests'); };

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.localStorage.clear();
  _docListeners.clear();
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Imports under test — store.js is safe to static-import (no HTMLElement use).
// app-packs-panel.js is dynamic-imported inside beforeEach so the FakeHTMLElement
// stub is installed BEFORE the class declaration runs (ESM static imports hoist
// above the `globalThis.HTMLElement = ...` assignment above). Established Phase 58/59
// pattern (player-dropdown.test.js:282, view-mode-banner.test.js:273,
// last-day-jackpot.test.js:284).
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function instantiate() {
  const Ctor = customElements.get('app-packs-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

function clickByDataBind(el, hook) {
  const target = el.querySelector(`[data-bind="${hook}"]`);
  assert.ok(target, `[data-bind="${hook}"] exists`);
  target.dispatchEvent({ type: 'click' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan 60-01: <app-packs-panel> Custom Element shell', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    // Dynamic-import (cached after first call) — registers the Custom Element
    // via module-bottom idempotency-guarded customElements.define.
    await import('../app-packs-panel.js');
  });

  test("Custom Element 'app-packs-panel' is registered after import", () => {
    const ctor = customElements.get('app-packs-panel');
    assert.ok(ctor, 'app-packs-panel is registered');
    assert.equal(ctor.name, 'AppPacksPanel');
  });

  test('Class instantiation does not throw', () => {
    const Ctor = customElements.get('app-packs-panel');
    assert.doesNotThrow(() => new Ctor());
  });

  test('connectedCallback renders innerHTML scaffold without throwing', async () => {
    const Ctor = customElements.get('app-packs-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    assert.doesNotThrow(() => el.connectedCallback());
    await flushMicrotasks();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
  });

  test('innerHTML scaffold contains all 8 required data-bind hooks', () => {
    const el = instantiate();
    const required = [
      'lbx-pay-eth',
      'lbx-pay-burnie',
      'lbx-tickets-display',
      'lbx-lootboxes-display',
      'lbx-buy-button',
      'lbx-rows',
      'lbx-boot-cta',
      'lbx-error-banner',
    ];
    for (const hook of required) {
      assert.ok(
        el.querySelector(`[data-bind="${hook}"]`),
        `data-bind="${hook}" present`,
      );
    }
  });

  test('Default state: payKind=ETH (active), tickets="0", lootboxes="1"', () => {
    const el = instantiate();
    assert.equal(el._state.payKind, 'ETH', 'payKind default ETH');
    assert.equal(el._state.ticketQuantity, 0, 'tickets default 0');
    assert.equal(el._state.lootboxQuantity, 1, 'lootboxes default 1');
    const ethBtn = el.querySelector('[data-bind="lbx-pay-eth"]');
    const burnieBtn = el.querySelector('[data-bind="lbx-pay-burnie"]');
    assert.ok(ethBtn.classList.contains('lbx-pay-toggle__btn--active'), 'ETH btn has active class');
    assert.ok(!burnieBtn.classList.contains('lbx-pay-toggle__btn--active'), 'BURNIE btn does NOT have active class');
    const tDisp = el.querySelector('[data-bind="lbx-tickets-display"]');
    const lDisp = el.querySelector('[data-bind="lbx-lootboxes-display"]');
    assert.equal(tDisp.textContent, '0');
    assert.equal(lDisp.textContent, '1');
  });

  test('Pay-kind toggle: clicking BURNIE updates active class + state', () => {
    const el = instantiate();
    clickByDataBind(el, 'lbx-pay-burnie');
    assert.equal(el._state.payKind, 'BURNIE', 'state.payKind switched to BURNIE');
    const ethBtn = el.querySelector('[data-bind="lbx-pay-eth"]');
    const burnieBtn = el.querySelector('[data-bind="lbx-pay-burnie"]');
    assert.ok(!ethBtn.classList.contains('lbx-pay-toggle__btn--active'));
    assert.ok(burnieBtn.classList.contains('lbx-pay-toggle__btn--active'));

    // And clicking ETH again flips it back
    clickByDataBind(el, 'lbx-pay-eth');
    assert.equal(el._state.payKind, 'ETH', 'state.payKind switched back to ETH');
    assert.ok(ethBtn.classList.contains('lbx-pay-toggle__btn--active'));
    assert.ok(!burnieBtn.classList.contains('lbx-pay-toggle__btn--active'));
  });

  test('Quantity picker (tickets) +/- increments and clamps to [0, 100]', () => {
    const el = instantiate();
    // Plus from 0 -> 1
    clickByDataBind(el, 'lbx-tickets-plus');
    assert.equal(el._state.ticketQuantity, 1);
    assert.equal(el.querySelector('[data-bind="lbx-tickets-display"]').textContent, '1');
    // Minus from 1 -> 0
    clickByDataBind(el, 'lbx-tickets-minus');
    assert.equal(el._state.ticketQuantity, 0);
    // Minus from 0 -> still 0 (clamped)
    clickByDataBind(el, 'lbx-tickets-minus');
    assert.equal(el._state.ticketQuantity, 0, 'clamped at 0');
  });

  test('Quantity picker (tickets) max clamp at 100', () => {
    const el = instantiate();
    // Click + 105 times — should clamp at 100
    for (let i = 0; i < 105; i++) {
      clickByDataBind(el, 'lbx-tickets-plus');
    }
    assert.equal(el._state.ticketQuantity, 100, 'clamped at 100');
    assert.equal(el.querySelector('[data-bind="lbx-tickets-display"]').textContent, '100');
  });

  test('Quantity picker (lootboxes): minus from 1 -> 0 also disables Buy button (tickets also 0)', () => {
    const el = instantiate();
    // Default lootboxes=1 -> Buy enabled
    let buyBtn = el.querySelector('[data-bind="lbx-buy-button"]');
    assert.equal(buyBtn.disabled, false, 'Buy enabled by default (lootboxes=1)');
    // Minus from 1 -> 0
    clickByDataBind(el, 'lbx-lootboxes-minus');
    assert.equal(el._state.lootboxQuantity, 0);
    buyBtn = el.querySelector('[data-bind="lbx-buy-button"]');
    assert.equal(buyBtn.disabled, true, 'Buy disabled when both quantities 0');
  });

  test('Quantity picker (lootboxes): max clamp at 10', () => {
    const el = instantiate();
    // Click + 12 times — should clamp at 10
    for (let i = 0; i < 12; i++) {
      clickByDataBind(el, 'lbx-lootboxes-plus');
    }
    assert.equal(el._state.lootboxQuantity, 10, 'clamped at 10');
    assert.equal(el.querySelector('[data-bind="lbx-lootboxes-display"]').textContent, '10');
  });

  test('Buy button starts enabled with default state (lootboxes=1)', () => {
    const el = instantiate();
    const buyBtn = el.querySelector('[data-bind="lbx-buy-button"]');
    assert.equal(buyBtn.disabled, false, 'Buy enabled by default');
  });

  test('disconnectedCallback flushes #unsubs without throwing', () => {
    const el = instantiate();
    assert.doesNotThrow(() => el.disconnectedCallback());
  });
});
