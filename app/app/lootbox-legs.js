// /app/app/lootbox-legs.js — client-side decode of an openBox receipt into
// normalized "prize legs" for the reveal overlay.
//
// Receipt-log-first (CONTEXT D-03): the open receipt carries EVERYTHING the
// box paid — no indexer round-trip needed for the reveal moment. The indexer's
// /lootbox/legs feed is the historical mirror of the same shape.
//
// Event sources (verified against degenerus-audit/contracts):
//   modules/DegenerusGameLootboxModule.sol
//     LootBoxOpened(player, lootboxIndex, amount, futureLevel, futureTickets, flip, roundedUp)
//     LootBoxDgnrsReward(player, lootboxAmount, dgnrsAmount)
//     LootBoxWhalePassJackpot(player, lootboxAmount, targetLevel, entriesPerLevel, ...)
//     LootBoxReward(player, rewardType, lootboxAmount, amount)
//       rewardType: 2=CoinflipBoon 4=Boost5 5=Boost15 6=Boost25 8=DecimatorBoost
//                   9=WhaleBoon 10=ActivityBoon/DeityPassBoon 11=LazyPassBoon
//                   12=QuestShield 13=DegeneretteBoon (amount = boonType 32-40)
//   modules/DegenerusGameDegeneretteModule.sol
//     BoxSpin(player, betId, packedSpins, payout, ethShare)
//       betId: bit 63 = box-origin sentinel, bits 62-60 = spin type
//              (0=WWXRP, 1=FLIP, 2=ETH), bits 59-0 = seed entropy.
//       packedSpins: spin i at offset i*72 → [playerTicket:32 | resultTicket:32
//              | score:8]; bits 216-223 = spin count; bit 224 = survived flag
//              (FLIP survival flip only).
//
// packedSpins decode mirrors database/src/handlers/box-spins.ts bit-for-bit.

import { ethers, getProvider } from './contracts.js';
import { CHAIN, CONTRACTS, ETH_DIVISOR } from './chain-config.js';
import { dgnUnpackTicket } from './dgn-traits.js';
import { degenerettePayoutTable } from './degenerette.js';
import { scaledTicketPriceWei } from './lootbox.js';
import {
  boonTypePresentation,
  boonVisualForProduct,
  decodePackedBoons,
} from './boons.js';
import { readExactBoonState } from './polling.js';

// Minimal open-receipt event ABI — parse-only (no writes here; openLootBox
// lives in lootbox.js).
export const OPEN_EVENTS_ABI = [
  'event LootBoxBuy(address indexed buyer, uint48 indexed index, uint256 amount)',
  'event LootboxRngApplied(uint48 index, uint256 word, uint256 requestId)',
  'event LootBoxOpened(address indexed player, uint48 indexed lootboxIndex, uint256 amount, uint24 futureLevel, uint32 futureTickets, uint256 flip, bool roundedUp)',
  'event LootBoxDgnrsReward(address indexed player, uint256 lootboxAmount, uint256 dgnrsAmount)',
  'event LootBoxWhalePassJackpot(address indexed player, uint256 lootboxAmount, uint24 targetLevel, uint32 entriesPerLevel, uint24 statsBoost, uint24 frozenUntilLevel)',
  'event LootBoxReward(address indexed player, uint8 indexed rewardType, uint256 lootboxAmount, uint256 amount)',
  'event PresaleBoxOpened(address indexed player, uint48 indexed index, uint256 amount, uint256 flip, uint256 dgnrs, uint256 wwxrp, bool closing)',
  'event BoxSpin(address indexed player, uint64 betId, uint256 packedSpins, uint256 payout, uint256 ethShare)',
];
const OPEN_CALL_ABI = ['function openBox(address player, uint48 index)'];

const SPIN_TYPES = ['wwxrp', 'flip', 'eth', 'record'];
const BOX_BET_ID_SENTINEL = 1n << 63n;
const BOX_BET_ID_ENTROPY_MASK = (1n << 60n) - 1n;
const BOX_SPIN_TAGS = [
  0x57777872705370696en, // "WwxrpSpin"
  0x4275726e69655370696en, // "BurnieSpin" / FLIP
  0x4574685370696en, // "EthSpin"
];
const BOX_FLIP_SPIN_TAG = BOX_SPIN_TAGS[1];
const SPIN_STRIDE = 72n;
const COUNT_SHIFT = 216n;
const SURVIVED_SHIFT = 224n;
const U32 = 0xFFFFFFFFn;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TRANSFER_EVENTS_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

/**
 * A BoxSpin's low seed bits are preserved in its synthetic bet id. The
 * contract chooses the hero quadrant with `seed & 3`, so the same two bits are
 * the authoritative explanation for a one-symbol S2 payout in the reveal.
 */
export function boxSpinHeroQuadrant(betId) {
  try {
    const id = BigInt(betId ?? 0);
    return ((id >> 63n) & 1n) === 1n ? Number(id & 3n) : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Canonical presentation identity shared by receipt and indexed-box paths.
 * Nonzero boxes live in one RNG batch slot, while index-zero/direct boxes need
 * their settlement transaction to remain collision-free.
 */
export function lootboxPresentationKey(lootboxIndex, transactionHash = null) {
  try {
    const index = BigInt(lootboxIndex ?? 0);
    if (index > 0n) return String(index);
  } catch (_e) { /* fall through to the immutable settlement transaction */ }
  const hash = String(transactionHash || '').toLowerCase();
  return hash ? `tx:${hash}` : null;
}

function _entropyHash2(a, b) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256'],
    [BigInt(a), BigInt(b)],
  );
  return BigInt(ethers.keccak256(encoded));
}

const FULL_ETH_WEI = 10n ** 18n;
const PRICE_COIN_UNIT = 1_000n * FULL_ETH_WEI;
const LOOTBOX_BOON_BUDGET_BPS = 1_000n;
const LOOTBOX_BOON_MAX_BUDGET = FULL_ETH_WEI / BigInt(ETH_DIVISOR);
const LOOTBOX_BOON_UTILIZATION_BPS = 5_000n;
const BOON_PPM_SCALE = 1_000_000n;
const BOON_WEIGHT_TOTAL = 2_608n;
const LOOTBOX_SPLIT_THRESHOLD = (FULL_ETH_WEI / 2n) / BigInt(ETH_DIVISOR);
const LOOTBOX_FLIP_SPINS_STAKE_BPS = 7_060n;
// DegenerusGameDegeneretteModule.sol:1763 / FlipRoundLib.sol:21-27. A surviving
// box-spin chain mints `2 x preliminary`, then collapses that onto a whole
// 100-FLIP granule above 1,000 FLIP (whole-FLIP floor below it). Halving the
// emitted payout therefore recovers the stake only to within 50 FLIP, which is
// why a survivor's payout is not a substitute for the real pre-flip sum.
const BOX_FLIP_ROUND_TAG = 0x466c6970526f756e64n;
const FLIP_ROUND_UNIT = 100n * FULL_ETH_WEI;
const FLIP_ROUND_THRESHOLD = 1_000n * FULL_ETH_WEI;
const LOOTBOX_EV_NEUTRAL_POINTS = 60n;
const LOOTBOX_EV_MAX_POINTS = 400n;
const ACTIVITY_SEG_B_KNEE_POINTS = 500n;
const ACTIVITY_EFFECTIVE_CAP_POINTS = 30_000n;

function _lootboxEvMultiplierBps(scoreRaw) {
  const score = BigInt(scoreRaw ?? 0);
  if (score <= LOOTBOX_EV_NEUTRAL_POINTS) {
    return 9_000n + (score * 1_000n) / LOOTBOX_EV_NEUTRAL_POINTS;
  }
  if (score >= ACTIVITY_EFFECTIVE_CAP_POINTS) return 14_500n;
  if (score <= LOOTBOX_EV_MAX_POINTS) {
    return 10_000n
      + ((score - LOOTBOX_EV_NEUTRAL_POINTS) * 3_950n)
        / (LOOTBOX_EV_MAX_POINTS - LOOTBOX_EV_NEUTRAL_POINTS);
  }
  if (score <= ACTIVITY_SEG_B_KNEE_POINTS) {
    return 13_950n
      + ((score - LOOTBOX_EV_MAX_POINTS) * 440n)
        / (ACTIVITY_SEG_B_KNEE_POINTS - LOOTBOX_EV_MAX_POINTS);
  }
  return 14_390n
    + ((score - ACTIVITY_SEG_B_KNEE_POINTS) * 110n)
      / (ACTIVITY_EFFECTIVE_CAP_POINTS - ACTIVITY_SEG_B_KNEE_POINTS);
}

function _humanBoxRootSeed(rngWord, player, amountWei) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'uint256'],
    [BigInt(rngWord), player, BigInt(amountWei)],
  );
  return BigInt(ethers.keccak256(encoded));
}

function _flipToEthValue(flipAmount, priceWei) {
  return (BigInt(flipAmount) * BigInt(priceWei)) / PRICE_COIN_UNIT;
}

/**
 * Exact static-table average used by `_rollLootboxBoons`. Keeping this local
 * makes the shared 4/5/6 reward IDs recoverable from the committed human-box
 * word even when a weaker roll leaves both packed boon families unchanged.
 */
function _humanBoxBoonAverageMaxValue(currentLevel) {
  const level = Number(currentLevel);
  if (!Number.isInteger(level) || level < 1) return 0n;
  const priceWei = scaledTicketPriceWei(level - 1);
  if (priceWei <= 0n) return 0n;
  const eth = FULL_ETH_WEI / BigInt(ETH_DIVISOR);
  let weightedMax = 0n;
  const add = (weight, value) => {
    weightedMax += BigInt(weight) * BigInt(value);
  };
  const pct = (value, bps) => (BigInt(value) * BigInt(bps)) / 10_000n;

  const coinflipCap = 100_000n * FULL_ETH_WEI;
  add(200n, _flipToEthValue(pct(coinflipCap, 500n), priceWei));
  add(40n, _flipToEthValue(pct(coinflipCap, 1_000n), priceWei));
  add(8n, _flipToEthValue(pct(coinflipCap, 2_500n), priceWei));

  const boostCap = 10n * eth;
  add(200n, pct(boostCap, 500n));
  add(30n, pct(boostCap, 1_500n));
  add(8n, pct(boostCap, 2_500n));
  add(400n, pct(boostCap, 500n));
  add(80n, pct(boostCap, 1_500n));
  add(16n, pct(boostCap, 2_500n));

  const decimatorCap = 50_000n * FULL_ETH_WEI;
  add(40n, _flipToEthValue(pct(decimatorCap, 1_000n), priceWei));
  add(8n, _flipToEthValue(pct(decimatorCap, 2_500n), priceWei));
  add(2n, _flipToEthValue(pct(decimatorCap, 5_000n), priceWei));

  const whalePassPrice = 4n * eth;
  add(28n, pct(whalePassPrice, 1_000n));
  add(10n, pct(whalePassPrice, 2_000n));
  add(2n, pct(whalePassPrice, 3_500n));

  const deityPassNominalPrice = 160n * eth;
  add(28n, pct(deityPassNominalPrice, 1_000n));
  add(10n, pct(deityPassNominalPrice, 2_000n));
  add(2n, pct(deityPassNominalPrice, 3_500n));

  // Activity and quest-shield tiers add weight but deliberately carry no
  // assumed value. Whale-pass and lazy-pass values follow them in the table.
  add(2n, (9n * eth) / 2n);
  let lazyPassValue = 0n;
  for (let offset = 0; offset < 10; offset += 1) {
    lazyPassValue += scaledTicketPriceWei(level + 1 + offset);
  }
  add(30n, pct(lazyPassValue, 1_000n));
  add(8n, pct(lazyPassValue, 2_500n));
  add(2n, pct(lazyPassValue, 5_000n));

  const degenEthCap = 10n * eth;
  add(200n, pct(degenEthCap, 400n));
  add(50n, pct(degenEthCap, 800n));
  add(10n, pct(degenEthCap, 1_200n));
  const degenFlipCap = 100_000n * FULL_ETH_WEI;
  add(200n, _flipToEthValue(pct(degenFlipCap, 400n), priceWei));
  add(50n, _flipToEthValue(pct(degenFlipCap, 800n), priceWei));
  add(10n, _flipToEthValue(pct(degenFlipCap, 1_200n), priceWei));
  // WWXRP's three 200-weight tiers carry no assumed value.

  return weightedMax / BOON_WEIGHT_TOTAL;
}

/**
 * Recover the exact shared-family boon drawn by a stored human Luckbox. The
 * return value is needed only through the purchase band; later table entries
 * cannot have emitted compact reward IDs 4/5/6.
 */
export function deriveHumanLootboxBoonType({
  player,
  rngWord,
  packedBox,
  currentLevel,
} = {}) {
  if (!player) return null;
  let word;
  let packed;
  try {
    word = BigInt(rngWord ?? 0);
    packed = BigInt(packedBox ?? 0);
  } catch (_e) {
    return null;
  }
  if (word === 0n || packed === 0n) return null;
  const amount = packed & ((1n << 128n) - 1n);
  const adjusted = (packed >> 128n) & ((1n << 64n) - 1n);
  const activityScore = (packed >> 192n) & 0xFFFFn;
  if (amount === 0n) return null;
  const evBps = _lootboxEvMultiplierBps(activityScore);
  const scaledAmount = evBps <= 10_000n
    ? (amount * evBps) / 10_000n
    : (adjusted * evBps) / 10_000n + (amount - adjusted);
  let boonBudget = (scaledAmount * LOOTBOX_BOON_BUDGET_BPS) / 10_000n;
  if (boonBudget > LOOTBOX_BOON_MAX_BUDGET) boonBudget = LOOTBOX_BOON_MAX_BUDGET;
  if (boonBudget <= 0n) return null;

  const avgMaxValue = _humanBoxBoonAverageMaxValue(currentLevel);
  const expectedPerBoon = (avgMaxValue * LOOTBOX_BOON_UTILIZATION_BPS) / 10_000n;
  if (expectedPerBoon <= 0n) return null;
  let totalChance = (boonBudget * BOON_PPM_SCALE) / expectedPerBoon;
  if (totalChance > BOON_PPM_SCALE) totalChance = BOON_PPM_SCALE;
  if (totalChance <= 0n) return null;

  let seed;
  try { seed = _humanBoxRootSeed(word, player, amount); }
  catch (_e) { return null; }
  const roll = ((seed >> 120n) & U32) % BOON_PPM_SCALE;
  if (roll >= totalChance) return null;
  const weightedRoll = (roll * BOON_WEIGHT_TOTAL) / totalChance;
  const steps = [
    [200n, 1], [40n, 2], [8n, 3],
    [200n, 5], [30n, 6], [8n, 22],
    [400n, 7], [80n, 8], [16n, 9],
  ];
  let cursor = 0n;
  for (const [weight, boonType] of steps) {
    cursor += weight;
    if (weightedRoll < cursor) return boonType;
  }
  return null;
}

function _packedPlayerTicket(reel) {
  try {
    if (reel?.playerTicket != null) return BigInt(reel.playerTicket) & U32;
  } catch (_e) { /* fall through to decoded traits */ }
  const traits = Array.isArray(reel?.playerTraits) ? reel.playerTraits : [];
  if (traits.length < 4) return 0n;
  let packed = 0n;
  for (let q = 0; q < 4; q += 1) {
    const trait = traits[q] || {};
    const symbol = Number(trait.sym ?? trait.symbol);
    const color = Number(trait.col ?? trait.color);
    if (!Number.isInteger(symbol) || !Number.isInteger(color)) return 0n;
    const byte = (q << 6) | ((color & 7) << 3) | (symbol & 7);
    packed |= BigInt(byte) << BigInt(q * 8);
  }
  return packed;
}

/**
 * Contract-identical reconstruction of a human Luckbox's preliminary FLIP
 * payout. BoxSpin emits only the post-survival total, so a bust is zero in the
 * event; the immutable RNG word plus the pre-open packed box word recover the
 * exact stake, activity ROI, per-reel heroes, and therefore the amount risked.
 */
function _deriveHumanBoxSpin({
  spin,
  player,
  rngWord,
  packedBox,
  currentLevel,
} = {}) {
  if (String(spin?.spinType || '').toLowerCase() !== 'flip' || !player) return null;
  let word;
  let packed;
  let betId;
  try {
    word = BigInt(rngWord ?? 0);
    packed = BigInt(packedBox ?? 0);
    betId = BigInt(spin?.betId ?? 0);
  } catch (_e) {
    return null;
  }
  const level = Number(currentLevel);
  if (word === 0n || packed === 0n || betId === 0n
      || !Number.isInteger(level) || level < 0) return null;

  const amount = packed & ((1n << 128n) - 1n);
  const adjusted = (packed >> 128n) & ((1n << 64n) - 1n);
  const activityScore = (packed >> 192n) & 0xFFFFn;
  if (amount === 0n) return null;
  const evBps = _lootboxEvMultiplierBps(activityScore);
  const scaledAmount = evBps <= 10_000n
    ? (amount * evBps) / 10_000n
    : (adjusted * evBps) / 10_000n + (amount - adjusted);
  const boonBudget = (scaledAmount * LOOTBOX_BOON_BUDGET_BPS) / 10_000n;
  const mainAmount = scaledAmount - (
    boonBudget > LOOTBOX_BOON_MAX_BUDGET ? LOOTBOX_BOON_MAX_BUDGET : boonBudget
  );
  if (mainAmount <= 0n) return null;

  let rootSeed;
  try { rootSeed = _humanBoxRootSeed(word, player, amount); }
  catch (_e) { return null; }
  const rollSeeds = [rootSeed];
  const rollAmounts = [mainAmount];
  if (mainAmount > LOOTBOX_SPLIT_THRESHOLD) {
    const first = mainAmount / 2n;
    rollAmounts[0] = first;
    rollAmounts.push(mainAmount - first);
    rollSeeds.push(_entropyHash2(rootSeed, 1n));
  }

  let rollSeed = null;
  let rollAmount = 0n;
  let spinSeed = 0n;
  for (let i = 0; i < rollSeeds.length; i += 1) {
    const candidateSeed = _entropyHash2(rollSeeds[i], BOX_FLIP_SPIN_TAG);
    const candidateId = BOX_BET_ID_SENTINEL
      | (1n << 60n)
      | (candidateSeed & BOX_BET_ID_ENTROPY_MASK);
    if (candidateId !== betId) continue;
    rollSeed = rollSeeds[i];
    rollAmount = rollAmounts[i];
    spinSeed = candidateSeed;
    break;
  }
  if (rollSeed == null || rollAmount <= 0n) return null;

  const varianceRoll = Number((rollSeed >> 80n) & 0xFFFFn) % 20;
  const largeFlipBps = varianceRoll < 16
    ? 4_388n + BigInt(varianceRoll) * 360n
    : 23_199n + BigInt(varianceRoll - 16) * 7_125n;
  const priceWei = scaledTicketPriceWei(level);
  if (priceWei <= 0n) return null;
  const largeFlip = ((rollAmount * largeFlipBps) / 10_000n)
    * PRICE_COIN_UNIT / priceWei;
  const totalStake = (largeFlip * LOOTBOX_FLIP_SPINS_STAKE_BPS) / 10_000n;
  const perSpin = totalStake / 3n;
  if (perSpin <= 0n) return null;

  let payoutAtRisk = 0n;
  const reels = Array.isArray(spin?.reels) ? spin.reels.slice(0, 3) : [];
  for (let i = 0; i < reels.length; i += 1) {
    const reel = reels[i] || {};
    const score = Number(reel.score);
    if (!Number.isInteger(score) || score < 0 || score > 9) continue;
    const heroQuadrant = Number(_entropyHash2(spinSeed, BigInt(i)) & 3n);
    const table = degenerettePayoutTable({
      customTicket: _packedPlayerTicket(reel),
      heroQuadrant,
      currency: 1,
      activityScore,
    });
    const row = table.rows[score];
    payoutAtRisk += (perSpin * row.multiplierNumerator) / row.multiplierDenominator;
  }
  return { amount: payoutAtRisk, spinSeed, activityScore };
}

export function deriveHumanBoxSpinPayoutAtRisk(args) {
  return _deriveHumanBoxSpin(args)?.amount ?? 0n;
}

/**
 * Replay the contract's surviving branch on a reconstructed preliminary sum.
 *
 * `_flipSpinChain` doubles the pre-flip total and then collapses it
 * (DegenerusGameDegeneretteModule.sol:1954-1965). Reproducing that exactly is
 * what lets a *surviving* spin audit the reconstruction: the emitted payout is
 * a published fact, so a derived stake that does not settle back to it is
 * wrong and must not be shown for the busted spins that cannot self-check.
 */
export function boxSpinFlipSurvivalPayout(payoutAtRisk, spinSeed) {
  let total;
  let seed;
  try {
    total = BigInt(payoutAtRisk ?? 0) * 2n;
    seed = BigInt(spinSeed ?? 0);
  } catch (_e) {
    return 0n;
  }
  if (total <= 0n) return 0n;
  if (total <= FLIP_ROUND_THRESHOLD) return (total / FULL_ETH_WEI) * FULL_ETH_WEI;
  const hundreds = total / FLIP_ROUND_UNIT;
  const remainderFlip = (total % FLIP_ROUND_UNIT) / FULL_ETH_WEI;
  const entropy = _entropyHash2(seed, BOX_FLIP_ROUND_TAG) & 0xFFFFFFFFn;
  const roundsUp = remainderFlip !== 0n && (entropy % 100n) < remainderFlip;
  return (hundreds + (roundsUp ? 1n : 0n)) * FLIP_ROUND_UNIT;
}

function _storageKey(types, values) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(types, values));
}

async function _readStorageAt(provider, slot, blockTag) {
  const storageSlot = typeof slot === 'string'
    ? slot
    : ethers.toBeHex(BigInt(slot), 32);
  if (typeof provider?.getStorage === 'function') {
    return provider.getStorage(CONTRACTS.GAME, storageSlot, blockTag);
  }
  if (typeof provider?.send === 'function') {
    return provider.send('eth_getStorageAt', [
      CONTRACTS.GAME,
      storageSlot,
      ethers.toQuantity(blockTag),
    ]);
  }
  throw new Error('Historical storage reader unavailable');
}

async function _readHumanBoxSpinContext({ player, lootboxIndex, blockNumber }) {
  const index = BigInt(lootboxIndex);
  const settlementBlock = Number(blockNumber);
  if (index <= 0n || !Number.isSafeInteger(settlementBlock) || settlementBlock < 1) return null;
  const provider = getProvider();
  if (!provider || !CONTRACTS.GAME) return null;
  const preBlock = settlementBlock - 1;
  const outer = _storageKey(['uint48', 'uint256'], [index, 15n]);
  const boxSlot = _storageKey(['address', 'bytes32'], [player, outer]);
  const rngSlot = _storageKey(['uint48', 'uint256'], [index, 34n]);
  const [packedRaw, rngRaw, timingRaw] = await Promise.all([
    _readStorageAt(provider, boxSlot, preBlock),
    _readStorageAt(provider, rngSlot, preBlock),
    _readStorageAt(provider, 0n, preBlock),
  ]);
  const packedBox = BigInt(packedRaw ?? 0);
  const rngWord = BigInt(rngRaw ?? 0);
  const timing = BigInt(timingRaw ?? 0);
  const currentLevel = Number((timing >> 96n) & 0xFFFFFFn) + 1;
  return packedBox > 0n && rngWord > 0n
    ? { packedBox, rngWord, currentLevel }
    : null;
}

/** True for any human-box FLIP spin whose pre-flip sum is still unnamed. */
function _wantsSurvivalStake(leg) {
  return leg?.legType === 'spin'
    && String(leg?.spinType || '').toLowerCase() === 'flip'
    && _feedBigInt(leg?.preSurvivalPayout ?? leg?.survivalPayout ?? leg?.payoutAtRisk) === 0n
    && (Array.isArray(leg?.reels) ? leg.reels : []).some((reel) => Number(reel?.score) >= 2);
}

/**
 * Attach the pre-flip FLIP sum to human-box FLIP spins, won or busted alike.
 *
 * The stake is a property of the reels and the box, not of the coin: deriving
 * it only for busts left the amount sourced from the settled payout on every
 * other path, which is exactly why a bust had no number to show. Deriving it
 * for both outcomes also buys a live audit — a survivor's emitted payout must
 * replay from the derived stake, and a spin that fails that check is dropped
 * rather than shown.
 */
export async function enrichHumanBoxSpinLegs(legs, {
  player,
  lootboxIndex,
  blockNumber = null,
  context = null,
} = {}) {
  const rows = Array.isArray(legs) ? legs : [];
  const needsAmount = rows.some(_wantsSurvivalStake);
  if (!needsAmount || !player) return rows;
  let exactContext = context;
  if (!exactContext) {
    try {
      exactContext = await _readHumanBoxSpinContext({ player, lootboxIndex, blockNumber });
    } catch (_e) {
      return rows;
    }
  }
  if (!exactContext) return rows;
  // The indexed leg feed records the stored chain level at settlement. Prefer
  // that event-block projection when available; the packed slot read remains
  // the receipt/legacy fallback. The contract prices this roll at level + 1.
  const indexedLevel = rows
    .map((leg) => leg?.levelAtOpen)
    .filter((value) => value != null && value !== '')
    .map(Number)
    .find((value) => Number.isInteger(value) && value >= 0);
  if (indexedLevel != null) {
    exactContext = { ...exactContext, currentLevel: indexedLevel + 1 };
  }
  let changed = false;
  const enriched = rows.map((leg) => {
    if (!_wantsSurvivalStake(leg)) return leg;
    const derived = _deriveHumanBoxSpin({ spin: leg, player, ...exactContext });
    const preSurvivalPayout = derived?.amount ?? 0n;
    if (preSurvivalPayout <= 0n) return leg;
    // A nonzero payout is the surviving branch, and the contract's own
    // doubling + FLIP collapse must reproduce it from this stake. A mismatch
    // means the reconstruction is off, so publish nothing.
    const settled = _feedBigInt(leg?.payout);
    if (settled > 0n
      && boxSpinFlipSurvivalPayout(preSurvivalPayout, derived.spinSeed) !== settled) {
      return leg;
    }
    changed = true;
    return { ...leg, preSurvivalPayout };
  });
  return changed ? enriched : rows;
}

/**
 * Rebuild the six possible BoxSpin ids for one human Luckbox. Spin-only
 * settlements omit LootBoxOpened and the shared RNG index, but their low
 * 60-bit entropy is a commitment to this exact (word, player, amount) tuple.
 */
export function deriveHumanLootboxSpinBetIds({ rngWord, player, amountWei } = {}) {
  let word;
  let amount;
  try {
    word = BigInt(rngWord ?? 0);
    amount = BigInt(amountWei ?? 0);
  } catch (_e) {
    return [];
  }
  if (!player || word === 0n || amount === 0n) return [];
  try {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'uint256'],
      [word, player, amount],
    );
    const rootSeed = BigInt(ethers.keccak256(encoded));
    const rollSeeds = [rootSeed, _entropyHash2(rootSeed, 1n)];
    return rollSeeds.flatMap((rollSeed) => BOX_SPIN_TAGS.map((tag, spinType) => (
      BOX_BET_ID_SENTINEL
      | (BigInt(spinType) << 60n)
      | (_entropyHash2(rollSeed, tag) & BOX_BET_ID_ENTROPY_MASK)
    )));
  } catch (_e) {
    return [];
  }
}

// LootBoxReward rewardType → display label (contract NatSpec, LootboxModule:128).
// Unknown IDs deliberately stay visibly unknown; calling one a "bonus reward"
// made the reveal look like a boon the protocol does not define.
export const REWARD_TYPE_LABELS = Object.freeze({
  2: 'Coinflip boon',
  4: '+5% boost',
  5: '+15% boost',
  6: '+25% boost',
  8: 'Decimator boost',
  9: 'Whale boon',
  10: 'Activity / deity pass boon',
  11: 'Lazy pass discount boon',
  12: 'Quest streak shield',
  13: 'Degenerette boon',
});

export function rewardTypeLabel(rewardType) {
  const type = Number(rewardType);
  return REWARD_TYPE_LABELS[type]
    || `Unknown protocol reward${Number.isInteger(type) && type > 0 ? ` #${type}` : ''}`;
}

function _rewardAmount(raw) {
  try { return BigInt(raw ?? 0); }
  catch (_e) { return 0n; }
}

function _bpsPercent(raw, fallback = null) {
  const amount = _rewardAmount(raw);
  if (amount > 0n && amount <= 10_000n) {
    const tenths = Number(amount / 10n);
    return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
  }
  return fallback == null ? null : String(fallback);
}

const BOON_REVEAL_LABELS = Object.freeze({
  coinflip: 'COINFLIP BOON',
  lootbox: 'LUCKBOX BOON',
  purchase: 'TICKET BOON',
  decimator: 'DECIMATOR BOON',
  whale: 'WHALE PASS BOON',
  activity: 'RATING BOON',
  deity: 'DEITY PASS BOON',
  lazy: 'LAZY PASS BOON',
  'degenerette-eth': 'ETH DEGENERETTE BOON',
  'degenerette-flip': 'FLIP DEGENERETTE BOON',
  'degenerette-wwxrp': 'WWXRP DEGENERETTE BOON',
});

function _exactBoonReveal(boonType) {
  const presentation = boonTypePresentation(boonType);
  const label = BOON_REVEAL_LABELS[presentation.product];
  if (!label) return null;
  const amount = /([+\u2212-]?\d+(?:\.\d+)?)(%)?/.exec(presentation.effect || '');
  if (!amount) return null;
  const magnitude = amount[1].replace(/^[+\u2212-]/, '');
  const discount = ['whale', 'deity', 'lazy'].includes(presentation.product);
  const value = presentation.product === 'activity'
    ? `+${magnitude}`
    : `${discount ? '\u2212' : '+'}${magnitude}%`;
  return { label, value, detail: '' };
}

/**
 * Turn the compact LootBoxReward event into useful player-facing copy.
 * Types 4/5/6 intentionally combine the two purchase-boost categories because
 * the deployed event records strength, but not whether the draw landed in the
 * lootbox or ETH-ticket field. Everything else can be named exactly from its
 * type + amount.
 */
export function lootboxRewardPresentation(
  rewardType,
  amount,
  { boonBps = null, boonType = null } = {},
) {
  const type = Number(rewardType);
  const exact = boonType == null ? null : _exactBoonReveal(boonType);
  if (exact) return exact;
  if (type === 2) {
    const exactPct = _bpsPercent(boonBps)
      // Future event versions may emit the tier's BPS directly. The current
      // deployment emits a 5,000-FLIP value cap, which is intentionally too
      // large for _bpsPercent and therefore cannot masquerade as 50%.
      ?? _bpsPercent(amount);
    return {
      label: 'COINFLIP BOON',
      value: exactPct == null ? 'BOOST' : `+${exactPct}%`,
      detail: '',
    };
  }
  if (type >= 4 && type <= 6) {
    const pct = _bpsPercent(amount, ({ 4: 5, 5: 15, 6: 25 })[type]);
    return {
      label: 'LUCKBOX / TICKET BOON',
      value: `+${pct}%`,
      detail: '',
    };
  }
  if (type === 8) {
    const pct = _bpsPercent(amount);
    return {
      label: 'DECIMATOR BOON',
      value: pct == null ? 'BOOST' : `+${pct}%`,
      detail: '',
    };
  }
  if (type === 9) {
    const pct = _bpsPercent(amount);
    return {
      label: 'WHALE PASS BOON',
      value: pct == null ? 'DISCOUNT' : `−${pct}%`,
      detail: '',
    };
  }
  if (type === 10) {
    const raw = _rewardAmount(amount);
    if (raw > 0n && raw < 100n) {
      const wholeScore = raw / 2n;
      const score = raw % 2n === 0n ? `${wholeScore}` : `${wholeScore}.5`;
      return {
        label: 'RATING BOON',
        value: `+${score}`,
        detail: '',
      };
    }
    const pct = _bpsPercent(raw);
    return {
      label: 'DEITY PASS BOON',
      value: pct == null ? 'DISCOUNT' : `−${pct}%`,
      detail: '',
    };
  }
  if (type === 11) {
    const pct = _bpsPercent(amount);
    return {
      label: 'LAZY PASS BOON',
      value: pct == null ? 'DISCOUNT' : `−${pct}%`,
      detail: '',
    };
  }
  if (type === 12) {
    const count = _rewardAmount(amount) || 1n;
    return {
      label: 'QUEST SHIELD',
      value: `${count} DAY${count === 1n ? '' : 'S'}`,
      detail: '',
    };
  }
  if (type === 13) {
    // Type 13 carries the exact rolled boonType in `amount`: 32-34 ETH,
    // 35-37 FLIP, and 38-40 WWXRP; each lane is +4/+8/+12%.
    const rolledBoonType = Number(_rewardAmount(amount));
    const rolled = rolledBoonType >= 32 && rolledBoonType <= 40
      ? _exactBoonReveal(rolledBoonType)
      : null;
    return rolled || {
      label: 'DEGENERETTE BOON',
      value: 'BOOST',
      detail: '',
    };
  }
  return {
    label: rewardTypeLabel(type).toUpperCase(),
    value: '?',
    detail: 'Unrecognized on-chain reward type',
  };
}

function _boonTierFromValue(value, tiers) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (amount >= tiers[2]) return 3;
  if (amount >= tiers[1]) return 2;
  return 1;
}

/**
 * Product emblem and relative amount tier for a compact LootBoxReward leg.
 * Exact boonType wins. Older/shared events fall back to the most specific
 * product the event actually proves instead of inventing a currency or tier.
 */
export function lootboxRewardVisual(
  rewardType,
  amount,
  { boonBps = null, boonType = null } = {},
) {
  if (boonType != null) return boonTypePresentation(boonType);
  const type = Number(rewardType);
  const raw = _rewardAmount(amount);
  const bpsPct = Number(_bpsPercent(boonBps) ?? _bpsPercent(raw));
  if (type === 2) {
    return boonVisualForProduct('coinflip', _boonTierFromValue(bpsPct, [5, 10, 25]));
  }
  if (type >= 4 && type <= 6) {
    // Reward IDs 4/5/6 share Luckbox and Ticket outcomes. Enrichment normally
    // attaches the exact boonType; the chest is the honest generic fallback.
    return boonVisualForProduct('lootbox', type - 3);
  }
  if (type === 8) {
    return boonVisualForProduct('decimator', _boonTierFromValue(bpsPct, [10, 25, 50]));
  }
  if (type === 9) {
    return boonVisualForProduct('whale', _boonTierFromValue(bpsPct, [10, 20, 35]));
  }
  if (type === 10) {
    if (raw > 0n && raw < 100n) {
      return boonVisualForProduct('activity', _boonTierFromValue(Number(raw), [10, 25, 50]));
    }
    return boonVisualForProduct('deity', _boonTierFromValue(bpsPct, [10, 20, 35]));
  }
  if (type === 11) {
    return boonVisualForProduct('lazy', _boonTierFromValue(bpsPct, [10, 25, 50]));
  }
  if (type === 12) return boonVisualForProduct('quests', 0, 'utility');
  if (type === 13) {
    const rolledType = Number(raw);
    if (rolledType >= 32 && rolledType <= 40) return boonTypePresentation(rolledType);
  }
  return boonVisualForProduct('unknown');
}

const COINFLIP_BOON_BPS = Object.freeze({ 1: 500, 2: 1_000, 3: 2_500 });
const SHARED_BOON_TYPES = Object.freeze({
  4: [5, 7],
  5: [6, 8],
  6: [22, 9],
});
const SHARED_BOON_FAMILIES = Object.freeze([
  [5, 6, 22],
  [7, 8, 9],
]);

function _activeFamilyType(types, family) {
  return family.find((candidate) => types.has(candidate)) ?? null;
}

/**
 * The compact reward event loses the coinflip tier and shares IDs 4/5/6 between
 * Luckbox and Ticket boons. Read the post-settlement packed state and attach
 * the exact boon type before presentation. A failed optional read leaves a
 * concise but honest category fallback in place.
 */
export async function enrichLootboxBoonLegs(legs, {
  player,
  blockNumber = null,
  lootboxIndex = null,
  context = null,
} = {}) {
  const rows = Array.isArray(legs) ? legs : [];
  if (!player || !rows.some((leg) => {
    const rewardType = Number(leg?.rewardType);
    return leg?.legType === 'reward'
      && (rewardType === 2 || SHARED_BOON_TYPES[rewardType]);
  })) return rows;
  let exact;
  try {
    exact = await readExactBoonState(player, { blockTag: blockNumber });
  } catch (_e) {
    return rows;
  }
  const active = decodePackedBoons(
    exact?.slot0,
    exact?.slot1,
    exact?.currentDay,
  );
  const activeTypes = new Set(active.map((boon) => Number(boon?.boonType)));
  const hasSharedReward = rows.some((leg) => (
    leg?.legType === 'reward' && SHARED_BOON_TYPES[Number(leg?.rewardType)]
  ));
  let priorTypes = null;
  const settlementBlock = Number(blockNumber);
  if (hasSharedReward && Number.isSafeInteger(settlementBlock) && settlementBlock > 0) {
    try {
      const prior = await readExactBoonState(player, { blockTag: settlementBlock - 1 });
      priorTypes = new Set(decodePackedBoons(
        prior?.slot0,
        prior?.slot1,
        prior?.currentDay,
      ).map((boon) => Number(boon?.boonType)));
    } catch (_e) {
      // Without historical state, retain the honest category fallback below.
    }
  }
  let sharedFamilyIndex = null;
  if (priorTypes) {
    // Shared reward IDs do not encode their product. A post-state match is
    // insufficient: an ignored lower Ticket roll can share its tier with a
    // held Luckbox boon. A unique before/after family mutation proves which
    // product this event actually rolled.
    const changedFamilies = SHARED_BOON_FAMILIES
      .map((family, index) => ({
        index,
        changed: _activeFamilyType(priorTypes, family)
          !== _activeFamilyType(activeTypes, family),
      }))
      .filter((entry) => entry.changed);
    if (changedFamilies.length === 1) sharedFamilyIndex = changedFamilies[0].index;
  }
  if (hasSharedReward && sharedFamilyIndex == null) {
    let exactContext = context;
    if (!exactContext) {
      try {
        exactContext = await _readHumanBoxSpinContext({
          player,
          lootboxIndex,
          blockNumber,
        });
      } catch (_e) { /* direct/index-zero boxes retain the state-derived fallback */ }
    }
    if (exactContext) {
      const drawnBoonType = deriveHumanLootboxBoonType({ player, ...exactContext });
      if (SHARED_BOON_FAMILIES[0].includes(drawnBoonType)) sharedFamilyIndex = 0;
      else if (SHARED_BOON_FAMILIES[1].includes(drawnBoonType)) sharedFamilyIndex = 1;
    }
  }
  return rows.map((leg) => {
    if (leg?.legType !== 'reward') return leg;
    if (leg?.boonType != null) return leg;
    const rewardType = Number(leg?.rewardType);
    if (rewardType === 2) {
      const boonType = [3, 2, 1].find((candidate) => activeTypes.has(candidate));
      const boonBps = COINFLIP_BOON_BPS[boonType] || null;
      return boonBps == null ? leg : { ...leg, boonType, boonBps };
    }
    const candidates = SHARED_BOON_TYPES[rewardType];
    if (candidates && sharedFamilyIndex != null) {
      return { ...leg, boonType: candidates[sharedFamilyIndex] };
    }
    return leg;
  });
}

/**
 * Decode a BoxSpin packedSpins word into reels (indexer-parity).
 * @param {bigint} betId
 * @param {bigint} packed
 * @returns {{boxOrigin: boolean, spinType: string, spinCount: number,
 *            heroQuadrant: number|null,
 *            survived: boolean|null,
 *            reels: Array<{spinIndex: number, score: number,
 *                          playerTicket: bigint, resultTicket: bigint,
 *                          playerTraits: Array<{sym:number,col:number}>,
 *                          resultTraits: Array<{sym:number,col:number}>}>}}
 */
export function decodeBoxSpin(betId, packed) {
  const id = BigInt(betId ?? 0);
  const p = BigInt(packed ?? 0);
  const boxOrigin = ((id >> 63n) & 1n) === 1n;
  const heroQuadrant = boxSpinHeroQuadrant(id);
  const typeCode = Number((id >> 60n) & 0x7n);
  const spinType = SPIN_TYPES[typeCode] ?? `unknown_${typeCode}`;
  const spinCount = Number((p >> COUNT_SHIFT) & 0xFFn);
  const survived = spinType === 'flip' || spinType === 'record'
    ? ((p >> SURVIVED_SHIFT) & 1n) === 1n
    : null;
  const reels = [];
  for (let i = 0; i < spinCount && i < 3; i++) {
    const chunk = p >> (BigInt(i) * SPIN_STRIDE);
    const playerTicket = chunk & U32;
    const resultTicket = (chunk >> 32n) & U32;
    const score = Number((chunk >> 64n) & 0xFFn);
    reels.push({
      spinIndex: i,
      score,
      playerTicket,
      resultTicket,
      playerTraits: dgnUnpackTicket(playerTicket),
      resultTraits: dgnUnpackTicket(resultTicket),
    });
  }
  return { boxOrigin, spinType, spinCount, heroQuadrant, survived, reels };
}

/**
 * Whole tickets from a LootBoxOpened leg: futureTickets is pre-Bernoulli
 * scaled ×QTY_SCALE (100); roundedUp means the fractional Bernoulli roll won
 * (+1 whole ticket). LootboxModule.sol:1378-1389.
 */
export function wholeTicketsFromOpened(futureTickets, roundedUp) {
  const scaled = Number(futureTickets ?? 0);
  let whole = Math.floor(scaled / 100);
  if (roundedUp) whole += 1;
  return whole;
}

let _ifaceCache = null;
let _transferIfaceCache = null;
let _openCallIfaceCache = null;
function _iface() {
  if (!_ifaceCache) _ifaceCache = new ethers.Interface(OPEN_EVENTS_ABI);
  return _ifaceCache;
}
function _transferIface() {
  if (!_transferIfaceCache) _transferIfaceCache = new ethers.Interface(TRANSFER_EVENTS_ABI);
  return _transferIfaceCache;
}
function _openCallIface() {
  if (!_openCallIfaceCache) _openCallIfaceCache = new ethers.Interface(OPEN_CALL_ABI);
  return _openCallIfaceCache;
}

/** Test-only — drop the cached Interface (harmless in production). */
export function __resetForTest() {
  _ifaceCache = null;
  _transferIfaceCache = null;
  _openCallIfaceCache = null;
}

/**
 * Parse an openBox receipt into normalized prize legs, in log order.
 * GAME logs carry the settlement itself. An immediately preceding WWXRP mint
 * is also retained because it is the contract's cold-bust consolation for a
 * fractional ticket roll that did not round up.
 *
 * @param {import('ethers').TransactionReceipt|null|undefined} receipt
 * @param {string} [playerFilter] lowercase address — keep only this player's legs
 * @returns {Array<object>} legs:
 *   {legType:'opened',    lootboxIndex, amount, futureLevel, futureTickets,
 *                         roundedUp, wholeTickets, flip}
 *   {legType:'wwxrp',     amount, consolation:true}
 *   {legType:'dgnrs',     amount}
 *   {legType:'whalepass', targetLevel, entriesPerLevel}
 *   {legType:'reward',    rewardType, label, amount}
 *   {legType:'spin',      spinType, spinCount, survived, payout, ethShare, reels}
 */
export function parseOpenLegsFromReceipt(receipt, playerFilter) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  const receiptHash = String(receipt.hash || receipt.transactionHash || '').toLowerCase();
  const iface = _iface();
  const gameAddr = String(CONTRACTS.GAME || '').toLowerCase();
  const wwxrpAddr = String(CONTRACTS.WWXRP || '').toLowerCase();
  const want = playerFilter ? String(playerFilter).toLowerCase() : null;
  let pendingWwxrpMint = null;
  for (let position = 0; position < receipt.logs.length; position += 1) {
    const log = receipt.logs[position];
    try {
      const logAddress = String(log.address || '').toLowerCase();
      if (wwxrpAddr && logAddress === wwxrpAddr) {
        const transfer = _transferIface().parseLog(log);
        const from = String(transfer?.args?.from ?? transfer?.args?.[0] ?? '').toLowerCase();
        const to = String(transfer?.args?.to ?? transfer?.args?.[1] ?? '').toLowerCase();
        pendingWwxrpMint = from === ZERO_ADDRESS && (!want || to === want)
          ? { position, amount: BigInt(transfer.args.value ?? transfer.args[2] ?? 0) }
          : null;
        continue;
      }
      if (gameAddr && logAddress !== gameAddr) continue;
      const parsed = iface.parseLog(log);
      if (!parsed) continue;
      const player = String(parsed.args.player ?? parsed.args[0] ?? '').toLowerCase();
      if (want && player !== want) continue;
      switch (parsed.name) {
        case 'LootBoxOpened': {
          const futureTickets = Number(parsed.args.futureTickets);
          const roundedUp = Boolean(parsed.args.roundedUp);
          const wholeTickets = wholeTicketsFromOpened(futureTickets, roundedUp);
          const flip = BigInt(parsed.args.flip);
          // mintPrize emits its Transfer immediately before LootBoxOpened. Do
          // not treat an unrelated WWXRP mint elsewhere in the receipt as box
          // contents; adjacency is the provenance check.
          if (futureTickets > 0
              && wholeTickets === 0
              && flip === 0n
              && pendingWwxrpMint?.position === position - 1) {
            out.push({
              legType: 'wwxrp',
              amount: pendingWwxrpMint.amount,
              consolation: true,
            });
          }
          out.push({
            legType: 'opened',
            transactionHash: String(log.transactionHash || receiptHash || '').toLowerCase() || null,
            lootboxIndex: BigInt(parsed.args.lootboxIndex),
            amount: BigInt(parsed.args.amount),
            futureLevel: Number(parsed.args.futureLevel),
            futureTickets,
            roundedUp,
            wholeTickets,
            flip,
          });
          break;
        }
        case 'LootBoxDgnrsReward':
          out.push({ legType: 'dgnrs', amount: BigInt(parsed.args.dgnrsAmount) });
          break;
        case 'LootBoxWhalePassJackpot':
          out.push({
            legType: 'whalepass',
            targetLevel: Number(parsed.args.targetLevel),
            entriesPerLevel: Number(parsed.args.entriesPerLevel),
          });
          break;
        case 'LootBoxReward': {
          const rewardType = Number(parsed.args.rewardType);
          out.push({
            legType: 'reward',
            rewardType,
            label: rewardTypeLabel(rewardType),
            amount: BigInt(parsed.args.amount),
          });
          break;
        }
        case 'PresaleBoxOpened': {
          // Normalize the presale result into the same prize-leg vocabulary as
          // the historical indexer feed: an opened anchor plus the independently
          // displayable DGNRS / WWXRP legs.
          out.push({
            legType: 'opened',
            source: 'presale',
            transactionHash: String(log.transactionHash || receiptHash || '').toLowerCase() || null,
            lootboxIndex: BigInt(parsed.args.index),
            amount: BigInt(parsed.args.amount),
            futureLevel: 0,
            wholeTickets: 0,
            flip: BigInt(parsed.args.flip),
            closing: Boolean(parsed.args.closing),
          });
          if (BigInt(parsed.args.dgnrs) > 0n) {
            out.push({ legType: 'dgnrs', amount: BigInt(parsed.args.dgnrs) });
          }
          if (BigInt(parsed.args.wwxrp) > 0n) {
            out.push({ legType: 'wwxrp', amount: BigInt(parsed.args.wwxrp) });
          }
          break;
        }
        case 'BoxSpin': {
          const decoded = decodeBoxSpin(BigInt(parsed.args.betId), BigInt(parsed.args.packedSpins));
          out.push({
            legType: 'spin',
            blockNumber: receipt?.blockNumber ?? log?.blockNumber ?? null,
            ...decoded,
            payout: BigInt(parsed.args.payout),
            ethShare: BigInt(parsed.args.ethShare),
          });
          break;
        }
        default:
          break;
      }
    } catch (_e) {
      // foreign / unknown log — skip
    }
  }
  return out;
}

function _feedBigInt(value) {
  try { return BigInt(value ?? 0); } catch (_e) { return 0n; }
}

function _feedSpinPayoutContext(data) {
  const rawPreSurvival = data?.preSurvivalPayout
    ?? data?.survivalPayout
    ?? data?.payoutAtRisk;
  const rawSurvivalWin = data?.survivalWinPayout;
  return {
    ...(rawPreSurvival == null
      ? {}
      : { preSurvivalPayout: _feedBigInt(rawPreSurvival) }),
    ...(rawSurvivalWin == null
      ? {}
      : { survivalWinPayout: _feedBigInt(rawSurvivalWin) }),
  };
}

/**
 * Degenerette's feed embeds the lootbox settlement events emitted in the same
 * resolve transaction. Rebuild those raw indexer rows into the exact prize-leg
 * vocabulary used by a normal lootbox receipt, preserving event order.
 */
export function openLegsFromDegenerettePayouts(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const type = String(item?.rewardType || item?.legType || '');
    const data = item?.rewardData || item?.spin || {};
    if (type === 'opened' || type === 'LootBoxOpened') {
      out.push({
        legType: 'opened',
        transactionHash: String(item?.transactionHash || data.transactionHash || '').toLowerCase() || null,
        blockNumber: item?.blockNumber == null ? null : String(item.blockNumber),
        logIndex: item?.logIndex == null ? null : Number(item.logIndex),
        // Direct Degenerette boxes are already settled and intentionally use
        // index zero; this index is presentation context, not an open action.
        lootboxIndex: _feedBigInt(item?.lootboxIndex ?? data.lootboxIndex ?? 0),
        amount: _feedBigInt(data.amount ?? item?.boxAmountRawWei),
        futureLevel: Number(data.futureLevel ?? item?.levelAtOpen ?? 0),
        futureTickets: Number(data.futureTickets ?? 0),
        roundedUp: Boolean(data.roundedUp),
        wholeTickets: wholeTicketsFromOpened(
          Number(data.futureTickets ?? 0),
          Boolean(data.roundedUp),
        ),
        flip: _feedBigInt(data.flip),
      });
    } else if (type === 'LootBoxDgnrsReward' || type === 'dgnrs') {
      out.push({ legType: 'dgnrs', amount: _feedBigInt(data.dgnrsAmount ?? data.amount) });
    } else if (type === 'LootBoxWhalePassJackpot' || type === 'whalepass') {
      out.push({
        legType: 'whalepass',
        targetLevel: Number(data.targetLevel ?? item?.levelAtOpen ?? 0),
        entriesPerLevel: Number(data.entriesPerLevel ?? 0),
      });
    } else if (type === 'LootBoxReward' || type === 'reward') {
      const rewardType = Number(data.rewardType ?? data.type ?? 0);
      out.push({
        legType: 'reward',
        rewardType,
        label: rewardTypeLabel(rewardType),
        amount: _feedBigInt(data.amount),
      });
    } else if (type === 'BoxSpin' || type === 'spin') {
      if (data.packedSpins != null && data.betId != null) {
        const decoded = decodeBoxSpin(_feedBigInt(data.betId), _feedBigInt(data.packedSpins));
        out.push({
          legType: 'spin',
          blockNumber: item?.blockNumber ?? data?.blockNumber ?? null,
          levelAtOpen: item?.levelAtOpen ?? data?.levelAtOpen ?? null,
          ...decoded,
          payout: _feedBigInt(data.payout),
          ethShare: _feedBigInt(data.ethShare),
          ..._feedSpinPayoutContext(data),
        });
      } else if (Array.isArray(data.reels)) {
        out.push({
          legType: 'spin',
          blockNumber: item?.blockNumber ?? data?.blockNumber ?? null,
          levelAtOpen: item?.levelAtOpen ?? data?.levelAtOpen ?? null,
          boxOrigin: true,
          betId: data.betId == null ? null : String(data.betId),
          heroQuadrant: data.heroQuadrant == null
            ? boxSpinHeroQuadrant(data.betId)
            : (Number(data.heroQuadrant) & 3),
          spinType: String(data.spinType || ''),
          spinCount: Number(data.spinCount ?? data.reels.length),
          survived: data.survived == null ? null : Boolean(data.survived),
          payout: _feedBigInt(data.payout),
          ethShare: _feedBigInt(data.ethShare),
          ..._feedSpinPayoutContext(data),
          reels: data.reels,
        });
      }
    }
  }
  return out;
}

/**
 * Turn the indexer's historical `/lootbox/legs` rows back into the same
 * normalized legs produced from a live openBox receipt.
 *
 * The exact-index settlement event is used only as a transaction anchor; every
 * same-player leg in that transaction is then included, which preserves split
 * boxes, boons, passes, and BoxSpin reels in their original log order. A
 * A raw spin-only resolution has no index in the BoxSpin event. The exact API
 * lookup can safely reconstruct that index from the spin's deterministic bet
 * id; only a spin carrying that verified index is accepted as an anchor.
 *
 * @param {Array<object>} items
 * @param {{player: string, lootboxIndex?: bigint|number, transactionHash?: string}} args
 * @returns {Array<object>}
 */
export function openLegsFromFeed(items, { player, lootboxIndex, transactionHash } = {}) {
  // Exact and recent feed projections are often merged by callers. One chain
  // event is uniquely (transactionHash, logIndex), so collapse overlap before
  // it can become duplicate reward cards or duplicate BoxSpin choreography.
  const rows = [];
  const eventSlots = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const txHash = String(item?.transactionHash || '').toLowerCase();
    const rawLogIndex = item?.logIndex;
    const logIndex = rawLogIndex == null ? Number.NaN : Number(rawLogIndex);
    const eventKey = txHash && Number.isInteger(logIndex) && logIndex >= 0
      ? `${txHash}:${logIndex}`
      : null;
    if (!eventKey) {
      rows.push(item);
      continue;
    }
    const priorIndex = eventSlots.get(eventKey);
    if (priorIndex == null) {
      eventSlots.set(eventKey, rows.length);
      rows.push(item);
      continue;
    }
    const prior = rows[priorIndex] || {};
    rows[priorIndex] = {
      ...prior,
      ...item,
      rewardData: item?.rewardData == null
        ? prior.rewardData
        : { ...(prior.rewardData || {}), ...item.rewardData },
      spin: item?.spin == null
        ? prior.spin
        : { ...(prior.spin || {}), ...item.spin },
    };
  }
  const wantPlayer = String(player || '').toLowerCase();
  const wantIndex = String(lootboxIndex ?? '');
  const wantTx = String(transactionHash || '').toLowerCase();
  if (!wantPlayer || (!wantIndex && !wantTx)) return [];

  const anchors = wantTx ? [] : rows
    .filter((item) => String(item?.player || '').toLowerCase() === wantPlayer
      && item?.lootboxIndex != null
      && String(item.lootboxIndex) === wantIndex
      && ['opened', 'presale', 'flipOpened', 'spin'].includes(String(item?.legType || '')))
    .sort((a, b) => Number(b?.ord ?? b?.logIndex ?? 0) - Number(a?.ord ?? a?.logIndex ?? 0));
  const txHash = wantTx || anchors[0]?.transactionHash;
  if (!txHash) return [];

  const txRows = rows
    .filter((item) => String(item?.player || '').toLowerCase() === wantPlayer
      && String(item?.transactionHash || '').toLowerCase() === String(txHash).toLowerCase())
    .sort((a, b) => Number(a?.logIndex ?? 0) - Number(b?.logIndex ?? 0));

  const out = [];
  for (const item of txRows) {
    const data = item?.rewardData || {};
    switch (item?.legType) {
      case 'opened': {
        const futureTickets = Number(data.futureTickets ?? 0);
        const roundedUp = Boolean(data.roundedUp);
        out.push({
          legType: 'opened',
          transactionHash: String(item?.transactionHash || '').toLowerCase() || null,
          blockNumber: item?.blockNumber == null ? null : String(item.blockNumber),
          logIndex: item?.logIndex == null ? null : Number(item.logIndex),
          lootboxIndex: BigInt(item.lootboxIndex),
          amount: _feedBigInt(data.amount ?? item.boxAmountRawWei),
          futureLevel: Number(data.futureLevel ?? item.levelAtOpen ?? 0),
          futureTickets,
          roundedUp,
          wholeTickets: wholeTicketsFromOpened(futureTickets, roundedUp),
          flip: _feedBigInt(data.flip),
        });
        break;
      }
      case 'flipOpened': {
        const futureTickets = Number(data.tickets ?? data.futureTickets ?? 0);
        const roundedUp = Boolean(data.roundedUp);
        out.push({
          legType: 'opened',
          transactionHash: String(item?.transactionHash || '').toLowerCase() || null,
          blockNumber: item?.blockNumber == null ? null : String(item.blockNumber),
          logIndex: item?.logIndex == null ? null : Number(item.logIndex),
          lootboxIndex: BigInt(item.lootboxIndex ?? 0),
          amount: _feedBigInt(data.flipAmount),
          futureLevel: Number(data.ticketLevel ?? data.futureLevel ?? item.levelAtOpen ?? 0),
          futureTickets,
          roundedUp,
          wholeTickets: wholeTicketsFromOpened(futureTickets, roundedUp),
          flip: _feedBigInt(data.flipReward ?? data.flip),
        });
        break;
      }
      case 'presale': {
        out.push({
          legType: 'opened',
          transactionHash: String(item?.transactionHash || '').toLowerCase() || null,
          blockNumber: item?.blockNumber == null ? null : String(item.blockNumber),
          logIndex: item?.logIndex == null ? null : Number(item.logIndex),
          lootboxIndex: BigInt(item.lootboxIndex ?? 0),
          amount: _feedBigInt(data.amount),
          futureLevel: Number(item.levelAtOpen ?? 0),
          wholeTickets: 0,
          flip: _feedBigInt(data.flip),
        });
        if (_feedBigInt(data.dgnrs) > 0n) {
          out.push({ legType: 'dgnrs', amount: _feedBigInt(data.dgnrs) });
        }
        if (_feedBigInt(data.wwxrp) > 0n) {
          out.push({ legType: 'wwxrp', amount: _feedBigInt(data.wwxrp) });
        }
        break;
      }
      case 'dgnrs':
        out.push({ legType: 'dgnrs', amount: _feedBigInt(data.dgnrsAmount ?? data.amount) });
        break;
      case 'whalepass':
        out.push({
          legType: 'whalepass',
          targetLevel: Number(data.targetLevel ?? item.levelAtOpen ?? 0),
          entriesPerLevel: Number(data.entriesPerLevel ?? 0),
        });
        break;
      case 'reward': {
        const rewardType = Number(data.rewardType ?? data.type ?? 0);
        out.push({
          legType: 'reward',
          rewardType,
          label: rewardTypeLabel(rewardType),
          amount: _feedBigInt(data.amount),
        });
        break;
      }
      case 'lazypass':
        out.push({
          legType: 'reward',
          rewardType: 11,
          label: 'Lazy pass',
          amount: _feedBigInt(data.amount),
        });
        break;
      case 'spin': {
        const spin = item.spin || {};
        out.push({
          legType: 'spin',
          blockNumber: item?.blockNumber ?? spin?.blockNumber ?? null,
          levelAtOpen: item?.levelAtOpen ?? spin?.levelAtOpen ?? null,
          boxOrigin: true,
          betId: spin.betId == null ? null : String(spin.betId),
          heroQuadrant: spin.heroQuadrant == null
            ? boxSpinHeroQuadrant(spin.betId)
            : (Number(spin.heroQuadrant) & 3),
          spinType: String(spin.spinType || ''),
          spinCount: Number(spin.spinCount ?? spin.reels?.length ?? 0),
          survived: spin.survived == null ? null : Boolean(spin.survived),
          payout: _feedBigInt(spin.payout),
          ethShare: _feedBigInt(spin.ethShare),
          ..._feedSpinPayoutContext(spin),
          reels: Array.isArray(spin.reels) ? spin.reels : [],
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

const REPLAY_LOG_CHUNK_BLOCKS = 1800;
const REPLAY_LOG_CHUNK_LIMIT = 10;
const REPLAY_HINTED_CHUNK_LIMIT = 40;
const REPLAY_SPIN_TX_LIMIT = 60;

/**
 * Recover a resolved box receipt straight from chain. Normal outcomes anchor
 * on their indexed LootBoxOpened event. Spin-only outcomes deliberately omit
 * that event, so match BoxSpin either by its exact RNG-derived bet id or, for
 * legacy direct opens, by decoding openBox(player,index) calldata.
 */
export async function readOpenLegsFromChain({
  player,
  lootboxIndex,
  purchaseTransactionHashes = [],
  boxAmountWei = null,
} = {}) {
  if (!player || lootboxIndex == null) return [];
  let index;
  try { index = BigInt(lootboxIndex); } catch (_e) { return []; }
  const provider = getProvider();
  if (!provider
    || typeof provider.getBlockNumber !== 'function'
    || typeof provider.getLogs !== 'function'
    || typeof provider.getTransactionReceipt !== 'function') return [];

  let head;
  try { head = Number(await provider.getBlockNumber()); }
  catch (_e) { return []; }
  if (!Number.isFinite(head) || head < 0) return [];

  // A locally tracked purchase gives us a much stronger search origin than
  // "recent blocks". Search forward from that immutable receipt so even an
  // old Pending row finds the result near the time it actually opened.
  let purchaseBlock = null;
  let purchaseAmountWei = 0n;
  let creditedAmountWei = 0n;
  try { creditedAmountWei = BigInt(boxAmountWei ?? 0); }
  catch (_e) { creditedAmountWei = 0n; }
  const purchaseHashes = [...new Set([
    ...(Array.isArray(purchaseTransactionHashes) ? purchaseTransactionHashes : []),
  ].filter(Boolean).map((hash) => String(hash).toLowerCase()))];
  for (const hash of purchaseHashes) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      const block = Number(receipt?.blockNumber);
      if (Number.isFinite(block) && block >= 0) {
        purchaseBlock = purchaseBlock == null ? block : Math.min(purchaseBlock, block);
      }
      for (const log of Array.isArray(receipt?.logs) ? receipt.logs : []) {
        try {
          const parsed = _iface().parseLog(log);
          if (parsed?.name !== 'LootBoxBuy') continue;
          const buyer = String(parsed.args.buyer ?? parsed.args[0] ?? '').toLowerCase();
          const eventIndex = BigInt(parsed.args.index ?? parsed.args[1] ?? -1);
          if (buyer !== String(player).toLowerCase() || eventIndex !== index) continue;
          purchaseAmountWei += BigInt(parsed.args.amount ?? parsed.args[2] ?? 0);
        } catch (_e) { /* foreign purchase-receipt log */ }
      }
    } catch (_e) { /* another reader or the index feed may still recover it */ }
  }

  let topicSets;
  let spinTopics;
  let purchaseTopics;
  let rngAppliedTopics;
  try {
    topicSets = ['LootBoxOpened', 'PresaleBoxOpened'].map((name) => (
      _iface().encodeFilterTopics(_iface().getEvent(name), [player, index])
    ));
    spinTopics = _iface().encodeFilterTopics(_iface().getEvent('BoxSpin'), [player]);
    purchaseTopics = _iface().encodeFilterTopics(_iface().getEvent('LootBoxBuy'), [player, index]);
    rngAppliedTopics = _iface().encodeFilterTopics(_iface().getEvent('LootboxRngApplied'), []);
  } catch (_e) {
    return [];
  }

  let inspectedSpinTransactions = 0;
  let rngWord = 0n;
  const deployBlock = Number(CHAIN.deployBlock || 0);
  const rangeCount = purchaseBlock == null ? REPLAY_LOG_CHUNK_LIMIT : REPLAY_HINTED_CHUNK_LIMIT;
  for (let i = 0; i < rangeCount; i += 1) {
    const fromBlock = purchaseBlock == null
      ? Math.max(deployBlock, head - i * REPLAY_LOG_CHUNK_BLOCKS - REPLAY_LOG_CHUNK_BLOCKS + 1)
      : Math.max(deployBlock, purchaseBlock + i * REPLAY_LOG_CHUNK_BLOCKS);
    const toBlock = purchaseBlock == null
      ? head - i * REPLAY_LOG_CHUNK_BLOCKS
      : Math.min(head, fromBlock + REPLAY_LOG_CHUNK_BLOCKS - 1);
    if (toBlock < fromBlock || fromBlock > head) break;
    let logs;
    let rngLogs;
    let purchaseLogs;
    try {
      const [groups, applied, purchases] = await Promise.all([
        Promise.all(topicSets.map((topics) => provider.getLogs({
          address: CONTRACTS.GAME,
          topics,
          fromBlock,
          toBlock,
        }))),
        provider.getLogs({
          address: CONTRACTS.GAME,
          topics: rngAppliedTopics,
          fromBlock,
          toBlock,
        }),
        purchaseAmountWei > 0n
          ? Promise.resolve([])
          : provider.getLogs({
              address: CONTRACTS.GAME,
              topics: purchaseTopics,
              fromBlock,
              toBlock,
            }),
      ]);
      logs = groups.flat().sort((a, b) => (
        Number(a?.blockNumber ?? 0) - Number(b?.blockNumber ?? 0)
        || Number(a?.index ?? a?.logIndex ?? 0) - Number(b?.index ?? b?.logIndex ?? 0)
      ));
      rngLogs = applied;
      purchaseLogs = purchases;
    } catch (_e) {
      return [];
    }

    for (const log of Array.isArray(rngLogs) ? rngLogs : []) {
      try {
        const parsed = _iface().parseLog(log);
        if (parsed?.name !== 'LootboxRngApplied') continue;
        const eventIndex = BigInt(parsed.args.index ?? parsed.args[0] ?? -1);
        if (eventIndex === index) rngWord = BigInt(parsed.args.word ?? parsed.args[1] ?? 0);
      } catch (_e) { /* unrelated RNG event */ }
    }
    for (const log of Array.isArray(purchaseLogs) ? purchaseLogs : []) {
      try {
        const parsed = _iface().parseLog(log);
        if (parsed?.name === 'LootBoxBuy') {
          purchaseAmountWei += BigInt(parsed.args.amount ?? parsed.args[2] ?? 0);
        }
      } catch (_e) { /* malformed purchase log */ }
    }
    const anchor = Array.isArray(logs) ? logs.at(-1) : null;
    if (anchor?.transactionHash) {
      try {
        const receipt = await provider.getTransactionReceipt(anchor.transactionHash);
        const legs = parseOpenLegsFromReceipt(receipt, player);
        if (legs.length > 0) return legs;
      } catch (_e) {
        return [];
      }
    }

    // BoxSpin omits the lootbox index. Its bet id still commits to the applied
    // RNG word, player, and summed purchase amount, which identifies results
    // emitted by permissionless batch opens. Keep direct-call decoding as a
    // fallback for legacy results whose deterministic inputs are unavailable.
    if ((typeof provider.getTransaction === 'function'
        || (rngWord > 0n && (purchaseAmountWei > 0n || creditedAmountWei > 0n)))
        && inspectedSpinTransactions < REPLAY_SPIN_TX_LIMIT) {
      let spinLogs;
      try {
        spinLogs = await provider.getLogs({
          address: CONTRACTS.GAME,
          topics: spinTopics,
          fromBlock,
          toBlock,
        });
      } catch (_e) {
        spinLogs = [];
      }
      const candidates = (Array.isArray(spinLogs) ? spinLogs : []).slice().sort((a, b) => (
        Number(b?.blockNumber ?? 0) - Number(a?.blockNumber ?? 0)
        || Number(b?.index ?? b?.logIndex ?? 0) - Number(a?.index ?? a?.logIndex ?? 0)
      ));
      // LootBoxBuy records what the player paid. A purchase boon can credit a
      // larger amount to the box, and that credited amount is what the spin's
      // deterministic bet id commits to. Try both so old receipt-only rows and
      // boost-aware feed rows are equally recoverable.
      const deterministicBetIds = new Set(
        [...new Set([purchaseAmountWei, creditedAmountWei].filter((amount) => amount > 0n))]
          .flatMap((amountWei) => deriveHumanLootboxSpinBetIds({
            rngWord,
            player,
            amountWei,
          }).map(String)),
      );
      for (const candidate of candidates) {
        if (inspectedSpinTransactions >= REPLAY_SPIN_TX_LIMIT) break;
        inspectedSpinTransactions += 1;
        if (!candidate?.transactionHash) continue;
        try {
          let matches = false;
          if (deterministicBetIds.size > 0) {
            const parsedSpin = _iface().parseLog(candidate);
            const candidateBetId = String(parsedSpin?.args?.betId ?? parsedSpin?.args?.[1] ?? '');
            matches = deterministicBetIds.has(candidateBetId);
          }
          if (!matches && typeof provider.getTransaction === 'function') {
            const tx = await provider.getTransaction(candidate.transactionHash);
            const to = String(tx?.to || '').toLowerCase();
            if (to && to !== String(CONTRACTS.GAME || '').toLowerCase()) continue;
            const data = tx?.data ?? tx?.input;
            if (!data) continue;
            const call = _openCallIface().parseTransaction({ data, value: tx?.value ?? 0 });
            if (!call || call.name !== 'openBox') continue;
            const callPlayer = String(call.args.player ?? call.args[0] ?? '').toLowerCase();
            const callIndex = BigInt(call.args.index ?? call.args[1] ?? -1);
            matches = callPlayer === String(player).toLowerCase() && callIndex === index;
          }
          if (!matches) continue;
          const receipt = await provider.getTransactionReceipt(candidate.transactionHash);
          const legs = parseOpenLegsFromReceipt(receipt, player);
          if (legs.length > 0) return legs;
        } catch (_e) {
          // Not an openBox call (foil/redemption/other box-origin spin), or the
          // RPC has not retained the transaction yet. Keep scanning candidates.
        }
      }
    }
    if (purchaseBlock == null ? fromBlock === deployBlock : toBlock === head) break;
  }
  return [];
}
