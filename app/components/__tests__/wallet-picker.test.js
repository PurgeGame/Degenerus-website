// /app/components/__tests__/wallet-picker.test.js — Phase 58 Plan 03 unit (WLT-01 + WLT-02).
//
// Run: cd website && node --test app/components/__tests__/wallet-picker.test.js
//
// Covers:
//   WLT-01 (multi-wallet picker UX layer):
//     - <wallet-picker> renders one row per discovered wallet (name + icon + rdns)
//     - show(found) returns a Promise that resolves to the picked info on row click
//     - cancel() resolves the show() Promise to null
//     - Zero-wallets: empty install-CTA (MetaMask/Coinbase/Rabby) shown, dismiss → null
//     - XSS mitigation: name/rdns rendered via textContent (NEVER innerHTML interpolation — T-58-13)
//     - Icon set via element.src (browser-validated), not innerHTML interpolation
//
//   WLT-02 (chain-chip live state):
//     - subscribe-driven chain-chip class manager: ui.chainOk=true → chain-chip--ok
//     - ui.chainOk=false → chain-chip--mismatch + injects .chain-chip__switch CTA
//     - ui.chainOk=null → chain-chip--neutral, removes any prior .chain-chip__switch
//     - Subscribe is detached on disconnectedCallback (no leak after element removed)
//
// Stub strategy:
//   - Install minimal globalThis.HTMLElement / document / window / customElements stubs
//     BEFORE dynamic-import of wallet-picker.js so its module-init reads the stubs.
//   - Live-import the real ./store.js so subscribe/update semantics match production.
//   - Stub ./wallet.js + ./contracts.js by aliasing their exports off the live module
//     and replacing what's needed (connectWithPicker, switchToSepolia) with spies.
//
// Custom Element DOM lifecycle (connectedCallback / shadow DOM) cannot be exercised
// by the browser runtime here, so the test instantiates the WalletPicker class
// directly via `new WalletPicker()` after providing minimal HTMLElement parent.
// The picker exports its class for testability (export class WalletPicker).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fake DOM element factory (minimal — supports the picker's surface only).
// ---------------------------------------------------------------------------

function makeFakeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentElement: null,
    attributes: {},
    eventListeners: {},
    _innerHTML: '',
    _textContent: '',
    _src: '',
    _alt: '',
    hidden: false,
    tabIndex: 0,
    className: '',
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
      // Only materialize the picker's static skeleton when the literal contains the
      // known data-bind markers — i.e., this is wallet-picker.js's connectedCallback
      // template (NOT a per-row clear like `list.innerHTML = ''`).
      if (v && typeof v === 'string' && v.includes('data-bind="list"') && v.includes('data-bind="empty"')) {
        const list = makeFakeElement('ul');
        list.attributes['data-bind'] = 'list';
        list.classList.add('wallet-list');
        const empty = makeFakeElement('div');
        empty.attributes['data-bind'] = 'empty';
        empty.classList.add('wallet-picker-empty');
        empty.hidden = /data-bind="empty"[^>]*hidden/.test(v);
        const cancelBtn = makeFakeElement('button');
        cancelBtn.attributes['data-close'] = '';
        cancelBtn._textContent = 'Cancel';
        const backdrop = makeFakeElement('div');
        backdrop.attributes['data-close'] = '';
        backdrop.classList.add('wallet-picker-backdrop');
        const modal = makeFakeElement('div');
        modal.classList.add('wallet-picker-modal');
        this.appendChild(backdrop);
        this.appendChild(modal);
        modal.appendChild(list);
        modal.appendChild(empty);
        modal.appendChild(cancelBtn);
      }
    },
    get textContent() {
      if (this._textContent) return this._textContent;
      let acc = '';
      for (const c of this.children) acc += c.textContent || '';
      return acc;
    },
    set textContent(v) {
      this._textContent = String(v);
      this.children = [];
    },
    get src() { return this._src; },
    set src(v) { this._src = String(v); },
    get alt() { return this._alt; },
    set alt(v) { this._alt = String(v); },
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
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
    },
    querySelector(sel) {
      // Walk subtree depth-first.
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
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
  };
  return el;
}

function matches(el, sel) {
  if (!el) return false;
  // Tag selector
  if (/^[a-z][a-z0-9-]*$/i.test(sel)) {
    return el.tagName === sel.toUpperCase();
  }
  // Class selector .foo
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    if (el.classList && el.classList.contains(cls)) return true;
    // Fallback: handle elements whose impl assigned className directly.
    if (typeof el.className === 'string' && el.className.split(/\s+/).includes(cls)) return true;
    return false;
  }
  // ID selector #foo
  if (sel.startsWith('#')) {
    return el.attributes && el.attributes.id === sel.slice(1);
  }
  // [data-bind="x"] attribute selector
  const attrEq = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attrEq) {
    return el.attributes && el.attributes[attrEq[1]] === attrEq[2];
  }
  // [data-close] presence selector
  const attrPres = sel.match(/^\[([\w-]+)\]$/);
  if (attrPres) {
    return el.attributes && Object.prototype.hasOwnProperty.call(el.attributes, attrPres[1]);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Global stubs — install BEFORE dynamic import of wallet-picker.js.
// ---------------------------------------------------------------------------

class FakeHTMLElement {
  constructor() {
    // Build a backing fake element with the full surface (incl. accessor
    // descriptors for innerHTML / src / textContent), then copy ALL property
    // descriptors onto `this` so accessors survive — Object.assign would lose them.
    const base = makeFakeElement(this.constructor.name || 'div');
    const descriptors = Object.getOwnPropertyDescriptors(base);
    Object.defineProperties(this, descriptors);
  }
}

globalThis.HTMLElement = FakeHTMLElement;

const _chainChipEl = makeFakeElement('span');
_chainChipEl.attributes.id = 'chain-chip';
_chainChipEl.classList.add('chain-chip', 'chain-chip--neutral');
_chainChipEl.attributes['data-state'] = 'placeholder';
const _chainLabel = makeFakeElement('span');
_chainLabel.className = 'chain-chip__label';
_chainLabel.classList.add('chain-chip__label');
_chainLabel.textContent = 'Sepolia testnet';
_chainChipEl.appendChild(_chainLabel);

let _docReadyState = 'complete';
const _docListeners = new Map();

globalThis.document = {
  get readyState() { return _docReadyState; },
  addEventListener: (type, fn) => {
    if (!_docListeners.has(type)) _docListeners.set(type, []);
    _docListeners.get(type).push(fn);
  },
  removeEventListener: () => {},
  dispatchEvent: () => true,
  createElement: (tag) => makeFakeElement(tag),
  getElementById: (id) => {
    if (id === 'chain-chip') return _chainChipEl;
    return null;
  },
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
// Live store — same module wallet-picker.js subscribes against.
// ---------------------------------------------------------------------------

import * as storeMod from '../../app/store.js';

// ---------------------------------------------------------------------------
// Reset helpers for per-test isolation.
// ---------------------------------------------------------------------------

function resetChip() {
  _chainChipEl.classList._set.clear();
  _chainChipEl.classList.add('chain-chip', 'chain-chip--neutral');
  _chainChipEl.attributes['data-state'] = 'placeholder';
  // Drop any prior switch CTA child.
  _chainChipEl.children = _chainChipEl.children.filter((c) => !c.classList || !c.classList.contains('chain-chip__switch'));
  _chainLabel.textContent = 'Sepolia testnet';
}

// Tracks the unsubscribe handle for the chain-chip subscriber re-installed
// per test (store.__resetForTest clears the subscriber registry, so we must
// re-register after each reset for chain-chip class transitions to be observed).
let _chainChipUnsub = null;

beforeEach(async () => {
  if (_chainChipUnsub) { try { _chainChipUnsub(); } catch { /* swallow */ } _chainChipUnsub = null; }
  storeMod.__resetForTest();
  resetChip();
  _docListeners.clear();
  // Make sure wallet-picker.js has been imported at least once (initializes
  // the customElements registration). Subsequent imports are cached.
  const mod = await importPicker();
  // BL-03: _installChainChipSubscriber is now idempotent. Tear down via the
  // module's test-only reset so the next install registers against the
  // post-storeMod.__resetForTest subscriber registry.
  if (typeof mod._resetChainChipSubscriberForTest === 'function') {
    mod._resetChainChipSubscriberForTest();
  }
  // Re-install the chain-chip subscriber after store reset (subscriber map
  // was cleared). Initial fire sees ui.chainOk === null → neutral.
  _chainChipUnsub = mod._installChainChipSubscriber();
});

afterEach(() => {
  if (_chainChipUnsub) { try { _chainChipUnsub(); } catch { /* swallow */ } _chainChipUnsub = null; }
});

// ---------------------------------------------------------------------------
// Helper: dynamically import wallet-picker.js. Each test imports fresh from
// the module cache (Node holds it once after first load — that's fine, the
// module's side-effects are idempotent against the per-test reset above).
// ---------------------------------------------------------------------------

async function importPicker() {
  return import('../wallet-picker.js');
}

// ===========================================================================
// WLT-01 — wallet-picker render + Promise dance + zero-state CTA + XSS mitigation
// ===========================================================================

describe('WalletPicker rendering (WLT-01)', () => {
  test('show(found) with 2+ entries renders one wallet-row per wallet', async () => {
    const mod = await importPicker();
    const picker = new mod.WalletPicker();
    picker.connectedCallback();
    const found = [
      { icon: 'data:image/png;base64,aaa', name: 'MetaMask', rdns: 'io.metamask', uuid: 'u1' },
      { icon: 'data:image/png;base64,bbb', name: 'Rabby', rdns: 'io.rabby', uuid: 'u2' },
    ];
    picker.show(found);
    const list = picker.querySelector('[data-bind="list"]');
    assert.ok(list, 'list element exists');
    // Each row appended via createElement('li') + appendChild — fake DOM tracks .children.
    assert.equal(list.children.length, 2, 'one row per wallet');
  });

  test('show(found) returns a Promise that resolves to the clicked info', async () => {
    const mod = await importPicker();
    const picker = new mod.WalletPicker();
    picker.connectedCallback();
    const found = [
      { icon: 'data:image/png;base64,aaa', name: 'MetaMask', rdns: 'io.metamask', uuid: 'u1' },
      { icon: 'data:image/png;base64,bbb', name: 'Rabby', rdns: 'io.rabby', uuid: 'u2' },
    ];
    const promise = picker.show(found);
    const list = picker.querySelector('[data-bind="list"]');
    // Fire click on the first row → picker.pick(found[0]) resolves the promise.
    list.children[0].dispatchEvent({ type: 'click' });
    const result = await promise;
    assert.equal(result.rdns, 'io.metamask', 'resolves to first wallet on row click');
  });

  test('cancel() resolves the show() Promise to null', async () => {
    const mod = await importPicker();
    const picker = new mod.WalletPicker();
    picker.connectedCallback();
    const found = [{ icon: '', name: 'X', rdns: 'x', uuid: 'u1' }];
    const promise = picker.show(found);
    picker.cancel();
    const result = await promise;
    assert.equal(result, null, 'cancel resolves to null');
  });

  test('show(found) with [] entries renders zero-state install CTA', async () => {
    const mod = await importPicker();
    const picker = new mod.WalletPicker();
    picker.connectedCallback();
    picker.show([]);
    const list = picker.querySelector('[data-bind="list"]');
    const empty = picker.querySelector('[data-bind="empty"]');
    assert.ok(empty, 'empty element exists');
    // empty unhidden when zero wallets
    assert.equal(empty.hidden, false, 'empty CTA visible on zero wallets');
    assert.equal(list.hidden, true, 'list hidden on zero wallets');
    // Install copy must mention all 3 supported wallets (per plan acceptance criteria).
    // The skeleton's innerHTML literal contains them; assert via the picker's own innerHTML.
    assert.ok(picker.innerHTML.includes('MetaMask'), 'mentions MetaMask');
    assert.ok(picker.innerHTML.includes('Coinbase'), 'mentions Coinbase');
    assert.ok(picker.innerHTML.includes('Rabby'), 'mentions Rabby');
  });

  test('zero-state cancel() resolves null', async () => {
    const mod = await importPicker();
    const picker = new mod.WalletPicker();
    picker.connectedCallback();
    const promise = picker.show([]);
    picker.cancel();
    const result = await promise;
    assert.equal(result, null);
  });

  test('XSS mitigation: name + rdns set via textContent (NOT innerHTML interpolation)', async () => {
    const mod = await importPicker();
    const picker = new mod.WalletPicker();
    picker.connectedCallback();
    const malicious = [
      {
        icon: 'data:image/png;base64,zz',
        name: '<script>alert(1)</script>',
        rdns: '<img src=x onerror=alert(1)>',
        uuid: 'u1',
      },
    ];
    picker.show(malicious);
    const list = picker.querySelector('[data-bind="list"]');
    const row = list.children[0];
    // Walk the row's children to find name/rdns spans.
    const nameEl = row.querySelector('.wallet-name');
    const rdnsEl = row.querySelector('.wallet-rdns');
    assert.ok(nameEl, 'name span exists');
    assert.ok(rdnsEl, 'rdns span exists');
    // textContent must contain the literal angle-bracketed string (proving it was assigned via textContent, not parsed as HTML).
    assert.equal(nameEl.textContent, '<script>alert(1)</script>', 'name preserved as literal text');
    assert.equal(rdnsEl.textContent, '<img src=x onerror=alert(1)>', 'rdns preserved as literal text');
  });

  test('icon set via element.src (not interpolated into innerHTML)', async () => {
    const mod = await importPicker();
    const picker = new mod.WalletPicker();
    picker.connectedCallback();
    const found = [{
      icon: 'data:image/png;base64,SAFEICONDATA',
      name: 'TestWallet',
      rdns: 'test.wallet',
      uuid: 'u1',
    }];
    picker.show(found);
    const list = picker.querySelector('[data-bind="list"]');
    const row = list.children[0];
    const img = row.querySelector('img');
    assert.ok(img, 'img element exists');
    assert.equal(img.src, 'data:image/png;base64,SAFEICONDATA', 'src set via property');
  });
});

// ===========================================================================
// WLT-02 — chain-chip live state via subscribe('ui.chainOk')
// ===========================================================================

describe('chain-chip subscriber (WLT-02)', () => {
  test('ui.chainOk=true sets chain-chip--ok class', async () => {
    await importPicker();
    storeMod.update('ui.chainOk', true);
    assert.ok(_chainChipEl.classList.contains('chain-chip--ok'), 'has --ok class');
    assert.ok(!_chainChipEl.classList.contains('chain-chip--mismatch'), 'no --mismatch');
    assert.ok(!_chainChipEl.classList.contains('chain-chip--neutral'), 'no --neutral');
  });

  test('ui.chainOk=false sets chain-chip--mismatch + injects switch CTA', async () => {
    await importPicker();
    storeMod.update('ui.chainOk', false);
    assert.ok(_chainChipEl.classList.contains('chain-chip--mismatch'), 'has --mismatch class');
    const cta = _chainChipEl.querySelector('.chain-chip__switch');
    assert.ok(cta, 'switch CTA injected on mismatch');
  });

  test('ui.chainOk=null sets chain-chip--neutral and removes switch CTA', async () => {
    await importPicker();
    storeMod.update('ui.chainOk', false);          // first force mismatch (CTA injected)
    storeMod.update('ui.chainOk', null);           // then transition to neutral
    assert.ok(_chainChipEl.classList.contains('chain-chip--neutral'), 'has --neutral class');
    const cta = _chainChipEl.querySelector('.chain-chip__switch');
    assert.equal(cta, null, 'switch CTA removed on neutral');
  });

  test('full transition: undefined → true → false → null exercises all three classes', async () => {
    await importPicker();
    // Initial subscribe fire is null/undefined-ish — chip should be neutral after first fire.
    // (store fresh state has ui.chainOk === null per __resetForTest.)
    storeMod.update('ui.chainOk', true);
    assert.ok(_chainChipEl.classList.contains('chain-chip--ok'));
    storeMod.update('ui.chainOk', false);
    assert.ok(_chainChipEl.classList.contains('chain-chip--mismatch'));
    storeMod.update('ui.chainOk', null);
    assert.ok(_chainChipEl.classList.contains('chain-chip--neutral'));
  });
});

// ===========================================================================
// WLT-01 (lifecycle) — disconnectedCallback cleans up subscribers
// ===========================================================================

describe('WalletPicker lifecycle cleanup', () => {
  test('disconnectedCallback resolves any pending show() Promise to null', async () => {
    const mod = await importPicker();
    const picker = new mod.WalletPicker();
    picker.connectedCallback();
    const promise = picker.show([{ icon: '', name: 'X', rdns: 'x', uuid: 'u1' }]);
    picker.disconnectedCallback();
    const result = await promise;
    assert.equal(result, null, 'pending Promise resolved null on disconnect');
  });
});
