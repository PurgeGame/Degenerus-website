const ORIGIN = 'https://degenerus-db.fly.dev';
const inflight = new Map();

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

  const upstream = await fetch(originUrl.toString(), {
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

  const headers = new Headers(upstream.headers);
  headers.delete('set-cookie');
  headers.delete('vary');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set(
    'Cache-Control',
    kind === 'pointer'
      ? 'public, max-age=1, s-maxage=1, must-revalidate'
      : 'public, max-age=31536000, immutable',
  );
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
    const hit = responseWithEdgeState(cached, 'HIT');
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
  const miss = responseWithEdgeState((await flight).clone(), 'MISS');
  return context.request.method === 'HEAD'
    ? new Response(null, { status: miss.status, headers: miss.headers })
    : miss;
}
