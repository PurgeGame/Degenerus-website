// /app/components/__tests__/app-daily-flip.test.js — daily coinflip widget.
// Run: cd website && node --test app/components/__tests__/app-daily-flip.test.js
//
// Tests the coin reveal + gate key + action buttons:
//   - unrevealed day → animated two-faced coin (shared/coinflip-coin.svg)
//   - click → flip_day_* key + document 'flip:revealed' + landed face
//     (green ETH face = WIN, red face = LOSS)
//   - position rows from dashboard coinflip data
//   - redeem group hidden when the FLIP-window read fails (no provider in tests)
//   - action errors render via textContent

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as storeMod from '../../app/store.js';
import * as coinflipMod from '../../app/coinflip.js';

const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const STATUS_CSS = readFileSync(new URL('../../styles/status-indicators.css', import.meta.url), 'utf8');

const TEST_ADDR = '0xab12000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Fake DOM — trimmed harness (same as app-balances-strip.test.js).
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
    value: '',
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
        const nameMatch = /\bname="([^"]+)"/.exec(attrs);
        if (nameMatch) child.attributes.name = nameMatch[1];
        const valueMatch = /\bvalue="([^"]+)"/.exec(attrs);
        if (valueMatch) child.value = valueMatch[1];
        const classMatch = /\bclass="([^"]+)"/.exec(attrs);
        if (classMatch) {
          for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
        }
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
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      return child;
    },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
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
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    },
    removeAttribute(k) { delete this.attributes[k]; },
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
  dispatchEvent: () => true,
  location: { search: '', href: 'http://localhost/', hostname: 'localhost' },
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

let _fetchResponses = { dashboard: null, flipDay: null };
let _currentStakeWei = null;
let _resolvedStakeWei = null;
let _fetchCounts = new Map();
globalThis.fetch = async (url) => {
  const u = String(url);
  _fetchCounts.set(u, (_fetchCounts.get(u) || 0) + 1);
  if (/\/game\/coinflip\/day\/\d+$/.test(u)) {
    if (_fetchResponses.flipDay !== null) {
      return { ok: true, status: 200, json: async () => _fetchResponses.flipDay };
    }
  } else if (/\/player\/0x[0-9a-f]+$/i.test(u)) {
    if (_fetchResponses.dashboard !== null) {
      return { ok: true, status: 200, json: async () => _fetchResponses.dashboard };
    }
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.localStorage.clear();
  _docListeners.clear();
  _fetchResponses = { dashboard: null, flipDay: null };
  _currentStakeWei = '43844000000000000000000';
  _resolvedStakeWei = '43844000000000000000000';
  _fetchCounts = new Map();
}

async function flushPromises() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

async function flushMicrotasks() {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 50));
  await flushPromises();
}

function dashboardPayload() {
  return {
    player: TEST_ADDR,
    flipBalance: '987654000000000000000000',       // 987,654 FLIP
    sdgnrsBalance: '123450000000000000000000000',   // 123,450,000 sDGNRS
    coinflip: {
      depositedAmount: '43844000000000000000000',     // 43,844 FLIP
      claimablePreview: '4526397000000000000000000',  // 4,526,397 FLIP
    },
  };
}

function mount() {
  const Ctor = customElements.get('app-daily-flip');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

const revealPlanning = await import('../app-daily-flip.js');

describe('day-wide reveal planning', () => {
  test('four distinct tracks publish the requested conditional win odds', () => {
    assert.deepEqual(
      revealPlanning.FLIP_REVEAL_PROFILES.map(({ id, winRate }) => [id, winRate]),
      [['comet', 60], ['ricochet', 55], ['orbit', 45], ['pulse', 40]],
    );

    const counts = new Map(revealPlanning.FLIP_REVEAL_PROFILES.map((row) => [
      row.id, { wins: 0, losses: 0, target: row.winRate },
    ]));
    for (let day = 1; day <= 100_000; day += 1) {
      counts.get(revealPlanning.selectFlipRevealPlan(day, true).profile).wins += 1;
      counts.get(revealPlanning.selectFlipRevealPlan(day, false).profile).losses += 1;
    }
    for (const [profile, row] of counts) {
      const observed = (row.wins / (row.wins + row.losses)) * 100;
      assert.ok(Math.abs(observed - row.target) < 0.8,
        `${profile} observed ${observed.toFixed(2)}%, wanted ${row.target}%`);
    }
  });

  test('the same day/result is deterministic and each fake-out is five percent overall', () => {
    assert.deepEqual(
      revealPlanning.selectFlipRevealPlan(12_345, true),
      revealPlanning.selectFlipRevealPlan(12_345, true),
      'no player or browser randomness enters the plan',
    );
    let lossToWin = 0;
    let winToLoss = 0;
    const days = 100_000;
    for (let day = 1; day <= days; day += 1) {
      if (revealPlanning.selectFlipRevealPlan(day, true).ending === 'loss-to-win') lossToWin += 1;
      if (revealPlanning.selectFlipRevealPlan(day, false).ending === 'win-to-loss') winToLoss += 1;
    }
    assert.ok(Math.abs((lossToWin / (days * 2)) * 100 - 5) < 0.25);
    assert.ok(Math.abs((winToLoss / (days * 2)) * 100 - 5) < 0.25);
    assert.equal(revealPlanning.selectFlipRevealPlan(68, true).fakeOut, false,
      'ordinary days retain the original ending without a Reverse-card cue');
  });

  test('rare multi-reversals are day-wide at two percent and one percent', () => {
    const counts = [0, 0, 0, 0];
    const days = 100_000;
    for (let day = 1; day <= days; day += 1) {
      const plan = revealPlanning.selectFlipRevealPlan(day, true);
      counts[plan.reversalCount] += 1;
      if (plan.reversalCount === 2) assert.equal(plan.ending, 'double-to-win');
      if (plan.reversalCount === 3) assert.equal(plan.ending, 'triple-to-win');
    }
    assert.ok(Math.abs((counts[1] / days) * 100 - 10) < 0.3,
      `one reversal observed ${(counts[1] / days * 100).toFixed(2)}%`);
    assert.ok(Math.abs((counts[2] / days) * 100 - 2) < 0.2,
      `two reversals observed ${(counts[2] / days * 100).toFixed(2)}%`);
    assert.ok(Math.abs((counts[3] / days) * 100 - 1) < 0.15,
      `three reversals observed ${(counts[3] / days * 100).toFixed(2)}%`);
    assert.equal(revealPlanning.REVEAL_DOUBLE_END_MS, 2500);
    assert.equal(revealPlanning.REVEAL_TRIPLE_END_MS, 3400);
    assert.equal(revealPlanning.REVEAL_BIASED_END_MS, 1350);

    for (let day = 1; day <= 250; day += 1) {
      for (const won of [false, true]) {
        const plan = revealPlanning.selectFlipRevealPlan(day, won);
        const prefersWin = plan.winRate > 50;
        const expectedOpeningMs = plan.openingWon === prefersWin
          ? revealPlanning.REVEAL_BIASED_END_MS
          : revealPlanning.REVEAL_END_MS;
        assert.equal(plan.openingMs, expectedOpeningMs);
        assert.equal(plan.endingMs, plan.openingMs + (plan.reversalCount * 900));
      }
    }
  });
});

describe('app-daily-flip — coin reveal + actions', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    coinflipMod.__setCurrentStakeReaderForTest(async () => _currentStakeWei);
    coinflipMod.__setResolvedStakeReaderForTest(async () => _resolvedStakeWei);
    coinflipMod.__setClaimableReaderForTest(async () => null);
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({
      queued: 0n,
      locked: false,
    }));
    storeMod.update('connected.address', TEST_ADDR);
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });
    await import('../app-daily-flip.js');
  });

  afterEach(() => {
    coinflipMod.__resetCurrentStakeReaderForTest();
    coinflipMod.__resetResolvedStakeReaderForTest();
    coinflipMod.__resetClaimableReaderForTest();
    coinflipMod.__resetReverseFlipQuoteReaderForTest();
  });

  test('unrevealed → clickable 3D coin with a small reveal hint and no extra button', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    await flushMicrotasks();

    const coin = el.querySelector('.df-coin--spinning');
    assert.ok(coin, 'spinning coin rendered');
    assert.equal(coin.tagName, 'BUTTON', 'coin is clickable too');
    assert.ok(coin.querySelector('.df-coin3d__inner'), '3D rotor present (idle spin loop)');
    const faces = coin.querySelectorAll('.df-coin3d__face');
    assert.equal(faces.length, 2, 'two faces');
    const srcs = coin.querySelectorAll('img').map((i) => i.src);
    assert.ok(srcs.includes('/shared/coinflip-face-red.svg'), 'red WWXRP face');
    assert.ok(srcs.includes('/shared/coinflip-face-eth.svg'), 'green ETH face');
    const revealHint = el.querySelector('[data-bind="df-reveal-hint"]');
    assert.equal(revealHint.hidden, false, 'small instruction is visible while unrevealed');
    assert.equal(revealHint.textContent, 'Click the coin to reveal');
    assert.equal(el.querySelector('[data-bind="df-reveal-cta"]'), null,
      'there is no duplicate reveal button');
    el.disconnectedCallback();
  });

  test('startup subscriptions coalesce into one load per data source', async () => {
    let currentReads = 0;
    let resolvedReads = 0;
    coinflipMod.__setCurrentStakeReaderForTest(async () => {
      currentReads += 1;
      return _currentStakeWei;
    });
    coinflipMod.__setResolvedStakeReaderForTest(async () => {
      resolvedReads += 1;
      return _resolvedStakeWei;
    });
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };

    const el = mount();
    await flushMicrotasks();

    assert.equal(
      _fetchCounts.get('http://localhost:3000/player/0xab12000000000000000000000000000000000000'),
      1,
      'immediate-fire store subscriptions share one dashboard request',
    );
    assert.equal(
      _fetchCounts.get('http://localhost:3000/game/coinflip/day/67'),
      1,
      'daily result is requested once at mount',
    );
    assert.equal(currentReads, 1, 'live stake is read once at mount');
    assert.equal(resolvedReads, 1, 'historical stake is read once at mount');
    el.disconnectedCallback();
  });

  test('fast API data renders without waiting for slow chain reads', async () => {
    let finishCurrent;
    let finishResolved;
    coinflipMod.__setCurrentStakeReaderForTest(() => new Promise((resolve) => {
      finishCurrent = resolve;
    }));
    coinflipMod.__setResolvedStakeReaderForTest(() => new Promise((resolve) => {
      finishResolved = resolve;
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };

    const el = mount();
    await flushPromises();

    assert.ok(el.querySelector('.df-coin--spinning'),
      'resolved outcome is revealable as soon as the fast API request finishes');
    assert.match(el.querySelector('[data-bind="df-funds-wallet"]').textContent, /987,654 FLIP/,
      'dashboard balance renders while chain reads remain pending');
    assert.equal(el.querySelector('[data-position="today"]').textContent, "Today's bet—",
      'the still-pending resolved-day value keeps its loading placeholder');
    assert.equal(
      el.querySelector('[data-position="tomorrow"]').querySelector('.df-position-value').textContent,
      '—',
    );
    assert.doesNotMatch(el.innerHTML, /BET AMOUNT/,
      'the compact stepper does not spend width on a redundant label');

    finishCurrent('12000000000000000000000');
    finishResolved('43844000000000000000000');
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="today"]').textContent, /•••• FLIP/,
      "today's stake stays masked before the result reveal");
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);
    el.disconnectedCallback();
  });

  test('clicking the coin reveals and dismisses its instruction', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    let revealed = 0;
    globalThis.document.addEventListener('flip:revealed', () => { revealed += 1; });

    const el = mount();
    await flushMicrotasks();

    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.equal(globalThis.localStorage.getItem('flip_day_84532_67'), '1', 'gate key written');
    assert.equal(revealed, 1, 'flip:revealed dispatched');
    assert.ok(el.querySelector('.df-coin--landed'), 'coin landed');
    assert.equal(el.querySelector('[data-bind="df-reveal-hint"]').hidden, true,
      'instruction hidden after reveal');
    el.disconnectedCallback();
  });

  test('the modifier rail waits until a real win is final, then settles vertically', async () => {
    _currentStakeWei = '12000000000000000000000';
    _fetchResponses = {
      dashboard: {
        ...dashboardPayload(),
        coinflip: {
          ...dashboardPayload().coinflip,
          depositedAmount: '12000000000000000000000',
        },
      },
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="today"]').textContent, /•••• FLIP/);
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);

    const realSetTimeout = globalThis.setTimeout;
    const realMatchMedia = globalThis.matchMedia;
    let revealDelay = 0;
    let revealFinish = null;
    const scheduled = [];
    try {
      globalThis.matchMedia = () => ({ matches: false });
      globalThis.setTimeout = (fn, delay = 0) => {
        revealDelay = Math.max(revealDelay, Number(delay) || 0);
        const handle = { fn, delay: Number(delay) || 0, unref() {} };
        scheduled.push(handle);
        if ((Number(delay) || 0) >= 4_000) revealFinish = fn;
        return handle;
      };
      el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });

      assert.equal(el.querySelector('.df-modifier-meter'), null,
        'a real win does not leak its percentage during the neutral spin');
      assert.equal(el.querySelector('[data-bind="df-outcome"]').textContent, '',
        'the animation does not add a redundant Flipping status line');
      assert.match(el.querySelector('[data-position="today"]').textContent, /Today's bet•••• FLIP/,
        'the result-day bet stays masked without leaking a modifier');
      assert.ok(revealDelay >= 4_000, `reveal has time to read before it lands (${revealDelay}ms)`);
      const rotor = el.querySelector('.df-reveal-active');
      assert.ok(rotor, 'one of the four deterministic motion tracks is active');
      assert.ok(rotor.getAttribute('data-reveal-profile'));
      assert.ok(rotor.getAttribute('data-reveal-ending'));
      const fakeoutCard = el.querySelector('[data-bind="df-fakeout-reverse-card"]');
      assert.ok(fakeoutCard, 'loss-to-win fakeout mounts the flying Reverse card');
      assert.equal(fakeoutCard.getAttribute('data-fakeout-target'), 'eth');
      assert.equal(fakeoutCard.querySelector('img').src, '/shared/reverse-flip-card.svg');
      assert.equal(typeof revealFinish, 'function');
      revealFinish();
      const meter = el.querySelector('.df-modifier-meter--settling');
      assert.ok(meter, 'the vertical percentage rail enters only after the final win');
      assert.match(meter.textContent, /196%/);

      const settle = scheduled.find((entry) => entry.delay === 700);
      assert.ok(settle, 'the rail gets a finite settle window');
      settle.fn();
      assert.equal(el.querySelector('.df-modifier-flash').textContent, '196%',
        'the rail collapses into the total multiplier');
      const flashDone = scheduled.find((entry) => entry.delay === 850);
      assert.ok(flashDone, 'the total multiplier gets a finite flash window');
      flashDone.fn();
      assert.equal(el.querySelector('.df-modifier-meter'), null);
      assert.equal(el.querySelector('.df-modifier-flash'), null,
        'no percentage UI remains after the flash');
    } finally {
      globalThis.setTimeout = realSetTimeout;
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
      el.disconnectedCallback();
    }
  });

  test('a loss only mounts the percentage rail during its win-to-loss fakeout', async () => {
    const fakeoutPlan = revealPlanning.selectFlipRevealPlan(67, false);
    assert.equal(fakeoutPlan.ending, 'win-to-loss',
      'fixture day uses the deterministic loss fakeout');
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    const realSetTimeout = globalThis.setTimeout;
    const realMatchMedia = globalThis.matchMedia;
    const scheduled = [];
    try {
      globalThis.matchMedia = () => ({ matches: false });
      globalThis.setTimeout = (fn, delay = 0) => {
        const handle = { fn, delay: Number(delay) || 0, unref() {} };
        scheduled.push(handle);
        return handle;
      };
      el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
      assert.equal(el.querySelector('.df-modifier-meter'), null,
        'the rail stays hidden through the outcome-neutral spin');
      const fakeoutCard = el.querySelector('[data-bind="df-fakeout-reverse-card"]');
      assert.ok(fakeoutCard, 'win-to-loss fakeout mounts the flying Reverse card');
      assert.equal(fakeoutCard.getAttribute('data-fakeout-target'), 'wwxrp');
      assert.match(STATUS_CSS, /@keyframes df-fakeout-reverse-tap[\s\S]*?50%/,
        'the card animation reaches the coin at the correction beat');
      assert.match(`${APP_CSS}\n${STATUS_CSS}`, /@keyframes df-reveal-end-(?:long-)?win-to-loss[\s\S]*?translate3d\(-4px/,
        'the coin jolts on the matching impact frame');
      assert.equal(fakeoutPlan.endingMs, fakeoutPlan.openingMs + 900,
        'the post-card correction gets a readable slower landing');

      const fakeoutStart = scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + fakeoutPlan.openingMs
      ));
      assert.ok(fakeoutStart, 'fakeout rail starts only after the complete mimicked win landing');
      fakeoutStart.fn();
      assert.ok(el.querySelector('.df-modifier-meter--settling'),
        'the apparent win uses the same settling thermometer as a normal win');

      const drain = scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS
          + fakeoutPlan.endingMs - 350
      ));
      assert.ok(drain, 'the thermometer drains during the correction to red');
      drain.fn();
      assert.ok(el.querySelector('.df-modifier-meter--draining'));
      assert.match(STATUS_CSS, /@keyframes df-meter-drain-to-min[\s\S]*?bottom:\s*0%/);

      const finalTimers = scheduled.filter((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + fakeoutPlan.endingMs
      ));
      assert.ok(finalTimers.length >= 2, 'meter hide and authoritative landing share the red frame');
      finalTimers[0].fn();
      assert.equal(el.querySelector('.df-modifier-meter'), null,
        'the rail disappears only after reaching minimum on the red landing');
      finalTimers.at(-1).fn();
      assert.equal(el.querySelector('[data-bind="df-fakeout-reverse-card"]'), null,
        'the decorative card leaves with the landing DOM');
    } finally {
      globalThis.setTimeout = realSetTimeout;
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
      el.disconnectedCallback();
    }
  });

  test('a double-reversal win keeps the thermometer and rebounds from red', async () => {
    let doubleDay = 1;
    while (revealPlanning.selectFlipRevealPlan(doubleDay, true).reversalCount !== 2) doubleDay += 1;
    const doublePlan = revealPlanning.selectFlipRevealPlan(doubleDay, true);
    storeMod.update('app.lastDay', { day: doubleDay, status: 'resolved' });
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: doubleDay, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    const realSetTimeout = globalThis.setTimeout;
    const realMatchMedia = globalThis.matchMedia;
    const scheduled = [];
    try {
      globalThis.matchMedia = () => ({ matches: false });
      globalThis.setTimeout = (fn, delay = 0) => {
        const handle = { fn, delay: Number(delay) || 0, unref() {} };
        scheduled.push(handle);
        return handle;
      };
      el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });

      const cards = el.querySelectorAll('[data-bind="df-fakeout-reverse-card"]');
      assert.equal(cards.length, 2, 'the rare branch mounts both Reverse cards');
      assert.deepEqual(cards.map((card) => card.getAttribute('data-fakeout-target')), ['wwxrp', 'eth'],
        'the cards alternate red before returning to the authoritative green');
      assert.equal(el.querySelector('.df-modifier-meter'), null,
        'the meter waits for the apparent green face to begin settling');

      const openingGreen = scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + doublePlan.openingMs
      ));
      assert.ok(openingGreen, 'opening green schedules the thermometer before card one appears');
      openingGreen.fn();
      assert.ok(el.querySelector('.df-modifier-meter--settling'),
        'the two-reversal win exactly mimics the normal-win thermometer');

      const drain = scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + doublePlan.openingMs + 900 - 350
      ));
      assert.ok(drain, 'the thermometer starts toward its floor before red');
      drain.fn();
      assert.ok(el.querySelector('.df-modifier-meter--draining'));

      const rebound = scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + doublePlan.openingMs + 900
      ));
      assert.ok(rebound, 'the floor contact lines up with the intermediate red landing');
      rebound.fn();
      assert.ok(el.querySelector('.df-modifier-meter--rebounding'));
      assert.ok(el.querySelector('.df-modifier-meter'),
        'the thermometer stays mounted through the intermediate red face');
      assert.match(
        STATUS_CSS,
        /@keyframes df-meter-rebound-from-min[\s\S]*?0%, 6\.086957%[^}]*bottom:\s*0%[\s\S]*?56\.521739%[^}]*\+ 30%[\s\S]*?100%[^}]*var\(--df-meter-stop/,
        'the next Reverse card carries the marker through a high overshoot and recovery',
      );

      const finalLanding = scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + doublePlan.endingMs
      ));
      assert.ok(finalLanding, 'the authoritative green landing remains scheduled');
      finalLanding.fn();
      assert.ok(el.querySelector('.df-modifier-meter--settled'),
        'the rebound hands directly into the real winning thermometer');
      assert.ok(el.querySelector('.df-modifier-meter--recovery-tail'),
        'the recovery continues beyond the green landing instead of stalling');
      assert.equal(el.querySelector('.df-modifier-meter--settling'), null,
        'the carried meter does not restart its initial scanning motion');
    } finally {
      globalThis.setTimeout = realSetTimeout;
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
      el.disconnectedCallback();
    }
  });

  test('a triple-reversal loss preserves the complete double-win meter timeline', async () => {
    let tripleDay = 1;
    while (revealPlanning.selectFlipRevealPlan(tripleDay, false).reversalCount !== 3) tripleDay += 1;
    const triplePlan = revealPlanning.selectFlipRevealPlan(tripleDay, false);
    storeMod.update('app.lastDay', { day: tripleDay, status: 'resolved' });
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: tripleDay, win: false, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    const realSetTimeout = globalThis.setTimeout;
    const realMatchMedia = globalThis.matchMedia;
    const scheduled = [];
    try {
      globalThis.matchMedia = () => ({ matches: false });
      globalThis.setTimeout = (fn, delay = 0) => {
        const handle = { fn, delay: Number(delay) || 0, unref() {} };
        scheduled.push(handle);
        return handle;
      };
      el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });

      const cards = el.querySelectorAll('[data-bind="df-fakeout-reverse-card"]');
      assert.equal(cards.length, 3);
      assert.deepEqual(
        cards.map((card) => card.getAttribute('data-fakeout-target')),
        ['wwxrp', 'eth', 'wwxrp'],
      );

      scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + triplePlan.openingMs
      )).fn();
      scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + triplePlan.openingMs + 900 - 350
      )).fn();
      scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + triplePlan.openingMs + 900
      )).fn();
      assert.ok(el.querySelector('.df-modifier-meter--rebounding'),
        'the first red landing retains the rail exactly like the double-reversal win');

      const middleGreenReset = scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + triplePlan.openingMs + 1800
      ));
      assert.equal(middleGreenReset, undefined,
        'the shared second-green frame does not remount or restart the retained rail');

      const finalDrain = scheduled.find((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS
          + triplePlan.endingMs - 650
      ));
      assert.ok(finalDrain, 'the terminal sweep starts as soon as the shared recovery completes');
      finalDrain.fn();
      assert.ok(el.querySelector('.df-modifier-meter--terminal-draining'));
      assert.match(
        STATUS_CSS,
        /@keyframes df-meter-terminal-drain[\s\S]*?from[^}]*var\(--df-meter-stop[\s\S]*?to[^}]*bottom:\s*0%/,
        'the uninterrupted terminal sweep reaches the floor on the final red frame',
      );

      const finalTimers = scheduled.filter((entry) => (
        entry.delay === revealPlanning.REVEAL_TRACK_MS + triplePlan.endingMs
      ));
      assert.ok(finalTimers.length >= 2, 'the terminal hide and loss landing share one frame');
      finalTimers[0].fn();
      assert.equal(el.querySelector('.df-modifier-meter'), null,
        'the retained thermometer disappears only at the final red landing');
    } finally {
      globalThis.setTimeout = realSetTimeout;
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
      el.disconnectedCallback();
    }
  });

  test('click → flip_day key + flip:revealed + green ETH face on WIN', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    let revealed = 0;
    globalThis.document.addEventListener('flip:revealed', () => { revealed += 1; });

    const el = mount();
    await flushMicrotasks();

    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.equal(globalThis.localStorage.getItem('flip_day_84532_67'), '1', 'gate key written');
    assert.equal(revealed, 1, 'flip:revealed dispatched (balances strip unfuzz signal)');
    const landed = el.querySelector('.df-coin--landed');
    assert.ok(landed, 'coin landed (fakeDOM = reduced motion, instant)');
    assert.equal(landed.querySelector('img').src, '/shared/coinflip-face-eth.svg', 'green ETH face = WIN');
    const outcome = el.querySelector('[data-bind="df-outcome"]');
    assert.equal(outcome.textContent, '', 'the old result line is empty on a win');
    const today = el.querySelector('[data-position="today"]');
    assert.equal(today.querySelector('.df-position-multiplier').textContent, '196%',
      'the payout modifier sits at the left of the resolved row');
    assert.equal(today.querySelector('.df-position-value').textContent, 'WIN +85,934 FLIP',
      "Today's Bet becomes the single win receipt");
    assert.ok(today.className.includes('df-position-row--win'));
    assert.equal(el.querySelector('.df-modifier-meter'), null,
      'reduced-motion reveal does not retain a percentage rail');
    assert.equal(el.querySelector('.df-modifier-result'), null,
      'there is no duplicate permanent result display');
    el.disconnectedCallback();
  });

  test('revealed LOSS day → red face + explicit signed Today result', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: false, rewardPercent: 96 } };
    globalThis.localStorage.setItem('flip_day_84532_67', '1');

    const el = mount();
    await flushMicrotasks();

    const landed = el.querySelector('.df-coin--landed');
    assert.ok(landed, 'landed face rendered immediately');
    assert.equal(landed.querySelector('img').src, '/shared/coinflip-face-red.svg', 'red face = LOSS');
    const outcome = el.querySelector('[data-bind="df-outcome"]');
    assert.equal(outcome.textContent, '', 'the separate result line stays gone');
    const today = el.querySelector('[data-position="today"]');
    assert.equal(today.querySelector('.df-position-multiplier'), null,
      'a losing receipt never shows a payout modifier');
    assert.equal(today.querySelector('.df-position-value').textContent, 'LOSS -43,844 FLIP',
      'the loss is reported directly in Today’s Bet');
    assert.ok(today.className.includes('df-position-row--loss'));
    assert.equal(el.querySelector('.df-modifier-meter'), null,
      'loss clears the scanner instead of settling on a modifier');
    el.disconnectedCallback();
  });

  for (const won of [true, false]) {
    test(`a resolved zero-stake ${won ? 'win' : 'loss'} shows the same red NO BET receipt`, async () => {
      _resolvedStakeWei = '0';
      _fetchResponses = {
        dashboard: dashboardPayload(),
        flipDay: { day: 67, win: won, rewardPercent: 96 },
      };
      globalThis.localStorage.setItem('flip_day_84532_67', '1');

      const el = mount();
      await flushMicrotasks();

      const today = el.querySelector('[data-position="today"]');
      assert.equal(today.querySelector('.df-position-value').textContent, 'NO BET');
      assert.equal(today.querySelector('.df-position-multiplier'), null,
        'zero stake never shows the global win multiplier');
      assert.ok(today.className.includes('df-position-row--no-bet'));
      assert.ok(today.querySelector('.df-position-value').className.includes('df-position-value--no-bet'));
      el.disconnectedCallback();
    });
  }

  test('stacked day bets and red funds keep unresolved values masked', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    await flushMicrotasks();

    const rows = el.querySelectorAll('.df-position-row');
    assert.equal(rows.length, 2, 'today + tomorrow stay as separate boxes');
    const text = rows.map((r) => r.textContent).join(' | ');
    assert.match(text, /Today's bet/, 'resolved-day box is retained');
    assert.doesNotMatch(el.innerHTML, /BET AMOUNT/,
      'the input lane leaves its width to the amount and Tomorrow total');
    assert.equal(
      el.querySelector('[data-position="tomorrow"]').querySelector('.df-position-label').textContent,
      "Tomorrow's bet",
      'the Tomorrow title sits in the value lane above its FLIP total',
    );
    assert.match(el.querySelector('[data-position="today"]').textContent, /•••• FLIP/,
      'today is masked before reveal without leaking digit count');
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /43,844 FLIP/,
      'tomorrow remains visible');
    assert.equal(el.querySelector('[data-bind="df-funds-claimable"]').textContent, '•••• FLIP',
      'claimable is masked before reveal');
    assert.match(el.querySelector('[data-bind="df-funds-wallet"]').textContent, /987,654 FLIP/,
      'wallet remains visible');
    assert.equal(el.querySelectorAll('.df-position-delta').length, 0,
      'ordinary indexed values do not carry settlement markers');
    const displays = el.querySelectorAll('.df-funds__display');
    assert.equal(displays.length, 3);
    assert.ok(displays[0].classList.contains('df-funds__display--claimable'),
      'claimable is the top funds box');
    assert.ok(displays[1].classList.contains('df-funds__display--wallet'),
      'wallet stays below claimable');
    assert.ok(displays[2].classList.contains('df-funds__display--sdgnrs'),
      'sDGNRS is the new bottom funds box');
    assert.match(
      APP_CSS,
      /body\.layout-basic \.df-funds__value\s*\{[^}]*text-align:\s*right/s,
      'coinflip Claimable and Wallet figures are right aligned',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.df-position-label,[\s\S]*?body\.layout-basic \.df-funds__label\s*\{\s*text-align:\s*right/s,
      'all four red-box titles align above the right-aligned FLIP figures',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.df-position\s*\{\s*margin:\s*auto 0 0\.42rem;/s,
      'the Today/Tomorrow stack pushes down onto the Claimable/Wallet stack',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.df-funds\s*\{[^}]*margin-top:\s*0;[^}]*padding-top:\s*0;/s,
      'the two ledger stacks meet without a floating gap',
    );
    assert.match(APP_CSS,
      /\.df-modifier-meter-slot\s*\{[^}]*position:\s*absolute[^}]*left:/s,
      'modifier rail is pinned on the left and cannot shift the ledger');
    assert.match(APP_CSS,
      /\.df-modifier-meter__marker\s*\{[^}]*bottom:/s,
      'modifier marker travels vertically');
    assert.match(APP_CSS,
      /\.df-next-bet__stepper\s*\{[^}]*height:\s*1\.65rem/s,
      'the amount stepper stays short inside the Tomorrow row');
    const claim = el.querySelector('[data-bind="df-claim-flip-cta"]');
    assert.ok(claim.disabled, 'claim stays unlit while its balance is masked');
    el.disconnectedCallback();
  });

  test("Today's bet never falls back to tomorrow's newer dashboard stake", async () => {
    _resolvedStakeWei = null;
    _currentStakeWei = '12000000000000000000000';
    _fetchResponses = {
      dashboard: {
        ...dashboardPayload(),
        coinflip: {
          ...dashboardPayload().coinflip,
          depositedAmount: '12000000000000000000000',
        },
      },
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-position="today"]').textContent, "Today's bet—",
      'an unavailable exact-day read shows unknown instead of a wrong next-day amount');
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    assert.equal(globalThis.localStorage.getItem('flip_day_84532_67'), null,
      'reveal waits rather than settling against the newer dashboard stake');
    assert.match(el.querySelector('[data-bind="df-error"]').textContent, /credited bet is still loading/i);
    el.disconnectedCallback();
  });

  test("Tomorrow's bet never falls back to the resolved dashboard stake", async () => {
    _currentStakeWei = null;
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.equal(
      el.querySelector('[data-position="tomorrow"]').querySelector('.df-position-value').textContent,
      '—',
      'an unavailable live read never resurrects the resolved-day dashboard amount');
    assert.match(el.querySelector('[data-position="today"]').textContent, /196%WIN \+85,934 FLIP/,
      'the resolved payout is shown in its own box after reveal');
    assert.equal(el.querySelector('.df-modifier-result'), null,
      'the old expanded result is gone');
    el.disconnectedCallback();
  });

  test('a win unmasks today and claimable while preserving tomorrow separately', async () => {
    _currentStakeWei = '12000000000000000000000'; // current day: 12,000 FLIP
    _fetchResponses = {
      dashboard: {
        ...dashboardPayload(),
        coinflip: {
          ...dashboardPayload().coinflip,
          depositedAmount: '12000000000000000000000',
        },
      },
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    assert.match(el.querySelector('[data-position="today"]').textContent, /•••• FLIP/,
      "before reveal, today's result stake is masked");
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);
    assert.equal(el.querySelector('[data-bind="df-funds-claimable"]').textContent, '•••• FLIP');
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    const today = el.querySelector('[data-position="today"]');
    const tomorrow = el.querySelector('[data-position="tomorrow"]');
    const claimable = el.querySelector('[data-bind="df-funds-claimable"]');
    const balance = el.querySelector('[data-bind="df-funds-wallet"]');
    assert.match(today.textContent, /Today's bet196%WIN \+85,934 FLIP/,
      "after reveal, today's exact result is unmasked");
    assert.equal(today.querySelector('.df-position-multiplier').textContent, '196%');
    assert.ok(today.querySelector('.df-position-value').className.includes('--win'),
      'the positive result receives the green treatment');
    assert.match(tomorrow.textContent, /12,000 FLIP/,
      "tomorrow's unresolved stake remains separate");
    assert.equal(el.querySelectorAll('.df-position-delta').length, 0,
      'the win/loss amount is no longer duplicated beside ledger values');
    assert.match(claimable.textContent, /4,612,331 FLIP/,
      'claimable includes principal plus the 96% winning modifier');
    assert.equal(el.querySelector('.df-modifier-result'), null,
      'the resolved row is the only persistent result');
    assert.match(balance.textContent, /987,654 FLIP/,
      'the already-burned wallet balance does not move again at reveal');

    // A refresh can still return the resolved day as depositedAmount. The
    // contract read remains authoritative for the current day.
    storeMod.update('viewing.address', TEST_ADDR);
    await flushMicrotasks();

    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/,
      'a stale dashboard refresh cannot resurrect the resolved stake');
    assert.match(el.querySelector('[data-bind="df-funds-claimable"]').textContent, /4,612,331 FLIP/,
      'resolved payout survives a stale claimable baseline refresh');

    _currentStakeWei = '10000000000000000000000';
    storeMod.update('viewing.address', TEST_ADDR);
    await flushMicrotasks();

    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /10,000 FLIP/,
      'a changed current-day chain stake appears after refresh');
    el.disconnectedCallback();
  });

  test('a win unmasks the live chain claimable even while the dashboard is stale', async () => {
    const exactClaimable = 4_612_331n * 10n ** 18n;
    coinflipMod.__setClaimableReaderForTest(async () => exactClaimable);
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="df-funds-claimable"]').textContent, '•••• FLIP');
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.match(el.querySelector('[data-bind="df-funds-claimable"]').textContent, /4,612,331 FLIP/,
      'the post-reveal ledger comes from previewClaimCoinflips, not the stale player endpoint');
    el.disconnectedCallback();
  });

  test('reload repairs an older receipt with the authoritative resolved-day total', async () => {
    _currentStakeWei = '12000000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    el.disconnectedCallback();
    el.remove();

    const settlementKey = `flip_settlement_84532_67_${TEST_ADDR}`;
    const staleReceipt = JSON.parse(globalThis.localStorage.getItem(settlementKey));
    staleReceipt.betWei = _currentStakeWei; // old bug: tomorrow's stake saved as today's
    globalThis.localStorage.setItem(settlementKey, JSON.stringify(staleReceipt));

    const reloaded = mount();
    await flushMicrotasks();
    assert.match(reloaded.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/,
      'reload reads the current-day stake independently of the saved result');
    assert.match(reloaded.querySelector('[data-position="today"]').textContent,
      /Today's bet196%WIN \+85,934 FLIP/,
      'reload keeps the repaired resolved payout in today');
    assert.match(reloaded.querySelector('[data-bind="df-funds-claimable"]').textContent, /4,612,331 FLIP/,
      'saved result keeps the full payout resolved');
    assert.equal(reloaded.querySelectorAll('.df-position-delta').length, 0,
      'reload does not duplicate the amount outside the result copy');
    assert.equal(reloaded.querySelector('.df-modifier-result'), null,
      'reload does not restore the obsolete result display');
    assert.equal(
      JSON.parse(globalThis.localStorage.getItem(settlementKey)).betWei,
      _resolvedStakeWei,
      'corrected result receipt is persisted for future reloads',
    );
    reloaded.disconnectedCallback();
  });

  test('a revealed loss stays in Today while retaining the next-day bet', async () => {
    _currentStakeWei = '9000000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    const today = el.querySelector('[data-position="today"]');
    const tomorrow = el.querySelector('[data-position="tomorrow"]');
    const claimable = el.querySelector('[data-bind="df-funds-claimable"]');
    assert.match(today.textContent, /Today's betLOSS -43,844 FLIP/);
    assert.match(tomorrow.textContent, /9,000 FLIP/);
    assert.match(claimable.textContent, /4,526,397 FLIP/,
      'loss leaves the prior claimable balance untouched');
    assert.equal(el.querySelectorAll('.df-position-delta').length, 0);
    assert.equal(today.querySelector('.df-position-value').textContent, 'LOSS -43,844 FLIP',
      'the burned resolved-day stake is the explicit signed loss result');
    assert.equal(el.querySelector('[data-bind="df-outcome"]').textContent, '',
      'there is no second loss result');

    storeMod.update('viewing.address', TEST_ADDR);
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /9,000 FLIP/,
      'current-day stake survives a loss and refresh');
    el.disconnectedCallback();
  });

  test('action buttons: Add Bet present (data-write); Claim DGNRS and duplicate redeem controls GONE', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    await flushMicrotasks();

    const flip = el.querySelector('[data-bind="df-flip-cta"]');
    assert.ok(flip, 'Add Bet CTA');
    assert.match(el.innerHTML, /aria-label="Add bet"[^>]*>ADD BET<\/button>/,
      'the transaction control names its full Add Bet action');
    const amount = el.querySelector('[name="df-amount"]');
    amount.value = '54000';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(flip.title, 'Bet 54k', 'button tooltip abbreviates the entered stake');
    el.querySelector('[data-bind="df-bet-up"]').dispatchEvent({ type: 'click' });
    assert.equal(amount.value, '54100', 'custom up arrow adds the explicit 100 FLIP step');
    el.querySelector('[data-bind="df-bet-down"]').dispatchEvent({ type: 'click' });
    assert.equal(amount.value, '54000', 'custom down arrow removes the same step');
    assert.ok(
      el.innerHTML.indexOf('data-bind="df-add-bet-controls"')
        < el.innerHTML.indexOf('data-bind="df-position-tomorrow"'),
      'the amount + Add Bet group is laid out to the left of Tomorrow’s Bet',
    );
    assert.equal(el.querySelector('[data-bind="df-claim-cta"]'), null,
      'Claim DGNRS CTA removed from the coinflip column');
    assert.ok(!/Claim DGNRS/.test(el.innerHTML), 'no claim label in markup');
    assert.equal(el.querySelector('[data-bind="df-redeem-group"]'), null,
      'FLIP redemption lives only in the purchase panel');
    el.disconnectedCallback();
  });

  test('bottom sDGNRS box shows the DB balance and opens an amount-confirmed burn', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    const box = el.querySelector('[data-bind="df-funds-sdgnrs-box"]');
    const value = el.querySelector('[data-bind="df-funds-sdgnrs"]');
    const burn = el.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    assert.ok(box, 'sDGNRS is a third, bottom funds box');
    assert.equal(value.textContent, '123M sDGNRS', 'large sDGNRS balances abbreviate to whole millions');
    assert.equal(burn.disabled, false, 'the owner can open the burn flow with at least 1 sDGNRS');
    assert.match(el.innerHTML, /class="sdgnrs-badge df-sdgnrs-badge"/,
      'the balance uses the same normal Degenerus badge as sDGNRS rewards');
    assert.match(el.innerHTML, /crypto_06_ethereum_purple\.svg/,
      'the sDGNRS badge has the purple currency frame');
    assert.match(el.innerHTML, /special_eth\.svg/,
      'the sDGNRS badge carries the ETH mark with three flames');
    assert.match(APP_CSS, /\.df-funds__display--sdgnrs\s*\{[^}]*grid-template-areas:\s*"badge claim label"/s,
      'the badge has a dedicated slot and cannot overlap the burn control');
    assert.ok(
      el.innerHTML.indexOf('data-bind="df-funds-wallet-box"')
        < el.innerHTML.indexOf('data-bind="df-funds-sdgnrs-box"'),
      'sDGNRS sits below the wallet box',
    );
    assert.ok(
      el.innerHTML.indexOf('data-bind="df-burn-sdgnrs-cta"')
        < el.innerHTML.indexOf('<span class="df-funds__label">sDGNRS</span>'),
      'Burn is laid out on the left of the label and balance',
    );

    burn.dispatchEvent({ type: 'click' });
    const dialog = el.querySelector('[data-bind="df-burn-dialog"]');
    const input = el.querySelector('[name="df-sdgnrs-amount"]');
    assert.equal(dialog.hidden, false, 'Burn opens the explicit amount confirmation');
    assert.equal(input.value, '1', 'the destructive action defaults to the contract minimum');
    assert.match(el.innerHTML, /25%–175% of the previewed ETH value/,
      'confirmation explains the delayed RNG range');
    assert.ok(el.querySelector('[data-bind="df-burn-expected"]'),
      'confirmation reserves a live expected-value readout');

    el.querySelector('[data-bind="df-burn-max"]').dispatchEvent({ type: 'click' });
    assert.equal(input.value, '123450000', 'MAX preserves the exact burnable balance');
    assert.equal(el.querySelector('[data-bind="df-burn-accept"]').disabled, false);

    dialog.dispatchEvent({ type: 'click', target: dialog });
    assert.equal(dialog.hidden, true, 'clicking the backdrop cancels without burning');
    el.disconnectedCallback();
  });

  test('clicking a coinflip quest fills its exact FLIP target without placing the bet', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    document.dispatchEvent({
      type: 'quest:activate',
      detail: { questType: 2, target: String(2_000n * (10n ** 18n)), variant: 'secondary' },
    });

    const amount = el.querySelector('[name="df-amount"]');
    const add = el.querySelector('[data-bind="df-flip-cta"]');
    assert.equal(amount.value, '2000', '18-decimal quest target becomes an ordinary FLIP input');
    assert.equal(add.title, 'Bet 2k', 'the normal form UI reflects the configured quest amount');
    assert.equal(_currentStakeWei, '43844000000000000000000',
      'configuring a quest does not submit or mutate the live bet');

    el.disconnectedCallback();
    amount.value = '1';
    document.dispatchEvent({
      type: 'quest:activate',
      detail: { questType: 2, target: String(3_000n * (10n ** 18n)) },
    });
    assert.equal(amount.value, '1', 'disconnect removes the document-level quest shortcut');
  });

  test('Reverse card appears only after reveal and opens a priced confirmation dialog', async () => {
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({
      queued: 3n,
      locked: false,
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="df-reverse-cta"]'), null,
      'no reverse control is shown before the result reveal');
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    const button = el.querySelector('[data-bind="df-reverse-cta"]');
    assert.ok(button, 'Reverse card appears beside the landed coin');
    assert.equal(button.getAttribute('data-reverse-target'), 'wwxrp');
    assert.ok(button.classList.contains('df-reversi-card--target-wwxrp'),
      'an odd/ETH current side makes the next-reversal card red for WWXRP');
    button.dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="df-reverse-dialog"]').hidden, false,
      'the card opens the confirmation dialog');
    assert.equal(el.querySelector('[data-bind="df-reverse-cost"]').textContent, '338 FLIP');
    assert.equal(el.querySelector('[data-bind="df-reverse-accept"]').textContent,
      'Accept · 338 FLIP');
    const sideBadge = el.querySelector('[data-bind="df-reverse-side-img"]');
    assert.equal(el.querySelector('[data-bind="df-reverse-side"]'), null,
      'the side name is not printed beside the badge');
    assert.equal(sideBadge.src,
      '/shared/coinflip-face-eth.svg');
    assert.equal(sideBadge.alt, 'ETH — odd side');
    assert.match(el.innerHTML, /data-bind="df-reverse-accept"/);
    assert.match(el.innerHTML, /\/shared\/reverse-flip-card\.svg/);
    assert.match(el.innerHTML, /reverses the outcome of the next flip/i);
    assert.match(el.innerHTML, /alters all jackpot outcomes/i);

    const dialog = el.querySelector('[data-bind="df-reverse-dialog"]');
    dialog.dispatchEvent({ type: 'click', target: dialog });
    assert.equal(dialog.hidden, true, 'clicking the backdrop dismisses the Reverse Flip view');
    assert.equal(el.querySelector('.df-coin--landed').querySelector('img').src,
      '/shared/coinflip-face-eth.svg',
      'after dismissal the main coin shows the live odd/ETH side, not the prior loss face');
    el.disconnectedCallback();
  });

  test('Reverse card is hidden while RNG is locked', async () => {
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({
      queued: 2n,
      locked: true,
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    const reverseCard = el.querySelector('[data-bind="df-reverse-cta"]');
    assert.equal(reverseCard.hidden, true, 'locked RNG removes the Reverse icon');
    assert.equal(reverseCard.getAttribute('data-reverse-target'), 'eth');
    assert.ok(reverseCard.classList.contains('df-reversi-card--target-eth'),
      'an even/WWXRP current side makes the next-reversal card green for ETH');
    const accept = el.querySelector('[data-bind="df-reverse-accept"]');
    assert.equal(el.querySelector('[data-bind="df-reverse-side-img"]').src,
      '/shared/coinflip-face-red.svg');
    assert.equal(el.querySelector('[data-bind="df-reverse-side-img"]').alt,
      'WWXRP — even side');
    assert.equal(el.querySelector('[data-bind="df-reverse-dialog"]').hidden, true,
      'there is no locked confirmation flow to open');
    assert.equal(el.querySelector('[data-bind="df-reverse-cost"]').textContent, 'RNG locked');
    assert.equal(accept.textContent, 'RNG locked');
    assert.equal(accept.disabled, true);
    el.disconnectedCallback();
  });

  test('flip action with zero amount renders an error via textContent', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    await flushMicrotasks();

    const input = el.querySelector('[name="df-amount"]');
    input.value = '0';
    el.querySelector('[data-bind="df-flip-cta"]').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    const err = el.querySelector('[data-bind="df-error"]');
    assert.equal(err.hidden, false, 'error visible');
    assert.match(err.textContent, /greater than 0/, 'validation message');
    el.disconnectedCallback();
  });
});

describe('new-day rollover (codex-found race)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    coinflipMod.__setCurrentStakeReaderForTest(async () => _currentStakeWei);
    coinflipMod.__setResolvedStakeReaderForTest(async () => _resolvedStakeWei);
    coinflipMod.__setClaimableReaderForTest(async () => null);
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({
      queued: 0n,
      locked: false,
    }));
    storeMod.update('connected.address', TEST_ADDR);
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });
    await import('../app-daily-flip.js');
  });

  afterEach(() => {
    coinflipMod.__resetCurrentStakeReaderForTest();
    coinflipMod.__resetResolvedStakeReaderForTest();
    coinflipMod.__resetClaimableReaderForTest();
    coinflipMod.__resetReverseFlipQuoteReaderForTest();
  });

  test('a coin rendered for the old day cannot mark the NEW day revealed', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    await flushMicrotasks();

    const oldCoin = el.querySelector('.df-coin--spinning');
    assert.ok(oldCoin, 'day-67 coin rendered');

    // Day 68 arrives; its flip result hasn't been fetched yet.
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    storeMod.update('app.lastDay', { day: 68, status: 'resolved' });

    // Stale click on the day-67 coin element (listener still holds `this`).
    oldCoin.dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.equal(globalThis.localStorage.getItem('flip_day_84532_68'), null,
      'stale click did NOT reveal day 68');
    assert.equal(globalThis.localStorage.getItem('flip_day_84532_67'), null,
      'nor did it write the old day post-rollover');
    el.disconnectedCallback();
  });
});
