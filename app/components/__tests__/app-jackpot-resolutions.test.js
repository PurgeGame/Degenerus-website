// Run: node --test app/components/__tests__/app-jackpot-resolutions.test.js

import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../../app/chain-config.js';

globalThis.HTMLElement ??= class {};
globalThis.customElements ??= {
  _items: new Map(),
  define(name, ctor) { this._items.set(name, ctor); },
  get(name) { return this._items.get(name); },
};

const {
  decimatorResolutionView,
  hasDecimatorPosition,
  bafResolutionView,
  jackpotResolutionSeenKey,
} = await import('../app-jackpot-resolutions.js');

describe('Decimator resolution presentation', () => {
  test('only an account with a recorded bucket has a Decimator position', () => {
    assert.equal(hasDecimatorPosition(null), false);
    assert.equal(hasDecimatorPosition({ bucket: null }), false);
    assert.equal(hasDecimatorPosition({ bucket: 0, roundStatus: 'closed' }), false);
    assert.equal(hasDecimatorPosition({ bucket: 7, roundStatus: 'closed' }), true);
  });

  test('seen receipts are scoped to the exact deployment', () => {
    const key = jackpotResolutionSeenKey('decimator', '0xAbC', 15);
    assert.equal(
      key,
      `jackpot-resolution-seen:${CHAIN.id}:${CHAIN.deployBlock}:decimator:0xabc:15`,
    );
  });

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

  test('chain winner evidence survives a bucket-less indexer snapshot', () => {
    const view = decimatorResolutionView({
      currentLevel: 200,
      level: 200,
      claimState: 'ready',
      outcome: { roundStatus: 'closed', bucket: null, payoutAmount: '0' },
    });
    assert.equal(view.status, 'READY TO RESOLVE');
    assert.equal(view.tone, 'ready');
    assert.equal(view.actionable, true);
    assert.match(view.message, /still syncing/);
  });

  test('claimed winners and losing entries remain visible without stale actions', () => {
    const claimed = decimatorResolutionView({
      currentLevel: 26, level: 25, claimState: 'claimed',
      outcome: { roundStatus: 'closed', bucket: 7, subbucket: 3, winningSubbucket: 3, payoutAmount: '5' },
    });
    assert.equal(claimed.status, 'RESOLVED');
    assert.equal(claimed.actionable, false);
    assert.match(claimed.message, /claimable ETH/);
    assert.match(claimed.message, /Luckbox \/ Whale Half-Pass/);

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

  test('whale-only BAF awards are wins, while unknown exact awards never claim a loss', () => {
    const sevenPasses = bafResolutionView({
      currentLevel: 40,
      level: 40,
      consolation: 0n,
      awards: { eth: 0n, tickets: 0n, whalePassHalves: 14n },
      outcome: { roundStatus: 'closed', score: '1000000000000000000' },
    });
    assert.equal(sevenPasses.status, 'BAF WINNER');
    assert.equal(sevenPasses.tone, 'won');
    assert.equal(sevenPasses.actionable, false);
    assert.match(sevenPasses.message, /7 WHALE PASSES/);

    const oneHalf = bafResolutionView({
      currentLevel: 40,
      level: 40,
      consolation: 0n,
      awards: { eth: 0n, tickets: 0n, whalePassHalves: 1n },
      outcome: { roundStatus: 'closed', score: '1000000000000000000' },
    });
    assert.match(oneHalf.message, /1 HALF-PASS/);

    const onePass = bafResolutionView({
      currentLevel: 40,
      level: 40,
      consolation: 0n,
      awards: { eth: 0n, tickets: 0n, whalePassHalves: 2n },
      outcome: { roundStatus: 'closed', score: '1000000000000000000' },
    });
    assert.match(onePass.message, /1 WHALE PASS(?!ES)/);

    const exactAwardsUnknown = bafResolutionView({
      currentLevel: 40,
      level: 40,
      consolation: 0n,
      awards: { eth: 0n, tickets: 0n },
      outcome: { roundStatus: 'closed', score: '1000000000000000000' },
    });
    assert.equal(exactAwardsUnknown.status, 'RESOLVED');
    assert.notEqual(exactAwardsUnknown.tone, 'lost');
    assert.doesNotMatch(exactAwardsUnknown.message, /did not receive a payout/i);
  });

  test('only a losing bracket with exact on-chain consolation becomes actionable', () => {
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
    assert.equal(claimed.status, 'LOSS · SETTLED');
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
  // Cold-load diet (2026-08-13): loads via the IDLE_MODULES registration,
  // not an eager script tag (hidden headless watcher).
  assert.match(html, /'\/app\/components\/app-jackpot-resolutions\.js'/);
});

test('a due Decimator replaces the primary jackpot action and opens the full wheel', () => {
  const resolutions = readFileSync(new URL('../app-jackpot-resolutions.js', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../replay-panel.js', import.meta.url), 'utf8');
  const tray = readFileSync(new URL('../app-reveal-tray.js', import.meta.url), 'utf8');
  const overlay = readFileSync(new URL('../app-decimator-draw-overlay.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

  assert.match(resolutions, /primarySurface:\s*'jackpot'/);
  assert.match(resolutions,
    /const decUnseen = decHasPosition\s*&&\s*decimatorFinalIsNews/,
    'an old global draw is not added to Pending for a player with no position');
  assert.match(resolutions,
    /const decWaiting = decHasPosition\s*&&\s*!decSeen/,
    'the transition state is also limited to participating players');
  assert.match(resolutions, /subscribe\('app\.daySync'/,
    'the Decimator takeover rechecks immediately at the day boundary');
  assert.match(resolutions, /const viewed = getViewedAddress\(\)/,
    'combined/read-only presentation still receives the global Decimator draw');
  assert.match(resolutions, /decWaiting[\s\S]*?state: this\.#busy === 'decimator' \|\| decWaiting \? 'busy' : 'ready'/,
    'a due Decimator holds the shared action while its indexed result catches up');
  assert.match(resolutions,
    /return openDecimatorDraw\(\{[\s\S]*?player: this\.#address,[\s\S]*?onReady:[\s\S]*?_markSeen\('decimator'/,
    'the draw is marked seen only after its bounded snapshot is staged');
  assert.doesNotMatch(resolutions, /autoOpen:\s*!willWrite/,
    'neither full-screen final is ever auto-opened, Auto open preference or not');
  assert.match(resolutions, /autoOpen:\s*false,[\s\S]{0,120}?primarySurface:\s*'jackpot'/,
    'the Decimator takeover waits for its own View draw click');
  assert.match(resolutions, /autoOpen:\s*false,\s*\n\s*order:\s*13,/,
    'the BAF ceremony waits for its own click too');
  assert.match(resolutions, /new CustomEvent\('decimator:opened'/,
    'opening the takeover re-arms the ordinary jackpot underneath it');
  assert.match(resolutions,
    /const bafUnseen = bafFinalIsNews\(\{[\s\S]*?participated: bafParticipated/,
    'a participating player keeps a late-indexed BAF receipt after the x10 boundary');
  assert.match(replay, /subscribePendingActions[\s\S]*?#setPrimaryDecimatorAction/);
  assert.match(replay, /'RUN DECIMATOR DRAW'/);
  assert.match(replay,
    /this\.#revealStateBeforeDecimator = null;[\s\S]{0,400}?this\.#syncSpinControlState\(\);/,
    'returning from Decimator recomputes the jackpot button instead of restoring stale processing');
  assert.doesNotMatch(tray, /item\?\.primarySurface !== 'jackpot'/,
    'Pending retains the Decimator as a fallback if its jackpot handoff is missed');
  assert.match(css, /\.decimator-draw-modal\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.decimator-draw-modal__close/,
    'the takeover has an explicit phone treatment');
  assert.match(overlay,
    /event\?\.source !== current\.frame\.contentWindow[\s\S]*?event\?\.origin !== window\.location\.origin/,
    'the iframe bridge accepts commands only from the active same-origin draw');
  assert.match(overlay,
    /message\.action === 'exit'[\s\S]*?removeActive\(\)/,
    'the completed draw can close its own app takeover');
  assert.match(overlay,
    /message\.action === 'sound'[\s\S]*?playDrawSound/,
    'iframe motion cues use the main app’s already-unlocked sound engine');
  assert.match(overlay,
    /openDecimatorDraw[\s\S]*?warmupSfx\(\)[\s\S]*?removeActive\(\)/,
    'manual draw launch warms WebAudio before the first asynchronous snapshot read');
  assert.match(overlay,
    /decimator-draw-modal__retry[\s\S]*?DRAW DATA UNAVAILABLE[\s\S]*?return Boolean\(active\?\.overlay === overlay/,
    'an RPC load failure stays in the fullscreen with a retry instead of becoming a failed action');
});

test('a due BAF opens its dedicated staged fullscreen final', () => {
  const resolutions = readFileSync(new URL('../app-jackpot-resolutions.js', import.meta.url), 'utf8');
  const overlay = readFileSync(new URL('../app-baf-resolution-overlay.js', import.meta.url), 'utf8');
  assert.match(resolutions, /import \{ openBafResolution \}/);
  assert.match(resolutions, /await openBafResolution\(\{[\s\S]*?level,[\s\S]*?player: this\.\#address/);
  assert.match(resolutions, /playerOutcome:\s*this\.\#baf/,
    'the final uses the freshly reconciled terminal player result');
  assert.match(resolutions,
    /fetchJSON\(`\/player\/\$\{addr\}\/baf\?level=\$\{encodedLevel\}`,[\s\S]{0,80}?force:\s*true/,
    'opening the final refreshes player outcome at the click boundary');
  assert.match(resolutions,
    /fetchJSON\(`\/player\/\$\{addr\}\/jackpot-history`,[\s\S]{0,80}?force:\s*true/,
    'opening the final refreshes late-indexed BAF awards at the click boundary');
  assert.match(resolutions, /history:\s*\{ wins: this\.\#history \}/,
    'the final receives the reconciled award history');
  assert.match(resolutions, /const revealConsolation = this\.\#bafConsolation/,
    'a claim-before-view keeps the consolation amount in the ceremony');
  assert.match(overlay, /ONE FLIP DECIDES THE WHOLE BAF/);
  assert.match(overlay, /YOUR WALLET ONLY/);
  assert.match(overlay, /FINAL-DAY WEIGHTED DRAW/);
});

test('the x4/x99 Decimator burn card is first and prominent inside Side Bets', () => {
  const source = readFileSync(new URL('../app-parimutuel-panel.js', import.meta.url), 'utf8');
  const cards = /<div class="pari-books">([\s\S]*?)<\/div>/.exec(source)?.[1] || '';
  assert.ok(cards.indexOf('data-bind="pari-decimator"') >= 0);
  assert.ok(cards.indexOf('data-bind="pari-decimator"') < cards.indexOf('data-bind="pari-growth"'));
  assert.match(source, /title\.textContent = 'DECIMATOR'/);
  assert.match(source, /burnPrompt\.textContent = 'BURN FLIP'/);

  // The x4/x99 window rule lives in decimator.js, not in the panel. The panel
  // imports it so the write path and the card agree on one predicate.
  const decimator = readFileSync(
    new URL('../../app/decimator.js', import.meta.url), 'utf8');
  assert.match(decimator,
    /return \(level % 10 === 4 && level % 100 !== 94\) \|\| level % 100 === 99/);
  assert.match(source,
    /import \{[\s\S]*?decimatorWindowIsOpen[\s\S]*?\} from '\.\.\/app\/decimator\.js'/,
    'the panel imports the window rule rather than reimplementing it');
  assert.doesNotMatch(source, /level % 10 === 4/,
    'no second copy of the level arithmetic in the panel');
});

// Reported from production: /player/:addr/decimator was the second-heaviest
// endpoint on a page load — 21 of 138 requests — for an event that happens once
// every ten levels. Two separate causes, both pinned here at the source level
// because the fetch paths are private to their components.
test('the Decimator position read is gated on the window being open', () => {
  const src = readFileSync(
    new URL('../app-parimutuel-panel.js', import.meta.url), 'utf8');
  const block = /const decimatorRead = [\s\S]{0,400}?Promise\.resolve\(null\);/.exec(src)?.[0] || '';
  assert.match(block, /decimatorWindowIsOpen\(this\.#gameState\)/,
    'the position read must carry the same gate as the context read below it');
  // level + 1 only names a real round during an x4/x99 burn window, so an
  // ungated read asks about a round that cannot exist.
  assert.match(block, /decimatorLevel != null/);
});

test('stable settled Decimator/BAF rounds are latched and not refetched', () => {
  const src = readFileSync(
    new URL('../app-jackpot-resolutions.js', import.meta.url), 'utf8');
  assert.match(src, /#settled = \{ dec: null, baf: null \}/,
    'a settled-round cache exists');
  assert.match(src, /this\.#settled\.dec\?\.level === decLevel/,
    'the cache is keyed on level, so a new round still reads fresh');
  assert.match(src, /\['closed', 'skipped'\]\.includes/,
    "only terminal statuses latch — an 'open' round keeps polling");
  assert.match(src,
    /const decChainWinner = \['ready', 'claimed'\]\.includes\(this\.\#decimatorClaimState\);[\s\S]{0,500}?if \(decTerminal && \([\s\S]{0,220}?hasDecimatorPosition\(this\.\#decimator\)/,
    'a bucket-less terminal snapshot is not frozen before chain winner evidence catches up');
  assert.match(src, /if \(nextAddress !== this\.#address\) this\.#settled =/,
    'switching accounts invalidates the latch');
});
