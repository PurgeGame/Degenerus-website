// Bottom-pinned reveal tray: only actionable presentation work belongs here.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function makeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentElement: null,
    attributes: {},
    listeners: {},
    _text: '',
    _html: '',
    hidden: false,
    disabled: false,
    className: '',
    classList: {
      _set: new Set(),
      add(...names) { names.forEach((name) => this._set.add(name)); },
      contains(name) { return this._set.has(name); },
    },
    get innerHTML() { return this._html; },
    set innerHTML(value) {
      this._html = String(value);
      this.children = [];
      const tags = /<(\w[\w-]*)([^>]*?)(?:\s\/>|>)/g;
      let match;
      while ((match = tags.exec(this._html))) {
        const child = makeElement(match[1]);
        const attrs = match[2];
        const bind = /data-bind="([^"]+)"/.exec(attrs);
        const klass = /class="([^"]+)"/.exec(attrs);
        if (bind) child.attributes['data-bind'] = bind[1];
        if (klass) {
          child.className = klass[1];
          klass[1].split(/\s+/).forEach((name) => child.classList.add(name));
        }
        if (/\bhidden\b/.test(attrs)) child.hidden = true;
        child.parentElement = this;
        this.children.push(child);
      }
    },
    get textContent() {
      if (this._text) return this._text;
      return this.children.map((child) => child.textContent || '').join('');
    },
    set textContent(value) { this._text = String(value); this.children = []; },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const out = [];
      const stack = [...this.children];
      while (stack.length) {
        const node = stack.shift();
        if (matches(node, selector)) out.push(node);
        stack.unshift(...(node.children || []));
      }
      return out;
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatchEvent(event) {
      for (const fn of this.listeners[event.type] || []) fn(event);
      return true;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
  };
  return el;
}

function matches(el, selector) {
  if (selector.startsWith('.')) {
    const name = selector.slice(1);
    return el.classList.contains(name) || el.className.split(/\s+/).includes(name);
  }
  const attr = /^\[([\w-]+)="([^"]+)"\]$/.exec(selector);
  if (attr) return el.attributes[attr[1]] === attr[2];
  return el.tagName === selector.toUpperCase();
}

class FakeHTMLElement {
  constructor() { Object.defineProperties(this, Object.getOwnPropertyDescriptors(makeElement())); }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.document = { createElement: (tag) => makeElement(tag) };
globalThis.customElements = {
  registry: new Map(),
  define(name, ctor) { this.registry.set(name, ctor); },
  get(name) { return this.registry.get(name); },
};

const pending = await import('../../app/pending-actions.js');
const trayModule = await import('../app-reveal-tray.js');

beforeEach(() => pending.__resetPendingActionsForTest());

describe('actionableRevealItems', () => {
  test('accepts ready/busy reveal kinds and rejects waiting or unrelated work', () => {
    const rows = trayModule.actionableRevealItems([
      { kind: 'lootbox', state: 'ready' },
      { kind: 'degenerette', state: 'busy' },
      { kind: 'tickets', state: 'waiting' },
      { kind: 'batch-resolution', state: 'ready' },
    ]);
    assert.deepEqual(rows.map((row) => row.kind), ['lootbox', 'degenerette']);
  });
});

describe('<app-reveal-tray>', () => {
  test('pins ready reveal work, delegates the click, and hides after its owner clears', async () => {
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    assert.equal(el.querySelector('[data-bind="rrt-tray"]').hidden, true);

    let ran = 0;
    pending.publishPendingActions('box', [{
      id: 'box:7', kind: 'lootbox', label: 'Lootbox #7', shortLabel: 'Open box',
      detail: 'Prizes ready', state: 'ready',
      run: async () => {
        ran += 1;
        pending.clearPendingActions('box');
      },
    }]);
    const shell = el.querySelector('[data-bind="rrt-tray"]');
    assert.equal(shell.hidden, false);
    assert.equal(el.querySelectorAll('.rrt-action').length, 1);
    el.querySelector('.rrt-action').dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(ran, 1);
    assert.equal(shell.hidden, true);
    el.disconnectedCallback();
  });

  test('waiting rows never pin the tray over the app', () => {
    pending.publishPendingActions('pack', [{
      id: 'pack:1', kind: 'tickets', label: 'Ticket pack', state: 'waiting',
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    assert.equal(el.querySelector('[data-bind="rrt-tray"]').hidden, true);
    el.disconnectedCallback();
  });

  test('is mounted once and styled as a fixed bottom surface below the reveal overlay', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.equal((html.match(/<app-reveal-tray><\/app-reveal-tray>/g) || []).length, 1);
    assert.equal((html.match(/<app-box-strip tray-only><\/app-box-strip>/g) || []).length, 1,
      'one headless lootbox controller feeds the global tray');
    assert.match(css, /app-reveal-tray\s*\{[^}]*position:\s*fixed[^}]*bottom:/s);
    assert.match(css, /app-reveal-tray\s*\{[^}]*z-index:\s*900/s);
    assert.match(css, /\.rvl-backdrop\s*\{[^}]*z-index:\s*1200/s);
  });
});
