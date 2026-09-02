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
import { existsSync, readFileSync } from 'node:fs';

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
  queueReveal, normalizeSequence, buildIndividualLootboxSequences,
  combineLootboxSequences, daySummaryAnimatedCards,
  buildDegeneretteSpinFrames,
  degeneretteLockMatchType, shouldBobDegeneretteLock, buildBoxSpinBoard,
  boxSpinScorePays, settleBoxSpinPayoutPresentation,
  goldTicketLabel, pickBiggestSpinResult, projectDegeneretteEthSplit,
  shouldCelebrateDegenerette, isUnluckyDegenerette,
  ticketGridSizeClass, revealTerminalActionLabel, lootboxFlightLandingTranslations,
  __resetForTest, __takeQueuedForTest, PACK_REVEAL_COMPLETE_EVENT, RESULT_REVEAL_ABORT_EVENT,
  LOOTBOX_REVEAL_ABORT_EVENT,
  REVEAL_OVERLAY_IDLE_EVENT, LOOTBOX_REVEAL_COMPLETE_EVENT,
} =
  await import('../reveal-overlay.js');
const { dgnUnpackTicket } = await import('../../app/dgn-traits.js');
const pendingActionsMod = await import('../../app/pending-actions.js');
const { DEGENERETTE_PREFERENCES_KEY } = await import('../../app/degenerette-preferences.js');
const storeMod = await import('../../app/store.js');

const REVEAL_SRC = readFileSync(new URL('../reveal-overlay.js', import.meta.url), 'utf8');
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const SDGNRS_LOGO_SVG = readFileSync(
  new URL('../../../specials/special_eth.svg', import.meta.url),
  'utf8',
);

test('ticket packs keep their own reveal art without protocol flame overlays', () => {
  const packStart = REVEAL_SRC.indexOf('async #playTicketGrid');
  const packEnd = REVEAL_SRC.indexOf('#buildTicketLesson', packStart);
  const goldStart = REVEAL_SRC.indexOf('async #playGoldTicketHit');
  const goldEnd = REVEAL_SRC.indexOf('#buildPaperTicket', goldStart);
  assert.ok(packStart >= 0 && packEnd > packStart);
  assert.ok(goldStart >= 0 && goldEnd > goldStart);
  assert.doesNotMatch(REVEAL_SRC.slice(packStart, packEnd), /#celebrateWin|celebrateProtocol/);
  assert.doesNotMatch(REVEAL_SRC.slice(goldStart, goldEnd), /#celebrateGold|celebrateProtocol/);
  assert.doesNotMatch(REVEAL_SRC, /#celebrateGold\s*\(/,
    'the global gold flame burst is not part of a ticket-pack reveal');
  assert.match(REVEAL_SRC, /const hasTicketGrid = Array\.isArray\(seq\.ticketGrid\)/);
  assert.match(REVEAL_SRC, /!hasSpins && !hasTicketGrid && !seq\.ticketLesson/,
    'the sealed-wrapper burst also excludes ticket hands from the global effect');
});

const tick = () => new Promise((r) => setTimeout(r, 5));

// ---------------------------------------------------------------------------
// normalizeSequence (pure)
// ---------------------------------------------------------------------------

describe('normalizeSequence', () => {
  test('lootbox flight lands on terminal rectangles for singleton and wrapped card sets', () => {
    assert.deepEqual(lootboxFlightLandingTranslations(
      [{ left: 100, top: 140 }],
      [{ left: 100, top: 199 }],
    ), [{ x: 0, y: 59 }], 'the minimized one-card repro derives the exact vertical handoff');
    assert.deepEqual(lootboxFlightLandingTranslations(
      [{ left: 10, top: -84 }, { left: 190, top: -84 }, { left: 100, top: 190 }],
      [{ left: 13, top: 73 }, { left: 187, top: 73 }, { left: 100, top: 349 }],
    ), [
      { x: 3, y: 157 },
      { x: -3, y: 157 },
      { x: 0, y: 159 },
    ], 'the three-card mobile boundary preserves each independently wrapped target');
    assert.deepEqual(lootboxFlightLandingTranslations(
      [{ left: 5, top: 7 }, { left: 8, top: 9 }],
      [{ left: 5, top: 7 }],
    ), [], 'a card-count mismatch cannot apply offsets to the wrong rewards');
    assert.deepEqual(lootboxFlightLandingTranslations([], []), [],
      'the empty boundary has no synthetic landing');
  });

  test('terminal actions describe the outcome instead of pretending to collect it', () => {
    assert.equal(revealTerminalActionLabel({ unlucky: true }), 'UNLUCKY');
    assert.equal(revealTerminalActionLabel({ kind: 'pack' }), 'GOOD LUCK');
    assert.equal(revealTerminalActionLabel({ daySummary: true }), 'BACK TO GAME');
    assert.equal(revealTerminalActionLabel({
      kind: 'pari', cards: [{ type: 'flip' }],
    }), 'TAKE THE WIN');
    assert.equal(revealTerminalActionLabel({ kind: 'pari', cards: [{ type: 'nowin' }] }),
      'BACK TO GAME');
    assert.equal(revealTerminalActionLabel({ kind: 'lootbox' }), 'GOOD LUCK');
    assert.equal(revealTerminalActionLabel(null, {
      total: 200n, totalWager: 100n, boxSpin: false,
    }), 'TAKE THE WIN');
    assert.equal(revealTerminalActionLabel(null, {
      total: 50n, totalWager: 100n, boxSpin: false,
    }), 'BACK TO GAME');
    assert.equal(revealTerminalActionLabel(null, {
      total: 0n, totalWager: 100n, boxSpin: false,
    }), 'UNLUCKY');
    assert.equal(revealTerminalActionLabel(null, {
      currency: 3, unit: 'WWXRP', total: 200n, totalWager: 100n, boxSpin: false,
    }), 'BACK TO GAME', 'a positive WWXRP result is never presented as TAKE THE WIN');
    assert.equal(revealTerminalActionLabel({ kind: 'lootbox', wwxrpOnly: false }, {
      currency: 3, unit: 'WWXRP', total: 2n, boxSpin: true,
    }), 'BACK TO GAME', 'a WWXRP spin stays neutral beside other Luckbox prizes');
    assert.doesNotMatch(REVEAL_SRC, /(['"])COLLECT\1/,
      'the reveal engine has no player-facing COLLECT fallback');
  });

  test('ticket hands use the 1x1, 2x2, and 3x3 size buckets', () => {
    assert.equal(ticketGridSizeClass(1), 'rvl-ticket-grid-stage--size-1');
    assert.equal(ticketGridSizeClass(2), 'rvl-ticket-grid-stage--size-4');
    assert.equal(ticketGridSizeClass(4), 'rvl-ticket-grid-stage--size-4');
    assert.equal(ticketGridSizeClass(5), 'rvl-ticket-grid-stage--size-9');
    assert.equal(ticketGridSizeClass(9), 'rvl-ticket-grid-stage--size-9');
  });

  test('Degenerette ETH animation keeps the final receipt split ratio', () => {
    const quarter = projectDegeneretteEthSplit({
      gross: 400n,
      total: 1600n,
      lootboxEth: 200n,
    });
    assert.deepEqual(quarter, { actual: 350n, lootbox: 50n });
    assert.deepEqual(projectDegeneretteEthSplit({
      gross: 1600n,
      total: 1600n,
      lootboxEth: 200n,
    }), { actual: 1400n, lootbox: 200n });
    assert.deepEqual(projectDegeneretteEthSplit({
      gross: 400n,
      total: 1600n,
      lootboxEth: 0n,
    }), { actual: 400n, lootbox: 0n });
  });

  test('lootbox legs → cards: opened splits into tickets + flip; spin keeps reel payload', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      lootboxIndex: 47,
      amountWei: 400n,
      ticketPriceWei: 100n,
      legs: [
        { legType: 'opened', wholeTickets: 11, futureLevel: 6, flip: 12_345n * 10n ** 18n },
        {
          legType: 'spin', spinType: 'eth', spinCount: 1, survived: null,
          payout: 100n, ethShare: 40n,
          preSurvivalPayout: 50n, survivalWinPayout: 100n,
          reels: [{ spinIndex: 0, score: 2, playerTraits: [], resultTraits: [] }],
        },
      ],
    });
    assert.equal(seq.kind, 'lootbox');
    assert.equal(seq.lootboxValueTone, 'purple');
    assert.equal(seq.lootboxCaseModel, 'medium',
      'the opener keeps the canonical model selected from amount + frozen price');
    assert.equal(seq.lootboxTicketUnitsLabel, '4×');
    assert.equal(seq.amountWei, 400n);
    assert.equal(seq.ticketPriceWei, 100n);
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
    assert.equal(seq.cards[2].label, 'BOX SPIN');
    assert.equal(seq.cards[2].value, '?', 'the mystery card does not leak its reel count');
    assert.equal(seq.cards[2].revealedValue, '×1', 'the reel count appears with the result');
    assert.doesNotMatch(seq.cards[2].label, /ETH|FLIP|WWXRP/,
      'the pre-spin card does not spoil the currency');
    assert.equal(seq.cards[2].revealedLabel, 'ETH SPIN');
    assert.equal(seq.cards[2].spin.reels.length, 1);
    assert.equal(seq.cards[2].spin.preSurvivalPayout, 50n);
    assert.equal(seq.cards[2].spin.survivalWinPayout, 100n);
    assert.equal(seq.boxIndex, '47', 'the branded box can identify the RNG batch');
    assert.equal(seq.boxSpinCount, 1);
    assert.equal(seq.big, true, 'epic card marks the sequence big');
  });

  test('Craps comp awards become denomination-specific opening cards', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      lootboxIndex: 48,
      legs: [
        {
          legType: 'opened', lootboxIndex: 48, wholeTickets: 0,
          futureTickets: 0, futureLevel: 6, flip: 0n,
        },
        {
          legType: 'crapsPasses',
          crapsNormalPasses: 2,
          crapsHighPasses: 1,
          reservedDay: 73,
        },
      ],
    });

    assert.deepEqual(seq.cards.map((card) => card.type), ['craps-pass', 'craps-pass']);
    assert.deepEqual(seq.cards.map((card) => card.passTier), ['normal', 'high']);
    assert.deepEqual(seq.cards.map((card) => card.value), ['2', '1']);
    assert.equal(seq.cards[0].label, 'CRAPS COMPS');
    assert.match(seq.cards[0].sub, /all 7 scheduled windows · Banked for a future day/);
    assert.equal(seq.cards[1].label, 'HIGH-ROLLER CRAPS COMP');
    assert.match(seq.cards[1].sub, /Day 73 reserved/,
      'the contract gives the one reserved seat to the more valuable high pass');
    assert.equal(seq.cards[0].rarity, 'rare');
    assert.equal(seq.cards[1].rarity, 'epic');
    assert.equal(seq.big, true);
    assert.equal(seq.cards.some((card) => card.type === 'nowin'), false,
      'a comp-only box is never replaced by the old zero-ticket/zero-FLIP fallback');
    assert.deepEqual(seq.lootboxBoxGroups[0].cards, seq.cards,
      'an aggregate comp event belongs to its sole physical box when attribution is exact');
    assert.match(REVEAL_SRC,
      /card\.type === 'craps-pass'[\s\S]*?#buildCrapsPassBadge\(card\)/,
      'the comp card mounts the established Craps battle badge rather than a generic glyph');
    assert.match(REVEAL_SRC, /card\.passTier === 'high' \? 'HIGH ROLLER' : 'COMP'/,
      'the normal reward badge names the Craps comp directly');
    assert.match(REVEAL_SRC, /for \(const \[symbol, color\] of \[\[1, 6\], \[4, 4\]\]\)/,
      'the pass badge reuses the silver 2 and blue 5 dice from the live game');
    assert.doesNotMatch(REVEAL_SRC, /craps-battle-badge-v1\.png/,
      'the discarded painted logo is not retained as a hidden dependency');
    assert.match(APP_CSS,
      /\.rvl-card--craps-pass\[data-pass-tier="high"\][\s\S]*?--craps-pass-rgb:\s*245, 183, 60/,
      'high-roller passes have a visibly separate gold treatment');
  });

  test('presale comp counts stay attached to their physical opening card', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      lootboxIndex: 49,
      legs: [{
        legType: 'opened', source: 'presale', lootboxIndex: 49,
        wholeTickets: 0, flip: 0n, crapsNormalPasses: 3, crapsHighPasses: 0,
      }],
    });
    assert.equal(seq.cards.length, 1);
    assert.equal(seq.cards[0].type, 'craps-pass');
    assert.equal(seq.cards[0].value, '3');
    assert.equal(seq.lootboxBoxGroups[0].cards[0], seq.cards[0]);
  });

  test('whale pass leg → legendary card', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [{ legType: 'whalepass', targetLevel: 13, entriesPerLevel: 400 }],
    });
    assert.equal(seq.cards[0].type, 'whalepass');
    assert.equal(seq.cards[0].rarity, 'legendary');
  });

  test('only defined boon rewards render as boons; quest shields and unknown IDs stay honest', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [
        { legType: 'reward', rewardType: 9, amount: 2_000n, label: 'Whale boon' },
        { legType: 'reward', rewardType: 14, amount: 42n, label: 'Craps boon' },
        { legType: 'reward', rewardType: 12, amount: 1n, label: 'Quest streak shield' },
        { legType: 'reward', rewardType: 99, label: 'Unknown protocol reward #99' },
      ],
    });
    assert.deepEqual(seq.cards.map((card) => card.type), ['boon', 'boon', 'quest-shield', 'reward']);
    assert.equal(seq.cards[0].label, 'WHALE PASS BOON');
    assert.equal(seq.cards[0].value, '−20%');
    assert.equal(seq.cards[0].sub, '');
    assert.equal(seq.cards[1].label, 'CRAPS BOON');
    assert.equal(seq.cards[1].value, '+10%');
    assert.equal(seq.cards[1].sub, '');
    assert.equal(seq.cards[1].icon, '/badges-circular/dice_04_5_silver.svg');
    assert.equal(seq.cards[2].label, 'QUEST SHIELD');
    assert.equal(seq.cards[2].value, '1 DAY');
    assert.equal(seq.cards[2].sub, '');
    assert.doesNotMatch(seq.cards[3].label, /bonus/i);
  });

  test('lootbox boon cards expose their exact strength and affected action', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [
        { legType: 'reward', rewardType: 5, amount: 1_500n, boonType: 6 },
        { legType: 'reward', rewardType: 8, amount: 5_000n },
        { legType: 'reward', rewardType: 10, amount: 25n },
        { legType: 'reward', rewardType: 11, amount: 5_000n },
        { legType: 'reward', rewardType: 13, amount: 37n },
        { legType: 'reward', rewardType: 14, amount: 42n },
      ],
    });
    assert.deepEqual(
      seq.cards.map(({ label, value }) => [label, value]),
      [
        ['LUCKBOX BOON', '+15%'],
        ['DECIMATOR BOON', '+50%'],
        ['RATING BOON', '+12.5'],
        ['LAZY PASS BOON', '−50%'],
        ['FLIP DEGENERETTE BOON', '+12%'],
        ['CRAPS BOON', '+10%'],
      ],
    );
    assert.ok(seq.cards.every((card) => card.sub === ''),
      'boon cards stop after the exact type and size');
    assert.deepEqual(seq.cards.map((card) => card.boonStrength),
      ['mid', 'high', 'mid', 'high', 'high', 'mid']);
    assert.deepEqual(seq.cards.map((card) => card.boonTier), [2, 3, 2, 3, 3, 2]);
    assert.equal(seq.cards[0].icon,
      '/app/assets/lootbox/degenerus-lootbox-case-medium-v27-approved-locked-front.webp');
    assert.equal(seq.cards[1].icon, '/app/assets/decimator-draw-mark.svg');
    assert.equal(seq.cards[2].icon, null,
      'rating is already named on the card and needs no invented pictogram');
    assert.equal(seq.cards[4].icon, '/whitepaper/flame-logo-split.svg');
  });

  test('an unencoded shared purchase boon never prints two possible products', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [{ legType: 'reward', rewardType: 5, amount: 1_500n }],
    });
    assert.equal(seq.cards[0].label, 'PURCHASE BOON');
    assert.equal(seq.cards[0].value, '+15%');
    assert.doesNotMatch(seq.cards[0].label, /LUCKBOX\s*\/\s*TICKET/i);
  });

  test('a pile-scale FLIP prize swaps the flame logo for its baked chip pile', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [{ legType: 'opened', wholeTickets: 0, futureTickets: 0, flip: 600_000n * 10n ** 18n }],
    });
    const flipCard = seq.cards.find((card) => card.type === 'flip');
    assert.equal(flipCard.icon, '/shared/flip-chips/pile-9.svg',
      'a 600K FLIP win presents as the same ladder pile the coinflip felt would deal');
    assert.equal(flipCard.pile, 9);
    assert.match(REVEAL_SRC, /card\.pile\)\s*icon\.className = 'rvl-card-icon rvl-card-icon--flip-pile'/,
      'the renderer widens the icon slot for pile cards');
    assert.match(APP_CSS, /\.rvl-card-icon--flip-pile\s*\{[^}]*align-items:\s*flex-end/s,
      'the pile lane is bottom-anchored so coins rest on the card');
    assert.match(APP_CSS, /\.rvl-card-icon--flip-pile img\s*\{[^}]*object-position:\s*center bottom/s,
      'the pile art itself sits on the lane floor');
  });

  test('a sub-pile FLIP prize keeps the flame logo', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [{ legType: 'opened', wholeTickets: 0, futureTickets: 0, flip: 50_000n * 10n ** 18n }],
    });
    const flipCard = seq.cards.find((card) => card.type === 'flip');
    assert.equal(flipCard.icon, '/whitepaper/flame-logo-split.svg');
    assert.equal(flipCard.pile, null);
  });

  test('an sDGNRS redemption receipt shows its direct ETH and contingent FLIP beside box rewards', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      title: 'sDGNRS REDEMPTION',
      legs: [
        // Base Sepolia's display helper expands protocol ETH by 1M.
        { legType: 'eth', amount: 2n * 10n ** 12n, claimable: true },
        { legType: 'flip', amount: 750n * 10n ** 18n },
        { legType: 'opened', wholeTickets: 3, futureLevel: 68, flip: 0n },
      ],
    });
    assert.equal(seq.title, 'sDGNRS REDEMPTION');
    assert.deepEqual(seq.cards.map((card) => card.type), ['eth', 'flip', 'tickets']);
    assert.equal(seq.cards[0].label, 'CLAIMABLE ETH');
    assert.equal(seq.cards[0].value, '2');
    assert.equal(seq.cards[1].value, '750');
    assert.equal(seq.cards[2].value, '3');
  });

  test('a settlement marker is never presented as if it were box contents', () => {
    assert.equal(normalizeSequence({
      kind: 'lootbox',
      lootboxIndex: 9,
      legs: [{ legType: 'settled' }],
    }), null);
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
    assert.ok(seq.cards.every((card) => card.label === 'BOX SPIN'));
    assert.ok(seq.cards.every((card) => card.rarity === 'rare'),
      'pre-spin card styling cannot leak the currency lane');
    assert.deepEqual(seq.cards.map((card) => card.revealedLabel), ['WWXRP SPIN', 'FLIP SPINS'],
      'the mandatory post-reel flip discloses every currency, including a zero payout');
    assert.deepEqual(seq.cards.map((card) => card.value), ['?', '?'],
      'one-reel and three-reel lanes look identical before the first spin');
    assert.deepEqual(seq.cards.map((card) => card.revealedValue), ['×1', '×3']);
    assert.equal(seq.boxSpinCount, 4, 'all emitted reels are scheduled, not collapsed');
  });

  test('combo orders can become one animated sequence per physical box', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      presentationId: 'combo:27',
      lootboxRelease: {
        address: '0x00000000000000000000000000000000000000ab',
        key: '27', lootboxIndex: 27, transactionHash: '0xcombo',
      },
      // One Small + one Medium box in the packed purchase order.
      boxOrders: [String(1n | (1n << 8n))],
      ticketPriceWei: 10_000_000_000n,
      legs: [{
        legType: 'opened', amount: 10_000_000_000n,
        wholeTickets: 1, futureLevel: 12, flip: 0n,
      }, {
        legType: 'opened', amount: 50_000_000_000n,
        wholeTickets: 0, futureTickets: 0, futureLevel: 14,
        flip: 25n * 10n ** 18n,
      }, {
        // DGNRS is intentionally aggregated by the contract for the complete
        // order, so it must remain a combo reward rather than being invented as
        // the result of either physical box.
        legType: 'dgnrs', amount: 7n * 10n ** 18n,
      }],
    });

    assert.equal(seq.lootboxBoxCount, 2);
    assert.deepEqual(seq.lootboxBoxGroups.map((group) => group.label), [
      'SMALL LUCKBOX', 'MEDIUM LUCKBOX',
    ]);
    assert.deepEqual(seq.lootboxBoxGroups.map((group) => group.cards.map((card) => card.type)), [
      ['tickets'], ['flip'],
    ]);
    assert.deepEqual(seq.lootboxSharedCards.map((card) => card.type), ['dgnrs']);
    assert.deepEqual(seq.cards.map((card) => card.type), ['tickets', 'flip', 'dgnrs'],
      'the default combined receipt preserves immutable event order');

    const individual = buildIndividualLootboxSequences(seq);
    assert.deepEqual(individual.map((part) => part.title), [
      'SMALL LUCKBOX · 1 OF 2',
      'MEDIUM LUCKBOX · 2 OF 2',
      'COMBO REWARDS',
    ]);
    assert.deepEqual(individual.map((part) => part.noVessel), [false, false, true],
      'every physical box gets a case animation; aggregate-only rewards do not fake one');
    assert.deepEqual(individual.map((part) => part.cards.map((card) => card.type)), [
      ['tickets'], ['flip'], ['dgnrs'],
    ]);
    assert.deepEqual(individual.map((part) => part.lootboxCaseModel), [
      'small', 'medium', seq.lootboxCaseModel,
    ]);
    assert.ok(individual.slice(0, -1).every((part) => (
      part.suppressLootboxComplete && part.lootboxRelease == null
    )), 'opening an early case cannot retire the complete Pending combo');
    assert.equal(individual.at(-1).presentationId, 'combo:27');
    assert.equal(individual.at(-1).lootboxRelease.key, '27',
      'the purchase retires only after the final individual receipt');
  });

  test('individual combo presentation skips trailing cardless order placeholders', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      presentationId: 'combo:partial-groups',
      lootboxRelease: {
        address: '0x00000000000000000000000000000000000000ab',
        key: 'partial-groups', lootboxIndex: 31,
      },
      // Four physical Small boxes, but only two have independently
      // attributable main-result events. The remaining rewards are aggregate.
      boxOrders: ['4'],
      ticketPriceWei: 10_000_000_000n,
      legs: [{
        legType: 'opened', amount: 10_000_000_000n,
        wholeTickets: 1, futureLevel: 12, flip: 0n,
      }, {
        legType: 'opened', amount: 10_000_000_000n,
        wholeTickets: 0, futureTickets: 0, futureLevel: 12,
        flip: 25n * 10n ** 18n,
      }, {
        legType: 'dgnrs', amount: 7n * 10n ** 18n,
      }],
    });

    assert.equal(seq.lootboxBoxCount, 4);
    assert.deepEqual(seq.lootboxBoxGroups.map((group) => group.cards.length), [1, 1, 0, 0],
      'normalization retains the physical order without inventing per-box attribution');
    const individual = buildIndividualLootboxSequences(seq);
    assert.deepEqual(individual.map((part) => part.title), [
      'SMALL LUCKBOX · 1 OF 2',
      'SMALL LUCKBOX · 2 OF 2',
      'COMBO REWARDS',
    ]);
    assert.ok(individual.every((part) => part.cards.length > 0),
      'spec-only placeholders never become empty reveal screens');
    assert.deepEqual(individual.map((part) => part.cards[0].type), [
      'tickets', 'flip', 'dgnrs',
    ]);
    assert.equal(individual.at(-1).lootboxRelease.key, 'partial-groups',
      'skipping visual placeholders does not retire Pending before combo rewards');
  });

  test('OPEN ALL combines settled Pending lootboxes into one large physical case', () => {
    const makeBox = (index) => normalizeSequence({
      kind: 'lootbox',
      presentationId: `pending-box:${index}`,
      lootboxRelease: {
        address: '0x00000000000000000000000000000000000000ab',
        key: String(index),
        lootboxIndex: index,
      },
      amountWei: BigInt(index) * 10_000_000_000n,
      ticketPriceWei: 10_000_000_000n,
      legs: [{ legType: 'dgnrs', amount: BigInt(index) * 10n ** 18n }],
    });
    const combined = combineLootboxSequences([makeBox(2), makeBox(3)]);

    assert.equal(combined.title, 'ALL LUCKBOXES · 2 BOXES');
    assert.equal(combined.lootboxCaseModel, 'large',
      'OPEN ALL always uses the visibly large case rather than the first child case');
    assert.equal(combined.lootboxView, 'combined');
    assert.equal(combined.autoAdvance, false,
      'one combined receipt replaces the old case-by-case auto-advance queue');
    assert.deepEqual(combined.cards.map((card) => card.value), ['2', '3'],
      'every exact child reward comes out of the one case together');
    assert.deepEqual(combined.lootboxCompletions.map((entry) => ({
      presentationId: entry.presentationId,
      key: entry.release?.key,
    })), [
      { presentationId: 'pending-box:2', key: '2' },
      { presentationId: 'pending-box:3', key: '3' },
    ], 'the one visual still retires both original Pending rows');
  });

  test('individual combo presentation runs every BoxSpin before ordinary box reveals', () => {
    const ticketCard = { type: 'tickets', value: '1', spin: null };
    const firstSpinCard = {
      type: 'spins',
      spin: { spinType: 'wwxrp', reels: [{ score: 1 }] },
    };
    const flipCard = { type: 'flip', value: '25', spin: null };
    const secondSpinCard = {
      type: 'spins',
      spin: { spinType: 'flip', reels: [{ score: 2 }] },
    };
    const seq = {
      kind: 'lootbox',
      presentationId: 'combo:spins-first',
      lootboxRelease: { address: '0xab', key: 'spins-first' },
      ticketPriceWei: 10_000_000_000n,
      lootboxBoxGroups: [
        { label: 'SMALL LUCKBOX', amountWei: 10_000_000_000n, cards: [ticketCard] },
        { label: 'MEDIUM LUCKBOX', amountWei: 50_000_000_000n, cards: [firstSpinCard] },
        { label: 'LARGE LUCKBOX', amountWei: 250_000_000_000n, cards: [flipCard] },
        { label: 'CUSTOM LUCKBOX', amountWei: 90_000_000_000n, cards: [secondSpinCard] },
      ],
      lootboxSharedCards: [{ type: 'dgnrs', value: '7', spin: null }],
    };

    const individual = buildIndividualLootboxSequences(seq);
    assert.deepEqual(individual.map((part) => part.title), [
      'MEDIUM LUCKBOX · 1 OF 4',
      'CUSTOM LUCKBOX · 2 OF 4',
      'SMALL LUCKBOX · 3 OF 4',
      'LARGE LUCKBOX · 4 OF 4',
      'COMBO REWARDS',
    ]);
    assert.deepEqual(individual.map((part) => part.cards[0]?.type), [
      'spins', 'spins', 'tickets', 'flip', 'dgnrs',
    ]);
    assert.equal(individual.at(-1).lootboxRelease.key, 'spins-first');
    assert.ok(individual.slice(0, -1).every((part) => part.lootboxRelease == null));
  });

  test('a combo BoxSpin estimate uses its physical box value, not the aggregate order', () => {
    const price = 10_000_000_000n;
    const seq = normalizeSequence({
      kind: 'lootbox',
      amountWei: price * 31n,
      ticketPriceWei: price,
      boxOrders: [String(1n | (1n << 8n) | (1n << 16n))],
      legs: [{
        legType: 'opened', wholeTickets: 1, futureLevel: 12, flip: 0n,
      }, {
        legType: 'spin', spinType: 'flip', survived: false, payout: 0n,
        reels: [
          { spinIndex: 0, playerTicket: 1n, resultTicket: 2n, score: 2 },
          { spinIndex: 1, playerTicket: 3n, resultTicket: 4n, score: 0 },
          { spinIndex: 2, playerTicket: 5n, resultTicket: 6n, score: 0 },
        ],
      }, {
        legType: 'opened', wholeTickets: 1, futureLevel: 14, flip: 0n,
      }],
    });

    const spin = seq.cards.find((card) => card.spin)?.spin;
    assert.equal(spin.estimateBoxAmountWei, price * 5n,
      'the Medium 2-of-3 spin receives 5× price rather than the 31× combo total');
  });

  test('empty legs → null (nothing to show)', () => {
    assert.equal(normalizeSequence({ kind: 'lootbox', legs: [] }), null);
  });

  test('an awarded, already-settled box with only fractional progress remains visible', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      title: 'DEGENERETTE LUCKBOX',
      settledExpected: true,
      legs: [{
        legType: 'opened', futureLevel: 8, futureTickets: 42,
        roundedUp: false, wholeTickets: 0, flip: 0n,
      }],
    });
    assert.ok(seq, 'the awarded box is not discarded as an empty sequence');
    assert.equal(seq.cards.length, 1);
    assert.equal(seq.cards[0].type, 'tickets');
    assert.equal(seq.cards[0].value, '0');
    assert.equal(seq.cards[0].label, 'LEVEL 8 TICKET ROLL');
    assert.match(seq.cards[0].sub, /did not round up/i);
  });

  test('a legacy contentless opened event reports its actual zero main-prize result', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [{ legType: 'opened', futureLevel: 8, wholeTickets: 0, flip: 0n }],
    });
    assert.equal(seq.cards.length, 1);
    assert.equal(seq.cards[0].type, 'nowin');
    assert.equal(seq.cards[0].label, 'LUCKBOX RESULT');
    assert.equal(seq.cards[0].value, '0 TICKETS · 0 FLIP');
    assert.equal(seq.unlucky, true);
    assert.equal(revealTerminalActionLabel(seq), 'UNLUCKY');
  });

  test('WWXRP with no real Luckbox prize is always UNLUCKY', () => {
    const direct = normalizeSequence({
      kind: 'lootbox',
      legs: [
        { legType: 'wwxrp', amount: 9n * 10n ** 18n },
        {
          legType: 'opened', futureLevel: 8, futureTickets: 42,
          roundedUp: false, wholeTickets: 0, flip: 0n,
        },
      ],
    });
    assert.deepEqual(direct.cards.map((card) => card.type), ['wwxrp'],
      'the WWXRP consolation replaces the zero-ticket placeholder');
    assert.equal(direct.wwxrpOnly, true);
    assert.equal(direct.unlucky, true);
    assert.equal(revealTerminalActionLabel(direct), 'UNLUCKY');

    const spin = normalizeSequence({
      kind: 'lootbox',
      legs: [{
        legType: 'spin', spinType: 'wwxrp', payout: 2n,
        reels: [{ playerTicket: 1n, resultTicket: 2n, score: 4 }],
      }],
    });
    assert.equal(spin.wwxrpOnly, true);
    assert.equal(spin.unlucky, true);
    assert.equal(revealTerminalActionLabel(spin, { total: 2n, boxSpin: true }), 'UNLUCKY');
  });

  test('WWXRP beside a real Luckbox prize does not turn the whole reveal unlucky', () => {
    const seq = normalizeSequence({
      kind: 'lootbox',
      legs: [
        { legType: 'wwxrp', amount: 9n * 10n ** 18n },
        { legType: 'opened', wholeTickets: 1, futureLevel: 8, flip: 0n },
      ],
    });
    assert.equal(seq.wwxrpOnly, false);
    assert.equal(seq.unlucky, false);
  });

  test('generic resolutions distinguish a loss from an already-paid win', () => {
    const lost = normalizeSequence({
      kind: 'resolution',
      cards: [{ outcome: 'loss', label: 'FINAL DRAW', value: 'NO PAYOUT' }],
    });
    assert.equal(lost.unlucky, true);
    assert.equal(revealTerminalActionLabel(lost), 'UNLUCKY');

    const won = normalizeSequence({
      kind: 'resolution',
      cards: [{ outcome: 'win', label: 'FINAL DRAW', value: '1 ETH' }],
    });
    assert.equal(won.unlucky, false);
    assert.equal(revealTerminalActionLabel(won), 'GOOD LUCK');
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

  test('Bingo explains the completed chart line and both credited rewards', () => {
    const seq = normalizeSequence({
      kind: 'bingo',
      level: 31,
      symbol: 0,
      tier: 'first-symbol',
      flipReward: 2_000n * 10n ** 18n,
      dgnrsPaid: 77n * 10n ** 18n,
      counts: Array.from({ length: 64 }, (_unused, index) => index % 8 === 0 ? 1 : 0),
    });
    assert.equal(seq.title, 'FIRST-SYMBOL BINGO');
    assert.equal(seq.noVessel, true);
    assert.equal(seq.autoStart, true);
    assert.deepEqual(seq.cards.map((card) => card.type), ['bingo', 'flip', 'dgnrs']);
    assert.equal(seq.cards[0].label, 'CRYPTO · WWXRP BINGO');
    assert.equal(seq.cards[0].bingo.counts.length, 64);
    assert.equal(seq.cards[1].value, '2,000');
    assert.equal(seq.cards[2].label, 'sDGNRS');
    assert.equal(seq.cards[2].value, '77');
  });

  test('foil match explains each scored quadrant before its reward spin', () => {
    const seq = normalizeSequence({
      kind: 'foil-match', day: 44, level: 12, ticketIndex: 2, drawKind: 0,
      score: 5, rewardFaces: 6,
      lineTraits: [1, 70, 130, 200],
      winningTraits: [1, 78, 131, 200],
      matchFaces: [2, 1, 0, 2],
      legs: [{
        legType: 'spin', spinType: 'flip', spinCount: 1, payout: 0n,
        reels: [],
      }],
    });
    assert.equal(seq.title, 'FOIL MATCH · T5');
    assert.equal(seq.noVessel, true);
    assert.equal(seq.autoStart, true);
    assert.deepEqual(seq.cards.map((card) => card.type), ['foil-match', 'spins']);
    assert.match(seq.cards[0].sub, /MAIN JACKPOT · 2 exact \(\+2\) · 1 symbol \(\+1\)/);
    assert.deepEqual(seq.cards[0].foilMatch.matchFaces, [2, 1, 0, 2]);
    assert.equal(seq.cards[0].foilMatch.rewardFaces, 6);
  });

  test('a foil FLIP survival loss estimates its reel payout from the face stake', () => {
    const oneFlip = 10n ** 18n;
    const seq = normalizeSequence({
      kind: 'foil-match', day: 44, level: 12, ticketIndex: 2, drawKind: 0,
      score: 4, rewardFaces: 2, foilMultBps: 50_000,
      lineTraits: [1, 70, 130, 200],
      winningTraits: [1, 78, 131, 201],
      matchFaces: [2, 1, 0, 1],
      legs: [{
        legType: 'spin', spinType: 'flip', survived: false, payout: 0n,
        reels: [
          { spinIndex: 0, playerTicket: 0x04030201n, resultTicket: 0x07060509n, score: 2 },
          { spinIndex: 1, playerTicket: 5n, resultTicket: 6n, score: 1 },
          { spinIndex: 2, playerTicket: 1n, resultTicket: 2n, score: 0 },
        ],
      }],
    });
    const spin = seq.cards.find((card) => card.spin)?.spin;
    assert.equal(spin.fixedStake, 2_000n * oneFlip,
      'T4 contributes its contract-fixed two faces at 1,000 FLIP each');
    assert.equal(spin.activityScore, 300,
      'the frozen 5x foil boost recovers the matching activity-score point');
    const board = buildBoxSpinBoard(spin);
    assert.ok(board.payoutAtRisk > 0n,
      'a zero final payout no longer degrades to a bare paying-reel count');
    assert.equal(
      board.rows.reduce((sum, row) => sum + row.previewPayout, 0n),
      board.payoutAtRisk,
    );
    assert.ok(board.rows[0].previewPayout > 0n,
      'the first paying reel can show its estimate as soon as it lands');
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

  test('a tutorial pack can carry the focused trait lesson into a two-ticket reveal', () => {
    const seq = normalizeSequence({
      kind: 'pack',
      level: 3,
      count: 2,
      tutorialTicketLesson: true,
      tickets: [
        { traitIds: [22, 73, 178, 219] },
        { traitIds: [47, 64, 166, 207] },
      ],
    });
    assert.equal(seq.ticketGrid.length, 2);
    assert.equal(seq.ticketLesson, true);
  });

  test('a live ticket cannot opt into tutorial lesson copy', () => {
    const seq = normalizeSequence({
      kind: 'pack',
      level: 3,
      count: 1,
      ticketLesson: true,
      tickets: [{ traitIds: [1, 70, 130, 200] }],
    });
    assert.equal(seq.ticketGrid.length, 1);
    assert.equal(seq.ticketLesson, false);
  });

  test('gold-ticket hero names its actual gold symbol and rebuilds the whole ticket at full size', () => {
    assert.equal(goldTicketLabel([56, 65, 130, 195]), 'GOLD WWXRP');
    assert.equal(goldTicketLabel([56, 65, 189, 195]), 'GOLD WWXRP · GOLD CASH SACK');
    assert.equal(goldTicketLabel([0, 64, 128, 253]), 'GOLD 6IX');
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

  test('pack reveal carries fractional traits as centerless quarter-ticket entries', () => {
    const seq = normalizeSequence({
      kind: 'pack',
      level: 7,
      count: 1.5,
      tickets: [{ traitIds: [1, 70, 130, 200] }],
      entries: [{ traitId: 72 }, 191, { traitId: 999 }],
    });
    assert.equal(seq.ticketGrid.length, 3, 'one ticket plus two valid loose entries are dealt');
    assert.deepEqual(seq.ticketGrid.map((piece) => Boolean(piece.entry)), [false, true, true]);
    assert.deepEqual(seq.ticketGrid.filter((piece) => piece.entry).map((piece) => piece.traitId), [72, 191]);
    assert.equal(seq.cards[1].type, 'ticket-entry');
    assert.equal(seq.cards[1].entryTraitId, 72);
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
    assert.equal(seq.cards[0].icon, '/shared/coinflip-face-eth.svg',
      'Daily Summary uses the familiar green ETH badge');
    assert.doesNotMatch(REVEAL_SRC, /eth-blue\.svg/,
      'reveal receipts do not fall back to the old blue ETH mark');
    assert.equal(seq.cards[1].label, 'LEVEL 3 TICKETS');
    assert.equal(seq.cards[1].packOnly, true,
      'the pack artwork owns its level and count without duplicate receipt copy');
    assert.match(REVEAL_SRC,
      /grid\.setAttribute\('data-card-count', String\(shown\.length\)\)/,
      'the receipt publishes its actual card count for balanced layouts');
    assert.match(APP_CSS,
      /\.rvl-stage--day-summary \.rvl-card-icon\s*\{[^}]*width:\s*clamp\(96px, 10vw, 112px\)[^}]*height:\s*clamp\(96px, 10vw, 112px\)/s,
      'ordinary reward badges share one day-summary visual scale');
    assert.match(APP_CSS,
      /data-card-count="2"[^}]*max-width:\s*760px[^}]*repeat\(2, minmax\(0, 1fr\)\)/s,
      'two-card receipts expand into two equal tracks');
    assert.match(APP_CSS,
      /data-card-count="7"[^}]*repeat\(8, minmax\(0, 1fr\)\)[\s\S]*?data-card-count="7"[^}]*nth-child\(5\)[^}]*grid-column:\s*2 \/ span 2/s,
      'a seven-card receipt centers its final three equal-width cards');
    assert.match(APP_CSS,
      /\.rvl-stage--day-summary \.rvl-card--pack-only \.rvl-reward-pack\.rvl-pack\s*\{[^}]*width:\s*124px[^}]*height:\s*169px/s,
      'pack-only daily rewards fit the same visual stage as currency badges');
  });

  test('daily summary reserves solo card animation for epic and legendary wins', () => {
    const small = normalizeSequence({
      kind: 'jackpot',
      day: 15,
      prizes: [
        { type: 'tickets', amount: 2, level: 3 },
        { type: 'flip', amount: 25n * 10n ** 18n },
      ],
      activity: {
        hasCoinflipBet: true,
        coinflipWon: false,
        coinflipStakeAmount: String(250n * 10n ** 18n),
      },
    });
    assert.deepEqual(small.cards.map((card) => card.type), [
      'tickets', 'flip', 'coinflip-result',
    ]);
    assert.deepEqual(daySummaryAnimatedCards(small.cards), [],
      'a coinflip loss, a rare FLIP line, and two common tickets go straight to the grid');
    assert.equal(small.big, false,
      'minor receipt rows cannot trigger the big-win fanfare or share treatment');

    const mixed = normalizeSequence({
      kind: 'jackpot', day: 15,
      prizes: [
        { type: 'eth', amount: 5n * 10n ** 15n },
        { type: 'tickets', amount: 2, level: 3 },
      ],
    });
    assert.deepEqual(daySummaryAnimatedCards(mixed.cards).map((card) => card.type), ['eth'],
      'only the epic ETH win receives a solo beat; tickets remain for the final grid');
    assert.equal(mixed.big, true);

    const flipWin = normalizeSequence({
      kind: 'jackpot', day: 15, prizes: [],
      activity: {
        hasCoinflipBet: true,
        coinflipWon: true,
        coinflipStakeAmount: String(250n * 10n ** 18n),
        coinflipRewardPercent: 82,
      },
    });
    assert.deepEqual(
      daySummaryAnimatedCards(flipWin.cards).map((card) => card.type),
      ['coinflip-result'],
      'a settled coinflip win remains a headline result',
    );
  });

  test('daily summary renders Decimator direct and lootbox ETH as one clear result', () => {
    const seq = normalizeSequence({
      kind: 'jackpot',
      day: 15,
      prizes: [{
        type: 'decimator',
        amount: 2_000_000_000_000n,
        lootboxAmount: 500_000_000_000n,
        terminalAmount: 0n,
      }],
    });
    assert.equal(seq.cards.length, 1);
    assert.equal(seq.cards[0].type, 'decimator');
    assert.equal(seq.cards[0].label, 'DECIMATOR WIN');
    assert.equal(seq.cards[0].icon, '/shared/coinflip-face-eth.svg');
    assert.equal(seq.cards[0].value, '2 ETH');
    assert.equal(seq.cards[0].sub, '0.5 ETH LUCKBOX');
  });

  test('daily summary identifies BAF ETH and ticket payouts instead of folding them into generic prizes', () => {
    const seq = normalizeSequence({
      kind: 'jackpot',
      day: 243,
      prizes: [
        { type: 'baf', level: 200, amount: 144_234_510_017_250n },
        { type: 'baf-tickets', level: 204, amount: 50n },
      ],
    });
    assert.deepEqual(seq.cards.map((card) => card.type), ['baf', 'baf-tickets']);
    assert.equal(seq.cards[0].label, 'LEVEL 200 BAF WIN');
    assert.equal(seq.cards[0].icon, '/app/assets/baf-mark.svg');
    assert.match(seq.cards[0].value, /ETH$/);
    assert.equal(seq.cards[1].label, 'BAF TICKETS');
    assert.equal(seq.cards[1].value, '50');
  });

  test('an empty-draw coinflip participant gets a full 1 WWXRP reward card', () => {
    const seq = normalizeSequence({
      kind: 'jackpot',
      day: 9,
      prizes: [{ type: 'wwxrp', amount: 10n ** 18n }],
      noWin: null,
      consolationOnly: true,
    });
    assert.equal(seq.big, false,
      'a consolation receipt is not promoted to a big-win sequence');
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
    assert.equal(seq.consolationOnly, true,
      'a settled full loss gets the red WWXRP UNLUCKY terminal treatment');
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

  test('day summary keeps actual DB-backed lootbox rewards but omits reveal/open activity rows', () => {
    const seq = normalizeSequence({
      kind: 'jackpot',
      day: 9,
      prizes: [],
      noWin: { sub: 'No winners recorded this day.' },
      activity: {
        ticketsRevealed: 14,
        lootboxesBought: 3,
        lootboxesOpened: 2,
        lootboxResults: [{
          lootboxIndex: 17,
          legs: [
            { legType: 'opened', wholeTickets: 2, futureLevel: 10, flip: 4n * 10n ** 18n },
            { legType: 'dgnrs', amount: 7n * 10n ** 18n },
          ],
        }],
      },
    });
    assert.equal(seq.title, 'DAY 9 SUMMARY');
    assert.deepEqual(seq.cards.map((card) => card.type), [
      'nowin', 'tickets', 'flip', 'dgnrs',
    ]);
    assert.doesNotMatch(seq.cards.map((card) => card.label).join(' '), /REVEALED|LUCKBOX BOUGHT/,
      'raw ticket-reveal and lootbox activity is not repeated in the receipt');
    assert.equal(seq.cards[1].value, '2');
    assert.equal(seq.cards[2].value, '4');
    assert.equal(seq.cards[3].value, '7');
    assert.ok(seq.cards.slice(1).every((card) => /LUCKBOX #17/.test(card.sub)),
      'each reward says which resolved box produced it');
  });

  test('day summary records paid BoxSpins without replaying reels and omits zero results', () => {
    const seq = normalizeSequence({
      kind: 'jackpot',
      day: 9,
      prizes: [],
      noWin: { sub: 'No winners recorded this day.' },
      activity: {
        lootboxResults: [{
          lootboxIndex: 17,
          legs: [{
            legType: 'spin',
            spinType: 'flip',
            payout: 240n * 10n ** 18n,
            survived: true,
            reels: [
              { spinIndex: 0, playerTicket: 1n, resultTicket: 2n, score: 2 },
              { spinIndex: 1, playerTicket: 3n, resultTicket: 4n, score: 0 },
              { spinIndex: 2, playerTicket: 5n, resultTicket: 6n, score: 3 },
            ],
          }, {
            legType: 'spin',
            spinType: 'eth',
            payout: 10n ** 16n,
            ethShare: 5n * 10n ** 15n,
            reels: [
              { spinIndex: 0, playerTicket: 7n, resultTicket: 8n, score: 2 },
            ],
          }, {
            legType: 'spin',
            spinType: 'wwxrp',
            payout: 0n,
            reels: [
              { spinIndex: 0, playerTicket: 9n, resultTicket: 10n, score: 0 },
            ],
          }],
        }],
      },
    });

    const settledSpins = seq.cards.filter((card) => card.settledBoxSpin);
    assert.equal(settledSpins.length, 2,
      'distinct paid children remain receipt rows while the zero spin is omitted');
    assert.ok(settledSpins.every((card) => card.spin === null),
      'none of the completed children can re-enter reel choreography');
    const spin = settledSpins.find((card) => card.label === 'FLIP BOX SPIN');
    assert.ok(spin, 'the settled spin remains visible in the day receipt');
    assert.equal(spin.label, 'FLIP BOX SPIN');
    assert.equal(spin.value, '240 FLIP');
    assert.match(spin.sub, /2 of 3 paid/);
    assert.match(spin.sub, /LUCKBOX #17/);
    assert.equal(settledSpins.some((card) => card.label === 'WWXRP BOX SPIN'), false,
      'a zero-payout BoxSpin adds no noise to the daily summary');
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
    assert.equal(winCard.value, '+455 FLIP');
    assert.equal(winCard.sub, 'WIN 182%');
    assert.equal(winCard.outcomeLabel, 'WIN');
    assert.equal(winCard.outcomePercent, '182%');
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
    assert.equal(lossCard.value, '-250 FLIP');
    assert.equal(lossCard.label, 'COINFLIP LOSS');
    assert.equal(lossCard.sub, '+1 WWXRP');
    assert.equal(lossCard.outcomeLabel, null);
    assert.equal(lossCard.outcomePercent, null);
    assert.equal(lossCard.consolationWwxrp, '+1 WWXRP');
    assert.equal(lossCard.outcome, 'loss');
    assert.equal(lost.cards.some((card) => card.type === 'wwxrp'), false,
      'the consolation is folded into the flip loss instead of becoming another card');
    assert.equal(lost.consolationOnly, true,
      'WWXRP plus a lost flip is still a full loss, even without a caller hint');
  });

  test('day summary includes one aggregated Craps card only for positive indexed wins', () => {
    const won = normalizeSequence({
      kind: 'jackpot',
      day: 9,
      prizes: [],
      activity: {
        crapsWinningsAmount: String(1_234n * 10n ** 18n),
        crapsWinCount: 3,
      },
    });
    assert.ok(won);
    assert.equal(won.cards.length, 1);
    assert.deepEqual(won.cards[0], {
      type: 'craps-result',
      rarity: 'rare',
      icon: null,
      glyph: null,
      label: 'CRAPS WINNINGS',
      value: '+1,234 FLIP',
      sub: '3 WINNING BATTLES',
      crapsWinCount: 3,
      summaryDetail: true,
      countText: null,
      spin: null,
    });
    assert.equal(won.consolationOnly, false);

    assert.equal(normalizeSequence({
      kind: 'jackpot', day: 9, prizes: [],
      activity: { crapsWinningsAmount: '0', crapsWinCount: 2 },
    }), null, 'zero payout does not create a participation card');
    assert.equal(normalizeSequence({
      kind: 'jackpot', day: 9, prizes: [],
      activity: { crapsWinningsAmount: '1000000000000000000', crapsWinCount: 0 },
    }), null, 'a malformed payout without a winning battle is omitted');
  });

  test('unknown kind / junk → null', () => {
    assert.equal(normalizeSequence({ kind: 'nope' }), null);
    assert.equal(normalizeSequence(null), null);
  });

  test('growth and volume bet results use player-facing names', () => {
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
    assert.equal(paid.title, 'GROWTH BET PAID');
    assert.equal(paid.cards[0].type, 'flip');
    assert.equal(paid.cards[0].icon, '/whitepaper/flame-logo-split.svg');
    assert.equal(paid.cards[0].label, 'GROWTH BET · LEVEL 12');
    assert.match(paid.cards[0].value, /FLIP$/);

    const lost = normalizeSequence({
      kind: 'pari',
      market: 'volume',
      round: 7,
      side: 2,
      outcome: 1,
      payout: 0n,
      betTickets: '1,953.11',
      resultTickets: '2,014.25',
    });
    assert.equal(lost.title, 'VOLUME BET RESULT');
    assert.equal(lost.cards[0].type, 'nowin');
    assert.equal(lost.cards[0].label, 'YOUR BET: UNDER 1,953.11 TICKETS');
    assert.equal(lost.cards[0].value, 'RESULT: 2,014.25 TICKETS');
    assert.equal(lost.cards[0].sub, 'LOSS · 0 FLIP');
    assert.equal(lost.cards[0].summaryDetail, true);
    assert.equal(lost.cards[0].labelFirst, true);
    assert.doesNotMatch(lost.cards[0].label, /ROUND/i,
      'volume receipts keep the internal contract round hidden');
  });

  test('a side-bet result skips the duplicate full-card then summary sequence', () => {
    const source = readFileSync(new URL('../reveal-overlay.js', import.meta.url), 'utf8');
    assert.match(source, /if \(seq\.kind === 'pari' && seq\.cards\.length === 1\)[\s\S]*?#renderSummary\(seq\)/);
    assert.match(source, /rootStage\.classList\.toggle\('rvl-stage--pari', seq\.kind === 'pari'\)/);
  });

  // Degenerette bet board (user ask 2026-07-29): one row per spin. The pick is
  // constant down the board; the house reel is not — spin 0's comes off
  // DegeneretteResolved, the rest from dgn-reels.js.
  test('degenerette: a row per spin, ETH unit, hero carried, no survival flip', () => {
    const seq = normalizeSequence({
      kind: 'degenerette',
      currency: 0,
      heroIdx: 2,
      lootboxAwarded: true,
      lootboxEth: 10n ** 16n,
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
    assert.equal(seq.spinBoard.lootboxAwarded, true);
    assert.equal(seq.spinBoard.lootboxEth, 10n ** 16n,
      'the emitted recirculated ETH leg remains separate from claimable ETH');
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
    assert.equal(seq.unlucky, true, 'a zero-payout result is a genuine loss');
  });

  test('degenerette: a positive payout below the wager is a return, not a celebration', () => {
    const seq = normalizeSequence({
      kind: 'degenerette',
      currency: 3,
      amountPerSpin: 10n,
      // The row count makes the authoritative wager 20 even if this stale
      // caller aggregate says otherwise.
      totalWager: 10n,
      totalPayout: 15n,
      spins: [
        { spinIndex: 0, playerTraits: 1, houseTraits: 1, score: 2, payout: 15n },
        { spinIndex: 1, playerTraits: 1, houseTraits: 2, score: 0, payout: 0n },
      ],
    });
    assert.equal(seq.spinBoard.totalWager, 20n);
    assert.equal(seq.spinBoard.celebrate, false);
    assert.equal(seq.title, 'PARTIAL RETURN');
    assert.equal(seq.big, false);
    assert.equal(seq.unlucky, false, 'a 75% return is neutral rather than UNLUCKY');
    assert.equal(isUnluckyDegenerette({ total: 39n, totalWager: 100n }), true);
    assert.equal(isUnluckyDegenerette({ total: 40n, totalWager: 100n }), false,
      'exactly 40% is the neutral boundary');
    assert.equal(isUnluckyDegenerette({ total: 99n, totalWager: 100n }), false);
    assert.equal(isUnluckyDegenerette({ total: 0n, totalWager: 100n, boxSpin: true }), false,
      'free box spins are never judged against a player stake');
    assert.equal(shouldCelebrateDegenerette({ total: 15n, totalWager: 20n }), false);
    assert.equal(shouldCelebrateDegenerette({ total: 20n, totalWager: 20n }), true,
      'getting the full stake back meets the requested threshold');
    assert.equal(shouldCelebrateDegenerette({ total: 1n, totalWager: 0n }), true,
      'old receipts without wager metadata keep their positive-payout treatment');
    assert.equal(shouldCelebrateDegenerette({ total: 1n, totalWager: 20n, boxSpin: true }), true,
      'a granted lootbox spin has no player stake to lose');
    assert.match(
      REVEAL_SRC,
      /const celebrate = !wwxrpOnly && shouldCelebrateDegenerette\(board\)[\s\S]*?if \(celebrate\) \{[\s\S]*?sfxFanfare[\s\S]*?#celebrateWin[\s\S]*?\} else if \(sequence\.unlucky\) \{[\s\S]*?sfxNoWin/,
      'fanfare follows net outcome while a WWXRP-only box remains unlucky',
    );
  });

  test('degenerette: a preliminary FLIP hit with zero final payout stages a survival bust', () => {
    const seq = normalizeSequence({
      kind: 'degenerette',
      currency: 1,
      totalPayout: 0n,
      spins: [{ spinIndex: 0, playerTraits: 13, houseTraits: 13, score: 5, payout: 500n }],
    });
    assert.equal(seq.spinBoard.survived, false);
    assert.equal(seq.spinBoard.spinSum, 500n);
    assert.equal(seq.title, 'SURVIVAL FLIP LOST');
    assert.equal(seq.cards[0].value, '0 FLIP');
    assert.match(seq.cards[0].sub, /1 of 1 hit.*survival flip lost/i);
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
  // The reported defect: every amount on a busted box spin came from the
  // settled payout, which the contract zeroes on a bust, so the panel could
  // only count reels. The stake now arrives independently of the coin.
  test('names the same stake and the same prize whether the coin won or lost', () => {
    const oneFlip = 10n ** 18n;
    const reels = [
      { spinIndex: 0, playerTicket: 0xC3824100n, resultTicket: 0xC7864504n, score: 3 },
      { spinIndex: 1, playerTicket: 0xC3824101n, resultTicket: 0xC7864505n, score: 1 },
      { spinIndex: 2, playerTicket: 0xC3824102n, resultTicket: 0xC7864506n, score: 0 },
    ];
    const won = buildBoxSpinBoard({
      spinType: 'flip',
      survived: true,
      payout: 600n * oneFlip,
      preSurvivalPayout: 300n * oneFlip,
      reels,
    });
    const busted = buildBoxSpinBoard({
      spinType: 'flip',
      survived: false,
      payout: 0n,
      preSurvivalPayout: 300n * oneFlip,
      reels,
    });

    assert.equal(busted.payoutAtRisk, 300n * oneFlip,
      'a bust no longer has to fall back to a bare reel count');
    assert.equal(busted.payoutAtRisk, won.payoutAtRisk);
    assert.equal(busted.survivalWinPayout, won.survivalWinPayout,
      'the pre-flip prize is identical, so the strip cannot leak the result');
    assert.equal(busted.survivalWinPayout, 600n * oneFlip);
    assert.equal(busted.payoutAtRiskApproximate, false);
    assert.equal(
      busted.rows.reduce((sum, row) => sum + row.previewPayout, 0n),
      300n * oneFlip,
      'the busted reels still add back to what they earned',
    );
  });

  test('uses a known survivor payout immediately even when the FLIP granule applies', () => {
    const oneFlip = 10n ** 18n;
    const reels = [
      { spinIndex: 0, playerTicket: 0xC3824100n, resultTicket: 0xC7864504n, score: 3 },
      { spinIndex: 1, playerTicket: 0xC3824101n, resultTicket: 0xC7864505n, score: 1 },
      { spinIndex: 2, playerTicket: 0xC3824102n, resultTicket: 0xC7864506n, score: 0 },
    ];
    // Above 1,000 FLIP the contract collapses the surviving mint onto a whole
    // 100-FLIP multiple, so halving it recovers the stake only to within 50.
    const collapsed = buildBoxSpinBoard({
      spinType: 'flip', survived: true, payout: 4_200n * oneFlip, reels,
    });
    assert.equal(collapsed.payoutAtRisk, 2_100n * oneFlip);
    assert.equal(collapsed.payoutAtRiskApproximate, false,
      'the emitted survivor amount is authoritative for presentation');
    assert.equal(collapsed.survivalWinPayout, 4_200n * oneFlip);
    assert.equal(collapsed.survivalWinPayoutApproximate, false);

    // Below it the mint keeps a whole-FLIP floor, which halves cleanly enough
    // to present without a qualifier.
    const floored = buildBoxSpinBoard({
      spinType: 'flip', survived: true, payout: 600n * oneFlip, reels,
    });
    assert.equal(floored.payoutAtRiskApproximate, false);
  });

  test('a known survivor outranks an aggregate combo estimate immediately', () => {
    const oneFlip = 10n ** 18n;
    const board = buildBoxSpinBoard({
      spinType: 'flip',
      survived: true,
      payout: 16_000n * oneFlip,
      // Deliberately reproduce the old bad input: the full Small + Medium +
      // Large purchase was routed into the one Medium spin.
      estimateBoxAmountWei: 310_000_000_000n,
      estimateTicketPriceWei: 10_000_000_000n,
      reels: [
        { spinIndex: 0, playerTicket: 0xC3824100n, resultTicket: 0xC7864504n, score: 3 },
        { spinIndex: 1, playerTicket: 0xC3824101n, resultTicket: 0xC7864505n, score: 0 },
        { spinIndex: 2, playerTicket: 0xC3824102n, resultTicket: 0xC7864506n, score: 4 },
      ],
    });

    assert.equal(board.payoutAtRisk, 8_000n * oneFlip,
      'the reels use the known survivor settlement instead of an average roll');
    assert.equal(board.payoutAtRiskApproximate, false);
    settleBoxSpinPayoutPresentation(board);
    assert.equal(board.payoutAtRisk, 8_000n * oneFlip,
      'settling the coin keeps the already-authoritative reel sum');
    assert.equal(board.payoutAtRiskApproximate, false);
    assert.equal(board.survivalWinPayout, 16_000n * oneFlip);
    assert.equal(board.survivalWinPayoutApproximate, false,
      'the actual settled win is exact');
  });

  test('estimates the same pre-survival reel payout on a BoxSpin bust', () => {
    const board = buildBoxSpinBoard({
      spinType: 'flip',
      survived: false,
      payout: 0n,
      estimateBoxAmountWei: 1_000_000_000_000n,
      estimateTicketPriceWei: 10_000_000_000n,
      reels: [
        { spinIndex: 0, playerTicket: 0xC3824100n, resultTicket: 0xC7864504n, score: 3 },
        { spinIndex: 1, playerTicket: 0xC3824101n, resultTicket: 0xC7864505n, score: 1 },
        { spinIndex: 2, playerTicket: 0xC3824102n, resultTicket: 0xC7864506n, score: 0 },
      ],
    });
    assert.ok(board.payoutAtRisk > 0n);
    assert.equal(board.payoutAtRiskApproximate, true);
    assert.equal(
      board.rows.reduce((sum, row) => sum + row.previewPayout, 0n),
      board.payoutAtRisk,
    );
    assert.equal(board.rows[0].previewApproximate, true,
      'the estimate qualifier follows the amount onto the paying reel');
  });

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
    assert.equal(board.survivalStage, true);
    assert.equal(board.survivalStake, true);
    assert.equal(board.payoutAtRisk, 450n);
    assert.equal(board.payoutAtRiskApproximate, false,
      'double-or-nothing makes a successful final payout exactly twice the stake');
    assert.equal(
      board.rows.reduce((sum, row) => sum + row.previewPayout, 0n),
      450n,
      'the visible row payouts add back to the exact pre-survival stake',
    );
    const legacy = buildBoxSpinBoard({
      spinType: 'flip',
      payout: 900n,
      reels: [{ playerTicket: 1n, resultTicket: 2n, score: 2 }],
    });
    assert.equal(legacy.survived, true,
      'a positive final payout proves survival when an older feed omits the packed bit');
    assert.equal(board.headline, 'LUCKBOX SPIN');
    assert.doesNotMatch(board.headline, /ETH|FLIP|WWXRP/,
      'the board heading stays neutral until the first reel lands');
  });

  test('S2 is the payout floor and a lone first-reel hit gets the visible amount', () => {
    const oneFlip = 10n ** 18n;
    const board = buildBoxSpinBoard({
      spinType: 'flip',
      survived: true,
      payout: 119_500n * oneFlip,
      reels: [
        { spinIndex: 0, playerTicket: 3903807507n, resultTicket: 3548862479n, score: 3 },
        { spinIndex: 1, playerTicket: 3618336562n, resultTicket: 4156442126n, score: 1 },
        { spinIndex: 2, playerTicket: 3685501986n, resultTicket: 3297265676n, score: 0 },
      ],
    });
    assert.equal(boxSpinScorePays(1), false);
    assert.equal(boxSpinScorePays(2), true);
    assert.deepEqual(board.rows.map((row) => row.won), [true, false, false]);
    assert.equal(board.payoutAtRisk, 59_750n * oneFlip);
    assert.deepEqual(
      board.rows.map((row) => row.previewPayout),
      [59_750n * oneFlip, 0n, 0n],
    );
    assert.equal(board.rows[0].previewApproximate, false,
      'a lone paying reel owns the entire known survivor pot');
  });

  test('marks the contract-derived Hero independently on each FLIP reel', () => {
    const oneFlip = 10n ** 18n;
    const board = buildBoxSpinBoard({
      betId: 11_026_022_280_916_248_713n,
      spinType: 'flip',
      survived: true,
      payout: 170_100n * oneFlip,
      reels: [
        { spinIndex: 0, playerTicket: 4_203_172_354n, resultTicket: 4_136_200_202n, score: 2 },
        { spinIndex: 1, playerTicket: 3_835_317_537n, resultTicket: 3_380_768_558n, score: 2 },
        { spinIndex: 2, playerTicket: 3_968_814_117n, resultTicket: 3_937_362_177n, score: 2 },
      ],
    });

    assert.equal(board.heroIdx, null,
      'a three-reel FLIP chain has no truthful board-wide Hero quadrant');
    assert.deepEqual(board.rows.map((row) => row.heroIdx), [0, 2, 2],
      'each sole symbol match is visibly marked as the Hero +2 that produced its S2 payout');
    assert.equal(board.total, 170_100n * oneFlip,
      'correcting Hero attribution does not discard the verified group payout');

    const ambiguous = buildBoxSpinBoard({
      spinType: 'flip',
      survived: false,
      payout: 0n,
      reels: [{
        playerTicket: 4_103_754_283n,
        resultTicket: 3_853_144_853n,
        score: 1,
      }],
    });
    assert.equal(ambiguous.rows[0].heroIdx, null,
      'an S1 whose Hero cannot be reconstructed does not invent a misleading marker');
  });

  test('uses an exact bounty-reel Hero when the packed score is ambiguous', () => {
    const board = buildBoxSpinBoard({
      spinType: 'record',
      payout: 0n,
      reels: [{
        spinIndex: 0,
        playerTicket: 0xC0804000n,
        resultTicket: 0xC1814100n,
        score: 2,
        heroQuadrant: 2,
      }],
    });

    assert.equal(board.rows[0].heroIdx, 2,
      'the exact parent-seed derivation wins where three Hero choices fit S2');
  });

  test('a one-symbol box win carries the seed-selected hero into the board', () => {
    const board = buildBoxSpinBoard({
      betId: 9_350_854_869_760_465_101n,
      spinType: 'wwxrp',
      payout: 1_436_259_825n,
      reels: [{
        playerTicket: 3_818_745_606n,
        resultTicket: 4_071_640_845n,
        score: 2,
      }],
    });

    assert.equal(board.heroIdx, 1,
      'the matching Aquarius cell is visibly marked as the +2 hero quadrant');
    assert.equal(board.rows[0].won, true);
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

  test('an all-miss FLIP lane has no survival stage or fabricated draw', () => {
    const board = buildBoxSpinBoard({
      spinType: 'flip',
      survived: false,
      payout: 0n,
      reels: [{ playerTicket: 1n, resultTicket: 2n, score: 0 }],
    });
    assert.equal(board.total, 0n);
    assert.equal(board.survived, null);
    assert.equal(board.survivalStage, false);
    assert.equal(board.survivalStake, false);

    const busted = buildBoxSpinBoard({
      spinType: 'flip',
      survived: false,
      payout: 0n,
      reels: [{ playerTicket: 1n, resultTicket: 2n, score: 2 }],
    });
    assert.equal(busted.survived, false,
      'a payout-bearing reel plus a false packed bit is a real survival bust');
    assert.equal(busted.survivalStake, true);
  });

  test('a zero-payout record bounty becomes a direct three-reel FLIP board', () => {
    const oneFlip = 10n ** 18n;
    const spin = {
      spinType: 'record',
      survived: false,
      payout: 0n,
      recordStake: 900n * oneFlip,
      activityScore: 305,
      reels: [
        { spinIndex: 0, playerTicket: 1n, resultTicket: 2n, score: 0 },
        {
          spinIndex: 1,
          playerTicket: 0x04030201n,
          resultTicket: 0x07060509n,
          score: 2,
        },
        { spinIndex: 2, playerTicket: 5n, resultTicket: 6n, score: 1 },
      ],
    };
    const board = buildBoxSpinBoard(spin);

    assert.equal(board.currency, 1);
    assert.equal(board.unit, 'FLIP');
    assert.equal(board.total, 0n);
    assert.equal(board.rows.length, 3);
    assert.equal(board.survived, false);
    assert.equal(board.headline, 'BIGGEST SPIN BOUNTY');
    assert.equal(board.currencyKnown, true,
      'a biggest-spin bounty is authored as FLIP and needs no mystery-currency draw');
    assert.ok(board.payoutAtRisk > 0n,
      'the parent bounty stake reconstructs what its paying reels lost on the final flip');
    assert.equal(board.payoutAtRiskApproximate, false,
      'the emitted score identifies one hero interpretation for this reel');
    assert.equal(board.survivalWinPayout, board.payoutAtRisk * 2n);

    const neutralActivityEstimate = buildBoxSpinBoard({ ...spin, activityScore: null });
    assert.ok(neutralActivityEstimate.payoutAtRisk > 0n);
    assert.equal(neutralActivityEstimate.payoutAtRiskApproximate, true,
      'a legacy bounty with its stake but no activity snapshot remains visibly approximate');

    const sequence = normalizeSequence({ kind: 'record-bounty', spin });
    assert.equal(sequence.kind, 'record-bounty');
    assert.equal(sequence.noVessel, true);
    assert.equal(sequence.spinBoard.rows.length, 3);
    assert.equal(sequence.spinBoard.headline, 'BIGGEST SPIN BOUNTY');
  });

  test('rejects unknown or empty spin payloads instead of fabricating reels', () => {
    assert.equal(buildBoxSpinBoard({ spinType: 'mystery', reels: [{}] }), null);
    assert.equal(buildBoxSpinBoard({ spinType: 'wwxrp', reels: [] }), null);
  });

  test('mystery box currency flips after reel one while a known-FLIP record bounty does not', () => {
    assert.match(
      REVEAL_SRC,
      /completed = i \+ 1;[\s\S]*?if \(board\.boxSpin && i === 0 && !currencyRevealed\)[\s\S]*?#appendBoxSpinCurrencyReveal[\s\S]*?interstitial: true/,
      'only a still-hidden denomination gets the reveal beat after reel one',
    );
    assert.match(REVEAL_SRC, /currencyKnown:\s*spinType === 'record'/,
      'record bounties declare their fixed FLIP currency on the canonical board');
    assert.doesNotMatch(
      REVEAL_SRC,
      /if \(board\.boxSpin && i === 0 && board\.total > 0n\)/,
      'a miss cannot suppress the currency flip',
    );
    assert.match(REVEAL_SRC, /const countIsRevealed = !board\.boxSpin \|\| currencyRevealed \|\| i > 0/,
      'only mystery BoxSpins hide their reel count before reel one');
    assert.match(
      REVEAL_SRC,
      /MORE FLIP SPINS/,
      'the FLIP landing introduces its two remaining reels without promising a nonexistent gate',
    );
    assert.doesNotMatch(REVEAL_SRC, /MORE FLIP SPINS · THEN SURVIVAL/);
    assert.match(REVEAL_SRC, /const BOX_CURRENCY_FLIP_MS = 2_000/,
      'the box currency coin gets the compressed two-second track and landing');
    assert.match(
      REVEAL_SRC,
      /readDegeneretteSpeed\(\)[\s\S]*?BOX_CURRENCY_FLIP_MS - landingBaseMs[\s\S]*?landingBaseMs \/ revealSpeed[\s\S]*?#waitForCoinflip\(trackMs\)[\s\S]*?#waitForCoinflip\(endingMs\)/,
      'the non-skippable landing splits at the edge-on boundary and still scales once',
    );
    assert.match(
      REVEAL_SRC,
      /rvl-box-currency-coin[\s\S]*?df-coin3d__inner[\s\S]*?df-reveal-active[\s\S]*?df-reveal-track--comet[\s\S]*?df-reveal-ending--loss[\s\S]*?df-reveal-ending--win/,
      'the currency selector uses the normal Daily Flip track and truthful ordinary endings',
    );
    // Superseded: a preloaded FLIP back face put the flame on screen at every
    // half-turn of the track, which announced the currency long before the
    // coin landed. The rotating back is now outcome-neutral for all three.
    assert.doesNotMatch(REVEAL_SRC,
      /backSrc:\s*board\.currency === 1 \? ICONS\.flip : ICONS\.ethFace/,
      'the destination art must not be loaded into the plane that spins');
    assert.match(REVEAL_SRC,
      /appendCoinFaces\(coin, \{\s*frontSrc: ICONS\.wwxrp,\s*backSrc: ICONS\.ethFace,\s*\}\)/,
      'every currency spins the same neutral back face');
    assert.match(REVEAL_SRC,
      /#waitForCoinflip\(trackMs\);[\s\S]*?board\.currency === 1 && faces\?\.backImage\) faces\.backImage\.src = ICONS\.flip;[\s\S]*?#waitForCoinflip\(endingMs\)/,
      'the flame is installed only after the track, and only for a FLIP result');
    assert.doesNotMatch(REVEAL_SRC, /rvl-box-currency-flip-face/);
    assert.doesNotMatch(APP_CSS, /rvl-box-currency-flip-face/);
    assert.doesNotMatch(APP_CSS, /@keyframes rvl-box-currency-(?:toss|face)/,
      'the old ring-shaped pseudo flip is gone');
    assert.match(REVEAL_SRC, /const SURVIVAL_FLIP_MS = 2_000/,
      'the survival toss gets the same compressed two-second window');
    assert.match(REVEAL_SRC, /#waitForCoinflip\(SURVIVAL_FLIP_MS\)/,
      'the survival toss cannot be shortened by a backdrop tap or reel-speed preference');
    assert.match(
      APP_CSS,
      /\.rvl-survival-coin\.df-reveal-active\s*\{[^}]*animation-duration:\s*1650ms,\s*350ms;[^}]*animation-delay:\s*0ms,\s*1650ms;/s,
      'the survival rotor and its two-second wait stay synchronized',
    );
    assert.match(
      REVEAL_SRC,
      /rvl-survival-coin[\s\S]*?board\.survived \? 'df-reveal-ending--win' : 'df-reveal-ending--loss'/,
      'survival selects the truthful win/loss ending without a reversal ending',
    );
    const survivalSource = REVEAL_SRC.slice(
      REVEAL_SRC.indexOf('async #appendFullSpinSurvival'),
      REVEAL_SRC.indexOf('async #finishFullSpinBoard'),
    );
    assert.match(survivalSource, /rvl-survival-coin-face/,
      'survival uses one physical artwork surface');
    assert.doesNotMatch(survivalSource, /df-coin3d__inner/,
      'the Daily Flip rotor cannot override and desynchronize the survival edge swaps');
    assert.doesNotMatch(survivalSource, /appendCoinFaces\(/,
      'the survival toss cannot expose a second compositor-owned coin face');
    assert.match(
      APP_CSS,
      /@keyframes rvl-survival-face-track[\s\S]*?coinflip-face-red\.svg[\s\S]*?coinflip-face-eth\.svg/,
      'the one surface alternates red and ETH artwork during the toss',
    );
    assert.match(APP_CSS, /\.rvl-survival\s*\{[^}]*overflow:\s*hidden/s,
      'the compact survival toss remains inside its result card');
    assert.match(
      APP_CSS,
      /@keyframes rvl-survival-coin-track[\s\S]*?20%[^}]*translate3d\(0, -9px, 0\)/,
      'the contained toss keeps its lift inside the compact arena',
    );
    assert.doesNotMatch(REVEAL_SRC, /rvl-survival-(?:halo|shadow)/,
      'survival has no decorative circle around the real coin');
    assert.doesNotMatch(APP_CSS, /@keyframes rvl-survival-(?:toss|turn|land)/,
      'the old short single-image survival motion is gone');
    assert.match(
      REVEAL_SRC,
      /#renderFullSpinStage\(board,\s*\{[\s\S]*?speedEnabled:\s*!board\.boxSpin,[\s\S]*?launchFromLootbox:\s*Boolean\(options\.launchFromLootbox\)/,
      'a bonus BoxSpin inherits reveal speed and can enter through the one-time box-launch transition',
    );
  });
});

describe('buildDegeneretteSpinFrames', () => {
  test('randomizes all eight component locks and lands on the verified ticket', () => {
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
    assert.equal(lockFrames.filter((frame) => frame.lock.type === 'color').length, 4);
    assert.equal(lockFrames.filter((frame) => frame.lock.type === 'symbol').length, 4);
    assert.equal(new Set(lockFrames.map((frame) => (
      `${frame.lock.quadrant}:${frame.lock.type}`
    ))).size, 8, 'every quadrant locks each component exactly once');
    assert.ok(frames.some((frame) => frame.lock == null), 'whole-token idle rolls are present');
    for (let q = 0; q < 4; q++) {
      const colorAt = frames.findIndex((frame) => (
        frame.lock?.quadrant === q && frame.lock.type === 'color'
      ));
      const symbolAt = frames.findIndex((frame) => (
        frame.lock?.quadrant === q && frame.lock.type === 'symbol'
      ));
      assert.ok(symbolAt >= 0 && colorAt >= 0,
        `quadrant ${q} receives both independent locks`);
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

    const firstComponentTypes = new Set();
    for (let spinIndex = 0; spinIndex < 32; spinIndex += 1) {
      const sampleLocks = buildDegeneretteSpinFrames({ ...args, spinIndex })
        .filter((frame) => frame.lock != null);
      for (let q = 0; q < 4; q += 1) {
        firstComponentTypes.add(sampleLocks.find((frame) => frame.lock.quadrant === q).lock.type);
      }
    }
    assert.deepEqual([...firstComponentTypes].sort(), ['color', 'symbol'],
      'seeded plans allow either color or symbol to be first in a quadrant');
    assert.match(
      REVEAL_SRC,
      /sfxMatchLock\(lockMatch, matchingSoundCount\)/,
      'the reveal sends its color, symbol, or both classification to audio',
    );
  });

  test('classifies color, symbol, and completed-trait matches without bobbing color alone', () => {
    const player = [{ sym: 2, col: 5 }];
    const target = [{ sym: 2, col: 5 }];
    const frame = (type, colorLocked, symbolLocked) => ({
      lock: { quadrant: 0, type },
      lockedColors: [colorLocked, false, false, false],
      lockedSymbols: [symbolLocked, false, false, false],
    });

    assert.equal(degeneretteLockMatchType(player, target, frame('color', true, false)), 'color');
    assert.equal(degeneretteLockMatchType(player, target, frame('symbol', false, true)), 'symbol');
    assert.equal(degeneretteLockMatchType(player, target, frame('color', true, true)), 'both');
    assert.equal(degeneretteLockMatchType(
      [{ sym: 2, col: 4 }],
      target,
      frame('color', true, false),
    ), null, 'a component miss keeps the ordinary lock tick');

    assert.equal(shouldBobDegeneretteLock('color', 8), false,
      'a color-only lock never bobs, even late in the ladder');
    assert.equal(shouldBobDegeneretteLock('symbol', 2), false);
    assert.equal(shouldBobDegeneretteLock('symbol', 3), true);
    assert.equal(shouldBobDegeneretteLock('both', 3), true);
    assert.match(REVEAL_SRC, /shouldBobDegeneretteLock\(lockMatch, matchingLocks\)/,
      'the motion path uses the scoring-aware bob rule');
  });
});

describe('pickBiggestSpinResult', () => {
  test('defaults autospin to the highest payout, with score as the tie-breaker', () => {
    const rows = [
      { spinIndex: 0, payout: 20n, score: 3 },
      { spinIndex: 1, payout: 40n, score: 2 },
      { spinIndex: 2, payout: 40n, score: 6 },
    ];
    assert.equal(pickBiggestSpinResult(rows), rows[2]);
    assert.equal(pickBiggestSpinResult([]), null);
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
    storeMod.__resetForTest();
    pendingActionsMod.__resetPendingActionsForTest();
    globalThis.localStorage.clear();
    globalThis.window.matchMedia = () => ({ matches: true });
  });

  test('one indexed lootbox release can only enter the live reveal queue once', () => {
    const release = {
      address: '0x00000000000000000000000000000000000000ab',
      key: 'tx:0xstable-box',
      lootboxIndex: 12,
      transactionHash: '0xstable-box',
    };
    const box = {
      kind: 'lootbox',
      lootboxRelease: release,
      legs: [{ legType: 'dgnrs', amount: 10n ** 18n }],
    };

    assert.equal(queueReveal(box), true);
    assert.equal(queueReveal({ ...box, lootboxRelease: { ...release } }), false,
      'receipt parsing and the indexed tray cannot enqueue the same live box twice');
    assert.equal(__takeQueuedForTest().length, 1);
  });

  test('one claimed Bingo can only enter the reveal queue once across receipt paths', () => {
    const bingo = {
      kind: 'bingo', player: '0x00000000000000000000000000000000000000ab',
      level: 31, symbol: 18, quadrant: 2,
      flipReward: 1_000n * 10n ** 18n, dgnrsPaid: 0n,
    };

    assert.equal(queueReveal({ ...bingo, id: 'local-receipt' }), true);
    assert.equal(queueReveal({ ...bingo, id: 'indexed-event' }), false,
      'local receipt and indexer discovery share one protocol-level presentation id');
    assert.equal(__takeQueuedForTest().length, 1);
  });

  test('one settled side bet can only enter the reveal queue once', () => {
    const result = {
      kind: 'pari',
      player: '0x00000000000000000000000000000000000000ab',
      market: 'volume',
      round: 31,
      side: 1,
      outcome: 1,
      payout: 2_000n * 10n ** 18n,
      betTickets: '20',
      resultTickets: '24',
    };
    assert.equal(queueReveal(result), true);
    assert.equal(queueReveal({ ...result }), false);
    assert.equal(__takeQueuedForTest().length, 1);
  });

  test('closing the overlay hands a queued Bingo back instead of burning it', async () => {
    const aborts = [];
    const onAbort = (event) => aborts.push(event.detail);
    document.addEventListener(RESULT_REVEAL_ABORT_EVENT, onAbort);
    try {
      const bingo = {
        kind: 'bingo', player: '0x00000000000000000000000000000000000000ab',
        level: 31, symbol: 18, quadrant: 2,
        flipReward: 1_000n * 10n ** 18n, dgnrsPaid: 0n,
        revealRelease: { address: '0x00000000000000000000000000000000000000ab', id: 'bingo-row-7' },
      };
      assert.equal(queueReveal(bingo), true);
      const el = instantiate();
      await tick();

      // The player hits the X before the prize plays.
      el.querySelector('[data-bind="rvl-close"]').dispatchEvent({ type: 'click' });
      await tick();

      assert.equal(aborts.length, 1, 'the publisher is told its prize never played');
      const [entry] = aborts[0].released;
      assert.equal(entry.kind, 'bingo');
      assert.equal(entry.presentationId, 'bingo-reveal:0x00000000000000000000000000000000000000ab:31:2');
      assert.deepEqual(entry.release, {
        address: '0x00000000000000000000000000000000000000ab', id: 'bingo-row-7',
      });
      assert.equal(queueReveal(bingo), true,
        'the released id lets the restored row present the Bingo again');
    } finally {
      document.removeEventListener(RESULT_REVEAL_ABORT_EVENT, onAbort);
    }
  });

  test('a closed lootbox presentation reports its id so caller-owned seen marks can be undone', async () => {
    // app-sdgnrs-redemptions marks its claim seen the moment the reveal is
    // accepted, and only this id lets it un-mark one the player never watched.
    const aborts = [];
    const onAbort = (event) => aborts.push(event.detail);
    document.addEventListener(LOOTBOX_REVEAL_ABORT_EVENT, onAbort);
    try {
      assert.equal(queueReveal({
        kind: 'lootbox',
        presentationId: 'sdgnrs-redemption:0xab:period:4',
        lootboxRelease: { address: '0xab', key: 'period:4' },
        legs: [{ legType: 'eth', amount: 10n ** 18n, claimable: true }],
      }), true);
      const el = instantiate();
      await tick();
      el.querySelector('[data-bind="rvl-close"]').dispatchEvent({ type: 'click' });
      await tick();
      assert.equal(aborts.length, 1);
      assert.deepEqual(aborts[0].presentationIds, ['sdgnrs-redemption:0xab:period:4']);
    } finally {
      document.removeEventListener(LOOTBOX_REVEAL_ABORT_EVENT, onAbort);
    }
  });

  test('a completed prize stays tombstoned so a late indexer refresh cannot replay it', async () => {
    const pari = {
      kind: 'pari',
      player: '0x00000000000000000000000000000000000000ab',
      market: 'volume', round: 31, side: 1, outcome: 1,
      payout: 0n, voided: false,
      revealRelease: { address: '0x00000000000000000000000000000000000000ab', id: 'volume:31' },
    };
    assert.equal(queueReveal(pari), true);
    const el = instantiate();
    await tick();
    // Play it through rather than closing it.
    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
    assert.equal(queueReveal({ ...pari }), false,
      'a watched result is still a one-time presentation');
  });

  test('queueReveal before mount buffers; connect drains and shows summary (reduced motion)', async () => {
    assert.equal(queueReveal({ kind: 'pack', count: 3, level: 2, pending: true }), true);
    const el = instantiate();
    await tick();
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    assert.equal(backdrop.hidden, false, 'backdrop visible');
    const title = el.querySelector('[data-bind="rvl-title"]');
    assert.equal(title.textContent, 'TICKET PACK · LEVEL 2');
    assert.equal(title.hidden, true, 'the wrapper carries the level without a duplicate heading');
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.hidden, false, 'summary rendered directly');
    assert.equal(summary.querySelectorAll('.rvl-card').length, 1);
    // Tap dismisses (the terminal action shares the same tap resolver).
    backdrop.dispatchEvent({ type: 'click' });
    await tick();
    assert.equal(backdrop.hidden, true, 'backdrop hidden after tap');
  });

  test('Bingo summary dims the board around one boxed eight-color line and fits rewards below it', async () => {
    queueReveal({
      kind: 'bingo', level: 31, symbol: 0, tier: 'regular',
      flipReward: 1_000n * 10n ** 18n, dgnrsPaid: 0n,
      counts: Array.from({ length: 64 }, (_unused, index) => index % 8 === 0 ? 1 : 0),
    });
    const el = instantiate();
    await tick();
    const chart = el.querySelector('.rvl-bingo-chart');
    assert.ok(chart, 'the inventory-style chart is part of the prize card');
    assert.equal(chart.querySelector('.rvl-bingo-chart__head').children[1].textContent,
      'WWXRP BINGO · ALL 8 COLORS');
    assert.equal(chart.querySelectorAll('.rvl-bingo-chart__cell').length, 64);
    assert.equal(chart.querySelectorAll('.rvl-bingo-chart__row').length, 8);
    assert.equal(chart.querySelectorAll('.is-bingo-row').length, 1,
      'the completed symbol is enclosed as one line instead of eight unrelated boxes');
    assert.equal(chart.querySelectorAll('.is-bingo').length, 8,
      'every color inside the winning line remains highlighted');
    assert.equal(chart.querySelectorAll('.has').length, 8,
      'the fetched inventory counts light the same completed line');
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.classList.contains('rvl-summary--bingo'), true);
    assert.ok(summary.querySelector('.rvl-summary-grid--bingo'),
      'the chart and payout cards use the dedicated responsive Bingo receipt');
    const stage = el.querySelector('[data-bind="rvl-stage"]');
    assert.equal(stage.classList.contains('rvl-stage--bingo'), true);
  });

  test('motion Bingo reveals its board and every payout together on the final receipt', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    queueReveal({
      kind: 'bingo', level: 31, symbol: 0, tier: 'first-symbol',
      flipReward: 1_000n * 10n ** 18n,
      dgnrsPaid: 250n * 10n ** 18n,
      counts: Array.from({ length: 64 }, (_unused, index) => index % 8 === 0 ? 1 : 0),
    });
    const el = instantiate();
    await tick();

    // Resolve only the short title beat. Bingo must land directly on its one
    // complete receipt instead of entering the generic one-card-at-a-time lane.
    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();

    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.hidden, false);
    assert.equal(summary.querySelectorAll('.rvl-card').length, 3,
      'the Bingo board, FLIP, and sDGNRS arrive together');
    assert.ok(summary.querySelector('.rvl-bingo-chart'));
    assert.equal(el.querySelector('[data-bind="rvl-card-zone"]').hidden, true,
      'no individual Bingo reward card is dealt before the receipt');

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('foil summary shows both tickets, Degenerette colors, and the exact bonus', async () => {
    queueReveal({
      kind: 'foil-match', day: 44, level: 12, ticketIndex: 2, drawKind: 0,
      score: 5, rewardFaces: 6,
      lineTraits: [1, 70, 130, 200],
      winningTraits: [1, 78, 131, 200],
      matchFaces: [2, 1, 0, 2],
      legs: [],
    });
    const el = instantiate();
    await tick();

    const chart = el.querySelector('.rvl-foil-match');
    assert.ok(chart, 'the reason chart is the first foil reward card');
    assert.equal(chart.querySelectorAll('.rvl-gamepiece').length, 2,
      'the foil and jackpot are rendered as complete tickets');
    assert.equal(chart.querySelectorAll('.rvl-ticket-grid').length, 2);
    assert.equal(chart.querySelectorAll('.rvl-rq').length, 8);
    assert.equal(chart.querySelectorAll('.q-full').length, 4,
      'exact matches are green on both tickets like settled Degenerette');
    assert.equal(chart.querySelectorAll('.q-sym').length, 2,
      'symbol matches are blue on both tickets like settled Degenerette');
    assert.equal(chart.querySelectorAll('.q-miss').length, 2,
      'misses are pink on both tickets like settled Degenerette');
    assert.equal(chart.querySelectorAll('.rvl-foil-match__face').length, 4,
      'the foil ticket retains each quadrant point value');
    assert.deepEqual(
      chart.querySelectorAll('.rvl-ticket-tag').map((tag) => tag.textContent),
      ['YOUR FOIL', 'MAIN JACKPOT'],
      'the two complete tickets name their roles without relying on badge order',
    );
    const foilTicket = chart.querySelector('.rvl-foil-match__ticket--foil');
    assert.equal(
      foilTicket?.querySelector('.rvl-gamepiece-center')?.querySelector('img')?.src,
      '/whitepaper/flame-center.svg',
      'the left ticket is visibly the earned foil rather than a second paper ticket',
    );
    assert.match(chart.querySelector('.rvl-foil-match__foot').textContent,
      /T5 BONUS6-FACE DEGENERETTE SPIN/);
    assert.match(APP_CSS,
      /\.rvl-foil-match__compare\s*\{[^}]*grid-template-columns:\s*var\(--rvl-foil-ticket-size\)[^}]*var\(--rvl-foil-ticket-size\)/s,
      'one explicit pair grid keeps both tickets square and equally sized');
    assert.match(APP_CSS,
      /\.rvl-foil-match--compact\s*\{[^}]*--rvl-foil-ticket-size:\s*clamp\(68px,[^}]*96px\)/s,
      'the compact receipt has its own readable square ticket scale');
    assert.match(APP_CSS,
      /\.rvl-card--foil-match\.rvl-card--mini \.rvl-card-icon--foil-match\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/s,
      'the foil receipt overrides the later generic 26px mini-icon box');
    assert.match(APP_CSS,
      /body\.layout-basic \.rvl-card--foil-match\.rvl-card--mini \.rvl-rq\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;/s,
      'compact foil quadrants override the generic 19px thumbnail rule');
  });

  test('full foil comparison waits for explicit input before advancing', async () => {
    globalThis.window.matchMedia = () => ({ matches: false });
    queueReveal({
      kind: 'foil-match', day: 44, level: 12, ticketIndex: 2, drawKind: 0,
      score: 5, rewardFaces: 6,
      lineTraits: [1, 70, 130, 200],
      winningTraits: [1, 78, 131, 200],
      matchFaces: [2, 1, 0, 2],
      legs: [],
    });
    const el = instantiate();
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');

    // Advance only the title beat and card entrance; the comparison's own
    // gate must then remain indefinitely instead of using the generic timer.
    await tick();
    backdrop.dispatchEvent({ type: 'click' });
    await tick();
    backdrop.dispatchEvent({ type: 'click' });
    await tick();
    const action = el.querySelector('.rvl-foil-match__continue');
    assert.ok(action, 'the full comparison exposes a clear Continue control');
    assert.equal(el.querySelector('[data-bind="rvl-card-zone"]').hidden, false);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(el.querySelector('.rvl-foil-match__continue'),
      'the first stage does not close without player input');

    action.dispatchEvent({ type: 'click' });
    await tick();
    assert.equal(el.querySelector('[data-bind="rvl-summary"]').hidden, false,
      'Continue advances to the terminal receipt');
    assert.equal(el.querySelector('[data-bind="rvl-summary"] .rvl-card--foil-match'), null,
      'the already-shown foil comparison is not duplicated in the terminal receipt');
    assert.match(REVEAL_SRC,
      /card\?\.type === 'bingo' \|\| card\?\.type === 'foil-match'/,
      'the already-shown foil comparison is also excluded from the carry-forward tray');
  });

  test('pack shell carries the Degenerus mark plus dynamic edition and level hooks', () => {
    const el = instantiate();
    assert.ok(el.querySelector('.rvl-pack-logo'), 'Degenerus logo is on the wrapper');
    assert.ok(el.querySelector('.rvl-pack-wordmark'), 'Degenerus wordmark is on the wrapper');
    assert.ok(el.querySelector('[data-bind="rvl-pack-edition"]'));
    assert.ok(el.querySelector('[data-bind="rvl-pack-level"]'));
    assert.doesNotMatch(REVEAL_SRC, /TAP TO TEAR|TAP TO REVEAL FOIL/,
      'the pack graphic is the visual instruction');
    assert.match(REVEAL_SRC, /vessel\.setAttribute\('role', 'button'\)/,
      'the graphic remains keyboard-accessible without visible helper copy');
    assert.match(REVEAL_SRC, /e\?\.key !== 'Enter'.*e\?\.key !== ' '/,
      'Enter and Space open the focused pack graphic');
  });

  test('lootbox shell carries the viewport-safe branded staged opener', () => {
    const el = instantiate();
    const flightStageStart = REVEAL_SRC.indexOf('  #stageLootboxRewardFlight(seq) {');
    const flightFaceStart = REVEAL_SRC.indexOf('  #mountLootboxRewardFaces(seq) {');
    const flightFinishStart = REVEAL_SRC.indexOf('  async #finishLootboxRewardFlight(seq, settleMs) {');
    const flightStageMethod = REVEAL_SRC.slice(flightStageStart, flightFaceStart);
    const flightFaceMethod = REVEAL_SRC.slice(flightFaceStart, flightFinishStart);
    const flightFinishMethod = REVEAL_SRC.slice(
      flightFinishStart,
      REVEAL_SRC.indexOf('  #buildShareButton(seq) {', flightFinishStart),
    );
    const cardRiseStart = APP_CSS.indexOf('@keyframes rvl-lootbox-card-rise');
    const cardRiseKeyframes = APP_CSS.slice(
      cardRiseStart,
      APP_CSS.indexOf('@keyframes', cardRiseStart + 1),
    );
    const seamInsertStart = APP_CSS.indexOf('@keyframes rvl-lootbox-seam-insert-release');
    const seamInsertKeyframes = APP_CSS.slice(
      seamInsertStart,
      APP_CSS.indexOf('/* LARGE keeps', seamInsertStart + 1),
    );
    assert.ok(el.querySelector('.rvl-chest-logo'), 'generic chest markup remains available');
    assert.match(el.innerHTML, /rvl-chest-q rvl-chest-logo[^>]*flame-logo\.svg/,
      'the generic fallback still carries the authentic protocol mark');
    assert.doesNotMatch(el.innerHTML, /rvl-chest-q">\?/,
      'the generic question-mark chest treatment is gone');
    assert.ok(el.querySelector('.rvl-chest-clasp'), 'opening clasp is rendered');
    assert.doesNotMatch(el.innerHTML, /RNG VERIFIED/,
      'the case does not claim an unexplained verification state');
    assert.ok(el.querySelector('.rvl-chest-seam'), 'the light seam has its own crack beat');
    assert.ok(el.querySelector('.rvl-lootbox-badge__ring'),
      'the opener keeps a structural ring slot for its lock-state artwork');
    assert.ok(el.querySelector('.rvl-lootbox-badge__center'),
      'the opener keeps a structural center for the canonical lock face');
    assert.equal(el.querySelectorAll('.rvl-vault-interlock').length, 4,
      'one reusable shell carries both two-lock and legacy receiver positions');
    assert.equal(el.querySelectorAll('.rvl-vault-deadbolt').length, 4,
      'CSS activates only the selected model\'s matched retracting pair');
    assert.equal(el.querySelectorAll('.rvl-lootbox-latch').length, 0,
      'the compact opener no longer mounts paired external clasps');
    assert.equal(el.querySelectorAll('.rvl-lootbox-seam-insert').length, 1,
      'one centered recessed insert replaces all compact latch pieces');
    assert.ok(el.querySelector('[data-bind="rvl-lootbox-flight"]'),
      'the actual reward-card flight deck is mounted with the case');
    assert.match(REVEAL_SRC,
      /<div class="rvl-chest-seam"><\/div>\s*<div class="rvl-lootbox-flight"[\s\S]*?<div class="rvl-chest-body">/,
      'the reward flight is physically mounted at the opening between lid and body');
    assert.match(el.innerHTML, /rvl-lootbox-badge__face[\s\S]*flame-center\.svg/,
      'the animated center uses the canonical Degenerus flame geometry');
    assert.ok(el.querySelector('.rvl-lootbox-beam'), 'reward beam is mounted behind the box');
    assert.ok(el.querySelector('.rvl-lootbox-rays'), 'radial release field is mounted');
    assert.equal(el.querySelectorAll('.rvl-lootbox-spark').length, 8,
      'the burst has a balanced particle ring');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-v6-front.webp', import.meta.url)),
      'the generated alpha WebP ships with the app');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-v10-straight-center.webp', import.meta.url)),
      'the housing-free, lens-ghost-free opener case ships with the app');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-compact-v36-old-panels-clean-lid-continuous-side-rails.webp', import.meta.url)),
      'both compact openers share the clean, symmetric low-lid front view');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-small-v34-continuous-bronze-side-rails-overlay.webp', import.meta.url)),
      'the small reveal restores only its clean bronze hardware');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-compact-v36-shell-tone-mask.webp', import.meta.url)),
      'the compact reveal keeps value tint away from its clean hardware edges');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-v8-front.webp', import.meta.url)),
      'the seamless opener case with an integrated badge ships with the app');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-v12-front.webp', import.meta.url)),
      'the machined-metal opener case ships with the app');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-v6-top.webp', import.meta.url)),
      'the housing-free detailed top-down case with its price panel ships with the app');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-v6-front.webp', import.meta.url)),
      'the matching detailed opener front ships with the app');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-medium-v14-inner-lid.webp', import.meta.url)),
      'the opener includes a real inner-lid surface');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-large-v43-side-connected-bracket-locked-front.png', import.meta.url)),
      'the premium gold briefcase ships its short quadrant bars with the original badge seat intact');
    assert.ok(existsSync(new URL('../../assets/lootbox/degenerus-lootbox-case-large-v31-deadbolt-right.png', import.meta.url)),
      'the premium case ships the exact steel latch bridges used by its front art');
    assert.match(REVEAL_SRC,
      /const presentation = applyLootboxCasePresentation\(box, 'medium'\);[\s\S]*art\.src = presentation\.assets\.lockedFront/,
      'generic reward receipts use the complete neutral medium presentation');
    assert.match(APP_CSS, /--rvl-box-w:\s*min\(520px, 88vw, 68dvh\)/,
      'the case is bounded by both viewport axes');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest\s*\{[^}]*width:\s*var\(--lootbox-case-width, var\(--rvl-box-w\)\);[^}]*aspect-ratio:\s*var\(--lootbox-case-aspect, 1200 \/ 539\)/s,
      'the opener publishes the established wide, front-facing reveal aspect');
    assert.match(APP_CSS, /\.rvl-chest-lid__front\s*\{[^}]*var\(--lootbox-case-retracted-art\)[^}]*center top \/ 100% auto no-repeat/s,
      'the receiver-backed case art is cropped into the animated lid');
    assert.match(APP_CSS, /\.rvl-chest-body\s*\{[^}]*var\(--lootbox-case-retracted-art\)[^}]*center bottom \/ 100% auto no-repeat/s,
      'the matching receiver-backed lower crop preserves the physical opening beat');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest-body::after\s*\{[^}]*z-index:\s*2;[^}]*var\(--lootbox-case-trim-overlay, none\)[^}]*center bottom \/ 100% auto no-repeat,[^}]*var\(--lootbox-case-front-face, none\)/s,
      'the repaired metal trim is registered over the old lower-case crop');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest-lid__front::after\s*\{[^}]*var\(--lootbox-case-trim-overlay, none\)[^}]*center top \/ 100% auto no-repeat/s,
      'the same trim overlay stays registered on the separately moving lid crop');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest-clasp\s*\{[^}]*display:\s*none;/s,
      'the opener suppresses the standalone clasp and its sticker-like shadow');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest-platform\s*\{[^}]*display:\s*none/s,
      'the case has no oval floor shadow that makes it look like it is hovering');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest-body::before\s*\{[^}]*background:\s*var\(--lootbox-tone\)[^}]*opacity:\s*var\(--lootbox-case-reveal-tone-opacity, var\(--lootbox-case-tone-opacity, 0\)\);[^}]*mask:\s*var\(--lootbox-case-reveal-tone-mask, var\(--lootbox-case-retracted-art\)\)/s,
      'the base opener rule preserves the authored gold briefcase palette');
    assert.match(APP_CSS,
      /--lootbox-case-reveal-tone-opacity/,
      'compact reveal color is isolated from the unchanged Buy In and Pending artwork');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-lootbox-badge\s*\{[^}]*filter:\s*none;/s,
      'the animated mechanism has no separate circular mount or container shadow');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-lootbox-badge__ring\s*\{[^}]*inset:\s*5\.2%;[^}]*#30d100/s,
      'the lock keeps the accepted gold-case ring construction');
    assert.match(APP_CSS,
      /\.rvl-stage:is\(\[data-lootbox-case-model="small"\], \[data-lootbox-case-model="medium"\]\) \.rvl-lootbox-badge__ring,[\s\S]*?0 1\.5px 1px rgba\(0, 0, 0, 0\.72\)/s,
      'compact badges borrow only the tight machined contact depth without adding a mount');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-lootbox-badge__ring::after\s*\{[^}]*conic-gradient\(from 225deg[^}]*rotate\(0deg\)/s,
      'a discrete red half covers the green half while the lock is closed');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-lootbox-badge__face img\s*\{[^}]*width:\s*70%;[^}]*height:\s*92%/s,
      'the canonical flame stays proportional inside the turning white face');
    assert.match(APP_CSS,
      /\.rvl-charging \.rvl-vessel--lootbox \.rvl-lootbox-badge__ring::after\s*\{[^}]*rvl-lootbox-badge-red-uncover/s,
      'unlocking rotates the covering red half instead of fading another badge over it');
    assert.match(APP_CSS,
      /@keyframes rvl-lootbox-badge-red-uncover\s*\{[\s\S]*70%, 100%[^}]*rotate\(180deg\)/,
      'the red cover physically uncovers exactly one green half before release');
    assert.match(APP_CSS,
      /@keyframes rvl-lootbox-badge-face-turn\s*\{[\s\S]*70%, 100%[^}]*rotate\(402deg\)/,
      'the flame face completes one clean net revolution over its counter-turning hub');
    assert.doesNotMatch(APP_CSS,
      /\.rvl-lootbox-badge::after\s*\{[^}]*flame-logo-split\.svg/s,
      'the unlock never cross-fades two complete badge SVGs');
    assert.match(APP_CSS,
      /@keyframes rvl-vault-deadbolt-retract\s*\{[\s\S]*0%, 71%[^}]*translateY\(0\)[\s\S]*100%[^}]*translateY\(-72%\)/,
      'the image-backed deadbolts withdraw upward only after the badge settles');
    assert.match(APP_CSS,
      /\.rvl-vault-interlock\s*\{[^}]*overflow:\s*hidden/s,
      'the moving deadbolt art remains mechanically occluded by its baked receiver channel');
    assert.match(APP_CSS,
      /\.rvl-vault-deadbolt::before\s*\{[^}]*background:\s*var\(--lootbox-tone\)[^}]*mix-blend-mode:\s*color;[^}]*opacity:\s*0;[^}]*mask:\s*var\(--lootbox-deadbolt-art\)/s,
      'animated hardware keeps its authored metal instead of flashing a multiplier tint');
    assert.doesNotMatch(APP_CSS, /rvl-lootbox-latch/,
      'no compact latch selector or sprite remains in the opener styling');
    assert.match(APP_CSS,
      /\.rvl-lootbox-seam-insert\s*\{[^}]*top:\s*calc\(var\(--lootbox-case-seam, 36%\) - 1\.175%\);[^}]*left:\s*50%;[^}]*width:\s*3\.2%;[^}]*height:\s*2\.35%;[^}]*#eef2f4[^}]*#33393e[^}]*clip-path:\s*polygon/s,
      'the replacement is one tiny silver locking bit recessed at the middle lid split');
    assert.doesNotMatch(APP_CSS,
      /\.rvl-lootbox-seam-insert\s*\{[^}]*var\(--lootbox-tone\)/s,
      'the recessed locking bit stays silver instead of inheriting the case color');
    assert.match(APP_CSS,
      /\.rvl-stage:is\(\[data-lootbox-case-model="small"\], \[data-lootbox-case-model="medium"\]\) \.rvl-lootbox-seam-insert,[\s\S]*?display:\s*block;/s,
      'only compact cases show the single seam insert');
    assert.match(APP_CSS,
      /\.rvl-stage:is\(\[data-lootbox-case-model="small"\], \[data-lootbox-case-model="medium"\]\) \.rvl-vault-interlock\s*\{[^}]*display:\s*none;/s,
      'the shared legacy case does not receive mismatched model-specific deadbolts');
    assert.match(APP_CSS,
      /\.rvl-stage\[data-lootbox-case-model="large"\] :is\(\.rvl-vault-interlock--2, \.rvl-vault-interlock--3\)\s*\{[^}]*top:\s*22\.82%;[^}]*width:\s*4\.5%;[^}]*height:\s*2\.23%/s,
      'the gold case registers its exact two steel bridges over the baked briefcase latches');
    assert.match(APP_CSS,
      /\.rvl-stage\[data-lootbox-case-model="large"\] \.rvl-vault-interlock--2\s*\{\s*left:\s*25\.25%;\s*\}/s,
      'the left bridge stays registered inside its matching latch art');
    assert.match(APP_CSS,
      /\.rvl-stage\[data-lootbox-case-model="large"\] \.rvl-vault-interlock--3\s*\{\s*left:\s*70\.25%;\s*\}/s,
      'the right bridge stays registered inside its matching latch art');
    assert.doesNotMatch(APP_CSS,
      /\.rvl-stage\[data-lootbox-case-model="large"\] \.rvl-vault-interlock--(?:1|4)\s*\{[^}]*display:\s*block/s,
      'the large case cannot resurrect the discarded four-lock layout');
    assert.match(APP_CSS,
      /@keyframes rvl-vault-bridge-retract-left\s*\{[\s\S]*0%, 71%[^}]*translateX\(0\)[\s\S]*100%[^}]*translateX\(-102%\)/,
      'each steel bridge stays put through the badge turn, then retracts into its left housing');
    assert.match(APP_CSS,
      /@keyframes rvl-vault-bridge-retract-right\s*\{[\s\S]*0%, 71%[^}]*translateX\(0\)[\s\S]*100%[^}]*translateX\(102%\)/,
      'the matching bridge half retracts symmetrically into its right housing');
    assert.match(APP_CSS,
      /\.rvl-charging \.rvl-vessel--lootbox \.rvl-lootbox-seam-insert\s*\{[^}]*rvl-lootbox-seam-insert-release[^}]*steps\(1, end\)/s,
      'the insert uses one discrete visibility change rather than a motion sequence');
    assert.match(seamInsertKeyframes,
      /0%, 69\.99%\s*\{\s*opacity:\s*1;\s*\}[\s\S]*70%, 100%\s*\{\s*opacity:\s*0;/,
      'the insert disappears on the same 70% frame where the badge turn completes');
    assert.doesNotMatch(seamInsertKeyframes, /transform|translate|scale/,
      'the insert never slides, folds, squashes, or retracts');
    assert.match(APP_CSS,
      /@keyframes rvl-case-charge\s*\{\s*from\s*\{\s*transform:\s*none;\s*\}\s*to\s*\{\s*transform:\s*none;\s*\}/s,
      'the case itself remains still while its internal seam glows');
    assert.match(APP_CSS,
      /@keyframes rvl-case-lid-open\s*\{[\s\S]*opacity:\s*1[^}]*rotateX\(9deg\)/,
      'the gold case retains its existing shallow hinge opening');
    assert.match(APP_CSS,
      /@keyframes rvl-compact-case-lid-lift\s*\{[\s\S]*?0%, 10%[^}]*translateY\(0\)[\s\S]*?46%, 100%[^}]*translateY\(calc\(-1 \* clamp\(16px, 4vw, 30px\)\)\)/,
      'the separate compact lid simply lifts after the center insert disappears');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest-lid\s*\{[^}]*transform-origin:\s*50% 100% calc\(-1 \* var\(--rvl-lid-depth\)\)[^}]*preserve-3d/s,
      'the rigid lid volume pivots around the recessed rear axis at the body seam');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest-lid__inner\s*\{[^}]*display:\s*none/s,
      'the shallow crack does not project a full inner-lid shelf beyond the case silhouette');
    assert.match(APP_CSS,
      /\.rvl-stage:is\(\[data-lootbox-case-model="small"\], \[data-lootbox-case-model="medium"\]\) \.rvl-chest-seam::before\s*\{[^}]*height:\s*4px;[^}]*background:\s*color-mix\(in srgb, var\(--lootbox-tone\) 78%, white\);[^}]*filter:\s*blur\(0\.5px\)/s,
      'the compact crack contains only a thin roll-colored glow, not an opaque shelf');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest-lid__edge\s*\{[^}]*display:\s*none/s,
      'the shallow lift has no projected fascia or glowing shelf hanging beyond the lid');
    assert.match(APP_CSS,
      /\.rvl-stage:is\(\[data-lootbox-case-model="small"\], \[data-lootbox-case-model="medium"\]\) \.rvl-chest-lid::after\s*\{[^}]*display:\s*none;/s,
      'compact lids also suppress the extra metal rail beneath the lifted top');
    assert.match(APP_CSS,
      /\.rvl-stage\[data-lootbox-case-model="large"\] \.rvl-chest-lid::after\s*\{[^}]*display:\s*none;/s,
      'the restored gold opener has no synthetic rail hanging beneath its lid');
    assert.match(APP_CSS,
      /\.rvl-stage\[data-lootbox-case-model="large"\] \.rvl-chest-seam::before\s*\{[^}]*height:\s*3px;[^}]*background:\s*color-mix\(in srgb, var\(--lootbox-tone\) 64%, #fff0b0\);[^}]*filter:\s*blur\(0\.35px\)/s,
      'the gold opening restores its clean narrow glow instead of a dark interior shelf');
    assert.match(APP_CSS,
      /\.rvl-stage\[data-lootbox-case-model="large"\] \.rvl-chest-seam\s*\{[^}]*right:\s*calc\(5% \+ var\(--lootbox-case-shell-inset, 0%\)\);[^}]*left:\s*calc\(5% \+ var\(--lootbox-case-shell-inset, 0%\)\)/s,
      'the gold seam stops at the case silhouette instead of sticking out past both lid sides');
    assert.match(APP_CSS,
      /\.rvl-stage\[data-lootbox-case-model="large"\]\.rvl-bursting \.rvl-vessel--lootbox \.rvl-vault-deadbolt\s*\{[^}]*visibility:\s*hidden;/s,
      'the gold bridge overlays do not remain as floating bars once its lid opens');
    assert.match(APP_CSS,
      /@keyframes rvl-compact-case-seam-release\s*\{[\s\S]*var\(--lootbox-tone\)[\s\S]*var\(--lootbox-tone-rgb\)/,
      'the seam release glow resolves from the actual roll color');
    assert.match(APP_CSS,
      /\.rvl-stage:is\(\[data-lootbox-case-model="small"\], \[data-lootbox-case-model="medium"\]\) \.rvl-lootbox-badge,\s*\.rvl-vessel--lootbox:is\(\[data-lootbox-case-model="small"\], \[data-lootbox-case-model="medium"\]\) \.rvl-lootbox-badge\s*\{[^}]*width:\s*var\(--lootbox-case-badge-size, 10\.5%\);/s,
      'compact cases keep the accepted proportional badge size through every reveal handoff');
    assert.doesNotMatch(APP_CSS, /rvl-compact-badge-green-turn/,
      'compact cases do not replace the accepted badge-turn animation');
    assert.doesNotMatch(APP_CSS,
      /data-lootbox-case-model="small"[^{}]*\.rvl-lootbox-badge__ring\s*\{[^}]*background:/s,
      'the compact depth override cannot replace the accepted red-to-green ring states');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-lootbox-badge__center\s*\{[^}]*inset:\s*16\.4%;[^}]*background:\s*radial-gradient/s,
      'the accepted gold badge proportions remain the base mechanism');
    assert.match(APP_CSS,
      /@keyframes rvl-lootbox-badge-center-turn\s*\{[\s\S]*rotate\(-42deg\)[\s\S]*@keyframes rvl-lootbox-badge-face-turn\s*\{[\s\S]*rotate\(402deg\)/,
      'every reveal uses the accepted counter-turning badge mechanism');
    assert.match(APP_CSS,
      /@keyframes rvl-case-release\s*\{[\s\S]*to\s*\{[^}]*opacity:\s*1[^}]*transform:\s*none/,
      'the box neither expands nor fades during the handoff');
    assert.match(APP_CSS,
      /\.rvl-lootbox-flight__grid > \.rvl-lootbox-flight__card\s*\{[^}]*transform-origin:\s*50% 100%/s,
      'flight cards grow from their lower edge at the open case');
    assert.match(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-lootbox-flight\s*\{[^}]*top:\s*var\(--lootbox-case-seam[^}]*z-index:\s*9;[^}]*translate\(-50%, -68%\)/s,
      'the reward deck stays registered to the physical case seam on one continuous layer');
    assert.doesNotMatch(APP_CSS, /rvl-lootbox-flight-layer|rvl-lootbox-flight[^}]*steps\(/s,
      'the card flight has no discrete layer switch that can pop between frames');
    assert.match(cardRiseKeyframes,
      /@keyframes rvl-lootbox-card-rise\s*\{\s*from\s*\{[^}]*translate3d\(var\(--rvl-card-launch-x\), clamp\(82px, 17dvh, 104px\), 0\) scale\(0\.08\)[^}]*\}\s*to\s*\{[^}]*translate3d\(var\(--rvl-card-land-x, 0px\), var\(--rvl-card-land-y, -24px\), 0\) scale\(1\)/s,
      'the lightweight backs use one uninterrupted compositor transform from the seam to the measured terminal position');
    assert.doesNotMatch(cardRiseKeyframes, /\d+%\s*\{/,
      'the card flight has no intermediate transform stop that can jerk between poses');
    assert.match(APP_CSS,
      /\.rvl-lootbox-flight__back::after\s*\{[^}]*flame-logo\.svg/s,
      'every in-flight reward uses the same cheap branded back');
    assert.match(REVEAL_SRC,
      /slot\.className = 'rvl-card--mini rvl-lootbox-flight__card';[\s\S]*?turn\.className = 'rvl-lootbox-flight__turn';[\s\S]*?back\.className = 'rvl-lootbox-flight__back';[\s\S]*?front\.className = 'rvl-lootbox-flight__front'/,
      'the opening builds lightweight two-sided shells before the case moves');
    assert.doesNotMatch(flightStageMethod, /this\.#buildCard\(/,
      'the real card DOM does not compete with the flight animation');
    assert.match(flightFaceMethod,
      /const prepared = this\.#lootboxLanding\?\.sequence === seq[\s\S]*?const el = prepared \|\| this\.#buildCard\(card, true\)/,
      'the prepared terminal reward node is mounted on the hidden face after flight settles');
    assert.match(flightStageMethod,
      /this\.#renderSummary\(seq\)[\s\S]*vessel\.hidden = true[\s\S]*targetCards\.map\(\(card\) => card\.getBoundingClientRect\(\)\)[\s\S]*--rvl-card-land-x[\s\S]*--rvl-card-land-y/s,
      'the flight lands on real final-layout rectangles rather than a viewport-specific fixed offset');
    assert.doesNotMatch(flightStageMethod, /await _prepareLootboxRewardFaces\(summary\)/,
      'terminal measurement cannot yield a paint while the physical case is still closed');
    assert.match(APP_CSS,
      /\.rvl-lootbox-flight--measuring\s*\{[^}]*visibility:\s*hidden;[^}]*\}[\s\S]*?\.rvl-lootbox-flight--measuring::before\s*\{[^}]*animation:\s*none;[^}]*\}/s,
      'the measurable flight and its glow remain non-painting until release alignment completes');
    assert.match(REVEAL_SRC,
      /if \(vessel\) vessel\.hidden = true;\s*if \(isLootbox\) this\.#landLootboxRewardFlight\(seq\)/,
      'the same reward nodes move into the prepared summary in the vessel handoff task');
    assert.match(APP_CSS,
      /\.rvl-lootbox-flight__front\s*\{[^}]*rotateY\(180deg\)/s,
      'the real reward starts concealed on the reverse face');
    assert.match(APP_CSS,
      /\.rvl-lootbox-flight--revealing \.rvl-lootbox-flight__turn\s*\{[^}]*rvl-lootbox-card-turn/s,
      'a dedicated end-of-flight state turns each settled card');
    assert.match(APP_CSS,
      /@keyframes rvl-lootbox-card-turn\s*\{\s*from\s*\{[^}]*rotateY\(0deg\)[^}]*\}\s*to\s*\{[^}]*rotateY\(180deg\)/s,
      'the reveal is a physical half-turn rather than a content transform');
    assert.match(flightFinishMethod,
      /const settleAction = await this\.#wait\(settleMs, \{ fixedSpeed: true \}\)[\s\S]*if \(settleAction\) stagedFlight\.classList\?\.add\('rvl-lootbox-flight--settled'\)[\s\S]*this\.#mountLootboxRewardFaces\(seq\)[\s\S]*await _prepareLootboxRewardFaces\(flight\)[\s\S]*classList\?\.add\('rvl-lootbox-flight--revealing'\)[\s\S]*const flipAction = await this\.#wait\(LOOTBOX_CARD_FLIP_MS, \{ fixedSpeed: true \}\)[\s\S]*classList\?\.add\('rvl-lootbox-flight--revealed'\)/,
      'card flight, face preparation, and turn stay synchronized at normal speed and when explicitly skipped');
    assert.match(REVEAL_SRC,
      /async function _prepareLootboxRewardFaces\(flight\)[\s\S]*querySelectorAll[\s\S]*Promise\.allSettled\(waits\)[\s\S]*_waitForTwoPaintFrames\(\)/,
      'the physical turn waits for the actual face images, fonts, layout, and compositor paint');
    assert.match(REVEAL_SRC,
      /async function _waitForImageReady\(image\)[\s\S]*image\.decode\(\)[\s\S]*image\.addEventListener\('load'[\s\S]*image\.addEventListener\('error'/,
      'cold and broken face images both settle without a blank mid-turn swap');
    assert.match(APP_CSS,
      /\.rvl-lootbox-flight__front \.rvl-reward-pack\.rvl-pack,[\s\S]*?\.rvl-lootbox-flight__front \.rvl-reward-lootbox\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;[^}]*animation:\s*none;/s,
      'nested pack and case artwork does not run a second fade-and-slide inside the card turn');
    assert.match(APP_CSS,
      /\.rvl-bursting \.rvl-lootbox-flight--settled \.rvl-lootbox-flight__grid > \.rvl-card--mini\s*\{[^}]*opacity:\s*1;[^}]*translate3d\(var\(--rvl-card-land-x, 0px\), var\(--rvl-card-land-y, -24px\), 0\)[^}]*animation:\s*none;/s,
      'skipping the flight commits every card to its measured terminal pose');
    assert.match(APP_CSS,
      /\.rvl-lootbox-flight--revealing\.rvl-lootbox-flight--revealed \.rvl-lootbox-flight__turn\s*\{[^}]*rotateY\(180deg\)[^}]*animation:\s*none;/s,
      'skipping the turn commits the already-painted real face');
    assert.match(APP_CSS,
      /\.rvl-stage--lootbox\s*\{[^}]*--rvl-card-flight:\s*0\.78s;/s,
      'manual openings give the smooth card flight enough time to read');
    assert.match(APP_CSS,
      /\.rvl-stage--lootbox\.rvl-stage--auto-lootbox\s*\{[^}]*--rvl-card-flight:\s*0\.52s;/s,
      'batch openings keep the lightweight flight brisk');
    assert.match(REVEAL_SRC, /if \(isLootbox\) this\.#stageLootboxRewardFlight\(seq\)/,
      'the placeholder flight deck is mounted before the lid-open class starts');
    assert.match(REVEAL_SRC,
      /if \(isLootbox\) await this\.#finishLootboxRewardFlight\(seq, LOOTBOX_AUTO_BURST_MS\)/,
      'open-all also completes the card flight and face turn before advancing');
    assert.doesNotMatch(APP_CSS,
      /\.rvl-vessel--lootbox \.rvl-chest-logo\s*\{[^}]*drop-shadow/s,
      'the opener has no independently lit logo hovering above the box texture');
    assert.match(APP_CSS, /\.bxs-chip-art\s*\{[^}]*var\(--lootbox-case-art\)/s,
      'small pending boxes reuse the same recognizable silhouette');
    assert.match(APP_CSS,
      /\.bxs-chip-art:is\(\[data-lootbox-case-model="small"\], \[data-lootbox-case-model="medium"\]\)::before\s*\{[^}]*display:\s*none;/s,
      'compact strip art keeps the complete badge baked into the approved locked render');
    assert.match(APP_CSS,
      /\.rvl-reward-lootbox::after\s*\{[^}]*width:\s*var\(--lootbox-static-badge-size, 10\.5%\);[^}]*flame-logo\.svg/s,
      'the gold reward case retains its separate official badge layer');
    assert.match(APP_CSS,
      /\.rvl-reward-lootbox:is\(\[data-lootbox-case-model="small"\], \[data-lootbox-case-model="medium"\]\)::after\s*\{[^}]*drop-shadow/s,
      'the low-angle compact reward front restores its separate official badge');
    assert.match(APP_CSS, /\[data-lootbox-value-tone="green"\][^{]*\{[^}]*#34d399/s,
      'ticket-price bands publish visibly distinct case colors');
    assert.match(APP_CSS, /\.rvl-vessel--lootbox \.rvl-chest-lid__front::before\s*\{[^}]*mix-blend-mode:\s*color;[^}]*opacity:\s*var\(--lootbox-case-reveal-tone-opacity, var\(--lootbox-case-tone-opacity, 0\)\);[^}]*mask:\s*var\(--lootbox-case-reveal-tone-mask/s,
      'the base opening lid leaves the authored gold palette intact');
    assert.match(APP_CSS, /\.rvl-vessel--lootbox \.rvl-chest-seam::after\s*\{[^}]*--lootbox-tone-rgb/s,
      'the multiplier tier remains visible as contained interior light');
    assert.match(REVEAL_SRC,
      /#buildRewardLootbox\(\)[\s\S]*applyLootboxCasePresentation\(box, 'medium'\)[\s\S]*art\.src = presentation\.assets\.lockedFront/,
      'lootbox reward cards also reuse the complete neutral protocol case presentation');
    assert.match(APP_CSS, /@keyframes rvl-lootbox-flight-glow/);
    assert.match(APP_CSS, /@keyframes rvl-case-lid-open/);
    assert.match(APP_CSS, /@keyframes rvl-case-rays/);
    assert.match(REVEAL_SRC, /const LOOTBOX_MANUAL_CHARGE_MS = 1_350/,
      'a single box gives the slower mechanical badge sweep time to read');
    assert.match(REVEAL_SRC, /const LOOTBOX_AUTO_CHARGE_MS = 880/,
      'batched boxes retain a faster but still legible automatic unlock');
    assert.doesNotMatch(REVEAL_SRC, /LOOTBOX_CARD_FACE_READY_MS/,
      'face readiness is paint-driven rather than an unreliable fixed delay');
    assert.match(REVEAL_SRC, /const LOOTBOX_CARD_FLIP_MS = 470/,
      'the sequence reserves enough time for the staggered card turns');
    assert.match(REVEAL_SRC, /const LOOTBOX_AUTO_RESULT_MS = 1_750/,
      'auto mode spends the recovered time on the readable result');
    assert.match(APP_CSS, /--rvl-box-charge:\s*1\.35s/,
      'the chest choreography tracks the slower JS timing');
    assert.match(APP_CSS, /\.rvl-stage--auto-lootbox\s*\{[^}]*--rvl-box-charge:\s*0\.88s/s,
      'auto mode has a matching accelerated CSS choreography');
  });

  test('ordinary lootbox rewards reach the roomy receipt with detailed pack art and no heading', async () => {
    storeMod.update('app.lastDay', { roll1: { purchaseLevel: 60 } });
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
    assert.equal(pack.querySelector('.rvl-pack-level').getAttribute('data-ticket-level-tone'), 'yellow');
    assert.equal(pack.getAttribute('data-pack-level-tone'), 'yellow',
      'the wrapper receives the complementary backing palette for its level pill');
    assert.equal(pack.querySelector('.rvl-pack-count').textContent, '10 TICKETS');
    const ticketCard = summary.querySelector('.rvl-card--tickets');
    assert.equal(ticketCard.querySelector('.rvl-card-value'), null,
      'the count is not repeated outside the pack');
    assert.equal(ticketCard.querySelector('.rvl-card-label'), null,
      'the ticket label is not repeated outside the pack');
    assert.equal(ticketCard.querySelector('.rvl-card-sub'), null,
      'the pack has no redundant explanatory caption');
    assert.match(ticketCard.className, /\brvl-card--pack-only\b/,
      'lootbox ticket pulls opt into the pack-only layout');
    assert.match(APP_CSS,
      /\.rvl-stage--lootbox \.rvl-summary-grid \.rvl-reward-pack\.rvl-pack\s*\{[^}]*width:\s*158px;[^}]*height:\s*215px/s,
      'the standalone pack expands to fill its receipt card');
    assert.match(APP_CSS,
      /\.rvl-stage--lootbox \.rvl-summary-grid \.rvl-reward-pack \.rvl-pack-logo\s*\{[^}]*width:\s*54%/s,
      'the Degenerus mark scales with the large lootbox reward pack');
    assert.match(APP_CSS,
      /\.rvl-stage--lootbox \.rvl-summary-grid \.rvl-reward-pack \.rvl-pack-wordmark\s*\{[^}]*font-size:\s*0\.9rem/s,
      'the pack wordmark no longer uses thumbnail-sized type');
    assert.match(APP_CSS,
      /\.rvl-stage--lootbox \.rvl-summary-grid \.rvl-reward-pack \.rvl-pack-level\s*\{[^}]*font-size:\s*0\.82rem/s,
      'level text remains legible on the receipt pack');
    assert.match(APP_CSS,
      /\.rvl-stage--lootbox > \.rvl-card-zone \.rvl-reward-pack \.rvl-pack-wordmark\s*\{[^}]*font-size:\s*1\.02rem/s,
      'the live lootbox reveal uses the largest pack branding');
    assert.match(APP_CSS, /\.rvl-stage--lootbox \.rvl-summary-grid[^}]*minmax\(180px, 216px\)/,
      'lootbox receipt cards use the available screen area');
    assert.match(
      APP_CSS,
      /data-card-count="5"[^}]*repeat\(6, minmax\(0, 101px\)\)[\s\S]*?data-card-count="5"[^}]*nth-child\(4\)[^}]*grid-column:\s*2 \/ span 2/s,
      'a five-reward receipt centers its final pair instead of stranding one tile',
    );
    assert.match(
      APP_CSS,
      /data-card-count="7"[^}]*repeat\(8, minmax\(0, 99px\)\)[\s\S]*?data-card-count="7"[^}]*nth-child\(5\)[^}]*grid-column:\s*2 \/ span 2/s,
      'a seven-reward receipt resolves as a balanced four-plus-three grid',
    );
    assert.match(REVEAL_SRC,
      /const boxSpinCards = seq\.cards\.filter[\s\S]*?#playLootboxSpinGrant\(seq, boxSpinCards,\s*\{[\s\S]*?directFromLootbox:\s*seq\.kind === 'lootbox'/,
      'a live Luckbox spin moves straight from the opened case into its full reel board');
    assert.match(REVEAL_SRC,
      /let action = options\.autoStartFirst && i === 0 \? 'spin' : null/,
      'opening the box starts reel one without a redundant PLAY SPIN gate');
    assert.match(APP_CSS, /@keyframes rvl-lootbox-spin-board-launch/,
      'the real reel board launches from the open case position');

    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('sDGNRS rewards use the three-flame ETH mark in a normal purple badge', async () => {
    queueReveal({
      kind: 'lootbox', lootboxIndex: 48,
      legs: [{ legType: 'dgnrs', amount: 44_200_000n * 10n ** 18n }],
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
    assert.match(
      APP_CSS,
      /\.sdgnrs-badge > \.sdgnrs-badge__mark\s*\{[^}]*top:\s*-0\.22%[^}]*width:\s*33%[^}]*height:\s*35\.16%/s,
      'the official mark is raised and scaled to stay centered without clipping its bottom flame',
    );
    assert.match(SDGNRS_LOGO_SVG, /viewBox="-8\.05 -10 16 22\.75"/,
      'the official logo keeps enough bottom canvas for the lowered center flame');
    assert.match(
      SDGNRS_LOGO_SVG,
      /matrix\(0\.165000 0 0 0\.140000 -4\.800000 6\.000000\)[\s\S]*matrix\(0\.165000 0 0 0\.140000 0\.000000 9\.450000\)[\s\S]*matrix\(0\.165000 0 0 0\.140000 4\.800000 6\.000000\)/,
      'the official logo preserves the approved wide, spread, lowered flame arrangement',
    );
    assert.match(
      APP_CSS,
      /\.rvl-stage--lootbox \.rvl-summary-grid \.rvl-card-icon--sdgnrs\s*\{\s*width:\s*142px;\s*height:\s*142px/,
      'the complete purple reward badge is larger on the box receipt',
    );
    assert.match(
      APP_CSS,
      /\.rvl-stage--lootbox \.rvl-card--dgnrs\.rvl-card--mini \.rvl-card-value\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
      'multi-card compact receipt tiles may still contain an exact sDGNRS amount',
    );
    const stagedCard = el.querySelector('[data-bind="rvl-summary"]')
      ?.querySelector('.rvl-card--dgnrs');
    const stagedValue = stagedCard?.querySelector('.rvl-card-value');
    assert.match(stagedCard?.className || '', /\brvl-card--mini\b/,
      'the singleton receipt retains the shared compact-card DOM class');
    assert.equal(stagedValue?.textContent, '44,200,000');
    assert.equal(stagedValue?.classList.contains('rvl-card-value--long'), false,
      'the screenshot-sized value is handled by the singleton rule before the long tier');
    assert.match(
      APP_CSS,
      /\.rvl-stage--lootbox > \.rvl-card-zone \.rvl-card--dgnrs \.rvl-card-value--long\s*\{[^}]*font-size:\s*clamp\(1\.5rem, 5vw, 1\.75rem\);[^}]*letter-spacing:\s*-0\.035em;/s,
      'the active reward overrides the larger generic Luckbox type instead of ellipsizing',
    );
    assert.match(
      APP_CSS,
      /\.rvl-stage--lootbox \.rvl-summary-grid\[data-card-count="1"\] \.rvl-card--dgnrs \.rvl-card-value\s*\{[^}]*overflow:\s*visible;[^}]*font-size:\s*clamp\(1\.4rem, 7vw, 1\.85rem\);[^}]*text-overflow:\s*clip;/s,
      'the singleton hero receipt shows the complete screenshot-sized amount even though its card is compact in the DOM',
    );
    assert.match(
      APP_CSS,
      /\.rvl-stage--lootbox \.rvl-summary-grid \.rvl-card-inner\s*\{[^}]*min-height:\s*238px;[^}]*justify-content:\s*center/s,
      'lootbox reward contents use the full centered receipt-card stage',
    );
    assert.match(
      APP_CSS,
      /\.rvl-stage--lootbox \.rvl-summary-grid \.rvl-card-icon\s*\{[^}]*width:\s*124px;[^}]*height:\s*124px/s,
      'currency and reward badges no longer occupy only one third of the tile',
    );
    assert.doesNotMatch(REVEAL_SRC, /special_dgnrs\.svg/,
      'the orange whale asset is no longer the sDGNRS reward icon');

    el.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('the first referral-bonus card fits a 100M DGNRS total before count-up', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    queueReveal({
      kind: 'referral-bonus',
      level: 90,
      amountWei: 100_000_000n * 10n ** 18n,
    });
    const el = instantiate();
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    // Skip only the title beat so the center-stage card is mounted while its
    // count-up value is still empty.
    await tick();
    backdrop.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 4 && !el.querySelector('.rvl-card-value'); i += 1) await tick();

    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    const card = zone.querySelector('.rvl-card--dgnrs');
    const value = card?.querySelector('.rvl-card-value');
    assert.ok(card, 'the referral reward reaches the full-size first display');
    assert.equal(value?.textContent, '', 'the sizing class precedes the animated count');
    assert.equal(value?.classList.contains('rvl-card-value--long'), true);
    assert.equal(value?.classList.contains('rvl-card-value--extra-long'), true,
      '100,000,000 DGNRS crosses into the smallest full-card value tier');
    assert.match(
      APP_CSS,
      /\.rvl-card--dgnrs:not\(\.rvl-card--mini\) \.rvl-card-value--long\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*font-size:\s*clamp\(1rem, 4vw, 1\.4rem\)/s,
      'the first display shrinks long DGNRS values within its own value lane',
    );
    assert.match(
      APP_CSS,
      /\.rvl-card--dgnrs:not\(\.rvl-card--mini\) \.rvl-card-value--extra-long\s*\{[^}]*font-size:\s*clamp\(0\.78rem, 3vw, 1rem\)/s,
      'nine-digit DGNRS rewards receive the extra-long fitted size',
    );

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a lootbox receipt can open the next pending box without returning to the tray', async () => {
    pendingActionsMod.publishPendingActions('next-box', [{
      id: 'lootbox:2', kind: 'lootbox', label: 'Luckbox #2', state: 'ready',
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
    assert.equal(summary.querySelector('.rvl-collect-cta').textContent, 'OPEN NEXT LUCKBOX');
    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 4; i += 1) await tick();

    summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.querySelector('.rvl-card-value').textContent, '2');
    assert.equal(summary.querySelector('.rvl-collect-cta').textContent, 'GOOD LUCK');
    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a completed reward can continue into the next chronological action of another kind', async () => {
    pendingActionsMod.publishPendingActions('next-growth', [{
      id: 'pari:growth:8', kind: 'growth-claim', label: 'Growth bet · Level 8',
      shortLabel: 'Claim', state: 'ready', order: 30,
      run: async () => {
        pendingActionsMod.clearPendingActions('next-growth');
        queueReveal({
          kind: 'pari', market: 'growth', round: 8, side: 1, outcome: 1,
          payout: 4n * 10n ** 18n,
        });
      },
    }]);
    queueReveal({
      kind: 'jackpot', day: 8,
      prizes: [{ type: 'flip', amount: 2n * 10n ** 18n }],
    });
    const el = instantiate();
    await tick();

    let summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.querySelector('.rvl-collect-cta').textContent, 'CLAIM');
    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 5; i += 1) await tick();

    summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.match(summary.textContent, /GROWTH BET/);
    assert.equal(summary.querySelector('.rvl-collect-cta').textContent, 'TAKE THE WIN');
    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a completed reward never continues automatically into Mine FLIP', async () => {
    let mineFlipRuns = 0;
    pendingActionsMod.publishPendingActions('mine-flip-resolver', [{
      id: 'mine-flip:player', kind: 'mass-resolution', label: 'Mine FLIP',
      shortLabel: 'Mine FLIP', state: 'ready', order: 999,
      run: async () => { mineFlipRuns += 1; },
    }]);
    queueReveal({
      kind: 'jackpot', day: 8,
      prizes: [{ type: 'flip', amount: 2n * 10n ** 18n }],
    });
    const el = instantiate();
    await tick();

    const summary = el.querySelector('[data-bind="rvl-summary"]');
    const collect = summary.querySelector('.rvl-collect-cta');
    assert.equal(collect.textContent, 'BACK TO GAME');
    collect.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    assert.equal(mineFlipRuns, 0);
    assert.equal(
      pendingActionsMod.getPendingActions().some((item) => item.source === 'mine-flip-resolver'),
      true,
    );
  });

  test('OPEN ALL BOXES absorbs already queued results into one large combined case', async (t) => {
    const completions = [];
    const onComplete = (event) => completions.push(event?.detail);
    document.addEventListener(LOOTBOX_REVEAL_COMPLETE_EVENT, onComplete);
    t.after(() => document.removeEventListener(LOOTBOX_REVEAL_COMPLETE_EVENT, onComplete));
    const ticketAddress = '0x00000000000000000000000000000000000000ab';
    const ticketPackRelease = (index) => ({
      address: ticketAddress,
      sourceKey: `lootbox:${index}`,
      settledExpected: true,
      packs: [{ level: 12, count: index }],
    });
    for (const [source, index] of [['box-four', 4], ['box-five', 5]]) {
      t.after(() => pendingActionsMod.clearPendingActions(source));
      pendingActionsMod.publishPendingActions(source, [{
        id: `lootbox:${index}`, kind: 'lootbox', label: `Luckbox #${index}`,
        state: 'ready', order: index,
        run: async () => {
          pendingActionsMod.clearPendingActions(source);
          queueReveal({
            kind: 'lootbox', lootboxIndex: index, presentationId: `open-all-box:${index}`,
            legs: [{ legType: 'dgnrs', amount: BigInt(index) * 10n ** 18n }],
            ticketPackRelease: ticketPackRelease(index),
          });
        },
      }]);
    }
    // Boxes 2 and 3 model results an auto-open owner already moved out of
    // Pending before the player reaches box 1's receipt. OPEN ALL must absorb
    // that reveal-queue tail as well as boxes 4 and 5, which are still ready.
    for (const index of [1, 2, 3]) {
      queueReveal({
        kind: 'lootbox', lootboxIndex: index, presentationId: `open-all-box:${index}`,
        legs: [{ legType: 'dgnrs', amount: BigInt(index) * 10n ** 18n }],
        ticketPackRelease: ticketPackRelease(index),
      });
    }
    const el = instantiate();
    await tick();

    const summary = el.querySelector('[data-bind="rvl-summary"]');
    const openAll = summary.querySelector('.rvl-open-all-cta--lootboxes');
    assert.ok(openAll);
    assert.equal(openAll.textContent, 'OPEN ALL 4 LUCKBOXES');
    openAll.dispatchEvent({ type: 'click', stopPropagation() {} });
    await new Promise((resolve) => setTimeout(resolve, 240));
    await tick();

    const finalSummary = el.querySelector('[data-bind="rvl-summary"]');
    assert.deepEqual(
      finalSummary.querySelectorAll('.rvl-card-value').map((node) => node.textContent),
      ['2', '3', '4', '5'],
      'queued and still-Pending rewards land together without an individual tail',
    );
    assert.equal(
      el.querySelector('[data-bind="rvl-stage"]').getAttribute('data-lootbox-case-model'),
      'large',
      'the combined reward is presented as one large case',
    );
    assert.equal(finalSummary.querySelector('.rvl-collect-cta').textContent, 'GOOD LUCK');
    finalSummary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.deepEqual(completions.map((detail) => detail.presentationId), [
      'open-all-box:1', 'open-all-box:2', 'open-all-box:3',
      'open-all-box:4', 'open-all-box:5',
    ], 'the one combined receipt completes every original box exactly once');
    assert.deepEqual(
      completions.map((detail) => detail.ticketPackRelease?.sourceKey),
      ['lootbox:1', 'lootbox:2', 'lootbox:3', 'lootbox:4', 'lootbox:5'],
      'each child ticket award remains attached to its own parent completion',
    );
    for (let i = 0; i < 10
      && !el.querySelector('[data-bind="rvl-backdrop"]').hidden; i += 1) await tick();
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true,
      'no already-queued luckbox reopens after the combined receipt');
  });

  test('OPEN ALL aggregates selected BoxSpins behind one play action and retires every box once', async (t) => {
    const address = '0x00000000000000000000000000000000000000ab';
    const completions = [];
    const onComplete = (event) => {
      const key = String(event?.detail?.key || '');
      completions.push(key);
      if (key === '2' || key === '3') {
        pendingActionsMod.clearPendingActions(`open-all-spin-box:${key}`);
      }
    };
    document.addEventListener(LOOTBOX_REVEAL_COMPLETE_EVENT, onComplete);
    t.after(() => document.removeEventListener(LOOTBOX_REVEAL_COMPLETE_EVENT, onComplete));

    const pendingBoxes = [{
      key: '2',
      spin: {
        legType: 'spin',
        spinType: 'wwxrp',
        payout: 2n * 10n ** 18n,
        reels: [{
          spinIndex: 0,
          playerTicket: 0xC3824100n,
          resultTicket: 0xC7864504n,
          score: 4,
        }],
      },
    }, {
      key: '3',
      spin: {
        legType: 'spin',
        betId: 11_026_022_280_916_248_713n,
        spinType: 'flip',
        survived: true,
        payout: 170_100n * 10n ** 18n,
        reels: [
          { spinIndex: 0, playerTicket: 4_203_172_354n, resultTicket: 4_136_200_202n, score: 2 },
          { spinIndex: 1, playerTicket: 3_835_317_537n, resultTicket: 3_380_768_558n, score: 2 },
          { spinIndex: 2, playerTicket: 3_968_814_117n, resultTicket: 3_937_362_177n, score: 2 },
        ],
      },
    }];
    for (const box of pendingBoxes) {
      const source = `open-all-spin-box:${box.key}`;
      pendingActionsMod.publishPendingActions(source, [{
        id: `lootbox:${box.key}`,
        kind: 'lootbox',
        label: `Luckbox #${box.key}`,
        state: 'ready',
        order: Number(box.key),
        run: async () => {
          queueReveal({
            kind: 'lootbox',
            lootboxIndex: Number(box.key),
            lootboxRelease: {
              address,
              key: box.key,
              lootboxIndex: Number(box.key),
            },
            legs: [box.spin],
          });
        },
      }]);
    }
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 1,
      lootboxRelease: { address, key: '1', lootboxIndex: 1 },
      legs: [{ legType: 'dgnrs', amount: 10n ** 18n }],
    });
    const el = instantiate();
    await tick();

    const summary = el.querySelector('[data-bind="rvl-summary"]');
    const openAll = summary.querySelector('.rvl-open-all-cta--lootboxes');
    assert.ok(openAll);
    openAll.dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 20
      && summary.querySelector('.rvl-collect-cta')?.textContent !== 'PLAY 4 SPINS'; i += 1) {
      await tick();
    }

    const spinZone = el.querySelector('[data-bind="rvl-spin-zone"]');
    const playAll = summary.querySelector('.rvl-collect-cta');
    const spinGrantCard = summary.querySelector('.rvl-card--spins');
    assert.equal(summary.hidden, false,
      'the mass-open lands on one readable grant receipt before any reel runs');
    assert.equal(summary.querySelectorAll('.rvl-card--spins').length, 1,
      'every selected BoxSpin is represented by one aggregate grant card');
    assert.equal(spinGrantCard?.querySelector('.rvl-card-value')?.textContent, '×4');
    assert.equal(spinGrantCard?.querySelector('.rvl-card-label')?.textContent, 'BOX SPINS');
    assert.equal(playAll?.textContent, 'PLAY 4 SPINS');
    assert.equal(spinZone.hidden, true,
      'the combined grant waits for the deliberate PLAY SPINS click');
    playAll.dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 20 && spinZone.hidden; i += 1) await tick();

    assert.equal(spinZone.hidden, false,
      'the one PLAY SPINS confirmation enters the first selected spin');
    assert.match(spinZone.querySelector('.rvl-spin-head').textContent, /WWXRP BOX SPIN/);
    assert.equal(spinZone.querySelectorAll('.rvl-dgn-history-chip').length, 1);
    spinZone.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    assert.match(spinZone.querySelector('.rvl-spin-head').textContent, /FLIP BOX SPIN/);
    assert.equal(spinZone.querySelectorAll('.rvl-dgn-history-chip').length, 3,
      'the second selected box retains all three verified reels');
    spinZone.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 10 && completions.length < 3; i += 1) await tick();

    assert.deepEqual(completions, ['1', '2', '3'],
      'the original and both selected siblings complete exactly once');
    assert.equal(
      pendingActionsMod.getPendingActions().some((item) => item.kind === 'lootbox'),
      false,
      'no successfully selected box remains in Pending after Open All finishes',
    );
  });

  test('a combined luckbox receipt does not offer its already-opened boxes again', async (t) => {
    const address = '0x00000000000000000000000000000000000000ab';
    const runs = new Map();
    for (const [source, index] of [['stale-box-two', 2], ['stale-box-three', 3]]) {
      t.after(() => pendingActionsMod.clearPendingActions(source));
      pendingActionsMod.publishPendingActions(source, [{
        id: `lootbox:${index}`, kind: 'lootbox', label: `Luckbox #${index}`,
        state: 'ready', order: index,
        run: async () => {
          runs.set(index, (runs.get(index) || 0) + 1);
          queueReveal({
            kind: 'lootbox', lootboxIndex: index,
            presentationId: `combined-stale-box:${index}`,
            lootboxRelease: { address, key: String(index), lootboxIndex: index },
            legs: [{ legType: 'dgnrs', amount: BigInt(index) * 10n ** 18n }],
          });
        },
      }]);
    }
    queueReveal({
      kind: 'lootbox', lootboxIndex: 1, presentationId: 'combined-stale-box:1',
      lootboxRelease: { address, key: '1', lootboxIndex: 1 },
      legs: [{ legType: 'dgnrs', amount: 1n * 10n ** 18n }],
    });
    const el = instantiate();
    await tick();

    const firstSummary = el.querySelector('[data-bind="rvl-summary"]');
    firstSummary.querySelector('.rvl-open-all-cta--lootboxes')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await new Promise((resolve) => setTimeout(resolve, 240));
    await tick();

    const finalCta = el.querySelector('[data-bind="rvl-summary"]')
      .querySelector('.rvl-collect-cta');
    assert.equal(finalCta.textContent, 'GOOD LUCK',
      'the selected Pending rows stay owned until completion without becoming a dead continuation');
    assert.deepEqual([...runs.entries()], [[2, 1], [3, 1]]);
  });

  test('COMBINE BOXES ends on a working terminal action, not its own Pending row', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });
    const source = 'current-combo-box';
    let staleRuns = 0;
    pendingActionsMod.publishPendingActions(source, [{
      id: 'lootbox:27', kind: 'lootbox', label: 'Luckbox #27',
      state: 'ready', order: 27,
      run: async () => { staleRuns += 1; },
    }]);
    t.after(() => pendingActionsMod.clearPendingActions(source));

    queueReveal({
      kind: 'lootbox',
      lootboxRelease: {
        address: '0x00000000000000000000000000000000000000ab',
        key: '27', lootboxIndex: 27,
      },
      boxOrders: [String(1n | (1n << 8n))],
      ticketPriceWei: 10_000_000_000n,
      legs: [{
        legType: 'opened', amount: 10_000_000_000n,
        wholeTickets: 1, futureLevel: 12, flip: 0n,
      }, {
        legType: 'opened', amount: 50_000_000_000n,
        wholeTickets: 0, futureTickets: 0, futureLevel: 14,
        flip: 25n * 10n ** 18n,
      }],
    });
    const el = instantiate();
    const combine = el.querySelector('[data-bind="rvl-open-all"]');
    for (let i = 0; i < 5 && !combine.textContent; i += 1) await tick();
    assert.equal(combine.textContent, 'COMBINE 2 BOXES');
    combine.dispatchEvent({ type: 'click', stopPropagation() {} });

    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    for (let i = 0; i < 12 && summary.hidden; i += 1) {
      await tick();
      if (summary.hidden) backdrop.dispatchEvent({ type: 'click' });
    }
    const cta = summary.querySelector('.rvl-collect-cta');
    assert.equal(cta.textContent, 'GOOD LUCK');
    cta.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    assert.equal(staleRuns, 0, 'the current combined box is never opened a second time');
    assert.equal(backdrop.hidden, true, 'the terminal action dismisses the completed receipt');
  });

  test('sealed OPEN ALL absorbs queued and ready Pending boxes into the same case', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    const opened = [];
    for (const [source, index] of [['choice-four', 4], ['choice-five', 5]]) {
      t.after(() => pendingActionsMod.clearPendingActions(source));
      pendingActionsMod.publishPendingActions(source, [{
        id: `lootbox:${index}`, kind: 'lootbox', label: `Luckbox #${index}`,
        state: 'ready', order: index,
        run: async () => {
          opened.push(index);
          pendingActionsMod.clearPendingActions(source);
          queueReveal({
            kind: 'lootbox', lootboxIndex: index,
            legs: [{ legType: 'dgnrs', amount: BigInt(index) * 10n ** 18n }],
          });
        },
      }]);
    }
    for (const index of [1, 2, 3]) {
      queueReveal({
        kind: 'lootbox', lootboxIndex: index,
        legs: [{ legType: 'dgnrs', amount: BigInt(index) * 10n ** 18n }],
      });
    }
    const el = instantiate();
    await tick();

    const actions = el.querySelector('[data-bind="rvl-pack-actions"]');
    const openOne = el.querySelector('[data-bind="rvl-open-pack"]');
    const openAll = el.querySelector('[data-bind="rvl-open-all"]');
    assert.equal(actions.hidden, false);
    assert.equal(actions.classList.contains('rvl-vessel-pack-actions--lootboxes'), true);
    assert.equal(openOne.textContent, 'OPEN ONE');
    assert.equal(openAll.textContent, 'OPEN ALL 5');
    assert.equal(el.querySelector('[data-bind="rvl-skip-pack"]').hidden, true,
      'luckboxes never inherit the ticket-pack skip control');

    openAll.dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 5; i += 1) await tick();
    assert.deepEqual(opened, [4, 5],
      'OPEN ALL resolves every ready luckbox in the tray before presentation advances');
    assert.equal(
      el.querySelector('[data-bind="rvl-vessel"]').getAttribute('data-lootbox-case-model'),
      'large',
      'the current case is upgraded in place to the one combined large box',
    );
    assert.equal(el.querySelector('[data-bind="rvl-title"]').textContent, 'ALL LUCKBOXES · 5 BOXES');

    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    for (let i = 0; i < 20 && summary.hidden; i += 1) {
      await tick();
      if (summary.hidden) backdrop.dispatchEvent({ type: 'click' });
    }
    assert.deepEqual(
      summary.querySelectorAll('.rvl-card-value').map((node) => node.textContent),
      ['1', '2', '3', '4', '5'],
      'the current, queued, and newly resolved boxes share one receipt',
    );
    assert.equal(summary.querySelector('.rvl-open-all-cta--lootboxes'), null,
      'the combined receipt has no leftover one-by-one boxes');
    const terminal = summary.querySelector('.rvl-collect-cta');
    assert.equal(terminal.textContent, 'GOOD LUCK');
    terminal.dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 10 && !backdrop.hidden; i += 1) await tick();
    assert.equal(backdrop.hidden, true,
      'the overlay closes after the one combined case instead of opening a queued tail');
  });

  test('OPEN ALL cannot be preempted by tapping the case while sibling results load', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });
    const address = '0x00000000000000000000000000000000000000ab';
    let releaseSibling;
    const siblingReady = new Promise((resolve) => { releaseSibling = resolve; });
    const opened = [];
    for (const [source, index] of [['slow-choice-two', 2], ['slow-choice-three', 3]]) {
      t.after(() => pendingActionsMod.clearPendingActions(source));
      pendingActionsMod.publishPendingActions(source, [{
        id: `lootbox:${index}`, kind: 'lootbox', label: `Luckbox #${index}`,
        state: 'ready', order: index,
        run: async () => {
          if (index === 2) await siblingReady;
          opened.push(index);
          pendingActionsMod.clearPendingActions(source);
          queueReveal({
            kind: 'lootbox', lootboxIndex: index,
            presentationId: `slow-open-all:${index}`,
            lootboxRelease: { address, key: String(index), lootboxIndex: index },
            legs: [{ legType: 'dgnrs', amount: BigInt(index) * 10n ** 18n }],
          });
        },
      }]);
    }
    queueReveal({
      kind: 'lootbox', lootboxIndex: 1,
      presentationId: 'slow-open-all:1',
      lootboxRelease: { address, key: '1', lootboxIndex: 1 },
      legs: [{ legType: 'dgnrs', amount: 1n * 10n ** 18n }],
    });
    const el = instantiate();
    await tick();

    const actions = el.querySelector('[data-bind="rvl-pack-actions"]');
    const openAll = el.querySelector('[data-bind="rvl-open-all"]');
    const vessel = el.querySelector('[data-bind="rvl-vessel"]');
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    for (let i = 0; i < 5 && !openAll.textContent; i += 1) await tick();
    assert.equal(openAll.textContent, 'OPEN ALL 3');
    openAll.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(actions.classList.contains('is-loading'), true,
      'the sealed case visibly owns the in-flight OPEN ALL request');
    assert.equal(openAll.textContent, 'OPENING ALL 3…',
      'the selected control acknowledges the click while sibling results load');

    // This is the live regression: a case tap used to resolve the original
    // one-box gate while OPEN ALL was still collecting its siblings.
    vessel.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(summary.hidden, true,
      'the case cannot escape into a one-box receipt during OPEN ALL');
    assert.equal(actions.hidden, false,
      'the loading OPEN ALL gate remains mounted until every sibling is collected');

    releaseSibling();
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    for (let i = 0; i < 14 && summary.hidden; i += 1) {
      await tick();
      if (summary.hidden) backdrop.dispatchEvent({ type: 'click' });
    }
    await tick();

    assert.deepEqual(opened, [2, 3]);
    assert.deepEqual(
      summary.querySelectorAll('.rvl-card-value').map((node) => node.textContent),
      ['1', '2', '3'],
      'the original and both siblings land in one combined receipt',
    );
    assert.equal(summary.querySelector('.rvl-collect-cta').textContent, 'GOOD LUCK');
    assert.equal(summary.querySelector('.rvl-open-all-cta--lootboxes'), null,
      'the combined receipt cannot offer its already-consumed siblings again');
  });

  test('VIEW INDIVIDUALLY skips cardless combo placeholders before COMBO REWARDS', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    queueReveal({
      kind: 'lootbox',
      // Four purchased boxes, but only the two attributable opened legs should
      // become individual reveal screens. DGNRS remains a combo-wide reward.
      boxOrders: ['4'],
      ticketPriceWei: 10_000_000_000n,
      legs: [{
        legType: 'opened', amount: 10_000_000_000n,
        wholeTickets: 1, futureLevel: 12, flip: 0n,
      }, {
        legType: 'opened', amount: 10_000_000_000n,
        wholeTickets: 0, futureTickets: 0, futureLevel: 12,
        flip: 25n * 10n ** 18n,
      }, {
        legType: 'dgnrs', amount: 7n * 10n ** 18n,
      }],
    });
    const el = instantiate();
    const individual = el.querySelector('[data-bind="rvl-open-pack"]');
    const combined = el.querySelector('[data-bind="rvl-open-all"]');
    for (let i = 0; i < 5 && !individual.textContent; i += 1) await tick();

    assert.equal(individual.textContent, 'VIEW INDIVIDUALLY');
    assert.equal(combined.textContent, 'COMBINE 4 BOXES');
    assert.match(individual.getAttribute('aria-label'), /2 luckboxes with individual results/i);

    individual.dispatchEvent({ type: 'click', stopPropagation() {} });
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    const title = el.querySelector('[data-bind="rvl-title"]');
    const vessel = el.querySelector('[data-bind="rvl-vessel"]');
    const stage = el.querySelector('[data-bind="rvl-stage"]');
    // Taps skip only authored waits. The first physical case still mounts and
    // reaches its own one-box receipt before the next case can begin.
    for (let i = 0; i < 8 && summary.hidden; i += 1) {
      await tick();
      if (summary.hidden) backdrop.dispatchEvent({ type: 'click' });
    }
    await tick();
    assert.equal(title.textContent, 'SMALL LUCKBOX · 1 OF 2');
    assert.equal(stage.getAttribute('data-lootbox-case-model'), 'small');
    assert.match(summary.textContent, /1 TICKET/);
    assert.doesNotMatch(summary.textContent, /25 FLIP|DGNRS/);
    const firstNext = summary.querySelector('.rvl-collect-cta');
    assert.equal(firstNext.textContent, 'OPEN NEXT BOX');

    firstNext.dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 6 && title.textContent !== 'SMALL LUCKBOX · 2 OF 2'; i += 1) {
      await tick();
    }
    assert.equal(vessel.hidden, false, 'the second box mounts the sealed case again');
    assert.equal(stage.getAttribute('data-lootbox-case-model'), 'small');
    for (let i = 0; i < 8 && summary.hidden; i += 1) {
      await tick();
      if (summary.hidden) backdrop.dispatchEvent({ type: 'click' });
    }
    await tick();
    assert.match(summary.textContent, /25\s*FLIP/);
    assert.doesNotMatch(summary.textContent, /1 TICKET|DGNRS/);
    const secondNext = summary.querySelector('.rvl-collect-cta');
    assert.equal(secondNext.textContent, 'COMBO REWARDS ▸');

    secondNext.dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 8 && title.textContent !== 'COMBO REWARDS'; i += 1) await tick();
    backdrop.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5 && summary.hidden; i += 1) await tick();
    assert.equal(vessel.hidden, true, 'aggregate-only rewards never impersonate another box');
    assert.match(summary.textContent, /7\s*DGNRS/);

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('OPEN ONE leaves the other ready luckboxes in Pending', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    let siblingRuns = 0;
    pendingActionsMod.publishPendingActions('choice-sibling', [{
      id: 'lootbox:2', kind: 'lootbox', label: 'Luckbox #2', state: 'ready',
      run: async () => { siblingRuns += 1; },
    }]);
    queueReveal({
      kind: 'lootbox', lootboxIndex: 1,
      legs: [{ legType: 'dgnrs', amount: 1n * 10n ** 18n }],
    });
    const el = instantiate();
    await tick();

    el.querySelector('[data-bind="rvl-open-pack"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(siblingRuns, 0);
    assert.equal(
      pendingActionsMod.getPendingActions().some((item) => item.id === 'lootbox:2'),
      true,
    );

    el.querySelector('[data-bind="rvl-close"]')
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
    const title = el.querySelector('[data-bind="rvl-title"]');
    assert.match(title.textContent, /FOIL PACK · LEVEL 12/,
      'semantic result context remains available');
    assert.equal(title.hidden, true, 'the visible duplicate foil title is removed');
    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    assert.equal(zone.querySelector('.rvl-foil-presentation'), null,
      'the explanatory foil copy no longer crowds the result hand');
    assert.ok(zone.querySelector('.rvl-ticket-grid-stage--foil'), 'dedicated foil grid');
    assert.ok(zone.querySelector('.rvl-ticket-grid-stage--size-4'),
      'four foil tickets use the same roomy 2x2 hand as ordinary tickets');
    assert.equal(zone.querySelectorAll('.rvl-paper--foil').length, 4);
    assert.equal(zone.querySelectorAll('.rvl-paper-tag').length, 0,
      'foil is communicated by the ticket material instead of a text sticker');
    assert.equal(zone.querySelectorAll('.ticket-card--foil').length, 4,
      'every revealed foil ticket receives the shared metallic face');
    assert.match(
      APP_CSS,
      /\.rvl-paper--foil\s*\{[^}]*overflow:\s*hidden/s,
      'the moving foil sheen is clipped to each revealed ticket',
    );
    assert.ok(zone.querySelectorAll('.ticket-card--foil').every((ticket) => (
      ticket.querySelector('.ticket-card-center')?.querySelector('img')?.src
        === '/whitepaper/flame-center.svg'
    )), 'every revealed foil ticket uses the shipped flame with its CSS silver treatment');
    assert.ok(zone.querySelectorAll('.ticket-card--foil').every((ticket) => (
      ticket.querySelectorAll('.trait-quadrant').every((quadrant) => (
        quadrant.getAttribute('data-trait-color') === 'pink'
      ))
    )), 'foil quadrants carry their decoded badge colour into the material layer');
    assert.match(
      APP_CSS,
      /\.ticket-card--foil \.trait-quadrant\s*\{[^}]*--foil-metal-deep:[^}]*linear-gradient\([^}]*var\(--foil-metal-pale\)[^}]*var\(--foil-metal-deep\)/s,
      'foil quadrants share a brushed-metal surface driven by colour variables',
    );
    assert.match(
      APP_CSS,
      /data-trait-color="pink"[^}]*--foil-metal-deep:\s*#65094f[^}]*--foil-metal-bright:\s*#f27ad5/s,
      'the foil metal palette follows the badge hue instead of flattening every quadrant to silver',
    );
    assert.match(
      APP_CSS,
      /\.ticket-card--foil \.ticket-card-center\s*\{[^}]*conic-gradient\([^}]*#ffe27a[^}]*box-shadow:/s,
      'foil centres use a reflective gold diamond',
    );
    assert.match(
      APP_CSS,
      /\.ticket-card--foil \.ticket-card-center img\s*\{[^}]*filter:[^}]*drop-shadow[^}]*rgba\(255, 255, 255, 0\.72\)/s,
      'the centre flame receives its silver treatment',
    );
    assert.equal(el.querySelector('[data-bind="rvl-summary"]').hidden, true,
      'ticket hand never collapses into the generic summary');
    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
  });

  test('a full nine-ticket hand uses the compact 3x3 reveal size', async () => {
    const tickets = Array.from({ length: 9 }, (_, i) => ({
      traitIds: [i, 64 + i, 128 + i, 192 + i],
    }));
    queueReveal({ kind: 'pack', level: 12, count: 9, tickets });
    const el = instantiate();
    await tick();

    const grid = el.querySelector('.rvl-ticket-grid-stage--size-9');
    assert.ok(grid);
    assert.equal(grid.querySelectorAll('.rvl-paper').length, 9);
    assert.match(
      APP_CSS,
      /\.rvl-ticket-grid-stage--size-9\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)[^}]*width:\s*min\(92vw, 510px, 68dvh\)/s,
    );

    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
  });

  test('pack cards are released to inventory only after the player acknowledges the hand', async () => {
    const completed = [];
    const idle = [];
    const onComplete = (event) => completed.push(event.detail);
    const onIdle = (event) => idle.push({
      detail: event.detail,
      backdropHidden: el.querySelector('[data-bind="rvl-backdrop"]')?.hidden,
    });
    document.addEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
    queueReveal({
      kind: 'pack',
      level: 12,
      count: 1,
      foilPack: true,
      tickets: [{ traitIds: [1, 70, 130, 200], foil: true }],
      packRelease: {
        address: '0xab12000000000000000000000000000000000000',
        level: 12,
        cardIndexes: [7],
      },
    });
    const el = instantiate();
    document.addEventListener(REVEAL_OVERLAY_IDLE_EVENT, onIdle);
    await tick();
    assert.equal(completed.length, 0, 'mounting the reveal does not leak the ticket early');

    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
    assert.deepEqual(completed, [{
      address: '0xab12000000000000000000000000000000000000',
      level: 12,
      foilPack: true,
      cardIndexes: [7],
    }]);
    assert.deepEqual(idle, [{ detail: { aborted: false }, backdropHidden: true }],
      'background consumers are released only after the whole fullscreen overlay is hidden');
    document.removeEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
    document.removeEventListener(REVEAL_OVERLAY_IDLE_EVENT, onIdle);
  });

  test('one resolved live ticket opens large without the tutorial lesson', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    queueReveal({
      kind: 'pack',
      level: 3,
      count: 1,
      tickets: [{ traitIds: [1, 70, 130, 200] }],
    });
    const el = instantiate();
    await tick();

    assert.equal(el.querySelector('[data-bind="rvl-vessel"]').hidden, true,
      'there is no sealed-pack beat for a one-ticket reveal');
    assert.equal(el.querySelector('[data-bind="rvl-pack-actions"]').hidden, true,
      'SKIP is not offered when the ticket itself is already on screen');
    assert.equal(el.querySelector('[data-bind="rvl-card-zone"]').hidden, false);
    assert.ok(el.querySelector('.rvl-ticket-grid-stage--single'));
    assert.ok(el.querySelector('.rvl-ticket-grid-stage--size-1'));
    const packBadge = el.querySelector('.rvl-single-pack-badge');
    assert.ok(packBadge?.querySelector('.rvl-pack-logo'),
      'the direct ticket reveal retains a compact pack logo');
    assert.equal(packBadge.querySelector('.rvl-pack-level').textContent, 'LEVEL 3');
    assert.equal(el.querySelector('.rvl-ticket-lesson'), null);
    assert.equal(el.querySelectorAll('.rvl-ticket-entry-number').length, 0);
    assert.match(APP_CSS, /\.rvl-ticket-grid-stage--single[\s\S]{0,420}width:\s*min\(70vw, 430px, 58dvh\)/);

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('one resolved entry opens as an oriented quarter-ticket with no center diamond', async () => {
    queueReveal({
      kind: 'pack',
      level: 12,
      count: 0.25,
      entries: [{ traitId: 72 }],
    });
    const el = instantiate();
    await tick();

    const entry = el.querySelector('.ticket-entry-card');
    assert.ok(entry, 'the entry uses the dedicated quarter-ticket graphic');
    assert.equal(entry.getAttribute('data-quadrant'), '1');
    assert.equal(el.querySelector('.rvl-paper--entry')?.getAttribute('data-quadrant'), '1',
      'the reveal paper clips the same inner corner as its entry');
    assert.equal(entry.querySelector('.ticket-card-center'), null,
      'the standalone entry has no center diamond');
    assert.ok(el.querySelector('.rvl-entry-cluster'),
      'even one loose entry uses a normal ticket-sized 2x2 footprint');
    const packBadge = el.querySelector('.rvl-single-pack-badge');
    assert.ok(packBadge?.querySelector('.rvl-pack-logo'),
      'a singleton also keeps its source pack identity above the quadrant');
    assert.equal(packBadge.querySelector('.rvl-pack-level').textContent, 'LEVEL 12');
    assert.equal(el.querySelector('.rvl-entry-cluster__label'), null,
      'loose entries do not carry a redundant visual ENTRY label');
    assert.match(APP_CSS,
      /\.ticket-entry-card\[data-quadrant="1"\]\s*\{[^}]*clip-path:\s*polygon\(/s,
      'the center-facing corner is cut away along the former diamond edge');
    assert.ok(el.querySelector('[data-bind="rvl-stage"]').classList.contains('rvl-stage--single-entry'));
    assert.match(APP_CSS,
      /\.rvl-ticket-grid-stage--single-entry[\s\S]{0,180}width:\s*min\(70vw, 430px, 58dvh\)/,
      'the singleton footprint takes the same space as a normal ticket');

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('the tutorial two-ticket pack starts on its wrapper without a skip action', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    queueReveal({
      kind: 'pack',
      level: 3,
      count: 2,
      tutorialTicketLesson: true,
      tickets: [
        { traitIds: [22, 73, 178, 219] },
        { traitIds: [47, 64, 166, 207] },
      ],
    });
    const el = instantiate();
    await tick();

    assert.equal(el.querySelector('[data-bind="rvl-vessel"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="rvl-pack-actions"]').hidden, true,
      'the lesson requires the pack-opening animation instead of offering SKIP');
    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('the tutorial two-ticket reveal shows both large examples beside the rarity lesson', async () => {
    queueReveal({
      kind: 'pack',
      level: 3,
      count: 2,
      tutorialTicketLesson: true,
      tickets: [
        { traitIds: [22, 73, 178, 219] },
        { traitIds: [47, 64, 166, 207] },
      ],
    });
    const el = instantiate();
    await tick();

    assert.ok(el.querySelector('.rvl-ticket-grid-stage--lesson-stack'));
    assert.equal(el.querySelectorAll('.rvl-paper').length, 2);
    assert.ok(el.querySelector('.rvl-ticket-lesson'));
    assert.equal(el.querySelectorAll('.rvl-ticket-entry-number').length, 0);
    assert.equal(el.querySelector('.rvl-ticket-lesson__eyebrow').textContent, 'YOUR FIRST PACK');
    assert.deepEqual(
      Array.from(el.querySelectorAll('.rvl-ticket-lesson__title-line'))
        .map((line) => line.textContent),
      ['ONE TICKET = FOUR', 'JACKPOT ENTRIES'],
    );
    assert.equal(
      el.querySelector('.rvl-ticket-lesson__title').getAttribute('aria-label'),
      'ONE TICKET = FOUR JACKPOT ENTRIES',
    );
    assert.match(
      APP_CSS,
      /\.rvl-ticket-pack-stage--lesson \.ticket-card-center\s*\{[^}]*width:\s*20%;[^}]*height:\s*20%;/s,
    );
    assert.match(
      APP_CSS,
      /\.rvl-ticket-grid-stage--lesson-stack\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    assert.match(
      APP_CSS,
      /\.rvl-ticket-grid-stage--lesson-stack \.rvl-paper\s*\{[\s\S]*?position:\s*relative[\s\S]*?width:\s*100%/,
    );
    assert.match(el.querySelector('.rvl-ticket-lesson__equation').textContent, /8SYMBOLS.*8COLORS.*64TRAITS/);
    const examples = el.querySelectorAll('.rvl-ticket-lesson__example');
    assert.equal(examples.length, 2);
    assert.match(examples[0].textContent, /COMMON COLOR.*GREEN ETHEREUM.*1 in 4/);
    assert.match(examples[1].textContent, /RARER COLOR.*ORANGE BITCOIN.*1 in 32/);
    assert.equal(examples[0].querySelector('img').src, '/badges-circular/crypto_06_ethereum_green.svg');
    assert.equal(examples[1].querySelector('img').src, '/badges-circular/crypto_07_bitcoin_orange.svg');
    assert.match(el.querySelector('.rvl-ticket-lesson__rule').textContent, /COLOR SHOWS RARITY.*symbol.*color.*hard/);
    assert.doesNotMatch(
      el.querySelector('.rvl-ticket-lesson').textContent,
      /jackpot ticket each day|weighted equally|Blue|Pink/i,
    );
    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('one sealed pack offers OPEN PACK beside SKIP', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    const el = instantiate();
    queueReveal({
      kind: 'pack',
      title: 'YOUR TICKETS',
      level: 8,
      count: 2,
      tickets: [
        { traitIds: [1, 70, 130, 200] },
        { traitIds: [2, 71, 131, 201] },
      ],
    });
    await tick();

    const actions = el.querySelector('[data-bind="rvl-pack-actions"]');
    const openPack = el.querySelector('[data-bind="rvl-open-pack"]');
    const skip = el.querySelector('[data-bind="rvl-skip-pack"]');
    const openAll = el.querySelector('[data-bind="rvl-open-all"]');
    assert.equal(actions.hidden, false, 'the single sealed pack exposes its action row');
    assert.equal(openPack.hidden, false, 'OPEN PACK is visible when there is no batch');
    assert.equal(openPack.textContent, 'OPEN PACK');
    assert.equal(skip.hidden, false, 'SKIP remains beside the explicit open action');
    assert.equal(skip.textContent, 'SKIP');
    assert.equal(openAll.hidden, true, 'a one-pack reveal does not advertise OPEN ALL');
    assert.match(
      REVEAL_SRC,
      /<div class="rvl-vessel-hint"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<div class="rvl-vessel-pack-actions"/,
      'pack controls are a sibling hit surface rather than children of the vessel button',
    );
    const buttons = el.querySelectorAll('button');
    assert.ok(buttons.indexOf(openPack) < buttons.indexOf(skip),
      'the primary OPEN PACK action stays to the left of SKIP');
    assert.match(
      APP_CSS,
      /\.rvl-vessel-open-pack[^\{]*\{[^}]*min-height:\s*44px/s,
      'OPEN PACK has a tactile minimum target',
    );
    assert.match(
      APP_CSS,
      /\.rvl-vessel-pack-actions\s*\{[^}]*z-index:\s*12;[^}]*pointer-events:\s*auto;/s,
      'the independent pack action surface remains above the isolated vessel art',
    );
    assert.match(
      APP_CSS,
      /\.rvl-vessel-pack-actions > button\s*\{[^}]*pointer-events:\s*auto;[^}]*touch-action:\s*manipulation;/s,
      'each pack action accepts direct touch input',
    );

    openPack.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(actions.hidden, true, 'the controls clear as the pack starts opening');
    assert.equal(el.querySelector('[data-bind="rvl-stage"]').classList.contains('rvl-charging'), true);

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('SKIP ALL consumes the whole batch when OPEN ALL is its companion action', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    const completed = [];
    const onComplete = (event) => completed.push(event.detail);
    document.addEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
    t.after(() => {
      window.matchMedia = previousMatchMedia;
      document.removeEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
    });

    const el = instantiate();
    const ticket = (n) => ({ traitIds: [n, 70, 130, 200] });
    for (let packIndex = 1; packIndex <= 2; packIndex += 1) {
      const first = ((packIndex - 1) * 2) + 1;
      queueReveal({
        kind: 'pack',
        title: 'YOUR TICKETS',
        level: 8,
        count: 2,
        totalCount: 4,
        batchId: 'batch-skip',
        packIndex,
        packCount: 2,
        tickets: [ticket(first), ticket(first + 1)],
        packRelease: {
          address: '0xab12000000000000000000000000000000000000',
          level: 8,
          cardIndexes: [first, first + 1],
        },
      });
    }
    await tick();

    const packActions = el.querySelector('[data-bind="rvl-pack-actions"]');
    const skip = el.querySelector('[data-bind="rvl-skip-pack"]');
    const openAll = el.querySelector('[data-bind="rvl-open-all"]');
    assert.equal(packActions.hidden, false, 'sealed packs expose their action row');
    assert.equal(openAll.hidden, false, 'OPEN ALL remains beside SKIP when packs remain');
    assert.ok(skip, 'SKIP is available before any ticket is shown');
    assert.equal(skip.textContent, 'SKIP ALL', 'the secondary action makes its batch scope explicit');
    const buttons = el.querySelectorAll('button');
    assert.ok(buttons.indexOf(openAll) < buttons.indexOf(skip),
      'the primary OPEN ALL action stays to the left of SKIP ALL');
    assert.match(
      APP_CSS,
      /\.rvl-vessel-skip\s*\{[^}]*min-height:\s*44px|\.rvl-vessel-open-all, \.rvl-vessel-skip, \.rvl-open-all-cta\s*\{[^}]*min-height:\s*44px/s,
      'SKIP keeps the same tactile minimum target as the pack controls',
    );

    skip.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(completed.length, 2, 'one click permanently consumes every presentation in the batch');
    assert.deepEqual(completed[0].cardIndexes, [1, 2]);
    assert.deepEqual(completed[1].cardIndexes, [3, 4]);
    assert.equal(el.querySelector('[data-bind="rvl-card-zone"]').hidden, true,
      'none of the skipped ticket hands were rendered');
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true,
      'skipping the batch drains the reveal cleanly');
  });

  test('SKIP ALL remains armed when a known sibling pack joins the queue late', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    const completed = [];
    const onComplete = (event) => completed.push(event.detail);
    document.addEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
    t.after(() => {
      window.matchMedia = previousMatchMedia;
      document.removeEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
    });

    const el = instantiate();
    const address = '0xab12000000000000000000000000000000000000';
    const ticket = (n) => ({ traitIds: [n, 70, 130, 200] });
    const pack = (packIndex, firstCardIndex) => ({
      kind: 'pack', title: 'YOUR TICKETS', level: 8, count: 2,
      totalCount: 4, batchId: 'batch-late-sibling', packIndex, packCount: 2,
      tickets: [ticket(firstCardIndex), ticket(firstCardIndex + 1)],
      packRelease: {
        address, level: 8, cardIndexes: [firstCardIndex, firstCardIndex + 1],
      },
    });

    queueReveal(pack(1, 1));
    await tick();
    const skip = el.querySelector('[data-bind="rvl-skip-pack"]');
    assert.equal(skip.textContent, 'SKIP ALL',
      'pack metadata advertises the sibling even before its sequence arrives');
    skip.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.deepEqual(completed.map((release) => release.cardIndexes), [[1, 2]]);
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true);

    queueReveal(pack(2, 3));
    await tick();
    assert.deepEqual(completed.map((release) => release.cardIndexes), [[1, 2], [3, 4]],
      'the delayed sibling inherits the batch skip instead of mounting another wrapper');
    assert.equal(el.querySelector('[data-bind="rvl-card-zone"]').hidden, true);
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true);

    queueReveal({
      ...pack(1, 5),
      batchId: 'unrelated-later-buy', packCount: 1, totalCount: 2,
    });
    await tick();
    assert.equal(completed.length, 2,
      'finishing the skipped batch does not consume a later unrelated pack');
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, false);
    assert.equal(el.querySelector('[data-bind="rvl-skip-pack"]').textContent, 'SKIP');
    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('SKIP ALL follows OPEN ALL PACKS into ready Pending ticket packs', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    const completed = [];
    const onComplete = (event) => completed.push(event.detail);
    document.addEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
    t.after(() => {
      window.matchMedia = previousMatchMedia;
      document.removeEventListener(PACK_REVEAL_COMPLETE_EVENT, onComplete);
    });

    const el = instantiate();
    const address = '0xab12000000000000000000000000000000000000';
    const ticket = (n) => ({ traitIds: [n, 70, 130, 200] });
    let pendingRuns = 0;
    pendingActionsMod.publishPendingActions('next-pack', [{
      id: 'ticket-pack:9', kind: 'tickets', ticketLevel: 9,
      label: 'Level 9 ticket pack', shortLabel: 'Open tickets',
      state: 'ready', order: 10, chronology: 9,
      run: async () => {
        pendingRuns += 1;
        pendingActionsMod.clearPendingActions('next-pack');
        queueReveal({
          kind: 'pack', title: 'LEVEL 9 TICKETS', level: 9, count: 2,
          batchId: 'pending-level-9', packIndex: 1, packCount: 1,
          tickets: [ticket(3), ticket(4)],
          packRelease: { address, level: 9, cardIndexes: [3, 4] },
        });
      },
    }]);
    queueReveal({
      kind: 'pack', title: 'LEVEL 7 TICKETS', level: 7, count: 2,
      batchId: 'current-level-7', packIndex: 1, packCount: 1,
      tickets: [ticket(1), ticket(2)],
      packRelease: { address, level: 7, cardIndexes: [1, 2] },
    });
    await tick();

    const openAll = el.querySelector('[data-bind="rvl-open-all"]');
    const skip = el.querySelector('[data-bind="rvl-skip-pack"]');
    assert.equal(openAll.textContent, 'OPEN ALL PACKS');
    assert.equal(skip.textContent, 'SKIP ALL');

    skip.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    assert.equal(pendingRuns, 1, 'the ready Pending pack was materialized once');
    assert.deepEqual(completed.map((release) => release.cardIndexes), [[1, 2], [3, 4]],
      'the current and Pending pack releases were both consumed');
    assert.equal(el.querySelector('[data-bind="rvl-card-zone"]').hidden, true,
      'the Pending ticket hand was skipped without rendering');
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true);
  });

  test('a pack with no usable release is not treated as its own external pack', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    const el = instantiate();
    const ticket = (n) => ({ traitIds: [n, 70, 130, 200] });
    let pendingRuns = 0;
    // The level's OWN ready row. queueReveal drops a release carrying neither
    // card indexes nor item keys, so the level number is the only thing left
    // that can tell the overlay this row is the hand already on screen.
    pendingActionsMod.publishPendingActions('own-level', [{
      id: 'ticket-pack:7', kind: 'tickets', ticketLevel: 7,
      label: 'Level 7 ticket pack', state: 'ready', order: 10, chronology: 7,
      run: async () => { pendingRuns += 1; },
    }]);
    queueReveal({
      kind: 'pack', title: 'LEVEL 7 TICKETS', level: 7, count: 2,
      batchId: 'lonely-level-7', packIndex: 1, packCount: 1,
      tickets: [ticket(1), ticket(2)],
      packRelease: { address: '0xab12000000000000000000000000000000000000', level: 7 },
    });
    await tick();

    const openAll = el.querySelector('[data-bind="rvl-open-all"]');
    const skip = el.querySelector('[data-bind="rvl-skip-pack"]');
    assert.equal(openAll.hidden, true,
      'a lone pack does not advertise OPEN ALL against its own pending row');
    assert.equal(skip.textContent, 'SKIP',
      'and its companion stays a single-pack SKIP rather than SKIP ALL');

    skip.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(pendingRuns, 0,
      'skipping never hands off to a run() for the level it just consumed');
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true);
  });

  test('a stalled Pending handoff releases the overlay instead of freezing it', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    const el = instantiate();
    const ticket = (n) => ({ traitIds: [n, 70, 130, 200] });
    // A genuinely external ready pack whose run() never settles — one indexer
    // request alone can burn the 20s API deadline.
    pendingActionsMod.publishPendingActions('stalled', [{
      id: 'ticket-pack:9', kind: 'tickets', ticketLevel: 9,
      label: 'Level 9 ticket pack', state: 'ready', order: 10, chronology: 9,
      run: () => new Promise(() => {}),
    }]);
    queueReveal({
      kind: 'pack', title: 'LEVEL 7 TICKETS', level: 7, count: 2,
      batchId: 'current-level-7', packIndex: 1, packCount: 1,
      tickets: [ticket(1), ticket(2)],
      packRelease: {
        address: '0xab12000000000000000000000000000000000000',
        level: 7, cardIndexes: [1, 2],
      },
    });
    await tick();

    const skip = el.querySelector('[data-bind="rvl-skip-pack"]');
    assert.equal(skip.textContent, 'SKIP ALL',
      'the level-9 row is a real external pack, so the batch scope is offered');

    skip.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(el.querySelector('[data-bind="rvl-close"]').disabled, true,
      'the handoff holds the close button while it waits');

    await new Promise((resolve) => { setTimeout(resolve, 4_400); });
    assert.equal(el.querySelector('[data-bind="rvl-close"]').disabled, false,
      'the deadline hands the close button back');
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true,
      'and the reveal ends on the readable hand instead of hanging on the wrapper');
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

  test('a sole remaining pack uses one centered OPEN NEXT action', async () => {
    const el = instantiate();
    const ticket = (n) => ({ traitIds: [n, 70, 130, 200] });
    for (let packIndex = 1; packIndex <= 2; packIndex += 1) {
      queueReveal({
        kind: 'pack',
        title: 'YOUR TICKETS',
        level: 7,
        count: 1,
        totalCount: 2,
        batchId: 'batch-one-remaining',
        packIndex,
        packCount: 2,
        tickets: [ticket(packIndex)],
      });
    }
    await tick();

    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    const next = zone.querySelector('.rvl-collect-cta');
    assert.equal(next.textContent, 'OPEN NEXT PACK');
    assert.equal(zone.querySelector('.rvl-open-all-cta'), null,
      'OPEN ALL 1 REMAINING would duplicate the exact same action');
    assert.match(
      APP_CSS,
      /\.rvl-ticket-actions > \.rvl-collect-cta\s*\{[^}]*width:\s*min\(15rem,[^}]*margin:\s*0;/s,
      'the sole primary action occupies the centered ticket action row without an offset socket',
    );

    next.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.match(el.querySelector('[data-bind="rvl-title"]').textContent, /PACK 2\/2/);
    assert.equal(zone.querySelector('.rvl-collect-cta').textContent, 'GOOD LUCK');
    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
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
    assert.equal(zone.querySelector('.rvl-auto-pack-rip'), null,
      'one-ticket hands stay wrapperless even while OPEN ALL is advancing');
    assert.equal(el.querySelector('[data-bind="rvl-vessel"]').hidden, true,
      'open-all does not cut back to the full sealed-pack scene');
    assert.equal(zone.querySelector('.rvl-open-all-cta'), null, 'no open-all button on final pack');
    assert.equal(zone.querySelector('.rvl-collect-cta').textContent, 'GOOD LUCK');
    const historyLabel = zone.querySelector('.rvl-pack-history-label');
    const previousPack = zone.querySelector('.rvl-pack-history-nav--previous');
    const nextPack = zone.querySelector('.rvl-pack-history-nav--next');
    assert.equal(historyLabel.textContent, 'PACK 3 OF 3 OPENED · LEVEL 7');
    assert.equal(previousPack.disabled, false);
    assert.equal(nextPack.disabled, true);

    previousPack.dispatchEvent({ type: 'click', stopPropagation() {} });
    assert.equal(historyLabel.textContent, 'PACK 2 OF 3 OPENED · LEVEL 7');
    assert.equal(nextPack.disabled, false, 'right arrow returns toward the latest hand');
    nextPack.dispatchEvent({ type: 'click', stopPropagation() {} });
    assert.equal(historyLabel.textContent, 'PACK 3 OF 3 OPENED · LEVEL 7');

    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
  });

  test('the final ticket hand can continue directly into its pending Bingo reveal', async () => {
    let bingoRuns = 0;
    pendingActionsMod.publishPendingActions('ticket-bingo-continuation', [{
      id: 'bingo:ticket-continuation-level-8',
      kind: 'bingo',
      label: 'Level 8 Bingo',
      state: 'ready',
      order: 14,
      run: async () => {
        bingoRuns += 1;
        pendingActionsMod.clearPendingActions('ticket-bingo-continuation');
        queueReveal({
          kind: 'bingo',
          level: 8,
          symbol: 0,
          counts: Array.from({ length: 64 }, (_unused, index) => (
            index % 8 === 0 ? 1 : 0
          )),
          presentationId: 'bingo:ticket-continuation-test',
        });
      },
    }]);

    const tickets = Array.from({ length: 9 }, (_, index) => ({
      traitIds: [index, 64 + index, 128 + index, 192 + index],
    }));
    queueReveal({ kind: 'pack', title: 'YOUR TICKETS', level: 8, count: 9, tickets });
    const el = instantiate();
    await tick();

    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    const continuation = zone.querySelector('.rvl-collect-cta');
    assert.equal(continuation.textContent, 'REVEAL BINGO');
    assert.equal(continuation.disabled, false);

    continuation.dispatchEvent({ type: 'click', stopPropagation() {} });
    for (let i = 0; i < 4; i += 1) await tick();

    assert.equal(bingoRuns, 1, 'one click executes the pending Bingo action once');
    assert.equal(
      el.querySelector('[data-bind="rvl-stage"]').classList.contains('rvl-stage--bingo'),
      true,
      'the action replaces the ticket hand with the Bingo result',
    );
    assert.ok(el.querySelector('.rvl-bingo-chart'));

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('OPEN ALL remaining is one confirmation for sealed-card pack batches', async (t) => {
    const previousMatchMedia = window.matchMedia;
    t.after(() => { window.matchMedia = previousMatchMedia; });

    const el = instantiate();
    for (let packIndex = 1; packIndex <= 3; packIndex += 1) {
      queueReveal({
        kind: 'pack', level: 7, count: 1, pending: true,
        batchId: 'sealed-open-all-once', packIndex, packCount: 3,
      });
    }
    await tick();

    const summary = el.querySelector('[data-bind="rvl-summary"]');
    const openAll = summary.querySelector('.rvl-open-all-cta');
    assert.equal(openAll.textContent, 'OPEN ALL 2 REMAINING');

    // Move only the subsequent packs onto the normal-motion path. Resolve
    // their presentation beats manually so the assertion lands precisely on
    // pack two's receipt instead of waiting on animation wall-clock time.
    window.matchMedia = () => ({ matches: false });
    openAll.dispatchEvent({ type: 'click', stopPropagation() {} });
    const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
    for (let beat = 0; beat < 4; beat += 1) {
      await tick();
      backdrop.dispatchEvent({ type: 'click' });
    }
    await tick();

    const continuation = summary.querySelector('.rvl-collect-cta');
    assert.equal(continuation.textContent, 'OPENING NEXT PACK…',
      'the first OPEN ALL click remains armed on the following receipt');
    assert.equal(continuation.disabled, true,
      'the progress control cannot ask for a second confirmation');

    await new Promise((resolve) => setTimeout(resolve, 740));
    assert.match(el.querySelector('[data-bind="rvl-title"]').textContent, /PACK 3\/3/,
      'the batch advances from that receipt without another player click');

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('multi-pack fast path gives the top wrapper a large staged rip before dealing', () => {
    assert.match(
      APP_CSS,
      /\.rvl-auto-pack-rip__pack\.rvl-pack\s*\{[^}]*width:\s*clamp\(5\.2rem, 18vw, 6\.25rem\);[^}]*height:\s*clamp\(7rem, 24vw, 8\.4rem\)/s,
      'the inline wrapper is a readable pack rather than a thumbnail',
    );
    assert.match(APP_CSS, /@keyframes rvl-inline-pack-rays/,
      'the rip has a radial release beat');
    assert.match(APP_CSS, /@keyframes rvl-inline-pack-spark/,
      'the tear has a traveling hot edge');
    assert.match(REVEAL_SRC, /if \(inlineAutoPack && !reduced\)[\s\S]*?await this\.#wait\(420\)/,
      'the first ticket waits until the enlarged wrapper begins tearing');
    assert.match(
      REVEAL_SRC,
      /if \(queued\) paper\.classList\?\.add\('rvl-paper--queued'\);\s*grid\.appendChild\(paper\)/,
      'whole tickets enter the DOM concealed instead of flashing as a complete hand',
    );
    assert.match(
      REVEAL_SRC,
      /if \(queued\) paper\.classList\?\.add\('rvl-paper--queued'\);\s*clusterGrid\.appendChild\(paper\)/,
      'loose ticket entries also enter the DOM concealed',
    );
    assert.match(
      REVEAL_SRC,
      /const reduced = _reducedMotion\(\);[\s\S]*?this\.#appendTicketGridPieces\(seq, grid, \{[\s\S]*?queued: !reduced,[\s\S]*?\}\);[\s\S]*?if \(inlineAutoPack && !reduced\)/,
      'the deal state is set before the inline wrapper delay begins',
    );
  });

  test('OPEN ALL keeps the next ticket hand concealed during its inline wrapper beat', async (t) => {
    const previousMatchMedia = window.matchMedia;
    t.after(() => { window.matchMedia = previousMatchMedia; });

    const el = instantiate();
    const ticket = (n) => ({ traitIds: [n, 70, 130, 200] });
    for (let packIndex = 1; packIndex <= 3; packIndex += 1) {
      queueReveal({
        kind: 'pack', title: 'YOUR TICKETS', level: 7, count: 2,
        totalCount: 6, batchId: 'batch-no-hand-flash', packIndex, packCount: 3,
        tickets: [ticket(packIndex * 2 - 1), ticket(packIndex * 2)],
      });
    }
    await tick();

    // The first hand used the suite's reduced-motion default. Turn motion on
    // before OPEN ALL advances so the second hand enters the 420ms rip beat.
    window.matchMedia = () => ({ matches: false });
    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    zone.querySelector('.rvl-open-all-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    assert.ok(zone.querySelector('.rvl-auto-pack-rip'),
      'the next wrapper is still tearing when the hand has been reserved');
    const papers = zone.querySelectorAll('.rvl-paper');
    assert.equal(papers.length, 2);
    assert.ok(papers.every((paper) => paper.classList.contains('rvl-paper--queued')),
      'no ticket can paint before its individual deal begins');

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('OPEN ALL PACKS keeps a foil pack after every ordinary pack', async () => {
    const el = instantiate();
    const ticket = (n, foil = false) => ({ traitIds: [n, 70, 130, 200], foil });
    let pendingRuns = 0;
    pendingActionsMod.publishPendingActions('foil-last-next-pack', [{
      id: 'ticket-pack:8', kind: 'tickets', ticketLevel: 8, foilPack: false,
      label: 'Level 8 ticket pack', state: 'ready', run: async () => {
        pendingRuns += 1;
        pendingActionsMod.clearPendingActions('foil-last-next-pack');
        queueReveal({
          kind: 'pack', title: 'LEVEL 8 TICKETS', level: 8, count: 1,
          batchId: 'ordinary-pending', packIndex: 1, packCount: 1,
          tickets: [ticket(3)],
        });
      },
    }]);
    queueReveal({
      kind: 'pack', title: 'LEVEL 7 TICKETS', level: 7, count: 1,
      batchId: 'foil-last-batch', packIndex: 1, packCount: 2,
      tickets: [ticket(1)],
    });
    queueReveal({
      kind: 'pack', title: 'FOIL PACK · LEVEL 7', level: 7, count: 1, foilPack: true,
      batchId: 'foil-last-batch', packIndex: 2, packCount: 2,
      tickets: [ticket(2, true)],
    });
    await tick();

    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    const openAll = zone.querySelector('.rvl-open-all-cta');
    assert.equal(openAll.textContent, 'OPEN ALL PACKS');
    openAll.dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await tick();

    assert.equal(pendingRuns, 1, 'the ordinary Pending pack was pulled ahead of queued foil');
    assert.match(el.querySelector('[data-bind="rvl-title"]').textContent, /FOIL PACK/,
      'the foil hand is the final readable hand in the combined opening');
    assert.equal(zone.querySelector('.rvl-collect-cta').textContent, 'GOOD LUCK');

    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
  });

  test('OPEN ALL PACKS continues into every ready ticket pack in Pending', async () => {
    const el = instantiate();
    const ticket = (n) => ({ traitIds: [n, 70, 130, 200] });
    let pendingRuns = 0;
    pendingActionsMod.publishPendingActions('next-pack', [{
      id: 'ticket-pack:9', kind: 'tickets', ticketLevel: 9,
      label: 'Level 9 ticket pack', shortLabel: 'Open tickets',
      state: 'ready', order: 10, chronology: 9,
      run: async () => {
        pendingRuns += 1;
        pendingActionsMod.clearPendingActions('next-pack');
        queueReveal({
          kind: 'pack', title: 'LEVEL 9 TICKETS', level: 9, count: 1,
          batchId: 'pending-level-9', packIndex: 1, packCount: 1,
          tickets: [ticket(9)],
        });
      },
    }]);
    for (let packIndex = 1; packIndex <= 2; packIndex += 1) {
      queueReveal({
        kind: 'pack', title: 'LEVEL 7 TICKETS', level: 7, count: 1,
        batchId: 'current-level-7', packIndex, packCount: 2,
        tickets: [ticket(packIndex)],
      });
    }
    await tick();

    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    const openAll = zone.querySelector('.rvl-open-all-cta');
    assert.equal(openAll.textContent, 'OPEN ALL PACKS',
      'the control makes its cross-Pending scope explicit');
    openAll.dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 520));
    await tick();

    assert.equal(pendingRuns, 1, 'the next ready Pending pack was materialized once');
    assert.match(el.querySelector('[data-bind="rvl-title"]').textContent, /LEVEL 9 TICKETS/);
    assert.equal(zone.querySelector('.rvl-collect-cta').textContent, 'GOOD LUCK',
      'OPEN ALL pauses on the final Pending pack');

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

  test('fullscreen CLEAR PENDING drops the reveal queue and hard-dismisses current reminders', async () => {
    let ownerClears = 0;
    pendingActionsMod.publishPendingActions('boxes', [{
      id: 'lootbox:77', kind: 'lootbox', label: 'Luckbox #77', state: 'ready',
      run: async () => {},
      clearAll: async () => { ownerClears += 1; },
    }]);
    const el = instantiate();
    queueReveal({ kind: 'pack', count: 1, level: 7, pending: true });
    queueReveal({ kind: 'pack', count: 2, level: 8, pending: true });
    await tick();

    const clear = el.querySelector('[data-bind="rvl-clear-pending"]');
    assert.ok(clear, 'fullscreen clear control is mounted beside close');
    assert.match(el.innerHTML, />CLEAR PENDING<\/button>/);
    assert.match(APP_CSS, /\.rvl-corner-actions\s*\{[^}]*display:\s*flex/s,
      'clear and close share one top-right control group');
    clear.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true,
      'active and queued fullscreen reveals are dropped');
    assert.equal(ownerClears, 1);

    pendingActionsMod.publishPendingActions('boxes', [{
      id: 'lootbox:77', kind: 'lootbox', label: 'Same indexed box', state: 'ready',
      run: async () => {},
    }]);
    assert.deepEqual(pendingActionsMod.getPendingActions(), [],
      'a routine publisher refresh cannot bring the cleared reminder back');
  });

  test('primary reveal controls occupy one raised target without an empty socket', () => {
    assert.doesNotMatch(APP_CSS, /\.rvl-stage::after\s*\{/,
      'no pseudo-button remains when there is nothing to click');
    assert.match(APP_CSS,
      /--rvl-action-bottom:\s*max\([\s\S]*?clamp\(4\.25rem, 13dvh, 7\.5rem\)/s,
      'the repeatable action target sits above the viewport floor');
    assert.match(APP_CSS,
      /\.rvl-summary > \.rvl-collect-cta,[\s\S]*?\.rvl-foil-match__continue\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*calc\(var\(--rvl-action-bottom\) \+ 0\.28rem\)[^}]*left:\s*50%/s,
      'summary and explicit comparison advances share one coordinate');
    assert.match(APP_CSS,
      /\.rvl-ticket-actions,[\s\S]*?\.rvl-dgn-actions,[\s\S]*?\.rvl-vessel-pack-actions\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*calc\(var\(--rvl-action-bottom\) \+ 0\.28rem\)/s,
      'pack and standalone reel primary-action rows stay on the same dock');
    assert.match(APP_CSS,
      /\.rvl-dgn-actions:is\([^}]*rvl-dgn-actions--box[^}]*\)[^{]*\{[^}]*width:\s*min\(15rem/s,
      'single-action reel states keep a button-sized control instead of stretching fullscreen');
    assert.match(APP_CSS,
      /\.rvl-dgn-actions\.rvl-dgn-actions--box\s*\{[^}]*position:\s*static;[^}]*order:\s*100;[^}]*margin:\s*0\.28rem auto 0;[^}]*translate:\s*none;/s,
      'Box Spin controls stay after the live board and survival result instead of covering them');
    assert.match(APP_CSS,
      /\.rvl-stage\.rvl-stage--degenerette:has\(\.rvl-dgn-actions--box:not\(\[hidden\]\)\)\s*\{[^}]*padding-bottom:\s*max\(0\.8rem, env\(safe-area-inset-bottom\)\)/s,
      'an in-flow Box Spin control does not retain the fixed-dock spacer');
    assert.match(APP_CSS,
      /\.rvl-ticket-actions\s*\{[^}]*z-index:\s*12;[^}]*pointer-events:\s*auto;/s,
      'the final pack action rail remains the top interactive layer');
    assert.match(APP_CSS,
      /\.rvl-ticket-actions[^}]*>[^}]*button[^}]*\{[^}]*pointer-events:\s*auto;[^}]*touch-action:\s*manipulation;/s,
      'the final pack continuation and history buttons retain direct touch targets');
    assert.match(APP_CSS,
      /\.rvl-ticket-pack-stage--inline-rip \.rvl-ticket-grid-stage--size-9\s*\{[^}]*53dvh[^}]*align-self:\s*start/s,
      'the taller final OPEN ALL hand leaves the fixed continuation rail unobscured');
    assert.doesNotMatch(REVEAL_SRC, /rvl-dgn-result-details|rvl-dgn-facts--result/,
      'Degenerette ends at its primary action instead of repeating stats below it');
  });

  test('jackpot win summary offers SHARE YOUR WIN; pack summary does not', async () => {
    const el = instantiate();
    queueReveal({
      kind: 'jackpot', day: 15,
      prizes: [{ type: 'eth', amount: 169447412695n }],
    });
    await tick();
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    const share = summary.querySelector('.rvl-share-cta');
    assert.ok(share, 'share button rendered for a jackpot win');
    assert.equal(share.textContent, 'SHARE YOUR WIN');
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
    assert.equal(summary.querySelector('.rvl-collect-cta').textContent, 'UNLUCKY');
    assert.ok(summary.querySelector('.rvl-collect-cta').classList
      .contains('rvl-collect-cta--unlucky'));
    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
  });

  test('a flip loss folds +1 WWXRP into its card and still ends UNLUCKY', async () => {
    const el = instantiate();
    queueReveal({
      kind: 'jackpot',
      day: 9,
      prizes: [{ type: 'wwxrp', amount: 10n ** 18n }],
      activity: {
        hasCoinflipBet: true,
        coinflipWon: false,
        coinflipStakeAmount: String(1_647_630n * 10n ** 18n),
      },
    });
    await tick();
    // Reduced-motion tests arrive directly at the single combined receipt.
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.querySelectorAll('.rvl-card').length, 1);
    assert.equal(summary.querySelector('.rvl-card-label')?.textContent, 'COINFLIP LOSS');
    assert.equal(summary.querySelector('.rvl-card-coinflip-outcome'), null,
      'LOSS is folded into the label instead of repeated beside the consolation');
    const consolation = summary.querySelector('.rvl-card-coinflip-consolation');
    const value = summary.querySelector('.rvl-card-value');
    const inner = summary.querySelector('.rvl-card-inner');
    assert.equal(consolation?.textContent, '+1 WWXRP');
    assert.equal(value?.textContent, '-1,647,630 FLIP');
    assert.equal(value?.classList.contains('rvl-card-value--long'), true,
      'a seven-digit loss uses the fitted single-line value treatment');
    assert.match(APP_CSS,
      /\.rvl-stage--day-summary \.rvl-card--coinflip-result \.rvl-card-value--long\s*\{[^}]*font-size:\s*clamp\(1rem, 2\.2vw, 1\.35rem\)[^}]*white-space:\s*nowrap/s,
      'long coinflip totals shrink responsively instead of clipping or wrapping');
    assert.equal(consolation?.querySelector('img'), null,
      'the text amount does not repeat the WWXRP logo');
    assert.ok(inner.children.indexOf(consolation) < inner.children.indexOf(value),
      'the WWXRP amount sits above the lost FLIP amount');
    assert.match(APP_CSS,
      /\.rvl-stage--day-summary \.rvl-card--coinflip-result \.rvl-card-coinflip-consolation\s*\{[^}]*font-size:\s*clamp\(1\.35rem, 2\.6vw, 1\.72rem\)/s,
      'the WWXRP line uses the same summary font size as the FLIP value');
    const collect = summary.querySelector('.rvl-collect-cta');
    assert.equal(collect.textContent, 'UNLUCKY');
    assert.ok(collect.classList.contains('rvl-collect-cta--unlucky'));
    collect.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a one-item consolation summary renders once with the neutral WWXRP UNLUCKY action', async () => {
    const el = instantiate();
    queueReveal({
      kind: 'jackpot', day: 9, consolationOnly: true,
      prizes: [{ type: 'wwxrp', amount: 10n ** 18n }],
    });
    await tick();
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.hidden, false);
    assert.equal(summary.querySelectorAll('.rvl-card').length, 1,
      'the only result is not dealt once and then repeated in a second phase');
    const collect = summary.querySelector('.rvl-collect-cta');
    assert.equal(collect.textContent, 'UNLUCKY');
    assert.ok(collect.classList.contains('rvl-collect-cta--unlucky'));
    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();
  });

  test('motion Day Summary takes minor receipts straight to the combined grid', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    queueReveal({
      kind: 'jackpot', day: 9,
      prizes: [{ type: 'tickets', amount: 2, level: 10 }],
      activity: {
        hasCoinflipBet: true,
        coinflipWon: false,
        coinflipStakeAmount: String(250n * 10n ** 18n),
      },
    });
    const el = instantiate();
    await tick();

    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();

    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.hidden, false);
    assert.deepEqual(
      summary.querySelectorAll('.rvl-card').map((card) => (
        String(card.className).includes('rvl-card--tickets') ? 'tickets' : 'coinflip-result'
      )),
      ['tickets', 'coinflip-result'],
      'the two tickets and coinflip loss arrive together on the final receipt',
    );
    assert.equal(el.querySelector('[data-bind="rvl-card-zone"]').hidden, true,
      'neither minor row entered the full-size individual card lane');

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('motion Day Summary deals only its big win before retaining every card in the grid', async (t) => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    t.after(() => { window.matchMedia = previousMatchMedia; });

    queueReveal({
      kind: 'jackpot', day: 9,
      prizes: [
        { type: 'eth', amount: 5n * 10n ** 15n },
        { type: 'tickets', amount: 2, level: 10 },
      ],
    });
    const el = instantiate();
    await tick();

    el.querySelector('[data-bind="rvl-backdrop"]').dispatchEvent({ type: 'click' });
    await tick();

    const zone = el.querySelector('[data-bind="rvl-card-zone"]');
    assert.equal(zone.hidden, false);
    assert.ok(zone.querySelector('.rvl-card--eth'), 'the epic ETH win receives the solo card beat');
    assert.equal(zone.querySelector('.rvl-card--tickets'), null,
      'the two-ticket row waits for the final combined grid');
    assert.equal(el.querySelector('[data-bind="rvl-summary"]').hidden, true);

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
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
      lootboxEth: 5n * 10n ** 15n,
      spins: [
        { spinIndex: 0, playerTraits: 13, houseTraits: 0x01020304, score: 4, payout: 2n * 10n ** 16n },
        { spinIndex: 1, playerTraits: 13, houseTraits: 0xA1B2C3D4, score: 0, payout: 0n },
      ],
    }), true);
    const el = instantiate();
    await tick();
    const zone = el.querySelector('[data-bind="rvl-spin-zone"]');
    assert.equal(zone.hidden, false, 'board visible on the reduced-motion path');
    assert.equal(zone.querySelectorAll('.rvl-gamepiece').length, 2,
      'the large player/house presentation is retained');
    const hero = zone.querySelectorAll('.rvl-gamepiece')[0].querySelector('.rvl-rq--hero');
    assert.equal(hero.getAttribute('data-trait-color'), 'pink');
    assert.equal(hero.style['--dgn-trait-color'], '#f409cd',
      'the reveal Hero burst uses its own badge color');
    assert.equal(zone.querySelectorAll('.rvl-ticket--rolling-full').length, 0,
      'no rolling shimmer is left running');
    const history = zone.querySelectorAll('.rvl-dgn-history-chip');
    assert.equal(history.length, 2, 'the compact result trail keeps one chip per spin');
    assert.match(history[0].textContent, /S 4/);
    assert.match(history[0].textContent, /\+/, 'the paid chip keeps its payout');
    assert.match(history[1].textContent, /MISS/, 'the unpaid chip remains explicit');
    assert.ok(history[1].classList.contains('is-selected'),
      'the final reel starts selected after the settled board opens');
    const lastHouseImages = zone.querySelectorAll('.rvl-gamepiece')[1]
      .querySelectorAll('img').map((img) => img.src);
    history[0].dispatchEvent({ type: 'click', stopPropagation() {} });
    const firstHouseImages = zone.querySelectorAll('.rvl-gamepiece')[1]
      .querySelectorAll('img').map((img) => img.src);
    assert.ok(history[0].classList.contains('is-selected'),
      'clicking a result chip selects that reel');
    assert.equal(history[1].classList.contains('is-selected'), false);
    assert.notDeepEqual(firstHouseImages, lastHouseImages,
      'the large ticket graphics switch to the clicked result');
    // Nothing to count up on this path, so the tracker shows the settled total.
    const running = zone.querySelector('.is-running');
    assert.ok(running, 'winnings tracker is present in the top facts');
    assert.doesNotMatch(running.textContent, /ACTUAL ETH|LUCKBOX ETH/,
      'the split does not add a second tier of miniature labels');
    assert.match(running.textContent, /ETH.*ETH LUCKBOX/,
      'the two regular value lines state cash first and lootbox ETH second');
    const ethValues = running.querySelectorAll('.rvl-dgn-eth-split__value');
    assert.equal(ethValues.length, 2, 'gross ETH is presented as two explicit destinations');
    assert.match(ethValues[0].textContent, /^15,?000 ETH$/,
      'Base Sepolia presentation scaling is applied to the actual-ETH share');
    assert.match(ethValues[1].textContent, /^5,?000 ETH LUCKBOX$/,
      'Base Sepolia presentation scaling is applied to the lootbox-ETH share');
    assert.ok(ethValues[0].classList.contains('is-win'), 'claimable ETH lights independently');
    assert.ok(ethValues[1].classList.contains('is-win'), 'lootbox ETH lights independently');
    const finalTotal = zone.querySelector('.rvl-spin-total');
    assert.ok(finalTotal.classList.contains('rvl-spin-total--eth-split'),
      'the bottom receipt does not recombine the two ETH destinations');
    assert.match(finalTotal.querySelector('.rvl-spin-total__cash').textContent,
      /^15,?000 ETH WON$/);
    assert.match(finalTotal.querySelector('.rvl-spin-total__lootbox').textContent,
      /^5,?000 ETH LUCKBOX$/);
    assert.doesNotMatch(finalTotal.textContent, /20,?000 ETH WON/,
      'gross ETH is never mislabeled as immediately won ETH');
    const betFacts = zone.querySelector('.rvl-dgn-facts--bet').textContent;
    assert.match(betFacts, /BET \/ SPIN/);
    assert.match(betFacts, /WINNINGS/);
    assert.doesNotMatch(betFacts, /CUM\./);
    assert.doesNotMatch(betFacts, /HERO/,
      'Hero is marked on the submitted ticket instead of consuming a top fact');
    assert.equal(zone.querySelector('.rvl-dgn-result-details'), null,
      'nothing repeats the settled result below the terminal action');
    const cta = zone.querySelector('.rvl-dgn-spin-cta');
    assert.equal(cta.textContent, 'TAKE THE WIN');
    const back = zone.querySelector('.rvl-dgn-skip-cta');
    assert.equal(back.hidden, true,
      'the obsolete skip shortcut does not become a second terminal action');
    assert.ok(zone.querySelector('.rvl-dgn-actions')
      .classList.contains('rvl-dgn-actions--result-ready'),
    'the final primary action owns a centered one-button rail');
    assert.deepEqual(
      zone.querySelector('.rvl-dgn-actions').children
        .filter((button) => !button.hidden)
        .map((button) => button.textContent),
      ['TAKE THE WIN'],
      'only one terminal button remains visible after a natural finish',
    );
    cta.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('zero lootbox ETH does not create a second winnings line', async () => {
    queueReveal({
      kind: 'degenerette', currency: 0, heroIdx: 1,
      amountPerSpin: 10n ** 16n, totalWager: 10n ** 16n,
      totalPayout: 2n * 10n ** 16n, lootboxEth: 0n,
      spins: [{
        spinIndex: 0, playerTraits: 13, houseTraits: 0x01020304,
        score: 4, payout: 2n * 10n ** 16n,
      }],
    });
    const el = instantiate();
    await tick();

    const running = el.querySelector('[data-bind="rvl-spin-zone"]').querySelector('.is-running');
    const values = running.querySelectorAll('.rvl-dgn-eth-split__value');
    assert.equal(values.length, 1, 'the lootbox destination is absent until it is positive');
    assert.doesNotMatch(running.textContent, /ETH LUCKBOX/);
    const finalTotal = el.querySelector('.rvl-spin-total');
    assert.equal(finalTotal.classList.contains('rvl-spin-total--eth-split'), false,
      'ordinary ETH-only results keep the compact single total');
    assert.match(finalTotal.textContent, /^20,?000 ETH WON$/);
  });

  test('a Degenerette box win is named on the result and opens directly from its final button', async () => {
    let duplicateRuns = 0;
    pendingActionsMod.publishPendingActions('lootboxes', [{
      id: 'lootbox:tx:0xdegbox',
      kind: 'lootbox',
      label: 'Degenerette lootbox result',
      state: 'ready',
      run: async () => { duplicateRuns += 1; },
    }]);
    queueReveal({
      kind: 'degenerette',
      currency: 0,
      lootboxAwarded: true,
      totalPayout: 5n * 10n ** 16n,
      spins: [
        { spinIndex: 0, playerTraits: 13, houseTraits: 13, score: 5, payout: 5n * 10n ** 16n },
      ],
    });
    queueReveal({
      kind: 'lootbox', title: 'DEGENERETTE LUCKBOX',
      legs: [{ legType: 'dgnrs', amount: 7n * 10n ** 18n }],
      lootboxRelease: {
        address: '0x0000000000000000000000000000000000000001',
        key: 'tx:0xdegbox',
        lootboxIndex: 0,
        transactionHash: '0xdegbox',
      },
    });
    const el = instantiate();
    await tick();

    const zone = el.querySelector('[data-bind="rvl-spin-zone"]');
    assert.equal(zone.querySelector('.rvl-dgn-result-details'), null,
      'the won Luckbox is not repeated in a second stats section');
    const cta = zone.querySelector('.rvl-dgn-spin-cta');
    assert.equal(cta.textContent, 'OPEN LUCKBOX');
    cta.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    assert.equal(el.querySelector('[data-bind="rvl-summary"]').hidden, false,
      'reduced motion skips the chest and advances straight into the settled box contents');
    assert.match(el.querySelector('[data-bind="rvl-summary"]').textContent, /DGNRS/);
    const collect = el.querySelector('[data-bind="rvl-summary"]').querySelector('.rvl-collect-cta');
    assert.equal(collect.textContent, 'GOOD LUCK',
      'the tray copy of this exact settled box is not offered as a second open');
    collect.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(duplicateRuns, 0, 'the duplicate pending action never runs');
    assert.equal(queueReveal({
      kind: 'lootbox', title: 'DEGENERETTE LUCKBOX',
      legs: [{ legType: 'dgnrs', amount: 7n * 10n ** 18n }],
      lootboxRelease: {
        address: '0x0000000000000000000000000000000000000001',
        key: 'tx:0xdegbox',
        lootboxIndex: 0,
        transactionHash: '0xdegbox',
      },
    }), false, 'an indexer refresh after collection cannot reopen the settled box');
  });

  test('a settled ETH Degenerette loss has one UNLUCKY action and no Back to Game', async () => {
    queueReveal({
      kind: 'degenerette', currency: 0,
      amountPerSpin: 10n ** 16n, totalWager: 10n ** 16n,
      totalPayout: 0n,
      spins: [{
        spinIndex: 0, playerTraits: 13, houseTraits: 99,
        score: 0, payout: 0n,
      }],
    });
    const el = instantiate();
    await tick();

    const cta = el.querySelector('.rvl-dgn-spin-cta');
    assert.equal(cta.textContent, 'UNLUCKY');
    assert.ok(cta.classList.contains('rvl-collect-cta--unlucky'),
      'the shared gray treatment lets the red WWXRP logo stand out');
    const actions = el.querySelector('.rvl-dgn-actions');
    assert.deepEqual(
      actions.children.filter((button) => !button.hidden).map((button) => button.textContent),
      ['UNLUCKY'],
      'the ETH loss cannot retain a second Back to Game exit',
    );
    assert.equal(el.querySelector('.rvl-dgn-skip-cta').hidden, true);
    cta.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a positive WWXRP Degenerette result has one Back to Game action', async () => {
    queueReveal({
      kind: 'degenerette', currency: 3,
      amountPerSpin: 10n ** 16n, totalWager: 10n ** 16n,
      totalPayout: 10n ** 16n,
      spins: [{
        spinIndex: 0, playerTraits: 13, houseTraits: 13,
        score: 2, payout: 10n ** 16n,
      }],
    });
    const el = instantiate();
    await tick();

    const total = el.querySelector('.rvl-spin-total');
    assert.match(total.textContent, /WWXRP/);
    const cta = el.querySelector('.rvl-dgn-spin-cta');
    assert.equal(cta.textContent, 'BACK TO GAME');
    assert.equal(cta.classList.contains('rvl-collect-cta--unlucky'), false,
      'a positive WWXRP result uses a neutral exit action');
    const extraExit = el.querySelector('.rvl-dgn-skip-cta');
    assert.equal(extraExit.hidden, true,
      'a WWXRP result never renders two Back to Game buttons');
    cta.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a pending GOOD LUCK continuation does not retain a Back to Game side button', async () => {
    pendingActionsMod.publishPendingActions('unnamed-next-action', [{
      id: 'next-reward', kind: 'reward', label: 'Next reward', state: 'ready',
      run: async () => {},
    }]);
    queueReveal({
      kind: 'degenerette', currency: 2,
      amountPerSpin: 10n ** 16n, totalWager: 10n ** 16n,
      totalPayout: 10n ** 16n,
      spins: [{
        spinIndex: 0, playerTraits: 13, houseTraits: 13,
        score: 2, payout: 10n ** 16n,
      }],
    });
    const el = instantiate();
    await tick();

    const actions = el.querySelector('.rvl-dgn-actions');
    assert.deepEqual(
      actions.children.filter((button) => !button.hidden).map((button) => button.textContent),
      ['GOOD LUCK'],
      'the continuation occupies the single terminal action slot',
    );
    assert.equal(el.querySelector('.rvl-dgn-skip-cta').hidden, true);

    el.querySelector('[data-bind="rvl-close"]')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a combined lootbox finishes its spins before presenting ordinary rewards', async () => {
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 77,
      legs: [
        {
          legType: 'opened',
          wholeTickets: 2,
          futureLevel: 63,
          flip: 25n * 10n ** 18n,
        },
        {
          legType: 'spin',
          spinType: 'wwxrp',
          payout: 2n * 10n ** 18n,
          reels: [{
            spinIndex: 0,
            playerTicket: 0xC3824100n,
            resultTicket: 0xC7864504n,
            score: 4,
          }],
        },
      ],
    });
    const el = instantiate();
    await tick();

    const summary = el.querySelector('[data-bind="rvl-summary"]');
    const spinZone = el.querySelector('[data-bind="rvl-spin-zone"]');
    assert.equal(summary.hidden, true,
      'tickets and FLIP remain withheld while the BoxSpin owns the reveal surface');
    assert.equal(spinZone.hidden, false, 'the spin is the first visible result phase');

    const spinDone = spinZone.querySelector('.rvl-dgn-spin-cta');
    assert.equal(spinDone.textContent, 'CONTINUE ▸',
      'the last spin leads into the unread ordinary rewards instead of exiting');
    spinDone.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    assert.equal(summary.hidden, false,
      'ordinary rewards receive their own readable receipt after every spin settles');
    assert.ok(summary.querySelector('.rvl-card--tickets'));
    assert.ok(summary.querySelector('.rvl-card--flip'));
    assert.equal(summary.querySelector('.rvl-card--spins'), null,
      'the already-played spin is not duplicated in the follow-up receipt');

    summary.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('reduced-motion BoxSpin settles the full reel without retaining a duplicate currency card', async () => {
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
    const grant = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(grant.hidden, false, 'the parent lootbox contents land first');
    assert.equal(grant.querySelector('.rvl-card-label').textContent, 'BOX SPIN');
    assert.equal(grant.querySelector('.rvl-card-value').textContent, '?');
    assert.doesNotMatch(grant.textContent, /ETH BOX SPIN|ETH SPIN|won .* ETH/i,
      'the granted spin cannot disclose its currency before it is played');
    const play = grant.querySelector('.rvl-collect-cta');
    assert.equal(play.textContent, 'PLAY SPIN');
    play.dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

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
    assert.ok(currency, 'the denomination still passes through its dedicated reveal beat');
    assert.ok(currency.classList.contains('is-revealed'));
    assert.ok(currency.classList.contains('is-leaving'));
    assert.equal(currency.hidden, true,
      'the completed currency beat collapses after updating the permanent board facts');
    assert.equal(currency.getAttribute('data-currency'), 'ETH');
    assert.equal(
      currency.querySelector('.rvl-box-currency-landed')?.src,
      '/shared/coinflip-face-eth.svg',
    );
    assert.match(currency.textContent, /CURRENCY FLIPETHCURRENCY REVEALED/);
    assert.match(zone.querySelector('.rvl-spin-head').textContent, /ETH BOX SPIN/,
      'the denomination remains in the compact heading after the large card leaves');
    assert.equal(zone.querySelector('.rvl-dgn-auto-cta'), null,
      'a mystery-currency spin never mounts AUTOSPIN');
    assert.equal(zone.querySelector('.rvl-dgn-skip-cta'), null,
      'a mystery-currency spin never mounts SKIP TO RESULTS');
    assert.deepEqual(
      zone.querySelector('.rvl-dgn-actions').children.map((node) => node.className),
      ['rvl-collect-cta rvl-dgn-spin-cta'],
      'the BoxSpin action rail contains only its required manual action',
    );
    assert.equal(zone.querySelector('.rvl-dgn-spin-cta').textContent, 'TAKE THE WIN');

    zone.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    const summary = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(summary.hidden, true,
      'the resolved spin does not return to a duplicate compact receipt');
    assert.equal(rootStage.classList.contains('rvl-stage--degenerette'), false,
      'the full spin releases its temporary large-stage layout');
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true);
  });

  test('the live FLIP BoxSpin marks each selected reel with its own Hero', async () => {
    const oneFlip = 10n ** 18n;
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 32_404,
      legs: [{
        legType: 'spin',
        betId: 11_026_022_280_916_248_713n,
        spinType: 'flip',
        survived: true,
        payout: 170_100n * oneFlip,
        reels: [
          { spinIndex: 0, playerTicket: 4_203_172_354n, resultTicket: 4_136_200_202n, score: 2 },
          { spinIndex: 1, playerTicket: 3_835_317_537n, resultTicket: 3_380_768_558n, score: 2 },
          { spinIndex: 2, playerTicket: 3_968_814_117n, resultTicket: 3_937_362_177n, score: 2 },
        ],
      }],
    });
    const el = instantiate();
    await tick();

    el.querySelector('[data-bind="rvl-summary"]').querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    const zone = el.querySelector('[data-bind="rvl-spin-zone"]');
    const history = zone.querySelectorAll('.rvl-dgn-history-chip');
    const visibleHero = () => zone.querySelectorAll('.rvl-gamepiece')[0]
      .querySelectorAll('.rvl-rq')
      .findIndex((cell) => cell.classList.contains('rvl-rq--hero'));
    const visibleHeroes = [];
    for (const chip of history) {
      chip.dispatchEvent({ type: 'click', stopPropagation() {} });
      visibleHeroes.push(visibleHero());
    }
    assert.deepEqual(visibleHeroes, [0, 2, 2],
      'selecting each reel renders the contract-consistent per-reel Hero marker');
    assert.match(zone.querySelector('.rvl-spin-total').textContent, /170,100 FLIP/,
      'the verified group payout remains attached to the same three-reel board');

    zone.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('motion DAY SUMMARY omits a completed zero BoxSpin without replaying it', async () => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: false });
    try {
      localStorage.setItem(DEGENERETTE_PREFERENCES_KEY, JSON.stringify({
        version: 1,
        speed: 3,
        bets: {},
      }));
      const el = instantiate();
      queueReveal({
        kind: 'jackpot',
        day: 148,
        prizes: [{ type: 'flip', amount: 4_167n * 10n ** 18n }],
        activity: {
          lootboxResults: [{
            lootboxIndex: 42,
            legs: [{
              legType: 'spin',
              spinType: 'wwxrp',
              payout: 0n,
              reels: [{
                spinIndex: 0,
                playerTicket: 0xC3824100n,
                resultTicket: 0xC7864504n,
                score: 0,
              }],
            }],
          }],
        },
      });

      let done = null;
      for (let i = 0; i < 80 && !done; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const candidate = el.querySelector('[data-bind="rvl-summary"]')
          ?.querySelector('.rvl-collect-cta');
        if (candidate?.textContent === 'BACK TO GAME') done = candidate;
      }
      assert.ok(done, 'the Day Summary lands directly on its terminal receipt');
      const summary = el.querySelector('[data-bind="rvl-summary"]');
      assert.equal(summary.querySelectorAll('.rvl-card-label')
        .some((label) => label.textContent === 'WWXRP BOX SPIN'), false,
      'the zero-payout child is absent from the daily receipt');
      assert.equal(summary.querySelector('.rvl-collect-cta')?.textContent, 'BACK TO GAME');
      const tray = el.querySelector('[data-bind="rvl-tray"]');
      assert.equal(tray.children.length, 0,
        'day rewards do not create a second carry-forward presentation');
      assert.equal(el.querySelector('.rvl-dgn-stage'), null,
        'an already-consumed BoxSpin never mounts another reel board');

      done.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();
      assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true);
    } finally {
      window.matchMedia = previousMatchMedia;
    }
  });

  test('a successful survival flip settles on the green ETH face', async () => {
    const oneFlip = 10n ** 18n;
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 8,
      legs: [{
        legType: 'spin',
        spinType: 'flip',
        survived: true,
        payout: 900n * oneFlip,
        reels: [0, 1, 2].map((spinIndex) => ({
          spinIndex,
          playerTicket: 0xC3824100n + BigInt(spinIndex),
          resultTicket: 0xC7864504n + BigInt(spinIndex),
          score: [3, 1, 0][spinIndex],
        })),
      }],
    });
    const el = instantiate();
    await tick();

    const grant = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(grant.querySelector('.rvl-collect-cta').textContent, 'PLAY SPIN');
    grant.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    const survival = el.querySelector('.rvl-survival');
    assert.ok(survival?.classList.contains('is-win'));
    assert.equal(
      survival.querySelector('.rvl-survival-landed')?.src,
      '/shared/coinflip-face-eth.svg',
    );
    const animatedCoin = survival.querySelector('.rvl-survival-coin');
    assert.equal(animatedCoin?.hidden, true);
    assert.equal(animatedCoin?.style?.display, 'none',
      'the transformed red rotor is compositor-hidden before the static face appears');
    assert.match(REVEAL_SRC, /coin\.remove\?\.\(\);/,
      'a real browser also detaches the stale rotor from the settled result');
    assert.match(
      APP_CSS,
      /\.rvl-survival-coin\[hidden\]\s*\{\s*display:\s*none !important;/,
      'the hidden fallback also beats the rotor display rule',
    );
    assert.match(survival.textContent, /SURVIVED/);
    const history = el.querySelectorAll('.rvl-dgn-history-chip');
    assert.ok(history[0].classList.contains('is-win'));
    assert.match(history[0].textContent, /#1 · WIN · 450 FLIP/);
    assert.ok(history[1].classList.contains('is-miss'), 'S1 is visibly a miss, not a win');
    assert.match(history[1].textContent, /#2 · MISS · S 1/);
    const payoutMeter = el.querySelector('.rvl-box-payout-meter');
    assert.equal(payoutMeter.hidden, false);
    assert.match(payoutMeter.textContent, /REEL PAYOUT450 FLIPDOUBLE OR NOTHING · WIN 900 FLIP/);

    const collect = el.querySelector('.rvl-dgn-spin-cta');
    assert.equal(collect.textContent, 'TAKE THE WIN');
    collect
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
    assert.equal(el.querySelector('[data-bind="rvl-backdrop"]').hidden, true);
  });

  test('a survivor uses its emitted payout instead of a pre-flip estimate', async () => {
    const oneFlip = 10n ** 18n;
    queueReveal({
      kind: 'lootbox',
      amountWei: 310_000_000_000n,
      ticketPriceWei: 10_000_000_000n,
      legs: [{
        legType: 'spin', spinType: 'flip', survived: true,
        payout: 16_000n * oneFlip,
        reels: [
          { spinIndex: 0, playerTicket: 0xC3824100n, resultTicket: 0xC7864504n, score: 3 },
          { spinIndex: 1, playerTicket: 0xC3824101n, resultTicket: 0xC7864505n, score: 0 },
          { spinIndex: 2, playerTicket: 0xC3824102n, resultTicket: 0xC7864506n, score: 4 },
        ],
      }],
    });
    const el = instantiate();
    await tick();

    el.querySelector('[data-bind="rvl-summary"]')
      .querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    const payoutMeter = el.querySelector('.rvl-box-payout-meter');
    assert.match(
      payoutMeter.textContent,
      /REEL PAYOUT8,000 FLIPDOUBLE OR NOTHING · WIN 16,000 FLIP/,
      'the reels use the chain result instead of the combo estimate',
    );
    assert.doesNotMatch(payoutMeter.textContent, /WIN ≈16,000 FLIP/,
      'the emitted final payout is exact');

    el.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a busted record bounty starts as FLIP and keeps its reel stake in the result', async () => {
    const oneFlip = 10n ** 18n;
    queueReveal({
      kind: 'record-bounty',
      spin: {
        spinType: 'record',
        survived: false,
        payout: 0n,
        recordStake: 900n * oneFlip,
        activityScore: 305,
        reels: [
          { spinIndex: 0, playerTicket: 1n, resultTicket: 2n, score: 0 },
          {
            spinIndex: 1,
            playerTicket: 0x04030201n,
            resultTicket: 0x07060509n,
            score: 2,
          },
          { spinIndex: 2, playerTicket: 5n, resultTicket: 6n, score: 1 },
        ],
      },
    });
    const el = instantiate();
    await tick();

    const zone = el.querySelector('[data-bind="rvl-spin-zone"]');
    assert.match(zone.querySelector('.rvl-spin-head__title').textContent,
      /BIGGEST SPIN BOUNTY · 3 FLIP REELS/);
    assert.equal(zone.querySelector('.rvl-box-currency-reveal'), null,
      'the fixed-FLIP bounty never mounts a currency-flip interstitial');
    assert.match(zone.querySelector('.rvl-box-payout-meter').textContent,
      /REEL PAYOUT.*FLIP.*DOUBLE OR NOTHING/s);
    assert.match(zone.querySelector('.rvl-survival').textContent,
      /BUSTED.*1 PAYING REEL · \d[\d,.KM]* FLIP LOST/s);
    assert.doesNotMatch(zone.textContent, /CURRENCY FLIP/);

    zone.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a BoxSpin survival bust shows a result-independent reel-payout estimate', async () => {
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 9,
      amountWei: 1_000_000_000_000n,
      ticketPriceWei: 10_000_000_000n,
      legs: [{
        legType: 'spin',
        spinType: 'flip',
        survived: false,
        payout: 0n,
        reels: [
          {
            spinIndex: 0,
            playerTicket: 0xC3824100n,
            resultTicket: 0xC7864504n,
            score: 3,
          },
          {
            spinIndex: 1,
            playerTicket: 0xC3824101n,
            resultTicket: 0xC7864505n,
            score: 1,
          },
          {
            spinIndex: 2,
            playerTicket: 0xC3824102n,
            resultTicket: 0xC7864506n,
            score: 0,
          },
        ],
      }],
    });
    const el = instantiate();
    await tick();

    const grant = el.querySelector('[data-bind="rvl-summary"]');
    grant.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    const zone = el.querySelector('[data-bind="rvl-spin-zone"]');
    const payoutMeter = zone.querySelector('.rvl-box-payout-meter');
    const survival = zone.querySelector('.rvl-survival');
    assert.match(
      payoutMeter.textContent,
      /REEL PAYOUT≈[\d,.KM]+ FLIPDOUBLE OR NOTHING · WIN ≈[\d,.KM]+ FLIP/,
    );
    assert.match(
      survival.textContent,
      /BUSTED1 PAYING REEL · ≈[\d,.KM]+ FLIP LOST/,
    );
    assert.doesNotMatch(
      zone.textContent,
      /PAYOUT AT RISK|WIN LOCKED|REEL PAYOUT AT RISK|FINAL PAYOUT LOST/,
      'the estimate uses player-facing payout copy rather than an internal placeholder',
    );
    assert.doesNotMatch(REVEAL_SRC, /PAYOUT AT RISK|WIN LOCKED/,
      'the reported internal placeholders are absent from every BoxSpin path');

    zone.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('a BoxSpin survival bust keeps an explicit pre-survival payout exact', async () => {
    const oneFlip = 10n ** 18n;
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 10,
      legs: [{
        legType: 'spin',
        spinType: 'flip',
        survived: false,
        payout: 0n,
        preSurvivalPayout: 300n * oneFlip,
        reels: [
          {
            spinIndex: 0,
            playerTicket: 0xC3824100n,
            resultTicket: 0xC7864504n,
            score: 3,
          },
          {
            spinIndex: 1,
            playerTicket: 0xC3824101n,
            resultTicket: 0xC7864505n,
            score: 1,
          },
          {
            spinIndex: 2,
            playerTicket: 0xC3824102n,
            resultTicket: 0xC7864506n,
            score: 0,
          },
        ],
      }],
    });
    const el = instantiate();
    await tick();

    el.querySelector('[data-bind="rvl-summary"]').querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    const zone = el.querySelector('[data-bind="rvl-spin-zone"]');
    assert.match(
      zone.querySelector('.rvl-box-payout-meter').textContent,
      /REEL PAYOUT300 FLIPDOUBLE OR NOTHING · WIN 600 FLIP/,
    );
    assert.match(
      zone.querySelector('.rvl-survival').textContent,
      /BUSTED1 PAYING REEL · 300 FLIP LOST/,
    );

    zone.querySelector('.rvl-dgn-spin-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();
  });

  test('an all-miss FLIP BoxSpin settles as UNLUCKY without a survival section', async () => {
    queueReveal({
      kind: 'lootbox',
      lootboxIndex: 9,
      legs: [{
        legType: 'spin',
        spinType: 'flip',
        survived: false,
        payout: 0n,
        reels: [0, 1, 2].map((spinIndex) => ({
          spinIndex,
          playerTicket: 0xC3824100n + BigInt(spinIndex),
          resultTicket: 0xC7864504n + BigInt(spinIndex),
          score: 0,
        })),
      }],
    });
    const el = instantiate();
    await tick();

    const grant = el.querySelector('[data-bind="rvl-summary"]');
    assert.equal(grant.querySelector('.rvl-card-label').textContent, 'BOX SPIN');
    grant.querySelector('.rvl-collect-cta')
      .dispatchEvent({ type: 'click', stopPropagation() {} });
    await tick();

    assert.equal(el.querySelector('.rvl-survival'), null,
      'nothing about survival is rendered when no preliminary payout exists');
    assert.equal(el.querySelector('.rvl-spin-total').textContent, 'UNLUCKY');
  });

  test('a hit that loses its final FLIP shows the hit, survival bust, and zero settlement', async () => {
    const oneFlip = 10n ** 18n;
    queueReveal({
      kind: 'degenerette',
      currency: 1,
      totalPayout: 0n,
      amountPerSpin: (50_000n * oneFlip) - 4_194_304n,
      spins: [
        { spinIndex: 0, playerTraits: 13, houseTraits: 77, score: 0, payout: 0n },
        { spinIndex: 1, playerTraits: 13, houseTraits: 78, score: 0, payout: 0n },
        { spinIndex: 2, playerTraits: 13, houseTraits: 13, score: 3, payout: 272_965n * oneFlip },
        { spinIndex: 3, playerTraits: 13, houseTraits: 79, score: 0, payout: 0n },
      ],
    });
    const el = instantiate();
    await tick();
    const running = el.querySelector('.is-running')?.querySelector('.rvl-dgn-fact-value');
    assert.match(running.textContent, /^0(\.0+)? FLIP$/);
    assert.equal(running.classList.contains('is-win'), false);
    assert.match(el.querySelector('.rvl-dgn-facts--bet').textContent, /50,000 FLIP/,
      'legacy packed float dust renders as the amount the player entered');
    const rows = el.querySelectorAll('.rvl-dgn-history-chip');
    assert.equal(rows.length, 4, 'all four spins remain in the final result');
    assert.ok(rows.some((row) => /(?:^|\s)is-win(?:\s|$)/.test(row.className)),
      'the preliminary winning spin remains visible after the survival loss');
    const survival = el.querySelector('.rvl-survival');
    assert.ok(survival?.classList.contains('is-bust'));
    assert.match(survival.textContent, /BUSTED/);
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
    assert.match(
      APP_CSS,
      /\.rvl-dgn-history\s*\{[^}]*--rvl-dgn-history-row-height:\s*1\.2rem[^}]*max-height:\s*calc\(5 \* var\(--rvl-dgn-history-row-height\)/s,
      'live spin results grow to five rows before their own scrollbar appears',
    );
    assert.match(APP_CSS, /\.rvl-gamepiece-center img\s*\{[^}]*object-position:\s*50% 50%/,
      'the shared center flame is actually centered');
    assert.match(APP_CSS, /\.rvl-gamepiece \.rvl-rq img\s*\{[^}]*object-position:\s*50% 50%;[^}]*transform:\s*none/,
      'badge canvases stay geometrically centered inside their cells');
    assert.match(APP_CSS, /app-degenerette-panel \.dgn-ticket \.dgn-q\.q-hero img\s*\{\s*transform:\s*none/,
      'the compact builder keeps badge art centered without a vertical offset');
    assert.match(APP_CSS, /\.rvl-gamepiece-center\s*\{[^}]*z-index:\s*20/,
      'the center diamond owns a layer above clipped quadrant effects');
    assert.match(APP_CSS, /\.rvl-gamepiece-center\.is-win::before\s*\{\s*background:\s*#22c55e/,
      'settled win diamond stays fully opaque');
    assert.match(APP_CSS, /\.rvl-gamepiece-center\.is-miss::before\s*\{\s*background:\s*#d94c5d/,
      'settled miss diamond stays fully opaque');
    assert.match(
      APP_CSS,
      /\.rvl-gamepiece \.rvl-rq\.q-sym,[\s\S]*?\.rvl-gamepiece \.rvl-rq\.q-col\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px rgba\(126, 176, 255, 0\.78\)/s,
      'one-trait reveal matches have a coherent blue fill and edge',
    );
    assert.match(
      APP_CSS,
      /\.rvl-gamepiece \.rvl-rq--hero\.q-sym::before,[\s\S]*?\.rvl-rq--hero\.q-col::before\s*\{[^}]*background:\s*var\(--dgn-trait-color, #dbeafe\)/s,
      'a partial Hero match keeps its badge-colored spikes without reintroducing a warm halo',
    );
    assert.match(
      APP_CSS,
      /\.rvl-gamepiece \.rvl-rq\.q-lock-color-hit\s*\{[^}]*background:\s*rgba\(139, 92, 246, 0\.36\)[^}]*box-shadow:\s*inset 0 0 0 2px rgba\(167, 139, 250, 0\.82\)/s,
      'a matching locked color has its own provisional purple state',
    );
    assert.match(
      APP_CSS,
      /\.rvl-gamepiece \.rvl-rq\.q-lock-symbol-hit\s*\{[^}]*background:\s*rgba\(96, 160, 255, 0\.36\)[^}]*box-shadow:\s*inset 0 0 0 2px rgba\(126, 176, 255, 0\.78\)/s,
      'a matching locked symbol has a distinct scoring-blue state',
    );
    assert.match(
      REVEAL_SRC,
      /\? 'q-lock-color-hit' : 'q-lock-miss'[\s\S]*?\? 'q-lock-symbol-hit' : 'q-lock-miss'/s,
      'live frames apply component-specific match classes',
    );
    assert.match(
      APP_CSS,
      /\.rvl-gamepiece \.rvl-rq\.q-lock-miss\s*\{[^}]*background:\s*rgba\(251, 113, 133, 0\.17\)/s,
      'one locked miss keeps a lighter live-spin color',
    );
    assert.match(
      APP_CSS,
      /\.rvl-gamepiece \.rvl-rq\.q-miss\s*\{[^}]*background:\s*rgba\(225, 71, 91, 0\.34\)/s,
      'a fully locked miss settles to the deeper miss color',
    );
    assert.match(REVEAL_SRC, /ethFace:\s*'\/shared\/coinflip-face-eth\.svg'/,
      'Degenerette ETH results reuse the familiar green ETH coin');
    assert.doesNotMatch(REVEAL_SRC, /dgnEthBadge|crypto_06_ethereum_blue\.svg/,
      'the blue ticket-trait badge is not reused as an ETH result badge');
    assert.match(APP_CSS, /\.rvl-dgn-speed\s*\{[^}]*position:\s*absolute[^}]*right:\s*0/s,
      'the speed control stays tucked into the heading instead of adding resolver height');
    assert.match(APP_CSS, /\.rvl-dgn-eth-split\s*\{[^}]*flex-direction:\s*column/s,
      'actual and lootbox ETH use two compact normal-value lines');
    assert.doesNotMatch(APP_CSS, /\.rvl-dgn-eth-split__value\s*\{[^}]*font-size:/s,
      'both winnings lines inherit the same value font as the other fact boxes');
  });

  test('motion path offers the full token spin and keeps its complete result until acknowledged', async () => {
    const previousMatchMedia = window.matchMedia;
    const previousRaf = globalThis.requestAnimationFrame;
    window.matchMedia = () => ({ matches: false });
    globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
    try {
      localStorage.setItem(DEGENERETTE_PREFERENCES_KEY, JSON.stringify({
        version: 1,
        speed: 2.5,
        bets: { 0: '0.025', 1: '500', 3: '2' },
      }));
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
      const speed = el.querySelector('.rvl-dgn-speed');
      const speedRange = speed?.querySelector('input');
      assert.ok(speedRange, 'an inconspicuous resolver speed bar is available');
      assert.equal(speedRange.min, '0.5');
      assert.equal(speedRange.max, '3');
      assert.equal(speedRange.value, '2.5', 'the browser-local speed is restored');
      assert.equal(speed.querySelector('output').textContent, '2.5×');
      speedRange.value = '3';
      speedRange.dispatchEvent({ type: 'input', stopPropagation() {} });
      assert.equal(speed.querySelector('output').textContent, '3×');
      speedRange.dispatchEvent({ type: 'change', stopPropagation() {} });
      assert.equal(JSON.parse(localStorage.getItem(DEGENERETTE_PREFERENCES_KEY)).speed, 3,
        'changing the speed persists it without disturbing the wager preferences');
      assert.equal(stage.querySelectorAll('.rvl-gamepiece').length, 2,
        'player and house are full gamepieces');
      const cta = stage.querySelector('.rvl-dgn-spin-cta');
      const auto = stage.querySelector('.rvl-dgn-auto-cta');
      const skip = stage.querySelector('.rvl-dgn-skip-cta');
      assert.equal(stage.querySelector('.rvl-dgn-progress'), null);
      assert.equal(stage.querySelector('.rvl-dgn-status'), null);
      assert.equal(stage.querySelector('.rvl-dgn-hint'), null,
        'reel graphics and sound replace the play-by-play narration rows');
      assert.equal(cta.textContent, 'SPIN 1 OF 2');
      assert.equal(auto.textContent, 'AUTOSPIN');
      assert.equal(skip.textContent, 'SKIP TO RESULTS');
      assert.deepEqual(
        stage.querySelector('.rvl-dgn-actions').children.map((node) => node.className),
        ['rvl-dgn-auto-cta', 'rvl-collect-cta rvl-dgn-spin-cta', 'rvl-dgn-skip-cta'],
        'Autospin, Spin Next, and Skip occupy the left, middle, and right tracks',
      );
      assert.match(
        APP_CSS,
        /\.rvl-dgn-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s,
      );

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

      assert.equal(cta.hidden, true,
        'skip does not jump the pointer to a replacement terminal control');
      assert.equal(skip.hidden, false);
      assert.equal(skip.textContent, 'BACK TO GAME',
        'the shortcut becomes an honest exit once the verified result is up');
      assert.equal(skip.dataset.mode, 'exit');
      assert.ok(stage.querySelector('.rvl-dgn-actions')
        .classList.contains('rvl-dgn-actions--result-exit'));
      assert.equal(stage.querySelectorAll('.rvl-dgn-history-chip').length, 2,
        'skip keeps every spin in the result trail');
      assert.equal(stage.querySelectorAll('.rvl-rq').length, 8,
        'both displayed tickets retain all four quadrants');
      assert.doesNotMatch(
        el.querySelector('.is-running').querySelector('.rvl-dgn-fact-value').textContent,
        /Infinity|NaN/,
        'zero-duration skip total is assigned directly, never divided by zero',
      );
      assert.equal(stage.querySelector('.rvl-dgn-result-details'), null,
        'the result stops at BACK TO GAME without a duplicate section below it');
      assert.equal(el.querySelector('[data-bind="rvl-summary"]').hidden, true,
        'the large result never collapses into the old mini summary');

      skip.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();
      assert.equal(backdrop.hidden, true,
        'BACK TO GAME closes the persistent fullscreen result');
    } finally {
      window.matchMedia = previousMatchMedia;
      if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previousRaf;
    }
  });

  test('Degenerette hides SKIP TO RESULTS while AUTOSPIN is running', async () => {
    const previousMatchMedia = window.matchMedia;
    const previousRaf = globalThis.requestAnimationFrame;
    window.matchMedia = () => ({ matches: false });
    globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
    try {
      const el = instantiate();
      queueReveal({
        kind: 'degenerette',
        currency: 1,
        amountPerSpin: 50_000n * 10n ** 18n,
        totalWager: 100_000n * 10n ** 18n,
        totalPayout: 0n,
        spins: [
          { spinIndex: 0, playerTraits: 13, houseTraits: 77, score: 0, payout: 0n },
          { spinIndex: 1, playerTraits: 13, houseTraits: 77, score: 0, payout: 0n },
        ],
      });
      await tick();

      const backdrop = el.querySelector('[data-bind="rvl-backdrop"]');
      backdrop.dispatchEvent({ type: 'click' });
      await tick();

      const stage = el.querySelector('.rvl-dgn-stage');
      const auto = stage.querySelector('.rvl-dgn-auto-cta');
      const skip = stage.querySelector('.rvl-dgn-skip-cta');
      assert.equal(skip.hidden, false, 'manual resolution still offers the shortcut');

      auto.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();
      assert.equal(auto.textContent, 'STOP AUTO');
      assert.equal(skip.hidden, true, 'autospin owns the run without a redundant skip control');

      el.querySelector('[data-bind="rvl-close"]').dispatchEvent({
        type: 'click', stopPropagation() {},
      });
      await tick();
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
      localStorage.setItem(DEGENERETTE_PREFERENCES_KEY, JSON.stringify({ speed: 3 }));
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
      for (let i = 0; i < 20 && !stage; i++) {
        backdrop.dispatchEvent({ type: 'click' });
        await tick();
        stage = el.querySelector('.rvl-dgn-stage');
      }
      assert.ok(stage, 'the opened case hands directly to the full BoxSpin reel stage');
      const summary = el.querySelector('[data-bind="rvl-summary"]');
      assert.equal(summary.hidden, true, 'there is no intermediate BOX SPIN receipt');
      assert.doesNotMatch(summary.textContent, /PLAY SPIN/);
      const spinZone = el.querySelector('[data-bind="rvl-spin-zone"]');
      assert.ok(spinZone.classList.contains('rvl-spin-zone--lootbox-launch'),
        'the populated reel board flies out from the case opening');
      assert.equal(stage.querySelectorAll('.rvl-gamepiece').length, 2);
      assert.equal(stage.querySelectorAll('.rvl-rq').length, 8);
      assert.equal(stage.querySelector('.rvl-box-currency-reveal'), null,
        'currency has not appeared before the verified reel runs');
      assert.equal(stage.querySelector('.rvl-box-payout-meter')?.hidden, true,
        'no denominated payout leaks before the currency coin lands');
      const head = el.querySelector('.rvl-spin-head');
      assert.equal(head.textContent, 'LUCKBOX SPIN');
      assert.doesNotMatch(head.textContent, /ETH|FLIP|WWXRP/);

      const cta = stage.querySelector('.rvl-dgn-spin-cta');
      assert.equal(stage.querySelector('.rvl-dgn-auto-cta'), null,
        'BoxSpin does not expose AUTOSPIN');
      assert.equal(stage.querySelector('.rvl-dgn-skip-cta'), null,
        'BoxSpin does not expose SKIP TO RESULTS');
      assert.match(
        APP_CSS,
        /\.rvl-dgn-actions--box\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
        'the remaining manual control owns a centered one-column action rail',
      );
      assert.equal(cta.hidden, true,
        'opening the case has already started reel one without another click');

      let sealed = stage.querySelector('.rvl-box-currency-reveal');
      for (let i = 0; i < 100 && !sealed; i++) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        sealed = stage.querySelector('.rvl-box-currency-reveal');
      }
      assert.ok(sealed, 'the reveal beat begins only after the result has landed');
      assert.equal(sealed.classList.contains('is-revealed'), false,
        'the currency badge starts face-down');
      assert.equal(sealed.classList.contains('is-flipping'), true,
        'a real currency coin flip bridges reel one and the result');
      const currencyCoin = sealed.querySelector('.rvl-box-currency-coin');
      assert.equal(currencyCoin.style['--df-track-duration'], '550ms');
      assert.equal(currencyCoin.style['--df-ending-duration'], '117ms');
      await new Promise((resolve) => setTimeout(resolve, 1_300));

      const currency = stage.querySelector('.rvl-box-currency-reveal');
      assert.ok(currency.classList.contains('is-revealed'));
      assert.ok(currency.classList.contains('is-leaving'));
      assert.equal(currency.hidden, true,
        'the completed denomination card leaves once its facts are on the reel UI');
      assert.equal(currency.getAttribute('data-currency'), 'WWXRP');
      assert.match(currency.textContent, /WWXRP/);
      assert.match(head.textContent, /WWXRP BOX SPIN · 1 REEL/);
      const history = stage.querySelector('.rvl-dgn-history-chip');
      assert.ok(history.classList.contains('is-win'));
      assert.match(history.textContent, /#1 · WIN · 2 WWXRP/,
        'the first reel becomes an explicit denominated win only after currency reveal');
      const liveResult = stage.querySelector('.rvl-dgn-roll-pop');
      assert.match(liveResult.textContent, /WIN · 2 WWXRP/,
        'the live result bubble refreshes to the amount at the same reveal boundary');
      const payoutMeter = stage.querySelector('.rvl-box-payout-meter');
      assert.equal(payoutMeter.hidden, false);
      assert.match(payoutMeter.textContent, /PAYOUT2 WWXRPFINAL PAYOUT/);
      assert.match(stage.querySelector('.rvl-spin-total').textContent, /2 WWXRP · UNLUCKY/);
      assert.equal(cta.textContent, 'UNLUCKY',
        'WWXRP with no other Luckbox prize never becomes TAKE THE WIN');

      cta.dispatchEvent({ type: 'click', stopPropagation() {} });
      await tick();
      assert.equal(summary.hidden, true,
        'the acknowledged full result is not redrawn as the same compact spin');
      assert.equal(backdrop.hidden, true);
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
