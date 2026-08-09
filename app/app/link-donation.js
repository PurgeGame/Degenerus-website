// Player-facing LINK donation rail. LINK.transferAndCall(ADMIN, amount, 0x)
// invokes DegenerusAdmin.onTokenTransfer, funds the Chainlink subscription,
// and credits the donor with the same amount of mid-day RNG credit.

import { CONTRACTS } from './chain-config.js';
import { ethers, getProvider, sendTx } from './contracts.js';
import { getActingAddress } from './store.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';

const LINK_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transferAndCall(address to, uint256 amount, bytes data) returns (bool)',
];

const GAME_CREDIT_ABI = [
  'function middayRngCredits(address account) view returns (uint256)',
];

let _contractFactory = null;

function _contract(address, abi, runner) {
  if (_contractFactory) return _contractFactory(address, abi, runner);
  return new ethers.Contract(address, abi, runner);
}

function _structured(error, fallback) {
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || fallback);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

/** Wallet LINK and unspent mid-day RNG credit, both denominated in juels. */
export async function readLinkDonationState({ player } = {}) {
  const account = player ?? getActingAddress();
  const provider = getProvider();
  if (!account || !provider || !CONTRACTS.LINK_TOKEN || !CONTRACTS.GAME) return null;
  try {
    const link = _contract(CONTRACTS.LINK_TOKEN, LINK_ABI, provider);
    const game = _contract(CONTRACTS.GAME, GAME_CREDIT_ABI, provider);
    const [balance, credit] = await Promise.all([
      link.balanceOf(account),
      game.middayRngCredits(account),
    ]);
    return { balanceWei: BigInt(balance ?? 0), creditWei: BigInt(credit ?? 0) };
  } catch (_e) {
    return null;
  }
}

/** Donate LINK through its ERC-677 callback rail. */
export async function donateLink({ amount } = {}) {
  let amountWei;
  try { amountWei = BigInt(amount); }
  catch (_e) { throw new Error('Enter a LINK amount to donate.'); }
  if (amountWei <= 0n) throw new Error('Enter a LINK amount to donate.');
  if (!CONTRACTS.LINK_TOKEN || !CONTRACTS.ADMIN) {
    throw new Error('LINK donations are not configured on this network.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const link = _contract(CONTRACTS.LINK_TOKEN, LINK_ABI, signer);
    const sim = await requireStaticCall(
      link,
      'transferAndCall',
      [CONTRACTS.ADMIN, amountWei, '0x'],
      signer,
    );
    if (!sim.ok) throw _structured(sim.error, 'LINK donation could not be simulated.');
  }

  const receipt = await sendTx(
    (s) => _contract(CONTRACTS.LINK_TOKEN, LINK_ABI, s)
      .transferAndCall(CONTRACTS.ADMIN, amountWei, '0x'),
    'Fund Chainlink RNG',
  );
  return { receipt, amountWei };
}

export function __setLinkDonationContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
}

export function __resetLinkDonationForTest() {
  _contractFactory = null;
}

