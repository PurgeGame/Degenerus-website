/**
 * rebucket-roll2.test.js — Unit tests for rebucketRoll2BySlot helper.
 *
 * Plan: 39-05 Task 2
 *
 * Covers Gap A from 39-UAT.md: Roll 2 shows per-raw-traitId rows producing
 * duplicates; the new helper aggregates to 8 symbol slots (from
 * mainTraitsPacked + bonusTraitsPacked) + 1 far-future center row.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rebucketRoll2BySlot } from '../jackpot-rolls.js';

// Helpers -------------------------------------------------------------------

function pack(b0, b1, b2, b3) {
  // 32-bit unsigned: bytes in least-significant-first order matching unpack.
  return ((b3 & 0xFF) << 24) | ((b2 & 0xFF) << 16) | ((b1 & 0xFF) << 8) | (b0 & 0xFF);
}

// traitId = quadrant*64 + symbolIdx*8 + colorIdx
function tid(q, s, c) { return (q * 64) + (s * 8) + c; }

// ---------------------------------------------------------------------------

test('Test 1: returns exactly 9 entries in fixed order main[0..3], bonus[0..3], farFuture', () => {
  const main = pack(0x10, 0x20, 0x30, 0x40);
  const bonus = pack(0x50, 0x60, 0x70, 0x80);
  const out = rebucketRoll2BySlot({ future: [], farFuture: [] }, main, bonus);
  assert.equal(out.length, 9);
  assert.equal(out[0].traitId, 0x10);
  assert.equal(out[1].traitId, 0x20);
  assert.equal(out[2].traitId, 0x30);
  assert.equal(out[3].traitId, 0x40);
  assert.equal(out[4].traitId, 0x50);
  assert.equal(out[5].traitId, 0x60);
  assert.equal(out[6].traitId, 0x70);
  assert.equal(out[7].traitId, 0x80);
  assert.equal(out[8].isFarFuture, true);
});

test('Test 2: each slot has the required shape', () => {
  const main = pack(0x10, 0x20, 0x30, 0x40);
  const out = rebucketRoll2BySlot({ future: [], farFuture: [] }, main, null);
  for (const slot of out) {
    assert.ok('traitId' in slot);
    assert.ok('quadrant' in slot);
    assert.ok('symbolIdx' in slot);
    assert.ok('colorIdx' in slot);
    assert.equal(typeof slot.wins, 'number');
    assert.equal(typeof slot.amountPerWin, 'string');
    assert.equal(typeof slot.isEmpty, 'boolean');
    assert.equal(typeof slot.isFarFuture, 'boolean');
  }
});

test('Test 3: unmatched slots have wins=0 amountPerWin="0" isEmpty=true', () => {
  const main = pack(0x10, 0x20, 0x30, 0x40);
  const bonus = pack(0x50, 0x60, 0x70, 0x80);
  const out = rebucketRoll2BySlot({ future: [], farFuture: [] }, main, bonus);
  for (let i = 0; i < 8; i++) {
    assert.equal(out[i].wins, 0);
    assert.equal(out[i].amountPerWin, '0');
    assert.equal(out[i].isEmpty, true);
  }
});

test('Test 4: rows sharing same (quadrant, symbolIdx) collapse into the slot whose traitId matches packed byte', () => {
  // Slot 0 traitId = tid(1, 2, 3) = 64 + 16 + 3 = 83
  const slotTid = tid(1, 2, 3);
  const main = pack(slotTid, 0, 0, 0);
  const otherTid = tid(1, 2, 5); // same q/s different color — must NOT collapse
  const future = [
    { traitId: slotTid, winnerCount: 2, coinPerWinner: '1000', ethPerWinner: '0', ticketsPerWinner: 0 },
    { traitId: slotTid, winnerCount: 3, coinPerWinner: '1000', ethPerWinner: '0', ticketsPerWinner: 0 },
    { traitId: otherTid, winnerCount: 7, coinPerWinner: '9999', ethPerWinner: '0', ticketsPerWinner: 0 },
  ];
  const out = rebucketRoll2BySlot({ future, farFuture: [] }, main, null);
  assert.equal(out[0].wins, 5);
  assert.equal(out[0].amountPerWin, '1000');
  assert.equal(out[0].isEmpty, false);
  // Other slot (from main byte 0) — tid=0, no contribution from otherTid since tid mismatches
  assert.equal(out[1].wins, 0);
});

test('Test 5: far-future aggregates ALL farFuture rows regardless of traitId', () => {
  const farFuture = [
    { traitId: 17, winnerCount: 2, coinPerWinner: '500', ethPerWinner: '0' },
    { traitId: 99, winnerCount: 3, coinPerWinner: '500', ethPerWinner: '0' },
    { traitId: 200, winnerCount: 1, coinPerWinner: '500', ethPerWinner: '0' },
  ];
  const out = rebucketRoll2BySlot({ future: [], farFuture }, null, null);
  const ff = out[8];
  assert.equal(ff.isFarFuture, true);
  assert.equal(ff.wins, 6);
  assert.equal(ff.amountPerWin, '500');
});

test('Test 6: null mainPacked/bonusPacked produces empty slots with null traitId; far-future still aggregates', () => {
  const farFuture = [
    { traitId: 42, winnerCount: 4, coinPerWinner: '777', ethPerWinner: '0' },
  ];
  const out = rebucketRoll2BySlot({ future: [], farFuture }, null, null);
  for (let i = 0; i < 8; i++) {
    assert.equal(out[i].traitId, null);
    assert.equal(out[i].isEmpty, true);
  }
  assert.equal(out[8].wins, 4);
  assert.equal(out[8].amountPerWin, '777');
  assert.equal(out[8].isFarFuture, true);
});

test('Test 7: slot entries expose quadrant/symbolIdx/colorIdx derived from traitId (CARD_IDX applied in joBadgePath, not here)', () => {
  // cards quadrant = 2, symbolIdx=0 → traitId = 128 + 0*8 + 1 = 129, colorIdx=1
  const cardsTid = tid(2, 0, 1);
  const main = pack(cardsTid, 0, 0, 0);
  const out = rebucketRoll2BySlot({ future: [], farFuture: [] }, main, null);
  assert.equal(out[0].quadrant, 2);
  assert.equal(out[0].symbolIdx, 0); // raw symbolIdx — NOT CARD_IDX-remapped; joBadgePath does the remap
  assert.equal(out[0].colorIdx, 1);
});
