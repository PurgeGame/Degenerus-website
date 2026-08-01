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
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Imports under test — store.js is safe to static-import (no HTMLElement use).
// last-day-jackpot.js is dynamic-imported inside beforeEach so the FakeHTMLElement
// stub is installed BEFORE the class declaration runs (ESM static imports hoist
// above the `globalThis.HTMLElement = ...` assignment above).
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    // The spin/scratch reveal is the sibling <replay-panel>; the shell carries the
    // day pin, banner, and the foil CLAIM bar (the strip itself, the day-results
    // list, and the day-stats caption were all removed 2026-07-29 on the user's
    // call — the caption survives only as the popup's NO HIT subtitle).
    const required = [
      'ldj-status-cold-start',
      'ldj-status-empty-day',
      'ldj-status-resolved',
      'ldj-new-day-banner',
      'ldj-foil-claimbar',
      'day',
    ];
    for (const hook of required) {
      assert.ok(
        el.querySelector(`[data-bind="${hook}"]`),
        `data-bind="${hook}" present`,
      );
    }
  });

  test('Cold-start section visible by default after connectedCallback (Plan 59-01 default state)', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    assert.ok(cold, 'cold-start section exists');
    // Plan 59-01: cold-start visible (style.display !== 'none'); empty-day + resolved hidden.
    // Plan 59-02 wires data flow that may flip this on payload arrival.
    assert.notEqual(
      cold.style.display, 'none',
      'cold-start visible by default (no display:none on the wrapper)',
    );
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

  test('status:pre-game payload → cold-start visible, empty-day + resolved hidden', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', { day: null, status: 'pre-game' });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.ok(cold, 'cold-start section exists');
    assert.notEqual(cold.style.display, 'none', 'cold-start visible');
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

  test('null/undefined payload does not throw + leaves Plan 59-01 default scaffold visible', async () => {
    const el = instantiate();
    assert.doesNotThrow(() => storeMod.update('app.lastDay', null));
    await flushMicrotasks();
    assert.doesNotThrow(() => storeMod.update('app.lastDay', undefined));
    await flushMicrotasks();
    // Cold-start (Plan 59-01 default scaffold) still visible since #onLastDayUpdate early-returned.
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    assert.notEqual(cold.style.display, 'none', 'cold-start still visible after null payloads');
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
});

// ===========================================================================
// Phase 64 — foil-ticket strip: fetch → render → spoiler-gated match lighting.
//
// The widget fetches /player/:addr/foil?level=N when a resolved day renders.
// Cards show regardless of spin state (the player's own tickets); MATCH
// lighting (face rings, T-chips, claimable pulse) applies only once the pinned
// day's spun_day key exists (or right after #finishReveal writes it).
// ===========================================================================

describe('foil CLAIM bar (all that survives of the foil strip)', () => {
  // User call 2026-07-29: "the ugly foil tickets and the big list of what everyone
  // else won" came out of the widget. A matched line still PAYS, so the claim
  // button had to survive — it is now a bar that appears only when something is
  // claimable, and nothing renders the four badge lines or the tier ladder.
  test('the strip markup is gone: no lines, ladder, or per-tier chips', () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    for (const hook of ['ldj-foil', 'ldj-foil-lines', 'ldj-foil-ladder', 'ldj-foil-boost']) {
      assert.equal(el.querySelector(`[data-bind="${hook}"]`), null, `${hook} removed`);
    }
    assert.ok(el.querySelector('[data-bind="ldj-foil-claimbar"]'), 'claim bar present');
    assert.equal(el.querySelector('[data-bind="ldj-foil-claimbar"]').hidden, true,
      'hidden until something is claimable');
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

  test('source no longer renders foil faces or the tier ladder', () => {
    const src = readFileSync(new URL('../last-day-jackpot.js', import.meta.url), 'utf8');
    assert.equal(/FOIL_TIER_FACES/.test(src), false, 'ladder constant no longer imported');
    assert.equal(/ldj-foil-face/.test(src), false, 'no badge faces rendered');
    assert.equal(/renderDayResults/.test(src), false, 'results renderer removed');
    // The claim path itself must still be wired.
    assert.match(src, /claimFoilMatch\(/);
    assert.match(src, /FOIL_CLAIM_THRESHOLD/);
  });
});

describe('Results CTA gating (whole board + flip before the popup)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
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

    // Bonus roll scratched out → whole board done → CTA appears.
    globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: true, bonusAvailable: false }));
    await flushMicrotasks();
    assert.equal(cta.hidden, false, 'CTA shown after the final roll');
    assert.equal(slot.hidden, true, 'no second action row is introduced');
    assert.equal(reveal.hidden, true, 'Reveal Draw and Day Summary are mutually exclusive');
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_5`), '1',
      'finishing the bonus persists the preferred reload view');
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
    globalThis.fetch = async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ticketRevealPacks: [{ ticketCount: 10 }, { ticketCount: 3 }],
            lootboxPacks: [{}, {}],
          }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            activity: {
              lootboxPurchases: [{}, {}, {}, {}],
              lootboxResults: [{ rewardType: 'opened' }, { rewardType: 'flipOpened' }],
              coinflip: null,
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
      const cta = el.querySelector('[data-bind="ldj-results-cta"]');
      cta.dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.ok(queued, 'summary reveal queued');
      assert.equal(queued.title, 'DAY 5 SUMMARY');
      assert.deepEqual(queued.activity, {
        ticketPacks: 2,
        ticketCount: 13,
        lootboxesBought: 4,
        lootboxesOpened: 2,
        hasCoinflipBet: false,
        coinflipWon: null,
      });
      assert.ok(requested.some((url) => url.includes('/packs?day=5')),
        'pack count came from the day-scoped DB feed');
      assert.ok(requested.some((url) => url.includes(`/viewer/player/${address}/day/5`)),
        'lootboxes and coinflip participation came from the day-scoped DB snapshot');
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
          json: async () => ({ ticketRevealPacks: [], lootboxPacks: [] }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
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
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('a winning coinflip does not show the 1 WWXRP consolation in an otherwise empty summary', async () => {
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
          json: async () => ({ ticketRevealPacks: [], lootboxPacks: [] }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            activity: {
              lootboxPurchases: [],
              lootboxResults: [],
              coinflip: { stakeAmount: '250000000000000000000', win: true },
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
      assert.ok(queued.noWin, 'the otherwise empty jackpot summary keeps its normal no-hit card');
      assert.equal(queued.consolationOnly, false);
      assert.equal(queued.activity.hasCoinflipBet, true);
      assert.equal(queued.activity.coinflipWon, true);
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });
});
