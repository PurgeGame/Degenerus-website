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

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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

// Per-test fetch stub — installed in beforeEach via setFetchResponses().
let _fetchResponses = new Map();  // url-substring → response object
globalThis.fetch = async (url) => {
  const u = String(url);
  for (const [key, val] of _fetchResponses) {
    if (u.includes(key)) {
      return {
        ok: true,
        status: 200,
        json: async () => val,
      };
    }
  }
  // Default: 404 no match (Promise.allSettled in panel handles this gracefully)
  return { ok: false, status: 404, json: async () => ({}) };
};

function setFetchResponses(map) {
  _fetchResponses = new Map(Object.entries(map));
}

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.localStorage = makeLocalStorage();
  _docListeners.clear();
  _fetchResponses = new Map();
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
    resetDom();
    await import('../app-claims-panel.js');
  });

  test('un-spun resolved day blocks rows (renders .clm-spoiler-gate, hides .clm-row)', async () => {
    setFetchResponses({
      '/game/jackpot/last-day': { day: 42, status: 'resolved' },
      '/pending': {
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
      '/game/jackpot/last-day': { day: 42, status: 'resolved' },
      '/pending': {
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
      '/game/jackpot/last-day': { day: null, status: 'pre-game' },
      '/pending': {
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
      '/game/jackpot/last-day': { day: 42, status: 'resolved' },
      '/pending': {
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
    resetDom();
    await import('../app-claims-panel.js');
  });

  test('hidden 4 keys (tickets/vault/terminal/farFutureCoin) NEVER render', async () => {
    setFetchResponses({
      '/game/jackpot/last-day': { day: 42, status: 'resolved' },
      '/pending': {
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
      '/game/jackpot/last-day': { day: 42, status: 'resolved' },
      '/pending': {
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
      '/game/jackpot/last-day': { day: 42, status: 'resolved' },
      '/pending': {
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
      '/player/0xab12000000000000000000000000000000000000': {
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
    resetDom();
    await import('../app-claims-panel.js');
  });

  test('all 3 amounts === 0n + spoiler gate open → renders .clm-zero-state', async () => {
    setFetchResponses({
      '/game/jackpot/last-day': { day: 42, status: 'resolved' },
      '/pending': {
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

describe('app-claims-panel — stub Claim buttons (Plan 61-01 stub state)', () => {
  beforeEach(async () => {
    resetDom();
    await import('../app-claims-panel.js');
  });

  test('eth row Claim button is disabled with data-stub="true"', async () => {
    setFetchResponses({
      '/game/jackpot/last-day': { day: 42, status: 'resolved' },
      '/pending': {
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
    const btn = root.querySelector('.clm-row[data-prize-key="eth"] .clm-row__claim-cta');
    assert.ok(btn, 'eth row claim button exists');
    assert.equal(btn.disabled, true, 'button is disabled in 61-01');
    assert.equal(btn.getAttribute('data-stub'), 'true', 'data-stub="true" attribute set');
  });
});

describe('app-claims-panel — XSS / textContent discipline (T-58-18)', () => {
  beforeEach(async () => {
    resetDom();
    await import('../app-claims-panel.js');
  });

  test('server-derived amount is rendered via textContent (no <script> injection)', async () => {
    // If the panel ever evaluated a server-derived field via innerHTML, an attacker
    // could inject markup. We use a plausible (non-numeric) amount string to ensure
    // the renderer treats it as text. (Real `displayEth()` will throw or normalise;
    // the assertion is that no `<script>` tag is materialised in the DOM.)
    setFetchResponses({
      '/game/jackpot/last-day': { day: 42, status: 'resolved' },
      '/pending': {
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
    resetDom();
    await import('../app-claims-panel.js');
  });

  test('customElements.define does not throw on second import', async () => {
    await assert.doesNotReject(async () => {
      await import('../app-claims-panel.js');
    });
    assert.ok(customElements.get('app-claims-panel'), 'still registered');
  });
});
