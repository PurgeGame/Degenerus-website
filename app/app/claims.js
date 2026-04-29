// /app/app/claims.js — Phase 61 Plan 61-02 (CLM-03 write path).
//
// Multi-Prize Claim Tray write-path module. Three named exports wrap Phase 56
// requireStaticCall + decodeRevertReason and Phase 58 sendTx closure-form
// chokepoint. First production consumer of Phase 61's reason-map registrations
// (DecClaimInactive / DecAlreadyClaimed / DecNotWinner — verified from
// contracts/modules/DegenerusGameDecimatorModule.sol:280, 283, 294).
//
// Plan history:
//   - Plan 61-01: panel shell + spoiler gate + render gate + zero-state
//   - Plan 61-02: claims.js write path + per-row pending UX (THIS PLAN)
//   - Plan 61-03: 30s polling + visibility refresh + post-confirm debounce
//
// Does NOT cross-import /beta/app/contracts.js or /beta/app/constants.js — those
// use pre-resolved-promise sendTx (FORBIDDEN by Phase 58 closure-form gate) and
// /beta/app/constants.js:79 has a WRONG `claimCoinflips(address, address)`
// signature. Phase 61 defines ABI fragments INLINE using contract canonical
// signatures (verified at degenerus-audit/contracts/).
//
// MANDATORY closure form for every sendTx call (Phase 58 verified by grep gate):
//   CORRECT:   sendTx( (s) => new Contract(addr, ABI, s).method(args), 'Action' )
//   FORBIDDEN: sendTx( contract.method(args), 'Action' )   // captures stale signer
//
// D-05 LOCKED + Pitfall 11: claimWinnings is invoked with `connected.address`
// EXPLICITLY (not ZeroAddress) — view-mode disambiguation through the
// Phase 58 chokepoint's freshAddress equality guard.
//
// Pitfall 6: claimCoinflips(player, amount) — amount sourced from /pending's
// `pending.burnie.amount` field. NEVER the /beta address-cast trick (passing
// player-as-uint256 as the second arg to abuse the contract's clamp pattern).
//
// D-02 LOCKED: claimDecimatorLevels iterates levels sequentially. NO
// inter-tx pacing primitive between txes — `await tx.wait()` (inside sendTx)
// provides the natural pacing per Phase 60 mirror (RESEARCH.md correction
// over CONTEXT.md). On revert at level K, the structured-error throw escapes
// the loop; subsequent levels are NOT invoked (partial progress preserved).
// The helper accepts `levels` as-is — the panel pre-sorts ascending before
// calling.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';
import { get } from './store.js';

// ---------------------------------------------------------------------------
// Inline ABI fragments — canonical signatures verified against
// degenerus-audit/contracts/. DO NOT cross-import /beta/app/constants.js
// (its COINFLIP_ABI has the WRONG `(address, address)` form).
// ---------------------------------------------------------------------------

// Verified: degenerus-audit/contracts/DegenerusGame.sol:1387-1390 + 1252-1264.
const CLAIMS_ABI = [
  'function claimWinnings(address player) external',
  'function claimableWinningsOf(address player) view returns (uint256)',
];

// Verified: degenerus-audit/contracts/BurnieCoinflip.sol:332-337.
// CRITICAL: /beta/app/constants.js:79 has WRONG signature `(address, address)`.
// Phase 61 uses canonical `(address player, uint256 amount)`.
const COINFLIP_ABI = [
  'function claimCoinflips(address player, uint256 amount) external returns (uint256 claimed)',
];

// Verified: degenerus-audit/contracts/DegenerusGame.sol:1252-1264 (delegatecalls
// IDegenerusGameDecimatorModule.claimDecimatorJackpot — the entrypoint on the
// GAME contract takes the same uint24 lvl arg and dispatches via delegatecall).
const DECIMATOR_CLAIM_ABI = [
  'function claimDecimatorJackpot(uint24 lvl) external',
];

// ── Phase 62 / Plan 62-06 / AFF-03 — APPEND ─────────────────────────────
// Verified: degenerus-audit/contracts/DegenerusGame.sol:1426
//   function claimAffiliateDgnrs(address player) external
//
// Affiliate DGNRS commission claim — single tx, sweeps the connected user's
// pending affiliate-share DGNRS into their wallet. Mirrors claimEth shape
// (closure-form sendTx + requireStaticCall pre-flight + structured-revert
// error). Plan 62-06 adds NO new reason-map registrations on this path —
// inherited reverts from Phase 56 baseline + Phase 60 + Phase 61 cover it.
// (The 3 NEW codes Zero/Insufficient/InvalidKickback live in affiliate.js
// for the createAffiliateCode/Customize-CTA path, NOT this claim path.)
const AFFILIATE_DGNRS_ABI = [
  'function claimAffiliateDgnrs(address player) external',
];

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Tests inject a fake via __setContractFactoryForTest; reset via
// __resetContractFactoryForTest. Mirrors Phase 60 lootbox.js:67-82 pattern.
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

function _buildGameContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, CLAIMS_ABI, signerOrProvider);
}

function _buildCoinflipContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.COINFLIP, COINFLIP_ABI, signerOrProvider);
}

function _buildDecimatorContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, DECIMATOR_CLAIM_ABI, signerOrProvider);
}

// Plan 62-06 — affiliate DGNRS contract builder.
function _buildAffiliateDgnrsContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, AFFILIATE_DGNRS_ABI, signerOrProvider);
}

// ---------------------------------------------------------------------------
// Structured-revert-error helper — port of Phase 60 lootbox.js:90-98.
// Decodes via reason-map; wraps as Error with .code / .userMessage /
// .recoveryAction / .cause for downstream UI consumption.
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
// claimEth — claimWinnings(player) on the GAME contract.
// D-05 + Pitfall 11: pass `connected.address` EXPLICITLY (not ZeroAddress) so
// the contract's `_resolvePlayer(player)` returns the connected EOA and the
// Phase 58 freshAddress guard can verify wallet identity.
// ---------------------------------------------------------------------------

/**
 * @param {{player?: string}} [args]
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function claimEth({ player } = {}) {
  const playerArg = player ?? get('connected.address');
  if (!playerArg) throw new Error('Wallet not connected.');

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Static-call gate (Phase 56 D-05) — runs only when a signer is available.
  // Tests with provider===null skip this branch (gate validated in production).
  if (signer) {
    const contract = _buildGameContract(signer);
    const sim = await requireStaticCall(contract, 'claimWinnings', [playerArg], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call claimWinnings');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx((s) => _buildGameContract(s).claimWinnings(playerArg), 'Claim ETH winnings');
  return { receipt };
}

// ---------------------------------------------------------------------------
// claimBurnie — claimCoinflips(player, amount) on the COINFLIP contract.
// Pitfall 6: amount is the EXPLICIT /pending burnie.amount BigInt — never the
// /beta address-cast trick (passing player as uint256 to abuse the contract's
// clamp pattern at BurnieCoinflip.sol:399-402).
// ---------------------------------------------------------------------------

/**
 * @param {{player?: string, amount: bigint | string | number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function claimBurnie({ player, amount } = {}) {
  const playerArg = player ?? get('connected.address');
  if (!playerArg) throw new Error('Wallet not connected.');
  if (amount == null) throw new Error('Nothing to claim.');
  let amountBI;
  try {
    amountBI = BigInt(amount);
  } catch (_e) {
    throw new Error('Nothing to claim.');
  }
  if (amountBI === 0n) throw new Error('Nothing to claim.');

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const contract = _buildCoinflipContract(signer);
    const sim = await requireStaticCall(contract, 'claimCoinflips', [playerArg, amountBI], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call claimCoinflips');
  }

  const receipt = await sendTx((s) => _buildCoinflipContract(s).claimCoinflips(playerArg, amountBI), 'Claim BURNIE winnings');
  return { receipt };
}

// ---------------------------------------------------------------------------
// claimDecimatorLevels — sequential N=1 loop in caller-provided order.
//
// D-02 LOCKED: panel pre-sorts levels ascending before calling; helper accepts
// as-is (keeps the helper a pure executor — the panel knows the source of
// truth via dashboard.decimator.claimablePerLevel).
//
// On revert at level K:
//   - The structured-error throw escapes the loop.
//   - Levels K+1..N are NOT invoked (partial progress preserved).
//   - User re-clicks → next attempt sees `levels: [remaining]` from the
//     re-fetched dashboard (Plan 61-03 enables refetch).
//
// NO inter-tx pacing primitive between txes — `await tx.wait()` inside sendTx
// provides the natural pacing (RESEARCH.md correction over CONTEXT.md).
// onProgress is invoked twice per level (status 'pending' before sendTx,
// status 'confirmed' after).
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   player?: string,
 *   levels: Array<number | bigint>,
 *   onProgress?: (p: {done: number, total: number, status: 'pending' | 'confirmed', currentLevel: number | bigint}) => void
 * }} args
 * @returns {Promise<Array<{level: number | bigint, receipt: import('ethers').TransactionReceipt}>>}
 */
export async function claimDecimatorLevels({ player, levels, onProgress } = {}) {
  const playerArg = player ?? get('connected.address');
  if (!playerArg) throw new Error('Wallet not connected.');
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error('No levels to claim.');
  }

  const provider = getProvider();
  const total = levels.length;
  const results = [];

  for (let i = 0; i < total; i++) {
    const lvl = levels[i];
    onProgress?.({ done: i, total, status: 'pending', currentLevel: lvl });

    const signer = provider ? await provider.getSigner() : null;
    if (signer) {
      const c = _buildDecimatorContract(signer);
      const sim = await requireStaticCall(c, 'claimDecimatorJackpot', [lvl], signer);
      if (!sim.ok) {
        throw _structuredRevertError(
          sim.error,
          `static-call claimDecimatorJackpot(${lvl})`
        );
      }
    }

    const receipt = await sendTx((s) => _buildDecimatorContract(s).claimDecimatorJackpot(lvl), `Claim decimator level ${lvl}`);
    results.push({ level: lvl, receipt });
    onProgress?.({ done: i + 1, total, status: 'confirmed', currentLevel: lvl });
    // No inter-tx pacing primitive — `await tx.wait()` (inside sendTx) is the
    // natural pacing (RESEARCH.md Pattern 1 confirmed; Phase 60 mirror).
  }
  return results;
}

// ---------------------------------------------------------------------------
// Plan 62-06 / AFF-03 — claimAffiliateDgnrs(player) on the GAME contract.
//
// Single-tx sweep of the connected user's pending affiliate-share DGNRS.
// D-05 + Pitfall 11: pass `connected.address` EXPLICITLY (not ZeroAddress)
// so the contract's internal `_resolvePlayer(player)` returns the connected
// EOA and the Phase 58 freshAddress guard verifies wallet identity.
//
// AFF-03 dispatches from <app-claims-panel> via VISIBLE_PRIZE_KEYS extension
// in Plan 62-06. Phase 61's render gate (`amount > 0`) accepts the affiliate
// row naturally; Phase 62-00's /pending response carries `affiliate.amount`
// (forward-debt FD-2 surfaces as `'0'` until indexer aggregation closes).
// ---------------------------------------------------------------------------

/**
 * @param {{player?: string}} [args]
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function claimAffiliateDgnrs({ player } = {}) {
  const playerArg = player ?? get('connected.address');
  if (!playerArg) throw new Error('Wallet not connected.');

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  // Static-call gate (Phase 56 D-05) — runs only when a signer is available.
  if (signer) {
    const c = _buildAffiliateDgnrsContract(signer);
    const sim = await requireStaticCall(c, 'claimAffiliateDgnrs', [playerArg], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call claimAffiliateDgnrs');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => _buildAffiliateDgnrsContract(s).claimAffiliateDgnrs(playerArg),
    'Claim affiliate DGNRS',
  );
  return { receipt };
}

// ---------------------------------------------------------------------------
// Reason-map registrations — Plan 61-02's 3 NEW codes.
//
// Verified at degenerus-audit/contracts/modules/DegenerusGameDecimatorModule.sol:
//   - DecClaimInactive   line 280: `if (round.poolWei == 0) revert DecClaimInactive();`
//   - DecAlreadyClaimed  line 283: `if (e.claimed != 0) revert DecAlreadyClaimed();`
//   - DecNotWinner       line 294: `if (amountWei == 0) revert DecNotWinner();`
//
// DOES NOT register `NotClaimable` (Pitfall 10 — does not exist as contract
// error on this path). DOES NOT register `WindowClosed` / `RngNotReady` for
// claim path (already in Phase 56 baseline for buy paths; not thrown by
// Phase 61 claim functions per RESEARCH §7).
// ---------------------------------------------------------------------------

register('DecClaimInactive', {
  code: 'DecClaimInactive',
  userMessage: 'Decimator claim is not active for this level yet.',
  recoveryAction: 'Wait until the level resolves; the row will reappear when ready.',
});

register('DecAlreadyClaimed', {
  code: 'DecAlreadyClaimed',
  userMessage: 'You already claimed this decimator level.',
  recoveryAction: 'Refresh the page; the row should disappear.',
});

register('DecNotWinner', {
  code: 'DecNotWinner',
  userMessage: 'Your subbucket did not win this decimator round.',
  recoveryAction: 'No claim available for this level.',
});
