// Lazy, player-scoped game activity history. The indexer does not expose one
// catch-all ledger yet, so this table composes its existing authoritative
// purchase, result, ticket, jackpot, and Degenerette projections. Nothing is
// requested until the player opens the <details> surface.

import { fetchJSON } from '../app/api.js';
import { CHAIN, CONTRACTS, VOLUME_WINDOW } from '../app/chain-config.js';
import { ethers, getProvider } from '../app/contracts.js';
import { sharedReadProvider } from '../app/read-provider.js';
import { dgnPartitionTicketEntries } from '../app/dgn-traits.js';
import { displayEth, displayToken } from '../app/scaling.js';
import { getViewedAddress, subscribe } from '../app/store.js';
import { applyTicketLevelTone } from '../app/ticket-level-tone.js';
import { historicalLootboxReplayRows } from '../app/day-lootbox-results.js';
import { compactUiError } from '../app/ui-error.js';
import {
  dgnDecodePacked,
  degeneretteReplaySequences,
  degeneretteRevealSequenceFromFeedItem,
  mergeDegeneretteFeedItems,
} from './app-degenerette-panel.js';
import { queueReveal, projectDegeneretteEthSplit } from './reveal-overlay.js';

const DEFAULT_LIMIT = 10;
const LIMITS = new Set([10, 25, 50, 100]);
const ORD_SCALE = 1_000_000n;
const JACKPOT_BLOCK_LOOKUPS = 6;
const SOURCE_PAGE_CAP = 200;
const RPC_BATCH_SIZE = 50;
const AFKING_LOG_CHUNK_BLOCKS = 1_800;
const HISTORY_TICKETS_PER_PACK = 10;
const TOKEN_UNIT = 10n ** 18n;
const ASSET_ORDER = Object.freeze([
  'ETH', 'FLIP', 'DGNRS', 'SDGNRS', 'WWXRP', 'TICKETS', 'LOOTBOX', 'PASS', 'HALF-PASS', 'BOON',
]);
const COIN_ASSETS = new Set(['FLIP', 'DGNRS', 'SDGNRS', 'WWXRP']);
const ITEM_ASSETS = new Set(['TICKETS', 'LOOTBOX', 'PASS', 'HALF-PASS', 'BOON']);
const ACTIVITY_MARKS = Object.freeze({
  'lootbox-purchase': '◇',
  'lootbox-result': '◆',
  tickets: '▦',
  jackpot: '✦',
  'degenerette-wager': 'D',
  'degenerette-result': 'D',
  'afking-purchase': 'A',
  'pass-purchase': 'P',
});
const HISTORY_FILTERS = Object.freeze([
  ['buys', 'BUYS'],
  ['jackpots', 'JACKPOTS'],
  ['pack-opens', 'PACK OPENS'],
  ['lootboxes', 'LUCKBOX'],
  ['degenerette', 'DEGENERETTE'],
]);
const HISTORY_FILTER_KEYS = Object.freeze(HISTORY_FILTERS.map(([key]) => key));

export function transactionHistoryCategory(row) {
  const type = String(row?.type || '').toLowerCase();
  if (type.startsWith('degenerette')) return 'degenerette';
  if (type === 'jackpot' || type.includes('jackpot')) return 'jackpots';
  if (type === 'tickets' || type.includes('pack-open') || type.includes('ticket-reveal')) {
    return 'pack-opens';
  }
  if (type === 'lootbox-result' || type.includes('lootbox-open')) return 'lootboxes';
  // Purchase rows—including lootbox and recurring AFKing orders—belong to
  // BUYS. Exclusive row categories keep the one-button focus behavior honest.
  return 'buys';
}

const AFKING_HISTORY_ABI = Object.freeze([
  'event SubscriptionUpdated(address indexed player,uint8 dailyQuantity,bool drainGameCreditFirst,bool useTickets,address indexed fundingSource)',
  'event AfkingDelivered(address indexed player,uint24 day,uint256 weiIn,uint24 pendingFlipAfter,uint32 affiliateBaseAfter)',
  'event LootBoxBuy(address indexed buyer,uint48 indexed index,uint256 amount)',
  'event WhalePassPurchased(address indexed buyer,uint256 quantity,uint256 weiIn)',
  'event LazyPassPurchased(address indexed buyer,uint24 startLevel,uint256 weiIn)',
  'event DeityPassPurchased(address indexed buyer,uint8 symbolId,uint256 price,uint24 level)',
]);

function _lower(value) {
  return String(value || '').toLowerCase();
}

function _big(value) {
  try { return BigInt(value ?? 0); }
  catch (_e) { return 0n; }
}

function _number(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function _block(value) {
  const block = _big(value);
  return block > 0n ? block : null;
}

function _chronology(blockNumber, logIndex = 0) {
  const block = _block(blockNumber);
  if (block == null) return null;
  return block * ORD_SCALE + BigInt(Math.max(0, Math.trunc(Number(logIndex) || 0)));
}

function _historyReadProvider() {
  const connected = getProvider();
  if (connected && typeof connected.getLogs === 'function') return connected;
  // getLogs passes straight through the shared provider (the read cache only
  // wraps .call), so history fetches stay live while joining its batches.
  return sharedReadProvider();
}

function _eventItem(log, parsed) {
  const eventName = String(parsed?.name || parsed?.fragment?.name || '');
  const args = parsed?.args || [];
  const inputNames = Array.from(parsed?.fragment?.inputs || []).map((input) => input.name);
  const values = Object.fromEntries(inputNames.map((name, index) => [name, args[index]]));
  const item = {
    eventName,
    blockNumber: String(log?.blockNumber ?? ''),
    logIndex: Number(log?.index ?? log?.logIndex ?? 0),
    transactionHash: String(log?.transactionHash || '').toLowerCase(),
    player: String(values.player ?? values.buyer ?? '').toLowerCase(),
  };
  if (eventName === 'SubscriptionUpdated') {
    item.dailyQuantity = Number(values.dailyQuantity ?? 0);
    item.useTickets = Boolean(values.useTickets);
  } else if (eventName === 'AfkingDelivered') {
    item.day = Number(values.day ?? 0);
    item.weiIn = String(values.weiIn ?? 0);
  } else if (eventName === 'LootBoxBuy') {
    item.amount = String(values.amount ?? 0);
  } else if (eventName === 'WhalePassPurchased') {
    item.quantity = Number(values.quantity ?? 0);
    item.weiIn = String(values.weiIn ?? 0);
  } else if (eventName === 'LazyPassPurchased') {
    item.startLevel = Number(values.startLevel ?? 0);
    item.weiIn = String(values.weiIn ?? 0);
  } else if (eventName === 'DeityPassPurchased') {
    item.symbolId = Number(values.symbolId ?? 0);
    item.price = String(values.price ?? 0);
    item.level = Number(values.level ?? 0);
  }
  return item;
}

/** Lazy chain-backed AFKing + pass purchase stream; called only after history opens. */
export async function loadAfkingPurchaseHistory(address, { provider = null } = {}) {
  const owner = _lower(address);
  const reader = provider || _historyReadProvider();
  if (!/^0x[0-9a-f]{40}$/.test(owner)
    || !reader
    || typeof reader.getBlockNumber !== 'function'
    || typeof reader.getLogs !== 'function'
    || !CONTRACTS?.GAME) return { items: [] };

  const iface = new ethers.Interface(AFKING_HISTORY_ABI);
  const eventTopics = [
    'SubscriptionUpdated', 'AfkingDelivered', 'LootBoxBuy',
    'WhalePassPurchased', 'LazyPassPurchased', 'DeityPassPurchased',
  ]
    .map((name) => iface.getEvent(name)?.topicHash)
    .filter(Boolean);
  const playerTopic = ethers.zeroPadValue(owner, 32);
  const head = Number(await reader.getBlockNumber());
  const deployBlock = Math.max(0, Number(CHAIN?.deployBlock) || 0);
  if (!Number.isInteger(head) || head < deployBlock) return { items: [] };

  const items = [];
  for (let fromBlock = deployBlock; fromBlock <= head; fromBlock += AFKING_LOG_CHUNK_BLOCKS) {
    const toBlock = Math.min(head, fromBlock + AFKING_LOG_CHUNK_BLOCKS - 1);
    const logs = await reader.getLogs({
      address: CONTRACTS.GAME,
      topics: [eventTopics, playerTopic],
      fromBlock,
      toBlock,
    });
    for (const log of Array.isArray(logs) ? logs : []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed) items.push(_eventItem(log, parsed));
      } catch (_e) { /* one malformed log does not blank the rest of history */ }
    }
  }
  items.sort((a, b) => (
    Number(a.blockNumber || 0) - Number(b.blockNumber || 0)
    || Number(a.logIndex || 0) - Number(b.logIndex || 0)
  ));
  return { items };
}

export function gameDayForHistoryTimestamp(timestampMs) {
  const milliseconds = Number(timestampMs);
  const anchor = Number(VOLUME_WINDOW?.anchor);
  const period = Number(VOLUME_WINDOW?.period);
  if (VOLUME_WINDOW?.deployDayBoundary == null) return null;
  const deployDayBoundary = Number(VOLUME_WINDOW?.deployDayBoundary);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0
    || !Number.isFinite(anchor) || !Number.isFinite(period) || period <= 0
    || !Number.isFinite(deployDayBoundary)) return null;
  const boundary = Math.floor(((milliseconds / 1000) - anchor) / period);
  const day = boundary - deployDayBoundary + 1;
  return Number.isInteger(day) && day > 0 ? day : null;
}

export function formatHistoryTimestamp(timestampMs) {
  const milliseconds = Number(timestampMs);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(milliseconds));
  } catch (_e) {
    return new Date(milliseconds).toISOString().replace('T', ' ').slice(0, 16);
  }
}

function _assetGroup(asset) {
  if (asset === 'ETH') return 'eth';
  if (COIN_ASSETS.has(asset)) return 'coins';
  if (ITEM_ASSETS.has(asset)) return 'items';
  return 'items';
}

function _displayAsset(asset) {
  return asset === 'LOOTBOX' ? 'LUCKBOX' : asset;
}

/**
 * Label for a delta chip. A LUCKBOX carries an ETH balance rather than a bare
 * count, so its amount is denominated to keep it from reading as a quantity.
 */
function _deltaAssetLabel(delta) {
  if (delta?.asset === 'TICKETS' && _ticketLevel(delta?.level) != null) {
    return `L${_ticketLevel(delta.level)} TICKETS`;
  }
  if (delta?.asset === 'LOOTBOX' && delta?.kind === 'eth') return 'ETH LUCKBOX';
  return _displayAsset(delta?.asset);
}

function _deltaMap() {
  return new Map();
}

function _ticketLevel(value) {
  if (value == null || value === '') return null;
  const level = Number(value);
  return Number.isInteger(level) && level >= 0 ? level : null;
}

function _addRaw(map, asset, value, kind = 'token') {
  const amount = _big(value);
  if (amount === 0n) return;
  const key = `${kind}:${asset}`;
  const current = map.get(key);
  map.set(key, {
    asset,
    kind,
    value: (current?.value ?? 0n) + amount,
  });
}

function _addCount(map, asset, value, { level = null } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return;
  const ticketLevel = asset === 'TICKETS' ? _ticketLevel(level) : null;
  const key = `count:${asset}${ticketLevel == null ? '' : `:L${ticketLevel}`}`;
  const current = map.get(key);
  map.set(key, {
    asset,
    kind: 'count',
    value: (current?.value ?? 0) + amount,
    ...(ticketLevel == null ? {} : { level: ticketLevel }),
  });
}

function _deltas(map) {
  const order = new Map(ASSET_ORDER.map((asset, index) => [asset, index]));
  return [...map.values()]
    .filter((delta) => delta.kind === 'count' ? delta.value !== 0 : delta.value !== 0n)
    .sort((a, b) => (
      (order.get(a.asset) ?? 999) - (order.get(b.asset) ?? 999)
      || (_ticketLevel(a.level) ?? Number.MAX_SAFE_INTEGER)
        - (_ticketLevel(b.level) ?? Number.MAX_SAFE_INTEGER)
    ));
}

function _trimFixed(value) {
  return String(value).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function _groupFixed(value) {
  const [whole = '0', fraction] = String(value).split('.');
  let grouped = whole;
  try { grouped = BigInt(whole || 0).toLocaleString('en-US'); } catch (_e) { /* retain input */ }
  return fraction == null || fraction === '' ? grouped : `${grouped}.${fraction}`;
}

function _compactCoinAmount(magnitude) {
  for (const [unitCount, suffix] of [
    [1_000_000_000_000n, 'T'],
    [1_000_000_000n, 'B'],
    [1_000_000n, 'M'],
    [1_000n, 'K'],
  ]) {
    const threshold = unitCount * TOKEN_UNIT;
    if (magnitude < threshold) continue;
    const tenths = (magnitude * 10n) / threshold;
    return `${(tenths / 10n).toLocaleString('en-US')}.${tenths % 10n}${suffix}`;
  }
  const ordinary = _trimFixed(displayToken(magnitude, 1));
  return ordinary === '0' && magnitude > 0n ? '<0.1' : _groupFixed(ordinary);
}

function _historyDeltaParts(delta, { exact = false } = {}) {
  const isCount = delta?.kind === 'count';
  const negative = isCount ? Number(delta?.value) < 0 : _big(delta?.value) < 0n;
  const magnitude = isCount
    ? Math.abs(Number(delta?.value))
    : (_big(delta?.value) < 0n ? -_big(delta?.value) : _big(delta?.value));
  let amount;
  if (isCount) {
    amount = magnitude.toLocaleString('en-US', { maximumFractionDigits: 2 });
  } else if (delta.kind === 'eth') {
    const shown = displayEth(magnitude, exact ? 6 : 2);
    amount = !exact && shown === '0.00' && magnitude > 0n
      ? '<0.01'
      : _groupFixed(exact ? _trimFixed(shown) : shown);
  } else {
    amount = exact
      ? _groupFixed(_trimFixed(displayToken(magnitude, 6)))
      : _compactCoinAmount(magnitude);
  }
  return { negative, amount };
}

export function formatHistoryDelta(delta) {
  if (!delta) return '';
  const { negative, amount } = _historyDeltaParts(delta);
  return `${negative ? '−' : '+'}${amount} ${_deltaAssetLabel(delta)}`;
}

function _formatHistoryDeltaExact(delta) {
  const { negative, amount } = _historyDeltaParts(delta, { exact: true });
  return `${negative ? '−' : '+'}${amount} ${_deltaAssetLabel(delta)}`;
}

/** Exact wallet deltas proven by normalized lootbox settlement legs. */
export function historyDeltasForLootboxLegs(legs, { consumeBox = true } = {}) {
  const map = _deltaMap();
  if (consumeBox) _addCount(map, 'LOOTBOX', -1);
  for (const leg of Array.isArray(legs) ? legs : []) {
    if (leg?.legType === 'opened') {
      _addCount(map, 'TICKETS', Number(leg.wholeTickets) || 0, { level: leg.futureLevel });
      _addRaw(map, 'FLIP', leg.flip, 'token');
    } else if (leg?.legType === 'dgnrs') {
      _addRaw(map, 'DGNRS', leg.amount, 'token');
    } else if (leg?.legType === 'wwxrp') {
      _addRaw(map, 'WWXRP', leg.amount, 'token');
    } else if (leg?.legType === 'whalepass') {
      _addCount(map, 'PASS', 1);
    } else if (leg?.legType === 'reward') {
      _addCount(map, 'BOON', 1);
    } else if (leg?.legType === 'spin') {
      const spinType = String(leg.spinType || '').toLowerCase();
      if (spinType === 'eth') _addRaw(map, 'ETH', leg.ethShare, 'eth');
      if (spinType === 'flip') _addRaw(map, 'FLIP', leg.payout, 'token');
      if (spinType === 'wwxrp') _addRaw(map, 'WWXRP', leg.payout, 'token');
    }
  }
  return _deltas(map);
}

function _historyRow({
  id,
  type,
  title,
  detail = '',
  blockNumber = null,
  logIndex = 0,
  day = null,
  timestampMs = null,
  transactionHash = null,
  deltas = [],
  sequence = null,
  replaySequences = null,
} = {}) {
  return {
    id: String(id || `${type}:${blockNumber ?? day ?? title}`),
    type: String(type || 'activity'),
    title: String(title || 'Game activity'),
    detail: String(detail || ''),
    blockNumber: _block(blockNumber),
    logIndex: Math.max(0, Math.trunc(Number(logIndex) || 0)),
    chronology: _chronology(blockNumber, logIndex),
    day: Number.isInteger(Number(day)) && Number(day) > 0 ? Number(day) : null,
    timestampMs: Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0
      ? Number(timestampMs) : null,
    transactionHash: /^0x[0-9a-f]{64}$/i.test(String(transactionHash || ''))
      ? String(transactionHash).toLowerCase() : null,
    deltas: Array.isArray(deltas) ? deltas : [],
    sequence,
    replaySequences: Array.isArray(replaySequences) ? replaySequences : null,
  };
}

function _afkingPurchaseRows(history, owner) {
  const items = (Array.isArray(history?.items) ? history.items : [])
    .filter((item) => !owner || _lower(item?.player ?? item?.buyer) === owner)
    .sort((a, b) => (
      Number(a?.blockNumber || 0) - Number(b?.blockNumber || 0)
      || Number(a?.logIndex || 0) - Number(b?.logIndex || 0)
    ));
  const lootboxCosts = new Map();
  for (const item of items) {
    if (String(item?.eventName || '') !== 'LootBoxBuy') continue;
    const transactionHash = _lower(item?.transactionHash);
    if (transactionHash) lootboxCosts.set(transactionHash, _big(item?.amount));
  }

  let dailyQuantity = null;
  let useTickets = null;
  const rows = [];
  for (const item of items) {
    const eventName = String(item?.eventName || '');
    if (eventName === 'SubscriptionUpdated') {
      dailyQuantity = Math.max(0, Math.trunc(Number(item?.dailyQuantity) || 0));
      useTickets = item?.useTickets === true || String(item?.useTickets).toLowerCase() === 'true';
      continue;
    }
    if (eventName !== 'AfkingDelivered') continue;

    const quantity = Math.max(1, dailyQuantity || 1);
    const transactionHash = _lower(item?.transactionHash);
    let cost = _big(item?.weiIn);
    if (cost <= 0n && transactionHash) cost = lootboxCosts.get(transactionHash) ?? 0n;
    const map = _deltaMap();
    _addRaw(map, 'ETH', -cost, 'eth');
    if (useTickets === true) _addCount(map, 'TICKETS', quantity);

    const product = useTickets === true ? 'ticket' : useTickets === false ? 'Luckbox' : '';
    const unit = product || 'order';
    rows.push(_historyRow({
      id: `afking-purchase:${transactionHash || `${item?.blockNumber}:${item?.logIndex}`}`,
      type: 'afking-purchase',
      title: product ? `AFKing ${product} purchase` : 'AFKing purchase',
      detail: `Day ${Number(item?.day) || '—'} · ${quantity} ${unit}${quantity === 1 || product === 'Luckbox' ? '' : 's'}`,
      blockNumber: item?.blockNumber,
      logIndex: item?.logIndex,
      day: item?.day,
      transactionHash: item?.transactionHash,
      deltas: _deltas(map),
    }));
  }
  return rows;
}

function _passPurchaseRows(history, owner) {
  const items = (Array.isArray(history?.items) ? history.items : [])
    .filter((item) => !owner || _lower(item?.player ?? item?.buyer) === owner);
  const bonusBoxTransactions = new Set(items
    .filter((item) => String(item?.eventName || '') === 'LootBoxBuy')
    .map((item) => _lower(item?.transactionHash))
    .filter(Boolean));
  const transactions = new Set();
  const rows = [];
  for (const item of items) {
    const eventName = String(item?.eventName || '');
    if (!['WhalePassPurchased', 'LazyPassPurchased', 'DeityPassPurchased'].includes(eventName)) {
      continue;
    }
    const transactionHash = _lower(item?.transactionHash);
    if (transactionHash) transactions.add(transactionHash);
    const map = _deltaMap();
    let title;
    let detail;
    if (eventName === 'WhalePassPurchased') {
      const quantity = Math.max(1, Math.trunc(Number(item?.quantity) || 1));
      title = 'Whale pass purchase';
      detail = `${quantity} whale pass${quantity === 1 ? '' : 'es'}`;
      _addRaw(map, 'ETH', -_big(item?.weiIn), 'eth');
      _addCount(map, 'PASS', quantity);
    } else if (eventName === 'LazyPassPurchased') {
      const startLevel = Math.max(0, Math.trunc(Number(item?.startLevel) || 0));
      title = 'Lazy pass purchase';
      detail = startLevel > 0 ? `Levels ${startLevel}–${startLevel + 9}` : '10-level pass';
      _addRaw(map, 'ETH', -_big(item?.weiIn), 'eth');
      _addCount(map, 'PASS', 1);
    } else {
      const symbolId = Math.max(0, Math.trunc(Number(item?.symbolId) || 0));
      const level = Math.max(0, Math.trunc(Number(item?.level) || 0));
      title = 'Deity pass purchase';
      detail = `Symbol ${symbolId}${level > 0 ? ` · Level ${level}` : ''}`;
      _addRaw(map, 'ETH', -_big(item?.price), 'eth');
      _addCount(map, 'PASS', 1);
    }
    if (transactionHash && bonusBoxTransactions.has(transactionHash)) {
      _addCount(map, 'LOOTBOX', 1);
    }
    rows.push(_historyRow({
      id: `pass-purchase:${transactionHash || `${item?.blockNumber}:${item?.logIndex}`}`,
      type: 'pass-purchase',
      title,
      detail,
      blockNumber: item?.blockNumber,
      logIndex: item?.logIndex,
      transactionHash: item?.transactionHash,
      deltas: _deltas(map),
    }));
  }
  return { rows, transactions };
}

function _lootboxPurchaseRows(feed, owner, excludedTransactions = new Set()) {
  return (Array.isArray(feed?.items) ? feed.items : [])
    .filter((item) => !owner || _lower(item?.player) === owner)
    .filter((item) => !excludedTransactions.has(_lower(item?.transactionHash)))
    .map((item) => {
      const map = _deltaMap();
      const asset = String(item?.kind).toLowerCase() === 'flip' ? 'FLIP' : 'ETH';
      // What the box holds, not what the buy cost. A consumed purchase boost
      // credits the box above the paid amount, and LootBoxBuy emits only the
      // pre-boost figure — boxAmountRawWei is the feed's boost-inclusive value.
      // Without it (a FLIP-paid box) fall back to the bare count.
      const boxAmount = _big(item?.boxAmountRawWei);
      if (item?.boxAmountRawWei != null && boxAmount > 0n) {
        _addRaw(map, 'LOOTBOX', boxAmount, 'eth');
      } else {
        _addCount(map, 'LOOTBOX', 1);
      }
      _addRaw(map, asset, -_big(item?.costRawWei), asset === 'ETH' ? 'eth' : 'token');
      const boostBps = Math.max(0, Math.trunc(Number(item?.boostBps) || 0));
      return _historyRow({
        id: `lootbox-buy:${item?.transactionHash || item?.id}`,
        type: 'lootbox-purchase',
        title: 'Luckbox purchase',
        detail: boostBps > 0
          ? `Paid with ${asset} · +${_trimFixed((boostBps / 100).toFixed(1))}% boon`
          : `Paid with ${asset}`,
        blockNumber: item?.blockNumber,
        logIndex: item?.logIndex,
        transactionHash: item?.transactionHash,
        deltas: _deltas(map),
      });
    });
}

function _degeneretteRows(feed, owner) {
  const rows = [];
  const merged = mergeDegeneretteFeedItems(Array.isArray(feed?.items) ? feed.items : [])
    .filter((item) => !owner || _lower(item?.player) === owner);
  const excludedLootboxTransactions = new Set();
  for (const item of merged) {
    const packed = dgnDecodePacked(item?.packedData);
    if (!packed) continue;
    const asset = packed.currency === 0 ? 'ETH' : packed.currency === 3 ? 'WWXRP' : 'FLIP';
    const wagerMap = _deltaMap();
    const spinCount = Math.max(1, Number(packed.spinCount) || 1);
    _addRaw(
      wagerMap,
      asset,
      -(packed.amountPerSpin * BigInt(spinCount)),
      asset === 'ETH' ? 'eth' : 'token',
    );
    rows.push(_historyRow({
      id: `degenerette-wager:${item?.player}:${item?.betId}`,
      type: 'degenerette-wager',
      title: 'Degenerette wager',
      detail: `Bet #${String(item?.betId ?? '—')} · ${spinCount} spin${spinCount === 1 ? '' : 's'}`,
      blockNumber: item?.blockNumber,
      logIndex: item?.logIndex,
      transactionHash: item?.transactionHash,
      deltas: _deltas(wagerMap),
    }));

    const resolved = (Array.isArray(item?.results) ? item.results : [])
      .find((result) => result?.resultType === 'resolved');
    if (!resolved) continue;
    const sequence = degeneretteRevealSequenceFromFeedItem(item);
    const payoutMap = _deltaMap();
    const gross = sequence?.totalPayout ?? resolved?.resultData?.totalPayout ?? resolved?.payout ?? 0;
    if (asset === 'ETH') {
      // NOT sequence.lootboxEth. That is the LootBoxOpened amount, which is
      // wrong twice over for this: it is suppressed entirely when a box rolls
      // as a Degenerette spin (BoxSpin is emitted instead), and when it is
      // present it carries the post-EV value rather than the share actually
      // deducted from the payout. Subtracting it credited the FULL gross as
      // liquid ETH on every box-spin bet and understated it by the player's
      // activity-score bonus on the rest. The contract's 3-tier rule gives the
      // real claimable lane. See projectDegeneretteEthSplit.
      const spins = Array.isArray(sequence?.spins) ? sequence.spins : [];
      const perSpin = _big(sequence?.amountPerSpin ?? 0) > 0n
        ? _big(sequence.amountPerSpin)
        : (spins.length > 0 ? _big(sequence?.totalWager ?? 0) / BigInt(spins.length) : 0n);
      const { actual: liquid } = projectDegeneretteEthSplit({
        gross: _big(gross),
        rows: spins,
        amountPerSpin: perSpin,
      });
      _addRaw(payoutMap, 'ETH', liquid, 'eth');
    } else {
      _addRaw(payoutMap, asset, gross, 'token');
    }
    for (const delta of historyDeltasForLootboxLegs(sequence?.lootboxLegs, { consumeBox: false })) {
      if (delta.kind === 'count') {
        _addCount(payoutMap, delta.asset, delta.value, { level: delta.level });
      }
      else _addRaw(payoutMap, delta.asset, delta.value, delta.kind);
    }
    // DegeneretteResolved.totalPayout is emitted before the record bounty's
    // independent FLIP spin chain. BoxSpin.payout is therefore an additional
    // mint, not part of the base gross and not a Luckbox leg.
    for (const spin of Array.isArray(sequence?.recordBountySpins)
      ? sequence.recordBountySpins : []) {
      _addRaw(payoutMap, 'FLIP', spin?.payout, 'token');
    }
    for (const payout of Array.isArray(item?.lootboxPayouts) ? item.lootboxPayouts : []) {
      const hash = String(payout?.transactionHash || '').toLowerCase();
      if (hash) excludedLootboxTransactions.add(hash);
    }
    rows.push(_historyRow({
      id: `degenerette-result:${item?.player}:${item?.betId}`,
      type: 'degenerette-result',
      title: 'Degenerette result',
      detail: `Bet #${String(item?.betId ?? '—')} · settled`,
      blockNumber: resolved?.blockNumber,
      logIndex: resolved?.logIndex,
      transactionHash: resolved?.transactionHash,
      deltas: _deltas(payoutMap),
      sequence,
    }));
  }
  return { rows, excludedLootboxTransactions };
}

function _lootboxResultRows(legsFeed, owner, excludedTransactions = new Set()) {
  const items = Array.isArray(legsFeed?.items) ? legsFeed.items : [];
  if (!owner || items.length === 0) return [];
  return historicalLootboxReplayRows(items, {
    player: owner,
    day: 'history',
    startBlock: 0,
    excludedTransactions,
  }).map((result) => {
    const sequence = { ...result.sequence, title: 'LUCKBOX RESULT' };
    const autoOpen = Number(result?.lootboxIndex ?? 0) === 0;
    const anchor = items.find((item) => (
      _lower(item?.transactionHash) === _lower(result.transactionHash)
      && ['opened', 'flipOpened', 'presale'].includes(String(item?.legType || ''))
    ));
    return _historyRow({
      id: `lootbox-result:${result.transactionHash || result.id}`,
      type: 'lootbox-result',
      title: 'Luckbox opened',
      detail: autoOpen
        ? 'Automatic settlement'
        : `Luckbox #${String(result?.lootboxIndex ?? '—')}`,
      blockNumber: sequence?.legs?.[0]?.blockNumber
        ?? anchor?.blockNumber
        ?? items.find((item) => _lower(item?.transactionHash) === _lower(result.transactionHash))?.blockNumber,
      logIndex: anchor?.logIndex,
      transactionHash: result.transactionHash,
      // The purchase row already records the box entering the wallet. The
      // result row is a reward receipt, not an inventory-consumption ledger.
      deltas: historyDeltasForLootboxLegs(sequence.legs, { consumeBox: false }),
      sequence,
    });
  });
}

function _ticketPackLevel(pack) {
  const candidates = [
    pack?.ticketLevel,
    pack?.futureLevel,
    pack?.purchaseLevel,
    pack?.level,
    pack?.levelAtOpen,
    ...(Array.isArray(pack?.tickets)
      ? pack.tickets.flatMap((ticket) => [
          ticket?.ticketLevel,
          ticket?.futureLevel,
          ticket?.purchaseLevel,
          ticket?.level,
        ])
      : []),
  ];
  for (const candidate of candidates) {
    const level = _ticketLevel(candidate);
    if (level != null) return level;
  }
  return null;
}

function _ticketPieces(packs) {
  const cards = [];
  let entryId = 0;
  for (const pack of Array.isArray(packs) ? packs : []) {
    for (const ticket of Array.isArray(pack?.tickets) ? pack.tickets : []) {
      const traits = (Array.isArray(ticket?.traits) ? ticket.traits : [])
        .map(Number)
        .filter((trait) => Number.isInteger(trait) && trait >= 0 && trait <= 255);
      if (traits.length === 0) continue;
      cards.push({
        cardIndex: cards.length,
        status: 'opened',
        entries: traits.map((traitId) => ({ entryId: entryId++, traitId })),
      });
    }
  }
  // The all-time packs projection may cut a legitimate fractional receipt at
  // an arbitrary four-entry boundary. Repartition by the encoded Q0..Q3 bits
  // so only four distinct quadrants become a ticket; every remainder keeps its
  // honest quarter-ticket graphic.
  const partitioned = dgnPartitionTicketEntries(cards);
  const tickets = partitioned.tickets.map((ticket) => ({ traitIds: ticket.traitIds }));
  const entries = partitioned.entries.map((entry) => ({ traitId: entry.traitId }));
  const provenEntries = (tickets.length * 4) + entries.length;
  const projectedEntries = (Array.isArray(packs) ? packs : []).reduce(
    (sum, pack) => sum + (Math.max(0, Number(pack?.ticketCount) || 0) * 4),
    0,
  );
  return {
    tickets,
    entries,
    count: (provenEntries > 0 ? provenEntries : projectedEntries) / 4,
  };
}

function _ticketRows(packsPayload) {
  const groups = new Map();
  for (const pack of Array.isArray(packsPayload?.ticketRevealPacks)
    ? packsPayload.ticketRevealPacks : []) {
    const block = _block(pack?.revealBlock);
    const level = _ticketPackLevel(pack);
    // Prefer the reveal transaction: it is the opening the player performed.
    // Block alone is a coarser bucket, and it silently merges every pack in a
    // payload whose packs all carry the same stamp.
    const transactionHash = /^0x[0-9a-f]{64}$/i.test(String(pack?.transactionHash || ''))
      ? _lower(pack.transactionHash) : null;
    const keyRoot = transactionHash != null
      ? `tx:${transactionHash}`
      : block == null ? String(pack?.packId || groups.size) : `block:${block}`;
    const key = `${keyRoot}:level:${level == null ? 'unknown' : level}`;
    if (!groups.has(key)) groups.set(key, { block, level, transactionHash, packs: [] });
    const group = groups.get(key);
    group.packs.push(pack);
  }
  return [...groups.entries()].map(([key, group]) => {
    const pieces = _ticketPieces(group.packs);
    const revealPieces = [
      ...pieces.tickets.map((ticket) => ({ ...ticket, entry: false })),
      ...pieces.entries.map((entry) => ({ ...entry, entry: true })),
    ];
    const packCount = Math.ceil(revealPieces.length / HISTORY_TICKETS_PER_PACK);
    const batchId = `history-tickets:${key}`;
    const sequences = [];
    for (let index = 0; index < packCount; index += 1) {
      const chunk = revealPieces.slice(
        index * HISTORY_TICKETS_PER_PACK,
        (index + 1) * HISTORY_TICKETS_PER_PACK,
      );
      const tickets = chunk.filter((piece) => !piece.entry)
        .map((ticket) => ({ traitIds: ticket.traitIds }));
      const entries = chunk.filter((piece) => piece.entry)
        .map((entry) => ({ traitId: entry.traitId }));
      sequences.push({
        kind: 'pack',
        title: group.level == null ? 'TICKETS RECEIVED' : `LEVEL ${group.level} TICKETS`,
        level: group.level,
        autoStart: true,
        count: tickets.length + (entries.length / 4),
        totalCount: pieces.count,
        tickets,
        entries,
        batchId,
        packIndex: index + 1,
        packCount,
      });
    }
    const map = _deltaMap();
    _addCount(map, 'TICKETS', pieces.count, { level: group.level });
    const countLabel = pieces.count.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const ticketLabel = group.level == null ? 'tickets' : `L${group.level} tickets`;
    return _historyRow({
      id: `tickets:${key}`,
      type: 'tickets',
      title: 'Tickets received',
      detail: sequences.length > 0
        ? `${countLabel} ${ticketLabel} · ${sequences.length} replay pack${sequences.length === 1 ? '' : 's'}`
        : `${countLabel} ${ticketLabel} · reveal data indexing`,
      blockNumber: group.block,
      transactionHash: group.transactionHash,
      deltas: _deltas(map),
      replaySequences: sequences,
    });
  });
}

function _jackpotRows(history, jackpotBlocks = new Map()) {
  const groups = new Map();
  for (const win of Array.isArray(history?.wins) ? history.wins : []) {
    const day = Number(win?.day);
    if (!Number.isInteger(day) || day <= 0) continue;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(win);
  }
  return [...groups.entries()].map(([day, wins]) => {
    const map = _deltaMap();
    for (const win of wins) {
      const type = String(win?.awardType || '').toLowerCase();
      if (type === 'eth' || type === 'eth_baf') _addRaw(map, 'ETH', win?.amount, 'eth');
      else if (type === 'flip' || type.includes('flip')) _addRaw(map, 'FLIP', win?.amount, 'token');
      else if (['ticket', 'tickets', 'tickets_baf'].includes(type)) {
        _addCount(map, 'TICKETS', Number(_big(win?.amount)) / 4, { level: win?.level });
      } else if (type === 'whale_pass') {
        _addCount(map, 'HALF-PASS', Number(win?.halfPassCount ?? win?.amount ?? 0));
      }
    }
    const mapped = jackpotBlocks instanceof Map
      ? jackpotBlocks.get(day) : jackpotBlocks?.[day];
    return _historyRow({
      id: `jackpot:${day}`,
      type: 'jackpot',
      title: 'Jackpot award',
      detail: `Day ${day} · ${wins.length} award${wins.length === 1 ? '' : 's'}`,
      blockNumber: mapped?.end ?? mapped?.start ?? mapped ?? null,
      day,
      deltas: _deltas(map),
    });
  });
}

function _compareRows(a, b) {
  if (a.chronology != null && b.chronology != null) {
    if (a.chronology > b.chronology) return -1;
    if (a.chronology < b.chronology) return 1;
  } else if (a.chronology != null) {
    return -1;
  } else if (b.chronology != null) {
    return 1;
  }
  if ((a.day ?? 0) !== (b.day ?? 0)) return (b.day ?? 0) - (a.day ?? 0);
  return String(a.id).localeCompare(String(b.id));
}

export function buildTransactionHistoryRows({
  address,
  lootboxFeed = null,
  lootboxLegs = null,
  degeneretteFeed = null,
  packs = null,
  jackpotHistory = null,
  afkingHistory = null,
  jackpotBlocks = new Map(),
} = {}) {
  const owner = _lower(address);
  const degenerette = _degeneretteRows(degeneretteFeed, owner);
  const passes = _passPurchaseRows(afkingHistory, owner);
  const rows = [
    ..._lootboxPurchaseRows(lootboxFeed, owner, passes.transactions),
    ..._lootboxResultRows(lootboxLegs, owner, degenerette.excludedLootboxTransactions),
    ...degenerette.rows,
    ..._ticketRows(packs),
    ..._jackpotRows(jackpotHistory, jackpotBlocks),
    ..._afkingPurchaseRows(afkingHistory, owner),
    ...passes.rows,
  ];
  const unique = new Map();
  for (const row of rows) {
    const key = `${row.id}:${row.transactionHash || row.blockNumber || row.day || ''}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].sort(_compareRows);
}

function _jackpotDays(history) {
  return [...new Set((Array.isArray(history?.wins) ? history.wins : [])
    .map((win) => Number(win?.day))
    .filter((day) => Number.isInteger(day) && day > 0))]
    .sort((a, b) => b - a);
}

/** Map absolute protocol days to the level-relative purchase/jackpot clock. */
export function transactionHistoryPhaseClockMap(payload) {
  const normalized = (Array.isArray(payload?.days) ? payload.days : [])
    .map((item) => {
      const day = Number(item?.day);
      const level = _ticketLevel(item?.level);
      const phase = String(item?.phase || '').toUpperCase();
      const dayInPhase = Number(item?.dayInPhase);
      const explicitTotal = Number(
        item?.phaseTotal ?? item?.daysInPhase ?? item?.jackpotDays ?? item?.phaseDays,
      );
      if (!Number.isInteger(day) || day <= 0 || level == null
        || !['J', 'P'].includes(phase)
        || !Number.isInteger(dayInPhase) || dayInPhase <= 0) return null;
      return {
        day,
        level,
        phase,
        dayInPhase,
        explicitTotal: Number.isInteger(explicitTotal) && explicitTotal > 0
          ? explicitTotal : null,
      };
    })
    .filter(Boolean);
  const jackpotTotals = new Map();
  for (const clock of normalized) {
    if (clock.phase !== 'J') continue;
    jackpotTotals.set(
      clock.level,
      Math.max(
        jackpotTotals.get(clock.level) ?? 0,
        clock.dayInPhase,
        clock.explicitTotal ?? 0,
      ),
    );
  }
  return new Map(normalized.map((clock) => [clock.day, {
    level: clock.level,
    phase: clock.phase,
    dayInPhase: clock.dayInPhase,
    phaseTotal: clock.phase === 'J'
      ? Math.max(clock.dayInPhase, jackpotTotals.get(clock.level) ?? clock.dayInPhase)
      : null,
  }]));
}

export function applyTransactionHistoryPhaseClocks(rows, payload) {
  const clocks = transactionHistoryPhaseClockMap(payload);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const clock = clocks.get(Number(row?.day));
    if (!clock) return row;
    let changedDelta = false;
    const deltas = (Array.isArray(row?.deltas) ? row.deltas : []).map((delta) => {
      if (delta?.asset !== 'TICKETS' || _ticketLevel(delta?.level) != null) return delta;
      changedDelta = true;
      return { ...delta, level: clock.level };
    });
    return {
      ...row,
      phaseClock: clock,
      ...(changedDelta ? { deltas } : {}),
    };
  });
}

export function formatTransactionHistoryDay(row) {
  const clock = row?.phaseClock;
  const level = _ticketLevel(clock?.level);
  const phase = String(clock?.phase || '').toUpperCase();
  const dayInPhase = Number(clock?.dayInPhase);
  if (level != null && Number.isInteger(dayInPhase) && dayInPhase > 0) {
    if (phase === 'P') return `L${level} DAY P${dayInPhase}`;
    if (phase === 'J') {
      const total = Math.max(dayInPhase, Math.trunc(Number(clock?.phaseTotal) || dayInPhase));
      return `L${level} DAY J${dayInPhase}/${total}`;
    }
  }
  return row?.day != null ? `DAY ${row.day}` : 'GAME ACTIVITY';
}

async function _rowsWithBlockTimes(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const blocks = [...new Set(list
    .filter((row) => row?.timestampMs == null && row?.blockNumber != null)
    .map((row) => String(row.blockNumber)))];
  if (blocks.length === 0 || !CHAIN?.rpcUrl || typeof fetch !== 'function') {
    return { rows: list, incomplete: blocks.length > 0 };
  }

  const timestamps = new Map();
  let incomplete = false;
  for (let offset = 0; offset < blocks.length; offset += RPC_BATCH_SIZE) {
    const chunk = blocks.slice(offset, offset + RPC_BATCH_SIZE);
    const calls = chunk.map((block, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'eth_getBlockByNumber',
      params: [`0x${BigInt(block).toString(16)}`, false],
    }));
    try {
      const response = await fetch(CHAIN.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(calls),
      });
      if (!response.ok) throw new Error(`RPC ${response.status}`);
      const payload = await response.json();
      const replies = Array.isArray(payload) ? payload : [payload];
      const replyById = new Map(replies.map((reply) => [Number(reply?.id), reply]));
      chunk.forEach((block, index) => {
        const raw = replyById.get(index + 1)?.result?.timestamp;
        try {
          const milliseconds = Number(BigInt(raw)) * 1000;
          if (Number.isFinite(milliseconds) && milliseconds > 0) timestamps.set(block, milliseconds);
        } catch (_e) { /* one unavailable block does not blank the page */ }
      });
    } catch (_e) {
      incomplete = true;
    }
  }
  if (timestamps.size < blocks.length) incomplete = true;

  return {
    rows: list.map((row) => {
      const timestampMs = row.timestampMs ?? timestamps.get(String(row.blockNumber)) ?? null;
      const day = row.day ?? gameDayForHistoryTimestamp(timestampMs);
      return timestampMs == null && day === row.day ? row : { ...row, timestampMs, day };
    }),
    incomplete,
  };
}

export async function loadTransactionHistory(address, { limit = DEFAULT_LIMIT, page = 0 } = {}) {
  const safeLimit = LIMITS.has(Number(limit)) ? Number(limit) : DEFAULT_LIMIT;
  const safePage = Math.max(0, Math.trunc(Number(page) || 0));
  const owner = _lower(address);
  if (!/^0x[0-9a-f]{40}$/.test(owner)) {
    return { rows: [], warnings: [], total: 0, hasNext: false };
  }
  const player = encodeURIComponent(owner);
  const wantedRows = ((safePage + 1) * safeLimit) + 1;
  const feedLimit = Math.min(SOURCE_PAGE_CAP, Math.max(safeLimit, wantedRows));
  const legLimit = Math.min(SOURCE_PAGE_CAP, Math.max(100, wantedRows * 4));
  const requests = [
    ['luckbox purchases', () => fetchJSON(`/lootbox/feed?limit=${feedLimit}&player=${player}`)],
    ['luckbox results', () => fetchJSON(`/lootbox/legs?limit=${legLimit}&player=${player}`)],
    ['Degenerette', () => fetchJSON(`/degenerette/feed?limit=${feedLimit}&player=${player}`)],
    // Paginated like every other source here. This used to call /packs with no
    // day, which returned the player's entire reveal history on every open.
    ['ticket reveals', () => fetchJSON(`/player/${player}/reveals?limit=${feedLimit}`)],
    ['jackpot awards', () => fetchJSON(`/player/${player}/jackpot-history`)],
    ['AFKing/pass purchases', () => loadAfkingPurchaseHistory(owner)],
    ['level/day labels', () => fetchJSON('/replay/rng')],
  ];
  const settled = await Promise.allSettled(requests.map(([, load]) => load()));
  const values = settled.map((result) => result.status === 'fulfilled' ? result.value : null);
  const warnings = settled.flatMap((result, index) => (
    result.status === 'rejected' ? [requests[index][0]] : []
  ));
  const jackpotHistory = values[4];
  const blockDays = _jackpotDays(jackpotHistory).slice(0, JACKPOT_BLOCK_LOOKUPS);
  const blockResults = await Promise.allSettled(blockDays.map((day) => (
    fetchJSON(`/game/jackpot/day/${day}/summary`)
  )));
  const jackpotBlocks = new Map();
  blockResults.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const range = result.value?.blockRange;
    if (_block(range?.end ?? range?.start) != null) jackpotBlocks.set(blockDays[index], range);
  });
  const allRows = buildTransactionHistoryRows({
    address: owner,
    lootboxFeed: values[0],
    lootboxLegs: values[1],
    degeneretteFeed: values[2],
    packs: values[3],
    jackpotHistory,
    afkingHistory: values[5],
    jackpotBlocks,
  });
  const start = safePage * safeLimit;
  const end = start + safeLimit;
  const pageRows = allRows.slice(start, end);
  const timed = await _rowsWithBlockTimes(pageRows);
  if (timed.incomplete) warnings.push('block times');
  const sourceHasMore = [values[0], values[1], values[2]]
    .some((value) => value?.nextCursor != null);
  const hasNext = allRows.length > end
    || (wantedRows < SOURCE_PAGE_CAP && sourceHasMore && pageRows.length === safeLimit);
  return {
    rows: applyTransactionHistoryPhaseClocks(timed.rows, values[6]),
    warnings,
    total: allRows.length,
    hasNext,
    page: safePage,
  };
}

let _historyLoader = loadTransactionHistory;

/** Test-only dependency seam; pass null to restore production loading. */
export function setTransactionHistoryLoaderForTest(loader) {
  _historyLoader = typeof loader === 'function' ? loader : loadTransactionHistory;
}

function _selectHasValue(select, value) {
  if (!select?.options) return false;
  return Array.from(select.options).some((option) => String(option.value) === String(value));
}

/** Convert a history row into the exact ordered reveal queue it represents. */
export function transactionHistoryReplaySequences(row) {
  if (Array.isArray(row?.replaySequences) && row.replaySequences.length > 0) {
    return row.replaySequences;
  }
  if (!row?.sequence) return [];
  if (row.type !== 'degenerette-result') return [row.sequence];
  return degeneretteReplaySequences(row.sequence, {
    lootboxTitle: 'DEGENERETTE LUCKBOX',
    lootboxNoVessel: true,
  });
}

async function _replayJackpotDay(day, address) {
  const panel = document.querySelector?.('replay-panel');
  if (!panel) throw new Error('Jackpot replay is unavailable.');
  const dayValue = String(day);
  let daySelect = panel.querySelector?.('[data-bind="day-select"]');
  if (!_selectHasValue(daySelect, dayValue) && typeof panel.refreshDays === 'function') {
    await panel.refreshDays({ force: true });
    daySelect = panel.querySelector?.('[data-bind="day-select"]');
  }
  if (!_selectHasValue(daySelect, dayValue)) throw new Error(`Day ${day} is not indexed for replay yet.`);

  const playerSelect = panel.querySelector?.('[data-bind="player-select"]');
  const player = _lower(address);
  if (playerSelect && player && !_selectHasValue(playerSelect, player)) {
    const option = document.createElement('option');
    option.value = player;
    option.textContent = `${player.slice(0, 6)}…${player.slice(-4)}`;
    playerSelect.appendChild(option);
  }
  if (playerSelect && player) {
    playerSelect.value = player;
    playerSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const clickReady = () => {
    const reveal = panel.querySelector?.('[data-bind="reveal-btn"]');
    if (!reveal || reveal.disabled) return false;
    reveal.click?.();
    document.querySelector?.('.jackpot-hero')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    return true;
  };
  daySelect.value = dayValue;
  daySelect.dispatchEvent(new Event('change', { bubbles: true }));
  if (clickReady()) return true;

  return new Promise((resolve, reject) => {
    const onReady = (event) => {
      if (Number(event?.detail?.day) !== Number(day)) return;
      if (!clickReady()) return;
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Day ${day} is still loading. Try replay again.`));
    }, 12_000);
    const cleanup = () => {
      try { clearTimeout(timer); } catch (_e) { /* defensive */ }
      panel.removeEventListener?.('replay:day-ready', onReady);
    };
    panel.addEventListener?.('replay:day-ready', onReady);
  });
}

class AppTransactionHistory extends HTMLElement {
  #initialized = false;
  #unsubs = [];
  #address = null;
  #limit = DEFAULT_LIMIT;
  #page = 0;
  #hasNext = false;
  #pageCache = new Map();
  #rows = [];
  #warnings = [];
  #total = 0;
  #loadedKey = null;
  #loading = false;
  #error = '';
  #notice = '';
  #sequence = 0;
  #noticeTimer = null;
  #filters = new Set(HISTORY_FILTER_KEYS);

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    const details = this.querySelector('[data-bind="txh-details"]');
    details?.addEventListener('toggle', () => {
      if (details.open) void this.#ensureLoaded();
    });
    this.querySelector('[data-bind="txh-limit"]')?.addEventListener('change', (event) => {
      const next = Number(event?.target?.value);
      this.#limit = LIMITS.has(next) ? next : DEFAULT_LIMIT;
      this.#page = 0;
      this.#loadedKey = null;
      if (details?.open) void this.#ensureLoaded();
    });
    this.querySelector('[data-bind="txh-prev"]')?.addEventListener('click', () => {
      if (this.#loading || this.#page <= 0) return;
      this.#page -= 1;
      this.#loadedKey = null;
      if (details?.open) void this.#ensureLoaded();
    });
    this.querySelector('[data-bind="txh-next"]')?.addEventListener('click', () => {
      if (this.#loading || !this.#hasNext) return;
      this.#page += 1;
      this.#loadedKey = null;
      if (details?.open) void this.#ensureLoaded();
    });
    this.querySelector('[data-bind="txh-refresh"]')?.addEventListener('click', () => {
      if (details?.open) void this.#ensureLoaded({ force: true });
    });
    for (const [key] of HISTORY_FILTERS) {
      this.querySelector(`[data-bind="txh-filter-${key}"]`)?.addEventListener('click', () => {
        this.#filters.clear();
        this.#filters.add(key);
        this.#paint();
      });
    }
    const syncAddress = () => this.#syncAddress();
    this.#unsubs.push(subscribe('viewing.address', syncAddress));
    this.#unsubs.push(subscribe('connected.address', syncAddress));
    this.#unsubs.push(subscribe('app.lastDay', () => this.#paint()));
    this.#unsubs.push(subscribe('app.gameState', () => this.#paint()));
    this.#syncAddress();
  }

  disconnectedCallback() {
    this.#sequence += 1;
    this.#unsubs.forEach((unsubscribe) => { try { unsubscribe(); } catch (_e) { /* defensive */ } });
    this.#unsubs = [];
    if (this.#noticeTimer != null) {
      try { clearTimeout(this.#noticeTimer); } catch (_e) { /* defensive */ }
      this.#noticeTimer = null;
    }
    this.#initialized = false;
  }

  #renderShell() {
    this.innerHTML = `
      <details class="txh section-disclosure" data-bind="txh-details">
        <summary class="txh__summary section-disclosure__bar">
          <strong class="section-disclosure__title">TRANSACTION HISTORY</strong>
          <span class="section-disclosure__chevron" aria-hidden="true"></span>
        </summary>
        <div class="txh__content">
          <div class="txh__toolbar">
            <div class="txh__filters" aria-label="Filter transaction history">
              <span class="txh__filters-label">SHOW</span>
              ${HISTORY_FILTERS.map(([key, label]) => `
                <button type="button" class="txh__filter is-selected"
                        data-bind="txh-filter-${key}" aria-pressed="true">${label}</button>
              `).join('')}
            </div>
            <label>ROWS
              <select data-bind="txh-limit" aria-label="Transaction history rows">
                <option value="10" selected>10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>
            <span class="txh__pager" aria-label="Transaction history pages">
              <button type="button" data-bind="txh-prev" aria-label="Previous history page">PREV</button>
              <output data-bind="txh-page" aria-live="polite">PAGE 1</output>
              <button type="button" data-bind="txh-next" aria-label="Next history page">NEXT</button>
            </span>
            <button type="button" class="txh__refresh" data-bind="txh-refresh"
                    aria-label="Refresh transaction history" title="Refresh history">↻</button>
          </div>
          <div class="txh__message" data-bind="txh-message" role="status"></div>
          <div class="txh__warning" data-bind="txh-warning" hidden></div>
          <div class="txh__table-wrap" data-bind="txh-table-wrap" hidden>
            <table class="txh__table">
              <thead><tr>
                <th scope="col">WHEN</th>
                <th scope="col">ACTIVITY</th>
                <th scope="col">ETH</th>
                <th scope="col">COINS</th>
                <th scope="col">ITEMS</th>
                <th scope="col">REVEAL</th>
              </tr></thead>
              <tbody data-bind="txh-body"></tbody>
            </table>
          </div>
        </div>
      </details>
    `;
    this.#paint();
  }

  #syncAddress() {
    const next = _lower(getViewedAddress()) || null;
    if (next === this.#address) return;
    this.#address = next;
    this.#sequence += 1;
    this.#page = 0;
    this.#hasNext = false;
    this.#pageCache.clear();
    this.#rows = [];
    this.#warnings = [];
    this.#total = 0;
    this.#loadedKey = null;
    this.#loading = false;
    this.#error = '';
    this.#paint();
    const details = this.querySelector('[data-bind="txh-details"]');
    if (details?.open) void this.#ensureLoaded();
  }

  async #ensureLoaded({ force = false } = {}) {
    const details = this.querySelector('[data-bind="txh-details"]');
    if (!details?.open || this.#loading) return;
    if (!this.#address) {
      this.#paint();
      return;
    }
    const key = `${this.#address}:${this.#limit}:${this.#page}`;
    if (!force && this.#loadedKey === key) return;
    if (!force && this.#pageCache.has(key)) {
      const cached = this.#pageCache.get(key);
      this.#rows = cached.rows;
      this.#warnings = cached.warnings;
      this.#total = cached.total;
      this.#hasNext = cached.hasNext;
      this.#loadedKey = key;
      this.#paint();
      return;
    }
    if (force) this.#pageCache.delete(key);
    const sequence = ++this.#sequence;
    this.#loading = true;
    this.#error = '';
    this.#notice = '';
    this.#paint();
    try {
      const result = await _historyLoader(this.#address, { limit: this.#limit, page: this.#page });
      if (sequence !== this.#sequence || this.#address == null) return;
      this.#rows = Array.isArray(result?.rows) ? result.rows : [];
      this.#warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      this.#total = Math.max(this.#rows.length, Number(result?.total) || 0);
      this.#hasNext = Boolean(result?.hasNext);
      this.#loadedKey = key;
      this.#pageCache.set(key, {
        rows: this.#rows,
        warnings: this.#warnings,
        total: this.#total,
        hasNext: this.#hasNext,
      });
    } catch (error) {
      if (sequence !== this.#sequence) return;
      this.#rows = [];
      this.#warnings = [];
      this.#hasNext = false;
      this.#error = compactUiError(error, 'Could not load transaction history.');
    } finally {
      if (sequence === this.#sequence) {
        this.#loading = false;
        this.#paint();
      }
    }
  }

  #setNotice(message) {
    this.#notice = String(message || '');
    this.#paint();
    if (this.#noticeTimer != null) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => {
      this.#noticeTimer = null;
      this.#notice = '';
      this.#paint();
    }, 3_500);
    if (this.#noticeTimer && typeof this.#noticeTimer.unref === 'function') this.#noticeTimer.unref();
  }

  async #replay(row, button) {
    if (!row) return;
    button.disabled = true;
    button.classList?.add('is-busy');
    try {
      let queued = false;
      if (row.day != null && row.type === 'jackpot') {
        await _replayJackpotDay(row.day, this.#address);
        queued = true;
      } else {
        for (const sequence of transactionHistoryReplaySequences(row)) {
          queued = queueReveal(sequence) || queued;
        }
      }
      if (!queued) throw new Error('This reveal is not available yet.');
      this.#setNotice('Replay queued.');
    } catch (error) {
      this.#setNotice(compactUiError(error, 'Could not replay this reveal.'));
    } finally {
      button.disabled = false;
      button.classList?.remove('is-busy');
    }
  }

  #activityCell(row) {
    const cell = document.createElement('td');
    cell.className = 'txh__activity';
    cell.setAttribute('data-label', 'ACTIVITY');
    const inner = document.createElement('span');
    inner.className = 'txh__activity-inner';
    const mark = document.createElement('span');
    mark.className = `txh__mark txh__mark--${row.type}`;
    mark.textContent = ACTIVITY_MARKS[row.type] || '•';
    mark.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = row.title;
    const detail = document.createElement('small');
    detail.textContent = row.detail;
    copy.appendChild(title);
    copy.appendChild(detail);
    inner.appendChild(mark);
    inner.appendChild(copy);
    cell.appendChild(inner);
    return cell;
  }

  #whenCell(row) {
    const cell = document.createElement('td');
    cell.className = 'txh__when';
    cell.setAttribute('data-label', 'WHEN');
    const base = String(CHAIN?.etherscanBase || '').replace(/\/$/, '');
    const href = base && row.transactionHash
      ? `${base}/tx/${row.transactionHash}`
      : base && row.blockNumber != null
        ? `${base}/block/${String(row.blockNumber)}` : '';
    const inner = document.createElement(href ? 'a' : 'span');
    inner.className = 'txh__when-inner';
    if (href) {
      inner.href = href;
      inner.target = '_blank';
      inner.rel = 'noopener noreferrer';
      inner.title = row.transactionHash
        ? `View transaction ${row.transactionHash}`
        : `View block ${String(row.blockNumber)}`;
    }
    const primary = document.createElement('strong');
    primary.textContent = formatTransactionHistoryDay(row);
    const secondary = document.createElement(row.timestampMs != null ? 'time' : 'small');
    if (row.timestampMs != null) {
      secondary.dateTime = new Date(row.timestampMs).toISOString();
      secondary.textContent = formatHistoryTimestamp(row.timestampMs);
    } else {
      secondary.textContent = row.blockNumber != null
        ? `BLOCK ${String(row.blockNumber)}` : 'TIME UNAVAILABLE';
    }
    inner.appendChild(primary);
    inner.appendChild(secondary);
    cell.appendChild(inner);
    return cell;
  }

  #assetCell(row, group, label) {
    const cell = document.createElement('td');
    cell.className = `txh__asset-group txh__asset-group--${group}`;
    cell.setAttribute('data-label', label);
    const inner = document.createElement('span');
    inner.className = 'txh__assets-inner';
    const deltas = row.deltas.filter((delta) => _assetGroup(delta.asset) === group);
    if (deltas.length === 0) {
      inner.textContent = '—';
    } else {
      for (const delta of deltas) {
        const chip = document.createElement('span');
        const negative = delta.kind === 'count' ? delta.value < 0 : delta.value < 0n;
        chip.className = `txh__delta ${negative ? 'is-negative' : 'is-positive'}`;
        const ticketLevel = delta.asset === 'TICKETS' ? _ticketLevel(delta.level) : null;
        if (ticketLevel != null) {
          const parts = _historyDeltaParts(delta);
          const amount = document.createElement('span');
          amount.textContent = `${parts.negative ? '−' : '+'}${parts.amount} `;
          const level = document.createElement('span');
          level.className = 'txh__ticket-level';
          level.textContent = `L${ticketLevel}`;
          applyTicketLevelTone(level, ticketLevel);
          const asset = document.createElement('span');
          asset.textContent = ' TICKETS';
          chip.appendChild(amount);
          chip.appendChild(level);
          chip.appendChild(asset);
        } else {
          chip.textContent = formatHistoryDelta(delta);
        }
        const exact = _formatHistoryDeltaExact(delta);
        chip.title = `Exact net: ${exact}`;
        chip.setAttribute('aria-label', `Net asset change ${exact}`);
        inner.appendChild(chip);
      }
    }
    cell.appendChild(inner);
    return cell;
  }

  #rowElement(row) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-history-id', row.id);
    const replay = document.createElement('td');
    replay.className = 'txh__replay';
    replay.setAttribute('data-label', 'REVEAL');
    const canReplay = Boolean(
      (row.type === 'jackpot' && row.day != null)
      || row.sequence
      || row.replaySequences?.length,
    );
    if (canReplay) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'txh__replay-button';
      const replayIcon = document.createElement('span');
      replayIcon.setAttribute('aria-hidden', 'true');
      replayIcon.textContent = '↻';
      const replayLabel = document.createElement('strong');
      replayLabel.textContent = 'REPLAY';
      button.appendChild(replayIcon);
      button.appendChild(replayLabel);
      button.setAttribute('aria-label', `Replay ${row.title}`);
      button.addEventListener('click', () => void this.#replay(row, button));
      replay.appendChild(button);
    } else {
      replay.textContent = '—';
    }

    tr.appendChild(this.#whenCell(row));
    tr.appendChild(this.#activityCell(row));
    tr.appendChild(this.#assetCell(row, 'eth', 'ETH'));
    tr.appendChild(this.#assetCell(row, 'coins', 'COINS'));
    tr.appendChild(this.#assetCell(row, 'items', 'ITEMS'));
    tr.appendChild(replay);
    return tr;
  }

  #filteredRows() {
    return this.#rows.filter((row) => this.#filters.has(transactionHistoryCategory(row)));
  }

  #paint() {
    const body = this.querySelector('[data-bind="txh-body"]');
    const wrap = this.querySelector('[data-bind="txh-table-wrap"]');
    const message = this.querySelector('[data-bind="txh-message"]');
    const warning = this.querySelector('[data-bind="txh-warning"]');
    const refresh = this.querySelector('[data-bind="txh-refresh"]');
    const previous = this.querySelector('[data-bind="txh-prev"]');
    const next = this.querySelector('[data-bind="txh-next"]');
    const page = this.querySelector('[data-bind="txh-page"]');
    if (!body || !wrap || !message) return;
    const visibleRows = this.#filteredRows();
    body.textContent = '';
    for (const [key] of HISTORY_FILTERS) {
      const button = this.querySelector(`[data-bind="txh-filter-${key}"]`);
      if (!button) continue;
      const selected = this.#filters.has(key);
      button.className = `txh__filter${selected ? ' is-selected' : ''}`;
      button.setAttribute('aria-pressed', String(selected));
    }
    if (refresh) refresh.disabled = this.#loading || !this.#address;
    if (previous) previous.disabled = this.#loading || this.#page <= 0;
    if (next) next.disabled = this.#loading || !this.#hasNext;
    if (page) page.textContent = `PAGE ${this.#page + 1}`;
    let text = '';
    if (!this.#address) text = 'Connect or select a player to load history.';
    else if (this.#loading) text = 'Loading indexed activity…';
    else if (this.#error) text = this.#error;
    else if (this.#notice) text = this.#notice;
    else if (this.#loadedKey && this.#rows.length === 0) {
      text = this.#page > 0 ? 'No more indexed activity.' : 'No indexed activity yet.';
    }
    else if (this.#loadedKey && visibleRows.length === 0) {
      text = this.#filters.size === 0
        ? 'Select a category to show activity.'
        : 'No matching activity on this page.';
    }
    else if (!this.#loadedKey) text = 'History loads only when this section opens.';
    message.textContent = text;
    message.hidden = !text;

    if (warning) {
      warning.hidden = this.#warnings.length === 0;
      warning.textContent = this.#warnings.length > 0
        ? `Partial history: ${this.#warnings.join(', ')} could not be loaded.` : '';
    }
    wrap.hidden = visibleRows.length === 0;
    for (const row of visibleRows) body.appendChild(this.#rowElement(row));
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-transaction-history')) {
  customElements.define('app-transaction-history', AppTransactionHistory);
}

export { AppTransactionHistory };
