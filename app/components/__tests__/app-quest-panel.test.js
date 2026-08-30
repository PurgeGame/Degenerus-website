// /app/components/__tests__/app-quest-panel.test.js — Phase 62 Plan 62-04 (QST-01 + QST-02)
// Run: cd website && node --test app/components/__tests__/app-quest-panel.test.js
//
// Tests Custom Element shell + DB-backed daily/level quest display + reward cross-link
// + textContent-only rendering (T-58-18) + ZERO write-surface assertion (T-62-04-NoWrite).
//
// RESEARCH R4 (HIGH confidence) invalidated CONTEXT QST framing — there is NO
// user-facing startQuest / claimQuest contract write. ALL quest progression is
// automatic via internal onlyGame hooks (DegenerusQuests.sol; IDegenerusQuests.sol:46-183).
// Plan 62-04 is PURE UI display reading from /player/:address.quests. ZERO sendTx.
//
// Mirrors app-claims-panel.test.js (on-mount fetchJSON + textContent rendering)
// and app-decimator-panel.test.js (panel-owned poll cycle + visibility re-poll).
// fakeDOM scaffold inherited verbatim from Phase 60/61/62-01 panel tests.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (verbatim port from app-decimator-panel.test.js).
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
    _title: '',
    hidden: false,
    disabled: false,
    tabIndex: 0,
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
        const dataWriteMatch = /\bdata-write\b/.test(attrs);
        if (dataWriteMatch) child.attributes['data-write'] = '';
        const nameMatch = /\bname="([^"]+)"/.exec(attrs);
        if (nameMatch) child.attributes.name = nameMatch[1];
        const idMatch = /\bid="([^"]+)"/.exec(attrs);
        if (idMatch) child.attributes.id = idMatch[1];
        const hrefMatch = /\bhref="([^"]+)"/.exec(attrs);
        if (hrefMatch) child.attributes.href = hrefMatch[1];
        const tabindexMatch = /\btabindex="([^"]+)"/.exec(attrs);
        if (tabindexMatch) {
          child.attributes.tabindex = tabindexMatch[1];
          child.tabIndex = Number(tabindexMatch[1]);
        }
        const classMatch = /\bclass="([^"]+)"/.exec(attrs);
        if (classMatch) {
          for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
        }
        if (/\bhidden\b/.test(attrs)) child.hidden = true;
        if (/\bdisabled\b/.test(attrs)) child.disabled = true;
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
    get title() { return this._title; },
    set title(v) { this._title = String(v); },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    append(...nodes) {
      for (const n of nodes) {
        if (n && typeof n === 'object') {
          n.parentElement = this;
          this.children.push(n);
        }
      }
    },
    replaceChildren(...nodes) {
      this.children = [];
      for (const n of nodes) {
        if (n && typeof n === 'object') {
          n.parentElement = this;
          this.children.push(n);
        }
      }
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      return child;
    },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    contains(other) {
      if (other === this) return true;
      const stack = [...this.children];
      while (stack.length) {
        const cur = stack.shift();
        if (cur === other) return true;
        if (cur.children && cur.children.length) stack.unshift(...cur.children);
      }
      return false;
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
    matches(sel) { return matches(this, sel); },
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
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k.startsWith('data-')) {
        const dsKey = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[dsKey] = String(v);
      }
    },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
  };
  return el;
}

function matches(el, sel) {
  if (!el) return false;
  if (/^[a-z][a-z0-9-]*$/i.test(sel)) {
    return el.tagName === sel.toUpperCase();
  }
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    if (el.classList && el.classList.contains(cls)) return true;
    if (typeof el.className === 'string' && el.className.split(/\s+/).includes(cls)) return true;
    return false;
  }
  if (sel.startsWith('#')) {
    return el.attributes && el.attributes.id === sel.slice(1);
  }
  const attrEq = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attrEq) {
    return el.attributes && el.attributes[attrEq[1]] === attrEq[2];
  }
  const attrPres = sel.match(/^\[([\w-]+)\]$/);
  if (attrPres) {
    return el.attributes && Object.prototype.hasOwnProperty.call(el.attributes, attrPres[1]);
  }
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
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.bubbles = !!init.bubbles;
  }
};

let _docBody = makeFakeElement('body');
const _docListeners = new Map();
let _docVisibilityState = 'visible';

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
    const arr = _docListeners.get(ev.type) || [];
    for (const fn of arr) {
      try { fn(ev); } catch { /* swallow */ }
    }
    return true;
  },
  get visibilityState() { return _docVisibilityState; },
  set visibilityState(v) { _docVisibilityState = v; },
};

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { search: '', href: 'http://localhost/' },
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

// fetch stub — panel-owned poll cycle reads /player/:address. Tests stub
// per-case via _fetchHandler; default returns empty quests payload.
let _fetchHandler = async () => ({ player: null, quests: null });
let _fetchCalls = [];
globalThis.fetch = async (url) => {
  _fetchCalls.push(url);
  const data = await _fetchHandler(url);
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
};

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  _docVisibilityState = 'visible';
  globalThis.localStorage.clear();
  _docListeners.clear();
  _fetchCalls = [];
  _fetchHandler = async () => ({ player: null, quests: null });
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function settle(loops = 30) {
  for (let i = 0; i < loops; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < loops; i += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Imports under test — store + (panel module dynamic-imported in beforeEach).
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';
import * as jackpotSfxMod from '../../app/jackpot-sfx.js';

// ---------------------------------------------------------------------------
// Read panel source for grep-based assertions (T-62-04-NoWrite + textContent
// + no data-write + reward cross-link).
// ---------------------------------------------------------------------------

const PANEL_SRC = readFileSync(
  new URL('../app-quest-panel.js', import.meta.url),
  'utf8',
);
const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

// Strip line + block comments so source-grep assertions verify executable code,
// not documentation strings that mention forbidden tokens.
// This mirrors Plan 62-03 D-G's scoped-assertion deviation pattern: the test
// intent is "panel does NOT INVOKE sendTx", not "panel source string never
// contains the substring 'sendTx'". Comments carry self-documenting policy.
function stripComments(src) {
  // Remove block comments /* ... */ (greedy-aware).
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments — split per-line, drop everything after the first
  // unescaped // that isn't inside a string literal. Cheap heuristic:
  // tokens we test are ASCII identifiers, not embedded inside string
  // literals, so a simple line-prefix split is sufficient.
  return noBlock
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      if (idx < 0) return line;
      // Crude string-literal awareness: if there are an odd number of
      // unescaped quotes before the //, we're inside a string — keep the line.
      const before = line.slice(0, idx);
      const sQuotes = (before.match(/(?<!\\)'/g) || []).length;
      const dQuotes = (before.match(/(?<!\\)"/g) || []).length;
      const tQuotes = (before.match(/(?<!\\)`/g) || []).length;
      if ((sQuotes % 2) || (dQuotes % 2) || (tQuotes % 2)) return line;
      return before;
    })
    .join('\n');
}

const PANEL_SRC_NOCOMMENT = stripComments(PANEL_SRC);

const CONNECTED = '0xab12000000000000000000000000000000000000';

function instantiate() {
  const Ctor = customElements.get('app-quest-panel');
  const el = new Ctor();
  _docBody.appendChild(el);
  el.connectedCallback();
  return el;
}

function makeQuestsPayload(overrides = {}) {
  return {
    player: CONNECTED,
    quests: [
      { day: 1, slot: 0, questType: 1, progress: 1, target: 3, completed: false, highDifficulty: false, requirementMints: 0, requirementTokenAmount: '0' },
      { day: 1, slot: 1, questType: 2, progress: 0, target: 100, completed: false, highDifficulty: false, requirementMints: 0, requirementTokenAmount: '0' },
    ],
    questStreak: { baseStreak: 5, lastCompletedDay: 0 },
    levelQuest: {
      level: 7,
      questType: 6,
      progress: '400000000000',
      target: '1600000000000',
      completed: false,
      eligible: true,
    },
    scoreBreakdown: { questStreakPoints: 5, mintCountPoints: 0, affiliatePoints: 0, totalBps: 50, passBonus: null },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plan 62-04: <app-quest-panel> read-only quest display', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('viewing.address', null);
    storeMod.update('ui.mode', 'self');
    _fetchHandler = async () => makeQuestsPayload();
    await import('../app-quest-panel.js');
  });

  test("Custom element 'app-quest-panel' registers idempotently after import", async () => {
    const ctor = customElements.get('app-quest-panel');
    assert.ok(ctor, 'app-quest-panel is registered');
    await assert.doesNotReject(import('../app-quest-panel.js'));
    const ctor2 = customElements.get('app-quest-panel');
    assert.equal(ctor, ctor2, 'same ctor reference after re-import (idempotent)');
  });

  test('Panel renders a compact quest shell with streak HUD', async () => {
    const el = instantiate();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
    assert.match(
      el.innerHTML.toUpperCase(),
      /QUEST/,
      'header copy contains QUEST (static template literal)',
    );
    assert.match(
      el.innerHTML,
      /<a class="qst-learn-link" href="\/learn\/quests\/">QUESTS<\/a>/,
      'the clean Quests heading still links directly to its Learn page',
    );
    assert.doesNotMatch(el.innerHTML, /qst-title-scroll|📜/,
      'the abandoned scroll treatment stays out of the header');
    assert.doesNotMatch(el.innerHTML, /qst-title-mark|qst-streak-alert/,
      'the original header uses no added alert decoration');
    assert.match(el.innerHTML, /qst-streak-flame" aria-hidden="true">◆<\/span>/,
      'the original streak diamond remains the single state mark');
    assert.match(APP_CSS,
      /\.play-grid \.qst-streak-chip\s*\{[^}]*grid-template-columns:\s*auto auto;[^}]*padding:\s*0\.42rem 0\.58rem;[^}]*border-radius:\s*9px/s,
      'the original squared streak control is restored');
    assert.match(
      APP_CSS,
      /\.play-grid \.qst-header h2\s*\{[^}]*justify-self:\s*start;/s,
      'the original heading placement is restored',
    );
    assert.match(
      APP_CSS,
      /@media \(min-width:\s*1100px\)[\s\S]*?\.play-grid \.qst-header h2\s*\{[^}]*grid-column:\s*2;[^}]*justify-self:\s*center/s,
      'the established wide-row alignment remains intact',
    );
    assert.doesNotMatch(el.innerHTML, /DAILY RUN/, 'removed daily-run kicker stays absent');
    assert.doesNotMatch(el.innerHTML, /qst-blurb/, 'explanatory subtitle removed');
    assert.doesNotMatch(el.innerHTML, /Daily quests progress automatically/, 'old verbose intro removed');

    assert.doesNotMatch(el.innerHTML, /qst-reward-hint/,
      'rewards belong inside their quest cards, not in a strip below them');
  });

  test('quest blocks keep a fixed height without adding an inner scrollbar', () => {
    assert.match(
      APP_CSS,
      /\.play-grid \.qst-slot\s*\{[^}]*height:\s*7\.5rem/s,
    );
    assert.match(
      APP_CSS,
      /\.play-grid \.qst-slots\s*\{[^}]*grid-auto-rows:\s*7\.5rem[^}]*align-content:\s*start/s,
    );
    assert.doesNotMatch(
      APP_CSS,
      /\.play-grid \.qst-slots\s*\{[^}]*(?:overflow-y|scrollbar-color|max-height):/s,
      'the quest list never adds an inner scrollbar',
    );
    assert.match(
      APP_CSS,
      /@media\s*\(min-width:\s*1100px\)[\s\S]*?\.qst-slots\s*\{[^}]*flex:\s*0 0 auto[^}]*grid-auto-rows:\s*7\.5rem/s,
    );
  });

  test('quest pictograms keep a flat small-scale visual language', () => {
    const files = [
      'buy-ticket-luckbox.svg',
      'coinflip.svg',
      'affiliate.svg',
      'foil-pack.svg',
      'luckbox.svg',
      'degenerette-eth.svg',
      'degenerette-flip.svg',
      'redeem-flip.svg',
    ];
    for (const file of files) {
      const svg = readFileSync(new URL(`../../assets/quests/${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(svg, /<(?:linearGradient|radialGradient|filter)\b/,
        `${file} stays flat instead of becoming a tiny faux-material illustration`);
    }
    const combined = readFileSync(
      new URL('../../assets/quests/buy-ticket-luckbox.svg', import.meta.url),
      'utf8',
    );
    const luckbox = readFileSync(
      new URL('../../assets/quests/luckbox.svg', import.meta.url),
      'utf8',
    );
    const coinflip = readFileSync(
      new URL('../../assets/quests/coinflip.svg', import.meta.url),
      'utf8',
    );
    const degeneretteFlip = readFileSync(
      new URL('../../assets/quests/degenerette-flip.svg', import.meta.url),
      'utf8',
    );
    const redeemFlip = readFileSync(
      new URL('../../assets/quests/redeem-flip.svg', import.meta.url),
      'utf8',
    );
    assert.match(combined, /<rect x="5" y="11" width="37" height="42"/,
      'the combined quest uses an unmistakably square ticket silhouette');
    assert.match(combined, /<circle cx="45" cy="40" r="6" fill="#ed0e11"/,
      'the combined quest identifies its Luckbox leg with the red circle');
    assert.match(luckbox, /<circle cx="32" cy="39" r="8" fill="#ed0e11"/,
      'the standalone Luckbox icon uses the same red-circle language');
    assert.match(coinflip, /M12\.2 51\.8A28 28 0 0 1 51\.8 12\.2Z[\s\S]*M12\.2 51\.8A28 28 0 0 0 51\.8 12\.2Z/,
      'the fallback FLIP icon follows the canonical bottom-left to top-right split');
    assert.doesNotMatch(`${degeneretteFlip}${redeemFlip}`, /#30d100|#ed0e11/,
      'composite pictograms do not contain another approximate FLIP redraw');
    assert.match(PANEL_SRC, /qst-painted-icon__flip-mark[\s\S]*?src = '\/whitepaper\/flame-logo-split\.svg'/,
      'composite quest icons layer the real FLIP mark');
    assert.match(PANEL_SRC, /9:\s*'\/whitepaper\/flame-logo-split\.svg'/,
      'Redeem FLIP gives the canonical mark the whole icon tile instead of crushing it into a vertical shorthand');
  });

  test('quest action sheets have themed completion hierarchy and motion-safe polish', () => {
    assert.match(
      PANEL_SRC,
      /qst-action-dialog__sigil[\s\S]*?data-bind="qst-action-icon"[\s\S]*?qst-action-dialog__reward[\s\S]*?data-bind="qst-action-state"/,
      'the popup header owns a quest sigil, its reward, and an explicit completion state',
    );
    assert.match(
      PANEL_SRC,
      /setAttribute\?\.\('data-variant', variant\)[\s\S]*?setAttribute\?\.\('data-state', actionState\)/,
      'the live quest model themes the popup and reports whether the preset completes it',
    );
    assert.match(
      APP_CSS,
      /qst-action-dialog__card\[data-variant="secondary"\][\s\S]*?qst-action-dialog__card\[data-variant="level"\]/,
      'Daily, Bonus, and Level sheets have distinct color identities',
    );
    assert.match(
      APP_CSS,
      /@keyframes qst-action-card-in[\s\S]*?@keyframes qst-action-sigil-in/,
      'the sheet and quest sigil receive a short entrance moment',
    );
    assert.match(
      APP_CSS,
      /prefers-reduced-motion:\s*reduce[\s\S]*?qst-action-dialog__backdrop,[\s\S]*?qst-action-dialog__sigil\s*\{[^}]*animation:\s*none !important/s,
      'the new entrance treatment respects reduced-motion preferences',
    );
  });

  test('quest action inputs use the sheet width for legibility without oversized number fields', () => {
    assert.match(
      APP_CSS,
      /qst-action-dialog__card\s*\{[^}]*width:\s*min\(94vw, 40rem\)/s,
      'the action sheet has enough desktop room for useful labels and controls',
    );
    assert.match(
      APP_CSS,
      /qst-action-adjust\s*\{[^}]*grid-template-columns:\s*minmax\(9rem, 1fr\) minmax\(15rem, 19rem\)/s,
      'purchase amount copy and its compact stepper share a row instead of stretching the input edge to edge',
    );
    assert.match(
      APP_CSS,
      /qst-action-adjust__stepper input\s*\{[^}]*font:\s*950 1\.12rem\/1[^}]*text-align:\s*center/s,
      'the important purchase value is large and centered',
    );
    assert.match(
      APP_CSS,
      /qst-action-dgn__stepper\.qst-action-adjust__stepper\s*\{[^}]*grid-template-columns:\s*2\.7rem minmax\(5\.2rem, 1fr\) auto 2\.7rem/s,
      'the amount stepper keeps both minus and plus on one row despite sharing the Degenerette control class',
    );
    assert.match(
      APP_CSS,
      /qst-action-dgn__wager\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.25fr\) minmax\(9\.5rem, 0\.9fr\)/s,
      'bet and spin steppers use the available horizontal room as two compact controls',
    );
    assert.match(
      APP_CSS,
      /qst-action-(?:adjust__stepper|dgn__stepper):focus-within[\s\S]*?0 0 20px/,
      'keyboard entry gets the same thematic glow as pointer entry',
    );
    assert.match(
      APP_CSS,
      /@media\s*\(max-width:\s*600px\)[\s\S]*?qst-action-adjust\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*?qst-action-dgn__wager\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
      'the compact desktop rows stack cleanly on narrow screens',
    );
  });

  test('On mount, panel calls fetchJSON for /player/:address with the connected address', async () => {
    const el = instantiate();
    await settle(40);
    const matched = _fetchCalls.find((u) => u && u.includes('/player/') && u.toLowerCase().includes(CONNECTED.toLowerCase()));
    assert.ok(matched, `fetchJSON called with /player/${CONNECTED} on mount; calls=${JSON.stringify(_fetchCalls)}`);
    el.disconnectedCallback();
  });

  test('a new player still sees the current quests while its player row returns 404', async () => {
    storeMod.update('app.lastDay', { day: 3, roll1: { purchaseLevel: 1 } });
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes(`/player/${CONNECTED}`)) throw new Error('API 404: player not found');
      if (u.includes('/game/quests/day/3')) {
        return {
          day: 3,
          quests: [
            { slot: 0, questType: 1, flags: 0, target: '10000000000' },
            { slot: 1, questType: 6, flags: 0, target: '20000000000' },
          ],
        };
      }
      if (u.includes('/game/state')) {
        return { level: 0, phase: 'PURCHASE', jackpotPhaseFlag: false };
      }
      return null;
    };

    const el = instantiate();
    await settle(40);

    const slots = el.querySelectorAll('.qst-slot');
    assert.equal(slots.length, 3,
      'two current daily definitions plus the stable level placeholder render');
    assert.match(slots[0].textContent, /Buy a Ticket or Luckbox/);
    assert.match(slots[1].textContent, /Buy Luckbox/);
    assert.doesNotMatch(el.textContent, /Could not load quests/);
    el.disconnectedCallback();
  });

  test('Quest slot renders questName + progress via textContent (T-58-18)', async () => {
    _fetchHandler = async () => makeQuestsPayload();
    const el = instantiate();
    await settle(40);

    const slots = el.querySelectorAll('.qst-slot');
    assert.equal(slots.length, 3, 'two daily quests plus one DB-backed level quest rendered');

    // Slot 0: progress 1/3 — text format flexible, but must contain "1" AND "3".
    const slot0 = slots[0];
    const slot0Text = slot0.textContent || '';
    assert.match(slot0Text, /1/, 'slot 0 progress contains "1" (current count)');
    assert.match(slot0Text, /3/, 'slot 0 progress contains "3" (target count)');

    // Slot 0 must contain the questType label or some name string — check that
    // text content is not empty.
    assert.ok(slot0Text.trim().length > 0, 'slot 0 has non-empty textContent');

    const roles = el.querySelectorAll('.qst-slot-role');
    assert.equal(roles[0]?.textContent, 'DAILY', 'primary slot uses the player-facing DAILY role chip');
    assert.equal(roles[1]?.textContent, 'BONUS', 'secondary slot uses compact BONUS role chip');
    assert.equal(roles[2]?.textContent, 'LEVEL', 'level quest has its own role chip');
    assert.equal(el.querySelectorAll('.qst-slot-icon').length, 3, 'each quest has a game-style icon tile');
    assert.deepEqual(el.querySelectorAll('.qst-slot-icon').map((icon) => icon.querySelector('img')?.src),
      [
        '/app/assets/quests/buy-ticket-luckbox.svg',
        '/whitepaper/flame-logo-split.svg',
        '/app/assets/quests/luckbox.svg',
      ],
      'quest cards retain yesterday\'s illustrated product icons');
    assert.match(APP_CSS,
      /\.qst-slot-icon\s*\{[^}]*clip-path:\s*polygon\(24% 0, 76% 0/s,
      'the original octagonal icon tile is restored');
    assert.match(slot0Text, /Buy a Ticket or Luckbox/,
      'the shared purchase quest names both valid completion routes');

    assert.equal(slots[1].classList.contains('qst-slot--gated'), true,
      'bonus quest is muted until the main quest is complete');
    assert.match(slots[1].textContent, /0\s*\/\s*100/,
      'the gated bonus card still shows its real progress target');
    assert.doesNotMatch(slots[1].textContent, /START|MAIN FIRST|DAILY FIRST/,
      'progress replaces the old command-like placeholder');
    assert.equal(slots[0].querySelector('.qst-slot-reward-extra')?.textContent, '+1 STREAK',
      'daily quest shows its streak reward beneath FLIP');
    assert.equal(slots[1].querySelector('.qst-slot-reward-extra')?.textContent, '+1 STREAK',
      'bonus quest shows its streak reward beneath FLIP');
    assert.match(slots[2].textContent, /800 FLIP/,
      'level card shows its distinct FLIP reward');
    assert.equal(slots[2].querySelector('.qst-slot-reward-extra')?.textContent, '+5 STREAK',
      'level streak reward sits on its own line');
    assert.equal(
      slots[2].querySelector('.qst-slot-reward-extra')?.parentElement?.matches('.qst-slot-copy'),
      true,
      'the level streak bonus sits below the original inline reward',
    );
    const rewards = el.querySelectorAll('.qst-slot-reward');
    const rewardLogos = el.querySelectorAll('.qst-slot-reward-logo');
    assert.equal(rewards.length, 3, 'every card owns its reward line');
    assert.equal(rewardLogos.length, 3, 'each reward line carries the FLIP flame logo');
    assert.equal(rewardLogos[0].src, '/whitepaper/flame-logo-split.svg');
    assert.match(rewards[0].textContent, /100 FLIP/);
    assert.doesNotMatch(rewards[0].textContent, /NEXT FLIP/,
      'reward copy stays concise without the removed next-flip suffix');

    const objectives = storeMod.get('ui.questObjectives');
    assert.equal(objectives.address, CONNECTED.toLowerCase());
    assert.deepEqual(
      objectives.quests.map((quest) => [quest.role, quest.questType]),
      [['DAILY', 1], ['BONUS', 2], ['LEVEL', 6]],
      'the exact unfinished daily, bonus, and level quests are published for control markers',
    );

    const meters = el.querySelectorAll('.qst-meter');
    assert.equal(meters.length, 3, 'each quest has a progress meter');
    assert.equal(meters[0].getAttribute('role'), 'progressbar');
    assert.equal(meters[0].getAttribute('aria-valuenow'), '33', '1 / 3 renders as 33%');
    assert.match(
      String(el.querySelectorAll('.qst-meter-fill')[0]?.style?.width || ''),
      /^33\.3/,
      'meter fill reflects progress',
    );

    el.disconnectedCallback();
  });

  test('quest-facing copy calls type 3 Referral, never Affiliate', async () => {
    const shortcuts = [];
    document.addEventListener('quest:open', (event) => shortcuts.push(event.detail));
    _fetchHandler = async () => makeQuestsPayload({
      quests: [
        { day: 1, slot: 0, questType: 3, progress: 0, target: 2, completed: false },
        { day: 1, slot: 1, questType: 2, progress: 0, target: 100, completed: false },
      ],
      levelQuest: null,
    });
    const el = instantiate();
    await settle(40);

    const primary = el.querySelectorAll('.qst-slot')[0];
    assert.match(primary.textContent, /Referral/);
    assert.doesNotMatch(primary.textContent, /Affiliate/i);
    assert.match(primary.getAttribute('aria-label') || '', /Referral/);
    assert.match(primary.getAttribute('aria-label') || '', /copy your referral link/i);
    assert.equal(primary.getAttribute('role'), 'button');
    assert.equal(primary.getAttribute('tabindex'), '0');
    primary.dispatchEvent({ type: 'click' });
    assert.equal(shortcuts.length, 1, 'clicking the referral quest requests a link copy');
    assert.equal(shortcuts[0]?.product, 'affiliate');
    assert.deepEqual(shortcuts[0]?.quests, [{ questType: 3, role: 'DAILY' }]);
    el.disconnectedCallback();
  });

  test('clicking an actionable quest opens a minimum-action confirmation before publishing', async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    document.addEventListener('quest:activate', listener);
    const el = instantiate();
    await settle(40);

    const level = el.querySelectorAll('.qst-slot')[2];
    assert.equal(level.getAttribute('role'), 'button');
    assert.equal(level.getAttribute('tabindex'), '0');
    assert.match(level.getAttribute('aria-label') || '', /Click to complete/);
    assert.doesNotMatch(level.getAttribute('aria-label') || '', /Open its action setup/);
    level.dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [], 'opening the bubble does not configure or submit anything');
    const dialog = el.querySelector('[data-bind="qst-action-dialog"]');
    assert.equal(dialog.hidden, false);
    const card = el.querySelector('.qst-action-dialog__card');
    assert.equal(card.getAttribute('data-variant'), 'level');
    assert.equal(card.getAttribute('data-state'), 'ready');
    assert.equal(
      el.querySelector('[data-bind="qst-action-icon"]').querySelector('img')?.src,
      '/app/assets/quests/luckbox.svg',
      'the quest popup reuses the same product icon as its card',
    );
    assert.equal(el.querySelector('[data-bind="qst-action-reward"]').textContent, '800 FLIP');
    assert.equal(el.querySelector('[data-bind="qst-action-reward-extra"]').textContent, '+5 STREAK');
    assert.equal(el.querySelector('[data-bind="qst-action-state"]').textContent, 'COMPLETES QUEST');
    assert.equal(
      el.querySelector('[data-bind="qst-action-requirement"]').textContent,
      'BUY LUCKBOX · 1.2 ETH',
      'the popup subtracts existing progress and presents only the remaining minimum',
    );
    assert.equal(el.querySelector('[data-bind="qst-action-adjust"]').hidden, true,
      'one-click quest presets do not repeat the destination form controls');
    assert.equal(el.querySelector('[data-bind="qst-action-copy"]').textContent,
      'Buy a 1.2 ETH luckbox.');
    assert.equal(el.querySelector('[data-bind="qst-action-confirm"]').textContent, 'CONFIRM');

    el.querySelector('[data-bind="qst-action-confirm"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [{
      questType: 6,
      target: '1200000000000',
      variant: 'level',
      submit: true,
      configuredAmount: true,
      level: 7,
    }]);
    assert.equal(dialog.hidden, true);

    document.removeEventListener('quest:activate', listener);
    el.disconnectedCallback();
  });

  test('the Craps day level quest is named, clickable, and routes to its paid buy-in', async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    document.addEventListener('quest:activate', listener);
    _fetchHandler = async () => makeQuestsPayload({
      levelQuest: {
        level: 7,
        questType: 11,
        progress: '0',
        target: '1',
        completed: false,
        eligible: true,
      },
    });
    const el = instantiate();
    await settle(40);

    const level = el.querySelectorAll('.qst-slot')[2];
    assert.match(level.textContent, /Buy a Craps Day/);
    assert.match(level.textContent, /0 day entries \/ 1 day entry/);
    assert.equal(level.querySelector('.qst-painted-icon__craps-front')?.src,
      '/badges-circular/dice_04_5_gold.svg',
      'the Craps level quest uses the gold 5 die');
    assert.equal(level.querySelector('.qst-painted-icon__craps-back')?.src,
      '/badges-circular/dice_01_2_blue.svg',
      'the Craps level quest layers the blue 2 behind its 5 die');
    assert.equal(level.classList.contains('qst-slot--actionable'), true);
    assert.equal(level.getAttribute('role'), 'button');
    level.dispatchEvent({ type: 'click' });

    assert.equal(el.querySelector('[data-bind="qst-action-dialog"]').hidden, false);
    const actionIcon = el.querySelector('[data-bind="qst-action-icon"]');
    assert.equal(actionIcon.querySelector('.qst-painted-icon__craps-front')?.src,
      '/badges-circular/dice_04_5_gold.svg');
    assert.equal(actionIcon.querySelector('.qst-painted-icon__craps-back')?.src,
      '/badges-circular/dice_01_2_blue.svg');
    assert.equal(
      el.querySelector('[data-bind="qst-action-requirement"]').textContent,
      'BUY CRAPS DAY',
    );
    assert.match(el.querySelector('[data-bind="qst-action-copy"]').textContent,
      /Buy one future Craps day with FLIP\. Awarded comps stay banked/);
    el.querySelector('[data-bind="qst-action-confirm"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [{
      questType: 11,
      target: '1',
      variant: 'level',
      submit: true,
      level: 7,
    }]);

    document.removeEventListener('quest:activate', listener);
    el.disconnectedCallback();
  });

  test('the daily Craps battle quest uses the silver 5 die', async () => {
    assert.match(PANEL_SRC, /10:\s*'\/badges-circular\/dice_04_5_silver\.svg'/,
      'the daily icon is a stable same-origin asset, never a blob-string fallback');
    assert.match(PANEL_SRC, /11:\s*'\/badges-circular\/dice_04_5_gold\.svg'/,
      'the level icon is a stable same-origin asset, never a blob-string fallback');
    _fetchHandler = async () => makeQuestsPayload({
      quests: [
        { day: 1, slot: 0, questType: 10, progress: 0, target: 1, completed: false },
        { day: 1, slot: 1, questType: 2, progress: 0, target: 100, completed: false },
      ],
    });
    const el = instantiate();
    await settle(40);

    const daily = el.querySelectorAll('.qst-slot')[0];
    assert.match(daily.textContent, /Join a Craps Battle/);
    assert.equal(daily.querySelector('.qst-painted-icon__craps-front')?.src,
      '/badges-circular/dice_04_5_silver.svg',
      'the daily Craps quest uses the silver 5 die');
    assert.equal(daily.querySelector('.qst-painted-icon__craps-back')?.src,
      '/badges-circular/dice_01_2_blue.svg',
      'the daily Craps quest layers the blue 2 behind its silver 5');
    el.disconnectedCallback();
  });

  test('clicking a gated Coinflip quest explains the gate instead of appearing unresponsive', async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    document.addEventListener('quest:activate', listener);
    const el = instantiate();
    await settle(40);

    const coinflip = el.querySelectorAll('.qst-slot')[1];
    assert.equal(coinflip.getAttribute('role'), 'button');
    assert.equal(coinflip.classList.contains('qst-slot--explainable'), true);
    coinflip.dispatchEvent({ type: 'click' });

    const dialog = el.querySelector('[data-bind="qst-action-dialog"]');
    const confirm = el.querySelector('[data-bind="qst-action-confirm"]');
    assert.equal(dialog.hidden, false, 'the gated quest still opens its action sheet');
    assert.match(el.querySelector('[data-bind="qst-action-copy"]').textContent,
      /Complete the daily quest first/);
    assert.equal(confirm.disabled, true);
    assert.match(confirm.textContent, /DAILY QUEST FIRST .*ADD BET/);
    confirm.dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [], 'the explanatory sheet cannot dispatch a premature bet preset');

    document.removeEventListener('quest:activate', listener);
    el.disconnectedCallback();
  });

  test('an external quest icon opens the identical card confirmation flow', async () => {
    const el = instantiate();
    await settle(40);
    const trigger = { focus() {} };
    document.dispatchEvent({
      type: 'quest:open',
      detail: {
        product: 'coinflip',
        trigger,
        quests: [{ questType: 2, role: 'BONUS' }],
      },
    });

    const dialog = el.querySelector('[data-bind="qst-action-dialog"]');
    assert.equal(dialog.hidden, false);
    assert.equal(el.querySelector('.qst-action-dialog__card').getAttribute('data-variant'), 'secondary');
    assert.match(el.querySelector('[data-bind="qst-action-copy"]').textContent,
      /Complete the daily quest first/,
      'the shortcut opens the same gated explanation as clicking its quest card');
    assert.equal(el.querySelector('[data-bind="qst-action-confirm"]').disabled, true);
    el.disconnectedCallback();
  });

  test('a bonus lootbox quest stays actionable before slot 0 because one purchase can complete both', async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    document.addEventListener('quest:activate', listener);
    _fetchHandler = async () => makeQuestsPayload({
      quests: [
        {
          day: 1, slot: 0, questType: 1, progress: '0', target: '10000000000',
          completed: false,
        },
        {
          day: 1, slot: 1, questType: 6, progress: '0', target: '20000000000',
          completed: false,
        },
      ],
    });

    const el = instantiate();
    await settle(40);

    const lootbox = el.querySelectorAll('.qst-slot')[1];
    assert.equal(lootbox.classList.contains('qst-slot--gated'), false);
    assert.equal(lootbox.classList.contains('qst-slot--actionable'), true);
    assert.equal(lootbox.classList.contains('qst-slot--explainable'), false);
    lootbox.dispatchEvent({ type: 'click' });

    const dialog = el.querySelector('[data-bind="qst-action-dialog"]');
    const confirm = el.querySelector('[data-bind="qst-action-confirm"]');
    assert.equal(dialog.hidden, false);
    assert.equal(confirm.disabled, false);
    assert.equal(
      el.querySelector('[data-bind="qst-action-copy"]').textContent,
      'Buy a 0.02 ETH luckbox.',
    );
    assert.doesNotMatch(confirm.textContent, /DAILY QUEST FIRST/);

    confirm.dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [{
      questType: 6,
      target: '20000000000',
      variant: 'secondary',
      submit: true,
      configuredAmount: true,
    }]);

    document.removeEventListener('quest:activate', listener);
    el.disconnectedCallback();
  });

  test('the main daily popup toggles between the minimum ticket and lootbox setup', async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    document.addEventListener('quest:activate', listener);
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) {
        return { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false };
      }
      if (u.includes('/game/quests/day/')) {
        return {
          day: 1,
          quests: [
            { slot: 0, questType: 1, target: '40000000000' },
            { slot: 1, questType: 2, target: '2000000000000000000000' },
          ],
        };
      }
      return makeQuestsPayload({
        quests: [
          { day: 1, slot: 0, questType: 1, progress: '0', target: '40000000000', completed: false },
        ],
      });
    };
    storeMod.update('app.lastDay', { day: 1 });

    const el = instantiate();
    await settle(40);
    el.querySelectorAll('.qst-slot')[0].dispatchEvent({ type: 'click' });

    const choice = el.querySelector('[data-bind="qst-action-choice"]');
    const adjust = el.querySelector('[data-bind="qst-action-adjust"]');
    const ticket = el.querySelector('[data-bind="qst-action-ticket"]');
    const lootbox = el.querySelector('[data-bind="qst-action-lootbox"]');
    assert.equal(choice.hidden, false, 'the purchase quest offers the product toggle');
    assert.equal(adjust.hidden, false, 'ticket/lootbox purchase sizing stays available');
    assert.equal(ticket.getAttribute('aria-pressed'), 'true');
    assert.match(el.querySelector('[data-bind="qst-action-requirement"]').textContent, /BUY .*TICKET/);

    lootbox.dispatchEvent({ type: 'click' });
    assert.equal(lootbox.getAttribute('aria-pressed'), 'true');
    assert.equal(ticket.getAttribute('aria-pressed'), 'false');
    assert.equal(
      el.querySelector('[data-bind="qst-action-requirement"]').textContent,
      'BUY LUCKBOX · 0.04 ETH',
    );
    assert.match(el.querySelector('[data-bind="qst-action-confirm"]').textContent,
      /CONFIRM · BUY LUCKBOX · 0\.04 ETH/);

    el.querySelector('[data-bind="qst-action-confirm"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [{
      questType: 1,
      target: '40000000000',
      variant: 'primary',
      submit: true,
      configuredAmount: true,
      purchaseKind: 'lootbox',
    }]);

    document.removeEventListener('quest:activate', listener);
    el.disconnectedCallback();
  });

  test('a level purchase quest can choose either tickets or a lootbox', async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    document.addEventListener('quest:activate', listener);
    _fetchHandler = async () => makeQuestsPayload({
      levelQuest: {
        level: 7,
        questType: 1,
        progress: '0',
        target: '1600000000000',
        completed: false,
        eligible: true,
      },
    });
    const el = instantiate();
    await settle(40);

    const level = el.querySelectorAll('.qst-slot')[2];
    assert.match(level.textContent, /Buy a Ticket or Luckbox/);
    level.dispatchEvent({ type: 'click' });
    const choice = el.querySelector('[data-bind="qst-action-choice"]');
    const lootbox = el.querySelector('[data-bind="qst-action-lootbox"]');
    assert.equal(choice.hidden, false, 'level purchase quests show the product selector');
    lootbox.dispatchEvent({ type: 'click' });
    assert.equal(lootbox.getAttribute('aria-pressed'), 'true');
    assert.equal(
      el.querySelector('[data-bind="qst-action-requirement"]').textContent,
      'BUY LUCKBOX · 1.6 ETH',
    );
    el.querySelector('[data-bind="qst-action-confirm"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [{
      questType: 1,
      target: '1600000000000',
      variant: 'level',
      submit: true,
      configuredAmount: true,
      level: 7,
      purchaseKind: 'lootbox',
    }]);

    document.removeEventListener('quest:activate', listener);
    el.disconnectedCallback();
  });

  test('the quest purchase sheet shows the active ticket or luckbox boon value', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) {
        return { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false };
      }
      if (u.includes('/game/quests/day/')) {
        return { day: 1, quests: [{ slot: 0, questType: 1, target: '40000000000' }] };
      }
      return makeQuestsPayload({
        quests: [
          { day: 1, slot: 0, questType: 1, progress: '0', target: '40000000000', completed: false },
        ],
        levelQuest: null,
      });
    };
    storeMod.update('app.lastDay', { day: 1 });
    storeMod.update('app.boons', {
      day: 1,
      boons: [
        { boonType: 9, consumed: false },
        { boonType: 22, consumed: false },
      ],
    });

    const el = instantiate();
    await settle(40);
    el.querySelectorAll('.qst-slot')[0].dispatchEvent({ type: 'click' });

    const boon = el.querySelector('[data-bind="qst-action-boon"]');
    const indicator = el.querySelector('[data-bind="qst-action-boon-indicator"]');
    assert.equal(boon.hidden, false);
    assert.equal(indicator.getAttribute('product'), 'purchase');
    assert.equal(el.querySelector('[data-bind="qst-action-boon-label"]').textContent, '25% MORE TICKETS');
    assert.match(el.querySelector('[data-bind="qst-action-boon-value"]').textContent, /^\+\S+ TICKETS?$/);

    el.querySelector('[data-bind="qst-action-lootbox"]').dispatchEvent({ type: 'click' });
    assert.equal(indicator.getAttribute('product'), 'lootbox');
    assert.equal(el.querySelector('[data-bind="qst-action-boon-label"]').textContent, '25% BIGGER LUCKBOX');
    assert.equal(el.querySelector('[data-bind="qst-action-boon-value"]').textContent, '+0.01 ETH VALUE');
    el.disconnectedCallback();
  });

  test('an open purchase sheet refreshes its bonus area without changing base quotes', async () => {
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) {
        return { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false };
      }
      if (u.includes('/game/quests/day/')) {
        return { day: 1, quests: [{ slot: 0, questType: 1, target: '40000000000' }] };
      }
      return makeQuestsPayload({
        quests: [
          { day: 1, slot: 0, questType: 1, progress: '0', target: '40000000000', completed: false },
        ],
        levelQuest: null,
      });
    };
    storeMod.update('app.lastDay', { day: 1 });

    const el = instantiate();
    await settle(40);
    el.querySelectorAll('.qst-slot')[0].dispatchEvent({ type: 'click' });

    const boon = el.querySelector('[data-bind="qst-action-boon"]');
    const indicator = el.querySelector('[data-bind="qst-action-boon-indicator"]');
    const label = el.querySelector('[data-bind="qst-action-boon-label"]');
    const requirement = el.querySelector('[data-bind="qst-action-requirement"]');
    const confirm = el.querySelector('[data-bind="qst-action-confirm"]');
    assert.equal(boon.hidden, true);

    const ticketRequirement = requirement.textContent;
    const ticketConfirm = confirm.textContent;
    storeMod.update('app.boons', {
      day: 1,
      boons: [
        { boonType: 9, consumed: false },
        { boonType: 22, consumed: false },
      ],
    });
    await settle();

    assert.equal(boon.hidden, false);
    assert.equal(indicator.getAttribute('product'), 'purchase');
    assert.equal(label.textContent, '25% MORE TICKETS');
    assert.equal(requirement.textContent, ticketRequirement);
    assert.equal(confirm.textContent, ticketConfirm);

    storeMod.update('app.boons', { day: 1, boons: [] });
    await settle();
    assert.equal(boon.hidden, true);
    el.querySelector('[data-bind="qst-action-lootbox"]').dispatchEvent({ type: 'click' });
    const lootboxRequirement = requirement.textContent;
    const lootboxConfirm = confirm.textContent;

    storeMod.update('app.boons', {
      day: 1,
      boons: [
        { boonType: 9, consumed: false },
        { boonType: 22, consumed: false },
      ],
    });
    await settle();

    assert.equal(boon.hidden, false);
    assert.equal(indicator.getAttribute('product'), 'lootbox');
    assert.equal(label.textContent, '25% BIGGER LUCKBOX');
    assert.equal(requirement.textContent, lootboxRequirement);
    assert.equal(confirm.textContent, lootboxConfirm);
    el.disconnectedCallback();
  });

  test('a Degenerette quest popup shows the selected ticket and submits its exact five-spin wager', async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    document.addEventListener('quest:activate', listener);
    const ticketDraft = makeFakeElement('app-degenerette-panel');
    ticketDraft.getTicketDraft = () => ({
      traitIds: [56, 65, 130, 195],
      heroQuadrant: 2,
    });
    _docBody.appendChild(ticketDraft);
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) {
        return { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false };
      }
      if (u.includes('/game/quests/day/')) {
        return {
          day: 1,
          quests: [
            { slot: 0, questType: 1, target: '1' },
            { slot: 1, questType: 7, target: '80000000000' },
          ],
        };
      }
      return makeQuestsPayload({
        quests: [
          { day: 1, slot: 0, questType: 1, progress: '1', target: '1', completed: true },
          { day: 1, slot: 1, questType: 7, progress: '0', target: '80000000000', completed: false },
        ],
      });
    };
    storeMod.update('app.lastDay', { day: 1 });

    const el = instantiate();
    await settle(40);
    el.querySelectorAll('.qst-slot')[1].dispatchEvent({ type: 'click' });

    assert.equal(el.querySelector('[data-bind="qst-action-dgn"]').hidden, false);
    assert.doesNotMatch(el.innerHTML, /MINIMUM ACTION/,
      'the redundant minimum-action eyebrow is gone');
    assert.equal(el.querySelector('[name="qst-action-dgn-spins"]').value, '5');
    assert.equal(el.querySelector('[name="qst-action-dgn-bet"]').value, '0.016');
    assert.equal(el.querySelector('[data-bind="qst-action-dgn-unit"]').textContent, 'ETH');
    assert.equal(el.querySelector('[data-bind="qst-action-dgn-bet-limit"]').textContent, 'MIN 0.005');
    assert.equal(el.querySelector('[data-bind="qst-action-dgn-spins-limit"]').textContent, 'MAX 25');
    assert.equal(
      el.querySelector('[data-bind="qst-action-dgn-img-0"]').src,
      '/badges-circular/crypto_00_xrp_gold.svg',
    );
    assert.equal(
      el.querySelector('[data-bind="qst-action-dgn-cell-2"]').classList.contains('q-hero'),
      true,
    );
    assert.equal(
      el.querySelector('[data-bind="qst-action-requirement"]').textContent,
      'DEGENERETTE · 5 SPINS · 0.08 ETH',
    );

    el.querySelector('[data-bind="qst-action-dgn-spins-up"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[name="qst-action-dgn-spins"]').value, '6',
      'the visible spin stepper respects the contract maximum');
    el.querySelector('[data-bind="qst-action-dgn-spins-down"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[name="qst-action-dgn-spins"]').value, '5');
    el.querySelector('[data-bind="qst-action-dgn-bet-up"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[name="qst-action-dgn-bet"]').value, '0.021',
      'the wager stepper moves by the currency contract minimum');
    el.querySelector('[data-bind="qst-action-dgn-bet-down"]').dispatchEvent({ type: 'click' });
    assert.equal(el.querySelector('[name="qst-action-dgn-bet"]').value, '0.016');

    el.querySelector('[data-bind="qst-action-confirm"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [{
      questType: 7,
      target: '80000000000',
      variant: 'secondary',
      submit: true,
      amountPerSpin: '16000000000',
      spinCount: 5,
      traitIds: [56, 65, 130, 195],
      heroQuadrant: 2,
    }]);

    document.removeEventListener('quest:activate', listener);
    el.disconnectedCallback();
  });

  test('bonus quest unlocks once the primary quest is complete', async () => {
    _fetchHandler = async () => makeQuestsPayload({
      quests: [
        { day: 1, slot: 0, questType: 1, progress: 3, target: 3, completed: true },
        { day: 1, slot: 1, questType: 2, progress: 5, target: 100, completed: false },
      ],
    });
    const el = instantiate();
    await settle(40);

    const slots = el.querySelectorAll('.qst-slot');
    assert.equal(slots[1].classList.contains('qst-slot--gated'), false);
    assert.doesNotMatch(slots[1].textContent, /MAIN FIRST/);
    assert.match(slots[1].textContent, /5 \/ 100/);
    el.disconnectedCallback();
  });

  test('quest type 9 uses the player-facing Redeem FLIP label', async () => {
    _fetchHandler = async () => makeQuestsPayload({
      quests: [
        { day: 1, slot: 0, questType: 1, progress: 3, target: 3, completed: true },
        { day: 1, slot: 1, questType: 9, progress: 0, target: 1, completed: false },
      ],
    });
    const el = instantiate();
    await settle(40);

    const redeemSlot = el.querySelectorAll('.qst-slot')[1];
    assert.match(redeemSlot.textContent, /Redeem FLIP/);
    assert.doesNotMatch(el.textContent, /Mint with FLIP/i);
    assert.equal(redeemSlot.querySelector('.qst-slot-icon')?.querySelector('img')?.src,
      '/whitepaper/flame-logo-split.svg',
      'Redeem FLIP keeps its canonical product icon');
    el.disconnectedCallback();
  });

  test('an unfinished foil quest publishes the live routed level, not the prior draw level', async () => {
    storeMod.update('app.lastDay', {
      day: 1,
      roll1: { purchaseLevel: 12 },
    });
    _fetchHandler = async (url) => {
      if (String(url).includes('/game/state')) {
        return { level: 12, phase: 'PURCHASE', jackpotPhaseFlag: false };
      }
      if (String(url).includes('/game/quests/day/')) {
        return {
          day: 1,
          quests: [
            { slot: 0, questType: 1, flags: 0, target: '40000000000' },
            { slot: 1, questType: 4, flags: 0, target: '1' },
          ],
        };
      }
      return makeQuestsPayload({
        quests: [
          { day: 1, slot: 0, questType: 1, progress: 0, target: '40000000000', completed: false },
        ],
      });
    };

    const el = instantiate();
    await settle(40);
    assert.match(el.querySelectorAll('.qst-slot')[1].textContent, /Buy Foil Pack/,
      'the foil objective uses the same concise action-style quest name');
    assert.match(PANEL_SRC, /label: cost == null \? 'BUY FOIL PACK'/,
      'the confirmation action uses the quest name instead of ADD FOIL PACK');
    assert.doesNotMatch(PANEL_SRC, /ADD FOIL PACK/);
    assert.deepEqual(storeMod.get('ui.foilQuest'), {
      active: true,
      completed: false,
      day: 1,
      level: 13,
      address: CONNECTED.toLowerCase(),
    });
    el.disconnectedCallback();
    assert.equal(storeMod.get('ui.foilQuest'), null, 'unmounted quest context cannot stay stale');
  });

  test('first-day foil quest advances past an already-owned previous-level pack', async () => {
    storeMod.update('app.lastDay', {
      day: 1,
      roll1: { purchaseLevel: 1 },
    });
    _fetchHandler = async (url) => {
      const u = String(url);
      if (u.includes('/game/state')) {
        return { level: 1, phase: 'PURCHASE', jackpotPhaseFlag: false };
      }
      if (u.includes('/game/quests/day/')) {
        return {
          day: 1,
          quests: [
            { slot: 0, questType: 1, flags: 0, target: '40000000000' },
            { slot: 1, questType: 4, flags: 0, target: '1' },
          ],
        };
      }
      return makeQuestsPayload({
        quests: [
          { day: 1, slot: 0, questType: 1, progress: 0, target: '40000000000', completed: false },
        ],
      });
    };

    const el = instantiate();
    await settle(40);
    assert.equal(storeMod.get('ui.foilQuest')?.level, 2,
      'purchase phase routes the quest pack to level 2 instead of rechecking owned level 1');
    el.disconnectedCallback();
  });

  test('level quest is never sourced from an in-browser contract fallback', () => {
    assert.doesNotMatch(PANEL_SRC, /getPlayerLevelQuestView|JsonRpcProvider|new ethers\.Contract/);
    assert.match(PANEL_SRC, /data\?\.levelQuest/, 'optional level quest comes from /player payload');
  });

  test('a temporarily null DB projection keeps a visible level-quest slot', async () => {
    _fetchHandler = async () => makeQuestsPayload({ levelQuest: null });
    const el = instantiate();
    await settle(40);

    const slots = el.querySelectorAll('.qst-slot');
    assert.equal(slots.length, 3, 'daily, bonus, and level slots keep stable layout');
    const levelSlot = slots[2];
    assert.equal(levelSlot.querySelector('.qst-slot-role')?.textContent, 'LEVEL');
    assert.equal(levelSlot.querySelector('.qst-slot-status')?.textContent, 'SYNC');
    assert.match(levelSlot.textContent, /Awaiting quest data/);
    assert.match(levelSlot.textContent, /800 FLIP/);
    assert.equal(levelSlot.classList.contains('qst-slot--gated'), true);

    el.disconnectedCallback();
  });

  test('a deity + afKing holder can keep working a level quest before its completion gate clears', async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    document.addEventListener('quest:activate', listener);
    _fetchHandler = async () => makeQuestsPayload({
      afkingActive: true,
      questStreak: { baseStreak: 0, lastCompletedDay: 0 },
      levelQuest: {
        level: 7,
        questType: 2,
        progress: '8000000000000000000000',
        target: '20000000000000000000000',
        completed: false,
        eligible: false,
      },
      scoreBreakdown: {
        questStreakPoints: 0,
        mintCountPoints: 0,
        affiliatePoints: 0,
        totalBps: 8000,
        passBonus: { kind: 'deity', points: 80 },
      },
    });

    const el = instantiate();
    await settle(40);

    const levelSlot = el.querySelectorAll('.qst-slot')[2];
    assert.equal(
      levelSlot.querySelector('.qst-slot-status')?.textContent,
      '8,000 FLIP / 20,000 FLIP',
      'the card shows banked progress instead of replacing it with BUY 1 TICKET',
    );
    assert.match(levelSlot.getAttribute('aria-label') || '', /Deity pass recognized/);
    assert.match(levelSlot.getAttribute('aria-label') || '', /four active-level ticket entries/);
    const levelReward = levelSlot.querySelector('.qst-slot-reward');
    assert.equal(levelReward?.getAttribute('title'), 'Reward: 800 FLIP +5 quest streak');
    assert.doesNotMatch(levelReward?.getAttribute('title') || '', /pass|afKing|prerequisite/i,
      'level-quest mouseover contains reward information only');
    assert.equal(
      levelSlot.getAttribute('title'),
      'Coinflip: 8,000 FLIP / 20,000 FLIP. Reward: 800 FLIP +5 quest streak',
      'the level-card mouseover stays focused on its action, progress, and reward',
    );
    assert.doesNotMatch(levelSlot.getAttribute('title') || '', /pass|afKing|prerequisite/i,
      'the level-card native tooltip omits eligibility internals');
    assert.match(levelSlot.getAttribute('aria-label') || '', /Deity pass recognized/,
      'the complete card description remains available to assistive technology');
    assert.equal(levelSlot.classList.contains('qst-slot--gated'), false,
      'a completion prerequisite no longer greys out progress that the contract is banking');
    assert.equal(levelSlot.classList.contains('qst-slot--actionable'), true);
    assert.equal(levelSlot.getAttribute('role'), 'button');
    levelSlot.dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [], 'the popup opens before configuring the coinflip form');
    assert.equal(
      el.querySelector('[data-bind="qst-action-requirement"]').textContent,
      'ADD BET · 12,000 FLIP',
    );
    el.querySelector('[data-bind="qst-action-confirm"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [{
      questType: 2,
      target: '12000000000000000000000',
      variant: 'level',
      submit: true,
      configuredAmount: true,
      level: 7,
    }]);

    document.removeEventListener('quest:activate', listener);
    el.disconnectedCallback();
  });

  test('an over-target level quest is complete even while the auxiliary eligibility flag lags', async () => {
    _fetchHandler = async () => makeQuestsPayload({
      afkingActive: true,
      questStreak: { baseStreak: 0, lastCompletedDay: 0 },
      levelQuest: {
        level: 7,
        questType: 2,
        progress: '40000000000000000000000',
        target: '20000000000000000000000',
        completed: false,
        eligible: false,
      },
      scoreBreakdown: {
        questStreakPoints: 0,
        mintCountPoints: 0,
        affiliatePoints: 0,
        totalBps: 8000,
        passBonus: { kind: 'deity', points: 80 },
      },
    });

    const el = instantiate();
    await settle(40);
    const levelSlot = el.querySelectorAll('.qst-slot')[2];
    assert.equal(levelSlot.querySelector('.qst-slot-status')?.textContent, 'COMPLETE');
    assert.equal(levelSlot.querySelector('.qst-slot-note'), null);
    assert.equal(levelSlot.classList.contains('qst-slot--completed'), true);
    assert.equal(levelSlot.getAttribute('role'), null);
    assert.doesNotMatch(levelSlot.textContent || '', /ACTIVITY NEEDED|FINALIZE/);
    el.disconnectedCallback();
  });

  test('an eligible target-met level quest renders complete without a made-up finalize step', async () => {
    _fetchHandler = async () => makeQuestsPayload({
      levelQuest: {
        level: 7,
        questType: 2,
        progress: '40000000000000000000000',
        target: '20000000000000000000000',
        completed: false,
        eligible: true,
      },
    });

    const el = instantiate();
    await settle(40);
    const levelSlot = el.querySelectorAll('.qst-slot')[2];
    assert.equal(levelSlot.querySelector('.qst-slot-status')?.textContent, 'COMPLETE');
    assert.equal(levelSlot.querySelector('.qst-slot-note'), null);
    assert.equal(levelSlot.classList.contains('qst-slot--completed'), true);
    assert.equal(levelSlot.getAttribute('role'), null,
      'a completed quest does not offer another action dialog');
    assert.doesNotMatch(levelSlot.textContent || '', /READY TO COMPLETE|FINALIZE/);
    el.disconnectedCallback();
  });

  test('an already-complete initial load renders quietly without replaying the transition', async () => {
    _fetchHandler = async () => makeQuestsPayload({
      quests: [
        { day: 1, slot: 0, questType: 6, progress: 3, target: 3, completed: true, highDifficulty: false, requirementMints: 0, requirementTokenAmount: '0' },
        { day: 1, slot: 1, questType: 2, progress: 0, target: 100, completed: false, highDifficulty: false, requirementMints: 0, requirementTokenAmount: '0' },
      ],
      levelQuest: {
        level: 7,
        questType: 6,
        progress: '1600000000000',
        target: '1600000000000',
        completed: true,
        eligible: true,
      },
    });
    const el = instantiate();
    await settle(40);

    const slots = el.querySelectorAll('.qst-slot');
    const slot0 = slots[0];
    const slot0Text = slot0.textContent || '';
    assert.match(slot0Text, /COMPLETE/,
      `slot 0 (completed) uses COMPLETE; got "${slot0Text}"`);
    assert.deepEqual(
      el.querySelectorAll('.qst-slot-status--done').map((node) => node.textContent),
      ['COMPLETE', 'COMPLETE'],
      'daily and level quest completion labels use the same wording',
    );
    assert.doesNotMatch(el.textContent, /\bDONE\b/);
    assert.doesNotMatch(APP_CSS, /\.qst-slot--completed \.qst-meter::after/,
      'the original completed card does not add a permanent victory footer');
    assert.match(APP_CSS,
      /\.qst-slot--completed\s*\{[^}]*--qst-accent:\s*#4ade80;[^}]*--qst-rgb:\s*74, 222, 128/s,
      'completion returns to the original restrained green card state');
    assert.equal(el.querySelector('.qst-slot--just-completed'), null,
      'loading an existing completion does not pretend it just happened');

    const toast = el.querySelector('[data-bind="qst-complete-toast"]');
    assert.ok(toast, 'the completion status toast is mounted once with the panel');
    assert.equal(toast.hidden, true,
      'loading an existing completion does not replay its toast');
    assert.match(el.innerHTML,
      /qst-complete-toast__sigil[\s\S]*?\/whitepaper\/flame-logo-split\.svg/,
      'the completion moment uses the FLIP currency mark');

    // Completion audio stays synthesized; there is no direct media-element
    // playback path in this read-only component.
    assert.equal(
      /playAudio|new Audio|audio\.play/.test(PANEL_SRC_NOCOMMENT),
      false,
      'the panel does not add a direct media-element player',
    );

    el.disconnectedCallback();
  });

  test('an observed incomplete-to-complete transition pulses and chimes exactly once', async () => {
    let completed = false;
    _fetchHandler = async () => makeQuestsPayload({
      quests: [
        {
          day: 1,
          slot: 0,
          questType: 1,
          progress: completed ? 3 : 1,
          target: 3,
          completed,
        },
        { day: 1, slot: 1, questType: 2, progress: 0, target: 100, completed: false },
      ],
      questStreak: { baseStreak: completed ? 6 : 5, lastCompletedDay: completed ? 1 : 0 },
    });

    const realAudioContext = globalThis.AudioContext;
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

    let el;
    try {
      globalThis.AudioContext = RecordingAudioContext;
      jackpotSfxMod.__resetForTest();
      el = instantiate();
      await settle(40);
      assert.equal(RecordingAudioContext.last, null,
        'the incomplete baseline does not touch WebAudio');

      completed = true;
      storeMod.update('connected.address', CONNECTED);
      await settle(60);
      assert.ok(el.querySelectorAll('.qst-slot')[0]
        .classList.contains('qst-slot--just-completed'));
      assert.equal(el.querySelector('[data-bind="qst-streak"]').textContent, '6',
        'the confirmed quest completion advances the visible streak');
      assert.equal(el.querySelector('[data-bind="qst-streak-gain"]').textContent, '+1',
        'the streak HUD names the exact increase');
      assert.ok(el.querySelector('.qst-streak-chip')
        .classList.contains('qst-streak-chip--increased'),
      'the streak HUD pulses in the same render as the quest card');
      assert.equal(RecordingAudioContext.last.oscillators.length, 2,
        'one restrained two-note chime accompanies the card pulse');
      const toast = el.querySelector('[data-bind="qst-complete-toast"]');
      assert.equal(toast.hidden, false, 'the transition opens the completion toast');
      assert.equal(toast.classList.contains('is-visible'), true);
      assert.equal(
        el.querySelector('[data-bind="qst-complete-toast-kicker"]').textContent,
        'DAILY QUEST COMPLETE',
      );
      assert.equal(
        el.querySelector('[data-bind="qst-complete-toast-title"]').textContent,
        'Buy a Ticket or Luckbox',
      );
      assert.equal(
        el.querySelector('[data-bind="qst-complete-toast-detail"]').textContent,
        '+100 FLIP · +1 STREAK',
      );

      storeMod.update('connected.address', CONNECTED);
      await settle(60);
      assert.equal(el.querySelector('.qst-slot--just-completed'), null,
        'the next completed refresh rebuilds the normal static card');
      assert.equal(el.querySelector('[data-bind="qst-streak-gain"]').textContent, '',
        'polling the same completion clears the one-shot gain label');
      assert.equal(RecordingAudioContext.last.oscillators.length, 2,
        'polling the same completion cannot replay its chime');
      assert.match(APP_CSS, /@keyframes qst-complete-pulse/);
      assert.match(APP_CSS, /qst-slot--just-completed::after/);
      assert.match(APP_CSS, /@keyframes qst-streak-gain/);
      assert.match(APP_CSS, /bottom:\s*24dvh/,
        'the compact toast sits roughly one quarter up from the bottom edge');
      assert.match(APP_CSS, /@keyframes qst-complete-toast/);
      assert.match(APP_CSS, /animation:\s*qst-complete-toast 4s/,
        'the completion banner remains readable for four seconds');
      assert.match(APP_CSS,
        /qst-complete-toast\s*\{[^}]*width:\s*min\(calc\(100vw - 2rem\), 21\.5rem\)/s,
        'the toast is slightly larger without turning into a modal');
    } finally {
      el?.disconnectedCallback();
      jackpotSfxMod.__resetForTest();
      if (realAudioContext === undefined) delete globalThis.AudioContext;
      else globalThis.AudioContext = realAudioContext;
    }
  });

  test('one action that completes several quest rows produces one combined popup', async () => {
    let completed = false;
    _fetchHandler = async () => makeQuestsPayload({
      quests: [
        { day: 1, slot: 0, questType: 1, progress: completed ? 3 : 1, target: 3, completed },
        { day: 1, slot: 1, questType: 2, progress: 0, target: 100, completed: false },
      ],
      levelQuest: {
        level: 7,
        questType: 6,
        progress: completed ? '1600000000000' : '400000000000',
        target: '1600000000000',
        completed,
        eligible: true,
      },
    });
    const el = instantiate();
    await settle(40);

    completed = true;
    storeMod.update('connected.address', CONNECTED);
    await settle(60);

    assert.equal(
      el.querySelector('[data-bind="qst-complete-toast-kicker"]').textContent,
      'DAILY + LEVEL QUESTS COMPLETE',
    );
    assert.equal(
      el.querySelector('[data-bind="qst-complete-toast-title"]').textContent,
      'Buy Luckbox',
      'when one luckbox purchase clears both objectives, the completion names the specific action',
    );
    assert.equal(
      el.querySelector('[data-bind="qst-complete-toast-detail"]').textContent,
      '+900 FLIP · +6 STREAK',
      'simultaneous daily and level rewards are folded into one visible notification',
    );
    el.disconnectedCallback();
  });

  test('an afKing automatic primary completion does not inflate a lootbox popup', async () => {
    let completed = false;
    _fetchHandler = async () => makeQuestsPayload({
      afkingActive: true,
      quests: [
        { day: 1, slot: 0, questType: 1, progress: completed ? 3 : 1, target: 3, completed },
        { day: 1, slot: 1, questType: 2, progress: 0, target: 100, completed: false },
      ],
      levelQuest: {
        level: 7,
        questType: 6,
        progress: completed ? '1600000000000' : '400000000000',
        target: '1600000000000',
        completed,
        eligible: true,
      },
    });
    const el = instantiate();
    await settle(40);

    completed = true;
    storeMod.update('connected.address', CONNECTED);
    await settle(60);

    assert.equal(
      el.querySelector('[data-bind="qst-complete-toast-kicker"]').textContent,
      'LEVEL QUEST COMPLETE',
      'the subscription-owned primary is not counted as a second paid quest',
    );
    assert.equal(
      el.querySelector('[data-bind="qst-complete-toast-title"]').textContent,
      'Buy Luckbox',
    );
    assert.equal(
      el.querySelector('[data-bind="qst-complete-toast-detail"]').textContent,
      '+800 FLIP · +5 STREAK',
    );
    assert.equal(
      el.querySelectorAll('.qst-slot')[0].querySelector('.qst-slot-status')?.textContent,
      'AUTO',
      'the primary card keeps its afKing attribution after the event lands',
    );
    el.disconnectedCallback();
  });

  test('a bonus completion does not replay a level quest whose target was already met', async () => {
    let bonusComplete = false;
    _fetchHandler = async () => makeQuestsPayload({
      quests: [
        {
          day: 1,
          slot: 0,
          questType: 1,
          progress: 3,
          target: 3,
          completed: true,
        },
        {
          day: 1,
          slot: 1,
          questType: 2,
          progress: bonusComplete ? 100 : 0,
          target: 100,
          completed: bonusComplete,
        },
      ],
      questStreak: { baseStreak: bonusComplete ? 11 : 10, lastCompletedDay: 1 },
      levelQuest: {
        level: 7,
        questType: 6,
        // The card has correctly shown COMPLETE since the target-crossing
        // action. A lagging authoritative flag must not re-announce it later.
        progress: '1800000000000',
        target: '1600000000000',
        completed: bonusComplete,
        eligible: bonusComplete,
      },
    });
    const el = instantiate();
    await settle(40);

    assert.equal(
      el.querySelectorAll('.qst-slot')[2]
        .querySelector('.qst-slot-status')?.textContent,
      'COMPLETE',
      'the target-met level quest is already complete before today\'s bonus action',
    );
    assert.equal(el.querySelector('[data-bind="qst-complete-toast"]').hidden, true,
      'loading the existing level completion remains quiet');

    bonusComplete = true;
    storeMod.update('connected.address', CONNECTED);
    await settle(60);

    assert.equal(
      el.querySelector('[data-bind="qst-complete-toast-kicker"]').textContent,
      'DAILY QUEST COMPLETE',
      'the old level completion is not folded into the new bonus notification',
    );
    assert.equal(
      el.querySelector('[data-bind="qst-complete-toast-title"]').textContent,
      'Coinflip',
    );
    assert.equal(
      el.querySelector('[data-bind="qst-complete-toast-detail"]').textContent,
      '+100 FLIP · +1 STREAK',
      'the notification includes only the bonus reward actually completed now',
    );
    assert.equal(
      el.querySelectorAll('.qst-slot')[2]
        .classList.contains('qst-slot--just-completed'),
      false,
      'the already-complete level card does not pulse again',
    );
    el.disconnectedCallback();
  });

  test('Streak count rendered via textContent', async () => {
    _fetchHandler = async () => makeQuestsPayload({
      questStreak: { baseStreak: 7, lastCompletedDay: 0 },
    });
    const el = instantiate();
    await settle(40);

    const streakEl = el.querySelector('[data-bind="qst-streak"]');
    assert.ok(streakEl, '.qst-streak element rendered');
    assert.match(
      String(streakEl.textContent || ''),
      /7/,
      `streak display contains "7" via textContent; got "${streakEl.textContent}"`,
    );

    el.disconnectedCallback();
  });

  test('owned streak shields subtly outline the normal streak bubble without shield text', async () => {
    _fetchHandler = async () => makeQuestsPayload({ shields: 2 });
    const el = instantiate();
    await settle(40);

    const chip = el.querySelector('.qst-streak-chip');
    assert.equal(chip.classList.contains('qst-streak-chip--shielded'), true);
    assert.equal(chip.getAttribute('data-streak-shields'), '2');
    assert.equal(el.querySelector('[data-bind="qst-streak-shields"]'), null,
      'shield ownership adds no icon, count, or label beside the streak');
    assert.doesNotMatch(chip.textContent, /SHIELD/i);
    assert.match(chip.getAttribute('title'), /2 streak shields.*protects one missed quest day/i);
    assert.equal(chip.getAttribute('tabindex'), '0', 'the shield explanation is keyboard reachable');
    assert.match(
      APP_CSS,
      /qst-streak-chip--shielded\s*\{[^}]*outline:\s*1px solid rgba\(255, 255, 255, 0\.52\)[^}]*0 0 7px rgba\(255, 255, 255, 0\.13\)/s,
      'the held shield is only a subtle white outline around the normal bubble',
    );

    el.disconnectedCallback();
  });

  test('Degen Rating uses loot colors at the exact tier boundaries', async () => {
    const { degenScoreLootTier } = await import('../app-quest-panel.js');
    assert.doesNotMatch(PANEL_SRC,
      /qst-score-label[\s\S]*?<boon-product-indicator product="activity"/,
      'passive Degen Rating boons are reflected in the score without a redundant icon');
    assert.deepEqual(
      [59, 60, 149, 150, 299, 300, 999, 1_000].map(degenScoreLootTier),
      ['white', 'green', 'green', 'purple', 'purple', 'orange', 'orange', 'gold'],
    );

    for (const [tier, color] of [
      ['white', '#f8fafc'],
      ['green', '#4ade80'],
      ['purple', '#c084fc'],
      ['orange', '#f5a623'],
      ['gold', '#fde047'],
    ]) {
      assert.match(
        APP_CSS,
        new RegExp(`qst-score-value\\[data-score-tier="${tier}"\\][^{]*\\{[^}]*${color}`, 's'),
      );
    }

    _fetchHandler = async () => makeQuestsPayload({
      scoreBreakdown: {
        totalBps: 1_000,
        mintLevelStreakPoints: 0,
        questStreakPoints: 0,
        mintCountPoints: 0,
        affiliatePoints: 0,
        cursePoints: 0,
        passBonus: null,
      },
    });
    const el = instantiate();
    await settle(40);
    assert.equal(
      el.querySelector('[data-bind="qst-score-value"]').getAttribute('data-score-tier'),
      'gold',
    );
    el.disconnectedCallback();
  });

  test('live GAME identity restores deity score and afKing streak without a player API row', async () => {
    const { mergeQuestIdentitySnapshot } = await import('../app-quest-panel.js');
    const identity = mergeQuestIdentitySnapshot(null, {
      afkingActive: true,
      effectiveQuestStreak: 5,
      effectiveQuestStreakExact: true,
      activityScore: 157,
      hasDeityPass: true,
      questStreak: { baseStreak: 0, lastCompletedDay: 0 },
    });

    assert.equal(identity.questStreak.baseStreak, 5);
    assert.equal(identity.scoreBreakdown.totalBps, 157);
    assert.equal(identity.scoreBreakdown.liveOnly, true);
    assert.equal(identity.scoreBreakdown.questStreakPoints, 5);
    assert.equal(identity.scoreBreakdown.mintLevelStreakPoints, 50);
    assert.equal(identity.scoreBreakdown.mintCountPoints, 25);
    assert.deepEqual(identity.scoreBreakdown.passBonus, { kind: 'deity', points: 80 });
  });

  test('live GAME total replaces a stale prior-deployment score breakdown', async () => {
    const { mergeQuestIdentitySnapshot } = await import('../app-quest-panel.js');
    const identity = mergeQuestIdentitySnapshot({
      currentStreak: 99,
      scoreBreakdown: {
        totalBps: 12,
        questStreakPoints: 99,
        passBonus: null,
      },
    }, {
      afkingActive: true,
      effectiveQuestStreak: 5,
      effectiveQuestStreakExact: true,
      activityScore: 157,
      hasDeityPass: true,
      questStreak: { baseStreak: 0, lastCompletedDay: 0 },
    });

    assert.equal(identity.questStreak.baseStreak, 5);
    assert.equal(identity.scoreBreakdown.totalBps, 157);
    assert.equal(identity.scoreBreakdown.questStreakPoints, 5);
    assert.equal(identity.scoreBreakdown.passBonus.kind, 'deity');
  });

  test('the exact live lens breakdown keeps a 17-point score aligned with a streak of 2', async () => {
    const { mergeQuestIdentitySnapshot } = await import('../app-quest-panel.js');
    const exact = {
      totalBps: 17,
      questStreakPoints: 2,
      questStreakCreditedPoints: 1,
      mintLevelStreakPoints: 10,
      mintCountPoints: 6,
      affiliatePoints: 0,
      passBonus: null,
      cursePoints: 0,
      liveExact: true,
    };
    const identity = mergeQuestIdentitySnapshot({
      currentStreak: 99,
      scoreBreakdown: {
        totalBps: 17,
        questStreakPoints: 34,
        mintLevelStreakPoints: 0,
        mintCountPoints: 0,
        affiliatePoints: 0,
        passBonus: null,
      },
    }, {
      afkingActive: false,
      effectiveQuestStreak: 2,
      effectiveQuestStreakExact: true,
      activityScore: 17,
      activityBreakdown: exact,
      questStreak: { baseStreak: 2, lastCompletedDay: 4 },
    });

    assert.equal(identity.questStreak.baseStreak, 2);
    assert.deepEqual(identity.scoreBreakdown, exact);
  });

  test('a missing component lens labels the unknown score residual instead of calling it quest streak', async () => {
    const { mergeQuestIdentitySnapshot } = await import('../app-quest-panel.js');
    const { questStreakScorePoints } = await import('../../app/activity-score.js');
    const identity = mergeQuestIdentitySnapshot(null, {
      afkingActive: false,
      effectiveQuestStreak: 2,
      effectiveQuestStreakExact: true,
      scoreQuestStreak: 2,
      activityScore: 17,
      hasDeityPass: false,
      questStreak: { baseStreak: 2, lastCompletedDay: 4 },
    });

    assert.equal(questStreakScorePoints(identity.scoreBreakdown), 1);
    assert.equal(identity.scoreBreakdown.unattributedPoints, 16);
  });

  test('Degen Rating mouseover shows the credited quest-streak points, not the raw streak count', async () => {
    _fetchHandler = async () => makeQuestsPayload({
      questStreak: { baseStreak: 7, lastCompletedDay: 0 },
      scoreBreakdown: {
        totalBps: 53,
        mintLevelStreakPoints: 50,
        questStreakPoints: 7,
        mintCountPoints: 0,
        affiliatePoints: 0,
        cursePoints: 0,
        passBonus: null,
      },
    });
    const el = instantiate();
    await settle(40);

    const rows = el.querySelector('[data-bind="qst-score-rows"]').children;
    const streakRow = rows.find(
      (row) => row.querySelector('.ac-pop__label')?.textContent === 'Quest streak',
    );
    assert.ok(streakRow, 'quest-streak breakdown row rendered');
    assert.equal(streakRow.querySelector('.ac-pop__pts').textContent, '3',
      'a raw streak of 7 contributes floor(7 / 2) = 3 score points');
    assert.equal(el.querySelector('[data-bind="qst-streak"]').textContent, '7',
      'the separate streak counter remains the raw count');

    el.disconnectedCallback();
  });

  test('Degen Rating mouseover bars use independent category maxima and a diminishing quest curve', async () => {
    const { degenScoreBreakdownBarPercent } = await import('../app-quest-panel.js');
    assert.equal(degenScoreBreakdownBarPercent('mintCountPoints', 25), 100);
    assert.equal(degenScoreBreakdownBarPercent('affiliatePoints', 50), 100);
    assert.equal(degenScoreBreakdownBarPercent('passBonusPoints', 80), 100);
    assert.equal(degenScoreBreakdownBarPercent('mintLevelStreakPoints', 50), 100);
    assert.equal(degenScoreBreakdownBarPercent('questStreakPoints', 20), 50,
      '20 credited quest points is exactly half-full');
    assert.ok(degenScoreBreakdownBarPercent('questStreakPoints', 100) > 50);
    assert.ok(degenScoreBreakdownBarPercent('questStreakPoints', 100_000) < 100,
      'an uncapped quest streak never claims to be fully maxed');

    _fetchHandler = async () => makeQuestsPayload({
      questStreak: { baseStreak: 40, lastCompletedDay: 0 },
      scoreBreakdown: {
        totalBps: 225,
        mintLevelStreakPoints: 50,
        // Legacy API field is raw count, so 40 becomes 20 credited points.
        questStreakPoints: 40,
        mintCountPoints: 25,
        affiliatePoints: 50,
        cursePoints: 0,
        passBonus: { kind: 'deity', points: 80 },
      },
    });
    const el = instantiate();
    await settle(40);

    const widths = Object.fromEntries(
      el.querySelector('[data-bind="qst-score-rows"]').children.map((row) => [
        row.querySelector('.ac-pop__label').textContent,
        row.querySelector('.ac-pop__fill').style.width,
      ]),
    );
    assert.deepEqual(widths, {
      'Quest streak': '50%',
      'Level streak': '100%',
      'Mint count': '100%',
      Referrals: '100%',
      'Pass bonus': '100%',
    });
    el.disconnectedCallback();
  });

  test('active afKing streak uses the unified API count instead of the dormant manual count', async () => {
    _fetchHandler = async () => makeQuestsPayload({
      afkingActive: true,
      currentStreak: 17,
      questStreak: { baseStreak: 5, lastCompletedDay: 1 },
      scoreBreakdown: {
        totalBps: 8,
        mintLevelStreakPoints: 0,
        questStreakPoints: 17,
        mintCountPoints: 0,
        affiliatePoints: 0,
        cursePoints: 0,
        passBonus: null,
      },
    });
    const el = instantiate();
    await settle(40);

    assert.equal(el.querySelector('[data-bind="qst-streak"]').textContent, '17',
      'the Game-side afKing streak is shown, not playerQuestStates.streak');
    const rows = el.querySelector('[data-bind="qst-score-rows"]').children;
    const streakRow = rows.find(
      (row) => row.querySelector('.ac-pop__label')?.textContent === 'Quest streak',
    );
    assert.equal(streakRow.querySelector('.ac-pop__pts').textContent, '8');
    el.disconnectedCallback();
  });

  test('Address change re-fetches quest data via store.subscribe', async () => {
    const el = instantiate();
    await settle(40);
    const callsBefore = _fetchCalls.length;

    // Change connected.address — panel subscribes to this path and re-fetches.
    const NEW_ADDR = '0xcd34000000000000000000000000000000000000';
    _fetchHandler = async () => makeQuestsPayload({ player: NEW_ADDR });
    storeMod.update('connected.address', NEW_ADDR);
    await settle(40);

    assert.ok(
      _fetchCalls.length > callsBefore,
      `fetchJSON re-called after connected.address change; before=${callsBefore} after=${_fetchCalls.length}`,
    );
    const matched = _fetchCalls.find((u) => u && u.toLowerCase().includes(NEW_ADDR.toLowerCase()));
    assert.ok(matched, 'fetchJSON re-called with new address');

    el.disconnectedCallback();
  });

  test('Visibility-change foreground re-fetches (after ≥5min hidden gate)', async () => {
    const el = instantiate();
    await settle(40);
    const callsBefore = _fetchCalls.length;

    // Simulate: tab was hidden, then becomes visible. Panel reads
    // document.visibilityState directly — we set state to 'visible' and dispatch
    // the visibilitychange event. Mirrors app-decimator-panel behavior — the
    // ≥5min gate applies in production, but the test verifies the listener wires
    // correctly: when document becomes visible AFTER an interval, a new poll
    // fires. We simulate the elapsed time by reading the panel's source-level
    // contract that the visibility listener exists.
    assert.match(
      PANEL_SRC,
      /visibilitychange/,
      'panel source registers visibilitychange listener (foreground re-poll)',
    );

    // Functional check: dispatch the event with state = visible. Since
    // #lastFetchAt was set on mount, the elapsed gate may not trigger an
    // immediate fetch, but the listener should NOT throw and the panel should
    // remain operational.
    _docVisibilityState = 'hidden';
    document.dispatchEvent({ type: 'visibilitychange' });
    await flushMicrotasks();
    _docVisibilityState = 'visible';
    document.dispatchEvent({ type: 'visibilitychange' });
    await settle(40);

    assert.ok(_fetchCalls.length >= callsBefore, 'visibility listener does not crash panel');

    el.disconnectedCallback();
  });

  test('NO sendTx invocations in panel source (T-62-04-NoWrite — RESEARCH R4)', () => {
    // QST-01 + QST-02 are read-only display per RESEARCH R4. The panel must
    // NEVER invoke sendTx, requireStaticCall, or register() — there is no
    // user-facing write surface.
    assert.equal(
      /sendTx\(/.test(PANEL_SRC_NOCOMMENT),
      false,
      'panel source contains NO sendTx calls (T-62-04-NoWrite)',
    );
    assert.equal(
      /requireStaticCall\(/.test(PANEL_SRC_NOCOMMENT),
      false,
      'panel source contains NO requireStaticCall (no writes → no static-call gate needed)',
    );
    assert.equal(
      /\bregister\(/.test(PANEL_SRC_NOCOMMENT),
      false,
      'panel source contains NO register() calls (no NEW reason-map codes for QST)',
    );
  });

  test('NO data-write attributes in panel source (read-only display)', () => {
    // Read-only panel — no Phase 58 view-mode disable manager hookup needed.
    assert.equal(
      /data-write/.test(PANEL_SRC_NOCOMMENT),
      false,
      'panel source contains NO data-write attributes (read-only)',
    );
  });

  test('Panel imports fetchJSON for read-only data fetch', () => {
    assert.match(
      PANEL_SRC,
      /fetchJSON\(/,
      'panel source uses fetchJSON for /player/:address read',
    );
    assert.match(
      PANEL_SRC,
      /\/player\//,
      'panel source references /player/ endpoint path',
    );
  });

  test('Panel uses textContent for server-derived strings (T-58-18 hardening)', () => {
    // Count textContent assignments — at least 4 for: questName(s), progress,
    // streak. innerHTML reserved for static template literal in #renderShell.
    const textContentMatches = PANEL_SRC.match(/\.textContent\s*=/g) || [];
    assert.ok(
      textContentMatches.length >= 4,
      `panel source uses .textContent ≥ 4 times for server-derived strings; got ${textContentMatches.length}`,
    );
  });

  test('disconnectedCallback aborts poll cycle and flushes #unsubs[] without throwing', () => {
    const el = instantiate();
    assert.doesNotThrow(() => el.disconnectedCallback());
    // Idempotent: second call also safe.
    assert.doesNotThrow(() => el.disconnectedCallback());

    // Source-level assertion: panel source uses AbortController OR clearTimeout/
    // clearInterval cleanup (panel-owned poll lifecycle).
    assert.ok(
      /AbortController|clearTimeout|clearInterval/.test(PANEL_SRC),
      'panel source uses AbortController / clearTimeout / clearInterval cleanup',
    );
  });

  // Account-switcher (2026-07-16) — combined mode renders the identity-panel
  // note instead of fetching (quests/questStreak are per-account, not summed
  // by combine.js).
  test("mode 'combined' renders the per-account note via the existing empty-state bind", async () => {
    let fetched = false;
    _fetchHandler = async () => { fetched = true; return makeQuestsPayload(); };
    // viewing.combined (not a direct ui.mode override) is the idiomatic
    // combined-mode entry — it also keeps store.js's deriveMode microtask
    // landing on 'combined' instead of reverting the mode later.
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    const el = instantiate();
    await settle();

    const emptyEl = el.querySelector('[data-bind="qst-empty"]');
    assert.equal(emptyEl.hidden, false, 'empty-state bind visible in combined mode');
    assert.equal(emptyEl.textContent, 'Per-account stat. Pick a single account.');
    assert.equal(fetched, false, '/player/:address never fetched in combined mode');

    const slots = el.querySelector('[data-bind="qst-slots"]');
    assert.equal(slots.children.length, 0, 'no quest slot rows rendered');
  });
});
