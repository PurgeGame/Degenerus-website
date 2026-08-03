// play/app/replay-panel-sync.js -- bridge play store -> beta <replay-panel>.
//
// The beta replay-panel ships with its own <select> dropdowns for day and
// player. When the panel is embedded in /play, we want it driven by the
// global day-scrubber + player-selector instead so the user has one source
// of truth across panels.
//
// Strategy: subscribe to replay.day + replay.player on the shared store,
// programmatically set the dropdown's value, and dispatch a synthetic
// 'change' event so the panel runs its own #onDayChange / #onPlayerChange
// handlers (which load the day's roll1/roll2/winners + filter by player).
//
// The dropdowns are hidden via CSS (.play-grid replay-panel .replay-control-group)
// so they don't clutter the page; the panel's "Reveal Draw" button stays
// clickable for manual reveal animation.

import { subscribe, get } from '../../beta/app/store.js';

function getPanel() {
  return document.querySelector('replay-panel');
}

function setSelectAndFire(select, value) {
  if (!select) return false;
  // Skip if no options yet (panel hasn't loaded its data)
  const target = String(value);
  const matching = Array.from(select.options).find((o) => o.value === target);
  if (!matching) return false;
  if (select.value === target) return true;
  select.value = target;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function syncDay() {
  const panel = getPanel();
  if (!panel) return false;
  const day = get('replay.day');
  if (day == null) return false;
  return setSelectAndFire(panel.querySelector('[data-bind="day-select"]'), day);
}

function syncPlayer() {
  const panel = getPanel();
  if (!panel) return false;
  const addr = get('replay.player');
  if (!addr) return false;
  return setSelectAndFire(panel.querySelector('[data-bind="player-select"]'), addr);
}

// Retry sync on a short interval until the panel's options are ready.
// Once both succeed, stop polling. Subsequent store changes use the
// subscription path below.
function pollUntilSynced() {
  let dayDone = false;
  let playerDone = false;
  let attempts = 0;
  const maxAttempts = 60; // ~30 seconds at 500ms intervals
  const timer = setInterval(() => {
    attempts += 1;
    if (!dayDone) dayDone = syncDay();
    if (!playerDone) playerDone = syncPlayer();
    if ((dayDone && playerDone) || attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, 500);
}

export function bindReplayPanelToStore() {
  // Subscribe so future store changes propagate to the panel.
  subscribe('replay.day', () => syncDay());
  subscribe('replay.player', () => syncPlayer());
  // Initial sync (panel may need a moment to load /replay/rng + /replay/players).
  pollUntilSynced();
}
