import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { onRequest } from '../../../functions/jackpots/[[path]].js';

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
const originalDateNow = Date.now;

let stored;
let originCalls;
let waits;
let now;

beforeEach(() => {
  stored = new Map();
  originCalls = [];
  waits = [];
  now = 1_700_000_000_000;
  Date.now = () => now;
  globalThis.caches = {
    default: {
      async match(request) {
        const response = stored.get(request.url);
        return response?.clone() ?? null;
      },
      async put(request, response) {
        stored.set(request.url, response.clone());
      },
    },
  };
  globalThis.fetch = async (url, init) => {
    originCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ schemaVersion: 1, day: 159 }), {
      headers: { 'content-type': 'application/json', vary: 'Origin' },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
  Date.now = originalDateNow;
});

function context(path, method = 'GET') {
  return {
    request: new Request(`https://degener.us${path}`, { method }),
    waitUntil(promise) { waits.push(Promise.resolve(promise)); },
  };
}

test('latest token is fetched once from Fly and then served by the edge cache', async () => {
  const first = await onRequest(context('/jackpots/latest.json'));
  await Promise.all(waits);
  const second = await onRequest(context('/jackpots/latest.json'));

  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-jackpot-edge'), 'MISS');
  assert.equal(second.headers.get('x-jackpot-edge'), 'HIT');
  assert.match(first.headers.get('cache-control'), /max-age=1/);
  assert.match(first.headers.get('cache-control'), /s-maxage=30/);
  assert.equal(originCalls.length, 1);
  assert.equal(originCalls[0].url, 'https://degenerus-db.fly.dev/game/jackpot/cdn/latest.json');
  assert.equal(originCalls[0].init.cf.cacheTtl, 1);
});

test('stale latest token returns immediately while one background refresh replaces it', async () => {
  const first = await onRequest(context('/jackpots/latest.json'));
  await Promise.all(waits);
  assert.equal(first.headers.get('x-jackpot-edge'), 'MISS');

  waits = [];
  now += 1_001;
  const stale = await onRequest(context('/jackpots/latest.json'));
  assert.equal(stale.headers.get('x-jackpot-edge'), 'STALE');
  assert.equal(originCalls.length, 2);
  await Promise.all(waits);

  const refreshed = await onRequest(context('/jackpots/latest.json'));
  assert.equal(refreshed.headers.get('x-jackpot-edge'), 'HIT');
  assert.equal(originCalls.length, 2);
});

test('immutable result receives a year-long edge cache policy', async () => {
  const response = await onRequest(context('/jackpots/results/159-0123456789abcdef.json'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /max-age=31536000/);
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal(originCalls[0].init.cf.cacheTtl, 31_536_000);
});

test('rejects arbitrary paths and methods without touching Fly', async () => {
  const path = await onRequest(context('/jackpots/../../history/private.json'));
  const method = await onRequest(context('/jackpots/latest.json', 'POST'));
  assert.equal(path.status, 404);
  assert.equal(method.status, 405);
  assert.equal(originCalls.length, 0);
});
