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
import { CHAIN, CONTRACTS } from './chain-config.js';
import { dgnUnpackTicket } from './dgn-traits.js';
import { decodePackedBoons } from './boons.js';
import { readExactBoonState } from './polling.js';

// Minimal open-receipt event ABI — parse-only (no writes here; openLootBox
// lives in lootbox.js).
export const OPEN_EVENTS_ABI = [
  'event LootBoxOpened(address indexed player, uint48 indexed lootboxIndex, uint256 amount, uint24 futureLevel, uint32 futureTickets, uint256 flip, bool roundedUp)',
  'event LootBoxDgnrsReward(address indexed player, uint256 lootboxAmount, uint256 dgnrsAmount)',
  'event LootBoxWhalePassJackpot(address indexed player, uint256 lootboxAmount, uint24 targetLevel, uint32 entriesPerLevel, uint24 statsBoost, uint24 frozenUntilLevel)',
  'event LootBoxReward(address indexed player, uint8 indexed rewardType, uint256 lootboxAmount, uint256 amount)',
  'event PresaleBoxOpened(address indexed player, uint48 indexed index, uint256 amount, uint256 flip, uint256 dgnrs, uint256 wwxrp, bool closing)',
  'event BoxSpin(address indexed player, uint64 betId, uint256 packedSpins, uint256 payout, uint256 ethShare)',
];
const OPEN_CALL_ABI = ['function openBox(address player, uint48 index)'];

const SPIN_TYPES = ['wwxrp', 'flip', 'eth'];
const SPIN_STRIDE = 72n;
const COUNT_SHIFT = 216n;
const SURVIVED_SHIFT = 224n;
const U32 = 0xFFFFFFFFn;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TRANSFER_EVENTS_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

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

/**
 * Turn the compact LootBoxReward event into useful player-facing copy.
 * Types 4/5/6 intentionally combine the two purchase-boost categories because
 * the deployed event records strength, but not whether the draw landed in the
 * lootbox or ETH-ticket field. Everything else can be named exactly from its
 * type + amount.
 */
export function lootboxRewardPresentation(rewardType, amount, { boonBps = null } = {}) {
  const type = Number(rewardType);
  if (type === 2) {
    const exactPct = _bpsPercent(boonBps)
      // Future event versions may emit the tier's BPS directly. The current
      // deployment emits a 5,000-FLIP value cap, which is intentionally too
      // large for _bpsPercent and therefore cannot masquerade as 50%.
      ?? _bpsPercent(amount);
    return {
      label: 'COINFLIP BOON',
      value: exactPct == null ? 'BOOST' : `+${exactPct}%`,
      detail: exactPct == null
        ? 'Boosts your next manual Coinflip deposit, calculated on up to 100K FLIP'
        : `Your next manual Coinflip deposit gets +${exactPct}%, calculated on up to 100K FLIP`,
    };
  }
  if (type >= 4 && type <= 6) {
    const pct = _bpsPercent(amount, ({ 4: 5, 5: 15, 6: 25 })[type]);
    return {
      label: 'PURCHASE BOOST',
      value: `+${pct}%`,
      detail: `Applies to your next Luckbox or ETH Ticket purchase; the affected Buy button shows the +${pct}% BOON badge`,
    };
  }
  if (type === 8) {
    const pct = _bpsPercent(amount);
    return {
      label: 'DECIMATOR BOON',
      value: pct == null ? 'BOOST' : `+${pct}%`,
      detail: pct == null
        ? 'Boosts the entry weight of your next Decimator FLIP burn'
        : `Adds +${pct}% entry weight to your next Decimator burn, calculated on up to 50K FLIP`,
    };
  }
  if (type === 9) {
    const pct = _bpsPercent(amount);
    return {
      label: 'WHALE PASS DISCOUNT',
      value: pct == null ? 'DISCOUNT' : `−${pct}%`,
      detail: pct == null
        ? 'Your next whale pass purchase costs less'
        : `Your next whale pass purchase costs ${pct}% less`,
    };
  }
  if (type === 10) {
    const raw = _rewardAmount(amount);
    if (raw > 0n && raw < 100n) {
      const wholeScore = raw / 2n;
      const score = raw % 2n === 0n ? `${wholeScore}` : `${wholeScore}.5`;
      return {
        label: 'DEGEN SCORE BOON',
        value: `+${score}`,
        detail: `Your next luckbox opening adds +${raw} quest streak, worth ${score} Degen Score`,
      };
    }
    const pct = _bpsPercent(raw);
    return {
      label: 'DEITY PASS DISCOUNT',
      value: pct == null ? 'DISCOUNT' : `−${pct}%`,
      detail: pct == null
        ? 'Your deity pass purchase costs less'
        : `Your deity pass purchase costs ${pct}% less`,
    };
  }
  if (type === 11) {
    const pct = _bpsPercent(amount);
    return {
      label: 'LAZY PASS DISCOUNT',
      value: pct == null ? 'DISCOUNT' : `−${pct}%`,
      detail: pct == null
        ? 'Your next lazy pass purchase costs less'
        : `Your next lazy pass purchase costs ${pct}% less`,
    };
  }
  if (type === 12) {
    const count = _rewardAmount(amount) || 1n;
    return {
      label: 'QUEST STREAK PROTECTION',
      value: `${count} MISSED DAY${count === 1n ? '' : 'S'}`,
      detail: `Forgives ${count === 1n ? 'one' : count} missed quest day${count === 1n ? '' : 's'} before your streak can reset`,
    };
  }
  return {
    label: rewardTypeLabel(type).toUpperCase(),
    value: '?',
    detail: 'Unrecognized on-chain reward type',
  };
}

const COINFLIP_BOON_BPS = Object.freeze({ 1: 500, 2: 1_000, 3: 2_500 });

/**
 * The deployed LootBoxReward(type=2) event identifies the coinflip-boon
 * category but emits its maximum FLIP value, not the selected 5/10/25% tier.
 * Read the post-settlement packed boon state (at the receipt block when known)
 * and attach the exact effective BPS to that reward leg before presentation.
 * A failed optional read leaves the honest non-numeric BOOST label in place.
 */
export async function enrichLootboxBoonLegs(legs, {
  player,
  blockNumber = null,
} = {}) {
  const rows = Array.isArray(legs) ? legs : [];
  if (!player || !rows.some((leg) => (
    leg?.legType === 'reward' && Number(leg?.rewardType) === 2
  ))) return rows;
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
  ).find((boon) => Number(boon?.boonType) >= 1 && Number(boon?.boonType) <= 3);
  const boonBps = COINFLIP_BOON_BPS[Number(active?.boonType)] || null;
  if (boonBps == null) return rows;
  return rows.map((leg) => (
    leg?.legType === 'reward' && Number(leg?.rewardType) === 2
      ? { ...leg, boonType: Number(active.boonType), boonBps }
      : leg
  ));
}

/**
 * Decode a BoxSpin packedSpins word into reels (indexer-parity).
 * @param {bigint} betId
 * @param {bigint} packed
 * @returns {{boxOrigin: boolean, spinType: string, spinCount: number,
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
  const typeCode = Number((id >> 60n) & 0x7n);
  const spinType = SPIN_TYPES[typeCode] ?? `unknown_${typeCode}`;
  const spinCount = Number((p >> COUNT_SHIFT) & 0xFFn);
  const survived = spinType === 'flip' ? ((p >> SURVIVED_SHIFT) & 1n) === 1n : null;
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
  return { boxOrigin, spinType, spinCount, survived, reels };
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
          ...decoded,
          payout: _feedBigInt(data.payout),
          ethShare: _feedBigInt(data.ethShare),
        });
      } else if (Array.isArray(data.reels)) {
        out.push({
          legType: 'spin',
          boxOrigin: true,
          spinType: String(data.spinType || ''),
          spinCount: Number(data.spinCount ?? data.reels.length),
          survived: data.survived == null ? null : Boolean(data.survived),
          payout: _feedBigInt(data.payout),
          ethShare: _feedBigInt(data.ethShare),
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
  const rows = Array.isArray(items) ? items : [];
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
          boxOrigin: true,
          spinType: String(spin.spinType || ''),
          spinCount: Number(spin.spinCount ?? spin.reels?.length ?? 0),
          survived: spin.survived == null ? null : Boolean(spin.survived),
          payout: _feedBigInt(spin.payout),
          ethShare: _feedBigInt(spin.ethShare),
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
 * that event, so match their player-filtered BoxSpin transaction by decoding
 * the original openBox(player,index) calldata instead.
 */
export async function readOpenLegsFromChain({
  player,
  lootboxIndex,
  purchaseTransactionHashes = [],
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
    } catch (_e) { /* another reader or the index feed may still recover it */ }
  }

  let topicSets;
  let spinTopics;
  try {
    topicSets = ['LootBoxOpened', 'PresaleBoxOpened'].map((name) => (
      _iface().encodeFilterTopics(_iface().getEvent(name), [player, index])
    ));
    spinTopics = _iface().encodeFilterTopics(_iface().getEvent('BoxSpin'), [player]);
  } catch (_e) {
    return [];
  }

  let inspectedSpinTransactions = 0;
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
    try {
      const groups = await Promise.all(topicSets.map((topics) => provider.getLogs({
          address: CONTRACTS.GAME,
          topics,
          fromBlock,
          toBlock,
        })));
      logs = groups.flat().sort((a, b) => (
        Number(a?.blockNumber ?? 0) - Number(b?.blockNumber ?? 0)
        || Number(a?.index ?? a?.logIndex ?? 0) - Number(b?.index ?? b?.logIndex ?? 0)
      ));
    } catch (_e) {
      return [];
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

    // BoxSpin omits the lootbox index, but the permissionless open call that
    // produced it does not. This is what lets the original owner recover the
    // reveal even when somebody else's wallet won the open race.
    if (typeof provider.getTransaction === 'function'
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
      for (const candidate of candidates) {
        if (inspectedSpinTransactions >= REPLAY_SPIN_TX_LIMIT) break;
        inspectedSpinTransactions += 1;
        if (!candidate?.transactionHash) continue;
        try {
          const tx = await provider.getTransaction(candidate.transactionHash);
          const to = String(tx?.to || '').toLowerCase();
          if (to && to !== String(CONTRACTS.GAME || '').toLowerCase()) continue;
          const data = tx?.data ?? tx?.input;
          if (!data) continue;
          const call = _openCallIface().parseTransaction({ data, value: tx?.value ?? 0 });
          if (!call || call.name !== 'openBox') continue;
          const callPlayer = String(call.args.player ?? call.args[0] ?? '').toLowerCase();
          const callIndex = BigInt(call.args.index ?? call.args[1] ?? -1);
          if (callPlayer !== String(player).toLowerCase() || callIndex !== index) continue;
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
