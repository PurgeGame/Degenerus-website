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
  decimatorModifierModel,
  parseDecimatorFlipInput,
} = await import('../app-decimator-burn.js');

const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
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

  test('shows every active boost and malus that feeds the burn quote', () => {
    const boons = { boons: [{ boonType: 15, consumed: false }] };
    assert.equal(decimatorBoonBps(boons), 5_000);
    const model = decimatorModifierModel({
      activityScore: 235,
      dayOneActive: true,
      lastPurchaseDay: true,
    }, boons);
    assert.deepEqual(model.chips.map(({ kind, label, value }) => ({ kind, label, value })), [
      { kind: 'boost', label: 'DEGEN 235', value: '+70.49%' },
      { kind: 'boost', label: 'EARLY WINDOW', value: '+20%' },
      { kind: 'malus', label: 'LATE BURN', value: '−10%' },
      { kind: 'boon', label: 'BOON', value: '+50% SCORE' },
    ]);
    assert.equal(model.liveMultiplierBps, 18_412n);
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
    assert.match(CSS, /@media \(max-width: 540px\)[\s\S]*\.dbb\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  });

  test('renders raw burn, prize, player score, modifiers, and one exact burn action', () => {
    assert.match(COMPONENT, /data-bind="dbb-prize"/);
    assert.match(COMPONENT, /data-bind="dbb-burned"/);
    assert.doesNotMatch(COMPONENT, /dbb-total-weight|TOTAL WEIGHT/);
    assert.match(COMPONENT, /YOUR SCORE[\s\S]*data-bind="dbb-player-score"/);
    assert.doesNotMatch(COMPONENT, /YOUR WEIGHT/);
    assert.match(COMPONENT, /SCORE —/);
    assert.match(COMPONENT, /readDecimatorRawBurnTotal/);
    assert.equal((COMPONENT.match(/<button[^>]*data-bind="dbb-burn"/g) || []).length, 1);
    assert.match(SIDE_BETS, /querySelector\?\.\('app-decimator-burn'\)/,
      'the old side-bet entry yields when the full-width rail is mounted');
  });

  test('uses the full rail for legible primary values and controls', () => {
    assert.match(CSS, /\.dbb\s*\{[^}]*min-height:\s*8\.8rem/s);
    assert.match(CSS, /\.dbb-stat strong\s*\{[^}]*font:\s*950 clamp\(0\.88rem, 1\.35vw, 1\.08rem\)/s);
    assert.match(CSS, /\.dbb-stat--score\s*\{[^}]*grid-column:\s*1 \/ -1/s);
    assert.match(CSS, /\.dbb-stat--score strong\s*\{[^}]*font-size:\s*clamp\(1\.08rem, 1\.8vw, 1\.38rem\)/s);
    assert.match(CSS, /\.dbb__input-control\s*\{[^}]*height:\s*3\.4rem/s);
    assert.match(CSS, /@media \(max-width: 900px\)[\s\S]*\.dbb__entry\s*\{[^}]*grid-column:\s*1 \/ -1/s);
    assert.match(CSS, /@media \(max-width: 540px\)[\s\S]*\.dbb__entry\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  });

  test('has a forced-open visual demo with every modifier family active', () => {
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
