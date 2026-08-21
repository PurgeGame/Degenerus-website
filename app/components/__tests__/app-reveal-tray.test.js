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
    style: {
      _props: {},
      setProperty(name, value) {
        this._props[String(name)] = String(value);
        this[String(name)] = String(value);
      },
      getPropertyValue(name) { return this._props[String(name)] ?? ''; },
    },
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

function pendingSurfaceVisible(el) {
  return el.querySelector('[data-bind="rrt-tray"]')
    ?.getAttribute('data-has-pending') === 'true';
}

class FakeHTMLElement {
  constructor() { Object.defineProperties(this, Object.getOwnPropertyDescriptors(makeElement())); }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.document = { createElement: (tag) => makeElement(tag) };
globalThis.localStorage = {
  _m: new Map(),
  getItem(key) { return this._m.get(String(key)) ?? null; },
  setItem(key, value) { this._m.set(String(key), String(value)); },
};
globalThis.customElements = {
  registry: new Map(),
  define(name, ctor) { this.registry.set(name, ctor); },
  get(name) { return this.registry.get(name); },
};

const pending = await import('../../app/pending-actions.js');
const drawGate = await import('../../app/major-draw-activity.js');
const uiPreferences = await import('../../app/ui-preferences.js');
const store = await import('../../app/store.js');
const trayModule = await import('../app-reveal-tray.js');

beforeEach(() => {
  store.__resetForTest();
  pending.__resetPendingActionsForTest();
  drawGate.__resetMajorDrawActivityForTest();
  localStorage._m.clear();
});

describe('actionableRevealItems', () => {
  test('accepts ready/busy work and explicitly pinned RNG waits, but rejects ordinary waiting', () => {
    const rows = trayModule.actionableRevealItems([
      { kind: 'lootbox', state: 'ready' },
      { kind: 'degenerette', state: 'busy' },
      { kind: 'degenerette', state: 'waiting', pinned: true },
      { kind: 'lootbox', state: 'waiting', pinned: true },
      { kind: 'tickets', state: 'waiting', pinned: true, passive: true },
      { kind: 'degenerette', state: 'waiting' },
      { kind: 'growth-claim', state: 'ready' },
      { kind: 'volume-claim', state: 'ready' },
      { kind: 'whale-pass-claim', state: 'ready' },
      { kind: 'tickets', state: 'waiting' },
      { kind: 'pari', state: 'ready' },
      { kind: 'batch-resolution', state: 'ready' },
      { kind: 'bingo', state: 'ready' },
      { kind: 'foil-match', state: 'ready' },
      { kind: 'funds-claim', state: 'ready' },
      { kind: 'decimator', state: 'ready', primarySurface: 'jackpot' },
      { kind: 'decimator', state: 'ready' },
    ]);
    assert.deepEqual(rows.map((row) => row.kind), [
      'lootbox', 'degenerette', 'degenerette', 'lootbox', 'tickets', 'growth-claim', 'volume-claim', 'whale-pass-claim', 'batch-resolution', 'bingo', 'foil-match', 'decimator', 'decimator',
    ]);
    assert.doesNotMatch(
      readFileSync(new URL('../../app/launch-claims.js', import.meta.url), 'utf8'),
      /funds-claim|readClaimableEth|readClaimableCoinflip/,
      'ordinary ETH/FLIP claims are dedicated widgets, never Pending work',
    );
  });

  test('keeps an unclassified foil-gold claim neutral instead of inventing a Golden Ticket', () => {
    // The contract's claimGoldenTicket entrypoint covers the full 3+ gold
    // ladder. A successful simulation does not distinguish three scattered
    // golds (allGoldTickets == 0) from one actual all-gold ticket, so Pending
    // must keep the broader category and preserve the real claim action.
    const [item] = trayModule.actionableRevealItems([
      { kind: 'foil-gold', state: 'ready', run() {} },
    ]);
    assert.equal(item?.kind, 'foil-gold');

    const launchClaimsSource = readFileSync(
      new URL('../../app/launch-claims.js', import.meta.url),
      'utf8',
    );
    assert.match(launchClaimsSource, /kind:\s*'foil-gold'/);
    assert.match(launchClaimsSource, /kindLabel:\s*'FOIL GOLD'/);
    assert.doesNotMatch(
      launchClaimsSource,
      /kind:\s*'golden-ticket'|kindLabel:\s*'GOLDEN TICKET'/,
    );
  });

  test('Pending omits passive WWXRP draw losses that have no action', () => {
    const launchClaimsSource = readFileSync(
      new URL('../../app/launch-claims.js', import.meta.url),
      'utf8',
    );
    assert.match(
      launchClaimsSource,
      /const playerWins = resolved\.filter\(\(row\) => row\.won && row\.winner === address\)/,
      'only the connected player\'s wins enter the WWXRP Pending feed',
    );
    assert.doesNotMatch(
      launchClaimsSource,
      /WWXRP · LOST|shortLabel:\s*['"]Lost['"]|wwxrp-draw:[^\n]*['"]lost['"]/,
      'a WWXRP loss can no longer produce a dead notification row',
    );
  });

  test('incoming RNG estimates advance four lights across the expected ready window', () => {
    const startedAt = 1_000_000;
    const dotsAt = (elapsed) => trayModule.rngTimedConfirmationDots({
      startedAt,
      now: startedAt + elapsed,
      estimatedReadyMs: 12_000,
    });
    assert.deepEqual(
      [dotsAt(0), dotsAt(4_000), dotsAt(8_000), dotsAt(12_000), dotsAt(60_000)],
      [1, 2, 3, 4, 4],
      'elapsed time fills the incoming lights but can never fill readiness',
    );
  });

  test('large Pending token amounts use short readable suffixes without rounding ETH', () => {
    assert.equal(trayModule.abbreviatePendingTokenAmounts('200000 FLIP'), '200k FLIP');
    assert.equal(trayModule.abbreviatePendingTokenAmounts('12,345 DGNRS ready'), '12.3k DGNRS ready');
    assert.equal(trayModule.abbreviatePendingTokenAmounts('1250000 WWXRP'), '1.25m WWXRP');
    assert.equal(trayModule.abbreviatePendingTokenAmounts('0.025 ETH'), '0.025 ETH');
    assert.equal(trayModule.abbreviatePendingTokenAmounts('750 tickets'), '750 tickets');
  });
});

describe('<app-reveal-tray>', () => {
  test('a large FLIP spin receipt is abbreviated in the visible Pending amount', () => {
    pending.publishPendingActions('degenerette', [{
      id: 'degenerette:large', kind: 'degenerette', label: '3 spins',
      amountLabel: '200000 FLIP', spinCount: 3,
      state: 'waiting', phase: 'awaitingRng', pinned: true,
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    assert.equal(
      el.querySelector('.rrt-degenerette-summary__amount').textContent,
      '200k FLIP',
    );
    el.disconnectedCallback();
  });

  test('a lootbox stays x ETH and LOOTBOX when it becomes openable', async () => {
    let opened = 0;
    pending.publishPendingActions('lootboxes', [{
      id: 'lootbox:submitted:0xabc', kind: 'lootbox', label: 'Luckbox purchase',
      amountLabel: '0.04 ETH', lootboxValueTone: 'purple',
      lootboxTicketUnitsLabel: '4×', compact: true,
      detail: 'Purchase sent · waiting for confirmation',
      state: 'waiting', pinned: true, progress: 'indeterminate', write: true,
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--lootbox-summary');
    assert.ok(action);
    assert.equal(action.getAttribute('data-lootbox-value-tone'), 'purple');
    assert.equal(action.querySelector('.rrt-lootbox-summary__amount').textContent, '0.04 ETH');
    assert.equal(action.querySelector('.rrt-lootbox-summary__box'), null,
      'the receipt copy does not put a second icon inline before LOOTBOX');
    assert.match(action.querySelector('.rrt-lootbox-summary').textContent, /0\.04 ETH.*LUCKBOX/);
    assert.doesNotMatch(action.title, /purchase/i,
      'legacy purchase wording never leaks into the compact Pending receipt');
    const summaryParts = action.querySelector('.rrt-lootbox-summary').children;
    assert.match(summaryParts[0].className, /rrt-lootbox-summary__amount/,
      'the ETH amount owns the first line');
    assert.match(summaryParts[1].className, /rrt-lootbox-summary__unit/,
      'the plain LOOTBOX label owns the separate second line');
    const lootboxArt = action.querySelector('.rrt-action__art--lootbox');
    assert.ok(lootboxArt, 'Pending gives the lootbox the same left-hand visual slot as packs and spins');
    const lootboxIcon = lootboxArt.querySelector('.rrt-lootbox-mini');
    assert.ok(lootboxIcon);
    assert.equal(lootboxIcon.getAttribute('data-lootbox-value-tone'), 'purple',
      'the miniature receives the same ticket-price color tier as the full lootbox');
    assert.equal(lootboxIcon.getAttribute('data-lootbox-case-model'), 'medium');
    assert.match(
      lootboxIcon.style.getPropertyValue('--lootbox-case-art'),
      /degenerus-lootbox-case-medium-v14-locked-front\.webp/,
      'an unknown legacy amount receives the canonical neutral case family',
    );
    assert.equal(action.querySelector('.rrt-action__cta'), null);
    assert.equal(action.querySelector('.rrt-action__progress'), null);
    assert.match(action.title, /4× ticket price/);
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css, /\.rrt-action--lootbox-summary\s*\{[^}]*grid-template-columns:\s*2\.2rem auto/s,
      'the compact receipt reserves a dedicated left icon lane');
    assert.match(css, /\.rrt-lootbox-summary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto(?:;|\s)/s,
      'the amount and lootbox receipt use two compact lines');
    assert.match(css, /\.rrt-lootbox-summary__amount\s*\{[^}]*grid-column:\s*1 \/ -1/s);
    assert.match(css,
      /\.rrt-lootbox-mini::after\s*\{[^}]*background:\s*var\(--lootbox-tone[^}]*mask:\s*var\(--lootbox-case-art\)/s,
      'the mini case uses the value-tier tone through the same case silhouette mask');
    assert.doesNotMatch(css,
      /\.rrt-lootbox-mini::before\s*\{[^}]*flame-logo\.svg/s,
      'the tiny front view uses the medallion already baked into the case art');
    assert.match(css,
      /\.rrt-lootbox-mini::before\s*\{[^}]*z-index:\s*2;[^}]*background:\s*var\(--lootbox-case-art\)[^}]*clip-path:\s*var\(--lootbox-badge-clip\)/s,
      'Pending restores the metallic red-black-silver emblem above the value-tier wash');
    assert.doesNotMatch(css, /\.rrt-action:hover:not\(:disabled\)[^}]*transform:\s*translateY\(-1px\)/s,
      'pending cards glow in place instead of clipping their top edge');

    pending.publishPendingActions('lootboxes', [{
      id: 'lootbox:submitted:0xabc', kind: 'lootbox', label: 'Luckbox purchase',
      amountLabel: '0.04 ETH', lootboxValueTone: 'purple',
      lootboxTicketUnitsLabel: '4×', compact: true,
      detail: 'RNG ready · prizes locked', state: 'ready', pinned: true, write: true,
      run: async () => { opened += 1; },
    }]);
    const ready = el.querySelector('.rrt-action--lootbox-summary');
    assert.equal(ready.disabled, false);
    assert.match(ready.querySelector('.rrt-lootbox-summary').textContent, /0\.04 ETH.*LUCKBOX/);
    assert.equal(ready.querySelector('.rrt-action__cta'), null,
      'the openable compact receipt has no redundant OPEN on the right');
    ready.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(opened, 1, 'the entire compact receipt remains the open target');
    el.disconnectedCallback();
  });

  test('one Pending luckbox omits every redundant 1x marker', () => {
    pending.publishPendingActions('lootboxes', [{
      id: 'lootbox:single', kind: 'lootbox', label: 'Luckbox purchase',
      amountLabel: '0.01 ETH', lootboxValueTone: 'green',
      lootboxTicketUnitsLabel: '1×', compact: true,
      lootboxStacks: [{
        label: 'SMALL', count: 1, lootboxCaseModel: 'small', lootboxValueTone: 'green',
      }],
      state: 'waiting', pinned: true,
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--lootbox-summary');
    assert.equal(action.querySelector('.rrt-lootbox-summary__unit').textContent, 'LUCKBOX');
    assert.equal(action.querySelector('.rrt-lootbox-stack__count'), null,
      'a single case does not need a quantity badge');
    assert.doesNotMatch(action.textContent, /1\s*[×x]/i);
    assert.doesNotMatch(action.title, /1\s*[×x]/i,
      'the redundant ticket-price multiplier is absent from hover copy too');
    el.disconnectedCallback();
  });

  test('a combo luckbox uses one total while preserving each model stack and count', () => {
    pending.publishPendingActions('lootboxes', [{
      id: 'lootbox:combo', kind: 'lootbox', label: 'Luckbox combo',
      amountLabel: '0.61 ETH', compact: true, state: 'waiting', pinned: true,
      lootboxStacks: [
        { label: 'SMALL', count: 1, lootboxCaseModel: 'small', lootboxValueTone: 'green' },
        { label: 'MEDIUM', count: 2, lootboxCaseModel: 'medium', lootboxValueTone: 'purple' },
        { label: 'LARGE', count: 4, lootboxCaseModel: 'large', lootboxValueTone: 'gold' },
      ],
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const actions = el.querySelectorAll('.rrt-action--lootbox-summary');
    assert.equal(actions.length, 1, 'one RNG index remains one open target');
    const action = actions[0];
    assert.match(action.className, /rrt-action--lootbox-stacks/);
    assert.match(action.querySelector('.rrt-lootbox-summary').textContent,
      /7× LUCKBOX/);
    const stacks = action.querySelectorAll('.rrt-lootbox-stack');
    assert.equal(stacks.length, 3);
    assert.deepEqual(stacks.map((stack) => stack.getAttribute('data-box-size')),
      ['small', 'medium', 'large']);
    assert.deepEqual(stacks.map((stack) => stack.querySelector('.rrt-lootbox-stack__count').textContent),
      ['×1', '×2', '×4']);
    assert.equal(action.querySelector('.rrt-lootbox-stack__size'), null,
      'the distinct case art replaces redundant SMALL / MEDIUM / LARGE captions');
    assert.deepEqual(stacks.map((stack) => stack.querySelectorAll('.rrt-lootbox-stack__case').length),
      [1, 2, 3], 'large quantities cap the visual pile at three cases and keep the exact badge');
    assert.deepEqual(stacks.map((stack) => (
      stack.querySelector('.rrt-lootbox-stack__case').getAttribute('data-lootbox-case-model')
    )), ['small', 'medium', 'large']);
    el.disconnectedCallback();
  });

  test('a whale-pass balance is rendered as a guarded CLAIM action', () => {
    pending.publishPendingActions('whale-pass-claims', [{
      id: 'whale:2', kind: 'whale-pass-claim', kindLabel: 'WHALE PASS CLAIM',
      label: '2 whale-pass halves', shortLabel: 'Claim',
      detail: 'Activate the deferred ticket stream for the next 100 levels',
      state: 'ready', write: true, run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--whale-pass-claim');
    assert.ok(action);
    assert.equal(action.querySelector('.rrt-action__kind').textContent, 'WHALE PASS CLAIM');
    assert.ok(action.querySelector('.rrt-action__glyph'),
      'the whale pass uses a real line icon instead of an emoji fallback');
    assert.equal(action.querySelector('.rrt-action__label').textContent, 'WHALE PASS · 2');
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'CLAIM');
    assert.notEqual(action.getAttribute('data-write'), null);
    el.disconnectedCallback();
  });

  test('the compact referral reward names the bonus instead of leading with DGNRS', () => {
    pending.publishPendingActions('launch-claims', [{
      id: 'referral-bonus:0xabc:90', kind: 'affiliate-bonus',
      kindLabel: 'REFERRAL BONUS', label: 'L90 REFERRAL BONUS',
      shortLabel: 'Claim Referral Bonus', compact: true,
      state: 'ready', write: true, run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--affiliate-bonus');
    assert.ok(action);
    assert.equal(action.querySelector('.rrt-action__label').textContent, 'L90 REFERRAL BONUS');
    assert.doesNotMatch(action.textContent, /DGNRS/i);
    assert.equal(action.getAttribute('aria-label'), 'L90 REFERRAL BONUS');
    assert.notEqual(action.getAttribute('data-write'), null);
    el.disconnectedCallback();
  });

  test('a foil match is one terse clickable receipt with no comparison or CTA', async () => {
    let claimed = 0;
    pending.publishPendingActions('foil-match', [{
      id: 'foil-match:44:2:0', kind: 'foil-match', kindLabel: 'FOIL TICKET MATCH',
      label: 'Day 44 · Foil T5', shortLabel: 'Claim T5',
      detail: 'MAIN JACKPOT · 2 exact + 1 symbol · 6-face Degenerette bonus',
      lineTraits: [56, 70, 130, 200],
      winningTraits: [56, 78, 131, 200],
      matchFaces: [2, 1, 0, 2],
      drawKind: 0,
      score: 5,
      rewardFaces: 6,
      state: 'ready', write: true, autoOpen: true,
      run: async () => { claimed += 1; },
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--foil-match');
    assert.ok(action);
    assert.match(action.className, /rrt-action--compact/);
    assert.equal(action.querySelector('.rrt-action__label').textContent, 'T5 FOILMATCH');
    assert.ok(action.querySelector('.rrt-foil-match-summary__luckbox .rrt-action__glyph')
      || action.querySelector('.rrt-foil-match-summary__luckbox')?.querySelector('.rrt-action__glyph'),
    'the [LB] position is a compact Luckbox glyph');
    assert.equal(action.getAttribute('aria-label'), 'T5 FOIL LUCKBOX MATCH');
    assert.equal(action.querySelector('.rrt-action__art'), null);
    assert.equal(action.querySelector('.rrt-action__kind'), null);
    assert.equal(action.querySelector('.rrt-action__detail'), null);
    assert.equal(action.querySelector('.rrt-action__cta'), null);
    assert.equal(action.querySelector('.rrt-foil-match-preview'), null);
    assert.notEqual(action.getAttribute('data-write'), null);
    action.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(claimed, 1, 'the whole concise row remains the claim target');
    el.disconnectedCallback();
  });

  test('a Bingo pending button keeps its badge beside the two-line level and trait receipt', () => {
    pending.publishPendingActions('bingo-claims', [{
      id: 'bingo:0xabc:4', kind: 'bingo', kindLabel: 'QUADRANT-FIRST BINGO',
      label: 'Level 27 ETHEREUM Bingo', shortLabel: 'Reveal Bingo',
      detail: 'CRYPTO quadrant · all 8 colors collected',
      badgePath: '/badges-circular/crypto_06_ethereum_gold.svg',
      state: 'ready', run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    const action = el.querySelector('.rrt-action--bingo');
    assert.ok(action);
    assert.match(action.className, /rrt-action--compact/);
    assert.equal(action.querySelector('.rrt-action__label').textContent, 'BINGO\nL27 ETHEREUM');
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css,
      /body\.layout-basic \.rrt-action__label\.rrt-bingo-summary\s*\{[^}]*white-space:\s*pre-line;/s,
      'the Bingo-specific label rule must outrank the later generic nowrap rule');
    assert.equal(action.getAttribute('aria-label'),
      'VIEW: BINGO L27 ETHEREUM. CRYPTO quadrant · all 8 colors collected');
    assert.equal(action.querySelector('.rrt-action__art--bingo').querySelector('img').src,
      '/badges-circular/crypto_06_ethereum_gold.svg');
    assert.equal(action.querySelector('.rrt-action__kind'), null);
    assert.equal(action.querySelector('.rrt-action__detail'), null);
    assert.equal(action.querySelector('.rrt-action__cta'), null);
    el.disconnectedCallback();
  });

  test('a jackpot-primary Decimator final is still a visible Pending opener', async () => {
    let opened = 0;
    pending.publishPendingActions('jackpot-resolutions', [{
      id: 'decimator-resolution:0xabc:25',
      kind: 'decimator',
      kindLabel: 'DECIMATOR FINAL',
      label: 'Level 25 final draw',
      detail: 'Your resolved Decimator score is ready to view.',
      state: 'ready',
      primarySurface: 'jackpot',
      autoOpen: true,
      run: async () => { opened += 1; },
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    assert.equal(pendingSurfaceVisible(el), true,
      'the jackpot button is not the only path to the fullscreen draw');
    const action = el.querySelector('.rrt-action--decimator');
    assert.ok(action);
    assert.match(action.className, /rrt-action--compact/);
    assert.equal(action.querySelector('.rrt-decimator-summary__level').textContent, 'L25');
    assert.equal(action.querySelector('.rrt-decimator-summary__name').textContent, 'DECIMATOR');
    assert.equal(action.getAttribute('aria-label'), 'L25 DECIMATOR');
    assert.equal(action.querySelector('.rrt-action__cta'), null, 'the terse row has no redundant VIEW');
    assert.equal(action.querySelector('.rrt-decimator-mark').src,
      '/app/assets/decimator-draw-mark.svg', 'Pending keeps the dedicated Decimator wheel');
    const mark = readFileSync(new URL('../../assets/decimator-draw-mark.svg', import.meta.url), 'utf8');
    assert.match(mark, /id="dec-green"/);
    assert.match(mark, /stroke="url\(#dec-green\)"[\s\S]*?transform="rotate\(90 32 32\)"/,
      'one bottom miniature wheel segment is visibly locked green');
    assert.match(mark, /M32 4\.8[\s\S]*?fill="url\(#dec-gold\)"/,
      'the top selector arrow remains gold');
    action.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(opened, 1);
    el.disconnectedCallback();
  });

  test('pins ready reveal work, delegates the click, and hides after its owner clears', async () => {
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    assert.equal(pendingSurfaceVisible(el), false);
    assert.ok(el.querySelector('[data-bind="rrt-stage"]'),
      'the contextual RNG instrument keeps a stable bottom shell');
    assert.equal(el.querySelector('[data-bind="rrt-rng"]').hidden, true,
      'an idle RNG shell does not manufacture any bottom-panel chrome');
    assert.equal(el.querySelector('[data-bind="rrt-rng-request"]').disabled, true,
      'the always-present control stays inert while the queue is not requestable');

    let ran = 0;
    pending.publishPendingActions('box', [{
      id: 'box:7', kind: 'lootbox', label: 'Luckbox #7', shortLabel: 'Open box',
      detail: 'Prizes ready', state: 'ready',
      run: async () => {
        ran += 1;
        pending.clearPendingActions('box');
      },
    }]);
    const shell = el.querySelector('[data-bind="rrt-tray"]');
    assert.equal(pendingSurfaceVisible(el), true);
    assert.equal(el.querySelectorAll('.rrt-action').length, 1);
    assert.ok(el.querySelector('.rrt-action--lootbox')?.querySelector('.rrt-action__glyph'),
      'a ready lootbox has a recognizable box icon');
    el.querySelector('.rrt-action').dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(ran, 1);
    assert.equal(pendingSurfaceVisible(el), false);
    el.disconnectedCallback();
  });

  test('waiting rows never pin the tray over the app', () => {
    pending.publishPendingActions('pack', [{
      id: 'pack:1', kind: 'tickets', label: 'Ticket pack', state: 'waiting',
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    assert.equal(pendingSurfaceVisible(el), false);
    el.disconnectedCallback();
  });

  test('an unresolved bought pack is a small passive receipt, then promotes to its opener', () => {
    store.update('app.lastDay', { roll1: { purchaseLevel: 76 } });
    pending.publishPendingActions('pack', [{
      id: 'ticket-packs:pending', kind: 'tickets',
      label: '4 TICKETS PENDING', detail: 'Queued before the next jackpot',
      ticketCount: 4,
      state: 'waiting', pinned: true, passive: true, compact: true,
      pendingPacks: [{ level: 77, count: 4, foilPack: false }],
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    let action = el.querySelector('.rrt-action--pack-pending');
    assert.ok(action, 'the bought pack remains visible while its traits are unresolved');
    assert.equal(action.tagName, 'BUTTON', 'the receipt opens a read-only pack preview');
    assert.equal(action.disabled, false, 'viewing pending packs is never transaction-locked');
    assert.equal(action.getAttribute('aria-expanded'), 'false');
    assert.equal(action.querySelector('.rrt-pack-pending__count').textContent, '4',
      'the collapsed receipt keeps only the useful quantity');
    assert.equal(action.querySelector('.rrt-ticket-level'), null,
      'ticket level waits for the expanded dropdown');
    assert.equal(action.querySelector('.rrt-pack-pending__state').textContent, 'Tickets');
    assert.ok(action.querySelector('.rrt-pending-pack-art'),
      'the receipt uses a tiny generic pack icon');
    assert.ok(action.querySelector('.rrt-pending-pack-art')?.querySelector('.rvl-pack-brand'),
      'even the tiny pending silhouette retains the branded plaque');
    assert.equal(action.querySelector('.rvl-pack-logo')?.src, '/whitepaper/flame-logo.svg');
    assert.equal(action.querySelector('.rrt-pending-pack-art')?.querySelector('.rvl-pack-edition')?.textContent,
      'TICKET PACK');
    assert.equal(action.querySelector('.rrt-action__cta'), null,
      'there is no fake WAITING action');
    assert.equal(el.querySelector('[data-bind="rrt-count"]'), null,
      'the header does not repeat needless action and pending counts');
    assert.equal(el.querySelector('[data-bind="rrt-clear"]').hidden, false,
      'CLEAR can permanently dismiss passive protocol reminders too');

    action.dispatchEvent({ type: 'click' });
    const details = el.querySelector('[data-bind="rrt-pending-details"]');
    assert.equal(details.hidden, false);
    assert.equal(details.querySelectorAll('.rrt-pending-pack-preview').length, 1);
    assert.equal(details.querySelector('.rvl-pack-level').textContent, 'LEVEL 77');
    assert.equal(details.querySelector('.rvl-pack-level').getAttribute('data-ticket-level-tone'), 'blue');
    assert.equal(details.querySelector('.rrt-pending-pack-preview__art').getAttribute('data-pack-level-tone'), 'blue');
    assert.equal(details.querySelector('.rvl-pack-count').textContent, '4 TICKETS');
    assert.equal(details.querySelector('.rrt-pending-pack-preview__caption'), null,
      'one pack needs no redundant status caption below its on-pack ticket count');
    assert.doesNotMatch(details.textContent, /PACKS ON THE WAY|PENDING/i,
      'the dropdown relies on its enclosing Pending surface instead of repeating status copy');

    pending.publishPendingActions('pack', [{
      id: 'ticket-pack:77', kind: 'tickets', label: 'Level 77 ticket pack',
      shortLabel: 'Open tickets', detail: '4 tickets ready',
      ticketLevel: 77, ticketCount: 4, state: 'ready', run: async () => {},
    }]);
    action = el.querySelector('.rrt-action--tickets');
    assert.equal(action.tagName, 'BUTTON');
    assert.equal(action.disabled, false);
    assert.ok(action.querySelector('.rrt-pack-art'),
      'the resolved receipt promotes into the normal pack opener');
    assert.equal(action.querySelector('.rrt-action__cta'), null,
      'the lit clickable pack does not repeat the self-evident OPEN action');
    assert.match(action.className, /\brrt-action--ticket-ready\b/);
    assert.equal(action.querySelector('.rrt-action__label').textContent, '4 Lvl 77\nTickets');
    assert.equal(action.querySelector('.rrt-ticket-level').getAttribute('data-ticket-level-tone'), 'blue');
    assert.equal(action.querySelector('.rrt-pack-level').getAttribute('data-ticket-level-tone'), 'blue');
    assert.equal(action.querySelector('.rrt-pack-art').getAttribute('data-pack-level-tone'), 'blue');
    el.disconnectedCallback();
  });

  test('CLEAR dismisses a pending pack and its eventual per-level opener', async () => {
    pending.publishPendingActions('pack', [{
      id: 'ticket-packs:pending', kind: 'tickets', label: '3 TICKETS PENDING',
      ticketCount: 3, state: 'waiting', pinned: true, passive: true, compact: true,
      pendingPacks: [{ level: 77, count: 3, foilPack: false }],
      dismissIds: ['ticket-pack:77'],
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    const clear = el.querySelector('[data-bind="rrt-clear"]');
    assert.equal(clear.hidden, false);
    clear.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(pendingSurfaceVisible(el), false);

    pending.publishPendingActions('pack', [{
      id: 'ticket-pack:77', kind: 'tickets', label: 'Level 77 ticket pack',
      ticketLevel: 77, ticketCount: 3, state: 'ready', run: async () => {},
    }]);
    assert.equal(pendingSurfaceVisible(el), false,
      'the cleared waiting hand cannot return under its ready opener id');
    el.disconnectedCallback();
  });

  test('pending pack dropdown consolidates one level without status filler', () => {
    pending.publishPendingActions('pack', [{
      id: 'ticket-packs:pending', kind: 'tickets', label: '12 TICKETS PENDING',
      ticketCount: 12, state: 'waiting', pinned: true, passive: true, compact: true,
      pendingPacks: [{ level: 77, count: 12, foilPack: false }],
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    el.querySelector('.rrt-action--pack-pending').dispatchEvent({ type: 'click' });

    const details = el.querySelector('[data-bind="rrt-pending-details"]');
    assert.deepEqual(
      details.querySelectorAll('.rvl-pack-count')
        .map((node) => node.textContent),
      ['12 TICKETS'],
      'one level carries one authoritative pending quantity',
    );
    assert.equal(details.querySelector('.rrt-pending-pack-preview__caption'), null);
    assert.doesNotMatch(details.textContent, /PACKS ON THE WAY|PENDING/i);
    el.disconnectedCallback();
  });

  test('one static RNG control lights for requests and visualizes Chainlink fulfillment', async () => {
    const base = {
      id: 'degenerette:42', kind: 'degenerette', label: '1 spin',
      amountLabel: '0.025 ETH', spinCount: 1,
      ticketPacked: '0x1b3a0900', heroQuadrant: 2, pinned: true,
    };
    pending.publishPendingActions('context', [{
      id: 'growth:context', kind: 'growth-claim', label: 'Growth payout',
      state: 'ready', run: async () => {},
    }]);
    pending.publishPendingActions('degenerette', [{
      ...base,
      shortLabel: 'Waiting for RNG', detail: 'Waiting for request window',
      state: 'waiting', phase: 'awaitingRng', progress: 'indeterminate',
      rngQueuePendingMilliEth: '420', rngQueueThresholdMilliEth: '1000',
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const lane = el.querySelector('[data-bind="rrt-rng"]');
    const request = el.querySelector('[data-bind="rrt-rng-request"]');
    const art = el.querySelector('[data-bind="rrt-rng-art"]');
    const artPath = () => art.getAttribute('src');
    const dots = () => el.querySelectorAll('.rrt-rng__step');
    assert.equal(pendingSurfaceVisible(el), true,
      'real non-ticket work gives the populated RNG lane a Pending surface');
    assert.equal(lane.hidden, false);
    assert.equal(lane.getAttribute('data-rng-phase'), 'queued');
    assert.equal(request.disabled, true);
    assert.equal(el.querySelector('[data-bind="rrt-rng-status"]').textContent,
      'MID-DAY RNG QUEUE · 0.42/1 ETH');
    assert.equal(dots().length, 5, 'five larger bubbles summarize RNG progress');
    assert.equal(dots().filter((dot) => /is-complete/.test(dot.className)).length, 3,
      'the five blue bubbles fill from the real shared ETH queue ratio');
    assert.doesNotMatch(dots()[0].className, /is-complete/);
    assert.match(dots()[4].className, /is-complete/,
      'queue progress starts at the bottom and rises');
    assert.equal(request.getAttribute('data-rng-button-state'), 'waiting',
      'the state artwork says WAITING while the free request is still charging');
    assert.equal(artPath(), '/app/assets/rng-chainlink-waiting.svg');
    assert.equal(dots().filter((dot) => /is-active/.test(dot.className)).length, 0,
      'a partially filled queue stays static');
    assert.ok(el.querySelector('.rrt-action--degenerette'),
      'the bought spin remains visible while the RNG rail reports its progress');
    const pendingSpin = el.querySelector('.rrt-action--degenerette');
    assert.match(pendingSpin.className, /rrt-action--compact/);
    assert.equal(pendingSpin.querySelector('.rrt-degenerette-summary__amount').textContent,
      '0.025 ETH');
    assert.equal(pendingSpin.querySelector('.rrt-degenerette-summary__count').textContent, '×1');
    const spinSummaryParts = pendingSpin.querySelector('.rrt-degenerette-summary').children;
    assert.match(spinSummaryParts[0].textContent, /ETH$/);
    assert.equal(spinSummaryParts[1].textContent, '×1');
    assert.equal(spinSummaryParts[2].textContent, 'SPIN');
    assert.equal(pendingSpin.querySelector('.rrt-degenerette-summary__box'), null,
      'the pending spin count has no redundant leading icon');
    assert.equal(pendingSpin.querySelector('.rrt-action__progress'), null);
    assert.equal(pendingSpin.querySelector('.rrt-action__cta'), null);
    assert.doesNotMatch(pendingSpin.className, /is-rng-waiting/,
      'the spin receipt stays neutral before an RNG request exists');
    assert.equal(el.querySelector('[data-bind="rrt-title"]'), null,
      'the obsolete Pending/RNG heading is not rendered');
    assert.equal(el.querySelector('.rrt-head'), null,
      'the old logo header has been removed');

    let requests = 0;
    let finishRequest = null;
    pending.publishPendingActions('degenerette', [{
      ...base,
      shortLabel: 'Waiting for RNG', detail: 'Queue full; request gate unavailable',
      state: 'waiting', phase: 'awaitingRng', progress: 'indeterminate',
      rngQueuePendingMilliEth: '1000', rngQueueThresholdMilliEth: '1000',
    }]);
    assert.equal(lane.getAttribute('data-rng-phase'), 'queue-ready');
    assert.match(request.className, /is-lit/,
      'a full queue lights the Chainlink mark even before this wallet can submit');
    assert.doesNotMatch(request.className, /is-requestable/);
    assert.equal(request.disabled, true);
    assert.equal(request.getAttribute('data-rng-button-state'), 'waiting',
      'a full queue without an available request gate remains WAITING');
    assert.equal(artPath(), '/app/assets/rng-chainlink-waiting.svg');

    pending.publishPendingActions('degenerette', [{
      ...base,
      shortLabel: 'Request RNG', detail: 'RNG request ready',
      state: 'ready', phase: 'request-ready',
      run: async () => {
        requests += 1;
        await new Promise((resolve) => { finishRequest = resolve; });
      },
    }]);
    assert.equal(lane.getAttribute('data-rng-phase'), 'requestable');
    assert.equal(pendingSurfaceVisible(el), true);
    assert.equal(request.disabled, false);
    assert.match(request.className, /is-requestable/);
    assert.equal(dots().filter((dot) => /is-complete/.test(dot.className)).length, 5,
      'the full blue queue remains visible when its request gate opens');
    assert.equal(request.getAttribute('data-rng-button-state'), 'request');
    assert.equal(artPath(), '/app/assets/rng-chainlink-request.svg');
    assert.match(request.className, /is-state-request/);
    assert.equal(el.querySelector('.rrt-action--degenerette').disabled, true,
      'only the dedicated RNG button can submit the RNG request');
    assert.match(el.innerHTML, /class="rrt-rng__art"/,
      'the coupled Chainlink mark, RNG label, and state use one fixed asset');
    assert.equal(el.querySelector('[data-bind="rrt-rng-button-label"]'), null,
      'the old verbose request label stays removed');
    assert.equal(request.getAttribute('aria-label'), 'Request shared RNG',
      'the icon retains a readable accessible action name');
    request.dispatchEvent({ type: 'click' });
    await Promise.resolve();
    assert.equal(requests, 1, 'the stable RNG button delegates the real publisher action');
    assert.match(request.className, /is-requesting/,
      'the Chainlink logo spins only while the request transaction is in flight');
    assert.equal(request.getAttribute('data-rng-button-state'), 'incoming');
    assert.equal(artPath(), '/app/assets/rng-chainlink-incoming.svg');
    assert.match(request.className, /is-state-incoming/);
    assert.doesNotMatch(request.className, /is-request-complete/);
    assert.equal(dots().filter((dot) => /is-complete/.test(dot.className)).length, 0,
      'the queue lights clear while the request transaction is pending');

    finishRequest();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.doesNotMatch(request.className, /is-requesting/);
    assert.match(request.className, /is-request-complete/,
      'a confirmed request stops the spin and triggers the short green flash');
    assert.equal(dots().filter((dot) => /is-complete/.test(dot.className)).length, 1,
      'the receipt immediately hands progress to the first green block light');
    assert.match(dots()[4].className, /is-complete/,
      'the first incoming light is the bottom light');
    assert.equal(request.getAttribute('data-rng-button-state'), 'incoming');
    assert.equal(artPath(), '/app/assets/rng-chainlink-incoming.svg');

    pending.publishPendingActions('degenerette', [{
      ...base,
      shortLabel: 'Waiting for RNG', detail: 'RNG requested · waiting for Chainlink result',
      state: 'waiting', phase: 'waiting-rng', progress: 'indeterminate',
      rngRequestBlock: 100, rngCurrentBlock: 100, rngConfirmations: 10,
    }]);
    assert.equal(dots().filter((dot) => /is-complete/.test(dot.className)).length, 1,
      'the confirmed request clears the blue queue and lights only the bottom dot');
    assert.equal(lane.style['--rrt-rng-progress-color'], 'hsl(120 78% 52%)',
      'the first incoming confirmation is green');

    pending.publishPendingActions('degenerette', [{
      ...base,
      shortLabel: 'Waiting for RNG', detail: 'RNG requested · waiting for Chainlink result',
      state: 'waiting', phase: 'waiting-rng', progress: 'indeterminate',
      rngRequestBlock: 100, rngCurrentBlock: 104, rngConfirmations: 10,
    }]);
    assert.ok(el.querySelector('.rrt-action--degenerette'),
      'the spin receipt survives the submitted-to-incoming RNG handoff');
    assert.equal(lane.getAttribute('data-rng-phase'), 'fulfilling');
    assert.equal(request.disabled, true, 'fulfillment cannot submit a duplicate request');
    assert.equal(dots().filter((dot) => /is-complete/.test(dot.className)).length, 2,
      'five of ten confirmations fill half of the four progress bubbles');
    assert.equal(lane.style['--rrt-rng-progress-color'], 'hsl(120 78% 52%)',
      'all lit incoming bubbles stay the same green');
    assert.equal(dots().filter((dot) => /is-active/.test(dot.className)).length, 0,
      'block confirmations advance without a perpetual pulse');
    assert.doesNotMatch(dots()[0].className, /is-complete/,
      'the top bubble remains reserved for actual fulfillment');
    assert.equal(el.querySelector('[data-bind="rrt-rng-status"]').textContent,
      'WAITING FOR CHAINLINK · 5/10 BLOCKS');

    pending.publishPendingActions('degenerette', [{
      ...base,
      shortLabel: 'Degenerette spin', detail: 'RNG ready · FLIP result locked',
      state: 'ready', phase: 'result-ready', run: async () => {},
    }]);
    assert.equal(pendingSurfaceVisible(el), true,
      'the actual resolvable result expands the containing Pending surface');
    assert.equal(lane.getAttribute('data-rng-phase'), 'fulfilled');
    assert.equal(dots().filter((dot) => /is-complete/.test(dot.className)).length, 5);
    assert.equal(lane.style['--rrt-rng-progress-color'], 'hsl(120 78% 52%)',
      'fulfilled RNG retains the same green used while incoming');
    assert.match(dots()[0].className, /is-complete/,
      'the top bubble turns on with the resolvable result');
    assert.equal(request.getAttribute('data-rng-button-state'), 'ready',
      'the completed rail explicitly reports RNG READY beside the resolvable action');
    assert.equal(artPath(), '/app/assets/rng-chainlink-ready.svg');
    const action = el.querySelector('.rrt-action--degenerette');
    assert.match(action.className, /is-result-ready/);
    assert.match(action.className, /rrt-action--compact/,
      'the ready receipt stays as tight as its waiting form');
    assert.equal(action.disabled, false);
    assert.equal(action.querySelector('.rrt-degenerette-summary__amount').textContent, '0.025 ETH');
    assert.equal(action.querySelector('.rrt-degenerette-summary__count').textContent, '×1');
    assert.equal(action.querySelector('.rrt-action__cta'), null,
      'the entire lit card is clickable without a redundant VIEW label');
    const ticket = action.querySelector('.rrt-degenerette-ticket');
    assert.match(ticket.className, /ticket-card/,
      'the ready action retains the submitted ticket as its icon');
    const badges = ticket.querySelectorAll('.rrt-degenerette-ticket__badge');
    assert.deepEqual(badges.map((badge) => badge.src), [
      '/badges-circular/crypto_00_xrp_pink.svg',
      '/badges-circular/zodiac_01_taurus_purple.svg',
      '/badges-circular/cards_05_heart_gold.svg',
      '/badges-circular/dice_03_4_red.svg',
    ], 'the icon copies all four submitted ticket graphics');
    assert.match(ticket.children[2].className, /q-hero/,
      'the submitted Hero quadrant is preserved in the mini ticket');
    assert.equal(ticket.querySelector('.rrt-degenerette-ticket__center-mark')?.src,
      '/whitepaper/flame-center.svg', 'the real ticket center mark is present');

    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css, /\.rrt-action__art--degenerette\s*\{[^}]*width:\s*2\.42rem;[^}]*height:\s*2\.42rem/s,
      'the Degenerette art leaves vertical breathing room inside its fixed-height row');
    assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.rrt-action--degenerette \.rrt-action__art\s*\{[^}]*width:\s*2\.12rem;[^}]*height:\s*2\.12rem/s,
      'the narrow Degenerette art stays below the row content height');
    assert.match(css, /\.rrt-action--degenerette\.is-result-ready\s*\{[^}]*animation:\s*rrt-degenerette-ready-glow/s);
    assert.match(css, /\.rrt-degenerette-summary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto auto[^}]*row-gap:\s*0\.06rem/s,
      'ETH and the spin receipt occupy two tightly spaced rows');
    assert.match(css, /\.rrt-degenerette-summary__amount\s*\{[^}]*grid-column:\s*1 \/ -1/s,
      'the ETH amount owns its line above the spin count');
    assert.match(css, /\.rrt-rng__request\.is-requestable\s*\{[^}]*animation:\s*rrt-rng-requestable/s);
    assert.match(css, /\.rrt-rng__request\.is-requesting \.rrt-rng__art\s*\{[^}]*animation:\s*rrt-rng-art-pending 1\.7s ease-in-out infinite/s,
      'only an in-flight request gives the fixed state artwork a restrained pulse');
    assert.match(css, /\.rrt-rng__request\.is-request-complete\s*\{[^}]*animation:\s*rrt-rng-request-complete 0\.7s ease-out 1/s,
      'request confirmation has one short green flash');
    assert.match(css,
      /\.rrt-tray\[data-has-pending="true"\] \.rrt-rng\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0\.62rem;[^}]*left:\s*0\.55rem/s,
      'the RNG instrument is integrated into the left edge of Pending');
    assert.match(css, /\.rrt-rng\s*\{[^}]*height:\s*var\(--rrt-row-height, 3\.2rem\);[^}]*grid-template-columns:\s*0\.5rem 3\.65rem/s,
      'the larger bubble rail is the left column and the branded button follows');
    assert.match(css, /\.rrt-rng__request\s*\{[^}]*width:\s*3\.65rem;[^}]*height:\s*100%;[^}]*linear-gradient/s,
      'the fixed Chainlink artwork fills one deliberately surfaced row-height button');
    assert.match(css,
      /\.rrt-rng__art\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain/s,
      'the coupled static artwork scales as one unit without clipping its state copy');
    assert.match(css,
      /\.rrt-rng__brand\s*\{[^}]*height:\s*100%;[^}]*align-self:\s*stretch/s,
      'the coupled Chainlink/RNG image and its bubbles share one normal row height');
    assert.match(css, /\.rrt-rng__request\s*\{[^}]*height:\s*100%/s,
      'the button fills only its compact coupled brand unit');
    assert.match(css, /\.rrt-rng\[hidden\]\s*\{\s*display:\s*none !important/s,
      'an empty RNG lane cannot be restored by its author display rule');
    for (const state of ['idle', 'waiting', 'request', 'incoming']) {
      const svg = readFileSync(new URL(`../../assets/rng-chainlink-${state}.svg`, import.meta.url), 'utf8');
      assert.match(svg, /viewBox="0 0 72 58"/);
      assert.match(svg, />RNG<\/text>/, `${state} has a legible fixed RNG label`);
      assert.match(svg, /<path[^>]*d="M17\.5 3\.5 27 9v11l-9\.5 5\.5L8 20V9l9\.5-5\.5/s,
        `${state} keeps the Chainlink mark compact at the left of the label`);
      assert.match(svg, /<path[^>]*transform="translate\(-2 0\)"/,
        `${state} nudges only the Chainlink mark two pixels left`);
      assert.match(svg, /<text x="47" y="22"[^>]*font-size="15\.5"[^>]*>RNG<\/text>/s,
        `${state} gives RNG the larger top-row type`);
    }
    for (const [state, label] of [['waiting', 'WAITING'], ['request', 'REQUEST'], ['incoming', 'INCOMING']]) {
      const svg = readFileSync(new URL(`../../assets/rng-chainlink-${state}.svg`, import.meta.url), 'utf8');
      assert.match(svg, new RegExp(`font-size="9\\.8"[^>]*>${label}<\\/text>`),
        `${state} uses the enlarged second-row state`);
    }
    assert.match(css, /data-rng-mode="queue"[^}]*\.rrt-rng__step\.is-complete\s*\{[^}]*background:\s*#2a5ada/s,
      'queue fill uses static Chainlink-blue dots');
    assert.match(css, /data-rng-mode="confirmations"[^}]*\.rrt-rng__step\.is-complete\s*\{[^}]*background:\s*var\(--rrt-rng-progress-color/s,
      'every lit incoming confirmation shares the same green progress color');
    assert.doesNotMatch(css, /\.rrt-rng__step\.is-complete\s*\{[^}]*animation:/s,
      'lit dots do not animate between real block changes');
    el.disconnectedCallback();
  });

  test('a failed shared RNG request follows the winning request instead of showing an error', async () => {
    pending.publishPendingActions('context', [{
      id: 'growth:rng-race', kind: 'growth-claim', label: 'Growth payout',
      state: 'ready', run: async () => {},
    }]);
    pending.publishPendingActions('degenerette', [{
      id: 'degenerette:rng-race', kind: 'degenerette', label: '1 spin',
      state: 'ready', phase: 'request-ready', pinned: true,
      run: async () => { throw new Error('request already fulfilled'); },
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const request = el.querySelector('[data-bind="rrt-rng-request"]');
    const lane = el.querySelector('[data-bind="rrt-rng"]');
    const error = el.querySelector('[data-bind="rrt-error"]');
    request.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    assert.equal(request.getAttribute('data-rng-button-state'), 'incoming');
    assert.equal(request.disabled, true, 'the raced wallet cannot submit a duplicate request');
    assert.equal(lane.getAttribute('data-rng-phase'), 'fulfilling');
    assert.equal(el.querySelectorAll('.rrt-rng__step')
      .filter((dot) => /is-complete/.test(dot.className)).length, 1,
    'INCOMING lights the first green bubble even before block metadata arrives');
    assert.equal(el.querySelector('[data-bind="rrt-rng-art"]').getAttribute('src'),
      '/app/assets/rng-chainlink-incoming.svg');
    assert.equal(error.hidden, true,
      'a shared-request race is not presented as a failed player action');
    assert.doesNotMatch(request.className, /is-request-complete/,
      'only this wallet receiving a successful receipt gets the green confirmation flash');
    el.disconnectedCallback();
  });

  test('shows the RNG lane only when it contains relevant player or jackpot RNG work', () => {
    pending.publishPendingActions('tickets', [{
      id: 'ticket-pack:91', kind: 'tickets', label: 'Level 91 ticket pack',
      state: 'waiting', pinned: true, passive: true,
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const tray = el.querySelector('[data-bind="rrt-tray"]');
    const lane = el.querySelector('[data-bind="rrt-rng"]');
    assert.equal(pendingSurfaceVisible(el), true);
    assert.equal(lane.hidden, true, 'a ticket-only Pending panel does not show empty RNG chrome');
    assert.equal(tray.getAttribute('data-has-rng'), 'false');

    pending.publishPendingActions('context', [{
      id: 'growth:91', kind: 'growth-claim', label: 'Growth payout',
      state: 'ready', run: async () => {},
    }]);
    assert.equal(lane.hidden, true,
      'ordinary non-ticket work alone is not enough—the RNG lane must contain RNG state');

    pending.publishPendingActions('degenerette', [{
      id: 'degenerette:91', kind: 'degenerette', label: '1 spin',
      state: 'waiting', phase: 'awaitingRng', pinned: true,
      rngQueuePendingMilliEth: '250', rngQueueThresholdMilliEth: '1000',
    }]);
    assert.equal(lane.hidden, false,
      'player RNG work fills the lane when the Pending panel already has real non-ticket work');
    assert.equal(tray.getAttribute('data-has-rng'), 'true');

    pending.clearPendingActions('context');
    assert.equal(pendingSurfaceVisible(el), true, 'the pending ticket still keeps its own panel visible');
    assert.equal(lane.hidden, false,
      'the bought spin is itself real pending work, so its queued RNG status stays visible');

    pending.publishPendingActions('degenerette', [{
      id: 'degenerette:91', kind: 'degenerette', label: '1 spin',
      state: 'waiting', phase: 'waiting-rng', pinned: true,
      rngRequestBlock: 500, rngCurrentBlock: 501, rngConfirmations: 10,
    }]);
    assert.equal(lane.hidden, false,
      'an in-flight request remains visible when this player has work that it will resolve');
    assert.equal(el.querySelector('[data-bind="rrt-rng-request"]')
      .getAttribute('data-rng-button-state'), 'incoming');

    pending.clearPendingActions('degenerette');
    assert.equal(lane.hidden, true);
    store.update('game.phase', 'JACKPOT');
    store.update('game.rngLocked', true);
    assert.equal(lane.hidden, false,
      'an active jackpot RNG request is the explicit ticket-only/global exception');
    assert.equal(tray.getAttribute('data-has-rng'), 'true');

    store.update('game.rngLocked', false);
    assert.equal(lane.hidden, true, 'the jackpot exception disappears as soon as its request settles');
    el.disconnectedCallback();
  });

  test('the top-bar AUTO preference live-updates Pending and runs only presentation-safe resolved work', async () => {
    let ran = 0;
    pending.publishPendingActions('pack', [{
      id: 'ticket-pack:77', kind: 'tickets', label: 'Level 77 ticket pack',
      detail: 'Waiting for the Level 77 draw', state: 'waiting', pinned: true,
      autoOpen: true,
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    assert.equal(el.querySelector('[data-bind="rrt-auto-open"]'), null,
      'Pending no longer duplicates the top-bar preference');
    uiPreferences.writeRevealAutoOpenPreference(true);
    assert.equal(localStorage.getItem('degenerus:reveal-tray:auto-open:v1'), '1');
    await Promise.resolve();
    assert.equal(ran, 0, 'a waiting row is never run');

    pending.publishPendingActions('pack', [{
      id: 'ticket-pack:77', kind: 'tickets', label: 'Level 77 ticket pack',
      detail: '4 tickets ready', state: 'ready', autoOpen: true,
      run: async () => {
        ran += 1;
        pending.clearPendingActions('pack');
      },
    }]);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    assert.equal(ran, 1, 'the resolved presentation opens once as soon as it becomes ready');

    assert.equal(trayModule.canAutoOpenReveal({
      state: 'ready', autoOpen: false, run() {},
    }), false, 'wallet/write work cannot opt itself in accidentally');
    assert.equal(trayModule.canAutoOpenReveal({
      state: 'ready', autoOpen: true, phase: 'indexing', run() {},
    }), false, 'a claimed result still indexing cannot enter an automatic retry loop');
    el.disconnectedCallback();
  });

  test('a waiting lootbox says auto-open is armed and explains inert clicks', () => {
    localStorage.setItem('degenerus:reveal-tray:auto-open:v1', '1');
    pending.publishPendingActions('box', [{
      id: 'box:syncing', kind: 'lootbox', compact: true,
      label: 'Luckbox purchase', lootboxLabel: 'LOOTBOX PURCHASE',
      amountLabel: '0.16 ETH', detail: 'Result syncing',
      state: 'waiting', phase: 'indexing', pinned: true, autoOpen: true,
      run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--lootbox-summary');
    assert.equal(action.disabled, false, 'the status row can explain itself instead of eating clicks');
    assert.match(action.className, /is-auto-armed/);
    assert.equal(action.querySelector('.rrt-auto-armed').textContent, 'AUTO-OPEN WHEN READY');
    assert.doesNotMatch(action.textContent, /purchase/i);
    action.dispatchEvent({ type: 'click' });
    assert.match(el.querySelector('[data-bind="rrt-error"]').textContent, /No click is needed/i);
    el.disconnectedCallback();
  });

  test('action failures use a separate alert bubble outside the Pending panel', () => {
    pending.publishPendingActions('box', [{
      id: 'box:failed', kind: 'lootbox', compact: true,
      label: 'Luckbox', amountLabel: '0.04 ETH', state: 'ready', run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    pending.reportPendingActionError('Transaction cancelled.');

    const stage = el.querySelector('[data-bind="rrt-stage"]');
    const tray = el.querySelector('[data-bind="rrt-tray"]');
    const error = el.querySelector('[data-bind="rrt-error"]');
    assert.equal(error.textContent, 'Transaction cancelled.');
    assert.equal(error.hidden, false);
    assert.equal(stage.getAttribute('data-has-error'), 'true');
    assert.equal(tray.getAttribute('data-has-error'), null,
      'the Pending card no longer absorbs transaction errors');

    const source = readFileSync(new URL('../app-reveal-tray.js', import.meta.url), 'utf8');
    const shell = source.slice(source.indexOf('#renderShell()'), source.indexOf('#beginRngRequestFlash'));
    assert.ok(shell.indexOf('class="rrt-error"') < shell.indexOf('<aside class="rrt-tray"'),
      'the alert bubble is a stage sibling rendered above Pending');
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css, /\.rrt-stage\s*\{[^}]*display:\s*grid[^}]*gap:/s);
    assert.match(css, /\.rrt-error\s*\{[^}]*border:[^}]*background:[^}]*box-shadow:/s,
      'the standalone error has its own bordered toast treatment');
    assert.doesNotMatch(css, /\.rrt-tray\[data-has-pending="false"\]\[data-has-error="true"\]/,
      'the old error-inside-Pending fallback is gone');
    el.disconnectedCallback();
  });

  test('one unresolved auto-open replay cannot block the next ready result', async () => {
    localStorage.setItem('degenerus:reveal-tray:auto-open:v1', '1');
    const runs = [];
    pending.publishPendingActions('box', [
      {
        id: 'box:stale', kind: 'lootbox', compact: true, label: 'Luckbox',
        state: 'ready', autoOpen: true, run: async () => { runs.push('stale'); return false; },
      },
      {
        id: 'box:next', kind: 'lootbox', compact: true, label: 'Luckbox',
        state: 'ready', autoOpen: true,
        run: async () => { runs.push('next'); pending.clearPendingActions('box'); },
      },
    ]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    assert.deepEqual(runs, ['stale', 'next'],
      'a syncing receipt yields the automatic continuation lane immediately');
    el.disconnectedCallback();
  });

  test('OPEN WHEN READY waits through major draw motion and its cooldown; manual opens still run', async () => {
    let ran = 0;
    localStorage.setItem('degenerus:reveal-tray:auto-open:v1', '1');
    drawGate.setMajorDrawActivity('jackpot-replay', true);
    pending.publishPendingActions('box', [{
      id: 'box:88', kind: 'lootbox', label: 'Luckbox #88',
      detail: 'Result ready', state: 'ready', autoOpen: true,
      run: async () => {
        ran += 1;
        pending.clearPendingActions('box');
      },
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(ran, 0, 'the jackpot animation prevents an automatic popup');

    const settledAt = Date.now();
    drawGate.setMajorDrawActivity('jackpot-replay', false);
    assert.equal(drawGate.isAutomaticPopupBlocked(settledAt + 9_999), true);
    assert.equal(drawGate.isAutomaticPopupBlocked(settledAt + 10_001), false,
      'the automatic gate includes a ten-second quiet window');
    el.querySelector('.rrt-action').dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(ran, 1, 'an explicit click is never blocked by the automatic-popup gate');
    el.disconnectedCallback();
  });

  test('an sDGNRS redemption stays pinned while its daily roll is pending', () => {
    pending.publishPendingActions('sdgnrs-redemptions', [{
      id: 'sdgnrs-redemption:period:67', kind: 'lootbox',
      kindLabel: 'sDGNRS REDEMPTION', label: '120M sDGNRS REDEMPTION',
      amountLabel: '120M sDGNRS', lootboxLabel: 'REDEMPTION', compact: true,
      shortLabel: 'Claim & open', detail: 'Waiting for the daily RNG result',
      state: 'waiting', pinned: true, progress: 'indeterminate',
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--lootbox');
    assert.equal(pendingSurfaceVisible(el), true);
    assert.equal(action.querySelector('.rrt-lootbox-summary__amount').textContent, '120M sDGNRS');
    assert.equal(action.querySelector('.rrt-lootbox-summary__unit').textContent, 'REDEMPTION');
    assert.equal(action.querySelector('.rrt-action__kind'), null,
      'the compact redemption omits its redundant kind line');
    assert.equal(action.querySelector('.rrt-action__cta'), null,
      'the compact redemption omits the redundant WAITING footer');
    assert.equal(action.querySelector('.rrt-action__progress'), null,
      'the shared RNG rail owns fulfillment progress instead of duplicating it in the row');
    assert.equal(el.querySelector('[data-bind="rrt-rng"]').getAttribute('data-rng-phase'),
      'fulfilling');
    assert.equal(el.querySelector('[data-bind="rrt-rng-status"]').textContent,
      'WAITING FOR RNG', 'a generic daily wait does not claim a Chainlink request was submitted');
    assert.equal(action.disabled, false,
      'the terse waiting receipt remains clickable for its compact status explanation');
    el.disconnectedCallback();
  });

  test('live RNG work outranks an already-fulfilled result in the shared rail', () => {
    pending.publishPendingActions('degenerette', [{
      id: 'degenerette:42', kind: 'degenerette', label: '1 spin',
      detail: 'RNG ready', state: 'ready', phase: 'result-ready', run: async () => {},
    }]);
    pending.publishPendingActions('box', [{
      id: 'lootbox:9', kind: 'lootbox', label: 'Luckbox #9',
      detail: 'Waiting for RNG · Day 71', state: 'waiting', pinned: true,
      progress: 'indeterminate',
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    assert.equal(el.querySelector('[data-bind="rrt-rng"]').getAttribute('data-rng-phase'),
      'fulfilling');
    assert.equal(el.querySelector('[data-bind="rrt-rng-status"]').textContent,
      'WAITING FOR RNG');
    assert.ok(el.querySelector('.rrt-action--degenerette'),
      'the ready result remains independently actionable');
    assert.ok(el.querySelector('.rrt-action--lootbox'),
      'the waiting item keeps its compact context row');
    el.disconnectedCallback();
  });

  test('a Degenerette result remains visible as a non-RNG loading row while spins index', () => {
    pending.publishPendingActions('degenerette', [{
      id: 'degenerette:42', kind: 'degenerette', label: '3 spins',
      shortLabel: 'Loading spins', detail: 'Loading every verified spin',
      ticketPacked: '0x1b3a0900', heroQuadrant: 2,
      state: 'waiting', phase: 'indexing', pinned: true,
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--degenerette');
    assert.ok(action, 'the chain/indexer handoff cannot disappear from the tray');
    assert.doesNotMatch(action.className, /is-rng-waiting/);
    assert.match(action.className, /rrt-action--compact/);
    assert.equal(action.querySelector('.rrt-action__cta'), null,
      'the compact pending receipt has no redundant right-side status');
    assert.equal(action.querySelector('.rrt-action__progress'), null,
      'the compact pending receipt has no random indeterminate bar');
    assert.equal(el.querySelector('[data-bind="rrt-rng"]').getAttribute('data-rng-phase'),
      'fulfilled');
    assert.equal(el.querySelector('[data-bind="rrt-title"]'), null);
    assert.ok(el.querySelector('[data-bind="rrt-controls"]'),
      'loading work keeps the compact controls without restoring a heading');
    el.disconnectedCallback();
  });

  test('a ready growth payout gets a dedicated CLAIM action in the bottom tray', async () => {
    let claimed = 0;
    pending.publishPendingActions('pari', [{
      id: 'pari:growth:41', kind: 'growth-claim', label: 'GROWTH BET · Level 41',
      shortLabel: 'Claim', detail: 'OVER paid · 4,000 FLIP ready', state: 'ready',
      run: async () => {
        claimed += 1;
        pending.clearPendingActions('pari');
      },
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const shell = el.querySelector('[data-bind="rrt-tray"]');
    const action = el.querySelector('.rrt-action--growth-claim');
    assert.equal(pendingSurfaceVisible(el), true);
    assert.ok(action, 'growth payout is visible beside the other bottom actions');
    assert.equal(action.querySelector('.rrt-action__kind').textContent, 'GROWTH BET');
    assert.ok(action.querySelector('.rrt-action__art--growth-claim')
      .querySelector('.rrt-action__glyph'));
    assert.equal(action.querySelector('.rrt-action__label').textContent, 'GROWTH · L41');
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'CLAIM');

    action.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(claimed, 1);
    assert.equal(pendingSurfaceVisible(el), false);
    assert.equal(shell.hidden, false,
      'the shared shell remains mounted for the compact RNG-only state');
    el.disconnectedCallback();
  });

  test('a ready volume payout uses the same bottom-row CLAIM treatment', () => {
    pending.publishPendingActions('pari', [{
      id: 'pari:volume:100', kind: 'volume-claim', label: 'VOLUME BET',
      shortLabel: 'Claim', detail: 'UNDER paid · 2,250 FLIP ready', state: 'ready',
      run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--volume-claim');
    assert.ok(action);
    assert.equal(action.querySelector('.rrt-action__kind').textContent, 'VOLUME BET');
    assert.ok(action.querySelector('.rrt-action__art--volume-claim')
      .querySelector('.rrt-action__glyph'));
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'CLAIM');
    el.disconnectedCallback();
  });

  test('mass protocol work is a distinct resolver action, never the ticket-pack opener', async () => {
    let resolved = 0;
    pending.publishPendingActions('mine-flip-resolver', [{
      id: 'mine-flip:player', kind: 'mass-resolution',
      compact: true, label: 'Mine FLIP', shortLabel: 'Mine FLIP', detail: '',
      icon: '/whitepaper/flame-logo-split.svg',
      state: 'ready', write: true, run: async () => { resolved += 1; },
    }]);
    pending.publishPendingActions('pack', [{
      id: 'pack:62', kind: 'tickets', label: 'Level 62 ticket pack',
      shortLabel: 'Open tickets', detail: 'Waiting for the Level 62 draw',
      state: 'waiting', pinned: true,
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const resolver = el.querySelector('.rrt-action--mass-resolution');
    const pack = el.querySelector('.rrt-action--tickets');
    assert.ok(resolver, 'the bounty gets its own bottom action');
    assert.equal(resolver.querySelector('.rrt-action__label').textContent, 'MINE FLIP');
    const resolverArt = resolver.querySelector('.rrt-action__art--mass-resolution');
    assert.equal(
      resolverArt?.querySelector('img')?.src,
      '/whitepaper/flame-logo-split.svg',
      'Mine FLIP uses the FLIP mark instead of the protocol logo',
    );
    assert.equal(resolver.querySelector('.rrt-action__kind'), null);
    assert.equal(resolver.querySelector('.rrt-action__detail'), null);
    assert.equal(resolver.querySelector('.rrt-action__cta'), null);
    assert.notEqual(resolver.getAttribute('data-write'), null);
    assert.equal(resolver.disabled, false);
    assert.equal(pack.querySelector('.rrt-action__cta').textContent, 'WAITING');
    assert.equal(pack.disabled, true, 'the pack itself never sends the resolver transaction');

    resolver.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(resolved, 1);
    el.disconnectedCallback();
  });

  test('HIDE preserves every action and reopens only when the manifest changes', () => {
    const waiting = {
      id: 'degenerette:42', kind: 'degenerette', label: 'Degenerette',
      detail: 'Result indexed · loading spins', state: 'waiting',
      phase: 'indexing', pinned: true, progress: 'indeterminate',
    };
    pending.publishPendingActions('degenerette', [waiting]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const shell = el.querySelector('[data-bind="rrt-tray"]');
    const hide = el.querySelector('[data-bind="rrt-hide"]');
    assert.equal(pendingSurfaceVisible(el), true);
    assert.equal(hide.textContent, 'HIDE');
    hide.dispatchEvent({ type: 'click' });
    assert.equal(pendingSurfaceVisible(el), false, 'HIDE collapses the player-action surface');
    assert.equal(pending.getPendingActions().length, 1,
      'HIDE does not clear or dismiss the underlying work');

    pending.publishPendingActions('degenerette', [{ ...waiting }]);
    assert.equal(pendingSurfaceVisible(el), false,
      'an equivalent polling refresh does not nag the player again');

    pending.publishPendingActions('degenerette', [{
      ...waiting,
      state: 'ready',
      phase: 'result-ready',
      detail: 'RNG ready · result locked',
      progress: null,
      run: async () => {},
    }]);
    assert.equal(pendingSurfaceVisible(el), true,
      'a meaningful readiness update automatically brings the tray back');
    assert.equal(el.querySelector('.rrt-action--degenerette').disabled, false);
    el.disconnectedCallback();
  });

  test('CLEAR invokes each owner once and dismisses every current reveal row', async () => {
    let cleared = 0;
    const clearAll = async () => {
      cleared += 1;
      pending.clearPendingActions('box');
    };
    pending.publishPendingActions('box', [
      {
        id: 'box:7', kind: 'lootbox', label: 'Luckbox #7', state: 'ready',
        run: async () => {}, clearAll,
      },
      {
        id: 'box:8', kind: 'lootbox', label: 'Luckbox #8', state: 'ready',
        run: async () => {}, clearAll,
      },
    ]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    const clear = el.querySelector('[data-bind="rrt-clear"]');
    assert.equal(clear.hidden, false);
    assert.equal(clear.textContent, 'CLEAR');

    clear.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(cleared, 1, 'one publisher callback is not repeated per row');
    assert.equal(pendingSurfaceVisible(el), false);

    pending.publishPendingActions('box', [{
      id: 'box:7', kind: 'lootbox', label: 'Luckbox #7', detail: 'Now ready again',
      state: 'ready', run: async () => {},
    }]);
    assert.equal(pendingSurfaceVisible(el), false,
      'the same cleared id cannot return merely because a poll changed its state');

    pending.publishPendingActions('box', [
      {
        id: 'box:7', kind: 'lootbox', label: 'Luckbox #7', detail: 'Now ready again',
        state: 'ready', run: async () => {},
      },
      {
        id: 'box:9', kind: 'lootbox', label: 'Luckbox #9', detail: 'Genuinely new work',
        state: 'ready', run: async () => {},
      },
    ]);
    assert.equal(pendingSurfaceVisible(el), true);
    assert.equal(el.querySelectorAll('.rrt-action').length, 1);
    assert.equal(el.querySelector('.rrt-action').getAttribute('data-action-id'), 'box:9');
    el.disconnectedCallback();
  });

  test('ticket actions use a simplified readable pack instead of shrinking the full wrapper', () => {
    pending.publishPendingActions('pack', [{
      id: 'pack:62', kind: 'tickets', label: 'Level 62 ticket pack',
      ticketLevel: 62, ticketCount: 5,
      shortLabel: 'Open tickets', detail: '5 tickets ready', state: 'ready',
      run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    const art = el.querySelector('.rrt-action__art--tickets');
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.ok(art?.querySelector('.rrt-pack-art'), 'the button carries the opener pack art');
    assert.equal(el.querySelector('.rrt-action__label').textContent, '5 Lvl 62\nTickets');
    assert.equal(el.querySelector('.rrt-action__cta'), null,
      'ready ticket packs use their glow as the click affordance');
    assert.match(css,
      /\.rrt-action--tickets:not\(\.rrt-action--pack-pending\) \.rrt-action__label\s*\{[^}]*line-height:\s*0\.96;[^}]*white-space:\s*pre-line/s,
      'the two-line ticket label stays compact instead of widening the Pending row');
    assert.match(css,
      /\.rrt-action--tickets\.rrt-action--ticket-ready\s*\{[^}]*width:\s*auto;[^}]*grid-template-columns:\s*2\.28rem auto/s,
      'the ready-ticket control hugs its pack and label instead of reserving an empty CTA column');
    assert.equal(art.querySelector('.rvl-pack-logo')?.src, '/whitepaper/flame-logo.svg');
    assert.equal(art.querySelector('.rvl-pack-edition'), null,
      'the unreadable miniature edition plaque is omitted');
    assert.equal(art.querySelector('.rrt-pack-level')?.textContent, 'L62');
    assert.equal(art.querySelector('.rrt-pack-count')?.textContent, '5 TIX',
      'the miniature reserves its face for the useful level and quantity');
    assert.match(css, /\.rrt-pack-art\.rvl-pack\s*\{[^}]*flex:\s*0 0 auto[^}]*aspect-ratio:\s*118 \/ 160/s,
      'the compact button cannot flex-squash its portrait wrapper');
    assert.match(css,
      /\.rrt-pack-art\.rvl-pack\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*0\.72rem 0\.62rem 0\.64rem/s,
      'the miniature gives most of its height to two readable data zones');
    assert.match(css,
      /\.rrt-pack-art \.rrt-pack-level\s*\{[^}]*font:\s*1000 0\.48rem\/1[\s\S]*?\.rrt-pack-art \.rrt-pack-count\s*\{[^}]*font:\s*1000 0\.42rem\/1/s,
      'level and ticket count use legible abbreviated type instead of microcopy');
    el.disconnectedCallback();
  });

  test('is mounted once and styled as a fixed bottom surface below the reveal overlay', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    assert.equal((html.match(/<app-reveal-tray><\/app-reveal-tray>/g) || []).length, 1);
    assert.equal((html.match(/<app-box-strip tray-only><\/app-box-strip>/g) || []).length, 1,
      'one headless lootbox controller feeds the global tray');
    assert.equal((html.match(/<app-sdgnrs-redemptions><\/app-sdgnrs-redemptions>/g) || []).length, 1,
      'one durable sDGNRS claim controller feeds the same tray');
    assert.match(css, /app-reveal-tray\s*\{[^}]*position:\s*fixed[^}]*bottom:/s);
    assert.match(css, /app-reveal-tray\s*\{[^}]*z-index:\s*900/s);
    assert.match(css, /\.rvl-backdrop\s*\{[^}]*z-index:\s*1200/s);
    assert.match(css,
      /\.rrt-action\.is-waiting\s*\{[^}]*filter:\s*grayscale\(0\.92\)[^}]*opacity:\s*0\.5/s,
      'waiting work is visibly grey until it can advance resolution');
    assert.match(
      css,
      /body\.layout-basic \.rrt-actions\s*\{[^}]*max-height:\s*7\.2rem[^}]*flex-wrap:\s*wrap[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/s,
      'long manifests remain scrollable without painting a one-pixel animation scrollbar',
    );
    assert.match(css, /\.rrt-actions::\-webkit-scrollbar\s*\{\s*display:\s*none/s);
    assert.match(
      css,
      /@media \(max-width: 560px\)[\s\S]*?\.rrt-actions\s*\{[^}]*max-height:\s*7\.9rem/s,
      'the phone tray fits two compact rows without nuisance scrollbars',
    );
    assert.match(
      css,
      /@media \(max-width: 560px\)[\s\S]*?\.rrt-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
      'phone Pending uses both columns for compact cards instead of wasting a full row per card',
    );
    assert.match(
      css,
      /@media \(max-width: 560px\)[\s\S]*?\.rrt-controls__actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/s,
      'phone HIDE and CLEAR share a short horizontal rail',
    );
    assert.match(
      css,
      /\.rrt-actions > \.rrt-action:only-child,[\s\S]*?\.rrt-action:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*1 \/ -1/s,
      'a lone or unmatched compact card reclaims the full available width',
    );
    assert.match(css, /\.rrt-stage\s*\{[^}]*display:\s*grid/s,
      'the contextual RNG control, Pending, and detached error bubble share one compact stage');
    assert.match(css,
      /\.rrt-tray\[data-has-pending="false"\]\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent/s,
      'an RNG-only state does not draw an empty Pending card');
    const trayAt = el.innerHTML.indexOf('class="rrt-tray"');
    const rngAt = el.innerHTML.indexOf('class="rrt-rng"');
    const actionsAt = el.innerHTML.indexOf('class="rrt-actions"');
    const controlsAt = el.innerHTML.indexOf('class="rrt-controls"');
    assert.ok(
      trayAt >= 0 && rngAt > trayAt && actionsAt > rngAt && controlsAt > actionsAt,
      'the RNG widget is the left-hand child inside Pending',
    );
    assert.equal(el.innerHTML.includes('class="rrt-head"'), false,
      'the top Pending/logo header is gone');
    assert.equal(el.innerHTML.includes('data-bind="rrt-title"'), false,
      'Pending and Ready title copy is gone');
    const hideAt = el.innerHTML.indexOf('data-bind="rrt-hide"');
    const clearAt = el.innerHTML.indexOf('data-bind="rrt-clear"');
    assert.ok(hideAt >= 0 && hideAt < clearAt,
      'Pending retains only the stacked HIDE and CLEAR controls');
    assert.doesNotMatch(el.innerHTML, /rrt-auto-open|rrt-speed/,
      'AUTO and default speed live exclusively in the top-bar settings menu');
    assert.match(css,
      /\.rrt-tray\s*\{[^}]*grid-template-areas:[^}]*"actions controls"/s,
      'actions and controls share the reclaimed main row');
    assert.match(css,
      /\.rrt-tray\s*\{[^}]*--rrt-font-family:\s*"Inter"[^}]*font-family:\s*var\(--rrt-font-family\)/s,
      'Pending establishes one explicit type stack for every nested surface');
    assert.match(css,
      /\.rrt-tray button,[\s\S]*?\.rrt-tray input,[\s\S]*?\.rrt-tray output\s*\{[^}]*font-family:\s*inherit/s,
      'native Pending controls inherit the same typeface instead of browser defaults');
    const pendingCss = css.slice(css.indexOf('body.layout-basic app-reveal-tray'), css.indexOf('@keyframes rrt-rise'));
    assert.doesNotMatch(pendingCss, /var\(--font-display|font:\s*[^;]*\bsans-serif\b/,
      'no Pending sub-control swaps to the display or generic sans fallback');
    assert.match(css,
      /\.rrt-controls\s*\{[^}]*display:\s*block;[^}]*width:\s*3\.8rem;[^}]*height:\s*var\(--rrt-row-height\)/s,
      'the reclaimed control column is only as wide as HIDE/CLEAR');
    assert.match(css,
      /\.rrt-controls__actions\s*\{[^}]*grid-template-rows:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
      'HIDE over CLEAR fills the compact action stack');
    assert.ok(
      el.innerHTML.indexOf('class="rrt-rng__flow"')
        < el.innerHTML.indexOf('class="rrt-rng__brand"'),
      'the vertical dots precede the Chainlink button',
    );
    assert.match(css, /\.rrt-rng__flow\s*\{[^}]*flex-direction:\s*column/s,
      'the block lights form one vertical progression');
    assert.match(css, /\.rrt-rng__step\s*\{[^}]*width:\s*0\.44rem[^}]*height:\s*0\.44rem/s,
      'five larger bubbles remain compact beside the logo');
    assert.match(css,
      /\.rrt-hide,[\s\S]*?\.rrt-clear\s*\{[^}]*height:\s*100%/s,
      'each remaining control fills one of the two equal rows');
    assert.doesNotMatch(css, /\.rrt-auto-open|\.rrt-speed/,
      'retired Pending preference styling is removed with the controls');
    assert.match(css, /\.rrt-action__kind,[\s\S]*?\.rrt-action__detail\s*\{[^}]*clip-path:\s*inset\(50%\)/s,
      'verbose publisher copy remains accessible without being cut off in the visual tray');
    el.disconnectedCallback();
  });
});
