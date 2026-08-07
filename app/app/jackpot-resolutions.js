// Player-facing Decimator and BAF resolution helpers.
//
// Decimator resolution is a permissionless GAME call. It credits the named
// player's internal winnings/lootbox result, never the caller. BAF normally
// resolves atomically during the level transition; the only player-callable
// BAF resolution is WWXRP consolation after a skipped x10 round.

import { CHAIN, CONTRACTS } from './chain-config.js';
import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { getActingAddress } from './store.js';

const DECIMATOR_RESOLUTION_ABI = [
  'function claimDecimatorJackpot(address player, uint24 lvl) external',
  'error DecClaimInactive()',
  'error DecAlreadyClaimed()',
  'error DecNotWinner()',
  'error RngNotReady()',
];

const BAF_RESOLUTION_ABI = [
  'function bafConsolationOf(address player, uint24 lvl) external view returns (uint256)',
  'function claimBafConsolation(address player, uint24 lvl) external',
  'event BafConsolationClaimed(address indexed player, uint24 indexed lvl, uint256 score, uint256 wwxrpAmount)',
  'error NothingToClaim()',
];
const ENTRIES_PER_TICKET = 4n;

let _decimatorFactory = null;
let _bafFactory = null;
let _readProvider = null;

/** Test-only contract seams. */
export function __setResolutionFactoriesForTest({ decimator, baf } = {}) {
  _decimatorFactory = typeof decimator === 'function' ? decimator : null;
  _bafFactory = typeof baf === 'function' ? baf : null;
}

/** Test-only reset. */
export function __resetResolutionFactoriesForTest() {
  _decimatorFactory = null;
  _bafFactory = null;
  _readProvider = null;
}

function _readerProvider() {
  const wallet = getProvider();
  if (wallet) return wallet;
  if (!_readProvider) {
    _readProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 2 },
    );
  }
  return _readProvider;
}

function _decimatorContract(runner) {
  if (_decimatorFactory) return _decimatorFactory(runner);
  return new ethers.Contract(CONTRACTS.GAME, DECIMATOR_RESOLUTION_ABI, runner);
}

function _bafContract(runner) {
  if (_bafFactory) return _bafFactory(runner);
  return new ethers.Contract(CONTRACTS.JACKPOTS, BAF_RESOLUTION_ABI, runner);
}

function _errorName(error) {
  return error?.revert?.name || error?.errorName || null;
}

function _resolutionError(error, fallback) {
  const name = _errorName(error);
  const local = name === 'NothingToClaim'
    ? {
        code: 'NothingToClaim',
        userMessage: 'This BAF consolation was already claimed or is no longer available.',
        recoveryAction: 'The resolution display will refresh automatically.',
      }
    : null;
  const decoded = local || decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || fallback);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

export function isDecimatorResolutionLevel(level) {
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl <= 0) return false;
  const mod100 = lvl % 100;
  return mod100 === 0 || (lvl % 10 === 5 && mod100 !== 95);
}

/**
 * Pick the round a live player-resolution display should show.
 *
 * During x4/x99 the burn targets the following x5/x00 round. Otherwise the
 * newest eligible level at or below the current level remains on screen. The
 * level-5 fallback gives a pre-game visitor a useful upcoming target.
 */
export function decimatorResolutionLevel(currentLevel, windowOpen = false) {
  const lvl = Number(currentLevel);
  if (!Number.isInteger(lvl) || lvl < 0) return null;
  const mod100 = lvl % 100;
  const deterministicWindow = (lvl % 10 === 4 && mod100 !== 94) || mod100 === 99;
  // Once the target level has actually started, it outranks a stale indexed
  // `decWindowOpen` latch from x4/x99. Advancing to level 15 while that flag
  // still reads true must resolve level 15, not incorrectly probe level 16.
  if (isDecimatorResolutionLevel(lvl)) return lvl;
  if (windowOpen || deterministicWindow) return lvl + 1;

  for (let candidate = lvl; candidate > 0; candidate -= 1) {
    if (isDecimatorResolutionLevel(candidate)) return candidate;
  }
  return 5;
}

/** Latest BAF bracket, or level 10 while the first bracket is accumulating. */
export function bafResolutionLevel(currentLevel) {
  const lvl = Number(currentLevel);
  if (!Number.isInteger(lvl) || lvl < 0) return null;
  return lvl < 10 ? 10 : Math.floor(lvl / 10) * 10;
}

/**
 * BAF bracket receiving newly settled winning FLIP payouts right now.
 *
 * Coinflip records against `_bafBracketLevel(currentLevel + 1)`, so the x10
 * boundary starts the following decade's bracket instead of adding to the
 * bracket that just resolved.
 */
export function activeBafScoreLevel(currentLevel) {
  const lvl = Number(currentLevel);
  if (!Number.isInteger(lvl) || lvl < 0) return null;
  return Math.ceil((lvl + 1) / 10) * 10;
}

/**
 * Exact eth_call probe for a Decimator claim.
 *
 * There is no claimable view on GAME. Static-calling the permissionless claim
 * is the authoritative, race-safe substitute and distinguishes a ready winner
 * from an already-claimed winner or a losing subbucket.
 */
export async function readDecimatorClaimState({ player, level } = {}) {
  if (!player || !isDecimatorResolutionLevel(level)) {
    return { state: 'unknown', errorName: null };
  }
  const sim = await requireStaticCall(
    _decimatorContract(_readerProvider()),
    'claimDecimatorJackpot',
    [player, Number(level)],
  );
  if (sim.ok) return { state: 'ready', errorName: null };

  const name = _errorName(sim.error);
  if (name === 'DecAlreadyClaimed') return { state: 'claimed', errorName: name };
  if (name === 'DecNotWinner') return { state: 'lost', errorName: name };
  if (name === 'DecClaimInactive') return { state: 'pending', errorName: name };
  if (name === 'RngNotReady') return { state: 'waiting', errorName: name };
  return { state: 'unknown', errorName: name };
}

/** Exact WWXRP consolation still claimable for a skipped BAF bracket. */
export async function readBafConsolation({ player, level } = {}) {
  const lvl = Number(level);
  if (!player || !Number.isInteger(lvl) || lvl <= 0 || lvl % 10 !== 0) return null;
  try {
    return BigInt(await _bafContract(_readerProvider()).bafConsolationOf(player, lvl));
  } catch (_e) {
    return null;
  }
}

/** Permissionlessly mint a skipped bracket's consolation to `player`. */
export async function claimBafConsolation({ player, level } = {}) {
  const target = player || getActingAddress();
  const lvl = Number(level);
  if (!target) throw new Error('Connect a wallet first.');
  if (!Number.isInteger(lvl) || lvl <= 0 || lvl % 10 !== 0) {
    throw new Error('Invalid BAF level.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(
      _bafContract(signer),
      'claimBafConsolation',
      [target, lvl],
      signer,
    );
    if (!sim.ok) throw _resolutionError(sim.error, 'BAF consolation is unavailable.');
  }

  try {
    const receipt = await sendTx(
      (freshSigner) => _bafContract(freshSigner).claimBafConsolation(target, lvl),
      `Claim BAF consolation for level ${lvl}`,
    );
    return { receipt };
  } catch (error) {
    if (_errorName(error)) throw _resolutionError(error, 'BAF consolation claim failed.');
    throw error;
  }
}

/** Aggregate one player's indexed BAF ETH and whole-ticket awards at a level. */
export function summarizeBafAwards(wins, level) {
  const lvl = Number(level);
  let eth = 0n;
  let ticketEntries = 0n;
  for (const row of Array.isArray(wins) ? wins : []) {
    if (Number(row?.level) !== lvl) continue;
    const kind = String(row?.awardType || '');
    try {
      if (kind === 'eth_baf') eth += BigInt(row?.amount ?? 0);
      // JackpotTicketWin.entryCount is stored verbatim by the current indexer.
      // Four on-chain entries are one complete player-facing ticket.
      if (kind === 'tickets_baf') ticketEntries += BigInt(row?.amount ?? 0);
    } catch (_e) { /* malformed indexed row: ignore just that award */ }
  }
  return { eth, tickets: ticketEntries / ENTRIES_PER_TICKET };
}
