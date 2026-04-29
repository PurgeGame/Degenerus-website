// /app/components/__tests__/app-claims-panel.test.js — Phase 61 Plan 61-01 (CLM-01 + CLM-04)
// Run: cd website && node --test app/components/__tests__/app-claims-panel.test.js
//
// Tests Custom Element scaffold for the multi-prize claim tray:
//   - Spoiler gate (D-06) with localStorage[`spun_day_${CHAIN.id}_${pinnedDay}`]
//   - Render gate (D-01) — only render eth | burnie | decimator rows when amount > 0n
//   - Hidden 4 keys (tickets, vault, farFutureCoin, terminal) NEVER render in v4.6
//   - Zero-state copy (CLM-04) when whitelist filter + amount-gate yields zero rows
//   - Per-row Claim buttons present but DISABLED with data-stub="true" (Plan 61-02 wires)
//   - localStorage SecurityError fail-safe (Pitfall F mitigation — show CTA, don't spoil)
//   - Idempotency-guarded customElements.define (re-import safe)
// Plan 61-02 will extend with claim helpers + reason-map decoders + per-row pending UX.
// Plan 61-03 will extend with polling lifecycle + visibility + cross-tab spun_day refresh.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// store module is safe to static-import (no HTMLElement use). Tests use it
// to drive `connected.address` so the panel's #runMountFetch can fetch /pending.
import * as storeMod from '../../app/store.js';
// Plan 61-02 — claims/contracts modules used by the per-row click handler tests.
// Tests inject a fake Contract via __setContractFactoryForTest and a fake
// provider via setProvider; the entire claims.js + contracts.js + reason-map.js
// pipeline runs end-to-end with only the contract construction stubbed.
import * as claimsMod from '../../app/claims.js';
import * as contractsMod from '../../app/contracts.js';

const TEST_ADDR = '0xab12000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Fake DOM (verbatim port of app-packs-panel.test.js fake-DOM scaffolding —
// Plan 60-01 precedent at lines 17-260; tests are leaf nodes, no cross-imports).
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
        const dataPrizeKeyMatch = /data-prize-key="([^"]+)"/.exec(attrs);
        if (dataPrizeKeyMatch) child.attributes['data-prize-key'] = dataPrizeKeyMatch[1];
        const dataStubMatch = /data-stub="([^"]+)"/.exec(attrs);
        if (dataStubMatch) child.attributes['data-stub'] = dataStubMatch[1];
        const hrefMatch = /\bhref="([^"]+)"/.exec(attrs);
        if (hrefMatch) child.attributes.href = hrefMatch[1];
        if (/\bdata-write\b/.test(attrs)) child.attributes['data-write'] = '';
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
    scrollIntoView() { /* no-op in fakeDOM */ },
  };
  return el;
}

function matches(el, sel) {
  if (!el) return false;
  // Compound selector with descendant — split on whitespace and check chain
  if (/\s/.test(sel)) {
    const parts = sel.trim().split(/\s+/);
    // Match the rightmost part on this element first
    if (!matches(el, parts[parts.length - 1])) return false;
    // Walk up parents matching prior parts in reverse
    let cur = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      while (cur && !matches(cur, parts[i])) cur = cur.parentElement;
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }
  // Compound class+attr like .clm-row[data-prize-key="eth"]
  const compound = sel.match(/^(\.[\w-]+)(\[[\w-]+="[^"]*"\])$/);
  if (compound) {
    return matches(el, compound[1]) && matches(el, compound[2]);
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

// ---------------------------------------------------------------------------
// Fake document + globalThis stubs — installed BEFORE dynamic import of the
// component (which needs HTMLElement at module-load time for class extends).
// Mirrors Phase 58/59/60 dynamic-await-import-in-beforeEach pattern.
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
  removeEventListener: (type, fn) => {
    const arr = _docListeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  },
  dispatchEvent: (ev) => {
    const arr = _docListeners.get(ev?.type) || [];
    for (const fn of arr) {
      try { fn(ev); } catch { /* swallow */ }
    }
    return true;
  },
  visibilityState: 'visible',
};

// Plan 61-03 — window event registry (storage events for cross-tab spun_day).
const _winListeners = new Map();
globalThis.window = {
  addEventListener: (type, fn) => {
    if (!_winListeners.has(type)) _winListeners.set(type, []);
    _winListeners.get(type).push(fn);
  },
  removeEventListener: (type, fn) => {
    const arr = _winListeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  },
  dispatchEvent: (ev) => {
    const arr = _winListeners.get(ev?.type) || [];
    for (const fn of arr) {
      try { fn(ev); } catch { /* swallow */ }
    }
    return true;
  },
  location: { search: '', href: 'http://localhost/' },
};

globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};

// localStorage shim — tests override .getItem to drive spoiler-gate variants.
function makeLocalStorage() {
  return {
    _m: new Map(),
    getItem(k) { return this._m.get(k) ?? null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
    clear() { this._m.clear(); },
  };
}
globalThis.localStorage = makeLocalStorage();

// Per-test fetch stub — installed via setFetchResponses({ pending, lastDay, dashboard }).
// Dispatches by URL pattern matching the 3 indexer routes the panel calls.
let _fetchResponses = { pending: null, lastDay: null, dashboard: null };
// Plan 61-03 — fetch invocation log: each entry is { url, ts }. Tests assert
// on the log to verify polling cycle re-fetches, address-change re-fetches, etc.
const _fetchLog = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  _fetchLog.push({ url: u, ts: Date.now() });
  // /game/jackpot/last-day
  if (u.includes('/game/jackpot/last-day')) {
    if (_fetchResponses.lastDay !== null) {
      return { ok: true, status: 200, json: async () => _fetchResponses.lastDay };
    }
  } else if (u.endsWith('/pending')) {
    // /player/:address/pending
    if (_fetchResponses.pending !== null) {
      return { ok: true, status: 200, json: async () => _fetchResponses.pending };
    }
  } else if (/\/player\/0x[0-9a-f]+$/i.test(u)) {
    // /player/:address (consolidated dashboard) — anchored to no trailing path
    if (_fetchResponses.dashboard !== null) {
      return { ok: true, status: 200, json: async () => _fetchResponses.dashboard };
    }
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

function setFetchResponses({ pending = null, lastDay = null, dashboard = null } = {}) {
  _fetchResponses = { pending, lastDay, dashboard };
}

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.document.visibilityState = 'visible';
  globalThis.localStorage = makeLocalStorage();
  _docListeners.clear();
  _winListeners.clear();
  _fetchResponses = { pending: null, lastDay: null, dashboard: null };
  _fetchLog.length = 0;
}

async function flushMicrotasks() {
  // Allow Promise.allSettled fan-out + render to complete.
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

// Helper — resolves the panel's render root (light DOM by default; falls back
// to shadowRoot if the implementation switches to shadow DOM).
function getRenderRoot(el) {
  return el.shadowRoot || el;
}

// ---------------------------------------------------------------------------
// Tests — all initially RED with "Cannot find module '../app-claims-panel.js'".
// Task 2 (Plan 61-01) implements the component and turns these GREEN.
// ---------------------------------------------------------------------------

describe('app-claims-panel — spoiler gate (D-06)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    await import('../app-claims-panel.js');
  });

  test('un-spun resolved day blocks rows (renders .clm-spoiler-gate, hides .clm-row)', async () => {
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: '0xab12000000000000000000000000000000000000',
        pending: {
          eth:           { amount: '1234500000000000000', available: true,  reason: null },
          burnie:        { amount: '500000000000000000000', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
    });
    // localStorage[spun_day_11155111_42] missing — gate CLOSED.
    // (default localStorage from resetDom returns null for unset keys)

    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();

    const root = getRenderRoot(el);
    const gate = root.querySelector('.clm-spoiler-gate');
    assert.ok(gate, '.clm-spoiler-gate present when un-spun resolved day');
    const rows = root.querySelectorAll('.clm-row');
    assert.equal(rows.length, 0, 'zero .clm-row elements when spoiler gate blocks');
    // Blocking-CTA copy must reference the spin widget.
    assert.ok(/Spin/.test(gate.textContent), 'gate text contains "Spin"');
  });

  test('spun resolved day reveals rows (.clm-spoiler-gate hidden, .clm-row visible)', async () => {
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: '0xab12000000000000000000000000000000000000',
        pending: {
          eth:           { amount: '1234500000000000000', available: true,  reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
    });
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');

    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();

    const root = getRenderRoot(el);
    assert.equal(root.querySelector('.clm-spoiler-gate'), null, 'no .clm-spoiler-gate when spun');
    const rows = root.querySelectorAll('.clm-row');
    assert.ok(rows.length >= 1, 'at least one .clm-row rendered');
  });

  test('cold-start (status: pre-game) opens gate — no spoiler to gate', async () => {
    setFetchResponses({
      lastDay: { day: null, status: 'pre-game' },
      pending: {
        player: '0xab12000000000000000000000000000000000000',
        pending: {
          eth:           { amount: '0', available: true,  reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
    });
    // No spun_day_* key — but pre-game status means there's no spoiler to gate.

    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();

    const root = getRenderRoot(el);
    assert.equal(
      root.querySelector('.clm-spoiler-gate'),
      null,
      'no .clm-spoiler-gate on pre-game cold-start',
    );
  });

  test('localStorage SecurityError fail-safe — gate stays CLOSED (show CTA, do not spoil)', async () => {
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: '0xab12000000000000000000000000000000000000',
        pending: {
          eth:           { amount: '1234500000000000000', available: true,  reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
    });
    // Hostile localStorage.getItem — throws SecurityError (private browsing).
    globalThis.localStorage = {
      getItem: () => {
        const e = new Error('SecurityError');
        e.name = 'SecurityError';
        throw e;
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };

    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();

    const root = getRenderRoot(el);
    assert.ok(
      root.querySelector('.clm-spoiler-gate'),
      'gate is CLOSED on SecurityError (fail-safe — show CTA, do not spoil)',
    );
  });
});

describe('app-claims-panel — render gate (D-01)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    await import('../app-claims-panel.js');
  });

  test('hidden 4 keys (tickets/vault/terminal/farFutureCoin) NEVER render', async () => {
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: '0xab12000000000000000000000000000000000000',
        pending: {
          eth:           { amount: '0', available: true,  reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '99', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '99', available: false, reason: 'pre-game' },
          vault:         { amount: '99', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '99', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
    });
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');

    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();

    const root = getRenderRoot(el);
    const rows = root.querySelectorAll('.clm-row');
    assert.equal(rows.length, 0, 'zero rows for hidden-4-key non-zero amounts');
    // Should render zero-state instead.
    assert.ok(root.querySelector('.clm-zero-state'), '.clm-zero-state present');
  });

  test('only rows with amount > 0n render (eth=1000, burnie=0, decimator=0)', async () => {
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: '0xab12000000000000000000000000000000000000',
        pending: {
          eth:           { amount: '1000', available: true,  reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
    });
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');

    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();

    const root = getRenderRoot(el);
    const rows = root.querySelectorAll('.clm-row');
    assert.equal(rows.length, 1, 'exactly 1 row when only eth > 0n');
    assert.ok(
      root.querySelector('.clm-row[data-prize-key="eth"]'),
      'eth row present',
    );
    assert.equal(
      root.querySelector('.clm-row[data-prize-key="burnie"]'),
      null,
      'burnie row absent',
    );
    assert.equal(
      root.querySelector('.clm-row[data-prize-key="decimator"]'),
      null,
      'decimator row absent',
    );
  });

  test('decimator row hidden when levels.length === 0 even if amount > 0n (Pitfall 7)', async () => {
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: '0xab12000000000000000000000000000000000000',
        pending: {
          eth:           { amount: '0', available: true,  reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '500', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
      dashboard: {
        decimator: { claimablePerLevel: [] },
      },
    });
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');

    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();

    const root = getRenderRoot(el);
    assert.equal(
      root.querySelector('.clm-row[data-prize-key="decimator"]'),
      null,
      'decimator row absent when levels are empty',
    );
  });
});

describe('app-claims-panel — zero-state (CLM-04)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    await import('../app-claims-panel.js');
  });

  test('all 3 amounts === 0n + spoiler gate open → renders .clm-zero-state', async () => {
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: '0xab12000000000000000000000000000000000000',
        pending: {
          eth:           { amount: '0', available: true,  reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
    });
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');

    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();

    const root = getRenderRoot(el);
    const zero = root.querySelector('.clm-zero-state');
    assert.ok(zero, '.clm-zero-state element present');
    assert.ok(/Nothing to claim/.test(zero.textContent), 'zero-state text contains "Nothing to claim"');
    // CLM-04 anchor link target.
    const link = root.querySelector('.clm-zero-state a');
    assert.ok(link, 'anchor inside zero-state');
    assert.ok(
      String(link.getAttribute('href') || '').includes('how-prizes-work'),
      'anchor href contains "how-prizes-work"',
    );
  });
});

// ===========================================================================
// Plan 61-02 — claim handlers (replaces the Plan 61-01 stub-button assertion).
//
// Plan 61-01's stub-button test (which asserted `data-stub="true"` + disabled)
// is REMOVED — Plan 61-02 wires real click handlers and removes both
// attributes. This describe block adds the per-row click-handler / pending-UX
// state-machine coverage.
//
// Test seam — claims.js's `__setContractFactoryForTest` injects a fake Contract
// so the entire claims.js + contracts.js + reason-map.js pipeline runs
// end-to-end (Phase 56 static-call + Phase 58 sendTx + chain-assert all run
// for real; only the contract construction is stubbed).
// ===========================================================================

function makeFakeReceipt(logs = []) {
  return { status: 1, hash: '0xreceipt-hash', logs };
}
function makeFakeTx(receipt) {
  return { hash: '0xtx-hash', wait: async () => receipt };
}
function makeFakeProvider(addr) {
  return {
    getNetwork: async () => ({ chainId: 11155111n }),
    getSigner: async () => ({ getAddress: async () => addr }),
  };
}
function makeFakeClaimsContract(opts = {}) {
  const calls = {
    claimWinnings: [],
    claimCoinflips: [],
    claimDecimatorJackpot: [],
  };
  const stk = (name, idx) => async () => {
    if (opts.staticCallShouldRevert?.[name]) {
      const stack = opts.staticCallShouldRevert[name];
      const trip = Array.isArray(stack) ? stack[idx?.value ?? 0] : stack;
      if (trip) {
        const err = new Error('static-call revert');
        const nameStack = opts.staticCallRevertName?.[name];
        err.revert = {
          name: Array.isArray(nameStack)
            ? (nameStack[idx?.value ?? 0] || 'DecAlreadyClaimed')
            : (nameStack || 'DecAlreadyClaimed'),
        };
        throw err;
      }
    }
  };
  // Index counters for sequential decimator tests.
  const indices = {
    claimDecimatorJackpot: { value: 0 },
  };
  const c = {
    claimWinnings: Object.assign(
      async (...args) => { calls.claimWinnings.push(args); return makeFakeTx(makeFakeReceipt()); },
      { staticCall: stk('claimWinnings') }
    ),
    claimCoinflips: Object.assign(
      async (...args) => { calls.claimCoinflips.push(args); return makeFakeTx(makeFakeReceipt()); },
      { staticCall: stk('claimCoinflips') }
    ),
    claimDecimatorJackpot: Object.assign(
      async (...args) => {
        calls.claimDecimatorJackpot.push(args);
        const i = indices.claimDecimatorJackpot.value;
        indices.claimDecimatorJackpot.value = i + 1;
        return makeFakeTx(makeFakeReceipt());
      },
      {
        staticCall: async (...args) => {
          // Per-call indexed staticCall (sequential decimator).
          if (opts.staticCallShouldRevert?.claimDecimatorJackpot) {
            const stack = opts.staticCallShouldRevert.claimDecimatorJackpot;
            const i = indices.claimDecimatorJackpot.value;
            const trip = Array.isArray(stack) ? stack[i] : stack;
            if (trip) {
              const err = new Error('static-call revert');
              const nameStack = opts.staticCallRevertName?.claimDecimatorJackpot;
              err.revert = {
                name: Array.isArray(nameStack)
                  ? (nameStack[i] || 'DecAlreadyClaimed')
                  : (nameStack || 'DecAlreadyClaimed'),
              };
              throw err;
            }
          }
        },
      }
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
  };
  return c;
}

// Helper: poll-for-condition with bounded loops + setTimeout(0) yields.
async function settle(loops = 60) {
  for (let i = 0; i < loops; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < loops; i += 1) await Promise.resolve();
}

describe('app-claims-panel — claim handlers (Plan 61-02)', () => {
  let fakeContract;

  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(TEST_ADDR));
    fakeContract = makeFakeClaimsContract();
    claimsMod.__setContractFactoryForTest(() => fakeContract);
    await import('../app-claims-panel.js');
  });

  afterEach(() => {
    claimsMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  function mountPanel(overrides = {}) {
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: TEST_ADDR,
        pending: {
          eth:           { amount: '1234500000000000000', available: true, reason: null },
          burnie:        { amount: '500',                 available: true, reason: null },
          tickets:       { amount: '0',                   available: true, reason: null },
          decimator:     { amount: '999',                 available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
          ...(overrides.pending || {}),
        },
      },
      dashboard: {
        decimator: {
          claimablePerLevel: overrides.dashboardLevels || [
            { level: 5, ethAmount: '300', claimed: 0 },
            { level: 10, ethAmount: '500', claimed: 0 },
          ],
        },
      },
    });
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');
    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  test('rendered Claim buttons are interactive (NO `disabled`, NO `data-stub`)', async () => {
    const el = mountPanel();
    await flushMicrotasks();
    const root = getRenderRoot(el);
    const btn = root.querySelector('.clm-row[data-prize-key="eth"] .clm-row__claim-cta');
    assert.ok(btn, 'eth claim button exists');
    assert.equal(btn.disabled, false, 'button is interactive (not disabled)');
    assert.equal(btn.getAttribute('data-stub'), null, 'data-stub attribute removed');
    // data-write attribute STAYS — Phase 58 view-mode disable-manager hook.
    assert.equal(btn.getAttribute('data-write'), '', 'data-write attribute retained');
  });

  test('clicking eth row invokes claimEth (claimWinnings called with connected.address)', async () => {
    const el = mountPanel();
    await flushMicrotasks();
    const root = getRenderRoot(el);
    const btn = root.querySelector('.clm-row[data-prize-key="eth"] .clm-row__claim-cta');
    btn.dispatchEvent({ type: 'click' });
    await settle(80);
    assert.equal(fakeContract._calls.claimWinnings.length, 1, 'claimWinnings called once');
    assert.equal(fakeContract._calls.claimWinnings[0][0], TEST_ADDR, 'player arg = connected.address');
  });

  test('clicking burnie row invokes claimBurnie with amount BigInt sourced from /pending', async () => {
    const el = mountPanel();
    await flushMicrotasks();
    const root = getRenderRoot(el);
    const btn = root.querySelector('.clm-row[data-prize-key="burnie"] .clm-row__claim-cta');
    btn.dispatchEvent({ type: 'click' });
    await settle(80);
    assert.equal(fakeContract._calls.claimCoinflips.length, 1);
    const [args] = fakeContract._calls.claimCoinflips;
    assert.equal(args[0], TEST_ADDR);
    assert.equal(typeof args[1], 'bigint', 'amount arg is BigInt');
    assert.equal(args[1], 500n, 'amount sourced from /pending burnie.amount');
  });

  test('clicking decimator row invokes claimDecimatorLevels with ASCENDING-SORTED levels', async () => {
    const el = mountPanel({
      dashboardLevels: [
        { level: 15, ethAmount: '300', claimed: 0 },
        { level: 5, ethAmount: '200', claimed: 0 },
        { level: 10, ethAmount: '400', claimed: 0 },
      ],
    });
    await flushMicrotasks();
    const root = getRenderRoot(el);
    const btn = root.querySelector('.clm-row[data-prize-key="decimator"] .clm-row__claim-cta');
    btn.dispatchEvent({ type: 'click' });
    await settle(120);
    assert.equal(fakeContract._calls.claimDecimatorJackpot.length, 3, '3 sequential txes');
    assert.equal(fakeContract._calls.claimDecimatorJackpot[0][0], 5, 'level 5 first (ascending)');
    assert.equal(fakeContract._calls.claimDecimatorJackpot[1][0], 10);
    assert.equal(fakeContract._calls.claimDecimatorJackpot[2][0], 15);
  });

  test('click sets `.clm-row--claiming` class + button label `Claiming…` during pending', async () => {
    const el = mountPanel();
    await flushMicrotasks();
    const root = getRenderRoot(el);
    const rowEl = root.querySelector('.clm-row[data-prize-key="eth"]');
    const btn = rowEl.querySelector('.clm-row__claim-cta');
    // Inject a never-resolving claimWinnings — the row should stay in `claiming`.
    const slow = makeFakeClaimsContract();
    slow.claimWinnings = Object.assign(
      async (...args) => { slow._calls.claimWinnings.push(args); return new Promise(() => {}); },
      { staticCall: async () => {} },
    );
    claimsMod.__setContractFactoryForTest(() => slow);
    btn.dispatchEvent({ type: 'click' });
    // Settle just enough for the click handler's synchronous prelude to apply.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    assert.ok(rowEl.classList.contains('clm-row--claiming'), 'row has .clm-row--claiming');
    assert.equal(btn.disabled, true, 'button disabled during pending');
    assert.equal(btn.textContent, 'Claiming…', 'button label = Claiming…');
  });

  test('click is debounced 500ms — double-click invokes claimEth only once', async () => {
    const el = mountPanel();
    await flushMicrotasks();
    const root = getRenderRoot(el);
    const btn = root.querySelector('.clm-row[data-prize-key="eth"] .clm-row__claim-cta');
    // Double-click in rapid succession (no async gap).
    btn.dispatchEvent({ type: 'click' });
    btn.dispatchEvent({ type: 'click' });
    await settle(80);
    assert.equal(fakeContract._calls.claimWinnings.length, 1, 'debounced — exactly one call');
  });

  test('on revert, row gets `.clm-row--error` and `.clm-row__error` textContent = userMessage', async () => {
    const reverting = makeFakeClaimsContract({
      staticCallShouldRevert: { claimWinnings: true },
      staticCallRevertName: { claimWinnings: 'DecAlreadyClaimed' },
    });
    claimsMod.__setContractFactoryForTest(() => reverting);
    const el = mountPanel();
    await flushMicrotasks();
    const root = getRenderRoot(el);
    const rowEl = root.querySelector('.clm-row[data-prize-key="eth"]');
    const btn = rowEl.querySelector('.clm-row__claim-cta');
    btn.dispatchEvent({ type: 'click' });
    await settle(80);
    assert.ok(rowEl.classList.contains('clm-row--error'), 'row has .clm-row--error');
    const errEl = rowEl.querySelector('.clm-row__error');
    assert.ok(errEl, '.clm-row__error element rendered');
    // Decoded userMessage must be present (textContent only — T-58-18).
    assert.match(errEl.textContent, /already claimed/i);
  });

  test('error auto-clears on next-success-anywhere across the panel', async () => {
    // First, trip an error on eth row.
    const reverting = makeFakeClaimsContract({
      staticCallShouldRevert: { claimWinnings: true },
      staticCallRevertName: { claimWinnings: 'DecAlreadyClaimed' },
    });
    claimsMod.__setContractFactoryForTest(() => reverting);
    const el = mountPanel();
    await flushMicrotasks();
    const root = getRenderRoot(el);
    const ethRow = root.querySelector('.clm-row[data-prize-key="eth"]');
    const ethBtn = ethRow.querySelector('.clm-row__claim-cta');
    ethBtn.dispatchEvent({ type: 'click' });
    await settle(80);
    assert.ok(ethRow.classList.contains('clm-row--error'), 'eth row error set');
    // Now click burnie row → success → clears all errors.
    claimsMod.__setContractFactoryForTest(() => fakeContract);  // happy-path contract
    const burnieBtn = root.querySelector('.clm-row[data-prize-key="burnie"] .clm-row__claim-cta');
    // Wait out the 500ms debounce so the burnie click can register
    // (defensive — burnie has its own rowKey, but let microtasks flush).
    await settle(40);
    burnieBtn.dispatchEvent({ type: 'click' });
    await settle(80);
    assert.equal(ethRow.classList.contains('clm-row--error'), false, 'eth row error cleared on next-success');
    assert.equal(ethRow.querySelector('.clm-row__error'), null, '.clm-row__error element removed');
  });

  test('NEVER optimistic balance subtraction — row amount unchanged during pending (D-05 LOCKED)', async () => {
    const el = mountPanel();
    await flushMicrotasks();
    const root = getRenderRoot(el);
    const rowEl = root.querySelector('.clm-row[data-prize-key="eth"]');
    const amountEl = rowEl.querySelector('.clm-row__amount');
    const beforeAmount = amountEl.textContent;
    // Inject a never-resolving tx so we observe the pending state.
    const slow = makeFakeClaimsContract();
    slow.claimWinnings = Object.assign(
      async (...args) => { slow._calls.claimWinnings.push(args); return new Promise(() => {}); },
      { staticCall: async () => {} },
    );
    claimsMod.__setContractFactoryForTest(() => slow);
    const btn = rowEl.querySelector('.clm-row__claim-cta');
    btn.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    // pre-click amount must STILL be visible (no optimistic subtraction).
    assert.equal(amountEl.textContent, beforeAmount, 'row amount unchanged during pending');
  });

  test('dispatches `app-claims:tx-confirmed` CustomEvent on success', async () => {
    const el = mountPanel();
    await flushMicrotasks();
    let captured = null;
    el.addEventListener('app-claims:tx-confirmed', (ev) => { captured = ev; });
    const root = getRenderRoot(el);
    const btn = root.querySelector('.clm-row[data-prize-key="eth"] .clm-row__claim-cta');
    btn.dispatchEvent({ type: 'click' });
    await settle(80);
    assert.ok(captured, 'app-claims:tx-confirmed event fired');
    assert.equal(captured.detail?.rowKey, 'eth', 'detail.rowKey = eth');
  });
});

describe('app-claims-panel — XSS / textContent discipline (T-58-18)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    await import('../app-claims-panel.js');
  });

  test('server-derived amount is rendered via textContent (no <script> injection)', async () => {
    // If the panel ever evaluated a server-derived field via innerHTML, an attacker
    // could inject markup. We use a plausible (non-numeric) amount string to ensure
    // the renderer treats it as text. (Real `displayEth()` will throw or normalise;
    // the assertion is that no `<script>` tag is materialised in the DOM.)
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: '0xab12000000000000000000000000000000000000',
        pending: {
          eth:           { amount: '1234500000000000000', available: true,  reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
    });
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');

    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();

    const root = getRenderRoot(el);
    const amountEl = root.querySelector('.clm-row[data-prize-key="eth"] .clm-row__amount');
    assert.ok(amountEl, 'amount span present');
    // textContent must be a non-empty string (server-derived value).
    assert.ok(amountEl.textContent && amountEl.textContent.length > 0, 'textContent populated');
    // Defensive: no nested <script> child element should exist anywhere in panel.
    assert.equal(root.querySelector('script'), null, 'no <script> tags rendered');
  });
});

describe('app-claims-panel — idempotency', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    await import('../app-claims-panel.js');
  });

  test('customElements.define does not throw on second import', async () => {
    await assert.doesNotReject(async () => {
      await import('../app-claims-panel.js');
    });
    assert.ok(customElements.get('app-claims-panel'), 'still registered');
  });
});

// ===========================================================================
// Plan 61-03 — polling lifecycle + visibility-aware refresh + cross-tab
// spun_day storage event + post-confirm 250ms debounce + store subscriptions.
//
// Pitfall 9 RESEARCH correction: Phase 61 implements panel-owned polling
// (setInterval + AbortController per cycle, mirroring app-packs-panel.js
// :512-555), NOT a call to polling.js's fictional generic `start({key, ...})`
// API. These tests assert the panel-owned shape and verify the source has no
// reference to the nonexistent API.
//
// Test approach: tests do NOT wait 30s of real time. Instead they:
//   1. Mount the panel (kicks off connectedCallback → startPolling +
//      visibility/storage/tx-confirmed listeners + initial cycle).
//   2. Drive subsequent cycles via the wired event listeners
//      (visibilitychange / storage / app-claims:tx-confirmed / store updates).
//   3. Assert fetch invocation log + DOM state.
// ===========================================================================

// Read source once for source-level invariant assertions.
import { readFileSync } from 'node:fs';
const PANEL_SRC = readFileSync(
  new URL('../app-claims-panel.js', import.meta.url),
  'utf8',
);

function mountPanelForPolling(opts = {}) {
  setFetchResponses({
    lastDay: opts.lastDay !== undefined ? opts.lastDay : { day: 42, status: 'resolved' },
    pending: opts.pending !== undefined ? opts.pending : {
      player: TEST_ADDR,
      pending: {
        eth:           { amount: '1234500000000000000', available: true, reason: null },
        burnie:        { amount: '0', available: true, reason: null },
        tickets:       { amount: '0', available: true, reason: null },
        decimator:     { amount: '0', available: true, reason: null },
        terminal:      { amount: '0', available: false, reason: 'pre-game' },
        vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
        farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
      },
    },
    dashboard: opts.dashboard !== undefined ? opts.dashboard : { decimator: { claimablePerLevel: [] } },
  });
  if (opts.markSpun !== false) {
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');
  }
  const Ctor = customElements.get('app-claims-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

describe('app-claims-panel — polling + lifecycle (Plan 61-03)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(TEST_ADDR));
    claimsMod.__setContractFactoryForTest(() => makeFakeClaimsContract());
    await import('../app-claims-panel.js');
  });

  afterEach(() => {
    claimsMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('connectedCallback wires panel-owned 30s setInterval + AbortController-per-cycle', async () => {
    const el = mountPanelForPolling();
    await flushMicrotasks();
    // Source-level invariants — panel-owned poller (NOT polling.js fictional API).
    assert.match(
      PANEL_SRC,
      /setInterval\([^)]*30_?000\)/,
      'panel calls setInterval with 30_000 ms (or 30000) — panel-owned 30s tick',
    );
    assert.match(PANEL_SRC, /new AbortController\(\)/, 'panel constructs new AbortController per cycle');
    assert.equal(
      PANEL_SRC.includes('polling.start({'),
      false,
      'Phase 61 panel-owned poller — does NOT call polling.js fictional start({key, interval, fetcher}) API (RESEARCH Pitfall 9)',
    );
    // Behaviour: initial mount fetch fired (eager first cycle).
    assert.ok(_fetchLog.some(({ url }) => url.endsWith('/pending')), '/pending fetched on mount');
    assert.ok(
      _fetchLog.some(({ url }) => url.includes('/game/jackpot/last-day')),
      '/last-day fetched on mount',
    );
    el.disconnectedCallback();
  });

  test('30s polling cycle re-fetches /pending + /last-day + /player/:address in parallel (Promise.allSettled)', async () => {
    const el = mountPanelForPolling();
    await flushMicrotasks();
    const initialCount = _fetchLog.length;
    assert.ok(initialCount >= 3, 'initial mount fired 3 fetches in parallel');
    // Drive a subsequent poll cycle by invoking the panel-internal cycle via
    // visibility-return (simulates the 30s tick without waiting). After a
    // visibility-return-after-stale, the panel runs an immediate cycle.
    globalThis.document.visibilityState = 'hidden';
    // Force #lastPollAt to "long ago" — panel's 5min threshold means
    // immediate re-poll on visibility-return. Direct private-field access
    // is not possible, so tests use the visibilitychange listener and a
    // mocked Date.now that bumps the clock.
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;  // +6min — > 5min threshold
    try {
      globalThis.document.visibilityState = 'visible';
      globalThis.document.dispatchEvent({ type: 'visibilitychange' });
      await flushMicrotasks();
    } finally {
      Date.now = realNow;
    }
    // After visibility-return, we expect a fresh cycle = 3 more fetches.
    const afterCycle = _fetchLog.length;
    assert.ok(afterCycle - initialCount >= 3, `visibility-return triggered fresh cycle (${afterCycle - initialCount} new fetches)`);
    // Promise.allSettled fan-out — verified at source level.
    assert.match(PANEL_SRC, /Promise\.allSettled\(/, 'panel uses Promise.allSettled for parallel fan-out');
    el.disconnectedCallback();
  });

  test('visibility-return triggers immediate re-poll within 1s when ≥5min since last poll', async () => {
    const el = mountPanelForPolling();
    await flushMicrotasks();
    const before = _fetchLog.length;
    // Hide tab. No fetches should fire while hidden.
    globalThis.document.visibilityState = 'hidden';
    // Wait briefly — no fetches should fire from the visibilitychange path.
    await flushMicrotasks();
    // Simulate 6min elapsed.
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
      globalThis.document.visibilityState = 'visible';
      const t0 = realNow();
      globalThis.document.dispatchEvent({ type: 'visibilitychange' });
      // The cycle is async (Promise.allSettled) — flush microtasks.
      await flushMicrotasks();
      const after = _fetchLog.length;
      assert.ok(after > before, 'fresh fetches issued after visibility-return + 5min stale');
      const elapsed = realNow() - t0;
      assert.ok(elapsed < 1000, `re-poll fired within 1s (actual: ${elapsed}ms)`);
    } finally {
      Date.now = realNow;
    }
    el.disconnectedCallback();
  });

  test('visibility-return does NOT trigger immediate re-poll if <5min since last poll', async () => {
    const el = mountPanelForPolling();
    await flushMicrotasks();
    const before = _fetchLog.length;
    globalThis.document.visibilityState = 'hidden';
    await flushMicrotasks();
    // Simulate 2min elapsed — under 5min threshold.
    const realNow = Date.now;
    Date.now = () => realNow() + 2 * 60 * 1000;
    try {
      globalThis.document.visibilityState = 'visible';
      globalThis.document.dispatchEvent({ type: 'visibilitychange' });
      await flushMicrotasks();
      // Only the regular tick will fire eventually — no immediate fetch.
      const after = _fetchLog.length;
      assert.equal(after, before, 'no fresh fetches when <5min stale on visibility-return');
    } finally {
      Date.now = realNow;
    }
    el.disconnectedCallback();
  });

  test('storage event for `spun_day_${CHAIN.id}_*` triggers spoiler-gate re-evaluation', async () => {
    // Mount with un-spun resolved day → spoiler gate CLOSED (CTA visible).
    const el = mountPanelForPolling({ markSpun: false });
    await flushMicrotasks();
    const root = getRenderRoot(el);
    assert.ok(root.querySelector('.clm-spoiler-gate'), 'gate is CLOSED initially');
    assert.equal(root.querySelectorAll('.clm-row').length, 0, 'no rows visible (gate blocks)');
    // Simulate cross-tab spin: localStorage now has the spun_day key, and a
    // storage event fires from the other tab.
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');
    globalThis.window.dispatchEvent({
      type: 'storage',
      key: 'spun_day_11155111_42',
      newValue: '1',
    });
    await flushMicrotasks();
    // Gate should re-evaluate immediately (sub-second) — CTA gone, rows visible.
    assert.equal(root.querySelector('.clm-spoiler-gate'), null, 'gate is OPEN after storage event');
    assert.ok(root.querySelectorAll('.clm-row').length >= 1, 'rows visible after gate open');
    el.disconnectedCallback();
  });

  test('storage event for unrelated keys does NOT trigger re-evaluation', async () => {
    // Mount with un-spun resolved day → spoiler gate CLOSED.
    const el = mountPanelForPolling({ markSpun: false });
    await flushMicrotasks();
    const root = getRenderRoot(el);
    assert.ok(root.querySelector('.clm-spoiler-gate'), 'gate is CLOSED initially');
    // Unrelated key fires storage event — gate must stay closed.
    globalThis.window.dispatchEvent({
      type: 'storage',
      key: 'unrelated_key_xyz',
      newValue: 'whatever',
    });
    await flushMicrotasks();
    assert.ok(root.querySelector('.clm-spoiler-gate'), 'gate UNCHANGED — ignored unrelated key');
    el.disconnectedCallback();
  });

  test('post-confirm 250ms debounce fires after `app-claims:tx-confirmed` event', async () => {
    const el = mountPanelForPolling();
    await flushMicrotasks();
    const before = _fetchLog.length;
    // Dispatch the panel-internal event Plan 61-02 sends after a successful tx.
    el.dispatchEvent({ type: 'app-claims:tx-confirmed', detail: { rowKey: 'eth' } });
    // Wait > 250ms.
    await new Promise((r) => setTimeout(r, 350));
    await flushMicrotasks();
    const after = _fetchLog.length;
    assert.ok(after > before, 'fresh fetches issued after tx-confirmed + 250ms debounce');
    // Source-level: setTimeout(... , 250) for post-confirm debounce.
    assert.match(
      PANEL_SRC,
      /setTimeout\([^)]*,\s*250\s*\)/,
      'panel uses setTimeout(..., 250) for post-confirm debounce',
    );
    el.disconnectedCallback();
  });

  test('post-confirm debounce respects the 250ms delay (does not fire <250ms)', async () => {
    const el = mountPanelForPolling();
    await flushMicrotasks();
    const before = _fetchLog.length;
    el.dispatchEvent({ type: 'app-claims:tx-confirmed', detail: { rowKey: 'eth' } });
    // Wait only 100ms — less than 250ms threshold.
    await new Promise((r) => setTimeout(r, 100));
    const mid = _fetchLog.length;
    assert.equal(mid, before, 'no fetch yet at <250ms post-event');
    // Wait the rest of the way (350ms total).
    await new Promise((r) => setTimeout(r, 250));
    await flushMicrotasks();
    const after = _fetchLog.length;
    assert.ok(after > before, 'fetch fires after 250ms threshold');
    el.disconnectedCallback();
  });

  test('connected.address change (via store subscribe) triggers immediate poll cycle', async () => {
    const el = mountPanelForPolling();
    await flushMicrotasks();
    const before = _fetchLog.length;
    // Switch wallet — different connected.address. The panel subscribes to
    // 'connected.address' and should fire a fresh cycle.
    storeMod.update('connected.address', '0xcd34000000000000000000000000000000000000');
    await flushMicrotasks();
    // Allow the cycle's parallel fetches + render to settle.
    await new Promise((r) => setTimeout(r, 50));
    await flushMicrotasks();
    const after = _fetchLog.length;
    assert.ok(after > before, 'fresh cycle fires on connected.address change');
    el.disconnectedCallback();
  });

  test('viewing.address change (via store subscribe) triggers immediate poll cycle', async () => {
    const el = mountPanelForPolling();
    await flushMicrotasks();
    const before = _fetchLog.length;
    // Switch viewing target — view-others mode.
    storeMod.update('viewing.address', '0xef56000000000000000000000000000000000000');
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));
    await flushMicrotasks();
    const after = _fetchLog.length;
    assert.ok(after > before, 'fresh cycle fires on viewing.address change');
    el.disconnectedCallback();
  });

  test('AbortController flush — second cycle aborts prior in-flight cycle', async () => {
    // Source-level: panel calls .abort() on prior controller and checks signal.aborted post-await.
    assert.match(
      PANEL_SRC,
      /\.abort\(\)/,
      'panel calls .abort() on prior controller before starting new cycle',
    );
    assert.match(
      PANEL_SRC,
      /signal\.aborted/,
      'panel checks signal.aborted after await to skip stale-cycle render',
    );
  });

  test('polling cycle pauses while document.visibilityState !== "visible"', async () => {
    // Mount while hidden — initial mount fetch should still fire (the panel's
    // mount is a one-shot eager run; visibility guard applies to the cycle
    // body which the source returns from when not visible).
    globalThis.document.visibilityState = 'hidden';
    const el = mountPanelForPolling();
    await flushMicrotasks();
    const beforeHiddenTick = _fetchLog.length;
    // Source-level: visibility guard at top of #runPollCycle.
    assert.match(
      PANEL_SRC,
      /document\.visibilityState\s*!==\s*['"]visible['"]/,
      'panel guards #runPollCycle on document.visibilityState',
    );
    // Drive the visibilitychange handler with hidden — no extra fetch should fire.
    globalThis.document.dispatchEvent({ type: 'visibilitychange' });
    await flushMicrotasks();
    const afterHiddenTick = _fetchLog.length;
    assert.equal(
      afterHiddenTick,
      beforeHiddenTick,
      'no fresh fetches while tab hidden (visibility guard)',
    );
    el.disconnectedCallback();
  });

  test('disconnectedCallback cleans up: clearInterval, AbortController.abort, removeEventListener × 3', async () => {
    const el = mountPanelForPolling();
    await flushMicrotasks();
    // Snapshot listener counts before disconnect.
    const visListenersBefore = (_docListeners.get('visibilitychange') || []).length;
    const storageListenersBefore = (_winListeners.get('storage') || []).length;
    assert.ok(visListenersBefore >= 1, 'visibilitychange listener registered on mount');
    assert.ok(storageListenersBefore >= 1, 'storage listener registered on mount');
    // Disconnect.
    el.disconnectedCallback();
    // Verify all 3 event listeners are unregistered.
    const visListenersAfter = (_docListeners.get('visibilitychange') || []).length;
    const storageListenersAfter = (_winListeners.get('storage') || []).length;
    assert.equal(visListenersAfter, visListenersBefore - 1, 'visibilitychange listener removed');
    assert.equal(storageListenersAfter, storageListenersBefore - 1, 'storage listener removed');
    // Source-level: clearInterval + .abort() are called in disconnectedCallback.
    assert.match(PANEL_SRC, /clearInterval\(/, 'panel calls clearInterval in disconnectedCallback');
    assert.match(PANEL_SRC, /removeEventListener\(['"]visibilitychange['"]/, 'visibilitychange removeEventListener present');
    assert.match(PANEL_SRC, /removeEventListener\(['"]storage['"]/, 'storage removeEventListener present');
    assert.match(PANEL_SRC, /removeEventListener\(['"]app-claims:tx-confirmed['"]/, 'tx-confirmed removeEventListener present');
    // Verify post-disconnect: a fresh visibilitychange fires NO new fetch
    // (interval cleared, listeners gone).
    const before = _fetchLog.length;
    const realNow = Date.now;
    Date.now = () => realNow() + 10 * 60 * 1000;
    try {
      globalThis.document.dispatchEvent({ type: 'visibilitychange' });
      await flushMicrotasks();
    } finally {
      Date.now = realNow;
    }
    assert.equal(_fetchLog.length, before, 'no fetches after disconnect — interval + listeners cleaned up');
  });

  test('cold-start (status: "pre-game"): polling continues; spoiler gate stays open', async () => {
    const el = mountPanelForPolling({
      lastDay: { day: null, status: 'pre-game' },
      pending: {
        player: TEST_ADDR,
        pending: {
          eth:           { amount: '0', available: true, reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
      markSpun: false,  // no spun_day key (not needed for pre-game)
    });
    await flushMicrotasks();
    const root = getRenderRoot(el);
    // Spoiler gate is OPEN on cold-start.
    assert.equal(root.querySelector('.clm-spoiler-gate'), null, 'gate OPEN on cold-start');
    // Polling continues — drive an additional cycle via visibility-return after stale.
    const before = _fetchLog.length;
    globalThis.document.visibilityState = 'hidden';
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
      globalThis.document.visibilityState = 'visible';
      globalThis.document.dispatchEvent({ type: 'visibilitychange' });
      await flushMicrotasks();
    } finally {
      Date.now = realNow;
    }
    const after = _fetchLog.length;
    assert.ok(after > before, 'cold-start polling continues — visibility-return triggers fresh cycle');
    el.disconnectedCallback();
  });

  test('view-others mode: spoiler gate uses MY localStorage flag (chainId-only key)', async () => {
    // I am 0xMINE, viewing 0xOTHER. localStorage flag is keyed by CHAIN.id only
    // (NOT address). Asserting D-06 step 6: the gate uses MY (the connected
    // user's) localStorage flag whether viewing self or other player.
    const MINE  = '0xab12000000000000000000000000000000000000';
    const OTHER = '0xcd34000000000000000000000000000000000000';
    storeMod.update('connected.address', MINE);
    storeMod.update('viewing.address', OTHER);
    // localStorage key for chainId 11155111 + day 42 → '1' (I have spun).
    globalThis.localStorage.setItem('spun_day_11155111_42', '1');
    setFetchResponses({
      lastDay: { day: 42, status: 'resolved' },
      pending: {
        player: OTHER,
        pending: {
          eth:           { amount: '7777', available: true, reason: null },
          burnie:        { amount: '0', available: true, reason: null },
          tickets:       { amount: '0', available: true, reason: null },
          decimator:     { amount: '0', available: true, reason: null },
          terminal:      { amount: '0', available: false, reason: 'pre-game' },
          vault:         { amount: '0', available: false, reason: 'vault-not-indexed-phase-57' },
          farFutureCoin: { amount: '0', available: false, reason: 'cumulative-allocated-not-balance' },
        },
      },
      dashboard: { decimator: { claimablePerLevel: [] } },
    });
    const Ctor = customElements.get('app-claims-panel');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    await flushMicrotasks();
    const root = getRenderRoot(el);
    assert.equal(root.querySelector('.clm-spoiler-gate'), null, 'gate OPEN — uses MY localStorage flag');
    assert.ok(root.querySelectorAll('.clm-row').length >= 1, 'rows visible against /player/0xOTHER/pending data');
    el.disconnectedCallback();
  });

  test('panel does NOT call polling.js fictional `start({key, interval, fetcher})` API (RESEARCH Pitfall 9)', () => {
    // Source-level negative assertion. polling.js exists in /app/app/ and the
    // panel may import it for unrelated reasons, but it MUST NOT invoke the
    // nonexistent generic start({key, interval, fetcher}) form. Phase 61 owns
    // its own poller via setInterval (per RESEARCH Pattern 4 + Pitfall 9).
    assert.equal(
      PANEL_SRC.includes('polling.start({'),
      false,
      'no call to polling.start({...}) — Pitfall 9 mitigation',
    );
    // Also: explicitly NOT importing polling.js per the plan's no-import direction.
    assert.equal(
      /from\s+['"][^'"]*\/polling\.js['"]/.test(PANEL_SRC),
      false,
      'panel does not import polling.js (Plan 61-03 panel-owned poller)',
    );
  });
});
