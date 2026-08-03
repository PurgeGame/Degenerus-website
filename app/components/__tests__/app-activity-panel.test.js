// /app/components/__tests__/app-activity-panel.test.js — activity score + streak display
// Run: cd website && node --test app/components/__tests__/app-activity-panel.test.js
//
// Read-only panel reading scoreBreakdown + currentStreak + questStreak from
// /player/:address. Renders the activity-score multiplier, a points meter, quest
// and level streak tiles, and a per-component breakdown — all via textContent
// (T-58-18). Shares the fakeDOM harness verbatim with app-quest-panel.test.js.
//
// Tests Custom Element shell + read-only 2-slot quest display + reward cross-link
// + textContent-only rendering (T-58-18) + ZERO write-surface assertion (T-62-04-NoWrite).
//
// RESEARCH R4 (HIGH confidence) invalidated CONTEXT QST framing — there is NO
// user-facing startQuest / claimQuest contract write. ALL quest progression is
// automatic via internal onlyGame hooks (DegenerusQuests.sol; IDegenerusQuests.sol:46-183).
// Plan 62-04 is PURE UI display reading from /player/:address.quests. ZERO sendTx.
//
// Mirrors app-claims-panel.test.js (on-mount fetchJSON + textContent rendering)
// and app-decimator-panel.test.js (panel-owned poll cycle + visibility re-poll).
// fakeDOM scaffold inherited verbatim from Phase 60/61/62-01 panel tests.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (verbatim port from app-decimator-panel.test.js).
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
        const hrefMatch = /\bhref="([^"]+)"/.exec(attrs);
        if (hrefMatch) child.attributes.href = hrefMatch[1];
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

// fetch stub — panel-owned poll cycle reads /player/:address. Tests stub
// per-case via _fetchHandler; default returns empty quests payload.
let _fetchHandler = async () => ({ player: null, quests: null });
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
  _fetchHandler = async () => ({ player: null, quests: null });
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
// Imports under test — store + (panel module dynamic-imported in beforeEach).
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

// ---------------------------------------------------------------------------
// Read panel source for grep-based assertions (T-62-04-NoWrite + textContent
// + no data-write + reward cross-link).
// ---------------------------------------------------------------------------

const PANEL_SRC = readFileSync(
  new URL('../app-activity-panel.js', import.meta.url),
  'utf8',
);

// Strip line + block comments so source-grep assertions verify executable code,
// not documentation strings that mention forbidden tokens (e.g. CF-08 comment
// "NO toast / NO audio / NO animator" or "NO sendTx, NO requireStaticCall").
// This mirrors Plan 62-03 D-G's scoped-assertion deviation pattern: the test
// intent is "panel does NOT INVOKE sendTx", not "panel source string never
// contains the substring 'sendTx'". Comments carry self-documenting policy.
function stripComments(src) {
  // Remove block comments /* ... */ (greedy-aware).
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments — split per-line, drop everything after the first
  // unescaped // that isn't inside a string literal. Cheap heuristic:
  // tokens we test are ASCII identifiers, not embedded inside string
  // literals, so a simple line-prefix split is sufficient.
  return noBlock
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      if (idx < 0) return line;
      // Crude string-literal awareness: if there are an odd number of
      // unescaped quotes before the //, we're inside a string — keep the line.
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
  const Ctor = customElements.get('app-activity-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

const CONNECTED_ADDR = '0xab12000000000000000000000000000000000000';

function makeScorePayload(overrides = {}) {
  return {
    player: CONNECTED_ADDR,
    scoreBreakdown: {
      totalBps: 87,
      mintLevelStreakPoints: 50,
      questStreakPoints: 5,
      mintCountPoints: 25,
      affiliatePoints: 0,
      cursePoints: 0,
      passBonus: { kind: 'whale_10', points: 10 },
      ...(overrides.scoreBreakdown || {}),
    },
    currentStreak: overrides.currentStreak ?? 15,
    questStreak: overrides.questStreak ?? { baseStreak: 15, lastCompletedDay: 178 },
  };
}

async function mountWith(payload) {
  storeMod.update('connected.address', CONNECTED_ADDR);
  storeMod.update('viewing.address', null);
  _fetchHandler = async () => payload;
  await import('../app-activity-panel.js');
  const el = instantiate();
  await settle();
  return el;
}

describe('<app-activity-panel> activity score + streaks', () => {
  beforeEach(() => {
    storeMod.__resetForTest?.();
    resetDom();
  });

  test('registers idempotently', async () => {
    await import('../app-activity-panel.js');
    const ctor = customElements.get('app-activity-panel');
    assert.ok(ctor, 'app-activity-panel registered');
    await assert.doesNotReject(import('../app-activity-panel.js'));
    assert.equal(customElements.get('app-activity-panel'), ctor, 'same ctor after re-import');
  });

  test('renders the activity score as a decimal multiplier from totalBps points (no cap denom)', async () => {
    const el = await mountWith(makeScorePayload());
    assert.equal(el.querySelector('[data-bind="act-score"]').textContent, '0.87×',
      'totalBps 87 → 0.87× score');
    const sub = el.querySelector('[data-bind="act-score-sub"]').textContent;
    assert.match(sub, /87 pts/, 'points sublabel');
    assert.ok(!/\/\s*300/.test(sub), 'no /300 cap denominator (score is uncapped)');
    el.disconnectedCallback();
  });

  test('no cap meter is rendered (score has no gameplay cap)', async () => {
    const el = await mountWith(makeScorePayload());
    assert.equal(el.querySelector('[data-bind="act-meter-fill"]'), null,
      'meter element removed — no ceiling to fill toward');
    el.disconnectedCallback();
  });

  test('quest streak tile shows the currentStreak count', async () => {
    const el = await mountWith(makeScorePayload());
    assert.equal(el.querySelector('[data-bind="act-quest-streak"]').textContent, '15');
    el.disconnectedCallback();
  });

  test('level streak tile shows mintLevelStreakPoints with a maxed marker at 50', async () => {
    const el = await mountWith(makeScorePayload());
    assert.match(el.querySelector('[data-bind="act-level-streak"]').textContent, /50/);
    el.disconnectedCallback();
  });

  test('breakdown lists each score component with signed point values', async () => {
    const el = await mountWith(makeScorePayload());
    const rows = el.querySelector('[data-bind="act-breakdown"]').children;
    const text = rows.map((r) => r.textContent).join(' | ');
    assert.match(text, /Level streak/);
    assert.match(text, /Quest streak/);
    assert.match(text, /Mint count/);
    assert.match(text, /Whale pass \(10-lvl\)/, 'pass bonus labelled by kind');
    assert.match(text, /\+50/, 'level streak points shown signed');
    assert.match(text, /Quest streak[^|]*\+2/,
      'raw quest streak 5 contributes floor(5 / 2) = 2 score points');
    assert.match(text, /\+10/, 'pass bonus points shown signed');
    el.disconnectedCallback();
  });

  test('negative cashout-curse renders as a distinct negative row', async () => {
    const el = await mountWith(makeScorePayload({ scoreBreakdown: {
      totalBps: 60, mintLevelStreakPoints: 40, questStreakPoints: 5, mintCountPoints: 15,
      affiliatePoints: 0, cursePoints: -12, passBonus: null,
    } }));
    const host = el.querySelector('[data-bind="act-breakdown"]');
    const neg = host.children.find((r) => r.classList.contains('act-row--neg'));
    assert.ok(neg, 'a negative row exists');
    assert.match(neg.textContent, /Cashout curse/);
    assert.match(neg.textContent, /-12/);
    el.disconnectedCallback();
  });

  test('no wallet → prompts to connect (no fetch of /player)', async () => {
    storeMod.__resetForTest?.();
    resetDom();
    storeMod.update('connected.address', null);
    storeMod.update('viewing.address', null);
    await import('../app-activity-panel.js');
    const el = instantiate();
    await settle();
    assert.match(el.querySelector('[data-bind="act-empty"]').textContent, /Connect a wallet/);
    el.disconnectedCallback();
  });

  test('read-only: panel source contains no write surfaces (sendTx / data-write)', () => {
    assert.ok(!/sendTx\s*\(/.test(PANEL_SRC_NOCOMMENT), 'no sendTx call');
    assert.ok(!/data-write/.test(PANEL_SRC_NOCOMMENT), 'no data-write attribute');
  });

  test('disconnectedCallback flushes without throwing', async () => {
    const el = await mountWith(makeScorePayload());
    assert.doesNotThrow(() => el.disconnectedCallback());
    assert.doesNotThrow(() => el.disconnectedCallback());
  });

  // Account-switcher (2026-07-16) — combined mode renders the identity-panel
  // note instead of fetching (scoreBreakdown/questStreak are per-account, not
  // summed by combine.js).
  test("mode 'combined' renders the per-account note via the existing empty-state bind", async () => {
    let fetched = false;
    storeMod.update('connected.address', CONNECTED_ADDR);
    // viewing.combined (not a direct ui.mode override) is the idiomatic
    // combined-mode entry — it also keeps store.js's deriveMode microtask
    // (queued by this write) landing on 'combined' instead of reverting the
    // mode when it eventually fires during the awaits below.
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    _fetchHandler = async () => { fetched = true; return makeScorePayload(); };
    await import('../app-activity-panel.js');
    const el = instantiate();
    await settle();

    const emptyEl = el.querySelector('[data-bind="act-empty"]');
    assert.equal(emptyEl.hidden, false, 'empty-state bind visible in combined mode');
    assert.equal(emptyEl.textContent, 'Per-account stat. Pick a single account.');
    assert.equal(fetched, false, '/player/:address never fetched in combined mode');
    assert.equal(el.querySelector('[data-bind="act-score"]').textContent, '—');
    el.disconnectedCallback();
  });
});
