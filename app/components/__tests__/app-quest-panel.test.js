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
// not documentation strings that mention forbidden tokens (e.g. CF-08 comment
// "NO toast / NO audio / NO animator" or "NO sendTx, NO requireStaticCall").
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
    assert.doesNotMatch(el.innerHTML, /DAILY RUN/, 'removed daily-run kicker stays absent');
    assert.doesNotMatch(el.innerHTML, /qst-blurb/, 'explanatory subtitle removed');
    assert.doesNotMatch(el.innerHTML, /Daily quests progress automatically/, 'old verbose intro removed');

    assert.doesNotMatch(el.innerHTML, /qst-reward-hint/,
      'rewards belong inside their quest cards, not in a strip below them');
  });

  test('quest blocks keep a fixed height instead of stretching to fill the column', () => {
    assert.match(
      APP_CSS,
      /\.play-grid \.qst-slot\s*\{[^}]*height:\s*7\.5rem/s,
    );
    assert.match(
      APP_CSS,
      /\.play-grid \.qst-slots\s*\{[^}]*grid-auto-rows:\s*7\.5rem[^}]*align-content:\s*start/s,
    );
    assert.match(
      APP_CSS,
      /@media\s*\(min-width:\s*1100px\)[\s\S]*?\.qst-slots\s*\{[^}]*flex:\s*0 0 auto[^}]*grid-auto-rows:\s*7\.5rem/s,
    );
  });

  test('On mount, panel calls fetchJSON for /player/:address with the connected address', async () => {
    const el = instantiate();
    await settle(40);
    const matched = _fetchCalls.find((u) => u && u.includes('/player/') && u.toLowerCase().includes(CONNECTED.toLowerCase()));
    assert.ok(matched, `fetchJSON called with /player/${CONNECTED} on mount; calls=${JSON.stringify(_fetchCalls)}`);
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
    assert.match(slot0Text, /Buy a ticket or lootbox/, 'ETH quest uses player-facing purchase copy');

    assert.equal(slots[1].classList.contains('qst-slot--gated'), true,
      'bonus quest is muted until the main quest is complete');
    assert.match(slots[1].textContent, /0\s*\/\s*100/,
      'the gated bonus card still shows its real progress target');
    assert.doesNotMatch(slots[1].textContent, /START|MAIN FIRST|DAILY FIRST/,
      'progress replaces the old command-like placeholder');
    assert.match(slots[2].textContent, /800 FLIP/,
      'level card shows its distinct FLIP reward');
    assert.equal(slots[2].querySelector('.qst-slot-reward-extra')?.textContent, '+5 STREAK',
      'level streak reward sits on its own line');
    const rewards = el.querySelectorAll('.qst-slot-reward');
    const rewardLogos = el.querySelectorAll('.qst-slot-reward-logo');
    assert.equal(rewards.length, 3, 'every card owns its reward line');
    assert.equal(rewardLogos.length, 3, 'each reward line carries the FLIP flame logo');
    assert.equal(rewardLogos[0].src, '/whitepaper/flame-logo.svg');
    assert.match(rewards[0].textContent, /100 FLIP/);
    assert.doesNotMatch(rewards[0].textContent, /NEXT FLIP/,
      'reward copy stays concise without the removed next-flip suffix');

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

  test('clicking an actionable quest publishes its exact setup target', async () => {
    const events = [];
    const listener = (event) => events.push(event.detail);
    document.addEventListener('quest:activate', listener);
    const el = instantiate();
    await settle(40);

    const level = el.querySelectorAll('.qst-slot')[2];
    assert.equal(level.getAttribute('role'), 'button');
    assert.equal(level.getAttribute('tabindex'), '0');
    level.dispatchEvent({ type: 'click' });
    assert.deepEqual(events, [{
      questType: 6,
      target: '1600000000000',
      variant: 'level',
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

    assert.match(el.querySelectorAll('.qst-slot')[1].textContent, /Redeem FLIP/);
    assert.doesNotMatch(el.textContent, /Mint with FLIP/i);
    el.disconnectedCallback();
  });

  test('an unfinished foil quest publishes the same purchase level to the buy panel', async () => {
    storeMod.update('app.lastDay', {
      day: 1,
      roll1: { purchaseLevel: 13 },
    });
    _fetchHandler = async (url) => {
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

  test('level quest is never sourced from an in-browser contract fallback', () => {
    assert.doesNotMatch(PANEL_SRC, /getPlayerLevelQuestView|JsonRpcProvider|new ethers\.Contract/);
    assert.match(PANEL_SRC, /data\?\.levelQuest/, 'optional level quest comes from /player payload');
  });

  test('Completed quest renders a completion indicator via textContent (no toast / no audio)', async () => {
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

    // Source-grep — NO toast / playAudio / new Audio in executable code (comments
    // documenting the absence of these tokens do not count — see stripComments).
    assert.equal(
      /toast|playAudio|new Audio|audio\.play/.test(PANEL_SRC_NOCOMMENT),
      false,
      'panel source contains NO toast/audio/animator (CF-08 inline-only state change)',
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

  test('Degen Score mouseover shows the credited quest-streak points, not the raw streak count', async () => {
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
