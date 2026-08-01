import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as storeMod from '../../app/store.js';

class FakeHTMLElement {
  constructor() {
    this._attrs = new Map();
    this.hidden = false;
    this.textContent = '';
    this.title = '';
    this.classList = { add() {} };
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
});
