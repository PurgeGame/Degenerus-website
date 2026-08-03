// /app/app/decimator.js — purchase helpers plus the live Decimator entry path.
//
// Ticket purchases still share DegenerusGame.purchase() with lootboxes, so
// those helpers remain direct re-exports. A Decimator entry is different: the
// player burns FLIP.decimatorBurn(player, amount) during the indexed window.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { getActingAddress } from './store.js';

export { purchaseEth, scaledTicketPriceWei } from './lootbox.js';

const DECIMATOR_ABI = [
  'function decimatorBurn(address player, uint256 amount) external',
  'event DecimatorBurn(address indexed player, uint256 amountBurned, uint8 bucket)',
  'error AmountLTMin()',
  'error NotDecimatorWindow()',
  'error NotApproved()',
  'error Insufficient()',
];

const DECIMATOR_CONTEXT_ABI = [
  'function playerActivityScore(address player) external view returns (uint256 scorePoints)',
  'function purchaseInfo() external view returns (uint24 lvl, bool inJackpotPhase, bool lastPurchaseDay_, bool rngLocked_, uint256 priceWei)',
  'function futurePrizePoolView() external view returns (uint256)',
];

const DECIMATOR_SCORE_EVENT_ABI = [
  'event DecBurnRecorded(address indexed player, uint24 indexed lvl, uint8 bucket, uint8 subBucket, uint256 effectiveAmount, uint256 newTotalBurn)',
];

// DegenerusGameStorage slot 0 is deliberately full. `decDayOneActive` occupies
// its final byte ([31:32]), so bit 248 is the exact live +20% latch used by
// recordDecBurn. There is no public getter for that one flag on this deploy.
const DECIMATOR_DAY_ONE_SHIFT = 248n;
const BPS_DENOMINATOR = 10_000n;
const DECIMATOR_NORMAL_POOL_BPS = 1_000n;
const DECIMATOR_CENTURY_POOL_BPS = 3_000n;
// Current DegenerusGame storage layout: decBurn is the nested mapping at slot
// 40 and DecBet.burn is its low uint192. Like the slot-0 flag read above, this
// is a deploy-specific exact read used because GAME exposes no DecBet getter.
const DECIMATOR_BURN_ROOT_SLOT = 40n;
const UINT192_MASK = (1n << 192n) - 1n;
const DECIMATOR_LOG_CHUNK_BLOCKS = 1_800;
const DECIMATOR_MULTIPLIER_CAP = 200_000n * 10n ** 18n;
const DECIMATOR_BOON_CAP = 50_000n * 10n ** 18n;

/** FLIP.sol DECIMATOR_MIN — FLIP is an unscaled 18-decimal token. */
export const DECIMATOR_MIN_FLIP_WEI = 1_000n * 10n ** 18n;

let _contractFactory = null;
let _contextReaderForTest = null;
let _readProvider = null;
const _roundScoreCache = new Map();

/** Test-only contract-construction seam. */
export function __setContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
}

/** Test-only live-context seam (score + timing flags). */
export function __setDecimatorContextReaderForTest(reader) {
  _contextReaderForTest = typeof reader === 'function' ? reader : null;
}

/** Test-only reset. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
  _contextReaderForTest = null;
  _readProvider = null;
  _roundScoreCache.clear();
}

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.COIN, DECIMATOR_ABI, signerOrProvider);
}

function _contextProvider() {
  const wallet = getProvider();
  if (wallet) return wallet;
  if (!_readProvider) {
    _readProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 1 },
    );
  }
  return _readProvider;
}

async function _storageAt(provider, slot) {
  const position = typeof slot === 'string' && slot.startsWith('0x')
    ? slot
    : `0x${BigInt(slot).toString(16)}`;
  if (typeof provider?.getStorage === 'function') {
    return provider.getStorage(CONTRACTS.GAME, position);
  }
  if (typeof provider?.send === 'function') {
    return provider.send('eth_getStorageAt', [CONTRACTS.GAME, position, 'latest']);
  }
  throw new Error('Storage reads unavailable.');
}

async function _storageSlotZero(provider) {
  return _storageAt(provider, 0);
}

export function decimatorBurnStorageSlot(player, level) {
  const lvl = Number(level);
  if (!player || !Number.isInteger(lvl) || lvl < 1 || lvl > 0xFFFFFF) return null;
  try {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const levelSlot = ethers.keccak256(coder.encode(
      ['uint24', 'uint256'],
      [lvl, DECIMATOR_BURN_ROOT_SLOT],
    ));
    return ethers.keccak256(coder.encode(['address', 'bytes32'], [player, levelSlot]));
  } catch (_e) {
    return null;
  }
}

export function decimatorDayOneActive(storageSlotZero) {
  try {
    return ((BigInt(storageSlotZero) >> DECIMATOR_DAY_ONE_SHIFT) & 1n) === 1n;
  } catch (_e) {
    return null;
  }
}

/**
 * Exact ActivityCurveLib.decMultBps port (whole-point activity score in,
 * basis-points multiplier out). Integer division intentionally mirrors Solidity.
 */
export function decimatorActivityMultiplierBps(score) {
  let points;
  try { points = BigInt(score ?? 0); } catch (_e) { points = 0n; }
  if (points <= 0n) return 10_000n;
  if (points <= 235n) return 10_000n + (points * 7_049n) / 235n;
  if (points <= 500n) return 17_049n + ((points - 235n) * 627n) / 265n;
  if (points >= 30_000n) return 17_833n;
  return 17_676n + ((points - 500n) * 157n) / 29_500n;
}

/** Activity plus the two live timing adjustments, with Solidity's floor order. */
export function decimatorCurrentMultiplierBps({
  activityScore = 0,
  dayOneActive = false,
  lastPurchaseDay = false,
} = {}) {
  let multiplier = decimatorActivityMultiplierBps(activityScore);
  if (dayOneActive) multiplier = (multiplier * 12_000n) / BPS_DENOMINATOR;
  if (lastPurchaseDay) multiplier = (multiplier * 9_000n) / BPS_DENOMINATOR;
  return multiplier;
}

/**
 * Exact score added by a burn, including the 50k boon base cap and the 200k
 * multiplied-score cap. The quest-completion credit is intentionally absent:
 * it is only known after DegenerusQuests handles the transaction on-chain.
 */
export function decimatorEntryScoreWei({
  amountWei = 0n,
  previousScoreWei = 0n,
  activityScore = 0,
  dayOneActive = false,
  lastPurchaseDay = false,
  boonBps = 0,
} = {}) {
  let amount;
  let previous;
  let boon;
  try {
    amount = BigInt(amountWei);
    previous = BigInt(previousScoreWei);
    boon = BigInt(boonBps);
  } catch (_e) {
    return 0n;
  }
  if (amount <= 0n) return 0n;
  if (previous < 0n) previous = 0n;
  if (boon < 0n) boon = 0n;

  const boonBase = amount > DECIMATOR_BOON_CAP ? DECIMATOR_BOON_CAP : amount;
  const baseAmount = amount + (boonBase * boon) / BPS_DENOMINATOR;
  const multiplier = decimatorCurrentMultiplierBps({
    activityScore,
    dayOneActive,
    lastPurchaseDay,
  });
  if (multiplier <= BPS_DENOMINATOR || previous >= DECIMATOR_MULTIPLIER_CAP) {
    return baseAmount;
  }

  const remaining = DECIMATOR_MULTIPLIER_CAP - previous;
  const fullEffective = (baseAmount * multiplier) / BPS_DENOMINATOR;
  if (fullEffective <= remaining) return fullEffective;

  const maxMultBase = (remaining * BPS_DENOMINATOR) / multiplier;
  const multiplied = (maxMultBase * multiplier) / BPS_DENOMINATOR;
  return multiplied + (baseAmount - maxMultBase);
}

/** The open x00 Decimator is 30%; every ordinary x5 Decimator is 10%. */
export function decimatorPoolBps(level) {
  const lvl = Number(level);
  return Number.isInteger(lvl) && lvl > 0 && lvl % 100 === 0
    ? DECIMATOR_CENTURY_POOL_BPS
    : DECIMATOR_NORMAL_POOL_BPS;
}

export function decimatorPoolWei(futurePoolWei, level) {
  let future;
  try { future = BigInt(futurePoolWei ?? 0); } catch (_e) { return 0n; }
  if (future <= 0n) return 0n;
  return (future * decimatorPoolBps(level)) / BPS_DENOMINATOR;
}

function _decimatorScoreInterface() {
  return new ethers.Interface(DECIMATOR_SCORE_EVENT_ABI);
}

function _applyDecimatorScoreLogs(players, logs) {
  const iface = _decimatorScoreInterface();
  const ordered = Array.from(logs || []).sort((a, b) => (
    Number(a?.blockNumber || 0) - Number(b?.blockNumber || 0)
    || Number(a?.index ?? a?.logIndex ?? 0) - Number(b?.index ?? b?.logIndex ?? 0)
  ));
  for (const log of ordered) {
    try {
      const args = iface.parseLog(log)?.args;
      const player = String(args?.player || '').toLowerCase();
      if (player) players.set(player, BigInt(args?.newTotalBurn ?? 0));
    } catch (_e) { /* an unrelated or malformed log contributes nothing */ }
  }
}

/**
 * Sum every player's latest cumulative score for one open Decimator round.
 * DecBurnRecorded is emitted by GAME and indexed by level. The 1,800-block
 * chunks stay below Base's public 2,000-block eth_getLogs limit; subsequent
 * hot polls read only new blocks.
 */
async function _readDecimatorRoundScore(provider, level) {
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < 1 || typeof provider?.getLogs !== 'function') return null;
  const cached = _roundScoreCache.get(lvl);
  const state = cached?.provider === provider
    ? cached
    : {
        provider,
        players: new Map(),
        nextBlock: Math.max(0, Number(CHAIN.deployBlock) || 0),
        total: 0n,
        pending: null,
      };
  if (!cached || cached.provider !== provider) _roundScoreCache.set(lvl, state);
  if (state.pending) return state.pending;

  state.pending = (async () => {
    const head = Number(await provider.getBlockNumber());
    if (!Number.isInteger(head) || head < 0) return state.total;
    if (head < state.nextBlock) {
      state.players.clear();
      state.nextBlock = Math.max(0, Number(CHAIN.deployBlock) || 0);
    }

    const iface = _decimatorScoreInterface();
    const event = iface.getEvent('DecBurnRecorded');
    const filter = {
      address: CONTRACTS.GAME,
      topics: [
        event.topicHash,
        null,
        ethers.zeroPadValue(ethers.toBeHex(lvl), 32),
      ],
    };
    for (let from = state.nextBlock; from <= head; from += DECIMATOR_LOG_CHUNK_BLOCKS) {
      const to = Math.min(head, from + DECIMATOR_LOG_CHUNK_BLOCKS - 1);
      const logs = await provider.getLogs({ ...filter, fromBlock: from, toBlock: to });
      _applyDecimatorScoreLogs(state.players, logs);
    }
    state.nextBlock = head + 1;
    state.total = Array.from(state.players.values()).reduce((sum, value) => sum + value, 0n);
    return state.total;
  })();

  try {
    return await state.pending;
  } finally {
    state.pending = null;
  }
}

async function _readIndexedDecimatorRoundScore(level) {
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < 1) return null;
  try {
    // Keep the beta API module lazy here. It installs browser listeners at
    // module evaluation time, while this helper is also imported by the
    // side-effect-free Node unit tests.
    const { fetchJSON } = await import('../../beta/app/api.js');
    const payload = await fetchJSON(`/game/decimator/${lvl}`);
    const total = BigInt(payload?.totalScore ?? 0);
    return total >= 0n ? total : null;
  } catch (_e) {
    // Rolling deploy compatibility: older API workers do not have this route.
    return null;
  }
}

async function _readFastDecimatorRoundScore(provider, level) {
  const indexed = await _readIndexedDecimatorRoundScore(level);
  return indexed == null ? _readDecimatorRoundScore(provider, level) : indexed;
}

/**
 * Read the exact score and timing modifiers consumed by a burn right now.
 * Each leg soft-fails independently so a provider without raw-storage support
 * can still show the score or last-day state.
 */
export async function readDecimatorContext(player, targetLevel = null) {
  if (_contextReaderForTest) return _contextReaderForTest(player, targetLevel);

  const provider = _contextProvider();
  const game = new ethers.Contract(CONTRACTS.GAME, DECIMATOR_CONTEXT_ABI, provider);
  const burnSlot = player ? decimatorBurnStorageSlot(player, targetLevel) : null;
  const [scoreRead, purchaseRead, slotRead, futureRead, burnRead, roundScoreRead] = await Promise.allSettled([
    player ? game.playerActivityScore(player) : Promise.resolve(null),
    game.purchaseInfo(),
    _storageSlotZero(provider),
    game.futurePrizePoolView(),
    burnSlot == null ? Promise.resolve(null) : _storageAt(provider, burnSlot),
    _readFastDecimatorRoundScore(provider, targetLevel),
  ]);

  let activityScore = null;
  if (scoreRead.status === 'fulfilled') {
    try {
      const parsed = BigInt(scoreRead.value);
      if (parsed >= 0n && parsed <= BigInt(Number.MAX_SAFE_INTEGER)) activityScore = Number(parsed);
    } catch (_e) { /* malformed read stays unknown */ }
  }

  let lastPurchaseDay = null;
  if (purchaseRead.status === 'fulfilled') {
    lastPurchaseDay = Boolean(purchaseRead.value?.lastPurchaseDay_ ?? purchaseRead.value?.[2]);
  }

  let dayOneActive = null;
  if (slotRead.status === 'fulfilled') {
    dayOneActive = decimatorDayOneActive(slotRead.value);
  }

  let futurePoolWei = null;
  if (futureRead.status === 'fulfilled') {
    try { futurePoolWei = BigInt(futureRead.value); } catch (_e) { /* unknown */ }
  }

  let totalBurnWeight = null;
  if (burnRead.status === 'fulfilled' && burnRead.value != null) {
    try { totalBurnWeight = BigInt(burnRead.value) & UINT192_MASK; } catch (_e) { /* unknown */ }
  }

  let totalRoundScore = null;
  if (roundScoreRead.status === 'fulfilled' && roundScoreRead.value != null) {
    try { totalRoundScore = BigInt(roundScoreRead.value); } catch (_e) { /* unknown */ }
  }

  return {
    activityScore,
    dayOneActive,
    lastPurchaseDay,
    futurePoolWei,
    totalBurnWeight,
    totalRoundScore,
  };
}

function _decimatorError(error, context) {
  // AmountLTMin is shared with the 100-FLIP coinflip minimum, so registering a
  // global message here would make whichever module imported last lie. Keep
  // the shared selector's Decimator-specific copy local to this write path.
  const name = error?.revert?.name || error?.errorName || null;
  const local = {
    AmountLTMin: {
      code: 'AmountLTMin',
      userMessage: 'Minimum Decimator entry is 1,000 FLIP.',
      recoveryAction: 'Enter at least 1,000 FLIP.',
    },
    NotDecimatorWindow: {
      code: 'NotDecimatorWindow',
      userMessage: 'The Decimator entry window is closed.',
      recoveryAction: 'Wait for the next Decimator window.',
    },
    Insufficient: {
      code: 'Insufficient',
      userMessage: 'Not enough wallet or claimable FLIP for that Decimator entry.',
      recoveryAction: 'Lower the entry size or add more FLIP.',
    },
  }[name];
  const decoded = local || decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || `Failed: ${context}`);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

/**
 * Burn FLIP into the currently open Decimator round.
 *
 * FLIP.decimatorBurn consumes liquid FLIP first and can consume the player's
 * coinflip claimable shortfall on-chain, so the UI does not need a claim-first
 * transaction here.
 *
 * @param {{amount: bigint|string|number, player?: string}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt, amount: bigint}>}
 */
export async function burnForDecimator({ amount, player } = {}) {
  const target = player || getActingAddress();
  if (!target) throw new Error('Connect a wallet first.');

  let amountWei;
  try {
    amountWei = BigInt(amount);
  } catch (_e) {
    throw new Error('Decimator size must be a numeric FLIP amount.');
  }
  if (amountWei < DECIMATOR_MIN_FLIP_WEI) {
    throw new Error('Minimum Decimator entry is 1,000 FLIP.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(
      _buildContract(signer),
      'decimatorBurn',
      [target, amountWei],
      signer,
    );
    if (!sim.ok) throw _decimatorError(sim.error, 'static-call decimatorBurn');
  }

  try {
    const receipt = await sendTx(
      (freshSigner) => _buildContract(freshSigner).decimatorBurn(target, amountWei),
      'Enter Decimator',
    );
    return { receipt, amount: amountWei };
  } catch (error) {
    // Preserve wallet/network errors. Contract errors carry a parsed custom
    // error name because the ABI above includes every Decimator failure.
    if (error?.revert?.name || error?.errorName) {
      throw _decimatorError(error, 'decimatorBurn');
    }
    throw error;
  }
}
