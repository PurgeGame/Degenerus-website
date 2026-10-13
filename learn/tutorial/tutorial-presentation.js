import { ETH_DIVISOR } from '/app/app/chain-config.js';
import {
  TUTORIAL_LEVEL, TUTORIAL_PURCHASE_DAY, TUTORIAL_HISTORICAL_DAY,
  TUTORIAL_TICKET_PRICE_ETH, TUTORIAL_PURCHASE_POOL_ETH, TUTORIAL_POOL_TARGET_ETH,
  TUTORIAL_PRIZE_POOL_ETH, TUTORIAL_HEADLINE_ETH, TUTORIAL_PLAYER,
  TUTORIAL_COINFLIP_PERCENT, tutorialScoreBreakdown,
} from './tutorial-state.js?v=22';

const tokenWei = amount => BigInt(Math.round(amount * 1e6)) * 10n ** 12n;
const ethWei = amount => tokenWei(amount) / ETH_DIVISOR;
const painted = new Map();
function paint(tag, key, fixture) {
  if (painted.get(tag) === key) return;
  const host = document.querySelector(tag);
  if (host?.setTutorialFixture(fixture)) painted.set(tag, key);
}

// Only the data is scripted. Components retain their normal rendering paths.
export function paintTutorialGame(state, { coinAnimating = false, step } = {}) {
  const jackpot = state.phase === 'jackpot';
  const day = jackpot ? TUTORIAL_HISTORICAL_DAY : TUTORIAL_PURCHASE_DAY;
  const priceWei = ethWei(TUTORIAL_TICKET_PRICE_ETH);
  const contractLevel = jackpot ? TUTORIAL_LEVEL : TUTORIAL_LEVEL - 1;
  const gameState = {
    level: contractLevel, phase: jackpot ? 'JACKPOT' : 'PURCHASE',
    jackpotPhaseFlag: jackpot, jackpotCounter: jackpot ? 2 : 0,
    purchaseDays: 1, jackpotFlags: 0, jackpotDays: 3,
    prizePools: { nextPrizePool: ethWei(TUTORIAL_PURCHASE_POOL_ETH),
      currentPrizePool: ethWei(TUTORIAL_PRIZE_POOL_ETH), lastPrizePool: ethWei(TUTORIAL_PRIZE_POOL_ETH) },
  };
  const phaseClock = { level: contractLevel, jackpot, day: jackpot ? 2 : 1,
    purchaseDay: 1, jackpotDays: 3, rngLocked: false };
  const goldRush = { headlineWei: ethWei(TUTORIAL_HEADLINE_ETH),
    level: contractLevel, phaseClock,
    components: { nextWei: ethWei(TUTORIAL_PURCHASE_POOL_ETH), currentWei: ethWei(TUTORIAL_PRIZE_POOL_ETH) } };
  paint('gold-rush-headline', state.phase, goldRush);
  paint('app-pool-progress', state.phase, { gameState, goldRush,
    benchmarks: { level: contractLevel, targetWei: ethWei(TUTORIAL_POOL_TARGET_ETH), contractPhase: phaseClock,
      history: [{ level: 1, poolWei: ethWei(70) }, { level: 2, poolWei: ethWei(110) }] } });
  paint('app-decimator-panel', String(state.draftTickets), {
    level: TUTORIAL_LEVEL, priceWei, tickets: state.draftTickets,
  });

  paint('app-quest-panel', [state.phase, state.questPrimaryComplete, state.degenScore].join(':'), {
    player: TUTORIAL_PLAYER, day: TUTORIAL_PURCHASE_DAY, gameState,
    definitions: [{ slot: 0, questType: 1, target: priceWei.toString() },
      { slot: 1, questType: 2, target: tokenWei(2000).toString() }],
    quests: [{ day: TUTORIAL_PURCHASE_DAY, slot: 0, questType: 1,
      progress: state.questPrimaryComplete ? (priceWei * 2n).toString() : '0',
      target: priceWei.toString(), completed: state.questPrimaryComplete, notStarted: !state.questPrimaryComplete }],
    streak: { baseStreak: state.questStreak, lastCompletedDay: state.questPrimaryComplete ? TUTORIAL_PURCHASE_DAY : 0 },
    score: tutorialScoreBreakdown(state),
    levelQuest: { level: TUTORIAL_LEVEL, questType: 7, target: ethWei(.1).toString(),
      progress: '0', eligible: false, completed: false },
  });

  const packVisible = step === 'pack';
  paint('app-reveal-tray', String(packVisible), packVisible ? [{
    id: 'tutorial-pack', kind: 'tickets', ticketLevel: TUTORIAL_LEVEL, ticketCount: 2,
    label: 'Level ' + TUTORIAL_LEVEL + ' ticket pack', shortLabel: 'Open tickets',
    detail: '2 tickets ready to reveal', state: 'ready', autoOpen: false, run: () => false,
  }] : []);
  document.querySelector('app-reveal-tray')?.querySelector('[data-action-id="tutorial-pack"]')?.setAttribute('data-tutorial-pending', 'pack');

  if (!coinAnimating) {
    const won = step === 'complete';
    paint('app-daily-flip', [state.phase, state.coinBet, state.flip, won].join(':'), {
      player: TUTORIAL_PLAYER, day, revealed: won,
      stakeWei: tokenWei(jackpot ? (won ? 300 : state.coinBet) : 0),
      tomorrowWei: tokenWei(jackpot ? 0 : state.coinBet),
      claimableWei: tokenWei(state.flip), bafWei: tokenWei(state.baf),
      result: jackpot ? { day, win: true, rewardPercent: TUTORIAL_COINFLIP_PERCENT - 100 } : null,
    });
  }
}
