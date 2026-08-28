/**
 * Replay fixture generated from the vendored exact engine with:
 *   boundSlot=100, word=14, bankroll=1,800 FLIP, goal=9,000 FLIP, board=600 FLIP.
 *
 * It deliberately contains a goal, ordinary busts, a lost survival flip, the shooter-5
 * wager doubling boundary, picked-board boosts, and blank-board boosts.
 */

import { encodeCrapsReplayLadder } from '../replay-contract.js';

const BATTLE_KEY = '100';
const DIGEST = '7f14c0ffee000001';
const BASE = `/craps/replays/v1/battles/${BATTLE_KEY}/results/${DIGEST}`;
const F = '000000000000000000';

const players = [
  {
    betId: '1844674407370955161601', seat: '1',
    player: '0x1111111111111111111111111111111111111111', name: 'dicegoblin',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png', entryMultiple: 1, standing: 100,
    resolvedBoardWei: [`180${F}`, '0', '0', `180${F}`, `60${F}`, '0', `60${F}`, '0', `60${F}`, `60${F}`],
    bankrollInWei: `1800${F}`, goalWei: `9000${F}`, handsPlayed: 5, totalRolls: 38, unitsPlayed: '5', stop: 'bust',
    ladder: encodeCrapsReplayLadder([
      `1800${F}`, `14561${F.slice(0, 17)}`, `11061${F.slice(0, 17)}`,
      `10611${F.slice(0, 17)}`, `8511${F.slice(0, 17)}`, `3561${F.slice(0, 17)}`,
    ]),
    boosts: [{ shooter: 0, percent: 6 }], survivals: [], wonWei: `3561${F.slice(0, 17)}`, paidWei: '0', replayOk: true,
  },
  {
    betId: '1844674407370955161602', seat: '2',
    player: '0x2222222222222222222222222222222222222222', name: 'rollhard',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png', entryMultiple: 1, standing: 99,
    resolvedBoardWei: [`60${F}`, `60${F}`, `120${F}`, `60${F}`, `120${F}`, `60${F}`, `120${F}`, '0', '0', '0'],
    bankrollInWei: `1800${F}`, goalWei: `9000${F}`, handsPlayed: 11, totalRolls: 110, unitsPlayed: '19', stop: 'goal',
    ladder: encodeCrapsReplayLadder([`1800${F}`, `1660${F}`, `1260${F}`, `1420${F}`, `1610${F}`, `1220${F}`, `920${F}`, `5180${F}`, `4120${F}`, `4400${F}`, `4100${F}`, `107312${F.slice(0, 17)}`]),
    boosts: [{ shooter: 10, percent: 6 }], survivals: [{ shooter: 6, survived: true }],
    wonWei: `107312${F.slice(0, 17)}`, paidWei: `107312${F.slice(0, 17)}`, replayOk: true,
  },
  {
    betId: '1844674407370955161603', seat: '3',
    player: '0x3333333333333333333333333333333333333333', name: 'feltwitch',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png', entryMultiple: 1, standing: 98,
    resolvedBoardWei: ['0', `120${F}`, `60${F}`, `60${F}`, '0', `60${F}`, `60${F}`, `60${F}`, `120${F}`, `60${F}`],
    bankrollInWei: `1800${F}`, goalWei: `9000${F}`, handsPlayed: 6, totalRolls: 47, unitsPlayed: '7', stop: 'bust',
    ladder: encodeCrapsReplayLadder([`1800${F}`, `1485${F}`, `885${F}`, `1030${F}`, `1430${F}`, `1265${F}`, `385${F}`]),
    boosts: [], survivals: [], wonWei: `385${F}`, paidWei: '0', replayOk: true,
  },
  {
    betId: '1844674407370955161604', seat: '4',
    player: '0x4444444444444444444444444444444444444444', name: 'blankcheck',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/3.png', entryMultiple: 1, standing: 97,
    resolvedBoardWei: [`60${F}`, `120${F}`, `60${F}`, `60${F}`, '0', '0', '0', `120${F}`, `120${F}`, `60${F}`],
    bankrollInWei: `1800${F}`, goalWei: `9000${F}`, handsPlayed: 6, totalRolls: 47, unitsPlayed: '7', stop: 'bust',
    ladder: encodeCrapsReplayLadder([`1800${F}`, `1305${F}`, `765${F}`, `66875${F.slice(0, 16)}`, `154875${F.slice(0, 16)}`, `129375${F.slice(0, 16)}`, '0']),
    boosts: [{ shooter: 2, percent: 25 }, { shooter: 5, percent: 25 }],
    survivals: [{ shooter: 6, survived: false }], wonWei: '0', paidWei: '0', replayOk: true,
  },
];

export const SIM_CRAPS_REPLAY_POINTER = Object.freeze({
  schemaVersion: 1,
  kind: 'craps-replay-pointer',
  battleKey: BATTLE_KEY,
  status: 'ready',
  entrants: 4,
  resolved: 4,
  finalizedBlock: '22001400',
  digest: DIGEST,
  manifestPath: `${BASE}/manifest.json`,
  publishedAt: '2026-08-28T18:00:00.000Z',
});

export const SIM_CRAPS_REPLAY_MANIFEST = Object.freeze({
  schemaVersion: 1,
  kind: 'craps-replay-manifest',
  battleKey: BATTLE_KEY,
  digest: DIGEST,
  ruleset: {
    engineVersion: 'craps-solidity-484a5d60b-v1',
    chainId: 31337,
    contract: '0x9e545e3c0baab3e08cdfd552c960a1050f373042',
    runtimeCodeHash: '0x7fa2e3de9a9102cc1832fc8f1eb240040d641e5c173d9dc61bb38a2c125e8471',
  },
  settlement: {
    boundSlot: '100',
    boundIndex: '500',
    finalizedBlock: '22001400',
    finalizedBlockHash: `0x${'3'.repeat(64)}`,
  },
  terms: {
    bankrollWei: `1800${F}`,
    goalWei: `9000${F}`,
    boardStakeWei: `600${F}`,
    battleStakeWei: `300${F}`,
  },
  tape: {
    encoding: 'packed-nibbles+uint32be/base64',
    maxHands: 11,
    totalRolls: 110,
    rolls: 'FVNURRImQ2JTQSUSVEVSUmEyE1FGZCVWYyMkFCIyEkMzY2YxISVDRiESFFZiFTQjZRMVU1YUVVNWFCRBElQzYlVkNlFiNkQlMjNDMRUzFFUyERFDNjNGQmUzVhYiZGZGJjJBFBQRMRUmYlVUERY=',
    handOffsets: 'AAAAAAAAAAcAAAALAAAAFwAAACAAAAAmAAAALwAAAEgAAABLAAAAVAAAAFw=',
  },
  progressive: {
    rollsBefore: '68',
    thresholdRolls: '100',
    amountWei: `1250000${F}`,
    winnerBetId: null,
    wonAtRoll: null,
    status: 'live',
  },
  field: {
    entrants: 4,
    shardSize: 256,
    shardCount: 1,
    featuredPath: `${BASE}/featured.json`,
    shardPathTemplate: `${BASE}/seats/{shard}.json`,
  },
  verification: {
    allSeatsReplayOk: true,
    settledEntrants: 4,
    replayedWonDigest: `0x${'5'.repeat(64)}`,
  },
  publishedAt: '2026-08-28T18:00:00.000Z',
});

export const SIM_CRAPS_REPLAY_FEATURED = Object.freeze({
  schemaVersion: 1,
  kind: 'craps-replay-featured',
  battleKey: BATTLE_KEY,
  digest: DIGEST,
  players,
  leaderboard: [
    ['1601', '1602', '1603', '1604'],
    ['1602', '1603', '1601', '1604'],
    ['1602', '1601', '1603', '1604'],
    ['1602', '1601', '1603', '1604'],
    ['1602', '1604', '1603', '1601'],
    ['1604', '1603', '1602', '1601'],
    ['1602', '1603', '1604'],
    ['1602'], ['1602'], ['1602'], ['1602'],
  ].map((tails, shooter) => Object.freeze({
    shooter,
    betIds: Object.freeze(tails.map((tail) => `184467440737095516${tail}`)),
  })),
});

export const SIM_CRAPS_REPLAY_SHARD = Object.freeze({
  schemaVersion: 1,
  kind: 'craps-replay-seat-shard',
  battleKey: BATTLE_KEY,
  digest: DIGEST,
  shard: { index: 0, startSeat: '1', endSeat: '4' },
  players,
});

export const SIM_CRAPS_REPLAY_ARTIFACTS = Object.freeze({
  ready: true,
  pointer: SIM_CRAPS_REPLAY_POINTER,
  manifest: SIM_CRAPS_REPLAY_MANIFEST,
  featured: SIM_CRAPS_REPLAY_FEATURED,
  shard: SIM_CRAPS_REPLAY_SHARD,
  viewer: players[0],
});

export const SIM_CRAPS_REPLAY_PATHS = Object.freeze({
  pointer: `/craps/replays/v1/battles/${BATTLE_KEY}/latest.json`,
  manifest: `${BASE}/manifest.json`,
  featured: `${BASE}/featured.json`,
  shard: `${BASE}/seats/0000.json`,
});
