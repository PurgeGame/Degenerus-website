// /app/components/__tests__/app-box-strip.test.js — pending lootbox chips.
// Run: cd website && node --test app/components/__tests__/app-box-strip.test.js
//
// Covers: hidden with no boxes, tx-confirmed event plumbing (chips added,
// afking idx-0 skipped, dupes ignored), chainId+address-scoped localStorage
// persistence, and boot restore on connected.address.
//
// The RNG-ready/open path rides lootbox.js primitives (pollRngForLootbox /
// openLootBox) already covered by lootbox.test.js; headless getProvider()
// is null so every poll cycle here resolves 0n (still waiting) — exactly the
// deterministic state these tests pin.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fake DOM scaffold (trimmed decimator-panel port) — BEFORE component import.
// ---------------------------------------------------------------------------

function makeFakeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    parentElement: null,
    attributes: {},
    eventListeners: {},
    _innerHTML: '',
    _textContent: '',
    hidden: false,
    disabled: false,
    className: '',
    dataset: {},
    style: {},
    classList: {
      _set: new Set(),
      add(...cs) { for (const c of cs) this._set.add(c); },
      remove(...cs) { for (const c of cs) this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v);
      this.children = [];
      const re = /<(\w+)([^>]*?)(?:\s\/>|>)/g;
      let match;
      while ((match = re.exec(this._innerHTML)) !== null) {
        const tagName = match[1];
        if (tagName === '/' || tagName.startsWith('!')) continue;
        const attrs = match[2];
        const child = makeFakeElement(tagName);
        const dataBindMatch = /data-bind="([^"]+)"/.exec(attrs);
        if (dataBindMatch) child.attributes['data-bind'] = dataBindMatch[1];
        const classMatch = /\bclass="([^"]+)"/.exec(attrs);
        if (classMatch) for (const c of classMatch[1].split(/\s+/)) child.classList.add(c);
        if (/\bhidden\b/.test(attrs)) child.hidden = true;
        child.parentElement = this;
        this.children.push(child);
      }
    },
    get textContent() {
      if (this._textContent) return this._textContent;
      let acc = '';
      for (const c of this.children) acc += c.textContent || '';
      return acc;
    },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    querySelector(sel) {
      const stack = [...this.children];
      while (stack.length) {
        const cur = stack.shift();
        if (matches(cur, sel)) return cur;
        if (cur.children && cur.children.length) stack.unshift(...cur.children);
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      const stack = [...this.children];
      while (stack.length) {
        const cur = stack.shift();
        if (matches(cur, sel)) out.push(cur);
        if (cur.children && cur.children.length) stack.unshift(...cur.children);
      }
      return out;
    },
    addEventListener(type, fn) {
      if (!this.eventListeners[type]) this.eventListeners[type] = [];
      this.eventListeners[type].push(fn);
    },
    removeEventListener() {},
    dispatchEvent(ev) {
      const arr = this.eventListeners[ev.type] || [];
      for (const fn of arr) { try { fn(ev); } catch { /* swallow */ } }
      return true;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    },
  };
  return el;
}

function matches(el, sel) {
  if (!el) return false;
  if (/^[a-z][a-z0-9-]*$/i.test(sel)) return el.tagName === sel.toUpperCase();
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    if (el.classList && el.classList.contains(cls)) return true;
    if (typeof el.className === 'string' && el.className.split(/\s+/).includes(cls)) return true;
    return false;
  }
  const attrEq = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attrEq) return el.attributes && el.attributes[attrEq[1]] === attrEq[2];
  return false;
}

class FakeHTMLElement {
  constructor() {
    const base = makeFakeElement('div');
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(base));
  }
}
globalThis.HTMLElement = FakeHTMLElement;
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.bubbles = !!init.bubbles;
  }
};
globalThis.customElements = {
  _registry: new Map(),
  define(name, ctor) { this._registry.set(name, ctor); },
  get(name) { return this._registry.get(name); },
};

// Document with WORKING dispatchEvent — the strip listens at document level
// for the buy panel's bubbled tx-confirmed event.
const _docListeners = new Map();
globalThis.document = {
  createElement: (tag) => makeFakeElement(tag),
  body: makeFakeElement('body'),
  addEventListener(type, fn) {
    if (!_docListeners.has(type)) _docListeners.set(type, []);
    _docListeners.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    const arr = _docListeners.get(type);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  },
  dispatchEvent(ev) {
    const arr = _docListeners.get(ev.type) || [];
    for (const fn of arr) { try { fn(ev); } catch { /* swallow */ } }
    return true;
  },
  visibilityState: 'visible',
};
globalThis.window = {
  matchMedia: () => ({ matches: true }),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

const storeMod = await import('../../app/store.js');
const contractsMod = await import('../../app/contracts.js');
const lootboxMod = await import('../../app/lootbox.js');
const pendingActionsMod = await import('../../app/pending-actions.js');
const revealMod = await import('../reveal-overlay.js');
const { pendingBoxesKey, revealedBoxesKey } = await import('../app-box-strip.js');
const { CHAIN } = await import('../../app/chain-config.js');
const ORIGINAL_FETCH = globalThis.fetch;

const ADDR = '0xAbCd00000000000000000000000000000000AbCd';
const ADDR_LC = ADDR.toLowerCase();
const KEY = pendingBoxesKey(CHAIN.id, ADDR);

const tick = () => new Promise((r) => setTimeout(r, 5));
const activeElements = new Set();

function instantiate({ trayOnly = false } = {}) {
  const Ctor = customElements.get('app-box-strip');
  const el = new Ctor();
  if (trayOnly) el.setAttribute('tray-only', '');
  el.connectedCallback();
  activeElements.add(el);
  return el;
}

function fireTxConfirmed(boxes, extra = {}) {
  const pricedBoxes = boxes.map((box) => ({
    amountWei: box.amountWei ?? 10_000_000_000n,
    ...box,
  }));
  document.dispatchEvent(new CustomEvent('app-decimator:tx-confirmed', {
    detail: {
      ticketQuantity: 0,
      lootBoxAmountWei: 10_000_000_000n,
      ticketPriceWei: 10_000_000_000n,
      boxes: pricedBoxes,
      ...extra,
    },
    bubbles: true,
  }));
}

function firePassTxConfirmed(boxes, extra = {}) {
  document.dispatchEvent(new CustomEvent('app-pass:tx-confirmed', {
    detail: {
      player: ADDR,
      transactionHash: '0xpassbox',
      lootBoxAmountWei: 10_000_000_000n,
      presaleBoxAmountWei: 0n,
      boxes,
      ...extra,
    },
    bubbles: true,
  }));
}

function fireTxSubmitted(transactionHash) {
  document.dispatchEvent(new CustomEvent('app-decimator:tx-submitted', {
    detail: {
      player: ADDR,
      transactionHash,
      lootBoxAmountWei: 1n,
      ticketPriceWei: 10_000_000_000n,
    },
    bubbles: true,
  }));
}

function fireTxFailed(transactionHash) {
  document.dispatchEvent(new CustomEvent('app-decimator:tx-failed', {
    detail: { player: ADDR, transactionHash, message: 'Purchase reverted' },
    bubbles: true,
  }));
}

describe('app-box-strip', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    _docListeners.clear();
    storeMod.__resetForTest();
    pendingActionsMod.__resetPendingActionsForTest();
    revealMod.__resetForTest();
    lootboxMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    // Resolve background discovery immediately. Leaving Node's native fetch in
    // place for a relative API URL can keep fetchJSON's shared in-flight entry
    // alive into the next test.
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });
  });

  afterEach(() => {
    for (const el of activeElements) el.disconnectedCallback();
    activeElements.clear();
    lootboxMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test('hidden with no connected address / no boxes', async () => {
    const el = instantiate();
    await tick();
    assert.equal(el.querySelector('[data-bind="bxs-strip"]').hidden, true);
  });

  test('tray-only mode does not render an inline opener', async () => {
    const el = instantiate({ trayOnly: true });
    await tick();
    assert.equal(el.querySelector('[data-bind="bxs-strip"]'), null,
      'the purchase-area chip surface is not rendered');
  });

  test('tx-confirmed adds chips (waiting state), skips afking idx 0, dedupes', async () => {
    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 0, day: 4 }, { index: 8, day: 4 }, { index: 8, day: 4 }, { index: 9, day: 4 }]);
    await tick();
    const strip = el.querySelector('[data-bind="bxs-strip"]');
    assert.equal(strip.hidden, false);
    const chips = el.querySelectorAll('.bxs-chip');
    assert.equal(chips.length, 2, 'idx 0 skipped, dupe collapsed');
    // Headless getProvider() is null → RNG poll returns 0n → still waiting.
    const cta = chips[0].querySelector('.bxs-open-cta');
    assert.equal(cta.disabled, true);
    assert.equal(cta.textContent, 'RNG PENDING');
    assert.equal(chips[0].querySelector('.bxs-chip-status'), null,
      'the compact chip does not repeat a waiting sentence');
    assert.equal(chips[0].querySelector('.bxs-chip-amount').textContent, '0.01 ETH');
    assert.equal(chips[0].querySelector('.bxs-chip-title').textContent, 'LUCKBOX');
    const pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.length, 2, 'purchased boxes enter the shared pending area immediately');
    assert.ok(pending.every((item) => item.state === 'waiting' && item.pinned === true));
    assert.ok(pending.every((item) => item.sharedRng === true && item.phase === 'awaitingRng'),
      'receipt-confirmed boxes join the shared RNG widget before indexer discovery');
    assert.ok(pending.every((item) => item.resolved === false),
      'an unresolved box is visible without pretending its prizes exist');
  });

  test('pass purchase bonus boxes enter the same Pending feed', async () => {
    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();
    firePassTxConfirmed([{
      index: 18,
      day: null,
      amountWei: 40_000_000_000n,
      hasLootboxLeg: true,
      hasPresaleLeg: false,
    }]);
    await tick();

    const pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, 'lootbox:18');
    assert.equal(pending[0].label, 'Luckbox');
    assert.equal(pending[0].amountLabel, '0.04 ETH');
    el.disconnectedCallback();
  });

  test('broadcast purchase appears immediately and a failed tx removes only its placeholder', async () => {
    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();

    fireTxSubmitted('0xnewbox');
    let pending = pendingActionsMod.getPendingActions();
    const submitted = pending.find((item) => item.id === 'lootbox:submitted:0xnewbox');
    assert.ok(submitted, 'the box is visible as soon as the wallet broadcasts the purchase');
    assert.equal(submitted.phase, 'submitting');
    assert.equal(submitted.sharedRng, false, 'RNG starts only after the purchase confirms');
    assert.equal(submitted.shortLabel, 'Transaction sent');
    assert.ok(pending.some((item) => item.id === 'lootbox:8'),
      'an older unresolved box remains alongside the new transaction');

    fireTxFailed('0xnewbox');
    pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.some((item) => item.id === 'lootbox:submitted:0xnewbox'), false,
      'only the failed transaction placeholder is retired');
    assert.ok(pending.some((item) => item.id === 'lootbox:8'),
      'failure cannot disturb an unrelated pending box');
    const stored = JSON.parse(localStorage.getItem(KEY));
    assert.deepEqual(stored.map((row) => row.index), [8]);
    el.disconnectedCallback();
  });

  test('confirmation atomically promotes the exact submitted placeholder into its RNG index', async () => {
    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxSubmitted('0xpromote');
    assert.ok(pendingActionsMod.getPendingActions()
      .some((item) => item.id === 'lootbox:submitted:0xpromote'));

    fireTxConfirmed([{ index: 12, day: 5 }], {
      player: ADDR,
      submittedTransactionHash: '0xpromote',
    });
    await tick();
    const pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.some((item) => item.id === 'lootbox:submitted:0xpromote'), false);
    assert.equal(pending.filter((item) => item.id === 'lootbox:12').length, 1,
      'confirmation creates one durable RNG row without duplicating the purchase');
    el.disconnectedCallback();
  });

  test('regular and presale purchases sharing one RNG index merge into one complete open action', async () => {
    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();

    fireTxConfirmed([{
      index: 8, day: 4, amountWei: 10_000_000_000n,
      hasLootboxLeg: true, hasPresaleLeg: false,
    }], {
      transactionHash: '0xregular',
      lootBoxAmountWei: 10_000_000_000n,
      presaleBoxAmountWei: 0n,
    });
    fireTxConfirmed([{
      index: 8, day: null, amountWei: 20_000_000_000n,
      hasLootboxLeg: false, hasPresaleLeg: true,
    }], {
      transactionHash: '0xpresale',
      lootBoxAmountWei: 0n,
      presaleBoxAmountWei: 20_000_000_000n,
    });
    await tick();

    const pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.length, 1, 'one RNG batch remains one click target');
    assert.equal(pending[0].label, 'Luckbox + presale box');
    assert.equal(pending[0].lootboxLabel, 'LUCKBOX + PRESALE BOX');
    assert.equal(pending[0].amountLabel, '0.03 ETH');
    const stored = JSON.parse(globalThis.localStorage.getItem(KEY));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].hasLootboxLeg, true);
    assert.equal(stored[0].hasPresaleLeg, true,
      'the later presale leg is merged instead of discarded as a duplicate index');
    assert.deepEqual(stored[0].transactionHashes.sort(), ['0xpresale', '0xregular'],
      'both purchase receipts survive reload for durable kind recovery');
    el.disconnectedCallback();
  });

  test('a reloaded regular row rediscovers a later presale purchase from both receipt hashes', async () => {
    const regularWei = 10_000_000_000n;
    const presaleWei = 20_000_000_000n;
    globalThis.localStorage.setItem(KEY, JSON.stringify([{
      index: 8,
      resultKey: '8',
      transactionHash: '0xregular',
      amountWei: String(regularWei),
      hasLootboxLeg: true,
      hasPresaleLeg: false,
      fromReceipt: true,
      ready: false,
      resolved: false,
    }]));
    const receiptFor = (hash) => ({
      logs: [{
        parsed: hash === '0xpresale'
          ? { name: 'PresaleBoxBuy', args: { buyer: ADDR, index: 8n, amount: presaleWei } }
          : { name: 'LootBoxBuy', args: { buyer: ADDR, index: 8n, amount: regularWei } },
      }],
    });
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
      getSigner: async () => ({ getAddress: async () => ADDR }),
      getTransactionReceipt: async (hash) => receiptFor(hash),
    });
    lootboxMod.__setContractFactoryForTest(() => ({
      interface: { parseLog: (log) => log.parsed },
      lootboxStatus: async () => [regularWei, false],
      openBox: { staticCall: async () => undefined },
    }));
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('/lootbox/feed')
        ? {
            items: [
              {
                player: ADDR_LC, resolvedIndex: 8, transactionHash: '0xregular',
                costRawWei: String(regularWei), opened: false, rngReady: false, results: [],
              },
              {
                player: ADDR_LC, resolvedIndex: 8, transactionHash: '0xpresale',
                costRawWei: String(presaleWei), opened: false, rngReady: false, results: [],
              },
            ],
          }
        : { items: [] },
    });

    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    for (let i = 0; i < 8; i += 1) await tick();

    const pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].label, 'Luckbox + presale box');
    assert.equal(pending[0].amountLabel, '0.03 ETH');
    const stored = JSON.parse(globalThis.localStorage.getItem(KEY));
    assert.equal(stored[0].hasPresaleLeg, true,
      'immutable PresaleBoxBuy logs heal an old browser row even though the feed omits its kind');
    assert.deepEqual(stored[0].transactionHashes.sort(), ['0xpresale', '0xregular']);
    el.disconnectedCallback();
  });

  test('ready RNG keeps the compact shared receipt while the legacy inline chip can open', async () => {
    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }], { transactionHash: '0xpurchase' });
    await tick();

    const waiting = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.equal(waiting.compact, true, 'the waiting purchase is a compact receipt');
    assert.equal(waiting.lootboxValueTone, 'green', 'one ticket-price unit has the green case');
    assert.equal(waiting.lootboxTicketUnitsLabel, '1×');
    assert.equal(el.querySelector('.bxs-chip').getAttribute('data-lootbox-value-tone'), 'green');
    const storedBeforeOpen = JSON.parse(localStorage.getItem(KEY));
    assert.equal(storedBeforeOpen[0].ticketPriceWei, '10000000000',
      'the purchase-time ticket price survives reloads and later level changes');

    assert.equal(el.__setReadyForTest(8), true);
    const chip = el.querySelector('.bxs-chip');
    const cta = chip.querySelector('.bxs-open-cta');
    assert.equal(chip.querySelector('.bxs-chip-title').textContent, 'LUCKBOX');
    assert.equal(chip.querySelector('.bxs-chip-amount').textContent, '0.01 ETH');
    assert.equal(cta.disabled, false);
    assert.equal(cta.textContent, 'OPEN LUCKBOX');
    assert.match(cta.getAttribute('aria-label'), /Open luckbox 8/);

    const pending = pendingActionsMod.getPendingActions();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, 'lootbox:8');
    assert.equal(pending[0].state, 'ready');
    assert.equal(pending[0].compact, true,
      'the ready box stays x ETH + LOOTBOX instead of exposing a right-side OPEN');
    assert.equal(typeof pending[0].run, 'function');
    el.disconnectedCallback();
  });

  test('a directly queued Degenerette box hides until its presentation completes', async () => {
    const resultKey = 'tx:0xdegenerettebox';
    globalThis.localStorage.setItem(KEY, JSON.stringify([{
      index: 0,
      resultKey,
      transactionHash: '0xdegenerettebox',
      ready: true,
      resolved: true,
      fromReceipt: false,
    }]));
    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();
    assert.ok(
      pendingActionsMod.getPendingActions().some((action) => action.id === `lootbox:${resultKey}`),
      'the indexed copy initially exists in the pending tray',
    );

    revealMod.queueReveal({
      kind: 'lootbox',
      legs: [{ legType: 'opened', lootboxIndex: 0, amount: 1n }],
      lootboxRelease: {
        address: ADDR,
        key: resultKey,
        lootboxIndex: 0,
        transactionHash: '0xdegenerettebox',
      },
    });
    await tick();

    assert.equal(
      pendingActionsMod.getPendingActions().some((action) => action.id === `lootbox:${resultKey}`),
      false,
      'queuing the direct reveal hides the duplicate before its receipt is shown',
    );
    assert.equal(globalThis.localStorage.getItem(revealedBoxesKey(CHAIN.id, ADDR)), null,
      'queuing alone cannot tombstone a result the player has not completed');
    assert.ok(globalThis.localStorage.getItem(KEY),
      'the receipt stays durable while the presentation is active');

    document.dispatchEvent(new CustomEvent(revealMod.LOOTBOX_REVEAL_COMPLETE_EVENT, {
      detail: { address: ADDR, key: resultKey },
    }));
    await tick();
    assert.deepEqual(
      JSON.parse(globalThis.localStorage.getItem(revealedBoxesKey(CHAIN.id, ADDR))),
      [resultKey],
      'completion prevents later indexer polls from rediscovering the opening',
    );
    assert.equal(globalThis.localStorage.getItem(KEY), null,
      'completion removes the now-consumed durable receipt');
    el.disconnectedCallback();
  });

  test('aborting a queued lootbox presentation restores its pending receipt', async () => {
    const resultKey = 'tx:0xabortedbox';
    globalThis.localStorage.setItem(KEY, JSON.stringify([{
      index: 0,
      resultKey,
      transactionHash: '0xabortedbox',
      ready: true,
      resolved: true,
      fromReceipt: false,
    }]));
    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();

    revealMod.queueReveal({
      kind: 'lootbox',
      legs: [{ legType: 'opened', lootboxIndex: 0, amount: 1n }],
      lootboxRelease: {
        address: ADDR,
        key: resultKey,
        lootboxIndex: 0,
        transactionHash: '0xabortedbox',
      },
    });
    await tick();
    assert.equal(pendingActionsMod.getPendingActions().length, 0);

    document.dispatchEvent(new CustomEvent(revealMod.LOOTBOX_REVEAL_ABORT_EVENT, {
      detail: { releases: [{ address: ADDR, key: resultKey }] },
    }));
    await tick();
    assert.ok(pendingActionsMod.getPendingActions()
      .some((action) => action.id === `lootbox:${resultKey}`),
    'closing the overlay puts the uncollected result back in Pending');
    assert.equal(globalThis.localStorage.getItem(revealedBoxesKey(CHAIN.id, ADDR)), null);
    assert.ok(globalThis.localStorage.getItem(KEY));
    el.disconnectedCallback();
  });

  test('clearAll dismisses every tracked box durably without opening it', async () => {
    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }, { index: 9, day: 4 }]);
    await tick();

    const action = pendingActionsMod.getPendingActions()[0];
    assert.equal(typeof action.clearAll, 'function');
    await action.clearAll();

    assert.deepEqual(pendingActionsMod.getPendingActions(), []);
    assert.equal(globalThis.localStorage.getItem(KEY), null);
    assert.deepEqual(
      JSON.parse(globalThis.localStorage.getItem(revealedBoxesKey(CHAIN.id, ADDR))).sort(),
      ['8', '9'],
    );
    assert.equal(el.querySelectorAll('.bxs-chip').length, 0);
    assert.equal(el.querySelector('[data-bind="bxs-strip"]').hidden, true);
    el.disconnectedCallback();
  });

  test('a later purchase sharing a cleared RNG index reappears in Pending', async () => {
    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{
      index: 8, amountWei: 10_000_000_000n,
      hasLootboxLeg: true, hasPresaleLeg: false,
    }], { player: ADDR, transactionHash: '0xoldpurchase' });
    await tick();

    const [oldAction] = pendingActionsMod.getPendingActions();
    const oldDismissKey = oldAction.dismissKey;
    await pendingActionsMod.dismissPendingActionItems([oldAction]);
    assert.equal(pendingActionsMod.getPendingActions().length, 0);
    assert.deepEqual(
      JSON.parse(globalThis.localStorage.getItem(revealedBoxesKey(CHAIN.id, ADDR))),
      ['8'],
    );

    firePassTxConfirmed([{
      index: 8, amountWei: 20_000_000_000n,
      hasLootboxLeg: true, hasPresaleLeg: false,
    }], { transactionHash: '0xnewpasspurchase' });
    await tick();

    const [newAction] = pendingActionsMod.getPendingActions();
    assert.ok(newAction, 'the new purchase is not eaten by the prior CLEAR');
    assert.equal(newAction.id, 'lootbox:8', 'the shared RNG index remains one open action');
    assert.notEqual(newAction.dismissKey, oldDismissKey,
      'the new receipt has a fresh presentation identity');
    assert.equal(globalThis.localStorage.getItem(revealedBoxesKey(CHAIN.id, ADDR)), null,
      'the new mined purchase retires the stale index-only presentation marker');
    el.disconnectedCallback();
  });

  test('an already-resolved box replays without sending openBox', async () => {
    const calls = { status: [], open: [] };
    const fake = {
      lootboxRngWordByIndex: async () => 1n,
      lootboxStatus: async (...args) => {
        calls.status.push(args);
        return [0n, false];
      },
      openBox: Object.assign(
        async (...args) => {
          calls.open.push(args);
          return { hash: '0x', wait: async () => ({ status: 1, logs: [] }) };
        },
        { staticCall: async () => undefined },
      ),
      connect() { return this; },
    };
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
      getSigner: async () => ({ getAddress: async () => ADDR }),
    });
    lootboxMod.__setContractFactoryForTest(() => fake);
    let indexed = false;
    const settledLeg = {
      uid: 'indexed-after-sync-8',
      player: ADDR_LC,
      legType: 'opened',
      lootboxIndex: 8,
      transactionHash: '0xsettledaftersync',
      blockNumber: '101',
      logIndex: 5,
      ord: 106,
      rewardData: {
        amount: '123', futureLevel: 9, futureTickets: 0,
        roundedUp: false, flip: '0',
      },
    };
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => indexed && String(url).includes('/lootbox/legs')
        ? { items: [settledLeg] }
        : { items: [] },
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    el.__setReadyForTest(8);

    const pending = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.ok(pending, 'the tracked box publishes its open action');
    assert.equal(await pending.run(), false,
      'a contentless settled receipt reports that recovery is still pending');

    assert.ok(calls.status.length >= 1, 'the slot is checked before attempting a write');
    assert.ok(calls.status.every(([owner, index]) => owner === ADDR_LC && index === 8n));
    assert.equal(calls.open.length, 0, 'no wallet write for a cleared on-chain slot');
    const recovering = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.ok(recovering, 'a cleared slot remains visible while its indexed result catches up');
    assert.equal(recovering.state, 'ready');
    assert.equal(recovering.resolved, true);
    assert.equal(recovering.shortLabel, 'Syncing result');
    assert.equal(recovering.detail, 'Settlement confirmed · loading the reveal receipt');
    assert.equal(recovering.phase, 'indexing');
    assert.equal(recovering.progress, 'indeterminate');
    assert.ok(globalThis.localStorage.getItem(KEY), 'the receipt row survives the settlement race');
    assert.deepEqual(revealMod.__takeQueuedForTest(), []);

    indexed = true;
    assert.equal(await recovering.run(), true,
      'the same retry opens once its indexed receipt arrives');
    assert.equal(revealMod.__takeQueuedForTest()[0]?.lootboxIndex, 8);
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the loaded reveal temporarily hides its pending receipt');

    document.dispatchEvent(new CustomEvent(revealMod.LOOTBOX_REVEAL_ABORT_EVENT, {
      detail: { releases: [{ address: ADDR, key: '8' }] },
    }));
    await tick();
    const restored = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.equal(restored?.shortLabel, 'View result',
      'closing a loaded reveal cannot regress to the stale syncing label');
    assert.equal(restored?.detail, 'Result indexed · ready to replay');
    assert.equal(restored?.phase, 'result-ready');
    assert.equal(restored?.progress, null);
    el.disconnectedCallback();
  });

  test('a competing opener cannot make a failed write eat the receipt-backed box', async () => {
    let raced = false;
    const calls = { status: 0, open: 0 };
    const fake = {
      lootboxRngWordByIndex: async () => 1n,
      lootboxStatus: async () => {
        calls.status += 1;
        return raced ? [0n, false] : [10_000_000_000n, false];
      },
      openBox: Object.assign(
        async () => {
          calls.open += 1;
          raced = true;
          throw new Error('Box already resolved');
        },
        { staticCall: async () => undefined },
      ),
      queryFilter: async () => [],
      filters: {},
      connect() { return this; },
    };
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
      getSigner: async () => ({ getAddress: async () => ADDR }),
    });
    lootboxMod.__setContractFactoryForTest(() => fake);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    el.__setReadyForTest(8);
    const action = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.equal(await action.run(), false,
      'losing the opener race yields the auto-retry lane instead of a fake completion');

    assert.equal(calls.open, 1, 'this wallet reached the write before losing the race');
    assert.ok(calls.status >= 2, 'the failed write rechecks the cleared amount slot');
    const recovered = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.ok(recovered, 'the box stays present while settlement legs index');
    assert.equal(recovered.resolved, true);
    assert.equal(recovered.state, 'ready');
    assert.equal(recovered.write, false, 'retry becomes a result replay, not another doomed write');
    assert.equal(revealMod.__takeQueuedForTest().length, 0,
      'no incomplete popup is fabricated before indexed result legs arrive');
    el.disconnectedCallback();
  });

  test('tray-only open failures report a visible Pending reason', async () => {
    const failure = new Error('User rejected the request');
    failure.code = 'ACTION_REJECTED';
    const fake = {
      lootboxStatus: async () => [10_000_000_000n, false],
      openBox: Object.assign(async () => { throw failure; }, {
        staticCall: async () => undefined,
      }),
      connect() { return this; },
    };
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
      getSigner: async () => ({ getAddress: async () => ADDR }),
    });
    lootboxMod.__setContractFactoryForTest(() => fake);
    const errors = [];
    const unsubscribe = pendingActionsMod.subscribePendingActionErrors((message) => {
      errors.push(message);
    });

    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    el.__setReadyForTest(8);
    const action = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    await action.run();

    assert.deepEqual(errors, ['Transaction cancelled.'],
      'the production tray receives the reason even though the legacy inline error is absent');
    assert.equal(pendingActionsMod.getPendingActions()[0].state, 'ready',
      'a failed attempt remains available to retry');
    unsubscribe();
    el.disconnectedCallback();
  });

  test('a newly indexed result wins over a stale non-zero RPC slot before openBox', async () => {
    const calls = { status: [], open: [] };
    const fake = {
      lootboxRngWordByIndex: async () => 1n,
      lootboxStatus: async (...args) => {
        calls.status.push(args);
        // Simulate an RPC still serving the block before settlement cleared
        // the amount slot. The immutable indexed leg below is newer.
        return [1n, false];
      },
      openBox: Object.assign(
        async (...args) => {
          calls.open.push(args);
          return { hash: '0xwrong', wait: async () => ({ status: 1, logs: [] }) };
        },
        { staticCall: async () => undefined },
      ),
      connect() { return this; },
    };
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
      getSigner: async () => ({ getAddress: async () => ADDR }),
    });
    lootboxMod.__setContractFactoryForTest(() => fake);

    let indexed = false;
    const settledLeg = {
      uid: 'indexed-8',
      player: ADDR_LC,
      legType: 'opened',
      lootboxIndex: 8,
      transactionHash: '0xsettled',
      blockNumber: '100',
      logIndex: 4,
      ord: 104,
      rewardData: {
        amount: '123', futureLevel: 9, futureTickets: 0,
        roundedUp: false, flip: '0',
      },
    };
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => indexed && String(url).includes('/lootbox/legs')
        ? { items: [settledLeg] }
        : { items: [] },
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    el.__setReadyForTest(8);
    indexed = true;

    const pending = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.ok(pending, 'the pre-indexed snapshot still exposes the open action');
    calls.status.length = 0;
    await pending.run();

    assert.equal(calls.status.length, 0,
      'indexed settlement is authoritative before consulting a potentially stale RPC slot');
    assert.equal(calls.open.length, 0, 'an already-settled box never reaches the wallet write');
    const [replay] = revealMod.__takeQueuedForTest();
    assert.equal(replay?.kind, 'lootbox');
    assert.equal(replay?.lootboxIndex, 8);
    assert.equal(replay?.legs?.[0]?.transactionHash, '0xsettled',
      'the purchase hash cannot mask the later settlement transaction');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the indexed result becomes a reveal and leaves the pending tray');
    el.disconnectedCallback();
  });

  test('an unresolved legacy DB row cannot create a notification for an empty chain slot', async () => {
    const fake = {
      lootboxStatus: async () => [0n, false],
      lootboxRngWordByIndex: async () => 1n,
    };
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
      getSigner: async () => ({ getAddress: async () => ADDR }),
    });
    lootboxMod.__setContractFactoryForTest(() => fake);
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('/lootbox/feed')
        ? {
            items: [{
              player: ADDR_LC,
              resolvedIndex: 88,
              opened: false,
              rngReady: true,
              results: [],
            }],
          }
        : { items: [] },
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    for (let i = 0; i < 10; i += 1) await tick();

    assert.equal(el.querySelectorAll('.bxs-chip').length, 0,
      'DB history is only a candidate; zero live amount prevents a phantom chip');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the bottom tray is not spammed by the stale row');
    assert.equal(globalThis.localStorage.getItem(KEY), null,
      'an unverified database candidate is not persisted as a receipt purchase');
    el.disconnectedCallback();
  });

  test('a receipt-confirmed presale-only box survives the regular zero amount slot', async () => {
    const fake = {
      lootboxStatus: async () => [0n, false],
      openBox: Object.assign(async () => ({ wait: async () => ({ logs: [] }) }), {
        staticCall: async () => undefined,
      }),
    };
    contractsMod.setProvider({
      getNetwork: async () => ({ chainId: BigInt(CHAIN.id) }),
      getSigner: async () => ({ getAddress: async () => ADDR }),
    });
    lootboxMod.__setContractFactoryForTest(() => fake);

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{
      index: 91,
      day: 8,
      amountWei: lootboxMod.PRESALE_BOX_MIN_WEI,
      hasLootboxLeg: false,
      hasPresaleLeg: true,
    }], {
      lootBoxAmountWei: 0n,
      presaleBoxAmountWei: lootboxMod.PRESALE_BOX_MIN_WEI,
    });
    for (let i = 0; i < 8; i += 1) await tick();

    const chip = el.querySelector('.bxs-chip');
    assert.ok(chip, 'the presale box remains present despite lootboxStatus amount zero');
    assert.equal(chip.querySelector('.bxs-chip-title').textContent, 'PRESALE BOX');
    assert.equal(chip.querySelector('.bxs-open-cta').textContent, 'OPEN PRESALE BOX');
    const stored = JSON.parse(globalThis.localStorage.getItem(KEY));
    assert.equal(stored[0].hasLootboxLeg, false);
    assert.equal(stored[0].hasPresaleLeg, true);
    assert.equal(stored[0].resolved, false,
      'the regular mapping cannot falsely settle a presale-only purchase');
    el.disconnectedCallback();
  });

  test('discovers the newest DB-only result and replays every indexed BoxSpin reel', async () => {
    const txHash = '0xfeed';
    const reels = [
      { spinIndex: 0, score: 1, playerTraits: [], resultTraits: [] },
      { spinIndex: 1, score: 2, playerTraits: [], resultTraits: [] },
      { spinIndex: 2, score: 3, playerTraits: [], resultTraits: [] },
    ];
    const legs = [
      {
        uid: 's1', player: ADDR_LC, legType: 'spin', lootboxIndex: null,
        transactionHash: txHash, logIndex: 12, ord: 120,
        spin: {
          spinType: 'flip', spinCount: 3, survived: true,
          payout: '900', ethShare: '0', reels,
        },
      },
      {
        uid: 'r1', player: ADDR_LC, legType: 'opened', lootboxIndex: 77,
        transactionHash: txHash, logIndex: 11, ord: 110,
        rewardData: {
          amount: '100', futureLevel: 5, futureTickets: 0,
          roundedUp: false, flip: '0',
        },
      },
      // A historical result must not flood a browser that has no receipt state.
      {
        uid: 'r0', player: ADDR_LC, legType: 'opened', lootboxIndex: 70,
        transactionHash: '0xold', logIndex: 1, ord: 10,
        rewardData: { amount: '50', futureTickets: 0, roundedUp: false, flip: '0' },
      },
    ];
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('/lootbox/legs')
        ? { items: legs }
        : { items: [] },
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    // This poll performs two database reads plus the chain-read fallback. Wait
    // for its published action instead of relying on one machine-specific tick.
    for (let i = 0; i < 20
      && !pendingActionsMod.getPendingActions().some((action) => action.id === 'lootbox:77');
      i += 1) {
      await tick();
    }

    const chips = el.querySelectorAll('.bxs-chip');
    assert.equal(chips.length, 1, 'only the latest DB-only opening is offered as catch-up');
    assert.equal(chips[0].querySelector('.bxs-chip-title').textContent, 'LUCKBOX');
    assert.equal(chips[0].querySelector('.bxs-open-cta').textContent, 'VIEW RESULT');

    const pending = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:77');
    assert.ok(pending, 'the DB result publishes its own reveal action');
    await pending.run();
    const [replay] = revealMod.__takeQueuedForTest();
    assert.equal(replay.kind, 'lootbox');
    assert.equal(replay.lootboxIndex, 77);
    const spin = replay.legs.find((leg) => leg.legType === 'spin');
    assert.equal(spin.spinCount, 3);
    assert.deepEqual(spin.reels.map((reel) => reel.spinIndex), [0, 1, 2]);
    assert.equal(
      pendingActionsMod.getPendingActions().some((action) => action.id === 'lootbox:77'),
      false,
    );
    assert.equal(globalThis.localStorage.getItem(revealedBoxesKey(CHAIN.id, ADDR)), null,
      'the active presentation is not yet a durable dismissal');
    document.dispatchEvent(new CustomEvent(revealMod.LOOTBOX_REVEAL_COMPLETE_EVENT, {
      detail: { address: ADDR, key: '77' },
    }));
    await tick();
    assert.deepEqual(
      JSON.parse(globalThis.localStorage.getItem(revealedBoxesKey(CHAIN.id, ADDR))),
      ['77'],
    );
    el.disconnectedCallback();

    const remounted = instantiate();
    for (let i = 0; i < 10; i += 1) await tick();
    assert.equal(
      pendingActionsMod.getPendingActions().some((action) => action.id === 'lootbox:77'),
      false,
      'the same indexed result stays dismissed after the controller remounts',
    );
    assert.equal(remounted.querySelectorAll('.bxs-chip').length, 0);
    remounted.disconnectedCallback();
  });

  test('persists pending boxes to chainId+address-scoped localStorage', async () => {
    instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    const stored = JSON.parse(globalThis.localStorage.getItem(KEY));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].index, 8);
    assert.equal(stored[0].day, 4);
    assert.equal(stored[0].fromReceipt, true,
      'only wallet-receipt rows receive the short indexer-lag grace period');
    assert.ok(Number.isFinite(stored[0].createdAt), 'receipt age is persisted for stale-row cleanup');
    assert.match(KEY, /^pending-boxes:84532:0xabcd/, 'chainId + lowercased address in key');
  });

  test('restores pending boxes from localStorage on connect', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify([{ index: 3, day: 2 }, { index: 5, day: 2 }]));
    const el = instantiate();
    storeMod.update('connected.address', ADDR_LC);
    await tick();
    assert.equal(el.querySelectorAll('.bxs-chip').length, 2, 'restored from storage');
  });

  test('disconnect clears the strip (no address → hidden)', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify([{ index: 3, day: 2 }]));
    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    assert.equal(el.querySelector('[data-bind="bxs-strip"]').hidden, false);
    storeMod.update('connected.address', null);
    await tick();
    assert.equal(el.querySelector('[data-bind="bxs-strip"]').hidden, true);
  });
});
