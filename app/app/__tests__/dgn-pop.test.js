import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPopState, projectPopRow } from '../dgn-pop.js';
import { dgnScore, dgnPlayerTicket, dgnHouseLanes } from '../dgn-reels.js';

// Degenerette lanes: [symbol, color, wild]; a wild lane is 0x40 | symbol.
const pack = traits => traits.reduce((word, [sym, col, wild], q) =>
  word | ((wild ? 0x40 | sym : col * 8 + sym) << (q * 8)), 0) >>> 0;
const player = pack([[0, 0, true], [1, 1], [2, 2], [3, 3]]);
const house = pack([[0, 4], [2, 1], [2, 2], [3, 4]]);

test('wild hero symbol 2 (1 + wild color), full match 2, symbol-only 1, miss 0', () => {
  const row = projectPopRow({ playerTraits: player, houseTraits: house, score: 7 });
  // lane 0: symbol + wild color = 2; lane 1: color only = 1; lane 2: full = 2; lane 3: symbol only = 1
  assert.equal(row.exact, false, 'the recorded 7 disagrees with the 6 these lanes score');
  const ok = projectPopRow({ playerTraits: player, houseTraits: house, score: 6 });
  assert.equal(ok.exact, true);
  assert.deepEqual(ok.quadrants.map(q => q.points), [2, 1, 2, 1]);
  assert.equal(ok.hero, 0);
  assert.equal(ok.quadrants[0].hero, true);
});

test('wild against wild scores a symbol point and two color points', () => {
  const h = pack([[0, 0, true], [5, 5], [5, 5], [5, 5]]);
  const row = projectPopRow({ playerTraits: player, houseTraits: h, score: 3 });
  assert.equal(row.exact, true);
  assert.deepEqual(row.quadrants.map(q => q.points), [3, 0, 0, 0]);
  assert.equal(row.quadrants[0].house.wild, true);
});

test('colors score independently of symbols; an unmatched card has no points to place', () => {
  const p = pack([[1, 7, true], [1, 1], [2, 2], [3, 3]]);
  const h = pack([[2, 7], [2, 2], [3, 3], [4, 4]]);
  const q = projectPopRow({ playerTraits: p, houseTraits: h, score: 1 }).quadrants;
  assert.deepEqual(q.map(x => x.points), [1, 0, 0, 0]);
  assert.deepEqual([q[0].symbolMatch, q[0].colorMatch], [false, true]);
});

test('an allocation that disagrees with the recorded score is withheld until the board completes', () => {
  const row = { playerTraits: player, houseTraits: player, score: 1 };
  const state = createPopState([row]);
  assert.equal(state.boards[0].exact, false);
  state.reveal(0, 1);
  assert.equal(state.snapshot().score, 0);
  state.reveal(0);
  assert.equal(state.snapshot().score, 1);
});

test('partial → flame → batch adds each contribution once across all boards', () => {
  const state = createPopState(Array.from({ length: 3 }, () => ({ playerTraits: player, houseTraits: house, score: 6 })));
  state.reveal(1, 2);
  assert.equal(state.snapshot().score, 1);
  state.reveal(1, 2);
  assert.equal(state.snapshot().score, 1);
  state.reveal(1);
  assert.equal(state.snapshot().score, 6);
  for (let i = 0; i < 3; i++) state.reveal(i);
  assert.deepEqual(state.snapshot(), { masks: [15, 15, 15], score: 18, completed: 3, complete: true });
  assert.deepEqual(state.reveal(1), []);
  assert.deepEqual(state.reveal(-1), []);
  assert.deepEqual(state.reveal(3), []);
  assert.equal(createPopState([{ playerTraits: player, houseTraits: house, score: 6 }]).snapshot().score, 0);
});

test('every reveal order reconciles with the current scorer across 512 distinct results', () => {
  let seed = 7123;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const word = () => (BigInt(random()) << 224n) | (BigInt(random()) << 192n) | (BigInt(random()) << 160n)
    | (BigInt(random()) << 128n) | (BigInt(random()) << 96n) | (BigInt(random()) << 64n)
    | (BigInt(random()) << 32n) | BigInt(random());
  for (let i = 0; i < 512; i++) {
    const p = dgnPlayerTicket(word(), (i * 7) % 24), h = dgnHouseLanes(word());
    const score = dgnScore(p, h);
    const state = createPopState([{ playerTraits: p, houseTraits: h, score }]);
    assert.equal(state.boards[0].exact, true);
    for (const q of [2, 0, 3, 1, 2]) state.reveal(0, 1 << q);
    assert.equal(state.snapshot().score, score);
  }
});
