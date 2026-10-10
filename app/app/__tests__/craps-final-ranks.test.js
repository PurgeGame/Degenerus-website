import test from 'node:test';
import assert from 'node:assert/strict';
import { crapsReplayFinalRankings, materializeReplay } from '../../chain/craps-worker.js';
import { crapsFixture } from './helpers/craps-fixture.js';

test('exact ties use the contract hash of dense window/day/awarded ordinals', () => {
  const window = (340n << 64n) | 1n;
  const day = (336n << 64n) | 1n;
  const awarded = (340n << 64n) | 2n;
  const entries = [window, day, awarded].map((betId, index) => ({
    betId, multiple: index === 0 ? 1 : 10, result: 17n,
  }));
  // Solidity abi.encode(word=5, CrapsTie, slot=340|ordinal) hashes start
  // e99c (1), f0b9 (2), ca9c (3). The larger hash wins a dead-level score.
  assert.deepEqual(crapsReplayFinalRankings(entries, 5n, 340n, value => value), {
    main: [day, window, awarded].map(String), high: [day, awarded].map(String),
  });
  entries[2].result = 18n;
  assert.equal(crapsReplayFinalRankings(entries, 5n, 340n, value => value).main[0], String(awarded),
    'merit wins before the random tiebreak; buying copies never improves merit');
});

test('the verified replay carries complete main/high rankings and checks the settled winner', async () => {
  const input = crapsFixture();
  const bundle = await materializeReplay(input);
  assert.equal(bundle.rankings.main.length, input.seats.length);
  assert.equal(new Set(bundle.rankings.main).size, input.seats.length);
  const high = new Set(input.seats.filter(seat => seat.multiple > 1).map(seat => String(seat.betId)));
  assert.deepEqual(bundle.rankings.high, bundle.rankings.main.filter(id => high.has(id)));
  const winnerSeat = input.seats.findIndex(seat => String(seat.betId) === bundle.rankings.main[0]) + 1;
  assert.deepEqual((await materializeReplay({ ...input, winnerSeat })).rankings, bundle.rankings);
  await assert.rejects(materializeReplay({ ...input, winnerSeat: winnerSeat === 1 ? 2 : 1 }), /disagrees with the settled battle winner/);
});
