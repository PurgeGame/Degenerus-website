// app/router.js -- Phase-aware panel visibility controller
// Subscribes to game.phase and toggles data-panel elements.
// The connect-prompt Custom Element manages its own visibility;
// the router does NOT touch it.

import { subscribe } from './store.js';

const PHASES = {
  PURCHASE: ['purchase'],
  JACKPOT: ['jackpot'],
  GAMEOVER: ['gameover'],
};

let currentPhase = null;

export function initRouter() {
  // Subscribe to game phase changes
  subscribe('game.phase', (phase) => {
    if (phase === currentPhase) return;
    currentPhase = phase;
    applyPhase(phase);
  });

  // Subscribe to stale data indicator
  subscribe('ui.staleData', (stale) => {
    const indicator = document.getElementById('stale-indicator');
    if (indicator) indicator.hidden = !stale;
  });

  // Subscribe to GAMEOVER for disabling action buttons
  subscribe('game.gameOver', (isGameOver) => {
    if (isGameOver) disableAllActions();
  });
}

function applyPhase(phase) {
  const allPanels = document.querySelectorAll('[data-panel]');
  const activeNames = PHASES[phase] || [];

  allPanels.forEach(panel => {
    const name = panel.dataset.panel;
    panel.hidden = !activeNames.includes(name);
  });

  if (phase === 'GAMEOVER') disableAllActions();
}

function disableAllActions() {
  const buttons = document.querySelectorAll('.btn-primary, .btn-action, [data-action]');
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.title = 'Game Over -- actions disabled';
  });
}
