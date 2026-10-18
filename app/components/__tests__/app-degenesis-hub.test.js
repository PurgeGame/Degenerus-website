import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.HTMLElement ??= class HTMLElement {};
globalThis.customElements ??= {
  get() { return null; },
  define() {},
};

const {
  DEGENESIS_START_DAY,
  MAIN_LAUNCH_DAY,
  DEGENESIS_LAYOUT_END_DAY,
  degenesisWallDay,
  secondsToNextDay,
  degenesisHubModel,
  degenesisMaxWei,
  degenesisAmountWei,
  degenesisOrderSummary,
} = await import('../app-degenesis-hub.js');
const {
  degenesisWindow, degenesisWindowLabel, inDegenesisPeriod, formatDegenesisCountdown,
} = await import('../../app/degenesis.js');

const component = readFileSync(new URL('../app-degenesis-hub.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/degenesis-hub.css', import.meta.url), 'utf8');
const lootbox = readFileSync(new URL('../../app/lootbox.js', import.meta.url), 'utf8');

const MIN = 10_000_000_000n; // 0.01 ETH at the testnet /1M scale
const UNIT = 100_000_000n; // 0.0001 ETH at the testnet /1M scale
const base = { supported: true, minWei: MIN, connected: true };

describe('Degenesis cabinet hub', () => {
  test('the window matches GameTimeLib: hub from deploy through day 8, drawing back at day 9', () => {
    assert.equal(DEGENESIS_START_DAY, 2);
    assert.equal(MAIN_LAUNCH_DAY, 9);
    assert.equal(DEGENESIS_LAYOUT_END_DAY, 9);
    assert.equal(degenesisHubModel({ ...base, day: 1, creditWei: MIN }).active, true, 'deploy day shows the hub');
    assert.equal(degenesisHubModel({ ...base, day: 8, creditWei: MIN }).active, true,
      'the last sale day keeps the Degenesis buttons');
    assert.equal(degenesisHubModel({ ...base, day: 9, creditWei: MIN }).active, false,
      'the request that opens day 9 runs the first daily jackpot');
    assert.equal(degenesisHubModel({ ...base, day: 3, creditWei: MIN, supported: false }).active, false,
      'a deployment without buyDegenesisBox never shows it');
    assert.equal(degenesisHubModel({ ...base, day: null, creditWei: MIN }).active, false);
  });

  test('the Degenesis button unlocks only on a sale day with at least the minimum credit', () => {
    const tomorrow = degenesisHubModel({ ...base, day: 1, creditWei: MIN * 5n });
    assert.equal(tomorrow.unlocked, false);
    assert.equal(tomorrow.lock, 'opens-tomorrow');
    assert.equal(degenesisHubModel({ ...base, day: 2, creditWei: MIN - 1n }).lock, 'no-credit');
    assert.equal(degenesisHubModel({ ...base, day: 2, creditWei: null }).lock, 'no-credit');
    assert.equal(degenesisHubModel({ ...base, day: 2, creditWei: MIN, connected: false }).lock, 'connect');
    const open = degenesisHubModel({ ...base, day: 4, creditWei: MIN });
    assert.equal(open.unlocked, true);
    assert.equal(open.degenesisDay, 3);
  });

  test('day clock and amount helpers follow the deployment clock and the 0.0001 ETH unit', () => {
    const clock = { anchor: 82_620, period: 1_200, deployDayBoundary: 100 };
    const dayStart = (n) => (clock.deployDayBoundary + n - 1) * clock.period + clock.anchor;
    assert.equal(degenesisWallDay(dayStart(1), clock), 1);
    assert.equal(degenesisWallDay(dayStart(5) + 600, clock), 5);
    assert.equal(degenesisWallDay(dayStart(5), { ...clock, deployDayBoundary: null }), null);
    assert.equal(secondsToNextDay(dayStart(3) + 200, clock), 1_000);
    assert.equal(degenesisMaxWei(MIN + UNIT + 7n, UNIT), MIN + UNIT);
    assert.equal(degenesisAmountWei('0.0123', UNIT, 1_000_000n), 123n * UNIT);
    // buyDegenesisBox reverts a non-unit amount, so the form rejects it rather than trimming it.
    assert.equal(degenesisAmountWei('0.01239', UNIT, 1_000_000n), null, 'off the 0.0001 ETH grid');
    assert.equal(degenesisAmountWei('0.0123000000000000001', UNIT, 1_000_000n), null, 'over 18 decimals');
    assert.equal(degenesisAmountWei('abc', UNIT, 1_000_000n), null);
    assert.equal(degenesisAmountWei('', UNIT, 1_000_000n), null);
  });

  test('the Degenesis window follows game days 1 (credit), 2-8 (sale) and 9 (launch)', () => {
    const clock = { anchor: 82_620, period: 1_200, deployDayBoundary: 100 };
    const dayStart = (n) => (clock.deployDayBoundary + n - 1) * clock.period + clock.anchor;
    const deployDay = degenesisWindow(dayStart(1) + 200, clock);
    assert.deepEqual(deployDay, { day: 1, phase: 'credit', saleOpen: false, degenesisDay: null, secondsLeft: 1_000 });
    assert.match(degenesisWindowLabel(deployDay), /^DEGENESIS OPENS IN 16m 40s$/);
    for (const [index, degenesisDay] of [[2, 1], [8, 7]]) {
      const sale = degenesisWindow(dayStart(index) + 1_199, clock);
      assert.equal(sale.phase, 'sale');
      assert.equal(sale.degenesisDay, degenesisDay);
      assert.equal(degenesisWindowLabel(sale), `DAY ${degenesisDay} OF 7 · CLOSES IN 1s`);
      assert.equal(inDegenesisPeriod(dayStart(index), clock), true, 'level 0 is expected');
    }
    const launched = degenesisWindow(dayStart(9), clock);
    assert.equal(launched.phase, 'launched');
    assert.equal(launched.secondsLeft, null);
    assert.equal(inDegenesisPeriod(dayStart(9), clock), false);
    assert.equal(formatDegenesisCountdown(3 * 3600 + 5 * 60 + 9), '3h 05m');
  });

  test('order rows show pending orders and every resolved reward lane', () => {
    assert.equal(degenesisOrderSummary({ resolved: null }), 'Opens after its cohort settles');
    assert.equal(degenesisOrderSummary({ resolved: { flip: '1500', dgnrs: '0', wwxrp: '1', normalPasses: 0, highPasses: 2 } }),
      '1500 FLIP · 2 HIGH PASSES · 1 WWXRP');
    assert.equal(degenesisOrderSummary({ resolved: { flip: '0', dgnrs: '7', wwxrp: '1', normalPasses: 1, highPasses: 0 } }),
      '1 PASS · 7 sDGNRS · 1 WWXRP');
  });

  test('tickets and Luckboxes drive the purchase desk instead of a second order model', () => {
    for (const bind of ['dec-ticket-add-entry', 'dec-ticket-add-ticket', 'dec-ticket-add-pack',
      'dec-foil-row', 'dec-box-add-small', 'dec-box-add-medium', 'dec-box-add-large', 'dec-buy-cta',
      'dec-ticket-clear']) {
      assert.ok(component.includes(`'${bind}'`), `desk control referenced: ${bind}`);
    }
    assert.match(component, /this\.#deskControl\('dec-buy-cta'\)\?\.click\(\)/,
      'BUY delegates to the desk\'s own guarded purchase button');
    assert.match(component, /data-panel-open="passes"/, 'Passes open the existing AFKING PASSES popup');
    assert.match(component, /#onTxConfirmed = \(\) => \{[\s\S]*?this\.#deskBuyPending && \(this\.#dialogKind === 'tickets' \|\| this\.#dialogKind === 'luckboxes'\)\)[\s\S]*?this\.#close\(\);/,
      'a confirmed desk purchase closes the Tickets/Luckboxes popup (phone review 2026-10-18: it stayed up)');
    assert.match(component, /class="qst-action-dialog dgx-dialog"/, 'the popup reuses the quest dialog');
  });

  test('the Degenesis write is gated on the generated ABI and mirrors the contract', () => {
    assert.match(lootbox, /'function buyDegenesisBox\(address buyer, uint256 amount\) payable'/);
    assert.match(lootbox, /'function degenesisCreditOf\(address player\) view returns \(uint256 credit\)'/);
    assert.match(lootbox, /export function degenesisSupported\(\)[\s\S]*?name === 'buyDegenesisBox'/);
    assert.match(lootbox, /DEGENESIS_MIN_WEI = ethers\.parseEther\('0\.01'\) \/ ETH_DIVISOR/);
    assert.match(lootbox, /DEGENESIS_UNIT_WEI = ethers\.parseEther\('0\.0001'\) \/ ETH_DIVISOR/);
    assert.match(component, /<li><strong>50%<\/strong>[\s\S]*?<li><strong>40%<\/strong><span>sDGNRS[\s\S]*?<li><strong>10%<\/strong><span>WWXRP/,
      'contents match _degenesisOutcome: 50% FLIP-valued, 40% sDGNRS, 10% WWXRP');
  });

  test('the hub sits in the drawing machine and takes over the board quadrants', () => {
    assert.match(html,
      /<div class="jackpot-hero__machine"[^>]*>[\s\S]*?<last-day-jackpot><\/last-day-jackpot>[\s\S]*?<app-degenesis-hub><\/app-degenesis-hub>/);
    assert.match(html, /src="\/app\/components\/app-degenesis-hub\.js"/);
    assert.match(html, /href="\/app\/styles\/degenesis-hub\.css"/);
    assert.doesNotMatch(css, /ldj-foil-machine-bank/, 'the foil sockets stay as they are');
    assert.match(component, /quadrant\.replaceChildren\(button\)/,
      'buy buttons replace the contents of the existing replay quadrants');
    assert.doesNotMatch(component, /class="dgx-center"/,
      'the original center diamond and flame remain the only center');
    assert.match(css, /\.dgx-module \{[^}]*width: 100%;[^}]*height: 100%/,
      'buttons fill their original quadrant at every board size');
    assert.match(component, /class="app-decimator-panel dgx-ticket-art"[\s\S]*?class="dec-ticket-face"/,
      'Tickets shows the desk\'s ticket face');
    assert.match(css, /\.dgx-module--passes \.dgx-module__label \{[^}]*clip-path: inset\(50%\)/,
      'the passes art carries its own PASSES word');
  });
});
