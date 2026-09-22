import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPopState, projectPopRow } from '../dgn-pop.js';
import { dgnScore } from '../dgn-reels.js';

const pack = traits => traits.reduce((word, [sym, col], q) => word | ((q * 64 + col * 8 + sym) << (q * 8)), 0) >>> 0;
const player = pack([[0, 0], [1, 1], [2, 2], [3, 3]]);
const house = pack([[0, 0], [2, 1], [2, 2], [3, 4]]);

test('Hero, independent color, full and symbol matches contribute 3/1/2/1', () => {
  const row = projectPopRow({ playerTraits: player, houseTraits: house, score: 7 }, 0);
  assert.equal(row.exact, true);
  assert.deepEqual(row.quadrants.map(q => q.points), [3, 1, 2, 1]);
  assert.equal(row.hero, 0);
});

test('gold-color-only earns its color point and separate gold match', () => {
  const p = pack([[1, 7], [1, 1], [2, 2], [3, 3]]);
  const h = pack([[2, 7], [2, 2], [3, 3], [4, 4]]);
  const q = projectPopRow({ playerTraits: p, houseTraits: h, score: 1 }, 0).quadrants[0];
  assert.deepEqual([q.points, q.gold, q.symbolMatch, q.colorMatch], [1, true, false, true]);
});

test('older gated-color results retain the allocation that matches their recorded score', () => {
  const row = projectPopRow({ playerTraits: player, houseTraits: house, score: 6 }, 0);
  assert.equal(row.legacy, true);
  assert.deepEqual(row.quadrants.map(q => q.points), [3, 0, 2, 1]);
});

test('ambiguous Hero is never invented; recorded score appears at board completion', () => {
  const row = { playerTraits: player, houseTraits: player, score: 9, heroIdx: null };
  const state = createPopState([row]);
  assert.equal(state.boards[0].hero, null);
  assert.equal(state.boards[0].exact, false);
  state.reveal(0, 1);
  assert.equal(state.snapshot().score, 0);
  state.reveal(0);
  assert.equal(state.snapshot().score, 9);
});

test('partial → flame → batch adds each contribution once across all boards', () => {
  const state = createPopState(Array.from({ length: 3 }, () => ({ playerTraits: player, houseTraits: house, score: 7 })), 0);
  state.reveal(1, 2);
  assert.equal(state.snapshot().score, 1);
  state.reveal(1, 2);
  assert.equal(state.snapshot().score, 1);
  state.reveal(1);
  assert.equal(state.snapshot().score, 7);
  for (let i = 0; i < 3; i++) state.reveal(i);
  assert.deepEqual(state.snapshot(), { masks: [15, 15, 15], score: 21, completed: 3, complete: true });
  assert.deepEqual(state.reveal(1), []);
  assert.deepEqual(state.reveal(-1), []);
  assert.deepEqual(state.reveal(3), []);
  assert.equal(createPopState([{ playerTraits: player, houseTraits: house, score: 7 }], 0).snapshot().score, 0);
});

test('every reveal order reconciles with the current scorer across 512 distinct results', () => {
  let seed = 7123;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 512; i++) {
    const p = random(), h = random(), hero = i % 4;
    const score = dgnScore(p, h, hero);
    const state = createPopState([{ playerTraits: p, houseTraits: h, score }], hero);
    assert.equal(state.boards[0].exact, true);
    for (const q of [2, 0, 3, 1, 2]) state.reveal(0, 1 << q);
    assert.equal(state.snapshot().score, score);
  }
});
