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
//   - boons and the legacy coinflip panel remain absent; Referrals is mounted
//     at the page bottom, directly below Transaction History

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolvePath(__dirname, '../../index.html');
const html = readFileSync(htmlPath, 'utf8');
const onboarding = readFileSync(resolvePath(__dirname, '../../components/app-onboarding.js'), 'utf8');
const appCss = readFileSync(resolvePath(__dirname, '../../styles/app.css'), 'utf8');

describe('index.html basic-mode skeleton', () => {
  test('body carries the layout-basic class', () => {
    assert.match(html, /<body class="layout-basic">/);
  });

  test('top-to-bottom element order', () => {
    const order = [
      'class="chain-chip-row"',
      'class="jackpot-hero"',
      'class="jackpot-hero__draw"',
      'class="jackpot-hero__machine"',
      '<last-day-jackpot>',
      '<replay-panel',
      '<app-daily-flip>',
      '<app-decimator-panel>',
      'class="play-grid"',
      '<app-quest-panel>',
      '<app-degenerette-panel>',
      '<app-parimutuel-panel>',
      '<app-tickets-inventory>',
      'class="more-ways section-disclosure"',
      '<app-pass-section>',
      '<app-sdgnrs-burn-rail>',
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
    const drawStart = html.indexOf('<div class="jackpot-hero__draw">');
    const drawEnd = html.indexOf('<app-daily-flip>', drawStart);
    assert.ok(drawStart >= 0 && drawEnd > drawStart, 'middle draw block present');
    const draw = html.slice(drawStart, drawEnd);
    assert.match(draw, /<last-day-jackpot>/);
    assert.match(draw, /<replay-panel/);
    assert.match(draw,
      /<div class="jackpot-hero__machine">[\s\S]*?<replay-panel single-button><\/replay-panel>[\s\S]*?<\/div>\s*<nav class="jackpot-day-history"/,
      'the art-backed machine closes before controls that may expand the draw column');
    assert.match(draw, /data-bind="day-summary-slot" hidden/,
      'the landing slot consumes no height until the summary unlocks');
    assert.match(draw, /class="jackpot-day-history"[^>]*hidden/,
      'past-day controls consume no height during the live day');
  });

  test('global address / affiliate search is removed', () => {
    assert.equal(html.indexOf('class="player-search-row"'), -1, 'search row removed');
    assert.equal(html.indexOf('<player-dropdown'), -1, 'search custom element removed');
    assert.equal(html.indexOf('components/player-dropdown.js'), -1, 'search script removed');
  });

  test('first-visit onboarding offers wallet connect and the scripted tutorial', () => {
    assert.ok(html.includes('<app-onboarding>'), 'onboarding element mounted');
    assert.ok(html.includes('src="/app/components/app-onboarding.js"'),
      'onboarding component script loaded');
  });

  test('the splash tutorial links to the playable training run', () => {
    assert.match(onboarding,
      /<a[^>]*class="onb-tutorial"[^>]*href="\/learn\/tutorial\/"/,
      'tutorial is a direct link to the training route');
    assert.doesNotMatch(onboarding, /onb-tutorial--soon|COMING SOON|aria-disabled="true"/,
      'finished tutorial is not presented as disabled');
    assert.match(appCss,
      /\.onb-tutorial\s*\{[^}]*rgba\(245, 166, 35, 0\.55\)[^}]*cursor:\s*pointer/s,
      'the tutorial link has an active gold treatment');
  });

  test('aggregate claims banner and winnings strip are removed', () => {
    assert.equal(html.indexOf('<app-claims-panel'), -1, 'claims panel unmounted');
    assert.equal(html.indexOf('components/app-claims-panel.js'), -1, 'claims script removed');
    assert.equal(html.indexOf('<app-balances-strip'), -1, 'winnings strip unmounted');
    assert.equal(html.indexOf('components/app-balances-strip.js'), -1, 'winnings strip script removed');
  });





  test('more-ways is the AFKING PASSES drawer (packs panel gone — combined buy owns lootboxes)', () => {
    const detailsMatch = html.match(/<details class="more-ways section-disclosure"[^>]*>([\s\S]*?)<\/details>/);
    assert.ok(detailsMatch, '<details class="more-ways"> block present');
    assert.doesNotMatch(detailsMatch[0], /^<details class="more-ways section-disclosure"[^>]*\bopen\b[^>]*>/,
      'the pass desk is closed by default');
    assert.match(detailsMatch[0], /\bid="afking-passes"/,
      'the purchase shortcut has a stable drawer target');
    assert.match(detailsMatch[1], /<summary class="more-ways__summary section-disclosure__bar">[\s\S]*section-disclosure__title">AFKING PASSES<[\s\S]*section-disclosure__chevron/);
    for (const bind of [
      'pass-summary-subscription',
      'pass-summary-funding',
      'pass-summary-deity',
      'pass-summary-active-pass',
    ]) assert.match(detailsMatch[1], new RegExp(`data-bind="${bind}"`));
    assert.match(detailsMatch[1], /<app-pass-section>/);
    assert.equal(html.indexOf('<app-packs-panel>'), -1, 'packs panel unmounted');
    assert.equal(html.indexOf('components/app-packs-panel.js'), -1, 'packs script removed');
  });

  test('the compact DGNRS rail sits immediately below AFKING PASSES', () => {
    const passesEnd = html.indexOf('</details>', html.indexOf('id="afking-passes"'));
    const rail = html.indexOf('<app-sdgnrs-burn-rail>', passesEnd);
    const history = html.indexOf('<app-transaction-history>', rail);
    assert.ok(passesEnd >= 0 && rail > passesEnd && history > rail,
      'balance, burn, and charity vote actions follow the pass drawer');
    assert.doesNotMatch(html.slice(passesEnd, rail), /<app-[a-z-]+>/,
      'no other component is inserted between AFKING PASSES and the DGNRS rail');
    assert.match(html, /href="\/app\/styles\/sdgnrs-burn-rail\.css"/);
  });

  test('Tickets, AFKING PASSES, Transaction History, and Referrals share one disclosure-bar treatment', () => {
    assert.match(appCss, /\.section-disclosure__bar\s*\{[\s\S]*?min-height:\s*4\.2rem;[\s\S]*?padding:\s*0\.7rem 1rem;/);
    assert.match(appCss, /\.section-disclosure__chevron\s*\{[\s\S]*?width:\s*0\.48rem;[\s\S]*?border-right:\s*1\.5px solid currentColor;/);
    assert.match(html, /class="more-ways section-disclosure"/);
    assert.match(appCss, /\.aff-disclosure[\s\S]*?section-disclosure/);
  });

  test('boons / coinflip-deposit panels absent (pro-mode surfaces)', () => {
    // app-coinflip-panel unmounted (user call): the flip stake input lives in
    // the hero's coinflip column (app-daily-flip); the file stays on disk.
    // app-quest-panel is now MOUNTED (user ask: quests + activity + streaks).
    for (const tag of ['app-boons-panel', 'app-coinflip-panel']) {
      assert.equal(html.indexOf(`<${tag}`), -1, `<${tag}> element absent`);
      assert.equal(html.indexOf(`components/${tag}.js`), -1, `${tag}.js script tag absent`);
    }
  });

  test('Referrals is the bottom panel directly after Transaction History', () => {
    const history = html.indexOf('<app-transaction-history>');
    const referrals = html.indexOf('<app-affiliate-panel>');
    const mainClose = html.indexOf('</main>');
    assert.ok(history >= 0, 'Transaction History is mounted');
    assert.ok(referrals > history, 'Referrals follows Transaction History');
    assert.ok(referrals < mainClose, 'Referrals remains inside main');
    assert.match(
      html.slice(history, mainClose),
      /<app-transaction-history><\/app-transaction-history>[\s\S]*?<app-affiliate-panel><\/app-affiliate-panel>/,
      'no other panel is inserted between Transaction History and Referrals',
    );
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

  test('standalone and nav activity widgets are removed (Degen Rating lives in Quests)', () => {
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

  test('gold-rush hero ships its static LCP shell (adopted, not re-rendered)', () => {
    // The hero is the page's LCP element. Shipping its shell in the HTML lets
    // it paint before the module graph executes (the 2026-08-15 LCP fix); the
    // component adopts these nodes through its data-el hooks. If the hooks or
    // the .gr class disappear, gold-rush-headline.js silently falls back to a
    // JS innerHTML render and the LCP win quietly reverts — this is the guard.
    const shellMatch = html.match(/<gold-rush-headline class="gr">([\s\S]*?)<\/gold-rush-headline>/);
    assert.ok(shellMatch, '<gold-rush-headline class="gr"> static shell present');
    const shell = shellMatch[1];
    for (const hook of ['data-el="chip"', 'data-el="amount"', 'data-el="float"']) {
      assert.ok(shell.includes(hook), `adoption hook present in static shell: ${hook}`);
    }
    assert.match(shell, /class="gr__amount" data-el="amount">—</,
      'placeholder amount matches the JS template');
    // And the component must adopt rather than unconditionally re-render.
    const component = readFileSync(resolvePath(__dirname, '../../components/gold-rush-headline.js'), 'utf8');
    assert.match(component, /querySelector\('\[data-el="amount"\]'\)[\s\S]*?this\.innerHTML =/,
      'renderShell only falls back to innerHTML when the static shell is absent');
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
      '/app/components/replay-panel.js',
      '/app/components/app-decimator-panel.js',
      '/app/components/app-daily-flip.js',
    ]) {
      assert.ok(html.includes(`src="${src}"`), `script tag: ${src}`);
    }
    // Cold-load module diet (2026-08-13; second tier 2026-08-14): these load
    // through the inline LAZY_PANELS / IDLE_MODULES registrations instead of
    // eager script tags.
    // The path string must still appear — dynamic imports are invisible to
    // the publish runbook's static module-resolution grep, so THESE asserts
    // are what keep a renamed/deleted module from silently resolving to the
    // no-404 HTML fallback. Disk existence is asserted too.
    const lazyModules = [
      '/app/components/app-pass-section.js',
      '/app/components/app-transaction-history.js',
      '/app/components/app-affiliate-panel.js',
      '/app/components/app-sdgnrs-redemptions.js',
      '/app/components/app-day-history-replays.js',
      '/app/components/app-jackpot-resolutions.js',
      '/app/components/app-all-in-dialog.js',
      '/app/components/app-player-funds-dialog.js',
      '/app/components/app-afking-funding-warning.js',
      // Second lazy tier (C16, 2026-08-14): below-fold main-column panels and
      // event-driven chrome/dialogs, each verified zero static importers.
      '/app/components/app-quest-panel.js',
      '/app/components/app-degenerette-panel.js',
      '/app/components/app-parimutuel-panel.js',
      '/app/components/app-records-rail.js',
      '/app/components/app-deity-desk.js',
      '/app/components/app-decimator-burn.js',
      '/app/components/app-baf-eve.js',
      '/app/components/app-tickets-inventory.js',
      '/app/components/app-sdgnrs-burn-rail.js',
      '/app/components/app-reveal-tray.js',
      '/app/components/app-box-strip.js',
      // Telemetry client (2026-08-15): zero-importer, idle by design.
      '/app/app/telemetry.js',
    ];
    for (const src of lazyModules) {
      assert.ok(!html.includes(`src="${src}"`), `lazy module must not load eagerly: ${src}`);
      assert.ok(html.includes(`'${src}'`), `lazy module registered in the loader lists: ${src}`);
      assert.ok(
        existsSync(resolvePath(__dirname, '../..', src.replace(/^\/app\//, ''))),
        `lazy module exists on disk: ${src}`,
      );
    }
  });

  // Import-map targets are BARE specifiers at the call site (`from 'ethers'`),
  // so the publish runbook's module-resolution check — which only follows
  // relative imports — cannot see them. Combined with this site having no 404
  // (an unpublished path serves the root HTML at 200), a missing vendored file
  // means the browser rejects an HTML response as a module and every component
  // importing it silently never upgrades: the 14-hour dead-coin-flip bug class.
  test('every same-origin import-map target exists on disk', () => {
    const mapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    assert.ok(mapMatch, 'index.html carries an import map');
    const map = JSON.parse(mapMatch[1]);
    const targets = Object.entries(map.imports ?? {});
    assert.ok(targets.length > 0, 'import map declares at least one module');

    const local = targets.filter(([, url]) => url.startsWith('/'));
    assert.ok(local.length >= 5, 'the vendored modules are served same-origin');
    for (const [name, url] of local) {
      assert.ok(
        existsSync(resolvePath(__dirname, '../..', url.replace(/^\/app\//, ''))),
        `import-map target exists on disk: ${name} -> ${url}`,
      );
    }
  });
});
