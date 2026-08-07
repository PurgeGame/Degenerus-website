import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from '../../app/contracts.js';
import {
  __resetDecimatorDrawProviderForTest,
  __setDecimatorDrawProviderForTest,
  buildDecimatorDrawSnapshot,
  loadDecimatorDrawSnapshot,
  unpackDecimatorWinningSubbuckets,
} from '../decimator-draw-data.js';

const game = new ethers.Interface([
  'event DecBurnRecorded(address indexed player,uint24 indexed lvl,uint8 bucket,uint8 subBucket,uint256 effectiveAmount,uint256 newTotalBurn)',
  'event DecimatorResolved(uint24 indexed lvl,uint64 packedOffsets,uint256 poolWei,uint256 totalBurn)',
]);
const flip = new ethers.Interface([
  'event DecimatorBurn(address indexed player,uint256 amountBurned,uint8 bucket)',
]);

const PLAYER_A = '0x00000000000000000000000000000000000000a1';
const PLAYER_B = '0x00000000000000000000000000000000000000b2';
const PLAYER_C = '0x00000000000000000000000000000000000000c3';

function log(iface, event, args, blockNumber, index = 0) {
  const encoded = iface.encodeEventLog(iface.getEvent(event), args);
  return {
    data: encoded.data,
    topics: encoded.topics,
    blockNumber,
    index,
    blockHash: `0x${String(blockNumber).padStart(64, '0')}`,
  };
}

function packedOffsets(entries) {
  let packed = 0n;
  for (const [bucket, subbucket] of Object.entries(entries)) {
    packed |= BigInt(subbucket) << BigInt((Number(bucket) - 2) * 4);
  }
  return packed;
}

const level = 15;
const offsets = packedOffsets({ 6: 0, 7: 2 });
const burnLogs = [
  // A later record replaces this row: players can migrate buckets before lock.
  log(game, 'DecBurnRecorded', [PLAYER_A, level, 8, 1, 100n, 100n], 10),
  log(game, 'DecBurnRecorded', [PLAYER_B, level, 7, 2, 50n, 50n], 11),
  log(game, 'DecBurnRecorded', [PLAYER_C, level, 6, 1, 80n, 80n], 12),
  log(game, 'DecBurnRecorded', [PLAYER_A, level, 7, 2, 150n, 150n], 13),
];
const resolutionLog = log(
  game,
  'DecimatorResolved',
  [level, offsets, 1_000n, 280n],
  14,
);
const flipLogs = [
  log(flip, 'DecimatorBurn', [PLAYER_A, 70n, 7], 10),
  log(flip, 'DecimatorBurn', [PLAYER_B, 80n, 7], 11),
];

afterEach(() => __resetDecimatorDrawProviderForTest());

describe('Decimator draw log reconstruction', () => {
  test('decodes the contract packed winner offsets', () => {
    const winners = unpackDecimatorWinningSubbuckets(offsets);
    assert.equal(winners['6'], 0);
    assert.equal(winners['7'], 2);
    assert.equal(winners['12'], 0);
  });

  test('keeps each player final bucket and builds authoritative aggregate scores', () => {
    const snapshot = buildDecimatorDrawSnapshot({
      level,
      player: PLAYER_A,
      gameLogs: [...burnLogs, resolutionLog],
      flipLogs,
      ethDisplayScale: 1n,
      network: 'test',
      gameAddress: '0xgame',
    });

    assert.deepEqual(snapshot.subbucketTotals, [
      { bucket: 7, subbucket: 2, score: '200' },
      { bucket: 6, subbucket: 1, score: '80' },
    ]);
    assert.equal(snapshot.winningScore, '200');
    assert.equal(snapshot.totalFlipBurned, '150');
    assert.equal(snapshot.poolWei, '1000');
    assert.deepEqual(snapshot.winnerPlayers, [
      { address: PLAYER_A, bucket: 7, subbucket: 2, score: '150' },
      { address: PLAYER_B, bucket: 7, subbucket: 2, score: '50' },
    ]);
    assert.deepEqual(snapshot.players, [{
      address: PLAYER_A,
      bucket: 7,
      subbucket: 2,
      score: '150',
    }]);
    assert.ok(!snapshot.subbucketTotals.some((row) => row.bucket === 8),
      'the migrated player must not remain in their obsolete bucket');
  });

  test('loader requests level-indexed game logs and bounds raw FLIP burns to the resolution', async () => {
    const calls = [];
    __setDecimatorDrawProviderForTest({
      async getLogs(filter) {
        calls.push(filter);
        if (calls.length === 1) return [resolutionLog];
        if (calls.length === 2) return burnLogs;
        return flipLogs;
      },
    });

    const snapshot = await loadDecimatorDrawSnapshot({ level, player: PLAYER_A });
    assert.equal(snapshot.winningScore, '200');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].topics.length, 2, 'resolution query includes the indexed level');
    assert.equal(calls[1].topics.length, 3, 'burn query includes player wildcard + indexed level');
    assert.equal(calls[2].fromBlock, 10);
    assert.equal(calls[2].toBlock, 14);
  });
});
