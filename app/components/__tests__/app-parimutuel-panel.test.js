// /app/components/__tests__/app-parimutuel-panel.test.js — the side-bets widget.
// Run: cd website && node --test app/components/__tests__/app-parimutuel-panel.test.js
//
// Covers the part of the widget that has rules rather than pixels:
//   - it hides itself when neither book is open and nothing is claimable
//   - an open GROWTH book renders the round, the book counts, the payout quotes
//     and two bet buttons
//   - a held position replaces the buttons with the "your bet" marker
//   - a settled winner keeps the panel on screen with a CLAIM for the total
//   - a bet click reaches placeBet(player, over)
//
// The volume book runs off the wall clock (540s of every 600s on the testnet
// overlay), so every test pins it through parimutuel.js's __setClockForTest —
// otherwise these would pass or fail depending on the minute they ran.
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
import { VOLUME_WINDOW } from '../../app/chain-config.js';

const TEST_ADDR = '0xab12000000000000000000000000000000000000';
const LEVEL = 42;
const FLIP = 10n ** 18n;
// Base Sepolia stores native amounts at /1M scale; displayEth restores that
// factor. Keep pool fixtures in raw contract units so ETH labels are realistic.
const RAW_ETH = 10n ** 12n;

// Day 100 of this deploy. Day indices are deploy-relative (GameTimeLib:34), so
// the boundary has to be in the timestamp or the derived round comes out
// epoch-scale. CLOSED_AT sits one second past the window's close (growth is then
// the only thing that can make the panel visible); OPEN_AT sits inside it.
const DAY_100 = VOLUME_WINDOW.anchor + VOLUME_WINDOW.period * (VOLUME_WINDOW.deployDayBoundary + 99);
const CLOSED_AT = DAY_100 + VOLUME_WINDOW.openSeconds;
const OPEN_AT = DAY_100 + 1;
const IMMINENT_AT = DAY_100 + VOLUME_WINDOW.period - 1;
const VOLUME_ROUND = 101;   // day index 100 → the window bets into round 101

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
globalThis.fetch = async (url) => {
  if (/\/game\/state$/.test(String(url))) {
    return { ok: true, status: 200, json: async () => _gameState };
  }
  if (/\/player\/0x[0-9a-f]+\/decimator\?level=\d+$/i.test(String(url)) && _decimatorPosition) {
    return { ok: true, status: 200, json: async () => _decimatorPosition };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

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
  volume = {},
  seals = {},
  ratchets = null,
  calls,
  growthBettors = [],
  volumeBettors = [],
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
    volumeMarketState: async (_player, round) => {
      const r = { openRound: 0, over: 0n, under: 0n, side: 0, claimed: false, outcome: 0, voided: false, payout: 0n, ...(volume[Number(round)] || {}) };
      return [r.openRound, r.over, r.under, r.side, r.claimed, r.outcome, r.voided, r.payout];
    },
    volumeBetCredit: async () => 25n * FLIP,
    placeBet: Object.assign(
      async (...args) => { calls?.push(['placeBet', ...args]); return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) }; },
      { staticCall: async () => undefined },
    ),
    placeVolumeBet: Object.assign(
      async (...args) => { calls?.push(['placeVolumeBet', ...args]); return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) }; },
      { staticCall: async () => undefined },
    ),
    claim: Object.assign(
      async (...args) => { calls?.push(['claim', ...args]); return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) }; },
      { staticCall: async () => undefined },
    ),
    claimVolume: Object.assign(
      async (...args) => { calls?.push(['claimVolume', ...args]); return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) }; },
      { staticCall: async () => undefined },
    ),
    claimRound: Object.assign(
      async (...args) => { calls?.push(['claimRound', ...args]); return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) }; },
      { staticCall: async () => undefined },
    ),
    claimVolumeRound: Object.assign(
      async (...args) => { calls?.push(['claimVolumeRound', ...args]); return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) }; },
      { staticCall: async () => undefined },
    ),
    // The sealed-round log query behind "last round bought N tickets".
    // The backward chunk scan takes the newest seal in range, whatever its round.
    filters: {
      VolumeRoundSealed: () => ({ event: 'seal' }),
      BetPlaced: (_player, round) => ({ event: 'growth', round }),
      VolumeBetPlaced: (_player, round) => ({ event: 'volume', round }),
    },
    queryFilter: async (filter) => {
      if (filter?.event === 'growth') {
        return growthBettors.map((row) => ({
          args: { player: row.player, round: filter.round, over: row.over },
        }));
      }
      if (filter?.event === 'volume') {
        return volumeBettors.map((row) => ({
          args: { player: row.player, round: filter.round, over: row.over },
        }));
      }
      return Object.entries(seals)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([round, row]) => ({ args: { round: Number(round), total: row.total, previous: row.previous } }));
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
    // The seal scan walks back from the head in under-RPC-cap chunks.
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

function panelOf(el) { return el.querySelector('.app-parimutuel'); }
function growthCard(el) { return el.querySelector('[data-bind="pari-growth"]'); }
function decimatorCard(el) { return el.querySelector('[data-bind="pari-decimator"]'); }

const revealMod = await import('../reveal-overlay.js');
const { thermometerScale, decimatorWindowIsOpen } = await import('../app-parimutuel-panel.js');
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

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
    pari.__setClockForTest(() => CLOSED_AT);
    _gameState = { level: LEVEL, phase: 'JACKPOT', decWindowOpen: false };
    _decimatorPosition = null;
    _docBody = makeFakeElement('body');
    _docListeners.clear();
    globalThis.document.body = _docBody;
    globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  });

  afterEach(() => {
    for (const child of _docBody.children || []) child.disconnectedCallback?.();
    pari.__resetContractFactoryForTest();
    pari.__resetQuestFactoryForTest();
    pari.__resetClockForTest();
    decimatorMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('keeps its grid column with a closed-window message when neither book is open', async () => {
    installContract({ growth: { [LEVEL]: { openRound: 0 } } });
    const el = await mount();
    assert.match(el.innerHTML,
      /<h2><a class="pari-learn-link" href="\/learn\/side-bets\/">SIDE BETS<\/a><\/h2>/,
      'the Side Bets heading links directly to its Learn page');
    assert.match(APP_CSS,
      /\.app-parimutuel > \.panel-header\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*place-items:\s*center/s,
      'the Side Bets heading is centered at every viewport width');
    assert.equal(panelOf(el).hidden, false, 'permanent right-column panel remains mounted');
    assert.equal(growthCard(el).hidden, true);
    const empty = el.querySelector('[data-bind="pari-empty"]');
    assert.equal(empty.hidden, false);
    assert.match(empty.textContent, /Books are closed|No side-bet book/i);
  });

  test('does not publish a prize-pool target while the API and RPC disagree on level', async () => {
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      ratchets: { prev: 80n * RAW_ETH, current: 92n * RAW_ETH },
      chainLevel: LEVEL - 1,
      poolTarget: 123n * FLIP,
    });
    const el = await mount();
    assert.equal(storeMod.get('app.poolBenchmarks'), undefined,
      'a target with no level in its ABI is withheld until both data sources agree');
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
    assert.equal(el.querySelector('[data-bind="pari-empty"]').hidden, false);
    el.disconnectedCallback();
  });

  test('an imminent volume round stays hidden when there is no open book or player position', async () => {
    pari.__setClockForTest(() => IMMINENT_AT);
    installContract({ growth: { [LEVEL]: { openRound: 0 } } });
    const el = await mount();

    const volume = el.querySelector('[data-bind="pari-volume"]');
    assert.equal(volume.hidden, true,
      'a countdown alone does not render a VOLUME BET card');
    assert.equal(el.querySelector('[data-bind="pari-empty"]').hidden, false,
      'the compact closed-books state remains instead of a blank panel');
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
    assert.equal(card.querySelector('.pari-decimator__prize').textContent, '0.125ETH');
    assert.match(card.textContent, /Burn FLIP to enter\./);
    assert.match(card.textContent, /CURRENT SCORE2,500/);
    assert.match(card.textContent, /TOTAL SCORE15,150,625/);
    assert.equal(
      card.querySelector('[data-bind="pari-decimator-quote"]').textContent,
      'FOR 1,841 SCORE',
    );
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
      'FOR 3,682 SCORE',
    );
    down.click();
    assert.equal(input.value, '1000');
    down.click();
    assert.equal(input.value, '1000', 'the down control clamps at the 1,000 FLIP minimum');
    input.value = '3000';
    input.dispatchEvent({ type: 'input' });
    assert.equal(
      card.querySelector('[data-bind="pari-decimator-quote"]').textContent,
      'FOR 5,523 SCORE',
    );
    assert.equal(card.querySelector('.pari-decimator__cta-action').textContent, 'BURN');
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
    installContract({ growth: { 24: { openRound: 0 } } });

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
    assert.deepEqual(actions, ['OVER', 'UNDER']);
    assert.equal(card.querySelectorAll('.pari-side__stake').length, 0,
      'fixed 1,000 FLIP stake is not repeated in the choices');
    assert.deepEqual(
      card.querySelectorAll('.pari-split__label').map((n) => n.textContent),
      ['75%', '25%'],
      'the split percentages appear once beside the bar',
    );
    assert.equal(card.querySelector('.pari-prebet-bonus').textContent,
      'BET: 1,000 FLIP\u00a0\u00a0\u00a0BONUS: +150 FLIP',
      'the fixed bet and contract-quoted growth reward are visible before betting');
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
      ['OVER', 'UNDER'],
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
    assert.equal(card.querySelector('.pari-your-bet').textContent, 'YOUR BET:OVER 105.8 ETH');
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
    assert.match(held.textContent, /YOUR BET:OVER 105.8 ETHTO WIN: 2,500 FLIP/);
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

  test('clicking Bet OVER reaches placeBet(player, true)', async () => {
    const calls = [];
    installContract({ growth: { [LEVEL]: { openRound: LEVEL, over: 1n, under: 2n } }, calls });
    const el = await mount();
    growthCard(el).querySelectorAll('.pari-side__cta')[0].click();
    await flush();
    assert.deepEqual(calls[0], ['placeBet', TEST_ADDR, true]);
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

  test('settled volume payouts also publish only to the shared bottom row', async () => {
    installContract({
      volume: {
        [VOLUME_ROUND]: { openRound: 0 },
        [VOLUME_ROUND - 1]: {
          side: 2, outcome: 2, payout: 2_250n * FLIP, over: 1n, under: 2n,
        },
      },
    });
    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    assert.equal(card.hidden, true);
    assert.equal(card.querySelector('.pari-claim-cta'), null);
    const claim = pendingActionsMod.getPendingActions().find((item) => item.kind === 'volume-claim');
    assert.ok(claim, 'volume claim is included in the bottom action row');
    assert.equal(claim.shortLabel, 'Claim');
    assert.match(claim.detail, /2,250 FLIP ready/);
  });

  test('an open volume window uses the round-free VOLUME BET heading and its countdown', async () => {
    pari.__setClockForTest(() => OPEN_AT);
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      volume: { [VOLUME_ROUND]: { openRound: VOLUME_ROUND, over: 4n, under: 4n } },
      seals: { [VOLUME_ROUND - 1]: { total: 1200n, previous: 800n } },
    });
    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    assert.equal(card.hidden, false);
    // The round remains an internal contract key; it is not useful player UI.
    assert.equal(card.querySelector('.pari-book__title').textContent, 'VOLUME BET');
    assert.match(card.querySelector('[data-bind="pari-clock"]').textContent, /closes in 8:59/);
    assert.deepEqual(
      card.querySelectorAll('.pari-side__action').map((n) => n.textContent),
      ['OVER 3 tickets', 'UNDER 3 tickets'],
    );
    assert.equal(card.querySelector('.pari-prebet-bonus').textContent,
      'BET: 1,000 FLIP\u00a0\u00a0\u00a0BONUS: +25 FLIP',
      'the fixed bet and current decaying volume credit are visible before betting');
  });

  test('volume credit is hidden when this player cannot earn it', async () => {
    pari.__setClockForTest(() => OPEN_AT);
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      volume: { [VOLUME_ROUND]: { openRound: VOLUME_ROUND, over: 4n, under: 4n } },
      seals: { [VOLUME_ROUND - 1]: { total: 1200n, previous: 800n } },
      marketGate: { mayBet: true, earnsReward: false },
    });
    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    assert.equal(card.hidden, false);
    assert.equal(card.querySelector('.pari-prebet-bonus'), null);
    el.disconnectedCallback();
  });

  test('an open volume book stays hidden until its adjacent ticket seal arrives', async () => {
    pari.__setClockForTest(() => OPEN_AT);
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      volume: { [VOLUME_ROUND]: { openRound: VOLUME_ROUND, over: 4n, under: 4n } },
    });
    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    assert.equal(card.hidden, true,
      'the player never sees an unlabeled ticket OVER / UNDER market');
    assert.equal(card.querySelectorAll('.pari-side__cta').length, 0);
    assert.equal(el.querySelector('[data-bind="pari-empty"]').hidden, false);
    assert.match(el.querySelector('[data-bind="pari-empty"]').textContent,
      /Loading yesterday’s ticket total/);
    el.disconnectedCallback();
  });

  // User call 2026-07-29: each book shows the number the round has to beat, and
  // the % of the book on each side. Neither is a payout quote.
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
      ['OVER 105.8 ETH', 'UNDER 105.8 ETH'],
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

  test('the volume book states how many tickets the last round bought', async () => {
    pari.__setClockForTest(() => OPEN_AT);
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      volume: {
        [VOLUME_ROUND]: { openRound: VOLUME_ROUND, over: 2n, under: 6n },
        [VOLUME_ROUND - 1]: { outcome: 1 },
      },
      // Raw purchase units: 400 = 1 ticket. 1,200 units = 3 tickets, up from 2.
      seals: { [VOLUME_ROUND - 1]: { total: 1200n, previous: 800n } },
    });
    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    const bench = card.querySelector('.pari-book__bench');
    assert.ok(bench, 'benchmark line rendered');
    assert.equal(bench.textContent, 'Yesterday: 3 tickets bought');
    assert.equal(card.querySelector('.pari-today__label').parentElement,
      card.querySelector('.pari-today'),
      'TODAY owns a centered line immediately below Yesterday');
    assert.equal(card.querySelector('.pari-book__context').querySelector('.pari-today__label'), null,
      'TODAY is no longer squeezed onto Yesterday’s line');
    const offered = bench.querySelector('.pari-book__offered');
    assert.equal(offered.textContent, '3 tickets bought', 'the new bet’s offered number is isolated');
    assert.match(offered.className, /pari-book__offered--won/, 'last day’s OVER win is green');
    // …and the split reads off the bet counts, 2 v 6.
    assert.deepEqual(
      card.querySelectorAll('.pari-side__action').map((n) => n.textContent),
      ['OVER 3 tickets', 'UNDER 3 tickets'],
    );
    assert.deepEqual(
      card.querySelectorAll('.pari-side__target').map((n) => n.textContent),
      ['3 tickets', '3 tickets'],
      'the actual number being bet over or under stays visible without redundant TARGET copy',
    );
    assert.match(
      APP_CSS,
      /\.pari-side__action\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/s,
      'long offered values wrap inside their equal-width choice instead of clipping',
    );
    assert.match(
      APP_CSS,
      /\.pari-today__label\s*\{[^}]*width:\s*100%[^}]*text-align:\s*center/s,
      'TODAY is centered across its dedicated row',
    );
    assert.match(
      APP_CSS,
      /\.pari-today--volume \.pari-side__cta\s*\{[^}]*min-height:\s*1\.9rem[^}]*padding:\s*0\.2rem 0\.32rem/s,
      'ticket choice buttons are slightly shorter without shrinking their width',
    );
    assert.deepEqual(
      card.querySelectorAll('.pari-split__label').map((n) => n.textContent),
      ['25%', '75%'],
    );
    assert.equal(card.querySelector('.pari-thermometer'), null,
      'ticket pari keeps the benchmark and split without a redundant thermometer');
  });

  test('a chain-reported open round backfills its adjacent result for threshold color', async () => {
    pari.__setClockForTest(() => OPEN_AT);
    const chainRound = VOLUME_ROUND + 9;
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      volume: {
        // The locally predicted lookback is stale, but every view carries the
        // contract-authoritative open round.
        [VOLUME_ROUND]: { openRound: chainRound, over: 0n, under: 0n },
        [chainRound]: { openRound: chainRound, over: 3n, under: 2n },
        [chainRound - 1]: { openRound: chainRound, outcome: 2 },
      },
      seals: { [chainRound - 1]: { total: 1600n, previous: 2000n } },
    });

    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    const offered = card.querySelector('.pari-book__offered');
    assert.equal(offered.textContent, '4 tickets bought');
    assert.match(offered.className, /pari-book__offered--lost/,
      'the immediately preceding UNDER result is fetched and painted red');
    assert.deepEqual(
      card.querySelectorAll('.pari-side__action').map((node) => node.textContent),
      ['OVER 4 tickets', 'UNDER 4 tickets'],
      'both choices retain the actual chain benchmark despite the stale local anchor',
    );
    el.disconnectedCallback();
  });

  test('a held volume position replaces both choices with one labelled receipt', async () => {
    pari.__setClockForTest(() => OPEN_AT);
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      volume: {
        [VOLUME_ROUND]: {
          openRound: VOLUME_ROUND,
          over: 2n,
          under: 6n,
          side: 2,
        },
        [VOLUME_ROUND - 1]: { outcome: 1 },
      },
      seals: { [VOLUME_ROUND - 1]: { total: 1200n, previous: 800n } },
    });

    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    assert.equal(card.querySelector('.pari-book__title').textContent, 'VOLUME BET');
    assert.equal(card.querySelector('.pari-book__context'), null,
      'Yesterday disappears as soon as the player has a position');
    assert.equal(card.querySelector('.pari-today__label'), null,
      'TODAY disappears as soon as the player has a position');
    assert.equal(card.querySelectorAll('.pari-side__cta').length, 0,
      'submitted ticket bets no longer look actionable');
    assert.equal(card.querySelectorAll('.pari-side').length, 0,
      'the unused opposite choice is removed entirely');
    const receipt = card.querySelector('.pari-your-bet--volume');
    assert.ok(receipt?.className.includes('pari-your-bet--under'));
    assert.equal(receipt.textContent, 'YOUR BET:UNDER 3 tickets');
    el.disconnectedCallback();
  });

  test('a closed volume position keeps its pick beside the to-win amount', async () => {
    pari.__setClockForTest(() => CLOSED_AT);
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      volume: {
        [VOLUME_ROUND]: {
          openRound: 0,
          over: 2n,
          under: 3n,
          side: 2,
          outcome: 0,
          payout: 0n,
        },
      },
      // Round 101 was offered round 100's three-ticket total.
      seals: { [VOLUME_ROUND - 1]: { total: 1200n, previous: 800n } },
    });

    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    const receipt = card.querySelector('.pari-your-bet--volume.pari-your-bet--closed')
      || card.querySelector('.pari-your-bet--closed');
    assert.ok(receipt, 'the unresolved closed wager stays visible');
    assert.match(receipt.textContent, /YOUR BET:UNDER 3 tickets/,
      'the exact side and ticket line survive market close');
    assert.match(receipt.textContent, /TO WIN: 1,666 FLIP/);
    const pendingAction = pendingActionsMod.getPendingActions()
      .find((item) => item.id === `pari:volume:${VOLUME_ROUND}`);
    assert.equal(pendingAction?.label, 'VOLUME BET');
    assert.equal(pendingAction?.shortLabel, 'VOLUME BET');
    assert.doesNotMatch(`${pendingAction?.label}${pendingAction?.detail}`, /Round\s+\d+/i,
      'the pending surface keeps the contract round internal too');
    el.disconnectedCallback();
  });

  test('a stale volume seal is never shown as the current round benchmark', async () => {
    pari.__setClockForTest(() => OPEN_AT);
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      volume: {
        [VOLUME_ROUND]: { openRound: VOLUME_ROUND, over: 2n, under: 2n },
        [VOLUME_ROUND - 1]: { outcome: 1 },
        [VOLUME_ROUND - 2]: { outcome: 2 },
      },
      // Round 101 may only compare with 100. A still-indexed 99 seal is useful
      // history, but it is not the offered number for this book.
      seals: { [VOLUME_ROUND - 2]: { total: 1200n, previous: 800n } },
    });
    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    assert.equal(card.hidden, true,
      'the whole ticket book waits for round 100 instead of substituting round 99');
    assert.equal(card.querySelector('.pari-book__bench'), null);
    assert.equal(card.querySelector('.pari-thermometer'), null,
      'live progress never targets the stale round-99 line');
  });

  test('an untouched book shows zeroes while keeping an even empty bar', async () => {
    installContract({ growth: { [LEVEL]: { openRound: LEVEL, over: 0n, under: 0n } } });
    const el = await mount();
    const card = growthCard(el);
    assert.deepEqual(
      card.querySelectorAll('.pari-side__action').map((n) => n.textContent),
      ['OVER', 'UNDER'],
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
