// /app/components/__tests__/app-tickets-inventory.test.js — task #12.
// Run: cd website && node --test app/components/__tests__/app-tickets-inventory.test.js
//
// Tests the dual-mode ticket inventory:
//   - cards mode dedups identical 4-trait combos into ×N cards
//   - chart mode: 4 × (8×8) grids; cell trait_id = q*64 + color*8 + symbol,
//     .has + count only where the player holds the trait
//   - level nav refetches with the new ?level= (never a day param)
//   - pending packs render a placeholder card
//   - badge path uses the canonical decode (sym = tid%8, col = (tid%64)/8)

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as storeMod from '../../app/store.js';
import * as pendingActionsMod from '../../app/pending-actions.js';
import * as passesMod from '../../app/passes.js';
import * as salvageMod from '../../app/salvage.js';

let packWatchMod = null;
let inventoryMod = null;

const TEST_ADDR = '0xab12000000000000000000000000000000000000';
const RAW_ETH = 10n ** 12n;
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Fake DOM — same trimmed harness as app-balances-strip.test.js.
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
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
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

// Fetch stub — by-trait route keyed by level + /game/state (active mint
// level source: jackpotPhase ? level : level+1); logs URLs for nav assertions.
let _byLevel = new Map();
let _foilByLevel = new Map();
let _gameState = { level: 17, phase: 'JACKPOT', jackpotPhaseFlag: true };  // → active 17
let _dashboardTickets = [];
let _dashboardUnavailable = false;
let _deitySymbols = [];
let _farFutureQueueResponse = null;
const _fetchLog = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  _fetchLog.push(u);
  if (u.endsWith('/game/state')) {
    return { ok: true, status: 200, json: async () => _gameState };
  }
  if (/\/player\/0x[0-9a-f]+$/i.test(u)) {
    return _dashboardUnavailable
      ? { ok: false, status: 404, json: async () => ({ message: 'player not found' }) }
      : { ok: true, status: 200, json: async () => ({ tickets: _dashboardTickets }) };
  }
  const m = u.match(/\/tickets\/by-trait\?level=(\d+)$/);
  if (m && _byLevel.has(Number(m[1]))) {
    return { ok: true, status: 200, json: async () => _byLevel.get(Number(m[1])) };
  }
  const foil = u.match(/\/foil\?level=(\d+)$/);
  if (foil && _foilByLevel.has(Number(foil[1]))) {
    return { ok: true, status: 200, json: async () => _foilByLevel.get(Number(foil[1])) };
  }
  if (/\/far-future-queue$/i.test(u) && _farFutureQueueResponse) {
    return { ok: true, status: 200, json: async () => _farFutureQueueResponse };
  }
  if (/\/viewer\/player\/0x[0-9a-f]+\/day\/\d+$/i.test(u)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        store: {
          deityPassPurchases: _deitySymbols.map((symbolId) => ({ symbolId, level: 17, price: '1' })),
        },
      }),
    };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

function resetDom() {
  pendingActionsMod.__resetPendingActionsForTest();
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.localStorage.clear();
  _docListeners.clear();
  _byLevel = new Map();
  _foilByLevel = new Map();
  _gameState = { level: 17, phase: 'JACKPOT', jackpotPhaseFlag: true };
  _dashboardTickets = [];
  _dashboardUnavailable = false;
  _deitySymbols = [];
  _farFutureQueueResponse = null;
  _fetchLog.length = 0;
  salvageMod.__resetSalvageContractFactoryForTest();
  passesMod.__setDeityReadContractFactoryForTest(() => ({
    name: async () => 'Degenerus Deity Pass',
    ownerOf: async (symbolId) => {
      if (_deitySymbols.includes(Number(symbolId))) return TEST_ADDR;
      throw new Error('InvalidToken');
    },
  }));
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 30));
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Fixtures — trait 1 = crypto tron pink (q0 s1 c0); 72 = zodiac aries purple
// (q1 s0 c1); 129 = cards diamond pink (q2 s1 c0); 200 = dice s0 c1 (q3).
// ---------------------------------------------------------------------------

const COMBO = [1, 72, 129, 200];

function card(status, ids = COMBO) {
  return { cardIndex: 0, status, entries: ids.map((traitId, i) => ({ entryId: i, traitId })) };
}

function cardAt(cardIndex, status, ids = COMBO) {
  return {
    cardIndex,
    status,
    entries: ids.map((traitId, i) => ({ entryId: cardIndex * 4 + i, traitId })),
  };
}

function byTraitPayload({ level = 17, cards = [] } = {}) {
  return { address: TEST_ADDR, level, day: 67, totalEntries: cards.length * 4, cards };
}

function mount() {
  const Ctor = customElements.get('app-tickets-inventory');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

describe('app-tickets-inventory — cards + chart', () => {
  beforeEach(async () => {
    if (packWatchMod) packWatchMod.stopPackWatch();
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    storeMod.update('app.lastDay', { day: 67, status: 'resolved', level: 17 });
    inventoryMod = await import('../app-tickets-inventory.js');
    inventoryMod.__resetDeityEntryContractFactoryForTest();
    packWatchMod = await import('../../app/pack-watch.js');
  });

  test('YOUR TICKETS stays on one line in the phone header', () => {
    assert.match(
      APP_CSS,
      /\.app-tickets-inventory \.inv-head > h2\s*\{[^}]*flex:\s*0 0 auto[^}]*white-space:\s*nowrap/s,
    );
  });

  test('cards mode dedups identical combos into ×N cards', async () => {
    _byLevel.set(17, byTraitPayload({ cards: [card('opened'), card('opened'), card('opened', [2, 73, 130, 201])] }));
    const el = mount();
    await flushMicrotasks();

    const cards = el.querySelectorAll('.inv-card');
    assert.equal(cards.length, 2, 'two deduped combos');
    const counts = el.querySelectorAll('.inv-count').map((c) => c.textContent);
    assert.ok(counts.includes('×2'), 'duplicate combo shows ×2');
    // A ×1 badge is suppressed (user call 2026-07-28): the dedup key is the ordered
    // 4-trait combo, one of 64^4, so in practice every card was a unique ×1 and the
    // badge was noise on every card. The >1 badge stays so a real duplicate is never
    // silently rendered as a single card.
    assert.ok(!counts.includes('×1'), 'unique combo shows no badge');
    assert.equal(counts.length, 1, 'exactly one badge — only the duplicate carries it');
    const meta = el.querySelector('[data-bind="inv-meta"]');
    assert.match(meta.textContent, /3 cards/, 'meta counts totalEntries/4');
    assert.match(
      el.innerHTML,
      /class="inv-level-cluster">[\s\S]*?class="inv-level-nav"[\s\S]*?data-bind="inv-meta"[\s\S]*?<\/span>/,
      'the ticket count is grouped with the level selector instead of Total Value',
    );
    el.disconnectedCallback();
  });

  test('TOTAL VALUE prices every unresolved entry at its own level and drops resolved levels', async () => {
    _dashboardTickets = [
      { level: 16, entryCount: 400 }, // fully resolved: excluded despite its size
      { level: 17, entryCount: 5 },   // 1.25 × 0.04 ETH = 0.05 ETH
      { level: 30, entryCount: 2 },   // 0.50 × 0.08 ETH = 0.04 ETH
    ];
    _byLevel.set(17, byTraitPayload({ cards: [card('opened')] }));

    assert.equal(
      inventoryMod.unresolvedTicketFaceValueWei(_dashboardTickets, 17),
      90_000_000_000n,
      'raw value uses the configured testnet ETH scale and retains quarter entries',
    );

    const el = mount();
    await flushMicrotasks();
    const total = el.querySelector('[data-bind="inv-total-value"]');
    assert.ok(total, 'aggregate is present in the ticket header');
    assert.equal(total.textContent, '0.09 ETH');

    storeMod.update('app.gameState', {
      level: 17,
      phase: 'JACKPOT',
      jackpotPhaseFlag: true,
      jackpotCounter: 4,
      rngLockedFlag: true,
      phaseTransitionActive: false,
      gameOver: false,
    });
    assert.equal(total.textContent, '0.09 ETH',
      'a final RNG lock does not erase tickets before that draw settles');

    storeMod.update('app.gameState', {
      level: 17,
      phase: 'JACKPOT',
      jackpotPhaseFlag: true,
      jackpotCounter: 0,
      rngLockedFlag: true,
      phaseTransitionActive: true,
      gameOver: false,
    });
    assert.equal(total.textContent, '0.04 ETH',
      'advancing the unresolved boundary removes the newly resolved level without a dashboard refetch');
    el.disconnectedCallback();
  });

  test('TOTAL VALUE fallback combines near traits with the far-future queue when /player is 404', async () => {
    const calls = [];
    const rows = await inventoryMod.readTicketHoldingsFallback({
      address: TEST_ADDR,
      unresolvedLevel: 1,
      knownLevel: 1,
      knownPayload: { totalEntries: 152 },
      fetcher: async (url) => {
        calls.push(String(url));
        if (String(url).endsWith('/far-future-queue')) {
          return {
            rows: [
              { level: 7, entryCount: 40 },
              { level: 20, entryCount: 4 },
            ],
          };
        }
        const level = Number(/level=(\d+)$/.exec(String(url))?.[1]);
        return { totalEntries: level === 2 ? 120 : level >= 3 && level <= 6 ? 40 : 0 };
      },
    });

    assert.deepEqual(rows.map(({ level, entryCount }) => ({ level, entryCount })), [
      { level: 1, entryCount: 152 },
      { level: 2, entryCount: 120 },
      { level: 3, entryCount: 40 },
      { level: 4, entryCount: 40 },
      { level: 5, entryCount: 40 },
      { level: 6, entryCount: 40 },
      { level: 7, entryCount: 40 },
      { level: 20, entryCount: 4 },
    ]);
    assert.equal(calls.filter((url) => url.includes('tickets/by-trait')).length, 5,
      'the already-loaded current level is reused instead of fetched twice');
    assert.equal(calls.filter((url) => url.endsWith('/far-future-queue')).length, 1,
      'all remaining future levels come from one compact request');
  });

  test('ticket header renders the recovered TOTAL VALUE when the dashboard player row is missing', async () => {
    _dashboardUnavailable = true;
    _byLevel.set(17, byTraitPayload({ level: 17, cards: [cardAt(0), cardAt(1)] }));
    _byLevel.set(18, byTraitPayload({ level: 18, cards: [cardAt(0)] }));
    for (let level = 19; level <= 22; level += 1) {
      _byLevel.set(level, byTraitPayload({ level, cards: [] }));
    }
    _farFutureQueueResponse = {
      rows: [{ level: 23, queueIndex: 0, entryCount: 4, remainder: 0 }],
    };
    const expectedRows = [
      { level: 17, entryCount: 8 },
      { level: 18, entryCount: 4 },
      { level: 23, entryCount: 4 },
    ];

    const el = mount();
    await flushMicrotasks();
    assert.equal(
      el.querySelector('[data-bind="inv-total-value"]').textContent,
      `${inventoryMod.formatTicketTotalValueEth(
        inventoryMod.unresolvedTicketFaceValueWei(expectedRows, 17),
      )} ETH`,
    );
    el.disconnectedCallback();
  });

  test('a resolved foil pack always renders its four physical tickets', async () => {
    _byLevel.set(17, byTraitPayload({
      cards: Array.from({ length: 4 }, (_unused, i) => cardAt(i, 'opened', COMBO)),
    }));
    _foilByLevel.set(17, {
      present: true,
      level: 17,
      lines: Array.from({ length: 4 }, () => [...COMBO]),
    });
    const el = mount();
    await flushMicrotasks();

    const foils = el.querySelectorAll('.inv-card--foil');
    assert.equal(foils.length, 4,
      'foil lines stay four visible cards even when their trait combinations collide');
    assert.equal(el.querySelectorAll('.inv-foil-tag').length, 0,
      'foil ticket faces use their material treatment instead of covering a trait with text');
    assert.ok(foils.every((foil) => foil.querySelector('.ticket-card--foil')),
      'all four physical foil tickets receive the shared metallic face');
    assert.ok(foils.every((foil) => (
      foil.querySelector('.ticket-card-center')?.querySelector('img')?.src
        === '/whitepaper/flame-center-silver.svg'
    )), 'every foil centre uses the dedicated silver flame');
    assert.equal(el.querySelectorAll('.inv-count').length, 0,
      'the foil pack is not collapsed into one ×4 inventory card');
    el.disconnectedCallback();
  });

  test('badge paths use the canonical decode (trait 1 → crypto tron pink)', async () => {
    _byLevel.set(17, byTraitPayload({ cards: [card('opened')] }));
    const el = mount();
    await flushMicrotasks();

    const img = el.querySelector('[data-bind="inv-cards"]').querySelector('img');
    assert.equal(img.src, '/badges-circular/crypto_01_tron_pink.svg',
      'tid 1 = q0, sym 1 (tron), col 0 (pink)');
    el.disconnectedCallback();
  });

  test('owned deity pass renders first as a blank hero-highlighted symbol card', async () => {
    _deitySymbols = [21]; // cards / cashsack
    _byLevel.set(17, byTraitPayload({ cards: [card('opened')] }));
    const el = mount();
    await flushMicrotasks();

    const host = el.querySelector('[data-bind="inv-cards"]');
    const cards = host.querySelectorAll('.inv-card');
    assert.equal(cards.length, 2, 'deity pass joins the ordinary ticket in inventory');
    assert.ok(cards[0].className.split(/\s+/).includes('inv-card--deity-pass'),
      'account collectible is listed before level tickets');
    const hero = cards[0].querySelector('.inv-deity-pass__hero');
    assert.ok(hero, 'deity symbol receives the dedicated spiked hero treatment');
    assert.equal(hero.querySelector('img')?.src, '/badges-circular/cards_02_cashsack_gold.svg');
    assert.equal(cards[0].querySelector('.inv-deity-pass__name')?.textContent, 'God of Cashsack');
    assert.equal(cards[0].className.includes('inv-card--degenerette-copy'), false,
      'a one-symbol pass cannot be copied into the four-trait Degenerette ticket');
    el.disconnectedCallback();
  });

  test('fractional generation boundaries cannot vertically splice two tickets', async () => {
    const { reconstructInventoryTicketTraits } = await import('../app-tickets-inventory.js');
    const raw = [
      { cardIndex: 0, status: 'opened', entries: [1, 72, 129, 200]
        .map((traitId, i) => ({ entryId: i, traitId })) },
      // One generation call ends after its top row; the next call restarts at
      // Q0 inside the same API-created four-entry bucket.
      { cardIndex: 1, status: 'opened', entries: [2, 73, 3, 74]
        .map((traitId, i) => ({ entryId: 4 + i, traitId })) },
      { cardIndex: 2, status: 'opened', entries: [130, 201, 4, 75]
        .map((traitId, i) => ({ entryId: 8 + i, traitId })) },
      { cardIndex: 3, status: 'opened', entries: [131, 202]
        .map((traitId, i) => ({ entryId: 12 + i, traitId })) },
    ];

    assert.deepEqual(reconstructInventoryTicketTraits(raw), [
      [1, 72, 129, 200],
      [3, 74, 130, 201],
      [4, 75, 131, 202],
    ], 'unfinished top row is dropped; later top/bottom rows stay with their own ticket');

    const payload = byTraitPayload({ cards: raw });
    payload.totalEntries = 14;
    _byLevel.set(17, payload);
    const el = mount();
    await flushMicrotasks();
    const rendered = el.querySelector('[data-bind="inv-cards"]')
      .querySelectorAll('.ticket-card');
    assert.equal(rendered.length, 3, 'only three real whole tickets render');
    for (const ticket of rendered) {
      const paths = ticket.querySelectorAll('.trait-quadrant')
        .map((cell) => cell.querySelector('img')?.src);
      assert.match(paths[0], /\/crypto_/);
      assert.match(paths[1], /\/zodiac_/);
      assert.match(paths[2], /\/cards_/);
      assert.match(paths[3], /\/dice_/);
    }
    const entries = el.querySelectorAll('.ticket-entry-card');
    assert.equal(entries.length, 2, 'both real fractional entries get quarter-ticket graphics');
    assert.deepEqual(entries.map((entry) => entry.getAttribute('data-quadrant')), ['0', '1']);
    assert.ok(entries.every((entry) => !entry.querySelector('.ticket-card-center')),
      'entry graphics deliberately omit the ticket center diamond');
    assert.match(el.querySelector('[data-bind="inv-meta"]').textContent, /^3 cards · 2 entries/,
      'the inventory headline exposes the exact remainder');
    el.disconnectedCallback();
  });

  test('clicking an opened inventory ticket publishes its traits to Degenerette', async () => {
    _byLevel.set(17, byTraitPayload({ cards: [card('opened')] }));
    let copied = null;
    document.addEventListener('degenerette:copy-ticket', (event) => { copied = event.detail; });
    const el = mount();
    await flushMicrotasks();

    const ticket = el.querySelector('.inv-card--degenerette-copy');
    assert.ok(ticket, 'opened card is an accessible copy control');
    el.querySelector('[data-bind="inv-cards"]').dispatchEvent({ type: 'click', target: ticket });
    assert.deepEqual(copied, { traitIds: COMBO, level: 17, foil: false });
    assert.ok(ticket.classList.contains('inv-card--copied'));
    assert.equal(ticket.getAttribute('aria-label'), 'Copied to Degenerette');
    el.disconnectedCallback();
  });

  test('cards carrying any gold trait are listed before all non-gold tickets', async () => {
    const plain = card('opened', [1, 72, 129, 200]);
    const gold = card('opened', [56, 73, 130, 201]); // q0, color index 7, symbol 0
    _byLevel.set(17, byTraitPayload({ cards: [plain, gold] }));
    const el = mount();
    await flushMicrotasks();

    const cards = el.querySelector('[data-bind="inv-cards"]').querySelectorAll('.inv-card');
    assert.equal(cards.length, 2);
    assert.ok(cards[0].classList.contains('inv-card--gold'), 'gold ticket is first');
    assert.match(cards[0].querySelector('img').src, /_gold\.svg$/, 'first card visibly carries gold');
    assert.ok(!cards[1].classList.contains('inv-card--gold'), 'non-gold ticket follows');
    el.disconnectedCallback();
  });

  test('foil tickets are grouped immediately after gold tickets', async () => {
    const plain = [1, 72, 129, 200];
    const foil = [2, 73, 130, 201];
    const gold = [56, 74, 131, 202];
    _byLevel.set(17, byTraitPayload({
      cards: [
        cardAt(0, 'opened', plain),
        ...Array.from({ length: 4 }, (_unused, i) => cardAt(i + 1, 'opened', foil)),
        cardAt(5, 'opened', gold),
      ],
    }));
    _foilByLevel.set(17, {
      present: true,
      level: 17,
      lines: Array.from({ length: 4 }, () => [...foil]),
    });
    const el = mount();
    await flushMicrotasks();

    const cards = el.querySelector('[data-bind="inv-cards"]').querySelectorAll('.inv-card');
    assert.equal(cards.length, 6);
    assert.ok(cards[0].classList.contains('inv-card--gold'), 'gold remains first');
    for (const cardEl of cards.slice(1, 5)) {
      assert.match(cardEl.className, /(?:^|\s)inv-card--foil(?:\s|$)/,
        'all four foils follow gold');
    }
    assert.ok(!cards[5].classList.contains('inv-card--gold'));
    assert.ok(!cards[5].classList.contains('inv-card--foil'), 'ordinary ticket stays below foils');
    el.disconnectedCallback();
  });

  test('far-future holdings support multi-select and an offer while queue positions index', async () => {
    storeMod.update('ui.mode', 'self');
    storeMod.update('ui.chainOk', true);
    storeMod.update('app.lastDay', {
      day: 67,
      status: 'resolved',
      level: 17,
      roll1: { purchaseLevel: 17 },
    });
    _dashboardTickets = [
      { level: 23, entryCount: 8 },
      { level: 25, entryCount: 4 },
    ];
    const quoteCalls = [];
    salvageMod.__setSalvageContractFactoryForTest(() => ({
      previewSellFarFutureEntries: async (player, levels, quantities) => {
        quoteCalls.push({ player, levels, quantities });
        return [100n * RAW_ETH, 20n * RAW_ETH, 10n * RAW_ETH, 5n * RAW_ETH, 25n * 10n ** 18n];
      },
    }));

    const el = mount();
    await flushMicrotasks();
    // active 17 → level 22 enters the aggregate far-future view; salvage itself
    // begins at distance 6, so the owned L23/L25 rows are both eligible.
    for (let i = 0; i < 5; i += 1) {
      el.querySelector('[data-bind="inv-next"]').dispatchEvent({ type: 'click' });
    }
    await flushMicrotasks();

    let picks = el.querySelectorAll('.inv-ff__pick');
    assert.equal(picks.length, 2, 'dashboard holdings remain selectable without the queue endpoint');
    picks[0].checked = true;
    picks[0].dispatchEvent({ type: 'change' });
    picks = el.querySelectorAll('.inv-ff__pick');
    picks[1].checked = true;
    picks[1].dispatchEvent({ type: 'change' });
    await flushMicrotasks();

    assert.deepEqual(quoteCalls.at(-1), {
      player: TEST_ADDR,
      levels: [23n, 25n],
      quantities: [8n, 4n],
    }, 'one exact preview bundles both selected levels in entry units');
    assert.equal(el.querySelector('.inv-salvage__selected').textContent,
      '3 tickets selected');
    assert.equal(el.querySelector('.inv-salvage__metrics'), null,
      'face value and offer percentage stay out of the compact quote');
    assert.match(el.querySelector('.inv-salvage__payout').textContent,
      /^PAYOUT250 tickets \+ 5 ETH \+ 25 FLIP$/,
      'the contract ticket leg is converted into actual ticket count');
    assert.doesNotMatch(el.textContent, /ETH TICKETS|FACE VALUE|OFFER ·/i);
    assert.equal(el.querySelector('[data-bind="salvage-execute"]').textContent,
      'QUEUE DATA INDEXING',
      'only the full-balance transaction waits for queue positions; selection and quoting do not');
    el.disconnectedCallback();
  });

  test('salvage ticket leg converts contract wei into quarter-ticket purchase units', () => {
    assert.equal(inventoryMod.salvageTicketPurchaseUnits(10n * RAW_ETH, 17), 100_000n);
    assert.equal(inventoryMod.formatSalvageTicketCount(10n * RAW_ETH, 17), '250');
  });

  test('chart mode: 256 cells, .has + count only where held', async () => {
    _byLevel.set(17, byTraitPayload({ cards: [card('opened'), card('opened')] }));
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="inv-chart"]').children.length, 0,
      'the hidden chart does no DOM or image work in cards mode');
    el.querySelector('[data-bind="inv-mode-chart"]').dispatchEvent({ type: 'click' });
    const chart = el.querySelector('[data-bind="inv-chart"]');
    assert.equal(chart.hidden, false, 'chart visible after toggle');
    assert.equal(el.querySelector('[data-bind="inv-cards"]').hidden, true, 'cards hidden');

    const cells = chart.querySelectorAll('.chart-cell');
    assert.equal(cells.length, 256, '4 quadrants × 64 traits');
    const hot = chart.querySelectorAll('.has');
    assert.equal(hot.length, 4, 'exactly the 4 held traits are lit');
    const counts = chart.querySelectorAll('.cell-count').map((c) => c.textContent);
    assert.ok(counts.every((c) => c === '2'), 'each held trait counted twice (2 cards)');
    el.disconnectedCallback();
  });

  test('deity holder chart adds the live virtual entry count to all eight colors of its symbol', async () => {
    _deitySymbols = [0]; // crypto / xrp
    _byLevel.set(17, byTraitPayload({ cards: [card('opened')] }));
    const calls = [];
    inventoryMod.__setDeityEntryContractFactoryForTest(() => ({
      getEntries: async (traitId, level, offset, limit, player) => {
        calls.push({ traitId: Number(traitId), level: Number(level), offset, limit, player });
        // Common pink XRP has 151 real entries -> floor(2%) = 3. Other
        // commons hit the minimum 2; gold is always exactly one.
        return { total: Number(traitId) === 0 ? 151n : 0n };
      },
    }));

    const el = mount();
    await flushMicrotasks();
    assert.equal(calls.length, 0, 'cards mode skips chart-only deity RPC reads');
    el.querySelector('[data-bind="inv-mode-chart"]').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    const chart = el.querySelector('[data-bind="inv-chart"]');
    assert.equal(chart.querySelector('.inv-chart__deity-note')?.textContent,
      'D+ = current Deity entries');
    const deityCounts = chart.querySelectorAll('.cell-deity-count').map((node) => node.textContent);
    assert.equal(deityCounts.length, 8, 'one projection for every color of the deity symbol');
    assert.equal(deityCounts[0], 'D+3', 'common count follows the live 2% bucket rule');
    assert.equal(deityCounts.filter((text) => text === 'D+2').length, 6,
      'the other six common colors receive the minimum two entries');
    assert.equal(deityCounts[7], 'D+1', 'gold is capped at one virtual entry');
    assert.equal(chart.querySelectorAll('.has-deity').length, 8,
      'only the owned symbol across its eight colors receives the deity halo');
    assert.equal(calls.length, 8, 'the projection reads only the eight relevant buckets');
    assert.ok(calls.every((call) => call.level === 17 && call.offset === 0 && call.limit === 0),
      'zero-limit reads retrieve live bucket totals without scanning holder arrays');
    el.disconnectedCallback();
  });

  test('an unchanged refresh retains the large cards DOM instead of rebuilding it', async () => {
    _byLevel.set(17, byTraitPayload({
      cards: [card('opened'), cardAt(1, 'opened', [2, 73, 130, 201])],
    }));
    const el = mount();
    await flushMicrotasks();
    const host = el.querySelector('[data-bind="inv-cards"]');
    const firstCard = host.querySelector('.inv-card');
    const firstBadge = firstCard.querySelector('img');
    assert.equal(firstBadge.loading, 'lazy');
    assert.equal(firstBadge.decoding, 'async');

    storeMod.update('app.lastDay', {
      day: 67,
      status: 'resolved',
      level: 17,
      roll1: { purchaseLevel: 17 },
    });
    await flushMicrotasks();
    assert.equal(host.querySelector('.inv-card'), firstCard,
      'same ticket payload keeps the existing card nodes and controls');
    assert.match(APP_CSS, /\.inv-card\s*\{[^}]*content-visibility:\s*auto[^}]*contain-intrinsic-size:/s,
      'offscreen inventory cards can skip browser layout and paint work');
    el.disconnectedCallback();
  });

  test('untouched desktop chart mode fits its full natural height until manually resized', async () => {
    _byLevel.set(17, byTraitPayload({ cards: [card('opened')] }));
    const el = mount();
    await flushMicrotasks();

    el.querySelector('[data-bind="inv-mode-chart"]').dispatchEvent({ type: 'click' });
    const frame = el.querySelector('[data-bind="inv-window"]');
    assert.ok(frame.classList.contains('inv-window--fit-chart'),
      'default-size chart opts into its full 2×2 natural footprint');

    el.querySelector('[data-bind="inv-resize-grip"]').dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault() {},
    });
    assert.ok(!frame.classList.contains('inv-window--fit-chart'),
      'manual resizing restores the persisted scroll window');
    assert.equal(frame.style.height, '360px');
    el.disconnectedCallback();
  });

  test('level nav refetches with the new level; never sends a day param', async () => {
    _byLevel.set(17, byTraitPayload({ cards: [card('opened')] }));
    _byLevel.set(18, byTraitPayload({ level: 18, cards: [] }));
    const el = mount();
    await flushMicrotasks();

    el.querySelector('[data-bind="inv-next"]').dispatchEvent({ type: 'click' });
    await flushMicrotasks();

    assert.ok(_fetchLog.some((u) => u.includes('by-trait?level=18')), 'refetched level 18');
    assert.ok(_fetchLog.every((u) => !/[?&]day=/.test(u)), 'no day param ever (by-trait gotcha)');
    assert.equal(el.querySelector('[data-bind="inv-level"]').textContent, '18', 'level display updated');
    assert.match(el.querySelector('[data-bind="inv-tag"]').textContent, /future/, 'future tag past active level');

    el.querySelector('[data-bind="inv-jump"]').dispatchEvent({ type: 'click' });
    await flushMicrotasks();
    assert.equal(el.querySelector('[data-bind="inv-level"]').textContent, '17', 'jump returns to active');
    assert.match(el.querySelector('[data-bind="inv-tag"]').textContent, /active/, 'active tag');
    el.disconnectedCallback();
  });

  test('pending packs render a placeholder card + meta note', async () => {
    _byLevel.set(17, byTraitPayload({ cards: [card('opened'), card('pending')] }));
    const el = mount();
    await flushMicrotasks();

    const pending = el.querySelector('.inv-card--pending');
    assert.ok(pending, 'pending placeholder rendered');
    assert.match(pending.textContent, /1 pack/, 'pending count');
    assert.match(el.querySelector('[data-bind="inv-meta"]').textContent, /1 pending/, 'meta note');
    el.disconnectedCallback();
  });

  test('new pack tickets stay out of inventory until that pack is opened', async () => {
    const oldTicket = cardAt(0, 'opened', COMBO);
    const newIds = [2, 73, 130, 201];
    const waitingTicket = cardAt(1, 'pending', newIds);
    _byLevel.set(17, byTraitPayload({ cards: [oldTicket, waitingTicket] }));
    await packWatchMod.recordPendingPack({ address: TEST_ADDR, level: 17 });

    const rolledTicket = cardAt(1, 'opened', newIds);
    _byLevel.set(17, byTraitPayload({ cards: [oldTicket, rolledTicket] }));
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelectorAll('.ticket-card').length, 1,
      'the newly indexed ticket does not appear before its pack');
    assert.match(el.querySelector('[data-bind="inv-meta"]').textContent, /^1 card/,
      'the headline count does not spoil the unopened ticket either');

    await packWatchMod.completePackReveal({
      address: TEST_ADDR,
      level: 17,
      cardIndexes: [1],
    });
    storeMod.update('app.lastDay', {
      day: 67,
      status: 'resolved',
      level: 17,
      roll1: { purchaseLevel: 17 },
    });
    await flushMicrotasks();

    assert.equal(el.querySelectorAll('.ticket-card').length, 2,
      'the ticket display refreshes immediately after the pack is consumed');
    assert.match(el.querySelector('[data-bind="inv-meta"]').textContent, /^2 cards/);
    el.disconnectedCallback();
  });

  test('a rolled fractional entry stays behind its reveal, then appears as a quarter-ticket', async () => {
    _byLevel.set(17, byTraitPayload({ cards: [] }));
    await packWatchMod.recordPendingPack({
      address: TEST_ADDR,
      level: 17,
      expectedTickets: 0.25,
    });
    const loose = cardAt(0, 'opened', [1]);
    const payload = byTraitPayload({ cards: [loose] });
    payload.totalEntries = 1;
    _byLevel.set(17, payload);

    const el = mount();
    await flushMicrotasks();
    assert.equal(el.querySelectorAll('.ticket-entry-card').length, 0,
      'the rolled trait cannot leak before its pack is consumed');
    assert.match(el.querySelector('[data-bind="inv-meta"]').textContent, /^0 cards/);

    await packWatchMod.completePackReveal({
      address: TEST_ADDR,
      level: 17,
      itemKeys: ['entry:0'],
      entryCount: 1,
    });
    storeMod.update('app.lastDay', {
      day: 67,
      status: 'resolved',
      level: 17,
      roll1: { purchaseLevel: 17 },
    });
    await flushMicrotasks();

    assert.equal(el.querySelectorAll('.ticket-entry-card').length, 1);
    assert.match(el.querySelector('[data-bind="inv-meta"]').textContent, /^0 cards · 1 entry/);
    el.disconnectedCallback();
  });

  test('404 / no tickets → empty state, no crash', async () => {
    const el = mount();
    await flushMicrotasks();

    const empty = el.querySelector('.inv-empty');
    assert.ok(empty, 'empty state rendered');
    assert.match(empty.textContent, /No tickets at level 17/, 'level-specific copy');
    el.disconnectedCallback();
  });

  test('inventory does not duplicate the fixed bottom reveal tray', async () => {
    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="inv-reveal-shelf"]'), null);
    assert.doesNotMatch(el.innerHTML, /OPEN YOUR ITEMS/);
    el.disconnectedCallback();
  });
});

describe('active level = the actual last day\'s roll1.purchaseLevel', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    await import('../app-tickets-inventory.js');
  });

  test('purchaseLevel wins over the count-weighted lastDay.level field', async () => {
    _byLevel.set(25, byTraitPayload({ level: 25, cards: [card('opened')] }));
    // Live day-130 shape: level field reads the AWARD level (26, one high —
    // ticket/bonus rows outnumber eth rows); purchaseLevel is the truth (25).
    storeMod.update('app.lastDay', {
      day: 130, status: 'resolved', level: 26,
      roll1: { day: 130, level: 26, purchaseLevel: 25, wins: [] },
    });

    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="inv-level"]').textContent, '25',
      'active = roll1.purchaseLevel, not the award-weighted level field');
    assert.match(el.querySelector('[data-bind="inv-tag"]').textContent, /active/, 'tagged active');
    el.disconnectedCallback();
  });

  test('fallback while last-day lacks roll1: /game/state mint formula', async () => {
    _gameState = { level: 16, phase: 'PURCHASE', jackpotPhaseFlag: false };
    _byLevel.set(17, byTraitPayload({ level: 17, cards: [] }));
    storeMod.update('app.lastDay', { day: 74, status: 'resolved', level: 18 });

    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="inv-level"]').textContent, '17',
      'fallback = state.level + 1 in purchase phase');
    el.disconnectedCallback();
  });
});

// Account-switcher (2026-07-16) — mode 'combined' renders an owner-tagged
// level list from app.playerCombined.tickets[] instead of fetching the
// single-address by-trait/dashboard endpoints (which have no combined-view
// analog — /tickets/by-trait is single-address only).
describe('app-tickets-inventory — combined mode (account-switcher)', () => {
  const OTHER_ADDR = '0xcccc000000000000000000000000000000000003';

  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', TEST_ADDR);
    storeMod.update('app.lastDay', { day: 67, status: 'resolved', level: 17 });
    await import('../app-tickets-inventory.js');
  });

  test('renders owner-tagged rows from app.playerCombined.tickets[]; by-trait/player never fetched', async () => {
    storeMod.update('app.gameState', {
      level: 16,
      phase: 'PURCHASE',
      jackpotPhaseFlag: false,
      gameOver: false,
    });
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    storeMod.update('app.playerCombined', {
      addresses: [TEST_ADDR, OTHER_ADDR],
      perAddress: {},
      claimableEth: '0', flipBalance: '0', dgnrsBalance: '0',
      coinflip: null, decimator: { claimablePerLevel: [], futurePoolTotal: '0' }, terminal: null,
      tickets: [
        { level: 17, entryCount: 16, owner: TEST_ADDR },   // 4 tickets
        { level: 18, entryCount: 8, owner: OTHER_ADDR },   // 2 tickets
      ],
    });

    const el = mount();
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="inv-cards"]').hidden, true, 'cards view hidden');
    assert.equal(el.querySelector('[data-bind="inv-chart"]').hidden, true, 'chart view hidden');
    const combined = el.querySelector('[data-bind="inv-combined"]');
    assert.equal(combined.hidden, false, 'combined view visible');

    const rows = combined.querySelectorAll('.inv-combined-row');
    assert.equal(rows.length, 2, 'one row per (level, owner)');
    const levels = rows.map((r) => r.querySelector('.inv-combined-level').textContent);
    assert.deepEqual(levels, ['L17', 'L18'], 'sorted by level ascending');
    const owners = rows.map((r) => r.querySelector('.inv-combined-owner').textContent);
    assert.equal(owners[0], '0xab…00', 'abbreviated owner tag for TEST_ADDR');
    assert.equal(owners[1], '0xcc…03', 'abbreviated owner tag for OTHER_ADDR');
    const counts = rows.map((r) => r.querySelector('.inv-combined-count').textContent);
    assert.deepEqual(counts, ['4 tickets', '2 tickets']);
    assert.equal(el.querySelector('[data-bind="inv-total-value"]').textContent, '0.24 ETH',
      'combined accounts share the same unresolved face-value aggregate');

    assert.ok(_fetchLog.every((u) => !u.includes('/tickets/by-trait')), 'by-trait endpoint never fetched in combined mode');
    assert.ok(_fetchLog.every((u) => !/\/player\/0x[0-9a-f]+$/i.test(u)), '/player/:address dashboard never fetched in combined mode');

    el.disconnectedCallback();
  });

  test('empty combined tickets → empty-state message, no rows', async () => {
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    storeMod.update('app.playerCombined', {
      addresses: [TEST_ADDR], perAddress: {}, claimableEth: '0', flipBalance: '0', dgnrsBalance: '0',
      coinflip: null, decimator: { claimablePerLevel: [], futurePoolTotal: '0' }, terminal: null, tickets: [],
    });

    const el = mount();
    await flushMicrotasks();

    const combined = el.querySelector('[data-bind="inv-combined"]');
    assert.equal(combined.hidden, false);
    const empty = combined.querySelector('.inv-empty');
    assert.ok(empty, 'empty-state paragraph rendered');
    assert.match(empty.textContent, /No tickets across the combined accounts\./);
    assert.equal(combined.querySelectorAll('.inv-combined-row').length, 0);
    el.disconnectedCallback();
  });

  test('leaving combined mode restores the cards view', async () => {
    _byLevel.set(17, byTraitPayload({ cards: [card('opened')] }));
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    storeMod.update('app.playerCombined', {
      addresses: [TEST_ADDR], perAddress: {}, claimableEth: '0', flipBalance: '0', dgnrsBalance: '0',
      coinflip: null, decimator: { claimablePerLevel: [], futurePoolTotal: '0' }, terminal: null,
      tickets: [{ level: 17, entryCount: 4, owner: TEST_ADDR }],
    });
    const el = mount();
    await flushMicrotasks();
    assert.equal(el.querySelector('[data-bind="inv-combined"]').hidden, false);

    storeMod.update('viewing.combined', false);
    storeMod.update('ui.mode', 'self');
    await flushMicrotasks();

    assert.equal(el.querySelector('[data-bind="inv-combined"]').hidden, true, 'combined view hidden again');
    assert.equal(el.querySelector('[data-bind="inv-cards"]').hidden, false, 'cards view restored');
    el.disconnectedCallback();
  });
});
