// Tests for the session/Discord Pages Function that replaced the destroyed api.degener.us.
//
// The D1 binding is backed by a REAL SQLite database (node:sqlite) running the REAL migration,
// not a hand-written mock. A mock would happily accept the statements whether or not they are
// valid SQLite, which is the only thing worth proving about a port whose whole premise is
// "D1 is SQLite, so the schema and statements move verbatim".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Wallet } from 'ethers';

import { onRequest } from '../../../functions/session/[[path]].js';
import { openSession, sealSession } from '../../../functions/session/_lib/session.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATION = readFileSync(resolve(root, 'db/migrations/d1/0001_init.sql'), 'utf8');
const SECRET = 'test-secret-value-not-a-real-key';

/** Minimal D1 surface (prepare/bind/first/all/run) over node:sqlite. */
function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION);
  return {
    _db: db,
    prepare(sql) {
      let params = [];
      const api = {
        bind(...values) { params = values; return api; },
        async first() { return db.prepare(sql).get(...params) ?? null; },
        async all() { return { results: db.prepare(sql).all(...params) }; },
        async run() { return db.prepare(sql).run(...params); },
      };
      return api;
    },
  };
}

const env = (overrides = {}) => ({
  SESSIONS_DB: makeD1(),
  SESSION_SECRET: SECRET,
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret',
  DISCORD_REDIRECT_URI: 'https://degener.us/session/auth/discord/callback',
  FRONTEND_REDIRECT: 'https://degener.us',
  ...overrides,
});

function call(path, { method = 'GET', body, cookie, environment } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', `degenerus_session=${encodeURIComponent(cookie)}`);
  const request = new Request(`https://degener.us/session${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return onRequest({ request, env: environment });
}

/** The session cookie a response just set, as its decoded token. */
function cookieFrom(response) {
  const header = response.headers.get('set-cookie') ?? '';
  const match = header.match(/degenerus_session=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

describe('signed session cookies', () => {
  test('round-trips its payload and rejects tampering', async () => {
    const token = await sealSession(SECRET, { walletAddress: '0xabc' });
    assert.equal((await openSession(SECRET, token)).walletAddress, '0xabc');

    // Flip one character of the payload; the signature must no longer verify.
    const [payload, signature] = token.split('.');
    const flipped = `${payload.slice(0, -1)}${payload.at(-1) === 'A' ? 'B' : 'A'}.${signature}`;
    assert.equal(await openSession(SECRET, flipped), null, 'a tampered payload is not a session');
    assert.equal(await openSession('another-secret', token), null, 'a foreign key is not a session');
    assert.equal(await openSession(SECRET, 'garbage'), null);
  });

  test('an expired token is refused even though its signature is valid', async () => {
    // The expiry lives INSIDE the signed payload precisely so a client that ignores the cookie's
    // Max-Age cannot extend its own session.
    const token = await sealSession(SECRET, { walletAddress: '0xabc' }, { maxAgeSeconds: -1 });
    assert.equal(await openSession(SECRET, token), null);
  });
});

describe('session service routes', () => {
  test('health reports whether the D1 binding is actually usable', async () => {
    const bound = await (await call('/health', { environment: env() })).json();
    assert.deepEqual({ ok: bound.ok, database: bound.database }, { ok: true, database: 'ok' });

    const unbound = await (await call('/health', { environment: env({ SESSIONS_DB: null }) })).json();
    assert.equal(unbound.database, 'unbound', 'an unbound Function is distinguishable from an outage');
  });

  test('a wallet signature over the issued nonce establishes the session', async () => {
    const environment = env();
    const wallet = Wallet.createRandom();
    const address = wallet.address.toLowerCase();

    const nonceResponse = await call('/api/wallet/nonce', { method: 'POST', body: { address }, environment });
    const { message } = await nonceResponse.json();
    assert.match(message, /^Degenerette login\nNonce: [0-9a-f]{32}$/, 'the wire message format is unchanged');

    const verified = await call('/api/wallet/verify', {
      method: 'POST', body: { address, signature: await wallet.signMessage(message) }, environment,
    });
    assert.equal(verified.status, 200);
    const payload = await verified.json();
    assert.equal(payload.player.eth_address, address);
    assert.ok(!('nonce' in payload.player), 'the nonce never reaches the client');

    const session = await openSession(SECRET, cookieFrom(verified));
    assert.equal(session.walletAddress, address, 'the response sets a session bound to the wallet');

    // /api/player is the session-scoped read the client uses to show linked state.
    const me = await call('/api/player', { cookie: cookieFrom(verified), environment });
    assert.equal((await me.json()).player.eth_address, address);
  });

  test('a signature from a different wallet is rejected', async () => {
    const environment = env();
    const wallet = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const address = wallet.address.toLowerCase();
    const { message } = await (await call('/api/wallet/nonce', { method: 'POST', body: { address }, environment })).json();

    const response = await call('/api/wallet/verify', {
      method: 'POST', body: { address, signature: await attacker.signMessage(message) }, environment,
    });
    assert.equal(response.status, 401, 'signing someone else’s nonce does not authenticate as them');
  });

  test('a nonce is single-use, so a captured signature cannot be replayed', async () => {
    const environment = env();
    const wallet = Wallet.createRandom();
    const address = wallet.address.toLowerCase();
    const { message } = await (await call('/api/wallet/nonce', { method: 'POST', body: { address }, environment })).json();
    const signature = await wallet.signMessage(message);

    assert.equal((await call('/api/wallet/verify', { method: 'POST', body: { address, signature }, environment })).status, 200);
    const replay = await call('/api/wallet/verify', { method: 'POST', body: { address, signature }, environment });
    assert.equal(replay.status, 400, 'the nonce is cleared on first use');
  });

  test('an anonymous session cannot read a player row', async () => {
    assert.equal((await call('/api/player', { environment: env() })).status, 401);
  });

  test('OAuth start issues state, and a callback without matching state is refused', async () => {
    const environment = env();
    const start = await call('/auth/discord', { environment });
    assert.equal(start.status, 302);
    const location = new URL(start.headers.get('location'));
    assert.equal(location.origin + location.pathname, 'https://discord.com/api/oauth2/authorize');
    assert.equal(location.searchParams.get('scope'), 'identify guilds.join');
    const state = location.searchParams.get('state');
    assert.equal((await openSession(SECRET, cookieFrom(start))).discordState, state);

    // ⛔ CSRF: a callback carrying someone else's state, or none, must not open a session.
    for (const attempt of ['?code=abc&state=wrong', '?code=abc', '']) {
      const response = await call(`/auth/discord/callback${attempt}`, { cookie: cookieFrom(start), environment });
      assert.equal(response.status, 400, `callback ${attempt || '(empty)'} is refused`);
    }
    const noSession = await call(`/auth/discord/callback?code=abc&state=${state}`, { environment });
    assert.equal(noSession.status, 400, 'a matching state with no session cookie is still refused');
  });

  test('profiles only expose wallets that actually linked a Discord identity', async () => {
    const environment = env();
    const linked = `0x${'1'.repeat(40)}`;
    const bare = `0x${'2'.repeat(40)}`;
    environment.SESSIONS_DB._db.exec(
      `INSERT INTO players (eth_address, discord_id, discord_name, discord_avatar)
         VALUES ('${linked}', '42', 'Linked Degen', 'https://cdn/a.png');
       INSERT INTO players (eth_address) VALUES ('${bare}');`,
    );
    const response = await call(`/api/profiles?addresses=${linked},${bare}`, { environment });
    const { profiles } = await response.json();
    assert.deepEqual(profiles.map((p) => p.address), [linked],
      'an unlinked wallet is absent rather than present-and-empty');
  });

  test('an unknown route is a 404, not a fall-through', async () => {
    assert.equal((await call('/api/nope', { environment: env() })).status, 404);
  });
});
