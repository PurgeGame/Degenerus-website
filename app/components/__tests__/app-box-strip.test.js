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
const packWatchMod = await import('../../app/pack-watch.js');
const revealMod = await import('../reveal-overlay.js');
const {
  lootboxResultLegsReadyForReveal,
  pendingBoxesKey,
  revealedBoxesKey,
} = await import('../app-box-strip.js');
const { CHAIN, CONTRACTS } = await import('../../app/chain-config.js');
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
    packWatchMod.stopPackWatch();
    lootboxMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test('hidden with no connected address / no boxes', async () => {
    const el = instantiate();
    await tick();
    assert.equal(el.querySelector('[data-bind="bxs-strip"]').hidden, true);
  });

  test('keeps a bare zero-value opened anchor pending until its reward leg arrives', () => {
    const openedAnchor = {
      legType: 'opened',
      wholeTickets: 0,
      futureTickets: 0,
      flip: 0n,
      crapsNormalPasses: 0,
      crapsHighPasses: 0,
    };

    assert.equal(lootboxResultLegsReadyForReveal([openedAnchor]), false,
      'an indexed opening event alone does not prove the result transaction is complete');
    assert.equal(lootboxResultLegsReadyForReveal([
      openedAnchor,
      { legType: 'dgnrs', amount: 1n },
    ]), true, 'a companion prize leg completes the indexed result');
    assert.equal(lootboxResultLegsReadyForReveal([{
      ...openedAnchor,
      futureLevel: 20,
      futureTickets: 21,
      roundedUp: true,
      wholeTickets: 21,
    }]), true, 'a concrete ticket award on the opening anchor is complete');
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

  test('a packed combo order survives Pending so its reveal can offer combined or individual views', async () => {
    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();
    const comboOrder = 1n | (1n << 8n) | (2n << 16n);

    fireTxConfirmed([{ index: 27, day: 5 }], {
      player: ADDR,
      transactionHash: '0xcombo',
      boxOrder: comboOrder,
      ticketPriceWei: 10_000_000_000n,
    });
    await tick();

    const stored = JSON.parse(localStorage.getItem(KEY));
    assert.deepEqual(stored[0].boxOrders, [String(comboOrder)],
      'the exact Small/Medium/Large counts remain attached to the shared RNG row');
    const pending = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:27');
    assert.deepEqual(
      pending.lootboxStacks.map((stack) => ({
        label: stack.label, count: stack.count, model: stack.lootboxCaseModel,
      })),
      [
        { label: 'SMALL', count: 1, model: 'small' },
        { label: 'MEDIUM', count: 1, model: 'medium' },
        { label: 'LARGE', count: 2, model: 'large' },
      ],
      'Pending exposes one size-labelled visual stack per tier without duplicating the action',
    );

    el.disconnectedCallback();
    const restored = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();
    assert.deepEqual(JSON.parse(localStorage.getItem(KEY))[0].boxOrders, [String(comboOrder)],
      'reloading does not collapse the combo into one anonymous aggregate box');
    restored.disconnectedCallback();
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
      boxIndexComplete: async () => false,
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
    assert.equal(waiting.lootboxCaseModel, 'small',
      'the pending manifest carries the same physical model into every later surface');
    assert.equal(waiting.lootboxTicketUnitsLabel, '1×');
    assert.doesNotMatch(String(el.querySelector('.bxs-chip').title || ''), /1\s*[×x]/i,
      'the legacy Pending chip keeps the value tone without a redundant 1x tooltip');
    assert.equal(el.querySelector('.bxs-chip').getAttribute('data-lootbox-value-tone'), 'green');
    assert.equal(el.querySelector('.bxs-chip').getAttribute('data-lootbox-case-model'), 'small');
    assert.equal(el.querySelector('.bxs-chip-art').getAttribute('data-lootbox-case-model'), 'small',
      'the legacy strip art and shared Pending manifest resolve to the same SMALL model');
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

  test('a spin-only settled box recovers in the background without sending openBox', async () => {
    const calls = { complete: [], open: [] };
    const fake = {
      lootboxRngWordByIndex: async () => 1n,
      boxIndexComplete: async (...args) => {
        calls.complete.push(args);
        return true;
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
      legType: 'spin',
      lootboxIndex: 8,
      transactionHash: '0xsettledaftersync',
      blockNumber: '101',
      logIndex: 5,
      ord: 106,
      spin: {
        spinType: 'wwxrp', spinCount: 1, payout: '0', ethShare: '0',
        reels: [{
          spinIndex: 0, score: 0, playerTraits: [], resultTraits: [],
        }],
      },
    };
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => indexed && String(url).includes('lootboxIndex=8')
        ? { items: [settledLeg] }
        : { items: [] },
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();

    const pending = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.ok(pending, 'the tracked box remains visible while its result catches up');

    assert.ok(calls.complete.length >= 1, 'the background poll checks the sweep frontier');
    assert.ok(calls.complete.every(([index]) => index === 8n));
    assert.equal(calls.open.length, 0, 'no wallet write for a cleared on-chain slot');
    const recovering = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.ok(recovering, 'a cleared slot remains visible while its indexed result catches up');
    assert.equal(recovering.state, 'waiting');
    assert.equal(recovering.resolved, true);
    assert.equal(recovering.shortLabel, 'Syncing result');
    assert.equal(recovering.detail, 'Settlement confirmed · loading the reveal receipt');
    assert.equal(recovering.phase, 'indexing');
    assert.equal(recovering.progress, 'indeterminate');
    assert.equal(recovering.autoOpen, false,
      'a missing reveal receipt is passive sync work, not an automatic retry action');
    assert.equal(recovering.run, null,
      'the claimed box cannot loop while its immutable result is indexing');
    assert.ok(globalThis.localStorage.getItem(KEY), 'the receipt row survives the settlement race');
    assert.deepEqual(revealMod.__takeQueuedForTest(), []);

    indexed = true;
    await el.__pollForTest();
    const ready = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.equal(ready?.state, 'ready',
      'background polling promotes the receipt once the indexed reveal arrives');
    assert.equal(ready?.shortLabel, 'View result');
    assert.equal(await ready.run(), true,
      'the promoted result opens once without another wallet action');
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
    const calls = { complete: 0, open: 0 };
    const fake = {
      lootboxRngWordByIndex: async () => 1n,
      boxIndexComplete: async () => {
        calls.complete += 1;
        return raced;
      },
      openBox: Object.assign(
        async () => {
          calls.open += 1;
          raced = true;
          throw new Error('Box already resolved');
        },
        {
          staticCall: async () => {
            if (raced) throw new Error('Box already resolved');
          },
        },
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
      'losing the opener race yields passive result synchronization instead of fake completion');

    assert.equal(calls.open, 1, 'this wallet reached the write before losing the race');
    assert.ok(calls.complete >= 1, 'the failed write checks whether the sweep frontier advanced');
    const recovered = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.ok(recovered, 'the box stays present while settlement legs index');
    assert.equal(recovered.resolved, true);
    assert.equal(recovered.state, 'waiting');
    assert.equal(recovered.run, null,
      'a competing opener cannot start a repeated replay loop while indexing catches up');
    assert.equal(recovered.write, false, 'retry becomes a result replay, not another doomed write');
    assert.equal(revealMod.__takeQueuedForTest().length, 0,
      'no incomplete popup is fabricated before indexed result legs arrive');
    el.disconnectedCallback();
  });

  test('an undecodable failed open fetches the competing opener result instead of retrying forever', async () => {
    let competitorOpened = false;
    let resultIndexed = false;
    let resultReads = 0;
    const calls = { open: 0 };
    const settledLeg = {
      uid: 'competitor-result-8',
      player: ADDR_LC,
      legType: 'opened',
      lootboxIndex: 8,
      transactionHash: '0xcompetitor-result',
      blockNumber: '203',
      logIndex: 2,
      ord: 203_000_002,
      rewardData: {
        amount: '123', futureLevel: 20, futureTickets: 2100,
        roundedUp: false, flip: '0',
      },
    };
    const fake = {
      boxIndexComplete: async () => false,
      openBox: Object.assign(
        async () => {
          calls.open += 1;
          competitorOpened = true;
          const error = new Error('could not coalesce error');
          error.code = 'UNKNOWN_ERROR';
          throw error;
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
    globalThis.fetch = async (url) => {
      const exactRead = competitorOpened && String(url).includes('lootboxIndex=8');
      if (exactRead) resultReads += 1;
      return {
        ok: true,
        status: 200,
        json: async () => exactRead && resultIndexed
          ? { items: [settledLeg] }
          : { items: [] },
      };
    };
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
    assert.equal(await action.run(), false,
      'the failed sender waits honestly while the competing result indexes');
    assert.equal(calls.open, 1, 'the wallet write lost exactly one opener race');
    assert.ok(resultReads >= 1, 'the exact box result is fetched after that failure');
    assert.equal(errors.length, 0, 'a permissionless opener race is not shown as a repeatable error');
    const syncing = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.equal(syncing?.shortLabel, 'Syncing result');
    assert.equal(syncing?.write, false, 'the failed transaction is never offered again');
    assert.equal(syncing?.run, null, 'API catch-up replaces the repeatable wallet action');

    resultIndexed = true;
    await el.__pollForTest();
    const ready = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.equal(ready?.shortLabel, 'View result',
      'the indexed competing result promotes without another transaction');
    assert.equal(await ready.run(), true);
    assert.equal(revealMod.__takeQueuedForTest()[0]?.legs?.[0]?.transactionHash,
      '0xcompetitor-result', 'the competing opener receipt supplies the reveal');
    assert.equal(pendingActionsMod.getPendingActions().some((item) => item.id === 'lootbox:8'), false,
      'the failed transaction is never offered again once its result is recovered');
    unsubscribe();
    el.disconnectedCallback();
  });

  test('a targeted competing openBox settles the box even though the sweep frontier never moves', async () => {
    // Someone else called openBox(player, 8) directly (or the sweep opened this
    // player's entry then ran out of budget mid-index). The boxes are settled
    // and the rewards are credited, but boxCursorIndex has NOT passed 8, so
    // boxIndexComplete(8) stays false indefinitely. Only the revert REASON
    // (NothingToClaim) distinguishes "already opened" from "still waiting".
    let raced = false;
    const calls = { complete: 0, staticCall: 0, open: 0 };
    const nothingToClaim = () => {
      const err = new Error('execution reverted (unknown custom error)');
      err.code = 'CALL_EXCEPTION';
      err.data = '0x969bf728';
      err.revert = { name: 'NothingToClaim', signature: 'NothingToClaim()', args: [] };
      return err;
    };
    const fake = {
      // The frontier is stuck below this index: another player's box at 8 is
      // still unopened, so the sweep has not advanced past it.
      boxIndexComplete: async () => { calls.complete += 1; return false; },
      openBox: Object.assign(
        async () => { calls.open += 1; throw nothingToClaim(); },
        {
          staticCall: async () => {
            calls.staticCall += 1;
            if (raced) throw nothingToClaim();
          },
        },
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
    // The indexer has not caught up with the competitor's settlement yet.
    globalThis.fetch = async () => ({
      ok: true, status: 200, json: async () => ({ items: [] }),
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    el.__setReadyForTest(8);

    const armed = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.equal(armed.state, 'ready', 'the RNG-ready box is armed to open');

    // The competitor lands between the readiness probe and this click.
    raced = true;
    assert.equal(await armed.run(), false, 'the doomed write is not sent');
    assert.equal(calls.open, 0, 'the pre-flight catches the race before the wallet write');

    const after = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.ok(after, 'the receipt-backed box stays present');
    assert.equal(after.resolved, true,
      'NothingToClaim proves settlement even with the sweep frontier behind the index');
    assert.equal(after.shortLabel, 'Syncing result');
    assert.equal(after.detail, 'Settlement confirmed · loading the reveal receipt');
    assert.equal(after.write, false, 'a settled box never offers another wallet write');
    assert.equal(after.run, null, 'no repeatable doomed action is published');

    // The poll must not demote it back to a dead "Waiting for RNG" row.
    await el.__pollForTest();
    const polled = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.ok(polled, 'the box survives the poll');
    assert.equal(polled.resolved, true,
      'the poll cannot un-settle a box the chain has stopped accepting');
    assert.equal(polled.shortLabel, 'Syncing result',
      'a settled box never regresses to the RNG wait it already cleared');
    assert.equal(revealMod.__takeQueuedForTest().length, 0,
      'no popup is fabricated before indexed result legs arrive');
    el.disconnectedCallback();
  });

  test('a competitor landing between the probe and the write is recovered from the wrapped revert', async () => {
    // The tightest window: our readiness probe passes, then the competitor's
    // openBox mines before our wallet broadcast. openLootBox's own pre-flight
    // catches it and rethrows through _structuredRevertError, so the raw ethers
    // error is only reachable on `.cause` — and boxIndexComplete never moves.
    let clicked = false;
    let probesAfterClick = 0;
    let indexed = false;
    const calls = { open: 0 };
    const settledLeg = {
      uid: 'raced-leg-8',
      player: ADDR_LC,
      legType: 'spin',
      lootboxIndex: 8,
      transactionHash: '0xcompetitoropen',
      blockNumber: '202',
      logIndex: 3,
      ord: 220,
      spin: {
        spinType: 'wwxrp', spinCount: 1, payout: '0', ethShare: '0',
        reels: [{ spinIndex: 0, score: 0, playerTraits: [], resultTraits: [] }],
      },
    };
    const fake = {
      boxIndexComplete: async () => false,
      openBox: Object.assign(
        async () => { calls.open += 1; throw new Error('must not be written'); },
        {
          staticCall: async () => {
            if (!clicked) return undefined; // background polls: the box is still live
            probesAfterClick += 1;
            // The strip's readiness probe still sees a live box; openLootBox's
            // own pre-flight, one RPC later, is already too late.
            if (probesAfterClick === 1) return undefined;
            // The competitor's settlement legs index while our write is rejected.
            indexed = true;
            const err = new Error('execution reverted (unknown custom error)');
            err.code = 'CALL_EXCEPTION';
            err.revert = { name: 'NothingToClaim', signature: 'NothingToClaim()', args: [] };
            throw err;
          },
        },
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
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => (indexed && String(url).includes('lootboxIndex=8')
        ? { items: [settledLeg] }
        : { items: [] }),
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    el.__setReadyForTest(8);

    const action = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    clicked = true;
    assert.equal(await action.run(), true,
      'the wrapped NothingToClaim replays the competitor-settled result');
    assert.equal(probesAfterClick, 2, 'the race opened between the two pre-flights');
    assert.equal(calls.open, 0, 'no doomed wallet write is broadcast');
    assert.equal(revealMod.__takeQueuedForTest()[0]?.lootboxIndex, 8,
      'the player still sees the prizes the competitor credited to them');
    el.disconnectedCallback();
  });

  test('the background poll settles a raced box without waiting for a click', async () => {
    // Same race, but the player never clicks: the periodic readiness probe is
    // what must notice, so the chip stops advertising an open that can only fail.
    const nothingToClaim = () => {
      const err = new Error('execution reverted');
      err.code = 'CALL_EXCEPTION';
      err.data = '0x969bf728';
      return err; // no revert.name — selector-only decoding path
    };
    const fake = {
      boxIndexComplete: async () => false,
      openBox: Object.assign(
        async () => { throw new Error('must not be written'); },
        { staticCall: async () => { throw nothingToClaim(); } },
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
      ok: true, status: 200, json: async () => ({ items: [] }),
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    fireTxConfirmed([{ index: 8, day: 4 }]);
    await tick();
    await el.__pollForTest();

    const settled = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.ok(settled, 'the purchase receipt is never discarded');
    assert.equal(settled.resolved, true,
      'the raw NothingToClaim selector settles the box without an ABI-named revert');
    assert.equal(settled.shortLabel, 'Syncing result');
    assert.equal(settled.write, false);
    el.disconnectedCallback();
  });

  test('tray-only open failures report a visible Pending reason', async () => {
    const failure = new Error('User rejected the request');
    failure.code = 'ACTION_REJECTED';
    const fake = {
      boxIndexComplete: async () => false,
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

  test('a bare feed anchor blocks a stale-RPC open until its missing prize projection appears', async () => {
    const calls = { complete: [], open: [] };
    const fake = {
      lootboxRngWordByIndex: async () => 1n,
      boxIndexComplete: async (...args) => {
        calls.complete.push(args);
        // Simulate an RPC still serving the pre-sweep frontier. The immutable
        // indexed settlement leg below is newer.
        return false;
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
    let companionProjected = false;
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
        amount: '123', futureLevel: 20, futureTickets: 0,
        roundedUp: false, flip: '0',
      },
    };
    const companionLeg = {
      uid: 'indexed-8-dgnrs',
      player: ADDR_LC,
      legType: 'dgnrs',
      lootboxIndex: 8,
      transactionHash: '0xsettled',
      blockNumber: '100',
      logIndex: 5,
      ord: 105,
      rewardData: { paid: '1000000000000000000' },
    };
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => indexed && String(url).includes('/lootbox/legs')
        ? { items: companionProjected ? [settledLeg, companionLeg] : [settledLeg] }
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
    calls.complete.length = 0;
    await pending.run();

    assert.equal(calls.complete.length, 0,
      'indexed settlement is authoritative before consulting a potentially stale frontier');
    assert.equal(calls.open.length, 0, 'an already-settled box never reaches the wallet write');
    assert.equal(revealMod.__takeQueuedForTest().length, 0,
      'the cardless anchor is not converted into a zero-result reveal');
    const syncing = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.equal(syncing?.shortLabel, 'Syncing result');
    assert.equal(syncing?.run, null, 'the settled box never offers a second open action');

    companionProjected = true;
    await el.__pollForTest();
    const ready = pendingActionsMod.getPendingActions()
      .find((action) => action.id === 'lootbox:8');
    assert.equal(ready?.shortLabel, 'View result');
    assert.equal(await ready.run(), true);
    const [replay] = revealMod.__takeQueuedForTest();
    assert.equal(replay?.kind, 'lootbox');
    assert.equal(replay?.lootboxIndex, 8);
    assert.equal(replay?.legs?.[0]?.transactionHash, '0xsettled',
      'the purchase hash cannot mask the later settlement transaction');
    assert.equal(replay?.legs?.some((leg) => leg.legType === 'dgnrs'), true,
      'the reveal waits for and includes the companion prize leg');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the indexed result becomes a reveal and leaves the pending tray');
    el.disconnectedCallback();
  });

  test('an unresolved legacy DB row cannot create a notification for an empty chain slot', async () => {
    const fake = {
      boxIndexComplete: async () => true,
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
      'DB history is only a candidate; a completed index prevents a phantom chip');
    assert.equal(pendingActionsMod.getPendingActions().length, 0,
      'the bottom tray is not spammed by the stale row');
    assert.equal(globalThis.localStorage.getItem(KEY), null,
      'an unverified database candidate is not persisted as a receipt purchase');
    el.disconnectedCallback();
  });

  test('a receipt-confirmed presale-only box survives an incomplete shared index', async () => {
    const fake = {
      boxIndexComplete: async () => false,
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
    assert.ok(chip, 'the receipt keeps the presale box present while its index is incomplete');
    assert.equal(chip.querySelector('.bxs-chip-title').textContent, 'PRESALE BOX');
    assert.equal(chip.querySelector('.bxs-open-cta').textContent, 'OPEN PRESALE BOX');
    const stored = JSON.parse(globalThis.localStorage.getItem(KEY));
    assert.equal(stored[0].hasLootboxLeg, false);
    assert.equal(stored[0].hasPresaleLeg, true);
    assert.equal(stored[0].resolved, false,
      'index incompleteness cannot falsely settle a presale-only purchase');
    el.disconnectedCallback();
  });

  test('index-0 opened result uses its raw afKing delivery spend and repairs a cached scaled amount', async () => {
    const openingTransactionHash = '0xafking-open';
    const rawCostWei = 1_000_000_000_000n;
    const evScaledOpenedWei = 1_450_000_000_000n;
    globalThis.localStorage.setItem(KEY, JSON.stringify([{
      index: 0,
      resultKey: `tx:${openingTransactionHash}`,
      transactionHash: openingTransactionHash,
      amountWei: String(evScaledOpenedWei),
      ready: true,
      resolved: true,
    }]));
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('/lootbox/feed')
        ? { items: [] }
        : {
            items: [{
              uid: 'afking-opened',
              player: ADDR_LC,
              legType: 'opened',
              lootboxIndex: 0,
              transactionHash: openingTransactionHash,
              blockNumber: '200',
              logIndex: 2,
              ord: 200_000_002,
              afkingSpendRawWei: String(rawCostWei),
              rewardData: {
                amount: String(evScaledOpenedWei),
                futureTickets: 0,
                roundedUp: false,
                flip: '0',
              },
            }],
          },
    });

    const el = instantiate();
    storeMod.update('connected.address', ADDR);
    await tick();
    await el.__pollForTest();
    for (let i = 0; i < 20
      && !pendingActionsMod.getPendingActions().some((action) => (
        action.id === `lootbox:tx:${openingTransactionHash}`
      )); i += 1) {
      await tick();
    }

    const pending = pendingActionsMod.getPendingActions()
      .find((action) => action.id === `lootbox:tx:${openingTransactionHash}`);
    assert.ok(pending, 'the auto-opened result is published by its transaction key');
    assert.equal(pending.amountWei, String(rawCostWei),
      'AfkingDelivered.weiIn replaces the cached EV-scaled LootBoxOpened amount');
    assert.equal(pending.amountLabel, '1 ETH');
    assert.equal(pending.label, 'Luckbox');
    assert.equal(pending.lootboxLabel, 'LUCKBOX');
    assert.equal(el.querySelector('.bxs-chip-title').textContent, 'LUCKBOX');
    assert.equal(el.querySelector('.bxs-open-cta').getAttribute('aria-label'),
      'View result for luckbox');
    el.disconnectedCallback();
  });

  test('does not publish a Degenerette child box before its awarding result', async () => {
    const transactionHash = `0x${'de'.repeat(32)}`;
    const resolvedTopic = contractsMod.ethers.id(
      'DegeneretteResolved(address,uint64,uint8,uint256,uint32)',
    );
    contractsMod.setProvider({
      getTransactionReceipt: async (hash) => String(hash).toLowerCase() === transactionHash
        ? {
            logs: [{
              address: CONTRACTS.GAME,
              topics: [
                resolvedTopic,
                contractsMod.ethers.zeroPadValue(ADDR, 32),
              ],
            }],
          }
        : null,
    });
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('/lootbox/legs')
        ? {
            items: [{
              uid: 'degenerette-child',
              player: ADDR_LC,
              legType: 'opened',
              lootboxIndex: 0,
              transactionHash,
              blockNumber: '210',
              logIndex: 35,
              ord: 210_000_035,
              rewardData: {
                amount: '14219600000000',
                futureTickets: 21760,
                roundedUp: true,
                flip: '0',
              },
            }],
          }
        : { items: [] },
    });

    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await el.__pollForTest();
    for (let i = 0; i < 10; i += 1) await tick();

    assert.equal(
      pendingActionsMod.getPendingActions().some((action) => (
        action.id === `lootbox:tx:${transactionHash}`
      )),
      false,
      'the parent Degenerette controller remains the only producer and queues parent then child',
    );
    assert.equal(revealMod.__takeQueuedForTest().length, 0,
      'auto-open cannot start a child-only reveal while the awarding reels are still indexing');
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

  test('does not publish settled ticket packs before their parent lootbox is opened', async () => {
    const transactionHash = '0xpack-after-parent';
    const resultKey = '91';
    globalThis.fetch = async (url) => {
      const href = String(url);
      let body = { items: [] };
      if (href.includes('/lootbox/legs')) {
        body = {
          items: [{
            uid: 'settled-ticket-leg',
            player: ADDR_LC,
            legType: 'opened',
            lootboxIndex: Number(resultKey),
            transactionHash,
            blockNumber: '230',
            logIndex: 9,
            ord: 230_000_009,
            rewardData: {
              amount: '10000000000000000',
              futureLevel: 12,
              futureTickets: 100,
              roundedUp: false,
              flip: '0',
            },
          }],
        };
      } else if (href.includes('/tickets/by-trait')) {
        body = {
          address: ADDR_LC,
          level: 12,
          cards: [{
            cardIndex: 0,
            status: 'pending',
            entries: [0, 1, 2, 3].map((entryId) => ({ entryId, traitId: null })),
          }],
        };
      } else if (href.includes('/game/state')) {
        body = { level: 12, jackpotPhaseFlag: true };
      }
      return { ok: true, status: 200, json: async () => body };
    };

    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    packWatchMod.startPackWatch({ getAddress: () => ADDR });
    for (let i = 0; i < 20
      && !pendingActionsMod.getPendingActions().some((action) => action.id === `lootbox:${resultKey}`);
      i += 1) {
      await tick();
    }

    const parent = pendingActionsMod.getPendingActions()
      .find((action) => action.id === `lootbox:${resultKey}`);
    assert.ok(parent, 'the settled parent remains the only Pending action before presentation');
    await parent.run();
    for (let i = 0; i < 10 && packWatchMod.pendingPacks().length === 0; i += 1) await tick();
    const [queuedParent] = revealMod.__takeQueuedForTest();
    assert.ok(queuedParent, 'the authoritative parent result is queued but still unopened');
    assert.equal(packWatchMod.pendingPacks().length, 0,
      'the child ticket pack stays causally sealed behind its unopened parent');

    document.dispatchEvent(new CustomEvent(revealMod.LOOTBOX_REVEAL_COMPLETE_EVENT, {
      detail: {
        ...(queuedParent.lootboxRelease || {}),
        presentationId: queuedParent.presentationId,
        ticketPackRelease: queuedParent.ticketPackRelease,
      },
    }));
    for (let i = 0; i < 10 && packWatchMod.pendingPacks().length === 0; i += 1) await tick();
    assert.equal(packWatchMod.pendingPacks().length, 1,
      'the same genuinely settled ticket award publishes after parent completion');
    el.disconnectedCallback();
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

  test('reload preserves a claimed result as passive sync work with its settlement hash', async () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify([{
      index: 8,
      resultKey: '8',
      transactionHash: '0xpurchase',
      resultTransactionHash: '0xsettlement',
      ready: false,
      resolved: true,
      resultSyncing: true,
      fromReceipt: true,
    }]));
    const el = instantiate({ trayOnly: true });
    storeMod.update('connected.address', ADDR);
    await tick();

    const restored = pendingActionsMod.getPendingActions()
      .find((item) => item.id === 'lootbox:8');
    assert.equal(restored?.state, 'waiting');
    assert.equal(restored?.phase, 'indexing');
    assert.equal(restored?.run, null);
    const stored = JSON.parse(globalThis.localStorage.getItem(KEY));
    assert.equal(stored[0].resultTransactionHash, '0xsettlement');
    assert.equal(stored[0].resultSyncing, true);
    el.disconnectedCallback();
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
