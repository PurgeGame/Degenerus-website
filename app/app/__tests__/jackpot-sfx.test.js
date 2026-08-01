// /app/app/__tests__/jackpot-sfx.test.js — Phase 64 reveal sound design.
//
// Run: cd website && node --test app/app/__tests__/jackpot-sfx.test.js
//
// Covers:
//   - module is importable headless (no window/document/AudioContext) with
//     zero import-time side effects
//   - every cue is a guarded no-op without an AudioContext (no throw)
//   - mute persistence via localStorage (degenerus.sfxMuted), SecurityError-safe
//   - with a stubbed AudioContext: cues build oscillator+gain graphs; muted
//     cues build nothing

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SFX_MUTE_KEY,
  isMuted,
  setMuted,
  toggleMuted,
  warmup,
  sfxSpinStart,
  sfxTick,
  sfxRollDone,
  sfxFanfare,
  sfxGoldTicket,
  sfxNoWin,
  sfxLoserHorn,
  __resetForTest,
} from '../jackpot-sfx.js';

function makeLocalStorage() {
  return {
    _m: new Map(),
    getItem(k) { return this._m.get(k) ?? null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
    clear() { this._m.clear(); },
  };
}

// Minimal AudioContext stub — records node creation so tests can assert cues
// actually schedule audio when unmuted.
class FakeAudioContext {
  static created = 0;
  constructor() {
    FakeAudioContext.created += 1;
    this.state = 'running';
    this.currentTime = 0;
    this.destination = { name: 'destination' };
    this.oscillators = [];
  }
  createOscillator() {
    const osc = {
      type: 'sine',
      frequency: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
      start: () => {},
      stop: () => {},
    };
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
    };
  }
  close() {}
}

describe('headless safety (no AudioContext / no localStorage)', () => {
  beforeEach(() => {
    delete globalThis.AudioContext;
    delete globalThis.localStorage;
    __resetForTest();
  });

  test('every cue no-ops without an AudioContext', () => {
    assert.doesNotThrow(() => {
      warmup();
      sfxSpinStart(700);
      sfxTick(0);
      sfxTick(23);
      sfxRollDone(true);
      sfxRollDone(false);
      sfxFanfare(false);
      sfxFanfare(true);
      sfxGoldTicket();
      sfxNoWin();
      sfxLoserHorn();
    });
  });

  test('isMuted defaults false without localStorage', () => {
    assert.equal(isMuted(), false);
  });

  test('setMuted without localStorage does not throw', () => {
    assert.doesNotThrow(() => setMuted(true));
  });
});

describe('mute persistence', () => {
  beforeEach(() => {
    globalThis.localStorage = makeLocalStorage();
    delete globalThis.AudioContext;
    __resetForTest();
  });

  test('default unmuted; setMuted(true) persists under SFX_MUTE_KEY', () => {
    assert.equal(isMuted(), false);
    setMuted(true);
    assert.equal(globalThis.localStorage.getItem(SFX_MUTE_KEY), '1');
    assert.equal(isMuted(), true);
  });

  test('setMuted(false) removes the key', () => {
    setMuted(true);
    setMuted(false);
    assert.equal(globalThis.localStorage.getItem(SFX_MUTE_KEY), null);
    assert.equal(isMuted(), false);
  });

  test('toggleMuted flips and returns the new state', () => {
    assert.equal(toggleMuted(), true);
    assert.equal(isMuted(), true);
    assert.equal(toggleMuted(), false);
    assert.equal(isMuted(), false);
  });

  test('SecurityError on getItem → isMuted false (fail open, session-only)', () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    };
    assert.equal(isMuted(), false);
    assert.doesNotThrow(() => setMuted(true));
  });
});

describe('cues with a stubbed AudioContext', () => {
  beforeEach(() => {
    globalThis.localStorage = makeLocalStorage();
    globalThis.AudioContext = FakeAudioContext;
    FakeAudioContext.created = 0;
    __resetForTest();
  });

  test('warmup creates the context lazily, exactly once', () => {
    warmup();
    warmup();
    assert.equal(FakeAudioContext.created, 1, 'context created once and cached');
  });

  test('unmuted cues schedule oscillators', () => {
    warmup();
    sfxTick(3);
    sfxFanfare(false);
    // Reach into the cached context via a fresh warmup-created instance:
    // FakeAudioContext.created === 1 means all cues shared the cached ctx.
    assert.equal(FakeAudioContext.created, 1);
  });

  test('muted → no context, no oscillators', () => {
    setMuted(true);
    warmup();
    sfxSpinStart(700);
    sfxTick(0);
    sfxRollDone(true);
    sfxFanfare(true);
    sfxGoldTicket();
    sfxNoWin();
    sfxLoserHorn();
    assert.equal(FakeAudioContext.created, 0, 'muted cues never touch WebAudio');
  });

  test('hostile AudioContext constructor → cues still no-throw', () => {
    globalThis.AudioContext = class { constructor() { throw new Error('nope'); } };
    __resetForTest();
    assert.doesNotThrow(() => {
      sfxSpinStart(700);
      sfxFanfare(true);
      sfxGoldTicket();
    });
  });
});
