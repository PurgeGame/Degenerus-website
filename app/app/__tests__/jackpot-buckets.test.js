// Run: node --test app/app/__tests__/jackpot-buckets.test.js

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoll1BucketSummaries,
  buildRoll2BucketSummaries,
  splitOpeningFlipDraw,
} from '../jackpot-buckets.js';
import { joScaledToTickets } from '../jackpot-rolls.js';
import { formatEthTruncated } from '../../viewer/utils.js';

const PLAYER = '0xab12000000000000000000000000000000000000';
const PER_WIN = 1_071n * 10n ** 18n;

function rows(count, row) {
  return Array.from({ length: count }, (_, index) => ({
    winner: `${PLAYER.slice(0, -2)}${String(index % 99).padStart(2, '0')}`,
    ...row,
  }));
}

describe('public jackpot bucket summaries', () => {
  test('solo jackpot ETH truncates to tenths and drops decimals at 1,000', () => {
    assert.equal(formatEthTruncated('12390000000000'), '12.3');
    assert.equal(formatEthTruncated('999990000000000'), '999.9',
      '999.99 cannot round up into the four-digit tier');
    assert.equal(formatEthTruncated('1000990000000000'), '1,000');
    assert.equal(formatEthTruncated('1234990000000000'), '1,234');
    assert.equal(formatEthTruncated('50000000000'), '<0.1',
      'a small positive payout never presents as zero');
  });

  test('entry awards remain exact quarter-ticket quantities', () => {
    assert.equal(joScaledToTickets(1), 0.25);
    assert.equal(joScaledToTickets(13), 3.25);
    assert.equal(joScaledToTickets('14'), 3.5);
    assert.equal(joScaledToTickets(0), 0);
  });

  test('keeps currency winner counts separate from independently eligible ticket buckets', () => {
    const wins = [
      ...rows(13, { traitId: 48, awardType: 'flip', currency: 'FLIP', amount: PER_WIN }),
      ...rows(9, { traitId: 122, awardType: 'flip', currency: 'FLIP', amount: PER_WIN }),
      ...rows(12, { traitId: 140, awardType: 'flip', currency: 'FLIP', amount: PER_WIN }),
      ...rows(12, { traitId: 224, awardType: 'flip', currency: 'FLIP', amount: PER_WIN }),
      ...rows(34, { traitId: 48, awardType: 'tickets', amount: 13 }),
      ...rows(16, { traitId: 140, awardType: 'tickets', amount: 13 }),
      ...rows(17, { traitId: 140, awardType: 'tickets', amount: 14 }),
      ...rows(33, { traitId: 224, awardType: 'tickets', amount: 13 }),
    ];

    const [first, inactiveTicketBucket, mixed, fourth] = buildRoll2BucketSummaries(
      wins,
      [48, 122, 140, 224],
    );

    assert.deepEqual(
      [first.winnerCount, inactiveTicketBucket.winnerCount, mixed.winnerCount, fourth.winnerCount],
      [13, 9, 12, 12],
      'the FLIP multiplier is the number of winning entries, not a reduced per-win payout',
    );
    assert.equal(inactiveTicketBucket.perWinWei, PER_WIN);
    assert.equal(inactiveTicketBucket.ticketWinnerCount, 0,
      'a trait can win FLIP while having no eligible source-level ticket bucket');
    assert.deepEqual(
      [first.ticketWinnerCount, mixed.ticketWinnerCount, fourth.ticketWinnerCount],
      [34, 33, 33],
      'the 100 ticket winners redistribute only across eligible buckets',
    );
    assert.deepEqual(
      [mixed.ticketEntriesMin, mixed.ticketEntriesMax],
      [13n, 14n],
      'mixed awards retain the exact 3.25–3.5 ticket range instead of an averaged integer',
    );
  });

  test('roll 1 exposes the same min/max contract for replay rendering', () => {
    const [summary] = buildRoll1BucketSummaries([
      ...rows(2, { traitId: 7, awardType: 'eth', amount: 5n }),
      ...rows(1, { traitId: 7, awardType: 'tickets', amount: 13 }),
      ...rows(1, { traitId: 7, awardType: 'tickets', amount: 14 }),
    ], [7]);

    assert.equal(summary.ticketEntriesMin, 13n);
    assert.equal(summary.ticketEntriesMax, 14n);
  });

  test('opening level FLIP distributions rebuild nonzero main quadrants', () => {
    const mainTraits = [4, 117, 130, 228];
    const bonusTraits = [42, 106, 152, 248];
    const distributions = [
      ...rows(13, { level: 1, traitId: 4, awardType: 'flip', amount: 100n }),
      ...rows(13, { level: 1, traitId: 117, awardType: 'flip', amount: 100n }),
      ...rows(12, { level: 1, traitId: 130, awardType: 'flip', amount: 100n }),
      ...rows(12, { level: 1, traitId: 228, awardType: 'flip', amount: 100n }),
      ...rows(10, { level: 2, traitId: 42, awardType: 'flip', amount: 100n }),
      { level: 1, traitId: null, awardType: 'flip', amount: 300n, winner: PLAYER },
    ];

    const { mainWins, bonusWins } = splitOpeningFlipDraw(
      distributions,
      mainTraits,
      bonusTraits,
    );
    const summaries = buildRoll1BucketSummaries(mainWins, mainTraits, 'FLIP');

    assert.deepEqual(
      summaries.map(({ winnerCount, perWinWei, currency }) => ({
        winnerCount,
        perWinWei,
        currency,
      })),
      [
        { winnerCount: 13, perWinWei: 100n, currency: 'FLIP' },
        { winnerCount: 13, perWinWei: 100n, currency: 'FLIP' },
        { winnerCount: 12, perWinWei: 100n, currency: 'FLIP' },
        { winnerCount: 12, perWinWei: 100n, currency: 'FLIP' },
      ],
      'the level-1 board uses its hydrated FLIP rows instead of the empty Roll 1 response',
    );
    assert.equal(bonusWins.length, 11,
      'future-trait and center awards stay on the opening bonus draw');
  });
});
