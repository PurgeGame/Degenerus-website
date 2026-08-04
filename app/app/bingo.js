// /app/app/bingo.js — color-completion Bingo claim write path.
//
// The GAME exposes one permissionless claim at a time:
//   claimBingo(player, level, symbol, slots[8])
// `slots[color]` is the player's bucket index for that symbol in color 0..7.
// There is no claimBingoMany entrypoint in the deployed ABI, so the pending
// tray submits one player-confirmed transaction per DB-discovered proof.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';

export const BINGO_CLAIM_ABI = [
  'function claimBingo(address player, uint24 level, uint8 symbol, uint32[8] slots)',
  // Include every custom error reachable from claimBingo. Without these ABI
  // fragments ethers cannot name a static-call revert, so an already-settled
  // Bingo was reported as UNKNOWN and its stale Pending action never retired.
  'error AlreadyClaimed()',
  'error NotSlotOwner()',
  'error InvalidSymbol()',
  'error GameOver()',
  'event FirstQuadrantBingo(address indexed player, uint256 level, uint8 symbol)',
  'event FirstSymbolBingo(address indexed player, uint256 level, uint8 symbol)',
  'event BingoClaimed(address indexed player, uint256 level, uint8 symbol, uint256 flipReward, uint256 dgnrsPaid)',
];

register('AlreadyClaimed', {
  code: 'AlreadyClaimed',
  userMessage: 'This reward was already claimed.',
  recoveryAction: 'Refresh its indexed result.',
});

register('NotSlotOwner', {
  code: 'NotSlotOwner',
  userMessage: 'That indexed Bingo proof is stale.',
  recoveryAction: 'Refresh the ticket proof.',
});

let _contractFactory = null;

/** Test-only: replace Contract construction with a fake. */
export function __setContractFactoryForTest(fn) { _contractFactory = fn; }
export function __resetContractFactoryForTest() { _contractFactory = null; }

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, BINGO_CLAIM_ABI, signerOrProvider);
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

function _uint(value, max, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`Invalid Bingo ${label}.`);
  }
  return parsed;
}

/**
 * Submit one DB-proven Bingo claim. The reward is always credited to `player`,
 * even when an approved operator or another permissionless caller sends it.
 *
 * @param {{player:string, level:number, symbol:number, slots:number[]}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt, contract: object}>}
 */
export async function claimBingo(args = {}) {
  const player = String(args.player || '');
  if (!ethers.isAddress(player)) throw new Error('No valid Bingo player.');
  const level = _uint(args.level, 0xff_ffff, 'level');
  const symbol = _uint(args.symbol, 31, 'symbol');
  if (!Array.isArray(args.slots) || args.slots.length !== 8) {
    throw new Error('Bingo proof must contain all 8 colors.');
  }
  const slots = args.slots.map((slot) => _uint(slot, 0xffff_ffff, 'slot'));

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(
      contract,
      'claimBingo',
      [player, level, symbol, slots],
      signer,
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call claimBingo');
  }

  const receipt = await sendTx(
    (freshSigner) => _buildContract(freshSigner).claimBingo(player, level, symbol, slots),
    'Claim Bingo',
  );
  return { receipt, contract: _buildContract(provider) };
}
