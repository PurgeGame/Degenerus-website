// /app/craps/replay-fetch.js — where the sealed replay artifacts actually live.
//
// On the deployed site the artifacts are same-origin: Cloudflare Pages proxies
// `/craps/replays/v1/*` to the database API's `/game/craps/replays/v1/*` (see
// functions/craps/[[path]].js), and the loader's relative paths hit the CDN edge.
// Local dev serves /app/ from a bare static file server with nothing behind that
// prefix, so every pointer poll 404s and a settled battle reads "Checking replay"
// forever. Route the same relative paths at the hosted data plane instead — the
// app already shares that one data plane for every other read (see constants.js).

import { API_BASE } from '../app/constants.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** '' on the deployed site; the hosted API's game prefix on a local static server. */
export function crapsReplayFetchBase(hostname = globalThis.location?.hostname) {
  return LOCAL_HOSTS.has(String(hostname ?? '')) ? `${API_BASE}/game` : '';
}

/** Drop-in `fetchImpl` for `loadCrapsReplay` / `openCrapsReplayTable`. */
export function crapsReplayFetch(path, init) {
  return fetch(`${crapsReplayFetchBase()}${path}`, init);
}
