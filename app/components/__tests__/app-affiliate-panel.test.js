// /app/components/__tests__/app-affiliate-panel.test.js — Phase 62 Plan 62-06
// (AFF-01 + AFF-02).
//
// Run: cd website && node --test app/components/__tests__/app-affiliate-panel.test.js
//
// Tests Custom Element shell for the affiliate panel:
//   - Default URL renders for any connected user (RESEARCH R2 — no prior
//     createAffiliateCode tx required; defaultCodeForAddress is enough).
//   - Copy CTA writes URL to navigator.clipboard with feedback toast.
//   - Customize CTA opens a hex-code + kickback% form; submit fires
//     createAffiliateCode through Phase 58 chokepoint.
//   - URL flips to registered code AFTER confirm (CF-06 — NEVER optimistic).
//   - Referee table fetches /player/:address/referees and renders rows via
//     textContent (T-58-18); honors FD-2 unavailable rows naturally.
//   - Empty referee state copy: "No referees yet — share your link to get
//     started."
//   - data-write attribute on Copy + Customize-submit buttons (CF-15
//     view-mode disable manager hook).
//
// fakeDOM scaffold inherited verbatim from app-quest-panel.test.js (Plan 62-04).

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (verbatim port from app-quest-panel.test.js).
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
    _value: '',
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
        if (/\bdata-write\b/.test(attrs)) child.attributes['data-write'] = '';
        const nameMatch = /\bname="([^"]+)"/.exec(attrs);
        if (nameMatch) child.attributes.name = nameMatch[1];
        const idMatch = /\bid="([^"]+)"/.exec(attrs);
        if (idMatch) child.attributes.id = idMatch[1];
        const hrefMatch = /\bhref="([^"]+)"/.exec(attrs);
        if (hrefMatch) child.attributes.href = hrefMatch[1];
        const typeMatch = /\btype="([^"]+)"/.exec(attrs);
        if (typeMatch) child.attributes.type = typeMatch[1];
        const classMatch = /\bclass="([^"]+)"/.exec(attrs);
        if (classMatch) {
          for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
        }
        if (/\bhidden\b/.test(attrs)) child.hidden = true;
        if (/\bdisabled\b/.test(attrs)) child.disabled = true;
        if (/\breadonly\b/.test(attrs)) child.attributes.readonly = '';
        const valueMatch = /\bvalue="([^"]*)"/.exec(attrs);
        if (valueMatch) child._value = valueMatch[1];
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
    get value() { return this._value; },
    set value(v) { this._value = v == null ? '' : String(v); },
    select() { /* no-op for fakeDOM */ },
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
    replaceChildren(...nodes) {
      this.children = [];
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
  // Compound class+attr like .clm-row[data-prize-key="eth"]
  const compound = sel.match(/^(\.[\w-]+)(\[[\w-]+(?:="[^"]*")?\])$/);
  if (compound) {
    return matches(el, compound[1]) && matches(el, compound[2]);
  }
  // input[name="..."] form
  const tagAttr = sel.match(/^([a-z][a-z0-9-]*)(\[[\w-]+="[^"]*"\])$/i);
  if (tagAttr) {
    return matches(el, tagAttr[1]) && matches(el, tagAttr[2]);
  }
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
let _docVisibilityState = 'visible';

globalThis.document = {
  createElement: (tag) => makeFakeElement(tag),
  querySelector: (sel) => _docBody.querySelector(sel),
  querySelectorAll: (sel) => _docBody.querySelectorAll(sel),
  body: _docBody,
  addEventListener: (type, fn) => {
    if (!_docListeners.has(type)) _docListeners.set(type, []);
    _docListeners.get(type).push(fn);
  },
  removeEventListener: (type, fn) => {
    const arr = _docListeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  },
  dispatchEvent: (ev) => {
    const arr = _docListeners.get(ev.type) || [];
    for (const fn of arr) {
      try { fn(ev); } catch { /* swallow */ }
    }
    return true;
  },
  // Stub for fallback execCommand('copy') path in clipboard handler.
  execCommand: (_cmd) => true,
  get visibilityState() { return _docVisibilityState; },
  set visibilityState(v) { _docVisibilityState = v; },
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

// fetch stub — panel reads /player/:address/referees on mount.
let _fetchHandler = async () => ({ player: null, referees: [], total: 0 });
let _fetchCalls = [];
globalThis.fetch = async (url) => {
  _fetchCalls.push(url);
  const data = await _fetchHandler(url);
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
};

// navigator.clipboard stub — captures writeText calls.
// Node's globalThis.navigator is getter-only (no setter); use defineProperty
// on globalThis to install a writable shadow that the panel reads as `navigator`.
let _clipboardCalls = [];
let _clipboardShouldFail = false;
const _fakeNavigator = {
  clipboard: {
    writeText: async (text) => {
      _clipboardCalls.push(text);
      if (_clipboardShouldFail) throw new Error('clipboard rejected');
      return undefined;
    },
  },
};
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: _fakeNavigator,
    writable: true,
    configurable: true,
  });
} catch (_e) {
  // If defineProperty also fails, fall back to monkey-patching the existing
  // navigator object's clipboard slot (Node's default navigator has no
  // clipboard property; we add one).
  try {
    if (!globalThis.navigator) {
      // Last-resort: replace the prototype-based getter with a plain property.
      Reflect.defineProperty(globalThis, 'navigator', {
        value: _fakeNavigator,
        writable: true,
        configurable: true,
      });
    } else {
      globalThis.navigator.clipboard = _fakeNavigator.clipboard;
    }
  } catch (_e2) { /* defensive */ }
}

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  _docVisibilityState = 'visible';
  globalThis.localStorage.clear();
  _docListeners.clear();
  _fetchCalls = [];
  _fetchHandler = async () => ({ player: null, referees: [], total: 0 });
  _clipboardCalls = [];
  _clipboardShouldFail = false;
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
// Imports under test — store + affiliate-helper module + panel module
// (panel dynamic-imported in beforeEach after globals installed).
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';
import * as affiliateMod from '../../app/affiliate.js';

// ---------------------------------------------------------------------------
// Read panel source for source-grep assertions.
// ---------------------------------------------------------------------------

const PANEL_SRC = readFileSync(
  new URL('../app-affiliate-panel.js', import.meta.url),
  'utf8',
);

const CONNECTED = '0xab12000000000000000000000000000000000000';

function instantiate() {
  const Ctor = customElements.get('app-affiliate-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

function makeRefereesPayload(overrides = {}) {
  return {
    player: CONNECTED,
    referees: [],
    total: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan 62-06: <app-affiliate-panel> — default URL + Customize CTA + referee table', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    _fetchHandler = async () => makeRefereesPayload();
    await import('../app-affiliate-panel.js');
  });

  test("Custom element 'app-affiliate-panel' registers idempotently after import", async () => {
    const ctor = customElements.get('app-affiliate-panel');
    assert.ok(ctor, 'app-affiliate-panel is registered');
    await assert.doesNotReject(import('../app-affiliate-panel.js'));
    const ctor2 = customElements.get('app-affiliate-panel');
    assert.equal(ctor, ctor2, 'same ctor reference after re-import (idempotent)');
  });

  test('Panel renders shell with default URL row + Customize section + Referee table', async () => {
    const el = instantiate();
    await flushMicrotasks();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    assert.match(el.innerHTML, /AFFILIATE/i, 'header contains AFFILIATE');
    // Default URL section.
    assert.ok(el.querySelector('[data-bind="aff-url"]'), 'aff-url input present');
    assert.ok(el.querySelector('[data-bind="aff-copy"]'), 'aff-copy button present');
    // Customize section.
    assert.ok(el.querySelector('input[name="aff-customize-code"]'), 'aff-customize-code input present');
    assert.ok(el.querySelector('input[name="aff-customize-pct"]'), 'aff-customize-pct input present');
    // Referee table.
    assert.ok(el.querySelector('[data-bind="aff-referees"]'), 'aff-referees container present');
  });

  test('Default URL renders with defaultCodeForAddress on mount', async () => {
    const el = instantiate();
    await settle(20);
    const input = el.querySelector('[data-bind="aff-url"]');
    assert.ok(input, 'aff-url input present');
    const url = input.value || input._value || '';
    const expectedCode = '0x' + '0'.repeat(24) + CONNECTED.slice(2).toLowerCase();
    assert.match(url, new RegExp(expectedCode), `URL contains default LEFT-padded code ${expectedCode}`);
    assert.match(url, /https:\/\/purgegame\.com\/app\/\?ref=/, 'URL has expected base + ?ref=');
  });

  test('Copy CTA + Customize submit carry data-write attribute (CF-15 view-mode disable hook)', async () => {
    const el = instantiate();
    await flushMicrotasks();
    const copyBtn = el.querySelector('[data-bind="aff-copy"]');
    const submitBtn = el.querySelector('.aff-customize-submit');
    assert.ok(copyBtn, 'copy button present');
    assert.equal(copyBtn.getAttribute('data-write'), '', 'copy button has data-write');
    assert.ok(submitBtn, 'customize submit button present');
    assert.equal(submitBtn.getAttribute('data-write'), '', 'customize submit has data-write');
  });

  test('Copy CTA invokes navigator.clipboard.writeText with the URL', async () => {
    const el = instantiate();
    await settle(20);
    const copyBtn = el.querySelector('[data-bind="aff-copy"]');
    copyBtn.dispatchEvent({ type: 'click' });
    await settle(20);
    assert.ok(_clipboardCalls.length >= 1, 'clipboard.writeText called at least once');
    const expectedCode = '0x' + '0'.repeat(24) + CONNECTED.slice(2).toLowerCase();
    assert.match(_clipboardCalls[0], new RegExp(expectedCode), 'clipboard call contains the URL');
  });

  test('Copy success surfaces feedback via textContent (T-58-18)', async () => {
    const el = instantiate();
    await settle(20);
    const copyBtn = el.querySelector('[data-bind="aff-copy"]');
    copyBtn.dispatchEvent({ type: 'click' });
    await settle(20);
    const fb = el.querySelector('[data-bind="aff-copy-feedback"]');
    assert.ok(fb, 'aff-copy-feedback element present');
    assert.match(String(fb.textContent || ''), /copied/i, 'feedback contains "copied"');
  });

  test('Customize submit invokes createAffiliateCode with parsed form fields', async () => {
    const el = instantiate();
    await settle(20);
    // Stub createAffiliateCode via __setContractFactoryForTest seam on affiliate.js.
    // (affiliate.js helper is what the panel calls; we can't easily replace it
    // mid-import, so we stub via the test seam injecting a fake contract.)
    const calls = { createAffiliateCode: [] };
    const fake = {
      createAffiliateCode: Object.assign(
        async (...args) => {
          calls.createAffiliateCode.push(args);
          return { hash: '0xtx', wait: async () => ({ status: 1, hash: '0xreceipt', logs: [] }) };
        },
        { staticCall: async () => undefined },
      ),
      connect(_) { return this; },
      _calls: calls,
    };
    // Need provider for sendTx path.
    const contractsMod = await import('../../app/contracts.js');
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: 11155111n }),
      getSigner: async () => ({ getAddress: async () => CONNECTED }),
    });
    affiliateMod.__setContractFactoryForTest(() => fake);
    try {
      // Fill form.
      const codeInput = el.querySelector('input[name="aff-customize-code"]');
      const pctInput = el.querySelector('input[name="aff-customize-pct"]');
      codeInput.value = 'DEGEN';
      pctInput.value = '10';
      // Click submit.
      const submitBtn = el.querySelector('.aff-customize-submit');
      submitBtn.dispatchEvent({ type: 'click' });
      await settle(40);
      assert.equal(calls.createAffiliateCode.length, 1, 'createAffiliateCode called once');
      const [args] = calls.createAffiliateCode;
      // First arg is bytes32-encoded uppercase code. Second arg is uint8 pct.
      assert.ok(/^0x[0-9a-f]{64}$/i.test(args[0]), 'bytes32 hex code');
      assert.equal(args[1], 10, 'kickbackPct === 10');
    } finally {
      affiliateMod.__resetContractFactoryForTest();
      contractsMod.clearProvider();
    }
  });

  test('Customize error renders via textContent (T-58-18)', async () => {
    const el = instantiate();
    await settle(20);
    // Inject a contract whose static-call reverts with Insufficient (code-taken).
    const fake = {
      createAffiliateCode: Object.assign(
        async (..._args) => { return { hash: '0xtx', wait: async () => ({ status: 1, logs: [] }) }; },
        {
          staticCall: async () => {
            const err = new Error('static-call revert');
            err.revert = { name: 'Insufficient' };
            throw err;
          },
        },
      ),
      connect(_) { return this; },
    };
    const contractsMod = await import('../../app/contracts.js');
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: 11155111n }),
      getSigner: async () => ({ getAddress: async () => CONNECTED }),
    });
    affiliateMod.__setContractFactoryForTest(() => fake);
    try {
      const codeInput = el.querySelector('input[name="aff-customize-code"]');
      const pctInput = el.querySelector('input[name="aff-customize-pct"]');
      codeInput.value = 'DEGEN';
      pctInput.value = '0';
      const submitBtn = el.querySelector('.aff-customize-submit');
      submitBtn.dispatchEvent({ type: 'click' });
      await settle(40);
      const errEl = el.querySelector('[data-bind="aff-customize-error"]');
      assert.ok(errEl, 'aff-customize-error element present');
      assert.match(
        String(errEl.textContent || ''),
        /already taken|different/i,
        'decoded userMessage rendered via textContent',
      );
    } finally {
      affiliateMod.__resetContractFactoryForTest();
      contractsMod.clearProvider();
    }
  });

  test('NEVER optimistic URL flip — URL only updates AFTER confirmed Customize tx (CF-06)', async () => {
    const el = instantiate();
    await settle(20);
    const input = el.querySelector('[data-bind="aff-url"]');
    const beforeUrl = input.value || input._value || '';
    // Inject a NEVER-resolving createAffiliateCode.
    const fake = {
      createAffiliateCode: Object.assign(
        async (..._args) => new Promise(() => {}),
        { staticCall: async () => undefined },
      ),
      connect(_) { return this; },
    };
    const contractsMod = await import('../../app/contracts.js');
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: 11155111n }),
      getSigner: async () => ({ getAddress: async () => CONNECTED }),
    });
    affiliateMod.__setContractFactoryForTest(() => fake);
    try {
      const codeInput = el.querySelector('input[name="aff-customize-code"]');
      const pctInput = el.querySelector('input[name="aff-customize-pct"]');
      codeInput.value = 'DEGEN';
      pctInput.value = '5';
      const submitBtn = el.querySelector('.aff-customize-submit');
      submitBtn.dispatchEvent({ type: 'click' });
      // Settle just enough microtasks for the click handler to start; the
      // never-resolving sendTx blocks completion. URL must NOT have flipped.
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      const stillUrl = input.value || input._value || '';
      assert.equal(stillUrl, beforeUrl, 'URL unchanged during pending Customize tx (no optimistic flip)');
    } finally {
      affiliateMod.__resetContractFactoryForTest();
      contractsMod.clearProvider();
    }
  });

  test('Referee table fetches from /player/:address/referees on mount', async () => {
    instantiate();
    await settle(40);
    const matched = _fetchCalls.find((u) => u && u.includes('/referees'));
    assert.ok(matched, `fetchJSON called with /referees path; calls=${JSON.stringify(_fetchCalls)}`);
  });

  test('Referee table renders rows via textContent (T-58-18 + FD-2 honored)', async () => {
    _fetchHandler = async () => makeRefereesPayload({
      referees: [
        { address: '0xref1000000000000000000000000000000000001', referredAt: '12345', totalCommissionBurnie: '0', available: false, reason: 'commission-aggregation-pending' },
      ],
      total: 1,
    });
    const el = instantiate();
    await settle(40);
    const table = el.querySelector('[data-bind="aff-referees"]');
    assert.ok(table, 'referee table present');
    const txt = String(table.textContent || '');
    assert.match(txt, /0xref1/i, 'address rendered via textContent');
    // FD-2 unavailable — commission column should show "—" or "pending".
    assert.match(txt, /—|pending/i, 'unavailable commission shown as "—" or "pending" indicator');
  });

  test('Referee table empty state — "No referees yet — share your link to get started."', async () => {
    _fetchHandler = async () => makeRefereesPayload({ referees: [], total: 0 });
    const el = instantiate();
    await settle(40);
    const empty = el.querySelector('[data-bind="aff-referees-empty"]');
    assert.ok(empty, 'aff-referees-empty element present');
    // Empty-state visible when zero referees.
    assert.equal(empty.hidden, false, 'empty-state visible');
    assert.match(String(empty.textContent || el.innerHTML), /No referees yet/i, 'empty copy present');
  });

  test('Customize-submit click is debounced — double-click invokes createAffiliateCode only once', async () => {
    const el = instantiate();
    await settle(20);
    const calls = { createAffiliateCode: [] };
    const fake = {
      createAffiliateCode: Object.assign(
        async (...args) => {
          calls.createAffiliateCode.push(args);
          return { hash: '0xtx', wait: async () => ({ status: 1, hash: '0xreceipt', logs: [] }) };
        },
        { staticCall: async () => undefined },
      ),
      connect(_) { return this; },
      _calls: calls,
    };
    const contractsMod = await import('../../app/contracts.js');
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: 11155111n }),
      getSigner: async () => ({ getAddress: async () => CONNECTED }),
    });
    affiliateMod.__setContractFactoryForTest(() => fake);
    try {
      const codeInput = el.querySelector('input[name="aff-customize-code"]');
      const pctInput = el.querySelector('input[name="aff-customize-pct"]');
      codeInput.value = 'DEGEN';
      pctInput.value = '5';
      const submitBtn = el.querySelector('.aff-customize-submit');
      submitBtn.dispatchEvent({ type: 'click' });
      submitBtn.dispatchEvent({ type: 'click' });
      await settle(40);
      assert.equal(calls.createAffiliateCode.length, 1, 'debounced — exactly one call');
    } finally {
      affiliateMod.__resetContractFactoryForTest();
      contractsMod.clearProvider();
    }
  });

  test('Panel imports defaultCodeForAddress / buildAffiliateUrl / createAffiliateCode from affiliate.js', () => {
    assert.match(
      PANEL_SRC,
      /from\s+['"]\.\.\/app\/affiliate\.js['"]/,
      'panel imports from ../app/affiliate.js',
    );
    assert.match(PANEL_SRC, /defaultCodeForAddress/, 'imports defaultCodeForAddress');
    assert.match(PANEL_SRC, /buildAffiliateUrl/, 'imports buildAffiliateUrl');
    assert.match(PANEL_SRC, /createAffiliateCode/, 'imports createAffiliateCode');
  });

  test('Panel imports readAffiliateCode from lootbox.js (R6 — Phase 60 D-05 reuse)', () => {
    assert.match(
      PANEL_SRC,
      /readAffiliateCode/,
      'panel uses readAffiliateCode from lootbox.js',
    );
  });

  test('Panel uses fetchJSON for /referees endpoint read', () => {
    assert.match(PANEL_SRC, /fetchJSON\(/, 'fetchJSON used');
    assert.match(PANEL_SRC, /\/referees/, 'panel references /referees endpoint path');
  });

  test('Panel uses textContent for >= 5 server-derived strings (T-58-18)', () => {
    const matches = PANEL_SRC.match(/\.textContent\s*=/g) || [];
    assert.ok(
      matches.length >= 5,
      `panel uses .textContent ≥ 5 times for server-derived strings; got ${matches.length}`,
    );
  });

  test('Panel includes 10s auto-clear timer for error states', () => {
    assert.match(PANEL_SRC, /10000|10_000/, 'panel uses 10s auto-clear');
  });

  test('Panel registers idempotent customElements.define', () => {
    assert.match(
      PANEL_SRC,
      /customElements\.get\(['"]app-affiliate-panel['"]\)|!customElements\.get/,
      'panel guards customElements.define with .get() check',
    );
  });

  test('disconnectedCallback aborts poll cycle and flushes #unsubs[] without throwing', () => {
    const el = instantiate();
    assert.doesNotThrow(() => el.disconnectedCallback());
    // Idempotent: second call also safe.
    assert.doesNotThrow(() => el.disconnectedCallback());
  });
});
