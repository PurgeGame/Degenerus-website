// Direct-chain whale-pass claim watcher.
//
// Jackpot-awarded whale-pass halves live in GAME.whalePassClaims until someone
// calls the permissionless claimWhalePass(player) entrypoint. They are player
// work, so a non-zero balance belongs in the shared Pending tray alongside the
// other claims. The contract view is authoritative here; the indexer/database
// is intentionally not involved.

import { claimWhalePass, readWhalePassClaimAmount } from './claims.js';
import { clearPendingActions, publishPendingActions } from './pending-actions.js';
import { currentUnresolvedJackpotContext } from './jackpot-spoiler.js';
import { registerComponentPoll } from './component-poll.js';

const SOURCE = 'whale-pass-claims';
const WATCH_INTERVAL_MS = 30_000;

let _running = false;
let _timer = null;
let _getAddress = null;
let _reader = null;
let _writer = null;
let _refreshSeq = 0;
let _activeAddress = null;
let _activeAmount = null;
let _visibleAmount = null;
let _jackpotRevealListener = null;

function _lower(value) {
  return value ? String(value).toLowerCase() : null;
}

function _formatCount(amount) {
  try { return BigInt(amount).toLocaleString('en-US'); }
  catch (_e) { return String(amount ?? '0'); }
}

function _isNothingToClaim(error) {
  let current = error;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const code = current?.code
      || current?.errorName
      || current?.revert?.name
      || current?.info?.error?.data?.errorName;
    if (String(code || '').toLowerCase() === 'nothingtoclaim') return true;
    if (/nothing\s+to\s+claim/i.test(String(current?.message || ''))) return true;
    current = current?.cause || current?.error || null;
  }
  return false;
}

function _clear(address = null) {
  _activeAddress = address;
  _activeAmount = 0n;
  _visibleAmount = 0n;
  clearPendingActions(SOURCE);
}

function _publish(address, amount) {
  const count = _formatCount(amount);
  const noun = amount === 1n ? 'half' : 'halves';
  publishPendingActions(SOURCE, [{
    // Including the balance makes a newly increased claim visible even if the
    // player previously used Pending's presentation-only CLEAR action.
    id: `whale-pass-claim:${address}:${amount}`,
    dismissScope: address,
    kind: 'whale-pass-claim',
    kindLabel: 'WHALE PASS CLAIM',
    label: `${count} whale-pass ${noun}`,
    detail: 'Activate the deferred ticket stream for the next 100 levels',
    shortLabel: 'Claim',
    state: 'ready',
    order: 10,
    write: true,
    autoOpen: false,
    whalePassHalfCount: amount,
    run: async () => {
      // Do not let a row captured before an account/mode change crank a player
      // the UI is no longer acting for. The contract call itself is safe and
      // permissionless, but the visible action should still match its owner.
      let currentAddress = null;
      try { currentAddress = _lower(_getAddress?.()); } catch (_e) { /* clear below */ }
      if (currentAddress !== address) {
        _clear(currentAddress);
        void refreshWhalePassClaims();
        return false;
      }

      let claimed = false;
      try {
        await (_writer || claimWhalePass)({ player: address });
        claimed = true;
        return true;
      } catch (error) {
        // Another wallet/keeper may have claimed this permissionless action
        // between the read and click. Treat that as reconciled, not a broken UI.
        if (_isNothingToClaim(error)) {
          claimed = true;
          return false;
        }
        throw error;
      } finally {
        if (claimed) _clear(address);
        await refreshWhalePassClaims();
      }
    },
  }]);
}

/** Re-read the acting player's on-chain claim balance immediately. */
export async function refreshWhalePassClaims() {
  if (!_running) return;

  let address = null;
  try { address = _lower(_getAddress?.()); } catch (_e) { address = null; }
  if (!address) {
    _refreshSeq += 1;
    _clear(null);
    return;
  }

  if (_activeAddress !== address) {
    _refreshSeq += 1;
    _activeAddress = address;
    _activeAmount = null;
    _visibleAmount = null;
    clearPendingActions(SOURCE);
  }

  const seq = ++_refreshSeq;
  let value = null;
  try {
    value = await (_reader || readWhalePassClaimAmount)({ player: address });
  } catch (_e) {
    // The production reader already fails to null, but keep the watcher safe if
    // a provider adapter throws outside that helper.
    value = null;
  }
  if (!_running || seq !== _refreshSeq) return;

  let amount = null;
  try { amount = value == null ? null : BigInt(value); }
  catch (_e) { amount = null; }

  // A transient RPC failure is unknown, not zero. Preserve an already-known
  // claim instead of making the Pending action flicker away.
  if (amount == null) {
    if (_activeAmount == null) clearPendingActions(SOURCE);
    return;
  }

  if (amount <= 0n) {
    _clear(address);
    return;
  }
  _activeAmount = amount;
  if (currentUnresolvedJackpotContext()) {
    // Preserve a claim that was already visible before the request, but hide
    // any new balance delta until the jackpot board is finished. On a reload
    // during processing there is no trustworthy baseline, so hide it all.
    const visible = _visibleAmount == null ? 0n : amount < _visibleAmount ? amount : _visibleAmount;
    _visibleAmount = visible;
    if (visible > 0n) _publish(address, visible);
    else clearPendingActions(SOURCE);
    return;
  }
  _visibleAmount = amount;
  _publish(address, amount);
}

/** Start the direct-chain watcher for the current self/operator acting player. */
export function startWhalePassClaims({ getAddress } = {}) {
  if (_running) return;
  _running = true;
  _getAddress = typeof getAddress === 'function' ? getAddress : null;
  // Shared scheduler, not a raw setInterval: the claim balance only moves at
  // jackpot resolutions, and a hidden tab has no business re-reading it.
  _timer = registerComponentPoll(refreshWhalePassClaims, WATCH_INTERVAL_MS);
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    _jackpotRevealListener = () => { void refreshWhalePassClaims(); };
    document.addEventListener('jackpot:revealed', _jackpotRevealListener);
  }
  void refreshWhalePassClaims();
}

export function stopWhalePassClaims() {
  if (_timer != null) {
    try { _timer(); } catch (_e) { /* defensive */ }
  }
  _timer = null;
  if (_jackpotRevealListener && typeof document !== 'undefined') {
    try { document.removeEventListener('jackpot:revealed', _jackpotRevealListener); }
    catch (_e) { /* defensive */ }
  }
  _jackpotRevealListener = null;
  _running = false;
  _getAddress = null;
  _refreshSeq += 1;
  _activeAddress = null;
  _activeAmount = null;
  _visibleAmount = null;
  clearPendingActions(SOURCE);
}

/** Test-only chain read/write seams. */
export function __setWhalePassClaimsForTest({ read, claim } = {}) {
  _reader = typeof read === 'function' ? read : null;
  _writer = typeof claim === 'function' ? claim : null;
}

export function __resetWhalePassClaimsForTest() {
  stopWhalePassClaims();
  _reader = null;
  _writer = null;
}
