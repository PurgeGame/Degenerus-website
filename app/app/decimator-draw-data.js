// Reconstruct one resolved Decimator wheel from the protocol's public logs.
//
// The regular player endpoint intentionally returns only one player's result.
// The wheel also needs every final subbucket denominator, so this reader uses
// the authoritative DecBurnRecorded + DecimatorResolved events. One final
// record per player is retained because a player can migrate buckets while the
// window is open. Raw FLIP destroyed comes from FLIP.DecimatorBurn.

import { CHAIN, CONTRACTS, ETH_DIVISOR } from './chain-config.js';
import { sharedReadProvider } from './read-provider.js';
import { ethers } from './contracts.js';

const GAME_EVENTS = [
  'event DecBurnRecorded(address indexed player,uint24 indexed lvl,uint8 bucket,uint8 subBucket,uint256 effectiveAmount,uint256 newTotalBurn)',
  'event DecimatorResolved(uint24 indexed lvl,uint64 packedOffsets,uint256 poolWei,uint256 totalBurn)',
];
const FLIP_EVENTS = [
  'event DecimatorBurn(address indexed player,uint256 amountBurned,uint8 bucket)',
];

const gameInterface = new ethers.Interface(GAME_EVENTS);
const flipInterface = new ethers.Interface(FLIP_EVENTS);
let readProvider = null;
let providerOverride = null;

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function logOrder(left, right) {
  return Number(left?.blockNumber || 0) - Number(right?.blockNumber || 0)
    || Number(left?.index ?? left?.logIndex ?? 0) - Number(right?.index ?? right?.logIndex ?? 0);
}

function provider() {
  if (providerOverride) return providerOverride;
  if (!readProvider) {
    readProvider = sharedReadProvider();  // C15: shared batched read stream
  }
  return readProvider;
}

function levelTopic(level) {
  return ethers.zeroPadValue(ethers.toBeHex(level), 32);
}

export function unpackDecimatorWinningSubbuckets(packedValue) {
  const packed = BigInt(packedValue ?? 0);
  const out = {};
  for (let bucket = 2; bucket <= 12; bucket += 1) {
    out[String(bucket)] = Number((packed >> BigInt((bucket - 2) * 4)) & 0xfn);
  }
  return out;
}

/** Build the iframe-safe snapshot from already-fetched logs. */
export function buildDecimatorDrawSnapshot({
  level,
  player,
  gameLogs,
  flipLogs,
  network = CHAIN.name,
  gameAddress = CONTRACTS.GAME,
  ethDisplayScale = ETH_DIVISOR,
} = {}) {
  const lvl = integer(level, -1);
  if (lvl <= 0) throw new Error('Invalid Decimator level.');

  const resolutions = (Array.isArray(gameLogs) ? gameLogs : [])
    .flatMap((log) => {
      try {
        const parsed = gameInterface.parseLog(log);
        return parsed?.name === 'DecimatorResolved' && Number(parsed.args.lvl) === lvl
          ? [{ log, args: parsed.args }]
          : [];
      } catch (_error) { return []; }
    })
    .sort((left, right) => logOrder(left.log, right.log));
  const resolved = resolutions.at(-1);
  if (!resolved) throw new Error(`Level ${lvl} Decimator result is not indexed on-chain yet.`);

  const finalPlayers = new Map();
  for (const log of [...(Array.isArray(gameLogs) ? gameLogs : [])].sort(logOrder)) {
    try {
      const parsed = gameInterface.parseLog(log);
      if (parsed?.name !== 'DecBurnRecorded' || Number(parsed.args.lvl) !== lvl) continue;
      const bucket = Number(parsed.args.bucket);
      const subbucket = Number(parsed.args.subBucket);
      if (bucket < 2 || bucket > 12 || subbucket < 0 || subbucket >= bucket) continue;
      const address = String(parsed.args.player).toLowerCase();
      finalPlayers.set(address, {
        address,
        bucket,
        subbucket,
        score: BigInt(parsed.args.newTotalBurn).toString(),
      });
    } catch (_error) { /* ignore unrelated/malformed logs */ }
  }
  if (finalPlayers.size === 0) {
    throw new Error(`Level ${lvl} Decimator burn records are unavailable.`);
  }

  const totals = new Map();
  for (const row of finalPlayers.values()) {
    const key = `${row.bucket}:${row.subbucket}`;
    totals.set(key, (totals.get(key) || 0n) + BigInt(row.score));
  }
  const subbucketTotals = [...totals.entries()]
    .map(([key, score]) => {
      const [bucket, subbucket] = key.split(':').map(Number);
      return { bucket, subbucket, score: score.toString() };
    })
    .sort((left, right) => right.bucket - left.bucket || left.subbucket - right.subbucket);

  const packedOffsets = BigInt(resolved.args.packedOffsets);
  const winningSubbuckets = unpackDecimatorWinningSubbuckets(packedOffsets);
  let winningScore = 0n;
  for (const row of subbucketTotals) {
    if (winningSubbuckets[String(row.bucket)] === row.subbucket) {
      winningScore += BigInt(row.score);
    }
  }
  const winnerPlayers = [...finalPlayers.values()]
    .filter((row) => winningSubbuckets[String(row.bucket)] === row.subbucket)
    .sort((left, right) => {
      const leftScore = BigInt(left.score);
      const rightScore = BigInt(right.score);
      if (leftScore === rightScore) return left.address.localeCompare(right.address);
      return leftScore > rightScore ? -1 : 1;
    });

  let totalFlipBurned = 0n;
  for (const log of Array.isArray(flipLogs) ? flipLogs : []) {
    try {
      const parsed = flipInterface.parseLog(log);
      if (parsed?.name === 'DecimatorBurn') totalFlipBurned += BigInt(parsed.args.amountBurned);
    } catch (_error) { /* ignore unrelated/malformed logs */ }
  }

  const viewed = String(player || '').toLowerCase();
  const viewedRow = finalPlayers.get(viewed) || null;
  return {
    network,
    ethDisplayScale: BigInt(ethDisplayScale || 1).toString(),
    gameAddress,
    level: lvl,
    resolvedBlock: Number(resolved.log.blockNumber),
    blockHash: String(resolved.log.blockHash || ''),
    poolWei: BigInt(resolved.args.poolWei).toString(),
    totalFlipBurned: totalFlipBurned.toString(),
    winningScore: winningScore.toString(),
    packedOffsets: packedOffsets.toString(),
    defaultPlayer: viewedRow?.address || viewed || null,
    winningSubbuckets,
    subbucketTotals,
    // The final payout pie needs the exact public winner denominator. Keep the
    // full winning set, while `players` below remains scoped to the viewer.
    winnerPlayers,
    // The embedded app draw is player-centric. Aggregate totals still include
    // everybody; only the viewed record crosses into the iframe.
    players: viewedRow ? [viewedRow] : [],
  };
}

export async function loadDecimatorDrawSnapshot({ level, player } = {}) {
  const lvl = integer(level, -1);
  if (lvl <= 0) throw new Error('Invalid Decimator level.');
  const reader = provider();
  const topic = levelTopic(lvl);
  const resolvedEvent = gameInterface.getEvent('DecimatorResolved');
  const burnEvent = gameInterface.getEvent('DecBurnRecorded');
  const fromBlock = Number(CHAIN.deployBlock || 0);

  const [resolutionLogs, burnLogs] = await Promise.all([
    reader.getLogs({
      address: CONTRACTS.GAME,
      fromBlock,
      toBlock: 'latest',
      topics: [resolvedEvent.topicHash, topic],
    }),
    reader.getLogs({
      address: CONTRACTS.GAME,
      fromBlock,
      toBlock: 'latest',
      topics: [burnEvent.topicHash, null, topic],
    }),
  ]);
  const resolvedLog = [...resolutionLogs].sort(logOrder).at(-1);
  if (!resolvedLog) throw new Error(`Level ${lvl} Decimator result is still syncing.`);
  const firstBurnBlock = burnLogs.reduce(
    (lowest, log) => Math.min(lowest, Number(log.blockNumber)),
    Number(resolvedLog.blockNumber),
  );
  const flipEvent = flipInterface.getEvent('DecimatorBurn');
  const flipLogs = await reader.getLogs({
    address: CONTRACTS.COIN,
    fromBlock: firstBurnBlock,
    toBlock: Number(resolvedLog.blockNumber),
    topics: [flipEvent.topicHash],
  });
  return buildDecimatorDrawSnapshot({
    level: lvl,
    player,
    gameLogs: [...burnLogs, ...resolutionLogs],
    flipLogs,
  });
}

/** Test-only provider seam. */
export function __setDecimatorDrawProviderForTest(next) {
  providerOverride = next || null;
}

export function __resetDecimatorDrawProviderForTest() {
  providerOverride = null;
}
