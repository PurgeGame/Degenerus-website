import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as storeMod from '../../app/store.js';

const STATUS_CSS = readFileSync(new URL('../../styles/status-indicators.css', import.meta.url), 'utf8');

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

const {
  BoonProductIndicator,
  purchaseControlBoonLabel,
} = await import('../boon-product-indicator.js');

describe('<boon-product-indicator>', () => {
  beforeEach(() => storeMod.__resetForTest());

  test('purchase controls state the concrete green-line effect', () => {
    assert.equal(purchaseControlBoonLabel('BOON +5%', 'purchase'),
      'BOON: +5% MORE TICKETS');
    assert.equal(purchaseControlBoonLabel('BOON +5%', 'lootbox'),
      'BOON: +5% BIGGER LUCKBOX');

    const el = new BoonProductIndicator();
    el.setAttribute('product', 'lootbox');
    el.setAttribute('variant', 'purchase-control');
    el.connectedCallback();
    storeMod.update('app.boons', {
      address: '0xabc',
      day: 62,
      boons: [{ boonType: 5, consumed: false }],
    });
    assert.equal(el.textContent, 'BOON: +5% BIGGER LUCKBOX');
    el.disconnectedCallback();
  });

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
    // `lootbox` stays the product key; the player-facing word is "luckbox".
    assert.match(el.title, /luckbox purchase/i);
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
    host.setAttribute('title', 'Luckbox amount');
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
    assert.match(host.getAttribute('title'), /luckbox purchase.*15%/i);
    assert.match(el.getAttribute('aria-label'), /luckbox purchase.*15%/i);
    assert.equal(el.getAttribute('tabindex'), '0', 'the hover description is keyboard reachable');

    storeMod.update('app.boons', {
      address: '0xabc',
      day: 62,
      boons: [{ boonType: 6, consumed: true }],
    });
    assert.equal(host.classList.contains('has-active-boon'), false);
    assert.equal(host.getAttribute('data-active-boon-product'), null);
    assert.equal(host.getAttribute('title'), 'Luckbox amount', 'the original field tooltip is restored');
    el.disconnectedCallback();
  });

  test('the chip never costs its host layout room', () => {
    // The add-bet dialog card clips its own overflow, so a chip outdented past
    // the card edge loses its top. It has to sit in the card's flow.
    const coinflip = STATUS_CSS.match(/\.df-boon-indicator\s*\{[^}]*\}/)?.[0];
    assert.ok(coinflip, 'the coinflip chip still has a rule');
    assert.doesNotMatch(coinflip, /position:\s*absolute/,
      'the chip is clipped by .df-reverse-dialog__card overflow when it is lifted out of flow');
    assert.doesNotMatch(coinflip, /top:\s*-/);

    // Column 3 of the quest header rail is auto-sized against a centred QUESTS
    // heading in column 2, so widening the score control collides with it.
    const quest = STATUS_CSS.match(
      /\.qst-score-label boon-product-indicator\s*\{[^}]*display:\s*flex[^}]*\}/)?.[0];
    assert.ok(quest, 'the quest chip drops to its own row instead of extending the label');
    assert.match(quest, /width:\s*fit-content/, 'the chip keeps its own width on that row');
  });

  test('an inactive chip collapses even though the rules set a display', () => {
    // Authored `display:` beats the UA [hidden] rule, so every display we set
    // needs the !important companion or a consumed boon still takes up space.
    const displays = STATUS_CSS.match(/boon-product-indicator[^{}]*\{[^}]*display:\s*(?!none)[^;]+;/g) || [];
    assert.ok(displays.length > 0, 'this guard only means something while such rules exist');
    assert.match(STATUS_CSS, /boon-product-indicator\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });
});
