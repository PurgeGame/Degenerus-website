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

test('placements are at least as close as a pixel search without depending on the widget size', () => {
  let seed = 9123;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const blocked = (a, b) => a.left < b.left + b.width + 4 && a.left + a.width + 4 > b.left
    && a.top < b.top + b.height + 4 && a.top + a.height + 4 > b.top;
  for (let sample = 0; sample < 40; sample++) {
    const area = { left: 3, top: 3, right: 100 + random() * 90, bottom: 100 + random() * 90 };
    const item = { width: 20 + random() * 45, height: 12 + random() * 15, x: random() * 200, y: random() * 200 };
    const obstacles = Array.from({ length: 3 }, () => ({ left: random() * 150, top: random() * 150, width: 20 + random() * 40, height: 20 + random() * 40 }));
    const score = p => (p.left + item.width / 2 - item.x) ** 2 + (p.top + item.height / 2 - item.y + 18) ** 2;
    let pixelBest = Infinity;
    for (let top = area.top; top + item.height <= area.bottom; top++) {
      for (let left = area.left; left + item.width <= area.right; left++) {
        const p = { left, top, width: item.width, height: item.height };
        if (!obstacles.some(b => blocked(p, b))) pixelBest = Math.min(pixelBest, score(p));
      }
    }
    const [position] = layoutWinFlights([item], area, obstacles);
    if (Number.isFinite(pixelBest)) {
      assert.ok(position, 'a usable space cannot be lost');
      assert.ok(score(position) <= pixelBest + 1e-6, 'choose the nearest free position, including fractional CSS bounds');
    }
    if (position) assert.ok(obstacles.every(b => !blocked({ ...position, ...item }, b)));
  }
});

test('a narrow opening between the receipt and center remains usable', () => {
  const item = { x: 50, y: 70, width: 40, height: 19 };
  const [position] = layoutWinFlights([item], { left: 3, top: 3, right: 97, bottom: 97 }, [
    { left: 0, top: 0, width: 100, height: 40.5 },
    { left: 0, top: 67.5, width: 100, height: 40 },
  ]);
  assert.ok(position);
  assert.equal(position.top, 44.5);
});
