// test file for Phase 52 Wave 0 -- Plan 52-01
//
// Covers: JACKPOT-01, JACKPOT-02, JACKPOT-03
//
// Asserts the contract the <jackpot-panel-wrapper> Custom Element must
// satisfy: imports beta/components/jackpot-panel.js directly (post-D-09
// patch), wraps the inner <jackpot-panel>, shims replay.* into game.*
// on the reused beta store so the inner panel re-renders on day/level
// change. Also asserts play/index.html links beta/styles/jackpot.css
// (Pitfall 13).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'jackpot-panel-wrapper.js');
const PLAY_INDEX = join(PLAY_ROOT, 'index.html');
const PLAY_MAIN = join(PLAY_ROOT, 'app', 'main.js');

// ---------------------------------------------------------------------------
// Existence + registration + class shell
// ---------------------------------------------------------------------------

test('jackpot-panel-wrapper.js exists', () => {
  assert.ok(existsSync(PANEL), 'expected play/components/jackpot-panel-wrapper.js to exist (Plan 52-02 delivers)');
});

test('jackpot-panel-wrapper.js registers <jackpot-panel-wrapper>', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]jackpot-panel-wrapper['"]/);
});

test('jackpot-panel-wrapper.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('jackpot-panel-wrapper.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(/);
  assert.match(src, /disconnectedCallback\s*\(/);
});

// ---------------------------------------------------------------------------
// JACKPOT-01 + JACKPOT-02: direct beta import + inner panel rendering
// ---------------------------------------------------------------------------

test('JACKPOT-01/02: imports beta/components/jackpot-panel.js directly (D-09)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/components\/jackpot-panel\.js['"]/);
});

test('JACKPOT-02: wraps <jackpot-panel> inside innerHTML template', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /<jackpot-panel>/);
});

// ---------------------------------------------------------------------------
// JACKPOT-03: store shim (replay.* -> game.*)
// ---------------------------------------------------------------------------

test('JACKPOT-03: subscribes to replay.day', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
});

test('JACKPOT-03: subscribes to replay.level', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
});

test('JACKPOT-03: shims replay.level into game.level via update()', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /update\(\s*['"]game\.level['"]/);
});

test('JACKPOT-03: shims game.jackpotDay (within-level counter)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /game\.jackpotDay/);
});

test('jackpot-panel-wrapper.js imports subscribe + get + update from reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/\.\.\/beta\/app\/store\.js['"]/);
  assert.match(src, /import\s*\{[^}]*\bsubscribe\b[^}]*\}/);
  assert.match(src, /import\s*\{[^}]*\bget\b[^}]*\}/);
  assert.match(src, /import\s*\{[^}]*\bupdate\b[^}]*\}/);
});

// ---------------------------------------------------------------------------
// play/index.html linking beta/styles/jackpot.css (Pitfall 13)
// ---------------------------------------------------------------------------

test('play/index.html links beta/styles/jackpot.css', () => {
  const html = readFileSync(PLAY_INDEX, 'utf8');
  assert.match(html, /beta\/styles\/jackpot\.css/);
});

test('play/index.html uses <jackpot-panel-wrapper> tag (not raw <jackpot-panel>)', () => {
  const html = readFileSync(PLAY_INDEX, 'utf8');
  assert.match(html, /<jackpot-panel-wrapper/);
});

test('play/index.html includes <packs-panel> (Phase 52 panel add)', () => {
  const html = readFileSync(PLAY_INDEX, 'utf8');
  assert.match(html, /<packs-panel/);
});

test('play/app/main.js registers jackpot-panel-wrapper and packs-panel via dynamic import', () => {
  const src = readFileSync(PLAY_MAIN, 'utf8');
  assert.match(src, /jackpot-panel-wrapper\.js/);
  assert.match(src, /packs-panel\.js/);
});
