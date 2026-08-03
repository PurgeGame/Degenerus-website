// Player-facing WWXRP burn into the daily weighted draw.
//
// WWXRP.enter burns the connected signer's own token balance. There is no
// beneficiary argument, so operator/view modes cannot burn for another player.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';
import { get } from './store.js';

const WWXRP_ABI = [
  'function enter(uint256 amount) external',
  'error BelowMinBurn()',
  'error InsufficientBalance()',
  'error ScoreOverflow()',
];

export const MIN_WWXRP_BURN_WEI = 25n * (10n ** 18n);

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
  if (!CONTRACTS.WWXRP) throw new Error('WWXRP burns are unavailable on this network.');
  return new ethers.Contract(CONTRACTS.WWXRP, WWXRP_ABI, signerOrProvider);
}

function _burnError(error) {
  const name = error?.revert?.name || error?.errorName || null;
  const local = {
    BelowMinBurn: {
      code: 'BelowMinBurn',
      userMessage: 'Minimum burn is 25 WWXRP.',
      recoveryAction: 'Enter at least 25 WWXRP.',
    },
    InsufficientBalance: {
      code: 'InsufficientBalance',
      userMessage: 'Not enough WWXRP for that burn.',
      recoveryAction: 'Lower the burn amount.',
    },
    ScoreOverflow: {
      code: 'ScoreOverflow',
      userMessage: 'This WWXRP draw bucket cannot accept another entry.',
      recoveryAction: 'Try again after the next daily draw.',
    },
  }[name];
  const decoded = local || decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || 'WWXRP burn failed.');
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

/**
 * Burn the connected signer's WWXRP into today's weighted draw.
 *
 * @param {{amount: bigint|string|number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt, amount: bigint}>}
 */
export async function burnWwxrp({ amount } = {}) {
  const connected = get('connected.address');
  if (!connected) throw new Error('Connect a wallet first.');
  const viewed = get('viewing.address');
  if (viewed && String(viewed).toLowerCase() !== String(connected).toLowerCase()) {
    throw new Error("WWXRP burns must be signed from the token owner's view.");
  }

  let amountWei;
  try { amountWei = BigInt(amount); }
  catch (_e) { throw new Error('Enter a valid WWXRP amount.'); }
  if (amountWei < MIN_WWXRP_BURN_WEI) {
    throw new Error('Minimum burn is 25 WWXRP.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(_buildContract(signer), 'enter', [amountWei], signer);
    if (!sim.ok) throw _burnError(sim.error);
  }

  try {
    const receipt = await sendTx(
      (freshSigner) => _buildContract(freshSigner).enter(amountWei),
      'Burn WWXRP for daily draw',
    );
    return { receipt, amount: amountWei };
  } catch (error) {
    if (error?.revert?.name || error?.errorName) throw _burnError(error);
    throw error;
  }
}
