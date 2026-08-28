// FlipCraps contract adapter. The address intentionally remains null in both
// chain profiles until deployment; reads degrade cleanly while writes fail
// with a clear message. All wager values supplied by the table component are
// already contract-shaped and use whole FLIP for the Bets tuple.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason, register } from './reason-map.js';
import { CONTRACTS } from './chain-config.js';
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
]);

const TEST_ADDRESS = '0x0000000000000000000000000000000000000001';
let _contractFactory = null;
let _addressOverride;
let _readProvider = null;
let _iface = null;

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

function asUint(value, label) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch (_error) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
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
];
for (const [code, userMessage, recoveryAction] of errors) register(code, { code, userMessage, recoveryAction });
