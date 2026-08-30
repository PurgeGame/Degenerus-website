import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativeUrl) {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

const WRITERS = new Map([
  ['ticket, Luckbox, foil, and presale purchases', source('../lootbox.js')],
  ['premium pass purchases and AFKing funding', source('../passes.js')],
  ['Degenerette bets', source('../degenerette.js')],
  ['Coinflip deposits', source('../coinflip.js')],
  ['Craps entries', source('../craps.js')],
  ['Growth bets', source('../parimutuel.js')],
]);

test('every mission-critical money-in writer is database-free', () => {
  for (const [name, moduleSource] of WRITERS) {
    assert.doesNotMatch(
      moduleSource,
      /from\s+['"][^'"]*(?:api|game-state)\.js['"]|\b(?:fetchJSON|readGameState)\s*\(/,
      `${name} must stay wallet/RPC -> contract with no indexed API dependency`,
    );
  }
});

function handler(moduleSource, start, end) {
  const first = moduleSource.indexOf(start);
  const last = moduleSource.indexOf(end, first + start.length);
  assert.ok(first >= 0, `missing handler marker: ${start}`);
  assert.ok(last > first, `missing handler terminator: ${end}`);
  return moduleSource.slice(first, last);
}

test('mounted money-in click handlers never await indexed data', () => {
  const decimator = source('../../components/app-decimator-panel.js');
  const passes = source('../../components/app-pass-section.js');
  const degenerette = source('../../components/app-degenerette-panel.js');
  const dailyFlip = source('../../components/app-daily-flip.js');
  const craps = source('../../components/app-craps-entry.js');
  const parimutuel = source('../../components/app-parimutuel-panel.js');

  const criticalHandlers = new Map([
    ['Buy In', handler(decimator, 'async #onBuyClick(', '#renderError(')],
    ['Lazy pass', handler(passes, 'async #onLazyBuyClick(', '#renderLazyError(')],
    ['Whale pass', handler(passes, 'async #onWhaleBuyClick(', 'async #onDeityBuyClick(')],
    ['Deity pass', handler(passes, 'async #onDeityBuyClick(', 'async #onAfkingFund(')],
    ['AFKing top-up', handler(passes, 'async #onAfkingFund(', 'async #onAfkingWithdraw(')],
    ['AFKing setup funding', handler(passes, 'async #onAfkingSave(', 'async #onAfkingCancel(')],
    ['Degenerette', handler(degenerette, 'async #onPlaceClick(', '#startRngPollCycle(')],
    ['Coinflip deposit', handler(dailyFlip, 'async #runAction(', '#setStatus(')],
    ['Craps entry', handler(craps, 'async #buy(', '\n}\n\nif (!customElements.get')],
    ['Growth bet', handler(parimutuel, 'async #bet(', 'async #enterDecimator(')],
  ]);

  for (const [name, handlerSource] of criticalHandlers) {
    assert.doesNotMatch(
      handlerSource,
      /\b(?:fetchJSON|readGameState)\s*\(/,
      `${name} must not put the DB in the wallet gesture's promise graph`,
    );
  }
});
