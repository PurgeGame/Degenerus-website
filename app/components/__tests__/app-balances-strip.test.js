// /app/components/__tests__/app-balances-strip.test.js — Phase 64 follow-up.
// Run: cd website && node --test app/components/__tests__/app-balances-strip.test.js
//
// Tests the fuzzed balances strip:
//   - values blurred (abs-strip--fuzzed) until BOTH reveal gates open:
//     spun_day_* (jackpot scratch) + flip_day_* (the strip's own coin tile)
//   - a day with no coinflip result row waives the flip gate
//   - coin tile writes flip_day_* on click and lands on the day's outcome
//   - tile math: displayEth for claimableEth, whole-token FLIP/DGNRS,
//     tickets = Σ entry counts / 4
//   - same-tab 'jackpot:revealed' re-render unfuzzes without a poll cycle

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as storeMod from '../../app/store.js';

const TEST_ADDR = '0xab12000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Fake DOM — trimmed port of the app-claims-panel.test.js scaffolding
// (Plan 60-01 precedent); covers the element surface the strip uses.
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
    hidden: false,
    disabled: false,
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
        const classMatch = /\bclass="([^"]+)"/.exec(attrs);
        if (classMatch) {
          for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
        }
        if (/\bhidden\b/.test(attrs)) child.hidden = true;
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
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      return child;
    },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
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
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    },
    removeAttribute(k) { delete this.attributes[k]; },
  };
  return el;
}

function matches(el, sel) {
  if (!el) return false;
  if (/^[a-z][a-z0-9-]*$/i.test(sel)) return el.tagName === sel.toUpperCase();
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    if (el.classList && el.classList.contains(cls)) return true;
    if (typeof el.className === 'string' && el.className.split(/\s+/).includes(cls)) return true;
    return false;
  }
  const attrEq = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attrEq) return el.attributes && el.attributes[attrEq[1]] === attrEq[2];
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
  location: { search: '', href: 'http://localhost/', hostname: 'localhost' },
};

globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};

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

// Fetch stub — dispatches on the two routes the strip calls.
let _fetchResponses = { dashboard: null, flipDay: null };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/\/game\/coinflip\/day\/\d+$/.test(u)) {
    if (_fetchResponses.flipDay !== null) {
      return { ok: true, status: 200, json: async () => _fetchResponses.flipDay };
    }
  } else if (/\/player\/0x[0-9a-f]+$/i.test(u)) {
    if (_fetchResponses.dashboard !== null) {
      return { ok: true, status: 200, json: async () => _fetchResponses.dashboard };
    }
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

function setFetchResponses({ dashboard = null, flipDay = null } = {}) {
  _fetchResponses = { dashboard, flipDay };
}

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.localStorage = makeLocalStorage();
  _docListeners.clear();
  _winListeners.clear();
  _fetchResponses = { dashboard: null, flipDay: null };
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function dashboardPayload() {
  return {
    player: TEST_ADDR,
    claimableEth: '10138402069652',            // /1M-scaled testnet wei
    flipBalance: '4526397000000000000000000',  // 4,526,397 FLIP
    dgnrsBalance: '12000000000000000000',      // 12 DGNRS
    tickets: [
      { level: 2, entryCount: 16 },           // entry counts — 16/4 = 4 tickets
      { level: 3, entryCount: 8 },
    ],
    coinflip: { depositedAmount: '0', claimablePreview: '0' },
  };
}

function mountStrip() {
  const Ctor = customElements.get('app-balances-strip');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

// ---------------------------------------------------------------------------

describe('app-balances-strip — fuzz gates + tiles', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    await import('../app-balances-strip.js');
  });

  test('resolved day + no reveals → values fuzzed, hint visible', async () => {
    setFetchResponses({ dashboard: dashboardPayload(), flipDay: { day: 67, win: false, rewardPercent: 96 } });
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });

    const el = mountStrip();
    await flushMicrotasks();

    const strip = el.querySelector('.abs-strip');
    assert.ok(strip, 'strip rendered');
    assert.ok(strip.classList.contains('abs-strip--fuzzed'), 'fuzzed pre-reveal');
    const hint = el.querySelector('[data-bind="abs-hint"]');
    assert.equal(hint.hidden, false, 'hint visible while fuzzed');
    el.disconnectedCallback();
  });

  // User call: the head bar carries Winnings ONLY. FLIP lives on the coinflip
  // widget and the ticket count on the tickets inventory; the strip is not the
  // place to restate them. These assert the drop as intended behaviour, not just
  // the survivor — a FLIP/DGNRS tile reappearing here is a regression.
  test('tile math: Winnings renders via displayEth; FLIP / Tickets / DGNRS are NOT in the strip', async () => {
    setFetchResponses({ dashboard: dashboardPayload(), flipDay: { day: 67, win: false, rewardPercent: 96 } });
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });

    const el = mountStrip();
    await flushMicrotasks();

    const values = el.querySelectorAll('.abs-tile__value').map
      ? el.querySelectorAll('.abs-tile__value')
      : [];
    const texts = values.map((v) => v.textContent);
    // claimableEth 10138402069652 × 1e6 divisor → 10.1384 ETH
    assert.ok(texts.some((t) => /10\.1384 ETH/.test(t)), `winnings via displayEth (got ${texts.join(' | ')})`);
    assert.equal(texts.length, 1, `exactly one tile (got ${texts.join(' | ')})`);
    assert.equal(texts.includes('4,526,397'), false, 'no FLIP tile');
    assert.equal(texts.includes('6'), false, 'no tickets tile');
    assert.equal(texts.includes('12'), false, 'no DGNRS tile');

    const labels = el.querySelectorAll('.abs-tile__label').map((n) => n.textContent);
    assert.deepEqual(labels, ['Winnings']);
    el.disconnectedCallback();
  });

  test('both gates open → unfuzzed; jackpot:revealed re-renders same-tab', async () => {
    setFetchResponses({ dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } });
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });
    globalThis.localStorage.setItem('flip_day_84532_67', '1');

    const el = mountStrip();
    await flushMicrotasks();
    assert.ok(el.querySelector('.abs-strip').classList.contains('abs-strip--fuzzed'),
      'still fuzzed — jackpot gate closed');

    // The scratch completes: last-day-jackpot writes the key + dispatches.
    globalThis.localStorage.setItem('spun_day_84532_67', '1');
    globalThis.document.dispatchEvent({ type: 'jackpot:revealed' });
    await flushMicrotasks();

    assert.equal(el.querySelector('.abs-strip').classList.contains('abs-strip--fuzzed'), false,
      'unfuzzed once both gates open');
    assert.equal(el.querySelector('[data-bind="abs-hint"]').hidden, true, 'hint hidden');
    el.disconnectedCallback();
  });

  test('flip gate: strip stays fuzzed until flip_day key + flip:revealed (coin lives in app-daily-flip)', async () => {
    setFetchResponses({ dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } });
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });
    globalThis.localStorage.setItem('spun_day_84532_67', '1');  // jackpot already scratched

    const el = mountStrip();
    await flushMicrotasks();

    // The coin reveal is app-daily-flip's job now — no coin in the strip.
    assert.equal(el.querySelector('.abs-coin'), null, 'no coin tile in the strip');
    assert.ok(el.querySelector('.abs-strip').classList.contains('abs-strip--fuzzed'),
      'still fuzzed — flip gate closed');

    // app-daily-flip reveals: writes the key + dispatches flip:revealed.
    globalThis.localStorage.setItem('flip_day_84532_67', '1');
    globalThis.document.dispatchEvent({ type: 'flip:revealed' });
    await flushMicrotasks();

    assert.equal(el.querySelector('.abs-strip').classList.contains('abs-strip--fuzzed'), false,
      'strip unfuzzed after the flip reveal');
    el.disconnectedCallback();
  });

  test('no coinflip row for the day → flip gate waived', async () => {
    setFetchResponses({ dashboard: dashboardPayload(), flipDay: null });  // 404
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });
    globalThis.localStorage.setItem('spun_day_84532_67', '1');

    const el = mountStrip();
    await flushMicrotasks();

    assert.equal(el.querySelector('.abs-strip').classList.contains('abs-strip--fuzzed'), false,
      'jackpot gate alone unfuzzes when the day has no flip');
    el.disconnectedCallback();
  });

  test('no dashboard (viewed player fetch fails) → placeholder tiles, no crash', async () => {
    setFetchResponses({ dashboard: null, flipDay: null });
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });

    const el = mountStrip();
    await flushMicrotasks();

    const values = el.querySelectorAll('.abs-tile__value');
    assert.equal(values.length, 1, 'one placeholder tile (Winnings only)');
    assert.ok(values.every((v) => v.textContent === '—'), 'placeholders render em-dash');
    el.disconnectedCallback();
  });

  test('idempotency-guarded define (re-import safe)', async () => {
    await import('../app-balances-strip.js');
    assert.ok(customElements.get('app-balances-strip'), 'defined once, no throw');
  });
});

// Account-switcher (2026-07-16) — mode 'combined' renders tile sums from
// app.playerCombined (combine.js's merged shape) instead of fetching a
// single-address /player dashboard, and never shows the per-account Claim CTA.
describe('app-balances-strip — combined mode (account-switcher)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    await import('../app-balances-strip.js');
  });

  test('tiles render from app.playerCombined sums; /player/:address never fetched', async () => {
    let dashboardFetched = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (/\/player\/0x[0-9a-f]+$/i.test(String(url))) dashboardFetched = true;
      return originalFetch(url);
    };

    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    storeMod.update('app.playerCombined', {
      addresses: [TEST_ADDR, '0xcccc000000000000000000000000000000000003'],
      perAddress: {},
      claimableEth: '20276804139304',              // 2× the single-account fixture
      flipBalance: '9052794000000000000000000',    // 2× 4,526,397 FLIP
      dgnrsBalance: '24000000000000000000',        // 2× 12 DGNRS
      coinflip: { depositedAmount: '0', claimablePreview: '0' },
      decimator: { claimablePerLevel: [], futurePoolTotal: '0' },
      terminal: null,
      tickets: [
        { level: 2, entryCount: 16, owner: TEST_ADDR },
        { level: 3, entryCount: 8, owner: TEST_ADDR },
        { level: 2, entryCount: 8, owner: '0xcccc000000000000000000000000000000000003' },
      ],
    });

    const el = mountStrip();
    await flushMicrotasks();

    const values = el.querySelectorAll('.abs-tile__value');
    const texts = values.map((v) => v.textContent);
    assert.ok(texts.some((t) => /20\.2768 ETH/.test(t)), `combined winnings sum (got ${texts.join(' | ')})`);
    // Head bar is Winnings-only; the combined FLIP/DGNRS/ticket sums are still
    // computed by #tileValuesCombined, just not rendered here.
    assert.equal(texts.length, 1, `one combined tile (got ${texts.join(' | ')})`);
    assert.equal(dashboardFetched, false, '/player/:address never fetched in combined mode');
    assert.equal(el.querySelector('.abs-claim-cta'), null, 'no per-account Claim CTA in combined mode');

    el.disconnectedCallback();
    globalThis.fetch = originalFetch;
  });

  test('leaving combined mode resumes the single-address fetch path', async () => {
    setFetchResponses({ dashboard: dashboardPayload(), flipDay: null });
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    storeMod.update('app.playerCombined', {
      addresses: [TEST_ADDR], perAddress: {}, claimableEth: '0', flipBalance: '0', dgnrsBalance: '0',
      coinflip: null, decimator: { claimablePerLevel: [], futurePoolTotal: '0' }, terminal: null, tickets: [],
    });

    const el = mountStrip();
    await flushMicrotasks();
    assert.ok(el.querySelectorAll('.abs-tile__value').map((v) => v.textContent).some((t) => /0\.0000 ETH/.test(t)),
      'combined zero winnings render');

    storeMod.update('viewing.combined', false);
    storeMod.update('ui.mode', 'self');
    await flushMicrotasks();

    const texts = el.querySelectorAll('.abs-tile__value').map((v) => v.textContent);
    assert.ok(texts.some((t) => /10\.1384 ETH/.test(t)), 'single-address winnings resume after leaving combined');
    el.disconnectedCallback();
  });
});

describe('new-day rollover (codex-found race)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    await import('../app-balances-strip.js');
  });

  test('strip re-fuzzes IMMEDIATELY when a new day arrives (before the refresh lands)', async () => {
    setFetchResponses({ dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } });
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });
    globalThis.localStorage.setItem('spun_day_84532_67', '1');
    globalThis.localStorage.setItem('flip_day_84532_67', '1');

    const el = mountStrip();
    await flushMicrotasks();
    assert.equal(el.querySelector('.abs-strip').classList.contains('abs-strip--fuzzed'), false,
      'day 67 fully revealed → unfuzzed');

    // Day 68 lands — gates are day-scoped, so the fuzz must snap back at
    // once (synchronously, before any fetch settles).
    storeMod.update('app.lastDay', { day: 68, status: 'resolved' });
    assert.ok(el.querySelector('.abs-strip').classList.contains('abs-strip--fuzzed'),
      're-fuzzed synchronously on the new day');
    el.disconnectedCallback();
  });
});
