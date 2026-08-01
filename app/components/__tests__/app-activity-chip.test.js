// /app/components/__tests__/app-activity-chip.test.js
//
// Run: cd website && node --test app/components/__tests__/app-activity-chip.test.js
//
// Covers the nav activity chip:
//   - the value: whole POINTS / 100 → the odds multiplier (v70 points migration;
//     totalBps is points, and 155 pts reads 1.55×, not 155×)
//   - the PRIMARY-quest background states, and specifically that unknown stays
//     neutral rather than accusing the player of a miss
//   - the hover breakdown: component rows, bars scaled to the largest component,
//     pass bonus only when non-zero, cashout curse only for the actually-cursed
//   - combined mode showing no score (there is no single player to score)
//   - source gates: the chip PAINTS quest status, it does not derive it — that
//     decision lives once in app-quest-panel #publishPrimaryStatus

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolvePath(__dirname, '../app-activity-chip.js'), 'utf8');

const TEST_ADDR = '0xab12000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Fake DOM — trimmed port of the app-balances-strip.test.js scaffolding.
// ---------------------------------------------------------------------------

function makeFakeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    parentElement: null,
    parentNode: null,
    attributes: {},
    eventListeners: {},
    _innerHTML: '',
    _textContent: '',
    hidden: false,
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
        if (classMatch) for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
        if (/\bhidden\b/.test(attrs)) child.hidden = true;
        child.parentElement = this;
        child.parentNode = this;
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
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, ref) {
      const idx = ref ? this.children.indexOf(ref) : -1;
      child.parentElement = this;
      child.parentNode = this;
      if (idx >= 0) this.children.splice(idx, 0, child);
      else this.children.push(child);
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

const _docBody = makeFakeElement('body');
globalThis.document = {
  createElement: (tag) => makeFakeElement(tag),
  querySelector: (sel) => _docBody.querySelector(sel),
  querySelectorAll: (sel) => _docBody.querySelectorAll(sel),
  getElementById: () => null,
  body: _docBody,
  addEventListener() {},
  removeEventListener() {},
  readyState: 'complete',
};
globalThis.window = globalThis.window || {
  addEventListener() {}, removeEventListener() {},
  location: { search: '', href: 'http://localhost/', hostname: 'localhost' },
};
globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};

// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

const mod = await import('../app-activity-chip.js');
const { COMPONENTS, num } = mod._testing;
const AppActivityChip = globalThis.customElements.get('app-activity-chip');

/** Point global fetch at a fixed /player/:addr body. */
function stubPlayer(scoreBreakdown) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ scoreBreakdown }) });
}

function breakdown(overrides = {}) {
  return {
    totalBps: 155,
    questStreakPoints: 40,
    mintLevelStreakPoints: 50,
    mintCountPoints: 25,
    affiliatePoints: 40,
    ...overrides,
  };
}

async function mountChip() {
  const el = new AppActivityChip();
  el.connectedCallback();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

const bind = (el, name) => el.querySelector(`[data-bind="${name}"]`);

// ===========================================================================
// Pure helpers
// ===========================================================================

describe('num', () => {
  test('coerces numeric strings and passes numbers through', () => {
    assert.equal(num('40'), 40);
    assert.equal(num(-12), -12);
  });

  test('anything non-finite reads as zero, never NaN into the DOM', () => {
    assert.equal(num(undefined), 0);
    assert.equal(num('abc'), 0);
    assert.equal(num(Infinity), 0);
  });
});

describe('COMPONENTS', () => {
  test('the four always-shown score components, in panel order', () => {
    assert.deepEqual(COMPONENTS.map((c) => c.key), [
      'questStreakPoints', 'mintLevelStreakPoints', 'mintCountPoints', 'affiliatePoints',
    ]);
  });

  test('curse is NOT a standing row — a permanent "Curse 0" invites the wrong question', () => {
    assert.ok(!COMPONENTS.some((c) => c.key === 'cursePoints'));
  });
});

// ===========================================================================
// The chip value
// ===========================================================================

describe('chip value', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', TEST_ADDR);
    stubPlayer(breakdown());
  });

  test('whole POINTS render as the odds multiplier (155 pts → 1.55×)', async () => {
    const el = await mountChip();
    assert.equal(bind(el, 'ac-value').textContent, '1.55×');
    el.disconnectedCallback();
  });

  test('a zero-score player still renders a number, not an em dash', async () => {
    stubPlayer(breakdown({ totalBps: 0 }));
    const el = await mountChip();
    assert.equal(bind(el, 'ac-value').textContent, '0.00×');
    el.disconnectedCallback();
  });

  test('no wallet → em dash, no fabricated 1.00×', async () => {
    storeMod.update('connected.address', null);
    const el = await mountChip();
    assert.equal(bind(el, 'ac-value').textContent, '—');
    el.disconnectedCallback();
  });

  test('combined mode shows no score — there is no single player to score', async () => {
    storeMod.update('viewing.combined', true);
    storeMod.update('ui.mode', 'combined');
    const el = await mountChip();
    assert.equal(bind(el, 'ac-value').textContent, '—');
    el.disconnectedCallback();
  });

  test('a failed fetch degrades to em dash rather than a stale number', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const el = await mountChip();
    assert.equal(bind(el, 'ac-value').textContent, '—');
    el.disconnectedCallback();
  });
});

// ===========================================================================
// Primary-quest background
// ===========================================================================

describe('primary quest status', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', TEST_ADDR);
    stubPlayer(breakdown());
  });

  test('completed → done', async () => {
    storeMod.update('ui.primaryQuest', { completed: true, afking: false });
    const el = await mountChip();
    const chip = bind(el, 'ac-chip');
    assert.equal(chip.classList.contains('unav-activity--done'), true);
    assert.equal(chip.getAttribute('title'), 'Primary daily quest complete');
    el.disconnectedCallback();
  });

  test('an afKing sub delivers the primary — done, and the title says why', async () => {
    // Slot 0 is unconditionally MINT_ETH, which is exactly what the sub does on
    // every funded day, so a subscriber's primary lands without a quest row.
    storeMod.update('ui.primaryQuest', { completed: true, afking: true });
    const el = await mountChip();
    assert.equal(bind(el, 'ac-chip').getAttribute('title'),
      'Primary daily quest handled by your afKing subscription');
    el.disconnectedCallback();
  });

  test('not done yet → todo', async () => {
    storeMod.update('ui.primaryQuest', { completed: false, afking: false });
    const el = await mountChip();
    const chip = bind(el, 'ac-chip');
    assert.equal(chip.classList.contains('unav-activity--todo'), true);
    assert.equal(chip.classList.contains('unav-activity--done'), false);
    el.disconnectedCallback();
  });

  test('completed:null → unknown, NOT todo ("we do not know" must not read as "you missed it")', async () => {
    storeMod.update('ui.primaryQuest', { completed: null, afking: false });
    const el = await mountChip();
    const chip = bind(el, 'ac-chip');
    assert.equal(chip.classList.contains('unav-activity--unknown'), true);
    assert.equal(chip.classList.contains('unav-activity--todo'), false);
    assert.equal(chip.getAttribute('title'), 'Daily quest status unknown');
    el.disconnectedCallback();
  });

  test('no published status at all → unknown', async () => {
    const el = await mountChip();
    assert.equal(bind(el, 'ac-chip').classList.contains('unav-activity--unknown'), true);
    el.disconnectedCallback();
  });

  test('a status update repaints without refetching the score', async () => {
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      return { ok: true, json: async () => ({ scoreBreakdown: breakdown() }) };
    };
    const el = await mountChip();
    const after = fetches;
    storeMod.update('ui.primaryQuest', { completed: true, afking: false });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(bind(el, 'ac-chip').classList.contains('unav-activity--done'), true);
    assert.equal(fetches, after, 'a repaint must not spend an API call');
    el.disconnectedCallback();
  });
});

// ===========================================================================
// Hover breakdown
// ===========================================================================

describe('breakdown popover', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', TEST_ADDR);
    stubPlayer(breakdown());
  });

  test('head carries both the multiplier and the raw points', async () => {
    const el = await mountChip();
    assert.equal(bind(el, 'ac-pop-head').textContent, '1.55× odds multiplier · 155 pts');
    el.disconnectedCallback();
  });

  test('one row per component, bars scaled against the largest', async () => {
    const el = await mountChip();
    const rows = bind(el, 'ac-pop-rows').children;
    assert.equal(rows.length, 4);
    assert.equal(rows[0].querySelector('.ac-pop__label').textContent, 'Quest streak');
    assert.equal(rows[0].querySelector('.ac-pop__pts').textContent, '40');
    // Level streak is the max (50) → full bar; quest streak 40/50 → 80%.
    assert.equal(rows[1].querySelector('.ac-pop__fill').style.width, '100%');
    assert.equal(rows[0].querySelector('.ac-pop__fill').style.width, '80%');
    el.disconnectedCallback();
  });

  test('pass bonus appears only when it carries points', async () => {
    const el = await mountChip();
    assert.equal(bind(el, 'ac-pop-rows').children.length, 4);
    el.disconnectedCallback();

    stubPlayer(breakdown({ passBonus: { points: 115 } }));
    const el2 = await mountChip();
    const rows = bind(el2, 'ac-pop-rows').children;
    assert.equal(rows.length, 5);
    assert.equal(rows[4].querySelector('.ac-pop__label').textContent, 'Pass bonus');
    el2.disconnectedCallback();
  });

  test('the curse row is for the actually-cursed only, and renders negative', async () => {
    stubPlayer(breakdown({ cursePoints: -30 }));
    const el = await mountChip();
    const rows = bind(el, 'ac-pop-rows').children;
    const curse = rows[rows.length - 1];
    assert.equal(curse.querySelector('.ac-pop__label').textContent, 'Cashout curse');
    assert.equal(curse.querySelector('.ac-pop__pts').textContent, '-30');
    assert.equal(curse.className.includes('ac-pop__row--neg'), true);
    el.disconnectedCallback();
  });

  test('an all-zero breakdown does not divide by zero', async () => {
    stubPlayer(breakdown({
      totalBps: 0,
      questStreakPoints: 0,
      mintLevelStreakPoints: 0,
      mintCountPoints: 0,
      affiliatePoints: 0,
    }));
    const el = await mountChip();
    for (const row of bind(el, 'ac-pop-rows').children) {
      assert.equal(row.querySelector('.ac-pop__fill').style.width, '0%');
    }
    el.disconnectedCallback();
  });

  test('the popover footer states the quest status in words', async () => {
    storeMod.update('ui.primaryQuest', { completed: true, afking: true });
    const el = await mountChip();
    const q = bind(el, 'ac-pop-quest');
    assert.equal(q.textContent, 'Primary daily quest: handled by afKing');
    assert.match(q.className, /ac-pop__quest--done/);
    el.disconnectedCallback();
  });
});

// ===========================================================================
// Source gates
// ===========================================================================

describe('source gates', () => {
  test('the chip PAINTS quest status — it never derives it', () => {
    // Two components deriving "is the primary done?" independently would
    // eventually disagree, invisibly. app-quest-panel #publishPrimaryStatus owns
    // the decision; this chip only reads the published value.
    assert.match(src, /subscribe\('ui\.primaryQuest'/);
    assert.ok(!/questType\s*===\s*0|slot\s*===\s*0/.test(src),
      'chip must not re-derive the primary slot');
  });

  test('server-derived strings go through textContent, never innerHTML', () => {
    const assignments = src.match(/\.innerHTML\s*=/g) || [];
    assert.equal(assignments.length, 1, `innerHTML assigned ${assignments.length}× — shell only`);
    assert.match(src, /#renderShell\(\)\s*\{\s*this\.innerHTML/);
  });

  test('breakdown rows are built with createElement', () => {
    assert.match(src, /document\.createElement\('div'\)/);
    assert.match(src, /label\.textContent = v\.label/);
  });

  test('the poll timer is unref-ed so node:test never hangs on it', () => {
    assert.match(src, /_setIntervalUnref/);
    assert.match(src, /typeof h\.unref === 'function'/);
  });

  test('the score fetch is sequence-guarded against out-of-order responses', () => {
    assert.match(src, /#fetchSeq/);
    assert.match(src, /if \(seq !== this\.#fetchSeq\) return/);
  });

  test('disconnect drops every subscription and the poll timer', () => {
    const teardown = src.slice(src.indexOf('disconnectedCallback'), src.indexOf('#renderShell() {'));
    assert.match(teardown, /clearInterval\(this\.#pollHandle\)/);
    assert.match(teardown, /this\.#unsubs\.forEach/);
  });
});
