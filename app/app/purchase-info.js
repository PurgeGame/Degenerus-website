// Shared, block-pinned GAME.purchaseInfo() broker.
//
// Purchase state is consumed by the buy panel, pass desk, Decimator, Growth
// book, and daily-flip rails. Those surfaces poll on independent cadences; a
// module-local in-flight promise only coalesces callers that happen to land in
// the same tick. This broker gives all of them one short-lived snapshot while
// retaining a `fresh` mode for transaction preparation.

import { ethers, getProvider } from './contracts.js';
import { CHAIN, CONTRACTS } from './chain-config.js';
import {
  permissionlessReadProvider,
  readProviderBlockNumber,
  registerReadCacheInvalidator,
} from './read-provider.js';

const PURCHASE_INFO_ABI = [
  'function purchaseInfo() external view returns (uint24 lvl, bool inJackpotPhase, bool lastPurchaseDay_, bool rngLocked_, uint256 priceWei)',
];

export const PURCHASE_INFO_TTL_MS = 4_000;
const MAX_BLOCK_SNAPSHOTS = 32;

let _contractFactory = null;
let _recent = null;
const _byBlock = new Map();
const _inflight = new Map();

function _clear() {
  _recent = null;
  _byBlock.clear();
  _inflight.clear();
}

registerReadCacheInvalidator(_clear);

/** Test seam for the one read-only GAME view. */
export function __setPurchaseInfoContractFactoryForTest(factory) {
  _contractFactory = typeof factory === 'function' ? factory : null;
  _clear();
}

export function __resetPurchaseInfoForTest() {
  _contractFactory = null;
  _clear();
}

function _contract(provider) {
  if (_contractFactory) return _contractFactory(provider);
  return new ethers.Contract(CONTRACTS.GAME, PURCHASE_INFO_ABI, provider);
}

/** Normalize ethers Result objects and tuple-shaped test doubles once. */
export function normalizePurchaseInfo(raw, blockNumber = null) {
  if (!raw) return null;
  const currentLevel = Number(raw?.currentLevel ?? raw?.lvl ?? raw?.[0]);
  let priceWei;
  try { priceWei = BigInt(raw?.priceWei ?? raw?.[4] ?? 0); }
  catch (_e) { return null; }
  if (!Number.isInteger(currentLevel) || currentLevel < 0) return null;
  return Object.freeze({
    currentLevel,
    inJackpotPhase: Boolean(raw?.inJackpotPhase ?? raw?.[1]),
    lastPurchaseDay: Boolean(
      raw?.lastPurchaseDay ?? raw?.lastPurchaseDay_ ?? raw?.[2],
    ),
    rngLocked: Boolean(raw?.rngLocked ?? raw?.rngLocked_ ?? raw?.[3]),
    priceWei,
    blockNumber: Number.isSafeInteger(Number(blockNumber)) ? Number(blockNumber) : null,
  });
}

function _rememberBlock(blockNumber, value) {
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) return;
  _byBlock.delete(blockNumber);
  _byBlock.set(blockNumber, value);
  while (_byBlock.size > MAX_BLOCK_SNAPSHOTS) {
    const oldest = _byBlock.keys().next().value;
    if (oldest === undefined) break;
    _byBlock.delete(oldest);
  }
}

async function _readAt(provider, blockNumber) {
  const key = blockNumber == null ? 'latest' : `block:${blockNumber}`;
  if (blockNumber != null && _byBlock.has(blockNumber)) return _byBlock.get(blockNumber);
  if (_inflight.has(key)) return _inflight.get(key);

  const request = (async () => {
    const contract = _contract(provider);
    if (typeof contract?.purchaseInfo !== 'function') return null;
    const raw = blockNumber == null
      ? await contract.purchaseInfo()
      : await contract.purchaseInfo({ blockTag: blockNumber });
    const value = normalizePurchaseInfo(raw, blockNumber);
    if (value && blockNumber != null) _rememberBlock(blockNumber, value);
    return value;
  })().finally(() => {
    if (_inflight.get(key) === request) _inflight.delete(key);
  });
  _inflight.set(key, request);
  return request;
}

/**
 * Read the routed purchase level/price once for every app surface.
 *
 * `fresh:true` bypasses the four-second display window, but it can still reuse
 * an immutable snapshot for the current block. Thus two buttons preparing in
 * the same block never pay for the same view twice and never accept state from
 * an older block.
 */
export async function readPurchaseInfo({
  fresh = false,
  provider = null,
  blockTag = null,
} = {}) {
  if (!CONTRACTS.GAME) return null;
  const reader = provider || permissionlessReadProvider(getProvider());
  if (!reader) return null;

  if (!fresh && blockTag == null && _recent
    && Date.now() - _recent.readAt <= PURCHASE_INFO_TTL_MS) {
    return _recent.value;
  }

  let blockNumber = blockTag == null ? null : Number(blockTag);
  if (blockTag == null) {
    try {
      blockNumber = await readProviderBlockNumber(reader, {
        maxAgeMs: fresh ? 0 : 500,
      });
    } catch (_e) {
      blockNumber = null;
    }
  }

  try {
    const value = await _readAt(
      reader,
      Number.isSafeInteger(blockNumber) && blockNumber >= 0 ? blockNumber : null,
    );
    if (value && blockTag == null) _recent = { value, readAt: Date.now() };
    return value;
  } catch (_e) {
    return null;
  }
}

