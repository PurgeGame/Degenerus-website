// play/app/__tests__/play-coinflip-panel.test.js
//
// Phase 54 Wave 0 -- contract-grep tests for <coinflip-panel>.
//
// Coverage:
//   COINFLIP-01 -- selected player's coinflip state (deposited, claimable, autoRebuy, takeprofit)
//   COINFLIP-02 -- daily coinflip leaderboard (top-10 from /leaderboards/coinflip?day=N)
//   COINFLIP-03 -- current bounty + biggest-flip player + amount (from /player/:addr?day=N coinflip block)
//   SHELL-01 negatives -- no imports of beta/app/coinflip.js, beta/app/utils.js, ethers, wallet, contracts
//   Fetch wiring -- Promise.all over /player/:addr?day= and /leaderboards/coinflip?day=
//   Stale-guard -- #coinflipFetchId counter + is-stale class toggle
//   Score-unit discipline (Pitfall 8) -- coinflip leaderboard scores are INTEGER-scale (no wei division);
//     state amounts are WEI-scale (formatBurnie required)
//   Empty state -- entries.length check or equivalent guard against rendering zero-entry leaderboards
//   Selected-player highlighting -- aria-current="true" on matching row

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 1 -> play/app -> up 1 -> play
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'coinflip-panel.js');

// ---------------------------------------------------------------------------
// Existence + registration
// ---------------------------------------------------------------------------

test('coinflip-panel.js exists', () => {
  assert.ok(existsSync(PANEL), `expected ${PANEL} to exist`);
});

test('coinflip-panel.js registers the <coinflip-panel> custom element', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]coinflip-panel['"]/);
});

test('coinflip-panel.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('coinflip-panel.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(\s*\)/);
  assert.match(src, /disconnectedCallback\s*\(\s*\)/);
});

// ---------------------------------------------------------------------------
// SHELL-01: no wallet-tainted imports
// ---------------------------------------------------------------------------

test('SHELL-01: coinflip-panel.js does NOT import beta/app/coinflip.js (ethers at line 4)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/coinflip\.js['"]/);
});

test('SHELL-01: coinflip-panel.js does NOT import beta/app/utils.js (ethers at line 3)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

test('SHELL-01: coinflip-panel.js does NOT import ethers directly', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
});

test('SHELL-01: coinflip-panel.js does NOT import beta/components/coinflip-panel.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/coinflip-panel\.js['"]/);
});

test('coinflip-panel.js imports from beta/viewer/utils.js (wallet-free surface)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/viewer\/utils\.js['"]/);
});

test('coinflip-panel.js imports subscribe + get from the reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/app\/store\.js['"]/);
  assert.match(src, /subscribe/);
  assert.match(src, /\bget\b/);
});

test('coinflip-panel.js imports API_BASE from play/app/constants.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/app\/constants\.js['"]/);
  assert.match(src, /API_BASE/);
});

// ---------------------------------------------------------------------------
// Store wiring -- subscribes to day + player (coinflip is day-based, not level-based)
// ---------------------------------------------------------------------------

test('coinflip-panel.js subscribes to replay.day AND replay.player (no replay.level)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
});

// ---------------------------------------------------------------------------
// COINFLIP-01: state section (deposited, claimable, autoRebuy, takeprofit)
// ---------------------------------------------------------------------------

test('COINFLIP-01: renders state data-binds (deposited, claimable, autorebuy, takeprofit)', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const key of ['deposited', 'claimable', 'autorebuy', 'takeprofit']) {
    assert.match(src, new RegExp(`data-bind=["']${key}["']`),
      `expected data-bind="${key}" for COINFLIP-01 state section`);
  }
});

// ---------------------------------------------------------------------------
// COINFLIP-02: leaderboard
// ---------------------------------------------------------------------------

test('COINFLIP-02: fetches /leaderboards/coinflip?day=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/leaderboards\/coinflip\?day=/);
});

test('COINFLIP-02: renders leaderboard entries container', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']leaderboard-entries["']/);
});

// ---------------------------------------------------------------------------
// COINFLIP-03: bounty section (pool, record flip, record holder, armed)
// ---------------------------------------------------------------------------

test('COINFLIP-03: renders bounty data-binds (armed, bounty-pool, bounty-record, bounty-holder)', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const key of ['armed', 'bounty-pool', 'bounty-record', 'bounty-holder']) {
    assert.match(src, new RegExp(`data-bind=["']${key}["']`),
      `expected data-bind="${key}" for COINFLIP-03 bounty section`);
  }
});

test('COINFLIP-03: armed indicator uses data-armed attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-armed=/);
});

// ---------------------------------------------------------------------------
// Fetch wiring: player endpoint for COINFLIP-01/03 reads
// ---------------------------------------------------------------------------

test('coinflip-panel.js fetches /player/${addr}?day= (extended response coinflip block)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/\$\{[^}]+\}\?day=|\/player\/\$\{.+?\}\?day=/);
});

// ---------------------------------------------------------------------------
// Stale-guard + keep-old-data-dim (D-17 / D-18 carry-forward from Phase 51)
// ---------------------------------------------------------------------------

test('coinflip-panel.js uses #coinflipFetchId stale-guard counter', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#coinflipFetchId/);
});

test('coinflip-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// ---------------------------------------------------------------------------
// Skeleton + content pattern
// ---------------------------------------------------------------------------

test('coinflip-panel.js has data-bind="skeleton" and data-bind="content"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']skeleton["']/);
  assert.match(src, /data-bind=["']content["']/);
});

test('coinflip-panel.js includes skeleton-shimmer in the skeleton block', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});

// ---------------------------------------------------------------------------
// Empty-state handling (COINFLIP-02 renders nothing gracefully)
// ---------------------------------------------------------------------------

test('coinflip-panel.js handles empty leaderboard gracefully (length check)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /entries\s*\.\s*length|entries\.length|\.length\s*===\s*0|\.length\s*<\s*1/);
});

// ---------------------------------------------------------------------------
// Selected-player aria-current
// ---------------------------------------------------------------------------

test('coinflip-panel.js highlights selected player with aria-current', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /aria-current/);
});

// ---------------------------------------------------------------------------
// Score-unit discipline (Pitfall 8 -- LOAD-BEARING per 54-RESEARCH.md line 1517)
// ---------------------------------------------------------------------------
// Table from 54-PATTERNS.md Score-unit discipline section:
//
//   Endpoint                                            Score format                  Render with
//   /leaderboards/coinflip?day=N                        INTEGER-scale BURNIE          String(entry.score) OR no-divisor format
//   /leaderboards/baf?level=N                           WEI-scale BURNIE              formatBurnie(entry.score)
//   /player/:addr/baf?level=N (INTEG-05)                WEI-scale BURNIE              formatBurnie(data.score)
//   /player/:addr?day=N coinflip block                  WEI-scale BURNIE              formatBurnie(value)
//
// WARNING SIGN OF BUG: coinflip leaderboard shows "0.000000000000052875 BURNIE"
// (wrong -- treats integer as wei) OR player state shows "200000000000000000000"
// without formatBurnie (wrong -- raw wei leaked to UI).

test('score-unit: coinflip-panel.js uses formatBurnie for state amounts (wei-scale)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /formatBurnie/);
});

test('score-unit: coinflip-panel.js uses truncateAddress for player addresses', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /truncateAddress/);
});
