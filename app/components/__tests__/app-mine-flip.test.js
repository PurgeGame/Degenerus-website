// /app/components/__tests__/app-mine-flip.test.js
// Run: cd website && node --test app/components/__tests__/app-mine-flip.test.js
//
// The Mine FLIP controller is intentionally headless. It probes permissionless
// work and publishes one executable descriptor for the fixed bottom tray; it
// must never mount a second button in the navigation bar.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolvePath(__dirname, '../app-mine-flip.js'), 'utf8');
const css = readFileSync(resolvePath(__dirname, '../../styles/app.css'), 'utf8');
const indexHtml = readFileSync(resolvePath(__dirname, '../../index.html'), 'utf8');
const TEST_ADDR = '0xab12000000000000000000000000000000000000';

function makeElement(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    hidden: false,
    attributes: {},
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelector(selector) {
      const wanted = String(selector).toUpperCase();
      const stack = [...this.children];
      while (stack.length) {
        const current = stack.shift();
        if (current.tagName === wanted) return current;
        stack.unshift(...(current.children || []));
      }
      return null;
    },
  };
}

class FakeHTMLElement {}
globalThis.HTMLElement = FakeHTMLElement;

const registry = new Map();
globalThis.customElements = {
  define(name, ctor) { registry.set(name, ctor); },
  get(name) { return registry.get(name); },
};

const body = makeElement('body');
const documentListeners = new Map();
globalThis.document = {
  body,
  hidden: false,
  readyState: 'complete',
  createElement: (tag) => makeElement(tag),
  querySelector: (selector) => body.querySelector(selector),
  addEventListener(type, listener) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(listener);
  },
  removeEventListener(type, listener) {
    const listeners = documentListeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  },
};

const store = await import('../../app/store.js');
const contracts = await import('../../app/contracts.js');
const mineFlip = await import('../../app/mine-flip.js');
const pending = await import('../../app/pending-actions.js');
const module = await import('../app-mine-flip.js');
const { AppMineFlipResolver } = module;

function stubProbe({
  hasWork,
  balanceWei = 10n ** 18n,
  gasEstimate = 100_000n,
  maxFeePerGas = 1_000_000_000n,
} = {}) {
  contracts.setProvider({
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => TEST_ADDR }),
    getBalance: async () => balanceWei,
    getFeeData: async () => ({ maxFeePerGas }),
  });
  mineFlip.__setContractFactoryForTest(() => ({
    mineFlip: Object.assign(
      async () => ({ hash: '0xtx', wait: async () => ({ status: 1, logs: [] }) }),
      {
        estimateGas: async () => gasEstimate,
        staticCall: async () => {
          if (hasWork) return undefined;
          const error = new Error('execution reverted');
          error.revert = { name: 'NoWork' };
          throw error;
        },
      },
    ),
    connect() { return this; },
  }));
}

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

async function mountResolver() {
  const resolver = new AppMineFlipResolver();
  resolver.connectedCallback();
  await settle();
  return resolver;
}

function publishedResolver() {
  return pending.getPendingActions().find((item) => item.source === 'mine-flip-resolver');
}

beforeEach(() => {
  pending.__resetPendingActionsForTest();
  store.__resetForTest();
  mineFlip.__resetContractFactoryForTest();
  contracts.clearProvider();
  body.children = [];
  store.update('ui.mode', 'self');
});

describe('headless Mine FLIP resolver', () => {
  test('publishes ready crank work into the bottom pending-actions registry', async () => {
    store.update('connected.address', TEST_ADDR);
    stubProbe({ hasWork: true });
    const resolver = await mountResolver();

    const action = publishedResolver();
    assert.equal(action?.kind, 'mass-resolution');
    assert.equal(action?.state, 'ready');
    assert.equal(action?.shortLabel, 'Mine FLIP');
    assert.equal(action?.label, 'Mine FLIP');
    assert.equal(action?.icon, '/whitepaper/flame-logo-split.svg');
    assert.equal(action?.order, 1_000, 'Mine FLIP chains after player-owned actions');
    assert.equal(action?.compact, true);
    assert.equal(action?.write, true);
    assert.equal(typeof action?.run, 'function');

    resolver.disconnectedCallback();
    assert.equal(publishedResolver(), undefined, 'disconnect clears a stale tray action');
  });

  test('publishes nothing when there is no acting wallet or no contract work', async () => {
    stubProbe({ hasWork: true });
    const noWallet = await mountResolver();
    assert.equal(publishedResolver(), undefined);
    noWallet.disconnectedCallback();

    store.update('connected.address', TEST_ADDR);
    stubProbe({ hasWork: false });
    const noWork = await mountResolver();
    assert.equal(publishedResolver(), undefined);
    noWork.disconnectedCallback();
  });

  test('does not offer work the wallet cannot afford to mine', async () => {
    store.update('connected.address', TEST_ADDR);
    stubProbe({ hasWork: true, balanceWei: 100n, gasEstimate: 100n, maxFeePerGas: 2n });
    const resolver = await mountResolver();
    assert.equal(publishedResolver(), undefined);
    resolver.disconnectedCallback();
  });

  test('the tray callback re-probes, runs once, and retires consumed work', async () => {
    store.update('connected.address', TEST_ADDR);
    stubProbe({ hasWork: true });
    const resolver = await mountResolver();
    let runs = 0;
    resolver.__queueForTest()[0].run = async () => {
      runs += 1;
      stubProbe({ hasWork: false });
    };

    await publishedResolver().run();
    assert.equal(runs, 1);
    assert.equal(publishedResolver(), undefined);
    resolver.disconnectedCallback();
  });

  test('a raced NoWork result is quiet, while a real failure reaches the tray', async () => {
    store.update('connected.address', TEST_ADDR);
    stubProbe({ hasWork: true });
    const raced = await mountResolver();
    raced.__queueForTest()[0].run = async () => {
      stubProbe({ hasWork: false });
      const error = new Error('Nothing to mine right now.');
      error.code = 'NoWork';
      throw error;
    };
    await assert.doesNotReject(publishedResolver().run());
    assert.equal(publishedResolver(), undefined);
    raced.disconnectedCallback();

    stubProbe({ hasWork: true });
    const failed = await mountResolver();
    failed.__queueForTest()[0].run = async () => {
      const error = new Error('raw');
      error.userMessage = 'Mine FLIP transaction failed.';
      throw error;
    };
    await assert.rejects(publishedResolver().run(), /raw/);
    failed.disconnectedCallback();
  });
});

describe('single-surface mounting', () => {
  test('mounts one hidden controller in body, never a nav button', () => {
    const nav = makeElement('div');
    nav.tagName = 'NAV';
    body.appendChild(nav);

    module._testing.mountResolver();
    module._testing.mountResolver();

    const controllers = body.children.filter((child) => child.tagName === 'APP-MINE-FLIP-RESOLVER');
    assert.equal(controllers.length, 1);
    assert.equal(controllers[0].hidden, true);
    assert.equal(controllers[0].attributes['aria-hidden'], 'true');
    assert.equal(nav.children.length, 0, 'the top bar receives no Mine FLIP element');
  });

  test('source and CSS contain no legacy top-bar control or hover manifest', () => {
    assert.doesNotMatch(src, /<button|mf-cta|mf-chip|mf-pop|mountIntoNav|nav-right|nav-left/);
    assert.doesNotMatch(css, /\.mf-chip|\.mf-pop|app-mine-flip\s*\{/);
    assert.match(src, /publishPendingActions\(RESOLVER_SOURCE/);
    assert.match(indexHtml, /app\/components\/app-mine-flip\.js/,
      'the headless publisher remains loaded by the app shell');
  });

  test('keeps the lifecycle refresh and teardown guards', () => {
    assert.match(src, /_setIntervalUnref/);
    assert.match(src, /visibilitychange/);
    assert.match(src, /if \(seq !== this\.#loadSeq\) return/);
    assert.match(src, /clearPendingActions\(RESOLVER_SOURCE\)/);
  });
});
