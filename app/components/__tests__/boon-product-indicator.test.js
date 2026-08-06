import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as storeMod from '../../app/store.js';

class FakeHTMLElement {
  constructor() {
    this._attrs = new Map();
    this.hidden = false;
    this.textContent = '';
    this.title = '';
    this.classList = {
      _set: new Set(),
      add(...names) { names.forEach((name) => this._set.add(name)); },
      remove(...names) { names.forEach((name) => this._set.delete(name)); },
      contains(name) { return this._set.has(name); },
    };
  }
  getAttribute(name) { return this._attrs.get(name) ?? null; }
  setAttribute(name, value) { this._attrs.set(name, String(value)); }
  removeAttribute(name) { this._attrs.delete(name); }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};

const { BoonProductIndicator } = await import('../boon-product-indicator.js');

describe('<boon-product-indicator>', () => {
  beforeEach(() => storeMod.__resetForTest());

  test('lights up from app.boons and clears as soon as the DB row is consumed', () => {
    const el = new BoonProductIndicator();
    el.setAttribute('product', 'lootbox');
    el.connectedCallback();
    assert.equal(el.hidden, true);

    storeMod.update('app.boons', {
      address: '0xabc',
      day: 62,
      boons: [{ boonType: 6, consumed: false }],
    });
    assert.equal(el.hidden, false);
    assert.equal(el.textContent, 'BOON +15%');
    assert.match(el.title, /lootbox purchase/i);
    assert.equal(el.getAttribute('data-boon-type'), '6');

    storeMod.update('app.boons', {
      address: '0xabc',
      day: 62,
      boons: [{ boonType: 6, consumed: true }],
    });
    assert.equal(el.hidden, true);
    assert.equal(el.textContent, '');
    el.disconnectedCallback();
  });

  test('glows the affected purchase field and exposes the exact bonus on hover', () => {
    const host = new FakeHTMLElement();
    host.setAttribute('title', 'Lootbox amount');
    const el = new BoonProductIndicator();
    el.setAttribute('product', 'lootbox');
    el.closest = () => host;
    el.connectedCallback();

    storeMod.update('app.boons', {
      address: '0xabc',
      day: 62,
      boons: [{ boonType: 6, consumed: false }],
    });

    assert.equal(host.classList.contains('has-active-boon'), true);
    assert.equal(host.getAttribute('data-active-boon-product'), 'lootbox');
    assert.equal(host.getAttribute('data-active-boon-type'), '6');
    assert.equal(host.getAttribute('data-boon-effect'), '+15%');
    assert.match(host.getAttribute('title'), /lootbox purchase.*15%/i);
    assert.match(el.getAttribute('aria-label'), /lootbox purchase.*15%/i);
    assert.equal(el.getAttribute('tabindex'), '0', 'the hover description is keyboard reachable');

    storeMod.update('app.boons', {
      address: '0xabc',
      day: 62,
      boons: [{ boonType: 6, consumed: true }],
    });
    assert.equal(host.classList.contains('has-active-boon'), false);
    assert.equal(host.getAttribute('data-active-boon-product'), null);
    assert.equal(host.getAttribute('title'), 'Lootbox amount', 'the original field tooltip is restored');
    el.disconnectedCallback();
  });
});
