// /app/app/lootbox.js — Phase 60 Plan 60-02 (LBX-01 + LBX-04 write path).
//
// First production consumer of Phase 56 (static-call + reason-map + scaling) and
// Phase 58 (sendTx chokepoint + requireSelf guard) primitives end-to-end on a write
// surface. Generalizes /beta/mint.js:1110-1119 receipt-log-parsing pattern into
// reusable parsers for LootBoxIdx (purchase event) + TraitsGenerated (open event).
//
// Plan 60-02 ships the helpers; Plan 60-03 wires RNG polling lifecycle + Open click
// → reveal animation. Plan 60-04 adds chainId-scoped localStorage idempotency +
// boot CTA + URL-param affiliate read.
//
// CONTEXT D-01 + D-02 + D-04 wave shape; CONTEXT D-03 receipt-log-first reveal pattern.
//
// MANDATORY closure form for every sendTx call (Phase 58 verified by grep gate):
//   CORRECT:   sendTx( (s) => new Contract(addr, ABI, s).method(args), 'Action' )
//   FORBIDDEN: passing a pre-resolved tx promise — captures stale signer.

import {
  sendTx, getProvider, ethers, requireSelf, gasEstimateWithHeadroom,
} from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { getActingAddress } from './store.js';
import { CONTRACTS, CHAIN, ETH_DIVISOR } from './chain-config.js';

// Foil-leg revert reasons (DegenerusGameFoilPackModule.sol) — register both
// their ABI names and raw selectors. Delegatecall reverts are not decoded by
// every wallet/provider, so the selector path keeps the live pre-flight useful
// even when ethers only receives `error.data`.
function _registerFoilError(name, mapping) {
  register(name, mapping);
  register(ethers.id(`${name}()`).slice(0, 10), mapping);
}

_registerFoilError('FoilAlreadyBought', {
  code: 'FoilAlreadyBought',
  userMessage: 'Foil pack purchase is unavailable for this transaction.',
  recoveryAction: 'Refresh the level and try again.',
});
// The foil leg no longer has a shortfall error of its own. Audit c19a1088 routed it
// through the canonical spend waterfall (_settleShortfall: claimable — skipped on
// DirectEth — then prepaid AFKing), which reverts the SHARED `Insolvent()` when the
// tiers together fall short; `DirectEthInsufficient()` was deleted from the module and
// can never fire again. `Insolvent` already has a name mapping from passes.js and the
// registry is last-write-wins, so only the SELECTOR form is added here — a delegatecall
// revert often reaches us as raw `error.data` with no name attached.
register(ethers.id('Insolvent()').slice(0, 10), {
  code: 'Insolvent',
  userMessage: "Your available balance doesn't cover this purchase.",
  recoveryAction: 'Refresh and retry — the level price may have just changed.',
});
_registerFoilError('StaleAdvance', {
  code: 'StaleAdvance',
  userMessage: 'Foil packs are paused until the game catches up on processing.',
  recoveryAction: 'Try again in a few minutes.',
});

// Phase 63 Plan 63-02 (D-02 LOCKED) — pre-warm cache TTL.
// CONTEXT specifics line 268 — 30s matches Phase 56 polling baseline.
// Caller (app-packs-panel.js) compares Date.now() vs returned `expiresAt`
// and falls back to the legacy await sendTx path on stale cache (R11).
const PREWARM_TTL_MS = 30_000;

// DegenerusGameStorage.lootboxRngPacked is slot 33 in both the production and
// testnet layouts. The deployed GAME intentionally exposes no getter for this
// operational queue, so the UI reads the packed slot directly just as the
// Reverse FLIP and redemption readers do for their deployment-pinned fields.
// Layout (DegenerusGameStorage.sol): index [0:47], pending ETH [48:111],
// threshold [112:175], max basefee [176:183], pending FLIP [184:223].
const LOOTBOX_RNG_STORAGE_SLOT = 33n;
const GAME_TIMING_STORAGE_SLOT = 0n;
const UINT48_MASK = (1n << 48n) - 1n;
const UINT64_MASK = (1n << 64n) - 1n;
const UINT40_MASK = (1n << 40n) - 1n;
const RNG_REQUEST_TIME_SHIFT = 48n;
const RNG_LOCKED_SHIFT = 152n;
const LR_PENDING_ETH_SHIFT = 48n;
const LR_THRESHOLD_SHIFT = 112n;
const LR_PENDING_FLIP_SHIFT = 184n;
const MILLI_ETH_WEI = 10n ** 15n;
let _rngQueueReadProvider = null;

// ---------------------------------------------------------------------------
// GAME_ABI fragment — minimal human-readable ABI, reconciled against the
// Base Sepolia redeploy #7 GAME ABI (degenerus-sim/deployments/abis/GAME.json):
//   - purchase(buyer, ticketQuantity, lootBoxAmount, affiliateCode, payKind, foil)
//   - openBox(player, index)            — renamed from openLootBox
//   - boxIndexComplete(index)           — conservative swept-index view
//   - requestLootboxRng()               — permissionless mid-day RNG request
//   - LootBoxBuy / LootBoxIdx / TraitsGenerated events unchanged
//
// NOTE: Lootboxes are ETH-denominated, and FLIP-paid ticket purchases are gone too
// (purchaseCoin was removed on-chain; MintPaymentKind = {DirectEth, Claimable,
// Combined, Internal}). Lootboxes still PAY OUT FLIP as prizes.
// ---------------------------------------------------------------------------

export const GAME_ABI = [
  // Writes — Base Sepolia redeploy #7 surface (2026-07-02):
  //   purchase gained a trailing `bool foil` (the foil-pack leg — an ADDITIVE leg at
  //   FOIL_PACK_TICKETS × priceForLevel(target) on top of tickets/lootboxes; see
  //   DegenerusGame._purchaseWithFoil), purchaseCoin (FLIP-paid tickets) was REMOVED
  //   on-chain, and openLootBox was renamed openBox (same (address, uint48) shape).
  'function purchase(address buyer, uint256 ticketQuantity, uint256 lootBoxAmount, bytes32 affiliateCode, uint8 payKind, bool foil) payable',
  'function openBox(address player, uint48 index)',
  // The raw lootbox RNG mapping is intentionally not exposed by the deployed
  // GAME. Readiness is probed with the exact write as eth_call; this avoids the
  // stale `lootboxRngWordByIndex` selector that silently reverted in production.
  'function boxIndexComplete(uint48 index) view returns (bool complete)',
  'function requestLootboxRng()',
  'function lootboxStatus(address player, uint48 lootboxIndex) view returns (uint256 amount, bool presale)',
  'function lootboxPresaleActiveFlag() view returns (bool active)',
  'function presaleBoxCreditOf(address player) view returns (uint256 credit)',
  'function presaleBoxEthRemaining() view returns (uint256 remaining)',
  'function claimableWinningsOf(address player) view returns (uint256)',
  'function afkingFundingOf(address player) view returns (uint256)',
  'function purchaseInfo() view returns (uint24 lvl, bool inJackpotPhase, bool lastPurchaseDay_, bool rngLocked_, uint256 priceWei)',
  'function buyPresaleBox(address buyer, uint256 boxAmount) payable',
  'function buyLootboxAndPresaleBox(address buyer, uint256 entryQuantityScaled, uint256 lootBoxAmount, bytes32 affiliateCode, uint8 payKind, uint256 boxAmount) payable',
  // Foil module errors bubble through GAME.purchase via delegatecall. Keeping
  // them in this interface lets ethers populate error.revert.name.
  'error FoilAlreadyBought()',
  'error Insolvent()',
  'error StaleAdvance()',
  // Events
  // Current deploy: the queue index moved directly onto LootBoxBuy and the
  // redundant LootBoxIdx event was removed. Keep LootBoxIdx below solely so a
  // cached receipt from an older run can still be decoded safely.
  'event LootBoxBuy(address indexed buyer, uint48 indexed index, uint256 amount)',
  'event LootBoxIdx(address indexed buyer, uint32 indexed index, uint32 indexed day)',
  'event PresaleBoxBuy(address indexed buyer, uint48 indexed index, uint256 amount, bool closing)',
  'event PresaleBoxOpened(address indexed player, uint48 indexed index, uint256 amount, uint256 flip, uint256 dgnrs, uint256 wwxrp, bool closing)',
  'event TraitsGenerated(address indexed player, uint24 indexed level, uint32 queueIdx, uint32 startIndex, uint32 count, uint256 entropy)',
  'event FoilPackBought(address indexed buyer, uint24 indexed level, uint16 multBps, uint256 weiIn)',
];

// ---------------------------------------------------------------------------
// Constants — verified from contracts/modules/DegenerusGameMintModule.sol:99-101
// and contracts/interfaces/IDegenerusGame.sol:6.
// ---------------------------------------------------------------------------

/** MintPaymentKind values from IDegenerusGame.sol. */
export const MINT_PAYMENT_KIND_DIRECT_ETH = 0;
export const MINT_PAYMENT_KIND_CLAIMABLE = 1;
export const MINT_PAYMENT_KIND_COMBINED = 2;
export const PURCHASE_FUNDING_PRIORITY_KEY = `purchase-funding-priority:${CHAIN.id}`;
export const PURCHASE_USE_AFKING_KEY = `purchase-use-afking:${CHAIN.id}`;
let _purchaseFundingPriorityMemory = 'claimable';
let _purchaseUseAfkingMemory = true;

/** Shared ETH funding preference used by purchases and Degenerette wagers. */
export function readPurchaseFundingPriority() {
  try {
    const stored = localStorage.getItem(PURCHASE_FUNDING_PRIORITY_KEY);
    _purchaseFundingPriorityMemory = stored === 'wallet' || stored === 'afking'
      ? stored
      : 'claimable';
    return _purchaseFundingPriorityMemory;
  } catch (_e) {
    return _purchaseFundingPriorityMemory;
  }
}

export function writePurchaseFundingPriority(priority) {
  _purchaseFundingPriorityMemory = priority === 'wallet' || priority === 'afking'
    ? priority
    : 'claimable';
  try {
    localStorage.setItem(
      PURCHASE_FUNDING_PRIORITY_KEY,
      _purchaseFundingPriorityMemory,
    );
  } catch (_e) { /* private mode: shared in-memory choice remains authoritative */ }
}

/** Whether manual ETH purchases may draw the acting player's prepaid AFKing funds. */
export function readPurchaseUseAfking() {
  try {
    const stored = localStorage.getItem(PURCHASE_USE_AFKING_KEY);
    _purchaseUseAfkingMemory = stored == null ? true : stored === '1';
    return _purchaseUseAfkingMemory;
  } catch (_e) {
    return _purchaseUseAfkingMemory;
  }
}

export function writePurchaseUseAfking(enabled) {
  _purchaseUseAfkingMemory = enabled !== false;
  try { localStorage.setItem(PURCHASE_USE_AFKING_KEY, _purchaseUseAfkingMemory ? '1' : '0'); }
  catch (_e) { /* private mode: shared in-memory choice remains authoritative */ }
}
/** Foil pack = ten ticket prices at the target level (DegenerusGameStorage.sol:2552). */
export const FOIL_PACK_TICKETS = 10n;
/** Lower bound on lootBoxAmount in ETH purchases (LOOTBOX_MIN = 0.01 ether). */
// Contract minimum lootbox spend is 0.01 ether IN THE DEPLOYED CONTRACT'S
// SCALE — the testnet contracts are compiled /1M-scaled, so the on-chain
// minimum is 1e10 wei, not 1e16 (Phase 64 fix: sending the full-scale value
// silently overpaid 1M× into the buyer's afking credit).
export const LOOTBOX_MIN_WEI = ethers.parseEther('0.01') / ETH_DIVISOR;
/** Credit-gated presale boxes use the same 0.01 ETH-scaled minimum. */
export const PRESALE_BOX_MIN_WEI = LOOTBOX_MIN_WEI;

// ---------------------------------------------------------------------------
// scaledTicketPriceWei — JS port of PriceLookupLib.priceForLevel (verified at
// contracts/libraries/PriceLookupLib.sol:21-41), divided by ETH_DIVISOR so the
// result is in the deployed contract's wei scale. The contract charges
// priceForLevel(_activeTicketLevel()) per whole ticket
// (DegenerusGameMintModule._purchaseCostInputs); callers get that level from
// app/active-level.js, NOT from a `jackpotPhase ? level : level + 1` shorthand.
// ---------------------------------------------------------------------------

export function scaledTicketPriceWei(targetLevel) {
  const lvl = Number(targetLevel);
  const ETHER = 10n ** 18n;
  let full;
  if (lvl < 5) full = ETHER / 100n;                 // 0.01 ether
  else if (lvl < 10) full = 2n * ETHER / 100n;      // 0.02 ether
  else {
    const cycleOffset = lvl % 100;
    if (cycleOffset === 0) {
      full = 24n * ETHER / 100n;                    // 0.24 ether milestone
    } else {
      const mult = (0x4333222111n >> (BigInt(Math.floor(cycleOffset / 10)) * 4n)) & 0xFn;
      full = 4n * ETHER / 100n * mult;              // 0.04 ether × decade tier
    }
  }
  return full / ETH_DIVISOR;
}

/**
 * Foil-pack cost at the target level, in the deployed contract's wei scale.
 * Contract: cost = FOIL_PACK_TICKETS × priceForLevel(lvl) — an ADDITIVE leg on
 * the purchase cost; claimable-first funding decides how much of that total is
 * recycled and how much must ride as msg.value.
 */
export function scaledFoilPackCostWei(targetLevel) {
  return FOIL_PACK_TICKETS * scaledTicketPriceWei(targetLevel);
}

/** Foil cost from the contract's exact routed buy-now ticket price. */
export function foilPackCostFromPriceWei(priceWei) {
  let price;
  try { price = BigInt(priceWei ?? 0n); } catch (_e) { return 0n; }
  return price > 0n ? FOIL_PACK_TICKETS * price : 0n;
}

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Tests inject a fake via __setContractFactoryForTest; reset via __resetContractFactoryForTest.
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
  return new ethers.Contract(CONTRACTS.GAME, GAME_ABI, signerOrProvider);
}

function _publicLootboxReadProvider() {
  if (!_rngQueueReadProvider && CHAIN.rpcUrl) {
    _rngQueueReadProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 1 },
    );
  }
  return _rngQueueReadProvider;
}

function _readBuyer() {
  // getActingAddress() → connected in 'self', viewed owner in 'operator', null
  // in 'view'/'combined' (read-only). purchase/openBox take a player/buyer arg
  // the contract resolves via _resolvePlayer, so an approved operator buys/opens
  // on the owner's behalf. The Phase 58 sendTx freshAddress guard still pins the
  // signer to the connected operator.
  const buyer = getActingAddress();
  if (!buyer) throw new Error('Wallet not connected.');
  return buyer;
}

/**
 * Exact buy-now quote from the deployed route. Unlike the API phase snapshot,
 * priceWei already accounts for a final sealed RNG window routing Level N
 * purchases into Level N+1.
 */
export async function readPurchaseQuote() {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const contract = _buildContract(provider);
    if (typeof contract.purchaseInfo !== 'function') return null;
    const raw = await contract.purchaseInfo();
    const currentLevel = Number(raw?.lvl ?? raw?.[0]);
    const priceWei = BigInt(raw?.priceWei ?? raw?.[4] ?? 0n);
    if (!Number.isInteger(currentLevel) || currentLevel < 0 || priceWei <= 0n) return null;
    return {
      currentLevel,
      inJackpotPhase: Boolean(raw?.inJackpotPhase ?? raw?.[1]),
      lastPurchaseDay: Boolean(raw?.lastPurchaseDay_ ?? raw?.[2]),
      rngLocked: Boolean(raw?.rngLocked_ ?? raw?.[3]),
      priceWei,
    };
  } catch (_e) {
    return null;
  }
}

/**
 * Ask the deployed purchase route whether the acting buyer can add a foil pack
 * right now. A zero-value DirectEth probe is deliberately unaffordable: the
 * foil module reaches its PAYMENT stage only after all availability, liveness,
 * routing, and one-per-level checks have passed, so a shortfall revert there is
 * proof the route itself is open.
 *
 * Since audit c19a1088 that shortfall surfaces as the shared `Insolvent()` — the
 * canonical waterfall's revert — rather than the deleted `DirectEthInsufficient()`.
 * DirectEth skips the claimable tier, so a buyer with no prepaid AFKing lands on
 * Insolvent; a buyer holding enough AFKing instead SUCCEEDS the static call and is
 * caught by the success path above (the staticCall commits nothing either way).
 *
 * Success is accepted as well for forward compatibility with a zero-priced
 * deployment. Every other revert (including FoilAlreadyBought, StaleAdvance,
 * GameOver/liveness, and authorization failures) fails closed.
 *
 * Detailed form used by UI that needs to distinguish a permanent ownership
 * rejection from a temporary liveness/RPC miss. The boolean wrapper below
 * intentionally keeps its original fail-closed contract.
 *
 * @param {{buyer?: string}} [args]
 * @returns {Promise<{available: boolean, definitive: boolean, code: string}>}
 */
export async function probeFoilPackAvailabilityState({ buyer } = {}) {
  const buyerArg = buyer ?? getActingAddress();
  if (!buyerArg) return { available: false, definitive: false, code: 'NO_BUYER' };
  try {
    const provider = getProvider();
    if (!provider) return { available: false, definitive: false, code: 'NO_PROVIDER' };
    const signer = await provider.getSigner();
    if (!signer) return { available: false, definitive: false, code: 'NO_SIGNER' };
    const contract = _buildContract(signer);
    await contract.purchase.staticCall(
      buyerArg,
      0n,
      0n,
      ethers.ZeroHash,
      MINT_PAYMENT_KIND_DIRECT_ETH,
      true,
      { value: 0n },
    );
    return { available: true, definitive: true, code: 'AVAILABLE' };
  } catch (error) {
    const decoded = decodeRevertReason(error);
    const rawName = typeof error?.revert?.name === 'string' ? error.revert.name : null;
    const code = decoded.code === 'UNKNOWN' && rawName ? rawName : decoded.code;
    if (code === 'Insolvent') {
      return { available: true, definitive: true, code };
    }
    // Ownership and authorization cannot heal on another poll for this exact
    // buyer/level. StaleAdvance and unknown transport/provider failures can.
    const definitive = code === 'FoilAlreadyBought'
      || code === 'NotApproved'
      || code === 'GameOver';
    return { available: false, definitive, code };
  }
}

/** Boolean, fail-closed compatibility wrapper. */
export async function probeFoilPackAvailability(args = {}) {
  return Boolean((await probeFoilPackAvailabilityState(args)).available);
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

// ---------------------------------------------------------------------------
// purchaseEth — purchase() with claimable-first funding for the
// ETH-denominated ticket/lootbox/foil combo. CONTEXT D-01 step 1 + D-04 wave 2.
//
// UNITS. The contract parameter is `entryQuantityScaled` (DegenerusGame.sol:703):
// "Purchase units (400 = 4*QTY_SCALE = one whole ticket = 4 entries)". So a whole
// TICKET is 400 units and one ENTRY is 100. Multiplying a ticket count by 100
// therefore buys a QUARTER of what it says, and — because the cost the contract
// charges is `priceWei * entryQuantityScaled / (4 * QTY_SCALE)` — pays four
// times over for it, with the excess credited silently to the payer's afking
// balance rather than refunded. Everything below is in whole TICKETS, converted
// once in entriesScaledFromTickets.
// ---------------------------------------------------------------------------


/** One entry is a quarter ticket; the contract's finest unit. */
export const ENTRIES_PER_TICKET = 4;

/**
 * Whole (or fractional) tickets → the contract's `entryQuantityScaled`.
 * Snaps to the nearest whole ENTRY, which is as fine as the chain goes: 0.25
 * tickets = 1 entry = 100 units.
 *
 * @param {number} tickets
 * @returns {bigint} purchase units (400 per whole ticket)
 */
export function entriesScaledFromTickets(tickets) {
  const t = Number(tickets);
  if (!Number.isFinite(t) || t <= 0) return 0n;
  return BigInt(Math.round(t * ENTRIES_PER_TICKET)) * 100n;
}

/**
 * What the contract will charge for `tickets`, exactly:
 * `priceWei * entryQuantityScaled / (4 * QTY_SCALE)` in integer arithmetic.
 * Overpaying is not refunded (it lands in afking), so this must match.
 *
 * @param {bigint} priceWei whole-ticket price at the target level
 * @param {number} tickets
 * @returns {bigint}
 */
export function ticketCostFromTickets(priceWei, tickets) {
  return (BigInt(priceWei) * entriesScaledFromTickets(tickets)) / 400n;
}

/**
 * Split a purchase so claimable winnings are consumed before wallet ETH.
 *
 * `claimableWinningsOf` returns the raw balance, including the contract's
 * permanent 1-wei sentinel. Combined payments consume fresh ETH first
 * on-chain, so sending only the shortfall makes the resulting split
 * claimable-first: the exact remainder must come from claimable.
 *
 * @param {bigint} totalCostWei
 * @param {bigint} rawClaimableWei
 * @returns {{payKind:number, msgValueWei:bigint, claimableUsedWei:bigint,
 *            totalCostWei:bigint}}
 */
export function claimableFirstPayment(totalCostWei, rawClaimableWei = 0n) {
  let total = 0n;
  let raw = 0n;
  try { total = BigInt(totalCostWei); } catch (_e) { total = 0n; }
  try { raw = BigInt(rawClaimableWei); } catch (_e) { raw = 0n; }
  if (total < 0n) total = 0n;
  if (raw < 0n) raw = 0n;

  const spendable = raw > 1n ? raw - 1n : 0n;
  const claimableUsedWei = spendable < total ? spendable : total;
  const msgValueWei = total - claimableUsedWei;
  const payKind = claimableUsedWei === 0n
    ? MINT_PAYMENT_KIND_DIRECT_ETH
    : msgValueWei === 0n
      ? MINT_PAYMENT_KIND_CLAIMABLE
      : MINT_PAYMENT_KIND_COMBINED;

  return { payKind, msgValueWei, claimableUsedWei, totalCostWei: total };
}

export function purchaseFundingPayment(
  totalCostWei,
  rawClaimableWei = 0n,
  rawAfkingWei = 0n,
  { useClaimable = true, useAfking = false } = {},
) {
  const base = claimableFirstPayment(totalCostWei, useClaimable ? rawClaimableWei : 0n);
  let afking = 0n;
  try { afking = BigInt(rawAfkingWei ?? 0); } catch (_e) { afking = 0n; }
  if (afking < 0n || !useAfking) afking = 0n;
  const afkingUsedWei = afking < base.msgValueWei ? afking : base.msgValueWei;
  return {
    ...base,
    msgValueWei: base.msgValueWei - afkingUsedWei,
    afkingUsedWei,
  };
}

async function _purchaseFundingFor(
  contract,
  buyer,
  totalCostWei,
  { useClaimable = true, useAfking = false } = {},
) {
  if (!contract) {
    return purchaseFundingPayment(totalCostWei, 0n, 0n, { useClaimable, useAfking });
  }
  const reads = await Promise.allSettled([
    useClaimable && typeof contract.claimableWinningsOf === 'function'
      ? contract.claimableWinningsOf(buyer) : 0n,
    useAfking && typeof contract.afkingFundingOf === 'function'
      ? contract.afkingFundingOf(buyer) : 0n,
  ]);
  const claimable = reads[0].status === 'fulfilled' ? reads[0].value : 0n;
  const afking = reads[1].status === 'fulfilled' ? reads[1].value : 0n;
  // A read failure must not disable purchases. The unknown source simply
  // falls back to fresh ETH; the exact static-call remains authoritative.
  return purchaseFundingPayment(totalCostWei, claimable, afking, {
    useClaimable,
    useAfking,
  });
}

/**
 * @param {{ticketQuantity: number, lootboxQuantity: number, affiliateCode?: string,
 *          lootBoxAmountWei?: bigint, ticketCostWei?: bigint,
 *          foil?: boolean, foilCostWei?: bigint, presaleBoxAmountWei?: bigint,
 *          preferClaimable?: boolean, useAfking?: boolean,
 *          onSubmitted?: function(import('ethers').TransactionResponse): void}} args
 *   ticketCostWei — scaled per-purchase ticket cost (scaledTicketPriceWei(target) ×
 *   quantity), computed by the panel from /game/state level + phase. It is part
 *   of the exact total; claimableFirstPayment decides the wallet shortfall.
 *   foil — buy the level's foil pack as an additive leg (one per player per
 *   level; contract reverts FoilAlreadyBought on a repeat). foilCostWei is NOT
 *   derived here — the panel passes scaledFoilPackCostWei(target) computed from
 *   the same fresh /game/state read as the ticket price, so both legs price
 *   against one snapshot.
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt,
 *                    contract: import('ethers').Contract,
 *                    payment: {payKind:number,msgValueWei:bigint,
 *                              claimableUsedWei:bigint,totalCostWei:bigint}}>}
 */
export async function purchaseEth(args) {
  const buyer = _readBuyer();
  const ticketQuantity = Number(args.ticketQuantity ?? 0);
  const lootboxQuantity = Number(args.lootboxQuantity ?? 0);
  // Plan 60-04: auto-read affiliate code from chainId-scoped localStorage when caller
  // omits explicit value. Widget call site is `purchaseEth({ticketQuantity, lootboxQuantity})`
  // — affiliate plumbing is invisible per CONTEXT D-05 (no UI element in Phase 60).
  const affiliateCode = args.affiliateCode ?? readAffiliateCode(CHAIN.id, buyer);
  // Default lootBoxAmountWei = LOOTBOX_MIN_WEI × N. Plan 60-04 may upgrade by reading
  // mintPrice() from chain to honor higher tiers; Plan 60-02 uses the contract minimum.
  const lootBoxAmountWei = args.lootBoxAmountWei
    ?? (LOOTBOX_MIN_WEI * BigInt(Math.max(0, lootboxQuantity)));
  // purchaseInfo() is authoritative at click time. In the final sealed RNG
  // window the API can still say Level N while purchase() already routes to
  // Level N+1; trusting the panel's stale price there underfunded the foil leg
  // by exactly one level-tier jump.
  const purchaseQuote = ticketQuantity > 0 || args.foil
    ? await readPurchaseQuote()
    : null;
  const quotedPriceWei = purchaseQuote?.priceWei ?? 0n;
  const ticketCostWei = quotedPriceWei > 0n && ticketQuantity > 0
    ? ticketCostFromTickets(quotedPriceWei, ticketQuantity)
    : BigInt(args.ticketCostWei ?? 0n);
  // Foil leg (additive): DegenerusGame._purchaseWithFoil caps fresh ETH at
  // tickets + lootbox + FOIL_PACK_TICKETS × price and credits any excess to
  // afking, so msg.value must include the exact foil cost.
  const foil = Boolean(args.foil);
  const foilCostWei = foil
    ? quotedPriceWei > 0n
      ? foilPackCostFromPriceWei(quotedPriceWei)
      : BigInt(args.foilCostWei ?? 0n)
    : 0n;
  let presaleBoxAmountWei = 0n;
  try { presaleBoxAmountWei = BigInt(args.presaleBoxAmountWei ?? 0n); }
  catch (_e) { throw new Error('Enter a valid presale box amount.'); }
  if (presaleBoxAmountWei < 0n) throw new Error('Enter a valid presale box amount.');
  if (presaleBoxAmountWei > 0n && presaleBoxAmountWei < PRESALE_BOX_MIN_WEI) {
    throw new Error('Minimum presale box size is 0.01 ETH.');
  }
  if (presaleBoxAmountWei > 0n && foil) {
    // The deployed combined selector has no foil flag. Keep this explicit so
    // callers never believe a foil leg was included when it was not.
    throw new Error('Buy the foil pack separately from a presale box.');
  }
  const mintCostWei = lootBoxAmountWei + ticketCostWei + foilCostWei;
  if (presaleBoxAmountWei > 0n && mintCostWei <= 0n) {
    throw new Error('Use the standalone presale box purchase when there is no regular purchase.');
  }
  const totalCostWei = mintCostWei + presaleBoxAmountWei;

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  const signerContract = signer ? _buildContract(signer) : null;
  // Audit c19a1088 funds the foil leg through the SAME canonical waterfall as every
  // other purchase (claimable, then prepaid AFKing), so the old `&& !foil` carve-out
  // is obsolete: the module now taps AFKing principal instead of reverting on it.
  // Excluding AFKing here would inflate msg.value and make the buyer overpay from the
  // wallet for funds the contract would have drawn. The static-call gate below stays
  // authoritative, and _purchaseFundingFor falls back to fresh ETH if the balance
  // reads fail, so a stale read cannot brick the purchase.
  const useAfkingForPurchase = args.useAfking === true;
  const payment = await _purchaseFundingFor(
    signerContract,
    buyer,
    totalCostWei,
    {
      useClaimable: args.preferClaimable !== false,
      useAfking: useAfkingForPurchase,
    },
  );

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  // Trailing overrides object rides through staticCall(...args) so the sim
  // carries the same msg.value as the real tx (value-accurate pre-flight).
  const entryQuantityScaled = entriesScaledFromTickets(ticketQuantity);
  if (signer) {
    const method = presaleBoxAmountWei > 0n ? 'buyLootboxAndPresaleBox' : 'purchase';
    const callArgs = presaleBoxAmountWei > 0n
      ? [buyer, entryQuantityScaled, lootBoxAmountWei, affiliateCode, payment.payKind,
        presaleBoxAmountWei, { value: payment.msgValueWei }]
      : [buyer, entryQuantityScaled, lootBoxAmountWei, affiliateCode, payment.payKind, foil,
        { value: payment.msgValueWei }];
    const sim = await requireStaticCall(
      signerContract,
      method,
      callArgs,
      signer
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, `static-call ${method}`);
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => {
      const c = _buildContract(s);
      if (presaleBoxAmountWei > 0n) {
        return c.buyLootboxAndPresaleBox(
          buyer,
          entryQuantityScaled,
          lootBoxAmountWei,
          affiliateCode,
          payment.payKind,
          presaleBoxAmountWei,
          { value: payment.msgValueWei }
        );
      }
      return c.purchase(
        buyer,
        entryQuantityScaled,
        lootBoxAmountWei,
        affiliateCode,
        payment.payKind,
        foil,
        { value: payment.msgValueWei }
      );
    },
    `${presaleBoxAmountWei > 0n ? 'Buy in + presale box'
      : foil ? 'Buy foil pack' : ticketQuantity > 0 ? 'Buy tickets' : 'Buy lootbox'} (${
      args.preferClaimable === false ? 'wallet ETH' : 'claimable first'
    })`,
    { onSubmitted: args.onSubmitted },
  );

  // Build a contract bound to the provider (signer-free) for log parsing.
  const contract = _buildContract(provider);
  return { receipt, contract, payment };
}

// ---------------------------------------------------------------------------
// Coin-presale boxes — current deploy credit-gated box surface.
//
// ETH ticket/lootbox purchases accrue credit at 25% of spend while the presale
// is active. A box consumes that credit 1:1 and queues at the current shared
// lootbox RNG index. The standalone write accepts fresh ETH first and pulls any
// shortfall from claimable/AFKing funding on-chain.
// ---------------------------------------------------------------------------

/**
 * Read the exact current presale availability for one player.
 * @param {{player?: string}} [args]
 * @returns {Promise<null|{active:boolean,creditWei:bigint,remainingWei:bigint,maxBoxWei:bigint}>}
 */
export async function readPresaleBoxState({ player } = {}) {
  const owner = player || getActingAddress();
  if (!owner) return null;
  const provider = getProvider();
  if (!provider) return null;
  const contract = _buildContract(provider);
  if (typeof contract.lootboxPresaleActiveFlag !== 'function'
    || typeof contract.presaleBoxCreditOf !== 'function'
    || typeof contract.presaleBoxEthRemaining !== 'function') return null;
  const [active, creditRaw, remainingRaw] = await Promise.all([
    contract.lootboxPresaleActiveFlag(),
    contract.presaleBoxCreditOf(owner),
    contract.presaleBoxEthRemaining(),
  ]);
  const creditWei = BigInt(creditRaw ?? 0n);
  const remainingWei = BigInt(remainingRaw ?? 0n);
  return {
    active: Boolean(active),
    creditWei,
    remainingWei,
    maxBoxWei: creditWei < remainingWei ? creditWei : remainingWei,
  };
}

/**
 * Buy one credit-gated presale box. The requested amount should already be
 * clamped to the player's live credit and global remaining capacity; this
 * helper re-reads both immediately before simulation so an old UI quote cannot
 * turn a close-boundary clamp into unexpected AFKing credit.
 *
 * @param {{boxAmountWei: bigint|string|number, player?: string, preferClaimable?: boolean,
 *          useAfking?: boolean,
 *          onSubmitted?: function(import('ethers').TransactionResponse): void}} args
 * @returns {Promise<{receipt,contract,payment,state}>}
 */
export async function purchasePresaleBox({
  boxAmountWei,
  player,
  preferClaimable = true,
  useAfking = false,
  onSubmitted,
} = {}) {
  const buyer = player || _readBuyer();
  let requested;
  try { requested = BigInt(boxAmountWei ?? 0n); }
  catch (_e) { throw new Error('Enter a valid presale box amount.'); }
  if (requested < PRESALE_BOX_MIN_WEI) {
    throw new Error('Minimum presale box size is 0.01 ETH.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (!signer) throw new Error('Wallet not connected.');
  const contract = _buildContract(signer);
  const state = await readPresaleBoxState({ player: buyer });
  if (!state?.active || state.remainingWei <= 0n) throw new Error('The presale box round is closed.');
  if (requested > state.creditWei) throw new Error('Presale credit is lower than that box size.');
  if (requested > state.remainingWei) throw new Error('Only a smaller presale box remains available.');

  const payment = await _purchaseFundingFor(
    contract,
    buyer,
    requested,
    {
      useClaimable: preferClaimable !== false,
      useAfking: useAfking === true,
    },
  );
  const callArgs = [buyer, requested, { value: payment.msgValueWei }];
  const sim = await requireStaticCall(contract, 'buyPresaleBox', callArgs, signer);
  if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call buyPresaleBox');

  const receipt = await sendTx(
    (s) => _buildContract(s).buyPresaleBox(...callArgs),
    'Buy presale box',
    { onSubmitted },
  );
  return { receipt, contract: _buildContract(provider), payment, state };
}

/** Current PresaleBoxBuy receipt anchors, in log order. */
export function parsePresaleBoxBuyFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name !== 'PresaleBoxBuy') continue;
      out.push({
        buyer: String(parsed.args.buyer ?? parsed.args[0]),
        lootboxIndex: BigInt(parsed.args.index ?? parsed.args[1]),
        amountWei: BigInt(parsed.args.amount ?? parsed.args[2]),
        closing: Boolean(parsed.args.closing ?? parsed.args[3]),
      });
    } catch (_e) { /* foreign log */ }
  }
  return out;
}

/**
 * Recover the two purchase legs sharing one RNG index from a mined transaction.
 * This is the only reliable presale-only existence check on the current GAME:
 * lootboxStatus() exposes lootboxEth, but intentionally does not expose the
 * separate presaleBoxEth mapping.
 */
export async function readLootboxPurchaseReceipt({ transactionHash, player, lootboxIndex } = {}) {
  const hash = String(transactionHash || '');
  const owner = String(player || '').toLowerCase();
  let index;
  try { index = BigInt(lootboxIndex); } catch (_e) { return null; }
  if (!hash || !owner) return null;
  const connected = getProvider();
  const readers = [connected];
  // Wallet RPCs occasionally omit an older receipt (notably after Firefox
  // reconnects). The public read RPC is authoritative enough for immutable
  // mined logs and lets Pending recover a presale leg after a reload.
  if (!_contractFactory) readers.push(_publicLootboxReadProvider());
  for (const reader of [...new Set(readers.filter(Boolean))]) {
    if (typeof reader.getTransactionReceipt !== 'function') continue;
    try {
      const receipt = await reader.getTransactionReceipt(hash);
      if (!receipt || !Array.isArray(receipt.logs)) continue;
      const contract = _buildContract(reader);
      let hasLootboxLeg = false;
      let hasPresaleLeg = false;
      let amountWei = 0n;
      for (const log of receipt.logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (!['LootBoxBuy', 'PresaleBoxBuy'].includes(parsed?.name)) continue;
          const buyer = String(parsed.args.buyer ?? parsed.args[0] ?? '').toLowerCase();
          const eventIndex = BigInt(parsed.args.index ?? parsed.args[1]);
          if (buyer !== owner || eventIndex !== index) continue;
          amountWei += BigInt(parsed.args.amount ?? parsed.args[2] ?? 0);
          if (parsed.name === 'PresaleBoxBuy') hasPresaleLeg = true;
          else hasLootboxLeg = true;
        } catch (_e) { /* foreign log */ }
      }
      return { hasLootboxLeg, hasPresaleLeg, amountWei };
    } catch (_e) {
      // Try the public reader after an injected-wallet RPC miss.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// parseFoilPackBoughtFromReceipt — confirms the foil leg landed (receipt-log
// first, same discipline as LootBoxIdx). One event per successful foil buy:
//   FoilPackBought(buyer, uint24 level, uint16 multBps, uint256 weiIn)
// multBps = the frozen activity color boost (20000..60000).
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{buyer: string, level: number, multBps: number}>}
 */
export function parseFoilPackBoughtFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (let i = 0; i < receipt.logs.length; i++) {
    try {
      const parsed = contract.interface.parseLog(receipt.logs[i]);
      if (parsed && parsed.name === 'FoilPackBought') {
        out.push({
          buyer: String(parsed.args.buyer ?? parsed.args[0]),
          level: Number(parsed.args.level ?? parsed.args[1]),
          multBps: Number(parsed.args.multBps ?? parsed.args[2]),
        });
      }
    } catch (_e) {
      // skip non-matching logs
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// purchaseCoin — REMOVED (Base Sepolia redeploy #7): the contracts no longer
// support FLIP-paid ticket purchases (purchaseCoin selector is gone from the
// deployed GAME). Tickets are bought via purchase() with payKind DirectEth /
// Claimable / Combined. FLIP still PAYS OUT as prizes — only the FLIP-paid
// buy path is gone.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// openLootBox — opens the boxes queued at an RNG index. Contract surface is
// openBox(address player, uint48 index) since redeploy #7 (permissionless:
// anyone may open another player's ready boxes; rewards credit the owner).
// JS export keeps the openLootBox name — panel call sites are unchanged.
// ---------------------------------------------------------------------------

/**
 * @param {{lootboxIndex: bigint | number, player?: string}} args
 * @returns {Promise<{receipt, contract}>}
 */
export async function openLootBox(args) {
  // openBox is permissionless and always credits `player`. Accepting the
  // tracked owner explicitly keeps a resolver click pinned to the item it
  // rendered even if the acting-account selector changes between paint and
  // click. The legacy acting-address default remains for direct panel callers.
  const player = args?.player || _readBuyer();
  const lootboxIndex = BigInt(args.lootboxIndex);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;

  if (signer) {
    const contract = _buildContract(signer);
    const sim = await requireStaticCall(
      contract,
      'openBox',
      [player, lootboxIndex],
      signer
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call openBox');
  }

  const receipt = await sendTx(
    (s) => {
      const c = _buildContract(s);
      return c.openBox(player, lootboxIndex);
    },
    'Open lootbox'
  );

  const contract = _buildContract(provider);
  return { receipt, contract };
}

// ---------------------------------------------------------------------------
// parseLootboxIdxFromReceipt — extracts the queue index from the current
// LootBoxBuy event. Older cached run receipts may still carry LootBoxIdx, so the
// parser accepts both shapes while all new writes resolve from LootBoxBuy.
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{lootboxIndex: bigint, day: bigint | null, amountWei: bigint | null}>}
 */
export function parseLootboxIdxFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (let i = 0; i < receipt.logs.length; i++) {
    try {
      const parsed = contract.interface.parseLog(receipt.logs[i]);
      if (!parsed) continue;
      if (parsed.name === 'LootBoxBuy') {
        out.push({
          lootboxIndex: BigInt(parsed.args.index ?? parsed.args[1]),
          day: null,
          amountWei: BigInt(parsed.args.amount ?? parsed.args[2] ?? 0),
        });
      } else if (parsed.name === 'LootBoxIdx') {
        out.push({
          lootboxIndex: BigInt(parsed.args.index ?? parsed.args[1]),
          day: BigInt(parsed.args.day ?? parsed.args[2]),
          amountWei: null,
        });
      }
    } catch (_e) {
      // skip non-matching logs (foreign contracts, unknown events)
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseTraitsGeneratedFromReceipt — extracts trait reveal data from openLootBox
// receipts. CONTEXT LBX-04: source of truth for "what did the player get."
// Event signature verified at contracts/storage/DegenerusGameStorage.sol:484:
//   event TraitsGenerated(address indexed player, uint24 indexed level,
//                         uint32 queueIdx, uint32 startIndex, uint32 count, uint256 entropy)
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{player: string, level: bigint, queueIdx: bigint, startIndex: bigint, count: bigint, entropy: bigint}>}
 */
export function parseTraitsGeneratedFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (let i = 0; i < receipt.logs.length; i++) {
    try {
      const parsed = contract.interface.parseLog(receipt.logs[i]);
      if (parsed && parsed.name === 'TraitsGenerated') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          level: BigInt(parsed.args.level ?? parsed.args[1]),
          queueIdx: BigInt(parsed.args.queueIdx ?? parsed.args[2]),
          startIndex: BigInt(parsed.args.startIndex ?? parsed.args[3]),
          count: BigInt(parsed.args.count ?? parsed.args[4]),
          entropy: BigInt(parsed.args.entropy ?? parsed.args[5]),
        });
      }
    } catch (_e) {
      // skip
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lootbox readiness helpers. The current deployed GAME deliberately exposes no
// raw RNG-word getter. Simulating openBox is the authoritative, side-effect-free
// readiness probe for one player's box; boxIndexComplete is only a conservative
// signal that the permissionless sweep has already passed an index.
// ---------------------------------------------------------------------------

/**
 * @param {{player?: string, lootboxIndex: bigint | number}} args
 * @returns {Promise<boolean>}
 */
export async function canOpenLootbox({ player, lootboxIndex } = {}) {
  const provider = getProvider();
  const owner = player || getActingAddress();
  if (!provider || !owner || lootboxIndex == null) return false;
  const contract = _buildContract(provider);
  if (typeof contract?.openBox?.staticCall !== 'function') return false;
  try {
    await contract.openBox.staticCall(owner, BigInt(lootboxIndex));
    return true;
  } catch (_e) {
    return false;
  }
}

/** Conservative completion hint used when the exact box has already vanished. */
export async function isLootboxIndexComplete(lootboxIndex) {
  const provider = getProvider();
  if (!provider || lootboxIndex == null) return false;
  const contract = _buildContract(provider);
  if (typeof contract?.boxIndexComplete !== 'function') return false;
  return Boolean(await contract.boxIndexComplete(BigInt(lootboxIndex)));
}

/** Decode the two packed GAME slots that describe the shared mid-day RNG queue. */
export function decodeLootboxRngQueueState(
  queuePackedValue,
  timingPackedValue = 0n,
  blockNumber = null,
) {
  const packed = BigInt(queuePackedValue ?? 0n);
  const timing = BigInt(timingPackedValue ?? 0n);
  const index = packed & UINT48_MASK;
  const pendingMilliEth = (packed >> LR_PENDING_ETH_SHIFT) & UINT64_MASK;
  const thresholdMilliEth = (packed >> LR_THRESHOLD_SHIFT) & UINT64_MASK;
  const pendingFlipWhole = (packed >> LR_PENDING_FLIP_SHIFT) & UINT40_MASK;
  const requestTime = (timing >> RNG_REQUEST_TIME_SHIFT) & UINT48_MASK;
  const rngLocked = ((timing >> RNG_LOCKED_SHIFT) & 0xffn) !== 0n;
  const hasPending = pendingMilliEth !== 0n || pendingFlipWhole !== 0n;
  const queueReady = thresholdMilliEth === 0n
    ? hasPending
    : pendingMilliEth >= thresholdMilliEth;
  const rawFillBps = thresholdMilliEth === 0n
    ? (hasPending ? 10_000n : 0n)
    : (pendingMilliEth * 10_000n) / thresholdMilliEth;
  const fillBps = thresholdMilliEth === 0n
    ? (hasPending ? 10_000 : 0)
    : Number(rawFillBps > 10_000n ? 10_000n : rawFillBps);
  return {
    index,
    pendingMilliEth,
    thresholdMilliEth,
    pendingEthWei: pendingMilliEth * MILLI_ETH_WEI,
    thresholdWei: thresholdMilliEth * MILLI_ETH_WEI,
    pendingFlipWhole,
    hasPending,
    queueReady,
    fillBps,
    requestTime,
    rngLocked,
    middayRequestInFlight: requestTime !== 0n && !rngLocked,
    blockNumber: blockNumber != null && Number.isInteger(Number(blockNumber))
      ? Number(blockNumber)
      : null,
  };
}

async function _readGameStorage(provider, slot, blockNumber) {
  if (typeof provider?.getStorage === 'function') {
    return provider.getStorage(CONTRACTS.GAME, slot, blockNumber ?? 'latest');
  }
  if (typeof provider?.send === 'function') {
    const blockTag = Number.isInteger(blockNumber)
      ? `0x${blockNumber.toString(16)}`
      : 'latest';
    return provider.send('eth_getStorageAt', [
      CONTRACTS.GAME,
      `0x${slot.toString(16)}`,
      blockTag,
    ]);
  }
  throw new Error('Provider cannot read the shared RNG queue.');
}

/**
 * Read the authoritative shared mid-day RNG queue and request latch.
 * Values are returned in the contract's native milli-ETH / whole-FLIP units
 * so consumers can render progress without floating-point rounding.
 */
export async function readLootboxRngQueueState({ provider = null } = {}) {
  let reader = provider || getProvider();
  if (!reader && CHAIN.rpcUrl) {
    reader = _publicLootboxReadProvider();
  }
  if (!reader || !CONTRACTS.GAME) return null;
  let blockNumber = null;
  try {
    const head = Number(await reader.getBlockNumber?.());
    if (Number.isInteger(head) && head >= 0) blockNumber = head;
  } catch (_e) { /* an unpinned latest read is still useful */ }
  const [queuePacked, timingPacked] = await Promise.all([
    _readGameStorage(reader, LOOTBOX_RNG_STORAGE_SLOT, blockNumber),
    _readGameStorage(reader, GAME_TIMING_STORAGE_SLOT, blockNumber),
  ]);
  return decodeLootboxRngQueueState(queuePacked, timingPacked, blockNumber);
}

/** Whether the connected account can permissionlessly request the pending RNG now. */
export async function canRequestLootboxRng() {
  const provider = getProvider();
  if (!provider) return false;
  let runner = provider;
  try { runner = await provider.getSigner(); } catch (_e) { /* read-only probe */ }
  const contract = _buildContract(runner);
  if (typeof contract?.requestLootboxRng?.staticCall !== 'function') return false;
  try {
    await contract.requestLootboxRng.staticCall();
    return true;
  } catch (_e) {
    return false;
  }
}

/** Permissionlessly start the shared RNG batch once its on-chain gates are open. */
export async function requestLootboxRng() {
  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (!signer) throw new Error('Wallet not connected.');
  const contract = _buildContract(signer);
  const sim = await requireStaticCall(contract, 'requestLootboxRng', [], signer);
  if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call requestLootboxRng');
  const receipt = await sendTx(
    (s) => _buildContract(s).requestLootboxRng(),
    'Request Degenerette RNG',
  );
  return { receipt };
}

/**
 * Fresh chain status for one player's ETH-lootbox leg. The amount is cleared
 * before settlement events are emitted, so `amount === 0n` is the authoritative
 * "already resolved / no longer pending" signal for the combined-buy boxes this
 * app tracks. A null result means the RPC could not answer and callers should
 * fall back to the transaction's own static-call race gate.
 *
 * @param {{player?: string, lootboxIndex: bigint | number}} args
 * @returns {Promise<{amount: bigint, presale: boolean}|null>}
 */
export async function readLootboxStatus({ player, lootboxIndex } = {}) {
  const owner = player || getActingAddress();
  if (!owner || lootboxIndex == null) return null;
  const provider = getProvider();
  if (!provider) return null;
  const contract = _buildContract(provider);
  if (typeof contract.lootboxStatus !== 'function') return null;
  const out = await contract.lootboxStatus(owner, BigInt(lootboxIndex));
  return {
    amount: BigInt(out?.amount ?? out?.[0] ?? 0n),
    presale: Boolean(out?.presale ?? out?.[1] ?? false),
  };
}

// ---------------------------------------------------------------------------
// Purchase-default affiliate code (LBX-03, semantics fixed 2026-07-16).
//
// The referral a purchase tx should carry lives ONLY in the site-wide
// first-touch capture (/js/ref.js: localStorage 'affiliate-ref', cookie
// 'dgn_ref'). It is just a default for the FIRST purchase — the contract
// locks the referrer on-chain after that, so nothing else needs it.
//
// The chainId-scoped `affiliate-code:{chainId}:{addr}` key is the player's
// OWN registered code (written by affiliate.js createAffiliateCode; read by
// the affiliate panel + share card). It must NEVER ride a purchase — that
// would be a self-referral — so readAffiliateCode does not consult it, and
// readSiteRef skips a site ref that matches it (clicking your own share
// link must not poison your first buy).
//
// The URL param format is already bytes32hex (regex /^0x[a-fA-F0-9]{64}$/) —
// no encodeBytes32String conversion; pass directly to the contract's
// purchase() affiliateCode arg.
// ---------------------------------------------------------------------------

/**
 * Read the purchase-default affiliate code (the site-wide first-touch
 * referral). Never returns the player's own code in either form.
 * @param {number} chainId Used only for the own-registered-code self-skip.
 * @param {string} address  Connected wallet address.
 * @returns {string} bytes32 hex (validated) or ethers.ZeroHash.
 */
export function readAffiliateCode(chainId, address) {
  if (!address) return ethers.ZeroHash;
  const site = readSiteRef(chainId, address);
  if (site) return site;
  return ethers.ZeroHash;
}

/**
 * Read the site-wide first-touch referral captured by /js/ref.js on any page
 * (localStorage 'affiliate-ref', cookie 'dgn_ref' as backup). Skips a code
 * that is the connected address's own default code OR own registered code
 * (self-referral; Affiliate.sol reverts).
 * @param {number} chainId
 * @param {string} address  Connected wallet address.
 * @returns {string|null} bytes32 hex or null.
 */
function readSiteRef(chainId, address) {
  let ref = null;
  try {
    const ls = (typeof localStorage !== 'undefined') ? localStorage.getItem('affiliate-ref') : null;
    if (ls && /^0x[a-fA-F0-9]{64}$/.test(ls)) ref = ls;
  } catch (_e) { /* private mode / quota — defensive (Pitfall F) */ }
  if (!ref) {
    try {
      const m = (typeof document !== 'undefined' && document.cookie)
        ? document.cookie.match(/(?:^|;\s*)dgn_ref=([^;]*)/) : null;
      const ck = m ? decodeURIComponent(m[1]) : null;
      if (ck && /^0x[a-fA-F0-9]{64}$/.test(ck)) ref = ck;
    } catch (_e) { /* cookies disabled — defensive */ }
  }
  if (!ref) return null;
  const selfCode = '0x' + '0'.repeat(24) + String(address).toLowerCase().slice(2);
  if (ref.toLowerCase() === selfCode) return null;
  try {
    const own = (typeof localStorage !== 'undefined')
      ? localStorage.getItem(`affiliate-code:${chainId}:${String(address).toLowerCase()}`)
      : null;
    if (own && ref.toLowerCase() === own.toLowerCase()) return null;
  } catch (_e) { /* private mode / quota — defensive (Pitfall F) */ }
  return ref;
}

// ---------------------------------------------------------------------------
// Phase 63 Plan 63-02 (D-02 LOCKED) — iOS Safari user-gesture pre-warm.
//
// Pre-warm lootbox purchase tx params BEFORE the click. Click handler in
// app-packs-panel.js invokes `buildTx()` SYNCHRONOUSLY — no await between
// gesture and `signer.sendTransaction`. This preserves the user-gesture
// activation window so the WC SDK's universal-link to MetaMask Mobile fires
// without surfacing Safari's "Open MetaMask?" confirm prompt (Pitfall 12
// canonical mitigation per Reown Mobile Linking docs + WC #1165).
//
// SCOPE LOCKED to lootbox panel only (CONTEXT D-02). The 10 sibling panels
// continue using the existing `await sendTx(...)` path — accept the standard
// "Open MetaMask?" Safari prompt as documented cost-of-business. MM in-dApp
// browser sidesteps the issue entirely and is the supported mobile path.
//
// THIS IS THE ONE PRODUCTION SITE WHERE THE PHASE 58 CLOSURE-FORM `sendTx`
// CHOKEPOINT IS BYPASSED AT THE CLICK MOMENT. `requireSelf()` is invoked HERE
// at pre-warm time before deriving signer — devtools-bypass defense preserved.
// `requireStaticCall` is also lifted out of the click moment to pre-warm.
//
// ETH path → `contract.purchase.populateTransaction(...)` (method-attached
//   v6 form per RESEARCH F-4; the v5 form `contract.populateTransaction[purchase](...)`
//   is FORBIDDEN — only the v6 documented method-attached form is used).
//   Lootboxes are ETH-only; there is no FLIP lootbox purchase path.
// ---------------------------------------------------------------------------

/**
 * Pre-warm lootbox purchase tx params for synchronous click-time send.
 *
 * @param {{ticketQuantity:number, lootboxQuantity:number,
 *          affiliateCode?:string, lootBoxAmountWei?:bigint,
 *          ticketCostWei?:bigint, preferClaimable?:boolean, useAfking?:boolean}} args
 * @returns {Promise<{buildTx:()=>Promise<import('ethers').TransactionResponse>,
 *                    abort:()=>void, expiresAt:number, payment:object}>}
 */
export async function prewarmLootboxBuy(args) {
  // 1. Devtools-bypass defense — runs BEFORE any provider/signer derivation.
  //    Pre-warm bypasses the sendTx chokepoint at click moment but still
  //    honors requireSelf semantics here (T-58-02 + T-63-02-02 mitigation).
  requireSelf();

  const provider = getProvider();
  if (!provider) throw new Error('Wallet not connected.');
  const signer = await provider.getSigner();
  // Account-switcher fix (2026-07-16): buyer must be the ACTING player
  // (getActingAddress() — connected in 'self', the viewed owner in
  // 'operator'), NOT unconditionally the signer's own address. The prior
  // signer.getAddress()-only derivation bought lootboxes for the connected
  // operator instead of the player being acted for. requireSelf() above
  // already guarantees mode is 'self' or 'operator' by this point (both
  // resolve a non-null getActingAddress()); the signer-address fallback is
  // defensive only, mirroring purchaseEth/openLootBox's _readBuyer().
  const buyer = (getActingAddress() || (await signer.getAddress())).toLowerCase();

  const contract = _buildContract(signer);
  const ticketsScaled = entriesScaledFromTickets(args.ticketQuantity ?? 0);

  // Lootboxes are ETH-denominated, but claimable winnings are the preferred
  // funding source. Only the uncovered remainder is included as msg.value.
  const lootBoxAmountWei = args.lootBoxAmountWei
    ?? (LOOTBOX_MIN_WEI * BigInt(Math.max(0, Number(args.lootboxQuantity ?? 0))));
  const ticketCostWei = args.ticketCostWei ?? 0n;
  const payment = await _purchaseFundingFor(
    contract,
    buyer,
    lootBoxAmountWei + ticketCostWei,
    {
      useClaimable: args.preferClaimable !== false,
      useAfking: args.useAfking === true,
    },
  );
  const affiliateCode = args.affiliateCode ?? readAffiliateCode(CHAIN.id, buyer);
  const unsignedTx = await contract.purchase.populateTransaction(
    buyer, ticketsScaled, lootBoxAmountWei, affiliateCode, payment.payKind, false,
    { value: payment.msgValueWei }
  );
  const staticCallMethod = 'purchase';
  const staticCallArgs = [
    buyer, ticketsScaled, lootBoxAmountWei, affiliateCode, payment.payKind, false,
    { value: payment.msgValueWei },
  ];

  // 2. Static-call pre-flight (Phase 56 D-05) — lifted out of the click moment.
  //    On revert: throw structured error; caller disables Buy button with the
  //    decoded reason inline (T-63-02-03 mitigation). Click handler is gated
  //    on a non-null #prewarmedTx, so this guarantees the click only fires
  //    when the static-call gate has already passed.
  const sim = await requireStaticCall(contract, staticCallMethod, staticCallArgs, signer);
  if (!sim.ok) throw _structuredRevertError(sim.error, `pre-warm ${staticCallMethod}`);

  // 3. Pre-estimate gas (best-effort). The estimate is only a point-in-time
  //    simulation; give it the shared 20% cushion before pinning gasLimit so a
  //    queue/storage branch changing before mining does not under-gas the tx.
  //    Graceful fallback on rejection leaves estimation to the wallet.
  const estimatedGas = await signer.estimateGas(unsignedTx).catch(() => null);
  if (estimatedGas) unsignedTx.gasLimit = gasEstimateWithHeadroom(estimatedGas);

  let aborted = false;
  return {
    buildTx: () => {
      if (aborted) throw new Error('Pre-warm stale — recompute.');
      // SYNCHRONOUS — no `await` here. signer.sendTransaction internally
      // populates remaining fields (chainId, nonce, fees) — verified ethers
      // v6 docs. The Promise<TransactionResponse> is returned immediately;
      // the click handler chains .then(tx => tx.wait()) without awaiting.
      return signer.sendTransaction(unsignedTx);
    },
    abort: () => { aborted = true; },
    expiresAt: Date.now() + PREWARM_TTL_MS,
    payment,
  };
}
