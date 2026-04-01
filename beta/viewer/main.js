// viewer/main.js -- Entry point for viewer page
// Wallet-free entry point: no imports from app/ wallet/contracts chain (SHELL-01)

import { initPlayerSelector, setSelectedPlayer } from './player-selector.js';
import { initScrubber, loadDays, setDay, getCurrentDay, getDaysData } from './scrubber.js';
import { fetchJSON } from './api.js';
import { render as renderDashboard, clearChart } from './dashboard.js';
import { render as renderActivity } from './activity.js';
import { render as renderStore } from './store-view.js';
import { render as renderCoinflip } from './coinflip-display.js';

const selectEl      = document.getElementById('viewer-player-select');
const emptyEl       = document.getElementById('viewer-empty');
const contentEl     = document.getElementById('viewer-content');
const replayWrapperEl = document.getElementById('replay-wrapper');

let currentPlayer = null;

// --- URL Hash State (D-17, D-18, NAV-03) ---

function updateHash(player, day) {
  history.replaceState(null, '', `#player=${player}&day=${day}`);
}

function parseHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const player = params.get('player');
  const day = parseInt(params.get('day') ?? '', 10);
  if (player && player.length === 42 && player.startsWith('0x') && !isNaN(day) && day > 0) {
    return { player, day };
  }
  return null;
}

// --- Skeleton Loading (D-17) ---

function showPanelSkeletons(container) {
  container.innerHTML = `
    <div class="panel">
      <div class="skeleton-header skeleton-line skeleton-shimmer" style="width:120px"></div>
      <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:100%;height:0.8rem"></div></div>
      <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:100%;height:0.8rem"></div></div>
      <div class="skeleton-block skeleton-shimmer" style="height:80px;margin-top:12px"></div>
    </div>
    <div class="panel">
      <div class="skeleton-header skeleton-line skeleton-shimmer" style="width:160px"></div>
      <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:100%;height:0.8rem"></div></div>
      <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:80%;height:0.8rem"></div></div>
    </div>
    <div class="panel">
      <div class="skeleton-header skeleton-line skeleton-shimmer" style="width:100px"></div>
      <div class="skeleton-row"><div class="skeleton-line skeleton-shimmer" style="width:90%;height:0.8rem"></div></div>
    </div>
  `;
}

// --- Replay Panel Sync (D-03, D-13) ---

function syncReplayPanel(player, day) {
  // Show the replay wrapper once a player is active
  if (replayWrapperEl) replayWrapperEl.hidden = false;

  const replayEl = document.querySelector('replay-panel');
  if (!replayEl) return;

  const daySelect = replayEl.querySelector('[data-bind="day-select"]');
  if (!daySelect) return;

  function trySetDay() {
    // Wait for day options to be populated (starts as single "Loading days..." placeholder)
    const hasOptions = daySelect.options.length > 1 && daySelect.options[0]?.value !== '';
    if (!hasOptions) {
      const obs = new MutationObserver(() => {
        obs.disconnect();
        trySetDay();
      });
      obs.observe(daySelect, { childList: true });
      return;
    }

    // Set day value and dispatch change to trigger #onDayChange
    daySelect.value = String(day);
    daySelect.dispatchEvent(new Event('change'));

    // Now wait for player-select to populate (populated by #loadTickets after day change)
    const playerSelect = replayEl.querySelector('[data-bind="player-select"]');
    if (!playerSelect) return;

    const pObs = new MutationObserver(() => {
      pObs.disconnect();
      // Set player value and dispatch change to trigger #onPlayerChange
      playerSelect.value = player;
      playerSelect.dispatchEvent(new Event('change'));
    });
    pObs.observe(playerSelect, { childList: true });
  }

  trySetDay();
}

// --- Panel Refresh (D-03) ---

async function refreshPanels(player, day) {
  showPanelSkeletons(contentEl);
  try {
    const data = await fetchJSON(`/viewer/player/${player}/day/${day}`);
    const daysData = getDaysData();
    contentEl.innerHTML = '';
    renderDashboard({ holdings: data.holdings, daysData }, contentEl);
    renderActivity(data.activity, contentEl);
    renderStore(data.store, contentEl);
    renderCoinflip(data.activity.coinflip, contentEl);
    syncReplayPanel(player, day);
  } catch (err) {
    console.error('[viewer] Panel fetch failed:', err);
    contentEl.innerHTML = '<div class="panel"><p class="text-dim">Failed to load data. Try selecting again.</p></div>';
  }
}

// --- Player Change Handler ---

async function onPlayerChange(addr) {
  currentPlayer = addr;
  emptyEl.hidden = true;
  contentEl.hidden = false;
  if (replayWrapperEl) replayWrapperEl.hidden = false;

  // Destroy sparkline chart before clearing DOM (prevents Chart.js orphan)
  clearChart();
  contentEl.innerHTML = '';

  // Remove any previous error messages
  document.querySelectorAll('.viewer-error').forEach(el => el.remove());

  const result = await loadDays(addr);
  if (!result) return;

  // Default to first day, or restore from hash if same player
  const hashState = parseHash();
  const day = (hashState && hashState.player === addr && hashState.day >= result.minDay && hashState.day <= result.maxDay)
    ? hashState.day
    : result.minDay;

  setDay(day);
  updateHash(addr, day);
  refreshPanels(addr, day);
}

// --- Day Change Handler ---

function onDayChange(day) {
  if (currentPlayer) {
    updateHash(currentPlayer, day);
    refreshPanels(currentPlayer, day);
  }
}

// --- Hash Change Listener (D-18) ---

window.addEventListener('hashchange', () => {
  const state = parseHash();
  if (!state) return;

  // Only act if something actually changed
  if (state.player !== currentPlayer) {
    setSelectedPlayer(selectEl, state.player);
    onPlayerChange(state.player);
  } else if (state.day !== getCurrentDay()) {
    setDay(state.day);
    onDayChange(state.day);
  }
});

// --- Bootstrap ---

async function boot() {
  console.log('[viewer] initializing');

  // Init scrubber (wires event listeners)
  initScrubber({ onDayChange });

  // Init player selector (fetches players, populates dropdown)
  await initPlayerSelector(selectEl, onPlayerChange);

  // Restore state from URL hash if present
  const initial = parseHash();
  if (initial) {
    setSelectedPlayer(selectEl, initial.player);
    await onPlayerChange(initial.player);
    // setDay after loadDays completes inside onPlayerChange
  }

  console.log('[viewer] ready');
}

boot();
