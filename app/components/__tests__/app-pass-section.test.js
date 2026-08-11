// /app/components/__tests__/app-pass-section.test.js — Phase 62 Plan 62-02 (BUY-02 + BUY-03)
// Run: cd website && node --test app/components/__tests__/app-pass-section.test.js
//
// Tests <app-pass-section> Custom Element: whale row + focused deity picker + buy
// handlers + view-mode disable hook (data-write attribute) + error rendering via
// textContent (T-58-18) + NEVER optimistic balance subtraction (CF-06 / D-05) + click
// debouncing (#busyWhale + #busySymbols Set) + CONTEXT D-05 LOCKED 'E' override on
// deity-pass path (deityPassErrorOverride applied at panel level).
//
// Mirrors app-decimator-panel.test.js fakeDOM scaffold (verbatim port).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (verbatim port of app-decimator-panel.test.js — Phase 62 Plan 62-01).
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
import * as passesMod from '../../app/passes.js';
import * as contractsMod from '../../app/contracts.js';

const PANEL_SRC = readFileSync(
  new URL('../app-pass-section.js', import.meta.url),
  'utf8',
);
const INDEX_HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const STATUS_CSS = readFileSync(new URL('../../styles/status-indicators.css', import.meta.url), 'utf8');
const DEITY_CSS = readFileSync(new URL('../../styles/deity-pass-purchase.css', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Fake contract harness
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) { return { status: 1, hash: '0xreceipt', logs: logs || [] }; }
function makeFakeTx(receipt) { return { hash: '0xtx', wait: async () => receipt }; }

function makeFakePassContract(opts = {}) {
  const calls = {
    purchaseWhalePass: [],
    purchaseDeityPass: [],
    subscribe: [],
    depositAfkingFunding: [],
    afkingFundingOf: [],
    withdrawAfkingFunding: [],
    claimAfkingFlip: [],
    smite: [],
  };
  const stk = (name) => async () => {
    if (opts.staticCallShouldRevert?.[name]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[name] || 'E' };
      throw err;
    }
  };
  return {
    purchaseWhalePass: Object.assign(
      async (...args) => {
        calls.purchaseWhalePass.push(args);
        return makeFakeTx(makeFakeReceipt(opts.purchaseWhalePassLogs));
      },
      { staticCall: stk('purchaseWhalePass') }
    ),
    purchaseDeityPass: Object.assign(
      async (...args) => {
        calls.purchaseDeityPass.push(args);
        return makeFakeTx(makeFakeReceipt(opts.purchaseDeityPassLogs));
      },
      { staticCall: stk('purchaseDeityPass') }
    ),
    subscribe: Object.assign(
      async (...args) => {
        calls.subscribe.push(args);
        return makeFakeTx(makeFakeReceipt());
      },
      { staticCall: stk('subscribe') }
    ),
    depositAfkingFunding: Object.assign(
      async (...args) => {
        calls.depositAfkingFunding.push(args);
        return makeFakeTx(makeFakeReceipt());
      },
      { staticCall: stk('depositAfkingFunding') }
    ),
    afkingFundingOf: async (...args) => {
      calls.afkingFundingOf.push(args);
      return opts.afkingFundingWei ?? 0n;
    },
    withdrawAfkingFunding: Object.assign(
      async (...args) => {
        calls.withdrawAfkingFunding.push(args);
        return makeFakeTx(makeFakeReceipt());
      },
      { staticCall: stk('withdrawAfkingFunding') }
    ),
    claimAfkingFlip: Object.assign(
      async (...args) => {
        calls.claimAfkingFlip.push(args);
        return makeFakeTx(makeFakeReceipt());
      },
      { staticCall: stk('claimAfkingFlip') }
    ),
    smite: Object.assign(
      async (...args) => {
        calls.smite.push(args);
        return makeFakeTx(makeFakeReceipt());
      },
      { staticCall: stk('smite') }
    ),
    interface: { parseLog: () => null },
    connect(_signer) { return this; },
    _calls: calls,
  };
}

function makeUnmintedDeityError() {
  const error = new Error('execution reverted: InvalidToken()');
  error.data = '0xc1ab6dc1';
  return error;
}

function makeFakeDeityReadContract(owners = new Map()) {
  const normalized = owners instanceof Map
    ? owners
    : new Map(Object.entries(owners).map(([id, owner]) => [Number(id), owner]));
  return {
    name: async () => 'Degenerus Deity Pass',
    ownerOf: async (symbolId) => {
      const id = Number(symbolId);
      if (normalized.has(id)) return normalized.get(id);
      throw makeUnmintedDeityError();
    },
  };
}

function makeFakeProvider(addr) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => addr }),
  };
}

const CONNECTED = '0xab12000000000000000000000000000000000000';

function instantiate() {
  const Ctor = customElements.get('app-pass-section');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan 62-02: <app-pass-section> Custom Element', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    storeMod.update('ui.chainOk', true);
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    passesMod.__setContractFactoryForTest(() => makeFakePassContract());
    passesMod.__setDeityReadContractFactoryForTest(() => makeFakeDeityReadContract());
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 0n },
      game: {
        subInfo: async () => [false, 0n, 0n, 0n],
        afkingSnapshot: async () => [0n, false, [], []],
      },
    }));
    await import('../app-pass-section.js');
  });

  afterEach(() => {
    for (const child of [..._docBody.children]) {
      try { child.disconnectedCallback?.(); } catch (_) { /* defensive */ }
    }
    passesMod.__resetContractFactoryForTest();
    passesMod.__resetDeityReadContractFactoryForTest();
    passesMod.__resetAfkingReadContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test("Custom element 'app-pass-section' registers idempotently", async () => {
    const ctor = customElements.get('app-pass-section');
    assert.ok(ctor, 'app-pass-section is registered');
    await assert.doesNotReject(import('../app-pass-section.js'));
    const ctor2 = customElements.get('app-pass-section');
    assert.equal(ctor, ctor2, 'same ctor reference after re-import (idempotent)');
  });

  test('Panel puts Lazy above Whale and moves Deity symbol choice into a focused dialog', () => {
    const el = instantiate();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    assert.doesNotMatch(
      el.innerHTML,
      /pass-desk-header|<h2>PASSES<|Long-term perks, daily powers, and automated play/,
      'the outer AFKING PASSES bar is the only generic pass heading',
    );
    assert.ok(
      el.innerHTML.indexOf('pass-product-row--lazy') < el.innerHTML.indexOf('pass-product-row--whale'),
      'the shorter Lazy product is offered before Whale',
    );
    const whaleBuyBtn = el.querySelector('.pass-whale-buy');
    assert.ok(whaleBuyBtn, 'whale buy CTA rendered');
    assert.ok(el.querySelector('[data-bind="pass-deity-open"]'), 'single priced Deity opener rendered');
    assert.equal(el.querySelector('[data-bind="pass-deity-dialog"]').hidden, true,
      'symbol picker starts closed');
    assert.ok(el.querySelector('[data-bind="pass-deity-symbol-grid"]'), 'dialog owns the symbol grid');
    assert.ok(el.querySelector('[data-bind="pass-deity-buy"]'), 'dialog keeps a final buy confirmation');
    for (const product of ['whale', 'lazy', 'deity']) {
      assert.match(el.innerHTML, new RegExp(`<boon-product-indicator product="${product}"`));
    }
  });

  test('each pass has concise visible purpose copy and a compact identity mark', () => {
    const el = instantiate();
    const descriptions = [
      'One ticket every level for the next 10 levels.',
      'One ticket every other level for the next 100 levels.',
      '15 entries every level and three boons per day forever.',
    ];
    for (const copy of descriptions) assert.match(el.innerHTML, new RegExp(copy.replace('+', '\\+')));
    assert.match(el.innerHTML, /AFKING SUBSCRIPTION/);
    assert.match(el.innerHTML, /NO AUTOMATIC ORDER/,
      'the compact AFKING identity prioritizes current state over explanatory copy');
    assert.equal(el.querySelectorAll('.pass-product-sigil').length, 3,
      'Whale, Lazy, and AFKing retain compact code-native sigils');
    assert.match(el.innerHTML,
      /class="pass-deity-wordmark" src="\/app\/assets\/deity-pass-wordmark-v1\.png"[^>]*alt="Deity Pass"/,
      'Deity uses its dedicated art-directed title instead of a generic infinity tile');

    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css, /\.pass-product-row--whale\s*\{[^}]*linear-gradient/s);
    assert.match(css, /\.pass-product-row--lazy\s*\{[^}]*linear-gradient/s);
    assert.match(DEITY_CSS, /\.pass-deity-wordmark\s*\{[^}]*width:\s*min\(13\.75rem, 100%\)/s);
    assert.doesNotMatch(css, /\.pass-product-row:hover\s*\{[^}]*translateY/s,
      'hovering a pass cannot move the whole bar');
    assert.match(css,
      /\.pass-product-quantity\s*\{[^}]*height:\s*2\.15rem[\s\S]*?\.pass-product-row--whale \.pass-whale-buy\s*\{[^}]*height:\s*2\.15rem/s,
      'Whale quantity and Buy controls share a desktop height');
    assert.match(css, /\.pass-product-checkout--whale\s*\{[^}]*align-items:\s*center/s,
      'Whale quantity and Buy are vertically centered');
    assert.match(css,
      /@media \(max-width:\s*640px\)[\s\S]*?\.pass-product-checkout--whale\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*?\.pass-product-checkout--whale \.pass-product-quantity\s*\{[^}]*grid-template-columns:\s*auto minmax\(3rem, 1fr\) 5\.5rem/s,
      'the phone checkout gives quantity a full-width row with two large step controls');
    assert.match(css,
      /\.pass-product-row \.pass-whale-input\s*\{[^}]*min-width:\s*0[^}]*height:\s*2\.15rem[^}]*max-height:\s*2\.15rem/s,
      'the number input has a bounded height instead of overflowing its quantity shell');
    assert.match(el.innerHTML, /name="pass-whale-qty"[^>]*inputmode="numeric"[^>]*pattern="\[0-9\]\*"/,
      'phones receive the numeric keypad for Whale quantity');
    assert.ok(el.querySelector('[data-bind="pass-whale-qty-up"]'),
      'the styled quantity instrument has an explicit up arrow');
    assert.ok(el.querySelector('[data-bind="pass-whale-qty-down"]'),
      'the styled quantity instrument has an explicit down arrow');
    assert.match(css,
      /\.pass-afking__wallet\s*\{[^}]*width:\s*100%[^}]*flex-wrap:\s*wrap/s,
      'the AFKing wallet controls can wrap cleanly on a phone');
    assert.match(css,
      /\.pass-afking__withdraw\s*\{[^}]*min-width:\s*7rem[^}]*max-width:\s*100%/s,
      'WITHDRAW ALL keeps enough button width without overflowing');
  });

  test('Deity purchase styling keeps the shelf compact and the symbol dialog aligned', () => {
    assert.match(INDEX_HTML, /\/app\/styles\/deity-pass-purchase\.css/,
      'the focused Deity override loads after the main application stylesheet');
    assert.match(DEITY_CSS,
      /\.pass-deity-summary\s*\{[^}]*grid-template-columns:\s*minmax\(18rem, 1fr\)[^}]*10\.5rem/s,
      'desktop shelf reserves one deliberate column for the priced opener');
    assert.match(DEITY_CSS,
      /\.pass-deity-summary \.pass-product-perks--deity > \.pass-deity-lootbox-perk\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*grid-row:\s*1[^}]*width:\s*100%[^}]*justify-content:\s*center/s,
      'the bonus Luckbox is centered across its own complete perk row');
    assert.match(DEITY_CSS,
      /\.pass-deity-dialog\s*\{[^}]*position:\s*fixed[^}]*place-items:\s*center/s,
      'symbol choice uses a focused modal rather than an expanding inline shelf');
    assert.match(DEITY_CSS,
      /\.pass-deity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(8, minmax\(0, 1fr\)\)/s,
      'desktop categories retain eight stable symbol slots');
    assert.match(DEITY_CSS,
      /\.pass-deity-symbol img\s*\{[^}]*width:\s*min\(3\.55rem, 94%\)[^}]*height:\s*min\(3\.55rem, 94%\)/s,
      'deity badges use the available tile instead of the old tiny icon cap');
    assert.match(DEITY_CSS,
      /@media \(max-width: 640px\)[\s\S]*?\.pass-deity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s,
      'phone categories fold to four equally sized symbol slots');
  });

  test('closed AFKING drawer summarizes the subscription, prepaid days, Deity art, and active pass', async () => {
    const {
      activePassSummary,
      afkingClosedSummary,
      inferActiveWhalePassCount,
    } = await import('../app-pass-section.js');
    const tickets = Array.from({ length: 12 }, (_unused, index) => ({
      level: 101 + index,
      entryCount: (101 + index) % 2 === 0 ? 8 : 4,
    }));
    assert.equal(inferActiveWhalePassCount(tickets, 100), 3,
      'the two Whale parity lanes preserve a stacked quantity');
    assert.deepEqual(activePassSummary({
      scoreBreakdown: { passBonus: { kind: 'whale_100', points: 40 } },
      tickets,
    }, 100), {
      kind: 'whale',
      sigil: '100',
      label: '3 ACTIVE WHALE PASSES',
    });
    const twoWhaleStreams = Array.from({ length: 12 }, (_unused, index) => ({
      level: 101 + index,
      entryCount: 4,
    }));
    assert.deepEqual(activePassSummary({
      scoreBreakdown: { passBonus: { kind: 'deity', points: 80 } },
      tickets: twoWhaleStreams,
    }, 100), {
      kind: 'whale',
      sigil: '100',
      label: '2 ACTIVE WHALE PASSES',
    }, 'Deity score precedence does not hide two active Whale ticket streams');
    assert.equal(inferActiveWhalePassCount([{ level: 101, entryCount: 4 }], 100), 0,
      'one ordinary future ticket is not mislabeled as a Whale pass');
    assert.equal(activePassSummary({
      scoreBreakdown: { passBonus: { kind: 'whale_10', points: 10 } },
    }, 100)?.label, 'ACTIVE LAZY PASS');
    assert.deepEqual(afkingClosedSummary({
      active: true,
      hasToken: true,
      dailyQuantity: 2,
      settingsKnown: true,
      useTickets: false,
      fundingWei: 400n,
    }, 40n), {
      subscription: 'SUB ACTIVE: 2 LUCKBOX',
      funding: 'FUNDED FOR: 5 DAYS',
      fundedDays: 5n,
    });
    assert.match(INDEX_HTML, /data-bind="pass-summary-deity-badge"/);
    assert.match(STATUS_CSS, /\.more-ways__deity-art\s*\{[^}]*clip-path:/s,
      'the closed strip retains the small spiked Deity-ticket treatment');
    assert.match(STATUS_CSS,
      /\.more-ways__deity-ticket\[data-symbol="ethereum"\][^{]*\.more-ways__deity-art img\s*\{[^}]*width:\s*84%[^}]*height:\s*84%/s,
      'the compact God of Ethereum portrait enlarges its unusually small source glyph');
    assert.match(STATUS_CSS, /\.more-ways\[open\][^{]*\.more-ways__summary-closed\s*\{[^}]*display:\s*none/s,
      'summary details disappear when the full pass desk is open');
    assert.match(STATUS_CSS,
      /@media \(max-width: 620px\)[\s\S]*?\.more-ways__summary-closed\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[\s\S]*?\.more-ways__sub-state\s*\{[^}]*grid-column:\s*1 \/ -1/s,
      'Whale/Lazy and Deity pass summaries share one line beneath subscription state');
    assert.match(STATUS_CSS,
      /\.more-ways__sub-state\s*\{[^}]*min-height:\s*2\.15rem[\s\S]*?\.more-ways__sub-state > b\s*\{[^}]*min-height:\s*2\.15rem/s,
      'subscription coverage uses the same height as the neighboring Deity and Whale chips');
  });

  test('premium pass cards state their contract-backed bonuses and elevate live pricing', () => {
    const el = instantiate();
    for (const benefit of [
      '+85% DEGEN RATING',
      '+115% DEGEN RATING', '+155% DEGEN RATING', 'BONUS LUCKBOX',
      'three boons per day forever', 'AFKING SEAT',
    ]) {
      assert.match(el.innerHTML, new RegExp(benefit.replace(/[+]/g, '\\+')));
    }
    assert.doesNotMatch(el.innerHTML, /PASS PRICE|UNIT PRICE|pass-(?:whale|lazy)-price/,
      'Whale and Lazy put their final price directly in the purchase action');
    assert.match(el.innerHTML, /data-bind="pass-deity-open"/,
      'Deity puts live price directly in its only shelf action');
    assert.match(el.innerHTML, /data-bind="pass-whale-lootbox"/,
      'the Whale card promotes its bundled lootbox as a first-class bonus');
    assert.match(el.innerHTML, /data-bind="pass-lazy-lootbox"/,
      'the Lazy card promotes its bundled lootbox as a first-class bonus');
    assert.match(el.innerHTML, /data-bind="pass-deity-lootbox"/,
      'the Deity card uses the same concrete bonus-lootbox treatment');
    assert.doesNotMatch(el.innerHTML, />1 TICKET \/ 2 LEVELS</,
      'the Whale description already explains its ticket cadence');
    assert.doesNotMatch(el.innerHTML, />1 TICKET \/ LEVEL</,
      'the Lazy description already explains its ticket cadence');

    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css, /\.pass-product-price > strong\s*\{[^}]*font:\s*900 0\.9rem/s,
      'price is treated as a primary instrument, not muted helper text');
    assert.match(css, /\.pass-product-perks > span\s*\{[^}]*border-radius:\s*999px/s,
      'purchase bonuses are compact premium chips');
    assert.match(css, /\.pass-product-perks\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2, max-content\)/s,
      'Whale and Lazy perks share the same desktop grid');
    assert.match(css, /\.pass-product-perks > \.pass-lootbox-perk\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*justify-self:\s*start/s,
      'both bonus-lootbox bubbles occupy the same aligned grid line');
  });

  test('Whale pass shows the concrete bundled lootbox value and follows quantity', async () => {
    _fetchHandler = async (url) => String(url).includes('/player/')
      ? { level: 12 }
      : { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false };
    const el = instantiate();
    await settle(40);

    const benefit = el.querySelector('[data-bind="pass-whale-lootbox"]');
    const buy = el.querySelector('[data-bind="pass-whale-buy"]');
    const seat = el.querySelector('[data-bind="pass-whale-afking-seat"]');
    assert.equal(benefit.textContent, 'BONUS LUCKBOX · 0.4 ETH',
      'a standard 4 ETH pass advertises its actual 0.4 ETH lootbox');
    assert.equal(buy.textContent, 'BUY WHALE PASS\n4 ETH',
      'the purchase action puts the final one-pass price on its own line');
    assert.equal(seat.hidden, false, 'a wallet without a seat sees the one-time seat benefit');
    const quantity = el.querySelector('[name="pass-whale-qty"]');
    quantity.value = '2';
    quantity.dispatchEvent({ type: 'input' });
    assert.equal(benefit.textContent, 'BONUS LUCKBOX · 0.8 ETH');
    assert.equal(buy.textContent, 'BUY WHALE PASS\n8 ETH',
      'changing quantity updates the second-line total in the purchase action');

    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css, /\.pass-lootbox-perk\s*\{[^}]*font-size:\s*0\.67rem/s,
      'the bonus receives stronger treatment than an ordinary perk chip');
    el.disconnectedCallback();
  });

  test('Lazy pass uses the Whale-style bubble with its concrete bundled lootbox value', async () => {
    _fetchHandler = async (url) => String(url).includes('/player/')
      ? { level: 1 }
      : { level: 1, phase: 'PURCHASE', jackpotPhaseFlag: false };
    const el = instantiate();
    await settle(40);

    const benefit = el.querySelector('[data-bind="pass-lazy-lootbox"]');
    const buy = el.querySelector('[data-bind="pass-lazy-buy"]');
    assert.equal(benefit.textContent, 'BONUS LUCKBOX · 0.024 ETH');
    assert.equal(buy.textContent, 'BUY LAZY PASS\n0.24 ETH',
      'Lazy puts its final price on a second line just like Whale');
    assert.ok(benefit.classList.contains('pass-lootbox-perk'),
      'Lazy and Whale share the highlighted bonus-lootbox treatment');
    el.disconnectedCallback();
  });

  test('Deity pass shows the concrete bundled Luckbox value like the other passes', async () => {
    _fetchHandler = async (url) => String(url).includes('/player/')
      ? { level: 12 }
      : { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false };
    const el = instantiate();
    await settle(40);

    const benefit = el.querySelector('[data-bind="pass-deity-lootbox"]');
    const buy = el.querySelector('[data-bind="pass-deity-buy"]');
    const opener = el.querySelector('[data-bind="pass-deity-open"]');
    assert.equal(benefit.textContent, 'BONUS LUCKBOX · 2.4 ETH');
    assert.equal(opener.textContent, 'BUY DEITY PASS\n24 ETH',
      'the closed shelf is just a two-line priced purchase action');
    assert.equal(buy.textContent, 'BUY DEITY PASS\n24 ETH',
      'Deity uses the same pass-name / second-line-price action layout');
    assert.ok(benefit.classList.contains('pass-lootbox-perk'),
      'Deity shares the highlighted bonus bubble used by Whale and Lazy');
    el.disconnectedCallback();
  });

  test('pass score benefit includes the player-specific streak and mint-count floors', async () => {
    const { projectedPassScoreGain } = await import('../app-pass-section.js');
    const score = {
      mintLevelStreakPoints: 30,
      mintCountPoints: 20,
      passBonus: null,
    };
    assert.equal(projectedPassScoreGain(score, 10), 35);
    assert.equal(projectedPassScoreGain(score, 40), 65);
    assert.equal(projectedPassScoreGain(score, 80), 105);

    _fetchHandler = async (url) => String(url).includes('/player/')
      ? { scoreBreakdown: score, level: 12 }
      : { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false };
    const el = instantiate();
    await settle(40);
    assert.equal(el.querySelector('[data-bind="pass-lazy-score"]').textContent, '+35% DEGEN RATING');
    assert.equal(el.querySelector('[data-bind="pass-whale-score"]').textContent, '+65% DEGEN RATING');
    assert.equal(el.querySelector('[data-bind="pass-deity-score"]').textContent, '+105% DEGEN RATING');
    el.disconnectedCallback();
  });

  test('a zero projected Degen Rating gain leaves no empty bonus chip', async () => {
    const maxed = {
      mintLevelStreakPoints: 50,
      mintCountPoints: 25,
      passBonus: { points: 80 },
    };
    _fetchHandler = async (url) => String(url).includes('/player/')
      ? { scoreBreakdown: maxed, level: 12 }
      : { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false };
    const el = instantiate();
    await settle(40);
    for (const bind of ['pass-lazy-score', 'pass-whale-score', 'pass-deity-score']) {
      const chip = el.querySelector(`[data-bind="${bind}"]`);
      assert.equal(chip.hidden, true);
      assert.equal(chip.textContent, '');
    }
    el.disconnectedCallback();
  });

  test('Action buttons carry data-write attribute', () => {
    const el = instantiate();
    const whaleBuy = el.querySelector('.pass-whale-buy');
    assert.ok(whaleBuy && whaleBuy.attributes['data-write'] !== undefined,
      'whale buy CTA has data-write');
    const deityBuy = el.querySelector('[data-bind="pass-deity-buy"]');
    assert.ok(deityBuy && deityBuy.attributes['data-write'] !== undefined,
      'deity buy CTA has data-write');
  });

  test('Whale buy click invokes purchaseWhaleBundle with quantity from input', async () => {
    let recordedArgs = null;
    const originalWhale = passesMod.purchaseWhaleBundle;
    // Replace at module level using the contract factory seam — capture args
    // via a stub that mirrors purchaseWhaleBundle's signature.
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhalePass: Object.assign(
        async (...args) => {
          recordedArgs = args;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    const qtyInput = el.querySelector('[name="pass-whale-qty"]');
    assert.ok(qtyInput, 'quantity input rendered');
    qtyInput.value = '3';

    const btn = el.querySelector('.pass-whale-buy');
    btn.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.ok(recordedArgs, 'purchaseWhaleBundle invoked through contract');
    // args = [buyer, quantity, overrides]
    assert.equal(recordedArgs[0], CONNECTED, 'buyer = connected.address');
    assert.equal(recordedArgs[1], 3n, 'quantity = BigInt(3)');

    el.disconnectedCallback();
  });

  test('pass confirmation publishes its receipt bonus lootbox for Pending', async () => {
    const amountWei = 400_000_000_000_000_000n;
    passesMod.__setContractFactoryForTest(() => makeFakePassContract({
      purchaseWhalePassLogs: [{
        parsed: {
          name: 'LootBoxBuy',
          args: { buyer: CONNECTED, index: 23n, amount: amountWei },
        },
      }],
    }));

    const el = instantiate();
    await flushMicrotasks();
    let confirmed = null;
    el.addEventListener('app-pass:tx-confirmed', (event) => { confirmed = event.detail; });
    el.querySelector('[name="pass-whale-qty"]').value = '1';
    el.querySelector('.pass-whale-buy').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(confirmed?.kind, 'whale');
    assert.equal(confirmed?.player, CONNECTED);
    assert.equal(confirmed?.transactionHash, '0xreceipt');
    assert.equal(confirmed?.lootBoxAmountWei, amountWei);
    assert.deepEqual(confirmed?.boxes, [{
      index: 23,
      day: null,
      amountWei,
      hasLootboxLeg: true,
      hasPresaleLeg: false,
    }]);
    el.disconnectedCallback();
  });

  test('Deity dialog symbol selection invokes purchaseDeityPass with symbolId', async () => {
    let recordedArgs = null;
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhalePass: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async (...args) => {
          recordedArgs = args;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await settle(60);

    const opener = el.querySelector('[data-bind="pass-deity-open"]');
    const dialog = el.querySelector('[data-bind="pass-deity-dialog"]');
    opener.dispatchEvent({ type: 'click' });
    assert.equal(dialog.hidden, false, 'priced shelf action opens the symbol picker');
    const select = el.querySelector('[data-bind="pass-deity-select"]');
    const buy = el.querySelector('[data-bind="pass-deity-buy"]');
    assert.ok(select.children.some((option) => option.value === '7'), 'symbol-id=7 option present');
    el.querySelector('[data-symbol-id="7"]').dispatchEvent({ type: 'click' });
    assert.equal(select.value, '7', 'visual symbol tile drives the canonical selection');
    assert.equal(el.querySelector('[data-bind="pass-deity-selected-name"]').textContent, 'GOD OF BITCOIN');
    buy.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.ok(recordedArgs, 'purchaseDeityPass invoked');
    assert.equal(recordedArgs[0], CONNECTED, 'buyer = connected.address');
    assert.equal(recordedArgs[1], 7, 'symbolId = 7');

    el.disconnectedCallback();
  });

  test('Deity dialog keeps taken symbols aligned and prices from the minted count', async () => {
    const otherA = '0x1111000000000000000000000000000000000000';
    const otherB = '0x2222000000000000000000000000000000000000';
    passesMod.__setDeityReadContractFactoryForTest(() => makeFakeDeityReadContract(new Map([
      [2, otherA],
      [7, otherB],
    ])));

    const el = instantiate();
    await settle(60);

    const select = el.querySelector('[data-bind="pass-deity-select"]');
    const ids = select.children.map((option) => option.value);
    assert.equal(ids.length, 30, 'only the 30 available symbols are offered');
    assert.equal(ids.includes('2'), false, 'first minted symbol omitted');
    assert.equal(ids.includes('7'), false, 'second minted symbol omitted');
    assert.equal(ids.includes('8'), true, 'unminted symbol remains available');
    assert.equal(select.disabled, false, 'an available canonical selection remains usable');
    assert.equal(el.querySelectorAll('.pass-deity-symbol').length, 32,
      'all symbols keep stable positions in four category rows');
    assert.equal(el.querySelector('[data-symbol-id="2"]').disabled, true,
      'a taken symbol remains visible but cannot be selected');
    assert.equal(el.querySelector('[data-symbol-id="8"]').disabled, false,
      'an available symbol tile can be selected');
    assert.equal(el.querySelector('[data-bind="pass-deity-buy"]').disabled, false,
      'buy action remains usable');
    assert.equal(
      el.querySelector('[data-bind="pass-deity-open"]').textContent,
      'BUY DEITY PASS\n27 ETH',
      'two issued passes produce the 24 + triangular(2) = 27 ETH quote',
    );

    el.disconnectedCallback();
  });

  test('Deity pass presents the legacy XRP badge as WWXRP', async () => {
    const el = instantiate();
    await settle(60);

    const select = el.querySelector('[data-bind="pass-deity-select"]');
    const wwxrp = select.children.find((option) => option.value === '0');
    assert.equal(wwxrp?.textContent, 'Crypto · WWXRP');

    el.disconnectedCallback();
  });

  test('owned Deity pass leaves the shop while its actions remain above Tickets', async () => {
    passesMod.__setDeityReadContractFactoryForTest(() => makeFakeDeityReadContract(new Map([
      [11, CONNECTED.toUpperCase()],
    ])));

    const el = instantiate();
    await settle(60);

    const select = el.querySelector('[data-bind="pass-deity-select"]');
    const buy = el.querySelector('[data-bind="pass-deity-buy"]');
    const deitySection = el.querySelector('[data-bind="pass-deity-details"]');
    assert.equal(deitySection.hidden, true,
      'the entire owned Deity product leaves the Passes/AFKing shop');
    assert.equal(deitySection.getAttribute('data-deity-owned'), 'true');
    assert.equal(select.hidden, true, 'owned pass no longer renders a selector');
    assert.equal(buy.hidden, true, 'owned pass has no impossible repurchase button');
    assert.equal(el.querySelector('[data-bind="pass-deity-boons"]'), null);
    assert.equal(el.querySelector('[data-bind="pass-deity-curse"]'), null,
      'daily actions no longer live inside the pass/AFKing area');
    for (const bind of ['pass-lazy-score', 'pass-whale-score', 'pass-deity-score']) {
      const score = el.querySelector(`[data-bind="${bind}"]`);
      assert.equal(score.hidden, true, `${bind} is redundant for a Deity holder`);
      assert.equal(score.textContent, '');
    }
    for (const bind of [
      'pass-lazy-afking-seat',
      'pass-whale-afking-seat',
      'pass-deity-afking-seat',
    ]) {
      assert.equal(el.querySelector(`[data-bind="${bind}"]`).hidden, true,
        `${bind} does not advertise a second non-stackable seat`);
    }
    assert.ok(
      INDEX_HTML.indexOf('<app-deity-desk>') < INDEX_HTML.indexOf('<app-tickets-inventory>'),
      'the holder action desk mounts immediately above Tickets',
    );
    assert.ok(
      el.innerHTML.indexOf('data-bind="pass-afking"')
        > el.innerHTML.indexOf('data-bind="pass-deity-details"'),
      'the AFKing subscription is a separate box below the premium passes',
    );

    el.disconnectedCallback();
  });

  test('mobile pass desk keeps AFKING state and daily actions compact while settings use a popup', () => {
    const el = instantiate();
    assert.equal(el.querySelector('[data-bind="pass-shop-heading"]'), null,
      'the redundant PASS SHOP divider is absent');
    assert.ok(el.querySelector('.pass-afking__quick'), 'state, top up, and claim use a compact action rail');
    assert.ok(el.querySelector('[data-bind="pass-afking-dialog"]'), 'setup and editing use a focused dialog');
    assert.ok(el.querySelector('.pass-afking__order-card'), 'subscription order has its own card');
    assert.ok(el.querySelector('.pass-afking__funding-card'), 'initial subscription funding has its own card');
    assert.ok(el.querySelector('.pass-afking__actions'), 'subscription actions have their own row');
    assert.match(el.innerHTML, /DAILY ORDER/);
    assert.match(el.innerHTML, /Runs automatically once per day\./,
      'the subscription states its real daily cadence');
    assert.doesNotMatch(el.innerHTML, /NEXT JACKPOT|\/ JACKPOT|each jackpot begins/i,
      'player-facing subscription copy does not imply one order per jackpot');

    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css,
      /@media \(max-width: 640px\)[\s\S]*?\.pass-product-row \.pass-product-perks\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
      'mobile pass benefits use a stable two-column grid');
    assert.match(css,
      /@media \(max-width: 640px\)[\s\S]*?\.pass-afking__controls\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
      'mobile popup groups stack in one readable column');
    assert.match(css,
      /@media \(max-width: 640px\)[\s\S]*?\.pass-afking__quick\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
      'mobile quick actions use a stable compact grid');
    assert.match(css,
      /\.pass-afking\s*\{[^}]*grid-template-columns:\s*minmax\(17rem, 0\.9fr\) minmax\(26rem, 1\.1fr\)[^}]*align-items:\s*center/s,
      'desktop AFKing state and daily actions share the available horizontal space');
    assert.match(css,
      /\.pass-afking__quick\s*\{[^}]*display:\s*grid[^}]*align-items:\s*center/s,
      'all daily controls share one vertical centerline');
    assert.match(css,
      /\.pass-afking__topup-field,[\s\S]*?\.pass-afking__quick > \.pass-afking__edit\s*\{[^}]*height:\s*2\.2rem;[^}]*min-height:\s*2\.2rem;[^}]*max-height:\s*2\.2rem/s,
      'the top-up field and every adjacent desktop action have exactly the same box height');
    assert.match(css,
      /\.pass-afking__topup-field\s*\{[^}]*margin:\s*0;/s,
      'the inline field resets the shared form-label margin that would shift it above the buttons');
    assert.match(css,
      /\.pass-afking__topup-field input\s*\{[^}]*display:\s*block;[^}]*text-align:\s*right;/s,
      'the input has no inline baseline gap and keeps its amount right-aligned');
    assert.match(css,
      /@media \(max-width: 640px\)[\s\S]*?\.pass-afking__topup-field,[\s\S]*?\.pass-afking__quick > \.pass-afking__edit\s*\{[^}]*height:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;[^}]*max-height:\s*2\.75rem/s,
      'the field grows with the buttons at the mobile touch-size breakpoint');
    assert.match(css,
      /\.pass-afking__dialog\s*\{[^}]*position:\s*fixed[^}]*place-items:\s*center/s,
      'the infrequent editor is a real modal surface');
    assert.match(css,
      /\.pass-afking__actions\s*\{[^}]*grid-column:\s*1 \/ -1/s,
      'save and cancel are grouped away from price metadata');
  });

  test('a pass holder with an auto-minted seat gets compact state and opens setup on demand', async () => {
    // Seats auto-mint with the pass now (GAME _grantSeatCoin -> token mintSeatFor), so there is
    // no claim row and no claim button: holding the seat IS the entry condition.
    passesMod.__setDeityReadContractFactoryForTest(() => makeFakeDeityReadContract(new Map([
      [11, CONNECTED],
    ])));
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 1n },
      game: {
        subInfo: async () => [false, 0n, 0n, 0n],
        afkingSnapshot: async () => [40_000_000_000n, false, [0n], [0n]],
        mintPackedFor: async () => 1n << 154n,
      },
    }));

    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="pass-whale-afking-seat"]').hidden, true,
      'Whale stops advertising an AFKing seat once the non-stackable seat is owned');
    assert.equal(el.querySelector('[data-bind="pass-afking"]').hidden, false,
      'seat holder sees the AFKing area');
    assert.equal(el.querySelector('[data-bind="pass-afking-claim"]'), null,
      'the claim row is gone entirely');
    assert.equal(el.querySelector('[data-bind="pass-afking-claim-button"]'), null,
      'the claim button is gone entirely');
    assert.equal(el.querySelector('[data-bind="pass-afking-controls"]').hidden, true,
      'the full subscription editor stays out of the inline card');
    assert.equal(el.querySelector('[data-bind="pass-afking-dialog"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="pass-afking-edit"]').textContent, 'SET UP');
    el.querySelector('[data-bind="pass-afking-edit"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="pass-afking-dialog"]').hidden, false,
      'setup opens only when requested');
    assert.equal(el.querySelector('[data-bind="pass-afking-controls"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="pass-afking-save"]').disabled, false,
      'start is not gated on any seat transaction');
    assert.equal(el.querySelector('[data-bind="pass-afking-symbol"]'), null,
      'seat cosmetics are intentionally omitted from the functional editor');

    el.disconnectedCallback();
  });

  test('an existing AFKING holder shows its real state, edits in the popup, and tops up inline', async () => {
    const passContract = makeFakePassContract();
    passesMod.__setContractFactoryForTest(() => passContract);
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 1n },
      game: {
        subInfo: async () => [true, 2n, 8n, 12n],
        afkingSnapshot: async () => [40_000_000_000n, false, [0n], [80_000_000_000n]],
      },
      lens: { subInfoFull: async () => ({ flags: 2n, pendingFlip: 0n }) },
    }));

    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="pass-afking"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="pass-afking-controls"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="pass-afking-current"]').textContent, '2 LUCKBOX / DAY');
    assert.equal(el.querySelector('[data-bind="pass-afking-policy"]').textContent, 'CLAIMABLE FIRST');
    assert.equal(el.querySelector('[data-bind="pass-afking-edit"]').textContent, 'EDIT');
    assert.equal(el.querySelector('[name="pass-afking-topup"]').value, '0.8',
      'the inline top-up starts at ten full days for the configured quantity');
    assert.deepEqual(storeMod.get('app.afkingSubscription'), {
      address: CONNECTED.toLowerCase(),
      known: true,
      active: true,
      fundedDays: 1n,
      dailyQuantity: 2,
      settingsKnown: true,
      useTickets: false,
    }, 'the warning receives the same quantity-aware funded-day snapshot as the closed strip');
    el.querySelector('[data-bind="pass-afking-edit"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="pass-afking-controls"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="pass-afking-mode"]').value, 'lootbox');
    assert.equal(el.querySelector('[name="pass-afking-qty"]').value, '2');
    assert.equal(el.querySelector('[data-bind="pass-afking-initial-funding"]').hidden, true,
      'editing does not duplicate the inline top-up control');
    assert.equal(el.querySelector('[name="pass-afking-fund"]').value, '0');
    assert.match(el.querySelector('[data-bind="pass-afking-funding"]').textContent, /0\.08 ETH/);

    el.querySelector('[data-bind="pass-afking-mode"]').value = 'tickets';
    el.querySelector('[name="pass-afking-qty"]').value = '3';
    el.querySelector('[name="pass-afking-claimable-first"]').checked = false;
    el.querySelector('[data-bind="pass-afking-save"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(passContract._calls.subscribe.length, 1);
    assert.deepEqual(passContract._calls.subscribe[0], [
      CONNECTED,
      false,
      true,
      3,
      '0x0000000000000000000000000000000000000000',
      { value: 0n },
    ]);
    assert.equal(el.querySelector('[data-bind="pass-afking-dialog"]').hidden, true,
      'saving returns to the compact state card');
    assert.equal(el.querySelector('[data-bind="pass-afking-current"]').textContent, '3 TICKETS / DAY');
    assert.equal(el.querySelector('[data-bind="pass-afking-policy"]').textContent, 'PREPAID FIRST');

    const fundInput = el.querySelector('[name="pass-afking-topup"]');
    const fundOnly = el.querySelector('[data-bind="pass-afking-fund-button"]');
    assert.equal(fundOnly.hidden, false, 'an active subscription exposes independent funding');
    fundInput.value = '0.5';
    fundInput.dispatchEvent({ type: 'input' });
    assert.equal(fundOnly.textContent, 'TOP UP',
      'the amount stays in the input instead of being repeated in the button');
    fundOnly.dispatchEvent({ type: 'click' });
    await settle(60);
    assert.deepEqual(passContract._calls.depositAfkingFunding, [[
      '0xAB12000000000000000000000000000000000000',
      { value: 500_000_000_000n },
    ]]);
    assert.equal(passContract._calls.subscribe.length, 1,
      'fund-only top-up does not rewrite the selected subscription settings');
    el.disconnectedCallback();
  });

  test('AFKing explains an RNG settings lock while leaving independent funding available', async () => {
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 1n },
      game: {
        subInfo: async () => [true, 2n, 8n, 12n],
        afkingSnapshot: async () => [40_000_000_000n, true, [0n], [80_000_000_000n]],
      },
      lens: { subInfoFull: async () => ({ flags: 2n, pendingFlip: 0n }) },
    }));

    const el = instantiate();
    await settle(60);

    const notice = el.querySelector('[data-bind="pass-afking-lock"]');
    const dialog = el.querySelector('[data-bind="pass-afking-dialog"]');
    const save = el.querySelector('[data-bind="pass-afking-save"]');
    const cancel = el.querySelector('[data-bind="pass-afking-cancel"]');
    const fundOnly = el.querySelector('[data-bind="pass-afking-fund-button"]');
    assert.equal(dialog.hidden, true);
    assert.ok(
      PANEL_SRC.indexOf('data-bind="pass-afking-lock"')
        > PANEL_SRC.indexOf('data-bind="pass-afking-dialog"'),
      'the RNG explanation lives in the editor instead of interrupting the compact subscription card');
    el.querySelector('[data-bind="pass-afking-edit"]').dispatchEvent({ type: 'click' });
    assert.equal(dialog.hidden, false);
    assert.equal(notice.hidden, false, 'the popup explains why its settings are disabled');
    assert.match(notice.textContent, /RNG SETTLING/);
    assert.equal(save.textContent, 'RNG SETTLING');
    assert.equal(save.disabled, true);
    assert.equal(cancel.disabled, true);
    assert.notEqual(save.getAttribute('data-write-locked'), null,
      'the global signer refresher cannot erase the domain lock');
    assert.notEqual(cancel.getAttribute('data-write-locked'), null);
    assert.equal(fundOnly.disabled, false,
      'fund-only deposits remain usable because they are not contract RNG-locked');
    assert.equal(fundOnly.getAttribute('data-write-locked'), null);

    el.disconnectedCallback();
  });

  test('AFKing can withdraw the connected wallet\'s full funding even while active', async () => {
    const funding = 80_000_000_000n;
    const passContract = makeFakePassContract({ afkingFundingWei: funding });
    passesMod.__setContractFactoryForTest(() => passContract);
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 1n },
      game: {
        subInfo: async () => [true, 2n, 8n, 12n],
        afkingSnapshot: async () => [40_000_000_000n, false, [0n], [funding]],
      },
    }));

    const el = instantiate();
    await settle(60);

    const withdraw = el.querySelector('[data-bind="pass-afking-withdraw"]');
    assert.equal(withdraw.hidden, false);
    assert.equal(el.querySelector('[data-bind="pass-afking-dialog"]').hidden, true,
      'withdrawal is kept out of the everyday inline controls');
    el.querySelector('[data-bind="pass-afking-edit"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="pass-afking-dialog"]').hidden, false);
    assert.equal(withdraw.textContent, 'WITHDRAW ALL');
    assert.match(withdraw.title, /subscription remains active/i);

    withdraw.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.deepEqual(passContract._calls.afkingFundingOf, [[
      '0xAB12000000000000000000000000000000000000',
    ]]);
    assert.deepEqual(passContract._calls.withdrawAfkingFunding, [[funding]]);
    el.disconnectedCallback();
  });

  test('AFKing shows and claims the exact accrued bonus FLIP from its pass area', async () => {
    const passContract = makeFakePassContract();
    passesMod.__setContractFactoryForTest(() => passContract);
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 1n },
      game: {
        subInfo: async () => [true, 2n, 8n, 12n],
        afkingSnapshot: async () => [40_000_000_000n, false, [0n], [0n]],
      },
      lens: { subInfoFull: async () => ({ pendingFlip: 275n }) },
    }));

    const el = instantiate();
    await settle(60);

    const claim = el.querySelector('[data-bind="pass-afking-flip-claim"]');
    assert.equal(claim.hidden, false);
    assert.equal(claim.textContent, 'CLAIM 275 FLIP');
    assert.equal(claim.getAttribute('aria-label'), 'Claim 275 bonus FLIP');
    claim.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.deepEqual(passContract._calls.claimAfkingFlip, [[
      ['0xAB12000000000000000000000000000000000000'],
    ]]);
    assert.equal(claim.hidden, true, 'confirmed claim retires the action immediately');
    el.disconnectedCallback();
  });

  test('AFKing exposes funded ETH for self-withdrawal even without a seat', async () => {
    const funding = 25_000_000_000n;
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 0n },
      game: {
        subInfo: async () => [false, 0n, 0n, 0n],
        afkingSnapshot: async () => [40_000_000_000n, false, [0n], [funding]],
      },
    }));

    const el = instantiate();
    await settle(60);

    assert.equal(el.querySelector('[data-bind="pass-afking"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="pass-afking-controls"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="pass-afking-withdraw"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="pass-afking-status"]').textContent, 'FUNDS ONLY');
    assert.equal(el.querySelector('[data-bind="pass-afking-edit"]').textContent, 'MANAGE');
    el.querySelector('[data-bind="pass-afking-edit"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="pass-afking-controls"]').hidden, false,
      'a funded wallet can reach withdrawal without falsely showing order settings');
    assert.equal(el.querySelector('.pass-afking__order-card').hidden, true);
    el.disconnectedCallback();
  });

  test('AFKing never offers withdrawal while operating another player\'s account', async () => {
    const viewed = '0xcd34000000000000000000000000000000000000';
    storeMod.update('viewing.address', viewed);
    storeMod.update('ui.mode', 'operator');
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => 1n },
      game: {
        subInfo: async () => [true, 2n, 8n, 12n],
        afkingSnapshot: async () => [40_000_000_000n, false, [0n], [80_000_000_000n]],
      },
    }));

    const el = instantiate();
    await settle(60);

    assert.equal(el.querySelector('[data-bind="pass-afking"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="pass-afking-withdraw"]').hidden, true);
    el.disconnectedCallback();
  });

  test("Deity 'E' revert renders 'That symbol's taken — try another.' (CONTEXT D-05 LOCKED)", async () => {
    // Stub purchaseDeityPass to throw a structured 'E' error
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhalePass: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async () => {
          const err = new Error('decoded revert');
          err.code = 'E';
          err.userMessage = 'An unexpected error occurred. Please try again.';
          err.recoveryAction = 'Retry; if it persists, refresh the page.';
          throw err;
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await settle(60);

    const select = el.querySelector('[data-bind="pass-deity-select"]');
    select.value = '7';
    el.querySelector('[data-bind="pass-deity-buy"]').dispatchEvent({ type: 'click' });
    await settle(60);

    const errEl = el.querySelector('.pass-deity-error');
    assert.ok(errEl, '.pass-deity-error element present');
    assert.equal(
      errEl.textContent,
      "That symbol's taken — try another.",
      "deity 'E' revert surfaces CONTEXT D-05 LOCKED override copy via textContent",
    );

    el.disconnectedCallback();
  });

  test("Deity 'NotApproved' revert surfaces standard reason-map text (NOT the override)", async () => {
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhalePass: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async () => {
          const err = new Error('decoded revert');
          err.code = 'NotApproved';
          err.userMessage = 'Operator not approved.';
          err.recoveryAction = 'Connect to your own wallet to act.';
          throw err;
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await settle(60);

    const select = el.querySelector('[data-bind="pass-deity-select"]');
    select.value = '3';
    el.querySelector('[data-bind="pass-deity-buy"]').dispatchEvent({ type: 'click' });
    await settle(60);

    const errEl = el.querySelector('.pass-deity-error');
    assert.ok(errEl, '.pass-deity-error element present');
    assert.equal(
      errEl.textContent,
      'Operator not approved.',
      "non-'E' reverts surface standard reason-map decoded text",
    );
    assert.notEqual(
      errEl.textContent,
      "That symbol's taken — try another.",
      "non-'E' code must NOT trigger the deity override",
    );

    el.disconnectedCallback();
  });

  test('Deity click handler debounced — double-click invokes purchaseDeityPass exactly once', async () => {
    let callCount = 0;
    passesMod.__setContractFactoryForTest(() => ({
      purchaseWhalePass: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      purchaseDeityPass: Object.assign(
        async () => {
          callCount += 1;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await settle(60);

    const select = el.querySelector('[data-bind="pass-deity-select"]');
    select.value = '7';
    const target = el.querySelector('[data-bind="pass-deity-buy"]');
    // Two rapid clicks
    target.dispatchEvent({ type: 'click' });
    target.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(callCount, 1, 'double-click invokes purchaseDeityPass exactly once');

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
    assert.match(
      PANEL_SRC,
      /\.textContent\s*=/,
      'panel source assigns .textContent (T-58-18 hardening)',
    );
  });

  test('Panel source contains 10s + 250ms timing literals (CF-06 + D-05 mirror)', () => {
    assert.match(
      PANEL_SRC,
      /\b10[_]?000\b/,
      'panel source contains 10000 (or 10_000) literal for 10s error auto-clear',
    );
    assert.match(
      PANEL_SRC,
      /\b250\b/,
      'panel source contains 250 literal for post-confirm refetch debounce',
    );
  });

  test('Panel imports deityPassErrorOverride from passes.js', () => {
    assert.match(
      PANEL_SRC,
      /import\s*\{[^}]*deityPassErrorOverride[^}]*\}\s*from\s*['"]\.\.\/app\/passes\.js['"]/,
      'panel imports deityPassErrorOverride from passes.js',
    );
  });

  test('Panel invokes deityPassErrorOverride in deity catch path', () => {
    assert.match(
      PANEL_SRC,
      /deityPassErrorOverride\s*\(/,
      'panel invokes deityPassErrorOverride() helper',
    );
  });

  test('disconnectedCallback flushes #unsubs[] without throwing (idempotent)', () => {
    const el = instantiate();
    assert.doesNotThrow(() => el.disconnectedCallback());
    assert.doesNotThrow(() => el.disconnectedCallback());
  });

  // Account-switcher (2026-07-16) — combined mode hides the buy rows (whale /
  // lazy / deity are per-account writes with no combined-view target) and
  // shows the panel's new identity-style note instead.
  test("mode 'combined' hides the buy rows and shows the per-account note", async () => {
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    const el = instantiate();
    await settle();

    const note = el.querySelector('[data-bind="pass-combined-note"]');
    assert.equal(note.hidden, false, 'combined note visible');
    assert.equal(note.textContent, 'Per-account stat. Pick a single account.');
    assert.equal(el.querySelector('.pass-whale-row').hidden, true, 'whale row hidden');
    assert.equal(el.querySelector('.pass-deity-section').hidden, true, 'deity section hidden');
    assert.equal(el.querySelector('[data-bind="pass-lazy-row"]').hidden, true, 'lazy row hidden');
  });

  test("leaving combined mode restores the buy rows and hides the note", async () => {
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    const el = instantiate();
    await settle();

    storeMod.update('viewing.combined', false);
    storeMod.update('ui.mode', 'self');
    await settle();

    const note = el.querySelector('[data-bind="pass-combined-note"]');
    assert.equal(note.hidden, true, 'combined note hidden again');
    assert.equal(el.querySelector('.pass-whale-row').hidden, false, 'whale row restored');
    assert.equal(el.querySelector('.pass-deity-section').hidden, false, 'deity section restored');
  });
});
