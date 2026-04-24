// test file for Phase 50 Wave 0 -- Plan 50-01
//
// Covers: ROUTE-01, ROUTE-03, ROUTE-04, DAY-04
//
// Source-level contract checks for `play/index.html`. Mirrors the pattern
// used by beta/app/__tests__/day-jackpot-summary.test.js (readFileSync +
// regex asserts, no JSDOM, no network). Currently FAILS -- Plan 50-02
// creates `play/index.html` and turns these green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 1 to play/app -> up 1 to play
const PLAY_ROOT = join(__dirname, '../..');
const INDEX = join(PLAY_ROOT, 'index.html');

test('play/index.html exists', () => {
  assert.ok(existsSync(INDEX), 'expected play/index.html to exist (Plan 50-02)');
});

test('importmap is present and omits ethers', () => {
  const src = readFileSync(INDEX, 'utf8');
  assert.match(src, /<script type="importmap">/);
  assert.doesNotMatch(src, /"ethers"\s*:/);
});

test('importmap pins exact versions (no @latest)', () => {
  const src = readFileSync(INDEX, 'utf8');
  assert.doesNotMatch(src, /@latest/);
  assert.match(src, /gsap@3\.14/);
});

test('no wallet connect prompt tag', () => {
  const src = readFileSync(INDEX, 'utf8');
  assert.doesNotMatch(src, /<connect-prompt/);
});

test('all 7 panel slot tags present', () => {
  const src = readFileSync(INDEX, 'utf8');
  const tags = [
    'profile-panel',
    'tickets-panel',
    'purchase-panel',
    'coinflip-panel',
    'baf-panel',
    'decimator-panel',
    'jackpot-panel',
  ];
  for (const tag of tags) {
    assert.match(src, new RegExp('<' + tag), `expected <${tag}> tag in play/index.html`);
  }
});

test('player-selector tag present', () => {
  const src = readFileSync(INDEX, 'utf8');
  assert.match(src, /<player-selector/);
});

test('day-scrubber tag present', () => {
  const src = readFileSync(INDEX, 'utf8');
  assert.match(src, /<day-scrubber/);
});

test('skeleton shimmer class used in layout', () => {
  const src = readFileSync(INDEX, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});

test('scrubber wrapped in dev-tool container (DAY-04)', () => {
  const src = readFileSync(INDEX, 'utf8');
  assert.match(src, /class="[^"]*\bdev-tool\b[^"]*"/);
});
