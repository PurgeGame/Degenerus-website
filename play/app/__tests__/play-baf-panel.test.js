// play/app/__tests__/play-baf-panel.test.js
//
// Phase 54 Wave 0 -- contract-grep tests for <baf-panel>.
//
// Coverage:
//   BAF-01 -- selected player's BAF score and rank (hard-gated on INTEG-05 in Wave 2)
//   BAF-02 -- top-4 BAF leaderboard with prominence styling via data-rank attribute
//   BAF-03 -- round-status pill (open/closed/skipped/not_eligible) + next-baf-level label
//   SHELL-01 negatives -- no imports of beta/app/baf.js, beta/app/utils.js, beta/components/baf-panel.js, ethers
//   Fetch wiring -- /leaderboards/baf?level=N (Wave 1) + /player/:addr/baf?level=N (Wave 2 INTEG-05)
//   Dual stale-guards -- #bafFetchId (leaderboard) + #bafPlayerFetchId (per-player INTEG-05)
//   Score-unit discipline (Pitfall 8) -- BAF scores are WEI-scale (formatBurnie required)
//   Inline bafContext derivation -- nextBafLevel via Math.ceil((level+1)/10)*10 (per 54-PATTERNS.md)
//   Selected-player highlighting -- aria-current="true" on matching row
//   Empty state -- entries.length check or equivalent

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'baf-panel.js');

// ---------------------------------------------------------------------------
// Existence + registration
// ---------------------------------------------------------------------------

test('baf-panel.js exists', () => {
  assert.ok(existsSync(PANEL), `expected ${PANEL} to exist`);
});

test('baf-panel.js registers the <baf-panel> custom element', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]baf-panel['"]/);
});

test('baf-panel.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('baf-panel.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(\s*\)/);
  assert.match(src, /disconnectedCallback\s*\(\s*\)/);
});

// ---------------------------------------------------------------------------
// SHELL-01: no wallet-tainted imports (three newly-added FORBIDDEN paths covered)
// ---------------------------------------------------------------------------

test('SHELL-01: baf-panel.js does NOT import beta/app/baf.js (transitively tainted via utils.js)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/baf\.js['"]/);
});

test('SHELL-01: baf-panel.js does NOT import beta/app/utils.js (ethers at line 3)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

test('SHELL-01: baf-panel.js does NOT import beta/components/baf-panel.js (tag-name collision + transitively tainted)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/baf-panel\.js['"]/);
});

test('SHELL-01: baf-panel.js does NOT import ethers directly', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
});

test('baf-panel.js imports from beta/viewer/utils.js (wallet-free surface)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/viewer\/utils\.js['"]/);
});

test('baf-panel.js imports subscribe + get from the reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/app\/store\.js['"]/);
  assert.match(src, /subscribe/);
  assert.match(src, /\bget\b/);
});

test('baf-panel.js imports API_BASE from play/app/constants.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/app\/constants\.js['"]/);
  assert.match(src, /API_BASE/);
});

// ---------------------------------------------------------------------------
// Store wiring -- BAF is level-based, subscribes to both level + player
// ---------------------------------------------------------------------------

test('baf-panel.js subscribes to replay.level AND replay.player', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
});

// ---------------------------------------------------------------------------
// BAF-02: leaderboard top-4 + prominence via data-rank
// ---------------------------------------------------------------------------

test('BAF-02: fetches /leaderboards/baf?level=', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/leaderboards\/baf\?level=/);
});

test('BAF-02: renders leaderboard entries container', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']leaderboard-entries["']/);
});

test('BAF-02: uses data-rank attribute for prominence tiers (gold/silver/bronze/regular per D-06)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-rank/);
});

// ---------------------------------------------------------------------------
// BAF-03: round-status + next-BAF-level + levels-until
// ---------------------------------------------------------------------------

test('BAF-03: renders round-status pill with data-bind and data-status attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']round-status["']/);
  assert.match(src, /data-status/);
});

test('BAF-03: renders next-baf-level data-bind', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']next-baf-level["']/);
});

test('BAF-03: renders levels-until data-bind', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']levels-until["']/);
});

// ---------------------------------------------------------------------------
// BAF-01: your-rank row hydrated from INTEG-05 (Wave 2 adds the fetch + render)
// ---------------------------------------------------------------------------

test('BAF-01: fetches /player/${addr}/baf?level= (INTEG-05)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/[^`'"]+\/baf\?level=/);
});

test('BAF-01: renders your-rank section with data-bind="your-rank"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']your-rank["']/);
});

test('BAF-01: renders your-rank-value, total-participants, your-score bindings', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const key of ['your-rank-value', 'total-participants', 'your-score']) {
    assert.match(src, new RegExp(`data-bind=["']${key}["']`),
      `expected data-bind="${key}" for BAF-01 your-rank section`);
  }
});

// ---------------------------------------------------------------------------
// Prominence (panel-level + row-level)
// ---------------------------------------------------------------------------

test('baf-panel.js uses data-prominence attribute on the panel element', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-prominence/);
});

// ---------------------------------------------------------------------------
// Dual stale-guards (leaderboard + per-player fetch invalidate at different cadences)
// ---------------------------------------------------------------------------

test('baf-panel.js uses #bafFetchId stale-guard counter (leaderboard fetch)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#bafFetchId/);
});

test('baf-panel.js uses #bafPlayerFetchId stale-guard counter (INTEG-05 fetch)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#bafPlayerFetchId/);
});

test('baf-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// ---------------------------------------------------------------------------
// Skeleton + content pattern
// ---------------------------------------------------------------------------

test('baf-panel.js has data-bind="skeleton" and data-bind="content"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']skeleton["']/);
  assert.match(src, /data-bind=["']content["']/);
});

test('baf-panel.js includes skeleton-shimmer in the skeleton block', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});

// ---------------------------------------------------------------------------
// Inline bafContext derivation -- nextBafLevel = Math.ceil((level+1)/10)*10
// per 54-PATTERNS.md recommendation to inline the 15-LOC logic.
// ---------------------------------------------------------------------------

test('baf-panel.js includes nextBafLevel derivation (Math.ceil((level+1)/10))', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /Math\.ceil\(\s*\(?\s*level\s*\+\s*1\s*\)?\s*\/\s*10\s*\)/);
});

// ---------------------------------------------------------------------------
// Empty-state handling
// ---------------------------------------------------------------------------

test('baf-panel.js handles empty leaderboard gracefully (length check)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /entries\s*\.\s*length|entries\.length|\.length\s*===\s*0|\.length\s*<\s*1/);
});

// ---------------------------------------------------------------------------
// Selected-player aria-current
// ---------------------------------------------------------------------------

test('baf-panel.js highlights selected player with aria-current', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /aria-current/);
});

// ---------------------------------------------------------------------------
// Score-unit discipline (Pitfall 8 -- LOAD-BEARING per 54-RESEARCH.md line 1517)
// ---------------------------------------------------------------------------
// Table from 54-PATTERNS.md Score-unit discipline section:
//
//   /leaderboards/baf?level=N                           WEI-scale BURNIE              formatBurnie(entry.score)
//   /player/:addr/baf?level=N (INTEG-05 score field)    WEI-scale BURNIE              formatBurnie(data.score)
//
// WARNING SIGN OF BUG: BAF leaderboard shows "475,215,212,469,240,581,904,067 BURNIE"
// (wrong -- treats wei as integer; must divide via formatBurnie).

test('score-unit: baf-panel.js uses formatBurnie for BAF scores (wei-scale)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /formatBurnie/);
});

test('score-unit: baf-panel.js uses truncateAddress for player addresses', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /truncateAddress/);
});
