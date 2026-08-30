// One top-bar switch for every app sound source. Jackpot/reveal synths and the
// pack-opening sample historically used separate persistence keys; mounting
// this control reconciles them into one player-facing preference.

import {
  isMuted as isSfxMuted,
  preloadCrapsChipSamples,
  setMuted as setSfxMuted,
  warmup,
} from '../app/jackpot-sfx.js';
import {
  isMuted as isPackMuted,
  preloadPackOpen,
  setMuted as setPackMuted,
  warmupPackAudio,
} from '../app/pack-audio.js';

const BUTTON_ID = 'unav-sound';
const _armedDocuments = new WeakSet();

function _soundIcon(muted) {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 5 6.7 8.5H3v7h3.7L11 19z"/>
      ${muted
        ? '<path d="m16 9 5 6M21 9l-5 6"/>'
        : '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'}
    </svg>`;
}

function _paint(button, muted) {
  const soundsOn = !muted;
  button.classList.toggle('is-muted', muted);
  button.classList.toggle('is-on', soundsOn);
  button.setAttribute('aria-pressed', soundsOn ? 'true' : 'false');
  button.setAttribute('aria-label', soundsOn ? 'Mute sounds' : 'Turn sounds on');
  button.title = soundsOn ? 'Sounds on — click to mute' : 'Sounds off — click to enable';
  button.innerHTML = `${_soundIcon(muted)}<span class="btn-label">${soundsOn ? 'SOUND' : 'MUTED'}</span>`;
}

function _persist(muted) {
  setSfxMuted(muted);
  setPackMuted(muted);
}

/** Prime every shared sound engine while browser user activation is live. */
export function primeSoundEngines() {
  if (isSfxMuted() || isPackMuted()) return false;
  warmup();
  void preloadCrapsChipSamples();
  warmupPackAudio();
  void preloadPackOpen();
  return true;
}

function _armFirstGesture(root) {
  const target = root?.nodeType === 9
    ? root
    : root?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!target?.addEventListener || _armedDocuments.has(target)) return;
  _armedDocuments.add(target);
  let done = false;
  const finish = () => {
    if (done || !primeSoundEngines()) return;
    done = true;
    try { target.removeEventListener('pointerdown', finish, true); } catch (_e) {}
    try { target.removeEventListener('keydown', finish, true); } catch (_e) {}
    try { target.removeEventListener('click', finish, true); } catch (_e) {}
  };
  // pointerdown is early enough for Safari/iOS; click covers older browsers,
  // and keydown gives keyboard-only players the same first-use behavior.
  target.addEventListener('pointerdown', finish, { capture: true, passive: true });
  target.addEventListener('keydown', finish, { capture: true });
  target.addEventListener('click', finish, { capture: true });
}

export function mountSoundToggle(root = document) {
  if (!root?.querySelector) return null;
  const existing = root.getElementById?.(BUTTON_ID) || root.querySelector(`#${BUTTON_ID}`);
  if (existing) return existing;
  const auth = root.querySelector('.nav-auth');
  if (!auth) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = BUTTON_ID;
  button.className = 'nav-btn nav-btn-sound';

  // Respect either historical preference, then make both audio engines agree.
  let muted = Boolean(isSfxMuted() || isPackMuted());
  _persist(muted);
  _paint(button, muted);
  _armFirstGesture(root);
  if (!muted) {
    void preloadPackOpen();
    void preloadCrapsChipSamples();
  }

  button.addEventListener('click', () => {
    muted = !muted;
    _persist(muted);
    _paint(button, muted);
    if (!muted) primeSoundEngines();
    try {
      window.dispatchEvent(new CustomEvent('degenerus:sound-preference', {
        detail: { muted },
      }));
    } catch (_e) { /* headless / older browser */ }
  });

  const feedback = auth.querySelector('#unav-feedback');
  const discord = auth.querySelector('#unav-discord');
  auth.insertBefore(button, feedback || discord || auth.firstChild);
  return button;
}

function mountWhenReady() {
  if (mountSoundToggle()) return;
  if (typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => {
    if (mountSoundToggle()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWhenReady, { once: true });
  } else {
    mountWhenReady();
  }
}
