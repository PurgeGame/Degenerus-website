// The jackpot replay centre as a purchase day's fill-draw craps battle (audit 5790a946).
// Source-sliced like the panel's other suites: the real private methods and listener bodies run
// against a small fake DOM, so the wiring under test is the shipped code, not a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { coinDrawCentreModel } from '../../app/coin-draw-centre.js';

const source = readFileSync(new URL('../replay-panel.js', import.meta.url), 'utf8');
const between = (from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `missing end ${to}`);
  return source.slice(start, end);
};
const listenerBody = (open, close) => between(open, close).slice(open.length);

const WEI = 10n ** 18n;
const VIEWER = '0x' + 'ab'.repeat(20);
const OTHER = '0x' + 'cd'.repeat(20);
const battle = { kind: 'fill-draw', key: 'coin-draw:42', day: 42, pot: String(9_000n * WEI), winner: OTHER, entrants: [
  { player: OTHER, units: '1', bankrollOut: String(20_000n * WEI), rolls: '88', paid: String(20_000n * WEI) },
  { player: VIEWER, units: '1', bankrollOut: String(12n * WEI), rolls: '31', paid: '0' },
] };

function element() {
  const classes = new Set(); const attrs = new Map();
  return {
    hidden: false, textContent: '', title: '', dataset: {},
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name),
      add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    setAttribute(name, value) { attrs.set(name, String(value)); if (name === 'hidden') this.hidden = true; },
    removeAttribute(name) { attrs.delete(name); if (name === 'hidden') this.hidden = false; },
    getAttribute: (name) => attrs.get(name) ?? null,
    hasAttr: (name) => attrs.has(name),
  };
}

function panel({ coinDrawBattle = battle, player = VIEWER, day = 42, mainSpinComplete = true, bonusTraitDraw = false, toggleReady = false } = {}) {
  const dom = { center: element(), button: element(), caption: element(), action: element() };
  const klass = `new (class {
    #coinDrawBattle = null; #coinDrawOpening = false; #coinDrawStatusFor = null;
    #mainSpinComplete = false; #spinning = false; #selectedDay = null; #selectedPlayer = null;
    #hasBonus = false; #bonusScratchComplete = false; #drawViewSwitching = false; #bonusPhase = false;
    #dayBonusTraitDraw = true; #dayRoll1 = null; #dayRoll2 = null; #playerRoll1Wins = []; #playerRoll2Wins = [];
    #quadWinArrays = []; #centerWins = []; #skipSpinId = null; #animId = 0;
    opened = []; toggled = 0; toggleReady = false;
    querySelector(selector) {
      if (selector.includes('"center"')) return dom.center;
      if (selector.includes('"craps-battle"')) return dom.button;
      if (selector.includes('craps-battle-caption')) return dom.caption;
      if (selector.includes('craps-battle-action')) return dom.action;
      return null;
    }
    #mainReadyForBonus() { return this.toggleReady; }
    #openCoinDrawBattle(opener) { this.opened.push(opener); return Promise.resolve(true); }
    #toggleRevealedDraw() { this.toggled++; return Promise.resolve(); }
    ${between('  #drawToggleReady() {', '  #setCoinDrawStatus(')}
    ${between('  #filterPlayerWins(addr) {', '\n  // Pulled by')}
    ${between('  #distributePrizesFromRoll1() {', '\n  // Legacy method')}
    click(event) { const centerEl = this.querySelector('[data-bind="center"]');${listenerBody("centerEl.addEventListener('click', (event) => {", "\n      });\n      centerEl.addEventListener('keydown'")}}
    keydown(event) { const centerEl = this.querySelector('[data-bind="center"]');${listenerBody("centerEl.addEventListener('keydown', (event) => {", '\n      });\n    }')}}
    setup(state) {
      this.#coinDrawBattle = state.coinDrawBattle; this.#selectedPlayer = state.player; this.#selectedDay = state.day;
      this.#mainSpinComplete = state.mainSpinComplete; this.#dayBonusTraitDraw = state.bonusTraitDraw;
      this.#dayRoll2 = { day: state.day, wins: state.roll2Wins ?? [] }; this.#dayRoll1 = { day: state.day, wins: [] };
      if (state.toggleReady) { this.toggleReady = true; this.#hasBonus = true; this.#bonusScratchComplete = true; }
    }
    filter(addr) { this.#filterPlayerWins(addr); return this.#hasBonus; }
    distribute() { this.#distributePrizesFromRoll1(); return this.#centerWins; }
    sync() { return this.#syncCoinDrawCentre(); }
  })()`;
  const instance = runInNewContext(klass, { dom, coinDrawCentreModel, DISPLAY_ORDER: [0, 1, 2, 3], console });
  instance.setup({ coinDrawBattle, player, day, mainSpinComplete, bonusTraitDraw, toggleReady });
  return { instance, dom };
}

test('purchase day, viewer drawn in: the centre glows, reads as a button and opens their run', () => {
  const { instance, dom } = panel();
  const model = instance.sync();
  assert.equal(model.player, VIEWER);
  assert.equal(model.index, 1);
  assert.equal(dom.center.classList.contains('replay-ticket-center--craps'), true);
  assert.equal(dom.center.getAttribute('role'), 'button');
  assert.equal(dom.center.getAttribute('tabindex'), '0');
  assert.match(dom.center.getAttribute('aria-label'), /CRAPS BATTLE · 2 RUNS · POT 9K FLIP/);
  assert.equal(dom.button.hidden, false);
  assert.equal(dom.caption.textContent, 'CRAPS BATTLE · 2 RUNS · POT 9K FLIP');
  assert.equal(dom.action.textContent, 'BUSTED · WATCH YOUR RUN ›');

  instance.click({ target: { classList: { contains: () => false } } });
  assert.equal(instance.opened.length, 1, 'a centre click opens the battle, not a draw toggle');
  assert.equal(instance.opened[0], dom.center, 'focused back to the centre when the table closes');
  assert.equal(instance.toggled, 0);
  let prevented = false;
  instance.keydown({ key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(instance.opened.length, 2, 'Enter opens it too');
  assert.equal(prevented, true);
  // A click that finishes a centre scratch never opens anything.
  instance.click({ target: { classList: { contains: (name) => name === 'replay-center-canvas' } } });
  assert.equal(instance.opened.length, 2);
});

test('purchase day, viewer not drawn or no viewer: no highlight and no click', () => {
  for (const player of [OTHER.replace('cd', 'ef'), null, '']) {
    const { instance, dom } = panel({ player });
    assert.equal(instance.sync(), null);
    assert.equal(dom.center.classList.contains('replay-ticket-center--craps'), false);
    assert.equal(dom.center.getAttribute('role'), null);
    assert.equal(dom.button.hidden, true);
    instance.click({ target: { classList: { contains: () => false } } });
    instance.keydown({ key: 'Enter', preventDefault() {} });
    assert.equal(instance.opened.length, 0);
  }
});

test('a highlight clears when the viewer changes to a wallet that was not drawn', () => {
  const { instance, dom } = panel();
  instance.sync();
  assert.equal(dom.center.getAttribute('role'), 'button');
  instance.setup({ coinDrawBattle: battle, player: OTHER.replace('cd', 'ef'), day: 42, mainSpinComplete: true, bonusTraitDraw: false });
  instance.sync();
  assert.equal(dom.center.classList.contains('replay-ticket-center--craps'), false);
  assert.equal(dom.center.getAttribute('role'), null, 'no stale button role on the centre');
  assert.equal(dom.button.hidden, true);
});

test('jackpot day: never highlighted, and the centre keeps its draw toggle', () => {
  const { instance, dom } = panel({ coinDrawBattle: null, bonusTraitDraw: true, toggleReady: true });
  assert.equal(instance.sync(), null);
  assert.equal(dom.center.classList.contains('replay-ticket-center--craps'), false);
  assert.equal(dom.button.hidden, true);
  instance.click({ target: { classList: { contains: () => false } } });
  assert.equal(instance.opened.length, 0);
  assert.equal(instance.toggled, 1);
});

test('nothing lights before the main spin has played out', () => {
  const { instance, dom } = panel({ mainSpinComplete: false });
  assert.equal(instance.sync(), null);
  assert.equal(dom.button.hidden, true);
});

test('purchase day has no Bonus Spin; its battle FLIP lands in the main centre', () => {
  const win = { winner: VIEWER, awardType: 'farFutureCoin', amount: String(700n * WEI), traitId: null };
  const { instance } = panel({ bonusTraitDraw: false });
  instance.setup({ coinDrawBattle: battle, player: VIEWER, day: 42, mainSpinComplete: true, bonusTraitDraw: false, roll2Wins: [win] });
  assert.equal(instance.filter(VIEWER), false, 'no bonus-trait draw, no Bonus Spin');
  assert.deepEqual([...instance.distribute().map((row) => row.amount)], [win.amount]);

  const jackpot = panel({ coinDrawBattle: null, bonusTraitDraw: true }).instance;
  jackpot.setup({ coinDrawBattle: null, player: VIEWER, day: 42, mainSpinComplete: true, bonusTraitDraw: true, roll2Wins: [win] });
  assert.equal(jackpot.filter(VIEWER), true, 'a day with a bonus-trait draw keeps its Bonus Spin');
  assert.equal(jackpot.distribute().length, 0, 'and its roll-2 centre stays on the bonus board');
});

test('the ticket carries the centre dice and the battle caption button', () => {
  assert.match(source, /<span class="replay-center-dice" aria-hidden="true">/);
  assert.match(source, /<button type="button" class="replay-craps-battle" data-bind="craps-battle" hidden>/);
  assert.match(source, /import\('\.\.\/craps\/coin-draw-viewer\.js'\)/, 'the viewer loads only on click');
  const css = readFileSync(new URL('../../styles/replay.css', import.meta.url), 'utf8');
  assert.match(css, /\.replay-ticket-center\.replay-ticket-center--craps:not\(\.replay-ticket-center--draw-toggle\)::before/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.replay-ticket-center\.replay-ticket-center--craps::before \{ animation: none; \}/);
});
