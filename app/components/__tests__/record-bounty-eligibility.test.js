import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { recordBountyUnavailableReason } from '../../app/record-bounty-eligibility.js';
import {
  normalizeRecords, RECORD_KIND_BUY, RECORD_KIND_FLIP,
  RECORD_KIND_SPIN, RECORD_KIND_LUCKBOX, RECORD_KIND_DICE_RUN,
} from '../../app/records.js';
import { update, __resetForTest } from '../../app/store.js';
import { TX_CONFIRMED_EVENT } from '../../app/contracts.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const funded = () => ({
  address: OWNER, walletEthWei: 101n, claimableEthWei: 0n,
  afkingEthWei: 0n, walletFlipWei: 100n, claimableFlipWei: 0n,
});
function reason(kind, funds = funded(), overrides = {}) {
  return recordBountyUnavailableReason({ kind, costWei: 100n }, {
    connected: OWNER, acting: OWNER, mode: 'self', funds,
    gameState: { phase: 'PURCHASE' }, ...overrides,
  });
}

test('bounties require the connected account and balances from that same account', () => {
  assert.equal(reason(RECORD_KIND_BUY), null);
  assert.match(reason(RECORD_KIND_BUY, funded(), { connected: null }), /Connect/);
  for (const mode of ['view', 'operator', 'combined']) {
    assert.match(reason(RECORD_KIND_BUY, funded(), { mode }), /connected account/);
  }
  assert.match(reason(RECORD_KIND_BUY, { ...funded(), address: OTHER }), /loading/);
  assert.match(reason(RECORD_KIND_BUY, null), /loading/);
});

test('ETH sources respect the sentinel, transaction fees, and the action funding route', () => {
  for (const kind of [RECORD_KIND_BUY, RECORD_KIND_LUCKBOX, RECORD_KIND_SPIN]) {
    assert.match(reason(kind, { ...funded(), walletEthWei: 100n }), /Not enough/);
    assert.match(reason(kind, { ...funded(), walletEthWei: 0n, claimableEthWei: 1_000n }), /fees/);
    assert.equal(reason(kind, { ...funded(), walletEthWei: 1n, claimableEthWei: 101n }), null);
    assert.match(reason(kind, { ...funded(), walletEthWei: 1n, claimableEthWei: 100n }), /Not enough/);
  }
  const prepaid = { ...funded(), walletEthWei: 1n, afkingEthWei: 100n };
  assert.equal(reason(RECORD_KIND_BUY, prepaid), null);
  assert.equal(reason(RECORD_KIND_LUCKBOX, prepaid), null);
  assert.match(reason(RECORD_KIND_SPIN, prepaid), /Not enough/);
});

test('Coinflip counts wallet FLIP and claimable winnings without counting committed stakes', () => {
  assert.equal(reason(RECORD_KIND_FLIP, { ...funded(), walletFlipWei: 40n, claimableFlipWei: 60n }), null);
  assert.match(reason(RECORD_KIND_FLIP, {
    ...funded(), walletFlipWei: 40n, claimableFlipWei: 59n, currentStakeWei: 1_000n,
  }), /Not enough/);
  assert.match(reason(RECORD_KIND_FLIP, { ...funded(), walletEthWei: 0n }), /fees/);
});

test('unknown optional funds cannot prevent using independently sufficient known funds', () => {
  assert.equal(reason(RECORD_KIND_BUY, { ...funded(), claimableEthWei: null, afkingEthWei: null }), null);
  assert.equal(reason(RECORD_KIND_FLIP, { ...funded(), claimableFlipWei: null }), null);
  assert.match(reason(RECORD_KIND_BUY, { ...funded(), walletEthWei: 1n, claimableEthWei: null }), /loading/);
  assert.match(reason(RECORD_KIND_FLIP, { ...funded(), walletFlipWei: null }), /loading/);
});

test('ordinary bounty actions remain possible during RNG and jackpot processing', () => {
  for (const kind of [RECORD_KIND_BUY, RECORD_KIND_LUCKBOX, RECORD_KIND_SPIN, RECORD_KIND_FLIP]) {
    assert.equal(reason(kind, funded(), {
      gameState: { phase: 'JACKPOT', rngLockedFlag: true, phaseTransitionActive: true },
    }), null);
    assert.match(reason(kind, funded(), { gameState: { gameOver: true } }), /ended/);
    assert.match(reason(kind, funded(), { gameState: null }), /loading/);
  }
});

// Small DOM harness for the real card listeners and dialog lifecycle. Shell
// bindings are enough; decorative descendants are irrelevant to these checks.
class Element extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  set innerHTML(value) {
    this.children = [];
    for (const match of String(value).matchAll(/data-bind="([^"]+)"/g)) {
      const node = new Element();
      node.setAttribute('data-bind', match[1]);
      this.children.push(node);
    }
  }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  appendChild(node) { this.children.push(node); }
  querySelectorAll(selector) {
    const bind = /data-bind="([^"]+)"/.exec(selector)?.[1];
    return this.children.flatMap((node) => [
      ...(bind && node.getAttribute('data-bind') === bind ? [node] : []),
      ...node.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() {}
}
globalThis.HTMLElement = Element;
globalThis.customElements = {
  registry: new Map(),
  get(name) { return this.registry.get(name); },
  define(name, type) { this.registry.set(name, type); },
};
const {
  __setRecordsRailDepsForTest, __resetRecordsRailDepsForTest,
} = await import('../app-records-rail.js');
const { writeBiggestBountiesModePreference } = await import('../../app/ui-preferences.js');
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise(setImmediate); };
let rail;
afterEach(() => {
  rail?.disconnectedCallback();
  rail = null;
  __resetRecordsRailDepsForTest();
  __resetForTest();
  delete globalThis.document;
  delete globalThis.localStorage;
});

async function mount({ connected = OWNER, funds = async () => ({
  ...funded(), walletEthWei: 10n ** 30n, walletFlipWei: 10n ** 30n,
}), mark = async () => 0n } = {}) {
  globalThis.document = Object.assign(new EventTarget(), {
    createElement: () => new Element(), visibilityState: 'visible',
  });
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
  };
  writeBiggestBountiesModePreference('on');
  update('connected.address', connected);
  update('ui.mode', 'self');
  update('app.gameState', { phase: 'PURCHASE' });
  __setRecordsRailDepsForTest({
    records: async () => normalizeRecords({ records: [{
      kind: RECORD_KIND_DICE_RUN, player: OTHER, value: '1000000',
    }] }),
    profiles: async () => new Map(), mark, price: async () => ({ priceWei: 1n }), funds,
  });
  rail = new (customElements.get('app-records-rail'))();
  rail.connectedCallback();
  await settle();
  return rail;
}
const binding = (name) => rail.querySelector(`[data-bind="${name}"]`);
const leader = (kind) => binding('records-leaders').children.find((node) => Number(node.dataset.kind) === kind);
const click = (node) => node.dispatchEvent(new Event('click', { cancelable: true }));

test('disconnected and unaffordable cards cannot open a dialog, including synthetic clicks', async () => {
  let checks = 0;
  await mount({ connected: null, mark: async () => { checks += 1; return 0n; } });
  assert.equal(leader(RECORD_KIND_SPIN).disabled, true);
  assert.equal(leader(RECORD_KIND_DICE_RUN).disabled, false);
  click(leader(RECORD_KIND_SPIN));
  await settle();
  assert.equal(checks, 0);
  update('connected.address', OWNER);
  await settle();
  assert.equal(leader(RECORD_KIND_SPIN).disabled, false);
  __setRecordsRailDepsForTest({ funds: async () => ({ ...funded(), walletEthWei: 0n }) });
  document.dispatchEvent(new Event(TX_CONFIRMED_EVENT));
  await settle();
  assert.equal(leader(RECORD_KIND_SPIN).disabled, true);
  click(leader(RECORD_KIND_SPIN));
  await settle();
  assert.equal(checks, 0);
});

test('stale account reads cannot enable the new account, and account changes close an open popup', async () => {
  await mount();
  click(leader(RECORD_KIND_SPIN));
  await settle();
  assert.equal(binding('records-bounty-dialog').hidden, false);
  let resolveFunds;
  __setRecordsRailDepsForTest({ funds: () => new Promise((resolve) => { resolveFunds = resolve; }) });
  update('connected.address', OTHER);
  assert.equal(binding('records-bounty-dialog').hidden, true);
  assert.equal(leader(RECORD_KIND_SPIN).disabled, true);
  update('connected.address', null);
  resolveFunds({ ...funded(), address: OTHER, walletEthWei: 10n ** 30n });
  await settle();
  assert.equal(leader(RECORD_KIND_SPIN).disabled, true);
});

test('edited spin amounts and balance or game changes disable confirmation immediately', async () => {
  await mount();
  click(leader(RECORD_KIND_SPIN));
  await settle();
  const confirm = binding('records-bounty-confirm');
  assert.equal(confirm.disabled, false);
  const price = binding('records-bounty-spin-price');
  price.value = '999999999999999999999999999999999';
  price.dispatchEvent(new Event('input'));
  assert.equal(confirm.disabled, true);
  price.value = '20';
  price.dispatchEvent(new Event('input'));
  assert.equal(confirm.disabled, false);
  update('app.gameState', { phase: 'GAMEOVER' });
  assert.equal(confirm.disabled, true);
  assert.equal(leader(RECORD_KIND_SPIN).disabled, true);
  assert.equal(leader(RECORD_KIND_DICE_RUN).disabled, false);
});

test('losing funds during the live target refresh cannot open a stale enabled card', async () => {
  let funds = { ...funded(), walletEthWei: 10n ** 30n };
  await mount({ funds: async () => funds });
  const card = leader(RECORD_KIND_SPIN);
  assert.equal(card.disabled, false);
  funds = { ...funded(), walletEthWei: 0n };
  click(card);
  await settle();
  assert.notEqual(binding('records-bounty-dialog').hidden, false);
  assert.equal(leader(RECORD_KIND_SPIN).disabled, true);
});

test('VIEW keeps the Dice Run replay, and returning to ON refreshes eligibility', async () => {
  let funds = { ...funded(), walletEthWei: 10n ** 30n };
  await mount({ funds: async () => funds });
  writeBiggestBountiesModePreference('view');
  assert.equal(leader(RECORD_KIND_SPIN).disabled, true);
  assert.equal(leader(RECORD_KIND_DICE_RUN).disabled, false);
  funds = { ...funded(), walletEthWei: 0n };
  writeBiggestBountiesModePreference('on');
  await settle();
  assert.equal(leader(RECORD_KIND_SPIN).disabled, true);
});
