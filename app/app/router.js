// /app/app/router.js — Phase 58 Plan 02 ?as= URL ⇄ viewing.address bidirectional sync (DD-03).
//
// NEW pattern with no /beta/ analog — RESEARCH §Pattern 5 IS the spec.
//
// Address validation (Pitfall 7): strict regex ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
// values that don't match are treated as if `?as=` were absent (viewing.address
// stays null, ui.mode stays 'self'). Matched values are lowercased before storing.
//
// URL mirror uses history.replaceState ONLY — the history-stack-push API path is
// intentionally avoided (replaceState does not trigger popstate, avoiding the
// feedback-loop class T-58-11 mitigation). The mirror also short-circuits if
// the URL is already correct (no redundant replaceState).
//
// `?as=` is dropped from the URL whenever viewing.address is null OR equal to
// connected.address (case-insensitive) — viewing-self is the implicit default
// state and shouldn't pollute the URL.
//
// Boot order (consumed by main.js): initRouter() seeds viewing.address from `?as=`
// BEFORE autoReconnect() runs, so a deep-link to a player profile works without
// an active wallet connection.

import { update, get, subscribe } from './store.js';

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// ---------------------------------------------------------------------------
// parseAsParam — validate + normalize a candidate `?as=` value.
// Returns lowercased address on success, null on any failure path.
// ---------------------------------------------------------------------------

function parseAsParam(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;
  if (!ADDR_RE.test(rawValue)) return null;
  return rawValue.toLowerCase();
}

// ---------------------------------------------------------------------------
// initRouter — idempotent (safe to call multiple times in tests).
// 1. Cold-load: read `?as=` and seed viewing.address.
// 2. popstate: re-read `?as=` on browser back/forward.
// 3. store → URL: subscribe to viewing.address and mirror via replaceState.
// ---------------------------------------------------------------------------

let _initialized = false;
let _unsubViewing = null;

export function initRouter() {
  if (_initialized) return;
  _initialized = true;

  // 1. Cold-load: read `?as=` from window.location.search and seed viewing.address.
  const initialParams = new URLSearchParams(window.location.search);
  const initialAs = parseAsParam(initialParams.get('as'));
  if (initialAs) {
    update('viewing.address', initialAs);
  }

  // 2. popstate (browser back/forward) — re-read `?as=` and update store.
  //    `next` may be null (absent or invalid) which clears viewing.address.
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const next = parseAsParam(params.get('as'));
    update('viewing.address', next);
  });

  // 3. store → URL mirror — subscribe to viewing.address changes and replaceState.
  //    Drops `?as=` when viewing is null OR equals connected.address (self-equal).
  //    Skips redundant replaceState when URL is already correct.
  _unsubViewing = subscribe('viewing.address', (addr) => {
    const url = new URL(window.location.href);
    const connected = get('connected.address');
    const isViewingSelf =
      addr && connected && String(addr).toLowerCase() === String(connected).toLowerCase();
    if (addr && !isViewingSelf) {
      url.searchParams.set('as', addr);
    } else {
      url.searchParams.delete('as');
    }
    if (url.toString() !== window.location.href) {
      window.history.replaceState({}, '', url);
    }
  });
}

// ---------------------------------------------------------------------------
// getViewedAddress — re-exported helper (precedence: viewing → connected → null).
// Consumed by main.js boot + polling re-arm subscribers.
// ---------------------------------------------------------------------------

export function getViewedAddress() {
  return get('viewing.address') || get('connected.address') || null;
}

// ---------------------------------------------------------------------------
// __resetForTest — node:test helper to tear down init flag + viewing subscriber.
// NOT for production consumers.
// ---------------------------------------------------------------------------

export function __resetForTest() {
  _initialized = false;
  if (_unsubViewing) {
    try { _unsubViewing(); } catch { /* swallow */ }
    _unsubViewing = null;
  }
}
