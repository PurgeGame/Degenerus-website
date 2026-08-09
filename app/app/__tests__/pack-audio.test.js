import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { afterEach, describe, test } from 'node:test';

const originals = {
  window: globalThis.window,
  fetch: globalThis.fetch,
  localStorage: globalThis.localStorage,
};

let importNonce = 0;

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.state = 'suspended';
    this.destination = {};
    this.resumeCalls = 0;
    this.decodeCalls = 0;
    this.startCalls = 0;
    FakeAudioContext.instances.push(this);
  }

  resume() {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  decodeAudioData(bytes) {
    this.decodeCalls += 1;
    assert.ok(bytes.byteLength > 0);
    return Promise.resolve({ decoded: true });
  }

  createBufferSource() {
    return {
      buffer: null,
      connect() {},
      start: () => { this.startCalls += 1; },
    };
  }

  createGain() {
    return { gain: { value: 0 }, connect() {} };
  }
}

async function freshModule() {
  importNonce += 1;
  return import(`../pack-audio.js?pack-audio-test=${importNonce}`);
}

afterEach(() => {
  if (originals.window === undefined) delete globalThis.window;
  else globalThis.window = originals.window;
  if (originals.fetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = originals.fetch;
  if (originals.localStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originals.localStorage;
  FakeAudioContext.instances = [];
});

describe('pack audio readiness', () => {
  test('preloads real bytes before creating the gesture-gated AudioContext', async () => {
    const requests = [];
    globalThis.localStorage = storage();
    globalThis.window = { AudioContext: FakeAudioContext };
    globalThis.fetch = async (path) => {
      requests.push(path);
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      };
    };
    const audio = await freshModule();

    assert.equal(await audio.preloadPackOpen(), true);
    assert.deepEqual(requests, ['/app/sounds/jackpot/cabinet-stop.wav']);
    assert.equal(FakeAudioContext.instances.length, 0,
      'network preload does not waste browser activation before the first gesture');

    assert.equal(audio.warmupPackAudio(), true);
    const context = FakeAudioContext.instances[0];
    assert.equal(context.resumeCalls, 1, 'the gesture primer resumes synchronously');
    await audio.playPackOpen();
    assert.equal(context.decodeCalls, 1, 'the already-fetched bytes decode once');
    assert.equal(context.startCalls, 1, 'the later reveal starts an already-ready cue');
    assert.equal(requests.length, 1, 'playback does not refetch the cue');
  });

  test('the selected cue exists and muted sessions do no preload work', async () => {
    assert.ok(statSync(new URL('../../sounds/jackpot/cabinet-stop.wav', import.meta.url)).size > 0);
    let fetches = 0;
    globalThis.localStorage = storage({ 'degenerus.sfxMuted': '1' });
    globalThis.window = { AudioContext: FakeAudioContext };
    globalThis.fetch = async () => { fetches += 1; throw new Error('should not fetch'); };
    const audio = await freshModule();

    assert.equal(await audio.preloadPackOpen(), false);
    assert.equal(audio.warmupPackAudio(), false);
    await audio.playPackOpen();
    assert.equal(fetches, 0);
    assert.equal(FakeAudioContext.instances.length, 0);
  });
});
