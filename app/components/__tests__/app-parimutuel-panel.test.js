// /app/components/__tests__/app-parimutuel-panel.test.js — the side-bets widget.
// Run: cd website && node --test app/components/__tests__/app-parimutuel-panel.test.js
//
// Covers the part of the widget that has rules rather than pixels:
//   - it shows only the compact Incinerator when Growth is closed
//   - an open GROWTH book renders the round, the book counts, the payout quotes
//     and two bet buttons
//   - a held position replaces the buttons with the "your bet" marker
//   - a settled winner keeps the panel on screen with a CLAIM for the total
//   - a bet click reaches placeBet(player, over)
//
// Fake DOM harness: the trimmed port used by app-daily-flip.test.js /
// app-balances-strip.test.js.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as storeMod from '../../app/store.js';
import * as contractsMod from '../../app/contracts.js';
import * as pari from '../../app/parimutuel.js';
import * as decimatorMod from '../../app/decimator.js';
import * as pendingActionsMod from '../../app/pending-actions.js';
import { invalidateJSONCache } from '../../app/api.js';

const TEST_ADDR = '0xab12000000000000000000000000000000000000';
const LEVEL = 42;
const FLIP = 10n ** 18n;
// Base Sepolia stores native amounts at /1M scale; displayEth restores that
// factor. Keep pool fixtures in raw contract units so ETH labels are realistic.
const RAW_ETH = 10n ** 12n;

// ---------------------------------------------------------------------------
// Fake DOM
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
        if (classMatch) {
          child.className = classMatch[1];
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
      for (const fn of arr) {
        try { fn(ev); } catch { /* swallow */ }
      }
      return true;
    },
    click() { return this.dispatchEvent({ type: 'click' }); },
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
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(base));
  }
}
globalThis.HTMLElement = FakeHTMLElement;

let _docBody = makeFakeElement('body');
const _docListeners = new Map();
globalThis.document = {
  createElement: (tag) => makeFakeElement(tag),
  querySelector: (sel) => _docBody.querySelector(sel),
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
  location: { search: '', href: 'http://localhost/', hostname: 'localhost' },
};
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};
globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};
let _gameState = { level: LEVEL, phase: 'JACKPOT', decWindowOpen: false };
let _decimatorPosition = null;
const indexedFetch = async (url) => {
  if (/\/game\/state$/.test(String(url))) {
    return { ok: true, status: 200, json: async () => _gameState };
  }
  if (/\/player\/0x[0-9a-f]+\/decimator\?level=\d+$/i.test(String(url)) && _decimatorPosition) {
    return { ok: true, status: 200, json: async () => _decimatorPosition };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
globalThis.fetch = indexedFetch;

// ---------------------------------------------------------------------------
// Chain fakes — one contract stub feeding both views.
// ---------------------------------------------------------------------------

// growth returns: [openRound, over, under, questReward, side, claimed, outcome, payout]
function growthRow(over) {
  return {
    openRound: 0, over: 0n, under: 0n, questReward: 150n * FLIP,
    side: 0, claimed: false, outcome: 0, payout: 0n, ...over,
  };
}

function installContract({
  growth = {},
  ratchets = null,
  calls,
  growthBettors = [],
  growthReadErrors = [],
  marketGate = { mayBet: true, earnsReward: true },
  chainLevel = LEVEL,
  poolTarget = null,
  jackpotPhase = false,
  compressedFlag = 0,
} = {}) {
  const rows = growth;
  const rejectedGrowthRounds = new Set(growthReadErrors.map(Number));
  const fake = {
    marketState: async (_player, round) => {
      if (rejectedGrowthRounds.has(Number(round))) throw new Error('growth read unavailable');
      const r = growthRow(rows[Number(round)] || {});
      return [r.openRound, r.over, r.under, r.questReward, r.side, r.claimed, r.outcome, r.payout];
    },
    placeBet: Object.assign(
      async (...args) => { calls?.push(['placeBet', ...args]); return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) }; },
      { staticCall: async () => undefined },
    ),
    claim: Object.assign(
      async (...args) => { calls?.push(['claim', ...args]); return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) }; },
      { staticCall: async () => undefined },
    ),
    claimRound: Object.assign(
      async (...args) => { calls?.push(['claimRound', ...args]); return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) }; },
      { staticCall: async () => undefined },
    ),
    filters: {
      BetPlaced: (_player, round) => ({ event: 'growth', round }),
    },
    queryFilter: async (filter) => {
      if (filter?.event === 'growth') {
        return growthBettors.map((row) => ({
          args: { player: row.player, round: filter.round, over: row.over },
        }));
      }
      return [];
    },
    // requireStaticCall connects the signer before pre-flighting.
    connect(_signer) { return this; },
  };
  pari.__setContractFactoryForTest(() => fake);
  pari.__setQuestFactoryForTest(() => ({
    marketBetGates: async () => [
      Boolean(marketGate?.mayBet),
      Boolean(marketGate?.earnsReward),
    ],
  }));
  // GAME growthState — a different contract, so its own seam.
  if (ratchets) {
    pari.__setGameFactoryForTest(() => ({
      growthState: async () => [ratchets.prev, ratchets.current, ratchets.next ?? 0n, chainLevel, true, 0],
      prizePoolTargetView: async () => {
        if (poolTarget == null) throw new Error('no target reader');
        return poolTarget;
      },
      purchaseInfo: async () => [chainLevel, jackpotPhase, false, false, 1n],
      jackpotPhase: async () => jackpotPhase,
      jackpotCompressionTier: async () => compressedFlag,
    }));
  } else {
    pari.__setGameFactoryForTest(() => ({
      growthState: async () => { throw new Error('no reader'); },
      prizePoolTargetView: async () => {
        if (poolTarget == null) throw new Error('no target reader');
        return poolTarget;
      },
      purchaseInfo: async () => [chainLevel, jackpotPhase, false, false, 1n],
      jackpotPhase: async () => jackpotPhase,
      jackpotCompressionTier: async () => compressedFlag,
    }));
  }
  return fake;
}

function makeFakeProvider() {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => TEST_ADDR }),
    getBlockNumber: async () => 5_000,
  };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 30));
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function mount() {
  await import('../app-parimutuel-panel.js');
  const Ctor = customElements.get('app-parimutuel-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  await flush();
  return el;
}

async function mountWwxrp() {
  const Ctor = customElements.get('app-wwxrp-burn');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  await flush();
  return el;
}

function panelOf(el) { return el.querySelector('.app-parimutuel'); }
function growthCard(el) { return el.querySelector('[data-bind="pari-growth"]'); }
function decimatorCard(el) { return el.querySelector('[data-bind="pari-decimator"]'); }

const revealMod = await import('../reveal-overlay.js');
const { thermometerScale, decimatorWindowIsOpen } = await import('../app-parimutuel-panel.js');
const wwxrpWidget = await import('../app-wwxrp-burn.js');
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const PARI_SOURCE = readFileSync(new URL('../app-parimutuel-panel.js', import.meta.url), 'utf8');
const DAILY_FLIP_SOURCE = readFileSync(new URL('../app-daily-flip.js', import.meta.url), 'utf8');
const WWXRP_SOURCE = readFileSync(new URL('../app-wwxrp-burn.js', import.meta.url), 'utf8');

test('thermometer color scale is target-anchored and becomes solid green after crossing', () => {
  const below = thermometerScale(50n, 100n);
  assert.equal(below.fillPercent, 40);
  assert.equal(below.linePercent, 80);
  assert.equal(below.gradientSpanPercent, 200,
    'the green endpoint is stretched from the current fill out to the target marker');
  assert.equal(below.crossed, false);

  const atTarget = thermometerScale(100n, 100n);
  assert.equal(atTarget.gradientSpanPercent, 100);
  assert.equal(atTarget.crossed, false);
  assert.equal(thermometerScale(101n, 100n).crossed, true);
  assert.match(
    APP_CSS,
    /\.pari-thermometer--over \.pari-thermometer__fill\s*\{[^}]*background:\s*#22c55e/s,
    'crossed thermometer uses one solid green fill',
  );
});

test('Decimator window accepts indexed shapes and the deterministic milestone fallback', () => {
  assert.equal(decimatorWindowIsOpen({ level: 42, decWindowOpen: true }), true);
  assert.equal(decimatorWindowIsOpen({ level: 42, decimator: { windowOpen: true } }), true);
  assert.equal(decimatorWindowIsOpen({ level: 42 }, { roundStatus: 'open' }), true);
  assert.equal(decimatorWindowIsOpen({ level: 24, decWindowOpen: false }), true,
    'an x4 window stays visible when the indexed latch lags the transition');
  assert.equal(decimatorWindowIsOpen({ level: 99, decWindowOpen: false }), true);
  assert.equal(decimatorWindowIsOpen({ level: 94, decWindowOpen: false }), false);
  assert.equal(decimatorWindowIsOpen({ level: 25, decWindowOpen: false }), false);
});

test('WWXRP footer keeps decimal parsing exact and compacts large balances', () => {
  assert.equal(wwxrpWidget.parseWwxrpAmount('25'), 25n * FLIP);
  assert.equal(wwxrpWidget.parseWwxrpAmount('25.125'), 25_125n * (10n ** 15n));
  assert.equal(wwxrpWidget.parseWwxrpAmount('25.1234567890123456789'), null);
  assert.equal(wwxrpWidget.formatWwxrpBalance(999n * FLIP), '999');
  assert.equal(wwxrpWidget.formatWwxrpBalance(12_345n * FLIP), '12.3K');
  assert.equal(wwxrpWidget.formatWwxrpBalance(999_999n * FLIP), '1M');
});

// ---------------------------------------------------------------------------

describe('app-parimutuel-panel', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    pendingActionsMod.__resetPendingActionsForTest();
    revealMod.__resetForTest();
    localStorage.clear();
    storeMod.update('connected.address', TEST_ADDR);
    storeMod.update('ui.mode', 'self');
    storeMod.update('ui.chainOk', true);
    contractsMod.setProvider(makeFakeProvider());
    _gameState = { level: LEVEL, phase: 'JACKPOT', decWindowOpen: false };
    _decimatorPosition = null;
    _docBody = makeFakeElement('body');
    _docListeners.clear();
    globalThis.document.body = _docBody;
    globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
    globalThis.fetch = indexedFetch;
  });

  afterEach(() => {
    for (const child of _docBody.children || []) child.disconnectedCallback?.();
    wwxrpWidget.__resetWwxrpBurnWidgetDepsForTest();
    pari.__resetContractFactoryForTest();
    pari.__resetQuestFactoryForTest();
    decimatorMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('keeps only the compact Incinerator row when no live book is open', async () => {
    installContract({ growth: { [LEVEL]: { openRound: 0 } } });
    const el = await mount();
    assert.doesNotMatch(el.innerHTML, /SIDE BETS|panel-header|pari-learn-link/,
      'the compact wager rail does not spend a lane on a redundant heading');
    assert.equal(el.querySelector('[data-bind="pari-bounty-strip"]'), null,
      'Side Bets has no bounty strip');
    assert.doesNotMatch(PARI_SOURCE, /readBiggestFlipRecord|pari-record-strip|pari-bounty-strip/,
      'Side Bets neither renders nor reads the removed record and bounty strip');
    assert.doesNotMatch(APP_CSS, /\.pari-record-strip/,
      'the removed strip leaves no dead styling behind');
    assert.doesNotMatch(DAILY_FLIP_SOURCE, /record-strip|readBiggestFlipRecord/,
      'the record rail no longer consumes space in the daily coinflip');
    assert.match(PARI_SOURCE,
      /<div class="pari-error"[\s\S]*?<app-wwxrp-burn><\/app-wwxrp-burn>/,
      'WWXRP is mounted after the book and error surfaces at the bottom of Side Bets');
    assert.match(WWXRP_SOURCE,
      /readFlipWidgetBalances[\s\S]*MIN_WWXRP_BURN_WEI[\s\S]*burnWwxrp/,
      'the footer owns the authoritative balance read, minimum, and burn write path');
    assert.match(APP_CSS,
      /\.side-bets-rail \.app-parimutuel\s*\{[^}]*grid-template-columns:\s*minmax\(19rem, 1\.55fr\) minmax\(10rem, 0\.65fr\)/s,
      'the live Growth book and Incinerator share the full desktop row');
    assert.match(APP_CSS,
      /\.side-bets-rail \.app-parimutuel:not\(\.has-live-book\) > app-wwxrp-burn\s*\{[^}]*grid-column:\s*1 \/ -1/s,
      'the Incinerator reclaims the book lane when Growth is closed');
    assert.match(APP_CSS,
      /\.side-bets-rail \.app-parimutuel:not\(\.has-live-book\)\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent/s,
      'an Incinerator-only row drops the redundant amber market shell');
    assert.match(APP_CSS,
      /\.side-bets-rail \.app-parimutuel:not\(\.has-live-book\) > app-wwxrp-burn\s*\{[^}]*width:\s*min\(100%, 30\.7rem\)/s,
      'the Incinerate key aligns with the burn key in the utility rail below');
    assert.match(APP_CSS,
      /\.side-bets-rail \.pari-book--open\s*\{[^}]*grid-template-areas:[^}]*"head head"[^}]*"context today"/s,
      'the open Growth header stays readable above side-by-side context and actions');
    assert.equal(panelOf(el).hidden, false, 'permanent full-width rail remains mounted');
    assert.equal(growthCard(el).hidden, true);
    assert.equal(el.querySelector('[data-bind="pari-books"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="pari-empty"]'), null);
    assert.doesNotMatch(PARI_SOURCE, /Books are closed|pari-empty/,
      'closed books leave no placeholder copy or dead box behind');
  });

  test('restored WWXRP wrapper shows the viewed balance and burns from self view', async () => {
    let burned = null;
    wwxrpWidget.__setWwxrpBurnWidgetDepsForTest({
      balances: async () => ({ wwxrpBalance: 12_345n * FLIP }),
      burn: async ({ amount }) => {
        burned = amount;
        return { receipt: { status: 1 } };
      },
    });

    const el = await mountWwxrp();
    assert.equal(el.hidden, false);
    assert.match(WWXRP_SOURCE, /<small>DAILY INCINERATOR<\/small>/);
    assert.doesNotMatch(WWXRP_SOURCE, /<small>DAILY DRAW<\/small>/);
    assert.match(WWXRP_SOURCE,
      /aria-label="WWXRP balance and Daily Incinerator entry"/);
    assert.equal(el.querySelector('[data-bind="wwxrp-balance"]').textContent, '12.3K');
    const open = el.querySelector('[data-bind="wwxrp-open"]');
    assert.equal(el.querySelector('[data-bind="wwxrp-open-label"]').textContent, 'BURN');
    assert.equal(open.disabled, false);
    open.click();

    const dialog = el.querySelector('[data-bind="wwxrp-dialog"]');
    const input = el.querySelector('[data-bind="wwxrp-amount"]');
    const accept = el.querySelector('[data-bind="wwxrp-accept"]');
    assert.equal(dialog.hidden, false);
    assert.match(WWXRP_SOURCE, /Incinerate WWXRP for a weighted entry in today’s Daily Incinerator/);
    assert.equal(input.value, '25');
    assert.equal(accept.disabled, false);

    input.value = '24';
    input.dispatchEvent({ type: 'input' });
    assert.equal(accept.disabled, true, 'the on-chain 25 WWXRP minimum is enforced in the dialog');
    input.value = '25';
    input.dispatchEvent({ type: 'input' });
    accept.click();
    await flush();

    assert.equal(burned, 25n * FLIP);
    assert.equal(dialog.hidden, true);
    assert.match(el.querySelector('[data-bind="wwxrp-feedback"]').textContent, /WWXRP INCINERATED/);
    assert.match(APP_CSS,
      /\.pari-wwxrp\s*\{[^}]*min-height:\s*3\.15rem[^}]*grid-template-columns:\s*2\.55rem minmax\(0, 1fr\) 5\.3rem/s,
      'the Incinerator uses the same compact rail rhythm as the utility strip below');
    assert.match(APP_CSS,
      /\.pari-wwxrp__burn\[data-write\]\s*\{[^}]*width:\s*5\.3rem[^}]*min-height:\s*2\.55rem/s,
      'the action is a full-height rail key instead of the old tiny pill');
    assert.match(APP_CSS,
      /\.pari-wwxrp__burn\[data-write\]\s*\{[^}]*grid-template-columns:\s*1\.34rem auto;[^}]*padding:\s*0\.32rem 0\.72rem 0\.32rem 0\.48rem;[^}]*font:\s*950 0\.66rem\/1/s,
      'the WWXRP action shares the exact proportions and type hierarchy of the sDGNRS burn key');
    assert.match(WWXRP_SOURCE,
      /data-bind="wwxrp-open-label">BURN<\/b>/,
      'the WWXRP action keeps its BURN label in a stable child during refreshes');
    assert.match(APP_CSS,
      /\.pari-wwxrp__burn\[data-write\]::before\s*\{[^}]*width:\s*1\.34rem;[^}]*height:\s*1\.72rem;[^}]*flame-center-silver\.svg[^}]*border-right:/s,
      'the CSS-owned flame compartment matches the sDGNRS key and cannot be erased by a label refresh');
  });

  test('WWXRP clears the previous wallet balance synchronously when view scope changes', async () => {
    const viewed = '0xcd34000000000000000000000000000000000000';
    let resolveViewed;
    wwxrpWidget.__setWwxrpBurnWidgetDepsForTest({
      balances: async ({ player }) => {
        if (String(player).toLowerCase() === TEST_ADDR) {
          return { wwxrpBalance: 250n * FLIP };
        }
        return new Promise((resolve) => { resolveViewed = resolve; });
      },
    });

    const el = await mountWwxrp();
    const balance = el.querySelector('[data-bind="wwxrp-balance"]');
    assert.equal(balance.textContent, '250');

    storeMod.update('viewing.address', viewed);
    assert.equal(balance.textContent, '—',
      'the old wallet amount is invalidated before the replacement read settles');
    assert.equal(el.querySelector('[data-bind="wwxrp-open"]').disabled, true);

    await Promise.resolve();
    resolveViewed({ wwxrpBalance: 0n });
    await flush();
    assert.equal(balance.textContent, '0');
  });

  test('uses the chain level when the indexed game snapshot disagrees', async () => {
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      ratchets: { prev: 80n * RAW_ETH, current: 92n * RAW_ETH },
      chainLevel: LEVEL - 1,
      poolTarget: 123n * FLIP,
    });
    const el = await mount();
    assert.equal(storeMod.get('app.poolBenchmarks')?.level, LEVEL - 1,
      'purchaseInfo is authoritative; stale indexed state cannot relabel the live round');
    assert.equal(storeMod.get('app.poolBenchmarks')?.targetWei, String(123n * FLIP));
    el.disconnectedCallback();
  });

  test('a stale openRound pointer does not render an empty GROWTH heading when its row cannot be read', async () => {
    const staleOpenRound = LEVEL + 8;
    installContract({
      growth: {
        [LEVEL]: { openRound: staleOpenRound },
        [LEVEL - 1]: { openRound: staleOpenRound },
        [LEVEL - 2]: { openRound: staleOpenRound },
      },
      growthReadErrors: [staleOpenRound, staleOpenRound - 1],
    });
    const el = await mount();
    assert.equal(growthCard(el).hidden, true,
      'a pointer without its authoritative market row stays out of the UI');
    assert.doesNotMatch(el.textContent, /GROWTH BET · Level/,
      'no orphaned level heading is painted');
    assert.equal(el.querySelector('[data-bind="pari-books"]').hidden, true);
    el.disconnectedCallback();
  });

  test('Volume Bet is removed from the rendered, pending, and runtime component paths', async () => {
    installContract({ growth: { [LEVEL]: { openRound: 0 } } });
    const el = await mount();

    assert.equal(el.querySelector('[data-bind="pari-volume"]'), null);
    assert.doesNotMatch(el.textContent, /VOLUME BET/);
    assert.equal(el.querySelector('[data-bind="pari-books"]').hidden, true,
      'an obsolete contract fixture cannot make the removed book visible');
    assert.equal(
      pendingActionsMod.getPendingActions().some((item) => /volume/i.test(item.id || item.kind)),
      false,
    );
    assert.doesNotMatch(PARI_SOURCE, /volume/i,
      'the component no longer imports, reads, writes, renders, or claims the removed book');
    el.disconnectedCallback();
  });

  test('an open Decimator window renders an indexed entry card and burns the entered FLIP', async () => {
    _gameState = {
      level: LEVEL,
      phase: 'JACKPOT',
      decWindowOpen: true,
      prizePools: { futurePrizePool: '1250000000000' },
    };
    _decimatorPosition = {
      level: LEVEL + 1,
      player: TEST_ADDR,
      bucket: 7,
      subbucket: 3,
      effectiveAmount: String(2_500n * FLIP),
      weightedAmount: String((2_500n * FLIP) / 7n),
      winningSubbucket: null,
      payoutAmount: '0',
      roundStatus: 'open',
    };
    const calls = [];
    const burn = Object.assign(
      async (...args) => {
        calls.push(['send', ...args]);
        return { hash: '0xdec', wait: async () => ({ status: 1, logs: [] }) };
      },
      { staticCall: async (...args) => { calls.push(['static', ...args]); } },
    );
    decimatorMod.__setContractFactoryForTest(() => ({
      decimatorBurn: burn,
      connect() { return this; },
    }));
    decimatorMod.__setDecimatorContextReaderForTest(async () => ({
      activityScore: 235,
      dayOneActive: true,
      lastPurchaseDay: true,
      futurePoolWei: 1_250_000_000_000n,
      totalBurnWeight: 2_500n * FLIP,
      totalRoundScore: 15_150_625n * FLIP,
    }));
    installContract({ growth: { [LEVEL]: { openRound: 0 } } });

    const el = await mount();
    const card = decimatorCard(el);
    assert.equal(card.hidden, false);
    assert.equal(card.querySelector('.pari-book__title').textContent, 'DECIMATOR');
    assert.equal(card.querySelector('.pari-decimator__win-prompt').textContent, 'BURN FLIP TO WIN:');
    assert.equal(card.querySelector('.pari-decimator__win-prompt-burn').textContent, 'BURN FLIP');
    assert.equal(card.querySelector('.pari-decimator__win-prompt-win').textContent, ' TO WIN:');
    assert.equal(card.querySelector('.pari-decimator__prize').textContent, '0.125ETH');
    const degenScore = card.querySelector('.pari-decimator__degen-score');
    assert.equal(degenScore.textContent, '235%');
    assert.equal(degenScore.getAttribute('data-score-tier'), 'purple');
    const multiplierValue = card.querySelector('.pari-decimator__multiplier-value');
    assert.equal(multiplierValue.textContent, '184%');
    assert.equal(multiplierValue.getAttribute('data-score-tier'), 'purple');
    assert.equal(card.querySelector('.pari-decimator__multiplier-label').textContent, 'MULTI');
    assert.match(card.textContent, /235%DEGEN=184%MULTI/);
    assert.doesNotMatch(card.textContent, /DEGEN RATING/);
    assert.match(APP_CSS,
      /\.pari-decimator__head-copy\s*\{[^}]*flex-direction:\s*column;[^}]*justify-content:\s*space-between/s,
      'the title and win prompt form one compact two-line lead-in beside the payout');
    assert.match(APP_CSS,
      /\.pari-decimator__win-prompt\s*\{[^}]*align-self:\s*center;[^}]*text-align:\s*center/s,
      'the Decimator warning is centered instead of hanging against the right edge');
    assert.match(APP_CSS, /\.pari-decimator__win-prompt-burn\s*\{[^}]*#f87171/);
    assert.match(APP_CSS, /\.pari-decimator__win-prompt-win\s*\{[^}]*#86efac/);
    assert.doesNotMatch(card.textContent, /Burn FLIP to enter\./);
    assert.match(card.textContent, /YOUR SCORE2,500/);
    assert.match(card.textContent, /ALL PLAYERS SCORE15,150,625/);
    assert.equal(
      card.querySelector('[data-bind="pari-decimator-quote"]').textContent,
      '+1,841 SCORE',
    );
    assert.match(PARI_SOURCE, /\+\$\{_fmtFlip\(boonScore\)\} BOON/,
      'the legacy fallback also names the concrete score added by a boon');
    assert.doesNotMatch(card.textContent, /ACTIVITY|DAY 1|LAST DAY|TOTAL BURN WEIGHT/);
    assert.doesNotMatch(card.textContent, /Level 43|BURN WINDOW OPEN|Minimum 1,000|Bucket 7/);

    const input = card.querySelector('[data-bind="pari-decimator-input"]');
    assert.equal(input.value, '1000');
    const up = card.querySelector('[data-bind="pari-decimator-up"]');
    const down = card.querySelector('[data-bind="pari-decimator-down"]');
    assert.ok(up && down, 'the amount uses a dedicated two-part stepper');
    assert.equal(up.getAttribute('aria-label'), 'Increase Decimator entry by 1,000 FLIP');
    assert.equal(down.getAttribute('aria-label'), 'Decrease Decimator entry by 1,000 FLIP');
    up.click();
    assert.equal(input.value, '2000');
    assert.equal(
      card.querySelector('[data-bind="pari-decimator-quote"]').textContent,
      '+3,682 SCORE',
    );
    down.click();
    assert.equal(input.value, '1000');
    down.click();
    assert.equal(input.value, '1000', 'the down control clamps at the 1,000 FLIP minimum');
    input.value = '3000';
    input.dispatchEvent({ type: 'input' });
    assert.equal(
      card.querySelector('[data-bind="pari-decimator-quote"]').textContent,
      '+5,523 SCORE',
    );
    assert.equal(card.querySelector('.pari-decimator__cta-action').textContent, 'BURN FOR');
    assert.match(APP_CSS,
      /\.pari-decimator__entry\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
      'the FLIP entry control and Decimator action use equal-width columns');
    assert.match(APP_CSS,
      /\.pari-decimator__cta\s*\{[^}]*flex-direction:\s*column/s,
      'the Decimator CTA stacks its action and score on two lines');
    assert.match(APP_CSS,
      /\.pari-decimator__input-wrap input::-(?:webkit-inner-spin-button|webkit-outer-spin-button)[\s\S]*?appearance:\s*none/s,
      'native number arrows stay hidden behind the deliberate 1,000-FLIP rocker');
    card.querySelector('[data-bind="pari-decimator-cta"]').click();
    await flush();

    assert.deepEqual(calls, [
      ['static', TEST_ADDR, 3_000n * FLIP],
      ['send', TEST_ADDR, 3_000n * FLIP],
    ]);
    el.disconnectedCallback();
  });

  test('the active x4 Decimator round renders even while the indexed latch is stale', async () => {
    _gameState = {
      level: 24,
      phase: 'PURCHASE',
      decWindowOpen: false,
      prizePools: { futurePrizePool: '1250000000000' },
    };
    installContract({ growth: { 24: { openRound: 0 } }, chainLevel: 24 });

    const el = await mount();
    const card = decimatorCard(el);
    assert.equal(card.hidden, false);
    assert.equal(card.querySelector('.pari-book__title').textContent, 'DECIMATOR');
    el.disconnectedCallback();
  });

  test('a Decimator quest click presets safely and its confirmed action enters the exact amount', async () => {
    _gameState = { level: LEVEL, phase: 'JACKPOT', decWindowOpen: true };
    const calls = [];
    const burn = Object.assign(
      async (...args) => {
        calls.push(['send', ...args]);
        return { hash: '0xdec-quest', wait: async () => ({ status: 1, logs: [] }) };
      },
      { staticCall: async (...args) => { calls.push(['static', ...args]); } },
    );
    decimatorMod.__setContractFactoryForTest(() => ({
      decimatorBurn: burn,
      connect() { return this; },
    }));
    installContract({ growth: { [LEVEL]: { openRound: 0 } } });
    const el = await mount();

    document.dispatchEvent({
      type: 'quest:activate',
      detail: { questType: 5, target: String(2_000n * FLIP), variant: 'secondary' },
    });
    assert.equal(
      decimatorCard(el).querySelector('[data-bind="pari-decimator-input"]').value,
      '2000',
    );
    assert.deepEqual(calls, [], 'opening/configuring a quest alone never burns FLIP');

    document.dispatchEvent({
      type: 'quest:activate',
      detail: {
        questType: 5,
        target: String(3_000n * FLIP),
        variant: 'secondary',
        submit: true,
      },
    });
    await flush();
    assert.deepEqual(calls, [
      ['static', TEST_ADDR, 3_000n * FLIP],
      ['send', TEST_ADDR, 3_000n * FLIP],
    ]);
    el.disconnectedCallback();
  });

  test('an open growth book renders the round, the book and both bet buttons', async () => {
    installContract({ growth: { [LEVEL]: { openRound: LEVEL, over: 3n, under: 1n } } });
    const el = await mount();
    assert.equal(panelOf(el).hidden, false);

    const card = growthCard(el);
    assert.equal(card.hidden, false);
    assert.match(card.querySelector('.pari-book__title').textContent, /GROWTH BET · Level 42/);
    assert.equal(card.querySelector('.pari-book__ask'), null,
      'the live book does not repeat the wager as a question');
    assert.equal(card.querySelector('.pari-today__label'), null,
      'the redundant THIS LEVEL eyebrow is omitted from growth');
    assert.match(
      APP_CSS,
      /\.pari-today\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
      'OVER / UNDER receive the full card width',
    );
    assert.equal(card.querySelector('.pari-thermometer'), null,
      'growth bets do not show the volume-only progress thermometer');

    assert.equal(card.querySelectorAll('.pari-side__count').length, 0,
      'OVER/UNDER controls do not repeat the raw bet counts');

    // No payout quote or repeated stake: the split and exact placement bonus
    // are the only live secondary information.
    assert.equal(card.querySelectorAll('.pari-side__pays').length, 0, 'no payout quote');
    const bar = card.querySelector('.pari-split');
    assert.ok(bar, 'split bar rendered');
    assert.equal(bar.querySelector('.pari-split__over').style.width, '75%');
    assert.equal(bar.querySelector('.pari-split__under').style.width, '25%');

    const actions = card.querySelectorAll('.pari-side__action').map((n) => n.textContent);
    assert.deepEqual(actions, ['UNDER', 'OVER']);
    assert.equal(card.querySelectorAll('.pari-side__stake').length, 0,
      'fixed 1,000 FLIP stake is not repeated in the choices');
    assert.deepEqual(
      card.querySelectorAll('.pari-split__label').map((n) => n.textContent),
      ['75%', '25%'],
      'the split percentages appear once beside the bar',
    );
    assert.equal(card.querySelector('.pari-prebet-bonus').textContent,
      'BET: 1,000 FLIP\u00a0\u00a0\u00a0BONUS: +150 FLIP · +1 STREAK',
      'the fixed bet and complete contract-quoted growth reward are visible before betting');
    assert.match(
      APP_CSS,
      /\.pari-prebet-bonus\s*\{[^}]*justify-content:\s*center[^}]*font-size:\s*0\.55rem/s,
      'the reward remains a compact line rather than another card');
  });

  test('an allowed player who cannot earn the growth reward sees no bet bonus', async () => {
    installContract({
      growth: { [LEVEL]: { openRound: LEVEL, over: 3n, under: 1n } },
      marketGate: { mayBet: true, earnsReward: false },
    });
    const el = await mount();
    const card = growthCard(el);
    assert.deepEqual(
      card.querySelectorAll('.pari-side__action').map((node) => node.textContent),
      ['UNDER', 'OVER'],
      'the weaker mayBet gate still permits the choices',
    );
    assert.equal(card.querySelector('.pari-prebet-bonus'), null,
      'the global reward quote is not advertised to an ineligible wallet');
    el.disconnectedCallback();
  });

  test('an open held growth position becomes one your-bet line above the live split', async () => {
    installContract({
      growth: { [LEVEL]: { openRound: LEVEL, over: 3n, under: 1n, side: 1 } },
      ratchets: { prev: 80n * RAW_ETH, current: 92n * RAW_ETH },
    });
    const el = await mount();
    const card = growthCard(el);
    assert.equal(card.querySelectorAll('.pari-side__cta').length, 0, 'no second bet offered');
    assert.equal(card.querySelectorAll('.pari-side').length, 0,
      'the empty opposing cell is removed after committing');
    assert.equal(card.querySelector('.pari-your-bet').textContent, 'YOUR BET:OVER 106 ETH',
      'a held OVER line rounds up against the player without changing the live quote');
    assert.deepEqual(
      card.querySelectorAll('.pari-split__label').map((n) => n.textContent),
      ['75%', '25%'],
    );
    assert.equal(card.querySelector('.pari-book__foot'), null);
    assert.equal(card.querySelector('.pari-prebet-bonus'), null,
      'the placement bonus disappears after the position is held');
    assert.equal(card.querySelectorAll('.pari-result--pending').length, 0,
      '"To win" stays hidden while this bet is still open');
    const [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.id, `pari:growth:${LEVEL}`);
    assert.equal(pending.state, 'waiting');
    assert.equal(pending.run, null, 'an unsettled position is informational');
  });

  test('a held growth UNDER position rounds its receipt down against the player', async () => {
    installContract({
      growth: { [LEVEL]: { openRound: LEVEL, over: 1n, under: 3n, side: 2 } },
      ratchets: { prev: 80n * RAW_ETH, current: 92n * RAW_ETH },
    });
    const el = await mount();
    assert.equal(growthCard(el).querySelector('.pari-your-bet').textContent,
      'YOUR BET:UNDER 105 ETH');
    assert.deepEqual(
      growthCard(el).querySelectorAll('.pari-split__label').map((node) => node.textContent),
      ['25%', '75%'],
      'only the held receipt rounds; the exact live book split is unchanged',
    );
    el.disconnectedCallback();
  });

  test('"To win" appears only after the player’s bet has closed', async () => {
    _gameState = {
      level: LEVEL,
      phase: 'PURCHASE',
      decWindowOpen: false,
      prizePools: { nextPrizePool: String(100n * FLIP) },
    };
    installContract({
      growth: {
        [LEVEL]: { openRound: 0 },
        [LEVEL - 1]: {
          side: 1,
          outcome: 0,
          payout: 0n,
          over: 2n,
          under: 3n,
        },
      },
      ratchets: { prev: 80n * RAW_ETH, current: 92n * RAW_ETH },
    });
    const el = await mount();
    const card = growthCard(el);
    const held = card.querySelector('.pari-your-bet--closed');
    assert.ok(held, 'closed unresolved bet gets a compact held-position receipt');
    assert.match(held.textContent, /YOUR BET:OVER 106 ETHTO WIN: 2,500 FLIP/);
    assert.equal(held.querySelector('.pari-your-bet__divider'), null,
      'the compact receipt has no decorative slash');
    assert.match(held.textContent, /2,500 FLIP/,
      'closed row shows the current per-winner result');
    assert.equal(card.querySelector('.pari-split'), null,
      'the closed book no longer shows the bettor split');
    assert.ok(card.querySelector('.pari-thermometer'),
      'ticket purchases now drive the growth thermometer after close');
    assert.equal(card.querySelector('.pari-result--pending'), null,
      'the old duplicate pending row is removed');
  });

  test('settled winners publish claims only to the shared bottom row', async () => {
    installContract({
      growth: {
        [LEVEL]: { openRound: 0 },
        [LEVEL - 1]: { side: 1, outcome: 1, payout: 4_000n * FLIP },
        [LEVEL - 2]: { side: 2, outcome: 2, payout: 1_500n * FLIP },
      },
    });
    const el = await mount();
    const card = growthCard(el);
    assert.equal(card.hidden, true,
      'a settled-win-only book does not occupy the SIDE BETS area');
    assert.equal(card.querySelectorAll('.pari-result--win').length, 0,
      'settled history rows do not repeat old level outcomes');
    assert.equal(card.querySelector('.pari-claim-cta'), null,
      'claim controls are absent from the side-bet card');
    const pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.length, 2);
    assert.ok(pending.every((item) => item.state === 'ready' && typeof item.run === 'function'));
    assert.ok(pending.every((item) => item.kind === 'growth-claim'),
      'settled growth payouts are routed into the shared bottom action tray');
    assert.ok(pending.every((item) => item.shortLabel === 'Claim'));
  });

  test('a lost round remains revealable without a verbose history row', async () => {
    installContract({
      growth: {
        [LEVEL]: { openRound: LEVEL, over: 1n, under: 1n },
        [LEVEL - 1]: { side: 1, outcome: 2, payout: 0n },
      },
    });
    const el = await mount();
    const card = growthCard(el);
    assert.equal(card.querySelector('.pari-result--loss'), null,
      'settled loss history is omitted from the compact book');
    const [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.state, 'ready');
    await pending.run();
    const [result] = revealMod.__takeQueuedForTest();
    assert.equal(result.kind, 'pari');
    assert.equal(result.round, LEVEL - 1);
    assert.equal(result.side, 1);
    assert.equal(result.outcome, 2);
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'viewing a loss retires that result from the widget');
  });

  test('closing the overlay puts an unwatched settled loss back on the rail', async () => {
    installContract({
      growth: {
        [LEVEL]: { openRound: LEVEL, over: 1n, under: 1n },
        [LEVEL - 1]: { side: 1, outcome: 2, payout: 0n },
      },
    });
    const el = await mount();
    const [pending] = pendingActionsMod.getPendingActions();
    await pending.run();
    const [result] = revealMod.__takeQueuedForTest();
    assert.deepEqual(result.revealRelease, { address: TEST_ADDR.toLowerCase(), id: `growth:${LEVEL - 1}` },
      'the sequence carries the identity the overlay hands back');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the result is retired while its presentation is staged');

    // The player hits the X before the round ever plays.
    document.dispatchEvent(new CustomEvent(revealMod.RESULT_REVEAL_ABORT_EVENT, {
      detail: {
        released: [{
          kind: 'pari',
          presentationId: result.presentationId,
          release: result.revealRelease,
        }],
      },
    }));
    await flush();

    const [restored] = pendingActionsMod.getPendingActions();
    assert.ok(restored, 'an unwatched result comes back instead of being marked seen forever');
    assert.equal(restored.kind, 'pari');
    assert.equal(restored.state, 'ready');
    el.disconnectedCallback();
  });

  test('a settled loss alone does not leave a ghost growth card behind', async () => {
    installContract({
      growth: {
        [LEVEL]: { openRound: 0 },
        [LEVEL - 1]: { side: 1, outcome: 2, payout: 0n },
      },
    });
    const el = await mount();

    assert.equal(growthCard(el).hidden, true,
      'the shared result rail owns settled losses once the live book is closed');
    assert.equal(el.querySelector('[data-bind="pari-books"]').hidden, true,
      'an unseen result stays in Pending without leaving an empty book lane');
    const [pending] = pendingActionsMod.getPendingActions();
    assert.equal(pending.state, 'ready');
    assert.equal(pending.kind, 'pari');
    assert.equal(typeof pending.run, 'function',
      'the player can still open the result reveal from the shared rail');
    el.disconnectedCallback();
  });

  test('clicking Bet OVER reaches placeBet(player, true)', async () => {
    const calls = [];
    installContract({ growth: { [LEVEL]: { openRound: LEVEL, over: 1n, under: 2n } }, calls });
    const el = await mount();
    growthCard(el).querySelectorAll('.pari-side__cta')[1].click();
    await flush();
    assert.deepEqual(calls[0], ['placeBet', TEST_ADDR, true]);
  });

  test('an open Growth book accepts a bet while /game/state is still blocked', async () => {
    invalidateJSONCache();
    let releaseDatabase;
    let databaseReads = 0;
    const databaseBlocked = new Promise((resolve) => { releaseDatabase = resolve; });
    globalThis.fetch = async () => {
      databaseReads += 1;
      const data = await databaseBlocked;
      return { ok: true, status: 200, json: async () => data };
    };
    const calls = [];
    installContract({
      growth: { [LEVEL]: { openRound: LEVEL, over: 1n, under: 2n } },
      calls,
    });

    try {
      const el = await mount();
      await flush();
      assert.ok(databaseReads > 0, 'the indexed game read is genuinely pending');
      assert.equal(growthCard(el).hidden, false,
        'purchaseInfo and marketState discover the book without the DB');
      growthCard(el).querySelectorAll('.pari-side__cta')[1].click();
      await flush();
      assert.deepEqual(calls[0], ['placeBet', TEST_ADDR, true],
        'the contract receives the bet before indexed state resolves');
      el.disconnectedCallback();
    } finally {
      releaseDatabase(_gameState);
      globalThis.fetch = indexedFetch;
    }
  });

  test('clicking Claim cranks the clicked winner first plus other discovered winners', async () => {
    const calls = [];
    const other = '0xcd34000000000000000000000000000000000000';
    installContract({
      growth: {
        [LEVEL]: { openRound: 0 },
        [LEVEL - 1]: {
          side: 1, outcome: 1, payout: 1_500n * FLIP, over: 2n, under: 1n,
        },
      },
      growthBettors: [
        { player: TEST_ADDR, over: true },
        { player: '0xee56000000000000000000000000000000000000', over: false },
        { player: other, over: true },
      ],
      calls,
    });
    await mount();
    const claim = pendingActionsMod.getPendingActions().find((item) => item.kind === 'growth-claim');
    assert.ok(claim, 'the claim is available from the bottom action row');
    await claim.run();
    await flush();
    assert.deepEqual(calls[0], ['claimRound', LEVEL - 1, [TEST_ADDR, other]]);
  });

  test('a claim resolved since the last poll only replays; it sends no transaction', async () => {
    const calls = [];
    const growth = {
      [LEVEL]: { openRound: 0 },
      [LEVEL - 1]: {
        side: 1, outcome: 1, payout: 4_000n * FLIP, over: 1n, under: 3n,
      },
    };
    installContract({ growth, calls });
    await mount();

    growth[LEVEL - 1] = {
      side: 1,
      outcome: 1,
      claimed: true,
      payout: 0n,
      over: 1n,
      under: 3n,
    };
    const claim = pendingActionsMod.getPendingActions().find((item) => item.kind === 'growth-claim');
    assert.ok(claim);
    await claim.run();
    await flush();

    assert.deepEqual(calls, [], 'fresh claimed=true state bypasses every write');
    const [replay] = revealMod.__takeQueuedForTest();
    assert.equal(replay.kind, 'pari');
    assert.equal(replay.round, LEVEL - 1);
    assert.equal(replay.payout, 4_000n * FLIP,
      'payout is reconstructed because claimed marketState returns zero');
    assert.equal(pendingActionsMod.getPendingActions().length, 0);
  });

  // Each Growth book shows the number the round has to beat and the percentage
  // of the book on each side. Neither is a payout quote.
  test('the growth book states last level’s realized growth as the bar to clear', async () => {
    installContract({
      growth: {
        [LEVEL]: { openRound: LEVEL, over: 1n, under: 3n },
        [LEVEL - 1]: { outcome: 1 },
      },
      // 80 → 92 ETH of pool = +15%.
      ratchets: { prev: 80n * RAW_ETH, current: 92n * RAW_ETH },
    });
    const el = await mount();
    const bench = growthCard(el).querySelector('.pari-book__bench');
    assert.ok(bench, 'benchmark line rendered');
    assert.equal(bench.textContent, 'Last level: 15% · Target: 105.8 ETH');
    const offered = bench.querySelector('.pari-book__offered');
    assert.equal(offered.textContent, '15%', 'only the offered result is isolated');
    assert.match(offered.className, /pari-book__offered--won/, 'prior OVER win is green');
    assert.doesNotMatch(bench.className, /--won|--lost/, 'surrounding explanation stays neutral');
    assert.deepEqual(
      growthCard(el).querySelectorAll('.pari-side__action').map((n) => n.textContent),
      ['UNDER 105.8 ETH', 'OVER 105.8 ETH'],
      'both growth choices carry the actionable ETH threshold',
    );
  });

  test('a level that shrank keeps its signed result in the compact line', async () => {
    installContract({
      growth: {
        [LEVEL]: { openRound: LEVEL, over: 1n, under: 1n },
        [LEVEL - 1]: { outcome: 2 },
      },
      ratchets: { prev: 100n * RAW_ETH, current: 90n * RAW_ETH },
    });
    const el = await mount();
    const bench = growthCard(el).querySelector('.pari-book__bench');
    assert.equal(bench.textContent, 'Last level: -10% · Target: 81 ETH');
    const offered = bench.querySelector('.pari-book__offered');
    assert.equal(offered.textContent, '-10%');
    assert.match(offered.className, /pari-book__offered--lost/, 'prior UNDER result is red');
  });

  test('an untouched book shows zeroes while keeping an even empty bar', async () => {
    installContract({ growth: { [LEVEL]: { openRound: LEVEL, over: 0n, under: 0n } } });
    const el = await mount();
    const card = growthCard(el);
    assert.deepEqual(
      card.querySelectorAll('.pari-side__action').map((n) => n.textContent),
      ['UNDER', 'OVER'],
    );
    assert.deepEqual(
      card.querySelectorAll('.pari-split__label').map((n) => n.textContent),
      ['0%', '0%'],
    );
    // The bar splits evenly rather than collapsing to nothing.
    assert.equal(card.querySelector('.pari-split__over').style.width, '50%');
    assert.equal(card.querySelector('.pari-split__under').style.width, '50%');
  });

  test('a read-only visitor still sees the book, with no wallet-bound claim', async () => {
    storeMod.update('connected.address', null);
    storeMod.update('ui.mode', 'view');
    contractsMod.clearProvider();
    installContract({
      growth: {
        [LEVEL]: { openRound: LEVEL, over: 2n, under: 2n },
        [LEVEL - 1]: { side: 1, outcome: 1, payout: 4_000n * FLIP },
      },
    });
    const el = await mount();
    const card = growthCard(el);
    assert.equal(panelOf(el).hidden, false);
    assert.equal(card.querySelectorAll('.pari-side').length, 2, 'book is public');
    assert.equal(card.querySelectorAll('.pari-side__count').length, 0,
      'public view also omits raw bet counts');
    assert.equal(card.querySelector('.pari-claim-cta'), null, 'no claim without a wallet');
  });
});
