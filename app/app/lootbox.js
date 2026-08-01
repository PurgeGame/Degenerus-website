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
  userMessage: 'You already own a foil pack for this level — one per level.',
  recoveryAction: 'Wait for the next level to buy another.',
});
_registerFoilError('DirectEthInsufficient', {
  code: 'DirectEthInsufficient',
  userMessage: "The ETH sent doesn't cover this purchase.",
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

// ---------------------------------------------------------------------------
// GAME_ABI fragment — minimal human-readable ABI, reconciled against the
// Base Sepolia redeploy #7 GAME ABI (degenerus-sim/deployments/abis/GAME.json):
//   - purchase(buyer, ticketQuantity, lootBoxAmount, affiliateCode, payKind, foil)
//   - openBox(player, index)            — renamed from openLootBox
//   - lootboxRngWordByIndex(index)      — public mapping getter (alias dropped)
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
  // Views — lootboxRngWord(uint48) is now the public mapping getter lootboxRngWordByIndex.
  'function lootboxRngWordByIndex(uint48 index) view returns (uint256 word)',
  'function lootboxStatus(address player, uint48 lootboxIndex) view returns (uint256 amount, bool presale)',
  'function claimableWinningsOf(address player) view returns (uint256)',
  // Foil module errors bubble through GAME.purchase via delegatecall. Keeping
  // them in this interface lets ethers populate error.revert.name.
  'error FoilAlreadyBought()',
  'error DirectEthInsufficient()',
  'error StaleAdvance()',
  // Events
  'event LootBoxBuy(address indexed buyer, uint32 indexed day, uint256 amount, bool presale, uint24 level)',
  'event LootBoxIdx(address indexed buyer, uint32 indexed index, uint32 indexed day)',
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
/** Foil pack = ten ticket prices at the target level (DegenerusGameStorage.sol:2552). */
export const FOIL_PACK_TICKETS = 10n;
/** Lower bound on lootBoxAmount in ETH purchases (LOOTBOX_MIN = 0.01 ether). */
// Contract minimum lootbox spend is 0.01 ether IN THE DEPLOYED CONTRACT'S
// SCALE — the testnet contracts are compiled /1M-scaled, so the on-chain
// minimum is 1e10 wei, not 1e16 (Phase 64 fix: sending the full-scale value
// silently overpaid 1M× into the buyer's afking credit).
export const LOOTBOX_MIN_WEI = ethers.parseEther('0.01') / ETH_DIVISOR;

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

async function _claimableFirstPaymentFor(contract, buyer, totalCostWei, preferClaimable = true) {
  if (!preferClaimable || !contract || typeof contract.claimableWinningsOf !== 'function') {
    return claimableFirstPayment(totalCostWei, 0n);
  }
  try {
    const raw = await contract.claimableWinningsOf(buyer);
    return claimableFirstPayment(totalCostWei, raw);
  } catch (_e) {
    // A read failure must not disable purchases. Fall back to the exact
    // fresh-ETH path; the static call remains the authoritative gate.
    return claimableFirstPayment(totalCostWei, 0n);
  }
}

/**
 * @param {{ticketQuantity: number, lootboxQuantity: number, affiliateCode?: string,
 *          lootBoxAmountWei?: bigint, ticketCostWei?: bigint,
 *          foil?: boolean, foilCostWei?: bigint, preferClaimable?: boolean}} args
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
  const ticketCostWei = args.ticketCostWei ?? 0n;
  // Foil leg (additive): DegenerusGame._purchaseWithFoil caps fresh ETH at
  // tickets + lootbox + FOIL_PACK_TICKETS × price and credits any excess to
  // afking, so msg.value must include the exact foil cost.
  const foil = Boolean(args.foil);
  const foilCostWei = foil ? (args.foilCostWei ?? 0n) : 0n;
  const totalCostWei = lootBoxAmountWei + ticketCostWei + foilCostWei;

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  const signerContract = signer ? _buildContract(signer) : null;
  const payment = await _claimableFirstPaymentFor(
    signerContract,
    buyer,
    totalCostWei,
    args.preferClaimable !== false,
  );

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  // Trailing overrides object rides through staticCall(...args) so the sim
  // carries the same msg.value as the real tx (value-accurate pre-flight).
  if (signer) {
    const sim = await requireStaticCall(
      signerContract,
      'purchase',
      [buyer, entriesScaledFromTickets(ticketQuantity), lootBoxAmountWei, affiliateCode, payment.payKind, foil,
        { value: payment.msgValueWei }],
      signer
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call purchase');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => {
      const c = _buildContract(s);
      return c.purchase(
        buyer,
        entriesScaledFromTickets(ticketQuantity),
        lootBoxAmountWei,
        affiliateCode,
        payment.payKind,
        foil,
        { value: payment.msgValueWei }
      );
    },
    `${foil ? 'Buy foil pack' : ticketQuantity > 0 ? 'Buy tickets' : 'Buy lootbox'} (${
      args.preferClaimable === false ? 'wallet ETH' : 'claimable first'
    })`
  );

  // Build a contract bound to the provider (signer-free) for log parsing.
  const contract = _buildContract(provider);
  return { receipt, contract, payment };
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
// parseLootboxIdxFromReceipt — extracts {lootboxIndex, day} per emitted
// LootBoxIdx event. Generalized from /beta/mint.js:1110-1119. CONTEXT D-03 +
// LBX-04 receipt-log-first source of truth. Lootboxes are ETH-only.
//
// Event signature verified at contracts/modules/DegenerusGameMintModule.sol:135:
//   event LootBoxIdx(address indexed buyer, uint32 indexed index, uint32 indexed day)
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {import('ethers').Contract} contract
 * @returns {Array<{lootboxIndex: bigint, day: bigint | null}>}
 */
export function parseLootboxIdxFromReceipt(receipt, contract) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (let i = 0; i < receipt.logs.length; i++) {
    try {
      const parsed = contract.interface.parseLog(receipt.logs[i]);
      if (!parsed) continue;
      if (parsed.name === 'LootBoxIdx') {
        out.push({
          lootboxIndex: BigInt(parsed.args.index ?? parsed.args[1]),
          day: BigInt(parsed.args.day ?? parsed.args[2]),
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
// pollRngForLootbox — view call to lootboxRngWordByIndex(uint48) (the public
// mapping getter; redeploy #7 dropped the lootboxRngWord alias). Returns 0n
// if not ready. Plan 60-03 widget polling lifecycle wraps in interval +
// AbortController-per-cycle.
// ---------------------------------------------------------------------------

/**
 * @param {bigint | number} lootboxIndex
 * @returns {Promise<bigint>} 0n if RNG not yet fulfilled OR no provider configured.
 */
export async function pollRngForLootbox(lootboxIndex) {
  const provider = getProvider();
  if (!provider) return 0n;
  const contract = _buildContract(provider);
  const word = await contract.lootboxRngWordByIndex(BigInt(lootboxIndex));
  return BigInt(word);
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
 *          ticketCostWei?:bigint, preferClaimable?:boolean}} args
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
  const payment = await _claimableFirstPaymentFor(
    contract,
    buyer,
    lootBoxAmountWei + ticketCostWei,
    args.preferClaimable !== false,
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
