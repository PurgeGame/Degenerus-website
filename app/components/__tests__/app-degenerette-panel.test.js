// /app/components/__tests__/app-degenerette-panel.test.js — Phase 62 Plan 62-03 (BUY-05)
// Run: cd website && node --test app/components/__tests__/app-degenerette-panel.test.js
//
// Tests <app-degenerette-panel> Custom Element: two-stage state machine
// (idle → placing → awaitingRng → ready → resolving → resolved) + RNG poll
// reusing Phase 60 pollRngForLootbox + Place CTA + shared pending-tray
// resolution + supported currency picker + outcome rendered inline
// after the widget-owned one-click-per-spin reveal (no toast/audio).

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (verbatim port of app-pass-section.test.js).
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
        const valueMatch = /\bvalue="([^"]+)"/.exec(attrs);
        if (valueMatch) {
          child.attributes.value = valueMatch[1];
          child.value = valueMatch[1];
        }
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
  removeEventListener: (type, fn) => {
    const listeners = _docListeners.get(type) || [];
    const index = listeners.indexOf(fn);
    if (index >= 0) listeners.splice(index, 1);
  },
  dispatchEvent: (event) => {
    for (const fn of _docListeners.get(event?.type) || []) fn(event);
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
import * as degeneretteMod from '../../app/degenerette.js';
import * as lootboxMod from '../../app/lootbox.js';
import * as contractsMod from '../../app/contracts.js';
import * as pendingActionsMod from '../../app/pending-actions.js';
import * as affiliateMod from '../../app/affiliate.js';
import * as passesMod from '../../app/passes.js';
import { DEGENERETTE_PREFERENCES_KEY } from '../../app/degenerette-preferences.js';
import { CHAIN, ETH_DIVISOR } from '../../app/chain-config.js';

function installDeityOwners(owners = new Map()) {
  passesMod.__setDeityReadContractFactoryForTest(() => ({
    name: async () => 'Degenerus Deity Pass',
    ownerOf: async (symbolId) => {
      const owner = owners.get(Number(symbolId));
      if (owner) return owner;
      const error = new Error('InvalidToken');
      error.data = '0xc1ab6dc1';
      throw error;
    },
  }));
}
import {
  DGN_COLOR_HEX, DGN_TICKET_COPY_EVENT,
} from '../../app/dgn-traits.js';
import { dgnHouseTraits, dgnScore } from '../../app/dgn-reels.js';

// reveal-overlay.js subclasses HTMLElement at module scope, so it can only be
// imported AFTER the fakeDOM globals below are installed — hence lazily.
let revealMod = null;
async function loadReveal() {
  if (!revealMod) revealMod = await import('../reveal-overlay.js');
  return revealMod;
}

const PANEL_SRC = readFileSync(
  new URL('../app-degenerette-panel.js', import.meta.url),
  'utf8',
);
const APP_CSS = readFileSync(
  new URL('../../styles/app.css', import.meta.url),
  'utf8',
);
const FLIP_LOGO_SRC = readFileSync(
  new URL('../../../whitepaper/flame-logo-split.svg', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// Fake contract harness
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) { return { status: 1, hash: '0xreceipt', logs: logs || [] }; }
function makeFakeTx(receipt) { return { hash: '0xtx', wait: async () => receipt }; }

// Default fake contract: place returns BetPlaced(index=7, betId=42); resolve
// returns DegeneretteResolved(totalPayout=5e16) + DegeneretteResult.
function makeFakeDegContract(opts = {}) {
  const calls = { placeDegeneretteBet: [], resolveDegeneretteBets: [] };
  const stk = (name) => async () => {
    if (opts.staticCallShouldRevert?.[name]) {
      const err = new Error('static-call revert');
      err.revert = { name: opts.staticCallRevertName?.[name] || 'InvalidBet' };
      throw err;
    }
  };
  return {
    placeDegeneretteBet: Object.assign(
      async (...args) => {
        calls.placeDegeneretteBet.push(args);
        return makeFakeTx(makeFakeReceipt([
          {
            parsed: {
              name: 'BetPlaced',
              args: { player: args[0], index: 7n, betId: 42n, packed: 0n },
            },
          },
        ]));
      },
      { staticCall: stk('placeDegeneretteBet') }
    ),
    resolveDegeneretteBets: Object.assign(
      async (...args) => {
        calls.resolveDegeneretteBets.push(args);
        const defaultLogs = [
          {
            parsed: {
              name: 'DegeneretteResolved',
              args: {
                player: args[0],
                betId: 42n,
                spinCount: 1,
                totalPayout: 5n * 10n ** 16n,
                resultTraits: 1234n,
              },
            },
          },
          {
            parsed: {
              name: 'DegeneretteResult',
              args: {
                player: args[0],
                betId: 42n,
                spinIndex: 0,
                playerTraits: 1234n,
                matches: 4,
                payout: 5n * 10n ** 16n,
              },
            },
          },
        ];
        const logs = typeof opts.resolveLogs === 'function'
          ? opts.resolveLogs(args)
          : (Array.isArray(opts.resolveLogs) ? opts.resolveLogs : defaultLogs);
        return makeFakeTx(makeFakeReceipt(logs));
      },
      { staticCall: stk('resolveDegeneretteBets') }
    ),
    interface: { parseLog: (log) => log.parsed ?? null },
    connect(_signer) { return this; },
    _calls: calls,
  };
}

function makeFakeProvider(addr) {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => addr }),
  };
}

const CONNECTED = '0xab12000000000000000000000000000000000000';

function readyFeedItem(overrides = {}) {
  const spinCount = Number(overrides.spinCount ?? 1);
  const packed = 13n
    | (BigInt(spinCount) << 32n)
    | ((10n ** 10n) << 42n);
  return {
    player: CONNECTED.toLowerCase(),
    betIndex: 7,
    betId: '42',
    packedData: String(packed),
    rngReady: true,
    rngWord: '43981',
    results: [],
    resultTickets: [],
    ...overrides,
  };
}

function useDegeneretteFeed(itemOrFactory) {
  let calls = 0;
  _fetchHandler = async (url) => {
    const path = String(url);
    if (path.includes('/degenerette/feed')) {
      calls += 1;
      const item = typeof itemOrFactory === 'function'
        ? itemOrFactory(path, calls)
        : itemOrFactory;
      return { items: item ? [item] : [] };
    }
    return { player: null, pending: {} };
  };
  return () => calls;
}

function instantiate() {
  const Ctor = customElements.get('app-degenerette-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

async function runPendingDegeneretteAction() {
  const action = pendingActionsMod.getPendingActions()
    .find((item) => item.kind === 'degenerette' && typeof item.run === 'function');
  assert.ok(action, 'Degenerette action is available in the shared pending tray');
  await action.run();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan 62-03: <app-degenerette-panel> Custom Element', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    pendingActionsMod.__resetPendingActionsForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    installDeityOwners();
    degeneretteMod.__setContractFactoryForTest(() => makeFakeDegContract());
    // Default lootbox stub returns 0n (RNG not ready) — tests override per-case.
    lootboxMod.__setContractFactoryForTest(() => ({
      lootboxRngWordByIndex: async () => 0n,
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));
    await import('../app-degenerette-panel.js');
    const reveal = await loadReveal();
    reveal.__takeQueuedForTest();
  });

  test("Custom element 'app-degenerette-panel' registers idempotently", async () => {
    const ctor = customElements.get('app-degenerette-panel');
    assert.ok(ctor, 'app-degenerette-panel is registered');
    await assert.doesNotReject(import('../app-degenerette-panel.js'));
    const ctor2 = customElements.get('app-degenerette-panel');
    assert.equal(ctor, ctor2, 'same ctor reference after re-import');
  });

  test('amount entry parses decimal text exactly without Number rounding dust', async () => {
    const { parseDegeneretteAmountInput } = await import('../app-degenerette-panel.js');
    assert.equal(
      parseDegeneretteAmountInput('50000', 1),
      50_000n * 10n ** 18n,
      'a 50,000 FLIP wager is packed as exactly 50,000 FLIP',
    );
    assert.equal(
      parseDegeneretteAmountInput('0.01', 0),
      10_000_000_000n,
      'testnet ETH input is converted through the active 1M divisor',
    );
    assert.equal(
      parseDegeneretteAmountInput('.1', 0),
      parseDegeneretteAmountInput('0.1', 0),
      'a leading decimal is accepted exactly like the equivalent zero-prefixed wager',
    );
    assert.equal(
      parseDegeneretteAmountInput('.1', 1),
      parseDegeneretteAmountInput('0.1', 1),
      'leading-decimal token wagers use the same exact base-unit amount',
    );
    assert.equal(parseDegeneretteAmountInput('.', 0), null, 'an incomplete decimal remains invalid');
    assert.equal(parseDegeneretteAmountInput('1.0000000000000000001', 1), null);
  });

  test('Panel renders its bet controls without widget-level RNG or resolve buttons', () => {
    const el = instantiate();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    assert.match(el.innerHTML.toUpperCase(), /DEGENERETTE/, 'header contains DEGENERETTE');
    assert.doesNotMatch(el.innerHTML, /PLAYER VS HOUSE/i, 'redundant eyebrow removed');
    assert.doesNotMatch(el.innerHTML, /Build one ticket/i, 'header subtitle removed');
    assert.match(
      el.innerHTML,
      /<a class="deg-learn-link" href="\/learn\/degenerette\/">DEGENERETTE<\/a>/,
      'Degenerette heading links to its Learn page',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.deg-heading h2\s*\{[^}]*font-size:\s*1\.05rem;[^}]*font-weight:\s*950;/s,
      'Degenerette heading matches the bold Quests hierarchy',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.deg-learn-link:hover\s*\{[^}]*text-decoration:\s*none;/s,
      'the Degenerette heading does not draw an underline beneath the wordmark',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.deg-header\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;/s,
      'the inherited panel-header divider under Degenerette is removed',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.deg-header\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/s,
      'Degenerette uses equal side columns so its heading stays centered on phones',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.deg-heading\s*\{[^}]*grid-column:\s*2;[^}]*justify-self:\s*center;[^}]*text-align:\s*center;/s,
      'the Degenerette wordmark owns the true center column',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.deg-header__info\s*\{[^}]*position:\s*absolute;[^}]*left:\s*calc\(100% \+ 0\.42rem\);/s,
      'the info control sits beside the title without shifting the wordmark',
    );
    assert.match(
      APP_CSS,
      /\.play-grid \.qst-header,\s*body\.layout-basic \.play-grid \.deg-header,\s*body\.layout-basic \.play-grid \.app-parimutuel > \.panel-header\s*\{[^}]*min-height:\s*2\.55rem;[^}]*align-items:\s*center;/s,
      'Quests, Degenerette, and Side Bets share one vertical label rail',
    );
    const placeCta = el.querySelector('.deg-place-cta');
    assert.ok(placeCta, 'Place CTA rendered');
    assert.equal(el.querySelector('.deg-resolve-cta'), null,
      'RNG and resolve controls live only in the shared pending tray');
    assert.doesNotMatch(el.innerHTML, /data-bind="deg-actions"/);
  });

  test('ticket builder comes first and the readable wager uses logo currency choices', () => {
    const ticketAt = PANEL_SRC.indexOf('deg-block deg-block--ticket');
    const wagerAt = PANEL_SRC.indexOf('deg-block deg-block--wager');
    assert.ok(ticketAt >= 0 && wagerAt > ticketAt,
      'ticket builder precedes wager in visual and keyboard order');
    assert.doesNotMatch(PANEL_SRC, /deg-block__step/, 'numbered setup labels are removed');
    assert.match(PANEL_SRC, /aria-label="Wager currency"/);
    assert.match(PANEL_SRC, /deg-currency-picker__label">Currency<\/span>/);
    assert.match(PANEL_SRC, /aria-label="Bet per spin"/);
    assert.match(PANEL_SRC, /aria-label="Number of spins"/);
    assert.match(PANEL_SRC, /\/badges-circular\/crypto_06_ethereum_green\.svg/,
      'ETH uses the green circular Degenerus trait badge');
    assert.doesNotMatch(PANEL_SRC, /\/badges-circular\/crypto_06_ethereum_blue\.svg/,
      'the blue ETH currency badge is no longer used');
    assert.match(PANEL_SRC, /data-bind="deg-currency-option-1"[\s\S]*?\/whitepaper\/flame-logo-split\.svg/,
      'the FLIP wager lane uses the split red/green coin mark');
    assert.match(FLIP_LOGO_SRC, /fill="#30d100"/,
      'the FLIP mark uses the exact green ETH ring color');
    assert.match(FLIP_LOGO_SRC, /fill="#ed0e11"/,
      'the FLIP mark uses the exact red WWXRP ring color');
    assert.match(PANEL_SRC, /\/shared\/coinflip-face-red\.svg/);
    assert.match(
      APP_CSS,
      /\.deg-currency-option boon-product-indicator\s*\{[^}]*animation:\s*none;[^}]*box-shadow:\s*none;[^}]*filter:\s*none;/s,
      'the applied Degenerette boon keeps only the arrow-shaped glow, not a square host glow',
    );
    assert.match(
      APP_CSS,
      /\.deg-currency-option boon-product-indicator::after\s*\{[^}]*display:\s*none;/s,
      'the Degenerette boon arrow does not repeat the currency badge already shown by its option',
    );
    assert.doesNotMatch(
      APP_CSS,
      /:is\([^)]*\.deg-currency-option[^)]*\)\.has-active-boon/s,
      'an active Degenerette arrow does not add a second square outline around the currency tile',
    );
    const placeAt = PANEL_SRC.indexOf('class="deg-place-cta"', wagerAt);
    const wagerEnd = PANEL_SRC.indexOf('</section>', wagerAt);
    assert.ok(placeAt > wagerAt && placeAt < wagerEnd,
      'Place bet is owned by and sits below the wager controls');
    assert.match(PANEL_SRC, /deg-wager-field__label">Bet per spin/);
    assert.match(PANEL_SRC, /deg-wager-field__label">Spins/);
    assert.match(
      APP_CSS,
      /\.deg-wager-field__label\s*\{[^}]*text-align:\s*center/s,
      'Currency, Bet per spin, and Spins share centered label typography',
    );
    assert.match(
      APP_CSS,
      /\.deg-wager-column\s*\{[^}]*grid-template-rows:\s*auto minmax\(8\.75rem, 1fr\)/s,
      'the wager card closes around its controls and gives the recovered height to referrals',
    );
    assert.match(
      APP_CSS,
      /\.deg-referral-card__copy > strong > span\s*\{[^}]*font-size:\s*clamp\(1rem, 1\.35vw, 1\.18rem\)/s,
      'referral copy uses the larger display size',
    );
    assert.doesNotMatch(PANEL_SRC, /deg-min-hint/,
      'the secondary minimum-bet line is removed');
    assert.match(PANEL_SRC, /data-bind="deg-amount-up"/);
    assert.match(PANEL_SRC, /data-bind="deg-amount-down"/);
    assert.match(PANEL_SRC, /data-bind="deg-spins-up"/);
    assert.match(PANEL_SRC, /data-bind="deg-spins-down"/);
    assert.doesNotMatch(PANEL_SRC, /[▲▼]/,
      'cramped stacked arrow glyphs are replaced by conventional steppers');
    assert.match(
      APP_CSS,
      /\.deg-amount-shell\s*\{[^}]*grid-template-columns:\s*1\.35rem minmax\(0, 1fr\) 1\.35rem/s,
      'bet per spin uses compact full-height minus/value/plus columns',
    );
    assert.match(
      APP_CSS,
      /\.deg-spin-shell\s*\{[^}]*grid-template-columns:\s*1\.25rem minmax\(2\.1rem, 1fr\) 1\.25rem/s,
      'the spin number keeps enough width for two digits',
    );
    assert.doesNotMatch(PANEL_SRC, /className = 'dgn-editor-label'/,
      'color and symbol captions are removed from the compact picker');
    assert.match(
      APP_CSS,
      /\.deg-block \.dgn-symbols\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s,
      'eight symbol choices render as two rows of four',
    );
    assert.match(
      APP_CSS,
      /\.deg-block \.dgn-symbol-btn\s*\{[^}]*aspect-ratio:\s*1/s,
      'symbol buttons grow to fill their grid cells',
    );
    assert.match(
      APP_CSS,
      /\.deg-currency-picker\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s,
      'three currency controls fill the wager width',
    );
    assert.match(
      APP_CSS,
      /\.deg-currency-option img\s*\{[^}]*width:\s*min\(90%, 3\.75rem\)/s,
      'the circular currency art fills each enlarged control',
    );
    assert.match(
      PANEL_SRC,
      /img\.src\s*=\s*dgnSymbolPath\(q, s, t\.c\)/,
      'symbol choices use the standalone trait marks instead of circular ticket badges',
    );
    assert.match(
      APP_CSS,
      /\.deg-block \.dgn-symbol-btn\s*\{[^}]*border-radius:\s*7px[^}]*background:\s*linear-gradient/s,
      'symbol choices share one softly squared neutral tile',
    );
    assert.match(
      APP_CSS,
      /\.deg-block \.dgn-symbol-btn img\s*\{[^}]*width:\s*82%[^}]*height:\s*82%/s,
      'standalone marks fill their cells without the old circular-badge crop',
    );
    assert.match(PANEL_SRC, /q === 0 && \(s === 3 \|\| s === 7\)/,
      'Monero and Bitcoin receive the round-art sizing treatment');
    assert.match(
      APP_CSS,
      /\.deg-block \.dgn-symbol-btn--round img\s*\{[^}]*width:\s*92%[^}]*height:\s*92%/s,
      'round crypto discs remain large after exposing their complete SVG viewBox',
    );
    assert.match(
      APP_CSS,
      /\.deg-block \.dgn-symbol-btn\.is-selected\s*\{[^}]*outline:\s*2px solid #facc15[^}]*background:\s*linear-gradient[^}]*box-shadow:/s,
      'the selected symbol has an unmistakable gold outline, fill, and glow',
    );
    assert.match(
      APP_CSS,
      /\.deg-block \.dgn-ticket-wrap\s*\{[^}]*flex:\s*0 0 auto[^}]*aspect-ratio:\s*1/s,
      'opening the trait panel cannot flex-shrink the ticket',
    );
    assert.match(
      APP_CSS,
      /@media \(min-width:\s*1100px\)[\s\S]*?\.deg-block \.dgn-ticket-wrap\s*\{[^}]*width:\s*min\(232px, 100%\)/s,
      'the wide picker spends recovered padding on a larger ticket',
    );
    assert.match(
      APP_CSS,
      /\.deg-block \.dgn-colors\s*\{[^}]*grid-template-columns:\s*repeat\(8, 1\.05rem\) 1\.3rem/s,
      'the Hero star shares the compact color row instead of consuming its own line',
    );
    assert.doesNotMatch(PANEL_SRC, /dgn-editor-head/,
      'the standalone labeled Hero row is removed');
    assert.match(
      APP_CSS,
      /\.deg-block \.dgn-color-btn\s*\{[^}]*width:\s*1\.05rem[^}]*height:\s*1\.05rem/s,
      'color dots stay compact',
    );
    assert.match(
      APP_CSS,
      /\.deg-block--wager \.deg-place-cta\s*\{[^}]*font-size:\s*0\.74rem/s,
      'the amount-bearing Place Bet label stays comfortably readable',
    );
    assert.deepEqual(DGN_COLOR_HEX, {
      pink: '#f409cd', purple: '#7c2bff', green: '#30d100', red: '#ed0e11',
      blue: '#1317f7', orange: '#f7931a', silver: '#5e5e5e', gold: '#ab8d3f',
    }, 'picker dots use the SVG badges\' exact ring colors');
    assert.match(
      APP_CSS,
      /\.dgn-inline-spin \.dgn-rq\.q-sym,[\s\S]*?\.dgn-inline-spin \.dgn-rq\.q-col\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px rgba\(126, 176, 255, 0\.78\)/s,
      'one-trait match cells use a blue inset edge instead of the old warm outline',
    );
  });

  test('clicking an inventory ticket copies all four traits and makes its first gold trait Hero', () => {
    const el = instantiate();
    document.dispatchEvent(new CustomEvent(DGN_TICKET_COPY_EVENT, {
      detail: { traitIds: [56, 65, 130, 195], level: 17 },
    }));

    assert.equal(el.querySelector('[data-bind="dgn-img-0"]').src,
      '/badges-circular/crypto_00_xrp_gold.svg');
    assert.equal(el.querySelector('[data-bind="dgn-img-1"]').src,
      '/badges-circular/zodiac_01_taurus_pink.svg');
    const hero = el.querySelector('[data-bind="dgn-cell-0"]');
    assert.ok(hero.classList.contains('q-hero'));
    assert.equal(hero.getAttribute('data-trait-color'), 'gold');
    assert.equal(hero.style['--dgn-trait-color'], '#ab8d3f',
      'Hero spikes inherit the exact color of their badge');
    assert.equal(el.querySelector('[data-bind="dgn-editor"]').hidden, true,
      'copying an inventory ticket keeps the manual trait picker closed');
    assert.equal(el.querySelector('[data-bind="deg-state"]').textContent, 'Ticket copied');
    el.disconnectedCallback();
  });

  test('logo currency buttons synchronize the wager limits and total shown on Place Bet', () => {
    const el = instantiate();
    el.querySelector('[data-bind="deg-currency-option-1"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[name="deg-currency"]').value, '1');
    assert.equal(el.querySelector('[data-bind="deg-amount-unit"]'), null,
      'the currency is not repeated inside the amount input');
    assert.equal(el.querySelector('[name="deg-amount"]').getAttribute('min'), '100');
    assert.equal(el.querySelector('[name="deg-amount"]').value, '250',
      'switching to FLIP uses its default wager');
    assert.equal(el.querySelector('[data-bind="deg-currency-option-1"]').getAttribute('aria-pressed'), 'true');
    const amount = el.querySelector('[name="deg-amount"]');
    const spins = el.querySelector('[name="deg-ticket-count"]');
    amount.value = '125';
    amount.dispatchEvent({ type: 'input' });
    spins.value = '3';
    spins.dispatchEvent({ type: 'change' });
    assert.equal(el.querySelector('[data-bind="deg-place-cta"]').textContent,
      'Place Bet · 375 FLIP');
    el.disconnectedCallback();
  });

  test('Place Bet names the concrete boosted wager from its active currency boon', () => {
    storeMod.update('app.boons', {
      address: CONNECTED.toLowerCase(),
      day: 62,
      exact: true,
      boons: [{ boonType: 34, consumed: false }],
    });
    const el = instantiate();
    const amount = el.querySelector('[name="deg-amount"]');
    const spins = el.querySelector('[name="deg-ticket-count"]');
    amount.value = '1';
    amount.dispatchEvent({ type: 'input' });
    spins.value = '2';
    spins.dispatchEvent({ type: 'change' });
    const place = el.querySelector('[data-bind="deg-place-cta"]');
    assert.equal(place.textContent, 'Place Bet · 2 ETH');
    assert.equal(place.getAttribute('data-boon-effect'), '+0.24 ETH BOON');
    assert.match(place.getAttribute('aria-label'), /plus 0\.24 ETH from your boon/);
    el.disconnectedCallback();
  });

  test('Place Bet mirrors Degenerette boon caps and explains their scope', async () => {
    const payload = {
      address: CONNECTED.toLowerCase(),
      day: 62,
      exact: true,
      boons: [
        { boonType: 34, consumed: false },
        { boonType: 37, consumed: false },
        { boonType: 40, consumed: false },
      ],
    };
    storeMod.update('app.boons', payload);
    const el = instantiate();
    const amount = el.querySelector('[name="deg-amount"]');
    const spins = el.querySelector('[name="deg-ticket-count"]');
    const place = el.querySelector('[data-bind="deg-place-cta"]');

    amount.value = '1';
    amount.dispatchEvent({ type: 'input' });
    spins.value = '25';
    spins.dispatchEvent({ type: 'change' });
    assert.equal(place.textContent, 'Place Bet · 25 ETH');
    assert.equal(place.getAttribute('data-boon-effect'), '+1.2 ETH BOON',
      'only the first 10 ETH receives the 12% boost');

    el.querySelector('[data-bind="deg-currency-option-1"]').dispatchEvent({ type: 'click' });
    amount.value = '10000';
    amount.dispatchEvent({ type: 'input' });
    spins.value = '15';
    spins.dispatchEvent({ type: 'change' });
    assert.equal(place.textContent, 'Place Bet · 150,000 FLIP');
    assert.equal(place.getAttribute('data-boon-effect'), '+12000 FLIP BOON',
      'only the first 100,000 FLIP receives the 12% boost');

    el.querySelector('[data-bind="deg-currency-option-3"]').dispatchEvent({ type: 'click' });
    amount.value = '30000';
    amount.dispatchEvent({ type: 'input' });
    spins.value = '5';
    spins.dispatchEvent({ type: 'change' });
    assert.equal(place.textContent, 'Place Bet · 150,000 WWXRP');
    assert.equal(place.getAttribute('data-boon-effect'), '+18000 WWXRP BOON',
      'WWXRP keeps the uncapped 12% boost');

    const { boonIndicatorModel } = await import('../../app/boons.js');
    assert.match(boonIndicatorModel(payload, 'degenerette-eth').title,
      /up to 10 ETH.*bet, split across its spins/i);
    assert.match(boonIndicatorModel(payload, 'degenerette-flip').title,
      /up to 100,000 FLIP.*bet, split across its spins/i);
    assert.match(boonIndicatorModel(payload, 'degenerette-wwxrp').title, /uncapped/i);
    el.disconnectedCallback();
  });

  test('browser preferences restore an independent bet size for each currency', () => {
    let el = instantiate();
    const amount = el.querySelector('[name="deg-amount"]');
    amount.value = '0.025';
    amount.dispatchEvent({ type: 'input' });

    el.querySelector('[data-bind="deg-currency-option-1"]').dispatchEvent({ type: 'click' });
    assert.equal(amount.value, '250', 'a currency with no preference keeps its safe default');
    amount.value = '625';
    amount.dispatchEvent({ type: 'input' });

    el.querySelector('[data-bind="deg-currency-option-3"]').dispatchEvent({ type: 'click' });
    amount.value = '3';
    amount.dispatchEvent({ type: 'input' });

    el.querySelector('[data-bind="deg-currency-option-0"]').dispatchEvent({ type: 'click' });
    assert.equal(amount.value, '0.025', 'ETH restores its own previous bet size');
    el.querySelector('[data-bind="deg-currency-option-1"]').dispatchEvent({ type: 'click' });
    assert.equal(amount.value, '625', 'FLIP restores its own previous bet size');

    const saved = JSON.parse(localStorage.getItem(DEGENERETTE_PREFERENCES_KEY));
    assert.deepEqual(saved.bets, { 0: '0.025', 1: '625', 3: '3' });
    el.disconnectedCallback();

    el = instantiate();
    assert.equal(el.querySelector('[name="deg-amount"]').value, '0.025',
      'the ETH preference survives a fresh widget mount');
    el.querySelector('[data-bind="deg-currency-option-3"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[name="deg-amount"]').value, '3',
      'the WWXRP preference survives a fresh widget mount');
    el.disconnectedCallback();
  });

  test('wager steppers start at five spins and update the Place Bet total', () => {
    const el = instantiate();
    const amount = el.querySelector('[name="deg-amount"]');
    const spins = el.querySelector('[name="deg-ticket-count"]');
    assert.equal(spins.value, '5');
    assert.equal(spins.children.find((option) => option.value === '5')?.textContent, '5',
      'the select repeats no "spins" text inside the field');
    assert.equal(el.querySelector('[data-bind="deg-place-cta"]').textContent,
      'Place Bet · 0.05 ETH');

    el.querySelector('[data-bind="deg-spins-up"]').dispatchEvent({ type: 'click' });
    assert.equal(spins.value, '6');
    assert.equal(el.querySelector('[data-bind="deg-place-cta"]').textContent,
      'Place Bet · 0.06 ETH');

    el.querySelector('[data-bind="deg-amount-up"]').dispatchEvent({ type: 'click' });
    assert.equal(amount.value, '0.015');
    assert.equal(el.querySelector('[data-bind="deg-place-cta"]').textContent,
      'Place Bet · 0.09 ETH');
    el.disconnectedCallback();
  });

  test('ETH wager controls glow when amount per spin times spins reaches the live bounty', () => {
    storeMod.update('app.records', {
      records: [{ kind: 1, held: false, value: 0n, barToBeat: 0n }],
    });
    const el = instantiate();
    const amount = el.querySelector('[name="deg-amount"]');
    const spins = el.querySelector('[name="deg-ticket-count"]');

    amount.value = '0.199';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(amount.classList.contains('is-bounty-trigger'), false);

    amount.value = '0.2';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(amount.classList.contains('is-bounty-trigger'), true);
    assert.equal(spins.classList.contains('is-bounty-trigger'), true,
      'spin count glows too because the contract judges the total ETH wager');

    el.querySelector('[data-bind="deg-currency-option-1"]').dispatchEvent({ type: 'click' });
    amount.value = '999999';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(amount.classList.contains('is-bounty-trigger'), false,
      'FLIP Degenerette bets never arm the ETH-only record');
    el.disconnectedCallback();
  });

  test('Degenerette quest clicks preset safely and confirmed actions place the exact bet', async () => {
    const fake = makeFakeDegContract();
    degeneretteMod.__setContractFactoryForTest(() => fake);
    const el = instantiate();

    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: { questType: 7, target: '80000000000', variant: 'secondary' },
    }));
    assert.equal(el.querySelector('[name="deg-currency"]').value, '0');
    assert.equal(el.querySelector('[name="deg-ticket-count"]').value, '5');
    assert.equal(el.querySelector('[name="deg-amount"]').value, '0.016');
    assert.equal(el.querySelector('[data-bind="deg-place-cta"]').textContent,
      'Place Bet · 0.08 ETH');

    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: { questType: 8, target: String(2_000n * 10n ** 18n), variant: 'secondary' },
    }));
    assert.equal(el.querySelector('[name="deg-currency"]').value, '1');
    assert.equal(el.querySelector('[name="deg-ticket-count"]').value, '5');
    assert.equal(el.querySelector('[name="deg-amount"]').value, '400');
    assert.equal(el.querySelector('[data-bind="deg-place-cta"]').textContent,
      'Place Bet · 2,000 FLIP');

    // At the lowest ETH target, five spins would fall below the 0.005 minimum;
    // the preset chooses four valid spins while keeping the quest total exact.
    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: { questType: 7, target: '20000000000', variant: 'secondary' },
    }));
    assert.equal(el.querySelector('[name="deg-ticket-count"]').value, '4');
    assert.equal(el.querySelector('[name="deg-amount"]').value, '0.005');
    assert.equal(el.querySelector('[data-bind="deg-place-cta"]').textContent,
      'Place Bet · 0.02 ETH');

    assert.equal(fake._calls.placeDegeneretteBet.length, 0,
      'bare quest activations only configure the wager');
    const normalDraft = {
      currency: el.querySelector('[name="deg-currency"]').value,
      spins: el.querySelector('[name="deg-ticket-count"]').value,
      amount: el.querySelector('[name="deg-amount"]').value,
      ticket: el.getTicketDraft(),
    };
    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: {
        questType: 8,
        target: String(2_000n * 10n ** 18n),
        amountPerSpin: String(400n * 10n ** 18n),
        spinCount: 5,
        traitIds: [56, 65, 130, 195],
        heroQuadrant: 2,
        variant: 'secondary',
        submit: true,
      },
    }));
    await settle(60);
    assert.equal(fake._calls.placeDegeneretteBet.length, 1,
      'the explicit popup confirmation reaches the existing placement path');
    assert.equal(fake._calls.placeDegeneretteBet[0][1], 1, 'the FLIP quest selects the FLIP lane');
    assert.equal(fake._calls.placeDegeneretteBet[0][2], 400n * 10n ** 18n,
      'five spins divide the exact 2,000 FLIP minimum evenly');
    assert.equal(fake._calls.placeDegeneretteBet[0][3], 5, 'the preset retains five spins');
    assert.equal(
      Number(fake._calls.placeDegeneretteBet[0][4]),
      56 | (1 << 8) | (2 << 16) | (3 << 24),
      'the popup ticket is the ticket submitted to the contract',
    );
    assert.equal(fake._calls.placeDegeneretteBet[0][5], 2,
      'the popup Hero quadrant is preserved through submission');
    assert.deepEqual({
      currency: el.querySelector('[name="deg-currency"]').value,
      spins: el.querySelector('[name="deg-ticket-count"]').value,
      amount: el.querySelector('[name="deg-amount"]').value,
      ticket: el.getTicketDraft(),
    }, normalDraft, 'the quest bet leaves every ordinary Degenerette setting untouched');
    el.disconnectedCallback();
  });

  test('Place remains write-marked while widget-level resolution controls stay absent', () => {
    const el = instantiate();
    const place = el.querySelector('.deg-place-cta');
    assert.ok(place && place.attributes['data-write'] !== undefined, 'Place has data-write');
    assert.equal(el.querySelector('.deg-resolve-cta'), null);
  });

  test('Place click invokes placeBet then enters awaitingRng state', async () => {
    let recordedArgs = null;
    const fullWagerWei = (10n ** 16n) / BigInt(ETH_DIVISOR);
    const spendableClaimableWei = fullWagerWei / 2n;
    const iface = new contractsMod.ethers.Interface([
      'event BetPlaced(address indexed player, uint32 indexed index, uint64 indexed betId, uint256 packed)',
    ]);
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async (...args) => {
          recordedArgs = args;
          const { data, topics } = iface.encodeEventLog(
            iface.getEvent('BetPlaced'), [args[0], 7n, 42n, 0n],
          );
          return makeFakeTx(makeFakeReceipt([
            { data, topics, address: '0x0000000000000000000000000000000000000001' },
          ]));
        },
        { staticCall: async () => undefined },
      ),
      claimableWinningsOf: async () => spendableClaimableWei + 1n,
      resolveDegeneretteBets: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => { throw new Error('RNG not ready'); } },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();

    // Set inputs.
    const currencySel = el.querySelector('[name="deg-currency"]');
    if (currencySel) currencySel.value = '0';  // ETH
    const amountInput = el.querySelector('[name="deg-amount"]');
    if (amountInput) amountInput.value = '0.01';  // 0.01 ETH
    const ticketSel = el.querySelector('[name="deg-ticket-count"]');
    if (ticketSel) ticketSel.value = '1';

    const placeBtn = el.querySelector('.deg-place-cta');
    placeBtn.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.ok(recordedArgs, 'placeDegeneretteBet invoked');
    assert.equal(recordedArgs[6].value, fullWagerWei - spendableClaimableWei,
      'the default checked preference spends claimable first and sends only the wallet remainder');
    // State transitions to awaitingRng, but the bottom tray is its only visible surface.
    const stateEl = el.querySelector('.deg-state');
    assert.ok(stateEl, 'state display element rendered');
    assert.equal(stateEl.textContent, '', 'main card does not duplicate the RNG wait bubble');
    const [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.id, 'degenerette:42');
    assert.equal(pending.state, 'waiting');
    assert.equal(pending.run, null, 'an RNG wait cannot resolve early');
    assert.equal(placeBtn.disabled, false,
      'waiting on one RNG does not block placing an additional bet');
    assert.equal(el.querySelector('.deg-error').hidden, true,
      'a genuine topics+data receipt does not fall into manual resolve');

    el.disconnectedCallback();
  });

  test('reload recovers a DB-pending bet stranded by an older receipt parser', async () => {
    const amountPerSpin = 250n * 10n ** 18n;
    const packed = 13n
      | (5n << 32n)
      | (1n << 40n)
      | (amountPerSpin << 42n)
      | (2n << 218n);
    const reads = [];
    degeneretteMod.__setContractFactoryForTest(() => ({
      degeneretteBetInfo: async (...args) => {
        reads.push(args);
        return packed;
      },
      connect(_signer) { return this; },
    }));
    _fetchHandler = async (url) => {
      const path = String(url);
      if (path.includes('/tickets/by-trait')) return { cards: [] };
      if (path.includes('/degenerette/feed')) {
        return {
          items: [{
            player: CONNECTED,
            betIndex: 7,
            betId: '42',
            packedData: String(packed),
            results: [],
          }],
        };
      }
      if (path.includes(`/player/${CONNECTED.toLowerCase()}`)) {
        return {
          degenerette: {
            pendingBets: [{ betIndex: 7, betId: '42' }],
          },
        };
      }
      return {};
    };

    const el = instantiate();
    await settle(80);

    assert.ok(reads.length >= 1, 'the DB identifier is verified against the pending on-chain slot');
    assert.ok(reads.every(([owner, betId]) => (
      owner === CONNECTED.toLowerCase() && betId === 42n
    )), 'every recovery poll verifies the same player and bet identifier');
    const [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.id, 'degenerette:42');
    assert.equal(pending.label, '5 spins');
    assert.equal(pending.ticketPacked, '13', 'the exact submitted ticket feeds the pending-card art');
    assert.equal(pending.heroQuadrant, 2);
    assert.equal(pending.state, 'waiting');
    assert.equal(el.querySelector('.deg-state').textContent, '',
      'the bottom pending row is the sole RNG-wait surface');
    const stored = JSON.parse(localStorage.getItem(
      `pending-degenerette:${CHAIN.id}:${CHAIN.deployBlock}:${CONNECTED.toLowerCase()}`,
    ));
    assert.deepEqual(stored, {
      betId: '42',
      index: '7',
      currency: 1,
      amountPerSpin: String(amountPerSpin),
      spinCount: 5,
      hero: 2,
      ticket: '13',
      packedData: String(packed),
    }, 'the recovered bet is durable across another refresh');
    assert.doesNotMatch(PANEL_SRC, /manual resolve required/i);

    el.disconnectedCallback();
  });

  test('old-deployment local and indexed bets cannot reappear as current pending work', async () => {
    const legacyKey = `pending-degenerette:${CHAIN.id}:${CONNECTED.toLowerCase()}`;
    localStorage.setItem(legacyKey, JSON.stringify({
      betId: '42',
      index: '7',
      currency: 1,
      amountPerSpin: String(250n * 10n ** 18n),
      spinCount: 5,
      hero: 2,
      ticket: '13',
    }));
    const stalePacked = 13n
      | (5n << 32n)
      | (1n << 40n)
      | ((250n * 10n ** 18n) << 42n)
      | (2n << 218n);
    degeneretteMod.__setContractFactoryForTest(() => ({
      degeneretteBetInfo: async () => { throw new Error('RPC temporarily unavailable'); },
      connect(_signer) { return this; },
    }));
    _fetchHandler = async (url) => {
      const path = String(url);
      if (path.includes('/degenerette/feed')) {
        return {
          items: [{
            player: CONNECTED,
            betIndex: 7,
            betId: '42',
            packedData: String(stalePacked),
            results: [],
          }],
        };
      }
      if (path.includes(`/player/${CONNECTED.toLowerCase()}`)) {
        return { degenerette: { pendingBets: [{ betIndex: 7, betId: '42' }] } };
      }
      return {};
    };

    const { pendingDegeneretteKey } = await import('../app-degenerette-panel.js');
    assert.equal(
      pendingDegeneretteKey(CONNECTED),
      `pending-degenerette:${CHAIN.id}:${CHAIN.deployBlock}:${CONNECTED.toLowerCase()}`,
      'current pending state is namespaced to this exact deployment',
    );
    const el = instantiate();
    await settle(80);

    assert.equal(localStorage.getItem(legacyKey), null,
      'the ambiguous chain-only reminder is retired on restore');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'stale DB packedData cannot substitute for a current GAME slot');
    el.disconnectedCallback();
  });

  test('RNG poll reads DB readiness; state transitions to ready when its word is indexed', async () => {
    const feedCalls = useDegeneretteFeed(readyFeedItem());

    const el = instantiate();
    await flushMicrotasks();

    const amountInput = el.querySelector('[name="deg-amount"]');
    if (amountInput) amountInput.value = '0.01';
    const ticketSel = el.querySelector('[name="deg-ticket-count"]');
    if (ticketSel) ticketSel.value = '1';

    const placeBtn = el.querySelector('.deg-place-cta');
    placeBtn.dispatchEvent({ type: 'click' });
    await settle(80);

    // After place + first poll cycle, RNG ready → state transitions to ready.
    assert.ok(feedCalls() >= 1, `Degenerette feed read at least once (got ${feedCalls()})`);
    assert.equal(el.querySelector('.deg-resolve-cta'), null,
      'readiness does not add a resolve button back into the widget');
    const [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.state, 'ready');
    assert.equal(typeof pending.run, 'function',
      'the shared widget delegates to the panel resolve path');

    el.disconnectedCallback();
  });

  test('a zero chain slot without RNG or resolution evidence stays in the RNG wait', async () => {
    const contract = makeFakeDegContract();
    contract.degeneretteBetInfo = async () => 0n;
    degeneretteMod.__setContractFactoryForTest(() => contract);
    useDegeneretteFeed(null);

    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="deg-amount"]').value = '0.01';
    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await settle(80);

    const [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending?.state, 'waiting');
    assert.equal(pending?.phase, 'awaitingRng');
    assert.equal(pending?.pinned, true,
      'the bottom panel cannot drop a bet while its RNG state catches up');
    assert.equal(pending?.shortLabel, 'Resolve degen');
    assert.equal(pending?.detail, 'Waiting for Chainlink RNG');
    assert.equal(el.querySelector('.deg-state').textContent, '',
      'the main widget does not duplicate the pinned RNG wait');
    assert.doesNotMatch(pending?.detail, /verified spin/i,
      'the UI does not claim result indexing before an RNG word exists');
    el.disconnectedCallback();
  });

  test('a confirmed mid-day RNG request stays pinned through refresh and becomes result-ready', async () => {
    const storageKey = `pending-degenerette:${CHAIN.id}:${CHAIN.deployBlock}:${CONNECTED.toLowerCase()}`;
    localStorage.setItem(storageKey, JSON.stringify({
      betId: '42', index: '7', currency: 1, amountPerSpin: String(250n * 10n ** 18n),
      spinCount: 1, hero: 2,
    }));

    let requestSubmitted = false;
    let requestWrites = 0;
    let postReceiptRequestabilityReads = 0;
    const queuePacked = 7n | (420n << 48n) | (1_000n << 112n);
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => 119,
      getStorage: async (_address, slot) => slot === 33n ? queuePacked : 0n,
    });
    degeneretteMod.__setContractFactoryForTest(() => ({
      degeneretteBetInfo: async () => 13n,
      resolveDegeneretteBets: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => { throw new Error('RNG not ready'); } },
      ),
      interface: { parseLog: () => null },
      connect() { return this; },
    }));
    lootboxMod.__setContractFactoryForTest(() => ({
      requestLootboxRng: Object.assign(
        async () => {
          requestSubmitted = true;
          requestWrites += 1;
          return makeFakeTx({ ...makeFakeReceipt(), blockNumber: 120 });
        },
        {
          staticCall: async () => {
            if (requestSubmitted) {
              postReceiptRequestabilityReads += 1;
              if (postReceiptRequestabilityReads > 1) throw new Error('RNG in flight');
            }
          },
        },
      ),
      interface: { parseLog: () => null },
      connect() { return this; },
    }));
    useDegeneretteFeed(null);

    let el = instantiate();
    await settle(80);
    let [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.phase, 'request-ready');
    assert.equal(pending.state, 'ready');
    assert.equal(pending.rngQueuePendingMilliEth, '420');
    assert.equal(pending.rngQueueThresholdMilliEth, '1000',
      'the pending descriptor carries the shared contract queue, not this bet count');

    await pending.run();
    [pending] = pendingActionsMod.getPendingActions();
    assert.equal(requestWrites, 1);
    assert.equal(pending.state, 'waiting');
    assert.equal(pending.phase, 'waiting-rng');
    assert.equal(pending.shortLabel, 'Waiting for RNG');
    assert.equal(pending.detail, 'RNG requested · waiting for Chainlink result');
    assert.equal(pending.pinned, true);
    assert.equal(pending.progress, 'indeterminate');
    assert.equal(pending.rngRequestBlock, 120);
    assert.equal(pending.rngCurrentBlock, 120);
    assert.equal(pending.rngConfirmations, 10);
    assert.equal(pending.run, null, 'a submitted request cannot be submitted twice');
    await settle(80);
    [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.phase, 'waiting-rng',
      'polling cannot overwrite the receipt-backed wait with a stale requestable read');
    assert.equal(el.querySelector('[data-bind="deg-state"]').textContent, '',
      'the bottom tray remains the sole RNG waiting surface');
    let stored = JSON.parse(localStorage.getItem(storageKey));
    assert.equal(stored.rngRequestPending, true);
    assert.ok(stored.rngRequestStartedAt > 0);
    assert.equal(stored.rngRequestBlock, 120);
    assert.equal(stored.rngObservedBlock, 120);

    el.disconnectedCallback();
    el = instantiate();
    await settle(80);
    [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.phase, 'waiting-rng', 'refresh restores the submitted request card');
    assert.equal(pending.pinned, true);
    assert.equal(pending.rngRequestBlock, 120, 'refresh preserves the real request block');
    assert.equal(el.querySelector('[data-bind="deg-state"]').textContent, '');
    el.disconnectedCallback();

    useDegeneretteFeed(readyFeedItem({ currency: 1 }));
    el = instantiate();
    await settle(80);
    [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.state, 'ready');
    assert.equal(pending.phase, 'result-ready');
    assert.equal(pending.pinned, false);
    assert.equal(pending.progress, null);
    stored = JSON.parse(localStorage.getItem(storageKey));
    assert.equal(stored.rngRequestPending, undefined,
      'the persisted progress latch clears as soon as the RNG word is ready');
    el.disconnectedCallback();
  });

  test('shared pending action invokes resolveBets with the parsed betId', async () => {
    useDegeneretteFeed(readyFeedItem());
    let resolveArgs = null;
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async (...args) => makeFakeTx(makeFakeReceipt([
          { parsed: { name: 'BetPlaced', args: { player: args[0], index: 7n, betId: 42n, packed: 0n } } },
        ])),
        { staticCall: async () => undefined },
      ),
      resolveDegeneretteBets: Object.assign(
        async (...args) => {
          resolveArgs = args;
          return makeFakeTx(makeFakeReceipt([
            {
              parsed: {
                name: 'DegeneretteResolved',
                args: { player: args[0], betId: 42n, spinCount: 1, totalPayout: 5n * 10n ** 16n, resultTraits: 1234n },
              },
            },
            {
              parsed: {
                name: 'DegeneretteResult',
                args: {
                  player: args[0], betId: 42n, spinIndex: 0,
                  playerTraits: 1234n, matches: 4n, payout: 5n * 10n ** 16n,
                },
              },
            },
          ]));
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect(_s) { return this; },
    }));
    const el = instantiate();
    await flushMicrotasks();

    const amountInput = el.querySelector('[name="deg-amount"]');
    if (amountInput) amountInput.value = '0.01';
    const ticketSel = el.querySelector('[name="deg-ticket-count"]');
    if (ticketSel) ticketSel.value = '1';

    const placeBtn = el.querySelector('.deg-place-cta');
    placeBtn.dispatchEvent({ type: 'click' });
    await settle(80);

    await runPendingDegeneretteAction();
    await settle(80);

    assert.ok(resolveArgs, 'resolveDegeneretteBets invoked');
    assert.equal(resolveArgs[0], CONNECTED, 'player = connected.address');
    assert.deepEqual(resolveArgs[1], [42n], 'betIds = [parsed BetPlaced.betId]');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the resolved action leaves the tray once the full reveal is queued');
    const [sequence] = (await loadReveal()).__takeQueuedForTest();
    assert.equal(sequence?.kind, 'degenerette');
    assert.equal(sequence?.currency, 0);
    assert.equal(sequence?.spins?.length, 1);

    el.disconnectedCallback();
  });

  test('Outcome stays neutral and resolution never mounts a second reel player in the widget', async () => {
    useDegeneretteFeed(readyFeedItem());

    const el = instantiate();
    await flushMicrotasks();

    const amountInput = el.querySelector('[name="deg-amount"]');
    if (amountInput) amountInput.value = '0.01';
    const ticketSel = el.querySelector('[name="deg-ticket-count"]');
    if (ticketSel) ticketSel.value = '1';

    const placeBtn = el.querySelector('.deg-place-cta');
    placeBtn.dispatchEvent({ type: 'click' });
    await settle(80);

    await runPendingDegeneretteAction();
    await settle(80);

    const outcomeEl = el.querySelector('.deg-outcome');
    assert.ok(outcomeEl, '.deg-outcome present');
    assert.equal(outcomeEl.textContent, '',
      'resolution does not add verbose result copy before the player reveals it');
    assert.equal(el.querySelector('[data-bind="dgn-inline-spin"]'), null,
      'the embedded reveal surface is absent');
    assert.equal(el.querySelector('[data-bind="dgn-results-summary"]'), null,
      'the embedded results summary is absent');
    assert.equal((await loadReveal()).__takeQueuedForTest().length, 1,
      'the branded overlay receives the completed result');

    el.disconnectedCallback();
  });

  // User call 2026-07-29: the UI offers whatever the contract allows. Spin cap
  // and minimum bet are BOTH per currency (module :227-238).
  test('spin options and minimum bet follow the selected currency', async () => {
    const el = instantiate();
    await settle(10);
    const spins = el.querySelector('[data-bind="deg-spins-select"]');
    const amount = el.querySelector('[name="deg-amount"]');
    const currency = el.querySelector('[name="deg-currency"]');

    assert.equal(spins.children.length, 25, 'ETH offers all 25 spins');
    assert.equal(spins.value, '5', 'wager starts at five spins');
    assert.equal(amount.getAttribute('min'), '0.005', 'ETH minimum per spin');

    // Park on a count only ETH allows, then switch: it must clamp, not send a
    // bet the contract rejects.
    spins.value = '22';
    currency.value = '1';
    currency.dispatchEvent({ type: 'change' });
    await settle(10);
    assert.equal(spins.children.length, 15, 'FLIP caps at 15');
    assert.equal(spins.value, '15', '22 clamps down to the FLIP cap');
    assert.equal(amount.getAttribute('min'), '100', 'FLIP minimum per spin');
    assert.equal(amount.value, '250', 'currency switch uses the FLIP default');

    currency.value = '3';
    currency.dispatchEvent({ type: 'change' });
    await settle(10);
    assert.equal(spins.children.length, 5, 'WWXRP caps at 5');
    assert.equal(spins.value, '5');
    assert.equal(amount.getAttribute('min'), '1', 'WWXRP minimum per spin');
    assert.equal(amount.value, '1', 'currency switch uses the WWXRP default');
    el.disconnectedCallback();
  });

  test('currency switches restore per-currency defaults, including quarter ticket price for ETH', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', { roll1: { purchaseLevel: 45 } });
    await settle(10);
    const currency = el.querySelector('[name="deg-currency"]');
    const amount = el.querySelector('[name="deg-amount"]');

    currency.value = '1';
    currency.dispatchEvent({ type: 'change' });
    assert.equal(amount.value, '250');

    currency.value = '3';
    currency.dispatchEvent({ type: 'change' });
    assert.equal(amount.value, '1');

    currency.value = '0';
    currency.dispatchEvent({ type: 'change' });
    assert.equal(amount.value, '0.02',
      'level 45 ticket price is 0.08 ETH, so its 0.02 quarter beats the 0.01 floor');
    el.disconnectedCallback();
  });

  test('Currency picker shows ETH + FLIP + WWXRP — currency 2 stays out (user ask supersedes Q7 deferral)', () => {
    instantiate();
    const currencyBlockMatch = PANEL_SRC.match(/<select[^>]*name="deg-currency"[\s\S]*?<\/select>/);
    assert.ok(currencyBlockMatch, 'deg-currency select block found in panel source');
    const currencyBlock = currencyBlockMatch[0];
    assert.match(currencyBlock, /value="3"/, 'WWXRP option (currency 3) exposed');
    assert.match(currencyBlock, /WWXRP/, 'WWXRP label present');
    assert.doesNotMatch(currencyBlock, /value="2"/,
      'currency 2 never exposed (UnsupportedCurrency on-chain)');
  });

  test('Place click debounced — double-click invokes placeBet exactly once', async () => {
    let placeCalls = 0;
    let claimableReads = 0;
    let recordedValue = null;
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async (...args) => {
          placeCalls += 1;
          recordedValue = args[6]?.value;
          return makeFakeTx(makeFakeReceipt([
            { parsed: { name: 'BetPlaced', args: { player: args[0], index: 7n, betId: 42n, packed: 0n } } },
          ]));
        },
        { staticCall: async () => undefined },
      ),
      claimableWinningsOf: async () => {
        claimableReads += 1;
        return (10n ** 16n) / BigInt(ETH_DIVISOR) + 1n;
      },
      resolveDegeneretteBets: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect(_s) { return this; },
    }));

    const el = instantiate();
    await flushMicrotasks();
    localStorage.setItem(lootboxMod.PURCHASE_FUNDING_PRIORITY_KEY, 'wallet');

    const amountInput = el.querySelector('[name="deg-amount"]');
    if (amountInput) amountInput.value = '0.01';
    const ticketSel = el.querySelector('[name="deg-ticket-count"]');
    if (ticketSel) ticketSel.value = '1';

    const placeBtn = el.querySelector('.deg-place-cta');
    placeBtn.dispatchEvent({ type: 'click' });
    placeBtn.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(placeCalls, 1, 'double-click invokes placeDegeneretteBet exactly once');
    assert.equal(claimableReads, 0, 'wallet-first preference never probes claimable');
    assert.equal(recordedValue, (10n ** 16n) / BigInt(ETH_DIVISOR),
      'wallet-first sends the full ETH wager');

    el.disconnectedCallback();
  });

  test('a confirmed placement enters Pending immediately even when receipt logs need indexing recovery', async () => {
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async () => makeFakeTx(makeFakeReceipt([])),
        { staticCall: async () => undefined },
      ),
      resolveDegeneretteBets: Object.assign(
        async () => makeFakeTx(makeFakeReceipt([])),
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));
    localStorage.setItem(lootboxMod.PURCHASE_FUNDING_PRIORITY_KEY, 'wallet');
    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="deg-amount"]').value = '0.01';
    el.querySelector('[name="deg-ticket-count"]').value = '1';

    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await settle(40);

    const pending = pendingActionsMod.getPendingActions()
      .find((item) => item.kind === 'degenerette');
    assert.ok(pending, 'the mined bet does not disappear while its ids are being recovered');
    assert.equal(pending.id, 'degenerette:sync:0xreceipt');
    assert.equal(pending.state, 'waiting');
    assert.equal(pending.phase, 'awaitingRng');
    assert.equal(pending.sharedRng, true);
    assert.equal(pending.detail, 'Bet confirmed · syncing RNG queue');
    assert.equal(pending.run, null, 'a syncing receipt cannot offer a duplicate write');
    el.disconnectedCallback();
  });

  test('broadcast bet appears before confirmation and failure retires only that submission', async () => {
    let rejectWait;
    const wait = new Promise((_resolve, reject) => { rejectWait = reject; });
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async () => ({ hash: '0xpendingbet', wait: async () => wait }),
        { staticCall: async () => undefined },
      ),
      resolveDegeneretteBets: Object.assign(
        async () => makeFakeTx(makeFakeReceipt([])),
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));
    pendingActionsMod.publishPendingActions('unrelated-test', [{
      id: 'lootbox:already-waiting',
      kind: 'lootbox',
      label: 'Existing lootbox',
      state: 'waiting',
      pinned: true,
    }]);
    const errors = [];
    const unsubscribe = pendingActionsMod.subscribePendingActionErrors((message) => errors.push(message));
    localStorage.setItem(lootboxMod.PURCHASE_FUNDING_PRIORITY_KEY, 'wallet');
    const el = instantiate();
    await flushMicrotasks();
    el.querySelector('[name="deg-amount"]').value = '0.01';
    el.querySelector('[name="deg-ticket-count"]').value = '1';

    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    let pending = pendingActionsMod.getPendingActions();
    const submitted = pending.find((item) => item.id === 'degenerette:submitted:0xpendingbet');
    assert.ok(submitted, 'the bet enters Pending immediately after wallet broadcast');
    assert.equal(submitted.phase, 'submitting');
    assert.equal(submitted.shortLabel, 'Transaction sent');
    assert.ok(pending.some((item) => item.id === 'lootbox:already-waiting'));

    rejectWait(new Error('Transaction reverted after broadcast'));
    await settle(40);
    pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.some((item) => item.id === 'degenerette:submitted:0xpendingbet'), false,
      'the failed Degenerette submission disappears');
    assert.ok(pending.some((item) => item.id === 'lootbox:already-waiting'),
      'an unrelated pending action survives the failure');
    assert.equal(errors.length, 1, 'the tray receives one short failure message');

    unsubscribe();
    el.disconnectedCallback();
  });

  test('NEVER optimistic balance subtraction — source contains no `amount = amount -` patterns', () => {
    assert.doesNotMatch(PANEL_SRC, /amount\s*=\s*amount\s*-/, 'no optimistic subtraction patterns');
  });

  test('completed results have one authoritative full-screen reveal path', () => {
    assert.match(PANEL_SRC, /import \{ queueReveal \} from '\.\/reveal-overlay\.js'/);
    assert.match(PANEL_SRC, /buildDegeneretteRevealSequence\(\{/,
      'receipt, DB, and chain recovery share a normalized sequence builder');
    assert.match(PANEL_SRC, /queueReveal\(sequence\)/,
      'a complete result launches the branded overlay');
    assert.match(
      PANEL_SRC,
      /#presentedBetKeys\.has\(presentationKey\)[\s\S]*?#presentedBetKeys\.add\(presentationKey\)/,
      'a result is retired before the panel asks the DB for its next pending bet',
    );
    assert.match(
      PANEL_SRC,
      /indexed\?\.results[\s\S]*?resultType === 'resolved'[\s\S]*?continue/,
      'a stale pending snapshot cannot resurrect a feed-confirmed terminal bet',
    );
    assert.doesNotMatch(PANEL_SRC, /<section class="dgn-inline-spin"/,
      'the widget no longer mounts its own reel player');
    assert.doesNotMatch(PANEL_SRC, /<section class=\"dgn-results-summary\"/,
      'the widget no longer mounts a duplicate result summary');
  });

  test('record bounties split from Luckbox spin types without changing types 0-2', async () => {
    const {
      dgnDecodePacked,
      partitionDegeneretteRewardLegs,
      withDegeneretteRecordContext,
    } = await import('../app-degenerette-panel.js');
    const legs = [
      { legType: 'spin', spinType: 'wwxrp' },
      { legType: 'spin', spinType: 'flip' },
      { legType: 'spin', spinType: 'eth' },
      { legType: 'spin', spinType: 'record' },
      { legType: 'spin', spinType: 'unknown_3' },
    ];

    const split = partitionDegeneretteRewardLegs(legs);
    assert.deepEqual(split.lootboxLegs.map((leg) => leg.spinType), ['wwxrp', 'flip', 'eth']);
    assert.deepEqual(split.recordBountySpins.map((leg) => leg.spinType), ['record', 'unknown_3']);

    const packed = (305n << 202n) | (900n << 220n);
    assert.equal(dgnDecodePacked(packed).recordBountyStake, 900n * 10n ** 18n);
    assert.deepEqual(
      withDegeneretteRecordContext(split.recordBountySpins, packed).map((spin) => ({
        type: spin.spinType,
        stake: spin.recordStake,
        activity: spin.activityScore,
      })),
      [
        { type: 'record', stake: 900n * 10n ** 18n, activity: 305 },
        { type: 'unknown_3', stake: 900n * 10n ** 18n, activity: 305 },
      ],
      'indexed replay preserves the parent inputs needed to explain a survival bust',
    );
  });

  test('a new placement invalidates an older in-flight result and luckbox replay', () => {
    assert.match(
      PANEL_SRC,
      /#resolutionGeneration \+= 1;[\s\S]*?#cancelRngPoll\(\);[\s\S]*?await placeBet\(\{/,
      'placement takes ownership before waiting on the wallet transaction',
    );
    assert.match(
      PANEL_SRC,
      /#replayIndexedResolution\([\s\S]*?resolutionGeneration = this\.#resolutionGeneration[\s\S]*?const stillCurrent = \(\) => resolutionGeneration === this\.#resolutionGeneration/,
      'every asynchronous replay captures the placement generation',
    );
    assert.match(
      PANEL_SRC,
      /#finishResolvedBet\([\s\S]*?resolutionGeneration = this\.#resolutionGeneration[\s\S]*?if \(resolutionGeneration !== this\.#resolutionGeneration\) return false;/,
      'a stale replay cannot queue either its reels or its attached box',
    );
  });

  test('an indexed resolved row cannot reveal while that exact bet is still live on-chain', async () => {
    const packed = BigInt(readyFeedItem().packedData);
    const payout = 5n * 10n ** 16n;
    useDegeneretteFeed(readyFeedItem({
      results: [
        {
          resultType: 'resolved',
          transactionHash: '0xstale',
          payout: String(payout),
          resultData: {
            spinCount: 1,
            totalPayout: String(payout),
            resultTraits: '13',
          },
        },
        {
          resultType: 'result',
          payout: String(payout),
          resultData: { spinIndex: 0, playerTraits: '13', matches: 4 },
        },
      ],
      lootboxPayouts: [{
        rewardType: 'opened',
        rewardData: { amount: '1', futureLevel: 8, futureTickets: 1, flip: '0' },
      }],
    }));
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async (...args) => makeFakeTx(makeFakeReceipt([{
          parsed: {
            name: 'BetPlaced',
            args: { player: args[0], index: 7n, betId: 42n, packed },
          },
        }])),
        { staticCall: async () => undefined },
      ),
      degeneretteBetInfo: async () => packed,
      resolveDegeneretteBets: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect() { return this; },
    }));

    const el = instantiate();
    await settle(30);
    el.querySelector('[name="deg-amount"]').value = '0.01';
    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await settle(100);

    assert.deepEqual(revealMod.__takeQueuedForTest(), [],
      'neither stale reels nor their stale luckbox enter the queue');
    assert.ok(pendingActionsMod.getPendingActions().some((item) => item.id === 'degenerette:42'),
      'the real live bet remains pending');
    el.disconnectedCallback();
  });

  test('a bounty placement suppresses an older result already waiting on RPC', async () => {
    const storageKey = `pending-degenerette:${CHAIN.id}:${CHAIN.deployBlock}:${CONNECTED.toLowerCase()}`;
    const oldBetId = 41n;
    const newBetId = 42n;
    const packed = 13n | (1n << 32n) | ((10n ** 10n) << 42n);
    localStorage.setItem(storageKey, JSON.stringify({
      betId: String(oldBetId),
      index: '7',
      currency: 0,
      amountPerSpin: String(10n ** 10n),
      spinCount: 1,
      hero: 0,
      ticket: '13',
    }));

    let releaseReplay;
    const replayGate = new Promise((resolve) => { releaseReplay = resolve; });
    let replayReads = 0;
    let placeCalls = 0;
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => 5_000,
      getTransactionReceipt: async () => makeFakeReceipt([]),
    });
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async (...args) => {
          placeCalls += 1;
          return makeFakeTx(makeFakeReceipt([{
            parsed: {
              name: 'BetPlaced',
              args: { player: args[0], index: 8n, betId: newBetId, packed },
            },
          }]));
        },
        { staticCall: async () => undefined },
      ),
      claimableWinningsOf: async () => 1n,
      degeneretteBetInfo: async (_player, betId) => (
        BigInt(betId) === oldBetId ? 0n : packed
      ),
      resolveDegeneretteBets: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
      ),
      filters: {
        DegeneretteResolved: (_player, betId) => ({ event: 'resolved', betId }),
        DegeneretteResult: (_player, betId) => ({ event: 'result', betId }),
      },
      queryFilter: async (filter) => {
        replayReads += 1;
        await replayGate;
        if (filter.event === 'resolved') {
          return [{
            args: {
              player: CONNECTED,
              betId: oldBetId,
              spinCount: 1n,
              totalPayout: 5n * 10n ** 16n,
              resultTraits: 13n,
            },
            transactionHash: '0xold-result',
          }];
        }
        return [{
          args: {
            player: CONNECTED,
            betId: oldBetId,
            spinIndex: 0n,
            playerTraits: 13n,
            matches: 4n,
            payout: 5n * 10n ** 16n,
          },
        }];
      },
      interface: { parseLog: (log) => log.parsed ?? null },
      connect() { return this; },
    }));
    useDegeneretteFeed(readyFeedItem({
      betId: String(oldBetId),
      packedData: String(packed),
      results: [{
        resultType: 'resolved',
        resultData: { spinCount: 1, totalPayout: '1', resultTraits: '13' },
      }],
    }));

    const el = instantiate();
    await settle(40);
    assert.ok(replayReads >= 2, 'the older result is already inside its chain replay');

    document.dispatchEvent(new CustomEvent('quest:activate', {
      detail: {
        questType: 7,
        target: String(10n ** 10n),
        amountPerSpin: String(10n ** 10n),
        spinCount: 1,
        preferClaimable: true,
        variant: 'bounty',
        submit: true,
      },
    }));
    await settle(40);
    assert.equal(placeCalls, 1, 'the new bounty spin owns the panel');

    releaseReplay();
    await settle(100);
    assert.deepEqual(revealMod.__takeQueuedForTest(), [],
      'the late older result cannot enqueue reels or an extra box');
    assert.ok(pendingActionsMod.getPendingActions().some((item) => item.id === 'degenerette:42'),
      'the bounty spin remains the active pending bet');
    el.disconnectedCallback();
  });

  test('a DB-recovered Degenerette box has a stable identity before transaction metadata arrives', async () => {
    const { degeneretteLootboxPresentationId } = await import('../app-degenerette-panel.js');
    assert.equal(
      degeneretteLootboxPresentationId(CONNECTED, 42n),
      `degenerette-lootbox:${CONNECTED.toLowerCase()}:42`,
    );
    assert.equal(degeneretteLootboxPresentationId('', 42n), null);
  });

  test('reads the player-filtered DB feed first and keeps a chain-read recovery path', () => {
    assert.match(
      PANEL_SRC,
      /\/degenerette\/feed\?limit=200&player=/,
      'panel polls the durable player-filtered feed',
    );
    assert.match(PANEL_SRC, /canResolveBets\(\{/,
      'the exact resolver static call recovers readiness while the DB word lags');
    assert.match(PANEL_SRC, /readResolvedBet\(\{/,
      'already-resolved chain events recover a result while the DB feed lags');
  });

  test('referral is its own full-width wager-column bubble and copies the connected player default link', async () => {
    affiliateMod.__setFetchJSONForTest(async () => ({ affiliate: { ownCode: null } }));
    const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const copied = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: async (value) => { copied.push(String(value)); } } },
    });
    storeMod.update('connected.address', null);
    const el = instantiate();
    try {
      await settle(20);
      const button = el.querySelector('[data-bind="deg-referral-copy"]');
      assert.equal(button.disabled, true);
      storeMod.update('connected.address', CONNECTED);
      await settle(50);
      assert.match(el.innerHTML, /REFER FRIENDS[\s\S]*?deg-referral-card__free">FREE<\/span>[\s\S]*?deg-referral-card__flip">FLIP<\/span>[\s\S]*?FOREVER/,
        'the compact three-line referral promise is part of the graphic');
      assert.match(APP_CSS, /\.deg-referral-card__free\s*\{[^}]*color:\s*#4ade80/s,
        'FREE is highlighted in green');
      assert.match(APP_CSS, /\.deg-referral-card__flip\s*\{[^}]*color:\s*#f87171/s,
        'FLIP is highlighted in red');
      assert.match(el.innerHTML,
        /deg-referral-card__forever[\s\S]*?FOREVER[\s\S]*?deg-referral-card__coin[\s\S]*?coinflip-face-red\.svg[\s\S]*?coinflip-face-eth\.svg/,
        'the two-sided flipping coin sits directly after FOREVER');
      assert.match(el.innerHTML,
        /deg-referral-card__coin-static[\s\S]*?flame-logo-split\.svg[\s\S]*?coin-face--wwxrp[\s\S]*?coin-face--eth/,
        'the isolated FLIP fallback precedes distinct WWXRP and ETH faces');
      assert.match(APP_CSS,
        /\.deg-referral-card__forever\s*\{[^}]*display:\s*flex[^}]*gap:\s*0\.62rem/s,
        'the coin is spaced just to the right of FOREVER');
      assert.match(APP_CSS,
        /\.deg-referral-card__coin\s*\{[^}]*position:\s*relative[^}]*display:\s*block[^}]*width:\s*2\.75rem[^}]*transform:\s*translate\(0\.22rem, 0\.22rem\)/s,
        'the larger referral coin is always visible down-right of the word');
      assert.match(APP_CSS,
        /\.deg-referral-card__coin-inner\s*\{[^}]*animation:\s*deg-referral-coin-tumble 1\.6s ease-in-out infinite/s,
        'the referral coin continuously tumbles through its two explicit faces');
      assert.match(APP_CSS,
        /@keyframes deg-referral-coin-tumble\s*\{[^}]*scaleY\(1\)[\s\S]*?scaleY\(0\.08\)/s,
        'the coin flips top-to-bottom instead of rolling sideways');
      assert.doesNotMatch(
        APP_CSS.slice(
          APP_CSS.indexOf('@keyframes deg-referral-coin-tumble'),
          APP_CSS.indexOf('@keyframes deg-referral-face-wwxrp'),
        ),
        /scaleX/,
      );
      const referralCoin = el.querySelector('[data-bind="deg-referral-coin-toggle"]');
      const referralCoinInner = el.querySelector('.deg-referral-card__coin-inner');
      const referralCoinFallback = el.querySelector('.deg-referral-card__coin-static');
      assert.equal(referralCoin.tagName, 'BUTTON', 'the flipping coin is keyboard accessible');
      assert.match(el.innerHTML,
        /data-bind="deg-referral-coin-toggle" aria-pressed="false"[\s\S]*?aria-label="Pause animation and copy referral link"/,
        'the toggle advertises both pause and copy behavior');
      assert.match(APP_CSS,
        /\.deg-referral-card__coin\.is-paused \.deg-referral-card__coin-inner\s*\{[^}]*visibility:\s*hidden;[^}]*animation:\s*none/s,
        'the paused state removes both outcome faces so only FLIP remains');
      referralCoinInner.dispatchEvent({ type: 'animationstart' });
      assert.equal(referralCoinFallback.hidden, true,
        'the fallback is physically removed once the outcome animation starts');
      assert.equal(referralCoinInner.hidden, false);
      assert.equal(referralCoin.classList.contains('is-animating'), true);
      referralCoinInner.dispatchEvent({ type: 'animationcancel' });
      assert.equal(referralCoinFallback.hidden, false,
        'a stopped animation immediately restores the FLIP-only fallback');
      assert.equal(referralCoinInner.hidden, true,
        'stopped outcome artwork cannot remain layered over the fallback');
      referralCoin.dispatchEvent({ type: 'click', preventDefault() {} });
      await settle(80);
      assert.equal(referralCoin.classList.contains('is-paused'), true);
      assert.equal(referralCoin.getAttribute('aria-pressed'), 'true');
      assert.equal(referralCoin.getAttribute('aria-label'), 'Resume animation and copy referral link');
      assert.equal(copied.length, 1, 'pausing the coin also copies the referral link');
      referralCoin.dispatchEvent({ type: 'click', preventDefault() {} });
      await settle(80);
      assert.equal(referralCoin.classList.contains('is-paused'), false);
      assert.equal(referralCoin.getAttribute('aria-pressed'), 'false');
      assert.equal(referralCoin.getAttribute('aria-label'), 'Pause animation and copy referral link');
      assert.equal(copied.length, 2, 'resuming the coin copies the link too');
      assert.match(APP_CSS,
        /\.deg-referral-card__coin-face--wwxrp\s*\{[^}]*deg-referral-face-wwxrp[^}]*\}[\s\S]*?\.deg-referral-card__coin-face--eth\s*\{[^}]*deg-referral-face-eth[^}]*\}[\s\S]*?@keyframes deg-referral-face-wwxrp[\s\S]*?@keyframes deg-referral-face-eth/s,
        'complementary two-dimensional face swaps prevent WWXRP from rendering on both sides');
      assert.doesNotMatch(APP_CSS.slice(
        APP_CSS.indexOf('body.layout-basic .deg-referral-card__coin {'),
        APP_CSS.indexOf('body.layout-basic .deg-referral-card__actions {'),
      ), /backface-visibility|preserve-3d|rotateX/,
      'the referral coin no longer depends on browser-fragile 3D backface rendering');
      assert.match(PANEL_SRC,
        /animationstart[\s\S]*?#showReferralCoinAnimation[\s\S]*?animationcancel[\s\S]*?#showReferralCoinFallback/s,
        'animated artwork is exposed only after the browser actually starts it');
      assert.match(PANEL_SRC,
        /fallback\.hidden = true[\s\S]*?inner\.hidden = false[\s\S]*?#showReferralCoinFallback\(\);[\s\S]*?2_400/s,
        'a watchdog restores FLIP if animation iterations ever stop');
      assert.match(APP_CSS,
        /\.deg-referral-card__coin-static\[hidden\],[\s\S]*?\.deg-referral-card__coin-inner\[hidden\]\s*\{[^}]*display:\s*none !important/s,
        'the inactive layer is removed from layout and cannot bleed through');
      assert.match(APP_CSS,
        /\.deg-referral-card__coin\.is-tactile-pressed,[^}]*\{[^}]*box-shadow:\s*none !important;[^}]*transform:\s*translate\(0\.22rem, 0\.22rem\) !important/s,
        'click feedback cannot draw a box or nudge the referral artwork');
      assert.match(APP_CSS,
        /\.deg-referral-card__coin:focus-visible\s*\{[^}]*outline:\s*0;[^}]*drop-shadow/s,
        'keyboard focus uses an artwork glow rather than a control box');
      assert.match(el.innerHTML, /class="deg-referral-card__logo" src="\/whitepaper\/flame-logo\.svg"/,
        'one clean Degenerus mark anchors the referral action row');
      assert.doesNotMatch(el.innerHTML, /deg-referral-card__(?:graphic|link|flame)/,
        'the old chain-link ornament is gone');
      assert.doesNotMatch(el.innerHTML, /deg-referral-status/,
        'the referral tile has no changing subtext');
      assert.match(el.innerHTML, /Earn 20% commission in FLIP/,
        'the compact details sheet states the commission rate');
      assert.doesNotMatch(el.innerHTML, /DEGENERUS REFERRALS/,
        'the redundant referral popup eyebrow is gone');
      assert.doesNotMatch(el.innerHTML, /SHARE THE PURGE/,
        'the details sheet uses current Degenerus branding');
      assert.ok(
        PANEL_SRC.indexOf('</section>', PANEL_SRC.indexOf('deg-block deg-block--wager'))
          < PANEL_SRC.indexOf('<aside class="deg-referral-card"'),
        'the referral bubble is a sibling below wager, not nested inside it',
      );
      assert.match(APP_CSS, /\.deg-wager-column\s*\{[^}]*display:\s*grid/s);
      assert.match(APP_CSS, /\.deg-referral-card\s*\{[^}]*width:\s*100%[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
        'the short bubble gives its message the full wager-column width');
      assert.match(APP_CSS,
        /\.deg-referral-card\s*\{\s*width:\s*100%;\s*height:\s*auto;\s*min-height:\s*0;\s*grid-template-rows:\s*auto auto;/s,
        'phones shrink-wrap the referral bubble instead of inheriting its desktop height');
      assert.match(APP_CSS,
        /@media \(max-width: 520px\)[\s\S]*?\.deg-referral-card__copy\s*\{[^}]*min-height:\s*4rem;[^}]*padding-right:\s*4\.2rem[^}]*align-content:\s*center/s,
        'the phone banner reserves a balanced visual zone on the right');
      assert.match(APP_CSS,
        /@media \(max-width: 520px\)[\s\S]*?\.deg-referral-card__copy > strong\s*\{[^}]*grid-template-columns:\s*max-content max-content[^}]*gap:\s*0\.16rem 0\.38rem/s,
        'phone copy condenses into a legible two-line lockup');
      assert.match(APP_CSS,
        /@media \(max-width: 520px\)[\s\S]*?\.deg-referral-card__coin\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0\.08rem;[^}]*width:\s*3\.7rem;[^}]*translateY\(-50%\)/s,
        'the animated coin fills the reserved right side instead of crowding FOREVER');
      assert.match(APP_CSS,
        /@media \(max-width: 520px\)[\s\S]*?\.deg-referral-card__info-btn\s*\{[^}]*width:\s*2\.75rem;[^}]*height:\s*2\.75rem;[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;[^}]*aspect-ratio:\s*1;[^}]*border-radius:\s*50%/s,
        'the phone info control stays a true circular tap target');
      assert.match(APP_CSS, /\.deg-referral-card__logo\s*\{[^}]*bottom:\s*0\.52rem[^}]*left:\s*0\.58rem/s,
        'the Degenerus mark sits in the lower-left corner');
      assert.match(
        APP_CSS,
        /app-degenerette-panel \.dgn-ticket \.dgn-q\.q-hero img\s*\{\s*transform:\s*none;/s,
        'build-ticket badges are centered without the old downward translation',
      );
      assert.equal(button.disabled, false);
      button.dispatchEvent({ type: 'click', preventDefault() {} });
      await settle(80);
      assert.equal(copied.length, 3);
      assert.match(copied.at(-1), /^https:\/\/degener\.us\/app\/\?ref=0x[0-9a-f]{40}$/);
      assert.match(copied.at(-1), new RegExp(`${CONNECTED.slice(2).toLowerCase()}$`),
        'the default address-derived code belongs to the connected player');
      assert.equal(button.textContent, 'CODE COPIED');

      const info = el.querySelector('[data-bind="deg-referral-info"]');
      info.dispatchEvent({ type: 'click', preventDefault() {} });
      const dialog = el.querySelector('[data-bind="deg-referral-dialog"]');
      assert.equal(dialog.hidden, false);
      const link = el.querySelector('[data-bind="deg-referral-url"]');
      assert.equal(link.value, copied[0]);
      link.dispatchEvent({ type: 'click', preventDefault() {} });
      await settle(80);
      assert.equal(copied.length, 4);
      assert.ok(copied.every((value) => value === copied[0]),
        'every coin, button, and URL route copies the same resolved referral link');
    } finally {
      el.disconnectedCallback();
      affiliateMod.__setFetchJSONForTest(null);
      if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator);
      else delete globalThis.navigator;
    }
  });

  test('referral copy does not wait for affiliate lookup and has a mounted-field fallback', async () => {
    const pendingLookups = [];
    affiliateMod.__setFetchJSONForTest(() => new Promise((resolve) => pendingLookups.push(resolve)));
    const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const priorExecCommand = document.execCommand;
    const clipboardAttempts = [];
    const fallbackCopies = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText(value) {
            clipboardAttempts.push(String(value));
            return Promise.reject(new Error('permission denied'));
          },
        },
      },
    });
    document.execCommand = (command) => {
      const field = document.querySelector('textarea');
      fallbackCopies.push({ command, value: field?.value });
      return command === 'copy';
    };
    const el = instantiate();
    try {
      const button = el.querySelector('[data-bind="deg-referral-copy"]');
      assert.equal(button.disabled, false);
      button.dispatchEvent({ type: 'click', preventDefault() {} });
      await settle(20);
      assert.equal(pendingLookups.length >= 1, true, 'affiliate lookup is still unresolved');
      assert.deepEqual(clipboardAttempts, [
        `https://degener.us/app/?ref=${CONNECTED.toLowerCase()}`,
      ], 'clipboard is attempted immediately with the always-valid address link');
      assert.deepEqual(fallbackCopies, [{
        command: 'copy',
        value: `https://degener.us/app/?ref=${CONNECTED.toLowerCase()}`,
      }], 'a temporary mounted field backs up denied Clipboard API access');
      assert.equal(document.querySelector('textarea'), null, 'temporary copy field is removed');
      assert.equal(button.textContent, 'CODE COPIED');
    } finally {
      el.disconnectedCallback();
      for (const resolve of pendingLookups) resolve({ affiliate: { ownCode: null } });
      affiliateMod.__setFetchJSONForTest(null);
      if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator);
      else delete globalThis.navigator;
      if (priorExecCommand) document.execCommand = priorExecCommand;
      else delete document.execCommand;
    }
  });

  test('Degenerette basics uses one concise ETH/FLIP payout matrix and omits WWXRP payouts', () => {
    const el = instantiate();
    try {
      assert.match(el.innerHTML, /data-bind="deg-basics-info"[^>]*aria-label="How Degenerette works"/);
      assert.match(el.innerHTML, /Pick a symbol and color for each quadrant/);
      assert.match(el.innerHTML, /Matching symbols score/);
      const info = el.querySelector('[data-bind="deg-basics-info"]');
      const dialog = el.querySelector('[data-bind="deg-basics-dialog"]');
      const payoutArea = el.querySelector('.deg-payouts');
      const payoutTables = el.querySelectorAll('.deg-payout-table');
      assert.equal(payoutTables.length, 1, 'all gold schedules share one comparison matrix');
      const payoutRows = payoutTables[0].querySelectorAll('tbody')[0].querySelectorAll('tr');
      assert.equal(payoutRows.length, 9, 'the universal zero scores share one 0–1 row');
      assert.equal(payoutRows[0].children.length, 9,
        'score plus all eight ETH/FLIP gold-and-Hero variants are shown');
      const payoutHeadings = payoutTables[0].querySelectorAll('th')
        .map((heading) => heading.textContent).join(' ');
      assert.match(payoutHeadings, /0 GOLD/);
      assert.match(payoutHeadings, /4 GOLD/);
      assert.match(payoutHeadings, /HERO GOLD/);
      assert.match(payoutHeadings, /OTHER HERO/);
      assert.doesNotMatch(payoutHeadings, /WWXRP/);
      assert.equal(dialog.hidden, true);
      info.dispatchEvent({ type: 'click', preventDefault() {} });
      assert.equal(dialog.hidden, false);
      el.querySelector('[data-bind="deg-basics-close"]')
        .dispatchEvent({ type: 'click', preventDefault() {} });
      assert.equal(dialog.hidden, true);
    } finally {
      el.disconnectedCallback();
    }
  });

  test('AbortController used for RNG poll cleanup (T-62-03-07)', () => {
    assert.match(PANEL_SRC, /AbortController/, 'panel uses AbortController for RNG poll');
  });

  test('disconnectedCallback flushes #unsubs[] and aborts RNG poll without throwing', () => {
    const el = instantiate();
    assert.doesNotThrow(() => el.disconnectedCallback());
    assert.doesNotThrow(() => el.disconnectedCallback());
  });
});

// ===========================================================================
// Task #11 — ticket picker + shared branded results surface.
// ===========================================================================

describe('Task #11: <app-degenerette-panel> ticket picker + overlay results', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    installDeityOwners();
    degeneretteMod.__setContractFactoryForTest(() => makeFakeDegContract());
    lootboxMod.__setContractFactoryForTest(() => ({
      lootboxRngWordByIndex: async () => 0xabcdn,
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));
    useDegeneretteFeed(readyFeedItem());
    await import('../app-degenerette-panel.js');
    const reveal = await loadReveal();
    reveal.__takeQueuedForTest();
  });

  test('picker renders 4 quadrant badges + exactly one hero, no raw uint32 input', () => {
    const el = instantiate();
    assert.equal(el.querySelector('[data-bind="dgn-editor"]').hidden, true,
      'the trait selector is closed by default');
    const editHint = el.querySelector('[data-bind="dgn-ticket-hint"]');
    assert.match(el.innerHTML, /data-bind="dgn-ticket-hint">CLICK TO EDIT<\/p>/,
      'the ticket template includes the visible edit affordance copy');
    assert.equal(editHint.hidden, false,
      'the idle ticket carries a visible edit affordance below it');
    for (let q = 0; q < 4; q += 1) {
      const img = el.querySelector(`[data-bind="dgn-img-${q}"]`);
      assert.ok(img, `quadrant ${q} badge img`);
      assert.match(String(img.src), /^\/badges-circular\//, 'badge path scheme');
    }
    const heroes = [0, 1, 2, 3].filter((q) =>
      el.querySelector(`[data-bind="dgn-cell-${q}"]`).classList.contains('q-hero'));
    assert.equal(heroes.length, 1, 'exactly one hero quadrant');
    assert.equal(el.querySelector('[name="deg-custom-ticket"]'), null, 'raw uint32 input removed');
    assert.equal(el.querySelector('[name="deg-quadrant"]'), null, 'raw quadrant select removed');
    el.querySelector('[data-bind="dgn-cell-0"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="dgn-editor"]').hidden, false,
      'clicking a quadrant opens its selector');
    assert.equal(editHint.hidden, true,
      'the editor replaces the idle hint instead of duplicating it');
    el.querySelector('[data-bind="dgn-cell-0"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="dgn-editor"]').hidden, true);
    assert.equal(editHint.hidden, false, 'closing the editor restores the hint');
    el.disconnectedCallback();
  });

  test('pink and green use dark contrast tiles except for crypto symbols', () => {
    const el = instantiate();
    el.querySelector('[data-bind="dgn-cell-0"]').dispatchEvent({ type: 'click' });
    let editor = el.querySelector('[data-bind="dgn-editor"]');
    editor.querySelectorAll('.dgn-color-btn')[0].dispatchEvent({ type: 'click' });
    editor = el.querySelector('[data-bind="dgn-editor"]');
    assert.ok(editor.querySelectorAll('.dgn-symbol-btn')
      .every((button) => !button.classList.contains('dgn-symbol-btn--dark-trait')),
    'pink crypto symbols keep the neutral tile');

    editor.querySelectorAll('.dgn-color-btn')[2].dispatchEvent({ type: 'click' });
    editor = el.querySelector('[data-bind="dgn-editor"]');
    assert.ok(editor.querySelectorAll('.dgn-symbol-btn')
      .every((button) => !button.classList.contains('dgn-symbol-btn--dark-trait')),
    'green crypto symbols keep the neutral tile');

    el.querySelector('[data-bind="dgn-cell-1"]').dispatchEvent({ type: 'click' });
    editor = el.querySelector('[data-bind="dgn-editor"]');
    editor.querySelectorAll('.dgn-color-btn')[0].dispatchEvent({ type: 'click' });
    editor = el.querySelector('[data-bind="dgn-editor"]');
    assert.ok(editor.querySelectorAll('.dgn-symbol-btn')
      .every((button) => button.classList.contains('dgn-symbol-btn--dark-trait')),
    'pink non-crypto symbols retain the dark contrast tile');

    editor.querySelectorAll('.dgn-color-btn')[2].dispatchEvent({ type: 'click' });
    editor = el.querySelector('[data-bind="dgn-editor"]');
    assert.ok(editor.querySelectorAll('.dgn-symbol-btn')
      .every((button) => button.classList.contains('dgn-symbol-btn--dark-trait')),
    'green non-crypto symbols retain the dark contrast tile');

    editor.querySelectorAll('.dgn-color-btn')[1].dispatchEvent({ type: 'click' });
    editor = el.querySelector('[data-bind="dgn-editor"]');
    assert.ok(editor.querySelectorAll('.dgn-symbol-btn')
      .every((button) => !button.classList.contains('dgn-symbol-btn--dark-trait')),
    'other colors keep the neutral tile');
    el.disconnectedCallback();
  });

  test('picker defaults to the first upcoming ticket with gold and makes gold Hero', async () => {
    const seen = [];
    storeMod.update('app.lastDay', {
      day: 130,
      roll1: { purchaseLevel: 25 },
    });
    _fetchHandler = async (url) => {
      seen.push(String(url));
      if (String(url).includes('/tickets/by-trait?level=25')) {
        return {
          cards: [
            {
              cardIndex: 0,
              status: 'opened',
              entries: [0, 64, 128, 192].map((traitId) => ({ traitId })),
            },
            {
              cardIndex: 1,
              status: 'opened',
              // Q2, color 7 (gold), symbol 3 = 128 + 56 + 3.
              entries: [1, 65, 187, 193].map((traitId) => ({ traitId })),
            },
          ],
        };
      }
      return { player: null, pending: {} };
    };

    const el = instantiate();
    await settle(50);

    assert.ok(
      seen.some((url) => url.includes(`/player/${CONNECTED}/tickets/by-trait?level=25`)),
      'upcoming drawing inventory is read from the DB API',
    );
    assert.match(
      el.querySelector('[data-bind="dgn-img-2"]').src,
      /_gold\.svg$/,
      'gold ticket wins default selection',
    );
    assert.ok(
      el.querySelector('[data-bind="dgn-cell-2"]').classList.contains('q-hero'),
      'the gold quadrant is Hero',
    );
    assert.doesNotMatch(
      el.querySelector('[data-bind="dgn-img-0"]').src,
      /xrp_pink/,
      'the earlier non-gold ticket was not selected',
    );
    assert.equal(el.querySelector('[data-bind="dgn-editor"]').hidden, true,
      'loading the gold-trait default does not pop the selector open');
    el.disconnectedCallback();
  });

  test('a deity holder defaults the Hero quadrant to their owned deity symbol', async () => {
    installDeityOwners(new Map([[22, CONNECTED]])); // cards quadrant · king
    storeMod.update('app.lastDay', {
      day: 131,
      roll1: { purchaseLevel: 26 },
    });
    _fetchHandler = async (url) => {
      if (String(url).includes('/tickets/by-trait?level=26')) {
        return {
          cards: [{
            cardIndex: 0,
            status: 'opened',
            entries: [0, 64, 128, 192].map((traitId) => ({ traitId })),
          }],
        };
      }
      return { player: null, pending: {} };
    };

    const el = instantiate();
    await settle(60);

    assert.equal(
      el.querySelector('[data-bind="dgn-img-2"]').src,
      '/badges-circular/cards_01_king_pink.svg',
      'the deity symbol replaces only the symbol in its natural quadrant',
    );
    assert.ok(el.querySelector('[data-bind="dgn-cell-2"]').classList.contains('q-hero'),
      'the deity symbol quadrant is Hero by default');
    assert.equal(el.querySelector('[data-bind="dgn-editor"]').hidden, true);
    el.disconnectedCallback();
  });

  test('editor drives the packed customTicket + heroQuadrant passed to placeDegeneretteBet', async () => {
    const fake = makeFakeDegContract();
    degeneretteMod.__setContractFactoryForTest(() => fake);
    const el = instantiate();
    await settle(40);

    // Set (color, symbol) per quadrant via editor buttons: c=[1,2,3,4], s=[5,6,7,0].
    // Hero is the ninth compact control in the color row.
    const colors = [1, 2, 3, 4];
    const symbols = [5, 6, 7, 0];
    const initialHero = [0, 1, 2, 3]
      .find((q) => el.querySelector(`[data-bind="dgn-cell-${q}"]`).classList.contains('q-hero'));
    const chosenHero = ((initialHero ?? 0) + 1) % 4;
    for (let q = 0; q < 4; q += 1) {
      el.querySelector(`[data-bind="dgn-cell-${q}"]`).dispatchEvent({ type: 'click' });
      // Editor rebuilds after every click — re-query buttons each time.
      el.querySelector('[data-bind="dgn-editor"]')
        .querySelectorAll('.dgn-color-btn')[colors[q]].dispatchEvent({ type: 'click' });
      el.querySelector('[data-bind="dgn-editor"]')
        .querySelectorAll('.dgn-symbol-btn')[symbols[q]].dispatchEvent({ type: 'click' });
      if (q === chosenHero) {
        const colorRow = el.querySelector('[data-bind="dgn-editor"]').querySelector('.dgn-colors');
        const hero = colorRow.querySelector('.dgn-hero-toggle');
        assert.equal(colorRow.children.length, 9, 'eight colors and Hero share one row');
        assert.equal(colorRow.children[8], hero, 'Hero is the compact trailing control');
        assert.equal(hero.textContent, '☆');
        hero.dispatchEvent({ type: 'click' });
      }
    }

    const amountInput = el.querySelector('[name="deg-amount"]');
    if (amountInput) amountInput.value = '0.01';
    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await settle(80);

    assert.equal(fake._calls.placeDegeneretteBet.length, 1, 'placeDegeneretteBet invoked once');
    const args = fake._calls.placeDegeneretteBet[0];
    // byte q = ((c&7)<<3)|(s&7): [13, 22, 31, 32] → LSB-first uint32.
    const expected = (13 | (22 << 8) | (31 << 16) | (32 << 24)) >>> 0;
    assert.equal(Number(args[4]), expected, 'customTicket packs [QQ][CCC][SSS] per byte, QQ=0');
    assert.equal(Number(args[5]), chosenHero, 'heroQuadrant comes from the integrated star control');
    el.disconnectedCallback();
  });

  test('resolve success launches the verified Degenerette result in the branded overlay', async () => {
    revealMod.__takeQueuedForTest();   // drop anything from earlier tests
    const el = instantiate();
    await settle(40);

    const amountInput = el.querySelector('[name="deg-amount"]');
    if (amountInput) amountInput.value = '0.01';
    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await settle(80);
    await runPendingDegeneretteAction();
    await settle(80);

    const [sequence] = revealMod.__takeQueuedForTest();
    assert.equal(sequence.kind, 'degenerette');
    assert.equal(sequence.spins.length, 1);
    assert.equal(sequence.spins[0].score, 4);
    assert.equal(sequence.currency, 0);
    assert.equal(el.querySelector('[data-bind="dgn-inline-spin"]'), null);
    assert.equal(el.querySelector('[data-bind="dgn-results-panel"]'), null);
    assert.equal(el.querySelector('[data-bind="deg-outcome"]').textContent, '');
    el.disconnectedCallback();
  });

  test('multi-spin resolution sends every distinct verified reel to the overlay', async (t) => {
    const originalMatchMedia = globalThis.window.matchMedia;
    t.after(() => { globalThis.window.matchMedia = originalMatchMedia; });
    globalThis.window.matchMedia = () => ({ matches: true });
    const rngWord = 0xabcdn;
    const playerTraits = 0x03020100;
    const houses = [0, 1].map((spinIdx) => dgnHouseTraits({
      rngWord,
      index: 7,
      spinIdx,
      currency: 0,
      playerTraits,
      heroQuadrant: 0,
    }));
    degeneretteMod.__setContractFactoryForTest(() => makeFakeDegContract({
      resolveLogs: (args) => [
        {
          parsed: {
            name: 'DegeneretteResolved',
            args: {
              player: args[0],
              betId: 42n,
              spinCount: 2,
              totalPayout: 5n * 10n ** 16n,
              resultTraits: BigInt(houses[0]),
            },
          },
        },
        {
          parsed: {
            name: 'DegeneretteResult',
            args: {
              player: args[0],
              betId: 42n,
              spinIndex: 0,
              playerTraits: BigInt(playerTraits),
              matches: dgnScore(playerTraits, houses[0], 0),
              payout: 5n * 10n ** 16n,
            },
          },
        },
        {
          parsed: {
            name: 'DegeneretteResult',
            args: {
              player: args[0],
              betId: 42n,
              spinIndex: 1,
              playerTraits: BigInt(playerTraits),
              matches: dgnScore(playerTraits, houses[1], 0),
              payout: 0n,
            },
          },
        },
      ],
    }));

    const el = instantiate();
    await settle(40);
    el.querySelector('[data-bind="dgn-cell-0"]').dispatchEvent({ type: 'contextmenu' });
    el.querySelector('[name="deg-amount"]').value = '0.01';
    el.querySelector('[name="deg-ticket-count"]').value = '2';
    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await settle(80);
    await runPendingDegeneretteAction();
    await settle(80);

    const [sequence] = revealMod.__takeQueuedForTest();
    assert.equal(sequence.kind, 'degenerette');
    assert.equal(sequence.spinCount, 2);
    assert.deepEqual(sequence.spins.map((row) => row.spinIndex), [0, 1]);
    assert.deepEqual(sequence.spins.map((row) => row.houseTraits), houses,
      'later spins retain their own RNG-derived house reels');
    assert.notEqual(sequence.spins[0].houseTraits, sequence.spins[1].houseTraits);
    assert.equal(el.querySelector('[data-bind="dgn-inline-spin"]'), null);

    el.disconnectedCallback();
  });

  test('an already-resolved bet replays exact chain events without sending a resolver tx', async (t) => {
    const originalMatchMedia = globalThis.window.matchMedia;
    t.after(() => { globalThis.window.matchMedia = originalMatchMedia; });
    globalThis.window.matchMedia = () => ({ matches: true });
    revealMod.__takeQueuedForTest();
    const packed = 13n | (1n << 32n) | ((10n ** 10n) << 42n);
    const calls = { info: [], resolve: 0, logs: [] };
    contractsMod.setProvider({
      ...makeFakeProvider(CONNECTED),
      getBlockNumber: async () => 5000,
    });
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async (...args) => makeFakeTx(makeFakeReceipt([
          {
            parsed: {
              name: 'BetPlaced',
              args: { player: args[0], index: 7n, betId: 42n, packed },
            },
          },
        ])),
        { staticCall: async () => undefined },
      ),
      degeneretteBetInfo: async (...args) => {
        calls.info.push(args);
        return 0n;
      },
      resolveDegeneretteBets: Object.assign(
        async () => {
          calls.resolve += 1;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      degeneretteResolve: Object.assign(
        async () => {
          calls.resolve += 1;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      filters: {
        DegeneretteResolved: (player, betId) => ({ event: 'resolved', player, betId }),
        DegeneretteResult: (player, betId) => ({ event: 'result', player, betId }),
      },
      queryFilter: async (filter, from, to) => {
        calls.logs.push({ filter, from, to });
        if (filter.event === 'resolved') {
          return [{
            args: {
              player: CONNECTED,
              betId: 42n,
              spinCount: 1,
              totalPayout: 5n * 10n ** 16n,
              resultTraits: 13n,
            },
          }];
        }
        return [{
          args: {
            player: CONNECTED,
            betId: 42n,
            spinIndex: 0,
            playerTraits: 13n,
            matches: 4,
            payout: 5n * 10n ** 16n,
          },
        }];
      },
      interface: { parseLog: (log) => log.parsed ?? null },
      connect() { return this; },
    }));
    lootboxMod.__setContractFactoryForTest(() => ({
      lootboxRngWordByIndex: async () => 0xabcdn,
      interface: { parseLog: () => null },
      connect() { return this; },
    }));
    _fetchHandler = async (url) => {
      if (String(url).includes('/degenerette/feed')) {
        return { items: [] };
      }
      return { player: null, pending: {} };
    };

    const el = instantiate();
    await settle(40);
    el.querySelector('[name="deg-amount"]').value = '0.01';
    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await settle(80);

    assert.deepEqual(calls.info, [[CONNECTED, 42n]]);
    assert.equal(calls.resolve, 0, 'the cleared bet slot never reaches a wallet write');
    assert.equal(calls.logs.length, 2, 'resolved summary and per-spin logs are queried');
    const [sequence] = revealMod.__takeQueuedForTest();
    assert.equal(sequence.kind, 'degenerette',
      'the recovered chain result launches through the same overlay path');
    assert.equal(sequence.spins.length, 1);
    assert.equal(sequence.spins[0].score, 4);
    assert.equal(el.querySelector('[data-bind="dgn-inline-spin"]'), null);
    assert.equal(el.querySelector('[data-bind="deg-outcome"]').textContent, '');
    assert.equal(pendingActionsMod.getPendingActions().length, 0);
    el.disconnectedCallback();
  });

  test('a stale Resolve click waits for indexed spins and opens them without a second tx or tap', async (t) => {
    const originalMatchMedia = globalThis.window.matchMedia;
    t.after(() => { globalThis.window.matchMedia = originalMatchMedia; });
    globalThis.window.matchMedia = () => ({ matches: true });
    revealMod.__takeQueuedForTest();

    const ready = readyFeedItem();
    const packed = BigInt(ready.packedData)
      | (305n << 202n)
      | (900n << 220n);
    ready.packedData = String(packed);
    const payout = 5n * 10n ** 16n;
    let feedCalls = 0;
    _fetchHandler = async (url) => {
      if (!String(url).includes('/degenerette/feed')) return { player: null, pending: {} };
      feedCalls += 1;
      if (feedCalls < 5) return { items: [ready] };
      return {
        items: [readyFeedItem({
          packedData: String(packed),
          results: [
            {
              resultType: 'resolved',
              transactionHash: '0xdegenerettebox',
              payout: String(payout),
              resultData: {
                spinCount: 1,
                totalPayout: String(payout),
                resultTraits: '13',
              },
            },
            {
              resultType: 'result',
              payout: String(payout),
              resultData: { spinIndex: 0, playerTraits: '13', matches: 4 },
            },
          ],
          lootboxPayouts: [{
            rewardType: 'opened',
            blockNumber: '5001',
            rewardData: {
              amount: String(3n * 10n ** 16n),
              futureLevel: 8,
              futureTickets: 200,
              flip: '0',
              roundedUp: false,
            },
          }, {
            rewardType: 'BoxSpin',
            blockNumber: '5001',
            transactionHash: '0xdegenerettebox',
            logIndex: 18,
            lootboxIndex: null,
            rewardData: {
              betId: String((1n << 63n) | (3n << 60n) | 101n),
              spinType: 'record',
              spinCount: 3,
              survived: false,
              payout: '0',
              ethShare: '0',
              reels: [
                { spinIndex: 0, playerTicket: '1', resultTicket: '2', score: 0 },
                {
                  spinIndex: 1,
                  playerTicket: String(0x04030201n),
                  resultTicket: String(0x07060509n),
                  score: 2,
                },
                { spinIndex: 2, playerTicket: '5', resultTicket: '6', score: 1 },
              ],
            },
          }],
        })],
      };
    };

    let infoReads = 0;
    let resolveWrites = 0;
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async (...args) => makeFakeTx(makeFakeReceipt([{
          parsed: {
            name: 'BetPlaced',
            args: { player: args[0], index: 7n, betId: 42n, packed },
          },
        }])),
        { staticCall: async () => undefined },
      ),
      degeneretteBetInfo: async () => {
        infoReads += 1;
        return infoReads === 1 ? packed : 0n;
      },
      resolveDegeneretteBets: Object.assign(
        async () => {
          resolveWrites += 1;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      degeneretteResolve: Object.assign(
        async () => {
          resolveWrites += 1;
          return makeFakeTx(makeFakeReceipt());
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect() { return this; },
    }));

    const el = instantiate();
    await settle(30);
    el.querySelector('[name="deg-amount"]').value = '0.01';
    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await settle(80);
    assert.equal(pendingActionsMod.getPendingActions()[0]?.state, 'ready');

    await runPendingDegeneretteAction();
    await settle(80);

    assert.equal(resolveWrites, 0, 'the cleared slot never opens a second wallet transaction');
    assert.ok(feedCalls >= 6, 'the clicked action keeps following the exact bet until its spins arrive');
    const [sequence, recordSequence, lootboxSequence] = revealMod.__takeQueuedForTest();
    assert.equal(sequence?.kind, 'degenerette');
    assert.equal(sequence?.betId, '42');
    assert.equal(sequence?.spins?.length, 1);
    assert.equal(sequence?.lootboxAwarded, true,
      'the spin result visibly records its recirculated lootbox win');
    assert.equal(sequence?.lootboxEth, 3n * 10n ** 16n,
      'the direct opened leg is retained for the actual-ETH/lootbox-ETH split');
    assert.equal(recordSequence?.kind, 'record-bounty');
    assert.equal(recordSequence?.spin?.spinType, 'record');
    assert.equal(recordSequence?.spin?.payout, 0n,
      'a zero final payout cannot suppress the authored record-bounty reels');
    assert.equal(recordSequence?.spin?.recordStake, 900n * 10n ** 18n,
      'the parent packed bet carries the bounty stake into its losing reel reveal');
    assert.equal(recordSequence?.spin?.activityScore, 305);
    const normalizedRecord = revealMod.normalizeSequence(recordSequence);
    assert.equal(normalizedRecord?.noVessel, true,
      'the record bounty goes straight to its reel board without a Luckbox case');
    assert.equal(normalizedRecord?.spinBoard?.rows?.length, 3);
    assert.equal(normalizedRecord?.spinBoard?.currencyKnown, true);
    assert.ok(normalizedRecord?.spinBoard?.payoutAtRisk > 0n,
      'a final survival bust still names the FLIP value produced by its reels');
    assert.equal(lootboxSequence?.kind, 'lootbox');
    assert.equal(lootboxSequence?.title, 'DEGENERETTE LUCKBOX');
    assert.equal(lootboxSequence?.settledExpected, true,
      'an auto-resolved fractional-only box still has a visible result');
    assert.notEqual(lootboxSequence?.noVessel, true,
      'the one OPEN LOOTBOX click auto-starts the case animation before the receipt');
    assert.deepEqual(lootboxSequence?.lootboxRelease, {
      address: CONNECTED.toLowerCase(),
      key: 'tx:0xdegenerettebox',
      lootboxIndex: 0,
      transactionHash: '0xdegenerettebox',
    }, 'the direct box and pending tray share one settlement identity');
    assert.deepEqual(lootboxSequence?.legs?.map((leg) => leg.legType), ['opened'],
      'types 0-2 and real opened rewards remain in the genuine Luckbox sequence');
    assert.equal(el.querySelector('.deg-error').hidden, true,
      'indexing lag is not presented as a failed resolve');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the automatically displayed result retires the stale action');
    el.disconnectedCallback();
  });

  test('an indexing Degenerette result stays clickable and opens once verified spins arrive', async () => {
    revealMod.__takeQueuedForTest();
    const storageKey = `pending-degenerette:${CHAIN.id}:${CHAIN.deployBlock}:${CONNECTED.toLowerCase()}`;
    const packed = 13n | (1n << 32n) | ((10n ** 10n) << 42n);
    localStorage.setItem(storageKey, JSON.stringify({
      betId: '42',
      index: '7',
      currency: 0,
      amountPerSpin: String(10n ** 10n),
      spinCount: 1,
      hero: 0,
      ticket: '13',
    }));

    let complete = false;
    const resolved = {
      resultType: 'resolved',
      payout: String(5n * 10n ** 16n),
      resultData: {
        spinCount: 1,
        totalPayout: String(5n * 10n ** 16n),
        resultTraits: '13',
      },
    };
    useDegeneretteFeed(() => readyFeedItem({
      packedData: String(packed),
      results: complete
        ? [
            resolved,
            {
              resultType: 'result',
              payout: String(5n * 10n ** 16n),
              resultData: { spinIndex: 0, playerTraits: '13', matches: 4 },
            },
          ]
        : [resolved],
      resultTickets: complete ? [{ spinIndex: 0, resultTicket: '13' }] : [],
    }));
    degeneretteMod.__setContractFactoryForTest(() => ({
      degeneretteBetInfo: async () => 0n,
      connect() { return this; },
    }));

    const el = instantiate();
    await settle(80);
    const action = pendingActionsMod.getPendingActions()
      .find((row) => row.kind === 'degenerette');
    assert.equal(action?.phase, 'indexing');
    assert.equal(action?.state, 'ready');
    assert.equal(action?.shortLabel, 'Open spins');
    assert.equal(typeof action?.run, 'function',
      'an on-chain-resolved result never becomes a dead grey card');

    complete = true;
    await action.run();
    await settle(80);
    const [sequence] = revealMod.__takeQueuedForTest();
    assert.equal(sequence?.kind, 'degenerette');
    assert.equal(sequence?.betId, '42');
    assert.equal(sequence?.spins?.length, 1);
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the Pending row retires only after its reveal is accepted');
    assert.equal(localStorage.getItem(storageKey), null);
    el.disconnectedCallback();
  });

  // normalizeSequence coverage for the board lives in reveal-overlay.test.js.

  test('the obsolete Results button is gone; resolved rounds surface through the tray', () => {
    const el = instantiate();
    assert.equal(el.querySelector('[data-bind="deg-results-cta"]'), null);
    assert.doesNotMatch(el.innerHTML, /<button[^>]*deg-results-cta/,
      'there is no separate Results launcher competing with the bottom tray');
    el.disconnectedCallback();
  });

  test('feed fragments for one bet merge without dropping later spin indexes', async () => {
    const { mergeDegeneretteFeedItems } = await import('../app-degenerette-panel.js');
    const base = { player: CONNECTED, betId: '88', betIndex: 4, packedData: '1' };
    const merged = mergeDegeneretteFeedItems([
      {
        ...base,
        results: [
          { resultType: 'resolved', resultData: { spinCount: 3, resultTraits: '9' } },
          { resultType: 'result', resultData: { spinIndex: 0, playerTraits: '1' } },
        ],
      },
      {
        ...base,
        results: [
          { resultType: 'result', resultData: { spinIndex: 1, playerTraits: '1' } },
          { resultType: 'result', resultData: { spinIndex: 2, playerTraits: '1' } },
        ],
      },
    ]);
    assert.equal(merged.length, 1, 'same player+betId becomes one round');
    assert.deepEqual(
      merged[0].results
        .filter((row) => row.resultType === 'result')
        .map((row) => Number(row.resultData.spinIndex))
        .sort((a, b) => a - b),
      [0, 1, 2],
    );
  });

  test('feed fragments merge one payout event once as metadata fills in', async () => {
    const { mergeDegeneretteFeedItems } = await import('../app-degenerette-panel.js');
    const base = { player: CONNECTED, betId: '89', betIndex: 4, packedData: '1' };
    const payout = {
      rewardType: 'BoxSpin',
      transactionHash: '0xshared-payout',
      logIndex: 18,
      rewardData: {
        betId: String((1n << 63n) | (1n << 60n) | 7n),
        spinType: 'flip',
        payout: '200',
        reels: [{ spinIndex: 0, playerTicket: '1', resultTicket: '2', score: 2 }],
      },
    };
    const [merged] = mergeDegeneretteFeedItems([
      { ...base, lootboxPayouts: [payout] },
      { ...base, lootboxPayouts: [{ ...payout, blockNumber: '5001' }] },
    ]);

    assert.equal(merged.lootboxPayouts.length, 1,
      'the same transaction/log child cannot become two BoxSpin sequences');
    assert.equal(merged.lootboxPayouts[0].blockNumber, '5001',
      'the more complete projection still wins');
  });

  test('a resolved summary cannot shorten a round while later spin rows are still arriving', async () => {
    const { normalizeDegeneretteSpinResults } = await import('../app-degenerette-panel.js');
    const row = (spinIndex) => ({
      resultType: 'result',
      payout: String(spinIndex),
      resultData: { spinIndex, playerTraits: '13', matches: spinIndex },
    });
    const partial = normalizeDegeneretteSpinResults([row(2), row(0)], 3, {
      player: CONNECTED,
      betId: 88n,
    });
    assert.equal(partial.complete, false);
    assert.deepEqual(partial.missingSpinIndexes, [1]);

    const complete = normalizeDegeneretteSpinResults([row(2), row(0), row(1)], 3, {
      player: CONNECTED,
      betId: 88n,
    });
    assert.equal(complete.complete, true);
    assert.deepEqual(complete.spins.map((spin) => Number(spin.spinIndex)), [0, 1, 2]);
  });

  test('player history follows the cursor when an older API worker ignores player filtering', async () => {
    const foreign = '0xffff000000000000000000000000000000000001';
    const urls = [];
    _fetchHandler = async (url) => {
      const path = String(url);
      urls.push(path);
      if (path.includes('before=100')) {
        return {
          items: [readyFeedItem({
            id: 99,
            betId: '88',
            results: [{ resultType: 'resolved', resultData: { spinCount: 1 } }],
          })],
          nextCursor: null,
        };
      }
      return {
        items: [readyFeedItem({ id: 101, player: foreign, betId: '1' })],
        nextCursor: 100,
      };
    };
    const { fetchDegenerettePlayerFeed } = await import('../app-degenerette-panel.js');
    const items = await fetchDegenerettePlayerFeed(CONNECTED, {
      targetResolved: 1,
      maxPages: 3,
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].betId, '88');
    assert.equal(urls.length, 2);
    assert.match(urls[1], /before=100/);
  });

  // Account-switcher (2026-07-16) — WWXRP operator-mode gate.
  test('operator mode disables the WWXRP option + shows the note; reselecting self clears it', async () => {
    const OWNER = '0xcccc000000000000000000000000000000000003';
    const el = instantiate();
    await settle(10);

    const sel = el.querySelector('[name="deg-currency"]');
    const note = el.querySelector('[data-bind="deg-wwxrp-note"]');
    const wwxrpOpt = el.querySelector('[data-bind="deg-currency-wwxrp"]');
    assert.equal(wwxrpOpt.disabled, false, 'WWXRP enabled in self mode');
    assert.equal(note.hidden, true, 'note hidden in self mode');

    storeMod.update('approvals.list', [OWNER]);
    storeMod.update('viewing.address', OWNER);
    storeMod.update('ui.mode', 'operator');
    await settle(10);

    assert.equal(wwxrpOpt.disabled, true, 'WWXRP disabled in operator mode');
    assert.equal(note.hidden, false, 'note visible in operator mode');

    // A pre-selected WWXRP choice reverts to ETH so an in-flight draft
    // doesn't stay pinned on an unplaceable currency.
    sel.value = '3';
    storeMod.update('ui.mode', 'self');
    await settle(10);
    storeMod.update('ui.mode', 'operator');
    await settle(10);
    assert.equal(sel.value, '0', 'WWXRP selection auto-reverted to ETH on operator-mode gate');

    el.disconnectedCallback();
  });

  test('combined mode does not poll obsolete Degenerette history', async () => {
    const APPROVER = '0xdddd000000000000000000000000000000000004';
    let feedFetched = false;
    _fetchHandler = async (url) => {
      if (String(url).includes('/degenerette/feed')) feedFetched = true;
      return { player: null, pending: {} };
    };
    storeMod.update('approvals.list', [APPROVER]);
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');

    const el = instantiate();
    await settle(20);
    assert.equal(feedFetched, false, '/degenerette/feed never fetched in combined mode');
    assert.equal(el.querySelector('[data-bind="deg-results-cta"]'), null);

    el.disconnectedCallback();
  });
});
