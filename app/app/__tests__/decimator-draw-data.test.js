import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from '../../app/contracts.js';
import {
  __resetDecimatorDrawProviderForTest,
  __setDecimatorDrawProviderForTest,
  buildDecimatorDrawSnapshot,
  decimatorCoinHeads,
  decimatorPeakMultiple,
  decimatorScoreWei,
  loadDecimatorDrawSnapshot,
} from '../decimator-draw-data.js';

// Audit 92a1358d0: the Decimator is a shared-dice craps battle.
const game = new ethers.Interface([
  'event DecBurnRecorded(address indexed player,uint24 indexed lvl,uint64 indexed entryId,uint256 baseAmount,uint256 credited,uint256 stack,uint32 chips)',
  'event DecimatorResolved(uint24 indexed lvl,uint256 rngWord,uint256 poolWei,uint64 entrants)',
  'event DecimatorRun(uint24 indexed lvl,uint64 indexed entryId,uint256 normalizedPeak)',
  'event DecimatorRanked(uint24 indexed lvl,uint64 champion,uint8 winners)',
  'event DecimatorClaimed(address indexed player,uint24 indexed lvl,uint64 indexed entryId,uint256 amountWei,uint256 halfPasses)',
]);
const flip = new ethers.Interface([
  'event DecimatorBurn(address indexed player,uint256 amountBurned,uint64 entryId)',
]);

const PLAYER_A = '0x00000000000000000000000000000000000000a1';
const PLAYER_B = '0x00000000000000000000000000000000000000b2';
const PLAYER_C = '0x00000000000000000000000000000000000000c3';
const FLIP = 10n ** 18n;
const level = 15;
// A sealed word under which A (1) and B (2) are heads and C (3) is tails, as _run computes it.
const WORD = Array.from({ length: 256 }, (_, i) => BigInt(i + 1))
  .find(word => decimatorCoinHeads(word, level, 1n) && decimatorCoinHeads(word, level, 2n) && !decimatorCoinHeads(word, level, 3n));

function log(iface, event, args, blockNumber, index = 0) {
  const encoded = iface.encodeEventLog(iface.getEvent(event), args);
  return { data: encoded.data, topics: encoded.topics, blockNumber, index, blockHash: `0x${String(blockNumber).padStart(64, '0')}` };
}

const burnLogs = [
  // A second burn by A adds to its one entry; its last record carries the final stack and board.
  log(game, 'DecBurnRecorded', [PLAYER_A, level, 1, 100n * FLIP, 100n * FLIP, 100n * FLIP, 0], 10),
  log(game, 'DecBurnRecorded', [PLAYER_B, level, 2, 50n * FLIP, 50n * FLIP, 50n * FLIP, 1], 11),
  log(game, 'DecBurnRecorded', [PLAYER_C, level, 3, 80n * FLIP, 80n * FLIP, 80n * FLIP, 0], 12),
  log(game, 'DecBurnRecorded', [PLAYER_A, level, 1, 50n * FLIP, 50n * FLIP, 150n * FLIP, 9], 13),
];
const resolutionLog = log(game, 'DecimatorResolved', [level, WORD, 1_000n, 3], 14);
const settleLogs = [
  // Peaks are in engine units over the 3,000-FLIP starting bankroll.
  log(game, 'DecimatorRun', [level, 1, 6_000n * FLIP], 15, 0),
  log(game, 'DecimatorRun', [level, 2, 30_000n * FLIP], 15, 1),
  log(game, 'DecimatorRanked', [level, 2, 2], 16, 0),
  // Heap order pays the champion first; the receipt re-sorts by score.
  log(game, 'DecimatorClaimed', [PLAYER_B, level, 2, 700n, 1n], 17, 0),
  log(game, 'DecimatorClaimed', [PLAYER_A, level, 1, 300n, 0n], 17, 1),
  // Another level's credit in the same range is ignored.
  log(game, 'DecimatorClaimed', [PLAYER_C, 25, 3, 999n, 0n], 17, 2),
];
const flipLogs = [
  log(flip, 'DecimatorBurn', [PLAYER_A, 70n, 1], 10),
  log(flip, 'DecimatorBurn', [PLAYER_B, 80n, 2], 11),
];

afterEach(() => __resetDecimatorDrawProviderForTest());

describe('Decimator results reconstruction', () => {
  test('scores are stack x peak over the 3,000-FLIP bankroll', () => {
    assert.equal(decimatorPeakMultiple(6_000n * FLIP), '2.00');
    assert.equal(decimatorPeakMultiple(7_843n * FLIP), '2.61');
    assert.equal(decimatorScoreWei(150n * FLIP, 6_000n * FLIP), 300n * FLIP);
  });

  test('ranks paid winners by score and reads the viewer\'s own coin and run', () => {
    const snapshot = buildDecimatorDrawSnapshot({
      level, player: PLAYER_A, gameLogs: [...burnLogs, resolutionLog, ...settleLogs], flipLogs,
      ethDisplayScale: 1n, network: 'test', gameAddress: '0xgame',
    });
    assert.equal(snapshot.poolWei, '1000');
    assert.equal(snapshot.entrants, 3);
    assert.equal(snapshot.totalFlipBurned, '150');
    assert.equal(snapshot.ranked, true);
    assert.equal(snapshot.winnerCount, 2);
    assert.equal(snapshot.championEntryId, '2');
    assert.deepEqual(snapshot.winners.map(row => [row.rank, row.address, row.score, row.peakMultiple, row.ethWei, row.halfPasses, row.champion]), [
      [1, PLAYER_B, String(500n * FLIP), '10.00', '700', '1', true],
      [2, PLAYER_A, String(300n * FLIP), '2.00', '300', '0', false],
    ]);
    assert.deepEqual(snapshot.you, {
      entryId: '1', address: PLAYER_A, coin: 'heads', stack: String(150n * FLIP), chips: 9,
      peak: String(6_000n * FLIP), peakMultiple: '2.00', score: String(300n * FLIP),
      rank: 2, winner: true, ethWei: '300', halfPasses: '0',
    });
    const tails = buildDecimatorDrawSnapshot({ level, player: PLAYER_C, gameLogs: [...burnLogs, resolutionLog, ...settleLogs], flipLogs });
    assert.equal(tails.you.coin, 'tails');
    assert.equal(tails.you.winner, false);
    assert.equal(tails.you.peak, null);
  });

  test('an unsealed level is still syncing', () => {
    assert.throws(() => buildDecimatorDrawSnapshot({ level, player: PLAYER_A, gameLogs: burnLogs, flipLogs }), /not indexed/);
  });

  test('loader bounds entries to the seal and settlement to after it', async () => {
    const calls = [];
    __setDecimatorDrawProviderForTest({
      async getBlockNumber() { return 17; },
      async getLogs(filter) {
        calls.push(filter);
        if (filter.topics.length === 2) return [resolutionLog];
        if (filter.topics.length === 3) return burnLogs;
        if (Array.isArray(filter.topics[0])) return settleLogs;
        return flipLogs;
      },
    });
    const snapshot = await loadDecimatorDrawSnapshot({ level, player: PLAYER_A, fromBlock: 10 });
    assert.equal(snapshot.winners.length, 2);
    assert.ok(calls.every((call) => Number.isInteger(call.fromBlock) && Number.isInteger(call.toBlock)),
      'every log query is numerically bounded');
    const burns = calls.find(call => call.topics.length === 3);
    assert.deepEqual([burns.fromBlock, burns.toBlock], [10, 14], 'entries close at the seal');
    const settle = calls.find(call => Array.isArray(call.topics[0]));
    assert.deepEqual([settle.fromBlock, settle.toBlock], [14, 17], 'runs, ranking and credits follow it');
  });

  test('loader scans large ranges in chunks below the public RPC cap', async () => {
    const calls = [];
    __setDecimatorDrawProviderForTest({
      async getBlockNumber() { return 4_000; },
      async getLogs(filter) {
        calls.push(filter);
        const includes = block => Number(filter.fromBlock) <= block && Number(filter.toBlock) >= block;
        if (filter.topics.length === 2) return includes(14) ? [resolutionLog] : [];
        if (filter.topics.length === 3) return includes(10) ? burnLogs : [];
        if (Array.isArray(filter.topics[0])) return includes(15) ? settleLogs : [];
        return flipLogs;
      },
    });
    const snapshot = await loadDecimatorDrawSnapshot({ level, player: PLAYER_A, fromBlock: 10 });
    assert.equal(snapshot.winners.length, 2);
    assert.ok(calls.length > 3, 'the resolution search walks newest chunks first');
    assert.ok(calls.every((call) => Number(call.toBlock) - Number(call.fromBlock) + 1 <= 1_800),
      'no eth_getLogs request exceeds the Base public range limit');
    assert.ok(calls.every((call) => call.toBlock !== 'latest'),
      'the draw never sends a deployment-to-latest log query');
  });
});
