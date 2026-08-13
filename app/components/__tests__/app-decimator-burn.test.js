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

  test('mounts full-width between the main jackpot and the secondary play grid', () => {
    const hero = INDEX.indexOf('<section class="jackpot-hero"');
    const burn = INDEX.indexOf('<app-decimator-burn>');
    const play = INDEX.indexOf('<section class="play-grid"');
    assert.ok(hero >= 0 && hero < burn && burn < play);
    assert.match(INDEX, /src="\/app\/components\/app-decimator-burn\.js"/);
    assert.match(CSS, /app-decimator-burn\s*\{[^}]*display:\s*block/s);
    assert.match(CSS, /\.dbb\s*\{[^}]*grid-template-columns:/s);
    assert.match(CSS, /\.dbb__reactor::before[\s\S]*animation:\s*dbb-reactor-spin/s);
    assert.match(COMPONENT, /src="\/app\/assets\/decimator-draw-mark\.svg"/,
      'the burn strip uses the dedicated Decimator wheel and selector mark');
    assert.match(COMPONENT, /BURN <img src="\/whitepaper\/flame-logo-split\.svg" alt="FLIP"> TO WIN/,
      'the event cue uses the FLIP mark rather than a generic live-window dot');
    assert.match(CSS, /@media \(max-width: 540px\)[\s\S]*\.dbb\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  });

  test('renders raw burn, prize, player score, bracket, and one aggregate multiplier', () => {
    assert.match(COMPONENT, /data-bind="dbb-prize"/);
    assert.match(COMPONENT, /data-bind="dbb-burned"/);
    assert.doesNotMatch(COMPONENT, /dbb-total-weight|TOTAL WEIGHT/);
    assert.match(COMPONENT, /YOUR DECIMATOR SCORE[\s\S]*data-bind="dbb-player-score"/);
    assert.doesNotMatch(COMPONENT, /YOUR WEIGHT/);
    assert.match(COMPONENT, /SCORE —/);
    assert.match(COMPONENT, /decimatorEffectiveMultiplierBps/);
    assert.match(COMPONENT, /\+\$\{_fmtFlip\(boonWeight\)\} BOON/,
      'the burn quote names the concrete score added by an active Decimator boon');
    assert.match(COMPONENT, /<small>YOUR MULTIPLIER<\/small>/,
      'the strip labels selected-burn score divided by spend, after contract caps');
    assert.match(COMPONENT, /data-bind="dbb-bracket-number"/);
    assert.match(COMPONENT, /data-bind="dbb-bracket-range"/,
      'the contract bracket gets a dedicated number slot beside its Degen Rating range');
    assert.match(COMPONENT, /degenScoreLootTier\(bracketScore\)/,
      'the range uses the shared Degen Rating loot color');
    assert.doesNotMatch(COMPONENT, /dbb__modifier-list|dbb-mod--|TODAY'S MODIFIERS/,
      'activity, timing, and boon contributors collapse into the actual multiplier');
    assert.match(COMPONENT, /data-bind="dbb-multi-cap" hidden/);
    assert.match(COMPONENT, /\(BASE CAPPED\)|\(CAPPED\)/,
      'the small cap note stays inline with the multiplier without a bubble');
    assert.match(COMPONENT, /Total includes activity, timing, and any boon/);
    assert.match(COMPONENT, /actualMultiplierBps <= 10_000n/,
      'a total multiplier above 100% never receives a misleading capped note');
    assert.match(COMPONENT, /readDecimatorRawBurnTotal/);
    assert.equal((COMPONENT.match(/<button[^>]*data-bind="dbb-burn"/g) || []).length, 1);
    assert.match(SIDE_BETS, /querySelector\?\.\('app-decimator-burn'\)/,
      'the old side-bet entry yields when the full-width rail is mounted');
  });

  test('uses the full rail for legible primary values and controls', () => {
    assert.match(CSS, /\.dbb\s*\{[^}]*grid-template-areas:\s*"identity stats entry score"/s,
      'the wide layout puts accumulated score beyond the input and Degen Rating context');
    assert.match(CSS, /\.dbb\s*\{[^}]*min-height:\s*6\.1rem/s,
      'the desktop event rail stays compact without shrinking its primary values');
    assert.match(CSS, /\.dbb__stats\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
      'prize and burned FLIP remain grouped before the entry controls');
    assert.match(CSS, /\.dbb-stat--score\s*\{[^}]*grid-area:\s*score/s,
      'the player score owns the far-side grid slot');
    assert.match(CSS, /\.dbb__entry-meta\s*\{[^}]*grid-template-columns:\s*minmax\(9\.5rem, 1\.08fr\) minmax\(7\.4rem, 0\.82fr\)[^}]*min-height:\s*2\.82rem/s,
      'bracket and aggregate multiplier align over the input and action columns');
    assert.match(CSS, /\.dbb__bracket-id strong\s*\{[^}]*font:\s*1000 1\.62rem/s,
      'the bracket number has a large dedicated score-plate slot');
    assert.match(CSS, /\.dbb__actual-multi strong\s*\{[^}]*font:\s*1000 clamp\(0\.86rem, 1\.15vw, 1\.12rem\)/s,
      'the actual multiplier is the dominant context value');
    assert.match(CSS, /\.dbb__bracket-score strong\[data-score-tier="gold"\]/,
      'Degen Rating ranges share the normal tier palette');
    assert.match(CSS, /\.dbb__bracket-score\s*\{[^}]*justify-items:\s*center[^}]*text-align:\s*center/s,
      'the Degen Rating range is centered in its half of the bracket plate');
    assert.match(CSS, /\.dbb__entry-controls\s*\{[^}]*grid-template-columns:\s*minmax\(9\.5rem, 1\.08fr\) minmax\(7\.4rem, 0\.82fr\)/s);
    assert.match(CSS, /\.dbb-stat strong\s*\{[^}]*font:\s*950 clamp\(0\.96rem, 1\.25vw, 1\.14rem\)/s);
    assert.match(CSS, /\.dbb-stat--score strong\s*\{[^}]*font-size:\s*clamp\(1\.04rem, 1\.45vw, 1\.26rem\)/s);
    assert.match(CSS, /\.dbb__input-control\s*\{[^}]*height:\s*2\.58rem/s);
    assert.match(CSS, /@media \(max-width: 540px\)[\s\S]*\.dbb__entry-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    assert.match(CSS, /@media \(max-width: 540px\)[\s\S]*\.dbb__input-control\s*\{[^}]*height:\s*4rem/s,
      'phone burn entry matches the full-height Tickets and Luckbox touch controls');
    assert.match(CSS, /@media \(max-width: 540px\)[\s\S]*\.dbb__stepper\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s,
      'phone increment controls sit side by side instead of in a tiny vertical rail');
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
      /\.dbb__burn > quest-objective-indicator\s*\{[^}]*position:\s*absolute[^}]*top:\s*50%[^}]*right:\s*0\.42rem/s,
      'the zero-footprint marker is pinned inside the action edge');
    assert.doesNotMatch(STATUS_CSS, /\.dbb__input-control > quest-objective-indicator/);
  });

  test('the shared mini wheel has ten slots, one green lower slot, and a gold selector', () => {
    const mark = readFileSync(new URL('../../assets/decimator-draw-mark.svg', import.meta.url), 'utf8');
    assert.match(mark, /stroke="url\(#dec-red\)"[\s\S]*stroke-dasharray="9\.45 4\.53"/);
    assert.match(mark, /stroke="url\(#dec-green\)"[\s\S]*stroke-dasharray="9\.45 130\.35"[\s\S]*rotate\(90 32 32\)/);
    assert.match(mark, /fill="url\(#dec-gold\)"/);
    assert.doesNotMatch(mark, /stroke-dasharray="7\.1 4\.55"/,
      'the previous twelve-slot cadence is gone');
  });

  test('has a forced-open visual demo with every aggregate input active', () => {
    assert.match(DEMO_HTML, /DECIMATOR BURN WINDOW/);
    assert.match(DEMO_HTML, /src="\/app\/decimator-demo\.js"/);
    assert.match(DEMO_JS, /decWindowOpen:\s*true/);
    assert.match(DEMO_JS, /activityScore:\s*235/);
    assert.match(DEMO_JS, /dayOneActive:\s*true/);
    assert.match(DEMO_JS, /lastPurchaseDay:\s*true/);
    assert.match(DEMO_JS, /boonType:\s*15/);
    assert.match(DEMO_JS, /rawBurnWei:\s*8_420_000n \* FLIP/);
    assert.match(DEMO_JS, /document\.createElement\('app-decimator-burn'\)/,
      'the preview mounts the real production component rather than copied mock markup');
  });
});
