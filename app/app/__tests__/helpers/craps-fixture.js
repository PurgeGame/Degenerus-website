import { readFileSync } from 'node:fs';
// `Craps.FLIP`: the wire's *Wei money fields are the chain's whole-FLIP figures times this.
const SUB = 10n ** 18n;
export const { manifest, players, hashes } = JSON.parse(readFileSync(new URL('../../../chain/fixtures/craps-current.json', import.meta.url)));
export function crapsFixture() {
  const shapes = [3 | 2 << 9 | 2 << 12, 3 << 27 | 1 << 21 | 2 << 24,
    1 | 1 << 3 | 1 << 6 | 1 << 9 | 1 << 12 | 1 << 15 | 1 << 18,
    3 << 27 | 2 << 9 | 1 << 12, 3 | 2 << 24 | 1 << 6 | 1 << 3,
    2 | 3 << 21 | 2 << 6, 1 << 3, 1 << 9 | 1 << 12 | 1 << 15];
  const seats = players.map(p => {
    const betId = BigInt(p.betId); const n = Number(betId & ((1n << 64n) - 1n)); const lane = betId >> 64n === 340n ? 'window' : 'day';
    const shape = n + (lane === 'day' ? 2 : 0);
    // Chain units (whole FLIP since audit eb04b2e80, engine pin -v4): the wire carries them x 10^18.
    return { betId, player: p.player, chips: shape % 7 === 0 ? 0 : shapes[shape % shapes.length], standing: p.standing,
      multiple: p.entryMultiple, lane, chainWon: BigInt(p.wonWei) / SUB, chainPaid: BigInt(p.paidWei) / SUB };
  }).sort((a, b) => a.lane !== b.lane ? a.lane === 'window' ? -1 : 1 : a.betId < b.betId ? -1 : 1);
  return { battleKey: manifest.battleKey, word: 5n, ruleset: manifest.ruleset,
    settlement: Object.fromEntries(Object.entries(manifest.settlement).map(([k,v]) => [k, k === 'finalizedBlockHash' ? v : BigInt(v)])),
    terms: Object.fromEntries(Object.entries(manifest.terms).map(([k,v]) => [k.replace(/Wei$/, ''), BigInt(v) / SUB])),
    seats, shardSize: 8, progressive: { ...manifest.progressive, scoreBpsBefore: BigInt(manifest.progressive.scoreBpsBefore),
      thresholdScoreBps: BigInt(manifest.progressive.thresholdScoreBps), amountWei: BigInt(manifest.progressive.amountWei) / SUB, winnerBetId: BigInt(manifest.progressive.winnerBetId) }, publishedAt: manifest.publishedAt };
}

