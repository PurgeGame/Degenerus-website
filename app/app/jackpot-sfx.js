// /app/app/jackpot-sfx.js — Phase 64 jackpot reveal sound design.
//
// WebAudio-synthesized cues (no audio files), ported in spirit from the GT
// paper's interactive demo (theory/index.html sfxTick/sfxLock/sfxAllLocked/
// sfxFanfare, ~lines 1677-1830): oscillator + gain envelopes only.
//
// Cues:
//   sfxSpinStart(ms)   — low anticipation riser while the flame spins
//   sfxTick(i)         — short blip per revealed row, pitch rises with index
//   sfxMatchLock(i)    — bright escalating cue for a matching DGN trait lock
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
  if (!isMuted()) _ctx();
}

// One-shot oscillator envelope: attack to `peak`, exponential decay to
// silence. Optional frequency glide freq → glideTo over the decay window.
function _tone(ctx, { freq = 440, glideTo = null, type = 'sine', at = 0, attack = 0.005, decay = 0.15, peak = 0.2 }) {
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
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.05);
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
 * A Degenerette lock whose newly settled color or symbol matches the player's
 * ticket. This follows the standalone reveal's eight-note match ladder, with a
 * quiet upper chime so it cannot be mistaken for the ordinary mechanical tick.
 */
export function sfxMatchLock(i = 0) {
  const ctx = _ctx();
  if (!ctx) return;
  try {
    const ladder = [261.63, 293.66, 329.63, 349.23, 392, 440, 493.88, 523.25];
    const step = Math.max(0, Math.min(ladder.length - 1, Number(i) || 0));
    const root = ladder[step];
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
    // A short hard edge over two low, slightly detuned bodies gives a much
    // more physical BONK than the former face-change chirp. No pitch direction
    // is tied to the eventual result.
    _tone(ctx, {
      freq: 118,
      glideTo: 54,
      type: 'sine',
      attack: 0.002,
      decay: 0.25,
      peak: 0.16 * strength,
    });
    _tone(ctx, {
      freq: 205,
      glideTo: 82,
      type: 'triangle',
      at: 0.006,
      attack: 0.002,
      decay: 0.17,
      peak: 0.13 * strength,
    });
    _tone(ctx, {
      freq: 1_480,
      glideTo: 390,
      type: 'square',
      at: 0.002,
      attack: 0.001,
      decay: 0.055,
      peak: 0.065 * strength,
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

// Test-only — drops the cached context so stubbed AudioContext globals take
// effect per-case. NOT for production consumers.
export function __resetForTest() {
  try { _audioCtx?.close?.(); } catch (_e) { /* defensive */ }
  _audioCtx = null;
}
