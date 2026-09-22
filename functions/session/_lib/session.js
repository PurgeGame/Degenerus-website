// Stateless, HMAC-signed session cookies — the replacement for express-session + its SQLite store.
//
// The old service kept a `sessions` table and handed out an opaque sid. Two things made that
// worth replacing rather than porting: it needs a write on every request that touches the
// session, and it needs expiry sweeping. A signed cookie carries the same three fields
// (discord user, wallet address, OAuth state) with an expiry inside the signed payload, so a
// tampered or expired cookie is simply not a session.
//
// ⛔ The signature covers the payload AND the expiry. Verifying one without the other is how a
// signed-cookie scheme turns into a permanent credential.

const ENCODER = new TextEncoder();
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days, matching the old cookie.maxAge.

function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function key(secret) {
  if (!secret) throw new Error('SESSION_SECRET is not configured.');
  return crypto.subtle.importKey('raw', ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Constant-time compare. `crypto.subtle.verify` does this for us; this guards the length path. */
function sameLength(a, b) { return a.length === b.length; }

export async function sealSession(secret, data, { maxAgeSeconds = MAX_AGE_SECONDS } = {}) {
  const payload = { ...data, exp: Math.floor(Date.now() / 1000) + maxAgeSeconds };
  const body = base64url(ENCODER.encode(JSON.stringify(payload)));
  const signature = base64url(await crypto.subtle.sign('HMAC', await key(secret), ENCODER.encode(body)));
  return `${body}.${signature}`;
}

export async function openSession(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const index = token.lastIndexOf('.');
  const body = token.slice(0, index);
  const signature = token.slice(index + 1);
  let ok = false;
  try {
    const expected = base64url(await crypto.subtle.sign('HMAC', await key(secret), ENCODER.encode(body)));
    ok = sameLength(expected, signature)
      && await crypto.subtle.verify('HMAC', await key(secret), fromBase64url(signature), ENCODER.encode(body));
  } catch { return null; }
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))); } catch { return null; }
  // An expiry inside the signed payload is the real lifetime. The cookie's own Max-Age is only a
  // hint to the browser and a client that ignores it must not get a longer session.
  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
  return payload;
}

export const COOKIE_NAME = 'degenerus_session';

export function readCookie(request, name = COOKIE_NAME) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Same-origin deployment, so the cookie is SameSite=Lax rather than None.
 *
 * This is the reason the service moved to this origin. On the old cross-site host the cookie had
 * to be SameSite=None, which meant the OAuth popup's top-level cookie and the app's fetch cookie
 * could be different jars (Safari/ITP in particular) — the `discordLinkToken` one-use ticket
 * exists purely to bridge that gap. Lax on one origin makes the popup's callback and the app's
 * fetches share a jar, so the bridge is belt-and-braces rather than load-bearing.
 */
export function cookieHeader(value, { maxAgeSeconds = MAX_AGE_SECONDS } = {}) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  return attributes.join('; ');
}

export function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
