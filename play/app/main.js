// play/app/main.js -- /play/ route bootstrap
// SHELL-01: imports ONLY from ../../beta/app/store.js (verified wallet-free)
//           and from local play/app + play/components modules.
// NO imports from: beta/app/wallet.js, beta/app/contracts.js, beta/app/utils.js,
//                  beta/app/api.js, beta/components/connect-prompt|purchase|coinflip|decimator,
//                  or bare 'ethers'.

import { update, subscribe, get } from '../../beta/app/store.js';
import { fetchJSON } from './api.js';

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
    '../components/purchase-panel.js',
    '../components/coinflip-panel.js',
    '../components/baf-panel.js',
    '../components/decimator-panel.js',
    '../components/jackpot-panel-wrapper.js',
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

  // 5. Subscribe to log writes to the store for dev visibility (optional;
  //    panels do their own subscriptions in Plan 03).
  subscribe('replay.player', (addr) => console.log('[play] replay.player =', addr));
  subscribe('replay.day', (day) => console.log('[play] replay.day =', day));

  console.log('[play] ready');
}

boot().catch(err => console.error('[play] boot failed:', err));
