// /app/components/app-boons-panel.js — Phase 62 Plan 62-05 (BNS-01)
//
// Thin bridge wrapper Custom Element that mounts /beta/components/boons-panel.js
// VERBATIM via cross-import (CF-09 LOCKED — /beta/ source NEVER edited; only
// cross-imported). Bridges /app/-side identity into the /beta/ store paths so
// the verbatim <boons-panel> renders /app/-scoped data.
//
// RESEARCH R9 (MEDIUM confidence) identified the CRITICAL caveat:
// /beta/components/boons-panel.js:6 imports `subscribe` from '../app/store.js'
// — a relative path that resolves to /beta/app/store.js regardless of who
// imports the module. Two stores coexist in memory simultaneously when both
// modules are loaded. Pitfall 6 (RESEARCH): skipping this bridge causes the
// boons-panel root to render `hidden` (boons-panel.js:56-60); console shows
// no errors but no data either.
//
// RESEARCH R9 OPTION B (researcher recommendation): wrapper imports `update`
// from /beta/app/store.js AND the cross-imported <boons-panel>. Wrapper
// subscribes to /app/-store identity paths; on viewed-address change OR mount,
// fetches /game/state.currentDay then /player/:address/boons/:day, then writes
// to /beta/ store paths player.boons + replay.day via update(). The verbatim
// <boons-panel> receives the data via its existing /beta/-store subscription.
//
// Plan 62-05 ships ZERO write surfaces (T-62-BNS-02 mitigation):
//   - No transaction-submission helper, no static-call gate, no reason-map
//     registration calls, no view-mode disable attributes (read-only display;
//     CF-15 is a no-op for this panel).
//   - No new reason-map entries (no contract calls).
//   - No edits to /beta/ source (CF-09 binding constraint).
//
// Carry-forwards:
//   CF-04: Phase 56 D-04 / Phase 61 D-04 — panel-owned 30s poll cycle with
//          AbortController-per-cycle (panel-owned, NOT polling.js).
//   CF-09: BNS-01 cross-import discipline — /beta/ source never modified.
//   CF-12: Cross-repo discipline — writes to website/ ONLY.

import './boons-panel.js';
import { update as updateBeta } from '../app/reactive-store.js';
import { subscribe as subscribeApp, getViewedAddress, get as getApp } from '../app/store.js';
import { fetchJSON } from '../app/api.js';

// Account-switcher (2026-07-16) identity-panel note — matches app-quest-panel.js /
// app-activity-panel.js copy. Boons are per-account event history; combine.js has
// nothing to merge for them (not listed as a SUM/CONCAT field).
const COMBINED_NOTE = 'Per-account stat. Pick a single account.';

const POLL_INTERVAL_MS = 30_000; // Phase 56 D-04 / Phase 61 D-04 LOCKED.

// Wraps setTimeout with .unref() in Node.js (no-op in browsers). Used for the
// 30s poll tick so node:test processes exit cleanly when no other open handles
// remain. Mirrors app-quest-panel.js _setIntervalUnref.
function _setTimeoutUnref(fn, ms) {
  const h = setTimeout(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

class AppBoonsPanel extends HTMLElement {
  // Idempotency-guard pattern (Phase 60 / 61 / 62-01 / 62-02 / 62-03 / 62-04).
  #unsubs = [];
  #initialized = false;
  // Panel-owned poll lifecycle (CF-04).
  #pollAbort = null;
  #pollTimer = null;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();
    this.#wireSubscriptions();
    this.#startPollCycle();
    // Eager first cycle on mount.
    this.#refreshBoons();
  }

  disconnectedCallback() {
    for (const u of this.#unsubs) {
      try { u(); } catch (_e) { /* defensive */ }
    }
    this.#unsubs = [];
    if (this.#pollAbort) {
      try { this.#pollAbort.abort(); } catch (_e) { /* defensive */ }
      this.#pollAbort = null;
    }
    if (this.#pollTimer != null) {
      try { clearTimeout(this.#pollTimer); } catch (_e) { /* defensive */ }
      this.#pollTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Render shell — STATIC innerHTML; the verbatim /beta/ <boons-panel>
  // registers itself via the side-effect import at the top of this module.
  // The ONLY new class introduced by this plan is the .app-boons-panel
  // wrapper container. The verbatim panel uses its own /beta/ class palette
  // (.boons-* / .boon-badge / .boon-tooltip) loaded from /beta/styles/boons.css
  // via the link tag added to /app/index.html in this plan.
  // -----------------------------------------------------------------------

  #renderShell() {
    // Account-switcher (2026-07-16): .app-boons-combined-note carries the
    // identity-panel note in mode 'combined' — the verbatim /beta/ <boons-panel>
    // is READ-ONLY (CF-09) so it can't render the note itself; the wrapper
    // hides it and shows this note instead (see #applyCombinedGate).
    this.innerHTML = '<div class="app-boons-panel">'
      + '<p class="app-boons-combined-note" data-bind="boons-combined-note" hidden></p>'
      + '<boons-panel data-bind="boons-inner"></boons-panel>'
      + '</div>';
  }

  // -----------------------------------------------------------------------
  // Store subscriptions — /app/-side identity paths. On wallet switch
  // (connected.address) OR view-target switch (viewing.address), fire an
  // immediate refresh that re-fetches boons for the newly resolved address.
  // -----------------------------------------------------------------------

  #wireSubscriptions() {
    const u1 = subscribeApp('connected.address', () => this.#refreshBoons());
    const u2 = subscribeApp('viewing.address', () => this.#refreshBoons());
    const u3 = subscribeApp('ui.mode', () => this.#refreshBoons());
    this.#unsubs.push(u1, u2, u3);
  }

  // Toggle the wrapper's own note vs. the cross-imported <boons-panel> based
  // on ui.mode. Called from #refreshBoons on every cycle (mode can flip
  // between poll ticks via the account-switcher).
  #applyCombinedGate(isCombined) {
    const note = this.querySelector('[data-bind="boons-combined-note"]');
    if (note) {
      note.hidden = !isCombined;
      if (isCombined) note.textContent = COMBINED_NOTE;
    }
    const inner = this.querySelector('[data-bind="boons-inner"]');
    if (inner) inner.hidden = isCombined;
  }

  // -----------------------------------------------------------------------
  // Panel-owned poll cycle (CF-04 — 30s with AbortController-per-cycle).
  // The cycle is self-rescheduling: each tick fires #refreshBoons() and
  // schedules the next via setTimeout. AbortController allows
  // disconnectedCallback to cleanly cancel any in-flight fetch and prevent
  // post-disconnect ticks from firing.
  // -----------------------------------------------------------------------

  #startPollCycle() {
    if (this.#pollAbort) {
      try { this.#pollAbort.abort(); } catch (_e) { /* defensive */ }
    }
    this.#pollAbort = new AbortController();
    const signal = this.#pollAbort.signal;
    const tick = async () => {
      if (signal.aborted) return;
      try { await this.#refreshBoons(); } catch (_e) { /* network blip — next cycle retries */ }
      if (signal.aborted) return;
      this.#pollTimer = _setTimeoutUnref(tick, POLL_INTERVAL_MS);
    };
    this.#pollTimer = _setTimeoutUnref(tick, POLL_INTERVAL_MS);
  }

  // -----------------------------------------------------------------------
  // Bridge: fetch /game/state.currentDay then /player/:address/boons/:day,
  // push results into /beta/ store paths player.boons + replay.day via the
  // cross-imported updateBeta() function.
  //
  // Boons API path: /player/:address/boons/:day (verified at task time —
  // database/src/api/routes/player.ts:1379 handler exists, schema imports
  // boonsByPlayerDayParamSchema + boonsByPlayerDayResponseSchema).
  // -----------------------------------------------------------------------

  async #refreshBoons() {
    const isCombined = getApp('ui.mode') === 'combined';
    this.#applyCombinedGate(isCombined);
    if (isCombined) {
      // Boons are per-account event history — combine.js has no merged field
      // for them. Clear the bridged /beta/ store so a stale single-account
      // list can't leak through the (now-hidden) verbatim panel.
      updateBeta('player.boons', []);
      return;
    }

    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || getApp('viewing.address')
      || getApp('connected.address')
      || null;
    if (!addr) {
      // No identity → empty boons (the verbatim <boons-panel> renders its
      // root `hidden` per boons-panel.js:56-60 — that's the desired
      // empty-state behavior).
      updateBeta('player.boons', []);
      return;
    }
    try {
      const stateData = await fetchJSON('/game/state');
      const day = stateData?.currentDay;
      if (day == null) return;
      const res = await fetchJSON(`/player/${addr}/boons/${day}`);
      updateBeta('player.boons', res?.boons || []);
      updateBeta('replay.day', day);
    } catch (_err) {
      // Network blip — next poll cycle retries. Empty-state preserved.
    }
  }
}

// Idempotency-guarded registration (Phase 58/59/60/61/62 pattern). Required
// for node:test re-import safety AND production hot-module-replacement.
if (typeof customElements !== 'undefined' && typeof customElements.define === 'function') {
  if (!customElements.get('app-boons-panel')) {
    customElements.define('app-boons-panel', AppBoonsPanel);
  }
}

export { AppBoonsPanel };
