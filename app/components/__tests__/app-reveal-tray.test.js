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
const preferences = await import('../../app/degenerette-preferences.js');
const trayModule = await import('../app-reveal-tray.js');

beforeEach(() => {
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
      { kind: 'tickets', state: 'waiting' },
      { kind: 'pari', state: 'ready' },
      { kind: 'batch-resolution', state: 'ready' },
      { kind: 'bingo', state: 'ready' },
      { kind: 'foil-match', state: 'ready' },
    ]);
    assert.deepEqual(rows.map((row) => row.kind), [
      'lootbox', 'degenerette', 'degenerette', 'lootbox', 'tickets', 'growth-claim', 'volume-claim', 'batch-resolution', 'bingo', 'foil-match',
    ]);
  });
});

describe('<app-reveal-tray>', () => {
  test('a foil match shows the actual foil ticket and names the scoring reason', () => {
    pending.publishPendingActions('foil-match', [{
      id: 'foil-match:44:2:0', kind: 'foil-match', kindLabel: 'FOIL TICKET MATCH',
      label: 'Day 44 · Foil T5', shortLabel: 'Claim T5',
      detail: 'MAIN DRAW · 2 exact + 1 symbol',
      lineTraits: [56, 70, 130, 200],
      state: 'ready', write: true, run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--foil-match');
    assert.ok(action);
    assert.equal(action.querySelector('.rrt-action__kind').textContent, 'FOIL TICKET MATCH');
    assert.match(action.querySelector('.rrt-action__detail').textContent, /2 exact \+ 1 symbol/);
    assert.equal(action.querySelectorAll('.rrt-foil-match-ticket__q').length, 4,
      'the pending art copies all four badges from the matched foil ticket');
    assert.match(action.querySelector('.rrt-foil-match-ticket').className, /(?:^|\s)ticket-card--foil(?:\s|$)/,
      'the Pending thumbnail uses the same visible foil material as the full ticket');
    assert.equal(action.querySelectorAll('.trait-quadrant--gold').length, 1,
      'real gold traits keep their gold surface instead of being painted silver');
    assert.equal(
      action.querySelector('.rrt-foil-match-ticket__center')?.querySelector('img')?.src,
      '/whitepaper/flame-center-silver.svg',
      'the compact Pending ticket uses the same silver centre flame',
    );
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'CLAIM T5');
    assert.notEqual(action.getAttribute('data-write'), null);
    el.disconnectedCallback();
  });

  test('a Bingo receipt names why it paid and uses the completed-symbol badge', () => {
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
    assert.equal(action.querySelector('.rrt-action__kind').textContent, 'QUADRANT-FIRST BINGO');
    assert.match(action.querySelector('.rrt-action__detail').textContent, /all 8 colors/);
    assert.equal(action.querySelector('.rrt-action__art--bingo').querySelector('img').src,
      '/badges-circular/crypto_06_ethereum_gold.svg');
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'REVEAL BINGO');
    el.disconnectedCallback();
  });

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

  test('an unresolved bought pack is a small passive receipt, then promotes to its opener', () => {
    pending.publishPendingActions('pack', [{
      id: 'ticket-packs:pending', kind: 'tickets',
      label: '4 TICKETS PENDING', detail: 'Queued before the next jackpot',
      ticketCount: 4,
      state: 'waiting', pinned: true, passive: true, compact: true,
      pendingPacks: [{ level: 77, count: 4, foilPack: false, packIndex: 1, packCount: 1 }],
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    let action = el.querySelector('.rrt-action--pack-pending');
    assert.ok(action, 'the bought pack remains visible while its traits are unresolved');
    assert.equal(action.tagName, 'BUTTON', 'the receipt opens a read-only pack preview');
    assert.equal(action.disabled, false, 'viewing pending packs is never transaction-locked');
    assert.equal(action.getAttribute('aria-expanded'), 'false');
    assert.equal(action.querySelector('.rrt-pack-pending__count').textContent, '4 TICKETS');
    assert.equal(action.querySelector('.rrt-pack-pending__state').textContent, 'PENDING');
    assert.ok(action.querySelector('.rrt-pending-pack-art'),
      'the receipt uses a tiny generic pack icon');
    assert.equal(action.querySelector('.rvl-pack-logo')?.src, '/whitepaper/flame-logo.svg');
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
    assert.equal(details.querySelector('.rvl-pack-count').textContent, '4 TICKETS');
    assert.equal(details.querySelector('.rrt-pending-pack-preview__caption').textContent, 'PENDING');

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
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'OPEN TICKETS');
    el.disconnectedCallback();
  });

  test('CLEAR dismisses a pending pack and its eventual per-level opener', async () => {
    pending.publishPendingActions('pack', [{
      id: 'ticket-packs:pending', kind: 'tickets', label: '3 TICKETS PENDING',
      ticketCount: 3, state: 'waiting', pinned: true, passive: true, compact: true,
      pendingPacks: [{ level: 77, count: 3, foilPack: false, packIndex: 1, packCount: 1 }],
      dismissIds: ['ticket-pack:77'],
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    const clear = el.querySelector('[data-bind="rrt-clear"]');
    assert.equal(clear.hidden, false);
    clear.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(el.querySelector('[data-bind="rrt-tray"]').hidden, true);

    pending.publishPendingActions('pack', [{
      id: 'ticket-pack:77', kind: 'tickets', label: 'Level 77 ticket pack',
      ticketLevel: 77, ticketCount: 3, state: 'ready', run: async () => {},
    }]);
    assert.equal(el.querySelector('[data-bind="rrt-tray"]').hidden, true,
      'the cleared waiting hand cannot return under its ready opener id');
    el.disconnectedCallback();
  });

  test('a submitted Degenerette RNG request stays pinned with progress, then lights up when ready', () => {
    pending.publishPendingActions('degenerette', [{
      id: 'degenerette:42', kind: 'degenerette', label: '1 spin',
      shortLabel: 'Waiting for RNG', detail: 'RNG requested · waiting for Chainlink result',
      ticketPacked: '0x1b3a0900', heroQuadrant: 2,
      state: 'waiting', phase: 'waiting-rng', pinned: true, progress: 'indeterminate',
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const shell = el.querySelector('[data-bind="rrt-tray"]');
    let action = el.querySelector('.rrt-action--degenerette');
    assert.equal(shell.hidden, false, 'a requested RNG wait remains on screen');
    assert.match(action.className, /is-rng-waiting/);
    assert.match(action.className, /is-waiting/,
      'not-yet-actionable work receives the shared muted treatment');
    assert.equal(action.disabled, true, 'waiting progress cannot submit a duplicate request');
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'WAITING');
    assert.ok(action.querySelector('.rrt-action__progress'));
    assert.equal(el.querySelector('[data-bind="rrt-title"]').textContent, 'RNG PENDING');
    assert.equal(action.querySelector('.rrt-action__kind').textContent, 'DEGENERETTE');
    assert.equal(action.querySelector('.rrt-action__label').textContent, '1 spin',
      'the middle line does not repeat Degenerette');
    const ticket = action.querySelector('.rrt-degenerette-ticket');
    assert.match(ticket.className, /ticket-card/,
      'the pending graphic uses the same ticket paper as the submitted ticket');
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

    pending.publishPendingActions('degenerette', [{
      id: 'degenerette:42', kind: 'degenerette', label: '1 spin',
      shortLabel: 'Resolve degen', detail: 'RNG ready · FLIP result locked',
      ticketPacked: '0x1b3a0900', heroQuadrant: 2,
      state: 'ready', phase: 'result-ready', run: async () => {},
    }]);
    action = el.querySelector('.rrt-action--degenerette');
    assert.match(action.className, /is-result-ready/);
    assert.doesNotMatch(action.className, /is-waiting/);
    assert.equal(action.disabled, false);
    assert.equal(action.querySelector('.rrt-action__progress'), null);
    assert.equal(el.querySelector('[data-bind="rrt-title"]').textContent, 'READY');

    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css, /\.rrt-action__art--degenerette\s*\{[^}]*width:\s*2\.42rem;[^}]*height:\s*2\.42rem/s,
      'the Degenerette art leaves vertical breathing room inside its fixed-height row');
    assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.rrt-action--degenerette \.rrt-action__art\s*\{[^}]*width:\s*2\.12rem;[^}]*height:\s*2\.12rem/s,
      'the narrow Degenerette art stays below the row content height');
    assert.match(css, /\.rrt-action--degenerette\.is-result-ready\s*\{[^}]*animation:\s*rrt-degenerette-ready-glow/s);
    assert.match(css, /\.rrt-action__progress-fill\s*\{[^}]*animation:\s*rrt-rng-progress/s);
    el.disconnectedCallback();
  });

  test('OPEN WHEN READY persists and auto-runs only presentation-safe resolved work', async () => {
    let ran = 0;
    pending.publishPendingActions('pack', [{
      id: 'ticket-pack:77', kind: 'tickets', label: 'Level 77 ticket pack',
      detail: 'Waiting for the Level 77 draw', state: 'waiting', pinned: true,
      autoOpen: true,
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const checkbox = el.querySelector('[data-bind="rrt-auto-open"]');
    assert.ok(checkbox, 'the active tray header carries the preference');
    assert.equal(checkbox.checked, false, 'automatic popups are opt-in');
    checkbox.checked = true;
    checkbox.dispatchEvent({ type: 'change' });
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
    el.disconnectedCallback();
  });

  test('Pending header restores and persists the shared reveal speed', () => {
    localStorage.setItem(preferences.DEGENERETTE_PREFERENCES_KEY, JSON.stringify({
      version: 1, speed: 2.5, bets: { 1: '500' },
    }));
    pending.publishPendingActions('pack', [{
      id: 'ticket-pack:4', kind: 'tickets', label: 'Level 4 ticket pack',
      detail: '4 tickets ready', state: 'ready', run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const speed = el.querySelector('[data-bind="rrt-speed"]');
    const output = el.querySelector('[data-bind="rrt-speed-value"]');
    assert.equal(speed.min, '0.5');
    assert.equal(speed.max, '3');
    assert.equal(speed.value, '2.5');
    assert.equal(output.textContent, '2.5×');
    speed.value = '3';
    speed.dispatchEvent({ type: 'input' });
    assert.equal(output.textContent, '3×');
    speed.dispatchEvent({ type: 'change' });
    const saved = JSON.parse(localStorage.getItem(preferences.DEGENERETTE_PREFERENCES_KEY));
    assert.equal(saved.speed, 3);
    assert.equal(saved.bets['1'], '500', 'changing reveal speed preserves saved wager sizes');

    el.disconnectedCallback();
  });

  test('OPEN WHEN READY waits through major draw motion and its cooldown; manual opens still run', async () => {
    let ran = 0;
    localStorage.setItem('degenerus:reveal-tray:auto-open:v1', '1');
    drawGate.setMajorDrawActivity('jackpot-replay', true);
    pending.publishPendingActions('box', [{
      id: 'box:88', kind: 'lootbox', label: 'Lootbox #88',
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
      kindLabel: 'sDGNRS REDEMPTION', label: 'Redemption box · Day 67',
      shortLabel: 'Claim & open', detail: 'Waiting for the daily RNG result',
      state: 'waiting', pinned: true, progress: 'indeterminate',
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const action = el.querySelector('.rrt-action--lootbox');
    assert.equal(el.querySelector('[data-bind="rrt-tray"]').hidden, false);
    assert.equal(action.querySelector('.rrt-action__kind').textContent, 'sDGNRS REDEMPTION');
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'WAITING');
    assert.ok(action.querySelector('.rrt-action__progress'));
    assert.equal(action.disabled, true);
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
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'LOADING…');
    assert.equal(el.querySelector('[data-bind="rrt-title"]').textContent, 'PENDING');
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
    assert.equal(shell.hidden, false);
    assert.ok(action, 'growth payout is visible beside the other bottom actions');
    assert.equal(action.querySelector('.rrt-action__kind').textContent, 'GROWTH BET');
    assert.equal(action.querySelector('.rrt-action__art--growth-claim').textContent, '↑');
    assert.equal(action.querySelector('.rrt-action__cta').textContent, 'CLAIM');

    action.dispatchEvent({ type: 'click' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    assert.equal(claimed, 1);
    assert.equal(shell.hidden, true);
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
    assert.equal(action.querySelector('.rrt-action__art--volume-claim').textContent, 'V');
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
    assert.equal(resolver.querySelector('.rrt-action__label').textContent, 'Mine FLIP');
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
      detail: 'Waiting for Chainlink RNG', state: 'waiting',
      phase: 'waiting-rng', pinned: true, progress: 'indeterminate',
    };
    pending.publishPendingActions('degenerette', [waiting]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();

    const shell = el.querySelector('[data-bind="rrt-tray"]');
    const hide = el.querySelector('[data-bind="rrt-hide"]');
    assert.equal(shell.hidden, false);
    assert.equal(hide.textContent, 'HIDE');
    hide.dispatchEvent({ type: 'click' });
    assert.equal(shell.hidden, true, 'HIDE collapses the surface');
    assert.equal(pending.getPendingActions().length, 1,
      'HIDE does not clear or dismiss the underlying work');

    pending.publishPendingActions('degenerette', [{ ...waiting }]);
    assert.equal(shell.hidden, true,
      'an equivalent polling refresh does not nag the player again');

    pending.publishPendingActions('degenerette', [{
      ...waiting,
      state: 'ready',
      phase: 'result-ready',
      detail: 'RNG ready · result locked',
      progress: null,
      run: async () => {},
    }]);
    assert.equal(shell.hidden, false,
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
        id: 'box:7', kind: 'lootbox', label: 'Lootbox #7', state: 'ready',
        run: async () => {}, clearAll,
      },
      {
        id: 'box:8', kind: 'lootbox', label: 'Lootbox #8', state: 'ready',
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
    assert.equal(el.querySelector('[data-bind="rrt-tray"]').hidden, true);

    pending.publishPendingActions('box', [{
      id: 'box:7', kind: 'lootbox', label: 'Lootbox #7', detail: 'Now ready again',
      state: 'ready', run: async () => {},
    }]);
    assert.equal(el.querySelector('[data-bind="rrt-tray"]').hidden, true,
      'the same cleared id cannot return merely because a poll changed its state');

    pending.publishPendingActions('box', [
      {
        id: 'box:7', kind: 'lootbox', label: 'Lootbox #7', detail: 'Now ready again',
        state: 'ready', run: async () => {},
      },
      {
        id: 'box:9', kind: 'lootbox', label: 'Lootbox #9', detail: 'Genuinely new work',
        state: 'ready', run: async () => {},
      },
    ]);
    assert.equal(el.querySelector('[data-bind="rrt-tray"]').hidden, false);
    assert.equal(el.querySelectorAll('.rrt-action').length, 1);
    assert.equal(el.querySelector('.rrt-action').getAttribute('data-action-id'), 'box:9');
    el.disconnectedCallback();
  });

  test('ticket actions use a fixed-aspect branded pack instead of a squeezed glyph', () => {
    pending.publishPendingActions('pack', [{
      id: 'pack:62', kind: 'tickets', label: 'Level 62 ticket pack',
      ticketLevel: 62, ticketCount: 5,
      shortLabel: 'Open tickets', detail: '5 tickets ready', state: 'ready',
      run: async () => {},
    }]);
    const el = new trayModule.AppRevealTray();
    el.connectedCallback();
    const art = el.querySelector('.rrt-action__art--tickets');
    assert.ok(art?.querySelector('.rrt-pack-art'), 'the button carries the opener pack art');
    assert.equal(art.querySelector('.rvl-pack-logo')?.src, '/whitepaper/flame-logo.svg');
    assert.equal(art.querySelector('.rrt-pack-level')?.textContent, 'LEVEL 62');
    assert.equal(art.querySelector('.rrt-pack-count')?.textContent, '5 TICKETS',
      'quantity and level are printed in the center of the bottom-panel pack');
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css, /\.rrt-pack-art\.rvl-pack\s*\{[^}]*flex:\s*0 0 auto[^}]*aspect-ratio:\s*118 \/ 160/s,
      'the compact button cannot flex-squash its portrait wrapper');
    el.disconnectedCallback();
  });

  test('is mounted once and styled as a fixed bottom surface below the reveal overlay', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
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
      /body\.layout-basic \.rrt-actions\s*\{[^}]*max-height:\s*8\.5rem[^}]*flex-wrap:\s*wrap[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/s,
      'long manifests remain scrollable without painting a one-pixel animation scrollbar',
    );
    assert.match(css, /\.rrt-actions::\-webkit-scrollbar\s*\{\s*display:\s*none/s);
    assert.match(
      css,
      /@media \(max-width: 560px\)[\s\S]*?\.rrt-actions\s*\{[^}]*max-height:\s*7\.9rem/s,
      'the single-column phone tray likewise fits two compact rows without nuisance scrollbars',
    );
  });
});
