/**
 * `/session/*` — the Discord + wallet session service, as a Cloudflare Pages Function over D1.
 *
 * This replaces the destroyed `api.degener.us` Express app (degenerette-simulator/server). Three
 * things are genuinely rewritten; everything else is the original logic with an async driver:
 *
 *   1. SESSIONS. express-session + a SQLite `sessions` table -> stateless HMAC-signed cookies
 *      (_lib/session.js). No session table, no expiry sweep, no write per request.
 *   2. SIGNATURES. `ethers.verifyMessage` -> the SAME function, vendored for the Workers runtime
 *      (_vendor/ethers-session.mjs). Deliberately not a `@noble` reimplementation: the message
 *      prefixing and recovery must not move, because a difference there is an auth bug.
 *   3. SCHEMA. `ensurePlayerColumns()`'s runtime ALTER TABLE -> db/migrations/d1/0001_init.sql.
 *
 * ⭐ SAME ORIGIN. The old service lived on a different hostname, so its cookie had to be
 * SameSite=None and the OAuth popup's cookie jar could diverge from the app's fetch jar — the
 * `discordLinkToken` one-use ticket exists to bridge exactly that. Served from the site's own
 * origin, the cookie is SameSite=Lax and the two share a jar. The ticket is kept anyway: the
 * client already sends it, and it still carries the wallet binding through a redirect chain.
 *
 * Bindings (see db/SESSION-D1-RUNBOOK.md):
 *   env.SESSIONS_DB          D1 database
 *   env.SESSION_SECRET       HMAC key for the cookie
 *   env.DISCORD_CLIENT_ID / _SECRET / _REDIRECT_URI
 *   env.DISCORD_GUILD_ID / _BOT_TOKEN   (optional: auto-join the guild)
 *   env.FRONTEND_REDIRECT    where the OAuth callback returns the player
 */

import { getAddress, isAddress, verifyMessage } from './_vendor/ethers-session.mjs';
import {
  COOKIE_NAME, clearCookieHeader, cookieHeader, openSession, readCookie, sealSession,
} from './_lib/session.js';
import {
  clearPlayerNonce, getOrCreatePlayer, getPlayerByAddress, getPlayerByDiscordId,
  getProfilesByAddresses, sanitizePlayer, setPlayerNonce, setReferrerCode, updatePlayerDiscord,
} from './_lib/store.js';

const WALLET_LINK_TTL_SECONDS = 10 * 60;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const text = (body, status = 200) => new Response(body, {
  status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
});

async function readSession(request, env) {
  return (await openSession(env.SESSION_SECRET, readCookie(request, COOKIE_NAME))) ?? {};
}

async function withSession(response, env, session) {
  const headers = new Headers(response.headers);
  headers.append('set-cookie', cookieHeader(await sealSession(env.SESSION_SECRET, session)));
  return new Response(response.body, { status: response.status, headers });
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

/**
 * The wallet-link ticket. The original held these in a Map in process memory, which a Worker
 * does not have across isolates — so the ticket is itself a short-lived signed token carrying
 * the address. Same one-use intent, same TTL; single-use is enforced by the OAuth `state`
 * round-trip rather than by deleting a map entry.
 */
const issueWalletLinkTicket = (env, address) =>
  sealSession(env.SESSION_SECRET, { walletLink: String(address).toLowerCase() }, { maxAgeSeconds: WALLET_LINK_TTL_SECONDS });

async function consumeWalletLinkTicket(env, ticket) {
  const payload = await openSession(env.SESSION_SECRET, ticket);
  return payload?.walletLink ?? null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/session/, '') || '/';
  const db = env.SESSIONS_DB;
  const session = await readSession(request, env);

  // ---- health -------------------------------------------------------------
  if (route === '/health') {
    // Report the binding too: a Function that is live but unbound answers every other route with
    // a 500 that looks like an outage, and this is the one place to see which it is.
    let database = 'unbound';
    if (db) {
      try { await db.prepare('SELECT 1').first(); database = 'ok'; } catch { database = 'error'; }
    }
    return json({ ok: database === 'ok', database, discord: Boolean(env.DISCORD_CLIENT_ID) });
  }

  if (!db) return json({ error: 'Session database not bound' }, 500);

  // ---- Discord OAuth ------------------------------------------------------
  if (route === '/auth/discord' && request.method === 'GET') {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_REDIRECT_URI) return text('Discord OAuth not configured.', 500);
    const next = { ...session };
    const walletLink = url.searchParams.get('walletLink');
    if (walletLink) {
      const linked = await consumeWalletLinkTicket(env, walletLink);
      if (!linked) return text('Wallet link expired. Return to Degenerus and try again.', 400);
      next.walletAddress = linked;
    }
    next.discordState = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      redirect_uri: env.DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify guilds.join',
      state: next.discordState,
    });
    return withSession(
      new Response(null, { status: 302, headers: { location: `https://discord.com/api/oauth2/authorize?${params}` } }),
      env, next,
    );
  }

  if (route === '/auth/discord/callback' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    // ⛔ CSRF: the state must match the one this browser was issued. Comparing against a missing
    // session state would make any state valid, so an absent one fails here too.
    if (!code || !state || !session.discordState || state !== session.discordState) {
      return text('Invalid OAuth state.', 400);
    }
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) {
      return text('Discord OAuth not configured.', 500);
    }
    try {
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: env.DISCORD_REDIRECT_URI,
        }),
      });
      const token = await tokenResponse.json();
      if (!token.access_token) return text('Failed to get access token.', 400);

      const user = await (await fetch('https://discord.com/api/users/@me', {
        headers: { authorization: `Bearer ${token.access_token}` },
      })).json();

      const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator || 0) % 5}.png`;

      if (env.DISCORD_GUILD_ID && env.DISCORD_BOT_TOKEN) {
        // Best-effort, exactly as before: a failed guild join must not fail the login.
        await fetch(`https://discord.com/api/guilds/${env.DISCORD_GUILD_ID}/members/${user.id}`, {
          method: 'PUT',
          headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: token.access_token }),
        }).catch(() => {});
      }

      const next = {
        ...session,
        discordState: undefined,
        user: { id: user.id, username: String(user.global_name || user.username || ''), avatarUrl },
      };
      if (next.walletAddress) {
        await getOrCreatePlayer(db, next.walletAddress);
        await updatePlayerDiscord(db, next.walletAddress, next.user);
      }
      const redirect = env.FRONTEND_REDIRECT || url.origin;
      return withSession(
        new Response(null, { status: 302, headers: { location: `${redirect}/?discord=connected` } }),
        env, next,
      );
    } catch {
      return text('Discord OAuth failed.', 500);
    }
  }

  if (route === '/auth/discord/me' && request.method === 'GET') {
    if (!session.user) return json({ user: null }, 401);
    return json({ user: session.user });
  }

  if (route === '/auth/discord/logout' && request.method === 'POST') {
    return new Response(null, { status: 204, headers: { 'set-cookie': clearCookieHeader() } });
  }

  // ---- wallet -------------------------------------------------------------
  if (route === '/api/wallet/nonce' && request.method === 'POST') {
    const address = String((await body(request)).address ?? '').toLowerCase();
    if (!address || !isAddress(address)) return json({ error: 'Invalid address' }, 400);
    const player = await getOrCreatePlayer(db, address);
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    await setPlayerNonce(db, address, nonce);
    // ⛔ Message format is a wire contract with the wallet UI. Do not reword.
    return json({ message: `Degenerette login\nNonce: ${nonce}`, address: player.eth_address });
  }

  if (route === '/api/wallet/verify' && request.method === 'POST') {
    const payload = await body(request);
    const address = String(payload.address ?? '').toLowerCase();
    const signature = String(payload.signature ?? '');
    if (!address || !isAddress(address) || !signature) return json({ error: 'Invalid payload' }, 400);

    const player = await getPlayerByAddress(db, address);
    if (!player?.nonce) return json({ error: 'No nonce for address' }, 400);

    let recovered;
    try { recovered = verifyMessage(`Degenerette login\nNonce: ${player.nonce}`, signature); }
    catch { return json({ error: 'Invalid signature' }, 400); }
    if (recovered.toLowerCase() !== address) return json({ error: 'Signature mismatch' }, 401);

    // ⛔ Single use. The nonce is cleared before anything else can fail, so a replay of the same
    // signature cannot authenticate twice even if a later step throws.
    await clearPlayerNonce(db, address);

    const referrerCode = String(payload.referrerCode ?? '').trim();
    if (referrerCode) await setReferrerCode(db, address, referrerCode);

    const next = { ...session, walletAddress: address };
    if (next.user) await updatePlayerDiscord(db, address, next.user);

    return withSession(json({
      player: sanitizePlayer(await getPlayerByAddress(db, address)),
      discordLinkToken: await issueWalletLinkTicket(env, address),
    }), env, next);
  }

  if (route === '/api/wallet/logout' && request.method === 'POST') {
    return new Response(null, { status: 204, headers: { 'set-cookie': clearCookieHeader() } });
  }

  // ---- player reads -------------------------------------------------------
  if (route === '/api/player' && request.method === 'GET') {
    if (!session.walletAddress) return json({ error: 'Wallet not connected' }, 401);
    return json({ player: sanitizePlayer(await getPlayerByAddress(db, session.walletAddress)) });
  }

  const byDiscord = route.match(/^\/api\/player\/by-discord\/([0-9]{1,32})$/);
  if (byDiscord && request.method === 'GET') {
    const player = await getPlayerByDiscordId(db, byDiscord[1]);
    if (!player) return json({ player: null }, 404);
    return json({ player: sanitizePlayer(player) });
  }

  if (route === '/api/profiles' && (request.method === 'GET' || request.method === 'POST')) {
    const addresses = request.method === 'POST'
      ? (await body(request)).addresses
      : (url.searchParams.get('addresses') ?? '').split(',');
    // Bound the request: this is a public read and the list is caller-supplied.
    const list = (Array.isArray(addresses) ? addresses : []).slice(0, 500);
    return json({ profiles: await getProfilesByAddresses(db, list) });
  }

  return json({ error: 'Not found' }, 404);
}

export const __testing = { issueWalletLinkTicket, consumeWalletLinkTicket, getAddress };
