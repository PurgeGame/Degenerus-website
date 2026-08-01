// /app/app/__tests__/nav-wallet.test.js — the nav Connect button takeover.
//
// Run: cd website && node --test app/app/__tests__/nav-wallet.test.js
//
// What this guards is the part with rules: that /app/ REPLACES nav.js's button
// (retiring the id its updateWalletBtn() looks up, so a late session check
// cannot reset the label while a wallet is attached), and that the label tracks
// the store through connected / wrong-network / disconnected.
//
// The connect click itself is proven end-to-end in a real browser against a mock
// EIP-6963 wallet, not here: connectWithPicker runs ethers' BrowserProvider
// .discover, which has nothing to discover under node:test.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as storeMod from '../store.js';

const ADDR = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

// ---------------------------------------------------------------------------
// Fake DOM — only what nav-wallet.js touches.
// ---------------------------------------------------------------------------

function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    type: '',
    title: '',
    className: '',
    childNodes: [],
    children: [],
    parentElement: null,
    listeners: {},
    _text: '',
    classList: {
      _s: new Set(),
      add(...c) { for (const x of c) this._s.add(x); },
      remove(...c) { for (const x of c) this._s.delete(x); },
      contains(c) { return this._s.has(c); },
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    appendChild(child) {
      child.parentElement = this;
      this.childNodes.push(child);
      this.children.push(child);
      return child;
    },
    cloneNode() {
      const copy = makeEl(this.tagName);
      copy.className = this.className;
      copy._text = this._text;
      for (const c of this.childNodes) copy.appendChild(c.cloneNode(true));
      return copy;
    },
    replaceWith(next) {
      const parent = this.parentElement;
      if (!parent) return;
      const i = parent.childNodes.indexOf(this);
      if (i >= 0) parent.childNodes[i] = next;
      const j = parent.children.indexOf(this);
      if (j >= 0) parent.children[j] = next;
      next.parentElement = parent;
    },
    querySelector(sel) {
      const want = sel.replace(/^\./, '');
      const stack = [...this.children];
      while (stack.length) {
        const cur = stack.shift();
        if (String(cur.className).split(/\s+/).includes(want)) return cur;
        if (cur.children?.length) stack.unshift(...cur.children);
      }
      return null;
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    click() { for (const fn of this.listeners.click || []) fn(); },
  };
  return el;
}

let _root;
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
globalThis.Event = globalThis.Event || class { constructor(t) { this.type = t; } };
globalThis.localStorage = globalThis.localStorage || {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
globalThis.document = {
  createElement: (t) => makeEl(t),
  getElementById(id) {
    const stack = [..._root.children];
    while (stack.length) {
      const cur = stack.shift();
      if (cur.id === id) return cur;
      if (cur.children?.length) stack.unshift(...cur.children);
    }
    return null;
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};

// Imported AFTER the globals exist — the module installs an eip6963 listener at
// import time via wallet.js.
const navWallet = await import('../nav-wallet.js');

/** Build the button shared/nav.js would have injected. */
function mountNavButton() {
  _root = makeEl('body');
  const btn = makeEl('button');
  btn.id = 'unav-wallet';
  btn.className = 'nav-btn nav-btn-wallet';
  const svg = makeEl('svg');
  svg.className = 'wallet-glyph';
  btn.appendChild(svg);
  const lbl = makeEl('span');
  lbl.className = 'btn-label';
  lbl.textContent = 'Connect';
  btn.appendChild(lbl);
  _root.appendChild(btn);
  return btn;
}

function labelOf(btn) { return btn.querySelector('.btn-label')?.textContent; }

describe('nav-wallet takeover', () => {
  beforeEach(async () => {
    storeMod.__resetForTest();
    navWallet.__resetForTest();
    mountNavButton();
  });

  afterEach(() => {
    storeMod.__resetForTest();
  });

  test('replaces the nav button and retires its id', async () => {
    const btn = await navWallet.initNavWallet();
    assert.ok(btn, 'installed');
    assert.equal(btn.id, 'unav-wallet-app');
    // The id nav.js's updateWalletBtn() looks up is gone, so its null-guard
    // fires instead of resetting the label out from under a live connection.
    assert.equal(document.getElementById('unav-wallet'), null);
    assert.equal(btn.className, 'nav-btn nav-btn-wallet', 'nav.css styling preserved');
  });

  test('carries the nav glyph and label across', async () => {
    const btn = await navWallet.initNavWallet();
    assert.ok(btn.querySelector('.wallet-glyph'), 'inline svg cloned');
    assert.equal(labelOf(btn), 'Connect');
  });

  test('label and connected class follow connected.address', async () => {
    const btn = await navWallet.initNavWallet();
    assert.equal(btn.classList.contains('connected'), false);

    storeMod.update('ui.chainOk', true);
    storeMod.update('connected.address', ADDR);
    assert.equal(labelOf(btn), '0x6045');
    assert.equal(btn.classList.contains('connected'), true);
    assert.match(btn.title, /click to disconnect/);

    storeMod.update('connected.address', null);
    assert.equal(labelOf(btn), 'Connect');
    assert.equal(btn.classList.contains('connected'), false);
  });

  test('a chain mismatch says so instead of showing the address', async () => {
    const btn = await navWallet.initNavWallet();
    storeMod.update('connected.address', ADDR);
    storeMod.update('ui.chainOk', false);
    assert.equal(labelOf(btn), 'Wrong network');
    assert.equal(btn.classList.contains('connected'), true, 'still attached, just wrong chain');
  });

  test('clicking while connected disconnects', async () => {
    const btn = await navWallet.initNavWallet();
    storeMod.update('ui.chainOk', true);
    storeMod.update('connected.address', ADDR);
    btn.click();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(storeMod.get('connected.address'), null);
    assert.equal(labelOf(btn), 'Connect');
  });

  test('idempotent — a second init returns the same button', async () => {
    const a = await navWallet.initNavWallet();
    const b = await navWallet.initNavWallet();
    assert.equal(a, b);
  });

  test('no nav button mounted → resolves null instead of hanging', async () => {
    _root = makeEl('body');
    navWallet.__resetForTest();
    const btn = await navWallet.initNavWallet({ retries: 1 });
    assert.equal(btn, null);
  });
});
