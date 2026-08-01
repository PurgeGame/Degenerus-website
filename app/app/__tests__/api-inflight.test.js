// Shared REST-client load behavior.
//
// The app mounts many panels together; all of them import beta/app/api.js.
// Identical GETs must share one in-flight network request, while completed
// responses must not be retained (post-transaction refreshes need fresh data).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const priorDocument = globalThis.document;
const priorFetch = globalThis.fetch;
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
};

const api = await import('../../../beta/app/api.js');

after(() => {
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
  if (priorFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = priorFetch;
});

test('identical concurrent JSON reads share one network request', async () => {
  let calls = 0;
  let finish;
  globalThis.fetch = () => {
    calls += 1;
    return new Promise((resolve) => {
      finish = () => resolve({
        ok: true,
        status: 200,
        json: async () => ({ player: 'shared' }),
      });
    });
  };

  const first = api.fetchJSON('/player/0xabc');
  const second = api.fetchJSON('/player/0xabc');
  const third = api.fetchJSON('/player/0xabc');
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await Promise.all([first, second, third]), [
    { player: 'shared' },
    { player: 'shared' },
    { player: 'shared' },
  ]);
});

test('completed and failed requests leave the in-flight cache', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? { ok: false, status: 503, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ fresh: true }) };
  };

  const failedA = api.fetchJSON('/game/state');
  const failedB = api.fetchJSON('/game/state');
  const failures = await Promise.allSettled([failedA, failedB]);
  assert.equal(calls, 1, 'the failing attempt is shared too');
  assert.ok(failures.every((result) => result.status === 'rejected'));

  assert.deepEqual(await api.fetchJSON('/game/state'), { fresh: true });
  assert.equal(calls, 2, 'a later call gets a fresh network attempt');
});
