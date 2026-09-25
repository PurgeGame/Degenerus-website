import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastDayHasWinnerEvidence,
  lastDayPayloadNeedsRecheck,
  normalizeLastDayPayload,
} from '../last-day-state.js';

const emptySummary = {
  blockRange: { start: '100', end: '199' },
  rollOne: { eth: [], tickets: [], solo: null },
  rollTwo: { coin: [], bonusDraw: [], farFuture: { winnerCount: 0 } },
  baf: {
    eth: { winnerCount: 0 },
    tickets: { winnerCount: 0 },
  },
  decimator: {
    regular: { claimCount: 0 },
    terminal: { claimCount: 0 },
  },
};

describe('last-day composition consistency', () => {
  test('a summary winner count defeats a stale empty winner fragment', () => {
    const payload = {
      day: 234,
      status: 'resolved-no-winners',
      winners: [],
      summary: {
        ...emptySummary,
        rollOne: {
          ...emptySummary.rollOne,
          eth: [{ traitId: 16, winnerCount: 20, uniqueCount: 17 }],
        },
      },
    };

    assert.equal(lastDayHasWinnerEvidence(payload), true);
    assert.equal(normalizeLastDayPayload(payload).status, 'resolved');
    assert.equal(lastDayPayloadNeedsRecheck(payload), true);
  });

  test('roll fragments are also direct winner evidence', () => {
    const payload = {
      day: 234,
      status: 'resolved-no-winners',
      winners: [],
      summary: null,
      roll1: { wins: [{ winner: '0xabc' }] },
      roll2: { wins: [] },
    };
    assert.equal(normalizeLastDayPayload(payload).status, 'resolved');
    assert.equal(lastDayPayloadNeedsRecheck(payload), true);
  });

  test('a complete zero-payout summary remains a definitive no-winner day', () => {
    const payload = {
      day: 235,
      status: 'resolved-no-winners',
      winners: [],
      summary: emptySummary,
      roll1: { wins: [] },
      roll2: { wins: [] },
    };
    assert.equal(lastDayHasWinnerEvidence(payload), false);
    assert.equal(normalizeLastDayPayload(payload), payload);
    assert.equal(lastDayPayloadNeedsRecheck(payload), false);
  });

  test('an empty status without a complete summary stays retryable', () => {
    const payload = {
      day: 236,
      status: 'resolved-no-winners',
      winners: [],
      summary: null,
      roll1: { wins: [] },
      roll2: { wins: [] },
    };
    assert.equal(lastDayPayloadNeedsRecheck(payload), true);
  });
});

test('replay reuses only complete sealed results for the exact selected day', async () => {
  const { reusableJackpotPayload } = await import('../last-day-state.js');
  const payload = {
    day: 42, status: 'resolved',
    summary: { blockRange: { start: '100', end: '110' } },
    winners: [{ address: '0xabc', breakdown: [] }],
    roll1: { day: 42, wins: [] }, roll2: { day: 42, wins: [] },
  };
  assert.equal(reusableJackpotPayload(payload, 42), payload);
  assert.equal(reusableJackpotPayload(payload, 43), null);
  assert.equal(reusableJackpotPayload({ ...payload, status: 'processing' }, 42), null);
  assert.equal(reusableJackpotPayload({ ...payload, summary: { blockRange: { start: '100' } } }, 42), null);
  assert.equal(reusableJackpotPayload({ ...payload, roll2: null }, 42), null);
  assert.equal(reusableJackpotPayload({ ...payload, roll2: { day: 41, wins: [] } }, 42), null);
  assert.equal(reusableJackpotPayload({ ...payload, winners: [], roll1: { day: 42, wins: [{ amount: '1' }] } }, 42), null);
});
