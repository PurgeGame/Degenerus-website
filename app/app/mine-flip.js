// /app/app/mine-flip.js — MINE FLIP keeper crank (write path + work probe).
//
// `mineFlip()` is the permissionless afking router on the GAME contract
// (degenerus-audit/contracts/DegenerusGame.sol:398, delegatecalling
// GameAfkingModule.sol:1719). It does ONE category of pending work per call —
// advance first (liveness-critical), then afking/human box opens — and pays the
// caller ONE bounty in minted FLIP. When every category is empty it reverts
// `NoWork()` (GameAfkingModule.sol:109, "the clean no-work signal").
//
// That revert is why this module needs no duplicate "is there work?" predicate:
// a staticCall of the crank IS the contract's own definition of work. Any
// re-derivation here (advance due? boxes pending? rngLock?) would be a second
// copy of consensus logic that can drift from the chain. Same probe-by-simulation
// pattern as claims.js `probeRedeemFlip`.
//
// STALE ABI ARTIFACT — READ BEFORE "FIXING" THE NAME:
// The router entrypoint was renamed `mintFlip()` -> `mineFlip()` in audit commit
// b10ef49a, and `degenerus-sim/deployments/abis/GAME_AFKING_MODULE.json` still
// lists the OLD name. That artifact is stale; the chain is not. Verified by raw
// eth_call against the live Base Sepolia GAME (0xf601fdfa…, chain-config.sepolia.js):
//
//   mineFlip()  selector 0x197b7998 -> reverts 0x5c78c46f (= NoWork())  ← exists
//   mintFlip()  selector 0x0cd8dce8 -> "missing revert data"            ← absent
//
// So `mineFlip` is the only name, and a NoWork revert from it is proof the
// entrypoint is live. Do not re-add a `mintFlip` fallback off the back of the
// checked-in ABI — regenerate that artifact instead.

import { sendTx, getProvider, ethers, gasEstimateWithHeadroom } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';
import { getActingAddress } from './store.js';

// Verified: DegenerusGame.sol:398 and a live eth_call (see header). Declaring
// `error NoWork()` here is what lets ethers decode the empty-queue revert by
// name instead of handing back an unnamed CALL_EXCEPTION.
const MINE_FLIP_ABI = [
  'function mineFlip() external',
  'error NoWork()',
];

const CRANK_NAME = 'mineFlip';
const MINE_FLIP_MIN_GAS_LIMIT = 10_000_000n;
// The protocol keeper's measured ceiling, kept below Base's 16,777,216
// per-transaction cap. Browser sends retain the live estimate + shared
// headroom, but never go below the 10m floor required by the heaviest branches.
const MINE_FLIP_MAX_GAS_LIMIT = 16_000_000n;

let _contractFactory = null;

/** Test-only: replace the `new Contract(...)` construction with a fake. */
export function __setContractFactoryForTest(fn) {
  _contractFactory = fn;
}

/** Test-only: clear the injected factory; subsequent calls use the real path. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
}

function _buildGameContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, MINE_FLIP_ABI, signerOrProvider);
}

function _structuredRevertError(error, context) {
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || `Failed: ${context}`);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

/**
 * True when the revert is the crank's "queue is empty" signal rather than a
 * real failure. Matched on the decoded code AND on the raw text: the deployed
 * build predates some reason-map registrations, and a custom error the local ABI
 * does not know about surfaces as an unnamed `CALL_EXCEPTION` whose data is the
 * NoWork selector.
 */
const NO_WORK_SELECTOR = '0x5c78c46f'; // keccak256("NoWork()")[0:4]

// Registered under BOTH keys at module load, mirroring claims.js. The name path
// fires when ethers decodes against our ABI fragment; the selector path covers a
// deploy whose revert data we can read but whose error we never declared.
register('NoWork', {
  code: 'NoWork',
  userMessage: 'Nothing to mine right now.',
  recoveryAction: 'The queue is empty — check back after the next day rolls over.',
});
register(NO_WORK_SELECTOR, {
  code: 'NoWork',
  userMessage: 'Nothing to mine right now.',
  recoveryAction: 'The queue is empty — check back after the next day rolls over.',
});

export function isNoWorkRevert(error) {
  if (!error) return false;
  const decoded = decodeRevertReason(error);
  if (decoded && decoded.code === 'NoWork') return true;
  const data = error?.data ?? error?.info?.error?.data ?? error?.cause?.data;
  if (typeof data === 'string' && data.toLowerCase().startsWith(NO_WORK_SELECTOR)) return true;
  return /\bNoWork\b/.test(String(error?.message ?? ''));
}

async function _mineFlipGasBudget(contract, signer, provider) {
  // BrowserProvider supplies all three methods. The capability guard keeps
  // read-only/test runners degraded rather than fabricating an affordability
  // result from incomplete RPC data.
  if (typeof provider?.getBalance !== 'function'
    || typeof provider?.getFeeData !== 'function'
    || typeof signer?.getAddress !== 'function') return null;
  const connected = typeof contract?.connect === 'function' ? contract.connect(signer) : contract;
  if (typeof connected?.[CRANK_NAME]?.estimateGas !== 'function') return null;

  try {
    const [estimateRaw, address, feeData] = await Promise.all([
      connected[CRANK_NAME].estimateGas(),
      signer.getAddress(),
      provider.getFeeData(),
    ]);
    const estimate = BigInt(estimateRaw ?? 0);
    if (estimate <= 0n || estimate > MINE_FLIP_MAX_GAS_LIMIT) {
      return { affordable: false, reason: 'gas-limit', estimate };
    }
    const padded = gasEstimateWithHeadroom(estimate);
    const gasLimit = padded > MINE_FLIP_MAX_GAS_LIMIT
      ? MINE_FLIP_MAX_GAS_LIMIT
      : padded < MINE_FLIP_MIN_GAS_LIMIT
        ? MINE_FLIP_MIN_GAS_LIMIT
        : padded;
    const feeRaw = feeData?.maxFeePerGas ?? feeData?.gasPrice;
    if (feeRaw == null) return null;
    const feePerGas = BigInt(feeRaw);
    const balance = BigInt(await provider.getBalance(address));
    const requiredWei = gasLimit * feePerGas;
    return {
      affordable: balance >= requiredWei,
      reason: balance >= requiredWei ? null : 'insufficient-gas',
      balanceWei: balance,
      requiredWei,
      estimate,
      gasLimit,
    };
  } catch (error) {
    return { affordable: false, reason: 'gas-unknown', error };
  }
}

/**
 * Ask the chain whether the crank has anything to do, without spending gas.
 *
 * Never throws, and distinguishes "no work" from "could not tell": an
 * unreachable provider reports `known: false`, so a dead RPC can neither light
 * the widget up nor claim the queue is empty.
 *
 * @param {{player?: string}} [args]
 * @returns {Promise<{hasWork: boolean, known: boolean, reason?: string,
 *   error?: Error, gasLimit?: bigint, balanceWei?: bigint, requiredWei?: bigint}>}
 */
export async function probeMineFlip({ player } = {}) {
  const provider = getProvider();
  if (!provider) return { hasWork: false, known: false };

  let signer = null;
  try {
    signer = await provider.getSigner();
  } catch (_e) {
    // Read-only browsing (no wallet): the crank is a write, so there is nothing
    // to offer. Report "unknown" rather than "no work" — they are different.
    return { hasWork: false, known: false };
  }

  const contract = _buildGameContract(signer);
  const sim = await requireStaticCall(contract, CRANK_NAME, [], signer);
  if (sim.ok) {
    const budget = await _mineFlipGasBudget(contract, signer, provider);
    if (budget && !budget.affordable) {
      return {
        hasWork: false,
        known: budget.reason === 'insufficient-gas' || budget.reason === 'gas-limit',
        reason: budget.reason,
        error: budget.error,
        balanceWei: budget.balanceWei,
        requiredWei: budget.requiredWei,
      };
    }
    return { hasWork: true, known: true, gasLimit: budget?.gasLimit };
  }
  if (isNoWorkRevert(sim.error)) return { hasWork: false, known: true };

  // Some other revert (or an RPC fault): not work, and not a reliable "empty".
  return { hasWork: false, known: false, error: sim.error };
}

/**
 * Run the crank. Pre-flights through the same probe so a NoWork queue surfaces
 * as a plain message rather than a wallet prompt for a tx that must revert.
 *
 * @param {{player?: string}} [args]
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt, entrypoint: string}>}
 */
export async function mineFlip({ player } = {}) {
  const playerArg = player ?? getActingAddress();
  if (!playerArg) throw new Error('Wallet not connected.');

  const probe = await probeMineFlip({ player: playerArg });
  if (probe.known && !probe.hasWork) {
    if (probe.reason === 'insufficient-gas') {
      const err = new Error('Not enough ETH for Mine FLIP gas.');
      err.code = 'InsufficientGas';
      err.userMessage = 'Not enough ETH for Mine FLIP gas.';
      throw err;
    }
    const err = new Error('Nothing to mine right now.');
    err.code = 'NoWork';
    err.userMessage = 'Nothing to mine right now.';
    throw err;
  }
  if (!probe.known && probe.error) {
    throw _structuredRevertError(probe.error, `static-call ${CRANK_NAME}`);
  }

  // Phase 58 chokepoint — closure form mandatory (stale-signer capture guard).
  const receipt = await sendTx((s) => {
    const contract = _buildGameContract(s);
    const gasLimit = probe.gasLimit != null && BigInt(probe.gasLimit) > MINE_FLIP_MIN_GAS_LIMIT
      ? BigInt(probe.gasLimit)
      : MINE_FLIP_MIN_GAS_LIMIT;
    return contract.mineFlip({ gasLimit });
  }, 'Mine FLIP');
  return { receipt, entrypoint: CRANK_NAME };
}

export const _testing = {
  CRANK_NAME,
  NO_WORK_SELECTOR,
  MINE_FLIP_MIN_GAS_LIMIT,
  MINE_FLIP_MAX_GAS_LIMIT,
  mineFlipGasBudget: _mineFlipGasBudget,
};
