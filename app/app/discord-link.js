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
// null-guards out) with one that proves the connected wallet before OAuth. The
// verify response includes a short-lived, one-use link ticket which is carried
// into /auth/discord. That ticket is important: popup/top-level cookies can be
// separate from the app's fetch cookies (especially on localhost), so relying
// on both identities landing in one browser session silently loses the link.
// LAZY: no request and no signature prompt until the user clicks the button.
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
const PROFILE_LINKED_EVENT = 'degenerus:discord-profile-linked';
const DISCORD_GUIDE_URL = new URL('../discord-connect.html', import.meta.url).toString();

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

function _announceProfileRefresh(address) {
  if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
  try {
    document.dispatchEvent(new CustomEvent(PROFILE_LINKED_EVENT, {
      detail: { address: String(address || '').toLowerCase() || null },
    }));
  } catch (_e) { /* an older/fake DOM can wait for the normal records poll */ }
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
  const { player, discordLinkToken } = await _postJson('/api/wallet/verify', { address, signature });
  _sessionPlayer = player ?? null;
  return typeof discordLinkToken === 'string' && discordLinkToken
    ? discordLinkToken
    : null;
}

async function _refresh() {
  const me = await _getJson('/auth/discord/me').catch(() => null);
  _sessionPlayer = (await _getJson('/api/player').catch(() => null))?.player ?? null;
  // The OAuth popup and the app fetch can legitimately hold different cookies.
  // Once the one-use ticket has joined the DB row, /api/player is sufficient to
  // show the linked state even when /auth/discord/me belongs to the popup cookie.
  _discordUser = me && me.user
    ? me.user
    : _sessionPlayer?.discord_id
      ? {
          username: _sessionPlayer.discord_name || 'Discord',
          avatarUrl: _sessionPlayer.discord_avatar || null,
        }
      : null;
}

/**
 * Open a useful handoff synchronously while the click is still a trusted user
 * gesture. The wallet signature is asynchronous, so waiting until it resolves
 * before opening Discord is routinely blocked by browsers. This real page
 * keeps that window available without marooning the player on about:blank.
 */
function _openDiscordGuide() {
  try {
    const tab = window.open(DISCORD_GUIDE_URL, '_blank');
    if (tab) tab.opener = null;
    return tab;
  } catch (_e) {
    return null;
  }
}

async function _onClick() {
  if (_busy) return;
  const addr = get('connected.address');

  // Not discord-connected: bind the wallet first when we have one, so the
  // OAuth callback persists the link in the same round-trip. Open the guided
  // handoff synchronously so a wallet signature wait cannot trigger popup
  // blocking, and so the player knows the signature comes before Discord.
  if (!_discordUser) {
    const authTab = addr ? _openDiscordGuide() : null;
    let discordLinkToken = null;
    if (addr) {
      _busy = true; _render();
      try {
        discordLinkToken = await _bindWallet(addr);
        if (!discordLinkToken) throw new Error('session API did not issue a Discord link ticket');
      } catch (err) {
        // Do not open a Discord-only session and call it linked. That was the
        // old failure mode: OAuth looked successful, but bounty portraits had
        // no wallet-keyed profile to load.
        console.error('[discord-link]', err);
        try { authTab?.close?.(); } catch (_e) { /* popup may already be gone */ }
        _busy = false; _render();
        return;
      }
    }
    const authUrl = new URL(SESSION_API + '/auth/discord');
    if (discordLinkToken) authUrl.searchParams.set('walletLink', discordLinkToken);
    try {
      if (authTab && !authTab.closed) authTab.location.href = authUrl.toString();
      else window.open(authUrl.toString(), '_blank', 'noopener');
    } catch (_e) {
      window.open(authUrl.toString(), '_blank', 'noopener');
    }
    _busy = false; _render();
    return;
  }

  // Discord connected but the connected wallet isn't linked yet: link in place.
  if (addr && !_linkedToConnected()) {
    _busy = true; _render();
    try {
      await _bindWallet(addr);
      await _refresh();
      _announceProfileRefresh(addr);
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
      _refresh()
        .then(() => {
          _render();
          _announceProfileRefresh(get('connected.address'));
        })
        .catch(() => _render());
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
