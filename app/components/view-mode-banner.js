// /app/components/view-mode-banner.js — Phase 58 Plan 04 view-mode UX layer (DD-02).
//
// Two responsibilities, both module-init (no Custom Element wrapper — operates
// on the existing #view-mode-banner placeholder shipped in Phase 56 + every
// [data-write] button in the document):
//
//   1. Banner visibility — toggles the `hidden` attribute on the #view-mode-banner
//      element based on subscribe('ui.mode') firings. Wires the
//      "Back to my account" CTA to clear viewing.address (router.js's URL mirror
//      from plan 58-02 then drops ?as= and store.js auto-derives ui.mode → 'self').
//
//   2. [data-write] disable manager — every Phase 60+ tx-bearing button MUST
//      tag itself with `data-write`. This module subscribes to ui.mode AND
//      ui.chainOk AND connected.address; whenever any of those change, it
//      walks every [data-write] element in the document and sets:
//        disabled = !canSign
//        title    = canSign ? '' : 'Connect to your own wallet to act'
//      A MutationObserver covers Phase 60+ panels that mount [data-write]
//      buttons after this module's init.
//
// RESEARCH §Pattern 4 layer 1 — UX layer, NOT the safety property. The
// architectural cut is requireSelf() in /app/app/contracts.js (plan 58-01),
// which throws BEFORE provider.getSigner() on every write. A devtools-enabled
// button still throws at the chokepoint before the wallet popup. This module
// is the UX layer that makes the impossibility visible to honest users.

import { subscribe, update, deriveCanSign } from '../app/store.js';

const DISABLED_TOOLTIP = 'Connect to your own wallet to act';
const BANNER_ID = 'view-mode-banner';
const BANNER_CTA_SELECTOR = '.view-mode-banner__cta';

// ---------------------------------------------------------------------------
// Banner visibility manager.
//
// Idempotency: subscribers + click listener are installed at most once per
// process lifetime. Repeated calls are no-ops. Tests reset via
// __resetForTest() below (which also tears down the data-write manager).
// ---------------------------------------------------------------------------

let _bannerSetupDone = false;
const _bannerUnsubs = [];

export function setupBanner() {
  if (_bannerSetupDone) return;
  if (typeof document === 'undefined') return;
  const banner = document.getElementById(BANNER_ID);
  if (!banner) {
    // eslint-disable-next-line no-console
    console.warn('[view-mode-banner] #view-mode-banner element not found');
    return;
  }
  _bannerSetupDone = true;

  // Visibility — subscribe('ui.mode') drives the [hidden] attribute. We look
  // up the banner inside the callback so a Phase 60+ re-render that swaps the
  // #view-mode-banner element does not leave us writing to a detached node
  // (WR-07).
  _bannerUnsubs.push(subscribe('ui.mode', (mode) => {
    const b = (typeof document !== 'undefined') ? document.getElementById(BANNER_ID) : null;
    if (b) b.hidden = (mode !== 'view');
  }));

  // Wire the "Back to my account" CTA.
  const cta = banner.querySelector(BANNER_CTA_SELECTOR);
  if (cta) {
    cta.addEventListener('click', () => {
      update('viewing.address', null);
      // ui.mode auto-derives to 'self' via store.js's deriveMode subscriber on
      // the next microtask. router.js's URL mirror drops ?as= via its own
      // subscribe('viewing.address') subscriber.
    });
  }
}

// ---------------------------------------------------------------------------
// [data-write] disable manager.
// ---------------------------------------------------------------------------

/**
 * refreshDataWriteButtons — walk every [data-write] in the document and
 * toggle disabled + title based on the current canSign value.
 *
 * canSign === true  → enabled, tooltip cleared
 * canSign === false → disabled, title='Connect to your own wallet to act'
 */
export function refreshDataWriteButtons() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  const canSign = deriveCanSign();
  const buttons = document.querySelectorAll('[data-write]');
  if (!buttons || typeof buttons.forEach !== 'function') return;
  buttons.forEach((btn) => {
    if (canSign) {
      btn.disabled = false;
      // Clear tooltip — set to empty string AND removeAttribute for max compatibility.
      btn.title = '';
      if (typeof btn.removeAttribute === 'function') {
        btn.removeAttribute('title');
      }
      if (typeof btn.setAttribute === 'function') {
        btn.setAttribute('aria-disabled', 'false');
      }
    } else {
      btn.disabled = true;
      btn.title = DISABLED_TOOLTIP;
      if (typeof btn.setAttribute === 'function') {
        btn.setAttribute('aria-disabled', 'true');
      }
    }
  });
}

// Idempotency: subscribers + MutationObserver are installed at most once per
// process lifetime. Repeated calls are no-ops. Tests reset via
// __resetForTest() below.
let _dataWriteSetupDone = false;
const _dataWriteUnsubs = [];
let _dataWriteObserver = null;

export function setupDataWriteManager() {
  if (_dataWriteSetupDone) return;
  _dataWriteSetupDone = true;

  // Initial pass — Phase 58 ships zero [data-write] buttons; Phase 60+ panels
  // will mount them. Safe to run regardless.
  refreshDataWriteButtons();

  // Re-evaluate whenever any input to canSign changes. subscribe() fires
  // immediately with current value, so each call kicks off an initial refresh
  // (idempotent — the same end-state is computed each time).
  _dataWriteUnsubs.push(subscribe('ui.mode', refreshDataWriteButtons));
  _dataWriteUnsubs.push(subscribe('ui.chainOk', refreshDataWriteButtons));
  _dataWriteUnsubs.push(subscribe('connected.address', refreshDataWriteButtons));

  // MutationObserver: when Phase 60+ panels mount [data-write] buttons after
  // this module's init, refresh them too.
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
    _dataWriteObserver = new MutationObserver((mutations) => {
      let needsRefresh = false;
      for (const m of mutations) {
        const added = m && m.addedNodes;
        if (!added) continue;
        for (const node of added) {
          if (!node || node.nodeType !== 1) continue;   // Element nodes only
          if ((typeof node.matches === 'function' && node.matches('[data-write]'))
              || (typeof node.querySelector === 'function' && node.querySelector('[data-write]'))) {
            needsRefresh = true;
            break;
          }
        }
        if (needsRefresh) break;
      }
      if (needsRefresh) refreshDataWriteButtons();
    });
    try {
      _dataWriteObserver.observe(document.body, { childList: true, subtree: true });
    } catch { /* swallow — non-DOM env */ }
  }
}

// ---------------------------------------------------------------------------
// Test-only reset — tears down both managers so a fresh setup* call
// re-installs subscribers against the post-__resetForTest store registry.
// NOT for production consumers.
// ---------------------------------------------------------------------------

export function __resetForTest() {
  for (const u of _bannerUnsubs) {
    try { u(); } catch { /* swallow */ }
  }
  _bannerUnsubs.length = 0;
  _bannerSetupDone = false;

  for (const u of _dataWriteUnsubs) {
    try { u(); } catch { /* swallow */ }
  }
  _dataWriteUnsubs.length = 0;
  if (_dataWriteObserver && typeof _dataWriteObserver.disconnect === 'function') {
    try { _dataWriteObserver.disconnect(); } catch { /* swallow */ }
  }
  _dataWriteObserver = null;
  _dataWriteSetupDone = false;
}

// ---------------------------------------------------------------------------
// Module-init wrapper — defer until DOM ready.
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  const init = () => {
    setupBanner();
    setupDataWriteManager();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
