// /app/app/jackpot-sfx.js — Phase 64 jackpot reveal sound design.
//
// WebAudio-synthesized cues (no audio files), ported in spirit from the GT
// paper's interactive demo (theory/index.html sfxTick/sfxLock/sfxAllLocked/
// sfxFanfare, ~lines 1677-1830): oscillator + gain envelopes only.
//
// Cues:
//   sfxSpinStart(ms)   — low anticipation riser while the flame spins
//   sfxTick(i)         — short blip per revealed row, pitch rises with index
//   sfxRollDone(good)  — lock stinger when a roll completes (two-tone if good)
//   sfxFanfare(big)    — win arpeggio; `big` = the viewed player won
//   sfxGoldTicket()     — bright harmonic hit for a gold-trait ticket
//   sfxNoWin()         — soft descending tone (no winners, pot rolls)
//   sfxLoserHorn()     — comic brass fall for the 1-WWXRP consolation
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

// Test-only — drops the cached context so stubbed AudioContext globals take
// effect per-case. NOT for production consumers.
export function __resetForTest() {
  try { _audioCtx?.close?.(); } catch (_e) { /* defensive */ }
  _audioCtx = null;
}
