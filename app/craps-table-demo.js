import {
  CRAPS_TABLE_REPLAY_EVENT,
  formatCrapsWei,
} from '/app/components/app-craps-table.js?v=resolution-race-v2';
import {
  SIM_CRAPS_REPLAY_ARTIFACTS,
  SIM_CRAPS_REPLAY_FEATURED,
} from '/app/craps/fixtures/sim-battle-v1.js';

const host = document.querySelector('app-craps-table');
const openButton = document.querySelector('[data-bind="demo-open"]');
const receipt = document.querySelector('[data-bind="demo-receipt"]');
const params = new URLSearchParams(location.search);

function demoDiscordPfp(initials, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111827"/><circle cx="32" cy="27" r="22" fill="${color}" opacity=".82"/><path d="M10 64c2-17 12-25 22-25s20 8 22 25" fill="#080b11" opacity=".72"/><text x="32" y="33" text-anchor="middle" fill="white" font-family="sans-serif" font-size="17" font-weight="900">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function demoCrowdPlayers() {
  const crowd = [
    ['feltwitch', 'FW', '#d97706'],
    ['yoeleven', 'Y7', '#0891b2'],
    ['puckluck', 'PL', '#65a30d'],
    ['railbird', 'RB', '#dc2626'],
    ['boxcars', 'BC', '#7c3aed'],
    ['insideheat', 'IH', '#db2777'],
    ['pointpress', 'PP', '#0d9488'],
    ['sevenproof', 'SP', '#ca8a04'],
  ];
  return crowd.map(([label, initials, color], index) => ({
    player: `demo-crowd-${index + 1}`,
    label,
    discordPfp: demoDiscordPfp(initials, color),
    color,
    resolution: { startingBankrollFlip: 720 + index * 45 },
    chips: {
      passLine: 1,
      dontPassLine: 1,
      place5: 1,
      place6: 1,
      place8: 1,
      place9: 1,
      place10: 1,
    },
  }));
}

function openTable() {
  if (params.has('sim') || params.get('source') === 'sim') {
    const requestedViewer = Math.max(1, Math.min(
      SIM_CRAPS_REPLAY_FEATURED.players.length,
      Number(params.get('viewer')) || 1,
    ));
    const viewer = SIM_CRAPS_REPLAY_FEATURED.players[requestedViewer - 1];
    host?.open({
      opener: openButton,
      replay: { ...SIM_CRAPS_REPLAY_ARTIFACTS, viewer },
      bountyPoolFlip: params.get('bountyPool') || 84_900,
      addedFlip: params.get('added') || 75_000,
      bonusMultiplier: params.get('bonusMultiplier') || 10,
      riuBattleAddedFlip: params.get('riuTransfer') || 370_930,
      biggestDiceRun: {
        scoreBps: params.get('biggestScoreBps') || 5_035_000,
        player: '0x71d40000000000000000000000000000000009a3',
        label: 'Velvet Kraken',
        discordPfp: demoDiscordPfp('VK', '#0d9488'),
        bountyWei: (66_000n * 10n ** 18n).toString(),
      },
      autoRoll: params.get('manual') !== 'true',
    });
    receipt.textContent = `SIM BUNDLE · ${viewer.name} · ${viewer.handsPlayed} shooters · ${viewer.totalRolls} rolls`;
    return;
  }
  const filled = !params.has('empty');
  const resolution = params.get('state') === 'resolution';
  const rolled = params.get('state') === 'rolled' || resolution;
  const bustRun = params.get('run') === 'bust';
  const survivalRun = params.get('run') === 'survival';
  const bonusRun = params.get('run') === 'bonus';
  const dontPassDemo = params.has('dontPass');
  const jackpotWinner = String(params.get('jackpotWinner') ?? '').trim().toLowerCase();
  const standardResolutionHands = [
    { bankrollFlip: 3360, label: 'PASS + PLACE 6 PAID', dice: [3, 3], payoutBets: ['pass', 'place-6'] },
    { bankrollFlip: 2640, label: 'SEVEN OUT', dice: [6, 1] },
    { bankrollFlip: 2640, label: 'POINT 8 SET', dice: [4, 4] },
    { bankrollFlip: 4080, label: 'PLACE 5 PAID', dice: [3, 2], payoutBets: ['place-5'] },
    { bankrollFlip: 3360, label: 'SEVEN OUT', dice: [4, 3] },
    { bankrollFlip: 3360, label: 'POINT 8 SET', dice: [6, 2] },
    { bankrollFlip: 7200, label: 'PLACE 6 PAID', dice: [4, 2], payoutBets: ['place-6'] },
    { bankrollFlip: 9000, label: 'HARD 8 · GOAL HIT', dice: [4, 4], payoutBets: ['place-8', 'hard-8'], terminal: 'goal' },
    { bankrollFlip: 9720, label: 'PLACE 6 PAID', dice: [4, 2], payoutBets: ['place-6'] },
    { bankrollFlip: 9000, label: 'SEVEN OUT · GOAL LOCKED', dice: [4, 3] },
  ];
  const resolutionHands = survivalRun
    ? [
        {
          bankrollFlip: 420,
          label: 'SEVEN OUT · SURVIVAL RANGE',
          dice: [4, 3],
          survival: { survived: true },
        },
        { bankrollFlip: 840, label: 'POINT 6 SET', dice: [3, 3] },
        {
          bankrollFlip: 360,
          label: 'SEVEN OUT · SURVIVAL RANGE',
          dice: [6, 1],
          survival: { survived: false },
        },
      ]
    : bustRun
    ? [
        { bankrollFlip: 2640, label: 'SEVEN OUT', dice: [4, 3] },
        { bankrollFlip: 2640, label: 'POINT 5 SET', dice: [3, 2] },
        { bankrollFlip: 2100, label: 'COLD SHOOTER', dice: [2, 3] },
        { bankrollFlip: 1380, label: 'SEVEN OUT', dice: [6, 1] },
        { bankrollFlip: 720, label: 'LAST BOARD', dice: [3, 3] },
        { bankrollFlip: 0, label: 'SEVEN OUT · BANKROLL EMPTY', dice: [4, 3], terminal: 'bust' },
      ]
    : bonusRun
      ? standardResolutionHands.map((hand, index) => ({
          ...hand,
          ...([0, 5].includes(index) ? { shooterBoost: { active: true, percent: 20 } } : {}),
        }))
      : standardResolutionHands;
  const lastHand = resolutionHands.at(-1);
  const terminalHand = [...resolutionHands].reverse().find((hand) => hand?.terminal);
  const runReturn = lastHand?.survival?.survived === false || lastHand?.terminal === 'bust'
    ? 0n
    : BigInt(lastHand?.bankrollFlip ?? 0);
  host?.open({
    opener: openButton,
    screen: params.get('screen') === 'placement' ? 'placement' : 'battle',
    balanceFlip: params.get('balance') || '25000',
    playedFlip: params.get('played') || 600,
    battleStakeFlip: params.get('battleStake') || 300,
    bountyPoolFlip: params.get('bountyPool') || 84_900,
    addedFlip: params.get('added') || 75_000,
    bonusMultiplier: params.get('bonusMultiplier') || 10,
    battleWonByViewer: params.has('battleWin'),
    battlePayoutWei: params.has('battleWin')
      ? (BigInt(params.get('battlePayout') || 84_900) * 10n ** 18n).toString()
      : null,
    battleBoostWei: params.has('battleWin')
      ? (BigInt(params.get('battleBoost') || 75_000) * 10n ** 18n).toString()
      : null,
    battleWinningStop: params.get('battleWin') === 'last' ? 0 : 1,
    completedShooters: params.get('shooters') || 0,
    tableIndex: params.get('table') || '1842',
    tableResolved: rolled,
    showResolution: resolution,
    pendingBetIds: rolled ? ['412', '413'] : [],
    rolls: rolled ? '0x3366430041556100442652003265340051244300623361004255160053442500' : null,
    resolutionHands: rolled ? resolutionHands : [],
    viewerResult: rolled ? {
      stop: terminalHand?.terminal ?? null,
      runPayoutWei: (runReturn * 10n ** 18n).toString(),
    } : null,
    preview: rolled ? {
      won: (runReturn * 10n ** 18n).toString(),
      paid: (runReturn * 10n ** 18n).toString(),
      bonusFlipWei: '15000000000000000000',
    } : null,
    mode: 'slip',
    bankrollFlip: params.get('bankroll') || '3000',
    goalFlip: params.get('goal') || '9000',
    jackpot: {
      scoreBps: params.get('jackpotScoreBps') || 32_400,
      thresholdScoreBps: params.get('jackpotThresholdScoreBps') || 250_000,
      amountFlip: params.get('jackpotAmount') || 1_250_000,
      status: jackpotWinner === 'other' ? 'won-other' : jackpotWinner === 'you' ? 'won-you' : 'live',
      wonAtScoreBps: params.get('jackpotWinnerScoreBps'),
      battleAddedFlip: params.get('riuTransfer') || 370_930,
    },
    biggestDiceRun: {
      scoreBps: params.get('biggestScoreBps') || 5_035_000,
      player: '0x71d40000000000000000000000000000000009a3',
      label: 'Velvet Kraken',
      discordPfp: demoDiscordPfp('VK', '#0d9488'),
      bountyWei: (66_000n * 10n ** 18n).toString(),
    },
    autoRoll: params.get('manual') !== 'true',
    rakeBps: params.get('rakeBps') || 5000,
    degenScore: params.get('score') || params.get('activity') || 400,
    otherPlayers: params.has('solo') ? [] : [
      {
        player: '0x71d40000000000000000000000000000000009a3',
        label: 'dicegoblin',
        discordPfp: demoDiscordPfp('DG', '#287fc4'),
        color: '#55b8ff',
        resolution: {
          type: 'cashout',
          roll: 6,
          startingBankrollFlip: 2100,
          goalFlip: 5100,
          amountFlip: 5100,
          ...(bonusRun ? {
            shooterBoosts: [{ active: true, percent: 30 }, null, { active: true, percent: 30 }],
          } : {}),
          // In the survival run DG doubles through the second boundary right as
          // the viewer's own coin comes up short.
          ...(survivalRun ? { survivals: [null, { survived: true }] } : {}),
          // DG takes the lead on roll one, but the felt seats stay frozen
          // until roll two's seven-out starts the next shooter.
          bankrollsFlip: [4320, 3660, 4500, 4680, 4920, 5100],
        },
        chips: { passLine: 2, place5: 1, place6: 2, place8: 1, place10: 1 },
      },
      {
        player: '0xba5e00000000000000000000000000000000cafe',
        label: 'rollhard',
        discordPfp: demoDiscordPfp('RH', '#c13d82'),
        color: '#ff66b3',
        resolution: {
          type: 'bust',
          roll: 2,
          startingBankrollFlip: 1200,
          // RH's bust is a lost survival coin at the first boundary, flipping
          // beside the portrait while the viewer's own coin lands a win.
          ...(survivalRun ? { survivals: [{ survived: false }] } : {}),
          // The roll snapshot is the pre-coin low. The resolver owns the later
          // vertical move to zero so even this fixture cannot spoil the flip.
          bankrollsFlip: survivalRun ? [540, 360] : [540, 0],
        },
        chips: { dontPassLine: 2, place4: 1, place5: 1, place6: 1, place8: 1, hard4: 1 },
      },
      {
        player: '0xc01d00000000000000000000000000000000babe',
        label: 'coldbabe',
        discordPfp: demoDiscordPfp('CB', '#6f51d8'),
        color: '#a986ff',
        resolution: {
          type: 'cashout',
          roll: 8,
          startingBankrollFlip: 3600,
          goalFlip: 9400,
          amountFlip: 9400,
          ...(bonusRun ? {
            shooterBoosts: [null, { active: true, percent: 25 }, null],
          } : {}),
          bankrollsFlip: [4080, 3420, 4860, 5520, 4980, 6840, 8160, 9400],
        },
        chips: { passLine: 1, dontPassLine: 1, place5: 1, place6: 1, place8: 2, hard8: 1 },
      },
      ...demoCrowdPlayers(),
    ],
    initialBets: filled
      ? dontPassDemo
        ? { 'dont-pass': 1, 'place-6': 2, 'place-8': 3, 'hard-8': 1 }
        : { pass: 1, 'place-6': 2, 'place-8': 3, 'hard-8': 1 }
      : {},
    confirm: async (wager) => {
      receipt.textContent = [
        `${wager.method} · battle slot #${wager.battleSlot}`,
        `${wager.selectedChips} generic chips · ${Number(wager.maxLossFlip).toLocaleString('en-US')} FLIP buy-in`,
        `Placements ${JSON.stringify(wager.chips)}`,
      ].join('\n');
      return true;
    },
    settle: async ({ betIds, preview }) => {
      const returned = BigInt(preview?.paid ?? 0) / 10n ** 18n;
      receipt.textContent = [
        `resolveBets([${betIds.join(', ')}])`,
        returned > 0n
          ? `Run returns ${Number(returned).toLocaleString('en-US')} FLIP`
          : 'Run busted · returns 0 FLIP',
        ...(BigInt(preview?.bonusFlipWei ?? 0) > 0n
          ? [`BONUS FLIP CREDITED · ${formatCrapsWei(preview.bonusFlipWei)} FLIP`]
          : []),
      ].join('\n');
      return true;
    },
  });
}

openButton?.addEventListener('click', openTable);
host?.addEventListener(CRAPS_TABLE_REPLAY_EVENT, (event) => {
  const rolls = event.detail.hands.reduce((count, hand) => count + hand.rolls.length, 0);
  receipt.textContent = `Replay decoded: ${event.detail.hands.length} shooters · ${rolls} dice rolls`;
});
if (!params.has('closed')) openTable();
