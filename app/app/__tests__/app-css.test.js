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
//   - Legacy Phase 56-62 panel selectors remain present after later UI work.
//   - No destructive `display: none` on critical CTAs (Buy / Claim / Affiliate).
//   - Phase 62 .qst-slots mobile rule remains present (independent of line drift).
//
// All tests read app.css via fs.readFileSync — no shell spawn.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    // Match a `app-packs-panel ... lbx-buy-button { ... display: none ... }` block
    // (block-bounded like the clm-row test below — Phase 64 appends unrelated
    // display:none rules further down the file).
    const buyButtonHidden = /app-packs-panel[^{]*lbx-buy-button[^{}]*\{[^}]*display:\s*none/i.test(
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
// MOB-02-CSS-05 — Legacy coverage + append marker.
// ===========================================================================

describe('app.css legacy coverage and append marker', () => {
  test('legacy Phase 56-62 panel surfaces remain styled', () => {
    for (const selector of [
      '.chain-chip',
      '.wallet-picker-modal',
      '.app-packs-panel',
      '.app-degenerette-panel',
      '.qst-slots',
      '.app-affiliate-panel',
    ]) {
      assert.ok(cssSrc.includes(selector), `legacy selector remains: ${selector}`);
    }
  });

  test('Phase 62 .qst-slots mobile collapse survives line-number drift', () => {
    assert.match(
      cssSrc,
      /@media\s*\(\s*max-width:\s*600px\s*\)\s*\{[\s\S]*?\.qst-slots\s*\{[\s\S]*?grid-template-columns:\s*1fr/s,
      'qst-slots collapses to one column at 600px',
    );
  });

  test('Phase 63 append marker remains after the original baseline boundary', () => {
    // The first occurrence of "Phase 63 D-03" must be at line >= 1552.
    const idx = cssLines.findIndex((l) => l.includes('Phase 63 D-03'));
    assert.ok(idx >= 1551, `first Phase 63 marker at line index ${idx} (>=1551 = line >=1552)`);
  });
});

// ===========================================================================
// MOB-02-CSS-06 — Total LOC budget (~200-300 LOC of additions).
// ===========================================================================

describe('app.css LOC budget', () => {
  test('total file is in 1700-25300 line range (baseline + deliberate app UI feature blocks)', () => {
    assert.ok(cssLines.length >= 1700, `total >=1700, got ${cssLines.length}`);
    // Ceiling raised 4400 → 4600 for the ~157-line gold-rush headline block
    // (the last section in the file). Still a hard guard against this file
    // becoming a dumping ground — bump it deliberately, per feature, not by default.
    // 4600 → 4750 for the ~104-line MINE FLIP widget block (app-mine-flip.js):
    // one deliberate feature, appended last.
    // 4750 → 4900 for the nav activity chip + its hover breakdown
    // (app-activity-chip.js) and the quest panel's primary-quest status rules.
    // 4900 → 5100 for the ~178-line parimutuel side-bets block
    // (app-parimutuel-panel.js): one deliberate feature, appended last.
    // 5100 → 5250 for the deferred-reveal ticket card sizing and the foil-edge
    // + gold-quadrant treatment in the ticket inventory.
    // 5250 → 5360 for the Degenerette bet board (one row per spin in the reveal
    // overlay) plus its running-winnings tracker and TAP TO SPIN gate: one
    // deliberate feature, appended last.
    // 5360 → 5400 for the side-bet book share bar + benchmark line (the payout
    // quote it replaced was a lie in a parimutuel).
    // 5400 → 5460 for two appended blocks: the jackpot board chrome trim (drop
    // the entries bar, move the single roll button under the board) and the
    // window-gated FLIP ticket buy in the buy panel.
    // 5460 → 5670 for the branded standard/foil wrappers, persistent level
    // labels, four-ticket foil presentation, and the branded lootbox opening.
    // 5670 → 6400 for the claimable-first purchase refinements, flip meter,
    // aligned second three-panel instrument, and the full eight-lock
    // Degenerette player embedded in its center widget.
    // 6400 → 7100 for the game-style quest redesign, richer side-bet books,
    // pack/lootbox reveal shelf and exact grids, digital purchase ledgers, and
    // the in-widget Degenerette round-results mode.
    // 7100 → 8800 for the completed three-panel play surface, compact
    // Degenerette editor/player, stacked coinflip ledger + reverse treatment,
    // responsive purchase refinements, onboarding/reveal layouts, and the
    // shared balance-award animation. Keep a small margin for targeted fixes;
    // the next substantial surface should be split into a component stylesheet.
    // 8800 → 20000 covers the subsequent cohesive play-surface pass: jackpot
    // resolution presentation, the quest/coinflip/BAF instruments, responsive
    // pass checkout, reveal choreography, and lazy transaction history. Keep a
    // narrow ceiling so future growth still requires an explicit decision.
    // 20000 → 20250 adds the full-screen Decimator draw host and its temporary
    // primary-jackpot action treatment. This remains a narrow feature bump.
    // 20250 → 20500 for the AFKing subscription workspace (head, quick strip,
    // edit dialog) and the determinate --jp-progress fill on the jackpot
    // processing button. Two deliberate features.
    // 20500 → 21500 for the 2026-08-07 play-surface refinement pass. Unlike
    // every bump above it, this one is NOT a new block appended at the end: the
    // ~650 added lines are distributed through the existing reveal, parimutuel,
    // foil/ticket, jackpot-board and pass-desk sections (section starts moved
    // 18594 → 19273, 13721 → 14138, 11603 → 11800), so it is refinement of
    // surfaces already here rather than new surface area.
    //
    // Distributed growth is the shape this guard is least able to police — no
    // single block to point at, so it accretes quietly. The 350-line headroom is
    // deliberately tight for that reason: the next bump should have to justify
    // itself again, and the note at 8800 above about splitting into a component
    // stylesheet is now overdue, not aspirational.
    // 21500 → 21600 covers the tightly scoped referral-coin face isolation,
    // three ticket-reveal size buckets, and corrected phone Whale quantity
    // controls. These refine three existing sections rather than add a surface.
    // 21600 → 22400 covers the launch-claim/boon review refinements and the
    // responsive, full-width Decimator burn rail. The latter is one deliberate
    // new surface; the remaining 100-line margin keeps the ceiling tight.
    // 22400 → 22500 adds the compact Box Spin payout-at-risk ledger and its
    // phone stack, making S2+ wins readable before the survival toss.
    // 22500 → 22700 covers the compact deity target suggestions, responsive
    // Pending control rail, and the sDGNRS burn slider. These are refinements
    // to existing controls; the small remainder keeps the guard deliberate.
    // 22700 → 22800 covers the deity desk restyle: the daily boon budget line,
    // the shared gold plate behind the four action keys, and the lockup's
    // choose-your-symbol placeholder. Refinements to one existing surface.
    // 22800 → 23600 covers the Biggest Bounties records-rail rework published
    // f15da88: the bounty transaction dialog, the four leader cards with the
    // shared card art and portrait presentation, the wordmark identity block,
    // and the level/resolution panel polish that shipped alongside it. One
    // deliberate new surface (the dialog) plus its phone stacks; the ~170-line
    // margin keeps the next bump honest.
    // 23600 → 23700 covers the shared reveal action dock and the in-place
    // Decimator draw retry state. Both harden existing fullscreen surfaces.
    // 23700 → 23850 for the jackpot hero art pass: cabinet lighting on the
    // hero and its draw column, and one button state system applied to both
    // controls that live in the cabinet — the day-history keys and the new-day
    // banner's View now. Each gains rest/hover/active/focus-visible/disabled;
    // neither previously had a pressed state or a focus indicator that hover
    // could not be mistaken for. No new surface: ~110 lines across three
    // existing blocks, over half of it the state rules and their comments.
    // 23850 → 24075 covers the compact quest reward rail, familiar state
    // glyphs, and persistent victory treatment. This refines one surface.
    // 24075 → 24150 covers the grouped multi-Luckbox receipt: its per-box
    // sections and the shared combo-rewards section refine the reveal summary.
    // 24150 → 24275 replaces the raw utility-style cash-out popup with two
    // responsive asset cards, compact balance readouts, and complete control states.
    // 24275 → 24400 registers the canonical Small, Medium, and Large
    // Luckbox cases across Buy In, Pending, and the full-screen opener. This
    // refines one existing product family and keeps only six lines of headroom.
    // 24400 → 24700 covers the completed cash-out asset sheet plus the shared
    // fixed reveal-action dock and its responsive two-choice Luckbox controls.
    // These refine existing transaction and reveal surfaces; ~68 lines remain.
    // 24700 → 25000 covers the player-funds dialog (.pfd-*) and the coinflip
    // auto-rebuy dialog reaching their finished card layouts. Both are existing
    // surfaces gaining their real chrome, not new families; ~290 lines remain.
    // 25000 → 25050 for the craps lobby's combined TOMORROW range cell and the
    // Discord winner identity (.craps-entry__tomorrow-range / __winner-pfp):
    // five deliberate lines on an existing surface, landed with one line of
    // headroom left in the previous budget.
    // 25050 → 25300 for three blocks, none of them a new family: the LINK
    // donation live multiplier + FLIP quote in the player-funds dialog
    // (.pfd-link__quote / __conversion), the craps day receipt card in the
    // reveal tray (.rvl-card--craps-result and its badge), and the
    // z-index/pointer-events repair on .rvl-ticket-actions. ~68 lines of
    // headroom; the overdue component-stylesheet split noted at 8800 above
    // still has not happened, and this file is now ten times that budget.
    assert.ok(cssLines.length <= 25_300, `total <=25300, got ${cssLines.length}`);
  });
});
