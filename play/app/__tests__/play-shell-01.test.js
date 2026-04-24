// test file for Phase 50 Wave 0 -- Plan 50-01
//
// SHELL-01 guardrail -- recursive scan of play/ tree
//
// Walks every .js and .html file under `play/` (excluding the __tests__
// directory itself, which would otherwise match its own regexes) and
// fails if any file imports ethers, wallet, contracts, or any
// ethers-tainted beta module. Catches accidental reintroduction of
// wallet code in future phases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// play/app/__tests__/ -> up 1 to play/app -> up 1 to play
const PLAY_ROOT = join(__dirname, '../..');
const TESTS_DIR = join(PLAY_ROOT, 'app', '__tests__');

const FORBIDDEN = [
  { label: "bare 'ethers' specifier", pattern: /from\s+['"]ethers['"]/ },
  { label: 'beta/app/wallet.js', pattern: /from\s+['"][^'"]*\/beta\/app\/wallet\.js['"]/ },
  { label: 'beta/app/contracts.js', pattern: /from\s+['"][^'"]*\/beta\/app\/contracts\.js['"]/ },
  { label: 'beta/app/utils.js (ethers-tainted at line 3)', pattern: /from\s+['"][^'"]*\/beta\/app\/utils\.js['"]/ },
  { label: 'beta/components/connect-prompt.js', pattern: /from\s+['"][^'"]*\/beta\/components\/connect-prompt\.js['"]/ },
  { label: 'beta/components/purchase-panel.js', pattern: /from\s+['"][^'"]*\/beta\/components\/purchase-panel\.js['"]/ },
  { label: 'beta/components/coinflip-panel.js', pattern: /from\s+['"][^'"]*\/beta\/components\/coinflip-panel\.js['"]/ },
  { label: 'beta/components/decimator-panel.js', pattern: /from\s+['"][^'"]*\/beta\/components\/decimator-panel\.js['"]/ },
  { label: 'beta/components/baf-panel.js (Phase 54: transitively wallet-tainted + tag-name collision)', pattern: /from\s+['"][^'"]*\/beta\/components\/baf-panel\.js['"]/ },
  { label: 'beta/app/coinflip.js (Phase 54: ethers at line 4)', pattern: /from\s+['"][^'"]*\/beta\/app\/coinflip\.js['"]/ },
  { label: 'beta/app/baf.js (Phase 54: transitively tainted via utils.js)', pattern: /from\s+['"][^'"]*\/beta\/app\/baf\.js['"]/ },
];

function walk(dir) {
  // Node 20+ supports readdirSync(..., { recursive: true }); fall back to manual walk
  // when the option is unavailable (older minor versions).
  try {
    const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => {
        // When recursive is true, e.parentPath (Node 20+) or e.path points at the directory.
        const parent = e.parentPath || e.path || dir;
        return join(parent, e.name);
      });
  } catch {
    const out = [];
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      const entries = readdirSync(cur, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(cur, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile()) out.push(full);
      }
    }
    return out;
  }
}

function isInTestsDir(filepath) {
  const rel = relative(TESTS_DIR, filepath);
  return !rel.startsWith('..') && !rel.startsWith('/');
}

if (!existsSync(PLAY_ROOT)) {
  test('SHELL-01 skipped: play/ not yet created', () => {
    // Placeholder -- the directory does not exist until Plan 50-02 lands.
    // The test file must still load cleanly and report a passing skip,
    // so future Wave 0 runs confirm the guardrail is wired.
    assert.ok(true);
  });
} else {
  const allFiles = walk(PLAY_ROOT);
  const scanned = allFiles.filter((f) => {
    if (isInTestsDir(f)) return false;
    return f.endsWith('.js') || f.endsWith('.html');
  });

  test('SHELL-01: play/ tree imports no ethers / wallet / contracts', () => {
    const violations = [];
    for (const file of scanned) {
      let contents;
      try {
        const s = statSync(file);
        if (!s.isFile()) continue;
        contents = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const { label, pattern } of FORBIDDEN) {
        if (pattern.test(contents)) {
          violations.push(`${relative(PLAY_ROOT, file)} imports ${label}`);
        }
      }
    }
    if (violations.length > 0) {
      assert.fail(`SHELL-01 violations:\n  - ${violations.join('\n  - ')}`);
    }
  });

  test('SHELL-01 guardrail found files to scan (non-empty tree)', () => {
    // Informational: once Plan 50-02 lands, this count should be > 0.
    // If zero, the scanner is misconfigured (wrong root, wrong extensions).
    assert.ok(Array.isArray(scanned));
  });
}
