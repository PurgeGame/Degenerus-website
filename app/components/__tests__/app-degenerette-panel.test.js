// /app/components/__tests__/app-degenerette-panel.test.js — Phase 62 Plan 62-03 (BUY-05)
// Run: cd website && node --test app/components/__tests__/app-degenerette-panel.test.js
//
// Tests <app-degenerette-panel> Custom Element: two-stage state machine
// (idle → placing → awaitingRng → ready → resolving → resolved) + RNG poll
// reusing Phase 60 pollRngForLootbox + Place + Resolve CTAs both with
// data-write attribute + currency picker omits WWXRP (Q7) + outcome rendered
// inline via textContent (CF-08, no toast/audio/animator).

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
        if (valueMatch) child.attributes.value = valueMatch[1];
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
import * as degeneretteMod from '../../app/degenerette.js';
import * as lootboxMod from '../../app/lootbox.js';
import * as contractsMod from '../../app/contracts.js';

const PANEL_SRC = readFileSync(
  new URL('../app-degenerette-panel.js', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// Fake contract harness
// ---------------------------------------------------------------------------

function makeFakeReceipt(logs) { return { status: 1, hash: '0xreceipt', logs: logs || [] }; }
function makeFakeTx(receipt) { return { hash: '0xtx', wait: async () => receipt }; }

// Default fake contract: place returns BetPlaced(index=7, betId=42); resolve
// returns FullTicketResolved(totalPayout=5e16) + FullTicketResult.
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
        return makeFakeTx(makeFakeReceipt([
          {
            parsed: {
              name: 'FullTicketResolved',
              args: {
                player: args[0],
                betId: 42n,
                ticketCount: 1,
                totalPayout: 5n * 10n ** 16n,
                resultTicket: 1234n,
              },
            },
          },
          {
            parsed: {
              name: 'FullTicketResult',
              args: {
                player: args[0],
                betId: 42n,
                ticketIndex: 0,
                playerTicket: 1234n,
                matches: 4,
                payout: 5n * 10n ** 16n,
              },
            },
          },
        ]));
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
    getNetwork: async () => ({ chainId: 11155111n }),
    getSigner: async () => ({ getAddress: async () => addr }),
  };
}

const CONNECTED = '0xab12000000000000000000000000000000000000';

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
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider(CONNECTED));
    degeneretteMod.__setContractFactoryForTest(() => makeFakeDegContract());
    // Default lootbox stub returns 0n (RNG not ready) — tests override per-case.
    lootboxMod.__setContractFactoryForTest(() => ({
      lootboxRngWord: async () => 0n,
      interface: { parseLog: () => null },
      connect(_s) { return this; },
    }));
    await import('../app-degenerette-panel.js');
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
    const placeCta = el.querySelector('.deg-place-cta');
    assert.ok(placeCta, 'Place CTA rendered');
    const resolveCta = el.querySelector('.deg-resolve-cta');
    assert.ok(resolveCta, 'Resolve CTA rendered');
    // Resolve initially disabled until RNG ready.
    assert.equal(resolveCta.disabled, true, 'Resolve CTA initially disabled');
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
    degeneretteMod.__setContractFactoryForTest(() => ({
      placeDegeneretteBet: Object.assign(
        async (...args) => {
          recordedArgs = args;
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

    el.disconnectedCallback();
  });

  test('RNG poll invokes pollRngForLootbox; state transitions to ready when non-zero', async () => {
    let pollCalls = 0;
    lootboxMod.__setContractFactoryForTest(() => ({
      lootboxRngWord: async () => {
        pollCalls += 1;
        // Return non-zero on first poll to keep test fast (panel polls on a
        // 7s interval — we override to resolve immediately).
        return 0xabcdn;
      },
      interface: { parseLog: () => null },
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

    // After place + first poll cycle, RNG ready → state transitions to ready.
    assert.ok(pollCalls >= 1, `pollRngForLootbox called at least once (got ${pollCalls})`);
    const resolveCta = el.querySelector('.deg-resolve-cta');
    assert.equal(resolveCta.disabled, false, 'Resolve CTA enabled when RNG ready');

    el.disconnectedCallback();
  });

  test('Resolve click invokes resolveBets with the parsed betId', async () => {
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
                name: 'FullTicketResolved',
                args: { player: args[0], betId: 42n, ticketCount: 1, totalPayout: 5n * 10n ** 16n, resultTicket: 1234n },
              },
            },
          ]));
        },
        { staticCall: async () => undefined },
      ),
      interface: { parseLog: (log) => log.parsed ?? null },
      connect(_s) { return this; },
    }));
    lootboxMod.__setContractFactoryForTest(() => ({
      lootboxRngWord: async () => 0xabcdn,  // RNG ready immediately.
      interface: { parseLog: () => null },
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

    el.disconnectedCallback();
  });

  test('Outcome rendered inline via textContent — `You won X` (CF-08, no toast/audio/animator)', async () => {
    lootboxMod.__setContractFactoryForTest(() => ({
      lootboxRngWord: async () => 0xabcdn,
      interface: { parseLog: () => null },
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

    const outcomeEl = el.querySelector('.deg-outcome');
    assert.ok(outcomeEl, '.deg-outcome present');
    assert.match(
      outcomeEl.textContent,
      /you won|you lost/i,
      'outcome textContent populated with You won X / You lost (CF-08)',
    );

    el.disconnectedCallback();
  });

  test('Currency picker only shows ETH + BURNIE — NO WWXRP option (RESEARCH Q7)', () => {
    const el = instantiate();
    // Source-grep: the currency-select element must not expose currency 3 (WWXRP).
    // We isolate the deg-currency-select <select>...</select> block and
    // assert no value="3" option inside it. (Other selects, e.g.
    // ticket-count, legitimately use value="3" for "3 tickets".)
    const currencyBlockMatch = PANEL_SRC.match(/<select[^>]*name="deg-currency"[\s\S]*?<\/select>/);
    assert.ok(currencyBlockMatch, 'deg-currency select block found in panel source');
    const currencyBlock = currencyBlockMatch[0];
    assert.doesNotMatch(currencyBlock, /value="3"/, 'currency select must not have value="3" option (WWXRP)');
    assert.doesNotMatch(currencyBlock, /WWXRP/i, 'currency select must not mention WWXRP');
    // Defense-in-depth: live DOM check.
    const currencySel = el.querySelector('[name="deg-currency"]');
    assert.ok(currencySel, 'currency select rendered');
    const opts = currencySel.querySelectorAll('option');
    for (const o of opts) {
      const v = o.attributes.value;
      assert.notEqual(v, '3', `currency option must not be value=3 (got ${v})`);
    }
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

  test('NO toast/audio/animator (CF-08 verbatim)', () => {
    assert.doesNotMatch(
      PANEL_SRC,
      /\btoast\(|playAudio|audio\.play|new Audio\(|requestAnimationFrame.*reveal/,
      'panel source must not contain celebration toast / audio / animator code',
    );
  });

  test('Imports pollRngForLootbox from lootbox.js (RESEARCH R5 OPTION B)', () => {
    assert.match(
      PANEL_SRC,
      /import\s+\{[^}]*pollRngForLootbox[^}]*\}\s*from\s*['"]\.\.\/app\/lootbox\.js['"]/,
      'panel imports pollRngForLootbox from lootbox.js',
    );
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
