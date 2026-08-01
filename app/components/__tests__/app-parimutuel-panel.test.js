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
} = {}) {
  const rows = growth;
  const fake = {
    marketState: async (_player, round) => {
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
  // GAME growthState — a different contract, so its own seam.
  if (ratchets) {
    pari.__setGameFactoryForTest(() => ({
      growthState: async () => [ratchets.prev, ratchets.current, ratchets.next ?? 0n, LEVEL, true, 0],
    }));
  } else {
    pari.__setGameFactoryForTest(() => ({ growthState: async () => { throw new Error('no reader'); } }));
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
const { thermometerScale } = await import('../app-parimutuel-panel.js');
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
    pari.__resetContractFactoryForTest();
    pari.__resetClockForTest();
    decimatorMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('keeps its grid column with a closed-window message when neither book is open', async () => {
    installContract({ growth: { [LEVEL]: { openRound: 0 } } });
    const el = await mount();
    assert.equal(panelOf(el).hidden, false, 'permanent right-column panel remains mounted');
    assert.equal(growthCard(el).hidden, true);
    const empty = el.querySelector('[data-bind="pari-empty"]');
    assert.equal(empty.hidden, false);
    assert.match(empty.textContent, /Books are closed|No side-bet book/i);
  });

  test('an imminent volume round stays hidden when there is no open book or player position', async () => {
    pari.__setClockForTest(() => IMMINENT_AT);
    installContract({ growth: { [LEVEL]: { openRound: 0 } } });
    const el = await mount();

    const volume = el.querySelector('[data-bind="pari-volume"]');
    assert.equal(volume.hidden, true,
      'a countdown alone does not render a VOLUME · Round card');
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
    installContract({ growth: { [LEVEL]: { openRound: 0 } } });

    const el = await mount();
    const card = decimatorCard(el);
    assert.equal(card.hidden, false);
    assert.match(card.querySelector('.pari-book__title').textContent, /DECIMATOR · Level 43/);
    assert.match(card.textContent, /Pool · 1\.25 ETH/);
    assert.match(card.textContent, /Yours · 2,500 FLIP · Bucket 7/);

    const input = card.querySelector('[data-bind="pari-decimator-input"]');
    assert.equal(input.value, '1000');
    input.value = '3000';
    card.querySelector('[data-bind="pari-decimator-cta"]').click();
    await flush();

    assert.deepEqual(calls, [
      ['static', TEST_ADDR, 3_000n * FLIP],
      ['send', TEST_ADDR, 3_000n * FLIP],
    ]);
    el.disconnectedCallback();
  });

  test('a Decimator quest click fills its FLIP target without entering', async () => {
    _gameState = { level: LEVEL, phase: 'JACKPOT', decWindowOpen: true };
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
    el.disconnectedCallback();
  });

  test('an open growth book renders the round, the book and both bet buttons', async () => {
    installContract({ growth: { [LEVEL]: { openRound: LEVEL, over: 3n, under: 1n } } });
    const el = await mount();
    assert.equal(panelOf(el).hidden, false);

    const card = growthCard(el);
    assert.equal(card.hidden, false);
    assert.match(card.querySelector('.pari-book__title').textContent, /GROWTH · Level 42/);
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

    // No payout quote or repeated stake: the only live secondary information is
    // the split below the two plain OVER / UNDER controls.
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
    assert.equal(card.querySelector('.pari-book__foot'), null,
      'quest-credit detail does not clutter the live book');
  });

  test('an open held growth position becomes one your-bet line above the live split', async () => {
    installContract({
      growth: { [LEVEL]: { openRound: LEVEL, over: 3n, under: 1n, side: 1 } },
      ratchets: { prev: 80n * FLIP, current: 92n * FLIP },
    });
    const el = await mount();
    const card = growthCard(el);
    assert.equal(card.querySelectorAll('.pari-side__cta').length, 0, 'no second bet offered');
    assert.equal(card.querySelectorAll('.pari-side').length, 0,
      'the empty opposing cell is removed after committing');
    assert.equal(card.querySelector('.pari-your-bet').textContent, 'YOUR BET:OVER 15% GROWTH');
    assert.deepEqual(
      card.querySelectorAll('.pari-split__label').map((n) => n.textContent),
      ['75%', '25%'],
    );
    assert.equal(card.querySelector('.pari-book__foot'), null);
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
      ratchets: { prev: 80n * FLIP, current: 92n * FLIP },
    });
    const el = await mount();
    const card = growthCard(el);
    const held = card.querySelector('.pari-your-bet--closed');
    assert.ok(held, 'closed unresolved bet gets a compact held-position receipt');
    assert.match(held.textContent, /YOUR BET:OVER 15% GROWTHTO WIN: 2,500 FLIP/);
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

  test('a settled winner keeps the panel up with a claim for the total', async () => {
    installContract({
      growth: {
        [LEVEL]: { openRound: 0 },
        [LEVEL - 1]: { side: 1, outcome: 1, payout: 4_000n * FLIP },
        [LEVEL - 2]: { side: 2, outcome: 2, payout: 1_500n * FLIP },
      },
    });
    const el = await mount();
    assert.equal(panelOf(el).hidden, false, 'closed book, but money is waiting');
    const card = growthCard(el);
    assert.equal(card.querySelectorAll('.pari-result--win').length, 0,
      'settled history rows do not repeat old level outcomes');
    assert.match(card.querySelector('.pari-claim-cta').textContent, /Claim 5,500 FLIP/);
    const pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.length, 2);
    assert.ok(pending.every((item) => item.state === 'ready' && typeof item.run === 'function'));
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
    const el = await mount();
    growthCard(el).querySelector('.pari-claim-cta').click();
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
    const el = await mount();

    growth[LEVEL - 1] = {
      side: 1,
      outcome: 1,
      claimed: true,
      payout: 0n,
      over: 1n,
      under: 3n,
    };
    growthCard(el).querySelector('.pari-claim-cta').click();
    await flush();

    assert.deepEqual(calls, [], 'fresh claimed=true state bypasses every write');
    const [replay] = revealMod.__takeQueuedForTest();
    assert.equal(replay.kind, 'pari');
    assert.equal(replay.round, LEVEL - 1);
    assert.equal(replay.payout, 4_000n * FLIP,
      'payout is reconstructed because claimed marketState returns zero');
    assert.equal(pendingActionsMod.getPendingActions().length, 0);
  });

  test('an open volume window renders the deploy-relative round and its countdown', async () => {
    pari.__setClockForTest(() => OPEN_AT);
    installContract({
      growth: { [LEVEL]: { openRound: 0 } },
      volume: { [VOLUME_ROUND]: { openRound: VOLUME_ROUND, over: 4n, under: 4n } },
    });
    const el = await mount();
    const card = el.querySelector('[data-bind="pari-volume"]');
    assert.equal(card.hidden, false);
    // Deploy-relative, NOT the epoch-scale day boundary — an absolute index
    // would read ~2.97M here and would query rounds nobody ever bet on.
    assert.match(card.querySelector('.pari-book__title').textContent, /Round 101$/);
    assert.match(card.querySelector('[data-bind="pari-clock"]').textContent, /closes in 8:59/);
    assert.deepEqual(
      card.querySelectorAll('.pari-side__action').map((n) => n.textContent),
      ['OVER', 'UNDER'],
    );
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
      ratchets: { prev: 80n * 10n ** 18n, current: 92n * 10n ** 18n },
    });
    const el = await mount();
    const bench = growthCard(el).querySelector('.pari-book__bench');
    assert.ok(bench, 'benchmark line rendered');
    assert.equal(bench.textContent, 'Last level: 15%');
    const offered = bench.querySelector('.pari-book__offered');
    assert.equal(offered.textContent, '15%', 'only the offered result is isolated');
    assert.match(offered.className, /pari-book__offered--won/, 'prior OVER win is green');
    assert.doesNotMatch(bench.className, /--won|--lost/, 'surrounding explanation stays neutral');
    assert.deepEqual(
      growthCard(el).querySelectorAll('.pari-side__action').map((n) => n.textContent),
      ['OVER 15%', 'UNDER 15%'],
      'both growth choices carry the offered line',
    );
  });

  test('a level that shrank keeps its signed result in the compact line', async () => {
    installContract({
      growth: {
        [LEVEL]: { openRound: LEVEL, over: 1n, under: 1n },
        [LEVEL - 1]: { outcome: 2 },
      },
      ratchets: { prev: 100n * 10n ** 18n, current: 90n * 10n ** 18n },
    });
    const el = await mount();
    const bench = growthCard(el).querySelector('.pari-book__bench');
    assert.equal(bench.textContent, 'Last level: -10%');
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
    assert.equal(bench.textContent, 'Yesterday: 3 tickets');
    assert.equal(card.querySelector('.pari-today__label').parentElement,
      card.querySelector('.pari-book__context'),
      'TODAY is moved up beside Yesterday so the choices span the card');
    const offered = bench.querySelector('.pari-book__offered');
    assert.equal(offered.textContent, '3 tickets', 'the new bet’s offered number is isolated');
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
    assert.equal(offered.textContent, '4 tickets');
    assert.match(offered.className, /pari-book__offered--lost/,
      'the immediately preceding UNDER result is fetched and painted red');
    assert.deepEqual(
      card.querySelectorAll('.pari-side__action').map((node) => node.textContent),
      ['OVER 4 tickets', 'UNDER 4 tickets'],
      'both choices retain the actual chain benchmark despite the stale local anchor',
    );
    el.disconnectedCallback();
  });

  test('a held volume position keeps its labelled ticket target visible', async () => {
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
    assert.deepEqual(
      card.querySelectorAll('.pari-side__target').map((node) => node.textContent),
      ['3 tickets', '3 tickets'],
    );
    const under = card.querySelectorAll('.pari-side')
      .find((node) => String(node.className).split(/\s+/).includes('pari-side--under'));
    assert.equal(under?.querySelector('.pari-side__held')?.textContent, 'YOUR BET');
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
    assert.match(card.querySelector('.pari-book__title').textContent, /Round 101$/);
    assert.equal(card.querySelector('.pari-book__bench'), null,
      'the UI waits for round 100 instead of substituting round 99');
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
