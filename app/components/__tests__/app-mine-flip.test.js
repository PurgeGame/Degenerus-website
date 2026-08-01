// /app/components/__tests__/app-mine-flip.test.js
//
// Run: cd website && node --test app/components/__tests__/app-mine-flip.test.js
//
// Covers the MINE FLIP nav chip:
//   - formatAmount units: ETH and FLIP arrive from /pending as decimal STRINGS
//     (displayEth needs a BigInt, or the row silently renders blank), and the
//     tickets row is in ENTRIES, 4 per ticket
//   - the render state machine: dark/disabled with nothing to do, lit with an
//     auto-runnable head, and the distinct "Nothing to auto-run" state where the
//     queue is non-empty but every row is manual-only
//   - the queue depth badge, and manual rows carrying mf-row--manual so the
//     popover shows them without offering a click
//   - #runNext: NoWork is swallowed (another keeper won the race), any other
//     revert surfaces its userMessage
//   - mountIntoNav placing the chip AFTER the activity chip
//   - source gates for the things a DOM-less test cannot execute
//
// The queue is driven through a stubbed global fetch rather than module mocks:
// with no injected provider, probeMineFlip reports {known:false} and adds no
// row, so /pending alone decides the queue. Crank-row ordering is covered in
// app/app/__tests__/work-queue.test.js against an injected probe.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolvePath(__dirname, '../app-mine-flip.js'), 'utf8');

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
        if (/\bdisabled\b/.test(attrs)) child.disabled = true;
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
      for (const fn of arr) { try { fn(ev); } catch { /* swallow */ } }
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
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(base));
  }
}
globalThis.HTMLElement = FakeHTMLElement;

const _docBody = makeFakeElement('body');
const _docListeners = new Map();
const _byId = new Map();

globalThis.document = {
  createElement: (tag) => makeFakeElement(tag),
  querySelector: (sel) => _docBody.querySelector(sel),
  querySelectorAll: (sel) => _docBody.querySelectorAll(sel),
  getElementById: (id) => _byId.get(id) || null,
  body: _docBody,
  hidden: false,
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
  readyState: 'complete',
  visibilityState: 'visible',
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
// Module under test + the store it reads the acting address from.
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';
import * as contractsMod from '../../app/contracts.js';
import * as mineFlipMod from '../../app/mine-flip.js';
import * as pendingActionsMod from '../../app/pending-actions.js';

const mod = await import('../app-mine-flip.js');
const { formatAmount } = mod._testing;
const AppMineFlip = globalThis.customElements.get('app-mine-flip');

/** A /pending body with every row present, available and zero. */
function pendingWith(overrides = {}) {
  const base = {
    eth: { amount: '0', available: true },
    flip: { amount: '0', available: true },
    decimator: { amount: '0', available: true },
    terminal: { amount: '0', available: true },
    tickets: { amount: '0', available: true },
  };
  for (const [k, v] of Object.entries(overrides)) base[k] = { available: true, ...v };
  return { pending: base };
}

/**
 * Make probeMineFlip() report crank work (or not). It static-calls mineFlip()
 * through mine-flip.js's contract-factory seam, and needs a provider to get a
 * signer at all — with neither, the probe reports "unknown" and the crank never
 * enters the queue.
 */
function stubProbe({ hasWork }) {
  contractsMod.setProvider({
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => TEST_ADDR }),
  });
  mineFlipMod.__setContractFactoryForTest(() => ({
    mineFlip: Object.assign(async () => ({ hash: '0xtx', wait: async () => ({ status: 1, logs: [] }) }), {
      staticCall: async () => {
        if (hasWork) return undefined;
        const err = new Error('execution reverted');
        err.revert = { name: 'NoWork' };
        throw err;
      },
    }),
    connect(_s) { return this; },
  }));
}

/** Point global fetch at a fixed /pending body. */
function stubPending(body) {
  globalThis.fetch = async () => ({ ok: true, json: async () => body });
}

/** Build + connect a chip, then let its async first refresh land. */
async function mountChip() {
  const el = new AppMineFlip();
  el.connectedCallback();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

const bind = (el, name) => el.querySelector(`[data-bind="${name}"]`);

beforeEach(() => {
  pendingActionsMod.__resetPendingActionsForTest();
  mineFlipMod.__resetContractFactoryForTest();
  contractsMod.clearProvider();
});

// ===========================================================================
// formatAmount
// ===========================================================================

describe('formatAmount', () => {
  test('ETH rows format from the indexer STRING (the BigInt-coercion regression)', () => {
    // displayEth multiplies by ETH_DIVISOR, so a bare string throws "cannot mix
    // BigInt and other types" into the catch and the row renders blank. This is
    // the exact shape /pending returns.
    const out = formatAmount({ unit: 'eth', amount: '1000000000000000' });
    assert.notEqual(out, '', 'ETH amount must not silently render blank');
    assert.match(out, /^[\d,.]+ ETH$/);
  });

  test('FLIP rows format from a string too', () => {
    const out = formatAmount({ unit: 'flip', amount: '150000000000000000000' });
    assert.equal(out, '150.0000 FLIP');
  });

  test('tickets convert entries → tickets and show both', () => {
    // 4 entries = 1 ticket (`<<2` on-chain). 109 entries = 27 tickets.
    assert.equal(formatAmount({ unit: 'entries', amount: '109' }), '27 tickets (109 entries)');
    assert.equal(formatAmount({ unit: 'entries', amount: '4' }), '1 ticket (4 entries)');
  });

  test('a null amount renders no chip (the crank bounty is priced on-chain)', () => {
    assert.equal(formatAmount({ unit: 'bounty', amount: null }), '');
    assert.equal(formatAmount(null), '');
  });

  test('a malformed amount degrades to blank rather than throwing', () => {
    assert.equal(formatAmount({ unit: 'eth', amount: 'not-a-number' }), '');
  });
});

// ===========================================================================
// Render state machine
// ===========================================================================

describe('chip render states', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', TEST_ADDR);
    stubPending(pendingWith());
  });

  test('nothing outstanding → dark, disabled, no count badge', async () => {
    const el = await mountChip();
    const cta = bind(el, 'mf-cta');
    assert.equal(cta.disabled, true);
    assert.equal(cta.classList.contains('is-live'), false);
    assert.equal(bind(el, 'mf-sub').textContent, 'Nothing to do');
    assert.equal(bind(el, 'mf-count').hidden, true);
    el.disconnectedCallback();
  });

  test('no acting address → empty queue, not an error state', async () => {
    // 'view' mode is read-only: getActingAddress() is null, so there is nothing
    // to act on and the chip must stay dark rather than render a failure.
    storeMod.update('viewing.address', TEST_ADDR);
    storeMod.update('ui.mode', 'view');
    const el = await mountChip();
    assert.equal(bind(el, 'mf-cta').disabled, true);
    assert.equal(bind(el, 'mf-sub').textContent, 'Nothing to do');
    assert.equal(bind(el, 'mf-error').hidden, true);
    el.disconnectedCallback();
  });

  test('an auto-runnable head lights the chip and names the next action', async () => {
    stubProbe({ hasWork: true });
    const el = await mountChip();
    const cta = bind(el, 'mf-cta');
    assert.equal(cta.disabled, false);
    assert.equal(cta.classList.contains('is-live'), true);
    const sub = bind(el, 'mf-sub').textContent;
    assert.match(sub, /^Next: Mine FLIP$/);
    assert.equal(bind(el, 'mf-label').textContent, 'MINE FLIP');
    el.disconnectedCallback();
  });

  test('with crank work the chip reads MINE FLIP again, and idle keeps the name', async () => {
    stubProbe({ hasWork: true, known: true });
    stubProbe({ hasWork: true });
    const withWork = await mountChip();
    assert.equal(bind(withWork, 'mf-label').textContent, 'MINE FLIP');
    assert.match(bind(withWork, 'mf-sub').textContent, /^Next: Mine FLIP/);
    withWork.disconnectedCallback();

    stubProbe({ hasWork: false, known: true });
    stubPending(pendingWith({}));
    const idle = await mountChip();
    assert.equal(bind(idle, 'mf-label').textContent, 'MINE FLIP', 'idle keeps the widget name');
    assert.equal(bind(idle, 'mf-cta').disabled, true);
    idle.disconnectedCallback();
    mineFlipMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('the badge carries queue DEPTH, not the head amount', async () => {
    stubProbe({ hasWork: true });
    pendingActionsMod.publishPendingActions('db-batch', [
      { id: 'batch:1', kind: 'batch-resolution', batchResolution: true, label: 'Batch one', state: 'waiting' },
      { id: 'batch:2', kind: 'batch-resolution', batchResolution: true, label: 'Batch two', state: 'waiting' },
    ]);
    const el = await mountChip();
    assert.equal(bind(el, 'mf-count').textContent, '3');
    assert.equal(bind(el, 'mf-count').hidden, false);
    el.disconnectedCallback();
  });

  test('waiting-only queue stays focusable so its pending detail is reachable', async () => {
    pendingActionsMod.publishPendingActions('db-batch', [{
      id: 'batch:wait',
      kind: 'batch-resolution',
      batchResolution: true,
      label: 'Batch resolver',
      detail: 'Waiting for DB work',
      state: 'waiting',
    }]);
    const el = await mountChip();
    assert.equal(bind(el, 'mf-sub').textContent, '1 waiting · none ready yet');
    assert.equal(bind(el, 'mf-cta').disabled, false);
    assert.equal(bind(el, 'mf-cta').classList.contains('has-pending'), true);
    assert.equal(bind(el, 'mf-label').textContent, 'PENDING');
    assert.equal(bind(el, 'mf-count').textContent, '1');
    el.disconnectedCallback();
  });

  test('presentation work such as lootboxes is left to the bottom tray', async () => {
    pendingActionsMod.publishPendingActions('lootboxes', [{
      id: 'lootbox:1', kind: 'lootbox', label: 'Lootbox #1', state: 'ready', run: async () => {},
    }]);
    const el = await mountChip();
    assert.equal(bind(el, 'mf-sub').textContent, 'Nothing to do');
    assert.equal(el.__pendingForTest().length, 0);
    el.disconnectedCallback();
  });

  test('a dead indexer degrades to the empty queue instead of throwing', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const el = await mountChip();
    assert.equal(bind(el, 'mf-sub').textContent, 'Nothing to do');
    assert.equal(bind(el, 'mf-error').hidden, true);
    el.disconnectedCallback();
  });
});

// ===========================================================================
// The manifest list
// ===========================================================================

describe('popover manifest', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', TEST_ADDR);
  });

  test('manifest contains Mine Flip plus explicitly tagged DB batch work', async () => {
    stubProbe({ hasWork: true });
    pendingActionsMod.publishPendingActions('db-batch', [{
      id: 'batch:wait',
      kind: 'batch-resolution',
      batchResolution: true,
      label: 'Resolve DB batch',
      detail: '4 records waiting',
      state: 'waiting',
    }]);
    const el = await mountChip();
    const rows = bind(el, 'mf-list').children;
    assert.equal(rows.length, 2);

    // Head row: auto-runnable, flagged as next.
    assert.equal(rows[0].className.includes('mf-row--manual'), false);
    assert.equal(rows[0].className.includes('mf-row--next'), true);
    assert.equal(rows[0].querySelector('.mf-row__label').textContent, 'Mine FLIP');

    assert.equal(rows[1].className.includes('mf-row--waiting'), true);
    assert.equal(rows[1].querySelector('.mf-row__amount').textContent, '4 records waiting');
    el.disconnectedCallback();
  });

  test('re-render replaces rows rather than appending them', async () => {
    pendingActionsMod.publishPendingActions('db-batch', [{
      id: 'batch:one', kind: 'batch-resolution', batchResolution: true,
      label: 'Batch', state: 'waiting',
    }]);
    const el = await mountChip();
    assert.equal(bind(el, 'mf-list').children.length, 1);
    pendingActionsMod.publishPendingActions('db-batch', [{
      id: 'batch:one', kind: 'batch-resolution', batchResolution: true,
      label: 'Batch refreshed', state: 'waiting',
    }]);
    assert.equal(bind(el, 'mf-list').children.length, 1);
    el.disconnectedCallback();
  });

  test('a published DB batch lights the chip and its row runs the owning flow', async () => {
    let ran = 0;
    pendingActionsMod.publishPendingActions('test-results', [{
      id: 'batch:8',
      kind: 'batch-resolution',
      batchResolution: true,
      label: 'Resolution batch #8',
      shortLabel: 'Run batch',
      detail: '8 records ready',
      state: 'ready',
      run: async () => { ran += 1; },
    }]);

    const el = await mountChip();
    assert.equal(bind(el, 'mf-label').textContent, 'RUN BATCH');
    assert.equal(bind(el, 'mf-cta').classList.contains('is-live'), true);
    assert.match(bind(el, 'mf-sub').textContent, /^Ready: Resolution batch #8/);

    const row = bind(el, 'mf-list').children[0];
    assert.ok(row.className.includes('mf-row--ready'));
    assert.equal(row.querySelector('.mf-row__state').textContent, 'READY');
    row.querySelector('.mf-row__body').dispatchEvent({
      type: 'click',
      stopPropagation() {},
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ran, 1, 'the row delegates to the gameplay component callback');
    el.disconnectedCallback();
  });
});

// ===========================================================================
// Click behaviour
// ===========================================================================

describe('running the head of the queue', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('ui.mode', 'self');
    storeMod.update('connected.address', TEST_ADDR);
    stubPending(pendingWith({ eth: { amount: '1000000000000000' } }));
    stubProbe({ hasWork: true });
  });

  test('a NoWork revert is swallowed — another keeper won the race', async () => {
    const el = await mountChip();
    const err = new Error('Nothing to mine right now.');
    err.code = 'NoWork';
    el.__queueForTest()[0].run = async () => { throw err; };
    bind(el, 'mf-cta').dispatchEvent({ type: 'click' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(bind(el, 'mf-error').hidden, true, 'NoWork must not surface as a failure');
    el.disconnectedCallback();
  });

  test('any other revert surfaces its userMessage', async () => {
    const el = await mountChip();
    const err = new Error('raw');
    err.userMessage = 'Not enough FLIP for that.';
    el.__queueForTest()[0].run = async () => { throw err; };
    bind(el, 'mf-cta').dispatchEvent({ type: 'click' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const errEl = bind(el, 'mf-error');
    assert.equal(errEl.hidden, false);
    assert.equal(errEl.textContent, 'Not enough FLIP for that.');
    el.disconnectedCallback();
  });

  test('a successful run clears any prior error and refreshes the queue', async () => {
    const el = await mountChip();
    let ran = 0;
    el.__queueForTest()[0].run = async () => { ran += 1; };
    stubProbe({ hasWork: false });   // refresh sees another keeper cleared it
    bind(el, 'mf-cta').dispatchEvent({ type: 'click' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ran, 1);
    assert.equal(bind(el, 'mf-sub').textContent, 'Nothing to do');
    assert.equal(bind(el, 'mf-error').hidden, true);
    el.disconnectedCallback();
  });
});

// ===========================================================================
// Nav mounting
// ===========================================================================

describe('mountIntoNav', () => {
  test('lands after the activity chip so the bar reads day → level → score → action', () => {
    const host = makeFakeElement('div');
    host.classList.add('nav-right');
    const activity = makeFakeElement('app-activity-chip');
    host.appendChild(activity);
    _docBody.children = [];
    _docBody.appendChild(host);

    mod._testing.mountIntoNav();

    const idxActivity = host.children.findIndex((c) => c.tagName === 'APP-ACTIVITY-CHIP');
    const idxChip = host.children.findIndex((c) => c.tagName === 'APP-MINE-FLIP');
    assert.ok(idxChip > idxActivity, `chip at ${idxChip} must follow activity chip at ${idxActivity}`);
    _docBody.children = [];
  });

  test('is idempotent — a retry tick never mounts a second chip', () => {
    const host = makeFakeElement('div');
    host.classList.add('nav-right');
    _docBody.children = [];
    _docBody.appendChild(host);

    mod._testing.mountIntoNav();
    mod._testing.mountIntoNav();
    mod._testing.mountIntoNav();

    assert.equal(host.children.filter((c) => c.tagName === 'APP-MINE-FLIP').length, 1);
    _docBody.children = [];
  });

  test('no nav host → no-op, no throw', () => {
    _docBody.children = [];
    assert.doesNotThrow(() => mod._testing.mountIntoNav());
  });
});

// ===========================================================================
// Source gates — behaviours a DOM-less test cannot execute
// ===========================================================================

describe('source gates', () => {
  test('server-derived strings go through textContent, never innerHTML', () => {
    // innerHTML is used exactly once, for the static shell.
    const assignments = src.match(/\.innerHTML\s*=/g) || [];
    assert.equal(assignments.length, 1, `innerHTML assigned ${assignments.length}× — shell only`);
    assert.match(src, /#renderShell\(\)\s*\{\s*this\.innerHTML/);
  });

  test('the manifest is built with createElement, not string concatenation', () => {
    assert.match(src, /document\.createElement\('li'\)/);
    assert.match(src, /name\.textContent = item\.label/);
  });

  test('the poll timer is unref-ed so node:test never hangs on it', () => {
    assert.match(src, /_setIntervalUnref/);
    assert.match(src, /typeof h\.unref === 'function'/);
  });

  test('refresh is sequence-guarded against out-of-order responses', () => {
    assert.match(src, /#loadSeq/);
    assert.match(src, /if \(seq !== this\.#loadSeq\) return/);
  });

  test('disconnect tears down every subscription, timer and listener', () => {
    // Bounded by the NEXT method definition, not by the first mention of
    // #renderShell — connectedCallback calls it, so that lands earlier.
    const teardown = src.slice(src.indexOf('disconnectedCallback'), src.indexOf('#renderShell() {'));
    assert.match(teardown, /clearInterval\(this\.#pollHandle\)/);
    assert.match(teardown, /clearTimeout\(this\.#errorTimer\)/);
    assert.match(teardown, /removeEventListener\('visibilitychange'/);
  });

  test('the acting address is read from the store, never from connected.address directly', () => {
    // Operator mode acts on viewing.address; reading connected.address here
    // would send the crank at the wrong player.
    assert.match(src, /getActingAddress/);
    assert.ok(!/get\('connected\.address'\)/.test(src), 'must not read connected.address directly');
  });

  test('ETH amounts are BigInt-coerced before display', () => {
    // The regression this file's first case pins: displayEth(string) throws into
    // the catch and the amount vanishes.
    assert.match(src, /displayEth\(BigInt\(item\.amount\)/);
  });
});
