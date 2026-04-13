// Plan 39-09: ticketSubRow propagation in rebucketRoll2BySlot
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rebucketRoll2BySlot } from '../jackpot-rolls.js';

function pack(bytes) {
  return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
}

test('rebucketRoll2BySlot attaches ticketSubRow to bonus slot when trait has ticket rows', () => {
  const bonus = pack([10, 20, 30, 40]);
  const roll2 = {
    future: [{
      traitId: 20, winnerCount: 1, coinPerWinner: '1000', ethPerWinner: '0',
      ticketsPerWinner: 0,
      ticketSubRow: { wins: 5, amountPerWin: '5' },
    }],
    farFuture: [],
  };
  const slots = rebucketRoll2BySlot(roll2, bonus);
  assert.equal(slots.length, 5);
  assert.equal(slots[1].traitId, 20);
  assert.deepEqual(slots[1].ticketSubRow, { wins: 5, amountPerWin: '5' });
  assert.equal(slots[0].ticketSubRow, null); // empty slot
  assert.equal(slots[4].ticketSubRow, null); // far-future never has tickets
});

test('rebucketRoll2BySlot ticketSubRow null when no ticket row exists', () => {
  const bonus = pack([10, 20, 30, 40]);
  const roll2 = {
    future: [{
      traitId: 20, winnerCount: 1, coinPerWinner: '1000', ethPerWinner: '0',
      ticketsPerWinner: 0,
      ticketSubRow: null,
    }],
    farFuture: [],
  };
  const slots = rebucketRoll2BySlot(roll2, bonus);
  assert.equal(slots[1].ticketSubRow, null);
});

test('rebucketRoll2BySlot picks first non-null ticketSubRow when multiple rows for same traitId', () => {
  const bonus = pack([10, 20, 30, 40]);
  const roll2 = {
    future: [
      { traitId: 20, winnerCount: 1, coinPerWinner: '0', ticketsPerWinner: 0, ticketSubRow: null },
      { traitId: 20, winnerCount: 1, coinPerWinner: '500', ticketsPerWinner: 3, ticketSubRow: { wins: 3, amountPerWin: '3' } },
    ],
    farFuture: [],
  };
  const slots = rebucketRoll2BySlot(roll2, bonus);
  assert.deepEqual(slots[1].ticketSubRow, { wins: 3, amountPerWin: '3' });
});

test('rebucketRoll2BySlot: empty bonus slots have ticketSubRow null', () => {
  const slots = rebucketRoll2BySlot({ future: [], farFuture: [] }, null);
  for (let i = 0; i < 5; i++) assert.equal(slots[i].ticketSubRow, null);
});
