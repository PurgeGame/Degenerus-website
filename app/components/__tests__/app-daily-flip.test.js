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
import {
  __resetHeldBalancesForTest,
  heldBalanceValue,
} from '../../app/balance-hold.js';

const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const CHIPSET_CSS = readFileSync(new URL('../../styles/coinflip-chipset.css', import.meta.url), 'utf8');
const APP_INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
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
  __resetHeldBalancesForTest();
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

function seedTomorrowHold(wei) {
  return heldBalanceValue({
    namespace: 'coinflip-tomorrow:84532',
    scope: TEST_ADDR,
    value: wei,
    released: true,
  });
}

function seedFlipAvailableHold(wei) {
  return heldBalanceValue({
    namespace: 'protocol-flip-available:84532',
    scope: TEST_ADDR,
    value: wei,
    released: true,
  });
}

function mount() {
  const Ctor = customElements.get('app-daily-flip');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

const revealPlanning = await import('../app-daily-flip.js');

function bankrollChipCounts(rack) {
  const ratio = rack.querySelector('.df-bankroll__row--ratio');
  const total = rack.querySelector('.df-bankroll__row--total');
  const tones = ratio?.querySelectorAll('.df-bankroll__chip')
    .map((chip) => chip.className.match(/df-bankroll__chip--(claimable|liquid)/)?.[1]) ?? [];
  return {
    claimable: tones.filter((tone) => tone === 'claimable').length,
    liquid: tones.filter((tone) => tone === 'liquid').length,
    total: total?.querySelectorAll('.df-bankroll__chip').length ?? 0,
    tones,
  };
}

function assertBankrollChipCounts(rack, expected, message) {
  const actual = bankrollChipCounts(rack);
  assert.equal(actual.claimable, expected.claimable, `${message}: red claimable chips`);
  assert.equal(actual.liquid, expected.liquid, `${message}: green liquid chips`);
  if (expected.total != null) {
    assert.equal(actual.total, expected.total, `${message}: logarithmic amount chips`);
  }
  assert.deepEqual(
    actual.tones,
    [
      ...Array(expected.claimable).fill('claimable'),
      ...Array(expected.liquid).fill('liquid'),
    ],
    `${message}: red chips precede green chips`,
  );
}

describe('day-wide reveal planning', () => {
  test('wager piles grow logarithmically: identical FLIP coins, more of them', () => {
    const unit = 10n ** 18n;
    const count = (amount) => revealPlanning.coinflipBetChipCount(amount * unit);

    assert.equal(count(0n), 0, 'no bet racks no coins');
    assert.equal(count(1n), 1, 'any live bet places at least one coin on the spot');
    const ladder = [100n, 1_000n, 5_000n, 10_000n, 25_000n, 50_000n, 100_000n]
      .map(count);
    assert.deepEqual(ladder, [1, 4, 8, 10, 14, 17, 20],
      'the common wager band starts small and gains distinct stack sizes');
    assert.equal(count(1_000_000_000n), 24,
      'a whale bet caps the spot instead of flooding it');

    assert.deepEqual(revealPlanning.coinflipBetChipPiles(43_844n * unit), [6, 5, 5],
      'coins split into table piles of at most seven, near-even heights');
    assert.deepEqual(revealPlanning.coinflipBetChipPiles(0n), [],
      'an empty wager has no piles');
    assert.equal(
      revealPlanning.coinflipBetChipPiles(43_844n * unit)
        .reduce((sum, pile) => sum + pile, 0),
      revealPlanning.coinflipBetChipCount(43_844n * unit),
      'the piles are exactly the logarithmic coin count, split up',
    );
    assert.deepEqual(
      [99_999n, 100_000n, 150_000n, 250_000n, 500_000n, 1_000_000n, 5_000_000n, 1_000_000_000n]
        .map((flip) => revealPlanning.coinflipBetPresentation(flip * unit)),
      [0, 5, 6, 7, 9, 11, 15, 20],
      'sub-100K wagers remain stacks before the mound ladder opens',
    );
    for (const flip of [100_000n, 500_000n, 5_000_000n]) {
      assert.ok(
        revealPlanning.coinflipBetPresentation(flip * 3n * unit / 2n)
          > revealPlanning.coinflipBetPresentation(flip * unit),
        'a minimum x1.5 win always lands on a strictly bigger pile graphic',
      );
    }
  });

  test('the payout racks the wager\'s own coins, scaled by the day\'s multiplier', () => {
    const unit = 10n ** 18n;
    const payout = (flip, rewardPercent) => {
      const stake = flip * unit;
      return [
        revealPlanning.coinflipWinChipCount(stake, stake + (stake * BigInt(rewardPercent)) / 100n),
        revealPlanning.coinflipWinChipPiles(stake, stake + (stake * BigInt(rewardPercent)) / 100n),
      ];
    };
    const staked = revealPlanning.coinflipBetChipCount(43_844n * unit);
    assert.equal(staked, 16);

    // The contract pays 150%-256% of the stake, so the payout lane spans from
    // half the wager's coins to half again more than all of them.
    assert.deepEqual(payout(43_844n, 50), [8, [4, 4]],
      'the unlucky 150% day pays back visibly less than the player put down');
    assert.deepEqual(payout(43_844n, 96), [15, [5, 5, 5]],
      'a middle day pays back about the wager itself');
    assert.deepEqual(payout(43_844n, 150), [24, [6, 6, 6, 6]],
      'the lucky 250% day pays half again more coins than the wager');
    assert.equal(payout(43_844n, 156)[1].length, 4,
      'the biggest payout stays inside the spot: five stacks is the budget');

    // The wager holds its own count no matter what the payout does — the
    // logarithmic curve prices the bet, never the win beside it.
    assert.deepEqual(revealPlanning.coinflipBetChipPiles(43_844n * unit), [6, 5, 5]);
    assert.equal(revealPlanning.coinflipWinChipCount(43_844n * unit, 43_844n * unit), 0,
      'a returned stake is not a payout');
    assert.deepEqual(revealPlanning.coinflipWinChipPiles(0n, 100n * unit), [],
      'no wager, no payout coins');
    assert.equal(revealPlanning.coinflipWinChipCount(20n * unit, 50n * unit), 2,
      'the smallest wagers still show a physically bigger payout than their coin');
  });

  test('the claim tray derives bounded ratio and one-chip-per-doubling amount counts', () => {
    const unit = 10n ** 18n;
    const ratio = (claimable, liquid) => (
      revealPlanning.coinflipClaimTrayRatioChipCounts(claimable * unit, liquid * unit)
    );
    const count = (amount) => (
      revealPlanning.coinflipClaimTrayAmountChipCount(amount * unit, 12)
    );

    assert.deepEqual(ratio(1n, 1n), { claimable: 10, liquid: 10 });
    assert.deepEqual(ratio(1n, 3n), { claimable: 5, liquid: 15 });
    assert.deepEqual(ratio(10n, 0n), { claimable: 20, liquid: 0 });
    assert.deepEqual(ratio(0n, 10n), { claimable: 0, liquid: 20 });
    assert.deepEqual(ratio(1n, 1_000_000n), { claimable: 1, liquid: 19 },
      'both positive components retain at least one chip of each tone');
    assert.deepEqual(ratio(0n, 0n), { claimable: 0, liquid: 0 });
    assert.deepEqual(
      revealPlanning.coinflipClaimTrayRatioChipCounts('not-a-balance', -1n),
      { claimable: 0, liquid: 0 },
      'invalid and negative external balances have a deterministic empty row',
    );
    const giantRatio = revealPlanning.coinflipClaimTrayRatioChipCounts(10n ** 200n, 1n);
    assert.deepEqual(giantRatio, { claimable: 19, liquid: 1 },
      'giant BigInts remain bounded and preserve the two positive tones');
    assert.equal(giantRatio.claimable + giantRatio.liquid, 20);

    assert.equal(count(0n), 0, 'an empty combined balance has no amount chips');
    assert.equal(revealPlanning.coinflipClaimTrayAmountChipCount(1n, 12), 1,
      'a positive sub-FLIP balance has one physical chip');
    assert.deepEqual([1n, 2n, 4n, 8n].map(count), [1, 2, 3, 4],
      'each whole-FLIP doubling adds exactly one visible chip');
    assert.deepEqual([3n, 7n, 15n].map(count), [2, 3, 4],
      'values immediately below the next power of two stay on the prior rung');
    assert.equal(revealPlanning.coinflipClaimTrayAmountChipCount(16n * unit, 5), 5,
      'the last free rung reaches physical capacity');
    assert.equal(revealPlanning.coinflipClaimTrayAmountChipCount(32n * unit, 5), 5,
      'the next doubling is capped at physical capacity');
    assert.equal(
      revealPlanning.coinflipClaimTrayAmountChipCount((10n ** 200n) * unit, 12),
      12,
      'a giant BigInt is capped before DOM creation without Number coercion',
    );
    assert.equal(revealPlanning.coinflipClaimTrayAmountChipCount('not-a-balance', 12), 0,
      'invalid external balance text has a deterministic empty display');
    assert.equal(revealPlanning.coinflipClaimTrayAmountChipCount(-1n, 12), 0,
      'a negative external balance has a deterministic empty display');
  });

  test('prints the daily jackpot boundary in the player timezone', () => {
    const summer = Date.parse('2026-08-16T12:00:00Z');
    const winter = Date.parse('2026-01-16T12:00:00Z');
    assert.equal(revealPlanning.coinflipDailyJackpotLabel(summer, {
      locale: 'en-US',
      timeZone: 'America/Chicago',
    }), 'DAILY AT 6 PM');
    assert.equal(revealPlanning.coinflipDailyJackpotLabel(winter, {
      locale: 'en-US',
      timeZone: 'America/Chicago',
    }), 'DAILY AT 5 PM', 'the rounded local hour follows daylight-saving changes');
    assert.equal(revealPlanning.coinflipDailyJackpotLabel(summer, {
      locale: 'en-US',
      timeZone: 'Asia/Tokyo',
    }), 'DAILY AT 8 AM');
  });

  test('normalizes protocol-wide coinflip totals and only the twenty-five newest valid results', () => {
    assert.deepEqual(revealPlanning.normalizeProtocolCoinflipStats({
      wins: '27',
      losses: 19.9,
      recent: [
        ...Array.from({ length: 26 }, (_, index) => ({
          day: 50 - index,
          win: index % 2 === 0,
          ...(index === 0 ? { rewardPercent: 150 } : {}),
          ...(index === 3 ? { rewardPercent: 50 } : {}),
        })),
        { day: 0, win: true },
      ],
    }), {
      wins: 27,
      losses: 19,
      recent: Array.from({ length: 25 }, (_, index) => ({
        day: 50 - index,
        win: index % 2 === 0,
        ...(index === 0 ? { rewardPercent: 150 } : {}),
        ...(index === 3 ? { rewardPercent: 50 } : {}),
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
      if (path.endsWith('/4')) return { day: 4, win: true, rewardPercent: 150 };
      if (path.endsWith('/3')) return { day: 3, win: true };
      if (path.endsWith('/2')) return { day: 2, win: false };
      if (path.endsWith('/1')) throw Object.assign(new Error('unresolved'), { status: 404 });
      throw new Error(`Unexpected path ${path}`);
    };

    assert.deepEqual(await revealPlanning.loadProtocolCoinflipStats(4, fetcher), {
      wins: 2,
      losses: 1,
      recent: [
        { day: 4, win: true, rewardPercent: 150 },
        { day: 3, win: true },
        { day: 2, win: false },
      ],
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

  test('hydrates winning rolls and backfills a short summary from immutable day rows', async () => {
    const paths = [];
    const fetcher = async (path) => {
      paths.push(path);
      if (path === '/game/coinflip/stats') {
        return {
          wins: 4,
          losses: 3,
          recent: [
            { day: 7, win: true },
            { day: 6, win: false },
            { day: 5, win: true },
          ],
        };
      }
      if (path.endsWith('/7')) return { day: 7, win: true, rewardPercent: 150 };
      if (path.endsWith('/5')) return { day: 5, win: true, rewardPercent: 50 };
      const day = Number(path.split('/').at(-1));
      if (day >= 1 && day <= 4) {
        return { day, win: day % 2 === 1, rewardPercent: day % 2 === 1 ? 100 : 80 };
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const expected = {
      wins: 4,
      losses: 3,
      recent: [
        { day: 7, win: true, rewardPercent: 150 },
        { day: 6, win: false },
        { day: 5, win: true, rewardPercent: 50 },
        { day: 4, win: false, rewardPercent: 80 },
        { day: 3, win: true, rewardPercent: 100 },
        { day: 2, win: false, rewardPercent: 80 },
        { day: 1, win: true, rewardPercent: 100 },
      ],
    };
    assert.deepEqual(await revealPlanning.loadProtocolCoinflipStats(7, fetcher), expected);
    assert.deepEqual(paths, [
      '/game/coinflip/stats',
      '/game/coinflip/day/4',
      '/game/coinflip/day/3',
      '/game/coinflip/day/2',
      '/game/coinflip/day/1',
      '/game/coinflip/day/7',
      '/game/coinflip/day/5',
    ], 'older days fill first, then only summary wins missing their payout color hydrate');

    paths.length = 0;
    assert.deepEqual(await revealPlanning.loadProtocolCoinflipStats(7, fetcher), expected);
    assert.deepEqual(paths, ['/game/coinflip/stats'],
      'immutable payout percentages are reused on later refreshes');
  });

  test('backfills the live sixteen-row summary to the full buffered Last 25 window', async () => {
    const paths = [];
    const fetcher = async (path) => {
      paths.push(path);
      if (path === '/game/coinflip/stats') {
        return {
          wins: 195,
          losses: 194,
          recent: Array.from({ length: 16 }, (_, index) => ({
            day: 30 - index,
            win: index % 2 === 0,
            rewardPercent: index % 2 === 0 ? 100 : 80,
          })),
        };
      }
      const day = Number(path.split('/').at(-1));
      if (day >= 5 && day <= 14) {
        return { day, win: day % 2 === 0, rewardPercent: day % 2 === 0 ? 100 : 80 };
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const stats = await revealPlanning.loadProtocolCoinflipStats(30, fetcher);
    assert.equal(stats.wins, 195, 'the summary remains authoritative for all-time wins');
    assert.equal(stats.losses, 194, 'the summary remains authoritative for all-time losses');
    assert.equal(stats.recent.length, 26, 'one hidden-result buffer row accompanies Last 25');
    assert.equal(stats.recent[0].day, 30);
    assert.equal(stats.recent.at(-1).day, 5);
    assert.deepEqual(paths, [
      '/game/coinflip/stats',
      ...Array.from({ length: 10 }, (_, index) => `/game/coinflip/day/${14 - index}`),
    ]);
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
      recent: Array.from({ length: 26 }, (_, index) => ({
        day: 80 - index,
        win: index % 2 === 0,
      })),
    };
    const hidden = revealPlanning.protocolCoinflipStatsForReveal(buffered, {
      day: 80,
      result: { win: true },
      revealComplete: false,
    });
    assert.equal(hidden.recent.length, 25,
      'hiding today backfills the prior result so Last 25 remains full');
    assert.equal(hidden.recent.some((row) => row.day === 80), false);
    assert.equal(hidden.recent.at(-1).day, 55,
      'the twenty-sixth fetched result becomes the twenty-fifth visible result');
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
    assert.deepEqual(revealPlanning.protocolCoinflipStatsForReveal({
      wins: 27,
      losses: 19,
      recent: [{ day: 66, win: false }],
    }, {
      day: 67,
      result: { win: true, rewardPercent: 150 },
      revealComplete: true,
    }), {
      wins: 28,
      losses: 19,
      recent: [
        { day: 67, win: true, rewardPercent: 150 },
        { day: 66, win: false },
      ],
    }, 'the exact payout survives insertion so the new Last 25 marker can use its roll color');
  });

  test('the multiplier number uses yellow at 150 and blue from 250 upward', () => {
    assert.equal(revealPlanning.dailyFlipMultiplierTone(149), 'low');
    assert.equal(revealPlanning.dailyFlipMultiplierTone(150), 'low');
    assert.equal(revealPlanning.dailyFlipMultiplierTone(151), null);
    assert.equal(revealPlanning.dailyFlipMultiplierTone(249), null);
    assert.equal(revealPlanning.dailyFlipMultiplierTone(250), 'high');
    assert.equal(revealPlanning.dailyFlipMultiplierTone(300), 'high');
    assert.equal(revealPlanning.dailyFlipMeterPosition(150), 0);
    assert.equal(revealPlanning.dailyFlipMeterPosition(196), 46);
    assert.equal(revealPlanning.dailyFlipMeterPosition(250), 100);
    assert.equal(revealPlanning.dailyFlipMeterPosition(256), 100,
      'the printed table selector caps at 250 even when the exact popup includes a bonus');
    assert.equal(revealPlanning.dailyFlipMeterStopHeight(196), 'calc(48% - 0.52px)',
      'the frozen 196% result rounds to twelve complete pips on the shared 25-step scale');
    assert.equal(revealPlanning.dailyFlipMeterStopHeight(250), '100%');
    assert.match(APP_CSS,
      /\.df-position-percentage--low\s*\{[^}]*color:\s*#fde047[^}]*rgba\(250, 204, 21,/s,
      'the 150% multiplier is yellow rather than red');
    assert.match(APP_CSS,
      /\.df-position-percentage--high\s*\{[^}]*color:\s*#60a5fa[^}]*rgba\(59, 130, 246,/s,
      '250% and larger multipliers remain blue');
  });

  test('large sDGNRS stays within two significant figures and promotes suffix carries', () => {
    const unit = 10n ** 18n;
    assert.equal(revealPlanning.formatSdgnrsBalance(999n * unit), '999');
    assert.equal(revealPlanning.formatSdgnrsBalance(0n), '0');
    assert.equal(revealPlanning.formatSdgnrsBalance(9_999n * unit), '10K');
    assert.equal(revealPlanning.formatSdgnrsBalance(10_000n * unit), '10K');
    assert.equal(revealPlanning.formatSdgnrsBalance(12_345n * unit), '12K');
    assert.equal(revealPlanning.formatSdgnrsBalance(999_999n * unit), '1M');
    assert.equal(revealPlanning.formatSdgnrsBalance(9_876_543n * unit), '9.9M');
    assert.equal(revealPlanning.formatSdgnrsBalance(9_999_999n * unit), '10M');
    assert.equal(revealPlanning.formatSdgnrsBalance(10_000_000n * unit), '10M');
    assert.equal(revealPlanning.formatSdgnrsBalance(10_450_000n * unit), '10M');
    assert.equal(revealPlanning.formatSdgnrsBalance(99_900_000n * unit), '100M');
    assert.equal(revealPlanning.formatSdgnrsBalance(100_000_000n * unit), '100M');
    assert.equal(revealPlanning.formatSdgnrsBalance(123_450_000n * unit), '120M');
    assert.equal(revealPlanning.formatSdgnrsBalance(9_876_000_000_000_000n * unit), '9.9Q');
  });

  test("Tomorrow's Bet keeps at most four significant whole-FLIP digits", () => {
    const unit = 10n ** 18n;
    assert.equal(revealPlanning.formatTomorrowBet(43_844n * unit), '43,840');
    assert.equal(revealPlanning.formatTomorrowBet(123_456n * unit), '123,500');
    assert.equal(revealPlanning.formatTomorrowBet(12_345_678n * unit), '12,350,000');
  });

  test('the corner BAF score stays exact below a million and compacts larger values', () => {
    const unit = 10n ** 18n;
    assert.equal(revealPlanning.formatBafScore(999_999n * unit), '999,999');
    assert.equal(revealPlanning.formatBafScore(1_000_000n * unit), '1M');
    assert.equal(revealPlanning.formatBafScore(1_250_000n * unit), '1.25M');
    assert.equal(revealPlanning.formatBafScore(12_340_000n * unit), '12.3M');
    assert.equal(revealPlanning.formatBafScore(999_900_000n * unit), '1B');
    assert.equal(revealPlanning.formatBafScore(123_400_000_000n * unit), '123B');
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

  test('an open coinflip dialog escapes the isolated felt without elevating ordinary table UI', () => {
    assert.match(
      CHIPSET_CSS,
      /body\.layout-basic \.jackpot-hero \.app-daily-flip\s*\{[^}]*isolation:\s*isolate/s,
      'the felt retains its local stacking context for the table rail and watermark',
    );
    assert.match(
      CHIPSET_CSS,
      /body\.layout-basic \.jackpot-hero \.app-daily-flip:has\(> \.df-reverse-dialog:not\(\[hidden\]\)\)\s*\{[^}]*isolation:\s*auto/s,
      'a visible dialog temporarily opens the felt backdrop root so the page behind it can dim',
    );
    assert.match(
      CHIPSET_CSS,
      /body\.layout-basic \.jackpot-hero \.app-daily-flip > \.df-reverse-dialog:not\(\[hidden\]\)\s*\{[^}]*z-index:\s*12030/s,
      'the visible dialog alone joins the shared modal layer',
    );
    assert.doesNotMatch(
      CHIPSET_CSS,
      /\.app-daily-flip:has\([^}]+\)\s*\{[^}]*z-index:\s*12030/s,
      'ordinary coinflip table content never rises with its modal backdrop',
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

  test('unrevealed → clickable single-surface coin with a top-center felt cue and no extra button', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    await flushMicrotasks();

    const titleLogo = el.querySelector('.df-title-bar');
    assert.ok(titleLogo, 'the flip column opens with its own on-felt logo lockup');
    assert.match(el.innerHTML,
      /<section class="panel app-daily-flip">[\s\S]*?data-bind="df-coinflip-record"[\s\S]*?<header class="df-title-bar">[\s\S]*?<h2 class="df-section-title">[\s\S]*?<small>COMMUNITY<\/small>[\s\S]*?<strong>COINFLIP<\/strong>[\s\S]*?<\/header>\s*<div class="df-coin-stage">\s*<svg class="df-once-daily"[^>]*viewBox="0 0 200 200"[^>]*>[\s\S]*?<textPath[^>]*data-bind="df-daily-jackpot-label"[^>]*>DAILY AT —<\/textPath>[\s\S]*?<\/svg>\s*<div class="df-coin-zone"/,
      'the record owns the felt corner independently of the centered logo and coin stage',
    );
    const dailySchedule = el.querySelector('[data-bind="df-daily-jackpot-label"]');
    assert.match(dailySchedule.textContent, /^DAILY AT \d.+/,
      'the felt prints the next daily jackpot in the browser’s local timezone');
    assert.match(el.innerHTML, /id="df-once-daily-arc" d="M 30 168 Q 100 230 170 168"/,
      'the schedule baseline sits low in the annulus without crossing either ring');
    assert.match(titleLogo.parentElement?.querySelector?.('.df-once-daily')?.getAttribute('aria-label') || '',
      /^DAILY AT .+ in your local time zone$/,
      'the localized schedule is also announced accessibly');
    assert.match(APP_CSS,
      /\.df-once-daily\s*\{[^}]*top:\s*50%[^}]*left:\s*50%[^}]*clamp\(110px, 14vw, 150px\)[^}]*aspect-ratio:\s*1[^}]*translate\(-50%, -50%\)[^}]*\}[\s\S]*?\.df-once-daily text\s*\{[^}]*rgba\(240,217,166,\.68\)[^}]*font:\s*950 \.66rem/s,
      'the localized schedule follows the annulus between the two quiet table rings');
    assert.match(
      APP_CSS,
      /\.df-title-bar\s*\{[^}]*display:\s*flex[^}]*height:\s*2\.42rem[^}]*flex:\s*0 0 2\.42rem[^}]*align-items:\s*center[^}]*justify-content:\s*center/s,
      'the standalone logo keeps a compact fixed-height, no-jump composition',
    );
    assert.match(APP_CSS,
      /\.df-title-bar\s*\{[^}]*padding:\s*0\.2rem 0\.5rem 0\.12rem;/s,
      'symmetric title padding keeps the printed logo centered on the full felt');
    assert.match(
      APP_CSS,
      /\.df-title-bar::before,[\s\S]*?\.df-title-bar::after\s*\{[^}]*content:\s*none/s,
      'the logo prints directly on the felt without a title bar or frame',
    );
    assert.doesNotMatch(APP_CSS, /\.df-title-bar::(?:before|after)[^{]*\{[^}]*clip-path/s,
      'the title bar avoids a pointed plaque silhouette');
    assert.match(
      APP_CSS,
      /\.df-section-title strong\s*\{[^}]*color:\s*#f7e6bd[^}]*font-size:\s*1\.08rem[^}]*font-weight:\s*900[^}]*letter-spacing:\s*0\.16em[^}]*-webkit-text-stroke:\s*0/s,
      'COINFLIP is a slightly larger, flat table-ink wordmark',
    );
    assert.doesNotMatch(el.innerHTML, /df-title-bar__signal/,
      'the printed logo has no flanking arrows or endpoint diamonds');
    assert.match(APP_CSS,
      /\.df-section-title\s*\{[^}]*filter:\s*none;[^}]*opacity:\s*0\.82;[^}]*text-shadow:\s*none/s,
      'the on-felt mark has no bevel, glow, or cast shadow');
    assert.match(APP_CSS,
      /\.app-daily-flip\s*\{[^}]*padding-top:\s*0/s,
      'the coinflip panel padding cannot push its heading below Daily Jackpot');
    assert.match(APP_CSS,
      /body\.layout-basic \.jackpot-hero \.app-daily-flip\s*\{[^}]*community-coinflip-felt-v6\.webp[^}]*100% 100% no-repeat/s,
      'the whole coinflip widget owns the full-bleed felt without an inner layout wrapper');
    assert.match(el.innerHTML,
      /class="df-table-watermark" aria-hidden="true">[\s\S]*?<strong>DEGENERUS<\/strong>[\s\S]*?df-table-watermark__flame[\s\S]*?<strong>PROTOCOL<\/strong>/,
      'the open center lane carries the horizontal Degenerus-flame-Protocol table mark');
    assert.match(CHIPSET_CSS,
      /\.df-table-watermark\s*\{[^}]*top:\s*72%;[^}]*height:\s*2\.6rem[^}]*color:\s*rgba\(49, 2, 7, 0\.46\)[^}]*pointer-events:\s*none/s,
      'the compact one-ink watermark stays inside its own clear felt lane');
    assert.match(CHIPSET_CSS,
      /\.df-table-watermark__flame\s*\{[^}]*background:\s*currentColor[^}]*mask:\s*url\('\/whitepaper\/flame-center\.svg'\)/s,
      'the table mark uses the native Degenerus flame instead of another coin badge');
    assert.match(CHIPSET_CSS,
      /\.app-daily-flip::before\s*\{[^}]*content:\s*none/s,
      'the oversized circular watermark cannot remain behind the betting fixtures');
    assert.match(APP_CSS,
      /body\.layout-basic \.jackpot-hero \.app-daily-flip\s*\{[^}]*12deg[^}]*bottom \/ 100% 49% no-repeat[^}]*102deg[^}]*bottom \/ 100% 49% no-repeat/s,
      'two restrained fiber directions add felt grain only below the black divider');
    assert.match(APP_CSS, /\.df-coin-stage\s*\{[^}]*position:\s*relative/s,
      'coin overlays remain anchored to the coin after inserting the heading');
    assert.match(APP_CSS,
      /\.df-coin-stage::after\s*\{[^}]*top:\s*50%[^}]*left:\s*50%[^}]*border-radius:\s*50%[^}]*transform:\s*translate\(-50%, -50%\)/s,
      'decorative felt rings stay centered on the responsive coin stage');
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
      /df-reveal-cue__copy">CLICK TO FLIP<\/strong>/,
      'the compact cue keeps the complete printed instruction',
    );
    assert.match(el.innerHTML, /df-reveal-cue__arrow" aria-hidden="true">↓<\/span>/,
      'a real text glyph points toward the coin without a fragile painted triangle');
    assert.match(
      APP_CSS,
      /\.df-reveal-cue\s*\{[^}]*top:\s*0\.08rem;[^}]*right:\s*0;[^}]*left:\s*0;[^}]*display:\s*grid[^}]*width:\s*max-content[^}]*margin-inline:\s*auto[^}]*transform:\s*none/s,
      'the printed instruction uses the clear top-center lane instead of sitting behind Last 25',
    );
    assert.match(APP_CSS,
      /\.df-reveal-cue__copy\s*\{[^}]*display:\s*block[^}]*border:\s*0[^}]*border-radius:\s*0[^}]*background:\s*none[^}]*box-shadow:\s*none/s,
      'the instruction is table ink without a floating card, frame, or panel fill');
    assert.doesNotMatch(APP_CSS, /df-reveal-cue-(?:pulse|arrow)::after|df-reveal-cue__copy::after/,
      'the transient cue has no animated or pseudo-element compositor layers');
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
    assert.match(APP_CSS, /\.app-daily-flip--baf-eve \.df-tomorrow-bet-oval\s*\{[^}]*border-color:/s);
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
      _fetchCounts.get('https://degenerus-db.fly.dev/player/0xab12000000000000000000000000000000000000'),
      1,
      'immediate-fire store subscriptions share one dashboard request',
    );
    assert.equal(
      _fetchCounts.get('https://degenerus-db.fly.dev/game/coinflip/day/67'),
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
      'the corner BAF instrument immediately adopts the shared live rank');
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
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '987,654',
      'the already-known wallet balance remains visible while RNG-sensitive backing is held');
    assert.equal(el.querySelector('[data-bind="df-funds-flip-unit"]').textContent, 'FLIP',
      'the currency unit remains readable beside the settled value');
    const safeRack = el.querySelector('[data-bind="df-bankroll-rack"]');
    assertBankrollChipCounts(safeRack, { claimable: 0, liquid: 20, total: 20 },
      'held backing stays hidden while the live wallet still paints the tray');
    assert.equal(safeRack.textContent, '', 'the held tray exposes no exact visible copy');
    assert.match(safeRack.getAttribute('aria-label'),
      /Claimable 0 FLIP\. Liquid 987,654 FLIP\. Combined 987,654 FLIP/,
      'the disclosure-safe held values remain exact for assistive technology');
    assert.equal(el.querySelector('[data-position="today"]').textContent, "Today's bet—",
      'the still-pending resolved-day value keeps its loading placeholder');
    assert.equal(el.querySelector('[data-bind="df-bet-oval"]').getAttribute('aria-label'),
      "Today's bet is loading");
    assert.equal(el.querySelector('[data-bind="df-win-strip"]'), null,
      'there is no separate winnings strip competing with Today’s Bet');
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
    assert.match(el.querySelector('[data-position="today"]').textContent, /43,840 FLIP/,
      "today's committed stake uses the four-significant-digit display before reveal");
    const wagerStacks = Array.from(
      el.querySelector('[data-bind="df-bet-chip-rack"]').children,
    );
    assert.deepEqual(
      wagerStacks.map((stack) => stack.getAttribute('data-chip-count')),
      ['6', '5', '5'],
      'a common 43K wager remains three substantial dealer stacks',
    );
    assert.ok(wagerStacks.every((stack) => stack.className.includes('df-bet-chip-stack')));
    assert.match(el.querySelector('[data-bind="df-bet-oval"]').getAttribute('aria-label'),
      /Today’s bet|Today's bet: 43,844 FLIP/);
    assert.match(APP_CSS,
      /\.df-bet-table\s*\{[^}]*top:\s*calc\(50% \+ \.38rem\)[^}]*display:\s*grid[^}]*gap:\s*0\.04rem/s,
      'the printed label starts fully inside the red felt below the table divider');
    assert.match(APP_CSS,
      /\.df-bet-oval\s*\{[^}]*height:\s*4\.35rem[^}]*grid-template-rows:\s*repeat\(2, minmax\(0, 1fr\)\) \.78rem[^}]*gap:\s*\.04rem/s,
      'Today’s Bet reserves independent winnings, wager, and integrated amount rows');
    assert.match(CHIPSET_CSS,
      /:is\(\.df-bet-oval, \.df-tomorrow-bet-oval\)\s*\{[^}]*--df-spot-line:\s*#7fa3f0[^}]*--df-spot-felt-hi:\s*#2a3d75[^}]*--df-spot-felt:\s*#1d2c59[^}]*--df-spot-felt-lo:\s*#131f42/s,
      'Today and Tomorrow share the same recessed blue table paint');
    assert.match(APP_CSS,
      /\.df-today-winnings-row\s*\{[^}]*display:\s*grid[^}]*height:\s*100%[^}]*border-bottom:\s*1px solid rgba\(240,217,166,\.17\)/s,
      'a quiet divider separates the upper winnings rack from the wager below');
    assert.match(APP_CSS,
      /\.df-bet-today-slot \.df-position-row\s*\{[^}]*height:\s*100%[^}]*grid-template-areas:\s*"result"[^}]*padding:\s*0 \.3rem[^}]*border-radius:\s*0/s,
      'the Today readout is a compact bottom rail inside the bet strip');
    assert.match(CHIPSET_CSS,
      /\.df-bet-today-slot \.df-position-row\s*\{[^}]*border:\s*0[^}]*background:\s*none[^}]*box-shadow:\s*none[^}]*transform:\s*translateY\(-0\.14rem\)/s,
      'the exact amount prints as bare table ink, lifted just off the oval boundary');
    assert.match(el.innerHTML,
      /class="df-bet-table"[^]*class="df-bet-table__today-label"[^]*data-bind="df-today-felt-label">TODAY'S BET<[^]*class="df-bet-oval"[^]*data-bind="df-position-today"/,
      'Today’s Bet is printed on the felt above both its badge strip and signed amount display');
    assert.match(
      el.innerHTML,
      /class="df-bet-oval"(?:(?!<\/div>)[\s\S])*data-bind="df-position-today"/,
      'the exact FLIP amount is physically nested along the bottom of Today’s Bet',
    );
    assert.doesNotMatch(el.innerHTML,
      /df-today-winnings-row[^]*?<small[^>]*>WINNINGS<\/small>/,
      'the empty upper chip lane does not need its own label');
    assert.match(APP_CSS,
      /\.df-bet-today-slot \.df-position-label\s*\{\s*display:\s*none;/s,
      'the generated ledger label is removed from the compact numeric display');
    assert.equal(el.querySelector('.df-bet-chip-count'), null,
      'color and physical stack height communicate denomination without chip numbers');
    assert.match(APP_CSS,
      /\.df-bet-chip\.is-top::after\s*\{[^}]*width:\s*var\(--df-chip-mark-width\)[^}]*height:\s*var\(--df-chip-mark-height\)[^}]*border-radius:\s*50%[^}]*background:\s*url\('\/whitepaper\/flame-center\.svg'\) center \/ 42% 78% no-repeat, #fff8e8/s,
      'the top badge uses the complete Degenerus flame art at a readable size');
    const betChipRule = APP_CSS.match(/\.df-bet-chip\s*\{[^}]*\}/s)?.[0] || '';
    assert.match(betChipRule,
      /width:\s*min\(var\(--df-chip-width\), calc\(100% \+ \.18rem\)\)[^}]*height:\s*var\(--df-chip-height\)[^}]*border-radius:\s*50%[^}]*radial-gradient\(ellipse, #fff8e8 0 48%, #111 50% 64%, var\(--df-chip-tone\) 66% 94%/s,
      'each larger pitched token keeps the Degenerus cream, black, and denomination-color rings');
    assert.doesNotMatch(betChipRule, /repeating-conic-gradient/,
      'the Degenerus tokens have no generic casino-chip edge markings');
    assert.match(APP_CSS,
      /@media \(min-width: 521px\)\s*\{[^]*?\.df-bet-oval\s*\{\s*height:\s*4\.75rem;[^]*?\.df-tomorrow-layout\s*\{[^}]*grid-template-rows:\s*auto 2\.35rem 1\.2rem[^]*?\.df-bet-chip-rack\s*\{[^}]*--df-chip-width:\s*1\.86rem[^}]*--df-chip-mark-height:\s*\.68rem/s,
      'wider layouts spend their extra vertical gap on larger tables and readable badge art');
    assert.doesNotMatch(APP_CSS, /\.df-bet-chip\.is-payout/,
      'winnings use the same denomination styling instead of a green payout override');
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
    let meter = el.querySelector('[data-bind="df-bankroll-rack"]');
    assertBankrollChipCounts(meter, { claimable: 3, liquid: 17, total: 11 },
      'initial confirmed ledger snapshot');
    assert.match(meter.getAttribute('aria-label'),
      /Claimable 200 FLIP\. Liquid 1,000 FLIP\. Combined 1,200 FLIP/);
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
    meter = el.querySelector('[data-bind="df-bankroll-rack"]');
    assertBankrollChipCounts(meter, { claimable: 1, liquid: 19, total: 10 },
      'confirmed transaction repaints both physical rows');
    assert.match(meter.getAttribute('aria-label'),
      /Claimable 50 FLIP\. Liquid 700 FLIP\. Combined 750 FLIP/);
    assert.equal(el.querySelector('[data-bind="df-claim-flip-cta"]').disabled, false,
      'the same claim opener survives the confirmed-transaction repaint');

    const lowerAmountChips = bankrollChipCounts(meter).total;
    wallet = 2_048n * unit;
    claimable = 0n;
    document.dispatchEvent({ type: contractsMod.TX_CONFIRMED_EVENT });
    await flushMicrotasks();
    meter = el.querySelector('[data-bind="df-bankroll-rack"]');
    assertBankrollChipCounts(meter, { claimable: 0, liquid: 20, total: 12 },
      'a mounted richer balance climbs the doubling ladder');
    assert.ok(bankrollChipCounts(meter).total > lowerAmountChips,
      'the mounted bottom row visibly gains chips as the wallet gets richer');
    el.disconnectedCallback();
  });

  test('Available Funds excludes auto-rebuy carry even while RNG is locked', async () => {
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
      '1,200',
      'wallet plus ordinary claimable is shown without the committed 475 FLIP carry',
    );
    const meter = el.querySelector('[data-bind="df-bankroll-rack"]');
    assertBankrollChipCounts(meter, { claimable: 3, liquid: 17, total: 11 },
      'only ordinary claimable stays on the red available side');
    assert.match(meter.getAttribute('aria-label'),
      /Claimable 200 FLIP\. Liquid 1,000 FLIP\. Combined 1,200 FLIP/);
    assert.equal(
      el.querySelector('[data-bind="df-claim-flip-cta"]').disabled,
      false,
      'the ordinary CLAIM action remains based on its separate 200 FLIP preview',
    );
    el.disconnectedCallback();
  });

  test("an unresolved ticket pack never masks Tomorrow's bet", async () => {
    _currentStakeWei = '12000000000000000000000';
    seedTomorrowHold('11000000000000000000000');
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
      '11,000 FLIP',
      'the durable latch keeps the last settled stake until reward-box controllers finish loading',
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
    seedTomorrowHold('11000000000000000000000');
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
    assert.match(tomorrow().textContent, /11,000 FLIP/);

    document.dispatchEvent({
      type: 'degenerus:lootbox-reveal-queued',
      detail: { presentationId: 'lootbox-reveal:9', address: TEST_ADDR },
    });
    pendingActionsMod.publishPendingActions('lootboxes', []);
    assert.match(tomorrow().textContent, /11,000 FLIP/,
      'removing the tray row keeps the settled stake while its animation is still queued');

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

  test('the CASH OUT rack opens ETH and FLIP together independently of disclosure', async () => {
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    const value = el.querySelector('[data-bind="df-funds-flip-total"]');
    const claim = el.querySelector('[data-bind="df-claim-flip-cta"]');
    assert.equal(value.textContent, '987,654',
      'the safe wallet portion remains readable instead of becoming a blur');
    assert.equal(value.getAttribute('role'), null,
      'the held amount is a readout, not a manual spoiler override');
    assert.deepEqual(storeMod.get('ui.protocolCoinsFlipDisclosure'), {
      address: TEST_ADDR.toLowerCase(),
      valueWei: '987654000000000000000000',
      held: true,
    });
    value.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.equal(value.textContent, '987,654', 'clicking the number does not bypass the RNG hold');
    assert.deepEqual(storeMod.get('ui.protocolCoinsFlipDisclosure'), {
      address: TEST_ADDR.toLowerCase(),
      valueWei: '987654000000000000000000',
      held: true,
    }, 'the owning Protocol Coins cell publishes its exact painted snapshot');
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
    assert.deepEqual(openedModes, ['cashout'],
      'the table CASH OUT control opens the combined withdrawal popup');

    await import('../app-player-funds-dialog.js');
    const FundsDialog = customElements.get('app-player-funds-dialog');
    const fundsDialog = new FundsDialog();
    _docBody.appendChild(fundsDialog);
    fundsDialog.connectedCallback();
    fundsDialog.open(openedModes[0]);
    assert.equal(fundsDialog.querySelector('[data-bind="pfd-eth-section"]').hidden, false,
      'cash out exposes the existing ETH claim controls');
    assert.equal(fundsDialog.querySelector('[data-bind="pfd-flip-section"]').hidden, false,
      'cash out keeps the existing FLIP claim controls in the same popup');
    assert.equal(fundsDialog.querySelector('[data-bind="pfd-link-section"]').hidden, true,
      'LINK funding remains outside the cash-out surface');
    assert.equal(fundsDialog.querySelector('[data-bind="pfd-title"]').textContent, 'Cash out');
    fundsDialog.disconnectedCallback();
    el.disconnectedCallback();
  });

  test("Tomorrow's bet holds its settled value until the bonus jackpot is cleared", async () => {
    _currentStakeWei = '12000000000000000000000';
    seedTomorrowHold('10000000000000000000000');
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
    assert.match(tomorrow().textContent, /10,000 FLIP/);
    assert.doesNotMatch(tomorrow().textContent, /12,000/,
      'the RNG-sensitive replacement is absent from the rendered Tomorrow row');

    localStorage.setItem('jackpot_complete_day_84532_67', '1');
    document.dispatchEvent({ type: 'jackpot:revealed', detail: { day: 67 } });
    assert.match(tomorrow().textContent, /12,000 FLIP/);
    el.disconnectedCallback();
  });

  test("auto rebuy keeps Tomorrow's last settled stake until its coin is revealed", async () => {
    const unit = 10n ** 18n;
    // readCurrentCoinflipStake is carry-inclusive: 12,000 stored plus the
    // 475 FLIP that auto rebuy rolled forward from this unresolved result.
    _currentStakeWei = String(12_475n * unit);
    seedTomorrowHold(12_000n * unit);
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
    assert.match(tomorrow().textContent, /12,000 FLIP/);
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

  test("an explicitly pending bonus still holds Tomorrow's settled bet", async () => {
    _currentStakeWei = '12000000000000000000000';
    seedTomorrowHold('10000000000000000000000');
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
    assert.match(tomorrow().textContent, /10,000 FLIP/);

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

    const revealHint = el.querySelector('[data-bind="df-reveal-hint"]');
    revealHint.dispatchEvent({ type: 'click' });
    assert.equal(revealHint.hidden, true,
      'the felt instruction disappears synchronously in the click task');
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
    seedFlipAvailableHold('4526397000000000000000000');
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
    assert.match(el.querySelector('[data-position="today"]').textContent, /43,840 FLIP/);
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
      assert.match(el.querySelector('[data-position="today"]').textContent, /Today's bet43,840 FLIP/,
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
      assert.equal(meter.querySelector('.df-modifier-meter__readout'), null,
        'the moving table selector does not duplicate the exact popup number');
      assert.ok(meter.querySelector('[data-bind="df-modifier-marker"]'));
      assert.equal(
        meter.querySelector('.df-modifier-meter__pip-bank--idle')
          .querySelectorAll('.df-coinflip-record__mark').length,
        25,
        'the thermometer reuses the same twenty-five physical pip elements as Last 25',
      );
      assert.equal(
        meter.querySelector('.df-modifier-meter__pip-bank--fill')
          .querySelectorAll('.df-coinflip-record__mark')
          .filter((pip) => /\bis-win\b/.test(pip.className)).length,
        25,
        'the animated fill is a bank of the shared win pips rather than a painted bar',
      );
      assert.equal(
        meter.querySelector('.df-modifier-meter__pip-bank--peak')
          .querySelectorAll('.df-coinflip-record__mark')
          .filter((pip) => /\bis-roll-250\b/.test(pip.className)).length,
        25,
        'the full-rail blue beat uses the shared 250-roll pip state',
      );
      assert.match(el.innerHTML,
        /df-modifier-meter__table-scale[\s\S]*?<span>250%<\/span><span>200%<\/span><span>150%<\/span>/);
      assert.equal(el.querySelector('[data-position="today"] .df-position-outcome'), null,
        "Today's bet does not turn into WIN while the thermometer is settling");
      assert.doesNotMatch(el.querySelector('[data-position="today"]').className, /df-position-row--win/,
        "Today's bet stays neutral until the win sound can play");
      assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '5,514,051',
        'Protocol Coins holds the prior settled total until the result is final');
      assert.equal(el.querySelector('[data-bind="df-coinflip-wins"]').textContent, '27',
        'the global record cannot telegraph the win before the percentage locks');
      assert.equal(
        el.querySelector('[data-bind="df-coinflip-recent"]').classList.contains('is-shifting'),
        false,
        'LAST 25 stays still while the apparent win is not authoritative',
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
        'LAST 25 visibly shifts only once the percentage has locked',
      );
      assert.match(el.querySelector('[data-position="today"]').className, /df-position-row--win/,
        "Today's bet turns green on that same completion event");
      assert.match(el.querySelector('[data-position="today"]').textContent, /WIN/);
      assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '5,599,985',
        'the exact bankroll opens on the same completion event as the final result');
      const bankroll = el.querySelector('[data-bind="df-bankroll-rack"]');
      assertBankrollChipCounts(bankroll, { claimable: 16, liquid: 4, total: 23 },
        'reveal completion releases claim-side and combined physical chips together');
      assert.equal(bankroll.textContent, '', 'reveal does not print exact values in the tray');
      assert.match(bankroll.querySelector('.df-bankroll__row--ratio').getAttribute('aria-label'),
        /Claimable 4,612,331 FLIP\. Liquid 987,654 FLIP\./);
      assert.match(bankroll.querySelector('.df-bankroll__row--total').getAttribute('aria-label'),
        /Combined balance 5,599,985 FLIP\./);
      assert.equal(el.querySelector('[data-bind="df-claim-flip-cta"]').disabled, false,
        'claim unlocks only after the result sequence completes');
      assert.equal(
        el.querySelector('[data-bind="df-claim-flip-cta"]').getAttribute('data-write-locked'),
        null,
        'the domain lock retires only when the claim is actually ready',
      );
      const parkedMeter = el.querySelector('.df-modifier-meter--settled');
      assert.ok(parkedMeter, 'the final lit pattern remains parked after the win commits');
      assert.equal(el.querySelector('.df-modifier-meter--settling'), null,
        'the parked day result no longer carries a moving state');
      assert.equal(
        parkedMeter.querySelector('[data-bind="df-modifier-marker"]').style.height,
        'calc(48% - 0.52px)',
        'the persistent lights park precisely between two shared pips',
      );
      assert.match(parkedMeter.getAttribute('aria-label'), /196 percent/);
      assert.equal(el.querySelector('.df-modifier-flash').textContent, '196%',
        'the exact percentage still pops beside the already parked lights');
      settle.fn();
      assert.equal(RecordingAudioContext.last.oscillators.length, launchOscillators + 4,
        'the timer fallback cannot replay the chord after animationend wins the race');
      const flashDone = scheduled.find((entry) => entry.delay === 850);
      assert.ok(flashDone, 'the exact percentage keeps its brief original window');
      flashDone.fn();
      assert.equal(el.querySelector('.df-modifier-flash'), null,
        'the exact popout retires after its animation');
      assert.equal(
        el.querySelector('[data-bind="df-modifier-marker"]').style.height,
        'calc(48% - 0.52px)',
        'clearing the popout leaves the parked pip-snapped rail lit for the day',
      );
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
    assert.equal(
      el.querySelector('.df-modifier-meter__pip-bank--idle')
        .querySelectorAll('.df-coinflip-record__mark').length,
      25,
      'the unused thermometer already shows the same twenty-five unlit pips as Last 25',
    );

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
      assert.match(STATUS_CSS, /@keyframes df-meter-drain-to-min[\s\S]*?height:\s*0%/);

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
        /@keyframes df-meter-rebound-from-min[\s\S]*?0%, 6\.086957%[^}]*height:\s*0%[\s\S]*?39\.130435%[^}]*height:\s*100%[\s\S]*?65\.217391%[^}]*height:\s*8%[\s\S]*?100%[^}]*var\(--df-meter-stop/,
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
      assert.notEqual(openingMarker.style.height, '0%',
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
        /@keyframes df-meter-terminal-drain[\s\S]*?from[^}]*var\(--df-meter-stop[\s\S]*?to[^}]*height:\s*0%/,
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
    assert.equal(today.querySelector('.df-position-value').textContent, '+85,930',
      "the resolved receipt keeps the signed four-significant-digit payout, unitless");
    assert.ok(today.className.includes('df-position-row--win'));
    const betOval = el.querySelector('[data-bind="df-bet-oval"]');
    assert.equal(el.querySelector('[data-bind="df-win-strip"]'), null,
      'the win does not create a second winnings display');
    assert.equal(betOval.classList.contains('has-payout'), false);
    assert.match(betOval.getAttribute('aria-label'), /Today's bet: 43,844 FLIP/,
      'the original sub-100K dealer stacks keep their exact accessible stake');
    const wagerStacks = Array.from(
      el.querySelector('[data-bind="df-bet-chip-rack"]').children,
    );
    assert.deepEqual(
      wagerStacks.map((stack) => stack.getAttribute('data-chip-count')),
      ['6', '5', '5'],
      'the won stake remains in its original three-stack composition',
    );
    const winningsRow = el.querySelector('[data-bind="df-today-winnings-row"]');
    assert.equal(winningsRow.dataset.state, 'win');
    assert.equal(winningsRow.getAttribute('aria-hidden'), 'false',
      'sub-100K wins push their added chips into the upper dealer rack');
    const winningsStacks = Array.from(
      el.querySelector('[data-bind="df-today-winnings-rack"]').children,
    );
    assert.deepEqual(
      winningsStacks.map((stack) => stack.getAttribute('data-chip-count')),
      ['5', '5', '5'],
      'the 96% payout adds three balanced stacks above the stake',
    );
    assert.equal(el.querySelectorAll('.is-payout').length, 0,
      'upper and lower racks use the exact same badge chip classes and colors');
    assert.ok(el.querySelector('.df-modifier-meter--settled'),
      'reduced-motion wins immediately retain the final lit rail for the day');
    assert.equal(el.querySelector('.df-modifier-flash'), null,
      'reduced motion also avoids an exact-number popout');
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
    assert.equal(today.querySelector('.df-position-value').textContent, '-43,840',
      'the signed loss amount stays on the receipt, unitless');
    assert.ok(today.className.includes('df-position-row--loss'));
    const clearedRack = el.querySelector('[data-bind="df-bet-chip-rack"]');
    assert.equal(clearedRack.children.length, 0,
      'the losing stake badges disappear when the red result commits');
    assert.equal(clearedRack.textContent, '',
      'the empty betting spot does not replace lost badges with placeholder copy');
    assert.equal(el.querySelector('[data-bind="df-today-winnings-row"]').dataset.state, 'empty',
      'a loss also leaves the upper winnings rack empty');
    assert.equal(el.querySelector('[data-bind="df-today-winnings-rack"]').children.length, 0);
    assert.match(el.querySelector('[data-bind="df-bet-oval"]').getAttribute('aria-label'),
      /lost; chips cleared/);
    assert.equal(el.querySelector('.df-modifier-meter'), null,
      'loss clears the scanner instead of settling on a modifier');
    el.disconnectedCallback();
  });

  test("the first resolved Today activation rolls the bets; the second opens Add Bet", async () => {
    _currentStakeWei = '12000000000000000000000';
    _resolvedStakeWei = '43844000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    globalThis.localStorage.setItem('flip_day_84532_67', '1');

    const el = mount();
    await flushMicrotasks();

    const todaySurface = el.querySelector('[data-bind="df-today-bet-cta"]');
    const lowerSurface = el.querySelector('[data-bind="df-flip-cta"]');
    assert.equal(todaySurface.getAttribute('role'), 'button',
      'the settled Today circle advertises the handoff interaction');
    assert.match(el.querySelector('[data-position="today"]').textContent, /LOSS-43,840/);
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);

    todaySurface.dispatchEvent({ type: 'click' });

    assert.equal(todaySurface.classList.contains('is-add-bet'), true);
    assert.equal(todaySurface.getAttribute('aria-label'), "Add FLIP to today's bet");
    assert.equal(todaySurface.getAttribute('aria-expanded'), 'false');
    assert.equal(el.querySelector('[data-bind="df-today-add-cue"]').hidden, true,
      'a real promoted chip stack hides the empty-state plus instead of showing through it');
    assert.match(CHIPSET_CSS,
      /\.df-bet-table__add-cue\s*\{[^}]*position:\s*absolute[^}]*top:\s*calc\(50% \+ 0\.32rem\)[^}]*left:\s*0\.3rem/s,
      'when Today is empty, its plus is pinned to the left-center of the oval');
    assert.match(el.querySelector('[data-position="today"]').textContent, /12,000 FLIP/,
      'the previously staged wager now owns the large Today spot');
    assert.equal(lowerSurface.classList.contains('is-yesterday'), true);
    assert.equal(lowerSurface.getAttribute('role'), 'img');
    assert.equal(el.querySelector('[data-bind="df-lower-felt-label"]').textContent, "YESTERDAY'S BET");
    assert.equal(el.querySelector('[data-bind="df-tomorrow-add-cue"]').hidden, true);
    assert.equal(
      el.querySelector('[data-bind="df-tomorrow-bet-oval"]').getAttribute('data-yesterday-outcome'),
      'loss',
    );
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /LOSS-43,840/,
      'the resolved amount and result remain in the fixed compact Yesterday fixture');
    assert.equal(lowerSurface.getAttribute('aria-label'), "Yesterday's bet lost 43,844 FLIP");
    assert.match(CHIPSET_CSS,
      /\.df-tomorrow-layout\.is-yesterday > \.df-position-slot\s*\{[^}]*width:\s*100%[^}]*grid-area:\s*oval/s,
      'Yesterday reuses one full-width receipt inside the existing lower oval');
    assert.match(CHIPSET_CSS,
      /\.df-tomorrow-layout\.is-yesterday \.df-tomorrow-bet-oval \.df-bet-chip-rack\s*\{\s*display:\s*none;/s,
      'Yesterday does not split the oval into a second stake readout and result');
    assert.match(CHIPSET_CSS,
      /\.df-tomorrow-layout\.is-yesterday \.df-position-multiplier\s*\{[^}]*display:\s*inline-flex/s,
      'the reused receipt exposes WIN or LOSS beside its signed amount');
    assert.equal(el.querySelector('[data-bind="df-add-bet-dialog"]').hidden, true,
      'the rollover activation is visual only and does not also open Add Bet');

    todaySurface.dispatchEvent({ type: 'click' });

    assert.equal(todaySurface.getAttribute('aria-expanded'), 'true');
    assert.equal(el.querySelector('[data-bind="df-add-bet-dialog"]').hidden, false,
      'a later activation uses the whole promoted Today surface as Add Bet');
    assert.equal(el.querySelector('[data-bind="df-add-bet-title"]').textContent, "ADD TO TODAY'S BET");
    assert.equal(
      el.querySelector('[data-bind="df-add-bet-number"]').getAttribute('aria-label'),
      "FLIP to add to today's bet",
    );

    el.querySelector('[data-bind="df-add-bet-close"]').dispatchEvent({ type: 'click' });
    lowerSurface.dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[data-bind="df-add-bet-dialog"]').hidden, true,
      'Yesterday is a result receipt, never a second Add Bet target');
    el.disconnectedCallback();
  });

  test("an empty promoted Today's Bet keeps its add cue", async () => {
    _currentStakeWei = '0';
    _resolvedStakeWei = '43844000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: false, rewardPercent: 96 },
    };
    globalThis.localStorage.setItem('flip_day_84532_67', '1');

    const el = mount();
    await flushMicrotasks();
    const todaySurface = el.querySelector('[data-bind="df-today-bet-cta"]');
    todaySurface.dispatchEvent({ type: 'click' });

    assert.equal(todaySurface.classList.contains('is-add-bet'), true);
    assert.equal(el.querySelector('[data-bind="df-bet-chip-rack"]').children.length, 0);
    assert.equal(el.querySelector('[data-bind="df-today-add-cue"]').hidden, false,
      'the plus stays visible when there are no wager chips to conflict with it');
    el.disconnectedCallback();
  });

  for (const won of [true, false]) {
    test(`a zero-stake ${won ? 'win' : 'loss'} says NO BET once before and after reveal`, async () => {
      _resolvedStakeWei = '0';
      _fetchResponses = {
        dashboard: dashboardPayload(),
        flipDay: { day: 67, win: won, rewardPercent: 96 },
      };

      const el = mount();
      await flushMicrotasks();

      let today = el.querySelector('[data-position="today"]');
      assert.equal(today.querySelector('.df-position-value').textContent, '',
        'the empty amount rail does not repeat the blue-field message');
      assert.equal(el.querySelector('[data-bind="df-bet-chip-rack"]').textContent, 'NO BET',
        'the blue chip field owns the one visible NO BET message');
      assert.equal(today.querySelector('.df-position-multiplier'), null,
        'zero stake never shows the global win multiplier');
      assert.ok(today.className.includes('df-position-row--no-bet'));
      assert.ok(today.querySelector('.df-position-value').className.includes('df-position-value--no-bet'));
      assert.ok(!today.className.includes('df-position-row--spoiler'));

      el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      today = el.querySelector('[data-position="today"]');
      assert.equal(today.querySelector('.df-position-value').textContent, '',
        'a global result never creates a duplicate personal receipt for a zero stake');
      assert.equal(el.querySelector('[data-bind="df-bet-chip-rack"]').textContent, 'NO BET');
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
        '',
        'the personal receipt remains empty while the blue field carries NO BET',
      );
      assert.equal(el.querySelector('[data-bind="df-bet-chip-rack"]').textContent, 'NO BET');
      const meter = el.querySelector('.df-modifier-meter--settling');
      assert.ok(meter, 'the global winning percentage still gets its thermometer');
      assert.equal(meter.querySelector('.df-modifier-meter__readout'), null);
      assert.ok(meter.querySelector('[data-bind="df-modifier-marker"]'));
      assert.equal(
        meter.querySelector('.df-modifier-meter__pip-bank--fill')
          .querySelectorAll('.df-coinflip-record__mark').length,
        25,
        'the live thermometer illuminates a second bank of the shared pip elements',
      );
    } finally {
      globalThis.setTimeout = realSetTimeout;
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
      el.disconnectedCallback();
    }
  });

  test('stacked day bets keep a spoiler-safe physical FLIP claim tray below the red felt', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    const loadingRack = el.querySelector('[data-bind="df-bankroll-rack"]');
    assert.equal(loadingRack.getAttribute('data-state'), 'loading');
    assert.equal(loadingRack.querySelectorAll('.df-bankroll__chip').length, 0);
    assert.equal(loadingRack.getAttribute('aria-label'), 'FLIP bankroll is loading');
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
    assert.match(el.querySelector('[data-position="today"]').textContent, /43,840 FLIP/,
      'today shows the committed pre-flip amount');
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /43,840 FLIP/,
      'tomorrow remains visible');
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '987,654',
      'the safe wallet FLIP remains visible while result backing is held');
    const bankroll = el.querySelector('[data-bind="df-bankroll-rack"]');
    assertBankrollChipCounts(bankroll, { claimable: 0, liquid: 20, total: null },
      'result-sensitive backing stays held while live wallet chips remain visible');
    const ratioRow = bankroll.querySelector('.df-bankroll__row--ratio');
    const totalRow = bankroll.querySelector('.df-bankroll__row--total');
    const ratioRoll = ratioRow?.querySelector('.df-bankroll__roll');
    const totalRolls = totalRow?.querySelectorAll('.df-bankroll__roll') ?? [];
    assert.ok(ratioRoll, 'the dynamic ratio chips remain inside the original standing barrel');
    assert.ok(totalRolls.length >= 1,
      'the amount row uses the original physical barrel machinery');
    assert.equal(ratioRoll.getAttribute('data-chip-count'), '20');
    assert.match(ratioRoll.getAttribute('style'), /--df-bankroll-roll-span:[0-9.]+rem/);
    assert.equal(
      totalRolls.every((roll) => Number(roll.getAttribute('data-chip-count')) <= 20),
      true,
      'the original renderer packs no more than twenty chips into one barrel',
    );
    assert.equal(
      totalRolls.reduce((sum, roll) => sum + Number(roll.getAttribute('data-chip-count')), 0),
      bankrollChipCounts(bankroll).total,
      'barrel metadata accounts for every bounded logarithmic amount chip',
    );
    assert.deepEqual(
      totalRolls.map((roll) => roll.getAttribute('data-chip-color')),
      totalRolls.map((_roll, index) => index % 2 === 0 ? 'red' : 'green'),
      'the amount barrels retain the original red/green checkerboard treatment',
    );
    assert.equal(
      totalRolls.flatMap((roll) => roll.children).every((chip) => (
        /df-bankroll__chip--(?:claimable|liquid)/.test(chip.className)
      )),
      true,
      'every bottom amount chip uses the restored red/green palette rather than a neutral tone',
    );
    assert.equal(totalRow.querySelector('.df-bankroll__chip--total'), null,
      'the retired neutral/gold total-chip marker is absent from the bottom DOM');
    assert.equal(
      [
        ...ratioRoll.children,
        ...totalRolls.flatMap((roll) => roll.children),
      ].every((chip) => (
        /--df-bankroll-chip-x:[0-9.]+rem/.test(chip.getAttribute('style') || '')
      )),
      true,
      'every chip keeps the original absolute edge-stack coordinate',
    );
    assert.equal(bankroll.textContent, '',
      'the tray visibly prints no amounts, percentages, total, or scale caption');
    assert.equal(bankroll.querySelectorAll('.df-bankroll__chip').every((chip) => (
      chip.textContent === '' && chip.getAttribute('aria-hidden') === 'true'
    )), true, 'every physical chip is empty text and individually decorative');
    for (const rejectedClass of [
      '.df-bankroll__labels',
      '.df-bankroll__ratio-track',
      '.df-bankroll__segment',
      '.df-bankroll__total-copy',
      '.df-bankroll__total-track',
      '.df-bankroll__total-fill',
      '.df-bankroll__scale',
    ]) assert.equal(bankroll.querySelector(rejectedClass), null, `${rejectedClass} is retired`);
    assert.match(bankroll.getAttribute('data-bankroll-key'), /credit:unknown:held$/);
    assert.match(bankroll.getAttribute('aria-label'),
      /Claimable 0 FLIP\. Liquid 987,654 FLIP\. Combined 987,654 FLIP/);
    assert.equal(el.querySelector('[data-bind="df-funds-flip-unit"]').textContent, 'FLIP',
      'the protocol unit stays beside the settled number');
    assert.equal(el.querySelectorAll('.df-position-delta').length, 0,
      'ordinary indexed values do not carry settlement markers');
    const displays = el.querySelectorAll('.df-funds__display');
    assert.equal(displays.length, 1, 'the table keeps only the FLIP receipt below its rack');
    assert.ok(displays[0].classList.contains('df-funds__display--flip-total'),
      'owned and claimable FLIP keep their own cell');
    const claim = el.querySelector('[data-bind="df-claim-flip-cta"]');
    assert.ok(claim, 'the recessed rack itself remains the FLIP Claim opener');
    assert.match(el.innerHTML,
      /class="df-bankroll__well"[^>]*data-write[\s\S]*?data-bind="df-claim-flip-cta"[\s\S]*?class="df-bankroll__rack"/,
      'the clickable claim surface owns the physical chip tray');
    assert.equal(el.querySelector('[data-bind="df-funds-toggle"]'), null,
      'the Other Coins disclosure is gone from the table');
    assert.equal(el.querySelector('[data-bind="df-funds-wwxrp-box"]'), null);
    assert.equal(el.querySelector('[data-bind="df-funds-sdgnrs-box"]'), null);
    assert.match(el.innerHTML, /class="df-funds__title"[^>]*>CASH OUT</,
      'the clickable corner tray is plainly labeled as the Cash Out surface');
    assert.match(el.innerHTML, /class="df-funds__box-label"[^>]*>AVAILABLE FUNDS</,
      'the FLIP balance box is titled like the ETH Available Funds fixture');
    assert.doesNotMatch(el.innerHTML, />OTHER COINS</,
      'the discarded utility drawer caption stays gone');
    assert.match(APP_CSS,
      /\.df-funds__display--flip-total \.df-funds__value\s*\{[^}]*color:\s*#fde68a[^}]*245, 158, 11/s,
      'the FLIP balance retains its yellow protocol-coin accent');
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
      /body\.layout-basic \.df-funds__coins\s*\{[^}]*border-top:\s*0/s,
      'the balance receipt sits directly beneath the rack without a drawer divider');
    assert.match(APP_CSS,
      /\.df-bet-today-slot\s*\{[^}]*width:\s*100%[^}]*height:\s*\.78rem[^}]*align-self:\s*stretch[^}]*justify-self:\s*stretch/s,
      'the Today amount spans the bottom of its blue betting area');
    assert.match(APP_CSS,
      /\.df-tomorrow-layout > \.df-position-slot\s*\{[^}]*width:\s*min\(11\.4rem, 100%\)/s,
      'Tomorrow reserves the same four-significant-digit value width');
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
      'the authoritative exact bankroll total keeps the hero’s large numeric scale',
    );
    assert.match(
      APP_CSS,
      /\.jackpot-hero :is\([\s\S]*?\.dec-flip-balance__value,[\s\S]*?\.dec-funds__value,[\s\S]*?\.df-position-value,[\s\S]*?\.df-funds__value[\s\S]*?font-size:\s*var\(--hero-box-currency-font-size\)/,
      'every currency readout in the top hero row shares one responsive font size',
    );
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds\s*\{[^}]*grid-template-areas:\s*"bankroll-rack" "coins"[^}]*grid-template-rows:\s*var\(--df-bankroll-well-height\) 1\.2rem/s,
      'the rack and its numeric receipt form one simple vertical table fixture');
    assert.match(APP_CSS,
      /\.df-bankroll__well\s*\{[^}]*border-radius:\s*\.42rem[^}]*inset 0 \.5rem \.7rem rgba\(0,0,0,\.62\)/s,
      'the chip lane is recessed into the red felt like a physical tray');
    assert.match(CHIPSET_CSS,
      /\.df-bankroll__well \.df-bankroll__rack\s*\{[^}]*display:\s*flex[^}]*height:\s*1\.62rem[^}]*flex-direction:\s*column[^}]*gap:\s*0\.12rem/s,
      'the original two-level recessed barrel rack owns the dynamic rows');
    assert.match(CHIPSET_CSS,
      /\.df-bankroll__row\s*\{[^}]*display:\s*flex[^}]*height:\s*0\.68rem[^}]*justify-content:\s*center[^}]*gap:\s*0\.2rem/s,
      'rows retain the original centered barrel geometry and spacing');
    assert.match(CHIPSET_CSS,
      /\.df-bankroll__roll\s*\{[^}]*height:\s*0\.62rem[^}]*isolation:\s*isolate/s,
      'each data run is restored to an isolated standing-chip barrel');
    assert.match(CHIPSET_CSS,
      /\.df-bankroll__roll \+ \.df-bankroll__roll::before\s*\{[^}]*width:\s*0\.05rem[^}]*height:\s*0\.72rem[^}]*#7a552b/s,
      'adjacent amount barrels retain the original walnut divider posts');
    assert.match(CHIPSET_CSS,
      /\.df-bankroll__chip\s*\{[^}]*width:\s*0\.17rem[^}]*height:\s*0\.62rem[^}]*border-radius:\s*0\.07rem[^}]*linear-gradient\(90deg/s,
      'claim-tray pieces retain the original narrow edge-pill material and highlights');
    assert.match(CHIPSET_CSS,
      /\.df-bankroll__chip--claimable\s*\{[^}]*var\(--df-flip-red\)[^}]*\}[\s\S]*?\.df-bankroll__chip--liquid\s*\{[^}]*var\(--df-flip-green\)/s,
      'the ratio assignment changes only the original edge-pill red/green tone');
    assert.match(CHIPSET_CSS,
      /\.df-bankroll__rack\.is-crediting\s+\.df-bankroll__roll\[data-bankroll-source="credit"\]\s*\{[^}]*df-bankroll-credit-settle/s,
      'newly released claimable barrels retain the prior settle motion');
    assert.doesNotMatch(CHIPSET_CSS,
      /\.df-bankroll__row--(?:ratio|total)\s*\{[^}]*grid-template-columns/s,
      'dynamic count never replaces the original barrel with a flat equal-cell grid');
    assert.doesNotMatch(CHIPSET_CSS,
      /--df-bankroll-(?:share|fill)-bps|df-bankroll__(?:labels|ratio-track|segment|total-copy|total-track|total-fill|scale)/,
      'no continuous balance-derived widths or visible meter-copy selectors remain');
    assert.doesNotMatch(CHIPSET_CSS,
      /\.df-bankroll__chip--total\s*\{[^}]*--df-bankroll-chip-(?:hi|tone|lo)/s,
      'the semantic total marker never introduces a yellow or gold material treatment');
    assert.match(APP_INDEX, /href="\/app\/styles\/app\.css"[\s\S]*?href="\/app\/styles\/coinflip-chipset\.css"/,
      'the reviewed chipset loads after the base coinflip geometry');
    assert.match(
      APP_CSS,
      /body\.layout-basic \.df-position\s*\{\s*margin:\s*auto 0 0\.22rem;/s,
      'the Today/Tomorrow stack pushes down onto the funds stack',
    );
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__coins\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
      'the exact FLIP readout naturally spans the rack beneath it');
    assert.match(APP_CSS,
      /\.df-modifier-meter-slot\s*\{[^}]*position:\s*absolute[^}]*top:\s*25%[^}]*left:\s*0\.18rem[^}]*width:\s*3\.2rem[^}]*height:\s*8\.93rem[^}]*grid-template-columns:\s*1\.48rem minmax\(0, 1fr\)[^}]*translateY\(-50%\)/s,
      'the multiplier bank shares L25’s height, centerline, and mirrored outer inset');
    assert.match(APP_CSS,
      /\.df-modifier-meter-slot\s*\{[^}]*border:\s*0;[^}]*background:\s*none;[^}]*box-shadow:\s*none/s,
      'the thermometer is printed into the felt instead of sitting in a chassis');
    assert.match(APP_CSS,
      /\.df-modifier-meter__table-scale\s*\{[^}]*align-items:\s*flex-start[^}]*color:\s*rgba\(240, 217, 166, 0\.58\)[^}]*font-size:\s*0\.45rem/s,
      'the permanent scale reads as muted table ink to the right of the bar');
    assert.match(APP_CSS,
      /\.df-modifier-meter-live\s*\{[^}]*--df-meter-pip-bank-height:\s*calc\(8\.93rem - 0\.24rem - 2px\)[^}]*width:\s*1\.48rem[^}]*border:\s*1px solid rgba\(245, 166, 35, 0\.52\)[^}]*background-color:\s*#0d0907[^}]*rgba\(255, 255, 255, 0\.016\)[^}]*opacity:\s*0\.92/s,
      'the idle selector shares L25’s brass frame, dark insert, and exact inner bank height');
    assert.match(APP_CSS,
      /\.df-modifier-meter-live:has\(> \.df-modifier-meter\)[^}]*border-color:\s*rgba\(245, 166, 35, 0\.52\)[^}]*opacity:\s*1/s,
      'lighting the selector does not replace the matching L25 brass frame');
    assert.match(APP_CSS,
      /\.df-modifier-meter__marker\s*\{[^}]*inset:\s*auto 0 0[^}]*width:\s*100%[^}]*overflow:\s*hidden[^}]*background:\s*none[^}]*will-change:\s*height/s,
      'the fill window clips the shared pip bank instead of drawing a separate needle');
    assert.match(APP_CSS,
      /\.df-modifier-meter__pip-bank\s*\{[^}]*height:\s*var\(--df-meter-pip-bank-height\)[^}]*grid-template-rows:\s*repeat\(25, minmax\(0, 1fr\)\)[^}]*gap:\s*1px/s,
      'the thermometer uses the same twenty-five-row pip geometry as Last 25');
    assert.match(APP_CSS,
      /\.df-modifier-flash\s*\{[^}]*left:\s*calc\(100% \+ 0\.42rem\)[^}]*background:\s*rgba\(3, 24, 13, 0\.92\)[^}]*df-multiplier-flash/s,
      'the exact result still gets its brief digital popout beside the persistent rail');
    assert.match(APP_CSS,
      /@keyframes df-meter-settle\s*\{[^]*?42%\s*\{\s*height:\s*100%[^]*?100%\s*\{\s*height:\s*var\(--df-meter-stop/s,
      'the moving lights fully fill the rail before returning to the rounded result');
    assert.match(APP_CSS,
      /\.df-modifier-meter--settling \.df-modifier-meter__pip-bank--peak\s*\{[^}]*df-meter-peak-blue[^]*?@keyframes df-meter-peak-blue\s*\{[^]*?41%, 46%\s*\{\s*opacity:\s*1/s,
      'a bank of blue 250-roll pips takes over for the fully-filled top beat');
    assert.match(APP_CSS,
      /\.df-tomorrow-layout\s*\{[^}]*grid-template-areas:\s*"label" "oval" "total"[^}]*grid-template-rows:\s*auto 1\.95rem 1\.2rem/s,
      'Tomorrow uses the same felt-label, chip-strip, and compact value hierarchy as Today');
    assert.match(APP_CSS,
      /\.df-tomorrow-layout \.df-position-unit\s*\{[^}]*margin-left:\s*1ch/s,
      'Tomorrow’s numeric total uses the full monospace gap before FLIP');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__display\s*\{[^}]*padding:\s*0\.18rem 0\.22rem/s,
      'the FLIP receipt keeps its compact numeric inset');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__value\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*baseline[^}]*justify-content:\s*flex-end/s,
      'the rack receipt and Tomorrow align the number/unit pair on one baseline');
    assert.match(APP_CSS,
      /body\.layout-basic \.df-funds__unit\s*\{[^}]*margin-left:\s*1ch/s,
      'both lower FLIP units match the full-space rhythm of Today’s Bet');
    assert.equal(claim.disabled, false,
      'the rack remains a reachable Claim opener while the payout number is masked');
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
    const tomorrowRack = el.querySelector('[data-bind="df-tomorrow-chip-rack"]');
    assert.equal(tomorrowRack.textContent, '123,500 FLIP',
      'the compact Tomorrow spot prints its amount as text');
    assert.equal(tomorrowRack.querySelector('.df-bet-chip-stack, .df-bet-pile'), null,
      'Tomorrow does not duplicate Today’s physical wager stacks');
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
    assert.match(el.querySelector('[data-position="today"]').textContent, /WIN196%\+85,930/,
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
      /Today's betWIN200%\+2,014,000/,
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

    assert.match(el.querySelector('[data-position="today"]').textContent, /43,840 FLIP/,
      "before reveal, today's committed stake is visible");
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);
    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '987,654',
      'the safe wallet portion stays visible until the coin lands');
    el.querySelector('.df-coin--spinning').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    const today = el.querySelector('[data-position="today"]');
    const tomorrow = el.querySelector('[data-position="tomorrow"]');
    const flipTotal = el.querySelector('[data-bind="df-funds-flip-total"]');
    assert.match(today.textContent, /Today's betWIN196%\+85,930/,
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

    assert.equal(el.querySelector('[data-bind="df-funds-flip-total"]').textContent, '987,654',
      'the live claimable increase is held behind the settled wallet amount');
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
    assert.match(el.innerHTML,
      /df-baf-score__title[^>]*href="\/learn\/baf\/"[\s\S]*?df-baf-score__unit">BAF<[\s\S]*?df-baf-score__rank[^>]*>RANK —</,
      'the compact BAF + live-rank header remains the learn-more link');
    assert.match(APP_CSS,
      /\.df-baf-score\s*\{[^}]*position:\s*absolute;[^}]*top:\s*var\(--df-score-cap-top\);[^}]*left:\s*0\.18rem;[^}]*width:\s*5\.1rem;[^}]*height:\s*1\.62rem;[^}]*grid-template-rows:\s*0\.42rem minmax\(0, 1fr\)/s,
      'BAF occupies the lower-left green instrument exactly the size of the All Time cap');
    assert.match(APP_CSS,
      /\.df-baf-score__title\s*\{[^}]*justify-content:\s*center;[^}]*font-size:\s*0\.42rem;[^}]*text-transform:\s*uppercase/s,
      'BAF and its rank share one centered header line above the score');
    assert.doesNotMatch(el.innerHTML, /BIG ASS FLIP SCORE|df-baf-score__info/,
      'the moved instrument drops the long label and extra info circle');
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
      /Today's betWIN196%\+85,930/,
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
    assert.match(today.textContent, /Today's betLOSS-43,840/);
    assert.match(tomorrow.textContent, /9,000 FLIP/);
    assert.equal(flipTotal.textContent, '5,514,051',
      'loss leaves prior unclaimed FLIP included in the effective total');
    assert.equal(el.querySelectorAll('.df-position-delta').length, 0);
    assert.equal(today.querySelector('.df-position-value').textContent, '-43,840',
      'the burned resolved-day stake is the explicit signed loss result');
    assert.equal(el.querySelector('[data-bind="df-outcome"]').textContent, '',
      'there is no second loss result');

    storeMod.update('viewing.address', TEST_ADDR);
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /9,000 FLIP/,
      'current-day stake survives a loss and refresh');
    el.disconnectedCallback();
  });

  test('Tomorrow is one Add Bet surface and the chip rack is the cash-out surface', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: { day: 67, win: true, rewardPercent: 96 } };
    const el = mount();
    await flushMicrotasks();

    const flip = el.querySelector('[data-bind="df-flip-cta"]');
    assert.ok(flip, 'Tomorrow Add Bet surface');
    assert.equal(flip.tagName, 'DIV');
    assert.match(el.innerHTML,
      /<div class="df-tomorrow-layout" data-bind="df-flip-cta"\s+role="button" tabindex="0"[\s\S]*?df-tomorrow-layout__felt-label[\s\S]*?<div class="df-tomorrow-bet-oval"[\s\S]*?<span class="df-tomorrow-layout__add-cue"[^>]*>\+<\/span>[\s\S]*?data-bind="df-add-bet-controls"/,
      'the whole Tomorrow fixture is keyboard-clickable and its plus is inside the betting oval');
    assert.doesNotMatch(el.innerHTML, />\+ ADD<|<span>ADD<\/span>|class="df-flip-cta"/,
      'there is no separate yellow Add button inside the betting area');
    const amount = el.querySelector('[name="df-amount"]');
    assert.match(el.innerHTML,
      /df-add-bet-dialog__value[\s\S]*?type="text" name="df-amount"[^>]*data-bind="df-add-bet-number"[^>]*inputmode="numeric"/,
      'the amount headliner itself accepts an exact numeric amount');
    assert.doesNotMatch(el.innerHTML, /EXACT AMOUNT|df-add-bet-dialog__number-field/,
      'there is no redundant exact-amount input below the headliner');
    assert.match(el.innerHTML, /type="range" data-bind="df-add-bet-slider"/,
      'the dialog retains its quick amount slider');
    assert.match(el.innerHTML,
      /df-add-bet-dialog__chip-scene[\s\S]*?src="\/shared\/flip-chips\/coin\.svg"[\s\S]*?data-bind="df-add-bet-chip-pile"/,
      'the popup header starts with one canonical FLIP coin');
    assert.match(el.innerHTML,
      /df-add-bet-dialog__value[\s\S]*?src="\/whitepaper\/flame-logo-split\.svg"[\s\S]*?data-bind="df-add-bet-number"/,
      'the editable betting spot uses the flat FLIP mark without replacing its input');
    assert.doesNotMatch(el.querySelector('.df-add-bet-dialog__head').textContent,
      /COMMUNITY COINFLIP/,
      'the popup has one direct bet instruction instead of a second header label');
    const dialog = el.querySelector('[data-bind="df-add-bet-dialog"]');
    assert.equal(dialog.hidden, true, 'the slider stays out of the Tomorrow row until requested');
    flip.dispatchEvent({ type: 'click' });
    assert.equal(dialog.hidden, false, 'Add Bet opens its amount dialog without sending a transaction');
    const reuse = el.querySelector('[data-bind="df-add-bet-reuse"]');
    const chipPile = el.querySelector('[data-bind="df-add-bet-chip-pile"]');
    assert.equal(chipPile.getAttribute('data-pile-count'), '4');
    assert.equal(chipPile.getAttribute('src'), '/shared/flip-chips/stack-4.svg',
      'the common 1,000 FLIP default opens on a small meaningful stack');
    assert.equal(reuse.hidden, false);
    assert.equal(reuse.textContent, 'REUSED WINNINGS +0.75% · +7 FLIP',
      'the default rebet truncates its claimable-winnings bonus to whole FLIP');
    amount.value = '5000';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(chipPile.getAttribute('src'), '/shared/flip-chips/stack-6.svg',
      'lower common bets gain visible stack height before mound scale');
    amount.value = '10000';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(chipPile.getAttribute('src'), '/shared/flip-chips/stack-7.svg',
      '10K remains a taller dealer stack');
    amount.value = '100000';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(chipPile.getAttribute('src'), '/shared/flip-chips/pile-5-c.svg',
      '100K opens the first full mound composition');
    amount.value = '5000000';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(chipPile.getAttribute('src'), '/shared/flip-chips/pile-15-c.svg',
      'multi-million-FLIP entries continue up the mound ladder');
    amount.value = '54000';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(amount.value, '54,000', 'the prominent amount headliner formats the typed selection');
    assert.equal(chipPile.getAttribute('src'), '/shared/flip-chips/stack-9.svg',
      'a 54K entry is a near-full dealer stack, not a loose mound');
    assert.equal(reuse.textContent, 'REUSED WINNINGS +0.75% · +405 FLIP',
      'the reuse bonus follows the exact typed amount');
    const slider = el.querySelector('[data-bind="df-add-bet-slider"]');
    assert.equal(slider.step, '100', 'the slider never resolves below round 100-FLIP stops');
    assert.equal(slider.value, '54000', 'the number field keeps the slider synchronized');
    amount.value = '54123';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(amount.value, '54,123', 'typing can still retain an exact whole-FLIP amount');
    assert.equal(slider.value, '54100', 'the slider thumb follows the nearest round stop');
    slider.value = '54149';
    slider.dispatchEvent({ type: 'input' });
    assert.equal(slider.value, '54100', 'a large-total slider selection snaps to its nearest round stop');
    assert.equal(amount.value, '54,100', 'a snapped slider selection updates the formatted number field');
    slider.dispatchEvent({ type: 'pointerdown', shiftKey: false });
    slider.value = '54700';
    slider.dispatchEvent({ type: 'input' });
    assert.equal(slider.value, '55000', 'ordinary dragging magnetizes the slider to 1,000-FLIP stops');
    assert.equal(amount.value, '55,000', 'the coarse drag value remains synchronized');
    slider.dispatchEvent({ type: 'pointerup' });
    slider.dispatchEvent({ type: 'pointerdown', shiftKey: true });
    slider.value = '54700';
    slider.dispatchEvent({ type: 'input' });
    assert.equal(slider.value, '54700', 'Shift-drag retains 100-FLIP precision');
    assert.equal(amount.value, '54,700', 'the fine drag value remains synchronized');
    slider.dispatchEvent({ type: 'pointerup' });
    amount.value = '100';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(chipPile.getAttribute('src'), '/shared/flip-chips/coin.svg',
      'reducing the entered amount visibly returns the stack to one coin');
    assert.match(el.innerHTML, /aria-description="Drag in 1,000 FLIP steps\.[^"]*100 FLIP adjustments\."/,
      'assistive copy explains coarse and fine manipulation');
    assert.equal(el.querySelector('[data-bind="df-bet-up"]'), null);
    assert.equal(el.querySelector('[data-bind="df-bet-down"]'), null);
    assert.ok(
      el.innerHTML.indexOf('data-bind="df-add-bet-controls"')
        < el.innerHTML.indexOf('data-bind="df-position-tomorrow"'),
      'the Add trigger remains inside Tomorrow’s chip area before its numeric display',
    );
    assert.equal(el.querySelector('[data-bind="df-claim-cta"]'), null,
      'Claim DGNRS CTA removed from the coinflip column');
    assert.ok(!/Claim DGNRS/.test(el.innerHTML), 'no claim label in markup');
    assert.match(APP_CSS,
      /\.df-tomorrow-layout\s*\{[^}]*cursor:\s*pointer/s,
      'the entire Tomorrow fixture communicates its click target');
    assert.match(APP_CSS,
      /\.df-tomorrow-layout:hover \.df-tomorrow-bet-oval,[\s\S]*?\.df-tomorrow-layout:focus-visible \.df-tomorrow-bet-oval\s*\{[^}]*border-color:\s*rgba\(253,230,138,\.78\)/s,
      'hover and keyboard focus light the recessed oval rather than a nested key');
    assert.match(APP_CSS,
      /\.df-tomorrow-layout__add-cue\s*\{[^}]*position:\s*absolute[^}]*top:\s*50%[^}]*left:\s*\.3rem[^}]*font:\s*950 \.72rem[^}]*translate:\s*0 -50%/s,
      'a small plus is vertically centered against the oval’s left edge');
    assert.match(APP_CSS,
      /\.df-tomorrow-bet-oval :is\(\.df-next-bet__quest,\.df-next-bet__boon\)\s*\{[^}]*top:\s*50%[^}]*width:\s*1rem[^}]*min-width:\s*1rem[^}]*height:\s*1rem[^}]*min-height:\s*1rem[^}]*padding:\s*0[^}]*scale:\s*\.84[^}]*translate:\s*0 -50%/s,
      'Tomorrow vertically centers both live badge sockets');
    assert.match(APP_CSS,
      /\.df-tomorrow-bet-oval \.df-next-bet__quest\s*\{[^}]*right:\s*\.12rem[^}]*left:\s*auto[^}]*\}[\s\S]*?\.df-tomorrow-bet-oval \.df-next-bet__boon\s*\{[^}]*right:\s*auto[^}]*left:\s*1rem/s,
      'Quest stays right while Boon shifts inward clear of the left-side plus');
    assert.match(CHIPSET_CSS,
      /\.df-tomorrow-bet-oval \.df-bet-chip-rack\s*\{[^}]*width:\s*calc\(100% - 3\.8rem\)[^}]*justify-self:\s*center/s,
      'the staged amount reserves clearance for the plus and both badge sockets');
    assert.match(APP_CSS,
      /\.df-add-bet-dialog__value\s*\{[^}]*text-align:\s*center[^}]*text-overflow:\s*ellipsis/s,
      'the popup gives the selected amount a stable prominent readout');
    assert.match(APP_CSS,
      /\.df-add-bet-dialog__value input\s*\{[^}]*font:\s*inherit[^}]*text-align:\s*center/s,
      'the editable input inherits the prominent amount treatment');
    assert.match(CHIPSET_CSS,
      /\.df-add-bet-dialog__value\s*\{[^}]*border:\s*0\.14rem solid var\(--df-add-bet-blue\)[^}]*border-radius:\s*999px[^}]*linear-gradient\(180deg, #2a3d75/s,
      'the amount input is presented in the same painted blue oval language as the table');
    assert.match(CHIPSET_CSS,
      /input\[type="range"\]::-(?:webkit-slider-thumb|moz-range-thumb)\s*\{[^}]*background:\s*url\('\/shared\/flip-chips\/face\.svg'\) center \/ contain no-repeat/s,
      'the quick slider uses a canonical FLIP chip for its physical thumb');
    assert.match(CHIPSET_CSS,
      /@media \(max-width: 360px\)\s*\{[\s\S]*?\.df-add-bet-dialog__card\s*\{[^}]*max-height:\s*calc\(100dvh - 1rem\)[^}]*padding:\s*0\.72rem/s,
      'the chip-led placard keeps an explicit compact layout for a 320px viewport');
    assert.doesNotMatch(APP_CSS, /\.df-player-fund-actions|\.df-player-fund-widget/,
      'the removed three-widget strip leaves no dormant styling behind');
    assert.match(el.innerHTML,
      /<button type="button" class="df-bankroll__well" data-write[\s\S]*?data-bind="df-claim-flip-cta"/,
      'the recessed physical rack—not a separate utility button—opens cash out');
    assert.doesNotMatch(APP_CSS,
      /\.app-daily-flip \.df-next-bet \.df-flip-cta\[data-write\],/,
      'the Tomorrow felt pill owns its geometry instead of inheriting the ledger action size');
    assert.doesNotMatch(APP_CSS, /\.df-next-bet__stepper|\.df-next-bet__arrows/,
      'the removed inline amount and arrow controls leave no dormant styling');
    assert.match(APP_CSS,
      /\.df-bankroll__well\s*\{[^}]*cursor:\s*pointer/s,
      'the built-in rack itself advertises the Claim interaction');
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

  test('a broadcast Add Bet can be dismissed while its receipt stays pending', async () => {
    let releaseReceipt;
    let receiptConfirmed = false;
    const receiptGate = new Promise((resolve) => { releaseReceipt = resolve; });
    const calls = [];
    const deposit = Object.assign(
      async (...args) => {
        calls.push(['send', ...args]);
        return {
          hash: '0xpending-add-bet',
          wait: async () => {
            const receipt = await receiptGate;
            receiptConfirmed = true;
            return receipt;
          },
        };
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

    const dialog = el.querySelector('[data-bind="df-add-bet-dialog"]');
    el.querySelector('[data-bind="df-flip-cta"]').dispatchEvent({ type: 'click' });
    el.querySelector('[data-bind="df-add-bet-confirm"]').dispatchEvent({ type: 'click' });
    await flushPromises();
    assert.equal(calls.filter(([stage]) => stage === 'send').length, 1,
      'the wallet has broadcast exactly one deposit');
    assert.equal(receiptConfirmed, false, 'the receipt is still pending');

    el.querySelectorAll('[data-bind="df-add-bet-close"]')[0]
      .dispatchEvent({ type: 'click' });
    assert.equal(dialog.hidden, true,
      'the X removes the blocking modal before the receipt arrives');
    assert.equal(receiptConfirmed, false,
      'closing presentation does not pretend the transaction confirmed');

    releaseReceipt({ status: 1, logs: [] });
    await flushPromises();
    assert.equal(receiptConfirmed, true,
      'receipt handling continues after the modal is dismissed');
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
    assert.equal(input.value, '1,000');
    assert.equal(reuse.textContent, 'REUSED WINNINGS +0.75% · +1 FLIP',
      'the claimable-funded bonus is shown as whole FLIP only');
    assert.equal(reuse.getAttribute('title'), '200 FLIP of this bet comes from winnings.');

    input.value = '100';
    input.dispatchEvent({ type: 'input' });
    assert.equal(reuse.hidden, true, 'a sub-one-FLIP truncated bonus does not show a +0 callout');
    assert.equal(reuse.textContent, '');

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

  test('ordinary Add Bet popup shows the quest reward only when this amount completes it', async () => {
    const unit = 10n ** 18n;
    storeMod.update('ui.questObjectives', {
      address: TEST_ADDR.toLowerCase(),
      day: 67,
      quests: [{
        questType: 2,
        role: 'DAILY',
        progress: String(1_500n * unit),
        target: String(2_000n * unit),
        completed: false,
        flipReward: 100,
      }],
    });
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    el.querySelector('[data-bind="df-flip-cta"]').dispatchEvent({ type: 'click' });
    const amount = el.querySelector('[data-bind="df-add-bet-number"]');
    const bonus = el.querySelector('[data-bind="df-add-bet-quest-bonus"]');
    assert.equal(bonus.hidden, false);
    assert.equal(bonus.textContent, 'QUEST COMPLETION BONUS · +100 FLIP · +1 STREAK');

    amount.value = '100';
    amount.dispatchEvent({ type: 'input' });
    assert.equal(bonus.hidden, true, 'an amount below the remaining target promises no reward');
    assert.equal(bonus.textContent, '');
    el.disconnectedCallback();
  });

  test('jackpot LCD handoff scrolls on mobile and starts the real coin reveal path', async () => {
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    let scrolled = null;
    el.scrollIntoView = (options) => { scrolled = options; };

    assert.equal(el.startCoinflipFromJackpot({ scroll: true }), true);
    await flushMicrotasks();
    assert.deepEqual(scrolled, { behavior: 'smooth', block: 'center' });
    assert.equal(globalThis.localStorage.getItem('flip_day_84532_67'), '1');
    assert.ok(el.querySelector('.df-coin--landed'),
      'the handoff uses the same authoritative landing as tapping the coin');
    assert.equal(el.startCoinflipFromJackpot({ scroll: true }), false,
      'the same exact-day result cannot be started twice');
    el.disconnectedCallback();
  });

  test('the ledger utility opens the live auto-rebuy settings', async () => {
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
      el.innerHTML.indexOf('data-bind="df-coinflip-record"')
        < el.innerHTML.indexOf('class="df-title-bar"')
        && el.innerHTML.indexOf('class="df-title-bar"')
          < el.innerHTML.indexOf('class="df-coin-stage"')
        && el.innerHTML.indexOf('class="df-coin-stage"')
          < el.innerHTML.indexOf('data-bind="df-coin-zone"'),
      'the live record is anchored to the widget corner, outside both title and coin stage',
    );
    assert.doesNotMatch(el.innerHTML, /df-title-bar__coin-mark/,
      'the title bar has no decorative circle inserted only to balance a utility');
    assert.match(el.innerHTML,
      /class="df-modifier-meter-slot"[\s\S]*?data-bind="df-auto-rebuy-cta"[\s\S]*?>AUTO REBUY<[\s\S]*?src="\/shared\/flip-chips\/face\.svg"[\s\S]*?class="df-bet-table"/,
      'Auto Rebuy is its own printed felt feature with the canonical FLIP logo');
    assert.doesNotMatch(trigger.textContent, /↻/,
      'the felt betting spot replaces the old reverse-arrow utility icon');
    assert.match(APP_CSS,
      /\.df-coinflip-record-rail\s*\{[^}]*position:\s*absolute[^}]*top:\s*0[^}]*right:\s*0\.18rem[^}]*width:\s*5\.1rem[^}]*height:\s*100%/s,
      'the record overlay spans the felt so its detached pieces can anchor independently');
    assert.doesNotMatch(APP_CSS,
      /\.app-daily-flip:has\(\.df-funds__toggle\[aria-expanded="true"\]\)[\s\S]{0,220}?\.df-coinflip-record-rail/,
      'Protocol Coins state no longer relocates the scoreboard or changes its geometry');
    assert.match(APP_CSS,
      /\.app-daily-flip\s*\{[^}]*--df-score-cap-top:\s*calc\(50% - 2\.1rem\)[\s\S]*?@media\s*\(max-width:\s*520px\)[\s\S]*?\.df-coinflip-record-rail\s*\{[^}]*right:\s*0\.14rem/s,
      'desktop and phone layouts anchor both score caps just above the field divider');
    assert.match(APP_CSS,
      /\.df-auto-rebuy-cta\s*\{[^}]*position:\s*absolute[^}]*top:\s*calc\(50% \+ 0\.45rem\)[^}]*right:\s*0\.25rem[^}]*width:\s*2\.9rem[^}]*height:\s*2\.65rem[^}]*border:\s*0[^}]*background:\s*none[^}]*transform:\s*none/s,
      'Auto Rebuy occupies the far-right red pocket, clear of Today’s Bet');
    assert.match(APP_CSS,
      /\.df-auto-rebuy-cta__spot\s*\{[^}]*width:\s*2\.05rem[^}]*height:\s*2\.05rem[^}]*border:\s*1px solid[^}]*border-radius:\s*50%[^}]*radial-gradient/s,
      'the off state leaves a clear empty felt betting circle');
    assert.match(APP_CSS,
      /\.df-auto-rebuy-cta\.is-active \.df-auto-rebuy-cta__chip\s*\{[^}]*opacity:\s*1[^}]*translate\(-50%, -50%\) scale\(1\)/s,
      'the active state places the real FLIP flame badge in the circle');
    assert.match(APP_CSS,
      /\.df-auto-rebuy-cta__chip\s*\{[^}]*top:\s*50%[^}]*left:\s*50%[^}]*width:\s*85%[^}]*height:\s*85%[^}]*translate\(-50%, -50%\)/s,
      'the FLIP badge stays concentric with a little more red-felt clearance around it');
    assert.match(APP_CSS,
      /@media\s*\(max-width:\s*520px\)[\s\S]*?\.df-modifier-meter-slot,[\s\S]*?\.df-coinflip-record__group--recent\s*\{[^}]*top:\s*calc\(25% - 0\.5rem\)/s,
      'both vertical banks lift together above their mobile score caps');
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

  test('the corner L-board colors all-time history and Last 25 majorities independently', async () => {
    localStorage.setItem('flip_day_84532_67', '1');
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: null,
      coinflipStats: {
        wins: 27,
        losses: 19,
        recent: Array.from({ length: 25 }, (_, index) => ({
          day: 68 - index,
          win: index % 3 === 0,
          ...(index === 0 ? { rewardPercent: 150 } : {}),
          ...(index === 3 ? { rewardPercent: 50 } : {}),
        })),
      },
    };
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="df-coinflip-wins"]').textContent, '27');
    assert.equal(el.querySelector('[data-bind="df-coinflip-losses"]').textContent, '19');
    assert.match(el.innerHTML,
      /df-coinflip-record__label--record[^>]*>[\s\n]*ALL TIME<[\s\S]*df-coinflip-record__label--recent[^>]*>[\s\n]*LAST 25</,
      'the corner board labels its all-time score and descending recent bank');
    const marks = el.querySelector('[data-bind="df-coinflip-recent"]').children;
    assert.equal(marks.length, 25);
    assert.equal(marks[0].title, 'Win · Day 68', 'newest visible result starts at the top');
    assert.equal(marks[24].title, 'Win · Day 44', 'oldest visible result ends at the bottom');
    assert.match(marks[0].className, /is-win is-roll-250/,
      'a 250% roll receives the blue Last 25 marker');
    assert.match(marks[3].className, /is-win is-roll-150/,
      'a 150% roll receives the yellow Last 25 marker');
    assert.doesNotMatch(marks[6].className, /is-roll-(?:150|250)/,
      'ordinary wins keep the standard green marker');
    assert.equal(
      el.querySelector('.df-coinflip-record__group--score').getAttribute('data-majority'),
      'win',
      'the protocol record gets a green background from its own W–L majority',
    );
    assert.equal(
      el.querySelector('.df-coinflip-record__group--recent').getAttribute('data-majority'),
      'loss',
      'Last 25 gets a red background from its independent recent majority',
    );
    assert.match(el.querySelector('[data-bind="df-coinflip-record"]').getAttribute('aria-label'),
      /All-time coinflip record: 27 wins and 19 losses/);
    assert.match(APP_CSS,
      /\.df-coinflip-record__group--score\s*\{[^}]*top:\s*var\(--df-score-cap-top\)[^}]*width:\s*5\.1rem[^}]*height:\s*1\.62rem[^}]*justify-items:\s*center[^}]*border:\s*1px solid rgba\(245, 166, 35, 0\.52\)[^}]*border-radius:\s*4px/s,
      'the independent All Time cap aligns with BAF low in the green felt');
    assert.match(APP_CSS,
      /\.df-coinflip-record\s*\{[^}]*height:\s*100%[^}]*overflow:\s*visible[^}]*contain:\s*layout/s,
      'score updates remain layout-contained inside the full-height overlay');
    const scoreRule = APP_CSS.match(/\.df-coinflip-record__score\s*\{[^}]*\}/s)?.[0] || '';
    assert.match(scoreRule,
      /font-family:\s*"Inter", system-ui, sans-serif;[^}]*font-size:\s*0\.84rem;[^}]*font-weight:\s*1000/s,
      'lifetime totals use large, blocky scoreboard numerals');
    assert.doesNotMatch(scoreRule, /(?:padding|border|background|box-shadow):/,
      'the score sits directly on the scoreboard face without a redundant inner box');
    assert.match(APP_CSS,
      /\.df-coinflip-record__mark\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*border-radius:\s*1px/s,
      'the last twenty-five results render as compact horizontal LEDs');
    assert.match(APP_CSS,
      /\.df-coinflip-record__mark\.is-win\.is-roll-150\s*\{[^}]*#fff59d[^}]*#eab308/s,
      'the 150% Last 25 marker is yellow');
    assert.match(APP_CSS,
      /\.df-coinflip-record__mark\.is-win\.is-roll-250\s*\{[^}]*#93c5fd[^}]*#3b82f6/s,
      'the 250% Last 25 marker is blue');
    assert.match(APP_CSS,
      /\.df-coinflip-record__recent\s*\{[^}]*width:\s*100%[^}]*grid-template-columns:\s*1fr[^}]*grid-template-rows:\s*repeat\(25, minmax\(0, 1fr\)\)[^}]*gap:\s*1px/s,
      'the recent bank uses the thermometer’s full-width segmented channel');
    assert.match(APP_CSS,
      /\.df-coinflip-record__label--recent\s*\{[^}]*position:\s*absolute[^}]*top:\s*-0\.72rem[^}]*left:\s*calc\(50% - 0\.42rem\)[^}]*text-align:\s*center/s,
      'Last 25 is table ink above the instrument instead of a row inside it');
    assert.match(APP_CSS,
      /@media\s*\(max-width:\s*520px\)[\s\S]*?\.df-coinflip-record-rail\s*\{[^}]*right:\s*0\.14rem/s,
      'the full twenty-five-cell bank stays attached to the right gutter on phones');
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
      /\.df-coinflip-record__group--recent\s*\{[^}]*top:\s*25%[^}]*right:\s*0[^}]*width:\s*1\.48rem[^}]*height:\s*8\.93rem[^}]*border:\s*1px solid rgba\(245, 166, 35, 0\.52\)[^}]*border-radius:\s*4px[^}]*translateY\(-50%\)/s,
      'the detached recent bank is vertically centered within the green half');
    assert.match(APP_CSS,
      /\.df-coinflip-record__score b\.is-ticking\s*\{[^}]*df-coinflip-score-tick/s,
      'the newly revealed global result mechanically ticks the matching score');
    assert.match(APP_CSS,
      /\.df-coinflip-record__recent\.is-shifting\s*\{[^}]*df-coinflip-bank-shift/s,
      'the result bank visibly advances one cell on resolution');
    assert.match(APP_CSS,
      /@keyframes df-coinflip-bank-shift\s*\{\s*0%\s*\{[^}]*translateY\(-0\.4rem\)[\s\S]*62%\s*\{[^}]*translateY\(0\.04rem\)/,
      'the recent bank shifts down as the newest result enters from the top');
    assert.match(APP_CSS,
      /\.df-modifier-meter__track\s*\{[^}]*isolation:\s*isolate[^}]*background:\s*#09100f[^}]*inset 0 0 4px rgba\(0, 0, 0, 0\.76\)/s,
      'the payout selector recess holds the same real unlit pip elements as the Last 25 bank');
    el.disconnectedCallback();
  });

  test('the all-time win column and Last 25 bank tick on the exact reveal landing', async () => {
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
      'the twenty-five-result bank shifts on the exact counter-increment render',
    );
    assert.equal(
      el.querySelector('.df-coinflip-record__group--recent').classList.contains('is-resolving'),
      true,
      'the independent Last 25 majority background visibly lands with the new result',
    );
    const newest = el.querySelector('[data-bind="df-coinflip-recent"]').children[0];
    assert.equal(newest.title, 'Win · Day 67');
    assert.equal(newest.className.includes('is-new'), true,
      'the newest global outcome lights with the score on the same landing');
    el.disconnectedCallback();
  });

  test('auto-rebuy remainder stays in the bet and out of Available Funds', async () => {
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
      '185,186',
      'Available Funds is wallet plus ordinary claimable without replayed carry',
    );
    const carryRack = el.querySelector('[data-bind="df-bankroll-rack"]');
    assertBankrollChipCounts(carryRack, { claimable: 2, liquid: 18, total: 18 },
      'the physical rack excludes committed carry too');
    assert.match(carryRack.getAttribute('aria-label'),
      /Claimable 20,000 FLIP\. Liquid 165,186 FLIP\. Combined 185,186 FLIP/);
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
      '185,186',
      'pre-claim total is wallet plus banked FLIP without the rolling remainder',
    );
    let claimRack = el.querySelector('[data-bind="df-bankroll-rack"]');
    assertBankrollChipCounts(claimRack, { claimable: 2, liquid: 18, total: 18 },
      'pre-claim physical composition');

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
      '185,186',
      'the same 20,000 is not counted in both wallet and claimable after confirmation',
    );
    claimRack = el.querySelector('[data-bind="df-bankroll-rack"]');
    assertBankrollChipCounts(claimRack, { claimable: 0, liquid: 20, total: 18 },
      'confirmation repaints composition without changing combined magnitude');
    assert.match(claimRack.getAttribute('aria-label'),
      /Claimable 0 FLIP\. Liquid 185,186 FLIP\. Combined 185,186 FLIP/);
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

  test('the coinflip table removes the Other Coins balances and action drawer', async () => {
    _fetchResponses = { dashboard: dashboardPayload(), flipDay: null };
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="df-funds-toggle"]'), null);
    assert.equal(el.querySelector('[data-bind="df-funds-wwxrp-box"]'), null);
    assert.equal(el.querySelector('[data-bind="df-funds-sdgnrs-box"]'), null);
    assert.equal(el.querySelector('[data-bind="df-burn-wwxrp-cta"]'), null);
    assert.equal(el.querySelector('[data-bind="df-burn-sdgnrs-cta"]'), null);
    assert.equal(el.querySelector('[data-bind="df-charity-vote-cta"]'), null);
    assert.doesNotMatch(el.innerHTML, />OTHER COINS<|>WWXRP<|>sDGNRS<\/strong>/,
      'the felt fixture has no secondary-currency headings or rows');
    assert.equal(el.querySelectorAll('.df-funds__display').length, 1,
      'the rack has only its FLIP number beneath it');
    el.disconnectedCallback();
  });

  test('an empty FLIP balance leaves an empty physical tray and one unit-bearing receipt', async () => {
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
    const rack = el.querySelector('[data-bind="df-bankroll-rack"]');
    assert.equal(rack.getAttribute('data-state'), 'empty');
    assertBankrollChipCounts(rack, { claimable: 0, liquid: 0, total: 0 },
      'zero balance creates no physical nodes');
    assert.equal(rack.textContent, '');
    assert.match(rack.getAttribute('aria-label'),
      /Claimable 0 FLIP\. Liquid 0 FLIP\. Combined 0 FLIP/);
    assert.equal(el.querySelector('[data-bind="df-claim-flip-cta"]').disabled, false,
      'the rack remains the Claim opener even when there are no chips');
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
    assert.equal(amount.value, '2,000', '18-decimal quest target becomes an exact slider selection');
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
    assert.equal(normalAmount.value, '1,375',
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
      assert.match(APP_CSS,
        /@media\s*\(max-width:\s*430px\)[\s\S]*?\.df-reversi-card,[\s\S]*?\.df-reversi-card--live-tap\s*\{[^}]*right:\s*auto;[^}]*left:\s*calc\(50% \+ 60px\)/s,
        'phone layouts dock both Reverse states beside the coin instead of under Last 25');
      assert.doesNotMatch(APP_CSS,
        /@media\s*\(max-width:\s*430px\)[\s\S]{0,220}?\.df-reversi-card\s*\{[^}]*right:\s*0\.15rem/s,
        'the removed right-edge phone dock cannot regress beneath the record rail');
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
    assert.equal(BigInt(input.value.replace(/,/g, '')) * unit, 200_000n * unit);
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

  test("the bare clock shift deals Tomorrow's carry-inclusive stake into Today", async () => {
    const unit = 10n ** 18n;
    // The live stake reader has already combined 12,000 stored FLIP with the
    // 475 FLIP auto-rebuy carry. That committed carry must move into Today;
    // it must never return to Available Funds as though it could be bet again.
    _currentStakeWei = String(12_475n * unit);
    coinflipMod.__setAutoRebuyInfoReaderForTest(async () => ({
      enabled: true,
      takeProfitWei: 0n,
      carryWei: 475n * unit,
      startDay: 64,
    }));
    _resolvedStakeWei = '43844000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    localStorage.setItem('flip_day_84532_67', '1');
    const el = mount();
    await flushMicrotasks();

    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,480 FLIP/);

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

    assert.match(el.querySelector('[data-position="today"]').textContent, /Today's bet12,480 FLIP/,
      'the stored stake and its auto-rebuy carry change day ownership together');
    assert.match(el.querySelector('[data-bind="df-bet-oval"]').getAttribute('aria-label'),
      /Today's bet: 12,475 FLIP/,
      'the physical chip spot receives the exact carry-inclusive bet in the same transition');
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /Tomorrow's bet0/,
      'the new Tomorrow spot resets when its stake moves into Today');

    // The later RNG edge adopts the new coin day, but must not throw away the
    // carry that already moved with the clock while confirmation reads load.
    coinflipMod.__setCurrentStakeReaderForTest(() => new Promise(() => {}));
    coinflipMod.__setResolvedStakeReaderForTest(() => new Promise(() => {}));
    storeMod.update('app.daySync', {
      day: 68,
      jackpotReady: false,
      coinflipReady: false,
      rngLocked: true,
      rngRequested: true,
      ready: false,
      phase: 'waiting-both',
      coinflipResult: null,
    });
    await flushMicrotasks();

    assert.ok(el.querySelector('.df-coin--syncing'), 'the RNG edge adopts the new coin day');
    assert.match(el.querySelector('[data-position="today"]').textContent, /Today's bet12,480 FLIP/,
      'full day adoption preserves the clock-carried bet while reads are pending');
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /Tomorrow's bet0/);
    el.disconnectedCallback();
  });

  test("a stake read landing in the clock gap cannot leak the next day's jackpot additions", async () => {
    _currentStakeWei = '12000000000000000000000';
    _resolvedStakeWei = '43844000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);

    // The chain rolls past the wall clock and its next-day stake read now
    // carries the unrevealed jackpot's FLIP additions. The handoff latched
    // 12,000 at the tick; the fatter live read must stay behind the hold
    // until THIS day's jackpot has actually been watched.
    _currentStakeWei = '16000000000000000000000';
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

    assert.match(el.querySelector('[data-position="today"]').textContent, /Today's bet12,000 FLIP/,
      'Today keeps the amount latched at the tick, not the reward-inflated read');
    assert.doesNotMatch(el.textContent, /16,000/,
      'the reward-inflated stake is not painted anywhere while its jackpot is unrevealed');
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /Tomorrow's bet0/,
      'Tomorrow stays reset instead of releasing the live read against the old day’s markers');
    el.disconnectedCallback();
  });

  test('a known zero stake becomes an immediate no-bet Today at the bare clock shift', async () => {
    _currentStakeWei = '0';
    _resolvedStakeWei = '43844000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
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

    assert.equal(el.querySelector('[data-position="today"]').textContent, "Today's bet",
      'known zero does not retain the prior resolved stake or show a fake amount');
    assert.equal(
      el.querySelector('[data-bind="df-bet-oval"]').getAttribute('aria-label'),
      "Today's bet: no bet",
    );
    assert.equal(el.querySelector('[data-bind="df-bet-chip-rack"]').children.length, 0);
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /Tomorrow's bet0/);
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
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /Tomorrow's bet0/,
      'the staged amount moved into Today, so the new tomorrow resets to empty');
    el.disconnectedCallback();
  });

  test("the staged stake deals onto Today's spot at the tick, before any read returns", async () => {
    _currentStakeWei = '12000000000000000000000';
    _resolvedStakeWei = '43844000000000000000000';
    _fetchResponses = {
      dashboard: dashboardPayload(),
      flipDay: { day: 67, win: true, rewardPercent: 96 },
    };
    const el = mount();
    await flushMicrotasks();
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /12,000 FLIP/);

    // Day 68 begins and every stake read hangs: the bet locked at the
    // boundary, so only the carried client-side stake can paint the spot.
    coinflipMod.__setCurrentStakeReaderForTest(() => new Promise(() => {}));
    coinflipMod.__setResolvedStakeReaderForTest(() => new Promise(() => {}));
    _fetchResponses.flipDay = null;
    localStorage.setItem('jackpot_complete_day_84532_68', '1');
    storeMod.update('app.lastDay', { day: 68, status: 'resolved' });
    await flushMicrotasks();

    assert.match(el.querySelector('[data-position="today"]').textContent, /Today's bet12,000 FLIP/,
      'the locked bet chips land with the day tick, not with the confirming read');
    assert.match(el.querySelector('[data-bind="df-bet-oval"]').getAttribute('aria-label'),
      /Today's bet: 12,000 FLIP/,
      'the chip spot itself announces the carried stake immediately');
    assert.match(el.querySelector('[data-position="tomorrow"]').textContent, /Tomorrow's bet0/,
      'tomorrow resets at the same tick instead of echoing the moved stake');
    assert.equal(
      el.querySelector('[data-bind="df-tomorrow-bet-oval"]').getAttribute('aria-label'),
      "Tomorrow's bet: no bet",
      'the staged spot returns to its NO BET invite');
    el.disconnectedCallback();
  });
});
