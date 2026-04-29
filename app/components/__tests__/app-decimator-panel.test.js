// /app/components/__tests__/app-decimator-panel.test.js — Phase 62 Plan 62-01 (BUY-01)
// Run: cd website && node --test app/components/__tests__/app-decimator-panel.test.js
//
// Tests Custom Element shell + buy CTA wired to decimator.js helpers + view-mode
// disable hook (data-write attribute) + error rendering via textContent (T-58-18) +
// NEVER optimistic balance subtraction (CF-06 / D-05) + click debouncing (#busy).
//
// CONTEXT D-01..D-08 LOCKED + RESEARCH Example 1 (BUY-01 = purchase() call) +
// Pattern 1 (Custom Element shell). Mirrors app-packs-panel.test.js fakeDOM scaffold.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (verbatim port of app-packs-panel.test.js — Phase 60).
// Element / matches() helpers + globalThis customElements/document/window.
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

// fetch stub — panel-owned poll cycle reads /player/:address. Tests stub
// per-case via _fetchHandler; default returns empty pending object.
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
// Imports under test — store + decimator (re-export module from Plan 62-01)
// + lootbox (decimator's source-of-truth — provides shared __setContractFactoryForTest).
// app-decimator-panel.js is dynamic-imported inside beforeEach so FakeHTMLElement
// is installed BEFORE the class declaration runs.
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';
import * as decimatorMod from '../../app/decimator.js';
import * as lootboxMod from '../../app/lootbox.js';
import * as contractsMod from '../../app/contracts.js';

// ---------------------------------------------------------------------------
// Read panel source for grep-based assertions (data-write attribute, textContent
// for error rendering, no optimistic subtraction, post-confirm 250ms refetch).
// ---------------------------------------------------------------------------

const PANEL_SRC = readFileSync(
  new URL('../app-decimator-panel.js', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// Fake contract harness (verbatim shape from app-packs-panel.test.js Plan 60-02).
// Drives purchaseEth/purchaseCoin via lootbox.__setContractFactoryForTest.
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) { return { status: 1, hash: '0xreceipt', logs: logs || [] }; }
function makeFakeTx(receipt) { return { hash: '0xtx', wait: async () => receipt }; }

function makeFakePurchaseContract(opts = {}) {
  const calls = { purchase: [], purchaseCoin: [] };
  const stk = (name) => async () => {
    if (opts.staticCallShouldRevert?.[name]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[name] || 'GameOverPossible' };
      throw err;
    }
  };
  let txCounter = 0n;
  return {
    purchase: Object.assign(
      async (...args) => {
        calls.purchase.push(args);
        txCounter += 1n;
        return makeFakeTx(makeFakeReceipt([
          { parsed: { name: 'LootBoxIdx', args: { index: txCounter, day: 1n, buyer: args[0] } } },
        ]));
      },
      { staticCall: stk('purchase') }
    ),
    purchaseCoin: Object.assign(
      async (...args) => {
        calls.purchaseCoin.push(args);
        txCounter += 1n;
        return makeFakeTx(makeFakeReceipt([
          { parsed: { name: 'BurnieLootBuy', args: { index: txCounter, burnieAmount: 1000n * 10n ** 18n, buyer: args[0] } } },
        ]));
      },
      { staticCall: stk('purchaseCoin') }
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
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
  const Ctor = customElements.get('app-decimator-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan 62-01: <app-decimator-panel> Custom Element shell', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lootboxMod.__setContractFactoryForTest(() => makeFakePurchaseContract());
    await import('../app-decimator-panel.js');
  });

  test("Custom element 'app-decimator-panel' registers idempotently after import", async () => {
    const ctor = customElements.get('app-decimator-panel');
    assert.ok(ctor, 'app-decimator-panel is registered');
    // Re-import does NOT throw (idempotent guard).
    await assert.doesNotReject(import('../app-decimator-panel.js'));
    const ctor2 = customElements.get('app-decimator-panel');
    assert.equal(ctor, ctor2, 'same ctor reference after re-import (idempotent)');
  });

  test('Panel renders shell with static innerHTML — no server data, header copy "DECIMATOR"', () => {
    const el = instantiate();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    // Static header copy — planner discretion: "DECIMATOR" per CONTEXT (no server data).
    assert.match(
      el.innerHTML.toUpperCase(),
      /DECIMATOR/,
      'header copy contains DECIMATOR (static template literal)',
    );
    // No server-derived strings (userMessage / address / amount) bled into innerHTML
    // at mount time. Phase 58 T-58-18 hardening — server data flows via textContent.
    assert.ok(
      !/error\.userMessage|0xab12|userMessage:/i.test(el.innerHTML),
      'no server-derived strings in mount-time innerHTML',
    );
  });

  test('Buy button has data-write attribute (Phase 58 view-mode disable hook)', () => {
    const el = instantiate();
    const btn = el.querySelector('[data-write]');
    assert.ok(btn, '[data-write] CTA button rendered');
    // Source-level assertion — panel literally contains data-write attribute.
    assert.match(
      PANEL_SRC,
      /data-write/,
      'panel source contains literal data-write attribute',
    );
  });

  test('Click handler invokes decimator.purchaseEth (closure form) with ticketQuantity > 0 + lootboxQuantity = 0', async () => {
    // Stub decimator.purchaseEth via lootbox factory injection (decimator
    // re-exports purchaseEth from lootbox.js — same function reference per
    // decimator.test.js Test 1).
    let callArgs = null;
    let callCount = 0;
    const realPurchaseEth = lootboxMod.purchaseEth;
    // Monkey-patch via factory: any call to purchaseEth resolves through the
    // real Phase 60 path with our fake contract; we observe via fakeContract._calls.
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();

    // Set ticket quantity to 5 via input.
    const input = el.querySelector('[name="dec-tickets"]');
    assert.ok(input, 'ticket-quantity input rendered');
    input.value = '5';

    // Click Buy.
    const btn = el.querySelector('[data-write]');
    btn.dispatchEvent({ type: 'click' });
    await settle(60);

    // purchase() called once with ticketQuantity > 0 + lootBoxAmountWei = 0
    // (lootboxQuantity = 0 means BURNIE-side default to 0). Verified via
    // fakeContract._calls.purchase[0] — ticketQuantity*100 (Phase 60 scaling).
    assert.equal(fakeContract._calls.purchase.length, 1, 'purchase called exactly once');
    const args = fakeContract._calls.purchase[0];
    // args = [buyer, ticketQuantity*100n, lootBoxAmountWei, affiliateCode, payKind]
    assert.equal(args[0], CONNECTED, 'buyer = connected address');
    assert.equal(args[1], 500n, 'ticketQuantity * 100 = 5 * 100 = 500');
    // CONTEXT: lootboxQuantity = 0 for level-mint-only buys.
    assert.equal(args[2], 0n, 'lootBoxAmountWei = 0n (tickets-only level mint)');

    el.disconnectedCallback();
  });

  test('Click handler debounced (#busy guard) — double-click invokes purchaseEth exactly once', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '3';

    const btn = el.querySelector('[data-write]');
    // Two rapid clicks — second is rejected by #busy guard.
    btn.dispatchEvent({ type: 'click' });
    btn.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(
      fakeContract._calls.purchase.length,
      1,
      'double-click invokes purchase exactly once (#busy debounce)',
    );
    el.disconnectedCallback();
  });

  test('NEVER optimistic balance subtraction (CF-06 / D-05): pre-click balance text unchanged during pending', async () => {
    // Stub purchaseEth to return a never-resolving promise (simulates pending tx).
    let resolver;
    const blockedTx = new Promise((r) => { resolver = r; });
    lootboxMod.__setContractFactoryForTest(() => ({
      purchase: Object.assign(
        async (..._args) => blockedTx,
        { staticCall: async () => undefined },
      ),
      purchaseCoin: Object.assign(
        async (..._args) => blockedTx,
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '2';

    // Capture pre-click balance display textContent.
    const balanceEl = el.querySelector('.dec-balance');
    const preClickText = balanceEl ? balanceEl.textContent : '';

    el.querySelector('[data-write]').dispatchEvent({ type: 'click' });
    // Allow micro-tasks to flush but NOT the blocked tx.
    await flushMicrotasks();

    const balanceElAfter = el.querySelector('.dec-balance');
    const duringPendingText = balanceElAfter ? balanceElAfter.textContent : '';
    assert.equal(
      duringPendingText,
      preClickText,
      'NEVER optimistic balance subtraction during pending — textContent unchanged',
    );

    // Source-level assertion: panel does NOT contain `amount = amount -` style code.
    assert.doesNotMatch(
      PANEL_SRC,
      /amount\s*=\s*amount\s*-/,
      'panel source contains no optimistic balance subtraction patterns',
    );

    // Resolve to clean up pending promise.
    if (resolver) resolver({ wait: async () => makeFakeReceipt([]) });
    el.disconnectedCallback();
  });

  test('Error rendering uses textContent (T-58-18): error.userMessage flows via .textContent NOT innerHTML', async () => {
    // Force purchase to throw a structured error with userMessage.
    lootboxMod.__setContractFactoryForTest(() => ({
      purchase: Object.assign(
        async (..._args) => {
          const err = new Error('decoded revert');
          err.userMessage = 'Game over imminent';
          err.code = 'GameOverPossible';
          throw err;
        },
        { staticCall: async () => undefined },
      ),
      purchaseCoin: Object.assign(
        async (..._args) => { throw new Error('not used'); },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '1';
    el.querySelector('[data-write]').dispatchEvent({ type: 'click' });
    await settle(60);

    const errEl = el.querySelector('.dec-error');
    assert.ok(errEl, '.dec-error element rendered');
    assert.equal(
      errEl.textContent,
      'Game over imminent',
      'error.userMessage rendered via .textContent',
    );

    // Source-level assertion: panel uses .textContent for error rendering.
    assert.match(
      PANEL_SRC,
      /\.textContent\s*=/,
      'panel source assigns .textContent (T-58-18 hardening)',
    );

    el.disconnectedCallback();
  });

  test('Error auto-clears after 10s (mirrors Phase 61 pattern); panel source contains 10000 + 250 timing literals', () => {
    // Source-level assertion: panel uses 10s (10000 OR 10_000) for error auto-clear.
    // Constant or literal-numeric form both accepted.
    assert.match(
      PANEL_SRC,
      /\b10[_]?000\b/,
      'panel source contains 10000 (or 10_000) literal for 10s error auto-clear',
    );
    // Source-level assertion: panel uses 250ms for post-confirm refetch (CF-06).
    assert.match(
      PANEL_SRC,
      /\b250\b/,
      'panel source contains 250 literal for post-confirm refetch debounce',
    );
  });

  test('disconnectedCallback flushes #unsubs[] without throwing', () => {
    const el = instantiate();
    assert.doesNotThrow(() => el.disconnectedCallback());
    // Idempotent: second call also safe.
    assert.doesNotThrow(() => el.disconnectedCallback());
  });
});
