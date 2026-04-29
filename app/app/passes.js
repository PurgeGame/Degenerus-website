// /app/app/passes.js — Phase 62 Plan 62-02 (BUY-02 + BUY-03 write path).
//
// Whale + Deity pass purchase helpers. Two named exports wrap Phase 56
// requireStaticCall + decodeRevertReason and Phase 58 sendTx closure-form
// chokepoint. Mirrors Phase 60 lootbox.js + Phase 61 claims.js shape.
//
// On-chain surfaces (verified against degenerus-audit/contracts/):
//   - BUY-02: DegenerusGame.sol:599 — purchaseWhaleBundle(address buyer, uint256 quantity) payable
//   - BUY-03: DegenerusGame.sol:644 — purchaseDeityPass(address buyer, uint8 symbolId) payable
//
// CONTEXT D-05 LOCKED + RESEARCH R8 + Pitfall 3:
//   Whale-pass + deity-pass have NO custom-error reverts on these paths — all
//   failure paths route through `revert E()` (storage:210). The deity-pass
//   `symbol-taken` site is contracts/modules/DegenerusGameWhaleModule.sol:546
//   (`if (deityBySymbol[symbolId] != address(0)) revert E();`). Plan 62-02
//   ships a panel-level decode override (deityPassErrorOverride) INSTEAD of
//   editing the shared reason-map — `'E'` retains its generic copy for
//   non-deity contexts.
//
// Plan 62-02 registers ONE NEW reason-map code: `RngLocked`. Phase 56 only had
// it as a comment per RESEARCH R11; deity-pass purchase can throw it during VRF
// cycles via storage:213.
//
// Inline ABI fragments — DO NOT cross-import /beta/app/constants.js (Pitfall 4
// pattern from Phase 61: /beta has WRONG signatures elsewhere; defense-in-depth
// is to keep ABI strings co-located with the helpers).
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
// degenerus-audit/contracts/DegenerusGame.sol:599 + :644 — VERIFIED.
// ---------------------------------------------------------------------------

const PASSES_ABI = [
  // BUY-02: DegenerusGame.sol:599 — purchaseWhaleBundle(buyer, quantity) payable
  'function purchaseWhaleBundle(address buyer, uint256 quantity) external payable',
  // BUY-03: DegenerusGame.sol:644 — purchaseDeityPass(buyer, symbolId) payable
  'function purchaseDeityPass(address buyer, uint8 symbolId) external payable',
  // Receipt-log events for confirmation parsing (CF-05). Sourced from
  // contracts/modules/DegenerusGameWhaleModule.sol:62 (WhalePassClaimed) and
  // contracts/storage/DegenerusGameStorage.sol:516 (DeityPassPurchased).
  'event WhalePassClaimed(address indexed player, address indexed caller, uint256 halfPasses, uint24 startLevel)',
  'event DeityPassPurchased(address indexed buyer, uint8 symbolId, uint256 price, uint24 level)',
];

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Tests inject a fake via __setContractFactoryForTest; reset via
// __resetContractFactoryForTest. Mirrors Phase 60 / Phase 61 pattern.
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
  return new ethers.Contract(CONTRACTS.GAME, PASSES_ABI, signerOrProvider);
}

// ---------------------------------------------------------------------------
// Structured-revert-error helper — verbatim port of Phase 61 claims.js:111-119.
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
// purchaseWhaleBundle — BUY-02 — purchaseWhaleBundle(buyer, quantity) payable.
// ---------------------------------------------------------------------------

/**
 * @param {{quantity: number | bigint, msgValueWei: bigint | string | number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function purchaseWhaleBundle({ quantity, msgValueWei } = {}) {
  const buyer = get('connected.address');
  if (!buyer) throw new Error('Wallet not connected.');
  let qty;
  try {
    qty = BigInt(quantity);
  } catch (_e) {
    throw new Error('Quantity must be 1-100.');
  }
  if (qty < 1n || qty > 100n) throw new Error('Quantity must be 1-100.');
  const value = BigInt(msgValueWei ?? 0n);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  if (signer) {
    const c = _buildContract(signer);
    const sim = await requireStaticCall(c, 'purchaseWhaleBundle', [buyer, qty], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call purchaseWhaleBundle');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx((s) => _buildContract(s).purchaseWhaleBundle(buyer, qty, { value }), 'Buy whale pass');
  return { receipt };
}

// ---------------------------------------------------------------------------
// purchaseDeityPass — BUY-03 — purchaseDeityPass(buyer, symbolId) payable.
// ---------------------------------------------------------------------------

/**
 * @param {{symbolId: number, msgValueWei: bigint | string | number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function purchaseDeityPass({ symbolId, msgValueWei } = {}) {
  const buyer = get('connected.address');
  if (!buyer) throw new Error('Wallet not connected.');
  const sid = Number(symbolId);
  if (!Number.isInteger(sid) || sid < 0 || sid > 31) {
    throw new Error('Symbol must be 0-31.');
  }
  const value = BigInt(msgValueWei ?? 0n);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const c = _buildContract(signer);
    const sim = await requireStaticCall(c, 'purchaseDeityPass', [buyer, sid], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call purchaseDeityPass');
  }

  const receipt = await sendTx((s) => _buildContract(s).purchaseDeityPass(buyer, sid, { value }), 'Buy deity pass');
  return { receipt };
}

// ---------------------------------------------------------------------------
// deityPassErrorOverride — CONTEXT D-05 LOCKED panel-level 'E' decode override.
//
// WhaleModule.sol:546 throws `revert E()` when `deityBySymbol[symbolId] != 0`,
// so 'E' on the deity-pass path most-likely means "symbol taken." Other 'E'
// triggers (liveness, msg.value mismatch, symbolId out-of-range, buyer-already-
// owns) share the same copy in v4.6 — Pitfall 4 acknowledges this in Deferred
// Ideas (pre-render dim of taken symbols).
//
// The shared reason-map's 'E' registration retains the generic copy for
// non-deity contexts; this override is invoked ONLY in the deity-pass click
// handler at the panel level.
// ---------------------------------------------------------------------------

/**
 * @param {{code: string, userMessage: string, recoveryAction: string} | null | undefined} decoded
 * @returns {{code: string, userMessage: string, recoveryAction: string} | null | undefined}
 */
export function deityPassErrorOverride(decoded) {
  if (decoded?.code === 'E') {
    return {
      code: 'DeityPass-Taken',
      userMessage: "That symbol's taken — try another.",
      recoveryAction: 'Pick a different symbol.',
    };
  }
  return decoded;
}

// ---------------------------------------------------------------------------
// Reason-map registrations — Plan 62-02's 1 NEW code.
//
// Verified at degenerus-audit/contracts/storage/DegenerusGameStorage.sol:213
// (`error RngLocked();`). Phase 56 had it as a comment only per RESEARCH R11;
// deity-pass purchase can throw it during VRF cycles via the rngLockedFlag
// guard at WhaleModule.sol:543.
//
// DOES NOT register `Taken` or `InvalidToken` — Pitfall 3 confirms these are
// dead aliases for Phase 62 BUY paths. The deity-pass override lives at the
// panel/helper level via `deityPassErrorOverride`.
// ---------------------------------------------------------------------------

register('RngLocked', {
  code: 'RngLocked',
  userMessage: 'RNG is locked during settlement. Try again in a few minutes.',
  recoveryAction: 'Wait and retry.',
});
