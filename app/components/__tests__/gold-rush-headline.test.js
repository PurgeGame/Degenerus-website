// /app/components/__tests__/gold-rush-headline.test.js
//
// Run: cd website && node --test app/components/__tests__/gold-rush-headline.test.js
//
// Covers the parts of the headline widget that can be checked without a browser:
//   - the display formatting (grouping + the testnet /1M re-scale via scaling.js)
//   - the easing curve's endpoints and monotonicity (the count-up must never
//     overshoot or run backwards)
//   - source-grep gates on the behaviours a DOM-less test cannot execute:
//     textContent-only for server strings, no divisor literals, reduced-motion
//     handling, and the store subscription rather than a private fetch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = resolvePath(__dirname, '../gold-rush-headline.js');
const src = readFileSync(srcPath, 'utf8');
const cssPath = resolvePath(__dirname, '../../styles/app.css');
const css = readFileSync(cssPath, 'utf8');

// customElements/HTMLElement are absent under node:test. The module guards its
// define() call and only touches the DOM inside connectedCallback, but the class
// declaration itself extends HTMLElement, so give it a stub before importing.
globalThis.HTMLElement = globalThis.HTMLElement ?? class {};

const { _testing } = await import('../gold-rush-headline.js');
const { groupEth, fmtEth, easeOutCubic, headlineAmountFit } = _testing;

// polling.js registers a visibilitychange listener behind a typeof guard, so it is
// import-safe here; its _testing surface exposes the adaptive-cadence internals.
const { _testing: pollingTesting } = await import('../../app/polling.js');

// ===========================================================================
// Formatting
// ===========================================================================

describe('groupEth', () => {
  test('groups thousands and preserves the fraction', () => {
    assert.equal(groupEth('2344.0774'), '2,344.0774');
    assert.equal(groupEth('999.1'), '999.1');
    assert.equal(groupEth('1000.0000'), '1,000.0000');
    assert.equal(groupEth('1234567.8900'), '1,234,567.8900');
  });

  test('handles an integer with no fraction', () => {
    assert.equal(groupEth('12345'), '12,345');
  });

  test('keeps a leading minus outside the grouping', () => {
    assert.equal(groupEth('-10955.3998'), '-10,955.3998');
  });
});

describe('fmtEth (display scale)', () => {
  // ETH_DIVISOR on the Base Sepolia profile is 1_000_000n: on-chain amounts are
  // /1M-scaled, so display MULTIPLIES. 2344077355857018 raw wei is the run-#18
  // headline and must read as ~2,344 ETH, not 0.0023.
  test('re-scales testnet wei to the mainnet-equivalent number', () => {
    assert.equal(fmtEth(2344077355857018n), '2,344.077');   // HEADLINE_DIGITS = 3 (user call)
  });

  test('zero and whole prizes do not retain accounting-style padding', () => {
    assert.equal(fmtEth(0n), '0');
    assert.equal(fmtEth(1_000_000_000_000n), '1');
  });

  test('honours the digits argument (delta floater uses 4)', () => {
    assert.equal(fmtEth(14180280321069n, 4), '14.1802');
    assert.equal(fmtEth(14180280321069n, 2), '14.18');
  });

  test('a single-ticket-scale move is still visible at 4 digits', () => {
    // 0.04 ETH display = 4e10 raw wei at the /1M testnet scale. If the headline
    // rounded to 2 digits this would vanish; the ticker exists to show it.
    assert.equal(fmtEth(40_000_000_000n, 4), '0.04');
  });
});

describe('narrow headline fitting', () => {
  test('accounts for punctuation as the jackpot grows through width buckets', () => {
    assert.equal(headlineAmountFit('8,689.892'), 'normal');
    assert.equal(headlineAmountFit('12,345.678'), 'medium');
    assert.equal(headlineAmountFit('1,234,567.890'), 'long');
  });
});

// ===========================================================================
// Count-up easing
// ===========================================================================

describe('easeOutCubic', () => {
  test('pinned at both endpoints (no overshoot past the real value)', () => {
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
  });

  test('monotonically increasing — the number never ticks backwards mid-animation', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i += 1) {
      const v = easeOutCubic(i / 100);
      assert.ok(v >= prev, `non-monotonic at t=${i / 100}: ${v} < ${prev}`);
      assert.ok(v >= 0 && v <= 1, `out of range at t=${i / 100}: ${v}`);
      prev = v;
    }
  });

  test('front-loaded — past halfway by t=0.25 (reads as money landing)', () => {
    assert.ok(easeOutCubic(0.25) > 0.5, `expected >0.5, got ${easeOutCubic(0.25)}`);
  });
});

// ===========================================================================
// Source-grep gates
// ===========================================================================

describe('gold-rush-headline.js source discipline', () => {
  test('no raw ETH/ticket divisor literals — scaling.js owns the re-scale', () => {
    assert.equal(/1_000_000n|1000000n/.test(src), false, 'ETH_DIVISOR literal leaked in');
    assert.equal(/\/\s*100n/.test(src), false, 'TICKET_DIVISOR literal leaked in');
    assert.match(src, /from '\.\.\/app\/scaling\.js'/, 'imports displayEth from scaling.js');
  });

  test('server-derived strings go in via textContent, never innerHTML', () => {
    const innerHtmlAssigns = src.match(/\.innerHTML\s*=/g) || [];
    assert.equal(innerHtmlAssigns.length, 1, 'exactly one innerHTML write (the static shell)');
    // The single innerHTML write must be a template with no ${...} interpolation.
    const shell = src.slice(src.indexOf('.innerHTML ='));
    const shellLiteral = shell.slice(0, shell.indexOf('`;') + 2);
    assert.equal(/\$\{/.test(shellLiteral), false, 'shell template interpolates nothing');
    assert.match(src, /amount\.textContent =/, 'the amount is written via textContent');
  });

  test('reads the store, owns no fetch of its own (polling.js is the only fetcher)', () => {
    assert.match(src, /subscribe\('app\.goldRush'/, "subscribes to app.goldRush");
    assert.doesNotMatch(src, /subscribe\('app\.records'/,
      'the jackpot headline does not subscribe to unrelated bounty-pool state');
    assert.equal(/\bfetch\(/.test(src), false, 'component performs no fetch');
    assert.equal(/API_BASE/.test(src), false, 'component does not know the API base');
  });

  test('does not recreate the retired level/day navigation pill', () => {
    assert.doesNotMatch(src, /#renderGameStateChip|id\s*=\s*['"]unav-state/);
  });

  test('respects prefers-reduced-motion by snapping instead of animating', () => {
    assert.match(src, /prefers-reduced-motion/, 'queries the media feature');
    assert.match(src, /prefersReducedMotion\(\)[\s\S]{0,140}paintHeadlineAmount\(amount, to\)/,
      'reduced motion path assigns the final value directly');
  });

  test('interpolates on BigInt wei, not floats (exactness of a money figure)', () => {
    assert.match(src, /span \* permille\) \/ 1000n/, 'BigInt interpolation');
  });

  test('cleans up its RAF and timers on disconnect', () => {
    assert.match(src, /disconnectedCallback\(\)/);
    assert.match(src, /cancelAnimationFrame/);
    assert.match(src, /clearTimeout\(this\.#flashTimer\)/);
    assert.match(src, /clearTimeout\(this\.#floatTimer\)/);
  });

  test('keeps the headline free of decorative ticket-card UI', () => {
    assert.doesNotMatch(src, /gr__ticket|buildGoldTicket|BADGE_QUADRANTS/);
    assert.doesNotMatch(css, /\.gr__ticket/);
  });

  test('adds a compact Degenerus Protocol lockup without demoting the jackpot number', () => {
    assert.match(
      src,
      /class="gr__brand"[\s\S]{0,320}\/whitepaper\/flame-logo\.svg[\s\S]{0,320}<strong>DEGENERUS<\/strong>[\s\S]{0,120}<small>PROTOCOL<\/small>/,
      'the banner carries the protocol flame and full brand name',
    );
    assert.ok(
      src.indexOf('class="gr__brand"') < src.indexOf('class="gr__amount"'),
      'the restrained brand lockup precedes the headline figure',
    );
    assert.match(
      css,
      /\.gr__amount\s*\{[\s\S]{0,760}font-size:\s*clamp\(3\.55rem,\s*8\.4vw,\s*6\.8rem\)/,
      'the jackpot amount retains its oversized headline scale',
    );
    assert.match(
      src,
      /class="gr__unit-code"[^>]*aria-label="Ethereum"[^>]*>ETH</,
      'the amount uses an explicit, readable Ethereum currency code',
    );
    assert.doesNotMatch(src, /gr__unit-(?:mark|logo)|crypto_06_ethereum_silver\.svg/,
      'the old circled Ethereum icon is not rendered beside the amount');
    assert.match(
      css,
      /\.gr__unit-code\s*\{[^}]*font-size:\s*clamp\(0\.72rem,\s*1\.5vw,\s*0\.92rem\)/s,
      'the plain ETH code is larger now that it carries the denomination alone',
    );
    assert.match(
      css,
      /\.gr__brand-logo\s*\{[\s\S]{0,180}width:\s*clamp\(1\.45rem,\s*3\.2vw,\s*1\.9rem\)/,
      'the protocol mark stays subordinate to the number',
    );
    assert.match(
      css,
      /\.gr__brand-copy strong\s*\{[^}]*font-size:\s*clamp\(0\.58rem,\s*1\.5vw,\s*0\.72rem\)/s,
      'the DEGENERUS line is readable without competing with the amount',
    );
    assert.match(
      css,
      /\.gr__brand-copy small\s*\{[^}]*font-size:\s*clamp\(0\.4rem,\s*1\.05vw,\s*0\.5rem\)/s,
      'the PROTOCOL line receives the same modest size increase',
    );
    assert.doesNotMatch(src, /gr__bounty-pool|BOUNTY POOL|bounty-pool-amount/,
      'the protocol-logo lockup stays free of the unrelated bounty pool');
    assert.match(
      css,
      /\.gr__label-text\s*\{[^}]*font-size:\s*clamp\(0\.72rem,\s*1\.75vw,\s*1\.02rem\)/s,
      'Golden Ticket Jackpot is slightly larger across the responsive range',
    );
    assert.match(
      css,
      /\.gr\s*\{[\s\S]{0,520}golden-ticket-frame-v1\.webp/,
      'the dedicated art pass is integrated as a decorative frame behind live HTML',
    );
    assert.match(
      css,
      /@media \(max-width: 640px\)[\s\S]*?\.gr__amount\[data-fit="medium"\]\s*\{[^}]*font-size:[^}]*\}[\s\S]*?\.gr__amount\[data-fit="long"\]\s*\{[^}]*font-size:/,
      'narrow screens shrink longer live totals before the ETH lockup can clip',
    );
  });
});

// ===========================================================================
// Wiring gates (index.html + polling.js)
// ===========================================================================

describe('gold-rush headline wiring', () => {
  const htmlPath = resolvePath(__dirname, '../../index.html');
  const html = readFileSync(htmlPath, 'utf8');
  const pollingPath = resolvePath(__dirname, '../../app/polling.js');
  const polling = readFileSync(pollingPath, 'utf8');

  test('mounted in the app shell and its module is loaded', () => {
    // The tag ships the static LCP shell (class="gr" + adopted children) —
    // index-structure.test.js asserts the shell's contents in depth.
    assert.match(html, /<gold-rush-headline class="gr">/);
    assert.match(html, /src="\/app\/components\/gold-rush-headline\.js"/);
  });

  test('mounted above the main jackpot hero (it is the headline)', () => {
    const grIdx = html.indexOf('<gold-rush-headline');
    const heroIdx = html.indexOf('<section class="jackpot-hero"');
    assert.ok(grIdx > -1 && heroIdx > -1, 'both elements present');
    assert.ok(grIdx < heroIdx, 'gold-rush headline comes first');
  });

  test('polling.js owns the goldRush cycle and writes app.goldRush', () => {
    assert.match(polling, /goldRush: 5_000/);
    assert.match(polling, /blockAndAggregate\.staticCall\(calls\)/);
    assert.match(polling, /CHAIN\.goldRushPublicRpcUrl/,
      'disconnected fallback is explicitly keyless, never the generic app RPC');
    assert.doesNotMatch(polling, /fetchJSONWithSignal\('\/game\/jackpot\/gold-rush'/,
      'headline never traverses the API/database route');
    assert.match(polling, /update\('app\.goldRush', payload\)/);
    // Self-rescheduling setTimeout, NOT setInterval — the gap adapts.
    assert.match(polling, /TIMER_HANDLES\.goldRush = setTimeout\(runGoldRushCycle, _goldRushDelay\)/);
  });
});

// ===========================================================================
// Adaptive cadence (polling.js goldRushNextDelay)
//
// The point of the backoff is that the ticker's request budget should follow the
// money, not the clock: tight while the headline moves, near-silent when it doesn't.
// ===========================================================================

describe('gold-rush adaptive cadence', () => {
  const p = pollingTesting;
  const { GOLD_RUSH_CADENCE, goldRushNextDelay, resetGoldRushCadence } = p;

  const at = (atBlock) => ({ atBlock });

  test('starts at the floor on the first payload', () => {
    resetGoldRushCadence();
    assert.equal(goldRushNextDelay(at(100)), GOLD_RUSH_CADENCE.active);
  });

  test('holds the floor while the headline keeps moving', () => {
    resetGoldRushCadence();
    for (let b = 100; b < 110; b += 1) {
      assert.equal(goldRushNextDelay(at(b)), GOLD_RUSH_CADENCE.active, `block ${b}`);
    }
  });

  test('doubles the gap every backoffAfter unchanged polls, capped at max', () => {
    resetGoldRushCadence();
    goldRushNextDelay(at(100));
    const seen = [];
    for (let i = 0; i < 20; i += 1) seen.push(goldRushNextDelay(at(100)));
    // 5s → 10s → 20s → 40s → 60s (capped), two polls per step.
    assert.deepEqual(seen.slice(0, 8), [5000, 10000, 10000, 20000, 20000, 40000, 40000, 60000]);
    assert.equal(seen[seen.length - 1], GOLD_RUSH_CADENCE.max, 'settles at the cap');
    for (const d of seen) assert.ok(d <= GOLD_RUSH_CADENCE.max, `never exceeds max: ${d}`);
  });

  test('snaps straight back to the floor the moment the block changes', () => {
    resetGoldRushCadence();
    goldRushNextDelay(at(100));
    for (let i = 0; i < 20; i += 1) goldRushNextDelay(at(100));   // fully backed off
    assert.equal(p.goldRushDelay, GOLD_RUSH_CADENCE.max, 'precondition: at the cap');
    assert.equal(goldRushNextDelay(at(101)), GOLD_RUSH_CADENCE.active, 'burst caught at the floor');
  });

  test('a failed poll (null payload) backs off rather than hammering a down RPC', () => {
    resetGoldRushCadence();
    goldRushNextDelay(at(100));
    goldRushNextDelay(null);
    goldRushNextDelay(null);
    assert.ok(p.goldRushDelay > GOLD_RUSH_CADENCE.active, `backed off, got ${p.goldRushDelay}`);
  });

  test('a null-atBlock payload (cold start, ready:false) does not reset the backoff', () => {
    resetGoldRushCadence();
    goldRushNextDelay({ atBlock: null });
    goldRushNextDelay({ atBlock: null });
    assert.ok(p.goldRushDelay > GOLD_RUSH_CADENCE.active, 'cold start counts as quiet');
  });

  // Delays used while quiet: 5,5,10,10,20,20,40,40,60,60,60… → 11 polls to cover
  // 300s, against 60 at a fixed 5s interval. That is the whole point of the backoff;
  // pin it so a cadence tweak has to own its effect on the idle request budget.
  test('idle cost: a 5-minute silence is 11 requests, not 60', () => {
    resetGoldRushCadence();
    goldRushNextDelay(at(100));
    let elapsed = 0;
    let requests = 0;
    while (elapsed < 300_000) {
      elapsed += p.goldRushDelay;
      requests += 1;
      goldRushNextDelay(at(100));
    }
    assert.equal(requests, 11, `5-minute idle request count (fixed 5s would be 60)`);
  });
});
