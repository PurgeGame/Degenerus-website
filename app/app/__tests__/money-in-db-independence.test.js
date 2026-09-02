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
  ['Growth bets', source('../parimutuel.js')],
  ['Craps entries', source('../craps.js')],
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

// The craps lobby WINDOW moved to /game/craps/events because the old client
// scan pulled a 45,000-block, ~5.6 MB eth_getLogs page on every load. The one
// fetch lives in craps-events.js (a satellite, like coinflip-day-status.js),
// so craps.js itself stays in the blanket guard above. The eth_getLogs path
// survives underneath as the fallback, so a dead indexer costs the lobby
// bandwidth rather than the ability to play; and no craps WRITE door may put
// the window loader in a wallet gesture's promise graph.
test('the craps API window is read-only and keeps its chain fallback', () => {
  const craps = source('../craps.js');
  assert.doesNotMatch(
    craps,
    /\bfetchJSON\s*\(/,
    'craps.js must not call the API directly; the window loader owns the one call site',
  );
  assert.match(
    craps,
    /provider\.getLogs\(/,
    'the eth_getLogs window must survive as the fallback for a dead or old API',
  );
  assert.match(
    craps,
    /CRAPS_API_FAILURE_MEMO_MS/,
    'an API failure must be memoised rather than re-probed on every poll',
  );
  const doors = new Map([
    ['placeCrapsBonusEntry', handler(
      craps,
      'export async function placeCrapsBonusEntry(',
      '/** Re-spread zero through seven chips',
    )],
    ['amendCrapsSlip', handler(
      craps,
      'export async function amendCrapsSlip(',
      '/** Upgrade selected windows',
    )],
    ['upgradeCrapsDayWindows', handler(
      craps,
      'export async function upgradeCrapsDayWindows(',
      '// Revert copy for the errors',
    )],
  ]);
  for (const [name, body] of doors) {
    assert.doesNotMatch(
      body,
      /\b(?:fetchJSON|readGameState|readCrapsWindowLogs|CRAPS_EVENTS_ROUTE)\b/,
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
