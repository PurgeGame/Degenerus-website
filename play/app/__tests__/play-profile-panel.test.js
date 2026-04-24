// test file for Phase 51 Wave 0 -- Plan 51-01
//
// Covers: PROFILE-01, PROFILE-02, PROFILE-03, PROFILE-04, PROFILE-05
//
// Asserts the contract the <profile-panel> Custom Element and the local
// play/app/quests.js helper module must satisfy after Phase 51 Waves 1
// and 2 ship. Currently FAILS until Wave 1 lands the markup + local
// quests helper (markup assertions turn green) and Wave 2 wires the
// fetch + stale-response guard + subscribe wiring (fetch / stale / sub
// assertions turn green).
//
// Test style: contract-grep (readFileSync + regex). Mirrors
// play/app/__tests__/play-panel-stubs.test.js. No JSDOM, no build step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 1 to play/app -> up 1 to play
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'profile-panel.js');
const QUESTS = join(PLAY_ROOT, 'app', 'quests.js');

// ---------------------------------------------------------------------------
// Existence + registration
// ---------------------------------------------------------------------------

test('profile-panel.js exists', () => {
  assert.ok(existsSync(PANEL), 'expected play/components/profile-panel.js to exist');
});

test('profile-panel.js registers <profile-panel>', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]profile-panel['"]/);
});

test('profile-panel.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('profile-panel.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(/);
  assert.match(src, /disconnectedCallback\s*\(/);
});

// ---------------------------------------------------------------------------
// PROFILE-01: Activity score + info-icon popover + decomposition rows
// ---------------------------------------------------------------------------

test('PROFILE-01: renders score number binding', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']score["']/);
});

test('PROFILE-01: renders info-icon button with aria-expanded', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']info-btn["']/);
  assert.match(src, /aria-expanded=["']false["']/);
});

test('PROFILE-01: renders popover with role="dialog"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']popover["']/);
  assert.match(src, /role=["']dialog["']/);
});

test('PROFILE-01: renders popover row bindings (quest, mint, affiliate)', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const key of ['row-quest', 'row-mint', 'row-affiliate']) {
    assert.match(src, new RegExp(`data-bind=["']${key}["']`), `missing data-bind="${key}"`);
  }
});

test('PROFILE-01: renders single-row pass binding (D-06 collapses whale/lazy/deity)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']row-pass-value["']/);
  assert.match(src, /data-bind=["']row-pass-container["']/);
});

// ---------------------------------------------------------------------------
// PROFILE-02: Quest slots (no high-difficulty flag per D-20)
// ---------------------------------------------------------------------------

test('PROFILE-02: renders quest slots 0 and 1', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-slot-idx=["']0["']/);
  assert.match(src, /data-slot-idx=["']1["']/);
});

test('PROFILE-02: does NOT render highDifficulty DOM nodes (D-20, camelCase identifier forbidden; hyphen comment allowed)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /highDifficulty/);
});

// ---------------------------------------------------------------------------
// PROFILE-03: Quest streak banner (baseStreak + lastCompletedDay)
// ---------------------------------------------------------------------------

test('PROFILE-03: renders quest streak banner bindings', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']base-streak["']/);
  assert.match(src, /data-bind=["']last-completed-day["']/);
});

// ---------------------------------------------------------------------------
// PROFILE-04: Day + player subscribes, fetch URL, stale guard, dim overlay
// ---------------------------------------------------------------------------

test('PROFILE-04: subscribes to replay.day and replay.player', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
});

test('PROFILE-04: imports subscribe from reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s*['"]\.\.\/\.\.\/beta\/app\/store\.js['"]/);
});

test('PROFILE-04: fetches /player/${addr}?day=N', () => {
  const src = readFileSync(PANEL, 'utf8');
  // Literal interpolation fragment: `/player/${...}?day=` in a template literal
  assert.match(src, /\/player\/\$\{[^}]+\}\?day=/);
});

test('PROFILE-04: uses #profileFetchId stale-guard counter (D-18)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#profileFetchId/);
});

test('PROFILE-04: toggles is-stale class for keep-old-data-dim (D-17)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// ---------------------------------------------------------------------------
// PROFILE-05: Daily Activity counts (D-11, D-12)
// ---------------------------------------------------------------------------

test('PROFILE-05: renders all four Daily Activity count bindings', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const key of ['lootboxes-purchased', 'lootboxes-opened', 'tickets-purchased', 'ticket-wins']) {
    assert.match(src, new RegExp(`data-bind=["']${key}["']`), `missing data-bind="${key}"`);
  }
});

// ---------------------------------------------------------------------------
// Local wallet-free quests helper (D-10 + SHELL-01 reinforcement)
// ---------------------------------------------------------------------------

test('play/app/quests.js exists', () => {
  assert.ok(existsSync(QUESTS), 'expected play/app/quests.js to exist (Wave 1)');
});

test('play/app/quests.js does NOT import from beta/app/utils.js (ethers-tainted)', () => {
  const src = readFileSync(QUESTS, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

test('play/app/quests.js does NOT import from beta/app/quests.js (transitively ethers-tainted)', () => {
  const src = readFileSync(QUESTS, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/quests\.js['"]/);
});

test('play/app/quests.js exports formatQuestTarget and getQuestProgress', () => {
  const src = readFileSync(QUESTS, 'utf8');
  assert.match(src, /export\s+function\s+formatQuestTarget/);
  assert.match(src, /export\s+function\s+getQuestProgress/);
});

test('play/app/quests.js maps questType 9 to MINT_BURNIE label (not 0 -- contract uses 9 per DegenerusQuests.sol:173-175)', () => {
  const src = readFileSync(QUESTS, 'utf8');
  assert.match(src, /9:\s*['"][^'"]*BURNIE/);
});

test('play/app/quests.js imports formatEth/formatBurnie from wallet-free beta/viewer/utils.js', () => {
  const src = readFileSync(QUESTS, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/viewer\/utils\.js['"]/);
});
