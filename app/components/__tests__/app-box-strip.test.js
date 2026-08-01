// /app/components/__tests__/app-box-strip.test.js — pending lootbox chips.
// Run: cd website && node --test app/components/__tests__/app-box-strip.test.js
//
// Covers: hidden with no boxes, tx-confirmed event plumbing (chips added,
// afking idx-0 skipped, dupes ignored), chainId+address-scoped localStorage
// persistence, and boot restore on connected.address.
//
// The RNG-ready/open path rides lootbox.js primitives (pollRngForLootbox /
// openLootBox) already covered by lootbox.test.js; headless getProvider()
// is null so every poll cycle here resolves 0n (still waiting) — exactly the
// deterministic state these tests pin.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (trimmed decimator-panel port) — BEFORE component import.
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
        if (classMatch) for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
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
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
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
    removeEventListener() {},
    dispatchEvent(ev) {
      const arr = this.eventListeners[ev.type] || [];
      for (const fn of arr) { try { fn(ev); } catch { /* swallow */ } }
      return true;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    },
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
    const base = makeFakeElement('div');
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(base));
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
globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};

// Document with WORKING dispatchEvent — the strip listens at document level
// for the buy panel's bubbled tx-confirmed event.
const _docListeners = new Map();
globalThis.document = {
  createElement: (tag) => makeFakeElement(tag),
  body: makeFakeElement('body'),
  addEventListener(type, fn) {
    if (!_docListeners.has(type)) _docListeners.set(type, []);
    _docListeners.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    const arr = _docListeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  },
  dispatchEvent(ev) {
    const arr = _docListeners.get(ev.type) || [];
    for (const fn of arr) { try { fn(ev); } catch { /* swallow */ } }
    return true;
  },
  visibilityState: 'visible',
};
globalThis.window = {
  matchMedia: () => ({ matches: true }),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

const storeMod = await import('../../app/store.js');
const contractsMod = await import('../../app/contracts.js');
const lootboxMod = await import('../../app/lootbox.js');
const pendingActionsMod = await import('../../app/pending-actions.js');
const revealMod = await import('../reveal-overlay.js');
const { pendingBoxesKey, revealedBoxesKey } = await import('../app-box-strip.js');
const { CHAIN } = await import('../../app/chain-config.js');
const ORIGINAL_FETCH = globalThis.fetch;

const ADDR = '0xAbCd00000000000000000000000000000000AbCd';
const ADDR_LC = ADDR.toLowerCase();
const KEY = pendingBoxesKey(CHAIN.id, ADDR);

const tick = () => new Promise((r) => setTimeout(r, 5));
const activeElements = new Set();

function instantiate({ trayOnly = false } = {}) {
  const Ctor = customElements.get('app-box-strip');
  const el = new Ctor();
  if (trayOnly) el.setAttribute('tray-only', '');
  el.connectedCallback();
  activeElements.add(el);
  return el;
}

function fireTxConfirmed(boxes) {
  document.dispatchEvent(new CustomEvent('app-decimator:tx-confirmed', {
    detail: { ticketQuantity: 0, lootBoxAmountWei: 1n, boxes },
    bubbles: true,
  }));
}

describe('app-box-strip', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    _docListeners.clear();
    storeMod.__resetForTest();
    pendingActionsMod.__resetPendingActionsForTest();
    revealMod.__resetForTest();
    lootboxMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    // Resolve background discovery immediately. Leaving Node's native fetch in
    // place for a relative API URL can keep fetchJSON's shared in-flight entry
    // alive into the next test.
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });
  });

  afterEach(() => {
    for (const el of activeElements) el.disconnectedCallback();
    activeElements.clear();
    lootboxMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test('hidden with no connected address / no boxes', async () => {
    const el = instantiate();
    await tick();
    assert.equal(el.querySelector('[data-bind="bxs-strip"]').hidden, true);
  });

  test('tray-only mode does not render an inline opener', async () => {
    const el = instantiate({ trayOnly: true });
    await tick();
    assert.equal(el.querySelector('[data-bind="bxs-strip"]'), null,
      'the purchase-area chip surface is not rendered');
  });

  test('tx-confirmed adds chips (waiting state), skips afking idx 0, dedupes', async () => {
    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 0, day: 4 }, { index: 8, day: 4 }, { index: 8, day: 4 }, { index: 9, day: 4 }]);
    await tick();
    const strip = el.querySelector('[data-bind="bxs-strip"]');
    assert.equal(strip.hidden, false);
    const chips = el.querySelectorAll('.bxs-chip');
    assert.equal(chips.length, 2, 'idx 0 skipped, dupe collapsed');
    // Headless getProvider() is null → RNG poll returns 0n → still waiting.
    const cta = chips[0].querySelector('.bxs-open-cta');
    assert.equal(cta.disabled, true);
    assert.equal(cta.textContent, 'RNG PENDING');
    assert.match(chips[0].querySelector('.bxs-chip-status').textContent, /Waiting for RNG/);
  });

  test('ready RNG gets an explicit OPEN LOOTBOX button and a shared ready action', async () => {
    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();

    assert.equal(el.__setReadyForTest(8), true);
    const chip = el.querySelector('.bxs-chip');
    const cta = chip.querySelector('.bxs-open-cta');
    assert.equal(chip.querySelector('.bxs-chip-title').textContent, 'LOOTBOX #8');
    assert.equal(cta.disabled, false);
    assert.equal(cta.textContent, 'OPEN LOOTBOX');
    assert.match(cta.getAttribute('aria-label'), /Open lootbox 8/);

    const pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, 'lootbox:8');
    assert.equal(pending[0].state, 'ready');
    assert.equal(typeof pending[0].run, 'function');
    el.disconnectedCallback();
  });

  test('an already-resolved box replays without sending openBox', async () => {
    const calls = { status: [], open: [] };
    const fake = {
      lootboxRngWordByIndex: async () => 1n,
      lootboxStatus: async (...args) => {
        calls.status.push(args);
        return [0n, false];
      },
      openBox: Object.assign(
        async (...args) => {
          calls.open.push(args);
          return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) };
        },
        { staticCall: async () => undefined },
      ),
      connect() { return this; },
    };
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
      getSigner: async () => ({ getAddress: async () => ADDR }),
    });
    lootboxMod.__setContractFactoryForTest(() => fake);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    el.__setReadyForTest(8);

    const pending = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.ok(pending, 'the tracked box publishes its open action');
    await pending.run();

    assert.ok(calls.status.length >= 1, 'the slot is checked before attempting a write');
    assert.ok(calls.status.every(([owner, index]) => owner === ADDR_LC && index === 8n));
    assert.equal(calls.open.length, 0, 'no wallet write for a cleared on-chain slot');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'a cleared slot with no indexed legs retires the stale action instead of persisting forever');
    assert.deepEqual(revealMod.__takeQueuedForTest(), []);
    el.disconnectedCallback();
  });

  test('an unresolved legacy DB row cannot create a notification for an empty chain slot', async () => {
    const fake = {
      lootboxStatus: async () => [0n, false],
      lootboxRngWordByIndex: async () => 1n,
    };
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
      getSigner: async () => ({ getAddress: async () => ADDR }),
    });
    lootboxMod.__setContractFactoryForTest(() => fake);
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('/lootbox/feed')
        ? {
            items: [{
              player: ADDR_LC,
              resolvedIndex: 88,
              opened: false,
              rngReady: true,
              results: [],
            }],
          }
        : { items: [] },
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    for (let i = 0; i < 10; i += 1) await tick();

    assert.equal(el.querySelectorAll('.bxs-chip').length, 0,
      'DB history is only a candidate; zero live amount prevents a phantom chip');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the bottom tray is not spammed by the stale row');
    assert.equal(globalThis.localStorage.getItem(KEY), null,
      'an unverified database candidate is not persisted as a receipt purchase');
    el.disconnectedCallback();
  });

  test('discovers the newest DB-only result and replays every indexed BoxSpin reel', async () => {
    const txHash = '0xfeed';
    const reels = [
      { spinIndex: 0, score: 1, playerTraits: [], resultTraits: [] },
      { spinIndex: 1, score: 2, playerTraits: [], resultTraits: [] },
      { spinIndex: 2, score: 3, playerTraits: [], resultTraits: [] },
    ];
    const legs = [
      {
        uid: 's1', player: ADDR_LC, legType: 'spin', lootboxIndex: null,
        transactionHash: txHash, logIndex: 12, ord: 120,
        spin: {
          spinType: 'flip', spinCount: 3, survived: true,
          payout: '900', ethShare: '0', reels,
        },
      },
      {
        uid: 'r1', player: ADDR_LC, legType: 'opened', lootboxIndex: 77,
        transactionHash: txHash, logIndex: 11, ord: 110,
        rewardData: {
          amount: '100', futureLevel: 5, futureTickets: 0,
          roundedUp: false, flip: '0',
        },
      },
      // A historical result must not flood a browser that has no receipt state.
      {
        uid: 'r0', player: ADDR_LC, legType: 'opened', lootboxIndex: 70,
        transactionHash: '0xold', logIndex: 1, ord: 10,
        rewardData: { amount: '50', futureTickets: 0, roundedUp: false, flip: '0' },
      },
    ];
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('/lootbox/legs')
        ? { items: legs }
        : { items: [] },
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    // This poll performs two database reads plus the chain-read fallback. Wait
    // for its published action instead of relying on one machine-specific tick.
    for (let i = 0; i < 20
      && !pendingActionsMod.getPendingActions().some((action) => action.id === 'lootbox:77');
      i += 1) {
      await tick();
    }

    const chips = el.querySelectorAll('.bxs-chip');
    assert.equal(chips.length, 1, 'only the latest DB-only opening is offered as catch-up');
    assert.equal(chips[0].querySelector('.bxs-chip-title').textContent, 'LOOTBOX #77');
    assert.equal(chips[0].querySelector('.bxs-open-cta').textContent, 'VIEW RESULT');

    const pending = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:77');
    assert.ok(pending, 'the DB result publishes its own reveal action');
    await pending.run();
    const [replay] = revealMod.__takeQueuedForTest();
    assert.equal(replay.kind, 'lootbox');
    assert.equal(replay.lootboxIndex, 77);
    const spin = replay.legs.find((leg) => leg.legType === 'spin');
    assert.equal(spin.spinCount, 3);
    assert.deepEqual(spin.reels.map((reel) => reel.spinIndex), [0, 1, 2]);
    assert.equal(
      pendingActionsMod.getPendingActions().some((action) => action.id === 'lootbox:77'),
      false,
    );
    assert.deepEqual(
      JSON.parse(globalThis.localStorage.getItem(revealedBoxesKey(CHAIN.id, ADDR))),
      ['77'],
    );
    el.disconnectedCallback();
  });

  test('persists pending boxes to chainId+address-scoped localStorage', async () => {
    instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    const stored = JSON.parse(globalThis.localStorage.getItem(KEY));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].index, 8);
    assert.equal(stored[0].day, 4);
    assert.equal(stored[0].fromReceipt, true,
      'only wallet-receipt rows receive the short indexer-lag grace period');
    assert.ok(Number.isFinite(stored[0].createdAt), 'receipt age is persisted for stale-row cleanup');
    assert.match(KEY, /^pending-boxes:84532:0xabcd/, 'chainId + lowercased address in key');
  });

  test('restores pending boxes from localStorage on connect', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify([{ index: 3, day: 2 }, { index: 5, day: 2 }]));
    const el = instantiate();
    storeMod.update('connected.address', ADDR_LC);
    await tick();
    assert.equal(el.querySelectorAll('.bxs-chip').length, 2, 'restored from storage');
  });

  test('disconnect clears the strip (no address → hidden)', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify([{ index: 3, day: 2 }]));
    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    assert.equal(el.querySelector('[data-bind="bxs-strip"]').hidden, false);
    storeMod.update('connected.address', null);
    await tick();
    assert.equal(el.querySelector('[data-bind="bxs-strip"]').hidden, true);
  });
});
