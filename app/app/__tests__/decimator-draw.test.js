import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BUCKET_MIN_DEGEN_SCORE,
  DRAW_ORDER,
  buildDrawFrames,
  buildFullDemoSnapshot,
  buildWinnerAllocation,
  formatDecimatorSettlement,
  formatEth,
  formatScore,
  loadKnownWinnerNames,
  minDegenScoreForBucket,
  exitDecimatorDraw,
  playDecimatorDrawSound,
  playerResult,
  playerSubbucketShareBps,
  playerSubbucketScore,
  possibleBuckets,
  projectedPlayerPayout,
  sumWinningScore,
  totalFlipBurned,
} from '../../../decimator-draw/draw.js';

const snapshot = JSON.parse(readFileSync(
  new URL('../../../decimator-draw/last-decimator.json', import.meta.url),
  'utf8',
));
const html = readFileSync(
  new URL('../../../decimator-draw/index.html', import.meta.url),
  'utf8',
);
const css = readFileSync(
  new URL('../../../decimator-draw/draw.css', import.meta.url),
  'utf8',
);
const drawSource = readFileSync(
  new URL('../../../decimator-draw/draw.js', import.meta.url),
  'utf8',
);

describe('standalone Decimator draw replay', () => {
  test('replays only populated buckets and keeps an ordered winner lane', () => {
    const frames = buildDrawFrames(snapshot);
    assert.deepEqual(possibleBuckets(snapshot), [11, 10, 9, 8, 7, 6]);
    assert.deepEqual(frames.map((frame) => frame.bucket), [11, 10, 9, 8, 7, 6]);
    assert.deepEqual(frames.map((frame) => frame.activeSlots.length), [11, 10, 9, 8, 7, 6]);
    assert.deepEqual(frames.map((frame) => frame.lockPhysical), [0, 1, 2, 3, 4, 5],
      'each selected subbucket slides into the next top lock position');
    assert.ok(frames.every((frame) => frame.slotCount === 12));
    assert.deepEqual(DRAW_ORDER, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
      'the full protocol denominator order remains available for other rounds');
  });

  test('uses the protocol minimum Degen Rating ladder and one-decimal K ratings', () => {
    assert.deepEqual(
      [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map(minDegenScoreForBucket),
      [0, 10, 30, 55, 85, 120, 180, 250, 300, 500, 1_000],
    );
    assert.equal(BUCKET_MIN_DEGEN_SCORE[7], 120);
    assert.equal(formatScore(79_933_535n * 10n ** 15n), '79.9K');
    assert.equal(formatScore(173_448_799n * 10n ** 15n), '173.4K');
  });

  test('uses the exact indexed winning subbuckets and reconciles the winning score', () => {
    const frames = buildDrawFrames(snapshot);
    for (const frame of frames) {
      assert.equal(frame.winningSubbucket, snapshot.winningSubbuckets[String(frame.bucket)]);
    }
    assert.deepEqual(
      frames.map((frame) => frame.winningScore),
      [0n, 0n, 0n, 0n, BigInt(snapshot.winningScore), 0n],
      'the archived draw really selected five empty subbuckets and one scored winner',
    );
    assert.equal(sumWinningScore(frames), BigInt(snapshot.winningScore));
    assert.match(drawSource, /this\.runningTotal \+= frame\.winningScore/,
      'the visible running score adds every selected subbucket total');
  });

  test('shows the prize pool and computes the live player payout with the contract denominator', () => {
    const player = snapshot.players.find((entry) => entry.address === snapshot.defaultPlayer);
    const frames = buildDrawFrames(snapshot);
    assert.equal(formatEth(snapshot.poolWei, snapshot.ethDisplayScale, 2), '211.41');
    assert.equal(playerSubbucketScore(snapshot, player), BigInt(snapshot.winningScore));
    const opening = projectedPlayerPayout(snapshot, player, 0n, []);
    assert.equal(opening, 97_430_912_351_752n);
    const final = projectedPlayerPayout(snapshot, player, sumWinningScore(frames), frames);
    assert.equal(final, opening, 'the archived later winners are empty, so this exact payout holds');
    const losingPlayer = snapshot.players.find((entry) => (
      playerResult(snapshot, entry)?.won === false
    ));
    assert.equal(
      projectedPlayerPayout(snapshot, losingPlayer, 0n, [{ bucket: losingPlayer.bucket }]),
      0n,
      'a resolved losing slice immediately drops its hypothetical payout to zero',
    );
  });

  test('keeps the replay in ETH, then itemizes only the player final settlement', () => {
    const small = formatDecimatorSettlement(8n * 10n ** 18n);
    assert.equal(small.claimableLabel, '4 ETH');
    assert.equal(small.rewardLabel, '4 ETH LUCKBOX');
    const large = formatDecimatorSettlement(13n * 10n ** 18n);
    assert.equal(large.claimableLabel, '6.5 ETH');
    assert.equal(large.rewardLabel, '2 WHALE HALF-PASSES + 2 ETH LUCKBOX');
    assert.match(html, /data-bind="player-payout-settlement" hidden/);
    assert.match(drawSource,
      /this\.completed\.length === this\.frames\.length && result\?\.won[\s\S]*this\.\#renderSettlement\(value\)/,
      'the component does not expose the settlement split before the final winning state');
    assert.match(css, /\.score-payout__settlement\[hidden\]\s*\{\s*display:\s*none/);
  });

  test('separates raw FLIP destroyed from effective burn and measures the player share', () => {
    const player = snapshot.players.find((entry) => entry.address === snapshot.defaultPlayer);
    assert.equal(totalFlipBurned(snapshot), 2_844_677_691_809_469_226_345_514n,
      'the hub uses raw FLIP.DecimatorBurn amounts from the archived level-15 run');
    assert.equal(formatScore(totalFlipBurned(snapshot)), '2,844.7K');
    assert.equal(playerSubbucketShareBps(snapshot, player), 4_608,
      'the selected player owns 46.08% of their aggregate winning subbucket');
    assert.match(drawSource, /const playerArc = available \* ratio/,
      'the mint ownership marker is a true angular pie slice of its subbucket');
    assert.match(drawSource, /center - \(playerArc \/ 2\)[\s\S]*center \+ \(playerArc \/ 2\)/,
      'the player slice stays centered inside the aggregate winning pool');
  });

  test('final allocation identifies the top ten, an outside player, and an honest remainder', () => {
    const winnerPlayers = Array.from({ length: 12 }, (_value, index) => ({
      address: `0x${String(index + 1).padStart(40, '0')}`,
      bucket: 7,
      subbucket: 2,
      score: String(BigInt(12 - index) * 10n ** 18n),
    }));
    const winningScore = winnerPlayers.reduce((sum, row) => sum + BigInt(row.score), 0n);
    const player = winnerPlayers[11];
    const allocation = buildWinnerAllocation({
      winningSubbuckets: { 7: 2 },
      winningScore: winningScore.toString(),
      poolWei: (78n * 10n ** 18n).toString(),
      winnerPlayers,
      players: [player],
    }, player.address);

    assert.equal(allocation.winnerCount, 12);
    assert.deepEqual(
      allocation.entries.filter((entry) => entry.kind === 'winner').slice(0, 10).map((entry) => entry.rank),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.equal(allocation.entries.find((entry) => entry.isPlayer)?.rank, 12);
    assert.ok(allocation.entries.some((entry) => entry.kind === 'other'),
      'rank 11 remains represented in the complete pie');
    assert.equal(
      allocation.entries.reduce((sum, entry) => sum + BigInt(entry.score), 0n),
      winningScore,
    );
  });

  test('known Discord identities are optional and keyed by wallet address', async () => {
    const names = await loadKnownWinnerNames({
      fetcher: async () => ({
        ok: true,
        async json() {
          return { leaderboard: [{
            eth_address: '0x00000000000000000000000000000000000000A1',
            discord_name: 'Burnie',
          }] };
        },
      }),
    });
    assert.equal(names.get('0x00000000000000000000000000000000000000a1'), 'Burnie');
  });

  test('offers a clearly synthetic full-data art preview without touching the real fixture', () => {
    const demo = buildFullDemoSnapshot(snapshot);
    const frames = buildDrawFrames(demo);
    const allocation = buildWinnerAllocation(demo, demo.defaultPlayer);
    assert.equal(demo.isDemo, true);
    assert.equal(demo.network, 'FULL DATA ART PREVIEW');
    assert.deepEqual(possibleBuckets(demo), DRAW_ORDER);
    assert.equal(demo.subbucketTotals.length, 77, 'all subbuckets in all eleven denominators are populated');
    assert.ok(demo.subbucketTotals.every((entry) => BigInt(entry.score) > 0n));
    assert.equal(demo.winnerPlayers.length, 27, 'the payout pie has a genuinely dense winner set');
    assert.equal(sumWinningScore(frames), BigInt(demo.winningScore));
    assert.equal(
      allocation.entries.reduce((total, entry) => total + BigInt(entry.score), 0n),
      BigInt(demo.winningScore),
    );
    assert.equal(allocation.entries.find((entry) => entry.isPlayer)?.rank, 8);
    assert.equal(demo.winnerNames[demo.defaultPlayer.toLowerCase()], 'PinkSlip');
    assert.equal(snapshot.isDemo, undefined, 'the archived level-15 snapshot remains authoritative and unchanged');
  });

  test('snapshot player scores reconcile with every populated subbucket total', () => {
    const playerTotals = new Map();
    for (const player of snapshot.players) {
      const key = `${player.bucket}:${player.subbucket}`;
      playerTotals.set(key, (playerTotals.get(key) || 0n) + BigInt(player.score));
    }
    for (const total of snapshot.subbucketTotals) {
      assert.equal(
        playerTotals.get(`${total.bucket}:${total.subbucket}`) || 0n,
        BigInt(total.score),
      );
    }
  });

  test('the viewed player exists in only one bucket/subbucket and resolves there', () => {
    const player = snapshot.players.find((entry) => entry.address === snapshot.defaultPlayer);
    assert.ok(player);
    assert.deepEqual(
      { bucket: player.bucket, subbucket: player.subbucket },
      { bucket: 7, subbucket: 2 },
    );
    assert.deepEqual(playerResult(snapshot, player), {
      ...player,
      won: true,
      winningSubbucket: 2,
    });
  });

  test('fixture is the indexed level-15 Decimator from run 28', () => {
    assert.equal(snapshot.run, 28);
    assert.equal(snapshot.level, 15);
    assert.equal(snapshot.resolvedBlock, 45_103_921);
    assert.equal(snapshot.gameAddress, '0x9f6f2d323982001f9034ed11eb14c83a6a323f53');
    assert.equal(snapshot.players.length, 88);
  });

  test('page includes the complete top bucket rail, player score, and replay controls', () => {
    assert.match(html, /MIN DEGEN RATING:/);
    assert.match(html, /WINNING SCORE/);
    assert.match(html, /TOTAL FLIP BURNED/);
    assert.match(html, /YOUR SCORE/);
    assert.doesNotMatch(html, /EFFECTIVE BURN|TOTAL WEIGHT|YOUR WEIGHT/);
    assert.match(html, /data-bind="prize-pool"/);
    assert.match(html, /data-bind="hub-flip-label"/);
    assert.match(html, /data-bind="hub-flip-value"/);
    assert.match(html, /IF YOUR SLICE HITS/);
    assert.match(html, /data-bind="bucket-rail"/);
    assert.match(html, /data-bind="winning-score"/);
    assert.match(html, /data-bind="winner-pie"/);
    assert.match(html, /data-bind="round-context"/);
    assert.match(html, /class="wheel-brand-marks"/);
    assert.match(html, /\/whitepaper\/flame-logo\.svg/,
      'the draw uses the red Degenerus protocol mark rather than a generic wheel badge');
    assert.match(html, /FINAL PRIZE PIE/);
    assert.match(html, /data-bind="player-score"/);
    assert.match(html, /data-bind="player-payout-label"/);
    assert.doesNotMatch(html, /LOCKED WINNERS/,
      'the redundant lower winner feed is removed');
    assert.doesNotMatch(html, />DECIMATOR<\/text>/,
      'the hub uses its lower half for the raw burn total instead of a logo caption');
    assert.doesNotMatch(html, /class="wheel-flame/,
      'the center flame no longer competes with the prize and burn numbers');
    assert.match(drawSource, /label\.textContent = 'YOUR LIVE PAYOUT'/,
      'a locked player slice stops being described as hypothetical immediately');
    assert.match(drawSource, /this\.#resetView\(\);\s*this\.#showHubWinning\(0n\)/,
      'the hub switches from raw burn to a zeroed winning total as the draw starts');
    assert.match(drawSource, /hub-flip-label'\)\.textContent = 'TOTAL WINNING SCORE'/,
      'the active and completed draw identify the accumulated winning score');
    assert.match(drawSource, /hub-flip-unit'\)\.textContent = 'SCORE'/,
      'the dynamic hub unit follows the score label');
    assert.match(drawSource, /hubOutput\.textContent = formatted/,
      'the hub winning total counts upward with the side-board score');
    assert.match(html, /START DRAW/,
      'opening the fullscreen parks on a ready wheel until the player clicks');
    assert.match(html, /SKIP TO RESULTS/);
    assert.match(drawSource,
      /this\.\#setPrimaryAction\('start'\);[\s\S]*?this\.bind\('replay'\)\?\.focus\(\)/,
      'the loaded draw focuses its explicit start control instead of auto-running');
    assert.doesNotMatch(drawSource,
      /await sleep\(this\.reducedMotion \? 50 : 550\);\s*this\.play\(\)/,
      'initialization has no delayed automatic play path');
    assert.match(drawSource,
      /this\.bind\('replay'\)\.addEventListener\('click',[\s\S]*?this\.play\(\)/,
      'the primary click is what starts the wheel');
    assert.doesNotMatch(html, /class="round-proof"/,
      'the redundant bottom block/pool strip is removed');
    assert.doesNotMatch(drawSource, /svg\('tspan', 'wheel-label__sub'\)/,
      'the S-number captions are removed from the wheel');
  });

  test('bucket and wheel states expose current, losing, and ordered winning treatments', () => {
    assert.match(css, /\.bucket-token\.is-current\s*\{[^}]*outline:\s*2px solid var\(--gold\)/s);
    assert.match(css, /\.bucket-token\.is-player\s*\{[^}]*--green|\.bucket-token\.is-player\s*\{[^}]*rgba\(55, 229, 138/s);
    assert.match(css, /\.bucket-token\.is-complete\s*\{[^}]*color:\s*#575d69/s);
    assert.match(css, /\.wheel-segment\.is-active\s*\{[^}]*fill:\s*url\(#live-gold-a\)/s,
      'every live slice uses the dimensional yellow treatment');
    assert.match(css, /\.wheel-segment\.is-current\s*\{[^}]*fill:\s*url\(#live-gold-hot\)/s,
      'the subbucket under the moving needle is the brighter yellow');
    assert.match(css, /\.wheel-player-share\s*\{[^}]*fill:\s*url\(#player-share-fill\)/s,
      'only the player-owned portion of their aggregate subbucket is mint colored');
    assert.match(drawSource, /svg\('rect', 'wheel-label__player-badge'\)/,
      'the ownership percentage gets a dedicated high-contrast badge');
    assert.match(drawSource, /if \(isPlayer\) \{[\s\S]*?svg\('g', 'wheel-label__player'\)/,
      'the YOU percentage disappears instead of moving into the locked-winner lane');
    assert.match(drawSource, /winnerLabel\?\.remove\(\)/,
      'the moving slice drops its score label and rebuilds it only after settling');
    assert.match(drawSource, /const moving = \[winnerPath, winnerShare, winnerSheen\]/,
      'score text never rotates through the lock-lane travel animation');
    assert.match(css, /\.wheel-label__player-value\s*\{[^}]*font-size:\s*17px[^}]*fill:\s*#fff|\.wheel-label__player-value\s*\{[^}]*fill:\s*#fff[^}]*font-size:\s*17px/s,
      'the percentage remains large and white against the badge');
    assert.doesNotMatch(css, /\.wheel-segment\.is-player\s*\{[^}]*fill:\s*url\(#winner-green\)/s,
      'the whole player subbucket is no longer falsely colored as player-owned');
    assert.match(css, /\.wheel-segment\.is-locked-winner\s*\{[^}]*fill:\s*url\(#winner-green\)/s,
      'completed picks stay green in the ordered lock lane');
    assert.match(css, /@keyframes loser-flash\s*\{[^}]*fill:\s*#ff334b/s,
      'unselected subbuckets flash red before replacement');
    assert.match(css, /--bucket-count/, 'the top rail sizes itself to possible buckets only');
    assert.match(drawSource, /locked\.winningScore === 0n \? 'EMPTY'/,
      'a selected empty subbucket is explicit instead of looking like missing score data');
    assert.match(css, /@media \(max-width: 960px\)[\s\S]*?\.score-board\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/,
      'payout, player score, and winning score form one organized stats row');
    assert.match(css, /@media \(max-width: 520px\)/);
    assert.match(css, /\.winner-pie__merge\s*\{[^}]*stroke-dasharray:\s*100/s,
      'locked pools expand into one complete annulus before the payout split');
    assert.match(css, /\.winner-pie__slice\.is-player\s*\{[^}]*stroke:\s*#d9fff5/s,
      'the viewed winner remains unmistakable in the final pie');
    assert.match(css, /\.winner-pie__label-plate\s*\{/,
      'large payout labels use branded dark protocol plates');
    assert.match(drawSource, /amount\.textContent = this\.#winnerPayoutLabel\(entry\.payoutWei\)/,
      'final pie slices label the actual ETH payout instead of a percentage');
    assert.match(drawSource, /winner-pie-fill-\$\{this\.runToken\}-\$\{index\}/,
      'winner slices use dimensional badge-color gradients rather than flat fills');
    assert.doesNotMatch(drawSource, /percent\.textContent = formatSharePercent\(entry\.shareBps\)/,
      'the final winner list does not restate pie percentages');
    assert.match(css, /\.winner-legend__row\.is-player/);
    assert.match(css, /body\.is-embedded/,
      'the full-screen app takeover has a dedicated compact layout');
    assert.match(drawSource, /sessionStorage\.getItem\(storageKey\)/,
      'the embedded wheel consumes the exact snapshot staged by the app');
  });

  test('draw motion has shared audio cues and the completed secondary action exits', () => {
    assert.match(drawSource, /playDecimatorDrawSound\('spin', duration\)/,
      'each score-group sweep starts an anticipation cue');
    assert.match(drawSource,
      /if \(physical !== soundedPhysical\) \{[\s\S]*?playDecimatorDrawSound\('tick', tickIndex\)/,
      'the selector emits one tick only when it crosses into another physical slice');
    assert.match(drawSource, /playDecimatorDrawSound\('lock', frame\.winningScore > 0n\)/,
      'each authoritative locked slice gets a scored or empty lock cue');
    assert.match(drawSource,
      /playDecimatorDrawSound\('complete', result\?\.won === true, this\.runningTotal > 0n\)/,
      'the finale distinguishes a viewed-player win and an all-empty draw');
    assert.match(drawSource,
      /await this\.#showFinalAllocation\(token, \{ fast \}\);[\s\S]*?this\.#setSecondaryAction\('exit'\)/,
      'Exit replaces the skip action only after the final payout view is ready');
    assert.match(drawSource,
      /dataset\.action === 'exit'[\s\S]*?exitDecimatorDraw\(\)/,
      'the same secondary control closes the completed replay');
    assert.match(css, /\.draw-button--exit\s*\{[^}]*#17653e[^}]*#0a3824/s,
      'the final exit state is visibly distinct from Skip and Replay');
  });

  test('the moving wheel avoids full SVG scans and whole-wheel re-rasterization', () => {
    assert.match(drawSource, /this\.selectionElements = new Map\(\)/,
      'active slice nodes are cached when each wheel frame is built');
    assert.match(drawSource,
      /if \(physical === this\.currentPhysical\) return;[\s\S]*?this\.selectionElements\.get\(this\.currentPhysical\)[\s\S]*?this\.selectionElements\.get\(physical\)/,
      'a selector tick only updates the previous and next physical slice');
    assert.doesNotMatch(drawSource, /querySelectorAll\('\[data-physical\]'\)/,
      'the animation frame loop never scans all four SVG layers');
    assert.match(css,
      /\.wheel-wrap:is\(\.is-drawing, \.is-locking, \.is-finalizing\) \.draw-wheel\s*\{\s*filter:\s*none;/,
      'the full SVG drop shadow cannot trigger a complete wheel repaint while pieces move');
    assert.match(drawSource,
      /wrap\.classList\.add\('is-combining', 'is-finalizing'\)[\s\S]*?wrap\.classList\.remove\('is-finalizing'\)/,
      'the final payout animation restores the static wheel shadow only after movement ends');
  });

  test('embedded sound and exit requests cross the same-origin parent bridge', () => {
    const previousWindow = globalThis.window;
    const messages = [];
    const parent = {
      postMessage(message, origin) { messages.push({ message, origin }); },
    };
    globalThis.window = {
      parent,
      location: { search: '?embed=1', origin: 'https://game.test' },
    };
    try {
      assert.equal(playDecimatorDrawSound('lock', true), true);
      assert.equal(exitDecimatorDraw(), true);
      assert.deepEqual(messages, [
        {
          message: {
            type: 'degenerus:decimator-draw', action: 'sound', cue: 'lock', args: [true],
          },
          origin: 'https://game.test',
        },
        {
          message: { type: 'degenerus:decimator-draw', action: 'exit' },
          origin: 'https://game.test',
        },
      ]);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  test('embedded fullscreen draw fits its controls and expands the important results', () => {
    assert.match(css, /@media \(min-width: 961px\) and \(min-height: 650px\)[\s\S]*?body\.is-embedded\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/s,
      'desktop takeover owns one viewport instead of creating a clipped page');
    assert.match(css, /body\.is-embedded \.draw-shell\s*\{[^}]*height:\s*100dvh[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/s,
      'header, score-group rail, and draw stage share the viewport explicitly');
    assert.match(css, /body\.is-embedded \.wheel-column\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/s,
      'draw status, wheel, and replay controls all retain visible rows');
    assert.match(css, /body\.is-embedded \.wheel-wrap\s*\{[^}]*calc\(100dvh - 15\.75rem\)[^}]*46rem/s,
      'the wheel grows with the viewport while reserving room for its controls');
    assert.match(css, /\.score-board:not\(\.has-winner-allocation\)\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/s,
      'live payout, player score, and winning score use the full result rail');
    assert.match(css, /\.score-board\.has-winner-allocation > \.score-player,[\s\S]*?\.score-effective\s*\{\s*display:\s*none/s,
      'the final view removes only the two superseded score cards');
    assert.doesNotMatch(css, /has-winner-allocation > :not\(\.winner-allocation\)/,
      'the player payout remains visible beside the final allocation');
    assert.match(css, /\.winner-legend__row\s*\{[^}]*min-height:\s*2\.85rem/s,
      'winner identities and payouts are no longer packed into tiny rows');
  });
});
