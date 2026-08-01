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
import { CONTRACTS } from './chain-config.js';
import { dgnUnpackTicket } from './dgn-traits.js';

// Minimal open-receipt event ABI — parse-only (no writes here; openLootBox
// lives in lootbox.js).
export const OPEN_EVENTS_ABI = [
  'event LootBoxOpened(address indexed player, uint48 indexed lootboxIndex, uint256 amount, uint24 futureLevel, uint32 futureTickets, uint256 flip, bool roundedUp)',
  'event LootBoxDgnrsReward(address indexed player, uint256 lootboxAmount, uint256 dgnrsAmount)',
  'event LootBoxWhalePassJackpot(address indexed player, uint256 lootboxAmount, uint24 targetLevel, uint32 entriesPerLevel, uint24 statsBoost, uint24 frozenUntilLevel)',
  'event LootBoxReward(address indexed player, uint8 indexed rewardType, uint256 lootboxAmount, uint256 amount)',
  'event BoxSpin(address indexed player, uint64 betId, uint256 packedSpins, uint256 payout, uint256 ethShare)',
];

const SPIN_TYPES = ['wwxrp', 'flip', 'eth'];
const SPIN_STRIDE = 72n;
const COUNT_SHIFT = 216n;
const SURVIVED_SHIFT = 224n;
const U32 = 0xFFFFFFFFn;

// LootBoxReward rewardType → display label (contract NatSpec, LootboxModule:131).
export const REWARD_TYPE_LABELS = Object.freeze({
  2: 'Coinflip boon',
  4: '+5% boost',
  5: '+15% boost',
  6: '+25% boost',
  8: 'Decimator boost',
  9: 'Whale boon',
  10: 'Activity boon',
  11: 'Lazy pass',
});

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
function _iface() {
  if (!_ifaceCache) _ifaceCache = new ethers.Interface(OPEN_EVENTS_ABI);
  return _ifaceCache;
}

/** Test-only — drop the cached Interface (harmless in production). */
export function __resetForTest() { _ifaceCache = null; }

/**
 * Parse an openBox receipt into normalized prize legs, in log order.
 * Only logs emitted by the GAME contract are considered (delegatecalled
 * modules emit from the GAME address).
 *
 * @param {import('ethers').TransactionReceipt|null|undefined} receipt
 * @param {string} [playerFilter] lowercase address — keep only this player's legs
 * @returns {Array<object>} legs:
 *   {legType:'opened',    lootboxIndex, amount, futureLevel, wholeTickets, flip}
 *   {legType:'dgnrs',     amount}
 *   {legType:'whalepass', targetLevel, entriesPerLevel}
 *   {legType:'reward',    rewardType, label, amount}
 *   {legType:'spin',      spinType, spinCount, survived, payout, ethShare, reels}
 */
export function parseOpenLegsFromReceipt(receipt, playerFilter) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  const iface = _iface();
  const gameAddr = String(CONTRACTS.GAME || '').toLowerCase();
  const want = playerFilter ? String(playerFilter).toLowerCase() : null;
  for (const log of receipt.logs) {
    try {
      if (gameAddr && String(log.address || '').toLowerCase() !== gameAddr) continue;
      const parsed = iface.parseLog(log);
      if (!parsed) continue;
      const player = String(parsed.args.player ?? parsed.args[0] ?? '').toLowerCase();
      if (want && player !== want) continue;
      switch (parsed.name) {
        case 'LootBoxOpened': {
          const futureTickets = Number(parsed.args.futureTickets);
          const roundedUp = Boolean(parsed.args.roundedUp);
          out.push({
            legType: 'opened',
            lootboxIndex: BigInt(parsed.args.lootboxIndex),
            amount: BigInt(parsed.args.amount),
            futureLevel: Number(parsed.args.futureLevel),
            wholeTickets: wholeTicketsFromOpened(futureTickets, roundedUp),
            flip: BigInt(parsed.args.flip),
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
            label: REWARD_TYPE_LABELS[rewardType] || 'Bonus reward',
            amount: BigInt(parsed.args.amount),
          });
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
 * Turn the indexer's historical `/lootbox/legs` rows back into the same
 * normalized legs produced from a live openBox receipt.
 *
 * The exact-index settlement event is used only as a transaction anchor; every
 * same-player leg in that transaction is then included, which preserves split
 * boxes, boons, passes, and BoxSpin reels in their original log order. A
 * spin-only resolution has no index in the BoxSpin event, so it cannot be
 * attributed safely from that feed and deliberately returns [] rather than
 * replaying somebody else's result.
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
      && ['opened', 'presale', 'flipOpened'].includes(String(item?.legType || '')))
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
          lootboxIndex: BigInt(item.lootboxIndex),
          amount: _feedBigInt(data.amount ?? item.boxAmountRawWei),
          futureLevel: Number(data.futureLevel ?? item.levelAtOpen ?? 0),
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
          lootboxIndex: BigInt(item.lootboxIndex ?? 0),
          amount: _feedBigInt(data.flipAmount),
          futureLevel: Number(data.ticketLevel ?? data.futureLevel ?? item.levelAtOpen ?? 0),
          wholeTickets: wholeTicketsFromOpened(futureTickets, roundedUp),
          flip: _feedBigInt(data.flipReward ?? data.flip),
        });
        break;
      }
      case 'presale': {
        out.push({
          legType: 'opened',
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
          label: REWARD_TYPE_LABELS[rewardType] || 'Bonus reward',
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

/**
 * Recover a resolved box receipt straight from its indexed LootBoxOpened event.
 * This covers the indexer-lag window after another wallet opens the box. Some
 * spin-only outcomes emit no index-bearing leg; those correctly return [] so
 * the caller can use its honest generic settled presentation.
 */
export async function readOpenLegsFromChain({ player, lootboxIndex } = {}) {
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

  let topics;
  try {
    topics = _iface().encodeFilterTopics(_iface().getEvent('LootBoxOpened'), [player, index]);
  } catch (_e) {
    return [];
  }

  for (let i = 0; i < REPLAY_LOG_CHUNK_LIMIT; i += 1) {
    const toBlock = head - i * REPLAY_LOG_CHUNK_BLOCKS;
    if (toBlock < 0) break;
    const fromBlock = Math.max(0, toBlock - REPLAY_LOG_CHUNK_BLOCKS + 1);
    let logs;
    try {
      logs = await provider.getLogs({
        address: CONTRACTS.GAME,
        topics,
        fromBlock,
        toBlock,
      });
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
    if (fromBlock === 0) break;
  }
  return [];
}
