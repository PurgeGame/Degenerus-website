// /app/app/coinflip.js — Phase 62 Plan 62-03 (BUY-04 write path).
//
// Synchronous BURNIE deposit helper for BurnieCoinflip.depositCoinflip. Mirrors
// Phase 60 lootbox.js + Phase 61 claims.js + Phase 62-02 passes.js shape.
//
// On-chain surface (verified against degenerus-audit/contracts/BurnieCoinflip.sol):
//   - BUY-04: BurnieCoinflip.sol:229 — depositCoinflip(address player, uint256 amount)
//   - Event:  BurnieCoinflip.sol:46  — CoinflipDeposit(address indexed player, uint256 creditedFlip)
//
// RESEARCH R3 (HIGH confidence) invalidated CONTEXT D-01 step 1's conflation of
// BUY-04 with the degenerette BetPlaced/BetResolved pattern:
//   - depositCoinflip is a SYNCHRONOUS BURNIE deposit (no per-bet RNG cycle).
//   - Emits ONLY CoinflipDeposit. Outcome resolves daily via global
//     CoinflipDayResolved (NOT per-bet).
//   - The panel's UX is "deposit confirmed; outcome reveals at end of day."
//
// RESEARCH Q5 — BURNIE/DGNRS/tickets are UNSCALED on Sepolia (only ETH is /1M).
// Min coinflip deposit = 100 BURNIE = 100n * 10n**18n wei
// (BurnieCoinflip.sol:124 enforces this on-chain via AmountLTMin revert).
//
// Plan 62-03 registers TWO NEW reason-map codes:
//   - AmountLTMin    (BurnieCoinflip.sol:101) — amount below 100 BURNIE.
//   - CoinflipLocked (BurnieCoinflip.sol:102) — locked during BAF jackpot resolution.
// NotApproved is already registered by Phase 60 (RESEARCH R11) — DO NOT re-register.
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

// ---------------------------------------------------------------------------
// Inline ABI fragments — canonical signatures verified against
// degenerus-audit/contracts/BurnieCoinflip.sol:46 + :229.
// ---------------------------------------------------------------------------

const COINFLIP_ABI = [
  // BurnieCoinflip.sol:229 — depositCoinflip(player, amount)
  'function depositCoinflip(address player, uint256 amount) external',
  // BurnieCoinflip.sol:46 — CoinflipDeposit emitted on every deposit (CF-05).
  'event CoinflipDeposit(address indexed player, uint256 creditedFlip)',
];

// Minimum BURNIE deposit (BurnieCoinflip.sol:124 enforces via AmountLTMin).
// RESEARCH Q5: BURNIE is unscaled on Sepolia — 1 BURNIE = 1e18 wei.
const COINFLIP_MIN_BURNIE_WEI = 100n * 10n ** 18n;

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Tests inject a fake via __setContractFactoryForTest; reset via
// __resetContractFactoryForTest. Mirrors Phase 60 / Phase 61 / Phase 62-02 pattern.
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
  return new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, signerOrProvider);
}

// ---------------------------------------------------------------------------
// Structured-revert-error helper — verbatim port from Phase 61 claims.js / 62-02 passes.js.
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
// depositCoinflip — BUY-04 — synchronous BURNIE deposit.
//
// Validates amount >= COINFLIP_MIN_BURNIE_WEI client-side BEFORE static-call
// (defense-in-depth + faster UX). Static-call gate catches any contract-side
// state (CoinflipLocked during BAF jackpot resolution, etc.). Closure-form
// sendTx is mandatory.
// ---------------------------------------------------------------------------

/**
 * @param {{amount: bigint | string | number, player?: string}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function depositCoinflip({ amount, player } = {}) {
  const buyer = player || get('connected.address');
  if (!buyer) throw new Error('Wallet not connected.');

  let amountWei;
  try {
    amountWei = BigInt(amount);
  } catch (_e) {
    throw new Error('Amount must be a numeric value.');
  }
  if (amountWei < COINFLIP_MIN_BURNIE_WEI) {
    throw new Error('Minimum coinflip deposit is 100 BURNIE.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  if (signer) {
    const c = _buildContract(signer);
    const sim = await requireStaticCall(c, 'depositCoinflip', [buyer, amountWei], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call depositCoinflip');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => _buildContract(s).depositCoinflip(buyer, amountWei),
    'Coinflip deposit',
  );
  return { receipt };
}

// ---------------------------------------------------------------------------
// parseCoinflipDepositFromReceipt — extracts {player, creditedFlip} per emitted
// CoinflipDeposit event. CF-05 receipt-log-first pattern (Phase 60 D-03).
//
// Used by <app-coinflip-panel> to surface "you staked X BURNIE, credited Y BURNIE
// after recycling bonus" on tx confirmation.
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{player: string, creditedFlip: bigint}>}
 */
export function parseCoinflipDepositFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'CoinflipDeposit') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          creditedFlip: BigInt(parsed.args.creditedFlip ?? parsed.args[1]),
        });
      }
    } catch (_e) {
      // skip non-matching logs (foreign contracts, unknown events)
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reason-map registrations — Plan 62-03's 2 NEW codes.
//
// AmountLTMin    (BurnieCoinflip.sol:101) — depositCoinflip rejects amount <
//                COINFLIP_MIN_BURNIE_WEI on-chain. Client-side validation
//                catches this first; this registration is the static-call
//                fallback decode.
// CoinflipLocked (BurnieCoinflip.sol:102) — coinflip module locks during BAF
//                jackpot resolution. User retries after resolution completes.
//
// NotApproved is already registered by Phase 60 (RESEARCH R11) — DO NOT
// re-register (the registration is idempotent but Plan 62-03 explicitly avoids
// it to keep its 2-NEW-codes acceptance criterion clean).
// ---------------------------------------------------------------------------

register('AmountLTMin', {
  code: 'AmountLTMin',
  userMessage: 'Minimum coinflip deposit is 100 BURNIE.',
  recoveryAction: 'Increase your deposit and try again.',
});

register('CoinflipLocked', {
  code: 'CoinflipLocked',
  userMessage: 'Coinflip is locked during jackpot resolution.',
  recoveryAction: 'Try again in a few minutes.',
});
