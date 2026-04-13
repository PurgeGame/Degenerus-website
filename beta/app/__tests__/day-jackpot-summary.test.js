// day-jackpot-summary.test.js — contract tests for Plan 39-10
//
// Source-level contract checks, mirroring the pattern used by
// jackpot-panel-overview.test.js. No JSDOM. Verifies that the new
// component exists, subscribes to replay.level, fetches the level
// overview endpoint, and reuses the existing jackpot-rolls renderer
// rather than duplicating row-render logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(__dirname, '../../components/day-jackpot-summary.js');
const REPLAY_PATH    = join(__dirname, '../../components/replay-panel.js');
const MAIN_PATH      = join(__dirname, '../../app/main.js');
const CSS_PATH       = join(__dirname, '../../styles/jackpot.css');

test('day-jackpot-summary.js module exists', () => {
  assert.ok(existsSync(COMPONENT_PATH), 'expected components/day-jackpot-summary.js to exist');
});

test('defines <day-jackpot-summary> custom element', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]day-jackpot-summary['"]/);
  assert.match(src, /class\s+DayJackpotSummary\s+extends\s+HTMLElement/);
});

test('subscribes to replay.level pub-sub (reacts to day changes)', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');
  assert.match(src, /subscribe\s*\(\s*['"]replay\.level['"]/);
  // must import subscribe from the store module
  assert.match(src, /import\s*\{[^}]*subscribe[^}]*\}\s*from\s*['"]\.\.\/app\/store\.js['"]/);
});

test('reuses jackpot-rolls renderer (no row-render duplication)', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');
  // Must pull in the factory or row renderer from jackpot-rolls.js — don't reinvent.
  assert.match(src, /from\s+['"]\.\.\/app\/jackpot-rolls\.js['"]/);
  assert.match(src, /createJackpotRolls|renderOverview/);
});

test('fetches the level overview endpoint via API_BASE', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');
  // Uses the shared API base constant (same source replay-panel uses).
  assert.match(src, /from\s+['"]\.\.\/app\/constants\.js['"]/);
  assert.match(src, /API_BASE/);
  // Renderer fetches /game/jackpot/{level}/overview — that URL (or factory call producing it) must be present.
  assert.match(src, /\/game\/jackpot\/|renderOverview\s*\(/);
});

test('handles empty / error states gracefully', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');
  // Either branch: empty-state placeholder text OR delegation to renderer's built-in empty handling.
  assert.match(src, /Select a day|empty|Unable|error/i);
});

test('unsubscribes on disconnect (no leaks)', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');
  assert.match(src, /disconnectedCallback/);
});

test('replay-panel mounts <day-jackpot-summary> directly above the distributions block', () => {
  const src = readFileSync(REPLAY_PATH, 'utf8');
  const tagIdx   = src.indexOf('<day-jackpot-summary');
  const distIdx  = src.indexOf('class="replay-distributions"');
  assert.ok(tagIdx > 0, 'expected <day-jackpot-summary> tag in replay-panel template');
  assert.ok(distIdx > 0, 'expected replay-distributions block in replay-panel template');
  assert.ok(tagIdx < distIdx, '<day-jackpot-summary> must appear before replay-distributions');
});

test('main.js imports the new component (registers the tag at load time)', () => {
  const src = readFileSync(MAIN_PATH, 'utf8');
  assert.match(src, /import\s+['"]\.\.\/components\/day-jackpot-summary\.js['"]/);
});

test('jackpot.css has .day-jackpot-summary block styling', () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  assert.match(css, /\.day-jackpot-summary\s*\{/);
});
