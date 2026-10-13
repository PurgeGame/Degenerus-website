export const TUTORIAL_STORAGE_KEY = 'degenerus:tutorial:v13';
export const TUTORIAL_STATE_VERSION = 13;
export const TUTORIAL_LEVEL = 3;
export const TUTORIAL_PURCHASE_DAY = 7;
export const TUTORIAL_HISTORICAL_DAY = 8;
export const TUTORIAL_TICKET_PRICE_ETH = 0.01;
export const TUTORIAL_PURCHASE_POOL_ETH = 126.027571106263;
export const TUTORIAL_POOL_TARGET_ETH = 131.454558951579;
export const TUTORIAL_POOL_GROWTH_TARGET_ETH = 141.870113505865;
export const TUTORIAL_PRIZE_POOL_ETH = 154.31;
export const TUTORIAL_GRAND_PRIZE_ETH = 33.63;
export const TUTORIAL_HEADLINE_ETH = 728.81;
export const TUTORIAL_PURCHASE_FLIP = 200;
export const TUTORIAL_QUEST_FLIP = 100;
export const TUTORIAL_COINFLIP_PERCENT = 210;
export const TUTORIAL_MAIN_WIN_ETH = 0.145;
export const TUTORIAL_PLAYER = '0x0000000000000000000000000000000000000001';

// Ticket 1 owns both matches: green Ethereum loses; silver heart wins twice.
export const ACTIVE_TICKET_TRAITS = Object.freeze([22, 73, 178, 219]);
export const SECOND_ACTIVE_TICKET_TRAITS = Object.freeze([47, 64, 166, 207]);
export const MAIN_DRAW_TRAITS = Object.freeze([22, 66, 178, 205]);
export const COMMON_QUADRANT = 0;
export const SILVER_QUADRANT = 2;

export const TUTORIAL_STEPS = Object.freeze([
  { id: 'welcome', title: 'Tickets and the Daily Drawing',
    copy: 'Welcome to Degenerus Protocol, a zero-rake lottery game on Ethereum. This tutorial will show you the basics of how to play, starting with buying tickets and spinning the Daily Drawing.\n\nThis tutorial is for example only and no Ethereum wallet or real money is needed.',
    hint: '', action: 'start', cta: 'Start tutorial' },
  { id: 'buy-ticket', title: 'First, let’s get two tickets.',
    copy: 'This is Buy In. You can see all the options here. For now, click the highlighted ticket twice.', hint: '0 / 2 tickets',
    target: 'app-decimator-panel [data-bind="dec-ticket-add-ticket"]' },
  { id: 'buy', title: 'Buy your two tickets.',
    copy: 'Two tickets, ready to go. Click BUY IN, then confirm the purchase in the practice wallet.', hint: '2 tickets · 0.02 practice ETH',
    target: 'app-decimator-panel [data-bind="dec-buy-cta"]' },
  { id: 'quests', title: 'Quest complete!',
    copy: 'You’ve already finished a quest just by buying tickets. That earned you 100 FLIP credit. Your quests and streak live here.',
    hint: 'Quests complete as you play.', target: 'app-quest-panel',
    action: 'continue-quests', cta: 'Show me my FLIP' },
  { id: 'credits', title: 'You earned 300 FLIP credit.',
    copy: 'Your tickets added another 200. All 300 credits are in the next daily flip already. We’ll come back to that coin.',
    hint: '200 purchase + 100 quest = 300 FLIP',
    target: 'app-daily-flip [data-bind="df-tomorrow-bet-oval"]', action: 'continue-credits', cta: 'Let’s open my tickets' },
  { id: 'pack', title: 'Reveal your tickets.',
    copy: 'Here’s your pack. Click it to open your two tickets and reveal their badges.',
    hint: 'Click the pack itself.' },
  { id: 'badge-closeup', title: 'One quadrant. One badge.',
    copy: 'This is the green Ethereum quadrant from ticket 1. Its badge combines a symbol and a color. Let’s look at each part.',
    hint: 'Ticket 1 · upper-left quadrant',
    action: 'continue-closeup', cta: 'Show me the symbols' },
  { id: 'badge-symbols', title: 'Eight symbols. Equal chances.',
    copy: 'Here’s that same quadrant in green, with all eight possible symbols. Every symbol is equally likely to appear: a 1 in 8 chance.',
    hint: 'Same color · 12.5% chance for each symbol',
    action: 'continue-symbols', cta: 'Show me the colors' },
  { id: 'badge-colors', title: 'Eight colors. Very different odds.',
    copy: 'Now keep Ethereum and change only the color. These are the chances of each color appearing on your ticket. Pink, purple and green are common; silver and gold are rare.',
    hint: 'Same symbol · gold appears 1 time in 128',
    action: 'continue-colors', cta: 'Show me both tickets' },
  { id: 'badges', title: 'Two tickets. Eight entries.',
    copy: 'Each badge is an independent entry into the daily jackpots. Each ticket has four badges, so your two tickets give you eight entries.',
    hint: '2 tickets × 4 badges = 8 independent entries',
    action: 'start-jackpot', cta: 'I’m ready for the jackpot' },
  { id: 'main-spin', title: 'Spin the jackpot.',
    copy: 'Let’s see the draw. It picks a badge in each quadrant. Match its symbol and color, and your entry gets a chance at that quadrant’s prizes.',
    hint: 'Click SPIN. Matching gets you a chance to win.', target: 'replay-panel .replay-panel' },
  { id: 'scratch-common', title: 'Pop the green Ethereum.',
    copy: 'Your first ticket matches this common badge. Pop it to see whether your entry won.',
    hint: 'Click the highlighted bubble.', target: 'replay-panel [data-tutorial-quadrant="common"]' },
  { id: 'common-result', title: 'A match is a chance, not a win.',
    copy: 'No prize here. Other tickets also hold green Ethereum, and this time the draws picked other entries.',
    hint: 'Your silver heart is still in play.', target: 'replay-panel [data-tutorial-quadrant="common"]',
    action: 'continue-common', cta: 'Let’s try the silver heart' },
  { id: 'scratch-silver', title: 'Now pop the silver heart.',
    copy: 'This badge also matches ticket 1. Silver is rarer on player tickets, so there are usually fewer matching entries competing.',
    hint: 'Pop the bubble to uncover the prizes.', target: 'replay-panel [data-tutorial-quadrant="silver"]' },
  { id: 'two-wins', title: 'One ticket. Two wins.',
    copy: 'The silver heart on ticket 1 won two separate prizes in this jackpot: 0.10 ETH + 0.045 ETH. The same entry can be selected more than once.',
    hint: 'Two wins · 0.145 ETH total', target: 'replay-panel [data-tutorial-quadrant="silver"]',
    action: 'continue-wins', cta: 'Let’s flip' },
  { id: 'coin', title: 'Flip your 300 credits.',
    copy: 'Remember those 300 credits? They’re already in the bet. A win turns them into FLIP; a loss burns them. Click the coin.',
    hint: 'Click the coin to reveal the daily result.', target: 'app-daily-flip' },
  { id: 'complete', title: 'You won. Lesson complete.',
    copy: 'Your 300 credits paid 630 FLIP. You bought two tickets, completed a quest, learned about badges, and saw one ticket win twice in a jackpot.',
    hint: 'Practice results were scripted. Live results can win or lose.', target: 'app-daily-flip [data-bind="df-bet-oval"]',
    action: 'finish', cta: 'Explore the game' },
]);

export function previousTutorialPage(state) {
  return state.step > 0 ? state.step - 1 : null;
}

export function createInitialTutorialState() {
  return { version: TUTORIAL_STATE_VERSION, step: 0, furthestStep: 0, eth: 1, claimableEth: 0,
    flip: 0, level: TUTORIAL_LEVEL, day: 1, phase: 'purchase', poolEth: TUTORIAL_PURCHASE_POOL_ETH,
    coinBet: 0, baf: 0, bafRank: null, degenScore: 0, questStreak: 0,
    questPrimaryComplete: false, tickets: 0, draftTickets: 0, pending: [],
    selectedBadgeId: ACTIVE_TICKET_TRAITS[0],
    mainSpinComplete: false, commonScratched: false, silverScratched: false, sound: true };
}

export function tutorialScoreBreakdown(state) {
  // The first ETH purchase counts ONE minted level, even with two tickets.
  // Completing its purchase quest starts a one-level mint streak. Match
  // DegenerusGameLens.activityScoreBreakdown: participation uses the contract
  // level (2 while buying Level 3 tickets, then 3 in the jackpot phase), and
  // quest streak credit is floor(streak / 2).
  const mintedLevels = state.questPrimaryComplete ? 1 : 0;
  const contractLevel = state.phase === 'jackpot' ? TUTORIAL_LEVEL : TUTORIAL_LEVEL - 1;
  const mintLevelStreakPoints = mintedLevels;
  const mintCountPoints = Math.min(25, Math.floor(mintedLevels * 25 / contractLevel));
  const questStreakCreditedPoints = Math.floor(state.questStreak / 2);
  return {
    totalBps: mintLevelStreakPoints + mintCountPoints + questStreakCreditedPoints,
    mintLevelStreakPoints, mintCountPoints,
    questStreakPoints: state.questStreak, questStreakCreditedPoints,
    affiliatePoints: 0, passBonus: null, cursePoints: 0,
  };
}

export function applyTutorialEvent(previous, event, payload = {}) {
  const furthestStep = Math.max(previous.step, previous.furthestStep || 0);
  if (event === 'previous' && previous.step > 0) {
    return hydrateTutorialState({ ...previous, step: previous.step - 1, furthestStep });
  }
  if (event === 'next-page' && previous.step < furthestStep) {
    return hydrateTutorialState({ ...previous, step: previous.step + 1, furthestStep });
  }
  // Completed pages are restored from their checkpoints, never played twice.
  if (previous.step < furthestStep && event !== 'toggle-sound') return previous;
  const state = { ...previous, pending: previous.pending.map(item => ({ ...item })) };
  const step = TUTORIAL_STEPS[state.step]?.id;
  const advance = () => {
    state.step = Math.min(state.step + 1, TUTORIAL_STEPS.length - 1);
    state.furthestStep = Math.max(furthestStep, state.step);
  };
  if (event === 'toggle-sound') state.sound = !state.sound;
  else if (event === 'start' && step === 'welcome') advance();
  else if (event === 'add-ticket' && step === 'buy-ticket') {
    state.draftTickets = Math.min(2, state.draftTickets + 1);
    if (state.draftTickets === 2) advance();
  } else if (event === 'buy' && step === 'buy' && state.draftTickets === 2) {
    state.eth = 0.98;
    state.draftTickets = 0;
    state.questPrimaryComplete = true;
    state.questStreak = 1;
    state.coinBet = TUTORIAL_PURCHASE_FLIP + TUTORIAL_QUEST_FLIP;
    state.pending = [{ id: 'tutorial-pack', kind: 'pack', count: 2, status: 'ready' }];
    advance();
  } else if (event === 'continue-quests' && step === 'quests') advance();
  else if (event === 'continue-credits' && step === 'credits') advance();
  else if (event === 'collect-pack' && step === 'pack') {
    state.pending = [];
    state.tickets = 2;
    advance();
  } else if (event === 'continue-closeup' && step === 'badge-closeup') advance();
  else if (event === 'continue-symbols' && step === 'badge-symbols') advance();
  else if (event === 'continue-colors' && step === 'badge-colors') advance();
  else if (event === 'start-jackpot' && step === 'badges') {
    state.phase = 'jackpot'; state.day = 5; state.poolEth = TUTORIAL_PRIZE_POOL_ETH;
    advance();
  } else if (event === 'main-spin-complete' && step === 'main-spin') {
    state.mainSpinComplete = true; advance();
  } else if (event === 'scratch-quadrant' && step === 'scratch-common' && payload.quadrant === COMMON_QUADRANT) {
    state.commonScratched = true; advance();
  } else if (event === 'continue-common' && step === 'common-result') advance();
  else if (event === 'scratch-quadrant' && step === 'scratch-silver' && payload.quadrant === SILVER_QUADRANT) {
    state.silverScratched = true; state.claimableEth = TUTORIAL_MAIN_WIN_ETH; advance();
  } else if (event === 'continue-wins' && step === 'two-wins') advance();
  else if (event === 'coin-complete' && step === 'coin') {
    state.flip = state.coinBet * TUTORIAL_COINFLIP_PERCENT / 100;
    state.baf = state.flip; state.coinBet = 0; advance();
  }
  state.degenScore = tutorialScoreBreakdown(state).totalBps;
  return state;
}

export function hydrateTutorialState(value) {
  if (!value || value.version !== TUTORIAL_STATE_VERSION) return createInitialTutorialState();
  // Each page has a deterministic checkpoint. Navigation restores its data
  // while remembering how far the player got; balances are never trusted.
  const clampStep = step => Number.isInteger(step) ? Math.max(0, Math.min(step, TUTORIAL_STEPS.length - 1)) : 0;
  const target = clampStep(value.step);
  let state = createInitialTutorialState();
  const events = { welcome: 'start', 'buy-ticket': 'add-ticket', buy: 'buy', quests: 'continue-quests',
    credits: 'continue-credits', pack: 'collect-pack', 'badge-closeup': 'continue-closeup',
    'badge-symbols': 'continue-symbols', 'badge-colors': 'continue-colors', badges: 'start-jackpot', 'main-spin': 'main-spin-complete',
    'scratch-common': 'scratch-quadrant', 'common-result': 'continue-common', 'scratch-silver': 'scratch-quadrant',
    'two-wins': 'continue-wins', coin: 'coin-complete' };
  while (state.step < target) {
    const step = TUTORIAL_STEPS[state.step].id;
    state = applyTutorialEvent(state, events[step], {
      quadrant: step === 'scratch-common' ? COMMON_QUADRANT : SILVER_QUADRANT });
  }
  if (['welcome', 'buy-ticket'].includes(TUTORIAL_STEPS[target].id) && value.draftTickets === 1) state.draftTickets = 1;
  state.furthestStep = Math.max(target, clampStep(value.furthestStep));
  state.sound = value.sound !== false;
  return state;
}

export function tutorialJackpotFixture() {
  const win = (winner, traitId, amount, ticketIndex = 0) => ({
    winner, traitId, amount, ticketIndex, awardType: 'eth', level: TUTORIAL_LEVEL, sourceLevel: TUTORIAL_LEVEL,
  });
  // Sepolia display scales ETH by 1e6. The two winning rows display as 0.10 and
  // 0.045 ETH, and deliberately identify the same ticketIndex (0) and trait.
  return { day: TUTORIAL_HISTORICAL_DAY, level: TUTORIAL_LEVEL, purchaseLevel: TUTORIAL_LEVEL,
    dayInPhase: 5, player: TUTORIAL_PLAYER, entryCount: 8,
    mainTraits: [...MAIN_DRAW_TRAITS], bonusTraits: [1, 115, 186, 221],
    playerTraits: [...ACTIVE_TICKET_TRAITS, ...SECOND_ACTIVE_TICKET_TRAITS], futureTraits: [],
    roll1Wins: [
      win('0x0000000000000000000000000000000000000011', 22, '42000000000'),
      win('0x0000000000000000000000000000000000000012', 66, '31000000000'),
      win(TUTORIAL_PLAYER, 178, '100000000000'),
      win(TUTORIAL_PLAYER, 178, '45000000000'),
      win('0x0000000000000000000000000000000000000013', 178, '45000000000'),
      win('0x0000000000000000000000000000000000000014', 205, '18000000000'),
    ], roll2Wins: [] };
}
