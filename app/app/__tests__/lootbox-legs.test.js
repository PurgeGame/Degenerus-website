// /app/app/__tests__/lootbox-legs.test.js — openBox receipt → prize legs.
// Run: cd website && node --test app/app/__tests__/lootbox-legs.test.js
//
// decodeBoxSpin mirrors database/src/handlers/box-spins.ts bit-for-bit:
//   betId:       bit 63 box-origin | bits 62-60 spin type | bits 59-0 entropy
//   packedSpins: spin i at i*72 → [playerTicket:32 | resultTicket:32 | score:8];
//                bits 216-223 count; bit 224 survived (FLIP only)
// wholeTicketsFromOpened: futureTickets is ×QTY_SCALE(100) pre-Bernoulli;
//   roundedUp adds the Bernoulli +1 (LootboxModule.sol:1378-1389).
// parseOpenLegsFromReceipt: ethers-encoded logs at the GAME address.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  OPEN_EVENTS_ABI,
  decodeBoxSpin,
  enrichLootboxBoonLegs,
  lootboxRewardPresentation,
  wholeTicketsFromOpened,
  parseOpenLegsFromReceipt,
  openLegsFromFeed,
  openLegsFromDegenerettePayouts,
  readOpenLegsFromChain,
  REWARD_TYPE_LABELS,
} from '../lootbox-legs.js';
import { ethers } from '../contracts.js';
import * as contractsMod from '../contracts.js';
import { _testing as pollingTesting } from '../polling.js';
import { CHAIN, CONTRACTS } from '../chain-config.js';

// ---------------------------------------------------------------------------
// decodeBoxSpin
// ---------------------------------------------------------------------------

function packSpin(playerTicket, resultTicket, score) {
  return BigInt(playerTicket) | (BigInt(resultTicket) << 32n) | (BigInt(score) << 64n);
}

describe('lootboxRewardPresentation', () => {
  test('turns compact reward events into exact strength and product copy', () => {
    assert.deepEqual(lootboxRewardPresentation(8, 2_500n), {
      label: 'DECIMATOR BOON',
      value: '+25%',
      detail: 'Adds +25% entry weight to your next Decimator burn, calculated on up to 50K FLIP',
    });
    assert.deepEqual(lootboxRewardPresentation(10, 50n), {
      label: 'DEGEN SCORE BOON',
      value: '+50',
      detail: 'Your next lootbox opening adds 50 Degen Score and +50 quest streak',
    });
    assert.deepEqual(lootboxRewardPresentation(10, 3_500n), {
      label: 'DEITY PASS DISCOUNT',
      value: '−35%',
      detail: 'Your deity pass purchase costs 35% less',
    });
  });

  test('honestly names the one event family whose product category is not encoded', () => {
    const boost = lootboxRewardPresentation(6, 2_500n);
    assert.equal(boost.label, 'PURCHASE BOOST');
    assert.equal(boost.value, '+25%');
    assert.match(boost.detail, /Lootbox or ETH Ticket purchase/i);
    assert.match(boost.detail, /Buy button shows the \+25% BOON badge/i);

    assert.deepEqual(lootboxRewardPresentation(2, 5_000n * (10n ** 18n)), {
      label: 'COINFLIP BOON',
      value: 'BOOST',
      detail: 'Boosts your next manual Coinflip deposit, calculated on up to 100K FLIP',
    });
    assert.deepEqual(lootboxRewardPresentation(
      2,
      5_000n * (10n ** 18n),
      { boonBps: 1_000 },
    ), {
      label: 'COINFLIP BOON',
      value: '+10%',
      detail: 'Your next manual Coinflip deposit gets +10%, calculated on up to 100K FLIP',
    });

    assert.deepEqual(lootboxRewardPresentation(12, 1n), {
      label: 'QUEST STREAK PROTECTION',
      value: '1 MISSED DAY',
      detail: 'Forgives one missed quest day before your streak can reset',
    });
  });
});

describe('enrichLootboxBoonLegs', () => {
  afterEach(() => pollingTesting.resetBoonStateReader());

  test('reads the post-settlement packed state and attaches the exact coinflip tier', async () => {
    let read;
    pollingTesting.setBoonStateReader(async (address, options) => {
      read = { address, options };
      return {
        // Coinflip tier 2 (+10%), awarded on the current day.
        slot0: (2n << 48n) | 62n,
        slot1: 0n,
        currentDay: 62,
      };
    });
    const input = [{
      legType: 'reward',
      rewardType: 2,
      amount: 5_000n * (10n ** 18n),
    }];
    const enriched = await enrichLootboxBoonLegs(input, {
      player: PLAYER,
      blockNumber: 12_345,
    });

    assert.deepEqual(read, {
      address: PLAYER,
      options: { blockTag: 12_345 },
    });
    assert.equal(enriched[0].boonType, 2);
    assert.equal(enriched[0].boonBps, 1_000);
    assert.equal(lootboxRewardPresentation(
      enriched[0].rewardType,
      enriched[0].amount,
      { boonBps: enriched[0].boonBps },
    ).value, '+10%');
  });
});

describe('decodeBoxSpin', () => {
  test('single WWXRP spin: type + count + reels + traits decode', () => {
    // betId: box-origin, type 0 (WWXRP), entropy 12345
    const betId = (1n << 63n) | (0n << 60n) | 12345n;
    // player 0x11223344, result 0x55667788, score 3, count 1
    const packed = packSpin(0x11223344n, 0x55667788n, 3) | (1n << 216n);
    const d = decodeBoxSpin(betId, packed);
    assert.equal(d.boxOrigin, true);
    assert.equal(d.spinType, 'wwxrp');
    assert.equal(d.spinCount, 1);
    assert.equal(d.survived, null, 'survived is FLIP-only');
    assert.equal(d.reels.length, 1);
    assert.equal(d.reels[0].playerTicket, 0x11223344n);
    assert.equal(d.reels[0].resultTicket, 0x55667788n);
    assert.equal(d.reels[0].score, 3);
    // Trait unpack: byte q → {sym: b&7, col: (b>>3)&7}. 0x44 = 0b01000100 →
    // sym 4, col 0 (quadrant bits 7-6 ignored).
    assert.deepEqual(d.reels[0].playerTraits[0], { sym: 4, col: 0 });
  });

  test('three FLIP spins under one survival flip (survived=true)', () => {
    const betId = (1n << 63n) | (1n << 60n) | 7n; // type 1 = FLIP
    const packed = packSpin(1n, 2n, 0)
      | (packSpin(3n, 4n, 5) << 72n)
      | (packSpin(5n, 6n, 9) << 144n)
      | (3n << 216n)   // count 3
      | (1n << 224n);  // survived
    const d = decodeBoxSpin(betId, packed);
    assert.equal(d.spinType, 'flip');
    assert.equal(d.spinCount, 3);
    assert.equal(d.survived, true);
    assert.equal(d.reels.length, 3);
    assert.equal(d.reels[1].score, 5);
    assert.equal(d.reels[2].score, 9);
  });

  test('ETH spin (type 2), survived flag not set → false is still null-for-non-flip', () => {
    const betId = (1n << 63n) | (2n << 60n) | 99n;
    const packed = packSpin(0n, 0n, 0) | (1n << 216n);
    const d = decodeBoxSpin(betId, packed);
    assert.equal(d.spinType, 'eth');
    assert.equal(d.survived, null);
  });
});

// ---------------------------------------------------------------------------
// wholeTicketsFromOpened
// ---------------------------------------------------------------------------

describe('wholeTicketsFromOpened', () => {
  test('scaled 1094 + roundedUp → 11 whole (Bernoulli won)', () => {
    assert.equal(wholeTicketsFromOpened(1094, true), 11);
  });
  test('scaled 1094 without roundUp → 10 whole', () => {
    assert.equal(wholeTicketsFromOpened(1094, false), 10);
  });
  test('exact multiple: 400 → 4 regardless of flag semantics on frac=0', () => {
    assert.equal(wholeTicketsFromOpened(400, false), 4);
  });
  test('zero → 0', () => {
    assert.equal(wholeTicketsFromOpened(0, false), 0);
  });
});

// ---------------------------------------------------------------------------
// parseOpenLegsFromReceipt — ethers-encoded logs
// ---------------------------------------------------------------------------

const iface = new ethers.Interface(OPEN_EVENTS_ABI);
const GAME = CONTRACTS.GAME;
const PLAYER = '0x19986e1466bd20e2a7db92762eb52fa7f3f1987c';
const OTHER = '0x0000000000000000000000000000000000000bad';

function log(eventName, args, address = GAME) {
  const encoded = iface.encodeEventLog(iface.getEvent(eventName), args);
  return { address, topics: encoded.topics, data: encoded.data };
}

describe('parseOpenLegsFromReceipt', () => {
  test('full receipt: opened + dgnrs + reward + spin legs in log order', () => {
    const betId = (1n << 63n) | (1n << 60n) | 42n;
    const packed = (BigInt(0x01) | (BigInt(0x02) << 32n) | (4n << 64n)) | (1n << 216n) | (1n << 224n);
    const receipt = {
      hash: `0x${'ab'.repeat(32)}`,
      logs: [
        log('LootBoxOpened', [PLAYER, 7n, 10_000_000_000n, 6, 1094, ethers.parseEther('120'), true]),
        log('LootBoxDgnrsReward', [PLAYER, 10_000_000_000n, ethers.parseEther('3')]),
        log('LootBoxReward', [PLAYER, 11, 10_000_000_000n, 500n]),
        log('BoxSpin', [PLAYER, betId, packed, ethers.parseEther('240'), 0n]),
      ],
    };
    const legs = parseOpenLegsFromReceipt(receipt, PLAYER);
    assert.equal(legs.length, 4);

    assert.equal(legs[0].legType, 'opened');
    assert.equal(legs[0].transactionHash, receipt.hash,
      'the direct-box presentation keeps the settlement identity');
    assert.equal(legs[0].futureLevel, 6);
    assert.equal(legs[0].wholeTickets, 11, 'scaled 1094 + roundedUp → 11');
    assert.equal(legs[0].flip, ethers.parseEther('120'));

    assert.equal(legs[1].legType, 'dgnrs');
    assert.equal(legs[1].amount, ethers.parseEther('3'));

    assert.equal(legs[2].legType, 'reward');
    assert.equal(legs[2].rewardType, 11);
    assert.equal(legs[2].label, REWARD_TYPE_LABELS[11]);

    assert.equal(legs[3].legType, 'spin');
    assert.equal(legs[3].spinType, 'flip');
    assert.equal(legs[3].survived, true);
    assert.equal(legs[3].payout, ethers.parseEther('240'));
    assert.equal(legs[3].reels.length, 1);
    assert.equal(legs[3].reels[0].score, 4);
  });

  test('whale pass leg decodes as legendary payload', () => {
    const receipt = {
      logs: [log('LootBoxWhalePassJackpot', [PLAYER, 10_000_000_000n, 13, 400, 0, 0])],
    };
    const legs = parseOpenLegsFromReceipt(receipt, PLAYER);
    assert.equal(legs.length, 1);
    assert.equal(legs[0].legType, 'whalepass');
    assert.equal(legs[0].targetLevel, 13);
    assert.equal(legs[0].entriesPerLevel, 400);
  });

  test('player filter drops other players; foreign address logs skipped', () => {
    const receipt = {
      logs: [
        log('LootBoxOpened', [OTHER, 1n, 1n, 2, 100, 0n, false]),
        log('LootBoxOpened', [PLAYER, 2n, 1n, 2, 100, 0n, false], '0x000000000000000000000000000000000000dead'),
      ],
    };
    assert.equal(parseOpenLegsFromReceipt(receipt, PLAYER).length, 0);
    // Without the filter, the GAME-address log still parses.
    assert.equal(parseOpenLegsFromReceipt(receipt).length, 1);
  });

  test('null / empty receipts → []', () => {
    assert.deepEqual(parseOpenLegsFromReceipt(null), []);
    assert.deepEqual(parseOpenLegsFromReceipt({ logs: [] }), []);
  });
});

// ---------------------------------------------------------------------------
// openLegsFromFeed — already-resolved replay by exact indexed box anchor.
// ---------------------------------------------------------------------------

describe('openLegsFromFeed', () => {
  test('rebuilds every same-player leg in the anchored transaction, in log order', () => {
    const tx = `0x${'ab'.repeat(32)}`;
    const packed = packSpin(1n, 2n, 4) | (1n << 216n);
    const spin = decodeBoxSpin((1n << 63n) | 17n, packed);
    const rows = [
      {
        player: PLAYER, transactionHash: tx, logIndex: 13, legType: 'spin',
        spin: { ...spin, payout: '55', ethShare: '4' },
      },
      {
        player: PLAYER, transactionHash: tx, logIndex: 11, legType: 'opened',
        lootboxIndex: '7', boxAmountRawWei: '1000', levelAtOpen: 6,
        rewardData: { futureTickets: 1094, roundedUp: true, flip: '120' },
      },
      {
        player: PLAYER, transactionHash: tx, logIndex: 12, legType: 'reward',
        rewardData: { rewardType: 11, amount: '500' },
      },
      {
        player: OTHER, transactionHash: tx, logIndex: 10, legType: 'opened',
        lootboxIndex: '7', rewardData: { futureTickets: 9999 },
      },
    ];

    const legs = openLegsFromFeed(rows, { player: PLAYER.toUpperCase(), lootboxIndex: 7n });
    assert.deepEqual(legs.map((leg) => leg.legType), ['opened', 'reward', 'spin']);
    assert.equal(legs[0].wholeTickets, 11);
    assert.equal(legs[0].futureLevel, 6);
    assert.equal(legs[1].label, 'Lazy pass discount boon');
    assert.equal(legs[2].payout, 55n);
    assert.equal(legs[2].reels.length, 1);
  });

  test('refuses an unanchored spin-only row because BoxSpin carries no box index', () => {
    assert.deepEqual(openLegsFromFeed([
      {
        player: PLAYER,
        transactionHash: `0x${'cd'.repeat(32)}`,
        logIndex: 1,
        legType: 'spin',
        spin: { spinType: 'flip', reels: [] },
      },
    ], { player: PLAYER, lootboxIndex: 7 }), []);
  });
});

describe('openLegsFromDegenerettePayouts', () => {
  test('turns a large Degenerette win direct-box settlement into revealable legs', () => {
    const legs = openLegsFromDegenerettePayouts([
      {
        rewardType: 'LootBoxReward',
        rewardData: { rewardType: '12', lootboxAmount: '900', amount: '1' },
      },
      {
        rewardType: 'opened',
        rewardData: {
          amount: '900', futureLevel: 44, futureTickets: 325, flip: '700', roundedUp: true,
        },
      },
      {
        rewardType: 'LootBoxDgnrsReward',
        rewardData: { lootboxAmount: '900', dgnrsAmount: '55' },
      },
    ]);

    assert.deepEqual(legs.map((leg) => leg.legType), ['reward', 'opened', 'dgnrs']);
    assert.equal(legs[0].label, 'Quest streak shield');
    assert.equal(legs[1].wholeTickets, 4);
    assert.equal(legs[1].futureLevel, 44);
    assert.equal(legs[2].amount, 55n);
  });
});

describe('readOpenLegsFromChain', () => {
  afterEach(() => contractsMod.clearProvider());

  test('finds the exact indexed open event and rebuilds its whole receipt', async () => {
    const txHash = `0x${'ef'.repeat(32)}`;
    const opened = log('LootBoxOpened', [
      PLAYER, 7n, 1_000n, 6, 400, 120n, false,
    ]);
    contractsMod.setProvider({
      getBlockNumber: async () => CHAIN.deployBlock + 5000,
      getLogs: async (filter) => {
        assert.equal(filter.address.toLowerCase(), GAME.toLowerCase());
        assert.equal(filter.toBlock - filter.fromBlock, 1799);
        return [{ ...opened, transactionHash: txHash }];
      },
      getTransactionReceipt: async (hash) => {
        assert.equal(hash, txHash);
        return {
          logs: [
            opened,
            log('LootBoxReward', [PLAYER, 11, 1_000n, 500n]),
          ],
        };
      },
    });

    const legs = await readOpenLegsFromChain({ player: PLAYER, lootboxIndex: 7 });
    assert.deepEqual(legs.map((leg) => leg.legType), ['opened', 'reward']);
    assert.equal(legs[0].wholeTickets, 4);
    assert.equal(legs[1].label, 'Lazy pass discount boon');
  });

  test('names the real quest shield and never invents a generic bonus boon', () => {
    const tx = `0x${'aa'.repeat(32)}`;
    const rows = [
      {
        player: PLAYER, transactionHash: tx, logIndex: 1, legType: 'opened',
        lootboxIndex: '8', rewardData: { futureTickets: 0, roundedUp: false },
      },
      {
        player: PLAYER, transactionHash: tx, logIndex: 2, legType: 'reward',
        rewardData: { rewardType: 12, amount: '1' },
      },
      {
        player: PLAYER, transactionHash: tx, logIndex: 3, legType: 'reward',
        rewardData: { rewardType: 99, amount: '1' },
      },
    ];
    const legs = openLegsFromFeed(rows, { player: PLAYER, lootboxIndex: 8n });
    assert.equal(legs[1].label, 'Quest streak shield');
    assert.equal(legs[2].label, 'Unknown protocol reward #99');
    assert.ok(legs.every((leg) => !/bonus reward/i.test(String(leg.label || ''))));
  });
});
