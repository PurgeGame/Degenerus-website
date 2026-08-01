// /app/app/__tests__/decimator.test.js — purchase re-exports + Decimator entry.
// Run: cd website && node --test app/app/__tests__/decimator.test.js
//
// Ticket purchases remain the same GAME.purchase() call; entry uses
// FLIP.decimatorBurn(player, amount) with the 1,000-FLIP contract minimum.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as decimatorMod from '../decimator.js';
import * as lootboxMod from '../lootbox.js';
import * as storeMod from '../store.js';
import * as contractsMod from '../contracts.js';

const DECIMATOR_SRC = readFileSync(
  new URL('../decimator.js', import.meta.url),
  'utf8',
);

const CONNECTED = '0xab12000000000000000000000000000000000000';
const FLIP = 10n ** 18n;

function makeFakeProvider() {
  return {
    getNetwork: async () => ({ chainId: 84532n }),
    getSigner: async () => ({ getAddress: async () => CONNECTED }),
  };
}

function makeFakeContract({ staticError = null, sendError = null } = {}) {
  const calls = [];
  const order = [];
  const decimatorBurn = Object.assign(
    async (...args) => {
      calls.push(args);
      order.push('send');
      if (sendError) throw sendError;
      return { hash: '0xdec', wait: async () => ({ status: 1, logs: [] }) };
    },
    {
      staticCall: async (...args) => {
        calls.push(['static', ...args]);
        order.push('static');
        if (staticError) throw staticError;
      },
    },
  );
  return {
    decimatorBurn,
    connect() { return this; },
    _calls: calls,
    _order: order,
  };
}

describe('decimator purchase helper exports', () => {
  test('Module re-exports purchaseEth from lootbox.js (same function reference)', () => {
    assert.equal(
      typeof decimatorMod.purchaseEth,
      'function',
      'purchaseEth is exported as a function',
    );
    assert.ok(
      Object.is(decimatorMod.purchaseEth, lootboxMod.purchaseEth),
      'decimator.purchaseEth IS the same function reference as lootbox.purchaseEth',
    );
    // Source-level grep: re-export from './lootbox.js' is required by CONTEXT
    // D-01 + RESEARCH Example 1 — re-export model preserves Phase 60's
    // closure-form sendTx + requireStaticCall + reason-map registrations.
    assert.match(
      DECIMATOR_SRC,
      /export\s*\{[^}]*purchaseEth[^}]*\}\s*from\s*['"]\.\/lootbox\.js['"]/,
      're-export statement from ./lootbox.js present',
    );
  });

  test('Module re-exports scaledTicketPriceWei from lootbox.js (purchaseCoin dropped — removed on-chain)', () => {
    // Redeploy #7: purchaseCoin no longer exists on the deployed GAME, so the
    // re-export module must NOT surface it; the panel prices tickets via
    // scaledTicketPriceWei instead.
    assert.equal(decimatorMod.purchaseCoin, undefined, 'purchaseCoin NOT exported');
    assert.equal(
      typeof decimatorMod.scaledTicketPriceWei,
      'function',
      'scaledTicketPriceWei is exported as a function',
    );
    assert.ok(
      Object.is(decimatorMod.scaledTicketPriceWei, lootboxMod.scaledTicketPriceWei),
      'decimator.scaledTicketPriceWei IS the same function reference as lootbox.scaledTicketPriceWei',
    );
    assert.match(
      DECIMATOR_SRC,
      /export\s*\{[^}]*scaledTicketPriceWei[^}]*\}\s*from\s*['"]\.\/lootbox\.js['"]/,
      're-export statement (scaledTicketPriceWei) from ./lootbox.js present',
    );
  });

  test('decimator.js source contains NO new register() calls (CF-02)', () => {
    // Phase 60 already registered GameOverPossible / AfKingLockActive /
    // NotApproved on lootbox.js eager import; re-export inherits them.
    // Plan 62-01 adds NO new reason-map registrations.
    // Strip line + block comments before scanning so reference mentions in
    // documentation don't trigger a false positive.
    const code = DECIMATOR_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/^\s*\/\/.*$/gm, '');       // line comments
    const matches = code.match(/\bregister\s*\(/g) || [];
    assert.equal(
      matches.length,
      0,
      'decimator.js MUST NOT contain register() calls (in code) — re-export inherits Phase 60 reason-map',
    );
  });

});

describe('burnForDecimator', () => {
  beforeEach(() => {
    storeMod.__resetForTest();
    storeMod.update('connected.address', CONNECTED);
    storeMod.update('ui.mode', 'self');
    contractsMod.setProvider(makeFakeProvider());
  });

  afterEach(() => {
    decimatorMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
    storeMod.__resetForTest();
  });

  test('preflights then burns the acting player amount through closure-form sendTx', async () => {
    const fake = makeFakeContract();
    decimatorMod.__setContractFactoryForTest(() => fake);
    const amount = 2_500n * FLIP;

    const result = await decimatorMod.burnForDecimator({ amount });

    assert.equal(result.amount, amount);
    assert.deepEqual(fake._order, ['static', 'send']);
    assert.deepEqual(fake._calls[0], ['static', CONNECTED, amount]);
    assert.deepEqual(fake._calls[1], [CONNECTED, amount]);
    assert.equal(result.receipt.status, 1);
    assert.match(
      DECIMATOR_SRC,
      /sendTx\(\s*\(freshSigner\)\s*=>[\s\S]*?\.decimatorBurn\(target, amountWei\)/,
      'write is built with the fresh signer inside sendTx',
    );
  });

  test('rejects values below the contract minimum before constructing a contract', async () => {
    let builds = 0;
    decimatorMod.__setContractFactoryForTest(() => { builds += 1; return makeFakeContract(); });
    await assert.rejects(
      decimatorMod.burnForDecimator({ amount: 999n * FLIP }),
      /minimum.*1,000 FLIP/i,
    );
    assert.equal(builds, 0);
  });

  test('uses Decimator-specific copy for the shared AmountLTMin selector', async () => {
    const error = new Error('reverted');
    error.revert = { name: 'AmountLTMin' };
    decimatorMod.__setContractFactoryForTest(() => makeFakeContract({ staticError: error }));

    await assert.rejects(
      decimatorMod.burnForDecimator({ amount: 1_000n * FLIP }),
      (caught) => caught.code === 'AmountLTMin'
        && /1,000 FLIP/.test(caught.userMessage),
    );
  });

  test('surfaces a closed indexed/chain window clearly', async () => {
    const error = new Error('reverted');
    error.revert = { name: 'NotDecimatorWindow' };
    decimatorMod.__setContractFactoryForTest(() => makeFakeContract({ staticError: error }));

    await assert.rejects(
      decimatorMod.burnForDecimator({ amount: 1_000n * FLIP }),
      (caught) => caught.code === 'NotDecimatorWindow'
        && /entry window is closed/i.test(caught.userMessage),
    );
  });
});
