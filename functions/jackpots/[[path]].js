const ORIGIN = 'https://degenerus-db.fly.dev';
const inflight = new Map();
const POINTER_FRESH_MS = 1_000;
// Cache API keeps the last known-good pointer resident for a full day. Its
// X-Jackpot-Cached-At timestamp still starts a background refresh after one
// second, so this extends outage tolerance rather than pointer freshness.
const POINTER_EDGE_TTL_SECONDS = 86_400;
const ORIGIN_TIMEOUT_MS = 3_000;

function routeKind(pathname) {
  if (pathname === '/jackpots/latest.json') return 'pointer';
  if (/^\/jackpots\/results\/\d+-[0-9a-f]{16}\.json$/.test(pathname)) return 'result';
  return null;
}

function responseWithEdgeState(response, state) {
  const headers = new Headers(response.headers);
  headers.set('X-Jackpot-Edge', state);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function loadAndCache(context, cache, cacheKey, kind, pathname) {
  const originUrl = new URL(ORIGIN);
  originUrl.pathname = `/game/jackpot/cdn${pathname.slice('/jackpots'.length)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORIGIN_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(originUrl.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json', 'accept-encoding': 'identity' },
      // Pages Functions run on Cloudflare Workers. This turns the external Fly
      // subrequest into an edge-cacheable object even before Cache API storage
      // finishes, reducing simultaneous cold-miss fan-out between isolates.
      cf: {
        cacheEverything: true,
        // Keep the subrequest cache under the Fly origin URL. Reusing the
        // incoming Pages URL here can collide with the function route itself.
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
  if (kind === 'pointer' && upstream.ok) {
    headers.set('X-Jackpot-Cached-At', String(Date.now()));
  }
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

  // Cache by canonical URL only. No query-string cache busting is accepted, so
  // clients cannot turn a tiny readiness check into unbounded edge/origin keys.
  url.search = '';
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const cachedAt = Number(cached.headers.get('X-Jackpot-Cached-At'));
    const pointerIsStale = kind === 'pointer'
      && (!Number.isFinite(cachedAt) || Date.now() - cachedAt > POINTER_FRESH_MS);
    if (pointerIsStale) {
      // Never make the synchronized jackpot audience wait on Fly. Return the
      // tiny prior token; their one-second poll will see the refreshed token on
      // its next pass. Cache API's last-good residency makes this true stale-
      // while-revalidate rather than a hard one-second cache cliff.
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
    const unavailable = new Response(
      context.request.method === 'HEAD'
        ? null
        : JSON.stringify({ error: 'Jackpot edge origin unavailable' }),
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': '2',
          'X-Jackpot-Edge': 'ERROR',
        },
      },
    );
    return unavailable;
  }
  const miss = responseWithEdgeState(originResponse.clone(), 'MISS');
  return context.request.method === 'HEAD'
    ? new Response(null, { status: miss.status, headers: miss.headers })
    : miss;
}
