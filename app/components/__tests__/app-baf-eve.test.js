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
  formatBafDrawPercent,
  normalizeBafDraw,
  normalizeBafFinalFlipLeader,
  formatWholeFlipCompact,
  formatBafScoreCompact,
  normalizeBafLeaders,
  BAF_SLICES,
  BAF_GATED_PERCENT,
  bafGateModel,
  bafScatterFieldMarkup,
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

  test('shows the viewed player exact final-day draw weight and share outside the top ten', () => {
    const player = '0xba5e00000000000000000000000000000000cafe';
    const draw = normalizeBafDraw({
      entries: [
        { day: 25, player: '0xleader', score: '6248200', rank: 1 },
        { day: 24, player: 'stale', score: '9999999', rank: 1 },
      ],
      totalWeight: '10000000',
      totalParticipants: 42,
      player: { day: 25, player, score: '125000', rank: 14 },
    }, 25, player);

    assert.equal(draw.totalWeight, '10000000');
    assert.equal(draw.totalParticipants, 42);
    assert.deepEqual(draw.player, { day: 25, player, score: '125000', rank: 14 });
    assert.equal(formatBafDrawPercent(draw.player.score, draw.totalWeight), '1.25%');
    assert.equal(formatBafDrawPercent('1', '1000000'), '<0.01%');
    assert.equal(formatBafDrawPercent('0', '1000000'), '0.00%');
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

  test('sizes every lane by what the contract actually pays it', () => {
    // DegenerusJackpots.runBafJackpot: 10% top BAF + 5% pick (rank), 5% weighted
    // final-day draw, 10% far-future, 45%+25% scatter.
    assert.equal(BAF_SLICES.reduce((total, slice) => total + slice.percent, 0), 100);
    assert.deepEqual(
      BAF_SLICES.map(({ key, percent }) => [key, percent]),
      [['scatter', 70], ['far', 10], ['rank', 15], ['raffle', 5]],
    );
    // Far-future and scatter skip zero-score candidates and refund the share.
    assert.equal(BAF_GATED_PERCENT, 80);
    assert.equal(BAF_SLICES.filter((slice) => slice.gated).map((slice) => slice.key).join(), 'scatter,far');

    // The pool column outweighs the ranked board, which pays only 15%.
    assert.match(CSS, /grid-template-columns:\s*\n?\s*minmax\(10\.8rem, 0\.82fr\) minmax\(16rem, 1\.66fr\)\s*\n?\s*minmax\(8\.6rem, 0\.82fr\) minmax\(15rem, 1\.3fr\)/,
      'the prize pool is the widest column and the ranked board is not');
    assert.match(COMPONENT, /15% OF THE POOL/, 'the board states its own weight');
    const poolClamp = CSS.match(/\.baf-eve__pool strong\s*\{[^}]*font:\s*800 clamp\([\d.]+rem, [\d.]+vw, ([\d.]+)rem\)/s);
    const scoreClamp = CSS.match(/\.baf-eve__gate-score\s*\{[^}]*font:\s*800 clamp\([\d.]+rem, [\d.]+vw, ([\d.]+)rem\)/s);
    assert.ok(poolClamp && scoreClamp, 'both figures are clamped');
    assert.ok(Number(poolClamp[1]) > Number(scoreClamp[1]),
      'the ETH total is the strongest number in the rail');
  });

  test('leads the player column with numbers, not a state word', () => {
    const locked = bafGateModel({ score: 0n, rank: null, total: 247 });
    assert.equal(locked.armed, false);
    assert.equal(locked.score, '0');
    assert.equal(locked.rank, '—');
    assert.equal(locked.context, 'LOCKED OUT OF 80%');
    assert.equal(locked.note, 'CLAIM A WON FLIP TO SCORE');

    const armed = bafGateModel({ score: 12n * FLIP, rank: 12, total: 247 });
    assert.equal(armed.armed, true);
    assert.equal(armed.rank, '#12');
    assert.equal(armed.context, 'OF 247');
    // Ranked and unranked both score: the scatter never reads the board.
    assert.equal(bafGateModel({ score: 12n * FLIP, rank: null }).context, 'UNRANKED');

    assert.doesNotMatch(COMPONENT, /'ARMED'|'LOCKED'/, 'no big state word in the rail');
    assert.match(COMPONENT, /classList\?\.toggle\('is-armed', gate\.armed\)/);
    assert.match(CSS, /\.baf-eve\.is-armed/, 'armed still changes the rail quietly');
  });

  test('names the players it can name', () => {
    assert.match(COMPONENT, /import \{ fetchProfiles \} from '\.\.\/app\/profiles\.js'/);
    assert.match(COMPONENT, /profile\?\.name \? `@\$\{profile\.name\}` : \(row \? _shortAddress\(row\.player\) : '—'\)/,
      'a linked player shows their Discord name and everyone else keeps the short address');
    assert.match(COMPONENT, /baf-eve__avatar/);
    assert.match(COMPONENT, /image\.src = profile\.avatar/);
    // Identity is decoration: it must land after the numbers, never gate them.
    assert.match(COMPONENT, /this\.#render\(\);\s*\n\s*void this\.#loadProfiles/);
    assert.match(CSS, /\.baf-eve__avatar\.is-fallback/);
  });

  test('draws the scatter rule instead of decorating around it', () => {
    const field = bafScatterFieldMarkup();
    assert.equal((field.match(/<use /g) || []).length, 50, 'one cell per scatter round');
    assert.equal((field.match(/class="baf-eve__ticket is-paid"/g) || []).length, 2);
    assert.equal((field.match(/class="baf-eve__ticket"/g) || []).length, 2);
    assert.match(field, /50 ROUNDS · 4 TICKETS EACH · TOP 2 BY SCORE/,
      'the field is labelled, so it reads as a diagram and not as texture');
    // User call: nothing on this rail moves, so there is no motion to reduce.
    assert.doesNotMatch(CSS, /@keyframes|animation:|transition:/);
  });

  test('keeps the prize lanes honest and leaves gold to the deity pass', () => {
    assert.match(COMPONENT, /crypto_06_ethereum_green\.svg/);
    assert.match(COMPONENT, /baf-mark\.svg/);
    assert.doesNotMatch(COMPONENT, /baf-eve__crest|flame-center\.svg/);
    assert.match(COMPONENT, /BAF PRIZE POOL/);
    assert.match(COMPONENT, /PROJECTED/);
    assert.match(COMPONENT, /YOUR SCORE/);
    assert.match(COMPONENT, /TOP 4/);
    assert.match(COMPONENT, /place <= LEADER_COUNT/);
    // A vertical list of four named rows, not four squeezed cards.
    assert.match(CSS, /\.baf-eve__leaders\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    assert.match(CSS, /\.baf-eve__leaders li\s*\{[^}]*grid-template-columns:\s*[\d.]+rem [\d.]+rem minmax\(0, 1fr\) auto/s,
      'each row is rank, avatar, name, score');

    // The 5% slice is an amount-weighted draw over final-day deposits, so it
    // must not sit in the ranked strip or read as a prize for the top staker.
    assert.match(COMPONENT, /FINAL-DAY DRAW/);
    assert.match(COMPONENT, /YOUR DRAW WEIGHT/);
    assert.match(COMPONENT, /formatBafDrawPercent\(playerWeight, draw\?\.totalWeight\)/);
    assert.match(COMPONENT, /baf-eve-draw-slot/);
    assert.doesNotMatch(CSS, /\.baf-eve__leaders\s+\.baf-eve__daily-flip/);
    assert.doesNotMatch(COMPONENT, /list\.appendChild\(daily\)/);

    assert.doesNotMatch(CSS, /--baf-gold/, 'gold belongs to the deity pass, not the BAF');

    // base.css styles the page `footer` element; nested component footers must
    // reset it or the pool card grows 40px of phantom height.
    assert.match(CSS, /\.baf-eve__pool > footer\s*\{[^}]*padding:\s*0/s);
    assert.match(CSS, /\.baf-eve__band\s*\{[^}]*padding:\s*0\.5rem 0 0/s);

    assert.match(CSS, /@media \(max-width: 620px\)[\s\S]*?\.baf-eve__pool\s*\{[^}]*grid-column:\s*1 \/ -1/s,
      'the prize pool owns the full first row on phones');
    assert.doesNotMatch(CSS, /@keyframes|animation:|transition:/, 'the rail is a readout, not a show');
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
