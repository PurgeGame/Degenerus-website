// /app/app/__tests__/foil-match.test.js — Phase 64 foil match grading (pure).
//
// Run: cd website && node --test app/app/__tests__/foil-match.test.js
//
// Mirrors DegenerusGameFoilPackModule._tryClaimFoilMatch's Variant-2 scoring:
// per quadrant symbol (bits 2:0) +1; color (bits 5:3) upgrades to +2 ONLY when
// the symbol matched; quadrant bits (7:6) ignored. T in 0..8, claim at T>=4.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FOIL_CLAIM_THRESHOLD,
  decodeTrait,
  normalizeFoilLine,
  unpackWinSet,
  gradeLine,
  bestGrade,
  claimableDrawGrades,
} from '../foil-match.js';

// Helper: build a trait byte from (quadrant, color, symbol).
const trait = (q, c, s) => (q << 6) | (c << 3) | s;
// Helper: pack four per-quadrant bytes into a winning-set uint32.
const pack = (b0, b1, b2, b3) => ((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0);

describe('decodeTrait (canonical bit layout — f47f106)', () => {
  test('color is bits 5:3, symbol bits 2:0, quadrant bits 7:6', () => {
    // 172 = 0b10 101 100 → quadrant 2, color 5, symbol 4.
    assert.deepEqual(decodeTrait(172), { quadrant: 2, colorIdx: 5, symbolIdx: 4 });
    assert.deepEqual(decodeTrait(0), { quadrant: 0, colorIdx: 0, symbolIdx: 0 });
    assert.deepEqual(decodeTrait(255), { quadrant: 3, colorIdx: 7, symbolIdx: 7 });
  });
});

describe('normalizeFoilLine', () => {
  test('uses encoded quadrant bits instead of trusting API iteration order', () => {
    assert.deepEqual(
      normalizeFoilLine([trait(2, 3, 2), trait(0, 1, 1), trait(3, 1, 0), trait(1, 0, 6)]),
      [trait(0, 1, 1), trait(1, 0, 6), trait(2, 3, 2), trait(3, 1, 0)],
    );
  });

  test('rejects incomplete, duplicate-quadrant, and out-of-range lines', () => {
    assert.equal(normalizeFoilLine([1, 70, 130]), null);
    assert.equal(normalizeFoilLine([1, 2, 130, 200]), null);
    assert.equal(normalizeFoilLine([1, 70, 130, 300]), null);
  });
});

describe('trait packing — the inverse the jackpot spin relies on', () => {
  // The replay panel colours each spinning quadrant by rebuilding the trait ID
  // of the badge currently on screen: contractQ * 64 + col * 8 + sym. If that
  // ever drifts from decodeTrait, the spin lights up blue for traits the player
  // does not hold — which is the bug the per-frame colouring replaced.
  test('round-trips against decodeTrait for all 256 traits', () => {
    for (let q = 0; q < 4; q++) {
      for (let col = 0; col < 8; col++) {
        for (let sym = 0; sym < 8; sym++) {
          const packed = q * 64 + col * 8 + sym;
          const d = decodeTrait(packed);
          assert.equal(d.quadrant, q, `quadrant for ${packed}`);
          assert.equal(d.colorIdx, col, `color for ${packed}`);
          assert.equal(d.symbolIdx, sym, `symbol for ${packed}`);
        }
      }
    }
  });
});

describe('unpackWinSet', () => {
  test('byte q = quadrant q (little-endian packing)', () => {
    assert.deepEqual(unpackWinSet(pack(36, 65, 172, 201)), [36, 65, 172, 201]);
    assert.deepEqual(unpackWinSet(0), [0, 0, 0, 0]);
  });
});

describe('gradeLine (Variant-2 scoring)', () => {
  test('identical line vs set → T8, all faces full', () => {
    const line = [36, 65, 172, 201];
    const { score, faces } = gradeLine(line, pack(36, 65, 172, 201));
    assert.equal(score, 8);
    assert.deepEqual(faces, [2, 2, 2, 2]);
  });

  test('symbol match without color = +1 (face 1)', () => {
    // Same symbol (3), different color (2 vs 6), quadrant 0.
    const line = [trait(0, 2, 3), 0x40, 0x80, 0xc0];
    const set = pack(trait(0, 6, 3), 0xff, 0xff, 0xff);
    const { score, faces } = gradeLine(line, set);
    assert.equal(faces[0], 1, 'symbol-only face');
    assert.equal(score >= 1, true);
  });

  test('color match WITHOUT symbol match scores 0 (color never counts alone)', () => {
    // Same color (5), different symbol (1 vs 4).
    const line = [trait(0, 5, 1), 0x40, 0x80, 0xc0];
    const set = pack(trait(0, 5, 4), trait(1, 0, 1), trait(2, 0, 1), trait(3, 0, 1));
    const { faces } = gradeLine(line, set);
    assert.equal(faces[0], 0, 'color-only = miss');
  });

  test('quadrant bits are ignored in comparison (contract masks them)', () => {
    // Line byte carries quadrant 1 bits but sits in slot 0; set slot 0 has
    // quadrant 0 bits. Symbol+color equal → still a full +2 match.
    const line = [trait(1, 4, 2), 0x40, 0x80, 0xc0];
    const set = pack(trait(0, 4, 2), 0xff, 0xff, 0xff);
    const { faces } = gradeLine(line, set);
    assert.equal(faces[0], 2);
  });

  test('claim threshold is 4', () => {
    assert.equal(FOIL_CLAIM_THRESHOLD, 4);
    // Two full doubles = T4 → claimable boundary.
    const line = [36, 65, 0x80, 0xc0];
    const set = pack(36, 65, 0xff, 0xfe);
    const { score } = gradeLine(line, set);
    assert.equal(score, 4);
  });
});

describe('bestGrade (main vs bonus)', () => {
  const line = [36, 65, 172, 201];

  test('picks the higher-scoring set', () => {
    const main = pack(0xff, 0xfe, 0xfd, 0xfc);       // no matches
    const bonus = pack(36, 65, 172, 201);            // T8
    const best = bestGrade(line, main, bonus);
    assert.equal(best.score, 8);
    assert.equal(best.drawKind, 1);
  });

  test('tie prefers the main draw (drawKind 0)', () => {
    const set = pack(36, 65, 172, 201);
    const best = bestGrade(line, set, set);
    assert.equal(best.drawKind, 0);
  });

  test('null sets degrade gracefully', () => {
    assert.equal(bestGrade(line, null, null), null);
    const onlyBonus = bestGrade(line, null, pack(36, 65, 172, 201));
    assert.equal(onlyBonus.score, 8);
    assert.equal(onlyBonus.drawKind, 1);
  });
});

describe('claimableDrawGrades (contract tuple parity)', () => {
  test('keeps both main and bonus claims when the same line clears both', () => {
    const line = [36, 65, 172, 201];
    const main = pack(36, 65, 0xff, 0xfe);       // T4
    const bonus = pack(36, 65, 172, 201);        // T8
    const grades = claimableDrawGrades(line, main, bonus);
    assert.deepEqual(grades.map((grade) => [grade.drawKind, grade.score]), [[0, 4], [1, 8]]);
  });

  test('omits a draw that is missing or below T4', () => {
    const line = [36, 65, 172, 201];
    const miss = pack(0xff, 0xfe, 0xfd, 0xfc);
    assert.deepEqual(claimableDrawGrades(line, miss, null), []);
  });
});
