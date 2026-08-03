// /app/app/sdgnrs.js — player-facing sDGNRS redemption burn.
//
// During a live game `burn(amount)` submits a delayed, RNG-priced redemption;
// after GAMEOVER it pays the deterministic proportional backing directly. The
// contract burns msg.sender's soulbound balance, so this action intentionally
// cannot use the app's delegated/operator acting-address path.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { get } from './store.js';

const SDGNRS_ABI = [
  'function burn(uint256 amount) external returns (uint256 ethOut, uint256 stethOut, uint256 flipOut)',
  'function previewBurnValue(uint256 amount) external view returns (uint256 ethOut, uint256 flipOut)',
  'function pendingRedemptions(address player, uint24 periodIndex) external view returns (uint96 ethValueOwed, uint16 activityScore, uint96 flipEscrow)',
  'function redemptionPeriods(uint24 periodIndex) external view returns (uint16)',
  'function claimRedemption(address player, uint24 periodIndex) external',
  'event RedemptionSubmitted(address indexed player, uint256 sdgnrsAmount, uint256 ethValueOwed, uint256 flipEscrowed, uint24 periodIndex)',
  'event RedemptionClaimed(address indexed player, uint16 roll, uint256 ethPayout, uint256 lootboxEth, uint256 flipPaid)',
  'error Insufficient()',
  'error BurnTooSmall()',
  'error BurnsBlockedDuringRng()',
  'error BurnsBlockedBeforeDailyRng()',
  'error BurnsBlockedDuringLiveness()',
  'error PriorDayUnresolved()',
  'error ExceedsDailyRedemptionCap()',
  'error TransferFailed()',
  'error NotResolved()',
  'error NoClaim()',
  'error Unauthorized()',
];

export const MIN_SDGNRS_BURN_WEI = 10n ** 18n;
export const SDGNRS_REDEMPTION_SUBMITTED_EVENT = 'degenerus:sdgnrs-redemption-submitted';
export const SDGNRS_REDEMPTION_LOOKBACK_BLOCKS = 120_000;
const SDGNRS_LOG_CHUNK_BLOCKS = 5_000;

let _contractFactory = null;
let _ifaceCache = null;

/** Test-only contract-construction seam. */
export function __setContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
}

/** Test-only reset. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
  _ifaceCache = null;
}

function _iface() {
  if (!_ifaceCache) _ifaceCache = new ethers.Interface(SDGNRS_ABI);
  return _ifaceCache;
}

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.SDGNRS, SDGNRS_ABI, signerOrProvider);
}

function _burnError(error) {
  const name = error?.revert?.name || error?.errorName || null;
  const local = {
    Insufficient: {
      code: 'Insufficient',
      userMessage: 'Not enough sDGNRS for that burn.',
      recoveryAction: 'Lower the burn amount.',
    },
    BurnTooSmall: {
      code: 'BurnTooSmall',
      userMessage: 'Minimum burn is 1 sDGNRS.',
      recoveryAction: 'Enter at least 1 sDGNRS.',
    },
    BurnsBlockedDuringRng: {
      code: 'BurnsBlockedDuringRng',
      userMessage: 'sDGNRS burns reopen after RNG settles.',
      recoveryAction: 'Wait for the current RNG request.',
    },
    BurnsBlockedBeforeDailyRng: {
      code: 'BurnsBlockedBeforeDailyRng',
      userMessage: "Wait for today's draw before burning sDGNRS.",
      recoveryAction: 'Try again after the daily RNG lands.',
    },
    BurnsBlockedDuringLiveness: {
      code: 'BurnsBlockedDuringLiveness',
      userMessage: 'sDGNRS burns are paused during the game-over check.',
      recoveryAction: 'Wait for the game state to settle.',
    },
    PriorDayUnresolved: {
      code: 'PriorDayUnresolved',
      userMessage: 'The prior sDGNRS redemption round still needs resolution.',
      recoveryAction: 'Wait for the next game advance.',
    },
    ExceedsDailyRedemptionCap: {
      code: 'ExceedsDailyRedemptionCap',
      userMessage: "That burn exceeds today's redemption limit.",
      recoveryAction: 'Lower the amount or try again tomorrow.',
    },
  }[name];
  const decoded = local || decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || 'sDGNRS burn failed.');
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

function _claimError(error) {
  const name = error?.revert?.name || error?.errorName || null;
  const local = {
    NotResolved: {
      code: 'NotResolved',
      userMessage: 'This sDGNRS redemption is still waiting for RNG.',
      recoveryAction: 'Try again after the next daily result.',
    },
    NoClaim: {
      code: 'NoClaim',
      userMessage: 'This sDGNRS redemption was already claimed.',
      recoveryAction: 'Open its saved result instead.',
    },
    Unauthorized: {
      code: 'Unauthorized',
      userMessage: 'This wallet cannot claim that sDGNRS redemption.',
      recoveryAction: 'Switch to the wallet that submitted it.',
    },
  }[name];
  const decoded = local || decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || 'sDGNRS redemption claim failed.');
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

function _sameAddress(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

/** Decode sDGNRS submit/claim events from a transaction receipt. */
export function parseSdgnrsRedemptionReceipt(receipt, playerFilter = null) {
  const submissions = [];
  const claims = [];
  if (!receipt || !Array.isArray(receipt.logs)) return { submissions, claims };
  const want = playerFilter ? String(playerFilter).toLowerCase() : null;
  for (const log of receipt.logs) {
    try {
      if (CONTRACTS.SDGNRS
        && String(log?.address || '').toLowerCase() !== String(CONTRACTS.SDGNRS).toLowerCase()) continue;
      const parsed = _iface().parseLog(log);
      if (!parsed) continue;
      const player = String(parsed.args.player ?? parsed.args[0] ?? '').toLowerCase();
      if (want && player !== want) continue;
      if (parsed.name === 'RedemptionSubmitted') {
        submissions.push({
          player,
          sdgnrsAmount: BigInt(parsed.args.sdgnrsAmount),
          ethValueOwed: BigInt(parsed.args.ethValueOwed),
          flipEscrowed: BigInt(parsed.args.flipEscrowed),
          periodIndex: Number(parsed.args.periodIndex),
          transactionHash: String(receipt.hash || receipt.transactionHash || log.transactionHash || '').toLowerCase() || null,
        });
      } else if (parsed.name === 'RedemptionClaimed') {
        claims.push({
          player,
          roll: Number(parsed.args.roll),
          ethPayout: BigInt(parsed.args.ethPayout),
          lootboxEth: BigInt(parsed.args.lootboxEth),
          flipPaid: BigInt(parsed.args.flipPaid),
          transactionHash: String(receipt.hash || receipt.transactionHash || log.transactionHash || '').toLowerCase() || null,
        });
      }
    } catch (_e) {
      // Foreign/older event — ignore without losing the rest of the receipt.
    }
  }
  return { submissions, claims };
}

/** Read one exact redemption slot and its period roll. */
export async function readSdgnrsRedemptionState({ player, periodIndex } = {}) {
  if (!player || periodIndex == null) return null;
  const period = Number(periodIndex);
  if (!Number.isInteger(period) || period < 0 || period > 0xFFFFFF) return null;
  const provider = getProvider();
  if (!provider) return null;
  try {
    const contract = _buildContract(provider);
    const [pending, rollRaw] = await Promise.all([
      contract.pendingRedemptions(player, period),
      contract.redemptionPeriods(period),
    ]);
    const ethValueOwed = BigInt(pending?.ethValueOwed ?? pending?.[0] ?? 0);
    const activityScore = Number(pending?.activityScore ?? pending?.[1] ?? 0);
    const flipEscrow = BigInt(pending?.flipEscrow ?? pending?.[2] ?? 0);
    const roll = Number(rollRaw ?? 0);
    return {
      player: String(player).toLowerCase(),
      periodIndex: period,
      ethValueOwed,
      activityScore,
      flipEscrow,
      roll,
      exists: ethValueOwed > 0n || flipEscrow > 0n,
      ready: roll > 0 && (ethValueOwed > 0n || flipEscrow > 0n),
    };
  } catch (_e) {
    return null;
  }
}

async function _recentRedemptionLogs(provider, player) {
  if (!provider
    || typeof provider.getBlockNumber !== 'function'
    || typeof provider.getLogs !== 'function') return [];
  let head;
  try { head = Number(await provider.getBlockNumber()); }
  catch (_e) { return []; }
  if (!Number.isFinite(head) || head < 0) return [];
  const fromBlock = Math.max(Number(CHAIN.deployBlock) || 0, head - SDGNRS_REDEMPTION_LOOKBACK_BLOCKS);
  let topics;
  try {
    const submit = _iface().encodeFilterTopics(_iface().getEvent('RedemptionSubmitted'), [player]);
    const claimed = _iface().encodeFilterTopics(_iface().getEvent('RedemptionClaimed'), [player]);
    topics = [[submit[0], claimed[0]], submit[1]];
  } catch (_e) {
    return [];
  }
  const filter = { address: CONTRACTS.SDGNRS, topics };
  try {
    return await provider.getLogs({ ...filter, fromBlock, toBlock: head });
  } catch (_wideError) {
    const logs = [];
    for (let end = head; end >= fromBlock; end -= SDGNRS_LOG_CHUNK_BLOCKS) {
      const start = Math.max(fromBlock, end - SDGNRS_LOG_CHUNK_BLOCKS + 1);
      try {
        const chunk = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
        if (Array.isArray(chunk)) logs.push(...chunk);
      } catch (_chunkError) {
        // Keep other chunks useful; a later poll can retry the missing range.
      }
    }
    return logs;
  }
}

/**
 * Discover recent submissions and already-claimed receipts for one player.
 * Exact pending/ready state is always re-read from the contract; logs only
 * identify which composite-keyed periods belong to the player.
 */
export async function discoverSdgnrsRedemptions({ player } = {}) {
  if (!player) return { periods: [], claims: [] };
  const provider = getProvider();
  if (!provider) return { periods: [], claims: [] };
  const logs = await _recentRedemptionLogs(provider, player);
  const periods = new Set();
  const claims = [];
  for (const log of Array.isArray(logs) ? logs : []) {
    try {
      const parsed = _iface().parseLog(log);
      if (!parsed) continue;
      const owner = String(parsed.args.player ?? parsed.args[0] ?? '').toLowerCase();
      if (!_sameAddress(owner, player)) continue;
      if (parsed.name === 'RedemptionSubmitted') {
        periods.add(Number(parsed.args.periodIndex));
      } else if (parsed.name === 'RedemptionClaimed') {
        claims.push({
          player: owner,
          roll: Number(parsed.args.roll),
          ethPayout: BigInt(parsed.args.ethPayout),
          lootboxEth: BigInt(parsed.args.lootboxEth),
          flipPaid: BigInt(parsed.args.flipPaid),
          transactionHash: String(log.transactionHash || '').toLowerCase(),
          blockNumber: Number(log.blockNumber ?? 0),
          logIndex: Number(log.index ?? log.logIndex ?? 0),
        });
      }
    } catch (_e) { /* unknown log */ }
  }
  const states = await Promise.all([...periods].map((periodIndex) => (
    readSdgnrsRedemptionState({ player, periodIndex })
  )));
  return {
    periods: states.filter((state) => state?.exists),
    claims: claims.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex),
  };
}

/**
 * Read the current proportional backing for an sDGNRS burn.
 *
 * During the live game `ethOut` is also the statistical expected ETH/stETH
 * value: the delayed redemption roll spans 25%–175% around a 100% mean.
 * `flipOut` is contingent backing and pays only when the resolving coinflip
 * wins, so callers should not fold it into the ETH expectation.
 *
 * @param {{amount: bigint|string|number}} args
 * @returns {Promise<{ethOut: bigint, flipOut: bigint}|null>}
 */
export async function previewSdgnrsBurn({ amount } = {}) {
  let amountWei;
  try { amountWei = BigInt(amount); }
  catch (_e) { return null; }
  if (amountWei <= 0n) return null;

  const provider = getProvider();
  if (!provider) return null;
  const result = await _buildContract(provider).previewBurnValue(amountWei);
  return {
    ethOut: BigInt(result?.ethOut ?? result?.[0] ?? 0),
    flipOut: BigInt(result?.flipOut ?? result?.[1] ?? 0),
  };
}

/**
 * Burn the connected signer's own sDGNRS balance.
 *
 * @param {{amount: bigint|string|number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt, amount: bigint}>}
 */
export async function burnSdgnrs({ amount } = {}) {
  const connected = get('connected.address');
  if (!connected) throw new Error('Connect a wallet first.');
  const viewed = get('viewing.address');
  if (viewed && String(viewed).toLowerCase() !== String(connected).toLowerCase()) {
    throw new Error("sDGNRS burns must be signed from the token owner's view.");
  }

  let amountWei;
  try { amountWei = BigInt(amount); }
  catch (_e) { throw new Error('Enter a valid sDGNRS amount.'); }
  if (amountWei < MIN_SDGNRS_BURN_WEI) {
    throw new Error('Minimum burn is 1 sDGNRS.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(_buildContract(signer), 'burn', [amountWei], signer);
    if (!sim.ok) throw _burnError(sim.error);
  }

  try {
    const receipt = await sendTx(
      (freshSigner) => _buildContract(freshSigner).burn(amountWei),
      'Burn sDGNRS',
    );
    const { submissions } = parseSdgnrsRedemptionReceipt(receipt, connected);
    return { receipt, amount: amountWei, submissions };
  } catch (error) {
    if (error?.revert?.name || error?.errorName) throw _burnError(error);
    throw error;
  }
}

/**
 * Settle one resolved sDGNRS redemption. During a live game this permissionless
 * call creates and resolves its lootbox leg in the same receipt; at game-over
 * the contract uses its direct-payment branch instead.
 */
export async function claimSdgnrsRedemption({ player, periodIndex } = {}) {
  const owner = String(player || '').toLowerCase();
  const period = Number(periodIndex);
  if (!owner) throw new Error('Missing sDGNRS redemption owner.');
  if (!Number.isInteger(period) || period < 0 || period > 0xFFFFFF) {
    throw new Error('Invalid sDGNRS redemption period.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(
      _buildContract(signer),
      'claimRedemption',
      [owner, period],
      signer,
    );
    if (!sim.ok) throw _claimError(sim.error);
  }

  try {
    const receipt = await sendTx(
      (freshSigner) => _buildContract(freshSigner).claimRedemption(owner, period),
      'Claim sDGNRS redemption',
    );
    const { claims } = parseSdgnrsRedemptionReceipt(receipt, owner);
    return { receipt, player: owner, periodIndex: period, claim: claims.at(-1) || null };
  } catch (error) {
    if (error?.revert?.name || error?.errorName) throw _claimError(error);
    throw error;
  }
}
