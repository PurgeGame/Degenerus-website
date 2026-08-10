import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIN_ART_EDGE_GUTTER_PERCENT,
  WIN_ART_GAP_PERCENT,
  WIN_RECEIPT_BAND_PERCENT,
  winningBadgeLayout,
} from '../jackpot-badge-layout.js';

function overlapFraction(a, b) {
  const width = Math.max(0, Math.min(a.left + a.size, b.left + b.size) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.top + a.size, b.top + b.size) - Math.max(a.top, b.top));
  return (width * height) / Math.min(a.size ** 2, b.size ** 2);
}

describe('jackpot winning-badge layout', () => {
  test('keeps every density deterministic and only lightly overlapped', () => {
    for (let quadrant = 0; quadrant < 4; quadrant += 1) {
      for (let count = 1; count <= 20; count += 1) {
        const first = winningBadgeLayout({ count, quadrant });
        const second = winningBadgeLayout({ count, quadrant });
        assert.deepEqual(first, second);
        assert.equal(first.length, count);
        for (let i = 0; i < first.length; i += 1) {
          for (let j = i + 1; j < first.length; j += 1) {
            assert.ok(overlapFraction(first[i], first[j]) <= 0.12,
              `q${quadrant} / ${count} badges overlap too heavily at ${i}/${j}`);
          }
        }
      }
    }
  });

  test('reserves the receipt band on both top and bottom quadrants', () => {
    const topArtStart = WIN_RECEIPT_BAND_PERCENT + WIN_ART_GAP_PERCENT;
    const topArtEnd = 100 - WIN_ART_EDGE_GUTTER_PERCENT;
    const bottomArtStart = WIN_ART_EDGE_GUTTER_PERCENT;
    const bottomArtEnd = 100 - WIN_RECEIPT_BAND_PERCENT - WIN_ART_GAP_PERCENT;
    for (const badge of winningBadgeLayout({ count: 20, quadrant: 0 })) {
      assert.ok(badge.top >= topArtStart);
      assert.ok(badge.top + badge.size <= topArtEnd + Number.EPSILON);
    }
    for (const badge of winningBadgeLayout({ count: 20, quadrant: 2 })) {
      assert.ok(badge.top >= bottomArtStart);
      assert.ok(badge.top + badge.size <= bottomArtEnd + Number.EPSILON);
    }
  });

  test('keeps a lone solo winner large without entering the receipt', () => {
    const [badge] = winningBadgeLayout({ count: 1, quadrant: 1, soloIndex: 0, soloSize: 95 });
    assert.equal(badge.size, 52);
    assert.ok(badge.top >= WIN_RECEIPT_BAND_PERCENT + WIN_ART_GAP_PERCENT);
  });

  test('breaks up the grid with deterministic tilt, stagger, and depth', () => {
    const layout = winningBadgeLayout({ count: 12, quadrant: 0 });
    assert.ok(new Set(layout.map((badge) => badge.rotation)).size >= 6,
      'the reveal uses several visibly different badge angles');
    assert.ok(layout.some((badge) => Math.abs(badge.rotation) >= 6),
      'at least one badge has a noticeable tilt');
    assert.ok(new Set(layout.map((badge) => badge.top.toFixed(4))).size >= 8,
      'badges in the same logical row are vertically staggered');
    assert.ok(new Set(layout.map((badge) => badge.layer)).size >= 3,
      'badges occupy several controlled paint layers');
  });
});
