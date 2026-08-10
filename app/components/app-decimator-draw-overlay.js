// Full-screen host for the standalone Decimator wheel. The wheel stays in its
// own same-origin document so its SVG ids, layout and animation state cannot
// collide with the main app. A short-lived sessionStorage key transfers the
// exact resolved snapshot without putting player/burn data in the URL.

import { CHAIN } from '../app/chain-config.js';
import { loadDecimatorDrawSnapshot } from '../app/decimator-draw-data.js';

const STORAGE_PREFIX = `degenerus:decimator-draw:${CHAIN.id}:`;
let active = null;

function removeActive() {
  if (!active) return;
  const { overlay, storageKey, onKeydown } = active;
  active = null;
  try { document.removeEventListener('keydown', onKeydown); } catch (_error) { /* defensive */ }
  try { sessionStorage.removeItem(storageKey); } catch (_error) { /* private mode */ }
  try { overlay.remove(); } catch (_error) { /* defensive */ }
  try { document.body?.classList?.remove('decimator-draw-open'); } catch (_error) { /* defensive */ }
}

export function closeDecimatorDraw() {
  removeActive();
}

export async function openDecimatorDraw({ level, player } = {}) {
  if (typeof document === 'undefined' || !document.body) return false;
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
  active = { overlay, storageKey, onKeydown };
  document.addEventListener('keydown', onKeydown);
  document.body.classList.add('decimator-draw-open');
  document.body.appendChild(overlay);

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
    const params = new URLSearchParams({
      embed: '1',
      snapshot: storageKey,
      ...(player ? { player: String(player).toLowerCase() } : {}),
    });
    frame.src = `/decimator-draw/?${params.toString()}`;
    frame.addEventListener('load', () => {
      if (active?.overlay !== overlay) return;
      overlay.classList.remove('is-loading');
      loading.hidden = true;
      try { frame.focus(); } catch (_error) { /* focus remains on close control */ }
    }, { once: true });
    overlay.appendChild(frame);
    close.focus();
    return true;
  } catch (error) {
    if (active?.overlay === overlay) removeActive();
    throw error;
  }
}
