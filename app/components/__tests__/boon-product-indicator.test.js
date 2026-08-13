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

const { BoonProductIndicator } = await import('../boon-product-indicator.js');

describe('<boon-product-indicator>', () => {
  beforeEach(() => storeMod.__resetForTest());

  test('purchase controls stay icon-only and put the exact effect in hover text', () => {
    const el = new BoonProductIndicator();
    el.setAttribute('product', 'lootbox');
    el.setAttribute('variant', 'purchase-control');
    el.connectedCallback();
    storeMod.update('app.boons', {
      address: '0xabc',
      day: 62,
      boons: [{ boonType: 5, consumed: false }],
    });
    assert.equal(el.textContent, '');
    assert.match(el.title, /next luckbox purchase gets \+5% value/i);
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
    assert.equal(el.textContent, '', 'the main UI uses the mark without words');
    // `lootbox` stays the product key; the player-facing word is "luckbox".
    assert.match(el.title, /luckbox purchase/i);
    assert.equal(el.getAttribute('data-boon-type'), '6');
    assert.equal(el.getAttribute('data-boon-strength'), 'mid');
    assert.equal(el.getAttribute('data-boon-tier'), '2');
    assert.equal(el.getAttribute('data-boon-pips'), '●●');
    assert.equal(el.getAttribute('data-boon-direction'), 'up');

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
    assert.equal(host.getAttribute('data-boon-strength'), 'mid');
    assert.equal(host.getAttribute('data-boon-pips'), '●●');
    assert.equal(host.getAttribute('data-boon-direction'), 'up');
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
    assert.equal(host.getAttribute('data-boon-strength'), null);
    assert.equal(host.getAttribute('data-boon-direction'), null);
    assert.equal(host.getAttribute('title'), 'Luckbox amount', 'the original field tooltip is restored');
    el.disconnectedCallback();
  });

  test('the icon overlays dense controls without changing their box metrics', () => {
    const liveRule = STATUS_CSS.match(
      /body\.layout-basic boon-product-indicator\s*\{[^}]*position:\s*absolute;[^}]*display:\s*grid;[^}]*flex:\s*none;[^}]*\}/s,
    )?.[0];
    assert.ok(liveRule, 'live boon badges are removed from flex and grid flow globally');

    // The add-bet card is positioned and clipped, so the badge stays inside
    // its top edge while remaining absolutely overlaid.
    const coinflip = STATUS_CSS.match(/\.df-boon-indicator\s*\{[^}]*\}/)?.[0];
    assert.ok(coinflip, 'the coinflip chip still has a rule');
    assert.match(coinflip, /top:\s*0\.52rem/);
    assert.match(coinflip, /right:\s*2\.9rem/);

    // Column 3 of the quest header rail is auto-sized against a centred QUESTS
    // heading in column 2, so the icon straddles the existing card corner.
    const quest = STATUS_CSS.match(
      /\.qst-score-label boon-product-indicator\s*\{[^}]*\}/)?.[0];
    assert.ok(quest, 'the quest boon is a compact icon rather than a text chip');
    assert.match(quest, /top:\s*-0\.48rem/);
    assert.match(quest, /right:\s*-0\.48rem/);
  });

  test('uses a standard tier-colored arrow with native product badges and a real shield', () => {
    assert.match(STATUS_CSS,
      /data-boon-product="degenerette-eth"[^}]*--boon-logo:\s*url\('\/badges-circular\/crypto_06_ethereum_green\.svg'\)/);
    assert.match(STATUS_CSS,
      /data-boon-product="degenerette-flip"[^}]*--boon-logo:\s*url\('\/whitepaper\/flame-logo-split\.svg'\)/);
    assert.match(STATUS_CSS,
      /data-boon-product="degenerette-wwxrp"[^}]*--boon-logo:\s*url\('\/shared\/coinflip-face-red\.svg'\)/);
    assert.match(STATUS_CSS,
      /data-boon-product="quests"[^}]*--boon-logo:\s*url\('\/app\/assets\/boons\/boon-quest-micro\.svg'\)/);
    assert.match(STATUS_CSS,
      /data-boon-product="quests"\]::before\s*\{[^}]*display:\s*none/,
      'quest shields replace the arrow instead of sitting on it');
    assert.match(STATUS_CSS,
      /boon-product-indicator::before\s*\{[^}]*background:\s*linear-gradient\([^}]*var\(--boon-amount[^}]*clip-path:\s*polygon\(/s,
      'the arrow itself carries the amount tier');
    assert.match(STATUS_CSS,
      /boon-product-indicator::after\s*\{[^}]*background:\s*var\(--boon-logo, none\) center \/ contain no-repeat/s,
      'an established badge can sit directly on the arrow');
    assert.doesNotMatch(STATUS_CSS,
      /content:\s*attr\(data-boon-pips\)/s,
      'redundant pips are absent');
    assert.match(STATUS_CSS,
      /data-boon-direction="down"\][^{}]*::before\s*\{[^}]*rotate\(180deg\)/,
      'discounts point down');
  });

  test('an inactive chip collapses even though the rules set a display', () => {
    // Authored `display:` beats the UA [hidden] rule, so every display we set
    // needs the !important companion or a consumed boon still takes up space.
    const displays = STATUS_CSS.match(/boon-product-indicator[^{}]*\{[^}]*display:\s*(?!none)[^;]+;/g) || [];
    assert.ok(displays.length > 0, 'this guard only means something while such rules exist');
    assert.match(STATUS_CSS, /boon-product-indicator\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });
});
