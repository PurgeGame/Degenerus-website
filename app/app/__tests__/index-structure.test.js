// /app/app/__tests__/index-structure.test.js — Phase 64 basic-mode layout structure.
//
// Run: cd website && node --test app/app/__tests__/index-structure.test.js
//
// Source-grep tests over app/index.html (readFileSync + indexOf ordering, same
// style as app-css.test.js — no DOM, no shell spawn). Guards the degen-first
// basic-mode skeleton (chrome-strip revision — user call):
//   - body carries layout-basic (PIT later adds layout-pro without rework)
//   - NO page-header/search block — the nav bar carries logo + Discord + wallet;
//     content starts at chain chip → jackpot hero (purchase +
//     draw + coinflip, ONE widget) → quests/degenerette/side-bets grid →
//     tickets inventory → more-ways → footer
//   - aggregate claims and winnings strips are unmounted
//   - lootboxes + passes live inside the collapsed <details class="more-ways">
//   - quests / boons / affiliate panels and their script tags are absent
//     (files stay on disk; THE PIT re-adds them in pro mode)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolvePath(__dirname, '../../index.html');
const html = readFileSync(htmlPath, 'utf8');

describe('index.html basic-mode skeleton', () => {
  test('body carries the layout-basic class', () => {
    assert.match(html, /<body class="layout-basic">/);
  });

  test('top-to-bottom element order', () => {
    const order = [
      'class="chain-chip-row"',
      'class="jackpot-hero"',
      'class="jackpot-hero__draw"',
      '<last-day-jackpot>',
      '<replay-panel',
      '<app-daily-flip>',
      '<app-decimator-panel>',
      'class="play-grid"',
      '<app-quest-panel>',
      '<app-degenerette-panel>',
      '<app-parimutuel-panel>',
      '<app-tickets-inventory>',
      'class="more-ways"',
      '<app-pass-section>',
      '<footer>',
    ];
    let prev = -1;
    for (const marker of order) {
      const idx = html.indexOf(marker);
      assert.ok(idx !== -1, `marker present: ${marker}`);
      assert.ok(idx > prev, `marker in order: ${marker} (idx ${idx} > prev ${prev})`);
      prev = idx;
    }
  });

  test('chrome strip: no page-header block (nav carries logo + Discord + wallet)', () => {
    assert.equal(html.indexOf('class="page-header"'), -1, 'page-header removed');
  });

  test('day summary CTA has a landing slot beneath the middle draw', () => {
    const drawMatch = html.match(/<div class="jackpot-hero__draw">([\s\S]*?)<\/div>/);
    assert.ok(drawMatch, 'middle draw block present');
    assert.match(drawMatch[1], /<last-day-jackpot>/);
    assert.match(drawMatch[1], /<replay-panel/);
    assert.match(drawMatch[1], /data-bind="day-summary-slot" hidden/,
      'the landing slot consumes no height until the summary unlocks');
  });

  test('global address / affiliate search is removed', () => {
    assert.equal(html.indexOf('class="player-search-row"'), -1, 'search row removed');
    assert.equal(html.indexOf('<player-dropdown'), -1, 'search custom element removed');
    assert.equal(html.indexOf('components/player-dropdown.js'), -1, 'search script removed');
  });

  test('first-visit onboarding offers wallet connect and the sDGNRS tutorial', () => {
    assert.ok(html.includes('<app-onboarding>'), 'onboarding element mounted');
    assert.ok(html.includes('src="/app/components/app-onboarding.js"'),
      'onboarding component script loaded');
  });

  test('aggregate claims banner and winnings strip are removed', () => {
    assert.equal(html.indexOf('<app-claims-panel'), -1, 'claims panel unmounted');
    assert.equal(html.indexOf('components/app-claims-panel.js'), -1, 'claims script removed');
    assert.equal(html.indexOf('<app-balances-strip'), -1, 'winnings strip unmounted');
    assert.equal(html.indexOf('components/app-balances-strip.js'), -1, 'winnings strip script removed');
  });





  test('more-ways is the afKing Passes drawer (packs panel gone — combined buy owns lootboxes)', () => {
    const detailsMatch = html.match(/<details class="more-ways">([\s\S]*?)<\/details>/);
    assert.ok(detailsMatch, '<details class="more-ways"> block present');
    assert.match(detailsMatch[1], /<summary class="more-ways__summary">afKing Passes<\/summary>/);
    assert.match(detailsMatch[1], /<app-pass-section>/);
    assert.equal(html.indexOf('<app-packs-panel>'), -1, 'packs panel unmounted');
    assert.equal(html.indexOf('components/app-packs-panel.js'), -1, 'packs script removed');
  });

  test('boons / affiliate / coinflip-deposit panels absent (pro-mode surfaces)', () => {
    // app-coinflip-panel unmounted (user call): the flip stake input lives in
    // the hero's coinflip column (app-daily-flip); the file stays on disk.
    // app-quest-panel is now MOUNTED (user ask: quests + activity + streaks).
    for (const tag of ['app-boons-panel', 'app-affiliate-panel', 'app-coinflip-panel']) {
      assert.equal(html.indexOf(`<${tag}`), -1, `<${tag}> element absent`);
      assert.equal(html.indexOf(`components/${tag}.js`), -1, `${tag}.js script tag absent`);
    }
  });

  test('second three-panel block is Quests left, Degenerette middle, Side Bets right', () => {
    const rowMatch = html.match(/<section class="play-grid"[\s\S]*?<\/section>/);
    assert.ok(rowMatch, '<section class="play-grid"> present');
    const row = rowMatch[0];
    const quest = row.indexOf('<app-quest-panel>');
    const degenerette = row.indexOf('<app-degenerette-panel>');
    const pari = row.indexOf('<app-parimutuel-panel>');
    assert.ok(quest >= 0 && quest < degenerette, 'quests are left/first');
    assert.ok(degenerette < pari, 'Degenerette is middle and side bets are right');
  });

  test('standalone and nav activity widgets are removed (Degen Score lives in Quests)', () => {
    assert.equal(html.indexOf('<app-activity-panel'), -1, 'standalone activity panel unmounted');
    assert.equal(html.indexOf('components/app-activity-panel.js'), -1, 'activity panel script removed');
    assert.equal(html.indexOf('components/app-activity-chip.js'), -1, 'nav activity chip script removed');
    assert.equal(html.indexOf('progress-row--activity'), -1, 'activity row removed');
  });

  test('dead #app-root loading block removed', () => {
    assert.equal(html.indexOf('app-root'), -1);
    assert.equal(html.indexOf('app-loading-state'), -1);
  });

  test('ids targeted by JS survive the restructure', () => {
    assert.match(html, /id="chain-chip"/);
  });

  test('view-mode banner div removed; its script stays (data-write manager)', () => {
    assert.equal(html.indexOf('id="view-mode-banner"'), -1, 'banner div removed');
    assert.ok(html.includes('src="/app/components/view-mode-banner.js"'),
      'view-mode-banner.js still loaded — it owns the [data-write] disable manager');
  });

  test('all shipped panel script tags present', () => {
    for (const src of [
      '/app/app/main.js',
      '/app/components/wallet-picker.js',
      '/app/components/app-onboarding.js',
      '/app/components/view-mode-banner.js',
      '/app/components/last-day-jackpot.js',
      '/beta/components/replay-panel.js',
      '/app/components/app-decimator-panel.js',
      '/app/components/app-degenerette-panel.js',
      '/app/components/app-pass-section.js',
      '/app/components/app-tickets-inventory.js',
      '/app/components/app-daily-flip.js',
      '/app/components/app-parimutuel-panel.js',
      '/app/components/app-quest-panel.js',
    ]) {
      assert.ok(html.includes(`src="${src}"`), `script tag: ${src}`);
    }
  });
});
