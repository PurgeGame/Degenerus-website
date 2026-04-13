/**
 * rebucket-roll2.test.js — Unit tests for rebucketRoll2BySlot helper.
 *
 * Plan: 39-07 (supersedes 39-05 contract)
 *
 * Roll 2 is now bonus-only: 4 bonus-card slots (from bonusTraitsPacked) + 1
 * far-future center row. Main-card wins belong exclusively to Roll 1 and are
 * never rendered by Roll 2. Future rows whose traitId is not one of the 4
 * bonus bytes are silently dropped.
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

test('Test 1: returns exactly 5 entries in fixed order bonus[0..3], farFuture', () => {
  const bonus = pack(0x50, 0x60, 0x70, 0x80);
  const out = rebucketRoll2BySlot({ future: [], farFuture: [] }, bonus);
  assert.equal(out.length, 5);
  assert.equal(out[0].traitId, 0x50);
  assert.equal(out[1].traitId, 0x60);
  assert.equal(out[2].traitId, 0x70);
  assert.equal(out[3].traitId, 0x80);
  assert.equal(out[4].isFarFuture, true);
});

test('Test 2: each slot has the required shape', () => {
  const bonus = pack(0x10, 0x20, 0x30, 0x40);
  const out = rebucketRoll2BySlot({ future: [], farFuture: [] }, bonus);
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
  const bonus = pack(0x50, 0x60, 0x70, 0x80);
  const out = rebucketRoll2BySlot({ future: [], farFuture: [] }, bonus);
  for (let i = 0; i < 4; i++) {
    assert.equal(out[i].wins, 0);
    assert.equal(out[i].amountPerWin, '0');
    assert.equal(out[i].isEmpty, true);
  }
});

test('Test 4: rows sharing same traitId collapse into the bonus slot; mismatched traitIds do not leak', () => {
  // Slot 0 traitId = tid(1, 2, 3) = 64 + 16 + 3 = 83
  const slotTid = tid(1, 2, 3);
  const bonus = pack(slotTid, 0, 0, 0);
  const otherTid = tid(1, 2, 5); // same q/s different color — must NOT collapse
  const future = [
    { traitId: slotTid, winnerCount: 2, coinPerWinner: '1000', ethPerWinner: '0', ticketsPerWinner: 0 },
    { traitId: slotTid, winnerCount: 3, coinPerWinner: '1000', ethPerWinner: '0', ticketsPerWinner: 0 },
    { traitId: otherTid, winnerCount: 7, coinPerWinner: '9999', ethPerWinner: '0', ticketsPerWinner: 0 },
  ];
  const out = rebucketRoll2BySlot({ future, farFuture: [] }, bonus);
  assert.equal(out[0].wins, 5);
  assert.equal(out[0].amountPerWin, '1000');
  assert.equal(out[0].isEmpty, false);
  // Slot 1 byte = 0; tid=0 mismatches otherTid so no contribution
  assert.equal(out[1].wins, 0);
});

test('Test 5: far-future aggregates ALL farFuture rows regardless of traitId', () => {
  const farFuture = [
    { traitId: 17, winnerCount: 2, coinPerWinner: '500', ethPerWinner: '0' },
    { traitId: 99, winnerCount: 3, coinPerWinner: '500', ethPerWinner: '0' },
    { traitId: 200, winnerCount: 1, coinPerWinner: '500', ethPerWinner: '0' },
  ];
  const out = rebucketRoll2BySlot({ future: [], farFuture }, null);
  const ff = out[4];
  assert.equal(ff.isFarFuture, true);
  assert.equal(ff.wins, 6);
  assert.equal(ff.amountPerWin, '500');
});

test('Test 6: null bonusPacked produces 4 empty slots with null traitId; far-future still aggregates', () => {
  const farFuture = [
    { traitId: 42, winnerCount: 4, coinPerWinner: '777', ethPerWinner: '0' },
  ];
  const out = rebucketRoll2BySlot({ future: [], farFuture }, null);
  assert.equal(out.length, 5);
  for (let i = 0; i < 4; i++) {
    assert.equal(out[i].traitId, null);
    assert.equal(out[i].isEmpty, true);
  }
  assert.equal(out[4].wins, 4);
  assert.equal(out[4].amountPerWin, '777');
  assert.equal(out[4].isFarFuture, true);
});

test('Test 7: slot entries expose quadrant/symbolIdx/colorIdx derived from traitId', () => {
  // cards quadrant = 2, symbolIdx=0 → traitId = 128 + 0*8 + 1 = 129, colorIdx=1
  const cardsTid = tid(2, 0, 1);
  const bonus = pack(cardsTid, 0, 0, 0);
  const out = rebucketRoll2BySlot({ future: [], farFuture: [] }, bonus);
  assert.equal(out[0].quadrant, 2);
  assert.equal(out[0].symbolIdx, 0); // raw symbolIdx — NOT CARD_IDX-remapped; joBadgePath does the remap
  assert.equal(out[0].colorIdx, 1);
});

test('Test 8: future rows whose traitId matches a main-card slot are dropped (never appear in 5-row output)', () => {
  // Bonus slots = 4 distinct bytes
  const bonus = pack(0x50, 0x60, 0x70, 0x80);
  // A "main" traitId (hypothetically packed into mainTraitsPacked server-side)
  // that is NOT in bonusPacked — helper must silently drop it.
  const mainTid = 0x10;
  const future = [
    { traitId: mainTid, winnerCount: 3, coinPerWinner: '5', ethPerWinner: '0', ticketsPerWinner: 0 },
  ];
  const out = rebucketRoll2BySlot({ future, farFuture: [] }, bonus);
  assert.equal(out.length, 5);
  // None of the 5 rows should have traitId === mainTid
  for (const slot of out) {
    assert.notEqual(slot.traitId, mainTid);
  }
  // No row's `wins` accounts for the 3 dropped wins
  const bonusWinsTotal = out.slice(0, 4).reduce((n, s) => n + s.wins, 0);
  assert.equal(bonusWinsTotal, 0);
  // Far-future only aggregates farFuture[], not future[]
  assert.equal(out[4].wins, 0);
});

test('Test 9: symmetric-separation canary — future rows with arbitrary traitId not in bonus are dropped', () => {
  const bonus = pack(0x50, 0x60, 0x70, 0x80);
  const strangerTid = 0xAA; // not in bonus, not "main", just orphan
  const future = [
    { traitId: strangerTid, winnerCount: 99, coinPerWinner: '1', ethPerWinner: '0', ticketsPerWinner: 0 },
  ];
  const out = rebucketRoll2BySlot({ future, farFuture: [] }, bonus);
  assert.equal(out.length, 5);
  for (const slot of out) {
    assert.notEqual(slot.traitId, strangerTid);
  }
  const total = out.reduce((n, s) => n + s.wins, 0);
  assert.equal(total, 0);
});
