// sDGNRS-weighted charity governance for the GNRUS donation contract.
//
// The ballot is intentionally read from chain: GNRUS stores only a 20-slot
// address slate, the current level, vote weights, and per-wallet vote state.
// A holder may vote once on each eligible slot during a level; the previous
// paid winner is ineligible for the immediately following ballot.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { sharedReadProvider } from './read-provider.js';
import { get } from './store.js';

const GNRUS_VOTE_ABI = [
  'function currentLevel() external view returns (uint24)',
  'function getActiveSlots() external view returns (uint8[] slots, address[] recipients)',
  'function lastWinningRecipient() external view returns (address)',
  'function slotApproveWeight(uint24 level, uint8 slot) external view returns (uint256)',
  'function hasVoted(uint24 level, address voter, uint8 slot) external view returns (bool)',
  'function vote(uint8 slot) external',
  'event Voted(uint24 indexed level, uint8 indexed slot, address indexed voter, uint256 weight)',
  'error InvalidSlot()',
  'error VoteRejected(uint8 reason)',
  'error PreviousWinnerNotVotable()',
];

const SDGNRS_VOTE_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
];

const GNRUS_FUNDING_EVENT = 'YieldSurplusDistributed(uint256)';
const GNRUS_FUNDING_TOPIC = ethers.id(GNRUS_FUNDING_EVENT);
const GNRUS_FUNDING_CACHE_VERSION = 1;
const GNRUS_FUNDING_LOG_CHUNK_BLOCKS = 50_000;
const GNRUS_FUNDING_REORG_BLOCKS = 128;

let _gnrusContractFactory = null;
let _sdgnrsContractFactory = null;
let _stateReader = null;
let _voteWriter = null;
let _publicProvider = null;
let _gnrusFundingCache = null;

/** Test-only contract seams. */
export function __setContractFactoriesForTest({ gnrus, sdgnrs } = {}) {
  _gnrusContractFactory = typeof gnrus === 'function' ? gnrus : null;
  _sdgnrsContractFactory = typeof sdgnrs === 'function' ? sdgnrs : null;
}

/** Test-only UI seams. */
export function __setCharityVoteDepsForTest({ readState, vote } = {}) {
  _stateReader = typeof readState === 'function' ? readState : null;
  _voteWriter = typeof vote === 'function' ? vote : null;
}

/** Test-only reset. */
export function __resetCharityVoteForTest() {
  _gnrusContractFactory = null;
  _sdgnrsContractFactory = null;
  _stateReader = null;
  _voteWriter = null;
  _publicProvider = null;
  _gnrusFundingCache = null;
}

export function gnrusLifetimeFundingCacheKey() {
  return [
    'gnrus-lifetime-funding-v1',
    Number(CHAIN.id) || 0,
    Number(CHAIN.deployBlock) || 0,
    String(CONTRACTS.GAME || '').toLowerCase(),
  ].join(':');
}

function _fundingStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage || null; }
  catch (_e) { return null; }
}

function _emptyFundingCache(key) {
  return {
    key,
    version: GNRUS_FUNDING_CACHE_VERSION,
    throughBlock: Math.max(0, Number(CHAIN.deployBlock) || 0) - 1,
    events: [],
  };
}

function _normalizeFundingEvent(row) {
  try {
    const blockNumber = Number(row?.blockNumber);
    const logIndex = Number(row?.logIndex ?? row?.index ?? 0);
    const amount = BigInt(row?.amount ?? row?.data ?? 0);
    if (!Number.isInteger(blockNumber) || blockNumber < 0
      || !Number.isInteger(logIndex) || logIndex < 0 || amount < 0n) return null;
    return {
      blockNumber,
      logIndex,
      transactionHash: String(row?.transactionHash || '').toLowerCase(),
      amount: amount.toString(),
    };
  } catch (_e) {
    return null;
  }
}

function _loadFundingCache(storage) {
  const key = gnrusLifetimeFundingCacheKey();
  if (_gnrusFundingCache?.key === key) return _gnrusFundingCache;
  let parsed = null;
  try { parsed = JSON.parse(storage?.getItem?.(key) || 'null'); }
  catch (_e) { /* unavailable or stale browser storage */ }
  const deployBlock = Math.max(0, Number(CHAIN.deployBlock) || 0);
  const events = Array.isArray(parsed?.events)
    ? parsed.events.map(_normalizeFundingEvent).filter(Boolean)
    : [];
  _gnrusFundingCache = parsed?.version === GNRUS_FUNDING_CACHE_VERSION
    && Number.isInteger(Number(parsed?.throughBlock))
    && Number(parsed.throughBlock) >= deployBlock - 1
    ? {
        key,
        version: GNRUS_FUNDING_CACHE_VERSION,
        throughBlock: Number(parsed.throughBlock),
        events,
      }
    : _emptyFundingCache(key);
  return _gnrusFundingCache;
}

function _saveFundingCache(storage, cache) {
  _gnrusFundingCache = cache;
  try {
    storage?.setItem?.(cache.key, JSON.stringify({
      version: cache.version,
      throughBlock: cache.throughBlock,
      events: cache.events,
    }));
  } catch (_e) { /* private mode or quota pressure */ }
}

function _fundingAmountFromLog(log) {
  const data = String(log?.data || '');
  if (!/^0x[0-9a-f]{64}$/i.test(data)) return null;
  try { return BigInt(data); }
  catch (_e) { return null; }
}

/**
 * Cumulative ETH-equivalent credited to GNRUS by every yield distribution in
 * this deployment. A short tail is replaced on each read so shallow reorgs do
 * not double-count or strand an orphaned event; older events stay cached.
 */
export async function readGnrusLifetimeFunding({ provider, storage } = {}) {
  if (!CONTRACTS.GAME) throw new Error('GNRUS funding is unavailable on this network.');
  const reader = provider || sharedReadProvider();
  if (!reader || typeof reader.getBlockNumber !== 'function'
    || typeof reader.getLogs !== 'function') {
    throw new Error('GNRUS funding needs a public chain reader.');
  }

  const head = Number(await reader.getBlockNumber());
  const deployBlock = Math.max(0, Number(CHAIN.deployBlock) || 0);
  if (!Number.isInteger(head) || head < deployBlock) return 0n;

  const targetStorage = _fundingStorage(storage);
  let cache = _loadFundingCache(targetStorage);
  if (cache.throughBlock > head) cache = _emptyFundingCache(cache.key);

  const fromBlock = cache.throughBlock >= deployBlock
    ? Math.max(deployBlock, cache.throughBlock - GNRUS_FUNDING_REORG_BLOCKS + 1)
    : deployBlock;
  const retained = cache.events.filter((event) => event.blockNumber < fromBlock);
  const refreshed = [];
  for (let from = fromBlock; from <= head; from += GNRUS_FUNDING_LOG_CHUNK_BLOCKS) {
    const to = Math.min(head, from + GNRUS_FUNDING_LOG_CHUNK_BLOCKS - 1);
    const logs = await reader.getLogs({
      address: CONTRACTS.GAME,
      topics: [GNRUS_FUNDING_TOPIC],
      fromBlock: from,
      toBlock: to,
    });
    for (const log of Array.isArray(logs) ? logs : []) {
      const amount = _fundingAmountFromLog(log);
      if (amount == null) continue;
      const event = _normalizeFundingEvent({
        blockNumber: log?.blockNumber,
        logIndex: log?.index ?? log?.logIndex,
        transactionHash: log?.transactionHash,
        amount,
      });
      if (event) refreshed.push(event);
    }
  }

  const events = [...retained, ...refreshed].sort((a, b) => (
    a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
  ));
  cache = {
    key: cache.key,
    version: GNRUS_FUNDING_CACHE_VERSION,
    throughBlock: head,
    events,
  };
  _saveFundingCache(targetStorage, cache);
  return events.reduce((sum, event) => sum + BigInt(event.amount), 0n);
}

function _readerProvider() {
  const wallet = getProvider();
  if (wallet) return wallet;
  // Shared read provider (C15): coalesces this module's reads into the
  // app-wide batch stream instead of a private single-call provider.
  return sharedReadProvider();
}

function _gnrus(connection) {
  if (_gnrusContractFactory) return _gnrusContractFactory(connection);
  if (!CONTRACTS.GNRUS) throw new Error('Charity voting is unavailable on this network.');
  return new ethers.Contract(CONTRACTS.GNRUS, GNRUS_VOTE_ABI, connection);
}

function _sdgnrs(connection) {
  if (_sdgnrsContractFactory) return _sdgnrsContractFactory(connection);
  if (!CONTRACTS.SDGNRS) throw new Error('sDGNRS voting power is unavailable on this network.');
  return new ethers.Contract(CONTRACTS.SDGNRS, SDGNRS_VOTE_ABI, connection);
}

function _sameAddress(a, b) {
  return Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
}

function _voteError(error) {
  const name = error?.revert?.name || error?.errorName || null;
  const reason = Number(error?.revert?.args?.[0] ?? error?.errorArgs?.[0] ?? -1);
  let local = null;
  if (name === 'VoteRejected') {
    local = [
      ['EmptySlot', 'That charity is no longer on the active ballot.', 'Refresh the ballot.'],
      ['AlreadyVoted', 'You already voted for that charity this level.', 'Choose another eligible charity.'],
      ['ZeroVotingPower', 'You need at least 1 whole sDGNRS to vote.', 'Earn sDGNRS before voting.'],
    ][reason] || null;
  } else if (name === 'PreviousWinnerNotVotable') {
    local = ['PreviousWinnerNotVotable', 'The previous winner cannot win two levels in a row.', 'Choose another charity.'];
  } else if (name === 'InvalidSlot') {
    local = ['InvalidSlot', 'That charity slot is invalid.', 'Refresh the ballot.'];
  }
  const decoded = local
    ? { code: local[0], userMessage: local[1], recoveryAction: local[2] }
    : decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || 'Charity vote failed.');
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

/**
 * Read the active GNRUS ballot and an optional connected wallet's vote state.
 * Every call is pinned to one block so a level transition cannot mix slates.
 */
export async function readCharityVoteState({ voter } = {}) {
  const target = voter || get('connected.address') || null;
  if (_stateReader) return _stateReader({ voter: target });

  const provider = _readerProvider();
  if (!provider) throw new Error('Connect a wallet or configure a public RPC to load the charity ballot.');
  const gnrus = _gnrus(provider);
  const sdgnrs = _sdgnrs(provider);
  const blockTag = typeof provider.getBlockNumber === 'function'
    ? await provider.getBlockNumber()
    : null;
  const overrides = blockTag == null ? [] : [{ blockTag }];

  const [levelRaw, active, lastWinner, votingPowerRaw] = await Promise.all([
    gnrus.currentLevel(...overrides),
    gnrus.getActiveSlots(...overrides),
    gnrus.lastWinningRecipient(...overrides),
    target ? sdgnrs.balanceOf(target, ...overrides) : 0n,
  ]);
  const level = Number(levelRaw);
  const slots = Array.from(active?.slots ?? active?.[0] ?? [], Number);
  const recipients = Array.from(active?.recipients ?? active?.[1] ?? [], String);
  const candidates = await Promise.all(slots.map(async (slot, index) => {
    const recipient = recipients[index] || ethers.ZeroAddress;
    const [weightRaw, votedRaw] = await Promise.all([
      gnrus.slotApproveWeight(level, slot, ...overrides),
      target ? gnrus.hasVoted(level, target, slot, ...overrides) : false,
    ]);
    return {
      slot,
      recipient,
      weight: BigInt(weightRaw),
      voted: Boolean(votedRaw),
      previousWinner: _sameAddress(recipient, lastWinner),
    };
  }));

  return {
    blockTag,
    level,
    voter: target,
    votingPower: BigInt(votingPowerRaw),
    lastWinner: String(lastWinner || ethers.ZeroAddress),
    candidates,
  };
}

/** Cast the connected sDGNRS holder's vote for one active charity slot. */
export async function voteForCharity({ slot } = {}) {
  const slotNumber = Number(slot);
  if (!Number.isInteger(slotNumber) || slotNumber < 0 || slotNumber > 19) {
    throw new Error('Choose a valid charity.');
  }
  if (_voteWriter) return _voteWriter({ slot: slotNumber });

  const connected = get('connected.address');
  if (!connected) throw new Error('Connect a wallet to vote.');
  if (get('ui.mode') !== 'self') {
    throw new Error('Switch back to your own wallet before voting.');
  }
  const viewed = get('viewing.address');
  if (viewed && !_sameAddress(viewed, connected)) {
    throw new Error('Switch back to your own wallet before voting.');
  }

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(_gnrus(signer), 'vote', [slotNumber], signer);
    if (!sim.ok) throw _voteError(sim.error);
  }

  try {
    const receipt = await sendTx(
      (freshSigner) => _gnrus(freshSigner).vote(slotNumber),
      'Vote for charity',
    );
    return { receipt, slot: slotNumber };
  } catch (error) {
    if (error?.revert?.name || error?.errorName) throw _voteError(error);
    throw error;
  }
}
