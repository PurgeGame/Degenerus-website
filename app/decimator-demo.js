import { update } from './app/store.js';
import { decimatorEntryScoreWei } from './app/decimator.js';
import {
  __setDecimatorBurnWidgetDepsForTest,
} from './components/app-decimator-burn.js';

const FLIP = 10n ** 18n;
const DEMO_PLAYER = '0xdec1000000000000000000000000000000000000';

const demo = {
  rawBurnWei: 8_420_000n * FLIP,
  totalRoundScore: 12_760_000n * FLIP,
  playerWeight: 284_500n * FLIP,
  activityScore: 235,
  dayOneActive: true,
  lastPurchaseDay: true,
};

update('connected.address', DEMO_PLAYER);
update('viewing.address', null);
update('ui.mode', 'self');
update('ui.chainOk', true);
update('app.boons', {
  address: DEMO_PLAYER,
  day: 24,
  boons: [{ boonType: 15, consumed: false }],
});

__setDecimatorBurnWidgetDepsForTest({
  game: async () => ({
    level: 24,
    decWindowOpen: true,
    levelStartTime: Math.floor(Date.now() / 1000) - 2_700,
    prizePools: { futurePrizePool: '187500000000000' },
  }),
  context: async () => ({
    activityScore: demo.activityScore,
    dayOneActive: demo.dayOneActive,
    lastPurchaseDay: demo.lastPurchaseDay,
    futurePoolWei: 187_500_000_000_000n,
    totalBurnWeight: demo.playerWeight,
    totalRoundScore: demo.totalRoundScore,
    totalRawBurnWei: demo.rawBurnWei,
  }),
  rawBurn: async () => demo.rawBurnWei,
  burn: async ({ amount }) => {
    const weight = decimatorEntryScoreWei({
      amountWei: amount,
      previousScoreWei: demo.playerWeight,
      activityScore: demo.activityScore,
      dayOneActive: demo.dayOneActive,
      lastPurchaseDay: demo.lastPurchaseDay,
      boonBps: 5_000,
    });
    demo.rawBurnWei += amount;
    demo.playerWeight += weight;
    demo.totalRoundScore += weight;
    return {
      receipt: {
        status: 1,
        hash: `0xdecimatordemo${Date.now().toString(16)}`,
      },
    };
  },
});

const host = document.getElementById('decimator-demo-host');
host?.appendChild(document.createElement('app-decimator-burn'));
