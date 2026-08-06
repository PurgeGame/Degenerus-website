// Run: node --test app/components/__tests__/app-jackpot-resolutions.test.js

import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};
globalThis.customElements ??= {
  _items: new Map(),
  define(name, ctor) { this._items.set(name, ctor); },
  get(name) { return this._items.get(name); },
};

const {
  decimatorResolutionView,
  bafResolutionView,
} = await import('../app-jackpot-resolutions.js');

describe('Decimator resolution presentation', () => {
  test('a winning unclaimed subbucket becomes an honest resolve action', () => {
    const view = decimatorResolutionView({
      currentLevel: 25,
      level: 25,
      claimState: 'ready',
      outcome: {
        roundStatus: 'closed', bucket: 7, subbucket: 3,
        winningSubbucket: 3, payoutAmount: '1000000000000',
      },
    });
    assert.equal(view.status, 'READY TO RESOLVE');
    assert.equal(view.tone, 'ready');
    assert.equal(view.actionable, true);
    assert.match(view.message, /1 ETH estimated pool share/);
  });

  test('claimed winners and losing entries remain visible without stale actions', () => {
    const claimed = decimatorResolutionView({
      currentLevel: 26, level: 25, claimState: 'claimed',
      outcome: { roundStatus: 'closed', bucket: 7, subbucket: 3, winningSubbucket: 3, payoutAmount: '5' },
    });
    assert.equal(claimed.status, 'RESOLVED');
    assert.equal(claimed.actionable, false);

    const lost = decimatorResolutionView({
      currentLevel: 26, level: 25, claimState: 'lost',
      outcome: { roundStatus: 'closed', bucket: 7, subbucket: 2, winningSubbucket: 3, payoutAmount: '0' },
    });
    assert.equal(lost.status, 'NOT SELECTED');
    assert.match(lost.message, /Winning subbucket 3/);
    assert.equal(lost.actionable, false);
  });
});

describe('BAF resolution presentation', () => {
  test('normal BAF awards are described as automatic, with no fake resolve transaction', () => {
    const view = bafResolutionView({
      currentLevel: 20,
      level: 20,
      consolation: 0n,
      awards: { eth: 250000000000n, tickets: 2n },
      outcome: { roundStatus: 'closed', score: '1000000000000000000' },
    });
    assert.equal(view.status, 'BAF WINNER');
    assert.equal(view.actionable, false);
    assert.match(view.message, /paid automatically/);
    assert.match(view.message, /2 tickets/);
  });

  test('only a skipped bracket with exact on-chain consolation becomes actionable', () => {
    const ready = bafResolutionView({
      currentLevel: 20,
      level: 20,
      consolation: 12n * 10n ** 18n,
      awards: { eth: 0n, tickets: 0n },
      outcome: { roundStatus: 'skipped', score: '12000000000000000000000' },
    });
    assert.equal(ready.status, 'CONSOLATION READY');
    assert.equal(ready.actionable, true);
    assert.match(ready.message, /12 WWXRP/);

    const claimed = bafResolutionView({
      currentLevel: 20,
      level: 20,
      consolation: 0n,
      awards: { eth: 0n, tickets: 0n },
      outcome: { roundStatus: 'skipped', score: '12000000000000000000000' },
    });
    assert.equal(claimed.status, 'SKIPPED · SETTLED');
    assert.equal(claimed.actionable, false);
  });
});

test('the headless watcher is mounted between the jackpot hero and Side Bets row', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const hero = html.indexOf('<section class="jackpot-hero"');
  const resolutions = html.indexOf('<app-jackpot-resolutions hidden');
  const sideBets = html.indexOf('<section class="play-grid"');
  assert.ok(hero >= 0 && resolutions > hero && sideBets > resolutions);
  assert.match(html, /<app-jackpot-resolutions hidden aria-hidden="true"><\/app-jackpot-resolutions>/);
  assert.match(html, /src="\/app\/components\/app-jackpot-resolutions\.js"/);
});

test('the x4/x99 Decimator burn card is first and prominent inside Side Bets', () => {
  const source = readFileSync(new URL('../app-parimutuel-panel.js', import.meta.url), 'utf8');
  const cards = /<div class="pari-books">([\s\S]*?)<\/div>/.exec(source)?.[1] || '';
  assert.ok(cards.indexOf('data-bind="pari-decimator"') >= 0);
  assert.ok(cards.indexOf('data-bind="pari-decimator"') < cards.indexOf('data-bind="pari-growth"'));
  assert.match(source, /title\.textContent = 'DECIMATOR'/);
  assert.match(source, /burnPrompt\.textContent = 'BURN FLIP'/);
  assert.match(source, /return \(level % 10 === 4 && level % 100 !== 94\) \|\| level % 100 === 99/);
});
