// play/app/day-packs-fetch.js -- shared PACKS-V2 fetcher with in-flight dedup
//
// packs-panel needs the day-keyed packs response on every (player, day)
// change. This helper dedups at the wire level: first call fires the HTTP
// request; second call (same key, in flight) returns the in-flight promise.
// On settle, the entry is removed from the in-flight Map -- subsequent
// calls with the same key fire a fresh fetch (no caching, to avoid
// stale-scrub cross-contamination across days).
//
// Helper shape per .planning/phases/52-tickets-packs-jackpot/PACKS-V2-SPEC.md
// lines 158-170. Mirrors the in-flight pattern of play/app/tickets-fetch.js
// without the single-slot result cache (day-keyed surface scrubs frequently).
//
// SHELL-01: imports only from the narrow play/app/constants.js re-export.

import { API_BASE } from './constants.js';

const inflight = new Map();

export async function fetchDayPacks(addr, day) {
  const key = `${addr}:${day}`;
  if (inflight.has(key)) return inflight.get(key);
  const promise = fetch(`${API_BASE}/player/${addr}/packs?day=${day}`)
    .then((r) => (r.ok ? r.json() : null))
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
</content>
</invoke>