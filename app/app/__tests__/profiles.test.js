import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

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
