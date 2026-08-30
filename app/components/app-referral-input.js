// Compact app-nav referral input. Incoming /app/?ref= links are captured by
// /js/ref.js before the nav mounts; this surface exposes that saved first-buy
// default and lets the player deliberately replace or clear it before the
// contract permanently locks their referrer on a qualifying purchase.

import { get, subscribe } from '../app/store.js';
import {
  formatPurchaseAffiliateCode,
  readPlayerReferrer,
  readStoredPurchaseAffiliateCode,
  REFERRAL_CHANGED_EVENT,
  savePurchaseAffiliateCode,
} from '../app/affiliate.js';
import { compactUiError } from '../app/ui-error.js';
import { fetchJSON } from '../app/api.js';
import { registerComponentPoll } from '../app/component-poll.js';

const MOUNT_RETRY_MS = 100;
const MOUNT_RETRIES = 30;
const VISIBILITY_POLL_MS = 15_000;

let _root = null;
let _input = null;
let _busy = false;
let _unsub = null;
let _visibilitySeq = 0;
let _visibilityPoll = null;
let _visibilityPlayer = null;

/**
 * ReferralUpdated creates an indexed assignment row even when the immutable
 * destination is the Vault sentinel. That distinguishes a consumed referral
 * slot from a brand-new wallet, which getReferrer() alone cannot do because it
 * returns Vault for both states.
 */
export function dashboardHasReferralAssignment(payload) {
  const affiliate = payload?.affiliate;
  if (!affiliate || !Object.prototype.hasOwnProperty.call(affiliate, 'referrer')) return false;
  const referrer = String(affiliate.referrer || '').toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(referrer)
    && referrer !== '0x0000000000000000000000000000000000000000';
}

function _savedFriendly() {
  return formatPurchaseAffiliateCode(readStoredPurchaseAffiliateCode());
}

function _syncCode() {
  if (!_input || _busy) return;
  _input.value = _savedFriendly();
}

async function _syncVisibility() {
  if (!_root) return;
  const player = get('connected.address');
  const seq = ++_visibilitySeq;
  if (!player) {
    _visibilityPlayer = null;
    _root.hidden = true;
    _root.setAttribute?.('hidden', '');
    return;
  }
  const normalizedPlayer = String(player).toLowerCase();
  // A new wallet's assignment state is unknown until both sources answer.
  // Keeping that transient state hidden prevents an already-locked player
  // from seeing a one-frame referral input during connect or account switch.
  if (_visibilityPlayer !== normalizedPlayer) {
    _visibilityPlayer = normalizedPlayer;
    _root.hidden = true;
    _root.setAttribute?.('hidden', '');
  }
  const [referrerResult, dashboardResult] = await Promise.allSettled([
    readPlayerReferrer(player),
    fetchJSON(`/player/${normalizedPlayer}`),
  ]);
  if (seq !== _visibilitySeq || !_root) return;
  const realReferrer = referrerResult.status === 'fulfilled' ? referrerResult.value : null;
  const indexedAssignment = dashboardResult.status === 'fulfilled'
    && dashboardHasReferralAssignment(dashboardResult.value);
  const assigned = Boolean(realReferrer) || indexedAssignment;
  const confirmedUnassigned = referrerResult.status === 'fulfilled'
    && dashboardResult.status === 'fulfilled'
    && !assigned;
  if (assigned) {
    _root.hidden = true;
    _root.setAttribute?.('hidden', '');
  } else if (confirmedUnassigned) {
    _root.hidden = false;
    _root.removeAttribute?.('hidden');
  }
}

async function _apply() {
  if (_busy || !_input) return;
  _busy = true;
  _input.disabled = true;
  _input.removeAttribute?.('aria-invalid');
  _input.removeAttribute?.('title');
  try {
    const code = await savePurchaseAffiliateCode(_input.value, get('connected.address'));
    _input.value = formatPurchaseAffiliateCode(code);
  } catch (error) {
    _input.setAttribute?.('aria-invalid', 'true');
    _input.setAttribute?.('title', compactUiError(error, 'Invalid referral code'));
  } finally {
    _busy = false;
    _input.disabled = false;
  }
}

function _install(host) {
  if (_root?.isConnected) return _root;
  const root = document.createElement('div');
  root.className = 'app-referral-input';
  root.hidden = true;
  root.setAttribute?.('hidden', '');
  root.setAttribute('aria-label', 'Referral code for your first purchase');
  root.innerHTML = `
    <input type="text" data-bind="app-referral-code" autocomplete="off"
           spellcheck="false" placeholder="Referral code">
  `;
  const auth = host.querySelector?.('.nav-auth');
  if (auth) host.insertBefore(root, auth);
  else host.appendChild(root);
  _root = root;
  _input = root.querySelector('[data-bind="app-referral-code"]');
  _input?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void _apply();
  });
  _input?.addEventListener('change', () => { void _apply(); });
  document.addEventListener?.(REFERRAL_CHANGED_EVENT, _syncCode);
  document.addEventListener?.('app-decimator:tx-confirmed', _syncVisibility);
  document.addEventListener?.('app-pass:tx-confirmed', _syncVisibility);
  window.addEventListener?.('storage', (event) => {
    if (event?.key === 'affiliate-ref') _syncCode();
  });
  window.addEventListener?.('focus', _syncVisibility);
  _visibilityPoll = registerComponentPoll(() => _syncVisibility(), VISIBILITY_POLL_MS);
  _unsub = subscribe('connected.address', () => {
    _syncCode();
    void _syncVisibility();
  });
  _syncCode();
  void _syncVisibility();
  return root;
}

export function initReferralInput({ retries = MOUNT_RETRIES } = {}) {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
    return Promise.resolve(null);
  }
  const host = document.querySelector('.nav-right');
  if (host) return Promise.resolve(_install(host));
  if (retries <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    setTimeout(() => resolve(initReferralInput({ retries: retries - 1 })), MOUNT_RETRY_MS);
  });
}

export function __resetForTest() {
  try { _unsub?.(); } catch (_e) { /* defensive */ }
  _unsub = null;
  _root = null;
  _input = null;
  _busy = false;
  _visibilitySeq += 1;
  _visibilityPlayer = null;
  if (typeof _visibilityPoll === 'function') {
    try { _visibilityPoll(); } catch (_e) { /* defensive */ }
    _visibilityPoll = null;
  }
}

void initReferralInput();
