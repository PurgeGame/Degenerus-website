import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoll1BucketSummaries,
  buildRoll2BucketSummaries,
  splitOpeningFlipDraw,
} from '../jackpot-buckets.js';

test('buildRoll1BucketSummaries reports per-entry ETH and winning-entry count', () => {
  const rows = [
    { awardType: 'eth', traitId: 13, winner: '0xA', amount: '120' },
    { awardType: 'eth', traitId: 13, winner: '0xB', amount: '120' },
    { awardType: 'eth', traitId: 77, winner: '0xA', amount: '900' },
  ];

  assert.deepEqual(buildRoll1BucketSummaries(rows, [13, 77]), [
    {
      traitId: 13,
      winnerCount: 2,
      uniqueWinnerCount: 2,
      perWinWei: 120n,
      ticketWinnerCount: 0,
      ticketUniqueWinnerCount: 0,
      ticketEntriesTotal: 0n,
      ticketEntriesPerWinner: 0n,
    },
    {
      traitId: 77,
      winnerCount: 1,
      uniqueWinnerCount: 1,
      perWinWei: 900n,
      ticketWinnerCount: 0,
      ticketUniqueWinnerCount: 0,
      ticketEntriesTotal: 0n,
      ticketEntriesPerWinner: 0n,
    },
  ]);
});

test('multiple winning entries from one wallet still count separately', () => {
  const rows = [
    { awardType: 'eth', traitId: 9, winner: '0xA', amount: '50' },
    { awardType: 'eth', traitId: 9, winner: '0xa', amount: '50' },
  ];
  const [summary] = buildRoll1BucketSummaries(rows, [9]);

  assert.equal(summary.winnerCount, 2);
  assert.equal(summary.uniqueWinnerCount, 1);
  assert.equal(summary.perWinWei, 50n);
});

test('companion prizes do not inflate the displayed per-win ETH amount', () => {
  const rows = [
    { awardType: 'eth', traitId: 42, winner: '0xA', amount: '75' },
    { awardType: 'whale_pass', traitId: null, winner: '0xA', amount: '1' },
    { awardType: 'tickets', traitId: 42, winner: '0xA', amount: '4' },
  ];
  const [summary] = buildRoll1BucketSummaries(rows, [42]);

  assert.equal(summary.winnerCount, 1);
  assert.equal(summary.perWinWei, 75n);
  assert.equal(summary.ticketWinnerCount, 1);
  assert.equal(summary.ticketUniqueWinnerCount, 1);
  assert.equal(summary.ticketEntriesTotal, 4n);
  assert.equal(summary.ticketEntriesPerWinner, 4n);
});

test('drawn buckets with no winners render as zero ETH times zero', () => {
  assert.deepEqual(buildRoll1BucketSummaries([], [1]), [{
    traitId: 1,
    winnerCount: 0,
    uniqueWinnerCount: 0,
    perWinWei: 0n,
    ticketWinnerCount: 0,
    ticketUniqueWinnerCount: 0,
    ticketEntriesTotal: 0n,
    ticketEntriesPerWinner: 0n,
  }]);
});

test('an unavailable roll response stays unknown instead of inventing zeroes', () => {
  assert.deepEqual(buildRoll1BucketSummaries(null, [1, 2]), [null, null]);
});

test('opening Roll 1 reports FLIP, including a drawn bucket with no winners', () => {
  const rows = [
    { awardType: 'flip', traitId: 30, winner: '0xA', amount: '187' },
    { awardType: 'flip', traitId: 30, winner: '0xB', amount: '187' },
  ];
  assert.deepEqual(buildRoll1BucketSummaries(rows, [30, 88], 'FLIP'), [
    {
      traitId: 30,
      winnerCount: 2,
      uniqueWinnerCount: 2,
      perWinWei: 187n,
      ticketWinnerCount: 0,
      ticketUniqueWinnerCount: 0,
      ticketEntriesTotal: 0n,
      ticketEntriesPerWinner: 0n,
      currency: 'FLIP',
    },
    {
      traitId: 88,
      winnerCount: 0,
      uniqueWinnerCount: 0,
      perWinWei: 0n,
      ticketWinnerCount: 0,
      ticketUniqueWinnerCount: 0,
      ticketEntriesTotal: 0n,
      ticketEntriesPerWinner: 0n,
      currency: 'FLIP',
    },
  ]);
});

test('opening double-FLIP rows split by persisted traits and target-level ranges', () => {
  const mainRow = { awardType: 'flip', traitId: 30, level: 1, winner: '0xA', amount: '187' };
  const wrongMainTrait = { awardType: 'flip', traitId: 31, level: 1, winner: '0xB', amount: '187' };
  const bonusRow = { awardType: 'flip', traitId: 73, level: 4, winner: '0xC', amount: '187' };
  const farFuture = { awardType: 'flip', traitId: null, level: 1, winner: '0xD', amount: '312' };
  const ethNoise = { awardType: 'eth', traitId: 30, level: 1, winner: '0xE', amount: '999' };

  assert.deepEqual(
    splitOpeningFlipDraw(
      [mainRow, wrongMainTrait, bonusRow, farFuture, ethNoise],
      [30, 88, 144, 218],
      [11, 73, 179, 200],
    ),
    { mainWins: [mainRow], bonusWins: [bonusRow, farFuture] },
  );
});

test('buildRoll2BucketSummaries exposes public FLIP per win and entry count', () => {
  const rows = [
    { awardType: 'flip', traitId: 11, winner: '0xA', amount: '900' },
    { awardType: 'flip', traitId: 11, winner: '0xa', amount: '900' },
    { awardType: 'flip', traitId: 74, winner: '0xB', amount: '1200' },
    { awardType: 'tickets', traitId: 11, winner: '0xA', amount: '4' },
    { awardType: 'tickets', traitId: 11, winner: '0xB', amount: '8' },
    { awardType: 'flip', traitId: null, winner: '0xC', amount: '5000' },
  ];

  assert.deepEqual(buildRoll2BucketSummaries(rows, [11, 74, 174]), [
    {
      traitId: 11,
      winnerCount: 2,
      uniqueWinnerCount: 1,
      perWinWei: 900n,
      currency: 'FLIP',
      ticketWinnerCount: 2,
      ticketUniqueWinnerCount: 2,
      ticketEntriesTotal: 12n,
      ticketEntriesPerWinner: 6n,
    },
    {
      traitId: 74,
      winnerCount: 1,
      uniqueWinnerCount: 1,
      perWinWei: 1200n,
      currency: 'FLIP',
      ticketWinnerCount: 0,
      ticketUniqueWinnerCount: 0,
      ticketEntriesTotal: 0n,
      ticketEntriesPerWinner: 0n,
    },
    {
      traitId: 174,
      winnerCount: 0,
      uniqueWinnerCount: 0,
      perWinWei: 0n,
      currency: 'FLIP',
      ticketWinnerCount: 0,
      ticketUniqueWinnerCount: 0,
      ticketEntriesTotal: 0n,
      ticketEntriesPerWinner: 0n,
    },
  ]);
});
