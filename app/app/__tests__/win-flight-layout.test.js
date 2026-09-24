import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutWinFlights } from '../win-flight-layout.js';

const overlaps = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left
  && a.top < b.top + b.height && a.top + a.height > b.top;
for (const width of [110, 150, 230]) test(`dense prize flights stay clear of totals and the center at ${width}px`, () => {
  const area = { left: 3, top: 3, right: width - 3, bottom: width - 3 };
  const obstacles = [{ left: 0, top: 0, width, height: width * .32 },
    { left: width * .7, top: width * .7, width: width * .3, height: width * .3 }];
  const items = Array.from({ length: 20 }, (_, i) => ({ x: 15 + i % 4 * 20, y: 65 + i % 3 * 15, width: 45 + i % 3 * 9, height: 19 }));
  const positions = layoutWinFlights(items, area, obstacles);
  assert.equal(positions.length, 20);
  positions.forEach((p, i) => {
    assert.ok(p, 'all ordinary reward labels fit');
    const rect = { ...p, ...items[i] };
    assert.ok(rect.left >= area.left && rect.top >= area.top);
    assert.ok(rect.left + rect.width <= area.right && rect.top + rect.height <= area.bottom);
    assert.ok(obstacles.every(obstacle => !overlaps(rect, obstacle)));
    positions.slice(0, i).forEach((other, j) => {
      if (other.wave === p.wave) assert.ok(!overlaps(rect, { ...other, ...items[j] }));
      else if (other.wave < p.wave) assert.ok(p.delay >= other.delay + 1300);
      else assert.ok(other.delay >= p.delay + 1300);
    });
  });
});
test('an unplaceable reward stays available for manual inspection without covering reserved content', () => {
  assert.deepEqual(layoutWinFlights([{ x: 25, y: 25, width: 150, height: 30 }],
    { left: 0, right: 100, top: 0, bottom: 100 }), [null]);
  assert.deepEqual(layoutWinFlights([], { left: 0, right: 100, top: 0, bottom: 100 }), []);
});
