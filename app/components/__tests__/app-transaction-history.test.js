import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function matches(element, selector) {
  const attr = /^\[([\w-]+)="([^"]+)"\]$/.exec(selector);
  if (attr) return element.attributes[attr[1]] === attr[2];
  if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
  return element.tagName === selector.toUpperCase();
}

function makeElement(tag = 'div') {
  const element = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    listeners: {},
    className: '',
    hidden: false,
    disabled: false,
    open: false,
    _text: '',
    _html: '',
    classList: {
      _set: new Set(),
      add(...names) { names.forEach((name) => this._set.add(name)); },
      remove(...names) { names.forEach((name) => this._set.delete(name)); },
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
        if (klass) child.className = klass[1];
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
      while (stack.length > 0) {
        const child = stack.shift();
        if (matches(child, selector)) out.push(child);
        stack.unshift(...(child.children || []));
      }
      return out;
    },
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    removeEventListener(type, listener) {
      this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== listener);
    },
    dispatchEvent(event) {
      for (const listener of this.listeners[event.type] || []) listener(event);
      return true;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
  };
  return element;
}

class FakeHTMLElement {
  constructor() { Object.defineProperties(this, Object.getOwnPropertyDescriptors(makeElement())); }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.document = {
  hidden: false,
  documentElement: { hasAttribute: () => false },
  createElement: (tag) => makeElement(tag),
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null; },
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.customElements = {
  registry: new Map(),
  define(name, constructor) { this.registry.set(name, constructor); },
  get(name) { return this.registry.get(name); },
};

const store = await import('../../app/store.js');
const history = await import('../app-transaction-history.js');

afterEach(() => {
  history.setTransactionHistoryLoaderForTest(null);
  store.update('viewing.address', null);
  store.update('connected.address', null);
  store.update('app.lastDay', null);
  store.update('app.gameState', null);
});

describe('transaction history composition', () => {
  test('queues zero-payout record reels before a genuine Degenerette Luckbox replay', () => {
    const sequence = {
      kind: 'degenerette',
      recordBountySpins: [{ spinType: 'record', payout: 0n, reels: [{}, {}, {}] }],
      lootboxLegs: [{ legType: 'spin', spinType: 'eth', payout: 25n }],
    };

    const replay = history.transactionHistoryReplaySequences({
      type: 'degenerette-result',
      sequence,
    });

    assert.deepEqual(replay.map((item) => item.kind), [
      'degenerette', 'record-bounty', 'lootbox',
    ]);
    assert.equal(replay[1].spin.payout, 0n);
    assert.equal(replay[2].title, 'DEGENERETTE LUCKBOX');
    assert.deepEqual(replay[2].legs.map((leg) => leg.spinType), ['eth']);
  });

  test('adds a winning record BoxSpin payout once while zero payout adds nothing', () => {
    const player = '0x1111111111111111111111111111111111111111';
    const resultTx = `0x${'9'.repeat(64)}`;
    const packed = 13n | (1n << 32n) | ((10n ** 10n) << 42n);
    const feedWithRecordPayout = (payout) => ({ items: [{
      player,
      betIndex: 7,
      betId: '42',
      packedData: String(packed),
      rngReady: true,
      rngWord: '43981',
      blockNumber: '100',
      transactionHash: `0x${'8'.repeat(64)}`,
      logIndex: 1,
      results: [{
        resultType: 'result', payout: '5', blockNumber: '101',
        transactionHash: resultTx, logIndex: 9,
        resultData: { spinIndex: 0, playerTraits: '13', matches: 9 },
      }, {
        resultType: 'resolved', payout: '5', blockNumber: '101',
        transactionHash: resultTx, logIndex: 10,
        resultData: { spinCount: 1, totalPayout: '5', resultTraits: '13' },
      }],
      resultTickets: [{ spinIndex: 0, resultTicket: '13' }],
      lootboxPayouts: [{
        rewardType: 'BoxSpin', blockNumber: '101', transactionHash: resultTx,
        logIndex: 11, lootboxIndex: null,
        rewardData: {
          betId: String((1n << 63n) | (3n << 60n) | 1n),
          spinType: 'record', spinCount: 3, survived: payout !== '0',
          payout, ethShare: '0',
          reels: [
            { spinIndex: 0, playerTicket: '1', resultTicket: '2', score: 0 },
            { spinIndex: 1, playerTicket: '3', resultTicket: '4', score: 2 },
            { spinIndex: 2, playerTicket: '5', resultTicket: '6', score: 1 },
          ],
        },
      }],
    }] });

    const winning = history.buildTransactionHistoryRows({
      address: player,
      degeneretteFeed: feedWithRecordPayout('7'),
    }).find((row) => row.type === 'degenerette-result');
    const losing = history.buildTransactionHistoryRows({
      address: player,
      degeneretteFeed: feedWithRecordPayout('0'),
    }).find((row) => row.type === 'degenerette-result');

    assert.equal(winning.deltas.find((delta) => delta.asset === 'ETH')?.value, 5n,
      'the base Degenerette total remains its own payout');
    assert.equal(winning.deltas.find((delta) => delta.asset === 'FLIP')?.value, 7n,
      'the independently minted record payout is credited exactly once');
    assert.equal(losing.deltas.some((delta) => delta.asset === 'FLIP'), false,
      'a zero record payout remains revealable without fabricating a balance delta');
  });

  test('sorts indexed activity and exposes the net amount of every proven asset', () => {
    const player = '0x1111111111111111111111111111111111111111';
    const buyTx = `0x${'a'.repeat(64)}`;
    const openTx = `0x${'b'.repeat(64)}`;
    const rows = history.buildTransactionHistoryRows({
      address: player,
      lootboxFeed: { items: [{
        id: 1, player, kind: 'eth', costRawWei: '1000000000000',
        blockNumber: '95', transactionHash: buyTx, logIndex: 2,
      }] },
      lootboxLegs: { items: [{
        uid: 'r1', player, legType: 'opened', rewardType: 'opened', lootboxIndex: 9,
        rewardData: {
          futureLevel: 6, futureTickets: 200, roundedUp: false,
          flip: '5000000000000000000',
        },
        origin: 'afking',
        blockNumber: '100', transactionHash: openTx, logIndex: 5, ord: 100000005,
      }] },
      packs: {
        ticketRevealPacks: [{
          packId: 'tickets-day-all-batch-0', ticketCount: 1, level: 7,
          tickets: [{ traits: [1, 65, 129, 193] }], revealBlock: '90',
        }],
      },
      jackpotHistory: { wins: [{
        day: 7, awardType: 'tickets', amount: '8', level: 4,
      }, {
        day: 7, awardType: 'flip', amount: '3000000000000000000', level: 4,
      }] },
      jackpotBlocks: new Map([[7, { end: '110' }]]),
    });

    assert.deepEqual(rows.map((row) => row.type), [
      'jackpot', 'lootbox-result', 'lootbox-purchase', 'tickets',
    ]);
    assert.deepEqual(rows[0].deltas.map(history.formatHistoryDelta), [
      '+3 FLIP', '+2 L4 TICKETS',
    ]);
    assert.deepEqual(rows[1].deltas.map(history.formatHistoryDelta), [
      '+5 FLIP', '+2 L6 TICKETS',
    ]);
    assert.deepEqual(rows[2].deltas.map(history.formatHistoryDelta), [
      '−1.00 ETH', '+1 LUCKBOX',
    ]);
    assert.deepEqual(rows[3].deltas.map(history.formatHistoryDelta), ['+1 L7 TICKETS']);
    assert.equal(rows[1].title, 'Luckbox opened',
      'AFKing boxes use the same result activity as every other opened box');
    assert.equal(rows[1].sequence.kind, 'lootbox', 'settlement rows retain an exact replay');
    assert.equal(rows[3].replaySequences[0].tickets[0].traitIds.length, 4,
      'ticket receipt rows retain their ticket graphics for replay');
  });

  test('keeps jackpot awards isolated to their exact indexed day', () => {
    const player = '0x1111111111111111111111111111111111111111';
    const rows = history.buildTransactionHistoryRows({
      address: player,
      jackpotHistory: { wins: [
        { day: 110, awardType: 'eth', amount: '100000000000', level: 27 },
        { day: 110, awardType: 'tickets', amount: '8', level: 27 },
        { day: 111, awardType: 'flip', amount: '3000000000000000000', level: 30 },
        { day: 111, awardType: 'tickets', amount: '16', level: 28 },
      ] },
      jackpotBlocks: new Map([
        [110, { end: '1100' }],
        [111, { end: '1110' }],
      ]),
    }).filter((row) => row.type === 'jackpot');

    assert.deepEqual(rows.map((row) => row.day), [111, 110]);
    assert.equal(rows[0].detail, 'Day 111 · 2 awards');
    assert.deepEqual(rows[0].deltas.map(history.formatHistoryDelta), [
      '+3 FLIP', '+4 L28 TICKETS',
    ]);
    assert.deepEqual(rows[1].deltas.map(history.formatHistoryDelta), [
      '+0.10 ETH', '+2 L27 TICKETS',
    ]);
  });

  test('does not invoke its loader before the dropdown opens', async () => {
    const player = '0x2222222222222222222222222222222222222222';
    store.update('connected.address', player);
    const calls = [];
    history.setTransactionHistoryLoaderForTest(async (address, options) => {
      calls.push({ address, options });
      return {
        rows: [], warnings: [], total: 26,
        hasNext: Number(options?.page) === 0,
      };
    });
    const element = new history.AppTransactionHistory();
    element.connectedCallback();
    await Promise.resolve();
    assert.match(element.innerHTML, /class="txh section-disclosure"/,
      'history uses the shared section disclosure shell');
    assert.match(element.innerHTML, /class="txh__summary section-disclosure__bar"[\s\S]*class="section-disclosure__chevron"/,
      'history uses the same bar and arrow as Tickets and AFKING PASSES');
    assert.doesNotMatch(
      element.innerHTML,
      /txh__summary-(?:icon|copy|meta)|Purchases, awards, and replayable results|ON DEMAND/,
      'the disclosure bar is only its title and shared chevron',
    );
    assert.equal(calls.length, 0, 'mounting a collapsed history performs no request');

    const details = element.querySelector('[data-bind="txh-details"]');
    details.open = true;
    details.dispatchEvent({ type: 'toggle' });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    assert.deepEqual(calls, [{ address: player, options: { limit: 10, page: 0 } }]);

    details.open = false;
    details.dispatchEvent({ type: 'toggle' });
    details.open = true;
    details.dispatchEvent({ type: 'toggle' });
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    assert.equal(calls.length, 1, 'reopening the same loaded page uses its in-memory result');

    element.querySelector('[data-bind="txh-next"]').dispatchEvent({ type: 'click' });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    assert.deepEqual(calls.at(-1), { address: player, options: { limit: 10, page: 1 } });
    assert.equal(element.querySelector('[data-bind="txh-page"]').textContent, 'PAGE 2');

    element.querySelector('[data-bind="txh-prev"]').dispatchEvent({ type: 'click' });
    await Promise.resolve();
    assert.equal(calls.length, 2, 'returning to page one uses its cached result');
    assert.equal(element.querySelector('[data-bind="txh-page"]').textContent, 'PAGE 1');
    element.disconnectedCallback();
  });

  test('starts with all activity visible, then focuses the category that was clicked', async () => {
    const player = '0x2525252525252525252525252525252525252525';
    store.update('connected.address', player);
    let loads = 0;
    const rows = [
      ['buy', 'lootbox-purchase'],
      ['jackpot', 'jackpot'],
      ['pack', 'tickets'],
      ['lootbox', 'lootbox-result'],
      ['degen', 'degenerette-result'],
    ].map(([id, type], index) => ({
      id, type, title: id, detail: '', blockNumber: BigInt(100 - index), deltas: [],
    }));
    history.setTransactionHistoryLoaderForTest(async () => {
      loads += 1;
      return { rows, warnings: [], total: rows.length, hasNext: false };
    });
    const element = new history.AppTransactionHistory();
    element.connectedCallback();
    const details = element.querySelector('[data-bind="txh-details"]');
    details.open = true;
    details.dispatchEvent({ type: 'toggle' });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    for (const key of ['buys', 'jackpots', 'pack-opens', 'lootboxes', 'degenerette']) {
      const button = element.querySelector(`[data-bind="txh-filter-${key}"]`);
      assert.equal(button.getAttribute('aria-pressed'), 'true', `${key} starts selected`);
      assert.match(button.className, /is-selected/);
    }
    assert.equal(element.querySelectorAll('tbody')[0].children.length, 5);

    const buys = element.querySelector('[data-bind="txh-filter-buys"]');
    buys.dispatchEvent({ type: 'click' });
    assert.equal(buys.getAttribute('aria-pressed'), 'true');
    assert.ok(element.querySelector('[data-history-id="buy"]'));
    assert.equal(element.querySelectorAll('tbody')[0].children.length, 1);
    for (const key of ['jackpots', 'pack-opens', 'lootboxes', 'degenerette']) {
      const button = element.querySelector(`[data-bind="txh-filter-${key}"]`);
      assert.equal(button.getAttribute('aria-pressed'), 'false', `${key} is cleared`);
      assert.doesNotMatch(button.className, /is-selected/);
    }

    const jackpots = element.querySelector('[data-bind="txh-filter-jackpots"]');
    jackpots.dispatchEvent({ type: 'click' });
    assert.equal(jackpots.getAttribute('aria-pressed'), 'true');
    assert.equal(buys.getAttribute('aria-pressed'), 'false');
    assert.ok(element.querySelector('[data-history-id="jackpot"]'));
    assert.equal(element.querySelectorAll('tbody')[0].children.length, 1);
    assert.equal(loads, 1, 'filtering the loaded page does not refetch history');

    assert.equal(history.transactionHistoryCategory({ type: 'afking-purchase' }), 'buys');
    assert.equal(history.transactionHistoryCategory({ type: 'lootbox-result' }), 'lootboxes');
    element.disconnectedCallback();
  });

  test('splits assets and makes the game day/timestamp the explorer link', async () => {
    const player = '0x3333333333333333333333333333333333333333';
    const transactionHash = `0x${'c'.repeat(64)}`;
    store.update('connected.address', player);
    store.update('app.lastDay', { roll1: { purchaseLevel: 25 } });
    history.setTransactionHistoryLoaderForTest(async () => ({
      rows: [{
        id: 'mixed-assets',
        type: 'jackpot',
        title: 'Jackpot award',
        detail: 'Mixed payout',
        day: 72,
        phaseClock: { level: 25, phase: 'J', dayInPhase: 2, phaseTotal: 5 },
        timestampMs: Date.parse('2026-08-06T06:28:08Z'),
        blockNumber: 45114700n,
        transactionHash,
        deltas: [
          { asset: 'ETH', kind: 'eth', value: 1_000_000_000_000n },
          { asset: 'FLIP', kind: 'token', value: 2_000_000_000_000_000_000n },
          { asset: 'WWXRP', kind: 'token', value: -3_000_000_000_000_000_000n },
          { asset: 'SDGNRS', kind: 'token', value: 4_000_000_000_000_000_000n },
          { asset: 'TICKETS', kind: 'count', value: 5, level: 25 },
          { asset: 'LOOTBOX', kind: 'count', value: 1 },
          { asset: 'BOON', kind: 'count', value: 1 },
        ],
      }],
      warnings: [], total: 1, hasNext: false,
    }));
    const element = new history.AppTransactionHistory();
    element.connectedCallback();
    const details = element.querySelector('[data-bind="txh-details"]');
    details.open = true;
    details.dispatchEvent({ type: 'toggle' });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    const row = element.querySelector('[data-history-id="mixed-assets"]');
    assert.ok(row);
    assert.deepEqual(row.children.map((cell) => cell.getAttribute('data-label')),
      ['WHEN', 'ACTIVITY', 'ETH', 'COINS', 'ITEMS', 'REVEAL']);
    const when = row.children[0].querySelector('a');
    assert.equal(when.textContent.includes('L25 DAY J2/5'), true);
    assert.equal(when.textContent.includes('2026'), true);
    assert.match(when.href, new RegExp(`/tx/${transactionHash}$`));
    assert.match(row.children[2].textContent, /\+1\.00 ETH/);
    assert.match(row.children[3].textContent, /\+2 FLIP/);
    assert.match(row.children[3].textContent, /−3 WWXRP/);
    assert.match(row.children[3].textContent, /\+4 SDGNRS/);
    assert.match(row.children[4].textContent, /\+5 L25 TICKETS/);
    assert.equal(
      row.children[4].querySelector('.txh__ticket-level').getAttribute('data-ticket-level-tone'),
      'white',
    );
    assert.match(row.children[4].textContent, /\+1 LUCKBOX/);
    assert.match(row.children[4].textContent, /\+1 BOON/);
    assert.match(row.children[2].querySelector('.txh__delta').title, /Exact net: \+1 ETH/,
      'the compact visual amount retains its more precise hover value');
    store.update('app.lastDay', { roll1: { purchaseLevel: 19 } });
    assert.equal(
      element.querySelector('[data-history-id="mixed-assets"]')
        .querySelector('.txh__ticket-level').getAttribute('data-ticket-level-tone'),
      'red',
      'an already-loaded history row repaints when the purchase level changes',
    );
    element.disconnectedCallback();
  });

  test('uses compact coin suffixes and two-decimal ETH without amount pills', () => {
    assert.equal(history.formatHistoryDelta({
      asset: 'FLIP', kind: 'token', value: 12_345n * 10n ** 18n,
    }), '+12.3K FLIP');
    assert.equal(history.formatHistoryDelta({
      asset: 'ETH', kind: 'eth', value: 1_256_000_000_000n,
    }), '+1.25 ETH');
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    assert.match(css, /\.txh__delta\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;/s);
    assert.match(css, /\.txh__delta\s*\{[^}]*font-size:\s*1rem;[^}]*font-weight:\s*950;/s);
  });

  test('includes recurring AFKing orders with their historical product and cost', () => {
    const player = '0x4444444444444444444444444444444444444444';
    const boxTx = `0x${'d'.repeat(64)}`;
    const ticketTx = `0x${'e'.repeat(64)}`;
    const rows = history.buildTransactionHistoryRows({
      address: player,
      afkingHistory: { items: [
        {
          eventName: 'SubscriptionUpdated', player, dailyQuantity: 2, useTickets: false,
          blockNumber: '80', logIndex: 1,
        },
        {
          eventName: 'AfkingDelivered', player, day: 8, weiIn: '40000000000',
          blockNumber: '81', logIndex: 2, transactionHash: boxTx,
        },
        {
          eventName: 'SubscriptionUpdated', player, dailyQuantity: 3, useTickets: true,
          blockNumber: '82', logIndex: 1,
        },
        {
          eventName: 'AfkingDelivered', player, day: 9, weiIn: '120000000000',
          blockNumber: '83', logIndex: 2, transactionHash: ticketTx,
        },
      ] },
    });

    assert.deepEqual(rows.map((row) => row.title), [
      'AFKing ticket purchase', 'AFKing Luckbox purchase',
    ]);
    assert.deepEqual(rows[0].deltas.map(history.formatHistoryDelta), [
      '−0.12 ETH', '+3 TICKETS',
    ]);
    assert.deepEqual(rows[1].deltas.map(history.formatHistoryDelta), ['−0.04 ETH']);
    assert.equal(rows[0].transactionHash, ticketTx);
  });

  test('includes whale, lazy, and deity buys while folding each bundled lootbox into the pass row', () => {
    const player = '0x4444444444444444444444444444444444444444';
    const whaleTx = `0x${'1'.repeat(64)}`;
    const lazyTx = `0x${'2'.repeat(64)}`;
    const deityTx = `0x${'3'.repeat(64)}`;
    const rows = history.buildTransactionHistoryRows({
      address: player,
      lootboxFeed: { items: [{
        id: 1, player, kind: 'eth', costRawWei: '10000000000',
        blockNumber: '120', logIndex: 2, transactionHash: whaleTx,
      }] },
      afkingHistory: { items: [
        {
          eventName: 'WhalePassPurchased', player, quantity: 2, weiIn: '2400000000000',
          blockNumber: '120', logIndex: 3, transactionHash: whaleTx,
        },
        {
          eventName: 'LootBoxBuy', player, amount: '10000000000',
          blockNumber: '120', logIndex: 2, transactionHash: whaleTx,
        },
        {
          eventName: 'LazyPassPurchased', player, startLevel: 12, weiIn: '240000000000',
          blockNumber: '121', logIndex: 3, transactionHash: lazyTx,
        },
        {
          eventName: 'LootBoxBuy', player, amount: '10000000000',
          blockNumber: '121', logIndex: 2, transactionHash: lazyTx,
        },
        {
          eventName: 'DeityPassPurchased', player, symbolId: 31, price: '10000000000000', level: 15,
          blockNumber: '122', logIndex: 3, transactionHash: deityTx,
        },
        {
          eventName: 'LootBoxBuy', player, amount: '10000000000',
          blockNumber: '122', logIndex: 2, transactionHash: deityTx,
        },
      ] },
    });

    assert.deepEqual(rows.map((row) => row.title), [
      'Deity pass purchase', 'Lazy pass purchase', 'Whale pass purchase',
    ]);
    assert.deepEqual(rows[0].deltas.map(history.formatHistoryDelta), [
      '−10.00 ETH', '+1 LUCKBOX', '+1 PASS',
    ]);
    assert.deepEqual(rows[1].deltas.map(history.formatHistoryDelta), [
      '−0.24 ETH', '+1 LUCKBOX', '+1 PASS',
    ]);
    assert.deepEqual(rows[2].deltas.map(history.formatHistoryDelta), [
      '−2.40 ETH', '+1 LUCKBOX', '+2 PASS',
    ]);
    assert.equal(rows.some((row) => row.type === 'lootbox-purchase'), false,
      'a bundled bonus box is not misreported as a second paid purchase');
    assert.equal(history.transactionHistoryCategory({ type: 'pass-purchase' }), 'buys');
  });

  test('repartitions malformed all-time groups and opens history replays on the ticket hand', async () => {
    const rows = history.buildTransactionHistoryRows({
      packs: { ticketRevealPacks: [{
        packId: 'mixed-quarters',
        level: 17,
        ticketCount: 3.5,
        revealBlock: '99',
        tickets: [
          { traits: [1, 84, 137, 201] },
          { traits: [20, 107, 0, 73] },
          { traits: [166, 233, 9, 94] },
          { traits: [146, 201] },
        ],
      }] },
    });
    const ticketRow = rows.find((row) => row.type === 'tickets');
    assert.ok(ticketRow);
    const replay = ticketRow.replaySequences[0];
    assert.equal(replay.autoStart, true);
    assert.deepEqual(replay.entries.map((entry) => entry.traitId), [20, 107]);
    for (const ticket of replay.tickets) {
      assert.deepEqual(ticket.traitIds.map((trait) => trait >> 6), [0, 1, 2, 3]);
    }
    const overlay = await import('../reveal-overlay.js');
    assert.equal(overlay.normalizeSequence(replay).autoStart, true);
    assert.deepEqual(ticketRow.deltas.map(history.formatHistoryDelta), ['+3.5 L17 TICKETS']);
  });

  test('maps absolute days to level-relative purchase and jackpot clocks', () => {
    const payload = { days: [
      { day: 70, level: 25, phase: 'P', dayInPhase: 3 },
      { day: 71, level: 25, phase: 'J', dayInPhase: 1 },
      { day: 72, level: 25, phase: 'J', dayInPhase: 2 },
      { day: 73, level: 25, phase: 'J', dayInPhase: 3 },
    ] };
    const clocks = history.transactionHistoryPhaseClockMap(payload);
    assert.deepEqual(clocks.get(72), {
      level: 25, phase: 'J', dayInPhase: 2, phaseTotal: 3,
    });
    assert.equal(history.formatTransactionHistoryDay({
      phaseClock: clocks.get(70), day: 70,
    }), 'L25 DAY P3');
    assert.equal(history.formatTransactionHistoryDay({
      phaseClock: clocks.get(72), day: 72,
    }), 'L25 DAY J2/3');

    const [row] = history.applyTransactionHistoryPhaseClocks([{
      day: 72,
      deltas: [{ asset: 'TICKETS', kind: 'count', value: 4 }],
    }], payload);
    assert.equal(history.formatHistoryDelta(row.deltas[0]), '+4 L25 TICKETS');
    assert.equal(history.formatTransactionHistoryDay({ day: 99 }), 'DAY 99',
      'the absolute day remains a safe fallback while replay metadata catches up');
  });

  test('derives the protocol game day from an indexed block timestamp', async () => {
    // Derived from the live chain-config, NOT hardcoded: `deployDayBoundary` moves with EVERY
    // redeploy, so a pinned epoch that meant day 72 on one run read as pre-deploy (null) on the
    // next. Building the timestamp from the same anchor/period still exercises the real
    // arithmetic — the floor, the boundary subtraction, and the 1-based day — because the
    // expected day is chosen here and the function has to land back on it.
    const { VOLUME_WINDOW } = await import('../../app/chain-config.sepolia.js');
    const { anchor, period, deployDayBoundary } = VOLUME_WINDOW;
    const day = 72;
    const startMs = ((deployDayBoundary + day - 1) * period + anchor) * 1000;
    assert.equal(history.gameDayForHistoryTimestamp(startMs), day,
      'the first instant of the day maps to that day');
    assert.equal(history.gameDayForHistoryTimestamp(startMs + (period * 1000) - 1), day,
      'the last instant before the next boundary is still that day');
    assert.equal(history.gameDayForHistoryTimestamp(startMs + (period * 1000)), day + 1,
      'crossing the boundary advances exactly one day');
    assert.equal(history.gameDayForHistoryTimestamp((deployDayBoundary * period + anchor) * 1000 - 1), null,
      'a pre-deploy timestamp has no game day');
    assert.match(history.formatHistoryTimestamp(startMs), /20\d\d/);
  });

  test('precedes the bottom Referrals panel and has 10 rows by default with larger choices', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../app-transaction-history.js', import.meta.url), 'utf8');
    assert.ok(html.indexOf('<app-transaction-history>') > html.indexOf('id="afking-passes"'));
    assert.ok(html.indexOf('<app-affiliate-panel>') > html.indexOf('<app-transaction-history>'));
    assert.match(source, /<option value="10" selected>10<\/option>/);
    assert.match(source, /<option value="25">25<\/option>/);
    assert.match(source, /<option value="50">50<\/option>/);
    assert.match(source, /<option value="100">100<\/option>/);
    assert.match(source, /data-bind="txh-next"/);
    assert.match(source,
      /<div class="txh__toolbar">[\s\S]*?<div class="txh__filters"[\s\S]*?<label>ROWS/,
      'desktop filters live in the same toolbar as row and paging controls');
    assert.match(source, /<th scope="col">ETH<\/th>[\s\S]*<th scope="col">COINS<\/th>[\s\S]*<th scope="col">ITEMS<\/th>/);
    assert.doesNotMatch(source, /TX \/ BLOCK/);
  });
});
