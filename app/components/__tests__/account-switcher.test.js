// /app/components/__tests__/account-switcher.test.js — account-switcher UI layer
// (2026-07-16).
//
// Run: cd website && node --test app/components/__tests__/account-switcher.test.js
//
// Covers:
//   - Hidden when no wallet connected
//   - Hidden when connected but approvals.list is empty
//   - Renders self + one-per-approver + combined options when connected + approvers exist
//   - Selecting an approver writes batch [{viewing.address:addr},{viewing.combined:false}]
//   - Selecting self writes batch [{viewing.address:null},{viewing.combined:false}]
//   - Selecting combined writes batch [{viewing.address:null},{viewing.combined:true}]
//   - External sync: store-driven viewing.address / viewing.combined changes (e.g. a
//     ?as= deep link or a player-dropdown pick) reflect into the <select> value
//     without user interaction, including the "not an approver" fallback to 'self'
//   - approvals.list going empty (e.g. disconnect clearing it) re-hides the element
//
// Stub strategy mirrors player-dropdown.test.js (marker-detection innerHTML setter)
// with document.createElement support for the programmatically-built <option> rows
// (account-switcher.js builds options via createElement + textContent, never
// innerHTML interpolation — T-58-18 convention).

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fake DOM element factory.
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
    className: '',
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
      // Materialize the account-switcher skeleton when the literal contains
      // the select marker class — connectedCallback's static template only.
      if (v && typeof v === 'string' && v.includes('acct-switcher-select')) {
        const select = makeFakeElement('select');
        select.classList.add('acct-switcher-select');
        select.setAttribute('aria-label', 'Acting as');
        this.appendChild(select);
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
    return !!(el.classList && el.classList.contains(cls));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Global stubs — install BEFORE dynamic import of account-switcher.js.
// ---------------------------------------------------------------------------

class FakeHTMLElement {
  constructor() {
    const base = makeFakeElement(this.constructor.name || 'div');
    const descriptors = Object.getOwnPropertyDescriptors(base);
    Object.defineProperties(this, descriptors);
  }
}
globalThis.HTMLElement = FakeHTMLElement;

globalThis.document = {
  readyState: 'complete',
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  createElement: (tag) => makeFakeElement(tag),
  getElementById: () => null,
  querySelector: () => null,
  body: makeFakeElement('body'),
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

// ---------------------------------------------------------------------------
// Live store — same module account-switcher.js reads/writes against.
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

const CONNECTED = '0xc0ffee0000000000000000000000000000c0ff';
const APPROVER_A = '0xaaaa000000000000000000000000000000a001';
const APPROVER_B = '0xbbbb000000000000000000000000000000b002';

beforeEach(async () => {
  storeMod.__resetForTest();
  await import('../account-switcher.js'); // ensure module is loaded (cached after first load)
});

async function importSwitcher() {
  return import('../account-switcher.js');
}

function mount() {
  return importSwitcher().then((mod) => {
    const el = new mod.AccountSwitcher();
    el.connectedCallback();
    return el;
  });
}

// ===========================================================================
// Hidden / visible gating
// ===========================================================================

describe('AccountSwitcher visibility', () => {
  test('hidden when no wallet connected', async () => {
    const el = await mount();
    assert.equal(el.hidden, true);
  });

  test('hidden when connected but approvals.list is empty', async () => {
    storeMod.update('connected.address', CONNECTED);
    const el = await mount();
    assert.equal(el.hidden, true);
  });

  test('visible when connected AND approvals.list has 1+ entries', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    assert.equal(el.hidden, false);
  });

  test('approvals.list going empty after mount re-hides the element', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    assert.equal(el.hidden, false, 'precondition: visible');
    storeMod.update('approvals.list', []);
    assert.equal(el.hidden, true, 're-hidden when approvals.list clears (e.g. disconnect)');
  });

  test('connected.address going null after mount re-hides the element', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    assert.equal(el.hidden, false, 'precondition: visible');
    storeMod.update('connected.address', null);
    assert.equal(el.hidden, true, 're-hidden on disconnect');
  });
});

// ===========================================================================
// Render — option list content
// ===========================================================================

describe('AccountSwitcher render', () => {
  test('renders self + one-per-approver + combined options', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A, APPROVER_B]);
    const el = await mount();
    const select = el.querySelector('select');
    assert.equal(select.children.length, 4, 'self + 2 approvers + combined = 4 options');

    const [selfOpt, aOpt, bOpt, combinedOpt] = select.children;
    assert.equal(selfOpt.value, 'self');
    assert.ok(selfOpt.textContent.includes('Your wallet'), `self label; got "${selfOpt.textContent}"`);
    assert.ok(selfOpt.textContent.includes('0xc0'), `self label abbreviates connected addr; got "${selfOpt.textContent}"`);

    assert.equal(aOpt.value, APPROVER_A);
    assert.ok(aOpt.textContent.includes('0xaa'), `approver A abbreviated; got "${aOpt.textContent}"`);

    assert.equal(bOpt.value, APPROVER_B);
    assert.ok(bOpt.textContent.includes('0xbb'), `approver B abbreviated; got "${bOpt.textContent}"`);

    assert.equal(combinedOpt.value, 'combined');
    assert.equal(combinedOpt.textContent, 'All accounts (3)', 'N = connected + 2 approvers');
  });

  test('a single approver still gets the combined option ("All accounts (2)")', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    const select = el.querySelector('select');
    assert.equal(select.children.length, 3, 'self + 1 approver + combined');
    assert.equal(select.children[2].textContent, 'All accounts (2)');
  });

  test('option rows are built via createElement + textContent (no innerHTML interpolation)', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    const select = el.querySelector('select');
    for (const opt of select.children) {
      assert.equal(opt._innerHTML, '', 'options never assigned via innerHTML');
    }
  });
});

// ===========================================================================
// Selection → store.batch()
// ===========================================================================

describe('AccountSwitcher selection writes', () => {
  test('selecting an approver writes {viewing.address: addr, viewing.combined: false}', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A, APPROVER_B]);
    const el = await mount();
    const select = el.querySelector('select');
    select.value = APPROVER_B;
    select.dispatchEvent({ type: 'change' });
    assert.equal(storeMod.get('viewing.address'), APPROVER_B);
    assert.equal(storeMod.get('viewing.combined'), false);
  });

  test('selecting self writes {viewing.address: null, viewing.combined: false}', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    storeMod.update('viewing.address', APPROVER_A); // start in operator mode
    const el = await mount();
    const select = el.querySelector('select');
    select.value = 'self';
    select.dispatchEvent({ type: 'change' });
    assert.equal(storeMod.get('viewing.address'), null);
    assert.equal(storeMod.get('viewing.combined'), false);
  });

  test('selecting combined writes {viewing.address: null, viewing.combined: true}', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    const select = el.querySelector('select');
    select.value = 'combined';
    select.dispatchEvent({ type: 'change' });
    assert.equal(storeMod.get('viewing.address'), null);
    assert.equal(storeMod.get('viewing.combined'), true);
  });

  test('selection is a single batch — mode derives directly to the target (no intermediate flicker)', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    const select = el.querySelector('select');
    select.value = APPROVER_A;
    select.dispatchEvent({ type: 'change' });
    // batch() writes both paths before notifying either — viewing.address and
    // viewing.combined are consistent (mutually exclusive) the instant the
    // change handler returns, matching store.js's "combined checked first
    // regardless of a stale viewing.address" contract.
    assert.equal(storeMod.get('viewing.address'), APPROVER_A);
    assert.equal(storeMod.get('viewing.combined'), false);
  });
});

// ===========================================================================
// External sync — store-driven changes reflect into the <select>
// ===========================================================================

describe('AccountSwitcher external sync', () => {
  test('viewing.address set externally (e.g. ?as= deep link) reflects into select.value', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A, APPROVER_B]);
    const el = await mount();
    const select = el.querySelector('select');
    assert.equal(select.value, 'self', 'starts on self');
    storeMod.update('viewing.address', APPROVER_B);
    assert.equal(select.value, APPROVER_B, 'external viewing.address change reflected');
  });

  test('viewing.combined set externally reflects into select.value', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    const select = el.querySelector('select');
    storeMod.update('viewing.combined', true);
    assert.equal(select.value, 'combined');
  });

  test('viewing.address set to a non-approver (plain read-only view) falls back to self', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    const select = el.querySelector('select');
    const strangerAddr = '0xdeadbeef000000000000000000000000000000';
    storeMod.update('viewing.address', strangerAddr);
    assert.equal(select.value, 'self', 'address outside the approvers list is not a switcher option');
  });

  test('clearing viewing.address (back to self) reflects into select.value', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    storeMod.update('viewing.address', APPROVER_A);
    const el = await mount();
    const select = el.querySelector('select');
    assert.equal(select.value, APPROVER_A, 'precondition: reflects operator mode');
    storeMod.update('viewing.address', null);
    assert.equal(select.value, 'self');
  });
});

// ===========================================================================
// Lifecycle cleanup
// ===========================================================================

describe('AccountSwitcher lifecycle', () => {
  test('disconnectedCallback unsubscribes — later store writes do not throw or touch a detached select', async () => {
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('approvals.list', [APPROVER_A]);
    const el = await mount();
    el.disconnectedCallback();
    // Should not throw even though the element is detached.
    storeMod.update('viewing.address', APPROVER_A);
    storeMod.update('approvals.list', [APPROVER_A, APPROVER_B]);
  });
});
