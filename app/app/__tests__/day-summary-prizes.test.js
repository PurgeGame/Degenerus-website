// Run: node --test app/app/__tests__/day-summary-prizes.test.js

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDaySummaryPrizes } from '../day-summary-prizes.js';

describe('Day Summary level-transition prizes', () => {
  test('recovers grouped BAF amounts when the aggregate is zero and keeps Decimator distinct', () => {
    const prizes = buildDaySummaryPrizes({
      totalEth: '125070000000000',
      ticketCount: 0,
      coinTotal: '0',
      winningLevel: 200,
      bafPrize: { eth: '0', tickets: 0 },
      decimatorPrize: {
        regularEth: '1537350828834',
        lootboxEth: '1537350828835',
        terminalEth: '0',
      },
      breakdown: [
        { awardType: 'eth', amount: '1', count: 2, traitId: 33, level: 200 },
        { awardType: 'eth_baf', amount: '48078170005750', count: 3, traitId: 420, level: 200 },
      ],
    });

    assert.deepEqual(prizes, [
      { type: 'eth', amount: 125070000000000n, winningTraitIds: [33] },
      { type: 'baf', amount: 144234510017250n, level: 200 },
      {
        type: 'decimator',
        amount: 1537350828834n,
        lootboxAmount: 1537350828835n,
        terminalAmount: 0n,
      },
    ]);
  });

  test('turns grouped BAF ticket entries into one explicit BAF ticket card', () => {
    const prizes = buildDaySummaryPrizes({
      totalEth: '0', ticketCount: 0, coinTotal: '0', winningLevel: 60,
      bafPrize: { eth: '0', tickets: 0 },
      decimatorPrize: {},
      breakdown: [
        { awardType: 'tickets_baf', amount: '68', count: 2, traitId: 420, level: 64 },
        { awardType: 'tickets_baf', amount: '64', count: 1, traitId: 420, level: 61 },
      ],
    });

    assert.deepEqual(prizes, [{ type: 'baf-tickets', amount: 50n, level: 64 }]);
  });
});
