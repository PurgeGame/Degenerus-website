// play/app/__tests__/play-decimator-panel.test.js
//
// Phase 55 Wave 0 -- contract-grep tests for <decimator-panel>.
//
// Coverage:
//   DECIMATOR-01 -- window status badge (open/closed) + level label.
//                   Wave 1 renders state-only label (no per-level countdown):
//                   per RESEARCH Pitfall 4, play/ does not poll /game/state so
//                   the level-start timestamp is null in the store.
//   DECIMATOR-02 -- bucket + subbucket from INTEG-03; bucket-table with
//                   player-row aria-current. Bucket range per CONTRACT TRUTH
//                   is 5..12 on normal levels and 2..12 on centennial
//                   (BurnieCoin.sol:142-147). CONTEXT D-03 is incorrect per
//                   RESEARCH Pitfall 1.
//   DECIMATOR-03 -- effective + weighted burn amounts per level
//   DECIMATOR-04 -- winning subbucket + payout pill for closed rounds
//                   (data-won attribute drives CSS coloring: true/false/empty)
//   DECIMATOR-05 -- terminal sub-section conditional on terminal.burns.length > 0
//                   (D-06 gate: hide the ENTIRE section when no burns,
//                    per RESEARCH Pitfall 3)
//   SHELL-01 negatives -- no imports of 4 forbidden beta paths + ethers bare
//   Fetch wiring -- /player/:addr?day= (DECIMATOR-01/05 + D-07 activity score)
//                 + /player/:addr/decimator?level=&day= (INTEG-03; Wave 2)
//   Dual stale-guards -- #decimatorPlayerFetchId + #decimatorLevelFetchId
//   D-07 activity-score cross-reference -- reads scoreBreakdown.totalBps
//   D-08 -- THREE subscriptions (replay.level + replay.player + replay.day)
//   Score-unit discipline (Pitfall 8) -- formatBurnie for BURNIE amounts;
//                                         formatEth for ETH payoutAmount
//   Bucket range contract-truth (Pitfall 1) -- literals 12 + 5 in source
//                                              (contract-truth range, not the
//                                              CONTEXT D-03 encoding)
//   Empty state -- null bucket OR "No decimator activity" message

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 1 -> play/app -> up 1 -> play
const PLAY_ROOT = join(__dirname, '../..');
const PANEL = join(PLAY_ROOT, 'components', 'decimator-panel.js');

// ---------------------------------------------------------------------------
// Existence + registration
// ---------------------------------------------------------------------------

test('decimator-panel.js exists', () => {
  assert.ok(existsSync(PANEL), `expected ${PANEL} to exist`);
});

test('decimator-panel.js registers the <decimator-panel> custom element', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]decimator-panel['"]/);
});

test('decimator-panel.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('decimator-panel.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(\s*\)/);
  assert.match(src, /disconnectedCallback\s*\(\s*\)/);
});

// ---------------------------------------------------------------------------
// SHELL-01: no wallet-tainted imports (four forbidden paths; three newly added)
// ---------------------------------------------------------------------------

test('SHELL-01: decimator-panel.js does NOT import beta/components/decimator-panel.js (tag-name collision)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/decimator-panel\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import beta/components/terminal-panel.js (collision + wallet-tainted)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/terminal-panel\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import beta/app/decimator.js (ethers at line 4)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/decimator\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import beta/app/terminal.js (ethers at line 6)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/terminal\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import beta/app/utils.js (ethers at line 3)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

test('SHELL-01: decimator-panel.js does NOT import ethers directly', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
});

test('decimator-panel.js imports from beta/viewer/utils.js (wallet-free surface)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/viewer\/utils\.js['"]/);
});

test('decimator-panel.js imports subscribe + get from the reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/app\/store\.js['"]/);
  assert.match(src, /subscribe/);
  assert.match(src, /\bget\b/);
});

test('decimator-panel.js imports API_BASE from play/app/constants.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/app\/constants\.js['"]/);
  assert.match(src, /API_BASE/);
});

// ---------------------------------------------------------------------------
// Store wiring -- THREE subscriptions per D-08
// Decimator is BOTH level-aware (bucket/subbucket/payout) AND day-aware
// (activity score + terminal burns update per-day + INTEG-03 ?day=M
// historical scoping). Extends baf-panel's two-subscribe pattern by one.
// ---------------------------------------------------------------------------

test('decimator-panel.js subscribes to replay.level, replay.player, AND replay.day (D-08)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.level['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
});

// ---------------------------------------------------------------------------
// DECIMATOR-01: window status badge (D-05; binary OPEN/CLOSED Wave 1,
// 3-state OPEN/CLOSED/NOT_ELIGIBLE Wave 2 via INTEG-03 roundStatus).
// Per-level countdown DROPPED per Pitfall 4 -- the level-start timestamp is
// null in the play/ store (no /game/state polling in play/).
// ---------------------------------------------------------------------------

test('DECIMATOR-01: renders window-status data-bind with data-status attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']window-status["']/);
  assert.match(src, /data-status/);
});

// ---------------------------------------------------------------------------
// DECIMATOR-02: bucket + subbucket (stats row) + bucket-table (D-03)
// ---------------------------------------------------------------------------

test('DECIMATOR-02: renders bucket + subbucket data-binds (stats row)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']bucket["']/);
  assert.match(src, /data-bind=["']subbucket["']/);
});

test('DECIMATOR-02: renders bucket-table or bucket-rows container (D-03)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']bucket-table["']|data-bind=["']bucket-rows["']/);
});

test('DECIMATOR-02: uses aria-current for player bucket row highlighting (D-03 + gray-area decision)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /aria-current/);
});

// ---------------------------------------------------------------------------
// DECIMATOR-03: per-level effective + weighted burn amounts
// Both are wei-scale BURNIE (Pitfall 8 score-unit discipline enforced below)
// ---------------------------------------------------------------------------

test('DECIMATOR-03: renders effective + weighted data-binds', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']effective["']/);
  assert.match(src, /data-bind=["']weighted["']/);
});

// ---------------------------------------------------------------------------
// DECIMATOR-04: payout pill + INTEG-03 fetch
// data-won attribute drives CSS coloring (true/false/empty) per Pitfall 10
// ---------------------------------------------------------------------------

test('DECIMATOR-04: renders payout pill data-bind with data-won attribute', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']payout["']/);
  assert.match(src, /data-won/);
});

test('INTEG-03: fetches /player/${addr}/decimator?level= (with optional &day=)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/[^`'"]+\/decimator\?level=/);
});

// ---------------------------------------------------------------------------
// DECIMATOR-05: terminal sub-section conditional on terminal.burns.length > 0
// D-06 gate: hide the ENTIRE section (not just rows) when no burns.
// Pitfall 3 mitigation -- empty section with headers looks like stuck skeleton.
// ---------------------------------------------------------------------------

test('DECIMATOR-05: renders terminal-section data-bind (conditional container)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']terminal-section["']/);
});

test('DECIMATOR-05: checks terminal.burns.length for conditional render (D-06 gate / Pitfall 3)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /terminal[^.\n]*\.burns[^.\n]*\.length|burns\.length\s*(>|!==|\?)/);
});

test('DECIMATOR-05: renders terminal-burn-rows container (row loop target)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']terminal-burn-rows["']/);
});

// ---------------------------------------------------------------------------
// Extended /player/:addr?day= fetch (DECIMATOR-01 + DECIMATOR-05 + D-07)
// This endpoint is already shipped by Phase 51 INTEG-02; Wave 1 autonomous.
// ---------------------------------------------------------------------------

test('extended-player: fetches /player/${addr}?day= (Wave 1 autonomous)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\/player\/\$\{[^}]+\}\?day=|\/player\/[^`'"]+\?day=/);
});

// ---------------------------------------------------------------------------
// D-07 activity score cross-reference
// Reads from scoreBreakdown.totalBps (same store path profile-panel uses).
// Null-guard per Pitfall 14: totalBps can be null when historical snapshot fails.
// ---------------------------------------------------------------------------

test('D-07: reads scoreBreakdown.totalBps for activity score display', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /scoreBreakdown[^.\n]*\.totalBps|totalBps/);
});

test('D-07: renders activity-score data-bind', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']activity-score["']/);
});

// ---------------------------------------------------------------------------
// Dual stale-guards (mirror baf-panel.js pattern; RESEARCH Section 11)
// Two counters because extended-player and INTEG-03 fetches fire at different
// cadences (Pitfall 2 mitigation).
// ---------------------------------------------------------------------------

test('decimator-panel.js uses #decimatorPlayerFetchId stale-guard (extended-player fetch)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#decimatorPlayerFetchId/);
});

test('decimator-panel.js uses #decimatorLevelFetchId stale-guard (INTEG-03 fetch)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /#decimatorLevelFetchId/);
});

test('decimator-panel.js toggles is-stale class for keep-old-data-dim', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /is-stale/);
});

// ---------------------------------------------------------------------------
// Skeleton + content pattern (Phase 50 convention carried forward)
// ---------------------------------------------------------------------------

test('decimator-panel.js has data-bind="skeleton" and data-bind="content"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']skeleton["']/);
  assert.match(src, /data-bind=["']content["']/);
});

test('decimator-panel.js includes skeleton-shimmer class', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});

// ---------------------------------------------------------------------------
// Score-unit discipline (Pitfall 8 -- LOAD-BEARING per RESEARCH Section 13)
// ---------------------------------------------------------------------------
// Table from 55-PATTERNS.md Score-unit discipline section:
//
//   effectiveAmount (INTEG-03 + terminal.burns)  WEI-scale BURNIE  formatBurnie
//   weightedAmount  (INTEG-03 + terminal.burns)  WEI-scale BURNIE  formatBurnie
//   payoutAmount    (INTEG-03 response)          WEI-scale ETH     formatEth
//   bucket / subbucket / winningSubbucket        integer           String(v)
//   scoreBreakdown.totalBps                      integer bps       (v/10000).toFixed(2)
//   timeMultBps (terminal burn)                  integer bps       inline helper
//
// WARNING SIGNS OF BUG:
//   - Stats row shows "5832100000000000000000 BURNIE" (raw wei) -- missing formatBurnie
//   - Payout pill shows "412357 ETH" (raw wei as decimal) -- missing formatEth
//   - Bucket cell shows "null" literal -- missing null-guard

test('score-unit: decimator-panel uses formatBurnie for BURNIE amounts (effective/weighted/terminal)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /formatBurnie/);
});

test('score-unit: decimator-panel uses formatEth for ETH payoutAmount (DECIMATOR-04)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /formatEth/);
});

// ---------------------------------------------------------------------------
// Bucket-range CONTRACT TRUTH per Pitfall 1 / Assumption A6 (LOAD-BEARING)
// ---------------------------------------------------------------------------
// Contract source (BurnieCoin.sol:142-147) is authoritative over CONTEXT D-03:
//   DECIMATOR_BUCKET_BASE = 12
//   DECIMATOR_MIN_BUCKET_NORMAL = 5   (normal levels: 5..12, 8 possible)
//   DECIMATOR_MIN_BUCKET_100 = 2      (centennial levels: 2..12, 11 possible)
// SubBucket range: 0 to bucket-1 per DegenerusGameDecimatorModule.sol:27.
//
// Wave 1 implements bucketRange(level) helper with contract-truth constants.
// Wave 0 test asserts the literals 12 AND (5 or MIN_BUCKET_NORMAL) appear.
// These assertions REJECT any implementation encoding the CONTEXT D-03 range
// (which would not contain literal 12). See RESEARCH Pitfall 1 for the audit
// trail and the bucketRange helper shape prescribed in PATTERNS.

test('bucketRange contract-truth: source contains DECIMATOR_BUCKET_BASE literal 12 (Pitfall 1)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\b12\b/,
    'Expected literal 12 in source (DECIMATOR_BUCKET_BASE per BurnieCoin.sol:142); ' +
    'see 55-RESEARCH.md Pitfall 1 for the contract-truth bucket range');
});

test('bucketRange contract-truth: source contains MIN_BUCKET_NORMAL (literal 5 or named constant) (Pitfall 1)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /\b(5|MIN_BUCKET_NORMAL)\b/,
    'Expected literal 5 or MIN_BUCKET_NORMAL in source per BurnieCoin.sol:142; ' +
    'see 55-RESEARCH.md Pitfall 1 for the contract-truth bucket range');
});

// ---------------------------------------------------------------------------
// Empty-state handling (Pitfall 7: bucket=null when player did not burn)
// ---------------------------------------------------------------------------

test('decimator-panel.js handles empty state (bucket null / no decimator activity)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /bucket\s*==\s*null|bucket\s*===\s*null|!bucket|No decimator activity/);
});
