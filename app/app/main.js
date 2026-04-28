// /app/app/main.js — Phase 56 boot orchestrator (D-01 LOCKED).
// Boots: chain-config side-effect import + polling.start (Plan 56-03 wired live).

import './chain-config.js';
import { start as startPolling } from './polling.js';

async function boot() {
  console.log('[app] booting');
  console.log('[app] ready');
  // D-01 LOCKED — polling must be wired from boot. Phase 58 will replace
  // playerAddress=null with the wallet's connected account.
  startPolling({ playerAddress: null });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
