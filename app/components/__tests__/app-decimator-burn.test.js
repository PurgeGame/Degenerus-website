import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.HTMLElement ||= class HTMLElement {};
globalThis.customElements ||= {
  registry: new Map(),
  get(name) { return this.registry.get(name); },
  define(name, ctor) { this.registry.set(name, ctor); },
};

const {
  decimatorBoonBps,
  formatDecimatorBurnQuote,
  parseDecimatorFlipInput,
} = await import('../app-decimator-burn.js');

const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const STATUS_CSS = readFileSync(new URL('../../styles/status-indicators.css', import.meta.url), 'utf8');
const COMPONENT = readFileSync(new URL('../app-decimator-burn.js', import.meta.url), 'utf8');
const SIDE_BETS = readFileSync(new URL('../app-parimutuel-panel.js', import.meta.url), 'utf8');
const DEMO_HTML = readFileSync(new URL('../../decimator-demo.html', import.meta.url), 'utf8');
const DEMO_JS = readFileSync(new URL('../../decimator-demo.js', import.meta.url), 'utf8');
const FLIP = 10n ** 18n;

describe('<app-decimator-burn>', () => {
  test('parses exact FLIP amounts without floating-point loss', () => {
    assert.equal(parseDecimatorFlipInput('1,250.5'), 1_250n * FLIP + FLIP / 2n);
    assert.equal(parseDecimatorFlipInput('0.000000000000000001'), 1n);
    assert.equal(parseDecimatorFlipInput('1.0000000000000000001'), null);
    assert.equal(parseDecimatorFlipInput('-1'), null);
  });

  test('maps the active Decimator boon into the aggregate quote', () => {
    assert.equal(decimatorBoonBps({ boons: [{ boonType: 13, consumed: false }] }), 1_000);
    assert.equal(decimatorBoonBps({ boons: [{ boonType: 14, consumed: false }] }), 2_500);
    assert.equal(decimatorBoonBps({ boons: [{ boonType: 15, consumed: false }] }), 5_000);
    assert.equal(decimatorBoonBps({ boons: [] }), 0);
  });

  test('keeps the boon marker left of the amount box and its compact delta on one button line', () => {
    assert.equal(
      formatDecimatorBurnQuote(1_500n * FLIP, 500n * FLIP),
      '+1.5K · +500 BOON',
    );
    assert.equal(
      formatDecimatorBurnQuote(12_345n * FLIP, 4_115n * FLIP),
      '+12.3K · +4.11K BOON',
    );
    assert.equal(formatDecimatorBurnQuote(900n * FLIP), '+900 SCORE');
    assert.match(
      COMPONENT,
      /<label class="dbb__input">\s*<boon-product-indicator product="decimator"><\/boon-product-indicator>\s*<span class="dbb__input-control">/s,
      'the marker is a sibling before the bordered input box',
    );
    assert.match(
      CSS,
      /\.dbb__input:has\(> boon-product-indicator:not\(\[hidden\]\)\)\s*\{[^}]*grid-template-columns:\s*1\.45rem minmax\(0, 1fr\)/s,
      'an active marker receives a dedicated left-hand track',
    );
    assert.match(
      CSS,
      /\.dbb__burn strong\.has-boon\s*\{[^}]*font-size:[^}]*letter-spacing:/s,
      'the one-line boon quote has a bounded compact treatment',
    );
    assert.doesNotMatch(CSS, /\.dbb__input-control > boon-product-indicator[^}]*left:\s*6\.15rem/s);
  });

  test('mounts full-width between the main jackpot and the secondary play grid', () => {
    const hero = INDEX.indexOf('<section class="jackpot-hero"');
    const burn = INDEX.indexOf('<app-decimator-burn>');
    const play = INDEX.indexOf('<section class="play-grid"');
    assert.ok(hero >= 0 && hero < burn && burn < play);
    // Second lazy tier (2026-08-14): loads via the IDLE_MODULES loader list,
    // not an eager script tag (index-structure.test.js guards existence).
    assert.match(INDEX, /'\/app\/components\/app-decimator-burn\.js'/);
    assert.match(CSS, /app-decimator-burn\s*\{[^}]*display:\s*block/s);
    assert.match(CSS, /\.dbb\s*\{[^}]*grid-template-columns:/s);
    assert.match(CSS, /\.dbb__reactor::before[\s\S]*animation:\s*dbb-reactor-spin/s);
    assert.match(COMPONENT, /src="\/app\/assets\/decimator-draw-mark\.svg\?v=casino-v2"/,
      'the burn strip uses the dedicated Decimator wheel and selector mark');
    assert.match(COMPONENT, /BURN <img src="\/whitepaper\/flame-logo-split\.svg" alt="FLIP"> TO WIN/,
      'the event cue uses the FLIP mark rather than a generic live-window dot');
    assert.match(CSS, /@media \(max-width: 540px\)[\s\S]*\.dbb\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  });

  test('is simple: the ETH pool, the burn input, the multiplier and the current score', () => {
    assert.match(COMPONENT, /data-bind="dbb-prize"/);
    assert.match(COMPONENT, /YOUR SCORE[\s\S]*data-bind="dbb-player-score"/);
    assert.match(COMPONENT, /<small>YOUR MULTIPLIER<\/small>/);
    assert.match(COMPONENT, /name="dbb-amount"/);
    assert.match(COMPONENT, /SCORE —/);
    assert.match(COMPONENT, /decimatorEffectiveMultiplierBps/);
    assert.match(COMPONENT, /formatDecimatorBurnQuote\(stack, boonStack\)/,
      'the burn quote names the concrete score added by an active Decimator boon');
    assert.match(COMPONENT, /0\.9 for each day since the window opened/, 'the multiplier explains entry timing');
    // No dice: the board comes from the main Craps widget and is never shown here.
    assert.doesNotMatch(COMPONENT, /BOARD|dbb-board|dbb-rating|DEGEN RATING|FLIP BURNED|dbb-burned|BRACKET|CAPPED/);
    assert.doesNotMatch(COMPONENT, /readDecimatorRawBurnTotal|readDecimatorBoardChips|ui\.crapsBoard/,
      'the rail does no log scan or board read it does not show');
    assert.doesNotMatch(COMPONENT, /dbb__modifier-list|dbb-mod--|TODAY'S MODIFIERS/,
      'activity, timing, and boon contributors collapse into the actual multiplier');
    assert.doesNotMatch(COMPONENT, /sinceTimestamp:\s*state\?\.levelStartTime/,
      'The purchase clock resets after jackpot; burned FLIP must use the actual window opening');
    assert.equal((COMPONENT.match(/<button[^>]*data-bind="dbb-burn"/g) || []).length, 1);
    assert.match(SIDE_BETS, /querySelector\?\.\('app-decimator-burn'\)/,
      'the old side-bet entry yields when the full-width rail is mounted');
  });

  test('keeps the event rail compact with readable values and paired controls', () => {
    assert.match(CSS, /\.dbb\s*\{[^}]*grid-template-areas:\s*"identity stats entry score"/s);
    assert.match(CSS, /\.dbb\s*\{[^}]*min-height:\s*4\.5rem/s);
    assert.match(CSS, /\.dbb__entry\s*\{[^}]*grid-template-columns:\s*var\(--dbb-stat-width\) minmax\(0, 1fr\)/s,
      'the multiplier sits beside the burn controls on desktop');
    assert.match(CSS, /\.dbb__entry-controls\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
      'the amount and action share a row, including on phones');
    assert.match(CSS, /@media \(max-width: 540px\)[\s\S]*\.dbb\s*\{[^}]*grid-template-areas:\s*"identity identity" "stats score" "entry entry"/s,
      'mobile keeps the prize and player score side by side');
    assert.match(CSS, /\.dbb__input-control\s*\{[^}]*height:\s*var\(--dbb-control-height\)/s);
    assert.match(CSS, /\.dbb__burn\s*\{[^}]*min-height:\s*var\(--dbb-control-height\)/s,
      'the compact action retains a full touch target');
    assert.match(CSS, /\.dbb-stat strong\s*\{[^}]*font:\s*950 var\(--dbb-value-size\)/s);
    assert.doesNotMatch(CSS, /\.dbb__(?:plate|board|rating)\b|\.dbb-stat--burned/);
  });

  test('puts the unfinished Decimator quest shortcut on the burn action', () => {
    const inputStart = COMPONENT.indexOf('<span class="dbb__input-control">');
    const burnStart = COMPONENT.indexOf('<button type="button" class="dbb__burn"');
    const burnEnd = COMPONENT.indexOf('</button>', burnStart);
    assert.ok(inputStart >= 0 && inputStart < burnStart && burnStart < burnEnd);
    assert.doesNotMatch(COMPONENT.slice(inputStart, burnStart), /quest-objective-indicator/,
      'the objective no longer sits on the amount input');
    assert.match(COMPONENT.slice(burnStart, burnEnd),
      /<quest-objective-indicator product="decimator"><\/quest-objective-indicator>/,
      'click-to-open quest control lives on the burn CTA');
    assert.match(STATUS_CSS,
      /\.dbb__burn > quest-objective-indicator\s*\{[^}]*position:\s*absolute[^}]*top:\s*0\.08rem[^}]*right:\s*0\.1rem/s,
      'the zero-footprint marker is pinned inside the upper-right action corner');
    assert.doesNotMatch(STATUS_CSS, /\.dbb__input-control > quest-objective-indicator/);
  });

  test('has a forced-open visual demo with every aggregate input active', () => {
    assert.match(DEMO_HTML, /DECIMATOR BURN WINDOW/);
    assert.match(DEMO_HTML, /src="\/app\/decimator-demo\.js"/);
    assert.match(DEMO_JS, /decWindowOpen:\s*true/);
    assert.match(DEMO_JS, /activityScore:\s*235/);
    assert.match(DEMO_JS, /daysLate:\s*1/);

    assert.match(DEMO_JS, /boonType:\s*15/);
    assert.match(DEMO_JS, /rawBurnWei:\s*8_420_000n \* FLIP/);
    assert.match(DEMO_JS, /document\.createElement\('app-decimator-burn'\)/,
      'the preview mounts the real production component rather than copied mock markup');
  });
});
