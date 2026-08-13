// /app/components/__tests__/app-affiliate-panel.test.js — Phase 62 Plan 62-06
// (AFF-01 + AFF-02).
//
// Run: cd website && node --test app/components/__tests__/app-affiliate-panel.test.js
//
// Tests the read-only referral network shell:
//   - The collapsed summary performs no referral lookup.
//   - Direct, level-2, and level-3 counts load inside the open disclosure.
//   - The expanded panel renders the incoming referrer and direct referrals.
//   - Linked Discord identities replace the compact address fallback.
//   - Referral identities are explorer-linked and never expose commission data.
//   - Empty, combined-account, and temporarily unavailable states stay useful.
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
        const roleMatch = /\brole="([^"]+)"/.exec(attrs);
        if (roleMatch) child.attributes.role = roleMatch[1];
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
let _fetchHandler = async () => ({
  player: null,
  referredBy: null,
  referees: [],
  total: 0,
  counts: { direct: 0, level2: 0, level3: 0 },
});
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
  _fetchHandler = async () => ({
    player: null,
    referredBy: null,
    referees: [],
    total: 0,
    counts: { direct: 0, level2: 0, level3: 0 },
  });
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
// Imports under test — store + panel module
// (panel dynamic-imported in beforeEach after globals installed).
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

// ---------------------------------------------------------------------------
// Read panel source for source-grep assertions.
// ---------------------------------------------------------------------------

const PANEL_SRC = readFileSync(
  new URL('../app-affiliate-panel.js', import.meta.url),
  'utf8',
);

const CONNECTED = '0xab12000000000000000000000000000000000000';

function instantiate({ open = true } = {}) {
  const Ctor = customElements.get('app-affiliate-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  if (open) {
    const details = el.querySelector('[data-bind="aff-details"]');
    details.open = true;
    details.dispatchEvent({ type: 'toggle' });
  }
  return el;
}

function makeRefereesPayload(overrides = {}) {
  return {
    player: CONNECTED,
    referredBy: null,
    referees: [],
    total: 0,
    counts: { direct: 0, level2: 0, level3: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<app-affiliate-panel> — referral network', () => {
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

  test('Panel renders a compact read-only referral network', async () => {
    const el = instantiate();
    await flushMicrotasks();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    assert.match(el.innerHTML, /REFERRALS/i, 'header contains REFERRALS');
    assert.match(el.innerHTML, /REFERRED BY/i, 'incoming relationship label present');
    assert.match(el.innerHTML, /DIRECT REFERRALS/i, 'direct-referral section label present');
    assert.match(el.innerHTML, /class="aff-network-stats"/, 'three-level counts use an interior stats row');
    assert.ok(el.querySelector('[data-bind="aff-count-direct"]'), 'direct count present inside');
    assert.ok(el.querySelector('[data-bind="aff-count-level2"]'), 'level-2 count present inside');
    assert.ok(el.querySelector('[data-bind="aff-count-level3"]'), 'level-3 count present inside');
    assert.equal(el.querySelector('[data-bind="aff-direct-total"]'), null, 'direct total is not duplicated');
    assert.ok(el.querySelector('[data-bind="aff-referred-by"]'), 'referred-by identity present');
    assert.ok(el.querySelector('[data-bind="aff-referees"]'), 'aff-referees container present');
    assert.equal(el.querySelector('[data-bind="aff-url"]'), null, 'sharing URL is not mixed into the panel');
    assert.equal(el.querySelector('[data-bind="aff-copy"]'), null, 'copy control is absent');
    assert.equal(el.querySelector('.aff-customize-submit'), null, 'customize control is absent');
    assert.doesNotMatch(el.innerHTML, /commission|claims tray|kickback/i,
      'financial and affiliate-code controls are absent');
  });

  test('Referrals starts closed with no lookup, then loads counts inside when opened', async () => {
    _fetchHandler = async (url) => String(url).includes('/api/profiles?')
      ? { profiles: [] }
      : makeRefereesPayload({
        total: 4,
        counts: { direct: 4, level2: 12, level3: 37 },
      });
    const el = instantiate({ open: false });
    await settle(40);
    const details = el.querySelector('[data-bind="aff-details"]');
    assert.ok(details, 'outer referrals disclosure present');
    assert.notEqual(details.open, true, 'disclosure starts closed');
    const openingTag = el.innerHTML.match(/<details\b[^>]*data-bind="aff-details"[^>]*>/)?.[0] || '';
    assert.match(openingTag, /class="app-affiliate-panel aff-disclosure section-disclosure"/,
      'uses the same shared disclosure shell as passes and history');
    const openingClasses = openingTag.match(/class="([^"]+)"/)?.[1]?.split(/\s+/) || [];
    assert.equal(openingClasses.includes('panel'), false,
      'old standalone panel chrome is not layered over the shared disclosure shell');
    const summaryMarkup = el.innerHTML.match(/<summary class="aff-summary section-disclosure__bar">[\s\S]*?<\/summary>/)?.[0] || '';
    assert.match(summaryMarkup, /section-disclosure__title[\s\S]*?section-disclosure__chevron/,
      'summary uses the shared title bar and chevron');
    assert.doesNotMatch(summaryMarkup, /aff-count-|DIRECT|LEVEL 2|LEVEL 3/,
      'the closed bar contains no referral totals');
    assert.doesNotMatch(openingTag, /\sopen(?:\s|>)/, 'no open attribute ships in the shell');
    assert.equal(_fetchCalls.some((url) => String(url).includes('/referees')), false,
      'closed disclosure performs no account-scoped referral lookup');

    details.open = true;
    details.dispatchEvent({ type: 'toggle' });
    await settle(40);
    assert.equal(details.open, true, 'disclosure opens');
    assert.equal(_fetchCalls.some((url) => String(url).includes('/referees')), true,
      'opening performs the account-scoped referral lookup');
    assert.equal(el.querySelector('[data-bind="aff-count-direct"]').textContent, '4');
    assert.equal(el.querySelector('[data-bind="aff-count-level2"]').textContent, '12');
    assert.equal(el.querySelector('[data-bind="aff-count-level3"]').textContent, '37');
  });

  test('Referral network fetches from /player/:address/referees when opened', async () => {
    instantiate();
    await settle(40);
    const matched = _fetchCalls.find((u) => u && u.includes('/referees'));
    assert.ok(matched, `fetchJSON called with /referees path; calls=${JSON.stringify(_fetchCalls)}`);
  });

  test('Referred by renders the incoming referrer as an explorer-linked address', async () => {
    const upline = '0xfeed00000000000000000000000000000000cafe';
    _fetchHandler = async () => makeRefereesPayload({ referredBy: upline });
    const el = instantiate();
    await settle(40);
    const referredBy = el.querySelector('[data-bind="aff-referred-by"]');
    assert.ok(referredBy, 'referred-by identity present');
    assert.match(referredBy.textContent, /0xfeed…cafe/i, 'short upline address rendered');
    const link = referredBy.querySelector('a');
    assert.equal(link?.title, upline, 'full upline address is available on hover');
    assert.match(link?.getAttribute('href') || '', /\/address\/0xfeed/i, 'upline links to explorer');
  });

  test('Referred by has an explicit empty state when no upline is recorded', async () => {
    const el = instantiate();
    await settle(40);
    const referredBy = el.querySelector('[data-bind="aff-referred-by"]');
    assert.equal(referredBy.textContent, 'No referrer recorded.');
  });

  test('Linked Discord identity is preferred with the wallet kept as context', async () => {
    const linked = '0x' + '1'.repeat(40);
    _fetchHandler = async (url) => {
      if (String(url).includes('/api/profiles?')) {
        return {
          profiles: [{
            address: linked,
            discord_name: 'Burnie',
            discord_avatar: 'https://cdn.discordapp.com/avatars/burnie.png',
          }],
        };
      }
      return makeRefereesPayload({
        referees: [{ address: linked, referredAt: '12345' }],
        total: 1,
        counts: { direct: 1, level2: 0, level3: 0 },
      });
    };
    const el = instantiate();
    await settle(60);
    const list = el.querySelector('[data-bind="aff-referees"]');
    assert.match(list.textContent, /Burnie/, 'Discord display name is primary');
    assert.match(list.textContent, /0x1111…1111/, 'short wallet remains available as context');
    const avatar = list.querySelector('.aff-referral-avatar');
    assert.match(String(avatar?.src || ''), /^https:\/\/cdn\.discordapp\.com\//,
      'validated Discord avatar is rendered');
  });

  test('Discord profile lookups respect the eight-address service batch limit', async () => {
    const referrals = Array.from({ length: 9 }, (_, index) => {
      const digit = (index + 1).toString(16);
      return { address: `0x${digit.repeat(40)}`, referredAt: String(index + 1) };
    });
    const linked = referrals.at(-1).address;
    const profileCalls = [];
    _fetchHandler = async (url) => {
      if (String(url).includes('/api/profiles?')) {
        profileCalls.push(String(url));
        const requested = new URL(String(url)).searchParams.get('addresses')?.split(',') || [];
        return {
          profiles: requested.includes(linked)
            ? [{ address: linked, discord_name: 'Ninth Degen', discord_avatar: null }]
            : [],
        };
      }
      return makeRefereesPayload({
        referees: referrals,
        total: referrals.length,
        counts: { direct: referrals.length, level2: 0, level3: 0 },
      });
    };

    const el = instantiate();
    await settle(80);
    assert.equal(profileCalls.length, 2, 'nine wallets are resolved in two profile calls');
    for (const url of profileCalls) {
      const addresses = new URL(url).searchParams.get('addresses')?.split(',') || [];
      assert.ok(addresses.length <= 8, `profile batch stays at or below eight; got ${addresses.length}`);
    }
    assert.match(el.querySelector('[data-bind="aff-referees"]').textContent, /Ninth Degen/,
      'a Discord identity from the second batch is rendered');
  });

  test('a freshness 503 explains that the referral index is catching up', async () => {
    _fetchHandler = async () => {
      const error = new Error('stale indexer');
      error.status = 503;
      throw error;
    };
    const el = instantiate();
    await settle(40);
    const referredBy = el.querySelector('[data-bind="aff-referred-by"]');
    const referrals = el.querySelector('[data-bind="aff-referees-empty"]');
    assert.match(referredBy.textContent, /index is catching up/i);
    assert.match(referrals.textContent, /retrying automatically/i);
  });

  test('Referral list renders only linked referral identities, never commission data', async () => {
    _fetchHandler = async () => makeRefereesPayload({
      referees: [
        { address: '0xref1000000000000000000000000000000000001', referredAt: '12345', totalCommissionFlip: '987654321', available: true, reason: null },
      ],
      total: 1,
      counts: { direct: 1, level2: 0, level3: 0 },
    });
    const el = instantiate();
    await settle(40);
    const list = el.querySelector('[data-bind="aff-referees"]');
    assert.ok(list, 'direct-referral list present');
    assert.equal(list.getAttribute('role'), 'list', 'container exposes list semantics');
    const txt = String(list.textContent || '');
    assert.match(txt, /0xref1/i, 'address rendered via textContent');
    assert.doesNotMatch(txt, /987654321|12345|commission/i,
      'commission and block metadata are omitted from the referral list');
    assert.doesNotMatch(el.innerHTML, /Commission ready to claim|Claims tray/i,
      'stale commission claim copy is absent');
  });

  test('Direct-referral empty state is concise', async () => {
    _fetchHandler = async () => makeRefereesPayload({ referees: [], total: 0 });
    const el = instantiate();
    await settle(40);
    const empty = el.querySelector('[data-bind="aff-referees-empty"]');
    assert.ok(empty, 'aff-referees-empty element present');
    // Empty-state visible when zero referees.
    assert.equal(empty.hidden, false, 'empty-state visible');
    assert.match(String(empty.textContent || el.innerHTML), /No direct referrals yet\./i, 'empty copy present');
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

  // Account-switcher (2026-07-16) — referral data is per-account identity,
  // not a metric that can be summed by combine.js.
  test("mode 'combined' renders the per-account note via the existing referees empty-state", async () => {
    let fetched = false;
    _fetchHandler = async () => { fetched = true; return makeRefereesPayload(); };
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    const el = instantiate();
    await settle();

    const emptyEl = el.querySelector('[data-bind="aff-referees-empty"]');
    assert.equal(emptyEl.hidden, false, 'referees empty-state visible in combined mode');
    assert.equal(emptyEl.textContent, 'Per-account stat. Pick a single account.');
    assert.equal(fetched, false, '/player/:address/referees never fetched in combined mode');
  });
});
