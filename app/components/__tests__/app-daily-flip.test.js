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
import * as contractsMod from '../../app/contracts.js';
import * as pendingActionsMod from '../../app/pending-actions.js';
import * as charityVoteMod from '../../app/charity-vote.js';
import * as jackpotSfxMod from '../../app/jackpot-sfx.js';
import { invalidateJSONCache } from '../../app/api.js';

const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const STATUS_CSS = readFileSync(new URL('../../styles/status-indicators.css', import.meta.url), 'utf8');
const BOUNTY_CSS = readFileSync(new URL('../../styles/records-rail.css', import.meta.url), 'utf8');

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

let _fetchResponses = {
  dashboard: null, flipDay: null, gameState: null, baf: null, coinflipStats: null,
};
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
  } else if (/\/game\/state$/.test(u)) {
    if (_fetchResponses.gameState != null) {
      return { ok: true, status: 200, json: async () => _fetchResponses.gameState };
    }
  } else if (/\/player\/0x[0-9a-f]+\/baf\?level=\d+$/i.test(u)) {
    if (_fetchResponses.baf != null) {
      return { ok: true, status: 200, json: async () => _fetchResponses.baf };
    }
  } else if (/\/game\/coinflip\/stats$/i.test(u)) {
    return {
      ok: true,
      status: 200,
      json: async () => _fetchResponses.coinflipStats ?? { wins: 0, losses: 0, recent: [] },
    };
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
  // Most widget tests exercise ledger behavior after the jackpot presentation.
  // Opt those tests into the normal cleared state; spoiler-gate regressions
  // explicitly remove this marker below.
  globalThis.localStorage.setItem('jackpot_complete_day_84532_67', '1');
  pendingActionsMod.__resetPendingActionsForTest();
  _docListeners.clear();
  _fetchResponses = {
    dashboard: null, flipDay: null, gameState: null, baf: null, coinflipStats: null,
  };
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

async function waitForText(getElement, pattern, timeoutMs = 1_000) {
  const startedAt = Date.now();
  let element = getElement();
  while (!pattern.test(element?.textContent || '')) {
    if (Date.now() - startedAt >= timeoutMs) {
      assert.match(element?.textContent || '', pattern);
    }
    await flushMicrotasks();
    element = getElement();
  }
}

function dashboardPayload() {
  return {
    player: TEST_ADDR,
    flipBalance: '987654000000000000000000',       // 987,654 FLIP
    wwxrpBalance: '12345000000000000000000',        // 12,345 WWXRP
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
  test('normalizes protocol-wide coinflip totals and only the fifteen newest valid results', () => {
    assert.deepEqual(revealPlanning.normalizeProtocolCoinflipStats({
      wins: '27',
      losses: 19.9,
      recent: [
        ...Array.from({ length: 16 }, (_, index) => ({ day: 50 - index, win: index % 2 === 0 })),
        { day: 0, win: true },
      ],
    }), {
      wins: 27,
      losses: 19,
      recent: Array.from({ length: 15 }, (_, index) => ({
        day: 50 - index,
        win: index % 2 === 0,
      })),
    });
  });

  test('rebuilds the protocol record from every global day when the dedicated route is absent', async () => {
    const paths = [];
    const fetcher = async (path) => {
      paths.push(path);
      if (path === '/game/coinflip/stats') {
        throw Object.assign(new Error('missing route'), { status: 404 });
      }
      if (path.endsWith('/4')) return { day: 4, win: true };
      if (path.endsWith('/3')) return { day: 3, win: true };
      if (path.endsWith('/2')) return { day: 2, win: false };
      if (path.endsWith('/1')) throw Object.assign(new Error('unresolved'), { status: 404 });
      throw new Error(`Unexpected path ${path}`);
    };

    assert.deepEqual(await revealPlanning.loadProtocolCoinflipStats(4, fetcher), {
      wins: 2,
      losses: 1,
      recent: [{ day: 4, win: true }, { day: 3, win: true }, { day: 2, win: false }],
    });
    assert.deepEqual(paths, [
      '/game/coinflip/stats',
      '/game/coinflip/day/4',
      '/game/coinflip/day/3',
      '/game/coinflip/day/2',
      '/game/coinflip/day/1',
    ]);

    paths.length = 0;
    await revealPlanning.loadProtocolCoinflipStats(4, fetcher);
    assert.deepEqual(paths, [
      '/game/coinflip/stats',
      '/game/coinflip/day/1',
    ], 'settled global outcomes are immutable and reused; only the unresolved day retries');
  });

  test('holds the newest global result outside the board until that reveal lands', () => {
    const indexed = { wins: 28, losses: 19, recent: [{ day: 67, win: true }, { day: 66, win: false }] };
    assert.deepEqual(revealPlanning.protocolCoinflipStatsForReveal(indexed, {
      day: 67,
      result: { win: true },
      revealComplete: false,
    }), {
      wins: 27,
      losses: 19,
      recent: [{ day: 66, win: false }],
    });

    const buffered = {
      wins: 40,
      losses: 31,
      recent: Array.from({ length: 16 }, (_, index) => ({
        day: 80 - index,
        win: index % 2 === 0,
      })),
    };
    const hidden = revealPlanning.protocolCoinflipStatsForReveal(buffered, {
      day: 80,
      result: { win: true },
      revealComplete: false,
    });
    assert.equal(hidden.recent.length, 15,
      'hiding today backfills the prior result so Last 15 remains full');
    assert.equal(hidden.recent.some((row) => row.day === 80), false);
    assert.equal(hidden.recent.at(-1).day, 65,
      'the sixteenth fetched result becomes the fifteenth visible result');
    assert.deepEqual(revealPlanning.protocolCoinflipStatsForReveal(indexed, {
      day: 67,
      result: { win: true },
      revealComplete: true,
    }), indexed);
    assert.deepEqual(revealPlanning.protocolCoinflipStatsForReveal(indexed, {
      day: 67,
      revealComplete: false,
    }), {
      wins: 27,
      losses: 19,
      recent: [{ day: 66, win: false }],
    }, 'the indexed recent row hides its own outcome even before the day-result request catches up');
  });

  test('the multiplier number uses red at 150 and blue from 250 upward', () => {
    assert.equal(revealPlanning.dailyFlipMultiplierTone(149), 'low');
    assert.equal(revealPlanning.dailyFlipMultiplierTone(150), 'low');
    assert.equal(revealPlanning.dailyFlipMultiplierTone(151), null);
    assert.equal(revealPlanning.dailyFlipMultiplierTone(249), null);
    assert.equal(revealPlanning.dailyFlipMultiplierTone(250), 'high');
    assert.equal(revealPlanning.dailyFlipMultiplierTone(300), 'high');
  });

  test('sDGNRS stays within three significant figures and promotes suffix carries', () => {
    const unit = 10n ** 18n;
    assert.equal(revealPlanning.formatSdgnrsBalance(999n * unit), '999');
    assert.equal(revealPlanning.formatSdgnrsBalance(0n), '0');
    assert.equal(revealPlanning.formatSdgnrsBalance(9_999n * unit), '10.0K');
    assert.equal(revealPlanning.formatSdgnrsBalance(10_000n * unit), '10.0K');
    assert.equal(revealPlanning.formatSdgnrsBalance(12_345n * unit), '12.3K');
    assert.equal(revealPlanning.formatSdgnrsBalance(999_999n * unit), '1.00M');
    assert.equal(revealPlanning.formatSdgnrsBalance(9_876_543n * unit), '9.88M');
    assert.equal(revealPlanning.formatSdgnrsBalance(9_999_999n * unit), '10.0M');
    assert.equal(revealPlanning.formatSdgnrsBalance(10_000_000n * unit), '10.0M');
    assert.equal(revealPlanning.formatSdgnrsBalance(10_450_000n * unit), '10.5M');
    assert.equal(revealPlanning.formatSdgnrsBalance(99_900_000n * unit), '99.9M');
    assert.equal(revealPlanning.formatSdgnrsBalance(100_000_000n * unit), '100M');
    assert.equal(revealPlanning.formatSdgnrsBalance(123_450_000n * unit), '123M');
  });

  test("Tomorrow's Bet keeps at most four significant whole-FLIP digits", () => {
    const unit = 10n ** 18n;
    assert.equal(revealPlanning.formatTomorrowBet(43_844n * unit), '43,840');
    assert.equal(revealPlanning.formatTomorrowBet(123_456n * unit), '123,500');
    assert.equal(revealPlanning.formatTomorrowBet(12_345_678n * unit), '12,350,000');
  });

  test('BAF eve is only the unlocked final-purchase day before an x10 level', () => {
    const quote = (overrides = {}) => ({
      lvl: 39,
      inJackpotPhase: false,
      lastPurchaseDay_: true,
      rngLocked_: false,
      ...overrides,
    });
    assert.deepEqual(
      coinflipMod.bafFlipEveFromPurchaseInfo(quote()),
      { currentLevel: 39, targetLevel: 40 },
    );
    assert.equal(coinflipMod.bafFlipEveFromPurchaseInfo(quote({ lvl: 38 })), null);
    assert.equal(coinflipMod.bafFlipEveFromPurchaseInfo(quote({ lastPurchaseDay_: false })), null);
    assert.equal(coinflipMod.bafFlipEveFromPurchaseInfo(quote({ rngLocked_: true })), null);
    assert.equal(coinflipMod.bafFlipEveFromPurchaseInfo(quote({ inJackpotPhase: true })), null);
    assert.deepEqual(
      coinflipMod.bafFinalPurchaseDayFromPurchaseInfo(quote({ lvl: 40, rngLocked_: true })),
      { currentLevel: 40, targetLevel: 40, rngLocked: true },
      'the BAF rail keeps the locked final-day state after level pre-promotion',
    );
  });

  test('upcoming bonus preview mirrors ordinary, x0, and post-turbo contract days', () => {
    const reads = (overrides = {}) => ({
      purchaseInfo: {
        lvl: 31,
        inJackpotPhase: true,
        lastPurchaseDay_: false,
        rngLocked_: false,
        ...(overrides.purchaseInfo || {}),
      },
      compressionTier: overrides.compressionTier ?? 0,
      growthState: { currentLevel: 31, phaseDay: overrides.phaseDay ?? 1 },
    });
    assert.deepEqual(coinflipMod.upcomingFlipBonusFromGameReads(reads()), {
      level: 31, points: 2, kind: 'standard', reason: 'jackpot',
    });
    assert.deepEqual(coinflipMod.upcomingFlipBonusFromGameReads(reads({
      purchaseInfo: { lvl: 40 },
    })), { level: 40, points: 6, kind: 'x0', reason: 'jackpot' });
    assert.deepEqual(coinflipMod.upcomingFlipBonusFromGameReads(reads({
      purchaseInfo: { lvl: 40, inJackpotPhase: false, lastPurchaseDay_: false },
      compressionTier: 2,
      phaseDay: 0,
    })), { level: 40, points: 6, kind: 'x0', reason: 'post-turbo' });
    assert.equal(coinflipMod.upcomingFlipBonusFromGameReads(reads({ phaseDay: 2 })), null);
    assert.equal(coinflipMod.upcomingFlipBonusFromGameReads(reads({
      purchaseInfo: { rngLocked_: true },
    })), null, 'a locked flip is already underway, not upcoming');
  });

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
    assert.equal(revealPlanning.REVERSE_CARD_ENTRY_WAIT_MS, 100);
    assert.equal(revealPlanning.REVERSE_CARD_ANIMATION_MS, 600);
    for (let day = 1; day <= 250; day += 1) {
      const fakePct = revealPlanning.fakeoutModifierPercent(day);
      assert.ok(fakePct >= 72 && fakePct <= 138,
        `loss fakeout ${day} stays away from the thermometer floor and ceiling`);
      assert.equal(fakePct, revealPlanning.fakeoutModifierPercent(day),
        'the presentation-only loss modifier is stable for the whole day');
    }
    for (const ending of [
      'double-to-win', 'double-to-loss', 'triple-to-win', 'triple-to-loss',
    ]) {
      assert.match(
        APP_CSS,
        new RegExp(`\\.df-reveal-ending--${ending}\\s*\\{[^}]*--df-ending-animation:`, 's'),
        `${ending} has a real CSS ending instead of falling back to the idle coin`,
      );
    }
    assert.match(APP_CSS, /@keyframes df-reveal-end-double\s*\{/);
    assert.match(APP_CSS, /@keyframes df-reveal-end-triple\s*\{/);

    for (let day = 1; day <= 250; day += 1) {
      for (const won of [false, true]) {
        const plan = revealPlanning.selectFlipRevealPlan(day, won);
        if (plan.hardStop) {
          assert.equal(plan.openingMs, 0,
            'the hard-stop branch bypasses the choreographed landing');
          assert.equal(plan.endingMs, 0);
          continue;
        }
        const prefersWin = plan.winRate > 50;
        const expectedOpeningMs = plan.openingWon === prefersWin
          ? revealPlanning.REVEAL_BIASED_END_MS
          : revealPlanning.REVEAL_END_MS;
        assert.equal(plan.openingMs, expectedOpeningMs);
        assert.equal(plan.endingMs, plan.openingMs + (plan.reversalCount * 900));
        assert.equal(
          revealPlanning.reverseCardDelayMs(plan, 1),
          plan.trackMs + plan.openingMs + 100,
          'the first Reverse card waits 100ms after the mimicked landing',
        );
        assert.equal(
          revealPlanning.reverseCardDelayMs(plan, 2),
          plan.trackMs + plan.openingMs + 100 + 900,
          'later cards retain the frame-identical 900ms reversal cadence',
        );
      }
    }
  });

  test('the request-time Reverse count caps, but never increases, cosmetic reversals', () => {
    let tripleDay = 1;
    while (revealPlanning.selectFlipRevealPlan(tripleDay, true).reversalCount !== 3) tripleDay += 1;

    const none = revealPlanning.selectFlipRevealPlan(tripleDay, true, 0n);
    assert.equal(none.reversalCount, 0);
    assert.equal(none.fakeOut, false);
    assert.equal(none.ending, 'win');
    assert.equal(none.openingWon, true, 'the truthful face remains the endpoint at a zero cap');

    const one = revealPlanning.selectFlipRevealPlan(tripleDay, true, '1');
    assert.equal(one.reversalCount, 1);
    assert.equal(one.ending, 'loss-to-win');
    const two = revealPlanning.selectFlipRevealPlan(tripleDay, true, 2);
    assert.equal(two.reversalCount, 2);
    assert.equal(two.ending, 'double-to-win');
    assert.equal(revealPlanning.selectFlipRevealPlan(tripleDay, true, 9).reversalCount, 3,
      'a large real queue does not force extra cosmetic reversals');
  });

  test('five percent of each result branch hard-stops on a random complete correct face', () => {
    const days = 100_000;
    const counts = { win: 0, loss: 0 };
    const occurrences = { win: new Set(), loss: new Set() };
    for (let day = 1; day <= days; day += 1) {
      for (const won of [true, false]) {
        const branch = won ? 'win' : 'loss';
        const plan = revealPlanning.selectFlipRevealPlan(day, won);
        if (!plan.hardStop) continue;
        counts[branch] += 1;
        occurrences[branch].add(plan.hardStopOccurrence);
        assert.equal(plan.fakeOut, false, 'hard stops stay disjoint from Reverse-card endings');
        assert.equal(plan.reversalCount, 0);
        assert.equal(plan.openingMs, 0);
        assert.equal(plan.endingMs, 0);
        assert.equal(plan.totalMs, plan.trackMs);
        assert.equal(plan.hardStopRotationDeg % 360, won ? 180 : 0,
          `${branch} freezes only while its authoritative face is fully presented`);
        assert.equal(plan.totalMs, plan.hardStopHalfTurns * 260,
          'every possible stop retains one constant angular velocity');
      }
    }
    for (const branch of ['win', 'loss']) {
      assert.ok(Math.abs((counts[branch] / days) * 100 - 5) < 0.2,
        `${branch} hard-stop rate was ${(counts[branch] / days * 100).toFixed(2)}%`);
      assert.deepEqual([...occurrences[branch]].sort(), [4, 5, 6, 7, 8],
        `${branch} uses all five possible full-face stopping moments`);
    }
    assert.match(APP_CSS,
      /\.df-coin3d__inner\.df-reveal-active\.df-reveal-hard-stop\s*\{[^}]*animation-timing-function:\s*linear/s,
      'the rare ending has no hidden deceleration before it stops');
    assert.match(APP_CSS,
      /@keyframes df-reveal-hard-stop\s*\{[\s\S]*?rotateX\(var\(--df-hard-stop-rotation/,
      'the chosen full-face angle drives the final frozen frame');
  });

  test('DO IT uses a stable ten-percent day gate', () => {
    let shown = 0;
    const days = 100_000;
    for (let day = 1; day <= days; day += 1) {
      if (revealPlanning.shouldFlashAllInDoIt(day)) shown += 1;
    }
    assert.ok(Math.abs((shown / days) * 100 - 10) < 0.2,
      `DO IT observed ${(shown / days * 100).toFixed(2)}%`);
    assert.equal(
      revealPlanning.shouldFlashAllInDoIt(12_345),
      revealPlanning.shouldFlashAllInDoIt(12_345),
      'reloads cannot reroll the easter egg',
    );
  });
});

describe('app-daily-flip — coin reveal + actions', () => {
  test('the transparent coin hitbox never inherits the rectangular tactile shadow', () => {
    assert.match(
      APP_CSS,
      /\.df-coin\.is-tactile-pressed\s*\{[^}]*box-shadow:\s*none\s*!important/s,
    );
    assert.match(
      APP_CSS,
      /\.df-coin:focus-visible\s*\{[^}]*border-radius:\s*50%[^}]*outline:/s,
      'keyboard users retain a circular visible focus indicator',
    );
  });

  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    coinflipMod.__setCurrentStakeReaderForTest(async () => _currentStakeWei);
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: false,
      takeProfitWei: 0n,
      carryWei: 0n,
      startDay: 0,
    }));
    coinflipMod.__setResolvedStakeReaderForTest(async () => _resolvedStakeWei);
    coinflipMod.__setClaimableReaderForTest(async () => null);
    coinflipMod.__setBackingReaderForTest(async () => null);
    coinflipMod.__setLatestResultReaderForTest(async () => null);
    coinflipMod.__setWidgetBalancesReaderForTest(async () => null);
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({
      queued: 0n,
      locked: false,
    }));
    coinflipMod.__setBafFlipEveReaderForTest(async () => null);
    coinflipMod.__setUpcomingFlipBonusReaderForTest(async () => null);
    coinflipMod.__setResolvedFlipBonusWordReaderForTest(async () => null);
    storeMod.update('connected.address', TEST_ADDR);
    storeMod.update('app.lastDay', { day: 67, status: 'resolved' });
    await import('../app-daily-flip.js');
  });

  afterEach(() => {
    coinflipMod.__resetCurrentStakeReaderForTest();
    coinflipMod.__resetAutoRebuyInfoReaderForTest();
    coinflipMod.__resetResolvedStakeReaderForTest();
    coinflipMod.__resetClaimableReaderForTest();
    coinflipMod.__resetBackingReaderForTest();
    coinflipMod.__resetLatestResultReaderForTest();
    coinflipMod.__resetWidgetBalancesReaderForTest();
    coinflipMod.__resetReverseFlipQuoteReaderForTest();
    coinflipMod.__resetBafFlipEveReaderForTest();
    coinflipMod.__resetUpcomingFlipBonusReaderForTest();
    coinflipMod.__resetResolvedFlipBonusWordReaderForTest();
    coinflipMod.__resetContractFactoryForTest();
    charityVoteMod.__resetCharityVoteForTest();
    contractsMod.clearProvider();
  });

  test('unrevealed → clickable single-surface coin with a small left-side reveal graphic and no extra button', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    await flushMicrotasks();

    assert.match(
      el.innerHTML,
      /<h2 class="df-section-title">DAILY COINFLIP<\/h2>/,
      'the flip column carries the same kind of daily section label as the jackpot',
    );
    assert.match(
      APP_CSS,
      /\.df-section-title\s*\{[^}]*height:\s*2\.55rem[^}]*align-items:\s*center[^}]*font-size:\s*1\.05rem[^}]*font-weight:\s*950[^}]*letter-spacing:\s*0\.13em/s,
      'Daily Coinflip uses the shared fixed-height heading baseline and typography',
    );
    assert.match(APP_CSS,
      /\.app-daily-flip\s*\{[^}]*padding-top:\s*0/s,
      'the coinflip panel padding cannot push its heading below Daily Jackpot');
    assert.match(APP_CSS, /\.df-coin-stage\s*\{[^}]*position:\s*relative/s,
      'coin overlays remain anchored to the coin after inserting the heading');
    const coin = el.querySelector('.df-coin--spinning');
    assert.ok(coin, 'spinning coin rendered');
    assert.equal(coin.tagName, 'BUTTON', 'coin is clickable too');
    assert.ok(coin.querySelector('.df-coin3d__inner'), 'rotor present (idle spin loop)');
    assert.ok(coin.querySelector('.df-coin3d__surface'),
      'one physical surface owns both preloaded artworks');
    const faces = coin.querySelectorAll('.df-coin3d__face');
    assert.equal(faces.length, 2, 'two artworks are preloaded');
    assert.equal(faces.filter((face) => !face.hidden).length, 1,
      'only one artwork can be composited at a time');
    const srcs = coin.querySelectorAll('img').map((i) => i.src);
    assert.ok(srcs.includes('/shared/coinflip-face-red.svg'), 'red WWXRP face');
    assert.ok(srcs.includes('/shared/coinflip-face-eth.svg'), 'green ETH face');
    const rotorRule = APP_CSS.match(/\.df-coin3d__inner\s*\{[^}]*\}/s)?.[0] || '';
    assert.match(rotorRule, /transform-style:\s*flat/);
    assert.match(APP_CSS,
      /\.df-coin3d__surface\s*\{[^}]*contain:\s*paint[^}]*transform-style:\s*flat/s,
      'the artwork is isolated on one flat compositor surface');
    assert.match(APP_CSS, /\.df-coin3d__face\[hidden\]\s*\{[^}]*display:\s*none !important/s,
      'the opposite artwork is removed from compositing rather than backface-culled');
    assert.match(APP_CSS, /\.df-coin3d__face--eth\s*\{[^}]*scaleY\(-1\)/s,
      'the one plane pre-inverts ETH so its projected reverse remains upright');
    assert.doesNotMatch(APP_CSS,
      /\.df-coin3d__face--(?:red|eth)\s*\{[^}]*(?:rotateX|translateZ)/s,
      'no second 3D plane can expose an upside-down WWXRP reverse');
    const revealHint = el.querySelector('[data-bind="df-reveal-hint"]');
    assert.equal(revealHint.hidden, false, 'small instruction graphic is visible while unrevealed');
    assert.equal(revealHint.tagName, 'BUTTON', 'the instruction graphic is itself a reveal control');
    assert.match(
      el.innerHTML,
      /df-reveal-cue__copy"><span>CLICK<\/span><span>TO FLIP<\/span>/,
      'the compact cue reads as two quiet lines',
    );
    assert.match(el.innerHTML, /df-reveal-cue__arrow/, 'the cue points toward the coin');
    assert.match(
      APP_CSS,
      /\.df-reveal-cue\s*\{[^}]*top:\s*0\.68rem;[^}]*right:\s*calc\(50% \+ clamp\(55px, 7vw, 75px\) - 0\.05rem\)[^}]*align-items:\s*flex-end;[^}]*gap:\s*0/s,
      'the graphic ends outside the coin radius instead of overlapping it',
    );
    assert.match(APP_CSS, /\.df-reveal-cue__arrow\s*\{[^}]*transform:\s*rotate\(45deg\)/s,
      'the cue arrow aims down and right toward the coin');
    assert.match(APP_CSS, /\.df-reveal-cue__copy\s*\{[^}]*background:[^}]*#140707;[^}]*color|\.df-reveal-cue\s*\{[^}]*color:\s*#86efac/s,
      'the cue uses the widget red field and green text palette');
    assert.match(APP_CSS, /@keyframes df-reveal-cue-pulse[\s\S]*?opacity:\s*0\.86[\s\S]*?opacity:\s*1/,
      'only a restrained opacity/glow pulse animates the static cue');
    assert.equal(el.querySelector('[data-bind="df-reveal-cta"]'), null,
      'there is no duplicate reveal button');
    el.disconnectedCallback();
  });

  test('the x9 final-purchase window gives tomorrow\'s FLIP a special BAF treatment', async () => {
    coinflipMod.__setBafFlipEveReaderForTest(async () => ({
      lvl: 39,
      inJackpotPhase: false,
      lastPurchaseDay_: true,
      rngLocked_: false,
      priceWei: 1n,
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
      gameState: { level: 39 },
      baf: { score: '0', rank: null },
    };
    const el = mount();
    await flushMicrotasks();

    const notice = el.querySelector('[data-bind="df-baf-eve"]');
    const panel = el.querySelector('.app-daily-flip');
    assert.equal(notice, null, 'the floating BAF promo is removed');
    assert.equal(panel.classList.contains('app-daily-flip--baf-eve'), true);
    assert.doesNotMatch(el.innerHTML, /BAF TOMORROW|WIN TRIGGERS THE DRAW/);
    assert.doesNotMatch(APP_CSS, /\.df-baf-eve(?:__|\s|\[)/);
    assert.match(APP_CSS, /\.app-daily-flip--baf-eve \.df-tomorrow-layout\s*\{[^}]*border-color:/s);
    el.disconnectedCallback();
  });

  test('an exact upcoming bonus day puts plain green bonus copy left of Tomorrow', async () => {
    coinflipMod.__setUpcomingFlipBonusReaderForTest(async () => ({
      purchaseInfo: { lvl: 31, inJackpotPhase: true, lastPurchaseDay_: false, rngLocked_: false },
      compressionTier: 0,
      growthState: { currentLevel: 31, phaseDay: 1 },
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
      gameState: { level: 31 },
      baf: { score: '0', rank: null },
    };
    const el = mount();
    await flushMicrotasks();

    const badge = el.querySelector('[data-bind="df-bonus-flip"]');
    assert.ok(badge);
    assert.equal(badge.dataset.tier, 'standard');
    assert.equal(badge.textContent, '+2% BONUS');
    const tomorrow = el.querySelector('[data-position="tomorrow"]');
    const tomorrowLabel = tomorrow.querySelector('.df-position-label');
    assert.equal(badge.parentElement, tomorrowLabel,
      'the upcoming bonus stays in the Tomorrow title row');
    assert.equal(tomorrowLabel.children[0], badge,
      'the bonus appears on the left side of the Tomorrow words');
    assert.equal(tomorrowLabel.children[1].textContent, "Tomorrow's bet");
    assert.match(APP_CSS, /\.df-position-bonus\s*\{[^}]*color:\s*#4ade80/s);
    assert.doesNotMatch(APP_CSS,
      /\.df-position-bonus\s*\{[^}]*(?:border|border-radius|background|box-shadow):/s,
      'the inline green bonus has no badge or box chrome');
    assert.doesNotMatch(APP_CSS, /\.df-tomorrow-layout\.has-bonus-flip/,
      'the bonus no longer turns the whole Tomorrow instrument into a green box');
    el.disconnectedCallback();
  });

  test('resolved +2% and +6% bonus days put green bonus copy above WIN', async () => {
    // For day 67 and RNG word 1 the contract's packed seed produces an 88%
    // base reward. Final rewards of 90 and 94 therefore prove +2 and +6.
    const cases = [
      { rewardPercent: 90, points: 2, tier: 'standard', total: '190%' },
      { rewardPercent: 94, points: 6, tier: 'x0', total: '194%' },
      { rewardPercent: 88, points: null, tier: null, total: '188%' },
    ];

    for (const sample of cases) {
      invalidateJSONCache();
      coinflipMod.__setResolvedFlipBonusWordReaderForTest(async ({ day }) => {
        assert.equal(day, 67);
        return 1n;
      });
      _fetchResponses = {
        dashboard: dashboardPayload(),
        flipDay: { day: 67, win: true, rewardPercent: sample.rewardPercent },
      };
      localStorage.setItem('flip_day_84532_67', '1');
      const el = mount();
      await flushMicrotasks();

      const today = el.querySelector('[data-position="today"]');
      const bonus = today.querySelector('[data-bind="df-result-bonus-flip"]');
      const multiplier = today.querySelector('.df-position-multiplier');
      assert.equal(today.querySelector('.df-position-percentage').textContent, sample.total);
      if (sample.points == null) {
        assert.equal(bonus, null, 'an ordinary RNG-derived reward gets no bonus label');
        assert.equal(multiplier.className, 'df-position-multiplier');
      } else {
        assert.ok(bonus);
        assert.equal(bonus.textContent, `+${sample.points}% BONUS`);
        assert.equal(bonus.dataset.tier, sample.tier);
        assert.equal(bonus.parentElement, today,
          'the bonus occupies the result row rather than squeezing the multiplier');
        assert.equal(multiplier.textContent, `WIN${sample.total}`);
        assert.match(today.className, /df-position-row--result-bonus/);
      }

      el.disconnectedCallback();
      el.remove();
    }

    assert.match(APP_CSS,
      /\.df-position-row--result-bonus\s*\{[^}]*grid-template-areas:\s*"bonus label"\s*"multiplier result"/s,
      'the verified bonus uses the empty cell directly above WIN');
    assert.match(APP_CSS,
      /\.df-position-result-bonus\s*\{[^}]*text-shadow:/s,
      'the result bonus receives the same restrained green glow as the preview');
  });

  test('new-day rollover mounts a clickable spinning coin before the result read catches up', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    const resolvingCoin = el.querySelector('.df-coin--resolving');
    assert.ok(resolvingCoin, 'the flip surface starts at jackpot time instead of going blank');
    assert.equal(resolvingCoin.tagName, 'BUTTON');
    resolvingCoin.dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="df-reveal-hint"]').hidden, true,
      'the click prompt disappears once that exact day is queued');
    assert.equal(localStorage.getItem('flip_day_84532_67'), null,
      'clicking early queues the reveal without inventing an outcome');

    _fetchResponses.flipDay = { day: 67, win: true, rewardPercent: 96 };
    document.dispatchEvent({ type: 'visibilitychange' });
    await flushMicrotasks();
    assert.equal(localStorage.getItem('flip_day_84532_67'), '1',
      'the queued click lands automatically when the exact result arrives');
    assert.ok(el.querySelector('.df-coin--landed'));
    el.disconnectedCallback();
  });

  test('the waiting coin tracks Reverse Flip parity until resolution', async () => {
    let queued = 3n;
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({
      queued,
      locked: true,
    }));
    storeMod.update('app.daySync', {
      day: 67,
      jackpotReady: false,
      coinflipReady: false,
      ready: false,
      phase: 'waiting-coinflip',
      coinflipResult: null,
    });
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    let waiting = el.querySelector('.df-coin--resolving');
    assert.equal(waiting.getAttribute('data-reverse-flips'), '3');
    assert.equal(waiting.getAttribute('data-current-side'), 'eth');
    assert.match(waiting.className, /\bdf-coin--queued-eth\b/);
    assert.match(waiting.className, /\bdf-coin--resolution-locked\b/);
    assert.match(waiting.getAttribute('aria-label'), /3 Reverse Flips queued; current side ETH/);

    queued = 4n;
    storeMod.update('connected.address', TEST_ADDR);
    await flushMicrotasks();

    waiting = el.querySelector('.df-coin--resolving');
    assert.equal(waiting.getAttribute('data-reverse-flips'), '4');
    assert.equal(waiting.getAttribute('data-current-side'), 'wwxrp');
    assert.doesNotMatch(waiting.className, /\bdf-coin--queued-eth\b/);
    assert.match(waiting.getAttribute('aria-label'), /4 Reverse Flips queued; current side WWXRP/);
    assert.match(
      APP_CSS,
      /\.df-coin--resolving\.df-coin--queued-eth \.df-coin3d__inner\s*\{[^}]*transform:\s*rotateX\(180deg\)[^}]*animation-delay:\s*-550ms/s,
    );
    assert.match(
      APP_CSS,
      /\.df-coin--resolution-locked \.df-coin3d__inner\s*\{[^}]*animation:\s*none/s,
    );
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

  test('BAF rank accepts the live eve position and refreshes once after a winning reveal', async () => {
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
      gameState: { level: 7 },
      baf: {
        level: 10,
        score: String(1_000n * 10n ** 18n),
        rank: 3,
        totalParticipants: 20,
        roundStatus: 'open',
      },
    };

    const el = mount();
    await flushMicrotasks();
    const bafUrl = [..._fetchCounts.keys()].find((url) => /\/baf\?level=10$/.test(url));
    assert.ok(bafUrl, 'initial bracket score/rank is loaded');
    assert.equal(_fetchCounts.get(bafUrl), 1);

    document.dispatchEvent({ type: 'visibilitychange' });
    await flushMicrotasks();
    assert.equal(_fetchCounts.get(bafUrl), 1,
      'ordinary widget refreshes reuse the cached rank instead of rerunning the DB rank query');

    storeMod.update('app.bafPosition', {
      address: '0x9999999999999999999999999999999999999999',
      level: 10,
      score: String(9_000n * 10n ** 18n),
      rank: 1,
    });
    assert.equal(el.querySelector('[data-bind="df-baf-rank"]').textContent, 'RANK #3',
      'another account cannot overwrite the viewed player position');

    storeMod.update('app.bafPosition', {
      address: TEST_ADDR,
      level: 10,
      score: String(1_500n * 10n ** 18n),
      rank: 7,
      totalParticipants: 20,
      roundStatus: 'open',
    });
    assert.equal(el.querySelector('[data-bind="df-baf-rank"]').textContent, 'RANK #7',
      'the compact score lane immediately adopts the full-width BAF rail rank');
    assert.equal(_fetchCounts.get(bafUrl), 1,
      'sharing the live BAF row does not add another API request');

    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    assert.equal(_fetchCounts.get(bafUrl), 2,
      'a revealed win invalidates and refreshes the score/rank exactly once');
    el.disconnectedCallback();
  });

  test('a transient BAF rank API miss retries instead of caching a dash forever', async () => {
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: false, rewardPercent: 0 },
      gameState: { level: 7 },
      baf: null,
    };

    const el = mount();
    await flushMicrotasks();
    const bafUrl = [..._fetchCounts.keys()].find((url) => /\/baf\?level=10$/.test(url));
    assert.ok(bafUrl);
    assert.equal(_fetchCounts.get(bafUrl), 1);
    assert.equal(el.querySelector('[data-bind="df-baf-rank"]').textContent, 'RANK —');

    _fetchResponses.baf = {
      level: 10,
      score: String(1_000n * 10n ** 18n),
      rank: 7,
      totalParticipants: 20,
      roundStatus: 'open',
    };
    document.dispatchEvent({ type: 'visibilitychange' });
    await flushMicrotasks();

    assert.equal(_fetchCounts.get(bafUrl), 2);
    assert.equal(el.querySelector('[data-bind="df-baf-rank"]').textContent, 'RANK #7');
    el.disconnectedCallback();
  });

  test('fast API data renders without waiting for slow chain reads', async () => {
    let finishCurrent;
    let finishResolved;
    let finishLatest;
    coinflipMod.__setLatestResultReaderForTest(() => new Promise((resolve) => {
      finishLatest = resolve;
    }));
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
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '••••',
      'the combined total cannot expose claimable while chain reads remain pending');
    assert.equal(el.querySelector('[data-bind="df-funds-flip-unit"]').textContent, 'FLIP',
      'the currency unit remains readable while its number is masked');
    assert.match(el.querySelector('[data-bind="df-funds-wwxrp"]').textContent, /12,345 WWXRP/,
      'the replacement WWXRP balance renders from the dashboard');
    assert.equal(el.querySelector('[data-position="today"]').textContent, "Today's bet—",
      'the still-pending resolved-day value keeps its loading placeholder');
    assert.equal(
      el.querySelector('[data-position="tomorrow"]').querySelector('.df-position-value').textContent,
      '—',
    );
    assert.doesNotMatch(el.innerHTML, /BET AMOUNT/,
      'the compact stepper does not spend width on a redundant label');

    finishLatest(null);
    finishCurrent('12000000000000000000000');
    finishResolved('43844000000000000000000');
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="today"]').textContent, /43,844 FLIP/,
      "today's committed stake is visible before the result reveal");
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);
    el.disconnectedCallback();
  });

  test('overlapping refresh signals coalesce into one trailing reload', async () => {
    let finishFirst;
    let latestReads = 0;
    coinflipMod.__setLatestResultReaderForTest(() => {
      latestReads += 1;
      if (latestReads === 1) {
        return new Promise((resolve) => { finishFirst = resolve; });
      }
      return Promise.resolve(null);
    });
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };

    const el = mount();
    await flushPromises();
    assert.equal(latestReads, 1, 'initial refresh is in flight');

    document.dispatchEvent({ type: 'visibilitychange' });
    document.dispatchEvent({ type: 'visibilitychange' });
    storeMod.update('viewing.address', TEST_ADDR);
    await flushPromises();
    assert.equal(latestReads, 1, 'signals do not start overlapping RPC cycles');

    finishFirst(null);
    await flushMicrotasks();
    assert.equal(latestReads, 2, 'all signals collapse into one trailing refresh');
    el.disconnectedCallback();
  });

  test('any confirmed protocol transaction refreshes wallet and claimable FLIP totals', async () => {
    const unit = 10n ** 18n;
    let wallet = 1_000n * unit;
    let claimable = 200n * unit;
    let balanceReads = 0;
    let claimableReads = 0;
    coinflipMod.__setWidgetBalancesReaderForTest(async () => {
      balanceReads += 1;
      return { flipBalance: wallet, wwxrpBalance: 0n, sdgnrsBalance: 0n };
    });
    coinflipMod.__setClaimableReaderForTest(async () => {
      claimableReads += 1;
      return claimable;
    });
    const dashboard = dashboardPayload();
    dashboard.flipBalance = '0';
    dashboard.coinflip.claimablePreview = '0';
    _fetchResponses = {
      dashboard,
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    localStorage.setItem('flip_day_84532_67', '1');

    const el = mount();
    await flushMicrotasks();
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '1,200');
    const initialBalanceReads = balanceReads;
    const initialClaimableReads = claimableReads;

    // Model an external protocol action spending claimable FLIP first and
    // minted wallet FLIP second. The shared confirmation event must repaint
    // the aggregate even though this widget did not initiate the transaction.
    wallet = 700n * unit;
    claimable = 50n * unit;
    document.dispatchEvent({ type: contractsMod.TX_CONFIRMED_EVENT });
    await flushMicrotasks();

    assert.ok(balanceReads > initialBalanceReads, 'minted FLIP is re-read after confirmation');
    assert.ok(claimableReads > initialClaimableReads, 'claimable FLIP is re-read after confirmation');
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '750');
    el.disconnectedCallback();
  });

  test('Protocol Coins includes auto-rebuy carry even while RNG is locked', async () => {
    const unit = 10n ** 18n;
    coinflipMod.__setWidgetBalancesReaderForTest(async () => ({
      flipBalance: 1_000n * unit,
      wwxrpBalance: 0n,
      sdgnrsBalance: 0n,
    }));
    coinflipMod.__setClaimableReaderForTest(async () => 200n * unit);
    coinflipMod.__setBackingReaderForTest(async () => 675n * unit);
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: true,
      takeProfitWei: 0n,
      carryWei: 475n * unit,
      startDay: 64,
    }));
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({
      queued: 0n,
      locked: true,
    }));
    const dashboard = dashboardPayload();
    dashboard.flipBalance = '0';
    dashboard.coinflip.claimablePreview = '0';
    _fetchResponses = {
      dashboard,
      flipDay: { day: 67, win: false, rewardPercent: 0 },
    };
    localStorage.setItem('flip_day_84532_67', '1');

    const el = mount();
    await flushMicrotasks();

    assert.equal(
      el.querySelector('[data-bind="df-funds-flip-total"]').textContent,
      '1,675',
      'wallet plus ordinary claimable plus the 475 FLIP rolling carry is shown',
    );
    assert.equal(
      el.querySelector('[data-bind="df-claim-flip-cta"]').disabled,
      false,
      'the ordinary CLAIM action remains based on its separate 200 FLIP preview',
    );
    el.disconnectedCallback();
  });

  test("an unresolved ticket pack never masks Tomorrow's bet", async () => {
    _currentStakeWei = '12000000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const rewardGateKey = `flip_reward_reveal_gate_84532_${TEST_ADDR}`;
    localStorage.setItem(rewardGateKey, '1'); // simulate the stale latch from the reported bug
    pendingActionsMod.publishPendingActions('ticket-packs', [{
      id: 'ticket-pack:68', kind: 'tickets', label: 'Level 68 ticket pack',
      detail: 'Waiting for the Level 68 draw', state: 'waiting', pinned: true,
    }]);

    const el = mount();
    await flushMicrotasks();
    assert.equal(
      el.querySelector('[data-position="tomorrow"]').querySelector('.df-position-value').textContent,
      '•••• FLIP',
      'the durable latch remains safe until the reward-box controllers finish loading',
    );

    pendingActionsMod.publishPendingActions('lootboxes', []);
    pendingActionsMod.publishPendingActions('sdgnrs-redemptions', []);
    await flushPromises();
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/,
      'an explicitly empty box refresh retires the stale latch despite the pending pack');
    assert.equal(localStorage.getItem(rewardGateKey), null);
    assert.equal(pendingActionsMod.getPendingActions()[0].kind, 'tickets',
      'the pack remains pending independently of the FLIP spoiler gate');
    el.disconnectedCallback();
  });

  test("Tomorrow's bet stays masked through an actual lootbox presentation", async () => {
    _currentStakeWei = '12000000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    pendingActionsMod.publishPendingActions('lootboxes', [{
      id: 'lootbox:9', kind: 'lootbox', label: 'Luckbox #9',
      detail: 'Prizes ready', state: 'ready', resolved: true, run: async () => {},
    }]);
    pendingActionsMod.publishPendingActions('sdgnrs-redemptions', []);
    const el = mount();
    await flushMicrotasks();
    const tomorrow = () => el.querySelector('[data-position="tomorrow"]');
    assert.match(tomorrow().textContent, /•••• FLIP/);

    document.dispatchEvent({
      type: 'degenerus:lootbox-reveal-queued',
      detail: { presentationId: 'lootbox-reveal:9', address: TEST_ADDR },
    });
    pendingActionsMod.publishPendingActions('lootboxes', []);
    assert.match(tomorrow().textContent, /•••• FLIP/,
      'removing the tray row cannot reveal a reward while its animation is still queued');

    document.dispatchEvent({
      type: 'degenerus:lootbox-reveal-complete',
      detail: { presentationId: 'lootbox-reveal:9', address: TEST_ADDR },
    });
    assert.match(tomorrow().textContent, /12,000 FLIP/,
      'consuming the box presentation opens the gate');
    el.disconnectedCallback();
  });

  test("an unresolved lootbox stays visible in Pending without masking Tomorrow's bet", async () => {
    _currentStakeWei = '12000000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    pendingActionsMod.publishPendingActions('lootboxes', [{
      id: 'lootbox:10', kind: 'lootbox', label: 'Luckbox #10',
      detail: 'Waiting for RNG', state: 'waiting', resolved: false, pinned: true,
    }]);
    pendingActionsMod.publishPendingActions('sdgnrs-redemptions', []);

    const el = mount();
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/,
      'there is no result to spoil before the box resolves');
    el.disconnectedCallback();
  });

  test('the restored inline Claim opens the FLIP funds popup independently of disclosure', async () => {
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    const value = el.querySelector('[data-bind="df-funds-flip-total"]');
    const claim = el.querySelector('[data-bind="df-claim-flip-cta"]');
    assert.equal(value.textContent, '••••');
    assert.equal(value.getAttribute('role'), 'button');
    assert.deepEqual(storeMod.get('ui.protocolCoinsFlipDisclosure'), {
      address: TEST_ADDR.toLowerCase(),
      visible: false,
    });
    value.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.notEqual(value.textContent, '••••');
    assert.deepEqual(storeMod.get('ui.protocolCoinsFlipDisclosure'), {
      address: TEST_ADDR.toLowerCase(),
      visible: true,
    }, 'the owning Protocol Coins cell publishes its exact disclosure state');
    assert.equal(claim.disabled, false,
      'the popup opener remains available independently of the FLIP disclosure');
    assert.equal(el.querySelector('[data-bind="df-claim-eth-cta"]'), null,
      'Protocol Coins no longer hides a separate ETH claim widget');
    assert.equal(el.querySelector('[data-bind="df-link-donation-cta"]'), null,
      'Protocol Coins no longer hides a separate LINK funding widget');
    assert.equal(el.querySelector('[data-bind="df-player-fund-actions"]'), null,
      'the old three-widget strip is removed entirely');
    const openedModes = [];
    document.addEventListener('degenerus:player-funds:open', (event) => {
      openedModes.push(event?.detail?.mode);
    });
    claim.dispatchEvent({ type: 'click' });
    assert.deepEqual(openedModes, ['flip'],
      'the old inline Claim opens the popup focused on FLIP');
    el.disconnectedCallback();
  });

  test("Tomorrow's bet remains masked until the bonus jackpot is cleared", async () => {
    _currentStakeWei = '12000000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    localStorage.removeItem('jackpot_complete_day_84532_67');
    pendingActionsMod.publishPendingActions('lootboxes', []);
    pendingActionsMod.publishPendingActions('sdgnrs-redemptions', []);
    const el = mount();
    await flushMicrotasks();
    const tomorrow = () => el.querySelector('[data-position="tomorrow"]');
    assert.match(tomorrow().textContent, /•••• FLIP/);
    assert.doesNotMatch(tomorrow().textContent, /12,000/,
      'the real value is absent from the rendered Tomorrow row');

    localStorage.setItem('jackpot_complete_day_84532_67', '1');
    document.dispatchEvent({ type: 'jackpot:revealed', detail: { day: 67 } });
    assert.match(tomorrow().textContent, /12,000 FLIP/);
    el.disconnectedCallback();
  });

  test("auto rebuy keeps Tomorrow's effective stake masked until its coin is revealed", async () => {
    const unit = 10n ** 18n;
    // readCurrentCoinflipStake is carry-inclusive: 12,000 stored plus the
    // 475 FLIP that auto rebuy rolled forward from this unresolved result.
    _currentStakeWei = String(12_475n * unit);
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: true,
      takeProfitWei: 0n,
      carryWei: 475n * unit,
      startDay: 64,
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    // The jackpot/box reward gate is already clear. Auto rebuy still makes the
    // live next-day amount an outcome spoiler until this coin is opened.
    const el = mount();
    await flushMicrotasks();

    const tomorrow = () => el.querySelector('[data-position="tomorrow"]');
    assert.match(tomorrow().textContent, /•••• FLIP/);
    assert.doesNotMatch(tomorrow().textContent, /12,480/,
      'the carry-inclusive next bet cannot leak the unresolved auto-rebuy outcome');

    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.match(tomorrow().textContent, /12,480 FLIP/,
      'the full stored stake plus rolling carry appears after the coin reveal');
    el.disconnectedCallback();
  });

  test("a fully revealed legacy jackpot cannot leave Tomorrow's bet blurred forever", async () => {
    _currentStakeWei = '12000000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    localStorage.removeItem('jackpot_complete_day_84532_67');
    localStorage.setItem('spun_day_84532_67', '1');
    localStorage.removeItem('jackpot_bonus_pending_day_84532_67');
    pendingActionsMod.publishPendingActions('lootboxes', []);
    pendingActionsMod.publishPendingActions('sdgnrs-redemptions', []);

    const el = mount();
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/,
      'the pre-all-rolls completion bit migrates without requiring the player to replay a finished draw');
    el.disconnectedCallback();
  });

  test("an explicitly pending bonus still masks Tomorrow's bet", async () => {
    _currentStakeWei = '12000000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    localStorage.removeItem('jackpot_complete_day_84532_67');
    localStorage.setItem('spun_day_84532_67', '1');
    localStorage.setItem('jackpot_bonus_pending_day_84532_67', '1');
    pendingActionsMod.publishPendingActions('lootboxes', []);
    pendingActionsMod.publishPendingActions('sdgnrs-redemptions', []);

    const el = mount();
    await flushMicrotasks();
    const tomorrow = () => el.querySelector('[data-position="tomorrow"]');
    assert.match(tomorrow().textContent, /•••• FLIP/);

    document.dispatchEvent({
      type: 'jackpot:revealed',
      detail: { day: 67, complete: true, bonusPending: false },
    });
    assert.match(tomorrow().textContent, /12,000 FLIP/,
      'the final same-tab event opens the gate even when localStorage is unavailable or stale');
    el.disconnectedCallback();
  });

  test('clicking the CLICK TO FLIP cue reveals and dismisses its instruction', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    let revealed = 0;
    globalThis.document.addEventListener('flip:revealed', () => { revealed += 1; });

    const el = mount();
    await flushMicrotasks();

    el.querySelector('[data-bind="df-reveal-hint"]').dispatchEvent({ type: 'click' });
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
      coinflipStats: {
        wins: 28,
        losses: 19,
        recent: Array.from({ length: 16 }, (_, index) => ({
          day: 67 - index,
          win: index === 0 ? true : index % 2 === 0,
        })),
      },
    };
    const el = mount();
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="today"]').textContent, /43,844 FLIP/);
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);

    const realSetTimeout = globalThis.setTimeout;
    const realMatchMedia = globalThis.matchMedia;
    const realAudioContext = globalThis.AudioContext;
    let revealDelay = 0;
    let revealFinish = null;
    const revealEvents = [];
    const scheduled = [];
    class RecordingAudioContext {
      static last = null;
      constructor() {
        RecordingAudioContext.last = this;
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
        this.oscillators = [];
      }
      createOscillator() {
        const oscillator = {
          type: 'sine',
          frequency: {
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
          start() {},
          stop() {},
        };
        this.oscillators.push(oscillator);
        return oscillator;
      }
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
        };
      }
      close() {}
    }
    try {
      globalThis.matchMedia = () => ({ matches: false });
      globalThis.AudioContext = RecordingAudioContext;
      jackpotSfxMod.__resetForTest();
      globalThis.setTimeout = (fn, delay = 0) => {
        revealDelay = Math.max(revealDelay, Number(delay) || 0);
        const handle = { fn, delay: Number(delay) || 0, unref() {} };
        scheduled.push(handle);
        if ((Number(delay) || 0) >= 4_000) revealFinish = fn;
        return handle;
      };
      globalThis.document.addEventListener('flip:finishing', (event) => {
        revealEvents.push(['finishing', event?.detail?.durationMs]);
      });
      globalThis.document.addEventListener('flip:revealed', () => {
        revealEvents.push(['revealed']);
      });
      el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
      const launchOscillators = RecordingAudioContext.last.oscillators.length;

      assert.equal(el.querySelector('.df-modifier-meter'), null,
        'a real win does not leak its percentage during the neutral spin');
      assert.equal(el.querySelector('[data-bind="df-outcome"]').textContent, '',
        'the animation does not add a redundant Flipping status line');
      assert.match(el.querySelector('[data-position="today"]').textContent, /Today's bet43,844 FLIP/,
        'the result-day stake stays visible without leaking the result or modifier');
      assert.ok(revealDelay >= 4_000, `reveal has time to read before it lands (${revealDelay}ms)`);
      const rotor = el.querySelector('.df-reveal-active');
      assert.ok(rotor, 'one of the four deterministic motion tracks is active');
      assert.ok(rotor.getAttribute('data-reveal-profile'));
      assert.ok(rotor.getAttribute('data-reveal-ending'));
      const fakeoutCard = el.querySelector('[data-bind="df-fakeout-reverse-card"]');
      assert.ok(fakeoutCard, 'loss-to-win fakeout mounts the flying Reverse card');
      assert.equal(fakeoutCard.getAttribute('data-fakeout-target'), 'eth');
      assert.equal(fakeoutCard.querySelector('img').src, '/shared/reverse-flip-card.svg');
      const revealPlan = revealPlanning.selectFlipRevealPlan(67, true);
      assert.equal(revealPlanning.shouldFlashAllInDoIt(67), true,
        'the motion fixture is one of the deterministic ten-percent cue days');
      const finishingCue = scheduled.filter((entry) => (
        entry.delay === revealPlan.trackMs
          + revealPlan.openingMs
          - revealPlanning.FLIP_FINISH_CUE_MS
      )).at(-1);
      assert.ok(finishingCue, 'the button cue is scheduled only for the final quarter-second');
      assert.ok(finishingCue.delay < revealPlan.totalMs - revealPlanning.FLIP_FINISH_CUE_MS,
        'Reverse-card extensions do not move DO IT away from the normal landing');
      finishingCue.fn();
      assert.deepEqual(revealEvents, [['finishing', 250]],
        'the finishing cue precedes the settled reveal event');
      assert.equal(typeof revealFinish, 'function');
      revealFinish();
      assert.deepEqual(revealEvents, [['finishing', 250], ['revealed']],
        'the settled frame closes the brief finishing cue');
      assert.equal(RecordingAudioContext.last.oscillators.length, launchOscillators,
        'the winning chord stays silent while the final thermometer is moving');
      const meter = el.querySelector('.df-modifier-meter--settling');
      assert.ok(meter, 'the vertical percentage rail enters only after the final win');
      assert.match(meter.textContent, /196%/);
      assert.equal(el.querySelector('[data-position="today"] .df-position-outcome'), null,
        "Today's bet does not turn into WIN while the thermometer is settling");
      assert.doesNotMatch(el.querySelector('[data-position="today"]').className, /df-position-row--win/,
        "Today's bet stays neutral until the win sound can play");
      assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '••••',
        'Protocol Coins cannot reveal or add the payout before the result is final');
      assert.equal(el.querySelector('[data-bind="df-coinflip-wins"]').textContent, '27',
        'the global record cannot telegraph the win before the percentage locks');
      assert.equal(
        el.querySelector('[data-bind="df-coinflip-recent"]').classList.contains('is-shifting'),
        false,
        'LAST 15 stays still while the apparent win is not authoritative',
      );
      assert.equal(el.querySelector('[data-bind="df-claim-flip-cta"]').disabled, false,
        'the shared popup remains available for older ETH/FLIP while this new payout settles');
      assert.equal(
        el.querySelector('[data-bind="df-claim-flip-cta"]').getAttribute('data-write-locked'),
        null,
        'the popup opener is not itself a transaction',
      );

      const settle = scheduled.find((entry) => entry.delay === 1_600);
      assert.ok(settle, 'the rail gets a readable 1.6-second settle window');
      const marker = el.querySelector('[data-bind="df-modifier-marker"]');
      marker.dispatchEvent({
        type: 'animationend',
        animationName: 'decorative-marker-glow',
      });
      assert.equal(el.querySelector('[data-position="today"] .df-position-outcome'), null,
        'an unrelated marker animation cannot publish the payout early');
      assert.equal(RecordingAudioContext.last.oscillators.length, launchOscillators,
        'an unrelated animation end cannot fire the winning chord');
      marker.dispatchEvent({
        type: 'animationend',
        animationName: 'df-meter-settle',
      });
      assert.equal(RecordingAudioContext.last.oscillators.length, launchOscillators + 4,
        'the winning chord starts on the same animation-end event that commits 196%');
      assert.equal(el.querySelector('[data-bind="df-coinflip-wins"]').textContent, '28',
        'the W counter increases on the exact percentage-lock event');
      assert.equal(
        el.querySelector('[data-bind="df-coinflip-recent"]').classList.contains('is-shifting'),
        true,
        'LAST 15 visibly shifts only once the percentage has locked',
      );
      assert.match(el.querySelector('[data-position="today"]').className, /df-position-row--win/,
        "Today's bet turns green on that same completion event");
      assert.match(el.querySelector('[data-position="today"]').textContent, /WIN/);
      assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '5,599,985',
        'Protocol Coins opens on the same completion event as the final result');
      assert.equal(el.querySelector('[data-bind="df-claim-flip-cta"]').disabled, false,
        'claim unlocks only after the result sequence completes');
      assert.equal(
        el.querySelector('[data-bind="df-claim-flip-cta"]').getAttribute('data-write-locked'),
        null,
        'the domain lock retires only when the claim is actually ready',
      );
      assert.equal(el.querySelector('.df-modifier-flash').textContent, '196%',
        'the rail collapses into the total multiplier');
      settle.fn();
      assert.equal(RecordingAudioContext.last.oscillators.length, launchOscillators + 4,
        'the timer fallback cannot replay the chord after animationend wins the race');
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
      jackpotSfxMod.__resetForTest();
      if (realAudioContext === undefined) delete globalThis.AudioContext;
      else globalThis.AudioContext = realAudioContext;
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
        /@keyframes df-meter-rebound-from-min[\s\S]*?0%, 6\.086957%[^}]*bottom:\s*0%[\s\S]*?39\.130435%[^}]*bottom:\s*98%[\s\S]*?65\.217391%[^}]*bottom:\s*8%[\s\S]*?100%[^}]*var\(--df-meter-stop/,
        'the next Reverse card carries the marker through a complete rail loop and recovery',
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

  test('a resolved day never mounts more Reverse cards than its frozen chain queue', async () => {
    let tripleDay = 1;
    while (revealPlanning.selectFlipRevealPlan(tripleDay, true).reversalCount !== 3) tripleDay += 1;
    const result = { day: tripleDay, win: true, rewardPercent: 96 };
    storeMod.update('app.lastDay', { day: tripleDay, status: 'resolved' });
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: result };
    const el = mount();
    await flushMicrotasks();

    storeMod.update('app.daySync', {
      day: tripleDay,
      jackpotReady: true,
      coinflipReady: true,
      rngLocked: true,
      rngRequested: true,
      reverseQueued: '1',
      ready: true,
      phase: 'ready',
      coinflipResult: result,
    });
    await flushMicrotasks();

    const realSetTimeout = globalThis.setTimeout;
    const realMatchMedia = globalThis.matchMedia;
    try {
      globalThis.matchMedia = () => ({ matches: false });
      globalThis.setTimeout = (fn, delay = 0) => ({ fn, delay, unref() {} });
      el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
      const cards = el.querySelectorAll('[data-bind="df-fakeout-reverse-card"]');
      assert.equal(cards.length, 1,
        'the deterministic three-card plan is capped by the one real request-time reversal');
      assert.equal(cards[0].getAttribute('data-fakeout-target'), 'eth');
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
      // Real loss payloads intentionally carry no payout modifier. This is
      // the production shape that previously pinned the fakeout marker at 0.
      flipDay: { day: tripleDay, win: false, rewardPercent: 0 },
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
      const openingMarker = el.querySelector('[data-bind="df-modifier-marker"]');
      assert.notEqual(openingMarker.style.bottom, '0%',
        'a loss fakeout receives a stable presentation stop instead of the on-chain zero sentinel');
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
    assert.equal(today.querySelector('.df-position-outcome').textContent, 'WIN',
      'the win outcome sits prominently at the left of the resolved row');
    assert.equal(today.querySelector('.df-position-percentage').textContent, '196%',
      'the UI shows the total payout multiplier, not only the 96% bonus');
    assert.equal(today.querySelector('.df-position-percentage--low'), null,
      'a middle multiplier keeps the existing green treatment');
    assert.equal(today.querySelector('.df-position-percentage--high'), null,
      'a middle multiplier keeps the existing green treatment');
    assert.equal(today.querySelector('.df-position-value').textContent, '+85,934 FLIP',
      "Today's Bet keeps the signed payout on the right");
    assert.ok(today.className.includes('df-position-row--win'));
    assert.equal(el.querySelector('.df-modifier-meter'), null,
      'reduced-motion reveal does not retain a percentage rail');
    assert.equal(el.querySelector('.df-modifier-result'), null,
      'there is no duplicate permanent result display');
    el.disconnectedCallback();
  });

  test("Today's Bet colors only the 150% and 250%+ multiplier number", async () => {
    const cases = [
      { rewardPercent: 50, text: '150%', tone: 'low' },
      { rewardPercent: 114, text: '214%', tone: null },
      { rewardPercent: 150, text: '250%', tone: 'high' },
      { rewardPercent: 200, text: '300%', tone: 'high' },
    ];

    for (const sample of cases) {
      // Each table row is an independent server fixture for the same immutable
      // day URL; do not let the production render-wave cache couple them.
      invalidateJSONCache();
      _fetchResponses = {
        dashboard: dashboardPayload(),
        flipDay: { day: 67, win: true, rewardPercent: sample.rewardPercent },
      };
      globalThis.localStorage.setItem('flip_day_84532_67', '1');
      const el = mount();
      await flushMicrotasks();

      const today = el.querySelector('[data-position="today"]');
      const percent = today.querySelector('.df-position-percentage');
      assert.equal(percent.textContent, sample.text);
      assert.equal(
        percent.className,
        sample.tone
          ? `df-position-percentage df-position-percentage--${sample.tone}`
          : 'df-position-percentage',
      );
      assert.equal(today.querySelector('.df-position-outcome').className, 'df-position-outcome',
        'WIN itself does not receive the threshold color class');
      assert.equal(today.querySelector('.df-position-value').className,
        'df-position-value df-position-value--win',
        'the payout does not receive the threshold color class');

      el.disconnectedCallback();
      el.remove();
    }
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
    assert.equal(today.querySelector('.df-position-outcome').textContent, 'LOSS',
      'the loss outcome sits at the left of the resolved row');
    assert.equal(today.querySelector('.df-position-percentage'), null);
    assert.equal(today.querySelector('.df-position-value').textContent, '-43,844 FLIP',
      'the signed loss amount stays on the right of Today’s Bet');
    assert.ok(today.className.includes('df-position-row--loss'));
    assert.equal(el.querySelector('.df-modifier-meter'), null,
      'loss clears the scanner instead of settling on a modifier');
    el.disconnectedCallback();
  });

  for (const won of [true, false]) {
    test(`a zero-stake ${won ? 'win' : 'loss'} says NO BET before and after reveal`, async () => {
      _resolvedStakeWei = '0';
      _fetchResponses = {
        dashboard: dashboardPayload(),
        flipDay: { day: 67, win: won, rewardPercent: 96 },
      };

      const el = mount();
      await flushMicrotasks();

      let today = el.querySelector('[data-position="today"]');
      assert.equal(today.querySelector('.df-position-value').textContent, 'NO BET');
      assert.equal(today.querySelector('.df-position-multiplier'), null,
        'zero stake never shows the global win multiplier');
      assert.ok(today.className.includes('df-position-row--no-bet'));
      assert.ok(today.querySelector('.df-position-value').className.includes('df-position-value--no-bet'));
      assert.ok(!today.className.includes('df-position-row--spoiler'));

      el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      today = el.querySelector('[data-position="today"]');
      assert.equal(today.querySelector('.df-position-value').textContent, 'NO BET',
        'a global result never fabricates a personal receipt for a zero stake');
      el.disconnectedCallback();
    });
  }

  test('a zero-stake global win still runs the percentage thermometer', async () => {
    _resolvedStakeWei = '0';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
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

      const revealFinish = scheduled.find((entry) => (
        entry.delay === revealPlanning.selectFlipRevealPlan(67, true).totalMs
      ));
      assert.ok(revealFinish, 'the normal reveal landing is scheduled');
      revealFinish.fn();

      assert.equal(
        el.querySelector('[data-position="today"]').querySelector('.df-position-value').textContent,
        'NO BET',
        'the personal receipt remains payout-free',
      );
      const meter = el.querySelector('.df-modifier-meter--settling');
      assert.ok(meter, 'the global winning percentage still gets its thermometer');
      assert.match(meter.textContent, /196%/);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
      el.disconnectedCallback();
    }
  });

  test('stacked day bets show the committed stake while masking only the FLIP balance number', async () => {
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
    assert.match(el.querySelector('[data-position="today"]').textContent, /43,844 FLIP/,
      'today shows the committed pre-flip amount');
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /43,840 FLIP/,
      'tomorrow remains visible');
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '••••',
      'the wallet FLIP balance stays masked until the result is revealed');
    assert.equal(el.querySelector('[data-bind="df-funds-flip-unit"]').textContent, 'FLIP',
      'only the protocol balance number is blurred');
    assert.match(el.querySelector('[data-bind="df-funds-wwxrp"]').textContent, /12,345 WWXRP/);
    assert.equal(el.querySelectorAll('.df-position-delta').length, 0,
      'ordinary indexed values do not carry settlement markers');
    const displays = el.querySelectorAll('.df-funds__display');
    assert.equal(displays.length, 3, 'three currencies share one protocol-coins instrument');
    assert.ok(displays[0].classList.contains('df-funds__display--flip-total'),
      'owned and claimable FLIP keep their own cell');
    assert.ok(displays[1].classList.contains('df-funds__display--wwxrp'),
      'WWXRP keeps its own cell');
    assert.ok(displays[2].classList.contains('df-funds__display--sdgnrs'),
      'sDGNRS keeps its own cell');
    const fundsToggle = el.querySelector('[data-bind="df-funds-toggle"]');
    assert.ok(fundsToggle, 'Protocol Coins has a compact disclosure control');
    assert.equal(fundsToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(displays[0].hidden, false, 'FLIP is the default visible balance');
    assert.equal(displays[1].hidden, true, 'WWXRP starts collapsed');
    assert.equal(displays[2].hidden, true, 'sDGNRS starts collapsed');
    const claim = el.querySelector('[data-bind="df-claim-flip-cta"]');
    assert.ok(claim, 'the compact FLIP Claim stays in the default visible row');
    assert.equal(el.querySelector('[data-bind="df-player-fund-actions"]'), null,
      'there is no hidden claim/fund strip inside Protocol Coins');
    fundsToggle.dispatchEvent({ type: 'click' });
    assert.equal(fundsToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(displays[1].hidden, false, 'the dropdown restores WWXRP');
    assert.equal(displays[2].hidden, false, 'the dropdown restores sDGNRS');
    assert.equal(el.querySelector('[data-bind="df-claim-flip-cta"]'), claim,
      'expanding the balances does not move or replace the FLIP Claim action');
    assert.match(APP_CSS,
      /\.df-funds__display--flip-total \.df-funds__value\s*\{[^}]*color:\s*#fde68a[^}]*245, 158, 11/s,
      'the FLIP balance retains its yellow protocol-coin accent');
    assert.match(APP_CSS,
      /\.df-funds__display--wwxrp \.df-funds__value\s*\{[^}]*color:\s*#f87171[^}]*239, 68, 68/s,
      'WWXRP exactly matches the loss-FLIP red treatment');
    assert.match(APP_CSS,
      /\.df-position-value\s*\{[^}]*color:\s*#fde68a[^}]*245, 158, 11/s,
      'unsettled FLIP positions use yellow');
    assert.match(APP_CSS,
      /\.df-position-value--win\s*\{[^}]*color:\s*#86efac/s,
      'winning outcomes stay green');
    assert.match(APP_CSS,
      /\.df-position-value--loss\s*\{[^}]*color:\s*#f87171/s,
      'losing outcomes stay red');
    assert.match(APP_CSS,
      /\.df-funds__display--sdgnrs \.df-funds__value\s*\{[^}]*color:\s*#d8b4fe[^}]*168, 85, 247/s,
      'sDGNRS uses the purple protocol-coin theme');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__toggle\[aria-expanded="true"\] \+ \.df-funds__coins\s*\{[^}]*border-top:\s*1px solid rgba\(254, 202, 202, 0\.16\)/s,
      'the full-width divider appears only while Protocol Coins is expanded');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__coins\s*\{[^}]*border-top:\s*0/s,
      'the collapsed Protocol Coins box has no divider');
    assert.match(APP_CSS,
      /\.df-funds:has\(\.df-funds__toggle\[aria-expanded="false"\]\)\s*\{[^}]*height:\s*2\.6rem/s,
      'the collapsed Protocol Coins box matches the default ledger-row height');
    assert.match(APP_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.df-tomorrow-layout\s*\{[^}]*height:\s*2\.6rem/s,
      'the Tomorrow box keeps the shared default height on phones too');
    assert.doesNotMatch(APP_CSS, /\.df-funds__display\.has-claimable/,
      'claimable FLIP does not receive a different row background');
    assert.match(
      APP_CSS,
      /body\.layout-basic \.df-funds__value\s*\{[^}]*text-align:\s*right/s,
      'coinflip token figures are right aligned',
    );
    assert.match(
      APP_CSS,
      /body\.layout-basic \.df-funds__value\s*\{[^}]*font-size:\s*clamp\(0\.92rem,\s*2\.8vw,\s*1\.16rem\)/s,
      'Protocol Coins FLIP uses the same numeric scale as the neighboring bet boxes',
    );
    assert.match(
      APP_CSS,
      /\.jackpot-hero :is\([\s\S]*?\.dec-flip-balance__value,[\s\S]*?\.dec-funds__value,[\s\S]*?\.df-position-value,[\s\S]*?\.df-funds__value[\s\S]*?font-size:\s*var\(--hero-box-currency-font-size\)/,
      'every currency readout in the top hero row shares one responsive font size',
    );
    assert.match(el.innerHTML, /class="df-funds__title df-funds__toggle"[\s\S]*?<span>PROTOCOL COINS<\/span>/,
      'the shared instrument has one Protocol Coins label');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__title\s*\{[^}]*justify-self:\s*end[^}]*text-align:\s*right/s,
      'the shared Protocol Coins heading aligns with the right-side balances');
    assert.equal(el.querySelectorAll('.df-funds__label').length, 0,
      'currency units in the values replace three redundant headings');
    assert.match(
      APP_CSS,
      /body\.layout-basic \.df-position\s*\{\s*margin:\s*auto 0 0\.42rem;/s,
      'the Today/Tomorrow stack pushes down onto the funds stack',
    );
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__coins\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
      'all three currencies use compact rows inside one display');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__display\s*\{[^}]*grid-template-areas:\s*"action value"[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)/s,
      'every Protocol Coins action is left of its right-aligned balance');
    assert.match(APP_CSS,
      /\.df-funds__display \+ \.df-funds__display::before\s*\{[^}]*right:\s*0[^}]*left:\s*0[^}]*height:\s*1px[^}]*background:\s*rgba\(254, 202, 202, 0\.16\)/s,
      'full-width horizontal hairlines separate the three compact rows');
    assert.match(APP_CSS,
      /\.df-modifier-meter-slot\s*\{[^}]*position:\s*absolute[^}]*left:/s,
      'modifier rail is pinned on the left and cannot shift the ledger');
    assert.match(APP_CSS,
      /\.df-modifier-meter__marker\s*\{[^}]*bottom:/s,
      'modifier marker travels vertically');
    assert.match(APP_CSS,
      /\.df-tomorrow-layout\s*\{[^}]*grid-template-areas:\s*"action total"[^}]*grid-template-columns:\s*calc\(3rem \+ 0\.22rem\) minmax\(0, 1fr\)/s,
      'Tomorrow gives its compact popup trigger the same inset action lane as Claim');
    assert.match(APP_CSS,
      /\.app-daily-flip :is\([\s\S]*?\.df-burn-sdgnrs-cta[\s\S]*?font-size:\s*var\(--df-action-font-size, 0\.56rem\)/,
      'the five visible flip actions share the slightly larger desktop label size');
    assert.match(APP_CSS,
      /@media \(max-width: 520px\)[\s\S]*?\.app-daily-flip\s*\{\s*--df-action-font-size:\s*0\.49rem;/,
      'phone labels grow slightly without changing the compact button heights');
    assert.match(APP_CSS,
      /\.df-tomorrow-layout \.df-position-unit\s*\{[^}]*margin-left:\s*1ch/s,
      'Tomorrow’s numeric total uses the full monospace gap before FLIP');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds\s*\{[^}]*padding:\s*0\.2rem 0\.24rem 0\.24rem/s,
      'Protocol Coins uses the same outer right inset as Tomorrow’s Bet');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__display\s*\{[^}]*padding:\s*0\.18rem 0\.22rem/s,
      'the Protocol Coins value lane matches Tomorrow’s inner right inset');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__value\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*baseline[^}]*justify-content:\s*flex-end/s,
      'Protocol Coins and Tomorrow align the number/unit pair on one baseline');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__unit\s*\{[^}]*margin-left:\s*1ch/s,
      'both lower FLIP units match the full-space rhythm of Today’s Bet');
    assert.equal(claim.disabled, false,
      'the focused FLIP claim popup remains reachable while the number is masked');
    el.disconnectedCallback();
  });

  test("Tomorrow's live stake uses the four-significant-digit formatter", async () => {
    _currentStakeWei = String(123_456n * (10n ** 18n));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    assert.equal(
      el.querySelector('[data-position="tomorrow"]').querySelector('.df-position-number').textContent,
      '123,500',
    );
    el.disconnectedCallback();
  });

  test("Today's result can reveal while its exact stake loads, without borrowing tomorrow's stake", async () => {
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
    assert.equal(globalThis.localStorage.getItem('flip_day_84532_67'), '1',
      'the presentation is not blocked by the slower historical log lookup');
    assert.equal(el.querySelector('[data-position="today"]').textContent, "Today's bet—",
      'unknown remains unknown instead of settling against tomorrow’s 12,000 FLIP');
    assert.equal(el.querySelector('[data-bind="df-error"]').hidden, true);
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
    assert.match(el.querySelector('[data-position="today"]').textContent, /WIN196%\+85,934 FLIP/,
      'the resolved payout is shown in its own box after reveal');
    assert.equal(el.querySelector('.df-modifier-result'), null,
      'the old expanded result is gone');
    el.disconnectedCallback();
  });

  test("Today's Bet settles the full stored stake plus auto-rebuy carry", async () => {
    const unit = 10n ** 18n;
    _resolvedStakeWei = String(1_006_807n * unit);
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: true,
      takeProfitWei: 0n,
      carryWei: 919_901n * unit,
      startDay: 64,
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 100 },
    };
    localStorage.setItem('flip_day_84532_67', '1');

    const el = mount();
    await flushMicrotasks();

    assert.match(
      el.querySelector('[data-position="today"]').textContent,
      /Today's betWIN200%\+2,013,614 FLIP/,
      'the receipt and payout use the effective 1,006,807 FLIP position, not only stored credits',
    );
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

    assert.match(el.querySelector('[data-position="today"]').textContent, /43,844 FLIP/,
      "before reveal, today's committed stake is visible");
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '••••');
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    const today = el.querySelector('[data-position="today"]');
    const tomorrow = el.querySelector('[data-position="tomorrow"]');
    const flipTotal = el.querySelector('[data-bind="df-funds-flip-total"]');
    assert.match(today.textContent, /Today's betWIN196%\+85,934 FLIP/,
      "after reveal, today's exact result is unmasked");
    assert.equal(today.querySelector('.df-position-outcome').textContent, 'WIN');
    assert.equal(today.querySelector('.df-position-percentage').textContent, '196%');
    assert.ok(today.querySelector('.df-position-value').className.includes('--win'),
      'the positive result receives the green treatment');
    assert.match(tomorrow.textContent, /12,000 FLIP/,
      "tomorrow's unresolved stake remains separate");
    assert.equal(el.querySelectorAll('.df-position-delta').length, 0,
      'the win/loss amount is no longer duplicated beside ledger values');
    assert.equal(flipTotal.textContent, '5,599,985',
      'Protocol Coins includes wallet FLIP plus the existing and just-won claimable amount');
    assert.equal(el.querySelector('.df-modifier-result'), null,
      'the resolved row is the only persistent result');

    // A refresh can still return the resolved day as depositedAmount. The
    // contract read remains authoritative for the current day.
    storeMod.update('viewing.address', TEST_ADDR);
    await flushMicrotasks();

    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/,
      'a stale dashboard refresh cannot resurrect the resolved stake');
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '5,599,985',
      'a stale API claimable baseline cannot erase the saved effective total');

    _currentStakeWei = '10000000000000000000000';
    storeMod.update('viewing.address', TEST_ADDR);
    await flushMicrotasks();

    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /10,000 FLIP/,
      'a changed current-day chain stake appears after refresh');
    el.disconnectedCallback();
  });

  test('a win folds the exact live claimable amount into Protocol Coins FLIP', async () => {
    const exactClaimable = 4_612_331n * 10n ** 18n;
    coinflipMod.__setClaimableReaderForTest(async () => exactClaimable);
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '••••');
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '5,599,985',
      'the effective total is wallet balanceOf plus previewClaimCoinflips');
    assert.equal(el.querySelector('[data-bind="df-claim-flip-cta"]').disabled, false,
      'the exact chain claimable still enables its separate claim action');
    el.disconnectedCallback();
  });

  test('a revealed win folds only pending claim credit into BAF and animates the score lane', async () => {
    const unit = 10n ** 18n;
    _resolvedStakeWei = String(100n * unit);
    coinflipMod.__setClaimableReaderForTest(async () => 450n * unit);
    _fetchResponses = {
      dashboard: {
        ...dashboardPayload(),
        coinflip: {
          ...dashboardPayload().coinflip,
          claimablePreview: String(200n * unit),
        },
      },
      flipDay: { day: 67, win: true, rewardPercent: 100 },
      gameState: { level: 7 },
      baf: {
        level: 10,
        score: String(1_000n * unit),
        rank: 3,
        totalParticipants: 20,
        roundStatus: 'open',
      },
    };

    const el = mount();
    await flushMicrotasks();

    const baf = el.querySelector('[data-bind="df-baf-score"]');
    assert.equal(baf.textContent, '1,000',
      'the unrevealed result cannot leak into the indexed BAF score');
    assert.equal(el.querySelector('[data-bind="df-baf-rank"]').textContent, 'RANK #3');

    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.equal(baf.textContent, '1,250',
      'BAF adds live preview minus already-processed claimableStored');
    assert.equal(el.querySelector('[data-bind="df-baf-rank"]').textContent, 'RANK #3',
      'the latest indexed rank stays visible while an unindexed score increase is pending');
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '988,104',
      'Protocol Coins independently adds the full 450 FLIP claimable amount');
    assert.equal(el.querySelector('[data-bind="df-baf-score-gain"]'), null,
      'pending BAF is folded into the score instead of a second ON CLAIM line');
    assert.doesNotMatch(el.textContent, /ON CLAIM/);
    assert.match(APP_CSS,
      /\.df-baf-score\.balance-rise::before\s*\{[^}]*59, 130, 246/s,
      'the shared count-up sweep is recolored blue for BAF');
    assert.match(APP_CSS,
      /\.balance-rise \.df-baf-score__value\s*\{[^}]*animation:\s*df-baf-score-rise/s,
      'a same-scope score increase animates the BAF number on reveal');
    assert.match(APP_CSS,
      /\.df-baf-transfer\s*\{[^}]*position:\s*fixed;[^}]*animation:\s*df-baf-transfer-flight/s,
      "today's finalized +FLIP receipt has a layout-independent flight into BAF");
    assert.match(APP_CSS,
      /@keyframes df-baf-transfer-flight\s*\{[\s\S]*var\(--df-baf-flight-x\)[\s\S]*var\(--df-baf-flight-y\)/,
      'the receipt travels to the measured BAF value rather than a hard-coded screen point');
    assert.match(
      el.innerHTML,
      /df-baf-score__label[\s\S]*?df-baf-score__info[\s\S]*?BIG ASS FLIP SCORE/,
      'the info dot sits directly left of the Big Ass Flip Score title',
    );
    assert.match(APP_CSS,
      /\.df-baf-score__info\s*\{[^}]*box-sizing:\s*border-box;[^}]*min-width:\s*0\.72rem;[^}]*flex:\s*0 0 0\.72rem;[^}]*border-radius:\s*999px;[^}]*color:\s*inherit/s,
      'the info control stays a true circle and inherits the muted title color');
    assert.match(APP_CSS,
      /\.df-baf-score__rank\s*\{[^}]*align-self:\s*center;[^}]*font-size:\s*0\.5rem;[^}]*line-height:\s*1\.1/s,
      'rank is vertically centered against the neighboring BAF text');
    el.disconnectedCallback();
  });

  test('a claimable indexer lag never raises BAF when the revealed flip lost', async () => {
    const unit = 10n ** 18n;
    _resolvedStakeWei = String(100n * unit);
    coinflipMod.__setClaimableReaderForTest(async () => 450n * unit);
    _fetchResponses = {
      dashboard: {
        ...dashboardPayload(),
        coinflip: {
          ...dashboardPayload().coinflip,
          claimablePreview: String(200n * unit),
        },
      },
      flipDay: { day: 67, win: false, rewardPercent: 0 },
      gameState: { level: 7 },
      baf: {
        level: 10,
        score: String(1_000n * unit),
        rank: 3,
        totalParticipants: 20,
        roundStatus: 'open',
      },
    };

    const el = mount();
    await flushMicrotasks();
    const baf = el.querySelector('[data-bind="df-baf-score"]');
    assert.equal(baf.textContent, '1,000');

    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.equal(baf.textContent, '1,000',
      'only a winning settlement can contribute an optimistic BAF delta');
    const receipt = JSON.parse(localStorage.getItem(`flip_settlement_84532_67_${TEST_ADDR}`));
    assert.equal(receipt.bafGainWei, '0', 'the repaired loss receipt cannot revive the false gain');
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
      /Today's betWIN196%\+85,934 FLIP/,
      'reload keeps the repaired resolved payout in today');
    assert.equal(reloaded.querySelector('[data-bind="df-funds-flip-total"]').textContent, '5,599,985',
      'saved result retains claimable FLIP in the effective total');
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
    const flipTotal = el.querySelector('[data-bind="df-funds-flip-total"]');
    assert.match(today.textContent, /Today's betLOSS-43,844 FLIP/);
    assert.match(tomorrow.textContent, /9,000 FLIP/);
    assert.equal(flipTotal.textContent, '5,514,051',
      'loss leaves prior unclaimed FLIP included in the effective total');
    assert.equal(el.querySelectorAll('.df-position-delta').length, 0);
    assert.equal(today.querySelector('.df-position-value').textContent, '-43,844 FLIP',
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
    assert.match(el.innerHTML, /aria-label="Add to tomorrow's bet"[^>]*>ADD BET<\/button>/,
      'the transaction control names its full Add Bet action');
    const amount = el.querySelector('[name="df-amount"]');
    assert.match(el.innerHTML,
      /df-add-bet-dialog__value[\s\S]*?type="number" name="df-amount"[^>]*data-bind="df-add-bet-number"/,
      'the amount headliner itself accepts an exact numeric amount');
    assert.doesNotMatch(el.innerHTML, /EXACT AMOUNT|df-add-bet-dialog__number-field/,
      'there is no redundant exact-amount input below the headliner');
    assert.match(el.innerHTML, /type="range" data-bind="df-add-bet-slider"/,
      'the dialog retains its quick amount slider');
    assert.match(el.innerHTML,
      /df-add-bet-dialog__head[\s\S]*?src="\/whitepaper\/flame-logo-split\.svg"/,
      'the popup header uses the FLIP split-flame mark');
    assert.doesNotMatch(el.innerHTML,
      /df-add-bet-dialog__head[\s\S]*?src="\/specials\/special_flip_static\.svg"/,
      'the popup no longer shows the WWXRP-style face');
    const dialog = el.querySelector('[data-bind="df-add-bet-dialog"]');
    assert.equal(dialog.hidden, true, 'the slider stays out of the Tomorrow row until requested');
    flip.dispatchEvent({ type: 'click' });
    assert.equal(dialog.hidden, false, 'Add Bet opens its amount dialog without sending a transaction');
    const reuse = el.querySelector('[data-bind="df-add-bet-reuse"]');
    assert.equal(reuse.hidden, false);
    assert.equal(reuse.textContent, 'REUSED WINNINGS +0.75% · +7.5 FLIP',
      'the default 1,000-FLIP rebet previews its claimable-winnings bonus');
    amount.value = '54000';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(amount.value, '54000', 'the prominent amount headliner retains the typed selection');
    assert.equal(reuse.textContent, 'REUSED WINNINGS +0.75% · +405 FLIP',
      'the reuse bonus follows the exact typed amount');
    const slider = el.querySelector('[data-bind="df-add-bet-slider"]');
    assert.equal(slider.step, '100', 'large totals make the slider use round 100-FLIP stops');
    assert.equal(slider.value, '54000', 'the number field keeps the slider synchronized');
    amount.value = '54123';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(amount.value, '54123', 'typing can still retain an exact whole-FLIP amount');
    assert.equal(slider.value, '54100', 'the slider thumb follows the nearest round stop');
    slider.value = '54149';
    slider.dispatchEvent({ type: 'input' });
    assert.equal(slider.value, '54100', 'a large-total slider selection snaps to its nearest round stop');
    assert.equal(amount.value, '54100', 'a snapped slider selection updates the exact number field');
    assert.equal(el.querySelector('[data-bind="df-bet-up"]'), null);
    assert.equal(el.querySelector('[data-bind="df-bet-down"]'), null);
    assert.ok(
      el.innerHTML.indexOf('data-bind="df-add-bet-controls"')
        < el.innerHTML.indexOf('data-bind="df-position-tomorrow"'),
      'the Add Bet trigger is laid out to the left of Tomorrow’s Bet',
    );
    assert.equal(el.querySelector('[data-bind="df-claim-cta"]'), null,
      'Claim DGNRS CTA removed from the coinflip column');
    assert.ok(!/Claim DGNRS/.test(el.innerHTML), 'no claim label in markup');
    assert.match(APP_CSS,
      /\.df-next-bet \.df-flip-cta\s*\{[^}]*background:\s*linear-gradient\(180deg, #fde68a, #f59e0b\)/s,
      'Add Bet uses the yellow FLIP action treatment');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-next-bet \.df-flip-cta\s*\{[^}]*width:\s*3rem[^}]*min-width:\s*3rem[^}]*max-width:\s*3rem/s,
      'Add Bet uses the same compact footprint as Claim');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-next-bet \.df-flip-cta\s*\{[^}]*align-self:\s*center/s,
      'the compressed Add Bet action is vertically centered');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-next-bet \.df-flip-cta\s*\{[^}]*justify-self:\s*start[^}]*margin-left:\s*0\.22rem/s,
      'Add Bet uses the same inner left inset as the Claim action below it');
    assert.match(STATUS_CSS,
      /\.df-next-bet__quest\s*\{[^}]*bottom:\s*auto;[^}]*top:\s*0\.12rem;[^}]*left:\s*3\.65rem;[^}]*width:\s*1\.18rem;[^}]*height:\s*1\.18rem/s,
      'the coinflip quest marker sits above and just right of Add Bet, inside the Tomorrow box');
    assert.match(STATUS_CSS,
      /\.df-next-bet__boon\s*\{[^}]*bottom:\s*0\.08rem;[^}]*left:\s*3\.65rem;[^}]*top:\s*auto/s,
      'a simultaneous boon uses the lower part of the same contained badge lane');
    assert.match(APP_CSS,
      /\.df-add-bet-dialog__value\s*\{[^}]*text-align:\s*center[^}]*text-overflow:\s*ellipsis/s,
      'the popup gives the selected amount a stable prominent readout');
    assert.match(APP_CSS,
      /\.df-add-bet-dialog__value input\s*\{[^}]*font:\s*inherit[^}]*text-align:\s*center/s,
      'the editable input inherits the prominent amount treatment');
    assert.doesNotMatch(APP_CSS, /\.df-player-fund-actions|\.df-player-fund-widget/,
      'the removed three-widget strip leaves no dormant styling behind');
    assert.match(APP_CSS,
      /\.app-daily-flip \.df-next-bet \.df-flip-cta\[data-write\],[\s\S]*?\.app-daily-flip \.df-funds \.df-claim-flip-cta\[data-write\]\s*\{[^}]*width:\s*3rem[^}]*min-width:\s*3rem[^}]*max-width:\s*3rem/s,
      'Add Bet and Protocol Coins Claim share one exact footprint');
    assert.match(APP_CSS,
      /\.app-daily-flip \.df-next-bet \.df-flip-cta\[data-write\],[\s\S]*?height:\s*1\.3rem/s,
      'Add Bet participates in the shared action-control rule');
    assert.doesNotMatch(APP_CSS, /\.df-next-bet__stepper|\.df-next-bet__arrows/,
      'the removed inline amount and arrow controls leave no dormant styling');
    assert.match(APP_CSS,
      /\.df-funds \.df-claim-flip-cta\[data-write\]\s*\{[^}]*background:\s*linear-gradient\(180deg, #fde68a, #f59e0b\)/s,
      'the restored FLIP Claim retains the protocol yellow asset treatment');
    assert.match(APP_CSS,
      /\.pfd-input-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 3\.5rem 6\.5rem/s,
      'the funds popup reserves one fixed action column for every claim/fund mode');
    assert.equal(el.querySelector('[data-bind="df-redeem-group"]'), null,
      'FLIP redemption lives only in the purchase panel');
    el.disconnectedCallback();
  });

  test("Tomorrow's Add Bet number input submits its selected whole-FLIP amount", async () => {
    const calls = [];
    const deposit = Object.assign(
      async (...args) => {
        calls.push(['send', ...args]);
        return { hash: '0xcompact', wait: async () => ({ status: 1, logs: [] }) };
      },
      { staticCall: async (...args) => { calls.push(['static', ...args]); } },
    );
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: 84532n }),
      getSigner: async () => ({ getAddress: async () => TEST_ADDR }),
    });
    coinflipMod.__setContractFactoryForTest(() => ({
      depositCoinflipWithCarry: deposit,
      connect() { return this; },
    }));
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();
    const input = el.querySelector('[name="df-amount"]');
    const button = el.querySelector('[data-bind="df-flip-cta"]');
    const confirm = el.querySelector('[data-bind="df-add-bet-confirm"]');
    const unit = 10n ** 18n;
    for (const [draft, expected] of [
      ['100', 100n * unit],
      ['2000', 2_000n * unit],
      ['5237', 5_237n * unit],
    ]) {
      button.dispatchEvent({ type: 'click' });
      input.value = draft;
      input.dispatchEvent({ type: 'input' });
      confirm.dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      assert.deepEqual(calls.slice(-2), [
        ['static', TEST_ADDR, expected],
        ['send', TEST_ADDR, expected],
      ], `${draft} selected FLIP reaches the contract exactly`);
      await new Promise((resolve) => setTimeout(resolve, 525));
    }
    el.disconnectedCallback();
  });

  test('Add Bet bonuses only the portion funded by reused winnings', async () => {
    const unit = 10n ** 18n;
    const dashboard = dashboardPayload();
    dashboard.flipBalance = String(1_000n * unit);
    dashboard.coinflip.claimablePreview = String(200n * unit);
    _fetchResponses = { dashboard, flipDay: null };
    const el = mount();
    await flushMicrotasks();

    el.querySelector('[data-bind="df-flip-cta"]').dispatchEvent({ type: 'click' });
    const input = el.querySelector('[data-bind="df-add-bet-number"]');
    const reuse = el.querySelector('[data-bind="df-add-bet-reuse"]');
    assert.equal(input.value, '1000');
    assert.equal(reuse.textContent, 'REUSED WINNINGS +0.75% · +1.5 FLIP',
      'the wallet-funded 800 FLIP receives no reuse bonus');
    assert.equal(reuse.getAttribute('title'), '200 FLIP of this bet comes from winnings.');

    el.disconnectedCallback();
  });

  test('Add Bet shows the concrete extra FLIP from an active coinflip boon', async () => {
    const dashboard = dashboardPayload();
    dashboard.flipBalance = String(500_000n * 10n ** 18n);
    storeMod.update('app.boons', {
      address: TEST_ADDR,
      day: 67,
      exact: true,
      boons: [{ boonType: 3, consumed: false }],
    });
    _fetchResponses = { dashboard, flipDay: null };
    const el = mount();
    await flushMicrotasks();

    el.querySelector('[data-bind="df-flip-cta"]').dispatchEvent({ type: 'click' });
    const amount = el.querySelector('[data-bind="df-add-bet-number"]');
    amount.value = '1000';
    amount.dispatchEvent({ type: 'input' });
    const boon = el.querySelector('[data-bind="df-add-bet-boon"]');
    assert.equal(boon.hidden, false);
    assert.equal(boon.textContent, '+250 FLIP BOON');

    amount.value = '500000';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(boon.textContent, '+25000 FLIP BOON',
      'the preview stops growing after the contract\'s 100k eligible base');
    el.disconnectedCallback();
  });

  test("the small square on Today's Bet opens the live auto-rebuy settings", async () => {
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: true,
      takeProfitWei: 2_000n * 10n ** 18n,
      carryWei: 475n * 10n ** 18n,
      startDay: 64,
    }));
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    const trigger = el.querySelector('[data-bind="df-auto-rebuy-cta"]');
    assert.ok(trigger, 'compact Auto Rebuy control is mounted');
    assert.ok(
      el.innerHTML.indexOf('class="df-coinflip-record-rail"')
        < el.innerHTML.indexOf('data-bind="df-position-today"'),
      "the balanced rail is attached immediately above Today's Bet, not placed in the header",
    );
    assert.match(el.innerHTML,
      /df-coinflip-record-rail__[\s\S]*?data-bind="df-coinflip-record"[\s\S]*?data-bind="df-auto-rebuy-cta"/,
      'blank spacer, lifetime record, and Auto Rebuy share one balanced rail');
    assert.match(APP_CSS,
      /\.df-coinflip-record-rail\s*\{[^}]*top:\s*-1\.92rem[^}]*grid-template-columns:\s*1\.62rem minmax\(0, 1fr\) 1\.62rem/s,
      "equal side slots keep the lifetime strip centered above Today's Bet");
    assert.match(APP_CSS,
      /\.app-daily-flip:has\(\.df-funds__toggle\[aria-expanded="true"\]\)[\s\S]*?\.df-coinflip-record-rail\s*\{[^}]*position:\s*relative;[^}]*top:\s*auto;/s,
      'expanded Protocol Coins puts the scoreboard in flow instead of over the flip');
    assert.match(APP_CSS,
      /\.df-auto-rebuy-cta\s*\{[^}]*position:\s*relative[^}]*width:\s*1\.62rem[^}]*height:\s*1\.62rem/s,
      'Auto Rebuy fills the right balancing slot');
    assert.equal(el.querySelector('[data-bind="df-auto-rebuy-cta-status"]').textContent, 'ON');
    assert.equal(trigger.classList.contains('is-active'), true);
    trigger.dispatchEvent({ type: 'click' });

    const dialog = el.querySelector('[data-bind="df-auto-rebuy-dialog"]');
    const toggle = el.querySelector('[name="df-auto-rebuy-enabled"]');
    const input = el.querySelector('[name="df-auto-rebuy-take-profit"]');
    const save = el.querySelector('[data-bind="df-auto-rebuy-save"]');
    assert.equal(dialog.hidden, false);
    assert.equal(toggle.checked, true);
    assert.equal(input.value, '2000');
    assert.equal(el.querySelector('[data-bind="df-auto-rebuy-carry"]').textContent, '475 FLIP');
    assert.match(el.innerHTML, /unbanked part of each win rolling/i);
    assert.match(el.innerHTML, /Take profit chunk/i);

    toggle.checked = false;
    toggle.dispatchEvent({ type: 'change' });
    assert.equal(input.disabled, true, 'take profit is inactive when auto rebuy is off');
    assert.match(el.querySelector('[data-bind="df-auto-rebuy-help"]').textContent, /cashes out/i,
      'turning an active rebuy off explains what happens to its rolling carry');
    assert.equal(save.disabled, false, 'the changed off state is ready to save');
    dialog.dispatchEvent({ type: 'click', target: dialog });
    assert.equal(dialog.hidden, true, 'the backdrop closes without changing settings');
    el.disconnectedCallback();
  });

  test('the centered strip colors all-time history and Last 15 majorities independently', async () => {
    localStorage.setItem('flip_day_84532_67', '1');
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: null,
      coinflipStats: {
        wins: 27,
        losses: 19,
        recent: Array.from({ length: 15 }, (_, index) => ({
          day: 68 - index,
          win: [true, false, false, true, false, false, true, false, false, false, true, false, false, true, false][index],
        })),
      },
    };
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="df-coinflip-wins"]').textContent, '27');
    assert.equal(el.querySelector('[data-bind="df-coinflip-losses"]').textContent, '19');
    assert.match(el.innerHTML,
      /df-coinflip-record__label--record[^>]*>[\s\n]*ALL TIME<[\s\S]*df-coinflip-record__label--recent[^>]*>[\s\n]*LAST 15</,
      'the shared board labels its all-time score and recent result bank');
    const marks = el.querySelector('[data-bind="df-coinflip-recent"]').children;
    assert.equal(marks.length, 15);
    assert.equal(marks[0].title, 'Win · Day 68', 'newest visible result starts at the left');
    assert.equal(marks[14].title, 'Loss · Day 54', 'oldest visible result ends at the right');
    assert.equal(
      el.querySelector('.df-coinflip-record__group--score').getAttribute('data-majority'),
      'win',
      'the protocol record gets a green background from its own W–L majority',
    );
    assert.equal(
      el.querySelector('.df-coinflip-record__group--recent').getAttribute('data-majority'),
      'loss',
      'Last 15 gets a red background from its independent recent majority',
    );
    assert.match(el.querySelector('[data-bind="df-coinflip-record"]').getAttribute('aria-label'),
      /All-time coinflip record: 27 wins and 19 losses/);
    assert.match(APP_CSS,
      /\.df-coinflip-record\s*\{[^}]*border:\s*1px solid rgba\(245, 166, 35, 0\.48\)[^}]*radial-gradient\([^}]*repeating-linear-gradient\(/s,
      'the compact rail uses the shared felt-and-brass casino treatment');
    const scoreRule = APP_CSS.match(/\.df-coinflip-record__score\s*\{[^}]*\}/s)?.[0] || '';
    assert.match(scoreRule,
      /font-family:\s*"Inter", system-ui, sans-serif;[^}]*font-size:\s*0\.84rem;[^}]*font-weight:\s*1000/s,
      'lifetime totals use large, blocky scoreboard numerals');
    assert.doesNotMatch(scoreRule, /(?:padding|border|background|box-shadow):/,
      'the score sits directly on the scoreboard face without a redundant inner box');
    assert.match(APP_CSS,
      /\.df-coinflip-record__mark\s*\{[^}]*height:\s*0\.52rem[^}]*border-radius:\s*1px/s,
      'the last fifteen results render as a compact square LED bank');
    assert.match(APP_CSS,
      /\.df-coinflip-record__recent\s*\{[^}]*grid-template-columns:\s*repeat\(15, 0\.38rem\)/s,
      'the recent bank reserves the requested fifteen-result window');
    assert.match(APP_CSS,
      /data-majority="win"[^}]*background-color:\s*#07140b/s,
      'a winning section receives its own dark green background');
    assert.match(APP_CSS,
      /data-majority="loss"[^}]*background-color:\s*#140707/s,
      'a losing section receives the same dark red used by Protocol Coins');
    const groupRule = APP_CSS.match(/\.df-coinflip-record__group\s*\{[^}]*\}/s)?.[0] || '';
    assert.match(groupRule,
      /repeating-linear-gradient\(\s*0deg,[^}]*rgba\(255, 255, 255, 0\.016\)/s,
      'both sections share the subtle currency-panel texture');
    assert.doesNotMatch(groupRule, /border-radius|box-shadow/,
      'the majority color fills each section instead of creating inset bubbles');
    assert.match(APP_CSS,
      /\.df-coinflip-record__group--recent\s*\{[^}]*border-left:\s*1px solid rgba\(253, 230, 138, 0\.14\)/s,
      'one quiet divider separates the two labeled readings without another card');
    assert.match(APP_CSS,
      /\.df-coinflip-record__score b\.is-ticking\s*\{[^}]*df-coinflip-score-tick/s,
      'the newly revealed global result mechanically ticks the matching score');
    assert.match(APP_CSS,
      /\.df-coinflip-record__recent\.is-shifting\s*\{[^}]*df-coinflip-bank-shift/s,
      'the result bank visibly advances one cell on resolution');
    assert.match(APP_CSS,
      /@keyframes df-coinflip-bank-shift\s*\{\s*0%\s*\{[^}]*translateX\(-0\.4rem\)[\s\S]*62%\s*\{[^}]*translateX\(0\.04rem\)/,
      'the recent bank shifts right as the newest result enters from the left');
    assert.match(APP_CSS,
      /\.df-modifier-meter__track\s*\{[^}]*var\(--gauge-red\)[^}]*var\(--gauge-green\)[^}]*var\(--gauge-blue\)/s,
      'the payout thermometer uses the shared subdued casino-instrument palette');
    el.disconnectedCallback();
  });

  test('the all-time win column and Last 15 bank tick on the exact reveal landing', async () => {
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
      coinflipStats: {
        wins: 28,
        losses: 19,
        recent: Array.from({ length: 16 }, (_, index) => ({
          day: 67 - index,
          win: index === 0 ? true : index % 2 === 0,
        })),
      },
    };
    const el = mount();
    await flushMicrotasks();

    const wins = el.querySelector('[data-bind="df-coinflip-wins"]');
    const losses = el.querySelector('[data-bind="df-coinflip-losses"]');
    assert.equal(wins.textContent, '27', 'today is held outside the public board before reveal');
    assert.equal(losses.textContent, '19');
    assert.equal(
      el.querySelector('[data-bind="df-coinflip-recent"]').children.some((mark) => mark.title === 'Win · Day 67'),
      false,
      'the latest LED does not spoil the result before the coin lands',
    );

    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.equal(wins.textContent, '28');
    assert.equal(wins.classList.contains('is-ticking'), true,
      'the global win digit gets the mechanical scoreboard tick');
    assert.equal(losses.classList.contains('is-ticking'), false);
    assert.equal(
      el.querySelector('[data-bind="df-coinflip-recent"]').classList.contains('is-shifting'),
      true,
      'the fifteen-result bank shifts on the exact counter-increment render',
    );
    assert.equal(
      el.querySelector('.df-coinflip-record__group--recent').classList.contains('is-resolving'),
      true,
      'the independent Last 15 majority background visibly lands with the new result',
    );
    const newest = el.querySelector('[data-bind="df-coinflip-recent"]').children[0];
    assert.equal(newest.title, 'Win · Day 67');
    assert.equal(newest.className.includes('is-new'), true,
      'the newest global outcome lights with the score on the same landing');
    el.disconnectedCallback();
  });

  test('every live FLIP display uses the replayed auto-rebuy remainder', async () => {
    const unit = 10n ** 18n;
    _currentStakeWei = String(1_286n * unit);
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: true,
      takeProfitWei: 10_000n * unit,
      // Deliberately stale storage: this is the carry that entered the win.
      carryWei: 1_300n * unit,
      startDay: 64,
    }));
    coinflipMod.__setClaimableReaderForTest(async () => 20_000n * unit);
    coinflipMod.__setBackingReaderForTest(async () => 21_286n * unit);
    coinflipMod.__setWidgetBalancesReaderForTest(async () => ({
      flipBalance: 165_186n * unit,
      wwxrpBalance: 0n,
      sdgnrsBalance: 0n,
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 114 },
    };
    localStorage.setItem('flip_day_84532_67', '1');
    localStorage.setItem('jackpot_complete_day_84532_67', '1');

    const el = mount();
    await flushMicrotasks();

    assert.match(
      el.querySelector('[data-position="tomorrow"]').textContent,
      /Tomorrow's bet1,286 FLIP/,
      'Tomorrow uses the replayed remainder, not stale carry storage',
    );
    assert.equal(
      el.querySelector('[data-bind="df-funds-flip-total"]').textContent,
      '186,472',
      'Protocol Coins is wallet plus the same claimable + replayed carry backing',
    );
    assert.equal(
      el.querySelector('[data-bind="df-claim-flip-cta"]').disabled,
      false,
      'CLAIM remains limited to the separately banked 20,000 FLIP',
    );

    el.querySelector('[data-bind="df-auto-rebuy-cta"]').dispatchEvent({ type: 'click' });
    assert.equal(
      el.querySelector('[data-bind="df-auto-rebuy-carry"]').textContent,
      '1,286 FLIP',
      'Rolling Now uses the replayed remainder too',
    );
    el.disconnectedCallback();
  });

  test('a confirmed claim moves FLIP between ledgers without double-counting the reveal floor', async () => {
    const unit = 10n ** 18n;
    let wallet = 165_186n * unit;
    let claimable = 20_000n * unit;
    let backing = 21_286n * unit;
    _currentStakeWei = String(1_286n * unit);
    _resolvedStakeWei = String(10_000n * unit);
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: true,
      takeProfitWei: 10_000n * unit,
      carryWei: 1_300n * unit,
      startDay: 64,
    }));
    coinflipMod.__setClaimableReaderForTest(async () => claimable);
    coinflipMod.__setBackingReaderForTest(async () => backing);
    coinflipMod.__setWidgetBalancesReaderForTest(async () => ({
      flipBalance: wallet,
      wwxrpBalance: 0n,
      sdgnrsBalance: 0n,
    }));
    const dashboard = dashboardPayload();
    dashboard.flipBalance = String(wallet);
    dashboard.coinflip.claimablePreview = String(claimable);
    _fetchResponses = {
      dashboard,
      flipDay: { day: 67, win: true, rewardPercent: 100 },
    };

    const el = mount();
    await flushMicrotasks();
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    assert.equal(
      el.querySelector('[data-bind="df-funds-flip-total"]').textContent,
      '186,472',
      'pre-claim total is wallet plus banked FLIP plus the rolling remainder',
    );

    // A normal claim mints the banked 20,000 into the wallet. The combined
    // value must stay unchanged even while the indexed dashboard still has
    // the old claimable amount and the reveal receipt remains mounted.
    wallet += claimable;
    claimable = 0n;
    backing = 1_286n * unit;
    document.dispatchEvent({
      type: contractsMod.TX_CONFIRMED_EVENT,
      detail: { blockNumber: 9_001 },
    });
    await flushMicrotasks();

    assert.equal(
      el.querySelector('[data-bind="df-funds-flip-total"]').textContent,
      '186,472',
      'the same 20,000 is not counted in both wallet and claimable after confirmation',
    );
    assert.equal(el.querySelector('[data-bind="df-claim-flip-cta"]').disabled, false,
      'the unified funds popup remains available after one ledger is emptied');
    assert.match(
      el.querySelector('[data-position="tomorrow"]').textContent,
      /1,286 FLIP/,
      'the already-rolling remainder stays in Tomorrow’s Bet',
    );
    el.disconnectedCallback();
  });

  test('saving auto rebuy enables it on-chain with the entered take-profit chunk', async () => {
    let chainEnabled = false;
    const takeProfit = 2_500n * 10n ** 18n;
    const calls = [];
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: chainEnabled,
      takeProfitWei: chainEnabled ? takeProfit : 0n,
      carryWei: 0n,
      startDay: chainEnabled ? 67 : 0,
    }));
    const enable = Object.assign(
      async (...args) => {
        calls.push(['send', ...args]);
        chainEnabled = true;
        return { hash: '0xauto', wait: async () => ({ status: 1, logs: [] }) };
      },
      { staticCall: async (...args) => { calls.push(['static', ...args]); } },
    );
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: 84532n }),
      getSigner: async () => ({ getAddress: async () => TEST_ADDR }),
    });
    coinflipMod.__setContractFactoryForTest(() => ({
      setCoinflipAutoRebuy: enable,
      connect() { return this; },
    }));
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    el.querySelector('[data-bind="df-auto-rebuy-cta"]').dispatchEvent({ type: 'click' });
    const toggle = el.querySelector('[name="df-auto-rebuy-enabled"]');
    const input = el.querySelector('[name="df-auto-rebuy-take-profit"]');
    toggle.checked = true;
    toggle.dispatchEvent({ type: 'change' });
    input.value = '2500';
    input.dispatchEvent({ type: 'input' });
    const save = el.querySelector('[data-bind="df-auto-rebuy-save"]');
    assert.equal(save.disabled, false);
    save.dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.deepEqual(calls, [
      ['static', TEST_ADDR, true, takeProfit],
      ['send', TEST_ADDR, true, takeProfit],
    ]);
    assert.equal(el.querySelector('[data-bind="df-auto-rebuy-dialog"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="df-auto-rebuy-cta-status"]').textContent, 'ON');
    el.disconnectedCallback();
  });

  test('WWXRP replaces the wallet box and opens a minimum-safe burn dialog', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    const box = el.querySelector('[data-bind="df-funds-wwxrp-box"]');
    const value = el.querySelector('[data-bind="df-funds-wwxrp"]');
    const burn = el.querySelector('[data-bind="df-burn-wwxrp-cta"]');
    assert.ok(box);
    assert.equal(value.textContent, '12,345 WWXRP');
    assert.equal(burn.disabled, false);
    assert.equal(el.querySelector('[data-bind="df-funds-wallet-box"]'), null,
      'the separate owned-FLIP wallet box is gone');

    burn.dispatchEvent({ type: 'click' });
    const dialog = el.querySelector('[data-bind="df-wwxrp-dialog"]');
    const input = el.querySelector('[name="df-wwxrp-amount"]');
    assert.equal(dialog.hidden, false);
    assert.equal(input.value, '25', 'the amount defaults to the contract minimum');
    assert.match(el.innerHTML, /weighted entry in today’s daily draw/i);
    assert.match(el.innerHTML, /cannot be recovered/i);

    el.querySelector('[data-bind="df-wwxrp-max"]').dispatchEvent({ type: 'click' });
    assert.equal(input.value, '12345');
    assert.equal(el.querySelector('[data-bind="df-wwxrp-accept"]').disabled, false);
    dialog.dispatchEvent({ type: 'click', target: dialog });
    assert.equal(dialog.hidden, true);
    el.disconnectedCallback();
  });

  test('known empty Protocol Coin balances use one dash while retaining their units', async () => {
    globalThis.localStorage.setItem('flip_day_84532_67', '1');
    _fetchResponses = {
      dashboard: {
        ...dashboardPayload(),
        flipBalance: '0',
        wwxrpBalance: '0',
        sdgnrsBalance: '0',
        coinflip: { depositedAmount: '0', claimablePreview: '0' },
      },
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    _currentStakeWei = '0';
    _resolvedStakeWei = '0';

    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '-');
    assert.equal(el.querySelector('[data-bind="df-funds-flip-unit"]').textContent, 'FLIP');
    assert.equal(el.querySelector('[data-bind="df-funds-wwxrp"]').textContent, '- WWXRP');
    assert.equal(el.querySelector('[data-bind="df-funds-sdgnrs"]').textContent, '- sDGNRS');
    assert.equal(el.querySelector('[data-bind="df-claim-flip-cta"]').disabled, false,
      'the focused FLIP funds popup remains reachable while balances are zero');
    assert.equal(el.querySelector('[data-bind="df-burn-wwxrp-cta"]').disabled, true);
    assert.equal(el.querySelector('[data-bind="df-burn-sdgnrs-cta"]').disabled, true);
    el.disconnectedCallback();
  });

  test('sDGNRS cell in Protocol Coins shows the DB balance and opens an amount-confirmed burn', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    const box = el.querySelector('[data-bind="df-funds-sdgnrs-box"]');
    const value = el.querySelector('[data-bind="df-funds-sdgnrs"]');
    const burn = el.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    assert.ok(box, 'sDGNRS is the third cell in the shared display');
    assert.equal(value.textContent, '123M sDGNRS',
      'sDGNRS balances at 100M and above drop the decimal');
    assert.equal(value.title, '123450000 sDGNRS',
      'the compact cell retains the exact balance on hover');
    assert.equal(value.getAttribute('aria-label'), 'sDGNRS balance: 123450000 sDGNRS');
    assert.equal(burn.disabled, false, 'the owner can open the burn flow with at least 1 sDGNRS');
    assert.equal(el.querySelector('.df-sdgnrs-badge'), null,
      'the three-flame reward badge stays out of the main balance UI');
    assert.ok(
      el.innerHTML.indexOf('data-bind="df-funds-wwxrp-box"')
        < el.innerHTML.indexOf('data-bind="df-funds-sdgnrs-box"'),
      'sDGNRS follows WWXRP in the shared display',
    );
    assert.match(
      el.innerHTML,
      /data-bind="df-funds-sdgnrs-box"[\s\S]*?data-bind="df-burn-sdgnrs-cta"/,
      'Burn remains attached to the sDGNRS cell',
    );
    assert.match(el.innerHTML, /class="df-funds__title df-funds__toggle"[\s\S]*?<span>PROTOCOL COINS<\/span>/);

    burn.dispatchEvent({ type: 'click' });
    const dialog = el.querySelector('[data-bind="df-burn-dialog"]');
    const input = el.querySelector('[name="df-sdgnrs-amount"]');
    const slider = el.querySelector('[data-bind="df-burn-slider"]');
    assert.equal(dialog.hidden, false, 'Burn opens the explicit amount confirmation');
    assert.equal(input.value, '1', 'the destructive action defaults to the contract minimum');
    assert.ok(slider, 'the burn amount also has a proportional slider');
    assert.equal(slider.value, '0', 'the slider starts at the one-sDGNRS minimum');
    assert.match(el.innerHTML, /25%–175% of the previewed ETH value/,
      'confirmation explains the delayed RNG range');
    assert.ok(el.querySelector('[data-bind="df-burn-expected"]'),
      'confirmation reserves a live expected-value readout');

    slider.value = '500';
    slider.dispatchEvent({ type: 'input' });
    assert.equal(input.value, '61725000.5',
      'the midpoint is derived with BigInt precision rather than a lossy Number balance');
    assert.match(slider.getAttribute('aria-valuetext') || '', /61725000\.5 sDGNRS/);

    el.querySelector('[data-bind="df-burn-max"]').dispatchEvent({ type: 'click' });
    assert.equal(input.value, '123450000', 'MAX preserves the exact burnable balance');
    assert.equal(slider.value, '1000', 'MAX keeps the slider synchronized');
    assert.equal(el.querySelector('[data-bind="df-burn-accept"]').disabled, false);

    dialog.dispatchEvent({ type: 'click', target: dialog });
    assert.equal(dialog.hidden, true, 'clicking the backdrop cancels without burning');
    el.disconnectedCallback();
  });

  test('sDGNRS VOTE opens the approval ballot and records support on an eligible charity', async () => {
    const token = 10n ** 18n;
    const previousWinner = '0x1111111111111111111111111111111111111111';
    const selected = '0x2222222222222222222222222222222222222222';
    const trailing = '0x3333333333333333333333333333333333333333';
    let voted = false;
    let reads = 0;
    const writes = [];
    const ballotState = () => ({
      level: 43,
      voter: TEST_ADDR,
      votingPower: 12_345n * token,
      lastWinner: previousWinner,
      candidates: [
        { slot: 0, recipient: previousWinner, weight: 9_000n, voted: false, previousWinner: true },
        { slot: 1, recipient: selected, weight: voted ? 14_345n : 2_000n, voted, previousWinner: false },
        { slot: 2, recipient: trailing, weight: 4_000n, voted: false, previousWinner: false },
      ],
    });
    charityVoteMod.__setCharityVoteDepsForTest({
      readState: async () => {
        reads += 1;
        return ballotState();
      },
      vote: async ({ slot }) => {
        writes.push(slot);
        voted = true;
      },
    });
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };

    const el = mount();
    await flushMicrotasks();

    const open = el.querySelector('[data-bind="df-charity-vote-cta"]');
    const burn = el.querySelector('[data-bind="df-burn-sdgnrs-cta"]');
    assert.match(el.innerHTML, /data-bind="df-charity-vote-cta"[^>]*>VOTE<\/button>/);
    assert.equal(burn.textContent, 'BURN');
    assert.match(
      APP_CSS,
      /\.df-burn-wwxrp-cta\[data-write\]\s*\{[^}]*background:\s*linear-gradient\(180deg, #ff7375, #ed0e11\)/s,
      'the WWXRP burn control uses the requested red action treatment',
    );
    assert.match(
      APP_CSS,
      /\.df-funds__sdgnrs-actions \.df-charity-vote-cta,[\s\S]*?\.df-funds__sdgnrs-actions \.df-burn-sdgnrs-cta\[data-write\]/,
      'Vote and Burn share one sizing/treatment rule',
    );
    assert.match(APP_CSS, /\.df-charity-vote-cta \{[\s\S]*?#8b5cf6/,
      'Vote uses sDGNRS purple');
    assert.match(APP_CSS, /\.df-burn-sdgnrs-cta\[data-write\] \{[\s\S]*?#ed0e11/,
      'Burn uses the WWXRP red');

    open.dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    const dialog = el.querySelector('[data-bind="df-charity-dialog"]');
    assert.equal(dialog.hidden, false);
    assert.equal(reads, 1);
    assert.equal(el.querySelector('[data-bind="df-charity-level"]').textContent, '43');
    assert.equal(el.querySelector('[data-bind="df-charity-power"]').textContent, '12.3K sDGNRS');
    assert.equal(el.querySelector('[data-bind="df-charity-supported"]').textContent, '0 / 2');
    assert.match(el.innerHTML, /Approval voting/);
    assert.match(el.innerHTML, /contract has no downvote action/);

    const priorButton = el.querySelector('[data-bind="df-charity-vote-slot-0"]');
    const supportButton = el.querySelector('[data-bind="df-charity-vote-slot-1"]');
    assert.equal(priorButton.textContent, 'SITS OUT');
    assert.equal(priorButton.disabled, true);
    assert.equal(supportButton.textContent, '+ SUPPORT');
    assert.equal(supportButton.disabled, false);

    supportButton.dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.deepEqual(writes, [1]);
    assert.equal(reads, 2, 'successful support refreshes the authoritative ranking');
    assert.equal(el.querySelector('[data-bind="df-charity-supported"]').textContent, '1 / 2');
    assert.equal(el.querySelector('[data-bind="df-charity-vote-slot-1"]').textContent, 'SUPPORTED ✓');
    assert.match(el.querySelector('[data-bind="df-charity-status"]').textContent, /Support recorded/);

    el.querySelector('[data-bind="df-charity-refresh"]').dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    assert.equal(reads, 3, 'the visible refresh control re-reads the ballot');

    dialog.dispatchEvent({ type: 'click', target: dialog });
    assert.equal(dialog.hidden, true);
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
    assert.equal(amount.value, '2000', '18-decimal quest target becomes an exact slider selection');
    assert.equal(el.querySelector('[data-bind="df-add-bet-dialog"]').hidden, false,
      'the quest opens the same Add Bet popup for review');
    assert.equal(el.querySelector('[data-bind="df-add-bet-value"]'), null,
      'the quest target is not duplicated into a read-only amount box');
    assert.equal(add.getAttribute('aria-expanded'), 'true');
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

  test('confirming a coinflip quest submits the shown minimum through Add Bet', async () => {
    const calls = [];
    const deposit = Object.assign(
      async (...args) => {
        calls.push(['send', ...args]);
        return { hash: '0xquest', wait: async () => ({ status: 1, logs: [] }) };
      },
      { staticCall: async (...args) => { calls.push(['static', ...args]); } },
    );
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: 84532n }),
      getSigner: async () => ({ getAddress: async () => TEST_ADDR }),
    });
    coinflipMod.__setContractFactoryForTest(() => ({
      depositCoinflipWithCarry: deposit,
      connect() { return this; },
    }));
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    const target = 2_000n * (10n ** 18n);
    const normalAmount = el.querySelector('[name="df-amount"]');
    normalAmount.value = '1375';
    document.dispatchEvent({
      type: 'quest:activate',
      detail: { questType: 2, target: String(target), variant: 'secondary', submit: true },
    });
    await flushMicrotasks();

    assert.deepEqual(calls, [
      ['static', TEST_ADDR, target],
      ['send', TEST_ADDR, target],
    ]);
    assert.equal(normalAmount.value, '1375',
      'the one-off quest stake does not replace Tomorrow\'s Bet draft');
    el.disconnectedCallback();
  });

  test('Reverse card waits until three seconds after the full reveal, then opens its priced dialog', async () => {
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
      'the Reverse control is absent beside the unresolved spinning coin');
    const realSetTimeout = globalThis.setTimeout;
    const scheduled = [];
    try {
      globalThis.setTimeout = (fn, delay = 0) => {
        const handle = { fn, delay: Number(delay) || 0, unref() {} };
        scheduled.push(handle);
        return handle;
      };
      el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
      assert.equal(el.querySelector('[data-bind="df-reverse-cta"]'), null,
        'the landed result gets a clean card-free reading beat');

      const cardDelay = scheduled.find((entry) => (
        entry.delay === revealPlanning.REVERSE_CARD_POST_REVEAL_DELAY_MS
      ));
      assert.ok(cardDelay, 'the Reverse card owns a dedicated post-animation delay');
      cardDelay.fn();

      const button = el.querySelector('[data-bind="df-reverse-cta"]');
      assert.ok(button, 'Reverse card appears beside the landed coin after the delay');
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
      assert.equal(sideBadge.src, '/shared/coinflip-face-eth.svg');
      assert.equal(sideBadge.alt, 'ETH — odd side');
      assert.match(el.innerHTML, /data-bind="df-reverse-accept"/);
      assert.match(el.innerHTML, /\/shared\/reverse-flip-card\.svg/);
      assert.match(el.innerHTML, /reverses the outcome of the next flip/i);
      assert.match(el.innerHTML, /alters all jackpot outcomes/i);

      const dialog = el.querySelector('[data-bind="df-reverse-dialog"]');
      dialog.dispatchEvent({ type: 'click', target: dialog });
      assert.equal(dialog.hidden, true, 'clicking the backdrop dismisses the Reverse Flip view');
      assert.equal(el.querySelector('.df-coin--landed').querySelector('img').src,
        '/shared/coinflip-face-red.svg',
        'the just-resolved loss remains authoritative during its 15-second reading window');
    } finally {
      globalThis.setTimeout = realSetTimeout;
      el.disconnectedCallback();
    }
  });

  test('the authoritative landing ignores live reversals for 15 seconds after fakeout completion', async () => {
    let queued = 0n;
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({
      queued,
      locked: false,
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    const plan = revealPlanning.selectFlipRevealPlan(67, false);
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
      const landing = scheduled.filter((entry) => entry.delay === plan.totalMs).at(-1);
      assert.ok(landing, 'the deterministic fakeout has a final landing callback');
      landing.fn();
      assert.equal(
        el.querySelector('.df-coin--landed').querySelector('img').src,
        '/shared/coinflip-face-red.svg',
        'the landing starts on the actual loss face',
      );

      queued = 1n;
      storeMod.update('connected.address', TEST_ADDR);
      await flushPromises();
      assert.equal(el.querySelector('.df-coin--live-reverse'), null,
        'a newly observed Reverse Flip cannot animate over the result yet');
      assert.equal(
        el.querySelector('.df-coin--landed').querySelector('img').src,
        '/shared/coinflip-face-red.svg',
      );

      const truthWindow = scheduled.find((entry) => (
        entry.delay === revealPlanning.RESULT_TRUTH_WINDOW_MS
      ));
      assert.ok(truthWindow, 'the authoritative face is held for exactly 15 seconds');
      truthWindow.fn();
      assert.ok(el.querySelector('.df-coin--live-reverse'),
        'queued live-side animation may resume once the reading window expires');
    } finally {
      globalThis.setTimeout = realSetTimeout;
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
      el.disconnectedCallback();
    }
  });

  test('a mid-day Reverse Flip from another wallet taps the coin, flips its face, and recolors', async () => {
    let queued = 0n;
    coinflipMod.__setReverseFlipQuoteReaderForTest(async () => ({
      queued,
      locked: false,
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    localStorage.setItem('flip_day_84532_67', '1');
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('.df-coin--landed').querySelector('img').src,
      '/shared/coinflip-face-red.svg');
    assert.ok(el.querySelector('[data-bind="df-reverse-cta"]')
      .classList.contains('df-reversi-card--target-eth'));

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
      queued = 1n;
      // The production 30-second poll uses this same refresh path. Re-fire the
      // account subscription here so the test does not have to wait on a clock.
      storeMod.update('connected.address', TEST_ADDR);
      await flushPromises();

      let coin = el.querySelector('.df-coin--live-reverse');
      let card = el.querySelector('[data-bind="df-reverse-cta"]');
      assert.ok(coin, 'the landed face is held in a live reversal stage');
      assert.ok(card.classList.contains('df-reversi-card--live-tap'));
      assert.ok(card.classList.contains('df-reversi-card--target-eth'),
        'the approach starts in the card color visible before the reversal');

      const contact = scheduled.find((entry) => entry.delay === 320);
      assert.ok(contact, 'the card gets a distinct approach before contact');
      contact.fn();
      coin = el.querySelector('.df-coin--live-reverse');
      card = el.querySelector('[data-bind="df-reverse-cta"]');
      assert.ok(coin.classList.contains('df-coin--reverse-out'),
        'the coin starts turning only after the card taps it');
      assert.ok(card.classList.contains('df-reversi-card--target-wwxrp'),
        'the docked card changes from green to red for the next available target');

      const edge = scheduled.find((entry) => entry.delay === 260);
      assert.ok(edge, 'the first half-turn reaches an edge-on frame');
      edge.fn();
      coin = el.querySelector('.df-coin--live-reverse');
      assert.equal(coin.querySelector('img').src, '/shared/coinflip-face-eth.svg');
      assert.ok(coin.classList.contains('df-coin--reverse-in'));

      const finish = scheduled.filter((entry) => entry.delay === 320).at(-1);
      assert.notEqual(finish, contact);
      finish.fn();
      const landed = el.querySelector('.df-coin--landed');
      assert.equal(landed.getAttribute('data-current-side'), 'eth');
      assert.equal(landed.querySelector('img').src, '/shared/coinflip-face-eth.svg');
      assert.ok(el.querySelector('[data-bind="df-reverse-cta"]')
        .classList.contains('df-reversi-card--target-wwxrp'));

      assert.match(APP_CSS, /@keyframes df-live-reversi-tap[\s\S]*?35\.555556%/);
      assert.match(APP_CSS, /@keyframes df-live-side-flip-out[\s\S]*?rotateY\(90deg\)/);
      assert.match(APP_CSS, /@keyframes df-live-side-flip-in[\s\S]*?rotateY\(-90deg\)/);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
      el.disconnectedCallback();
    }
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
    localStorage.setItem('flip_day_84532_67', '1');
    const el = mount();
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

  test('Add Bet slider locks cleanly when less than the 100 FLIP minimum is usable', async () => {
    const dashboard = dashboardPayload();
    dashboard.flipBalance = '50000000000000000000';
    dashboard.coinflip.claimablePreview = '0';
    _fetchResponses = { dashboard, flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    await flushMicrotasks();

    el.querySelector('[data-bind="df-flip-cta"]').dispatchEvent({ type: 'click' });
    const slider = el.querySelector('[data-bind="df-add-bet-slider"]');
    const number = el.querySelector('[data-bind="df-add-bet-number"]');
    const confirm = el.querySelector('[data-bind="df-add-bet-confirm"]');
    assert.equal(slider.disabled, true);
    assert.equal(number.disabled, true);
    assert.equal(confirm.disabled, true);
    assert.equal(number.value, '');
    assert.equal(number.placeholder, 'NOT ENOUGH');
    assert.match(confirm.getAttribute('data-write-lock-title'), /At least 100 FLIP/);
    el.disconnectedCallback();
  });

  test('Add Bet glows only when the fresh deposit reaches the live Flip bounty target', async () => {
    const unit = 10n ** 18n;
    storeMod.update('app.records', {
      recordPoolWei: 100_000n * unit,
      records: [{ kind: 0, held: false, value: 0n, barToBeat: 0n }],
    });
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    el.querySelector('[data-bind="df-flip-cta"]').dispatchEvent({ type: 'click' });
    const input = el.querySelector('[data-bind="df-add-bet-number"]');

    input.value = '199999';
    input.dispatchEvent({ type: 'input' });
    assert.equal(input.classList.contains('is-bounty-trigger'), false);

    input.value = '200000';
    input.dispatchEvent({ type: 'input' });
    assert.equal(input.classList.contains('is-bounty-trigger'), true);
    assert.equal(input.getAttribute('data-bounty-trigger'), 'true');
    assert.match(input.getAttribute('aria-description'), /Biggest Flip bounty.*38,000 FLIP/);
    assert.equal(
      el.querySelector('[data-bind="df-add-bet-bounty"]').textContent,
      'THE BIGGEST BOUNTY · +38,000 FLIP',
    );
    assert.equal(el.querySelector('.df-add-bet-dialog__card')
      .classList.contains('is-bounty-trigger'), true);
    assert.equal(el.querySelector('[data-bind="df-add-bet-slider"]')
      .classList.contains('is-bounty-trigger'), true);
    assert.equal(el.querySelector('[data-bind="df-add-bet-confirm"]')
      .classList.contains('is-bounty-trigger'), true);
    assert.match(BOUNTY_CSS, /\.df-add-bet-dialog__card\.is-bounty-trigger\s*\{[^}]*box-shadow:/s);
    assert.match(BOUNTY_CSS, /\.df-add-bet-dialog__bounty\s*\{[^}]*color:\s*#fde68a/s);
    assert.equal(BigInt(input.value) * unit, 200_000n * unit);
    el.disconnectedCallback();
  });
});

describe('new-day rollover (codex-found race)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    coinflipMod.__setCurrentStakeReaderForTest(async () => _currentStakeWei);
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: false,
      takeProfitWei: 0n,
      carryWei: 0n,
      startDay: 0,
    }));
    coinflipMod.__setResolvedStakeReaderForTest(async () => _resolvedStakeWei);
    coinflipMod.__setClaimableReaderForTest(async () => null);
    coinflipMod.__setBackingReaderForTest(async () => null);
    coinflipMod.__setLatestResultReaderForTest(async () => null);
    coinflipMod.__setWidgetBalancesReaderForTest(async () => null);
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
    coinflipMod.__resetAutoRebuyInfoReaderForTest();
    coinflipMod.__resetResolvedStakeReaderForTest();
    coinflipMod.__resetClaimableReaderForTest();
    coinflipMod.__resetBackingReaderForTest();
    coinflipMod.__resetLatestResultReaderForTest();
    coinflipMod.__resetWidgetBalancesReaderForTest();
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

  test('the RNG request starts a frozen parity coin; a bare clock shift does not', async () => {
    coinflipMod.__setLatestResultReaderForTest(async () => ({
      day: 67, win: true, rewardPercent: 96, resolved: true,
    }));
    _fetchResponses = {
      dashboard: dashboardPayload(),
      // Deliberately stale same-number/indexed input: app.daySync must win.
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();

    storeMod.update('app.daySync', {
      day: 68,
      jackpotReady: false,
      coinflipReady: false,
      rngLocked: false,
      rngRequested: false,
      ready: false,
      phase: 'waiting-both',
      coinflipResult: null,
    });
    await flushMicrotasks();

    assert.equal(el.querySelector('.df-coin--syncing'), null,
      'the wall-clock boundary alone leaves the completed coin mounted');
    assert.ok(el.querySelector('.df-coin--spinning'));

    storeMod.update('app.daySync', {
      day: 68,
      jackpotReady: false,
      coinflipReady: false,
      rngLocked: true,
      rngRequested: true,
      reverseQueued: '3',
      ready: false,
      phase: 'waiting-both',
      coinflipResult: null,
    });
    await flushMicrotasks();

    const warming = el.querySelector('.df-coin--syncing');
    assert.ok(warming, 'the observed request replaces yesterday immediately');
    assert.equal(warming.disabled, true, 'the coin cannot outrun the jackpot lane');
    assert.equal(warming.getAttribute('data-reverse-flips'), '3');
    assert.equal(warming.getAttribute('data-current-side'), 'eth');
    assert.match(warming.className, /\bdf-coin--queued-eth\b/,
      'odd request-time parity freezes the ETH face');
    assert.match(
      APP_CSS,
      /\.df-coin--syncing \.df-coin3d__inner\s*\{[^}]*animation:\s*none/s,
      'the unavailable coin stays parked instead of advertising a clickable flip',
    );
    warming.dispatchEvent({ type: 'click' });
    assert.equal(localStorage.getItem('flip_day_84532_68'), null);
    assert.equal(el.querySelector('[data-bind="df-reveal-hint"]').hidden, true);

    const exact = { day: 68, win: true, rewardPercent: 81, resolved: true, source: 'chain' };
    storeMod.update('app.lastDay', { day: 68, status: 'resolved' });
    storeMod.update('app.daySync', {
      day: 68,
      jackpotDay: 68,
      coinflipDay: 68,
      jackpotReady: false,
      coinflipReady: true,
      rngLocked: false,
      rngRequested: true,
      reverseQueued: '3',
      ready: false,
      phase: 'waiting-jackpot',
      coinflipResult: exact,
    });
    await flushMicrotasks();

    const ready = el.querySelector('.df-coin--spinning');
    assert.ok(ready);
    assert.equal(ready.disabled, false,
      'the Coinflip opens on its own processed result without waiting for jackpot processing');
    assert.equal(el.querySelector('[data-bind="df-reveal-hint"]').hidden, false,
      'the same store transition makes the flip actionable');
    el.disconnectedCallback();
  });

  test("a zeroed Tomorrow stake becomes the new unresolved Today's bet", async () => {
    _currentStakeWei = '12000000000000000000000';
    _resolvedStakeWei = '43844000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);

    // The contract has moved the day-keyed stake out of coinflipAmount(), but
    // its immutable resolved-day event has not reached the historical reader.
    _currentStakeWei = '0';
    _resolvedStakeWei = null;
    _fetchResponses.flipDay = null;
    localStorage.setItem('jackpot_complete_day_84532_68', '1');
    storeMod.update('app.lastDay', { day: 68, status: 'resolved' });
    await waitForText(
      () => el.querySelector('[data-position="today"]'),
      /Today's bet12,000 FLIP/,
    );

    assert.match(el.querySelector('[data-position="today"]').textContent, /Today's bet12,000 FLIP/,
      'the prior live stake moves into the newly unresolved result row');
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /Tomorrow's bet0 FLIP/,
      'the cleared live bucket remains visible as the new Tomorrow amount');
    el.disconnectedCallback();
  });
});
