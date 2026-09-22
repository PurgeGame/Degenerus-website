import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { CHAIN } from '../chain-config.js';
import { __resetSimRosterForTest, fetchProfiles } from '../profiles.js';

const LINKED = `0x${'1'.repeat(40)}`;
const SIMULATED = `0x${'2'.repeat(40)}`;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  __resetSimRosterForTest();
});

function response(body, ok = true) {
  return { ok, json: async () => body };
}

test('linked Discord profiles override the testnet simulation roster', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/api/profiles?')) {
      return response({
        profiles: [{
          address: LINKED,
          discord_name: 'WAR',
          discord_avatar: 'https://cdn.discordapp.com/avatars/war.png',
        }],
      });
    }
    return response({
      version: 1,
      players: [
        {
          address: LINKED,
          simIdentity: {
            discordName: 'Fake WAR',
            avatarUrl: `/players/${LINKED}/avatar.svg`,
            avatarSource: 'api',
          },
        },
        {
          address: SIMULATED,
          simIdentity: {
            discordName: 'Moon Goblin',
            avatarUrl: `/players/${SIMULATED}/avatar.svg`,
            avatarSource: 'api',
          },
        },
      ],
    });
  };

  const profiles = await fetchProfiles([LINKED.toUpperCase().replace('0X', '0x'), SIMULATED]);

  assert.deepEqual(profiles.get(LINKED), {
    name: 'WAR',
    avatar: 'https://cdn.discordapp.com/avatars/war.png',
  });
  assert.deepEqual(profiles.get(SIMULATED), {
    name: 'Moon Goblin',
    avatar: `https://degenerus-db.fly.dev/players/${SIMULATED}/avatar.svg`,
  });
  assert.equal(calls.filter((url) => url.endsWith('/players/sim')).length, 1);
});

test('the sim roster is cached and an unavailable linked-profile service still falls back', async () => {
  let simCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/profiles?')) throw new Error('session API unavailable');
    simCalls += 1;
    return response({
      version: 1,
      players: [{
        address: SIMULATED,
        simIdentity: {
          discordName: 'Quiet Koala',
          avatarUrl: '/specials/special_eth.svg',
          avatarSource: 'site',
        },
      }],
    });
  };

  const first = await fetchProfiles([SIMULATED]);
  const second = await fetchProfiles([SIMULATED]);

  assert.equal(first.get(SIMULATED)?.name, 'Quiet Koala');
  assert.equal(first.get(SIMULATED)?.avatar, '/specials/special_eth.svg');
  assert.equal(second.get(SIMULATED)?.name, 'Quiet Koala');
  assert.equal(simCalls, 1);
});

test('overlapping panels share per-wallet lookups and respect eight-address batches', async () => {
  const wallets = Array.from({ length: 20 }, (_, index) => `0x${index.toString(16).padStart(40, '0')}`);
  const batches = [];
  globalThis.fetch = async (url) => {
    if (!String(url).includes('/api/profiles?')) return response({ players: [] });
    const addresses = new URL(url, 'https://degener.us').searchParams.get('addresses').split(',');
    batches.push(addresses);
    return response({ profiles: addresses.map((address) => ({ address, discord_name: address })) });
  };
  for (let wave = 0; wave < 10; wave++) {
    const panels = await Promise.all([
      fetchProfiles(wallets.slice(0, 10)),
      fetchProfiles(wallets.slice(5, 15)),
      fetchProfiles(wallets.slice(10)),
    ]);
    for (const profiles of panels) assert.equal(profiles.size, 10);
  }
  assert.deepEqual(batches.map((batch) => batch.length), [8, 8, 4]);
  assert.equal(new Set(batches.flat()).size, 20);
});

test('in-flight lookups are shared even after the initial batch starts', async () => {
  let finish;
  let requests = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).includes('/api/profiles?')) return response({ players: [] });
    requests++;
    return new Promise((resolve) => { finish = resolve; });
  };
  const first = fetchProfiles([LINKED]);
  await new Promise(queueMicrotask);
  const second = fetchProfiles([LINKED]);
  finish(response({ profiles: [{ address: LINKED, discord_name: 'Shared' }] }));
  const results = await Promise.all([first, second]);
  assert.equal(requests, 1);
  for (const profiles of results) assert.equal(profiles.get(LINKED)?.name, 'Shared');
});

test('unlinked wallets are cached briefly and newly linked names appear after expiry', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 10_000 });
  let requests = 0;
  let profiles = [];
  globalThis.fetch = async (url) => {
    if (!String(url).includes('/api/profiles?')) return response({ players: [] });
    requests++;
    return response({ profiles });
  };
  assert.equal((await fetchProfiles([LINKED])).size, 0);
  profiles = [{ address: LINKED, discord_name: 'New name' }];
  assert.equal((await fetchProfiles([LINKED])).size, 0);
  assert.equal(requests, 1);
  t.mock.timers.tick(60_000);
  assert.equal((await fetchProfiles([LINKED])).get(LINKED)?.name, 'New name');
  assert.equal(requests, 2);
});

test('service failures back off across wallets and both services recover', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 10_000 });
  let available = false;
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    if (!available) return response({}, false);
    return String(url).includes('/api/profiles?')
      ? response({ profiles: [{ address: LINKED, discord_name: 'Recovered' }] })
      : response({ players: [{ address: SIMULATED, simIdentity: { discordName: 'Sim' } }] });
  };
  await fetchProfiles([LINKED]);
  assert.equal(requests, 2);
  available = true;
  assert.equal((await fetchProfiles([SIMULATED])).size, 0);
  assert.equal(requests, 2, 'a new wallet does not bypass service cooldown');
  t.mock.timers.tick(5_000);
  const recovered = await fetchProfiles([LINKED, SIMULATED]);
  assert.equal(recovered.get(LINKED)?.name, 'Recovered');
  assert.equal(recovered.get(SIMULATED)?.name, 'Sim');
  assert.equal(requests, 4);
});

test('a stalled lookup times out and leaves the shortened-address fallback available', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 });
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const request = fetchProfiles([LINKED]);
  await new Promise(queueMicrotask);
  t.mock.timers.tick(4_000);
  assert.equal((await request).size, 0);
});

test('cached identities stay bounded and cannot be changed by a consumer', async () => {
  const wallets = Array.from({ length: 1_008 }, (_, index) => `0x${index.toString(16).padStart(40, '0')}`);
  let requests = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).includes('/api/profiles?')) return response({ players: [] });
    requests++;
    return response({ profiles: new URL(url, 'https://degener.us').searchParams.get('addresses').split(',')
      .map((address) => ({ address, discord_name: 'Original' })) });
  };
  const initial = await fetchProfiles(wallets);
  assert.throws(() => { initial.get(wallets[0]).name = 'Changed'; }, TypeError);
  assert.equal(requests, 126);
  await fetchProfiles([wallets.at(-1)]);
  assert.equal(requests, 126);
  await fetchProfiles([wallets[0]]);
  assert.equal(requests, 127, 'oldest entries are evicted');
});

test('an explicit profile-link refresh bypasses cached unlinked identities', async () => {
  let profiles = [];
  globalThis.fetch = async (url) => String(url).includes('/api/profiles?')
    ? response({ profiles }) : response({ players: [] });
  assert.equal((await fetchProfiles([LINKED])).size, 0);
  profiles = [{ address: LINKED, discord_name: 'Just linked' }];
  assert.equal((await fetchProfiles([LINKED], { fresh: true })).get(LINKED)?.name, 'Just linked');
});

test('a fresh profile lookup cannot be overwritten by a pre-link in-flight response', async () => {
  let finishOld;
  let requests = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).includes('/api/profiles?')) return response({ players: [] });
    requests++;
    if (requests === 1) return new Promise((resolve) => { finishOld = resolve; });
    return response({ profiles: [{ address: LINKED, discord_name: 'Just linked' }] });
  };
  const old = fetchProfiles([LINKED]);
  await new Promise(queueMicrotask);
  const fresh = fetchProfiles([LINKED], { fresh: true });
  finishOld(response({ profiles: [] }));
  await old;
  assert.equal((await fresh).get(LINKED)?.name, 'Just linked');
  assert.equal((await fetchProfiles([LINKED])).get(LINKED)?.name, 'Just linked');
  assert.equal(requests, 2);
});

// --- chain mode: the published roster file replaces the session service ---

async function inChainMode(run) {
  const previous = CHAIN.readMode;
  CHAIN.readMode = 'chain';
  try { return await run(); } finally { CHAIN.readMode = previous; __resetSimRosterForTest(); }
}

// A roster as the builder writes it: stamped with the chain it was built for,
// which is what lets the simulated lane be trusted.
function roster(profiles) {
  return response({
    version: 2,
    generatedAt: '2026-09-22T00:00:00.000Z',
    chainId: CHAIN.id,
    count: Object.keys(profiles).length,
    profiles,
  });
}

test('chain mode resolves identities from one published roster request', async () => {
  await inChainMode(async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return roster({
        [LINKED]: { name: 'WAR', avatar: 'https://cdn.discordapp.com/avatars/11/a.png' },
        [SIMULATED]: { name: 'Moon Goblin', avatar: null },
      });
    };

    const profiles = await fetchProfiles([LINKED.toUpperCase().replace('0X', '0x'), SIMULATED]);

    assert.deepEqual(profiles.get(LINKED), { name: 'WAR', avatar: 'https://cdn.discordapp.com/avatars/11/a.png' });
    assert.deepEqual(profiles.get(SIMULATED), { name: 'Moon Goblin', avatar: null });
    assert.throws(() => { profiles.get(LINKED).name = 'Changed'; }, TypeError);
    assert.deepEqual(calls, ['/app/assets/discord-roster.json'],
      'no session-service or sim-roster request is made in chain mode');

    // Every later panel mount shares the one fetch.
    await fetchProfiles([SIMULATED]);
    assert.equal(calls.length, 1);
  });
});

test('chain mode omits unlisted wallets and refuses an off-CDN avatar', async () => {
  await inChainMode(async () => {
    globalThis.fetch = async () => roster({
      [LINKED]: { name: 'WAR', avatar: 'https://evil.example.com/x.png' },
      [`0x${'9'.repeat(40)}`]: { name: '   ', avatar: null },
    });

    const profiles = await fetchProfiles([LINKED, SIMULATED, `0x${'9'.repeat(40)}`]);

    assert.deepEqual(profiles.get(LINKED), { name: 'WAR', avatar: null });
    assert.equal(profiles.has(SIMULATED), false, 'an unlinked wallet keeps its shortened-address fallback');
    assert.equal(profiles.has(`0x${'9'.repeat(40)}`), false, 'a blank name is not an identity');
  });
});

test('a missing roster file degrades to addresses and is not re-requested per mount', async () => {
  await inChainMode(async () => {
    let requests = 0;
    globalThis.fetch = async () => { requests++; return response(null, false); };

    assert.equal((await fetchProfiles([LINKED])).size, 0);
    assert.equal((await fetchProfiles([SIMULATED])).size, 0);
    assert.equal((await fetchProfiles([LINKED])).size, 0);
    assert.equal(requests, 1, 'the retry window absorbs the mount wave');

    // A publish that lands the file is picked up by an explicit refresh.
    globalThis.fetch = async () => roster({ [LINKED]: { name: 'Just linked', avatar: null } });
    assert.equal((await fetchProfiles([LINKED], { fresh: true })).get(LINKED)?.name, 'Just linked');
  });
});

test('a real Discord link outranks a simulated identity for the same wallet', async () => {
  await inChainMode(async () => {
    globalThis.fetch = async () => roster({
      [LINKED]: { name: 'WAR', avatar: 'https://cdn.discordapp.com/avatars/496/abc.png' },
      [SIMULATED]: {
        name: 'Ritual Bot',
        avatar: null,
        sim: { type: 'afkQuestFlip', seed: '12b56589792754c4dd201306502a838448971f4c', colors: ['#17321d', '#9cff57', '#ffd23f'] },
      },
    });

    const profiles = await fetchProfiles([LINKED, SIMULATED]);

    assert.deepEqual(profiles.get(LINKED), { name: 'WAR', avatar: 'https://cdn.discordapp.com/avatars/496/abc.png' });
    assert.equal(profiles.get(SIMULATED).name, 'Ritual Bot');
    assert.match(profiles.get(SIMULATED).avatar, /^data:image\/svg\+xml;charset=utf-8,/,
      'a bot face is drawn locally, with no API to ask');
  });
});

test('a simulated face is drawn only for the wallets a panel actually asked about', async () => {
  await inChainMode(async () => {
    const sim = { type: 'degen', seed: '12b56589792754c4dd201306502a838448971f4c', colors: ['#17321d', '#9cff57', '#ffd23f'] };
    globalThis.fetch = async () => roster({
      [LINKED]: { name: 'Bot One', avatar: null, sim },
      [SIMULATED]: { name: 'Bot Two', avatar: null, sim },
    });

    const first = await fetchProfiles([LINKED]);
    assert.ok(first.get(LINKED).avatar.startsWith('data:image/svg+xml'));
    assert.equal(first.has(SIMULATED), false);

    // The second wallet materializes on its own request, and the first is
    // handed back as the same frozen object rather than redrawn.
    const second = await fetchProfiles([LINKED, SIMULATED]);
    assert.equal(second.get(LINKED), first.get(LINKED));
    assert.ok(second.get(SIMULATED).avatar.startsWith('data:image/svg+xml'));
  });
});

test('a roster built for another chain contributes its links but never its bots', async () => {
  await inChainMode(async () => {
    const sim = { type: 'degen', seed: '12b56589792754c4dd201306502a838448971f4c', colors: ['#17321d', '#9cff57', '#ffd23f'] };
    globalThis.fetch = async () => response({
      version: 2,
      chainId: CHAIN.id + 1, // a roster exported against a different deployment
      profiles: {
        [LINKED]: { name: 'WAR', avatar: 'https://cdn.discordapp.com/avatars/496/abc.png' },
        [SIMULATED]: { name: 'Ritual Bot', avatar: null, sim },
      },
    });

    const profiles = await fetchProfiles([LINKED, SIMULATED]);

    assert.deepEqual(profiles.get(LINKED), { name: 'WAR', avatar: 'https://cdn.discordapp.com/avatars/496/abc.png' },
      'a wallet’s Discord account is the same account on any chain');
    assert.deepEqual(profiles.get(SIMULATED), { name: 'Ritual Bot', avatar: null },
      'the invented face is dropped; only the bare name survives');
  });
});

test('a roster with no chain stamp is treated as foreign for the simulated lane', async () => {
  await inChainMode(async () => {
    globalThis.fetch = async () => response({
      version: 1,
      profiles: {
        [SIMULATED]: {
          name: 'Ritual Bot',
          avatar: null,
          sim: { type: 'degen', seed: '12b56589792754c4dd201306502a838448971f4c', colors: ['#17321d', '#9cff57', '#ffd23f'] },
        },
      },
    });
    assert.equal((await fetchProfiles([SIMULATED])).get(SIMULATED).avatar, null);
  });
});
