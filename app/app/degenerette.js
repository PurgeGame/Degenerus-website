// /app/app/degenerette.js — Phase 62 Plan 62-03 (BUY-05 write path).
//
// Degenerette two-tx bet flow: placeBet (single tx, emits DegeneretteBetPlaced) → poll
// the indexed word / simulate the exact resolver until ready → resolveBets (single tx,
// emits DegeneretteResolved + DegeneretteResult per spin).
//
// On-chain surfaces (verified against degenerus-audit/contracts/):
//   - DegenerusGame.sol:714 — placeDegeneretteBet(player, currency, amount, count, customTicket, heroQuadrant) payable
//   - DegenerusGame.sol:743 — resolveDegeneretteBets(player, betIds[])
//   - DegeneretteModule.sol — DegeneretteBetPlaced / DegeneretteResolved / DegeneretteResult events.
//
// The resolve events were declared here as FullTicketResolved / FullTicketResult
// until 2026-07-29 — names the contract has not used since the ticket→spin
// rename. Wrong name = no matching topic = every resolve parsed as zero events,
// so the panel could only ever say "receipt parse incomplete". Checked against
// degenerus-sim/deployments/abis/GAME_DEGENERETTE_MODULE.json.
//
// RESEARCH R5 confirmed two-tx flow + RNG keying:
//   - placeDegeneretteBet emits DegeneretteBetPlaced(player, index, betId, packed) where
//     `index` is the lootbox-RNG index this bet ties to.
//   - RNG resolution is shared with the lootbox subsystem. The exact word is an
//     indexer projection; the deployed contract exposes readiness safely by
//     simulating resolveDegeneretteBets (there is no public word getter).
//   - resolveDegeneretteBets walks each betId, decodes RNG, emits
//     DegeneretteResolved (per bet) + DegeneretteResult (per spin within bet).
//
// RESEARCH Q7 — WWXRP (currency 3) deferred from Phase 62 — UI restricts
// currency to ETH (0) + FLIP (1). Currency 2 → UnsupportedCurrency revert.
//
// Reason-map codes owned here:
//   - InvalidBet          (DegeneretteModule.sol:55) — zero amount, below min, invalid spec.
//   - UnsupportedCurrency (DegeneretteModule.sol:58) — currency==2 (or any unrecognized).
//   - BatchAlreadyTaken   — item-zero race signal from the public keeper batch.
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
import { CONTRACTS, ETH_DIVISOR } from './chain-config.js';
import { getActingAddress } from './store.js';
import { claimableFirstPayment } from './lootbox.js';

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
  // Permissionless cross-player keeper batch. Item zero is the race-safe probe;
  // later stale/not-ready rows are skipped independently.
  'function degeneretteResolve(address[] calldata players, uint64[] calldata betIds) external',
  'function degeneretteBetInfo(address player, uint64 betId) external view returns (uint256 packed)',
  'function claimableWinningsOf(address player) external view returns (uint256)',
  'function playerActivityScore(address player) external view returns (uint256 scorePoints)',
  'error BatchAlreadyTaken()',
  'error NoWork()',
  'error LengthMismatch()',
  // DegeneretteModule — renamed from the bare `BetPlaced` (the parimutuel now
  // owns that name); same fields, new topic0.
  'event DegeneretteBetPlaced(address indexed player, uint32 indexed index, uint64 indexed betId, uint256 packed)',
  // DegeneretteModule.sol:83 — DegeneretteResolved. resultTraits is SPIN 0's
  // house reel only; later spins are derived per spinIndex (see dgn-reels.js).
  'event DegeneretteResolved(address indexed player, uint64 indexed betId, uint8 spinCount, uint256 totalPayout, uint32 resultTraits)',
  // DegeneretteModule.sol:99 — DegeneretteResult (per-spin entry). `matches` is
  // the composite score S (0-9), not a quadrant count — the contract keeps the
  // field name for the indexer.
  'event DegeneretteResult(address indexed player, uint64 indexed betId, uint8 spinIndex, uint32 playerTraits, uint8 matches, uint256 payout)',
];

// Currency selector values (DegenerusGame.sol:709 NatSpec). Currency 2 is
// unsupported — placeDegeneretteBet reverts with UnsupportedCurrency.
const DEGENERETTE_CURRENCY = Object.freeze({ ETH: 0, FLIP: 1, WWXRP: 3 });
// v48: hero quadrant is MANDATORY. DegeneretteModule.sol:495 reverts with
// InvalidBet when heroQuadrant >= 4 (including the old 0xFF "none" sentinel),
// so callers must supply 0-3; we default to quadrant 0 (A) when unspecified.
const HERO_QUADRANT_DEFAULT = 0;

// Bet bounds are PER CURRENCY and come straight off the contract's single
// validation point (DegenerusGameDegeneretteModule.sol:236-238 MAX_SPINS_*,
// :227-233 MIN_BET_*, checked together at :583-599). The UI used to cap every
// currency at 10 spins, which quietly hid 15 of the 25 ETH spins the contract
// allows (user call 2026-07-29: the UI does whatever the contract does).
//
// MIN_BET_ETH is ETH-denominated, so on the /1M-scaled testnet build the
// deployed constant is 5e9 wei, not 5e15 — verified by grepping the deployed
// module bytecode. Callers pass amounts already descaled by ETH_DIVISOR, so the
// full-scale figure below is the right thing to compare against pre-descale.
// FLIP/WWXRP minimums are unscaled on both chains (only ETH scales).
const SPINS_MIN = 1;
export const DEGENERETTE_LIMITS = Object.freeze({
  0: Object.freeze({ maxSpins: 25, minBetFullScale: 5n * 10n ** 15n, unit: 'ETH', minLabel: '0.005' }),
  1: Object.freeze({ maxSpins: 15, minBetFullScale: 100n * 10n ** 18n, unit: 'FLIP', minLabel: '100' }),
  3: Object.freeze({ maxSpins: 5, minBetFullScale: 10n ** 18n, unit: 'WWXRP', minLabel: '1' }),
});

/** Contract bounds for a currency, or null if the currency is unsupported. */
export function degeneretteLimits(currency) {
  return DEGENERETTE_LIMITS[Number(currency)] || null;
}

// ---------------------------------------------------------------------------
// Exact payout-table projection.
//
// These constants and integer operations mirror the currently deployed
// DegenerusGameDegeneretteModule. The contract has no public quote method, so
// keeping this pure projection beside the canonical write ABI lets the hidden
// rules sheet show the schedule for the ticket, Hero, currency, and activity
// score the player is actually about to submit.
// ---------------------------------------------------------------------------

const HONEST_BASE_PACKED = Object.freeze({
  0: 0x0001905a00004e1400001103000005fe000001e7000000c30000000000000000n,
  '1g': 0x0001c57f0000587000001346000006ca00000227000000dd0000000000000000n,
  '1c': 0x0001b880000055e6000012b80000069d00000218000000d60000000000000000n,
  '2g': 0x0001ef28000060910000150a0000076c0000025a000000f10000000000000000n,
  '2c': 0x0001e0c700005dc10000146f0000073300000249000000ea0000000000000000n,
  '3g': 0x0002185400006898000016c80000080b0000028c000001050000000000000000n,
  '3c': 0x00020899000065880000161e000007d200000279000000fd0000000000000000n,
  4: 0x000241430000708c0000188c000008a5000002be000001190000000000000000n,
});
const HONEST_S8 = Object.freeze({
  0: 5_124_517n,
  '1g': 5_804_753n,
  '1c': 5_638_394n,
  '2g': 6_337_987n,
  '2c': 6_153_960n,
  '3g': 6_865_005n,
  '3c': 6_663_665n,
  4: 7_388_959n,
});
const SHARED_S9 = Object.freeze([
  10_756_411n, 12_583_037n, 14_792_939n, 17_512_324n, 20_916_435n,
]);
const HONEST_BONUS_FACTORS = Object.freeze({
  0: 0x0000000002278add00000000002c86d300000000008cd6ca0000000000176ea0n,
  '1g': 0x0000000003aef46a00000000003d043e0000000000b767d900000000001b448bn,
  '1c': 0x0000000003aef46a00000000003ed11d0000000000ac8f35000000000019c09en,
  '2g': 0x0000000006442ce700000000005b52330000000000e67b0800000000001f15dan,
  '2c': 0x0000000006442ce700000000005e0d4c0000000000def66500000000001d41den,
  '3g': 0x000000000a96251f00000000008e8baa000000000133ace4000000000024a679n,
  '3c': 0x000000000a96251f000000000092da3f00000000012ed253000000000022cef8n,
  4: 0x0000000011ba25db0000000000e5669e0000000001aeccdd00000000002d2c05n,
});
const WWXRP_BASE_PACKED = Object.freeze([
  0x00005e9a00001273000004030000016c000000730000002e0000000000000000n,
  0x000070aa000015f6000004cc000001af00000089000000370000000000000000n,
  0x00008532000019f6000005aa000001fe000000a2000000410000000000000000n,
  0x00009b9a00001e5a0000069d00000254000000bd0000004c0000000000000000n,
  0x0000b330000022ed0000079d000002b1000000da000000570000000000000000n,
]);
const WWXRP_S8 = Object.freeze([
  1_210_913n, 1_442_106n, 1_704_918n, 1_991_686n, 2_293_601n,
]);
const WWXRP_BONUS_FACTORS = Object.freeze([
  0x0000000002278add00000000000ccc0200000000004153c400000000000fda8bn,
  0x0000000003aef46a00000000000f5126000000000046a39f00000000000fa6f4n,
  0x0000000006442ce7000000000013314300000000004ecda200000000000fd37an,
  0x000000000a96251f000000000019298500000000005b77db0000000000108293n,
  0x0000000011ba25db00000000002269d300000000006ee3e2000000000011eefcn,
]);

const PAYOUT_LANE_MASK = 0xFFFFFFFFn;
const FACTOR_LANE_MASK = 0xFFFFFFFFFFFFFFFFn;
const ACTIVITY_K = 305n;
const ACTIVITY_KNEE = 500n;
const ACTIVITY_CAP = 30_000n;

function _payoutKey(goldQuadrants, heroIsGold) {
  if (goldQuadrants === 0 || goldQuadrants === 4) return String(goldQuadrants);
  return `${goldQuadrants}${heroIsGold ? 'g' : 'c'}`;
}

function _curve(score, min, valueA, valueB, max) {
  const s = score < 0n ? 0n : score;
  if (s >= ACTIVITY_CAP) return max;
  if (s <= ACTIVITY_K) return min + (s * (valueA - min)) / ACTIVITY_K;
  if (s <= ACTIVITY_KNEE) {
    return valueA + ((s - ACTIVITY_K) * (valueB - valueA)) / (ACTIVITY_KNEE - ACTIVITY_K);
  }
  return valueB + ((s - ACTIVITY_KNEE) * (max - valueB)) / (ACTIVITY_CAP - ACTIVITY_KNEE);
}

function _basePayoutCentiX(goldQuadrants, score, isWwxrp, heroIsGold) {
  if (score >= 9) return SHARED_S9[goldQuadrants];
  if (score === 8) {
    return isWwxrp
      ? WWXRP_S8[goldQuadrants]
      : HONEST_S8[_payoutKey(goldQuadrants, heroIsGold)];
  }
  const packed = isWwxrp
    ? WWXRP_BASE_PACKED[goldQuadrants]
    : HONEST_BASE_PACKED[_payoutKey(goldQuadrants, heroIsGold)];
  return (packed >> (BigInt(score) * 32n)) & PAYOUT_LANE_MASK;
}

function _bonusFactor(goldQuadrants, score, isWwxrp, heroIsGold) {
  if (score < 6) return 0n;
  const packed = isWwxrp
    ? WWXRP_BONUS_FACTORS[goldQuadrants]
    : HONEST_BONUS_FACTORS[_payoutKey(goldQuadrants, heroIsGold)];
  return (packed >> (BigInt(score - 6) * 64n)) & FACTOR_LANE_MASK;
}

/**
 * Exact gross-return schedule for one Degenerette draft.
 * `multiplierHundredths` is rounded only for display; `multiplierNumerator`
 * retains the contract's exact baseCentiX × effectiveRoi numerator over 1e6.
 */
export function degenerettePayoutTable({
  customTicket = 0,
  heroQuadrant = 0,
  currency = DEGENERETTE_CURRENCY.ETH,
  activityScore = 0,
} = {}) {
  const cur = Number(currency);
  if (![DEGENERETTE_CURRENCY.ETH, DEGENERETTE_CURRENCY.FLIP, DEGENERETTE_CURRENCY.WWXRP].includes(cur)) {
    throw new Error('Unsupported Degenerette currency.');
  }
  const hero = Number(heroQuadrant);
  if (!Number.isInteger(hero) || hero < 0 || hero > 3) throw new Error('Hero quadrant must be 0-3.');
  let ticket;
  let activity;
  try { ticket = BigInt(customTicket) & 0xFFFFFFFFn; }
  catch (_e) { throw new Error('Custom ticket must be numeric.'); }
  try { activity = BigInt(activityScore); }
  catch (_e) { activity = 0n; }
  if (activity < 0n) activity = 0n;

  let goldQuadrants = 0;
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const color = Number((ticket >> BigInt(quadrant * 8 + 3)) & 7n);
    if (color === 7) goldQuadrants += 1;
  }
  const heroColor = Number((ticket >> BigInt(hero * 8 + 3)) & 7n);
  const heroIsGold = heroColor === 7;
  const isWwxrp = cur === DEGENERETTE_CURRENCY.WWXRP;
  const roiBps = isWwxrp
    ? 7_000n
    : _curve(activity, 9_000n, 9_891n, 9_970n, 9_990n);
  const highRoiBps = isWwxrp
    ? _curve(activity, 7_000n, 11_500n, 11_800n, 12_000n)
    : 0n;

  const rows = [];
  for (let score = 0; score <= 9; score += 1) {
    const basePayoutCentiX = _basePayoutCentiX(goldQuadrants, score, isWwxrp, heroIsGold);
    let effectiveRoiBps = roiBps;
    if (score >= 6) {
      let baseBonus = 0n;
      if (isWwxrp && highRoiBps > roiBps) baseBonus = highRoiBps - roiBps;
      else if (cur === DEGENERETTE_CURRENCY.ETH) baseBonus = 500n;
      if (baseBonus > 0n) {
        effectiveRoiBps += (baseBonus * _bonusFactor(
          goldQuadrants, score, isWwxrp, heroIsGold,
        )) / 1_000_000n;
      }
    }
    const multiplierNumerator = basePayoutCentiX * effectiveRoiBps;
    rows.push(Object.freeze({
      score,
      basePayoutCentiX,
      effectiveRoiBps,
      multiplierNumerator,
      multiplierDenominator: 1_000_000n,
      multiplierHundredths: (multiplierNumerator + 5_000n) / 10_000n,
    }));
  }
  return Object.freeze({
    currency: cur,
    activityScore: activity,
    goldQuadrants,
    heroIsGold,
    roiBps,
    highRoiBps,
    rows: Object.freeze(rows),
  });
}

/** Format `multiplierHundredths` without crossing through lossy Number math. */
export function formatDegeneretteMultiplier(multiplierHundredths) {
  let value;
  try { value = BigInt(multiplierHundredths); } catch (_e) { return '—'; }
  const whole = value / 100n;
  const cents = value % 100n;
  if (value === 0n) return '0×';
  return `${whole.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')}×`;
}

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
// Receipt parsing — the parse* helpers below take a parser-shaped object so
// tests can inject one. Callers that have no Contract handle should pass
// NOTHING and get receiptParser(), which decodes real logs off this module's
// own ABI. The panel used to hand in `{interface:{parseLog: (log) => log.parsed
// ?? null}}` — a test seam that returns null for every production log, so no
// resolve outcome was ever parsed on-chain (fixed 2026-07-29).
// ---------------------------------------------------------------------------

let _iface = null;

function _interface() {
  if (!_iface) _iface = new ethers.Interface(DEGENERETTE_ABI);
  return _iface;
}

/** Default log parser: real ABI decode, with the fakeDOM `log.parsed` seam. */
export function receiptParser() {
  return {
    interface: {
      parseLog: (log) => {
        if (log && log.parsed) return log.parsed;
        try { return _interface().parseLog(log); } catch (_e) { return null; }
      },
    },
  };
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
//   - currency ∈ {ETH (0), FLIP (1), WWXRP (3)} — currency 2 rejected.
//   - ticketCount ∈ [1, 10].
//   - amountPerTicketWei > 0n.
//   - heroQuadrant defaults to 0 (quadrant A) if not provided; v48 requires 0-3.
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   currency: number,
 *   amountPerTicketWei: bigint | string | number,
 *   ticketCount: number,
 *   customTicket?: number,
 *   heroQuadrant?: number,
 *   msgValueWei?: bigint | string | number,
 *   preferClaimable?: boolean,
 *   player?: string,
 *   onSubmitted?: function(import('ethers').TransactionResponse): void,
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
  preferClaimable = false,
  player,
  onSubmitted,
} = {}) {
  const buyer = player || getActingAddress();
  if (!buyer) throw new Error('Wallet not connected.');

  // Currency validation — explicit allow-list (RESEARCH Q7 — currency 2 is
  // UnsupportedCurrency on-chain; we reject it client-side too for faster UX).
  const cur = Number(currency);
  const limits = degeneretteLimits(cur);
  if (!limits) {
    throw new Error('Unsupported currency. Pick ETH, FLIP, or WWXRP.');
  }

  // Spin count — the contract's per-currency cap, not a flat one.
  const tc = Number(ticketCount);
  if (!Number.isInteger(tc) || tc < SPINS_MIN || tc > limits.maxSpins) {
    throw new Error(`Spins must be ${SPINS_MIN}-${limits.maxSpins} for ${limits.unit}.`);
  }

  // Amount per spin ≥ the contract's per-currency minimum. Callers hand ETH in
  // the CHAIN's wei scale, so multiplying by ETH_DIVISOR recovers the full-scale
  // figure the constant above is written in — exact on both chains, so this can
  // never reject a bet the contract would take.
  let amount;
  try {
    amount = BigInt(amountPerTicketWei);
  } catch (_e) {
    throw new Error('Amount must be a numeric value.');
  }
  if (amount <= 0n) {
    throw new Error('Amount must be greater than 0.');
  }
  const fullScale = cur === DEGENERETTE_CURRENCY.ETH ? amount * BigInt(ETH_DIVISOR) : amount;
  if (fullScale < limits.minBetFullScale) {
    throw new Error(`Minimum bet is ${limits.minLabel} ${limits.unit} per spin.`);
  }

  const ct = customTicket == null ? 0 : Number(customTicket);
  const hq = heroQuadrant == null ? HERO_QUADRANT_DEFAULT : Number(heroQuadrant);
  const totalBet = amount * BigInt(tc);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  const signerContract = signer ? _buildContract(signer) : null;
  let payment = claimableFirstPayment(totalBet, 0n);
  if (cur === DEGENERETTE_CURRENCY.ETH && preferClaimable && signerContract
    && typeof signerContract.claimableWinningsOf === 'function') {
    try {
      payment = claimableFirstPayment(
        totalBet,
        await signerContract.claimableWinningsOf(buyer),
      );
    } catch (_e) {
      // A quote failure must not strand the wager. Sending the full amount is
      // the safe fallback; the static-call remains the authoritative gate.
      payment = claimableFirstPayment(totalBet, 0n);
    }
  }
  const value = cur === DEGENERETTE_CURRENCY.ETH
    ? (preferClaimable ? payment.msgValueWei : BigInt(msgValueWei ?? totalBet))
    : BigInt(msgValueWei ?? 0n);

  // Static-call gate (Phase 56 D-05) — runs only if a signer is available.
  if (signer) {
    const sim = await requireStaticCall(
      signerContract,
      'placeDegeneretteBet',
      // The ETH lane is payable. Simulating it without the same value override
      // makes every otherwise-valid ETH bet revert in preflight even though
      // the real send below is correctly funded. Token lanes carry value=0,
      // so using one canonical argument list is safe for all three currencies.
      [buyer, cur, amount, tc, ct, hq, { value }],
      signer,
    );
    if (!sim.ok) throw _structuredRevertError(sim.error, 'static-call placeDegeneretteBet');
  }

  // Phase 58 chokepoint — closure form mandatory.
  const receipt = await sendTx(
    (s) => _buildContract(s).placeDegeneretteBet(buyer, cur, amount, tc, ct, hq, { value }),
    'Place degenerette bet',
    { onSubmitted },
  );
  return { receipt, payment: { ...payment, msgValueWei: value } };
}

// ---------------------------------------------------------------------------
// resolveBets — BUY-05 stage 2 — resolveDegeneretteBets after RNG ready.
// ---------------------------------------------------------------------------

/**
 * @param {{betIds: Array<bigint | number | string>, player?: string}} args
 * @returns {Promise<{receipt: import('ethers').TransactionReceipt}>}
 */
export async function resolveBets({ betIds, player } = {}) {
  const buyer = player || getActingAddress();
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

/**
 * Authoritative pending-state read. The contract deletes a bet's packed slot
 * before emitting its resolution events, so zero means it has already been
 * resolved (or never existed). `null` means the RPC/test seam cannot answer.
 */
export async function readBetInfo({ player, betId } = {}) {
  const owner = player || getActingAddress();
  if (!owner || betId == null) return null;
  const provider = getProvider();
  if (!provider) return null;
  const contract = _buildContract(provider);
  if (typeof contract.degeneretteBetInfo !== 'function') return null;
  return BigInt(await contract.degeneretteBetInfo(owner, BigInt(betId)));
}

/**
 * Side-effect-free readiness probe against the exact resolver entrypoint. The
 * deployed GAME does not expose its raw lootbox RNG mapping, so eth_call of the
 * settlement is the authoritative chain fallback while the DB word is indexing.
 */
export async function canResolveBets({ player, betIds } = {}) {
  const owner = player || getActingAddress();
  if (!owner || !Array.isArray(betIds) || betIds.length === 0) return false;
  const provider = getProvider();
  if (!provider) return false;
  let ids;
  try { ids = betIds.map((id) => BigInt(id)); }
  catch (_e) { return false; }
  const contract = _buildContract(provider);
  if (typeof contract?.resolveDegeneretteBets?.staticCall !== 'function') return false;
  try {
    await contract.resolveDegeneretteBets.staticCall(owner, ids);
    return true;
  } catch (_e) {
    return false;
  }
}

const REPLAY_LOG_CHUNK_BLOCKS = 1800;
const REPLAY_LOG_CHUNK_LIMIT = 10;

/**
 * Recover an already-resolved bet directly from its indexed chain events.
 * This is the race-proof fallback while the REST indexer is catching up:
 * both event topics include player+betId, and the backwards scan stays below
 * the public RPC's block-range cap.
 *
 * @returns {Promise<{
 *   resolved: {player:string,betId:bigint,spinCount:bigint,totalPayout:bigint,resultTraits:bigint},
 *   spins: Array<{player:string,betId:bigint,spinIndex:bigint,playerTraits:bigint,matches:bigint,payout:bigint}>,
 *   receipt?: import('ethers').TransactionReceipt|null
 * }|null>}
 */
export async function readResolvedBet({ player, betId } = {}) {
  const owner = player || getActingAddress();
  if (!owner || betId == null) return null;
  let id;
  try { id = BigInt(betId); } catch (_e) { return null; }
  const provider = getProvider();
  if (!provider || typeof provider.getBlockNumber !== 'function') return null;
  const contract = _buildContract(provider);
  if (typeof contract?.queryFilter !== 'function'
    || typeof contract?.filters?.DegeneretteResolved !== 'function'
    || typeof contract?.filters?.DegeneretteResult !== 'function') return null;

  let head;
  try { head = Number(await provider.getBlockNumber()); }
  catch (_e) { return null; }
  if (!Number.isFinite(head) || head < 0) return null;

  for (let i = 0; i < REPLAY_LOG_CHUNK_LIMIT; i += 1) {
    const to = head - i * REPLAY_LOG_CHUNK_BLOCKS;
    if (to < 0) break;
    const from = Math.max(0, to - REPLAY_LOG_CHUNK_BLOCKS + 1);
    let resolvedLogs;
    let resultLogs;
    try {
      [resolvedLogs, resultLogs] = await Promise.all([
        contract.queryFilter(contract.filters.DegeneretteResolved(owner, id), from, to),
        contract.queryFilter(contract.filters.DegeneretteResult(owner, id), from, to),
      ]);
    } catch (_e) {
      return null;
    }
    const resolvedLog = Array.isArray(resolvedLogs) ? resolvedLogs.at(-1) : null;
    if (resolvedLog) {
      const a = resolvedLog.args || [];
      const resolved = {
        player: String(a.player ?? a[0] ?? owner),
        betId: BigInt(a.betId ?? a[1] ?? id),
        spinCount: BigInt(a.spinCount ?? a[2] ?? 0),
        totalPayout: BigInt(a.totalPayout ?? a[3] ?? 0),
        resultTraits: BigInt(a.resultTraits ?? a[4] ?? 0),
        transactionHash: resolvedLog.transactionHash == null
          ? null
          : String(resolvedLog.transactionHash).toLowerCase(),
      };
      const spins = (Array.isArray(resultLogs) ? resultLogs : []).map((log) => {
        const row = log?.args || [];
        return {
          player: String(row.player ?? row[0] ?? owner),
          betId: BigInt(row.betId ?? row[1] ?? id),
          spinIndex: BigInt(row.spinIndex ?? row[2] ?? 0),
          playerTraits: BigInt(row.playerTraits ?? row[3] ?? 0),
          matches: BigInt(row.matches ?? row[4] ?? 0),
          payout: BigInt(row.payout ?? row[5] ?? 0),
        };
      }).sort((a, b) => Number(a.spinIndex - b.spinIndex));
      // A valid settled bet always emits one Result per spin. If the RPC
      // returned a temporarily incomplete pair, let the indexer retry path
      // handle it instead of fabricating a partial animation.
      const expected = Math.max(1, Number(resolved.spinCount));
      const indexes = new Set(spins.map((spin) => Number(spin.spinIndex)));
      const complete = spins.length >= expected
        && Array.from({ length: expected }, (_, spin) => indexes.has(spin)).every(Boolean);
      if (complete) {
        let receipt = null;
        const transactionHash = resolvedLog.transactionHash == null
          ? null : String(resolvedLog.transactionHash);
        if (transactionHash && typeof provider.getTransactionReceipt === 'function') {
          try { receipt = await provider.getTransactionReceipt(transactionHash); }
          catch (_e) { receipt = null; }
        }
        return { resolved, spins, receipt, transactionHash };
      }
    }
    if (from === 0) break;
  }
  return null;
}

/**
 * Resolve the clicked bet first, then opportunistically settle other players'
 * pending bets in the same transaction. The on-chain `degeneretteResolve`
 * entrypoint guarantees item zero is the race probe and isolates every later
 * item, so stale community candidates cannot brick the user's resolution.
 *
 * Older test/deploy seams without `degeneretteResolve` fall back to the
 * single-player resolver and intentionally drop the opportunistic tail.
 *
 * @param {{
 *   player?: string,
 *   betId: bigint|number|string,
 *   candidates?: Array<{player:string, betId:bigint|number|string}>
 * }} args
 */
export async function resolveCommunityBets({ player, betId, candidates = [] } = {}) {
  const owner = player || getActingAddress();
  if (!owner) throw new Error('Wallet not connected.');
  if (betId == null) throw new Error('betId is required.');

  const rows = [];
  const seen = new Set();
  const add = (candidatePlayer, candidateBetId) => {
    if (!candidatePlayer || candidateBetId == null) return;
    let id;
    try { id = BigInt(candidateBetId); } catch (_e) { return; }
    const address = String(candidatePlayer);
    const key = `${address.toLowerCase()}:${String(id)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ player: address, betId: id });
  };
  add(owner, betId);
  for (const row of Array.isArray(candidates) ? candidates : []) {
    add(row?.player, row?.betId);
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  const probeContract = _buildContract(signer || provider);
  const hasCommunityBatch = typeof probeContract?.degeneretteResolve === 'function';
  const method = hasCommunityBatch ? 'degeneretteResolve' : 'resolveDegeneretteBets';
  const args = hasCommunityBatch
    ? [rows.map((row) => row.player), rows.map((row) => row.betId)]
    : [owner, [rows[0].betId]];

  if (signer) {
    const sim = await requireStaticCall(probeContract, method, args, signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, `static-call ${method}`);
  }

  const receipt = await sendTx(
    (s) => _buildContract(s)[method](...args),
    rows.length > 1 ? 'Resolve community degenerette bets' : 'Resolve degenerette bet',
  );
  return {
    receipt,
    players: hasCommunityBatch ? rows.map((row) => row.player) : [owner],
    betIds: hasCommunityBatch ? rows.map((row) => row.betId) : [rows[0].betId],
  };
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
export function parseBetPlacedFromReceipt(receipt, contract = receiptParser()) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'DegeneretteBetPlaced') {
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
// parseBetResolvedFromReceipt — extracts DegeneretteResolved entries.
// One entry per resolved bet; per-spin detail comes from DegeneretteResult.
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {{interface: {parseLog: Function}}} [contract]
 * @returns {Array<{player: string, betId: bigint, spinCount: bigint, totalPayout: bigint, resultTraits: bigint}>}
 */
export function parseBetResolvedFromReceipt(receipt, contract = receiptParser()) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'DegeneretteResolved') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          betId: BigInt(parsed.args.betId ?? parsed.args[1]),
          spinCount: BigInt(parsed.args.spinCount ?? parsed.args[2]),
          totalPayout: BigInt(parsed.args.totalPayout ?? parsed.args[3]),
          resultTraits: BigInt(parsed.args.resultTraits ?? parsed.args[4]),
          transactionHash: String(
            log?.transactionHash || receipt.hash || receipt.transactionHash || '',
          ).toLowerCase() || null,
        });
      }
    } catch (_e) {
      // skip
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseSpinResultsFromReceipt — extracts per-spin DegeneretteResult entries.
// `matches` is the composite score S (0-9); `payout` is that spin's own payout
// BEFORE the FLIP survival flip (which doubles or zeroes the bet total).
// ---------------------------------------------------------------------------

/**
 * @param {import('ethers').TransactionReceipt | null | undefined} receipt
 * @param {{interface: {parseLog: Function}}} [contract]
 * @returns {Array<{player: string, betId: bigint, spinIndex: bigint, playerTraits: bigint, matches: bigint, payout: bigint}>}
 */
export function parseSpinResultsFromReceipt(receipt, contract = receiptParser()) {
  const out = [];
  if (!receipt || !Array.isArray(receipt.logs)) return out;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'DegeneretteResult') {
        out.push({
          player: String(parsed.args.player ?? parsed.args[0]),
          betId: BigInt(parsed.args.betId ?? parsed.args[1]),
          spinIndex: BigInt(parsed.args.spinIndex ?? parsed.args[2]),
          playerTraits: BigInt(parsed.args.playerTraits ?? parsed.args[3]),
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
// Reason-map registrations — input validation plus the public-batch race code.
//
// InvalidBet          (DegeneretteModule.sol:55) — zero amount, below min,
//                     invalid spec, etc.
// UnsupportedCurrency (DegeneretteModule.sol:58) — currency==2 path.
//
// RngNotReady is already registered by Phase 56 baseline (R11) — DO NOT
// re-register.
// ---------------------------------------------------------------------------

register('InvalidBet', {
  code: 'InvalidBet',
  userMessage: 'Invalid bet — check amount, count, and inputs.',
  recoveryAction: 'Adjust your bet and try again.',
});

register('UnsupportedCurrency', {
  code: 'UnsupportedCurrency',
  userMessage: 'That currency is not supported.',
  recoveryAction: 'Pick ETH or FLIP.',
});

register('BatchAlreadyTaken', {
  code: 'BatchAlreadyTaken',
  userMessage: 'That bet was already resolved by another wallet.',
  recoveryAction: 'Replay the indexed result.',
});
