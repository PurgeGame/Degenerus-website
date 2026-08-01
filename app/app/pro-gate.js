// /app/app/pro-gate.js — Phase 64 hidden pro-mode eligibility derivation.
//
// Derives ui.proEligible from the CONNECTED wallet's activity score:
//   scoreBreakdown.totalBps > PRO_SCORE_THRESHOLD_BPS (8000 bps = 80 points).
//
// No visible UI consumes ui.proEligible yet — THE PIT (pro mode,
// .planning/sketches/THE-PIT-SPEC.md) reads it when it ships. Built now so
// the mode system has its gate signal from day one.
//
// Keyed strictly to connected.address, NEVER getViewedAddress(): pro mode is
// a feature unlock for the wallet owner, not a property of whoever is being
// viewed via ?as= / the player typeahead.
//
// Failure policy: no wallet → false; fetch failure → false (fail closed);
// stale responses discarded via a sequence counter so a slow fetch for wallet
// A can't overwrite wallet B's result after an account switch.

import { get, update, subscribe } from './store.js';
// Pitfall 5 pattern (mirrors polling.js): cross-import ONLY the API_BASE
// constant — beta/app/api.js has a module-level document side effect and
// cannot be imported headless (node:test).
import { API_BASE } from '../../beta/app/constants.js';

export const PRO_SCORE_THRESHOLD_BPS = 8000; // 80 points (10000 bps = 1.00 = 100 pts)

async function _defaultFetchJSON(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

// Test seam — node:test injects a fake fetch.
let _fetchImpl = _defaultFetchJSON;
export function __setFetchJSONForTest(fn) { _fetchImpl = fn || _defaultFetchJSON; }

/**
 * deriveProEligible — pure predicate over a /player/{addr} payload.
 * Strict > (exactly 80.00 points does NOT qualify); non-numeric → false.
 */
export function deriveProEligible(payload) {
  const bps = Number(payload?.scoreBreakdown?.totalBps);
  return Number.isFinite(bps) && bps > PRO_SCORE_THRESHOLD_BPS;
}

let _seq = 0;

/**
 * initProGate — subscribe to connected.address and keep ui.proEligible fresh.
 * subscribe()'s initial-fire covers cold start (null → false). Returns the
 * unsubscribe function (tests use it; production never tears down).
 */
export function initProGate() {
  return subscribe('connected.address', async (addr) => {
    const seq = ++_seq; // stale-response guard on address churn
    if (!addr) {
      update('ui.proEligible', false);
      return;
    }
    try {
      const payload = await _fetchImpl(`/player/${addr}`);
      // Discard if a newer subscription fire superseded us, or the wallet
      // changed while the fetch was in flight.
      if (seq !== _seq || get('connected.address') !== addr) return;
      update('ui.proEligible', deriveProEligible(payload));
    } catch (_e) {
      if (seq === _seq) update('ui.proEligible', false); // fail closed
    }
  });
}
