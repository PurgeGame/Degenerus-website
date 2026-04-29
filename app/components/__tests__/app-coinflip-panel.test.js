// /app/components/__tests__/app-coinflip-panel.test.js — Phase 62 Plan 62-03 (BUY-04)
// Run: cd website && node --test app/components/__tests__/app-coinflip-panel.test.js
//
// Tests <app-coinflip-panel> Custom Element: deposit row + click handler +
// view-mode disable hook (data-write attribute) + 'outcome at end of day'
// inline message (CF-08 / roadmap success-criterion 1) + error rendering via
// textContent (T-58-18) + NEVER optimistic balance subtraction (CF-06) +
// click debouncing (#busy) + NO RNG poll cycle (R3 — sync deposit).

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (verbatim port of app-pass-section.test.js — Phase 62 Plan 62-02).
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
import * as coinflipMod from '../../app/coinflip.js';
import * as contractsMod from '../../app/contracts.js';

const PANEL_SRC = readFileSync(
  new URL('../app-coinflip-panel.js', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// Fake contract harness
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) { return { status: 1, hash: '0xreceipt', logs: logs || [] }; }
function makeFakeTx(receipt) { return { hash: '0xtx', wait: async () => receipt }; }

function makeFakeCoinflipContract(opts = {}) {
  const calls = { depositCoinflip: [] };
  const stk = (name) => async () => {
    if (opts.staticCallShouldRevert?.[name]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[name] || 'AmountLTMin' };
      throw err;
    }
  };
  return {
    depositCoinflip: Object.assign(
      async (...args) => {
        calls.depositCoinflip.push(args);
        return makeFakeTx(makeFakeReceipt(opts.depositLogs || [
          {
            parsed: {
              name: 'CoinflipDeposit',
              args: { player: args[0], creditedFlip: 350n * 10n ** 18n },
            },
          },
        ]));
      },
      { staticCall: stk('depositCoinflip') }
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
  const Ctor = customElements.get('app-coinflip-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan 62-03: <app-coinflip-panel> Custom Element', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    coinflipMod.__setContractFactoryForTest(() => makeFakeCoinflipContract());
    await import('../app-coinflip-panel.js');
  });

  test("Custom element 'app-coinflip-panel' registers idempotently", async () => {
    const ctor = customElements.get('app-coinflip-panel');
    assert.ok(ctor, 'app-coinflip-panel is registered');
    await assert.doesNotReject(import('../app-coinflip-panel.js'));
    const ctor2 = customElements.get('app-coinflip-panel');
    assert.equal(ctor, ctor2, 'same ctor reference after re-import (idempotent)');
  });

  test('Panel renders shell with static innerHTML — header text COINFLIP', () => {
    const el = instantiate();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    assert.match(
      el.innerHTML.toUpperCase(),
      /COINFLIP/,
      'header copy contains COINFLIP',
    );
  });

  test('Deposit button has data-write attribute (Phase 58 view-mode disable hook)', () => {
    const el = instantiate();
    const btn = el.querySelector('[data-write]');
    assert.ok(btn, '[data-write] CTA button rendered');
    assert.match(PANEL_SRC, /data-write/, 'panel source contains literal data-write attribute');
  });

  test('Deposit click invokes depositCoinflip with parsed BURNIE amount in BigInt wei', async () => {
    let recordedArgs = null;
    coinflipMod.__setContractFactoryForTest(() => ({
      depositCoinflip: Object.assign(
        async (...args) => {
          recordedArgs = args;
          return makeFakeTx(makeFakeReceipt([
            { parsed: { name: 'CoinflipDeposit', args: { player: args[0], creditedFlip: 200n * 10n ** 18n } } },
          ]));
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const amountInput = el.querySelector('[name="cf-amount"]');
    assert.ok(amountInput, 'amount input rendered');
    amountInput.value = '200';

    const btn = el.querySelector('.cf-deposit-cta');
    btn.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.ok(recordedArgs, 'depositCoinflip invoked through contract');
    // args = [player, amount]
    assert.equal(recordedArgs[0], CONNECTED, 'player = connected.address');
    assert.equal(recordedArgs[1], 200n * 10n ** 18n, 'amount = 200 BURNIE in wei');

    el.disconnectedCallback();
  });

  test("Post-confirm message includes 'outcome at end of day' (CF-08 inline state change)", async () => {
    coinflipMod.__setContractFactoryForTest(() => ({
      depositCoinflip: Object.assign(
        async (...args) => makeFakeTx(makeFakeReceipt([
          { parsed: { name: 'CoinflipDeposit', args: { player: args[0], creditedFlip: 220n * 10n ** 18n } } },
        ])),
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const amountInput = el.querySelector('[name="cf-amount"]');
    amountInput.value = '200';

    const btn = el.querySelector('.cf-deposit-cta');
    btn.dispatchEvent({ type: 'click' });
    await settle(60);

    const statusEl = el.querySelector('.cf-status');
    assert.ok(statusEl, '.cf-status element present');
    // CF-08 inline message — required literal substring "outcome at end of day"
    assert.match(
      statusEl.textContent,
      /outcome at end of day/i,
      'status text contains CF-08 inline message',
    );

    el.disconnectedCallback();
  });

  test('Deposit click handler debounced — double-click invokes depositCoinflip exactly once', async () => {
    let callCount = 0;
    coinflipMod.__setContractFactoryForTest(() => ({
      depositCoinflip: Object.assign(
        async (...args) => {
          callCount += 1;
          return makeFakeTx(makeFakeReceipt([
            { parsed: { name: 'CoinflipDeposit', args: { player: args[0], creditedFlip: 100n * 10n ** 18n } } },
          ]));
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const amountInput = el.querySelector('[name="cf-amount"]');
    amountInput.value = '200';

    const btn = el.querySelector('.cf-deposit-cta');
    btn.dispatchEvent({ type: 'click' });
    btn.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(callCount, 1, 'double-click invokes depositCoinflip exactly once');

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
    assert.match(PANEL_SRC, /\.textContent\s*=/, 'panel source assigns .textContent (T-58-18)');
  });

  test('Deposit error revert renders userMessage via textContent', async () => {
    coinflipMod.__setContractFactoryForTest(() => ({
      depositCoinflip: Object.assign(
        async () => {
          const err = new Error('decoded revert');
          err.code = 'AmountLTMin';
          err.userMessage = 'Minimum coinflip deposit is 100 BURNIE.';
          err.recoveryAction = 'Increase your deposit and try again.';
          throw err;
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const amountInput = el.querySelector('[name="cf-amount"]');
    amountInput.value = '50';  // below min — but client-side validation rejects first
    const btn = el.querySelector('.cf-deposit-cta');
    btn.dispatchEvent({ type: 'click' });
    await settle(60);

    const errEl = el.querySelector('.cf-error');
    assert.ok(errEl, '.cf-error present');
    assert.ok(errEl.textContent.length > 0, 'error textContent populated');

    el.disconnectedCallback();
  });

  test('Panel source contains 10s + 250ms timing literals (CF-06)', () => {
    assert.match(PANEL_SRC, /\b10[_]?000\b/, 'panel source contains 10000 (or 10_000) literal for 10s error auto-clear');
    assert.match(PANEL_SRC, /\b250\b/, 'panel source contains 250 literal for post-confirm refetch debounce');
  });

  test('NO poll-for-resolve cycle on the deposit tx — panel does NOT call pollRngForLootbox (R3)', () => {
    assert.doesNotMatch(
      PANEL_SRC,
      /pollRngForLootbox/,
      'coinflip panel must NOT poll RNG (synchronous deposit per RESEARCH R3)',
    );
  });

  test('disconnectedCallback flushes #unsubs[] without throwing (idempotent)', () => {
    const el = instantiate();
    assert.doesNotThrow(() => el.disconnectedCallback());
    assert.doesNotThrow(() => el.disconnectedCallback());
  });
});
