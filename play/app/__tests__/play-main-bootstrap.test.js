// test file for Phase 50 Wave 0 -- Plan 50-01
//
// Covers: DAY-02, DAY-03
//
// Source-level contract checks for `play/app/main.js`. Currently FAILS --
// Plan 50-02 creates main.js and turns these green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 1 to play/app
const APP_ROOT = join(__dirname, '..');
const MAIN = join(APP_ROOT, 'main.js');

test('main.js exists', () => {
  assert.ok(existsSync(MAIN), 'expected play/app/main.js to exist (Plan 50-02)');
});

test('imports update from beta store', () => {
  const src = readFileSync(MAIN, 'utf8');
  assert.match(
    src,
    /import\s*\{[^}]*update[^}]*\}\s*from\s*['"]\.\.\/\.\.\/beta\/app\/store\.js['"]/,
  );
});

test("calls update('replay.day', ...) on scrubber change (DAY-02)", () => {
  const src = readFileSync(MAIN, 'utf8');
  assert.match(src, /update\(\s*['"]replay\.day['"]/);
});

test("calls update('replay.player', ...) on selector change", () => {
  const src = readFileSync(MAIN, 'utf8');
  assert.match(src, /update\(\s*['"]replay\.player['"]/);
});

test('fetches /replay/rng on boot (DAY-03)', () => {
  const src = readFileSync(MAIN, 'utf8');
  assert.match(src, /\/replay\/rng/);
});

test("filters days by finalWord !== '0' (DAY-03)", () => {
  const src = readFileSync(MAIN, 'utf8');
  assert.match(src, /finalWord\s*!==?\s*['"]0['"]/);
});

test('does not import ethers, wallet, contracts, or ethers-tainted utils', () => {
  const src = readFileSync(MAIN, 'utf8');
  assert.doesNotMatch(src, /from\s*['"][^'"]*\/beta\/app\/wallet\.js['"]/);
  assert.doesNotMatch(src, /from\s*['"][^'"]*\/beta\/app\/contracts\.js['"]/);
  assert.doesNotMatch(src, /from\s*['"][^'"]*\/beta\/app\/utils\.js['"]/);
  assert.doesNotMatch(src, /from\s*['"]ethers['"]/);
});
