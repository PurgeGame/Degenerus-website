// test file for Phase 53 Option B -- Plan 53-01
//
// Covers: PURCHASE-01, PURCHASE-02, PURCHASE-03, PURCHASE-04
//
// Asserts the contract the <purchase-panel> Custom Element must satisfy
// after Phase 53 Option B ships. Scope (Option B per 53-SCOPE-ASSESSMENT.md):
//   - PURCHASE-03 (price / level / cycle / total-cost display) ships LIVE
//     against the existing Proxy store.
//   - PURCHASE-01 / PURCHASE-02 ship as UI SCAFFOLD -- disabled buttons with
//     `data-gate="sim-api"` + tooltip linking to PURCHASE-API-SPEC.md.
//   - PURCHASE-04 piggybacks on Phase 52's <packs-panel> stale-guard (no
//     purchase-panel-owned assertion).
//   - SIM-01 (sim HTTP API) is a future requirement; when it ships, the
//     sim-api gate lifts and these tests evolve to drive live POST calls.
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
const PANEL = join(PLAY_ROOT, 'components', 'purchase-panel.js');

// ---------------------------------------------------------------------------
// Existence + registration
// ---------------------------------------------------------------------------

test('purchase-panel.js exists', () => {
  assert.ok(existsSync(PANEL), 'expected play/components/purchase-panel.js to exist');
});

test('purchase-panel.js is an ES module (uses import statements)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /^\s*import\s+/m, 'expected at least one ES import');
});

test('purchase-panel.js registers <purchase-panel>', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /customElements\.define\(\s*['"]purchase-panel['"]/);
});

test('purchase-panel.js defines a class extending HTMLElement', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /class\s+\w+\s+extends\s+HTMLElement/);
});

test('purchase-panel.js has connectedCallback and disconnectedCallback', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /connectedCallback\s*\(/);
  assert.match(src, /disconnectedCallback\s*\(/);
});

// ---------------------------------------------------------------------------
// Subscription wiring (day + player + level + price awareness)
// ---------------------------------------------------------------------------

test('purchase-panel subscribes to replay.day', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.day['"]/);
});

test('purchase-panel subscribes to replay.player', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]replay\.player['"]/);
});

test('PURCHASE-03: purchase-panel subscribes to game.level (level + cycle drive display)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]game\.level['"]/);
});

test('PURCHASE-03: purchase-panel subscribes to game.price (price drives total-cost)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /subscribe\(\s*['"]game\.price['"]/);
});

test('purchase-panel imports subscribe + get from reused beta store', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s*['"]\.\.\/\.\.\/beta\/app\/store\.js['"]/);
  assert.match(src, /\bsubscribe\b/);
  assert.match(src, /\bget\b/);
});

// ---------------------------------------------------------------------------
// SHELL-01 reinforcement: no wallet-tainted imports
// ---------------------------------------------------------------------------

test('SHELL-01: purchase-panel does NOT import ethers', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"]ethers['"]/);
});

test('SHELL-01: purchase-panel does NOT import beta/app/wallet.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/wallet\.js['"]/);
});

test('SHELL-01: purchase-panel does NOT import beta/app/contracts.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/contracts\.js['"]/);
});

test('SHELL-01: purchase-panel does NOT import beta/app/utils.js (ethers-tainted at line 3)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/);
});

test('SHELL-01: purchase-panel does NOT import beta/app/purchases.js (imports ethers)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/app\/purchases\.js['"]/);
});

test('SHELL-01: purchase-panel does NOT import beta/components/purchase-panel.js (wallet-tainted)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*\/beta\/components\/purchase-panel\.js['"]/);
});

test('purchase-panel imports formatEth from wallet-free beta/viewer/utils.js', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /from\s+['"][^'"]*\/beta\/viewer\/utils\.js['"]/);
  assert.match(src, /\bformatEth\b/);
});

// ---------------------------------------------------------------------------
// PURCHASE-03: live display bindings (level / cycle / price / quantity / total)
// ---------------------------------------------------------------------------

test('PURCHASE-03: renders price-display binding', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']price-display["']/);
});

test('PURCHASE-03: renders level-display binding', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']level-display["']/);
});

test('PURCHASE-03: renders cycle-display binding (cycle = floor(level / 100))', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']cycle-display["']/);
});

test('PURCHASE-03: renders total-cost binding', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']total-cost["']/);
});

test('PURCHASE-03: renders quantity-input binding', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']quantity-input["']/);
});

test('PURCHASE-03: quantity input uses type="number"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /type=["']number["']/);
});

test('PURCHASE-03: cycle computed as Math.floor(level / 100) somewhere in source', () => {
  const src = readFileSync(PANEL, 'utf8');
  // Allow either `Math.floor(... / 100)` or `/ 100)` style patterns.
  assert.match(src, /Math\.floor\(\s*(?:Number\()?\s*\w+[^)]*\/\s*100/);
});

// ---------------------------------------------------------------------------
// PURCHASE-01 / PURCHASE-02: sim-api gated buttons
// ---------------------------------------------------------------------------

test('PURCHASE-01: renders a sim-api-gated button with data-buy-type="tickets"', () => {
  const src = readFileSync(PANEL, 'utf8');
  // Match a button element that has both data-gate="sim-api" and
  // data-buy-type="tickets" attributes (order-independent within a single
  // <button ...> tag). Use a permissive regex because attributes may span
  // newlines in the template literal.
  assert.match(
    src,
    /<button[\s\S]*?data-gate=["']sim-api["'][\s\S]*?data-buy-type=["']tickets["']/,
    'expected <button data-gate="sim-api" data-buy-type="tickets" ...>',
  );
});

test('PURCHASE-02: renders a sim-api-gated button with data-buy-type="lootbox"', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(
    src,
    /<button[\s\S]*?data-gate=["']sim-api["'][\s\S]*?data-buy-type=["']lootbox["']/,
    'expected <button data-gate="sim-api" data-buy-type="lootbox" ...>',
  );
});

test('PURCHASE-01/02: both gated buttons have aria-disabled="true"', () => {
  const src = readFileSync(PANEL, 'utf8');
  // At least two occurrences (one per button).
  const matches = src.match(/aria-disabled=["']true["']/g) || [];
  assert.ok(
    matches.length >= 2,
    `expected >= 2 aria-disabled="true" attributes on gated buttons, found ${matches.length}`,
  );
});

test('PURCHASE-01/02: gated buttons include a title= tooltip referencing PURCHASE-API-SPEC.md or sim API', () => {
  const src = readFileSync(PANEL, 'utf8');
  // Any <button ... title="..."> whose title text mentions "sim API" or the spec path.
  assert.match(
    src,
    /title=["'][^"']*(?:sim API|PURCHASE-API-SPEC\.md)[^"']*["']/,
    'expected title attribute with "sim API" or "PURCHASE-API-SPEC.md" text',
  );
});

// ---------------------------------------------------------------------------
// Tab UI: toggle between ticket and lootbox forms
// ---------------------------------------------------------------------------

test('Tab UI: renders tab-tickets binding', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']tab-tickets["']/);
});

test('Tab UI: renders tab-lootbox binding', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']tab-lootbox["']/);
});

// ---------------------------------------------------------------------------
// Skeleton-to-content swap pattern (D-01; follow profile-panel)
// ---------------------------------------------------------------------------

test('D-01: renders skeleton binding', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']skeleton["']/);
});

test('D-01: renders content binding', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /data-bind=["']content["']/);
});

test('D-01: retains skeleton-shimmer class in template (Phase 50 stub-parity)', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /skeleton-shimmer/);
});
