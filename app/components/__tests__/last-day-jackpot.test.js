// /app/components/__tests__/last-day-jackpot.test.js — Phase 59 Plan 59-01 (JKP-03)
// Run: cd website && node --test app/components/__tests__/last-day-jackpot.test.js
//
// Tests Custom Element registration + 3-status branch render scaffolding.
// Plan 59-02 extends with subscribe-driven render tests.
// Plan 59-03 extends with localStorage idempotency + banner + highlight tests.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM (mirrors view-mode-banner.test.js fake-DOM scaffolding)
// + globalThis.localStorage shim (forward-compat with Plan 59-03 idempotency tests).
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
      // Crude parse: extract elements with id, data-bind, class, and style attrs
      // so querySelector can find them. Elements are flat children (no nesting tree
      // — but querySelector walks the flat list, which is sufficient for the
      // Plan 59-01 tests since each data-bind hook is unique).
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

// ---------------------------------------------------------------------------
// Fake document + globalThis stubs — installed BEFORE dynamic import of the
// component (which needs HTMLElement at module-load time for class extends).
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
  removeEventListener: (type, fn) => {
    const arr = _docListeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  },
  dispatchEvent: (ev) => {
    const arr = _docListeners.get(ev?.type) || [];
    for (const fn of [...arr]) {
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

// localStorage shim — forward-compat with Plan 59-03 idempotency tests.
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

// Plan 59-01 widget does NOT call fetch (factory's runRoll1 is unreachable while
// #pinnedDay is null; button stays disabled). Stub for safety.
globalThis.fetch = async () => { throw new Error('fetch should not be called in Plan 59-01 tests'); };

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.localStorage.clear();
  _docListeners.clear();
}

async function flushMicrotasks() {
  // A day summary fans through viewer + pack reads and then (when boxes were
  // opened) a dependent leg-feed read. Drain the complete promise chain so a
  // click test cannot leak its in-flight summary lock into the next case.
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Imports under test — store.js is safe to static-import (no HTMLElement use).
// last-day-jackpot.js is dynamic-imported inside beforeEach so the FakeHTMLElement
// stub is installed BEFORE the class declaration runs (ESM static imports hoist
// above the `globalThis.HTMLElement = ...` assignment above).
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';
import * as coinflipMod from '../../app/coinflip.js';
import * as pendingActionsMod from '../../app/pending-actions.js';
import { CHAIN } from '../../app/chain-config.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('the host does not add day-wide confetti over a losing scratch phase', () => {
  const src = readFileSync(new URL('../last-day-jackpot.js', import.meta.url), 'utf8');
  const handler = src.match(/#onPanelScratchComplete\(e\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.doesNotMatch(handler, /#fireConfetti|canvas-confetti/);
  assert.doesNotMatch(src, /import\(['"]canvas-confetti['"]\)/,
    'the replay board is the sole, phase-aware owner of jackpot scratch confetti');
});

describe("Plan 59-01: <last-day-jackpot> Custom Element shell", () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    // Dynamic-import (cached after first call) — registers the Custom Element
    // via module-bottom idempotency-guarded customElements.define.
    await import('../last-day-jackpot.js');
  });

  test("Custom Element 'last-day-jackpot' is registered after import", () => {
    const ctor = customElements.get('last-day-jackpot');
    assert.ok(ctor, 'last-day-jackpot is registered');
    assert.equal(ctor.name, 'LastDayJackpot');
  });

  test('Class instantiation does not throw', () => {
    const Ctor = customElements.get('last-day-jackpot');
    assert.doesNotThrow(() => new Ctor());
  });

  test('connectedCallback renders innerHTML scaffold without throwing', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    assert.doesNotThrow(() => el.connectedCallback());
    await flushMicrotasks();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
  });

  test('innerHTML scaffold contains all required data-bind hooks', () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    // The spin/scratch reveal is the sibling <replay-panel>; the shell carries
    // only the day pin/banner. Foil claims now live in the shared pending tray.
    const required = [
      'ldj-status-cold-start',
      'ldj-status-empty-day',
      'ldj-status-resolved',
      'ldj-new-day-banner',
      'day',
    ];
    for (const hook of required) {
      assert.ok(
        el.querySelector(`[data-bind="${hook}"]`),
        `data-bind="${hook}" present`,
      );
    }
  });

  test('Cold-start copy is suppressed by default so loading cannot shift the board', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    assert.ok(cold, 'cold-start section exists');
    assert.equal(cold.style.display, 'none', 'large cold-start copy stays out of layout');
    assert.doesNotMatch(el.innerHTML, /Game starts soon/i);
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    assert.ok(empty, 'empty-day section exists');
    assert.equal(
      empty.style.display, 'none',
      'empty-day hidden by default',
    );
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.ok(resolved, 'resolved section exists');
    assert.equal(
      resolved.style.display, 'none',
      'resolved hidden by default',
    );
  });

  test('disconnectedCallback flushes #unsubs without throwing', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    await flushMicrotasks();
    assert.doesNotThrow(() => el.disconnectedCallback());
  });
});

// ===========================================================================
// Plan 59-02: app.lastDay subscriber + status branch dispatch + pin-dayId
// ===========================================================================

describe('Plan 59-02: app.lastDay subscriber + status branch dispatch', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function instantiate() {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  test('status:pre-game payload keeps large cold-start copy hidden', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', { day: null, status: 'pre-game' });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.ok(cold, 'cold-start section exists');
    assert.equal(cold.style.display, 'none', 'cold-start copy cannot move the jackpot');
    assert.equal(empty.style.display, 'none', 'empty-day hidden');
    assert.equal(resolved.style.display, 'none', 'resolved hidden');
  });

  test('status:resolved-no-winners payload → empty-day visible with day-N copy + day label updated', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', {
      day: 5, level: 2, summary: null, winners: [],
      roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.equal(cold.style.display, 'none', 'cold-start hidden');
    assert.notEqual(empty.style.display, 'none', 'empty-day visible');
    assert.equal(resolved.style.display, 'none', 'resolved hidden');
    const copy = el.querySelector('[data-bind="ldj-empty-copy"]');
    assert.match(copy.textContent, /Day 5 had no winners/, 'day-5 copy present');
    assert.match(copy.textContent, /day 6/, 'rolled-to-day-6 copy present');
    const dayLbl = el.querySelector('[data-bind="day"]');
    assert.match(dayLbl.textContent, /Day 5/);
  });

  test('status:resolved payload → resolved section visible + day label set + winners cached', async () => {
    const el = instantiate();
    const winner = {
      address: '0xab12000000000000000000000000000000000000',
      totalEth: '1000000000000000000',  // 1 ETH
      ticketCount: 100,
      coinTotal: '0',
      bafPrize: { eth: '0', tickets: 0 },
      decimatorPrize: { regularEth: '0', lootboxEth: '0', terminalEth: '0' },
    };
    storeMod.update('app.lastDay', {
      day: 7, level: 2, summary: null, winners: [winner],
      roll1: { day: 7, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 7, level: 2, purchaseLevel: null, wins: [], bonusTraitsPacked: null },
      status: 'resolved',
    });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.equal(cold.style.display, 'none', 'cold-start hidden');
    assert.equal(empty.style.display, 'none', 'empty-day hidden');
    assert.notEqual(resolved.style.display, 'none', 'resolved visible');
    const dayLbl = el.querySelector('[data-bind="day"]');
    assert.match(dayLbl.textContent, /Day 7/);
  });

  test('first payload pins day; same-day refresh stays put; genuinely newer day auto-renders', async () => {
    const el = instantiate();
    // First payload: pin to day 5 empty-day
    storeMod.update('app.lastDay', {
      day: 5, level: 2, summary: null, winners: [],
      roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 5/, 'first payload pins day 5');

    // Second payload: same day → re-render in place (still day 5)
    storeMod.update('app.lastDay', {
      day: 5, level: 2, summary: null, winners: [],
      roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 5/, 'same-day refresh keeps day 5');

    // Third payload: newer day 6 → switch the whole widget automatically.
    storeMod.update('app.lastDay', {
      day: 6, level: 2, summary: null, winners: [],
      roll1: { day: 6, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 6, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 6/,
      'body automatically follows the new resolved day');
  });

  test('deployment mismatch clears the old run high-water mark so a lower new-run day renders', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', {
      day: 172, level: 43, summary: null, winners: [],
      roll1: { day: 172, level: 43, purchaseLevel: null, wins: [] },
      roll2: { day: 172, level: 43, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 172/);

    storeMod.update('app.deploymentMismatch', {
      surface: 'jackpot', expectedDeployBlock: 44_963_297,
      observedStartBlock: '44956000', observedDay: 172,
    });
    await flushMicrotasks();
    assert.equal(el.querySelector('[data-bind="day"]').textContent, 'SYNC');

    storeMod.update('app.deploymentMismatch', null);
    storeMod.update('app.lastDay', {
      day: 10, level: 2, summary: null, winners: [],
      roll1: { day: 10, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 10, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 10/,
      'new deployment can restart its logical day numbering');
    el.disconnectedCallback();
  });

  test('null/undefined payload does not throw + leaves the stable loading scaffold', async () => {
    const el = instantiate();
    assert.doesNotThrow(() => storeMod.update('app.lastDay', null));
    await flushMicrotasks();
    assert.doesNotThrow(() => storeMod.update('app.lastDay', undefined));
    await flushMicrotasks();
    // The internal large cold-start block remains suppressed; app/index owns a
    // reserved one-line loading status below the replay board.
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    assert.equal(cold.style.display, 'none', 'cold-start remains layout-neutral after null payloads');
  });

  test('Defensive: status:resolved with null summary + undefined bonusTraitsPacked does not throw', async () => {
    // Pitfalls D + E + bonusTraitsPacked-missing: composed blob may have null summary
    // and roll2 without bonusTraitsPacked field (verified game.ts:2030-2229 — day-keyed
    // roll2 handler does NOT include bonusTraitsPacked; only the per-player handler does
    // per game.ts:881). Widget must tolerate gracefully.
    const el = instantiate();
    assert.doesNotThrow(() => {
      storeMod.update('app.lastDay', {
        day: 9, level: 2, summary: null, winners: [],
        roll1: { day: 9, level: 2, purchaseLevel: null, wins: [] },
        roll2: { day: 9, level: 2, purchaseLevel: null, wins: [] },  // no bonusTraitsPacked
        status: 'resolved',
      });
    });
    await flushMicrotasks();
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.notEqual(resolved.style.display, 'none', 'resolved visible with null summary');
  });
});

// ===========================================================================
// Plan 59-03: localStorage spin-idempotency + new-day banner + wallet highlight
// ===========================================================================

const RESOLVED_PAYLOAD_DAY5 = {
  day: 5, level: 2, summary: null,
  winners: [{
    address: '0xab12000000000000000000000000000000000000',
    totalEth: '1000000000000000000', ticketCount: 100, coinTotal: '0',
    bafPrize: { eth: '0', tickets: 0 },
    decimatorPrize: { regularEth: '0', lootboxEth: '0', terminalEth: '0' },
  }],
  roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
  roll2: { day: 5, level: 2, purchaseLevel: null, wins: [], bonusTraitsPacked: null },
  status: 'resolved',
};

describe('Plan 59-03: localStorage spin-idempotency', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function instantiate() {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  test('replay:scratch-complete (NOT spin-complete) writes the spun_day key + dispatches jackpot:revealed', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    assert.equal(globalThis.localStorage.getItem(`spun_day_${CHAIN.id}_5`), null,
      'no key before the panel reveal is scratched');

    let revealed = 0;
    globalThis.document.addEventListener('jackpot:revealed', () => { revealed += 1; });

    // Spin end alone must NOT open the gate — prizes are still under the
    // scratch cover (user-reported bug: banner spoiled the win pre-scratch).
    globalThis.document.dispatchEvent({ type: 'replay:spin-complete' });
    await flushMicrotasks();
    assert.equal(globalThis.localStorage.getItem(`spun_day_${CHAIN.id}_5`), null,
      'spun_day key NOT written at spin end');
    assert.equal(revealed, 0, 'no jackpot:revealed at spin end');

    // The sibling <replay-panel> bubbles this once every owned quadrant +
    // the center diamond are scratched.
    globalThis.document.dispatchEvent({ type: 'replay:scratch-complete' });
    await flushMicrotasks();

    assert.equal(globalThis.localStorage.getItem(`spun_day_${CHAIN.id}_5`), '1',
      'spun_day key written on scratch completion (claims spoiler gate opens)');
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_5`), '1',
      'a no-bonus main scratch is also the durable whole-board completion');
    assert.equal(revealed, 1, 'jackpot:revealed dispatched for the winnings banner');
    el.disconnectedCallback();
  });

  // The "N winners this day · top hit X ETH" caption was pulled off the board
  // 2026-07-29 (user call). It is now only the popup's NO HIT subtitle, built by
  // #dayStatsText() — so the board must carry neither the element nor the copy.
  test('day-stats caption is gone from the board (no element, no copy)', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    assert.equal(el.querySelector('[data-bind="ldj-day-stats"]'), null,
      'no day-stats element in the shell');
    const rendered = el.innerHTML.replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(rendered, /winners this day|top hit/,
      'no winner-count / top-hit copy rendered on the board');
    assert.equal(el.querySelectorAll('.jp-winner-item').length, 0,
      'no winner-address rows in basic mode');
    el.disconnectedCallback();
  });

  test('the caption copy survives as the popup NO HIT subtitle (#dayStatsText)', () => {
    const src = readFileSync(
      new URL('../last-day-jackpot.js', import.meta.url), 'utf8',
    );
    assert.match(src, /#dayStatsText\(\)\s*\{/, 'builder kept');
    assert.match(src, /winners this day|winner\$\{/, 'winner-count copy kept in the builder');
    assert.match(src, /noWin:[\s\S]*?this\.#dayStatsText\(\)/,
      'popup NO HIT sub is fed by the builder');
  });

  test('localStorage QuotaExceededError on setItem → widget renders without throwing (Pitfall F)', async () => {
    // Replace localStorage with one that throws on every setItem call.
    const original = globalThis.localStorage;
    globalThis.localStorage = {
      _m: new Map(),
      getItem: (k) => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
      clear: () => {},
    };
    try {
      const el = instantiate();
      // Render resolved + simulate a roll2_done transition by direct state set.
      assert.doesNotThrow(() => {
        storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      }, 'render should not throw despite localStorage write attempts');
      await flushMicrotasks();
      // Verify the widget rendered the resolved state successfully.
      const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
      assert.notEqual(resolved?.style?.display, 'none',
        'resolved section visible despite localStorage throwing');
    } finally {
      globalThis.localStorage = original;
    }
  });
});

describe('new-day auto-follow', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function instantiate() {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  const DAY5 = {
    day: 5, level: 2, summary: null, winners: [],
    roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
    roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
    status: 'resolved-no-winners',
  };
  const DAY6 = {
    ...DAY5, day: 6,
    roll1: { ...DAY5.roll1, day: 6 },
    roll2: { ...DAY5.roll2, day: 6 },
  };

  test('Banner is hidden by default (no newer-day delivery)', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    const banner = el.querySelector('[data-bind="ldj-new-day-banner"]');
    assert.ok(banner, 'banner element exists');
    assert.equal(banner.hidden, true, 'banner hidden after first-payload pin (no newer day)');
  });

  test('newer-day payload updates immediately and leaves the click banner hidden', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    // Newer day arrives — no extra click is required.
    storeMod.update('app.lastDay', DAY6);
    await flushMicrotasks();
    const banner = el.querySelector('[data-bind="ldj-new-day-banner"]');
    assert.equal(banner.hidden, true, 'legacy click banner stays hidden');
    const dayLbl = el.querySelector('[data-bind="day"]');
    assert.match(dayLbl.textContent, /Day 6/, 'body follows day 6 immediately');
  });

  test('missing replay option is refreshed and selected for the new day', async () => {
    const connected = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', connected);
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: connected }];
    playerSelect.value = connected;
    replay.append(daySelect, playerSelect);
    let refreshes = 0;
    replay.refreshDays = async () => {
      refreshes += 1;
      daySelect.options.push({ value: '6' });
      return true;
    };
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    storeMod.update('app.lastDay', DAY6);
    await flushMicrotasks();
    await flushMicrotasks();

    assert.equal(refreshes, 1, 'replay day source reloaded once');
    assert.equal(daySelect.value, '6', 'newly loaded day selected automatically');
    el.disconnectedCallback();
  });

  test('a zero-entry viewer replaces the stale replay player instead of inheriting their wins', async () => {
    const viewed = '0x609da633ba1dd5e6aa2e43aa3ea3f740deece5b9';
    const staleWinner = '0x1111000000000000000000000000000000000000';
    storeMod.update('connected.address', viewed);
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: staleWinner }];
    playerSelect.value = staleWinner;
    let changes = 0;
    playerSelect.addEventListener('change', () => { changes += 1; });
    replay.append(daySelect, playerSelect);
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();

    assert.equal(playerSelect.value, viewed, 'zero-entry viewer becomes the replay target');
    assert.equal(changes, 1, 'replay-panel is told to recompute personal results');
    assert.ok(
      playerSelect.options.some((option) => option.value === viewed && option.dataset?.zeroEntry === 'true'),
      'bridge adds an explicit zero-entry option instead of retaining another player',
    );
    el.disconnectedCallback();
  });

  test('the bridge restores persisted reveal state through its replay-panel reference', async () => {
    const connected = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', connected);
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: connected }];
    playerSelect.value = connected;
    replay.append(daySelect, playerSelect);
    const restored = [];
    replay.setPersistedRevealState = (...state) => restored.push(state);
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();

    assert.deepEqual(restored, [[false, false]]);
    el.disconnectedCallback();
  });

  test('the bridge tells replay-panel when both rolls were durably completed', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const connected = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', connected);
    globalThis.localStorage.setItem(`spun_day_${CHAIN.id}_5`, '1');
    globalThis.localStorage.setItem(`jackpot_complete_day_${CHAIN.id}_5`, '1');
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: connected }];
    playerSelect.value = connected;
    replay.append(daySelect, playerSelect);
    const restored = [];
    replay.setPersistedRevealState = (...state) => restored.push(state);
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();

    assert.deepEqual(restored, [[true, true]],
      'main is restored as the default and bonus stays behind the flame');
    el.disconnectedCallback();
  });

  test('a new day resets the prior day reveal gates', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const el = instantiate();
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    globalThis.document.dispatchEvent({
      type: 'replay:scratch-complete',
      detail: { bonusPhase: false, bonusAvailable: false },
    });
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, false, 'day 5 is fully revealed');

    storeMod.update('app.lastDay', DAY6);
    await flushMicrotasks();
    assert.equal(cta.hidden, true, 'day 6 starts with fresh board/flip gates');
  });

  test('direct day shift hides yesterday until jackpot and coinflip are both day-matched', async () => {
    const connected = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', connected);
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }, { value: '6' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: connected }];
    playerSelect.value = connected;
    replay.append(daySelect, playerSelect);
    replay.setPersistedRevealState = () => {};
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    storeMod.update('app.daySync', {
      day: 6, jackpotReady: false, coinflipReady: false, ready: false,
      phase: 'waiting-both', coinflipResult: null,
    });
    await flushMicrotasks();

    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 6/);
    assert.equal(replay.getAttribute('data-day-warming'), '',
      'the old scratch board is inert as soon as GAME changes day');

    storeMod.update('app.lastDay', DAY6);
    storeMod.update('app.daySync', {
      day: 6, jackpotDay: 6, coinflipDay: 6,
      jackpotReady: true, coinflipReady: true, ready: true,
      phase: 'synced',
      coinflipResult: {
        day: 6, win: false, rewardPercent: 0, resolved: true, source: 'chain',
      },
    });
    await flushMicrotasks();

    assert.equal(daySelect.value, '6');
    assert.equal(replay.getAttribute('data-day-warming'), null,
      'both surfaces unlock after their exact day matches');
    el.disconnectedCallback();
  });
});

// ===========================================================================
// Phase 64 — foil-ticket matches: fetch → spoiler gate → shared pending action.
//
// The widget fetches /player/:addr/foil?level=N when a resolved day renders.
// Cards show regardless of spin state (the player's own tickets); MATCH
// lighting (face rings, T-chips, claimable pulse) applies only once the pinned
// day's spun_day key exists (or right after #finishReveal writes it).
// ===========================================================================

describe('foil match pending action', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    pendingActionsMod.__resetPendingActionsForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  test('the inline strip and claim bar are gone', () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    for (const hook of [
      'ldj-foil', 'ldj-foil-lines', 'ldj-foil-ladder', 'ldj-foil-boost', 'ldj-foil-claimbar',
    ]) {
      assert.equal(el.querySelector(`[data-bind="${hook}"]`), null, `${hook} removed`);
    }
    el.disconnectedCallback();
  });

  test('the day-results list is gone (DAY SUMMARY popup CTA stays)', () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    assert.equal(el.querySelector('[data-bind="ldj-results"]'), null, 'list removed');
    assert.equal(el.querySelector('[data-bind="ldj-results-rows"]'), null, 'rows removed');
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.ok(cta, 'popup CTA kept');
    assert.match(el.innerHTML, />\s*DAY SUMMARY\s*</, 'CTA uses the new name');
  });

  test('source publishes the contract tuple and sends its receipt to the reveal engine', () => {
    const src = readFileSync(new URL('../last-day-jackpot.js', import.meta.url), 'utf8');
    assert.equal(/ldj-foil-face/.test(src), false, 'no badge faces rendered');
    assert.equal(/renderDayResults/.test(src), false, 'results renderer removed');
    assert.match(src, /claimableDrawGrades\(/,
      'main and bonus draw claims are graded independently');
    assert.match(src, /publishPendingActions\(FOIL_MATCH_ACTION_SOURCE/);
    assert.match(src, /kind:\s*'foil-match'/);
    assert.match(src, /claimFoilMatch\(/);
    assert.match(src, /parseFoilMatchClaimedFromReceipt\(/);
    assert.match(src, /queueReveal\(\{\s*kind:\s*'foil-match'/s);
  });

  test('a revealed T8 line appears in pending with its actual ticket and match reason', async () => {
    const player = '0xab12000000000000000000000000000000000000';
    const traits = [1, 70, 130, 200];
    const packed = traits.reduce((word, trait, quadrant) => (
      word | ((trait & 0xff) << (quadrant * 8))
    ), 0) >>> 0;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.match(String(url), new RegExp(`/player/${player}/foil\\?level=12$`, 'i'));
      return {
        ok: true,
        json: async () => ({
          address: player, level: 12, present: true,
          lines: [traits, [2, 67, 132, 205], [3, 68, 133, 206], [4, 69, 134, 207]],
          claims: [],
        }),
      };
    };
    try {
      localStorage.setItem(`spun_day_${CHAIN.id}_44`, '1');
      storeMod.update('connected.address', player);
      const Ctor = customElements.get('last-day-jackpot');
      const el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      storeMod.update('app.lastDay', {
        day: 44, level: 12,
        summary: {
          rollOne: { mainTraitsPacked: packed },
          rollTwo: { bonusTraitsPacked: null },
        },
        winners: [],
        roll1: { day: 44, level: 12, purchaseLevel: 12, wins: [] },
        roll2: { day: 44, level: 12, purchaseLevel: 12, wins: [] },
        status: 'resolved',
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      const [action] = pendingActionsMod.getPendingActions();
      assert.equal(action.kind, 'foil-match');
      assert.equal(action.label, 'Day 44 · Foil T8');
      assert.match(action.detail, /MAIN DRAW · 4 exact/);
      assert.deepEqual(action.lineTraits, traits);
      assert.equal(typeof action.run, 'function');
      el.disconnectedCallback();
      assert.equal(pendingActionsMod.getPendingActions().length, 0,
        'detaching the owner cannot leave a stale foil reminder');
    } finally {
      globalThis.fetch = priorFetch;
    }
  });

  test('a same-day empty catch-up response cannot retract a verified foil match', async () => {
    const player = '0xab12000000000000000000000000000000000000';
    const traits = [1, 70, 130, 200];
    const packed = traits.reduce((word, trait, quadrant) => (
      word | ((trait & 0xff) << (quadrant * 8))
    ), 0) >>> 0;
    let indexed = true;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => indexed ? ({
        address: player, level: 12, present: true,
        lines: [traits, [2, 67, 132, 205], [3, 68, 133, 206], [4, 69, 134, 207]],
        claims: [],
      }) : ({ address: player, level: 12, present: false, lines: [], claims: [] }),
    });
    const payload = {
      day: 44, level: 12,
      summary: {
        rollOne: { mainTraitsPacked: packed },
        rollTwo: { bonusTraitsPacked: null },
      },
      winners: [],
      roll1: { day: 44, level: 12, purchaseLevel: 12, wins: [] },
      roll2: { day: 44, level: 12, purchaseLevel: 12, wins: [] },
      status: 'resolved',
    };
    let el = null;
    try {
      localStorage.setItem(`spun_day_${CHAIN.id}_44`, '1');
      storeMod.update('connected.address', player);
      const Ctor = customElements.get('last-day-jackpot');
      el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      storeMod.update('app.lastDay', payload);
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      assert.equal(pendingActionsMod.getPendingActions()[0]?.kind, 'foil-match');

      indexed = false;
      storeMod.update('app.lastDay', { ...payload });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      assert.equal(pendingActionsMod.getPendingActions()[0]?.kind, 'foil-match',
        'a transient empty indexer answer keeps the last verified same-scope match');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });
});

describe('Results CTA gating (whole board + flip before the popup)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    coinflipMod.__setResolvedStakeReaderForTest(async () => null);
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function instantiate() {
    const replay = makeFakeElement('replay-panel');
    const controls = makeFakeElement('div');
    controls.classList.add('replay-controls');
    const reveal = makeFakeElement('button');
    reveal.attributes['data-bind'] = 'reveal-btn';
    reveal.hidden = false;
    controls.appendChild(reveal);
    replay.appendChild(controls);
    _docBody.appendChild(replay);
    const slot = makeFakeElement('div');
    slot.attributes['data-bind'] = 'day-summary-slot';
    slot.hidden = true;
    _docBody.appendChild(slot);
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  function scratchEvent(detail) {
    return { type: 'replay:scratch-complete', detail };
  }

  test('hidden on a fresh resolved day; roll-1 completion with a bonus AHEAD keeps it hidden', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    // Flip gate pre-satisfied so the board gate is what's under test.
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    const slot = document.querySelector('[data-bind="day-summary-slot"]');
    const controls = document.querySelector('replay-panel').querySelector('.replay-controls');
    const reveal = controls.querySelector('[data-bind="reveal-btn"]');
    assert.ok(cta, 'CTA rendered in the shell');
    assert.equal(cta.hidden, true, 'hidden before any scratch');
    assert.equal(slot.hidden, true, 'obsolete extra row always reserves zero space');
    assert.equal(cta.parentElement, controls, 'summary shares Reveal Draw\'s action row');

    // Roll 1 done but the bonus roll is still ahead → board NOT played out.
    globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: true }));
    await flushMicrotasks();
    assert.equal(cta.hidden, true, 'still hidden while the bonus roll is pending');
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_5`), null,
      'main completion alone does not claim the bonus was cleared');
    assert.equal(globalThis.localStorage.getItem(`jackpot_bonus_pending_day_${CHAIN.id}_5`), '1',
      'main completion records that the bonus is genuinely still pending');

    // Bonus roll scratched out → whole board done → CTA appears.
    globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: true, bonusAvailable: false }));
    await flushMicrotasks();
    assert.equal(cta.hidden, false, 'CTA shown after the final roll');
    assert.equal(slot.hidden, true, 'no second action row is introduced');
    assert.equal(reveal.hidden, true, 'Reveal Draw and Day Summary are mutually exclusive');
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_5`), '1',
      'finishing the bonus persists the preferred reload view');
    assert.equal(globalThis.localStorage.getItem(`jackpot_bonus_pending_day_${CHAIN.id}_5`), null,
      'finishing the bonus retires its pending latch');
    el.disconnectedCallback();
  });

  test('no bonus this draw → single roll completion opens the CTA (flip already revealed)', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, false, 'CTA shown — no bonus roll to wait for');
    el.disconnectedCallback();
  });

  test('flip not revealed yet → CTA stays hidden until flip:revealed', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    // Whole board done, but the coin is still spinning (no flip_day key,
    // coinflip-row waiver unknown — default fetch throws in this harness).
    globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, true, 'hidden until the flip is revealed');

    // The player taps the coin — app-daily-flip writes the key + dispatches.
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    globalThis.document.dispatchEvent({ type: 'flip:revealed', detail: { day: 5 } });
    await flushMicrotasks();
    assert.equal(cta.hidden, false, 'CTA shown once both gates open');
    el.disconnectedCallback();
  });

  test('detail-less scratch-complete (legacy/tests) counts as final', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    globalThis.document.dispatchEvent({ type: 'replay:scratch-complete' });
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, false, 'bare event treated as final');
    el.disconnectedCallback();
  });

  test('reloaded spun day (spun_day persisted, no live scratch) opens the CTA without a re-scratch', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    globalThis.localStorage.setItem(`spun_day_${CHAIN.id}_5`, '1');
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, false, 'prior-session play-through honored on reload');
    el.disconnectedCallback();
  });

  test('DAY SUMMARY reads the day-scoped pack and player feeds before queuing the reveal', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0x1111000000000000000000000000000000000001';
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    const requested = [];
    const box7Tx = `0x${'7'.repeat(64)}`;
    const box8Tx = `0x${'8'.repeat(64)}`;
    const catchupTx = `0x${'c'.repeat(64)}`;
    globalThis.fetch = async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            blockNumber: '500',
            ticketRevealPacks: [
              { packId: 'tickets-day-5-batch-0', ticketCount: 10 },
              { packId: 'tickets-day-5-batch-1', ticketCount: 3 },
            ],
            lootboxPacks: [
              { packId: `lootbox-${box7Tx}-1`, lootboxIndex: 7, revealBlock: '501' },
              { packId: `lootbox-${box8Tx}-1`, lootboxIndex: 8, revealBlock: '502' },
              // One advance transaction can settle years of deferred index-0
              // boxes. They belong in the opened count, never as an endless
              // queue of AUTO-RESOLVED LOOTBOX reward cards.
              ...Array.from({ length: 40 }, (_, index) => ({
                packId: `lootbox-${catchupTx}-${index * 2 + 2}`,
                lootboxIndex: 0,
                revealBlock: '503',
              })),
            ],
          }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            level: 10,
            activity: {
              lootboxPurchases: [
                { lootboxIndex: 7 }, { lootboxIndex: 8 }, {}, {},
              ],
              lootboxResults: [
                { lootboxIndex: 7, rewardType: 'opened' },
                { lootboxIndex: 8, rewardType: 'flipOpened' },
              ],
              coinflip: null,
            },
          }),
        };
      }
      if (path.includes('/lootbox/legs?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              // lootboxIndex is an RNG slot and repeats across levels. These
              // 40 historical rows are deliberate poison: only the two
              // transaction hashes proven by the day-5 packs may survive.
              ...Array.from({ length: 40 }, (_, level) => ({
                uid: `old-${level}`,
                player: address,
                legType: 'opened',
                lootboxIndex: 7,
                transactionHash: `0x${level.toString(16).padStart(64, '0')}`,
                blockNumber: String(100 + level),
                logIndex: 1,
                ord: (100 + level) * 1_000_000 + 1,
                levelAtOpen: level + 1,
                rewardData: { amount: '1', futureTickets: 0, flip: '0' },
              })),
              {
                uid: 'r7', player: address, legType: 'opened', lootboxIndex: 7,
                transactionHash: box7Tx, blockNumber: '501', logIndex: 1, ord: 501000001,
                levelAtOpen: 10,
                rewardData: {
                  amount: '100', futureLevel: 10, futureTickets: 200,
                  roundedUp: false, flip: String(4n * 10n ** 18n),
                },
              },
              {
                uid: 'r8', player: address, legType: 'flipOpened', lootboxIndex: 8,
                transactionHash: box8Tx, blockNumber: '502', logIndex: 1, ord: 502000001,
                levelAtOpen: 10,
                rewardData: {
                  flipAmount: '100', ticketLevel: 10, tickets: 0,
                  roundedUp: false, flipReward: '0',
                },
              },
              {
                uid: 'r9', player: address, legType: 'dgnrs', lootboxIndex: 8,
                transactionHash: box8Tx, blockNumber: '502', logIndex: 2, ord: 502000002,
                rewardData: { dgnrsAmount: String(7n * 10n ** 18n) },
              },
              ...Array.from({ length: 40 }, (_, index) => [{
                uid: `catchup-reward-${index}`,
                player: address,
                legType: 'dgnrs',
                lootboxIndex: 0,
                transactionHash: catchupTx,
                blockNumber: '503',
                logIndex: index * 2 + 1,
                ord: 503000000 + index * 2 + 1,
                rewardData: { dgnrsAmount: String((index + 1) * 10) },
              }, {
                uid: `catchup-opened-${index}`,
                player: address,
                legType: 'opened',
                lootboxIndex: 0,
                transactionHash: catchupTx,
                blockNumber: '503',
                logIndex: index * 2 + 2,
                ord: 503000000 + index * 2 + 2,
                levelAtOpen: index + 1,
                rewardData: { amount: '1', futureTickets: 0, flip: '0' },
              }]).flat(),
            ],
            nextCursor: null,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      await flushMicrotasks();
      globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      const cta = el.querySelector('[data-bind="ldj-results-cta"]');
      cta.dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.ok(queued, 'summary reveal queued');
      assert.equal(queued.title, 'DAY 5 SUMMARY');
      const { lootboxResults, ...activityCounts } = queued.activity;
      assert.deepEqual(activityCounts, {
        ticketsRevealed: 13,
        lootboxesBought: 4,
        lootboxesOpened: 2,
        hasCoinflipBet: false,
        coinflipWon: null,
        coinflipStakeAmount: '0',
        coinflipRewardPercent: 0,
      });
      assert.equal(lootboxResults.length, 2,
        'only the two manual boxes are itemized; 40 deferred index-0 boxes cannot become an endless summary');
      assert.deepEqual(lootboxResults.map((result) => Number(result.lootboxIndex)), [7, 8]);
      assert.deepEqual(lootboxResults.map((result) => result.transactionHash), [box7Tx, box8Tx],
        'reused RNG indexes from 40 historical levels cannot enter this day');
      assert.deepEqual(lootboxResults[0].legs.map((leg) => leg.legType), ['opened']);
      assert.deepEqual(lootboxResults[1].legs.map((leg) => leg.legType), ['opened', 'dgnrs'],
        'same-transaction companion rewards stay attached to their box');
      assert.ok(requested.some((url) => url.includes('/packs?day=5')),
        'pack count came from the day-scoped DB feed');
      assert.ok(requested.some((url) => url.includes(`/viewer/player/${address}/day/5`)),
        'lootboxes and coinflip participation came from the day-scoped DB snapshot');
      assert.ok(requested.some((url) => url.includes('/lootbox/legs?')),
        'the summary loads the full indexed reward legs, not just opened counts');
      assert.equal(cta.hidden, true, 'the summary action is consumed after it queues once');
      assert.equal(
        globalThis.localStorage.getItem(`day_summary_${CHAIN.id}_5_${address}`),
        '1',
        'the consumed state survives a refresh for this player and day',
      );

      // A repeated click on the now-hidden node cannot queue a second summary.
      cta.dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      assert.equal(revealMod.__takeQueuedForTest().length, 0);
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('DAY SUMMARY includes the already-loaded Decimator payout without another endpoint', async () => {
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address, day: 5, ticketRevealPacks: [], lootboxPacks: [],
          }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            activity: { lootboxPurchases: [], lootboxResults: [], coinflip: null },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', {
        ...RESOLVED_PAYLOAD_DAY5,
        winners: [{
          ...RESOLVED_PAYLOAD_DAY5.winners[0],
          totalEth: '0',
          coinTotal: '0',
          ticketCount: 0,
          breakdown: [],
          decimatorPrize: {
            regularEth: '2000000000000',
            lootboxEth: '500000000000',
            terminalEth: '1000000000000',
          },
        }],
      });
      await flushMicrotasks();
      document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      el.querySelector('[data-bind="ldj-results-cta"]').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.deepEqual(queued.prizes, [{
        type: 'decimator',
        amount: 3_000_000_000_000n,
        lootboxAmount: 500_000_000_000n,
        terminalAmount: 1_000_000_000_000n,
      }]);
      assert.equal(requested.some((path) => /\/decimator(?:\?|\/)/.test(path)), false,
        'the composed last-day winner row is reused instead of adding a DB request');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('an otherwise empty day with a lost DB-recorded coinflip bet awards the 1 WWXRP summary card', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0x1111000000000000000000000000000000000001';
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = String(url);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ address, day: 5, ticketRevealPacks: [], lootboxPacks: [] }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            activity: {
              lootboxPurchases: [],
              lootboxResults: [],
              coinflip: { stakeAmount: '250000000000000000000', win: false },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      await flushMicrotasks();
      globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      el.querySelector('[data-bind="ldj-results-cta"]').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.deepEqual(queued.prizes, [{ type: 'wwxrp', amount: 10n ** 18n }]);
      assert.equal(queued.noWin, null, 'the WWXRP result replaces the generic NO HIT card');
      assert.equal(queued.consolationOnly, true,
        'the reveal layer can play the consolation horn instead of confetti');
      assert.equal(queued.activity.hasCoinflipBet, true);
      assert.equal(queued.activity.coinflipWon, false);
      assert.equal(queued.activity.coinflipStakeAmount, '250000000000000000000');
      assert.equal(queued.activity.coinflipRewardPercent, 0);
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('DAY SUMMARY fails closed when an endpoint echoes an all-time or different-day payload', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0x1111000000000000000000000000000000000001';
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    let legFeedReads = 0;
    globalThis.fetch = async (url) => {
      const path = String(url);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: null, // PACKS-V2 all-time mode — never valid for this summary.
            ticketRevealPacks: Array.from({ length: 40 }, (_, i) => ({
              packId: `tickets-day-all-batch-${i}`, ticketCount: 10,
            })),
            lootboxPacks: Array.from({ length: 40 }, (_, i) => ({
              packId: `lootbox-0x${i.toString(16).padStart(64, '0')}-1`,
              lootboxIndex: 7,
            })),
          }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 40, // stale cross-day response
            activity: {
              lootboxPurchases: Array.from({ length: 40 }, () => ({ lootboxIndex: 7 })),
              lootboxResults: Array.from({ length: 40 }, () => ({
                lootboxIndex: 7, rewardType: 'opened',
              })),
              coinflip: { stakeAmount: String(1_000n * 10n ** 18n), win: false },
            },
          }),
        };
      }
      if (path.includes('/lootbox/legs?')) legFeedReads += 1;
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      await flushMicrotasks();
      globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      el.querySelector('[data-bind="ldj-results-cta"]').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.deepEqual(queued.activity, {
        ticketsRevealed: 0,
        lootboxesBought: 0,
        lootboxesOpened: 0,
        lootboxResults: [],
        hasCoinflipBet: false,
        coinflipWon: null,
        coinflipStakeAmount: '0',
        coinflipRewardPercent: 0,
      });
      assert.equal(legFeedReads, 0, 'an unproven day cannot fan out into historical reward pages');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('a winning coinflip summary uses the exact flip day instead of a stale viewer level', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0x1111000000000000000000000000000000000001';
    const exactStake = 20_500n * 10n ** 18n;
    coinflipMod.__setResolvedStakeReaderForTest(async ({ player, day }) => {
      assert.equal(player, address);
      assert.equal(day, 5);
      return exactStake;
    });
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = String(url);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ address, day: 5, ticketRevealPacks: [], lootboxPacks: [] }),
        };
      }
      if (path.includes('/game/coinflip/day/5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ day: 5, win: true, rewardPercent: 100 }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            activity: {
              lootboxPurchases: [],
              lootboxResults: [],
              coinflip: {
                // Deliberately wrong level-scoped data: this is the regression.
                stakeAmount: String(3_000n * 10n ** 18n),
                win: false,
                rewardPercent: 50,
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      await flushMicrotasks();
      globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      el.querySelector('[data-bind="ldj-results-cta"]').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.deepEqual(queued.prizes, [], 'no consolation is fabricated after a win');
      assert.equal(queued.noWin, null,
        'the coinflip receipt replaces a generic empty-day card');
      assert.equal(queued.consolationOnly, false);
      assert.equal(queued.activity.hasCoinflipBet, true);
      assert.equal(queued.activity.coinflipWon, true);
      assert.equal(queued.activity.coinflipStakeAmount, String(exactStake),
        'the exact day stake replaces the stale 3k viewer value');
      assert.equal(queued.activity.coinflipRewardPercent, 100,
        'the global day result replaces the viewer level result');
      const normalized = revealMod.normalizeSequence(queued);
      const flipCard = normalized.cards.find((card) => card.type === 'coinflip-result');
      assert.equal(flipCard.value, '+41,000 FLIP');
      assert.equal(flipCard.outcomeLabel, 'WIN');
      assert.equal(flipCard.outcomePercent, '200%');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });
});
