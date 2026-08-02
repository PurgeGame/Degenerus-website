// /app/app/sdgnrs.js — player-facing sDGNRS redemption burn.
//
// During a live game `burn(amount)` submits a delayed, RNG-priced redemption;
// after GAMEOVER it pays the deterministic proportional backing directly. The
// contract burns msg.sender's soulbound balance, so this action intentionally
// cannot use the app's delegated/operator acting-address path.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';
import { get } from './store.js';

const SDGNRS_ABI = [
  'function burn(uint256 amount) external returns (uint256 ethOut, uint256 stethOut, uint256 flipOut)',
  'function previewBurnValue(uint256 amount) external view returns (uint256 ethOut, uint256 flipOut)',
  'event RedemptionSubmitted(address indexed player, uint256 sdgnrsAmount, uint256 ethValueOwed, uint256 flipEscrowed, uint24 periodIndex)',
  'error Insufficient()',
  'error BurnTooSmall()',
  'error BurnsBlockedDuringRng()',
  'error BurnsBlockedBeforeDailyRng()',
  'error BurnsBlockedDuringLiveness()',
  'error PriorDayUnresolved()',
  'error ExceedsDailyRedemptionCap()',
  'error TransferFailed()',
];

export const MIN_SDGNRS_BURN_WEI = 10n ** 18n;

let _contractFactory = null;

/** Test-only contract-construction seam. */
export function __setContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
}

/** Test-only reset. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
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
    return { receipt, amount: amountWei };
  } catch (error) {
    if (error?.revert?.name || error?.errorName) throw _burnError(error);
    throw error;
  }
}
