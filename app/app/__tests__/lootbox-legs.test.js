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
  boxSpinHeroQuadrant,
  deriveHumanLootboxBoonType,
  deriveHumanLootboxSpinBetIds,
  deriveHumanBoxSpinPayoutAtRisk,
  boxSpinFlipSurvivalPayout,
  enrichHumanBoxSpinLegs,
  enrichLootboxBoonLegs,
  lootboxRewardPresentation,
  lootboxPresentationKey,
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

test('lootbox presentation identity converges receipt and indexed paths', () => {
  const tx = `0x${'aa'.repeat(32)}`;
  assert.equal(lootboxPresentationKey(17, tx), '17',
    'a normal box is owned by its shared RNG index even when a receipt hash exists');
  assert.equal(lootboxPresentationKey(0, tx), `tx:${tx}`,
    'a direct/index-zero box remains collision-free by settlement transaction');
  assert.equal(lootboxPresentationKey(null, tx.toUpperCase()), `tx:${tx}`);
  assert.equal(lootboxPresentationKey(null, null), null);
});

describe('lootboxRewardPresentation', () => {
  test('turns compact reward events into exact strength and product copy', () => {
    assert.deepEqual(lootboxRewardPresentation(8, 2_500n), {
      label: 'DECIMATOR BOON',
      value: '+25%',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(10, 50n), {
      label: 'RATING BOON',
      value: '+25',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(10, 25n), {
      label: 'RATING BOON',
      value: '+12.5',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(10, 3_500n), {
      label: 'DEITY PASS BOON',
      value: '−35%',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(13, 32n), {
      label: 'ETH DEGENERETTE BOON',
      value: '+4%',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(13, 36n), {
      label: 'FLIP DEGENERETTE BOON',
      value: '+8%',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(13, 40n), {
      label: 'WWXRP DEGENERETTE BOON',
      value: '+12%',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(13, 0n), {
      label: 'DEGENERETTE BOON',
      value: 'BOOST',
      detail: '',
    });
    assert.equal(REWARD_TYPE_LABELS[13], 'Degenerette boon');
  });

  test('honestly names the one event family whose product category is not encoded', () => {
    const boost = lootboxRewardPresentation(6, 2_500n);
    assert.equal(boost.label, 'LUCKBOX / TICKET BOON');
    assert.equal(boost.value, '+25%');
    assert.equal(boost.detail, '');

    assert.deepEqual(lootboxRewardPresentation(5, 1_500n, { boonType: 6 }), {
      label: 'LUCKBOX BOON',
      value: '+15%',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(5, 1_500n, { boonType: 8 }), {
      label: 'TICKET BOON',
      value: '+15%',
      detail: '',
    });

    assert.deepEqual(lootboxRewardPresentation(2, 5_000n * (10n ** 18n)), {
      label: 'COINFLIP BOON',
      value: 'BOOST',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(
      2,
      5_000n * (10n ** 18n),
      { boonBps: 1_000 },
    ), {
      label: 'COINFLIP BOON',
      value: '+10%',
      detail: '',
    });

    assert.deepEqual(lootboxRewardPresentation(12, 1n), {
      label: 'QUEST SHIELD',
      value: '1 DAY',
      detail: '',
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

  test('resolves a shared boost event to the actual Ticket or Luckbox boon', async () => {
    const reads = [];
    pollingTesting.setBoonStateReader(async (_address, { blockTag }) => {
      reads.push(blockTag);
      return {
        // Purchase tier 2 (+15%) appears in the settlement state only.
        slot0: blockTag === 12_346
          ? (2n << 160n) | (62n << 112n)
          : 0n,
        slot1: 0n,
        currentDay: 62,
      };
    });
    const [enriched] = await enrichLootboxBoonLegs([{
      legType: 'reward',
      rewardType: 5,
      amount: 1_500n,
    }], {
      player: PLAYER,
      blockNumber: 12_346,
    });

    assert.deepEqual(reads, [12_346, 12_345]);
    assert.equal(enriched.boonType, 8);
    assert.deepEqual(lootboxRewardPresentation(
      enriched.rewardType,
      enriched.amount,
      { boonType: enriched.boonType },
    ), {
      label: 'TICKET BOON',
      value: '+15%',
      detail: '',
    });
  });

  test('uses the before/after state delta when both shared boon families are active', async () => {
    const reads = [];
    pollingTesting.setBoonStateReader(async (_address, { blockTag }) => {
      reads.push(blockTag);
      if (blockTag === 12_347) {
        return {
          // Both tier-2 families are active after settlement.
          slot0: (2n << 104n) | (62n << 56n) | (2n << 160n) | (62n << 112n),
          slot1: 0n,
          currentDay: 62,
        };
      }
      return {
        // Only Luckbox tier 2 existed before the reward; Ticket is the delta.
        slot0: (2n << 104n) | (62n << 56n),
        slot1: 0n,
        currentDay: 62,
      };
    });

    const [enriched] = await enrichLootboxBoonLegs([{
      legType: 'reward',
      rewardType: 5,
      amount: 1_500n,
    }], {
      player: PLAYER,
      blockNumber: 12_347,
    });

    assert.deepEqual(reads, [12_347, 12_346]);
    assert.equal(enriched.boonType, 8);
    assert.equal(lootboxRewardPresentation(
      enriched.rewardType,
      enriched.amount,
      { boonType: enriched.boonType },
    ).label, 'TICKET BOON');
  });

  test('does not guess at an ignored lower shared-family roll without committed box context', async () => {
    const unchanged = {
      // Luckbox +15% and Ticket +25% remain unchanged when Ticket +15% rolls.
      slot0: (2n << 104n) | (62n << 56n) | (3n << 160n) | (62n << 112n),
      slot1: 0n,
      currentDay: 62,
    };
    pollingTesting.setBoonStateReader(async () => unchanged);

    const [enriched] = await enrichLootboxBoonLegs([{
      legType: 'reward',
      rewardType: 5,
      amount: 1_500n,
    }], {
      player: PLAYER,
      blockNumber: 12_348,
    });

    assert.equal(enriched.boonType, undefined);
    assert.equal(lootboxRewardPresentation(
      enriched.rewardType,
      enriched.amount,
      { boonType: enriched.boonType },
    ).label, 'LUCKBOX / TICKET BOON');
  });

  test('uses the committed human-box RNG to name an ignored lower Ticket roll exactly', async () => {
    const amount = 100_000_000_000n;
    const context = {
      // Contract-derived vector: the boon draw is Purchase +15% (type 8).
      rngWord: 115n,
      packedBox: amount | (amount << 128n) | (60n << 192n),
      currentLevel: 45,
    };
    assert.equal(deriveHumanLootboxBoonType({ player: PLAYER, ...context }), 8);
    pollingTesting.setBoonStateReader(async () => ({
      // The +15% Ticket roll is ignored behind held +25%; neither family moves.
      slot0: (2n << 104n) | (62n << 56n) | (3n << 160n) | (62n << 112n),
      slot1: 0n,
      currentDay: 62,
    }));

    const [enriched] = await enrichLootboxBoonLegs([{
      legType: 'reward',
      rewardType: 5,
      amount: 1_500n,
    }], {
      player: PLAYER,
      blockNumber: 12_349,
      context,
    });

    assert.equal(enriched.boonType, 8);
    assert.equal(lootboxRewardPresentation(
      enriched.rewardType,
      enriched.amount,
      { boonType: enriched.boonType },
    ).label, 'TICKET BOON');
  });

  test('decodes the current counted-order storage word when naming a shared boon', () => {
    assert.equal(deriveHumanLootboxBoonType({
      player: '0x1111111111111111111111111111111111111111',
      rngWord: 98n,
      packedBox: 0n,
      currentLevel: 45,
    }), null, 'an empty order has no boon draw');

    // Contract-derived vector from the current lootboxOrder layout:
    // level 44, score 60, one small box, no boost/distress/EV adjustment.
    // rngWord 98 produces weighted boon roll 301 => type 5 (Luckbox +5%).
    const packedOrder = 44n | (60n << 24n) | (1n << 81n);
    assert.equal(deriveHumanLootboxBoonType({
      player: '0x1111111111111111111111111111111111111111',
      rngWord: 98n,
      packedBox: packedOrder,
      currentLevel: 45,
    }), 5);
  });

  test('keeps Ticket and Luckbox family identity per event in a counted two-box order', async () => {
    pollingTesting.setBoonStateReader(async () => {
      throw new Error('historical boon state unavailable');
    });
    // Current contract vector: two small boxes at level 44. Nonces 0 and 1
    // draw type 7 (Ticket +5%) then type 6 (Luckbox +15%) from rngWord 48273.
    const packedOrder = 44n | (60n << 24n) | (2n << 81n);
    const enriched = await enrichLootboxBoonLegs([
      { legType: 'reward', rewardType: 4, amount: 500n },
      { legType: 'reward', rewardType: 5, amount: 1_500n },
    ], {
      player: '0x1111111111111111111111111111111111111111',
      blockNumber: 12_351,
      context: { rngWord: 48_273n, packedBox: packedOrder, currentLevel: 45 },
    });

    assert.deepEqual(enriched.map((leg) => leg.boonType), [7, 6]);
    assert.deepEqual(enriched.map((leg) => lootboxRewardPresentation(
      leg.rewardType,
      leg.amount,
      { boonType: leg.boonType },
    ).label), ['TICKET BOON', 'LUCKBOX BOON']);
  });

  test('still derives the exact product when the optional packed-state read fails', async () => {
    const amount = 100_000_000_000n;
    const context = {
      // Contract-derived vector: the boon draw is Purchase +15% (type 8).
      rngWord: 115n,
      packedBox: amount | (amount << 128n) | (60n << 192n),
      currentLevel: 45,
    };
    pollingTesting.setBoonStateReader(async () => {
      throw new Error('wallet RPC has no historical state');
    });

    const [enriched] = await enrichLootboxBoonLegs([{
      legType: 'reward',
      rewardType: 5,
      amount: 1_500n,
    }], {
      player: PLAYER,
      blockNumber: 12_350,
      lootboxIndex: 7,
      context,
    });

    assert.equal(enriched.boonType, 8);
    assert.equal(lootboxRewardPresentation(
      enriched.rewardType,
      enriched.amount,
      { boonType: enriched.boonType },
    ).label, 'TICKET BOON');
  });

  test('uses a unique post-state family when the prior block read is unavailable', async () => {
    pollingTesting.setBoonStateReader(async (_address, { blockTag }) => {
      if (blockTag === 12_350) {
        return {
          // Only the awarded Luckbox +25% family is active after settlement.
          slot0: (3n << 104n) | (62n << 56n),
          slot1: 0n,
          currentDay: 62,
        };
      }
      throw new Error('historical block pruned');
    });

    const [enriched] = await enrichLootboxBoonLegs([{
      legType: 'reward',
      rewardType: 6,
      amount: 2_500n,
    }], {
      player: PLAYER,
      blockNumber: 12_350,
    });

    assert.equal(enriched.boonType, 22);
    assert.equal(lootboxRewardPresentation(
      enriched.rewardType,
      enriched.amount,
      { boonType: enriched.boonType },
    ).label, 'LUCKBOX BOON');
  });
});

describe('human BoxSpin payout enrichment', () => {
  afterEach(() => contractsMod.clearProvider());

  test('reconstructs the exact preliminary FLIP won before a survival bust', async () => {
    const amountWei = 100_000_000_000n;
    const packedBox = amountWei
      | (amountWei << 128n)
      | (60n << 192n);
    const spin = {
      legType: 'spin',
      betId: '10440597654418005774',
      spinType: 'flip',
      survived: false,
      payout: 0n,
      reels: [
        { spinIndex: 0, playerTicket: 0n, resultTicket: 0n, score: 2 },
        { spinIndex: 1, playerTicket: 0n, resultTicket: 0n, score: 0 },
        { spinIndex: 2, playerTicket: 0n, resultTicket: 0n, score: 0 },
      ],
    };
    const context = {
      rngWord: 123_456_789n,
      packedBox,
      currentLevel: 45,
    };

    assert.equal(deriveHumanBoxSpinPayoutAtRisk({
      spin,
      player: PLAYER,
      ...context,
    }), 276_055_367_737_500_000_000n);

    const [enriched] = await enrichHumanBoxSpinLegs([spin], {
      player: PLAYER,
      lootboxIndex: 7,
      blockNumber: 50_000,
      context,
    });
    assert.equal(enriched.preSurvivalPayout, 276_055_367_737_500_000_000n);
  });

  test('leaves non-FLIP and already-exact spin legs untouched', async () => {
    const exact = {
      legType: 'spin', spinType: 'flip', payout: 0n,
      preSurvivalPayout: 42n, reels: [{ score: 2 }],
    };
    const wwxrp = {
      legType: 'spin', spinType: 'wwxrp', payout: 0n, reels: [{ score: 2 }],
    };
    const rows = [exact, wwxrp];
    assert.equal(await enrichHumanBoxSpinLegs(rows, {
      player: PLAYER,
      lootboxIndex: 7,
      blockNumber: 50_000,
    }), rows, 'no historical storage read is needed when no losing FLIP amount is missing');
  });

  test('reads frozen box storage and prefers the indexed settlement level', async () => {
    const amountWei = 100_000_000_000n;
    const packedBox = amountWei | (amountWei << 128n) | (60n << 192n);
    const rngWord = 123_456_789n;
    const index = 7n;
    const outer = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint48', 'uint256'],
      [index, 15n],
    ));
    const boxSlot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bytes32'],
      [PLAYER, outer],
    ));
    const rngSlot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint48', 'uint256'],
      [index, 34n],
    ));
    const timingSlot = ethers.toBeHex(0n, 32);
    const reads = [];
    contractsMod.setProvider({
      async getStorage(address, slot, blockTag) {
        reads.push({ address, slot, blockTag });
        if (slot === boxSlot) return ethers.toBeHex(packedBox, 32);
        if (slot === rngSlot) return ethers.toBeHex(rngWord, 32);
        // A stale/mixed block-level slot must not override the indexer's exact
        // level-at-settlement projection below.
        if (slot === timingSlot) return ethers.toBeHex(12n << 96n, 32);
        return ethers.toBeHex(0n, 32);
      },
    });

    const [enriched] = await enrichHumanBoxSpinLegs([{
      legType: 'spin',
      betId: '10440597654418005774',
      spinType: 'flip',
      levelAtOpen: 44,
      survived: false,
      payout: 0n,
      reels: [
        { spinIndex: 0, playerTicket: 0n, resultTicket: 0n, score: 2 },
        { spinIndex: 1, playerTicket: 0n, resultTicket: 0n, score: 0 },
        { spinIndex: 2, playerTicket: 0n, resultTicket: 0n, score: 0 },
      ],
    }], {
      player: PLAYER,
      lootboxIndex: index,
      blockNumber: 50_000,
    });

    assert.equal(enriched.preSurvivalPayout, 276_055_367_737_500_000_000n);
    assert.deepEqual(reads.map((read) => read.blockTag), [49_999, 49_999, 49_999]);
    assert.deepEqual(new Set(reads.map((read) => read.slot)), new Set([
      boxSlot, rngSlot, timingSlot,
    ]));
    assert.ok(reads.every((read) => read.address === CONTRACTS.GAME));
  });
  // The busted panel can never audit itself: its payout is zero by
  // construction. A survivor can, because the contract publishes the mint that
  // its stake must produce. Pinning that round trip is what makes the number
  // shown on a bust trustworthy.
  test('a survivor replays from the same outcome-independent stake', async () => {
    const oneFlip = 10n ** 18n;
    const amountWei = 100_000_000_000n;
    const packedBox = amountWei | (amountWei << 128n) | (60n << 192n);
    const context = { rngWord: 123_456_789n, packedBox, currentLevel: 45 };
    const reels = [
      { spinIndex: 0, playerTicket: 0n, resultTicket: 0n, score: 2 },
      { spinIndex: 1, playerTicket: 0n, resultTicket: 0n, score: 0 },
      { spinIndex: 2, playerTicket: 0n, resultTicket: 0n, score: 0 },
    ];
    const stake = 276_055_367_737_500_000_000n;
    const base = {
      legType: 'spin', betId: '10440597654418005774', spinType: 'flip', reels,
    };

    // 2 x 276.0553... FLIP sits under FLIP_ROUND_THRESHOLD, so the contract
    // takes the whole-FLIP floor: 552 FLIP.
    assert.equal(boxSpinFlipSurvivalPayout(stake, 123n), 552n * oneFlip);

    const won = { ...base, survived: true, payout: 552n * oneFlip };
    const busted = { ...base, survived: false, payout: 0n };
    const args = { player: PLAYER, lootboxIndex: 7, blockNumber: 50_000, context };
    const [enrichedWon] = await enrichHumanBoxSpinLegs([won], args);
    const [enrichedBusted] = await enrichHumanBoxSpinLegs([busted], args);

    assert.equal(enrichedWon.preSurvivalPayout, stake,
      'the winning branch names the same stake it would have risked');
    assert.equal(enrichedBusted.preSurvivalPayout, stake,
      'the losing branch names it too, from identical inputs');
    assert.equal(enrichedWon.preSurvivalPayout, enrichedBusted.preSurvivalPayout,
      'the stake is a property of the reels and the box, never of the coin');
    assert.equal(
      boxSpinFlipSurvivalPayout(enrichedWon.preSurvivalPayout, 123n),
      _feedPayout(enrichedWon.payout),
      'the derived stake settles back to the payout the chain actually emitted',
    );
  });

  test('a survivor whose payout does not replay publishes no stake', async () => {
    const amountWei = 100_000_000_000n;
    const packedBox = amountWei | (amountWei << 128n) | (60n << 192n);
    const won = {
      legType: 'spin',
      betId: '10440597654418005774',
      spinType: 'flip',
      survived: true,
      // Not reachable from the derived stake under either rounding rule.
      payout: 999n * (10n ** 18n),
      reels: [
        { spinIndex: 0, playerTicket: 0n, resultTicket: 0n, score: 2 },
        { spinIndex: 1, playerTicket: 0n, resultTicket: 0n, score: 0 },
        { spinIndex: 2, playerTicket: 0n, resultTicket: 0n, score: 0 },
      ],
    };
    const [enriched] = await enrichHumanBoxSpinLegs([won], {
      player: PLAYER,
      lootboxIndex: 7,
      blockNumber: 50_000,
      context: { rngWord: 123_456_789n, packedBox, currentLevel: 45 },
    });
    assert.equal(enriched.preSurvivalPayout, undefined,
      'a reconstruction contradicted by the chain is dropped, not displayed');
  });
});

function _feedPayout(value) { return BigInt(value ?? 0); }

describe('decodeBoxSpin', () => {
  test('single WWXRP spin: type + count + reels + traits decode', () => {
    // betId: box-origin, type 0 (WWXRP), entropy 12345
    const betId = (1n << 63n) | (0n << 60n) | 12345n;
    // player 0x11223344, result 0x55667788, score 3, count 1
    const packed = packSpin(0x11223344n, 0x55667788n, 3) | (1n << 216n);
    const d = decodeBoxSpin(betId, packed);
    assert.equal(d.boxOrigin, true);
    assert.equal(d.spinType, 'wwxrp');
    assert.equal(d.heroQuadrant, 1, 'the low seed bits preserve the +2 hero quadrant');
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

  test('the live one-symbol WWXRP win decodes its matching cell as the hero', () => {
    const betId = 9_350_854_869_760_465_101n;
    const packed = (2n << 64n)
      | (4_071_640_845n << 32n)
      | 3_818_745_606n
      | (1n << 216n);
    const decoded = decodeBoxSpin(betId, packed);

    assert.equal(boxSpinHeroQuadrant(betId), 1);
    assert.equal(decoded.heroQuadrant, 1);
    assert.equal(decoded.reels[0].score, 2);
    assert.equal(decoded.reels[0].playerTraits[1].sym, decoded.reels[0].resultTraits[1].sym);
    assert.notEqual(decoded.reels[0].playerTraits[1].col, decoded.reels[0].resultTraits[1].col);
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

  test('record bounty type 3 preserves its identity and FLIP survival on zero payout', () => {
    const betId = (1n << 63n) | (3n << 60n) | 101n;
    const packed = packSpin(1n, 2n, 0)
      | (packSpin(3n, 4n, 2) << 72n)
      | (packSpin(5n, 6n, 1) << 144n)
      | (3n << 216n);
    const d = decodeBoxSpin(betId, packed);

    assert.equal(d.spinType, 'record');
    assert.equal(d.spinCount, 3);
    assert.equal(d.survived, false);
    assert.deepEqual(d.reels.map((reel) => reel.score), [0, 2, 1]);
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
const transferIface = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const GAME = CONTRACTS.GAME;
const PLAYER = '0x19986e1466bd20e2a7db92762eb52fa7f3f1987c';
const OTHER = '0x0000000000000000000000000000000000000bad';
const ZERO = '0x0000000000000000000000000000000000000000';

function log(eventName, args, address = GAME) {
  const encoded = iface.encodeEventLog(iface.getEvent(eventName), args);
  return { address, topics: encoded.topics, data: encoded.data };
}

function transferLog(from, to, value, address = CONTRACTS.WWXRP) {
  const encoded = transferIface.encodeEventLog(transferIface.getEvent('Transfer'), [from, to, value]);
  return { address, topics: encoded.topics, data: encoded.data };
}

describe('parseOpenLegsFromReceipt', () => {
  test('full receipt: opened + dgnrs + reward + spin legs in log order', () => {
    const betId = (1n << 63n) | (1n << 60n) | 42n;
    const packed = (BigInt(0x01) | (BigInt(0x02) << 32n) | (4n << 64n)) | (1n << 216n) | (1n << 224n);
    const receipt = {
      hash: `0x${'ab'.repeat(32)}`,
      blockNumber: 45_678,
      logs: [
        log('LootBoxOpened', [PLAYER, 7n, 10_000_000_000n, 6, 1094, ethers.parseEther('120'), true]),
        log('LootBoxDgnrsBatch', [PLAYER, ethers.parseEther('4'), ethers.parseEther('3')]),
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
    assert.equal(legs[0].futureTickets, 1094);
    assert.equal(legs[0].roundedUp, true);
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
    assert.equal(legs[3].blockNumber, 45_678,
      'receipt normalization retains the settlement block needed for exact replay enrichment');
    assert.equal(legs[3].reels.length, 1);
    assert.equal(legs[3].reels[0].score, 4);
  });

  test('keeps historical LootBoxDgnrsReward receipts replayable', () => {
    const receipt = {
      logs: [log('LootBoxDgnrsReward', [PLAYER, 10_000_000_000n, ethers.parseEther('2')])],
    };
    const legs = parseOpenLegsFromReceipt(receipt, PLAYER);
    assert.deepEqual(legs, [{ legType: 'dgnrs', amount: ethers.parseEther('2') }]);
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

  test('retains the WWXRP cold-bust mint and exact fractional ticket miss', () => {
    const receipt = {
      logs: [
        transferLog(ZERO, PLAYER, ethers.parseEther('9')),
        log('LootBoxOpened', [PLAYER, 7n, 10_000_000_000n, 8, 42, 0n, false]),
      ],
    };
    const legs = parseOpenLegsFromReceipt(receipt, PLAYER);
    assert.deepEqual(legs.map((leg) => leg.legType), ['wwxrp', 'opened']);
    assert.equal(legs[0].amount, ethers.parseEther('9'));
    assert.equal(legs[0].consolation, true);
    assert.equal(legs[1].futureTickets, 42);
    assert.equal(legs[1].roundedUp, false);
    assert.equal(legs[1].wholeTickets, 0);
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
        player: PLAYER, transactionHash: tx, blockNumber: 45_679, logIndex: 13, legType: 'spin',
        spin: {
          ...spin,
          payout: '55',
          ethShare: '4',
          preSurvivalPayout: '27',
          survivalWinPayout: '54',
        },
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
    assert.equal(legs[0].futureTickets, 1094);
    assert.equal(legs[0].roundedUp, true);
    assert.equal(legs[0].futureLevel, 6);
    assert.equal(legs[1].label, 'Lazy pass discount boon');
    assert.equal(legs[2].payout, 55n);
    assert.equal(legs[2].preSurvivalPayout, 27n,
      'an indexed exact pre-survival amount survives feed normalization');
    assert.equal(legs[2].survivalWinPayout, 54n);
    assert.equal(legs[2].blockNumber, 45_679,
      'indexed normalization retains the settlement block needed after a reload');
    assert.equal(legs[2].reels.length, 1);
  });

  test('one indexed chain event produces one leg when feed projections overlap', () => {
    const tx = `0x${'ef'.repeat(32)}`;
    const spin = {
      betId: String((1n << 63n) | (1n << 60n) | 9n),
      spinType: 'flip',
      spinCount: 1,
      survived: true,
      payout: '200',
      ethShare: '0',
      reels: [{ spinIndex: 0, playerTicket: '1', resultTicket: '2', score: 2 }],
    };
    const opened = {
      uid: 'r40', player: PLAYER, transactionHash: tx, logIndex: 40,
      legType: 'opened', lootboxIndex: 7,
      rewardData: { futureTickets: 0, roundedUp: false, flip: '0' },
    };
    const indexedSpin = {
      uid: 's41', player: PLAYER, transactionHash: tx, logIndex: 41,
      legType: 'spin', lootboxIndex: 7, spin,
    };

    const legs = openLegsFromFeed(
      [opened, indexedSpin, { ...indexedSpin, source: 'spin' }],
      { player: PLAYER, lootboxIndex: 7 },
    );
    assert.equal(legs.filter((leg) => leg.legType === 'spin').length, 1,
      'the immutable transaction/log identity wins over duplicate projections');
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

  test('accepts a spin-only row whose deterministic bet id supplied the exact index', () => {
    const tx = `0x${'de'.repeat(32)}`;
    const packed = packSpin(3n, 4n, 5) | (1n << 216n);
    const spin = decodeBoxSpin((1n << 63n) | (2n << 60n) | 29n, packed);
    const rows = [
      {
        player: PLAYER, transactionHash: tx, logIndex: 20, legType: 'reward',
        lootboxIndex: 7, rewardData: { rewardType: 12, amount: '1' },
      },
      {
        player: PLAYER, transactionHash: tx, logIndex: 21, legType: 'spin',
        lootboxIndex: 7,
        spin: { ...spin, payout: '900', ethShare: '600' },
      },
      {
        // A recirculated child spin is part of the same receipt even though its
        // own entropy does not reconstruct the purchased box's id.
        player: PLAYER, transactionHash: tx, logIndex: 22, legType: 'spin',
        lootboxIndex: 7,
        spin: { ...spin, payout: '300', ethShare: '200' },
      },
    ];

    const legs = openLegsFromFeed(rows, { player: PLAYER, lootboxIndex: 7 });
    assert.deepEqual(legs.map((leg) => leg.legType), ['reward', 'spin', 'spin']);
    assert.equal(legs[0].label, 'Quest streak shield');
    assert.equal(legs[1].spinType, 'eth');
    assert.equal(legs[1].payout, 900n);
    assert.equal(legs[2].payout, 300n);
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
        transactionHash: '0xdegenerette-result',
        blockNumber: '5001',
        logIndex: 17,
        lootboxIndex: 0,
        rewardData: {
          amount: '900', futureLevel: 44, futureTickets: 325, flip: '700', roundedUp: true,
        },
      },
      {
        rewardType: 'LootBoxDgnrsBatch',
        rewardData: { requested: '57', paid: '55' },
      },
    ]);

    assert.deepEqual(legs.map((leg) => leg.legType), ['reward', 'opened', 'dgnrs']);
    assert.equal(legs[0].label, 'Quest streak shield');
    assert.equal(legs[1].wholeTickets, 4);
    assert.equal(legs[1].futureTickets, 325);
    assert.equal(legs[1].roundedUp, true);
    assert.equal(legs[1].futureLevel, 44);
    assert.equal(legs[1].transactionHash, '0xdegenerette-result');
    assert.equal(legs[1].blockNumber, '5001');
    assert.equal(legs[1].logIndex, 17);
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

  test('recovers a spin-only result by matching the openBox transaction calldata', async () => {
    const txHash = `0x${'fa'.repeat(32)}`;
    const betId = (1n << 63n) | (1n << 60n) | 42n;
    const packed = packSpin(1n, 2n, 4) | (1n << 216n) | (1n << 224n);
    const spin = {
      ...log('BoxSpin', [PLAYER, betId, packed, ethers.parseEther('12'), 0n]),
      transactionHash: txHash,
      blockNumber: CHAIN.deployBlock + 4_999,
      logIndex: 5,
    };
    const openCall = new ethers.Interface([
      'function openBox(address player, uint48 index)',
    ]);
    contractsMod.setProvider({
      getBlockNumber: async () => CHAIN.deployBlock + 5_000,
      getLogs: async (filter) => (
        filter.topics?.[0] === iface.getEvent('BoxSpin').topicHash ? [spin] : []
      ),
      getTransaction: async (hash) => {
        assert.equal(hash, txHash);
        return {
          to: GAME,
          data: openCall.encodeFunctionData('openBox', [PLAYER, 7n]),
          value: 0n,
        };
      },
      getTransactionReceipt: async (hash) => {
        assert.equal(hash, txHash);
        return { hash: txHash, logs: [spin] };
      },
    });

    const legs = await readOpenLegsFromChain({ player: PLAYER, lootboxIndex: 7 });
    assert.deepEqual(legs.map((leg) => leg.legType), ['spin']);
    assert.equal(legs[0].spinType, 'flip');
    assert.equal(legs[0].payout, ethers.parseEther('12'));
    assert.equal(legs[0].reels.length, 1);
  });

  test('uses the purchase receipt to recover an old spin-only result outside the recent scan', async () => {
    const purchaseHash = `0x${'bc'.repeat(32)}`;
    const openHash = `0x${'cd'.repeat(32)}`;
    const purchaseBlock = CHAIN.deployBlock + 125;
    const spinBlock = purchaseBlock + 240;
    const head = purchaseBlock + 50_000;
    const betId = (1n << 63n) | (1n << 60n) | 77n;
    const packed = packSpin(7n, 8n, 6) | (1n << 216n) | (1n << 224n);
    const spin = {
      ...log('BoxSpin', [PLAYER, betId, packed, ethers.parseEther('3'), 0n]),
      transactionHash: openHash,
      blockNumber: spinBlock,
      logIndex: 2,
    };
    const openCall = new ethers.Interface([
      'function openBox(address player, uint48 index)',
    ]);
    const searchedRanges = [];
    contractsMod.setProvider({
      getBlockNumber: async () => head,
      getLogs: async (filter) => {
        searchedRanges.push([filter.fromBlock, filter.toBlock]);
        const containsSpin = filter.fromBlock <= spinBlock && filter.toBlock >= spinBlock;
        return filter.topics?.[0] === iface.getEvent('BoxSpin').topicHash && containsSpin
          ? [spin]
          : [];
      },
      getTransaction: async (hash) => {
        assert.equal(hash, openHash);
        return {
          to: GAME,
          data: openCall.encodeFunctionData('openBox', [PLAYER, 7n]),
          value: 0n,
        };
      },
      getTransactionReceipt: async (hash) => {
        if (hash === purchaseHash) return { hash, blockNumber: purchaseBlock, logs: [] };
        assert.equal(hash, openHash);
        return { hash, blockNumber: spinBlock, logs: [spin] };
      },
    });

    const legs = await readOpenLegsFromChain({
      player: PLAYER,
      lootboxIndex: 7,
      purchaseTransactionHashes: [purchaseHash],
    });
    assert.deepEqual(legs.map((leg) => leg.legType), ['spin']);
    assert.equal(legs[0].payout, ethers.parseEther('3'));
    assert.ok(searchedRanges.some(([from]) => from === purchaseBlock),
      'recovery starts at the immutable purchase receipt instead of the recent head');
    assert.ok(head - spinBlock > 18_000,
      'the fixture stays beyond the unhinted ten-chunk replay window');
  });

  test('recovers a boosted batch-opened spin by its credited deterministic amount', async () => {
    const purchaseHash = `0x${'12'.repeat(32)}`;
    const batchHash = `0x${'34'.repeat(32)}`;
    const purchaseBlock = CHAIN.deployBlock + 220;
    const spinBlock = purchaseBlock + 18;
    const rngWord = 0x123456789abcdefn;
    const amountWei = 181_136_200_000n;
    const creditedAmountWei = amountWei * 115n / 100n;
    const [betId] = deriveHumanLootboxSpinBetIds({
      rngWord,
      player: PLAYER,
      amountWei: creditedAmountWei,
    });
    const purchase = {
      ...log('LootBoxBuy', [PLAYER, 7n, amountWei]),
      transactionHash: purchaseHash,
      blockNumber: purchaseBlock,
      logIndex: 1,
    };
    const applied = {
      ...log('LootboxRngApplied', [7n, rngWord, 99n]),
      transactionHash: batchHash,
      blockNumber: spinBlock,
      logIndex: 2,
    };
    const packed = packSpin(9n, 10n, 5) | (1n << 216n);
    const spin = {
      ...log('BoxSpin', [PLAYER, betId, packed, 0n, 0n]),
      transactionHash: batchHash,
      blockNumber: spinBlock,
      logIndex: 3,
    };
    let transactionReads = 0;
    contractsMod.setProvider({
      getBlockNumber: async () => spinBlock + 500,
      getLogs: async (filter) => {
        const containsResult = filter.fromBlock <= spinBlock && filter.toBlock >= spinBlock;
        if (!containsResult) return [];
        if (filter.topics?.[0] === iface.getEvent('LootboxRngApplied').topicHash) return [applied];
        if (filter.topics?.[0] === iface.getEvent('BoxSpin').topicHash) return [spin];
        return [];
      },
      getTransaction: async () => {
        transactionReads += 1;
        return { to: GAME, data: '0x12345678', value: 0n };
      },
      getTransactionReceipt: async (hash) => {
        if (hash === purchaseHash) {
          return { hash, blockNumber: purchaseBlock, logs: [purchase] };
        }
        assert.equal(hash, batchHash);
        return { hash, blockNumber: spinBlock, logs: [applied, spin] };
      },
    });

    const legs = await readOpenLegsFromChain({
      player: PLAYER,
      lootboxIndex: 7,
      purchaseTransactionHashes: [purchaseHash],
      boxAmountWei: creditedAmountWei,
    });
    assert.deepEqual(legs.map((leg) => leg.legType), ['spin']);
    assert.equal(legs[0].spinType, 'wwxrp');
    assert.equal(legs[0].reels[0].score, 5);
    assert.equal(transactionReads, 0,
      'the boost-inclusive RNG commitment identifies the batch result without calldata guesses');
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
