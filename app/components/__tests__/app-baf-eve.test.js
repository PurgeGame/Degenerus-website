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
  bafEveTargetLevel,
  bafPoolPercent,
  bafPrizePoolWei,
  bafFinalFlipTargetDay,
  normalizeBafFinalFlipLeader,
  formatWholeFlipCompact,
  formatBafScoreCompact,
  normalizeBafLeaders,
} = await import('../app-baf-eve.js');

const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../styles/baf-eve.css', import.meta.url), 'utf8');
const COMPONENT = readFileSync(new URL('../app-baf-eve.js', import.meta.url), 'utf8');
const DEMO_HTML = readFileSync(new URL('../../event-rails-demo.html', import.meta.url), 'utf8');
const DEMO_JS = readFileSync(new URL('../../event-rails-demo.js', import.meta.url), 'utf8');
const FLIP = 10n ** 18n;

describe('<app-baf-eve>', () => {
  test('appears for the whole x9 level, including RNG and jackpot phases', () => {
    assert.equal(bafEveTargetLevel({ level: 39, phase: 'PURCHASE', rngLockedFlag: false }), 40);
    assert.equal(bafEveTargetLevel({ level: 39, phase: 'JACKPOT', rngLockedFlag: true }), 40);
    assert.equal(bafEveTargetLevel({ level: 49 }), 50);
    assert.equal(bafEveTargetLevel({ level: 38 }), null);
    assert.equal(bafEveTargetLevel({ level: 99, gameOver: true }), null);
  });

  test('previews the contract BAF slice from the future pool', () => {
    assert.equal(bafPoolPercent(10), 10);
    assert.equal(bafPoolPercent(40), 10);
    assert.equal(bafPoolPercent(50), 20);
    assert.equal(bafPoolPercent(100), 20);
    assert.equal(bafPoolPercent(41), 0);
    assert.equal(bafPrizePoolWei(1_000n, 40), 100n);
    assert.equal(bafPrizePoolWei(1_000n, 50), 200n);
  });

  test('normalizes the contract-paid top four and rejects a cosmetic fifth slot', () => {
    const rows = normalizeBafLeaders({ entries: [
      { level: 40, player: '0x3', score: '300', rank: 3 },
      { level: 40, player: '0x1', score: '500', rank: 1 },
      { level: 40, player: '0x5', score: '100', rank: 5 },
      { level: 40, player: '0x4', score: '200', rank: 4 },
      { level: 40, player: '0x2', score: '400', rank: 2 },
      { level: 40, player: 'duplicate', score: '999', rank: 2 },
      { level: 30, player: 'stale', score: '999', rank: 1 },
    ] }, 40);
    assert.deepEqual(rows.map(({ player, rank }) => ({ player, rank })), [
      { player: '0x1', rank: 1 },
      { player: '0x2', rank: 2 },
      { player: '0x3', rank: 3 },
      { player: '0x4', rank: 4 },
    ]);
    assert.equal(formatBafScoreCompact(79_595_332n * FLIP), '79.5M');
    assert.equal(formatBafScoreCompact(999n * FLIP), '999');
  });

  test('surfaces the decisive daily flip leader only for the exact target day', () => {
    const state = { dailyRng: { day: 24 } };
    assert.equal(bafFinalFlipTargetDay(state), 25);
    assert.deepEqual(normalizeBafFinalFlipLeader({ entries: [
      { day: 24, player: 'stale', score: '999', rank: 1 },
      { day: 25, player: '0xleader', score: '6248200', rank: 1 },
    ] }, 25), { day: 25, player: '0xleader', score: 6_248_200n, rank: 1 });
    assert.equal(formatWholeFlipCompact('6248200'), '6.2M');
  });

  test('mounts ahead of Decimator in the full-width middle event rail', () => {
    const hero = INDEX.indexOf('<section class="jackpot-hero"');
    const baf = INDEX.indexOf('<app-baf-eve>');
    const decimator = INDEX.indexOf('<app-decimator-burn>');
    const play = INDEX.indexOf('<section class="play-grid"');
    assert.ok(hero >= 0 && hero < baf && baf < decimator && decimator < play);
    assert.match(INDEX, /href="\/app\/styles\/baf-eve\.css"/);
    assert.match(INDEX, /src="\/app\/components\/app-baf-eve\.js"/);
  });

  test('makes the projected pool dominant, uses the clean BAF mark, and keeps the true prize lanes', () => {
    assert.match(COMPONENT, /crypto_06_ethereum_green\.svg/);
    assert.match(COMPONENT, /baf-eve__mark[^>]*><b>BAF<\/b><small>×10<\/small>/);
    assert.doesNotMatch(COMPONENT, /baf-eve__crest|flame-center\.svg/);
    assert.match(COMPONENT, /BAF PRIZE POOL/);
    assert.match(COMPONENT, /PROJECTED/);
    assert.match(COMPONENT, /YOUR POSITION/);
    assert.match(COMPONENT, /TOP 4/);
    assert.match(COMPONENT, /place <= LEADER_COUNT/);
    assert.match(CSS, /\.baf-eve__leaders\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
    assert.match(COMPONENT, /FINAL-DAY FLIP/);
    assert.match(COMPONENT, /5% BAF SLICE/);
    assert.match(CSS, /\.baf-eve__leaders\.has-final-flip/);
    assert.match(CSS, /grid-template-columns:\s*minmax\(13\.2rem, 0\.78fr\)\s+minmax\(14\.4rem, 1\.12fr\)/,
      'the desktop prize card gets more room than the BAF identity');
    assert.match(CSS, /\.baf-eve__pool strong\s*\{[^}]*font:\s*1000 clamp\(1\.42rem/s,
      'the ETH total is the strongest number in the rail');
    assert.match(CSS, /li\[data-rank="1"\][\s\S]*--baf-gold/s);
    assert.match(CSS, /@media \(max-width: 620px\)[\s\S]*?\.baf-eve__pool\s*\{[^}]*grid-column:\s*1 \/ -1/s,
      'the prize pool owns the full first row on phones');
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  });

  test('publishes one live player position for every visible BAF surface', () => {
    assert.match(COMPONENT, /subscribe\('app\.bafPosition'/);
    assert.match(COMPONENT, /update\('app\.bafPosition'/);
  });

  test('ships one review page containing both real production rails', () => {
    assert.match(DEMO_HTML, /EVENT RAILS/);
    assert.match(DEMO_HTML, /src="\/app\/event-rails-demo\.js"/);
    assert.match(DEMO_JS, /document\.createElement\('app-baf-eve'\)/);
    assert.match(DEMO_JS, /document\.createElement\('app-decimator-burn'\)/);
    assert.match(DEMO_JS, /finalDay:\s*async/);
    assert.match(DEMO_JS, /leaderboards\/coinflip/);
    assert.match(DEMO_JS, /level:\s*39/);
    assert.match(DEMO_JS, /decWindowOpen:\s*true/);
  });
});
