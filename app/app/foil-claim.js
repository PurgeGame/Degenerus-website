// /app/app/foil-claim.js — foil match claim write path.
//
// claimFoilMatch(address player, uint256 day, uint256 ticketIndex, uint8 drawKind)
// on GAME (delegatecalled into DegenerusGameFoilPackModule, verified at
// contracts/DegenerusGame.sol:733 + FoilPackModule.sol:347). Permissionless:
// the win credits `player`, never the caller; a tuple pays at most once.
//
// The payout is an isolated Degenerette box-spin staking the tier's faces
// (T4=2 / T5=6 / T6=35 / T7=400 / T8=10,000 — one face = one ticket of value,
// 40/40/20 ETH/FLIP/WWXRP lanes; T8 also grants a half whale pass). The claim
// receipt therefore carries a BoxSpin event that lootbox-legs.js decodes into
// reveal-overlay reels.
//
// Mirrors lootbox.js structure: closure-form sendTx (Phase 58), static-call
// pre-flight (Phase 56 CF-03), structured revert decode (CF-02), contract
// factory test seam.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';

export const FOIL_CLAIM_ABI = [
  'function claimFoilMatch(address player, uint256 day, uint256 ticketIndex, uint8 drawKind)',
  'error NoClaimableMatch()',
  'error GameOver()',
  'event FoilMatchClaimed(address indexed player, uint24 indexed day, uint256 ticketIndex, uint8 drawKind, uint8 tier, uint256 faces)',
];

// These errors are reachable before the payout spin. In particular,
// NoClaimableMatch is the normal permissionless race: another caller already
// settled the immutable (player, day, ticket, draw) tuple between our indexed
// read and static call.
register('NoClaimableMatch', {
  code: 'NoClaimableMatch',
  userMessage: 'This foil match is already settled.',
  recoveryAction: 'Refresh foil results.',
});

/** Tier → faces staked into the payout spin (FoilPackModule.sol:70-74). */
export const FOIL_TIER_FACES = Object.freeze({ 4: 2, 5: 6, 6: 35, 7: 400, 8: 10_000 });

let _contractFactory = null;

/** Test-only: replace the `new Contract(...)` construction with a fake. */
export function __setContractFactoryForTest(fn) { _contractFactory = fn; }
export function __resetContractFactoryForTest() { _contractFactory = null; }

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, FOIL_CLAIM_ABI, signerOrProvider);
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
 * @param {{player: string, day: number|bigint, ticketIndex: number, drawKind: number}} args
 * @returns {Promise<{receipt, contract}>}
 */
export async function claimFoilMatch(args) {
  const player = String(args.player || '');
  if (!player) throw new Error('No player to claim for.');
  const day = BigInt(args.day);
  const ticketIndex = BigInt(args.ticketIndex);
  const drawKind = Number(args.drawKind) & 1;

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(
      contract,
      'claimFoilMatch',
      [player, day, ticketIndex, drawKind],
      signer
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call claimFoilMatch');
  }

  const receipt = await sendTx(
    (s) => {
      const c = _buildContract(s);
      return c.claimFoilMatch(player, day, ticketIndex, drawKind);
    },
    'Claim foil match'
  );

  const contract = _buildContract(provider);
  return { receipt, contract };
}

/**
 * Parse FoilMatchClaimed entries from a claim receipt.
 * @returns {Array<{player: string, day: number, ticketIndex: number, drawKind: number, tier: number, faces: number}>}
 */
export function parseFoilMatchClaimedFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'FoilMatchClaimed') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          day: Number(parsed.args.day ?? parsed.args[1]),
          ticketIndex: Number(parsed.args.ticketIndex ?? parsed.args[2]),
          drawKind: Number(parsed.args.drawKind ?? parsed.args[3]),
          tier: Number(parsed.args.tier ?? parsed.args[4]),
          faces: Number(parsed.args.faces ?? parsed.args[5]),
        });
      }
    } catch (_e) { /* foreign log — skip */ }
  }
  return out;
}
