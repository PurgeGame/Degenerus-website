import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileDaySync,
  nextDayProbeDelay,
  _testing,
} from '../day-rollover.js';
import { VOLUME_WINDOW } from '../chain-config.js';

const win = (day, rewardPercent = 81) => ({
  day, win: true, rewardPercent, resolved: true, source: 'chain',
});

function apply(state, snapshot, lastDay) {
  return reconcileDaySync({ snapshot, lastDay, previous: state, now: 1_000 });
}

describe('authoritative day rollover reducer', () => {
  test('jackpot and coinflip unlock only on the same exact chain day', () => {
    let state = apply(null, { day: 40, blockNumber: 100, coinflip: null }, null);
    assert.equal(state.phase, 'waiting-both');
    assert.equal(state.ready, false);

    state = apply(state, { day: 40, blockNumber: 101, coinflip: null }, {
      day: 40, status: 'resolved',
    });
    assert.equal(state.phase, 'waiting-coinflip');
    assert.equal(state.ready, false);

    state = apply(state, { day: 40, blockNumber: 102, coinflip: win(40) }, {
      day: 40, status: 'resolved',
    });
    assert.equal(state.phase, 'synced');
    assert.equal(state.ready, true);
    assert.equal(state.jackpotDay, 40);
    assert.equal(state.coinflipDay, 40);
  });

  test('a new chain day clears both prior-day lanes immediately', () => {
    const prior = apply(null, { day: 40, blockNumber: 100, coinflip: win(40) }, {
      day: 40, status: 'resolved',
    });
    const shifted = apply(prior, { day: 41, blockNumber: 110, coinflip: null }, {
      day: 40, status: 'resolved',
    });
    assert.equal(shifted.day, 41);
    assert.equal(shifted.previousDay, 40);
    assert.equal(shifted.ready, false);
    assert.equal(shifted.jackpotReady, false);
    assert.equal(shifted.coinflipReady, false);
    assert.equal(shifted.rngRequested, false,
      'the wall-clock boundary alone is not presented as an RNG request');
  });

  test('the request lock starts processing and preserves its Reverse Flip parity after consumption', () => {
    let state = apply(null, {
      day: 41, blockNumber: 110, coinflip: null,
      rngLocked: false, reverseQueued: '3',
    }, { day: 40, status: 'resolved' });
    assert.equal(state.rngRequested, false);
    assert.equal(state.reverseQueued, '3');

    state = apply(state, {
      day: 41, blockNumber: 111, coinflip: null,
      rngLocked: true, reverseQueued: '3',
    }, { day: 40, status: 'resolved' });
    assert.equal(state.rngRequested, true);
    assert.equal(state.rngLocked, true);
    assert.equal(state.reverseQueued, '3');

    state = apply(state, {
      day: 41, blockNumber: 112, coinflip: win(41),
      rngLocked: false, reverseQueued: '0',
    }, { day: 40, status: 'resolved' });
    assert.equal(state.rngRequested, true, 'request evidence remains latched for the day');
    assert.equal(state.reverseQueued, '3',
      'the consumed live quote cannot reset the waiting coin to the wrong side');
  });

  test('the fulfilled word is proof the request happened, without the lock', () => {
    // isRngFulfilled() reads `rngWordCurrent != 0`, assigned by the VRF
    // callback. A cold load landing after the callback sees no lock edge, no
    // indexed jackpot and no resolved coinflip, and used to conclude nothing
    // had been requested at all.
    const state = apply(null, {
      day: 41, blockNumber: 110, coinflip: null,
      rngLocked: false, rngFulfilled: true,
    }, { day: 40, status: 'resolved' });
    assert.equal(state.rngFulfilled, true);
    assert.equal(state.rngRequested, true,
      'a delivered word cannot coexist with an unrequested day');
  });

  test('the latch survives the advance pipeline zeroing the word', () => {
    // DegenerusGameAdvanceModule.sol zeroes rngWordCurrent once it has drained
    // the word, so isRngFulfilled() goes back to false mid-processing. That is
    // not the word un-arriving.
    let state = apply(null, {
      day: 41, blockNumber: 110, coinflip: null, rngFulfilled: true,
    }, null);
    assert.equal(state.rngFulfilled, true);

    state = apply(state, {
      day: 41, blockNumber: 111, coinflip: null, rngFulfilled: false,
    }, null);
    assert.equal(state.rngFulfilled, true,
      'the drained word is still the word that arrived for this day');
  });

  test('an unreadable fulfillment view neither asserts nor clears', () => {
    let state = apply(null, {
      day: 41, blockNumber: 110, coinflip: null, rngFulfilled: null,
    }, null);
    assert.equal(state.rngFulfilled, false, 'a failed read is never fulfillment');
    assert.equal(state.rngRequested, false);

    state = apply(state, {
      day: 41, blockNumber: 111, coinflip: null, rngFulfilled: true,
    }, null);
    state = apply(state, {
      day: 41, blockNumber: 112, coinflip: null, rngFulfilled: null,
    }, null);
    assert.equal(state.rngFulfilled, true, 'nor does it retract one already seen');
  });

  test('a new chain day clears the fulfilled latch with the rest', () => {
    const prior = apply(null, {
      day: 41, blockNumber: 110, coinflip: null, rngFulfilled: true,
    }, null);
    const shifted = apply(prior, {
      day: 42, blockNumber: 120, coinflip: null, rngFulfilled: false,
    }, null);
    assert.equal(shifted.rngFulfilled, false);
    assert.equal(shifted.rngRequested, false);
  });

  test('advanceDue falling false after RNG evidence marks processing complete', () => {
    let state = apply(null, {
      day: 41,
      blockNumber: 110,
      coinflip: null,
      rngLocked: false,
      rngFulfilled: true,
      advanceDue: true,
    }, { day: 40, status: 'resolved' });
    assert.equal(state.processingComplete, false, 'pending keeper work keeps the API quiet');

    state = apply(state, {
      day: 41,
      blockNumber: 111,
      coinflip: null,
      rngLocked: false,
      rngFulfilled: false,
      advanceDue: false,
    }, { day: 40, status: 'resolved' });
    assert.equal(state.processingComplete, true,
      'the drained predicate combines with the latched fulfilled word');
    assert.equal(state.advanceDue, false);

    state = apply(state, {
      day: 41,
      blockNumber: 112,
      coinflip: null,
      advanceDue: null,
    }, { day: 40, status: 'resolved' });
    assert.equal(state.processingComplete, true, 'an RPC miss cannot undo completion');
  });

  test('an idle false predicate is not completion, and a new day clears the latch', () => {
    const idle = apply(null, {
      day: 41,
      blockNumber: 110,
      coinflip: null,
      rngLocked: false,
      rngFulfilled: false,
      advanceDue: false,
    }, null);
    assert.equal(idle.processingComplete, false,
      'advanceDue is also false before a request and needs RNG evidence');

    const complete = apply(idle, {
      day: 41,
      blockNumber: 111,
      coinflip: win(41),
      advanceDue: false,
    }, null);
    assert.equal(complete.processingComplete, true,
      'the permanent coinflip result proves a cold-loaded day was processed');

    const shifted = apply(complete, {
      day: 42,
      blockNumber: 120,
      coinflip: null,
      rngFulfilled: false,
      advanceDue: true,
    }, { day: 41, status: 'resolved' });
    assert.equal(shifted.processingComplete, false);
    assert.equal(shifted.advanceDue, true);
  });

  test('stale and duplicate responses cannot regress a ready target', () => {
    const ready = apply(null, { day: 52, blockNumber: 500, coinflip: win(52, 99) }, {
      day: 52, status: 'resolved',
    });
    const stale = apply(ready, { day: 51, blockNumber: 499, coinflip: win(51) }, {
      day: 51, status: 'resolved',
    });
    assert.equal(stale.day, 52);
    assert.equal(stale.ready, true);
    assert.equal(stale.coinflipResult.rewardPercent, 99);

    const duplicate = apply(stale, { day: 52, blockNumber: 500, coinflip: null }, null);
    assert.equal(duplicate.ready, true);
    assert.equal(duplicate.coinflipResult.rewardPercent, 99);
  });

  test('all jackpot/coin ordering permutations converge without cross-day readiness', () => {
    const permutations = [
      ['day', 'jackpot', 'coin'], ['day', 'coin', 'jackpot'],
      ['jackpot', 'day', 'coin'], ['jackpot', 'coin', 'day'],
      ['coin', 'day', 'jackpot'], ['coin', 'jackpot', 'day'],
    ];
    for (const ordering of permutations) {
      let snapshot = { day: 70, blockNumber: 700, coinflip: null };
      let lastDay = { day: 70, status: 'resolved' };
      let state = apply(null, { day: 70, blockNumber: 700, coinflip: win(70) }, lastDay);
      for (const event of ordering) {
        if (event === 'day') snapshot = { day: 71, blockNumber: 710, coinflip: null };
        if (event === 'coin') snapshot = { day: 71, blockNumber: 711, coinflip: win(71) };
        if (event === 'jackpot') lastDay = { day: 71, status: 'resolved' };
        state = apply(state, snapshot, lastDay);
        if (state.ready) {
          assert.equal(state.jackpotDay, state.day, ordering.join(' → '));
          assert.equal(state.coinflipDay, state.day, ordering.join(' → '));
        }
      }
      // Apply the final authoritative state after every deliberately shuffled
      // delivery; all paths must settle identically.
      state = apply(state, { day: 71, blockNumber: 712, coinflip: win(71) }, {
        day: 71, status: 'resolved',
      });
      assert.equal(state.day, 71, ordering.join(' → '));
      assert.equal(state.ready, true, ordering.join(' → '));
    }
  });

  test('loss sentinel is resolved but exposes no fake payout modifier', () => {
    assert.deepEqual(_testing.normalizedCoinflip(9, { rewardPercent: 1, win: false }), {
      day: 9, win: false, rewardPercent: 0, resolved: true, source: 'chain',
    });
  });

  test('probe cadence tightens while warming', () => {
    assert.equal(nextDayProbeDelay({ day: 9, ready: false }, 0), 1_500);
  });

  test('chain probing backs off once processing is complete and only the indexer remains', () => {
    assert.equal(nextDayProbeDelay({ day: 9, ready: false, processingComplete: true }, 0), 15_000);
  });

  test('probe cadence stays fast immediately after the wall-clock boundary', () => {
    const boundaryMs = Number(VOLUME_WINDOW.anchor) * 1_000;
    assert.equal(nextDayProbeDelay({ day: 9, ready: true }, boundaryMs - 1_000), 1_000,
      'the final second before rollover is probed eagerly');
    assert.equal(nextDayProbeDelay({ day: 9, ready: true }, boundaryMs), 1_000,
      'an exact-boundary read cannot drop back to the steady cadence');
    assert.equal(nextDayProbeDelay({ day: 9, ready: true }, boundaryMs + 5_000), 1_000,
      'a prior-block RPC answer is retried while the new boundary settles');
  });
});
