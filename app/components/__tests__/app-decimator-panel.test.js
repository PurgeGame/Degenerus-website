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
    style: {
      _props: {},
      setProperty(name, value) {
        this._props[String(name)] = String(value);
        this[String(name)] = String(value);
      },
      getPropertyValue(name) { return this._props[String(name)] ?? ''; },
    },
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
        for (const attrName of ['data-step-for', 'data-dir', 'data-lootbox-case-model']) {
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
  __resetHeldBalancesForTest();
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
import * as walletMod from '../../app/wallet.js';
import * as claimsMod from '../../app/claims.js';
import * as passesMod from '../../app/passes.js';
import * as coinflipMod from '../../app/coinflip.js';
import * as pendingActionsMod from '../../app/pending-actions.js';
import * as uiPreferencesMod from '../../app/ui-preferences.js';
import { invalidateJSONCache } from '../../app/api.js';
import {
  __resetHeldBalancesForTest,
  heldBalanceValue,
} from '../../app/balance-hold.js';

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
const PURCHASE_DESK_CSS = readFileSync(
  new URL('../../styles/purchase-desk.css', import.meta.url),
  'utf8',
);
const STATUS_CSS = readFileSync(
  new URL('../../styles/status-indicators.css', import.meta.url),
  'utf8',
);
const QUEST_LEFT_ICON = readFileSync(
  new URL('../../assets/quest-objective-tail-left.svg', import.meta.url),
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

  test('the rotating ticket and standalone Entry use the contract trait rules across all quadrants', async () => {
    const {
      purchaseEntryTraitFromWords,
      purchaseTicketColorBucket,
      purchaseTicketTraitsFromWords,
    } = await import('../app-decimator-panel.js');
    const boundaries = [
      [0x00000000, 0], [0x3f000000, 0],
      [0x40000000, 1], [0x7f000000, 1],
      [0x80000000, 2], [0xbf000000, 2],
      [0xc0000000, 3], [0xdf000000, 3],
      [0xe0000000, 4], [0xef000000, 4],
      [0xf0000000, 5], [0xf7000000, 5],
      [0xf8000000, 6], [0xfd000000, 6],
      [0xfe000000, 7], [0xff000000, 7],
    ];
    for (const [word, expected] of boundaries) {
      assert.equal(purchaseTicketColorBucket(word), expected, `0x${word.toString(16)}`);
    }

    const traits = purchaseTicketTraitsFromWords([
      0x00000000, 0x00000007,
      0x40000000, 0x00000008,
      0xe0000000, 0xabcdef0f,
      0xfe000000, 0x00000005,
    ]);
    assert.deepEqual(
      traits.map(({ q, col, sym, byte }) => ({ q, col, sym, byte })),
      [
        { q: 0, col: 0, sym: 7, byte: 7 },
        { q: 1, col: 1, sym: 0, byte: 72 },
        { q: 2, col: 4, sym: 7, byte: 167 },
        { q: 3, col: 7, sym: 5, byte: 253 },
      ],
      'color uses the low uint32 and the uniform symbol uses high32 & 7',
    );

    const colorWords = [
      0x00000000, 0x40000000, 0x80000000, 0xc0000000,
      0xe0000000, 0xf0000000, 0xf8000000, 0xfe000000,
    ];
    const entryIds = new Set();
    for (let q = 0; q < 4; q += 1) {
      for (let col = 0; col < 8; col += 1) {
        for (let sym = 0; sym < 8; sym += 1) {
          const trait = purchaseEntryTraitFromWords([q, colorWords[col], sym]);
          assert.deepEqual(
            { q: trait.q, col: trait.col, sym: trait.sym, byte: trait.byte },
            { q, col, sym, byte: (q << 6) | (col << 3) | sym },
          );
          entryIds.add(trait.byte);
        }
      }
    }
    assert.equal(entryIds.size, 256, 'Entry can display every canonical trait ID');
    assert.match(PANEL_SRC, /PURCHASE_TICKET_SAMPLE_REFRESH_MS\s*=\s*60_000/);
    assert.match(PANEL_SRC, /setInterval\([\s\S]*?#renderTicketSample\(\)[\s\S]*?PURCHASE_TICKET_SAMPLE_REFRESH_MS,\s*\)/);
    assert.match(PANEL_SRC, /dgnBadgePath\(quadrant, trait\.sym, trait\.col\)/);
    assert.match(PANEL_SRC, /randomPurchaseEntryTrait\(\)/);
    assert.match(PANEL_SRC, /setAttribute\?\.\('data-quadrant', String\(nextTrait\.q\)\)/);
    assert.match(PANEL_SRC, /dgnBadgePath\(nextTrait\.q, nextTrait\.sym, nextTrait\.col\)/);
    assert.match(PANEL_SRC, /dgnTicketAccent\(sampleTraits\)/);
  });

  test('Panel renders shell with static innerHTML — no server data, header copy "BUY IN"', () => {
    const el = instantiate();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    assert.match(
      el.innerHTML.toUpperCase(),
      /<H2 CLASS="DEC-PURCHASE-HEADING">BUY IN<\/H2>/,
      'header copy contains the finalized BUY IN title',
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
    const btn = el.querySelector('[data-bind="dec-buy-cta"]');
    assert.ok(btn, '[data-write] CTA button rendered');
    assert.notEqual(btn.getAttribute('data-write'), null);
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

  test('purchase builders expose an adaptive ticket shelf and responsive box quantities', () => {
    const el = instantiate();
    for (const [bind, label] of [
      ['dec-ticket-add-entry', 'ENTRY'],
      ['dec-ticket-add-ticket', 'TICKET'],
    ]) {
      assert.match(el.innerHTML, new RegExp(`data-bind="${bind}"[\\s\\S]*?<strong>${label}<\\/strong>`));
    }
    const pack = el.querySelector('[data-bind="dec-ticket-add-pack"]');
    assert.ok(pack, 'the ten-ticket pack remains a clickable shelf item');
    assert.equal(pack.querySelector('.dec-ticket-piece__copy'), null,
      'the pack wrapper carries its quantity without a redundant PACK pill');
    assert.match(PANEL_SRC,
      /data-bind="dec-ticket-add-pack"[\s\S]*?<span class="dec-pack-count">10 TICKETS<\/span>/);
    assert.match(PANEL_SRC,
      /data-bind="dec-ticket-add-ticket"[\s\S]*?<quest-objective-indicator class="dec-ticket-single-quest"\s+product="purchase"\s+quest-roles="DAILY,BONUS"><\/quest-objective-indicator>[\s\S]*?<\/button>/,
      'single-purchase quests belong to the one-ticket control');
    assert.match(PANEL_SRC,
      /data-bind="dec-ticket-add-pack"[\s\S]*?<quest-objective-indicator class="dec-ticket-pack-quest"\s+product="purchase"\s+quest-roles="LEVEL"><\/quest-objective-indicator>[\s\S]*?<\/button>/,
      'level purchase quests belong to the ten-ticket pack');
    assert.equal(el.querySelector('.dec-input-group--tickets > .dec-input-accessories > quest-objective-indicator'), null,
      'the ticket quest marker no longer floats at the purchase panel edge');
    assert.match(el.innerHTML,
      /<boon-product-indicator product="purchase" data-bind="dec-ticket-boon"\s+variant="purchase-control"/);
    assert.match(el.innerHTML,
      /<boon-product-indicator product="lootbox"\s+variant="purchase-control"/);
    assert.match(el.innerHTML,
      /data-bind="dec-custom-box-toggle"[\s\S]*?class="dec-custom-box-logo"[\s\S]*?<svg viewBox="0 0 24 24"[\s\S]*?<strong id="dec-box-builder-title" data-bind="dec-box-options-title">CUSTOM LUCKBOXES<\/strong>[\s\S]*?data-bind="dec-custom-box-selection" hidden[\s\S]*?class="dec-input-accessories" role="group" aria-label="Luckbox purchase modifiers"[\s\S]*?<quest-objective-indicator product="lootbox"[\s\S]*?<boon-product-indicator product="lootbox"/,
      'the custom-chest action labels the section while boon and quest markers keep dedicated slots');
    assert.match(el.innerHTML,
      /data-bind="dec-custom-box-fields"[\s\S]*?data-bind="dec-presale-row" hidden[\s\S]*?data-bind="dec-custom-box-buy"[\s\S]*?data-bind="dec-custom-box-buy-action">BUY IN<\/span>[\s\S]*?data-bind="dec-custom-box-buy-amount" hidden/,
      'custom and eligible presale boxes share one chooser and one purchase action');
    assert.equal(el.querySelector('[data-bind="dec-presale-toggle"]'), null,
      'there is no second presale button competing for the Luckbox header');
    for (const name of [
      'dec-box-small', 'dec-box-medium', 'dec-box-large',
      'dec-box-custom-count', 'dec-box-custom-eth',
    ]) {
      assert.ok(el.querySelector(`[name="${name}"]`), `${name} is independently editable`);
    }
    assert.match(
      el.innerHTML,
      /degenerus-lootbox-case-small-v21-plain-lid-large-badge-buy-in-card\.webp[\s\S]*degenerus-lootbox-case-medium-v28-quiet-quadrant-buy-in-card\.webp[\s\S]*degenerus-lootbox-case-large-v36-buy-in-card\.webp/,
      'Buy In uses the plain-lid green/bronze and purple/silver cards with the four-quadrant gold card',
    );
    assert.equal(
      (PANEL_SRC.match(/<img class="dec-box-card__image" src="\$\{(?:BUY_IN_COMPACT_CASE_ART\.(?:small|medium)|BUY_IN_GOLD_CASE_ART)\}" alt="" loading="lazy" decoding="async" fetchpriority="low">/g) ?? []).length,
      3,
      'all three static card renders are Buy In-scoped and cannot change reveal animation art',
    );
    assert.equal((el.innerHTML.match(/class="dec-box-card__quickload"/g) ?? []).length, 3,
      'every full-resolution box has a zero-request first-paint silhouette');
    assert.match(PANEL_SRC,
      /lootboxCaseAssets\('medium'\)\.cardTop[\s\S]*?<b>PRESALE<\/b>/,
      'the conditional presale option keeps the neutral compact case art');
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
      PURCHASE_DESK_CSS,
      /\.dec-builder-title > \.dec-input-accessories\s*\{[^}]*left:\s*calc\(100% \+ 0\.1rem\);[^}]*width:\s*2\.62rem;/s,
      'Luckbox modifiers anchor directly to the right edge of the title',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-builder-title > \.dec-input-accessories > quest-objective-indicator\s*\{[^}]*quest-objective-tail-left\.svg[^}]*right:\s*auto;[^}]*left:\s*0;/s,
      'the first Luckbox marker points its speech tail left toward the title',
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
      PURCHASE_DESK_CSS,
      /Approved compact asset desk[\s\S]*?\.dec-ticket-pieces\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s,
      'the default Entry, Ticket, and Pack shelf does not reserve a blank foil slot',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece--ticket > \.dec-ticket-single-quest,[\s\S]*?\.dec-ticket-piece--pack > \.dec-ticket-pack-quest\s*\{[^}]*quest-objective-tail-left\.svg[^}]*top:\s*-0\.14rem;[^}]*right:\s*-0\.1rem;[^}]*width:\s*1\.18rem;[^}]*min-width:\s*0;[^}]*height:\s*1\.18rem;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*translate:\s*none;/s,
      'single and level quest markers use the full left-pointing bubble at each upper-right corner',
    );
    assert.match(QUEST_LEFT_ICON, /tail[\s\S]*leaves the bubble's left edge/i,
      'the shared ticket marker retains its complete speech-bubble point');
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-pieces:has\([\s\S]*?\.dec-ticket-piece--foil:not\(\[hidden\]\)[\s\S]*?\)\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s,
      'an eligible Foil Pack expands the same shelf to four scannable controls',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece__art > \.dec-ticket-face\s*\{[^}]*max-width:\s*100%;[^}]*height:\s*100%;/s,
      'the real ticket face fills the button instead of inheriting the old thumbnail size',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-face > \.dec-ticket-trait:nth-child\(-n\+2\) img\s*\{[^}]*top:\s*42%;/s,
      'the top ticket badges sit farther above the center flame',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-face > \.dec-ticket-trait:nth-child\(n\+3\) img\s*\{[^}]*top:\s*58%;/s,
      'the bottom ticket badges sit farther below the center flame',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-entry-face \.dec-ticket-trait img\s*\{[^}]*top:\s*54%;/s,
      'the Entry badge is nudged slightly lower in its quarter-ticket',
    );
    assert.match(el.innerHTML,
      /class="dec-entry-face ticket-entry-card tc-small"[\s\S]*?data-quadrant="0"[\s\S]*?class="dec-ticket-trait trait-quadrant"/,
      'Entry reuses the canonical oriented quarter-ticket component');
    for (const quadrant of [0, 1, 2, 3]) {
      assert.match(
        APP_CSS,
        new RegExp(`\\.ticket-entry-card\\[data-quadrant="${quadrant}"\\]\\s*\\{[^}]*border-radius:[^}]*clip-path:\\s*polygon\\(`, 's'),
        `quadrant ${quadrant} has its own outer radius and inward corner cut`,
      );
    }
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*min-height:\s*4\.75rem;/s,
      'button and label-backed ticket art keeps identical accessible hit-target dimensions',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /The rendered ticket and pack art is the control[\s\S]*?\.dec-ticket-piece:hover,[\s\S]*?\.dec-ticket-piece:focus-visible\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*outline:\s*none;[^}]*transform:\s*none;/s,
      'ticket controls do not repaint visible button tiles on hover or keyboard focus',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece:hover \.dec-ticket-piece__art,[\s\S]*?\.dec-ticket-piece:focus-visible \.dec-ticket-piece__art\s*\{[^}]*brightness\(1\.08\)[^}]*transform:\s*translateY\(-1px\) scale\(1\.025\);/s,
      'hover and focus feedback moves with the artwork that acts as the button',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece--foil\.is-selected\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
      'the selected foil pack glows without restoring an outer button tile',
    );
    assert.doesNotMatch(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece::after|\.dec-box-card__add::after|content:\s*'\+';/,
      'ticket and preset Luckbox surfaces do not carry decorative plus cues',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece__copy\s*\{[^}]*border-radius:\s*999px;[^}]*background:\s*#0a0709;[^}]*backdrop-filter:\s*none;/s,
      'both labels use one solid plaque without a displaced backdrop-blur artifact',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece--ticket \.dec-ticket-piece__copy,\s*body\.layout-basic \.app-decimator-panel \.dec-ticket-piece--entry \.dec-ticket-piece__copy\s*\{[^}]*left:\s*50%;[^}]*width:\s*min\(3\.2rem, calc\(100% - 0\.32rem\)\);[^}]*padding:\s*0\.27rem 0\.46rem 0\.24rem;/s,
      'ENTRY and TICKET share exactly the same plaque dimensions',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece--ticket \.dec-ticket-piece__copy\s*\{[^}]*top:\s*50%;[^}]*transform:\s*translate\(-50%, -50%\)/s,
      'TICKET centers the shared plaque over its full-ticket art',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-piece--entry \.dec-ticket-piece__copy\s*\{[^}]*top:\s*0\.28rem;[^}]*transform:\s*translateX\(-50%\)/s,
      'the ENTRY label stays horizontally centered without covering its art',
    );
    assert.equal(pack.querySelector('.dec-ticket-piece__copy'), null,
      'the wrapper already says 10 TICKETS, so Pack has no redundant overlay label');
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-pieces:has\([\s\S]*?\.dec-ticket-piece--foil:not\(\[hidden\]\)[\s\S]*?\) \.dec-ticket-piece--ticket \.dec-ticket-piece__copy,[\s\S]*?\.dec-ticket-pieces:has\([\s\S]*?\.dec-ticket-piece--entry \.dec-ticket-piece__copy\s*\{[^}]*padding:\s*0\.24rem 0\.3rem 0\.22rem;/s,
      'both plaques contract identically to fit the four-item Foil shelf',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-input-group--tickets[\s\S]*?> \.dec-input-accessories > boon-product-indicator\s*\{[^}]*display:\s*none !important;/s,
      'the header bonus readout replaces the duplicate arrow that could overlap Foil Pack',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-box-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.8fr\) minmax\(0, 0\.86fr\) minmax\(0, 1\.34fr\)/s,
      'the three unequal case widths receive proportionate tracks and balanced visible gaps',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-box-card--large\s*\{[^}]*width:\s*min\(12rem, 100%\);/s,
      'the visible gold bounds use the full height supplied by the wider right track',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /@media \(min-width: 700px\) and \(max-width: 1099px\)[\s\S]*?\.dec-purchase-builders\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
      'the wide single-column hero uses parallel builders',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.dec-ticket-total__field \.dec-input,[\s\S]*?font-size:\s*1rem/s,
      'phone number fields avoid browser zoom and remain comfortably editable',
    );
    assert.match(
      PANEL_SRC,
      /name="dec-tickets"[^>]*inputmode="decimal"/s,
      'ticket entry requests the decimal keyboard on mobile',
    );
    assert.match(
      PANEL_SRC,
      /name="dec-box-custom-eth"[^>]*inputmode="decimal"/s,
      'custom ETH requests the decimal keyboard on mobile',
    );
    el.disconnectedCallback();
  });

  test('purchase surface uses the tightened compact rhythm without collapsing its controls', () => {
    const compactHeroCss = PURCHASE_DESK_CSS.slice(
      PURCHASE_DESK_CSS.lastIndexOf('@media (max-width: 1099px)'),
    );
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
      PURCHASE_DESK_CSS,
      /\.dec-buy-row--flip > \.dec-buy-cta\[data-write\]\s*\{[^}]*flex-direction:\s*column;[^}]*gap:\s*0\.12rem;/s,
      'the narrow CTA stacks its action and exact total instead of truncating both inline',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-buy-row\s*\{[^}]*grid-template-columns:\s*3\.1rem minmax\(0, 1fr\) minmax\(6\.45rem, 0\.7fr\);[^}]*gap:\s*0\.3rem;/s,
      'the buy row reserves enough width to show fractional ticket totals without clipping',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-ticket-total__field \.dec-input\s*\{[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;[^}]*appearance:\s*textfield;/s,
      'the ticket total removes shared pill styling and the browser spinner that steal value width',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-buy-cta__action\s*\{[^}]*font-size:\s*0\.76rem;[^}]*\}[\s\S]*?\.dec-buy-cta__amount\s*\{[^}]*font-size:\s*0\.65rem;/s,
      'BUY IN and its ETH amount retain the larger two-line treatment',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-buy-cta:has\(\.dec-buy-cta__amount\[hidden\]\) \.dec-buy-cta__action\s*\{[^}]*white-space:\s*normal;/s,
      'the empty CLICK TO ADD prompt wraps to two lines instead of truncating',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-buy-row--flip > \.dec-buy-cta\[data-write\]\s*\{[^}]*height:\s*2\.55rem;[^}]*min-height:\s*2\.55rem;[^}]*max-height:\s*2\.55rem;/s,
      'the desktop action row keeps its slimmer control height',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-buy-row--flip\s*\{[^}]*grid-template-columns:\s*3\.1rem minmax\(0, 1fr\);[^}]*\}[\s\S]*?\.dec-buy-row--flip > \.dec-buy-cta\[data-write\]\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*2;/s,
      'FLIP mode gives its detailed burn quote a full-width row beneath Clear and TIX',
    );
    assert.match(
      compactHeroCss,
      /\.dec-buy-row\s*\{[^}]*grid-template-columns:\s*3rem minmax\(6\.2rem, 0\.9fr\) minmax\(6\.25rem, 1\.1fr\)[^}]*padding-top:\s*0\.3rem/s,
      'mobile and medium Clear, TIX, and Buy share one compact control line',
    );
    assert.match(
      compactHeroCss,
      /\.dec-buy-row > \.dec-buy-cta\[data-write\],[\s\S]*?\.dec-buy-row--flip > \.dec-buy-cta\[data-write\]\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;[^}]*height:\s*3rem/s,
      'the compact Buy key no longer consumes a separate full-width row',
    );
    assert.match(
      compactHeroCss,
      /\.panel-header\s*\{[^}]*min-height:\s*4\.4rem;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 6\.45rem;[^}]*grid-template-rows:\s*auto 2\.8rem/s,
      'mobile and medium reserve a full title row above the two readouts',
    );
    assert.match(
      compactHeroCss,
      /\.dec-header-title\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*1/s,
      'BUY IN spans the complete top row at compact widths',
    );
    assert.match(
      compactHeroCss,
      /\.dec-purchase-help\s*\{[^}]*right:\s*auto;[^}]*left:\s*0;/s,
      'the compact info control stays at the upper-left of BUY IN',
    );
    assert.match(
      compactHeroCss,
      /\.dec-price\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;[^}]*grid-template-columns:\s*1ch max-content 1\.5ch max-content 0\.5ch minmax\(max-content, 1fr\);[^}]*font-size:\s*clamp\(0\.54rem, 2\.2vw, 0\.6rem\)/s,
      'the larger compact rate screen owns the left side of the second row',
    );
    assert.match(
      compactHeroCss,
      /\.dec-flip-credit--header\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2/s,
      'the bonus readout shares the second instrument row',
    );
    assert.match(
      compactHeroCss,
      /\.dec-ticket-piece\s*\{[^}]*min-height:\s*6\.25rem/s,
      'recovered height enlarges the clickable ticket shelf',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /@media \(max-width: 1099px\)[\s\S]*?\.dec-price\s*\{[^}]*grid-template-columns:\s*1ch 1ch 6ch 2ch 1ch 2ch max-content 1ch max-content;[^}]*justify-content:\s*center[\s\S]*?\.dec-price__count\s*\{[^}]*grid-column:\s*1[\s\S]*?\.dec-price__kind\s*\{[^}]*grid-column:\s*3[\s\S]*?\.dec-price__amount\s*\{[^}]*grid-column:\s*7[\s\S]*?\.dec-price__unit\s*\{[^}]*grid-column:\s*9/s,
      'stacked layouts restore the centered desktop rate columns instead of left-packing the quote',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /@media \(min-width: 521px\) and \(max-width: 1099px\)[\s\S]*?\.panel-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 11\.4rem\) 8rem minmax\(0, 1fr\)[^}]*grid-template-rows:\s*auto 2\.35rem[\s\S]*?\.dec-price\s*\{[^}]*grid-column:\s*2[\s\S]*?\.dec-flip-credit--header\s*\{[^}]*grid-column:\s*3/s,
      'stacked medium layouts center a desktop-sized rate/bonus cluster without moving the title or help control',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /@media \(min-width: 521px\) and \(max-width: 1099px\)[\s\S]*?\.dec-ticket-pieces:has\([\s\S]*?\.dec-ticket-piece--foil:not\(\[hidden\]\)[\s\S]*?\) \.dec-ticket-piece\s*\{[^}]*min-height:\s*6\.25rem[\s\S]*?\.dec-ticket-pieces:not\(:has\([\s\S]*?\.dec-ticket-piece--foil:not\(\[hidden\]\)[\s\S]*?\)\) \.dec-ticket-piece\s*\{[^}]*min-height:\s*clamp\(8rem, 18vw, 10\.75rem\)/s,
      'medium foil rows keep compact natural proportions while only the three-product state grows',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.panel-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 11\.4rem\) 6\.45rem minmax\(0, 1fr\)[^}]*grid-template-rows:\s*auto 2\.35rem[\s\S]*?\.dec-ticket-pieces:has\([\s\S]*?\.dec-ticket-piece--foil:not\(\[hidden\]\)[\s\S]*?\) \.dec-ticket-piece\s*\{[^}]*min-height:\s*6\.25rem[\s\S]*?\.dec-ticket-pieces:not\(:has\([\s\S]*?\.dec-ticket-piece--foil:not\(\[hidden\]\)[\s\S]*?\)\) \.dec-ticket-piece\s*\{[^}]*min-height:\s*7\.25rem/s,
      'phones center the desktop-style rate cluster and enlarge tickets only when Foil is absent',
    );
    assert.match(
      compactHeroCss,
      /\.dec-desk-cage\s*\{\s*display:\s*none;[^}]*\}[\s\S]*?\.dec-funds-stack\s*\{[^}]*margin-top:\s*0;[^}]*padding-top:\s*0;/s,
      'mobile and medium remove the decorative blank spacer before Available Funds',
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

  test('Click handler invokes decimator.purchaseEth with ticketQuantity > 0 + boxOrder = 0', async () => {
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
    const btn = el.querySelector('[data-bind="dec-buy-cta"]');
    btn.dispatchEvent({ type: 'click' });
    await settle(60);

    // purchase() called once with ticketQuantity > 0 + boxOrder = 0. Verified via
    // fakeContract._calls.purchase[0] — ticketQuantity*100 (Phase 60 scaling).
    assert.equal(fakeContract._calls.purchase.length, 1, 'purchase called exactly once');
    const args = fakeContract._calls.purchase[0];
    // args = [buyer, entryQuantityScaled, boxOrder, affiliateCode, payKind, foil]
    assert.equal(args[0], CONNECTED, 'buyer = connected address');
    assert.equal(args[1], 2000n, '5 tickets = 20 entries = 2000 purchase units (400 per ticket)');
    assert.equal(args[2], 0n, 'boxOrder = 0n (tickets-only level mint)');

    el.disconnectedCallback();
  });

  test('Click handler debounced (#busy guard) — double-click invokes purchaseEth exactly once', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '3';

    const btn = el.querySelector('[data-bind="dec-buy-cta"]');
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

  test('WalletConnect Buy dispatches eth_sendTransaction synchronously from the tap', async () => {
    const hash = `0x${'34'.repeat(32)}`;
    const rawCalls = [];
    const handoffOpenCalls = [];
    const signClientListeners = new Map();
    const signClient = {
      on(event, fn) {
        const listeners = signClientListeners.get(event) || new Set();
        listeners.add(fn);
        signClientListeners.set(event, listeners);
      },
      off(event, fn) { signClientListeners.get(event)?.delete(fn); },
      removeListener(event, fn) { signClientListeners.get(event)?.delete(fn); },
      emit(event, payload) {
        for (const fn of [...(signClientListeners.get(event) || [])]) fn(payload);
      },
    };
    let releaseWalletRequest;
    const walletRequest = new Promise((resolve) => { releaseWalletRequest = resolve; });
    const signer = {
      getAddress: async () => CONNECTED,
      estimateGas: async () => 21000n,
      sendTransaction: async () => { throw new Error('ethers send path must not run'); },
    };
    const receipt = { status: 1, hash, logs: [] };
    const provider = {
      ...makeFakeProvider(CONNECTED),
      getSigner: async () => signer,
      getRpcTransaction: (tx) => ({
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: `0x${BigInt(tx.value ?? 0n).toString(16)}`,
        gas: `0x${BigInt(tx.gasLimit ?? 0n).toString(16)}`,
      }),
      waitForTransaction: async (txHash) => {
        assert.equal(txHash, hash);
        return receipt;
      },
    };
    const fakeContract = makeFakePurchaseContract({
      purchaseInfo: [36n, true, false, false, 80_000_000_000n],
    });
    fakeContract.purchase.populateTransaction = async (...args) => ({
      to: '0xc0ffee0000000000000000000000000000000000',
      data: '0xdeadbeef',
      value: args.at(-1)?.value ?? 0n,
    });
    const raw = {
      isWalletConnect: true,
      session: { topic: 'mobile-buy-topic' },
      signer: { client: signClient },
      on() {},
      request(payload) {
        rawCalls.push(payload);
        queueMicrotask(() => {
          signClient.emit('session_request_sent', {
            topic: 'mobile-buy-topic',
            id: 777,
            request: { method: payload.method },
          });
        });
        return walletRequest;
      },
    };

    contractsMod.setProvider(provider);
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    walletMod._testAttachListeners(provider, raw);
    storeMod.update('ui.chainOk', true);
    globalThis.localStorage.setItem('WALLETCONNECT_DEEPLINK_CHOICE', JSON.stringify({
      href: 'https://metamask.app.link',
      name: 'MetaMask',
    }));
    const priorOpen = globalThis.window.open;
    globalThis.window.open = (...args) => { handoffOpenCalls.push(args); return window; };
    const el = instantiate();
    try {
      await settle(60);
      el.querySelector('[data-bind="dec-ticket-add-ticket"]').dispatchEvent({ type: 'click' });
      await new Promise((resolve) => setTimeout(resolve, 190));
      await settle(30);

      let microtaskRanFirst = false;
      Promise.resolve().then(() => { microtaskRanFirst = true; });
      const btn = el.querySelector('[data-bind="dec-buy-cta"]');
      btn.dispatchEvent({ type: 'click' });

      assert.equal(rawCalls.length, 1, 'wallet request starts during click dispatch');
      assert.equal(microtaskRanFirst, false, 'no await precedes WalletConnect request');
      assert.equal(rawCalls[0].method, 'eth_sendTransaction');
      assert.equal(rawCalls[0].params[0].from, CONNECTED);
      assert.equal(
        el.querySelector('[data-bind="dec-buy-cta-action"]').textContent,
        'Confirm in',
        'pending copy uses the first CTA row',
      );
      assert.equal(
        el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent,
        'MetaMask…',
        'wallet name uses the second CTA row instead of wrapping into four lines',
      );
      assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').hidden, false);
      await flushMicrotasks();
      assert.deepEqual(handoffOpenCalls[0], [
        'https://metamask.app.link/wc?requestId=777&sessionTopic=mobile-buy-topic',
        '_self',
        'noreferrer noopener',
      ], 'the published request foregrounds MetaMask through same-tab navigation');
      assert.equal(btn.disabled, false, 'the pending CTA remains available as a handoff fallback');
      assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent, 'Open');
      assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, 'MetaMask');

      btn.dispatchEvent({ type: 'click' });
      assert.equal(handoffOpenCalls.length, 2, 'a second tap reopens the same pending request');
      releaseWalletRequest(hash);
      await settle(60);
      assert.equal(el.querySelector('[name="dec-tickets"]').value, '0',
        'confirmed pre-warmed purchase clears the draft');
    } finally {
      releaseWalletRequest(hash);
      globalThis.window.open = priorOpen;
      el.disconnectedCallback();
      walletMod.disconnect();
    }
  });

  test('Buy In quotes and submits while every database request is still blocked', async () => {
    invalidateJSONCache();
    let releaseDatabase;
    let databaseReads = 0;
    const databaseBlocked = new Promise((resolve) => { releaseDatabase = resolve; });
    _fetchHandler = async () => {
      databaseReads += 1;
      return databaseBlocked;
    };

    const price = lootboxMod.scaledTicketPriceWei(12);
    const contract = makeFakePurchaseContract({
      purchaseInfo: [12, false, false, false, price],
    });
    lootboxMod.__setContractFactoryForTest(() => contract);

    const el = instantiate();
    await settle(40);
    assert.ok(databaseReads > 0, 'the indexed dashboard wave is genuinely pending');
    assert.match(
      el.querySelector('[data-bind="dec-ticket-price"]').textContent,
      /TICKET/,
      'purchaseInfo paints the quote without the indexed response',
    );

    el.querySelector('[name="dec-tickets"]').value = '1';
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);
    assert.equal(contract._calls.purchase.length, 1,
      'the wallet-to-contract purchase completes before the DB is released');

    releaseDatabase({
      level: 12,
      phase: 'PURCHASE',
      jackpotPhaseFlag: false,
      claimableEth: '0',
      flipBalance: '0',
      pending: {},
    });
    await settle(20);
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

    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
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
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
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

  test('tickets + mixed Luckbox tiers ride one purchase() tx as a packed order', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '2';
    el.querySelector('[name="dec-box-small"]').value = '1';
    el.querySelector('[name="dec-box-medium"]').value = '2';
    el.querySelector('[name="dec-box-custom-count"]').value = '1';
    el.querySelector('[name="dec-box-custom-eth"]').value = '0.03';

    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 1, 'single combined tx');
    const args = fakeContract._calls.purchase[0];
    assert.equal(args[1], 800n, '2 tickets = 8 entries = 800 purchase units');
    const { LOOTBOX_MIN_WEI, packBoxOrder } = await import('../../app/lootbox.js');
    assert.equal(args[2], packBoxOrder({
      small: 1,
      medium: 2,
      customCount: 1,
      customSizeWei: LOOTBOX_MIN_WEI * 3n,
    }), 'the third ABI argument contains all selected box lanes');
    assert.equal(el.querySelector('[name="dec-tickets"]').value, '0',
      'a mined buy clears the ticket draft');
    for (const name of ['dec-box-small', 'dec-box-medium', 'dec-box-large', 'dec-box-custom-count']) {
      assert.equal(el.querySelector(`[name="${name}"]`).value, '0', 'a mined buy clears every box count');
    }
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
    const luckbox = el.querySelector('[name="dec-box-custom-eth"]');
    const customCount = el.querySelector('[name="dec-box-custom-count"]');
    tickets.value = '2';
    customCount.value = '1';
    luckbox.value = '0.03';

    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 0, 'reverted simulation never sends');
    assert.equal(tickets.value, '2', 'ticket draft is retained after failure');
    assert.equal(customCount.value, '1', 'custom box quantity is retained after failure');
    assert.equal(luckbox.value, '0.03', 'luckbox draft is retained after failure');
    el.disconnectedCallback();
  });

  test('lootbox-only buy (tickets 0) is allowed', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '0';
    el.querySelector('[name="dec-box-large"]').value = '1';

    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 1, 'purchase called');
    const args = fakeContract._calls.purchase[0];
    assert.equal(args[1], 0n, 'zero ticket leg');
    const { packBoxOrder } = await import('../../app/lootbox.js');
    assert.equal(args[2], packBoxOrder({ large: 1 }), 'large-box lane is present');
    el.disconnectedCallback();
  });

  test('a mined lootbox is published to Pending before optional reward enrichment', () => {
    const confirmedAt = PANEL_SRC.indexOf("new CustomEvent('app-decimator:tx-confirmed'");
    const enrichmentAt = PANEL_SRC.indexOf('let autoLegs = parseOpenLegsFromReceipt');
    assert.ok(confirmedAt >= 0 && enrichmentAt > confirmedAt,
      'receipt-confirmed RNG work must not wait behind boon/reveal RPC enrichment');
  });

  test('an auto-presented nonzero box uses the same index identity as Pending', () => {
    assert.match(
      PANEL_SRC,
      /lootboxPresentationKey\(autoBoxIndex, transactionHash\)/,
      'receipt completion must retire the indexed Pending action for the same box',
    );
    assert.match(
      PANEL_SRC,
      /const autoBoxIndex = openedBoxIndex\s*\?\? \(boxes\.length === 1 \? boxes\[0\]\?\.index : null\)/,
      'a pure BoxSpin still inherits the purchase index despite suppressing LootBoxOpened',
    );
    const riskEnrichmentAt = PANEL_SRC.indexOf('autoLegs = await enrichHumanBoxSpinLegs');
    const boonEnrichmentAt = PANEL_SRC.indexOf('autoLegs = await enrichLootboxBoonLegs');
    const revealAt = PANEL_SRC.indexOf("kind: 'lootbox'", riskEnrichmentAt);
    assert.ok(riskEnrichmentAt >= 0 && boonEnrichmentAt > riskEnrichmentAt,
      'the exact survival stake is attached before reward-card enrichment');
    assert.ok(revealAt > boonEnrichmentAt,
      'the auto-open reveal receives the fully enriched BoxSpin');
  });

  test('an empty click prompts the asset shelf without opening a chooser or sending a tx', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '0';

    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 0, 'no tx');
    assert.equal(el.querySelector('[data-bind="dec-buy-dialog"]'), null,
      'the retired chooser is not rendered');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent, 'CLICK TO ADD');
    assert.equal(el.querySelector('.dec-purchase-builders').classList.contains('is-prompting'), true,
      'the existing visual choices receive the empty-state prompt');
    const err = el.querySelector('[data-bind="dec-error"]');
    assert.equal(err.hidden, true, 'an empty order is a prompt, not an error');
    el.disconnectedCallback();
  });

  test('the compact TIX arrows step whole tickets while preserving quarter entries', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await settle(60);
    const input = el.querySelector('[name="dec-tickets"]');
    input.value = '0.25';
    const steps = el.querySelectorAll('[data-step-for="dec-tickets"]');
    steps.find((step) => step.getAttribute('data-dir') === '1')
      .dispatchEvent({ type: 'click' });
    assert.equal(input.value, '1.25', 'up adds one whole ticket');
    steps.find((step) => step.getAttribute('data-dir') === '-1')
      .dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.25', 'down removes one whole ticket without discarding the entry');
    assert.equal(fakeContract._calls.purchase.length, 0, 'editing never submits');
    el.disconnectedCallback();
  });

  test('a below-minimum custom box shows validation and sends no tx', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="dec-tickets"]').value = '0';
    el.querySelector('[name="dec-box-custom-count"]').value = '1';
    el.querySelector('[name="dec-box-custom-eth"]').value = '0.005';

    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(fakeContract._calls.purchase.length, 0, 'no tx');
    const err = el.querySelector('[data-bind="dec-error"]');
    assert.equal(err.hidden, false, 'error shown');
    assert.match(err.textContent, /at least 0\.01 ETH each/, 'minimum copy');
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
    const luckbox = el.querySelector('[name="dec-box-custom-eth"]');
    el.querySelector('[name="dec-box-custom-count"]').value = '1';

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
    const luckbox = el.querySelector('[name="dec-box-custom-eth"]');
    el.querySelector('[name="dec-box-custom-count"]').value = '1';
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
    const luckbox = el.querySelector('[name="dec-box-custom-eth"]');
    el.querySelector('[name="dec-box-custom-count"]').value = '1';
    const effect = el.querySelector('[data-bind="dec-purchase-boon-effect"]');

    tickets.value = '100';
    luckbox.value = '5';
    luckbox.dispatchEvent({ type: 'input' });
    assert.equal(effect.hidden, false);
    assert.equal(effect.textContent, '+25 TICKETS BOON · +1.25 ETH BOON');
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-flip-credit--header > \.dec-flip-credit__boon\s*\{[^}]*position:\s*relative;[^}]*width:\s*100%;[^}]*grid-column:\s*1;[^}]*grid-row:\s*3;[^}]*padding-right:\s*0\.9rem;[^}]*overflow:\s*hidden;/s,
      'ticket-boon detail occupies a real row fully inside the bonus bubble',
    );
    assert.match(el.querySelector('[data-bind="dec-flip-credit"]').getAttribute('aria-label'),
      /Purchase boon: \+25 TICKETS BOON, \+1\.25 ETH BOON/);
    el.disconnectedCallback();
  });

  test('Level 100 calculates century tickets in the existing bonus detail without changing quotes', async () => {
    const price = lootboxMod.scaledTicketPriceWei(100);
    lootboxMod.__setContractFactoryForTest(() => makeFakePurchaseContract({
      purchaseInfo: [99, false, false, false, price],
    }));
    _fetchHandler = async (url) => {
      if (String(url).includes('/game/state')) {
        return { level: 99, phase: 'PURCHASE', jackpotPhaseFlag: false };
      }
      if (String(url).includes('/foil')) return { present: false, level: 100 };
      return {
        claimableEth: '0',
        flipBalance: '0',
        scoreBreakdown: { totalBps: 100 },
      };
    };
    const el = instantiate();
    await settle(60);
    const tickets = el.querySelector('[name="dec-tickets"]');
    tickets.value = '10';
    tickets.dispatchEvent({ type: 'input' });

    const detail = el.querySelector('[data-bind="dec-purchase-boon-effect"]');
    assert.equal(detail.hidden, false);
    assert.equal(detail.textContent, '+2.95 LVL 100 TICKETS');
    assert.equal(
      el.querySelector('[data-bind="dec-entry-price"]').getAttribute('aria-label'),
      '1 ENTRY = 0.06 ETH',
    );
    assert.equal(
      el.querySelector('[data-bind="dec-ticket-price"]').getAttribute('aria-label'),
      '1 TICKET = 0.24 ETH',
    );
    assert.equal(
      el.querySelector('[data-bind="dec-pack-price"]').getAttribute('aria-label'),
      '1 PACK = 2.40 ETH',
    );
    assert.match(
      el.querySelector('[data-bind="dec-flip-credit"]').getAttribute('aria-label'),
      /Level 100 bonus: \+2\.95 tickets/,
    );
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
    // The coinflip funds box is now a printed AVAILABLE FUNDS plate with no
    // disclosure, so df-funds__chevron no longer exists.
    for (const selector of ['inv-disclosure__chevron', 'dec-funds__chevron']) {
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
    let opened = null;
    el.addEventListener('app-all-in:open', (event) => { opened = event.detail; });
    el.querySelector('[data-bind="dec-all-in"]').dispatchEvent({ type: 'click' });
    const quote = opened?.quote({ currency: 'ETH', target: 'tickets', spins: 5 });
    assert.equal(quote?.valid, true,
      'the optional AFKing read cannot strand known Wallet + Claimable ETH behind a loading message');
    assert.doesNotMatch(quote?.message || '', /balance is still loading/i);
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

  test('claimable holds its last settled value without disabling the ETH claim', async () => {
    storeMod.update('app.lastDay', { day: 67 });
    heldBalanceValue({
      namespace: 'claimable-eth:84532',
      scope: CONNECTED,
      value: lootboxMod.scaledTicketPriceWei(12) / 2n,
      released: true,
    });
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
    assert.equal(display.getAttribute('data-balance-held'), 'true');
    assert.equal(totalDisplay.getAttribute('data-balance-held'), 'true');
    assert.doesNotMatch(total.textContent, /•/, 'Available Funds paints a settled number, never a mask');
    assert.doesNotMatch(value.textContent, /•/, 'Claimable paints the prior settled number');
    assert.match(value.textContent, /\d/, 'the prior settled amount remains readable');
    assert.equal(unit.textContent, 'ETH');
    assert.equal(value.getAttribute('role'), null, 'the RNG hold has no manual reveal bypass');
    const heldValue = value.textContent;
    total.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.equal(value.textContent, heldValue, 'clicking Available Funds cannot bypass the hold');
    el.querySelector('[data-bind="dec-funds-toggle"]').dispatchEvent({ type: 'click' });
    assert.equal(claim.hidden, false);
    assert.equal(claim.disabled, false, 'holding presentation never gates existing ETH winnings');
    value.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.equal(value.textContent, heldValue, 'clicking Claimable cannot reveal the queued amount');

    globalThis.localStorage.setItem('spun_day_84532_67', '1');
    storeMod.update('app.lastDay', { day: 67 });
    assert.equal(display.getAttribute('data-balance-held'), 'false');
    assert.equal(totalDisplay.getAttribute('data-balance-held'), 'false');
    assert.notEqual(value.textContent, heldValue, 'the queued balance is inserted only after reveal');
    assert.equal(unit.textContent, 'ETH');
    assert.equal(value.getAttribute('aria-hidden'), null);
    assert.equal(claim.disabled, false);
    assert.doesNotMatch(APP_CSS, /--main-balance-spoiler-blur|filter:\s*blur\(var\(--main-balance/,
      'primary balances no longer use the old blur treatment');
    el.disconnectedCallback();
  });

  test('collapsed Total holds only the RNG-sensitive claimable component', async () => {
    const el = instantiate();
    await settle(60);
    const total = el.querySelector('[data-bind="dec-funds-total"]');
    const totalDisplay = el.querySelector('[data-bind="dec-funds-total-display"]');
    assert.equal(total.textContent, '3.12');

    pendingActionsMod.publishPendingActions('degenerette-live', [{
      id: 'degenerette:eth:1', kind: 'degenerette', currency: 0, mayAddEth: true,
      phase: 'waiting-rng', state: 'waiting', label: '1 spin',
    }]);
    assert.equal(total.textContent, '3.12', 'an ETH-capable RNG does not blank the settled total');
    assert.equal(totalDisplay.getAttribute('data-balance-held'), 'true');

    contractsMod.setProvider(makeFakeProvider(CONNECTED, 4_125_000_000_000n));
    storeMod.update('connected.address', CONNECTED);
    await settle(60);
    assert.equal(total.textContent, '4.12',
      'an ordinary wallet change still updates while RNG-derived claimable ETH is held');
    assert.equal(totalDisplay.getAttribute('data-balance-held'), 'true',
      'the wallet refresh does not release the queued RNG credit');

    pendingActionsMod.publishPendingActions('degenerette-live', [{
      id: 'degenerette:flip:1', kind: 'degenerette', currency: 1, mayAddEth: false,
      phase: 'waiting-rng', state: 'waiting', label: '1 spin',
    }]);
    assert.equal(total.textContent, '4.12', 'a FLIP-only result cannot change the ETH aggregate');
    assert.equal(totalDisplay.getAttribute('data-balance-held'), 'false');

    pendingActionsMod.publishPendingActions('lootbox-live', [{
      id: 'lootbox:1', kind: 'lootbox', resolved: true, mayAddEth: true,
      phase: 'result-ready', state: 'ready', label: 'Luckbox',
    }]);
    assert.equal(total.textContent, '4.12', 'an indexed unseen lootbox keeps the last settled total');
    el.disconnectedCallback();
  });

  test('ALL IN uses known ETH while the ordinary balance holds its settled value', async () => {
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
    assert.equal(el.querySelector('[data-bind="dec-funds-total"]').textContent, '3.12');
    assert.equal(
      el.querySelector('[data-bind="dec-funds-total-display"]').getAttribute('data-balance-held'),
      'true',
    );

    let opened = null;
    el.addEventListener('app-all-in:open', (event) => { opened = event.detail; });
    el.querySelector('[data-bind="dec-all-in"]').dispatchEvent({ type: 'click' });
    assert.ok(opened);
    const quote = opened.quote({ currency: 'ETH', target: 'lootbox', spins: 5 });
    assert.equal(quote.valid, true,
      'an explicit ALL IN quote can use known ETH without waiting for the presentation hold');
    assert.doesNotMatch(quote.message || '', /hidden|pending/i);
    el.disconnectedCallback();
  });

  test('ALL IN can refresh authoritative ETH without opening the balance spoiler', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) return DEFAULT_GAME_STATE;
      if (u.includes('/foil')) return { present: false, level: 12 };
      return { claimableEth: '1', flipBalance: '0' };
    };
    const el = instantiate();
    await settle(60);
    let opened = null;
    el.addEventListener('app-all-in:open', (event) => { opened = event.detail; });
    el.querySelector('[data-bind="dec-all-in"]').dispatchEvent({ type: 'click' });
    const before = opened.quote({ currency: 'ETH', target: 'tickets', spins: 5 });

    const price = lootboxMod.scaledTicketPriceWei(12);
    contractsMod.setProvider(makeFakeProvider(CONNECTED, 5_125_000_000_000n));
    claimsMod.__setContractFactoryForTest(() => ({
      claimableWinningsOf: async () => (price * 2n) + 1n,
    }));
    await opened.refreshCurrency('ETH');
    const after = opened.quote({ currency: 'ETH', target: 'tickets', spins: 5 });

    assert.equal(after.valid, true);
    assert.ok(after.spendWei > before.spendWei,
      'the chooser refresh callback adopts fresh wallet and chain-claimable ETH behind the spoiler');
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
      centuryBonusBps,
      formatPurchaseTicketUnits,
      purchaseCenturyBonus,
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
    assert.equal(centuryBonusBps(0), 0n);
    assert.equal(centuryBonusBps(100), 2_950n);
    assert.equal(centuryBonusBps(305), 9_000n);
    assert.equal(centuryBonusBps(500), 9_800n);
    assert.equal(centuryBonusBps(30_000), 10_000n);
    assert.equal(formatPurchaseTicketUnits(1_475n), '3.6875');
    assert.equal(
      purchaseCenturyBonus({
        targetLevel: 100,
        tickets: 10,
        priceWei: lootboxMod.scaledTicketPriceWei(100),
        activityScore: 100,
      }).bonusUnits,
      1_180n,
      'ten tickets at 100 activity points earn 2.95 century tickets',
    );
    assert.equal(
      purchaseCenturyBonus({
        targetLevel: 100,
        tickets: 10,
        priceWei: lootboxMod.scaledTicketPriceWei(100),
        activityScore: 100,
        ticketBoonBps: 2_500,
      }).bonusUnits,
      1_475n,
      'the century curve consumes the boon-adjusted ticket quantity',
    );
    const cappedCentury = purchaseCenturyBonus({
      targetLevel: 100,
      tickets: 100,
      priceWei: lootboxMod.scaledTicketPriceWei(100),
      activityScore: 30_000,
    });
    assert.equal(cappedCentury.grossBonusUnits, 40_000n);
    assert.equal(cappedCentury.bonusUnits, 33_333n,
      'the 20 ETH-equivalent allowance caps a full-score century award');
    assert.equal(
      purchaseCenturyBonus({
        targetLevel: 100,
        tickets: 100,
        priceWei: lootboxMod.scaledTicketPriceWei(100),
        activityScore: 30_000,
        usedUnits: 33_000n,
      }).bonusUnits,
      333n,
      'prior Level 100 bonus use is deducted from the remaining allowance',
    );
    assert.equal(
      purchaseCenturyBonus({
        targetLevel: 99,
        tickets: 10,
        priceWei: lootboxMod.scaledTicketPriceWei(99),
        activityScore: 500,
      }),
      null,
      'ordinary levels never show a century bonus',
    );
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
    assert.doesNotMatch(PURCHASE_DESK_CSS, /\.dec-funds-stack::before\s*\{/,
      'no decorative divider sits above the ALL IN action');
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

  test('ALL IN prefers the live GAME score over a stale indexed Degen Rating', async () => {
    decimatorMod.__setDecimatorContextReaderForTest(async () => ({ activityScore: 61 }));
    _fetchHandler = async (url) => String(url).includes('/game/state')
      ? DEFAULT_GAME_STATE
      : { claimableEth: '0', flipBalance: '0', scoreBreakdown: { totalBps: 12 } };

    const el = instantiate();
    await settle(60);

    assert.equal(el.querySelector('[data-bind="dec-all-in"]').hidden, false,
      'the current contract score unlocks the control even while /player is stale');
    assert.equal(storeMod.get('ui.allInEligible'), true);
    el.disconnectedCallback();
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

  test('the bonus keeps a stable splashy header slot in both idle and active states', async () => {
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
    assert.equal(tally.classList.contains('is-receiving'), true,
      'the reserved bonus instrument pulses when its numeric FLIP total rises');
    assert.equal(el.querySelectorAll('[data-bind="dec-flip-credit-total"]').length, 1);
    assert.doesNotMatch(tally.textContent, /purchase|bulk|rebuy/i, 'no detailed breakdown');
    assert.match(PANEL_SRC, /\/whitepaper\/flame-logo-split\.svg/);
    assert.match(
      PANEL_SRC,
      /<div class="panel-header">[\s\S]*?data-bind="dec-flip-credit"[\s\S]*?<\/div>\s*<\/div>/,
      'BONUS lives in the header instead of changing the order rail',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /Approved compact asset desk[\s\S]*?\.panel-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 8rem;[^}]*grid-template-rows:\s*auto auto;[^}]*gap:\s*0\.22rem 0\.24rem;/s,
      'the price keeps its wider content column beside the compact bonus',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /Approved compact asset desk[\s\S]*?\.dec-header-title\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*1/s,
      'BUY IN owns the full first row above both instruments',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-price\s*\{[^}]*display:\s*grid;[^}]*gap:\s*0\.1rem;/s,
      'entry, ticket, and pack prices occupy distinct lines in the rate window',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-price\s*\{[^}]*grid-template-columns:\s*1ch 1ch 6ch 2ch 1ch 2ch max-content 1ch max-content;[^}]*justify-content:\s*center/s,
      'all three quotes share centered count, kind, equals, content-sized amount, and unit columns',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-price > \.dec-price__row\s*\{[^}]*display:\s*contents/s,
      'all quote rows participate in the same alignment grid',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-price__amount\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/s,
      'the exact 10,000 FLIP pack value is not clipped at the old fixed-width boundary',
    );
    // The unit owns a column of its own, so ETH/FLIP holds one x down all
    // quotes no matter how many digits the amounts above or below it take.
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-price__amount\s*\{[^}]*grid-column:\s*7;[^}]*text-align:\s*left;/s,
      'the amount stays left-aligned in its own content-sized column',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-price__unit\s*\{[^}]*grid-column:\s*9;[^}]*text-align:\s*left;/s,
      'the unit left-aligns into a separate column shared by both quotes',
    );
    assert.match(
      PANEL_SRC,
      /renderPurchasePriceRow\(entryPriceEl, 'ENTRY', entryPriceText, priceUnit\);[\s\S]*?renderPurchasePriceRow\(ticketPriceEl, 'TICKET', ticketPriceText, priceUnit\);[\s\S]*?renderPurchasePriceRow\(packPriceEl, 'PACK', packPriceText, priceUnit\);/,
      'alignment does not change the quote strings, and all carry the same unit',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /Approved compact asset desk[\s\S]*?\.panel-header\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*none;[^}]*box-shadow:\s*none;/s,
      'BUY IN sits directly on the purchase panel instead of inside a redundant nested box',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-price\s*\{[^}]*height:\s*2\.8rem;[^}]*min-height:\s*2\.8rem;[^}]*border-radius:\s*5px;[\s\S]*?\.dec-flip-credit--header\s*\{[^}]*height:\s*2\.8rem;[^}]*min-height:\s*2\.8rem;[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;[^}]*align-self:\s*stretch;[^}]*border-radius:\s*5px;/s,
      'the price and bonus use exactly the same height and corner geometry',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-flip-credit--header\s*\{[^}]*box-shadow:\s*0 0 0 1px rgba\(124, 88, 34, 0\.5\),/s,
      'the bonus paints the same one-pixel outer frame as the price window',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /Approved compact asset desk[\s\S]*?\.dec-purchase-help\s*\{[^}]*right:\s*auto;[^}]*left:\s*0\.08rem;/s,
      'the info control occupies the upper-left corner of the title row',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-flip-credit--header\s*\{[^}]*radial-gradient\([^}]*linear-gradient\(130deg,/s,
      'the bonus slot has the approved splashy layered background',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-flip-credit--header:not\(\.is-idle\):not\(\.dec-flip-credit--bounty\) > strong\s*\{[^}]*color:\s*#a5f3fc;[^}]*font-size:\s*0\.68rem;/s,
      'ordinary earned bonus FLIP gets a brighter cyan readout without replacing the bounty gold',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-flip-credit--header\.dec-flip-credit--bounty > strong\s*\{[^}]*color:\s*#facc15;[^}]*font-size:\s*0\.68rem;/s,
      'a bounty-enhanced bonus retains its separate gold value treatment in the final stylesheet',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-flip-credit--header\.is-receiving\s*\{[^}]*dec-bonus-flip-panel-increase 640ms[\s\S]*?@keyframes dec-bonus-flip-value-increase/s,
      'an increase gives the instrument and its number one short authored pulse',
    );

    tally.classList.remove('is-receiving');
    input.dispatchEvent({ type: 'input' });
    assert.equal(tally.classList.contains('is-receiving'), false,
      'an unchanged render does not replay the increase animation');
    input.value = '11.75';
    input.dispatchEvent({ type: 'input' });
    assert.equal(tally.classList.contains('is-receiving'), true,
      'a subsequent real increase restarts the pulse');
    assert.equal(el.querySelector('[data-bind="dec-flip-credit-total"]').textContent, '+1.65K FLIP');

    input.value = '0.75';
    input.dispatchEvent({ type: 'input' });
    assert.equal(tally.classList.contains('is-receiving'), false,
      'lowering the draft cancels an in-flight increase cue');
    assert.equal(tally.hidden, false, 'the reserved bonus slot never disappears');
    assert.equal(tally.classList.contains('is-idle'), true);
    assert.equal(el.querySelector('[data-bind="dec-flip-credit-label"]').textContent, 'PLAY TO EARN');
    assert.equal(el.querySelector('[data-bind="dec-flip-credit-total"]').textContent, 'BONUS FLIP');
    assert.match(
      PURCHASE_DESK_CSS,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dec-flip-credit--header\.is-receiving[\s\S]*?animation:\s*none;/s,
      'the stronger steady color remains while reduced motion suppresses the pulse',
    );
    el.disconnectedCallback();
  });

  test('Entry, Ticket, and Pack visuals add 0.25, 1, and 10 to the ticket field', async () => {
    const el = instantiate();
    await settle(60);

    const input = el.querySelector('[name="dec-tickets"]');
    const entry = el.querySelector('[data-bind="dec-ticket-add-entry"]');
    const ticket = el.querySelector('[data-bind="dec-ticket-add-ticket"]');
    const pack = el.querySelector('[data-bind="dec-ticket-add-pack"]');
    input.value = '0';
    entry.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.25', 'Entry adds one quarter ticket');
    ticket.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '1.25', 'up adds one whole ticket');
    pack.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '11.25', 'Pack adds ten tickets');
    let preventedMenus = 0;
    const removeEvent = {
      type: 'contextmenu',
      preventDefault() { preventedMenus += 1; },
    };
    pack.dispatchEvent(removeEvent);
    assert.equal(input.value, '1.25', 'right-clicking Pack removes ten tickets');
    ticket.dispatchEvent(removeEvent);
    assert.equal(input.value, '0.25', 'right-clicking Ticket removes one ticket');
    entry.dispatchEvent(removeEvent);
    assert.equal(input.value, '0', 'right-clicking Entry removes one quarter-ticket entry');
    entry.dispatchEvent(removeEvent);
    assert.equal(input.value, '0', 'secondary-click removal clamps at zero');
    assert.equal(preventedMenus, 4, 'purchase-piece secondary clicks suppress the browser menu');
    el.querySelector('[data-bind="dec-ticket-clear"]').dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0', 'Clear resets the editable total');
    assert.equal(input.step, '0.25', 'typed decimals use the same entry-sized increment');
    el.disconnectedCallback();
  });

  test('adding an Entry or Ticket rerolls only the clicked source artwork', async () => {
    const el = instantiate();
    await settle(60);

    const entry = el.querySelector('[data-bind="dec-ticket-add-entry"]');
    const ticket = el.querySelector('[data-bind="dec-ticket-add-ticket"]');
    const entryFace = el.querySelector('[data-bind="dec-entry-face"]');
    const ticketBadges = Array.from({ length: 4 }, (_unused, quadrant) => (
      el.querySelector(`[data-bind="dec-ticket-badge-${quadrant}"]`)
    ));
    const entryBefore = entryFace.getAttribute('data-trait-id');
    const ticketBefore = ticketBadges.map((badge) => badge.getAttribute('src'));

    entry.dispatchEvent({ type: 'click' });
    assert.notEqual(entryFace.getAttribute('data-trait-id'), entryBefore,
      'the shelf entry changes after its original artwork has been added');
    assert.deepEqual(ticketBadges.map((badge) => badge.getAttribute('src')), ticketBefore,
      'adding an entry does not also replace the four-symbol ticket');

    const entryAfter = entryFace.getAttribute('data-trait-id');
    ticket.dispatchEvent({ type: 'click' });
    assert.notDeepEqual(ticketBadges.map((badge) => badge.getAttribute('src')), ticketBefore,
      'the shelf ticket changes to a fresh four-symbol combination after it is added');
    assert.equal(entryFace.getAttribute('data-trait-id'), entryAfter,
      'adding a ticket does not also replace the entry symbol');
    el.disconnectedCallback();
  });

  test('a shelf add flies its actual artwork into the TIX receipt and confirms the landing', async () => {
    const el = instantiate();
    await settle(60);

    const panel = el.querySelector('.app-decimator-panel');
    const target = el.querySelector('.dec-ticket-total__field');
    const entry = el.querySelector('[data-bind="dec-ticket-add-entry"]');
    const artwork = makeFakeElement('span');
    artwork.classList.add('dec-ticket-piece__art');
    artwork.getBoundingClientRect = () => ({ left: 30, top: 40, width: 40, height: 40 });
    artwork.cloneNode = () => {
      const clone = makeFakeElement('span');
      clone.classList.add('dec-ticket-piece__art');
      return clone;
    };
    entry.querySelector = (selector) => selector === '.dec-ticket-piece__art' ? artwork : null;
    panel.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 300 });
    target.getBoundingClientRect = () => ({ left: 110, top: 180, width: 80, height: 40 });

    entry.dispatchEvent({ type: 'click' });
    const flyer = panel.querySelector('.dec-purchase-flyer');
    assert.ok(flyer, 'the click mounts one transient copy inside the purchase desk');
    assert.equal(flyer.getAttribute('aria-hidden'), 'true');
    assert.equal(flyer.querySelector('.dec-purchase-flyer__quantity').textContent, '+¼');
    assert.equal(flyer.style.left, '20px');
    assert.equal(flyer.style.getPropertyValue('--dec-flight-x'), '100px',
      'the flight terminates at the center of the TIX field');

    flyer.dispatchEvent({ type: 'animationend' });
    assert.equal(panel.querySelector('.dec-purchase-flyer'), null,
      'the decorative clone is removed as soon as it lands');
    assert.equal(target.classList.contains('is-receiving'), true,
      'the TIX receipt confirms the handoff only after landing');
    assert.match(PURCHASE_DESK_CSS,
      /@keyframes dec-purchase-flight[\s\S]*?var\(--dec-flight-mid-x\)[\s\S]*?var\(--dec-flight-x\)/,
      'the route has a visible arc rather than a straight fade');
    assert.match(PURCHASE_DESK_CSS,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dec-purchase-flyer\s*\{\s*display:\s*none;/,
      'motion preferences suppress the decorative flight');
    el.disconnectedCallback();
  });

  test('Luckbox presets integrate clean prices into the case art and keep independent quantities', async () => {
    const el = instantiate();
    await settle(60);

    assert.equal(el.querySelector('[data-bind="dec-entry-price"]').textContent,
      '1 ENTRY - 0.01 ETH');
    assert.equal(el.querySelector('[data-bind="dec-ticket-price"]').textContent,
      '1 TICKET - 0.04 ETH');
    assert.equal(el.querySelector('[data-bind="dec-pack-price"]').textContent,
      '1 PACK - 0.40 ETH');
    assert.equal(el.querySelector('[data-bind="dec-box-price-small"]').textContent, '0.04');
    assert.equal(el.querySelector('[data-bind="dec-box-price-medium"]').textContent, '0.2');
    assert.equal(el.querySelector('[data-bind="dec-box-price-large"]').textContent, '1');
    assert.equal(el.querySelector('[data-bind="dec-box-price-small-unit"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-box-price-medium-unit"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="dec-box-price-large-unit"]').hidden, false,
      'a whole-number gold-box price reads as 1 ETH instead of an old tier number');
    for (const tier of ['small', 'medium', 'large']) {
      const asset = {
        small: 'degenerus-lootbox-case-small-v21-plain-lid-large-badge-buy-in-card\\.webp',
        medium: 'degenerus-lootbox-case-medium-v28-quiet-quadrant-buy-in-card\\.webp',
        large: 'degenerus-lootbox-case-large-v36-buy-in-card\\.webp',
      }[tier];
      assert.match(
        el.innerHTML,
        new RegExp(`dec-box-card--${tier}[\\s\\S]*?data-lootbox-case-model="${tier}"[\\s\\S]*?${asset}`),
        `${tier} purchase art uses its Buy In screen asset`,
      );
      const input = el.querySelector(`[name="dec-box-${tier}"]`);
      el.querySelector(`[data-bind="dec-box-add-${tier}"]`).dispatchEvent({ type: 'click' });
      assert.equal(input.value, '1', `${tier} card increments only its own field`);
    }
    assert.match(el.querySelector('[data-bind="dec-box-summary"]').textContent, /3 boxes/);
    let preventedMenus = 0;
    for (const tier of ['small', 'medium', 'large']) {
      const input = el.querySelector(`[name="dec-box-${tier}"]`);
      el.querySelector(`[data-bind="dec-box-add-${tier}"]`).dispatchEvent({
        type: 'contextmenu',
        preventDefault() { preventedMenus += 1; },
      });
      assert.equal(input.value, '0', `right-clicking ${tier} removes one box`);
    }
    assert.equal(preventedMenus, 3, 'Luckbox secondary clicks suppress the browser menu');
    assert.match(el.innerHTML, /class="dec-box-value">\s*<strong data-bind="dec-box-price-small">—<\/strong>\s*<small class="dec-box-value__unit" data-bind="dec-box-price-small-unit" hidden>ETH<\/small>\s*<\/span>/,
      'the case center includes an integrated unit reserved for ambiguous whole prices');
    assert.doesNotMatch(el.innerHTML, /class="dec-box-value">\s*(?:1|5|25)\s*<\/span>/,
      'the old tier-number overlays are gone');
    assert.doesNotMatch(el.innerHTML, />SMALL<|>MEDIUM<|>LARGE</,
      'the box art communicates tier without redundant labels');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card__add\s*\{[^}]*appearance:\s*none;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*cursor:\s*pointer;/s,
      'the case image owns the complete button hit area without visible button chrome');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-input-group--lootbox\.dec-purchase-builder\s*\{[^}]*padding:\s*0 0\.4rem;/s,
      'the Luckbox builder keeps only horizontal frame padding');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card\s*\{[^}]*--box-visible-aspect:\s*1\.3693;[^}]*--box-art-canvas-width:\s*104\.96%;[^}]*--box-art-left:\s*-2\.33%;[^}]*--box-art-top:\s*-13\.85%;[^}]*width:\s*min\(6\.2rem, 100%\);[^}]*aspect-ratio:\s*var\(--box-visible-aspect\);[^}]*justify-self:\s*center;[^}]*align-self:\s*end;[^}]*border:\s*0;[^}]*background:\s*none;[^}]*box-shadow:\s*none;/s,
      'the invisible case shell defaults to the measured visible bounds of the gold art');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card\.is-selected\s*\{[^}]*border:\s*0;[^}]*background:\s*none;[^}]*box-shadow:\s*none;/s,
      'selecting a case does not restore the old rectangular shell');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card\[data-tone="green"\]\s*\{[^}]*width:\s*min\(4\.2rem, 74%\);[^}]*translate:\s*0 -2px;[\s\S]*?\.dec-box-card\[data-tone="purple"\]\s*\{[^}]*width:\s*min\(6\.4rem, 96%\);[^}]*translate:\s*0 -3px;/s,
      'Small is visibly reduced while both compact cases sit clear of the panel floor and preserve their shared baseline');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card\[data-tone="green"\]\s*\{[^}]*--box-art-perspective-y:\s*1;[\s\S]*?\.dec-box-card\[data-tone="purple"\]\s*\{[^}]*--box-art-perspective-y:\s*1;/s,
      'both compact cases use their authored perspective without runtime vertical stretching');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card\[data-tone="green"\]\s*\{[^}]*--box-visible-aspect:\s*1\.2663;[^}]*--box-art-canvas-width:\s*119\.05%;[^}]*--box-art-left:\s*-8\.73%;[^}]*--box-art-top:\s*-20\.24%;[\s\S]*?\.dec-box-card\[data-tone="purple"\]\s*\{[^}]*--box-visible-aspect:\s*1\.3696;[^}]*--box-art-canvas-width:\s*119\.05%;[^}]*--box-art-left:\s*-8\.73%;[^}]*--box-art-top:\s*-26\.06%;/s,
      'each tier uses measured alpha bounds so the visible cases, not their transparent canvases, share the grid baseline');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card > \.dec-box-quantity\s*\{[^}]*top:\s*-1\.08rem;/s,
      'selected box counts sit above the recessed price instead of covering it');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card__art\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*left:\s*0;[^}]*width:\s*var\(--box-art-canvas-width\);[^}]*height:\s*auto;[^}]*aspect-ratio:\s*1;[^}]*margin-top:\s*var\(--box-art-top\);[^}]*margin-left:\s*var\(--box-art-left\);/s,
      'the transparent source canvas is registered behind the compact visible-bounds button');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card__add:hover \.dec-box-card__art,[\s\S]*?\.dec-box-card\.is-selected \.dec-box-card__art\s*\{[^}]*filter:\s*brightness\(1\.08\) drop-shadow\([^}]*transform:\s*translateY\(-1px\) scale\(1\.02\) scaleY\(var\(--box-art-perspective-y\)\);/s,
      'hover, keyboard focus, and selection preserve each case camera registration');
    assert.equal(el.querySelectorAll('.dec-box-card__image').length, 3,
      'all three authored case bitmaps participate in the shared readiness handoff');
    const coldImage = el.querySelectorAll('.dec-box-card__image')[0];
    assert.equal(coldImage.classList.contains('is-art-ready'), false,
      'the lightweight silhouette owns the cold-cache first paint');
    coldImage.dispatchEvent({ type: 'load' });
    assert.equal(coldImage.classList.contains('is-art-ready'), true,
      'the full case takes over as one unit only after its bitmap loads');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card__art > \.dec-box-card__quickload\s*\{[^}]*aspect-ratio:\s*1\.4;[^}]*background:[^}]*opacity:\s*1;[^}]*pointer-events:\s*none;/s,
      'the immediate placeholder is a CSS-only case silhouette with no text or image request');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card__art > img\.is-art-ready \+ \.dec-box-card__quickload\s*\{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;/s,
      'the placeholder leaves only when the adjacent authored image is ready');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card__art > \.dec-box-value\s*\{[^}]*opacity:\s*0;[\s\S]*?img\.is-art-ready ~ \.dec-box-value\s*\{[^}]*opacity:\s*1;/s,
      'a live price cannot hang in an empty slot before its case artwork loads');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card__art::after\s*\{[^}]*background:\s*var\(--box-tone\);[^}]*mix-blend-mode:\s*color;[^}]*opacity:\s*0;/s,
      'the base rule leaves the authored gold briefcase palette untouched');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card:is\([\s\S]*data-lootbox-case-model="small"[\s\S]*data-lootbox-case-model="medium"[\s\S]*?\) \.dec-box-card__art::after\s*\{[^}]*opacity:\s*0;/s,
      'the authored green and purple compact cases are not washed into one flat color');
    const badgeLayer = PURCHASE_DESK_CSS.match(/\.dec-box-card__art::before\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(badgeLayer,
      /top:\s*var\(--lootbox-top-badge-top, 77\.5%\);[\s\S]*?width:\s*var\(--lootbox-top-badge-size, 16\.8%\);[\s\S]*?flame-logo\.svg[\s\S]*?scaleY\(var\(--lootbox-top-badge-scale-y, 0\.78\)\)/s,
      'the gold card retains its existing separately registered official badge');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card:is\([\s\S]*data-lootbox-case-model="small"[\s\S]*data-lootbox-case-model="medium"[\s\S]*?\) \.dec-box-card__art::before\s*\{[^}]*display:\s*none;/s,
      'the compact pair does not inherit the separate gold-box badge layer');
    assert.equal(
      (el.innerHTML.match(/class="dec-box-card__latches"/g) ?? []).length,
      0,
      'Buy In does not double the latch hardware already baked into the approved compact art',
    );
    assert.doesNotMatch(el.innerHTML, /dec-box-card__(?:corner-metal|badge-inset)/,
      'the historical compact art supplies its own original corners and badge');
    assert.doesNotMatch(PURCHASE_DESK_CSS, /dec-box-card__latches|buy-in-latch-/,
      'no synthetic strips or duplicate latch construction is painted over the old case graphics');
    assert.doesNotMatch(PURCHASE_DESK_CSS,
      /dec-box-card__corner-metal|dec-box-card__badge-inset|buy-in-corner|buy-in-badge|medium-v(?:14|17)-deadbolt/,
      'Buy In neither repaints the original corners/badge nor pastes old latch backgrounds over the cases');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-card__art > \.dec-box-value\s*\{[^}]*top:\s*var\(--lootbox-price-top, 27%\);[^}]*display:\s*flex;[^}]*width:\s*var\(--lootbox-price-width, 45%\);[^}]*height:\s*var\(--lootbox-price-height, 19%\);[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*background:\s*none;[^}]*box-shadow:\s*none;/s,
      'the live price sits inside the broad display engineered into the top lid');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-value > strong\s*\{[^}]*color:\s*#fff6d8;[^}]*font:\s*900 var\(--box-price-size\)\/1[^}]*font-variant-numeric:\s*tabular-nums;[^}]*-webkit-text-stroke:\s*0\.02em[^}]*paint-order:\s*stroke fill;[^}]*text-shadow:/s,
      'each case size gives its x.xx price a clear embossed-metal treatment');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-box-value > small\s*\{[^}]*color:\s*#fff6d8;[^}]*font:\s*900 var\(--box-unit-size\)\/1[^}]*letter-spacing:\s*-0\.045em;[^}]*-webkit-text-stroke:\s*0\.02em[^}]*text-shadow:/s,
      'the conditional ETH suffix uses the same face, color, and embossed treatment as its price');
    assert.doesNotMatch(PURCHASE_DESK_CSS,
      /\.dec-box-card\[data-lootbox-case-model="large"\] \.dec-box-value > :is\(strong, small\)/,
      'the gold box inherits the same ivory embossed price treatment as the other two boxes');
    assert.equal(el.querySelector('[data-bind="dec-box-summary"]').textContent, 'Choose any mix of boxes.');
    el.disconnectedCallback();
  });

  test('a 0.12 ETH ticket price renders the gold preset as 3 ETH', async () => {
    _fetchHandler = async (url) => (
      String(url).includes('/game/state')
        ? { ...DEFAULT_GAME_STATE, level: 65 }
        : { player: null, pending: {} }
    );
    const el = instantiate();
    await settle(60);

    assert.equal(el.querySelector('[data-bind="dec-box-price-small"]').textContent, '0.12');
    assert.equal(el.querySelector('[data-bind="dec-box-price-medium"]').textContent, '0.6');
    assert.equal(el.querySelector('[data-bind="dec-box-price-large"]').textContent, '3');
    assert.equal(el.querySelector('[data-bind="dec-box-price-large-unit"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="dec-box-price-large-unit"]').textContent, 'ETH');
    el.disconnectedCallback();
  });

  test('Custom Box starts at one box, resets on dismiss, and buys from the chooser action', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);
    const toggle = el.querySelector('[data-bind="dec-custom-box-toggle"]');
    const fields = el.querySelector('[data-bind="dec-custom-box-fields"]');
    const count = el.querySelector('[name="dec-box-custom-count"]');
    const size = el.querySelector('[name="dec-box-custom-eth"]');
    const selection = el.querySelector('[data-bind="dec-custom-box-selection"]');
    let amountFocuses = 0;
    let amountSelections = 0;
    size.focus = () => { amountFocuses += 1; };
    size.select = () => { amountSelections += 1; };

    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-custom-box-toggle\s*\{[^}]*min-height:\s*1\.78rem;[^}]*margin:\s*0;[^}]*padding:\s*0\.16rem 0\.46rem 0\.16rem 0\.24rem;[^}]*text-align:\s*left;/s,
      'the combined Custom Luckboxes trigger fits the upper-left header slot',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-input-group--lootbox \.dec-builder-head\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
      'the compact header reserves one unified custom and presale action',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-input-group--lootbox \.dec-builder-title\s*\{[^}]*grid-column:\s*1;[^}]*justify-self:\s*start;[^}]*text-align:\s*left;/s,
      'the Custom Luckboxes action owns the upper-left header position',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-custom-box-logo\s*\{[^}]*width:\s*1\.24rem;[^}]*height:\s*1\.24rem;[^}]*place-items:\s*center;[^}]*border:[^}]*background:[^}]*[\s\S]*?\.dec-custom-box-logo > svg\s*\{[^}]*stroke:\s*#ddc8ee;/s,
      'the action carries its own compact custom-chest logo',
    );
    assert.equal(selection.hidden, true, 'the button has no selection summary before a custom box is chosen');
    assert.equal(toggle.getAttribute('aria-label'), 'Configure custom Luckboxes');

    toggle.dispatchEvent({ type: 'click' });
    assert.equal(fields.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(count.value, '1', 'opening the popup starts with one custom box');
    assert.equal(size.value, '0.01');
    assert.equal(amountFocuses, 1, 'the amount field receives focus');
    assert.equal(amountSelections, 1, 'typing immediately replaces the selected amount');
    assert.equal(selection.hidden, false);
    assert.equal(selection.textContent, '1 CUSTOM · 0.01 ETH EACH');
    assert.equal(el.querySelector('[data-bind="dec-custom-box-buy-amount"]').textContent, '0.01 ETH',
      'the chooser action quotes the transaction amount');
    assert.equal(toggle.getAttribute('aria-label'), 'Edit 1 custom Luckbox at 0.01 ETH each');
    assert.match(el.querySelector('[data-bind="dec-box-summary"]').textContent, /1 box · 0\.01 ETH/);
    size.value = '0.02';
    size.dispatchEvent({ type: 'input' });
    assert.equal(selection.textContent, '1 CUSTOM · 0.02 ETH EACH');
    assert.equal(el.querySelector('[data-bind="dec-custom-box-buy-amount"]').textContent, '0.02 ETH',
      'the chooser action follows the edited custom-box total');
    assert.match(el.querySelector('[data-bind="dec-box-summary"]').textContent, /1 box · 0\.02 ETH/);

    el.querySelector('[data-bind="dec-custom-box-close"]').dispatchEvent({ type: 'click' });
    assert.equal(fields.hidden, true, 'the X/backdrop path closes without purchasing');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    // Dismissing abandons the draft. These amounts are visible nowhere else, so
    // carrying them past a cancel would arm the next BUY IN with boxes the
    // player believed they had thrown away.
    assert.equal(count.value, '0', 'dismissing resets the box count to zero');
    assert.equal(size.value, '0.01', 'dismissing resets the per-box size to its default');
    assert.equal(selection.hidden, true, 'and the collapsed button advertises no selection');
    assert.doesNotMatch(el.querySelector('[data-bind="dec-box-summary"]').textContent, /1 box/,
      'the order summary drops the abandoned box');
    assert.equal(fakeContract._calls.purchase.length, 0, 'cancel never sends a transaction');
    assert.match(
      PURCHASE_DESK_CSS,
      /\.app-decimator-panel:has\(> \.dec-builder-popover:not\(\[hidden\]\)\)[^{]*\{[^}]*isolation:\s*auto;[^}]*overflow:\s*visible;/s,
      'the active popup escapes the clipped BUY IN panel instead of exposing Degenerette below it',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-builder-popover__backdrop\s*\{[^}]*background:\s*#030205;/s,
      'the modal backdrop is opaque so the page cannot show through',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-builder-dialog__done\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto auto;[^}]*place-content:\s*center;/s,
      'the popup action keeps its label and live amount together inside the button',
    );

    toggle.dispatchEvent({ type: 'click' });
    assert.equal(fields.hidden, false);
    assert.equal(count.value, '1', 'reopening starts fresh at one box');
    assert.equal(size.value, '0.01', 'reopening starts fresh at the default size');
    size.value = '0.02';
    size.dispatchEvent({ type: 'input' });
    el.querySelector('[data-bind="dec-custom-box-buy"]').dispatchEvent({ type: 'click' });
    await settle(100);
    assert.equal(fields.hidden, true, 'the chooser closes as its purchase is submitted');
    assert.equal(fakeContract._calls.purchase.length, 1,
      'the bottom chooser action reaches the existing guarded purchase path');
    assert.equal(
      fakeContract._calls.purchase[0][2],
      lootboxMod.packBoxOrder({ customCount: 1, customSizeWei: 2n * lootboxMod.LOOTBOX_MIN_WEI }),
      'the chooser submits the exact custom-box draft',
    );
    assert.equal(count.value, '0', 'the mined purchase clears the submitted box count');
    assert.equal(selection.hidden, true, 'the combined header clears after the mined purchase');
    el.disconnectedCallback();
  });

  test('the chooser previews which physical case the configured size buys', async () => {
    const el = instantiate();
    await settle(60);
    const preview = el.querySelector('[data-bind="dec-custom-box-preview"]');
    const art = el.querySelector('[data-bind="dec-custom-box-preview-art"]');
    const size = el.querySelector('[name="dec-box-custom-eth"]');
    const count = el.querySelector('[name="dec-box-custom-count"]');

    assert.equal(preview.hidden, true, 'nothing is previewed before a box is configured');

    el.querySelector('[data-bind="dec-custom-box-toggle"]').dispatchEvent({ type: 'click' });
    // The fixture ticket price is 0.04 ETH, so silver starts at the 1x/5x
    // midpoint (3x = 0.12) and gold at 16x (0.64) — lootbox-value-tone.js:46.
    assert.equal(preview.hidden, false, 'opening with one box previews that box');
    const smallArt = art.getAttribute('src');
    assert.match(smallArt, /case-small/, 'the small case render is shown');
    assert.equal(art.parentElement.getAttribute('data-lootbox-case-model'), 'small');

    // The tier is a threshold on the ticket price, not a free choice: silver
    // starts at the 1x/5x midpoint and gold at 16x (lootbox-value-tone.js:46).
    size.value = '0.11';
    size.dispatchEvent({ type: 'input' });
    assert.equal(art.parentElement.getAttribute('data-lootbox-case-model'), 'small',
      'just under the midpoint is still bronze');

    size.value = '0.12';
    size.dispatchEvent({ type: 'input' });
    assert.equal(art.parentElement.getAttribute('data-lootbox-case-model'), 'medium',
      '3x the ticket price crosses into silver');
    assert.match(art.getAttribute('src'), /case-medium/);

    size.value = '0.64';
    size.dispatchEvent({ type: 'input' });
    assert.equal(art.parentElement.getAttribute('data-lootbox-case-model'), 'large',
      '16x the ticket price crosses into gold');
    assert.match(art.getAttribute('src'), /case-large/);

    count.value = '3';
    count.dispatchEvent({ type: 'input' });
    assert.equal(preview.getAttribute('aria-label'), 'Custom Luckbox preview');
    assert.doesNotMatch(el.innerHTML,
      /dec-custom-box-preview-(?:title|detail)|>(?:SMALL|MEDIUM|LARGE) LUCKBOX</,
      'the chooser relies on the case art instead of visible size descriptors');

    count.value = '0';
    count.dispatchEvent({ type: 'input' });
    assert.equal(preview.hidden, true, 'clearing the quantity retires the preview');

    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-box-preview\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s,
      'the author display rule needs its own [hidden] companion to ever hide',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-box-preview__art\s*\{[^}]*--preview-visible-aspect:\s*1\.2663;[^}]*--preview-canvas-width:\s*119\.05%;[^}]*overflow:\s*hidden;/s,
      'the preview crops the transparent source canvas to the visible box bounds',
    );
    assert.match(
      PURCHASE_DESK_CSS,
      /\.dec-box-preview__art\[data-lootbox-case-model="large"\]\s*\{[^}]*--preview-visible-aspect:\s*1\.3693;[^}]*width:\s*min\(7rem, 100%\);/s,
      'the gold case also remains fully contained in the shared preview slot',
    );
    el.disconnectedCallback();
  });

  test('the chooser action sends even while the main BUY IN rail is disabled', async () => {
    const fakeContract = makeFakePurchaseContract();
    lootboxMod.__setContractFactoryForTest(() => fakeContract);
    const el = instantiate();
    await settle(60);

    el.querySelector('[data-bind="dec-custom-box-toggle"]').dispatchEvent({ type: 'click' });
    const count = el.querySelector('[name="dec-box-custom-count"]');
    assert.equal(count.value, '1');

    // The chooser's action is its own commit. Deferring to the main rail's
    // enabled state made a real, fully configured order silently do nothing;
    // #onBuyClick already owns the in-flight guard and every invalid-order path.
    const mainBuy = el.querySelector('[data-bind="dec-buy-cta"]');
    mainBuy.disabled = true;

    el.querySelector('[data-bind="dec-custom-box-buy"]').dispatchEvent({ type: 'click' });
    await settle(100);

    assert.equal(fakeContract._calls.purchase.length, 1,
      'the configured box still reaches the guarded purchase path');
    assert.equal(el.querySelector('[data-bind="dec-custom-box-fields"]').hidden, true,
      'and the chooser closes behind the submitted transaction');
    assert.equal(count.value, '0', 'the mined purchase clears the submitted box count');
    el.disconnectedCallback();
  });

  test('Luckbox increment controls clamp the combined order at 100 boxes', async () => {
    const el = instantiate();
    await settle(60);
    const small = el.querySelector('[name="dec-box-small"]');
    const large = el.querySelector('[name="dec-box-large"]');
    small.value = '100';
    el.querySelector('[data-bind="dec-box-add-large"]').dispatchEvent({ type: 'click' });
    assert.equal(large.value, '0', 'another tier cannot push the packed order over its cap');
    assert.match(el.querySelector('[data-bind="dec-box-summary"]').textContent, /100 boxes/);
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
    assert.equal(el.querySelector('[name="dec-box-custom-count"]').value, '1');
    assert.equal(el.querySelector('[name="dec-box-custom-eth"]').value, '0.08',
      'lootbox mission becomes one custom box at exactly two level-12 ticket prices');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent, 'BUY IN');
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
    assert.equal(el.querySelector('[name="dec-box-custom-count"]').value, '1');
    assert.equal(el.querySelector('[name="dec-box-custom-eth"]').value, '0.04');
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
    assert.equal(args[2], lootboxMod.packBoxOrder({ customCount: 1, customSizeWei: target }),
      'the submitted order contains one custom box at the exact displayed minimum');
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
    const toggle = el.querySelector('[data-bind="dec-custom-box-toggle"]');
    const fields = el.querySelector('[data-bind="dec-custom-box-fields"]');
    const title = el.querySelector('[data-bind="dec-box-options-title"]');
    const selection = el.querySelector('[data-bind="dec-custom-box-selection"]');
    const tickets = el.querySelector('[name="dec-tickets"]');
    const input = el.querySelector('[name="dec-presale-box-eth"]');
    const max = el.querySelector('[data-bind="dec-presale-max"]');
    assert.equal(row.hidden, true, 'zero current/draft credit keeps the presale option out of sight');
    assert.equal(toggle.hidden, false, 'the unified custom-box button remains available');
    assert.equal(title.textContent, 'CUSTOM LUCKBOXES');
    assert.equal(selection.hidden, true);

    tickets.value = '1'; // level-12 ticket costs 0.04 ETH and earns 0.01 box credit
    tickets.dispatchEvent({ type: 'input' });
    assert.equal(title.textContent, 'CUSTOM / PRESALE BOXES',
      'an eligible live presale is listed on the unified header button');
    assert.equal(selection.textContent, 'PRESALE AVAILABLE');
    assert.equal(row.hidden, false, 'the eligible presale option is ready inside the closed chooser');
    assert.equal(fields.hidden, true, 'eligibility does not auto-open the chooser');
    assert.equal(el.querySelector('[data-bind="dec-presale-available"]').textContent,
      '0.01 ETH AVAILABLE');
    assert.equal(max.disabled, false);
    toggle.dispatchEvent({ type: 'click' });
    assert.equal(fields.hidden, false, 'the unified button opens custom and presale options together');
    assert.equal(el.querySelector('[name="dec-box-custom-count"]').value, '0',
      'opening for an eligible presale does not silently add a custom box');

    const foil = el.querySelector('[data-bind="dec-foil-check"]');
    foil.checked = true;
    foil.dispatchEvent({ type: 'change' });
    assert.equal(title.textContent, 'CUSTOM LUCKBOXES',
      'selecting the incompatible foil leg removes Presale from the unified label');
    assert.equal(row.hidden, true, 'selecting foil removes only the incompatible option');
    assert.equal(fields.hidden, false, 'the shared custom chooser remains open');
    assert.equal(input.value, '0', 'hiding the presale row also clears its quote');
    foil.checked = false;
    foil.dispatchEvent({ type: 'change' });
    assert.equal(title.textContent, 'CUSTOM / PRESALE BOXES',
      'Presale returns to the same button when foil is unchecked');
    assert.equal(row.hidden, false, 'the option returns inside the already-open chooser');
    max.dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.01');
    assert.equal(selection.textContent, 'PRESALE · 0.01 ETH');

    tickets.value = '0';
    tickets.dispatchEvent({ type: 'input' });
    assert.equal(title.textContent, 'CUSTOM LUCKBOXES',
      'removing the credit-earning draft removes Presale from the button');
    assert.equal(row.hidden, true);
    assert.equal(input.value, '0', 'a newly unavailable hidden box cannot remain in the quote');
    tickets.value = '1';
    tickets.dispatchEvent({ type: 'input' });
    assert.equal(row.hidden, false);
    max.dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent,
      'BUY IN');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, '0.05 ETH');

    let confirmed = null;
    el.addEventListener('app-decimator:tx-confirmed', (event) => { confirmed = event.detail; });
    el.querySelector('[data-bind="dec-custom-box-buy"]').dispatchEvent({ type: 'click' });
    await settle(100);

    assert.equal(fields.hidden, true, 'the combined chooser closes when its action submits');
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
    const toggle = el.querySelector('[data-bind="dec-custom-box-toggle"]');
    const fields = el.querySelector('[data-bind="dec-custom-box-fields"]');
    const group = el.querySelector('[data-bind="dec-lootbox-group"]');
    const title = el.querySelector('[data-bind="dec-box-options-title"]');
    const selection = el.querySelector('[data-bind="dec-custom-box-selection"]');
    const input = el.querySelector('[name="dec-presale-box-eth"]');
    assert.equal(toggle.hidden, false, 'the unified box trigger remains available');
    assert.equal(title.textContent, 'CUSTOM / PRESALE BOXES');
    assert.equal(selection.textContent, 'PRESALE AVAILABLE');
    assert.equal(row.hidden, false, 'banked credit exposes Presale inside the shared chooser');
    assert.equal(fields.hidden, true, 'the chooser does not auto-open');
    toggle.dispatchEvent({ type: 'click' });
    assert.equal(fields.hidden, false);
    assert.equal(el.querySelector('[name="dec-box-custom-count"]').value, '0');
    el.querySelector('[data-bind="dec-presale-max"]').dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.02');
    assert.equal(selection.textContent, 'PRESALE · 0.02 ETH');
    const flip = el.querySelector('[data-bind="dec-flip-check"]');
    flip.checked = true;
    flip.dispatchEvent({ type: 'change' });
    assert.equal(group.hidden, true, 'USE FLIP hides the ETH-only Luckbox builder');
    assert.equal(row.hidden, true);
    assert.equal(fields.hidden, true, 'entering FLIP closes the now-incompatible chooser');
    assert.equal(input.value, '0', 'entering FLIP cannot retain a hidden presale spend');
    flip.checked = false;
    flip.dispatchEvent({ type: 'change' });
    assert.equal(group.hidden, false, 'returning to ETH restores the Luckbox builder');
    assert.equal(title.textContent, 'CUSTOM / PRESALE BOXES');
    assert.equal(row.hidden, false, 'the available Presale option returns inside the chooser');
    assert.equal(fields.hidden, true, 'restoring eligibility does not auto-open the chooser');
    toggle.dispatchEvent({ type: 'click' });
    const tickets = el.querySelector('[name="dec-tickets"]');
    tickets.value = '0';
    tickets.dispatchEvent({ type: 'input' });
    el.querySelector('[data-bind="dec-presale-max"]').dispatchEvent({ type: 'click' });
    assert.equal(input.value, '0.02');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent,
      'BUY IN',
      'the compact CTA uses one stable selected-order label');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, '0.02 ETH');
    let confirmed = null;
    el.addEventListener('app-decimator:tx-confirmed', (event) => { confirmed = event.detail; });
    el.querySelector('[data-bind="dec-custom-box-buy"]').dispatchEvent({ type: 'click' });
    await settle(100);

    assert.equal(fields.hidden, true);
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

  test('Foil Pack keeps LIMIT 1 and prints its four-ticket identity on the wrapper', async () => {
    const el = instantiate();
    await settle(60);
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    assert.ok(check, 'foil checkbox rendered');
    assert.equal(check.disabled, false, 'enabled when not owned');
    const price = el.querySelector('[data-bind="dec-foil-price"]');
    assert.equal(price.textContent, '0.4 ETH', '10 × level-12 ticket price');
    const foil = el.querySelector('[data-bind="dec-foil-row"]');
    assert.equal(foil.querySelector('.dec-ticket-piece__copy'), null,
      'the foil wrapper has no redundant FOIL PACK overlay label');
    assert.match(PANEL_SRC, /<span class="dec-pack-count">4 FOILS<\/span>/);
    assert.match(el.innerHTML,
      /class="dec-ticket-piece dec-ticket-piece--foil"[\s\S]*?class="dec-foil-limit-stamp"><strong>LIMIT<\/strong><small>1<\/small>[\s\S]*?class="dec-pack-shine"[\s\S]*?class="dec-pack-mark dec-foil-pack-badge"><img src="\/whitepaper\/flame-logo\.svg"[\s\S]*?data-bind="dec-foil-level"[\s\S]*?4 FOILS[\s\S]*?class="dec-foil-selected-check">✓/,
      'foil art keeps its stamp, badge, level, and punchy four-foil identity');
    assert.equal((el.innerHTML.match(/class="dec-pack-shine"/g) || []).length, 1,
      'only the foil pack shines; the normal pack stays matte');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-ticket-piece__art > \.dec-foil-limit-stamp\s*\{[^}]*z-index:\s*13;[^}]*top:\s*0\.18rem;[^}]*left:\s*0\.14rem;[^}]*min-width:\s*2\.9rem;[^}]*background:\s*#26050a;[^}]*clip-path:\s*none;[^}]*opacity:\s*1;[^}]*transform:\s*rotate\(8deg\);/s,
      'LIMIT 1 retains its split red stamp and stays readable even against a cached legacy template');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-foil-pack-face \.dec-pack-mark:not\(\.dec-foil-pack-badge\)\s*\{[^}]*display:\s*none;/s,
      'foil suppresses only an unclassified legacy duplicate mark');
    assert.doesNotMatch(PURCHASE_DESK_CSS,
      /\.dec-foil-pack-face \.dec-foil-pack-badge\s*\{/s,
      'the foil badge inherits the normal pack badge panel without a special substitute treatment');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-foil-pack-face \.dec-pack-level\s*\{[^}]*grid-row:\s*2;[\s\S]*?\.dec-foil-pack-face \.dec-pack-count\s*\{[^}]*grid-row:\s*3;/s,
      'the level and four-ticket identity stay in their dedicated wrapper rows');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-ticket-piece__art > \.dec-foil-selected-check\s*\{[^}]*width:\s*1\.12rem;[^}]*height:\s*1\.12rem;[^}]*border-radius:\s*50%;/s,
      'the green check overrides the legacy generic art-child dimensions');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-ticket-piece--foil\.is-selected \.dec-ticket-piece__art > \.dec-foil-selected-check\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*scale\(1\)/s,
      'selection reveals the green circular check');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-ticket-piece--foil > quest-objective-indicator\s*\{[^}]*top:\s*-0\.52rem;[^}]*right:\s*-0\.52rem;[^}]*bottom:\s*auto;/s,
      'the quest bubble clears both top labels from just outside the pack corner');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-foil-pack-face \.dec-pack-count\s*\{[^}]*width:\s*calc\(100% \+ 0\.18rem\);[^}]*linear-gradient\(90deg, #56e0ff,[^}]*font-size:\s*0\.52rem;[^}]*letter-spacing:\s*0\.055em;[^}]*text-shadow:[^}]*white-space:\s*nowrap;/s,
      '4 FOILS is large, centered, and framed by a holographic treatment');
    assert.match(PURCHASE_DESK_CSS,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dec-foil-pack-face,[\s\S]*?\.dec-pack-shine,[\s\S]*?animation:\s*none/s,
      'foil motion respects reduced-motion preferences');
    el.disconnectedCallback();
  });

  test('selecting the foil pack jumps its wrapper into BUY IN and deselecting stays quiet', async () => {
    const el = instantiate();
    await settle(60);

    const panel = el.querySelector('.app-decimator-panel');
    const foil = el.querySelector('[data-bind="dec-foil-row"]');
    const check = el.querySelector('[data-bind="dec-foil-check"]');
    const buy = el.querySelector('[data-bind="dec-buy-cta"]');
    const artwork = makeFakeElement('span');
    artwork.classList.add('dec-ticket-piece__art');
    artwork.getBoundingClientRect = () => ({ left: 30, top: 40, width: 40, height: 40 });
    let cloneCount = 0;
    artwork.cloneNode = () => {
      cloneCount += 1;
      const clone = makeFakeElement('span');
      clone.classList.add('dec-ticket-piece__art');
      return clone;
    };
    foil.querySelector = (selector) => selector === '.dec-ticket-piece__art' ? artwork : null;
    panel.getBoundingClientRect = () => ({ left: 10, top: 20, width: 360, height: 360 });
    buy.getBoundingClientRect = () => ({ left: 210, top: 260, width: 100, height: 40 });

    check.checked = true;
    check.dispatchEvent({ type: 'change' });
    const flyer = panel.querySelector('.dec-purchase-flyer');
    assert.ok(flyer, 'selecting foil mounts a transient copy of its wrapper');
    assert.equal(flyer.classList.contains('dec-purchase-flyer--foil'), true);
    assert.equal(flyer.querySelector('.dec-purchase-flyer__quantity').textContent, '+FOIL');
    assert.equal(flyer.style.getPropertyValue('--dec-flight-x'), '210px',
      'the foil flight terminates at the center of BUY IN');

    flyer.dispatchEvent({ type: 'animationend', target: makeFakeElement('span') });
    assert.equal(panel.querySelector('.dec-purchase-flyer'), flyer,
      'an animated detail inside the wrapper cannot end the flight early');
    flyer.dispatchEvent({ type: 'animationend', target: flyer });
    assert.equal(panel.querySelector('.dec-purchase-flyer'), null);
    assert.equal(buy.classList.contains('is-receiving'), true,
      'BUY IN flashes when the foil wrapper lands');

    check.checked = false;
    check.dispatchEvent({ type: 'change' });
    assert.equal(cloneCount, 1, 'turning foil off does not play an add animation');
    assert.equal(panel.querySelector('.dec-purchase-flyer'), null);
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-purchase-flyer--foil \.dec-purchase-flyer__quantity\s*\{[\s\S]*?#56e0ff[\s\S]*?#ff89c8/,
      'the in-flight foil marker keeps the wrapper holographic palette');
    assert.match(PURCHASE_DESK_CSS,
      /\.dec-buy-cta\[data-write\]\.is-receiving\s*\{[^}]*dec-buy-foil-catch/,
      'BUY IN has a dedicated foil landing response');
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
    assert.equal(el.querySelector('[data-bind="dec-ticket-price"]').textContent,
      '1 TICKET - 0.08 ETH');
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
    assert.equal(el.querySelector('[data-bind="dec-ticket-price"]').textContent,
      '1 TICKET - 0.04 ETH');
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
    assert.equal(el.querySelector('[data-bind="dec-ticket-price"]').textContent,
      '1 TICKET - 0.01 ETH');
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
    assert.equal(el.querySelector('[data-bind="dec-ticket-price"]').textContent,
      '1 TICKET - 0.04 ETH');
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
    assert.equal(action.textContent, 'BUY IN');
    assert.equal(amount.textContent, '0.4 ETH', 'foil-only total is on the second line');
    check.checked = false;
    check.dispatchEvent({ type: 'change' });
    assert.equal(action.textContent, 'CLICK TO ADD', 'empty order returns to the prompt when unchecked');
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
    assert.equal(
      el.querySelector('[data-bind="dec-entry-price"]').textContent,
      '1 ENTRY - 250 FLIP',
      'FLIP mode shows the entry-sized burn on the first line',
    );
    assert.equal(
      el.querySelector('[data-bind="dec-ticket-price"]').textContent,
      '1 TICKET - 1,000 FLIP',
      'FLIP mode omits the level prefix so the fixed burn rate fits the header',
    );
    assert.equal(
      el.querySelector('[data-bind="dec-pack-price"]').textContent,
      '1 PACK - 10,000 FLIP',
      'the ten-ticket pack follows the same active FLIP quote',
    );
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
    assert.equal(
      el.querySelector('[data-bind="dec-entry-price"]').textContent,
      '1 ENTRY - 0.01 ETH',
      'switching back to ETH restores the entry quote',
    );
    assert.equal(
      el.querySelector('[data-bind="dec-ticket-price"]').textContent,
      '1 TICKET - 0.04 ETH',
      'switching back to ETH restores the compact ETH ticket quote',
    );
    assert.equal(
      el.querySelector('[data-bind="dec-pack-price"]').textContent,
      '1 PACK - 0.40 ETH',
      'switching back to ETH restores the ten-ticket pack quote',
    );
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
      /<span class="dec-flip-balance__action">[\s\S]*?data-bind="dec-funds-total-flip"[\s\S]*?<quest-objective-indicator class="dec-redeem-quest"[\s\S]*?data-quest-pointer="left"[\s\S]*?product="redeem-flip"><\/quest-objective-indicator>[\s\S]*?<\/span>/,
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
      /\.app-decimator-panel \.dec-funds__priority,[\s\S]*?\.app-decimator-panel \.dec-flip-toggle[\s\S]*?height:\s*1\.3rem;[\s\S]*?border-radius:\s*4px;[\s\S]*?font-size:\s*0\.52rem;/,
      'Available Funds actions share one compact size and type rhythm',
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
      valueWei: String(2_800n * FLIP),
      held: true,
    });

    const el = instantiate();
    await settle(60);
    const balance = el.querySelector('[data-bind="dec-flip-balance"]');
    const value = el.querySelector('[data-bind="dec-flip-balance-value"]');
    assert.match(el.innerHTML, /dec-flip-balance__label">FLIP BALANCE</);
    assert.equal(value.textContent, '2,800', 'the left copy mirrors the last settled Protocol Coins value');
    assert.equal(balance.getAttribute('data-balance-held'), 'true');

    storeMod.update('ui.protocolCoinsFlipDisclosure', {
      address: CONNECTED.toLowerCase(),
      valueWei: String(2_925n * FLIP),
      held: false,
    });
    assert.equal(value.textContent, '2,925',
      'the mirror adds full withdrawable backing, including 175 FLIP of auto-rebuy carry');
    assert.equal(balance.getAttribute('data-balance-held'), 'false');

    storeMod.update('ui.protocolCoinsFlipDisclosure', {
      address: CONNECTED.toLowerCase(),
      valueWei: String(2_925n * FLIP),
      held: true,
    });
    assert.equal(value.textContent, '2,925', 'a new RNG hold leaves the settled mirror readable');
    assert.equal(balance.getAttribute('data-balance-held'), 'true');
    assert.doesNotMatch(APP_CSS, /--main-balance-spoiler-blur|dec-flip-balance--spoiler/,
      'the old shared blur treatment is retired');

    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('ALL IN quotes FLIP while Protocol Coins stays on its settled value', async () => {
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
      valueWei: String(2_250n * 10n ** 18n),
      held: true,
    });
    await settle(10);
    assert.equal(
      el.querySelector('[data-bind="dec-flip-balance-value"]').textContent,
      '2,250',
      'the settled amount remains readable',
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
      el.querySelector('[data-bind="dec-flip-balance"]').getAttribute('data-balance-held'),
      'true',
      'quoting ALL IN does not release the held balance',
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
    const smallBoxes = el.querySelector('[name="dec-box-small"]');
    const customBoxes = el.querySelector('[name="dec-box-custom-count"]');
    const lootboxGroup = el.querySelector('[data-bind="dec-lootbox-group"]');
    const ticketBoon = el.querySelector('[data-bind="dec-ticket-boon"]');
    const mode = el.querySelector('[data-bind="dec-flip-check"]');
    const useClaimable = el.querySelector('[data-bind="dec-funds-use-claimable"]');
    const useWallet = el.querySelector('[data-bind="dec-funds-use-wallet"]');

    tickets.value = '0';
    smallBoxes.value = '2';
    customBoxes.value = '1';
    mode.checked = true;
    mode.dispatchEvent({ type: 'change' });
    assert.equal(tickets.value, '1', 'zero tickets seed to one when USE FLIP is selected');
    assert.equal(smallBoxes.value, '0', 'preset boxes are cleared in tickets-only FLIP mode');
    assert.equal(customBoxes.value, '0', 'custom boxes are cleared in tickets-only FLIP mode');
    assert.equal(lootboxGroup.hidden, true, 'the whole lootbox control is removed in FLIP mode');
    assert.equal(ticketBoon.hidden, true, 'the ETH purchase boon is removed in FLIP mode');
    assert.equal(ticketBoon.getAttribute('suppressed'), '',
      'boon refreshes cannot restore an inapplicable ticket-purchase marker');
    assert.equal(useClaimable.getAttribute('aria-pressed'), 'true',
      'the selected ETH priority is not rewritten by USE FLIP');
    assert.equal(useWallet.getAttribute('aria-pressed'), 'false');

    mode.checked = false;
    mode.dispatchEvent({ type: 'change' });
    assert.equal(lootboxGroup.hidden, false, 'lootboxes return when FLIP mode is left');
    assert.equal(ticketBoon.getAttribute('suppressed'), null,
      'the ticket boon can return when ETH purchasing is restored');
    assert.equal(ticketBoon.hidden, true,
      'leaving FLIP mode never un-hides the marker — the element decides that '
      + 'from app.boons, and this repaint runs on every poll cycle');
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
    assert.equal(el.querySelector('[name="dec-box-small"]').value, '0');
    assert.equal(el.querySelector('[name="dec-box-custom-count"]').value, '0');
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
    const customCount = el.querySelector('[name="dec-box-custom-count"]');
    const customSize = el.querySelector('[name="dec-box-custom-eth"]');
    const flip = el.querySelector('[data-bind="dec-flip-check"]');
    tickets.value = '2.25';
    customCount.value = '1';
    customSize.value = '0.08';
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
    assert.equal(customCount.value, '1', 'the normal custom-box quantity is preserved');
    assert.equal(customSize.value, '0.08', 'the normal custom-box size is preserved');
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

  test('zero FLIP tickets prompt the ticket shelf without opening a chooser or sending a tx', async () => {
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
    el.querySelector('[name="dec-tickets"]').dispatchEvent({ type: 'input' });
    el.querySelector('[data-bind="dec-buy-cta"]').dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(el.querySelector('[data-bind="dec-buy-dialog"]'), null,
      'the retired chooser is absent in FLIP mode too');
    assert.equal(el.querySelector('.dec-purchase-builders').classList.contains('is-prompting'), true);
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-action"]').textContent, 'Burn FLIP');
    assert.equal(el.querySelector('[data-bind="dec-buy-cta-amount"]').textContent, 'for tickets');
    const err = el.querySelector('[data-bind="dec-error"]');
    assert.equal(err.hidden, true, 'zeroes are a shelf prompt, not an error');
    assert.equal(fake._calls.filter((c) => c[0] !== 'static').length, 0, 'no tx sent');
    claimsMod.__resetContractFactoryForTest();
    el.disconnectedCallback();
  });

  test('the FLIP leg stays tickets-only without an extra helper sentence', () => {
    assert.match(PANEL_SRC, />\s*USE FLIP\s*</);
    assert.doesNotMatch(PANEL_SRC, />\s*REDEEM FLIP\s*</);
    assert.doesNotMatch(PANEL_SRC, /data-bind="dec-flip-buy"/);
    assert.doesNotMatch(PANEL_SRC, /Mint with FLIP/i);
    assert.match(PANEL_SRC, /input\.disabled = flipMode/);
    assert.match(PANEL_SRC, /if \(flipMode\) this\.#clearBoxDraft\(\)/);
    assert.match(PANEL_SRC, /lootboxGroup\.hidden = flipMode/);
    assert.match(
      APP_CSS,
      /\[data-bind="dec-lootbox-group"\]\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s,
    );
    assert.match(PANEL_SRC, /dec-foil--payment-disabled/);
    assert.doesNotMatch(PANEL_SRC, /FLIP mode buys tickets only/);
  });
});
