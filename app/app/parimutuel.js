// /app/app/parimutuel.js — the Growth OVER/UNDER book (user ask: parimutuel
// actions in a widget while it is open).
//
// On-chain surface, verified against degenerus-audit/contracts/DegenerusParimutuel.sol:
//   GROWTH  placeBet(player, over)            round = LEVEL
//           claim(player, rounds[])
//           claimRound(round, players[])      permissionless winner crank
//           marketState(player, round)        view — book + your position
//
// The ticket-VOLUME book was excised from the contract at the run-43 re-vendor
// (audit 0bbc82a6b): placeVolumeBet/claimVolume/claimVolumeRound/
// volumeMarketState/volumeBetCredit and the VolumeBet*/VolumeRoundSealed events
// no longer exist on chain, so this module carries no volume surface.
//
// The book takes ONE fixed 1,000 FLIP bet per address per round (STAKE :66),
// burned at placement and re-minted to winners through the coinflip rail. FLIP is
// UNSCALED 18-dec on both chains (only ETH /1M-scales on testnet), so the stake is
// a plain 1000e18 on Sepolia too.
//
// Reads run through a provider, NOT a signer: the widget renders the book for a
// browsing visitor with no wallet. getProvider() when a wallet is attached,
// otherwise a lazily-built JsonRpcProvider on CHAIN.rpcUrl (the same fallback
// /beta/app/contracts.js uses).
//
// Writes follow the Phase 58 chokepoint contract — closure-form sendTx ONLY,
// with a requireStaticCall pre-flight so MarketClosed / AlreadyBet / NotEligible
// surface as copy instead of a wallet-level revert.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';
import { permissionlessReadProvider, readProviderBlockNumber } from './read-provider.js';
import { readPurchaseInfo } from './purchase-info.js';

// ---------------------------------------------------------------------------
// Inline ABI fragments — canonical signatures from DegenerusParimutuel.sol.
// DO NOT cross-import /beta/app/constants.js (Pitfall 4).
// ---------------------------------------------------------------------------

const PARIMUTUEL_ABI = [
  // -- growth book (round = level) --
  'function placeBet(address player, bool over) external',
  'function claim(address player, uint24[] rounds) external returns (uint256)',
  'function claimRound(uint24 round, address[] players) external returns (uint256)',
  'function marketState(address player, uint24 round) external view returns (uint24 openRound, uint128 overCount, uint128 underCount, uint256 questReward, uint8 side, bool claimed, uint8 outcome, uint256 payout)',
  // -- events (receipt-log-first confirmation, CF-05) --
  'event BetPlaced(address indexed player, uint24 indexed round, bool over, uint256 questReward)',
  'event BetClaimed(address indexed player, uint24 indexed round, uint8 outcome, uint256 payout)',
  'event GrowthRoundSealed(uint24 indexed round, bool over)',
  // Every revert placeBet can produce must be declared here or ethers cannot
  // name it: error.revert stays null, the registry lookup below is keyed by
  // NAME, and the real reason collapses into the generic unexpected-error
  // copy. NothingToSettle is the claim path.
  'error NotApproved()',
  'error MarketClosed()',
  'error AlreadyBet()',
  'error NotEligible()',
  'error NothingToSettle()',
  // The stake burn crosses into FLIP, so its reverts land here too. Insufficient
  // is the under-funded bet (FLIP.sol:550 — wallet balance plus coinflip
  // claimable could not cover the 1,000 FLIP stake, and :543 when an RNG lock
  // has sealed the claimable leg). OnlyGame is FLIP's caller gate (:582-588): a
  // parimutuel redeployed without FLIP's address being updated reverts every bet.
  'error Insufficient()',
  'error OnlyGame()',
];

// GAME view behind the growth book's benchmark. growthState(round) hands back
// the three ratchet terms around `round`; the book resolves OVER iff
// ratchet(L+1) * ratchet(L-1) > ratchet(L)^2 (DegenerusParimutuel.sol:21), i.e.
// iff the NEXT step's growth beats the LAST one's.
const GAME_GROWTH_ABI = [
  'function growthState(uint24 round) external view returns (uint256 ratchetPrev, uint256 ratchetRound, uint256 ratchetNext, uint24 currentLevel, bool bettingOpen, uint8 phaseDay)',
  'function jackpotPhase() external view returns (bool)',
  'function jackpotCompressionTier() external view returns (uint8)',
  'function purchaseInfo() external view returns (uint24 lvl, bool inJackpotPhase, bool lastPurchaseDay_, bool rngLocked_, uint256 priceWei)',
  'function prizePoolTargetView() external view returns (uint256)',
];

// Canonical Multicall3 deployment on Base Sepolia and Ethereum. Historical
// growth ratchets are immutable, so one batched read per level transition can
// recover every prior level's final prize pool without turning page load into
// one RPC request per level.
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[] returnData)',
];
const GROWTH_HISTORY_BATCH_SIZE = 120;

// Eligibility lives in DegenerusQuests, not in either global market quote.
// `mayBet` is the lifetime participation gate; `earnsReward` is deliberately
// stricter and is the only flag the UI may use when advertising BET BONUS.
const QUEST_MARKET_ABI = [
  'function marketBetGates(address player, uint24 lvl) external view returns (bool mayBet, bool earnsReward)',
];

/** DegenerusParimutuel.sol:66 — the single fixed Growth stake. */
export const STAKE_WEI = 1_000n * 10n ** 18n;

/** Side encoding (SIDE_OVER / SIDE_UNDER at :96-97). 0 = no bet / unsettled. */
export const SIDE_OVER = 1;
export const SIDE_UNDER = 2;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Test seam — production path uses default `new ethers.Contract(...)`.
// Mirrors coinflip.js / claims.js / passes.js.
// ---------------------------------------------------------------------------

let _contractFactory = null;
let _readProvider = null;

/** Test-only: replace the `new Contract(...)` construction with a fake. */
export function __setContractFactoryForTest(fn) {
  _contractFactory = fn;
}

// The GAME reader behind the growth benchmark has its own seam: it is a
// different contract from the parimutuel, so the book stub cannot serve it.
let _gameFactory = null;
let _growthHistoryCache = new Map();
let _growthHistoryThrough = 0;

function _clearGrowthHistoryCache() {
  _growthHistoryCache = new Map();
  _growthHistoryThrough = 0;
}

// The quest gate is a third contract, so keep its test seam separate from the
// Parimutuel and Game readers rather than making one fake impersonate all three.
let _questFactory = null;

/** Test-only: replace the GAME growth-state reader. */
export function __setGameFactoryForTest(fn) {
  _gameFactory = fn;
  _clearGrowthHistoryCache();
}

/** Test-only: restore the real GAME reader. */
export function __resetGameFactoryForTest() {
  _gameFactory = null;
  _clearGrowthHistoryCache();
}

/** Test-only: replace the QUESTS market-gate reader. */
export function __setQuestFactoryForTest(fn) { _questFactory = fn; }

/** Test-only: restore the real QUESTS market-gate reader. */
export function __resetQuestFactoryForTest() { _questFactory = null; }

function _gameContract() {
  if (_gameFactory) return _gameFactory();
  return new ethers.Contract(CONTRACTS.GAME, GAME_GROWTH_ABI, _readerProvider());
}

function _questContract() {
  if (_questFactory) return _questFactory();
  if (!CONTRACTS.QUESTS) return null;
  return new ethers.Contract(CONTRACTS.QUESTS, QUEST_MARKET_ABI, _readerProvider());
}

/** Test-only: clear the injected factory; subsequent calls use the real path. */
export function __resetContractFactoryForTest() {
  _contractFactory = null;
  _readProvider = null;
}

function _buildContract(signerOrProvider) {
  if (_contractFactory) return _contractFactory(signerOrProvider);
  return new ethers.Contract(CONTRACTS.PARIMUTUEL, PARIMUTUEL_ABI, signerOrProvider);
}

// Permissionless reads stay on the shared batched/failover transport even when
// a wallet is connected. The wallet remains exclusive to write simulations.
function _readerProvider() {
  return permissionlessReadProvider(getProvider());
}

function _readContract() {
  return _buildContract(_readerProvider());
}

// eth_getLogs chunking for readRoundWinners: public RPCs cap the block range
// (Base Sepolia: 2,000, which is why a from-zero query returned nothing at
// all), so placement-log discovery walks backwards in under-cap chunks.
const LOG_CHUNK_BLOCKS = 1800;
const LOG_CHUNK_LIMIT = 10;

/**
 * The growth book's benchmark: the ratchet terms around `round`. Growth is a
 * RATIO of consecutive prize pools, so last level's realized growth is
 * ratchetRound / ratchetPrev - 1.
 *
 * @param {{round: number}} args
 * @returns {Promise<{prev: bigint, current: bigint, next: bigint, currentLevel: number, bettingOpen: boolean, phaseDay: number}|null>}
 */
export async function readGrowthRatchets({ round } = {}) {
  const r = Number(round);
  // round 0 is the contract's intentional bootstrap/current-context read. It
  // returns zero ratchet terms plus currentLevel/phase, which is exactly what
  // the level-1 prize-pool thermometer needs in order to publish its separate
  // 50 ETH bootstrap target.
  if (!Number.isInteger(r) || r < 0) return null;
  try {
    const out = await _gameContract().growthState(r);
    return {
      prev: BigInt(out[0]),
      current: BigInt(out[1]),
      next: BigInt(out[2]),
      // Keep the contract's level beside the values. The indexer can cross a
      // level boundary a poll before the connected RPC (or vice versa), and a
      // level-less prizePoolTargetView must never be labeled as the other
      // level's target during that short disagreement.
      currentLevel: Number(out[3]),
      bettingOpen: Boolean(out[4]),
      phaseDay: Number(out[5]),
    };
  } catch (_e) {
    return null;
  }
}

async function _readGrowthHistoryTriplets(contract, centers) {
  if (_gameFactory) {
    const rows = await Promise.allSettled(
      centers.map((round) => contract.growthState(round)),
    );
    if (rows.some((row) => row.status !== 'fulfilled')) return null;
    return rows.map((row) => row.value);
  }

  try {
    const multicall = new ethers.Contract(
      MULTICALL3_ADDRESS,
      MULTICALL3_ABI,
      _readerProvider(),
    );
    const decoded = [];
    for (let offset = 0; offset < centers.length; offset += GROWTH_HISTORY_BATCH_SIZE) {
      const batch = centers.slice(offset, offset + GROWTH_HISTORY_BATCH_SIZE);
      const calls = batch.map((round) => ({
        target: CONTRACTS.GAME,
        allowFailure: true,
        callData: contract.interface.encodeFunctionData('growthState', [round]),
      }));
      const rows = await multicall.aggregate3.staticCall(calls);
      if (!rows || rows.length !== batch.length) return null;
      for (const row of rows) {
        const success = Boolean(row?.success ?? row?.[0]);
        const returnData = row?.returnData ?? row?.[1];
        if (!success || !returnData) return null;
        decoded.push(contract.interface.decodeFunctionResult('growthState', returnData));
      }
    }
    return decoded;
  } catch (_e) {
    return null;
  }
}

/**
 * Final, write-once prize pools for every completed level through `throughLevel`.
 * growthState(center) exposes center-1 / center / center+1, so centers 2, 5, 8…
 * cover the history with one third as many calls. Production batches those
 * calls through Multicall3 and caches them because completed ratchets never
 * change; test fakes keep the direct growthState surface.
 *
 * @param {{throughLevel:number}} args
 * @returns {Promise<Array<{level:number,poolWei:bigint}>|null>}
 */
export async function readGrowthRatchetHistory({ throughLevel } = {}) {
  const through = Number(throughLevel);
  if (!Number.isInteger(through) || through < 0 || through > 0xFFFFFF) return null;
  if (through === 0) return [];
  if (_growthHistoryThrough < through) {
    const firstMissing = Math.max(1, _growthHistoryThrough + 1);
    const firstGroup = Math.floor((firstMissing - 1) / 3);
    const lastGroup = Math.floor((through - 1) / 3);
    const centers = Array.from(
      { length: lastGroup - firstGroup + 1 },
      (_unused, index) => ((firstGroup + index) * 3) + 2,
    );
    const contract = _gameContract();
    const triplets = await _readGrowthHistoryTriplets(contract, centers);
    if (!triplets || triplets.length !== centers.length) return null;

    const nextCache = new Map(_growthHistoryCache);
    for (let index = 0; index < centers.length; index += 1) {
      const center = centers[index];
      const values = triplets[index];
      for (let valueIndex = 0; valueIndex < 3; valueIndex += 1) {
        const level = center + valueIndex - 1;
        if (level < 1 || level > through) continue;
        try {
          const poolWei = BigInt(values[valueIndex]);
          if (poolWei > 0n) nextCache.set(level, poolWei);
        } catch (_e) { /* malformed row: omit that notch */ }
      }
    }
    _growthHistoryCache = nextCache;
    _growthHistoryThrough = through;
  }

  return [..._growthHistoryCache.entries()]
    .filter(([level, poolWei]) => level >= 1 && level <= through && poolWei > 0n)
    .sort(([a], [b]) => a - b)
    .map(([level, poolWei]) => ({ level, poolWei }));
}

/** Contract-authoritative phase flag, last-purchase latch, and jackpot cadence. */
export async function readJackpotPhaseContext() {
  try {
    const contract = _gameContract();
    const [purchaseResult, compressionResult] = await Promise.allSettled([
      _gameFactory
        ? contract.purchaseInfo()
        : readPurchaseInfo({ provider: _readerProvider() }),
      contract.jackpotCompressionTier(),
    ]);
    let jackpot = null;
    let lastPurchaseDay = null;
    let level = null;
    let rngLocked = null;
    if (purchaseResult.status === 'fulfilled' && purchaseResult.value) {
      const purchase = purchaseResult.value;
      const rawLevel = Number(purchase?.currentLevel ?? purchase?.lvl ?? purchase?.[0]);
      level = Number.isInteger(rawLevel) && rawLevel >= 0 ? rawLevel : null;
      jackpot = Boolean(purchase?.inJackpotPhase ?? purchase?.[1]);
      lastPurchaseDay = Boolean(
        purchase?.lastPurchaseDay ?? purchase?.lastPurchaseDay_ ?? purchase?.[2],
      );
      rngLocked = Boolean(purchase?.rngLocked ?? purchase?.rngLocked_ ?? purchase?.[3]);
    } else {
      // Rolling-deploy fallback for an older reader/ABI.
      jackpot = Boolean(await contract.jackpotPhase());
    }
    // null, NOT 0. A failed read is "unknown", and 0 is a real tier meaning
    // "normal five-day phase". Reporting 0 here made a transient RPC error
    // indistinguishable from a genuine normal cadence, and the consumers use
    // `??`, which does not fall through a 0 — so one bad read masked a live
    // turbo/compressed phase behind a five-day label.
    let compressedFlag = null;
    if (compressionResult.status === 'fulfilled') {
      const tier = Number(compressionResult.value);
      if (Number.isInteger(tier) && tier >= 0) compressedFlag = tier;
    }
    return { level, jackpot, lastPurchaseDay, rngLocked, compressedFlag };
  } catch (_e) {
    return null;
  }
}

/** Contract-exact next-pool threshold. Progression is strict: nextPool > target. */
export async function readPrizePoolTarget() {
  try {
    return BigInt(await _gameContract().prizePoolTargetView());
  } catch (_e) {
    return null;
  }
}

/**
 * Realized growth from `prev` to `current`, in basis points, or null when there
 * is no prior pool to compare against (level 1, or an unbanked term).
 *
 * @returns {number|null}
 */
export function growthBps(prev, current) {
  let a = 0n;
  let b = 0n;
  try { a = BigInt(prev ?? 0); b = BigInt(current ?? 0); } catch (_e) { return null; }
  if (a <= 0n || b <= 0n) return null;
  // Signed: a level that shrank is real information, not an error.
  return Number(((b - a) * 10_000n) / a);
}

function _structuredRevertError(error, context) {
  // Insufficient is a shared FLIP selector: affiliate.js registers it globally as
  // a taken referral code and coinflip.js as a short stake, so whichever module
  // imported last would make the other lie. Keep the betting copy local to this
  // write path, the way decimator.js does for the same selector. The stake is
  // fixed at 1,000 FLIP (DegenerusParimutuel.sol:89), so there is no amount to
  // lower — the only move is to get more FLIP.
  const name = error?.revert?.name || error?.errorName || null;
  const local = {
    Insufficient: {
      code: 'Insufficient',
      userMessage: 'A bet costs 1,000 FLIP and you do not have that much.'
        + ' Wallet FLIP and claimable coinflip winnings both count toward it.',
      recoveryAction: 'Earn or claim FLIP, then place the bet.',
    },
  }[name];
  const decoded = local || decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || `Failed: ${context}`);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

/** Test-only — the write path's revert copy, including its local overrides. */
export function __structuredRevertErrorForTest(error, context) {
  return _structuredRevertError(error, context);
}

// ---------------------------------------------------------------------------
// Reads. Both views return the OPEN round alongside the queried round's book,
// so one call per round of interest covers "is the market open" AND "what is my
// position on this round" — no separate probe call.
// ---------------------------------------------------------------------------

/**
 * @param {{player?: string, round: number}} args
 * @returns {Promise<{openRound: number, overCount: bigint, underCount: bigint,
 *   questReward: bigint, side: number, claimed: boolean, outcome: number, payout: bigint}>}
 */
export async function readGrowthMarket({ player, round } = {}) {
  const r = await _readContract().marketState(player || ZERO_ADDRESS, round);
  return {
    round: Number(round),
    openRound: Number(r[0]),
    overCount: BigInt(r[1]),
    underCount: BigInt(r[2]),
    questReward: BigInt(r[3]),
    side: Number(r[4]),
    claimed: Boolean(r[5]),
    outcome: Number(r[6]),
    payout: BigInt(r[7]),
    voided: false,
  };
}

/**
 * Read the exact player-specific market gates used by both placement paths.
 * A missing player/level is not eligible; callers intentionally fail closed
 * for bonus presentation while the write's static call remains authoritative.
 */
export async function readMarketBetGates({ player, level } = {}) {
  const lvl = Number(level);
  if (!player || !Number.isInteger(lvl) || lvl <= 0) {
    return { mayBet: false, earnsReward: false };
  }
  const contract = _questContract();
  if (!contract) return { mayBet: false, earnsReward: false };
  const result = await contract.marketBetGates(player, lvl);
  return {
    mayBet: Boolean(result?.mayBet ?? result?.[0]),
    earnsReward: Boolean(result?.earnsReward ?? result?.[1]),
  };
}

/**
 * What one winning bet on `side` pays if the book closed as it stands —
 * DegenerusParimutuel.sol:718 `_payoutFrom`, stake included. The quote for a bet
 * NOT yet placed is the book plus your own stake on that side, which is what the
 * widget shows before you commit.
 *
 * @returns {bigint} FLIP wei per winner, or 0n when that side is empty.
 */
export function payoutPerWinner(overCount, underCount, side) {
  const over = BigInt(overCount || 0n);
  const under = BigInt(underCount || 0n);
  const win = side === SIDE_OVER ? over : under;
  if (win === 0n) return 0n;
  return (STAKE_WEI * (over + under)) / win;
}

// ---------------------------------------------------------------------------
// Writes — closure-form sendTx, static-call pre-flight (CF-02 / CF-03).
// ---------------------------------------------------------------------------

async function _placeBet(method, action, { player, over } = {}) {
  if (!player) throw new Error('Wallet not connected.');
  const side = Boolean(over);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(_buildContract(signer), method, [player, side], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, `static-call ${method}`);
  }

  const receipt = await sendTx((s) => _buildContract(s)[method](player, side), action);
  return { receipt };
}

/** GROWTH — bet the next level's pool-growth rate beats this level's. */
export async function placeGrowthBet({ player, over } = {}) {
  return _placeBet('placeBet', 'Growth bet', { player, over });
}

async function _claim(method, action, { player, rounds } = {}) {
  if (!player) throw new Error('Wallet not connected.');
  const list = (rounds || []).map((r) => Number(r)).filter((r) => Number.isInteger(r) && r > 0);
  if (list.length === 0) throw new Error('Nothing to claim.');

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(_buildContract(signer), method, [player, list], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, `static-call ${method}`);
  }

  const receipt = await sendTx((s) => _buildContract(s)[method](player, list), action);
  return { receipt };
}

/** Growth payouts for the named settled rounds (skips unsettled/lost/claimed). */
export async function claimGrowth({ player, rounds } = {}) {
  return _claim('claim', 'Claim growth bet', { player, rounds });
}

/**
 * Discover recent bettors on a settled round directly from indexed placement
 * logs. The caller supplies the winning count; scanning stops as soon as every
 * winner has been found, and gracefully returns a partial list when an RPC
 * history cap is reached. A partial list is still safe because the batch crank
 * skips junk/stale entries after its first race-probe player.
 */
export async function readRoundWinners({
  round,
  outcome,
  expectedCount = 0,
  maxPlayers = 100,
} = {}) {
  const r = Number(round);
  if (!Number.isInteger(r) || r <= 0 || ![SIDE_OVER, SIDE_UNDER].includes(Number(outcome))) {
    return [];
  }
  // This discovery only runs immediately before a wallet write. If the wallet
  // disappeared, do not spin up the public fallback RPC just to build a
  // best-effort community tail; the clicked player's normal claim path remains
  // available once they reconnect.
  const provider = getProvider();
  if (!provider) return [];
  const contract = _buildContract(provider);
  if (typeof provider?.getBlockNumber !== 'function'
    || typeof contract?.queryFilter !== 'function'
    || !contract?.filters) return [];

  const filterFactory = contract.filters.BetPlaced;
  if (typeof filterFactory !== 'function') return [];
  const wantOver = Number(outcome) === SIDE_OVER;
  const target = Math.min(
    Math.max(0, Number(expectedCount) || 0),
    Math.max(1, Number(maxPlayers) || 100),
  );
  const found = new Map();

  let head;
  try { head = Number(await readProviderBlockNumber(provider, { maxAgeMs: 0 })); }
  catch (_e) { return []; }
  if (!Number.isFinite(head) || head < 0) return [];

  for (let i = 0; i < LOG_CHUNK_LIMIT; i += 1) {
    const to = head - i * LOG_CHUNK_BLOCKS;
    if (to < 0) break;
    const from = Math.max(0, to - LOG_CHUNK_BLOCKS + 1);
    let logs;
    try {
      logs = await contract.queryFilter(filterFactory(null, r), from, to);
    } catch (_e) {
      return Array.from(found.values());
    }
    for (const log of logs || []) {
      const args = log?.args || [];
      const over = Boolean(args.over ?? args[2]);
      const player = String(args.player ?? args[0] ?? '');
      if (over !== wantOver || !/^0x[0-9a-fA-F]{40}$/.test(player)) continue;
      found.set(player.toLowerCase(), player);
      if (target > 0 && found.size >= target) return Array.from(found.values());
      if (found.size >= maxPlayers) return Array.from(found.values());
    }
    if (from === 0) break;
  }
  return Array.from(found.values());
}

async function _claimWinnerBatch(method, fallbackMethod, action, {
  player,
  round,
  players = [],
} = {}) {
  if (!player) throw new Error('Wallet not connected.');
  const r = Number(round);
  if (!Number.isInteger(r) || r <= 0) throw new Error('Invalid round.');
  const ordered = [];
  const seen = new Set();
  for (const address of [player, ...(Array.isArray(players) ? players : [])]) {
    if (!address) continue;
    const key = String(address).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(String(address));
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  const contract = _buildContract(signer || provider);
  // Compatibility with older test/deploy seams: the player's ordinary
  // permissionless claim remains correct, only the community tail is omitted.
  if (typeof contract?.[method] !== 'function') {
    return _claim(fallbackMethod, action, { player, rounds: [r] });
  }
  if (signer) {
    const sim = await requireStaticCall(contract, method, [r, ordered], signer);
    if (!sim.ok) throw _structuredRevertError(sim.error, `static-call ${method}`);
  }
  const receipt = await sendTx((s) => _buildContract(s)[method](r, ordered), action);
  return { receipt, players: ordered };
}

/** Settle this growth winner first, then every discovered winner in the round. */
export async function claimGrowthRound({ player, round, players } = {}) {
  return _claimWinnerBatch('claimRound', 'claim', 'Settle growth-bet winners', {
    player, round, players,
  });
}

// ---------------------------------------------------------------------------
// Reason-map registrations — the parimutuel's own custom errors (:136-155).
// NotApproved is already registered by Phase 60 — do NOT re-register.
// ---------------------------------------------------------------------------

register('MarketClosed', {
  code: 'MarketClosed',
  userMessage: 'Betting is closed for this round.',
  recoveryAction: 'Wait for the next window to open.',
});

register('AlreadyBet', {
  code: 'AlreadyBet',
  userMessage: 'You already have a bet on this round — one per round.',
  recoveryAction: 'Wait for the round to settle.',
});

register('NotEligible', {
  code: 'NotEligible',
  userMessage: 'You need to have bought something before you can bet on the game.',
  recoveryAction: 'Buy a ticket or a luckbox first.',
});

register('NothingToSettle', {
  code: 'NothingToSettle',
  userMessage: 'Nothing to settle on that round.',
  recoveryAction: 'Refresh and check your open positions.',
});

// FLIP's burn gate, not a betting condition: it can only fire when this
// contract is not the PARIMUTUEL address FLIP was deployed against.
register('OnlyGame', {
  code: 'OnlyGame',
  userMessage: 'The betting contract is not wired to FLIP on this deployment.',
  recoveryAction: 'Report this — betting cannot work until it is fixed.',
});
