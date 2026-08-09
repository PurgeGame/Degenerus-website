import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  JACKPOT_PROCESSING_MILESTONES,
  dailyJackpotProcessingSignals,
  jackpotProcessingPresentationStep,
  jackpotSpinControlState,
  jackpotProcessingStage,
  latchedJackpotProcessingStage,
} from '../jackpot-processing.js';

const NONE = Object.fromEntries(JACKPOT_PROCESSING_MILESTONES.map((name) => [name, false]));
const completed = (count) => Object.fromEntries(
  JACKPOT_PROCESSING_MILESTONES.map((name, index) => [name, index < count]),
);

describe('jackpotProcessingStage', () => {
  test('starts with Chainlink RNG and exposes all seven confirmed steps', () => {
    const stage = jackpotProcessingStage(NONE);
    assert.equal(stage.done, 0);
    assert.equal(stage.total, 7);
    assert.equal(stage.progress, 0);
    assert.equal(stage.key, 'rng');
    assert.equal(stage.label, 'RNG INCOMING');
  });

  test('names the player-facing contract pipeline before preparing the spin', () => {
    assert.equal(jackpotProcessingStage(completed(1)).label, 'COINFLIP PROCESSING');
    assert.equal(jackpotProcessingStage(completed(2)).label, 'DELIVERING PACKS');
    assert.equal(jackpotProcessingStage(completed(3)).label, 'JACKPOT PROCESSING');
    assert.equal(jackpotProcessingStage(completed(4)).label, 'PREPARING SPIN');
    assert.equal(jackpotProcessingStage(completed(7)).label, 'SPIN READY');
  });

  test('an out-of-order endpoint cannot jump ahead of the contract pipeline', () => {
    const stage = jackpotProcessingStage({
      rng: false, coinflip: true, packs: true, jackpot: true,
      draw: true, rolls: true, sealed: true,
    });
    assert.equal(stage.done, 0);
    assert.equal(stage.key, 'rng');
  });

  test('unknown/missing input is treated as nothing done, never complete', () => {
    assert.equal(jackpotProcessingStage().done, 0);
    assert.equal(jackpotProcessingStage(null).done, 0);
    assert.equal(jackpotProcessingStage({ rng: 'yes', coinflip: 1 }).done, 0);
  });

  test('milestones retain their real processing order', () => {
    assert.deepEqual(JACKPOT_PROCESSING_MILESTONES, [
      'rng', 'coinflip', 'packs', 'jackpot', 'draw', 'rolls', 'sealed',
    ]);
  });
});

describe('jackpotSpinControlState', () => {
  const readyStage = jackpotProcessingStage(completed(7));

  test('a ready label and a clickable spin become the same state', () => {
    const state = jackpotSpinControlState({
      sourceProcessing: true,
      stage: readyStage,
      dayReady: true,
    });
    assert.equal(state.ready, true);
    assert.equal(state.processing, false);
    assert.equal(state.stage.key, 'ready');
  });

  test('an unresolved exact-day latch remains PREPARING instead of dead SPIN READY', () => {
    const state = jackpotSpinControlState({
      sourceProcessing: true,
      stage: readyStage,
      dayReady: false,
    });
    assert.equal(state.ready, false);
    assert.equal(state.processing, true);
    assert.equal(state.stage.key, 'sealed');
    assert.equal(state.stage.label, 'PREPARING SPIN');
  });
});

describe('dailyJackpotProcessingSignals', () => {
  const daySync = {
    day: 81, rngRequested: true, rngLocked: true,
    coinflipReady: false, jackpotReady: false,
  };

  test('waits for the exact-day Chainlink word', () => {
    assert.deepEqual(dailyJackpotProcessingSignals({ day: 81, daySync }), {
      day: 81,
      active: true,
      requested: true,
      rngReady: false,
      coinflipReady: false,
      ticketsReady: false,
      jackpotReady: false,
    });
    assert.equal(dailyJackpotProcessingSignals({
      day: 81,
      daySync,
      gameState: { dailyRng: { day: 81, finalWord: '123' }, ticketsFullyProcessed: false },
    }).rngReady, true);
  });

  test('the exact-day lock release recognizes RNG before slower feeds catch up', () => {
    const arrived = dailyJackpotProcessingSignals({
      day: 81,
      daySync: { ...daySync, rngLocked: false },
      gameState: { dailyRng: { day: 81, finalWord: '0' }, ticketsFullyProcessed: false },
    });
    assert.equal(arrived.rngReady, true);
    assert.equal(arrived.coinflipReady, false);
    assert.equal(jackpotProcessingStage({
      rng: arrived.rngReady,
      coinflip: arrived.coinflipReady,
      packs: arrived.ticketsReady,
      jackpot: arrived.jackpotReady,
      draw: false,
      rolls: false,
      sealed: false,
    }).label, 'COINFLIP PROCESSING');

    const notRequested = dailyJackpotProcessingSignals({
      day: 81,
      daySync: { ...daySync, rngRequested: false, rngLocked: false },
      gameState: { dailyRng: { day: 81, finalWord: '0' }, ticketsFullyProcessed: false },
    });
    assert.equal(notRequested.rngReady, false,
      'an ordinary unlocked pre-request day is not mistaken for an arrival');
  });

  test('uses the direct Coinflip lane and the ticket-drain flag', () => {
    const resolvedFlip = { ...daySync, rngLocked: true, coinflipReady: true };
    const delivering = dailyJackpotProcessingSignals({
      day: 81,
      daySync: resolvedFlip,
      gameState: { dailyRng: { day: 81, finalWord: '123' }, ticketsFullyProcessed: false },
    });
    assert.equal(delivering.coinflipReady, true);
    assert.equal(delivering.ticketsReady, false);
    const delivered = dailyJackpotProcessingSignals({
      day: 81,
      daySync: resolvedFlip,
      gameState: { dailyRng: { day: 81, finalWord: '123' }, ticketsFullyProcessed: true },
    });
    assert.equal(delivered.ticketsReady, true);
  });

  test('the exact request unlock overrides the next-buffer false ticket latch', () => {
    const signals = dailyJackpotProcessingSignals({
      day: 81,
      daySync: {
        ...daySync,
        rngRequested: true,
        rngLocked: false,
        coinflipReady: true,
      },
      gameState: {
        dailyRng: { day: 81, finalWord: '123' },
        // These are deliberately still JACKPOT: both broad phases span days
        // and must not participate in the daily completion decision.
        phase: 'JACKPOT',
        jackpotPhaseFlag: true,
        phaseTransitionActive: true,
        rngLockedFlag: false,
        ticketsFullyProcessed: false,
      },
    });
    assert.equal(signals.ticketsReady, true,
      'the flag reset for the next ticket buffer cannot reopen the completed drain');
    assert.equal(signals.jackpotReady, false,
      'contract completion still waits for the indexed jackpot payload');
    assert.equal(jackpotProcessingStage({
      rng: signals.rngReady,
      coinflip: signals.coinflipReady,
      packs: signals.ticketsReady,
      jackpot: signals.jackpotReady,
    }).label, 'JACKPOT PROCESSING');

    const stillLocked = dailyJackpotProcessingSignals({
      day: 81,
      daySync: {
        ...daySync,
        rngRequested: true,
        rngLocked: true,
        coinflipReady: true,
      },
      gameState: {
        dailyRng: { day: 81, finalWord: '123' },
        phase: 'PURCHASE',
        jackpotPhaseFlag: false,
        phaseTransitionActive: false,
        rngLockedFlag: true,
        ticketsFullyProcessed: false,
      },
    });
    assert.equal(stillLocked.ticketsReady, false,
      'a broad phase label cannot advance an exact request that is still locked');
  });

  test('the exact resolved jackpot payload closes a stale day-sync lane', () => {
    const signals = dailyJackpotProcessingSignals({
      day: 81,
      daySync: { ...daySync, rngLocked: false, coinflipReady: true, jackpotReady: false },
      gameState: {
        dailyRng: { day: 81, finalWord: '123' },
        rngLockedFlag: false,
        ticketsFullyProcessed: false,
      },
      jackpotPayload: { day: 81, status: 'resolved' },
    });
    assert.equal(signals.jackpotReady, true);
    assert.equal(signals.ticketsReady, true);

    const wrongDay = dailyJackpotProcessingSignals({
      day: 81,
      daySync,
      jackpotPayload: { day: 80, status: 'resolved' },
    });
    assert.equal(wrongDay.jackpotReady, false,
      'a historical payload cannot release the incoming day');
  });

  test('a ready jackpot implies every earlier contract phase when polling skips them', () => {
    const signals = dailyJackpotProcessingSignals({
      day: 81,
      daySync: { ...daySync, rngLocked: false, jackpotReady: true },
      gameState: { dailyRng: { day: 80, finalWord: '0' }, ticketsFullyProcessed: false },
    });
    assert.equal(signals.rngReady, true);
    assert.equal(signals.coinflipReady, true);
    assert.equal(signals.ticketsReady, true);
    assert.equal(signals.jackpotReady, true);
  });

  test('wrong-day state never advances an incoming day', () => {
    const signals = dailyJackpotProcessingSignals({
      day: 82,
      daySync,
      gameState: { dailyRng: { day: 81, finalWord: '123' }, ticketsFullyProcessed: true },
    });
    assert.equal(signals.requested, false);
    assert.equal(signals.active, false);
    assert.equal(signals.rngReady, false);
  });

  test('the direct day boundary starts RNG INCOMING before the request bit lands', () => {
    const signals = dailyJackpotProcessingSignals({
      day: 82,
      daySync: {
        day: 82,
        rngRequested: false,
        rngLocked: false,
        coinflipReady: false,
        jackpotReady: false,
      },
    });
    assert.equal(signals.active, true);
    assert.equal(signals.requested, false);
    assert.equal(signals.rngReady, false);
    assert.equal(jackpotProcessingStage({
      rng: signals.rngReady,
      coinflip: signals.coinflipReady,
      packs: signals.ticketsReady,
      jackpot: signals.jackpotReady,
      draw: false,
      rolls: false,
      sealed: false,
    }).label, 'RNG INCOMING');
  });
});

describe('jackpotProcessingPresentationStep', () => {
  test('shows RNG ARRIVED briefly, then walks skipped confirmed phases in order', () => {
    const target = jackpotProcessingStage(completed(4));
    let out = jackpotProcessingPresentationStep({ target, day: 81, now: 0 });
    assert.equal(out.stage.key, 'rng-arrived');
    assert.equal(out.stage.label, 'RNG ARRIVED');

    out = jackpotProcessingPresentationStep({ target, state: out.state, day: 81, now: 899 });
    assert.equal(out.stage.key, 'rng-arrived');
    out = jackpotProcessingPresentationStep({ target, state: out.state, day: 81, now: 900 });
    assert.equal(out.stage.key, 'coinflip');
    out = jackpotProcessingPresentationStep({ target, state: out.state, day: 81, now: 1_550 });
    assert.equal(out.stage.key, 'packs');
    out = jackpotProcessingPresentationStep({ target, state: out.state, day: 81, now: 2_200 });
    assert.equal(out.stage.key, 'jackpot');
    out = jackpotProcessingPresentationStep({ target, state: out.state, day: 81, now: 2_850 });
    assert.equal(out.stage.key, 'draw');
    assert.equal(out.stage.label, 'PREPARING SPIN');
    assert.equal(out.pending, false);
  });

  test('a new day resets the visual chase', () => {
    const target = jackpotProcessingStage(completed(3));
    const first = jackpotProcessingPresentationStep({ target, day: 81, now: 0 });
    const next = jackpotProcessingPresentationStep({
      target: jackpotProcessingStage(NONE),
      state: first.state,
      day: 82,
      now: 200,
    });
    assert.equal(next.stage.key, 'rng');
    assert.equal(next.stage.progress, 0);
  });
});

describe('latchedJackpotProcessingStage', () => {
  test('advancing milestones move the seven-step bar monotonically', () => {
    let latch = null;
    const seen = [];
    for (let count = 0; count <= 7; count += 1) {
      const out = latchedJackpotProcessingStage({
        day: 7,
        milestones: completed(count),
        latch,
      });
      latch = out.latch;
      seen.push(out.stage.done);
    }
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('a refetch cannot slide the bar backwards', () => {
    const first = latchedJackpotProcessingStage({
      day: 7, milestones: completed(4), latch: null,
    });
    const second = latchedJackpotProcessingStage({
      day: 7, milestones: completed(2), latch: first.latch,
    });
    assert.equal(second.stage.done, 4);
    assert.equal(second.stage.key, 'packs');
    assert.equal(second.stage.label, 'DELIVERING PACKS');
  });

  test('changing day resets the latch', () => {
    const first = latchedJackpotProcessingStage({
      day: 7, milestones: completed(7), latch: null,
    });
    const next = latchedJackpotProcessingStage({
      day: 8, milestones: NONE, latch: first.latch,
    });
    assert.equal(next.stage.progress, 0);
    assert.equal(next.latch.day, 8);
  });
});
