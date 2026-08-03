// /app/app/parimutuel.js — the two OVER/UNDER books (user ask: parimutuel
// actions in a widget while they are open).
//
// On-chain surface, verified against degenerus-audit/contracts/DegenerusParimutuel.sol:
//   GROWTH  placeBet(player, over)            :257   round = LEVEL
//           claim(player, rounds[])           :303
//           marketState(player, round)         :759   view — book + your position
//   VOLUME  placeVolumeBet(player, over)      :440   round = day index + 1
//           claimVolume(player, rounds[])     :499
//           volumeMarketState(player, round)  :611   view — adds the `voided` case
//           volumeBetCredit()                 :485   view — the decaying placement credit
//
// Both books take ONE fixed 1,000 FLIP bet per address per round (STAKE :66),
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
import { CHAIN, CONTRACTS, VOLUME_WINDOW } from './chain-config.js';

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
  // -- ticket-volume book (round = day index + 1) --
  'function placeVolumeBet(address player, bool over) external',
  'function claimVolume(address player, uint24[] rounds) external returns (uint256)',
  'function claimVolumeRound(uint24 round, address[] players) external returns (uint256)',
  'function volumeMarketState(address player, uint24 round) external view returns (uint24 openRound, uint128 overCount, uint128 underCount, uint8 side, bool claimed, uint8 outcome, bool voided, uint256 payout)',
  'function volumeBetCredit() external view returns (uint256)',
  // -- events (receipt-log-first confirmation, CF-05) --
  'event BetPlaced(address indexed player, uint24 indexed round, bool over, uint256 questReward)',
  'event VolumeBetPlaced(address indexed player, uint24 indexed round, bool over, uint256 credit)',
  'event BetClaimed(address indexed player, uint24 indexed round, uint8 outcome, uint256 payout)',
  'event VolumeBetClaimed(address indexed player, uint24 indexed round, uint8 outcome, uint256 payout)',
  // The seal carries the volume series the contract does not keep readable
  // (lastVolumeRound / prevVolume are private): `total` is the round's own
  // volume and `previous` the benchmark it was scored against, both in RAW
  // PURCHASE UNITS — 400 = one whole ticket.
  'event VolumeRoundSealed(uint24 indexed round, uint48 total, uint48 previous)',
  'error NothingToSettle()',
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
  // Emitted from the mint module through GAME delegatecall. Summing these
  // after the previous volume seal reconstructs the live manual-ticket count
  // without reading the packed storage slot directly.
  'event EntriesBought(address indexed buyer, uint256 entryQuantityScaled, uint256 weiIn)',
];

// Eligibility lives in DegenerusQuests, not in either global market quote.
// `mayBet` is the lifetime participation gate; `earnsReward` is deliberately
// stricter and is the only flag the UI may use when advertising BET BONUS.
const QUEST_MARKET_ABI = [
  'function marketBetGates(address player, uint24 lvl) external view returns (bool mayBet, bool earnsReward)',
];

/** Raw purchase units per whole ticket (4 entries x QTY_SCALE 100). */
export const UNITS_PER_TICKET = 400n;

/** DegenerusParimutuel.sol:66 — the single fixed stake, both books. */
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

// The quest gate is a third contract, so keep its test seam separate from the
// Parimutuel and Game readers rather than making one fake impersonate all three.
let _questFactory = null;

/** Test-only: replace the GAME growth-state reader. */
export function __setGameFactoryForTest(fn) { _gameFactory = fn; }

/** Test-only: restore the real GAME reader. */
export function __resetGameFactoryForTest() { _gameFactory = null; }

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

// Wallet provider when one is attached, else the chain's public RPC. Cached so a
// 5s poll cycle does not rebuild a JsonRpcProvider per tick.
function _readerProvider() {
  const wallet = getProvider();
  if (wallet) return wallet;
  if (!_readProvider) _readProvider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  return _readProvider;
}

function _readContract() {
  return _buildContract(_readerProvider());
}

/**
 * The most recent sealed volume round — "what the current round has to beat".
 *
 * Sealed volume is only in the logs (lastVolumeRound / prevVolume are private),
 * and public RPCs cap eth_getLogs at a block range (Base Sepolia: 2,000, which
 * is why a from-zero query returned nothing at all). So: walk BACKWARDS from the
 * head in under-cap chunks and stop at the first seal. A volume round is one game
 * day — ~300 blocks on the testnet overlay, ~7,200 on mainnet — so the cap below
 * reaches the previous round on both.
 *
 * @returns {Promise<{round: number, total: bigint, previous: bigint,
 *   blockNumber: number}|null>}
 */
const LOG_CHUNK_BLOCKS = 1800;
const LOG_CHUNK_LIMIT = 10;

export async function readLastVolumeSeal({ round } = {}) {
  const provider = _readerProvider();
  const contract = _readContract();
  const wantedRound = Number(round);
  const hasWantedRound = Number.isInteger(wantedRound) && wantedRound > 0;
  let head;
  try {
    head = Number(await provider.getBlockNumber());
  } catch (_e) {
    return null;
  }
  if (!Number.isFinite(head) || head <= 0) return null;

  for (let i = 0; i < LOG_CHUNK_LIMIT; i += 1) {
    const to = head - i * LOG_CHUNK_BLOCKS;
    if (to < 0) break;
    const from = Math.max(0, to - LOG_CHUNK_BLOCKS + 1);
    let logs;
    try {
      // Once volumeMarketState has told the panel the contract-authoritative
      // open round, ask for that exact adjacent seal. A generic "latest" scan
      // can legitimately return a different round while the local day clock or
      // indexer is crossing a deployment/round boundary, which used to make the
      // whole Yesterday line disappear even though its log was available.
      logs = await contract.queryFilter(
        contract.filters.VolumeRoundSealed(hasWantedRound ? wantedRound : undefined),
        from,
        to,
      );
    } catch (_e) {
      // A provider that will not serve historical logs is not an error state —
      // the book still renders, just without the benchmark line.
      return null;
    }
    if (logs && logs.length > 0) {
      // Some injected/legacy providers ignore indexed filter arguments. Keep
      // the round check client-side too so an unrelated newest seal can never
      // displace the actual openRound - 1 benchmark.
      const matching = hasWantedRound
        ? logs.filter((log) => Number(log?.args?.round ?? log?.args?.[0] ?? 0) === wantedRound)
        : logs;
      if (matching.length === 0) {
        if (from === 0) break;
        continue;
      }
      const latest = matching[matching.length - 1];
      const a = latest.args;
      return {
        round: Number(a.round ?? a[0] ?? 0),
        total: BigInt(a.total ?? a[1] ?? 0),
        previous: BigInt(a.previous ?? a[2] ?? 0),
        blockNumber: Number(latest.blockNumber ?? 0),
      };
    }
    if (from === 0) break;
  }
  return null;
}

/**
 * Manual ticket volume accumulated since the preceding VolumeRoundSealed log.
 * EntriesBought carries the exact raw units fed into the volume counter
 * (400 = one whole ticket). Queries stay beneath the public-RPC range cap.
 *
 * @param {{afterBlock: number, toBlock?: number}} args
 * @returns {Promise<bigint|null>} null when the provider cannot serve logs
 */
export async function readCurrentTicketVolume({ afterBlock, toBlock } = {}) {
  const sealedAt = Number(afterBlock);
  if (!Number.isInteger(sealedAt) || sealedAt < 0) return null;

  const provider = _readerProvider();
  const contract = _gameContract();
  if (typeof contract?.queryFilter !== 'function'
    || typeof contract?.filters?.EntriesBought !== 'function') {
    return null;
  }

  let head = Number(toBlock);
  if (!Number.isInteger(head) || head < sealedAt) {
    try {
      head = Number(await provider.getBlockNumber());
    } catch (_e) {
      return null;
    }
  }
  if (!Number.isInteger(head) || head <= sealedAt) return 0n;

  let total = 0n;
  const filter = contract.filters.EntriesBought();
  for (let from = sealedAt + 1; from <= head; from += LOG_CHUNK_BLOCKS) {
    const to = Math.min(head, from + LOG_CHUNK_BLOCKS - 1);
    let logs;
    try {
      logs = await contract.queryFilter(filter, from, to);
    } catch (_e) {
      return null;
    }
    for (const log of logs || []) {
      const a = log?.args;
      try {
        total += BigInt(a?.entryQuantityScaled ?? a?.[1] ?? 0);
      } catch (_e) { /* malformed decoration log: ignore it */ }
    }
  }
  return total;
}

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

/** Contract-authoritative phase flag, last-purchase latch, and jackpot cadence. */
export async function readJackpotPhaseContext() {
  try {
    const contract = _gameContract();
    let jackpot;
    let lastPurchaseDay = null;
    try {
      const purchase = await contract.purchaseInfo();
      jackpot = Boolean(purchase?.inJackpotPhase ?? purchase?.[1]);
      lastPurchaseDay = Boolean(purchase?.lastPurchaseDay_ ?? purchase?.[2]);
    } catch (_e) {
      // Rolling-deploy fallback for an older reader/ABI.
      jackpot = Boolean(await contract.jackpotPhase());
    }
    let compressedFlag = 0;
    try { compressedFlag = Number(await contract.jackpotCompressionTier()); }
    catch (_e) { /* old deploy / transient read: ordinary cadence is conservative */ }
    return { jackpot, lastPurchaseDay, compressedFlag };
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
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || `Failed: ${context}`);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
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
 * @param {{player?: string, round: number}} args
 * @returns {Promise<{openRound: number, overCount: bigint, underCount: bigint,
 *   side: number, claimed: boolean, outcome: number, voided: boolean, payout: bigint}>}
 */
export async function readVolumeMarket({ player, round } = {}) {
  const r = await _readContract().volumeMarketState(player || ZERO_ADDRESS, round);
  return {
    round: Number(round),
    openRound: Number(r[0]),
    overCount: BigInt(r[1]),
    underCount: BigInt(r[2]),
    questReward: 0n,
    side: Number(r[3]),
    claimed: Boolean(r[4]),
    outcome: Number(r[5]),
    voided: Boolean(r[6]),
    payout: BigInt(r[7]),
  };
}

/** FLIP the volume placement credit pays right now (decays through the window). */
export async function readVolumeCredit() {
  return BigInt(await _readContract().volumeBetCredit());
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
// Clock — display only. The contract's `openRound` is the authority for whether
// a bet can be placed; this drives the countdown copy and the poll cadence.
// Formula mirrors _openVolumeRound (:477) with the profile's chain constants.
// ---------------------------------------------------------------------------

// Test seam — the window is wall-clock driven, so a test that did not pin the
// clock would pass or fail depending on when it ran (the testnet window is 26s
// out of every 600s).
let _clock = null;

/** Test-only: pin the clock these helpers read, in Unix seconds. */
export function __setClockForTest(fn) { _clock = fn; }

/** Test-only: hand the clock back to Date.now. */
export function __resetClockForTest() { _clock = null; }

function _nowSeconds(override) {
  if (Number.isFinite(override)) return Math.floor(override);
  if (_clock) return Math.floor(_clock());
  return Math.floor(Date.now() / 1000);
}

/**
 * @param {number} [nowSeconds] Unix seconds (defaults to the local clock).
 * @returns {{open: boolean, secondsToClose: number, secondsToOpen: number}}
 */
export function volumeWindow(nowSeconds) {
  const { anchor, period, openSeconds } = VOLUME_WINDOW;
  const now = _nowSeconds(nowSeconds);
  // JS % keeps the sign of the dividend; the anchor is in the past on both
  // chains, but guard anyway so a mocked clock can't produce a negative phase.
  const phase = (((now - anchor) % period) + period) % period;
  if (phase < openSeconds) {
    return { open: true, secondsToClose: openSeconds - phase, secondsToOpen: 0 };
  }
  return { open: false, secondsToClose: 0, secondsToOpen: period - phase };
}

/**
 * The round a volume bet placed now would join — `currentDayIndex() + 1` (:479),
 * and day indices are DEPLOY-relative (GameTimeLib:34, day 1 = deploy day), so
 * this is a small number, not an epoch-scale one.
 *
 * @returns {number} the open round, or 0 when the chain profile has no deploy
 *   boundary yet (mainnet pre-cutover) — callers then take the round off the
 *   contract's own `openRound` instead of computing it.
 */
export function volumeRoundNow(nowSeconds) {
  const { anchor, period, deployDayBoundary } = VOLUME_WINDOW;
  if (!Number.isFinite(deployDayBoundary)) return 0;
  const boundary = Math.floor((_nowSeconds(nowSeconds) - anchor) / period);
  return (boundary - deployDayBoundary + 1) + 1;
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

/** VOLUME — bet today's manual ETH ticket volume beats the previous round's. */
export async function placeVolumeBet({ player, over } = {}) {
  return _placeBet('placeVolumeBet', 'Volume bet', { player, over });
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

/** Volume payouts — a winner's share, or the stake back on a voided round. */
export async function claimVolume({ player, rounds } = {}) {
  return _claim('claimVolume', 'Claim volume bet', { player, rounds });
}

/**
 * Discover recent bettors on a settled round directly from indexed placement
 * logs. The caller supplies the winning count; scanning stops as soon as every
 * winner has been found, and gracefully returns a partial list when an RPC
 * history cap is reached. A partial list is still safe because the batch crank
 * skips junk/stale entries after its first race-probe player.
 */
export async function readRoundWinners({
  kind,
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

  const eventName = kind === 'volume' ? 'VolumeBetPlaced' : 'BetPlaced';
  const filterFactory = contract.filters[eventName];
  if (typeof filterFactory !== 'function') return [];
  const wantOver = Number(outcome) === SIDE_OVER;
  const target = Math.min(
    Math.max(0, Number(expectedCount) || 0),
    Math.max(1, Number(maxPlayers) || 100),
  );
  const found = new Map();

  let head;
  try { head = Number(await provider.getBlockNumber()); }
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

/** Settle this volume winner first, then every discovered winner in the round. */
export async function claimVolumeRound({ player, round, players } = {}) {
  return _claimWinnerBatch('claimVolumeRound', 'claimVolume', 'Settle volume-bet winners', {
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
  recoveryAction: 'Buy a ticket or a lootbox first.',
});

register('NothingToSettle', {
  code: 'NothingToSettle',
  userMessage: 'Nothing to settle on that round.',
  recoveryAction: 'Refresh and check your open positions.',
});
