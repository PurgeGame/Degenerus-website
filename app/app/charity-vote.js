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

let _gnrusContractFactory = null;
let _sdgnrsContractFactory = null;
let _stateReader = null;
let _voteWriter = null;
let _publicProvider = null;

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
}

function _readerProvider() {
  const wallet = getProvider();
  if (wallet) return wallet;
  if (!_publicProvider && CHAIN.rpcUrl) {
    _publicProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      Number(CHAIN.id),
      { staticNetwork: true, batchMaxCount: 1 },
    );
  }
  return _publicProvider;
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
