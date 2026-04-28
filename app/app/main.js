// /app/app/main.js — Phase 58 Plan 02 boot orchestrator (extends Phase 56 D-01).
//
// Boot order (RESEARCH §Code Examples lines 606-639):
//   1. initRouter()         — read ?as= → seed viewing.address BEFORE wallet flow.
//   2. await autoReconnect() — silent eth_accounts via persisted rdns; never popups.
//   3. startPolling()        — target getViewedAddress() (?as= || connected || null).
//   4. subscribe re-arm      — viewing.address change re-arms polling target.
//   5. subscribe re-arm      — connected.address change re-arms IFF no viewing override.
//
// Cold-load deep-link to a player profile works without an active wallet
// connection (read-only view of any DB-known player) — initRouter seeds
// viewing.address before autoReconnect runs, so polling targets the deep-linked
// address from the first cycle.

import './chain-config.js';
import { start as startPolling } from './polling.js';
import { initRouter, getViewedAddress } from './router.js';
import { autoReconnect } from './wallet.js';
import { subscribe } from './store.js';

async function boot() {
  console.log('[app] booting');
  // 1. Router reads ?as= → seeds viewing.address BEFORE any wallet flow.
  initRouter();
  // 2. Auto-reconnect via persisted rdns (silent — eth_accounts only, no popup).
  await autoReconnect().catch(() => {});
  // 3. Polling starts with the resolved viewing target (?as= OR connected OR null).
  startPolling({ playerAddress: getViewedAddress() });
  // 4. Re-arm polling whenever the viewing target changes (typeahead pick,
  //    banner CTA, popstate). subscribe() also fires immediately with current
  //    value, but startPolling is idempotent (it pauseAllTimers + restarts).
  subscribe('viewing.address', (addr) => {
    startPolling({ playerAddress: addr || getViewedAddress() });
  });
  // 5. Re-arm via connected.address ONLY when no ?as= override is active
  //    (otherwise the deep-link target wins).
  subscribe('connected.address', (addr) => {
    if (!getViewedAddress() || getViewedAddress() === addr) {
      startPolling({ playerAddress: addr });
    }
  });
  console.log('[app] ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
