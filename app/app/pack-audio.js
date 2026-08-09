// play/app/pack-audio.js -- Web Audio wrapper for PACKS-05 / D-10
//
// Fail-silent on 404 or unsupported API. localStorage mute persistence
// at the app-wide SFX key. The former play.audio.muted key remains readable so
// an existing player preference survives this UI consolidation. The encoded
// cue is fetched ahead of time, decoded after the first player gesture, and
// kept ready for the later reveal animation.
// Volume fixed at 0.4 in a GainNode (D-10).
//
// Auto-open still cannot bypass browser autoplay policy, but the app-wide
// first-gesture primer resumes this context before those delayed results fire.
//
// SHELL-01: zero imports (pure module).

const STORAGE_KEY = 'degenerus.sfxMuted';
const LEGACY_STORAGE_KEY = 'play.audio.muted';
const VOLUME = 0.4;
// pack-open.mp3 was an empty placeholder. Reuse the shipped, licensed cabinet
// lock cue rather than making every first decode fail silently.
export const PACK_OPEN_ASSET_PATH = '/app/sounds/jackpot/cabinet-stop.wav';

let ctx = null;
let buffer = null;
let encodedBytes = null;
let fetchPromise = null;
let loadPromise = null;
let loadError = null;

function _warnOnce(err) {
  if (loadError) return;
  loadError = err || new Error('Unknown pack audio error');
  try { console.warn('[pack-audio] disabled:', loadError?.message || loadError); } catch {}
}

function ensureContext() {
  if (ctx) return ctx;
  const AudioCtor = (typeof window !== 'undefined')
    && (window.AudioContext || window.webkitAudioContext);
  if (!AudioCtor) throw new Error('Web Audio API not available');
  ctx = new AudioCtor();
  return ctx;
}

async function ensureFetched() {
  if (encodedBytes) return encodedBytes;
  if (loadError) return null;
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    const resp = await fetch(PACK_OPEN_ASSET_PATH);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const bytes = await resp.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) throw new Error('Empty audio asset');
    encodedBytes = bytes;
    return encodedBytes;
  })().catch((err) => {
    _warnOnce(err);
    return null;
  });
  return fetchPromise;
}

async function ensureLoaded() {
  if (buffer || loadError) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const bytes = await ensureFetched();
    if (!bytes) return;
    const audioContext = ensureContext();
    // Some decodeAudioData implementations detach their input buffer.
    buffer = await audioContext.decodeAudioData(bytes.slice(0));
  })().catch((err) => {
    _warnOnce(err);
  });
  return loadPromise;
}

/** Fetch the small encoded cue without creating a pre-gesture AudioContext. */
export function preloadPackOpen() {
  if (isMuted()) return Promise.resolve(false);
  return ensureFetched().then((bytes) => Boolean(bytes));
}

/** Resume synchronously from a user gesture, then decode during the lead time. */
export function warmupPackAudio() {
  if (isMuted()) return false;
  try {
    const audioContext = ensureContext();
    if (audioContext.state === 'suspended') {
      try { audioContext.resume()?.catch?.(() => {}); } catch {}
    }
    void ensureLoaded();
    return true;
  } catch (err) {
    _warnOnce(err);
    return false;
  }
}

export function isMuted() {
  try {
    return typeof localStorage !== 'undefined'
      && (localStorage.getItem(STORAGE_KEY) === '1'
        || localStorage.getItem(LEGACY_STORAGE_KEY) === '1');
  } catch {
    return false;
  }
}

export function setMuted(muted) {
  try {
    if (typeof localStorage !== 'undefined') {
      if (muted) localStorage.setItem(STORAGE_KEY, '1');
      else localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
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
