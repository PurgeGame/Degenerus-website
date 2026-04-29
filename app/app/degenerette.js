// /app/app/degenerette.js — Phase 62 Plan 62-03 (BUY-05 write path).
//
// Degenerette two-tx bet flow: placeBet (single tx, emits BetPlaced) → poll
// pollRngForLootbox(BetPlaced.index) until non-zero → resolveBets (single tx,
// emits FullTicketResolved + FullTicketResult per ticket).
//
// On-chain surfaces (verified against degenerus-audit/contracts/):
//   - DegenerusGame.sol:714 — placeDegeneretteBet(player, currency, amount, count, customTicket, heroQuadrant) payable
//   - DegenerusGame.sol:743 — resolveDegeneretteBets(player, betIds[])
//   - DegeneretteModule.sol:69-104 — BetPlaced / FullTicketResolved / FullTicketResult events.
//
// RESEARCH R5 confirmed two-tx flow + RNG keying:
//   - placeDegeneretteBet emits BetPlaced(player, index, betId, packed) where
//     `index` is the lootbox-RNG index this bet ties to.
//   - RNG resolution is shared with the lootbox subsystem — degenerette panel
//     reuses Phase 60 pollRngForLootbox(BigInt(BetPlaced.index)) (RESEARCH R5
//     OPTION B). When the call returns non-zero the bet is ready to resolve.
//   - resolveDegeneretteBets walks each betId, decodes RNG, emits
//     FullTicketResolved (per bet) + FullTicketResult (per ticket within bet).
//
// RESEARCH Q7 — WWXRP (currency 3) deferred from Phase 62 — UI restricts
// currency to ETH (0) + BURNIE (1). Currency 2 → UnsupportedCurrency revert.
//
// Plan 62-03 registers TWO NEW reason-map codes:
//   - InvalidBet          (DegeneretteModule.sol:55) — zero amount, below min, invalid spec.
//   - UnsupportedCurrency (DegeneretteModule.sol:58) — currency==2 (or any unrecognized).
// RngNotReady is already registered by Phase 56 baseline (R11) — DO NOT re-register.
//
// Inline ABI fragments — DO NOT cross-import /beta/app/constants.js (Pitfall 4).
//
// MANDATORY closure form for every sendTx call (Phase 58 verified by grep gate):
//   CORRECT:   sendTx( (s) => new Contract(addr, ABI, s).method(args), 'Action' )
//   FORBIDDEN: passing a pre-resolved tx promise — captures stale signer.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';
import { get } from './store.js';
// RESEARCH R5 OPTION B — degenerette RNG is keyed by lootbox-RNG index;
// reuse Phase 60's canonical reader rather than duplicating the view call.
import { pollRngForLootbox } from './lootbox.js';

// ---------------------------------------------------------------------------
// Inline ABI fragments — canonical signatures verified against
// degenerus-audit/contracts/DegenerusGame.sol:714 + :743 +
// degenerus-audit/contracts/modules/DegenerusGameDegeneretteModule.sol:69-104.
// ---------------------------------------------------------------------------

const DEGENERETTE_ABI = [
  // DegenerusGame.sol:714 — placeDegeneretteBet (payable)
  'function placeDegeneretteBet(address player, uint8 currency, uint128 amountPerTicket, uint8 ticketCount, uint32 customTicket, uint8 heroQuadrant) external payable',
  // DegenerusGame.sol:743 — resolveDegeneretteBets
  'function resolveDegeneretteBets(address player, uint64[] calldata betIds) external',
  // DegeneretteModule.sol:69 — BetPlaced (RESEARCH R5).
  'event BetPlaced(address indexed player, uint32 indexed index, uint64 indexed betId, uint256 packed)',
  // DegeneretteModule.sol:82 — FullTicketResolved.
  'event FullTicketResolved(address indexed player, uint64 indexed betId, uint8 ticketCount, uint256 totalPayout, uint32 resultTicket)',
  // DegeneretteModule.sol:97 — FullTicketResult (per-spin entry).
  'event FullTicketResult(address indexed player, uint64 indexed betId, uint8 ticketIndex, uint32 playerTicket, uint8 matches, uint256 payout)',
];

// Currency selector values (DegenerusGame.sol:709 NatSpec). Currency 2 is
// unsupported — placeDegeneretteBet reverts with UnsupportedCurrency.
const DEGENERETTE_CURRENCY = Object.freeze({ ETH: 0, BURNIE: 1, WWXRP: 3 });
// Hero-quadrant sentinel for "no hero boost" (per DegenerusGame.sol:713 NatSpec).
const HERO_QUADRANT_NONE = 0xFF;
// Ticket count bounds (DegenerusGame.sol:711 NatSpec — 1-10 spins).
const TICKET_COUNT_MIN = 1;
const TICKET_COUNT_MAX = 10;

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// degenerette is delegate-called via DegenerusGame, so factory points at
// CONTRACTS.GAME (not a separate degenerette address).
// ---------------------------------------------------------------------------

let _contractFactory = null;

/** Test-only: replace the `new Contract(...)` construction with a fake. */
export function __setContractFactoryForTest(fn) {
  _contractFactory = fn;
}

/** Test-only: clear the injected factory; subsequent calls use the real path. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
}

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, DEGENERETTE_ABI, signerOrProvider);
}

// ---------------------------------------------------------------------------
// Structured-revert-error helper — verbatim port from claims.js / passes.js / coinflip.js.
// ---------------------------------------------------------------------------

function _structuredRevertError(error, context) {
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || `Failed: ${context}`);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

// ---------------------------------------------------------------------------
// placeBet — BUY-05 stage 1 — placeDegeneretteBet (payable).
//
// Validates inputs client-side (defense-in-depth before static-call):
//   - currency ∈ {ETH (0), BURNIE (1), WWXRP (3)} — currency 2 rejected.
//   - ticketCount ∈ [1, 10].
//   - amountPerTicketWei > 0n.
//   - heroQuadrant defaults to HERO_QUADRANT_NONE if not provided.
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   currency: number,
 *   amountPerTicketWei: bigint | string | number,
 *   ticketCount: number,
 *   customTicket?: number,
 *   heroQuadrant?: number,
 *   msgValueWei?: bigint | string | number,
 *   player?: string,
 * }} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function placeBet({
  currency,
  amountPerTicketWei,
  ticketCount,
  customTicket,
  heroQuadrant,
  msgValueWei,
  player,
} = {}) {
  const buyer = player || get('connected.address');
  if (!buyer) throw new Error('Wallet not connected.');

  // Currency validation — explicit allow-list (RESEARCH Q7 — currency 2 is
  // UnsupportedCurrency on-chain; we reject it client-side too for faster UX).
  const cur = Number(currency);
  if (cur !== DEGENERETTE_CURRENCY.ETH
    && cur !== DEGENERETTE_CURRENCY.BURNIE
    && cur !== DEGENERETTE_CURRENCY.WWXRP) {
    throw new Error('Unsupported currency. Pick ETH or BURNIE.');
  }

  // Ticket count bounds.
  const tc = Number(ticketCount);
  if (!Number.isInteger(tc) || tc < TICKET_COUNT_MIN || tc > TICKET_COUNT_MAX) {
    throw new Error(`Ticket count must be 1-10.`);
  }

  // Amount-per-ticket > 0.
  let amount;
  try {
    amount = BigInt(amountPerTicketWei);
  } catch (_e) {
    throw new Error('Amount must be a numeric value.');
  }
  if (amount <= 0n) {
    throw new Error('Amount must be greater than 0.');
  }

  const ct = customTicket == null ? 0 : Number(customTicket);
  const hq = heroQuadrant == null ? HERO_QUADRANT_NONE : Number(heroQuadrant);
  const value = BigInt(msgValueWei ?? 0n);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  if (signer) {
    const c = _buildContract(signer);
    const sim = await requireStaticCall(
      c,
      'placeDegeneretteBet',
      [buyer, cur, amount, tc, ct, hq],
      signer,
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call placeDegeneretteBet');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => _buildContract(s).placeDegeneretteBet(buyer, cur, amount, tc, ct, hq, { value }),
    'Place degenerette bet',
  );
  return { receipt };
}

// ---------------------------------------------------------------------------
// resolveBets — BUY-05 stage 2 — resolveDegeneretteBets after RNG ready.
// ---------------------------------------------------------------------------

/**
 * @param {{betIds: Array<bigint | number | string>, player?: string}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function resolveBets({ betIds, player } = {}) {
  const buyer = player || get('connected.address');
  if (!buyer) throw new Error('Wallet not connected.');

  if (!Array.isArray(betIds) || betIds.length === 0) {
    throw new Error('betIds must be a non-empty array.');
  }
  // Coerce to BigInt[] — defense-in-depth + ABI compatibility.
  const ids = betIds.map((id) => {
    try { return BigInt(id); }
    catch (_e) { throw new Error('Each betId must be numeric.'); }
  });

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const c = _buildContract(signer);
    const sim = await requireStaticCall(
      c,
      'resolveDegeneretteBets',
      [buyer, ids],
      signer,
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call resolveDegeneretteBets');
  }

  const receipt = await sendTx(
    (s) => _buildContract(s).resolveDegeneretteBets(buyer, ids),
    'Resolve degenerette bet',
  );
  return { receipt };
}

// ---------------------------------------------------------------------------
// parseBetPlacedFromReceipt — extracts {player, index, betId, packed}.
// CF-05 receipt-log-first pattern (Phase 60 D-03).
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{player: string, index: bigint, betId: bigint, packed: bigint}>}
 */
export function parseBetPlacedFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'BetPlaced') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          index: BigInt(parsed.args.index ?? parsed.args[1]),
          betId: BigInt(parsed.args.betId ?? parsed.args[2]),
          packed: BigInt(parsed.args.packed ?? parsed.args[3]),
        });
      }
    } catch (_e) {
      // skip non-matching logs
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseBetResolvedFromReceipt — extracts FullTicketResolved entries.
// One entry per resolved bet; per-spin detail comes from FullTicketResult.
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{player: string, betId: bigint, ticketCount: bigint, totalPayout: bigint, resultTicket: bigint}>}
 */
export function parseBetResolvedFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'FullTicketResolved') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          betId: BigInt(parsed.args.betId ?? parsed.args[1]),
          ticketCount: BigInt(parsed.args.ticketCount ?? parsed.args[2]),
          totalPayout: BigInt(parsed.args.totalPayout ?? parsed.args[3]),
          resultTicket: BigInt(parsed.args.resultTicket ?? parsed.args[4]),
        });
      }
    } catch (_e) {
      // skip
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseFullTicketResultsFromReceipt — extracts per-spin FullTicketResult entries.
// Used for detailed outcome breakdown (matches + payout per ticket within a bet).
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{player: string, betId: bigint, ticketIndex: bigint, playerTicket: bigint, matches: bigint, payout: bigint}>}
 */
export function parseFullTicketResultsFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'FullTicketResult') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          betId: BigInt(parsed.args.betId ?? parsed.args[1]),
          ticketIndex: BigInt(parsed.args.ticketIndex ?? parsed.args[2]),
          playerTicket: BigInt(parsed.args.playerTicket ?? parsed.args[3]),
          matches: BigInt(parsed.args.matches ?? parsed.args[4]),
          payout: BigInt(parsed.args.payout ?? parsed.args[5]),
        });
      }
    } catch (_e) {
      // skip
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reason-map registrations — Plan 62-03's 2 NEW codes.
//
// InvalidBet          (DegeneretteModule.sol:55) — zero amount, below min,
//                     invalid spec, etc.
// UnsupportedCurrency (DegeneretteModule.sol:58) — currency==2 path.
//
// RngNotReady is already registered by Phase 56 baseline (R11) — DO NOT
// re-register (Plan 62-03 explicitly avoids it to keep its 2-NEW-codes
// acceptance criterion clean).
// ---------------------------------------------------------------------------

register('InvalidBet', {
  code: 'InvalidBet',
  userMessage: 'Invalid bet — check amount, count, and inputs.',
  recoveryAction: 'Adjust your bet and try again.',
});

register('UnsupportedCurrency', {
  code: 'UnsupportedCurrency',
  userMessage: 'That currency is not supported.',
  recoveryAction: 'Pick ETH or BURNIE.',
});
