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

import { test, describe, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeBoxSpin,
  deriveHumanLootboxBoonType,
  deriveHumanLootboxSpinBetIds,
  deriveHumanBoxSpinPayoutAtRisk,
  boxSpinFlipSurvivalPayout,
  enrichHumanBoxSpinLegs,
  readHumanLootboxAuraTiers,
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
import { boxReference } from '../../chain/box-queue.js';
import { arraySlot, contractInterface, setChainClientForTests } from '../../chain/client.js';
import { rpcFixture } from './helpers/chain-rpc.js';
import { prepareWalletReceipt } from '../wallet-receipt.js';
import { _setWalletIdForTests } from '../wallet-id.js';

const PLAYER = '0x19986e1466bd20e2a7db92762eb52fa7f3f1987c';
const OTHER = '0x0000000000000000000000000000000000000bad';
const ZERO = '0x0000000000000000000000000000000000000000';

// Receipts carry wallet IDs (PLAYER is account 37, OTHER account 73). Like the panels, these
// tests hydrate them to addresses with prepareWalletReceipt before parsing.
// The fixture's chain reads settle through a deferred queue that does not hold the event loop open.
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));
const FIX = await rpcFixture();
await FIX.wallet(37, PLAYER);
await FIX.wallet(73, OTHER);
Object.assign(CONTRACTS, FIX.contracts);
const GAME = CONTRACTS.GAME;
const GAME_ABI = await contractInterface('GAME');
const WWXRP_ABI = await contractInterface('WWXRP');
const WALLET_IDS = { [PLAYER]: 37, [OTHER]: 73 };

// Events are written with the address-era argument order; a leading address becomes its wallet ID.
function log(eventName, args, address = GAME) {
  const first = WALLET_IDS[args[0]] ?? args[0];
  const encoded = GAME_ABI.encodeEventLog(GAME_ABI.getEvent(eventName), [first, ...args.slice(1)]);
  return { address, topics: encoded.topics, data: encoded.data };
}

function transferLog(from, to, value, address = CONTRACTS.WWXRP) {
  const encoded = WWXRP_ABI.encodeEventLog(WWXRP_ABI.getEvent('Transfer'), [from, to, value]);
  return { address, topics: encoded.topics, data: encoded.data };
}

function prizeCreditedLog(player, amount, address = CONTRACTS.WWXRP) {
  const encoded = WWXRP_ABI.encodeEventLog(WWXRP_ABI.getEvent('PrizeCredited'), [WALLET_IDS[player], amount, 0n]);
  return { address, topics: encoded.topics, data: encoded.data };
}

async function parseReceipt(receipt, ...rest) {
  receipt.blockNumber ??= 9999;
  await prepareWalletReceipt(receipt, FIX.client);
  return parseOpenLegsFromReceipt(receipt, ...rest);
}

// ---------------------------------------------------------------------------
// decodeBoxSpin
// ---------------------------------------------------------------------------

// A queued box entry (audit 4f4aa8377, box-queue-rolls.js): wallet ID, per-box value units,
// activity-score code (60 = the neutral EV point), boost bps and quantity. The vectors below were
// generated from this module's own queue derivation (rngWord search), not from the contract.
const queueEntry = ({ id = 37, units = 100, scoreCode = 60, boost = 0, quantity = 1 } = {}) => (
  BigInt(id) | (BigInt(units) << 32n) | (BigInt(scoreCode) << 53n) | (BigInt(boost) << 65n) | (BigInt(quantity) << 77n)
);
const QUEUE_INDEX = boxReference(0, 7);
const queueContext = (rngWord, entry = {}) => ({
  rngWord, packedBox: queueEntry(entry), lootboxIndex: QUEUE_INDEX, currentLevel: 45,
});

function packSpin(playerTicket, resultTicket, score) {
  return BigInt(playerTicket) | (BigInt(resultTicket) << 32n) | (BigInt(score) << 64n);
}

// Degenerette lane ticket: byte q = [0 | wild | color | symbol]; the hero
// lane of a player ticket is its wild lane (0x40 | symbol).
const lane = (symbol, color = 0, wild = false) => (wild ? 0x40 | symbol : (color << 3) | symbol);
const ticket = (...lanes) => lanes.reduce((word, byte, q) => word | (BigInt(byte) << BigInt(q * 8)), 0n);

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
      label: 'WWXRP BURN BOON',
      value: '+12%',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(14, 42n), {
      label: 'CRAPS BOON',
      value: '+10%',
      detail: '',
    });
    assert.deepEqual(lootboxRewardPresentation(13, 0n), {
      label: 'DEGENERETTE BOON',
      value: 'BOOST',
      detail: '',
    });
    assert.equal(REWARD_TYPE_LABELS[13], 'Degenerette boon');
    assert.equal(REWARD_TYPE_LABELS[14], 'Craps boon');
  });

  test('keeps an unencoded purchase-boon product concise without listing both guesses', () => {
    const boost = lootboxRewardPresentation(6, 2_500n);
    assert.equal(boost.label, 'PURCHASE BOON');
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
    ).label, 'PURCHASE BOON');
  });

  test('uses the committed human-box RNG to name an ignored lower Ticket roll exactly', async () => {
    // The boon draw of this queued box is Purchase +15% (type 8).
    const context = queueContext(410n);
    assert.equal(deriveHumanLootboxBoonType(context), 8);
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

  test('decodes the queued box entry when naming a shared boon', () => {
    assert.equal(deriveHumanLootboxBoonType({ ...queueContext(165n), packedBox: 0n }), null,
      'an empty entry has no boon draw');
    // One box of score 60 (no boost, no EV adjustment): rngWord 446 draws type 5 (Luckbox +5%).
    assert.equal(deriveHumanLootboxBoonType(queueContext(165n)), 5);
    assert.equal(deriveHumanLootboxBoonType(queueContext(165n, { id: 0 })), null,
      'the entry binds its wallet ID');
  });

  test('keeps Ticket and Luckbox family identity per event in a counted two-box order', async () => {
    pollingTesting.setBoonStateReader(async () => {
      throw new Error('historical boon state unavailable');
    });
    // Two boxes in one entry: nonces 0 and 1 draw type 5 (Luckbox +5%) then type 8
    // (Ticket +15%) from rngWord 57299.
    const enriched = await enrichLootboxBoonLegs([
      { legType: 'reward', rewardType: 4, amount: 500n },
      { legType: 'reward', rewardType: 5, amount: 1_500n },
    ], {
      player: '0x1111111111111111111111111111111111111111',
      blockNumber: 12_351,
      context: queueContext(28n, { quantity: 2, units: 100000 }),
    });

    assert.deepEqual(enriched.map((leg) => leg.boonType), [5, 8]);
    assert.deepEqual(enriched.map((leg) => lootboxRewardPresentation(
      leg.rewardType,
      leg.amount,
      { boonType: leg.boonType },
    ).label), ['LUCKBOX BOON', 'TICKET BOON']);
  });

  test('still derives the exact product when the optional packed-state read fails', async () => {
    const context = queueContext(410n); // the boon draw is Purchase +15% (type 8)
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

// The FLIP spin id of the first (only) roll of queueContext(123_456_789n).
const FLIP_SPIN_BET_ID = '10853396827165545820';

describe('human BoxSpin payout enrichment', () => {
  afterEach(() => contractsMod.clearProvider());

  test('reconstructs the exact preliminary FLIP won before a survival bust', async () => {
    const spin = {
      legType: 'spin',
      betId: FLIP_SPIN_BET_ID, // the FLIP spin of the queued box's single roll
      spinType: 'flip',
      survived: false,
      payout: 0n,
      reels: [
        { spinIndex: 0, playerTicket: 0n, resultTicket: 0n, score: 3 },
        { spinIndex: 1, playerTicket: 0n, resultTicket: 0n, score: 0 },
        { spinIndex: 2, playerTicket: 0n, resultTicket: 0n, score: 0 },
      ],
    };
    const context = queueContext(123_456_789n);
    assert.equal(deriveHumanLootboxSpinBetIds(context)[1], BigInt(FLIP_SPIN_BET_ID));

    assert.equal(deriveHumanBoxSpinPayoutAtRisk({
      spin,
      ...context,
    }), 75155773875000000000n);

    const [enriched] = await enrichHumanBoxSpinLegs([spin], {
      player: PLAYER,
      lootboxIndex: QUEUE_INDEX,
      blockNumber: 50_000,
      context,
    });
    assert.equal(enriched.preSurvivalPayout, 75155773875000000000n);
  });

  test('leaves non-FLIP and already-exact spin legs untouched', async () => {
    const exact = {
      legType: 'spin', spinType: 'flip', payout: 0n,
      preSurvivalPayout: 42n, reels: [{ score: 3 }],
    };
    const wwxrp = {
      legType: 'spin', spinType: 'wwxrp', payout: 0n, reels: [{ score: 3 }],
    };
    const rows = [exact, wwxrp];
    assert.equal(await enrichHumanBoxSpinLegs(rows, {
      player: PLAYER,
      lootboxIndex: 7,
      blockNumber: 50_000,
    }), rows, 'no historical storage read is needed when no losing FLIP amount is missing');
  });

  test('prefers the indexed settlement level over the context level', async () => {
    const context = { ...queueContext(123_456_789n), currentLevel: 13 };
    const leg = {
      legType: 'spin',
      betId: FLIP_SPIN_BET_ID,
      spinType: 'flip',
      levelAtOpen: 44,
      survived: false,
      payout: 0n,
      reels: [
        { spinIndex: 0, playerTicket: 0n, resultTicket: 0n, score: 3 },
        { spinIndex: 1, playerTicket: 0n, resultTicket: 0n, score: 0 },
        { spinIndex: 2, playerTicket: 0n, resultTicket: 0n, score: 0 },
      ],
    };
    assert.equal(deriveHumanBoxSpinPayoutAtRisk({ spin: leg, ...context }), 150311547750000000000n,
      'the stake is priced at the context level');
    const [enriched] = await enrichHumanBoxSpinLegs([leg], {
      player: PLAYER, lootboxIndex: QUEUE_INDEX, blockNumber: 50_000, context,
    });
    assert.equal(enriched.preSurvivalPayout, 75155773875000000000n,
      'the contract prices the roll at the settlement level + 1');
  });

  test('reads the queued entry, the applied word and the level at the settlement block', async (t) => {
    const f = await rpcFixture();
    await f.wallet(37, PLAYER);
    const { slot } = await f.s.location('GAME', 'boxQueue', [0]);
    // Position 7 is lane 1 of word 2 (three 85-bit entries per word).
    f.storage.set(`${f.contracts.GAME.toLowerCase()}:${arraySlot(slot) + 2n}`, queueEntry() << 85n);
    await f.field('GAME', 'level', 44);
    await f.event('GAME', 'LootboxRngApplied', { index: 0, word: 123_456_789n, requestId: 99n }, { block: 9990 });
    const saved = { contracts: { ...CONTRACTS }, chain: { ...CHAIN } };
    Object.assign(CONTRACTS, f.contracts);
    Object.assign(CHAIN, { id: f.client.chain.id, deployBlock: 1, readSchema: f.client.chain.readSchema });
    t.after(() => { Object.assign(CONTRACTS, saved.contracts); Object.assign(CHAIN, saved.chain); });
    contractsMod.setProvider(f.client.provider);

    assert.deepEqual(await readHumanLootboxAuraTiers({ player: PLAYER, lootboxIndex: QUEUE_INDEX, blockNumber: 9999 }),
      ['t4'], 'one aura per physical box of the queued entry');
    assert.deepEqual(await readHumanLootboxAuraTiers({ player: OTHER, lootboxIndex: QUEUE_INDEX, blockNumber: 9999 }),
      [], 'an entry that is not this wallet\'s reveals nothing');
    const [enriched] = await enrichHumanBoxSpinLegs([{
      legType: 'spin', betId: FLIP_SPIN_BET_ID, spinType: 'flip', survived: false, payout: 0n,
      reels: [3, 0, 0].map((score, spinIndex) => ({ spinIndex, playerTicket: 0n, resultTicket: 0n, score })),
    }], { player: PLAYER, lootboxIndex: QUEUE_INDEX, blockNumber: 9999 });
    assert.equal(enriched.preSurvivalPayout, 75155773875000000000n,
      'level 44 on chain prices the roll at level 45');
  });

  // The busted panel can never audit itself: its payout is zero by
  // construction. A survivor can, because the contract publishes the mint that
  // its stake must produce. Pinning that round trip is what makes the number
  // shown on a bust trustworthy.
  test('a survivor replays from the same outcome-independent stake', async () => {
    const oneFlip = 10n ** 18n;
    const context = queueContext(123_456_789n);
    const reels = [
      { spinIndex: 0, playerTicket: 0n, resultTicket: 0n, score: 3 },
      { spinIndex: 1, playerTicket: 0n, resultTicket: 0n, score: 0 },
      { spinIndex: 2, playerTicket: 0n, resultTicket: 0n, score: 0 },
    ];
    const stake = 75155773875000000000n;
    const base = {
      legType: 'spin', betId: FLIP_SPIN_BET_ID, spinType: 'flip', reels,
    };

    // 2 x 92.645... FLIP sits under FLIP_ROUND_THRESHOLD, so the contract
    // takes the whole-FLIP floor: 185 FLIP.
    assert.equal(boxSpinFlipSurvivalPayout(stake, 123n), 150n * oneFlip);

    const won = { ...base, survived: true, payout: 150n * oneFlip };
    const busted = { ...base, survived: false, payout: 0n };
    const args = { player: PLAYER, lootboxIndex: QUEUE_INDEX, blockNumber: 50_000, context };
    const [enrichedWon] = await enrichHumanBoxSpinLegs([won], args);
    const [enrichedBusted] = await enrichHumanBoxSpinLegs([busted], args);

    assert.equal(enrichedWon.preSurvivalPayout, stake,
      'the winning branch names the same stake it would have risked');
    assert.equal(enrichedBusted.preSurvivalPayout, stake,
      'the losing branch names it too, from identical inputs');
    assert.equal(enrichedWon.preSurvivalPayout, enrichedBusted.preSurvivalPayout,
      'the stake is a property of the reels and the box, never of the coin');
    assert.equal(enrichedWon.survivalWinPayout, 150n * oneFlip);
    assert.equal(enrichedBusted.survivalWinPayout, enrichedWon.survivalWinPayout,
      'the lost branch retains the exact rounded potential win as well as the reel stake');
    assert.equal(
      boxSpinFlipSurvivalPayout(enrichedWon.preSurvivalPayout, 123n),
      _feedPayout(enrichedWon.payout),
      'the derived stake settles back to the payout the chain actually emitted',
    );
  });

  test('a survivor whose payout does not replay publishes no stake', async () => {
    const won = {
      legType: 'spin',
      betId: FLIP_SPIN_BET_ID,
      spinType: 'flip',
      survived: true,
      // Not reachable from the derived stake under either rounding rule.
      payout: 999n * (10n ** 18n),
      reels: [
        { spinIndex: 0, playerTicket: 0n, resultTicket: 0n, score: 3 },
        { spinIndex: 1, playerTicket: 0n, resultTicket: 0n, score: 0 },
        { spinIndex: 2, playerTicket: 0n, resultTicket: 0n, score: 0 },
      ],
    };
    const [enriched] = await enrichHumanBoxSpinLegs([won], {
      player: PLAYER,
      lootboxIndex: QUEUE_INDEX,
      blockNumber: 50_000,
      context: queueContext(123_456_789n),
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
    // Player wild hero on lane 1 (symbol 3); the house rolls a wild on lane 2.
    const player = ticket(lane(2, 1), lane(3, 0, true), lane(5, 4), lane(6, 2));
    const result = ticket(lane(2, 1), lane(3, 5), lane(7, 0, true), lane(1, 3));
    const packed = packSpin(player, result, 4) | (1n << 216n);
    const d = decodeBoxSpin(betId, packed);
    assert.equal(d.betId, betId, 'the synthetic id remains available for replay verification');
    assert.equal(d.boxOrigin, true);
    assert.equal(d.spinType, 'wwxrp');
    assert.equal(d.heroQuadrant, 1, 'a single-reel spin reads its hero from the player wild lane');
    assert.equal(d.spinCount, 1);
    assert.equal(d.survived, null, 'survived is FLIP-only');
    assert.equal(d.reels.length, 1);
    assert.equal(d.reels[0].playerTicket, player);
    assert.equal(d.reels[0].resultTicket, result);
    assert.equal(d.reels[0].score, 4);
    assert.equal(d.reels[0].heroQuadrant, 1);
    assert.equal(d.reels[0].wilds, 1, 'the wild count is the house wild lanes');
    assert.deepEqual(d.reels[0].playerTraits[0], { sym: 2, col: 1, wild: false });
    assert.deepEqual(d.reels[0].playerTraits[1], { sym: 3, col: null, wild: true });
    assert.deepEqual(d.reels[0].resultTraits[2], { sym: 7, col: null, wild: true });
  });

  test('a player ticket with no wild lane reads no hero', () => {
    const betId = (1n << 63n) | (0n << 60n) | 12345n;
    const packed = packSpin(ticket(lane(1), lane(2), lane(3), lane(4)), ticket(lane(1), lane(2), lane(3), lane(4)), 3)
      | (1n << 216n);
    const d = decodeBoxSpin(betId, packed);
    assert.equal(d.reels[0].heroQuadrant, null);
    assert.equal(d.heroQuadrant, null);
    assert.equal(d.reels[0].wilds, 0);
  });

  test('three FLIP spins under one survival flip (survived=true)', () => {
    const betId = (1n << 63n) | (1n << 60n) | 7n; // type 1 = FLIP
    const hero = (q) => ticket(...[0, 1, 2, 3].map((i) => (i === q ? lane(1, 0, true) : lane(i + 2, i))));
    const packed = packSpin(hero(0), 2n, 3)
      | (packSpin(hero(1), 4n, 5) << 72n)
      | (packSpin(hero(2), ticket(lane(1, 0, true), 0, 0, 0), 9) << 144n)
      | (3n << 216n)   // count 3
      | (1n << 224n);  // survived
    const d = decodeBoxSpin(betId, packed);
    assert.equal(d.spinType, 'flip');
    assert.equal(d.heroQuadrant, null,
      'a three-reel chain has no truthful group-wide Hero quadrant');
    assert.equal(d.spinCount, 3);
    assert.equal(d.survived, true);
    assert.equal(d.reels.length, 3);
    assert.equal(d.reels[1].score, 5);
    assert.equal(d.reels[2].score, 9);
    assert.deepEqual(d.reels.map((reel) => reel.heroQuadrant), [0, 1, 2],
      'each reel carries its own hero: the wild lane of its player ticket');
    assert.deepEqual(d.reels.map((reel) => reel.wilds), [0, 0, 1]);
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
    assert.equal(d.heroQuadrant, null,
      'the record chain hashes a fresh symbol per reel — no single group-wide hero');
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

describe('parseOpenLegsFromReceipt', () => {
  test('full receipt: opened + dgnrs + reward + spin legs in log order', async () => {
    const betId = (1n << 63n) | (1n << 60n) | 42n;
    const packed = (BigInt(0x01) | (BigInt(0x02) << 32n) | (4n << 64n)) | (1n << 216n) | (1n << 224n);
    const receipt = {
      hash: `0x${'ab'.repeat(32)}`,
      blockNumber: 45_678,
      logs: [
        // FLIP and WWXRP go on chain as whole tokens, DGNRS with 12 decimals.
        log('LootBoxOpened', [PLAYER, 7n, 10_000_000_000n, 6, 1094, 120n, true]),
        log('LootBoxDgnrsBatch', [PLAYER, 4n * 10n ** 12n, 3n * 10n ** 12n]),
        log('LootBoxReward', [PLAYER, 11, 10_000_000_000n, 500n]),
        log('BoxSpin', [PLAYER, betId, packed, 240n, 0n]),
      ],
    };
    const legs = await parseReceipt(receipt, PLAYER);
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

  test('decodes the regular-box Craps comp aggregate and its reserved day', async () => {
    const receipt = {
      logs: [
        log('LootBoxOpened', [PLAYER, 8n, 1_000n, 7, 0, 0n, false]),
        log('LootBoxCrapsPasses', [PLAYER, 2, 1, 73]),
      ],
    };
    const legs = await parseReceipt(receipt, PLAYER);
    assert.deepEqual(legs.map((leg) => leg.legType), ['opened', 'crapsPasses']);
    assert.deepEqual(legs[1], {
      legType: 'crapsPasses',
      crapsNormalPasses: 2,
      crapsHighPasses: 1,
      reservedDay: 73,
    });
  });

  test('whale pass leg decodes as legendary payload', async () => {
    const receipt = {
      logs: [log('LootBoxWhalePassJackpot', [PLAYER, 10_000_000_000n, 13, 400, 0, 0])],
    };
    const legs = await parseReceipt(receipt, PLAYER);
    assert.equal(legs.length, 1);
    assert.equal(legs[0].legType, 'whalepass');
    assert.equal(legs[0].targetLevel, 13);
    assert.equal(legs[0].entriesPerLevel, 400);
  });

  test('retains the current post-open WWXRP cold-bust mint', async () => {
    const receipt = {
      logs: [
        log('LootBoxOpened', [PLAYER, 7n, 10_000_000_000n, 8, 42, 0n, false]),
        transferLog(ZERO, PLAYER, 1n),
      ],
    };
    const legs = await parseReceipt(receipt, PLAYER);
    assert.deepEqual(legs.map((leg) => leg.legType), ['opened', 'wwxrp']);
    assert.equal(legs[1].amount, ethers.parseEther('1'));
    assert.equal(legs[1].consolation, true);
    assert.equal(legs[0].futureTickets, 42);
    assert.equal(legs[0].roundedUp, false);
    assert.equal(legs[0].wholeTickets, 0);
  });

  test('retains the PrizeCredited mint of the wallet-ID WWXRP as the cold-bust consolation', async () => {
    const receipt = {
      logs: [
        log('LootBoxOpened', [PLAYER, 7n, 10_000_000_000n, 8, 42, 0n, false]),
        prizeCreditedLog(PLAYER, 2n),
        prizeCreditedLog(OTHER, 5n),
      ],
    };
    const legs = await parseReceipt(receipt, PLAYER);
    assert.deepEqual(legs.map((leg) => leg.legType), ['opened', 'wwxrp']);
    assert.equal(legs[1].amount, ethers.parseEther('2'), 'another wallet\'s credit is not ours');
    assert.equal(legs[1].consolation, true);
  });

  test('does not invent WWXRP for a contentless non-ticket opening', async () => {
    const receipt = {
      logs: [
        log('LootBoxOpened', [PLAYER, 7n, 10_000_000_000n, 8, 0, 0n, false]),
        transferLog(ZERO, PLAYER, 1n),
      ],
    };
    const legs = await parseReceipt(receipt, PLAYER);
    assert.deepEqual(legs.map((leg) => leg.legType), ['opened']);
  });

  test('does not invent cold-bust WWXRP when the ticket roll awards one whole ticket', async () => {
    const receipt = {
      logs: [
        log('LootBoxOpened', [PLAYER, 7n, 10_000_000_000n, 8, 100, 0n, false]),
        transferLog(ZERO, PLAYER, 1n),
      ],
    };
    const legs = await parseReceipt(receipt, PLAYER);
    assert.deepEqual(legs.map((leg) => leg.legType), ['opened']);
    assert.equal(legs[0].wholeTickets, 1);
  });

  test('subtracts an itemized WWXRP BoxSpin from the aggregated cold-bust mint', async () => {
    const betId = (1n << 63n) | 42n;
    const packed = packSpin(1n, 2n, 4) | (1n << 216n);
    const receipt = {
      logs: [
        log('BoxSpin', [PLAYER, betId, packed, 2n, 0n]),
        log('LootBoxOpened', [PLAYER, 7n, 10_000_000_000n, 8, 42, 0n, false]),
        transferLog(ZERO, PLAYER, 3n),
      ],
    };
    const legs = await parseReceipt(receipt, PLAYER);
    assert.deepEqual(legs.map((leg) => leg.legType), ['spin', 'opened', 'wwxrp']);
    assert.equal(legs[0].payout, ethers.parseEther('2'));
    assert.equal(legs[2].amount, ethers.parseEther('1'));
    assert.equal(legs[2].consolation, true);
  });

  test('player filter drops other players; foreign address logs skipped', async () => {
    const receipt = {
      logs: [
        log('LootBoxOpened', [OTHER, 1n, 1n, 2, 100, 0n, false]),
        log('LootBoxOpened', [PLAYER, 2n, 1n, 2, 100, 0n, false], '0x000000000000000000000000000000000000dead'),
      ],
    };
    assert.equal((await parseReceipt(receipt, PLAYER)).length, 0);
    // Without the filter, the GAME-address log still parses.
    assert.equal((await parseReceipt(receipt)).length, 1);
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
  test('a Luckbox never replays the Degenerette record bounty from the same sweep', () => {
    const transactionHash = `0x${'ae'.repeat(32)}`;
    const row = { player: PLAYER, transactionHash, lootboxIndex: 7 };
    const rows = [
      { ...row, logIndex: 1, legType: 'opened', rewardData: { futureTickets: 100, flip: '0' } },
      { ...row, logIndex: 2, legType: 'spin', spin: { spinType: 'flip', betId: '11', payout: '20', reels: [] } },
      { ...row, logIndex: 3, legType: 'spin', spin: { spinType: 'record', betId: '12', payout: '30', reels: [] } },
      { ...row, logIndex: 4, legType: 'spin', spin: { spinType: 'unknown_3', betId: '13', payout: '0', reels: [] } },
      // An ETH box can produce a legitimate index-zero recirculated child.
      { ...row, lootboxIndex: 0, logIndex: 5, legType: 'opened', rewardData: { futureTickets: 200, flip: '0' } },
    ];
    for (const options of [{ lootboxIndex: 7 }, { lootboxIndex: 7, transactionHash }]) {
      const legs = openLegsFromFeed(rows, { player: PLAYER, ...options });
      assert.deepEqual(legs.map(leg => leg.legType), ['opened', 'spin', 'opened']);
      assert.deepEqual(legs.filter(leg => leg.legType === 'spin').map(leg => leg.betId), ['11']);
      assert.equal(legs[2].wholeTickets, 2, 'the legitimate child box remains revealable');
    }
  });

  test('receipt parsing keeps record bounties for Degenerette and excludes them for Luckboxes', async () => {
    const packed = packSpin(1n, 2n, 4) | (1n << 216n);
    const receipt = { logs: [
      log('LootBoxOpened', [PLAYER, 7n, 100n, 5, 100, 0n, false]),
      log('BoxSpin', [PLAYER, (1n << 63n) | (1n << 60n) | 11n, packed, 20n, 0n]),
      log('BoxSpin', [PLAYER, (1n << 63n) | (3n << 60n) | 12n, packed, 30n, 0n]),
    ] };
    assert.deepEqual((await parseReceipt(receipt, PLAYER))
      .filter(leg => leg.legType === 'spin').map(leg => leg.spinType), ['flip', 'record']);
    assert.deepEqual((await parseReceipt(receipt, PLAYER, { includeRecordBounties: false }))
      .filter(leg => leg.legType === 'spin').map(leg => leg.spinType), ['flip']);
  });

  test('does not replay neighboring queued boxes from the same settlement transaction', () => {
    const transactionHash = `0x${'ac'.repeat(32)}`;
    const rows = [7, 8, 9].flatMap((lootboxIndex, i) => [
      { player: PLAYER, transactionHash, lootboxIndex, logIndex: i * 2,
        legType: 'opened', rewardData: { futureTickets: 100, flip: '0' } },
      { player: PLAYER, transactionHash, lootboxIndex, logIndex: i * 2 + 1,
        legType: 'spin', spin: { spinType: 'wwxrp', betId: String(lootboxIndex), payout: '2', reels: [] } },
    ]);
    for (const lootboxIndex of [7, 8, 9]) {
      for (const explicitHash of [undefined, transactionHash]) {
        const legs = openLegsFromFeed(rows, { player: PLAYER, lootboxIndex, transactionHash: explicitHash });
        assert.deepEqual(legs.filter(leg => leg.legType === 'spin').map(leg => leg.betId), [String(lootboxIndex)]);
        assert.equal(legs.filter(leg => leg.legType === 'opened').length, 1);
      }
    }
  });

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

  test('rebuilds an indexed AfKing fractional miss as its 1 WWXRP consolation', () => {
    const tx = `0x${'af'.repeat(32)}`;
    const rows = [{
      player: PLAYER,
      transactionHash: tx,
      blockNumber: 46_136_786,
      logIndex: 545,
      legType: 'opened',
      lootboxIndex: 0,
      origin: 'afking',
      boxAmountRawWei: '21486000000',
      rewardData: {
        amount: '21486000000',
        futureLevel: 46,
        futureTickets: 28,
        roundedUp: false,
        flip: '0',
      },
    }];

    const legs = openLegsFromFeed(rows, { player: PLAYER, lootboxIndex: 0 });
    assert.deepEqual(legs.map((leg) => leg.legType), ['opened', 'wwxrp']);
    assert.equal(legs[1].amount, ethers.parseEther('1'),
      'the current testnet-sized box amount takes the contract one-token floor');
    assert.equal(legs[1].consolation, true);

    const largeTx = `0x${'fa'.repeat(32)}`;
    const largeAmount = 7_000_000_000_000_000n;
    const [largeOpened, largeWwxrp] = openLegsFromFeed([{
      ...rows[0],
      transactionHash: largeTx,
      boxAmountRawWei: String(largeAmount),
      rewardData: { ...rows[0].rewardData, amount: String(largeAmount) },
    }], { player: PLAYER, lootboxIndex: 0 });
    assert.equal(largeOpened.legType, 'opened');
    assert.equal(largeWwxrp.amount, 3n * 10n ** 18n,
      'larger payouts use the post-boon roll amount (3.4995 WWXRP), floored to whole tokens like _boxWwxrpStake');
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

  test('rebuilds the indexed Craps comp aggregate beside its anchor', () => {
    const tx = `0x${'bc'.repeat(32)}`;
    const rows = [
      {
        player: PLAYER, transactionHash: tx, logIndex: 30, legType: 'opened',
        lootboxIndex: 9, rewardData: { futureTickets: 100, flip: '0' },
      },
      {
        player: PLAYER, transactionHash: tx, logIndex: 31, legType: 'crapsPasses',
        rewardData: { normal: '2', highRoller: '1', day: '74' },
      },
    ];
    const legs = openLegsFromFeed(rows, { player: PLAYER, lootboxIndex: 9 });
    assert.deepEqual(legs.map((leg) => leg.legType), ['opened', 'crapsPasses']);
    assert.equal(legs[1].crapsNormalPasses, 2);
    assert.equal(legs[1].crapsHighPasses, 1);
    assert.equal(legs[1].reservedDay, 74);
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

  // The chain readers run against an ABI-backed fixture (queue storage, wallet table, RNG events);
  // the ethers-style log and receipt reads the module makes are served from `logs` and `receipts`.
  async function chainFixture(t, { head = 20_000 } = {}) {
    const f = await rpcFixture({ head });
    await f.wallet(37, PLAYER);
    const { slot } = await f.s.location('GAME', 'boxQueue', [0]);
    // Position 7 is lane 1 of word 2 (three 85-bit entries per word).
    f.storage.set(`${f.contracts.GAME.toLowerCase()}:${arraySlot(slot) + 2n}`, queueEntry() << 85n);
    await f.field('GAME', 'level', 44);
    const saved = { contracts: { ...CONTRACTS }, chain: { ...CHAIN } };
    Object.assign(CONTRACTS, f.contracts);
    Object.assign(CHAIN, { id: f.client.chain.id, deployBlock: 1, readSchema: f.client.chain.readSchema });
    setChainClientForTests(f.client);
    _setWalletIdForTests(PLAYER, 37);
    t.after(() => {
      _setWalletIdForTests(PLAYER, null);
      Object.assign(CONTRACTS, saved.contracts);
      Object.assign(CHAIN, saved.chain);
      setChainClientForTests(null);
    });
    return f;
  }

  const buyLog = (amount, position = 7) => {
    const encoded = GAME_ABI.encodeEventLog(GAME_ABI.getEvent('LootBoxBuy'), [37, 0, position, amount]);
    return { address: GAME, topics: encoded.topics, data: encoded.data };
  };
  const rngLog = (word) => log('LootboxRngApplied', [0n, word, 99n]);
  const betIds = (rngWord) => deriveHumanLootboxSpinBetIds(queueContext(rngWord));

  for (const crossesChunk of [false, true]) {
    test(`recovers a queued box's spin after its queue buffer is reused${crossesChunk ? ' across scan chunks' : ''}`, async (t) => {
      const rngWord = 123_456_789n;
      const [, flipId] = betIds(rngWord);
      const purchaseHash = `0x${'62'.repeat(32)}`;
      const batchHash = `0x${'0b'.repeat(32)}`;
      const laterHash = `0x${'ab'.repeat(32)}`;
      const purchaseBlock = 9_000;
      const spinBlock = purchaseBlock + (crossesChunk ? 1801 : 11);
      const f = await chainFixture(t);
      // The buffer's word is applied by this batch; the entry is recovered at the settlement block.
      await f.event('GAME', 'LootboxRngApplied', { index: 0, word: rngWord, requestId: 99n }, { block: spinBlock - 1 });
      const packed = packSpin(1n, 2n, 4) | (1n << 216n);
      const at = (entry, blockNumber, index, transactionHash) => ({ ...entry, blockNumber, index, logIndex: index, transactionHash });
      const purchase = at(buyLog(10_000_000_000n), purchaseBlock, 59, purchaseHash);
      const spin = at(log('BoxSpin', [PLAYER, flipId, packed, 0n, 0n]), spinBlock, 268, batchHash);
      // A neighbouring box of the same sweep is not this box's spin.
      const neighbour = at(log('BoxSpin', [PLAYER, flipId + 1n, packed, 0n, 0n]), spinBlock, 269, batchHash);
      const publication = (blockNumber, index, word) => at(rngLog(word), blockNumber, index, `0x${'99'.repeat(32)}`);
      const rngLogs = [
        publication(purchaseBlock, 58, 111n), // previous round, earlier in the purchase block
        publication(spinBlock - 1, 1, rngWord),
        publication(spinBlock + 178, 1, 8_752_500_828_625_591_217_090_591_293_740_862_393_462_862_129_282_725_389_683_906_258_817_288_266_542n),
        publication(spinBlock + 326, 1, 38_850_288_845_440_436_283_593_745_819_566_019_314_705_621_024_041_324_473_128_790_265_168_159_235_080n),
      ];
      const laterOpened = at(log('LootBoxOpened', [PLAYER, QUEUE_INDEX, 10_000_000_000n, 6, 400, 120n, false]),
        spinBlock + 178, 2, laterHash);
      const receiptsRead = [];
      const searchedRanges = [];
      contractsMod.setProvider({
        send: f.client.provider.send,
        getBlockNumber: async () => 20_000,
        getLogs: async (filter) => {
          searchedRanges.push([filter.fromBlock, filter.toBlock]);
          const events = [purchase, spin, neighbour, ...rngLogs, laterOpened];
          return events.filter((event) => event.topics[0] === filter.topics[0]
            && (filter.topics[1] == null || event.topics[1] === filter.topics[1])
            && event.blockNumber >= filter.fromBlock && event.blockNumber <= filter.toBlock).reverse();
        },
        getTransactionReceipt: async (hash) => {
          receiptsRead.push(hash);
          if (hash === purchaseHash) return { hash, blockNumber: purchaseBlock, logs: [purchase] };
          if (hash === laterHash) return { hash, blockNumber: laterOpened.blockNumber, logs: [laterOpened] };
          assert.equal(hash, batchHash);
          return { hash, blockNumber: spinBlock, logs: [spin, neighbour] };
        },
      });
      const legs = await readOpenLegsFromChain({ player: PLAYER, lootboxIndex: QUEUE_INDEX,
        purchaseTransactionHashes: [purchaseHash] });
      assert.deepEqual(legs.map(leg => leg.legType), ['spin'], 'only the proven box spin is recovered from the shared receipt');
      assert.equal(String(legs[0].betId), String(flipId));
      assert.equal(legs[0].spinType, 'flip');
      assert.equal(legs[0].transactionHash, batchHash, 'save the immutable settlement for subsequent reveals');
      assert.equal(legs[0].payout, 0n, 'a losing spin still supplies a complete reveal');
      assert.equal(legs[0].reels.length, 1);
      assert.deepEqual(receiptsRead, [purchaseHash, batchHash]);
      assert.ok(searchedRanges.some(([from]) => from === purchaseBlock),
        'recovery starts at the immutable purchase receipt instead of the recent head');
      assert.ok(!receiptsRead.includes(laterHash), 'a later round of the reused buffer is never inspected');
    });
  }

  test('chain recovery keeps box rewards without replaying a same-receipt record bounty', async (t) => {
    const txHash = `0x${'ef'.repeat(32)}`;
    const f = await chainFixture(t, { head: 6_000 });
    const opened = log('LootBoxOpened', [PLAYER, QUEUE_INDEX, 1_000n, 6, 400, 120n, false]);
    contractsMod.setProvider({
      send: f.client.provider.send,
      getBlockNumber: async () => 6_000,
      getLogs: async (filter) => {
        assert.equal(filter.address.toLowerCase(), GAME.toLowerCase());
        if (filter.topics[0] !== GAME_ABI.getEvent('LootBoxOpened').topicHash) return [];
        assert.equal(filter.toBlock - filter.fromBlock, 1799);
        return [{ ...opened, transactionHash: txHash, blockNumber: filter.toBlock, index: 0 }];
      },
      getTransactionReceipt: async (hash) => {
        assert.equal(hash, txHash);
        return {
          blockNumber: 6_000,
          logs: [
            opened,
            log('LootBoxReward', [PLAYER, 11, 1_000n, 500n]),
            log('BoxSpin', [PLAYER, (1n << 63n) | (3n << 60n) | 12n,
              packSpin(1n, 2n, 4) | (1n << 216n), 30n, 0n]),
          ],
        };
      },
    });

    const legs = await readOpenLegsFromChain({ player: PLAYER, lootboxIndex: QUEUE_INDEX });
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
