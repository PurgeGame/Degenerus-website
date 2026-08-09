import { update } from './app/store.js';
import { decimatorEntryScoreWei } from './app/decimator.js';
import { __setBafEveWidgetDepsForTest } from './components/app-baf-eve.js';
import { __setDecimatorBurnWidgetDepsForTest } from './components/app-decimator-burn.js';

const FLIP = 10n ** 18n;
const DEMO_PLAYER = '0xba5e00000000000000000000000000000000cafe';
const bafLeaders = [
  { level: 40, player: '0xf3fcb60eab7d06b11516023c4e4ce449b7cd563b', score: 79_595_332n * FLIP, rank: 1 },
  { level: 40, player: '0x4efc5a2c3ecf900800fbf0083da9f60971fe3b45', score: 76_956_966n * FLIP, rank: 2 },
  { level: 40, player: '0x62f01609828ba185cca5a764ff5ac3b920edc1b8', score: 54_592_263n * FLIP, rank: 3 },
  { level: 40, player: '0xf545cfc64dc97af26291691d0425f42028b03dac', score: 39_631_383n * FLIP, rank: 4 },
  { level: 40, player: '0x8d7df6e7fdc0951475fcd4b6218d7a33d8980ace', score: 31_284_550n * FLIP, rank: 5 },
];

update('connected.address', DEMO_PLAYER);
update('viewing.address', null);
update('ui.mode', 'self');
update('ui.chainOk', true);
update('app.boons', {
  address: DEMO_PLAYER,
  day: 24,
  boons: [{ boonType: 15, consumed: false }],
});

__setBafEveWidgetDepsForTest({
  game: async () => ({
    level: 39,
    phase: 'PURCHASE',
    jackpotPhaseFlag: false,
    rngLockedFlag: false,
    dailyRng: { day: 24 },
    prizePools: { futurePrizePool: '1837500000000000' },
  }),
  finalDay: async () => ({ currentLevel: 39, targetLevel: 40, rngLocked: false }),
  fetcher: async (path) => {
    if (path.startsWith('/leaderboards/baf')) {
      return { entries: bafLeaders.map((row) => ({ ...row, score: String(row.score) })) };
    }
    if (path.startsWith('/player/')) {
      return {
        level: 40,
        player: DEMO_PLAYER,
        score: String(12_846_250n * FLIP),
        rank: 12,
        totalParticipants: 247,
        roundStatus: 'open',
      };
    }
    if (path.startsWith('/leaderboards/coinflip')) {
      return { entries: [{ day: 25, player: bafLeaders[1].player, score: '6248200', rank: 1 }] };
    }
    throw new Error(`Unknown demo path: ${path}`);
  },
});

const decimator = {
  rawBurnWei: 8_420_000n * FLIP,
  totalRoundScore: 12_760_000n * FLIP,
  playerWeight: 284_500n * FLIP,
  activityScore: 235,
  dayOneActive: true,
  lastPurchaseDay: true,
};

__setDecimatorBurnWidgetDepsForTest({
  game: async () => ({
    level: 24,
    decWindowOpen: true,
    levelStartTime: Math.floor(Date.now() / 1000) - 2_700,
    prizePools: { futurePrizePool: '187500000000000' },
  }),
  context: async () => ({
    activityScore: decimator.activityScore,
    dayOneActive: decimator.dayOneActive,
    lastPurchaseDay: decimator.lastPurchaseDay,
    futurePoolWei: 187_500_000_000_000n,
    totalBurnWeight: decimator.playerWeight,
    totalRoundScore: decimator.totalRoundScore,
    totalRawBurnWei: decimator.rawBurnWei,
  }),
  rawBurn: async () => decimator.rawBurnWei,
  burn: async ({ amount }) => {
    const weight = decimatorEntryScoreWei({
      amountWei: amount,
      previousScoreWei: decimator.playerWeight,
      activityScore: decimator.activityScore,
      dayOneActive: decimator.dayOneActive,
      lastPurchaseDay: decimator.lastPurchaseDay,
      boonBps: 5_000,
    });
    decimator.rawBurnWei += amount;
    decimator.playerWeight += weight;
    decimator.totalRoundScore += weight;
    return { receipt: { status: 1, hash: `0xeventdemo${Date.now().toString(16)}` } };
  },
});

document.getElementById('baf-demo-host')?.appendChild(document.createElement('app-baf-eve'));
document.getElementById('decimator-demo-host')?.appendChild(document.createElement('app-decimator-burn'));
