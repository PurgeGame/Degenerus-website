// /app/app/decimator.js — purchase helpers plus the live Decimator entry path.
//
// Ticket purchases still share DegenerusGame.purchase() with lootboxes, so
// those helpers remain direct re-exports. A Decimator entry is different: the
// player burns FLIP.decimatorBurn(player, amount) during the indexed window.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';
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

/** FLIP.sol DECIMATOR_MIN — FLIP is an unscaled 18-decimal token. */
export const DECIMATOR_MIN_FLIP_WEI = 1_000n * 10n ** 18n;

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
  return new ethers.Contract(CONTRACTS.COIN, DECIMATOR_ABI, signerOrProvider);
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
