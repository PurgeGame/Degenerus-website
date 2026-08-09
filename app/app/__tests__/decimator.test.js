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
import { CHAIN } from '../chain-config.js';

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

describe('live Decimator display math', () => {
  test('matches the deployed piecewise activity multiplier at every curve knee', () => {
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(0), 10_000n);
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(235), 17_049n);
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(500), 17_676n);
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(30_000), 17_833n);
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(99_999), 17_833n);
  });

  test('quotes 10% of futurepool for normal Decimators and 30% at x00', () => {
    assert.equal(decimatorMod.decimatorPoolWei(1_000n, 35), 100n);
    assert.equal(decimatorMod.decimatorPoolWei(1_000n, 100), 300n);
  });

  test('folds timing adjustments into the displayed entry multiplier in contract order', () => {
    assert.equal(decimatorMod.decimatorCurrentMultiplierBps({ activityScore: 235 }), 17_049n);
    assert.equal(decimatorMod.decimatorCurrentMultiplierBps({
      activityScore: 235,
      dayOneActive: true,
      lastPurchaseDay: true,
    }), 18_412n);
  });

  test('quotes added Decimator score with boon and multiplier caps', () => {
    assert.equal(decimatorMod.decimatorEntryScoreWei({
      amountWei: 1_000n * FLIP,
      activityScore: 235,
      dayOneActive: true,
      lastPurchaseDay: true,
    }), 1_841_200_000_000_000_000_000n);
    assert.equal(decimatorMod.decimatorEntryScoreWei({
      amountWei: 100_000n * FLIP,
      previousScoreWei: 200_000n * FLIP,
      activityScore: 30_000,
      boonBps: 5_000,
    }), 125_000n * FLIP, 'past the multiplier cap, only the capped boon base remains');
  });

  test('decodes the day-one byte and current nested burn slot exactly', () => {
    assert.equal(decimatorMod.decimatorDayOneActive(1n << 248n), true);
    assert.equal(decimatorMod.decimatorDayOneActive(0n), false);
    assert.equal(
      decimatorMod.decimatorBurnStorageSlot(
        '0x7776145203f4c8f87fffae24593c92ec7d38880c',
        35,
      ),
      '0xdb9cca4b04e4fa8cc2558955384e79623b0e53611c4b9159a845b8303ffc27f6',
    );
  });
});

describe('live Decimator raw-burn total', () => {
  afterEach(() => {
    decimatorMod.__resetContractFactoryForTest();
    contractsMod.clearProvider();
  });

  test('scans only the current level window and advances its cached log cursor', async () => {
    const base = Number(CHAIN.deployBlock);
    let head = base + 10;
    const iface = new contractsMod.ethers.Interface([
      'event DecimatorBurn(address indexed player, uint256 amountBurned, uint8 bucket)',
    ]);
    const encoded = (amount, blockNumber) => ({
      ...iface.encodeEventLog(iface.getEvent('DecimatorBurn'), [CONNECTED, amount, 0]),
      blockNumber,
    });
    const emitted = [
      encoded(1_250n * FLIP, base + 6),
      encoded(750n * FLIP, base + 12),
    ];
    const ranges = [];
    contractsMod.setProvider({
      getBlockNumber: async () => head,
      getBlock: async (block) => ({ timestamp: 1_000 + (Number(block) - base) * 2 }),
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([Number(fromBlock), Number(toBlock)]);
        return emitted.filter((log) => (
          log.blockNumber >= Number(fromBlock) && log.blockNumber <= Number(toBlock)
        ));
      },
    });

    assert.equal(await decimatorMod.readDecimatorRawBurnTotal({
      level: 35,
      sinceTimestamp: 1_008,
    }), 1_250n * FLIP);
    assert.deepEqual(ranges, [[base + 4, base + 10]],
      'the binary-searched level boundary excludes older burns');

    head = base + 12;
    assert.equal(await decimatorMod.readDecimatorRawBurnTotal({
      level: 35,
      sinceTimestamp: 1_008,
    }), 2_000n * FLIP);
    assert.deepEqual(ranges.at(-1), [base + 11, base + 12],
      'the second poll reads only blocks after the cached cursor');

    ranges.length = 0;
    assert.equal(await decimatorMod.readDecimatorRawBurnTotal({
      level: 36,
      sinceBlock: base + 8,
    }), 750n * FLIP);
    assert.deepEqual(ranges, [[base + 8, base + 12]],
      'an indexed stage-7 block can anchor the window without a timestamp');
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
