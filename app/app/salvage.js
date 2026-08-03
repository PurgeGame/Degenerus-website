// Far-future ticket salvage: exact on-chain preview + atomic execution.
//
// Quantities are ENTRY counts (four entries per whole ticket). The queue index
// comes from the indexer's exact far_future_queue mirror and is consumed by the
// contract only when a line is fully liquidated.

import { sendTx, getProvider, ethers } from './contracts.js';
import { requireStaticCall } from './static-call.js';
import { decodeRevertReason } from './reason-map.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import { getActingAddress } from './store.js';

const SALVAGE_ABI = [
  // Declared view here so a provider runner uses eth_call. The deployed GAME
  // wrapper is non-view because it delegatecalls a view implementation; the
  // selector and returned tuple are identical.
  'function previewSellFarFutureEntries(address player, uint32[] levels, uint256[] quantities) external view returns (uint256 totalFaceWei, uint256 totalBudget, uint256 ticketWei, uint256 ethCashWei, uint256 flipTokens)',
  'function sellFarFutureEntries(address player, uint32[] levels, uint256[] quantities, uint256[] queueIndices) external',
  'event FarFutureSwap(address indexed player, address indexed buyer, uint256 lineCount, uint256 totalBudgetWei, uint256 ticketWei, uint256 ethCashWei, uint256 flipTokens)',
  'error InvalidDistance()',
  'error InvalidQuantity()',
  'error RngLocked()',
  'error NotApproved()',
  'error E()',
];

export const SALVAGE_ENTRIES_PER_TICKET = 4n;
export const SALVAGE_MAX_LINES = 32;

let _contractFactory = null;
let _readProvider = null;

export function __setSalvageContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
}

export function __resetSalvageContractFactoryForTest() {
  _contractFactory = null;
  _readProvider = null;
}

function _readRunner() {
  const wallet = getProvider();
  if (wallet) return wallet;
  if (!_readProvider && CHAIN.rpcUrl) {
    _readProvider = new ethers.JsonRpcProvider(
      CHAIN.rpcUrl,
      { name: CHAIN.name, chainId: CHAIN.id },
      { staticNetwork: true },
    );
  }
  return _readProvider;
}

function _buildContract(runner) {
  if (_contractFactory) return _contractFactory(runner);
  if (!runner || !CONTRACTS.GAME) throw new Error('Salvage is unavailable right now.');
  return new ethers.Contract(CONTRACTS.GAME, SALVAGE_ABI, runner);
}

function _uintArray(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Choose at least one ${label}.`);
  }
  return values.map((value) => {
    const n = BigInt(value);
    if (n < 0n) throw new Error(`Invalid ${label}.`);
    return n;
  });
}

function _normalizeLines(levels, quantities, queueIndices = null) {
  const ls = _uintArray(levels, 'far-future level');
  const qs = _uintArray(quantities, 'ticket quantity');
  if (ls.length !== qs.length || ls.length > SALVAGE_MAX_LINES) {
    throw new Error(`Choose 1–${SALVAGE_MAX_LINES} far-future levels.`);
  }
  for (let i = 0; i < ls.length; i += 1) {
    if (ls[i] > 0xFFFF_FFFFn) throw new Error('Invalid far-future level.');
    if (qs[i] === 0n || qs[i] % SALVAGE_ENTRIES_PER_TICKET !== 0n) {
      throw new Error('Salvage quantities must be whole tickets.');
    }
  }
  if (queueIndices == null) return { levels: ls, quantities: qs };
  const indices = _uintArray(queueIndices, 'queue position');
  if (indices.length !== ls.length) throw new Error('Salvage queue data is incomplete.');
  return { levels: ls, quantities: qs, queueIndices: indices };
}

function _quoteTuple(value) {
  return {
    totalFaceWei: BigInt(value?.totalFaceWei ?? value?.[0] ?? 0),
    totalBudget: BigInt(value?.totalBudget ?? value?.[1] ?? 0),
    ticketWei: BigInt(value?.ticketWei ?? value?.[2] ?? 0),
    ethCashWei: BigInt(value?.ethCashWei ?? value?.[3] ?? 0),
    flipTokens: BigInt(value?.flipTokens ?? value?.[4] ?? 0),
  };
}

function _salvageError(error, fallback = 'Salvage is unavailable right now.') {
  const name = error?.revert?.name || error?.errorName || null;
  const local = {
    InvalidDistance: {
      code: 'InvalidDistance',
      userMessage: 'Only tickets 6–100 levels ahead can be salvaged.',
    },
    InvalidQuantity: {
      code: 'InvalidQuantity',
      userMessage: 'Salvage quantities must be whole tickets.',
    },
    RngLocked: {
      code: 'RngLocked',
      userMessage: 'Salvage pauses while RNG is locked.',
    },
    NotApproved: {
      code: 'NotApproved',
      userMessage: 'This wallet is not approved to act for that player.',
    },
    E: {
      code: 'E',
      userMessage: 'The salvage offer changed or no buyer can fund it. Refresh and try again.',
    },
  }[name];
  const decoded = local || decodeRevertReason(error);
  const wrapped = new Error(decoded.userMessage || fallback);
  wrapped.code = decoded.code;
  wrapped.userMessage = decoded.userMessage || fallback;
  wrapped.recoveryAction = decoded.recoveryAction;
  wrapped.cause = error;
  return wrapped;
}

/** Exact contract quote for a bundle. Does not check ownership. */
export async function previewFarFutureSalvage({ player, levels, quantities } = {}) {
  if (!player) throw new Error('Pick a player first.');
  const lines = _normalizeLines(levels, quantities);
  const contract = _buildContract(_readRunner());
  try {
    const value = typeof contract?.previewSellFarFutureEntries?.staticCall === 'function'
      ? await contract.previewSellFarFutureEntries.staticCall(player, lines.levels, lines.quantities)
      : await contract.previewSellFarFutureEntries(player, lines.levels, lines.quantities);
    return _quoteTuple(value);
  } catch (error) {
    throw _salvageError(error, 'Could not load the salvage offer.');
  }
}

/** Sell the selected far-future whole tickets in one atomic transaction. */
export async function sellFarFutureSalvage({ player, levels, quantities, queueIndices } = {}) {
  const target = player || getActingAddress();
  if (!target) throw new Error('Connect a wallet first.');
  const lines = _normalizeLines(levels, quantities, queueIndices);

  const provider = getProvider();
  const signer = provider ? await provider.getSigner() : null;
  if (signer) {
    const sim = await requireStaticCall(
      _buildContract(signer),
      'sellFarFutureEntries',
      [target, lines.levels, lines.quantities, lines.queueIndices],
      signer,
    );
    if (!sim.ok) throw _salvageError(sim.error);
  }

  try {
    const receipt = await sendTx(
      (freshSigner) => _buildContract(freshSigner).sellFarFutureEntries(
        target,
        lines.levels,
        lines.quantities,
        lines.queueIndices,
      ),
      'Salvage far-future tickets',
    );
    return { receipt };
  } catch (error) {
    if (error?.revert?.name || error?.errorName) throw _salvageError(error);
    throw error;
  }
}
