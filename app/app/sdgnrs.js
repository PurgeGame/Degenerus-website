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
import { permissionlessReadProvider, readProviderBlockNumber } from './read-provider.js';

const SDGNRS_ABI = [
  'function burn(uint256 amount) external returns (uint256 ethOut, uint256 stethOut, uint256 flipOut)',
  'function burnWrapped(uint256 amount) external returns (uint256 ethOut, uint256 stethOut, uint256 flipOut)',
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
export const MIN_DGNRS_BURN_WEI = MIN_SDGNRS_BURN_WEI;
export const SDGNRS_REDEMPTION_SUBMITTED_EVENT = 'degenerus:sdgnrs-redemption-submitted';
export const SDGNRS_BURN_DIALOG_REQUEST_EVENT = 'degenerus:open-sdgnrs-burn';
export const SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT = 'degenerus:open-sdgnrs-charity-vote';
export const SDGNRS_REDEMPTION_LOOKBACK_BLOCKS = 120_000;
const SDGNRS_LOG_CHUNK_BLOCKS = 5_000;
const SDGNRS_REORG_OVERLAP_BLOCKS = 12;

/** Compact a burned sDGNRS amount to at most two significant figures. */
export function formatSdgnrsRedemptionAmount(value) {
  let raw;
  try { raw = BigInt(value ?? 0); } catch (_e) { return '—'; }
  if (raw < 0n) raw = -raw;
  if (raw === 0n) return '0';
  const token = 10n ** 18n;
  if (raw < 10n * token) {
    const tenths = ((raw * 10n) + (token / 2n)) / token;
    return tenths % 10n === 0n
      ? String(tenths / 10n)
      : `${tenths / 10n}.${tenths % 10n}`;
  }
  let whole = (raw + (token / 2n)) / token;
  const digits = whole.toString().length;
  const quantum = digits > 2 ? 10n ** BigInt(digits - 2) : 1n;
  if (quantum > 1n) whole = ((whole + (quantum / 2n)) / quantum) * quantum;
  const units = [
    [10n ** 15n, 'Q'], [10n ** 12n, 'T'], [10n ** 9n, 'B'],
    [10n ** 6n, 'M'], [10n ** 3n, 'K'],
  ];
  const unit = units.find(([threshold]) => whole >= threshold);
  if (!unit) return whole.toLocaleString('en-US');
  const [divisor, suffix] = unit;
  const tenths = (whole * 10n) / divisor;
  return tenths < 100n && tenths % 10n !== 0n
    ? `${tenths / 10n}.${tenths % 10n}${suffix}`
    : `${whole / divisor}${suffix}`;
}

let _contractFactory = null;
let _ifaceCache = null;
const _redemptionLogStates = new Map();
const _redemptionStateInflight = new Map();

/** Test-only contract-construction seam. */
export function __setContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
}

/** Test-only reset. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
  _ifaceCache = null;
  _redemptionLogStates.clear();
  _redemptionStateInflight.clear();
}

function _readProvider() {
  return permissionlessReadProvider(getProvider());
}

function _iface() {
  if (!_ifaceCache) _ifaceCache = new ethers.Interface(SDGNRS_ABI);
  return _ifaceCache;
}

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.SDGNRS, SDGNRS_ABI, signerOrProvider);
}

function _burnError(error, asset = 'sDGNRS') {
  const name = error?.revert?.name || error?.errorName || null;
  const local = {
    Insufficient: {
      code: 'Insufficient',
      userMessage: `Not enough ${asset} for that burn.`,
      recoveryAction: 'Lower the burn amount.',
    },
    BurnTooSmall: {
      code: 'BurnTooSmall',
      userMessage: `Minimum burn is 1 ${asset}.`,
      recoveryAction: `Enter at least 1 ${asset}.`,
    },
    BurnsBlockedDuringRng: {
      code: 'BurnsBlockedDuringRng',
      userMessage: `${asset} burns reopen after RNG settles.`,
      recoveryAction: 'Wait for the current RNG request.',
    },
    BurnsBlockedBeforeDailyRng: {
      code: 'BurnsBlockedBeforeDailyRng',
      userMessage: `Wait for today's draw before burning ${asset}.`,
      recoveryAction: 'Try again after the daily RNG lands.',
    },
    BurnsBlockedDuringLiveness: {
      code: 'BurnsBlockedDuringLiveness',
      userMessage: `${asset} burns are paused during the game-over check.`,
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
  const wrapped = new Error(decoded.userMessage || `${asset} burn failed.`);
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
export async function readSdgnrsRedemptionState({ player, periodIndex, fresh = false } = {}) {
  if (!player || periodIndex == null) return null;
  const period = Number(periodIndex);
  if (!Number.isInteger(period) || period < 0 || period > 0xFFFFFF) return null;
  const provider = _readProvider();
  if (!provider) return null;
  const key = `${String(player).toLowerCase()}:${period}:${fresh ? 'fresh' : 'display'}`;
  if (_redemptionStateInflight.has(key)) return _redemptionStateInflight.get(key);
  const request = (async () => {
    try {
      const contract = _buildContract(provider);
      let blockTag = null;
      try {
        blockTag = await readProviderBlockNumber(provider, { maxAgeMs: fresh ? 0 : 500 });
      } catch (_e) { /* latest remains usable */ }
      const overrides = blockTag == null ? [] : [{ blockTag }];
      const [pending, rollRaw] = await Promise.all([
        contract.pendingRedemptions(player, period, ...overrides),
        contract.redemptionPeriods(period, ...overrides),
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
  })().finally(() => {
    if (_redemptionStateInflight.get(key) === request) _redemptionStateInflight.delete(key);
  });
  _redemptionStateInflight.set(key, request);
  return request;
}

function _redemptionLogKey(log) {
  const transactionHash = String(log?.transactionHash || '').toLowerCase();
  const blockNumber = Number(log?.blockNumber ?? 0);
  const logIndex = Number(log?.index ?? log?.logIndex ?? 0);
  return `${transactionHash || `block:${blockNumber}`}:${logIndex}`;
}

async function _fetchRedemptionLogRange(provider, filter, fromBlock, toBlock) {
  if (fromBlock > toBlock) return { logs: [], completeThrough: toBlock };
  try {
    const logs = await provider.getLogs({ ...filter, fromBlock, toBlock });
    return { logs: Array.isArray(logs) ? logs : [], completeThrough: toBlock };
  } catch (_wideError) {
    const logs = [];
    let completeThrough = fromBlock - 1;
    // Walk forward and stop on the first missing range. Advancing across a
    // failed middle chunk would make that gap permanent on the next poll.
    for (let start = fromBlock; start <= toBlock; start += SDGNRS_LOG_CHUNK_BLOCKS) {
      const end = Math.min(toBlock, start + SDGNRS_LOG_CHUNK_BLOCKS - 1);
      try {
        const chunk = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
        if (Array.isArray(chunk)) logs.push(...chunk);
        completeThrough = end;
      } catch (_chunkError) {
        break;
      }
    }
    return { logs, completeThrough };
  }
}

async function _recentRedemptionLogs(provider, player) {
  if (!provider || typeof provider.getLogs !== 'function') return [];
  let head;
  try { head = Number(await readProviderBlockNumber(provider, { maxAgeMs: 0 })); }
  catch (_e) { return []; }
  if (!Number.isSafeInteger(head) || head < 0) return [];
  const floor = Math.max(
    Number(CHAIN.deployBlock) || 0,
    head - SDGNRS_REDEMPTION_LOOKBACK_BLOCKS,
  );
  if (floor > head) return [];
  let topics;
  try {
    const submit = _iface().encodeFilterTopics(_iface().getEvent('RedemptionSubmitted'), [player]);
    const claimed = _iface().encodeFilterTopics(_iface().getEvent('RedemptionClaimed'), [player]);
    topics = [[submit[0], claimed[0]], submit[1]];
  } catch (_e) {
    return [];
  }
  const filter = { address: CONTRACTS.SDGNRS, topics };
  const key = `${CHAIN.id}:${String(player).toLowerCase()}`;
  let state = _redemptionLogStates.get(key);
  if (!state) {
    state = { lastScannedBlock: null, logs: new Map(), pending: null };
    _redemptionLogStates.set(key, state);
  }
  if (state.pending) return state.pending;

  const request = (async () => {
    if (state.lastScannedBlock === head) return [...state.logs.values()];
    if (state.lastScannedBlock != null && head < state.lastScannedBlock) {
      state.logs.clear();
      state.lastScannedBlock = null;
    }
    const fromBlock = state.lastScannedBlock == null
      ? floor
      : Math.max(floor, state.lastScannedBlock - SDGNRS_REORG_OVERLAP_BLOCKS + 1);
    for (const [logKey, log] of state.logs) {
      const blockNumber = Number(log?.blockNumber ?? 0);
      if (blockNumber < floor || blockNumber >= fromBlock) state.logs.delete(logKey);
    }
    const scanned = await _fetchRedemptionLogRange(provider, filter, fromBlock, head);
    for (const log of scanned.logs) state.logs.set(_redemptionLogKey(log), log);
    state.lastScannedBlock = scanned.completeThrough;
    return [...state.logs.values()];
  })().finally(() => {
    if (state.pending === request) state.pending = null;
  });
  state.pending = request;
  return request;
}

/**
 * Discover recent submissions and already-claimed receipts for one player.
 * Exact pending/ready state is always re-read from the contract; logs only
 * identify which composite-keyed periods belong to the player.
 */
export async function discoverSdgnrsRedemptions({ player, periodIndexes = [] } = {}) {
  if (!player) return { periods: [], claims: [] };
  const provider = _readProvider();
  if (!provider) return { periods: [], claims: [] };
  const logs = await _recentRedemptionLogs(provider, player);
  const periods = new Map();
  const claims = [];
  for (const log of Array.isArray(logs) ? logs : []) {
    try {
      const parsed = _iface().parseLog(log);
      if (!parsed) continue;
      const owner = String(parsed.args.player ?? parsed.args[0] ?? '').toLowerCase();
      if (!_sameAddress(owner, player)) continue;
      if (parsed.name === 'RedemptionSubmitted') {
        const periodIndex = Number(parsed.args.periodIndex);
        const amount = BigInt(parsed.args.sdgnrsAmount ?? parsed.args[1] ?? 0);
        periods.set(periodIndex, (periods.get(periodIndex) || 0n) + amount);
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
  const wantedPeriods = new Set(periods.keys());
  for (const periodIndex of Array.isArray(periodIndexes) ? periodIndexes : []) {
    const period = Number(periodIndex);
    if (Number.isInteger(period) && period >= 0 && period <= 0xFFFFFF) wantedPeriods.add(period);
  }
  const states = await Promise.all([...wantedPeriods].map(async (periodIndex) => {
    const state = await readSdgnrsRedemptionState({ player, periodIndex });
    return state
      ? { ...state, sdgnrsAmount: periods.has(periodIndex) ? periods.get(periodIndex) : null }
      : null;
  }));
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
 * @param {{amount: bigint|string|number, publicRead?: boolean}} args
 * @returns {Promise<{ethOut: bigint, flipOut: bigint}|null>}
 */
export async function previewSdgnrsBurn({ amount, publicRead: _publicRead = false } = {}) {
  let amountWei;
  try { amountWei = BigInt(amount); }
  catch (_e) { return null; }
  if (amountWei <= 0n) return null;

  const provider = _readProvider();
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
 * Burn transferable DGNRS through the same sDGNRS redemption backing.
 * DGNRS and sDGNRS are one-for-one supply claims, but the live-game wrapper
 * path must burn the connected signer's DGNRS before the backing sDGNRS.
 *
 * @param {{amount: bigint|string|number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt, amount: bigint}>}
 */
export async function burnDgnrs({ amount } = {}) {
  const connected = get('connected.address');
  if (!connected) throw new Error('Connect a wallet first.');
  const viewed = get('viewing.address');
  if (viewed && String(viewed).toLowerCase() !== String(connected).toLowerCase()) {
    throw new Error("DGNRS burns must be signed from the token owner's view.");
  }

  let amountWei;
  try { amountWei = BigInt(amount); }
  catch (_e) { throw new Error('Enter a valid DGNRS amount.'); }
  if (amountWei < MIN_DGNRS_BURN_WEI) {
    throw new Error('Minimum burn is 1 DGNRS.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(_buildContract(signer), 'burnWrapped', [amountWei], signer);
    if (!sim.ok) throw _burnError(sim.error, 'DGNRS');
  }

  try {
    const receipt = await sendTx(
      (freshSigner) => _buildContract(freshSigner).burnWrapped(amountWei),
      'Burn DGNRS',
    );
    const { submissions } = parseSdgnrsRedemptionReceipt(receipt, connected);
    return { receipt, amount: amountWei, submissions };
  } catch (error) {
    if (error?.revert?.name || error?.errorName) throw _burnError(error, 'DGNRS');
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
