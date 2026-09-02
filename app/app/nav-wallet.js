// /app/app/nav-wallet.js — makes the nav's Connect button actually connect.
//
// The problem it fixes: /app/ has no Connect button of its own (index.html
// delegates to the nav), and shared/nav.js's button runs the SITE session flow —
// eth_requestAccounts, then POST /api/wallet/nonce, personal_sign, POST
// /api/wallet/verify against api.degener.us. Only after that round-trip does it
// set its own `address` and dispatch the `wallet-connected` event the app
// listens for. With that backend unreachable the promise rejects into a silent
// `.catch`, so the button never flips to connected and the app never learns
// about the wallet: it keeps polling the sDGNRS house default from main.js.
//
// Meanwhile /app/ already owns a complete, backend-free connect stack —
// EIP-6963 discovery, the <wallet-picker> modal, WalletConnect, autoReconnect,
// accountsChanged/chainChanged listeners — and nothing was calling it.
//
// So inside /app/ the nav's button is REPLACED (not merely re-bound) with one
// that drives connectWithPicker/disconnect and renders off the store. Replacing
// it also retires its id, which is what nav.js's own updateWalletBtn() looks up:
// that lookup now null-guards out, so a late session check cannot clobber the
// label back to "Connect" while a wallet is plainly attached. Styling keys off
// the .nav-btn-wallet / .connected classes, both carried over verbatim.
//
// Only /app/ is affected. Every other page keeps nav.js's session flow, which
// is what its Discord + affiliate-code features are built on.

import { connectWithPicker, disconnect, ensureConfiguredWalletChain } from './wallet.js';
import { subscribe, get } from './store.js';
import { CHAIN } from './chain-config.js';

const NAV_BTN_ID = 'unav-wallet';
const APP_BTN_ID = 'unav-wallet-app';

// nav.js builds its nav synchronously from initNav(), which runs in a classic
// script tag before this module executes — but only if the DOM was ready. Retry
// briefly rather than assume ordering.
const MOUNT_RETRY_MS = 100;
const MOUNT_RETRIES = 30;

let _btn = null;
let _busy = false;

function _short(addr) {
  return `0x${String(addr).slice(-4)}`;
}

function _label(text) {
  if (!_btn) return;
  const lbl = _btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = text;
  else _btn.textContent = text;
}

function _render() {
  if (!_btn) return;
  const addr = get('connected.address');
  const chainOk = get('ui.chainOk');
  if (!addr) {
    _label(_busy ? 'Connecting…' : 'Connect');
    _btn.classList.remove('connected');
    _btn.title = 'Connect a wallet';
    return;
  }
  _btn.classList.add('connected');
  if (chainOk === false) {
    // The address is real but useless for writes until the chain matches, so
    // the button says the thing that is actually wrong and fixes it on click.
    _label('Wrong network');
    _btn.title = `Switch to ${CHAIN.name}`;
    return;
  }
  _label(_short(addr));
  _btn.title = `${addr} — click to disconnect`;
}

async function _onClick() {
  if (_busy) return;
  const addr = get('connected.address');

  if (addr && get('ui.chainOk') === false) {
    // A stale WalletConnect session may predate Base Sepolia being enabled in
    // MetaMask. The shared helper switches an authorized session, or retires
    // and re-pairs one whose immutable namespace does not include this chain.
    await ensureConfiguredWalletChain();
    _render();
    return;
  }

  if (addr) {
    disconnect();
    _render();
    return;
  }

  _busy = true;
  _render();
  try {
    await connectWithPicker();
  } catch (_e) {
    // Rejected prompt / closed picker / no wallet — the store stays untouched
    // and the button falls back to "Connect" below.
  } finally {
    _busy = false;
    _render();
  }
}

function _install(navBtn) {
  const btn = document.createElement('button');
  btn.id = APP_BTN_ID;
  btn.type = 'button';
  // Same classes, so shared/nav.css styles it identically (including the
  // .connected variant). The contents are CLONED rather than re-parsed from
  // innerHTML: the nav's glyph is an inline <svg>, which survives cloneNode
  // exactly and would otherwise depend on HTML-namespace re-parsing.
  btn.className = navBtn.className || 'nav-btn nav-btn-wallet';
  for (const node of Array.from(navBtn.childNodes)) {
    btn.appendChild(node.cloneNode(true));
  }
  btn.addEventListener('click', _onClick);
  navBtn.replaceWith(btn);
  _btn = btn;

  subscribe('connected.address', _render);
  subscribe('ui.chainOk', _render);
  _render();
  return btn;
}

/**
 * Take over the nav's wallet button. Idempotent; resolves to the installed
 * button, or null when the nav never mounted one (headless, or a page that
 * does not carry the nav).
 */
export function initNavWallet({ retries = MOUNT_RETRIES } = {}) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') {
    return Promise.resolve(null);
  }
  const existing = document.getElementById(APP_BTN_ID);
  if (existing) return Promise.resolve(existing);

  const navBtn = document.getElementById(NAV_BTN_ID);
  if (navBtn) return Promise.resolve(_install(navBtn));

  if (retries <= 0) return Promise.resolve(null);
  // Deliberately NOT unref'd, unlike the panels' poll timers: this promise is
  // awaited, so an unref'd retry would leave it pending forever under node. The
  // chain is bounded (MOUNT_RETRIES × MOUNT_RETRY_MS) and stops the moment the
  // nav mounts.
  return new Promise((resolve) => {
    setTimeout(() => resolve(initNavWallet({ retries: retries - 1 })), MOUNT_RETRY_MS);
  });
}

/** Test-only: drop the installed button so a fresh init can run. */
export function __resetForTest() {
  _btn = null;
  _busy = false;
}
