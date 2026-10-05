import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  BAF_PRIZE_LANES,
  bafCutSurvivorRank,
  bafGateWon,
  buildBafResolutionSnapshot,
  normalizeBafPrizeHits,
  normalizeBafComparisons,
  normalizeBafTopFour,
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

  test('the vault cannot occupy a ranked prize in the resolution', async () => {
    const { CONTRACTS } = await import('../chain-config.js');
    const entries = [
      { level: 40, player: CONTRACTS.VAULT.toUpperCase(), rank: 1, score: '999999' },
      ...LEADERS.entries.map((row) => ({ ...row, rank: row.rank + 1 })),
    ];
    assert.deepEqual(normalizeBafTopFour({ entries }, 40), LEADERS.entries.map(({ rank, player, score }) => ({ rank, player, score })));
    const snapshot = buildBafResolutionSnapshot({
      level: 40, player: CONTRACTS.VAULT,
      metadata: { status: 'closed', rngWord: '1' },
      leaderboard: { entries }, playerOutcome: { rank: 1, score: '999999' },
    });
    assert.equal(snapshot.player.rank, null);
    assert.equal(snapshot.player.leaderSlicePct, 0);
    const eligibleWinner = buildBafResolutionSnapshot({
      level: 40, player: PLAYER_1,
      metadata: { status: 'closed', rngWord: '1' },
      leaderboard: { entries }, playerOutcome: { rank: 2, score: '400' },
    });
    assert.equal(eligibleWinner.player.rank, 1);
    assert.equal(eligibleWinner.player.leaderSlicePct, 10);
  });

  test('maps every contract prize lane and keeps the shares at 100%', () => {
    assert.equal(BAF_PRIZE_LANES.reduce((sum, lane) => sum + lane.share, 0), 100);
    assert.deepEqual(BAF_PRIZE_LANES.map((lane) => lane.label), [
      // Audit 26ad5863 removed the two far-future draws; the scatter took their 10%.
      'TOP SCORE', 'FINAL-DAY DRAW', 'CUT SURVIVOR', 'SCATTER',
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

  test('keeps the leaderboard, click-to-flip gate, and player comparisons on one board', () => {
    assert.match(overlay, /data-bind="baf-flip"/);
    assert.match(overlay, /TOP FOUR/);
    assert.match(overlay, /YOUR DRAWING TABLE/);
    assert.match(overlay, /data-bind="baf-cut-coin"/);
    assert.match(overlay, /dice_02_3_blue/);
    assert.match(overlay, /dice_03_4_purple/);
    assert.match(overlay, /appendCoinFaces\(rotor/);
    assert.match(overlay, /BAF LOSS/);
    assert.doesNotMatch(overlay, /gate\.hidden = true|playerResults\.hidden = true/);
  });

  test('uses explicit comparison groups and keeps recorded payouts when slates are unavailable', () => {
    assert.match(overlay, /snapshot\.comparisons/);
    assert.match(overlay, /snapshot\.player\.prizeHits/);
    assert.match(overlay, /Four-player comparison details are not available/);
    assert.match(overlay, /NO COMPARISONS THIS ROUND/);
    assert.match(css, /overflow-y: auto/);
    assert.doesNotMatch(overlay, /hits\.slice\(0, 6\)/, 'no prize receipts disappear beyond six');
  });

  test('replaces the generic BAF receipt and retains a live review page', () => {
    assert.match(controller, /await openBafResolution\(/);
    assert.doesNotMatch(controller, /queueReveal\(\{ kind: 'resolution'/);
    assert.match(index, /href="\/app\/styles\/baf-resolution\.css"/);
    assert.match(demo, /player = winner \? PLAYERS\[3\]/);
    assert.match(demo, /status: skipped \? 'skipped' : 'closed'/);
    assert.match(demo, /history: winner \? \{ wins \}/);
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

  test('retains the final-day odds without running a draw on a losing gate', () => {
    assert.match(overlay, /buildBafDrawAllocation\(draw, snapshot\.player\.address\)/);
    assert.match(overlay, /data-bind="baf-draw-player-percent"/);
    assert.match(overlay, /label: 'YOU'/);
    assert.match(overlay, /label: 'EVERYONE ELSE'/);
    assert.match(overlay, /if \(snapshot\.gateWon\) \{[\s\S]*wheel\?\.classList\.add\('is-spinning'\)/s);
    assert.match(css, /@keyframes baf-res-wheel-spin/);
  });
});

const slate = (own = PLAYER_4) => ({
  id: 'round-7', round: 7,
  players: [
    { player: own, score: String(10n * FLIP), prizes: [] },
    { player: PLAYER_2, score: String(30n * FLIP), prizes: [{ kind: 'tickets', amount: '12', level: 47 }] },
    { player: PLAYER_1, score: String(40n * FLIP), prizes: [{ kind: 'eth', amount: '900' }] },
    { player: PLAYER_3, score: String(20n * FLIP), prizes: [] },
  ],
});

describe('BAF four-player comparisons', () => {
  test('ranks exact scores and retains the viewed player even when their draw loses', () => {
    const groups = normalizeBafComparisons([slate()], PLAYER_4.toUpperCase());
    assert.deepEqual(groups[0].players.map((row) => row.player), [PLAYER_1, PLAYER_2, PLAYER_3, PLAYER_4]);
    assert.equal(groups[0].players[3].isPlayer, true);
    assert.deepEqual(groups[0].players[3].prizes, []);
    assert.deepEqual(groups[0].players[1].prizes, [{ kind: 'tickets', amount: '12', level: 47 }]);
  });

  test('filters other wallets and incomplete groups without inventing missing opponents', () => {
    const unrelated = slate('0x5555555555555555555555555555555555555555');
    const incomplete = { ...slate(), players: slate().players.slice(1) };
    const unknownScore = slate();
    delete unknownScore.players[2].score;
    assert.deepEqual(normalizeBafComparisons([unrelated, incomplete, unknownScore], PLAYER_4), []);
    assert.deepEqual(normalizeBafComparisons(null, PLAYER_4), []);
  });

  test('preserves all groups beyond ten and unknown prizes remain unknown', () => {
    const unknown = slate();
    delete unknown.players[0].prizes;
    const groups = normalizeBafComparisons(Array.from({ length: 24 }, () => unknown), PLAYER_4);
    assert.equal(groups.length, 24);
    assert.equal(groups[0].players[3].prizes, null);
  });

  test('accepts explicit slates from resolution metadata and suppresses them after a gate loss', () => {
    for (const status of ['closed', 'skipped']) {
      const snapshot = buildBafResolutionSnapshot({
        level: 40, player: PLAYER_4,
        metadata: { status, rngWord: status === 'closed' ? '1' : '2', comparisons: [slate()] },
      });
      assert.equal(snapshot.comparisons.length, status === 'closed' ? 1 : 0);
      assert.equal(snapshot.comparisonsAvailable, true);
    }
    assert.equal(model().comparisonsAvailable, false);
  });
});
