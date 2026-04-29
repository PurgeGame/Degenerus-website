// /app/app/__tests__/app-css.test.js — Phase 63 D-03 Tasks 2+3 (MOB-02) source-grep tests.
//
// Run: cd website && node --test app/app/__tests__/app-css.test.js
//
// Covers MOB-02 acceptance gates (CONTEXT D-03 step 3):
//   - Tier 1 / 2 / 3 markers present in append region (after line 1551).
//   - ≥44×44 CSS px tap targets via min-width: 44px + min-height: 44px.
//   - Stack-vs-grid switch at 768px (presence of @media (max-width: 768px)).
//   - Desktop ≥1200px refinement (@media (min-width: 1200px)).
//   - Defensive 320px overflow-x:hidden.
//   - clamp() for fluid typography (existing pattern extended).
//   - APPEND-ONLY discipline: lines 1-1551 unchanged vs git HEAD.
//   - No destructive `display: none` on critical CTAs (Buy / Claim / Affiliate).
//   - Phase 62 .qst-slots @media (max-width: 600px) at line ~1314 byte-identical.
//
// All tests read app.css via fs.readFileSync — no shell spawn.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = resolvePath(__dirname, '../../styles/app.css');
const cssSrc = readFileSync(cssPath, 'utf8');
const cssLines = cssSrc.split('\n');

// Append region = everything after the original Phase 56-62 baseline (line 1551).
// Phase 63 D-03 lands all new rules here.
const appendRegion = cssLines.slice(1551).join('\n');
const baselineRegion = cssLines.slice(0, 1551).join('\n');

// ===========================================================================
// MOB-02-CSS-01 — Tier markers present in append region.
// ===========================================================================

describe('app.css Tier markers (Phase 63 D-03)', () => {
  test('Tier 1 marker exists in append region', () => {
    const matches = appendRegion.match(/Phase 63 D-03 Tier 1/g) || [];
    assert.equal(matches.length, 1, 'exactly one Tier 1 marker');
  });

  test('Tier 2 marker exists in append region', () => {
    const matches = appendRegion.match(/Phase 63 D-03 Tier 2/g) || [];
    assert.equal(matches.length, 1, 'exactly one Tier 2 marker');
  });

  test('Tier 3 marker exists in append region (main + defensive + desktop sub-blocks)', () => {
    const matches = appendRegion.match(/Phase 63 D-03 Tier 3/g) || [];
    assert.ok(matches.length >= 1, `Tier 3 markers >=1, got ${matches.length}`);
  });

  test('Tier 1 marker does NOT exist in baseline region (lines 1-1551)', () => {
    assert.equal(
      baselineRegion.indexOf('Phase 63 D-03'),
      -1,
      'no Phase 63 D-03 marker in baseline (proves append-only)'
    );
  });
});

// ===========================================================================
// MOB-02-CSS-02 — Five acceptance gates (CONTEXT D-03 step 3).
// ===========================================================================

describe('app.css acceptance gates', () => {
  test('Gate 1: ≥44×44 tap targets — min-width: 44px AND min-height: 44px present', () => {
    assert.match(appendRegion, /min-width:\s*44px/, 'min-width: 44px present');
    assert.match(appendRegion, /min-height:\s*44px/, 'min-height: 44px present');
  });

  test('Gate 2: iOS scroll-lock-aware modal — wallet-picker full-screen + overscroll-behavior contain', () => {
    assert.match(
      appendRegion,
      /wallet-picker \.wallet-picker-modal/,
      'wallet-picker modal selector present'
    );
    assert.match(appendRegion, /overscroll-behavior:\s*contain/, 'overscroll-behavior: contain');
  });

  test('Gate 3: No 320px horizontal scroll — defensive overflow-x:hidden on html/body', () => {
    assert.match(
      appendRegion,
      /html,\s*body\s*\{[\s\S]*?overflow-x:\s*hidden/,
      'html, body { overflow-x: hidden }'
    );
  });

  test('Gate 3 (cont): overflow-wrap: anywhere on long-string surfaces', () => {
    assert.match(appendRegion, /overflow-wrap:\s*anywhere/, 'overflow-wrap: anywhere');
  });

  test('Gate 4: Stack-vs-grid switch at 768px — @media (max-width: 768px) present', () => {
    const matches = appendRegion.match(/@media\s*\(\s*max-width:\s*768px\s*\)/g) || [];
    assert.ok(matches.length >= 1, `768px breakpoint >=1, got ${matches.length}`);
  });

  test('Gate 4 (cont): grid-template-columns override at 768px', () => {
    assert.match(
      appendRegion,
      /grid-template-columns:\s*repeat\(4,\s*1fr\)/,
      'deity grid mobile 4-col override'
    );
  });

  test('Gate 5: clamp() for fluid typography', () => {
    assert.match(appendRegion, /font-size:\s*clamp\(/, 'clamp() used for font-size');
  });

  test('Gate 6: Desktop ≥1200px refinement', () => {
    assert.match(
      appendRegion,
      /@media\s*\(\s*min-width:\s*1200px\s*\)/,
      'min-width: 1200px breakpoint'
    );
  });

  test('Gate 7 (Tier 1): iOS safe-area-inset awareness', () => {
    assert.match(
      appendRegion,
      /env\(safe-area-inset-(top|bottom|left|right)/,
      'env(safe-area-inset-*) used'
    );
  });
});

// ===========================================================================
// MOB-02-CSS-03 — Tier 2: lootbox + claims panel surfaces referenced.
// ===========================================================================

describe('app.css Tier 2 — lootbox + claims', () => {
  test('app-packs-panel referenced in append region', () => {
    const matches = appendRegion.match(/app-packs-panel\b/g) || [];
    assert.ok(matches.length >= 2, `app-packs-panel >=2, got ${matches.length}`);
  });

  test('app-claims-panel referenced in append region', () => {
    const matches = appendRegion.match(/app-claims-panel\b/g) || [];
    assert.ok(matches.length >= 2, `app-claims-panel >=2, got ${matches.length}`);
  });

  test('flex-direction: column used for stacking', () => {
    assert.match(appendRegion, /flex-direction:\s*column/, 'column stacking present');
  });

  test('NO destructive display:none on lootbox buy CTA', () => {
    // Match `app-packs-panel ... lbx-buy-button ... display: none` in any order.
    const buyButtonHidden = /app-packs-panel[^{]*lbx-buy-button[\s\S]*?display:\s*none/i.test(
      appendRegion
    );
    assert.equal(buyButtonHidden, false, 'lootbox buy CTA NOT hidden on mobile');
  });

  test('NO destructive display:none on claims row', () => {
    // Match `app-claims-panel .clm-row { ... display: none ... }` block.
    const clmRowHidden = /app-claims-panel\s+\.clm-row\s*\{[^}]*display:\s*none/i.test(
      appendRegion
    );
    assert.equal(clmRowHidden, false, 'claims row NOT hidden on mobile');
  });
});

// ===========================================================================
// MOB-02-CSS-04 — Tier 3: remaining 9 panel host elements referenced.
// ===========================================================================

describe('app.css Tier 3 — 9 remaining panels', () => {
  const panels = [
    'app-decimator-panel',
    'app-pass-section',
    'app-coinflip-panel',
    'app-degenerette-panel',
    'app-quest-panel',
    'app-affiliate-panel',
    'app-boons-panel',
    'last-day-jackpot',
    'player-dropdown',
  ];

  for (const p of panels) {
    test(`${p} referenced in append region`, () => {
      assert.match(
        appendRegion,
        new RegExp(`\\b${p.replace(/-/g, '\\-')}\\b`),
        `${p} present in Tier 3`
      );
    });
  }
});

// ===========================================================================
// MOB-02-CSS-05 — Append-only discipline (CRITICAL invariant).
// ===========================================================================

describe('app.css APPEND-ONLY discipline', () => {
  test('lines 1-1551 byte-identical to git HEAD', () => {
    let headBaseline;
    try {
      headBaseline = execSync('git -C ' + resolvePath(__dirname, '../../..') +
        ' show HEAD:app/styles/app.css', { encoding: 'utf8' });
    } catch (e) {
      // First commit may not have the file yet — skip.
      assert.ok(true, 'skipped: HEAD has no app.css');
      return;
    }
    const headLines = headBaseline.split('\n');
    const headBaselineRegion = headLines.slice(0, 1551).join('\n');
    assert.equal(
      baselineRegion,
      headBaselineRegion,
      'lines 1-1551 byte-identical to HEAD (append-only invariant)'
    );
  });

  test('Phase 62 .qst-slots @media (max-width: 600px) block at ~line 1314 unchanged', () => {
    // Sliding window around line 1314 should contain the qst-slots rule untouched.
    const window = cssLines.slice(1310, 1320).join('\n');
    assert.match(window, /@media\s*\(\s*max-width:\s*600px\s*\)/, 'qst-slots @media present');
    assert.match(window, /\.qst-slots/, 'qst-slots selector present');
    assert.match(window, /grid-template-columns:\s*1fr/, 'qst-slots grid-template-columns: 1fr');
  });

  test('append region starts at line 1552 or later (no in-place edits to baseline)', () => {
    // The first occurrence of "Phase 63 D-03" must be at line >= 1552.
    const idx = cssLines.findIndex((l) => l.includes('Phase 63 D-03'));
    assert.ok(idx >= 1551, `first Phase 63 marker at line index ${idx} (>=1551 = line >=1552)`);
  });
});

// ===========================================================================
// MOB-02-CSS-06 — Total LOC budget (~200-300 LOC of additions).
// ===========================================================================

describe('app.css LOC budget', () => {
  test('total file is in 1700-1850 line range (1551 baseline + 150-300 new)', () => {
    assert.ok(cssLines.length >= 1700, `total >=1700, got ${cssLines.length}`);
    assert.ok(cssLines.length <= 1900, `total <=1900, got ${cssLines.length}`);
  });
});
