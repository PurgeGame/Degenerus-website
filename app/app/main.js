// /app/app/main.js — Phase 56 boot orchestrator (D-01 LOCKED).
// Wave 1: chain-config side-effect import only. Wave 2 plans (56-03) wire polling.start().

import './chain-config.js';

async function boot() {
  console.log('[app] booting');
  // Polling start wired in Plan 56-03 (Wave 2): import { start } from './polling.js'; start();
  console.log('[app] ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
