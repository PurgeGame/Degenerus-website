// /app/components/__tests__/last-day-jackpot.test.js — Phase 59 Plan 59-01 (JKP-03)
// Run: cd website && node --test app/components/__tests__/last-day-jackpot.test.js
//
// Tests Custom Element registration + 3-status branch render scaffolding.
// Plan 59-02 extends with subscribe-driven render tests.
// Plan 59-03 extends with localStorage idempotency + banner + highlight tests.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const APP_CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const REPLAY_CSS = readFileSync(new URL('../../styles/replay.css', import.meta.url), 'utf8');
const PROCESSING_CSS = readFileSync(new URL('../../styles/jackpot-processing.css', import.meta.url), 'utf8');
const DRAWING_CSS = readFileSync(new URL('../../styles/daily-drawing.css', import.meta.url), 'utf8');
const FOIL_ROUTING_SVG = readFileSync(new URL('../../assets/jackpot/daily-drawing-foil-routing-v5.svg', import.meta.url), 'utf8');
const BOARD_ROUTING_SVG = readFileSync(new URL('../../assets/jackpot/daily-drawing-board-routing-v7.svg', import.meta.url), 'utf8');
const SILKSCREEN_SVG = readFileSync(new URL('../../assets/jackpot/daily-drawing-board-silkscreen-v3.svg', import.meta.url), 'utf8');
const CANONICAL_FLAME_SVG = readFileSync(new URL('../../../whitepaper/flame-center.svg', import.meta.url), 'utf8');
const CANONICAL_CHAINLINK_SVG = readFileSync(new URL('../../../symbols/crypto_05_chainlink_blue.svg', import.meta.url), 'utf8');
// The silkscreen bakes the deployed game address, so the legend is checked
// against the profile the app is actually pointed at rather than a literal.
const CHAIN_PROFILE_SRC = readFileSync(new URL('../../app/chain-config.sepolia.js', import.meta.url), 'utf8');
const REPLAY_PANEL_SRC = readFileSync(new URL('../replay-panel.js', import.meta.url), 'utf8');
const LAST_DAY_SRC = readFileSync(new URL('../last-day-jackpot.js', import.meta.url), 'utf8');
const INDEX_SRC = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Fake DOM (mirrors view-mode-banner.test.js fake-DOM scaffolding)
// + globalThis.localStorage shim (forward-compat with Plan 59-03 idempotency tests).
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
      // Crude parse: extract elements with id, data-bind, class, and style attrs
      // so querySelector can find them. Elements are flat children (no nesting tree
      // — but querySelector walks the flat list, which is sufficient for the
      // Plan 59-01 tests since each data-bind hook is unique).
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
        const idMatch = /\bid="([^"]+)"/.exec(attrs);
        if (idMatch) child.attributes.id = idMatch[1];
        const classMatch = /\bclass="([^"]+)"/.exec(attrs);
        if (classMatch) {
          for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
        }
        const styleMatch = /\bstyle="([^"]+)"/.exec(attrs);
        if (styleMatch) {
          for (const decl of styleMatch[1].split(';')) {
            const [k, v] = decl.split(':').map(s => s && s.trim());
            if (k && v) child.style[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
          }
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
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
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

// ---------------------------------------------------------------------------
// Fake document + globalThis stubs — installed BEFORE dynamic import of the
// component (which needs HTMLElement at module-load time for class extends).
// ---------------------------------------------------------------------------

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
    for (const fn of [...arr]) {
      try { fn(ev); } catch { /* swallow */ }
    }
    return true;
  },
  visibilityState: 'visible',
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

// localStorage shim — forward-compat with Plan 59-03 idempotency tests.
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

// Plan 59-01 widget does NOT call fetch (factory's runRoll1 is unreachable while
// #pinnedDay is null; button stays disabled). Stub for safety.
globalThis.fetch = async () => { throw new Error('fetch should not be called in Plan 59-01 tests'); };

function resetDom() {
  _docBody = makeFakeElement('body');
  globalThis.document.body = _docBody;
  globalThis.document.querySelector = (sel) => _docBody.querySelector(sel);
  globalThis.document.querySelectorAll = (sel) => _docBody.querySelectorAll(sel);
  globalThis.localStorage.clear();
  _docListeners.clear();
}

async function flushMicrotasks() {
  // A day summary fans through viewer + pack reads and then (when boxes were
  // opened) a dependent leg-feed read. Drain the complete promise chain so a
  // click test cannot leak its in-flight summary lock into the next case.
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Imports under test — store.js is safe to static-import (no HTMLElement use).
// last-day-jackpot.js is dynamic-imported inside beforeEach so the FakeHTMLElement
// stub is installed BEFORE the class declaration runs (ESM static imports hoist
// above the `globalThis.HTMLElement = ...` assignment above).
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';
import * as coinflipMod from '../../app/coinflip.js';
import * as pendingActionsMod from '../../app/pending-actions.js';
import { CHAIN } from '../../app/chain-config.js';
import { traitToBadge } from '../../app/jackpot-data.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('the host does not add a day-wide winner effect over a losing scratch phase', () => {
  const src = readFileSync(new URL('../last-day-jackpot.js', import.meta.url), 'utf8');
  const handler = src.match(/#onPanelScratchComplete\(e\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.doesNotMatch(handler, /celebrateProtocol|#celebrate/);
  assert.doesNotMatch(src, /celebrateProtocol/,
    'the replay board is the sole, phase-aware owner of the jackpot winner effect');
});

test('only live scratch covers show the custom coin cursor', () => {
  assert.match(
    REPLAY_CSS,
    /\.replay-center-canvas\s*\{[^}]*cursor:\s*url\('\/app\/assets\/scratch-coin-cursor\.svg'\) 20 20, crosshair/s,
  );
  assert.match(
    REPLAY_CSS,
    /\.replay-scratch-canvas\s*\{[^}]*cursor:\s*url\('\/app\/assets\/scratch-coin-cursor\.svg'\) 20 20, crosshair/s,
  );
  assert.equal(
    existsSync(new URL('../../assets/scratch-coin-cursor.svg', import.meta.url)),
    true,
    'the cursor asset ships with the scratch board',
  );
});

test('the Daily Drawing is a responsive branded attraction rather than an empty full-width cabinet', () => {
  assert.match(INDEX_SRC, /styles\/daily-drawing\.css/);
  assert.match(
    INDEX_SRC,
    /jackpot-hero__draw-mark[^>]*\/app\/assets\/jackpot\/flame-center-silver\.svg[^>]*width="38" height="54"/s,
  );
  assert.equal(
    existsSync(new URL('../../assets/jackpot/flame-center-silver.svg', import.meta.url)),
    true,
    'the marquee uses the real protocol flame instead of a second custom emblem',
  );
  assert.match(
    DRAWING_CSS,
    /--jp-board-size:\s*clamp\(15rem, 68cqi, 28rem\);[\s\S]*?width:\s*min\(100%, 48rem\);/,
    'the board grows at stacked widths while the illustrated cabinet stops stretching',
  );
  assert.match(
    DRAWING_CSS,
    /jackpot-hero__draw-title\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*row;[^}]*width:\s*min\(35rem, 94%\)[^}]*height:\s*2\.72rem[^}]*align-items:\s*center[^}]*justify-content:\s*center/s,
    'the real mark and full attraction name share one unboxed centered line',
  );
  assert.match(DRAWING_CSS,
    /jackpot-hero__draw-title::before,[\s\S]*?jackpot-hero__draw-title::after\s*\{[^}]*position:\s*static[^}]*clip-path:\s*none/s,
    'the title uses fine PCB rails instead of another banner or plaque');
  assert.match(DRAWING_CSS,
    /jackpot-hero__draw-title > strong\s*\{[^}]*white-space:\s*nowrap/s,
    'the attraction name cannot fall back into the old two-line lockup');
});

describe("Plan 59-01: <last-day-jackpot> Custom Element shell", () => {
  test('Bonus Spin requires every visibly possible-win panel to be scratched', async () => {
    const { countUnscratchedPotentialWinPanels } = await import('../replay-panel.js');

    assert.equal(countUnscratchedPotentialWinPanels({
      quadOwned: [true, false, false, false],
      scratched: [false, false, false, false],
    }), 1, 'a blue/gold possible-win quadrant keeps Bonus Spin locked');
    assert.equal(countUnscratchedPotentialWinPanels({
      quadOwned: [true, false, false, false],
      scratched: [true, false, false, false],
    }), 0, 'untouched red guaranteed-loss quadrants do not keep Bonus Spin locked');
    assert.equal(countUnscratchedPotentialWinPanels({
      quadOwned: [true, true, false, false],
      scratched: [true, false, false, false],
    }), 1, 'an owned miss stays required because its visible color marked it as potentially winning');
    assert.equal(countUnscratchedPotentialWinPanels({
      quadOwned: [false, false, false, false],
      scratched: [false, false, false, false],
      centerWinCount: 1,
      centerScratched: false,
    }), 1, 'an actual center payout remains protected by its scratch cover');
    assert.equal(countUnscratchedPotentialWinPanels({
      quadOwned: [false, false, false, false],
      scratched: [false, false, false, false],
      centerWinCount: 1,
      centerScratched: true,
    }), 0, 'scratching the winning center completes the possible-win gate');

    assert.match(
      REPLAY_PANEL_SRC,
      /#mainReadyForBonus\(\)\s*\{[^}]*#mainSpinComplete[^}]*#mainPotentialScratchComplete/s,
      'Bonus Spin uses a durable possible-win gate after Roll 1 finishes',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /#refreshMainPotentialScratchGate\(\)\s*\{[\s\S]*?countUnscratchedPotentialWinPanels\(\{\s*quadOwned:\s*this\.#quadOwned/,
      'the live gate consumes the same ownership state that paints blue/gold covers',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /const allDone = this\.#scratched\.every\(s => s\)[\s\S]*?this\.#dispatchScratchComplete\(\)/,
      'the spoiler/persistence event still waits for the complete board',
    );
  });

  test('the jackpot uses one fancy Spin control without a duplicate processing bubble', () => {
    assert.match(REPLAY_PANEL_SRC, /const MAIN_SPIN_LABEL = 'SPIN JACKPOT'/);
    assert.match(REPLAY_PANEL_SRC, /const BONUS_SPIN_LABEL = 'BONUS SPIN'/);
    assert.match(REPLAY_PANEL_SRC, /const COINFLIP_LABEL = 'FLIP COIN'/);
    assert.match(REPLAY_PANEL_SRC, /const SPIN_AGAIN_LABEL = 'SPIN AGAIN'/);
    assert.match(REPLAY_PANEL_SRC,
      /btn\.textContent = crankLabel\s*\n\s*\? \(this\.#mineFlipBusy \? MINE_FLIP_MINING_LABEL : MINE_FLIP_CRANK_LABEL\)\s*\n\s*: stage\.label/,
      'the processing key reports the stage unless the crank has taken the face');
    assert.match(REPLAY_PANEL_SRC, /setJackpotProcessingState\(signals = null\)/);
    assert.match(REPLAY_PANEL_SRC, /jackpotProcessingPresentationStep/);
    assert.doesNotMatch(REPLAY_PANEL_SRC, /textContent = '(?:Reveal Draw|Revealing\.\.\.|Bonus Roll|Replay)'/);
    assert.doesNotMatch(LAST_DAY_SRC, /SPIN AVAILABLE SOON/);
    assert.doesNotMatch(INDEX_SRC, /SPIN AVAILABLE SOON|jackpot-load-status/);
    assert.match(DRAWING_CSS,
      /replay-controls\s*\{[^}]*height:\s*3\.24rem[^}]*padding:\s*0\.31rem[^}]*border:\s*1px solid #616864[^}]*outline:\s*1px solid rgba\(160, 119, 45, 0\.42\)[^}]*background:\s*linear-gradient\(180deg, #343936/s,
      'the control has a permanent clean hardware bezel on the board');
    const controlBezel = DRAWING_CSS.match(/replay-controls\s*\{[^}]*\}/s);
    assert.ok(controlBezel);
    assert.doesNotMatch(controlBezel[0], /radial-gradient\(circle at (?:6px|calc\(100% - 6px\))/,
      'the display bezel no longer carries decorative corner dots');
    assert.match(DRAWING_CSS,
      /replay-controls > \.replay-reveal-btn,[\s\S]*?replay-controls > \.ldj-results-cta\s*\{[^}]*--jp-led-a:\s*255, 63, 122[^}]*border-radius:\s*7px[^}]*background-color:\s*#070609[^}]*clip-path:\s*none[^}]*var\(--font-display[^}]*opacity:\s*1/s,
      'Spin and Day Summary use the same rounded arcade-LED face');
    assert.match(DRAWING_CSS,
      /replay-reveal-btn:not\(:disabled\),[\s\S]*?replay-controls > \.ldj-results-cta\s*\{[^}]*linear-gradient\(102deg, rgb\(var\(--jp-led-a\)\), rgb\(var\(--jp-led-b\)\) 48%, rgb\(var\(--jp-led-c\)\)\) border-box[^}]*color:\s*#fffaf0/s,
      'actionable and informational states light all three LED colours');
    assert.match(REPLAY_PANEL_SRC,
      /setCoinflipHandoff\([\s\S]*?#coinflipHandoffReady\([\s\S]*?startCoinflipFromJackpot/s,
      'the same LCD advances from both jackpot rolls into the Community Coinflip');
    assert.match(DRAWING_CSS,
      /replay-reveal-btn\.is-coinflip\s*\{[^}]*--jp-led-a:\s*34, 211, 238[^}]*--jp-led-b:\s*52, 211, 153[^}]*--jp-led-c:\s*129, 140, 248/s,
      'the coinflip handoff has a distinct cyan, green, and violet LED palette');
    assert.match(DRAWING_CSS,
      /replay-reveal-btn:disabled:not\(\.is-processing\):not\(\.is-spinning\)\s*\{[^}]*linear-gradient\(180deg, #111014 0%, #070609 100%\)[^}]*background-color:\s*#070609[^}]*color:\s*#68636b[^}]*text-shadow:\s*none/s,
      'a disabled LED bank stays neutral instead of inheriting a live action palette');
    assert.match(DRAWING_CSS,
      /replay-reveal-btn:not\(:disabled\):not\(\.is-processing\):not\(\.is-spinning\),[\s\S]*?ldj-results-cta\s*\{[^}]*animation:\s*jackpot-key-attract/s,
      'a key waiting for the player runs the attract loop; processing and spinning keep steady panes');
    assert.match(DRAWING_CSS,
      /@keyframes jackpot-key-attract\s*\{[\s\S]*?rgba\(var\(--jp-led-b\), 0\.34\)[\s\S]*?rgba\(var\(--jp-led-c\), 0\.24\)/,
      'the attract peak hands its glow from the warm LED to the cool LED');
    assert.match(DRAWING_CSS,
      /replay-reveal-btn\.is-bonus\s*\{[^}]*--jp-led-a:\s*244, 114, 182[^}]*--jp-led-b:\s*255, 214, 92[^}]*--jp-led-c:\s*167, 139, 250/s,
      'the bonus key uses a pink, gold, and violet LED palette');
    assert.match(DRAWING_CSS,
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?jackpot-key-attract[\s\S]*?\}|@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?ldj-results-cta::after\s*\{\s*animation:\s*none/s,
      'reduced motion parks the attract loop and its sheen');
    assert.doesNotMatch(REPLAY_PANEL_SRC, /Bonus round ready/,
      'bonus readiness is shown by the shared spin control instead of floating over the board');
    assert.match(REPLAY_PANEL_SRC, /<p class="replay-hint" aria-hidden="true"><\/p>/,
      'the original board-to-control spacing remains as a permanently empty spacer');
    assert.doesNotMatch(REPLAY_PANEL_SRC, /data-bind="hint"|hint\.textContent/,
      'nothing can write floating status text into the spacer');
    assert.doesNotMatch(REPLAY_PANEL_SRC, /replay-no-bonus|data-bind="no-bonus"|No bonus round/,
      'the legacy no-bonus status does not create another floating row');
    assert.doesNotMatch(
      REPLAY_PANEL_SRC,
      /' possible-win panel'|' panels remaining'|' panel' \+ \(remaining !== 1/,
      'scratch progress is not printed as floating text over the jackpot controls');
    assert.match(REPLAY_PANEL_SRC, /const BONUS_SPIN_LOCKED_LABEL = 'SCRATCH TO UNLOCK BONUS'/,
      'the actionable scratch requirement lives on the shared jackpot control');
    assert.match(
      DRAWING_CSS,
      /\.replay-hint\s*\{[^}]*height:\s*1rem[^}]*min-height:\s*1rem[^}]*flex-basis:\s*1rem[^}]*margin:\s*0\.12rem 0 0\.08rem/s,
      'the empty spacer preserves the exact prior gap geometry');
    assert.match(
      APP_CSS,
      /replay-panel\[single-button\] \.replay-bonus-section\[hidden\]\s*\{[^}]*display:\s*flex !important[^}]*visibility:\s*hidden/s,
      'the original lower control-row footprint remains unchanged');
    assert.match(APP_CSS, /\.replay-reveal-btn\.is-processing\s*\{[^}]*cursor:\s*wait[^}]*opacity:\s*1/s);
    assert.match(
      APP_CSS,
      /\.replay-reveal-btn\.is-bonus:disabled:not\(\.is-processing\):not\(\.is-spinning\)\s*\{[^}]*padding:\s*0\.55rem 0\.5rem;[^}]*font-size:\s*clamp\(0\.6rem, 2\.3vw, 0\.68rem\);[^}]*letter-spacing:\s*0\.045em/s,
      'the long scratch-to-unlock label stays inside the compact action slot',
    );
    // The key reports the VRF wait with the word alone. The one larger module
    // at the board's lower-right owns progress, so the key carries neither a second
    // Chainlink mark nor a bar duplicating what they already say.
    assert.doesNotMatch(PROCESSING_CSS, /crypto_05_chainlink_blue\.svg/,
      'the RNG key prints no Chainlink mark of its own; the bottom-right module is the mark');
    assert.match(PROCESSING_CSS,
      /is-processing:is\(\[data-jp-stage="rng"\], \[data-jp-stage="rng-arrived"\]\)::before\s*\{\s*content:\s*none/s,
      'and it carries no stage icon at all through the two RNG beats');
    assert.match(PROCESSING_CSS,
      /is-processing\[data-jp-stage="coinflip"\]::before\s*\{\s*content:\s*none/s,
      'coinflip processing prints no redundant mini ETH badge beside its label');
    assert.doesNotMatch(PROCESSING_CSS, /coinflip-face-eth\.svg/,
      'the processing key no longer loads the ETH face as a stage ornament');
    assert.match(PROCESSING_CSS,
      /\.replay-reveal-btn\.is-processing::after\s*\{\s*content:\s*none/s,
      'the segmented progress bar is gone from the processing key entirely');
    assert.equal((REPLAY_PANEL_SRC.match(/class="jackpot-chainlink jackpot-chainlink--/g) || []).length, 1,
      'one Chainlink instrument occupies the board lower-right');
    assert.equal((REPLAY_PANEL_SRC.match(/jackpot-chainlink__cell jackpot-chainlink__cell--/g) || []).length, 6,
      'the one Chainlink instrument keeps six independently addressable sides');
    assert.match(REPLAY_PANEL_SRC, /jackpot-chainlink__core">VRF<\/span>/,
      'the remaining module carries a labelled center power lamp');
    assert.match(DRAWING_CSS,
      /--jp-chainlink-size:\s*clamp\(2\.3rem, 7\.6cqi, 2\.9rem\)/,
      'the single module is enlarged from the old paired hardware');
    assert.match(DRAWING_CSS,
      /jackpot-chainlink--right\s*\{[^}]*left:\s*calc\(100% \+ var\(--jp-chainlink-gap\)\)/s,
      'the module is mounted beyond the key at the board lower-right');
    assert.doesNotMatch(REPLAY_PANEL_SRC, /jackpot-chainlink--left/,
      'the second Chainlink unit is removed rather than merely hidden');
    // Brand recognition outranks LED texture on this instrument. The silhouette
    // is masked from the SAME artwork the board prints when Chainlink is the
    // drawn crypto trait, so it is the real mark rather than six bars arranged
    // into something hexagon-shaped.
    assert.match(CANONICAL_CHAINLINK_SVG, /m18\.9 0-4 2\.3L4 8\.6/,
      'the canonical Chainlink artwork still carries the hexagon-ring path this instrument masks');
    assert.match(DRAWING_CSS,
      /\.jackpot-chainlink::before\s*\{[^}]*mask:\s*url\('\/symbols\/crypto_05_chainlink_blue\.svg'\) center \/ contain no-repeat/s,
      'the standby instrument is the canonical Chainlink mark, unbroken');
    assert.match(DRAWING_CSS,
      /\.jackpot-chainlink__cell\s*\{[^}]*mask:\s*url\('\/symbols\/crypto_05_chainlink_blue\.svg'\) center \/ contain no-repeat/s,
      'every addressable cell is a band of that same mark, so lighting one cannot break the logo');
    assert.doesNotMatch(DRAWING_CSS, /clip-path:\s*polygon\(7% 0/,
      'the six beveled LED segments that only approximated a hexagon are gone');
    assert.doesNotMatch(DRAWING_CSS, /--jp-chainlink-radius/,
      'nothing still lays the cells out on a ring radius');
    // The wait is reported as a chain assembling, one link per side of the
    // hexagon ring. Height bands were the earlier attempt: a band lights the
    // part of the ring the fill is darkest in, so two lit read as six lit.
    //
    // The sector is a MASK LAYER, never a clip-path, and that is load-bearing.
    // A clip-path is a path in the element's own box while the artwork is a
    // rasterised mask image, and Chrome snaps the mask raster to whole pixels
    // while it does not snap the path. This module hangs off a fluid,
    // container-query-sized row, so its box lands on a FRACTIONAL x, and the
    // two drifted apart by however much that fraction was: measured across a
    // range of sub-pixel offsets the clip-path seam wandered from 1.50% of the
    // box short of the vertex to 0.30% PAST it, about 0.58px of swing, and past
    // the vertex is the direction that reads broken. No constant angle can
    // correct an error that changes with the layout. Composited into the mask,
    // the sector and the artwork snap together and the seam does not move.
    assert.doesNotMatch(DRAWING_CSS, /jackpot-chainlink__cell[^{]*\{[^}]*clip-path:/s,
      'the wedge is composited into the mask, never clipped: a clip-path does not snap '
      + 'with the mask raster, so its seam drifts off the corner by up to half a pixel');
    assert.match(DRAWING_CSS,
      /\.jackpot-chainlink__cell\s*\{[^}]*mask-composite:\s*intersect/s,
      'the artwork layer and the sector layer INTERSECT, so a lit link is one side of the mark');
    assert.match(DRAWING_CSS,
      /\.jackpot-chainlink__cell\s*\{[^}]*-webkit-mask-composite:\s*source-in/s,
      'with the WebKit spelling carried alongside it');
    assert.equal((DRAWING_CSS.match(/jackpot-chainlink__cell--\d \{\n\s*--jp-link-a-angle:/g) || []).length, 6,
      'all six links are sectors of the mark, one per side of the ring');
    // The sector is TWO HALF-PLANES, never one conic sector, and that is what
    // keeps the seams straight. A conic sector's edges both pass through its
    // centre, so biasing an edge can only ROTATE it — and a rotated seam is no
    // longer parallel to the corner miter it runs along. On the two vertical
    // seams that showed: a 250px edge leaning 0.75 degrees drifts ~0.7px
    // sideways, crosses a pixel boundary partway down, and rasterises with a
    // notch in it. A half-plane boundary moves PARALLEL to itself, so the bias
    // is an offset and every cut stays exactly on its meridian.
    assert.doesNotMatch(DRAWING_CSS, /jackpot-chainlink__cell\s*\{[^}]*conic-gradient/s,
      'a conic sector cannot be biased without rotating its edges off the miter, '
      + 'which is what put a stair-step in the vertical seams');
    assert.equal((DRAWING_CSS.match(/linear-gradient\(\s*var\(--jp-link-[ab]-angle\)/g) || []).length, 4,
      'both mask shorthands carry both half-planes');
    //
    // Overlap between them is DIRECTIONAL. Overlap goes only into the neighbour
    // that is already lit when a link fires, where it is lit-on-lit and can
    // never print; every EXPOSED edge is pulled SHORT instead. At 28-38px a
    // corner is two or three device pixels, so an edge exactly on the miter
    // still antialiases into the first pixel of the dark face. Undershoot
    // surrenders a sliver back to the dim standby ring and still reads as a
    // corner; overshoot reads as broken.
    //
    // Checked as geometry, not as a string: each edge is given as a gradient
    // angle plus the stop where that gradient turns off, which is a straight
    // boundary at a chosen angle AND distance. Recover both back out.
    const CHAINLINK_CX = 49.82;
    const CHAINLINK_CY = 49.64;
    const CHAINLINK_OVERLAP = 2.0;   // % of the box, pushed OUTWARD onto lit material
    const CHAINLINK_BIAS = 0.45;     // % of the box, pulled INWARD on an exposed edge
    const vertexOf = (a) => (((Math.round((a - 30) / 60) * 60 + 30) % 360) + 360) % 360;
    const signedDeg = (d) => {
      const v = (((d % 360) + 360) % 360);
      return v > 180 ? v - 360 : v;
    };
    /**
     * A CSS gradient angle A has direction d = (sin A, -cos A) and its line is
     * centred on the BOX, whose length for a square box is 100(|sin|+|cos|).
     * Undo that to get the boundary's angle and its perpendicular offset from
     * the MARK's centre. `kind` picks which side of the line the sector is on.
     */
    const readEdge = (angleDeg, stopPct, kind) => {
      const ar = (angleDeg * Math.PI) / 180;
      const d = [Math.sin(ar), -Math.cos(ar)];
      const L = 100 * (Math.abs(Math.sin(ar)) + Math.abs(Math.cos(ar)));
      const s = (L * (stopPct - 50)) / 100;
      const alongD = s - ((CHAINLINK_CX - 50) * d[0] + (CHAINLINK_CY - 50) * d[1]);
      const n = [-d[0], -d[1]];           // inward normal: into the kept sector
      const phi = kind === 'start'
        ? Math.atan2(-n[0], n[1])
        : Math.atan2(n[0], -n[1]);
      return {
        phi: ((((phi * 180) / Math.PI) % 360) + 360) % 360,
        offset: -alongD,                  // + is inward (short), - is outward (overlap)
      };
    };
    const wedges = [...DRAWING_CSS.matchAll(
      /jackpot-chainlink__cell--(\d) \{\n\s*--jp-link-a-angle: (-?[\d.]+)deg;\n\s*--jp-link-a-stop: (-?[\d.]+)%;\n\s*--jp-link-b-angle: (-?[\d.]+)deg;\n\s*--jp-link-b-stop: (-?[\d.]+)%;\n\}/g,
    )];
    assert.equal(wedges.length, 6, 'each of the six links is two half-planes: an angle and a stop each');
    const links = [];
    for (const [, index, aAngle, aStop, bAngle, bStop] of wedges) {
      const link = Number(index);
      const a = readEdge(Number(aAngle), Number(aStop), 'start');
      const b = readEdge(Number(bAngle), Number(bStop), 'end');
      const startVertex = vertexOf(a.phi);
      const endVertex = vertexOf(b.phi);
      // THE anti-jag invariant: a cut must lie EXACTLY on its vertex meridian,
      // because that meridian is the corner's own miter (the ring's inner and
      // outer vertices share a radial). Any rotation off it both tilts the seam
      // away from the miter and makes a near-vertical edge step.
      assert.ok(Math.abs(signedDeg(a.phi - startVertex)) < 0.02,
        `link ${link} trailing cut sits at ${a.phi.toFixed(3)} degrees, off its ${startVertex} meridian: `
        + 'a cut that is not parallel to the corner miter rasterises with a step in it');
      assert.ok(Math.abs(signedDeg(b.phi - endVertex)) < 0.02,
        `link ${link} leading cut sits at ${b.phi.toFixed(3)} degrees, off its ${endVertex} meridian: `
        + 'a cut that is not parallel to the corner miter rasterises with a step in it');
      // Link 1 fires with BOTH neighbours dark, so both its edges are exposed.
      // Link 6 closes the ring against two lit neighbours and is the only link
      // that overruns at both ends.
      const wantA = link === 1 ? CHAINLINK_BIAS : -CHAINLINK_OVERLAP;
      const wantB = link === 6 ? -CHAINLINK_OVERLAP : CHAINLINK_BIAS;
      assert.ok(Math.abs(a.offset - wantA) < 0.01,
        `link ${link} trailing edge is offset ${a.offset.toFixed(3)}% of the box, expected ${wantA}`);
      assert.ok(Math.abs(b.offset - wantB) < 0.01,
        `link ${link} leading edge is offset ${b.offset.toFixed(3)}% of the box, expected ${wantB}: `
        + 'the frontier of a part-filled ring stops just inside the corner, never overhanging it');
      links.push({ link, startVertex, endVertex });
    }
    // Outward has to beat inward or the closed ring keeps a dim seam where two
    // links meet: the overlap must swallow the bias its neighbour gave up.
    assert.ok(CHAINLINK_OVERLAP > CHAINLINK_BIAS,
      'the overlap must exceed the bias, or the closed ring shows a dim hairline at every joint');
    links.sort((a, b) => a.link - b.link);
    // Fill order IS ring order, and the ring is read as a CLOCK: link 1 is the
    // side leaving 12 o'clock and every later link is the next one clockwise.
    // The delays below run 1..5 in cell order, so the sectors have to sweep the
    // ring that way or the lit region arrives in two pieces with dark between.
    assert.equal(links[0].startVertex, 270,
      'the chain starts at the TOP vertex — 12 o\'clock — not at the bottom');
    assert.deepEqual(links.map((l) => l.startVertex), [270, 330, 30, 90, 150, 210],
      'the links sweep the ring clockwise in fill order, the way a hand sweeps a clock face');
    for (let i = 0; i < links.length; i += 1) {
      const next = links[(i + 1) % links.length];
      assert.equal(links[i].endVertex, next.startVertex,
        `link ${links[i].link} ends exactly where link ${next.link} begins, so the lit region is always ONE arc`);
    }
    assert.deepEqual([...links.map((l) => l.startVertex)].sort((a, b) => a - b), [30, 90, 150, 210, 270, 330],
      'the six sectors tile the whole ring with no side owned twice and none left dark');
    assert.equal(links[5].endVertex, links[0].startVertex,
      'and the last link closes back onto 12 o\'clock, where the first one started');
    assert.doesNotMatch(DRAWING_CSS, /clip-path: polygon\(49\.82% 49\.64%,/,
      'the polygon wedges are gone: a path that does not snap with the mask is what '
      + 'walked the frontier off its corner in the first place');
    // The two seams on the vertical meridian are the ones a stair-step shows up
    // on, and 90/270 are the only gradient angles whose iso-lines are exactly
    // vertical. Pinned literally so the straightness cannot be refactored away.
    assert.match(DRAWING_CSS,
      /jackpot-chainlink__cell--3 \{\n\s*--jp-link-a-angle: 30deg;\n\s*--jp-link-a-stop: [\d.]+%;\n\s*--jp-link-b-angle: 270deg;/,
      'the 6 o\'clock seam is cut by an exactly vertical gradient');
    assert.match(DRAWING_CSS,
      /jackpot-chainlink__cell--1 \{\n\s*--jp-link-a-angle: 270deg;/,
      'and so is the 12 o\'clock seam the chain starts from');
    // Chrome does not antialias a gradient hard stop here, so the diagonals came
    // out as a bare staircase. Measured at 10x: 0.15px smears the cut into a
    // three-pixel ramp and stops reading as an edge; 0.06px resolves the
    // staircase and leaves the vertical seams a single crisp transition pixel.
    const feather = DRAWING_CSS.match(/--jp-link-feather:\s*([\d.]+)px/);
    assert.ok(feather, 'the seams carry a feather');
    assert.ok(Number(feather[1]) > 0 && Number(feather[1]) <= 0.08,
      `the feather is ${feather[1]}px: big enough to resolve the diagonal staircase, `
      + 'small enough that the cut still reads as an edge rather than a blur');
    assert.match(DRAWING_CSS,
      /#000 calc\(var\(--jp-link-a-stop\) - var\(--jp-link-feather\)\),\s*\n\s*transparent calc\(var\(--jp-link-a-stop\) \+ var\(--jp-link-feather\)\)/,
      'and it is symmetric about the stop, so the 50% crossing stays exactly on the '
      + 'biased line and a softened edge cannot creep past its corner');
    assert.match(DRAWING_CSS,
      /\.jackpot-chainlink\s*\{[^}]*isolation:\s*isolate[^}]*border:\s*1px solid #2a312e[^}]*border-radius:\s*7px[^}]*radial-gradient\(110% 38% at 22% -18%, rgba\(255, 255, 255, 0\.04\)[^}]*linear-gradient\(155deg, #151816 0%, #090c0b 48%, #020303 100%\)/s,
      'the VRF module is an opaque satin black-plastic package, so routing terminates beneath physical hardware');
    assert.doesNotMatch(DRAWING_CSS,
      /\.jackpot-chainlink\s*\{[^}]*repeating-linear-gradient\(135deg/s,
      'the face has no fake diagonal texture competing with its broad plastic highlight');
    assert.match(REPLAY_PANEL_SRC, /jackpot-chainlink__pins/,
      'the physical module includes its solder leads in the live markup');
    assert.match(DRAWING_CSS,
      /jackpot-chainlink__pins\s*\{[^}]*inset:\s*-0\.11rem[^}]*linear-gradient\(145deg, #8a948f 0%, #46504b 38%, #171d1a 100%\)[^}]*-webkit-mask:[^}]*0\.13rem[^}]*opacity:\s*0\.68/s,
      'short shaded gunmetal contacts mount the module without an orange sunburst');
    assert.doesNotMatch(DRAWING_CSS,
      /jackpot-chainlink__pins\s*\{[^}]*#b98a3e/s,
      'the module contacts contain no bright orange metal');
    // The original pending treatment fills five sides once over the expected
    // request window. Each side retains its completed frame; the sixth side is
    // reserved for the actual arrival event that closes the mark.
    for (const [link, delay] of [[1, '0s'], [2, '4s'], [3, '8s'], [4, '12s'], [5, '16s']]) {
      assert.match(DRAWING_CSS,
        new RegExp(`data-jp-rng-requested\\]\\[data-jp-stage='rng'\\][\\s\\S]*?`
          + `jackpot-chainlink__cell--${link} \\{ animation: `
          + `jackpot-chainlink-cell-charge 240ms ease-out ${delay} both`),
        `link ${link} fills ${delay} after the request and then stays lit`);
    }
    assert.equal((DRAWING_CSS.match(/animation: jackpot-chainlink-cell-charge/g) || []).length, 5,
      'only five sides are elapsed-wait steps; time alone cannot fake RNG arrival');
    assert.match(DRAWING_CSS,
      /is-processing\[data-jp-stage='rng-arrived'\][\s\S]*?jackpot-chainlink__cell\s*\{[^}]*#4d75df[^}]*opacity:\s*1[^}]*animation:\s*none/s,
      'RNG arrival immediately closes the sixth side and ends the pending fill');
    assert.match(DRAWING_CSS,
      /data-jp-stage='rng-arrived'\]\s*\) \.jackpot-chainlink\s*\{[^}]*animation:\s*jackpot-chainlink-closed 720ms/s,
      'arrival gets one restrained closing acknowledgement');
    assert.match(DRAWING_CSS,
      /@keyframes jackpot-chainlink-cell-charge\s*\{[\s\S]*?0% \{ opacity:\s*0; \}[\s\S]*?55% \{ opacity:\s*1; filter:\s*brightness\(1\.5\); \}[\s\S]*?100% \{ opacity:\s*1;/,
      'each fill step turns on once and retains its completed frame');
    assert.doesNotMatch(DRAWING_CSS, /jackpot-chainlink-(?:send-ring|link-chase)/,
      'the unlimited orbiting treatment is gone');
    assert.doesNotMatch(DRAWING_CSS,
      /is-processing:not\(\[data-jp-stage='rng'\]\)[\s\S]*?jackpot-chainlink__cell\s*\{/s,
      'ordinary ticket processing cannot light the VRF ring');
    assert.doesNotMatch(DRAWING_CSS,
      /\.jackpot-chainlink__cell\s*\{[^}]*#c5d6ff/s,
      'the lit instrument stays below the SPIN key: no near-white cell fill');
    // Lit and dim are each ONE value. The mark's own modelling used to be a
    // top-to-bottom ramp on the standby layer, which left the upper sides of
    // the resting mark about four times brighter than the lower ones — more
    // spread than lit-vs-dim itself carried. A lit link on a lower side then
    // read dimmer than an unlit link on an upper one and a part-filled ring
    // looked broken rather than part-filled.
    assert.match(DRAWING_CSS,
      /\.jackpot-chainlink__cell\s*\{[^}]*background:\s*#6f9bf2;/s,
      'a lit link is one flat LED blue, so any two lit links read identically wherever they sit on the ring');
    assert.match(DRAWING_CSS,
      /\.jackpot-chainlink::before\s*\{[^}]*background:\s*#1a294d;/s,
      'and the unlit remainder is one flat dim blue, so no unlit side can outshine a lit one');
    assert.doesNotMatch(DRAWING_CSS, /#3a5aa6|#16255a/,
      'the standby ramp that shaded the resting mark top-bright is gone');
    assert.match(DRAWING_CSS, /animation: ldj-foil-lane-flow 1\.05s linear infinite/,
      'the bank lanes retain their restrained machine cadence');
    const keyToJackpotRoutes = [
      'M456 1098V1018L438 1000H432L414 982V915',
      'M548 1098V1038L530 1020H524L506 1002V915',
      'M732 1098V1038L750 1020H756L774 1002V915',
      'M824 1098V1018L842 1000H848L866 982V915',
    ];
    for (const route of keyToJackpotRoutes) {
      assert.ok(BOARD_ROUTING_SVG.includes(`d="${route}"`),
        `the fixed power tree owns copper route ${route}`);
    }
    const currentStart = INDEX_SRC.indexOf('<svg class="jackpot-board-current"');
    const currentEnd = INDEX_SRC.indexOf('</svg>', currentStart);
    assert.ok(currentStart > 0 && currentEnd > currentStart,
      'the machine owns an inline, page-controlled board-current layer');
    const boardCurrentMarkup = INDEX_SRC.slice(currentStart, currentEnd + 6);
    const boardCurrentRoutes = [...boardCurrentMarkup.matchAll(
      /<path id="jackpotBoardRoute\d" d="([^"]+)"\/>/g,
    )]
      .map((match) => match[1]);
    assert.deepEqual(boardCurrentRoutes, keyToJackpotRoutes,
      'live board current mirrors exactly the four real key-to-widget copper routes');
    assert.doesNotMatch(BOARD_ROUTING_SVG, /M994 1116H930|M994 1158H930/,
      'the fixed-coordinate module feeds are removed instead of remaining as two orphaned stubs');
    assert.doesNotMatch(BOARD_ROUTING_SVG,
      /M1070 1116H1052L1030 1094V1028L1008 1006|M920 1006H672|M640 988V915/,
      'the direct shortcut and the line hugging the processor bottom are gone');
    assert.doesNotMatch(BOARD_ROUTING_SVG,
      /<use href="#via" x="(?:920" y="1006|640" y="988|1070" y="1116)"\/>/,
      'the three plated contacts that existed only for the removed shortcut are gone too');
    assert.doesNotMatch(BOARD_ROUTING_SVG, /d="M(?:250|1030) 1100V1028/,
      'the old interlock start that floated free of the phone module is gone');
    assert.doesNotMatch(BOARD_ROUTING_SVG,
      /<use href="#via" x="(?:930|994)" y="(?:1116|1158)"\/>/,
      'VRF-to-key pads stay hidden beneath their hardware instead of making a row of dots beside the display');
    assert.doesNotMatch(BOARD_ROUTING_SVG, /x="(?:210|286)" y="(?:1116|1158)"/,
      'no source vias remain where the removed left unit used to sit');
    assert.doesNotMatch(DRAWING_CSS,
      /daily-drawing-(?:button-current-v1|board-current-v6)\.svg/,
      'no fixed-coordinate current sheet can redraw deleted or detached circuitry');
    assert.doesNotMatch(DRAWING_CSS, /\.jackpot-hero__machine::before/,
      'the obsolete full-board current overlay is removed instead of animating unrelated routes');
    assert.match(DRAWING_CSS,
      /> \.jackpot-board-current\s*\{[^}]*z-index:\s*1;[^}]*opacity:\s*0;[^}]*pointer-events:\s*none/s,
      'the inline widget routes are dark and inert outside a live roll');
    assert.match(DRAWING_CSS,
      /:has\(\s*replay-panel \.replay-reveal-btn\.is-spinning\s*\) > \.jackpot-board-current\s*\{[^}]*opacity:\s*0\.62;/s,
      'only a board roll exposes the widget-current layer');
    assert.match(DRAWING_CSS,
      /\.jackpot-board-current use\s*\{[^}]*vector-effect:\s*non-scaling-stroke;/s,
      'both live layers keep the same physical line weight under responsive stretching');
    assert.match(DRAWING_CSS,
      /\.jackpot-board-current__rail\s*\{[^}]*opacity:\s*0\.24;[\s\S]*?\.jackpot-board-current__packet use\s*\{[^}]*stroke-dasharray:\s*7 27;/s,
      'a quiet energized rail stays visible beneath the brighter travelling packets');
    assert.match(DRAWING_CSS,
      /@keyframes jackpot-board-current-flow\s*\{\s*to\s*\{\s*stroke-dashoffset:\s*-34;/,
      'the source-first paths send current upward from the key into the board');
    assert.doesNotMatch(DRAWING_CSS, /jackpot-board-current-ready/,
      'an idle enabled key no longer makes the dormant VRF bus look active');
    assert.match(DRAWING_CSS,
      /--jp-chainlink-gap:\s*clamp\(1\.15rem, 4\.2cqi, 1\.8rem\)/,
      'the single module sits farther to the right of the button bezel');
    assert.match(DRAWING_CSS,
      /jackpot-chainlink__core\s*\{[^}]*background:\s*transparent[^}]*color:\s*transparent[^}]*opacity:\s*0[^}]*text-shadow:\s*none/s,
      'the VRF lettering is effectively invisible at rest, with no white badge behind it');
    assert.match(DRAWING_CSS,
      /replay-reveal-btn\.is-spinning[\s\S]*?jackpot-chainlink__core\s*\{[^}]*color:\s*#fff[^}]*opacity:\s*1[^}]*0 0 6px rgba\(255, 255, 255, 0\.96\)/s,
      'only a live jackpot draw turns the fixed-size letters into the bright white VRF LED');
    assert.doesNotMatch(DRAWING_CSS,
      /replay-reveal-btn(?:\.is-processing|:is\([^)]*\.is-processing)[\s\S]{0,160}?jackpot-chainlink__core\s*\{/s,
      'ticket processing never illuminates the white VRF legend');
    assert.doesNotMatch(DRAWING_CSS,
      /replay-reveal-btn:is\([^)]*\.is-processing[^)]*\)[\s\S]{0,160}?jackpot-chainlink__pins\s*\{/s,
      'ticket processing leaves the module contacts dormant too');
    const vrfCoreKeyframes = DRAWING_CSS.match(
      /@keyframes jackpot-vrf-core \{(?:[^{}]|\{[^{}]*\})*\}/s,
    );
    assert.ok(vrfCoreKeyframes, 'the white LED still breathes through light intensity');
    assert.doesNotMatch(vrfCoreKeyframes[0], /transform:|scale\(/,
      'VRF never pulses in size');
    assert.doesNotMatch(DRAWING_CSS, /jackpot-chainlink::after|jackpot-vrf-key-(?:bus|launch)/,
      'no pseudo-element overlay can draw the VRF circuit across the front of the key');
    assert.match(REPLAY_PANEL_SRC,
      /jackpot-chainlink__lead jackpot-chainlink__lead--top[\s\S]*?jackpot-chainlink__lead jackpot-chainlink__lead--bottom/,
      'two explicit leads reconnect the module without adding decorative endpoint dots');
    assert.match(DRAWING_CSS,
      /jackpot-chainlink__lead\s*\{[^}]*right:\s*100%[^}]*width:\s*var\(--jp-chainlink-gap\)[^}]*height:\s*1px[^}]*background:\s*#b98a38[^}]*box-shadow:\s*0 0 3px rgba\(208, 163, 76, 0\.05\)[^}]*opacity:\s*0\.27/s,
      'each responsive lead spans only the exposed gap and matches the quiet board copper');
    assert.match(DRAWING_CSS,
      /jackpot-chainlink__lead--top\s*\{[^}]*top:\s*38%[\s\S]*?jackpot-chainlink__lead--bottom\s*\{[^}]*top:\s*62%/s,
      'the two straight traces disappear under the package between its square mounting contacts');
    assert.doesNotMatch(DRAWING_CSS,
      /jackpot-chainlink__lead[^}]*radial-gradient|jackpot-chainlink__lead[^}]*border-radius/s,
      'the reconnect carries neither endpoint dots nor pill-shaped ornaments');
    assert.match(DRAWING_CSS,
      /\) \.jackpot-chainlink__lead\s*\{[^}]*repeating-linear-gradient[^}]*animation:\s*jackpot-chainlink-lead-flow 720ms linear infinite/s,
      'the two real traces carry a blue-white packet with a soft tail instead of holding solid blue');
    assert.match(DRAWING_CSS,
      /@keyframes jackpot-chainlink-lead-flow\s*\{\s*to\s*\{\s*background-position:\s*-28px 0;/,
      'the packet travels left from the right-hand Chainlink module toward the button');
    assert.match(DRAWING_CSS,
      /replay-reveal-btn\.is-spinning\s*\) \.jackpot-chainlink__lead--bottom\s*\{\s*animation-delay:\s*-180ms;/s,
      'the second trace follows the first as a paired send instead of flashing as one thick line');
    assert.doesNotMatch(DRAWING_CSS,
      /(?:data-jp-rng-requested|data-jp-stage='rng-arrived')[\s\S]{0,180}?jackpot-chainlink__lead/,
      'RNG request and arrival states cannot power the send traces before the board rolls');
    // The module used to BLOOM here: a 30px halo on the plate and a 5px
    // drop-shadow pulsing on a 1.05s clock. Mid-draw that made the supply the
    // brightest thing on the board, competing with the reels and the SPIN key
    // for the eye. It is a slight pulse now — the mark breathes on a slow
    // clock, the plate around it stays dark. The current leaving the modules is
    // concentrated on the actual module and its two physical leads.
    assert.doesNotMatch(DRAWING_CSS,
      /replay-reveal-btn\.is-spinning\s*\)\s*\.jackpot-chainlink\s*\{[^}]*0 0 30px rgba\(70, 120, 226/s,
      'the drawing-state module no longer blooms a halo onto the plate');
    assert.match(DRAWING_CSS,
      /replay-reveal-btn\.is-spinning\s*\)\s*\.jackpot-chainlink\s*\{[^}]*animation:\s*jackpot-chainlink-source 1\.44s/s,
      'the shell answers on the same clock as the send sweep and board routes');
    // Scoped to the keyframes block itself: one level of nesting, so a stray
    // `[^@]*` cannot wander into the rules that follow it.
    const sourceKeyframes = DRAWING_CSS.match(
      /@keyframes jackpot-chainlink-source \{(?:[^{}]|\{[^{}]*\})*\}/s,
    );
    assert.ok(sourceKeyframes, 'the drawing-state breath still has its keyframes');
    assert.doesNotMatch(sourceKeyframes[0], /box-shadow:/,
      'and the breath never animates a box-shadow: that is what put light on the plate');
    assert.match(sourceKeyframes[0], /brightness\(1\.1\)/,
      'the pulse is a slight brightness lift on the mark, not a beacon');
    assert.match(DRAWING_CSS,
      /> \.replay-reveal-btn\.is-spinning\s*\) \.jackpot-chainlink__cell\s*\{[^}]*opacity:\s*1;[^}]*animation:\s*none;/s,
      'a running drawing holds the complete Chainlink mark fully lit beside VRF');
    assert.match(BOARD_ROUTING_SVG,
      /inline \.jackpot-board-current sheet in\s*\n\s*app\/index\.html mirrors exactly these four processor branches/,
      'the copper documents its exact live widget-current mirror');
    assert.doesNotMatch(BOARD_ROUTING_SVG, /M42 1050|M1238 1050|M74 1116|M1206 1116/,
      'the former lower perimeter traces no longer terminate at nowhere');
    // Endpoints authored against the desktop box alone floated free of their
    // part on a phone, where the processor, sockets and VRF modules all sit at
    // different measured coordinates. Every start now lands inside the
    // INTERSECTION of both measured boxes.
    assert.doesNotMatch(BOARD_ROUTING_SVG, /V930"/,
      'the jackpot fanout does not stop below the phone processor edge');
    assert.equal((BOARD_ROUTING_SVG.match(/d="M(?:456|548|732|824) 1098V/g) || []).length, 8,
      'all four key-first branches reach the processor, halo copies included');
    // The lower-socket ground bonds are GONE (v6). They ran the full left and
    // right gutters from under the socket to a plated via on the perimeter rail
    // at x=84 / x=1196 — the two longest exposed traces on the sheet, ending on
    // a dot beside the frame. Landing on the rail was the v4/v5 defence and it
    // was never a defence: a rail is an edge, not a part, so a player reads the
    // trace as going nowhere no matter what is drawn at the end of it.
    assert.doesNotMatch(BOARD_ROUTING_SVG, /d="M(?:160|1120) (?:780|866)/,
      'the lower-socket ground bonds are gone, not re-terminated');
    assert.doesNotMatch(BOARD_ROUTING_SVG, /<use href="#via" x="(?:84|1196|134|1146)" y="1116"/,
      'and so are the four vias whose only job was to end them');
    // What is left in that group connects socket J1 to socket J2 down the
    // gutter: two parts, both of which the player can point at.
    assert.match(BOARD_ROUTING_SVG, /d="M126 400V486L110 502V612L126 628V740"/,
      'the surviving gutter lane still links the two foil sockets to each other');
    // Nothing on the copper may terminate on the rail any more. The rail is
    // still drawn — it is a closed loop from a processor via back to a
    // processor via and reads as the board's edge — but no lane ends on it.
    const railX = ['84', '1196'];
    const boardRoutes = [...BOARD_ROUTING_SVG.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1]);
    for (const route of boardRoutes) {
      if (route.startsWith('M240 128H130')) continue;  // the perimeter rail itself
      const endsOnRail = railX.some((x) => route.endsWith(`H${x}`) || route.endsWith(`V${x}`));
      assert.equal(endsOnRail, false, `${route} must not dead-end on the perimeter rail`);
    }
    assert.doesNotMatch(BOARD_ROUTING_SVG, /d="M(?:148|1132) 278H/,
      'the socket buses no longer leave above the phone socket lip');
    assert.match(
      PROCESSING_CSS,
      /data-jp-stage="rng"[\s\S]*?rgba\(20, 22, 26, 0\.98\)[\s\S]*?rgba\(34, 34, 40, 0\.97\)/,
      'the Chainlink mark sits on a graphite field instead of a blue block',
    );
    assert.doesNotMatch(PROCESSING_CSS, /14\.285714%/,
      'the seven-cell bar inside the key is gone');
    assert.doesNotMatch(PROCESSING_CSS, /--jp-rng-progress|jackpot-rng-progress/,
      'and so is the elapsed-time bar that duplicated the modules\' own chase');
    assert.match(
      PROCESSING_CSS,
      /--jp-led-a:\s*52, 211, 153[\s\S]*?--jp-led-b:\s*250, 204, 21[\s\S]*?--jp-led-c:\s*56, 189, 248[\s\S]*?linear-gradient\(102deg, rgb\(var\(--jp-led-a\)\), rgb\(var\(--jp-led-b\)\) 48%, rgb\(var\(--jp-led-c\)\)\) border-box/,
      'processing keeps live progress in the same three-colour LED chassis',
    );
    // The pipeline fill survives as the LED bank's own light sweep, which is a
    // wash behind the word rather than a second instrument competing with it.
    assert.match(
      PROCESSING_CSS,
      /rgba\(var\(--jp-led-b\), 0\.24\) 0 calc\(var\(--jp-progress, 0\) \* 100%\)/,
      'the confirmed-milestone count still lights the LED face itself',
    );
    assert.match(INDEX_SRC, /jackpot-processing\.css/,
      'the state visualization is loaded after the app surface it augments');
    assert.doesNotMatch(
      APP_CSS,
      /replay-panel\[data-day-(?:warming|loading)\] \.replay-controls[^\{]*\{\s*visibility:\s*hidden/s,
      'processing leaves the stable action row visible',
    );
  });

  test('a processing refresh cannot repaint an active main or bonus spin CTA', async () => {
    await import('../replay-panel.js');
    const Ctor = customElements.get('replay-panel');
    assert.ok(Ctor, 'replay panel is registered');

    for (const label of ['SPINNING…', 'BONUS SPINNING…']) {
      const panel = new Ctor();
      panel.innerHTML = '<button data-bind="reveal-btn"></button>';
      const button = panel.querySelector('[data-bind="reveal-btn"]');
      button.textContent = label;
      button.disabled = false;
      button.classList.add('is-spinning');

      panel.attributeChangedCallback('data-day-warming', null, '');

      assert.equal(button.textContent, label,
        'the live spin wording survives a background processing repaint');
      assert.equal(button.disabled, true, 'the running action remains inert');
      assert.equal(button.getAttribute('aria-busy'), 'true');
    }
  });

  test('bonus trait hydration cannot blank the board before the reel loop owns it', () => {
    const start = REPLAY_PANEL_SRC.indexOf('async #triggerBonusRoll()');
    const end = REPLAY_PANEL_SRC.indexOf('\n  #syncDrawToggleAffordance()', start);
    const flow = REPLAY_PANEL_SRC.slice(start, end);
    const hydrateAt = flow.indexOf('await this.#loadFutureTraits()');
    const clearAt = flow.indexOf('this.#resetMainWidget()');
    const spinAt = flow.indexOf('await this.#runSpin(displayTraits)');

    assert.ok(hydrateAt >= 0 && clearAt >= 0 && spinAt >= 0,
      'the bonus flow contains hydration, board reset, and reel start');
    assert.ok(hydrateAt < clearAt,
      'the settled main board remains painted while future traits hydrate');
    assert.ok(clearAt < spinAt,
      'the board clears only when the reel loop is ready to paint its first frame');
  });

  test('a reloaded DAY SUMMARY owns the LCD before a loading repaint can claim it', async () => {
    await import('../replay-panel.js');
    const Ctor = customElements.get('replay-panel');
    const panel = new Ctor();
    panel.innerHTML = `
      <div class="replay-controls">
        <button data-bind="reveal-btn"></button>
        <button class="ldj-results-cta">DAY SUMMARY</button>
      </div>`;
    const reveal = panel.querySelector('[data-bind="reveal-btn"]');
    const summary = panel.querySelector('.ldj-results-cta');
    summary.hidden = false;

    panel.attributeChangedCallback('data-day-loading', null, '45');

    assert.equal(reveal.hidden, true, 'the loading control cannot coexist with Day Summary');
    assert.equal(reveal.classList.contains('is-processing'), false);
    assert.match(DRAWING_CSS,
      /replay-controls > \.replay-reveal-btn\[hidden\],[\s\S]*?replay-controls > \.ldj-results-cta\[hidden\]\s*\{[^}]*display:\s*none !important/s,
      'author display rules cannot override the single-control hidden state');
  });

  test('the loading attract reel keeps ownership-aware pink and blue faces', async () => {
    assert.match(
      APP_CSS,
      /replay-panel\[data-day-loading\] \.replay-tq\.q-has-trait:not\(\.q-gold-trait\)\s*\{[^}]*background:\s*#b8d4e8/s,
    );
    assert.match(
      APP_CSS,
      /replay-panel\[data-day-loading\] \.replay-tq\.q-no-tickets\s*\{[^}]*background:\s*rgba\(239, 120, 120, 0\.5\)/s,
    );
    assert.doesNotMatch(
      APP_CSS,
      /replay-panel\[data-day-loading\] \.replay-tq\s*\{[^}]*background:\s*#bfc2c7/s,
      'the loading mask must not flatten the ownership reel to gray',
    );
    const dayChange = REPLAY_PANEL_SRC.match(
      /async #onDayChange\(e\)\s*\{([\s\S]*?)\n  #onPlayerChange/,
    )?.[1] || '';
    assert.match(
      dayChange,
      /await this\.#loadPlayerTraits\(\);[\s\S]*const rollDataReady/,
      'loading colors hydrate from the target purchase-level holdings before the gate clears',
    );
    const { replayHoldingsLevel } = await import('../replay-panel.js');
    assert.equal(replayHoldingsLevel({
      selectedDay: 81,
      processingDay: 81,
      processingPurchaseLevel: 44,
    }), 44, 'the pre-RNG board uses the live cabinet level without waiting for Roll 1');
    assert.equal(replayHoldingsLevel({
      selectedDay: 81,
      processingDay: 81,
      processingPurchaseLevel: 44,
      exactPurchaseLevel: 43,
    }), 43, 'settled exact-day data remains authoritative once it arrives');
    assert.equal(replayHoldingsLevel({
      selectedDay: 81,
      processingDay: 82,
      processingPurchaseLevel: 44,
      selectedLevel: 31,
    }), 32, 'another day\'s processing signal cannot recolor a historical board');
    assert.match(
      LAST_DAY_SRC,
      /purchaseLevel[\s\S]*?foilPackDisplayLevel\(gameState, contractPhase\)[\s\S]*?setJackpotProcessingState/,
      'the host forwards the live cabinet ticket level into the pre-RNG board',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /purchaseLevelChanged[\s\S]*?this\.#playerTraitIds = new Set\(\);[\s\S]*?this\.#loadPlayerTraits\(\)/,
      'a newly available live level refreshes holdings while the slow reel is already running',
    );
  });
  test('solo bucket receipts use the truncating ETH formatter in either viewer state', () => {
    assert.match(
      REPLAY_PANEL_SRC,
      /currencyWinnerCount === 1[\s\S]*?formatEthTruncated\(summary\.perWinWei\.toString\(\)\)/,
      'a public ×1 bucket uses the compact payout',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /const isSoloBucket = Number\(this\.#quadPublicSummaries\[qIdx\]\?\.winnerCount\) === 1[\s\S]*?isSoloBucket[\s\S]*?formatEthTruncated\(ethTotal\.toString\(\)\)/,
      'the winner-facing YOU WON receipt uses the same compact payout',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /currency === 'ETH' && currencyWinnerCount === 1[\s\S]*?replay-bucket-reveal--solo-eth/,
      'the public losing-viewer solo ETH result gets its dedicated larger treatment',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /const isSoloEthWin = hasPlayerWin[\s\S]*?this\.#isSoloEthWinner\(i\)[\s\S]*?if \(isSoloEthWin\) quads\[i\]\.classList\.add\('q-solo-eth-win'\)/,
      'an actual solo winner gets a dedicated quadrant state',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-tq\.q-solo-eth-win\.q-has-tickets\s*\{[^}]*background:\s*rgba\(37, 99, 235, 0\.72\)[^}]*box-shadow:[^}]*rgba\(147, 197, 253, 0\.68\)/s,
      'the solo bucket resolves blue while ordinary winning buckets stay green',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /const soloSize = soloIdx < 0 \? 0 : 92[\s\S]*?const sizePct = isSoloBadge \? soloSize : position\.size[\s\S]*?replay-badge-wrap--solo/,
      'the solo bucket badge expands to fill nearly the entire quadrant',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /aria: `\$\{amount\} FLIP`[\s\S]*?icon: '\/whitepaper\/flame-logo-split\.svg'/,
      'the YOU WON receipt replaces the FLIP word with the standard FLIP mark while retaining an accessible label',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-win-description__currency-icon\s*\{[^}]*width:\s*1\.05em[^}]*height:\s*1\.05em/s,
      'the inline FLIP mark stays proportional to the compact payout copy',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /if \(line\.icon\)[\s\S]*?item\.appendChild\(icon\)[\s\S]*?copy\.textContent = line\.text[\s\S]*?item\.appendChild\(copy\)/,
      'the FLIP mark is placed before its amount',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-win-description__lines\s*\{[^}]*display:\s*grid[^}]*justify-items:\s*center/s,
      'YOU WON, each currency reward, and tickets occupy deliberate separate lines',
    );
  });

  test('jackpot whale rewards convert contract half-pass units to whole-pass equivalents', async () => {
    const { formatWhalePassAward } = await import('../replay-panel.js');

    assert.equal(formatWhalePassAward(1), '½ whale pass');
    assert.equal(formatWhalePassAward(2), '1 whale pass');
    assert.equal(formatWhalePassAward(11), '5½ whale passes');
    assert.match(
      REPLAY_PANEL_SRC,
      /formatted = formatWhalePassAward\(e\.amount\)/,
      'the winner detail never labels raw half-pass units as full passes',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /const text = formatWhalePassAward\(whaleCount\)/,
      'the YOU WON receipt uses the same full-pass conversion',
    );
  });

  test('public jackpot results keep badges and rewards clear in both draws', () => {
    assert.match(
      REPLAY_PANEL_SRC,
      /if \(!this\.#bonusPhase\) host\.classList\.add\('replay-bucket-reveal--main-miss'\)/,
      'only the main-draw underside receives the missed-result scale hook',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-bucket-badge\s*\{[^}]*width:\s*68%/s,
      'ordinary public badges use the same 68% scale in the main and bonus draws',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-bucket-reveal--main-miss\.replay-bucket-reveal--solo-eth \.replay-bucket-badge\s*\{[^}]*width:\s*76%[^}]*height:\s*100%[^}]*aspect-ratio:\s*auto[^}]*object-position:\s*50% 0[^}]*transform:\s*translateY\(-0\.18rem\)/s,
      'the solo-ETH badge is only one step larger and stays inside its upper lane',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /badgeStage\.className = 'replay-bucket-badge-stage'[\s\S]*?receipt\.className = 'replay-bucket-receipt'/,
      'public results separate badge geometry from their variable-height receipt',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-prize-reveal\.replay-bucket-reveal\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*minmax\(0, 1fr\) clamp\(2\.2rem, 9vw, 2\.5rem\)/s,
      'every neighboring badge receives the same fixed vertical stage',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-prize-reveal\.replay-bucket-reveal--solo-eth\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto[^}]*gap:\s*0\.42rem/s,
      'the solo result gives its payout an auto-height row below the badge',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-bucket-reveal--solo-eth \.replay-bucket-receipt\s*\{[^}]*height:\s*auto[^}]*flex-direction:\s*row[^}]*gap:\s*0\.3rem[^}]*transform:\s*translateY\(-0\.28rem\)/s,
      'a solo bucket with tickets keeps both rewards in one compact lane near the badge',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-bucket-reveal--q2 \.replay-bucket-amount,[\s\S]*?\.replay-bucket-reveal--q3 \.replay-bucket-tickets\s*\{[^}]*transform:\s*translateY\(-0\.16rem\)/s,
      'bottom-row rewards sit slightly higher in both draws',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-bucket-reveal--solo-eth\.replay-bucket-reveal--q2 \.replay-bucket-amount,[\s\S]*?\.replay-bucket-reveal--solo-eth\.replay-bucket-reveal--q3 \.replay-bucket-tickets\s*\{[^}]*transform:\s*none/s,
      'the bottom-row adjustment cannot move a solo payout back over its badge',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /if \(!isSoloEth\)\s*\{[\s\S]*?currencyWinners\.textContent = `×\$\{Number\.isFinite\(currencyWinnerCount\)/,
      'the featured solo ETH amount drops the redundant ×1 counter',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-bucket-reveal--solo-eth \.replay-bucket-amount\s*\{[^}]*font-size:\s*clamp\(0\.82rem, 2\.55vw, 1\.18rem\)/s,
      'the solo amount is only modestly larger than an ordinary payout',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-bucket-amount--solo-eth\s*\{[^}]*background:\s*transparent[^}]*color:\s*#5c1616[^}]*box-shadow:\s*none/s,
      'the solo amount keeps the muted red loss-result treatment without a plate',
    );
    assert.doesNotMatch(
      REPLAY_CSS,
      /#160806|#451407|\.replay-bucket-amount--solo-eth \.replay-bucket-value\s*\{[^}]*color:\s*#fff/s,
      'the solo loss payout does not borrow the white-on-dark winner treatment',
    );
    assert.doesNotMatch(
      REPLAY_PANEL_SRC,
      /SOLO ETH WINNER|replay-bucket-solo-stamp/,
      'the solo treatment stays visual instead of adding a literal label',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-prize-reveal\.replay-bucket-reveal--main-miss\s*\{[^}]*rgba\(239, 120, 120, 0\.16\)[^}]*inset 0 0 0 2px rgba\(111, 25, 36, 0\.22\)/s,
      'the revealed underside keeps the pink/red loss language',
    );
    assert.doesNotMatch(
      REPLAY_PANEL_SRC + REPLAY_CSS,
      /replay-bucket-miss-mark|missMark\.textContent = 'MISS'/,
      'the loss surface does not add a literal MISS stamp',
    );
  });

  test('fresh winning badges pop their exact icon-and-amount reward once on hover', async () => {
    const { winningBadgeRewardLines } = await import('../replay-panel.js');
    const rows = winningBadgeRewardLines({
      awardType: 'aggregated',
      ethTotal: '1000000000000000000',
      flipTotal: '2500000000000000000000',
      ticketTotal: 8,
    });
    assert.deepEqual(rows.map((row) => row.kind), ['eth', 'flip', 'tickets']);
    assert.equal(rows[2].amount, '2', 'eight jackpot entries render as two whole tickets');
    assert.match(REPLAY_PANEL_SRC, /export function winningBadgeRewardLines/);
    assert.match(REPLAY_PANEL_SRC, /rows\.push\(\{ kind: 'eth'[\s\S]*rows\.push\(\{ kind: 'flip'[\s\S]*kind: 'tickets'/,
      'ETH, FLIP, and ticket wins each have a compact reward row');
    assert.match(REPLAY_PANEL_SRC, /createJackpotTicketIcon\('replay-badge-reward-pop__ticket'\)/,
      'ticket wins reuse the recognizable four-trait ticket icon');
    assert.match(REPLAY_PANEL_SRC, /\/whitepaper\/flame-logo-split\.svg[\s\S]*\/symbols\/crypto_06_ethereum_silver\.svg/,
      'currency wins use their real FLIP and ETH marks');
    assert.match(REPLAY_PANEL_SRC, /addEventListener\('mouseenter', showReward, \{ once: true \}\)/,
      'each fresh badge performs its pop only on the first mouse entry');
    assert.doesNotMatch(
      REPLAY_PANEL_SRC,
      /for \(const active of this\.querySelectorAll\('\.replay-badge-wrap\.is-reward-pop'\)\)/,
      'fresh reward callouts may overlap instead of deleting the one already animating',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /const sequence = this\.#rewardPopSequence\+\+;[\s\S]*const stack = Math\.max\(1, 20 - sequence\)[\s\S]*--replay-reward-stack/,
      'the first concurrently triggered reward remains in the foreground',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /winningBadgeRewardDirection\(\{[\s\S]*randomValue: this\.#rewardDirectionPhase,[\s\S]*sequence,[\s\S]*wrap\.dataset\.rewardDirection = direction/,
      'a randomized starting side and activation sequence fan aligned rewards in different directions',
    );
    assert.match(
      REPLAY_CSS,
      /data-reward-direction="below"[\s\S]*data-reward-direction="right"[\s\S]*data-reward-direction="left"/,
      'the HUD plate supports vertical and horizontal popup directions',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-tq\.q-result-revealed \.replay-badge-wrap\.is-reward-pop\[tabindex="0"\]\s*\{[^}]*z-index:\s*calc\(15 \+ var\(--replay-reward-stack, 1\)\)/s,
      'a reward callout receives foreground stacking only after scratch completion arms the badge',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /const quadrantStack = Math\.max\(1, stack - 2\)[\s\S]*--replay-quadrant-reward-stack[\s\S]*q-reward-pop-active[\s\S]*!quad\.querySelector\('\.replay-badge-wrap\.is-reward-pop'\)/,
      'the owning quadrant stays elevated, but capped below the center seal, until its final reward clears',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-tq\.q-reward-pop-active\s*\{[^}]*z-index:\s*var\(--replay-quadrant-reward-stack, 1\);[^}]*overflow:\s*visible/s,
      'an active reward clears neighboring scratch canvases without raising green quadrant paper above the z20 center seal',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-tq\.q-result-revealed \.replay-badge-wrap\[tabindex="0"\]\s*\{[^}]*z-index:[^}]*pointer-events:\s*auto/s,
      'partially uncovered multi-win badges stay beneath the scratch canvas and cannot steal its pointer',
    );
    assert.match(REPLAY_PANEL_SRC, /wrap\.tabIndex = -1/,
      'new win badges begin inert beneath the scratch cover');
    assert.match(
      REPLAY_PANEL_SRC,
      /#revealQuadrant[\s\S]*const badges = quad\.querySelectorAll\('\.replay-badge-wrap'\);\s*for \(const badge of badges\) badge\.tabIndex = 0/,
      'badge reward hover arms only when the whole quadrant reaches its reveal threshold',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /this\.#badgesRevealed\[qIdx\]\.push\(ci\);[\s\S]{0,700}this\.#sfxGreenReveal\(\);\s*this\.#activateBadgeReward\(badgeWraps\[ci\]\);/,
      'the amount popup activates in the same badge-hit turn as its reveal sound',
    );
    assert.doesNotMatch(
      REPLAY_PANEL_SRC,
      /for \(const badge of badges\) this\.#activateBadgeReward\(badge\)/,
      'finishing the whole quadrant no longer bulk-pops badge amounts',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /#activateBadgeReward\(wrap\)[\s\S]*wrap\.dataset\.rewardShown === 'true'[\s\S]*\.replay-badge-reward-pop/,
      'bulk activation preserves the once-only guard and skips badges without a reward popup',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-badge-reward-pop\s*\{[\s\S]*rgba\(46, 25, 9, 0\.93\)[\s\S]*will-change:\s*opacity, transform/,
      'the reward uses a crisp translucent game-HUD plate without an expensive live blur',
    );
    assert.match(
      REPLAY_CSS,
      /animation:\s*replay-badge-reward-pop 0\.78s[\s\S]*@keyframes replay-badge-reward-pop[\s\S]*scale\(0\.76\)[\s\S]*scale\(1\.08\)[\s\S]*scale\(0\.98\)[\s\S]*scale\(1\.04\)/,
      'the reward snaps in, settles for reading, and exits quickly instead of drifting',
    );
  });

  test('paid badge hit keeps intact scratch coating above the badge while sound and amount still pop', () => {
    assert.match(
      REPLAY_CSS,
      /\.replay-scratch-canvas\s*\{[^}]*z-index:\s*2/s,
      'the live coating remains the quadrant paint-order ceiling until scratch completion',
    );
    assert.doesNotMatch(
      REPLAY_CSS,
      /\.replay-badge-wrap\s*\{[^}]*z-index:/s,
      'the wrapper cannot trap its amount popup in the badge-art stacking layer',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-scattered-badge\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1/s,
      'only the partially revealed badge art stays below the live coating',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-badge-reward-pop\s*\{[^}]*z-index:\s*12/s,
      'the amount popup escapes above sibling badge art',
    );
    assert.doesNotMatch(
      REPLAY_CSS,
      /\.replay-tq\.q-result-revealed \.replay-badge-wrap\.is-reward-pop\s*\{[^}]*z-index:/s,
      'starting the amount animation must not promote its badge wrapper above intact coating',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /this\.#badgesRevealed\[qIdx\]\.push\(ci\);[\s\S]{0,700}this\.#sfxGreenReveal\(\);\s*this\.#activateBadgeReward\(badgeWraps\[ci\]\);/,
      'the paid-badge hit still dispatches its reveal sound and amount activation together',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-badge-wrap\.is-reward-pop \.replay-badge-reward-pop\s*\{[^}]*visibility:\s*visible;[^}]*animation:\s*replay-badge-reward-pop/s,
      'the amount popup still animates when the badge wrapper remains below the coating',
    );
  });

  test('YOU WON waits until every active badge reward popup has cleared', () => {
    assert.match(
      REPLAY_PANEL_SRC,
      /receipt\.className = 'replay-win-description is-waiting-for-reward-popups'[\s\S]*receipt\.dataset\.rewardPopGate = 'pending'/,
      'the receipt begins behind an opening gate instead of racing the first callout',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /const rewardPopActive = Boolean\([\s\S]*this\.querySelector\('\.replay-badge-wrap\.is-reward-pop'\)[\s\S]*openingGateActive \|\| rewardPopActive/,
      'the gate considers every concurrently active reward popup in the widget',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /wrap\.classList\.add\('is-reward-pop'\);\s*this\.#syncWinReceiptVisibility\(\)[\s\S]*animationend[\s\S]*wrap\.classList\.remove\('is-reward-pop'\);[\s\S]*this\.#syncWinReceiptVisibility\(\)/,
      'starting and finishing each popup immediately resynchronizes the receipt',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-win-description\.is-waiting-for-reward-popups\s*\{[^}]*visibility:\s*hidden[^}]*opacity:\s*0/s,
      'the gated receipt takes no visual focus while rewards are popping',
    );
  });

  test('the far-future center reveal is a focused FLIP bonus prize', () => {
    assert.match(
      REPLAY_PANEL_SRC,
      /class="ff-logo" src="\/whitepaper\/flame-logo-split\.svg"[\s\S]*?class="ff-amount"[\s\S]*?class="ff-label">BONUS/,
      'the center contains only the FLIP mark, amount, and bonus label',
    );
    assert.doesNotMatch(REPLAY_PANEL_SRC, /ff-label">Far Future/,
      'the internal distribution name is not repeated in the prize art');
    assert.match(REPLAY_PANEL_SRC, /setAttribute\('aria-label', `\$\{amountStr\} FLIP bonus`\)/,
      'the logo-only currency treatment keeps its full accessible meaning');
    assert.match(
      REPLAY_PANEL_SRC,
      /const compactAmountStr = formatCenterBonusFlip\(totalFlip\)[\s\S]*?class="ff-amount">\$\{compactAmountStr\}/,
      'the visible amount is compacted before it enters the narrow diamond',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-center-prize\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*80%;[^}]*min-width:\s*0;/s,
      'the prize stack stays inside a deliberate diamond-safe inset',
    );
    assert.match(
      REPLAY_CSS,
      /\.replay-ticket-center\.revealed::before\s*\{[\s\S]*?#071a2c[\s\S]*?#172554[\s\S]*?#2e1065[\s\S]*?border-color:\s*#67e8f9/,
      'the far-future prize uses the indigo and teal reward palette',
    );
    assert.match(REPLAY_CSS, /\.replay-center-prize \.ff-logo\s*\{[^}]*drop-shadow/s,
      'the FLIP mark remains readable at center-diamond scale');
  });

  test('center FLIP bonus amounts stay within three significant figures', async () => {
    const { formatCenterBonusFlip } = await import('../replay-panel.js');
    const flip = 10n ** 18n;
    assert.equal(formatCenterBonusFlip(999n * flip), '999');
    assert.equal(formatCenterBonusFlip(1_234n * flip), '1.23K');
    assert.equal(formatCenterBonusFlip(12_345n * flip), '12.3K');
    assert.equal(formatCenterBonusFlip(123_456n * flip), '123K');
    assert.equal(formatCenterBonusFlip(999_999n * flip), '1M');
    assert.equal(formatCenterBonusFlip(5_360_000n * flip), '5.36M');
  });

  test('an actual solo ETH winner gets its own reveal cue', () => {
    assert.match(
      REPLAY_PANEL_SRC,
      /const isSoloEthWin = isWin && !this\.#bonusPhase && this\.#isSoloEthWinner\(qIdx\)/,
      'the cue is restricted to an actual main-draw player win',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /if \(isSoloEthWin\)\s*\{\s*this\.#soloEthCuePlayed = true;\s*this\.#sfxSoloEthReveal\(\);/s,
      'the solo branch replaces the ordinary per-quadrant win sound',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /const isSoloEthLoss = !isWin[\s\S]*?Number\(publicSummary\?\.winnerCount\) === 1;[\s\S]*?else if \(isSoloEthLoss\)\s*\{[\s\S]*?gets no reveal sound\./,
      'a losing viewer uncovers the public solo bucket in complete silence',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /#sfxSoloEthReveal\(\)\s*\{[\s\S]*?frequency:\s*130\.81, endFrequency:\s*261\.63[\s\S]*?\[523\.25, 659\.25, 783\.99, 1046\.5\][\s\S]*?\[1568, 2093, 3136\]/,
      'the dedicated cue has a low vault-open rise and a separate crystalline burst',
    );
    assert.match(
      REPLAY_PANEL_SRC,
      /this\.#celebrate\(\{ sound: !this\.#soloEthCuePlayed \}\)/,
      'the generic end-of-roll fanfare cannot mask the solo cue',
    );
  });
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    // Dynamic-import (cached after first call) — registers the Custom Element
    // via module-bottom idempotency-guarded customElements.define.
    await import('../last-day-jackpot.js');
  });

  test("Custom Element 'last-day-jackpot' is registered after import", () => {
    const ctor = customElements.get('last-day-jackpot');
    assert.ok(ctor, 'last-day-jackpot is registered');
    assert.equal(ctor.name, 'LastDayJackpot');
  });

  test('Class instantiation does not throw', () => {
    const Ctor = customElements.get('last-day-jackpot');
    assert.doesNotThrow(() => new Ctor());
  });

  test('connectedCallback renders innerHTML scaffold without throwing', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    assert.doesNotThrow(() => el.connectedCallback());
    await flushMicrotasks();
    assert.ok(el.innerHTML.length > 100, 'innerHTML populated');
  });

  test('innerHTML scaffold contains all required data-bind hooks', () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    // The spin/scratch reveal is the sibling <replay-panel>; the shell carries
    // only the day pin/banner. Foil claims now live in the shared pending tray.
    const required = [
      'ldj-status-cold-start',
      'ldj-status-empty-day',
      'ldj-status-resolved',
      'ldj-new-day-banner',
      'day',
    ];
    for (const hook of required) {
      assert.ok(
        el.querySelector(`[data-bind="${hook}"]`),
        `data-bind="${hook}" present`,
      );
    }
  });

  test('Cold-start copy is suppressed by default so loading cannot shift the board', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    assert.ok(cold, 'cold-start section exists');
    assert.equal(cold.style.display, 'none', 'large cold-start copy stays out of layout');
    assert.doesNotMatch(el.innerHTML, /Game starts soon/i);
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    assert.ok(empty, 'empty-day section exists');
    assert.equal(
      empty.style.display, 'none',
      'empty-day hidden by default',
    );
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.ok(resolved, 'resolved section exists');
    assert.equal(
      resolved.style.display, 'none',
      'resolved hidden by default',
    );
  });

  test('disconnectedCallback flushes #unsubs without throwing', async () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    await flushMicrotasks();
    assert.doesNotThrow(() => el.disconnectedCallback());
  });
});

// ===========================================================================
// Plan 59-02: app.lastDay subscriber + status branch dispatch + pin-dayId
// ===========================================================================

describe('Plan 59-02: app.lastDay subscriber + status branch dispatch', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function instantiate() {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  test('status:pre-game payload keeps large cold-start copy hidden', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', { day: null, status: 'pre-game' });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.ok(cold, 'cold-start section exists');
    assert.equal(cold.style.display, 'none', 'cold-start copy cannot move the jackpot');
    assert.equal(empty.style.display, 'none', 'empty-day hidden');
    assert.equal(resolved.style.display, 'none', 'resolved hidden');
  });

  test('status:resolved-no-winners payload → empty-day visible with day-N copy + day label updated', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', {
      day: 5, level: 2, summary: null, winners: [],
      roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.equal(cold.style.display, 'none', 'cold-start hidden');
    assert.notEqual(empty.style.display, 'none', 'empty-day visible');
    assert.equal(resolved.style.display, 'none', 'resolved hidden');
    const copy = el.querySelector('[data-bind="ldj-empty-copy"]');
    assert.match(copy.textContent, /Day 5 had no winners/, 'day-5 copy present');
    assert.match(copy.textContent, /day 6/, 'rolled-to-day-6 copy present');
    const dayLbl = el.querySelector('[data-bind="day"]');
    assert.match(dayLbl.textContent, /Day 5/);
  });

  test('contradictory no-winners status cannot hide winner evidence in the summary', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', {
      day: 234, level: 47, winners: [],
      summary: {
        blockRange: { start: '45421295', end: null },
        rollOne: {
          eth: [{ traitId: 16, winnerCount: 20, uniqueCount: 17 }],
          tickets: [],
          solo: null,
        },
        rollTwo: { coin: [], bonusDraw: [], farFuture: { winnerCount: 0 } },
      },
      roll1: { day: 234, level: 47, purchaseLevel: null, wins: [] },
      roll2: { day: 234, level: 47, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();

    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.equal(empty.style.display, 'none', 'the false rollover sentence stays hidden');
    assert.notEqual(resolved.style.display, 'none', 'the resolved draw stays visible');
  });

  test('status:resolved payload → resolved section visible + day label set + winners cached', async () => {
    const el = instantiate();
    const winner = {
      address: '0xab12000000000000000000000000000000000000',
      totalEth: '1000000000000000000',  // 1 ETH
      ticketCount: 100,
      coinTotal: '0',
      bafPrize: { eth: '0', tickets: 0 },
      decimatorPrize: { regularEth: '0', lootboxEth: '0', terminalEth: '0' },
    };
    storeMod.update('app.lastDay', {
      day: 7, level: 2, summary: null, winners: [winner],
      roll1: { day: 7, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 7, level: 2, purchaseLevel: null, wins: [], bonusTraitsPacked: null },
      status: 'resolved',
    });
    await flushMicrotasks();
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    const empty = el.querySelector('[data-bind="ldj-status-empty-day"]');
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.equal(cold.style.display, 'none', 'cold-start hidden');
    assert.equal(empty.style.display, 'none', 'empty-day hidden');
    assert.notEqual(resolved.style.display, 'none', 'resolved visible');
    const dayLbl = el.querySelector('[data-bind="day"]');
    assert.match(dayLbl.textContent, /Day 7/);
  });

  test('first payload pins day; same-day refresh stays put; genuinely newer day auto-renders', async () => {
    const el = instantiate();
    // First payload: pin to day 5 empty-day
    storeMod.update('app.lastDay', {
      day: 5, level: 2, summary: null, winners: [],
      roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 5/, 'first payload pins day 5');

    // Second payload: same day → re-render in place (still day 5)
    storeMod.update('app.lastDay', {
      day: 5, level: 2, summary: null, winners: [],
      roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 5/, 'same-day refresh keeps day 5');

    // Third payload: newer day 6 → switch the whole widget automatically.
    storeMod.update('app.lastDay', {
      day: 6, level: 2, summary: null, winners: [],
      roll1: { day: 6, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 6, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 6/,
      'body automatically follows the new resolved day');
  });

  test('deployment mismatch clears the old run high-water mark so a lower new-run day renders', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', {
      day: 172, level: 43, summary: null, winners: [],
      roll1: { day: 172, level: 43, purchaseLevel: null, wins: [] },
      roll2: { day: 172, level: 43, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 172/);

    storeMod.update('app.deploymentMismatch', {
      surface: 'jackpot', expectedDeployBlock: 44_963_297,
      observedStartBlock: '44956000', observedDay: 172,
    });
    await flushMicrotasks();
    assert.equal(el.querySelector('[data-bind="day"]').textContent, 'SYNC');

    storeMod.update('app.deploymentMismatch', null);
    storeMod.update('app.lastDay', {
      day: 10, level: 2, summary: null, winners: [],
      roll1: { day: 10, level: 2, purchaseLevel: null, wins: [] },
      roll2: { day: 10, level: 2, purchaseLevel: null, wins: [] },
      status: 'resolved-no-winners',
    });
    await flushMicrotasks();
    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 10/,
      'new deployment can restart its logical day numbering');
    el.disconnectedCallback();
  });

  test('null/undefined payload does not throw + leaves the stable loading scaffold', async () => {
    const el = instantiate();
    assert.doesNotThrow(() => storeMod.update('app.lastDay', null));
    await flushMicrotasks();
    assert.doesNotThrow(() => storeMod.update('app.lastDay', undefined));
    await flushMicrotasks();
    // The internal large cold-start block remains suppressed; app/index owns a
    // reserved one-line loading status below the replay board.
    const cold = el.querySelector('[data-bind="ldj-status-cold-start"]');
    assert.equal(cold.style.display, 'none', 'cold-start remains layout-neutral after null payloads');
  });

  test('Defensive: status:resolved with null summary + undefined bonusTraitsPacked does not throw', async () => {
    // Pitfalls D + E + bonusTraitsPacked-missing: composed blob may have null summary
    // and roll2 without bonusTraitsPacked field (verified game.ts:2030-2229 — day-keyed
    // roll2 handler does NOT include bonusTraitsPacked; only the per-player handler does
    // per game.ts:881). Widget must tolerate gracefully.
    const el = instantiate();
    assert.doesNotThrow(() => {
      storeMod.update('app.lastDay', {
        day: 9, level: 2, summary: null, winners: [],
        roll1: { day: 9, level: 2, purchaseLevel: null, wins: [] },
        roll2: { day: 9, level: 2, purchaseLevel: null, wins: [] },  // no bonusTraitsPacked
        status: 'resolved',
      });
    });
    await flushMicrotasks();
    const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
    assert.notEqual(resolved.style.display, 'none', 'resolved visible with null summary');
  });
});

// ===========================================================================
// Plan 59-03: localStorage spin-idempotency + new-day banner + wallet highlight
// ===========================================================================

const RESOLVED_PAYLOAD_DAY5 = {
  day: 5, level: 2, summary: null,
  winners: [{
    address: '0xab12000000000000000000000000000000000000',
    totalEth: '1000000000000000000', ticketCount: 100, coinTotal: '0',
    bafPrize: { eth: '0', tickets: 0 },
    decimatorPrize: { regularEth: '0', lootboxEth: '0', terminalEth: '0' },
  }],
  roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
  roll2: { day: 5, level: 2, purchaseLevel: null, wins: [], bonusTraitsPacked: null },
  status: 'resolved',
};

describe('Plan 59-03: localStorage spin-idempotency', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function instantiate() {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  test('replay:scratch-complete (NOT spin-complete) writes the spun_day key + dispatches jackpot:revealed', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    assert.equal(globalThis.localStorage.getItem(`spun_day_${CHAIN.id}_5`), null,
      'no key before the panel reveal is scratched');

    let revealed = 0;
    globalThis.document.addEventListener('jackpot:revealed', () => { revealed += 1; });

    // Spin end alone must NOT open the gate — prizes are still under the
    // scratch cover (user-reported bug: banner spoiled the win pre-scratch).
    globalThis.document.dispatchEvent({
      type: 'replay:spin-complete',
      detail: { day: 5, bonusPhase: false },
    });
    await flushMicrotasks();
    assert.equal(globalThis.localStorage.getItem(`spun_day_${CHAIN.id}_5`), null,
      'spun_day key NOT written at spin end');
    assert.equal(revealed, 0, 'no jackpot:revealed at spin end');

    // The sibling <replay-panel> bubbles this once every owned quadrant +
    // the center diamond are scratched.
    globalThis.document.dispatchEvent({ type: 'replay:scratch-complete' });
    await flushMicrotasks();

    assert.equal(globalThis.localStorage.getItem(`spun_day_${CHAIN.id}_5`), '1',
      'spun_day key written on scratch completion (claims spoiler gate opens)');
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_5`), '1',
      'a no-bonus main scratch is also the durable whole-board completion');
    assert.equal(revealed, 1, 'jackpot:revealed dispatched for the winnings banner');
    el.disconnectedCallback();
  });

  // The "N winners this day · top hit X ETH" caption was pulled off the board
  // 2026-07-29 (user call). It is now only the popup's NO HIT subtitle, built by
  // #dayStatsText() — so the board must carry neither the element nor the copy.
  test('day-stats caption is gone from the board (no element, no copy)', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    assert.equal(el.querySelector('[data-bind="ldj-day-stats"]'), null,
      'no day-stats element in the shell');
    const rendered = el.innerHTML.replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(rendered, /winners this day|top hit/,
      'no winner-count / top-hit copy rendered on the board');
    assert.equal(el.querySelectorAll('.jp-winner-item').length, 0,
      'no winner-address rows in basic mode');
    el.disconnectedCallback();
  });

  test('the caption copy survives as the popup NO HIT subtitle (#dayStatsText)', () => {
    const src = readFileSync(
      new URL('../last-day-jackpot.js', import.meta.url), 'utf8',
    );
    assert.match(src, /#dayStatsText\(\)\s*\{/, 'builder kept');
    assert.match(src, /winners this day|winner\$\{/, 'winner-count copy kept in the builder');
    assert.match(src, /noWin:[\s\S]*?this\.#dayStatsText\(\)/,
      'popup NO HIT sub is fed by the builder');
  });

  test('localStorage QuotaExceededError on setItem → widget renders without throwing (Pitfall F)', async () => {
    // Replace localStorage with one that throws on every setItem call.
    const original = globalThis.localStorage;
    globalThis.localStorage = {
      _m: new Map(),
      getItem: (k) => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
      clear: () => {},
    };
    try {
      const el = instantiate();
      // Render resolved + simulate a roll2_done transition by direct state set.
      assert.doesNotThrow(() => {
        storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      }, 'render should not throw despite localStorage write attempts');
      await flushMicrotasks();
      // Verify the widget rendered the resolved state successfully.
      const resolved = el.querySelector('[data-bind="ldj-status-resolved"]');
      assert.notEqual(resolved?.style?.display, 'none',
        'resolved section visible despite localStorage throwing');
    } finally {
      globalThis.localStorage = original;
    }
  });
});

describe('new-day auto-follow', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function instantiate() {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  const DAY5 = {
    day: 5, level: 2, summary: null, winners: [],
    roll1: { day: 5, level: 2, purchaseLevel: null, wins: [] },
    roll2: { day: 5, level: 2, purchaseLevel: null, wins: [] },
    status: 'resolved-no-winners',
  };
  const DAY6 = {
    ...DAY5, day: 6,
    roll1: { ...DAY5.roll1, day: 6 },
    roll2: { ...DAY5.roll2, day: 6 },
  };

  test('Banner is hidden by default (no newer-day delivery)', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    const banner = el.querySelector('[data-bind="ldj-new-day-banner"]');
    assert.ok(banner, 'banner element exists');
    assert.equal(banner.hidden, true, 'banner hidden after first-payload pin (no newer day)');
  });

  test('newer-day payload updates immediately and leaves the click banner hidden', async () => {
    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    // Newer day arrives — no extra click is required.
    storeMod.update('app.lastDay', DAY6);
    await flushMicrotasks();
    const banner = el.querySelector('[data-bind="ldj-new-day-banner"]');
    assert.equal(banner.hidden, true, 'legacy click banner stays hidden');
    const dayLbl = el.querySelector('[data-bind="day"]');
    assert.match(dayLbl.textContent, /Day 6/, 'body follows day 6 immediately');
  });

  test('missing replay option is refreshed and selected for the new day', async () => {
    const connected = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', connected);
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: connected }];
    playerSelect.value = connected;
    replay.append(daySelect, playerSelect);
    let refreshes = 0;
    replay.refreshDays = async () => {
      refreshes += 1;
      daySelect.options.push({ value: '6' });
      return true;
    };
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    storeMod.update('app.lastDay', DAY6);
    await flushMicrotasks();
    await flushMicrotasks();

    assert.equal(refreshes, 1, 'replay day source reloaded once');
    assert.equal(daySelect.value, '6', 'newly loaded day selected automatically');
    el.disconnectedCallback();
  });

  test('a zero-entry viewer replaces the stale replay player instead of inheriting their wins', async () => {
    const viewed = '0x609da633ba1dd5e6aa2e43aa3ea3f740deece5b9';
    const staleWinner = '0x1111000000000000000000000000000000000000';
    storeMod.update('connected.address', viewed);
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: staleWinner }];
    playerSelect.value = staleWinner;
    let changes = 0;
    playerSelect.addEventListener('change', () => { changes += 1; });
    replay.append(daySelect, playerSelect);
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();

    assert.equal(playerSelect.value, viewed, 'zero-entry viewer becomes the replay target');
    assert.equal(changes, 1, 'replay-panel is told to recompute personal results');
    assert.ok(
      playerSelect.options.some((option) => option.value === viewed && option.dataset?.zeroEntry === 'true'),
      'bridge adds an explicit zero-entry option instead of retaining another player',
    );
    el.disconnectedCallback();
  });

  test('the bridge restores persisted reveal state through its replay-panel reference', async () => {
    const connected = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', connected);
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: connected }];
    playerSelect.value = connected;
    replay.append(daySelect, playerSelect);
    const restored = [];
    replay.setPersistedRevealState = (...state) => restored.push(state);
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();

    assert.deepEqual(restored, [[false, false]]);
    el.disconnectedCallback();
  });

  test('the bridge tells replay-panel when both rolls were durably completed', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const connected = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', connected);
    globalThis.localStorage.setItem(`spun_day_${CHAIN.id}_5`, '1');
    globalThis.localStorage.setItem(`jackpot_complete_day_${CHAIN.id}_5`, '1');
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: connected }];
    playerSelect.value = connected;
    replay.append(daySelect, playerSelect);
    const restored = [];
    replay.setPersistedRevealState = (...state) => restored.push(state);
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();

    assert.deepEqual(restored, [[true, true]],
      'main is restored as the default and bonus stays behind the flame');
    el.disconnectedCallback();
  });

  test('a new day resets the prior day reveal gates', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const el = instantiate();
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    globalThis.document.dispatchEvent({
      type: 'replay:scratch-complete',
      detail: { bonusPhase: false, bonusAvailable: false },
    });
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, false, 'day 5 is fully revealed');

    storeMod.update('app.lastDay', DAY6);
    await flushMicrotasks();
    assert.equal(cta.hidden, true, 'day 6 starts with fresh board/flip gates');
  });

  test('the balance-fuzz day boundary resets the jackpot into its slow processing roll', async () => {
    const connected = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', connected);
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: connected }];
    playerSelect.value = connected;
    replay.append(daySelect, playerSelect);
    const persisted = [];
    replay.setPersistedRevealState = (...state) => persisted.push(state);
    const refreshOptions = [];
    const refreshSelections = [];
    replay.refreshDays = async (options) => {
      refreshOptions.push(options);
      refreshSelections.push(daySelect.value);
      return false;
    };
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', DAY5);
    await flushMicrotasks();
    const priorPersistenceCalls = persisted.length;
    storeMod.update('app.daySync', {
      day: 6, jackpotReady: false, coinflipReady: false, ready: false,
      rngLocked: false, rngRequested: false,
      phase: 'waiting-both', coinflipResult: null,
    });
    await flushMicrotasks();

    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 6/,
      'the board changes on the same direct day signal that fuzzes amounts');
    assert.equal(daySelect.value, '6', 'the incoming day mounts immediately');
    assert.ok(daySelect.options.some((option) => (
      option.value === '6' && option.dataset?.processingDay === 'true'
    )), 'a processing placeholder exists before the replay index catches up');
    assert.equal(replay.getAttribute('data-day-warming'), '',
      'the progress control appears before the RNG request bit lands');
    assert.ok(persisted.length > priorPersistenceCalls,
      'the new day publishes a fresh reveal state immediately');
    assert.deepEqual(persisted.at(-1), [false, false],
      'the incoming board clears into replay-panel\'s slow attract roll');
    assert.deepEqual(refreshOptions, [{ force: true }],
      'the incoming jackpot feed starts loading at the fuzz boundary');
    assert.deepEqual(refreshSelections, ['6']);

    storeMod.update('app.daySync', {
      day: 6, jackpotReady: false, coinflipReady: false, ready: false,
      rngLocked: true, rngRequested: true, reverseQueued: '3',
      phase: 'waiting-both', coinflipResult: null,
    });
    await flushMicrotasks();

    assert.match(el.querySelector('[data-bind="day"]').textContent, /Day 6/);
    assert.equal(daySelect.value, '6');
    assert.equal(replay.getAttribute('data-day-warming'), '',
      'the later RNG lock continues the already-mounted processing control');
    assert.deepEqual(refreshOptions, [{ force: true }],
      'the request does not reload/reset the board a second time');
    assert.deepEqual(refreshSelections, ['6'],
      'the active reload remains pinned to the incoming day');
    assert.deepEqual(persisted.at(-1), [false, false],
      'the incoming board starts fresh instead of inheriting yesterday');

    // A detached prior-day board can still finish a late event. Its explicit
    // day must never pre-mark the just-pinned incoming day as watched.
    globalThis.document.dispatchEvent({
      type: 'replay:scratch-complete',
      detail: {
        day: 5,
        player: connected,
        bonusPhase: false,
        bonusAvailable: false,
      },
    });
    await flushMicrotasks();
    assert.equal(globalThis.localStorage.getItem(`spun_day_${CHAIN.id}_5`), '1');
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_5`), '1');
    assert.equal(globalThis.localStorage.getItem(`spun_day_${CHAIN.id}_6`), null,
      'a late prior-day scratch cannot skip the incoming jackpot');
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_6`), null);

    storeMod.update('app.lastDay', DAY6);
    await flushMicrotasks();
    assert.equal(daySelect.value, '6');
    assert.equal(replay.getAttribute('data-day-warming'), null,
      'the exact resolved payload releases the board even if daySync is one update behind');

    storeMod.update('app.daySync', {
      day: 6, jackpotDay: 6, coinflipDay: null,
      jackpotReady: true, coinflipReady: false, ready: false,
      rngLocked: false, rngRequested: true, reverseQueued: '3',
      phase: 'waiting-coinflip', coinflipResult: null,
    });
    await flushMicrotasks();

    assert.equal(daySelect.value, '6');
    assert.equal(replay.getAttribute('data-day-warming'), null,
      'the jackpot unlocks from its own exact-day lane without waiting for coinflip');
    el.disconnectedCallback();
  });

  test('opening the current Decimator repairs a poisoned current-day jackpot receipt', async () => {
    const connected = '0xab15000000000000000000000000000000000000';
    storeMod.update('connected.address', connected);
    const replay = makeFakeElement('replay-panel');
    const daySelect = makeFakeElement('select');
    daySelect.attributes['data-bind'] = 'day-select';
    daySelect.options = [{ value: '5' }];
    daySelect.value = '5';
    const playerSelect = makeFakeElement('select');
    playerSelect.attributes['data-bind'] = 'player-select';
    playerSelect.options = [{ value: connected }];
    playerSelect.value = connected;
    replay.append(daySelect, playerSelect);
    const persisted = [];
    replay.setPersistedRevealState = (...state) => persisted.push(state);
    _docBody.appendChild(replay);

    const el = instantiate();
    storeMod.update('app.lastDay', { ...DAY5, level: 15, status: 'resolved' });
    await flushMicrotasks();
    globalThis.localStorage.setItem(`spun_day_${CHAIN.id}_5`, '1');
    globalThis.localStorage.setItem(`jackpot_complete_day_${CHAIN.id}_5`, '1');
    globalThis.localStorage.setItem(`jackpot_bonus_pending_day_${CHAIN.id}_5`, '1');

    globalThis.document.dispatchEvent({
      type: 'decimator:opened',
      detail: { day: 5, level: 15 },
    });
    await flushMicrotasks();

    assert.equal(globalThis.localStorage.getItem(`spun_day_${CHAIN.id}_5`), null);
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_5`), null);
    assert.equal(globalThis.localStorage.getItem(`jackpot_bonus_pending_day_${CHAIN.id}_5`), null);
    assert.deepEqual(persisted.at(-1), [false, false],
      'the normal jackpot underneath the Decimator becomes playable again');
    el.disconnectedCallback();
  });
});

// ===========================================================================
// Phase 64 — foil-ticket matches: fetch → spoiler gate → shared pending action.
//
// The widget fetches /player/:addr/foil?level=N when a resolved day renders.
// Cards show regardless of spin state (the player's own tickets); MATCH
// lighting (face rings, T-chips, claimable pulse) is gated independently by
// the main and bonus scratches that expose those exact winning sets.
// ===========================================================================

describe('foil match pending action', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    pendingActionsMod.__resetPendingActionsForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  test('the old foreground strip is gone and the machine keeps four live foil modules', () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    for (const hook of [
      'ldj-foil', 'ldj-foil-lines', 'ldj-foil-ladder', 'ldj-foil-boost', 'ldj-foil-claimbar',
    ]) {
      assert.equal(el.querySelector(`[data-bind="${hook}"]`), null, `${hook} removed`);
    }
    assert.ok(el.querySelector('[data-bind="ldj-foil-machine-bank"]'));
    assert.equal(el.querySelectorAll('.ldj-foil-machine-slot').length, 4,
      'one subdued machine module is reserved for each foil ticket');
    assert.equal(
      existsSync(new URL('../../assets/jackpot/daily-drawing-backplate-v9.webp', import.meta.url)),
      true,
      'the compact drawing backplate ships with the app',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-bank\s*\{[^}]*daily-drawing-foil-routing-v5\.svg[^}]*100% 100% no-repeat/s,
      'the circuit map scales from the same measured grid as the live foil sockets',
    );
    assert.match(
      DRAWING_CSS,
      /daily-drawing-board-routing-v7\.svg[^}]*daily-drawing-backplate-v9\.webp/s,
      'a second connected routing layer sits over the substrate and beneath all hardware',
    );
    assert.match(BOARD_ROUTING_SVG,
      /Four independent lanes leave the LED key and fan into the main jackpot/,
      'the visible complexity is the key distributing power into the jackpot widget');
    const lcdFeeds = [...BOARD_ROUTING_SVG.matchAll(/<path d="([^"]+)"\/>/g)]
      .map((match) => match[1])
      .filter((route) => /(?:V915|H350|H930)$/.test(route));
    assert.ok(lcdFeeds.length >= 8,
      'multiple data and power traces terminate beneath the LCD bezel');
    const foilRoutes = [...FOIL_ROUTING_SVG.matchAll(/<path d="([^"]+)"\/>/g)].map((match) => match[1]);
    assert.equal(foilRoutes.length, 8, 'two feeds per socket, and both of them come off the board');
    // EVERY LANE CONNECTS TWO THINGS A PLAYER CAN NAME. x=186 and x=1186 are
    // the draw processor's own left and right edges in this viewBox, and
    // y=164/336/664/836 are the socket edges — so each surviving route visibly
    // leaves the board and lands on a socket.
    //
    // v4 also ran eight OUTER feeds from the perimeter ground rail at x=34 /
    // x=1338, and defended them with a plated via on the rail. A via is a legal
    // terminus on a real board and means nothing to a player, who sees a line
    // cross the gutter and stop at a dot near the frame. Those eight are gone,
    // and with them the "one feed per foil quadrant" story they existed to tell.
    assert.ok(
      foilRoutes.every((route) => /^M(?:186|1186)\b/.test(route)
        && /V(?:164|336|664|836)$/.test(route)),
      'every exposed route runs from the draw processor into a socket',
    );
    assert.equal(foilRoutes.filter((route) => /^M(?:0|34|1338|1372)\b/.test(route)).length, 0,
      'no lane starts on the ground rail or the bank edge — nothing feeds in from the frame');
    assert.doesNotMatch(FOIL_ROUTING_SVG, /foilVia/,
      'and the rail vias that used to terminate those lanes went with them');
    assert.doesNotMatch(FOIL_ROUTING_SVG, /<rect/,
      'no solder-pad footprints crowd the socket edges');
    assert.doesNotMatch(FOIL_ROUTING_SVG, /<text/,
      'no reference designators print in the socket gutters');
    // The silkscreen house mark is the real Degenerus flame lifted verbatim from
    // the canonical artwork, printed as flat neutral ink. A redrawn approximation
    // is the exact failure this pins against.
    assert.match(
      DRAWING_CSS,
      /daily-drawing-board-silkscreen-v3\.svg/,
      'the cabinet prints the current silkscreen sheet',
    );
    const canonicalFlamePath = CANONICAL_FLAME_SVG.match(/\sd="([^"]+)"/)[1];
    assert.ok(SILKSCREEN_SVG.includes(canonicalFlamePath),
      'the silkscreen house mark uses the canonical flame path, not a redrawn one');
    assert.doesNotMatch(SILKSCREEN_SVG, /M51\.4 66\.5/,
      'the hand-drawn flame that did not match the brand mark is gone');
    assert.equal((SILKSCREEN_SVG.match(/<path transform="matrix/g) || []).length, 1,
      'one house mark is printed on the board, with no second ghost');
    // The fab legend names the part and prints the serial of the thing the
    // board IS: the deployed game contract from the active chain profile. The
    // value is baked at deploy, so this pins the SHAPE, not the address — a
    // redeploy re-bakes the line without breaking the suite.
    assert.match(SILKSCREEN_SVG, /<text[^>]*>DGN-VRF · REV PG · SN 0x[0-9a-fA-F]{40}<\/text>/,
      'the legend reads DGN-VRF, its revision, and a real 40-hex game address');
    assert.doesNotMatch(SILKSCREEN_SVG, /DGN-JP4|REV D ·|0x7F4A9C2E1B/,
      'the old part number and the invented serial are gone');
    assert.match(SILKSCREEN_SVG, /letter-spacing="1\.2"/,
      'the band is tracked in to seat all 42 characters short of ZERO RAKE');
    assert.match(SILKSCREEN_SVG, /fill-opacity="0\.15"/,
      'and it is still printed as faint silkscreen ink rather than a label');
    {
      // The address is real, not decorative: it has to be the one the app is
      // actually pointed at, or the board is printing a lie.
      const legend = SILKSCREEN_SVG.match(/SN (0x[0-9a-fA-F]{40})/)[1];
      assert.ok(CHAIN_PROFILE_SRC.includes(legend),
        'the baked serial is the GAME address declared by the active chain profile');
      assert.match(CHAIN_PROFILE_SRC, new RegExp(`GAME:\\s*'${legend}'`),
        'and it is the GAME entry specifically, not some other contract');
    }
    assert.match(
      APP_CSS,
      /\.ldj-foil-machine-slot\s*\{[^}]*inset 0 3px 9px rgba\(0, 0, 0, 0\.92\)/s,
      'an unfilled foil socket is a recessed indent rather than a placeholder card',
    );
    assert.match(
      APP_CSS,
      /\.ldj-foil-machine-ticket\s*\{[^}]*filter:\s*grayscale\(0\.35\) saturate\(0\.52\) brightness\(0\.68\)[^}]*opacity:\s*0\.48[^}]*animation:\s*none/s,
      'unlocked foils use subdued, non-shimmering ticket artwork',
    );
    assert.match(
      DRAWING_CSS,
      /--jp-foil-size:\s*clamp\(2\.75rem, 11\.8cqi, 5\.65rem\)/,
      'the four sockets are slightly larger while remaining tied to the cabinet width',
    );
    // An empty socket says exactly one thing: a ticket-shaped processor drops in
    // here. Three parts and no more — a dull silver bay, the printed ticket
    // silhouette, and a BLANK centre seal.
    // Empty is also the COMMON state: most players are looking at four of these
    // and nothing seated, so the bay is board furniture rather than a feature.
    // Every value below is pitched to sit AT the laminate rather than above it.
    // The body carries the board's own green cast instead of a lighter neutral
    // grey, and the chamfer, lip line, seal and guide all take a further step
    // down. Measured off the rendered cabinet, an empty bay went from 2.22x the
    // bare laminate's luminance to 1.18x: it now has to be hunted for. A seated
    // ticket is the only thing in this bank meant to be seen across the room.
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\s*\{[^}]*border-color:\s*rgba\(168, 173, 178, 0\.04\)/s,
      'the opening is framed in dull neutral metal held near the board, not a bright edge',
    );
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\s*\{[^}]*inset 0 0 0 3px rgba\(214, 222, 232/s,
      'no bright inner ring emphasises the empty frame',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\s*\{[^}]*linear-gradient\(180deg, rgba\(226, 230, 234, 0\.014\), rgba\(226, 230, 234, 0\)\) top \/ 100% 0\.2rem no-repeat/s,
      'the machined lead-in chamfer is down to a whisper on the top lip rather than a rim light',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\s*\{[^}]*0 1px 0 rgba\(198, 203, 208, 0\.012\)/s,
      'and the outer lip highlight no longer draws a bright line under an empty fitting',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot:not\(\.is-loaded\)::after\s*\{[^}]*width:\s*22%[^}]*border:\s*1px solid rgba\(198, 203, 209, 0\.06\)[^}]*transform:\s*rotate\(45deg\)/s,
      'an empty socket carries the centre seal at the seated ticket\'s own diamond proportion, held back',
    );
    // The seal is BLANK. The house flame stays on the board silkscreen and on
    // the ticket's own centre; stamping it into the bay too made the socket read
    // as a badge rather than as a fitting.
    assert.doesNotMatch(
      APP_CSS,
      /\.ldj-foil-machine-slot::before\s*\{[^}]*flame-center\.svg/s,
      'the socket seal no longer masks the flame artwork',
    );
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot:not\(\.is-loaded\)::(?:before|after)\s*\{[^}]*flame-center\.svg/s,
      'and nothing re-prints the flame onto the empty bay from the cabinet sheet',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\s*\{[^}]*linear-gradient\(180deg, #080b0a 0%, #0b0e0d 58%, #0d100f 100%\)/s,
      'the empty socket body is opaque dull silver taken down to unlit, so background circuits disappear beneath it without the bay lighting up',
    );
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\s*\{[^}]*repeating-linear-gradient/s,
      'an empty socket carries no row of contact fingers',
    );
    // The ticket-like lines: a stamped guide at the footprint a card occupies,
    // echoing the four-quadrant layout so the bay reads as a fitting for one.
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot:not\(\.is-loaded\)::before\s*\{[^}]*calc\(50% - 0\.5px\)[^}]*calc\(50% \+ 0\.5px\)/s,
      'an empty socket prints the quadrant-cross hairlines of the ticket that fits it',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot:not\(\.is-loaded\)::before\s*\{[^}]*border:\s*1px solid rgba\(214, 220, 226, 0\.014\)/s,
      'the silhouette outline stays fainter than its own cross, so the guide reads as one stamp',
    );
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot:not\(\.is-loaded\)::before\s*\{[^}]*filter:[^;]*blur\(/s,
      'the guide is printed crisp rather than softened out of shape',
    );
    // The engaged gold strip is gone: every seated socket lit it, so it reported
    // "occupied" four times over and said nothing about the draw.
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\.is-loaded\s*\{[^}]*bottom \/ 100% 0\.14rem no-repeat/s,
      'a seated socket no longer lights a permanent engaged strip',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\.is-loaded\s*\{[^}]*linear-gradient\(145deg, #383b3e 0%, #16181a 56%, #2b2e30 100%\)/s,
      'a loaded socket also occludes the backplate around the seated ticket',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-ticket\s*\{[^}]*width:\s*calc\(100% - 0\.36rem\)[^}]*place-self:\s*center[^}]*border:\s*1px solid #59616a/s,
      'the real foil ticket is centred inside a thin dark-silver chassis',
    );
    // The card's corner has to be concentric with the socket rim it sits in.
    // The rim is 6px over a 1px wall, so it turns on 5px inside; the card was
    // turning on 4px inside its own 1px wall, tighter than the frame around it,
    // and its square 108% foil art printed a hard corner against that curve.
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-ticket\s*\{[^}]*border-radius:\s*6px/s,
      'the card turns on the socket rim\'s own inner radius rather than tighter than it',
    );
    for (const [nth, corner] of [[1, 'top-left'], [2, 'top-right'], [3, 'bottom-left'], [4, 'bottom-right']]) {
      assert.match(
        DRAWING_CSS,
        new RegExp(`\\.ldj-foil-machine-cell:nth-child\\(${nth}\\)\\s*\\{\\s*border-${corner}-radius:\\s*5px`, 's'),
        `the ${corner} quadrant clips its own art to that corner, so no state can poke square foil past the frame`,
      );
    }
    // Sharp diamond, not a lozenge. 3px is a hairline chamfer on a full-size
    // card face and most of every edge on the ~13px socketed one.
    assert.match(
      APP_CSS,
      /\.ldj-foil-machine-center\s*\{[^}]*border-radius:\s*0/s,
      'the socketed centre is a true sharp diamond',
    );
    assert.match(
      APP_CSS,
      /\.ticket-card-center\s*\{[^}]*border-radius:\s*3px/s,
      'while the full-size ticket centre keeps its 3px chamfer',
    );
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-center\s*\{[^}]*border-radius:/s,
      'and nothing in the socket sheet rounds it back off',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-center\s*\{[^}]*width:\s*20%[^}]*height:\s*20%[^}]*\}/s,
      'socketed tickets use the same centre-diamond proportion as the unsocketed ticket without repainting its foil material',
    );
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-center\s*\{[^}]*(?:#626b75|#c2c8ce|#69717a|#aeb6bd)/s,
      'the socket chassis does not replace the real foil centre with a grey approximation',
    );
    // The centre's structural line belongs to the socket, like the chassis and
    // the quadrant cross. It used to inherit `--ticket-line-color`, the ticket's
    // own accent: a hairline on a full-size card, but most of the object on a
    // 9px diamond, so a red-accented ticket seated as a red lozenge with a
    // flame trapped in it.
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-center\s*\{[^}]*border-width:\s*1px;\s*border-color:\s*#59616a/s,
      'the seated centre takes the socket\'s own hairline instead of the ticket accent that read as a red ring',
    );
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-center\s*\{[^}]*border-color:\s*var\(--ticket-line-color/s,
      'nothing puts the per-ticket accent back around the seated centre',
    );
    // A HIT CHANGES ONLY THE PART THAT SCORED. The background mask and badge
    // are separate layers: +1 can illuminate the badge without waking its
    // quadrant, while +2 can illuminate both. Nothing operates on the ticket
    // as a group, so neighbouring misses remain unchanged.
    const declarationOf = (block, property) => (block || '')
      .split(';')
      .map((declaration) => declaration.trim())
      .find((declaration) => declaration.startsWith(`${property}:`)) || null;
    const ruleFor = (selectorSource) => DRAWING_CSS.match(
      new RegExp(`${selectorSource} \\{([^}]*)\\}`, 's'),
    )?.[1];

    const dormantCell = ruleFor(
      '\\.ldj-foil-machine-slot\\.is-loaded \\.ldj-foil-machine-cell',
    );
    assert.ok(dormantCell, 'the dormant quadrant states its own presence, per cell');
    assert.equal(declarationOf(dormantCell, 'filter'), 'filter: none',
      'the cell itself is not filtered, so its child badge can light independently');
    assert.equal(declarationOf(dormantCell, 'opacity'), 'opacity: 1',
      'opaque, so an unmatched quadrant renders the same over any backdrop');
    const faceLayer = ruleFor(
      '\\.ldj-foil-machine-slot\\.is-loaded\\s*\\n?\\s*\\.ldj-foil-machine-cell::after',
    );
    assert.ok(faceLayer, 'every quadrant owns a metal presentation layer');
    assert.equal(declarationOf(faceLayer, 'z-index'), 'z-index: 1',
      'the quadrant presentation layer sits above the foil metal');
    assert.match(declarationOf(faceLayer, 'background') || '', /rgba\(2, 5, 7, 0\.76\)/,
      'every seated quadrant is dim before any reel face matches it');
    const missMask = ruleFor(
      '\\.ldj-foil-machine-slot\\.is-loaded\\s*\\n?\\s*\\.ldj-foil-machine-cell:is\\(\\.is-no-match, \\.is-symbol-match\\)::after',
    );
    assert.ok(missMask, 'a graded miss or symbol-only face masks its metal beneath the badge');
    assert.match(declarationOf(missMask, 'background') || '', /rgba\(2, 5, 7, 0\.76\)/,
      'the graded miss mask holds the foil background down without touching badge art');
    const badgeLayer = ruleFor(
      '\\.ldj-foil-machine-slot\\.is-loaded\\s*\\n?\\s*\\.ldj-foil-machine-cell img',
    );
    assert.ok(badgeLayer, 'every badge owns an independent presentation layer');
    assert.equal(declarationOf(badgeLayer, 'z-index'), 'z-index: 2',
      'the badge stays above the independent quadrant lamp');
    assert.match(declarationOf(badgeLayer, 'filter') || '',
      /grayscale\(0\.86\).*saturate\(0\.26\).*brightness\(0\.56\)/s,
      'every seated badge is dim before any reel face matches it');
    const missBadge = ruleFor(
      '\\.ldj-foil-machine-slot\\.is-loaded\\s*\\n?\\s*\\.ldj-foil-machine-cell\\.is-no-match img',
    );
    assert.ok(missBadge, 'a graded miss badge has its own dim treatment');
    assert.match(declarationOf(missBadge, 'filter') || '',
      /grayscale\(0\.86\).*saturate\(0\.26\).*brightness\(0\.56\)/s,
      'a graded miss stays visibly seated but asleep');
    assert.equal(declarationOf(badgeLayer, 'filter'), declarationOf(missBadge, 'filter'),
      'pre-spin and explicit misses share one dormant badge treatment');

    // No group fade survives on the card itself: that is the coupling that made
    // one quadrant's hit visible on its neighbours. app.css still ships a base
    // ticket fade from when the card was the unit of presence, so the seated
    // card has to actively neutralise it rather than merely not add one.
    const ticketRule = ruleFor(
      '\\.ldj-foil-machine-slot\\.is-loaded \\.ldj-foil-machine-ticket',
    );
    assert.ok(ticketRule, 'the seated card states its own (absent) presence');
    assert.equal(declarationOf(ticketRule, 'filter'), 'filter: none',
      'the seated card carries no filter of its own to fade as a group');
    assert.equal(declarationOf(ticketRule, 'opacity'), 'opacity: 1',
      'nor any group alpha, which is what made a miss depend on its backdrop');
    assert.match(
      APP_CSS,
      /\.ldj-foil-machine-ticket \{[^}]*opacity:\s*0\.48/s,
      'the base fade this neutralises still exists, so the override is load-bearing');
    assert.doesNotMatch(
      DRAWING_CSS,
      /:has\(\.is-symbol-match, \.is-color-match\) \.ldj-foil-machine-ticket/,
      'and nothing restores the whole card off a single hit');

    // Every hit keeps its steady lamp; only the stronger lock-on pop is timed.
    const matchedBadge = ruleFor(
      '\\.ldj-foil-machine-slot\\.is-loaded\\s*\\n?\\s*\\.ldj-foil-machine-cell\\.is-match-flash img',
    );
    assert.ok(matchedBadge, 'a newly matched badge states its own lock-on pop');
    assert.match(matchedBadge, /animation:\s*ldj-foil-badge-lock 640ms/,
      'the pop has one finite beat while the earned lamp remains');
    assert.match(DRAWING_CSS,
      /\.ldj-foil-machine-cell\.is-symbol-match img\s*\{[^}]*drop-shadow/s,
      'the durable +1 state lights the badge only');
    assert.match(DRAWING_CSS,
      /\.ldj-foil-machine-cell\.is-color-match::after\s*\{[^}]*background:[^}]*box-shadow:/s,
      'the durable +2 state additionally lights the quadrant background');

    // The centre states its muting unconditionally — no match state at all.
    const centreRule = ruleFor(
      '\\.ldj-foil-machine-slot\\.is-loaded \\.ldj-foil-machine-center',
    );
    assert.ok(centreRule, 'the seated centre states its presence explicitly');
    assert.equal(declarationOf(centreRule, 'filter'), declarationOf(missBadge, 'filter').replace(/brightness\([\d.]+\)/, 'brightness(0.46)'),
      'the centre is muted in the same idiom as a dormant quadrant');
    assert.equal(declarationOf(centreRule, 'opacity'), 'opacity: 1',
      'and stays fully opaque so a lit quadrant cannot show through it');
    assert.doesNotMatch(
      DRAWING_CSS,
      /:has\(\.is-symbol-match, \.is-color-match\) \.ldj-foil-machine-center/,
      'the centre never varies with match state, so no rule keys it off one');
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-center\s*\{[^}]*border-width:\s*1px;\s*border-color:\s*#59616a/s,
      'and it keeps the dark structural rim the lit foil stops against',
    );

    // One source of truth: app.css must not keep a second per-cell dim.
    assert.doesNotMatch(
      APP_CSS,
      /\.ldj-foil-machine-slot\.is-graded \.ldj-foil-machine-cell \{[^}]*opacity:/s,
      'no competing per-cell dormant treatment survives in app.css');
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-cell\.is-color-match::after\s*\{[^}]*box-shadow:[^}]*rgba/s,
      'a full match earns its own quadrant glow without changing any neighbour',
    );
    // A seated centre that already blooms leaves the lit centre nothing to say.
    // The canonical foil centre carries an outer gold bloom at rest; the socket
    // keeps its inset modelling and drops that bloom, so the only glow on a
    // seated card is the multi-match signal.
    const layersOf = (block) => (block || '')
      .replace(/rgba\([^)]*\)/g, 'C')
      .split(',')
      .map((layer) => layer.trim())
      .filter(Boolean);
    const restingCentreShadow = layersOf(
      DRAWING_CSS.match(/\.ldj-foil-machine-center \{[^}]*box-shadow:([^;]+);/s)?.[1],
    );
    assert.ok(restingCentreShadow.length >= 2,
      'the seated centre states its own shadow rather than inheriting the card\'s');
    assert.ok(restingCentreShadow.every((layer) => layer.startsWith('inset')),
      'every layer of a seated centre is inset: foil modelling, never a bloom, in any state');
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-center img\s*\{[^}]*width:\s*95%[^}]*height:\s*95%[^}]*object-position:\s*center[^}]*transform:\s*rotate\(-45deg\)/s,
      'the socketed foil flame matches the unsocketed flame scale and alignment',
    );
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-center img\s*\{[^}]*filter:/s,
      'the socketed flame keeps the canonical foil-ticket treatment',
    );
    assert.match(
      APP_CSS,
      /\.ticket-card--foil \.ticket-card-center\s*\{[^}]*conic-gradient\(from 215deg, #7b5005, #e5b62f, #fff0a0/s,
      'loaded tickets retain the canonical reflective foil centre',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-cell img\s*\{[^}]*width:\s*108%[^}]*object-position:\s*50% 50%/s,
      'each real badge is centred without pushing into the chassis',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\.is-slotting \.ldj-foil-machine-ticket\s*\{[^}]*ldj-foil-ticket-slot[^}]*--foil-slot-index/s,
      'new foil packs seat into their four processor sockets with a staggered animation',
    );
    // A seated ticket is dim before the draw. Live and durable matches lift
    // only the exact badge/quadrant layers they earn.
    assert.doesNotMatch(
      APP_CSS,
      /\.ldj-foil-machine-slot\.is-graded \.ldj-foil-machine-ticket\s*\{[^}]*filter:\s*none/s,
      'being graded is no longer enough on its own to illuminate a card',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-slot\.is-loaded\s*\n?\s*\.ldj-foil-machine-cell\.is-no-match img\s*\{[^}]*opacity:\s*0\.36;[^}]*grayscale\(0\.86\) saturate\(0\.26\) brightness\(0\.56\)/s,
      'a seated badge remains dim when its reel proves it missed',
    );
    // Each reel landing gets a finite lock-on pop. The grade underneath that
    // pop then holds the earned badge or badge-plus-quadrant lamp steadily.
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-cell\.is-match-flash img\s*\{[^}]*ldj-foil-badge-lock 640ms/s,
      'a newly matched badge pops as its live jackpot reel lands',
    );
    assert.doesNotMatch(
      DRAWING_CSS,
      /\.ldj-foil-machine-ticket\s*\{[^}]*filter:\s*brightness\([^}]*\)\s*saturate\(/s,
      'no seated card is driven brighter than its own foil material',
    );
    assert.equal((DRAWING_CSS.match(/\.ldj-foil-machine-slot\.is-loaded:not\(\.is-match\):has\(/g) || []).length, 0,
      'no chassis glow reports a partial hit alongside the claim ring');
    // The dormant treatment is unconditional now, so there is nothing left to
    // key off "this card matched nothing" — which is precisely why a miss can
    // no longer look different depending on its neighbours.
    assert.doesNotMatch(
      DRAWING_CSS,
      /:not\(:has\(\.is-symbol-match, \.is-color-match\)\) \.ldj-foil-machine-cell/,
      'no rule treats a quadrant differently because its card hit nothing',
    );
    assert.match(
      APP_CSS,
      /\.ldj-foil-machine-slot\.is-loaded \.ldj-foil-machine-cell\.is-match-flash\s*\{[^}]*opacity:\s*1 !important/s,
      'the base sheet cannot reintroduce the old group fade during lock-on',
    );
    assert.match(
      DRAWING_CSS,
      /\.ldj-foil-machine-cell\.is-color-match img\s*\{[^}]*drop-shadow/s,
      'a full match keeps its badge lamp after the lock-on pop ends',
    );
    el.disconnectedCallback();
  });

  test('the day-results list is gone (DAY SUMMARY popup CTA stays)', () => {
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    el.connectedCallback();
    assert.equal(el.querySelector('[data-bind="ldj-results"]'), null, 'list removed');
    assert.equal(el.querySelector('[data-bind="ldj-results-rows"]'), null, 'rows removed');
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.ok(cta, 'popup CTA kept');
    assert.match(el.innerHTML, />\s*DAY SUMMARY\s*</, 'CTA uses the new name');
  });

  test('source publishes the contract tuple and sends its receipt to the reveal engine', () => {
    const src = readFileSync(new URL('../last-day-jackpot.js', import.meta.url), 'utf8');
    assert.equal(/renderDayResults/.test(src), false, 'results renderer removed');
    assert.match(src, /#renderFoilBackdrop\(\)[\s\S]*bestGrade\(line, mainSet, bonusSet\)[\s\S]*traitToBadge\(traitId\)/,
      'the cabinet paints real foil traits and grades them only through the spoiler-gated model');
    assert.match(src, /claimableDrawGrades\(/,
      'main and bonus draw claims are graded independently');
    assert.match(src, /publishPendingActions\(FOIL_MATCH_ACTION_SOURCE/);
    assert.match(src, /kind:\s*'foil-match'/);
    assert.match(src, /claimFoilMatch\(/);
    assert.match(src, /parseFoilMatchClaimedFromReceipt\(/);
    assert.match(src, /queueReveal\(\{\s*kind:\s*'foil-match'/s);
    assert.match(src, /autoOpen:\s*true/,
      'AUTO is allowed to settle the permissionless fixed-player claim');
    const handler = src.slice(src.indexOf('async #onFoilClaim'), src.indexOf('// Mount / unmount'));
    assert.ok(
      handler.indexOf('this.#locallyClaimedFoilMatches.add(candidate.key)')
        < handler.indexOf('parseFoilMatchClaimedFromReceipt(receipt, contract)'),
      'receipt confirmation retires the row before optional presentation parsing',
    );
    assert.match(handler, /_terminalFoilClaimError\(error\)/,
      'a keeper winning the same claim race retires the stale action');
  });

  test('a revealed T8 line appears in pending with its actual ticket and match reason', async () => {
    const player = '0xab12000000000000000000000000000000000000';
    const traits = [1, 70, 130, 200];
    const packed = traits.reduce((word, trait, quadrant) => (
      word | ((trait & 0xff) << (quadrant * 8))
    ), 0) >>> 0;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.match(String(url), new RegExp(`/player/${player}/foil\\?level=12$`, 'i'));
      return {
        ok: true,
        json: async () => ({
          address: player, level: 12, present: true,
          lines: [[traits[2], traits[0], traits[3], traits[1]], [1, 78, 131, 201], [3, 68, 133, 206], [4, 69, 134, 207]],
          claims: [],
        }),
      };
    };
    try {
      storeMod.update('connected.address', player);
      const Ctor = customElements.get('last-day-jackpot');
      const el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      storeMod.update('app.lastDay', {
        day: 44, level: 12,
        summary: {
          rollOne: { mainTraitsPacked: packed },
          rollTwo: { bonusTraitsPacked: null },
        },
        winners: [],
        roll1: { day: 44, level: 12, purchaseLevel: 12, wins: [] },
        roll2: { day: 44, level: 12, purchaseLevel: 12, wins: [] },
        status: 'resolved',
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      const slots = el.querySelectorAll('.ldj-foil-machine-slot');
      assert.equal(slots.length, 4);
      assert.equal(slots[0].classList.contains('is-loaded'), true,
        'owned foil tickets fill their machine sockets before the reveal');
      assert.equal(slots[0].classList.contains('is-match'), false,
        'a covered jackpot cannot leak its foil match through the background');
      assert.equal(slots[0].querySelectorAll('.ldj-foil-machine-cell').length, 4,
        'the socket uses the actual four foil traits');
      const ticket = slots[0].querySelector('.ticket-card--foil');
      assert.ok(ticket, 'the cabinet reuses the real foil ticket card');
      assert.ok(ticket.getAttribute('data-ticket-accent'),
        'the real ticket outline is derived from its traits');
      assert.ok(ticket.querySelector('.ticket-card-center'),
        'the real foil center diamond remains part of the card');
      assert.equal(ticket.querySelectorAll('.trait-quadrant').length, 4);
      assert.deepEqual(
        ticket.querySelectorAll('.ldj-foil-machine-cell').map((cell) => (
          new URL(cell.querySelector('img')?.src, 'http://localhost').pathname.split('/').at(-1).split('_')[0]
        )),
        ['crypto', 'zodiac', 'cards', 'dice'],
        'encoded quadrant bits put every badge back in its canonical ticket panel',
      );
      assert.equal(pendingActionsMod.getPendingActions().length, 0,
        'Pending remains behind the same spoiler gate');

      document.dispatchEvent({
        type: 'degenerus:pack-reveal-complete',
        detail: { address: player, level: 12, foilPack: true },
      });
      assert.equal(slots.some((slot) => slot.classList.contains('is-slotting')), false,
        'the foil pack does not seat while another fullscreen reveal may still follow');
      document.dispatchEvent({
        type: 'degenerus:reveal-overlay-idle',
        detail: { aborted: false },
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      assert.equal(slots.filter((slot) => slot.classList.contains('is-slotting')).length, 4,
        'all four foil tickets seat only after the fullscreen queue is gone');

      document.dispatchEvent({
        type: 'replay:scratch-complete',
        detail: { day: 44, player, bonusPhase: false, bonusAvailable: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();

      const [action] = pendingActionsMod.getPendingActions();
      assert.equal(action.kind, 'foil-match');
      assert.equal(action.label, 'T8 FOIL LUCKBOX MATCH');
      assert.equal(action.detail, '');
      assert.deepEqual(action.lineTraits, traits);
      assert.deepEqual(action.winningTraits, traits,
        'Pending receives the actual jackpot ticket as well as the foil');
      assert.deepEqual(action.matchFaces, [2, 2, 2, 2]);
      assert.equal(action.drawKind, 0);
      assert.equal(action.score, 8);
      assert.equal(action.rewardFaces, 10_000,
        'Pending can name the deterministic bonus before the claim is sent');
      assert.equal(action.autoOpen, true,
        'AUTO may settle the permissionless claim for its fixed player');
      assert.equal(typeof action.run, 'function');
      assert.equal(slots[0].classList.contains('is-match'), true,
        'the claimable foil ticket powers up once the draw is uncovered');
      assert.equal(slots[0].getAttribute('data-score'), 'T8');
      assert.equal(slots[0].querySelectorAll('.is-color-match').length, 4,
        'all four exact symbol-and-color faces light independently');
      assert.equal(slots[1].classList.contains('is-graded'), true,
        'a sub-threshold ticket is still graded visually after the draw');
      assert.equal(slots[1].classList.contains('is-match'), false,
        'visual scoring does not turn a T3 ticket into a claim');
      assert.equal(slots[1].querySelectorAll('.is-color-match').length, 1,
        'a 2-point exact symbol-and-color face receives the extra-light state');
      assert.equal(slots[1].querySelectorAll('.is-symbol-match').length, 1,
        'a 1-point symbol-only face receives full illumination');
      assert.equal(slots[1].querySelectorAll('.is-no-match').length, 2,
        '0-point wrong-symbol faces remain deliberately dim');
      el.disconnectedCallback();
      assert.equal(pendingActionsMod.getPendingActions().length, 0,
        'detaching the owner cannot leave a stale foil reminder');
    } finally {
      globalThis.fetch = priorFetch;
    }
  });

  test('only the main set powers durably while bonus settlement remains claim-only', async () => {
    const player = '0xab12000000000000000000000000000000000000';
    const lineTraits = [1, 70, 130, 200];
    const bonusTraits = [2, 70, 130, 200];
    const mainTraits = [1, 69, 131, 201];
    const pack = (traits) => traits.reduce((word, trait, quadrant) => (
      word | ((trait & 0xff) << (quadrant * 8))
    ), 0) >>> 0;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        address: player, level: 12, present: true,
        lines: [lineTraits, [3, 68, 132, 202], [4, 71, 133, 203], [5, 72, 134, 204]],
        claims: [],
      }),
    });
    try {
      storeMod.update('connected.address', player);
      const Ctor = customElements.get('last-day-jackpot');
      const el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      storeMod.update('app.lastDay', {
        day: 45, level: 12,
        summary: {
          rollOne: { mainTraitsPacked: pack(mainTraits) },
          rollTwo: { bonusTraitsPacked: pack(bonusTraits) },
        },
        winners: [],
        roll1: { day: 45, level: 12, purchaseLevel: 12, wins: [] },
        roll2: { day: 45, level: 12, purchaseLevel: 12, wins: [] },
        status: 'resolved',
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      const slot = el.querySelectorAll('.ldj-foil-machine-slot')[0];
      document.dispatchEvent({
        type: 'replay:spin-complete',
        detail: { day: 45, player, bonusPhase: false, bonusAvailable: true },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.equal(slot.classList.contains('is-match'), false,
        'revealing Roll 1 does not leak a match from the packed bonus result');
      assert.equal(slot.getAttribute('data-draw-kind'), null);
      assert.equal(pendingActionsMod.getPendingActions().length, 0);
      assert.equal(slot.querySelectorAll('.is-color-match').length, 1,
        'the four Roll 1 quadrants grade as soon as that spin lands');

      document.dispatchEvent({
        type: 'replay:scratch-complete',
        detail: { day: 45, player, bonusPhase: false, bonusAvailable: true },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.equal(pendingActionsMod.getPendingActions().length, 0,
        'the non-claimable Roll 1 scratch does not publish a foil action');

      document.dispatchEvent({
        type: 'replay:spin-complete',
        detail: { day: 45, player, bonusPhase: true, bonusAvailable: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.equal(slot.classList.contains('is-match'), false,
        'the settled bonus set cannot become a durable foil lamp');
      assert.equal(slot.getAttribute('data-draw-kind'), null);
      assert.equal(pendingActionsMod.getPendingActions().length, 0,
        'bonus spin completion alone cannot publish the still-covered claim');
      assert.equal(slot.querySelectorAll('.is-color-match').length, 1,
        'bonus settlement leaves the earlier main face as the only durable exact match');
      storeMod.update('viewing.address', player);
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      assert.equal(pendingActionsMod.getPendingActions().length, 0,
        'a player/poll refresh cannot promote powered visuals past the scratch gate');

      document.dispatchEvent({
        type: 'replay:scratch-complete',
        detail: { day: 45, player, bonusPhase: true, bonusAvailable: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.equal(pendingActionsMod.getPendingActions()[0]?.drawKind, 1,
        'the matching claim publishes only after the bonus scratch completes');
      assert.equal(slot.classList.contains('is-match'), false,
        'claim eligibility does not promote the bonus result into the display');
      assert.equal(slot.querySelectorAll('.is-color-match').length, 1,
        'the main grade remains the sole durable visual after bonus scratch');
      el.disconnectedCallback();
    } finally {
      globalThis.fetch = priorFetch;
    }
  });

  test('the day boundary puts yesterday\'s foil lamps out', async () => {
    // The lamps are day state living in the DOM. Clearing the model they came
    // from does not unpaint them, and every repaint trigger the cabinet had
    // was an unrelated event (a level change, a wallet change, the next spin)
    // that can be hours away — so a card lit by yesterday's draw kept claiming
    // hits against today's undrawn board.
    const player = '0xab12000000000000000000000000000000000000';
    const lineTraits = [1, 70, 130, 200];
    const pack = (traits) => traits.reduce((word, trait, quadrant) => (
      word | ((trait & 0xff) << (quadrant * 8))
    ), 0) >>> 0;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        address: player, level: 12, present: true,
        lines: [lineTraits, [3, 68, 132, 202], [4, 71, 133, 203], [5, 72, 134, 204]],
        claims: [],
      }),
    });
    const matchedCells = () => el.querySelectorAll('.ldj-foil-machine-cell')
      .filter((cell) => cell.classList.contains('is-symbol-match')
        || cell.classList.contains('is-color-match'));
    let el = null;
    try {
      storeMod.update('connected.address', player);
      const Ctor = customElements.get('last-day-jackpot');
      el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      storeMod.update('app.lastDay', {
        day: 45, level: 12,
        summary: {
          rollOne: { mainTraitsPacked: pack(lineTraits) },
          rollTwo: { bonusTraitsPacked: null },
        },
        winners: [],
        roll1: { day: 45, level: 12, purchaseLevel: 12, wins: [] },
        roll2: { day: 45, level: 12, purchaseLevel: 12, wins: [] },
        status: 'resolved',
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      document.dispatchEvent({
        type: 'replay:spin-complete',
        detail: { day: 45, player, bonusPhase: false, bonusAvailable: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.equal(matchedCells().length, 4,
        'day 45 lights the four exact faces (the state this test then rolls over)');

      // The chain clock moves. No new draw has been revealed for day 46.
      storeMod.update('app.daySync', {
        day: 46, ready: false, jackpotReady: false, coinflipReady: false,
        rngRequested: false, rngLocked: false, rngFulfilled: false,
        phase: 'waiting-both',
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      assert.equal(matchedCells().length, 0,
        'not one of yesterday\'s faces is still lit on the new day');
      assert.equal(
        el.querySelectorAll('.ldj-foil-machine-cell')
          .filter((cell) => cell.getAttribute('data-match-points') != null).length,
        0,
        'and no face carries a stale score either',
      );
      assert.equal(
        el.querySelectorAll('.ldj-foil-machine-slot')
          .filter((slot) => slot.classList.contains('is-graded')
            || slot.classList.contains('is-match')).length,
        0,
        'no socket still reads as graded or claimable from the previous draw',
      );
      assert.equal(pendingActionsMod.getPendingActions().length, 0,
        'nor does a stale foil claim survive the boundary');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('an indexed day advance also leaves no lamp lit', async () => {
    // There are TWO day-advance paths. The chain clock drives #primeChainDay;
    // a newer indexed lastDay payload drives #adoptLatestDay. Whichever lands
    // first has to put the lamps out, or the other one is simply too late.
    // This asserts the observable end state on the indexed path — several
    // repaints can reach it, and it does not prove which one did. The
    // mechanism itself (both paths clear, and clear after their gates) is
    // pinned separately in the test below.
    const player = '0xab12000000000000000000000000000000000000';
    const lineTraits = [1, 70, 130, 200];
    const pack = (traits) => traits.reduce((word, trait, quadrant) => (
      word | ((trait & 0xff) << (quadrant * 8))
    ), 0) >>> 0;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        address: player, level: 12, present: true,
        lines: [lineTraits, [3, 68, 132, 202], [4, 71, 133, 203], [5, 72, 134, 204]],
        claims: [],
      }),
    });
    const matchedCells = () => el.querySelectorAll('.ldj-foil-machine-cell')
      .filter((cell) => cell.classList.contains('is-symbol-match')
        || cell.classList.contains('is-color-match'));
    let el = null;
    try {
      storeMod.update('connected.address', player);
      const Ctor = customElements.get('last-day-jackpot');
      el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      const dayPayload = (day) => ({
        day, level: 12,
        summary: {
          rollOne: { mainTraitsPacked: pack(lineTraits) },
          rollTwo: { bonusTraitsPacked: null },
        },
        winners: [],
        roll1: { day, level: 12, purchaseLevel: 12, wins: [] },
        roll2: { day, level: 12, purchaseLevel: 12, wins: [] },
        status: 'resolved',
      });
      storeMod.update('app.lastDay', dayPayload(51));
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      document.dispatchEvent({
        type: 'replay:spin-complete',
        detail: { day: 51, player, bonusPhase: false, bonusAvailable: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.equal(matchedCells().length, 4, 'day 51 is lit before the advance');

      // A newer indexed day arrives with no draw revealed against it.
      storeMod.update('app.lastDay', { ...dayPayload(52), summary: null });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      assert.equal(matchedCells().length, 0,
        'the indexed advance puts yesterday\'s faces out by itself');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('the reset fires on the boundary itself, not on the next unrelated repaint', () => {
    // Guard against a regression to lazy clearing: BOTH day-advance paths have
    // to clear, and the repaint has to sit after the gates that decide whether
    // a face may light, so it fails closed.
    const between = (from, to) => LAST_DAY_SRC.slice(
      LAST_DAY_SRC.indexOf(from), LAST_DAY_SRC.indexOf(to),
    );
    const prime = between('#primeChainDay(day) {', '#onDaySync(sync) {');
    assert.ok(prime, 'the chain-clock day-change path is still named #primeChainDay');
    assert.ok(prime.includes('this.#resetDayGates();'), 'it still clears the day gates');
    assert.ok(
      prime.indexOf('this.#resetDayGates();') < prime.indexOf('this.#clearFoilMatchLamps();'),
      'the cabinet repaints only after the activation gates are down',
    );

    const adopt = between('#adoptLatestDay(payload, resetGates) {', '#clearFoilMatchLamps() {');
    assert.ok(adopt, 'the indexed day-change path is still named #adoptLatestDay');
    assert.ok(
      adopt.indexOf('if (resetGates) this.#resetDayGates();')
        < adopt.indexOf('this.#clearFoilMatchLamps();'),
      'and the indexed path clears in the same order, on the same signal',
    );

    // One implementation, so the two boundaries cannot drift apart.
    const lamps = LAST_DAY_SRC.slice(LAST_DAY_SRC.indexOf('#clearFoilMatchLamps() {'));
    assert.match(lamps, /^#clearFoilMatchLamps\(\) \{\s*\n\s*this\.#renderFoilBackdrop\(\);\s*\n\s*void this\.#refreshFoil\(\);/,
      'the new day repaints AND re-fetches its own foil data instead of waiting to be asked');

    // That refresh is fire-and-forget on a path every day boundary now takes,
    // so teardown has to invalidate an outstanding read the same way the two
    // day-advance paths already do — #refreshFoil re-checks the sequence after
    // its await and bails, which is what stops a late response rendering into
    // a detached board or republishing the row teardown just cleared.
    const teardown = between('disconnectedCallback() {', '// The CTA may be parked');
    assert.ok(
      teardown.indexOf('this.#foilSeq += 1;')
        < teardown.indexOf('clearPendingActions(FOIL_MATCH_ACTION_SOURCE);'),
      'teardown invalidates in-flight foil reads before it clears the tray',
    );
  });

  test('a same-level post-spin phase refresh keeps the seated foil pack visible', async () => {
    const player = '0xab12000000000000000000000000000000000000';
    const traits = [1, 70, 130, 200];
    const packed = traits.reduce((word, trait, quadrant) => (
      word | ((trait & 0xff) << (quadrant * 8))
    ), 0) >>> 0;
    const requestedLevels = [];
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const parsedUrl = new URL(String(url), 'http://localhost');
      if (!parsedUrl.pathname.endsWith('/foil')) {
        return { ok: true, json: async () => null };
      }
      const level = Number(parsedUrl.searchParams.get('level'));
      requestedLevels.push(level);
      return {
        ok: true,
        json: async () => ({
          address: player,
          level,
          present: level === 38,
          lines: level === 38
            ? [traits, [2, 67, 132, 205], [3, 68, 133, 206], [4, 69, 134, 207]]
            : [],
          claims: [],
        }),
      };
    };
    try {
      storeMod.update('connected.address', player);
      storeMod.update('app.gameState', {
        level: 38,
        phase: 'JACKPOT',
        jackpotPhaseFlag: true,
        phaseTransitionActive: false,
      });
      storeMod.update('app.lastDay', {
        day: 190, level: 38,
        summary: {
          rollOne: { mainTraitsPacked: packed },
          rollTwo: { bonusTraitsPacked: null },
        },
        winners: [],
        roll1: { day: 190, level: 38, purchaseLevel: 38, wins: [] },
        roll2: { day: 190, level: 38, purchaseLevel: 38, wins: [] },
        status: 'resolved',
      });
      const Ctor = customElements.get('last-day-jackpot');
      const el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      assert.ok(requestedLevels.length > 0);
      const slot = el.querySelectorAll('.ldj-foil-machine-slot')[0];
      assert.equal(slot.classList.contains('is-loaded'), true,
        'the current-level pack is seated before the spin');

      document.dispatchEvent({
        type: 'replay:spin-complete',
        detail: { day: 190, player, bonusPhase: false, bonusAvailable: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();

      // The daily draw settling can refresh phase state before the numeric
      // level advances. That is not a level boundary and cannot eject the
      // pack that still belongs to level 38.
      storeMod.update('app.gameState', {
        level: 38,
        phase: 'PURCHASE',
        jackpotPhaseFlag: false,
        phaseTransitionActive: false,
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      assert.deepEqual([...new Set(requestedLevels)], [38],
        'same-level cadence changes never retarget the cabinet to level 39');
      assert.equal(slot.classList.contains('is-loaded'), true,
        'the seated current-level pack remains visible after the spin');
      el.disconnectedCallback();
    } finally {
      globalThis.fetch = priorFetch;
    }
  });

  test('level 45 foils stay visible through its final jackpot lock and move only at transition', async () => {
    const player = '0xab12000000000000000000000000000000000000';
    const traits = [1, 70, 130, 200];
    const requestedLevels = [];
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const parsedUrl = new URL(String(url), 'http://localhost');
      if (!parsedUrl.pathname.endsWith('/foil')) {
        return { ok: true, json: async () => null };
      }
      const level = Number(parsedUrl.searchParams.get('level'));
      requestedLevels.push(level);
      return {
        ok: true,
        json: async () => ({
          address: player, level, present: true,
          lines: [traits, [2, 67, 132, 205], [3, 68, 133, 206], [4, 69, 134, 207]],
          claims: [],
        }),
      };
    };
    try {
      storeMod.update('connected.address', player);
      storeMod.update('app.gameState', {
        level: 45,
        phase: 'JACKPOT',
        jackpotPhaseFlag: true,
        rngLockedFlag: true,
        jackpotCounter: 4,
        phaseTransitionActive: false,
      });
      // This stale adjacent poll reproduces the live symptom: it must not hide
      // the pack while /game/state still says level 45 jackpot.
      storeMod.update('app.poolBenchmarks', {
        level: 45,
        contractPhase: { level: 45, jackpot: false, rngLocked: true, day: 4 },
      });
      storeMod.update('app.lastDay', {
        day: 245, level: 45, summary: {}, winners: [],
        roll1: { day: 245, level: 45, purchaseLevel: 45, wins: [] },
        roll2: { day: 245, level: 45, purchaseLevel: 45, wins: [] },
        status: 'resolved',
      });
      const Ctor = customElements.get('last-day-jackpot');
      const el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      assert.deepEqual([...new Set(requestedLevels)], [45]);
      assert.equal(el.querySelectorAll('.ldj-foil-machine-slot')[0].classList.contains('is-loaded'), true);

      storeMod.update('app.gameState', {
        level: 45,
        phase: 'JACKPOT',
        jackpotPhaseFlag: true,
        rngLockedFlag: true,
        jackpotCounter: 4,
        phaseTransitionActive: true,
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      assert.deepEqual([...new Set(requestedLevels)], [45, 46],
        'the cabinet switches to level 46 only when level 45 enters end-phase');
      el.disconnectedCallback();
    } finally {
      globalThis.fetch = priorFetch;
    }
  });

  test('a one-day level transition seats the exact foil pack that just finished revealing', async () => {
    const player = '0xab12000000000000000000000000000000000000';
    const level39Lines = [
      [1, 70, 130, 200],
      [2, 71, 131, 201],
      [3, 72, 132, 202],
      [4, 73, 133, 203],
    ];
    const level40Lines = [
      [7, 79, 143, 207],
      [6, 78, 142, 206],
      [5, 77, 141, 205],
      [0, 76, 140, 204],
    ];
    const requestedLevels = [];
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const parsedUrl = new URL(String(url), 'http://localhost');
      if (!parsedUrl.pathname.endsWith('/foil')) {
        return { ok: true, json: async () => null };
      }
      const level = Number(parsedUrl.searchParams.get('level'));
      requestedLevels.push(level);
      return {
        ok: true,
        json: async () => ({
          address: player,
          level,
          present: true,
          lines: level === 39 ? level39Lines : level40Lines,
          claims: [],
        }),
      };
    };
    try {
      storeMod.update('connected.address', player);
      storeMod.update('app.gameState', {
        level: 39,
        phase: 'JACKPOT',
        jackpotPhaseFlag: true,
        rngLockedFlag: true,
        jackpotCounter: 0,
        compressedJackpotFlag: 2,
        phaseTransitionActive: false,
      });
      storeMod.update('app.lastDay', {
        day: 238, level: 39, summary: {}, winners: [],
        roll1: { day: 238, level: 39, purchaseLevel: 39, wins: [] },
        roll2: { day: 238, level: 39, purchaseLevel: 39, wins: [] },
        status: 'resolved',
      });
      const Ctor = customElements.get('last-day-jackpot');
      const el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      const firstBadgePath = () => el
        .querySelectorAll('.ldj-foil-machine-slot')[0]
        ?.querySelector('.ldj-foil-machine-cell')
        ?.querySelector('img')?.src;
      assert.match(firstBadgePath(), /crypto_01_tron_pink\.svg$/,
        'the cabinet begins with the same level 39 pack that is fullscreen');

      document.dispatchEvent({
        type: 'degenerus:pack-reveal-complete',
        detail: { address: player, level: 39, foilPack: true },
      });

      // A compressed jackpot can finish its only physical draw while more
      // fullscreen rewards are still queued. Both live phase and last-day
      // polling then advance before reveal-overlay emits its final idle event.
      storeMod.update('app.gameState', {
        level: 39,
        phase: 'PURCHASE',
        jackpotPhaseFlag: false,
        rngLockedFlag: false,
        jackpotCounter: 0,
        compressedJackpotFlag: 2,
        phaseTransitionActive: false,
      });
      storeMod.update('app.lastDay', {
        day: 239, level: 39, summary: {}, winners: [],
        roll1: { day: 239, level: 39, purchaseLevel: 39, wins: [] },
        roll2: { day: 239, level: 39, purchaseLevel: 39, wins: [] },
        status: 'resolved',
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      document.dispatchEvent({
        type: 'degenerus:reveal-overlay-idle',
        detail: { aborted: false },
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();

      const slots = el.querySelectorAll('.ldj-foil-machine-slot');
      assert.equal(slots.filter((slot) => slot.classList.contains('is-slotting')).length, 4,
        'all four completed foil tickets still receive the seating animation');
      assert.equal(requestedLevels.at(-1), 39,
        'the final cabinet read is pinned to the completed release, not the new buy level');
      assert.match(firstBadgePath(), /crypto_01_tron_pink\.svg$/,
        'the visible ticket is from the revealed level 39 pack, not level 40');
      assert.deepEqual(
        slots.map((slot) => slot.querySelectorAll('.ldj-foil-machine-cell')
          .map((cell) => cell.querySelector('img')?.src)),
        level39Lines.map((line) => line.map((trait) => traitToBadge(trait)?.path)),
        'every seated quadrant is the exact badge from each revealed foil ticket',
      );
      el.disconnectedCallback();
    } finally {
      globalThis.fetch = priorFetch;
    }
  });

  test('a same-day empty catch-up response cannot retract a verified foil match', async () => {
    const player = '0xab12000000000000000000000000000000000000';
    const traits = [1, 70, 130, 200];
    const packed = traits.reduce((word, trait, quadrant) => (
      word | ((trait & 0xff) << (quadrant * 8))
    ), 0) >>> 0;
    let indexed = true;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => indexed ? ({
        address: player, level: 12, present: true,
        lines: [traits, [2, 67, 132, 205], [3, 68, 133, 206], [4, 69, 134, 207]],
        claims: [],
      }) : ({ address: player, level: 12, present: false, lines: [], claims: [] }),
    });
    const payload = {
      day: 44, level: 12,
      summary: {
        rollOne: { mainTraitsPacked: packed },
        rollTwo: { bonusTraitsPacked: null },
      },
      winners: [],
      roll1: { day: 44, level: 12, purchaseLevel: 12, wins: [] },
      roll2: { day: 44, level: 12, purchaseLevel: 12, wins: [] },
      status: 'resolved',
    };
    let el = null;
    try {
      localStorage.setItem(`spun_day_${CHAIN.id}_44`, '1');
      storeMod.update('connected.address', player);
      const Ctor = customElements.get('last-day-jackpot');
      el = new Ctor();
      _docBody.appendChild(el);
      el.connectedCallback();
      storeMod.update('app.lastDay', payload);
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      assert.equal(pendingActionsMod.getPendingActions()[0]?.kind, 'foil-match');

      indexed = false;
      storeMod.update('app.lastDay', { ...payload });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      assert.equal(pendingActionsMod.getPendingActions()[0]?.kind, 'foil-match',
        'a transient empty indexer answer keeps the last verified same-scope match');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });
});

// ===========================================================================
// The seated foils grade against the SPIN PRESENTATION while the reels are
// still turning: each quadrant lights the moment its own reel stops, instead
// of all four landing at once when the board settles. The panel publishes what
// it is displaying (replay:spin-progress); the cabinet grades it with the same
// gradeLine the settled path uses and paints the same faces. Only Roll 1 locks
// persist: Roll 2 is a transient overlay even after its reels stop. Nothing
// here is a record: no claim, no key, no gate.
// ===========================================================================

describe('foil faces track the spin presentation', () => {
  const PLAYER = '0xab12000000000000000000000000000000000000';
  // Slot 0's line, and a draw built to grade it 2 / 1 / 0 / 2 = T5:
  //   q0 trait 1   vs 1   — symbol and colour  -> 2
  //   q1 trait 70  vs 78  — symbol only        -> 1
  //   q2 trait 130 vs 131 — nothing            -> 0
  //   q3 trait 200 vs 200 — symbol and colour  -> 2
  const LINE = [1, 70, 130, 200];
  const DRAW = [1, 78, 131, 200];
  const pack = (traits) => traits.reduce((word, trait, quadrant) => (
    word | ((trait & 0xff) << (quadrant * 8))
  ), 0) >>> 0;

  beforeEach(async () => {
    storeMod.__resetForTest();
    pendingActionsMod.__resetPendingActionsForTest();
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function foilFetch(level = 12) {
    return async () => ({
      ok: true,
      json: async () => ({
        address: PLAYER, level, present: true,
        lines: [LINE, [3, 68, 132, 202], [4, 71, 133, 203], [5, 72, 134, 204]],
        claims: [],
      }),
    });
  }

  async function mount({ level = 12, day = 45, bonusDraw = null } = {}) {
    storeMod.update('connected.address', PLAYER);
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    storeMod.update('app.lastDay', {
      day, level,
      summary: {
        rollOne: { mainTraitsPacked: pack(DRAW) },
        rollTwo: { bonusTraitsPacked: bonusDraw ? pack(bonusDraw) : null },
      },
      winners: [],
      roll1: { day, level, purchaseLevel: level, wins: [] },
      roll2: { day, level, purchaseLevel: level, wins: [] },
      status: 'resolved',
    });
    for (let i = 0; i < 8; i += 1) await flushMicrotasks();
    return el;
  }

  async function progress(traits, { day = 45, bonusPhase = false, liveTraits } = {}) {
    document.dispatchEvent({
      type: 'replay:spin-progress',
      detail: {
        day,
        player: PLAYER,
        bonusPhase,
        traits,
        ...(liveTraits === undefined ? {} : { liveTraits }),
      },
    });
    for (let i = 0; i < 4; i += 1) await flushMicrotasks();
  }

  // One readable snapshot of the first card: what each quadrant is claiming.
  const faces = (el) => el
    .querySelectorAll('.ldj-foil-machine-slot')[0]
    .querySelectorAll('.ldj-foil-machine-cell')
    .map((cell) => ({
      points: cell.getAttribute('data-match-points'),
      symbol: cell.classList.contains('is-symbol-match'),
      colour: cell.classList.contains('is-color-match'),
      miss: cell.classList.contains('is-no-match'),
    }));
  const flashes = (el) => el
    .querySelectorAll('.ldj-foil-machine-slot')[0]
    .querySelectorAll('.ldj-foil-machine-cell')
    .map((cell) => cell.classList.contains('is-match-flash'));
  const DORMANT = { points: null, symbol: false, colour: false, miss: false };
  const HIT2 = { points: '2', symbol: false, colour: true, miss: false };
  const HIT1 = { points: '1', symbol: true, colour: false, miss: false };
  const MISS = { points: '0', symbol: false, colour: false, miss: true };

  test('a cycling face lights symbol/perfect matches and clears them on the next face', async () => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = foilFetch();
    let el = null;
    try {
      el = await mount();
      await progress([null, null, null, null], {
        liveTraits: [9, null, null, null],
      });
      assert.deepEqual(faces(el), [HIT1, DORMANT, DORMANT, DORMANT],
        'same symbol with a different colour lights only the badge');

      await progress([null, null, null, null], {
        liveTraits: [1, null, null, null],
      });
      assert.deepEqual(faces(el), [HIT2, DORMANT, DORMANT, DORMANT],
        'the exact live symbol and colour light the whole quadrant');

      await progress([null, null, null, null], {
        liveTraits: [2, null, null, null],
      });
      assert.deepEqual(faces(el), [MISS, DORMANT, DORMANT, DORMANT],
        'changing away removes the transient lamp on the same event frame');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('a locked face stays lit while the other live faces continue changing', async () => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = foilFetch();
    let el = null;
    try {
      el = await mount();
      await progress([DRAW[0], null, null, null], {
        liveTraits: [DRAW[0], 70, null, null],
      });
      assert.deepEqual(faces(el), [HIT2, HIT2, DORMANT, DORMANT]);

      await progress([DRAW[0], null, null, null], {
        liveTraits: [DRAW[0], 69, null, null],
      });
      assert.deepEqual(faces(el), [HIT2, MISS, DORMANT, DORMANT],
        'the cycling q1 light clears while the committed q0 light persists');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('bonus faces remain transient through final lock and completion while main locks persist', async () => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = foilFetch();
    let el = null;
    try {
      const bonusDraw = [2, 69, 130, 201];
      el = await mount({ bonusDraw });
      await progress(DRAW);
      document.dispatchEvent({
        type: 'replay:spin-complete',
        detail: { day: 45, player: PLAYER, bonusPhase: false, bonusAvailable: true },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.deepEqual(faces(el), [HIT2, HIT1, MISS, HIT2],
        'the settled main draw is durable before bonus starts');

      await progress([null, null, null, null], {
        bonusPhase: true,
        liveTraits: [null, null, 130, null],
      });
      assert.deepEqual(faces(el), [HIT2, HIT1, HIT2, HIT2],
        'a live bonus match layers over the durable main result');

      await progress([null, null, null, null], {
        bonusPhase: true,
        liveTraits: [null, null, 132, null],
      });
      assert.deepEqual(faces(el), [HIT2, HIT1, MISS, HIT2],
        'changing the bonus face clears only its transient contribution');

      await progress([null, null, 130, null], {
        bonusPhase: true,
        liveTraits: [null, null, 130, null],
      });
      assert.deepEqual(flashes(el), [false, false, true, false],
        'the final matching bonus stop may pop while its reel is actively landing');
      document.dispatchEvent({
        type: 'replay:spin-complete',
        detail: { day: 45, player: PLAYER, bonusPhase: true, bonusAvailable: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.deepEqual(faces(el), [HIT2, HIT1, MISS, HIT2],
        'spin completion alone clears the final bonus overlay and restores durable main faces');
      assert.deepEqual(flashes(el), [false, false, false, false],
        'the bonus lock pop cannot visually outlive spin completion');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('a matching reel lock pops once while its earned lamp stays on', async () => {
    const priorFetch = globalThis.fetch;
    const priorSetTimeout = globalThis.setTimeout;
    const priorClearTimeout = globalThis.clearTimeout;
    const scheduled = [];
    globalThis.fetch = foilFetch();
    globalThis.setTimeout = (fn, delay) => {
      const handle = { fn, delay, cleared: false, unref() {} };
      scheduled.push(handle);
      return handle;
    };
    globalThis.clearTimeout = (handle) => { if (handle) handle.cleared = true; };
    let el = null;
    try {
      el = await mount();
      await progress([DRAW[0], null, null, null]);
      assert.deepEqual(flashes(el), [true, false, false, false],
        'only the newly committed matching quadrant receives the lock-on pop');
      const firstFlash = scheduled.find((entry) => entry.delay === 640 && !entry.cleared);
      assert.ok(firstFlash, 'the lock-on pop has a finite 640ms lifetime');
      firstFlash.fn();
      assert.deepEqual(flashes(el), [false, false, false, false],
        'the one-shot lock-on class clears when its window ends');
      assert.equal(faces(el)[0].colour, true,
        'the durable full-match lamp remains after the pop clears');

      await progress([DRAW[0], DRAW[1], null, null]);
      assert.deepEqual(flashes(el), [false, true, false, false],
        'the next reel gets its own pop without restarting the prior quadrant');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      globalThis.setTimeout = priorSetTimeout;
      globalThis.clearTimeout = priorClearTimeout;
    }
  });

  test('each quadrant lights as its own reel stops, and the rest stay dormant', async () => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = foilFetch();
    let el = null;
    try {
      el = await mount();
      assert.deepEqual(faces(el), [DORMANT, DORMANT, DORMANT, DORMANT],
        'a seated card is dormant before the reels commit anything');

      // The panel opens every spin by publishing four nulls.
      await progress([null, null, null, null]);
      assert.deepEqual(faces(el), [DORMANT, DORMANT, DORMANT, DORMANT],
        'an opening emit with nothing committed lights nothing');

      await progress([DRAW[0], null, null, null]);
      assert.deepEqual(faces(el), [HIT2, DORMANT, DORMANT, DORMANT],
        'the first reel to stop lights its own quadrant and only its own');

      await progress([DRAW[0], DRAW[1], null, null]);
      assert.deepEqual(faces(el), [HIT2, HIT1, DORMANT, DORMANT],
        'a symbol-only stop reads as one point, exactly as it does when settled');

      await progress([DRAW[0], DRAW[1], DRAW[2], null]);
      assert.deepEqual(faces(el), [HIT2, HIT1, MISS, DORMANT],
        'a stopped reel that missed is a graded miss; the one still turning is not');

      await progress(DRAW);
      assert.deepEqual(faces(el), [HIT2, HIT1, MISS, HIT2],
        'the last reel completes the card');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('settling on the same faces is a no-op — the card does not repaint', async () => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = foilFetch();
    let el = null;
    try {
      el = await mount();
      await progress(DRAW);
      const duringSpin = faces(el);
      assert.deepEqual(duringSpin, [HIT2, HIT1, MISS, HIT2]);

      document.dispatchEvent({
        type: 'replay:spin-complete',
        detail: { day: 45, player: PLAYER, bonusPhase: false, bonusAvailable: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();

      assert.deepEqual(faces(el), duringSpin,
        'the presentation showed the real draw, so settling changes not one face');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('a lit presentation is not a claim: the ring and the tray wait for the settle', async () => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = foilFetch();
    let el = null;
    try {
      el = await mount();
      await progress(DRAW);
      const slot = el.querySelectorAll('.ldj-foil-machine-slot')[0];
      // This card grades T5 — over the claim threshold — yet mid-spin it may
      // announce nothing beyond the four faces the reels have shown.
      assert.equal(slot.classList.contains('is-match'), false,
        'no claim ring while the board is still spinning');
      assert.equal(slot.classList.contains('is-graded'), false,
        'and the socket is not marked graded off a presentation');
      assert.equal(slot.getAttribute('data-score'), null);
      assert.equal(slot.getAttribute('data-draw-kind'), null);
      assert.equal(pendingActionsMod.getPendingActions().length, 0,
        'and nothing is published to the shared claim tray');

      document.dispatchEvent({
        type: 'replay:spin-complete',
        detail: { day: 45, player: PLAYER, bonusPhase: false, bonusAvailable: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.equal(slot.classList.contains('is-match'), true,
        'the ring is the settled draw\'s statement and arrives with it');
      assert.equal(slot.getAttribute('data-score'), 'T5');
      assert.equal(pendingActionsMod.getPendingActions().length, 0,
        'the claim itself still waits behind the scratch gate');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('fail closed: malformed, out-of-range and foreign-day presentations light nothing', async () => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = foilFetch();
    let el = null;
    try {
      el = await mount();
      await progress([300, -1, 'gold', null]);
      assert.deepEqual(faces(el), [DORMANT, DORMANT, DORMANT, DORMANT],
        'a trait outside 0..255, a negative, and a string are all not-information');

      document.dispatchEvent({
        type: 'replay:spin-progress',
        detail: { day: 44, player: PLAYER, bonusPhase: false, traits: DRAW },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.deepEqual(faces(el), [DORMANT, DORMANT, DORMANT, DORMANT],
        'a spin on another day cannot light the pinned day\'s cards');

      document.dispatchEvent({
        type: 'replay:spin-progress',
        detail: { day: 45, player: PLAYER, bonusPhase: false },
      });
      for (let i = 0; i < 4; i += 1) await flushMicrotasks();
      assert.deepEqual(faces(el), [DORMANT, DORMANT, DORMANT, DORMANT],
        'an event with no traits array at all is dormant, not a crash');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('an off-level pack stays dark through the whole spin', async () => {
    // Same rule the settled path already enforces: a pack bought for the next
    // level is not comparable to the level resolving in front of it. The
    // presentation goes through the same gate, so the card cannot light during
    // the show and then go dark at the settle.
    const priorFetch = globalThis.fetch;
    globalThis.fetch = foilFetch(39);
    let el = null;
    try {
      storeMod.update('app.gameState', { level: 38, phase: 'PURCHASE', jackpotPhaseFlag: false });
      el = await mount({ level: 38, day: 190 });
      await progress(DRAW, { day: 190 });
      assert.deepEqual(faces(el), [DORMANT, DORMANT, DORMANT, DORMANT],
        'the level 39 pack grades against nothing on the level 38 board, spinning or settled');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('the day boundary puts a presentation-lit card out too', async () => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = foilFetch();
    let el = null;
    try {
      el = await mount();
      await progress(DRAW);
      assert.deepEqual(faces(el), [HIT2, HIT1, MISS, HIT2]);

      storeMod.update('app.daySync', {
        day: 46, ready: false, jackpotReady: false, coinflipReady: false,
        rngRequested: false, rngLocked: false, rngFulfilled: false,
        phase: 'waiting-both',
      });
      for (let i = 0; i < 8; i += 1) await flushMicrotasks();
      // The new day has no pack yet, so the sockets empty out entirely. What
      // matters is that nothing the old reels lit survives into them.
      assert.deepEqual(faces(el).filter((face) => face.points != null), [],
        'yesterday\'s reels do not keep a face lit over today\'s undrawn board');
      assert.equal(
        el.querySelectorAll('.ldj-foil-machine-cell')
          .filter((cell) => cell.classList.contains('is-symbol-match')
            || cell.classList.contains('is-color-match')).length,
        0,
        'and not one presentation hit is still burning anywhere in the bank');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
    }
  });

  test('teardown drops the presentation and unsubscribes the progress feed', () => {
    const src = LAST_DAY_SRC;
    const teardown = src.slice(src.indexOf('disconnectedCallback() {'));
    assert.match(teardown, /removeEventListener\('replay:spin-progress'/,
      'the progress feed is released with the rest of the panel listeners');
    assert.match(teardown, /this\.#foilPresentation = null;/,
      'and a detached cabinet keeps no reels state');
    for (const reset of ['#resetDayGates() {', '#onDecimatorOpened(e) {']) {
      const from = src.indexOf(reset);
      assert.ok(from > 0, `${reset} still exists`);
      assert.ok(src.slice(from, from + 1800).includes('this.#foilPresentation = null;'),
        `${reset} clears the presentation along with the other day gates`);
    }
  });

  test('the current sheet is inline, last, and cannot fork from the copper', () => {
    const bank = LAST_DAY_SRC.slice(
      LAST_DAY_SRC.indexOf('<div class="ldj-foil-machine-bank"'),
      LAST_DAY_SRC.indexOf('</svg>') + 6,
    );
    // Placement: app.css puts the four sockets on the bank grid by
    // .ldj-foil-machine-slot:nth-child(1..4). Anything inserted ahead of them
    // shifts every one of those placements, so the sheet goes last.
    assert.ok(bank.lastIndexOf('<span class="ldj-foil-machine-slot">')
      < bank.indexOf('<svg class="ldj-foil-machine-current"'),
      'the sheet is the last child, behind all four sockets in source order');
    assert.match(APP_CSS, /\.ldj-foil-machine-slot:nth-child\(4\) \{ grid-column: 5; grid-row: 2; \}/,
      'and the nth-child grid placement it must not disturb is still what places them');

    // The lit lanes ARE the copper lanes. Same list, same order, no exceptions.
    const inline = [...bank.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1]);
    const copper = [...FOIL_ROUTING_SVG.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1]);
    assert.deepEqual(inline, copper,
      'the current sheet is the copper sheet, verbatim — it cannot light a route the board does not have');
    assert.equal(inline.length, 8);

    // Four groups, two lanes each, in the socket order app.css places them in.
    for (const group of [1, 2, 3, 4]) {
      assert.match(bank, new RegExp(`ldj-foil-lane ldj-foil-lane--${group}"`),
        `socket ${group} has its own lane group`);
    }
    assert.match(bank, /ldj-foil-lane--1" stroke="url\(#ldjFoilCurrentL\)"/,
      'left-hand sockets take the left module\'s ramp');
    assert.match(bank, /ldj-foil-lane--4" stroke="url\(#ldjFoilCurrentR\)"/,
      'and right-hand sockets the right module\'s');
    assert.equal(inline.filter((route) => /^M(?:34|1338)\b/.test(route)).length, 0,
      'no current runs in from the ground rail — flow only follows board-to-socket lanes');
  });

  test('an occupied socket lights its own lanes, and only during the drawing', () => {
    // Occupancy is read straight off the DOM state the bank already publishes:
    // #renderFoilBackdrop puts .is-loaded on a socket that seated a ticket.
    for (const socket of [1, 2, 3, 4]) {
      assert.match(DRAWING_CSS, new RegExp(
        `\\.ldj-foil-machine-bank:has\\(\\.ldj-foil-machine-slot:nth-child\\(${socket}\\)\\.is-loaded\\) `
        + `\\.ldj-foil-lane--${socket}`,
      ), `socket ${socket}'s lanes are lit by socket ${socket}'s own occupancy`);
    }
    assert.match(DRAWING_CSS, /\.ldj-foil-machine-current \{[^}]*opacity: 0;/s,
      'the sheet is dark at rest, so an empty bank never draws current');
    assert.match(DRAWING_CSS, /\.ldj-foil-lane \{[^}]*opacity: 0;/s,
      'and an empty bay\'s lanes are dark even while the machine is spinning');
    assert.match(
      DRAWING_CSS,
      /:has\(replay-panel \.replay-reveal-btn\.is-spinning\)\s*\n?\s*\.ldj-foil-machine-current \{[^}]*opacity: 0\.4;/s,
      'the bank only carries current while the drawing is actually running',
    );
  });

  test('the widget and foil currents stay restrained', () => {
    const peak = (name) => {
      const block = DRAWING_CSS.match(new RegExp(`@keyframes ${name} \\{[^}]*\\}`, 's'))[0];
      return Math.max(...[...block.matchAll(/opacity: ([\d.]+)/g)].map((m) => Number(m[1])));
    };
    const bank = peak('jackpot-foil-current-drive');
    assert.ok(bank <= 0.5, `the bank peaks at ${bank}`);
    assert.doesNotMatch(DRAWING_CSS, /jackpot-board-current-drive/,
      'the old whole-sheet opacity pulse cannot animate unrelated board copper');
    assert.match(DRAWING_CSS,
      /\.jackpot-board-current\s*\{[^}]*opacity:\s*0\.62;/s,
      'the new four-route widget current stays below full intensity');
  });

  test('reduced motion keeps the lanes lit and stops them moving', () => {
    const reduced = DRAWING_CSS.slice(DRAWING_CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(reduced, /\.ldj-foil-machine-current \{\s*animation: none !important;/,
      'the sheet stops breathing');
    assert.match(reduced,
      /\.ldj-foil-machine-cell::after \{\s*transition: none !important;/,
      'live quadrant-mask changes become immediate instead of continuously tweening');
    assert.match(reduced,
      /\.ldj-foil-machine-cell img \{\s*transition: none !important;/,
      'live badge brightness and opacity changes become immediate');
    assert.match(reduced, /\.ldj-foil-lane path \{\s*stroke-dasharray: none;\s*animation: none;/,
      'and the dashes close into solid traces rather than travelling');
    assert.doesNotMatch(reduced, /\.ldj-foil-lane \{[^}]*opacity/s,
      'but which sockets are being fed is state, so nothing goes dark');
    assert.doesNotMatch(DRAWING_CSS, /ldj-foil-machine-current[^{]*\{[^}]*background:\s*url/s,
      'the bank current is never served as a background image again');
    assert.match(reduced,
      /> \.jackpot-board-current \.jackpot-board-current__packet use\s*\{\s*stroke-dasharray:\s*none;\s*animation:\s*none !important;/s,
      'the button-to-widget routes become steady lines instead of travelling packets');
    assert.match(reduced, /\.jackpot-chainlink__lead \{\s*animation: none !important;/,
      'the two VRF packets stop travelling');
    assert.match(reduced,
      /replay-reveal-btn\.is-spinning\s*\) \.jackpot-chainlink__cell \{[^}]*animation: none !important;[^}]*opacity: 1;/s,
      'and the ring becomes a steady lit state instead of disappearing');
  });

  test('the panel publishes both live faces and BOTH-reels-stopped commits', () => {
    const src = REPLAY_PANEL_SRC;
    const from = src.indexOf('const emitSpinProgress = (liveTraits');
    assert.ok(from > 0, 'the panel publishes its live and committed faces');
    const emit = src.slice(from, src.indexOf('\n    };', from));

    assert.match(emit, /if \(!lockedSymbols\[i\] \|\| !lockedColors\[i\]\) continue;/,
      'a symbol-locked reel whose colour is still turning is NOT committed — the '
      + 'shown colour is random, and grading it would invent a colour miss');
    assert.match(emit, /if \(displayTraits\[i\] == null\) continue;/,
      'and a quadrant with no real trait publishes nothing rather than the 0/0 fallback');
    assert.match(emit, /const traits = \[null, null, null, null\];/,
      'uncommitted quadrants publish null, which the host reads as "not yet information"');
    assert.match(emit, /traits\[contractQ\] = \(contractQ \* 64\) \+ \(col \* 8\) \+ sym;/,
      'the published byte is packed the way the contract packs it, in CONTRACT quadrant order');
    assert.match(emit, /liveTraits,/,
      'the same progress payload carries the exact cycling faces separately');
    assert.doesNotMatch(emit, /announcedCommits/,
      'live face changes are not throttled behind the committed count');
    assert.match(emit, /if \(!announce\) return;/,
      'and a silent restore replays no presentation');

    const frame = src.slice(src.indexOf('// Render random or locked badges'));
    assert.match(frame, /const liveTraits = \[null, null, null, null\];/,
      'each painted frame starts one explicit live-face snapshot');
    assert.match(frame, /liveTraits\[contractQ\] = shownTrait;/,
      'the event byte is the exact trait packed for the badge currently on screen');
    assert.match(frame, /emitSpinProgress\(liveTraits\);/,
      'each painted frame reaches the host so a transient light can clear immediately');

    // The same frame loop uses the same both-locked test to commit a
    // quadrant's ownership colour. If these two ever disagree, the foil card
    // would light against a face the board has not shown yet.
    assert.match(src, /if \(lockedSymbols\[i\] && lockedColors\[i\]\) \{/,
      'the frame loop still gates its own commit on the same pair');
  });

  test('the cabinet grades the presentation with gradeLine, not a second copy', () => {
    const src = LAST_DAY_SRC;
    const from = src.indexOf('#foilPresentationGrade(line) {');
    assert.ok(from > 0, 'the presentation grader exists');
    const body = src.slice(from, src.indexOf('\n  }', from));
    assert.match(body, /gradeLine\(line, packed >>> 0\)/,
      'presentation faces come from the same grader the settled path uses');
    assert.doesNotMatch(body, /&\s*7|>>\s*3/,
      'it does not re-derive symbol/colour bits — that logic lives once, in foil-match.js');
    assert.match(body, /if \(!this\.#foilLevelLocked\(\)\) return null;/,
      'and it fails closed on the same level gate as the settled sets');
  });
});

describe('Results CTA gating (whole board + flip before the popup)', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    coinflipMod.__setResolvedStakeReaderForTest(async () => null);
    resetDom();
    await import('../last-day-jackpot.js');
  });

  function instantiate() {
    const replay = makeFakeElement('replay-panel');
    const controls = makeFakeElement('div');
    controls.classList.add('replay-controls');
    const reveal = makeFakeElement('button');
    reveal.attributes['data-bind'] = 'reveal-btn';
    reveal.hidden = false;
    controls.appendChild(reveal);
    replay.appendChild(controls);
    _docBody.appendChild(replay);
    const slot = makeFakeElement('div');
    slot.attributes['data-bind'] = 'day-summary-slot';
    slot.hidden = true;
    _docBody.appendChild(slot);
    const Ctor = customElements.get('last-day-jackpot');
    const el = new Ctor();
    _docBody.appendChild(el);
    el.connectedCallback();
    return el;
  }

  function scratchEvent(detail) {
    return { type: 'replay:scratch-complete', detail };
  }

  test('DAY SUMMARY occupies the fixed digital Spin Jackpot slot without corner overshoot', () => {
    assert.doesNotMatch(LAST_DAY_SRC, /const target = controls \|\| slot/,
      'the CTA never falls through into the obsolete second row');
    assert.match(LAST_DAY_SRC, /if \(slot\) slot\.hidden = true/,
      'the fallback row remains collapsed in every state');
    assert.match(
      DRAWING_CSS,
      /replay-controls > \.ldj-results-cta\s*\{[^}]*border-radius:\s*7px;[^}]*background-color:\s*#070609[^}]*clip-path:\s*none[^}]*font-family:\s*var\(--font-display/s,
      'the replacement button uses the same rounded LED control envelope',
    );
    assert.match(
      DRAWING_CSS,
      /replay-controls > \.ldj-results-cta::before,[\s\S]*?replay-controls > \.ldj-results-cta::after\s*\{[^}]*content:\s*none/s,
      'the old pseudo-element plate cannot protrude behind the digital display corners',
    );
  });

  test('hidden on a fresh resolved day; roll-1 completion with a bonus AHEAD keeps it hidden', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    // Flip gate pre-satisfied so the board gate is what's under test.
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    const slot = document.querySelector('[data-bind="day-summary-slot"]');
    const controls = document.querySelector('replay-panel').querySelector('.replay-controls');
    const reveal = controls.querySelector('[data-bind="reveal-btn"]');
    assert.ok(cta, 'CTA rendered in the shell');
    assert.equal(cta.hidden, true, 'hidden before any scratch');
    assert.equal(slot.hidden, true, 'obsolete extra row always reserves zero space');
    assert.equal(cta.parentElement, controls, 'summary shares Reveal Draw\'s action row');

    // Roll 1 done but the bonus roll is still ahead → board NOT played out.
    globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: true }));
    await flushMicrotasks();
    assert.equal(cta.hidden, true, 'still hidden while the bonus roll is pending');
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_5`), null,
      'main completion alone does not claim the bonus was cleared');
    assert.equal(globalThis.localStorage.getItem(`jackpot_bonus_pending_day_${CHAIN.id}_5`), '1',
      'main completion records that the bonus is genuinely still pending');

    // Bonus roll scratched out → whole board done → CTA appears.
    globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: true, bonusAvailable: false }));
    await flushMicrotasks();
    assert.equal(cta.hidden, false, 'CTA shown after the final roll');
    assert.equal(slot.hidden, true, 'no second action row is introduced');
    assert.equal(reveal.hidden, true, 'Reveal Draw and Day Summary are mutually exclusive');
    assert.equal(globalThis.localStorage.getItem(`jackpot_complete_day_${CHAIN.id}_5`), '1',
      'finishing the bonus persists the preferred reload view');
    assert.equal(globalThis.localStorage.getItem(`jackpot_bonus_pending_day_${CHAIN.id}_5`), null,
      'finishing the bonus retires its pending latch');
    el.disconnectedCallback();
  });

  test('no bonus this draw → single roll completion opens the CTA (flip already revealed)', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, false, 'CTA shown — no bonus roll to wait for');
    el.disconnectedCallback();
  });

  test('flip not revealed yet → CTA stays hidden until flip:revealed', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    // Whole board done, but the coin is still spinning (no flip_day key,
    // coinflip-row waiver unknown — default fetch throws in this harness).
    globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, true, 'hidden until the flip is revealed');

    // The player taps the coin — app-daily-flip writes the key + dispatches.
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    globalThis.document.dispatchEvent({ type: 'flip:revealed', detail: { day: 5 } });
    await flushMicrotasks();
    assert.equal(cta.hidden, false, 'CTA shown once both gates open');
    el.disconnectedCallback();
  });

  test('detail-less scratch-complete (legacy/tests) counts as final', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    globalThis.document.dispatchEvent({ type: 'replay:scratch-complete' });
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, false, 'bare event treated as final');
    el.disconnectedCallback();
  });

  test('reloaded spun day (spun_day persisted, no live scratch) opens the CTA without a re-scratch', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    globalThis.localStorage.setItem(`spun_day_${CHAIN.id}_5`, '1');
    globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
    const el = instantiate();
    storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
    await flushMicrotasks();
    const cta = el.querySelector('[data-bind="ldj-results-cta"]');
    assert.equal(cta.hidden, false, 'prior-session play-through honored on reload');
    el.disconnectedCallback();
  });

  test('DAY SUMMARY reads the day-scoped pack and player feeds before queuing the reveal', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0x1111000000000000000000000000000000000001';
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    const requested = [];
    const box7Tx = `0x${'7'.repeat(64)}`;
    const box8Tx = `0x${'8'.repeat(64)}`;
    const catchupTx = `0x${'c'.repeat(64)}`;
    globalThis.fetch = async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            blockNumber: '500',
            ticketRevealPacks: [
              { packId: 'tickets-day-5-batch-0', ticketCount: 10 },
              { packId: 'tickets-day-5-batch-1', ticketCount: 3 },
            ],
            lootboxPacks: [
              { packId: `lootbox-${box7Tx}-1`, lootboxIndex: 7, revealBlock: '501' },
              { packId: `lootbox-${box8Tx}-1`, lootboxIndex: 8, revealBlock: '502' },
              // One advance transaction can settle years of deferred index-0
              // boxes. They belong in the opened count, never as an endless
              // queue of AUTO-RESOLVED LOOTBOX reward cards.
              ...Array.from({ length: 40 }, (_, index) => ({
                packId: `lootbox-${catchupTx}-${index * 2 + 2}`,
                lootboxIndex: 0,
                revealBlock: '503',
              })),
            ],
          }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            level: 10,
            activity: {
              lootboxPurchases: [
                { lootboxIndex: 7 }, { lootboxIndex: 8 }, {}, {},
              ],
              lootboxResults: [
                { lootboxIndex: 7, rewardType: 'opened' },
                { lootboxIndex: 8, rewardType: 'flipOpened' },
              ],
              coinflip: null,
            },
          }),
        };
      }
      if (path.includes('/lootbox/legs?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              // lootboxIndex is an RNG slot and repeats across levels. These
              // 40 historical rows are deliberate poison: only the two
              // transaction hashes proven by the day-5 packs may survive.
              ...Array.from({ length: 40 }, (_, level) => ({
                uid: `old-${level}`,
                player: address,
                legType: 'opened',
                lootboxIndex: 7,
                transactionHash: `0x${level.toString(16).padStart(64, '0')}`,
                blockNumber: String(100 + level),
                logIndex: 1,
                ord: (100 + level) * 1_000_000 + 1,
                levelAtOpen: level + 1,
                rewardData: { amount: '1', futureTickets: 0, flip: '0' },
              })),
              {
                uid: 'r7', player: address, legType: 'opened', lootboxIndex: 7,
                transactionHash: box7Tx, blockNumber: '501', logIndex: 1, ord: 501000001,
                levelAtOpen: 10,
                rewardData: {
                  amount: '100', futureLevel: 10, futureTickets: 200,
                  roundedUp: false, flip: String(4n * 10n ** 18n),
                },
              },
              {
                uid: 'r8', player: address, legType: 'flipOpened', lootboxIndex: 8,
                transactionHash: box8Tx, blockNumber: '502', logIndex: 1, ord: 502000001,
                levelAtOpen: 10,
                rewardData: {
                  flipAmount: '100', ticketLevel: 10, tickets: 0,
                  roundedUp: false, flipReward: '0',
                },
              },
              {
                uid: 'r9', player: address, legType: 'dgnrs', lootboxIndex: 8,
                transactionHash: box8Tx, blockNumber: '502', logIndex: 2, ord: 502000002,
                rewardData: { dgnrsAmount: String(7n * 10n ** 18n) },
              },
              ...Array.from({ length: 40 }, (_, index) => [{
                uid: `catchup-reward-${index}`,
                player: address,
                legType: 'dgnrs',
                lootboxIndex: 0,
                transactionHash: catchupTx,
                blockNumber: '503',
                logIndex: index * 2 + 1,
                ord: 503000000 + index * 2 + 1,
                rewardData: { dgnrsAmount: String((index + 1) * 10) },
              }, {
                uid: `catchup-opened-${index}`,
                player: address,
                legType: 'opened',
                lootboxIndex: 0,
                transactionHash: catchupTx,
                blockNumber: '503',
                logIndex: index * 2 + 2,
                ord: 503000000 + index * 2 + 2,
                levelAtOpen: index + 1,
                rewardData: { amount: '1', futureTickets: 0, flip: '0' },
              }]).flat(),
            ],
            nextCursor: null,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      await flushMicrotasks();
      globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      const cta = el.querySelector('[data-bind="ldj-results-cta"]');
      cta.dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.ok(queued, 'summary reveal queued');
      assert.equal(queued.title, 'DAY 5 SUMMARY');
      const { lootboxResults, ...activityCounts } = queued.activity;
      assert.deepEqual(activityCounts, {
        ticketsRevealed: 13,
        lootboxesBought: 4,
        lootboxesOpened: 2,
        hasCoinflipBet: false,
        coinflipWon: null,
        coinflipStakeAmount: '0',
        coinflipRewardPercent: 0,
      });
      assert.equal(lootboxResults.length, 2,
        'only the two manual boxes are itemized; 40 deferred index-0 boxes cannot become an endless summary');
      assert.deepEqual(lootboxResults.map((result) => Number(result.lootboxIndex)), [7, 8]);
      assert.deepEqual(lootboxResults.map((result) => result.transactionHash), [box7Tx, box8Tx],
        'reused RNG indexes from 40 historical levels cannot enter this day');
      assert.deepEqual(lootboxResults[0].legs.map((leg) => leg.legType), ['opened']);
      assert.deepEqual(lootboxResults[1].legs.map((leg) => leg.legType), ['opened', 'dgnrs'],
        'same-transaction companion rewards stay attached to their box');
      assert.ok(requested.some((url) => url.includes('/packs?day=5')),
        'pack count came from the day-scoped DB feed');
      assert.ok(requested.some((url) => url.includes(`/viewer/player/${address}/day/5`)),
        'lootboxes and coinflip participation came from the day-scoped DB snapshot');
      assert.ok(requested.some((url) => url.includes('/lootbox/legs?')),
        'the summary loads the full indexed reward legs, not just opened counts');
      assert.equal(cta.hidden, true, 'the summary action is consumed after it queues once');
      assert.equal(
        globalThis.localStorage.getItem(`day_summary_${CHAIN.id}_5_${address}`),
        '1',
        'the consumed state survives a refresh for this player and day',
      );

      // A repeated click on the now-hidden node cannot queue a second summary.
      cta.dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      assert.equal(revealMod.__takeQueuedForTest().length, 0);
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('DAY SUMMARY includes the already-loaded Decimator payout without another endpoint', async () => {
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0xab12000000000000000000000000000000000000';
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address, day: 5, ticketRevealPacks: [], lootboxPacks: [],
          }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            activity: { lootboxPurchases: [], lootboxResults: [], coinflip: null },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', {
        ...RESOLVED_PAYLOAD_DAY5,
        winners: [{
          ...RESOLVED_PAYLOAD_DAY5.winners[0],
          totalEth: '0',
          coinTotal: '0',
          ticketCount: 0,
          breakdown: [],
          decimatorPrize: {
            regularEth: '2000000000000',
            lootboxEth: '500000000000',
            terminalEth: '1000000000000',
          },
        }],
      });
      await flushMicrotasks();
      document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      el.querySelector('[data-bind="ldj-results-cta"]').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.deepEqual(queued.prizes, [{
        type: 'decimator',
        amount: 3_000_000_000_000n,
        lootboxAmount: 500_000_000_000n,
        terminalAmount: 1_000_000_000_000n,
      }]);
      assert.equal(requested.some((path) => /\/decimator(?:\?|\/)/.test(path)), false,
        'the composed last-day winner row is reused instead of adding a DB request');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('far-future center FLIP uses the Degenerus logo without inventing a pink XRP trait', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0xab12000000000000000000000000000000000000';
    const farFutureAmount = 700n * 10n ** 18n;
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = String(url);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ address, day: 5, ticketRevealPacks: [], lootboxPacks: [] }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            activity: { lootboxPurchases: [], lootboxResults: [], coinflip: null },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', {
        ...RESOLVED_PAYLOAD_DAY5,
        winners: [{
          ...RESOLVED_PAYLOAD_DAY5.winners[0],
          totalEth: '0',
          ticketCount: 0,
          coinTotal: farFutureAmount.toString(),
          breakdown: [{
            awardType: 'flip',
            amount: farFutureAmount.toString(),
            count: 1,
            traitId: null,
            level: 2,
          }],
        }],
      });
      await flushMicrotasks();
      document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      el.querySelector('[data-bind="ldj-results-cta"]').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.deepEqual(queued.prizes, [{
        type: 'flip',
        amount: farFutureAmount,
        winningTraitIds: [],
      }]);
      const sequence = revealMod.normalizeSequence(queued);
      assert.equal(sequence.cards[0].icon, '/whitepaper/flame-logo-split.svg');
      assert.deepEqual(sequence.cards[0].winningTraitIds, []);
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('an otherwise empty day with a lost DB-recorded coinflip bet awards the 1 WWXRP summary card', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0x1111000000000000000000000000000000000001';
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = String(url);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ address, day: 5, ticketRevealPacks: [], lootboxPacks: [] }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            activity: {
              lootboxPurchases: [],
              lootboxResults: [],
              coinflip: { stakeAmount: '250000000000000000000', win: false },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      await flushMicrotasks();
      globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      el.querySelector('[data-bind="ldj-results-cta"]').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.deepEqual(queued.prizes, [{ type: 'wwxrp', amount: 10n ** 18n }]);
      assert.equal(queued.noWin, null, 'the WWXRP result replaces the generic NO HIT card');
      assert.equal(queued.consolationOnly, true,
        'the reveal layer can play the consolation horn instead of a winner effect');
      assert.equal(queued.activity.hasCoinflipBet, true);
      assert.equal(queued.activity.coinflipWon, false);
      assert.equal(queued.activity.coinflipStakeAmount, '250000000000000000000');
      assert.equal(queued.activity.coinflipRewardPercent, 0);
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('DAY SUMMARY fails closed when an endpoint echoes an all-time or different-day payload', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0x1111000000000000000000000000000000000001';
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    let legFeedReads = 0;
    globalThis.fetch = async (url) => {
      const path = String(url);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: null, // PACKS-V2 all-time mode — never valid for this summary.
            ticketRevealPacks: Array.from({ length: 40 }, (_, i) => ({
              packId: `tickets-day-all-batch-${i}`, ticketCount: 10,
            })),
            lootboxPacks: Array.from({ length: 40 }, (_, i) => ({
              packId: `lootbox-0x${i.toString(16).padStart(64, '0')}-1`,
              lootboxIndex: 7,
            })),
          }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 40, // stale cross-day response
            activity: {
              lootboxPurchases: Array.from({ length: 40 }, () => ({ lootboxIndex: 7 })),
              lootboxResults: Array.from({ length: 40 }, () => ({
                lootboxIndex: 7, rewardType: 'opened',
              })),
              coinflip: { stakeAmount: String(1_000n * 10n ** 18n), win: false },
            },
          }),
        };
      }
      if (path.includes('/lootbox/legs?')) legFeedReads += 1;
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      await flushMicrotasks();
      globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      el.querySelector('[data-bind="ldj-results-cta"]').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.deepEqual(queued.activity, {
        ticketsRevealed: 0,
        lootboxesBought: 0,
        lootboxesOpened: 0,
        lootboxResults: [],
        hasCoinflipBet: false,
        coinflipWon: null,
        coinflipStakeAmount: '0',
        coinflipRewardPercent: 0,
      });
      assert.equal(legFeedReads, 0, 'an unproven day cannot fan out into historical reward pages');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });

  test('a winning coinflip summary uses the exact flip day instead of a stale viewer level', async () => {
    const { CHAIN } = await import('../../app/chain-config.js');
    const revealMod = await import('../reveal-overlay.js');
    revealMod.__resetForTest();
    const address = '0x1111000000000000000000000000000000000001';
    const exactStake = 20_500n * 10n ** 18n;
    coinflipMod.__setResolvedStakeReaderForTest(async ({ player, day }) => {
      assert.equal(player, address);
      assert.equal(day, 5);
      return exactStake;
    });
    storeMod.update('connected.address', address);
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = String(url);
      if (path.includes('/packs?day=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ address, day: 5, ticketRevealPacks: [], lootboxPacks: [] }),
        };
      }
      if (path.includes('/game/coinflip/day/5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ day: 5, win: true, rewardPercent: 100 }),
        };
      }
      if (path.includes(`/viewer/player/${address}/day/5`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address,
            day: 5,
            activity: {
              lootboxPurchases: [],
              lootboxResults: [],
              coinflip: {
                // Deliberately wrong level-scoped data: this is the regression.
                stakeAmount: String(3_000n * 10n ** 18n),
                win: false,
                rewardPercent: 50,
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => null };
    };

    let el = null;
    try {
      globalThis.localStorage.setItem(`flip_day_${CHAIN.id}_5`, '1');
      el = instantiate();
      storeMod.update('app.lastDay', RESOLVED_PAYLOAD_DAY5);
      await flushMicrotasks();
      globalThis.document.dispatchEvent(scratchEvent({ bonusPhase: false, bonusAvailable: false }));
      await flushMicrotasks();
      el.querySelector('[data-bind="ldj-results-cta"]').dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      await flushMicrotasks();

      const [queued] = revealMod.__takeQueuedForTest();
      assert.deepEqual(queued.prizes, [], 'no consolation is fabricated after a win');
      assert.equal(queued.noWin, null,
        'the coinflip receipt replaces a generic empty-day card');
      assert.equal(queued.consolationOnly, false);
      assert.equal(queued.activity.hasCoinflipBet, true);
      assert.equal(queued.activity.coinflipWon, true);
      assert.equal(queued.activity.coinflipStakeAmount, String(exactStake),
        'the exact day stake replaces the stale 3k viewer value');
      assert.equal(queued.activity.coinflipRewardPercent, 100,
        'the global day result replaces the viewer level result');
      const normalized = revealMod.normalizeSequence(queued);
      const flipCard = normalized.cards.find((card) => card.type === 'coinflip-result');
      assert.equal(flipCard.value, '+41,000 FLIP');
      assert.equal(flipCard.outcomeLabel, 'WIN');
      assert.equal(flipCard.outcomePercent, '200%');
    } finally {
      if (el) el.disconnectedCallback();
      globalThis.fetch = priorFetch;
      revealMod.__resetForTest();
    }
  });
});

describe('the LCD key turns the Mine FLIP crank while results are pending', () => {
  // mineFlip() is the permissionless keeper crank (app/app/mine-flip.js), and it
  // has to be called repeatedly to walk ticket and jackpot processing to a
  // resolved day. The player watching this LCD is the one who wants that
  // finished, so while the results window is open the key feeds the crank. The
  // row and its runner come from app-mine-flip.js via pending-actions; nothing
  // about availability or the transaction is re-derived here.
  const mineFlipRow = (over = {}) => ({
    id: 'mine-flip:0xabc:day-81',
    kind: 'mass-resolution',
    label: 'Mine FLIP',
    state: 'ready',
    write: true,
    run: async () => {},
    ...over,
  });

  async function processingPanel() {
    await import('../replay-panel.js');
    const Ctor = customElements.get('replay-panel');
    const panel = new Ctor();
    panel.innerHTML = `
      <div class="replay-controls">
        <button data-bind="reveal-btn"></button>
      </div>`;
    panel.setAttribute('data-day-warming', '');
    panel.attributeChangedCallback('data-day-warming', null, '');
    return { panel, btn: panel.querySelector('[data-bind="reveal-btn"]') };
  }

  test('a callable crank arms the key and names the action it will run', async () => {
    const { panel, btn } = await processingPanel();
    assert.equal(btn.classList.contains('is-processing'), true);
    assert.equal(btn.disabled, true, 'an unarmed processing key stays inert');
    const label = btn.textContent;

    panel.__setPendingActionsForTest([mineFlipRow()]);

    assert.equal(btn.disabled, false, 'the crank makes the key pressable');
    assert.equal(btn.dataset.replayAction, 'mine-flip',
      'the enabled face and its click route share one action token');
    assert.equal(btn.textContent, 'MINE FLIP · PROCESSING',
      'an enabled Mine FLIP key cannot simultaneously claim RNG is incoming');
    assert.notEqual(btn.textContent, label,
      'the action name replaces the passive pipeline label while the crank owns the key');
    assert.equal(btn.getAttribute('data-jp-stage'), 'rng',
      'and the stage it reports is unchanged, so the ring keeps chasing');
  });

  test('no crank, or a busy one, falls through to the normal inert key', async () => {
    const { panel, btn } = await processingPanel();
    panel.__setPendingActionsForTest([]);
    assert.equal(btn.disabled, true, 'no published row means no hijack');

    panel.__setPendingActionsForTest([mineFlipRow({ state: 'busy', run: null })]);
    assert.equal(btn.disabled, true, 'a row the resolver marked busy is not callable');

    panel.__setPendingActionsForTest([mineFlipRow({ run: undefined })]);
    assert.equal(btn.disabled, true, 'a row without a runner is not callable');
  });

  test('one press, one call: the key cannot double-fire while a call is in flight', async () => {
    const { panel, btn } = await processingPanel();
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    panel.__setPendingActionsForTest([mineFlipRow({
      run: async () => { calls += 1; await gate; },
    })]);
    assert.equal(btn.disabled, false);

    const first = panel.__triggerMineFlipForTest();
    assert.equal(calls, 1, 'the press reached the resolver runner');
    assert.equal(btn.disabled, true, 'the in-flight call disarms the key');

    const second = await panel.__triggerMineFlipForTest();
    assert.equal(second, false, 'a second press while pending does nothing');
    assert.equal(calls, 1, 'and never reaches the runner twice');

    release();
    assert.equal(await first, true);
  });

  test('the key re-arms for the next call once the receipt lands', async () => {
    const { panel, btn } = await processingPanel();
    panel.__setPendingActionsForTest([mineFlipRow()]);
    assert.equal(await panel.__triggerMineFlipForTest(), true);
    // The resolver re-probes after each receipt and republishes while work
    // remains, which is what makes the next press possible.
    assert.equal(btn.disabled, false, 'still armed for the next crank call');

    // When the chain finally has no work left, the resolver clears the row.
    panel.__setPendingActionsForTest([]);
    assert.equal(btn.disabled, true);
  });

  test('a failing crank stops claiming to be armed rather than throwing at the key', async () => {
    const { panel, btn } = await processingPanel();
    const warn = console.warn;
    console.warn = () => {};
    try {
      panel.__setPendingActionsForTest([mineFlipRow({
        run: async () => { throw new Error('wallet rejected'); },
      })]);
      assert.equal(await panel.__triggerMineFlipForTest(), false);
    } finally {
      console.warn = warn;
    }
    assert.equal(btn.disabled, false, 'the row is still ready, so the player may retry');
  });

  test('results in restores the normal key: no crank press can be armed off-window', async () => {
    await import('../replay-panel.js');
    const Ctor = customElements.get('replay-panel');
    const panel = new Ctor();
    panel.innerHTML = `
      <div class="replay-controls">
        <button data-bind="reveal-btn"></button>
        <button class="ldj-results-cta">DAY SUMMARY</button>
      </div>`;
    panel.querySelector('.ldj-results-cta').hidden = false;
    panel.setAttribute('data-day-warming', '');
    panel.attributeChangedCallback('data-day-warming', null, '');

    panel.__setPendingActionsForTest([mineFlipRow()]);
    const btn = panel.querySelector('[data-bind="reveal-btn"]');
    assert.equal(btn.hidden, true, 'the day summary owns the socket once results are in');
    assert.equal(await panel.__triggerMineFlipForTest(), true,
      'the runner itself is still reachable by the tray');
    // The press path is gated on the action token, which only the processing
    // branch assigns while the crank is armed; the summary branch clears it.
    assert.match(REPLAY_PANEL_SRC,
      /revealBtn\.dataset\?\.replayAction === 'mine-flip'[\s\S]*?this\.#triggerMineFlip\(\)/,
      'the key press is gated on its rendered action, not on the row existing');
    assert.match(REPLAY_PANEL_SRC, /this\.#mineFlipArmed = false;\s*\n\s*const btn = this\.querySelector/,
      'and every non-processing path through the sync disarms it first');
  });

  test('a callable Mine FLIP fills the otherwise empty completed-spin LCD', async () => {
    await import('../replay-panel.js');
    const Ctor = customElements.get('replay-panel');
    const panel = new Ctor();
    panel.innerHTML = `
      <div class="replay-controls">
        <button data-bind="reveal-btn"></button>
      </div>`;
    panel.setAttribute('single-button', '');
    panel.__setSelectedDayForTest(81);
    panel.__setCompletedSpinsForTest({ hasBonus: false });

    const btn = panel.querySelector('[data-bind="reveal-btn"]');
    assert.equal(btn.hidden, true, 'without another action the completed-spin LCD is normally empty');

    let calls = 0;
    panel.__setPendingActionsForTest([mineFlipRow({
      run: async () => { calls += 1; },
    })]);

    assert.equal(btn.hidden, false, 'the empty LCD becomes the available maintenance action');
    assert.equal(btn.disabled, false);
    assert.equal(btn.dataset.replayAction, 'mine-flip');
    assert.equal(btn.textContent, 'MINE FLIP · PROCESSING');
    assert.equal(await panel.__triggerMineFlipForTest(), true);
    assert.equal(calls, 1, 'the fallback face runs the same resolver-owned action');

    panel.setCoinflipHandoff({ day: 81, available: true, revealed: false });
    assert.equal(btn.textContent, 'FLIP COIN', 'a real gameplay action still outranks the fallback');
    assert.equal(btn.dataset.replayAction, 'coinflip');
  });

  test('an enabled key does not energize the Chainlink module at rest', () => {
    // The module reports a real load, not mere clickability. This also prevents
    // an armed Mine FLIP crank from looking as though its RNG work already landed.
    assert.doesNotMatch(DRAWING_CSS,
      /replay-reveal-btn:not\(:disabled\):not\(\[hidden\]\)[^{}]*jackpot-chainlink(?:__cell)?\s*\{/,
      'a pressable key alone must not light the ring or its source module');
  });

  test('physical pointer hit-testing reaches only an armed warming/loading Mine FLIP key', () => {
    assert.match(
      APP_CSS,
      /replay-panel\[data-day-warming\] \.panel > \*,\s*body[^\n]*replay-panel\[data-day-loading\] \.panel > \* \{\s*pointer-events:\s*none;/,
      'the stale-board gate blocks pointer input at the replay-controls ancestor',
    );

    const overrideStart = DRAWING_CSS.indexOf('/* app.css makes the warming/loading board inert');
    const overrideEnd = DRAWING_CSS.indexOf('/* One enlarged VRF instrument', overrideStart);
    assert.ok(overrideStart >= 0 && overrideEnd > overrideStart,
      'the physical-input exception is kept as one auditable cascade block');
    const pointerOverride = DRAWING_CSS.slice(overrideStart, overrideEnd);
    for (const state of ['warming', 'loading']) {
      assert.match(
        pointerOverride,
        new RegExp(
          `replay-panel\\[data-day-${state}\\][\\s\\S]*?`
          + `replay-controls:has\\([\\s\\S]*?`
          + `replay-reveal-btn\\[data-replay-action='mine-flip'\\]:not\\(:disabled\\)`
          + `[\\s\\S]*?pointer-events:\\s*auto`,
        ),
        `${state} restores hit-testing only when the functional action token is armed`,
      );
    }
    assert.doesNotMatch(pointerOverride, /data-jp-action/,
      'the visual glyph hook cannot accidentally make an inert key clickable');
    assert.ok(
      INDEX_SRC.indexOf('/app/styles/app.css') < INDEX_SRC.indexOf('/app/styles/daily-drawing.css'),
      'the narrow exception loads after the broad stale-board lock in the real page cascade',
    );
    assert.match(pointerOverride,
      /is-processing\[[\s\S]*?data-replay-action='mine-flip'[\s\S]*?cursor:\s*pointer/,
      'the armed processing key presents itself as an action, not a wait cursor');
  });
});

describe('the LCD key names the contract-authoritative Mine FLIP action', () => {
  // A resolver row means a simulation of the deployed mineFlip entrypoint found
  // executable work for this wallet. Once that row owns the selected-day key,
  // the key stops narrating a possibly lagging pipeline witness and names the
  // work the press actually does. No transaction is ever started for the player.
  const CRANK_LABEL = 'MINE FLIP · PROCESSING';
  const MINING_LABEL = 'MINE FLIP · MINING';
  const DAY = 81;

  const mineFlipRow = (over = {}) => ({
    id: `mine-flip:0xabc:day-${DAY}`,
    kind: 'mass-resolution',
    label: 'Mine FLIP',
    state: 'ready',
    write: true,
    run: async () => {},
    ...over,
  });

  const signals = (over = {}) => ({
    day: DAY,
    active: true,
    requested: true,
    rngReady: true,
    rngFulfilled: true,
    coinflipReady: false,
    ticketsReady: false,
    jackpotReady: false,
    ...over,
  });

  async function crankPanel(signalOverrides = {}) {
    await import('../replay-panel.js');
    const Ctor = customElements.get('replay-panel');
    const panel = new Ctor();
    panel.innerHTML = `
      <div class="replay-controls">
        <button data-bind="reveal-btn"></button>
      </div>`;
    panel.__setSelectedDayForTest(DAY);
    panel.setAttribute('data-day-warming', '');
    panel.attributeChangedCallback('data-day-warming', null, '');
    panel.setJackpotProcessingState(signals(signalOverrides));
    return { panel, btn: panel.querySelector('[data-bind="reveal-btn"]') };
  }

  test('the Chainlink request hook stays dark until the exact RNG request is observed', async () => {
    const { panel, btn } = await crankPanel({
      requested: false,
      rngReady: false,
      rngFulfilled: false,
    });

    assert.equal(btn.getAttribute('data-jp-stage'), 'rng',
      'the LCD may truthfully say what the boundary pipeline is waiting for');
    assert.equal(btn.getAttribute('data-jp-rng-requested'), null,
      'but the boundary alone publishes no power hook for the Chainlink animation');

    panel.setJackpotProcessingState(signals({
      requested: true,
      rngReady: false,
      rngFulfilled: false,
    }));
    assert.equal(btn.getAttribute('data-jp-stage'), 'rng',
      'the same pending stage remains while the word is in flight');
    assert.equal(btn.getAttribute('data-jp-rng-requested'), 'true',
      'the exact-day request witness starts the Chainlink pending sequence');

    panel.setJackpotProcessingState(signals({
      day: DAY + 1,
      requested: true,
      rngReady: false,
      rngFulfilled: false,
    }));
    assert.equal(btn.getAttribute('data-jp-rng-requested'), null,
      'request evidence for another day cannot light the selected day module');
  });

  test('word in + results pending + a callable crank renames the key', async () => {
    const { panel, btn } = await crankPanel();
    const stageLabel = btn.textContent;
    assert.notEqual(stageLabel, CRANK_LABEL, 'an unarmed key still reports the pipeline');

    panel.__setPendingActionsForTest([mineFlipRow()]);

    assert.equal(btn.textContent, CRANK_LABEL, 'the armed key names the crank');
    assert.equal(btn.disabled, false, 'and it is pressable');
    assert.equal(btn.title, stageLabel,
      'the pipeline stage it replaced stays available on the title');
    assert.match(btn.getAttribute('aria-label'), /^MINE FLIP · PROCESSING\. .+\. Step \d+ of 7\.$/,
      'the accessible name carries the action AND the stage it is grinding');
    assert.equal(btn.classList.contains('is-processing'), true,
      'renaming the face does not take the key out of its processing state');
  });

  test('no crank at all means no claim; a crank mid-work still holds the face', async () => {
    const { panel, btn } = await crankPanel();
    const stageLabel = btn.textContent;

    panel.__setPendingActionsForTest([]);
    assert.equal(btn.textContent, stageLabel,
      'no published row means the mining phase is not running, so no claim');

    // A row the resolver marked busy is the SAME phase, mid-call. The key is
    // not pressable, but it must not stop saying what it is doing.
    panel.__setPendingActionsForTest([mineFlipRow({ state: 'busy', run: null })]);
    assert.equal(btn.textContent, CRANK_LABEL,
      'a busy row is the crank working, not the crank gone');
    assert.equal(btn.disabled, true, 'and it is not pressable while it works');

    panel.__setPendingActionsForTest([mineFlipRow({ run: undefined })]);
    assert.equal(btn.textContent, CRANK_LABEL,
      'a row without a runner is still a published phase; it just cannot be pressed');
    assert.equal(btn.disabled, true);

    panel.__setPendingActionsForTest([]);
    assert.equal(btn.textContent, stageLabel,
      'and clearing the row — the chain reporting no work left — ends the phase');
  });

  test('the label survives the whole crank: press, in flight, receipt, re-arm', async () => {
    // The reported bug: pressing the key made it stop saying MINE FLIP. The
    // press disarms the key for the length of its transaction, and the label
    // used to be gated on that armed flag.
    const { panel, btn } = await crankPanel();
    const stageLabel = btn.textContent;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    panel.__setPendingActionsForTest([mineFlipRow({
      run: async () => { await gate; },
    })]);
    assert.equal(btn.textContent, CRANK_LABEL);

    const press = panel.__triggerMineFlipForTest();
    assert.equal(btn.disabled, true, 'the in-flight call disarms the key');
    assert.equal(btn.textContent, MINING_LABEL,
      'but the key keeps naming the crank while the transaction is in flight');
    assert.match(btn.getAttribute('aria-label'), /^MINE FLIP · MINING\./,
      'and says so to a screen reader too');
    assert.equal(btn.getAttribute('data-jp-action'), 'mine-flip',
      'the pickaxe stays through the call');

    release();
    assert.equal(await press, true);
    assert.equal(btn.textContent, CRANK_LABEL,
      'the receipt re-arms it for the next call without ever leaving the label');
    assert.equal(btn.disabled, false);
    assert.notEqual(btn.textContent, stageLabel);
  });

  test('results landing ends the phase even with the crank still published', async () => {
    const { panel, btn } = await crankPanel();
    panel.__setPendingActionsForTest([mineFlipRow()]);
    assert.equal(btn.textContent, CRANK_LABEL);

    panel.setJackpotProcessingState(signals({ jackpotReady: true }));
    assert.notEqual(btn.textContent, CRANK_LABEL,
      'the day resolving is the other way the phase ends');
  });

  test('no wallet means no row at all, so the key keeps reporting the stage', async () => {
    // app-mine-flip.js clears its published row the moment getActingAddress()
    // is empty, so "wallet connected" is already a precondition of the row
    // existing. A disconnected player sees exactly today's key.
    const { panel, btn } = await crankPanel();
    const stageLabel = btn.textContent;
    panel.__setPendingActionsForTest([mineFlipRow()]);
    assert.equal(btn.textContent, CRANK_LABEL);

    panel.__setPendingActionsForTest([]);
    assert.equal(btn.textContent, stageLabel, 'disconnecting restores the pipeline label');
  });

  test('the contract-authoritative callable crank renames the key without a second RNG witness', async () => {
    // A successful mineFlip() simulation is already the chain's own definition
    // of executable work. Requiring a separate isRngFulfilled() read only for
    // the label can leave an enabled Mine FLIP key saying RNG INCOMING.
    const { panel, btn } = await crankPanel({ rngFulfilled: false });
    const stageLabel = btn.textContent;
    panel.__setPendingActionsForTest([mineFlipRow()]);
    assert.equal(btn.textContent, CRANK_LABEL);
    assert.notEqual(btn.textContent, stageLabel);
    assert.equal(btn.disabled, false, 'the action name and clickability share the same authority');
  });

  test('signals for another day cannot rename the key', async () => {
    const { panel, btn } = await crankPanel({ day: DAY + 1 });
    const stageLabel = btn.textContent;
    panel.__setPendingActionsForTest([mineFlipRow()]);
    assert.equal(btn.textContent, stageLabel);
  });

  test('results in ends the crank label for the day', async () => {
    const { panel, btn } = await crankPanel({ jackpotReady: true });
    panel.__setPendingActionsForTest([mineFlipRow()]);
    assert.notEqual(btn.textContent, CRANK_LABEL,
      'a resolved day is not still being ground out');
  });

  test('clicking the renamed key runs Mine FLIP: one click, one crank call', async () => {
    const priorFetch = globalThis.fetch;
    const priorImage = globalThis.Image;
    let calls = 0;
    let panel = null;
    try {
      resetDom();
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
      // connectedCallback decode-warms eight badge lanes in the background.
      // Keep that unrelated browser primitive inert in the headless click test.
      globalThis.Image = class FakeImage {};
      await import('../replay-panel.js');
      const Ctor = customElements.get('replay-panel');
      panel = new Ctor();
      _docBody.appendChild(panel);
      panel.connectedCallback();
      panel.__setSelectedDayForTest(DAY);
      panel.setAttribute('data-day-warming', '');
      panel.attributeChangedCallback('data-day-warming', null, '');
      panel.setJackpotProcessingState(signals());
      panel.__setPendingActionsForTest([mineFlipRow({
        run: async () => { calls += 1; },
      })]);
      const btn = panel.querySelector('[data-bind="reveal-btn"]');
      assert.equal(btn.textContent, CRANK_LABEL);
      assert.equal(btn.dataset.replayAction, 'mine-flip');
      assert.equal(calls, 0, 'renaming the key starts no transaction on its own');

      btn.dispatchEvent({ type: 'click' });
      await flushMicrotasks();
      assert.equal(calls, 1, 'the actual button click reaches the resolver runner');
    } finally {
      panel?.disconnectedCallback();
      await flushMicrotasks();
      globalThis.fetch = priorFetch;
      if (priorImage === undefined) delete globalThis.Image;
      else globalThis.Image = priorImage;
    }
  });

  test('the crank state marks itself so the LCD can swap its indicator glyph', async () => {
    const { panel, btn } = await crankPanel();
    assert.equal(btn.getAttribute('data-jp-action'), null,
      'an unarmed key claims no action of its own');

    panel.__setPendingActionsForTest([mineFlipRow()]);
    assert.equal(btn.getAttribute('data-jp-action'), 'mine-flip');
    assert.equal(btn.getAttribute('data-jp-stage'), 'rng-arrived',
      'and the pipeline stage is still reported alongside it');

    panel.__setPendingActionsForTest([]);
    assert.equal(btn.getAttribute('data-jp-action'), null,
      'losing the crank drops the mark with the label');
  });

  test('the indicator becomes a pickaxe glyph instead of the stage icon', () => {
    // The socket is otherwise keyed off data-jp-stage, and those rules paint
    // full-colour picture icons into it — the coinflip stage puts an ETH coin
    // face there, which is what a player reads next to MINE FLIP.
    const rule = DRAWING_CSS.match(
      /\.replay-reveal-btn\.is-processing\[data-jp-action="mine-flip"\]::before \{([^}]*)\}/s,
    )?.[1];
    assert.ok(rule, 'the crank state states its own indicator');
    assert.match(rule, /mask:\s*url\('\/app\/assets\/jackpot-stage-mine\.svg'\)/,
      'the pickaxe arrives as a MASK, so it takes an LED colour rather than being a coloured badge');
    assert.match(rule, /background:\s*rgb\(var\(--jp-led-b\)\)/,
      'and that colour is the LED bank\'s bright middle lamp, like the pip cluster it replaces');
    assert.match(rule, /content:\s*""/,
      'restated because the RNG stages set content:none and would delete the element');
    assert.doesNotMatch(rule, /background-image|url\('\/shared\//,
      'no stage picture icon survives into this state');

    // jackpot-processing.css loads AFTER this sheet and its stage rules are
    // (0,5,3); the extra `.replay-controls >` is what makes this (0,6,3) so it
    // wins on specificity instead of on source order.
    assert.match(
      DRAWING_CSS,
      /\.replay-controls\s*\n?\s*>\s*\.replay-reveal-btn\.is-processing\[data-jp-action="mine-flip"\]::before/,
      'the selector outranks the stage icons it has to override',
    );

    const svg = readFileSync(new URL('../../assets/jackpot-stage-mine.svg', import.meta.url), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/, 'square viewBox, so `contain` fills the socket');
    assert.equal((svg.match(/<path/g) || []).length, 2, 'two strokes: head and shaft');
    assert.doesNotMatch(svg, /fill="|opacity="/,
      'a mask reads alpha only, so the file carries no colour to be ignored');
  });

  test('the label is short enough to stay on the LCD at mobile width', () => {
    // The face is `white-space: nowrap`, so an overlong label does not wrap, it
    // overflows the key. Stay within the longest label the control already
    // carries at the same monospace size and tracking.
    assert.ok(CRANK_LABEL.length <= 'RESOLVE + RUN DECIMATOR'.length,
      `${CRANK_LABEL} (${CRANK_LABEL.length}) must not exceed the widest existing key label`);
    assert.match(REPLAY_PANEL_SRC, /const MINE_FLIP_CRANK_LABEL = 'MINE FLIP · PROCESSING'/);
  });
});
