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
// `pending.flip.amount` field. NEVER the /beta address-cast trick (passing
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
import { get, getActingAddress } from './store.js';
import { permissionlessReadProvider, readContractStorage } from './read-provider.js';

// ---------------------------------------------------------------------------
// Inline ABI fragments — canonical signatures verified against
// degenerus-audit/contracts/. DO NOT cross-import /beta/app/constants.js
// (its COINFLIP_ABI has the WRONG `(address, address)` form).
// ---------------------------------------------------------------------------

// Verified: degenerus-audit/contracts/DegenerusGame.sol:1387-1390 + 1252-1264.
const CLAIMS_ABI = [
  'function claimWinnings(address player) external',
  'function claimableWinningsOf(address player) view returns (uint256)',
  'function claimWhalePass(address player) external',
  'function whalePassClaimAmount(address player) view returns (uint256)',
];

// Keep the partial overload in its own ABI. Ethers can address overloaded
// methods by signature, but a one-fragment contract also keeps injected test
// doubles and wallet simulation straightforward.
const PARTIAL_CLAIMS_ABI = [
  'function claimWinnings(address player, uint256 amount) external',
];

// Verified: degenerus-audit/contracts/Coinflip.sol:332-337.
// CRITICAL: /beta/app/constants.js:79 has WRONG signature `(address, address)`.
// Phase 61 uses canonical `(address player, uint256 amount)`.
const COINFLIP_ABI = [
  'function claimCoinflips(address player, uint256 amount) external returns (uint256 claimed)',
];

// Verified: degenerus-audit/contracts/DegenerusGame.sol:1252-1264 (delegatecalls
// IDegenerusGameDecimatorModule.claimDecimatorJackpot — redeploy #7 surface
// takes (address player, uint24 lvl); the GAME entrypoint dispatches via
// delegatecall.
const DECIMATOR_CLAIM_ABI = [
  'function claimDecimatorJackpot(address player, uint24 lvl) external',
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
  'error AlreadyClaimed()',
];

const AFFILIATE_DGNRS_BATCH_ABI = [
  'function claimAffiliateDgnrs(address[] affiliates) external',
];

const GOLDEN_TICKET_ABI = [
  'function claimGoldenTicket(address player, uint24 level) external',
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

function _buildPartialGameContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, PARTIAL_CLAIMS_ABI, signerOrProvider);
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

function _buildAffiliateDgnrsBatchContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, AFFILIATE_DGNRS_BATCH_ABI, signerOrProvider);
}

function _buildGoldenTicketContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, GOLDEN_TICKET_ABI, signerOrProvider);
}

function _claimsReadProvider() {
  const wallet = getProvider();
  if (_contractFactory && !wallet) return null;
  return permissionlessReadProvider(wallet);
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
 * Chain truth for the ETH-winnings row: `claimableWinningsOf(player)`.
 *
 * The indexer's /pending rollup is derived from events and can disagree with
 * the chain (a claim it has not indexed yet, a mis-tallied reward). Offering a
 * claim off a stale rollup makes the button revert NothingToClaim(), so callers
 * that build a work list check here first. Returns null when there is no
 * provider or the read fails — "unknown", which is NOT "zero".
 *
 * @param {{player?: string}} [args]
 * @returns {Promise<bigint|null>}
 */
export async function readClaimableEth({ player } = {}) {
  const playerArg = player ?? getActingAddress();
  if (!playerArg) return null;
  const provider = _claimsReadProvider();
  if (!provider) return null;
  try {
    const contract = _buildGameContract(provider);
    return BigInt(await contract.claimableWinningsOf(playerArg));
  } catch (_e) {
    return null;
  }
}

/**
 * Authoritative deferred whale-pass balance for `player`.
 *
 * Jackpot-awarded whale-pass halves are held in `whalePassClaims` until the
 * permissionless claim turns them into the player's 100-level ticket stream.
 * This read deliberately bypasses the indexer: a valid on-chain claim must
 * still appear in Pending while database event tables are being repaired.
 * Returns null for an unavailable/failed read, never a fabricated zero.
 *
 * @param {{player?: string}} [args]
 * @returns {Promise<bigint|null>}
 */
export async function readWhalePassClaimAmount({ player } = {}) {
  const playerArg = player ?? getActingAddress();
  if (!playerArg) return null;
  const provider = _claimsReadProvider();
  if (!provider) return null;
  try {
    const contract = _buildGameContract(provider);
    return BigInt(await contract.whalePassClaimAmount(playerArg));
  } catch (_e) {
    return null;
  }
}

/**
 * @param {{player?: string}} [args]
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function claimEth({ player } = {}) {
  const playerArg = player ?? getActingAddress();
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

/**
 * Claim at most `amount` wei from the player's accrued ETH balance. The
 * contract clamps to the currently available amount and retains its 1-wei
 * storage sentinel. A partial cashout intentionally follows the same curse
 * rules as a full cashout.
 *
 * @param {{player?: string, amount: bigint|string|number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function claimEthAmount({ player, amount } = {}) {
  const playerArg = player ?? getActingAddress();
  if (!playerArg) throw new Error('Wallet not connected.');
  let amountBI;
  try { amountBI = BigInt(amount); }
  catch (_e) { throw new Error('Enter an ETH amount to claim.'); }
  if (amountBI <= 0n) throw new Error('Enter an ETH amount to claim.');

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _buildPartialGameContract(signer);
    const sim = await requireStaticCall(
      contract,
      'claimWinnings',
      [playerArg, amountBI],
      signer,
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call partial claimWinnings');
  }

  const receipt = await sendTx(
    (s) => _buildPartialGameContract(s).claimWinnings(playerArg, amountBI),
    'Claim ETH winnings',
  );
  return { receipt };
}

/**
 * Materialize jackpot-awarded whale-pass halves for `player`.
 *
 * The GAME entrypoint is intentionally permissionless: the tickets are always
 * credited to `player`, never to the caller. The UI still supplies the current
 * acting player explicitly so self/operator mode cannot drift during a wallet
 * interaction.
 *
 * @param {{player?: string}} [args]
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt, player: string}>}
 */
export async function claimWhalePass({ player } = {}) {
  const playerArg = player ?? getActingAddress();
  if (!playerArg) throw new Error('Wallet not connected.');

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _buildGameContract(signer);
    const sim = await requireStaticCall(contract, 'claimWhalePass', [playerArg], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call claimWhalePass');
  }

  const receipt = await sendTx(
    (s) => _buildGameContract(s).claimWhalePass(playerArg),
    'Claim whale pass',
  );
  return { receipt, player: playerArg };
}

// ---------------------------------------------------------------------------
// claimFlip — claimCoinflips(player, amount) on the COINFLIP contract.
// Pitfall 6: amount is the EXPLICIT /pending flip.amount BigInt — never the
// /beta address-cast trick (passing player as uint256 to abuse the contract's
// clamp pattern at Coinflip.sol:399-402).
// ---------------------------------------------------------------------------

/**
 * @param {{player?: string, amount: bigint | string | number}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function claimFlip({ player, amount } = {}) {
  const playerArg = player ?? getActingAddress();
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

  const receipt = await sendTx((s) => _buildCoinflipContract(s).claimCoinflips(playerArg, amountBI), 'Claim FLIP winnings');
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
  const playerArg = player ?? getActingAddress();
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
      const sim = await requireStaticCall(c, 'claimDecimatorJackpot', [playerArg, lvl], signer);
      if (!sim.ok) {
        throw _structuredRevertError(
          sim.error,
          `static-call claimDecimatorJackpot(${lvl})`
        );
      }
    }

    const receipt = await sendTx((s) => _buildDecimatorContract(s).claimDecimatorJackpot(playerArg, lvl), `Claim decimator level ${lvl}`);
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
  const playerArg = player ?? getActingAddress();
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

/**
 * Settle many current-level affiliate bonuses in one permissionless call.
 * The contract catches an ineligible/already-claimed address per item, so a
 * stale community work list cannot revert every other valid settlement.
 *
 * @param {{players: string[]}} args
 */
export async function claimAffiliateDgnrsBatch({ players } = {}) {
  const unique = [...new Set(
    (Array.isArray(players) ? players : [])
      .filter(Boolean)
      .map((value) => String(value).toLowerCase()),
  )];
  if (unique.length === 0) throw new Error('No affiliate bonuses to process.');
  const receipt = await sendTx(
    (s) => _buildAffiliateDgnrsBatchContract(s).claimAffiliateDgnrs(unique),
    `Process ${unique.length} affiliate bonus${unique.length === 1 ? '' : 'es'}`,
  );
  return { receipt, players: unique };
}

/** Permissionlessly settle one resolved foil-pack Golden Ticket ladder. */
export async function claimGoldenTicket({ player, level } = {}) {
  const playerArg = player ?? getActingAddress();
  if (!playerArg) throw new Error('Wallet not connected.');
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < 0) throw new Error('Invalid Golden Ticket level.');

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _buildGoldenTicketContract(signer);
    const sim = await requireStaticCall(contract, 'claimGoldenTicket', [playerArg, lvl], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call claimGoldenTicket');
  }
  const receipt = await sendTx(
    (s) => _buildGoldenTicketContract(s).claimGoldenTicket(playerArg, lvl),
    `Claim level ${lvl} Golden Ticket`,
  );
  return { receipt, level: lvl };
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

// GAME claimWinnings / claim paths, selector 0x969bf728. Left unmapped this read
// as the UNKNOWN catch-all's "unexpected error", which is how a claim offered off
// a stale indexer rollup looked like a broken button (2026-07-29).
register('NothingToClaim', {
  code: 'NothingToClaim',
  userMessage: 'Nothing to claim right now.',
  recoveryAction: 'The list was out of date — it refreshes automatically.',
});

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

// ---------------------------------------------------------------------------
// Task (purchase widgets) — redeemFlip: FLIP → tickets, window-gated.
//
// Verified: degenerus-audit/contracts/DegenerusGame.sol:685 →
//   modules/DegenerusGameMintModule.sol:931 redeemFlip(buyer, entryQuantityScaled)
// entryQuantityScaled is in purchase units: 4 * QTY_SCALE = 400 = ONE whole
// ticket (MintModule.sol:148). ticketRedemptionOpen is an internal packed latch:
// once opened by the pool predicate it remains open through intermediate RNG
// locks and is cleared only by the final request. Read that byte directly so
// visibility mirrors _redeemFlipFor rather than inferring it from phase labels.
// ---------------------------------------------------------------------------

const REDEEM_FLIP_ABI = [
  'function redeemFlip(address buyer, uint256 entryQuantityScaled) external',
  'function rngLocked() external view returns (bool)',
  'function livenessTriggered() external view returns (bool)',
  'function nextPrizePoolView() external view returns (uint256)',
  'function prizePoolTargetView() external view returns (uint256)',
];

function _buildRedeemFlipContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.GAME, REDEEM_FLIP_ABI, signerOrProvider);
}

export const ENTRIES_SCALED_PER_TICKET = 400n;  // 4 entries × QTY_SCALE 100

// FLIP charged per whole ticket. Contract:
//   coinCost = (entryQuantityScaled * (PRICE_COIN_UNIT / 4)) / QTY_SCALE
// (DegenerusGameMintModule.sol:1997) with PRICE_COIN_UNIT = 1000 ether
// (DegenerusGameStorage.sol:162), so 400 units → 1000 FLIP and the price is flat
// across levels — unlike the ETH ticket price. FLIP is UNSCALED on testnet (only
// ETH is /1M-scaled), so no ETH_DIVISOR here.
const PRICE_COIN_UNIT_WEI = 1000n * (10n ** 18n);
const QTY_SCALE = 100n;
const REDEEM_FLIP_STORAGE_SLOT = 0;
const TICKET_REDEMPTION_OPEN_SHIFT = 30n * 8n;
const PACKED_BYTE_MASK = 0xffn;

async function _readTicketRedemptionOpen(provider) {
  const raw = await readContractStorage(
    CONTRACTS.GAME,
    REDEEM_FLIP_STORAGE_SLOT,
    { provider },
  );
  return ((BigInt(raw) >> TICKET_REDEMPTION_OPEN_SHIFT) & PACKED_BYTE_MASK) !== 0n;
}

/**
 * Purchase units for a ticket count, snapped to the entry (0.25 tickets).
 * Mirrors lootbox.js entriesScaledFromTickets; duplicated rather than imported
 * to keep claims.js free of cross-module coupling (see the header note).
 * Falls back to one whole ticket for blank/garbage input, matching the
 * historical `Math.max(1, …)` clamp these helpers shipped with.
 */
function _entriesScaled(tickets) {
  const t = Number(tickets);
  if (!Number.isFinite(t) || t <= 0) return ENTRIES_SCALED_PER_TICKET;
  const units = BigInt(Math.round(t * 4)) * QTY_SCALE;
  return units > 0n ? units : ENTRIES_SCALED_PER_TICKET;
}

/**
 * Exactly what redeemFlip will burn for `tickets`, in FLIP wei.
 * @param {number} tickets
 * @returns {bigint}
 */
export function flipCostFromTickets(tickets) {
  return (_entriesScaled(tickets) * (PRICE_COIN_UNIT_WEI / 4n)) / QTY_SCALE;
}

/**
 * Read whether the contract's FLIP-for-tickets window is open without using
 * the player's FLIP balance as a proxy. Mirrors _redeemFlipFor exactly:
 *   !livenessTriggered &&
 *   (ticketRedemptionOpen || (!rngLocked && nextPrizePool > prizePoolTarget))
 *
 * Read-only; never throws. A failed RPC read is treated as unknown/closed so a
 * stale control cannot invite a write against an unverified window.
 *
 * @returns {Promise<boolean>}
 */
export async function probeRedeemFlipWindow() {
  try {
    const provider = _claimsReadProvider();
    if (!provider) return false;
    const contract = _buildRedeemFlipContract(provider);

    const [liveness, redemptionOpen, locked, nextPool, target] = await Promise.all([
      contract.livenessTriggered(),
      _readTicketRedemptionOpen(provider),
      contract.rngLocked(),
      contract.nextPrizePoolView(),
      contract.prizePoolTargetView(),
    ]);
    return !Boolean(liveness)
      && (redemptionOpen || (!Boolean(locked) && BigInt(nextPool) > BigInt(target)));
  } catch (_e) {
    return false;
  }
}

/**
 * Probe whether redeemFlip would succeed for this player/quantity right now.
 * Read-only (staticCall from the provider); never throws.
 *
 * This is an amount-specific affordability/execution probe. Do not use it to
 * decide whether the control is visible: an insufficient player balance and a
 * closed window deliberately share the same generic E() revert. Visibility is
 * driven by probeRedeemFlipWindow(); submit-time validation uses this path.
 *
 * @param {{player?: string, tickets?: number}} [args]
 * @returns {Promise<boolean>}
 */
export async function probeRedeemFlip({ player, tickets = 1 } = {}) {
  const playerArg = player ?? getActingAddress();
  if (!playerArg) return false;
  try {
    const provider = getProvider();
    if (!provider) return false;
    const contract = _buildRedeemFlipContract(provider);
    await contract.redeemFlip.staticCall(playerArg, _entriesScaled(tickets));
    return true;
  } catch (_e) {
    return false;  // window closed / insufficient FLIP / no RPC — not redeemable
  }
}

/**
 * @param {{player?: string, tickets?: number}} [args]
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function redeemFlip({ player, tickets = 1 } = {}) {
  const playerArg = player ?? getActingAddress();
  if (!playerArg) throw new Error('Wallet not connected.');
  const qty = _entriesScaled(tickets);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const contract = _buildRedeemFlipContract(signer);
    const sim = await requireStaticCall(contract, 'redeemFlip', [playerArg, qty], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call redeemFlip');
  }

  const receipt = await sendTx(
    (s) => _buildRedeemFlipContract(s).redeemFlip(playerArg, qty),
    'Redeem FLIP for tickets',
  );
  return { receipt };
}
