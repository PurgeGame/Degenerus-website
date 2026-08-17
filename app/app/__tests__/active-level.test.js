// /app/app/__tests__/active-level.test.js
// Run: cd website && node --test app/app/__tests__/active-level.test.js
//
// Guards the JS port of the contract's _activeTicketLevel()
// (contracts/modules/DegenerusGameMintStreakUtils.sol:153). The branches that
// matter are the SEALED-WINDOW ones: they are what decides whether the buy
// panel's foil-pack row comes back for the next level's pack, and whether the
// Buy button quotes the level the contract will actually charge.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeTicketLevel,
  foilPackDisplayLevel,
  JACKPOT_LEVEL_CAP,
} from '../active-level.js';

const state = (over = {}) => ({
  level: 25,
  jackpotPhaseFlag: true,
  phaseTransitionActive: false,
  rngLockedFlag: false,
  jackpotCounter: 0,
  ...over,
});

describe('activeTicketLevel — port of _activeTicketLevel()', () => {
  test('no usable level → null (unknown, NOT level 0)', () => {
    assert.equal(activeTicketLevel(null), null);
    assert.equal(activeTicketLevel({}), null);
    assert.equal(activeTicketLevel({ level: 'x' }), null);
  });

  test('purchase phase → level + 1', () => {
    assert.equal(activeTicketLevel(state({ jackpotPhaseFlag: false })), 26);
  });

  test('phase string fallback when jackpotPhaseFlag is absent', () => {
    assert.equal(activeTicketLevel({ level: 25, phase: 'JACKPOT' }), 25);
    assert.equal(activeTicketLevel({ level: 25, phase: 'MINT' }), 26);
  });

  test('jackpot phase, mid-phase → current level', () => {
    assert.equal(activeTicketLevel(state({ jackpotCounter: 2 })), 25);
  });

  // --- The two sealed-window branches the old inline shorthand missed. ---

  test('phaseTransitionActive → level + 1 even in jackpot phase', () => {
    assert.equal(activeTicketLevel(state({ phaseTransitionActive: true })), 26);
  });

  test('rngLocked on the final jackpot day → level + 1', () => {
    const cnt = JACKPOT_LEVEL_CAP - 1;   // step 1 → cnt + 1 >= CAP
    assert.equal(activeTicketLevel(state({ rngLockedFlag: true, jackpotCounter: cnt })), 26);
  });

  test('rngLocked but NOT the final day → still the current level', () => {
    assert.equal(activeTicketLevel(state({ rngLockedFlag: true, jackpotCounter: 1 })), 25);
  });

  test('compressed=2 → step is the full cap, so any rngLocked day seals', () => {
    assert.equal(
      activeTicketLevel(state({ rngLockedFlag: true, jackpotCounter: 0, compressedJackpotFlag: 2 })),
      26,
    );
  });

  test('compressed=1 mid-phase → step 2', () => {
    const cnt = JACKPOT_LEVEL_CAP - 2;   // step 2 → cnt + 2 >= CAP
    assert.equal(
      activeTicketLevel(state({ rngLockedFlag: true, jackpotCounter: cnt, compressedJackpotFlag: 1 })),
      26,
    );
    assert.equal(
      activeTicketLevel(state({ rngLockedFlag: true, jackpotCounter: 1, compressedJackpotFlag: 1 })),
      25,
    );
  });

  test('absent compressedJackpotFlag behaves as uncompressed (step 1)', () => {
    // Conservative default: under-fires rather than advancing the level early.
    assert.equal(activeTicketLevel(state({ rngLockedFlag: true, jackpotCounter: 2 })), 25);
  });

  test('direct compressed cadence fixes a stale /game/state final lock', () => {
    const stale = state({ rngLockedFlag: false, jackpotCounter: 0 });
    assert.equal(activeTicketLevel(stale, {
      level: 25,
      jackpot: true,
      rngLocked: true,
      day: 3,
      compressedFlag: 1,
    }), 26);
    assert.equal(activeTicketLevel(stale, {
      level: 25,
      jackpot: true,
      rngLocked: false,
      day: 3,
      compressedFlag: 1,
    }), 25);
  });

  // The gold-rush slot0 decode (polling.js:333) spells the counter
  // `jackpotCounter`; only the parimutuel benchmark spells it `day`. Reading
  // just `day` pinned cnt to 0 for every chain-ticker-driven caller, so the
  // sealed final-window promotion could fire only on a turbo — the one tier
  // whose step alone reaches the cap from zero.
  test('the chain decode counter is read under its own field name', () => {
    const stale = state({ rngLockedFlag: false, jackpotCounter: 0 });
    assert.equal(activeTicketLevel(stale, {
      level: 25,
      jackpot: true,
      rngLocked: true,
      jackpotCounter: 4,
      compressedFlag: 0,
    }), 26, 'the final normal day seals and routes buys forward');
    assert.equal(activeTicketLevel(stale, {
      level: 25,
      jackpot: true,
      rngLocked: true,
      jackpotCounter: 3,
      compressedFlag: 0,
    }), 25, 'day four of five is not yet sealed');
  });

  test('an unknown direct tier falls back to /game/state rather than to normal', () => {
    // readJackpotPhaseContext() now reports null when jackpotCompressionTier()
    // fails; the port must not read that as a real tier 0.
    assert.equal(activeTicketLevel(
      state({ rngLockedFlag: true, jackpotCounter: 0, compressedJackpotFlag: 2 }),
      { level: 25, jackpot: true, rngLocked: true, day: 0, compressedFlag: null },
    ), 26, 'the turbo known to /game/state still seals the level');
  });

  test('a stale direct snapshot from another level is ignored', () => {
    assert.equal(activeTicketLevel(
      state({ rngLockedFlag: false, jackpotCounter: 1 }),
      { level: 24, jackpot: false, rngLocked: true, day: 4, compressedFlag: 0 },
    ), 25);
  });

  test('the target never goes backwards across a normal cycle', () => {
    const seen = [
      activeTicketLevel({ level: 24, jackpotPhaseFlag: false }),                 // L24 purchase
      activeTicketLevel({ level: 25, jackpotPhaseFlag: true, jackpotCounter: 0 }), // L25 jackpot
      activeTicketLevel({ level: 25, jackpotPhaseFlag: true, rngLockedFlag: true, jackpotCounter: 4 }),
      activeTicketLevel({ level: 25, jackpotPhaseFlag: false }),                 // L25 purchase
      activeTicketLevel({ level: 26, jackpotPhaseFlag: true, jackpotCounter: 0 }), // L26 jackpot
    ];
    assert.deepEqual(seen, [25, 25, 26, 26, 26]);
  });
});

describe('foilPackDisplayLevel — Daily Drawing presentation cadence', () => {
  test('keeps level 45 visible for the full level 45 jackpot, including final RNG lock', () => {
    assert.equal(foilPackDisplayLevel(state({
      level: 45,
      rngLockedFlag: true,
      jackpotCounter: JACKPOT_LEVEL_CAP - 1,
    })), 45);
  });

  test('moves to the next pack only when the jackpot end-phase transition starts', () => {
    assert.equal(foilPackDisplayLevel(state({
      level: 45,
      rngLockedFlag: true,
      jackpotCounter: JACKPOT_LEVEL_CAP - 1,
      phaseTransitionActive: true,
    })), 46);
  });

  test('purchase phase still previews the incoming level pack', () => {
    assert.equal(foilPackDisplayLevel({
      level: 45,
      phase: 'PURCHASE',
      jackpotPhaseFlag: false,
      phaseTransitionActive: false,
    }), 46);
  });

  test('explicit live jackpot state wins over a stale same-level side poll', () => {
    assert.equal(foilPackDisplayLevel(state({ level: 45 }), {
      level: 45,
      jackpot: false,
      rngLocked: true,
      day: 4,
    }), 45);
  });
});
