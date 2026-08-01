// /app/app/__tests__/dgn-traits.test.js — shared Degenerette trait codecs.
// Run: cd website && node --test app/app/__tests__/dgn-traits.test.js
//
// Canonical byte: [QQ: bits 6-7 | CCC: bits 3-5 | SSS: bits 0-2] — the f47f106
// bit-swap class of bug is what these invariants pin down.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DGN_QUADRANTS, DGN_SYMBOLS, DGN_CARD_IDX, DGN_COLORS,
  dgnBadgePath, dgnUnpackTicket, dgnComputeMatches,
} from '../dgn-traits.js';

describe('dgnBadgePath', () => {
  test('crypto quadrant: file index == symbol index', () => {
    assert.equal(dgnBadgePath(0, 7, 7), '/badges-circular/crypto_07_bitcoin_gold.svg');
  });
  test('cards quadrant remaps symbol → legacy file index (load-bearing)', () => {
    // symbol 0 = club → file index DGN_CARD_IDX[0] = 3
    assert.equal(dgnBadgePath(2, 0, 2), '/badges-circular/cards_03_club_green.svg');
    // symbol 7 = ace → file index 7
    assert.equal(dgnBadgePath(2, 7, 0), '/badges-circular/cards_07_ace_pink.svg');
  });
  test('tables are the canonical sizes', () => {
    assert.equal(DGN_QUADRANTS.length, 4);
    assert.equal(DGN_COLORS.length, 8);
    assert.equal(DGN_CARD_IDX.length, 8);
    for (const q of DGN_QUADRANTS) assert.equal(DGN_SYMBOLS[q].length, 8);
  });
});

describe('dgnUnpackTicket', () => {
  test('byte q → {sym: bits 2:0, col: bits 5:3} (color/symbol NOT swapped)', () => {
    // byte 0b00101110 = 0x2E → sym 6, col 5
    const t = dgnUnpackTicket(0x2En);
    assert.deepEqual(t[0], { sym: 6, col: 5 });
    assert.deepEqual(t[1], { sym: 0, col: 0 });
  });
  test('four quadrants LSB-first', () => {
    // q0=0x01 (sym1), q1=0x08 (col1), q2=0x3F (sym7 col7), q3=0x00
    const packed = 0x01n | (0x08n << 8n) | (0x3Fn << 16n);
    const t = dgnUnpackTicket(packed);
    assert.deepEqual(t, [
      { sym: 1, col: 0 }, { sym: 0, col: 1 }, { sym: 7, col: 7 }, { sym: 0, col: 0 },
    ]);
  });
  test('garbage input → zeroed traits, no throw', () => {
    assert.deepEqual(dgnUnpackTicket('not-a-number')[0], { sym: 0, col: 0 });
  });
});

describe('dgnComputeMatches', () => {
  test('full / sym / col / miss classification + fullCount', () => {
    const player = [
      { sym: 1, col: 2 }, { sym: 3, col: 4 }, { sym: 5, col: 6 }, { sym: 7, col: 0 },
    ];
    const house = [
      { sym: 1, col: 2 },  // full
      { sym: 3, col: 0 },  // sym
      { sym: 0, col: 6 },  // col
      { sym: 0, col: 1 },  // miss
    ];
    const m = dgnComputeMatches(player, house);
    assert.deepEqual(m.states, ['full', 'sym', 'col', 'miss']);
    assert.equal(m.fullCount, 1);
  });
});
