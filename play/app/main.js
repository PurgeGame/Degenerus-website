// play/app/main.js -- /play/ route bootstrap
// SHELL-01: imports ONLY from ../../beta/app/store.js (verified wallet-free)
//           and from local play/app + play/components modules.
// NO imports from: beta/app/wallet.js, beta/app/contracts.js, beta/app/utils.js,
//                  beta/app/api.js, beta/components/connect-prompt|purchase|coinflip|decimator,
//                  or bare 'ethers'.

import { update, subscribe, get } from '../../beta/app/store.js';
import { fetchJSON } from './api.js';
import { API_BASE } from './constants.js';

// ---------------------------------------------------------------------------
// Component registration (side-effect imports -- each file calls
// customElements.define on load). Dynamic imports are used so that if a
// component file is missing the page still boots (degrades to a skeleton-
// only view). Plan 03 delivers all of these files.
// ---------------------------------------------------------------------------

async function registerComponents() {
  const paths = [
    '../components/player-selector.js',
    '../components/day-scrubber.js',
    '../components/profile-panel.js',
    '../components/packs-panel.js',
    '../components/tickets-panel.js',
    '../components/coinflip-panel.js',
    '../components/position-panel.js',
    '../components/purchase-panel.js',
    '../components/pass-panel.js',
    '../../beta/components/replay-panel.js',
  ];
  for (const p of paths) {
    try {
      await import(p);
    } catch (err) {
      console.warn('[play] component not yet available:', p, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Boot sequence (DAY-02 + DAY-03)
// ---------------------------------------------------------------------------

async function boot() {
  console.log('[play] initializing');

  // 1. Register Custom Elements (tolerant of missing files during Wave 1 -> Wave 2 gap).
  await registerComponents();

  // 1.5. Bridge play store -> beta replay-panel selects so the day-scrubber
  //      and player-selector drive the replay-panel instead of its own dropdowns.
  try {
    const mod = await import('./replay-panel-sync.js');
    mod.bindReplayPanelToStore();
  } catch (err) {
    console.warn('[play] replay-panel-sync not available:', err.message);
  }

  // 2. Load global day list once (DAY-03).
  //    Filter to days where finalWord is non-zero (RNG resolved).
  let resolvedDays = [];
  try {
    const { days } = await fetchJSON('/replay/rng');
    resolvedDays = (days || [])
      .filter(d => d.finalWord && d.finalWord !== '0')
      .map(d => d.day)
      .sort((a, b) => a - b);
  } catch (err) {
    console.error('[play] failed to load /replay/rng:', err);
  }

  // 3. Wire player selector. initPlayerSelector is lazy-imported so the
  //    module cache only touches it if Plan 03 has shipped it.
  try {
    const selectorModule = await import('../components/player-selector.js');
    if (selectorModule && typeof selectorModule.initPlayerSelector === 'function') {
      // The <player-selector> Custom Element owns its own <select> in
      // its light DOM. We query it after upgrade.
      const host = document.querySelector('player-selector');
      const selectEl = host ? host.querySelector('select') : null;
      if (selectEl) {
        await selectorModule.initPlayerSelector(selectEl, (addr) => {
          update('replay.player', addr);
        });
      }
    }
  } catch (err) {
    console.warn('[play] player-selector not available:', err.message);
  }

  // 4. Wire day scrubber. createScrubber is imported from beta/viewer/scrubber.js
  //    (verified wallet-free, exports factory per RESEARCH section 4).
  try {
    const { createScrubber } = await import('../../beta/viewer/scrubber.js');
    const host = document.querySelector('day-scrubber');
    if (host && resolvedDays.length > 0) {
      const minDay = resolvedDays[0];
      const maxDay = resolvedDays[resolvedDays.length - 1];
      const initialDay = maxDay;
      const scrubber = createScrubber({
        root: host,
        idPrefix: 'play',
        minDay,
        maxDay,
        initialDay,
        onDayChange: (day) => update('replay.day', day),
      });
      scrubber.setRange(minDay, maxDay);
      scrubber.setDay(initialDay);
      // Fire initial signal so panels subscribed to replay.day hydrate
      // on first boot (RESEARCH Pitfall 3: setRange/setDay do not auto-fire).
      update('replay.day', initialDay);
    } else if (host) {
      host.textContent = 'No days with resolved RNG available.';
    }
  } catch (err) {
    console.warn('[play] day-scrubber not available:', err.message);
  }

  // Phase 52 Pitfall 2 guard: populate state.replay.level so <tickets-panel>
  // and <packs-panel> can fetch INTEG-01, and <jackpot-panel-wrapper> can
  // shim game.level. Derived from /game/jackpot/day/{day}/winners; falls
  // back to the live /game/state level when no jackpot has been rolled for
  // the day yet (early days, pre-L1 boot, variable-length levels on testnet
  // 15-min real-time days). The old arithmetic `Math.ceil(day / 5)` fallback
  // assumed uniform 5-day levels and reported L10 on day 50 when the game
  // was still at L0.
  async function updateLevelForDay(day) {
    if (day == null) return;
    try {
      const resp = await fetch(`${API_BASE}/game/jackpot/day/${day}/winners`);
      if (resp.ok) {
        const payload = await resp.json();
        if (payload && typeof payload.level === 'number') {
          update('replay.level', payload.level);
          return;
        }
      }
    } catch { /* fall through to /game/state */ }
    try {
      const stateResp = await fetch(`${API_BASE}/game/state`);
      if (stateResp.ok) {
        const stateData = await stateResp.json();
        const lvl = Number(stateData?.level);
        if (Number.isFinite(lvl) && lvl >= 0) {
          update('replay.level', Math.max(1, lvl));
          return;
        }
      }
    } catch { /* leave replay.level unset; panels gate on >0 */ }
  }

  subscribe('replay.day', (day) => updateLevelForDay(day));
  updateLevelForDay(get('replay.day'));

  // 5. Subscribe to log writes to the store for dev visibility (optional;
  //    panels do their own subscriptions in Plan 03).
  subscribe('replay.player', (addr) => console.log('[play] replay.player =', addr));
  subscribe('replay.day', (day) => console.log('[play] replay.day =', day));

  console.log('[play] ready');
}

boot().catch(err => console.error('[play] boot failed:', err));
