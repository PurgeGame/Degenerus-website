// /app/app/jackpot-sfx.js — Phase 64 jackpot reveal sound design.
//
// WebAudio-synthesized cues (no audio files), ported in spirit from the GT
// paper's interactive demo (theory/index.html sfxTick/sfxLock/sfxAllLocked/
// sfxFanfare, ~lines 1677-1830): oscillator + gain envelopes only.
//
// Cues:
//   sfxSpinStart(ms)   — low anticipation riser while the flame spins
//   sfxTick(i)         — short blip per revealed row, pitch rises with index
//   sfxMatchLock(kind, i) — distinct DGN color / symbol / full-match lock cue
//   sfxRollDone(good)  — lock stinger when a roll completes (two-tone if good)
//   sfxFanfare(big)    — win arpeggio; `big` = the viewed player won
//   sfxGoldTicket()     — bright harmonic hit for a gold-trait ticket
//   sfxNoWin()         — soft descending tone (no winners, pot rolls)
//   sfxLoserHorn()     — comic brass fall for the 1-WWXRP consolation
//   sfxCoinflipStart() — metallic launch as the daily coin leaves idle spin
//   sfxCoinflipWhoosh()— neutral motion sweep keyed to the coin choreography
//   sfxCoinflipTurn()  — lighter face-change / Reverse-card impact
//   sfxReverseBonk()   — heavy outcome-neutral Reverse-card contact
//   sfxCoinflipLand()  — authoritative green-win or red-loss landing
//   sfxQuestComplete() — small two-note quest completion chime
//   sfxCrapsDiceTick() — optional restrained resin/felt motion clack
//   sfxCrapsDiceLand() — one impact → 2–12 total tone → wager-relative result tone
//   sfxCrapsSettlement() — local/opponent chip clacks or a felt sweep
//   sfxCrapsBetPlace() — one chip contacting the felt
//   sfxCrapsDouble() — a one-stack-to-two-stacks physical flourish
//   sfxCrapsBonusShooter() — short metallic bonus badge reveal
//
// Headless-safe: importable under node:test with no window/document/
// AudioContext defined — every cue no-ops when the context can't be built.
// Autoplay-safe: the AudioContext is created/resumed lazily; callers invoke
// warmup() from a user gesture (the Replay click) before cues fire.
//
// Mute is persisted in localStorage (degenerus.sfxMuted = '1'); default unmuted.

export const SFX_MUTE_KEY = 'degenerus.sfxMuted';

export function isMuted() {
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(SFX_MUTE_KEY) === '1';
  } catch (_e) {
    return false; // private browsing — default unmuted, nothing persists
  }
}

export function setMuted(muted) {
  try {
    if (muted) localStorage.setItem(SFX_MUTE_KEY, '1');
    else localStorage.removeItem(SFX_MUTE_KEY);
  } catch (_e) { /* QuotaExceededError / SecurityError — session-only mute */ }
}

export function toggleMuted() {
  const next = !isMuted();
  setMuted(next);
  return next;
}

// ---------------------------------------------------------------------------
// Lazy AudioContext — created on first (unmuted) use, resumed if suspended.
// ---------------------------------------------------------------------------

let _audioCtx = null;

export const CRAPS_CHIP_SAMPLE_PATHS = Object.freeze({
  clay: '/app/sounds/craps/poker-chips-clay-cc0.mp3',
  smallBet: '/app/sounds/craps/poker-chips-small-bet-cc0.mp3',
});

const _crapsChipEncoded = new Map();
const _crapsChipBuffers = new Map();
let _crapsChipFetchPromise = null;
let _crapsChipLoadPromise = null;

function _ctx() {
  if (isMuted()) return null;
  try {
    const AC = (typeof AudioContext !== 'undefined')
      ? AudioContext
      : (typeof window !== 'undefined' && window.webkitAudioContext)
        ? window.webkitAudioContext
        : null;
    if (!AC) return null;
    if (!_audioCtx) _audioCtx = new AC();
    if (_audioCtx.state === 'suspended' && typeof _audioCtx.resume === 'function') {
      _audioCtx.resume().catch?.(() => {});
    }
    return _audioCtx;
  } catch (_e) {
    return null;
  }
}

/** warmup — call from a user gesture so iOS/Safari unlocks the context. */
export function warmup() {
  if (isMuted()) return;
  const ctx = _ctx();
  if (ctx && typeof window !== 'undefined') void _loadCrapsChipSamples(ctx);
}

/** Fetch the tiny CC0 chip recordings without creating an AudioContext. */
export function preloadCrapsChipSamples() {
  if (isMuted() || typeof window === 'undefined' || typeof fetch !== 'function') {
    return Promise.resolve(false);
  }
  if (_crapsChipEncoded.size === Object.keys(CRAPS_CHIP_SAMPLE_PATHS).length) {
    return Promise.resolve(true);
  }
  if (_crapsChipFetchPromise) return _crapsChipFetchPromise;
  _crapsChipFetchPromise = Promise.all(Object.entries(CRAPS_CHIP_SAMPLE_PATHS).map(
    async ([name, path]) => {
      try {
        const response = await fetch(path);
        if (!response.ok) return false;
        const bytes = await response.arrayBuffer();
        if (!bytes?.byteLength) return false;
        _crapsChipEncoded.set(name, bytes);
        return true;
      } catch (_error) {
        return false;
      }
    },
  )).then((results) => results.some(Boolean));
  return _crapsChipFetchPromise;
}

async function _loadCrapsChipSamples(ctx) {
  if (!ctx || typeof ctx.decodeAudioData !== 'function') return false;
  if (_crapsChipBuffers.size === Object.keys(CRAPS_CHIP_SAMPLE_PATHS).length) return true;
  if (_crapsChipLoadPromise) return _crapsChipLoadPromise;
  _crapsChipLoadPromise = (async () => {
    await preloadCrapsChipSamples();
    for (const [name, bytes] of _crapsChipEncoded) {
      if (_crapsChipBuffers.has(name)) continue;
      try {
        const buffer = await ctx.decodeAudioData(bytes.slice(0));
        if (buffer) _crapsChipBuffers.set(name, buffer);
      } catch (_error) { /* the synthesized physical fallback remains available */ }
    }
    return _crapsChipBuffers.size > 0;
  })();
  return _crapsChipLoadPromise;
}

// One-shot oscillator envelope: attack to `peak`, exponential decay to
// silence. Optional frequency glide freq → glideTo over the decay window.
function _connectWithPan(ctx, node, pan = 0) {
  const position = Math.max(-1, Math.min(1, Number(pan) || 0));
  if (position !== 0 && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    if (typeof panner.pan?.setValueAtTime === 'function') {
      panner.pan.setValueAtTime(position, ctx.currentTime);
    } else if (panner.pan) panner.pan.value = position;
    node.connect(panner);
    panner.connect(ctx.destination);
    return;
  }
  node.connect(ctx.destination);
}

function _tone(ctx, {
  freq = 440,
  glideTo = null,
  type = 'sine',
  at = 0,
  attack = 0.005,
  decay = 0.15,
  peak = 0.2,
  pan = 0,
}) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + at;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + attack + decay);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  osc.connect(gain);
  _connectWithPan(ctx, gain, pan);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.05);
}

function _playCrapsChipSample(ctx, name, {
  at = 0,
  gain: level = 0.42,
  playbackRate = 1,
  pan = 0,
  offset = 0,
  duration = null,
} = {}) {
  const buffer = _crapsChipBuffers.get(name);
  if (!buffer || typeof ctx.createBufferSource !== 'function') {
    if (typeof window !== 'undefined') void _loadCrapsChipSamples(ctx);
    return false;
  }
  try {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + Math.max(0, Number(at) || 0);
    source.buffer = buffer;
    const rate = Math.max(0.5, Math.min(1.6, Number(playbackRate) || 1));
    if (typeof source.playbackRate?.setValueAtTime === 'function') {
      source.playbackRate.setValueAtTime(rate, t0);
    } else if (source.playbackRate) source.playbackRate.value = rate;
    gain.gain.setValueAtTime(Math.max(0.0001, Number(level) || 0.42), t0);
    source.connect(gain);
    _connectWithPan(ctx, gain, pan);
    const startOffset = Math.max(0, Number(offset) || 0);
    const playDuration = Number(duration);
    if (Number.isFinite(playDuration) && playDuration > 0) {
      source.start(t0, startOffset, playDuration);
    } else source.start(t0, startOffset);
    return true;
  } catch (_error) {
    return false;
  }
}

// Scheduled filtered noise for tiny physical contacts and felt movement. The
// oscillator layer remains the fallback on older WebAudio implementations.
function _filteredNoise(ctx, {
  at = 0,
  duration = 0.05,
  type = 'bandpass',
  from = 1_600,
  to = 700,
  q = 0.8,
  peak = 0.04,
  pan = 0,
} = {}) {
  if (typeof ctx.createBuffer !== 'function'
    || typeof ctx.createBufferSource !== 'function'
    || typeof ctx.createBiquadFilter !== 'function') return false;
  const sampleRate = Math.max(8_000, Number(ctx.sampleRate) || 44_100);
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = (Math.random() * 2) - 1;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + Math.max(0, Number(at) || 0);
  source.buffer = buffer;
  filter.type = type;
  filter.Q.setValueAtTime(q, t0);
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + duration);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.004, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  source.connect(filter);
  filter.connect(gain);
  _connectWithPan(ctx, gain, pan);
  source.start(t0);
  source.stop(t0 + duration + 0.01);
  return true;
}

function _cueVariation(...values) {
  let hash = 2_166_136_261;
  const input = values.map((value) => String(value ?? '')).join(':');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) / 0xffff_ffff) * 2 - 1;
}

// Each possible two-dice total owns one pitch in an ascending pentatonic
// palette. The broad range keeps neighboring totals recognizable while each
// note remains short enough to stay subordinate to the physical dice landing.
const CRAPS_DICE_TOTAL_TONES = Object.freeze({
  2: 220,
  3: 261.63,
  4: 293.66,
  5: 329.63,
  6: 392,
  7: 440,
  8: 523.25,
  9: 587.33,
  10: 659.25,
  11: 783.99,
  12: 880,
});

// The total answers “what rolled?”; this final contour answers “what did it
// do to me?” A rise, level hold, and fall remain legible after any total pitch.
const CRAPS_ROLL_OUTCOME_TONES = Object.freeze({
  win: Object.freeze({ freq: 783.99, glideTo: 987.77, type: 'triangle', peak: 0.075 }),
  push: Object.freeze({ freq: 349.23, glideTo: 349.23, type: 'sine', peak: 0.052 }),
  loss: Object.freeze({ freq: 246.94, glideTo: 164.81, type: 'triangle', peak: 0.07 }),
});

/**
 * Continuous result voice keyed to signed basis points of the live wager.
 * +10000 is a +100% result, -5000 is -50%; larger swings spread farther
 * from the neutral pitch on a logarithmic scale so outliers stay audible.
 */
export function crapsNetResultTone(netResultBps = 0) {
  const raw = Number(netResultBps);
  const bps = Number.isFinite(raw) ? Math.max(-1_000_000, Math.min(1_000_000, raw)) : 0;
  if (bps === 0) {
    return Object.freeze({ freq: 349.23, glideTo: 349.23, type: 'sine', peak: 0.052 });
  }
  const direction = Math.sign(bps);
  const ratio = Math.abs(bps) / 10_000;
  const octaves = Math.min(1.75, Math.log2(1 + ratio));
  const frequency = Math.max(103.83, Math.min(1_174.66, 349.23 * (2 ** (direction * octaves))));
  const contourSemitones = 1.5 + Math.min(4.5, ratio * 1.5);
  const glideTo = Math.max(
    82.41,
    Math.min(1_318.51, frequency * (2 ** (direction * contourSemitones / 12))),
  );
  return Object.freeze({
    freq: frequency,
    glideTo,
    type: 'triangle',
    peak: Math.min(0.09, 0.058 + Math.log2(1 + ratio) * 0.012),
  });
}

// Filtered-noise motion sweep. Older WebAudio shims (and the node:test stub)
// do not expose buffer/filter nodes, so callers can fall back to pitched air.
function _noiseWhoosh(ctx, { intensity = 0.6, reverse = false } = {}) {
  if (typeof ctx.createBuffer !== 'function'
    || typeof ctx.createBufferSource !== 'function'
    || typeof ctx.createBiquadFilter !== 'function') return false;
  const strength = Math.max(0.15, Math.min(1, Number(intensity) || 0.6));
  const duration = 0.16 + (strength * 0.12);
  const sampleRate = Math.max(8_000, Number(ctx.sampleRate) || 44_100);
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const phase = i / Math.max(1, length - 1);
    const envelope = Math.sin(Math.PI * phase) ** 1.5;
    data[i] = ((Math.random() * 2) - 1) * envelope;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.Q.setValueAtTime(0.75 + strength, now);
  const from = reverse ? 2_400 : 430;
  const to = reverse ? 430 : 2_400;
  filter.frequency.setValueAtTime(from, now);
  filter.frequency.exponentialRampToValueAtTime(to, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.045 + (strength * 0.055), now + duration * 0.34);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + duration + 0.02);
  return true;
}

// A very short, low-passed noise transient. Real impacts lead with broadband
// energy before the struck object's resonances bloom; without this layer a
// stack of oscillators reads as a game chirp instead of physical contact.
function _impactTransient(ctx, strength = 1) {
  if (typeof ctx.createBuffer !== 'function'
    || typeof ctx.createBufferSource !== 'function'
    || typeof ctx.createBiquadFilter !== 'function') return false;
  const duration = 0.055;
  const sampleRate = Math.max(8_000, Number(ctx.sampleRate) || 44_100);
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2) - 1;

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  source.buffer = buffer;
  filter.type = 'lowpass';
  filter.Q.setValueAtTime(0.8, now);
  filter.frequency.setValueAtTime(2_400, now);
  filter.frequency.exponentialRampToValueAtTime(760, now + duration);
  gain.gain.setValueAtTime(0.14 * strength, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + duration + 0.01);
  return true;
}

// ---------------------------------------------------------------------------
// Cues — every one is a guarded no-op when muted / no AudioContext.
// ---------------------------------------------------------------------------

export function sfxSpinStart(ms = 700) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    const dur = Math.max(0.2, ms / 1000);
    // Sawtooth riser + sub-sine layer — tension build while the flame rages.
    _tone(ctx, { freq: 90, glideTo: 340, type: 'sawtooth', attack: 0.02, decay: dur, peak: 0.06 });
    _tone(ctx, { freq: 45, glideTo: 170, type: 'sine', attack: 0.02, decay: dur, peak: 0.10 });
  } catch (_e) { /* never break the reveal over audio */ }
}

export function sfxTick(i = 0) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    // Rising pitch with reveal index — the GT demo's accelerando feel.
    _tone(ctx, { freq: 620 + (i % 24) * 28, type: 'square', attack: 0.002, decay: 0.05, peak: 0.09 });
  } catch (_e) { /* no-op */ }
}

/**
 * A Degenerette lock whose newly settled component matches the player's
 * ticket. All three cues share the escalating eight-note ladder, but their
 * weight mirrors scoring: color is a soft provisional note, symbol is the
 * brighter two-note scoring cue, and both is a three-note full-match chord.
 *
 * The numeric-only form remains supported as the former symbol cue so an old
 * cached caller cannot break during a rolling deployment.
 */
export function sfxMatchLock(kind = 'symbol', i = 0) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    let matchKind = kind;
    let index = i;
    if (typeof kind === 'number') {
      matchKind = 'symbol';
      index = kind;
    }
    if (matchKind !== 'color' && matchKind !== 'symbol' && matchKind !== 'both') {
      matchKind = 'symbol';
    }
    const ladder = [261.63, 293.66, 329.63, 349.23, 392, 440, 493.88, 523.25];
    const step = Math.max(0, Math.min(ladder.length - 1, Number(index) || 0));
    const root = ladder[step];

    if (matchKind === 'color') {
      _tone(ctx, {
        freq: root * 0.75,
        type: 'triangle',
        attack: 0.004,
        decay: 0.14,
        peak: 0.11,
      });
      return;
    }

    _tone(ctx, {
      freq: root,
      type: 'square',
      attack: 0.003,
      decay: 0.17,
      peak: 0.14,
    });
    _tone(ctx, {
      freq: root * 2,
      type: 'sine',
      at: 0.025,
      attack: 0.003,
      decay: 0.2,
      peak: 0.08,
    });
    if (matchKind === 'both') {
      _tone(ctx, {
        freq: root * 1.5,
        type: 'triangle',
        at: 0.012,
        attack: 0.003,
        decay: 0.24,
        peak: 0.11,
      });
    }
  } catch (_e) { /* audio is decoration */ }
}

export function sfxRollDone(good = true) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    if (good) {
      // Two-tone lock stinger (C5 → G5).
      _tone(ctx, { freq: 523.25, type: 'triangle', attack: 0.005, decay: 0.12, peak: 0.18 });
      _tone(ctx, { freq: 783.99, type: 'triangle', at: 0.09, attack: 0.005, decay: 0.18, peak: 0.18 });
    } else {
      _tone(ctx, { freq: 330, type: 'triangle', attack: 0.005, decay: 0.2, peak: 0.12 });
    }
  } catch (_e) { /* no-op */ }
}

export function sfxFanfare(big = false) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    // C-major arpeggio (C5 E5 G5 C6), 90ms stagger.
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      _tone(ctx, { freq: f, type: 'triangle', at: i * 0.09, attack: 0.005, decay: 0.3, peak: 0.2 });
    });
    if (big) {
      // The viewed player won — layer an upper octave + a long root swell.
      notes.forEach((f, i) => {
        _tone(ctx, { freq: f * 2, type: 'sine', at: 0.18 + i * 0.09, attack: 0.005, decay: 0.4, peak: 0.12 });
      });
      _tone(ctx, { freq: 261.63, type: 'sawtooth', at: 0.05, attack: 0.05, decay: 0.9, peak: 0.06 });
    }
  } catch (_e) { /* no-op */ }
}

export function sfxGoldTicket() {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    // A glassy high triad plus a low swell: deliberately unlike both the
    // ordinary deal tick and the generic win fanfare.
    [880, 1318.51, 1760].forEach((freq, i) => {
      _tone(ctx, {
        freq,
        type: 'sine',
        at: i * 0.065,
        attack: 0.004,
        decay: 0.5,
        peak: 0.16,
      });
    });
    _tone(ctx, {
      freq: 220,
      glideTo: 440,
      type: 'triangle',
      at: 0.02,
      attack: 0.035,
      decay: 0.75,
      peak: 0.1,
    });
  } catch (_e) { /* audio must never interrupt a reveal */ }
}

export function sfxNoWin() {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    // Soft descending "pot rolls over" tone (G4 → G3).
    _tone(ctx, { freq: 392, glideTo: 196, type: 'sine', attack: 0.01, decay: 0.45, peak: 0.10 });
  } catch (_e) { /* no-op */ }
}

/** Short synthesized "wah-wah" horn for the participation consolation. */
export function sfxLoserHorn() {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    [
      [349.23, 261.63],
      [311.13, 220.00],
      [261.63, 164.81],
    ].forEach(([freq, glideTo], i) => {
      _tone(ctx, {
        freq,
        glideTo,
        type: 'sawtooth',
        at: i * 0.24,
        attack: 0.025,
        decay: 0.34,
        peak: 0.055,
      });
      _tone(ctx, {
        freq: freq / 2,
        glideTo: glideTo / 2,
        type: 'triangle',
        at: i * 0.24,
        attack: 0.025,
        decay: 0.36,
        peak: 0.09,
      });
    });
  } catch (_e) { /* audio is decoration */ }
}

/** Metallic toss cue for the start of the daily coinflip choreography. */
export function sfxCoinflipStart() {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    // A short rising body plus a bright edge reads as a heavy coin leaving
    // the table without droning through the several-second reveal track.
    _tone(ctx, {
      freq: 105,
      glideTo: 520,
      type: 'sawtooth',
      attack: 0.012,
      decay: 0.52,
      peak: 0.085,
    });
    _tone(ctx, {
      freq: 210,
      glideTo: 840,
      type: 'triangle',
      at: 0.015,
      attack: 0.008,
      decay: 0.46,
      peak: 0.12,
    });
    _tone(ctx, {
      freq: 1568,
      glideTo: 1046.5,
      type: 'sine',
      at: 0.08,
      attack: 0.003,
      decay: 0.22,
      peak: 0.075,
    });
  } catch (_e) { /* audio is decoration */ }
}

/** Outcome-neutral air movement, aligned to the coin's large motion beats. */
export function sfxCoinflipWhoosh(intensity = 0.6, reverse = false) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    if (_noiseWhoosh(ctx, { intensity, reverse })) return;
    const strength = Math.max(0.15, Math.min(1, Number(intensity) || 0.6));
    // Oscillator fallback keeps the cue testable and functional in limited
    // WebAudio implementations. It is deliberately neutral—no win/loss chord.
    _tone(ctx, {
      freq: reverse ? 1_050 : 165,
      glideTo: reverse ? 165 : 1_050,
      type: 'sawtooth',
      attack: 0.012,
      decay: 0.15 + (strength * 0.1),
      peak: 0.025 + (strength * 0.045),
    });
    _tone(ctx, {
      freq: reverse ? 720 : 240,
      glideTo: reverse ? 240 : 720,
      type: 'triangle',
      at: 0.02,
      attack: 0.008,
      decay: 0.13 + (strength * 0.08),
      peak: 0.035 + (strength * 0.04),
    });
  } catch (_e) { /* audio is decoration */ }
}

/** The Reverse card physically striking the coin (daily fakeout or live tap). */
export function sfxReverseBonk(intensity = 1) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    const strength = Math.max(0.35, Math.min(1.2, Number(intensity) || 1));
    // Broadband contact plus short, damped wood-like resonances. Keeping the
    // body under 180ms makes repeated Reverse cards punch without smearing
    // together, and the neutral downward settling reveals no win/loss result.
    _impactTransient(ctx, strength);
    _tone(ctx, {
      freq: 168,
      glideTo: 96,
      type: 'sine',
      attack: 0.0015,
      decay: 0.145,
      peak: 0.17 * strength,
    });
    _tone(ctx, {
      freq: 410,
      glideTo: 230,
      type: 'triangle',
      at: 0.003,
      attack: 0.0015,
      decay: 0.095,
      peak: 0.09 * strength,
    });
    _tone(ctx, {
      freq: 1_180,
      glideTo: 650,
      type: 'sine',
      at: 0.001,
      attack: 0.001,
      decay: 0.028,
      peak: 0.05 * strength,
    });
  } catch (_e) { /* audio is decoration */ }
}

/**
 * A readable but deliberately sub-final face-change cue. `step` raises each
 * successive Reverse-card impact slightly so multi-card fakeouts keep moving.
 */
export function sfxCoinflipTurn(won = false, step = 0) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    const lift = Math.max(0, Math.min(3, Math.trunc(Number(step) || 0))) * 28;
    if (won) {
      _tone(ctx, {
        freq: 360 + lift,
        glideTo: 720 + lift * 2,
        type: 'triangle',
        attack: 0.004,
        decay: 0.2,
        peak: 0.12,
      });
      _tone(ctx, {
        freq: 1080 + lift * 2,
        type: 'sine',
        at: 0.035,
        attack: 0.003,
        decay: 0.17,
        peak: 0.065,
      });
    } else {
      _tone(ctx, {
        freq: 330 + lift,
        glideTo: 155,
        type: 'triangle',
        attack: 0.004,
        decay: 0.24,
        peak: 0.105,
      });
      _tone(ctx, {
        freq: 175,
        glideTo: 105,
        type: 'sawtooth',
        at: 0.035,
        attack: 0.004,
        decay: 0.19,
        peak: 0.07,
      });
    }
  } catch (_e) { /* audio is decoration */ }
}

/** Final daily-flip landing: green ascends; red drops with a low coin thud. */
export function sfxCoinflipLand(won = false) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    if (won) {
      [523.25, 659.25, 783.99].forEach((freq, index) => {
        _tone(ctx, {
          freq,
          type: 'triangle',
          at: index * 0.065,
          attack: 0.004,
          decay: 0.32,
          peak: 0.17,
        });
      });
      _tone(ctx, {
        freq: 261.63,
        glideTo: 523.25,
        type: 'sine',
        attack: 0.012,
        decay: 0.48,
        peak: 0.12,
      });
    } else {
      _tone(ctx, {
        freq: 392,
        glideTo: 196,
        type: 'triangle',
        attack: 0.006,
        decay: 0.42,
        peak: 0.15,
      });
      _tone(ctx, {
        freq: 220,
        glideTo: 90,
        type: 'sawtooth',
        at: 0.075,
        attack: 0.006,
        decay: 0.38,
        peak: 0.11,
      });
    }
  } catch (_e) { /* audio is decoration */ }
}

/** A restrained, upbeat acknowledgement for an observed quest completion. */
export function sfxQuestComplete() {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    _tone(ctx, {
      freq: 659.25,
      type: 'triangle',
      attack: 0.003,
      decay: 0.16,
      peak: 0.09,
    });
    _tone(ctx, {
      freq: 987.77,
      type: 'sine',
      at: 0.065,
      attack: 0.003,
      decay: 0.22,
      peak: 0.075,
    });
  } catch (_e) { /* audio is decoration */ }
}

/** Optional quiet physical clack for callers that need a motion preview. */
export function sfxCrapsDiceTick(step = 0, seed = 0) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    const index = Math.max(0, Math.trunc(Number(step) || 0));
    const variation = _cueVariation(seed, index);
    const pan = Math.max(-0.12, Math.min(0.12, variation * 0.12));
    const frequency = 1_020 * (1 + variation * 0.04);
    _filteredNoise(ctx, {
      duration: 0.032,
      type: 'highpass',
      from: 1_750,
      to: 980,
      q: 0.55,
      peak: 0.018,
      pan,
    });
    _tone(ctx, {
      freq: frequency,
      glideTo: frequency * 0.76,
      type: 'triangle',
      attack: 0.0015,
      decay: 0.038,
      peak: 0.03,
      pan,
    });
  } catch (_e) { /* audio is decoration */ }
}

/** One table impact, a 2–12 total pitch, then a wager-relative result pitch. */
export function sfxCrapsDiceLand({
  total = null,
  netResultBps = null,
  outcome = '',
  sevenOutcome = '',
} = {}) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    const totalNumber = Math.trunc(Number(total));
    _filteredNoise(ctx, {
      duration: 0.052,
      type: 'lowpass',
      from: 2_450,
      to: 680,
      q: 0.7,
      peak: 0.052,
      pan: -0.09,
    });
    _tone(ctx, {
      freq: 760,
      glideTo: 390,
      type: 'triangle',
      attack: 0.001,
      decay: 0.05,
      peak: 0.055,
      pan: -0.09,
    });
    const totalTone = CRAPS_DICE_TOTAL_TONES[totalNumber];
    if (totalTone) {
      _tone(ctx, {
        freq: totalTone,
        glideTo: totalTone * 0.985,
        type: 'triangle',
        at: 0.1,
        attack: 0.002,
        decay: 0.085,
        peak: 0.058,
      });
    }
    const normalizedOutcome = Object.hasOwn(CRAPS_ROLL_OUTCOME_TONES, outcome)
      ? outcome
      : sevenOutcome === 'win' ? 'win' : sevenOutcome === 'crap-out' ? 'loss' : '';
    const resultTone = netResultBps == null
      ? CRAPS_ROLL_OUTCOME_TONES[normalizedOutcome]
      : crapsNetResultTone(netResultBps);
    if (resultTone) {
      _tone(ctx, {
        ...resultTone,
        at: 0.205,
        attack: 0.003,
        decay: 0.12,
      });
    }
  } catch (_e) { /* audio is decoration */ }
}

// A broadband ceramic tick plus a very short resonance. The resonance is only
// the body of the impact; keeping it below 30ms prevents these contacts from
// reading as the former pitched UI beeps.
function _crapsChipClack(ctx, {
  at = 0,
  resonance = 1_800,
  peak = 0.04,
  pan = 0,
} = {}) {
  _filteredNoise(ctx, {
    at,
    duration: 0.024,
    type: 'bandpass',
    from: resonance * 1.9,
    to: resonance * 0.82,
    q: 2.2,
    peak,
    pan,
  });
  _tone(ctx, {
    freq: resonance,
    glideTo: resonance * 0.68,
    type: 'triangle',
    at,
    attack: 0.0008,
    decay: 0.026,
    peak: peak * 0.58,
    pan,
  });
}

function _crapsPayoutTier(chipsWon) {
  const chips = Math.max(1, Math.trunc(Number(chipsWon) || 1));
  if (chips <= 2) return 'small';
  if (chips <= 8) return 'medium';
  if (chips <= 32) return 'large';
  return 'huge';
}

/** One restrained table-level cue whose weight follows the chips collected. */
export function sfxCrapsSettlement(kind = 'collect', chipsWon = 7) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    if (kind === 'sweep') {
      _filteredNoise(ctx, {
        duration: 0.19,
        type: 'bandpass',
        from: 1_450,
        to: 360,
        q: 0.65,
        peak: 0.045,
      });
      if (_playCrapsChipSample(ctx, 'clay', {
        at: 0.035, gain: 0.26, playbackRate: 0.78, pan: 0.06,
      })) return;
      _crapsChipClack(ctx, { at: 0.035, resonance: 1_080, peak: 0.031, pan: -0.08 });
      _crapsChipClack(ctx, { at: 0.115, resonance: 860, peak: 0.027, pan: 0.08 });
      return;
    }
    if (kind === 'opponent') {
      // The side rack keeps a darker timbre, while a larger haul still gains
      // weight and extra ceramic contacts.
      const tier = _crapsPayoutTier(chipsWon);
      let sampled = _playCrapsChipSample(ctx, 'smallBet', {
        at: 0.012,
        gain: tier === 'small' ? 0.2 : tier === 'medium' ? 0.27 : 0.31,
        playbackRate: tier === 'small' ? 1.02 : tier === 'medium' ? 0.86 : 0.76,
        pan: 0.32,
        duration: 0.42,
      });
      if (tier === 'large' || tier === 'huge') {
        sampled = _playCrapsChipSample(ctx, 'clay', {
          at: 0.064, gain: 0.19, playbackRate: tier === 'huge' ? 0.7 : 0.8, pan: 0.28,
        }) || sampled;
      }
      if (tier === 'huge') {
        sampled = _playCrapsChipSample(ctx, 'smallBet', {
          at: 0.13, gain: 0.18, playbackRate: 0.67, pan: 0.36, duration: 0.48,
        }) || sampled;
      }
      if (sampled) return;
      const opponentContacts = tier === 'small' ? 1 : tier === 'medium' ? 2 : tier === 'large' ? 3 : 4;
      for (let index = 0; index < opponentContacts; index += 1) {
        _crapsChipClack(ctx, {
          at: 0.012 + index * 0.055,
          resonance: (1_180 - index * 135) * (tier === 'huge' ? 0.88 : 1),
          peak: Math.max(0.018, 0.029 - index * 0.002),
          pan: 0.28 + (index % 2) * 0.06,
        });
      }
      return;
    }
    const tier = _crapsPayoutTier(chipsWon);
    let sampled = _playCrapsChipSample(ctx, tier === 'small' ? 'smallBet' : 'clay', {
      gain: tier === 'small' ? 0.34 : tier === 'medium' ? 0.5 : 0.56,
      playbackRate: tier === 'small' ? 1.18 : tier === 'medium' ? 1.03 : tier === 'large' ? 0.9 : 0.76,
      pan: -0.04,
      duration: tier === 'small' ? 0.2 : null,
    });
    if (tier !== 'small') {
      sampled = _playCrapsChipSample(ctx, 'smallBet', {
        at: 0.028,
        gain: tier === 'medium' ? 0.2 : 0.25,
        playbackRate: tier === 'medium' ? 1.08 : tier === 'large' ? 0.94 : 0.78,
        pan: 0.08,
        duration: tier === 'huge' ? 0.48 : 0.3,
      }) || sampled;
    }
    if (tier === 'large' || tier === 'huge') {
      sampled = _playCrapsChipSample(ctx, 'clay', {
        at: 0.092, gain: 0.3, playbackRate: tier === 'huge' ? 0.72 : 0.84, pan: -0.1,
      }) || sampled;
    }
    if (tier === 'huge') {
      sampled = _playCrapsChipSample(ctx, 'smallBet', {
        at: 0.165, gain: 0.25, playbackRate: 0.68, pan: 0.11, duration: 0.52,
      }) || sampled;
    }
    if (sampled) return;
    const localContacts = tier === 'small' ? 1 : tier === 'medium' ? 3 : tier === 'large' ? 5 : 7;
    for (let index = 0; index < localContacts; index += 1) {
      _crapsChipClack(ctx, {
        at: index * (tier === 'huge' ? 0.034 : 0.043),
        resonance: (2_150 - (index % 3) * 195) * (tier === 'huge' ? 0.82 : tier === 'large' ? 0.92 : 1),
        peak: Math.max(0.025, 0.043 - index * 0.0022),
        pan: index % 2 === 0 ? -0.08 : 0.08,
      });
    }
  } catch (_e) { /* audio is decoration */ }
}

/** One chip placed by hand, with a muted felt body under its ceramic edge. */
export function sfxCrapsBetPlace() {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    if (_playCrapsChipSample(ctx, 'smallBet', {
      gain: 0.38, playbackRate: 1.12, duration: 0.14,
    })) return;
    _filteredNoise(ctx, {
      duration: 0.042,
      type: 'lowpass',
      from: 1_100,
      to: 420,
      q: 0.7,
      peak: 0.025,
    });
    _crapsChipClack(ctx, { at: 0.008, resonance: 1_520, peak: 0.034 });
  } catch (_e) { /* audio is decoration */ }
}

/** A physical 1→2 stack rhythm for either wager or survival doubling. */
export function sfxCrapsDouble({ at = 0 } = {}) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    const offset = Math.max(0, Number(at) || 0);
    const firstStack = _playCrapsChipSample(ctx, 'clay', {
      at: offset, gain: 0.34, playbackRate: 0.94, pan: -0.1,
    });
    const secondStack = _playCrapsChipSample(ctx, 'smallBet', {
      at: offset + 0.075, gain: 0.42, playbackRate: 1.08, pan: 0.1, duration: 0.34,
    });
    if (firstStack || secondStack) return;
    _crapsChipClack(ctx, { at: offset, resonance: 1_480, peak: 0.036 });
    _crapsChipClack(ctx, { at: offset + 0.075, resonance: 1_940, peak: 0.039, pan: -0.13 });
    _crapsChipClack(ctx, { at: offset + 0.079, resonance: 2_120, peak: 0.039, pan: 0.13 });
  } catch (_e) { /* audio is decoration */ }
}

/** A brief gold-token shimmer reserved for the local bonus-shooter reveal. */
export function sfxCrapsBonusShooter() {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    _filteredNoise(ctx, {
      duration: 0.045,
      type: 'highpass',
      from: 2_800,
      to: 1_500,
      q: 1.2,
      peak: 0.026,
    });
    _tone(ctx, { freq: 740, type: 'triangle', decay: 0.1, peak: 0.048 });
    _tone(ctx, { freq: 1_110, type: 'triangle', at: 0.052, decay: 0.13, peak: 0.055 });
    _tone(ctx, { freq: 1_480, type: 'sine', at: 0.11, decay: 0.18, peak: 0.05 });
  } catch (_e) { /* audio is decoration */ }
}

// Test-only — drops the cached context so stubbed AudioContext globals take
// effect per-case. NOT for production consumers.
export function __resetForTest() {
  try { _audioCtx?.close?.(); } catch (_e) { /* defensive */ }
  _audioCtx = null;
  _crapsChipEncoded.clear();
  _crapsChipBuffers.clear();
  _crapsChipFetchPromise = null;
  _crapsChipLoadPromise = null;
}
