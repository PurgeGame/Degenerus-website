import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  JACKPOT_PROCESSING_MILESTONES,
  jackpotProcessingStage,
  latchedJackpotProcessingStage,
} from '../jackpot-processing.js';

const NONE = { draw: false, rolls: false, sealed: false };

describe('jackpotProcessingStage', () => {
  test('nothing done reads 0/3 and names the draw as the pending milestone', () => {
    const stage = jackpotProcessingStage(NONE);
    assert.equal(stage.done, 0);
    assert.equal(stage.total, 3);
    assert.equal(stage.progress, 0);
    assert.equal(stage.key, 'draw');
    assert.equal(stage.label, 'Waiting for the draw');
  });

  test('all three done reads 1.0 and goes to ready', () => {
    const stage = jackpotProcessingStage({ draw: true, rolls: true, sealed: true });
    assert.equal(stage.done, 3);
    assert.equal(stage.progress, 1);
    assert.equal(stage.key, 'ready');
  });

  test('rolls are ONE milestone — the pair is never half-counted', () => {
    // #loadDayRolls resolves roll1 and roll2 as a single Promise.allSettled pair
    // and its caller assigns both in one synchronous block, so there is no
    // observable state where one is loaded and the other is not. This test pins
    // the milestone shape that encodes that: there is no roll1/roll2 to split.
    assert.ok(!JACKPOT_PROCESSING_MILESTONES.includes('roll1'));
    assert.ok(!JACKPOT_PROCESSING_MILESTONES.includes('roll2'));
    const before = jackpotProcessingStage({ draw: true, rolls: false, sealed: false });
    const after = jackpotProcessingStage({ draw: true, rolls: true, sealed: false });
    assert.equal(before.done, 1);
    assert.equal(after.done, 2, 'the pair advances the bar by exactly one step');
  });

  test('sealed is NOT ordered against the others — this is why done is a count', () => {
    // `sealed` is `!hasAttribute('data-day-warming')`, owned by
    // last-day-jackpot.js. A day never marked warming reads sealed from the
    // first frame, while the draw is still being fetched. An index would call
    // that "waiting on the seal"; a count reports one real milestone done and
    // still names the draw as outstanding.
    const stage = jackpotProcessingStage({ draw: false, rolls: false, sealed: true });
    assert.equal(stage.done, 1);
    assert.equal(stage.key, 'draw');
    assert.notEqual(stage.key, 'ready');
  });

  test('a sealed day whose rolls are still fetching is not reported complete', () => {
    const stage = jackpotProcessingStage({ draw: true, rolls: false, sealed: true });
    assert.equal(stage.done, 2);
    assert.equal(stage.key, 'rolls');
    assert.notEqual(stage.key, 'ready');
  });

  test('unknown/missing input is treated as nothing done, never as complete', () => {
    assert.equal(jackpotProcessingStage().done, 0);
    assert.equal(jackpotProcessingStage(null).done, 0);
    // Truthy-but-not-true must not count: only an explicit boolean does.
    assert.equal(jackpotProcessingStage({ draw: 'yes', rolls: 1 }).done, 0);
  });

  test('milestone list is the documented three, in narration order', () => {
    assert.deepEqual(JACKPOT_PROCESSING_MILESTONES, ['draw', 'rolls', 'sealed']);
  });
});

describe('latchedJackpotProcessingStage', () => {
  test('advancing milestones move the bar and carry the latch forward', () => {
    let latch = null;
    const seen = [];
    for (const m of [
      NONE,
      { ...NONE, draw: true },
      { ...NONE, draw: true, rolls: true },
      { draw: true, rolls: true, sealed: true },
    ]) {
      const out = latchedJackpotProcessingStage({ day: 7, milestones: m, latch });
      latch = out.latch;
      seen.push(Number(out.stage.progress.toFixed(4)));
    }
    assert.deepEqual(seen, [0, 0.3333, 0.6667, 1]);
  });

  test('a refetch that drops a milestone does NOT slide the bar backwards', () => {
    const first = latchedJackpotProcessingStage({
      day: 7, milestones: { draw: true, rolls: true, sealed: false }, latch: null,
    });
    assert.equal(first.stage.done, 2);

    // The roll pair is re-requested after a failed load; the live reading drops.
    const second = latchedJackpotProcessingStage({
      day: 7, milestones: { draw: true, rolls: false, sealed: false }, latch: first.latch,
    });
    assert.equal(second.stage.done, 2, 'bar holds at the high-water mark');
    // The label still tells the truth about what is being fetched right now.
    assert.equal(second.stage.key, 'rolls');
    assert.equal(second.stage.label, 'Reading the rolls');
  });

  test('changing day resets the latch — a new day starts from zero', () => {
    const first = latchedJackpotProcessingStage({
      day: 7, milestones: { draw: true, rolls: true, sealed: true }, latch: null,
    });
    assert.equal(first.stage.progress, 1);

    const next = latchedJackpotProcessingStage({ day: 8, milestones: NONE, latch: first.latch });
    assert.equal(next.stage.progress, 0, 'day 8 must not inherit day 7 progress');
    assert.equal(next.latch.day, 8);
  });

  test('a null/invalid day never latches, so it cannot pin a later real day', () => {
    const none = latchedJackpotProcessingStage({
      day: null, milestones: { draw: true, rolls: true, sealed: true }, latch: null,
    });
    assert.equal(none.latch.day, null);
    const real = latchedJackpotProcessingStage({ day: 9, milestones: NONE, latch: none.latch });
    assert.equal(real.stage.progress, 0);
  });
});
