// FlipCraps contract adapter. The active testnet profile points at CrapsBattle;
// undeployed profiles still degrade reads cleanly and fail writes with a clear
// message. Wager values supplied by the table use whole FLIP for display while
// scheduled-entry calldata contains only the packed chip board and multiplier.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { sharedReadProvider } from './read-provider.js';

const BETS = '(uint24 passLine,uint24 dontPassLine,uint24 place4,uint24 place5,uint24 place6,uint24 place8,uint24 place9,uint24 place10,uint24 hard4,uint24 hard8,uint16 passOddsMult)';
const HAND_RECORD = '(int256 net,uint32 rolls,uint8 pointsMade,bool truncated)';
const OUTCOME = '(uint256 staked,uint256 returned,int256 net,uint32 rolls,uint8 pointsMade,bool truncated,uint256[11] legStaked,uint256[11] legReturned)';
const SESSION = `(uint256 hands,uint256 staked,uint256 returned,int256 net,uint256 totalRolls,uint256[11] legStaked,uint256[11] legReturned,${HAND_RECORD}[] ledger,bytes rollLog)`;
const SLIP_RESULT = `(uint256 bankrollIn,uint256 bankrollOut,uint256 handsPlayed,uint256 unitsPlayed,uint256 totalRolls,uint8 stop,${HAND_RECORD}[] ledger,bytes rollLog)`;
const STORED_BET = `(address player,uint48 index,uint16 hands,uint16 rakeBps,bool settled,uint8 mode,uint128 staked,uint128 goal,${BETS} bets)`;

export const FLIP_CRAPS_ABI = Object.freeze([
  `function placeBet(${BETS} b,uint16 hands) returns (uint64 betId)`,
  `function placeSlip(${BETS} b,uint128 bankroll,uint128 goal,bool letItRide) returns (uint64 betId)`,
  'function enterBonusBattle(uint256 period,uint32 chips,uint16 multiple) returns (uint256 betId)',
  'function enterBonusDay(uint32 chips,uint16 multiple) returns (uint256 placed)',
  'function applyCrapsPasses(uint24 startDay,uint8 count,bool high,uint32 chips)',
  'function buyFutureCrapsDays(uint24 startDay,uint8 count,bool high,uint32 chips)',
  'function upgradeDayWindows(uint24 day,uint8 periodMask) returns (uint256 burned)',
  'function progressivePool() view returns (uint256)',
  'function resolveBets(uint64[] betIds)',
  'function currentIndex() view returns (uint48)',
  'function wordAt(uint48 index) view returns (uint256)',
  'function isResolved(uint48 index) view returns (bool)',
  `function stakeFor(${BETS} b) pure returns (uint256 total)`,
  `function quote(${BETS} b,uint32 hands) pure returns (uint256)`,
  `function theoFor(${BETS} b) pure returns (uint256)`,
  'function maxOddsFor(address player) view returns (uint256)',
  'function rakeBpsFor(address player) view returns (uint256)',
  `function betOf(uint64 betId) view returns (${STORED_BET})`,
  'function previewSettlement(uint64 betId) view returns (uint256 won,bool survived,uint256 paid)',
  'function survivedAt(uint48 index) view returns (bool)',
  'function shooterDice(uint48 index,uint256 handOrdinal) view returns (uint8[])',
  `function resolveHandAt(${BETS} b,uint48 index) view returns (${OUTCOME} o)`,
  `function resolveHandsAt(${BETS} b,uint48 index,uint256 hands) view returns (${SESSION})`,
  `function resolveSlipAt(${BETS} b,uint48 index,uint256 bankroll,uint256 goal,uint256 cap,bool ride) view returns (${SLIP_RESULT})`,
  'event CrapsBetPlaced(uint64 indexed betId,address indexed player,uint48 indexed index,uint32 hands,uint256 staked)',
  'event CrapsSlipPlaced(uint64 indexed betId,address indexed player,uint48 indexed index,uint256 bankroll,uint256 goal)',
  'event CrapsBetSettled(uint64 indexed betId,address indexed player,uint256 staked,uint256 won,bool survived,uint256 paid,bytes rolls)',
  'event CrapsRakeback(address indexed player,uint64 indexed betId,uint256 amount)',
  'event CrapsBonusOpened(bytes32 indexed battleKey,uint48 indexed slot,uint256 seed,uint128 bankroll,uint128 goal,uint256 boardStake,uint256 battleStake)',
  'event CrapsBonusDonated(bytes32 indexed battleKey,address indexed donor,uint256 amount,uint256 seed)',
  'error NoStake()',
  'error BadBetHandCount()',
  'error NoSuchBet()',
  'error AlreadySettled()',
  'error CoinNotPinned()',
  'error OddsAboveAllowance()',
  'error BankrollBelowStake()',
  'error BadGoal()',
  'error CoinflipNotPinned()',
  'error NotTheLiveIndex()',
  'error IndexAlreadyRevealed()',
  'error RngNotReady()',
  'error GameNotPinned()',
  'error BonusPeriodSpent()',
  'error AlreadyInBonus()',
  'error ScoreRequiredForBonus()',
  'error BadEntryMultiple()',
  'error BadPassCount()',
  'error DayNotReservable()',
  'error NothingToUpgrade()',
  'error BadRandomCount()',
  'error TooManyChipsOnALeg()',
  'error BoardPlaysBothSides()',
]);

// Canonical scheduled-battle logs used by the compact tournament lobby. Keep
// these separate from the legacy table receipt ABI above: the deployed battle
// intentionally packs a slip into one word, while older fixed-table receipts
// use the wider event shape parsed elsewhere in this adapter.
export const CRAPS_LOBBY_EVENT_ABI = Object.freeze([
  'event CrapsSlipPlaced(address indexed player,uint256 bet)',
  'event CrapsBonusOpened(bytes32 indexed battleKey,uint48 indexed slot,uint256 seed,uint128 bankroll,uint128 goal,uint256 boardStake,uint256 battleStake)',
  'event CrapsBonusDonated(bytes32 indexed battleKey,address indexed donor,uint256 amount,uint256 seed)',
  'event CrapsBonusArmed(bytes32 indexed battleKey,uint48 indexed slot,uint48 indexed index)',
  'event CrapsDayReserved(address indexed player,uint24 indexed day,bool highRoller)',
  'event CrapsDayWindowsUpgraded(address indexed player,uint24 indexed day,uint8 upgradedMask,uint256 burned)',
  'event CrapsBattleFinalized(bytes32 indexed battleKey,uint8 winningStop,uint64 winnerId,uint256 winningPeak,uint256 winningEnd,uint256 winningScoreBps,uint256 pot)',
  'event CrapsBattlePaid(uint256 indexed betId,bytes32 indexed battleKey,address indexed player,uint256 amount)',
]);

const TEST_ADDRESS = '0x0000000000000000000000000000000000000001';
const CRAPS_BONUS_WINDOWS = 7;
const CRAPS_BONUS_CHIPS = 10n;
const CRAPS_PICKED_CHIPS = 7n;
const CRAPS_FLIP_WEI = 10n ** 18n;
const CRAPS_LOG_LOOKBACK_BLOCKS = 45_000;
// CrapsBattle._SCHED_BANK_MULT — the scheduled depth is FIXED at 5 (a run
// latches its win and plays on, so depth stopped separating the formats and
// the schedule stopped drawing it). The label map survives for CUSTOM battles,
// which still name their own depth in the packed terms.
const CRAPS_SCHED_BANK_MULT = 5;
// CrapsBattle._SCHED_GOAL_LOW / _SCHED_GOAL_HIGH — two rungs, drawn evenly.
const CRAPS_SCHED_GOAL_LOW = 5;
const CRAPS_SCHED_GOAL_HIGH = 20;
const CRAPS_SPEED_LABELS = Object.freeze({ 2: 'TURBO', 5: 'NORMAL', 10: 'SLOW' });
const CRAPS_HIGH_ROLLER_TAG = 0x48696768526f6c6c6572n;
const CRAPS_BOOST_TAG = 0x426f6f7374n;
const CRAPS_BOOST_MAX_MULTIPLE = 100n;
const CRAPS_BATTLE_STAKE_UNIT_WEI = 100n * CRAPS_FLIP_WEI;
const CRAPS_EVENT_BET_ID_SHIFT = 32n;
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
  const wallet = getProvider();
  if (wallet) return wallet;
  if (!_readProvider) _readProvider = sharedReadProvider();
  return _readProvider;
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
  const packed = asUint(value, 'Craps pass balance');
  return Object.freeze({
    normal: Number(packed & CRAPS_PASS_COUNT_MASK),
    high: Number((packed >> 32n) & CRAPS_PASS_COUNT_MASK),
  });
}

export function crapsPassCreditsStorageKey(player) {
  if (!ethers.isAddress(String(player ?? ''))) throw new Error('Choose a valid player to read Craps passes.');
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256'],
    [ethers.getAddress(String(player)), CRAPS_PASS_CREDITS_MAPPING_SLOT],
  ));
}

/** Read the two uncommitted Craps day-pass lanes from the deployed packed mapping. */
export async function readCrapsPassCredits(player) {
  requireCraps();
  const provider = readerProvider();
  if (!provider?.getStorage) throw new Error('The chain provider cannot read Craps pass balances.');
  const packed = await provider.getStorage(contractAddress(), crapsPassCreditsStorageKey(player));
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
  const goalMult = (roll >> 32n) % 2n === 0n ? CRAPS_SCHED_GOAL_LOW : CRAPS_SCHED_GOAL_HIGH;
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

function parsedCrapsLog(log, parser) {
  if (log?.parsed) return log.parsed;
  try { return parser?.interface?.parseLog?.(log) ?? null; }
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
  // Despite the historical ABI name, CrapsBonusOpened.boardStake is the seven
  // chips a picker posts. Reinflate it to the ten-chip round used for depth.
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

/** Read the current day's published schedule directly from CrapsBattle logs. */
export async function readCrapsBonusSchedule(dayValue) {
  if (!isCrapsAvailable()) return null;
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0) return null;
  const provider = readerProvider();
  if (!provider?.getBlockNumber || !provider?.getLogs) return null;
  const latestBlock = Number(await provider.getBlockNumber());
  const deployBlock = Number(CHAIN.deployBlock ?? 0);
  const fromBlock = Math.max(deployBlock, latestBlock - CRAPS_LOG_LOOKBACK_BLOCKS);
  const iface = interfaceForCraps();
  const openedTopic = iface.getEvent('CrapsBonusOpened').topicHash;
  const donatedTopic = iface.getEvent('CrapsBonusDonated').topicHash;
  const logs = await provider.getLogs({
    address: contractAddress(),
    fromBlock,
    toBlock: latestBlock,
    topics: [[openedTopic, donatedTopic]],
  });
  return crapsBonusScheduleFromLogs(day, logs);
}

function crapsLobbyReceiptParser() {
  return { interface: interfaceForCrapsLobby() };
}

/**
 * Reproduce the scheduled pot boost that actually landed once a battle's
 * settlement word became public. CrapsBonusOpened.seed is the 100x ceiling;
 * Solidity draws one of 1/4x, 1x, 10x, or 100x and floors it to the same
 * 100-FLIP granule before putting it in the finalized pot.
 */
export function crapsRealizedBoostWei({ ceilingWei, battleKey, wordValue } = {}) {
  const ceiling = asUint(ceilingWei, 'Craps boost ceiling');
  const word = asUint(wordValue, 'Craps settlement word');
  if (word === 0n) return null;
  const key = asUint(battleKey, 'Craps battle key');
  const roll = hashTriple(word, key, CRAPS_BOOST_TAG) % 1000n;
  const quarterMultiple = roll < 768n ? 1n : roll < 976n ? 4n : roll < 996n ? 40n : 400n;
  const base = ceiling / CRAPS_BOOST_MAX_MULTIPLE;
  const units = (base * quarterMultiple) / (4n * CRAPS_BATTLE_STAKE_UNIT_WEI);
  return units * CRAPS_BATTLE_STAKE_UNIT_WEI;
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
 * of the historical added figure; only the contract's own boost ladder is.
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
  const ownedBets = new Map();
  const dayTickets = new Map();
  const playerWindows = Array(CRAPS_BONUS_WINDOWS).fill(null);

  const rememberDayTicket = (entryDay, highMask = 0) => {
    if (entryDay !== day && entryDay !== day + 1) return;
    const prior = dayTickets.get(entryDay);
    dayTickets.set(entryDay, {
      day: entryDay,
      source: 'day',
      highMask: (prior?.highMask ?? 0) | (Number(highMask) & CRAPS_ALL_WINDOWS_MASK),
    });
  };

  for (const log of logs) {
    const parsed = parsedCrapsLog(log, parser);
    if (!parsed) continue;
    const args = parsed.args ?? {};
    try {
      if (parsed.name === 'CrapsSlipPlaced') {
        const entrant = String(args.player ?? args[0]).toLowerCase();
        if (!scopedPlayer || entrant !== scopedPlayer) continue;
        const packed = asUint(args.bet ?? args[1], 'Craps placed slip');
        const betId = (packed >> CRAPS_EVENT_BET_ID_SHIFT) & CRAPS_EVENT_BET_ID_MASK;
        const slot = betId >> 64n;
        const entryDay = Number(slot / BigInt(CRAPS_BONUS_WINDOWS + 1));
        const remainder = Number(slot % BigInt(CRAPS_BONUS_WINDOWS + 1));
        const multiple = Number(((packed >> CRAPS_EVENT_MULT_SHIFT) & CRAPS_EVENT_MULT_MASK) + 1n);
        ownedBets.set(betId.toString(), Object.freeze({
          betId: betId.toString(),
          slot: slot.toString(),
          day: entryDay,
          remainder,
        }));
        if (remainder === 0) {
          rememberDayTicket(entryDay, multiple > 1 ? CRAPS_ALL_WINDOWS_MASK : 0);
        } else if (entryDay === day && remainder <= CRAPS_BONUS_WINDOWS) {
          playerWindows[remainder - 1] = Object.freeze({
            day: entryDay,
            period: remainder - 1,
            source: 'window',
            multiple,
            high: multiple > 1,
          });
        }
      } else if (parsed.name === 'CrapsDayReserved') {
        const entrant = String(args.player ?? args[0]).toLowerCase();
        if (!scopedPlayer || entrant !== scopedPlayer) continue;
        rememberDayTicket(
          Number(asUint(args.day ?? args[1], 'Reserved Craps day')),
          Boolean(args.highRoller ?? args[2]) ? CRAPS_ALL_WINDOWS_MASK : 0,
        );
      } else if (parsed.name === 'CrapsDayWindowsUpgraded') {
        const entrant = String(args.player ?? args[0]).toLowerCase();
        if (!scopedPlayer || entrant !== scopedPlayer) continue;
        rememberDayTicket(
          Number(asUint(args.day ?? args[1], 'Upgraded Craps day')),
          Number(asUint(args.upgradedMask ?? args[2], 'Craps upgrade mask')),
        );
      } else if (parsed.name === 'CrapsBonusOpened') {
        const slot = asUint(args.slot ?? args[1], 'Craps bonus slot');
        const remainder = Number(slot % 8n);
        if (remainder < 1 || remainder > CRAPS_BONUS_WINDOWS) continue;
        const openedDay = Number(slot / 8n);
        const battleKey = String(args.battleKey ?? args[0]).toLowerCase();
        const window = Object.freeze({
          day: openedDay,
          period: remainder - 1,
          slot: slot.toString(),
          battleKey,
          ceilingWei: asUint(args.seed ?? args[2], 'Craps boost ceiling'),
        });
        openedBySlot.set(window.slot, window);
        if (openedDay !== day && openedDay !== yesterdayDay) continue;
        (openedDay === day ? currentWindows : yesterdayWindows)[window.period] = window;
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
  const results = Object.freeze(currentWindows.map((window, period) => {
    const paid = window ? paidByKey.get(window.battleKey) : null;
    if (!paid) return null;
    const index = armedByKey.get(window.battleKey);
    const word = wordAtIndex(wordsByIndex, index);
    const boostWei = index == null || word == null
      ? null
      : crapsRealizedBoostWei({
          ceilingWei: window.ceilingWei,
          battleKey: window.battleKey,
          wordValue: word,
        });
    return Object.freeze({ period, battleKey: window.battleKey, ...paid, boostWei });
  }));
  const resolvedReplays = Object.freeze([...ownedBets.values()]
    .flatMap((entry) => {
      const windows = entry.remainder === 0
        ? [...openedBySlot.values()].filter((window) => window.day === entry.day)
        : [openedBySlot.get(entry.slot)].filter(Boolean);
      return windows.flatMap((window) => {
        const final = finalizedByKey.get(window.battleKey);
        if (!final) return [];
        const paid = paidByKey.get(window.battleKey) ?? null;
        return [Object.freeze({
          day: window.day,
          period: window.period,
          slot: window.slot,
          battleKey: window.battleKey,
          viewerBetId: entry.betId,
          ...final,
          winner: paid?.winner ?? null,
          amountWei: paid?.amountWei?.toString?.() ?? null,
        })];
      });
    })
    .sort((a, b) => {
      const bySlot = BigInt(a.slot) - BigInt(b.slot);
      if (bySlot !== 0n) return bySlot < 0n ? -1 : 1;
      return BigInt(a.viewerBetId) < BigInt(b.viewerBetId) ? -1 : 1;
    }));

  let yesterdayAddedWei = 0n;
  let yesterdayComplete = yesterdayDay > 0 && yesterdayWindows.every(Boolean);
  if (yesterdayComplete) {
    for (const window of yesterdayWindows) {
      const index = armedByKey.get(window.battleKey);
      const word = wordAtIndex(wordsByIndex, index);
      if (index == null || word == null) {
        yesterdayComplete = false;
        break;
      }
      const realized = crapsRealizedBoostWei({
        ceilingWei: window.ceilingWei,
        battleKey: window.battleKey,
        wordValue: word,
      });
      if (realized == null) {
        yesterdayComplete = false;
        break;
      }
      yesterdayAddedWei += realized;
    }
  }

  return Object.freeze({
    day,
    schedule: crapsBonusScheduleFromLogs(day, logs, parser),
    results,
    resolvedReplays,
    playerEntries: scopedPlayer ? Object.freeze({
      player: scopedPlayer,
      days: Object.freeze(Object.fromEntries([...dayTickets].map(([entryDay, ticket]) => (
        [String(entryDay), Object.freeze({ ...ticket })]
      )))),
      windows: Object.freeze(playerWindows),
    }) : null,
    yesterdayDay,
    yesterdayAddedWei: yesterdayComplete ? yesterdayAddedWei : null,
    yesterdayComplete,
    requiredWordIndexes,
  });
}

/** One RPC log read powers schedule terms, completed rows, and the prior-day boost. */
export async function readCrapsLobbySnapshot(dayValue, player = null) {
  if (!isCrapsAvailable()) return null;
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day <= 0) return null;
  const provider = readerProvider();
  if (!provider?.getBlockNumber || !provider?.getLogs) return null;
  const latestBlock = Number(await provider.getBlockNumber());
  const deployBlock = Number(CHAIN.deployBlock ?? 0);
  const fromBlock = Math.max(deployBlock, latestBlock - CRAPS_LOG_LOOKBACK_BLOCKS);
  const iface = interfaceForCrapsLobby();
  const topics = [
    'CrapsSlipPlaced',
    'CrapsBonusOpened',
    'CrapsBonusDonated',
    'CrapsBonusArmed',
    'CrapsDayReserved',
    'CrapsDayWindowsUpgraded',
    'CrapsBattleFinalized',
    'CrapsBattlePaid',
  ]
    .map((name) => iface.getEvent(name).topicHash);
  const logs = await provider.getLogs({
    address: contractAddress(),
    fromBlock,
    toBlock: latestBlock,
    topics: [topics],
  });
  const parser = crapsLobbyReceiptParser();
  const shell = crapsLobbySnapshotFromLogs(day, logs, { parser, player });
  const contract = readContract();
  const words = new Map(await Promise.all(shell.requiredWordIndexes.map(async (index) => {
    try { return [String(index), asUint(await contract.wordAt(index), 'Craps settlement word')]; }
    catch (_error) { return [String(index), null]; }
  })));
  return crapsLobbySnapshotFromLogs(day, logs, { parser, wordsByIndex: words, player });
}

function plain(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value.toObject === 'function') {
    try { return plain(value.toObject(true)); } catch (_error) { /* fall through */ }
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)]));
  }
  return value;
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

export function __setCrapsContractFactoryForTest(factory, address = TEST_ADDRESS) {
  _contractFactory = factory;
  _addressOverride = address;
}

export function __resetCrapsContractFactoryForTest() {
  _contractFactory = null;
  _addressOverride = undefined;
  _readProvider = null;
}

export function crapsReceiptParser() {
  return {
    interface: {
      parseLog(log) {
        if (log?.parsed) return log.parsed;
        try { return interfaceForCraps().parseLog(log); } catch (_error) { return null; }
      },
    },
  };
}

/** Current or historical shared-table state. */
export async function readCrapsTable({ index } = {}) {
  if (!isCrapsAvailable()) {
    return { available: false, currentIndex: null, index: null, resolved: false, word: '0', survived: null };
  }
  const contract = readContract();
  const current = asUint(await contract.currentIndex(), 'Current index');
  const target = index == null ? current : asUint(index, 'Table index');
  const [wordValue, resolvedValue] = await Promise.all([
    contract.wordAt(target),
    contract.isResolved(target),
  ]);
  const word = asUint(wordValue, 'VRF word');
  const resolved = Boolean(resolvedValue) || word !== 0n;
  const survived = resolved ? Boolean(await contract.survivedAt(target)) : null;
  return {
    available: true,
    currentIndex: current.toString(),
    index: target.toString(),
    resolved,
    word: word.toString(),
    survived,
  };
}

export async function readCrapsPerks(player) {
  if (!isCrapsAvailable() || !player) return { available: isCrapsAvailable(), maxOdds: 3, rakeBps: 0 };
  const contract = readContract();
  const [maxOdds, rakeBps] = await Promise.all([
    contract.maxOddsFor(player),
    contract.rakeBpsFor(player),
  ]);
  return { available: true, maxOdds: Number(maxOdds), rakeBps: Number(rakeBps) };
}

/** Live global progressive shared by every scheduled Craps battle. */
export async function readCrapsProgressivePool() {
  if (!isCrapsAvailable()) return null;
  return asUint(await readContract().progressivePool(), 'Craps progressive pool').toString();
}

export async function readCrapsQuote({ bets, hands = 1 } = {}) {
  if (!isCrapsAvailable()) return null;
  const count = asUint(hands, 'Shooter count');
  const contract = readContract();
  const [stake, quote, theo] = await Promise.all([
    contract.stakeFor(bets),
    contract.quote(bets, count),
    contract.theoFor(bets),
  ]);
  return { stakeWei: String(stake), quoteWei: String(quote), theoPerHandWei: String(theo) };
}

export async function readCrapsBet(betId) {
  if (!isCrapsAvailable()) return null;
  return plain(await readContract().betOf(asUint(betId, 'Bet id')));
}

export async function previewCrapsSettlement(betId) {
  if (!isCrapsAvailable()) return null;
  const result = await readContract().previewSettlement(asUint(betId, 'Bet id'));
  return { won: String(result.won ?? result[0]), survived: Boolean(result.survived ?? result[1]), paid: String(result.paid ?? result[2]) };
}

export async function readCrapsShooterDice(index, handOrdinal = 0) {
  if (!isCrapsAvailable()) return [];
  const flat = await readContract().shooterDice(
    asUint(index, 'Table index'),
    asUint(handOrdinal, 'Shooter ordinal'),
  );
  const dice = Array.from(flat, Number);
  const rolls = [];
  for (let offset = 0; offset + 1 < dice.length; offset += 2) {
    const d1 = dice[offset];
    const d2 = dice[offset + 1];
    rolls.push({ d1, d2, total: d1 + d2, hard: d1 === d2 });
  }
  return rolls;
}

/** Full per-leg resolver view for fixed, flat-slip, or let-it-ride preview. */
export async function readCrapsBreakdown({
  bets,
  index,
  mode = 'fixed',
  hands = 1,
  bankrollWei = 0,
  goalWei = 0,
  cap = 256,
  letItRide = false,
} = {}) {
  const contract = readContract();
  const tableIndex = asUint(index, 'Table index');
  if (mode === 'slip' || mode === 'ride') {
    return plain(await contract.resolveSlipAt(
      bets,
      tableIndex,
      asUint(bankrollWei, 'Bankroll'),
      asUint(goalWei, 'Goal'),
      asUint(cap, 'Shooter cap'),
      mode === 'ride' || Boolean(letItRide),
    ));
  }
  const count = asUint(hands, 'Shooter count');
  return plain(count === 1n
    ? await contract.resolveHandAt(bets, tableIndex)
    : await contract.resolveHandsAt(bets, tableIndex, count));
}

export function parseCrapsReceipt(receipt, parser = crapsReceiptParser()) {
  const result = { placed: [], settled: [], rakeback: [] };
  for (const log of receipt?.logs || []) {
    let parsed;
    try { parsed = parser?.interface?.parseLog?.(log); } catch (_error) { parsed = null; }
    if (!parsed) continue;
    const a = parsed.args || {};
    if (parsed.name === 'CrapsBetPlaced') {
      result.placed.push({ mode: 'fixed', betId: String(a.betId ?? a[0]), player: a.player ?? a[1], index: String(a.index ?? a[2]), hands: Number(a.hands ?? a[3]), staked: String(a.staked ?? a[4]) });
    } else if (parsed.name === 'CrapsSlipPlaced') {
      result.placed.push({ mode: 'slip', betId: String(a.betId ?? a[0]), player: a.player ?? a[1], index: String(a.index ?? a[2]), bankroll: String(a.bankroll ?? a[3]), goal: String(a.goal ?? a[4]) });
    } else if (parsed.name === 'CrapsBetSettled') {
      result.settled.push({ betId: String(a.betId ?? a[0]), player: a.player ?? a[1], staked: String(a.staked ?? a[2]), won: String(a.won ?? a[3]), survived: Boolean(a.survived ?? a[4]), paid: String(a.paid ?? a[5]), rolls: a.rolls ?? a[6] });
    } else if (parsed.name === 'CrapsRakeback') {
      result.rakeback.push({ player: a.player ?? a[0], betId: String(a.betId ?? a[1]), amount: String(a.amount ?? a[2]) });
    }
  }
  return result;
}

export async function placeCrapsWager(wager, { onSubmitted } = {}) {
  requireCraps();
  if (!wager || wager.valid === false) throw new Error(wager?.errors?.[0]?.message || 'The craps wager is invalid.');
  const method = wager.method === 'placeSlip' ? 'placeSlip' : wager.method === 'placeBet' ? 'placeBet' : null;
  if (!method || !Array.isArray(wager.contractArgs)) throw new Error('Unknown craps placement mode.');
  const args = wager.contractArgs;
  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const simulation = await requireStaticCall(buildContract(signer), method, args, signer);
    if (!simulation.ok) throw structuredRevert(simulation.error, 'Craps wager was rejected.');
  }
  const receipt = await sendTx(
    (freshSigner) => buildContract(freshSigner)[method](...args),
    method === 'placeBet' ? 'Place craps bet' : 'Place craps slip',
    { onSubmitted },
  );
  return { receipt, events: parseCrapsReceipt(receipt) };
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

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const simulation = await requireStaticCall(buildContract(signer), method, args, signer);
    if (!simulation.ok) throw structuredRevert(simulation.error, 'Craps entry was rejected.');
  }
  const receipt = await sendTx(
    (freshSigner) => buildContract(freshSigner)[method](...args),
    method === 'applyCrapsPasses'
      ? 'Use Craps day pass'
      : method === 'buyFutureCrapsDays'
        ? 'Reserve future Craps day'
        : method === 'enterBonusDay' ? 'Enter full Craps day' : 'Enter Craps battle',
    { onSubmitted },
  );
  return { receipt, method };
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
  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const simulation = await requireStaticCall(buildContract(signer), 'upgradeDayWindows', args, signer);
    if (!simulation.ok) throw structuredRevert(simulation.error, 'Craps upgrade was rejected.');
  }
  const receipt = await sendTx(
    (freshSigner) => buildContract(freshSigner).upgradeDayWindows(...args),
    'Upgrade Craps day windows',
    { onSubmitted },
  );
  return { receipt, day: entryDay, periodMask: mask };
}

export async function resolveCrapsBets({ betIds, onSubmitted } = {}) {
  requireCraps();
  if (!Array.isArray(betIds) || betIds.length === 0) throw new Error('Choose at least one craps bet to settle.');
  const ids = betIds.map((id) => asUint(id, 'Bet id'));
  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const simulation = await requireStaticCall(buildContract(signer), 'resolveBets', [ids], signer);
    if (!simulation.ok) throw structuredRevert(simulation.error, 'Craps settlement was rejected.');
  }
  const receipt = await sendTx(
    (freshSigner) => buildContract(freshSigner).resolveBets(ids),
    'Settle craps bets',
    { onSubmitted },
  );
  return { receipt, events: parseCrapsReceipt(receipt) };
}

const errors = [
  ['NoStake', 'Place at least one FLIP chip.', 'Add a chip to the board.'],
  ['BadBetHandCount', 'A fixed bet must cover 1–25 shooters.', 'Choose 1–25 shooters.'],
  ['OddsAboveAllowance', 'Those Pass Odds exceed your current activity allowance.', 'Lower the odds multiplier.'],
  ['BankrollBelowStake', 'The bankroll cannot cover one base board.', 'Raise the bankroll or lower the board.'],
  ['BadGoal', 'The payout goal must exceed twice the starting bankroll.', 'Raise the goal or set it to zero.'],
  ['IndexAlreadyRevealed', 'This table has already rolled; betting is closed.', 'Refresh onto the current open table.'],
  ['NoSuchBet', 'That craps bet does not exist.', 'Refresh your open bets.'],
  ['AlreadySettled', 'That craps bet has already been settled.', 'Refresh your open bets.'],
  ['CoinNotPinned', 'FLIP Craps is not fully connected yet.', 'Wait for the deployment pins.'],
  ['CoinflipNotPinned', 'Craps rakeback is not fully connected yet.', 'Wait for the deployment pins.'],
  ['GameNotPinned', 'Craps randomness is not fully connected yet.', 'Wait for the deployment pins.'],
  ['BonusPeriodSpent', 'That Craps battle has already closed.', 'Choose the current battle or a later one.'],
  ['AlreadyInBonus', 'This wallet is already entered in that Craps battle.', 'Choose another open battle.'],
  ['ScoreRequiredForBonus', 'Your activity score does not meet this battle’s entry bar.', 'Raise your activity score or choose another battle.'],
  ['BadEntryMultiple', 'That Craps entry multiple is not available.', 'Use the standard entry option.'],
  ['BadPassCount', 'Choose at least one future Craps day.', 'Choose a future day and try again.'],
  ['DayNotReservable', 'That future Craps day is already reserved or no longer blind.', 'Choose another future day.'],
  ['NothingToUpgrade', 'Those Craps battles are already High Roller or no longer upgradeable.', 'Choose another open battle.'],
  ['BadRandomCount', 'A Craps board must place exactly seven chips or leave the board blank.', 'Place all seven chips.'],
  ['TooManyChipsOnALeg', 'One Craps position has too many chips.', 'Spread that stack across more positions.'],
  ['BoardPlaysBothSides', 'A board cannot play Pass and Don’t Pass together.', 'Choose one side of the line.'],
];
for (const [code, userMessage, recoveryAction] of errors) register(code, { code, userMessage, recoveryAction });
