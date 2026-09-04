/**
 * `/craps/replays/v1/*` — the edge in front of the sealed Craps battle replays.
 *
 * Same shape as `functions/jackpots/[[path]].js`, and for the same reasons: Cloudflare Pages
 * proxies a bounded set of paths to the Fly origin, which reads them out of R2, and the edge
 * absorbs the fan-out so a synchronized battle audience never lands on the database.
 *
 * ## What this route must get right
 *
 * The two object classes have OPPOSITE cache lifetimes and the difference is load-bearing:
 *
 *   • the pointer (`latest.json`) is polled about once a second while a battle settles. It is
 *     tiny, and it must go stale FAST or a viewer waits on a cached `settling` after the battle
 *     went `ready`. It is also the only object that ever changes.
 *   • every child under `results/{digest}/` is content-addressed. It cannot change under its
 *     key, so it is `immutable` for a year and a returning viewer re-fetches nothing.
 *
 * The Cache API keeps the last known-good pointer resident far beyond its one-second freshness
 * so an origin blip degrades to a slightly stale token rather than a failed load — the poll on
 * the next second picks up the refreshed one.
 *
 * ## The path grammar is an allowlist
 *
 * Only the four shapes V1 defines are proxied. Everything else is a 404 at the edge, before a
 * subrequest exists. The Fly route applies the same grammar again — this is not the security
 * boundary, it is the first of two — because a public prefix that forwards arbitrary paths is a
 * read primitive over the whole bucket.
 *
 * This is PUBLIC data. The pointer is a cache-discovery token, not an authentication token, and
 * there is deliberately no per-viewer object, no signed URL, and no per-roll request.
 */

const ORIGIN = 'https://degenerus-db.fly.dev';
const inflight = new Map();
const POINTER_FRESH_MS = 1_000;
// Last-known-good residency for the pointer. Its X-Craps-Cached-At stamp still starts a
// background refresh after one second, so this extends outage tolerance, not staleness.
const POINTER_EDGE_TTL_SECONDS = 86_400;
const ORIGIN_TIMEOUT_MS = 3_000;

const BATTLE_KEY = /^[A-Za-z0-9_.:-]{1,160}$/;
const CHAIN_ID = /^[1-9][0-9]{0,15}$/;
const CONTRACT = /^0x[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{16,64}$/;
const SHARD = /^\d{4}\.json$/;

/**
 * 'pointer' | 'immutable' | null. Null means "not a craps replay artifact".
 *
 * Exported for the route-grammar test. Pages only ever calls `onRequest`, so the extra export
 * costs nothing at the edge and lets the allowlist be pinned without a deployed Worker.
 */
export function routeKind(pathname) {
  if (!pathname.startsWith('/craps/replays/v1/')) return null;
  const rest = pathname.slice('/craps/replays/v1/'.length);
  if (rest.includes('..') || rest.includes('//')) return null;
  const parts = rest.split('/');
  let battleOffset = 0;
  if (parts[0] === 'chains') {
    if (!CHAIN_ID.test(parts[1] ?? '')
      || parts[2] !== 'contracts'
      || !CONTRACT.test(parts[3] ?? '')
      || parts[4] !== 'battles') return null;
    battleOffset = 4;
  } else if (parts[0] !== 'battles') {
    return null;
  }
  const battleParts = parts.slice(battleOffset);
  let battleKey;
  try { battleKey = decodeURIComponent(battleParts[1] ?? ''); } catch { return null; }
  if (!BATTLE_KEY.test(battleKey)) return null;

  if (battleParts.length === 3 && battleParts[2] === 'latest.json') return 'pointer';
  if (battleParts[2] !== 'results' || !DIGEST.test(battleParts[3] ?? '')) return null;
  if (battleParts.length === 5
    && (battleParts[4] === 'manifest.json' || battleParts[4] === 'featured.json')) {
    return 'immutable';
  }
  if (battleParts.length === 6
    && battleParts[4] === 'seats'
    && SHARD.test(battleParts[5])) return 'immutable';
  return null;
}

function responseWithEdgeState(response, state) {
  const headers = new Headers(response.headers);
  headers.set('X-Craps-Edge', state);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function loadAndCache(context, cache, cacheKey, kind, pathname) {
  const originUrl = new URL(ORIGIN);
  originUrl.pathname = `/game${pathname}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORIGIN_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(originUrl.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json', 'accept-encoding': 'identity' },
      cf: {
        cacheEverything: true,
        // Key the subrequest under the ORIGIN url. Reusing the incoming Pages URL can collide
        // with the function route itself.
        cacheKey: originUrl.toString(),
        cacheTtl: kind === 'pointer' ? 1 : 31_536_000,
      },
    });
  } finally {
    clearTimeout(timer);
  }

  const headers = new Headers(upstream.headers);
  headers.delete('set-cookie');
  headers.delete('vary');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set(
    'Cache-Control',
    kind === 'pointer'
      ? `public, max-age=1, s-maxage=${POINTER_EDGE_TTL_SECONDS}, stale-while-revalidate=${POINTER_EDGE_TTL_SECONDS - 1}`
      : 'public, max-age=31536000, immutable',
  );
  if (kind === 'pointer' && upstream.ok) headers.set('X-Craps-Cached-At', String(Date.now()));
  // Never cache a failure. A 404 on an immutable child is a publication still in flight, and
  // caching it for a year would make the battle permanently unloadable.
  if (!upstream.ok) headers.set('Cache-Control', 'no-store');

  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
  if (upstream.ok) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export async function onRequest(context) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  }

  const url = new URL(context.request.url);
  const kind = routeKind(url.pathname);
  if (!kind) return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

  // Cache by canonical URL only. No query-string busting is accepted, so a client cannot turn a
  // one-second readiness poll into unbounded edge/origin keys.
  url.search = '';
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const cachedAt = Number(cached.headers.get('X-Craps-Cached-At'));
    const pointerIsStale = kind === 'pointer'
      && (!Number.isFinite(cachedAt) || Date.now() - cachedAt > POINTER_FRESH_MS);
    if (pointerIsStale) {
      // Serve the prior token immediately and refresh behind it. A synchronized audience polling
      // one battle must never queue on Fly; their next poll sees the newer token.
      let flight = inflight.get(cacheKey.url);
      if (!flight) {
        flight = loadAndCache(context, cache, cacheKey, kind, url.pathname)
          .finally(() => inflight.delete(cacheKey.url));
        inflight.set(cacheKey.url, flight);
      }
      context.waitUntil(flight.catch(() => {}));
    }
    const hit = responseWithEdgeState(cached, pointerIsStale ? 'STALE' : 'HIT');
    return context.request.method === 'HEAD'
      ? new Response(null, { status: hit.status, headers: hit.headers })
      : hit;
  }

  let flight = inflight.get(cacheKey.url);
  if (!flight) {
    flight = loadAndCache(context, cache, cacheKey, kind, url.pathname)
      .finally(() => inflight.delete(cacheKey.url));
    inflight.set(cacheKey.url, flight);
  }
  let originResponse;
  try {
    originResponse = await flight;
  } catch (_error) {
    return new Response(
      context.request.method === 'HEAD' ? null : JSON.stringify({ error: 'Craps replay edge origin unavailable' }),
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': '2',
          'X-Craps-Edge': 'ERROR',
        },
      },
    );
  }
  const miss = responseWithEdgeState(originResponse.clone(), 'MISS');
  return context.request.method === 'HEAD'
    ? new Response(null, { status: miss.status, headers: miss.headers })
    : miss;
}
