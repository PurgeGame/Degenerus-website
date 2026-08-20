// /app/app/__tests__/discord-link-focus.test.js — passive focus must stay lazy.

import { after, afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import * as store from '../store.js';

function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    children: [],
    parentElement: null,
    listeners: {},
    _text: '',
    classList: {
      _classes: new Set(),
      add(...names) { names.forEach((name) => this._classes.add(name)); },
      remove(...names) { names.forEach((name) => this._classes.delete(name)); },
    },
    get textContent() { return this._text; },
    set textContent(value) { this._text = String(value); },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    cloneNode(deep = false) {
      const copy = makeEl(this.tagName);
      copy.className = this.className;
      copy._text = this._text;
      if (deep) this.children.forEach((child) => copy.appendChild(child.cloneNode(true)));
      return copy;
    },
    replaceWith(next) {
      const index = this.parentElement?.children.indexOf(this) ?? -1;
      if (index < 0) return;
      this.parentElement.children[index] = next;
      next.parentElement = this.parentElement;
    },
    querySelector(selector) {
      const className = selector.replace(/^\./, '');
      const pending = [...this.children];
      while (pending.length) {
        const current = pending.shift();
        if (String(current.className).split(/\s+/).includes(className)) return current;
        pending.unshift(...current.children);
      }
      return null;
    },
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    click() { (this.listeners.click || []).forEach((listener) => listener()); },
  };
  return el;
}

const originals = {
  window: globalThis.window,
  document: globalThis.document,
  fetch: globalThis.fetch,
  CustomEvent: globalThis.CustomEvent,
};

let root;
let windowListeners = new Map();
let opened = [];

globalThis.CustomEvent = globalThis.CustomEvent || class {
  constructor(type, options) { this.type = type; Object.assign(this, options); }
};
globalThis.window = {
  addEventListener(type, listener) { (windowListeners.get(type) || windowListeners.set(type, []).get(type)).push(listener); },
  removeEventListener(type, listener) {
    windowListeners.set(type, (windowListeners.get(type) || []).filter((item) => item !== listener));
  },
  open(url) { opened.push(String(url)); return null; },
};
globalThis.document = {
  getElementById(id) {
    const pending = [...root.children];
    while (pending.length) {
      const current = pending.shift();
      if (current.id === id) return current;
      pending.unshift(...current.children);
    }
    return null;
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};

// Import after installing the browser-shaped globals used by wallet.js.
const discordLink = await import('../discord-link.js');

function mountNavButton() {
  root = makeEl('body');
  const button = makeEl('button');
  button.id = 'unav-discord';
  button.className = 'nav-btn nav-btn-discord';
  const label = makeEl('span');
  label.className = 'btn-label';
  label.textContent = 'Discord';
  button.appendChild(label);
  root.appendChild(button);
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

beforeEach(() => {
  windowListeners = new Map();
  opened = [];
  store.__resetForTest();
  discordLink.__resetForTest();
  mountNavButton();
});

afterEach(() => {
  discordLink.__resetForTest();
  store.__resetForTest();
});

after(() => {
  if (originals.window === undefined) delete globalThis.window;
  else globalThis.window = originals.window;
  if (originals.document === undefined) delete globalThis.document;
  else globalThis.document = originals.document;
  if (originals.fetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = originals.fetch;
  if (originals.CustomEvent === undefined) delete globalThis.CustomEvent;
  else globalThis.CustomEvent = originals.CustomEvent;
});

describe('Discord lazy session discovery', () => {
  test('logged-out focus stays request-free while an explicit click still discovers session state', async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      return { ok: false, status: 401, json: async () => ({}) };
    };

    discordLink.initDiscordLink({ retries: 0 });
    const button = root.children[0];
    const focus = windowListeners.get('focus')?.[0];
    assert.equal(typeof focus, 'function');

    focus();
    await settle();
    assert.deepEqual(requests, [], 'passive focus must not probe an anonymous session');

    button.click();
    await settle();
    assert.deepEqual(requests, [
      'https://api.degener.us/auth/discord/me',
      'https://api.degener.us/api/player',
    ], 'the first trusted click still performs session discovery');
    assert.match(opened[0] || '', /https:\/\/api\.degener\.us\/auth\/discord/,
      'an anonymous explicit click still starts Discord OAuth');
  });
});
