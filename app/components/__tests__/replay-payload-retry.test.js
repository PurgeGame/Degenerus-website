import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../replay-panel.js', import.meta.url), 'utf8');

test('jackpot read failures distinguish an unavailable service from a pending draw and recover per source', () => {
  const helper = source.slice(source.indexOf('export function jackpotReadIsUnavailable('), source.indexOf('function escapeHtml('))
    .replace('export function', 'function');
  const start = source.indexOf('  #recordJackpotRead(');
  const end = source.indexOf('\n  /**', start);
  const state = runInNewContext(`${helper}
    new (class {
      #unavailableReads = new Set();
      #syncSpinControlState() {}
      ${source.slice(start, end)}
      record(key, error) { this.#recordJackpotRead(key, error); }
      has(key) { return this.#unavailableReads.has(key); }
      unavailable(error) { return jackpotReadIsUnavailable(error); }
    })()`);
  assert.equal(state.unavailable({ status: 404 }), false, 'a not-yet-indexed draw is still processing');
  assert.equal(state.unavailable({ name: 'AbortError' }), false, 'normal lifecycle cancellation is not an outage');
  for (const error of [{ status: 503 }, { response: { status: 429 } }, new TypeError('Failed to fetch')]) {
    assert.equal(state.unavailable(error), true);
  }
  state.record('days', { status: 503 });
  state.record('rolls:42', { status: 503 });
  state.record('days');
  assert.equal(state.has('days'), false);
  assert.equal(state.has('rolls:42'), true, 'an RNG recovery cannot hide a failed roll read');
  state.record('rolls:42', { name: 'AbortError' });
  assert.equal(state.has('rolls:42'), true);
  state.record('rolls:42');
  assert.equal(state.has('rolls:42'), false, 'successful retries clear the unavailable state');
});

test('craps-pass winner tooltips render without aborting jackpot readiness', () => {
  const helpers = source.slice(source.indexOf('function escapeHtml('), source.indexOf('/** Resolve the ticket cohort'));
  const start = source.indexOf('  #buildWinnerTooltip(');
  const end = source.indexOf('  // --- Reveal / Spin ---', start);
  const render = runInNewContext(`${helpers}
    new (class {
      #openingFlipDay = false;
      ${source.slice(start, end)}
      render(entries, bonus) { return this.#buildWinnerTooltip(entries, bonus); }
    })()`);
  for (const bonus of [false, true]) {
    const html = render.render([{ awardType: 'craps_pass', amount: '7', count: 2, traitId: null }], bonus);
    assert.match(html, /7 Craps comps/);
    assert.match(html, /×2/);
    const escaped = render.render([{ awardType: 'craps_pass', amount: '<b>&"\'', traitId: null }], bonus);
    assert.match(escaped, /&lt;b&gt;&amp;&quot;&#039;/);
    assert.doesNotMatch(escaped, /<b>/);
  }
});

test('processing-day retries wait for roll payloads before loading day distributions', () => {
  const handler = source.match(
    /async #onDayChange\(e\)\s*\{([\s\S]*?)\n  #onPlayerChange/,
  )?.[1] || '';
  const rollsAt = handler.indexOf('const rolls = await this.#loadDayRolls(dayNum)');
  const detailAt = handler.indexOf('const detail = await this.#loadDayDetail(dayNum)');

  assert.ok(rollsAt >= 0, 'the retry path loads exact roll readiness');
  assert.ok(detailAt > rollsAt, 'large day detail is never loaded ahead of roll readiness');
  assert.match(
    handler,
    /const rollPayloadsReady =[\s\S]*?if \(rollPayloadsReady\) \{[\s\S]*?await this\.#loadDayDetail\(dayNum\)/,
    'day detail remains behind the complete-roll guard',
  );
});

test('center reveal preserves AFKing and far-future sources, including seat-only wins', () => {
  const start = source.indexOf('  #distributePrizesFromRoll2(');
  const end = source.indexOf('\n  /**', start);
  const revealStart = source.indexOf('  #revealCenter(');
  const revealEnd = source.indexOf('  // --- Quadrant reveal', revealStart);
  const render = runInNewContext(`new (class {
    #quadWinArrays = []; #centerWins = []; #centerScratched = false;
    #sfxScratchStop() {} #sfxGreenReveal() {} #checkAllScratched() {}
    prize = { style: {}, classList: { remove() {}, add() {} }, setAttribute(k,v) { this[k] = v; } };
    querySelector(s) { return s.includes('center-prize') ? this.prize : null; }
    ${source.slice(start, end)}
    ${source.slice(revealStart, revealEnd)}
    run(wins) { this.#centerScratched = false; this.#distributePrizesFromRoll2([], wins); this.#revealCenter({ instant: true }); return this.prize; }
  })()`, { formatFlip: v => String(BigInt(v) / 10n ** 18n), formatCenterBonusFlip: v => String(v / 10n ** 18n) });
  const seat = { awardType: 'afking_seat_flip', amount: String(4000n * 10n ** 18n), traitId: null };
  const onlySeat = render.run([seat]);
  assert.match(onlySeat.innerHTML, /AFKING SEAT/);
  assert.match(onlySeat.title, /4000 FLIP AFKing Seat Draw/);
  const combined = render.run([seat, { awardType: 'farFutureCoin', amount: String(10n * 10n ** 18n), traitId: null }]);
  assert.match(combined.innerHTML, /4010/);
  assert.match(combined.innerHTML, /BONUS \+ AFKING/);
  assert.match(combined.title, /10 FLIP far-future bonus/);
  assert.match(combined.title, /4000 FLIP AFKing Seat Draw/);
});
