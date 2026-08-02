// /app/components/__tests__/reveal-overlay.test.js — prize reveal engine.
// Run: cd website && node --test app/components/__tests__/reveal-overlay.test.js
//
// Covers: normalizeSequence (pure — legs/pack/jackpot → prize cards),
// queueReveal buffering before mount, and the reduced-motion fast path
// (straight to summary, tap to dismiss, scroll unlock).
//
// The fakeDOM scaffold is a trimmed port of app-decimator-panel.test.js.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (must exist BEFORE the component import).
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
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    remove() { /* noop */ },
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
globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};
const _docBody = makeFakeElement('body');
const _docListeners = new Map();
globalThis.document = {
  createElement: (tag) => makeFakeElement(tag),
  body: _docBody,
  addEventListener(type, fn) {
    if (!_docListeners.has(type)) _docListeners.set(type, []);
    _docListeners.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    const listeners = _docListeners.get(type) || [];
    const index = listeners.indexOf(fn);
    if (index >= 0) listeners.splice(index, 1);
  },
  dispatchEvent(event) {
    for (const fn of _docListeners.get(event?.type) || []) fn(event);
    return true;
  },
  visibilityState: 'visible',
};
globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
// Reduced motion ON — the deterministic fast path (straight to summary).
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

const {
  queueReveal, normalizeSequence, buildDegeneretteSpinFrames, buildBoxSpinBoard,
  goldTicketLabel, __resetForTest, PACK_REVEAL_COMPLETE_EVENT,
} =
  await import('../reveal-overlay.js');
const { dgnUnpackTicket } = await import('../../app/dgn-traits.js');
const pendingActionsMod = await import('../../app/pending-actions.js');

const REVEAL_SRC = readFileSync(new URL('../reveal-overlay.js', import.meta.url), 'utf8');
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 5));

// ---------------------------------------------------------------------------
// normalizeSequence (pure)
// ---------------------------------------------------------------------------

describe('normalizeSequence', () => {
  test('lootbox legs → cards: opened splits into tickets + flip; spin keeps reel payload', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      lootboxIndex: 47,
      legs: [
        { legType: 'opened', wholeTickets: 11, futureLevel: 6, flip: 12_345n * 10n ** 18n },
        {
          legType: 'spin', spinType: 'eth', spinCount: 1, survived: null,
          payout: 100n, ethShare: 40n, reels: [{ spinIndex: 0, score: 2, playerTraits: [], resultTraits: [] }],
        },
      ],
    });
    assert.equal(seq.kind, 'lootbox');
    assert.equal(seq.cards.length, 3);
    assert.equal(seq.cards[0].type, 'tickets');
    assert.equal(seq.cards[0].label, 'LEVEL 6 TICKETS');
    assert.equal(seq.cards[0].value, '11');
    assert.equal(seq.cards[1].type, 'flip');
    assert.equal(seq.cards[1].value, '12,345', 'whole-coin rewards use thousands separators');
    assert.equal(seq.cards[1].sub, undefined, 'FLIP receipt has no misleading action list');
    assert.match(
      APP_CSS,
      /\.rvl-card--dgnrs \.rvl-card-value\s*\{[^}]*white-space:\s*nowrap[^}]*overflow-wrap:\s*normal/s,
      'seven-figure DGNRS amounts stay together instead of wrapping at a comma',
    );
    assert.equal(seq.cards[2].type, 'spins');
    assert.equal(seq.cards[2].rarity, 'rare', 'the mystery card has a neutral rarity');
    assert.equal(seq.cards[2].revealedRarity, 'epic', 'ETH becomes epic after the reveal');
    assert.equal(seq.cards[2].label, 'MYSTERY BOX SPIN');
    assert.equal(seq.cards[2].value, '?', 'the mystery card does not leak its reel count');
    assert.equal(seq.cards[2].revealedValue, '×1', 'the reel count appears with the result');
    assert.doesNotMatch(seq.cards[2].label, /ETH|FLIP|WWXRP/,
      'the pre-spin card does not spoil the currency');
    assert.equal(seq.cards[2].revealedLabel, 'ETH SPIN');
    assert.equal(seq.cards[2].spin.reels.length, 1);
    assert.equal(seq.boxIndex, '47', 'the branded box can identify the RNG batch');
    assert.equal(seq.boxSpinCount, 1);
    assert.equal(seq.big, true, 'epic card marks the sequence big');
  });

  test('whale pass leg → legendary card', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [{ legType: 'whalepass', targetLevel: 13, entriesPerLevel: 400 }],
    });
    assert.equal(seq.cards[0].type, 'whalepass');
    assert.equal(seq.cards[0].rarity, 'legendary');
  });

  test('an indexed replay miss still presents an honest already-resolved box card', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      lootboxIndex: 9,
      legs: [{ legType: 'settled' }],
    });
    assert.equal(seq.cards.length, 1);
    assert.equal(seq.cards[0].type, 'settled');
    assert.equal(seq.cards[0].label, 'BOX ALREADY RESOLVED');
    assert.match(seq.cards[0].sub, /credited on-chain/i);
  });

  test('multiple BoxSpin legs remain separate verified presentations in receipt order', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [
        {
          legType: 'spin', spinType: 'wwxrp', payout: 2n,
          reels: [{ playerTicket: 1n, resultTicket: 2n, score: 4 }],
        },
        {
          legType: 'spin', spinType: 'flip', survived: false, payout: 0n,
          reels: [
            { playerTicket: 3n, resultTicket: 4n, score: 1 },
            { playerTicket: 5n, resultTicket: 6n, score: 2 },
            { playerTicket: 7n, resultTicket: 8n, score: 3 },
          ],
        },
      ],
    });
    assert.deepEqual(seq.cards.map((card) => card.spin.spinType), ['wwxrp', 'flip']);
    assert.ok(seq.cards.every((card) => card.label === 'MYSTERY BOX SPIN'));
    assert.ok(seq.cards.every((card) => card.rarity === 'rare'),
      'pre-spin card styling cannot leak the currency lane');
    assert.deepEqual(seq.cards.map((card) => card.revealedLabel), ['WWXRP SPIN', 'FLIP SPINS']);
    assert.deepEqual(seq.cards.map((card) => card.value), ['?', '?'],
      'one-reel and three-reel lanes look identical before the first spin');
    assert.deepEqual(seq.cards.map((card) => card.revealedValue), ['×1', '×3']);
    assert.equal(seq.boxSpinCount, 4, 'all emitted reels are scheduled, not collapsed');
  });

  test('empty legs → null (nothing to show)', () => {
    assert.equal(normalizeSequence({ kind: 'lootbox', legs: [] }), null);
  });

  test('pack: sealed tickets card with level + count', () => {
    const seq = normalizeSequence({ kind: 'pack', count: 5, level: 3, pending: true });
    assert.equal(seq.kind, 'pack');
    assert.equal(seq.level, 3, 'target level survives for the wrapper label');
    assert.match(seq.title, /TICKET PACK · LEVEL 3/);
    assert.equal(seq.cards.length, 1);
    assert.equal(seq.cards[0].value, '5');
    assert.equal(seq.cards[0].label, 'LEVEL 3 TICKETS');
    assert.match(seq.cards[0].sub, /Sealed/);
  });

  test('pack with zero count → null', () => {
    assert.equal(normalizeSequence({ kind: 'pack', count: 0 }), null);
  });

  test('pack with real tickets deals one card per ticket, carrying its trait ids', () => {
    // The deferred reveal (app/app/pack-watch.js): once the draw rolls, the
    // popup shows the actual four-symbol tickets rather than a sealed pack.
    const seq = normalizeSequence({
      kind: 'pack',
      level: 7,
      count: 3,
      extra: 1,
      tickets: [{ traitIds: [1, 70, 130, 200] }, { traitIds: [2, 71, 131, 201] }],
    });
    assert.equal(seq.cards.length, 2, 'one card per ticket');
    assert.deepEqual(seq.cards[0].traitIds, [1, 70, 130, 200]);
    assert.equal(seq.cards[0].label, 'TICKET 1');
    assert.match(seq.cards[1].sub, /\+1 more/, 'remainder called out on the last card');
    assert.equal(seq.big, true, 'real tickets are a headline moment');
  });

  test('gold-ticket hero names its actual gold symbol and rebuilds the whole ticket at full size', () => {
    assert.equal(goldTicketLabel([56, 65, 130, 195]), 'GOLD XRP');
    assert.equal(goldTicketLabel([56, 65, 189, 195]), 'GOLD XRP · GOLD CASH SACK');
    assert.match(
      REVEAL_SRC,
      /const heroTicket = this\.#buildPaperTicket\(traitIds, foil\)[\s\S]*?rvl-gold-hit__ticket[\s\S]*?hit\.appendChild\(heroTicket\)/,
      'gold beat presents a complete duplicate ticket rather than only its gold quadrant',
    );
    assert.doesNotMatch(REVEAL_SRC, /label\.textContent = 'GOLD TRAIT'/);
    assert.match(
      APP_CSS,
      /\.rvl-gold-hit__ticket\s*\{[\s\S]*?width:\s*min\(78vw, 48vh, 360px\)/,
      'hero ticket gets a dedicated large presentation size',
    );
  });

  test('normal and foil packs save every gold ticket for the end of the reveal', () => {
    const tickets = [
      { traitIds: [56, 65, 130, 195] },       // gold crypto
      { traitIds: [1, 65, 130, 195] },        // plain
      { traitIds: [2, 66, 131, 196] },        // plain
      { traitIds: [3, 67, 184, 197] },        // gold cards
    ];
    for (const foilPack of [false, true]) {
      const seq = normalizeSequence({
        kind: 'pack', level: 12, count: 4, foilPack,
        tickets: tickets.map((ticket) => ({ ...ticket, foil: foilPack })),
      });
      const isGold = (ticket) => ticket.traitIds.some((tid) => ((tid >> 3) & 7) === 7);
      assert.deepEqual(seq.ticketGrid.map(isGold), [false, false, true, true]);
      assert.deepEqual(seq.cards.map(isGold), [false, false, true, true]);
    }
  });

  test('foil tickets normalize as their own level-labelled headline pack', () => {
    const tickets = Array.from({ length: 4 }, (_, i) => ({
      traitIds: [i, 64 + i, 128 + i, 192 + i],
      foil: true,
    }));
    const seq = normalizeSequence({
      kind: 'pack',
      level: 12,
      count: tickets.length,
      foilPack: true,
      tickets,
    });
    assert.equal(seq.foilPack, true);
    assert.equal(seq.level, 12);
    assert.match(seq.title, /FOIL PACK · LEVEL 12/);
    assert.equal(seq.ticketGrid.length, 4);
    assert.ok(seq.ticketGrid.every((ticket) => ticket.foil), 'all four presentation cards are foil');
    assert.ok(seq.cards.every((card) => card.rarity === 'epic' && card.foil));
  });

  test('pack reveal refuses partial and duplicate-quadrant ticket shapes', () => {
    const seq = normalizeSequence({
      kind: 'pack',
      level: 7,
      count: 3,
      tickets: [
        { traitIds: [1, 70, 130] },
        { traitIds: [1, 2, 130, 200] },
        { traitIds: [3, 70, 130, 200] },
      ],
    });
    assert.equal(seq.ticketGrid.length, 1, 'only the whole four-quadrant ticket is dealt');
    assert.deepEqual(seq.ticketGrid[0].traitIds, [3, 70, 130, 200]);

    const allBad = normalizeSequence({
      kind: 'pack', level: 7, count: 1, tickets: [{ traitIds: [1, 70, 130] }],
    });
    assert.equal(allBad.ticketGrid, undefined, 'an incomplete card falls back to sealed copy');
    assert.equal(allBad.cards[0].value, '1');
  });

  test('pack batches preserve their index/count for next-pack and open-all controls', () => {
    const seq = normalizeSequence({
      kind: 'pack',
      title: 'YOUR TICKETS',
      level: 7,
      count: 10,
      totalCount: 23,
      batchId: 'batch-23',
      packIndex: 2,
      packCount: 3,
      tickets: Array.from({ length: 10 }, (_, i) => ({ traitIds: [i, 70, 130, 200] })),
    });
    assert.equal(seq.ticketGrid.length, 10);
    assert.equal(seq.batchId, 'batch-23');
    assert.equal(seq.packIndex, 2);
    assert.equal(seq.packCount, 3);
    assert.equal(seq.totalCount, 23);
    assert.match(seq.title, /PACK 2\/3/);
  });

  test('jackpot: eth + flip + tickets prizes; autoStart + big; zero amounts dropped', () => {
    const seq = normalizeSequence({
      kind: 'jackpot',
      day: 15,
      prizes: [
        { type: 'eth', amount: 169447412695n },
        { type: 'flip', amount: 0n },
        { type: 'tickets', amount: 2, level: 3 },
      ],
    });
    assert.equal(seq.autoStart, true);
    assert.equal(seq.big, true);
    assert.equal(seq.title, 'DAY 15 SUMMARY');
    assert.equal(seq.cards.length, 2, 'zero-amount flip dropped');
    assert.equal(seq.cards[0].type, 'eth');
    assert.equal(seq.cards[1].label, 'LEVEL 3 TICKETS');
  });

  test('an empty-draw coinflip participant gets a full 1 WWXRP reward card', () => {
    const seq = normalizeSequence({
      kind: 'jackpot',
      day: 9,
      prizes: [{ type: 'wwxrp', amount: 10n ** 18n }],
      noWin: null,
      consolationOnly: true,
    });
    assert.equal(seq.big, true);
    assert.equal(seq.consolationOnly, true);
    assert.equal(seq.cards.length, 1);
    assert.equal(seq.cards[0].type, 'wwxrp');
    assert.equal(seq.cards[0].value, '1');
    assert.equal(seq.cards[0].label, 'WWXRP');
    assert.equal(seq.cards[0].icon, '/shared/coinflip-face-red.svg');
  });

  test('jackpot with no prizes + noWin payload → single NO HIT summary card (not big)', () => {
    const seq = normalizeSequence({
      kind: 'jackpot', day: 9, prizes: [], noWin: { sub: '59 winners this day' },
    });
    assert.equal(seq.title, 'DAY 9 SUMMARY');
    assert.equal(seq.daySummary, true, 'the receipt gets its own non-squeezing layout');
    assert.equal(seq.big, false, 'no fanfare-scale celebration for a miss');
    assert.equal(seq.autoStart, true);
    assert.equal(seq.cards.length, 1);
    assert.equal(seq.cards[0].type, 'nowin');
    assert.equal(seq.cards[0].label, 'NO HIT');
    assert.match(seq.cards[0].sub, /59 winners/);
  });

  test('jackpot with no prizes and NO noWin payload → null (auto-celebration path unchanged)', () => {
    assert.equal(normalizeSequence({ kind: 'jackpot', day: 9, prizes: [] }), null);
    assert.equal(normalizeSequence({ kind: 'jackpot', day: 9, prizes: [{ type: 'eth', amount: 0n }] }), null);
  });

  test('day summary includes DB-backed ticket packs and lootboxes alongside the draw result', () => {
    const seq = normalizeSequence({
      kind: 'jackpot',
      day: 9,
      prizes: [],
      noWin: { sub: 'No winners recorded this day.' },
      activity: {
        ticketPacks: 2,
        ticketCount: 14,
        lootboxesBought: 3,
        lootboxesOpened: 2,
      },
    });
    assert.equal(seq.title, 'DAY 9 SUMMARY');
    assert.deepEqual(seq.cards.map((card) => card.type), [
      'nowin', 'ticket-packs', 'lootboxes-bought',
    ]);
    assert.equal(seq.cards[1].value, '×2');
    assert.match(seq.cards[1].sub, /14 tickets/);
    assert.equal(seq.cards[2].value, '×3');
    assert.match(seq.cards[2].sub, /2 opened/);
  });

  test('day summary includes the settled coinflip stake result and winning multiplier', () => {
    const stake = 250n * 10n ** 18n;
    const won = normalizeSequence({
      kind: 'jackpot',
      day: 9,
      prizes: [],
      activity: {
        hasCoinflipBet: true,
        coinflipWon: true,
        coinflipStakeAmount: stake.toString(),
        coinflipRewardPercent: 82,
      },
    });
    const winCard = won.cards.find((card) => card.type === 'coinflip-result');
    assert.ok(winCard);
    assert.equal(winCard.value, 'WIN +455 FLIP');
    assert.equal(winCard.sub, '182%');
    assert.equal(winCard.icon, '/shared/coinflip-face-eth.svg');
    assert.equal(winCard.outcome, 'win');

    const lost = normalizeSequence({
      kind: 'jackpot',
      day: 9,
      prizes: [{ type: 'wwxrp', amount: 10n ** 18n }],
      activity: {
        hasCoinflipBet: true,
        coinflipWon: false,
        coinflipStakeAmount: stake.toString(),
      },
    });
    const lossCard = lost.cards.find((card) => card.type === 'coinflip-result');
    assert.ok(lossCard);
    assert.equal(lossCard.value, 'LOSS -250 FLIP');
    assert.equal(lossCard.outcome, 'loss');
  });

  test('unknown kind / junk → null', () => {
    assert.equal(normalizeSequence({ kind: 'nope' }), null);
    assert.equal(normalizeSequence(null), null);
  });

  test('pari result becomes a no-vessel paid or lost result card', () => {
    const paid = normalizeSequence({
      kind: 'pari',
      market: 'growth',
      round: 12,
      side: 1,
      outcome: 1,
      payout: 2500n * 10n ** 18n,
    });
    assert.equal(paid.noVessel, true);
    assert.equal(paid.autoStart, true);
    assert.equal(paid.title, 'PARI PAID');
    assert.equal(paid.cards[0].type, 'flip');
    assert.equal(paid.cards[0].label, 'GROWTH · LEVEL 12');
    assert.match(paid.cards[0].value, /FLIP$/);

    const lost = normalizeSequence({
      kind: 'pari',
      market: 'volume',
      round: 7,
      side: 2,
      outcome: 1,
      payout: 0n,
    });
    assert.equal(lost.title, 'PARI RESULT');
    assert.equal(lost.cards[0].type, 'nowin');
    assert.equal(lost.cards[0].value, 'UNDER LOST');
    assert.match(lost.cards[0].sub, /OVER paid/);
  });

  // Degenerette bet board (user ask 2026-07-29): one row per spin. The pick is
  // constant down the board; the house reel is not — spin 0's comes off
  // DegeneretteResolved, the rest from dgn-reels.js.
  test('degenerette: a row per spin, ETH unit, hero carried, no survival flip', () => {
    const seq = normalizeSequence({
      kind: 'degenerette',
      currency: 0,
      heroIdx: 2,
      amountPerSpin: 10n ** 16n,
      totalPayout: 3n * 10n ** 16n,
      spins: [
        { spinIndex: 0, playerTraits: 13, houseTraits: 13, score: 3, payout: 3n * 10n ** 16n },
        { spinIndex: 1, playerTraits: 13, houseTraits: 99, score: 0, payout: 0n },
        { spinIndex: 2, playerTraits: 13, houseTraits: null, score: 1, payout: 0n },
      ],
    });
    assert.ok(seq, 'sequence normalizes');
    // No vessel (the bet already rolled, nothing is sealed) and no sequence-level
    // auto-start: the board runs its own TAP TO SPIN gate so the player starts
    // the spin-through themselves.
    assert.equal(seq.autoStart, false);
    assert.equal(seq.noVessel, true);
    assert.equal(seq.big, true, 'a paid bet is a headline sequence');
    assert.equal(seq.spinBoard.rows.length, 3);
    assert.equal(seq.spinBoard.unit, 'ETH');
    assert.equal(seq.spinBoard.heroIdx, 2);
    assert.equal(seq.spinBoard.amountPerSpin, 10n ** 16n);
    assert.equal(seq.spinBoard.totalWager, 3n * 10n ** 16n,
      'total wager is retained for the result and net readouts');
    assert.equal(seq.spinBoard.survived, null, 'ETH bets have no survival flip');
    assert.equal(seq.spinBoard.rows[2].houseTraits, null, 'an unverified reel stays absent');
    assert.equal(seq.cards.length, 1, 'one summary card for the bet');
    assert.match(seq.cards[0].sub, /1 of 3 paid/);
  });

  test('degenerette: rows sort by spinIndex regardless of event order', () => {
    const mk = (i) => ({ spinIndex: i, playerTraits: 1, houseTraits: 1, score: 0, payout: 0n });
    const seq = normalizeSequence({
      kind: 'degenerette', currency: 0, totalPayout: 0n, spins: [mk(2), mk(0), mk(1)],
    });
    // Normalization keeps event order; dgn-reels.js sorts. Assert the rows are
    // all present so a caller-side sort is the only ordering contract.
    assert.equal(seq.spinBoard.rows.length, 3);
    assert.equal(seq.title, 'NO HITS');
  });

  test('degenerette: zero final FLIP payout does not stage a survival flip', () => {
    const seq = normalizeSequence({
      kind: 'degenerette',
      currency: 1,
      totalPayout: 0n,
      spins: [{ spinIndex: 0, playerTraits: 13, houseTraits: 13, score: 5, payout: 500n }],
    });
    assert.equal(seq.spinBoard.survived, null);
    assert.equal(seq.spinBoard.spinSum, 500n);
    assert.equal(seq.title, 'NO HITS');
    assert.match(seq.cards[0].sub, /house took/i);
  });

  test('degenerette: a FLIP bet paying double survived the flip', () => {
    const seq = normalizeSequence({
      kind: 'degenerette',
      currency: 1,
      totalPayout: 1000n,
      spins: [{ spinIndex: 0, playerTraits: 13, houseTraits: 13, score: 5, payout: 500n }],
    });
    assert.equal(seq.spinBoard.survived, true);
    assert.equal(seq.title, 'YOU WON');
  });

  test('degenerette: WWXRP unit, and no spins → null', () => {
    const seq = normalizeSequence({
      kind: 'degenerette', currency: 3, totalPayout: 7n,
      spins: [{ spinIndex: 0, playerTraits: 1, houseTraits: 2, score: 1, payout: 7n }],
    });
    assert.equal(seq.spinBoard.unit, 'WWXRP');
    assert.equal(normalizeSequence({ kind: 'degenerette', currency: 0, spins: [] }), null);
  });
});

describe('buildBoxSpinBoard', () => {
  test('preserves every verified reel and keeps a three-spin FLIP payout group-level', () => {
    const board = buildBoxSpinBoard({
      spinType: 'flip',
      survived: true,
      payout: 900n,
      reels: [
        { spinIndex: 0, playerTicket: 0xC3824100n, resultTicket: 0xC7864504n, score: 2 },
        { spinIndex: 1, playerTicket: 0xC4834201n, resultTicket: 0xC8874605n, score: 5 },
        { spinIndex: 2, playerTicket: 0xC5844302n, resultTicket: 0xC9884706n, score: 9 },
      ],
    });
    assert.equal(board.boxSpin, true);
    assert.equal(board.unit, 'FLIP');
    assert.equal(board.rows.length, 3);
    assert.deepEqual(board.rows.map((row) => row.score), [2, 5, 9]);
    assert.ok(board.rows.every((row) => row.payout === null),
      'the UI never invents per-reel money the event does not publish');
    assert.equal(board.total, 900n);
    assert.equal(board.survived, true);
    assert.match(board.headline, /CURRENCY HIDDEN/);
    assert.doesNotMatch(board.headline, /ETH|FLIP|WWXRP/,
      'the board heading stays neutral until the first reel lands');
  });

  test('ETH box result presents only the claimable share as winnings', () => {
    const board = buildBoxSpinBoard({
      spinType: 'eth',
      payout: 100n,
      ethShare: 40n,
      reels: [{ playerTicket: 1n, resultTicket: 2n, score: 4 }],
    });
    assert.equal(board.grossPayout, 100n, 'gross remains available for audit/presentation');
    assert.equal(board.total, 40n, 'recirculated ETH is not presented as player winnings');
    assert.equal(board.unit, 'ETH');
    assert.equal(board.survived, null);
  });

  test('zero-payout FLIP box result does not stage a survival flip', () => {
    const board = buildBoxSpinBoard({
      spinType: 'flip',
      survived: false,
      payout: 0n,
      reels: [{ playerTicket: 1n, resultTicket: 2n, score: 0 }],
    });
    assert.equal(board.total, 0n);
    assert.equal(board.survived, null);
  });

  test('rejects unknown or empty spin payloads instead of fabricating reels', () => {
    assert.equal(buildBoxSpinBoard({ spinType: 'mystery', reels: [{}] }), null);
    assert.equal(buildBoxSpinBoard({ spinType: 'wwxrp', reels: [] }), null);
  });

  test('mystery policy reveals currency after reel one, then exposes the remaining count', () => {
    assert.match(
      REVEAL_SRC,
      /completed = i \+ 1;[\s\S]*?if \(board\.boxSpin && i === 0\)[\s\S]*?#appendBoxSpinCurrencyReveal[\s\S]*?interstitial: count > 1/,
      'the reveal beat is attached to the first settled reel, not the end of the board',
    );
    assert.match(REVEAL_SRC, /const countIsRevealed = !board\.boxSpin \|\| i > 0/,
      'the FLIP-identifying reel count stays hidden before reel one');
  });
});

describe('buildDegeneretteSpinFrames', () => {
  test('ports the standalone eight-lock plan and lands on the verified ticket', () => {
    const args = {
      playerTraits: 0x12345678,
      houseTraits: 0xE7C6A589,
      spinIndex: 4,
    };
    const frames = buildDegeneretteSpinFrames(args);
    const target = dgnUnpackTicket(args.houseTraits);
    const lockFrames = frames.filter((frame) => frame.lock != null);

    assert.ok(frames.length >= 24 && frames.length <= 40,
      `2–4 idle rolls between eight locks, got ${frames.length} frames`);
    assert.equal(lockFrames.length, 8, 'four color locks + four symbol locks');
    assert.ok(frames.some((frame) => frame.lock == null), 'whole-token idle rolls are present');
    for (let q = 0; q < 4; q++) {
      const colorAt = frames.findIndex((frame) => (
        frame.lock?.quadrant === q && frame.lock.type === 'color'
      ));
      const symbolAt = frames.findIndex((frame) => (
        frame.lock?.quadrant === q && frame.lock.type === 'symbol'
      ));
      assert.ok(colorAt >= 0 && symbolAt > colorAt,
        `quadrant ${q} locks color before symbol`);
      for (const frame of frames) {
        if (frame.lockedColors[q]) assert.equal(frame.traits[q].col, target[q].col);
        if (frame.lockedSymbols[q]) assert.equal(frame.traits[q].sym, target[q].sym);
      }
    }
    const final = frames.at(-1);
    assert.deepEqual(final.traits, target, 'last frame is the chain-derived house ticket');
    assert.deepEqual(final.lockedColors, [true, true, true, true]);
    assert.deepEqual(final.lockedSymbols, [true, true, true, true]);
    assert.deepEqual(buildDegeneretteSpinFrames(args), frames, 'plan is deterministic per spin');
  });
});

// ---------------------------------------------------------------------------
// Element behavior — buffering + reduced-motion summary flow
// ---------------------------------------------------------------------------

function instantiate() {
  const Ctor = customElements.get('reveal-overlay');
  const el = new Ctor();
  el.connectedCallback();
  return el;
}

describe('reveal-overlay element', () => {
  beforeEach(() => {
    __resetForTest();
    pendingActionsMod.__resetPendingActionsForTest();
  });

  test('queueReveal before mount buffers; connect drains and shows summary (reduced motion)', async () => {
    assert.equal(queueReveal({ kind: 'pack', count: 3, level: 2, pending: true }), true);
    const el = instantiate();
    await tick();
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    assert.equal(backdrop.hidden, false, 'backdrop visible');
    const title = el.querySelector('[data-bind="rvl-title"]');
    assert.equal(title.textContent, 'TICKET PACK · LEVEL 2');
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.hidden, false, 'summary rendered directly');
    assert.equal(summary.querySelectorAll('.rvl-card').length, 1);
    // Tap dismisses (COLLECT path shares the same tap resolver).
    backdrop.dispatchEvent({ type: 'click' });
    await tick();
    assert.equal(backdrop.hidden, true, 'backdrop hidden after tap');
  });

  test('pack shell carries the Degenerus mark plus dynamic edition and level hooks', () => {
    const el = instantiate();
    assert.ok(el.querySelector('.rvl-pack-logo'), 'Degenerus logo is on the wrapper');
    assert.ok(el.querySelector('.rvl-pack-wordmark'), 'Degenerus wordmark is on the wrapper');
    assert.ok(el.querySelector('[data-bind="rvl-pack-edition"]'));
    assert.ok(el.querySelector('[data-bind="rvl-pack-level"]'));
  });

  test('lootbox shell carries the viewport-safe branded staged opener', () => {
    const el = instantiate();
    assert.ok(el.querySelector('.rvl-chest-logo'), 'Degenerus logo is on the box');
    assert.ok(el.querySelector('.rvl-chest-wordmark'));
    assert.ok(el.querySelector('.rvl-chest-edition'));
    assert.match(el.innerHTML, /DEGENERUS/);
    assert.match(el.innerHTML, /LOOTBOX/);
    assert.ok(el.querySelector('.rvl-chest-clasp'), 'opening clasp is rendered');
    assert.doesNotMatch(el.innerHTML, /RNG VERIFIED/,
      'the case does not claim an unexplained verification state');
    assert.ok(el.querySelector('.rvl-chest-seam'), 'the light seam has its own crack beat');
    assert.ok(el.querySelector('.rvl-lootbox-beam'), 'reward beam is mounted behind the box');
    assert.ok(el.querySelector('.rvl-lootbox-rays'), 'radial release field is mounted');
    assert.equal(el.querySelectorAll('.rvl-lootbox-spark').length, 8,
      'the burst has a balanced particle ring');
    assert.match(APP_CSS, /--rvl-box-w:\s*min\(348px, 78vw, 49dvh\)/,
      'the case is bounded by both viewport axes');
    assert.match(APP_CSS, /@keyframes rvl-case-unlock/);
    assert.match(APP_CSS, /@keyframes rvl-case-lid-open/);
    assert.match(APP_CSS, /@keyframes rvl-case-rays/);
    assert.match(REVEAL_SRC, /const LOOTBOX_MANUAL_CHARGE_MS = 820/,
      'a single box gets a shorter anticipation beat');
    assert.match(REVEAL_SRC, /const LOOTBOX_AUTO_CHARGE_MS = 560/,
      'batched boxes use the faster automatic crack');
    assert.match(REVEAL_SRC, /const LOOTBOX_AUTO_RESULT_MS = 1_750/,
      'auto mode spends the recovered time on the readable result');
    assert.match(APP_CSS, /--rvl-box-charge:\s*0\.82s/,
      'the chest choreography tracks the shortened JS timing');
    assert.match(APP_CSS, /\.rvl-stage--auto-lootbox\s*\{[^}]*--rvl-box-charge:\s*0\.56s/s,
      'auto mode has a matching accelerated CSS choreography');
  });

  test('ordinary lootbox rewards reach the roomy receipt with detailed pack art and no heading', async () => {
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 47,
      legs: [{
        legType: 'opened',
        wholeTickets: 10,
        futureLevel: 63,
        flip: 250n * 10n ** 18n,
      }],
    });
    const el = instantiate();
    await tick();

    const title = el.querySelector('[data-bind="rvl-title"]');
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(title.hidden, true, 'the lootbox art needs no LOOTBOX REPLAY heading');
    assert.equal(summary.hidden, false, 'ordinary rewards cannot abort on a missing spin board');
    const pack = summary.querySelector('.rvl-reward-pack');
    assert.ok(pack, 'ticket rewards reuse the full opening-pack artwork');
    assert.equal(pack.querySelector('.rvl-pack-level').textContent, 'LEVEL 63');
    assert.equal(pack.querySelector('.rvl-pack-count').textContent, '10 TICKETS');
    assert.match(APP_CSS, /\.rvl-stage--lootbox \.rvl-summary-grid[^}]*minmax\(180px, 216px\)/,
      'lootbox receipt cards use the available screen area');
    assert.match(REVEAL_SRC, /if \(seq\.kind === 'lootbox'\)[\s\S]*cracks straight into its one contents screen/,
      'motion lootboxes do not deal the same reward cards once before the receipt');

    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('sDGNRS rewards use the three-flame ETH mark in a normal purple badge', async () => {
    queueReveal({
      kind: 'lootbox', lootboxIndex: 48,
      legs: [{ legType: 'dgnrs', amount: 12n * 10n ** 18n }],
    });
    const el = instantiate();
    await tick();

    const badge = el.querySelector('.sdgnrs-badge');
    assert.ok(badge, 'sDGNRS has a composed Degenerus badge');
    assert.equal(
      badge.querySelector('.sdgnrs-badge__frame')?.src,
      '/badges-circular/crypto_06_ethereum_purple.svg',
    );
    assert.equal(
      badge.querySelector('.sdgnrs-badge__mark')?.src,
      '/specials/special_eth.svg',
      'the badge center is the ETH mark with three flames',
    );
    assert.doesNotMatch(REVEAL_SRC, /special_dgnrs\.svg/,
      'the orange whale asset is no longer the sDGNRS reward icon');

    el.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a lootbox receipt can open the next pending box without returning to the tray', async () => {
    pendingActionsMod.publishPendingActions('next-box', [{
      id: 'lootbox:2', kind: 'lootbox', label: 'Lootbox #2', state: 'ready',
      run: async () => {
        pendingActionsMod.clearPendingActions('next-box');
        queueReveal({
          kind: 'lootbox', lootboxIndex: 2,
          legs: [{ legType: 'dgnrs', amount: 2n * 10n ** 18n }],
        });
      },
    }]);
    queueReveal({
      kind: 'lootbox', lootboxIndex: 1,
      legs: [{ legType: 'dgnrs', amount: 1n * 10n ** 18n }],
    });
    const el = instantiate();
    await tick();

    let summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.querySelector('.rvl-collect-cta').textContent, 'OPEN NEXT BOX');
    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 4; i += 1) await tick();

    summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.querySelector('.rvl-card-value').textContent, '2');
    assert.equal(summary.querySelector('.rvl-collect-cta').textContent, 'COLLECT');
    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('OPEN ALL BOXES queues every ready box and pauses on the final receipt', async () => {
    for (const [source, index] of [['box-two', 2], ['box-three', 3]]) {
      pendingActionsMod.publishPendingActions(source, [{
        id: `lootbox:${index}`, kind: 'lootbox', label: `Lootbox #${index}`,
        state: 'ready', order: index,
        run: async () => {
          pendingActionsMod.clearPendingActions(source);
          queueReveal({
            kind: 'lootbox', lootboxIndex: index,
            legs: [{ legType: 'dgnrs', amount: BigInt(index) * 10n ** 18n }],
          });
        },
      }]);
    }
    queueReveal({
      kind: 'lootbox', lootboxIndex: 1,
      legs: [{ legType: 'dgnrs', amount: 1n * 10n ** 18n }],
    });
    const el = instantiate();
    await tick();

    const summary = el.querySelector('[data-bind="rvl-summary"]');
    const openAll = summary.querySelector('.rvl-open-all-cta--lootboxes');
    assert.ok(openAll);
    assert.equal(openAll.textContent, 'OPEN ALL 2 BOXES');
    openAll.dispatchEvent({ type: 'click', stopPropagation() {} });
    await new Promise((resolve) => setTimeout(resolve, 240));
    await tick();

    const lingeringSummary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(lingeringSummary.querySelector('.rvl-card-value').textContent, '2',
      'auto mode leaves the intermediate reward readable instead of flashing past it');
    assert.equal(lingeringSummary.querySelector('.rvl-collect-cta').textContent, 'OPENING NEXT BOX…');

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await tick();

    const finalSummary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(finalSummary.querySelector('.rvl-card-value').textContent, '3');
    assert.equal(finalSummary.querySelector('.rvl-collect-cta').textContent, 'COLLECT');
    finalSummary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a direct no-vessel lootbox receipt also omits the generic LOOTBOX heading', async () => {
    queueReveal({
      kind: 'lootbox', noVessel: true,
      legs: [{ legType: 'dgnrs', amount: 3n * 10n ** 18n }],
    });
    const el = instantiate();
    await tick();
    assert.equal(el.querySelector('[data-bind="rvl-title"]').hidden, true);
    el.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('foil pack keeps its branded full 2×2 ticket hand in reduced motion', async () => {
    const tickets = Array.from({ length: 4 }, (_, i) => ({
      traitIds: [i, 64 + i, 128 + i, 192 + i],
      foil: true,
    }));
    queueReveal({ kind: 'pack', level: 12, count: 4, foilPack: true, tickets });
    const el = instantiate();
    await tick();
    assert.match(el.querySelector('[data-bind="rvl-title"]').textContent, /FOIL PACK · LEVEL 12/);
    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    const presentation = zone.querySelector('.rvl-foil-presentation');
    assert.ok(presentation, 'foil has a dedicated presentation, not an ordinary prize summary');
    assert.match(presentation.textContent, /LEVEL 12 · 4 BOOSTED TICKETS/);
    assert.match(presentation.textContent, /every Level 12 draw/);
    assert.ok(zone.querySelector('.rvl-ticket-grid-stage--foil'), 'dedicated 2-column foil grid');
    assert.equal(zone.querySelectorAll('.rvl-paper--foil').length, 4);
    assert.equal(el.querySelector('[data-bind="rvl-summary"]').hidden, true,
      'ticket hand never collapses into the generic summary');
    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
  });

  test('pack cards are released to inventory only after the player collects the hand', async () => {
    const completed = [];
    const onComplete = (event) => completed.push(event.detail);
    document.addEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
    queueReveal({
      kind: 'pack',
      level: 12,
      count: 1,
      tickets: [{ traitIds: [1, 70, 130, 200] }],
      packRelease: {
        address: '0xab12000000000000000000000000000000000000',
        level: 12,
        cardIndexes: [7],
      },
    });
    const el = instantiate();
    await tick();
    assert.equal(completed.length, 0, 'mounting the reveal does not leak the ticket early');

    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
    assert.deepEqual(completed, [{
      address: '0xab12000000000000000000000000000000000000',
      level: 12,
      cardIndexes: [7],
    }]);
    document.removeEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
  });

  test('two queued sequences chain under one backdrop', async () => {
    const el = instantiate();
    queueReveal({ kind: 'pack', count: 1, level: 2, pending: true });
    queueReveal({ kind: 'pack', count: 9, level: 4, pending: true });
    await tick();
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(backdrop.hidden, false);
    // First sequence's summary CTA says NEXT (queue non-empty).
    assert.equal(summary.querySelector('.rvl-collect-cta').textContent, 'NEXT ▸');
    backdrop.dispatchEvent({ type: 'click' });
    await tick();
    assert.equal(backdrop.hidden, false, 'second sequence still showing');
    const title = el.querySelector('[data-bind="rvl-title"]');
    assert.equal(title.textContent, 'TICKET PACK · LEVEL 4');
    backdrop.dispatchEvent({ type: 'click' });
    await tick();
    assert.equal(backdrop.hidden, true, 'queue drained');
  });

  test('ticket batches expose OPEN NEXT + OPEN ALL; open-all advances to the final pack', async () => {
    const el = instantiate();
    const ticket = (n) => ({ traitIds: [n, 70, 130, 200] });
    for (let packIndex = 1; packIndex <= 3; packIndex++) {
      queueReveal({
        kind: 'pack',
        title: 'YOUR TICKETS',
        level: 7,
        count: 1,
        totalCount: 3,
        batchId: 'batch-open-all',
        packIndex,
        packCount: 3,
        tickets: [ticket(packIndex)],
      });
    }
    await tick();

    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    assert.equal(zone.querySelector('.rvl-collect-cta').textContent, 'OPEN NEXT PACK');
    const openAll = zone.querySelector('.rvl-open-all-cta');
    assert.ok(openAll, 'open-all control is visible while packs remain');
    assert.match(openAll.textContent, /2 REMAINING/);

    openAll.dispatchEvent({ type: 'click' });
    await new Promise((r) => setTimeout(r, 230));
    assert.match(el.querySelector('[data-bind="rvl-title"]').textContent, /PACK 3\/3/,
      'intermediate pack auto-advanced and final pack remains visible');
    assert.equal(zone.querySelector('.rvl-open-all-cta'), null, 'no open-all button on final pack');
    assert.equal(zone.querySelector('.rvl-collect-cta').textContent, 'COLLECT');

    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
  });

  test('close button aborts the whole queue', async () => {
    const el = instantiate();
    queueReveal({ kind: 'pack', count: 1, level: 2, pending: true });
    queueReveal({ kind: 'pack', count: 2, level: 2, pending: true });
    await tick();
    const close = el.querySelector('[data-bind="rvl-close"]');
    close.dispatchEvent({ type: 'click' });
    await tick();
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    assert.equal(backdrop.hidden, true, 'closed immediately, queue dropped');
  });

  test('jackpot win summary offers SHARE MY WIN; pack summary does not', async () => {
    const el = instantiate();
    queueReveal({
      kind: 'jackpot', day: 15,
      prizes: [{ type: 'eth', amount: 169447412695n }],
    });
    await tick();
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    const share = summary.querySelector('.rvl-share-cta');
    assert.ok(share, 'share button rendered for a jackpot win');
    assert.equal(share.textContent, 'SHARE MY WIN');
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    backdrop.dispatchEvent({ type: 'click' });
    await tick();

    queueReveal({ kind: 'pack', count: 3, level: 2, pending: true });
    await tick();
    assert.equal(summary.querySelector('.rvl-share-cta'), null,
      'no share button on a ticket-pack purchase');
    backdrop.dispatchEvent({ type: 'click' });
    await tick();
  });

  test('NO HIT summary has no share button', async () => {
    const el = instantiate();
    queueReveal({ kind: 'jackpot', day: 9, prizes: [], noWin: { sub: 'miss' } });
    await tick();
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.querySelector('.rvl-share-cta'), null);
    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
  });

  test('reduced motion keeps the full-size settled result (content, not choreography)', async () => {
    assert.equal(queueReveal({
      kind: 'degenerette',
      currency: 0,
      heroIdx: 1,
      amountPerSpin: 10n ** 16n,
      totalWager: 2n * 10n ** 16n,
      totalPayout: 2n * 10n ** 16n,
      spins: [
        { spinIndex: 0, playerTraits: 13, houseTraits: 13, score: 4, payout: 2n * 10n ** 16n },
        { spinIndex: 1, playerTraits: 13, houseTraits: 77, score: 0, payout: 0n },
      ],
    }), true);
    const el = instantiate();
    await tick();
    const zone = el.querySelector('[data-bind="rvl-spin-zone"]');
    assert.equal(zone.hidden, false, 'board visible on the reduced-motion path');
    assert.equal(zone.querySelectorAll('.rvl-gamepiece').length, 2,
      'the large player/house presentation is retained');
    assert.equal(zone.querySelectorAll('.rvl-ticket--rolling-full').length, 0,
      'no rolling shimmer is left running');
    const rows = zone.querySelectorAll('.rvl-dgn-result-line');
    assert.equal(rows.length, 2, 'one explicit result line per spin');
    assert.match(rows[0].textContent, /S 4/);
    assert.match(rows[0].textContent, /FULL|SYMBOL|COLOR|MISS/,
      'quadrant match breakdown is written out');
    assert.match(rows[0].textContent, /\+/, 'paid row shows a payout');
    assert.match(rows[1].textContent, /MISS/, 'unpaid row is explicit');
    // Nothing to count up on this path, so the tracker shows the settled total.
    const running = zone.querySelector('.rvl-spin-running-amount');
    assert.ok(running, 'running-winnings tracker present');
    assert.match(running.textContent, /ETH$/);
    assert.ok(running.classList.contains('is-win'), 'a paid bet lights the tracker');
    assert.match(zone.querySelector('.rvl-dgn-facts--bet').textContent, /BET \/ SPIN/);
    assert.match(zone.querySelector('.rvl-dgn-facts--result').textContent, /TOTAL SCORE/);
    const cta = zone.querySelector('.rvl-dgn-spin-cta');
    assert.equal(cta.textContent, 'COLLECT');
    cta.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('reduced-motion BoxSpin shows the full settled reel, then its currency reveal', async () => {
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 7,
      legs: [{
        legType: 'spin',
        spinType: 'eth',
        payout: 100n,
        ethShare: 40n,
        reels: [{
          spinIndex: 0,
          playerTicket: 0xC3824100n,
          resultTicket: 0xC7864504n,
          score: 4,
        }],
      }],
    });
    const el = instantiate();
    await tick();

    const rootStage = el.querySelector('[data-bind="rvl-stage"]');
    const zone = el.querySelector('[data-bind="rvl-spin-zone"]');
    assert.equal(zone.hidden, false);
    assert.ok(rootStage.classList.contains('rvl-stage--degenerette'),
      'BoxSpin uses the full-size Degenerette surface');
    assert.equal(zone.querySelectorAll('.rvl-gamepiece').length, 2,
      'the complete player and house gamepieces remain visible');
    assert.equal(zone.querySelectorAll('.rvl-rq').length, 8,
      'both gamepieces retain all four quadrants');
    assert.match(zone.querySelector('.rvl-spin-head').textContent, /ETH BOX SPIN/);

    const currency = zone.querySelector('.rvl-box-currency-reveal');
    assert.ok(currency, 'a dedicated post-reel currency result is present');
    assert.ok(currency.classList.contains('is-revealed'));
    assert.equal(currency.getAttribute('data-currency'), 'ETH');
    assert.match(currency.textContent, /MYSTERY CURRENCYETHCURRENCY REVEALED/);
    assert.equal(zone.querySelector('.rvl-dgn-spin-cta').textContent, 'CONTINUE');

    zone.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.hidden, false);
    assert.equal(rootStage.classList.contains('rvl-stage--degenerette'), false,
      'the receipt returns to the compact stage after the full spin');
    assert.equal(summary.querySelector('.rvl-card-label').textContent, 'ETH SPIN');
    assert.match(summary.querySelector('.rvl-card-sub').textContent, /won .* ETH/i);
    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a successful survival flip settles on the green ETH face', async () => {
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 8,
      legs: [{
        legType: 'spin',
        spinType: 'flip',
        survived: true,
        payout: 900n,
        reels: [0, 1, 2].map((spinIndex) => ({
          spinIndex,
          playerTicket: 0xC3824100n + BigInt(spinIndex),
          resultTicket: 0xC7864504n + BigInt(spinIndex),
          score: spinIndex + 1,
        })),
      }],
    });
    const el = instantiate();
    await tick();

    const survival = el.querySelector('.rvl-survival');
    assert.ok(survival?.classList.contains('is-win'));
    assert.equal(survival.querySelector('.rvl-survival-coin')?.src,
      '/shared/coinflip-face-eth.svg');
    assert.match(survival.textContent, /SURVIVED/);

    el.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    el.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a losing FLIP board skips survival and settles the tracker at zero', async () => {
    queueReveal({
      kind: 'degenerette',
      currency: 1,
      totalPayout: 0n,
      spins: [{ spinIndex: 0, playerTraits: 13, houseTraits: 77, score: 5, payout: 500n }],
    });
    const el = instantiate();
    await tick();
    const running = el.querySelector('.rvl-spin-running-amount');
    assert.match(running.textContent, /^0(\.0+)? FLIP$/);
    assert.equal(running.classList.contains('is-win'), false);
    assert.equal(el.querySelector('.rvl-survival'), null);
  });

  test('full Degenerette tickets keep one shared responsive square scale', () => {
    assert.match(
      APP_CSS,
      /\.rvl-stage\.rvl-stage--degenerette\s*\{[^}]*--rvl-gamepiece-size:\s*min\(300px, 36vw, 34dvh\)/,
    );
    assert.match(
      APP_CSS,
      /\.rvl-stage--degenerette \.rvl-dgn-compare\s*\{[^}]*grid-template-columns:\s*var\(--rvl-gamepiece-size\)[^;]*var\(--rvl-gamepiece-size\)/,
      'the compare surface gives both sides the same explicit track',
    );
    assert.match(
      APP_CSS,
      /\.rvl-stage--degenerette \.rvl-gamepiece \.rvl-ticket-grid\s*\{[^}]*width:\s*var\(--rvl-gamepiece-size\);[^}]*height:\s*var\(--rvl-gamepiece-size\);[^}]*aspect-ratio:\s*1/,
      'both ticket canvases consume the same square dimensions',
    );
    assert.match(APP_CSS, /\.rvl-gamepiece-center img\s*\{[^}]*object-position:\s*50% 50%/,
      'the shared center flame is actually centered');
    assert.match(APP_CSS, /\.rvl-gamepiece \.rvl-rq img\s*\{[^}]*object-position:\s*50% 50%;[^}]*transform:\s*none/,
      'badge canvases stay geometrically centered inside their cells');
    assert.match(APP_CSS, /app-degenerette-panel \.dgn-ticket \.dgn-q img[\s\S]*?transform:\s*translateY\(4%\)/,
      'the compact builder gets its own slight downward optical correction');
    assert.match(APP_CSS, /\.rvl-gamepiece-center\s*\{[^}]*z-index:\s*20/,
      'the center diamond owns a layer above clipped quadrant effects');
    assert.match(APP_CSS, /\.rvl-gamepiece-center\.is-win::before\s*\{\s*background:\s*#22c55e/,
      'settled win diamond stays fully opaque');
    assert.match(APP_CSS, /\.rvl-gamepiece-center\.is-miss::before\s*\{\s*background:\s*#d94c5d/,
      'settled miss diamond stays fully opaque');
    assert.match(REVEAL_SRC, /dgnEthBadge:\s*'\/badges-circular\/crypto_06_ethereum_blue\.svg'/,
      'Degenerette ETH results reuse the blue ticket-trait badge');
  });

  test('motion path offers the full token spin and keeps its complete result until COLLECT', async () => {
    const previousMatchMedia = window.matchMedia;
    const previousRaf = globalThis.requestAnimationFrame;
    window.matchMedia = () => ({ matches: false });
    globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
    try {
      const el = instantiate();
      queueReveal({
        kind: 'degenerette',
        currency: 0,
        heroIdx: 2,
        amountPerSpin: 10n ** 16n,
        totalWager: 2n * 10n ** 16n,
        totalPayout: 2n * 10n ** 16n,
        spins: [
          { spinIndex: 0, playerTraits: 13, houseTraits: 13, score: 4, payout: 2n * 10n ** 16n },
          { spinIndex: 1, playerTraits: 13, houseTraits: 77, score: 0, payout: 0n },
        ],
      });
      await tick();
      const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
      backdrop.dispatchEvent({ type: 'click' }); // dismiss neutral title beat
      await tick();

      const stage = el.querySelector('.rvl-dgn-stage');
      assert.ok(stage, 'standalone-style stage rendered');
      assert.equal(stage.querySelectorAll('.rvl-gamepiece').length, 2,
        'player and house are full gamepieces');
      const cta = stage.querySelector('.rvl-dgn-spin-cta');
      const skip = stage.querySelector('.rvl-dgn-skip-cta');
      assert.equal(stage.querySelector('.rvl-dgn-progress'), null);
      assert.equal(stage.querySelector('.rvl-dgn-status'), null);
      assert.equal(stage.querySelector('.rvl-dgn-hint'), null,
        'reel graphics and sound replace the play-by-play narration rows');
      assert.equal(cta.textContent, 'SPIN 1 OF 2');
      assert.equal(skip.textContent, 'SKIP TO RESULTS');

      backdrop.dispatchEvent({ type: 'click' });
      await tick();
      assert.equal(cta.textContent, 'SPIN 1 OF 2',
        'background taps cannot consume the explicit per-spin gate');

      cta.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();
      assert.equal(cta.hidden, true, 'the spin control gets out of the way while its reel runs');
      assert.equal(cta.disabled, true);
      assert.equal(skip.hidden, false, 'skip remains a separate control while spinning');
      skip.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();

      assert.equal(cta.textContent, 'COLLECT', 'verified final frame stays up through collection');
      assert.equal(stage.querySelectorAll('.rvl-dgn-history-chip').length, 2,
        'skip keeps every spin in the result trail');
      assert.equal(stage.querySelectorAll('.rvl-rq').length, 8,
        'both displayed tickets retain all four quadrants');
      assert.doesNotMatch(
        el.querySelector('.rvl-spin-running-amount').textContent,
        /Infinity|NaN/,
        'zero-duration skip total is assigned directly, never divided by zero',
      );
      assert.equal(stage.querySelectorAll('.rvl-dgn-result-line').length, 2,
        'the final board spells out every spin result');
      assert.match(stage.querySelector('.rvl-dgn-facts--result').textContent, /PAYOUT/);
      assert.match(stage.querySelector('.rvl-dgn-facts--result').textContent, /NET/);
      assert.equal(el.querySelector('[data-bind="rvl-summary"]').hidden, true,
        'the large result never collapses into the old mini summary');

      cta.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();
      assert.equal(backdrop.hidden, true, 'COLLECT closes the persistent result');
    } finally {
      window.matchMedia = previousMatchMedia;
      if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previousRaf;
    }
  });

  test('motion BoxSpin keeps currency sealed until its first verified reel lands', async () => {
    const previousMatchMedia = window.matchMedia;
    const previousRaf = globalThis.requestAnimationFrame;
    window.matchMedia = () => ({ matches: false });
    globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
    try {
      const el = instantiate();
      queueReveal({
        kind: 'lootbox',
        lootboxIndex: 22,
        legs: [{
          legType: 'spin',
          spinType: 'wwxrp',
          payout: 2n * 10n ** 18n,
          reels: [{
            spinIndex: 0,
            playerTicket: 0xC3824100n,
            resultTicket: 0xC7864504n,
            score: 4,
          }],
        }],
      });
      await tick();

      const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
      let stage = el.querySelector('.rvl-dgn-stage');
      for (let i = 0; i < 10 && !stage; i++) {
        backdrop.dispatchEvent({ type: 'click' });
        await tick();
        stage = el.querySelector('.rvl-dgn-stage');
      }
      assert.ok(stage, 'the full BoxSpin reel stage is reached');
      assert.equal(stage.querySelectorAll('.rvl-gamepiece').length, 2);
      assert.equal(stage.querySelectorAll('.rvl-rq').length, 8);
      assert.equal(stage.querySelector('.rvl-box-currency-reveal'), null,
        'currency has not appeared before the verified reel runs');
      const head = el.querySelector('.rvl-spin-head');
      assert.match(head.textContent, /CURRENCY HIDDEN/);
      assert.doesNotMatch(head.textContent, /ETH|FLIP|WWXRP/);

      const cta = stage.querySelector('.rvl-dgn-spin-cta');
      const skip = stage.querySelector('.rvl-dgn-skip-cta');
      cta.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();
      assert.equal(cta.hidden, true);
      skip.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();

      const sealed = stage.querySelector('.rvl-box-currency-reveal');
      assert.ok(sealed, 'the reveal beat begins only after the result has landed');
      assert.equal(sealed.classList.contains('is-revealed'), false,
        'the currency badge starts face-down');
      await new Promise((resolve) => setTimeout(resolve, 950));

      const currency = stage.querySelector('.rvl-box-currency-reveal');
      assert.ok(currency.classList.contains('is-revealed'));
      assert.equal(currency.getAttribute('data-currency'), 'WWXRP');
      assert.match(currency.textContent, /WWXRP/);
      assert.match(head.textContent, /WWXRP BOX SPIN · 1 REEL/);
      assert.equal(cta.textContent, 'CONTINUE',
        'the completed reel and currency remain until acknowledged');

      cta.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();
      const summary = el.querySelector('[data-bind="rvl-summary"]');
      assert.equal(summary.querySelector('.rvl-card-label').textContent, 'WWXRP SPIN');
      assert.match(summary.textContent, /won .* WWXRP/i);
      summary.querySelector('.rvl-collect-cta')
        .dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();
      // The final payout count-up runs independently of the acknowledgement.
      // Let its RAF chain drain before restoring the test's global shim.
      await new Promise((resolve) => setTimeout(resolve, 650));
    } finally {
      window.matchMedia = previousMatchMedia;
      if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previousRaf;
    }
  });

  test('junk sequences are ignored without opening the overlay', async () => {
    const el = instantiate();
    queueReveal({ kind: 'lootbox', legs: [] });
    queueReveal(null);
    await tick();
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    assert.equal(backdrop.hidden, true);
  });
});
