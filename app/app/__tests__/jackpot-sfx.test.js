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
import fs from 'node:fs';

import {
  SFX_MUTE_KEY,
  CRAPS_CHIP_SAMPLE_PATHS,
  isMuted,
  setMuted,
  toggleMuted,
  warmup,
  preloadCrapsChipSamples,
  sfxSpinStart,
  sfxTick,
  sfxMatchLock,
  sfxRollDone,
  sfxFanfare,
  sfxGoldTicket,
  sfxNoWin,
  sfxLoserHorn,
  sfxCoinflipStart,
  sfxCoinflipWhoosh,
  sfxReverseBonk,
  sfxCoinflipTurn,
  sfxCoinflipLand,
  sfxQuestComplete,
  sfxCrapsBetPlace,
  sfxCrapsBonusShooter,
  sfxCrapsDiceTick,
  sfxCrapsDiceLand,
  sfxCrapsDouble,
  sfxCrapsSettlement,
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
  static last = null;
  constructor() {
    FakeAudioContext.created += 1;
    FakeAudioContext.last = this;
    this.state = 'running';
    this.currentTime = 0;
    this.destination = { name: 'destination' };
    this.oscillators = [];
  }
  createOscillator() {
    const osc = {
      type: 'sine',
      frequency: {
        values: [],
        ramps: [],
        setValueAtTime(value, at) { this.values.push({ value, at }); },
        exponentialRampToValueAtTime(value, at) { this.ramps.push({ value, at }); },
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

class FakeNoiseAudioContext extends FakeAudioContext {
  constructor() {
    super();
    this.sampleRate = 44_100;
    this.bufferSources = [];
    this.filters = [];
  }
  createBuffer(_channels, length, sampleRate) {
    const data = new Float32Array(length);
    return {
      length,
      sampleRate,
      getChannelData: () => data,
    };
  }
  createBufferSource() {
    const source = {
      buffer: null,
      connect: () => {},
      start: () => {},
      stop: () => {},
    };
    this.bufferSources.push(source);
    return source;
  }
  createBiquadFilter() {
    const makeParam = () => ({
      values: [],
      ramps: [],
      setValueAtTime(value, at) { this.values.push({ value, at }); },
      exponentialRampToValueAtTime(value, at) { this.ramps.push({ value, at }); },
    });
    const filter = {
      type: 'lowpass',
      Q: makeParam(),
      frequency: makeParam(),
      connect: () => {},
    };
    this.filters.push(filter);
    return filter;
  }
}

class FakeSampleAudioContext extends FakeNoiseAudioContext {
  constructor() {
    super();
    this.decoded = [];
  }
  decodeAudioData(bytes) {
    const buffer = { duration: 0.64, byteLength: bytes.byteLength };
    this.decoded.push(buffer);
    return Promise.resolve(buffer);
  }
  createBufferSource() {
    const source = super.createBufferSource();
    source.starts = [];
    source.playbackRate = {
      values: [],
      setValueAtTime(value, at) { this.values.push({ value, at }); },
    };
    source.start = (...args) => source.starts.push(args);
    return source;
  }
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
      sfxMatchLock('color', 0);
      sfxMatchLock('symbol', 4);
      sfxMatchLock('both', 7);
      sfxRollDone(true);
      sfxRollDone(false);
      sfxFanfare(false);
      sfxFanfare(true);
      sfxGoldTicket();
      sfxNoWin();
      sfxLoserHorn();
      sfxCoinflipStart();
      sfxCoinflipWhoosh(0.8, true);
      sfxReverseBonk();
      sfxCoinflipTurn(true, 2);
      sfxCoinflipTurn(false, 1);
      sfxCoinflipLand(true);
      sfxCoinflipLand(false);
      sfxQuestComplete();
      sfxCrapsBetPlace();
      sfxCrapsBonusShooter();
      sfxCrapsDiceTick(2, 17);
      sfxCrapsDiceLand({ total: 7, sevenOutcome: 'win' });
      sfxCrapsDouble();
      sfxCrapsSettlement('opponent');
      sfxCrapsSettlement('sweep');
    });
  });

  test('isMuted defaults false without localStorage', () => {
    assert.equal(isMuted(), false);
  });

  test('setMuted without localStorage does not throw', () => {
    assert.doesNotThrow(() => setMuted(true));
  });

  test('sample preloading is a guarded no-op without a browser', async () => {
    assert.equal(await preloadCrapsChipSamples(), false);
  });
});

test('the real CC0 craps chip recordings ship with the app', () => {
  for (const assetPath of Object.values(CRAPS_CHIP_SAMPLE_PATHS)) {
    const assetUrl = new URL(`../../${assetPath.slice('/app/'.length)}`, import.meta.url);
    assert.ok(fs.statSync(assetUrl).size > 2_000, `${assetPath} contains recorded audio`);
  }
  assert.ok(fs.readFileSync(new URL('../../sounds/craps/LICENSE.md', import.meta.url), 'utf8').includes('CC0'));
});

test('decoded recordings replace the synthesized chip fallback', async () => {
  const fetched = [];
  globalThis.localStorage = makeLocalStorage();
  globalThis.window = {};
  globalThis.fetch = async (path) => {
    fetched.push(path);
    return {
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    };
  };
  globalThis.AudioContext = FakeSampleAudioContext;
  __resetForTest();

  try {
    assert.equal(await preloadCrapsChipSamples(), true);
    warmup();
    await new Promise((resolve) => setImmediate(resolve));

    const ctx = FakeAudioContext.last;
    assert.deepEqual(fetched, Object.values(CRAPS_CHIP_SAMPLE_PATHS));
    assert.equal(ctx.decoded.length, 2, 'both chip recordings decode once');

    sfxCrapsSettlement('collect');
    assert.equal(ctx.bufferSources.length, 2, 'local payout layers two real recordings');
    assert.equal(ctx.oscillators.length, 0, 'the synthesized fallback stays silent');

    sfxCrapsSettlement('opponent');
    assert.equal(ctx.bufferSources.length, 3, 'opponent payout uses its quieter recording');
    sfxCrapsBetPlace();
    assert.equal(ctx.bufferSources.length, 4, 'bet placement uses a short recorded contact');
    sfxCrapsDouble();
    assert.equal(ctx.bufferSources.length, 6, 'doubling plays the physical one-to-two stack rhythm');
  } finally {
    __resetForTest();
    delete globalThis.window;
    delete globalThis.fetch;
    delete globalThis.AudioContext;
    delete globalThis.localStorage;
  }
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
    FakeAudioContext.last = null;
    __resetForTest();
  });

  test('warmup creates the context lazily, exactly once', () => {
    warmup();
    warmup();
    assert.equal(FakeAudioContext.created, 1, 'context created once and cached');
  });

  test('color, symbol, and both matches schedule audibly distinct cues', () => {
    warmup();
    const before = FakeAudioContext.last.oscillators.length;
    sfxTick(3);
    const afterTick = FakeAudioContext.last.oscillators.length;
    sfxMatchLock('color', 3);
    const afterColor = FakeAudioContext.last.oscillators.length;
    sfxMatchLock('symbol', 3);
    const afterSymbol = FakeAudioContext.last.oscillators.length;
    sfxMatchLock('both', 3);
    const afterBoth = FakeAudioContext.last.oscillators.length;
    sfxFanfare(false);
    // Reach into the cached context via a fresh warmup-created instance:
    // FakeAudioContext.created === 1 means all cues shared the cached ctx.
    assert.equal(FakeAudioContext.created, 1);
    assert.equal(afterTick - before, 1, 'ordinary lock is one mechanical tick');
    assert.equal(afterColor - afterTick, 1,
      'a color-only match is a soft provisional note');
    assert.equal(afterSymbol - afterColor, 2,
      'a scoring symbol match has the brighter layered cue');
    assert.equal(afterBoth - afterSymbol, 3,
      'a completed color-and-symbol match has a three-note chord');

    const oscillators = FakeAudioContext.last.oscillators;
    const colorCue = oscillators.slice(afterTick, afterColor);
    const symbolCue = oscillators.slice(afterColor, afterSymbol);
    const bothCue = oscillators.slice(afterSymbol, afterBoth);
    assert.equal(colorCue[0].type, 'triangle');
    assert.deepEqual(symbolCue.map((osc) => osc.type), ['square', 'sine']);
    assert.deepEqual(bothCue.map((osc) => osc.type), ['square', 'sine', 'triangle']);
    assert.ok(colorCue[0].frequency.values[0].value
      < symbolCue[0].frequency.values[0].value,
    'the provisional color note sits below the symbol cue');
  });

  test('coinflip launch, whoosh, Reverse bonk, turn, and landings have distinct layered cues', () => {
    warmup();
    const counts = [];
    const sample = (cue) => {
      const before = FakeAudioContext.last.oscillators.length;
      cue();
      counts.push(FakeAudioContext.last.oscillators.length - before);
    };
    sample(() => sfxCoinflipStart());
    sample(() => sfxCoinflipWhoosh(0.8, true));
    sample(() => sfxReverseBonk());
    sample(() => sfxCoinflipTurn(true, 1));
    sample(() => sfxCoinflipTurn(false, 2));
    sample(() => sfxCoinflipLand(true));
    sample(() => sfxCoinflipLand(false));
    assert.deepEqual(counts, [3, 2, 3, 2, 2, 4, 2]);
  });

  test('Reverse bonk uses a filtered contact transient and damped thock body', () => {
    globalThis.AudioContext = FakeNoiseAudioContext;
    __resetForTest();
    warmup();
    sfxReverseBonk();

    const ctx = FakeAudioContext.last;
    assert.equal(ctx.bufferSources.length, 1, 'one broadband contact transient');
    assert.equal(ctx.filters.length, 1, 'contact transient is filtered');
    assert.equal(ctx.filters[0].type, 'lowpass');
    assert.equal(ctx.filters[0].frequency.values[0].value, 2_400,
      'impact starts with a crisp wooden edge');
    assert.equal(ctx.filters[0].frequency.ramps[0].value, 760,
      'edge rapidly damps into the body');
    assert.deepEqual(ctx.oscillators.map((osc) => osc.type), ['sine', 'triangle', 'sine'],
      'body avoids the former harsh square-wave chirp');
    assert.deepEqual(
      ctx.oscillators.map((osc) => osc.frequency.values[0].value),
      [168, 410, 1_180],
      'low body, wood resonance, and short knock partial are layered');
  });

  test('quest completion is a small two-note chime', () => {
    warmup();
    const before = FakeAudioContext.last.oscillators.length;
    sfxQuestComplete();
    assert.equal(FakeAudioContext.last.oscillators.length - before, 2);
  });

  test('every craps total has a distinct result pitch', () => {
    warmup();
    const pitches = [];
    const landingBodies = [];
    for (let total = 2; total <= 12; total += 1) {
      const before = FakeAudioContext.last.oscillators.length;
      sfxCrapsDiceLand({ total });
      const cue = FakeAudioContext.last.oscillators.slice(before);
      assert.equal(cue.length, 4, `total ${total} has one tone after the three-part landing`);
      landingBodies.push(cue[0].frequency.values[0].value);
      pitches.push(cue.at(-1).frequency.values[0].value);
    }
    assert.equal(new Set(landingBodies).size, 11,
      'the physical completion beat itself is subtly tuned for every total');
    assert.equal(new Set(pitches).size, 11, 'totals 2–12 have eleven different tones');
    assert.ok(pitches.every((pitch, index) => index === 0 || pitch > pitches[index - 1]),
      'the outcome palette rises consistently with the dice total');
  });

  test('craps roll, landing, seven, and table-action cues stay short and distinct', () => {
    warmup();
    const sample = (cue) => {
      const before = FakeAudioContext.last.oscillators.length;
      cue();
      return FakeAudioContext.last.oscillators.length - before;
    };
    assert.equal(sample(() => sfxCrapsDiceTick(2, 17)), 1,
      'a motion clack has one damped resin body');
    assert.equal(sample(() => sfxCrapsDiceLand()), 3,
      'an ordinary landing stays physical rather than musical');
    assert.equal(sample(() => sfxCrapsDiceLand({ total: 7, sevenOutcome: 'win' })), 6,
      'a come-out seven adds its total tone and a two-note rise');
    assert.equal(sample(() => sfxCrapsDiceLand({ total: 7, sevenOutcome: 'crap-out' })), 6,
      'seven-out adds its total tone and a two-note fall');
    assert.equal(sample(() => sfxCrapsSettlement('collect')), 3,
      'a whole payout is one three-click ceramic cue');
    assert.equal(sample(() => sfxCrapsSettlement('opponent')), 2,
      'an opponent payout is a darker two-click cue');
    assert.equal(sample(() => sfxCrapsSettlement('sweep')), 2,
      'a whole loss is one scrape with two falling chip bodies');
    assert.equal(sample(() => sfxCrapsBetPlace()), 1,
      'placing bets is a single felt-muted chip contact');
    assert.equal(sample(() => sfxCrapsDouble()), 3,
      'doubling speaks as one stack becoming two');
    assert.equal(sample(() => sfxCrapsBonusShooter()), 3,
      'bonus shooter has its own three-part metallic badge cue');
  });

  test('payouts use broadband chip impacts instead of bare beeps', () => {
    globalThis.AudioContext = FakeNoiseAudioContext;
    __resetForTest();
    warmup();
    sfxCrapsSettlement('collect');
    const localNoiseCount = FakeAudioContext.last.bufferSources.length;
    const localFrequencies = FakeAudioContext.last.oscillators
      .map((osc) => osc.frequency.values[0].value);
    sfxCrapsSettlement('opponent');
    const opponentNoiseCount = FakeAudioContext.last.bufferSources.length - localNoiseCount;
    const opponentFrequencies = FakeAudioContext.last.oscillators
      .slice(localFrequencies.length)
      .map((osc) => osc.frequency.values[0].value);
    assert.equal(localNoiseCount, 3, 'the local rack gets three ceramic transients');
    assert.equal(opponentNoiseCount, 2, 'the opponent rack gets two ceramic transients');
    assert.ok(Math.max(...opponentFrequencies) < Math.min(...localFrequencies),
      'opponent chips are audibly darker than local chips');
  });

  test('payout impact weight scales through small, medium, large, and huge chip wins', () => {
    warmup();
    const contacts = (chips) => {
      const before = FakeAudioContext.last.oscillators.length;
      sfxCrapsSettlement('collect', chips);
      return FakeAudioContext.last.oscillators.length - before;
    };
    assert.deepEqual(
      [contacts(1), contacts(6), contacts(18), contacts(64)],
      [1, 3, 5, 7],
      'one table-level cue gains ceramic contacts instead of playing once per chip',
    );
  });

  test('muted → no context, no oscillators', () => {
    setMuted(true);
    warmup();
    sfxSpinStart(700);
    sfxTick(0);
    sfxMatchLock('both', 0);
    sfxRollDone(true);
    sfxFanfare(true);
    sfxGoldTicket();
    sfxNoWin();
    sfxLoserHorn();
    sfxCoinflipStart();
    sfxCoinflipWhoosh();
    sfxReverseBonk();
    sfxCoinflipTurn(true, 1);
    sfxCoinflipLand(false);
    sfxQuestComplete();
    sfxCrapsBetPlace();
    sfxCrapsBonusShooter();
    sfxCrapsDiceTick(0, 9);
    sfxCrapsDiceLand({ total: 7, sevenOutcome: 'crap-out' });
    sfxCrapsDouble();
    sfxCrapsSettlement('opponent');
    sfxCrapsSettlement('collect');
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
