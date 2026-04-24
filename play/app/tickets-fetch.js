// play/app/tickets-fetch.js -- shared INTEG-01 fetcher with in-flight dedup
//
// Two Custom Elements (<tickets-panel>, <packs-panel>) need the same
// INTEG-01 response on every (player, level, day) change. This helper
// dedups at the wire level: first call fires the HTTP request; second
// call (same key, in flight) returns the in-flight promise. Single-slot
// cache by key prevents refetch within the same key. Per Pitfall 9, ONE
// slot (not a full cache) keeps memory bounded.
//
// Panel-level stale-guard (#ticketsFetchId / #packsFetchId) is a separate
// concern: the helper dedups wire requests; the panel dedups stale renders.
//
// SHELL-01: imports only from the narrow play/app/constants.js re-export.

import { API_BASE } from './constants.js';

let inFlight = null;
let lastKey = null;
let lastResult = null;
let lastResultKey = null;

export async function fetchTicketsByTrait(addr, level, day) {
  const key = `${addr}::${level}::${day}`;
  if (key === lastResultKey && lastResult) return lastResult;
  if (key === lastKey && inFlight) return inFlight;
  lastKey = key;
  const url = `${API_BASE}/player/${encodeURIComponent(addr)}/tickets/by-trait`
            + `?level=${encodeURIComponent(level)}&day=${encodeURIComponent(day)}`;
  inFlight = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      lastResult = data;
      lastResultKey = key;
      inFlight = null;
      return data;
    })
    .catch((err) => {
      inFlight = null;
      throw err;
    });
  return inFlight;
}
