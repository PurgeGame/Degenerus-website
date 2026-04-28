// /app/components/__tests__/last-day-jackpot.test.js — Phase 59 Plan 59-01 (JKP-03)
// Run: cd website && node --test app/components/__tests__/last-day-jackpot.test.js
//
// Tests Custom Element registration + 3-status branch render scaffolding.
// Plan 59-02 extends with subscribe-driven render tests.
// Plan 59-03 extends with localStorage idempotency + banner + highlight tests.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fake DOM (mirrors view-mode-banner.test.js fake-DOM scaffolding)
// + globalThis.localStorage shim (forward-compat with Plan 59-03 idempotency tests).
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
      // Crude parse: extract elements with id, data-bind, class, and style attrs
      // so querySelector can find them. Elements are flat children (no nesting tree
      // — but querySelector walks the flat list, which is sufficient for the
      // Plan 59-01 tests since each data-bind hook is unique).
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

// localStorage shim — forward-compat with Plan 59-03 idempotency tests.
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

// Plan 59-01 widget does NOT call fetch (factory's runRoll1 is unreachable while
// #pinnedDay is null; button stays disabled). Stub for safety.
globalThis.fetch = async () => { throw new Error('fetch should not be called in Plan 59-01 tests'); };

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
// last-day-jackpot.js is dynamic-imported inside beforeEach so the FakeHTMLElement
// stub is installed BEFORE the class declaration runs (ESM static imports hoist
// above the `globalThis.HTMLElement = ...` assignment above).
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Plan 59-01: <last-day-jackpot> Custom Element shell", () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    // Dynamic-import (cached after first call) — registers the Custom Element
    // via module-bottom idempotency-guarded customElements.define.
    await import('../last-day-jackpot.js');
  });

  test("Custom Element 'last-day-jackpot' is registered after import", () => {
    const ctor = customElements.get('last-day-jackpot');
    assert.ok(ctor, 'last-day-jackpot is registered');
    assert.equal(ctor.name, 'LastDayJackpot');
  });

  test('Class instantiation does not throw', () => {
    const Ctor = customElements.get('last-day-jackpot');
    assert.doesNotThrow(() => new Ctor());
  });

  test('connectedCallback renders innerHTML scaffold without throwing', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    assert.doesNotThrow(() => el.connectedCallback());
    await flushMicrotasks();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
  });

  test('innerHTML scaffold contains all required data-bind hooks', () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    const required = [
      'ldj-status-cold-start',
      'ldj-status-empty-day',
      'ldj-status-resolved',
      'ldj-new-day-banner',
      'jp-replay-section',
      'jp-roll1-result',
      'jp-roll2-result',
      'jp-winners-group-baf',
      'jp-winners-group-decimator',
      'day',
    ];
    for (const hook of required) {
      assert.ok(
        el.querySelector(`[data-bind="${hook}"]`),
        `data-bind="${hook}" present`,
      );
    }
    assert.ok(el.querySelector('#jp-replay-btn'), '#jp-replay-btn present');
  });

  test('Cold-start section visible by default after connectedCallback (Plan 59-01 default state)', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    assert.ok(cold, 'cold-start section exists');
    // Plan 59-01: cold-start visible (style.display !== 'none'); empty-day + resolved hidden.
    // Plan 59-02 wires data flow that may flip this on payload arrival.
    assert.notEqual(
      cold.style.display, 'none',
      'cold-start visible by default (no display:none on the wrapper)',
    );
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    assert.ok(empty, 'empty-day section exists');
    assert.equal(
      empty.style.display, 'none',
      'empty-day hidden by default',
    );
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.ok(resolved, 'resolved section exists');
    assert.equal(
      resolved.style.display, 'none',
      'resolved hidden by default',
    );
  });

  test('disconnectedCallback flushes #unsubs without throwing', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    await flushMicrotasks();
    assert.doesNotThrow(() => el.disconnectedCallback());
  });
});

// ===========================================================================
// Plan 59-02: app.lastDay subscriber + status branch dispatch + pin-dayId
// ===========================================================================

describe('Plan 59-02: app.lastDay subscriber + status branch dispatch', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function instantiate() {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  test('status:pre-game payload → cold-start visible, empty-day + resolved hidden', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', { day: null, status: 'pre-game' });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.ok(cold, 'cold-start section exists');
    assert.notEqual(cold.style.display, 'none', 'cold-start visible');
    assert.equal(empty.style.display, 'none', 'empty-day hidden');
    assert.equal(resolved.style.display, 'none', 'resolved hidden');
  });

  test('status:resolved-no-winners payload → empty-day visible with day-N copy + day label updated', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', {
      day: 5, level: 2, summary: null, winners: [],
      roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.equal(cold.style.display, 'none', 'cold-start hidden');
    assert.notEqual(empty.style.display, 'none', 'empty-day visible');
    assert.equal(resolved.style.display, 'none', 'resolved hidden');
    const copy = el.querySelector('[data-bind="ldj-empty-copy"]');
    assert.match(copy.textContent, /Day 5 had no winners/, 'day-5 copy present');
    assert.match(copy.textContent, /day 6/, 'rolled-to-day-6 copy present');
    const dayLbl = el.querySelector('[data-bind="day"]');
    assert.match(dayLbl.textContent, /Day 5/);
  });

  test('status:resolved payload → resolved section visible + day label set + winners cached', async () => {
    const el = instantiate();
    const winner = {
      address: '0xab12000000000000000000000000000000000000',
      totalEth: '1000000000000000000',  // 1 ETH
      ticketCount: 100,
      coinTotal: '0',
      bafPrize: { eth: '0', tickets: 0 },
      decimatorPrize: { regularEth: '0', lootboxEth: '0', terminalEth: '0' },
    };
    storeMod.update('app.lastDay', {
      day: 7, level: 2, summary: null, winners: [winner],
      roll1: { day: 7, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 7, level: 2, purchaseLevel: null, wins: [], bonusTraitsPacked: null },
      status: 'resolved',
    });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.equal(cold.style.display, 'none', 'cold-start hidden');
    assert.equal(empty.style.display, 'none', 'empty-day hidden');
    assert.notEqual(resolved.style.display, 'none', 'resolved visible');
    const dayLbl = el.querySelector('[data-bind="day"]');
    assert.match(dayLbl.textContent, /Day 7/);
  });

  test('Pin-dayId: first payload pins day; same-day refresh re-renders; newer-day sets flag without rerender', async () => {
    const el = instantiate();
    // First payload: pin to day 5 empty-day
    storeMod.update('app.lastDay', {
      day: 5, level: 2, summary: null, winners: [],
      roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 5/, 'first payload pins day 5');

    // Second payload: same day → re-render in place (still day 5)
    storeMod.update('app.lastDay', {
      day: 5, level: 2, summary: null, winners: [],
      roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 5/, 'same-day refresh keeps day 5');

    // Third payload: newer day 6 → should NOT re-render body (banner is Plan 59-03)
    storeMod.update('app.lastDay', {
      day: 6, level: 2, summary: null, winners: [],
      roll1: { day: 6, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 6, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    // Body should still show day 5 (pin-dayId locked, banner DOM is Plan 59-03)
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 5/, 'body still day 5 after newer-day arrival');
  });

  test('null/undefined payload does not throw + leaves Plan 59-01 default scaffold visible', async () => {
    const el = instantiate();
    assert.doesNotThrow(() => storeMod.update('app.lastDay', null));
    await flushMicrotasks();
    assert.doesNotThrow(() => storeMod.update('app.lastDay', undefined));
    await flushMicrotasks();
    // Cold-start (Plan 59-01 default scaffold) still visible since #onLastDayUpdate early-returned.
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    assert.notEqual(cold.style.display, 'none', 'cold-start still visible after null payloads');
  });

  test('Defensive: status:resolved with null summary + undefined bonusTraitsPacked does not throw', async () => {
    // Pitfalls D + E + bonusTraitsPacked-missing: composed blob may have null summary
    // and roll2 without bonusTraitsPacked field (verified game.ts:2030-2229 — day-keyed
    // roll2 handler does NOT include bonusTraitsPacked; only the per-player handler does
    // per game.ts:881). Widget must tolerate gracefully.
    const el = instantiate();
    assert.doesNotThrow(() => {
      storeMod.update('app.lastDay', {
        day: 9, level: 2, summary: null, winners: [],
        roll1: { day: 9, level: 2, purchaseLevel: null, wins: [] },
        roll2: { day: 9, level: 2, purchaseLevel: null, wins: [] },  // no bonusTraitsPacked
        status: 'resolved',
      });
    });
    await flushMicrotasks();
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.notEqual(resolved.style.display, 'none', 'resolved visible with null summary');
  });
});
