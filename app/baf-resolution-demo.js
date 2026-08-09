import {
  bafCutSurvivorRank,
  buildBafResolutionSnapshot,
} from './app/baf-resolution.js';
import { openBafResolution } from './components/app-baf-resolution-overlay.js';

const FLIP = 10n ** 18n;
const PLAYERS = [
  '0xf3fcb60eab7d06b11516023c4e4ce449b7cd563b',
  '0x4efc5a2c3ecf900800fbf0083da9f60971fe3b45',
  '0x62f01609828ba185cca5a764ff5ac3b920edc1b8',
  '0xf545cfc64dc97af26291691d0425f42028b03dac',
];
const leaderboard = { entries: [
  { level: 40, player: PLAYERS[0], score: String(79_595_332n * FLIP), rank: 1 },
  { level: 40, player: PLAYERS[1], score: String(76_956_966n * FLIP), rank: 2 },
  { level: 40, player: PLAYERS[2], score: String(54_592_263n * FLIP), rank: 3 },
  { level: 40, player: PLAYERS[3], score: String(39_631_383n * FLIP), rank: 4 },
] };

let rankFourWord = 1n;
while (bafCutSurvivorRank(rankFourWord) !== 4) rankFourWord += 2n;

function snapshotFor(state) {
  const skipped = state === 'skipped';
  const winner = state === 'winner';
  const player = winner ? PLAYERS[3] : '0xba5e00000000000000000000000000000000cafe';
  const score = winner ? 39_631_383n : 12_846_250n;
  const rank = winner ? 4 : 12;
  const rngWord = skipped ? '24680' : String(rankFourWord);
  return buildBafResolutionSnapshot({
    level: 40,
    player,
    metadata: {
      level: 40,
      status: skipped ? 'skipped' : 'closed',
      day: 200,
      rngWord,
      estimatedPoolWei: skipped ? null : '183750000000000',
      awards: {
        ethCount: skipped ? 0 : 58,
        ethUnique: skipped ? 0 : 31,
        ethTotal: skipped ? '0' : '119430000000000',
        ticketCount: skipped ? 0 : 49,
        ticketUnique: skipped ? 0 : 27,
        ticketEntries: skipped ? '0' : '368',
      },
    },
    leaderboard,
    playerOutcome: {
      level: 40,
      player,
      score: String(score * FLIP),
      rank,
      totalParticipants: 247,
      roundStatus: skipped ? 'skipped' : 'closed',
    },
    history: winner ? { wins: [
      { level: 40, awardType: 'eth_baf', amount: '4593750000000' },
      { level: 40, awardType: 'tickets_baf', amount: '40' },
    ] } : { wins: [] },
    consolation: skipped ? 12_846n * FLIP : 0n,
  });
}

async function show(state) {
  const normalized = ['winner', 'miss', 'skipped'].includes(state) ? state : 'winner';
  await openBafResolution({ level: 40, player: PLAYERS[3], snapshot: snapshotFor(normalized) });
}

for (const button of document.querySelectorAll('[data-state]')) {
  button.addEventListener('click', () => { void show(button.dataset.state); });
}

const initial = new URLSearchParams(location.search).get('state') || 'winner';
void show(initial);

