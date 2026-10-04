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
// FLIP/WWXRP fixtures in this file are 18-decimal (audits up to 95d88f68b, frozen schema d0e3665a).
// Pin that schema so the suite reads the same under any deployment profile; whole-token units
// (audit eb04b2e80 on) are pinned by whole-token-units.test.js.
import { useSchema as pinTestSchema, BEFORE_WHOLE_TOKENS_SCHEMA_HASH } from '../../chain/schema.js';
pinTestSchema(BEFORE_WHOLE_TOKENS_SCHEMA_HASH);

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
  test('matches the battle multiplier (decBattleMultBps) at every curve knee', () => {
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(0), 10_000n);
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(235), 17_049n);
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(500), 19_000n, '1.9x at 500');
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(1_000), 19_016n);
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(30_000), 20_000n, '2x at 30,000');
    assert.equal(decimatorMod.decimatorActivityMultiplierBps(99_999), 20_000n);
  });

  test('quotes 10% of futurepool for normal Decimators and 30% at x00', () => {
    assert.equal(decimatorMod.decimatorPoolWei(1_000n, 35), 100n);
    assert.equal(decimatorMod.decimatorPoolWei(1_000n, 100), 300n);
  });

  test('times an entry at 0.9 per day since the window opened, floored like _dayFactor', () => {
    assert.equal(decimatorMod.decimatorDayFactorWei(0), 10n ** 18n);
    assert.equal(decimatorMod.decimatorDayFactorWei(1), 9n * 10n ** 17n);
    assert.equal(decimatorMod.decimatorDayFactorWei(2), 81n * 10n ** 16n);
    assert.equal(decimatorMod.decimatorDayFactorWei(3), 729n * 10n ** 15n);
    assert.equal(decimatorMod.decimatorCurrentMultiplierBps({ activityScore: 235 }), 17_049n);
    assert.equal(decimatorMod.decimatorCurrentMultiplierBps({ activityScore: 235, daysLate: 1 }), 15_344n);
  });

  test('credits the exact stack recordDecBurn records, whole FLIP, boon capped at 50k base', () => {
    // 1,704.9 and 1,534.41 FLIP: recordDecBurn keeps whole FLIP of chips (audit 32c604531).
    assert.equal(decimatorMod.decimatorStackCreditWei({ amountWei: 1_000n * FLIP, activityScore: 235 }), 1_704n * FLIP);
    assert.equal(decimatorMod.decimatorStackCreditWei({ amountWei: 1_000n * FLIP, activityScore: 235, daysLate: 1 }),
      1_534n * FLIP);
    // 100k FLIP with a 50% boon: the boost applies to 50k, so 125k base at 2x.
    const boosted = { amountWei: 100_000n * FLIP, activityScore: 30_000, boonBps: 5_000 };
    assert.equal(decimatorMod.decimatorStackCreditWei(boosted), 250_000n * FLIP);
    assert.equal(decimatorMod.decimatorEffectiveMultiplierBps(boosted), 25_000n);
    assert.equal(decimatorMod.decimatorStackCreditWei({ amountWei: 0n }), 0n);
  });

  test('checks and summarizes boards under the normal battle rules', () => {
    const board = 1 | (2 << 9) | (1 << 24);
    assert.deepEqual(decimatorMod.decimatorBoardSummary(board), {
      named: 4, random: 6,
      legs: [{ label: 'PASS', count: 1 }, { label: '6', count: 2 }, { label: 'HARD 8', count: 1 }],
    });
    assert.equal(decimatorMod.decimatorBoardValid(0), true, 'zero leaves all ten to the dice');
    assert.equal(decimatorMod.decimatorBoardValid(board), true);
    assert.equal(decimatorMod.decimatorBoardValid(1 | (1 << 27)), false, 'never both pass lines');
    assert.equal(decimatorMod.decimatorBoardValid(4 << 3), false, 'at most three on a spot');
    assert.equal(decimatorMod.decimatorBoardValid((3 << 3) | (3 << 6) | (2 << 9)), false, 'at most seven named');
    assert.equal(decimatorMod.decimatorBoardValid((3 << 3) | (3 << 6) | (1 << 9)), true);
  });

  test('decodes the battle entry and round words at the generated schema slots', async () => {
    const { fields } = await import('../../chain/generated/game.js');
    assert.equal(fields.decBattleEntries?.slot, '40');
    assert.equal(fields.decBattleRounds?.slot, '41');
    assert.equal(fields.decBattlePlayers?.slot, '43');
    const { ethers } = contractsMod;
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const player = '0x7776145203f4c8f87fffae24593c92ec7d38880c';
    assert.equal(decimatorMod.decimatorPlayerStorageSlot(player, 43n),
      ethers.keccak256(coder.encode(['address', 'uint256'], [player, 43n])));
    assert.equal(decimatorMod.decimatorEntryStorageSlot(35, 9n, 40n),
      ethers.keccak256(coder.encode(['uint256', 'uint256'], [(35n << 64n) | 9n, 40n])));
    assert.equal(decimatorMod.decimatorRoundStorageSlot(35, 41n), ethers.keccak256(coder.encode(['uint256', 'uint256'], [35n, 41n])));
    assert.deepEqual(decimatorMod.decimatorPlayerSlotDecode((35n << 64n) | 9n), { level: 35, entryId: 9n });
    const word = BigInt(player) | (0x1234n << 160n) | (7_000n << 190n);
    assert.deepEqual(decimatorMod.decimatorEntryDecode(word), { owner: BigInt(player), chips: 0x1234, stackWei: 7_000n * FLIP });
    const round = 5n * FLIP | (412n << 128n) | (31n << 192n) | (2n << 216n) | (42n << 224n) | (42n << 232n) | (17n << 240n);
    assert.deepEqual(decimatorMod.decimatorRoundDecode(round), {
      poolWei: 5n * FLIP, entrants: 412, openedDay: 31, phase: 2, capacity: 42, winners: 42, paid: 17,
    });
  });

  test('takes the board from the main Craps widget for the same player', async () => {
    storeMod.__resetForTest();
    storeMod.update('ui.crapsBoard', { player: CONNECTED, chips: 1 | (2 << 9), edited: true });
    assert.equal(await decimatorMod.readDecimatorBoardChips(CONNECTED.toUpperCase().replace('0X', '0x')), 1 | (2 << 9));
    assert.equal(await decimatorMod.readDecimatorBoardChips('0x' + '99'.repeat(20)), 0,
      'another wallet falls back to its own saved board (none readable here)');
    storeMod.__resetForTest();
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
      'event DecimatorBurn(address indexed player, uint256 amountBurned, uint64 entryId)',
    ]);
    const encoded = (amount, blockNumber) => ({
      ...iface.encodeEventLog(iface.getEvent('DecimatorBurn'), [CONNECTED, amount, 1]),
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

  test('includes the opening auto-burn when the phase transition resets the purchase clock past it', async () => {
    const base = Number(CHAIN.deployBlock);
    const opening = base + 6;
    const iface = new contractsMod.ethers.Interface([
      'event DecimatorBurn(address indexed player, uint256 amountBurned, uint64 entryId)',
    ]);
    const burn = {
      ...iface.encodeEventLog(iface.getEvent('DecimatorBurn'), [CONNECTED, 500_000n * FLIP, 7]),
      blockNumber: opening,
    };
    contractsMod.setProvider({
      getBlockNumber: async () => base + 20,
      getBlock: async block => ({ timestamp: 1_000 + (Number(block) - base) * 2 }),
      getLogs: async ({ fromBlock, toBlock }) => burn.blockNumber >= Number(fromBlock)
        && burn.blockNumber <= Number(toBlock) ? [burn] : [],
    });
    assert.equal(await decimatorMod.readDecimatorRawBurnTotal({
      level: 45, sinceTimestamp: 1_030,
    }), 0n, 'the shifted purchase clock misses the existing burn');
    assert.equal(await decimatorMod.readDecimatorRawBurnTotal({
      level: 45, sinceBlock: opening,
    }), 500_000n * FLIP, 'the real opening block includes the same-transaction auto-burn');
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

  test('preflights then burns the acting player amount with the Craps widget board', async () => {
    const fake = makeFakeContract();
    decimatorMod.__setContractFactoryForTest(() => fake);
    const amount = 2_500n * FLIP;
    const board = 1 | (2 << 9) | (1 << 24);
    storeMod.update('ui.crapsBoard', { player: CONNECTED, chips: board, edited: true });

    const result = await decimatorMod.burnForDecimator({ amount });

    assert.equal(result.amount, amount);
    assert.equal(result.chips, board);
    assert.deepEqual(fake._order, ['static', 'send']);
    assert.deepEqual(fake._calls[0], ['static', CONNECTED, amount, board]);
    assert.deepEqual(fake._calls[1], [CONNECTED, amount, board]);
    assert.equal(result.receipt.status, 1);
    assert.match(
      DECIMATOR_SRC,
      /sendTx\(\s*\(freshSigner\)\s*=>[\s\S]*?\.decimatorBurn\(target, amountRaw, board\)/,
      'write is built with the fresh signer inside sendTx',
    );
  });

  test('an explicit board wins, and an invalid one never reaches the contract', async () => {
    const fake = makeFakeContract();
    let builds = 0;
    decimatorMod.__setContractFactoryForTest(() => { builds += 1; return fake; });
    await decimatorMod.burnForDecimator({ amount: 1_000n * FLIP, chips: 0 });
    assert.deepEqual(fake._calls[1], [CONNECTED, 1_000n * FLIP, 0]);
    builds = 0;
    await assert.rejects(
      decimatorMod.burnForDecimator({ amount: 1_000n * FLIP, chips: 1 | (1 << 27) }),
      /not a valid Decimator board/,
    );
    assert.equal(builds, 0);
  });

  test('names the module\'s bare E() revert', async () => {
    const error = new Error('reverted');
    error.revert = { name: 'E' };
    decimatorMod.__setContractFactoryForTest(() => makeFakeContract({ staticError: error }));
    await assert.rejects(
      decimatorMod.burnForDecimator({ amount: 1_000n * FLIP, chips: 0 }),
      (caught) => caught.code === 'DecimatorEntryRejected',
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
