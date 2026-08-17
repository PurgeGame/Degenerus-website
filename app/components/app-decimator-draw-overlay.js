// Full-screen host for the standalone Decimator wheel. The wheel stays in its
// own same-origin document so its SVG ids, layout and animation state cannot
// collide with the main app. A short-lived sessionStorage key transfers the
// exact resolved snapshot without putting player/burn data in the URL.

import { CHAIN } from '../app/chain-config.js';
import { loadDecimatorDrawSnapshot } from '../app/decimator-draw-data.js';
import {
  sfxFanfare,
  sfxNoWin,
  sfxRollDone,
  sfxSpinStart,
  sfxTick,
  warmup as warmupSfx,
} from '../app/jackpot-sfx.js';

const STORAGE_PREFIX = `degenerus:decimator-draw:${CHAIN.id}:`;
const DRAW_BRIDGE_TYPE = 'degenerus:decimator-draw';
let active = null;

function playDrawSound(cue, args = []) {
  if (cue === 'warmup') warmupSfx();
  else if (cue === 'spin') {
    const duration = Math.max(100, Math.min(5_000, Number(args[0]) || 700));
    sfxSpinStart(duration);
  } else if (cue === 'tick') {
    sfxTick(Math.max(0, Math.min(64, Math.trunc(Number(args[0]) || 0))));
  } else if (cue === 'lock') sfxRollDone(args[0] === true);
  else if (cue === 'complete') {
    if (args[1] === false) sfxNoWin();
    else sfxFanfare(args[0] === true);
  }
}

function drawLoadErrorMessage(error) {
  const message = String(error?.shortMessage || error?.message || '').trim();
  if (/rate limit|too many requests|\b429\b|32016/i.test(message)) {
    return 'PUBLIC CHAIN DATA IS BUSY. TRY AGAIN.';
  }
  if (/sync|indexed|unavailable/i.test(message)) {
    return 'THE FINAL DRAW IS STILL SYNCING. TRY AGAIN.';
  }
  return message ? message.slice(0, 180) : 'DRAW DATA COULD NOT BE LOADED. TRY AGAIN.';
}

function removeActive() {
  if (!active) return;
  const { overlay, storageKey, onKeydown, onMessage } = active;
  active = null;
  try { document.removeEventListener('keydown', onKeydown); } catch (_error) { /* defensive */ }
  try { window.removeEventListener('message', onMessage); } catch (_error) { /* defensive */ }
  try { sessionStorage.removeItem(storageKey); } catch (_error) { /* private mode */ }
  try { overlay.remove(); } catch (_error) { /* defensive */ }
  try { document.body?.classList?.remove('decimator-draw-open'); } catch (_error) { /* defensive */ }
}

export function closeDecimatorDraw() {
  removeActive();
}

export async function openDecimatorDraw({ level, player, onReady } = {}) {
  if (typeof document === 'undefined' || !document.body) return false;
  // Run before the first await so a manual OPEN/RUN click unlocks WebAudio
  // while browser user activation is still live.
  try { warmupSfx(); } catch (_error) { /* sound is optional */ }
  removeActive();

  const overlay = document.createElement('section');
  overlay.className = 'decimator-draw-modal is-loading';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Level ${Number(level)} Decimator draw`);

  const loading = document.createElement('div');
  loading.className = 'decimator-draw-modal__loading';
  loading.setAttribute('role', 'status');
  const loadingTitle = document.createElement('strong');
  loadingTitle.textContent = 'LOADING DECIMATOR DRAW';
  const loadingDetail = document.createElement('span');
  loadingDetail.textContent = 'REBUILDING THE RESOLVED WHEEL…';
  loading.appendChild(loadingTitle);
  loading.appendChild(loadingDetail);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'decimator-draw-modal__retry';
  retry.textContent = 'TRY AGAIN';
  retry.hidden = true;
  loading.appendChild(retry);
  overlay.appendChild(loading);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'decimator-draw-modal__close';
  close.textContent = 'BACK TO GAME';
  close.setAttribute('aria-label', 'Close Decimator draw and return to the game');
  close.addEventListener('click', removeActive);
  overlay.appendChild(close);

  const storageKey = `${STORAGE_PREFIX}${Number(level)}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const onKeydown = (event) => {
    if (event?.key === 'Escape') removeActive();
  };
  const onMessage = (event) => {
    const current = active;
    if (!current || current.overlay !== overlay || !current.frame) return;
    if (event?.source !== current.frame.contentWindow) return;
    if (event?.origin !== window.location.origin) return;
    const message = event?.data;
    if (!message || message.type !== DRAW_BRIDGE_TYPE) return;
    if (message.action === 'exit') {
      removeActive();
      return;
    }
    if (message.action === 'sound') {
      try { playDrawSound(String(message.cue || ''), Array.isArray(message.args) ? message.args : []); }
      catch (_error) { /* sound remains decorative */ }
    }
  };
  active = { overlay, storageKey, onKeydown, onMessage, frame: null };
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('message', onMessage);
  document.body.classList.add('decimator-draw-open');
  document.body.appendChild(overlay);

  let loadPending = null;
  let readyNotified = false;
  const mountDraw = async () => {
    if (loadPending) return loadPending;
    loadPending = (async () => {
      overlay.classList.add('is-loading');
      overlay.classList.remove('is-error');
      loading.hidden = false;
      loadingTitle.textContent = 'LOADING DECIMATOR DRAW';
      loadingDetail.textContent = 'REBUILDING THE RESOLVED WHEEL…';
      retry.hidden = true;
      retry.disabled = true;
      try {
        const snapshot = await loadDecimatorDrawSnapshot({ level, player });
        if (!active || active.overlay !== overlay || !overlay.isConnected) return false;
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
        } catch (_error) {
          throw new Error('This browser could not stage the Decimator draw.');
        }

        const frame = document.createElement('iframe');
        frame.className = 'decimator-draw-modal__frame';
        frame.title = `Level ${Number(level)} Decimator draw`;
        frame.setAttribute('allow', 'autoplay');
        active.frame = frame;
        const params = new URLSearchParams({
          embed: '1',
          snapshot: storageKey,
          ...(player ? { player: String(player).toLowerCase() } : {}),
        });
        frame.src = `/decimator-draw/?${params.toString()}`;
        frame.addEventListener('load', () => {
          if (active?.overlay !== overlay) return;
          overlay.classList.remove('is-loading', 'is-error');
          loading.hidden = true;
          try { frame.focus(); } catch (_error) { /* focus remains on close control */ }
        }, { once: true });
        overlay.appendChild(frame);
        if (!readyNotified) {
          readyNotified = true;
          try { onReady?.(); } catch (_error) { /* presentation receipt is best-effort */ }
        }
        close.focus();
        return true;
      } catch (error) {
        if (!active || active.overlay !== overlay || !overlay.isConnected) return false;
        // Loading failures belong inside the fullscreen they opened. Removing
        // it here made an RPC rate limit look like a failed game transaction.
        overlay.classList.add('is-error');
        loadingTitle.textContent = 'DRAW DATA UNAVAILABLE';
        loadingDetail.textContent = drawLoadErrorMessage(error);
        retry.hidden = false;
        retry.disabled = false;
        try { retry.focus(); } catch (_focusError) { /* close remains available */ }
        return false;
      } finally {
        loadPending = null;
      }
    })();
    return loadPending;
  };
  retry.addEventListener('click', (event) => {
    try { event.stopPropagation(); } catch (_error) { /* defensive */ }
    void mountDraw();
  });

  await mountDraw();
  // Once the takeover is mounted, a data error is recoverable in place and is
  // not a failed Pending action. The result remains unseen until onReady fires.
  return Boolean(active?.overlay === overlay && overlay.isConnected);
}
