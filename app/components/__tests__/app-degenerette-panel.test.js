// /app/components/__tests__/app-degenerette-panel.test.js — Phase 62 Plan 62-03 (BUY-05)
// Run: cd website && node --test app/components/__tests__/app-degenerette-panel.test.js
//
// Tests <app-degenerette-panel> Custom Element: two-stage state machine
// (idle → placing → awaitingRng → ready → resolving → resolved) + RNG poll
// reusing Phase 60 pollRngForLootbox + Place + Resolve CTAs both with
// data-write attribute + supported currency picker + outcome rendered inline
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

  test('Panel renders 2-stage shell with Place CTA + Resolve CTA (initially disabled)', () => {
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
    const placeCta = el.querySelector('.deg-place-cta');
    assert.ok(placeCta, 'Place CTA rendered');
    const resolveCta = el.querySelector('.deg-resolve-cta');
    assert.ok(resolveCta, 'Resolve CTA rendered');
    // Resolve initially disabled until RNG ready.
    assert.equal(resolveCta.disabled, true, 'Resolve CTA initially disabled');
  });

  test('ticket builder comes first and the readable wager uses logo currency choices', () => {
    const ticketAt = PANEL_SRC.indexOf('deg-block deg-block--ticket');
    const wagerAt = PANEL_SRC.indexOf('deg-block deg-block--wager');
    assert.ok(ticketAt >= 0 && wagerAt > ticketAt,
      'ticket builder precedes wager in visual and keyboard order');
    assert.doesNotMatch(PANEL_SRC, /deg-block__step/, 'numbered setup labels are removed');
    assert.match(PANEL_SRC, /aria-label="Wager currency"/);
    assert.match(PANEL_SRC, /aria-label="Bet per spin"/);
    assert.match(PANEL_SRC, /aria-label="Number of spins"/);
    assert.match(PANEL_SRC, /\/badges-circular\/crypto_06_ethereum_blue\.svg/,
      'ETH uses the blue circular Degenerus trait badge');
    assert.match(PANEL_SRC, /\/whitepaper\/flame-logo\.svg/);
    assert.match(PANEL_SRC, /\/shared\/coinflip-face-red\.svg/);
    const placeAt = PANEL_SRC.indexOf('class="deg-place-cta"', wagerAt);
    const wagerEnd = PANEL_SRC.indexOf('</section>', wagerAt);
    assert.ok(placeAt > wagerAt && placeAt < wagerEnd,
      'Place bet is owned by and sits below the wager controls');
    assert.match(PANEL_SRC, /deg-wager-field__label">Bet per spin/);
    assert.match(PANEL_SRC, /deg-wager-field__label">Spins/);
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
      APP_CSS,
      /\.deg-block \.dgn-symbol-btn img\s*\{[^}]*width:\s*138%[^}]*height:\s*138%/s,
      'badge ring fills roughly 95% of each smaller picker cell',
    );
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
    assert.ok(el.querySelector('[data-bind="dgn-cell-0"]').classList.contains('q-hero'));
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

  test('Degenerette quest clicks select the currency and exact total without betting', () => {
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
    el.disconnectedCallback();
  });

  test('Both Place + Resolve buttons have data-write attribute (CF-15)', () => {
    const el = instantiate();
    const place = el.querySelector('.deg-place-cta');
    const resolve = el.querySelector('.deg-resolve-cta');
    assert.ok(place && place.attributes['data-write'] !== undefined, 'Place has data-write');
    assert.ok(resolve && resolve.attributes['data-write'] !== undefined, 'Resolve has data-write');
  });

  test('Place click invokes placeBet then enters awaitingRng state', async () => {
    let recordedArgs = null;
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
      resolveDegeneretteBets: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
        { staticCall: async () => undefined },
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
    // State transitions to awaitingRng — verify visible state element shows that.
    const stateEl = el.querySelector('.deg-state');
    assert.ok(stateEl, 'state display element rendered');
    assert.match(
      stateEl.textContent.toLowerCase(),
      /awaiting rng|waiting/,
      'state surfaces awaitingRng',
    );
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

    assert.deepEqual(reads, [[CONNECTED.toLowerCase(), 42n]],
      'the DB identifier is verified against the pending on-chain slot');
    const [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.id, 'degenerette:42');
    assert.equal(pending.label, 'Degenerette · 5 spins');
    assert.equal(pending.state, 'waiting');
    assert.match(el.querySelector('.deg-state').textContent, /Awaiting RNG/i);
    const stored = JSON.parse(localStorage.getItem(
      `pending-degenerette:84532:${CONNECTED.toLowerCase()}`,
    ));
    assert.deepEqual(stored, {
      betId: '42',
      index: '7',
      currency: 1,
      amountPerSpin: String(amountPerSpin),
      spinCount: 5,
      hero: 2,
    }, 'the recovered bet is durable across another refresh');
    assert.doesNotMatch(PANEL_SRC, /manual resolve required/i);

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
    const resolveCta = el.querySelector('.deg-resolve-cta');
    assert.equal(resolveCta.disabled, false, 'Resolve CTA enabled when RNG ready');
    const [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.state, 'ready');
    assert.equal(typeof pending.run, 'function',
      'the shared widget delegates to the panel resolve path');

    el.disconnectedCallback();
  });

  test('Resolve click invokes resolveBets with the parsed betId', async () => {
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

    const resolveCta = el.querySelector('.deg-resolve-cta');
    resolveCta.dispatchEvent({ type: 'click' });
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

    const resolveCta = el.querySelector('.deg-resolve-cta');
    resolveCta.dispatchEvent({ type: 'click' });
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
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async (...args) => {
          placeCalls += 1;
          return makeFakeTx(makeFakeReceipt([
            { parsed: { name: 'BetPlaced', args: { player: args[0], index: 7n, betId: 42n, packed: 0n } } },
          ]));
        },
        { staticCall: async () => undefined },
      ),
      resolveDegeneretteBets: Object.assign(
        async () => makeFakeTx(makeFakeReceipt()),
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
    placeBtn.dispatchEvent({ type: 'click' });
    await settle(60);

    assert.equal(placeCalls, 1, 'double-click invokes placeDegeneretteBet exactly once');

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
    assert.doesNotMatch(PANEL_SRC, /<section class="dgn-inline-spin"/,
      'the widget no longer mounts its own reel player');
    assert.doesNotMatch(PANEL_SRC, /<section class=\"dgn-results-summary\"/,
      'the widget no longer mounts a duplicate result summary');
  });

  test('reads the player-filtered DB feed first and keeps a chain-read recovery path', () => {
    assert.match(
      PANEL_SRC,
      /\/degenerette\/feed\?limit=200&player=/,
      'panel polls the durable player-filtered feed',
    );
    assert.match(PANEL_SRC, /pollRngForLootbox/,
      'a stale/lagging API cannot strand a fulfilled bet in Awaiting RNG');
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

  test('editor drives the packed customTicket + heroQuadrant passed to placeDegeneretteBet', async () => {
    const fake = makeFakeDegContract();
    degeneretteMod.__setContractFactoryForTest(() => fake);
    const el = instantiate();
    await settle(40);

    // Set (color, symbol) per quadrant via editor buttons: c=[1,2,3,4], s=[5,6,7,0].
    const colors = [1, 2, 3, 4];
    const symbols = [5, 6, 7, 0];
    for (let q = 0; q < 4; q += 1) {
      el.querySelector(`[data-bind="dgn-cell-${q}"]`).dispatchEvent({ type: 'click' });
      // Editor rebuilds after every click — re-query buttons each time.
      el.querySelector('[data-bind="dgn-editor"]')
        .querySelectorAll('.dgn-color-btn')[colors[q]].dispatchEvent({ type: 'click' });
      el.querySelector('[data-bind="dgn-editor"]')
        .querySelectorAll('.dgn-symbol-btn')[symbols[q]].dispatchEvent({ type: 'click' });
    }
    // Hero via right-click on quadrant 2.
    el.querySelector('[data-bind="dgn-cell-2"]').dispatchEvent({ type: 'contextmenu' });

    const amountInput = el.querySelector('[name="deg-amount"]');
    if (amountInput) amountInput.value = '0.01';
    el.querySelector('.deg-place-cta').dispatchEvent({ type: 'click' });
    await settle(80);

    assert.equal(fake._calls.placeDegeneretteBet.length, 1, 'placeDegeneretteBet invoked once');
    const args = fake._calls.placeDegeneretteBet[0];
    // byte q = ((c&7)<<3)|(s&7): [13, 22, 31, 32] → LSB-first uint32.
    const expected = (13 | (22 << 8) | (31 << 16) | (32 << 24)) >>> 0;
    assert.equal(Number(args[4]), expected, 'customTicket packs [QQ][CCC][SSS] per byte, QQ=0');
    assert.equal(Number(args[5]), 2, 'heroQuadrant from right-click');
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
    el.querySelector('.deg-resolve-cta').dispatchEvent({ type: 'click' });
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
    el.querySelector('.deg-resolve-cta').dispatchEvent({ type: 'click' });
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
    el.querySelector('.deg-resolve-cta').dispatchEvent({ type: 'click' });
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
