// FlipCraps contract adapter. The active testnet profile points at CrapsBattle;
// undeployed profiles still degrade reads cleanly and fail writes with a clear
// message. Wager values supplied by the table use whole FLIP for display while
// scheduled-entry calldata contains only the packed chip board and multiplier.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { get } from './store.js';
import { CHAIN, CONTRACTS, CRAPS_SCHEDULE } from './chain-config.js';
// READ transport only. Everything money-in below still goes wallet -> contract,
// and the lobby window keeps its eth_getLogs path as a fallback, so a dead API
// costs the lobby bandwidth rather than correctness.
import { fetchCrapsEventsJSON } from './craps-events.js';
import {
  permissionlessReadProvider,
  readContractStorage,
  readProviderBlockNumber,
} from './read-provider.js';

// THE DEPLOYED SURFACE, AND NOTHING ELSE. Generated from the verified
// CrapsBattle artifact whose runtime bytecode matches the deployed contract
// byte for byte, so every entry here is one the chain will actually answer.
//
// ⛔ CrapsBattle sits a few hundred bytes under EIP-170 and the whole standalone
// TABLE read surface was cut to fit — `wordAt`, `currentIndex`, `isResolved`,
// `survivedAt`, `shooterDice`, `betOf`, `resolveBets`, `maxOddsFor`,
// `rakeBpsFor`, `placeBet`, `placeSlip`, `quote`, `theoFor` and the `resolve*At`
// previews are ALL absent. Calling one reverts with NO revert data, which every
// caller here swallows, so a stale entry shows up as a panel that renders a dash
// forever rather than as an error. Re-verify this list against the deployed
// bytecode after any craps re-vendor: `ethers.id(sig).slice(2, 10)` must appear
// in `eth_getCode`, and the call must return data.
export const FLIP_CRAPS_ABI = Object.freeze([
  "function amendSlip(uint256 betId,uint32 chips)",
  "function applyCrapsPasses(uint24 startDay,uint8 count,bool high,uint32 chips)",
  "function armBonusWindow(uint64 slot) returns (uint48 index)",
  "function buyFutureCrapsDays(uint24 startDay,uint8 count,bool high,uint32 chips)",
  "function closeBattle(uint64 slot) returns (uint48 index)",
  "function createBattle(uint32 played,uint8 bankMult,uint16 goalMult,uint24 stakeUnits,uint16 minScore,uint40 closeTime,bool multiEntry,uint16 highRollerMult) returns (uint64 slot)",
  "function creditPasses(address player,uint32 normal,uint32 high)",
  "function deliverPasses(address player,uint32 normal,uint32 high) returns (uint24 day)",
  "function donate(bool custom,uint256 index,uint24 granules)",
  "function enterBattle(uint64 slot,uint32 chips,uint16 multiple) returns (uint256 betId)",
  "function enterBonusBattle(uint256 period,uint32 chips,uint16 multiple) returns (uint256 betId)",
  "function enterBonusDay(uint32 chips,uint16 multiple) returns (uint256 placed)",
  "function keepScheduled(uint64 budgetUnits) returns (bool progressed,uint64 slot)",
  "function openBonusDay()",
  "function previewSettlement(uint256 betId) view returns (uint256 won,uint256 paid)",
  "function progressivePool() view returns (uint256)",
  "function resolveSlot(uint64 slot,uint64 budgetUnits)",
  "function setBattleCreator(address account,bool allowed)",
  "function setVaultBoard(uint32 packed)",
  "function upgradeDayWindows(uint24 day,uint8 periodMask) returns (uint256 burned)",
  "event BattleCreatorSet(address indexed account,bool allowed)",
  "event CrapsBattleCreated(uint64 indexed slot,address indexed creator,uint256 terms)",
  "event CrapsBattleFinalized(bytes32 indexed battleKey,uint8 winningStop,uint64 winnerId,uint256 winningPeak,uint256 winningEnd,uint256 winningScoreBps,uint256 pot)",
  "event CrapsBattlePaid(uint256 indexed betId,bytes32 indexed battleKey,address indexed player,uint256 amount)",
  "event CrapsBetSettled(uint256 indexed betId,address indexed player,uint256 won,uint256 paid)",
  "event CrapsBonusArmed(bytes32 indexed battleKey,uint48 indexed slot,uint48 indexed index)",
  "event CrapsBonusDonated(bytes32 indexed battleKey,address indexed donor,uint256 amount,uint256 seed)",
  "event CrapsBonusOpened(bytes32 indexed battleKey,uint48 indexed slot,uint256 seed,uint128 bankroll,uint128 goal,uint256 boardStake,uint256 battleStake)",
  "event CrapsDayLapsed(uint24 indexed day,uint64 seats)",
  "event CrapsDayReserved(address indexed player,uint24 indexed day,bool highRoller)",
  "event CrapsDayWindowsUpgraded(address indexed player,uint24 indexed day,uint8 upgradedMask,uint256 burned)",
  "event CrapsHighRollerDayOpened(uint24 indexed day,uint16 multiplier,uint256 mainBoostBudget,uint256 highRollerBoostBudget)",
  "event CrapsHighRollerPaid(uint256 indexed betId,bytes32 indexed battleKey,address indexed player,uint256 amount,bool bankrollRider)",
  "event CrapsPassesCredited(address indexed player,bool highRoller,uint256 count)",
  "event CrapsProgressiveFunded(uint24 indexed day,uint256 contribution,uint256 balance)",
  "event CrapsProgressivePaid(uint256 indexed betId,bytes32 indexed battleKey,address indexed player,bool rare,uint16 poolBps,uint256 peak,uint256 scoreBps,uint256 candidate,uint256 paid,uint256 balance)",
  "event CrapsProgressiveRolled(bytes32 indexed battleKey,uint8 indexed source,uint256 amount,uint256 balance)",
  "event CrapsSlipAmended(uint256 indexed betId,uint256 chips)",
  "event CrapsSlipPlaced(address indexed player,uint256 bet)",
  "error AlreadyInBonus()",
  "error BadBattleTerms()",
  "error BadBurnTag()",
  "error BadEntryMultiple()",
  "error BadPassCount()",
  "error BadRandomCount()",
  "error BetLocked()",
  "error BoardPlaysBothSides()",
  "error BonusPeriodSpent()",
  "error BonusStillRunning()",
  "error DayNotReservable()",
  "error NoSuchBattle()",
  "error NoSuchBet()",
  "error NotBattleCreator()",
  "error NothingToUpgrade()",
  "error NotVaultOwner()",
  "error NotYourBet()",
  "error OnlyGame()",
  "error RngNotReady()",
  "error ScoreRequiredForBonus()",
  "error SeedAboveMax()",
  "error TooManyChipsOnALeg()",
]);

// Canonical scheduled-battle logs used by the compact tournament lobby. Keep
// these separate from the legacy table receipt ABI above: the deployed battle
// intentionally packs a slip into one word, while older fixed-table receipts
// use the wider event shape parsed elsewhere in this adapter.
export const CRAPS_LOBBY_EVENT_ABI = Object.freeze([
  'event CrapsSlipPlaced(address indexed player,uint256 bet)',
  'event CrapsSlipAmended(uint256 indexed betId,uint256 chips)',
  'event CrapsBonusOpened(bytes32 indexed battleKey,uint48 indexed slot,uint256 seed,uint128 bankroll,uint128 goal,uint256 boardStake,uint256 battleStake)',
  'event CrapsBonusDonated(bytes32 indexed battleKey,address indexed donor,uint256 amount,uint256 seed)',
  'event CrapsBonusArmed(bytes32 indexed battleKey,uint48 indexed slot,uint48 indexed index)',
  'event CrapsDayReserved(address indexed player,uint24 indexed day,bool highRoller)',
  'event CrapsDayWindowsUpgraded(address indexed player,uint24 indexed day,uint8 upgradedMask,uint256 burned)',
  'event CrapsBattleFinalized(bytes32 indexed battleKey,uint8 winningStop,uint64 winnerId,uint256 winningPeak,uint256 winningEnd,uint256 winningScoreBps,uint256 pot)',
  'event CrapsBattlePaid(uint256 indexed betId,bytes32 indexed battleKey,address indexed player,uint256 amount)',
  // The day's two boost budgets, published once when the day opens. The HIGH one
  // is the only client path to the side lane's base — there is no view for it.
  'event CrapsHighRollerDayOpened(uint24 indexed day,uint16 multiplier,uint256 mainBoostBudget,uint256 highRollerBoostBudget)',
  // Marks a window that ran a high lane, AND which shape it was. `bankrollRider`
  // is the whole distinction: false = a contested race whose boost is paid into
  // the lane pot, true = a lone seat whose boost merely RIDES its own run.
  'event CrapsHighRollerPaid(uint256 indexed betId,bytes32 indexed battleKey,address indexed player,uint256 amount,bool bankrollRider)',
  // The other half of the main allocation goes straight to Run It Up. It is
  // separate from ladder rollovers, which are already part of the boost total.
  'event CrapsProgressiveFunded(uint24 indexed day,uint256 contribution,uint256 balance)',
  // The main-field winner's Run It Up award. This is emitted in the same
  // finalization transaction as CrapsBattlePaid, so the lobby can paint an
  // actual hit without waiting for the optional indexed total projection.
  'event CrapsProgressivePaid(uint256 indexed betId,bytes32 indexed battleKey,address indexed player,bool rare,uint16 poolBps,uint256 peak,uint256 scoreBps,uint256 candidate,uint256 paid,uint256 balance)',
  // Protocol money a winner's standing would not admit, banked instead of paid.
  // Source 1 = main, 2 = contested high lane, 3 = sole high lane.
  'event CrapsProgressiveRolled(bytes32 indexed battleKey,uint8 indexed source,uint256 amount,uint256 balance)',
  // Protocol money the winner WAS awarded but received as DAY PASSES instead of FLIP.
  // `_splitAward` spends half the ADMITTED boost on passes and subtracts what it banks from
  // the liquid pot, so the FLIP payment alone UNDERSTATES the award — which is exactly how a
  // battle came to show "+269K boost" against a "158.9K" total (day 68 battle 5, run #45:
  // 2,690 boost units admitted, 5 normal passes at 22,800 = 114,000 FLIP banked).
  // banked = grossProtocol - liquidFlip. Sources match the rollover tags: 1 main,
  // 2 contested high lane, 3 sole high lane.
  'event CrapsProtocolAwardSplit(bytes32 indexed battleKey,address indexed player,uint8 indexed source,uint256 grossProtocol,uint256 liquidFlip)',
]);

const TEST_ADDRESS = '0x0000000000000000000000000000000000000001';
const CRAPS_BONUS_WINDOWS = 7;
const CRAPS_BONUS_CHIPS = 10n;
// CrapsBattle._MAX_PICKED_CHIPS — the MOST chips a board may place itself; any count 0..7 is a
// legal ticket since audit 0880d134c, and settlement scatters the complement to ten. The window
// term `postedStake` is still `(played / 10) * 7` — the ceiling, not any one slip's count.
const CRAPS_PICKED_CHIPS = 7n;
const CRAPS_FLIP_WEI = 10n ** 18n;
// The fold reads yesterday, today and tomorrow only, so the window is sized
// from the chain's day length rather than a flat block count: four days of
// blocks, floored at 1,800 and capped at the 45,000 a 12s-block mainnet day
// needs. A 1,200s testnet day therefore asks for ~2,400 blocks, not 45,000.
const CRAPS_LOG_LOOKBACK_MAX_BLOCKS = 45_000;
const CRAPS_LOG_LOOKBACK_MIN_BLOCKS = 1_800;
const CRAPS_LOG_LOOKBACK_DAYS = 4;
function crapsLogLookbackBlocks() {
  const daySeconds = Number(CRAPS_SCHEDULE?.daySeconds);
  const blockSeconds = Number(CRAPS_SCHEDULE?.blockSeconds);
  if (!(daySeconds > 0) || !(blockSeconds > 0)) return CRAPS_LOG_LOOKBACK_MAX_BLOCKS;
  const blocks = Math.ceil((CRAPS_LOG_LOOKBACK_DAYS * daySeconds) / blockSeconds);
  return Math.min(CRAPS_LOG_LOOKBACK_MAX_BLOCKS, Math.max(CRAPS_LOG_LOOKBACK_MIN_BLOCKS, blocks));
}
// Blocks re-read behind the incremental cursor so a shallow reorg cannot leave
// a rewritten log in the merged window.
const CRAPS_LOG_REORG_TAIL_BLOCKS = 12;
// CrapsBattle._SCHED_BANK_MULT — the scheduled depth is FIXED at 5 (a run
// latches its win and plays on, so depth stopped separating the formats and
// the schedule stopped drawing it). The label map survives for CUSTOM battles,
// which still name their own depth in the packed terms.
const CRAPS_SCHED_BANK_MULT = 5;
// CrapsBattle._SCHED_GOAL — FIXED AT FIVE since audit 0880d134c. The two-way 5/20 draw is gone:
// a high-water run ranks on how far it got, so a second target only multiplied downstream rules.
const CRAPS_SCHED_GOAL = 5;
const CRAPS_SPEED_LABELS = Object.freeze({ 2: 'TURBO', 5: 'NORMAL', 10: 'SLOW' });
const CRAPS_HIGH_ROLLER_TAG = 0x48696768526f6c6c6572n;
const CRAPS_BOOST_TAG = 0x426f6f7374n;
const CRAPS_BOOST_MAX_MULTIPLE = 100n;
// CrapsBattle._roundBoost: granules at or below the floor pay exact, everything
// above collapses to the NEAREST step. The contract rounds before it widens to
// wei, so a client that skips this understates a boosted window by up to half a
// step (500 FLIP) per window.
const CRAPS_BOOST_ROUND_ABOVE = 40n;
const CRAPS_BOOST_ROUND_STEP = 10n;
// LootboxCraps.LOOTBOX_RNG_WORD_SLOT. CrapsBattle keeps NO public accessor for a
// settlement word — `_wordAt` is an internal extsload into GAME — so the word is
// read straight out of GAME's storage at keccak256(abi.encode(index, 34)).
const CRAPS_SETTLEMENT_WORD_SLOT = 34n;
/** `_ROLL_SRC_MAIN` — main-winner boost denied by standing and banked instead. */
// `_SPLIT_SRC_*` reuse the rollover numbering (CrapsBattle.sol:934) — same tags, different
// question: ROLLED is protocol money standing DENIED, SPLIT is protocol money the winner got
// as passes. A battle can carry both, and they are not interchangeable.
const CRAPS_SPLIT_SRC_MAIN = 1;
const CRAPS_SPLIT_SRC_HIGH_CONTESTED = 2;
const CRAPS_SPLIT_SRC_HIGH_SOLE = 3;
// ⛔ 4 = `_SPLIT_SRC_PROGRESSIVE`, AND IT MUST NEVER BE ADDED TO A TOTAL. The progressive is the
// one lane whose event is emitted BEFORE its split (`CrapsBattle.sol:3937` then `:3942`), so
// `CrapsProgressivePaid.paid` — the figure behind `progressivePaidWei` — ALREADY contains the
// pass slice: "the WHOLE gross award leaves the pool, pass slice included". Every other lane
// emits AFTER its subtraction and therefore understates. Counting source 4 double-counts it.
const CRAPS_SPLIT_SRC_PROGRESSIVE = 4;
const CRAPS_ROLL_SRC_MAIN = 1;
/** `_ROLL_SRC_HIGH_CONTESTED` — contested high-winner boost denied by standing. */
const CRAPS_ROLL_SRC_HIGH_CONTESTED = 2;
/** `_ROLL_SRC_HIGH_SOLE` — a lone high seat's standing-denied boost, banked not staked. */
const CRAPS_ROLL_SRC_HIGH_SOLE = 3;
const CRAPS_BATTLE_STAKE_UNIT_WEI = 100n * CRAPS_FLIP_WEI;
const CRAPS_EVENT_BET_ID_SHIFT = 32n;
const CRAPS_EVENT_CHIPS_MASK = 0xFFFFFFFFn;
const CRAPS_EVENT_MULT_SHIFT = 160n;
const CRAPS_EVENT_BET_ID_MASK = (1n << 128n) - 1n;
const CRAPS_EVENT_MULT_MASK = 0xFFn;
const CRAPS_ALL_WINDOWS_MASK = 0x7F;
// CrapsBattle's deployed storage layout keeps `_passCredits` at mapping slot
// 15. There is deliberately no public getter in the size-constrained contract,
// so the wallet reads its own two packed uint32 balances directly. This value
// is deployment-coupled in the same way as CONTRACTS.CRAPS and must be checked
// whenever that address is replaced.
const CRAPS_PASS_CREDITS_MAPPING_SLOT = 15n;
const CRAPS_PASS_COUNT_MASK = 0xFFFFFFFFn;
export const CRAPS_FUTURE_DAY_PRICES = Object.freeze({ normal: 25_000n, high: 450_000n });
// Tomorrow's word has not landed yet, but the shipped preset has exact face-cost
// bounds. Routine windows span 400..6,000 FLIP and the event spans
// 1,800..90,000, so an ordinary seven-window slate spans 4,200..126,000.
// The High Roller lane adopts tomorrow's still-unknown 10x/100x draw.
export const CRAPS_FUTURE_DAY_FACE_RANGES = Object.freeze({
  normal: Object.freeze({
    low: 4_200n,
    high: 126_000n,
    wager: Object.freeze({ low: 3_300n, high: 78_000n }),
    battle: Object.freeze({ low: 900n, high: 48_000n }),
  }),
  high: Object.freeze({
    low: 42_000n,
    high: 12_600_000n,
    wager: Object.freeze({ low: 33_000n, high: 7_800_000n }),
    battle: Object.freeze({ low: 9_000n, high: 4_800_000n }),
  }),
});
let _contractFactory = null;
let _addressOverride;
let _readProvider = null;
let _iface = null;
let _lobbyIface = null;

function contractAddress() {
  return _addressOverride === undefined ? CONTRACTS.CRAPS : _addressOverride;
}

export function isCrapsAvailable() {
  const address = contractAddress();
  return typeof address === 'string' && ethers.isAddress(address) && address !== ethers.ZeroAddress;
}

function requireCraps() {
  if (!isCrapsAvailable()) throw new Error('FLIP Craps is not deployed on this network yet.');
}

function readerProvider() {
  return permissionlessReadProvider(getProvider());
}

function buildContract(runner) {
  if (_contractFactory) return _contractFactory(runner);
  return new ethers.Contract(contractAddress(), FLIP_CRAPS_ABI, runner);
}

function readContract() {
  requireCraps();
  const provider = readerProvider();
  if (!provider) throw new Error('No chain read provider is available.');
  return buildContract(provider);
}

function interfaceForCraps() {
  if (!_iface) _iface = new ethers.Interface(FLIP_CRAPS_ABI);
  return _iface;
}

function interfaceForCrapsLobby() {
  if (!_lobbyIface) _lobbyIface = new ethers.Interface(CRAPS_LOBBY_EVENT_ABI);
  return _lobbyIface;
}

function asUint(value, label) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch (_error) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
}

export function decodeCrapsPassCredits(value) {
  const packed = asUint(value, 'Craps comp balance');
  return Object.freeze({
    normal: Number(packed & CRAPS_PASS_COUNT_MASK),
    high: Number((packed >> 32n) & CRAPS_PASS_COUNT_MASK),
  });
}

export function crapsPassCreditsStorageKey(player) {
  if (!ethers.isAddress(String(player ?? ''))) throw new Error('Choose a valid player to read Craps comps.');
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256'],
    [ethers.getAddress(String(player)), CRAPS_PASS_CREDITS_MAPPING_SLOT],
  ));
}

/** Read the two uncommitted Craps comp lanes from the deployed packed mapping. */
export async function readCrapsPassCredits(player) {
  requireCraps();
  const provider = readerProvider();
  if (!provider) throw new Error('The chain provider cannot read Craps comp balances.');
  const packed = await readContractStorage(
    contractAddress(),
    crapsPassCreditsStorageKey(player),
    { provider },
  );
  return decodeCrapsPassCredits(packed);
}

function hashPair(first, second) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256'],
    [first, second],
  );
  return BigInt(ethers.keccak256(encoded));
}

function hashTriple(first, second, third) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256', 'uint256'],
    [first, second, third],
  );
  return BigInt(ethers.keccak256(encoded));
}

function bonusRoll(word, period) {
  return hashPair(word, BigInt(period + 1));
}

/** The day's binary High Roller lane, drawn from the same committed word as Solidity. */
export function crapsHighRollerMultiple(wordValue) {
  const word = asUint(wordValue, 'Daily RNG word');
  if (word === 0n) return null;
  return hashPair(word, CRAPS_HIGH_ROLLER_TAG) % 10n === 0n ? 100 : 10;
}

/**
 * Exact scheduled-window economics from CrapsBattle._bonusPreset. The GAME's
 * published daily word fixes all seven rows before anybody chooses a board.
 * Amounts are returned as whole FLIP because that is the unit the entry UI
 * and its table use; the transaction itself only submits chip counts.
 */
export function crapsBonusTerms(wordValue, periodValue) {
  const word = asUint(wordValue, 'Daily RNG word');
  if (word === 0n) return null;
  const period = Number(periodValue);
  if (!Number.isInteger(period) || period < 0 || period >= CRAPS_BONUS_WINDOWS) {
    throw new Error('Craps battle period must be between 0 and 6.');
  }

  const roll = bonusRoll(word, period);
  const highMult = crapsHighRollerMultiple(word);
  const bankMult = CRAPS_SCHED_BANK_MULT;
  // NO GOAL DRAW since audit 0880d134c — `_bonusPreset` multiplies by the fixed `_SCHED_GOAL`
  // outright and no longer consumes `roll >> 32`. Drawing here would price windows off a target
  // the chain never chose.
  const goalMult = CRAPS_SCHED_GOAL;
  const event = period === CRAPS_BONUS_WINDOWS - 1;
  let bankrollFlip;
  let battleStakeFlip;
  let tier = 0;

  if (event) {
    const tail = roll % 100n;
    bankrollFlip = tail < 5n
      ? 30_000n
      : tail < 7n
        ? 60_000n
        : 1_500n * (1n + ((roll >> 8n) % 10n));
    battleStakeFlip = ((bankrollFlip * (25n + (5n * ((roll >> 16n) % 6n)))) / 100n / 100n) * 100n;
  } else {
    const bountyPick = Number((roll >> 8n) % 3n);
    const tierPick = period === 0
      ? Number((roll >> 40n) % 3n)
      : Number(roll % 10n) < 7
        ? 0
        : Number(roll % 10n) < 9
          ? 1
          : 2;
    tier = tierPick + 1;
    if (tierPick === 0) {
      bankrollFlip = 300n;
      battleStakeFlip = [100n, 200n, 300n][bountyPick];
    } else if (tierPick === 1) {
      bankrollFlip = 1_200n;
      battleStakeFlip = [300n, 800n, 1_200n][bountyPick];
    } else {
      bankrollFlip = 3_000n;
      battleStakeFlip = [1_000n, 1_500n, 3_000n][bountyPick];
    }
  }

  let playedFlip = (bankrollFlip / BigInt(bankMult) / CRAPS_BONUS_CHIPS) * CRAPS_BONUS_CHIPS;
  if (playedFlip < CRAPS_BONUS_CHIPS) playedFlip = CRAPS_BONUS_CHIPS;
  const postedStakeFlip = (playedFlip / CRAPS_BONUS_CHIPS) * CRAPS_PICKED_CHIPS;
  const goalFlip = bankrollFlip * BigInt(goalMult);

  return Object.freeze({
    period,
    number: period + 1,
    event,
    tier,
    bankrollFlip,
    battleStakeFlip,
    buyInFlip: bankrollFlip + battleStakeFlip,
    playedFlip,
    postedStakeFlip,
    goalFlip,
    bankMult,
    speedLabel: CRAPS_SPEED_LABELS[bankMult],
    goalMult,
    highMult,
  });
}

/** Aggregate economics and ranges for the opener-only seven-battle ticket. */
export function crapsBonusDayTerms(wordValue) {
  const windows = Object.freeze(Array.from(
    { length: CRAPS_BONUS_WINDOWS },
    (_, period) => crapsBonusTerms(wordValue, period),
  ));
  if (windows.some((window) => window == null)) return null;
  const total = (field) => windows.reduce((sum, window) => sum + window[field], 0n);
  const bankMultiples = windows.map((window) => window.bankMult);
  const goalMultiples = windows.map((window) => window.goalMult);
  return Object.freeze({
    windows,
    bankrollFlip: total('bankrollFlip'),
    battleStakeFlip: total('battleStakeFlip'),
    buyInFlip: total('buyInFlip'),
    minBankMult: Math.min(...bankMultiples),
    maxBankMult: Math.max(...bankMultiples),
    minGoalMult: Math.min(...goalMultiples),
    maxGoalMult: Math.max(...goalMultiples),
    highMult: windows[0].highMult,
  });
}

// ---------------------------------------------------------------------------
// Log decoding is the lobby's dominant main-thread cost: the retained window
// holds thousands of logs and every refresh re-folds all of them. Two memos
// keep that fold cheap. The topic index skips ethers' per-call fragment scan
// (Interface#parseLog re-hashes EVERY event signature on EVERY log), and the
// per-log memo makes a re-fold over already-seen logs pure Map lookups.
// Keyed on log identity per Interface, so a test log, a stale window, or a
// second ABI can never be served another decoder's result.
// ---------------------------------------------------------------------------
const _topicIndexByInterface = new WeakMap(); // Interface -> Map(topic0 -> EventFragment)
const _parsedByLog = new WeakMap(); // log -> Map(Interface -> LogDescription | null)

function topicIndexFor(iface) {
  let index = _topicIndexByInterface.get(iface);
  if (!index) {
    index = new Map();
    iface.forEachEvent((fragment) => {
      if (!fragment.anonymous) index.set(fragment.topicHash.toLowerCase(), fragment);
    });
    _topicIndexByInterface.set(iface, index);
  }
  return index;
}

function decodeCrapsLog(iface, log) {
  const topic0 = String(log?.topics?.[0] ?? '').toLowerCase();
  const fragment = topicIndexFor(iface).get(topic0);
  if (!fragment) return null;
  try {
    const args = iface.decodeEventLog(fragment, log.data, log.topics);
    return new ethers.LogDescription(fragment, fragment.topicHash, args);
  } catch (_error) { return null; }
}

function memoParseCrapsLog(iface, log) {
  if (!log || typeof log !== 'object') return null;
  let byInterface = _parsedByLog.get(log);
  if (byInterface?.has(iface)) return byInterface.get(iface);
  const parsed = decodeCrapsLog(iface, log);
  if (!byInterface) {
    byInterface = new Map();
    _parsedByLog.set(log, byInterface);
  }
  byInterface.set(iface, parsed);
  return parsed;
}

function parsedCrapsLog(log, parser) {
  if (log?.parsed) return log.parsed;
  const iface = parser?.interface;
  if (iface instanceof ethers.Interface) return memoParseCrapsLog(iface, log);
  try { return iface?.parseLog?.(log) ?? null; }
  catch (_error) { return null; }
}

function wholeFlipFromWei(value, label) {
  const amount = asUint(value, label);
  if (amount % CRAPS_FLIP_WEI !== 0n) {
    throw new Error(`${label} must resolve to whole FLIP.`);
  }
  return amount / CRAPS_FLIP_WEI;
}

function bonusTermsFromOpened(day, parsed, donatedWei = 0n) {
  const args = parsed?.args ?? {};
  const slot = asUint(args.slot ?? args[1], 'Craps bonus slot');
  const firstSlot = BigInt(day) * 8n + 1n;
  const period = Number(slot - firstSlot);
  if (period < 0 || period >= CRAPS_BONUS_WINDOWS) return null;

  const bankrollFlip = wholeFlipFromWei(args.bankroll ?? args[3], 'Craps bankroll');
  const goalFlip = wholeFlipFromWei(args.goal ?? args[4], 'Craps goal');
  // Despite the historical ABI name, CrapsBonusOpened.boardStake is the WINDOW's posted-stake
  // ceiling — (played / 10) * 7, the MOST a board may place (unchanged by 0880d134c's 0..7
  // continuum). Reinflate it to the ten-chip round used for depth.
  const postedStakeFlip = wholeFlipFromWei(args.boardStake ?? args[5], 'Craps board stake');
  const playedFlip = (postedStakeFlip * CRAPS_BONUS_CHIPS) / CRAPS_PICKED_CHIPS;
  const battleStakeFlip = wholeFlipFromWei(args.battleStake ?? args[6], 'Craps battle stake');
  const bankMult = Number(bankrollFlip / playedFlip);
  const goalMult = Number(goalFlip / bankrollFlip);
  const houseAddedFlipWei = asUint(args.seed ?? args[2], 'Craps added FLIP');
  const battleKey = String(args.battleKey ?? args[0]).toLowerCase();

  return Object.freeze({
    day,
    period,
    number: period + 1,
    slot: slot.toString(),
    battleKey,
    event: period === CRAPS_BONUS_WINDOWS - 1,
    tier: period === CRAPS_BONUS_WINDOWS - 1
      ? 0
      : bankrollFlip === 300n ? 1 : bankrollFlip === 1_200n ? 2 : 3,
    bankrollFlip,
    battleStakeFlip,
    buyInFlip: bankrollFlip + battleStakeFlip,
    playedFlip,
    postedStakeFlip,
    goalFlip,
    bankMult,
    speedLabel: CRAPS_SPEED_LABELS[bankMult] ?? `${bankMult} ROUND`,
    goalMult,
    houseAddedFlipWei,
    donatedFlipWei: donatedWei,
    addedFlipWei: houseAddedFlipWei + donatedWei,
  });
}

/**
 * Convert the current day's opening/donation logs into the exact entry cards.
 * `addedFlipWei` is the advertised ceiling: the actual boost rung is drawn
 * only after the battle closes, so presenting it as a guaranteed payout would
 * overstate what the contract knows at entry time.
 */
export function crapsBonusScheduleFromLogs(dayValue, logs = [], parser = crapsReceiptParser()) {
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0) return null;
  const openings = [];
  const donatedByKey = new Map();
  for (const log of logs) {
    const parsed = parsedCrapsLog(log, parser);
    if (!parsed) continue;
    if (parsed.name === 'CrapsBonusOpened') openings.push(parsed);
    else if (parsed.name === 'CrapsBonusDonated') {
      const args = parsed.args ?? {};
      donatedByKey.set(
        String(args.battleKey ?? args[0]).toLowerCase(),
        asUint(args.seed ?? args[3], 'Craps donated FLIP'),
      );
    }
  }

  const windows = openings
    .map((opened) => {
      const args = opened.args ?? {};
      const key = String(args.battleKey ?? args[0]).toLowerCase();
      return bonusTermsFromOpened(day, opened, donatedByKey.get(key) ?? 0n);
    })
    .filter(Boolean)
    .sort((a, b) => a.period - b.period);
  if (windows.length === 0) return null;

  const byPeriod = Array(CRAPS_BONUS_WINDOWS).fill(null);
  for (const window of windows) byPeriod[window.period] = window;
  const complete = byPeriod.every(Boolean);
  const total = (field) => byPeriod.reduce(
    (sum, window) => sum + (window?.[field] ?? 0n),
    0n,
  );
  const bankMultiples = windows.map((window) => window.bankMult);
  const goalMultiples = windows.map((window) => window.goalMult);
  return Object.freeze({
    day,
    complete,
    windows: Object.freeze(byPeriod),
    bankrollFlip: total('bankrollFlip'),
    battleStakeFlip: total('battleStakeFlip'),
    buyInFlip: total('buyInFlip'),
    addedFlipWei: total('addedFlipWei'),
    minBankMult: Math.min(...bankMultiples),
    maxBankMult: Math.max(...bankMultiples),
    minGoalMult: Math.min(...goalMultiples),
    maxGoalMult: Math.max(...goalMultiples),
  });
}

// ---------------------------------------------------------------------------
// Incremental craps event window.
//
// The lobby snapshot, the bonus schedule and the Added rail all derive from the
// same bounded lookback of CrapsBattle events. Refetching that whole window on
// every lobby refresh moved megabytes of identical JSON per poll and left every
// response pinned in the shared log cache under a fresh block-range key — the
// renderer's single largest steady-state allocation. One module-level window
// holds the merged rows instead: the first read pays for the full lookback,
// every later read fetches only the blocks past the cursor plus a short reorg
// tail, prunes what slid out of the lookback, and reuses the rest. Reads are
// serialized so concurrent callers extend one cursor rather than racing two
// full scans.
//
// The window is API-FIRST. `/game/craps/events` serves the same 45,000-block
// lookback out of the indexer's craps_* tables, already decoded, so the browser
// no longer runs a 5.6 MB eth_getLogs scan on every page load. The chain path
// below survives ONLY as the fallback for an API that is down or too old to
// serve the route; a failure is memoised for five minutes so a permanently
// missing route is not re-probed on every 30s poll, and neither window is ever
// re-scanned from the deploy block twice in one browser because both persist
// their cursor (and their rows) to localStorage.
// ---------------------------------------------------------------------------

/** Every event the lobby snapshot parses; a superset of the schedule's pair. */
const CRAPS_WINDOW_EVENT_NAMES = Object.freeze([
  'CrapsSlipPlaced',
  'CrapsSlipAmended',
  'CrapsBonusOpened',
  'CrapsBonusDonated',
  'CrapsBonusArmed',
  'CrapsDayReserved',
  'CrapsDayWindowsUpgraded',
  'CrapsBattleFinalized',
  'CrapsBattlePaid',
  'CrapsHighRollerDayOpened',
  'CrapsHighRollerPaid',
  'CrapsProgressiveFunded',
  'CrapsProgressivePaid',
  'CrapsProgressiveRolled',
  'CrapsProtocolAwardSplit',
]);

/** The indexed mirror of the window above. Same names, same lookback, decoded. */
const CRAPS_EVENTS_ROUTE = '/game/craps/events';
// An API too old to serve the route answers 404 forever. Re-probing that on
// every 30s poll would be a guaranteed miss and a guaranteed 45k-block chain
// scan behind it, so one failure parks the API for five minutes.
const CRAPS_API_FAILURE_MEMO_MS = 5 * 60 * 1_000;
const CRAPS_WINDOW_STORAGE_PREFIX = 'craps-window-';
// localStorage is one small synchronous budget shared by the whole origin. A
// busy craps day's window runs to thousands of rows and megabytes of JSON;
// mirroring that would blow the quota AND cost a multi-megabyte stringify on
// every poll, to save a fetch the in-memory window already covers for the life
// of the tab. Past either cap the mirror is DROPPED rather than half-written:
// a partial window would silently shorten the lookback the fold depends on.
const CRAPS_WINDOW_PERSIST_MAX_ROWS = 3_000;
const CRAPS_WINDOW_PERSIST_MAX_BYTES = 1_500_000;

let _crapsWindowTopics = null;
let _crapsLogWindow = null; // { provider, address, fromBlock, toBlock, logs }
let _crapsApiWindow = null; // { address, fromBlock, toBlock, events }
let _crapsLogWindowChain = Promise.resolve();
let _crapsEventsFetcher = null;
let _crapsApiFailedAt = 0;

function crapsWindowTopicHashes() {
  if (!_crapsWindowTopics) {
    const iface = interfaceForCrapsLobby();
    _crapsWindowTopics = Object.freeze(
      CRAPS_WINDOW_EVENT_NAMES.map((name) => iface.getEvent(name).topicHash),
    );
  }
  return _crapsWindowTopics;
}

function crapsWindowStorageKey(kind) {
  return `${CRAPS_WINDOW_STORAGE_PREFIX}${kind}:v1:${CHAIN.id}:`
    + `${String(contractAddress() ?? '').toLowerCase()}:${Number(CHAIN.deployBlock) || 0}`;
}

function crapsWindowStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch (_error) { return null; }
}

/**
 * Mirror a merged window so a reload pays the reorg tail rather than the whole
 * lookback. Skipped under a test contract factory for the same reason sdgnrs.js
 * skips it: a fake provider must never meet a previous session's window.
 */
function persistCrapsWindow(kind, payload, rows) {
  if (_contractFactory) return;
  const store = crapsWindowStorage();
  if (!store) return;
  const key = crapsWindowStorageKey(kind);
  try {
    if (rows.length > CRAPS_WINDOW_PERSIST_MAX_ROWS) {
      store.removeItem(key);
      return;
    }
    const serialized = JSON.stringify(payload);
    if (serialized.length > CRAPS_WINDOW_PERSIST_MAX_BYTES) {
      store.removeItem(key);
      return;
    }
    store.setItem(key, serialized);
  } catch (_error) { /* quota or serialization — the memory window still works */ }
}

function reviveCrapsWindow(kind) {
  if (_contractFactory) return null;
  const store = crapsWindowStorage();
  if (!store) return null;
  try {
    const parsed = JSON.parse(store.getItem(crapsWindowStorageKey(kind)));
    if (!parsed
      || !Number.isSafeInteger(Number(parsed.fromBlock))
      || !Number.isSafeInteger(Number(parsed.toBlock))
      || !Array.isArray(parsed.rows)) return null;
    return {
      fromBlock: Number(parsed.fromBlock),
      toBlock: Number(parsed.toBlock),
      rows: parsed.rows,
    };
  } catch (_error) { return null; }
}

function forgetPersistedCrapsWindows() {
  const store = crapsWindowStorage();
  if (!store) return;
  const keys = new Set([crapsWindowStorageKey('api'), crapsWindowStorageKey('logs')]);
  try {
    const size = Number(store.length ?? 0);
    for (let index = 0; index < size; index += 1) {
      const key = store.key?.(index);
      if (typeof key === 'string' && key.startsWith(CRAPS_WINDOW_STORAGE_PREFIX)) keys.add(key);
    }
  } catch (_error) { /* a shim without enumeration still clears the two known keys */ }
  for (const key of keys) {
    try { store.removeItem(key); } catch (_error) { /* best effort */ }
  }
}

function crapsEventsFetcher() {
  return typeof _crapsEventsFetcher === 'function' ? _crapsEventsFetcher : fetchCrapsEventsJSON;
}

function crapsApiMemoActive() {
  return _crapsApiFailedAt > 0 && (Date.now() - _crapsApiFailedAt) < CRAPS_API_FAILURE_MEMO_MS;
}

/**
 * Wrap one indexed EventRow as the shape `parsedCrapsLog` already fast-paths.
 *
 * `parsed` carries the decoded name and NAMED args, so every `args.foo ?? args[N]`
 * read in the folds resolves on the name and no Interface is ever consulted.
 * `topics`/`data` stay present but empty: nothing decodes these rows, and an
 * absent field would make a shared consumer reach into undefined.
 */
function crapsEventRowLog(row) {
  const name = String(row?.name ?? '');
  if (!name) return null;
  const blockNumber = Number(row?.blockNumber);
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) return null;
  return {
    parsed: { name, args: row?.args ?? {} },
    blockNumber,
    logIndex: Number(row?.logIndex ?? 0),
    transactionHash: row?.transactionHash ?? null,
    topics: [],
    data: '0x',
  };
}

function crapsEventRowPayload(log) {
  return {
    name: log?.parsed?.name,
    args: log?.parsed?.args ?? {},
    blockNumber: Number(log?.blockNumber ?? 0),
    logIndex: Number(log?.logIndex ?? 0),
    transactionHash: log?.transactionHash ?? null,
  };
}

async function readCrapsApiWindowUnserialized() {
  const address = contractAddress();
  if (_crapsApiWindow == null) {
    const revived = reviveCrapsWindow('api');
    if (revived) {
      const events = revived.rows.map(crapsEventRowLog).filter(Boolean);
      _crapsApiWindow = {
        address,
        fromBlock: revived.fromBlock,
        toBlock: revived.toBlock,
        events,
      };
    }
  }
  const cached = _crapsApiWindow;
  const reusable = Boolean(cached
    && cached.address === address
    && Number.isSafeInteger(cached.toBlock));
  // The tail the indexer is asked to re-serve. Anything the merge retains must
  // sit strictly below it, so a rewritten block arrives once and only once.
  const since = reusable ? cached.toBlock - CRAPS_LOG_REORG_TAIL_BLOCKS : null;
  const lookbackQuery = `lookback=${crapsLogLookbackBlocks()}`;
  const payload = await crapsEventsFetcher()(
    since != null && since > 0
      ? `${CRAPS_EVENTS_ROUTE}?${lookbackQuery}&since=${since}`
      : `${CRAPS_EVENTS_ROUTE}?${lookbackQuery}`,
  );
  const toBlock = Number(payload?.toBlock);
  if (!Number.isSafeInteger(toBlock) || toBlock < 0) {
    throw new Error('The craps events API returned no cursor.');
  }
  const fresh = (Array.isArray(payload?.events) ? payload.events : [])
    .map(crapsEventRowLog)
    .filter(Boolean);
  const deployBlock = Number(CHAIN.deployBlock ?? 0);
  const lookbackFrom = Math.max(deployBlock, toBlock - crapsLogLookbackBlocks());
  // A cursor that moved BACKWARD is an indexer rollback, not a tail: never
  // retain rows the new head no longer covers.
  const cutoff = since == null ? null : Math.min(since, toBlock);
  const retained = cutoff == null
    ? []
    : cached.events.filter((log) => log.blockNumber <= cutoff && log.blockNumber >= lookbackFrom);
  const events = retained.length ? retained.concat(fresh) : fresh;
  const responseFrom = Number(payload?.fromBlock);
  const fromBlock = reusable
    ? Math.max(lookbackFrom, Math.min(cached.fromBlock, toBlock))
    : (Number.isSafeInteger(responseFrom) ? Math.max(deployBlock, responseFrom) : lookbackFrom);
  _crapsApiWindow = { address, fromBlock, toBlock, events };
  persistCrapsWindow(
    'api',
    { fromBlock, toBlock, rows: events.map(crapsEventRowPayload) },
    events,
  );
  return events;
}

function crapsChainLogPayload(log) {
  return {
    blockNumber: Number(log?.blockNumber ?? 0),
    logIndex: Number(log?.logIndex ?? log?.index ?? 0),
    transactionHash: log?.transactionHash ?? null,
    topics: Array.isArray(log?.topics) ? [...log.topics] : [],
    data: log?.data ?? '0x',
  };
}

async function readCrapsChainWindowUnserialized(provider) {
  if (typeof provider?.getLogs !== 'function') {
    throw new Error('No chain read provider is available for the craps window.');
  }
  const latestBlock = Number(await readProviderBlockNumber(provider));
  const address = contractAddress();
  const deployBlock = Number(CHAIN.deployBlock ?? 0);
  const windowFrom = Math.max(deployBlock, latestBlock - crapsLogLookbackBlocks());
  if (_crapsLogWindow == null) {
    const revived = reviveCrapsWindow('logs');
    // A revived window carries NO provider: it was written by a previous
    // session under this chain + address + deploy block, which is the whole
    // key, so the next transport may adopt it.
    if (revived) {
      _crapsLogWindow = {
        provider: null,
        address,
        fromBlock: revived.fromBlock,
        toBlock: revived.toBlock,
        logs: revived.rows,
      };
    }
  }
  const cached = _crapsLogWindow;
  // Provider identity is part of the key: a failover replacement or a test
  // stub must never inherit another live transport's merged history.
  const reusable = Boolean(cached
    && (cached.provider == null || cached.provider === provider)
    && cached.address === address
    && cached.fromBlock <= windowFrom
    && cached.toBlock <= latestBlock);
  const fetchFrom = reusable
    ? Math.max(windowFrom, cached.toBlock - CRAPS_LOG_REORG_TAIL_BLOCKS + 1)
    : windowFrom;
  const fresh = await provider.getLogs({
    address,
    fromBlock: fetchFrom,
    toBlock: latestBlock,
    topics: [crapsWindowTopicHashes()],
  });
  const retained = reusable
    ? cached.logs.filter((log) => {
      const block = Number(log?.blockNumber);
      return Number.isFinite(block) && block >= windowFrom && block < fetchFrom;
    })
    : [];
  const logs = retained.length ? retained.concat(fresh) : fresh;
  _crapsLogWindow = { provider, address, fromBlock: windowFrom, toBlock: latestBlock, logs };
  persistCrapsWindow(
    'logs',
    { fromBlock: windowFrom, toBlock: latestBlock, rows: logs.map(crapsChainLogPayload) },
    logs,
  );
  return logs;
}

async function readCrapsWindowUnserialized(provider) {
  // A test contract factory means a stubbed chain, and every existing craps
  // test drives that stub's getLogs. Never let the API answer for it.
  if (!_contractFactory && !crapsApiMemoActive()) {
    try {
      return await readCrapsApiWindowUnserialized();
    } catch (_error) {
      _crapsApiFailedAt = Date.now();
    }
  }
  return readCrapsChainWindowUnserialized(provider);
}

function readCrapsWindowLogs(provider) {
  const run = () => readCrapsWindowUnserialized(provider);
  const read = _crapsLogWindowChain.then(run, run);
  _crapsLogWindowChain = read.then(() => undefined, () => undefined);
  return read;
}

/** Rows of one or two of the window's event names, decoded once and memoised. */
function crapsWindowRowsNamed(logs, names, parser) {
  return logs.filter((log) => names.has(parsedCrapsLog(log, parser)?.name));
}

export function __resetCrapsLogWindowForTest() {
  _crapsLogWindow = null;
  _crapsApiWindow = null;
  _crapsLogWindowChain = Promise.resolve();
  _crapsApiFailedAt = 0;
  forgetPersistedCrapsWindows();
}

export function __setCrapsEventsFetcherForTest(fetcher) {
  _crapsEventsFetcher = typeof fetcher === 'function' ? fetcher : null;
}

const CRAPS_SCHEDULE_EVENT_NAMES = Object.freeze(new Set([
  'CrapsBonusOpened',
  'CrapsBonusDonated',
]));

/** Read the current day's published schedule from the shared craps window. */
export async function readCrapsBonusSchedule(dayValue) {
  if (!isCrapsAvailable()) return null;
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0) return null;
  const parser = crapsLobbyReceiptParser();
  const logs = crapsWindowRowsNamed(
    await readCrapsWindowLogs(readerProvider()),
    CRAPS_SCHEDULE_EVENT_NAMES,
    parser,
  );
  return crapsBonusScheduleFromLogs(day, logs, parser);
}

/**
 * Recover the recurring daily Added amount from the two adjacent funding logs.
 * Either half is enough to keep the headline available: the contract splits
 * raw main funding between the battle ladder and Run It Up, with only an odd
 * wei able to separate the halves.
 */
export function crapsAddedPerDayFromLogs(
  dayValue,
  logs = [],
  parser = crapsLobbyReceiptParser(),
) {
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0) return null;
  const mainByDay = new Map();
  const progressiveByDay = new Map();
  for (const log of logs) {
    const parsed = parsedCrapsLog(log, parser);
    const args = parsed?.args ?? {};
    try {
      if (parsed?.name === 'CrapsHighRollerDayOpened') {
        mainByDay.set(
          Number(asUint(args.day ?? args[0], 'Craps funding day')),
          asUint(args.mainBoostBudget ?? args[2], 'Craps ladder funding'),
        );
      } else if (parsed?.name === 'CrapsProgressiveFunded') {
        progressiveByDay.set(
          Number(asUint(args.day ?? args[0], 'Craps funding day')),
          asUint(args.contribution ?? args[1], 'Run It Up daily funding'),
        );
      }
    } catch (_error) { /* one malformed provider log cannot blank a known day */ }
  }
  const totalFor = (fundingDay) => {
    const main = mainByDay.get(fundingDay) ?? null;
    const progressive = progressiveByDay.get(fundingDay) ?? null;
    if (main != null && progressive != null) return main + progressive;
    const knownHalf = main ?? progressive;
    return knownHalf == null ? null : knownHalf * 2n;
  };
  return totalFor(day) ?? totalFor(day - 1);
}

const CRAPS_FUNDING_EVENT_NAMES = Object.freeze(new Set([
  'CrapsHighRollerDayOpened',
  'CrapsProgressiveFunded',
]));

/**
 * The Added rail reads the SHARED window rather than a second query of its own.
 *
 * Its old narrow eth_getLogs was uncached and ran on every poll and every
 * gameState publish beside the lobby's own scan, so the rail cost a full
 * lookback per refresh to recover two numbers the lobby had already fetched.
 */
export async function readCrapsAddedPerDay(dayValue) {
  if (!isCrapsAvailable()) return null;
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0) return null;
  const parser = crapsLobbyReceiptParser();
  const logs = crapsWindowRowsNamed(
    await readCrapsWindowLogs(readerProvider()),
    CRAPS_FUNDING_EVENT_NAMES,
    parser,
  );
  return crapsAddedPerDayFromLogs(day, logs, parser);
}

function crapsLobbyReceiptParser() {
  return { interface: interfaceForCrapsLobby() };
}

/**
 * Solidity's `_windowShare`. The day's EVENT window — its last — takes HALF the
 * budget outright; the other half is split across the six routine windows by
 * size, weighted 4:2:1. Both lanes share the same weight and tier, so the ONLY
 * difference between the main and high bases is which budget goes in.
 */
export function crapsWindowShareWei(budgetWei, weight, period, tier) {
  const half = asUint(budgetWei, 'Craps boost budget') / 2n;
  if (period === CRAPS_BONUS_WINDOWS - 1) return half;
  if (weight === 0n) return 0n;
  return (half * (1n << BigInt(tier - 1))) / weight;
}

/**
 * Solidity's `_routineWeight`, rebuilt from the day's own opening logs rather
 * than from the daily word: every routine window's tier is already implied by
 * the bankroll it published. Null until all six routine windows are in hand —
 * a partial day would divide by a short denominator and overstate every share.
 */
export function crapsRoutineWeight(windows) {
  let weight = 0n;
  for (let period = 0; period < CRAPS_BONUS_WINDOWS - 1; period += 1) {
    const tier = windows?.[period]?.tier;
    if (!Number.isInteger(tier) || tier < 1) return null;
    weight += 1n << BigInt(tier - 1);
  }
  return weight;
}

/**
 * Solidity's `_roundBoost`, in granules. Rounds to NEAREST, which is why a
 * window's realized figure can land ABOVE the exact draw rather than below it.
 */
function crapsRoundBoostUnits(units) {
  if (units <= CRAPS_BOOST_ROUND_ABOVE) return units;
  return ((units + CRAPS_BOOST_ROUND_STEP / 2n) / CRAPS_BOOST_ROUND_STEP) * CRAPS_BOOST_ROUND_STEP;
}

/**
 * Reproduce the scheduled pot boost that actually landed once a battle's
 * settlement word became public. CrapsBonusOpened.seed is the 100x ceiling;
 * Solidity draws one of 1/4x, 1x, 10x, or 100x and floors it to the same
 * 100-FLIP granule before putting it in the finalized pot.
 */
export function crapsRealizedBoostWei({ ceilingWei, battleKey, wordValue } = {}) {
  const ceiling = asUint(ceilingWei, 'Craps boost ceiling');
  return crapsRealizedBoostFromBaseWei({
    baseWei: ceiling / CRAPS_BOOST_MAX_MULTIPLE,
    battleKey,
    wordValue,
  });
}

function crapsBoostQuarterMultiple({ battleKey, wordValue } = {}) {
  const word = asUint(wordValue, 'Craps settlement word');
  if (word === 0n) return null;
  const key = asUint(battleKey, 'Craps battle key');
  const roll = hashTriple(word, key, CRAPS_BOOST_TAG) % 1000n;
  return roll < 768n ? 1n : roll < 976n ? 4n : roll < 996n ? 40n : 400n;
}

/** The exact Spin & Go-style boost rung selected by the settlement word. */
export function crapsBonusMultiplier({ battleKey, wordValue } = {}) {
  const quarterMultiple = crapsBoostQuarterMultiple({ battleKey, wordValue });
  return quarterMultiple == null ? null : Number(quarterMultiple) / 4;
}

/**
 * The same rung applied to a base the client derived itself — the HIGH lane's,
 * which no event publishes as a ceiling. Both lanes draw off ONE roll keyed to
 * the battle, so the side pot never adds a second source of randomness.
 *
 * The contract rounds in GRANULES and only then widens to wei, so the rounding
 * must happen here too: a client that skips it understates any window whose
 * draw lands above the floor.
 */
export function crapsRealizedBoostFromBaseWei({ baseWei, battleKey, wordValue } = {}) {
  const base = asUint(baseWei, 'Craps boost base');
  const quarterMultiple = crapsBoostQuarterMultiple({ battleKey, wordValue });
  if (quarterMultiple == null) return null;
  const units = (base * quarterMultiple) / (4n * CRAPS_BATTLE_STAKE_UNIT_WEI);
  return crapsRoundBoostUnits(units) * CRAPS_BATTLE_STAKE_UNIT_WEI;
}

function wordAtIndex(wordsByIndex, index) {
  if (index == null || wordsByIndex == null) return null;
  const key = String(index);
  if (wordsByIndex instanceof Map) return wordsByIndex.get(key) ?? wordsByIndex.get(index) ?? null;
  return wordsByIndex[key] ?? null;
}

/**
 * Fold the lobby's canonical logs into current winners and yesterday's exact
 * realized protocol contribution. Donations and entrant stakes are not part
 * of the historical added figure; only the contract's own boost ladder and
 * its separate daily Run It Up funding are.
 */
export function crapsLobbySnapshotFromLogs(
  dayValue,
  logs = [],
  { wordsByIndex = null, parser = crapsLobbyReceiptParser(), player = null } = {},
) {
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0) return null;
  const yesterdayDay = day - 1;
  const scopedPlayer = /^0x[0-9a-f]{40}$/i.test(String(player ?? ''))
    ? String(player).toLowerCase()
    : null;
  const currentWindows = Array(CRAPS_BONUS_WINDOWS).fill(null);
  const yesterdayWindows = Array(CRAPS_BONUS_WINDOWS).fill(null);
  const armedByKey = new Map();
  const openedBySlot = new Map();
  const finalizedByKey = new Map();
  const paidByKey = new Map();
  const highPaidByKey = new Map();
  const progressivePaidByKey = new Map();
  const ownedBets = new Map();
  const dayTickets = new Map();
  const playerWindows = Array(CRAPS_BONUS_WINDOWS).fill(null);
  const countedBetIds = new Set();
  const publicDayTickets = new Map();
  const publicWindowEntries = new Map();
  const directEntrantCounts = Array.from(
    { length: CRAPS_BONUS_WINDOWS },
    () => ({ total: 0, high: 0 }),
  );
  const previousEventDirectEntrants = { total: 0, high: 0 };
  // The day's HIGH boost budget, and the SHAPE of the lane each window ran —
  // 'contested' or 'sole'. Both are needed before a side boost may be counted.
  const mainBudgetByDay = new Map();
  const highBudgetByDay = new Map();
  const highMultipleByDay = new Map();
  const progressiveContributionByDay = new Map();
  const highLaneShape = new Map();
  const amendedChipsByBetId = new Map();
  // What the main winner could not receive because of standing (roll source 1).
  const mainRolledWei = new Map();
  // What the contested High Roller winner could not receive (roll source 2).
  const contestedHighRolledWei = new Map();
  // What a sole lane BANKED rather than staked, by battle key (roll source 3).
  const soleRolledWei = new Map();
  // What each winner was paid in DAY PASSES rather than FLIP (split sources 1 and 2).
  // Same value the contract itself put on them, since it is the contract's own subtraction.
  const mainPassWei = new Map();
  const contestedHighPassWei = new Map();
  // A SOLE rider's award splits too (CrapsBattle.sol:3445), even though its FLIP return
  // arrives through CrapsBetSettled rather than CrapsHighRollerPaid.
  const soleHighPassWei = new Map();

  // High is a per-window property for a day ticket: a paid High Roller day
  // starts with all seven bits, while an ordinary ticket can acquire them one
  // at a time through CrapsDayWindowsUpgraded. Keep the public ticket book by
  // player/day and derive counts after every log has been folded so duplicate
  // provider logs and repeated upgrade masks cannot inflate the side field.
  const rememberPublicDayTicket = (
    entrant,
    entryDay,
    { seen = false, highMask = 0, betId = null } = {},
  ) => {
    if (entryDay !== yesterdayDay && entryDay !== day && entryDay !== day + 1) return;
    const key = `${entryDay}:${String(entrant).toLowerCase()}`;
    const prior = publicDayTickets.get(key);
    publicDayTickets.set(key, {
      day: entryDay,
      seen: Boolean(prior?.seen || seen),
      highMask: (prior?.highMask ?? 0) | (Number(highMask) & CRAPS_ALL_WINDOWS_MASK),
      betId: betId ?? prior?.betId ?? null,
    });
  };

  const rememberDayTicket = (entryDay, highMask = 0, { betId = null, chips = null } = {}) => {
    if (entryDay !== day && entryDay !== day + 1) return;
    const prior = dayTickets.get(entryDay);
    dayTickets.set(entryDay, {
      day: entryDay,
      source: 'day',
      highMask: (prior?.highMask ?? 0) | (Number(highMask) & CRAPS_ALL_WINDOWS_MASK),
      betId: betId ?? prior?.betId ?? null,
      chips: chips ?? prior?.chips ?? 0,
    });
  };

  for (const log of logs) {
    const parsed = parsedCrapsLog(log, parser);
    if (!parsed) continue;
    const args = parsed.args ?? {};
    try {
      if (parsed.name === 'CrapsSlipPlaced') {
        const entrant = String(args.player ?? args[0]).toLowerCase();
        const packed = asUint(args.bet ?? args[1], 'Craps placed slip');
        const betId = (packed >> CRAPS_EVENT_BET_ID_SHIFT) & CRAPS_EVENT_BET_ID_MASK;
        const slot = betId >> 64n;
        const entryDay = Number(slot / BigInt(CRAPS_BONUS_WINDOWS + 1));
        const remainder = Number(slot % BigInt(CRAPS_BONUS_WINDOWS + 1));
        const multiple = Number(((packed >> CRAPS_EVENT_MULT_SHIFT) & CRAPS_EVENT_MULT_MASK) + 1n);
        const betKey = betId.toString();
        const chips = Number(packed & CRAPS_EVENT_CHIPS_MASK);
        if (!countedBetIds.has(betKey)) {
          countedBetIds.add(betKey);
          if (remainder === 0 && (
            entryDay === yesterdayDay || entryDay === day || entryDay === day + 1
          )) {
            rememberPublicDayTicket(entrant, entryDay, {
              seen: true,
              highMask: multiple > 1 ? CRAPS_ALL_WINDOWS_MASK : 0,
              betId: betKey,
            });
          } else if (
            remainder >= 1
            && remainder <= CRAPS_BONUS_WINDOWS
            && (entryDay === day || (
              entryDay === yesterdayDay && remainder === CRAPS_BONUS_WINDOWS
            ))
          ) {
            const field = entryDay === day
              ? directEntrantCounts[remainder - 1]
              : previousEventDirectEntrants;
            field.total += 1;
            if (multiple > 1) field.high += 1;
            publicWindowEntries.set(betKey, Object.freeze({
              betId: betKey,
              day: entryDay,
              period: remainder - 1,
              multiple,
            }));
          }
        }
        // The public field count uses every slip. Everything below this gate is
        // the connected wallet's private entry/replay projection.
        if (!scopedPlayer || entrant !== scopedPlayer) continue;
        ownedBets.set(betId.toString(), Object.freeze({
          betId: betId.toString(),
          slot: slot.toString(),
          day: entryDay,
          remainder,
          multiple,
          chips,
        }));
        if (remainder === 0) {
          rememberDayTicket(entryDay, multiple > 1 ? CRAPS_ALL_WINDOWS_MASK : 0, {
            betId: betKey,
            chips,
          });
        } else if (entryDay === day && remainder <= CRAPS_BONUS_WINDOWS) {
          playerWindows[remainder - 1] = {
            day: entryDay,
            period: remainder - 1,
            source: 'window',
            multiple,
            high: multiple > 1,
            betId: betKey,
            chips,
          };
        }
      } else if (parsed.name === 'CrapsSlipAmended') {
        const betId = asUint(args.betId ?? args[0], 'Amended Craps bet').toString();
        const chips = asUint(args.chips ?? args[1], 'Amended Craps board');
        if (chips <= CRAPS_EVENT_CHIPS_MASK) amendedChipsByBetId.set(betId, Number(chips));
      } else if (parsed.name === 'CrapsDayReserved') {
        const entrant = String(args.player ?? args[0]).toLowerCase();
        const reservedDay = Number(asUint(args.day ?? args[1], 'Reserved Craps day'));
        const highRoller = Boolean(args.highRoller ?? args[2]);
        // A future reservation's CrapsSlipPlaced echo deliberately carries a
        // 1x event multiple even when its stored seat is high. This companion
        // event is therefore the authoritative public lane marker.
        rememberPublicDayTicket(entrant, reservedDay, {
          highMask: highRoller ? CRAPS_ALL_WINDOWS_MASK : 0,
        });
        if (!scopedPlayer || entrant !== scopedPlayer) continue;
        rememberDayTicket(
          reservedDay,
          highRoller ? CRAPS_ALL_WINDOWS_MASK : 0,
        );
      } else if (parsed.name === 'CrapsDayWindowsUpgraded') {
        const entrant = String(args.player ?? args[0]).toLowerCase();
        const upgradedDay = Number(asUint(args.day ?? args[1], 'Upgraded Craps day'));
        const upgradedMask = Number(asUint(args.upgradedMask ?? args[2], 'Craps upgrade mask'));
        rememberPublicDayTicket(entrant, upgradedDay, { highMask: upgradedMask });
        if (!scopedPlayer || entrant !== scopedPlayer) continue;
        rememberDayTicket(
          upgradedDay,
          upgradedMask,
        );
      } else if (parsed.name === 'CrapsBonusOpened') {
        const slot = asUint(args.slot ?? args[1], 'Craps bonus slot');
        const remainder = Number(slot % 8n);
        if (remainder < 1 || remainder > CRAPS_BONUS_WINDOWS) continue;
        const openedDay = Number(slot / 8n);
        const battleKey = String(args.battleKey ?? args[0]).toLowerCase();
        const period = remainder - 1;
        // The published bankroll names the window's tier, which is the weight it
        // takes of the day's routine half — the same one BOTH lanes divide on.
        // Kept SEPARATE from the ceiling read: a bankroll a third-party RPC
        // mangled costs the side lane its figure, never the main one.
        let tier = period === CRAPS_BONUS_WINDOWS - 1 ? 0 : null;
        if (tier == null) {
          try {
            const bankrollFlip = asUint(args.bankroll ?? args[3], 'Craps bankroll') / CRAPS_FLIP_WEI;
            tier = bankrollFlip === 300n ? 1 : bankrollFlip === 1_200n ? 2 : 3;
          } catch (_error) { tier = null; }
        }
        let buyInWei = null;
        let battleStakeWei = null;
        try {
          battleStakeWei = asUint(args.battleStake ?? args[6], 'Craps battle stake');
          buyInWei = asUint(args.bankroll ?? args[3], 'Craps bankroll') + battleStakeWei;
        } catch (_error) {
          buyInWei = null;
          battleStakeWei = null;
        }
        const window = Object.freeze({
          day: openedDay,
          period,
          slot: slot.toString(),
          battleKey,
          ceilingWei: asUint(args.seed ?? args[2], 'Craps boost ceiling'),
          buyInWei,
          battleStakeWei,
          tier,
        });
        openedBySlot.set(window.slot, window);
        if (openedDay !== day && openedDay !== yesterdayDay) continue;
        (openedDay === day ? currentWindows : yesterdayWindows)[window.period] = window;
      } else if (parsed.name === 'CrapsHighRollerDayOpened') {
        const openedDay = Number(asUint(args.day ?? args[0], 'High Roller day'));
        mainBudgetByDay.set(openedDay, asUint(
          args.mainBoostBudget ?? args[2],
          'Main Craps boost budget',
        ));
        highMultipleByDay.set(
          openedDay,
          Number(asUint(args.multiplier ?? args[1], 'High Roller multiple')),
        );
        highBudgetByDay.set(openedDay, asUint(
          args.highRollerBoostBudget ?? args[3],
          'High Roller boost budget',
        ));
      } else if (parsed.name === 'CrapsProgressiveFunded') {
        const fundedDay = Number(asUint(args.day ?? args[0], 'Funded Craps day'));
        progressiveContributionByDay.set(fundedDay, asUint(
          args.contribution ?? args[1],
          'Run It Up daily contribution',
        ));
      } else if (parsed.name === 'CrapsProgressivePaid') {
        const battleKey = String(args.battleKey ?? args[1]).toLowerCase();
        progressivePaidByKey.set(battleKey, Object.freeze({
          betId: asUint(args.betId ?? args[0], 'Run It Up winning bet').toString(),
          winner: String(args.player ?? args[2]).toLowerCase(),
          amountWei: asUint(args.paid ?? args[8], 'Run It Up payout'),
        }));
      } else if (parsed.name === 'CrapsHighRollerPaid') {
        // Emitted for a sole lane as its seat settles (even at zero, which is
        // that lane's final word) and once for a contested one. Its presence is
        // the only client-visible proof a window seated a high roller: the day
        // seat's `CrapsSlipPlaced` echo carries no high bit. The rider flag is
        // what separates money ADDED from money merely put at risk.
        const battleKey = String(args.battleKey ?? args[1]).toLowerCase();
        const bankrollRider = Boolean(args.bankrollRider ?? args[4]);
        highLaneShape.set(battleKey, bankrollRider ? 'sole' : 'contested');
        highPaidByKey.set(battleKey, Object.freeze({
          betId: asUint(args.betId ?? args[0], 'High Roller winning bet').toString(),
          winner: String(args.player ?? args[2]),
          amountWei: asUint(args.amount ?? args[3], 'High Roller payout'),
          bankrollRider,
        }));
      } else if (parsed.name === 'CrapsProgressiveRolled') {
        const source = Number(asUint(args.source ?? args[1], 'Craps rollover source'));
        const key = String(args.battleKey ?? args[0]).toLowerCase();
        const amount = asUint(args.amount ?? args[2], 'Craps rollover amount');
        if (source === CRAPS_ROLL_SRC_MAIN) {
          mainRolledWei.set(key, amount);
        } else if (source === CRAPS_ROLL_SRC_HIGH_CONTESTED) {
          contestedHighRolledWei.set(key, (contestedHighRolledWei.get(key) ?? 0n) + amount);
        } else if (source === CRAPS_ROLL_SRC_HIGH_SOLE) {
          soleRolledWei.set(key, (soleRolledWei.get(key) ?? 0n) + amount);
        }
      } else if (parsed.name === 'CrapsProtocolAwardSplit') {
        // What the split BANKED as passes is the gross award minus what stayed liquid.
        // Accumulated rather than set: one battle can split on both lanes, and a lane that
        // banks nothing simply never emits.
        const source = Number(asUint(args.source ?? args[2], 'Craps award split source'));
        const key = String(args.battleKey ?? args[0]).toLowerCase();
        const gross = asUint(args.grossProtocol ?? args[3], 'Craps award gross');
        const liquid = asUint(args.liquidFlip ?? args[4], 'Craps award liquid');
        const banked = gross > liquid ? gross - liquid : 0n;
        if (banked !== 0n) {
          if (source === CRAPS_SPLIT_SRC_MAIN) {
            mainPassWei.set(key, (mainPassWei.get(key) ?? 0n) + banked);
          } else if (source === CRAPS_SPLIT_SRC_HIGH_CONTESTED) {
            contestedHighPassWei.set(key, (contestedHighPassWei.get(key) ?? 0n) + banked);
          } else if (source === CRAPS_SPLIT_SRC_HIGH_SOLE) {
            soleHighPassWei.set(key, (soleHighPassWei.get(key) ?? 0n) + banked);
          } else if (source === CRAPS_SPLIT_SRC_PROGRESSIVE) {
            // DELIBERATELY DROPPED, not forgotten — see the constant. The progressive's own
            // payment figure already carries this value, so banking it here would count it twice.
          }
        }
      } else if (parsed.name === 'CrapsBonusArmed') {
        const battleKey = String(args.battleKey ?? args[0]).toLowerCase();
        armedByKey.set(battleKey, asUint(args.index ?? args[2], 'Craps table index').toString());
      } else if (parsed.name === 'CrapsBattleFinalized') {
        const battleKey = String(args.battleKey ?? args[0]).toLowerCase();
        finalizedByKey.set(battleKey, Object.freeze({
          winningStop: Number(asUint(args.winningStop ?? args[1], 'Craps winning stop')),
          winnerId: asUint(args.winnerId ?? args[2], 'Craps winning seat').toString(),
          winningPeakWei: asUint(args.winningPeak ?? args[3], 'Craps winning peak').toString(),
          winningEndWei: asUint(args.winningEnd ?? args[4], 'Craps winning end').toString(),
          winningScoreBps: Number(asUint(args.winningScoreBps ?? args[5], 'Craps winning score')),
          potWei: asUint(args.pot ?? args[6], 'Craps battle pot').toString(),
        }));
      } else if (parsed.name === 'CrapsBattlePaid') {
        const battleKey = String(args.battleKey ?? args[1]).toLowerCase();
        paidByKey.set(battleKey, Object.freeze({
          betId: asUint(args.betId ?? args[0], 'Craps battle winning bet').toString(),
          winner: String(args.player ?? args[2]),
          amountWei: asUint(args.amount ?? args[3], 'Craps battle payout'),
        }));
      }
    } catch (_error) {
      // Ignore malformed third-party RPC log material without blanking the
      // other six rows or a previously decoded result.
    }
  }

  const requiredWordIndexes = Object.freeze([...new Set([
    ...yesterdayWindows
      .filter(Boolean)
      .map((window) => armedByKey.get(window.battleKey)),
    ...currentWindows
      .filter((window) => window && paidByKey.has(window.battleKey))
      .map((window) => armedByKey.get(window.battleKey)),
  ].filter((index) => index != null))]);
  /** The copies the named winner actually bought for this particular window. */
  const winnerEntryMultiple = (betId, window, { highLane = false } = {}) => {
    const key = String(betId ?? '');
    const direct = publicWindowEntries.get(key);
    if (direct?.day === window?.day && direct?.period === window?.period) {
      return direct.multiple;
    }
    const ticket = [...publicDayTickets.values()].find((candidate) => (
      candidate.betId != null && String(candidate.betId) === key
    ));
    if (ticket && window) {
      return (ticket.highMask & (1 << window.period))
        ? highMultipleByDay.get(window.day) ?? null
        : 1;
    }
    // A CrapsHighRollerPaid winner necessarily bought the day's high multiple,
    // even when the originating placement log has fallen outside the lookback.
    return highLane ? highMultipleByDay.get(window?.day) ?? null : null;
  };
  /**
   * The HIGH lane's boost base for one window, in FLIP wei.
   *
   *   null -> not yet determinable   0n -> determined, and this window adds none
   *
   * The side lane is NOT a second draw: it shares the main lane's rung and the
   * day's own weighting, and differs only in which budget it divides.
   *
   * THE FIGURE IS AN EV — what the house COMMITTED, not what the dice returned —
   * and that cuts both ways on a lane with a single high seat.
   *
   * A CONTESTED lane pays its boost straight into `lanePot`, so committed and
   * received are the same number. A SOLE lane is different: `_foldHigh` puts the
   * boost on that one seat's own run as capital riding alongside the bankroll,
   * so `_ride` returns nothing on a bust and a MULTIPLE of it on a big run.
   * Both are counted at the capital:
   *
   *   - a sole rider who BUSTS still had the boost put up on their behalf, so it
   *     counts in full — 33 of run #43's 34 sole rides came home empty, and a
   *     headline that read zero for them would understate what the house staked
   *   - a sole rider who WINS does NOT book the multiplier. The amplification is
   *     the dice paying out a risk the player carried, not more protocol money.
   *
   * Measured at realised cash instead, the headline would be a function of how
   * the dice fell rather than of what the house put up, and would swing by an
   * order of magnitude on one window's luck.
   *
   * `roundBoost(units)` is the whole allocation either way: the slice paid plus
   * the slice standing denied, which the contract banks in the progressive so
   * that `paid + rolled` equals the full-standing award to the wei.
   */
  const highBaseFor = (window, dayWindows) => {
    if (!window) return null;
    const budget = highBudgetByDay.get(window.day);
    if (budget == null) return null;
    // A day that banked no high action has no high budget and nothing to give.
    if (budget === 0n) return 0n;
    // The lane markers are complete only once the field has FINALIZED: a sole
    // lane announces itself as its seat settles, and every seat settles before
    // the comparator can close the field. Before that, absence proves nothing.
    if (!finalizedByKey.has(window.battleKey)) return null;
    // EITHER SHAPE counts — see above. What must be true is that a high roller
    // actually sat down: a window that seated none allocated nothing, however
    // large the day's budget was.
    if (!highLaneShape.has(window.battleKey)) return 0n;
    const weight = crapsRoutineWeight(dayWindows);
    if (weight == null) return null;
    return crapsWindowShareWei(budget, weight, window.period, window.tier);
  };
  const realizedBoosts = (window, dayWindows) => {
    const index = armedByKey.get(window.battleKey);
    const word = wordAtIndex(wordsByIndex, index);
    if (index == null || word == null) {
      return { mainBoostWei: null, highBoostWei: null, bonusMultiplier: null };
    }
    const bonusMultiplier = crapsBonusMultiplier({
      battleKey: window.battleKey,
      wordValue: word,
    });
    const mainBoostWei = crapsRealizedBoostWei({
      ceilingWei: window.ceilingWei,
      battleKey: window.battleKey,
      wordValue: word,
    });
    const highBase = highBaseFor(window, dayWindows);
    // ⛔ `soleRolledWei` is NOT added here. A sole lane's standing-denied slice is
    // already inside `roundBoost(units)` — the contract splits one allocation into
    // the part that rides and the part it banks — so adding the rollover on top
    // would count the same FLIP twice.
    const highBoostWei = highBase == null
      ? null
      : highBase === 0n
        ? 0n
        : crapsRealizedBoostFromBaseWei({
            baseWei: highBase,
            battleKey: window.battleKey,
            wordValue: word,
          });
    return { mainBoostWei, highBoostWei, bonusMultiplier };
  };
  const resultForWindow = (window, period) => {
    const paid = window ? paidByKey.get(window.battleKey) : null;
    if (!paid) return null;
    const final = finalizedByKey.get(window.battleKey) ?? null;
    const dayWindows = window.day === day ? currentWindows : yesterdayWindows;
    const { mainBoostWei, highBoostWei, bonusMultiplier } = realizedBoosts(window, dayWindows);
    const deniedMainBoostWei = mainRolledWei.get(window.battleKey) ?? 0n;
    const winnerBoostWei = mainBoostWei == null
      ? null
      : mainBoostWei > deniedMainBoostWei ? mainBoostWei - deniedMainBoostWei : 0n;
    // Passes are protocol money the winner WAS paid; the FLIP payment is that same award
    // minus them. Carried beside the boost so the total can count both.
    const winnerPassWei = mainPassWei.get(window.battleKey) ?? 0n;
    const highPaid = highPaidByKey.get(window.battleKey) ?? null;
    const progressivePaid = progressivePaidByKey.get(window.battleKey) ?? null;
    const progressivePaidWei = progressivePaid
      && progressivePaid.betId === paid.betId
      && progressivePaid.winner === String(paid.winner).toLowerCase()
        ? progressivePaid.amountWei
        : 0n;
    const deniedHighBoostWei = contestedHighRolledWei.get(window.battleKey) ?? 0n;
    const highWinnerBoostWei = highPaid?.bankrollRider || highBoostWei == null
      ? null
      : highBoostWei > deniedHighBoostWei ? highBoostWei - deniedHighBoostWei : 0n;
    return Object.freeze({
      period,
      battleKey: window.battleKey,
      ...paid,
      winningStop: final?.winningStop ?? null,
      buyInWei: window.buyInWei,
      highMultiple: highMultipleByDay.get(window.day) ?? null,
      entryMultiple: winnerEntryMultiple(paid.betId, window),
      bonusMultiplier,
      mainBoostWei,
      winnerBoostWei,
      winnerPassWei,
      progressivePaidWei,
      highBoostWei,
      ...(highPaid ? {
        highResult: Object.freeze({
          ...highPaid,
          // A sole rider receives a non-zero rider return iff its run latched
          // the goal. A contested lane always names its comparator winner, but
          // its payment event does not restate that run's stop.
          winningStop: highPaid.bankrollRider ? (highPaid.amountWei > 0n ? 1 : 0) : null,
          entryMultiple: winnerEntryMultiple(highPaid.betId, window, { highLane: true }),
          winnerBoostWei: highWinnerBoostWei,
          // The two lane shapes split under different tags, so read the one this lane ran.
          winnerPassWei: (highPaid.bankrollRider ? soleHighPassWei : contestedHighPassWei)
            .get(window.battleKey) ?? 0n,
        }),
      } : {}),
      // What the protocol put into THIS window, both lanes. A side lane still
      // being counted must not blank the main figure that is already known.
      boostWei: mainBoostWei == null ? null : mainBoostWei + (highBoostWei ?? 0n),
    });
  };
  const results = Object.freeze(currentWindows.map(resultForWindow));
  // The day's EVENT window closes on the day boundary, so its result belongs to
  // yesterday's row rather than to any of today's seven.
  const yesterdayEventResult = resultForWindow(
    yesterdayWindows[CRAPS_BONUS_WINDOWS - 1],
    CRAPS_BONUS_WINDOWS - 1,
  );
  const highRollerBetIdsFor = (window) => {
    if (!window) return Object.freeze([]);
    const direct = [...publicWindowEntries.values()].flatMap((entry) => (
      entry.day === window.day && entry.period === window.period && entry.multiple > 1
        ? [entry.betId]
        : []
    ));
    const daySeats = [...publicDayTickets.values()].flatMap((ticket) => (
      ticket.seen
      && ticket.day === window.day
      && (ticket.highMask & (1 << window.period))
      && ticket.betId != null
        ? [String(ticket.betId)]
        : []
    ));
    return Object.freeze([...new Set([...direct, ...daySeats])].sort((left, right) => {
      const a = BigInt(left);
      const b = BigInt(right);
      return a === b ? 0 : a < b ? -1 : 1;
    }));
  };
  const entryMultipleFor = (entry, window) => (
    winnerEntryMultiple(entry.betId, window, { highLane: entry.remainder !== 0 && entry.multiple > 1 })
      ?? entry.multiple
  );
  const resolvedReplays = Object.freeze([...ownedBets.values()]
    .flatMap((entry) => {
      const windows = entry.remainder === 0
        ? [...openedBySlot.values()].filter((window) => window.day === entry.day)
        : [openedBySlot.get(entry.slot)].filter(Boolean);
      return windows.flatMap((window) => {
        const final = finalizedByKey.get(window.battleKey);
        // Arming is the on-chain boundary where this owned field has closed and
        // entered settlement. Publish that lifecycle immediately; waiting for
        // the final comparator event leaves Pending blank throughout every
        // multi-batch resolution.
        if (!final && !armedByKey.has(window.battleKey)) return [];
        const paid = paidByKey.get(window.battleKey) ?? null;
        const highPaid = highPaidByKey.get(window.battleKey) ?? null;
        const entryMultiple = entryMultipleFor(entry, window);
        const highRollerBetIds = entryMultiple != null && entryMultiple > 1
          ? highRollerBetIdsFor(window)
          : null;
        const dayWindows = window.day === day ? currentWindows : yesterdayWindows;
        const { bonusMultiplier } = realizedBoosts(window, dayWindows);
        return [Object.freeze({
          day: window.day,
          period: window.period,
          slot: window.slot,
          battleKey: window.battleKey,
          viewerBetId: entry.betId,
          buyInWei: window.buyInWei?.toString?.() ?? null,
          battleStakeWei: window.battleStakeWei?.toString?.() ?? null,
          finalized: Boolean(final),
          winningStop: final?.winningStop ?? null,
          winnerId: final?.winnerId ?? null,
          winningPeakWei: final?.winningPeakWei ?? null,
          winningEndWei: final?.winningEndWei ?? null,
          winningScoreBps: final?.winningScoreBps ?? null,
          potWei: final?.potWei ?? null,
          winnerBetId: paid?.betId ?? null,
          winner: paid?.winner ?? null,
          amountWei: paid?.amountWei?.toString?.() ?? null,
          bonusMultiplier,
          ...(entryMultiple != null && entryMultiple > 1 ? {
            entryMultiple,
            entryBattleStakeWei: window.battleStakeWei == null
              ? null
              : (window.battleStakeWei * BigInt(entryMultiple)).toString(),
            highRollerBetIds,
            highRollerEntrants: highRollerBetIds.length,
            highWinnerBetId: highPaid?.betId ?? null,
            highWinner: highPaid?.winner ?? null,
            highPayoutWei: highPaid?.amountWei?.toString?.() ?? null,
            highBankrollRider: highPaid?.bankrollRider ?? null,
          } : {}),
        })];
      });
    })
    .sort((a, b) => {
      const bySlot = BigInt(a.slot) - BigInt(b.slot);
      if (bySlot !== 0n) return bySlot < 0n ? -1 : 1;
      return BigInt(a.viewerBetId) < BigInt(b.viewerBetId) ? -1 : 1;
    }));

  // Yesterday's headline is ALL-OR-NOTHING across both lanes and all seven
  // windows: a partial sum announced as the day's total would understate what
  // the protocol actually put up, which is worse than saying nothing yet.
  let yesterdayAddedMainWei = 0n;
  let yesterdayAddedHighWei = 0n;
  let yesterdayAverageHighWei = 0n;
  let yesterdayComplete = yesterdayDay > 0 && yesterdayWindows.every(Boolean);
  if (yesterdayComplete) {
    for (const window of yesterdayWindows) {
      const { mainBoostWei, highBoostWei } = realizedBoosts(window, yesterdayWindows);
      const highAverageWei = highBaseFor(window, yesterdayWindows);
      if (mainBoostWei == null || highBoostWei == null || highAverageWei == null) {
        yesterdayComplete = false;
        break;
      }
      yesterdayAddedMainWei += mainBoostWei;
      yesterdayAddedHighWei += highBoostWei;
      yesterdayAverageHighWei += highAverageWei;
    }
  }
  const yesterdayAddedWei = yesterdayAddedMainWei + yesterdayAddedHighWei;
  const yesterdayMainAverageWei = mainBudgetByDay.get(yesterdayDay) ?? null;
  // The contract splits raw main funding in half: ladder=floor(raw/2), with at
  // most the odd wei going to Run It Up. Older bounded log windows can retain
  // CrapsHighRollerDayOpened while omitting its adjacent funded echo, so use
  // the proven ladder half rather than blanking a whole-FLIP headline.
  const yesterdayProgressiveFundedWei = progressiveContributionByDay.get(yesterdayDay)
    ?? yesterdayMainAverageWei;
  const yesterdayTotalAddedWei = yesterdayComplete && yesterdayProgressiveFundedWei != null
    ? yesterdayAddedWei + yesterdayProgressiveFundedWei
    : null;
  const yesterdayAverageAddedWei = yesterdayComplete
    && yesterdayProgressiveFundedWei != null
    && yesterdayMainAverageWei != null
      ? yesterdayMainAverageWei + yesterdayAverageHighWei + yesterdayProgressiveFundedWei
      : null;
  const todayMainAverageWei = mainBudgetByDay.get(day) ?? null;
  const todayProgressiveFundedWei = progressiveContributionByDay.get(day) ?? todayMainAverageWei;
  const todayAverageAddedWei = todayMainAverageWei != null && todayProgressiveFundedWei != null
    ? todayMainAverageWei + todayProgressiveFundedWei
    : null;

  const schedule = crapsBonusScheduleFromLogs(day, logs, parser);
  const dayTicketSummary = (entryDay) => {
    const tickets = [...publicDayTickets.values()].filter((ticket) => (
      ticket.seen && ticket.day === entryDay
    ));
    return Object.freeze({
      total: tickets.length,
      high: tickets.filter((ticket) => ticket.highMask === CRAPS_ALL_WINDOWS_MASK).length,
      highByPeriod: Object.freeze(Array.from({ length: CRAPS_BONUS_WINDOWS }, (_, period) => (
        tickets.reduce((count, ticket) => count + ((ticket.highMask & (1 << period)) ? 1 : 0), 0)
      ))),
    });
  };
  const yesterdayTickets = dayTicketSummary(yesterdayDay);
  const todayTickets = dayTicketSummary(day);
  const tomorrowTickets = dayTicketSummary(day + 1);
  const dayEntrants = todayTickets.total;
  const previousEventDayHigh = yesterdayTickets.highByPeriod[CRAPS_BONUS_WINDOWS - 1];
  const previousEventTotal = previousEventDirectEntrants.total + yesterdayTickets.total;
  const previousEventHigh = previousEventDirectEntrants.high + previousEventDayHigh;
  const previousEventBattleStakeWei = yesterdayWindows[CRAPS_BONUS_WINDOWS - 1]?.battleStakeWei ?? null;
  const entrants = Object.freeze({
    days: Object.freeze({
      [String(day)]: dayEntrants,
      [String(day + 1)]: tomorrowTickets.total,
    }),
    highDays: Object.freeze({
      [String(day)]: todayTickets.high,
      [String(day + 1)]: tomorrowTickets.high,
    }),
    previousEvent: Object.freeze({
      period: CRAPS_BONUS_WINDOWS - 1,
      direct: previousEventDirectEntrants.total,
      directHigh: previousEventDirectEntrants.high,
      day: yesterdayTickets.total,
      dayHigh: previousEventDayHigh,
      total: previousEventTotal,
      high: previousEventHigh,
      mainPotStakeWei: previousEventBattleStakeWei == null
        ? null
        : (BigInt(previousEventTotal) * previousEventBattleStakeWei).toString(),
    }),
    windows: Object.freeze(directEntrantCounts.map((direct, period) => {
      // One High Roller still owns one main-scoreboard seat and posts exactly
      // one bounty to the main pot; its remaining H-1 bounties fund the side
      // lane. Whole-day seats join every window when it arms, so both kinds
      // belong in this public main-field count exactly once.
      const total = direct.total + dayEntrants;
      const dayHigh = todayTickets.highByPeriod[period];
      const high = direct.high + dayHigh;
      const battleStakeFlip = schedule?.windows?.[period]?.battleStakeFlip ?? null;
      return Object.freeze({
        period,
        direct: direct.total,
        directHigh: direct.high,
        day: dayEntrants,
        dayHigh,
        total,
        high,
        mainPotStakeWei: battleStakeFlip == null
          ? null
          : (BigInt(total) * battleStakeFlip * CRAPS_FLIP_WEI).toString(),
      });
    })),
  });

  const currentEntry = (entry) => {
    if (!entry) return null;
    const chips = entry.betId == null
      ? Number(entry.chips ?? 0)
      : amendedChipsByBetId.get(String(entry.betId)) ?? Number(entry.chips ?? 0);
    return Object.freeze({ ...entry, chips });
  };

  return Object.freeze({
    day,
    schedule,
    entrants,
    results,
    resolvedReplays,
    playerEntries: scopedPlayer ? Object.freeze({
      player: scopedPlayer,
      days: Object.freeze(Object.fromEntries([...dayTickets].map(([entryDay, ticket]) => (
        [String(entryDay), currentEntry(ticket)]
      )))),
      windows: Object.freeze(playerWindows.map(currentEntry)),
    }) : null,
    yesterdayDay,
    yesterdayEventResult: yesterdayEventResult
      ? Object.freeze({ day: yesterdayDay, ...yesterdayEventResult })
      : null,
    yesterdayAddedWei: yesterdayComplete ? yesterdayAddedWei : null,
    yesterdayAddedMainWei: yesterdayComplete ? yesterdayAddedMainWei : null,
    yesterdayAddedHighWei: yesterdayComplete ? yesterdayAddedHighWei : null,
    yesterdayProgressiveFundedWei,
    yesterdayTotalAddedWei,
    yesterdayAverageAddedWei,
    todayAverageAddedWei,
    yesterdayComplete,
    requiredWordIndexes,
  });
}

/**
 * Validate the indexer's compact winner-total response.
 *
 * The API has already done the hard part: assigning a whole-day ticket's reused bet id to the
 * window that actually settled it. Keep the arithmetic check here too so a stale or partially
 * deployed indexer can never turn a component mismatch into a confident TOTAL WON figure.
 */
export function crapsWinnerTotalsFromPayload(dayValue, payload) {
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0 || Number(payload?.day) !== day) return Object.freeze([]);
  const input = Array.isArray(payload?.results) ? payload.results : [];
  const totals = [];
  for (const value of input) {
    try {
      const resultDay = Number(value?.day);
      const period = Number(value?.period);
      if (
        !Number.isInteger(resultDay)
        || !Number.isInteger(period)
        || period < 0
        || period >= CRAPS_BONUS_WINDOWS
        || (resultDay !== day && !(resultDay === day - 1 && period === CRAPS_BONUS_WINDOWS - 1))
      ) continue;
      const battleKey = String(value?.battleKey ?? '').toLowerCase();
      const winner = String(value?.winner ?? '').toLowerCase();
      const lane = value?.lane === 'high' ? 'high' : value?.lane === 'main' ? 'main' : null;
      if (!/^0x[0-9a-f]{64}$/.test(battleKey) || !/^0x[0-9a-f]{40}$/.test(winner) || !lane) continue;
      const parsedBetId = asUint(value?.betId, 'Craps result bet id');
      if (parsedBetId === 0n) continue;
      const betId = parsedBetId.toString();
      const runPaidWei = value?.runPaidWei == null
        ? null
        : asUint(value.runPaidWei, 'Craps run payout');
      const battlePaidWei = asUint(value?.battlePaidWei, 'Craps battle payout');
      const highPaidWei = asUint(value?.highPaidWei, 'Craps High Roller payout');
      const progressivePaidWei = asUint(value?.progressivePaidWei, 'Craps progressive payout');
      const totalWonWei = value?.totalWonWei == null
        ? null
        : asUint(value.totalWonWei, 'Craps total won');
      if (runPaidWei == null ? totalWonWei != null : (
        totalWonWei !== runPaidWei + battlePaidWei + highPaidWei + progressivePaidWei
      )) continue;
      if (value?.bankrollRider != null && typeof value.bankrollRider !== 'boolean') continue;
      const bankrollRider = value?.bankrollRider ?? null;
      // A sole rider's return is already part of CrapsBetSettled.paid. A non-zero separate
      // high payout here would be the exact double-count this endpoint exists to prevent.
      if (bankrollRider === true && highPaidWei !== 0n) continue;
      totals.push(Object.freeze({
        day: resultDay,
        period,
        battleKey,
        lane,
        betId,
        winner,
        bankrollRider,
        runPaidWei,
        battlePaidWei,
        highPaidWei,
        progressivePaidWei,
        totalWonWei,
      }));
    } catch (_error) {
      // One malformed row cannot blank the other completed battles.
    }
  }
  return Object.freeze(totals);
}

/**
 * Enrich chain-native lobby facts with the indexer's attributed settlement credits.
 *
 * Winner identity, lane shape, schedule and entry state remain usable without the DB. Only the
 * derived total is nullable: showing a dash is honest; relabeling the battle pot as a total is not.
 */
export function crapsLobbySnapshotWithWinnerTotals(snapshot, totals = []) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot ?? null;
  const winnerKey = (entry, lane = entry?.lane) => [
    String(entry?.battleKey ?? '').toLowerCase(),
    lane,
    String(entry?.betId),
    String(entry?.winner ?? '').toLowerCase(),
  ].join(':');
  const byWinner = new Map((Array.isArray(totals) ? totals : []).map((entry) => [
    winnerKey(entry),
    entry,
  ]));
  const enrichLane = (result, lane) => {
    if (!result || typeof result !== 'object') return result ?? null;
    const match = byWinner.get(winnerKey(result, lane));
    const chainProgressive = typeof result.progressivePaidWei === 'bigint'
      ? result.progressivePaidWei
      : null;
    // The chain event and indexed projection normally agree. Prefer a positive
    // chain value so a just-finalized hit cannot briefly disappear behind a
    // stale zero response; otherwise the projection can fill an older snapshot.
    const progressivePaidWei = chainProgressive != null && chainProgressive > 0n
      ? chainProgressive
      : match?.progressivePaidWei ?? chainProgressive;
    const totalWonWei = match?.runPaidWei == null
      ? null
      : match.runPaidWei
        + match.battlePaidWei
        + match.highPaidWei
        + (progressivePaidWei ?? 0n);
    return Object.freeze({
      ...result,
      runPaidWei: match?.runPaidWei ?? null,
      battlePaidWei: match?.battlePaidWei ?? null,
      highPaidWei: match?.highPaidWei ?? null,
      progressivePaidWei,
      totalWonWei,
    });
  };
  const enrichResult = (result) => {
    if (!result) return null;
    const main = enrichLane(result, 'main');
    return Object.freeze({
      ...main,
      ...(result.highResult ? { highResult: enrichLane({
        ...result.highResult,
        battleKey: result.battleKey,
      }, 'high') } : {}),
    });
  };
  return Object.freeze({
    ...snapshot,
    results: Object.freeze((Array.isArray(snapshot.results) ? snapshot.results : []).map(enrichResult)),
    yesterdayEventResult: enrichResult(snapshot.yesterdayEventResult),
  });
}

/** Storage key of the VRF word committed to table index, in GAME's own layout. */
export function crapsSettlementWordStorageKey(index) {
  return ethers.toBeHex(hashPair(asUint(index, 'Craps table index'), CRAPS_SETTLEMENT_WORD_SLOT), 32);
}

/**
 * The settlement word for a table index, or null while it is still undrawn.
 *
 * CrapsBattle exposes no `wordAt` — it reaches into GAME with `extsload`, and
 * the deployment kept none of the table's public read surface. Reading the same
 * slot directly is the only client path to a realized boost figure; calling the
 * absent selector reverts with no data and blanks the whole banner.
 */
export async function readCrapsSettlementWord(index, providerOverride = null, blockTag = 'latest') {
  const provider = providerOverride ?? readerProvider();
  if (!provider) return null;
  const game = CONTRACTS.GAME;
  if (typeof game !== 'string' || !ethers.isAddress(game) || game === ethers.ZeroAddress) return null;
  const raw = await readContractStorage(
    game,
    crapsSettlementWordStorageKey(index),
    { provider, blockTag },
  );
  const word = asUint(raw, 'Craps settlement word');
  return word === 0n ? null : word;
}

/** One window read powers schedule terms, completed rows, and the prior-day boost. */
export async function readCrapsLobbySnapshot(dayValue, player = null) {
  if (!isCrapsAvailable()) return null;
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0) return null;
  const provider = readerProvider();
  const logs = await readCrapsWindowLogs(provider);
  const parser = crapsLobbyReceiptParser();
  const shell = crapsLobbySnapshotFromLogs(day, logs, { parser, player });
  // Settlement words are chain storage and stay chain reads. Pin them to one
  // head so a batch cannot straddle a block, and only pay for the head read
  // when a window actually needs a word.
  let blockTag = 'latest';
  if (shell.requiredWordIndexes.length > 0 && typeof provider?.getBlockNumber === 'function') {
    try { blockTag = Number(await readProviderBlockNumber(provider)); }
    catch (_error) { blockTag = 'latest'; }
  }
  const words = new Map(await Promise.all(shell.requiredWordIndexes.map(async (index) => {
    try { return [String(index), await readCrapsSettlementWord(index, provider, blockTag)]; }
    catch (_error) { return [String(index), null]; }
  })));
  return crapsLobbySnapshotFromLogs(day, logs, { parser, wordsByIndex: words, player });
}

function structuredRevert(error, fallback) {
  const decoded = decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || fallback);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage || fallback;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

/**
 * Simulate a Craps write without sending an eth_call through the connected
 * browser wallet. WalletConnect relays can leave that permissionless request
 * waiting in the wallet app, so the real transaction request never follows.
 * The public RPC still receives the connected account as `from`, preserving
 * every msg.sender-dependent allowance, balance, ownership, and entry check.
 */
async function requireCrapsWritePreflight(method, args, fallback) {
  const sender = String(get('connected.address') ?? '');
  const reader = readerProvider();
  if (!reader || !ethers.isAddress(sender)) return;
  const simulation = await requireStaticCall(
    buildContract(reader),
    method,
    [...args, { from: sender }],
  );
  if (!simulation.ok) throw structuredRevert(simulation.error, fallback);
}

export function __setCrapsContractFactoryForTest(factory, address = TEST_ADDRESS) {
  _contractFactory = factory;
  _addressOverride = address;
}

export function __resetCrapsContractFactoryForTest() {
  // Clear the persisted windows under the OVERRIDE address first, then again
  // under the real one: the two keys differ, and a survivor would be revived by
  // the next test as if it were this session's own scan.
  __resetCrapsLogWindowForTest();
  _contractFactory = null;
  _addressOverride = undefined;
  _readProvider = null;
  _crapsEventsFetcher = null;
  __resetCrapsLogWindowForTest();
}

export function crapsReceiptParser() {
  return {
    interface: {
      parseLog(log) {
        if (log?.parsed) return log.parsed;
        return memoParseCrapsLog(interfaceForCraps(), log);
      },
    },
  };
}

/** Live global progressive shared by every scheduled Craps battle. */
export async function readCrapsProgressivePool() {
  if (!isCrapsAvailable()) return null;
  return asUint(await readContract().progressivePool(), 'Craps progressive pool').toString();
}

export function parseCrapsReceipt(receipt, parser = crapsReceiptParser()) {
  const result = { placed: [], reserved: [], upgraded: [], amended: [], settled: [] };
  for (const log of receipt?.logs || []) {
    let parsed;
    try { parsed = parser?.interface?.parseLog?.(log); } catch (_error) { parsed = null; }
    if (!parsed) continue;
    const a = parsed.args || {};
    if (parsed.name === 'CrapsSlipPlaced') {
      // ONE packed word, not a field per value — the deployed echo carries the
      // chip board, the bet id, the entry multiple and the frozen standing.
      const packed = asUint(a.bet ?? a[1], 'Craps placed slip');
      const betId = (packed >> CRAPS_EVENT_BET_ID_SHIFT) & CRAPS_EVENT_BET_ID_MASK;
      result.placed.push({
        player: a.player ?? a[0],
        betId: betId.toString(),
        slot: (betId >> 64n).toString(),
        multiple: Number(((packed >> CRAPS_EVENT_MULT_SHIFT) & CRAPS_EVENT_MULT_MASK) + 1n),
      });
    } else if (parsed.name === 'CrapsSlipAmended') {
      result.amended.push({
        betId: asUint(a.betId ?? a[0], 'Amended Craps bet').toString(),
        chips: Number(asUint(a.chips ?? a[1], 'Amended Craps board') & CRAPS_EVENT_CHIPS_MASK),
      });
    } else if (parsed.name === 'CrapsDayReserved') {
      result.reserved.push({
        player: a.player ?? a[0],
        day: Number(asUint(a.day ?? a[1], 'Reserved Craps day')),
        highRoller: Boolean(a.highRoller ?? a[2]),
      });
    } else if (parsed.name === 'CrapsDayWindowsUpgraded') {
      result.upgraded.push({
        player: a.player ?? a[0],
        day: Number(asUint(a.day ?? a[1], 'Upgraded Craps day')),
        upgradedMask: Number(asUint(a.upgradedMask ?? a[2], 'Craps upgrade mask')),
        burnedWei: asUint(a.burned ?? a[3], 'Craps upgrade burn').toString(),
      });
    } else if (parsed.name === 'CrapsBetSettled') {
      result.settled.push({
        betId: String(a.betId ?? a[0]),
        player: a.player ?? a[1],
        wonWei: asUint(a.won ?? a[2], 'Craps won').toString(),
        paidWei: asUint(a.paid ?? a[3], 'Craps paid').toString(),
      });
    }
  }
  return result;
}

/** Submit a scheduled window, today's whole-day lane, or a blind future-day reservation. */
export async function placeCrapsBonusEntry(wager, { onSubmitted } = {}) {
  requireCraps();
  if (!wager || wager.valid === false) {
    throw new Error(wager?.errors?.[0]?.message || 'The craps entry is invalid.');
  }
  const method = wager.method === 'enterBonusDay'
    ? 'enterBonusDay'
    : wager.method === 'enterBonusBattle'
      ? 'enterBonusBattle'
      : wager.method === 'applyCrapsPasses'
        ? 'applyCrapsPasses'
        : wager.method === 'buyFutureCrapsDays'
          ? 'buyFutureCrapsDays'
          : null;
  if (!method || !Array.isArray(wager.contractArgs)) throw new Error('Unknown scheduled craps entry.');
  const args = wager.contractArgs;
  const expectedArgs = method === 'enterBonusDay' ? 2 : method === 'enterBonusBattle' ? 3 : 4;
  if (args.length !== expectedArgs) throw new Error('The scheduled craps entry has the wrong call shape.');

  await requireCrapsWritePreflight(method, args, 'Craps entry was rejected.');
  const receipt = await sendTx(
    (freshSigner) => buildContract(freshSigner)[method](...args),
    method === 'applyCrapsPasses'
      ? 'Use Craps comp'
      : method === 'buyFutureCrapsDays'
        ? 'Reserve future Craps day'
        : method === 'enterBonusDay' ? 'Enter full Craps day' : 'Enter Craps battle',
    { onSubmitted },
  );
  return { receipt, method };
}

/** Re-spread zero through seven chips on one still-open scheduled entry. */
export async function amendCrapsSlip({ betId, contractChips, onSubmitted } = {}) {
  requireCraps();
  const id = asUint(betId, 'Craps bet id');
  const chips = asUint(contractChips, 'Craps board');
  if (id === 0n) throw new Error('Choose a Craps entry to amend.');
  if (chips > CRAPS_EVENT_CHIPS_MASK) throw new Error('The Craps board is not a packed uint32.');
  const args = [id.toString(), Number(chips)];
  await requireCrapsWritePreflight('amendSlip', args, 'Craps amendment was rejected.');
  const receipt = await sendTx(
    (freshSigner) => buildContract(freshSigner).amendSlip(...args),
    'Amend Craps entry',
    { onSubmitted },
  );
  return { receipt, betId: id.toString(), contractChips: Number(chips) };
}

/** Upgrade selected windows of an existing whole-day ticket to High Roller. */
export async function upgradeCrapsDayWindows({ day, periodMask, onSubmitted } = {}) {
  requireCraps();
  const entryDay = Number(day);
  const mask = Number(periodMask);
  if (!Number.isInteger(entryDay) || entryDay <= 0 || entryDay > 0xFFFFFF) {
    throw new Error('Choose a valid Craps day to upgrade.');
  }
  if (!Number.isInteger(mask) || mask <= 0 || mask > CRAPS_ALL_WINDOWS_MASK) {
    throw new Error('Choose at least one open Craps battle to upgrade.');
  }
  const args = [entryDay, mask];
  await requireCrapsWritePreflight('upgradeDayWindows', args, 'Craps upgrade was rejected.');
  const receipt = await sendTx(
    (freshSigner) => buildContract(freshSigner).upgradeDayWindows(...args),
    'Upgrade Craps day windows',
    { onSubmitted },
  );
  return { receipt, day: entryDay, periodMask: mask };
}

// Revert copy for the errors the DEPLOYED contract can actually raise. Kept in
// lockstep with FLIP_CRAPS_ABI's error list: copy for an error the contract no
// longer declares is dead weight, and a deployed error with no copy surfaces to
// the player as a generic failure.
const errors = [
  // CLIENT-SIDE validation codes, not contract reverts: the board editor raises
  // these before anything is sent, and the reason map carries their fallback copy.
  ['NoStake', 'Place at least one FLIP chip.', 'Add a chip to the board.'],
  ['OddsAboveAllowance', 'Those Pass Odds exceed your current activity allowance.', 'Lower the odds multiplier.'],
  ['BankrollBelowStake', 'The bankroll cannot cover one base board.', 'Raise the bankroll or lower the board.'],
  ['BadGoal', 'The payout goal must exceed twice the starting bankroll.', 'Raise the goal or set it to zero.'],
  // Contract reverts, one per error the deployed CrapsBattle declares.
  ['BonusPeriodSpent', 'That Craps battle has already closed.', 'Choose the current battle or a later one.'],
  ['BonusStillRunning', 'That Craps battle is still taking entries.', 'Wait for it to close.'],
  ['NoSuchBattle', 'That Craps battle does not exist.', 'Reload the lobby and choose an open battle.'],
  ['NoSuchBet', 'That craps bet does not exist.', 'Refresh your open bets.'],
  ['NotYourBet', 'That craps slip belongs to another wallet.', 'Switch wallets or choose your own slip.'],
  ['BetLocked', 'That slip is locked: its battle has closed and its table is bound.', 'Wait for the result.'],
  ['AlreadyInBonus', 'This wallet is already entered in that Craps battle.', 'Choose another open battle.'],
  ['ScoreRequiredForBonus', 'Your activity score does not meet this battle’s entry bar.', 'Raise your activity score or choose another battle.'],
  ['BadEntryMultiple', 'That Craps entry multiple is not available.', 'Use the standard entry option.'],
  ['BadPassCount', 'Choose at least one future Craps day.', 'Choose a future day and try again.'],
  ['DayNotReservable', 'That future Craps day is already reserved or no longer blind.', 'Choose another future day.'],
  ['NothingToUpgrade', 'Those Craps battles are already High Roller or no longer upgradeable.', 'Choose another open battle.'],
  ['BadRandomCount', 'A Craps board may place at most seven chips.', 'Remove chips until seven or fewer remain.'],
  ['TooManyChipsOnALeg', 'One Craps position has too many chips.', 'Spread that stack across more positions.'],
  ['BoardPlaysBothSides', 'A board cannot play Pass and Don’t Pass together.', 'Choose one side of the line.'],
  ['RngNotReady', 'That table’s dice have not landed yet.', 'Try again once the round’s randomness arrives.'],
  ['SeedAboveMax', 'That donation would overflow the battle’s seed.', 'Donate a smaller amount.'],
  ['BadBurnTag', 'That FLIP burn was not tagged for Craps.', 'Retry the entry from the lobby.'],
  ['BadBattleTerms', 'Those custom battle terms are out of range.', 'Adjust the terms and try again.'],
  ['NotBattleCreator', 'This wallet is not approved to open custom Craps battles.', 'Use the scheduled battles instead.'],
  ['NotVaultOwner', 'Only the vault owner may set the vault’s Craps board.', 'Switch to the vault owner wallet.'],
  ['OnlyGame', 'That Craps call is reserved for the protocol.', 'Use the lobby entry buttons.'],
];
for (const [code, userMessage, recoveryAction] of errors) register(code, { code, userMessage, recoveryAction });
