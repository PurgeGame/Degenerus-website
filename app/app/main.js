// /app/app/main.js — Phase 58 Plan 02 boot orchestrator (extends Phase 56 D-01).
//
// Boot order (RESEARCH §Code Examples lines 606-639):
//   1. initRouter()         — read ?as= → seed viewing.address BEFORE wallet flow.
//   2. await autoReconnect() — silent eth_accounts via persisted rdns; never popups.
//   3. startPolling()        — target getViewedAddress() (?as= || connected || null).
//   4. subscribe re-arm      — viewing.address change re-arms polling target.
//   5. subscribe re-arm      — connected.address change re-arms IFF no viewing override.
//
// Cold-load deep-link to a player profile works without an active wallet
// connection (read-only view of any DB-known player) — initRouter seeds
// viewing.address before autoReconnect runs, so polling targets the deep-linked
// address from the first cycle.

import './chain-config.js';
import { CONTRACTS } from './chain-config.js';
import {
  start as startPolling,
  refreshForDayShift,
  refreshJackpotAfterChainCompletion,
} from './polling.js';
import { startDayRollover } from './day-rollover.js';
import { warmBadgeStore } from './badge-sprite.js';
import { initRouter, getViewedAddress } from './router.js';
import { autoReconnect } from './wallet.js';
import { subscribe, get, getActingAddress, update } from './store.js';
import { initProGate } from './pro-gate.js';
import { initNavWallet } from './nav-wallet.js';
import { initDiscordLink } from './discord-link.js';
import {
  backfillRecentJackpotTicketAwards,
  ingestJackpotTicketAwards,
  pendingPacks,
  startPackWatch,
  refreshPackWatch,
} from './pack-watch.js';
import { startBingoWatch, refreshBingoWatch } from './bingo-watch.js';
import {
  startWhalePassClaims,
  refreshWhalePassClaims,
} from './whale-pass-claims.js';
import { startLaunchClaims, refreshLaunchClaims } from './launch-claims.js';
import { resetPresentationStateForDeployment } from './deployment-presentation-state.js';
import { initButtonFeedback } from './button-feedback.js';
import { mountJackpotCountdown } from './jackpot-countdown.js';

// A disconnected app still needs a useful live account to render. After the
// silent reconnect attempt, use the public sDGNRS protocol wallet until the
// player connects; an explicit ?as= view always wins.
const DEFAULT_PLAYER = CONTRACTS.SDGNRS
  ? String(CONTRACTS.SDGNRS).toLowerCase()
  : null;
let _defaultPlayerSeeded = false;

function seedDisconnectedProtocolWalletIfNeeded() {
  if (!DEFAULT_PLAYER || get('viewing.address') || get('connected.address')) return false;
  update('viewing.address', DEFAULT_PLAYER);
  _defaultPlayerSeeded = true;
  return true;
}

function clearUntouchedProtocolWallet() {
  if (!_defaultPlayerSeeded || get('viewing.address') !== DEFAULT_PLAYER) return;
  _defaultPlayerSeeded = false;
  update('viewing.address', null);
}

/**
 * The top-bar day, as a picker.
 *
 * `#unav-day` keeps its id and class so the nav CSS and every existing lookup
 * (the Mine Flip mount anchors off it, nav-wallet retires ids around it) still land —
 * it is just a <select> now. The option list is mirrored from the replay panel's
 * day select on a short retry, because that select populates asynchronously from
 * the day feed; a pick writes back into it and fires `change`, which is the same
 * signal last-day-jackpot already accepts as a re-pin.
 */
export function mountDaySelector({ retries = 40, intervalMs = 500 } = {}) {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
  const host = document.querySelector('.nav-right') || document.querySelector('.nav-left');
  if (!host) return null;

  let sel = document.getElementById ? document.getElementById('unav-day') : null;
  if (!sel || sel.tagName !== 'SELECT') {
    if (sel && sel.remove) { try { sel.remove(); } catch (_e) { /* defensive */ } }
    sel = document.createElement('select');
    sel.id = 'unav-day';
    sel.className = 'unav-day unav-day--select';
    sel.setAttribute('aria-label', 'Jackpot day');
    try { host.insertBefore(sel, host.firstChild); } catch (_e) { host.appendChild(sel); }
  }

  const panelSelect = () => {
    const panel = document.querySelector('replay-panel');
    return panel ? panel.querySelector('[data-bind="day-select"]') : null;
  };

  // Mirror the panel's days into the nav select. Returns true once real days
  // (not its "Loading days…" placeholder) have landed.
  const sync = () => {
    const src = panelSelect();
    if (!src || !src.options) return false;
    if (!src.dataset?.unavWired) {
      src.addEventListener('change', () => {
        if (!sync()) return;
        const selected = String(src.value || '');
        const has = sel.options
          && Array.from(sel.options).some((option) => String(option.value) === selected);
        if (has) sel.value = selected;
      });
      if (src.dataset) src.dataset.unavWired = '1';
    }
    const days = Array.from(src.options)
      .map((o) => Number(o.value))
      .filter((d) => Number.isFinite(d) && d > 0)
      .sort((a, b) => b - a);
    if (days.length === 0) return false;
    const current = String(sel.value || '');
    if (sel.options && sel.options.length === days.length
      && String(sel.options[0].value) === String(days[0])) {
      return true;   // already mirrored
    }
    sel.textContent = '';
    for (const d of days) {
      const opt = document.createElement('option');
      opt.value = String(d);
      opt.textContent = `DAY ${d}`;
      sel.appendChild(opt);
    }
    // Follow the board: whatever the panel is showing is what the nav reads.
    sel.value = current && days.includes(Number(current)) ? current : String(src.value || days[0]);
    return true;
  };

  if (!sel.dataset || !sel.dataset.wired) {
    sel.addEventListener('change', () => {
      const src = panelSelect();
      if (!src) return;
      if (String(src.value) === String(sel.value)) return;
      src.value = String(sel.value);
      try { src.dispatchEvent(new Event('change', { bubbles: true })); }
      catch (_e) { try { src.dispatchEvent({ type: 'change', bubbles: true }); } catch (_e2) { /* give up */ } }
    });
    if (sel.dataset) sel.dataset.wired = '1';
  }

  // The pinned day moves on its own when a genuinely newer day resolves.
  // Retry until replay-panel has added that day to its async option list;
  // routine same-day polls do not disturb a manual historical selection.
  let latestDaySeen = null;
  subscribe('app.lastDay', (payload) => {
    if (!payload || payload.day == null) return;
    const day = Number(payload.day);
    if (!Number.isFinite(day) || day <= 0) return;
    if (latestDaySeen != null && day <= latestDaySeen) return;
    latestDaySeen = day;
    let attempts = retries;
    const follow = () => {
      const ready = sync();
      const has = ready && sel.options
        && Array.from(sel.options).some((o) => String(o.value) === String(day));
      if (has) {
        sel.value = String(day);
        return;
      }
      if (attempts-- <= 0) return;
      const t = setTimeout(follow, intervalMs);
      if (t && typeof t.unref === 'function') {
        try { t.unref(); } catch (_e) { /* defensive */ }
      }
    };
    follow();
  });

  let left = retries;
  const tick = () => {
    if (sync() || left-- <= 0) return;
    const t = setTimeout(tick, intervalMs);
    if (t && typeof t.unref === 'function') { try { t.unref(); } catch (_e) { /* defensive */ } }
  };
  tick();
  return sel;
}

async function boot() {
  console.log('[app] booting');
  initButtonFeedback();
  // Logical days restart on a new testnet deployment. Clear only prior-run UI
  // reveal receipts before any jackpot/flip component reads them.
  resetPresentationStateForDeployment();
  // 1. Router reads ?as= → seeds viewing.address BEFORE any wallet flow.
  initRouter();
  // 1b. Phase 64 — hidden pro-mode eligibility (ui.proEligible off the
  //     connected wallet's activity score; no visible consumer until THE PIT).
  initProGate();
  // 1c. Take over the nav's Connect button so it drives THIS app's wallet stack
  //     (EIP-6963 + WalletConnect, no backend session) rather than nav.js's
  //     api.degener.us login. Fire-and-forget: it retries until the nav mounts,
  //     and boot must not wait on nav injection.
  initNavWallet();
  // 1d. Take over the nav's Discord button too: same api.degener.us OAuth, but
  //     it first binds THIS app's connected wallet into the session so the
  //     discord_id↔address mapping actually persists (nav.js alone never
  //     learns the app-stack wallet). Lazy — nothing runs until clicked.
  initDiscordLink();
  // 2. Auto-reconnect via persisted rdns (silent — eth_accounts only, no popup).
  await autoReconnect().catch(() => {});
  // 2b. Only after silent reconnect has had its chance, seed the public
  //     protocol-wallet view for every genuinely disconnected session.
  seedDisconnectedProtocolWalletIfNeeded();
  // 2c. Wallet connected (now or later) → drop the untouched protocol view so the
  //     player lands on their own view (ui.mode flips back to 'self').
  subscribe('connected.address', (addr) => {
    if (addr && _defaultPlayerSeeded && get('viewing.address') === DEFAULT_PLAYER) {
      clearUntouchedProtocolWallet();
      return;
    }
    // Return to the same useful public protocol account after a wallet session
    // ends, unless the player is intentionally viewing another address.
    if (!addr && !get('viewing.address')) {
      seedDisconnectedProtocolWalletIfNeeded();
    }
  });
  // 2d. Deferred ticket reveals. A bought ticket has no symbols until the level
  //     draw rolls them, so the buy records the purchase and this watcher pops
  //     the reveal once the entries are real — including one that rolled while
  //     the tab was closed, since the record outlives the session.
  startPackWatch({ getAddress: () => get('connected.address') });
  subscribe('connected.address', (address) => {
    if (address) {
      const lastDay = get('app.lastDay');
      ingestJackpotTicketAwards({ address, payload: lastDay });
      void backfillRecentJackpotTicketAwards({ address, day: lastDay?.day });
    }
    refreshPackWatch();
  });
  subscribe('app.lastDay', (payload) => {
    const address = get('connected.address');
    if (!address || !payload) return;
    ingestJackpotTicketAwards({ address, payload });
    void backfillRecentJackpotTicketAwards({ address, day: payload.day });
    refreshPackWatch();
    // Ticket buckets and their Bingo proofs become complete during this same
    // processing pass. Ask the DB again as soon as the settled day lands.
    refreshBingoWatch();
  });
  // Far-future jackpot tickets stay banked until their level enters the exact
  // six-key processing window. Re-check only when that window changes, not on
  // every ordinary game-state sample.
  let packDrainScope = null;
  subscribe('app.gameState', (state) => {
    const scope = state ? [
      state.level,
      state.phase,
      state.jackpotPhaseFlag ? 1 : 0,
      state.rngLockedFlag ? 1 : 0,
      state.phaseTransitionActive ? 1 : 0,
      state.advanceStage ?? '',
      state.ticketsFullyProcessed === true ? 1 : 0,
    ].join(':') : null;
    if (scope === packDrainScope) {
      // Ticket batches can finish in a keeper transaction without changing the
      // visible phase fields (the current deploy can even leave the completion
      // latch false after every owed queue reaches zero). While this browser has
      // a receipt to reconcile, use each normal 15s game sample as a prompt read.
      if (pendingPacks().length > 0) refreshPackWatch();
      return;
    }
    packDrainScope = scope;
    refreshPackWatch();
    refreshBingoWatch();
  });
  // The DB finds complete 8-color lines after ticket processing. Each unclaimed
  // proof becomes a player write in the shared pending tray; settled claims
  // (including permissionless keeper claims) become explicit prize reveals.
  startBingoWatch({ getAddress: () => get('connected.address') });
  subscribe('connected.address', () => refreshBingoWatch());
  // Jackpot-won whale-pass halves are a deferred on-chain claim, not an
  // indexed purchase. Read GAME.whalePassClaimAmount directly and publish a
  // write into the same Pending tray whenever the current acting player has
  // any. Mode/address subscriptions keep operator and read-only views honest.
  startWhalePassClaims({ getAddress: () => getActingAddress() });
  subscribe('connected.address', () => refreshWhalePassClaims());
  subscribe('viewing.address', () => refreshWhalePassClaims());
  subscribe('ui.mode', () => refreshWhalePassClaims());
  // Launch claim manifest: current-level affiliate bonus, WWXRP draw
  // result/claim, and rare foil Golden Tickets. Ordinary ETH/FLIP claims use
  // their dedicated Protocol Coins controls and never appear in Pending.
  startLaunchClaims({
    getAddress: () => getActingAddress(),
    getLevel: () => get('app.gameState')?.level,
  });
  subscribe('connected.address', () => refreshLaunchClaims());
  subscribe('viewing.address', () => refreshLaunchClaims());
  subscribe('ui.mode', () => refreshLaunchClaims());
  subscribe('app.gameState', () => refreshLaunchClaims());
  // 3. Polling starts with the resolved viewing target (?as= OR connected OR
  //    null). Store subscriptions fire immediately, so startup and a connected
  //    self-view used to restart the complete five-poller stack 2–3 times in
  //    one turn. Coalesce those synchronous triggers into one eager cycle.
  let pendingPollingTarget = getViewedAddress();
  let pollingRestartQueued = false;
  const schedulePollingRestart = (playerAddress) => {
    pendingPollingTarget = playerAddress;
    if (pollingRestartQueued) return;
    pollingRestartQueued = true;
    const run = () => {
      pollingRestartQueued = false;
      startPolling({ playerAddress: pendingPollingTarget });
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  };
  schedulePollingRestart(pendingPollingTarget);
  // 4. Re-arm polling whenever the viewing target changes (typeahead pick,
  //    banner CTA, popstate). Its initial fire joins the startup cycle above.
  subscribe('viewing.address', (addr) => {
    schedulePollingRestart(addr || getViewedAddress());
  });
  // 5. Re-arm via connected.address ONLY when no ?as= override is active
  //    (otherwise the deep-link target wins).
  subscribe('connected.address', (addr) => {
    if (!getViewedAddress() || getViewedAddress() === addr) {
      schedulePollingRestart(addr);
    }
  });
  // GAME.currentDayView is the clock for both draw surfaces. At the exact
  // boundary, promptly reconcile the richer indexed feeds and player-owned
  // reveals. Jackpot and coinflip consumers each unlock from their own exact-
  // day lane; app.daySync.ready only reports when the whole handoff is done.
  startDayRollover({
    onRefreshNeeded: ({
      dayChanged,
      readyChanged,
      requestChanged,
      processingCompleteChanged,
      state,
    }) => {
      // The boundary/request edges update chain-derived UI only. Do not ask the
      // jackpot API while Mine FLIP work is still pending. `advanceDue()` gives
      // us the exact completion edge; that path performs one forced result read
      // plus one bounded retry if the indexer loses the block race.
      if (dayChanged || requestChanged) {
        void refreshForDayShift({ includePlayer: true, includeLastDay: false });
      }
      if (processingCompleteChanged && state?.processingComplete && !state?.jackpotReady) {
        void refreshJackpotAfterChainCompletion({ day: state.day, includePlayer: true });
      }
      if (dayChanged || readyChanged || requestChanged || processingCompleteChanged) {
        refreshPackWatch();
        refreshBingoWatch();
        refreshWhalePassClaims();
        refreshLaunchClaims();
      }
    },
  });
  // 6. THE DAY SELECTOR IS THE DAY AT THE TOP (user call 2026-07-29). It used to
  //    be a static `DAY N` span up here plus a separate, CSS-hidden day <select>
  //    buried in the replay panel. One control now: the top-bar day IS the
  //    picker, and picking a day re-pins the jackpot widget.
  //
  //    Options are mirrored from the replay panel's own day select rather than
  //    re-fetched — that select is already populated from the day feed, and
  //    last-day-jackpot already treats a manual pick on it as a new pin. So the
  //    nav writes into that select and fires `change`, reusing the proven
  //    re-pin path instead of adding a second source of truth.
  mountDaySelector();
  mountJackpotCountdown();
  console.log('[app] ready');

  // Badge art: one bundled fetch on idle, AFTER the critical UI is up — every
  // badge rendered from then on resolves to a local blob URL instead of its
  // own /badges-circular/ or /symbols/ request (badge-sprite.js).
  const warmBadges = () => { void warmBadgeStore(); };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warmBadges, { timeout: 4000 });
  } else {
    setTimeout(warmBadges, 1500);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
