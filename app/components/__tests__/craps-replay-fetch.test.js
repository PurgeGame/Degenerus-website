/**
 * Where the sealed craps replay artifacts are fetched FROM.
 *
 * The deployed site proxies `/craps/replays/v1/*` same-origin; a local static server does
 * not, and a loader left on relative paths there polls 404s forever — the run-#43 symptom
 * of a settled battle reading "Checking replay" until the tab dies. The base must move to
 * the hosted data plane exactly on a local host, and nowhere else.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { crapsReplayFetchBase } from '../../craps/replay-fetch.js';
import { API_BASE } from '../../app/constants.js';

test('the deployed site keeps its same-origin relative paths', () => {
  assert.equal(crapsReplayFetchBase('degener.us'), '');
  assert.equal(crapsReplayFetchBase('www.degener.us'), '');
  assert.equal(crapsReplayFetchBase(undefined), '');
});

test('a local static server routes through the hosted game API', () => {
  const base = `${API_BASE}/game`;
  assert.equal(crapsReplayFetchBase('localhost'), base);
  assert.equal(crapsReplayFetchBase('127.0.0.1'), base);
  assert.match(base, /^https:\/\//);
});

test('every replay fetch carries a deadline so a hung pointer cannot park the loader', async () => {
  const { crapsReplayFetch, CRAPS_REPLAY_FETCH_TIMEOUT_MS } = await import('../../craps/replay-fetch.js');
  const priorFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { ok: true }; };
  try {
    await crapsReplayFetch('/craps/replays/v1/battles/b1/latest.json', { headers: { accept: 'application/json' } });
    assert.equal(seen.length, 1);
    assert.ok(seen[0].init.signal instanceof AbortSignal, 'a timeout signal is attached');
    assert.equal(seen[0].init.signal.aborted, false);
    assert.equal(seen[0].init.headers.accept, 'application/json', 'the caller init survives');
    assert.equal(CRAPS_REPLAY_FETCH_TIMEOUT_MS, 20_000);

    const own = new AbortController();
    await crapsReplayFetch('/x', { signal: own.signal });
    assert.equal(seen[1].init.signal, own.signal, 'a caller-supplied signal is kept');
  } finally {
    if (priorFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = priorFetch;
  }
});
