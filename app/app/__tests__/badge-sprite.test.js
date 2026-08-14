// /app/app/__tests__/badge-sprite.test.js
//
// Run: cd website && node --test app/app/__tests__/badge-sprite.test.js
//
// The badge store answers /badges-circular/ and /symbols/ paths from one
// fetched bundle. What must hold:
//   - before the bundle lands, paths pass through UNCHANGED (per-file lane)
//   - after it lands, a bundled badge resolves to a stable local URL
//   - a path outside the bundle (or outside the badge dirs) passes through
//   - the funnel builders (badgePath / dgnBadgePath / dgnSymbolPath) resolve
//     through the store without their callers changing

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const sprite = await import('../badge-sprite.js');

afterEach(() => {
  sprite.__setBadgeBundleForTest(null);
});

test('an un-warmed store passes every path through unchanged', () => {
  const path = '/badges-circular/cards_00_horseshoe_blue.svg';
  assert.equal(sprite.resolveBadgeUrl(path), path);
});

test('a bundled badge resolves to a stable local URL after warm', () => {
  sprite.__setBadgeBundleForTest({
    'badges-circular/cards_00_horseshoe_blue': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'symbols/cards_00_horseshoe_blue': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  const badge = sprite.resolveBadgeUrl('/badges-circular/cards_00_horseshoe_blue.svg');
  const symbol = sprite.resolveBadgeUrl('/symbols/cards_00_horseshoe_blue.svg');
  assert.notEqual(badge, '/badges-circular/cards_00_horseshoe_blue.svg');
  assert.notEqual(symbol, '/symbols/cards_00_horseshoe_blue.svg');
  assert.notEqual(badge, symbol, 'the two sets are distinct entries');
  // Memoized: repeat renders reuse the same URL (and the decoded-image cache).
  assert.equal(sprite.resolveBadgeUrl('/badges-circular/cards_00_horseshoe_blue.svg'), badge);
});

test('a path missing from the bundle passes through', () => {
  sprite.__setBadgeBundleForTest({ 'badges-circular/cards_00_horseshoe_blue': '<svg/>' });
  assert.equal(
    sprite.resolveBadgeUrl('/badges-circular/dice_03_4_gold.svg'),
    '/badges-circular/dice_03_4_gold.svg',
  );
  assert.equal(sprite.resolveBadgeUrl('/app/assets/baf-mark.svg'), '/app/assets/baf-mark.svg');
});

test('warmBadgeStore fetches the bundle once and feeds the resolver', async () => {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return { ok: true, json: async () => ({ 'badges-circular/cards_00_horseshoe_blue': '<svg/>' }) };
  };
  try {
    await Promise.all([sprite.warmBadgeStore(), sprite.warmBadgeStore()]);
    await sprite.warmBadgeStore();
    assert.equal(fetches, 1, 'concurrent and repeat warms share one request');
    assert.notEqual(
      sprite.resolveBadgeUrl('/badges-circular/cards_00_horseshoe_blue.svg'),
      '/badges-circular/cards_00_horseshoe_blue.svg',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('a failed bundle fetch clears the warm so a later call retries', async () => {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    if (fetches === 1) throw new Error('network down');
    // Simulates the SPA-fallback trap on attempt 2: 200 text/html, json() throws.
    if (fetches === 2) return { ok: true, json: async () => { throw new Error('not json'); } };
    return { ok: true, json: async () => ({ 'symbols/dice_00_1_pink': '<svg/>' }) };
  };
  try {
    await sprite.warmBadgeStore();
    assert.equal(sprite.resolveBadgeUrl('/symbols/dice_00_1_pink.svg'), '/symbols/dice_00_1_pink.svg');
    await sprite.warmBadgeStore();
    await sprite.warmBadgeStore();
    assert.equal(fetches, 3, 'each failure frees the next call to retry');
    assert.notEqual(sprite.resolveBadgeUrl('/symbols/dice_00_1_pink.svg'), '/symbols/dice_00_1_pink.svg');
  } finally {
    globalThis.fetch = original;
  }
});

test('replay-panel decode-warm awaits the bundle before generating paths', async () => {
  // The startup-order race: #preloadBadges building its 256 paths BEFORE the
  // bundle lands resolves them all to file URLs and re-creates the request
  // storm — a measured cold load downloaded BOTH lanes. The await must come
  // before any path generation.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../components/replay-panel.js', import.meta.url), 'utf8');
  const body = source.split('async #preloadBadges()')[1] ?? '';
  const awaitAt = body.indexOf('await warmBadgeStore()');
  const pathsAt = body.indexOf('badgeCircularPath(');
  assert.ok(body, '#preloadBadges must be async (or the await could not exist)');
  assert.ok(awaitAt >= 0, '#preloadBadges must await warmBadgeStore()');
  assert.ok(pathsAt > awaitAt, 'the await must precede path generation');
});

test('the funnel builders resolve through the store', async () => {
  const { badgePath } = await import('../constants.js');
  const { dgnBadgePath, dgnSymbolPath } = await import('../dgn-traits.js');

  // cards symbolIdx 4 = horseshoe = file index 00 (CARD_IDX remap), color 4 = blue.
  const filePath = '/badges-circular/cards_00_horseshoe_blue.svg';
  assert.equal(badgePath('cards', 4, 4), filePath, 'un-warmed: the raw file path');
  assert.equal(dgnBadgePath(2, 4, 4), filePath);

  sprite.__setBadgeBundleForTest({
    'badges-circular/cards_00_horseshoe_blue': '<svg/>',
    'symbols/cards_00_horseshoe_blue': '<svg/>',
  });
  assert.notEqual(badgePath('cards', 4, 4), filePath, 'warmed: a local URL');
  assert.equal(badgePath('cards', 4, 4), dgnBadgePath(2, 4, 4), 'both funnels share one entry');
  assert.notEqual(dgnSymbolPath(2, 4, 4), '/symbols/cards_00_horseshoe_blue.svg');
});
