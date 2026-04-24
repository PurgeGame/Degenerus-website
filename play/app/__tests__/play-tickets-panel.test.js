// test file for Phase 52 Wave 0 -- Plan 52-01
//
// Covers: TICKETS-01, TICKETS-02, TICKETS-03, TICKETS-04
//
// Asserts the contract the <tickets-panel> Custom Element, the
// play/app/tickets-inventory.js helper, and the play/app/tickets-fetch.js
// shared fetcher must satisfy after Phase 52 Waves 1 and 2 ship. Currently
// FAILS until Wave 1 lands the markup + helpers (markup/helper assertions
// turn green) and Wave 2 wires the fetch + stale-guard + keep-old-data-dim
// (fetch/stale/sub assertions turn green).
//
// Test style: contract-grep (readFileSync + regex). Mirrors
// play/app/__tests__/play-profile-panel.test.js. No JSDOM, no build step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 1 to play/app -> up 1 to play
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'tickets-panel.js');
const INVENTORY = join(PLAY_ROOT, 'app', 'tickets-inventory.js');
const FETCH = join(PLAY_ROOT, 'app', 'tickets-fetch.js');

// ---------------------------------------------------------------------------
// Existence + registration + class shell
// ---------------------------------------------------------------------------

test('tickets-panel.js exists', () => {
  assert.ok(existsSync(PANEL), 'expected play/components/tickets-panel.js to exist (Plan 52-02 delivers)');
});

test('tickets-panel.js registers <tickets-panel>', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]tickets-panel['"]/);
});

test('tickets-panel.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('tickets-panel.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(/);
  assert.match(src, /disconnectedCallback\s*\(/);
});

test('tickets-panel.js imports subscribe + get from reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/\.\.\/beta\/app\/store\.js['"]/);
  assert.match(src, /import\s*\{[^}]*\bsubscribe\b[^}]*\}/);
  assert.match(src, /import\s*\{[^}]*\bget\b[^}]*\}/);
});

test('tickets-panel.js subscribes to replay.day, replay.player, replay.level', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
});

test('tickets-panel.js renders skeleton-shimmer in template', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});

test('tickets-panel.js has data-bind="skeleton" and data-bind="content"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']skeleton["']/);
  assert.match(src, /data-bind=["']content["']/);
});

// ---------------------------------------------------------------------------
// TICKETS-01..04 behavioral assertions
// ---------------------------------------------------------------------------

test('TICKETS-01: renders card-grid container', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']card-grid["']/);
});

test('TICKETS-02: cards use 2x2 quadrant grid (ticket-card + trait-quadrant classes)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /ticket-card/);
  assert.match(src, /trait-quadrant/);
});

test('TICKETS-03: groups entries by cardIndex or entryId', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /cardIndex|entryId/);
});

test('TICKETS-04: renders opened vs non-opened state branches', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /status\s*===\s*['"]opened['"]|status\s*!==\s*['"]opened['"]|pending/);
});

// ---------------------------------------------------------------------------
// Shared-helper wiring (fetch helper + inventory helper)
// ---------------------------------------------------------------------------

test('tickets-panel.js imports from play/app/tickets-fetch.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/app\/tickets-fetch\.js['"]/);
  assert.match(src, /\bfetchTicketsByTrait\b/);
});

test('tickets-panel.js imports traitToBadge from play/app/tickets-inventory.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"]\.\.\/app\/tickets-inventory\.js['"]/);
  assert.match(src, /\btraitToBadge\b/);
});

// ---------------------------------------------------------------------------
// Double stale-guard + keep-old-data-dim (D-17 carry-forward from Phase 51)
// ---------------------------------------------------------------------------

test('tickets-panel.js uses #ticketsFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#ticketsFetchId/);
});

test('tickets-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// ---------------------------------------------------------------------------
// play/app/tickets-inventory.js helper assertions
// ---------------------------------------------------------------------------

test('play/app/tickets-inventory.js exists', () => {
  assert.ok(existsSync(INVENTORY), 'expected play/app/tickets-inventory.js to exist (Plan 52-02 delivers)');
});

test('tickets-inventory.js exports traitToBadge', () => {
  const src = readFileSync(INVENTORY, 'utf8');
  assert.match(src, /export\s+function\s+traitToBadge/);
});

test('tickets-inventory.js includes CARD_IDX reshuffle array literal [3,4,5,6,0,2,1,7]', () => {
  const src = readFileSync(INVENTORY, 'utf8');
  assert.match(src, /CARD_IDX\s*=\s*\[\s*3\s*,\s*4\s*,\s*5\s*,\s*6\s*,\s*0\s*,\s*2\s*,\s*1\s*,\s*7\s*\]/);
});

test('tickets-inventory.js is wallet-free (no beta/app/utils.js import)', () => {
  const src = readFileSync(INVENTORY, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

test('tickets-inventory.js QUADRANTS contains crypto,zodiac,cards,dice', () => {
  const src = readFileSync(INVENTORY, 'utf8');
  assert.match(src, /['"]crypto['"]/);
  assert.match(src, /['"]zodiac['"]/);
  assert.match(src, /['"]cards['"]/);
  assert.match(src, /['"]dice['"]/);
});

// ---------------------------------------------------------------------------
// play/app/tickets-fetch.js helper assertions
// ---------------------------------------------------------------------------

test('play/app/tickets-fetch.js exists', () => {
  assert.ok(existsSync(FETCH), 'expected play/app/tickets-fetch.js to exist (Plan 52-02 delivers)');
});

test('tickets-fetch.js exports fetchTicketsByTrait', () => {
  const src = readFileSync(FETCH, 'utf8');
  assert.match(src, /export\s+(async\s+)?function\s+fetchTicketsByTrait/);
});

test('tickets-fetch.js URL matches INTEG-01 path /player/.../tickets/by-trait?level=', () => {
  const src = readFileSync(FETCH, 'utf8');
  assert.match(src, /\/player\/[^`'"]*\/tickets\/by-trait/);
  assert.match(src, /level=/);
  assert.match(src, /day=/);
});

test('tickets-fetch.js imports API_BASE from play/app/constants.js', () => {
  const src = readFileSync(FETCH, 'utf8');
  assert.match(src, /from\s+['"]\.\/constants\.js['"]/);
  assert.match(src, /\bAPI_BASE\b/);
});

test('tickets-fetch.js is wallet-free (no ethers, no beta/app/utils.js import)', () => {
  const src = readFileSync(FETCH, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});
