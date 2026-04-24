// test file for Phase 52 Wave 0 -- Plan 52-01
//
// SHELL-01 regression guard on beta/components/jackpot-panel.js post-D-09
// patch. The existing play-shell-01.test.js only scans the play/ tree;
// this dedicated test guards a beta-tree file. After the Wave 0 patch
// swaps '../app/utils.js' -> '../viewer/utils.js' at line 7, this test
// catches any accidental beta-side revert in future work.
//
// Test style: contract-grep (readFileSync + regex). Mirrors the FORBIDDEN-
// array pattern in play-shell-01.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 3 to website/ root
const REPO_ROOT = join(__dirname, '../../..');
const BETA_JACKPOT = join(REPO_ROOT, 'beta', 'components', 'jackpot-panel.js');

test('SHELL-01 regression: beta/components/jackpot-panel.js does NOT import ../app/utils.js', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  assert.doesNotMatch(
    src,
    /from\s+['"][^'"]*\.\.\/app\/utils\.js['"]/,
    'D-09 patch regression: beta/components/jackpot-panel.js must not re-introduce the wallet-tainted import. Expected line 7 swapped to ../viewer/utils.js.'
  );
});

test('SHELL-01 regression: beta/components/jackpot-panel.js imports formatEth from ../viewer/utils.js', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  assert.match(
    src,
    /from\s+['"][^'"]*\.\.\/viewer\/utils\.js['"]/,
    'D-09 patch expected: beta/components/jackpot-panel.js must import formatEth from ../viewer/utils.js (the wallet-free mirror).'
  );
});

test('SHELL-01 regression: beta/components/jackpot-panel.js import count sanity (5-7 top-level imports)', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  const importLines = src.split('\n').filter((l) => /^import\s/.test(l));
  assert.ok(
    importLines.length >= 5 && importLines.length <= 7,
    `expected 5-7 top-level imports in beta/components/jackpot-panel.js, found ${importLines.length}. This sanity check flags any large import surface change that might re-introduce wallet-tainted modules.`
  );
});

test('SHELL-01 regression: no ethers bare specifier in beta/components/jackpot-panel.js', () => {
  const src = readFileSync(BETA_JACKPOT, 'utf8');
  assert.doesNotMatch(
    src,
    /from\s+['"]ethers['"]/,
    'beta/components/jackpot-panel.js must never import from the bare ethers specifier -- play/ imports this file directly post-D-09.'
  );
});
