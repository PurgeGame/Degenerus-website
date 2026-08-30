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
