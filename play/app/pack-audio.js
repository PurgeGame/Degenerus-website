// play/app/pack-audio.js -- Web Audio wrapper for PACKS-05 / D-10
//
// Fail-silent on 404 or unsupported API. localStorage mute persistence
// at STORAGE_KEY='play.audio.muted'. First play() serves as the browser
// autoplay-unlock user gesture (pack click is a user gesture -- D-10).
// Volume fixed at 0.4 in a GainNode (D-10).
//
// Lootbox auto-open (D-06) fires on render, NOT a user gesture --
// its first sound will be blocked until any subsequent user gesture
// unlocks the AudioContext. Accepted per Pitfall 4; no "click to enable"
// overlay.
//
// SHELL-01: zero imports (pure module).

const STORAGE_KEY = 'play.audio.muted';
const VOLUME = 0.4;
const ASSET_PATH = '/play/assets/audio/pack-open.mp3';

let ctx = null;
let buffer = null;
let loadError = null;

async function ensureLoaded() {
  if (ctx || loadError) return;
  try {
    const AudioCtor = (typeof window !== 'undefined')
      && (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtor) throw new Error('Web Audio API not available');
    ctx = new AudioCtor();
    const resp = await fetch(ASSET_PATH);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const bytes = await resp.arrayBuffer();
    buffer = await ctx.decodeAudioData(bytes);
  } catch (err) {
    loadError = err;
    // Fail-silent per D-10: single console.warn, no UI error, subsequent
    // playPackOpen() calls return early.
    try { console.warn('[pack-audio] disabled:', err && err.message ? err.message : err); } catch {}
  }
}

export function isMuted() {
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    }
  } catch {
    // Privacy-mode browsers block localStorage; in-memory session fallback
    // is implicit (isMuted returns false next call and the toggle still
    // reflects the in-session intent via the caller's UI state).
  }
}

export async function playPackOpen() {
  if (isMuted()) return;
  await ensureLoaded();
  if (!buffer || !ctx) return;   // fail-silent per D-10
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { return; }
  }
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = VOLUME;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(0);
  } catch {
    // Defensive: if the buffer was invalidated, silently no-op.
  }
}
