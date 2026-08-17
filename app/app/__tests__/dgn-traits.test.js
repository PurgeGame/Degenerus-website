// /app/app/__tests__/dgn-traits.test.js — shared Degenerette trait codecs.
// Run: cd website && node --test app/app/__tests__/dgn-traits.test.js
//
// Canonical byte: [QQ: bits 6-7 | CCC: bits 3-5 | SSS: bits 0-2] — the f47f106
// bit-swap class of bug is what these invariants pin down.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import {
  DGN_QUADRANTS, DGN_SYMBOLS, DGN_CARD_IDX, DGN_COLORS,
  dgnBadgePath, dgnDisplaySymbol, dgnSymbolPath, dgnUnpackTicket, dgnComputeMatches,
  dgnScoringMatchStates, dgnTicketAccent, applyDgnTicketAccent,
  dgnPartitionTicketEntries,
} from '../dgn-traits.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  test('player-facing aliases do not change their asset slugs', () => {
    assert.equal(dgnDisplaySymbol(0, 0, 0), 'wwxrp');
    assert.equal(dgnBadgePath(0, 0, 0), '/badges-circular/crypto_00_xrp_pink.svg');
    assert.equal(dgnDisplaySymbol(3, 5, 7), '6ix');
    assert.equal(dgnDisplaySymbol(3, 5, 6), '6');
    assert.equal(dgnBadgePath(3, 5, 7), '/badges-circular/dice_05_6_gold.svg');
  });
  test('round crypto picker art exposes its complete disc in every color', () => {
    const colors = ['pink', 'purple', 'green', 'red', 'blue', 'orange', 'silver', 'gold'];
    assert.equal(dgnSymbolPath(0, 3, 4), '/symbols/crypto_03_monero_blue.svg');
    assert.equal(dgnSymbolPath(0, 7, 4), '/symbols/crypto_07_bitcoin_blue.svg');
    for (const symbol of ['03_monero', '07_bitcoin']) {
      for (const color of colors) {
        const src = readFileSync(resolvePath(__dirname, `../../../symbols/crypto_${symbol}_${color}.svg`), 'utf8');
        assert.match(src, /viewBox="-22\.25 -22\.25 44\.5 44\.5"/,
          `${symbol} ${color} must not clip its circular edge`);
      }
    }
  });
});

describe('dgnTicketAccent', () => {
  test('any gold trait forces a stable gold structural colour', () => {
    const ticket = [0, 72, 191, 200]; // q2 byte 191 carries color 7
    assert.deepEqual(dgnTicketAccent(ticket), {
      index: 7, name: 'gold', hex: '#d4af37',
    });
  });

  test('non-gold tickets choose a deterministic colour absent from the ticket', () => {
    const ticket = [0, 73, 146, 219]; // colors 0,1,2,3
    const first = dgnTicketAccent(ticket);
    const second = dgnTicketAccent([...ticket].reverse());
    assert.deepEqual(second, first, 'quadrant order does not alter the seeded choice');
    assert.ok(!new Set([0, 1, 2, 3]).has(first.index));
    assert.ok(first.index >= 0 && first.index < 7);
  });

  test('applies the same colour to the shared CSS variable', () => {
    const style = { setProperty(name, value) { this[name] = value; } };
    const attrs = {};
    const el = { style, setAttribute(name, value) { attrs[name] = value; } };
    const accent = applyDgnTicketAccent(el, [0, 73, 146, 219]);
    assert.equal(style['--ticket-line-color'], accent.hex);
    assert.equal(attrs['data-ticket-accent'], accent.name);
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

describe('dgnPartitionTicketEntries', () => {
  test('keeps fractional traits as entry records while repairing later whole tickets', () => {
    const cards = [
      { cardIndex: 0, entries: [1, 72, 2, 73]
        .map((traitId, entryId) => ({ traitId, entryId })) },
      { cardIndex: 1, entries: [130, 201, 4, 75]
        .map((traitId, offset) => ({ traitId, entryId: offset + 4 })) },
      { cardIndex: 2, entries: [131, 202]
        .map((traitId, offset) => ({ traitId, entryId: offset + 8 })) },
    ];

    const partitioned = dgnPartitionTicketEntries(cards);
    assert.deepEqual(partitioned.tickets.map((ticket) => ticket.traitIds), [
      [2, 73, 130, 201],
      [4, 75, 131, 202],
    ]);
    assert.deepEqual(partitioned.entries.map((entry) => entry.traitId), [1, 72]);
    assert.deepEqual(partitioned.entries.map((entry) => entry.key), ['entry:0', 'entry:1']);
  });

  test('unrevealed entries (traitId null) never coerce to trait 0 = crypto/pink/XRP', () => {
    const cards = [
      { cardIndex: 0, entries: [0, 72, 130, 201]
        .map((traitId, entryId) => ({ traitId, entryId })) },
      // A wholly unrevealed card: Number(null) is 0, a real trait, so a naive
      // coercion both invents four pink-XRP singletons and splits the card above.
      { cardIndex: 1, entries: [null, null, null, null]
        .map((traitId, offset) => ({ traitId, entryId: offset + 4 })) },
    ];

    const partitioned = dgnPartitionTicketEntries(cards);
    assert.deepEqual(partitioned.tickets.map((ticket) => ticket.traitIds), [[0, 72, 130, 201]]);
    assert.deepEqual(partitioned.entries, []);
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
    assert.deepEqual(dgnScoringMatchStates(player, house), ['full', 'sym', 'miss', 'miss'],
      'color-only similarity is a zero-point miss in Degenerette');
  });
});
