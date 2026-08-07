// /app/app/discord-link.js — makes the nav's Discord button LINK, not just log in.
//
// The problem it fixes: shared/nav.js's Discord button only starts the OAuth
// redirect. On every other page that is enough, because nav.js's own Connect
// button binds the wallet into the api.degener.us session first, and the server
// persists discord_id onto the player's eth_address row when the session holds
// BOTH (server: /auth/discord/callback + /api/wallet/verify, both call
// updatePlayerDiscord). But /app/ replaces the nav's wallet flow with its own
// backend-free EIP-6963 stack (nav-wallet.js), so the session never learns the
// wallet address and the discord↔address mapping never lands for /app/ users.
//
// So inside /app/ the nav's Discord button is REPLACED (same pattern as
// nav-wallet.js: clone the node, retire the id so nav.js's updateDiscordBtn()
// null-guards out) with one that binds the connected wallet into the session
// (nonce → personal_sign → verify, EIP-191 to match the server's ethers
// verifyMessage) before or after the OAuth leg, so whichever side connects
// second completes the link. LAZY: no request and no signature prompt until
// the user clicks the button.
//
// States: no discord session → "Discord" (click: bind wallet if connected,
// then OAuth). Discord session + connected wallet not yet linked → "Link
// Discord" (click: bind + persist, no redirect needed). Fully linked (or no
// wallet to link) → "Discord ✓" (click: disconnect, nav parity).
//
// NOTE: SESSION_API is the api.degener.us session server, NOT the indexer API
// (API_BASE in beta/app/constants.js). Two different services.

import { getEip1193 } from './wallet.js';
import { subscribe, get } from './store.js';

const SESSION_API = 'https://api.degener.us';
const NAV_BTN_ID = 'unav-discord';
const APP_BTN_ID = 'unav-discord-app';
const MOUNT_RETRY_MS = 100;
const MOUNT_RETRIES = 30;

let _btn = null;
let _busy = false;
let _discordUser = null;   // /auth/discord/me session user (null = not connected)
let _sessionPlayer = null; // /api/player row once the session holds a wallet
let _focusListener = null;

function _toHex(str) {
  const bytes = new TextEncoder().encode(str);
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function _getJson(path) {
  const res = await fetch(SESSION_API + path, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

async function _postJson(path, body) {
  const res = await fetch(SESSION_API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

function _label(text) {
  if (!_btn) return;
  const lbl = _btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  else _btn.textContent = text;
}

function _linkedToConnected() {
  const addr = get('connected.address');
  return Boolean(
    addr && _sessionPlayer && _sessionPlayer.discord_id &&
    String(_sessionPlayer.eth_address || '').toLowerCase() === String(addr).toLowerCase(),
  );
}

function _render() {
  if (!_btn) return;
  if (_busy) { _label('…'); return; }
  const addr = get('connected.address');
  if (!_discordUser) {
    _label('Discord');
    _btn.classList.remove('connected');
    return;
  }
  if (addr && !_linkedToConnected()) {
    _label('Link Discord');
    _btn.classList.remove('connected');
    return;
  }
  _label('Discord ✓');
  _btn.classList.add('connected');
}

/** Bind the connected wallet into the api.degener.us session (one signature).
 *  The server copies the session's discord user onto the row when present. */
async function _bindWallet(address) {
  const provider = getEip1193();
  if (!provider) throw new Error('no provider');
  const { message } = await _postJson('/api/wallet/nonce', { address });
  const signature = await provider.request({
    method: 'personal_sign',
    params: [_toHex(message), address],
  });
  const { player } = await _postJson('/api/wallet/verify', { address, signature });
  _sessionPlayer = player ?? null;
}

async function _refresh() {
  const me = await _getJson('/auth/discord/me').catch(() => null);
  _discordUser = me && me.user ? me.user : null;
  _sessionPlayer = (await _getJson('/api/player').catch(() => null))?.player ?? null;
}

async function _onClick() {
  if (_busy) return;
  const addr = get('connected.address');

  // Not discord-connected: bind the wallet first when we have one, so the
  // OAuth callback persists the link in the same round-trip. Open the tab
  // synchronously so a wallet signature wait cannot trigger popup blocking.
  if (!_discordUser) {
    let authTab = null;
    try {
      authTab = window.open('about:blank', '_blank');
      if (authTab) authTab.opener = null;
    } catch (_e) { /* popup policy fallback below */ }
    if (addr) {
      _busy = true; _render();
      try { await _bindWallet(addr); } catch { /* still worth doing OAuth */ }
    }
    const authUrl = SESSION_API + '/auth/discord';
    try {
      if (authTab && !authTab.closed) authTab.location.href = authUrl;
      else window.open(authUrl, '_blank', 'noopener');
    } catch (_e) {
      window.open(authUrl, '_blank', 'noopener');
    }
    return;
  }

  // Discord connected but the connected wallet isn't linked yet: link in place.
  if (addr && !_linkedToConnected()) {
    _busy = true; _render();
    try {
      await _bindWallet(addr);
      await _refresh();
    } catch (err) {
      console.error('[discord-link]', err);
    }
    _busy = false; _render();
    return;
  }

  // Fully linked (or discord-only, nothing to link): nav parity — disconnect.
  await fetch(SESSION_API + '/auth/discord/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  _discordUser = null;
  _render();
}

function _mount() {
  const old = document.getElementById(NAV_BTN_ID);
  if (!old) return false;
  const btn = old.cloneNode(true); // clone drops nav.js's listener, keeps svg+classes
  btn.id = APP_BTN_ID;             // retire the id → nav.js updateDiscordBtn() null-guards out
  old.replaceWith(btn);
  _btn = btn;
  btn.addEventListener('click', () => { _onClick(); });
  subscribe('connected.address', _render);
  // OAuth completes in the new tab. Refresh the original app when the player
  // returns so its Discord/link state updates without a page reload.
  if (!_focusListener && typeof window !== 'undefined'
    && typeof window.addEventListener === 'function') {
    _focusListener = () => {
      if (!_btn) return;
      _refresh().then(_render).catch(() => _render());
    };
    window.addEventListener('focus', _focusListener);
  }
  _refresh().then(_render).catch(() => _render());
  return true;
}

export function initDiscordLink({ retries = MOUNT_RETRIES } = {}) {
  if (_mount()) return;
  let left = retries;
  const t = setInterval(() => {
    if (_mount() || --left <= 0) clearInterval(t);
  }, MOUNT_RETRY_MS);
}

export function __resetForTest() {
  if (_focusListener && typeof window !== 'undefined'
    && typeof window.removeEventListener === 'function') {
    try { window.removeEventListener('focus', _focusListener); } catch (_e) { /* defensive */ }
  }
  _focusListener = null;
  _btn = null; _busy = false; _discordUser = null; _sessionPlayer = null;
}
