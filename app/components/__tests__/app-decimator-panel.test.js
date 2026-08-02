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
        for (const attrName of ['data-step-for', 'data-dir']) {
          const attrMatch = new RegExp(`\\b${attrName}="([^"]+)"`).exec(attrs);
          if (attrMatch) child.setAttribute(attrName, attrMatch[1]);
        }
        for (const propName of ['min', 'step', 'value']) {
          const propMatch = new RegExp(`\\b${propName}="([^"]+)"`).exec(attrs);
          if (propMatch) {
            child[propName] = propMatch[1];
            child.attributes[propName] = propMatch[1];
          }
        }
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

// fetch stub — panel-owned poll cycle reads /game/state + /player/:address.
// Tests stub per-case via _fetchHandler; the default serves a game-state
// payload for /game/state (Phase 64: the buy path prices tickets from
// level + jackpotPhaseFlag) and an empty player object otherwise.
const DEFAULT_GAME_STATE = { level: 12, phase: 'JACKPOT', jackpotPhaseFlag: true };
let _fetchHandler = async (url) => (
  String(url).includes('/game/state') ? DEFAULT_GAME_STATE : { player: null, pending: {} }
);
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
  _fetchHandler = async (url) => (
    String(url).includes('/game/state') ? DEFAULT_GAME_STATE : { player: null, pending: {} }
  );
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
import * as claimsMod from '../../app/claims.js';
import { CHAIN } from '../../app/chain-config.js';

// ---------------------------------------------------------------------------
// Read panel source for grep-based assertions (data-write attribute, textContent
// for error rendering, no optimistic subtraction, post-confirm 250ms refetch).
// ---------------------------------------------------------------------------

const PANEL_SRC = readFileSync(
  new URL('../app-decimator-panel.js', import.meta.url),
  'utf8',
);
const APP_CSS = readFileSync(
  new URL('../../styles/app.css', import.meta.url),
  'utf8',
);
const PURCHASE_LEARN_SRC = readFileSync(
  new URL('../../../learn/purchases/index.html', import.meta.url),
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
          { parsed: { name: 'FlipLootBuy', args: { index: txCounter, flipAmount: 1000n * 10n ** 18n, buyer: args[0] } } },
        ]));
      },
      { staticCall: stk('purchaseCoin') }
    ),
    claimableWinningsOf: async () => BigInt(opts.claimableRaw ?? 0n),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
  };
}

function makeFakeFundsClaimContract({ flipWindowOpen = false } = {}) {
  const calls = [];
  const send = (name) => async (...args) => {
    calls.push(['send', name, ...args]);
    return makeFakeTx(makeFakeReceipt([]));
  };
  const simulate = (name, fn = null) => async (...args) => {
    calls.push(['static', name, ...args]);
    if (fn) return fn();
    return undefined;
  };
  return {
    rngLocked: async () => false,
    nextPrizePoolView: async () => flipWindowOpen ? 101n : 100n,
    prizePoolTargetView: async () => 100n,
    claimWinnings: Object.assign(
      send('claimWinnings'),
      { staticCall: simulate('claimWinnings') },
    ),
    claimCoinflips: Object.assign(
      send('claimCoinflips'),
      { staticCall: simulate('claimCoinflips') },
    ),
    redeemFlip: Object.assign(
      send('redeemFlip'),
      {
        staticCall: simulate('redeemFlip', () => {
          if (!flipWindowOpen) throw new Error('E()');
        }),
      },
    ),
    interface: { parseLog: () => null },
    connect(_signer) { return this; },
    _calls: calls,
  };
}

function makeFakeProvider(addr, walletBalance = 3_125_000_000_000n) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => addr }),
    getBalance: async () => walletBalance,
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
    claimsMod.__resetContractFactoryForTest();
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

  test('Panel renders shell with static innerHTML — no server data, header copy "TICKETS"', () => {
    const el = instantiate();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    // Static header copy — Phase 64 basic-mode retitle: gamblers see "TICKETS"
    // (the decimator level-mint mechanics live on under the hood).
    assert.match(
      el.innerHTML.toUpperCase(),
      /TICKETS/,
      'header copy contains TICKETS (static template literal)',
    );
    // No server-derived strings (userMessage / address / amount) bled into innerHTML
    // at mount time. Phase 58 T-58-18 hardening — server data flows via textContent.
    assert.ok(
      !/error\.userMessage|0xab12|userMessage:/i.test(el.innerHTML),
      'no server-derived strings in mount-time innerHTML',
    );
  });

  test('purchase panel has no inline lootbox opener', () => {
    const el = instantiate();
    assert.equal(el.querySelector('app-box-strip'), null);
    el.disconnectedCallback();
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

  test('purchase header uses one accessible overview link with detailed follow-ons', () => {
    const el = instantiate();
    assert.match(
      el.innerHTML,
      /class="dec-purchase-help" href="\/learn\/purchases\/"/,
      'the compact info control opens the purchase overview',
    );
    assert.match(el.innerHTML, /aria-label="Learn about tickets, lootboxes, and foil packs"/);
    for (const href of ['/learn/tickets/', '/learn/lootboxes/', '/learn/foil-packs/']) {
      assert.match(PURCHASE_LEARN_SRC, new RegExp(`href="${href}"`));
    }
    el.disconnectedCallback();
  });

  test('purchase fields use action labels, inputs align right, and stay in one compact mobile row', () => {
    const el = instantiate();
    assert.match(el.innerHTML, /<span>Buy tickets<\/span>/);
    assert.match(el.innerHTML, /<boon-product-indicator product="purchase"/);
    assert.match(el.innerHTML, /<span>Buy lootbox<\/span>/);
    assert.match(el.innerHTML, /<boon-product-indicator product="lootbox"/);
    assert.doesNotMatch(el.innerHTML, /Lootbox value/i);
    assert.match(
      APP_CSS,
      /\.dec-input\s*\{[^}]*text-align:\s*right;/s,
      'numeric input text aligns to the right',
    );
    assert.match(
      APP_CSS,
      /\.dec-input-group\s*\{[^}]*justify-content:\s*space-between;/s,
      'paired controls align their fields at the group edge',
    );
    assert.match(
      APP_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.jackpot-hero \.dec-input-row--pair\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
      'compact purchase fields share one row instead of doubling selector height',
    );
    assert.match(
      APP_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.jackpot-hero \.dec-input-group\s*\{[^}]*grid-template-rows:\s*auto auto[^}]*min-height:\s*3\.65rem/s,
      'each narrow selector moves its label above the field within a bounded card',
    );
    el.disconnectedCallback();
  });

  test('purchase surface uses the tightened compact rhythm without collapsing its controls', () => {
    assert.match(
      APP_CSS,
      /\.jackpot-hero > app-decimator-panel > \.app-decimator-panel\s*\{[^}]*padding:\s*clamp\(0\.68rem,[^;]*0\.82rem\);[^}]*gap:\s*0\.5rem;/s,
      'outer padding and vertical gaps are compact',
    );
    assert.match(
      APP_CSS,
      /\.app-decimator-panel \.dec-input-group\s*\{[^}]*min-height:\s*2\.9rem;/s,
      'input cards remain comfortably taller than their controls',
    );
    assert.match(
      APP_CSS,
      /\.app-decimator-panel \.dec-funds__display\s*\{[^}]*height:\s*3\.55rem;/s,
      'the two digital balance displays shed unused vertical space',
    );
  });

  test('first-purchase affiliate field is prefilled from the saved referral', async () => {
    const referrer = '0x' + 'b'.repeat(40);
    const padded = '0x' + '0'.repeat(24) + 'b'.repeat(40);
    globalThis.localStorage.setItem('affiliate-ref', padded);
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: '0', affiliate: { referrer: null } };
    };

    const el = instantiate();
    await settle(60);
    const row = el.querySelector('[data-bind="dec-affiliate-row"]');
    const input = el.querySelector('[name="dec-affiliate-code"]');
    assert.equal(row.hidden, false, 'field shown for an unassigned player');
    assert.equal(input.value, referrer, 'saved bytes32 address rendered as a friendly address');
    el.disconnectedCallback();
  });

  test('affiliate field stays hidden once the player has an assigned referrer', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return {
        claimableEth: '0',
        affiliate: { referrer: '0x' + 'b'.repeat(40) },
      };
    };

    const el = instantiate();
    await settle(60);
    assert.equal(
      el.querySelector('[data-bind="dec-affiliate-row"]').hidden,
      true,
      'field omitted after assignment',
    );
    el.disconnectedCallback();
  });

  test('edited affiliate address is sent on the first purchase and then hidden', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: '0', affiliate: { referrer: null } };
    };
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const referrer = '0x' + 'b'.repeat(40);
    const expected = '0x' + '0'.repeat(24) + 'b'.repeat(40);

    const el = instantiate();
    await settle(60);
    el.querySelector('[name="dec-affiliate-code"]').value = referrer;
    el.querySelector('[name="dec-tickets"]').value = '1';
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(80);

    assert.equal(fakeContract._calls.purchase.length, 1, 'purchase sent once');
    assert.equal(fakeContract._calls.purchase[0][3], expected, 'edited referral sent as bytes32');
    assert.equal(
      el.querySelector('[data-bind="dec-affiliate-row"]').hidden,
      true,
      'field retires immediately after the confirmed first buy',
    );
    el.disconnectedCallback();
  });

  test('Click handler invokes decimator.purchaseEth (closure form) with ticketQuantity > 0 + lootBoxAmountWei = 0', async () => {
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
    // (lootboxQuantity = 0 means FLIP-side default to 0). Verified via
    // fakeContract._calls.purchase[0] — ticketQuantity*100 (Phase 60 scaling).
    assert.equal(fakeContract._calls.purchase.length, 1, 'purchase called exactly once');
    const args = fakeContract._calls.purchase[0];
    // args = [buyer, ticketQuantity*100n, lootBoxAmountWei, affiliateCode, payKind]
    assert.equal(args[0], CONNECTED, 'buyer = connected address');
    assert.equal(args[1], 2000n, '5 tickets = 20 entries = 2000 purchase units (400 per ticket)');
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

// ===========================================================================
// Combined ticket + lootbox buy (user ask) — one purchase() tx carries both.
// ===========================================================================

describe('combined ticket + lootbox buy', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lootboxMod.__setContractFactoryForTest(() => makeFakePurchaseContract());
    claimsMod.__resetContractFactoryForTest();
    await import('../app-decimator-panel.js');
  });

  test('tickets + lootbox ETH ride ONE purchase() tx (lootBoxAmountWei = ETH input, /1M-descaled)', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '2';
    // No per-box price (user call): the lootbox leg is a free ETH value.
    // 0.03 ETH → 3 × the 0.01 minimum in the deployed contract's wei scale.
    el.querySelector('[name="dec-lootbox-eth"]').value = '0.03';

    el.querySelector('[data-write]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 1, 'single combined tx');
    const args = fakeContract._calls.purchase[0];
    assert.equal(args[1], 800n, '2 tickets = 8 entries = 800 purchase units');
    const { LOOTBOX_MIN_WEI } = await import('../../app/lootbox.js');
    assert.equal(args[2], LOOTBOX_MIN_WEI * 3n, 'lootBoxAmountWei = 0.03 ETH scaled');
    el.disconnectedCallback();
  });

  test('lootbox-only buy (tickets 0) is allowed', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '0';
    el.querySelector('[name="dec-lootbox-eth"]').value = '0.02';

    el.querySelector('[data-write]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 1, 'purchase called');
    const args = fakeContract._calls.purchase[0];
    assert.equal(args[1], 0n, 'zero ticket leg');
    const { LOOTBOX_MIN_WEI } = await import('../../app/lootbox.js');
    assert.equal(args[2], LOOTBOX_MIN_WEI * 2n, 'lootbox leg present');
    el.disconnectedCallback();
  });

  test('both zero → validation error, no tx', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '0';
    el.querySelector('[name="dec-lootbox-eth"]').value = '0';

    el.querySelector('[data-write]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 0, 'no tx');
    const err = el.querySelector('[data-bind="dec-error"]');
    assert.equal(err.hidden, false, 'error shown');
    assert.match(err.textContent, /ticket amount|lootbox/i, 'validation copy');
    el.disconnectedCallback();
  });

  test('below-minimum lootbox ETH (0 < x < 0.01) → validation error, no tx', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '0';
    el.querySelector('[name="dec-lootbox-eth"]').value = '0.005';

    el.querySelector('[data-write]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 0, 'no tx');
    const err = el.querySelector('[data-bind="dec-error"]');
    assert.equal(err.hidden, false, 'error shown');
    assert.match(err.textContent, /Minimum lootbox spend/, 'minimum copy');
    el.disconnectedCallback();
  });

  test('tickets-owned display removed from the buy panel (inventory widget owns it)', async () => {
    const el = instantiate();
    await flushMicrotasks();
    assert.equal(el.querySelector('.dec-balance'), null, 'no owned-count in the buy panel');
    assert.doesNotMatch(el.innerHTML, /<h2>BUY TICKETS<\/h2>/,
      'the redundant purchase heading is gone');
    el.disconnectedCallback();
  });

  test('purchase area omits the verbose payment sentence below Buy', async () => {
    const price = lootboxMod.scaledTicketPriceWei(12);
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      if (u.includes(`/player/${CONNECTED}`)) {
        return { claimableEth: String(price / 2n + 1n) };
      }
      return { player: null, pending: {} };
    };

    const el = instantiate();
    await settle(60);
    const input = el.querySelector('[name="dec-tickets"]');
    input.value = '1';
    input.dispatchEvent({ type: 'input' });

    assert.equal(el.querySelector('[data-bind="dec-payment-note"]'), null);
    assert.doesNotMatch(el.innerHTML, /Claimable winnings are spent first/i);
    el.disconnectedCallback();
  });

  test('purchase footer renders ETH wallet and claimable as two digital displays', async () => {
    const price = lootboxMod.scaledTicketPriceWei(12);
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return {
        claimableEth: String(price / 2n),
        flipBalance: '9000000000000000000000',
        coinflip: { claimablePreview: '1200000000000000000000' },
      };
    };

    const el = instantiate();
    await settle(60);
    const displays = el.querySelectorAll('.dec-funds__display');
    assert.equal(displays.length, 2, 'wallet and claimable each get a dedicated display');
    assert.ok(displays[0].classList.contains('dec-funds__display--claimable'),
      'claimable is the top ETH box');
    assert.ok(displays[1].classList.contains('dec-funds__display--wallet'),
      'wallet is the bottom ETH box');
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-label"]').textContent, 'WALLET');
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet"]').textContent, '3.12 ETH');
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable"]').textContent, '0.02 ETH');
    assert.equal(el.querySelector('[data-bind="dec-funds-claim"]').disabled, false,
      'claim action activates when ETH is claimable');
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-icon"]'), null);
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable-icon"]'), null);
    assert.match(
      APP_CSS,
      /\.dec-funds__value\s*\{[^}]*font-family:[^;]*OCR A Std/s,
      'balance numerals use the digital display font stack',
    );
    assert.match(
      APP_CSS,
      /\.dec-funds\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
      'the purchase displays stay stacked claimable-over-wallet',
    );
    assert.match(
      APP_CSS,
      /\.dec-funds__value\s*\{[^}]*text-align:\s*right/s,
      'ETH figures mirror the right-aligned FLIP ledger hierarchy',
    );
    assert.match(
      APP_CSS,
      /\.dec-funds__display\s*\{[^}]*"priority label"[^}]*"claim value"/s,
      'each ETH title is directly above its amount while controls keep a left lane',
    );
    el.disconnectedCallback();
  });

  test('zero claimable keeps Claim dormant even when the wallet can sign', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: '0', coinflip: { claimablePreview: '0' } };
    };

    const el = instantiate();
    await settle(60);
    const claim = el.querySelector('[data-bind="dec-funds-claim"]');
    assert.equal(claim.disabled, true);
    assert.notEqual(claim.getAttribute('data-write-locked'), null,
      'domain lock prevents the global signer manager from lighting a zero claim');
    assert.match(claim.getAttribute('data-write-lock-title'), /No ETH winnings/i);
    el.disconnectedCallback();
  });

  test('claimable stays blurred and unclaimable until the main jackpot is revealed', async () => {
    storeMod.update('app.lastDay', { day: 67 });
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: String(lootboxMod.scaledTicketPriceWei(12)) };
    };

    const el = instantiate();
    await settle(60);
    const display = el.querySelector('[data-bind="dec-funds-claimable-display"]');
    const value = el.querySelector('[data-bind="dec-funds-claimable"]');
    const claim = el.querySelector('[data-bind="dec-funds-claim"]');
    assert.ok(display.classList.contains('dec-funds__display--spoiler'));
    assert.equal(value.textContent, '•••• ETH', 'the DOM only contains a fixed-length mask');
    assert.doesNotMatch(value.textContent, /\d/, 'the hidden balance cannot leak through blurred digits');
    assert.equal(value.getAttribute('aria-hidden'), 'true', 'screen readers do not receive the spoiler');
    assert.equal(claim.disabled, true, 'claim action cannot bypass the reveal gate');

    globalThis.localStorage.setItem('spun_day_84532_67', '1');
    storeMod.update('app.lastDay', { day: 67 });
    assert.ok(!display.classList.contains('dec-funds__display--spoiler'));
    assert.notEqual(value.textContent, '•••• ETH', 'the real balance is inserted only after reveal');
    assert.match(value.textContent, /ETH$/);
    assert.equal(value.getAttribute('aria-hidden'), null);
    assert.equal(claim.disabled, false);
    assert.match(
      APP_CSS,
      /\.dec-funds__display--spoiler \.dec-funds__value\s*\{[^}]*filter:\s*blur\(0\.38rem\)/s,
    );
    assert.match(
      APP_CSS,
      /\.dec-funds__display--spoiler \.dec-funds__claim\[data-write\][\s\S]*?background:\s*rgba\(0, 0, 0, 0\.16\)[\s\S]*?box-shadow:\s*none/s,
      'Claim has a fixed dormant appearance while the balance is masked',
    );
    el.disconnectedCallback();
  });

  test('funding selectors default to claimable first and wallet selection changes the real buy', async () => {
    const price = lootboxMod.scaledTicketPriceWei(12);
    const fake = makeFakePurchaseContract({ claimableRaw: price * 2n + 1n });
    lootboxMod.__setContractFactoryForTest(() => fake);
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: String(price * 2n + 1n) };
    };

    const el = instantiate();
    await settle(60);
    const walletFirst = el.querySelector('[data-bind="dec-funds-wallet-first"]');
    const claimableFirst = el.querySelector('[data-bind="dec-funds-claimable-first"]');
    assert.equal(claimableFirst.checked, true, 'claimable remains the default preference');
    assert.equal(walletFirst.checked, false, 'only one funding source is selected');

    walletFirst.checked = true;
    walletFirst.dispatchEvent({ type: 'change' });
    assert.equal(walletFirst.checked, true);
    assert.equal(claimableFirst.checked, false, 'funding controls stay mutually exclusive');

    const input = el.querySelector('[name="dec-tickets"]');
    input.value = '1';
    input.dispatchEvent({ type: 'input' });
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(80);

    const [args] = fake._calls.purchase;
    assert.equal(args[4], lootboxMod.MINT_PAYMENT_KIND_DIRECT_ETH,
      'wallet-first sends the direct-ETH payment kind');
    assert.equal(args[6].value, price, 'wallet sends the full ticket cost');
    el.disconnectedCallback();
  });

  test('ETH display claim uses the existing claimWinnings transaction path', async () => {
    const fake = makeFakeFundsClaimContract();
    claimsMod.__setContractFactoryForTest(() => fake);
    _fetchHandler = async (url) => {
      if (String(url).includes('/game/state')) return DEFAULT_GAME_STATE;
      if (String(url).includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: '250000000000', flipBalance: '0', coinflip: null };
    };

    const el = instantiate();
    await settle(60);
    el.querySelector('[data-bind="dec-funds-claim"]').dispatchEvent({ type: 'click' });
    await settle(60);

    const sends = fake._calls.filter((call) => call[0] === 'send' && call[1] === 'claimWinnings');
    assert.deepEqual(sends, [['send', 'claimWinnings', CONNECTED]]);
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('Redeem FLIP mode leaves the ETH footer and ETH claim path unchanged', async () => {
    const fake = makeFakeFundsClaimContract({ flipWindowOpen: true });
    claimsMod.__setContractFactoryForTest(() => fake);
    const claimable = 250_000_000_000n;
    _fetchHandler = async (url) => {
      if (String(url).includes('/game/state')) return DEFAULT_GAME_STATE;
      if (String(url).includes('/foil')) return { present: false, level: 12 };
      return {
        claimableEth: String(claimable),
        flipBalance: String(9_000n * 10n ** 18n),
        coinflip: { claimablePreview: String(1_234n * 10n ** 18n) },
      };
    };

    const el = instantiate();
    await settle(60);
    const mode = el.querySelector('[data-bind="dec-flip-check"]');
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    assert.match(el.querySelector('[data-bind="dec-funds-wallet"]').textContent, /ETH$/);
    assert.match(el.querySelector('[data-bind="dec-funds-claimable"]').textContent, /ETH$/);
    assert.equal(el.querySelector('[data-bind="dec-funds"]').classList.contains('dec-funds--flip'), false);
    el.querySelector('[data-bind="dec-funds-claim"]').dispatchEvent({ type: 'click' });
    await settle(60);

    const ethSends = fake._calls.filter((call) => call[0] === 'send' && call[1] === 'claimWinnings');
    const flipSends = fake._calls.filter((call) => call[0] === 'send' && call[1] === 'claimCoinflips');
    assert.deepEqual(ethSends, [['send', 'claimWinnings', CONNECTED]]);
    assert.deepEqual(flipSends, []);
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('base and bulk FLIP bonuses count whole tickets only', async () => {
    const { purchaseFlipCreditBreakdown } = await import('../app-decimator-panel.js');
    const FLIP = 10n ** 18n;
    assert.equal(
      purchaseFlipCreditBreakdown({ tickets: 0.75 }).total,
      0n,
      'a partial ticket below one gets no base bonus',
    );
    assert.equal(
      purchaseFlipCreditBreakdown({ tickets: 1.25 }).total,
      100n * FLIP,
      'the fractional tail above one does not get base credit',
    );
    assert.equal(
      purchaseFlipCreditBreakdown({ tickets: 10.75 }).total,
      1_500n * FLIP,
      'ten whole tickets earn the base plus bulk credit',
    );
    const price = lootboxMod.scaledTicketPriceWei(12);
    assert.equal(
      purchaseFlipCreditBreakdown({
        priceWei: price,
        totalCostWei: price * 3n,
        mintCostWei: price * 3n,
        // Funding keeps one wei of claimable dust, so +1 lets the full
        // three-price threshold flow into this purchase.
        claimableWei: price * 3n + 1n,
      }).rebuy,
      300n * FLIP,
      'claimable-funded spend at three ticket prices adds the rebuy credit',
    );
    assert.equal(
      purchaseFlipCreditBreakdown({
        priceWei: price,
        totalCostWei: price * 3n,
        mintCostWei: price * 3n,
        claimableWei: price * 3n,
      }).rebuy,
      0n,
      'the reserved dust keeps a just-short claimable slice below the threshold',
    );
  });

  test('Buy and the optional bonus use a stable compact half-width action rail', async () => {
    const el = instantiate();
    await settle(60);
    const input = el.querySelector('[name="dec-tickets"]');
    input.value = '10.75';
    input.dispatchEvent({ type: 'input' });

    const tally = el.querySelector('[data-bind="dec-flip-credit"]');
    assert.equal(tally.hidden, false);
    assert.equal(
      el.querySelector('[data-bind="dec-flip-credit-total"]').textContent,
      '+1,500 FLIP',
    );
    assert.equal(el.querySelectorAll('[data-bind="dec-flip-credit-total"]').length, 1);
    assert.doesNotMatch(tally.textContent, /purchase|bulk|rebuy/i, 'no detailed breakdown');
    assert.match(PANEL_SRC, /\/badges-circular\/flame_red\.svg/);
    assert.match(
      PANEL_SRC,
      /<div class="dec-buy-row">[\s\S]*?data-bind="dec-flip-credit"[\s\S]*?data-bind="dec-buy-cta"/,
      'BONUS sits left of Buy in one action rail',
    );
    assert.match(
      APP_CSS,
      /\.dec-buy-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
      'Buy and BONUS receive equal, non-clipping columns',
    );
    assert.match(
      APP_CSS,
      /\.dec-buy-row\s*>\s*\.dec-buy-cta\s*\{[^}]*width:\s*100%[^}]*height:\s*3rem[^}]*min-height:\s*3rem[^}]*max-height:\s*3rem[^}]*min-width:\s*0/s,
      'the Buy action fills only its half and stays a fixed height',
    );
    assert.match(
      APP_CSS,
      /\.dec-flip-credit\s*\{[^}]*grid-column:\s*1/s,
      'BONUS owns the left half',
    );
    assert.match(
      APP_CSS,
      /\.dec-buy-row\s*>\s*\.dec-buy-cta\s*\{[^}]*grid-column:\s*2/s,
      'Buy owns the right half even while BONUS is hidden',
    );
    assert.match(APP_CSS, /\.dec-flip-credit\s*>\s*img\s*\{[^}]*width:\s*1\.48rem/s);
    assert.match(APP_CSS, /\.dec-flip-credit\s*>\s*span\s*\{[^}]*font-size:\s*0\.7rem/s);
    assert.match(
      APP_CSS,
      /\.dec-buy-cta\[aria-label\$=" ETH"\] \.dec-buy-cta__amount\s*\{[^}]*font-size:\s*0\.84em/s,
      'the ETH quote receives a small second-line emphasis without enlarging FLIP quotes',
    );
    assert.match(
      APP_CSS,
      /\.app-decimator-panel \.dec-buy-row\s*>\s*\.dec-buy-cta\[data-write\]\s*\{[^}]*padding:\s*0\.35rem 0\.55rem/s,
      'the fixed-height two-line action overrides the older single-line CTA padding',
    );

    input.value = '0.75';
    input.dispatchEvent({ type: 'input' });
    assert.equal(tally.hidden, true, 'zero-bonus purchases do not show the tally');
    el.disconnectedCallback();
  });

  test('ticket arrows move one whole ticket while typed quarters stay valid', async () => {
    const el = instantiate();
    await settle(60);

    const input = el.querySelector('[name="dec-tickets"]');
    const up = el.querySelectorAll('.dec-step').find(
      (button) => button.getAttribute('data-step-for') === 'dec-tickets'
        && button.getAttribute('data-dir') === '1',
    );
    const down = el.querySelectorAll('.dec-step').find(
      (button) => button.getAttribute('data-step-for') === 'dec-tickets'
        && button.getAttribute('data-dir') === '-1',
    );
    input.value = '0.25';
    up.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '1.25', 'up adds one whole ticket');
    down.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.25', 'down removes one whole ticket');
    assert.equal(input.step, '0.25', 'typing still accepts entry-sized quarter tickets');
    el.disconnectedCallback();
  });

  test('lootbox arrows step by exactly one current ticket price', async () => {
    const el = instantiate();
    await settle(60);

    const price = el.querySelector('[data-bind="dec-price"]');
    const input = el.querySelector('[name="dec-lootbox-eth"]');
    assert.equal(price.textContent, 'Level 12 Price - 0.04 ETH');
    assert.equal(input.step, '0.04', 'native number arrows use one ticket price');

    const up = el.querySelectorAll('.dec-step').find(
      (button) => button.getAttribute('data-step-for') === 'dec-lootbox-eth'
        && button.getAttribute('data-dir') === '1',
    );
    const down = el.querySelectorAll('.dec-step').find(
      (button) => button.getAttribute('data-step-for') === 'dec-lootbox-eth'
        && button.getAttribute('data-dir') === '-1',
    );
    assert.ok(up && down, 'custom lootbox arrows are wired');
    up.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.04', 'up adds one ticket price');
    down.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0', 'down removes one ticket price and clamps at zero');
    el.disconnectedCallback();
  });

  test('clicking a lootbox quest configures two ticket prices without buying', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    const target = lootboxMod.scaledTicketPriceWei(12) * 2n;
    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: { questType: 6, target: String(target), variant: 'secondary' },
    }));

    assert.equal(el.querySelector('[name="dec-tickets"]').value, '0');
    assert.equal(el.querySelector('[name="dec-lootbox-eth"]').value, '0.08',
      'lootbox mission uses exactly two level-12 ticket prices');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent, 'Buy');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, '0.08 ETH');
    assert.equal(fakeContract._calls.purchase.length, 0, 'quest click only configures the form');
    el.disconnectedCallback();
  });
});

// ---------------------------------------------------------------------------
// Foil pack buy leg — checkbox row, one-per-level ownership, additive pricing.
// DEFAULT_GAME_STATE is level 12 + jackpotPhase → target level 12 →
// ticket price 0.04 ether (÷1M scale), foil = 10× = "0.4 ETH" displayed.
// ---------------------------------------------------------------------------

describe('Foil pack buy leg', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    lootboxMod.__setContractFactoryForTest(() => makeFakePurchaseContract());
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { player: null, pending: {} };
    };
    await import('../app-decimator-panel.js');
  });

  test('foil row stays usable while the indexed ownership read is pending', async () => {
    let releaseFoil;
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return new Promise((resolve) => { releaseFoil = resolve; });
      return { player: null, pending: {} };
    };
    const el = instantiate();
    await flushMicrotasks();
    const row = el.querySelector('[data-bind="dec-foil-row"]');
    assert.equal(row.hidden, false, 'an ownership guess never delays a valid level offer');
    releaseFoil({ present: false, level: 12 });
    await settle(20);
    assert.equal(row.hidden, false, 'the eventual index answer does not move the control');
    el.disconnectedCallback();
  });

  test('unknown foil availability stays usable and lets the contract preflight decide', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) throw new Error('indexer unavailable');
      return { player: null, pending: {} };
    };
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);
    const row = el.querySelector('[data-bind="dec-foil-row"]');
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    assert.equal(row.hidden, false, 'an indexer outage does not suppress a valid offer');
    assert.equal(check.disabled, false);
    check.checked = true;
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(80);
    assert.equal(fakeContract._calls.purchase.length, 1,
      'value-accurate contract preflight passes and the foil purchase is sent');
    assert.equal(fakeContract._calls.purchase[0][5], true, 'foil leg remains selected');
    el.disconnectedCallback();
  });

  test('game-over state suppresses a foil offer even when ownership is clear', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return { ...DEFAULT_GAME_STATE, gameOver: true };
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { player: null, pending: {} };
    };
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-foil-check"]').disabled, true);
    el.disconnectedCallback();
  });

  test('ownership markers cannot poison the current level offer', async () => {
    localStorage.setItem(
      `foil-owned:${CHAIN.id}:${CONNECTED.toLowerCase()}:12`,
      JSON.stringify({ version: 2, level: 12, source: 'receipt', at: Date.now() }),
    );
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'local ownership hints never suppress the contract-preflighted offer');
    el.disconnectedCallback();
  });

  test('foil row is only a checkbox, Add foil pack label, and 10× price', async () => {
    const el = instantiate();
    await settle(60);
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    assert.ok(check, 'foil checkbox rendered');
    assert.equal(check.disabled, false, 'enabled when not owned');
    const price = el.querySelector('[data-bind="dec-foil-price"]');
    assert.equal(price.textContent, '0.4 ETH', '10 × level-12 ticket price');
    assert.match(el.innerHTML, /<span class="dec-foil-label">Add foil pack<\/span>/);
    assert.doesNotMatch(el.innerHTML, /dec-foil-card|dec-foil-sub|dec-foil-shine/,
      'the old promotional card and helper copy are gone');
    el.disconnectedCallback();
  });

  test('an indexed owned hint does not suppress a potentially valid foil purchase', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) {
        assert.match(u, /level=12/, 'ownership checked at the ticket target level');
        return { present: true, level: 12 };
      }
      return { player: null, pending: {} };
    };
    const el = instantiate();
    await settle(60);
    const row = el.querySelector('[data-bind="dec-foil-row"]');
    assert.equal(row.hidden, false, 'stale indexed ownership is informational only');
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    assert.equal(check.disabled, false, 'the contract simulation gets the final say');
    assert.equal(check.checked, false);
    el.disconnectedCallback();
  });

  test('an unfinished foil quest overrides a stale inferred level and keeps its pack available', async () => {
    const checkedLevels = [];
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) {
        const level = Number(new URL(u, 'http://localhost').searchParams.get('level'));
        checkedLevels.push(level);
        return { present: level === 12, level };
      }
      return { player: null, pending: {} };
    };
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'even a stale owned hint cannot suppress the purchase control');

    storeMod.update('ui.foilQuest', {
      active: true,
      completed: false,
      day: 77,
      level: 13,
      address: CONNECTED.toLowerCase(),
    });
    await settle(60);

    assert.ok(checkedLevels.includes(13), 'ownership is re-queried for the quest level');
    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'the quest-completing foil option remains selectable');
    assert.equal(el.querySelector('[data-bind="dec-foil-check"]').disabled, false);
    assert.match(el.querySelector('[data-bind="dec-price"]').textContent, /Level 13/);
    el.disconnectedCallback();
  });

  test('first-day foil quest checks the new level instead of suppressing it with the prior pack', async () => {
    const checkedLevels = [];
    storeMod.update('ui.foilQuest', {
      active: true,
      completed: false,
      day: 6,
      level: 2,
      address: CONNECTED.toLowerCase(),
    });
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) {
        return { level: 1, phase: 'PURCHASE', jackpotPhaseFlag: false };
      }
      if (u.includes('/foil')) {
        const level = Number(new URL(u, 'http://localhost').searchParams.get('level'));
        checkedLevels.push(level);
        return { present: level === 1, level };
      }
      return { player: null, pending: {} };
    };

    const el = instantiate();
    await settle(60);
    assert.ok(checkedLevels.includes(2), 'ownership is checked against the live level-2 quest pack');
    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'the owned level-1 pack cannot hide the level-2 option');
    assert.equal(el.querySelector('[data-bind="dec-foil-check"]').disabled, false);
    assert.match(el.querySelector('[data-bind="dec-price"]').textContent, /Level 2/);
    el.disconnectedCallback();
  });

  test('a foil quest without a resolved purchase level never falls back to level zero', async () => {
    const checkedLevels = [];
    storeMod.update('ui.foilQuest', {
      active: true,
      completed: false,
      day: 77,
      level: null,
      address: CONNECTED.toLowerCase(),
    });
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) {
        const level = Number(new URL(u, 'http://localhost').searchParams.get('level'));
        checkedLevels.push(level);
        return { present: false, level };
      }
      return { player: null, pending: {} };
    };

    const el = instantiate();
    await settle(60);
    assert.ok(checkedLevels.includes(12), 'normal contract-equivalent target remains the fallback');
    assert.equal(checkedLevels.includes(0), false, 'null quest metadata is never coerced to level zero');
    assert.match(el.querySelector('[data-bind="dec-price"]').textContent, /Level 12/);
    el.disconnectedCallback();
  });

  test('an old-level foil response cannot mark the new target level as owned', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: true, level: 11 };
      return { player: null, pending: {} };
    };
    const stale = instantiate();
    await settle(60);
    assert.equal(stale.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'a mismatched response cannot suppress the level-12 offer');
    assert.equal(stale.querySelector('[data-bind="dec-foil-check"]').disabled, false,
      'unknown ownership remains guarded by the contract preflight');
    stale.disconnectedCallback();
    stale.remove();

    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { player: null, pending: {} };
    };
    const current = instantiate();
    await settle(60);
    assert.equal(current.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'the exact new-level answer is not poisoned by the stale response');
    current.disconnectedCallback();
  });

  test('foil-only buy: purchase(foil=true) with msg.value = exact foil cost; 0 tickets allowed', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    const check = el.querySelector('[data-bind="dec-foil-check"]');
    check.checked = true;
    check.dispatchEvent({ type: 'change' });

    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 1, 'purchase called once');
    const args = fakeContract._calls.purchase[0];
    assert.equal(args[1], 0n, 'zero tickets is allowed with foil checked');
    assert.equal(args[2], 0n, 'zero lootbox leg');
    assert.equal(args[5], true, 'foil flag passed');
    // Exact msg.value: 10 × priceForLevel(12)/1M = 4e11 wei (overpay would
    // silently credit afking; underpay reverts DirectEthInsufficient).
    assert.equal(args[6].value, lootboxMod.scaledFoilPackCostWei(12), 'msg.value = exact foil cost');
    el.disconnectedCallback();
  });

  test('buy total label includes the foil leg while checked', async () => {
    const el = instantiate();
    await settle(60);
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    check.checked = true;
    check.dispatchEvent({ type: 'change' });
    const action = el.querySelector('[data-bind="dec-buy-cta-action"]');
    const amount = el.querySelector('[data-bind="dec-buy-cta-amount"]');
    assert.equal(action.textContent, 'Buy');
    assert.equal(amount.textContent, '0.4 ETH', 'foil-only total is on the second line');
    check.checked = false;
    check.dispatchEvent({ type: 'change' });
    assert.equal(action.textContent, 'Buy', 'back to bare Buy when unchecked');
    assert.equal(amount.hidden, true, 'empty amount line collapses when unchecked');
    el.disconnectedCallback();
  });

  test('click-time buy bypasses a stale indexed ownership change', async () => {
    let owned = false;
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: owned, level: 12 };
      return { player: null, pending: {} };
    };
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    const row = el.querySelector('[data-bind="dec-foil-row"]');
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    assert.equal(row.hidden, false, 'initial ownership read says available');
    check.checked = true;
    owned = true; // another tab / earlier receipt lands before this click
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 1,
      'the value-accurate contract preflight, not the changed DB hint, authorizes the send');
    assert.equal(row.hidden, false, 'indexed ownership never retires the option');
    assert.doesNotMatch(el.querySelector('[data-bind="dec-error"]').textContent, /already own/i);
    el.disconnectedCallback();
  });

  test('FoilAlreadyBought preflight blocks the send without poisoning the row', async () => {
    const fakeContract = makeFakePurchaseContract({
      staticCallShouldRevert: { purchase: true },
      staticCallRevertName: { purchase: 'FoilAlreadyBought' },
    });
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    const check = el.querySelector('[data-bind="dec-foil-check"]');
    check.checked = true;
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 0, 'static-call failure prevents send');
    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'a failed attempt does not cache another potentially stale ownership blocker');
    assert.match(el.querySelector('[data-bind="dec-error"]').textContent, /unavailable for this transaction/i);
    el.disconnectedCallback();
  });

  test('FoilPackBought clears the selection without turning receipt state into a future gate', async () => {
    // Fake contract whose purchase receipt carries the FoilPackBought event.
    const calls = { purchase: [] };
    const fakeContract = {
      purchase: Object.assign(
        async (...args) => {
          calls.purchase.push(args);
          return makeFakeTx(makeFakeReceipt([
            { parsed: { name: 'FoilPackBought', args: { buyer: CONNECTED, level: 12n, multBps: 23500n } } },
          ]));
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect(_s) { return this; },
      _calls: calls,
    };
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await settle(60);
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    check.checked = true;
    check.dispatchEvent({ type: 'change' });
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(calls.purchase.length, 1, 'purchase fired');
    const row = el.querySelector('[data-bind="dec-foil-row"]');
    assert.equal(row.hidden, false, 'the level offer is not hidden by UI-side ownership state');
    assert.equal(check.disabled, false, 'checkbox remains governed by phase, not ownership guesses');
    assert.equal(check.checked, false, 'checkbox cleared after the buy');
    el.disconnectedCallback();
    el.remove();

    // The contract remains the duplicate guard on reload too.
    const refreshed = instantiate();
    await settle(60);
    assert.equal(
      refreshed.querySelector('[data-bind="dec-foil-row"]').hidden,
      false,
      'refresh cannot inherit a false-negative local purchase gate',
    );
    refreshed.disconnectedCallback();
  });
});

// Account-switcher (2026-07-16) — mode 'combined' shows the summed unclaimed
// decimator jackpot from app.playerCombined; the Buy CTA stays disabled via
// the existing [data-write] manager (canSign is false in combined mode).
describe('app-decimator-panel — combined mode (account-switcher)', () => {
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

  test('shows summed unclaimed decimator jackpot across combined accounts', async () => {
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    storeMod.update('app.playerCombined', {
      addresses: [CONNECTED, '0xcccc000000000000000000000000000000000003'],
      perAddress: {},
      claimableEth: '0', flipBalance: '0', dgnrsBalance: '0', coinflip: null,
      // Testnet raw wei is /1M-scaled (chain-config.sepolia.js ETH_DIVISOR) —
      // displayEth multiplies back, so 1e12 raw renders as "1.0000 ETH".
      decimator: {
        claimablePerLevel: [
          { level: 5, ethAmount: '1000000000000', lootboxCount: 1, claimed: false },   // 1 ETH
          { level: 6, ethAmount: '2000000000000', lootboxCount: 1, claimed: false },   // 2 ETH
          { level: 7, ethAmount: '5000000000000', lootboxCount: 1, claimed: true },    // 5 ETH (claimed)
        ],
        futurePoolTotal: '0',
      },
      terminal: null, tickets: [],
    });

    const el = instantiate();
    await settle(30);

    const summary = el.querySelector('[data-bind="dec-combined-summary"]');
    assert.equal(summary.hidden, false, 'combined summary visible');
    assert.match(summary.textContent, /3(\.0+)? ETH/, '1+2 ETH summed across the 2 unclaimed levels');
    assert.match(summary.textContent, /2 levels/, 'level 7 (claimed) excluded from the count');
    assert.match(summary.textContent, /Buying needs a single account/);
    el.disconnectedCallback();
  });

  test('all-claimed combined payload → "no unclaimed" summary', async () => {
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    storeMod.update('app.playerCombined', {
      addresses: [CONNECTED], perAddress: {}, claimableEth: '0', flipBalance: '0', dgnrsBalance: '0', coinflip: null,
      decimator: { claimablePerLevel: [], futurePoolTotal: '0' }, terminal: null, tickets: [],
    });

    const el = instantiate();
    await settle(30);

    const summary = el.querySelector('[data-bind="dec-combined-summary"]');
    assert.equal(summary.hidden, false);
    assert.match(summary.textContent, /no unclaimed decimator jackpot/i);
    el.disconnectedCallback();
  });

  test('leaving combined mode hides the summary', async () => {
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    storeMod.update('app.playerCombined', {
      addresses: [CONNECTED], perAddress: {}, claimableEth: '0', flipBalance: '0', dgnrsBalance: '0', coinflip: null,
      decimator: { claimablePerLevel: [], futurePoolTotal: '0' }, terminal: null, tickets: [],
    });
    const el = instantiate();
    await settle(30);
    assert.equal(el.querySelector('[data-bind="dec-combined-summary"]').hidden, false);

    storeMod.update('viewing.combined', false);
    storeMod.update('ui.mode', 'self');
    await settle(30);

    assert.equal(el.querySelector('[data-bind="dec-combined-summary"]').hidden, true);
    el.disconnectedCallback();
  });
});

// ===========================================================================
// FLIP ticket buy (GAME.redeemFlip) — the window-gated second payment path.
//
// Ticket leg ONLY: flat 1,000 FLIP per whole ticket (PRICE_COIN_UNIT), no
// lootbox or foil leg, and it does not touch purchase(). The control reads the
// public pool/target/RNG predicate, so its visibility is not coupled to whether
// this wallet can currently afford a full ticket.
// ===========================================================================

function makeFakeRedeemFlipContract(opts = {}) {
  const calls = [];
  const run = async (...args) => {
    calls.push(args);
    if (opts.sendShouldThrow) throw Object.assign(new Error('send failed'), { userMessage: 'Not enough FLIP.' });
    return makeFakeTx(makeFakeReceipt([]));
  };
  const contract = {
    rngLocked: async () => Boolean(opts.rngLocked),
    nextPrizePoolView: async () => opts.windowClosed ? 100n : 101n,
    prizePoolTargetView: async () => 100n,
    redeemFlip: Object.assign(run, {
      staticCall: async (...args) => {
        calls.push(['static', ...args]);
        if (opts.windowClosed || opts.amountRejected) throw new Error('E()');
      },
    }),
    interface: { parseLog: () => null },
    connect(_s) { return this; },
    _calls: calls,
  };
  return contract;
}

describe('app-decimator-panel — FLIP ticket buy (redeemFlip)', () => {
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

  test('window CLOSED (pool has not cleared target) → the wallet USE FLIP checkbox stays hidden', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract({ windowClosed: true }));
    _fetchHandler = async (url) => (
      String(url).includes('/game/state')
        ? { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false }
        : { player: null, pending: {} }
    );
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-flip-buy"]').hidden, true,
      'no FLIP affordance while the redemption window is closed');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('jackpot phase keeps USE FLIP visible even if the pool probe is closed', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract({ windowClosed: true }));
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-flip-buy"]').hidden, false,
      'jackpotPhaseFlag is independently an open redemption window');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('window OPEN → wallet checkbox shows and the CTA quotes 1,000 FLIP per whole ticket', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract());
    const el = instantiate();
    await settle(60);
    const block = el.querySelector('[data-bind="dec-flip-buy"]');
    assert.equal(block.hidden, false, 'FLIP block visible when the probe passes');
    assert.ok(
      PANEL_SRC.indexOf('dec-funds__display--wallet') < PANEL_SRC.indexOf('data-bind="dec-flip-buy"'),
      'the USE FLIP checkbox lives inside the ETH wallet display',
    );
    assert.match(PANEL_SRC, />USE FLIP</);

    const ticketsInput = el.querySelector('[name="dec-tickets"]');
    const mode = el.querySelector('[data-bind="dec-flip-check"]');
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    ticketsInput.value = '2';
    ticketsInput.dispatchEvent({ type: 'input' });
    await settle(30);
    const ctaAction = el.querySelector('[data-bind="dec-buy-cta-action"]');
    const ctaAmount = el.querySelector('[data-bind="dec-buy-cta-amount"]');
    assert.equal(ctaAction.textContent, 'Redeem');
    assert.equal(ctaAmount.textContent, '2,000 FLIP', '2 tickets = 2,000 FLIP on line two');
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-label"]').textContent, 'WALLET');
    assert.equal(
      el.querySelector('[data-bind="dec-funds"]').classList.contains('dec-funds--flip'),
      false,
      'Redeem mode does not replace the ETH wallet/claimable ledger',
    );

    // Fractional tickets are entry-granular on this path too (0.25 = 250 FLIP).
    ticketsInput.value = '0.25';
    ticketsInput.dispatchEvent({ type: 'input' });
    await settle(30);
    assert.equal(ctaAmount.textContent, '250 FLIP', '0.25 tickets = 250 FLIP');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('USE FLIP is exclusive with USE FIRST, hides lootboxes, and seeds only a zero ticket field', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract());
    const el = instantiate();
    await settle(60);

    const tickets = el.querySelector('[name="dec-tickets"]');
    const lootbox = el.querySelector('[name="dec-lootbox-eth"]');
    const lootboxGroup = el.querySelector('[data-bind="dec-lootbox-group"]');
    const mode = el.querySelector('[data-bind="dec-flip-check"]');
    const walletFirst = el.querySelector('[data-bind="dec-funds-wallet-first"]');
    const claimableFirst = el.querySelector('[data-bind="dec-funds-claimable-first"]');

    tickets.value = '0';
    lootbox.value = '0.08';
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    assert.equal(tickets.value, '1', 'zero tickets seed to one when USE FLIP is selected');
    assert.equal(lootbox.value, '0', 'the incompatible lootbox amount is cleared');
    assert.equal(lootboxGroup.hidden, true, 'the whole lootbox control is removed in FLIP mode');
    assert.equal(walletFirst.checked, false);
    assert.equal(claimableFirst.checked, false, 'no USE FIRST source stays selected with USE FLIP');

    mode.checked = false;
    mode.dispatchEvent({ type: 'change' });
    assert.equal(lootboxGroup.hidden, false, 'lootboxes return when FLIP mode is left');
    assert.equal(claimableFirst.checked, true, 'the saved ETH preference is restored');

    tickets.value = '2.25';
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    assert.equal(tickets.value, '2.25', 'an existing nonzero ticket amount is preserved');

    walletFirst.checked = true;
    walletFirst.dispatchEvent({ type: 'change' });
    assert.equal(mode.checked, false, 'choosing USE FIRST exits FLIP mode');
    assert.equal(walletFirst.checked, true);
    assert.equal(claimableFirst.checked, false);
    assert.equal(lootboxGroup.hidden, false);

    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('window OPEN stays visible even when this wallet cannot afford one whole ticket', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract({ amountRejected: true }));
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-flip-buy"]').hidden, false,
      'availability comes from the window, not a one-ticket affordability simulation');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('click sends redeemFlip with entry-scaled quantity — NOT purchase()', async () => {
    const fake = makeFakeRedeemFlipContract();
    claimsMod.__setContractFactoryForTest(() => fake);
    const purchase = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => purchase);

    const el = instantiate();
    await settle(60);
    el.querySelector('[name="dec-tickets"]').value = '2';
    const mode = el.querySelector('[data-bind="dec-flip-check"]');
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(80);

    const sends = fake._calls.filter((c) => c[0] !== 'static');
    assert.equal(sends.length, 1, 'exactly one redeemFlip send');
    assert.equal(sends[0][1], 800n, '2 tickets = 800 purchase units (400 per whole ticket)');
    assert.equal(purchase._calls.purchase.length, 0, 'the ETH purchase() path is untouched');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('zero tickets → validation error, no tx', async () => {
    const fake = makeFakeRedeemFlipContract();
    claimsMod.__setContractFactoryForTest(() => fake);
    const el = instantiate();
    await settle(60);
    el.querySelector('[name="dec-tickets"]').value = '0';
    const mode = el.querySelector('[data-bind="dec-flip-check"]');
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    // Selecting USE FLIP seeds zero to one. A player can still explicitly
    // clear the field afterward, and click-time validation must reject that.
    el.querySelector('[name="dec-tickets"]').value = '0';
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    const err = el.querySelector('[data-bind="dec-error"]');
    assert.equal(err.hidden, false, 'error shown');
    assert.match(err.textContent, /ticket amount/i);
    assert.equal(fake._calls.filter((c) => c[0] !== 'static').length, 0, 'no tx sent');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('the FLIP leg stays tickets-only without an extra helper sentence', () => {
    assert.match(PANEL_SRC, />USE FLIP</);
    assert.doesNotMatch(PANEL_SRC, />Redeem FLIP</);
    assert.doesNotMatch(PANEL_SRC, /Mint with FLIP/i);
    assert.match(PANEL_SRC, /lootboxInput\.disabled = flipMode/);
    assert.match(PANEL_SRC, /lootboxGroup\.hidden = flipMode/);
    assert.match(
      APP_CSS,
      /\[data-bind="dec-lootbox-group"\]\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s,
    );
    assert.match(PANEL_SRC, /dec-foil--payment-disabled/);
    assert.doesNotMatch(PANEL_SRC, /FLIP mode buys tickets only/);
  });
});
