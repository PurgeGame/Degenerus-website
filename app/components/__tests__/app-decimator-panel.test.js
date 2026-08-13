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
    blurCalls: 0,
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
    blur() { this.blurCalls += 1; },
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
  const raw = await _fetchHandler(url);
  const playerRoute = String(url).includes('/player/');
  const data = playerRoute
    && raw
    && typeof raw === 'object'
    && !Object.prototype.hasOwnProperty.call(raw, 'scoreBreakdown')
    && !Object.prototype.hasOwnProperty.call(raw, 'activityScore')
    ? { ...raw, scoreBreakdown: { totalBps: 100 } }
    : raw;
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
};

function resetDom() {
  pendingActionsMod.__resetPendingActionsForTest();
  decimatorMod.__resetContractFactoryForTest();
  coinflipMod.__setClaimableReaderForTest(null);
  coinflipMod.__setBackingReaderForTest(async () => null);
  coinflipMod.__resetWidgetBalancesReaderForTest();
  passesMod.__resetContractFactoryForTest();
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.localStorage.clear();
  _docListeners.clear();
  _fetchHandler = async (url) => (
    String(url).includes('/game/state') ? DEFAULT_GAME_STATE : { player: null, pending: {} }
  );
  installAfkingReadState();
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
import * as passesMod from '../../app/passes.js';
import * as coinflipMod from '../../app/coinflip.js';
import * as pendingActionsMod from '../../app/pending-actions.js';
import * as uiPreferencesMod from '../../app/ui-preferences.js';
import { invalidateJSONCache } from '../../app/api.js';

// Seats auto-mint with the pass, so `claimSeat`/`canClaimSeat` are gone — holding one is the
// whole signal.
function installAfkingReadState({
  hasToken = false,
  active = false,
  fundingWei = 0n,
  pendingFlipWhole = null,
} = {}) {
  passesMod.__setAfkingReadContractFactoryForTest(() => ({
    token: {
      balanceOf: async () => hasToken ? 1n : 0n,
    },
    game: {
      afkingFundingOf: async () => fundingWei,
      subInfo: async () => [active, active ? 1 : 0, 0, 0],
      afkingSnapshot: async () => [1n, false, [0n], [fundingWei]],
    },
    ...(pendingFlipWhole == null ? {} : {
      lens: { subInfoFull: async () => ({ pendingFlip: pendingFlipWhole }) },
    }),
  }));
}

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
const STATUS_CSS = readFileSync(
  new URL('../../styles/status-indicators.css', import.meta.url),
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
  const calls = {
    purchase: [], purchaseStatic: [], purchaseCoin: [],
    buyLootboxAndPresaleBox: [], buyLootboxAndPresaleBoxStatic: [],
    buyPresaleBox: [], buyPresaleBoxStatic: [],
  };
  const stk = (name) => async (...args) => {
    if (name === 'purchase') calls.purchaseStatic.push(args);
    if (name === 'buyLootboxAndPresaleBox') calls.buyLootboxAndPresaleBoxStatic.push(args);
    if (name === 'buyPresaleBox') calls.buyPresaleBoxStatic.push(args);
    const isFoilAvailabilityProbe = name === 'purchase'
      && args[1] === 0n
      && args[2] === 0n
      && args[5] === true
      && args[6]?.value === 0n;
    const selectedRevert = isFoilAvailabilityProbe
      ? opts.foilProbeRevertName
      : opts.foilPurchaseRevertName;
    if (selectedRevert) {
      const err = new Error('static-call revert');
      err.revert = { name: selectedRevert };
      throw err;
    }
    if (opts.staticCallShouldRevert?.[name]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[name] || 'GameOverPossible' };
      throw err;
    }
  };
  let txCounter = 0n;
  const contract = {
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
    buyLootboxAndPresaleBox: Object.assign(
      async (...args) => {
        calls.buyLootboxAndPresaleBox.push(args);
        txCounter += 1n;
        return makeFakeTx(makeFakeReceipt([
          { parsed: { name: 'LootBoxIdx', args: { index: txCounter, day: 1n, buyer: args[0] } } },
          { parsed: { name: 'PresaleBoxBuy', args: {
            buyer: args[0], index: txCounter, amount: args[5], closing: false,
          } } },
        ]));
      },
      { staticCall: stk('buyLootboxAndPresaleBox') }
    ),
    buyPresaleBox: Object.assign(
      async (...args) => {
        calls.buyPresaleBox.push(args);
        txCounter += 1n;
        return makeFakeTx(makeFakeReceipt([
          { parsed: { name: 'PresaleBoxBuy', args: {
            buyer: args[0], index: txCounter, amount: args[1], closing: false,
          } } },
        ]));
      },
      { staticCall: stk('buyPresaleBox') }
    ),
    lootboxPresaleActiveFlag: async () => Boolean(opts.presaleActive),
    presaleBoxCreditOf: async () => BigInt(opts.presaleCredit ?? 0n),
    presaleBoxEthRemaining: async () => BigInt(opts.presaleRemaining ?? 0n),
    claimableWinningsOf: async () => BigInt(opts.claimableRaw ?? 0n),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
  };
  if (opts.purchaseInfo != null) {
    contract.purchaseInfo = async () => opts.purchaseInfo;
  }
  return contract;
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
    livenessTriggered: async () => false,
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

function makeFakeProvider(
  addr,
  walletBalance = 3_125_000_000_000n,
  { redemptionOpen = false } = {},
) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => addr }),
    getBalance: async () => walletBalance,
    getStorage: async () => redemptionOpen ? (1n << 240n) : 0n,
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

  test('BUY AFKING PASS is offered only after an exact no-pass read and opens the pass drawer', async () => {
    const drawer = makeFakeElement('details');
    drawer.setAttribute('id', 'afking-passes');
    drawer.classList.add('more-ways');
    const passPanel = makeFakeElement('app-pass-section');
    const afking = makeFakeElement('section');
    afking.setAttribute('data-bind', 'pass-afking');
    afking.hidden = false;
    let scrolled = 0;
    afking.scrollIntoView = () => { scrolled += 1; };
    passPanel.appendChild(afking);
    drawer.appendChild(passPanel);
    _docBody.appendChild(drawer);

    const el = instantiate();
    await settle(60);
    const jump = el.querySelector('[data-bind="dec-afking-jump"]');
    assert.ok(jump, 'purchase panel exposes the pass shortcut');
    assert.equal(jump.hidden, false, 'definitive no-seat read reveals the acquisition shortcut');
    jump.dispatchEvent({ type: 'click' });
    assert.equal(drawer.open, true);
    assert.equal(drawer.getAttribute('open'), '');
    assert.equal(scrolled, 1);
    el.disconnectedCallback();
  });

  test('BUY AFKING PASS stays hidden for an existing seat or subscription', async () => {
    for (const state of [
      { hasToken: true },
      { active: true },
    ]) {
      installAfkingReadState(state);
      const el = instantiate();
      await settle(60);
      assert.equal(
        el.querySelector('[data-bind="dec-afking-jump"]').hidden,
        true,
        `holder state ${JSON.stringify(state)} does not receive an acquisition prompt`,
      );
      el.disconnectedCallback();
    }
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
    assert.match(el.innerHTML, /<h2 class="dec-purchase-heading">BUY IN<\/h2>/,
      'the primary purchase surface has a direct player-facing title');
    assert.doesNotMatch(el.innerHTML, /dec-purchase-mark|TICKETS · LOOTBOXES/,
      'the narrow title row has no decorative ticket or truncation-prone subtitle');
    assert.match(
      el.innerHTML,
      /class="dec-purchase-help" href="\/learn\/purchases\/"/,
      'the compact info control opens the purchase overview',
    );
    assert.match(el.innerHTML, /aria-label="Learn about tickets, Luckbox, and foil packs"/);
    for (const href of ['/learn/tickets/', '/learn/lootboxes/', '/learn/foil-packs/']) {
      assert.match(PURCHASE_LEARN_SRC, new RegExp(`href="${href}"`));
    }
    el.disconnectedCallback();
  });

  test('purchase fields use action labels and become finger-sized full-width phone rows', () => {
    const el = instantiate();
    assert.match(el.innerHTML, /<span data-bind="dec-ticket-action-label">Buy tickets<\/span>/);
    assert.match(el.innerHTML,
      /<boon-product-indicator product="purchase"\s+variant="purchase-control"/);
    assert.match(el.innerHTML, /<span>Buy luckbox<\/span>/);
    assert.match(el.innerHTML,
      /<boon-product-indicator product="lootbox"\s+variant="purchase-control"/);
    assert.match(el.innerHTML,
      /class="dec-input-accessories" aria-label="Luckbox purchase modifiers"[\s\S]*?<boon-product-indicator[\s\S]*?<quest-objective-indicator product="lootbox"/,
      'boon and quest markers have dedicated non-overlapping slots');
    assert.doesNotMatch(el.innerHTML, /Luckbox value/i);
    assert.match(
      APP_CSS,
      /\.app-decimator-panel \.dec-input-label\s*\{[^}]*font-size:\s*clamp\(0\.72rem, 1\.55vw, 0\.82rem\)/s,
      'Buy Tickets and Buy Luckbox use the larger matched label size',
    );
    assert.doesNotMatch(
      STATUS_CSS,
      /\.dec-input-group\.has-active-boon\s*\{[^}]*display:\s*grid/s,
      'an active boon never changes the ticket or luckbox control columns',
    );
    assert.match(
      STATUS_CSS,
      /\.dec-input-accessories\s*\{[^}]*position:\s*absolute;[^}]*right:\s*7rem;[^}]*width:\s*3\.05rem;[^}]*pointer-events:\s*none;/s,
      'the fixed purchase accessory lane cannot alter field dimensions',
    );
    assert.match(
      STATUS_CSS,
      /\.dec-input-accessories > boon-product-indicator\s*\{[^}]*left:\s*0;[^}]*width:\s*1\.42rem;[^}]*animation:\s*none;/s,
      'the purchase boon occupies its own slot',
    );
    assert.match(
      STATUS_CSS,
      /\.dec-input-accessories > quest-objective-indicator\s*\{[^}]*right:\s*0;[^}]*width:\s*1\.08rem;/s,
      'the quest marker occupies the other slot',
    );
    assert.match(
      STATUS_CSS,
      /boon-product-indicator::before\s*\{[^}]*var\(--boon-amount[^}]*clip-path:\s*polygon\(/s,
      'the compact purchase boon uses the shared amount-colored arrow',
    );
    assert.match(
      STATUS_CSS,
      /boon-product-indicator::after\s*\{[^}]*background:\s*var\(--boon-logo, none\) center \/ contain no-repeat/s,
      'native product badges can be overlaid without entering the field layout',
    );
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
      /@media \(max-width: 520px\)[\s\S]*?\.jackpot-hero \.dec-input-row--pair\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
      'each purchase field gets the full phone width',
    );
    assert.match(
      APP_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.jackpot-hero \.dec-input-group\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*grid-template-rows:\s*auto 4rem[^}]*min-height:\s*5\.8rem[^}]*justify-content:\s*stretch/s,
      'each phone selector is twice the desktop card height with a full-height touch control',
    );
    assert.match(
      APP_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.jackpot-hero \.dec-input-group \.dec-stepper-btns\s*\{[^}]*flex-direction:\s*row/s,
      'the old whole-ticket arrows sit side by side instead of becoming tiny stacked halves',
    );
    assert.match(
      APP_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.jackpot-hero \.dec-input-group \.dec-step\s*\{[^}]*min-width:\s*3rem[^}]*min-height:\s*4rem/s,
      'whole-ticket arrow buttons fill the enlarged 64px phone control',
    );
    assert.match(
      APP_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.jackpot-hero \.dec-buy-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
      'the optional bonus and BUY IN stack rather than halving the phone action width',
    );
    assert.match(
      APP_CSS,
      /\.dec-stepper\s*\{[^}]*width:\s*6\.25rem[^}]*flex:\s*0 0 6\.25rem/s,
      'ticket and lootbox controls retain the exact same outer width',
    );
    assert.match(
      PANEL_SRC,
      /name="dec-tickets"[^>]*inputmode="decimal"/s,
      'ticket entry requests the decimal keyboard on mobile',
    );
    assert.match(
      PANEL_SRC,
      /name="dec-lootbox-eth"[^>]*inputmode="decimal"/s,
      'lootbox entry requests the decimal keyboard on mobile',
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
      /\.app-decimator-panel \.dec-funds:has\(\.dec-funds__summary\[aria-expanded="false"\]\)\s*\{[^}]*height:\s*2\.6rem;/s,
      'collapsed Available Funds matches the Protocol Coins instrument height',
    );
    assert.match(
      APP_CSS,
      /\.dec-funds-stack\s*\{[^}]*margin-top:\s*auto;/s,
      'the FLIP balance and Available Funds stay tethered together at the bottom',
    );
    assert.match(
      APP_CSS,
      /\.app-decimator-panel \.dec-funds__display\s*\{[^}]*min-height:\s*2\.7rem;[^}]*height:\s*auto;/s,
      'expanded source rows have room for their full-size value and controls',
    );
    assert.match(
      APP_CSS,
      /\.dec-funds__display\s*\{[^}]*grid-template-rows:\s*minmax\(0\.82rem, auto\) minmax\(1\.25rem, auto\)/s,
      'the label and value lanes cannot collapse below their contents',
    );
    assert.match(
      APP_CSS,
      /\.dec-funds__summary\[aria-expanded="true"\] ~ \.dec-funds__breakdown\s*\{[^}]*border-top:\s*1px solid/s,
      'opening Available Funds adds one divider below its title',
    );
    assert.match(
      APP_CSS,
      /\.app-decimator-panel \.dec-funds :is\([\s\S]*?\.dec-funds__priority,[\s\S]*?\.dec-funds__claim,[\s\S]*?\.dec-flip-toggle[\s\S]*?\)\s*\{[^}]*width:\s*4rem;[^}]*min-width:\s*4rem;[^}]*max-width:\s*4rem/s,
      'Available Funds action buttons all occupy the same compact column width',
    );
    assert.match(
      APP_CSS,
      /\.app-decimator-panel \.dec-funds \.dec-funds__display \.dec-funds__priority,[\s\S]*?\.app-decimator-panel \.dec-funds \.dec-funds__claim\[data-write\]\s*\{[^}]*width:\s*4rem;[^}]*min-width:\s*4rem;[^}]*max-width:\s*4rem/s,
      'USE FIRST and the ETH Claim transaction override cannot diverge from that column',
    );
  });

  test('the purchase panel leaves referral editing in the top bar', async () => {
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
    assert.equal(el.querySelector('[data-bind="dec-affiliate-row"]'), null);
    assert.equal(el.querySelector('[name="dec-affiliate-code"]'), null,
      'the buy form does not duplicate the nav referral control');
    el.disconnectedCallback();
  });

  test('an assigned referrer never creates a duplicate purchase-form field', async () => {
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
    assert.equal(el.querySelector('[data-bind="dec-affiliate-row"]'), null);
    el.disconnectedCallback();
  });

  test('the referral saved by the top bar is sent on the first purchase', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: '0', affiliate: { referrer: null } };
    };
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const expected = '0x' + '0'.repeat(24) + 'b'.repeat(40);
    globalThis.localStorage.setItem('affiliate-ref', expected);

    const el = instantiate();
    await settle(60);
    el.querySelector('[name="dec-tickets"]').value = '1';
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(80);

    assert.equal(fakeContract._calls.purchase.length, 1, 'purchase sent once');
    assert.equal(fakeContract._calls.purchase[0][3], expected, 'saved referral sent as bytes32');
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
    assert.equal(el.querySelector('[name="dec-tickets"]').value, '0',
      'a mined buy clears the ticket draft');
    assert.equal(el.querySelector('[name="dec-lootbox-eth"]').value, '0',
      'a mined buy clears the luckbox draft');
    el.disconnectedCallback();
  });

  test('a failed buy keeps both amounts available for retry', async () => {
    const fakeContract = makeFakePurchaseContract({
      staticCallShouldRevert: { purchase: true },
    });
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    const tickets = el.querySelector('[name="dec-tickets"]');
    const luckbox = el.querySelector('[name="dec-lootbox-eth"]');
    tickets.value = '2';
    luckbox.value = '0.03';

    el.querySelector('[data-write]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 0, 'reverted simulation never sends');
    assert.equal(tickets.value, '2', 'ticket draft is retained after failure');
    assert.equal(luckbox.value, '0.03', 'luckbox draft is retained after failure');
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

  test('a mined lootbox is published to Pending before optional reward enrichment', () => {
    const confirmedAt = PANEL_SRC.indexOf("new CustomEvent('app-decimator:tx-confirmed'");
    const enrichmentAt = PANEL_SRC.indexOf('let autoLegs = parseOpenLegsFromReceipt');
    assert.ok(confirmedAt >= 0 && enrichmentAt > confirmedAt,
      'receipt-confirmed RNG work must not wait behind boon/reveal RPC enrichment');
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
    assert.match(err.textContent, /ticket amount|luckbox/i, 'validation copy');
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
    assert.match(err.textContent, /Minimum luckbox spend/, 'minimum copy');
    el.disconnectedCallback();
  });

  test('ticket and Luckbox fields glow independently at their live bounty floors', async () => {
    storeMod.update('app.records', {
      records: [
        { kind: 2, held: false, value: 0n, barToBeat: 0n },
        { kind: 3, held: false, value: 0n, barToBeat: 0n },
      ],
    });
    const el = instantiate();
    await flushMicrotasks();
    const tickets = el.querySelector('[name="dec-tickets"]');
    const luckbox = el.querySelector('[name="dec-lootbox-eth"]');

    tickets.value = '99.75';
    tickets.dispatchEvent({ type: 'input' });
    assert.equal(tickets.classList.contains('is-bounty-trigger'), false);
    tickets.value = '100';
    tickets.dispatchEvent({ type: 'input' });
    assert.equal(tickets.classList.contains('is-bounty-trigger'), true);

    luckbox.value = '4.99';
    luckbox.dispatchEvent({ type: 'input' });
    assert.equal(luckbox.classList.contains('is-bounty-trigger'), false);
    luckbox.value = '5';
    luckbox.dispatchEvent({ type: 'input' });
    assert.equal(luckbox.classList.contains('is-bounty-trigger'), true);
    assert.equal(luckbox.getAttribute('data-bounty-trigger'), 'true');
    el.disconnectedCallback();
  });

  test('normal bonus includes a qualifying ticket or Luckbox bounty credit', async () => {
    const unit = 10n ** 18n;
    storeMod.update('app.daySync', { day: 11 });
    storeMod.update('app.records', {
      recordPoolWei: 100_000n * unit,
      records: [
        { kind: 2, held: false, value: 0n, barToBeat: 0n, clockDay: null },
        { kind: 3, held: false, value: 0n, barToBeat: 0n, clockDay: null },
      ],
    });
    const el = instantiate();
    await settle(60);
    const tickets = el.querySelector('[name="dec-tickets"]');
    const luckbox = el.querySelector('[name="dec-lootbox-eth"]');
    const tally = el.querySelector('[data-bind="dec-flip-credit"]');
    const label = el.querySelector('[data-bind="dec-flip-credit-label"]');
    const total = el.querySelector('[data-bind="dec-flip-credit-total"]');

    tickets.value = '100';
    tickets.dispatchEvent({ type: 'input' });
    assert.equal(tally.hidden, false);
    assert.equal(label.textContent, 'BONUS + BOUNTY');
    assert.equal(total.textContent, '+25K FLIP',
      '15,000 ordinary ticket bonus plus the 10,000 live bounty');
    assert.equal(tally.getAttribute('data-includes-bounty'), 'true');
    assert.match(tally.getAttribute('title'), /\+10,000 FLIP/);

    tickets.value = '0';
    tickets.dispatchEvent({ type: 'input' });
    luckbox.value = '5';
    luckbox.dispatchEvent({ type: 'input' });
    assert.equal(tally.hidden, false, 'a bounty makes the otherwise bonus-free Luckbox tally visible');
    assert.equal(label.textContent, 'BONUS + BOUNTY');
    assert.equal(total.textContent, '+10K FLIP');
    el.disconnectedCallback();
  });

  test('boon-adjusted ticket and Luckbox buys show the concrete extra amount', async () => {
    storeMod.update('app.boons', {
      address: CONNECTED.toLowerCase(),
      day: 62,
      exact: true,
      boons: [
        { boonType: 9, consumed: false },
        { boonType: 22, consumed: false },
      ],
    });
    const el = instantiate();
    await settle(60);
    const tickets = el.querySelector('[name="dec-tickets"]');
    const luckbox = el.querySelector('[name="dec-lootbox-eth"]');
    const effect = el.querySelector('[data-bind="dec-purchase-boon-effect"]');

    tickets.value = '100';
    luckbox.value = '5';
    luckbox.dispatchEvent({ type: 'input' });
    assert.equal(effect.hidden, false);
    assert.equal(effect.textContent, '+25 TICKETS BOON · +1.25 ETH BOON');
    assert.match(el.querySelector('[data-bind="dec-flip-credit"]').getAttribute('aria-label'),
      /Purchase boon: \+25 TICKETS BOON, \+1\.25 ETH BOON/);
    el.disconnectedCallback();
  });

  test('tickets-owned display removed from the buy panel (inventory widget owns it)', async () => {
    const el = instantiate();
    await flushMicrotasks();
    assert.equal(el.querySelector('.dec-balance'), null, 'no owned-count in the buy panel');
    assert.match(el.innerHTML, /<h2 class="dec-purchase-heading">BUY IN<\/h2>/,
      'the purchase desk has a useful title without duplicating the ticket field label');
    assert.doesNotMatch(el.innerHTML, /<h2>BUY TICKETS<\/h2>/,
      'the title does not duplicate the ticket-only field label');
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

  test('purchase footer renders one Available Funds box with a lazy source breakdown', async () => {
    const price = lootboxMod.scaledTicketPriceWei(12);
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return {
        claimableEth: String((price / 2n) + 1n),
        flipBalance: '9000000000000000000000',
        coinflip: { claimablePreview: '1200000000000000000000' },
      };
    };

    const el = instantiate();
    await settle(60);
    const displays = el.querySelectorAll('.dec-funds__display');
    assert.equal(displays.length, 3, 'claimable, AFKING, and wallet have dedicated source rows');
    assert.ok(displays[0].classList.contains('dec-funds__display--claimable'),
      'claimable is the primary and first source row');
    assert.ok(displays[1].classList.contains('dec-funds__display--afking'),
      'AFKING is the second conditional source row');
    assert.ok(displays[2].classList.contains('dec-funds__display--wallet'),
      'wallet comes last when the disclosure opens');
    const toggle = el.querySelector('[data-bind="dec-funds-toggle"]');
    const breakdown = el.querySelector('[data-bind="dec-funds-breakdown"]');
    const totalDisplay = el.querySelector('[data-bind="dec-funds-total-display"]');
    const total = el.querySelector('[data-bind="dec-funds-total"]');
    assert.notEqual(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(totalDisplay.hidden, false, 'collapsed Available Funds renders one total row');
    assert.equal(total.textContent, '3.14', 'the compact figure aggregates every ETH source');
    assert.equal(displays[0].hidden, true, 'Claimable is source detail, not the compact balance');
    assert.equal(el.querySelector('[data-bind="dec-funds-use-claimable"]').hidden, true,
      'the compact primary source does not waste space saying to use itself');
    assert.equal(el.querySelector('[data-bind="dec-funds-claim"]').hidden, true,
      'collapsed Available Funds is balance-only');
    assert.equal(displays[1].hidden, true, 'zero AFKING stays absent');
    assert.equal(displays[2].hidden, true, 'wallet waits for expansion');
    toggle.dispatchEvent({ type: 'click', detail: 1 });
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle.blurCalls, 1,
      'a pointer click releases the retained Available Funds focus treatment');
    assert.equal(breakdown.hidden, false, 'the shared source list remains one instrument');
    assert.equal(totalDisplay.hidden, true, 'opening the dropdown replaces Total with its sources');
    assert.equal(displays[0].hidden, false, 'claimable stays first while expanded');
    assert.equal(displays[1].hidden, true, 'AFKING does not render without money');
    assert.equal(displays[2].hidden, false, 'wallet appears last');
    assert.equal(el.querySelector('[data-bind="dec-funds-use-claimable"]').hidden, true,
      'the top expanded source still needs no USE button');
    assert.equal(el.querySelector('[data-bind="dec-funds-use-wallet"]').hidden, false,
      'a lower funded source can be promoted after expansion');
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-label"]').textContent, 'WALLET');
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet"]').textContent, '3.12 ETH');
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable"]').textContent, '0.02');
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable-unit"]').textContent, 'ETH');
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
      'the purchase source rows stay stacked in one dropdown',
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
    assert.match(
      APP_CSS,
      /\.dec-funds__breakdown\[hidden\]\s*\{[^}]*display:\s*none !important/s,
      'closing the disclosure removes the entire source-detail list from layout',
    );
    for (const selector of ['inv-disclosure__chevron', 'dec-funds__chevron', 'df-funds__chevron']) {
      const rule = APP_CSS.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] || '';
      assert.match(rule, /width:\s*0\.42rem/);
      assert.match(rule, /height:\s*0\.42rem/);
      assert.match(rule, /border-right:\s*1\.5px solid currentColor/);
      assert.match(
        rule,
        selector === 'inv-disclosure__chevron'
          ? /transform:\s*rotate\(45deg\)/
          : /translateY\(-0\.1rem\) rotate\(45deg\)/,
        `${selector} uses its shared closed-arrow geometry`,
      );
    }
    el.disconnectedCallback();
  });

  test('Available Funds still aggregates known sources when optional AFKing reads fail', async () => {
    const price = lootboxMod.scaledTicketPriceWei(12);
    passesMod.__setAfkingReadContractFactoryForTest(() => ({
      token: { balanceOf: async () => { throw new Error('optional seat RPC unavailable'); } },
      game: {
        afkingFundingOf: async () => { throw new Error('optional funding RPC unavailable'); },
        subInfo: async () => { throw new Error('optional subscription RPC unavailable'); },
        afkingSnapshot: async () => { throw new Error('optional snapshot RPC unavailable'); },
      },
    }));
    _fetchHandler = async (url) => String(url).includes('/game/state')
      ? DEFAULT_GAME_STATE
      : { claimableEth: String((price / 2n) + 1n), flipBalance: '0' };

    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-funds-total"]').textContent, '3.14',
      'Wallet plus Claimable remain available when the independent AFKing source is unknown');
    assert.equal(el.querySelector('[data-bind="dec-funds"]').getAttribute('data-funds-complete'), 'false');
    assert.match(
      el.querySelector('[data-bind="dec-funds-total"]').getAttribute('title'),
      /some sources are still loading/i,
    );
    el.disconnectedCallback();
  });

  test('Available Funds groups large ETH balances with commas', async () => {
    contractsMod.setProvider(makeFakeProvider(CONNECTED, 12_345_670_000_000_000n));
    _fetchHandler = async (url) => (
      String(url).includes('/game/state')
        ? DEFAULT_GAME_STATE
        : { claimableEth: '1', flipBalance: '0', pending: {} }
    );

    const el = instantiate();
    await settle(60);
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(
      el.querySelector('[data-bind="dec-funds-wallet"]').textContent,
      '12,345.67 ETH',
    );
    el.disconnectedCallback();
  });

  test('Available Funds defaults to Claimable, Wallet, then AFKING', async () => {
    installAfkingReadState({ fundingWei: 875_000_000_000n });
    const price = lootboxMod.scaledTicketPriceWei(12);
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: String((price / 2n) + 1n) };
    };
    const el = instantiate();
    await settle(60);

    assert.equal(el.querySelector('[data-bind="dec-funds-total"]').textContent, '4.02',
      'collapsed Total includes Claimable, AFKING, and Wallet');
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable-display"]').hidden, true,
      'individual sources wait for the disclosure to open');
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet"]').textContent, '3.12 ETH');
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-display"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-funds-afking"]').textContent, '0.87 ETH');
    assert.equal(el.querySelector('[data-bind="dec-funds-afking-display"]').hidden, true,
      'AFKING waits for the disclosure to open');
    assert.ok(el.querySelectorAll('.dec-funds__priority').every((button) => button.hidden),
      'all USE actions stay hidden while collapsed');
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="dec-funds-afking-display"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-display"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="dec-funds-use-afking"]').getAttribute('aria-pressed'), 'false',
      'AFKING is available without displacing the selected first source');
    assert.equal(el.querySelector('[data-bind="dec-funds-use-claimable"]').hidden, true,
      'the active top row has no redundant USE action');
    assert.equal(el.querySelector('[data-bind="dec-funds-use-afking"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="dec-funds-use-wallet"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="dec-funds-afking-claim"]').hidden, false,
      'AFKING has its own left-lane claim action');
    assert.doesNotMatch(el.innerHTML, /AFKING FUNDING/,
      'the source label is simply AFKING');
    const claimableRow = el.querySelector('[data-bind="dec-funds-claimable-display"]');
    const afkingRow = el.querySelector('[data-bind="dec-funds-afking-display"]');
    const walletRow = el.querySelector('[data-bind="dec-funds-wallet-display"]');
    assert.deepEqual(
      [claimableRow.style.order, walletRow.style.order, afkingRow.style.order],
      ['0', '1', '2'],
      'the default waterfall is Claimable, Wallet, AFKING',
    );
    el.querySelector('[data-bind="dec-funds-use-afking"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(
      [afkingRow.style.order, claimableRow.style.order, walletRow.style.order],
      ['0', '1', '2'],
      'USE AFKING promotes it and shifts the other rows down intact',
    );
    assert.equal(el.querySelector('[data-bind="dec-funds-use-afking"]').hidden, true,
      'the newly promoted row loses its now-redundant button');
    assert.equal(el.querySelector('[data-bind="dec-funds-use-claimable"]').hidden, false,
      'the displaced funded row gains a promotion action');
    el.querySelector('[data-bind="dec-funds-use-wallet"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(
      [walletRow.style.order, afkingRow.style.order, claimableRow.style.order],
      ['0', '1', '2'],
      'USE WALLET repeats the same move-to-front behavior',
    );
    assert.equal(el.querySelector('[data-bind="dec-funds-use-wallet"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-funds-use-afking"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="dec-funds-faucet"]').hidden, true);
    el.disconnectedCallback();
  });

  test('zero combined testnet funds become an Alchemy GET PLAY MONEY action', async () => {
    contractsMod.setProvider(makeFakeProvider(CONNECTED, 0n));
    installAfkingReadState({ fundingWei: 0n });
    const el = instantiate();
    await settle(60);

    assert.equal(el.querySelector('[data-bind="dec-funds-total"]').textContent, '0');
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable-display"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-display"]').hidden, true);
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-display"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-funds-faucet"]').hidden, false);
    assert.match(
      el.innerHTML,
      /https:\/\/www\.alchemy\.com\/faucets\/base-sepolia[\s\S]*GET PLAY MONEY/,
    );
    el.disconnectedCallback();
  });

  test('an empty native wallet still gets play money when AFKing credit is available', async () => {
    contractsMod.setProvider(makeFakeProvider(CONNECTED, 0n));
    installAfkingReadState({ fundingWei: 875_000_000_000n });
    const el = instantiate();
    await settle(60);

    assert.equal(el.querySelector('[data-bind="dec-funds-total"]').textContent, '0.87');
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable-display"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-display"]').hidden, true,
      'wallet waits for the disclosure even when it needs gas');
    assert.equal(el.querySelector('[data-bind="dec-funds-afking"]').textContent, '0.87 ETH');
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="dec-funds-afking-display"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-display"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="dec-funds-faucet"]').hidden, false,
      'native-wallet zero, not the combined total, drives the gas faucet');
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
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable"]').textContent, '-',
      'a known empty claimable balance uses one dash');
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable-unit"]').textContent, 'ETH',
      'the balance unit remains visible beside the dash');
    assert.equal(claim.disabled, true);
    assert.equal(claim.hidden, true, 'collapsed Available Funds keeps every row action hidden');
    assert.notEqual(claim.getAttribute('data-write-locked'), null,
      'domain lock prevents the global signer manager from lighting a zero claim');
    assert.match(claim.getAttribute('data-write-lock-title'), /No ETH winnings/i);
    const useClaimable = el.querySelector('[data-bind="dec-funds-use-claimable"]');
    const useWallet = el.querySelector('[data-bind="dec-funds-use-wallet"]');
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(claim.hidden, false, 'expanded Claimable always retains its CLAIM position');
    assert.equal(claim.disabled, true, 'an empty Claimable action is visibly grey and inert');
    assert.equal(useClaimable.hidden, true, 'top Claimable still omits its redundant USE action');
    assert.equal(useWallet.hidden, false, 'the non-top Wallet always retains its USE action');
    useWallet.dispatchEvent({ type: 'click' });
    assert.equal(useClaimable.hidden, false,
      'empty Claimable still has USE CLAIMABLE whenever it is not the top source');
    assert.equal(useClaimable.disabled, false,
      'funding order can be selected before a source receives funds');
    assert.equal(claim.hidden, false);
    assert.equal(claim.disabled, true);
    el.disconnectedCallback();
  });

  test('claimable blur toggles without disabling the ETH claim', async () => {
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
    const unit = el.querySelector('[data-bind="dec-funds-claimable-unit"]');
    const claim = el.querySelector('[data-bind="dec-funds-claim"]');
    const total = el.querySelector('[data-bind="dec-funds-total"]');
    const totalDisplay = el.querySelector('[data-bind="dec-funds-total-display"]');
    assert.ok(display.classList.contains('dec-funds__display--spoiler'));
    assert.ok(totalDisplay.classList.contains('dec-funds__total--spoiler'));
    assert.equal(total.textContent, '••••', 'the aggregate cannot spoil an unseen jackpot either');
    assert.equal(value.textContent, '••••', 'the amount DOM only contains a fixed-length mask');
    assert.equal(unit.textContent, 'ETH', 'the currency unit stays readable beside the mask');
    assert.doesNotMatch(value.textContent, /\d/, 'the hidden balance cannot leak through blurred digits');
    assert.equal(value.getAttribute('role'), 'button', 'the spoiler is explicitly revealable');
    total.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.doesNotMatch(total.textContent, /•/, 'clicking Available Funds unmasks its current total');
    total.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.equal(total.textContent, '••••', 'clicking the total again reblurs it');
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(claim.hidden, false);
    assert.equal(claim.disabled, false, 'privacy masking never gates a valid ETH claim');
    value.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.notEqual(value.textContent, '••••', 'clicking the number reveals the current balance');
    assert.equal(claim.disabled, false);
    value.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.equal(value.textContent, '••••', 'clicking the revealed number reblurs it');
    assert.equal(claim.disabled, false, 'reblurring leaves Claim live');
    value.dispatchEvent({ type: 'click', preventDefault() {} });

    globalThis.localStorage.setItem('spun_day_84532_67', '1');
    storeMod.update('app.lastDay', { day: 67 });
    assert.ok(!display.classList.contains('dec-funds__display--spoiler'));
    assert.ok(!totalDisplay.classList.contains('dec-funds__total--spoiler'));
    assert.doesNotMatch(total.textContent, /•/, 'the aggregate returns after the jackpot is viewed');
    assert.notEqual(value.textContent, '••••', 'the real balance is inserted only after reveal');
    assert.equal(unit.textContent, 'ETH');
    assert.equal(value.getAttribute('aria-hidden'), null);
    assert.equal(claim.disabled, false);
    value.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.equal(value.textContent, '••••', 'the player can reblur even after the jackpot is viewed');
    assert.equal(claim.disabled, false);
    value.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.notEqual(value.textContent, '••••', 'the same control toggles it visible again');
    assert.match(
      APP_CSS,
      /\.dec-funds__display--spoiler \.dec-funds__number\s*\{[^}]*filter:\s*blur\(var\(--main-balance-spoiler-blur\)\)/s,
    );
    assert.doesNotMatch(
      APP_CSS,
      /\.dec-funds__display--spoiler \.dec-funds__value\s*\{[^}]*filter:\s*blur/s,
      'the spoiler blur does not include the ETH unit',
    );
    assert.doesNotMatch(
      APP_CSS,
      /\.dec-funds__display--spoiler \.dec-funds__claim\[data-write\][\s\S]*?background:\s*rgba\(0, 0, 0, 0\.16\)[\s\S]*?box-shadow:\s*none/s,
      'the privacy mask does not paint a live Claim as dormant',
    );
    el.disconnectedCallback();
  });

  test('collapsed Total masks only pending results that can change ETH', async () => {
    const el = instantiate();
    await settle(60);
    const total = el.querySelector('[data-bind="dec-funds-total"]');
    const totalDisplay = el.querySelector('[data-bind="dec-funds-total-display"]');
    assert.equal(total.textContent, '3.12');

    pendingActionsMod.publishPendingActions('degenerette-live', [{
      id: 'degenerette:eth:1', kind: 'degenerette', currency: 0, mayAddEth: true,
      phase: 'waiting-rng', state: 'waiting', label: '1 spin',
    }]);
    assert.equal(total.textContent, '••••');
    assert.ok(totalDisplay.classList.contains('dec-funds__total--spoiler'));
    assert.doesNotMatch(total.textContent, /\d/, 'masked Total never leaves hidden digits in the DOM');

    pendingActionsMod.publishPendingActions('degenerette-live', [{
      id: 'degenerette:flip:1', kind: 'degenerette', currency: 1, mayAddEth: false,
      phase: 'waiting-rng', state: 'waiting', label: '1 spin',
    }]);
    assert.equal(total.textContent, '3.12', 'a FLIP-only result cannot change the ETH aggregate');
    assert.ok(!totalDisplay.classList.contains('dec-funds__total--spoiler'));

    pendingActionsMod.publishPendingActions('lootbox-live', [{
      id: 'lootbox:1', kind: 'lootbox', resolved: true, mayAddEth: true,
      phase: 'result-ready', state: 'ready', label: 'Luckbox',
    }]);
    assert.equal(total.textContent, '••••', 'an indexed unseen lootbox result also protects Total');
    el.disconnectedCallback();
  });

  test('ALL IN uses known ETH even while the ordinary balance remains spoiler-masked', async () => {
    storeMod.update('app.lastDay', { day: 67 });
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: String(lootboxMod.scaledTicketPriceWei(12)), flipBalance: '0' };
    };

    const el = instantiate();
    await settle(60);
    pendingActionsMod.publishPendingActions('lootbox-live', [{
      id: 'lootbox:all-in-spoiler', kind: 'lootbox', mayAddEth: true,
      phase: 'waiting-rng', state: 'waiting', label: 'Luckbox',
    }]);
    assert.equal(el.querySelector('[data-bind="dec-funds-total"]').textContent, '••••');

    let opened = null;
    el.addEventListener('app-all-in:open', (event) => { opened = event.detail; });
    el.querySelector('[data-bind="dec-all-in"]').dispatchEvent({ type: 'click' });
    assert.ok(opened);
    const quote = opened.quote({ currency: 'ETH', target: 'lootbox', spins: 5 });
    assert.equal(quote.valid, true,
      'an explicit ALL IN quote can use known ETH without waiting for the reveal mask');
    assert.doesNotMatch(quote.message || '', /hidden|pending/i);
    el.disconnectedCallback();
  });

  test('USE CLAIMABLE defaults first and USE WALLET promotes wallet for the real buy', async () => {
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
    const useClaimable = el.querySelector('[data-bind="dec-funds-use-claimable"]');
    const useWallet = el.querySelector('[data-bind="dec-funds-use-wallet"]');
    assert.equal(useClaimable.getAttribute('aria-pressed'), 'true',
      'claimable remains the default first source');
    assert.equal(useClaimable.hidden, true, 'the selected top source is label-only');
    assert.equal(useWallet.hidden, true, 'source actions are not available while collapsed');
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(useWallet.hidden, false);
    useWallet.dispatchEvent({ type: 'click' });
    assert.equal(useWallet.getAttribute('aria-pressed'), 'true');
    assert.equal(useClaimable.getAttribute('aria-pressed'), 'false');

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
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    el.querySelector('[data-bind="dec-funds-claim"]').dispatchEvent({ type: 'click' });
    await settle(60);

    const sends = fake._calls.filter((call) => call[0] === 'send' && call[1] === 'claimWinnings');
    assert.deepEqual(sends, [['send', 'claimWinnings', CONNECTED]]);
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('AFKing funding CLAIM uses the existing full-withdrawal transaction path', async () => {
    const funding = 875_000_000_000n;
    const calls = [];
    const withdraw = Object.assign(
      async (amount) => {
        calls.push(['send', amount]);
        return makeFakeTx(makeFakeReceipt());
      },
      {
        staticCall: async (amount) => {
          calls.push(['static', amount]);
          return true;
        },
      },
    );
    const fake = {
      afkingFundingOf: async (player) => {
        calls.push(['read', player]);
        return funding;
      },
      withdrawAfkingFunding: withdraw,
      connect() { return this; },
    };
    passesMod.__setContractFactoryForTest(() => fake);
    installAfkingReadState({ fundingWei: funding });

    const el = instantiate();
    await settle(60);
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    const claim = el.querySelector('[data-bind="dec-funds-afking-claim"]');
    assert.equal(claim.hidden, false);
    assert.equal(claim.disabled, false);
    claim.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.deepEqual(calls, [
      ['read', '0xAB12000000000000000000000000000000000000'],
      ['static', funding],
      ['send', funding],
    ]);
    passesMod.__resetContractFactoryForTest();
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
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    const mode = el.querySelector('[data-bind="dec-flip-check"]');
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    assert.match(el.querySelector('[data-bind="dec-funds-wallet"]').textContent, /ETH$/);
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable-unit"]').textContent, 'ETH');
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
    const {
      formatPurchaseBonusFlip,
      purchaseFlipCreditBreakdown,
      purchaseRecordBountyWei,
    } = await import('../app-decimator-panel.js');
    const FLIP = 10n ** 18n;
    assert.equal(formatPurchaseBonusFlip(999n * FLIP), '999');
    assert.equal(formatPurchaseBonusFlip(1_999n * FLIP), '1.99K');
    assert.equal(formatPurchaseBonusFlip(12_999n * FLIP), '12.9K');
    assert.equal(formatPurchaseBonusFlip(999_999n * FLIP), '999K');
    assert.equal(formatPurchaseBonusFlip(1_000_000n * FLIP), '1M');
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
    assert.equal(
      purchaseFlipCreditBreakdown({ tickets: 1, bountyWei: 2_500n * FLIP }).total,
      2_600n * FLIP,
      'the normal bonus total includes a separately quoted record bounty',
    );
    assert.equal(
      purchaseRecordBountyWei({
        state: {
          recordPoolWei: 100_000n * FLIP,
          records: [
            { kind: 2, held: true, barToBeat: 5n, clockDay: 10 },
            { kind: 3, held: true, barToBeat: 100n, clockDay: 20 },
          ],
        },
        tickets: 100,
        luckboxWei: 5n,
        today: 20,
      }),
      14_500n * FLIP,
      'Luckbox takes 10% first, then the ticket record takes 5% of the reduced pool',
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
    assert.equal(
      purchaseFlipCreditBreakdown({
        priceWei: price,
        totalCostWei: price * 4n,
        mintCostWei: price * 3n,
        presaleCostWei: price,
        claimableWei: price * 3n + 1n,
      }).rebuy,
      300n * FLIP,
      'an attached presale box keeps the normal mint bonus when claimable covers the mint',
    );
  });

  test('ALL IN opens a non-mutating currency/format quote at quarter-ticket precision', async () => {
    const {
      allInDegenScoreEligible,
      allInDestinations,
      allInTicketAmount,
    } = await import('../app-decimator-panel.js');
    assert.equal(allInDegenScoreEligible(60), false, 'exactly 60 is still locked');
    assert.equal(allInDegenScoreEligible(60.01), true, 'the gate is strictly greater than 60');
    assert.equal(allInDegenScoreEligible(null), false, 'unknown score never leaks the control');
    assert.equal(allInTicketAmount({ availableWei: 8n, priceWei: 10n }), '0.75',
      'the helper follows the contract integer floor at quarter-ticket precision');
    assert.equal(allInTicketAmount({ availableWei: 13n, reservedWei: 3n, priceWei: 10n }), '1',
      'selected non-ticket legs are reserved before filling tickets');

    const el = instantiate();
    await settle(60);
    const allIn = el.querySelector('[data-bind="dec-all-in"]');
    const tickets = el.querySelector('[name="dec-tickets"]');
    const originalTickets = tickets.value;
    let opened = null;
    el.addEventListener('app-all-in:open', (event) => { opened = event.detail; });
    assert.equal(allIn.hidden, false);
    assert.equal(allIn.disabled, false);
    assert.equal(allIn.title, 'Choose a currency and where to go all in');
    allIn.dispatchEvent({ type: 'click' });
    assert.ok(opened, 'the standalone ALL IN sheet receives its quote/confirm contract');
    assert.equal(tickets.value, originalTickets, 'opening ALL IN never rewrites the ordinary ticket draft');
    assert.deepEqual(opened.destinations.ETH, ['tickets', 'lootbox', 'degenerette']);
    assert.deepEqual(opened.destinations.FLIP, ['coinflip', 'degenerette']);
    assert.deepEqual(allInDestinations('FLIP', true), ['coinflip', 'degenerette', 'tickets']);
    assert.deepEqual(
      allInDestinations('FLIP', true, true),
      ['coinflip', 'degenerette', 'tickets', 'decimator'],
      'ticket redemption and Decimator burns are independent FLIP destinations',
    );
    const quote = opened.quote({ currency: 'ETH', target: 'tickets', spins: 5 });
    assert.equal(quote.valid, true);
    assert.equal(quote.ticketAmount, '77.75',
      'ALL IN leaves one ETH cent for gas before filling quarter-granular tickets');
    assert.equal(quote.buttonLabel, 'ALL IN: 3.11 ETH FOR 77.75 TICKETS');
    assert.match(el.innerHTML,
      /src="\/whitepaper\/flame-center\.svg"[\s\S]*?class="dec-all-in__label">ALL IN<\/strong>[\s\S]*?src="\/whitepaper\/flame-center\.svg"/,
      'the centered ALL IN label is flanked by two black Degenerus flames');
    assert.match(APP_CSS,
      /\.dec-all-in\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*row;[^}]*justify-content:\s*space-between;[^}]*border-radius:\s*6px/s,
      'ALL IN is a normal action button instead of a circular badge');
    assert.match(APP_CSS,
      /\.dec-all-in\s*\{[^}]*linear-gradient\(135deg, #a8090c, #ed0e11 52%, #a20709\)/s,
      'ALL IN restores its pre-gold red Degenerus treatment');
    assert.doesNotMatch(APP_CSS, /\.dec-all-in\s*\{[^}]*flame-logo\.svg/s,
      'the clipping white logo circle is gone');
    assert.doesNotMatch(APP_CSS, /\.dec-all-in::before\s*\{/,
      'no circular center overlay remains');
    assert.match(APP_CSS,
      /\.dec-all-in__flame\s*\{[^}]*display:\s*block;[^}]*width:\s*1\.25rem[^}]*height:\s*1\.45rem/s,
      'the two black flames frame the centered ALL IN label');
    assert.match(APP_CSS,
      /\.dec-all-in__label\s*\{[^}]*color:\s*#fff[^}]*font-size:\s*1\.06rem[^}]*letter-spacing:\s*0\.04em/s,
      'the white label restores its pre-gold display treatment');
    assert.match(APP_CSS,
      /\.dec-all-in__label\s*\{[^}]*font-size:\s*1\.06rem/s,
      'the centered ALL IN label has the larger display scale');
    assert.match(APP_CSS,
      /\.dec-all-in\s*\{[^}]*width:\s*100%[^}]*height:\s*3rem[^}]*min-height:\s*3rem[^}]*max-height:\s*3rem/s,
      'ALL IN matches the normal half-width BUY IN footprint');
    assert.match(APP_CSS,
      /\.dec-all-in\s*\{[^}]*justify-self:\s*stretch[^}]*margin:\s*0/s,
      'ALL IN stays in its compact action row without adding a second gutter');
    assert.match(APP_CSS,
      /\.dec-all-in\s*\{[^}]*grid-column:\s*2/s,
      'the action is pinned above the right side of the ETH bar');
    assert.match(APP_CSS,
      /\.dec-funds-stack:has\(> \.dec-funds > \.dec-funds__summary\[aria-expanded="false"\]\) > \.dec-all-in\s*\{[^}]*transform:\s*translateY\(-0\.2rem\)/s,
      'ALL IN rises slightly while Available Funds is collapsed');
    assert.match(APP_CSS,
      /\.dec-flip-balance\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
      'the FLIP balance receives the entire ledger row');
    assert.ok(
      PANEL_SRC.indexOf('data-bind="dec-all-in"')
        < PANEL_SRC.indexOf('data-bind="dec-flip-balance"'),
      'ALL IN is structurally above the full-width FLIP ledger',
    );
    assert.ok(
      PANEL_SRC.indexOf('data-bind="dec-all-in"') < PANEL_SRC.indexOf('data-bind="dec-funds"'),
      'ALL IN is a sibling above Available Funds, not a child inside its green box',
    );
    el.disconnectedCallback();
  });

  test('ALL IN stays absent through 60 Degen Rating and appears above 60', async () => {
    _fetchHandler = async (url) => String(url).includes('/game/state')
      ? DEFAULT_GAME_STATE
      : { claimableEth: '0', flipBalance: '0', scoreBreakdown: { totalBps: 60 } };
    const locked = instantiate();
    await settle(60);
    assert.equal(locked.querySelector('[data-bind="dec-all-in"]').hidden, true);
    locked.disconnectedCallback();
    locked.remove();

    // The second mount represents an independent server fixture for the same
    // player URL; do not couple the two cases through the render-wave cache.
    invalidateJSONCache();
    _fetchHandler = async (url) => String(url).includes('/game/state')
      ? DEFAULT_GAME_STATE
      : { claimableEth: '0', flipBalance: '0', scoreBreakdown: { totalBps: 61 } };
    const unlocked = instantiate();
    await settle(60);
    assert.equal(unlocked.querySelector('[data-bind="dec-all-in"]').hidden, false);
    assert.equal(storeMod.get('ui.allInEligible'), true,
      'the settings menu receives raw eligibility independently of visibility preference');
    unlocked.disconnectedCallback();
  });

  test('eligible players can hide ALL IN without losing the settings row', async () => {
    const el = instantiate();
    await settle(60);
    const allIn = el.querySelector('[data-bind="dec-all-in"]');
    assert.equal(allIn.hidden, false);
    assert.equal(storeMod.get('ui.allInEligible'), true);

    uiPreferencesMod.writeAllInButtonPreference(false);
    assert.equal(allIn.hidden, true, 'the browser preference hides the shortcut immediately');
    assert.equal(storeMod.get('ui.allInEligible'), true,
      'raw account eligibility remains true so the off toggle stays discoverable');

    uiPreferencesMod.writeAllInButtonPreference(true);
    assert.equal(allIn.hidden, false, 'turning it back on restores the eligible shortcut');
    el.disconnectedCallback();
    assert.equal(storeMod.get('ui.allInEligible'), false,
      'a detached account panel cannot leave stale eligibility in the top bar');
  });

  test('the disconnected sDGNRS protocol view never exposes ALL IN', async () => {
    const el = instantiate();
    await settle(60);
    storeMod.update('connected.address', null);
    storeMod.update('viewing.address', '0x73bba33c98356dd4d876ef8fbf6edf3e0631a6da');
    storeMod.update('ui.mode', 'view');
    await settle(20);

    assert.equal(el.querySelector('[data-bind="dec-all-in"]').hidden, true);
    assert.equal(storeMod.get('ui.allInEligible'), false);
    el.disconnectedCallback();
  });

  test('the disconnected sDGNRS protocol view includes its claimable ETH in Available Funds', async () => {
    const protocol = '0x73bba33c98356dd4d876ef8fbf6edf3e0631a6da';
    const claimable = (lootboxMod.scaledTicketPriceWei(12) / 2n) + 1n;
    const playerReads = [];
    _fetchHandler = async (url) => {
      const value = String(url);
      if (value.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (value.includes(`/player/${protocol}`)) {
        playerReads.push(value);
        return { claimableEth: String(claimable), flipBalance: '0' };
      }
      return { player: null, pending: {} };
    };
    storeMod.update('connected.address', null);
    storeMod.update('viewing.address', protocol);
    storeMod.update('ui.mode', 'view');

    const el = instantiate();
    await settle(60);

    assert.ok(playerReads.length > 0, 'the read-only panel fetches the viewed protocol account');
    assert.equal(el.querySelector('[data-bind="dec-funds-total"]').textContent, '0.02',
      'collapsed Available Funds includes claimable ETH without a connected wallet');
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click', detail: 1 });
    assert.equal(el.querySelector('[data-bind="dec-funds-claimable"]').textContent, '0.02');
    assert.equal(el.querySelector('[data-bind="dec-funds-claim"]').disabled, true,
      'the public balance remains read-only without a signer');
    assert.equal(el.querySelector('[data-bind="dec-all-in"]').hidden, true);
    el.disconnectedCallback();
  });

  test('ALL IN briefly becomes DO IT during the final coinflip beat', async () => {
    const el = instantiate();
    await settle(60);
    const allIn = el.querySelector('[data-bind="dec-all-in"]');
    const label = el.querySelector('.dec-all-in__label');
    assert.equal(allIn.hidden, false);

    document.dispatchEvent({
      type: 'flip:finishing',
      detail: { day: 67, durationMs: 250 },
    });
    assert.equal(label.textContent, 'DO IT');
    assert.equal(allIn.classList.contains('dec-all-in--do-it'), true,
      'the visible copy change gets one restrained brightness pulse');
    assert.equal(allIn.getAttribute('aria-label'), 'Open ALL IN choices',
      'the transient joke does not replace the stable accessible action name');

    document.dispatchEvent({ type: 'flip:revealed', detail: { day: 67 } });
    assert.equal(label.textContent, 'ALL IN');
    assert.equal(allIn.classList.contains('dec-all-in--do-it'), false,
      'the normal label returns on the exact settled frame');
    assert.match(APP_CSS,
      /\.dec-all-in--do-it\s*\{[^}]*animation:\s*dec-all-in-do-it-flash 0\.25s/s,
      'the DO IT beat is visually brief');

    el.disconnectedCallback();
    assert.equal((_docListeners.get('flip:finishing') || []).length, 0,
      'the cross-panel cue listener is removed with the panel');
    assert.equal((_docListeners.get('flip:revealed') || []).length, 0,
      'the restoration listener is removed with the panel');
  });

  test('FLIP ALL IN uses wallet plus settled Coinflip without double-counting AFKing stake credit', async () => {
    const FLIP = 10n ** 18n;
    coinflipMod.__setClaimableReaderForTest(async () => 500n * FLIP);
    coinflipMod.__setWidgetBalancesReaderForTest(async () => ({ flipBalance: 2_250n * FLIP }));
    installAfkingReadState({ hasToken: true, pendingFlipWhole: 275n });
    _fetchHandler = async (url) => (
      String(url).includes('/game/state')
        ? DEFAULT_GAME_STATE
        : { claimableEth: '0', flipBalance: String(2_250n * FLIP), pending: {} }
    );
    const el = instantiate();
    await settle(60);
    let opened = null;
    el.addEventListener('app-all-in:open', (event) => { opened = event.detail; });
    el.querySelector('[data-bind="dec-all-in"]').dispatchEvent({ type: 'click' });

    const quote = opened.quote({ currency: 'FLIP', target: 'coinflip', spins: 5 });
    assert.equal(quote.valid, true);
    assert.equal(quote.spendWei, 2_750n * FLIP);
    assert.equal(quote.buttonLabel, "ALL IN: 2,750 FLIP FOR TODAY'S COINFLIP");
    assert.deepEqual(quote.flipSources, {
      walletWei: 2_250n * FLIP,
      coinflipClaimableWei: 500n * FLIP,
      spendableWei: 2_750n * FLIP,
      burnSpendableWei: 2_750n * FLIP,
      rngLocked: false,
      totalWei: 2_750n * FLIP,
    });
    assert.equal(quote.transactionWei, 2_750n * FLIP,
      'the destination receives exactly the protocol-spendable total');
    let submitted = null;
    document.addEventListener('quest:activate', (event) => { submitted = event.detail; });
    await opened.confirm({ currency: 'FLIP', target: 'coinflip', spins: 5 }, quote.fingerprint);
    assert.equal(submitted.target, 2_750n * FLIP,
      'the destination transaction receives only wallet plus settled Coinflip FLIP');
    assert.doesNotMatch(PANEL_SRC, /claimAfkingSubscriptionFlip\(\)|claimFlip\(/,
      'ALL IN never inserts a separate claim transaction');
    el.disconnectedCallback();
  });

  test('FLIP burn formats submit against claimable directly without a preliminary claim', async () => {
    const FLIP = 10n ** 18n;
    const sends = [];
    coinflipMod.__setClaimableReaderForTest(async () => 500n * FLIP);
    coinflipMod.__setWidgetBalancesReaderForTest(async () => ({ flipBalance: 2_250n * FLIP }));
    installAfkingReadState({ hasToken: true, pendingFlipWhole: 275n });
    passesMod.__setContractFactoryForTest(() => ({
      claimAfkingFlip: Object.assign(
        async () => { sends.push('afking'); return makeFakeTx(makeFakeReceipt()); },
        { staticCall: async () => undefined },
      ),
      connect() {
        return this;
      },
    }));
    const claimContract = makeFakeFundsClaimContract();
    claimContract.claimCoinflips = Object.assign(
      async (...args) => {
        claimContract._calls.push(['send', 'claimCoinflips', ...args]);
        sends.push('coinflip');
        return makeFakeTx(makeFakeReceipt());
      },
      { staticCall: async (...args) => {
        claimContract._calls.push(['static', 'claimCoinflips', ...args]);
      } },
    );
    claimsMod.__setContractFactoryForTest(() => claimContract);
    _fetchHandler = async (url) => (
      String(url).includes('/game/state')
        ? DEFAULT_GAME_STATE
        : { claimableEth: '0', flipBalance: String(2_250n * FLIP), pending: {} }
    );
    const el = instantiate();
    await settle(60);
    let opened = null;
    el.addEventListener('app-all-in:open', (event) => { opened = event.detail; });
    el.querySelector('[data-bind="dec-all-in"]').dispatchEvent({ type: 'click' });
    const selection = { currency: 'FLIP', target: 'degenerette', spins: 5 };
    const quote = opened.quote(selection);

    await opened.confirm(selection, quote.fingerprint);
    assert.deepEqual(sends, [], 'the destination contract consumes settled Coinflip FLIP itself');
    assert.equal(claimContract._calls.length, 0, 'no claim static-call or transaction is inserted');
    el.disconnectedCallback();
  });

  test('FLIP ALL IN offers and submits a distinct Decimator burn only while that window is open', async () => {
    const FLIP = 10n ** 18n;
    const calls = [];
    const decimatorBurn = Object.assign(
      async (...args) => {
        calls.push(['send', ...args]);
        return makeFakeTx(makeFakeReceipt());
      },
      {
        staticCall: async (...args) => { calls.push(['static', ...args]); },
      },
    );
    decimatorMod.__setContractFactoryForTest(() => ({
      decimatorBurn,
      connect() { return this; },
    }));
    coinflipMod.__setClaimableReaderForTest(async () => 500n * FLIP);
    coinflipMod.__setWidgetBalancesReaderForTest(async () => ({ flipBalance: 2_250n * FLIP }));
    _fetchHandler = async (url) => (
      String(url).includes('/game/state')
        ? { ...DEFAULT_GAME_STATE, level: 24, decWindowOpen: true }
        : { claimableEth: '0', flipBalance: String(2_250n * FLIP), pending: {} }
    );

    const el = instantiate();
    await settle(60);
    let opened = null;
    let confirmed = null;
    el.addEventListener('app-all-in:open', (event) => { opened = event.detail; });
    el.addEventListener('app-decimator:burn-confirmed', (event) => { confirmed = event.detail; });
    el.querySelector('[data-bind="dec-all-in"]').dispatchEvent({ type: 'click' });

    assert.ok(opened.destinations.FLIP.includes('decimator'));
    assert.equal(opened.destinations.FLIP.includes('tickets'), false,
      'an open Decimator does not pretend FLIP ticket redemption is open');
    const selection = { currency: 'FLIP', target: 'decimator', spins: 5 };
    const quote = opened.quote(selection);
    assert.equal(quote.valid, true);
    assert.equal(quote.spendWei, 2_750n * FLIP);
    assert.equal(quote.buttonLabel, 'ALL IN: 2,750 FLIP FOR DECIMATOR');

    await opened.confirm(selection, quote.fingerprint);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], 'static');
    assert.equal(calls[1][0], 'send');
    assert.equal(calls[1][1], CONNECTED);
    assert.equal(calls[1][2], 2_750n * FLIP,
      'the Decimator contract consumes wallet plus settled Coinflip FLIP directly');
    assert.equal(confirmed.amountWei, 2_750n * FLIP);
    el.disconnectedCallback();
  });

  test('ALL IN quote enforces each currency route and Degenerette spin split', async () => {
    const {
      allInSelectionQuote,
      allInWalletAfterGasReserveWei,
      floorAllInEthBudgetWei,
    } = await import('../app-decimator-panel.js');
    const FLIP = 10n ** 18n;
    const ethLootbox = allInSelectionQuote({
      currency: 'ETH',
      target: 'lootbox',
      purchaseEthWei: 2n * 10n ** 12n,
    });
    assert.equal(ethLootbox.valid, true);
    assert.equal(ethLootbox.spendWei, 2n * 10n ** 12n);
    assert.equal(ethLootbox.outputLabel, '1 LUCKBOX');

    const groupedEth = allInSelectionQuote({
      currency: 'ETH',
      target: 'lootbox',
      purchaseEthWei: 1_234_500_000_000_000n,
    });
    assert.equal(groupedEth.buttonLabel, 'ALL IN: 1,234.5 ETH FOR 1 LUCKBOX',
      'the quote CTA groups a large ETH balance');

    const unroundedEth = 3_129_999_999_999n;
    assert.equal(floorAllInEthBudgetWei(unroundedEth), 3_120_000_000_000n);
    assert.equal(allInWalletAfterGasReserveWei(unroundedEth), 3_119_999_999_999n,
      'one displayed ETH cent remains in the native wallet for gas');
    const flooredEth = allInSelectionQuote({
      currency: 'ETH',
      target: 'degenerette',
      spins: 5,
      degeneretteEthWei: unroundedEth,
    });
    assert.equal(flooredEth.valid, true);
    assert.equal(flooredEth.spendWei, 3_120_000_000_000n,
      'the real ALL IN transaction budget floors to one displayed ETH cent');
    assert.equal(flooredEth.buttonLabel, 'ALL IN: 3.12 ETH FOR 5 SPINS');

    const noGas = allInSelectionQuote({
      currency: 'FLIP', target: 'coinflip', flipWei: 2_500n * FLIP, gasReady: false,
    });
    assert.equal(noGas.valid, false);
    assert.match(noGas.message, /0\.01 ETH.*gas/i,
      'token ALL IN routes also require the native gas reserve');

    const flipCoin = allInSelectionQuote({
      currency: 'FLIP',
      target: 'coinflip',
      flipWei: 2_500n * FLIP,
    });
    assert.equal(flipCoin.valid, true);
    assert.equal(flipCoin.buttonLabel, "ALL IN: 2,500 FLIP FOR TODAY'S COINFLIP");

    const groupedTickets = allInSelectionQuote({
      currency: 'FLIP',
      target: 'tickets',
      flipWei: 1_234_250n * FLIP,
      flipTicketsOpen: true,
    });
    assert.equal(groupedTickets.outputLabel, '1,234.25 TICKETS');
    assert.equal(groupedTickets.buttonLabel, 'ALL IN: 1,234,250 FLIP FOR 1,234.25 TICKETS',
      'the quote CTA groups both the spend and output quantity');

    const spins = allInSelectionQuote({
      currency: 'FLIP',
      target: 'degenerette',
      spins: 5,
      flipWei: 2_500n * FLIP,
    });
    assert.equal(spins.valid, true);
    assert.equal(spins.spins, 5);
    assert.equal(spins.amountPerSpin, 500n * FLIP);
    assert.equal(spins.outputLabel, '5 SPINS');

    const closedTickets = allInSelectionQuote({
      currency: 'FLIP',
      target: 'tickets',
      flipWei: 2_500n * FLIP,
      flipTicketsOpen: false,
    });
    assert.equal(closedTickets.valid, false, 'FLIP tickets disappear with the redemption window');

    const decimator = allInSelectionQuote({
      currency: 'FLIP',
      target: 'decimator',
      flipWei: 2_500n * FLIP,
      decimatorOpen: true,
    });
    assert.equal(decimator.valid, true);
    assert.equal(decimator.spendWei, 2_500n * FLIP);
    assert.equal(decimator.buttonLabel, 'ALL IN: 2,500 FLIP FOR DECIMATOR');
    const closedDecimator = allInSelectionQuote({
      currency: 'FLIP',
      target: 'decimator',
      flipWei: 2_500n * FLIP,
      decimatorOpen: false,
    });
    assert.equal(closedDecimator.valid, false,
      'Decimator is independent of the FLIP ticket-redemption window');
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
      '+1.5K FLIP',
    );
    assert.equal(el.querySelectorAll('[data-bind="dec-flip-credit-total"]').length, 1);
    assert.doesNotMatch(tally.textContent, /purchase|bulk|rebuy/i, 'no detailed breakdown');
    assert.match(PANEL_SRC, /\/whitepaper\/flame-logo-split\.svg/);
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
    assert.match(APP_CSS, /\.dec-flip-credit\s*>\s*img\s*\{[^}]*width:\s*1\.82rem/s);
    assert.match(APP_CSS, /\.dec-flip-credit\s*>\s*span\s*\{[^}]*color:\s*#86efac[^}]*font-size:\s*0\.76rem/s);
    assert.match(APP_CSS, /\.dec-flip-credit\s*>\s*strong\s*\{[^}]*color:\s*#4ade80/s,
      'the enlarged purchase BONUS is green');
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

  test('ticket controls flank the input with quarter steps and whole-ticket arrows', async () => {
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
    const quarter = el.querySelectorAll('.dec-quarter-step');
    assert.equal(quarter.length, 2, 'the quarter-ticket pair is mounted left of the input');
    assert.match(el.innerHTML, />\+\.25<\/button>[\s\S]*?>−\.25<\/button>/);
    assert.match(el.innerHTML, />▲<\/button>[\s\S]*?>▼<\/button>/,
      'the familiar up/down arrow pair remains on the right');
    input.value = '0';
    quarter[0].dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.25', 'the upper-left button adds one quarter ticket');
    quarter[1].dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0', 'the lower-left button removes one quarter ticket');
    quarter[0].dispatchEvent({ type: 'click' });
    up.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '1.25', 'up adds one whole ticket');
    down.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.25', 'down removes one whole ticket');
    assert.equal(input.step, '0.25', 'typed decimals use the same entry-sized increment');
    el.disconnectedCallback();
  });

  test('lootbox arrows step by exactly one current ticket price', async () => {
    const el = instantiate();
    await settle(60);

    const price = el.querySelector('[data-bind="dec-price"]');
    const input = el.querySelector('[name="dec-lootbox-eth"]');
    assert.equal(price.textContent, 'Price - 0.04 ETH');
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
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent, 'Buy in');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, '0.08 ETH');
    assert.equal(fakeContract._calls.purchase.length, 0, 'quest click only configures the form');
    el.disconnectedCallback();
  });

  test('the main daily popup can configure its exact minimum as a lootbox instead of tickets', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    const target = lootboxMod.scaledTicketPriceWei(12);
    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: {
        questType: 1,
        target: String(target),
        variant: 'primary',
        purchaseKind: 'lootbox',
      },
    }));

    assert.equal(el.querySelector('[name="dec-tickets"]').value, '0');
    assert.equal(el.querySelector('[name="dec-lootbox-eth"]').value, '0.04');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, '0.04 ETH');
    assert.equal(fakeContract._calls.purchase.length, 0,
      'popup confirmation configures the exact action without bypassing the normal buy review');
    el.disconnectedCallback();
  });

  test('confirming the main daily popup buys its exact minimum through the normal guarded path', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    const target = lootboxMod.scaledTicketPriceWei(12);
    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: {
        questType: 1,
        target: String(target),
        variant: 'primary',
        purchaseKind: 'lootbox',
        submit: true,
      },
    }));
    await settle(100);

    assert.equal(fakeContract._calls.purchase.length, 1, 'confirmation reaches the existing buy transaction');
    const args = fakeContract._calls.purchase[0];
    assert.equal(args[1], 0n, 'the lootbox choice does not add tickets');
    assert.equal(args[2], target, 'the submitted lootbox spend is the exact displayed minimum');
    el.disconnectedCallback();
  });

  test('a confirmed Biggest Degen preset buys its exact whole-ticket record target', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    const ticketQuantity = 120;
    const price = lootboxMod.scaledTicketPriceWei(12);
    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: {
        source: 'records-bounty',
        variant: 'bounty',
        questType: 1,
        target: String(price * BigInt(ticketQuantity)),
        ticketQuantity: String(ticketQuantity),
        purchaseKind: 'ticket',
        submit: true,
      },
    }));
    await settle(100);

    assert.equal(fakeContract._calls.purchase.length, 1);
    assert.equal(fakeContract._calls.purchase[0][1], 48_000n,
      '120 whole tickets become exactly 48,000 purchase units');
    assert.equal(fakeContract._calls.purchase[0][2], 0n, 'the record shot adds no Luckbox leg');
    assert.equal(el.querySelector('[name="dec-tickets"]').value, '0',
      'the one-off bounty transaction does not overwrite the ordinary buy draft');
    el.disconnectedCallback();
  });

  test('active presale appears and attaches a box using credit earned by this same purchase', async () => {
    const min = lootboxMod.PRESALE_BOX_MIN_WEI;
    const fakeContract = makeFakePurchaseContract({
      presaleActive: true,
      presaleCredit: 0n,
      presaleRemaining: 50n * 10n ** 18n / 1_000_000n,
    });
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(80);

    const row = el.querySelector('[data-bind="dec-presale-row"]');
    const tickets = el.querySelector('[name="dec-tickets"]');
    const input = el.querySelector('[name="dec-presale-box-eth"]');
    const max = el.querySelector('[data-bind="dec-presale-max"]');
    assert.equal(row.hidden, true, 'zero current/draft credit keeps the presale option out of sight');

    tickets.value = '1'; // level-12 ticket costs 0.04 ETH and earns 0.01 box credit
    tickets.dispatchEvent({ type: 'input' });
    assert.equal(row.hidden, false, 'a draft that earns the minimum credit reveals the attached box');
    assert.equal(el.querySelector('[data-bind="dec-presale-available"]').textContent,
      '0.01 ETH AVAILABLE');
    assert.equal(max.disabled, false);

    const foil = el.querySelector('[data-bind="dec-foil-check"]');
    foil.checked = true;
    foil.dispatchEvent({ type: 'change' });
    assert.equal(row.hidden, true, 'selecting the incompatible foil leg removes the presale row');
    assert.equal(input.value, '0', 'hiding the presale row also clears its quote');
    foil.checked = false;
    foil.dispatchEvent({ type: 'change' });
    assert.equal(row.hidden, false, 'the presale row returns when foil is unchecked');
    max.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.01');

    tickets.value = '0';
    tickets.dispatchEvent({ type: 'input' });
    assert.equal(row.hidden, true, 'removing the credit-earning draft hides presale again');
    assert.equal(input.value, '0', 'a newly unavailable hidden box cannot remain in the quote');
    tickets.value = '1';
    tickets.dispatchEvent({ type: 'input' });
    max.dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent,
      'Buy in + presale box');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, '0.05 ETH');

    let confirmed = null;
    el.addEventListener('app-decimator:tx-confirmed', (event) => { confirmed = event.detail; });
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(100);

    assert.equal(fakeContract._calls.purchase.length, 0);
    assert.equal(fakeContract._calls.buyLootboxAndPresaleBox.length, 1,
      'the normal purchase and presale box ride the one deployed combined selector');
    const args = fakeContract._calls.buyLootboxAndPresaleBox[0];
    assert.equal(args[1], 400n);
    assert.equal(args[5], min);
    assert.equal(args[6].value, 5n * min);
    assert.equal(confirmed?.boxes?.length, 1,
      'regular and presale events sharing one RNG index publish one pending box');
    assert.equal(confirmed?.presaleBoxAmountWei, min);
    el.disconnectedCallback();
  });

  test('banked presale credit can buy a standalone box from the same compact row', async () => {
    const min = lootboxMod.PRESALE_BOX_MIN_WEI;
    const fakeContract = makeFakePurchaseContract({
      presaleActive: true,
      presaleCredit: 2n * min,
      presaleRemaining: 50n * 10n ** 18n / 1_000_000n,
    });
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract());
    const el = instantiate();
    await settle(80);

    const row = el.querySelector('[data-bind="dec-presale-row"]');
    const input = el.querySelector('[name="dec-presale-box-eth"]');
    el.querySelector('[data-bind="dec-presale-max"]').dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.02');
    const flip = el.querySelector('[data-bind="dec-flip-check"]');
    flip.checked = true;
    flip.dispatchEvent({ type: 'change' });
    assert.equal(row.hidden, true, 'USE FLIP removes the incompatible presale box');
    assert.equal(input.value, '0', 'entering FLIP cannot retain a hidden presale spend');
    flip.checked = false;
    flip.dispatchEvent({ type: 'change' });
    assert.equal(row.hidden, false, 'returning to ETH restores the available presale box');
    const tickets = el.querySelector('[name="dec-tickets"]');
    tickets.value = '0';
    tickets.dispatchEvent({ type: 'input' });
    el.querySelector('[data-bind="dec-presale-max"]').dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.02');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent,
      'Buy presale box',
      'a standalone presale box is not presented as a game buy-in');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, '0.02 ETH');
    let confirmed = null;
    el.addEventListener('app-decimator:tx-confirmed', (event) => { confirmed = event.detail; });
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(100);

    assert.equal(fakeContract._calls.buyPresaleBox.length, 1);
    assert.equal(fakeContract._calls.buyLootboxAndPresaleBox.length, 0);
    assert.equal(fakeContract._calls.buyPresaleBox[0][1], 2n * min);
    assert.equal(confirmed?.boxes?.length, 1);
    assert.equal(confirmed?.boxes?.[0]?.hasLootboxLeg, false);
    assert.equal(confirmed?.boxes?.[0]?.hasPresaleLeg, true);
    assert.equal(confirmed?.boxes?.[0]?.amountWei, 2n * min);
    assert.equal(confirmed?.presaleBoxAmountWei, 2n * min);
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

  test('foil row stays hidden until the exact contract probe resolves available', async () => {
    let foilEndpointReads = 0;
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) foilEndpointReads += 1;
      return { player: null, pending: {} };
    };
    const el = instantiate();
    await flushMicrotasks();
    const row = el.querySelector('[data-bind="dec-foil-row"]');
    await settle(30);
    assert.equal(row.hidden, false, 'a successful purchase.staticCall reveals the control');
    assert.equal(foilEndpointReads, 0, 'the lagging indexed foil endpoint is never queried');
    el.disconnectedCallback();
  });

  test('a same-wallet refresh keeps the foil row pinned while its contract probe is in flight', async () => {
    const fakeContract = makeFakePurchaseContract();
    const immediateProbe = fakeContract.purchase.staticCall;
    let blockNextProbe = false;
    let releaseProbe = null;
    fakeContract.purchase.staticCall = async (...args) => {
      if (blockNextProbe) {
        await new Promise((resolve) => { releaseProbe = resolve; });
      }
      return immediateProbe(...args);
    };
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await settle(60);
    const row = el.querySelector('[data-bind="dec-foil-row"]');
    assert.equal(row.hidden, false, 'the first definitive probe reveals the row');

    blockNextProbe = true;
    storeMod.update('ui.foilQuest', {
      active: true,
      completed: false,
      level: 12,
      address: CONNECTED.toLowerCase(),
    });
    await flushMicrotasks();
    assert.equal(typeof releaseProbe, 'function', 'the replacement probe is still in flight');
    assert.equal(row.hidden, false,
      'refresh latency does not blank a valid same-wallet/same-level answer');

    blockNextProbe = false;
    releaseProbe();
    await settle(30);
    assert.equal(row.hidden, false, 'the settled replacement retains the row');
    el.disconnectedCallback();
  });

  test('a transient negative probe cannot retract a verified same-level foil offer', async () => {
    const fakeContract = makeFakePurchaseContract();
    const verifiedProbe = fakeContract.purchase.staticCall;
    let temporarilyStale = false;
    fakeContract.purchase.staticCall = async (...args) => {
      if (temporarilyStale) {
        const error = new Error('advance is briefly catching up');
        error.revert = { name: 'StaleAdvance' };
        throw error;
      }
      return verifiedProbe(...args);
    };
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await settle(60);
    const row = el.querySelector('[data-bind="dec-foil-row"]');
    assert.equal(row.hidden, false, 'the initial on-chain probe verifies eligibility');

    temporarilyStale = true;
    storeMod.update('ui.foilQuest', {
      active: true,
      completed: false,
      level: 12,
      address: CONNECTED.toLowerCase(),
    });
    await settle(60);
    assert.equal(row.hidden, false,
      'temporary liveness/static-call state cannot make a verified checkbox flicker out');
    assert.equal(el.querySelector('[data-bind="dec-foil-check"]').disabled, false);
    el.disconnectedCallback();
  });

  test('Insolvent from the zero-value probe means the foil route is available', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) throw new Error('indexer unavailable');
      return { player: null, pending: {} };
    };
    const fakeContract = makeFakePurchaseContract({ foilProbeRevertName: 'Insolvent' });
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);
    const row = el.querySelector('[data-bind="dec-foil-row"]');
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    assert.equal(row.hidden, false, 'the funding sentinel proves every earlier foil gate passed');
    assert.equal(check.disabled, false);
    check.checked = true;
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(80);
    assert.equal(fakeContract._calls.purchase.length, 1,
      'value-accurate contract preflight passes and the foil purchase is sent');
    assert.equal(fakeContract._calls.purchase[0][5], true, 'foil leg remains selected');
    el.disconnectedCallback();
  });

  test('a game-over/liveness contract rejection suppresses the foil offer', async () => {
    lootboxMod.__setContractFactoryForTest(() => makeFakePurchaseContract({
      foilProbeRevertName: 'GameOverPossible',
    }));
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

  test('FoilAlreadyBought from the routed contract probe hides and disables the option', async () => {
    lootboxMod.__setContractFactoryForTest(() => makeFakePurchaseContract({
      foilProbeRevertName: 'FoilAlreadyBought',
    }));
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-foil-check"]').disabled, true);
    el.disconnectedCallback();
  });

  test('foil row is only a checkbox, one-pack limit label, and 10× price', async () => {
    const el = instantiate();
    await settle(60);
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    assert.ok(check, 'foil checkbox rendered');
    assert.equal(check.disabled, false, 'enabled when not owned');
    const price = el.querySelector('[data-bind="dec-foil-price"]');
    assert.equal(price.textContent, '0.4 ETH', '10 × level-12 ticket price');
    assert.match(el.innerHTML,
      /<span class="dec-foil-label">Foil pack \(limit 1\)[\s\S]*?<quest-objective-indicator product="foil"><\/quest-objective-indicator>[\s\S]*?<\/span>/,
      'the unfinished-quest marker is anchored inside the visible foil label');
    assert.match(STATUS_CSS,
      /\.app-decimator-panel \.dec-foil-label > quest-objective-indicator\s*\{[^}]*position:\s*absolute;[^}]*left:\s*calc\(100% \+ 0\.3rem\)/s,
      'the foil quest icon is removed from the three-column checkbox row');
    assert.doesNotMatch(el.innerHTML, /dec-foil-card|dec-foil-sub|dec-foil-shine/,
      'the old promotional card and helper copy are gone');
    assert.match(APP_CSS,
      /\.app-decimator-panel \.dec-foil-check\s*\{[^}]*appearance:\s*none;[^}]*border-radius:\s*4px/s,
      'the foil choice uses a deliberate custom checkbox instead of the browser default');
    assert.match(APP_CSS,
      /\.app-decimator-panel \.dec-foil-check:checked\s*\{[^}]*34, 211, 238[^}]*236, 72, 153[^}]*234, 179, 8/s,
      'the checked state carries a restrained foil spectrum');
    assert.match(APP_CSS,
      /@keyframes dec-foil-occasional-glint\s*\{[^}]*0%, 68%[^}]*opacity:\s*0/s,
      'the foil glint spends most of its cycle quiet');
    assert.match(APP_CSS,
      /animation:\s*dec-foil-occasional-glint 11\.25s ease-in-out infinite/,
      'the foil glint runs one-third less often than its original 7.5 second cycle');
    assert.match(APP_CSS,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-decimator-panel \.dec-foil::after\s*\{\s*animation:\s*none/s,
      'the decorative glint respects reduced motion');
    el.disconnectedCallback();
  });

  test('sealed Level 29 uses the contract-routed Level 30 foil price in the UI and tx', async () => {
    const routedPrice = lootboxMod.scaledTicketPriceWei(30);
    const fakeContract = makeFakePurchaseContract({
      purchaseInfo: [29, true, false, true, routedPrice],
    });
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    _fetchHandler = async (url) => {
      if (String(url).includes('/game/state')) {
        return {
          level: 29,
          phase: 'JACKPOT',
          jackpotPhaseFlag: true,
          rngLockedFlag: true,
          jackpotCounter: 2,
          // Deliberately omit compressedJackpotFlag: this was the stale API
          // shape that under-routed the old JS-only quote to Level 29.
        };
      }
      return { player: null, pending: {} };
    };

    const el = instantiate();
    await settle(70);
    assert.equal(el.querySelector('[data-bind="dec-price"]').textContent, 'Price - 0.08 ETH');
    assert.equal(el.querySelector('[data-bind="dec-foil-price"]').textContent, '0.8 ETH');

    const check = el.querySelector('[data-bind="dec-foil-check"]');
    check.checked = true;
    check.dispatchEvent({ type: 'change' });
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, '0.8 ETH');

    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(100);
    assert.equal(fakeContract._calls.purchase.length, 1);
    assert.equal(
      fakeContract._calls.purchase[0][6].value,
      lootboxMod.foilPackCostFromPriceWei(routedPrice),
      'the purchase sends the full routed Level 30 foil cost, not half-price Level 29',
    );
    el.disconnectedCallback();
  });

  test('the indexed foil ownership endpoint is not an availability authority', async () => {
    let foilEndpointReads = 0;
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) {
        foilEndpointReads += 1;
        return { present: true, level: 12 };
      }
      return { player: null, pending: {} };
    };
    const el = instantiate();
    await settle(60);
    const row = el.querySelector('[data-bind="dec-foil-row"]');
    assert.equal(row.hidden, false, 'the exact contract probe passed');
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    assert.equal(check.disabled, false);
    assert.equal(check.checked, false);
    assert.equal(foilEndpointReads, 0, 'no /player/:address/foil read participates');
    el.disconnectedCallback();
  });

  test('stale foil quest metadata never overrides the contract-routed purchase level', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      return { player: null, pending: {} };
    };
    const el = instantiate();
    await settle(60);
    storeMod.update('ui.foilQuest', {
      active: true,
      completed: false,
      day: 77,
      level: 13,
      address: CONNECTED.toLowerCase(),
    });
    await settle(60);

    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'availability is re-probed without trusting the quest level');
    assert.equal(el.querySelector('[data-bind="dec-foil-check"]').disabled, false);
    assert.equal(el.querySelector('[data-bind="dec-price"]').textContent, 'Price - 0.04 ETH');
    assert.doesNotMatch(el.querySelector('[data-bind="dec-price"]').textContent, /Level/i);
    el.disconnectedCallback();
  });

  test('a foil quest click refreshes exact availability and only checks a genuinely buyable pack', async () => {
    let available = false;
    const contracts = [];
    lootboxMod.__setContractFactoryForTest(() => {
      const contract = makeFakePurchaseContract({
        foilProbeRevertName: available ? undefined : 'FoilAlreadyBought',
      });
      contracts.push(contract);
      return contract;
    });
    const el = instantiate();
    await settle(60);
    const foil = el.querySelector('[data-bind="dec-foil-check"]');
    assert.equal(foil.checked, false);

    available = true;
    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: { questType: 4, target: '1', variant: 'level' },
    }));
    await settle(80);
    assert.equal(foil.checked, true, 'fresh successful probe selects the foil add-on');
    assert.equal(contracts.reduce((n, c) => n + c._calls.purchase.length, 0), 0,
      'quest activation never submits a transaction');

    available = false;
    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: { questType: 4, target: '1', variant: 'level' },
    }));
    await settle(80);
    assert.equal(foil.checked, false, 'a fresh ownership rejection leaves it unchecked');
    el.disconnectedCallback();
  });

  test('purchase-day routing, not quest metadata, selects the first-day foil level', async () => {
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
      return { player: null, pending: {} };
    };

    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'the live purchase route offers level 2');
    assert.equal(el.querySelector('[data-bind="dec-foil-check"]').disabled, false);
    assert.equal(el.querySelector('[data-bind="dec-price"]').textContent, 'Price - 0.01 ETH');
    el.disconnectedCallback();
  });

  test('a foil quest without a level leaves the routed level untouched', async () => {
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
      return { player: null, pending: {} };
    };

    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-price"]').textContent, 'Price - 0.04 ETH');
    assert.doesNotMatch(el.querySelector('[data-bind="dec-price"]').textContent, /Level/i);
    el.disconnectedCallback();
  });

  test('old indexed level responses are irrelevant to the exact routed probe', async () => {
    let foilEndpointReads = 0;
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) { foilEndpointReads += 1; return { present: true, level: 11 }; }
      return { player: null, pending: {} };
    };
    const stale = instantiate();
    await settle(60);
    assert.equal(stale.querySelector('[data-bind="dec-foil-row"]').hidden, false,
      'the routed contract probe exposes the level-12 offer');
    assert.equal(stale.querySelector('[data-bind="dec-foil-check"]').disabled, false,
      'the exact contract probe controls the checkbox');
    stale.disconnectedCallback();
    stale.remove();

    assert.equal(foilEndpointReads, 0);
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
    // silently credit afking; underpay reverts Insolvent).
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
    assert.equal(action.textContent, 'Buy in');
    assert.equal(amount.textContent, '0.4 ETH', 'foil-only total is on the second line');
    check.checked = false;
    check.dispatchEvent({ type: 'change' });
    assert.equal(action.textContent, 'Buy in', 'back to bare Buy in when unchecked');
    assert.equal(amount.hidden, true, 'empty amount line collapses when unchecked');
    el.disconnectedCallback();
  });

  test('the value-accurate submit probe protects against an ownership race', async () => {
    const fakeContract = makeFakePurchaseContract({
      foilPurchaseRevertName: 'FoilAlreadyBought',
    });
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    const row = el.querySelector('[data-bind="dec-foil-row"]');
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    assert.equal(row.hidden, false, 'the earlier zero-value availability probe passed');
    check.checked = true;
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 0,
      'the fresh value-accurate preflight blocks the raced send');
    assert.match(el.querySelector('[data-bind="dec-error"]').textContent, /unavailable for this transaction/i);
    el.disconnectedCallback();
  });

  test('StaleAdvance from the availability probe hides the foil option', async () => {
    const fakeContract = makeFakePurchaseContract({
      foilProbeRevertName: 'StaleAdvance',
    });
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 0);
    assert.equal(el.querySelector('[data-bind="dec-foil-row"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-foil-check"]').disabled, true);
    el.disconnectedCallback();
  });

  test('FoilPackBought clears the selection and the refreshed contract probe retires the option', async () => {
    // Fake contract whose purchase receipt carries the FoilPackBought event.
    const calls = { purchase: [] };
    let owned = false;
    const fakeContract = {
      purchase: Object.assign(
        async (...args) => {
          calls.purchase.push(args);
          owned = true;
          return makeFakeTx(makeFakeReceipt([
            { parsed: { name: 'FoilPackBought', args: { buyer: CONNECTED, level: 12n, multBps: 23500n } } },
          ]));
        },
        { staticCall: async (...args) => {
          const availabilityProbe = args[1] === 0n && args[2] === 0n
            && args[5] === true && args[6]?.value === 0n;
          if (availabilityProbe && owned) {
            const error = new Error('already bought');
            error.revert = { name: 'FoilAlreadyBought' };
            throw error;
          }
        } },
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
    assert.equal(row.hidden, true, 'fresh chain ownership retires the one-per-level option');
    assert.equal(check.disabled, true);
    assert.equal(check.checked, false, 'checkbox cleared after the buy');
    el.disconnectedCallback();
    el.remove();

    // The same exact contract probe governs reload too.
    const refreshed = instantiate();
    await settle(60);
    assert.equal(
      refreshed.querySelector('[data-bind="dec-foil-row"]').hidden,
      true,
      'refresh reads the on-chain one-per-level rejection',
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
    livenessTriggered: async () => Boolean(opts.liveness),
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

  test('window CLOSED (pool has not cleared target) → FLIP balance stays hidden', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract({ windowClosed: true }));
    _fetchHandler = async (url) => (
      String(url).includes('/game/state')
        ? { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false }
        : { player: null, pending: {} }
    );
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-flip-balance"]').hidden, true,
      'no FLIP balance while the redemption window is closed');
    assert.equal(el.querySelector('[data-bind="dec-funds-total-flip"]').hidden, true,
      'no FLIP affordance while the redemption window is closed');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('jackpot phase alone does not show the FLIP balance when the exact window is closed', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract({ windowClosed: true }));
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-funds-total-flip"]').hidden, true,
      'phase metadata cannot override the deployed redemption predicate');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('a latched window remains visible through an intermediate RNG lock', async () => {
    contractsMod.setProvider(makeFakeProvider(
      CONNECTED,
      3_125_000_000_000n,
      { redemptionOpen: true },
    ));
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract({
      windowClosed: true,
      rngLocked: true,
    }));
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-funds-total-flip"]').hidden, false,
      'the one live control is pinned just above Available Funds');
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="dec-funds-total-flip"]').hidden, false,
      'opening the ETH disclosure does not move the inactive FLIP control');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('window OPEN keeps the full-width FLIP balance and its toggle beneath ALL IN', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract());
    const el = instantiate();
    await settle(60);
    const useFlip = el.querySelector('[data-bind="dec-funds-total-flip"]');
    const flipBalance = el.querySelector('[data-bind="dec-flip-balance"]');
    const useEth = el.querySelector('[data-bind="dec-funds-total-eth"]');
    const allIn = el.querySelector('[data-bind="dec-all-in"]');
    const mode = el.querySelector('[data-bind="dec-flip-check"]');
    const foilRow = el.querySelector('[data-bind="dec-foil-row"]');
    assert.equal(flipBalance.hidden, false, 'the left FLIP balance is visible for the whole window');
    assert.equal(useFlip.hidden, false, 'the balance owns the window-gated mode action');
    assert.equal(useFlip.textContent, 'USE FLIP');
    assert.equal(useFlip.getAttribute('aria-pressed'), 'false');
    assert.equal(useEth.hidden, true, 'USE ETH only appears after FLIP is selected');
    assert.equal(allIn.hidden, false, 'ALL IN sits above the ETH balance in ETH mode');
    assert.equal(useFlip.tagName, 'BUTTON');
    assert.equal(foilRow.hidden, false, 'the verified foil offer is available in ETH mode');
    useFlip.dispatchEvent({ type: 'click' });
    assert.equal(mode.checked, true);
    assert.equal(flipBalance.hidden, false, 'the FLIP balance does not move or disappear in FLIP mode');
    assert.equal(useFlip.textContent, 'USING FLIP');
    assert.equal(useFlip.getAttribute('aria-pressed'), 'true');
    assert.equal(useEth.hidden, false, 'a matching switch-back action appears in Available Funds');
    assert.equal(allIn.hidden, false, 'ALL IN stays against the active FLIP balance');
    assert.equal(allIn.getAttribute('aria-label'), 'Open ALL IN choices');
    assert.equal(useEth.textContent, 'USE ETH');
    assert.equal(foilRow.hidden, true, 'the tickets-only FLIP route hides the incompatible foil add-on');
    useFlip.dispatchEvent({ type: 'click' });
    assert.equal(mode.checked, false, 'clicking USING FLIP switches back to ETH');
    assert.equal(useFlip.textContent, 'USE FLIP');
    useFlip.dispatchEvent({ type: 'click' });
    assert.equal(mode.checked, true, 'the embedded button can select FLIP again');
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="dec-funds-wallet-display"]').hidden, false,
      'opening Available Funds exposes the Wallet controls');
    assert.equal(flipBalance.hidden, false, 'expanded funds do not move or hide the FLIP balance');
    assert.equal(allIn.hidden, false, 'expanded funds do not move or hide ALL IN');
    useEth.dispatchEvent({ type: 'click' });
    assert.equal(mode.checked, false);
    assert.equal(flipBalance.hidden, false);
    assert.equal(useFlip.hidden, false);
    assert.equal(useFlip.textContent, 'USE FLIP');
    assert.equal(useFlip.getAttribute('aria-pressed'), 'false');
    assert.equal(useEth.hidden, true);
    assert.equal(allIn.hidden, false);
    assert.equal(foilRow.hidden, false, 'returning to ETH restores the pinned foil offer');
    assert.match(
      APP_CSS,
      /\.dec-flip-balance\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*min-height:\s*2\.6rem;[^}]*height:\s*2\.6rem/s,
      'FLIP owns one full row at the compressed ETH ledger height',
    );
    assert.match(
      APP_CSS,
      /\.dec-flip-balance__mode\s*\{[^}]*linear-gradient\(180deg, #fef3c7, #fbbf24 58%, #d97706\)[^}]*color:\s*#111/s,
      'inactive USE FLIP is yellow with normal black text',
    );
    assert.match(
      APP_CSS,
      /\.dec-flip-balance__mode\.is-active,[\s\S]*?\[aria-pressed="true"\]\s*\{[^}]*linear-gradient\(180deg, #dc2626, #991b1b\)[^}]*color:\s*#fde68a/s,
      'active USING FLIP is red with yellow text',
    );
    assert.match(
      APP_CSS,
      /\.dec-flip-balance\s*\{[^}]*height:\s*2\.6rem;[^}]*grid-template-areas:\s*"action label" "action value"[^}]*padding:\s*0\.18rem 0\.48rem 0\.2rem;[^}]*border:\s*1px solid rgba\(239, 68, 68, 0\.42\)[^}]*#140707/s,
      'the full FLIP row mirrors compressed ETH with a centered action and two-line ledger',
    );
    assert.match(
      PANEL_SRC,
      /<span class="dec-flip-balance__action">[\s\S]*?data-bind="dec-funds-total-flip"[\s\S]*?<quest-objective-indicator class="dec-redeem-quest"[\s\S]*?data-quest-pointer="bottom-left"[\s\S]*?product="redeem-flip"><\/quest-objective-indicator>[\s\S]*?<\/span>/,
      'the redeem quest marker is anchored to the USE FLIP action itself',
    );
    assert.match(
      APP_CSS,
      /\.dec-flip-balance__action\s*\{[^}]*position:\s*relative;[^}]*width:\s*fit-content;[^}]*grid-area:\s*action/s,
      'the quest anchor follows the rendered action width',
    );
    assert.match(
      STATUS_CSS,
      /\.dec-flip-balance__action > \.dec-redeem-quest\s*\{[^}]*top:\s*-0\.32rem;[^}]*left:\s*calc\(100% \+ 0\.43rem\);[^}]*width:\s*1\.18rem;[^}]*height:\s*1\.18rem/s,
      'the larger badge stays above/right while its lower-left tail aims at USE FLIP',
    );
    assert.match(
      APP_CSS,
      /\.dec-flip-balance__label\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis/s,
      'the optional balance label yields before colliding with USE FLIP',
    );
    assert.match(
      APP_CSS,
      /\.dec-flip-balance__label\s*\{[^}]*color:\s*rgba\(254, 202, 202, 0\.58\);[^}]*text-align:\s*right/s,
      'FLIP BALANCE is right aligned and uses the right-side ledger-title color',
    );
    assert.match(APP_CSS, /\.dec-flip-balance__value\s*\{[^}]*width:\s*100%;[^}]*overflow:\s*hidden;[^}]*color:\s*#fde68a/s,
      'the yellow FLIP value clips inside its full-width ledger lane');
    assert.match(
      APP_CSS,
      /\.dec-flip-balance__label\s*\{[^}]*font-family:\s*"Inter", system-ui, sans-serif;[^}]*font-size:\s*0\.5rem;[^}]*font-weight:\s*900/s,
      'FLIP uses the same compact label type as AVAILABLE FUNDS',
    );
    assert.match(
      APP_CSS,
      /\.dec-flip-balance__value\s*\{[^}]*font-family:\s*"OCR A Std", "Share Tech Mono", "Lucida Console", ui-monospace, monospace;[^}]*font-size:\s*clamp\(0\.92rem, 2\.8vw, 1\.16rem\);[^}]*font-weight:\s*700/s,
      'FLIP uses the same compact numeric type as the ETH balance',
    );
    assert.match(
      APP_CSS,
      /\.app-decimator-panel \.dec-funds__priority,[\s\S]*?\.app-daily-flip \.df-funds \.df-burn-sdgnrs-cta\[data-write\][\s\S]*?height:\s*1\.3rem;[\s\S]*?border-radius:\s*4px;[\s\S]*?font-size:\s*0\.52rem;/,
      'ETH and Protocol Coins actions share one compact size and type rhythm',
    );
    assert.match(
      APP_CSS,
      /\.dec-funds__total-value\s*\{[^}]*grid-column:\s*1;[^}]*width:\s*100%;[^}]*margin-left:\s*auto;[^}]*justify-self:\s*end;[^}]*text-align:\s*right/s,
      'the collapsed available-funds balance stays right-aligned',
    );
    assert.doesNotMatch(PANEL_SRC, /data-bind="dec-flip-buy"/);
    assert.match(PANEL_SRC, />\s*USE FLIP\s*</);
    assert.doesNotMatch(PANEL_SRC, />\s*REDEEM FLIP\s*</);
    assert.ok(
      PANEL_SRC.indexOf('data-bind="dec-flip-balance"')
        < PANEL_SRC.indexOf('data-bind="dec-funds-total-flip"'),
      'USE FLIP is nested in the left FLIP balance',
    );
    assert.ok(
      PANEL_SRC.indexOf('data-bind="dec-funds-total-display"')
        < PANEL_SRC.indexOf('data-bind="dec-funds-total-eth"'),
      'USE ETH lives inside the collapsed ETH balance area',
    );
    assert.match(
      APP_CSS,
      /\.dec-funds__total\.dec-funds__total--flip-active\s*\{[^}]*grid-template-areas:\s*"action value"/s,
      'the switch-back button occupies the upper-left balance action slot',
    );
    assert.match(
      APP_CSS,
      /\.dec-funds:has\(\.dec-funds__summary\[aria-expanded="false"\]\)[\s\S]*?\.dec-funds__eth-mode\s*\{[^}]*transform:\s*translateY\(-0\.34rem\)/s,
      'compressed USE ETH is optically centered across its heading and value rows like USING FLIP',
    );
    const ticketsInput = el.querySelector('[name="dec-tickets"]');
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    ticketsInput.value = '2';
    ticketsInput.dispatchEvent({ type: 'input' });
    await settle(30);
    const ctaAction = el.querySelector('[data-bind="dec-buy-cta-action"]');
    const ctaAmount = el.querySelector('[data-bind="dec-buy-cta-amount"]');
    assert.equal(ctaAction.textContent, 'Burn 2,000 FLIP');
    assert.equal(ctaAmount.textContent, 'for 2 tickets', 'the ticket output stays on line two');
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
    assert.equal(ctaAction.textContent, 'Burn 250 FLIP', '0.25 tickets = 250 FLIP');
    assert.equal(ctaAmount.textContent, 'for 0.25 tickets');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('left FLIP Balance uses the same carry-inclusive total as Protocol Coins', async () => {
    const FLIP = 10n ** 18n;
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract());
    coinflipMod.__setWidgetBalancesReaderForTest(async () => ({ flipBalance: 2_250n * FLIP }));
    coinflipMod.__setClaimableReaderForTest(async () => 500n * FLIP);
    coinflipMod.__setBackingReaderForTest(async () => 675n * FLIP);
    _fetchHandler = async (url) => String(url).includes('/game/state')
      ? DEFAULT_GAME_STATE
      : { claimableEth: '0', flipBalance: String(1n * FLIP), coinflip: { claimablePreview: '0' } };
    storeMod.update('ui.protocolCoinsFlipDisclosure', {
      address: CONNECTED.toLowerCase(),
      visible: false,
    });

    const el = instantiate();
    await settle(60);
    const balance = el.querySelector('[data-bind="dec-flip-balance"]');
    const value = el.querySelector('[data-bind="dec-flip-balance-value"]');
    assert.match(el.innerHTML, /dec-flip-balance__label">FLIP BALANCE</);
    assert.equal(value.textContent, '••••', 'the left copy starts behind the Protocol Coins mask');
    assert.ok(balance.classList.contains('dec-flip-balance--spoiler'));

    storeMod.update('ui.protocolCoinsFlipDisclosure', {
      address: CONNECTED.toLowerCase(),
      visible: true,
    });
    assert.equal(value.textContent, '2,925',
      'the mirror adds full withdrawable backing, including 175 FLIP of auto-rebuy carry');
    assert.ok(!balance.classList.contains('dec-flip-balance--spoiler'));

    storeMod.update('ui.protocolCoinsFlipDisclosure', {
      address: CONNECTED.toLowerCase(),
      visible: false,
    });
    assert.equal(value.textContent, '••••', 'reblurring Protocol Coins reblurs its left mirror');
    assert.ok(balance.classList.contains('dec-flip-balance--spoiler'));
    assert.match(
      APP_CSS,
      /:root\s*\{[^}]*--main-balance-spoiler-blur:\s*0\.3rem/s,
      'main balance boxes share one privacy-blur token',
    );
    assert.match(
      APP_CSS,
      /\.dec-flip-balance--spoiler[^{]*\{[^}]*filter:\s*blur\(var\(--main-balance-spoiler-blur\)\)/s,
      'the buy-side FLIP mirror uses the shared blur treatment',
    );
    assert.match(
      APP_CSS,
      /\.df-position-row--spoiler \.df-position-number,[\s\S]*?\.df-funds__display--spoiler \.df-funds__number\s*\{[^}]*filter:\s*blur\(var\(--main-balance-spoiler-blur\)\)/s,
      'Protocol Coins and the primary bet boxes use that same blur treatment',
    );

    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('ALL IN quotes FLIP while Protocol Coins stays privacy-blurred', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract());
    _fetchHandler = async (url) => (
      String(url).includes('/game/state')
        ? DEFAULT_GAME_STATE
        : {
          claimableEth: '0',
          flipBalance: String(2_250n * 10n ** 18n),
          pending: {},
        }
    );
    const el = instantiate();
    await settle(60);
    storeMod.update('ui.protocolCoinsFlipDisclosure', {
      address: CONNECTED.toLowerCase(),
      visible: false,
    });
    await settle(10);
    assert.equal(
      el.querySelector('[data-bind="dec-flip-balance"]').classList.contains('dec-flip-balance--spoiler'),
      true,
      'the amount remains visually private',
    );
    el.querySelector('[data-bind="dec-funds-total-flip"]').dispatchEvent({ type: 'click' });

    const allIn = el.querySelector('[data-bind="dec-all-in"]');
    const tickets = el.querySelector('[name="dec-tickets"]');
    const originalTickets = tickets.value;
    let opened = null;
    el.addEventListener('app-all-in:open', (event) => { opened = event.detail; });
    assert.equal(allIn.hidden, false);
    assert.equal(allIn.disabled, false);
    assert.equal(allIn.title, 'Choose a currency and where to go all in');
    allIn.dispatchEvent({ type: 'click' });
    assert.ok(opened);
    assert.deepEqual(opened.destinations.FLIP, ['coinflip', 'degenerette', 'tickets']);
    const quote = opened.quote({ currency: 'FLIP', target: 'tickets', spins: 5 });
    assert.equal(quote.valid, true);
    assert.equal(
      el.querySelector('[data-bind="dec-flip-balance"]').classList.contains('dec-flip-balance--spoiler'),
      true,
      'quoting ALL IN does not reveal the balance',
    );
    assert.equal(quote.ticketAmount, '2.25');
    assert.equal(quote.spendWei, 2_250n * 10n ** 18n);
    assert.equal(quote.buttonLabel, 'ALL IN: 2,250 FLIP FOR 2.25 TICKETS');
    assert.equal(tickets.value, originalTickets, 'the popup leaves the FLIP ticket form untouched');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('USE FLIP leaves the ordered funding buttons intact and a source button exits FLIP', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract());
    const el = instantiate();
    await settle(60);
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });

    const tickets = el.querySelector('[name="dec-tickets"]');
    const lootbox = el.querySelector('[name="dec-lootbox-eth"]');
    const lootboxGroup = el.querySelector('[data-bind="dec-lootbox-group"]');
    const mode = el.querySelector('[data-bind="dec-flip-check"]');
    const useClaimable = el.querySelector('[data-bind="dec-funds-use-claimable"]');
    const useWallet = el.querySelector('[data-bind="dec-funds-use-wallet"]');

    tickets.value = '0';
    lootbox.value = '0.08';
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    assert.equal(tickets.value, '1', 'zero tickets seed to one when USE FLIP is selected');
    assert.equal(lootbox.value, '0', 'the incompatible lootbox amount is cleared');
    assert.equal(lootboxGroup.hidden, true, 'the whole lootbox control is removed in FLIP mode');
    assert.equal(useClaimable.getAttribute('aria-pressed'), 'true',
      'the selected ETH priority is not rewritten by USE FLIP');
    assert.equal(useWallet.getAttribute('aria-pressed'), 'false');

    mode.checked = false;
    mode.dispatchEvent({ type: 'change' });
    assert.equal(lootboxGroup.hidden, false, 'lootboxes return when FLIP mode is left');
    assert.equal(useClaimable.getAttribute('aria-pressed'), 'true');
    assert.equal(useWallet.getAttribute('aria-pressed'), 'false');

    tickets.value = '2.25';
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    assert.equal(tickets.value, '2.25', 'an existing nonzero ticket amount is preserved');

    useWallet.dispatchEvent({ type: 'click' });
    assert.equal(mode.checked, false, 'choosing another ETH source exits FLIP mode');
    assert.equal(useClaimable.getAttribute('aria-pressed'), 'false');
    assert.equal(useWallet.getAttribute('aria-pressed'), 'true');
    assert.equal(lootboxGroup.hidden, false);

    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('a REDEEM FLIP quest refreshes the window, preserves nonzero tickets, and never submits', async () => {
    const fake = makeFakeRedeemFlipContract();
    claimsMod.__setContractFactoryForTest(() => fake);
    const el = instantiate();
    await settle(60);
    const tickets = el.querySelector('[name="dec-tickets"]');
    const flip = el.querySelector('[data-bind="dec-flip-check"]');
    tickets.value = '2.25';

    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: { questType: 9, target: '2000', variant: 'level' },
    }));
    await settle(80);
    assert.equal(tickets.value, '2.25', 'quest metadata does not overwrite a nonzero amount');
    assert.equal(flip.checked, true, 'the freshly verified USE FLIP control is selected');
    assert.equal(el.querySelector('[name="dec-lootbox-eth"]').value, '0');
    assert.equal(fake._calls.filter((call) => call[0] !== 'static').length, 0,
      'quest activation does not send redeemFlip');

    flip.checked = false;
    flip.dispatchEvent({ type: 'change' });
    tickets.value = '0';
    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: { questType: 9, target: '2000', variant: 'daily' },
    }));
    await settle(80);
    assert.equal(tickets.value, '1', 'only a blank/zero ticket input is seeded');
    assert.equal(flip.checked, true);
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('confirming a REDEEM FLIP quest submits its amount without selecting USE FLIP', async () => {
    const fake = makeFakeRedeemFlipContract();
    claimsMod.__setContractFactoryForTest(() => fake);
    const el = instantiate();
    await settle(60);
    const tickets = el.querySelector('[name="dec-tickets"]');
    const lootbox = el.querySelector('[name="dec-lootbox-eth"]');
    const flip = el.querySelector('[data-bind="dec-flip-check"]');
    tickets.value = '2.25';
    lootbox.value = '0.08';
    flip.checked = false;

    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: {
        questType: 9, target: '2', variant: 'daily',
        configuredAmount: true, submit: true,
      },
    }));
    await settle(100);

    const sends = fake._calls.filter((call) => call[0] !== 'static');
    assert.equal(sends.length, 1);
    assert.equal(sends[0][1], 800n, 'the confirmed two-ticket quest amount is redeemed');
    assert.equal(tickets.value, '2.25', 'the normal ticket draft is preserved');
    assert.equal(lootbox.value, '0.08', 'the normal lootbox draft is preserved');
    assert.equal(flip.checked, false, 'the quest does not select USE FLIP in the normal form');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('window OPEN stays visible even when this wallet cannot afford one whole ticket', async () => {
    claimsMod.__setContractFactoryForTest(() => makeFakeRedeemFlipContract({ amountRejected: true }));
    const el = instantiate();
    await settle(60);
    assert.equal(el.querySelector('[data-bind="dec-funds-total-flip"]').hidden, false,
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
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
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
    assert.equal(el.querySelector('[name="dec-tickets"]').value, '0',
      'a mined FLIP buy clears the visible ticket draft');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('zero tickets → validation error, no tx', async () => {
    const fake = makeFakeRedeemFlipContract();
    claimsMod.__setContractFactoryForTest(() => fake);
    const el = instantiate();
    await settle(60);
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
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
    assert.match(PANEL_SRC, />\s*USE FLIP\s*</);
    assert.doesNotMatch(PANEL_SRC, />\s*REDEEM FLIP\s*</);
    assert.doesNotMatch(PANEL_SRC, /data-bind="dec-flip-buy"/);
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
