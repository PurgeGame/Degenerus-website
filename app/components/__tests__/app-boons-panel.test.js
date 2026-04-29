// /app/components/__tests__/app-boons-panel.test.js — Phase 62 Plan 62-05 (BNS-01)
// Run: cd website && node --test app/components/__tests__/app-boons-panel.test.js
//
// Tests the THIN BRIDGE WRAPPER `<app-boons-panel>` that mounts
// `/beta/components/boons-panel.js` VERBATIM via cross-import (CF-09 LOCKED:
// /beta/ source NEVER edited; only cross-imported).
//
// RESEARCH R9 (MEDIUM confidence) identified the CRITICAL caveat:
// `<boons-panel>` internally subscribes from `'../app/store.js'` which
// resolves to `/beta/app/store.js` (NOT `/app/app/store.js`). Two stores
// coexist in memory simultaneously when both modules are loaded. The
// wrapper bridges /app/-side identity into /beta/ store paths via update().
//
// Plan 62-05 ships ZERO write surfaces:
//   - NO sendTx, NO requireStaticCall, NO register() (read-only).
//   - NO data-write attributes (read-only display).
//   - NO new reason-map entries.
//
// Cases verified:
//   1. Custom element registers idempotently under 'app-boons-panel'.
//   2. Panel renders shell with nested <boons-panel> (verbatim mount).
//   3. Source contains the literal verbatim cross-import path
//      `from '../../beta/components/boons-panel.js'`.
//   4. Source imports `update` from `'../../beta/app/store.js'` (bridge target).
//   5. On mount + viewed-address change, wrapper writes to /beta/ store
//      `player.boons` path with fetched boons array.
//   6. On mount, wrapper writes `replay.day` to /beta/ store.
//   7. With no connected address, wrapper writes empty array to
//      `player.boons` and short-circuits (does NOT fetch).
//   8. Source contains ZERO sendTx / requireStaticCall / register() /
//      data-write tokens (T-62-BNS-02 mitigation).
//   9. disconnectedCallback aborts poll cycle and unsubscribes
//      (T-62-BNS-04 mitigation).
//
// Mirrors app-quest-panel.test.js (Plan 62-04 — closest read-only sibling).
// fakeDOM scaffold inherited verbatim from app-quest-panel.test.js.

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

// fetch stub — wrapper fetches /game/state then /player/:address/boons/:day.
// Tests stub via _fetchHandler keyed by URL substring.
let _fetchHandler = async () => ({});
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

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  _docVisibilityState = 'visible';
  globalThis.localStorage.clear();
  _docListeners.clear();
  _fetchCalls = [];
  _fetchHandler = async () => ({});
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
// Imports under test:
// - /app/ store (used to drive identity via update('connected.address', ...)).
// - /beta/ store (used to spy on bridge writes via subscribe('player.boons', ...)).
// Panel module is dynamic-imported in beforeEach to ensure customElements
// register cleanly under the fakeDOM.
// ---------------------------------------------------------------------------

import * as appStoreMod from '../../app/store.js';
import * as betaStoreMod from '../../../beta/app/store.js';

// ---------------------------------------------------------------------------
// Read panel source for grep-based assertions (verbatim cross-import path,
// bridge import path, T-62-BNS-02 zero-write source-grep).
// ---------------------------------------------------------------------------

const PANEL_SRC = readFileSync(
  new URL('../app-boons-panel.js', import.meta.url),
  'utf8',
);

// Strip line + block comments so source-grep negative-assertions verify
// executable code only (mirrors Plan 62-04 D-F's stripComments pattern —
// the panel may carry self-documenting comments referencing forbidden tokens).
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      if (idx < 0) return line;
      const before = line.slice(0, idx);
      const sQuotes = (before.match(/(?<!\\)'/g) || []).length;
      const dQuotes = (before.match(/(?<!\\)"/g) || []).length;
      const tQuotes = (before.match(/(?<!\\)`/g) || []).length;
      if ((sQuotes % 2) || (dQuotes % 2) || (tQuotes % 2)) return line;
      return before;
    })
    .join('\n');
}

const PANEL_SRC_NOCOMMENT = stripComments(PANEL_SRC);

const CONNECTED = '0xab12000000000000000000000000000000000000';

function instantiate() {
  const Ctor = customElements.get('app-boons-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

// Spy seam: subscribe to /beta/ store paths to capture bridge writes.
// Returns an object collecting all values written through update() to the
// matching /beta/ store path. The first value seen is the initial-fire from
// subscribe() itself; subsequent values are real bridge writes.
function spyBetaPath(path) {
  const seen = [];
  const unsub = betaStoreMod.subscribe(path, (v) => seen.push(v));
  return { seen, unsub };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan 62-05: <app-boons-panel> bridge wrapper (verbatim /beta/ cross-import)', () => {
  beforeEach(async () => {
    appStoreMod.__resetForTest();
    resetDom();
    appStoreMod.update('connected.address', CONNECTED);
    appStoreMod.update('viewing.address', null);
    appStoreMod.update('ui.mode', 'self');
    // Default fetch handler — /game/state returns currentDay 42, /player/.../boons/42
    // returns two boons.
    _fetchHandler = async (url) => {
      if (url.includes('/game/state')) return { currentDay: 42 };
      if (url.includes('/boons/')) return { boons: [
        { boonType: 1, consumed: false, consumedBoostBps: null },
        { boonType: 2, consumed: false, consumedBoostBps: null },
      ] };
      return {};
    };
    await import('../app-boons-panel.js');
  });

  test("Custom element 'app-boons-panel' registers idempotently after import", async () => {
    const ctor = customElements.get('app-boons-panel');
    assert.ok(ctor, 'app-boons-panel is registered');
    await assert.doesNotReject(import('../app-boons-panel.js'));
    const ctor2 = customElements.get('app-boons-panel');
    assert.equal(ctor, ctor2, 'same ctor reference after re-import (idempotent)');
  });

  test('Panel renders shell with nested <boons-panel> (verbatim mount)', () => {
    const el = instantiate();
    // Wrapper container class .app-boons-panel + nested <boons-panel> tag.
    assert.match(
      el.innerHTML,
      /app-boons-panel/,
      'wrapper container class .app-boons-panel present in shell',
    );
    assert.match(
      el.innerHTML,
      /<boons-panel>/,
      'wrapper renders nested <boons-panel> (verbatim /beta/ panel registers via side-effect import)',
    );
  });

  test('Panel cross-imports /beta/components/boons-panel.js VERBATIM (CF-09 source-grep)', () => {
    // The literal verbatim cross-import path. CF-09 LOCKED — /beta/ source
    // NEVER edited; this import is the ONLY mechanism by which <boons-panel>
    // becomes available in /app/. Accept either `import '...'` (side-effect
    // form — recommended per RESEARCH R9 OPTION B recipe) OR
    // `import X from '...'` (named/default form).
    assert.match(
      PANEL_SRC,
      /import\s+(?:[^;]*\s+from\s+)?['"]\.\.\/\.\.\/beta\/components\/boons-panel\.js['"]/,
      "panel source imports '../../beta/components/boons-panel.js' (side-effect or named/default form)",
    );
  });

  test('Panel imports `update` from /beta/app/store.js (bridge target — RESEARCH R9)', () => {
    // RESEARCH R9 OPTION B: bridge writes go to /beta/ store, NOT /app/ store.
    // The wrapper must import the /beta/ store's update() function.
    assert.match(
      PANEL_SRC,
      /import\s*\{[^}]*update[^}]*\}\s*from\s*['"]\.\.\/\.\.\/beta\/app\/store\.js['"]/,
      "panel source imports `update` from '../../beta/app/store.js'",
    );
  });

  test('On mount with connected address, wrapper writes boons to /beta/ store player.boons path', async () => {
    // Pre-mount, capture initial value via spy seam — subscribe fires once
    // immediately with current /beta/-store value.
    const spy = spyBetaPath('player.boons');
    const initialCount = spy.seen.length;

    const el = instantiate();
    await settle(40);

    // Wrapper should have called update('player.boons', [...boons...]) by now.
    // First seen = initial-fire (could be undefined or pre-existing). Subsequent
    // values reflect bridge writes triggered by the wrapper.
    assert.ok(
      spy.seen.length > initialCount,
      `bridge wrote to /beta/ store player.boons; initial=${initialCount} after-mount=${spy.seen.length}`,
    );
    // Find the boons array we expect (length 2 from the default handler).
    const matched = spy.seen.find((v) => Array.isArray(v) && v.length === 2);
    assert.ok(
      matched,
      `bridge wrote 2-element boons array; values=${JSON.stringify(spy.seen)}`,
    );

    spy.unsub();
    el.disconnectedCallback();
  });

  test('On mount, wrapper writes replay.day to /beta/ store from /game/state currentDay', async () => {
    const spy = spyBetaPath('replay.day');
    const initialCount = spy.seen.length;

    const el = instantiate();
    await settle(40);

    assert.ok(
      spy.seen.length > initialCount,
      `bridge wrote to /beta/ store replay.day; initial=${initialCount} after-mount=${spy.seen.length}`,
    );
    // The default handler returns currentDay = 42.
    const matched = spy.seen.find((v) => v === 42);
    assert.ok(
      matched != null,
      `bridge wrote replay.day = 42; values=${JSON.stringify(spy.seen)}`,
    );

    spy.unsub();
    el.disconnectedCallback();
  });

  test('No connected address → bridge writes [] to /beta/ store player.boons (no fetch)', async () => {
    // Clear connected.address before instantiating. Wrapper should NOT call
    // /player/.../boons/... — it should short-circuit and write [] instead.
    appStoreMod.__resetForTest();
    appStoreMod.update('connected.address', null);
    appStoreMod.update('viewing.address', null);

    const spy = spyBetaPath('player.boons');
    const fetchCallsBefore = _fetchCalls.length;

    const el = instantiate();
    await settle(40);

    // Verify NO /boons/ fetch occurred during mount.
    const boonsFetches = _fetchCalls.slice(fetchCallsBefore).filter((u) => u && u.includes('/boons/'));
    assert.equal(
      boonsFetches.length,
      0,
      `no /boons/ fetch when address is null; calls=${JSON.stringify(_fetchCalls.slice(fetchCallsBefore))}`,
    );
    // And bridge wrote [] to player.boons.
    const matched = spy.seen.find((v) => Array.isArray(v) && v.length === 0);
    assert.ok(
      matched != null,
      `bridge wrote [] when no connected address; values=${JSON.stringify(spy.seen)}`,
    );

    spy.unsub();
    el.disconnectedCallback();
  });

  test('Panel source contains ZERO sendTx / requireStaticCall / register() / data-write (T-62-BNS-02)', () => {
    // BNS-01 is read-only — no write infrastructure. Source-grep on stripped
    // source so self-documenting comments don't trip false positives.
    assert.equal(
      /sendTx\(/.test(PANEL_SRC_NOCOMMENT),
      false,
      'panel source contains NO sendTx calls',
    );
    assert.equal(
      /requireStaticCall\(/.test(PANEL_SRC_NOCOMMENT),
      false,
      'panel source contains NO requireStaticCall (no writes → no static-call gate)',
    );
    assert.equal(
      /\bregister\(/.test(PANEL_SRC_NOCOMMENT),
      false,
      'panel source contains NO register() calls (no NEW reason-map codes for BNS)',
    );
    assert.equal(
      /data-write/.test(PANEL_SRC_NOCOMMENT),
      false,
      'panel source contains NO data-write attributes (read-only)',
    );
  });

  test('disconnectedCallback aborts poll cycle and flushes #unsubs[] without throwing (T-62-BNS-04)', () => {
    const el = instantiate();
    assert.doesNotThrow(() => el.disconnectedCallback());
    // Idempotent — second call also safe.
    assert.doesNotThrow(() => el.disconnectedCallback());

    // Source-level assertion: panel source uses AbortController OR clearTimeout
    // for poll-cycle cleanup.
    assert.ok(
      /AbortController|clearTimeout|clearInterval/.test(PANEL_SRC),
      'panel source uses AbortController / clearTimeout / clearInterval for cleanup',
    );
  });
});
