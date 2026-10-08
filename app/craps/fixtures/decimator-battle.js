// Deterministic visual fixture; all runs use the production bounded replay engine.
import { replayDecimatorEntry } from '../decimator-replay.js';
import { decimatorSurvives, decimatorSurvivorCount } from '../../chain/decimator-sampling.js';
import { decimatorTieKey, decimatorPeakMultiple } from '../../app/decimator-draw-data.js';
import { ETH_DIVISOR } from '../../app/chain-config.js';

const WEI = 10n ** 18n;
const address = id => `0x${BigInt(id).toString(16).padStart(40, '0')}`;
export function decimatorBattleFixture({ wideStacks = false } = {}) {
  const snapshot = { level: 15, rngWord: '123', sampling: true, entrants: 24, generatedEntries: 16,
    fieldEntries: 40, survivorCount: Number(decimatorSurvivorCount(40)), ranked: true, winnerCount: 5,
    poolWei: String(36n * WEI / ETH_DIVISOR), totalFlipBurned: String(240_000n * WEI),
    generatedStackCount: '24', generatedStackTotal: String(300_000n * WEI), battleEntries: [], winners: [], you: null };
  const stacks = Array.from({ length: 24 }, (_, i) => wideStacks ? BigInt(i + 1) * 100n * 10n ** BigInt(i % 6) : BigInt((i + 1) * 1000));
  const totalStack = stacks.reduce((sum, value) => sum + value, 0n);
  snapshot.generatedStackTotal = String(totalStack * WEI);
  const names = new Map();
  const labels = ['Brass Monkey', 'Lucky Seven', 'Night Shift', 'House Ghost', 'Dead Cat', 'Six Shooter', 'Gold Teeth', 'Last Chip'];
  for (let id = 1; id <= snapshot.fieldEntries; id++) {
    const generated = id > snapshot.entrants;
    const eligible = decimatorSurvives(snapshot.rngWord, snapshot.level, snapshot.fieldEntries, id);
    if (generated && !eligible) continue;
    const owner = address(generated ? 1 + id % 8 : id);
    names.set(owner, { name: `${labels[(Number(BigInt(owner)) - 1) % labels.length]} ${Number(BigInt(owner))}` });
    const entry = { entryId: String(id), address: owner, generated, eligible, chips: id % 3 ? 2 << 9 : 0,
      stack: String((generated ? totalStack / 24n : stacks[id - 1]) * WEI), peak: null, score: null,
      tieKey: String(decimatorTieKey(snapshot.rngWord, snapshot.level, id)) };
    if (eligible) {
      const run = replayDecimatorEntry(snapshot, entry);
      Object.assign(entry, { peak: run.peak, score: run.score, rankScore: run.rankScore });
    }
    snapshot.battleEntries.push(entry);
  }
  const ranked = snapshot.battleEntries.filter(entry => entry.eligible).sort((a, b) => {
    const left = BigInt(a.rankScore); const right = BigInt(b.rankScore);
    return left === right ? BigInt(a.tieKey) > BigInt(b.tieKey) ? -1 : 1 : left > right ? -1 : 1;
  });
  ranked.forEach((entry, index) => { entry.rank = index + 1; });
  snapshot.championEntryId = ranked[0].entryId;
  snapshot.winners = ranked.slice(0, 5).map((entry, index) => ({ ...entry,
    champion: index === 0, peakMultiple: decimatorPeakMultiple(entry.peak),
    ethWei: String(BigInt(index === 0 ? 8 : 3) * WEI / ETH_DIVISOR), halfPasses: index === 0 ? '2' : '0' }));
  selectDecimatorFixturePlayer(snapshot, ranked[0].address);
  return { snapshot, names };
}

export function selectDecimatorFixturePlayer(snapshot, player) {
  const entry = snapshot.battleEntries.find(row => row.address === player && !row.generated);
  const winner = snapshot.winners.find(row => row.entryId === entry?.entryId);
  snapshot.you = { ...(entry ?? { entryId: null, stack: '0' }), address: player, coin: null,
    survived: entry?.eligible ?? null, winner: Boolean(winner), rank: winner?.rank ?? null,
    peakMultiple: entry?.peak ? decimatorPeakMultiple(entry.peak) : null,
    ethWei: winner?.ethWei ?? '0', halfPasses: winner?.halfPasses ?? '0',
    generatedEntries: snapshot.battleEntries.filter(row => row.generated && row.address === player),
    generatedWins: snapshot.winners.filter(row => row.generated && row.address === player) };
}
