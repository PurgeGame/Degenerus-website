import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

class FakeNode extends EventTarget {
  dataset = {};
  attributes = new Map();
  classList = { toggle() {}, remove() {}, add() {} };
  value = '';
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
}
globalThis.HTMLElement = class extends FakeNode {
  nodes = new Map();
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new FakeNode());
    return this.nodes.get(selector);
  }
};
globalThis.customElements = { get() {}, define() {} };

const store = await import('../../app/store.js');
const passes = await import('../../app/passes.js');
const { boonTypePresentation } = await import('../../app/boons.js');
const { AppDeityDesk } = await import('../app-deity-desk.js');
const { setMajorDrawActivity } = await import('../../app/major-draw-activity.js');
const { _resetComponentPollsForTests } = await import('../../app/component-poll.js');

const OWNER = '0xab00000000000000000000000000000000000000';
const settle = async () => { await new Promise(setImmediate); };
let desk;
let day;
let seeds;
let readBoon;
let reads;
let catalogReads;
const node = (name) => desk.querySelector(`[data-bind="deity-desk-${name}"]`);
const rawBoons = () => [seeds.get(day - 1) ?? 0n, day, day === 41 ? 7 : 0, false, true];

beforeEach(() => {
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  store.__resetForTest();
  day = 41;
  seeds = new Map([[40, 555n], [41, 123456789n], [42, 0n]]);
  reads = [];
  catalogReads = 0;
  readBoon = async () => rawBoons();
  passes.__setDeityBoonReadContractFactoryForTest(() => ({
    deityBoonData: async (owner, opts) => {
      reads.push({ owner, opts });
      return readBoon();
    },
  }));
  passes.__setDeityReadContractFactoryForTest(() => ({
    name: async () => { catalogReads++; return 'Degenerus Deity Pass'; },
    ownerOf: async (symbol) => {
      if (symbol === 7) return OWNER;
      throw Object.assign(new Error('InvalidToken'), { data: ethers.id('InvalidToken()').slice(0, 10) });
    },
  }));
  store.update('connected.address', OWNER);
  store.update('ui.chainOk', true);
  store.update('app.daySync', { day, chainBlock: 100, ready: true });
  desk = new AppDeityDesk();
});

afterEach(() => {
  desk.disconnectedCallback();
  setMajorDrawActivity('deity-rollover-test', false);
  _resetComponentPollsForTests();
  passes.__resetDeityBoonReadContractFactoryForTest();
  passes.__resetDeityReadContractFactoryForTest();
  store.__resetForTest();
  delete globalThis.document;
});

test('today’s gifts refresh at rollover while today’s RNG and jackpot are still pending', async () => {
  desk.connectedCallback();
  await settle();
  assert.equal(node('boon-effect-0').textContent, 'ISSUED');
  assert.equal(node('boon-0').disabled, true);
  const priorCatalogReads = catalogReads;
  const priorReads = reads.length;
  setMajorDrawActivity('deity-rollover-test', true); // Ordinary component polls are paused.
  day = 42;
  store.update('app.daySync', { day, chainBlock: 101, rngLocked: true, ready: false });
  assert.equal(node('boon-0').disabled, true, 'yesterday’s buttons are unavailable during the new read');
  await settle();

  assert.equal(seeds.get(42), 0n, 'the new day still has no RNG');
  assert.equal(reads.length, priorReads + 1, 'the day notification triggers a read immediately');
  assert.deepEqual(reads.at(-1).opts, { blockTag: 101 });
  assert.equal(catalogReads, priorCatalogReads, 'rollover does not wait for another ownership scan');
  const expected = passes.deriveDeityBoonSlots({ dailySeed: seeds.get(41), deity: OWNER, day, includeCraps: true });
  for (let slot = 0; slot < 3; slot++) {
    assert.equal(node(`boon-effect-${slot}`).textContent, boonTypePresentation(expected[slot]).effect);
    assert.equal(node(`boon-${slot}`).disabled, false);
  }
  assert.equal(desk.querySelector('[data-bind="deity-desk-budget"] b').textContent, '3');
  store.update('app.daySync', { day, chainBlock: 102, rngLocked: true, ready: false });
  await settle();
  assert.equal(reads.length, priorReads + 1, 'same-day RNG updates do not restart the menu read');
});

test('a late old-day response cannot overwrite the new day’s available gifts', async () => {
  desk.connectedCallback();
  await settle();
  let finishOldRead;
  const old = rawBoons();
  readBoon = () => new Promise((resolve) => { finishOldRead = resolve; });
  document.dispatchEvent(new Event('app-pass:tx-confirmed'));
  day = 42;
  readBoon = async () => rawBoons();
  store.update('app.daySync', { day, chainBlock: 101, ready: false });
  await settle();
  const effect = node('boon-effect-0').textContent;
  finishOldRead(old);
  await settle();
  assert.equal(node('boon-effect-0').textContent, effect);
  assert.equal(node('boon-0').disabled, false);
});

test('an RPC failure keeps verified same-day gifts, but never carries them into another day', async () => {
  day = 42;
  store.update('app.daySync', { day, chainBlock: 101, ready: false });
  desk.connectedCallback();
  await settle();
  const effect = node('boon-effect-0').textContent;
  readBoon = async () => { throw new Error('RPC unavailable'); };
  document.dispatchEvent(new Event('app-pass:tx-confirmed'));
  await settle();
  assert.equal(node('boon-effect-0').textContent, effect);
  assert.equal(node('boon-0').disabled, false);

  day = 43;
  store.update('app.daySync', { day, chainBlock: 102, ready: false });
  await settle();
  assert.equal(node('boon-effect-0').textContent, 'UNAVAILABLE');
  assert.equal(node('boon-0').disabled, true);
  assert.doesNotMatch(node('boon-0').title, /RNG/);
});

test('a missing previous-day seed is distinct from loading or a failed read', async () => {
  seeds.set(40, 0n);
  day = 40;
  store.update('app.daySync', { day, chainBlock: 99, ready: false });
  desk.connectedCallback();
  await settle();
  assert.equal(node('boon-effect-0').textContent, 'RNG MISSING');
  assert.equal(node('boon-0').disabled, true);
  assert.match(node('boon-0').title, /yesterday’s finalized RNG/);
});

test('disconnect removes the rollover listener and reconnect installs it again', async () => {
  desk.connectedCallback();
  await settle();
  desk.disconnectedCallback();
  const count = reads.length;
  day = 42;
  store.update('app.daySync', { day, chainBlock: 101, ready: false });
  await settle();
  assert.equal(reads.length, count);
  desk.connectedCallback();
  await settle();
  assert.equal(node('boon-0').disabled, false);
});
