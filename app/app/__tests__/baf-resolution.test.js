import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  BAF_PRIZE_LANES,
  bafCutSurvivorRank,
  bafGateWon,
  buildBafResolutionSnapshot,
  normalizeBafPrizeHits,
  loadBafResolutionSnapshot,
  __setBafResolutionFetcherForTest,
  __resetBafResolutionFetcherForTest,
} = await import('../baf-resolution.js');
const { buildBafDrawAllocation } = await import('../baf-draw.js');

const FLIP = 10n ** 18n;
const PLAYER_1 = '0x1111111111111111111111111111111111111111';
const PLAYER_2 = '0x2222222222222222222222222222222222222222';
const PLAYER_3 = '0x3333333333333333333333333333333333333333';
const PLAYER_4 = '0x4444444444444444444444444444444444444444';
const LEADERS = { entries: [
  { level: 40, player: PLAYER_1, score: String(400n * FLIP), rank: 1 },
  { level: 40, player: PLAYER_2, score: String(300n * FLIP), rank: 2 },
  { level: 40, player: PLAYER_3, score: String(200n * FLIP), rank: 3 },
  { level: 40, player: PLAYER_4, score: String(100n * FLIP), rank: 4 },
] };

function model({ status = 'closed', player = PLAYER_4, rank = 4, history = [] } = {}) {
  return buildBafResolutionSnapshot({
    level: 40,
    player,
    metadata: {
      status,
      day: 9,
      // 1 is an odd gate word and EntropyLib.hash2(1, 1) selects rank 4.
      rngWord: status === 'closed' ? '1' : '2',
      estimatedPoolWei: status === 'closed' ? '1000' : null,
      awards: { ethCount: 3, ethUnique: 2, ethTotal: '50', ticketCount: 4, ticketUnique: 3, ticketEntries: '40' },
    },
    leaderboard: LEADERS,
    playerOutcome: {
      player, level: 40, score: String(100n * FLIP), rank,
      totalParticipants: 247, roundStatus: status,
    },
    history: { wins: history },
    draw: {
      entries: Array.from({ length: 10 }, (_, index) => ({
        day: 9,
        player: `0x${String(index + 16).padStart(40, '0')}`,
        score: String(100 - index),
        rank: index + 1,
      })),
      totalWeight: '1000',
      totalParticipants: 42,
      player: { day: 9, player, score: '20', rank: 12 },
    },
    consolation: status === 'skipped' ? 5n * FLIP : 0n,
  });
}

describe('BAF resolution model', () => {
  test('replays the gate and rank-3/4 cut from the exact contract entropy', () => {
    assert.equal(bafGateWon(1), true);
    assert.equal(bafGateWon(2), false);
    assert.equal(bafCutSurvivorRank(1), 4);
    assert.equal(bafCutSurvivorRank(5), 3);
  });

  test('maps every contract prize lane and keeps the shares at 100%', () => {
    assert.equal(BAF_PRIZE_LANES.reduce((sum, lane) => sum + lane.share, 0), 100);
    assert.deepEqual(BAF_PRIZE_LANES.map((lane) => lane.label), [
      'TOP SCORE', 'FINAL-DAY DRAW', 'CUT SURVIVOR', 'FUTURE DRAWS', 'SCATTER',
    ]);
  });

  test('the weighted draw keeps the top ten, the viewed player, and the remainder honest', () => {
    const snapshot = model();
    assert.equal(snapshot.draw.entries.length, 10);
    assert.deepEqual(snapshot.draw.player, {
      day: 9,
      player: PLAYER_4,
      score: '20',
      rank: 12,
    });
    const allocation = buildBafDrawAllocation(snapshot.draw, PLAYER_4);
    assert.equal(allocation.entries.filter((entry) => entry.kind === 'leader').length, 10);
    assert.equal(allocation.entries.find((entry) => entry.kind === 'player')?.isPlayer, true);
    assert.equal(allocation.entries.at(-1)?.kind, 'other');
    assert.equal(allocation.entries.at(-1)?.score, '25');
    assert.equal(allocation.entries.at(-1)?.endPpm, 1_000_000);
  });

  test('keeps player-only BAF prize hits, including future target-level tickets', () => {
    assert.deepEqual(normalizeBafPrizeHits([
      { level: 40, day: 9, awardType: 'eth_baf', amount: '25' },
      { level: 47, sourceLevel: 40, day: 9, awardType: 'tickets_baf', amount: '12' },
      { level: 0, day: 9, awardType: 'whale_pass_baf', amount: '2', halfPassCount: 2 },
      { level: 40, day: 9, awardType: 'eth', amount: '999' },
    ], 40, 9), [
      { kind: 'eth', amount: '25', count: 1 },
      { kind: 'tickets', amount: '3', entries: '12', count: 1, level: 47 },
      { kind: 'whale-pass', amount: '2', count: 1 },
    ]);
  });

  test('a seven-pass BAF row is a win and retains exact half-pass units', () => {
    const snapshot = model({
      player: '0x5555555555555555555555555555555555555555',
      rank: 20,
      history: [
        { level: 0, day: 9, awardType: 'whale_pass_baf', amount: '14', halfPassCount: 14 },
      ],
    });
    assert.equal(snapshot.player.whalePassHalves, '14');
    assert.equal(snapshot.player.wonAny, true);
    assert.deepEqual(snapshot.player.prizeHits, [
      { kind: 'whale-pass', amount: '14', count: 1 },
    ]);

    assert.deepEqual(normalizeBafPrizeHits([
      { level: 0, day: 9, awardType: 'whale_pass_baf', amount: '0', halfPassCount: 0 },
      { level: 0, day: 9, awardType: 'whale_pass_baf', amount: '1', halfPassCount: 1 },
      { level: 0, day: 9, awardType: 'whale_pass_baf', amount: '2', halfPassCount: 2 },
      { level: 0, day: 8, awardType: 'whale_pass_baf', amount: '14', halfPassCount: 14 },
    ], 40, 9), [
      { kind: 'whale-pass', amount: '1', count: 1 },
      { kind: 'whale-pass', amount: '2', count: 1 },
    ]);
  });

  test('rank four survives, rank three is killed, and the player payout is retained', () => {
    const snapshot = model({ history: [
      { level: 40, awardType: 'eth_baf', amount: '25' },
      { level: 40, awardType: 'tickets_baf', amount: '8' },
    ] });
    assert.equal(snapshot.gateWon, true);
    assert.equal(snapshot.survivorRank, 4);
    assert.equal(snapshot.eliminatedCutRank, 3);
    assert.equal(snapshot.player.leaderSlicePct, 5);
    assert.equal(snapshot.player.eth, '25');
    assert.equal(snapshot.player.tickets, '2');
    assert.equal(snapshot.player.wonAny, true);
    assert.equal(snapshot.awards.tickets, '10');
  });

  test('a skipped gate has no cut survivor and preserves consolation', () => {
    const snapshot = model({ status: 'skipped', player: '0xabc', rank: 12 });
    assert.equal(snapshot.gateWon, false);
    assert.equal(snapshot.survivorRank, null);
    assert.equal(snapshot.eliminatedCutRank, null);
    assert.equal(snapshot.player.wonAny, false);
    assert.equal(snapshot.player.consolation, String(5n * FLIP));
  });

  test('loader joins global metadata/top four with the exact player slice', async () => {
    const paths = [];
    __setBafResolutionFetcherForTest(async (path) => {
      paths.push(path);
      if (path.startsWith('/game/baf/')) return { status: 'closed', day: 9, rngWord: '1', awards: {} };
      if (path.startsWith('/leaderboards/coinflip')) return {
        entries: [], totalWeight: '1000', totalParticipants: 42,
        player: { day: 9, player: PLAYER_4, score: '20', rank: 12 },
      };
      if (path.startsWith('/leaderboards/')) return LEADERS;
      if (path.includes('/baf?')) return { player: PLAYER_4, level: 40, score: String(100n * FLIP), rank: 4, totalParticipants: 247, roundStatus: 'closed' };
      return { wins: [] };
    });
    try {
      const snapshot = await loadBafResolutionSnapshot({ level: 40, player: PLAYER_4 });
      assert.equal(snapshot.survivorRank, 4);
      assert.equal(snapshot.draw.player.score, '20');
      assert.deepEqual(paths, [
        '/game/baf/40/resolution',
        '/leaderboards/baf?level=40',
        `/player/${PLAYER_4}/baf?level=40`,
        `/player/${PLAYER_4}/jackpot-history`,
        `/leaderboards/coinflip?day=9&player=${PLAYER_4}`,
      ]);
    } finally {
      __resetBafResolutionFetcherForTest();
    }
  });

  test('a missing metadata route still opens an honest final from the notification data', async () => {
    const paths = [];
    __setBafResolutionFetcherForTest(async (path) => {
      paths.push(path);
      if (path.startsWith('/game/baf/')) throw new Error('404: route not deployed');
      if (path.startsWith('/leaderboards/')) return LEADERS;
      throw new Error(`unexpected duplicate read: ${path}`);
    });
    try {
      const snapshot = await loadBafResolutionSnapshot({
        level: 40,
        player: PLAYER_4,
        playerOutcome: {
          player: PLAYER_4,
          level: 40,
          score: String(100n * FLIP),
          rank: 4,
          totalParticipants: 247,
          roundStatus: 'closed',
        },
        history: { wins: [{ level: 40, awardType: 'eth_baf', amount: '25' }] },
      });
      assert.equal(snapshot.gateWon, true);
      assert.equal(snapshot.cutKnown, false);
      assert.equal(snapshot.survivorRank, null);
      assert.equal(snapshot.eliminatedCutRank, null);
      assert.equal(snapshot.resolutionDetailsAvailable, false);
      assert.equal(snapshot.player.eth, '25');
      assert.equal(snapshot.player.wonAny, true);
      assert.equal(snapshot.topFour.length, 4);
      assert.deepEqual(paths, [
        '/game/baf/40/resolution',
        '/leaderboards/baf?level=40',
      ]);
    } finally {
      __resetBafResolutionFetcherForTest();
    }
  });
});

describe('BAF fullscreen presentation', () => {
  const overlay = readFileSync(new URL('../../components/app-baf-resolution-overlay.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../styles/baf-resolution.css', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../../components/app-jackpot-resolutions.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const demo = readFileSync(new URL('../../baf-resolution-demo.js', import.meta.url), 'utf8');

  test('runs a large dedicated coin before wallet results and the final-day wheel', () => {
    assert.match(overlay, /data-stage="coin"/);
    assert.match(overlay, /shell\.dataset\.stage = 'coin-flip'/);
    assert.match(overlay, /shell\.dataset\.stage = 'results'/);
    assert.match(overlay, /shell\.dataset\.stage = snapshot\.gateWon \? 'wheel' : 'wheel-loss'/);
    assert.match(overlay, /shell\.dataset\.stage = 'complete'/);
    assert.match(overlay, /appendCoinFaces\(rotor/,
      'the ceremony uses the same compositor-safe normal daily coin faces');
    assert.match(css, /\.baf-res__coin-scene\s*\{[^}]*clamp\(16rem, 36vmin, 24rem\)/s,
      'the BAF coin, rather than a dashboard of global standings, owns the stage');
    assert.match(css, /@keyframes baf-res-flip-win/);
    assert.match(css, /@keyframes baf-res-flip-loss/);
    assert.match(overlay, /BAF LOSS/);
    assert.doesNotMatch(overlay, /TOP FOUR|PRIZE MAP/,
      'global leaderboard and prize-map clutter no longer compete with the player reveal');
    assert.match(css, /\.baf-res__payout\.is-loss/);
  });

  test('shows only this wallet’s prize-bearing draw results', () => {
    assert.match(overlay, /snapshot\.player\.prizeHits/);
    assert.match(overlay, /YOUR WALLET ONLY/);
    assert.match(overlay, /Only this wallet’s prize-bearing ticket draws and direct BAF awards are shown/);
    assert.match(overlay, /NO PRIZE LANDED ON YOUR TICKETS/);
    assert.match(overlay, /LEVEL \$\{hit\.level\} TICKET PAYOUT/);
    assert.match(css, /\.baf-res__result-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/s);
    assert.match(css, /\.baf-res__result-card\[data-kind="tickets"\]/);
  });

  test('replaces the generic BAF receipt and retains a live review page', () => {
    assert.match(controller, /await openBafResolution\(/);
    assert.doesNotMatch(controller, /queueReveal\(\{ kind: 'resolution'/);
    assert.match(index, /href="\/app\/styles\/baf-resolution\.css"/);
    assert.match(demo, /player = winner \? PLAYERS\[3\]/);
    assert.match(demo, /status: skipped \? 'skipped' : 'closed'/);
    assert.match(demo, /history: winner \? \{ wins:/);
  });

  test('parks the normal coinflip during fetch, then mounts with explicit close controls', () => {
    const hold = overlay.indexOf("document.body.classList.add('baf-resolution-pending')");
    const load = overlay.indexOf('resolved = snapshot || await loadBafResolutionSnapshot');
    const create = overlay.indexOf("const overlay = document.createElement('section')");
    const lock = overlay.indexOf("document.body.classList.add('baf-resolution-open')");
    assert.ok(hold >= 0 && hold < load && load < create && create < lock,
      'the ordinary coin is held before the fetch while the fullscreen still mounts only when ready');
    assert.match(overlay, /classList\.remove\('baf-resolution-pending'\)/);
    assert.match(overlay, /classList\?\.remove\('baf-resolution-open'\)/,
      'teardown repairs a stale scroll lock even when the overlay record is gone');
    assert.match(css, /body\.layout-basic\.baf-resolution-pending \.df-coin--spinning \.df-coin3d__inner\s*\{[^}]*animation:\s*none !important/s);
    assert.match(css, /body\.layout-basic\.baf-resolution-pending \.df-coin--spinning\s*\{[^}]*pointer-events:\s*none/s);
    assert.match(overlay, /data-bind="baf-close"/);
    assert.match(overlay, /focus\(\{ preventScroll: true \}\)/,
      'mobile completion focus does not push the final result out of view');
    assert.match(overlay, /baf-res__mark[^>]*><b>BAF<\/b><small>×10<\/small>/);
    assert.match(css, /\.baf-res__pool strong\s*\{[^}]*clamp\(1\.05rem/s);
  });

  test('finishes with a short honest spin of the final-day weighted pie', () => {
    assert.match(overlay, /buildBafDrawAllocation\(draw, snapshot\.player\.address\)/);
    assert.match(overlay, /data-bind="baf-draw-pie"/);
    assert.match(overlay, /data-bind="baf-draw-player-percent"/);
    assert.match(overlay, /label: 'YOU'/);
    assert.match(overlay, /label: 'EVERYONE ELSE'/);
    assert.match(overlay, /if \(snapshot\.gateWon\) \{[\s\S]*wheel\?\.classList\.add\('is-spinning'\)/s,
      'a losing gate never animates a weighted draw that did not occur');
    assert.match(css, /\.baf-res__draw-ticks\s*\{[^}]*repeating-conic-gradient/s);
    assert.match(css, /\.baf-res__draw-pie\s*\{[^}]*var\(--baf-draw-pie/s);
    assert.match(css, /\.baf-res__draw-wheel\.is-spinning \.baf-res__draw-pie\s*\{[^}]*animation:\s*baf-res-wheel-spin/s);
    assert.match(css, /@keyframes baf-res-wheel-spin/);
    assert.match(css, /data-stage="wheel"[\s\S]*data-stage="wheel-loss"[\s\S]*data-stage="complete"[\s\S]*\.baf-res__weighted/s,
      'the wheel is the final scene rather than a permanent dashboard panel');
  });
});
